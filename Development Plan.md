0. **Skeleton deploy.** Tag the current version, pick a host, deploy the old game, and confirm friends can join from phones.
1. **Infrastructure.** esbuild, TypeScript, the folder structure, a no-behavior-change split of `server.js` and `index.html`, tests, a Dockerfile, auto-deploy on push, and a stub README.
2. **Engine and base game together.** Registry, one action pipeline, phase machine, seeded RNG, with the base rules and gold as the first packs. Include a simple bot so you can run automated bot-vs-bot games for testing.
3. **Identity and persistence.** Player tokens, reconnect, a room passcode, and game restore after a server restart.
4. **UI and phone together.** Adaptive layouts, pointer/touch input, a faster board renderer, and PWA. Test on real devices throughout.
5. **Modularity proof.** Add one new building or mechanic as a pack without touching the core, then write the modding docs.
6. **Map editor.** Map format, validation, editor, save/share, test-play. This comes after modularity because the editor's palette comes from the registry.
7. **Bot AI v2.** Brain interface, difficulty levels, and a planner that works with any registered piece. This comes after step 5 so it isn't hardcoded to settlements and cities.
8. **Hardening.** Playtest with 8 real devices, fix issues, and finalize the README.