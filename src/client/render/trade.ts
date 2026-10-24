// MODULE: active trade offer box (top right), trade responses and the counter-offer editor | USED BY: render/index.ts, main.ts
import { RESOURCES, RES_META } from '../constants';
import { getMiniSvg, buildOverlappingStackHtml, uiIcon } from '../icons';
import { playTone } from '../audio';
import { socket } from '../socket';
import { state, setDrawerMode, counterTradeId, counterGet, counterGive, setCounterTradeId } from '../store';
import { esc } from '../util';
import { avatarFace } from '../avatars';
import { showToast } from '../ui';

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

// One resource in the counter editor: click the card to add one, use - / + for exact amounts.
function counterCellHtml(side: 'get' | 'give', r: string, n: number): string {
  return `
    <div class="counter-cell">
      <div class="mini-res-card card-${r}" onclick="adjustCounter('${side}','${r}',1)" title="Add ${esc(RES_META[r].name)}">
        ${getMiniSvg(r)}
      </div>
      <div class="counter-step">
        <button type="button" onclick="adjustCounter('${side}','${r}',-1)" title="Remove one">&minus;</button>
        <span class="${n > 0 ? 'on' : ''}">${n}</span>
        <button type="button" onclick="adjustCounter('${side}','${r}',1)" title="Add one">+</button>
      </div>
    </div>`;
}

// Renders the top-right trade box: opponent response badges, the two card rows, and accept / decline / confirm buttons.
export function renderActiveTradeModal(me: any): void {
  const box = document.getElementById('activeTradeModal')!;
  if (!state.activeTrade) {
    setCounterTradeId(null);
    box.style.display = 'none';
    return;
  }
  box.style.display = 'flex';
  const t = state.activeTrade;
  const isMyOffer = t.fromId === socket.id;
  const otherPlayers = state.players.filter(p => p.id !== t.fromId);
  // A counter draft belongs to one specific offer; drop it when that offer is gone or replaced.
  if (counterTradeId !== null && (counterTradeId !== t.id || isMyOffer)) setCounterTradeId(null);
  const editing = counterTradeId === t.id;

  const avatarsHtml = otherPlayers.map(p => {
    const resp = (t.responses && t.responses[p.id]) || 'pending';
    const cls = resp === 'accepted' ? 'ok' : resp === 'declined' ? 'no' : 'wait';
    const icon = resp === 'accepted' ? uiIcon('check', 11) : resp === 'declined' ? uiIcon('close', 11) : '';
    return `
      <div class="resp" title="${esc(p.name)}: ${esc(resp)}">
        <div class="avatar" style="background:${esc(p.color)}">${avatarFace(p.avatar, p.name)}</div>
        <div class="status ${cls}">${icon}</div>
      </div>`;
  }).join('');

  if (editing) {
    box.classList.add('trade-counter');
    const mine = me || myPlayerView();
    const canSend = sum(counterGive) > 0 && sum(counterGet) > 0 &&
      !!mine && RESOURCES.every(r => (counterGive[r] || 0) <= (mine.resources?.[r] || 0));
    box.innerHTML = `
      <div class="trade-top-avatars">${avatarsHtml}</div>
      <div class="trade-counter-title">${uiIcon('swap', 14)} Counter offer to ${esc(t.fromName)}</div>
      <div class="trade-offer-body">
        <div class="trade-rows">
          <div class="trade-row">
            <span class="trade-row-label">You get</span>
            ${RESOURCES.map(r => counterCellHtml('get', r, counterGet[r] || 0)).join('')}
          </div>
          <div class="trade-row">
            <span class="trade-row-label">You give</span>
            ${RESOURCES.map(r => counterCellHtml('give', r, counterGive[r] || 0)).join('')}
          </div>
        </div>
        <div class="trade-actions">
          <button class="act-circle ${canSend ? '' : 'off'}" ${canSend ? 'onclick="sendCounter()"' : 'disabled'}
            title="${canSend ? 'Send counter offer' : 'Pick cards you give (that you hold) and cards you get'}">${uiIcon('check', 20)}</button>
          <button class="act-circle no" onclick="cancelCounter()" title="Back to the offer">${uiIcon('close', 20)}</button>
        </div>
      </div>
    `;
    return;
  }
  box.classList.remove('trade-counter');

  // Rows are shown from my point of view, same order as the trade sheet: what I get on top, what I give below.
  const giveHtml = stacksHtml(isMyOffer ? t.offer : t.request);
  const getHtml = stacksHtml(isMyOffer ? t.request : t.offer);

  let actionsHtml = '';
  if (isMyOffer) {
    const accepted = otherPlayers.filter(p => t.responses && t.responses[p.id] === 'accepted');
    actionsHtml = accepted.map(p => `
      <button class="act-circle" style="background:${esc(p.color)}" onclick="confirmTradeWith('${esc(p.id)}')" title="Trade with ${esc(p.name)}">${uiIcon('check', 20)}</button>
    `).join('') + `
      <button class="act-circle no" onclick="cancelTrade()" title="Cancel offer">${uiIcon('close', 20)}</button>
    `;
  } else {
    const myResp = (t.responses && t.responses[socket.id]) || 'pending';
    const canAfford = !!me && RESOURCES.every(r => (t.request[r] || 0) <= (me.resources[r] || 0));
    actionsHtml = `
      <button class="act-circle ${canAfford ? '' : 'off'}" ${canAfford ? `onclick="respondToTrade('accepted')"` : 'disabled'}
        title="${canAfford ? 'Accept' : 'Not enough cards'}">${uiIcon('check', 20)}</button>
      <button class="act-circle edit" onclick="startCounter()" title="Edit and counter">${uiIcon('swap', 20)}</button>
      <button class="act-circle no ${myResp === 'declined' ? 'off' : ''}" onclick="respondToTrade('declined')" title="Decline">${uiIcon('close', 20)}</button>
    `;
  }

  box.innerHTML = `
    <div class="trade-top-avatars">${avatarsHtml}</div>
    <div class="trade-offer-body">
      <div class="trade-rows">
        <div class="trade-row">
          <span class="trade-row-label">You get</span>
          ${getHtml}
        </div>
        <div class="trade-row">
          <span class="trade-row-label">You give</span>
          ${giveHtml}
        </div>
      </div>
      <div class="trade-actions">${actionsHtml}</div>
    </div>
  `;
}

