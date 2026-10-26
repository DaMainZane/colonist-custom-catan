// MODULE: player hand (resource stacks + dev cards) and hand click handlers | USED BY: render/index.ts, main.ts
import { RESOURCES, RES_META, DEV_META } from '../constants';
import { getMiniSvg, getDevSvg, buildOverlappingStackHtml } from '../icons';
import { playTone } from '../audio';
import { socket } from '../socket';
import { state, drawerMode, tradeGive, tradeWant, discardSel, clearRes, setDrawerMode, counterTradeId, counterGive, inFlightHandResources, inFlightMyDevCards } from '../store';
import { renderInlineDrawer } from './drawer';
import { adjustCounter } from './trade';
import { esc } from '../util';
import { isClientPieceDoubleCost } from './board';

export const BUILD_RECIPES: Record<'dev' | 'road' | 'settlement' | 'city', string[]> = {
  dev: ['sheep', 'wheat', 'ore'],
  road: ['wood', 'brick'],
  settlement: ['wood', 'brick', 'sheep', 'wheat'],
  city: ['wheat', 'wheat', 'ore', 'ore', 'ore']
};

export function renderRecipeStripHtml(recipeKey: 'dev' | 'road' | 'settlement' | 'city', me: any): string {
  const baseList = BUILD_RECIPES[recipeKey];
  const isDouble = recipeKey !== 'dev' && isClientPieceDoubleCost(recipeKey, me?.id || socket.id);
  const list = isDouble ? baseList.flatMap(r => [r, r]) : baseList;
  const seen: Record<string, number> = {};
  const hand = me?.resources || {};
  const cardsHtml = list.map(r => {
    seen[r] = (seen[r] || 0) + 1;
    const avail = Math.max(0, (hand[r] || 0) - (inFlightHandResources[r] || 0));
    const hasIt = avail >= seen[r];
    return `<div class="recipe-mini-card card-${r} ${hasIt ? 'has-res' : 'lacks-res'}">${getMiniSvg(r)}</div>`;
  }).join('');
  const badgeHtml = isDouble ? `<span class="recipe-double-badge" title="Above base piece limit: costs 2× resources">2×</span>` : '';
  return `<div class="recipe-cards-strip">${badgeHtml}${cardsHtml}</div>`;
}

function updateActionRecipePopups(me: any): void {
  const map: Array<[string, 'dev' | 'road' | 'settlement' | 'city']> = [
    ['recipePopupDev', 'dev'],
    ['recipePopupRoad', 'road'],
    ['recipePopupSettle', 'settlement'],
    ['recipePopupCity', 'city']
  ];
  for (const [id, key] of map) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = renderRecipeStripHtml(key, me);
  }
}

// One dev card type: purple card with a cream glyph. Accent ring = playable now, faded + NEW = bought this turn.
function devCardHtml(type: string, oldCount: number, newCount: number, canPlay: boolean): string {
  const meta = DEV_META[type] || { name: type, desc: '' };
  const total = oldCount + newCount;
  const classes = ['dev-card', canPlay ? 'playable' : '', oldCount === 0 && newCount > 0 ? 'is-new' : ''].filter(Boolean).join(' ');
  let tip = `${meta.name}: ${meta.desc}`;
  if (newCount > 0) tip += ` (${newCount} bought this turn, playable next turn)`;
  return `
    <div class="${classes}" ${canPlay ? `onclick="onClickDevCard('${type}')"` : ''} title="${esc(tip)}">
      ${getDevSvg(type)}
      <span class="dev-name">${esc(meta.name)}</span>
      ${total > 1 ? `<span class="dev-count">${total}</span>` : ''}
      ${newCount > 0 ? `<span class="dev-new">NEW</span>` : ''}
    </div>`;
}

export function renderHand(me: any, isMyTurn: boolean): void {
  updateActionRecipePopups(me);
  const panel = document.getElementById('myHandPanel')!;
  if (!me || !me.resources) {
    panel.innerHTML = '<span class="hand-empty">Spectating</span>';
    return;
  }

  let resHtml = RESOURCES.map(r => {
    // Hold back cards that are still flying toward the hand, plus cards placed in the active tray/counter
    let count = Math.max(0, (me.resources[r] || 0) - (inFlightHandResources[r] || 0));
    if (drawerMode === 'discard') count = Math.max(0, count - (discardSel[r] || 0));
    else if (drawerMode === 'trade') count = Math.max(0, count - (tradeGive[r] || 0));
    // Cards placed in a counter offer also leave the hand view.
    if (counterTradeId !== null) count = Math.max(0, count - (counterGive[r] || 0));

    if (count <= 0 && state.status !== 'LOBBY') return '';
    if (count <= 0 && state.status === 'LOBBY') {
      return `
        <div class="mini-res-card card-${r} card-ghost">
          ${getMiniSvg(r)}
          <span class="card-count">0</span>
        </div>
      `;
    }
    return buildOverlappingStackHtml(
      `card-${r}`,
      getMiniSvg(r),
      count,
      `onClickHandResource('${r}')`,
      `${RES_META[r].name}: ${counterTradeId !== null ? 'click to add to your counter offer' : 'click to select'}`
    );
  }).join('');

  const oldDevs: string[] = me.devCards || [];
  const rawNewDevs: string[] = me.newDevCards || [];
  const newDevs: string[] = inFlightMyDevCards > 0
    ? rawNewDevs.slice(0, Math.max(0, rawNewDevs.length - inFlightMyDevCards))
    : rawNewDevs;
  const oldCounts: Record<string, number> = {};
  const newCounts: Record<string, number> = {};
  oldDevs.forEach(c => { oldCounts[c] = (oldCounts[c] || 0) + 1; });
  newDevs.forEach(c => { newCounts[c] = (newCounts[c] || 0) + 1; });
  const devTypes = Array.from(new Set([...oldDevs, ...newDevs]));

  const devHtml = devTypes.map(c => {
    const canPlay = isMyTurn && !me.playedDevCardThisTurn && (oldCounts[c] || 0) > 0 && c !== 'vp';
    return devCardHtml(c, oldCounts[c] || 0, newCounts[c] || 0, canPlay);
  }).join('');

  let html = resHtml;
  if (resHtml && devHtml) html += '<div class="hand-sep"></div>';
  html += devHtml;

  if (!html) {
    html = `<span class="hand-empty">No cards in hand</span>`;
  }
  panel.innerHTML = html;
}

export function onClickHandResource(r: string): void {
  const me = state.players.find(p => p.id === socket.id);
  const isMyTurn = state.players[state.turnIndex]?.id === socket.id;
  if (!me) return;

  // While a counter offer is open, hand cards go into it ("You give") instead of opening the trade drawer.
  if (counterTradeId !== null && drawerMode !== 'discard') {
    adjustCounter('give', r, 1);
    return;
  }

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
