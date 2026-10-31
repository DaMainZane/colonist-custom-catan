// MODULE: fog pack (hidden tiles, revealed by building next to them, Fog Island preset) | DEPENDS ON: packs/base/constants, shared/index | USED BY: packs/index
import { getPlayer, produceFromHex, rngShuffle } from '../../shared';
import type { Ctx, HexInit, Id, Pack } from '../../shared';
import { ROAD } from '../base/constants';

/** Fog Island: about 42% of the board is hidden, at least 4 tiles (same as the original game). */
export function fogIslandCount(total: number): number {
  return Math.max(4, Math.floor(total * 0.42));
}

/** Hides the tile identity: `views.ts` masks hexes with ext.hidden, and all production/robber code skips them. */
function hideTiles(inits: HexInit[], rules: any, rng: any, extra: Record<string, any>): void {
  const want = Math.floor(Number(extra.fogCount ?? rules.fogTiles ?? 0)) || 0;
  if (want <= 0) return;
  // A numbered land tile is the only kind that can hide (never water or desert).
  const candidates = inits.filter(h => h.number !== null);
  const shuffled = rngShuffle(rng, candidates);
  const count = Math.min(want, shuffled.length);
  for (let i = 0; i < count; i++) {
    const h = shuffled[i];
    h.ext = { ...(h.ext ?? {}), hidden: true, maskAs: 'fog' };
  }
}

/** Reveals every hidden tile touched by the new piece (its edge, and the tiles around both endpoints). */
function revealAround(ctx: Ctx, pid: Id, edgeId: number): void {
  const { g, reg } = ctx;
  const edge = g.board.edges[edgeId];
  const p = getPlayer(g, pid);
  if (!edge || !p) return;

  const touched = new Set<number>([
    ...edge.hexIds,
    ...(g.board.vertices[edge.v1]?.hexIds ?? []),
    ...(g.board.vertices[edge.v2]?.hexIds ?? [])
  ]);

  for (const hexId of [...touched].sort((a, b) => a - b)) {
    const hex = g.board.hexes[hexId];
    if (!hex || !hex.ext.hidden) continue;
    delete hex.ext.hidden;
    delete hex.ext.maskAs;

    const tile = reg.tiles.get(hex.type);
    const numberText = hex.number !== null ? ` (${hex.number})` : '';
    ctx.emit('revealed', { hexId: hex.id, playerId: pid, type: hex.type, number: hex.number });
    ctx.log(`🌫️ ${p.avatar} ${p.name} revealed ${(tile?.name ?? hex.type).toUpperCase()}${numberText} from Fog!`, p.color);

    // The reveal pays one production, the same path as a dice roll: a resource tile gives a card,
    // gold adds a pick, anything else is inert. No tile-specific code here.
    const before = p.stats.earned || 0;
    produceFromHex(ctx, hex, pid, 1);
    const got = (p.stats.earned || 0) - before;
    if (got > 0 && tile?.produces) ctx.log(`${p.avatar} ${p.name} +${got} ${tile.produces}`, p.color);
  }
}

export const fogPack: Pack = {
  id: 'fog',
  name: 'Fog',
  deps: ['base'],
  rules: {
    /** Hidden tiles on a normal board (0 = off). The Fog Island preset overrides this. */
    fogTiles: 0,
    /** Piece ids that reveal fog when built. */
    fogRevealBy: [ROAD]
  },
  register(api) {
    // Only what players see of a hidden tile (views.ts masks it with this type).
    api.tile({ id: 'fog', name: 'Fog', color: '#b0bec5', border: '#78909c', land: true, numbered: false });

    api.preset({
      id: 'fogIsland',
      label: 'Fog Island',
      extra: (_rules, total) => ({ fogCount: fogIslandCount(total) })
    });

    // The same thing as a menu perk. A nonzero fogTiles on the Rules tab wins over the computed share.
    api.mapPerk({
      id: 'fog',
      label: 'Fog',
      description: 'About 42% of the tiles (at least 4) stay hidden until a road touches them.',
      stage: 'extras',
      // The seed and share code reveal the hidden tiles to anyone who rebuilds the map (accepted for a private group).
      secret: true,
      extra: (rules, total) => {
        const typed = Math.floor(Number(rules.fogTiles) || 0);
        return { fogCount: typed > 0 ? typed : fogIslandCount(total) };
      }
    });
    api.quickStart({ id: 'fogIsland', label: 'Fog Island', picks: ['fog'] });
    api.quickStart({ id: 'fogRing', label: 'Fog ring', picks: ['ring', 'fog'] });
    api.quickStart({ id: 'fogContinents', label: 'Fog continents', picks: ['continents', 'fog'] });

    api.hook('afterMapGenerated', hideTiles);

    api.hook('onBuild', (ctx: Ctx, def, pid: Id, loc: number) => {
      const by: string[] = ctx.g.rules.fogRevealBy ?? [ROAD];
      if (def.target === 'edge' && by.includes(def.id)) revealAround(ctx, pid, loc);
    });
  }
};
