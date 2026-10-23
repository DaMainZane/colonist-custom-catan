import { socket } from '../socket';
import { state, buildMode, victoryTab, hideVictoryOverlay } from '../store';
import { renderActiveTradeModal } from './trade';
import { renderHand } from './hand';
import { renderInlineDrawer } from './drawer';
import { renderSidebar } from './sidebar';
import { renderBoard } from './board';

export function renderAll(): void {
  const me = state.players.find(p => p.id === socket.id);
  const current = state.players[state.turnIndex];
  const isMyTurn = !!current && current.id === socket.id;

  const lobbyBar = document.getElementById('lobbyToolbar')!;
  if (state.status === 'LOBBY') {
    const s = state.settings;
    const setVal = (id: string, v: any) => { (document.getElementById(id) as HTMLInputElement).value = v; };
    setVal('setRadius', s.boardRadius);
    setVal('setVp', s.vpToWin);
    setVal('setMaxP', s.maxPlayers);
    setVal('setDiscard', s.cardDiscardLimit);
    setVal('setGold', s.goldTiles);
    setVal('setDesert', s.desertTiles);
    if (document.getElementById('setFog')) setVal('setFog', s.fogTiles ?? 0);
    setVal('setBankRes', s.bankResourcePerType);
    setVal('setDevKnight', s.devKnights);
    setVal('setDevVp', s.devVp);
    setVal('setDevRb', s.devRoadBuilding);
    setVal('setDevYop', s.devYearOfPlenty);
    setVal('setDevMono', s.devMonopoly);
    setVal('setMaxRoad', s.maxRoads);
    setVal('setMaxSettle', s.maxSettlements);
    setVal('setMaxCity', s.maxCities);
  } else {
    lobbyBar.style.display = 'none';
  }

  document.getElementById('die1')!.textContent = String(state.lastDice[0]);
  document.getElementById('die2')!.textContent = String(state.lastDice[1]);

  // Piece badges on buttons
  if (me) {
    document.getElementById('badgeRoadCnt')!.textContent = String(me.roadsLeft);
    document.getElementById('badgeSettleCnt')!.textContent = String(me.settlementsLeft);
    document.getElementById('badgeCityCnt')!.textContent = String(me.citiesLeft);
  }

  const pill = document.getElementById('turnStatusPill')!;
  if (state.status === 'LOBBY') {
    pill.innerHTML = `🏠 Room <strong>${state.code}</strong> — Paint Map or Add Hard Bots`;
  } else if (state.status === 'GAMEOVER') {
    pill.innerHTML = `🏆 <strong>${state.winner?.name}</strong> Won the Game!`;
  } else {
    const phaseTxt = ({
      SETUP_SETTLEMENT: 'Place Settlement',
      SETUP_ROAD: 'Place Road',
      ROLL: 'Roll Dice',
      GOLD_PICK: 'Pick Gold Resource',
      DISCARD: 'Waiting for Discards (7 Rolled)',
      ROBBER: 'Move Robber',
      ROBBER_STEAL: 'Choose Player to Rob',
      MAIN: 'Turn'
    } as Record<string, string>)[state.phase] || state.phase;
    pill.innerHTML = `<span>${current?.avatar || ''}</span> <strong>${current?.name}</strong> — ${phaseTxt}`;
  }

  const btn = (id: string) => document.getElementById(id) as HTMLButtonElement;
  btn('btnTradeDrawer').disabled = !(isMyTurn && state.phase === 'MAIN');
  btn('btnBuyDev').disabled = !(isMyTurn && state.phase === 'MAIN' && me?.resources.sheep >= 1 && me?.resources.wheat >= 1 && me?.resources.ore >= 1 && state.devDeckCount > 0);
  btn('btnBuildRoad').disabled = !(isMyTurn && (state.phase === 'MAIN' || state.phase === 'SETUP_ROAD'));
  btn('btnBuildSettle').disabled = !(isMyTurn && (state.phase === 'MAIN' || state.phase === 'SETUP_SETTLEMENT'));
  btn('btnBuildCity').disabled = !(isMyTurn && state.phase === 'MAIN');

  btn('btnBuildRoad').classList.toggle('active-mode', buildMode === 'road');
  btn('btnBuildSettle').classList.toggle('active-mode', buildMode === 'settlement');
  btn('btnBuildCity').classList.toggle('active-mode', buildMode === 'city');

  const mainBtn = btn('btnMainTurnAction');
  if (state.phase === 'ROLL') {
    mainBtn.disabled = !isMyTurn;
    document.getElementById('mainBtnIcon')!.textContent = '🎲';
    document.getElementById('mainBtnLbl')!.textContent = 'Roll';
  } else {
    mainBtn.disabled = !(isMyTurn && state.phase === 'MAIN');
    document.getElementById('mainBtnIcon')!.textContent = '⏩';
    document.getElementById('mainBtnLbl')!.textContent = 'Pass';
  }

  renderVictoryScreen();
  renderActiveTradeModal(me);
  renderHand(me, isMyTurn);
  renderInlineDrawer(me, isMyTurn);
  renderSidebar();
  renderBoard(me, isMyTurn);
}

