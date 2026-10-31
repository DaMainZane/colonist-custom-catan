PS C:\Users\John\Documents\Obsidian\Obsidian Vault\Coding Project\colonist-custom-catan> git grep -nE "drivePirate|upgradeHarbor|spendFish|upgradeBridge|demolishBridge|convertTile|upgradePort|researchTech" -- src/server src/shared tests scripts
src/server/bots/brain.ts:1517:    const upgradePort = pickUpgradePortMove(dc, of('upgrade_port'));
src/server/bots/brain.ts:1518:    if (upgradePort) return upgradePort;
src/shared/stage1.ts:572: * the payment matches the price, and the player can afford it. The `research_tech` action and `researchTech` both use it.
src/shared/stage1.ts:593:export function researchTech(
src/shared/stage1.ts:634:  /** True when `researchTech` would succeed right now (turn and phase are the action's business). */
tests/stage1.test.ts:36:  researchTech,
tests/stage1.test.ts:260:      expect(researchTech(ctx, 'p1', 'test.b').ok).toBe(false); // needs test.a
tests/stage1.test.ts:261:      expect(researchTech(ctx, 'p1', 'test.c').ok).toBe(false); // needs test.a and test.b
tests/stage1.test.ts:263:      expect(researchTech(ctx, 'p1', 'test.a')).toEqual({ ok: true, costCards: 2 });
tests/stage1.test.ts:268:      expect(researchTech(ctx, 'p1', 'test.c').ok).toBe(false); // still needs test.b
tests/stage1.test.ts:269:      expect(researchTech(ctx, 'p1', 'test.b').costCards).toBe(3); // tier 2 + ceil(2 / 3)
tests/stage1.test.ts:270:      const c = researchTech(ctx, 'p1', 'test.c');
tests/stage1.test.ts:274:      expect(researchTech(ctx, 'p1', 'test.a').ok).toBe(false); // already researched
tests/stage1.test.ts:285:      const res = researchTech(ctx, 'p1', 'test.a');
tests/tideboundtech.test.ts:15:  researchTech,
PS C:\Users\John\Documents\Obsidian\Obsidian Vault\Coding Project\colonist-custom-catan> git grep -n "feed_sea" -- src tests scripts

**Handoff: R6.1 socket events → `act`**

**Done**

- `feedSea` moved: its only emit site (`clickFeedSpot`, `board.ts`) now sends `act` with type `feed_sea`, and the server handler is deleted.
- `git grep` found no other `feedSea` emitters in `src`, `tests` or `scripts`. The `runAction` grep matched expectations.
- **Not yet run:** `npx vitest run tests/socketAct.test.ts`, `npm run typecheck`, `npm test`. The `feedSea` case in `socketAct.test.ts` now passes vacuously, since its handler is gone.

**Remaining eight (all literal-string emits, no variable emits known)**

- `upgradeHarbor`: `board.ts:1392`
- `upgradeBridge`: `bridgepicker.ts:228`
- `demolishBridge`: `bridgepicker.ts:237`
- `spendFish`: `drawer.ts:438`
- `drivePirate`: `pirates.ts:87`
- `researchTech`: `techpanel.ts:386`
- `upgradePort`: `techpanel.ts:393`
- `convertTile`: `techpanel.ts:407`

**Next steps**

1. Ask the user to run these and paste the output:
    - `git grep -nE "drivePirate|upgradeHarbor|spendFish|upgradeBridge|demolishBridge|convertTile|upgradePort|researchTech" -- src/server src/shared tests scripts`
    - `git grep -n "feed_sea" -- src tests scripts`
2. Get the body of each of the eight server handlers (or file and line ranges).
3. Mirror the `feed_sea` pattern (the `act` type definition and dispatch entry) for each, then convert all eight in one pass: update the client emits to `act` and delete the server handlers.
4. Have the user run vitest, typecheck and the full test suite.
5. At the end of R6.4, add a check that none of the nine handlers remain.

**Caveat:** the greps would miss any event emitted through a variable (e.g. `socket.emit(name, ...)`). Ask the user if any exist.