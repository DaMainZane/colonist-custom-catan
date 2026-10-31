// MODULE: base number styles (balanced; `standard` lives in index.ts) | DEPENDS ON: shared/index | USED BY: packs/base/map/index
import { cellPoint, dealBalanced, dealByRichness, rankNormalize, settleNumbers } from '../../../shared';
import type { PackApi } from '../../../shared';

export function registerNumberStyles(api: PackApi): void {
  api.mapNumbers({
    id: 'feast_famine',
    label: 'Feast or famine',
    description: 'Zones of rich tiles and zones of poor tiles. Red numbers may touch.',
    stage: 'numbers',
    slot: 'numbers',
    // Hot clusters are the point, so the 6/8 rule is off while this style is active. Rich and poor zones are on purpose too,
    // so the weak-resource warning is off.
    ruleOverrides: { hotTouch: 'allow', balanceCheck: false },
    params: [{ id: 'feast_famine.mix', label: 'Soft edges (%)', min: 0, max: 100, step: 5, default: 25 }],
    place: (cells, pool, ctx) => {
      // A smooth, low-frequency field over the numbered tiles, ranked 0..1: the richness of each tile.
      const freq = 1 / (0.4 * ctx.radius + 2);
      const raw = cells.map(c => {
        const p = cellPoint(c.q, c.r);
        return ctx.noise(p.x * freq + 11.7, p.y * freq + 29.3, 2);
      });
      return dealByRichness(rankNormalize(raw), pool, ctx.param('feast_famine.mix') / 100, ctx.rng);
    }
  });

  api.mapNumbers({
    id: 'balanced',
    label: 'Balanced',
    description: 'Every resource gets about the same total pips. Gold counts as its own group.',
    stage: 'numbers',
    slot: 'numbers',
    // Balanced by design: the weak-resource warning has nothing to say.
    ruleOverrides: { balanceCheck: false },
    place: (cells, pool, ctx) => {
      // A group is a resource (tiles that produce the same card); a tile with no resource, like gold, is its own group.
      const ids = new Map<string, number>();
      const group = cells.map(c => {
        const type = c.type ?? '';
        const key = ctx.reg.tiles.get(type)?.produces ?? type;
        if (!ids.has(key)) ids.set(key, ids.size);
        return ids.get(key)!;
      });
      const dealt = dealBalanced(group, ids.size, pool, ctx.rng);
      // Touching reds are fixed by swapping inside a group only, so the totals hold.
      return settleNumbers(cells, dealt, ctx.rng, { hotTouch: ctx.flags.hotTouch, equalTouch: ctx.flags.equalTouch, group });
    }
  });
}
