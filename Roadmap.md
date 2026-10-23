	# Catan Rework: Architecture Brainstorm

## 1. Goal
A modular Catan-style game, hosted remotely for a private group (max 8 players), playable in phone and PC browsers. It has bots, a player-facing map/level maker, and an engine where new pieces, mechanics and interactions are added as self-contained modules. One build command bundles everything. The README is rewritten to document the infrastructure and goals. Most of the current internals will be replaced.

## 2. Current project audit
Stack: Node, Express, Socket.io, SVG. Files: `server.js` (rules, topology, bots, socket handlers), `public/index.html` (73 KB with inline CSS and JS), `package.json`, README.

**Worth porting as reference**
- Hex-to-vertex/edge topology builder, with ports keyed by edge midpoint
- Pip scoring, longest-road DFS, gold-pick and discard flow
- Bot heuristics: vertex scoring, build-plan analysis (missing/surplus cards), trade evaluation, leader-blocking, robber targeting
- Trade UX: inline drawer, response avatars, click-to-confirm partner
- SVG icon functions and the Colonist-style look

**Blockers for the new goal**
- Rules are hardcoded: resources, piece costs, dev cards and phases are spread across the server handlers, the bot code and the client buttons. Adding a piece means editing 4+ places.
- Rule logic is duplicated. The client re-implements `canPlace*`, and bots have their own dev-card code (`playBotDevCard`) instead of using the human path.
- State is a mutable global `rooms`, and bot pacing uses scattered `setTimeout`s. Nothing is restorable after a restart.
- Player identity is `socket.id`. A refresh or phone sleep loses the seat, and a disconnect permanently turns the player into a bot.
- There is no privacy: anyone with a 5-letter code can join, and CORS is `*`.
- The whole board is rebroadcast on every change. The client rebuilds the entire SVG via `innerHTML` on every update, pan and zoom.
- Input is mouse-only (`mousedown`, `mouseenter`, wheel, right-click pan), so there is no touch. The layout is a fixed 315px sidebar plus an 8-button HUD with `100vh`, which breaks on phones.
- The map painter trusts client-supplied terrain values, and the map is tied to the room (not savable or shareable).
- Bots read hidden hands (e.g. Monopoly resource choice).

## 3. Principles
1. **Data-driven content.** Resources, tiles, pieces, dev cards, awards and phases are definitions in a registry, not code scattered through handlers.
2. **One shared engine.** Pure rules code runs on the server (authoritative) and in the client (legal-move highlighting, previews). No duplicated rules.
3. **One action pipeline.** Humans and bots both submit `{type, payload}` actions, which are validated and applied identically.
4. **Everything serializable.** State is plain JSON, which gives save/restore, reconnect, replay and bot-vs-bot simulation.
5. **UI generated from the registry.** New pieces and tiles automatically get buttons, icons and editor palette entries.
6. **Touch-first input.** Pointer events, pinch/pan, big hit areas.

## 4. Build and bundling

**Decided: build model**
- esbuild with two entry points. `src/server/main.ts` → `dist/main.js`, and `src/client/main.ts` → `dist/public/app.js`. `npm run dev` watches and restarts; `npm run build` produces the deployable.

**Decided: language**
- TypeScript. esbuild compiles it with no config, and types catch mistakes in module definitions, which matters most for a modular system.

## 5. Target architecture

```
catan/
  package.json, esbuild.config.mjs, Dockerfile, README.md
  docs/        ARCHITECTURE.md  MODDING.md  MAP_FORMAT.md  ROADMAP.md
  packs/                      # gameplay content, one folder per pack
    base/    resources, tiles, pieces, devcards, awards, ports, phases, rules.json
    gold/    gold tile + pick-resource flow
    (future) walls, ships, events...
  src/
    shared/  engine: topology, registry, state, actions, phases, validate, views, rng
    server/  main.ts, rooms, net, auth/reconnect, persistence, bots/, scheduler
    client/  main.ts, net, store, render/, ui/, editor/, input/, audio, styles
  maps/      built-in map JSON
  tests/     engine tests + headless bot-vs-bot sims
  dist/      build output (gitignored)
```

