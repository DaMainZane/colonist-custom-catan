import { RESOURCES, RES_META } from '../constants';
import { getMiniSvg, buildOverlappingStackHtml } from '../icons';
import { playTone } from '../audio';
import { socket } from '../socket';
import {
  state, drawerMode, tradeGive, tradeWant, discardSel, clearRes,
  setDrawerMode, setBuildModeValue
} from '../store';
import { renderAll } from './index';
import { renderHand } from './hand';

function myPlayer(): any {
  return state.players.find(p => p.id === socket.id);
}

export function canExecuteBankTrade(me: any): boolean {
  if (!me || !me.resources) return false;
  const ratios = state.tradeRatios || { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };
  let credits = 0;
  for (const r of RESOURCES) {
    const g = tradeGive[r] || 0;
    if (g > me.resources[r] || g % ratios[r] !== 0) return false;
    credits += g / ratios[r];
  }
  const wanted = RESOURCES.reduce((s, r) => s + (tradeWant[r] || 0), 0);
  return credits > 0 && credits === wanted;
}

export function canProposePlayerTrade(me: any): boolean {
  if (!me || !me.resources) return false;
  const giveSum = RESOURCES.reduce((s, r) => s + (tradeGive[r] || 0), 0);
  const wantSum = RESOURCES.reduce((s, r) => s + (tradeWant[r] || 0), 0);
  return giveSum > 0 && wantSum > 0;
}

// Counter adjusters used by inline onclick handlers inside the drawer markup.
export function adjustDiscard(r: string, delta: number): void {
  discardSel[r] = Math.max(0, (discardSel[r] || 0) + delta);
  const me = myPlayer();
  const isMyTurn = state.players[state.turnIndex]?.id === socket.id;
  renderHand(me, isMyTurn);
  renderInlineDrawer(me, isMyTurn);
}
export function removeCardFromDiscard(r: string): void {
  if (discardSel[r] > 0) {
    discardSel[r]--;
    playTone(420, 0.05);
    const me = myPlayer();
    const isMyTurn = state.players[state.turnIndex]?.id === socket.id;
    renderHand(me, isMyTurn);
    renderInlineDrawer(me, isMyTurn);
  }
}
export function adjustTradeWant(r: string, delta: number): void {
  tradeWant[r] = Math.max(0, (tradeWant[r] || 0) + delta);
  renderInlineDrawer(myPlayer(), true);
}
export function adjustTradeGive(r: string, delta: number): void {
  tradeGive[r] = Math.max(0, (tradeGive[r] || 0) + delta);
  const me = myPlayer();
  renderHand(me, true);
  renderInlineDrawer(me, true);
}

