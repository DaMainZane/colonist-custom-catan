# HexSettlers Online

A customizable Catan-style game for private groups (up to 8 players), playable in phone and PC browsers. Includes bots with three difficulty tiers, a seeded map generator with a map menu, custom map presets, trading with counter offers, and gold and fog modes.

Current state: see `change log.md`. Next work: see `Backlog Priority.md`.

## Quick start

```
npm install
npm run dev        # watch, rebuild and restart on http://localhost:3000
npm run build      # production bundle in dist/
npm start          # run dist/main.js
npm test           # vitest
npm run typecheck
```

## Where things are

| Folder | What lives there |
|---|---|
| `src/shared/` | Pure game engine and map generator (no sockets, DOM or timers). Runs on server and client |
| `src/packs/` | Game content registered as packs: `base`, `gold`, `fog` |
| `src/server/` | Express and Socket.io adapter over the engine, rooms and lobby, bots in `bots/` |
| `src/client/` | Browser client (TypeScript, SVG board, `render/` for screens) |
| `public/` | Static page (`index.html`), copied to `dist/public` |
| `tests/` | Unit tests and bot-vs-bot simulations |

`INDEX.md` lists every file and what it does.

## How it works

- **Content is data.** Resources, tiles, pieces, dev cards, awards, ports, phases and actions are definitions registered by packs. A pack can add content without changing the engine.
- **The engine is pure.** State is plain JSON, randomness comes from a seeded RNG, and every change goes through `dispatch`. Humans and bots use the same path.
- **The server is authoritative.** It sends each player a filtered view, so hidden hands, hidden tiles and dev cards never leak.
- **Maps are recipes.** A recipe (seed, radius, picks, params) is turned into a board by `generateMap`, with each stage on its own RNG stream. The same share code gives the same map. Details in `Map Generation Design.md`.
- **Bots.** Tiers (Main, Secondary, Overload) are plain data profiles that the brain reads. `sim.ts` runs bot-vs-bot games for testing and tier tuning. Details in `Bot AI Design.md` and `Bot Dialogue Design.md`.
- **Most source files** start with a `// MODULE: what | USED BY: who` line. Add one to new files.

## Server endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | Health check (used by the host) |
| `GET /api/bot-training-logs` | Export bot training data (`?room=CODE`, `?format=json` or `jsonl`) |
| `POST /api/bot-training-sim` | Run a headless self-play batch for training data |

Training data is stored in `data/bot_training_logs.jsonl`.

## Hosting

`render.yaml` deploys to Render (Singapore, free plan, auto deploy). The `Dockerfile` builds a Node 20 image that runs `dist/main.js` on port 3000. Set `PORT` in the environment to change it (see `.env.example`).

## Design docs

| File | Topic |
|---|---|
| `Design UI Philosophy.md` | Visual direction and design tokens |
| `Map Generation Design.md` | Map generator |
| `Bot AI Design.md` | Bot tiers and brain |
| `Bot Dialogue Design.md` | Bot chat |
