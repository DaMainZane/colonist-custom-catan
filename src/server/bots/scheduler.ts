// MODULE: bot scheduler (waits a game-speed-scaled delay, then lets one bot act, after every broadcast) | USED BY: server/main
import { getPlayer, legalActions } from '../../shared';
import { runAction } from '../game';
import { broadcastRoom, setAfterBroadcast } from '../net';
import { clearBotTimers } from '../rooms';
import { registry } from '../runtime';
import type { Room } from '../types';
import { chooseBotAction } from './brain';

/** Base delay per action type in ms (before the game-speed setting divides it). */
const BASE_DELAY: Record<string, number> = { respond_trade: 450, discard: 450, pick: 400 };
const DEFAULT_DELAY = 600;
/** How long a human gets to answer a bot's trade offer. */
const TRADE_WAIT = 4500;

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

/** A bot's open offer is withdrawn if humans have not answered after a while. */
function watchBotTrade(room: Room): void {
  const g = room.game;
  const trade = g?.trade;
  if (!g || !trade || room.tradeTimerFor === trade.id) return;
  if (!getPlayer(g, trade.fromId)?.isBot) return;

  room.tradeTimerFor = trade.id;
  if (room.tradeTimer) clearTimeout(room.tradeTimer);
  room.tradeTimer = setTimeout(() => {
    const open = room.game?.trade;
    if (!open || open.id !== trade.id) return;
    const res = runAction(room, trade.fromId, 'cancel_trade');
    if (res.ok) broadcastRoom(room);
  }, Math.max(1200, delay(room, TRADE_WAIT)));
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
  watchBotTrade(room);
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
}