export function renderInlineDrawer(me: any, isMyTurn: boolean): void {
  const wrap = document.getElementById('inlineDrawerWrap')!;
  const drawer = document.getElementById('inlineDrawer')!;
  const sideStack = document.getElementById('tradeConfirmStack')!;
  const btnOk = document.getElementById('btnConfirmAction');
  const btnCancel = document.getElementById('btnCancelAction')!;
  if (btnOk) btnOk.style.display = 'none';
  btnCancel.style.display = 'none';
  sideStack.style.display = 'none';

  if (!drawerMode || !me) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'flex';

  if (drawerMode === 'gold') {
    drawer.innerHTML = `
      <div style="font-weight:900; color:#b26a00; font-size:13.5px; display:flex; align-items:center; gap:6px;">
        ${getMiniSvg('gold')} <span>Gold Reward — Click ${me.goldPending} Resource(s) to Claim:</span>
      </div>
      <div class="res-Select-row">
        ${RESOURCES.map(r => `
          <div class="mini-res-card card-${r}" onclick="pickGold('${r}')">
            ${getMiniSvg(r)}
          </div>
        `).join('')}
      </div>
    `;
  } else if (drawerMode === 'monopoly') {
    btnCancel.style.display = 'flex';
    drawer.innerHTML = `
      <div style="font-weight:900; color:#6a1b9a; font-size:13.5px;">🎩 Monopoly — Click a Resource to Steal All:</div>
      <div class="res-Select-row">
        ${RESOURCES.map(r => `
          <div class="mini-res-card card-${r}" onclick="confirmMonopoly('${r}')">
            ${getMiniSvg(r)}
          </div>
        `).join('')}
      </div>
    `;
  } else if (drawerMode === 'discard') {
    const picked = RESOURCES.reduce((s, r) => s + discardSel[r], 0);
    const isReady = picked === me.discardPending;

    const trayCardsHtml = RESOURCES.filter(r => discardSel[r] > 0).map(r =>
      buildOverlappingStackHtml(
        `card-${r}`,
        getMiniSvg(r),
        discardSel[r],
        `removeCardFromDiscard('${r}')`,
        'Click to return to hand'
      )
    ).join('');

    drawer.innerHTML = `
      <div class="discard-header">
        <div class="discard-q-card">
          <span class="up-arr">⬆</span>
          <span>?</span>
        </div>
        <div>
          <div style="color:#c62828; font-size:18px; font-weight:900;">Discard Cards (${picked}/${me.discardPending})</div>
          <div style="color:#333; font-size:12.5px; font-weight:600; line-height:1.35; margin-top:2px;">
            7 was rolled! You have more than ${state.settings.cardDiscardLimit} cards.<br>
            You need to discard ${me.discardPending} of them
          </div>
        </div>
      </div>
      <div class="discard-tray">
        ${trayCardsHtml || '<span style="font-size:12px; color:#777; font-weight:600;">Click cards in your hand below to move them here...</span>'}
      </div>
      <div style="display:flex; justify-content:flex-end;">
        <button class="discard-confirm-btn" ${!isReady ? 'disabled' : ''} onclick="confirmInlineAction()" title="Confirm Discard">✔</button>
      </div>
    `;
  } else if (drawerMode === 'robberSteal') {
    const victimIds = state.robberVictims || [];
    const victims = victimIds
      .map((id: string) => state.players.find(p => p.id === id))
      .filter(Boolean);
    drawer.innerHTML = `
      <div style="font-weight:900; color:#c62828; font-size:13.5px; display:flex; align-items:center; gap:6px;">
        <span>♟️ Choose a Player to Rob:</span>
      </div>
      <div class="res-Select-row" style="gap:8px;">
        ${victims.map((v: any) => `
          <button class="colonist-btn" style="background:${v.color}; padding:7px 12px; display:flex; align-items:center; gap:7px; border-radius:10px;"
            onclick="chooseRobberVictim('${v.id}')">
            <span style="font-size:17px;">${v.avatar}</span>
            <span style="font-weight:900;">${v.name}</span>
            <span style="background:rgba(0,0,0,0.28); padding:2px 6px; border-radius:6px; font-size:11.5px;">🃏 ${v.resourceCount}</span>
          </button>
        `).join('')}
      </div>
    `;
  } else if (drawerMode === 'trade') {
    btnCancel.style.display = 'flex';
    sideStack.style.display = 'flex';

    (document.getElementById('btnExecBankTrade') as HTMLButtonElement).disabled = !canExecuteBankTrade(me);
    (document.getElementById('btnExecPlayerTrade') as HTMLButtonElement).disabled = !canProposePlayerTrade(me);

    const ratios = state.tradeRatios || { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };
    const wantStacksHtml = RESOURCES.filter(r => tradeWant[r] > 0).map(r =>
      buildOverlappingStackHtml(
        `card-${r}`,
        getMiniSvg(r),
        tradeWant[r],
        `adjustTradeWant('${r}', -1)`,
        'Click to remove'
      )
    ).join('');

    const giveStacksHtml = RESOURCES.filter(r => tradeGive[r] > 0).map(r =>
      buildOverlappingStackHtml(
        `card-${r}`,
        getMiniSvg(r),
        tradeGive[r],
        `adjustTradeGive('${r}', -1)`,
        'Click to return to hand'
      )
    ).join('');

    drawer.innerHTML = `
      <div class="res-Select-row" style="justify-content:space-between; border-bottom:1px solid #d4cbb8; padding-bottom:6px;">
        ${RESOURCES.map(r => `
          <div class="mini-res-card card-${r}" onclick="adjustTradeWant('${r}', 1)" title="Click to add ${RES_META[r].name} to Wanted (${ratios[r]}:1 Bank)">
            ${getMiniSvg(r)}
            <span style="font-size:9.5px; color:#fff;">${ratios[r]}:1</span>
          </div>
        `).join('')}
        <span style="font-size:20px;" title="Bank / Port Ratios">🏦</span>
      </div>
      <div class="res-Select-row" style="min-height:68px; background:#e8e0d2; padding:4px 8px; border-radius:6px;">
        <span style="font-weight:900; color:#2e7d32; font-size:13px; width:46px;">👥 ⬇</span>
        ${wantStacksHtml || '<span style="font-size:11.5px; color:#666;">Click resource icons above that you WANT...</span>'}
      </div>
      <div class="res-Select-row" style="min-height:68px; background:#e8e0d2; padding:4px 8px; border-radius:6px;">
        <span style="font-weight:900; color:#c62828; font-size:13px; width:46px;">${me.avatar} ⬆</span>
        ${giveStacksHtml || '<span style="font-size:11.5px; color:#666;">Click cards in your hand below to GIVE...</span>'}
      </div>
    `;
  }
}

export function toggleTradeDrawer(): void {
  if (drawerMode === 'trade') {
    setDrawerMode(null);
  } else {
    clearRes(tradeGive);
    clearRes(tradeWant);
    setDrawerMode('trade');
  }
  renderAll();
}

export function closeInlineDrawer(): void {
  clearRes(tradeGive);
  clearRes(tradeWant);
  setDrawerMode(null);
  setBuildModeValue(null);
  renderAll();
}

export function confirmInlineAction(): void {
  if (drawerMode === 'discard') {
    playTone(620, 0.1);
    socket.emit('discardCards', { code: state.code, discards: discardSel });
    setDrawerMode(null);
  }
  renderAll();
}

export function executeBankTrade(): void {
  playTone(620, 0.1);
  socket.emit('bankTrade', { code: state.code, give: tradeGive, get: tradeWant });
  setDrawerMode(null);
  renderAll();
}

export function proposePlayerTrade(): void {
  playTone(580, 0.1);
  socket.emit('proposeTrade', { code: state.code, offer: tradeGive, request: tradeWant });
}

export function confirmMonopoly(r: string): void {
  socket.emit('playDevCard', { code: state.code, cardType: 'monopoly', monopolyResource: r });
  setDrawerMode(null);
  renderAll();
}

export function pickGold(resource: string): void {
  playTone(780, 0.1);
  socket.emit('pickGoldResource', { code: state.code, resource });
}

export function chooseRobberVictim(victimId: string): void {
  playTone(340, 0.11);
  socket.emit('stealFromPlayer', { code: state.code, victimId });
  setDrawerMode(null);
}