export function respondToTrade(decision: string): void {
  playTone(decision === 'accepted' ? 680 : 300, 0.1);
  socket.emit('respondTrade', { code: state.code, decision });
}

export function confirmTradeWith(partnerId: string): void {
  playTone(760, 0.12);
  socket.emit('confirmTradeWithPartner', { code: state.code, partnerId });
  setDrawerMode(null);
}

export function cancelTrade(): void {
  socket.emit('cancelTrade', { code: state.code });
}

// ---------- Counter offer ----------

/** Opens the editor on the current offer, pre-filled with its terms (what they give is what I get, and the reverse). */
export function startCounter(): void {
  const t = state.activeTrade;
  if (!t || t.fromId === socket.id) return;
  setCounterTradeId(t.id);
  for (const r of RESOURCES) {
    counterGet[r] = t.offer[r] || 0;
    counterGive[r] = t.request[r] || 0;
  }
  playTone(520, 0.06);
  renderActiveTradeModal(myPlayerView());
}

export function adjustCounter(side: 'get' | 'give', r: string, delta: number): void {
  const target = side === 'get' ? counterGet : counterGive;
  let next = Math.max(0, (target[r] || 0) + delta);
  if (side === 'give') next = Math.min(next, myPlayerView()?.resources?.[r] ?? 0);
  target[r] = next;
  playTone(delta > 0 ? 480 : 420, 0.04);
  renderActiveTradeModal(myPlayerView());
}

export function sendCounter(): void {
  const t = state.activeTrade;
  if (!t || counterTradeId !== t.id) return;
  if (sum(counterGive) === 0 || sum(counterGet) === 0) {
    showToast('Pick at least 1 card to give and 1 card to get.');
    return;
  }
  playTone(580, 0.1);
  socket.emit('counterTrade', { code: state.code, offer: { ...counterGive }, request: { ...counterGet } });
  setCounterTradeId(null);
}

export function cancelCounter(): void {
  setCounterTradeId(null);
  renderActiveTradeModal(myPlayerView());
}
