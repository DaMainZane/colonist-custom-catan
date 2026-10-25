import { playTone } from './audio';
import { socket } from './socket';
import {
  state, activeBrush, buildMode, setBuildModeValue, setDrawerMode,
  setVictoryTab, setHideVictoryOverlay
} from './store';
import { renderAll, renderVictoryScreen } from './render/index';
import { showToast } from './ui';
import { AVATAR_CHOICES } from './avatars';

// Map and lobby editing belongs to the host. Everyone else points with a cursor (Shift = laser).
function requireHost(what: string): boolean {
  if (!state || state.hostId === socket.id) return true;
  showToast(`Only the host can ${what}.`);
  return false;
}

/** Click your avatar in the lobby to step to the next free one (the host can do it for bots). */
export function cycleAvatar(playerId: string): void {
  if (!state || state.status !== 'LOBBY') return;
  const player = state.players.find(p => p.id === playerId);
  if (!player) return;
  const taken = new Set(state.players.filter(p => p.id !== playerId).map(p => p.avatar));
  const start = AVATAR_CHOICES.indexOf(player.avatar);
  for (let i = 1; i <= AVATAR_CHOICES.length; i++) {
    const next = AVATAR_CHOICES[(start + i + AVATAR_CHOICES.length) % AVATAR_CHOICES.length];
    if (taken.has(next)) continue;
    socket.emit('setAvatar', { code: state.code, playerId, avatar: next });
    playTone(540, 0.05);
    return;
  }
}

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
  const show = el.style.display === 'none';
  // The dock and the game menu sit in the same corner, so only one is open at a time.
  if (show) {
    const menu = document.getElementById('gameSettingsMenu');
    if (menu) menu.style.display = 'none';
  }
  el.style.display = show ? 'flex' : 'none';
}

/** After "Back to lobby" (and Play again): close the game menu and fold the dock away. The settings button brings the dock back. */
export function collapseLobbyUi(): void {
  const menu = document.getElementById('gameSettingsMenu');
  if (menu) menu.style.display = 'none';
  const dock = document.getElementById('lobbyToolbar');
  if (dock) dock.style.display = 'none';
}

export function toggleGameMenu(forceShow?: boolean): void {
  const menu = document.getElementById('gameSettingsMenu');
  if (!menu) return;
  const shouldShow = typeof forceShow === 'boolean' ? forceShow : menu.style.display === 'none';
  if (shouldShow) {
    const dock = document.getElementById('lobbyToolbar');
    if (dock) dock.style.display = 'none';
  }
  menu.style.display = shouldShow ? 'flex' : 'none';
  playTone(500, 0.05);
}

export function setGameSpeedValue(speedVal: number | string): void {
  if (!state) return;
  if (!requireHost('change the game speed')) { renderAll(); return; }
  const num = Math.max(0.25, Math.min(10, Number(speedVal) || 1));
  if (state.settings) state.settings.gameSpeed = num;
  socket.emit('setGameSpeed', { code: state.code, speed: num });
  playTone(560, 0.05);
}

export function setBrush(type: string, value: string, btn?: HTMLElement): void {
  if (!requireHost('edit the map')) return;
  const isSame = activeBrush.type === type && activeBrush.value === value;
  activeBrush.type = isSame ? '' : type;
  activeBrush.value = isSame ? '' : value;
  document.querySelectorAll('.brush-btn').forEach(b => b.classList.remove('active'));
  if (!isSame && btn) btn.classList.add('active');
  renderAll();
}

export function applyPreset(preset: string): void {
  if (!state) return;
  if (!requireHost('apply map presets')) return;
  socket.emit('applyMapPreset', { code: state.code, preset });
  playTone(520, 0.08);
}

export function pushSettings(): void {
  if (!state) return;
  if (state.hostId !== socket.id) {
    showToast('Only the host can change settings.');
    renderAll();
    return;
  }
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
  socket.emit('updateSettings', {
    code: state.code,
    newSettings: {
      boardRadius: val('setRadius'),
      vpToWin: val('setVp'),
      maxPlayers: val('setMaxP'),
      cardDiscardLimit: val('setDiscard'),
      turnTimerSec: val('setTurnTime'),
      turnIncrementSec: val('setTurnInc'),
      tradeTimerSec: val('setTradeTime'),
      botChat: val('setBotChat'),
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

const BOT_TIERS = ['main', 'secondary', 'overload'];

export function addBot(): void {
  if (!requireHost('add bots')) return;
  const tier = (document.getElementById('botTier') as HTMLSelectElement | null)?.value || 'main';
  socket.emit('addBot', { code: state.code, tier });
}

/** Host only, lobby only: click a bot's tier tag to step Main -> Secondary -> Overload -> Main. */
export function cycleBotTier(playerId: string): void {
  if (!state || state.status !== 'LOBBY') return;
  if (!requireHost('change a bot\'s difficulty')) return;
  const bot = state.players.find(p => p.id === playerId && p.isBot);
  if (!bot) return;
  const cur = BOT_TIERS.indexOf(String(bot.difficulty || '').toLowerCase());
  const next = BOT_TIERS[(cur + 1) % BOT_TIERS.length];
  socket.emit('setBotTier', { code: state.code, playerId, tier: next });
  playTone(540, 0.05);
}
export function removeBot(): void { if (requireHost('remove bots')) socket.emit('removeBot', { code: state.code }); }
export function startGame(): void { if (requireHost('start the game')) socket.emit('startGame', { code: state.code }); }

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
