// MODULE: DLC and addon manifest (types, General service ids, enabled-set resolution, link audit) | USED BY: registry, lobby, tests
import { createRegistry } from './registry';
import type { PackApi, Pack, Registry } from './registry';

/**
 * How a DLC is built (Ideas.md, Integration Layer):
 *  - A DLC is a pack with `deps: ['base']` and a non-empty `addons` list. Addons are the toggles inside it.
 *  - Rules: `rules.dlc[packId] === true` turns the DLC on (the master switch). Inside an enabled DLC every addon is on
 *    unless `rules.addons[addonId] === false`. With the DLC off, nothing in it is registered, whatever `rules.addons` says.
 *  - An addon's content (`register`, `rules`) is only registered when it is enabled. A disabled addon adds no tiles, pieces,
 *    actions, hooks or rules, so it cannot change a game it is not part of.
 */

/** The four kinds of interconnection from the Rule of Two. */
export type LinkKind = 'mechanic' | 'ui' | 'content' | 'bot';
export const LINK_KINDS: LinkKind[] = ['mechanic', 'ui', 'content', 'bot'];

/** `target` is a General service id (always on) or another addon id (a soft link, active only when both are on). */
export interface AddonLink { target: string; kind: LinkKind }

export interface AddonDef {
  /** `<packId>.<name>`, for example `tidebound.bridges`. */
  id: string;
  name: string;
  description?: string;
  /** Addon ids that must be enabled too. They must be declared earlier (same pack or an earlier pack). */
  deps?: string[];
  /** A dependency on an addon of another DLC is refused by the audit unless this is set (Siege needs Bulwark, Rising sea needs Tidebound). */
  allowCrossDlcDep?: boolean;
  /** Rule of Two: at least two distinct links, at least one to a General service. Enforced by `auditAddons`. */
  links: AddonLink[];
  /** Rule defaults, merged only while the addon is enabled. */
  rules?: Record<string, any>;
  /** Registers the addon's content. Runs only while the addon is enabled. */
  register?(api: PackApi): void;
}

/** What the lobby needs to draw a DLC card without registering any content. */
export interface AddonInfo { id: string; name: string; description?: string; pack: string; deps: string[]; links: AddonLink[] }
export interface DlcInfo { id: string; name: string; addons: string[] }

/** The always-on General services (Ideas.md, Shared services). An addon must link to at least one of these. */
export const GENERAL_SERVICE_IDS = [
  'manifest',        // 1  DLC manifest and registries
  'round-clock',     // 2
  'score',           // 3  score() and publicVP()
  'piece-cost',      // 4  piece cost and limit service
  'trade-ratio',     // 5
  'production',      // 6  production pipeline
  'tile-state',      // 7
  'durability',      // 8  durability and repair
  'strength',        // 9  strength and defense model
  'marker',          // 10
  'overlay',         // 11 overlay and popup kit
  'wild-token',      // 12
  'ledger',          // 13
  'relations',       // 14
  'history',         // 15 history buffer, change log, stats registry
  'event-deck',      // 16
  'seven-resolver',  // 17
  'bot-goals',       // 18
  'persistence',     // 19
  'sim-matrix'       // 20
] as const;

export interface AddonResolution {
  /** Addon ids that are on. */
  enabled: Set<string>;
  /** Addons the toggles asked for that stay off because a dependency is off (the lobby prompts to enable these). */
  blocked: { addon: string; missing: string[] }[];
}

/** Which addons are on for a set of rules. Works on the packs alone, so it can run before a registry exists. */
export function resolveAddons(packs: Pack[], rules: Record<string, any> | undefined): AddonResolution {
  const enabled = new Set<string>();
  const blocked: { addon: string; missing: string[] }[] = [];
  for (const pack of packs) {
    if (!pack.addons?.length) continue;
    if (rules?.dlc?.[pack.id] !== true) continue;
    for (const a of pack.addons) {
      if (rules?.addons?.[a.id] === false) continue;
      const missing = (a.deps ?? []).filter(d => !enabled.has(d));
      if (missing.length) blocked.push({ addon: a.id, missing });
      else enabled.add(a.id);
    }
  }
  return { enabled, blocked };
}

/** Is this addon part of the game this registry was built for? */
export function addonOn(reg: Registry, id: string): boolean {
  return reg.enabled.has(id);
}

/** Builds the registry for a game: base content plus the addons the rules turn on. */
export function registryFor(packs: Pack[], rules: Record<string, any> | undefined, overrides: Record<string, any> = {}): Registry {
  return createRegistry(packs, overrides, resolveAddons(packs, rules).enabled);
}

/**
 * Rule of Two and manifest checks over a pack list. Returns one line per problem (empty = fine).
 * Run it in a test over `allPacks` so a new addon cannot ship without its links.
 */
export function auditAddons(packs: Pack[]): string[] {
  const problems: string[] = [];
  const services = new Set<string>(GENERAL_SERVICE_IDS);
  const owner = new Map<string, string>();
  for (const p of packs) {
    for (const a of p.addons ?? []) {
      if (owner.has(a.id)) problems.push(`addon "${a.id}" is declared twice`);
      owner.set(a.id, p.id);
    }
  }
  for (const p of packs) {
    if (!p.addons?.length) continue;
    if (!(p.deps ?? []).includes('base')) problems.push(`DLC "${p.id}" must list "base" in deps`);
    for (const a of p.addons) {
      const tag = `${p.id}: addon "${a.id}"`;
      if (!a.id.startsWith(`${p.id}.`) || a.id.length <= p.id.length + 1) problems.push(`${tag} id must start with "${p.id}."`);

      const links = a.links ?? [];
      const distinct = new Set(links.map(l => `${l.target}|${l.kind}`));
      if (distinct.size < 2) problems.push(`${tag} has ${distinct.size} distinct link(s), needs 2 or more`);
      if (!links.some(l => services.has(l.target))) problems.push(`${tag} has no link to a General service`);
      for (const l of links) {
        if (!LINK_KINDS.includes(l.kind)) problems.push(`${tag} link to "${l.target}" has unknown kind "${l.kind}"`);
        if (l.target === a.id) problems.push(`${tag} links to itself`);
        else if (!services.has(l.target) && !owner.has(l.target)) problems.push(`${tag} links to unknown target "${l.target}"`);
      }

      for (const d of a.deps ?? []) {
        const depPack = owner.get(d);
        if (!depPack) problems.push(`${tag} depends on unknown addon "${d}"`);
        else if (depPack !== p.id && !a.allowCrossDlcDep) problems.push(`${tag} depends on "${d}" from another DLC (set allowCrossDlcDep to allow it)`);
      }
    }
  }
  return problems;
}
