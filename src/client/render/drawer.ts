import { RESOURCES, RES_META } from '../constants';
import { getMiniSvg } from '../icons';
import { playTone } from '../audio';
import { socket } from '../socket';
import {
  state, drawerMode, tradeGive, tradeWant, discardSel, clearRes,
  setDrawerMode, setBuildModeValue
} from '../store';
import { renderAll } from './index';

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
  discardSel[r] += delta;
  renderInlineDrawer(myPlayer(), true);
}
export function adjustTradeWant(r: string, delta: number): void {
  tradeWant[r] += delta;
  renderInlineDrawer(myPlayer(), true);
}
export function adjustTradeGive(r: string, delta: number): void {
  tradeGive[r] += delta;
  renderInlineDrawer(myPlayer(), true);
}

export function renderInlineDrawer(me: any, isMyTurn: boolean): void {
  const wrap = document.getElementById('inlineDrawerWrap')!;
  const drawer = document.getElementById('inlineDrawer')!;
  const sideStack = document.getElementById('tradeConfirmStack')!;
  const btnOk = document.getElementById('btnConfirmAction')!;
  const btnCancel = document.getElementById('btnCancelAction')!;
  btnOk.style.display = 'none';
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
    btnOk.style.display = picked === me.discardPending ? 'flex' : 'none';
    drawer.innerHTML = `
      <div style="font-weight:900; color:#c62828; font-size:13px;">
        Rolled 7! Click cards in your hand below to discard (${picked}/${me.discardPending}):
      </div>
      <div class="res-Select-row">
        ${RESOURCES.map(r => discardSel[r] > 0 ? `
          <div class="mini-res-card card-${r}" onclick="adjustDiscard('${r}', -1)">
            ${getMiniSvg(r)}
            <div class="badge">${discardSel[r]}</div>
          </div>
        ` : '').join('') || '<span style="font-size:12px; color:#777;">Click cards in your hand below...</span>'}
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
      <div class="res-Select-row" style="min-height:58px; background:#e8e0d2; padding:4px 8px; border-radius:6px;">
        <span style="font-weight:900; color:#2e7d32; font-size:13px; width:46px;">👥 ⬇</span>
        ${RESOURCES.filter(r => tradeWant[r] > 0).map(r => `
          <div class="mini-res-card card-${r}" onclick="adjustTradeWant('${r}', -1)">
            ${getMiniSvg(r)}<div class="badge">${tradeWant[r]}</div>
          </div>
        `).join('') || '<span style="font-size:11.5px; color:#666;">Click resource icons above that you WANT...</span>'}
      </div>
      <div class="res-Select-row" style="min-height:58px; background:#e8e0d2; padding:4px 8px; border-radius:6px;">
        <span style="font-weight:900; color:#c62828; font-size:13px; width:46px;">${me.avatar} ⬆</span>
        ${RESOURCES.filter(r => tradeGive[r] > 0).map(r => `
          <div class="mini-res-card card-${r}" onclick="adjustTradeGive('${r}', -1)">
            ${getMiniSvg(r)}<div class="badge">${tradeGive[r]}</div>
          </div>
        `).join('') || '<span style="font-size:11.5px; color:#666;">Click cards in your hand below to GIVE...</span>'}
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
  setDrawerMode(null);
  setBuildModeValue(null);
  renderAll();
}

export function confirmInlineAction(): void {
  if (drawerMode === 'discard') {
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

