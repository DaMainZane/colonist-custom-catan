import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { checkWinner, computeVP, createGame, createRegistry, makeCtx, publicVP, score } from '../src/shared';

const reg = createRegistry(allPacks);
const newGame = (rules: Record<string, any> = {}) =>
  createGame(reg, { players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], seed: 3, shuffleSeats: false, rules });

describe('score() and publicVP()', () => {
  it('vp mode (default) equals computeVP', () => {
    const g = newGame();
    for (const p of g.players) {
      expect(score(g, reg, p)).toBe(computeVP(g, reg, p, true));
      expect(score(g, reg, p, false)).toBe(computeVP(g, reg, p, false));
    }
  });

  it('publicVP leaves out hidden victory point cards, score(hidden) counts them', () => {
    const g = newGame();
    const vpCard = [...reg.devcards.values()].find(d => (d.vp ?? 0) > 0)!;
    const p = g.players[0];
    const before = publicVP(g, reg, p);
    p.devCards.push(vpCard.id);
    expect(publicVP(g, reg, p)).toBe(before);
    expect(score(g, reg, p, true)).toBe(before + (vpCard.vp ?? 0));
  });

  it('produced mode ranks by resources produced', () => {
    const g = newGame({ scoreMode: 'produced', vpToWin: 5 });
    g.players[1].stats.resProduced = 4;
    expect(score(g, reg, g.players[1])).toBe(4);
    expect(score(g, reg, g.players[0])).toBe(0);
  });
});

describe('checkWinner goes through score()', () => {
  it('ends the game when the score reaches the target in produced mode', () => {
    const g = newGame({ scoreMode: 'produced', vpToWin: 5 });
    expect(checkWinner(makeCtx(g, reg))).toBe(false);
    g.players[1].stats.resProduced = 5;
    expect(checkWinner(makeCtx(g, reg))).toBe(true);
    expect(g.winner?.id).toBe('b');
    expect(g.phase).toBe('gameover');
  });

  it('ignores resources produced in the default vp mode', () => {
    const g = newGame();
    g.players[0].stats.resProduced = 99;
    expect(checkWinner(makeCtx(g, reg))).toBe(false);
  });
});
