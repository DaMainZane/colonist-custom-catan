// MODULE: player hand (resource stacks + dev cards) and hand click handlers | USED BY: render/index.ts, main.ts
import { RESOURCES, RES_META, DEV_META } from '../constants';
import { getMiniSvg, getDevSvg, buildOverlappingStackHtml, uiIcon } from '../icons';
import { playTone } from '../audio';
import { socket } from '../socket';
import { state, drawerMode, tradeGive, tradeWant, discardSel, clearRes, setDrawerMode, counterTradeId, counterGive, inFlightHandResources, inFlightMyDevCards, spectateTargetId } from '../store';
import { renderInlineDrawer } from './drawer';
import { adjustCounter } from './trade';
import { esc } from '../util';
import { avatarFace } from '../avatars';
import { isClientPieceDoubleCost } from './board';

export type RecipeKey = 'dev' | 'road' | 'bridge' | 'settlement' | 'city';

export const BUILD_RECIPES: Record<RecipeKey, string[]> = {
  dev: ['sheep', 'wheat', 'ore'],
  road: ['wood', 'brick'],
  bridge: ['wood', 'brick', 'ore'],
  settlement: ['wood', 'brick', 'sheep', 'wheat'],
  city: ['wheat', 'wheat', 'ore', 'ore', 'ore']
};

export function renderRecipeStripHtml(recipeKey: RecipeKey, me: any): string {
  const baseList = BUILD_RECIPES[recipeKey];
  const isDouble = recipeKey !== 'dev' && isClientPieceDoubleCost(recipeKey, me?.id || socket.id);
  const customCost = recipeKey !== 'dev' ? me?.pieceCosts?.[recipeKey] : null;
  let list: string[];
  if (customCost && typeof customCost === 'object') {
    list = [];
    for (const [r, n] of Object.entries(customCost)) {
      const cnt = Math.max(0, Number(n) || 0);
      for (let i = 0; i < cnt; i++) list.push(r);
    }
  } else {
    list = isDouble ? baseList.flatMap(r => [r, r]) : baseList;
  }
  const seen: Record<string, number> = {};
  const hand = me?.resources || {};
  const cardsHtml = list.map(r => {
    seen[r] = (seen[r] || 0) + 1;
    const avail = Math.max(0, hand[r] || 0);
    const hasIt = avail >= seen[r];
    return `<div class="recipe-mini-card card-${r} ${hasIt ? 'has-res' : 'lacks-res'}">${getMiniSvg(r)}</div>`;
  }).join('');
  const badgeHtml = isDouble ? `<span class="recipe-double-badge" title="Above base piece limit: costs 2× resources">2×</span>` : '';
  return `<div class="recipe-cards-strip">${badgeHtml}${cardsHtml}</div>`;
}

