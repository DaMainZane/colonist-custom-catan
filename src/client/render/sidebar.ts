import { RESOURCES } from '../constants';
import { getMiniSvg } from '../icons';
import { socket } from '../socket';
import { state } from '../store';

export function renderSidebar(): void {
  const logEl = document.getElementById('logSection')!;
  logEl.innerHTML = state.logs.map(l => `
    <div class="log-line" style="color:${l.color || '#222'}">${l.text}</div>
  `).join('');
  logEl.scrollTop = logEl.scrollHeight;

  const chatEl = document.getElementById('chatFeed')!;
  chatEl.innerHTML = (state.chats || []).map(c => `
    <div><strong style="color:${c.color}">${c.avatar} ${c.sender}:</strong> <span style="color:${c.color}">${c.text}</span></div>
  `).join('');
  chatEl.scrollTop = chatEl.scrollHeight;

  const b = state.bank || { wood: 19, brick: 19, sheep: 19, wheat: 19, ore: 19 };
  document.getElementById('bankBar')!.innerHTML = `
    <span style="font-size:20px;" title="Bank">🏦</span>
    ${RESOURCES.map(r => `
      <div class="bank-item" id="bankRes_${r}">
        <div class="bank-mini-icon card-${r}">${getMiniSvg(r)}</div>
        <span>${b[r]}</span>
      </div>
    `).join('')}
    <div class="bank-item" id="bankDevDeckItem">
      <div class="bank-mini-icon card-dev">🃏</div>
      <span>${state.devDeckCount}</span>
    </div>
  `;

  const canPickVictim = state.phase === 'ROBBER_STEAL' && state.currentPlayerId === socket.id;
  const victimSet = new Set<string>(state.robberVictims || []);

  document.getElementById('playersStack')!.innerHTML = state.players.map((p, idx) => {
    const isVictim = canPickVictim && victimSet.has(p.id);
    return `
    <div class="p-row ${idx === state.turnIndex && state.status !== 'LOBBY' ? 'is-turn' : ''} ${isVictim ? 'can-rob' : ''}"
      id="playerRow_${p.id}"
      ${isVictim ? `onclick="chooseRobberVictim('${p.id}')" title="Click to Rob ${p.name}"` : ''}>
      <div class="p-avatar-wrap">
        <div class="p-circle" style="background:${p.color}">
          <span>${p.avatar}</span>
          <div class="vp-ribbon">${p.vp}</div>
        </div>
        <div>
          <div style="font-weight:800; font-size:13px;">
            ${p.name} ${p.isBot ? '<span style="font-size:10px; background:#222; color:#ffd700; padding:1px 4px; border-radius:4px;">HARD</span>' : ''}
            ${isVictim ? '<span style="font-size:10px; background:#d50000; color:#fff; padding:1px 5px; border-radius:4px;">♟️ ROB</span>' : ''}
          </div>
          <div style="font-size:11px; color:#555;">
            ${p.discardPending > 0 ? '<span style="color:#c62828; font-weight:900;">⚠️ Discarding...</span> ' : ''}
            ${state.longestRoadOwner === p.id ? '🏆 Road ' : ''}
            ${state.largestArmyOwner === p.id ? '⚔️ Army' : ''}
          </div>
        </div>
      </div>
      <div class="p-stats">
        <div class="stat-card-back" style="background:${p.resourceCount > state.settings.cardDiscardLimit ? '#c62828' : '#0288d1'}" title="Resource Cards">${p.resourceCount}</div>
        <div class="stat-card-back card-dev" title="Development Cards">${p.devCardCount}</div>
        <div style="text-align:center; min-width:22px;" title="Knights Played">⚔️<br>${p.knightsPlayed}</div>
        <div style="text-align:center; min-width:22px;" title="Longest Road">🛣️<br>${p.longestRoadLength}</div>
      </div>
    </div>
  `;
  }).join('');
}

export function sendChat(): void {
  const inp = document.getElementById('chatInput') as HTMLInputElement;
  if (!inp.value.trim()) return;
  socket.emit('sendChat', { code: state.code, text: inp.value });
  inp.value = '';
}
