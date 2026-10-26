// MODULE: per-turn clock for human players (base time per turn, plus an increment for each completed action) | USED BY: server/game, server/rooms, server/view, bots/scheduler
import type { Room } from './types';

/** Smallest time left after a forced action, so the next forced step is not instant. */
const GRACE_MS = 3000;

let onExpire: ((room: Room) => void) | null = null;

/** The scheduler registers what happens when the clock runs out (avoids an import cycle with game.ts). */
export function setTurnExpiryHandler(fn: (room: Room) => void): void {
  onExpire = fn;
}

export function clearTurnClock(room: Room): void {
  if (room.turnClock?.timer) clearTimeout(room.turnClock.timer);
  room.turnClock = undefined;
}

function arm(room: Room): void {
  const c = room.turnClock;
  if (!c) return;
  if (c.timer) clearTimeout(c.timer);
  c.timer = setTimeout(() => {
    c.timer = undefined;
    if (room.turnClock !== c || !onExpire) return;
    try { onExpire(room); } catch (e) { console.error('[turn clock]', e); }
  }, Math.max(0, c.deadline - Date.now()));
}

/**
 * Who the clock runs for. Normally the player whose turn it is (none for a bot). After a 7, the first human who still owes
 * a discard is on the clock instead, even when a bot is the one playing the turn, so nobody can stall the table by not discarding.
 */
type Game = NonNullable<Room['game']>;
type Seat = Game['players'][number];

function clockOwner(g: Game): { player: Seat; discard: boolean } | null {
  if (g.phase === 'discard') {
    const owing = g.players.find(p => !p.isBot && (p.pending?.discard || 0) > 0);
    if (owing) return { player: owing, discard: true };
  }
  const cur = g.players[g.turn];
  return cur && !cur.isBot ? { player: cur, discard: false } : null;
}

/**
 * Starts, keeps or stops the clock so it matches the game: one clock per human turn, restarted at the base time
 * whenever the turn passes on, and a fresh one while a human owes a discard. Off when the setting is 0 or when only bots
 * have something to do. Safe to call any number of times.
 */
export function syncTurnClock(room: Room): void {
  const g = room.game;
  const baseMs = Math.max(0, Number(room.settings?.turnTimerSec) || 0) * 1000;
  const owner = g && g.phase !== 'gameover' ? clockOwner(g) : null;
  if (!g || baseMs <= 0 || !owner) {
    clearTurnClock(room);
    return;
  }
  const key = `${g.turnCount}:${g.turn}:${owner.player.id}${owner.discard ? ':discard' : ''}`;
  if (room.turnClock?.key === key) return;
  // A discard clock cuts in on a running turn clock. Park what the turn had left and give it back afterwards, so the discard
  // phase does not hand the turn owner a fresh full clock.
  const prev = room.turnClock;
  if (prev && !prev.key.endsWith(':discard')) {
    room.savedTurnClock = { key: prev.key, remainingMs: Math.max(0, prev.deadline - Date.now()) };
  }
  let ms = baseMs;
  if (!owner.discard) {
    if (room.savedTurnClock?.key === key) ms = Math.max(GRACE_MS, room.savedTurnClock.remainingMs);
    room.savedTurnClock = undefined;
  }
  clearTurnClock(room);
  room.turnClock = { key, playerId: owner.player.id, deadline: Date.now() + ms };
  arm(room);
}

/** A completed action by the player on the clock adds the increment (seconds from the settings). */
export function noteActionCompleted(room: Room, playerId: string): void {
  const c = room.turnClock;
  if (!c || c.playerId !== playerId) return;
  const addMs = Math.max(0, Number(room.settings?.turnIncrementSec) || 0) * 1000;
  if (addMs <= 0) return;
  c.deadline += addMs;
  arm(room);
}

/** After a forced action: keep a little time on the clock so the next forced step is not instant. */
export function ensureGrace(room: Room, ms = GRACE_MS): void {
  const c = room.turnClock;
  if (!c) return;
  const min = Date.now() + ms;
  if (c.deadline < min) {
    c.deadline = min;
    arm(room);
  }
}

/** What the client needs. Time left (not an absolute time) so clock differences between machines do not matter. */
export function turnClockView(room: Room): { playerId: string; remainingMs: number } | null {
  const c = room.turnClock;
  if (!c) return null;
  return { playerId: c.playerId, remainingMs: Math.max(0, c.deadline - Date.now()) };
}
