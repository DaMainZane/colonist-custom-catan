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
  // Default is 0: plain games have no gold. Gold Rush (preset) or the lobby setting adds it.
  rules: { tileCounts: { gold: 0 } },
  register(api) {
    api.tile({
      id: 'gold',
      name: 'Gold',
      color: '#ffd54f',
      border: '#c9a227',
      land: true,
      numbered: true,
      // Mountain gold: just below the ore, so the realistic style puts it next to the mountains.
      habitat: { h: 0.85, weight: 2 },
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

    // The same thing as a menu perk. A nonzero gold count on the Rules tab wins over this one (mapgen applies that rule).
    api.mapPerk({
      id: 'gold',
      label: 'Gold',
      description: 'A third of the tiles are gold (at least 5): production gives a free pick.',
      stage: 'extras',
      tileCounts: (_rules, total) => ({ gold: goldRushCount(total) })
    });
    api.quickStart({ id: 'goldRush', label: 'Gold Rush', picks: ['gold'] });
    // Gold sits next to the mountains on one natural landmass.
    api.quickStart({ id: 'mountainGold', label: 'Mountain gold', picks: ['continent', 'realistic', 'gold'] });
    api.quickStart({ id: 'goldIslands', label: 'Gold islands', picks: ['islands', 'gold', 'island_mix'] });
  }
};
