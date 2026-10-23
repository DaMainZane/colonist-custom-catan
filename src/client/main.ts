import { socket } from './socket';
import { playTone, playDiceRollSound, playDiscardSound, toggleSound } from './audio';
import { getMiniSvg } from './icons';
import {
  state, camZoom, camPanX, camPanY, isPanning, panStart, discardSel, drawerMode,
  setState, setIsMouseDown, setIsPanning, setCamZoom, setCamPan, setDrawerMode,
  setHideVictoryOverlay, clearRes
} from './store';
import { renderAll } from './render/index';
import {
  rerenderBoard, resetCamera, getBoardBounds, triggerFlyingResourceAnimations, triggerCardTransferAnimations,
  onHexInteract, onHexEnter, onEdgeInteract, clickVertex, clickEdge
} from './render/board';
import { respondToTrade, confirmTradeWith, cancelTrade } from './render/trade';
import { onClickHandResource, onClickDevCard } from './render/hand';
import {
  toggleTradeDrawer, closeInlineDrawer, confirmInlineAction, executeBankTrade, proposePlayerTrade,
  confirmMonopoly, pickGold, chooseRobberVictim, adjustDiscard, removeCardFromDiscard, adjustTradeWant, adjustTradeGive
} from './render/drawer';
import { sendChat } from './render/sidebar';
import {
  createRoom, joinRoom, copyInviteLink, switchLobbyTab, toggleLobbyToolbar, toggleGameMenu, setGameSpeedValue,
  setBrush, applyPreset, pushSettings, addBot, removeBot, startGame, rematchLobby, switchVictoryTab,
  toggleVictoryMapInspect, setBuildMode, mainTurnButton, rollDice, buyDevCard
} from './actions';

// Inline onclick="..." handlers in index.html and in generated markup resolve against window.
Object.assign(window as any, {
  createRoom, joinRoom, copyInviteLink, toggleSound, resetCamera, toggleLobbyToolbar, toggleGameMenu,
  setGameSpeedValue, switchLobbyTab, applyPreset, addBot, removeBot, startGame, rematchLobby,
  switchVictoryTab, toggleVictoryMapInspect, setBrush, pushSettings,
  executeBankTrade, proposePlayerTrade, rollDice, confirmInlineAction, closeInlineDrawer,
  toggleTradeDrawer, buyDevCard, setBuildMode, mainTurnButton, sendChat,
  confirmTradeWith, cancelTrade, respondToTrade, onClickHandResource, onClickDevCard,
  pickGold, chooseRobberVictim, confirmMonopoly, adjustDiscard, removeCardFromDiscard, adjustTradeWant, adjustTradeGive,
  onHexInteract, onHexEnter, onEdgeInteract, clickVertex, clickEdge
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

socket.on('errorMsg', (msg: string) => alert(msg));

socket.on('gameState', (newState: any) => {
  const prevDice = state ? state.lastDice.join(',') : '';
  const wasGameOver = state?.status === 'GAMEOVER';
  const prevMe = state?.players?.find((p: any) => p.id === socket.id);
  const wasDiscarding = (prevMe?.discardPending || 0) > 0;

  setState(newState);
  document.getElementById('authScreen')!.style.display = 'none';
  document.getElementById('gameViewport')!.style.display = 'flex';

  if (!wasGameOver && state.status === 'GAMEOVER') {
    setHideVictoryOverlay(false);
    playTone(523, 0.12);
    setTimeout(() => playTone(659, 0.12), 130);
    setTimeout(() => playTone(784, 0.22), 260);
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
  document.getElementById('goldBtnIcon')!.innerHTML = getMiniSvg('gold');
  const params = new URLSearchParams(window.location.search);
  if (params.get('room')) (document.getElementById('roomCodeInput') as HTMLInputElement).value = params.get('room')!;

  const stage = document.getElementById('boardStage')!;
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
    const isOceanOrStage = e.target === stage || (e.target as Element)?.id === 'boardSvg';
    const canLeftPan = state && (state.status !== 'LOBBY' || isOceanOrStage);
    if (e.button === 2 || e.button === 1 || e.altKey || (e.button === 0 && isOceanOrStage && canLeftPan)) {
      setIsPanning(true);
      panStart.x = e.clientX;
      panStart.y = e.clientY;
    } else {
      setIsMouseDown(true);
    }
  });
  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (isPanning && state && state.board) {
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
  stage.addEventListener('contextmenu', e => e.preventDefault());
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

