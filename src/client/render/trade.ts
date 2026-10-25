// MODULE: active trade offer stack (top right), per-offer timers, trade responses and counter-offer editor | USED BY: render/index.ts, main.ts
import { RESOURCES, RES_META } from '../constants';
import { getMiniSvg, buildOverlappingStackHtml, uiIcon } from '../icons';
import { playTone } from '../audio';
import { socket } from '../socket';
import {
  state, setDrawerMode, counterTradeId, counterGet, counterGive,
  setCounterTradeId, tradesCollapsed, setTradesCollapsed
} from '../store';
import type { TradeView } from '../types';
import { esc } from '../util';
import { avatarFace } from '../avatars';
import { showToast } from '../ui';
import { renderHand } from './hand';

// Local arrival timestamps keyed by trade id so client countdown bars run smoothly regardless of clock skew.
const tradeTiming = new Map<number, { startMs: number; durationMs: number }>();
const seenTradeIds = new Set<number>();
let timerRaf = 0;

function stacksHtml(counts: Record<string, number>): string {
  return RESOURCES.filter(r => counts[r] > 0).map(r =>
    buildOverlappingStackHtml(`card-${r}`, getMiniSvg(r), counts[r], '', RES_META[r].name)
  ).join('');
}

function sum(r: Record<string, number>): number {
  return RESOURCES.reduce((s, k) => s + (r[k] || 0), 0);
}

function myPlayerView(): any {
  return state?.players.find(p => p.id === socket.id);
}

function openTradesList(): TradeView[] {
  if (!state) return [];
  if (Array.isArray(state.activeTrades) && state.activeTrades.length > 0) return state.activeTrades;
  return state.activeTrade ? [state.activeTrade] : [];
}

function syncClientTradeTimings(trades: TradeView[]): void {
  const now = performance.now();
  const wallNow = Date.now();
  const activeIds = new Set(trades.map(t => t.id));
  for (const id of tradeTiming.keys()) {
    if (!activeIds.has(id)) tradeTiming.delete(id);
  }
  for (const id of seenTradeIds) {
    if (!activeIds.has(id)) seenTradeIds.delete(id);
  }
  for (const t of trades) {
    if (tradeTiming.has(t.id)) continue;
    const durationMs = Math.max(2000, Number(t.durationMs) || 20000);
    const serverElapsed = t.createdAt ? Math.max(0, Math.min(durationMs, wallNow - t.createdAt)) : 0;
    tradeTiming.set(t.id, { startMs: now - serverElapsed, durationMs });
  }
}

// Sets every countdown bar to the share of time left. Returns true while any bar is still running.
function paintTimerBars(): boolean {
  const bars = document.querySelectorAll<HTMLElement>('[data-trade-timer]');
  if (bars.length === 0) return false;
  const now = performance.now();
  let anyActive = false;

  bars.forEach(el => {
    const id = Number(el.dataset.tradeTimer);
    const timing = tradeTiming.get(id);
    if (!timing) return;
    const elapsed = Math.max(0, now - timing.startMs);
    const frac = Math.max(0, Math.min(1, 1 - elapsed / timing.durationMs));
    el.style.width = `${(frac * 100).toFixed(2)}%`;
    el.classList.toggle('low', frac < 0.28);
    if (frac > 0) anyActive = true;
  });
  return anyActive;
}

function tickTradeTimerBars(): void {
  timerRaf = 0;
  if (paintTimerBars()) timerRaf = requestAnimationFrame(tickTradeTimerBars);
}

function ensureTimerLoop(): void {
  if (!timerRaf) timerRaf = requestAnimationFrame(tickTradeTimerBars);
}

// Counter editor rows (Colonist style): click a card here to take one back. Offer cards by clicking your hand
// (give) or the strip under the rows (get).
function counterStacksHtml(side: 'get' | 'give', counts: Record<string, number>): string {
  const html = RESOURCES.filter(r => (counts[r] || 0) > 0).map(r =>
    buildOverlappingStackHtml(
      `card-${r}`, getMiniSvg(r), counts[r],
      `adjustCounter('${side}','${r}',-1)`, `${RES_META[r].name}: click to remove one`
    )
  ).join('');
  return html;
}

