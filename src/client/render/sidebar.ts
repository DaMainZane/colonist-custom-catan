// MODULE: right sidebar (log, chat, bank, player rows) | USED BY: render/index.ts, main.ts
import { RESOURCES } from '../constants';
import { getMiniSvg, uiIcon } from '../icons';
import { socket } from '../socket';
import { state } from '../store';
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

  stackEl.innerHTML = state.players.map((p, idx) => {
    const isVictim = canPickVictim && victimSet.has(p.id);
    const isTurn = idx === state.turnIndex && state.status !== 'LOBBY';
    const overLimit = p.resourceCount > state.settings.cardDiscardLimit;
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
        <span class="stat ${overLimit ? 'warn' : ''}" title="Resource cards">${uiIcon('cards', 14)}${p.resourceCount}</span>
        <span class="stat dev" title="Development cards">${uiIcon('devcard', 14)}${p.devCardCount}</span>
        <span class="stat" title="Knights played">${uiIcon('sword', 14)}${p.knightsPlayed}</span>
        <span class="stat" title="Longest road">${uiIcon('road', 14)}${p.longestRoadLength}</span>
      </div>
    </div>
  `;
  }).join('');
  stackEl.scrollTop = stackTop;
}

export function sendChat(): void {
  const inp = document.getElementById('chatInput') as HTMLInputElement;
  if (!inp.value.trim()) return;
  socket.emit('sendChat', { code: state.code, text: inp.value });
  inp.value = '';
}
