// MODULE: turn clock readout and countdown bar in the turn pill, plus the top-right ocean game timer & round number HUD | DEPENDS ON: client/store, client/types | USED BY: client/render/index
import { state } from '../store';
import type { GameState } from '../types';

let syncedFor: GameState | null = null;
let endMs = 0;
let ticker = 0;
// The length the bar is measured against: the base time, or the first time left seen for this turn if that was longer.
let clockKey = '';
let totalMs = 1;

let gameTicker = 0;

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

function fmtElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function paintGameHud(): void {
  const hud = document.getElementById('gameClockHud');
  if (!hud) return;
  if (!state || state.status === 'LOBBY' || !state.startedAt) {
    hud.style.display = 'none';
    return;
  }
  hud.style.display = 'flex';
  const roundEl = document.getElementById('gameRoundText');
  if (roundEl) {
    const r = Number(state.round) || 0;
    roundEl.textContent = r > 0 ? `Round ${r}` : 'Setup · Round 0';
  }
  const timerEl = document.getElementById('gameTimerText');
  if (timerEl) {
    const end = state.finishedAt || Date.now();
    timerEl.textContent = fmtElapsed(end - state.startedAt);
  }
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

/** Starts, restarts or stops the turn countdown and the top-right ocean game timer + round number HUD. */
export function syncTurnClockDisplay(): void {
  paintGameHud();
  if (!state || state.status !== 'PLAYING' || !state.startedAt) {
    if (gameTicker) { clearInterval(gameTicker); gameTicker = 0; }
  } else if (!gameTicker && typeof window !== 'undefined') {
    gameTicker = window.setInterval(paintGameHud, 1000);
  }

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