// Redraws the editor and the hand (cards placed in the counter leave the hand view, like in the trade drawer).
function refreshCounterView(): void {
  const me = myPlayerView();
  renderActiveTradeModal(me);
  renderHand(me, state.players[state.turnIndex]?.id === socket.id);
}

function renderOneTradeCard(t: TradeView, me: any, headerPlayers: any[], isNew: boolean): string {
  const isMyOffer = t.fromId === socket.id;
  const editing = counterTradeId === t.id && !isMyOffer;
  const animCls = isNew ? 'trade-card-enter' : '';

  // Row badges (who + arrow) are shared by the offer view and the counter editor, like Colonist.
  const topWhoHtml = isMyOffer
    ? `<span class="trade-who-group" title="From another player">${uiIcon('users', 18)}</span>`
    : `<span class="avatar trade-who-avatar" style="background:${esc(t.fromColor)}" title="From ${esc(t.fromName)}">${avatarFace(t.fromAvatar, t.fromName)}</span>`;

  const bottomWhoHtml = me
    ? `<span class="avatar trade-who-avatar" style="background:${esc(me.color)}" title="You (${esc(me.name)})">${avatarFace(me.avatar, me.name)}</span>`
    : `<span class="trade-who-group">${uiIcon('users', 18)}</span>`;

  if (editing) {
    const mine = me || myPlayerView();
    const canSend = sum(counterGive) > 0 && sum(counterGet) > 0 &&
      !!mine && RESOURCES.every(r => (counterGive[r] || 0) <= (mine.resources?.[r] || 0));
    return `
      <div class="trade-offer-body trade-counter ${animCls}" data-trade-id="${t.id}">
        <div class="trade-timebar" title="Time left"><div class="trade-timebar-fill" data-trade-timer="${t.id}"></div></div>
        <div class="trade-rows">
          <div class="counter-picker" title="Click a resource to ask for it">
            ${RESOURCES.map(r => `<div class="mini-res-card card-${r}" onclick="adjustCounter('get','${r}',1)" title="Ask for ${esc(RES_META[r].name)}">${getMiniSvg(r)}</div>`).join('')}
          </div>
          <div class="trade-row" title="What you receive (click a card to remove one)">
            <div class="trade-dir-badge get">
              ${topWhoHtml}
              <span class="trade-arrow get">${uiIcon('arrowDown', 15)}</span>
            </div>
            <div class="trade-cards-line">${counterStacksHtml('get', counterGet)}</div>
          </div>
          <div class="trade-row" title="What you give (click your hand cards to add, click here to remove)">
            <div class="trade-dir-badge give">
              ${bottomWhoHtml}
              <span class="trade-arrow give">${uiIcon('arrowUp', 15)}</span>
            </div>
            <div class="trade-cards-line">${counterStacksHtml('give', counterGive)}</div>
          </div>
        </div>
        <div class="trade-actions">
          <button class="trade-act-btn accept ${canSend ? '' : 'off'}" ${canSend ? `onclick="sendCounter(${t.id})"` : 'disabled'}
            title="${canSend ? 'Send counter offer' : 'Pick cards you give (that you hold) and cards you get'}">${uiIcon('check', 18)}</button>
          <button class="trade-act-btn cancel" onclick="cancelCounter()" title="Back to the offer">${uiIcon('close', 18)}</button>
        </div>
      </div>`;
  }

  // Rows are shown from the viewer's perspective: what I get on top (↓), what I give below (↑).
  const giveHtml = stacksHtml(isMyOffer ? t.offer : t.request);
  const getHtml = stacksHtml(isMyOffer ? t.request : t.offer);

  let actionsHtml = '';
  if (isMyOffer) {
    // Responder columns align with the avatars in the top header bar.
    const responders = headerPlayers.filter(p => p.id !== t.fromId && t.responses && t.responses[p.id] !== undefined);
    const respBtns = responders.map(p => {
      const resp = (t.responses && t.responses[p.id]) || 'pending';
      if (resp === 'accepted') {
        return `<button class="trade-resp-box accepted" style="--resp-color:${esc(p.color)}" onclick="confirmTradeWith('${esc(p.id)}', ${t.id})" title="${esc(p.name)} accepted — click to complete trade">${uiIcon('check', 18)}</button>`;
      }
      if (resp === 'declined') {
        return `<div class="trade-resp-box declined" style="--resp-color:${esc(p.color)}" title="${esc(p.name)} declined">${uiIcon('close', 17)}</div>`;
      }
      return `<div class="trade-resp-box pending" style="--resp-color:${esc(p.color)}" title="Waiting for ${esc(p.name)}"><span class="wait-dots"></span></div>`;
    }).join('');

    actionsHtml = `
      ${respBtns}
      <button class="trade-act-btn cancel" onclick="cancelTrade(${t.id})" title="Cancel this trade offer">${uiIcon('close', 18)}</button>
    `;
  } else {
    const myResp = (t.responses && t.responses[socket.id]) || 'pending';
    const canAfford = !!me && RESOURCES.every(r => (t.request[r] || 0) <= (me.resources?.[r] || 0));
    actionsHtml = `
      <button class="trade-act-btn accept ${canAfford ? '' : 'off'} ${myResp === 'accepted' ? 'chosen' : ''}" ${canAfford ? `onclick="respondToTrade('accepted', ${t.id})"` : 'disabled'}
        title="${canAfford ? 'Accept trade' : 'Not enough cards'}">${uiIcon('check', 18)}</button>
      <button class="trade-act-btn edit" onclick="startCounter(${t.id})" title="Edit and counter offer">${uiIcon('swap', 18)}</button>
      <button class="trade-act-btn decline ${myResp === 'declined' ? 'off' : ''}" onclick="respondToTrade('declined', ${t.id})" title="Decline trade">${uiIcon('close', 18)}</button>
    `;
  }

  return `
    <div class="trade-offer-body ${animCls}" data-trade-id="${t.id}">
      <div class="trade-timebar" title="Time left"><div class="trade-timebar-fill" data-trade-timer="${t.id}"></div></div>
      <div class="trade-rows">
        <div class="trade-row" title="What you receive">
          <div class="trade-dir-badge get">
            ${topWhoHtml}
            <span class="trade-arrow get">${uiIcon('arrowDown', 15)}</span>
          </div>
          <div class="trade-cards-line">${getHtml}</div>
        </div>
        <div class="trade-row" title="What you give">
          <div class="trade-dir-badge give">
            ${bottomWhoHtml}
            <span class="trade-arrow give">${uiIcon('arrowUp', 15)}</span>
          </div>
          <div class="trade-cards-line">${giveHtml}</div>
        </div>
      </div>
      <div class="trade-actions">${actionsHtml}</div>
    </div>
  `;
}

