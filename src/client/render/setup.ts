// MODULE: world setup page (host only, between the name page and the board): which screen shows, tile preview, roster | USED BY: render/index.ts
// The controls on the page (bots, presets, map menu, rules) keep their ids and handlers; this file only decides what is visible
// and draws the two small pieces that are new: the preview (tiles only, no numbers) and the player strip.
import { socket } from '../socket';
import { state } from '../store';
import { avatarFace } from '../avatars';
import { esc } from '../util';

let lastPreviewSig = '';
let lastRosterSig = '';

/** Tiles only: no number tokens, ports, robber or pieces. Water stays empty so the shape reads on its own. */
function drawPreview(svg: Element): void {
  const hexes = (state?.board?.hexes || []).filter((h: any) => h.type !== 'water' && Array.isArray(h.corners) && h.corners.length === 6);
  const sig = hexes.map((h: any) => `${h.q},${h.r},${h.type}`).join('|');
  if (sig === lastPreviewSig) return;
  lastPreviewSig = sig;
  if (hexes.length === 0) {
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.innerHTML = '<text x="50" y="52" text-anchor="middle" class="pv-empty">No land</text>';
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const h of hexes) {
    for (const c of h.corners) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }
  }
  const pad = 12;
  svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`);
  svg.innerHTML = hexes.map((h: any) => {
    const pts = h.corners.map((c: any) => `${c.x},${c.y}`).join(' ');
    return `<polygon class="pv-hex" points="${pts}" style="fill:var(--tile-${esc(h.type)}, var(--surface-3))"></polygon>`;
  }).join('');
}

function drawRoster(el: HTMLElement): void {
  const players = state?.players || [];
  const sig = players.map(p => `${p.id}|${p.name}|${p.avatar}|${p.color}|${p.difficulty ?? ''}`).join(';') + `|${state?.settings?.maxPlayers}`;
  if (sig === lastRosterSig) return;
  lastRosterSig = sig;
  const chips = players.map(p => {
    const key = String(p.difficulty || '').toLowerCase();
    const tag = p.isBot
      ? `<span class="tag tier-${esc(key)} tier-pick" onclick="cycleBotTier('${esc(p.id)}')" title="Click to change difficulty">Bot · ${esc(p.difficulty || '')}</span>`
      : p.id === state?.hostId ? '<span class="tag accent">Host</span>' : '';
    const pick = p.isBot || p.id === socket.id;
    return `<div class="setup-chip">
      <div class="avatar p-avatar ${pick ? 'avatar-pick' : ''}" style="background:${esc(p.color)}"
        ${pick ? `onclick="cycleAvatar('${esc(p.id)}')" title="Click to change avatar"` : ''}>${avatarFace(p.avatar, p.name)}</div>
      <span class="nm">${esc(p.name)}</span>${tag}
    </div>`;
  }).join('');
  el.innerHTML = `<div class="setup-count">${players.length} / ${esc(state?.settings?.maxPlayers ?? '')} seats</div>${chips}`;
}

/** Host sees the setup page while `state.setup` is on; everyone else sees "Host is creating world" over the board. */
export function renderSetupPage(): void {
  const page = document.getElementById('setupScreen');
  const wait = document.getElementById('hostWaiting');
  if (!page || !wait) return;
  const inLobby = !!state && state.status === 'LOBBY';
  const showSetup = inLobby && !!state!.setup && state!.hostId === socket.id;
  const showWait = inLobby && !!state!.setup && state!.hostId !== socket.id;
  page.style.display = showSetup ? 'flex' : 'none';
  wait.style.display = showWait ? 'flex' : 'none';
  if (!showSetup) return;
  const svg = document.getElementById('setupPreview');
  const roster = document.getElementById('setupRoster');
  if (svg) drawPreview(svg);
  if (roster) drawRoster(roster);
}
