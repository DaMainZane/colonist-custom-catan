import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { simulateGame } from '../src/server/bots/sim';
import { createGame, createRegistry, dispatch, everyNRounds, makeCtx, startTurn } from '../src/shared';
import type { GameState, Pack, Registry } from '../src/shared';

function clockPack(log: string[]): Pack {
  return {
    id: 'clock', name: 'Clock', deps: ['base'],
    register(api) {
      api.hook('onRoundStart', ctx => { log.push(`start${ctx.g.round}`); });
      api.hook('onRoundEnd', ctx => { log.push(`end${ctx.g.round}`); });
      api.hook('onRoundStart', everyNRounds(2, ctx => { log.push(`every2@${ctx.g.round}`); }));
    }
  };
}

/** A fresh game moved straight to the first normal turn (setup skipped). */
function firstTurn(log: string[], players = 3): { g: GameState; reg: Registry } {
  const reg = createRegistry([...allPacks, clockPack(log)]);
  const g = createGame(reg, {
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` })),
    seed: 1,
    shuffleSeats: false
  });
  g.turn = 0;
  g.turnCount = 1;
  startTurn(makeCtx(g, reg));
  return { g, reg };
}

function endTurn(g: GameState, reg: Registry): void {
  g.phase = 'main';
  const res = dispatch(g, reg, { type: 'end_turn', playerId: g.players[g.turn].id });
  expect(res.ok, res.error).toBe(true);
}

describe('round clock', () => {
  it('setup is round 0 and nothing fires before the first turn', () => {
    const log: string[] = [];
    const reg = createRegistry([...allPacks, clockPack(log)]);
    const g = createGame(reg, { players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], seed: 1, shuffleSeats: false });
    expect(g.round).toBe(0);
    expect(log).toEqual([]);
  });

  it('round 1 starts with the first normal turn', () => {
    const log: string[] = [];
    const { g } = firstTurn(log);
    expect(g.round).toBe(1);
    expect(log).toEqual(['start1']);
  });

  it('a round ends when the last seat ends its turn, then the next one starts', () => {
    const log: string[] = [];
    const { g, reg } = firstTurn(log, 3);
    endTurn(g, reg);
    endTurn(g, reg);
    expect(log).toEqual(['start1']);
    expect(g.round).toBe(1);
    endTurn(g, reg);
    expect(g.turn).toBe(0);
    expect(g.round).toBe(2);
    expect(log).toEqual(['start1', 'end1', 'start2', 'every2@2']);
  });

  it('everyNRounds fires on multiples of n only', () => {
    const log: string[] = [];
    const { g, reg } = firstTurn(log, 2);
    for (let i = 0; i < 8; i++) endTurn(g, reg); // 4 full rounds: rounds 2..5 start
    expect(g.round).toBe(5);
    expect(log.filter(l => l.startsWith('every2'))).toEqual(['every2@2', 'every2@4']);
  });

  it('a whole bot game keeps the clock consistent', () => {
    const r = simulateGame({ seed: 5, players: 3 });
    expect(r.error).toBeNull();
    expect(r.finished).toBe(true);
    expect(r.game.round).toBeGreaterThanOrEqual(1);
    expect(r.game.round).toBeLessThanOrEqual(r.game.turnCount);
  }, 120_000);
});
