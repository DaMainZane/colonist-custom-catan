import { RESOURCES, RES_META } from '../constants';
import { getMiniSvg, buildOverlappingStackHtml } from '../icons';
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
    // When discarding or trading, subtract cards currently placed in the tray so they visually move!
    let count = me.resources[r] || 0;
    if (drawerMode === 'discard') count = Math.max(0, count - (discardSel[r] || 0));
    else if (drawerMode === 'trade') count = Math.max(0, count - (tradeGive[r] || 0));

    if (count <= 0 && state.status !== 'LOBBY') return '';
    if (count <= 0 && state.status === 'LOBBY') {
      return `
        <div class="mini-res-card card-${r}" style="opacity:0.55;">
          ${getMiniSvg(r)}
          <div class="corner-ribbon">0</div>
        </div>
      `;
    }
    return buildOverlappingStackHtml(
      `card-${r}`,
      getMiniSvg(r),
      count,
      `onClickHandResource('${r}')`,
      `Click to select ${RES_META[r].name}`
    );
  }).join('');

  const allDevs = [...(me.devCards || []), ...(me.newDevCards || [])];
  const devCounts: Record<string, number> = {};
  allDevs.forEach((c: string) => devCounts[c] = (devCounts[c] || 0) + 1);
  const devIcons: Record<string, string> = { knight: '⚔️', roadBuilding: '🛣️', yearOfPlenty: '🎁', monopoly: '🎩', vp: '⭐' };

  Object.keys(devCounts).forEach(c => {
    const canPlay = isMyTurn && !me.playedDevCardThisTurn && (me.devCards || []).includes(c) && c !== 'vp';
    html += buildOverlappingStackHtml(
      'card-dev',
      `<span style="font-size:20px">${devIcons[c] || '🃏'}</span>`,
      devCounts[c],
      canPlay ? `onClickDevCard('${c}')` : '',
      `Dev Card: ${c}`,
      canPlay ? 'outline:2.5px solid #ffd700;' : 'opacity:0.85;'
    );
  });

  if (!html) {
    html = `<span style="font-size:13px; font-weight:700; color:#888;">No cards in hand</span>`;
  }
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
      renderHand(me, isMyTurn);
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
      renderHand(me, isMyTurn);
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
