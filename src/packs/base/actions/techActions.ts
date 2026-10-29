// MODULE: actions "upgrade_port" (Tidebound Harbor charters) and "convert_tile" (Wild Earth Ground work) | USED BY: packs/base/actions/index
import { canAfford, getPlayer, hasTech, payToBank, ratioFor } from '../../../shared';
import type { ActionDef } from '../../../shared';
import { CITY, GENERIC_PORT } from '../constants';
import {
  basicTileIds,
  groundWorkSourceError,
  groundWorkUsed,
  HARBOR_UPGRADE_COST,
  portLevel,
  rollTileNumber,
  TECH_GROUND_WORK,
  TECH_HARBOR_CHARTERS
} from '../techEffects';

/**
 * Harbor charters: a city on a 3:1 port becomes a 2:1 port for one resource of the player's choice.
 * The port id on the vertex does not change; the upgrade is stored in `g.ext.core.portUpgrades[vertexId]`
 * as `{ level: 1, resource, by }` (level = step on the port ladder) and read by the trade ratio modifier in `techEffects.ts`.
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
    if (!v.piece || v.piece.owner !== pid || v.piece.type !== CITY) return 'A harbor upgrade needs your own city';
    if (v.port !== GENERIC_PORT) return 'Only a 3:1 port can be upgraded';
    if (portLevel(g, v.id) >= 1) return 'That port is already upgraded';
    const resource = String(payload?.resource ?? '');
    if (!reg.resources.has(resource)) return 'Choose a resource for the 2:1 port';
    if (ratioFor(g, reg, pid, resource) <= 2) return `You already trade ${resource} at 2:1`;
    if (!canAfford(p, HARBOR_UPGRADE_COST)) return 'Not enough resources for a harbor upgrade (2 wood, 1 brick, 1 ore)';
    return null;
  },
  apply(ctx, pid, payload) {
    const { g } = ctx;
    const p = getPlayer(g, pid)!;
    const resource = String(payload.resource);
    payToBank(ctx, p, HARBOR_UPGRADE_COST);
    g.ext = g.ext || {};
    g.ext.core = g.ext.core || {};
    g.ext.core.portUpgrades = g.ext.core.portUpgrades || {};
    g.ext.core.portUpgrades[payload.vertexId] = { level: 1, resource, by: pid };
    p.stats.portsUpgraded = (p.stats.portsUpgraded || 0) + 1;
    ctx.emit('portUpgraded', { playerId: pid, vertexId: payload.vertexId, resource });
    ctx.log(`⚓ ${p.avatar} ${p.name} upgraded a harbor: ${resource} now trades 2:1`, p.color);
  },
  /** Nothing without the tech. The engine filters the rest through validate. */
  legal(ctx, pid) {
    const { g, reg } = ctx;
    if (!hasTech(g, pid, TECH_HARBOR_CHARTERS)) return [];
    const out: { vertexId: number; resource: string }[] = [];
    for (const v of g.board.vertices) {
      if (v.piece?.owner !== pid || v.piece.type !== CITY || v.port !== GENERIC_PORT) continue;
      for (const resource of reg.resources.keys()) out.push({ vertexId: v.id, resource });
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
