// MODULE: registry + pack loader (all game content is registered here) | USED BY: engine, packs, UI generation, bots
import type { Ctx } from './ctx';
import type { RngState } from './rng';
import type { GameState, Id, Resources, Rules } from './types';

export interface ResourceDef { id: string; name: string; color: string; border: string; icon?: string; replace?: boolean }

export interface TileDef {
  id: string;
  name: string;
  color: string;
  border: string;
  icon?: string;
  /** false = water. */
  land: boolean;
  /** Gets a number token. */
  numbered: boolean;
  /** Resource produced on a matching roll (default behaviour). */
  produces?: string;
  /** true = fills the board cyclically after special tiles (rules.tileCounts) are placed. */
  base?: boolean;
  /** Overrides default production, e.g. gold gives picks instead of cards. */
  onProduce?(ctx: Ctx, hex: any, ownerId: Id, amount: number): void;
  replace?: boolean;
}

export interface PieceDef {
  id: string;
  name: string;
  target: 'vertex' | 'edge';
  cost: Resources;
  vp: number;
  /** Production multiplier for adjacent hexes (settlement 1, city 2, road 0). */
  produces: number;
  /** Replaces this piece type when built (city upgrades settlement). */
  upgradeFrom?: string;
  icon?: string;
  /** Placement rule only (geometry/ownership). Cost and supply are checked by the build action. */
  canPlace(ctx: Ctx, pid: Id, loc: number, mode: 'setup' | 'build'): boolean;
  replace?: boolean;
}

export interface DevCardDef {
  id: string;
  name: string;
  icon?: string;
  playable: boolean;
  /** Victory points counted while held (hidden until game over). */
  vp?: number;
  validate?(ctx: Ctx, pid: Id, payload: any): string | null;
  play?(ctx: Ctx, pid: Id, payload: any): void;
  /** Candidate extra payload fields for bots (e.g. one {resource} per resource for Monopoly). Default: [{}]. Must not use the RNG. */
  legal?(ctx: Ctx, pid: Id): any[];
  replace?: boolean;
}

export interface AwardDef {
  id: string;
  name: string;
  vp: number;
  /** Minimum metric value to hold the award. */
  min: number;
  metric(ctx: Ctx, player: any): number;
  /** Action types after which the metric is recomputed (default: all). */
  recomputeOn?: string[];
  replace?: boolean;
}

export interface PhaseDef {
  id: string;
  label: string;
  /** Action types allowed in this phase. */
  actions: string[];
  /** Who may act (default: the player whose turn it is). */
  actor?(g: GameState, pid: Id): boolean;
  /** Should be safe to run again (it also runs when returning to the phase). */
  onEnter?(ctx: Ctx): void;
  onExit?(ctx: Ctx): void;
  replace?: boolean;
}

export interface ActionDef {
  type: string;
  /** Overrides the phase's actor rule (e.g. trade responses come from other players). */
  actor?(g: GameState, pid: Id): boolean;
  validate(ctx: Ctx, pid: Id, payload: any): string | null;
  apply(ctx: Ctx, pid: Id, payload: any): void;
  /** Candidate payloads for bots/fuzz tests. The engine filters them through validate. */
  legal?(ctx: Ctx, pid: Id): any[];
  replace?: boolean;
}

export interface PortDef {
  id: string;
  name: string;
  ratio: number;
  /** null = works for any resource. */
  resource: string | null;
  /** How many of this port are generated on a board (default 1). */
  copies?: number;
  replace?: boolean;
}

export interface PresetDef {
  id: string;
  label: string;
  blank?: boolean;
  waterChance?: number;
  tileCounts?(rules: Rules, totalHexes: number): Record<string, number>;
  /** Extra generation data handed to afterMapGenerated hooks (e.g. fogCount). */
  extra?(rules: Rules, totalHexes: number): Record<string, any>;
  replace?: boolean;
}

export type HookName =
  | 'onGameStart'        // (ctx)
  | 'onTurnStart'        // (ctx)
  | 'onTurnEnd'          // (ctx)
  | 'onRoll'             // (ctx, sum)
  | 'onBuild'            // (ctx, pieceDef, playerId, location)
  | 'afterAction'        // (ctx, actionType)
  | 'vp'                 // (g, reg, player, includeHidden) => number
  | 'afterMapGenerated'  // (hexInits, rules, rng, extra)
  | 'onView';            // (g, reg, viewerId, view)

