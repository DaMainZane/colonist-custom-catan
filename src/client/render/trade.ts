// MODULE: active trade offer box (top right) and trade responses | USED BY: render/index.ts, main.ts
import { RESOURCES, RES_META } from '../constants';
import { getMiniSvg, buildOverlappingStackHtml, uiIcon } from '../icons';
import { playTone } from '../audio';
import { socket } from '../socket';
import { state, setDrawerMode } from '../store';
import { esc, initial } from '../util';

function stacksHtml(counts: Record<string, number>): string {
  return RESOURCES.filter(r => counts[r] > 0).map(r =>
    buildOverlappingStackHtml(`card-${r}`, getMiniSvg(r), counts[r], '', RES_META[r].name)
  ).join('');
}

// Renders the top-right trade box: opponent response badges, the two card rows, and accept / decline / confirm buttons.
export function renderActiveTradeModal(me: any): void {
  const box = document.getElementById('activeTradeModal')!;
  if (!state.activeTrade) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'flex';
  const t = state.activeTrade;
  const isMyOffer = t.fromId === socket.id;
  const otherPlayers = state.players.filter(p => p.id !== t.fromId);

  const avatarsHtml = otherPlayers.map(p => {
    const resp = (t.responses && t.responses[p.id]) || 'pending';
    const cls = resp === 'accepted' ? 'ok' : resp === 'declined' ? 'no' : 'wait';
    const icon = resp === 'accepted' ? uiIcon('check', 11) : resp === 'declined' ? uiIcon('close', 11) : '';
    return `
      <div class="resp" title="${esc(p.name)}: ${esc(resp)}">
        <div class="avatar" style="background:${esc(p.color)}">${initial(p.name)}</div>
        <div class="status ${cls}">${icon}</div>
      </div>`;
  }).join('');

  // Rows are shown from my point of view: first what I give, then what I get.
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
      <button class="act-circle no ${myResp === 'declined' ? 'off' : ''}" onclick="respondToTrade('declined')" title="Decline">${uiIcon('close', 20)}</button>
    `;
  }

  box.innerHTML = `
    <div class="trade-top-avatars">${avatarsHtml}</div>
    <div class="trade-offer-body">
      <div class="trade-rows">
        <div class="trade-row">
          <span class="trade-row-label">You give</span>
          ${giveHtml}
        </div>
        <div class="trade-row">
          <span class="trade-row-label">You get</span>
          ${getHtml}
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
