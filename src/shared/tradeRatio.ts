// MODULE: trade ratio service (ratioFor with ordered modifier chain, 2:1 floor, gem-port floor exemption, invalid-ratio advice) | USED BY: packs/base/trading, DLC packs, client, bots
import { defsOf } from './registry';
import type { Registry } from './registry';
import type { GameState, Id } from './types';

/**
 * S0.5 Trade ratio function (service 5: `trade-ratio`):
 *  - Starts from `g.rules.bankRatio` (default 4).
 *  - Applies ports on vertices owned by the player (3:1 generic or 2:1 resource-specific; gem ports with `exemptFloor: true` can go down to 1:1).
 *  - Runs registered modifiers in `RATIO_MODS` in ascending `order` (ports = 10, harbor = 20, market = 30, tech = 40, war weariness = 80).
 *  - Enforces a hard `MIN_TRADE_RATIO` (2:1) floor unless `exemptFloor` is set (gem ports).
 */
export const RATIO_MODS = 'tradeRatioMods';
export const MIN_TRADE_RATIO = 2;

export const RATIO_MOD_ORDER = {
  ports: 10,
  harbor: 20,
  market: 30,
  tech: 40,
  sheepEconomy: 50,
  embassy: 60,
  warWeariness: 80
} as const;

export interface RatioModifierResult {
  ratio: number;
  exemptFloor?: boolean;
  reason?: string;
}

export interface RatioModifier {
  id: string;
  order?: number;
  exemptFloor?: boolean;
  apply(
    g: GameState,
    reg: Registry,
    pid: Id,
    resource: string,
    current: number
  ): number | RatioModifierResult;
  replace?: boolean;
}

/** Evaluates a player's bank trade ratio for one resource, applying ports, ordered modifiers, and the 2:1 floor (unless exempt). */
export function ratioFor(g: GameState, reg: Registry, pid: Id, resource: string): number {
  let ratio = Number(g.rules?.bankRatio) || 4;
  let exemptFloor = false;

  // 1. Owned ports on the board (plus any embassy-shared ports if registered via modifiers)
  for (const v of g.board.vertices) {
    if (!v.piece || v.piece.owner !== pid || !v.port) continue;
    const port = reg.ports.get(v.port);
    if (!port) continue;
    if (port.resource === null || port.resource === resource) {
      ratio = Math.min(ratio, port.ratio);
      if ((port as any).exemptFloor) exemptFloor = true;
    }
  }

  // 2. Ordered modifier chain (harbor, market, tech, war weariness, event modifiers...)
  const mods = [...defsOf<RatioModifier>(reg, RATIO_MODS).values()].sort(
    (a, b) => (a.order ?? 100) - (b.order ?? 100)
  );
  for (const mod of mods) {
    const res = mod.apply(g, reg, pid, resource, ratio);
    if (typeof res === 'number') {
      ratio = res;
      if (mod.exemptFloor) exemptFloor = true;
    } else if (res && typeof res === 'object') {
      ratio = res.ratio;
      if (res.exemptFloor || mod.exemptFloor) exemptFloor = true;
    }
  }

  const floor = exemptFloor ? 1 : MIN_TRADE_RATIO;
  return Math.max(floor, Math.round(ratio));
}

/** Bank ratio per registered resource for a player. `tradeRatios` in base/trading wraps this. */
export function tradeRatiosFor(g: GameState, reg: Registry, pid: Id): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of reg.resources.keys()) {
    out[r] = ratioFor(g, reg, pid, r);
  }
  return out;
}

/** Explains why a proposed bank trade ratio is invalid, or returns null when valid. Used by bankTrade and UI prompts. */
export function explainInvalidBankRatio(
  g: GameState,
  reg: Registry,
  pid: Id,
  give: Record<string, number>,
  get: Record<string, number>
): { ok: boolean; reason: string | null; credits: number; wanted: number; ratios: Record<string, number> } {
  const ratios = tradeRatiosFor(g, reg, pid);
  let credits = 0;
  for (const [r, n] of Object.entries(give)) {
    if (!n || n <= 0) continue;
    const rate = ratios[r] ?? (Number(g.rules?.bankRatio) || 4);
    if (n % rate !== 0) {
      return {
        ok: false,
        reason: `Bank trade requires ${rate}:1 for ${r.toUpperCase()}! Use Player Trade to offer custom amounts.`,
        credits,
        wanted: Object.values(get).reduce((a, b) => a + (b || 0), 0),
        ratios
      };
    }
    credits += n / rate;
  }
  const wanted = Object.values(get).reduce((a, b) => a + (b || 0), 0);
  if (credits <= 0 || credits !== wanted) {
    return {
      ok: false,
      reason: `Bank trade mismatch: your offered cards equal ${credits} resource(s), but you selected ${wanted} wanted card(s).`,
      credits,
      wanted,
      ratios
    };
  }
  return { ok: true, reason: null, credits, wanted, ratios };
}
