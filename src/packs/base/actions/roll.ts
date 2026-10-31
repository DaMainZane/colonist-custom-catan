// MODULE: action "roll" (seeded dice, production, seven -> Seven Resolver pipeline) | DEPENDS ON: shared/index | USED BY: packs/base/actions/index
import { getPlayer, produceFromHex, resolveSeven, rngInt, setPhase } from '../../../shared';
import type { ActionDef, Ctx, Hex } from '../../../shared';

function matchingHexes(ctx: Ctx, sum: number): Hex[] {
  const { g, reg } = ctx;
  return g.board.hexes.filter(
    h => !h.ext.hidden && h.number === sum && h.id !== g.board.robberHexId && reg.tiles.get(h.type)?.land
  );
}

function produce(ctx: Ctx, hexes: Hex[]): void {
  const { g, reg } = ctx;
  for (const hex of hexes) {
    for (const vId of hex.vertexIds) {
      const piece = g.board.vertices[vId]?.piece;
      if (!piece) continue;
      const amount = reg.pieces.get(piece.type)?.produces || 0;
      if (amount > 0) produceFromHex(ctx, hex, piece.owner, amount);
    }
  }
}

function handleSeven(ctx: Ctx): void {
  resolveSeven(ctx);
}

function rollFairDice(g: Ctx['g']): [number, number] {
  const baseExt = (g.ext.base ??= {});
  let deck: [number, number][] | undefined = baseExt.fairDiceDeck;
  if (!Array.isArray(deck) || deck.length <= 6) {
    deck = [];
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        deck.push([a, b]);
      }
    }
    for (let i = deck.length - 1; i > 0; i--) {
      const j = rngInt(g.rng, i + 1);
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    baseExt.fairDiceDeck = deck;
  }
  return deck.pop()!;
}

export const rollAction: ActionDef = {
  type: 'roll',
  validate: () => null,
  apply(ctx, pid) {
    const { g } = ctx;
    const p = getPlayer(g, pid)!;
    const [d1, d2] = g.rules?.fairDice
      ? rollFairDice(g)
      : [rngInt(g.rng, 6) + 1, rngInt(g.rng, 6) + 1];
    const sum = d1 + d2;
    g.dice = [d1, d2];
    g.diceStats[sum] = (g.diceStats[sum] || 0) + 1;
    ctx.log(`${p.avatar} ${p.name} rolled ${sum} (${d1} + ${d2})`, p.color);
    for (const hook of ctx.reg.hooks.onRoll) hook(ctx, sum);

    const hexes = sum === 7 ? [] : matchingHexes(ctx, sum);
    ctx.emit('rolled', { playerId: pid, dice: [d1, d2], sum, hexIds: hexes.map(h => h.id) });

    if (sum === 7) {
      handleSeven(ctx);
    } else {
      produce(ctx, hexes);
      setPhase(ctx, 'main');
    }
  },
  legal: () => [{}]
};
