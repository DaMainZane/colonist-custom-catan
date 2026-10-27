// MODULE: map menu data (the registry's map options, quick starts, DLC/addon catalog and scenarios as plain JSON) | USED BY: server/socket, tests
// The client draws the whole map menu and DLC setup cards from this list, so a pack that registers a shape, style, perk or DLC addon shows up
// with no client change (design section 12, "What the server sends").
import { allMapOptions } from '../shared';
import type { AddonInfo, DlcInfo, MapOptionStage, ParamDef, Registry } from '../shared';
import { registry } from './runtime';

export interface MapOptionView {
  id: string;
  label: string;
  description: string;
  stage: MapOptionStage;
  /** Shape ops only: tweak, base, carve or scatter. */
  phase?: string;
  /** Options in the same slot replace each other. */
  slot?: string;
  /** Used when its slot is empty. */
  default: boolean;
  conflicts: string[];
  requires: string[];
  /** Every capability in `requires` is registered. An unmet option is shown greyed and the server refuses it. */
  met: boolean;
  /** The seed and share code reveal hidden information (fog). */
  secret: boolean;
  params: ParamDef[];
}

export interface QuickStartView {
  id: string;
  label: string;
  /** The all-water canvas for the painter. */
  blank: boolean;
}

export interface ScenarioPresetView {
  id: string;
  label: string;
  description: string;
  quickStart: string;
  boardRadius: number;
  vpToWin: number;
  dlc: Record<string, boolean>;
  addons?: Record<string, boolean>;
  eventsOn?: boolean;
  fateTokens?: number;
}

export const SCENARIO_PRESETS: ScenarioPresetView[] = [
  {
    id: 'standardCatan',
    label: 'Standard Catan',
    description: 'Classic 19-tile island, 10 VP, base rules only.',
    quickStart: 'standard',
    boardRadius: 2,
    vpToWin: 10,
    dlc: {},
    eventsOn: false,
    fateTokens: 2
  },
  {
    id: 'islandHoppers',
    label: 'Island Hoppers',
    description: 'Archipelago map with Tidebound bridges, ships and naval trade.',
    quickStart: 'archipelago',
    boardRadius: 3,
    vpToWin: 12,
    dlc: { tidebound: true },
    eventsOn: false,
    fateTokens: 2
  },
  {
    id: 'siegeOfCatan',
    label: 'Siege of Catan',
    description: 'Continent map with Bulwark fortifications and Crimson Order siege engines.',
    quickStart: 'balancedContinent',
    boardRadius: 3,
    vpToWin: 12,
    dlc: { bulwark: true, crimson: true },
    eventsOn: true,
    fateTokens: 2
  },
  {
    id: 'merchantRepublic',
    label: 'Merchant Republic',
    description: 'Balanced continent with Golden Ledger coins, contracts and guild halls.',
    quickStart: 'balancedContinent',
    boardRadius: 3,
    vpToWin: 12,
    dlc: { ledger: true },
    eventsOn: false,
    fateTokens: 2
  },
  {
    id: 'realmOfWhispers',
    label: 'Realm of Whispers',
    description: 'Fog continents with Whispers diplomacy, pacts, spies and round events.',
    quickStart: 'fogContinents',
    boardRadius: 3,
    vpToWin: 12,
    dlc: { whispers: true },
    eventsOn: true,
    fateTokens: 3
  },
  {
    id: 'ageOfWonders',
    label: 'Age of Wonders',
    description: 'Realistic continent with Heartland upgrades and Wayfarers wonders.',
    quickStart: 'realisticContinent',
    boardRadius: 3,
    vpToWin: 13,
    dlc: { heartland: true, wayfarers: true },
    eventsOn: true,
    fateTokens: 2
  },
  {
    id: 'wildFrontier',
    label: 'Wild Frontier',
    description: 'Lakeland map with Wildlands seasons, camps, volcano and plague.',
    quickStart: 'lakeland',
    boardRadius: 3,
    vpToWin: 12,
    dlc: { wildlands: true },
    eventsOn: true,
    fateTokens: 2
  },
  {
    id: 'kitchenSink',
    label: 'Grand Chronicle',
    description: 'Large multi-continent world with every expansion and round events.',
    quickStart: 'fogContinents',
    boardRadius: 4,
    vpToWin: 15,
    dlc: {
      heartland: true,
      tidebound: true,
      bulwark: true,
      ledger: true,
      wayfarers: true,
      crimson: true,
      whispers: true,
      wildlands: true
    },
    eventsOn: true,
    fateTokens: 3
  }
];

export interface MapOptionsView {
  options: MapOptionView[];
  quickStarts: QuickStartView[];
  dlcs: DlcInfo[];
  addons: AddonInfo[];
  scenarios: ScenarioPresetView[];
}

/** Every registered option (shapes first, then terrain, numbers, perks), quick start, DLC, addon and scenario, as plain data. */
export function mapOptionsView(reg: Registry = registry): MapOptionsView {
  const options: MapOptionView[] = allMapOptions(reg).map(o => ({
    id: o.id,
    label: o.label,
    description: o.description ?? '',
    stage: o.stage,
    phase: o.stage === 'shape' ? o.phase : undefined,
    slot: o.slot,
    default: !!o.default,
    conflicts: [...(o.conflicts ?? [])],
    requires: [...(o.requires ?? [])],
    met: (o.requires ?? []).every(c => reg.capabilities.has(c)),
    secret: !!o.secret,
    params: (o.params ?? []).map(p => ({ id: p.id, label: p.label, min: p.min, max: p.max, step: p.step, default: p.default }))
  }));
  const quickStarts: QuickStartView[] = [...reg.quickStarts.values()].map(q => ({ id: q.id, label: q.label, blank: !!q.blank }));
  const dlcs: DlcInfo[] = [...reg.dlcs.values()].map(d => ({
    id: d.id,
    name: d.name,
    addons: [...d.addons]
  }));
  const addons: AddonInfo[] = [...reg.addons.values()].map(a => ({
    id: a.id,
    name: a.name,
    description: a.description,
    pack: a.pack,
    deps: [...a.deps],
    links: a.links.map(l => ({ target: l.target, kind: l.kind }))
  }));
  return {
    options,
    quickStarts,
    dlcs,
    addons,
    scenarios: SCENARIO_PRESETS.map(s => ({ ...s, dlc: { ...s.dlc }, ...(s.addons ? { addons: { ...s.addons } } : {}) }))
  };
}
