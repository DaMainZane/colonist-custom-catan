// MODULE: gold pack (gold tile = pick-a-resource on production, Gold Rush preset) | USED BY: server, sims, tests, packs/fog (reveals use it)
import { getPlayer } from '../../shared';
import type { Pack } from '../../shared';

/** Gold Rush: a third of the board is gold, at least 5 tiles (same as the original game). */
export function goldRushCount(total: number): number {
  return Math.max(5, Math.floor(total / 3));
}

export const goldPack: Pack = {
  id: 'gold',
  name: 'Gold',
  deps: ['base'],
  // Deep-merged into base's tileCounts, so the board gets 2 gold tiles next to the 1 desert.
  rules: { tileCounts: { gold: 2 } },
  register(api) {
    api.tile({
      id: 'gold',
      name: 'Gold',
      color: '#ffd54f',
      border: '#c9a227',
      land: true,
      numbered: true,
      // No `produces`: gold never pays cards directly. It adds picks, and the base pack's
      // settlePicks (afterAction) opens the `pick` phase for whoever has pending.pick > 0.
      onProduce(ctx, hex, ownerId, amount) {
        const p = getPlayer(ctx.g, ownerId);
        if (!p || amount <= 0) return;
        p.pending.pick = (p.pending.pick || 0) + amount;
        ctx.emit('goldEarned', { hexId: hex.id, playerId: ownerId, amount });
        ctx.log(`${p.avatar} ${p.name} earned ${amount} Gold pick(s)!`, p.color);
      }
    });

    api.preset({
      id: 'goldRush',
      label: 'Gold Rush',
      tileCounts: (_rules, total) => ({ gold: goldRushCount(total) })
    });
  }
};
