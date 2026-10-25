// MODULE: bot tier profiles (Main / Secondary / Overload), personalities, small hash helper | USED BY: bots/brain, bots/scheduler, bots/sim, bots/dialogue, server/socket, server/rooms
//
// A tier is plain data. The brain reads these numbers and never checks the tier name, so a new tier is a new row.
// All numbers are starting guesses; bots/sim.ts (runLadder) is how they get tuned.

export type TierId = 'main' | 'secondary' | 'overload';
export const TIER_IDS: TierId[] = ['main', 'secondary', 'overload'];
/** Tier given to a bot when the host does not pick one. */
export const DEFAULT_TIER: TierId = 'main';
/** Tier a bot gets when it takes over for a disconnected human (the old "Hard" bot is closest to Secondary). */
export const TAKEOVER_TIER: TierId = 'secondary';

export type InfoLevel = 'public' | 'estimate' | 'full';
export type ChatStyle = 'friendly' | 'neutral' | 'cold';

export interface TierProfile {
  id: TierId;
  /** Shown next to the bot's name and stored in `PlayerState.difficulty`. */
  label: string;

  // Skill and planning
  /** Random jitter added to spot scores. */
  placementNoise: number;
  /** Chance to take the 2nd or 3rd best option instead of the best. */
  blunderChance: number;
  /** Extra plans whose cards are kept back (0 = only the next build). Shrinks on big boards. */
  lookahead: number;
  /** 0 = spot score only, 1 = second settlement fills gaps and ports, 2 = plans both settlements together. */
  setupPlanning: 0 | 1 | 2;
  /** 0 = nearest decent spot, 1 = best spot within 2 roads, 2 = also cuts off contested spots. */
  roadPlanning: 0 | 1 | 2;
  /** Cards kept free below the discard limit: max(spendSlackMin, round(limit * spendSlackFrac)). */
  spendSlackFrac: number;
  spendSlackMin: number;

  // Table play
  /** 0 = biggest opposing production, 1 = leader and VP weighted, 2 = also hits what it needs and presses the leader. */
  robberMode: 0 | 1 | 2;
  /** Refuses trades from anyone at or above this fraction of vpToWin (with a floor, see leaderCutoff in brain). */
  leaderFrac: number;
  /** Offers per turn. */
  tradeProposals: number;
  /** Answers a bad offer from a human with a counter-offer. */
  counters: boolean;
  /** 0 = plays cards at once, 1 = times knights and Year of Plenty, 2 = also Monopoly on the likeliest card. */
  devTiming: 0 | 1 | 2;
  /** 0 = opportunistic, 1 = chases when 1-2 steps away, 2 = chases both, cuts the holder's road. */
  awardChase: 0 | 1 | 2;
  /** 0 = never, 1 = obvious cases (the leader), 2 = the leader's best expansion and anyone close. */
  blocking: 0 | 1 | 2;
  /** Will not rob or block players at or below about 20% of vpToWin. */
  mercy: boolean;

  // Information and edges
  info: InfoLevel;
  /** Weight of remembered robberies (0 = no memory). */
  grudge: number;
  /** All bots of this tier pressure the same human leader. */
  coordination: boolean;
  /** Switches to refusing, robbing and blocking a human who reaches 70% of vpToWin. */
  lockdown: boolean;
  /** 0 = avoids fog, 1 = values it as an expected tile, 2 = reads the tile (cheat) and adds the reveal payout. */
  fogMode: 0 | 1 | 2;
  /** Weight of room to grow around a spot (islands, landmass size). */
  roomWeight: number;
  /** Overvalues the number that was just rolled. */
  hotNumbers: boolean;
  /** Sometimes makes a visible, harmless mistake (a pointless bank swap). */
  mistakes: boolean;

  // Feel
  /** Multiplier on the think delay (1.2 = slower). */
  thinkDelay: number;
  chat: ChatStyle;
}

const PROFILES: Record<TierId, TierProfile> = {
  main: {
    id: 'main', label: 'Main',
    placementNoise: 3.0, blunderChance: 0.12, lookahead: 0, setupPlanning: 0, roadPlanning: 0,
    spendSlackFrac: 0, spendSlackMin: 0,
    robberMode: 0, leaderFrac: 0.8, tradeProposals: 1, counters: false, devTiming: 0, awardChase: 0, blocking: 0, mercy: true,
    info: 'public', grudge: 0, coordination: false, lockdown: false, fogMode: 0, roomWeight: 0, hotNumbers: true, mistakes: true,
    thinkDelay: 1.2, chat: 'friendly'
  },
  secondary: {
    id: 'secondary', label: 'Secondary',
    placementNoise: 1.0, blunderChance: 0.04, lookahead: 1, setupPlanning: 1, roadPlanning: 1,
    spendSlackFrac: 0.1, spendSlackMin: 1,
    robberMode: 1, leaderFrac: 0.7, tradeProposals: 2, counters: true, devTiming: 1, awardChase: 1, blocking: 1, mercy: false,
    info: 'estimate', grudge: 0.6, coordination: false, lockdown: false, fogMode: 1, roomWeight: 0.5, hotNumbers: false, mistakes: false,
    thinkDelay: 1.0, chat: 'neutral'
  },
  overload: {
    id: 'overload', label: 'Overload',
    placementNoise: 0, blunderChance: 0, lookahead: 3, setupPlanning: 2, roadPlanning: 2,
    spendSlackFrac: 0.2, spendSlackMin: 2,
    robberMode: 2, leaderFrac: 0.6, tradeProposals: 3, counters: true, devTiming: 2, awardChase: 2, blocking: 2, mercy: false,
    info: 'full', grudge: 1.5, coordination: true, lockdown: true, fogMode: 2, roomWeight: 0.8, hotNumbers: false, mistakes: false,
    thinkDelay: 0.8, chat: 'cold'
  }
};

export function tierProfile(id: TierId): TierProfile {
  return PROFILES[id] ?? PROFILES[DEFAULT_TIER];
}

export function tierLabel(id: TierId): string {
  return tierProfile(id).label;
}

/** Parses a tier id or label from a client or a saved player ("main", "Overload"). Null if it is neither. */
export function normalizeTier(input: any): TierId | null {
  const s = String(input ?? '').trim().toLowerCase();
  return (TIER_IDS as string[]).includes(s) ? (s as TierId) : null;
}

/** `PlayerState.difficulty` -> tier. Anything unknown (the old "ADVANCED HARD") counts as Secondary. */
export function tierFromDifficulty(difficulty: string | null | undefined): TierId {
  return normalizeTier(difficulty) ?? TAKEOVER_TIER;
}

/** Spend threshold: a bot holding more cards than this starts spending or swapping them down. */
export function spendThreshold(tier: TierProfile, discardLimit: number): number {
  if (tier.spendSlackFrac <= 0 && tier.spendSlackMin <= 0) return discardLimit;
  const slack = Math.max(tier.spendSlackMin, Math.round(discardLimit * tier.spendSlackFrac));
  return Math.max(2, discardLimit - slack);
}

// ---- Personalities (applied on top of any tier) ---------------------------------

export type Personality = 'balanced' | 'builder' | 'roadHog' | 'portTrader' | 'devRusher';
const PERSONALITIES: Personality[] = ['balanced', 'builder', 'roadHog', 'portTrader', 'devRusher'];

/** Deterministic number in [0, 1) from a string, so the same bot always plays the same way. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function personalityOf(playerId: string): Personality {
  return PERSONALITIES[Math.floor(hash01(`personality:${playerId}`) * PERSONALITIES.length)];
}