export function renderVictoryScreen(): void {
  const overlay = document.getElementById('victoryOverlay');
  const reopenBtn = document.getElementById('reopenVictoryBtn');
  if (!overlay || !reopenBtn) return;

  if (state.status !== 'GAMEOVER') {
    overlay.style.display = 'none';
    reopenBtn.style.display = 'none';
    return;
  }

  if (hideVictoryOverlay) {
    overlay.style.display = 'none';
    reopenBtn.style.display = 'inline-flex';
    return;
  }
  overlay.style.display = 'flex';
  reopenBtn.style.display = 'none';

  const ranked = [...state.players].sort((a, b) => b.vp - a.vp);
  const myRankIdx = ranked.findIndex(p => p.id === socket.id);
  const ord = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
  document.getElementById('vicTitleText')!.textContent =
    myRankIdx !== -1 ? `You are ${ord[myRankIdx]}!` : `${state.winner?.name} Won!`;

  const elapsedSec = state.startedAt && state.finishedAt
    ? Math.max(1, Math.floor((state.finishedAt - state.startedAt) / 1000))
    : 0;
  const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const secs = String(elapsedSec % 60).padStart(2, '0');
  document.getElementById('vicSubText')!.textContent = `Time: ${mins}:${secs} - Turns: ${state.turnCount || 1}`;

  document.getElementById('vicRanksList')!.innerHTML = `
    <div style="text-align:right; font-size:18px; margin-bottom:2px;">🏆</div>
  ` + ranked.map((p, idx) => `
    <div class="vic-rank-row" style="border-left: 4px solid ${p.color}">
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:18px">${p.avatar}</span>
        <span>${p.name}</span>
      </div>
      <span style="font-size:16px; color:${idx === 0 ? '#ffd700' : '#fff'}">${p.vp}</span>
    </div>
  `).join('');

  const chartBox = document.getElementById('vicChartContainer')!;
  if (victoryTab === 'dice') {
    const ds = state.diceStats || {};
    let maxCount = 1;
    for (let n = 2; n <= 12; n++) {
      if ((ds[n] || 0) > maxCount) maxCount = ds[n];
    }

    let barsHtml = '';
    for (let n = 2; n <= 12; n++) {
      const c = ds[n] || 0;
      const heightPct = Math.max(8, Math.round((c / maxCount) * 100));
      barsHtml += `
        <div class="dice-bar-col">
          <div class="dice-bar-fill ${n === 7 ? 'is-seven' : ''}" style="height:${heightPct}%">${c > 0 ? c : ''}</div>
          <span style="font-size:11px; font-weight:800; color:#cbd5e1">${n}</span>
        </div>
      `;
    }

    chartBox.innerHTML = `
      <div style="width:100%; text-align:left; font-weight:800; font-size:14px; margin-bottom:6px;">Dice Rolls</div>
      <div class="dice-bars-wrap">${barsHtml}</div>
    `;
  } else {
    chartBox.innerHTML = `
      <div style="width:100%; background:rgba(255,255,255,0.07); border-radius:10px; padding:14px;">
        <div style="display:grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr; gap:8px; font-size:13px; font-weight:800; border-bottom:1px solid rgba(255,255,255,0.2); padding-bottom:6px; margin-bottom:8px;">
          <span>Player</span><span>VP</span><span>Earned</span><span>Trades</span><span>Roads/Army</span>
        </div>
        ${ranked.map(p => `
          <div style="display:grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr; gap:8px; font-size:13px; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
            <span style="font-weight:800; color:${p.color}">${p.avatar} ${p.name}</span>
            <span>${p.vp}</span>
            <span>${p.stats?.resourcesEarned || 0}</span>
            <span>${p.stats?.tradesMade || 0}</span>
            <span>🛣️${p.longestRoadLength} / ⚔️${p.knightsPlayed}</span>
          </div>
        `).join('')}
      </div>
    `;
  }
}
