import { socket } from './socket';
import { playTone, toggleSound } from './audio';
import { getMiniSvg } from './icons';
import {
  state, camZoom, camPanX, camPanY, isPanning, panStart, discardSel, drawerMode,
  setState, setIsMouseDown, setIsPanning, setCamZoom, setCamPan, setDrawerMode, clearRes
} from './store';
import { renderAll } from './render/index';
import { rerenderBoard, resetCamera, onHexInteract, onHexEnter, onEdgeInteract, clickVertex, clickEdge } from './render/board';
import { respondToTrade, confirmTradeWith, cancelTrade } from './render/trade';
import { onClickHandResource, onClickDevCard } from './render/hand';
import {
  toggleTradeDrawer, closeInlineDrawer, confirmInlineAction, executeBankTrade, proposePlayerTrade,
  confirmMonopoly, pickGold, adjustDiscard, adjustTradeWant, adjustTradeGive
} from './render/drawer';
import { sendChat } from './render/sidebar';
import {
  createRoom, joinRoom, copyInviteLink, switchLobbyTab, toggleLobbyToolbar, setBrush, applyPreset,
  pushSettings, addBot, removeBot, startGame, setBuildMode, mainTurnButton, rollDice, buyDevCard
} from './actions';

// Inline onclick="..." handlers in index.html and in generated markup resolve against window.
Object.assign(window as any, {
  createRoom, joinRoom, copyInviteLink, toggleSound, resetCamera, toggleLobbyToolbar, switchLobbyTab,
  applyPreset, addBot, removeBot, startGame, setBrush, pushSettings,
  executeBankTrade, proposePlayerTrade, rollDice, confirmInlineAction, closeInlineDrawer,
  toggleTradeDrawer, buyDevCard, setBuildMode, mainTurnButton, sendChat,
  confirmTradeWith, cancelTrade, respondToTrade, onClickHandResource, onClickDevCard,
  pickGold, confirmMonopoly, adjustDiscard, adjustTradeWant, adjustTradeGive,
  onHexInteract, onHexEnter, onEdgeInteract, clickVertex, clickEdge
});

function animateDice(): void {
  playTone(300, 0.07, 'triangle');
  setTimeout(() => playTone(420, 0.09, 'triangle'), 90);
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
  } else if (state.phase === 'DISCARD' && me.discardPending > 0) {
    if (drawerMode !== 'discard') {
      clearRes(discardSel);
      setDrawerMode('discard');
    }
  } else if (drawerMode === 'gold' || drawerMode === 'discard') {
    setDrawerMode(null);
  }
}

socket.on('errorMsg', (msg: string) => alert(msg));

socket.on('gameState', (newState: any) => {
  const prevDice = state ? state.lastDice.join(',') : '';
  setState(newState);
  document.getElementById('authScreen')!.style.display = 'none';
  document.getElementById('gameViewport')!.style.display = 'flex';

  if (prevDice && prevDice !== state.lastDice.join(',')) animateDice();
  syncAutomaticDrawers();
  renderAll();
});

function init(): void {
  document.getElementById('goldBtnIcon')!.innerHTML = getMiniSvg('gold');
  const params = new URLSearchParams(window.location.search);
  if (params.get('room')) (document.getElementById('roomCodeInput') as HTMLInputElement).value = params.get('room')!;

  const stage = document.getElementById('boardStage')!;
  stage.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.08 : 0.92;
    setCamZoom(Math.max(0.45, Math.min(2.2, camZoom * factor)));
    rerenderBoard();
  }, { passive: false });

  stage.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button === 2 || e.button === 1 || e.altKey) {
      setIsPanning(true);
      panStart.x = e.clientX - camPanX;
      panStart.y = e.clientY - camPanY;
    } else {
      setIsMouseDown(true);
    }
  });
  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (isPanning) {
      setCamPan(e.clientX - panStart.x, e.clientY - panStart.y);
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
