// MODULE: bottom-left sheet (trade, discard, gold, monopoly, robber victim picker) | USED BY: render/index.ts, hand.ts, main.ts
// Flat sheet from "Design UI Philosophy.md": no emoji, pictogram icons, every color comes from a token class in styles.css.
import { RESOURCES, RES_META } from '../constants';
import { getMiniSvg, buildOverlappingStackHtml, uiIcon, robberMarkup } from '../icons';
import { playTone } from '../audio';
import { socket } from '../socket';
import {
  state, drawerMode, tradeGive, tradeWant, discardSel, clearRes,
  setDrawerMode, setBuildModeValue
} from '../store';
import { renderAll } from './index';
import { renderHand } from './hand';
import { esc } from '../util';
import { avatarFace } from '../avatars';
import { showToast } from '../ui';

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

// Counter adjusters used by inline onclick handlers inside the sheet markup.
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

// One pickable resource card. `rate` adds the small ratio chip underneath (trade sheet only).
function pickCardHtml(r: string, onclick: string, title: string, rate?: number): string {
  const rateHtml = rate !== undefined
    ? `<span class="rate ${rate < 4 ? 'better' : ''}">${rate}:1</span>`
    : '';
  return `
    <div class="mini-res-card card-${r}" onclick="${onclick}" title="${esc(title)}">
      ${getMiniSvg(r)}
      ${rateHtml}
    </div>`;
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
      <div class="sheet-head">
        <span class="sheet-title">${getMiniSvg('gold').replace('width="28" height="28"', 'width="22" height="22"')} Gold reward</span>
        <span class="sheet-sub">Pick ${me.goldPending} resource${me.goldPending === 1 ? '' : 's'}</span>
      </div>
      <div class="pick-row">
        ${RESOURCES.map(r => pickCardHtml(r, `pickGold('${r}')`, `Take ${RES_META[r].name}`)).join('')}
      </div>
    `;
  } else if (drawerMode === 'monopoly') {
    btnCancel.style.display = 'flex';
    drawer.innerHTML = `
      <div class="sheet-head">
        <span class="sheet-title">Monopoly</span>
      </div>
      <div class="sheet-sub">Pick a resource. Every other player hands you all of theirs.</div>
      <div class="pick-row">
        ${RESOURCES.map(r => pickCardHtml(r, `confirmMonopoly('${r}')`, `Take all ${RES_META[r].name}`)).join('')}
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
      <div class="sheet-head">
        <span class="sheet-title danger">Discard ${me.discardPending} cards</span>
        <span class="sheet-sub">${picked} of ${me.discardPending} chosen</span>
      </div>
      <div class="sheet-sub">A 7 was rolled and you hold more than ${state.settings.cardDiscardLimit} cards. Click cards in your hand to move them here.</div>
      <div class="tray">
        ${trayCardsHtml || '<span class="tray-hint">Nothing chosen yet</span>'}
      </div>
      <div class="sheet-foot">
        <button class="btn primary" ${!isReady ? 'disabled' : ''} onclick="confirmInlineAction()" title="Confirm discard">${uiIcon('check', 18)}Discard</button>
      </div>
    `;
  } else if (drawerMode === 'robberSteal') {
    const victims = (state.robberVictims || [])
      .map((id: string) => state.players.find(p => p.id === id))
      .filter(Boolean);
    drawer.innerHTML = `
      <div class="sheet-head">
        <span class="sheet-title danger">
          <svg width="20" height="24" viewBox="-14 -24 28 40" aria-hidden="true">${robberMarkup()}</svg>
          Choose who to rob
        </span>
      </div>
      <div class="pick-row">
        ${victims.map((v: any) => `
          <button class="victim-btn" onclick="chooseRobberVictim('${esc(v.id)}')" title="Steal a card from ${esc(v.name)}">
            <span class="avatar" style="background:${esc(v.color)}">${avatarFace(v.avatar, v.name)}</span>
            <span>${esc(v.name)}</span>
            <span class="count">${uiIcon('cards', 14)}${v.resourceCount}</span>
          </button>
        `).join('')}
      </div>
    `;
  } else if (drawerMode === 'trade') {
    btnCancel.style.display = 'flex';
    sideStack.style.display = 'flex';

    const bankOk = canExecuteBankTrade(me);
    (document.getElementById('btnExecBankTrade') as HTMLButtonElement).disabled = !bankOk;
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

    const giveSum = RESOURCES.reduce((s, r) => s + (tradeGive[r] || 0), 0);
    const wantSum = RESOURCES.reduce((s, r) => s + (tradeWant[r] || 0), 0);
    let hint = 'Click a resource above for what you want, then cards in your hand for what you give.';
    if (bankOk) hint = 'Bank trade is ready.';
    else if (giveSum > 0 || wantSum > 0) hint = 'Bank trades need exact ratios. Offer it to players instead, or adjust the cards.';

    drawer.innerHTML = `
      <div class="sheet-head">
        <span class="sheet-title">${uiIcon('swap', 18)} Trade</span>
        <span class="sheet-sub">Ratios show your bank and port rates</span>
      </div>
      <div class="pick-row">
        ${RESOURCES.map(r => pickCardHtml(r, `adjustTradeWant('${r}', 1)`, `Want ${RES_META[r].name} (${ratios[r]}:1 with the bank)`, ratios[r])).join('')}
      </div>
      <div class="sheet-label">You get</div>
      <div class="tray">
        ${wantStacksHtml || '<span class="tray-hint">Pick resources above</span>'}
      </div>
      <div class="sheet-label">You give</div>
      <div class="tray">
        ${giveStacksHtml || '<span class="tray-hint">Click cards in your hand</span>'}
      </div>
      <div class="trade-hint ${bankOk ? 'ok' : ''}">${hint}</div>
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
  // The bank can only hand out what it still holds.
  for (const r of RESOURCES) {
    const want = tradeWant[r] || 0;
    if (want > 0 && (state.bank?.[r] ?? 0) < want) {
      const have = state.bank?.[r] ?? 0;
      showToast(have === 0 ? `The bank has no ${RES_META[r].name} left.` : `The bank only has ${have} ${RES_META[r].name} left.`);
      playTone(300, 0.1);
      return;
    }
  }
  playTone(620, 0.1);
  socket.emit('bankTrade', { code: state.code, give: tradeGive, get: tradeWant });
  setDrawerMode(null);
  renderAll();
}

export function proposePlayerTrade(): void {
  const me = myPlayer();
  // Hands are hidden, but cards are conserved: nobody else holds a resource when the bank plus my hand already add up to the full supply.
  if (me?.resources) {
    const supply = Number(state.settings?.bankResourcePerType) || 0;
    for (const r of RESOURCES) {
      if ((tradeWant[r] || 0) <= 0) continue;
      const others = supply - (state.bank?.[r] ?? 0) - (me.resources[r] || 0);
      if (supply > 0 && others <= 0) {
        showToast(`No one has any ${RES_META[r].name} to trade.`);
        playTone(300, 0.1);
        return;
      }
    }
  }
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
