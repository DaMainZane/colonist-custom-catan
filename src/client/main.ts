import { socket } from './socket';
import { playTone, playDiceRollSound, playDiscardSound, toggleSound } from './audio';
import { hydrateIcons } from './icons';
import { toggleTheme, showToast } from './ui';
import {
  state, camZoom, camPanX, camPanY, isPanning, panStart, discardSel, drawerMode,
  activeBrush, hasDraggedMap,
  setState, setIsMouseDown, setIsPanning, setHasDraggedMap, setCamZoom, setCamPan, setDrawerMode,
  setHideVictoryOverlay, clearRes
} from './store';
import { renderAll } from './render/index';
import {
  rerenderBoard, resetCamera, getBoardBounds, triggerFlyingResourceAnimations, triggerCardTransferAnimations,
  triggerAwardAnimation, onHexInteract, onHexClick, onHexEnter, onEdgeInteract, clickVertex, clickEdge,
  onRoadHover, onRoadMove, onRoadLeave
} from './render/board';
import { respondToTrade, confirmTradeWith, cancelTrade, startCounter, adjustCounter, sendCounter, cancelCounter, toggleTradesCollapsed } from './render/trade';
import { initCursors } from './cursors';
import {
  startSavePreset, cancelSavePreset, confirmSavePreset, presetNameKey, applyCustomPreset,
  askDeletePreset, cancelDeletePreset, deletePreset
} from './presets';
import { onClickHandResource, onClickDevCard } from './render/hand';
import {
  toggleTradeDrawer, closeInlineDrawer, confirmInlineAction, executeBankTrade, proposePlayerTrade,
  confirmMonopoly, pickGold, chooseRobberVictim, adjustDiscard, removeCardFromDiscard, adjustTradeWant, adjustTradeGive
} from './render/drawer';
import { sendChat } from './render/sidebar';
import {
  createRoom, joinRoom, copyInviteLink, switchLobbyTab, toggleLobbyToolbar, toggleGameMenu, setGameSpeedValue,
  setBrush, applyPreset, pushSettings, addBot, removeBot, startGame, rematchLobby, switchVictoryTab,
  toggleVictoryMapInspect, setBuildMode, mainTurnButton, rollDice, buyDevCard, cycleAvatar, cycleBotTier, collapseLobbyUi
} from './actions';

// Inline onclick="..." handlers in index.html and in generated markup resolve against window.
Object.assign(window as any, {
  createRoom, joinRoom, copyInviteLink, toggleSound, toggleTheme, resetCamera, toggleLobbyToolbar, toggleGameMenu,
  setGameSpeedValue, switchLobbyTab, applyPreset, addBot, removeBot, startGame, rematchLobby,
  switchVictoryTab, toggleVictoryMapInspect, setBrush, pushSettings,
  executeBankTrade, proposePlayerTrade, rollDice, confirmInlineAction, closeInlineDrawer,
  toggleTradeDrawer, buyDevCard, setBuildMode, mainTurnButton, sendChat,
  confirmTradeWith, cancelTrade, respondToTrade, onClickHandResource, onClickDevCard,
  startCounter, adjustCounter, sendCounter, cancelCounter, toggleTradesCollapsed, cycleAvatar, cycleBotTier,
  startSavePreset, cancelSavePreset, confirmSavePreset, presetNameKey, applyCustomPreset,
  askDeletePreset, cancelDeletePreset, deletePreset,
  pickGold, chooseRobberVictim, confirmMonopoly, adjustDiscard, removeCardFromDiscard, adjustTradeWant, adjustTradeGive,
  onHexInteract, onHexClick, onHexEnter, onEdgeInteract, clickVertex, clickEdge,
  onRoadHover, onRoadMove, onRoadLeave
});

function animateDice(sum?: number): void {
  playDiceRollSound(sum);
  const d1 = document.getElementById('die1')!;
  const d2 = document.getElementById('die2')!;
  d1.classList.add('rolling');
  d2.classList.add('rolling');
  setTimeout(() => {
    d1.classList.remove('rolling');
    d2.classList.remove('rolling');
  }, 360);
}

function syncAutomaticDrawers(): void {
  const me = state.players.find(p => p.id === socket.id);
  if (!me) return;

  if (me.goldPending > 0) {
    setDrawerMode('gold');
  } else if (state.phase === 'ROBBER_STEAL' && state.currentPlayerId === socket.id) {
    setDrawerMode('robberSteal');
  } else if (state.phase === 'DISCARD' && me.discardPending > 0) {
    if (drawerMode !== 'discard') {
      clearRes(discardSel);
      setDrawerMode('discard');
    }
  } else if (drawerMode === 'gold' || drawerMode === 'discard' || drawerMode === 'robberSteal') {
    setDrawerMode(null);
  }
}

socket.on('errorMsg', (msg: string) => showToast(msg));

