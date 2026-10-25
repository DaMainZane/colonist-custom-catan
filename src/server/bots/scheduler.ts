// MODULE: bot scheduler (waits a game-speed-scaled delay, then lets one bot act, after every broadcast) | USED BY: server/main, server/view
import { getPlayer, legalActions } from '../../shared';
import { openTrades } from '../../packs/base/trading';
import { runAction } from '../game';
import { broadcastRoom, setAfterBroadcast } from '../net';
import { clearBotTimers } from '../rooms';
import { registry } from '../runtime';
import { ensureGrace, setTurnExpiryHandler, syncTurnClock } from '../turnClock';
import type { Room } from '../types';
import { chooseBotAction } from './brain';

/** Base delay per action type in ms (before the game-speed setting divides it). */
const BASE_DELAY: Record<string, number> = { respond_trade: 450, discard: 450, pick: 400 };
const DEFAULT_DELAY = 600;
/** How long a human gets to answer a bot's trade offer (before game-speed scaling). */
const BOT_TRADE_WAIT = 9000;
/** Default time limit for a human-proposed trade offer (ms). The lobby setting `tradeTimerSec` overrides it. */
const HUMAN_TRADE_WAIT = 20000;

function delay(room: Room, baseMs: number): number {
  const speed = Math.max(0.25, Math.min(10, Number(room.settings?.gameSpeed) || 1));
  return Math.max(35, Math.round(baseMs / speed));
}

interface Move { botId: string; type: string; payload: any }

/** The next bot step: the current player first, then any other bot that owes something (discard, pick, trade answer). */
function nextBotMove(room: Room): Move | null {
  const g = room.game;
  if (!g || g.phase === 'gameover') return null;
  const order = [g.players[g.turn], ...g.players.filter((_, i) => i !== g.turn)];
  for (const p of order) {
    if (!p || !p.isBot) continue;
    const move = chooseBotAction(g, registry, p.id);
    if (move) return { botId: p.id, ...move };
  }
  return null;
}

/**
 * Ensures every open trade in `g.trades` has a running expiration timer and timestamp metadata,
 * and cleans up timers for trades that were completed or cancelled.
 */
export function ensureTradeTimers(room: Room): void {
  const g = room.game;
  if (!room.tradeTimers) room.tradeTimers = new Map();
  const map = room.tradeTimers;

  if (!g || g.phase === 'gameover') {
    for (const entry of map.values()) if (entry.timer) clearTimeout(entry.timer);
    map.clear();
    return;
  }

  const trades = openTrades(g);
  const activeIds = new Set(trades.map(t => t.id));
  for (const [id, entry] of map.entries()) {
    if (!activeIds.has(id)) {
      if (entry.timer) clearTimeout(entry.timer);
      map.delete(id);
    }
  }

  const now = Date.now();
  for (const trade of trades) {
    if (map.has(trade.id)) continue;
    const isBotOffer = !!getPlayer(g, trade.fromId)?.isBot;
    const humanWaitMs = (Number(room.settings?.tradeTimerSec) || HUMAN_TRADE_WAIT / 1000) * 1000;
    const durationMs = isBotOffer ? Math.max(2500, delay(room, BOT_TRADE_WAIT)) : humanWaitMs;
    const createdAt = now;
    const expiresAt = now + durationMs;
    const timer = setTimeout(() => {
      map.delete(trade.id);
      const currG = room.game;
      if (!currG) return;
      const stillOpen = openTrades(currG).find(t => t.id === trade.id);
      if (!stillOpen) return;
      const res = runAction(room, stillOpen.fromId, 'cancel_trade', { tradeId: trade.id });
      if (res.ok) broadcastRoom(room);
    }, durationMs);

    map.set(trade.id, { createdAt, expiresAt, durationMs, timer });
  }
}

/**
 * The human's turn clock ran out: pass the turn if they can, otherwise finish what is pending
 * (roll, move the robber, discard, pick) with the bot brain, then leave a few seconds for the next step.
 */
function handleTurnExpiry(room: Room): void {
  const g = room.game;
  if (!g || g.phase === 'gameover') return;
  const cur = g.players[g.turn];
  if (!cur || cur.isBot) return;

  let move: Move | null = null;
  if (legalActions(g, registry, cur.id).some(a => a.type === 'end_turn')) {
    move = { botId: cur.id, type: 'end_turn', payload: {} };
  } else {
    // The current player first, then anyone else who owes something (for example a discard after a 7).
    for (const p of [cur, ...g.players.filter(x => x.id !== cur.id)]) {
      const m = chooseBotAction(g, registry, p.id);
      if (m) { move = { botId: p.id, ...m }; break; }
    }
  }
  if (!move) {
    ensureGrace(room, 5000);
    return;
  }
  const res = runAction(room, move.botId, move.type, move.payload);
  if (!res.ok) console.error(`[turn clock] ${move.type} rejected in ${g.phase}: ${res.error}`);
  ensureGrace(room);
  broadcastRoom(room);
}

function runBotStep(room: Room): void {
  const g = room.game;
  if (!g || g.phase === 'gameover') return;
  const move = nextBotMove(room);
  if (!move) return;

  let res = runAction(room, move.botId, move.type, move.payload);
  if (!res.ok) {
    console.error(`[bots] ${move.botId} ${move.type} rejected in ${g.phase}: ${res.error}`);
    // Never leave the game stuck on one bad decision: end the turn, or take any legal action.
    const options = legalActions(g, registry, move.botId);
    const alt = options.find(a => a.type === 'end_turn') ?? options[0];
    if (!alt) return;
    res = runAction(room, move.botId, alt.type, alt.payload);
    if (!res.ok) {
      console.error(`[bots] fallback ${alt.type} rejected too: ${res.error}`);
      return;
    }
  }
  broadcastRoom(room); // schedules the next step
}

/** Called after every broadcast. At most one bot step is pending per room. */
export function scheduleBots(room: Room): void {
  const g = room.game;
  if (!g || g.phase === 'gameover') {
    clearBotTimers(room);
    return;
  }
  ensureTradeTimers(room);
  syncTurnClock(room);
  if (room.botTimer) return;

  const move = nextBotMove(room);
  if (!move) return;
  room.botTimer = setTimeout(() => {
    room.botTimer = undefined;
    try { runBotStep(room); } catch (e) { console.error('[bots]', e); }
  }, delay(room, BASE_DELAY[move.type] ?? DEFAULT_DELAY));
}

/** Hooks the scheduler into the broadcast. Call once at startup. */
export function initBots(): void {
  setAfterBroadcast(scheduleBots);
  setTurnExpiryHandler(handleTurnExpiry);
}
