// MODULE: right sidebar (log, chat, bank, player rows) | USED BY: render/index.ts, main.ts
import { RESOURCES } from '../constants';
import { getMiniSvg, uiIcon } from '../icons';
import { socket } from '../socket';
import { state, inFlightPlayerResCount, inFlightPlayerDevCount } from '../store';
import { esc } from '../util';
import { avatarFace } from '../avatars';

// Log and chat are text the player may select and copy. Re-writing innerHTML on every game update
// would wipe the selection, so each feed only re-renders when its content actually changed.
let lastLogSig = '';
let lastChatSig = '';

function hasSelectionIn(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  return el.contains(sel.anchorNode) || el.contains(sel.focusNode);
}

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}

function renderFeed(el: HTMLElement, sig: string, lastSig: string, html: () => string): boolean {
  if (sig === lastSig) return false;
  // Never replace text the player is in the middle of selecting; the next update will catch up.
  if (hasSelectionIn(el)) return false;
  const stick = isNearBottom(el);
  el.innerHTML = html();
  if (stick) el.scrollTop = el.scrollHeight;
  return true;
}

// In the lobby everyone can change their own avatar, and the host can change the bots'.
function canPickAvatar(p: any): boolean {
  if (state.status !== 'LOBBY') return false;
  return p.id === socket.id || (p.isBot && state.hostId === socket.id);
}

/** "Bot · Main" tag. In the lobby the host clicks it to change that bot's difficulty. */
function botTag(p: any): string {
  const label = p.difficulty ? String(p.difficulty) : '';
  const key = label.toLowerCase();
  const text = label ? `Bot · ${esc(label)}` : 'Bot';
  const pick = state.status === 'LOBBY' && state.hostId === socket.id && !!label;
  return `<span class="tag tier-${esc(key)} ${pick ? 'tier-pick' : ''}"
    ${pick ? `onclick="cycleBotTier('${esc(p.id)}')" title="Click to change difficulty"` : `title="Bot difficulty: ${esc(label || 'unknown')}"`}>${text}</span>`;
}

// ---- Player list: fixed size (CSS), scrolls to follow the turn ----------------------------------------------------
// The list always shows 4 rows. With more players it scrolls, and every new turn scrolls the current player into view with the
// smallest move that shows the whole row (turn goes to player 5: one row down; back to player 1: up to the top).
let lastTurnKey = '';
let lastRobKey = '';
let followRaf = 0;
let stackGuardsBound = false;

// Grabbing the list (wheel, drag, touch) stops the automatic scroll so it never fights the hand.
function bindStackGuards(el: HTMLElement): void {
  if (stackGuardsBound) return;
  stackGuardsBound = true;
  const stop = () => {
    if (followRaf) cancelAnimationFrame(followRaf);
    followRaf = 0;
  };
  el.addEventListener('wheel', stop, { passive: true });
  el.addEventListener('pointerdown', stop, { passive: true });
  el.addEventListener('touchstart', stop, { passive: true });
}

function scrollStackTo(el: HTMLElement, target: number): void {
  if (followRaf) cancelAnimationFrame(followRaf);
  followRaf = 0;
  const from = el.scrollTop;
  const dist = target - from;
  if (Math.abs(dist) < 1) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    el.scrollTop = target;
    return;
  }
  const dur = Math.min(520, 200 + Math.abs(dist) * 0.8);
  const t0 = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / dur);
    el.scrollTop = from + dist * (1 - Math.pow(1 - k, 3));
    followRaf = k < 1 ? requestAnimationFrame(step) : 0;
  };
  followRaf = requestAnimationFrame(step);
}

/** Scrolls the list the least it takes to show `row` completely. */
function revealRow(stackEl: HTMLElement, row: HTMLElement | null): void {
  if (!row) return;
  const top = row.offsetTop;
  const bottom = top + row.offsetHeight;
  const view = stackEl.scrollTop;
  const h = stackEl.clientHeight;
  let target = view;
  if (top < view) target = top;
  else if (bottom > view + h) target = bottom - h;
  target = Math.max(0, Math.min(Math.max(0, stackEl.scrollHeight - h), target));
  scrollStackTo(stackEl, target);
}

/**
 * Screen rect of an element for the card-flight animations. A player row that is scrolled out of the list would send the cards
 * flying over the chat or off screen, so its rect is pulled to the nearest edge of the visible list (the card lands on the edge row).
 */
export function visibleRect(el: HTMLElement): { left: number; top: number; width: number; height: number } {
  const r = el.getBoundingClientRect();
  const stack = document.getElementById('playersStack');
  if (!stack || !el.classList.contains('p-row') || !stack.contains(el)) return r;
  const s = stack.getBoundingClientRect();
  const top = Math.min(Math.max(r.top, s.top), Math.max(s.top, s.bottom - r.height));
  return { left: r.left, top, width: r.width, height: r.height };
}

