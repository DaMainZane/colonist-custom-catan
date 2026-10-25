import { socket } from '../socket';
import { state, buildMode, victoryTab, hideVictoryOverlay } from '../store';
import { renderActiveTradeModal } from './trade';
import { renderHand } from './hand';
import { renderInlineDrawer } from './drawer';
import { renderSidebar } from './sidebar';
import { renderBoard } from './board';
import { renderPresetRow } from '../presets';
import { turnClockHtml, syncTurnClockDisplay } from './turnclock';
import { uiIcon, dieFaceSvg } from '../icons';
import { esc } from '../util';
import { avatarFace } from '../avatars';

export function renderAll(): void {
  const me = state.players.find(p => p.id === socket.id);
  const current = state.players[state.turnIndex];
  const isMyTurn = !!current && current.id === socket.id;

  const s = state.settings || {};
  const curSpeed = Number(s.gameSpeed) || 1;
  const speedBadge = document.getElementById('navSpeedBadge');
  if (speedBadge) speedBadge.textContent = `${curSpeed}x`;
  const speedSlider = document.getElementById('menuSpeedSlider') as HTMLInputElement | null;
  if (speedSlider) speedSlider.value = String(curSpeed);
  const speedLabel = document.getElementById('menuSpeedLabel');
  if (speedLabel) {
    const desc = curSpeed < 1 ? 'Slow' : curSpeed === 1 ? 'Normal' : curSpeed <= 2 ? 'Fast' : curSpeed <= 4 ? 'Faster' : 'Blitz';
    speedLabel.textContent = `${curSpeed}x (${desc})`;
  }
  document.querySelectorAll('.speed-preset-btn').forEach(btn => {
    const bSpeed = Number((btn as HTMLElement).dataset.speed);
    btn.classList.toggle('active', Math.abs(bSpeed - curSpeed) < 0.05);
  });
  const selHeader = document.getElementById('setGameSpeedHeader') as HTMLSelectElement | null;
  if (selHeader) selHeader.value = String(curSpeed);
  const selCards = document.getElementById('setGameSpeed') as HTMLSelectElement | null;
  if (selCards) selCards.value = String(curSpeed);

  const lobbyBar = document.getElementById('lobbyToolbar')!;
  if (state.status === 'LOBBY') {
    const setVal = (id: string, v: any) => { (document.getElementById(id) as HTMLInputElement).value = v; };
    setVal('setRadius', s.boardRadius);
    setVal('setVp', s.vpToWin);
    setVal('setMaxP', s.maxPlayers);
    setVal('setDiscard', s.cardDiscardLimit);
    setVal('setTurnTime', s.turnTimerSec ?? 0);
    setVal('setTurnInc', s.turnIncrementSec ?? 0);
    setVal('setTradeTime', s.tradeTimerSec ?? 20);
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
    renderPresetRow();
  } else {
    lobbyBar.style.display = 'none';
  }

  document.getElementById('die1')!.innerHTML = dieFaceSvg(state.lastDice[0]);
  document.getElementById('die2')!.innerHTML = dieFaceSvg(state.lastDice[1]);

  // Piece badges on buttons
  if (me) {
    document.getElementById('badgeRoadCnt')!.textContent = String(me.roadsLeft);
    document.getElementById('badgeSettleCnt')!.textContent = String(me.settlementsLeft);
    document.getElementById('badgeCityCnt')!.textContent = String(me.citiesLeft);
  }

  const pill = document.getElementById('turnStatusPill')!;
  pill.classList.toggle('mine', isMyTurn && state.status !== 'LOBBY' && state.status !== 'GAMEOVER');
  if (state.status === 'LOBBY') {
    pill.innerHTML = state.hostId === socket.id
      ? `Lobby · paint the map or add bots`
      : `Lobby · only the host edits · move your cursor, hold Shift for a laser`;
  } else if (state.status === 'GAMEOVER') {
    pill.innerHTML = `<strong>${esc(state.winner?.name)}</strong> won the game`;
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
    pill.innerHTML = `<span class="avatar" style="background:${esc(current?.color)}">${avatarFace(current?.avatar, current?.name || '?')}</span> <strong>${esc(current?.name)}</strong> · ${phaseTxt}${turnClockHtml()}`;
  }
  syncTurnClockDisplay();

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
    document.getElementById('mainBtnIcon')!.innerHTML = uiIcon('dice', 22);
    document.getElementById('mainBtnLbl')!.textContent = 'Roll';
  } else {
    mainBtn.disabled = !(isMyTurn && state.phase === 'MAIN');
    document.getElementById('mainBtnIcon')!.innerHTML = uiIcon('pass', 22);
    document.getElementById('mainBtnLbl')!.textContent = 'Pass';
  }
  mainBtn.classList.toggle('primary', !mainBtn.disabled);
  document.getElementById('dicePair')!.classList.toggle('can-roll', isMyTurn && state.phase === 'ROLL');

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

  document.getElementById('vicRanksList')!.innerHTML = ranked.map((p, idx) => `
    <div class="vic-rank-row ${idx === 0 ? 'winner' : ''}">
      <div class="who">
        <span class="avatar p-avatar" style="background:${esc(p.color)}">${avatarFace(p.avatar, p.name)}</span>
        <span>${esc(p.name)}</span>
      </div>
      <span class="pts">${p.vp}</span>
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
          <span class="dice-bar-label">${n}</span>
        </div>
      `;
    }

    chartBox.innerHTML = `
      <div class="vic-chart-title">Dice rolls</div>
      <div class="dice-bars-wrap">${barsHtml}</div>
    `;
  } else {
    chartBox.innerHTML = `
      <div class="vic-table">
        <div class="vic-table-row head">
          <span>Player</span><span>VP</span><span>Earned</span><span>Trades</span><span>Road / Army</span>
        </div>
        ${ranked.map(p => `
          <div class="vic-table-row">
            <span class="who"><span class="avatar p-avatar" style="background:${esc(p.color)}; width:24px; height:24px; font-size:11px">${avatarFace(p.avatar, p.name)}</span>${esc(p.name)}</span>
            <span>${p.vp}</span>
            <span>${p.stats?.resourcesEarned || 0}</span>
            <span>${p.stats?.tradesMade || 0}</span>
            <span>${p.longestRoadLength} / ${p.knightsPlayed}</span>
          </div>
        `).join('')}
      </div>
    `;
  }
}
