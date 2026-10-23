import { socket } from '../socket';
import { state, buildMode, drawerMode } from '../store';
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
    pill.innerHTML = `🏆 <strong>${state.winner.name}</strong> Wins (${state.winner.vp} VP)!`;
  } else {
    const phaseTxt = ({
      SETUP_SETTLEMENT: 'Place Settlement',
      SETUP_ROAD: 'Place Road',
      ROLL: 'Roll Dice',
      GOLD_PICK: 'Pick Gold Resource',
      DISCARD: 'Discard Half (7 Rolled)',
      ROBBER: 'Move Robber',
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

  renderActiveTradeModal(me);
  renderHand(me, isMyTurn);
  renderInlineDrawer(me, isMyTurn);
  renderSidebar();
  renderBoard(me, isMyTurn);
}
