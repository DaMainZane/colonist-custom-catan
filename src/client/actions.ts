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

// ---------- Landing / lobby / reconnect ----------

const CLIENT_ID_KEY = 'catan_client_id';
const SAVED_NAME_KEY = 'catan_player_name';
const SAVED_ROOM_KEY = 'catan_last_room';

export function getClientId(): string {
  try {
    let cid = localStorage.getItem(CLIENT_ID_KEY);
    if (!cid) {
      cid = 'cid_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
      localStorage.setItem(CLIENT_ID_KEY, cid);
    }
    return cid;
  } catch {
    return 'cid_ephemeral';
  }
}

export function saveSessionInfo(code?: string, name?: string): void {
  try {
    if (code) localStorage.setItem(SAVED_ROOM_KEY, code);
    if (name) localStorage.setItem(SAVED_NAME_KEY, name);
    syncRejoinButton();
  } catch {}
}

export function clearSavedRoom(): void {
  try {
    localStorage.removeItem(SAVED_ROOM_KEY);
    syncRejoinButton();
  } catch {}
}

export function getSavedSession(): { clientId: string; code: string; name: string } {
  try {
    return {
      clientId: getClientId(),
      code: (localStorage.getItem(SAVED_ROOM_KEY) || '').trim().toUpperCase(),
      name: (localStorage.getItem(SAVED_NAME_KEY) || '').trim()
    };
  } catch {
    return { clientId: getClientId(), code: '', name: '' };
  }
}

export function syncRejoinButton(): void {
  const btn = document.getElementById('rejoinLastGameBtn') as HTMLButtonElement | null;
  const lbl = document.getElementById('rejoinLastGameLbl');
  if (!btn) return;
  const { code, name } = getSavedSession();
  const nameInput = document.getElementById('playerNameInput') as HTMLInputElement | null;
  if (nameInput && !nameInput.value && name) {
    nameInput.value = name;
  }
  if (code) {
    btn.style.display = 'inline-flex';
    if (lbl) lbl.textContent = `Rejoin game (${code})`;
  } else {
    btn.style.display = 'none';
  }
}

function getRequiredPlayerName(): string | null {
  const input = document.getElementById('playerNameInput') as HTMLInputElement | null;
  const name = (input?.value || '').trim();
  if (!name) {
    showToast('Please enter a nickname first.');
    input?.focus();
    return null;
  }
  saveSessionInfo(undefined, name);
  return name;
}

export function createRoom(): void {
  const name = getRequiredPlayerName();
  if (!name) return;
  socket.emit('createRoom', { name, clientId: getClientId() });
}

export function joinRoom(): void {
  const name = getRequiredPlayerName();
  if (!name) return;
  socket.emit('joinRoom', {
    code: (document.getElementById('roomCodeInput') as HTMLInputElement).value,
    name,
    clientId: getClientId()
  });
}

export function rejoinSavedRoom(silent = false): void {
  const { clientId, code, name } = getSavedSession();
  const inputName = ((document.getElementById('playerNameInput') as HTMLInputElement | null)?.value || '').trim() || name;
  if (!code && !clientId) {
    if (!silent) showToast('No saved game session to rejoin.');
    return;
  }
  socket.emit('reconnectRoom', { code, clientId, name: inputName, silent });
}

export function downloadTrainingLog(): void {
  const roomQuery = state?.code ? `?room=${encodeURIComponent(state.code)}&format=jsonl` : '?format=jsonl';
  const a = document.createElement('a');
  a.href = `/api/bot-training-logs${roomQuery}`;
  a.download = `bot-training-${state?.code || 'all'}.jsonl`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  playTone(600, 0.08);
  showToast('Downloading AI bot training log (.jsonl)');
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
  // The dock only holds the map painter now (rules moved to the setup page); kept so old callers do not break.
  document.getElementById('tabBtnMap')?.classList.toggle('active', tab === 'map');
  document.getElementById('tabBtnCards')?.classList.toggle('active', tab === 'cards');
  const mapTab = document.getElementById('lobbyTabMap');
  const cardsTab = document.getElementById('lobbyTabCards');
  if (mapTab) mapTab.style.display = tab === 'map' ? 'flex' : 'none';
  if (cardsTab) cardsTab.style.display = tab === 'cards' ? 'flex' : 'none';
}

/** Host: open the world setup page (true) or go on to the board (false). While it is open nobody new can join. */
export function setSetupOpen(open: boolean): void {
  if (!state || state.status !== 'LOBBY') return;
  if (!requireHost('change the world setup')) return;
  if (!open) {
    // Landing on the board: show the painter dock.
    const dock = document.getElementById('lobbyToolbar');
    if (dock) dock.style.display = 'flex';
  }
  socket.emit('setSetup', { code: state.code, open });
  playTone(open ? 460 : 560, 0.05);
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

let wheelSettingsTimer: any = null;
let lastWheelEditAt = 0;

export function isPendingSettingsPush(): boolean {
  return wheelSettingsTimer !== null || (performance.now() - lastWheelEditAt < 260);
}

export function schedulePushSettings(): void {
  lastWheelEditAt = performance.now();
  if (wheelSettingsTimer !== null) clearTimeout(wheelSettingsTimer);
  wheelSettingsTimer = setTimeout(() => {
    wheelSettingsTimer = null;
    pushSettings();
  }, 110);
}

export function pushSettings(): void {
  if (wheelSettingsTimer !== null) {
    clearTimeout(wheelSettingsTimer);
    wheelSettingsTimer = null;
  }
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
      maxCities: val('setMaxCity')
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
  document.querySelectorAll<HTMLElement>('.vic-tab[data-vtab]').forEach(el => {
    el.classList.toggle('active', el.dataset.vtab === tab);
  });
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
