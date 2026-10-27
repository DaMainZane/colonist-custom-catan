// MODULE: builds the public-only DialogueCtx a line is filled from (no hidden information is read here) | USED BY: bots/dialogue/index, bots/dialogue/engine, tests
//
// LEAK RULE: chat reaches every player, so this file may only read what everyone can already see: the pieces on the
// board, the awards, the rules, how many cards a player holds (a count, never which cards) and the VP shown to others.
// Anything private is not on the DialogueCtx, so a line cannot reference it. tests/dialogue.test.ts scans this file's
// source for the names of the private fields and fails if one appears.
import { publicVP, totalCards } from '../../../shared';
import type { GameState } from '../../../shared';
import { registry } from '../../runtime';
import type { Room } from '../../types';
import { getMapProfile } from '../mapProfile';
import type { DialogueCtx, MapTrait } from './types';

export interface Subject { id: string; name: string }

/** Extra values a trigger can hand to the line. Every field is optional. */
export interface CtxExtra {
  /** The other player in the event (thief, victim, proposer, winner). Becomes {name}, and {vp}/{vpLeft} describe them. */
  other?: Subject;
  n?: number;
  sum?: number;
  number?: number | null;
  /** A resource id, only for events where the resource is public (Monopoly, bank empty). */
  res?: string;
  award?: string;
}

export interface Standing {
  /** Public VP per player id (hidden VP cards are not counted). */
  vps: Map<string, number>;
  /** The one player with strictly the most public VP (at least 1), else null. */
  leaderId: string | null;
}

export function publicStanding(g: GameState): Standing {
  const vps = new Map<string, number>();
  for (const p of g.players) vps.set(p.id, publicVP(g, registry, p));
  let leaderId: string | null = null;
  let best = -1;
  let tie = false;
  for (const [id, vp] of vps) {
    if (vp > best) { best = vp; leaderId = id; tie = false; }
    else if (vp === best) tie = true;
  }
  return { vps, leaderId: tie || best < 1 ? null : leaderId };
}

function rankOf(id: string, vps: Map<string, number>): 'leader' | 'trailing' | 'middle' {
  const mine = vps.get(id) ?? 0;
  let others = 0;
  for (const [pid, vp] of vps) if (pid !== id && vp > others) others = vp;
  if (mine > others) return 'leader';
  if (mine <= others - 2) return 'trailing';
  return 'middle';
}

export function mapTraits(g: GameState): MapTrait[] {
  const out: MapTrait[] = [];
  const profile = getMapProfile(g, registry);
  if (g.rules.boardRadius >= 5) out.push('large');
  if (profile.landmassSize.filter(size => size >= 2).length >= 2) out.push('islands');
  if (profile.hiddenCount > 0) out.push('fog');
  if (profile.goldShare >= 0.15) out.push('gold');
  return out;
}

/** Works in a lobby too (no game yet): then only {me}, {win} and {limit} exist, from the lobby settings. */
export function buildCtx(room: Room, speaker: Subject, extra: CtxExtra = {}): DialogueCtx {
  const g = room.game;
  const win = g?.rules.vpToWin ?? room.settings?.vpToWin ?? 10;
  const limit = g?.rules.discardLimit ?? room.settings?.cardDiscardLimit ?? 7;
  const slots: Record<string, string | number> = { me: speaker.name, win, limit };

  if (!g) {
    return {
      slots,
      facts: { selfRank: 'middle', selfVpLeft: win, overLimit: false, otherLeader: false, otherNewcomer: false, traits: [] }
    };
  }

  const { vps, leaderId } = publicStanding(g);
  const subject = extra.other ?? speaker;
  const subjectVp = vps.get(subject.id) ?? 0;
  slots.turn = g.turnCount;
  slots.vp = subjectVp;
  slots.vpLeft = Math.max(0, win - subjectVp);
  const leader = leaderId ? g.players.find(p => p.id === leaderId) : undefined;
  if (leader) slots.leader = leader.name;
  if (extra.other) slots.name = extra.other.name;
  if (extra.n !== undefined) slots.n = extra.n;
  if (extra.sum !== undefined) slots.sum = extra.sum;
  if (extra.number !== undefined && extra.number !== null) slots.number = extra.number;
  if (extra.res) slots.res = extra.res;
  if (extra.award) slots.award = extra.award;

  const me = g.players.find(p => p.id === speaker.id);
  return {
    slots,
    facts: {
      selfRank: rankOf(speaker.id, vps),
      selfVpLeft: win - (vps.get(speaker.id) ?? 0),
      overLimit: me ? totalCards(me) > limit : false,
      otherLeader: !!extra.other && rankOf(extra.other.id, vps) === 'leader',
      otherNewcomer: !!extra.other && (vps.get(extra.other.id) ?? 0) <= 3,
      traits: mapTraits(g)
    }
  };
}
