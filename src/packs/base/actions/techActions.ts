// MODULE: actions "upgrade_port" (Tidebound Harbor charters: raise a whole port 3:1 to 2:1) and "convert_tile" (Wild Earth Ground work) | DEPENDS ON: packs/base/constants, packs/base/techEffects, shared/index | USED BY: packs/base/actions/index
import { canAfford, getPlayer, hasTech, payToBank, priceOfUpgrade } from '../../../shared';
import type { ActionDef } from '../../../shared';
import { CITY, GENERIC_PORT, SETTLEMENT } from '../constants';
import {
  basicTileIds,
  groundWorkSourceError,
  groundWorkUsed,
  HARBOR_UPGRADE_COST,
  PORT_UPGRADE_ID,
  portLevel,
  rollTileNumber,
  TECH_GROUND_WORK,
  TECH_HARBOR_CHARTERS
} from '../techEffects';

/**
 * Harbor charters (Raise the Port): a city (or settlement when `tidebound.fishing_nets` is owned) on a 3:1 port
 * becomes a 2:1 port for every resource. It stays an 'any resource' port.
 * The port id on the vertex does not change; the upgrade is stored in `g.ext.core.portUpgrades[vertexId]`
 * as `{ level: 1, by }` (level = step on the port ladder) and read by the trade ratio modifier in `techEffects.ts`.
 * The payload is just `{ vertexId }`: there is no resource choice.
 */
export const upgradePortAction: ActionDef = {
  type: 'upgrade_port',
  validate(ctx, pid, payload) {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid);
    if (!p) return 'Unknown player';
    if (!hasTech(g, pid, TECH_HARBOR_CHARTERS)) return 'Research Harbor charters first';
    const v = Number.isInteger(payload?.vertexId) ? g.board.vertices[payload.vertexId] : undefined;
    if (!v) return 'Choose a harbor city';
    const allowSettlement = hasTech(g, pid, 'tidebound.fishing_nets');
    if (
      !v.piece ||
      v.piece.owner !== pid ||
      (v.piece.type !== CITY && !(allowSettlement && v.piece.type === SETTLEMENT))
    ) {
      return allowSettlement
        ? 'A harbor upgrade needs your own settlement or city'
        : 'A harbor upgrade needs your own city';
    }
    if (v.port !== GENERIC_PORT) return 'Only a 3:1 port can be upgraded';
    if (portLevel(g, v.id) >= 1) return 'That port is already upgraded';
    if (!canAfford(p, priceOfUpgrade(g, reg, p, PORT_UPGRADE_ID, HARBOR_UPGRADE_COST))) return 'Not enough resources for a port upgrade';
    return null;
  },
  apply(ctx, pid, payload) {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid)!;
    payToBank(ctx, p, priceOfUpgrade(g, reg, p, PORT_UPGRADE_ID, HARBOR_UPGRADE_COST));
    g.ext = g.ext || {};
    g.ext.core = g.ext.core || {};
    g.ext.core.portUpgrades = g.ext.core.portUpgrades || {};
    g.ext.core.portUpgrades[payload.vertexId] = { level: 1, by: pid };
    p.stats.portsUpgraded = (p.stats.portsUpgraded || 0) + 1;
    ctx.emit('portUpgraded', { playerId: pid, vertexId: payload.vertexId, level: 1 });
    ctx.log(`⚓ ${p.avatar} ${p.name} raised a port: it now trades every resource 2:1`, p.color);
  },
  /** Nothing without the tech. The engine filters the rest through validate. */
  legal(ctx, pid) {
    const { g } = ctx;
    if (!hasTech(g, pid, TECH_HARBOR_CHARTERS)) return [];
    const allowSettlement = hasTech(g, pid, 'tidebound.fishing_nets');
    const out: { vertexId: number }[] = [];
    for (const v of g.board.vertices) {
      if (v.piece?.owner !== pid || v.port !== GENERIC_PORT) continue;
      if (v.piece.type !== CITY && !(allowSettlement && v.piece.type === SETTLEMENT)) continue;
      out.push({ vertexId: v.id });
    }
    return out;
  }
};

/**
 * Ground work: once per player, turn a land tile that touches your own settlement or city into a basic resource tile.
 * The number token stays; a tile with no number (desert) gets one rolled from the game RNG (two dice, never 7).
 */
export const convertTileAction: ActionDef = {
  type: 'convert_tile',
  validate(ctx, pid, payload) {
    const { g, reg } = ctx;
    if (!getPlayer(g, pid)) return 'Unknown player';
    if (!hasTech(g, pid, TECH_GROUND_WORK)) return 'Research Ground work first';
    if (groundWorkUsed(g, pid)) return 'Ground work has already been used';
    const sourceError = groundWorkSourceError(g, reg, pid, payload?.hexId);
    if (sourceError) return sourceError;
    const target = String(payload?.resource ?? '');
    if (!basicTileIds(reg).includes(target)) return 'Choose a basic resource tile';
    if (g.board.hexes[payload.hexId].type === target) return 'That tile is already that type';
    return null;
  },
  apply(ctx, pid, payload) {
    const { g } = ctx;
    const p = getPlayer(g, pid)!;
    const hex = g.board.hexes[payload.hexId];
    const from = hex.type;
    const to = String(payload.resource);
    const rolled = hex.number === null || hex.number === undefined;
    const number = rolled ? rollTileNumber(g) : hex.number;
    hex.type = to;
    hex.number = number;
    g.ext = g.ext || {};
    g.ext.core = g.ext.core || {};
    g.ext.core.groundWork = g.ext.core.groundWork || {};
    g.ext.core.groundWork[pid] = { hexId: hex.id, from, to, number };
    p.stats.groundWork = 1;
    ctx.emit('tileConverted', { playerId: pid, hexId: hex.id, from, to, number, rolled });
    ctx.log(
      `🌱 ${p.avatar} ${p.name} turned a ${from} tile into ${to}${rolled ? ` (rolled a ${number})` : ` (keeps its ${number})`}`,
      p.color
    );
  },
  /** Nothing without the tech, or after the one use. */
  legal(ctx, pid) {
    const { g, reg } = ctx;
    if (!hasTech(g, pid, TECH_GROUND_WORK) || groundWorkUsed(g, pid)) return [];
    const out: { hexId: number; resource: string }[] = [];
    for (const hex of g.board.hexes) {
      if (groundWorkSourceError(g, reg, pid, hex.id) !== null) continue;
      for (const resource of basicTileIds(reg)) out.push({ hexId: hex.id, resource });
    }
    return out;
  }
};
