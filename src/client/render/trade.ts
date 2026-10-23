import { RESOURCES, RES_META } from '../constants';
import { getMiniSvg, buildOverlappingStackHtml } from '../icons';
import { playTone } from '../audio';
import { socket } from '../socket';
import { state, setDrawerMode } from '../store';

// Renders the top-right active trade box (with bot/player response icons and click-to-confirm).
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

  // Top bar with opponent avatars and their response badges
  const avatarsHtml = otherPlayers.map(p => {
    const resp = (t.responses && t.responses[p.id]) || 'pending';
    let badgeBg = '#0288d1', badgeTxt = '⏳';
    if (resp === 'accepted') { badgeBg = '#2e7d32'; badgeTxt = '✔'; }
    else if (resp === 'declined') { badgeBg = '#c62828'; badgeTxt = '✖'; }

    return `
      <div class="trade-resp-avatar" style="background:${p.color}" title="${p.name}: ${resp.toUpperCase()}">
        <span>${p.avatar}</span>
        <div class="status-dot" style="background:${badgeBg}">${badgeTxt}</div>
      </div>
    `;
  }).join('');

  const wantCardsHtml = RESOURCES.filter(r => t.request[r] > 0).map(r =>
    buildOverlappingStackHtml(`card-${r}`, getMiniSvg(r), t.request[r], '', RES_META[r].name)
  ).join('');

  const giveCardsHtml = RESOURCES.filter(r => t.offer[r] > 0).map(r =>
    buildOverlappingStackHtml(`card-${r}`, getMiniSvg(r), t.offer[r], '', RES_META[r].name)
  ).join('');

  let actionButtonsHtml = '';
  if (isMyOffer) {
    // Clickable ✔ button for every player/bot who accepted
    const acceptedPlayers = otherPlayers.filter(p => t.responses && t.responses[p.id] === 'accepted');
    actionButtonsHtml = acceptedPlayers.map(p => `
      <button class="trade-act-btn" style="background:${p.color}" onclick="confirmTradeWith('${p.id}')" title="Complete Trade with ${p.name}!">✔</button>
    `).join('') + `
      <button class="trade-act-btn" style="background:#ef5350" onclick="cancelTrade()" title="Cancel Trade Offer">✖</button>
    `;
  } else {
    const myResp = (t.responses && t.responses[socket.id]) || 'pending';
    const canAfford = me && RESOURCES.every(r => (t.request[r] || 0) <= (me.resources[r] || 0));
    actionButtonsHtml = `
      <button class="trade-act-btn" style="background:#4caf50; ${!canAfford ? 'opacity:0.4; cursor:not-allowed;' : ''}"
        onclick="${canAfford ? `respondToTrade('accepted')` : ''}" title="${canAfford ? 'Accept Trade' : 'Not enough cards'}">✔</button>
      <button class="trade-act-btn" style="background:#ef5350; ${myResp === 'declined' ? 'opacity:0.4;' : ''}"
        onclick="respondToTrade('declined')" title="Decline Trade">✖</button>
    `;
  }

  box.innerHTML = `
    <div class="trade-top-avatars">${avatarsHtml}</div>
    <div class="trade-offer-body">
      <div style="display:flex; flex-direction:column; gap:6px;">
        <div class="res-Select-row">
          <span style="font-size:13px; font-weight:900; color:#2e7d32; width:58px;">👥 ⬇</span>
          ${ isMyOffer ? wantCardsHtml : giveCardsHtml }
        </div>
        <div class="res-Select-row">
          <span style="font-size:13px; font-weight:900; color:#c62828; width:58px;">${t.fromAvatar} ⬆</span>
          ${ isMyOffer ? giveCardsHtml : wantCardsHtml }
        </div>
      </div>
      <div style="display:flex; gap:6px; align-items:center;">
        ${actionButtonsHtml}
      </div>
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
