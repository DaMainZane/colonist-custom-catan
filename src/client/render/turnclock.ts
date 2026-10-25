// MODULE: turn clock readout in the turn pill (counts down from the time left the server sent) | USED BY: render/index.ts
import { state } from '../store';
import type { GameState } from '../types';

let syncedFor: GameState | null = null;
let endMs = 0;
let ticker = 0;

/** The text for the pill, or '' when there is no clock. Call when the pill is redrawn. */
export function turnClockHtml(): string {
  return state?.turnClock ? ' <span class="turn-clock" id="turnClockText"></span>' : '';
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
}

/** Starts, restarts or stops the countdown to match the latest state. */
export function syncTurnClockDisplay(): void {
  const c = state?.turnClock;
  if (!state || !c) {
    syncedFor = null;
    if (ticker) { clearInterval(ticker); ticker = 0; }
    return;
  }
  // Only a new message from the server carries a new time left. A redraw of the same state must not reset the count.
  if (syncedFor !== state) {
    syncedFor = state;
    endMs = performance.now() + c.remainingMs;
  }
  if (!ticker) ticker = window.setInterval(paint, 250);
  paint();
}