**Engine model**
- **State:** plain JSON (board, players, bank, deck, phase, turn, awards, log)
- **Actions:** `{type, payload}` from a player or bot, one `action` socket channel replacing ~25 handlers
- **Phases:** a state machine. Each phase file declares allowed actions, `enter`/`exit` and auto-advance (setup, roll, main, robber, discard, goldPick…)
- **Events:** the engine emits events (`rolled`, `produced`, `built`, `traded`…) used by the log, sounds, animations and replay
- **Registry:** `register('piece', def)`, with lookup by id everywhere

**Example definition (illustrative)**
```ts
export const wall = {
  id: 'wall',
  target: 'edge',                    // vertex | edge | hex
  cost: { brick: 2 },
  limit: 6,
  canPlace: (s, who, edge) => ...,   // placement rule
  onBuild: (s, who, edge) => ...,    // effect
  vp: 0,
  icon: 'wall',                      // UI + editor pick it up automatically
  botValue: (view, edge) => ...      // optional hint for bots
};
```

**Hooks modules can use:** `onTurnStart`, `onRoll`, `onProduce`, `onSeven`, `onBuild`, `onTrade`, `onTurnEnd`, `onScore`, plus custom phases and custom actions.

**Packs and rulesets**
- A ruleset is an ordered list of packs plus parameter overrides (VP target, bank size, deck counts, piece limits…)
- The host toggles packs per room in the lobby (presets plus checkboxes), with no server restart needed
- Vanilla, Gold Rush and custom sets are just presets
- Longest Road and Largest Army become "award" modules

**Networking**
- Server is authoritative and sends each player a filtered view plus the events since last view
- The board is sent once per game/edit, not on every change
- Seat identity uses a persistent player token (localStorage), not `socket.id`
- Reconnect keeps the seat. After a grace period a bot covers the seat, and the human can reclaim it
- Room passcode or invite token, spectators, and a server-side 8-player cap

**Persistence:** room snapshots to JSON files or SQLite every N actions, with maps stored as files. A restart restores running games.

**Bots**
- `Brain.decide(playerView, legalActions) → action`. Bots see only their own view (no hidden-hand cheating)
- A generic goal planner reads piece costs from the registry instead of hardcoded city/settlement logic
- Difficulty tiers are weight profiles (data), with optional personalities
- One scheduler per room replaces scattered `setTimeout`s, with a game-speed setting
- Headless sim harness: run N bot-only games on a seed to catch crashes and balance problems when mechanics or maps change

**Testing:** seeded RNG, engine unit tests, bot-vs-bot simulations as the regression suite.

## 6. Level maker (map editor)

**Map format (JSON, versioned)**
```
{ version, name, author, grid: "hex",
  tiles: [{q, r, type, number}], ports: [{edge, type}],
  robberStart, rules: { ...overrides }, packs: [...] }
```
- Geometry is derived from coordinates by a pure topology function, so the file stores only content.
- The editor palette is generated from the registry, so new tile types appear automatically.

**Editor tools:** brush and fill, rectangle select, number and port placement, rotational/mirror symmetry (fair maps for 8 players), undo/redo (command stack), random-generate with constraints (no adjacent 6/8, resource balance), pip balance readout.

**Validation panel:** connected land, enough legal starting spots for the player count, ports on coast only, unreachable tiles, red-number clustering.

**Sharing:** export/import JSON and a share code. The server keeps a map library for the group.

**Test-play:** one click starts a solo game vs bots on the current map.

**Decided: editor mode**
- Standalone editor page (local autosave) plus "Use in lobby". It reuses the board renderer and works on phones.

## 7. UI development philosophy

**Decided: UI philosophy (minimalist, functional, interactive)**
- **Board-centric contextual UI:** few permanent buttons. Tapping a spot or piece on the board offers the valid actions there (build road, upgrade to city, move robber).
- **Adaptive shells:** shared components and state, two layout shells chosen by viewport and pointer type. Desktop: slim side panel and hand dock. Phone: bottom sheets and a compact HUD.
- **Data-driven UI:** buttons, icons, cards and the editor palette are generated from the registry. Skins are CSS variables plus icon packs.

**Decided: UI framework/renderer**
- Preact (+htm or JSX). Tiny, component-based, builds easily with esbuild.
- **Renderer:** SVG behind a renderer interface. It's enough up to ~61 hexes with keyed updates, and canvas can be swapped in later.

