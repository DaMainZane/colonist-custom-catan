import { RESOURCES, RES_META } from '../constants';
import { getMiniSvg } from '../icons';
import { playTone } from '../audio';
import { socket } from '../socket';
import { state, drawerMode, tradeGive, tradeWant, discardSel, clearRes, setDrawerMode } from '../store';
import { renderInlineDrawer } from './drawer';

export function renderHand(me: any, isMyTurn: boolean): void {
  const panel = document.getElementById('myHandPanel')!;
  if (!me || !me.resources) {
    panel.innerHTML = '<span style="font-weight:700; color:#666;">Spectating</span>';
    return;
  }

  let html = RESOURCES.map(r => {
    const count = me.resources[r] || 0;
    return `
      <div class="card-stack card-${r}" onclick="onClickHandResource('${r}')" title="Click to Offer ${RES_META[r].name} in Trade / Discard">
        ${getMiniSvg(r)}
        <div class="count-badge">${count}</div>
      </div>
    `;
  }).join('');

  const allDevs = [...(me.devCards || []), ...(me.newDevCards || [])];
  const devCounts: Record<string, number> = {};
  allDevs.forEach((c: string) => devCounts[c] = (devCounts[c] || 0) + 1);
  const devIcons: Record<string, string> = { knight: '⚔️', roadBuilding: '🛣️', yearOfPlenty: '🎁', monopoly: '🎩', vp: '⭐' };

  Object.keys(devCounts).forEach(c => {
    const canPlay = isMyTurn && !me.playedDevCardThisTurn && (me.devCards || []).includes(c) && c !== 'vp';
    html += `
      <div class="card-stack card-dev" style="${canPlay ? 'outline:2.5px solid #ffd700;' : 'opacity:0.85;'}"
        onclick="${canPlay ? `onClickDevCard('${c}')` : ''}" title="Dev Card: ${c} (Click to Play)">
        <span style="font-size:20px">${devIcons[c] || '🃏'}</span>
        <div class="count-badge">${devCounts[c]}</div>
      </div>
    `;
  });

  panel.innerHTML = html;
}

export function onClickHandResource(r: string): void {
  const me = state.players.find(p => p.id === socket.id);
  const isMyTurn = state.players[state.turnIndex]?.id === socket.id;
  if (!me) return;

  if (drawerMode === 'discard') {
    const totalSelected = RESOURCES.reduce((s, k) => s + discardSel[k], 0);
    if (discardSel[r] < me.resources[r] && totalSelected < me.discardPending) {
      discardSel[r]++;
      playTone(500, 0.05);
      renderInlineDrawer(me, isMyTurn);
    }
  } else if (isMyTurn && state.phase === 'MAIN') {
    // Clicking a resource in hand opens the trade drawer and adds it to Give
    if (drawerMode !== 'trade') {
      clearRes(tradeGive);
      clearRes(tradeWant);
      setDrawerMode('trade');
    }
    if (tradeGive[r] < me.resources[r]) {
      tradeGive[r]++;
      playTone(480, 0.05);
      renderInlineDrawer(me, isMyTurn);
    }
  }
}

export function onClickDevCard(cardType: string): void {
  if (cardType === 'monopoly') {
    setDrawerMode('monopoly');
    renderInlineDrawer(state.players.find(p => p.id === socket.id), true);
  } else {
    socket.emit('playDevCard', { code: state.code, cardType });
    playTone(620, 0.12);
  }
}