socket.on('gameState', (newState: any) => {
  const prevDice = state ? state.lastDice.join(',') : '';
  const wasGameOver = state?.status === 'GAMEOVER';
  const wasLobby = !state || state.status === 'LOBBY';
  const prevLongestRoad = state?.longestRoadOwner || null;
  const prevLargestArmy = state?.largestArmyOwner || null;
  const prevMe = state?.players?.find((p: any) => p.id === socket.id);
  const wasDiscarding = (prevMe?.discardPending || 0) > 0;

  setState(newState);
  // Back in the lobby after a game: fold the menus away so nothing overlaps; the settings button reopens the dock.
  if (!wasLobby && state.status === 'LOBBY') collapseLobbyUi();
  document.getElementById('authScreen')!.style.display = 'none';
  document.getElementById('gameViewport')!.style.display = 'flex';

  if (!wasGameOver && state.status === 'GAMEOVER') {
    setHideVictoryOverlay(false);
    playTone(523, 0.12);
    setTimeout(() => playTone(659, 0.12), 130);
    setTimeout(() => playTone(784, 0.22), 260);
  }

  if (!wasLobby && state.status !== 'LOBBY') {
    if (state.longestRoadOwner && state.longestRoadOwner !== prevLongestRoad) {
      const newOwner = state.players.find(p => p.id === state.longestRoadOwner);
      const oldOwner = prevLongestRoad ? state.players.find(p => p.id === prevLongestRoad) : null;
      triggerAwardAnimation('longestRoad', newOwner, oldOwner);
    }
    if (state.largestArmyOwner && state.largestArmyOwner !== prevLargestArmy) {
      const newOwner = state.players.find(p => p.id === state.largestArmyOwner);
      const oldOwner = prevLargestArmy ? state.players.find(p => p.id === prevLargestArmy) : null;
      triggerAwardAnimation('largestArmy', newOwner, oldOwner);
    }
  }

  const diceSum = (state.lastDice?.[0] || 0) + (state.lastDice?.[1] || 0);
  if (prevDice && prevDice !== state.lastDice.join(',')) {
    animateDice(diceSum);
  }

  const meNow = state.players.find(p => p.id === socket.id);
  if (!wasDiscarding && meNow && meNow.discardPending > 0) {
    playDiscardSound();
    const handEl = document.getElementById('myHandPanel');
    if (handEl) {
      handEl.classList.remove('hand-stolen-shake');
      void handEl.offsetWidth;
      handEl.classList.add('hand-stolen-shake');
      setTimeout(() => handEl.classList.remove('hand-stolen-shake'), 650);
    }
  }

  syncAutomaticDrawers();
  renderAll();

  if (state.recentProductions && state.recentProductions.length > 0) {
    triggerFlyingResourceAnimations(state.recentProductions);
  }
  if (state.recentTransfers && state.recentTransfers.length > 0) {
    triggerCardTransferAnimations(state.recentTransfers);
  }
});

function init(): void {
  hydrateIcons();
  const params = new URLSearchParams(window.location.search);
  if (params.get('room')) (document.getElementById('roomCodeInput') as HTMLInputElement).value = params.get('room')!;

  const stage = document.getElementById('boardStage')!;
  const panOrigin = { x: 0, y: 0 };

  stage.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    if (!state || !state.board) return;
    const svg = document.getElementById('boardSvg')!;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const { contentW, contentH } = getBoardBounds();
    const baseUnitPerPx = Math.max(contentW / rect.width, contentH / rect.height);

    const oldZoom = camZoom;
    const factor = e.deltaY > 0 ? 1.12 : (1 / 1.12);
    const newZoom = Math.max(0.01, Math.min(5.0, oldZoom * factor));

    const offsetX = e.clientX - (rect.left + rect.width / 2);
    const offsetY = e.clientY - (rect.top + rect.height / 2);

    const oldWorldPerPx = oldZoom * baseUnitPerPx;
    const newWorldPerPx = newZoom * baseUnitPerPx;

    // Anchor the world point directly underneath the cursor
    const newPanX = camPanX + offsetX * (newWorldPerPx - oldWorldPerPx);
    const newPanY = camPanY + offsetY * (newWorldPerPx - oldWorldPerPx);

    setCamZoom(newZoom);
    setCamPan(newPanX, newPanY);
    rerenderBoard();
  }, { passive: false });

  stage.addEventListener('mousedown', (e: MouseEvent) => {
    const target = e.target as Element | null;
    // Ignore clicks on floating UI panels inside boardStage (only pan when pressing on the SVG board or stage)
    if (target && target !== stage && !target.closest('#boardSvg')) return;

    const isLobbyPaintTarget = Boolean(
      state &&
      state.status === 'LOBBY' &&
      state.hostId === socket.id &&
      activeBrush.type &&
      target?.closest('[data-paintable="1"]')
    );

    setHasDraggedMap(false);
    panOrigin.x = e.clientX;
    panOrigin.y = e.clientY;

    if (e.button === 2 || e.button === 1 || e.altKey || (e.button === 0 && !isLobbyPaintTarget)) {
      setIsPanning(true);
      panStart.x = e.clientX;
      panStart.y = e.clientY;
    } else {
      setIsMouseDown(true);
    }
  });
  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (isPanning && state && state.board) {
      if (!hasDraggedMap && Math.hypot(e.clientX - panOrigin.x, e.clientY - panOrigin.y) > 4) {
        setHasDraggedMap(true);
      }
      const svg = document.getElementById('boardSvg')!;
      const rect = svg.getBoundingClientRect();
      const { contentW, contentH } = getBoardBounds();
      const worldPerPx = camZoom * Math.max(contentW / (rect.width || 1), contentH / (rect.height || 1));
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      panStart.x = e.clientX;
      panStart.y = e.clientY;
      setCamPan(camPanX + dx * worldPerPx, camPanY + dy * worldPerPx);
      rerenderBoard();
    }
  });
  window.addEventListener('mouseup', () => { setIsMouseDown(false); setIsPanning(false); });
  stage.addEventListener('click', (e: MouseEvent) => {
    if (hasDraggedMap) {
      e.stopPropagation();
      e.preventDefault();
      setHasDraggedMap(false);
    }
  }, true);
  stage.addEventListener('contextmenu', e => e.preventDefault());
  initCursors();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