**Phone requirements (all options)**
- Unified pointer events: tap, drag-paint, pinch-zoom, two-finger pan
- 44px+ touch targets, with expanded invisible hit areas for vertices and edges
- `dvh` units, safe-area insets, landscape-friendly layout
- Audio unlock on first tap, optional haptics, and Screen Wake Lock so the phone doesn't sleep mid-game
- PWA manifest (add to home screen, fullscreen)
- 8 player colors that are color-blind safe, plus a shape or icon per player
- Auto-reconnect on tab resume

## 8. Hosting for a private 8-player server

**Decided: hosting**
- **Container on a small cloud host** (Fly.io, Render, Railway, or an always-free VM). Pick a Southeast Asia region (e.g. Singapore) where offered, since latency matters for turn-based sockets less than for action games but still counts. Check current free-tier limits; some free tiers sleep when idle.

**Access control (no accounts):** a server passphrase or invite-link token, optional per-room passcode, a hard 8-player cap, basic rate limiting, locked-down CORS.

**Ops:** Dockerfile, env-var config, `/health` endpoint, a persistent volume for rooms and maps, restart-safe, HTTPS (needed for clipboard, PWA and wake lock).

## 9. README plan (replaces the old one)
1. What it is, goals and screenshots
2. Features (player-facing)
3. Architecture overview and diagram: shared engine, server, client, packs, bots
4. Project structure (the tree above)
5. Quick start: install, dev, build, run
6. Modding guide summary: add a piece, tile, dev card or mechanic (full text in `docs/MODDING.md`)
7. Map format and editor (`docs/MAP_FORMAT.md`)
8. Bots: difficulty, how to add a brain
9. Hosting and deployment guide, access control
10. Mobile and PWA notes
11. Testing and simulation
12. Roadmap and license

## 10. Development roadmap (commit after each phase)
- **P0, safety net:** tag the current version. Add a headless harness that plays the old game with bots, to compare behavior later.
- **P1, tooling and split (no behavior change):** esbuild, TypeScript, split `server.js` and `index.html` into modules. Stub README.
- **P2, engine core:** registry, action pipeline, phase machine, seeded RNG. Port the base rules into `packs/base` and gold into `packs/gold`. Unify the human and bot paths. Engine tests.
- **P3, identity and persistence:** player tokens, reconnect and grace-period bot cover, room passcode, snapshots and restore.
- **P4, responsive UI:** pointer input, adaptive shells, keyed renderer, PWA. Test on real phones.
- **P5, map system:** map format, validation, standalone editor, library and sharing, lobby integration, test-play.
- **P6, bots v2:** brain interface, difficulty profiles, registry-aware planner, sim harness for balance.
- **P7, prove modularity:** ship one new mechanic as a pack (e.g. walls or harbor events) without touching core, and write the modding docs.
- **P8, deploy:** Dockerfile, chosen host, HTTPS, backups, playtest with 8 real devices.
- **P9, polish:** animations, sounds, spectators, game history and replay (cheap once events exist), stats.

**Definition of done per phase:** the build passes, tests and sims pass, the game is playable end to end, and it's committed.

## 11. Risks and watch-outs
- Doing the split (P1) and the rule rewrite (P2) in one step makes bugs untraceable, so keep them separate.
- Hidden-information rules need care: dev-card VP, per-player resource views and bot views must never leak.
- Edge-case rules to re-test: longest road broken by opponent buildings, Year of Plenty and gold when the bank is short, discard order on a 7, robber with no victims.
- The editor must validate server-side. Never trust client terrain or number values.
- 8 players on big maps needs a minimum-land check and a fair-start check.
- Test touch input on real devices early. Desktop emulation misses a lot.

## 12. Decisions
1. Build model: esbuild, two entry points (server and client)
2. Language: TypeScript
3. Editor mode: standalone editor page plus "Use in lobby"
4. UI philosophy: board-centric contextual UI, adaptive shells, data-driven UI
5. Framework: Preact, with an SVG renderer behind an interface
6. Hosting: container on a small cloud host
7. Rule modules (packs): the host toggles packs per room in the lobby, as presets and checkboxes