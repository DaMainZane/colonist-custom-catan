// MODULE: action "roll" (seeded dice, production, seven -> discard + robber) | USED BY: packs/base/actions/index
import { getPlayer, produceFromHex, pushPhase, rngInt, setPhase, totalCards } from '../../../shared';
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
  const { g } = ctx;
  // After the robber (and any discards) the game returns to the main phase.
  g.phaseStack.push('main');
  setPhase(ctx, 'robber');

  let anyDiscard = false;
  for (const p of g.players) {
    const total = totalCards(p);
    if (total > g.rules.discardLimit) {
      p.pending.discard = Math.floor(total / 2);
      anyDiscard = true;
    }
  }
  if (anyDiscard) pushPhase(ctx, 'discard');
}

export const rollAction: ActionDef = {
  type: 'roll',
  validate: () => null,
  apply(ctx, pid) {
    const { g } = ctx;
    const p = getPlayer(g, pid)!;
    const d1 = rngInt(g.rng, 6) + 1;
    const d2 = rngInt(g.rng, 6) + 1;
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
