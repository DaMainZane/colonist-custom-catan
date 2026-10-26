// MODULE: turn clock readout and countdown bar in the turn pill (counts down from the time left the server sent) | USED BY: render/index.ts
import { state } from '../store';
import type { GameState } from '../types';

let syncedFor: GameState | null = null;
let endMs = 0;
let ticker = 0;
// The length the bar is measured against: the base time, or the first time left seen for this turn if that was longer.
let clockKey = '';
let totalMs = 1;

/** The text and bar for the pill, or '' when there is no clock. Call when the pill is redrawn. */
export function turnClockHtml(): string {
  return state?.turnClock
    ? ' <span class="turn-clock" id="turnClockText"></span><span class="turn-clock-bar" aria-hidden="true"><i id="turnClockFill"></i></span>'
    : '';
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function paint(): void {
  const el = document.getElementById('turnClockText');
  if (!el) return;
  const left = endMs - performance.now();
  el.textContent = fmt(left);
  el.classList.toggle('low', left < 10000);
  const fill = document.getElementById('turnClockFill');
  if (fill) {
    const share = Math.max(0, Math.min(1, left / totalMs));
    fill.style.transform = `scaleX(${share.toFixed(3)})`;
    fill.classList.toggle('low', left < 10000);
  }
}

/** Starts, restarts or stops the countdown to match the latest state. */
export function syncTurnClockDisplay(): void {
  const c = state?.turnClock;
  if (!state || !c) {
    syncedFor = null;
    clockKey = '';
    if (ticker) { clearInterval(ticker); ticker = 0; }
    return;
  }
  // Only a new message from the server carries a new time left. A redraw of the same state must not reset the count.
  if (syncedFor !== state) {
    syncedFor = state;
    endMs = performance.now() + c.remainingMs;
    // A new turn (or a new player on the clock) starts a new bar. Actions that add time keep the same bar, which can only grow.
    const key = `${state.turnCount ?? ''}:${c.playerId}`;
    const base = Math.max(0, Number(state.settings?.turnTimerSec) || 0) * 1000;
    if (key !== clockKey) {
      clockKey = key;
      totalMs = Math.max(1, base, c.remainingMs);
    } else {
      totalMs = Math.max(totalMs, c.remainingMs);
    }
  }
  if (!ticker) ticker = window.setInterval(paint, 250);
  paint();
}
