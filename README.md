# HexSettlers Online

Modular Catan-style game for private groups (max 8 players), playable in phone and PC browsers. Work in progress: see `Roadmap.md` and `Development Plan.md`.

## Quick start

```
npm install
npm run dev      # watch + restart on http://localhost:3000
npm run build    # production bundle in dist/
npm start        # run dist/main.js
npm test         # vitest
npm run typecheck
```

## Layout

- `src/server/` TypeScript server (bundled by esbuild to `dist/main.js`)
- `public/` static client (copied to `dist/public`)
- `tests/` unit tests
- `legacy/` original single-file server, kept as reference

Full README (architecture, modding, hosting) comes later in the plan.
