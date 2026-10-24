// MODULE: robber helpers (victims on a hex, random steal using the seeded RNG) | USED BY: actions/robber
import { getPlayer, rngInt } from '../../shared';
import type { Ctx, GameState, Id } from '../../shared';

/** Other players with a piece on a corner of the hex. */
export function victimsOnHex(g: GameState, hexId: number, thiefId: Id): Id[] {
  const hex = g.board.hexes[hexId];
  const out = new Set<Id>();
  for (const vId of hex?.vertexIds ?? []) {
    const pc = g.board.vertices[vId]?.piece;
    if (pc && pc.owner !== thiefId) out.add(pc.owner);
  }
  return [...out];
}

export function stealOne(ctx: Ctx, thiefId: Id, victimId: Id): void {
  const { g, reg } = ctx;
  const thief = getPlayer(g, thiefId)!;
  const victim = getPlayer(g, victimId)!;

  const pool: string[] = [];
  for (const r of reg.resources.keys()) {
    for (let i = 0; i < (victim.resources[r] || 0); i++) pool.push(r);
  }
  if (pool.length === 0) {
    ctx.log(`${thief.avatar} ${thief.name} robbed ${victim.name}, but they had no cards!`, thief.color);
    return;
  }
  const stolen = pool[rngInt(g.rng, pool.length)];
  victim.resources[stolen]--;
  thief.resources[stolen] = (thief.resources[stolen] || 0) + 1;
  ctx.emit('transferred', { from: victim.id, to: thief.id, resource: stolen, amount: 1, kind: 'steal', secret: true });
  ctx.log(`${thief.avatar} ${thief.name} stole 1 resource from ${victim.name}`, thief.color);
}