export interface Registry {
  packs: string[];
  rules: Rules;
  resources: Map<string, ResourceDef>;
  tiles: Map<string, TileDef>;
  pieces: Map<string, PieceDef>;
  devcards: Map<string, DevCardDef>;
  awards: Map<string, AwardDef>;
  phases: Map<string, PhaseDef>;
  actions: Map<string, ActionDef>;
  ports: Map<string, PortDef>;
  presets: Map<string, PresetDef>;
  hooks: Record<HookName, ((...args: any[]) => any)[]>;
}

export interface PackApi {
  resource(def: ResourceDef): void;
  tile(def: TileDef): void;
  piece(def: PieceDef): void;
  devcard(def: DevCardDef): void;
  award(def: AwardDef): void;
  phase(def: PhaseDef): void;
  action(def: ActionDef): void;
  port(def: PortDef): void;
  preset(def: PresetDef): void;
  hook(name: HookName, fn: (...args: any[]) => any): void;
}

export interface Pack {
  id: string;
  name: string;
  /** Packs that must be loaded before this one. */
  deps?: string[];
  /** Default rule parameters, deep-merged in load order. */
  rules?: Record<string, any>;
  register(api: PackApi): void;
}

function isPlain(v: any): boolean {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Deep-merges plain objects; arrays and scalars are replaced. */
export function mergeRules(base: any, extra: Record<string, any>): Rules {
  const out: any = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = isPlain(v) && isPlain(out[k]) ? mergeRules(out[k], v) : v;
  }
  return out as Rules;
}

function put<T>(map: Map<string, T>, key: string, def: T, kind: string, packId: string): void {
  if (map.has(key) && !(def as any).replace) {
    throw new Error(`Pack "${packId}": duplicate ${kind} "${key}" (set replace: true to override)`);
  }
  map.set(key, def);
}

export function createRegistry(packs: Pack[], overrides: Record<string, any> = {}): Registry {
  const reg: Registry = {
    packs: [],
    rules: {} as Rules,
    resources: new Map(),
    tiles: new Map(),
    pieces: new Map(),
    devcards: new Map(),
    awards: new Map(),
    phases: new Map(),
    actions: new Map(),
    ports: new Map(),
    presets: new Map(),
    hooks: {
      onGameStart: [], onTurnStart: [], onTurnEnd: [], onRoll: [], onBuild: [],
      afterAction: [], vp: [], afterMapGenerated: [], onView: []
    }
  };

  const loaded = new Set<string>();
  for (const pack of packs) {
    if (loaded.has(pack.id)) throw new Error(`Pack "${pack.id}" listed twice`);
    for (const dep of pack.deps ?? []) {
      if (!loaded.has(dep)) throw new Error(`Pack "${pack.id}" needs "${dep}" loaded first`);
    }
    const id = pack.id;
    const api: PackApi = {
      resource: d => put(reg.resources, d.id, d, 'resource', id),
      tile: d => put(reg.tiles, d.id, d, 'tile', id),
      piece: d => put(reg.pieces, d.id, d, 'piece', id),
      devcard: d => put(reg.devcards, d.id, d, 'devcard', id),
      award: d => put(reg.awards, d.id, d, 'award', id),
      phase: d => put(reg.phases, d.id, d, 'phase', id),
      action: d => put(reg.actions, d.type, d, 'action', id),
      port: d => put(reg.ports, d.id, d, 'port', id),
      preset: d => put(reg.presets, d.id, d, 'preset', id),
      hook: (name, fn) => {
        if (!reg.hooks[name]) throw new Error(`Pack "${id}": unknown hook "${name}"`);
        reg.hooks[name].push(fn);
      }
    };
    pack.register(api);
    if (pack.rules) reg.rules = mergeRules(reg.rules, pack.rules);
    loaded.add(id);
    reg.packs.push(id);
  }
  reg.rules = mergeRules(reg.rules, overrides);

  for (const phase of reg.phases.values()) {
    for (const t of phase.actions) {
      if (!reg.actions.has(t)) throw new Error(`Phase "${phase.id}" lists unknown action "${t}"`);
    }
  }
  return reg;
}

export type { RngState };