export function renderSidebar(): void {
  const logEl = document.getElementById('logSection')!;
  const logs: any[] = state.logs || [];
  const logSig = `${logs.length}|${logs.length ? logs[logs.length - 1].text : ''}`;
  if (renderFeed(logEl, logSig, lastLogSig, () => logs.map(l => `
    <div class="log-line" ${l.color ? `style="color:${esc(l.color)}"` : ''}>${l.text}</div>
  `).join(''))) {
    lastLogSig = logSig;
  }

  const chatEl = document.getElementById('chatFeed')!;
  const chats: any[] = state.chats || [];
  const chatSig = `${chats.length}|${chats.length ? chats[chats.length - 1].text : ''}`;
  if (renderFeed(chatEl, chatSig, lastChatSig, () => chats.map(c => `
    <div class="msg"><span class="dot" style="background:${esc(c.color)}"></span><strong>${esc(c.sender)}</strong>${esc(c.text)}</div>
  `).join(''))) {
    lastChatSig = chatSig;
  }

  const b = state.bank || { wood: 19, brick: 19, sheep: 19, wheat: 19, ore: 19 };
  document.getElementById('bankBar')!.innerHTML = `
    <span class="bank-ico" title="Bank">${uiIcon('bank', 22)}</span>
    ${RESOURCES.map(r => `
      <div class="bank-item" id="bankRes_${r}">
        <div class="bank-chip card-${r}">${getMiniSvg(r)}</div>
        <span>${b[r]}</span>
      </div>
    `).join('')}
    <div class="bank-item" id="bankDevDeckItem">
      <div class="bank-chip card-dev">${uiIcon('devcard', 16)}</div>
      <span>${state.devDeckCount}</span>
    </div>
  `;

  const canPickVictim = state.phase === 'ROBBER_STEAL' && state.currentPlayerId === socket.id;
  const victimSet = new Set<string>(state.robberVictims || []);

  // innerHTML rebuilds reset the scroll position, which made the list jump. Keep it.
  const stackEl = document.getElementById('playersStack')!;
  const stackTop = stackEl.scrollTop;
  bindStackGuards(stackEl);

  stackEl.innerHTML = state.players.map((p, idx) => {
    const isVictim = canPickVictim && victimSet.has(p.id);
    const isTurn = idx === state.turnIndex && state.status !== 'LOBBY';
    const shownResCount = Math.max(0, p.resourceCount - (inFlightPlayerResCount[p.id] || 0));
    const shownDevCount = Math.max(0, p.devCardCount - (inFlightPlayerDevCount[p.id] || 0));
    const overLimit = shownResCount > state.settings.cardDiscardLimit;
    const tags = [
      p.isBot ? botTag(p) : '',
      isVictim ? '<span class="tag danger">Rob</span>' : '',
      p.discardPending > 0 ? '<span class="tag danger">Discarding</span>' : '',
      state.longestRoadOwner === p.id ? '<span class="tag accent">Longest road</span>' : '',
      state.largestArmyOwner === p.id ? '<span class="tag accent">Largest army</span>' : ''
    ].filter(Boolean).join('');

    const pub = p.publicVp ?? p.vp;
    const vpHtml = pub !== p.vp ? `${pub}<span class="vp-hidden" title="Your real score. Others see ${pub}.">(${p.vp})</span>` : `${p.vp}`;

    return `
    <div class="p-row ${isTurn ? 'is-turn' : ''} ${isVictim ? 'can-rob' : ''}"
      id="playerRow_${esc(p.id)}"
      ${isVictim ? `onclick="chooseRobberVictim('${esc(p.id)}')" title="Click to rob ${esc(p.name)}"` : ''}>
      <div class="avatar p-avatar ${canPickAvatar(p) ? 'avatar-pick' : ''}" style="background:${esc(p.color)}"
        ${canPickAvatar(p) ? `onclick="cycleAvatar('${esc(p.id)}')" title="Click to change avatar"` : ''}>${avatarFace(p.avatar, p.name)}</div>
      <div>
        <div class="p-name"><span class="nm">${esc(p.name)}</span></div>
        <div class="p-sub">${tags}</div>
      </div>
      <div class="p-vp">${vpHtml}<small>VP</small></div>
      <div class="p-stats">
        <span class="stat ${overLimit ? 'warn' : ''}" title="Resource cards">${uiIcon('cards', 14)}${shownResCount}</span>
        <span class="stat dev" title="Development cards">${uiIcon('devcard', 14)}${shownDevCount}</span>
        <span class="stat" title="Knights played">${uiIcon('sword', 14)}${p.knightsPlayed}</span>
        <span class="stat" title="Longest road">${uiIcon('road', 14)}${p.longestRoadLength}</span>
      </div>
    </div>
  `;
  }).join('');
  stackEl.scrollTop = stackTop;

  // Follow the turn: when the current player changes, scroll them into view. Lobby and game over reset to the top.
  const turnKey = state.status === 'LOBBY' || state.status === 'GAMEOVER' ? '' : String(state.currentPlayerId ?? state.turnIndex);
  if (turnKey !== lastTurnKey) {
    const hadTurn = lastTurnKey !== '';
    lastTurnKey = turnKey;
    if (turnKey) revealRow(stackEl, document.getElementById(`playerRow_${state.currentPlayerId ?? state.players[state.turnIndex]?.id}`));
    else if (hadTurn) scrollStackTo(stackEl, 0);
  }
  // The player you have to rob must be reachable: scroll to the first victim when the choice opens.
  const robKey = canPickVictim ? [...victimSet].join(',') : '';
  if (robKey !== lastRobKey) {
    lastRobKey = robKey;
    if (robKey) revealRow(stackEl, stackEl.querySelector<HTMLElement>('.p-row.can-rob'));
  }
}

export function sendChat(): void {
  const inp = document.getElementById('chatInput') as HTMLInputElement;
  if (!inp.value.trim()) return;
  socket.emit('sendChat', { code: state.code, text: inp.value });
  inp.value = '';
}