function updateActionRecipePopups(me: any): void {
  const map: Array<[string, RecipeKey]> = [
    ['recipePopupDev', 'dev'],
    ['recipePopupRoad', 'road'],
    ['recipePopupBridge', 'bridge'],
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

export function getSpectateTargetPlayer(): any {
  const players = state?.players || [];
  if (players.length === 0) return null;
  if (spectateTargetId) {
    const found = players.find(p => p.id === spectateTargetId);
    if (found) return found;
  }
  return players[state?.turnIndex ?? 0] || players[0];
}

export function renderHand(me: any, isMyTurn: boolean): void {
  const panel = document.getElementById('myHandPanel')!;
  if (!me || !me.resources) {
    if (state?.status === 'LOBBY') {
      updateActionRecipePopups(null);
      panel.innerHTML = `
        <div class="spectate-bar">
          <span class="spectate-badge">${uiIcon('eye', 16)} Spectating lobby</span>
          <button class="btn sm primary" onclick="toggleSpectate()" title="Take an open player seat">${uiIcon('users', 16)}Join seat</button>
        </div>
      `;
      return;
    }

    const target = getSpectateTargetPlayer();
    updateActionRecipePopups(target);
    if (!target || !target.resources) {
      panel.innerHTML = `<span class="hand-empty">${uiIcon('eye', 16)} Spectating</span>`;
      return;
    }

    const players = state?.players || [];
    const isAuto = !spectateTargetId || !players.some(p => p.id === spectateTargetId);
    const chipsHtml = players.map(p => {
      const active = !isAuto && p.id === target.id;
      return `<button type="button" class="spec-pchip ${active ? 'active' : ''}" onclick="selectSpectateTarget('${esc(p.id)}')" title="Inspect ${esc(p.name)}'s hand">
        <span class="avatar" style="background:${esc(p.color)};width:18px;height:18px">${avatarFace(p.avatar, p.name)}</span>
        <span class="spec-pname">${esc(p.name)}</span>
      </button>`;
    }).join('');

    const resHtml = RESOURCES.map(r => {
      const count = Math.max(0, target.resources?.[r] || 0);
      if (count <= 0) return '';
      return buildOverlappingStackHtml(`card-${r}`, getMiniSvg(r), count, '', `${RES_META[r].name}: ${count}`);
    }).join('');

    const oldDevs: string[] = target.devCards || [];
    const newDevs: string[] = target.newDevCards || [];
    const oldCounts: Record<string, number> = {};
    const newCounts: Record<string, number> = {};
    oldDevs.forEach(c => { oldCounts[c] = (oldCounts[c] || 0) + 1; });
    newDevs.forEach(c => { newCounts[c] = (newCounts[c] || 0) + 1; });
    const devTypes = Array.from(new Set([...oldDevs, ...newDevs]));
    const devHtml = devTypes.map(c => devCardHtml(c, oldCounts[c] || 0, newCounts[c] || 0, false)).join('');

    let cardsHtml = resHtml;
    if (resHtml && devHtml) cardsHtml += '<div class="hand-sep"></div>';
    cardsHtml += devHtml;
    if (!cardsHtml) {
      cardsHtml = `<span class="hand-empty">${esc(target.name)}: No cards</span>`;
    }

    panel.innerHTML = `
      <div class="spectate-bar">
        <span class="spectate-badge" title="Spectator mode — click any player to view their cards">${uiIcon('eye', 15)}</span>
        <button type="button" class="spec-pchip ${isAuto ? 'active' : ''}" onclick="selectSpectateTarget(null)" title="Follow active turn">Turn</button>
        ${chipsHtml}
      </div>
      <div class="hand-sep"></div>
      ${cardsHtml}
    `;
    return;
  }

  updateActionRecipePopups(me);

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
    const phaseAllowsCard = state.phase === 'MAIN' || (state.phase === 'ROLL' && c === 'knight');
    const canPlay = isMyTurn && phaseAllowsCard && !me.playedDevCardThisTurn && (oldCounts[c] || 0) > 0 && c !== 'vp';
    return devCardHtml(c, oldCounts[c] || 0, newCounts[c] || 0, canPlay);
  }).join('');

  let html = resHtml;
  if (resHtml && devHtml) html += '<div class="hand-sep"></div>';
  html += devHtml;

  if (state.status === 'LOBBY') {
    html += `<div class="hand-sep"></div><button class="btn sm" onclick="toggleSpectate()" title="Switch to spectator mode">${uiIcon('eye', 15)}Spectate</button>`;
  }

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
  if (!state) return;
  const phaseAllowsCard = state.phase === 'MAIN' || (state.phase === 'ROLL' && cardType === 'knight');
  if (!phaseAllowsCard) return;
  if (cardType === 'monopoly') {
    setDrawerMode('monopoly');
    renderInlineDrawer(state.players.find(p => p.id === socket.id), true);
  } else {
    socket.emit('playDevCard', { code: state.code, cardType });
    playTone(620, 0.12);
  }
}
