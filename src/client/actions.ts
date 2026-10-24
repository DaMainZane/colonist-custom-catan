import { playTone } from './audio';
import { socket } from './socket';
import {
  state, activeBrush, buildMode, setBuildModeValue, setDrawerMode,
  setVictoryTab, setHideVictoryOverlay
} from './store';
import { renderAll, renderVictoryScreen } from './render/index';
import { showToast } from './ui';

// ---------- Landing / lobby ----------

export function createRoom(): void {
  socket.emit('createRoom', { name: (document.getElementById('playerNameInput') as HTMLInputElement).value });
}

export function joinRoom(): void {
  socket.emit('joinRoom', {
    code: (document.getElementById('roomCodeInput') as HTMLInputElement).value,
    name: (document.getElementById('playerNameInput') as HTMLInputElement).value
  });
}

export function copyInviteLink(): void {
  if (!state) return;
  const url = `${window.location.origin}/?room=${state.code}`;
  navigator.clipboard.writeText(url).then(
    () => showToast('Invite link copied'),
    () => showToast(url)
  );
  playTone(660, 0.1);
}

export function switchLobbyTab(tab: string): void {
  document.getElementById('tabBtnMap')!.classList.toggle('active', tab === 'map');
  document.getElementById('tabBtnCards')!.classList.toggle('active', tab === 'cards');
  document.getElementById('lobbyTabMap')!.style.display = tab === 'map' ? 'flex' : 'none';
  document.getElementById('lobbyTabCards')!.style.display = tab === 'cards' ? 'flex' : 'none';
}

export function toggleLobbyToolbar(): void {
  if (state && state.status !== 'LOBBY') {
    toggleGameMenu();
    return;
  }
  const el = document.getElementById('lobbyToolbar')!;
  el.style.display = el.style.display === 'none' ? 'flex' : 'none';
}

export function toggleGameMenu(forceShow?: boolean): void {
  const menu = document.getElementById('gameSettingsMenu');
  if (!menu) return;
  const shouldShow = typeof forceShow === 'boolean' ? forceShow : menu.style.display === 'none';
  menu.style.display = shouldShow ? 'flex' : 'none';
  playTone(500, 0.05);
}

export function setGameSpeedValue(speedVal: number | string): void {
  if (!state) return;
  const num = Math.max(0.25, Math.min(10, Number(speedVal) || 1));
  if (state.settings) state.settings.gameSpeed = num;
  socket.emit('setGameSpeed', { code: state.code, speed: num });
  playTone(560, 0.05);
}

export function setBrush(type: string, value: string, btn?: HTMLElement): void {
  activeBrush.type = type;
  activeBrush.value = value;
  document.querySelectorAll('.brush-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

export function applyPreset(preset: string): void {
  if (!state) return;
  socket.emit('applyMapPreset', { code: state.code, preset });
  playTone(520, 0.08);
}

export function pushSettings(): void {
  if (!state || state.hostId !== socket.id) return;
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
  socket.emit('updateSettings', {
    code: state.code,
    newSettings: {
      boardRadius: val('setRadius'),
      vpToWin: val('setVp'),
      maxPlayers: val('setMaxP'),
      cardDiscardLimit: val('setDiscard'),
      goldTiles: val('setGold'),
      desertTiles: val('setDesert'),
      fogTiles: val('setFog'),
      bankResourcePerType: val('setBankRes'),
      devKnights: val('setDevKnight'),
      devVp: val('setDevVp'),
      devRoadBuilding: val('setDevRb'),
      devYearOfPlenty: val('setDevYop'),
      devMonopoly: val('setDevMono'),
      maxRoads: val('setMaxRoad'),
      maxSettlements: val('setMaxSettle'),
      maxCities: val('setMaxCity'),
      gameSpeed: val('setGameSpeed')
    }
  });
}

export function addBot(): void { socket.emit('addBot', { code: state.code }); }
export function removeBot(): void { socket.emit('removeBot', { code: state.code }); }
export function startGame(): void { socket.emit('startGame', { code: state.code }); }

export function rematchLobby(): void {
  setHideVictoryOverlay(false);
  socket.emit('rematchLobby', { code: state.code });
}

export function switchVictoryTab(tab: string): void {
  setVictoryTab(tab);
  document.getElementById('vicTabDice')?.classList.toggle('active', tab === 'dice');
  document.getElementById('vicTabOverview')?.classList.toggle('active', tab === 'overview');
  renderVictoryScreen();
}

export function toggleVictoryMapInspect(hide: boolean): void {
  setHideVictoryOverlay(hide);
  renderVictoryScreen();
}

// ---------- Turn actions ----------

export function setBuildMode(mode: string): void {
  setBuildModeValue(buildMode === mode ? null : mode);
  renderAll();
}

export function mainTurnButton(): void {
  if (state.phase === 'ROLL') rollDice();
  else endTurn();
}

export function rollDice(): void { socket.emit('rollDice', { code: state.code }); }

export function buyDevCard(): void {
  socket.emit('buyDevCard', { code: state.code });
  playTone(540, 0.1);
}

export function endTurn(): void {
  setBuildModeValue(null);
  setDrawerMode(null);
  socket.emit('endTurn', { code: state.code });
}