// Renders the top-right trade stack: header bar with opponent avatars + collapse toggle, and newest-first offer cards below.
export function renderActiveTradeModal(me: any): void {
  const box = document.getElementById('activeTradeModal')!;
  const trades = openTradesList();
  if (trades.length === 0) {
    setCounterTradeId(null);
    setTradesCollapsed(false);
    tradeTiming.clear();
    seenTradeIds.clear();
    box.style.display = 'none';
    return;
  }

  syncClientTradeTimings(trades);
  box.style.display = 'flex';

  // Drop counter draft if the offer it was editing no longer exists.
  if (counterTradeId !== null && !trades.some(t => t.id === counterTradeId && t.fromId !== socket.id)) {
    setCounterTradeId(null);
  }

  // Header shows the other players at the table (or all responders across active offers).
  const refFromId = trades[0].fromId;
  const headerPlayers = state.players.filter(p => p.id !== refFromId);
  const newestTrade = trades[0];

  const avatarsHtml = headerPlayers.map(p => {
    const resp = (newestTrade.responses && newestTrade.responses[p.id]) || 'pending';
    const cls = resp === 'accepted' ? 'ok' : resp === 'declined' ? 'no' : 'wait';
    const icon = resp === 'accepted' ? uiIcon('check', 11) : resp === 'declined' ? uiIcon('close', 11) : '';
    return `
      <div class="resp" title="${esc(p.name)}: ${esc(resp)}">
        <div class="avatar" style="background:${esc(p.color)};border-color:${esc(p.color)}">${avatarFace(p.avatar, p.name)}</div>
        <div class="status ${cls}">${icon}</div>
      </div>`;
  }).join('');

  const cardsHtml = tradesCollapsed
    ? ''
    : `<div class="trade-offers-stack">${trades.map(t => {
        const isNew = !seenTradeIds.has(t.id);
        seenTradeIds.add(t.id);
        return renderOneTradeCard(t, me, headerPlayers, isNew);
      }).join('')}</div>`;

  box.innerHTML = `
    <div class="trade-top-avatars">
      <div class="trade-top-avatars-list">${avatarsHtml}</div>
      <button type="button" class="trade-collapse-btn" onclick="toggleTradesCollapsed()" title="${tradesCollapsed ? 'Show trade offers' : 'Hide trade offers'}">
        ${trades.length > 1 || tradesCollapsed ? `<span class="trade-count-pill">${trades.length}</span>` : ''}
        ${uiIcon(tradesCollapsed ? 'chevronDown' : 'chevronUp', 18)}
      </button>
    </div>
    ${cardsHtml}
  `;

  paintTimerBars();
  ensureTimerLoop();
}

export function toggleTradesCollapsed(): void {
  setTradesCollapsed(!tradesCollapsed);
  renderActiveTradeModal(myPlayerView());
}

export function respondToTrade(decision: string, tradeId?: number): void {
  playTone(decision === 'accepted' ? 680 : 300, 0.1);
  socket.emit('respondTrade', { code: state.code, decision, tradeId });
}

export function confirmTradeWith(partnerId: string, tradeId?: number): void {
  playTone(760, 0.12);
  socket.emit('confirmTradeWithPartner', { code: state.code, partnerId, tradeId });
  setDrawerMode(null);
}

export function cancelTrade(tradeId?: number): void {
  playTone(340, 0.07);
  socket.emit('cancelTrade', { code: state.code, tradeId });
}

// ---------- Counter offer ----------

/** Opens the editor on the specified offer, pre-filled with its terms (what they give is what I get, and the reverse). */
export function startCounter(tradeId?: number): void {
  const trades = openTradesList();
  const t = (tradeId !== undefined ? trades.find(tr => tr.id === tradeId) : trades[0]);
  if (!t || t.fromId === socket.id) return;
  setCounterTradeId(t.id);
  for (const r of RESOURCES) {
    counterGet[r] = t.offer[r] || 0;
    counterGive[r] = t.request[r] || 0;
  }
  playTone(520, 0.06);
  refreshCounterView();
}

export function adjustCounter(side: 'get' | 'give', r: string, delta: number): void {
  const target = side === 'get' ? counterGet : counterGive;
  const before = target[r] || 0;
  let next = Math.max(0, before + delta);
  if (side === 'give') next = Math.min(next, myPlayerView()?.resources?.[r] ?? 0);
  if (next === before) return;
  target[r] = next;
  playTone(delta > 0 ? 480 : 420, 0.04);
  refreshCounterView();
}

export function sendCounter(tradeId?: number): void {
  const id = tradeId ?? counterTradeId;
  const t = openTradesList().find(tr => tr.id === id);
  if (!t) return;
  if (sum(counterGive) === 0 || sum(counterGet) === 0) {
    showToast('Pick at least 1 card to give and 1 card to get.');
    return;
  }
  playTone(580, 0.1);
  socket.emit('counterTrade', { code: state.code, tradeId: t.id, offer: { ...counterGive }, request: { ...counterGet } });
  setCounterTradeId(null);
  refreshCounterView();
}

export function cancelCounter(): void {
  setCounterTradeId(null);
  refreshCounterView();
}
