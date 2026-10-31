// MODULE: Tidebound T10 pirates on the board (ship markup, the SVG layer markup, click to drive one off); draws its own styles | DEPENDS ON: client/audio, client/socket, client/store, client/util | USED BY: client/main, client/render/board
import { playTone } from '../audio';
import { socket } from '../socket';
import { hasDraggedMap, state } from '../store';
import { esc } from '../util';

const STYLE_ID = 'pirateStyles';

/** Styles live here (like the bridge picker's) so the pirate layer needs nothing from `styles.css`. Added once, on first draw. */
function ensurePirateStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
    @keyframes pirate-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2.5px); } }
    @keyframes pirate-ring-pulse { 0%, 100% { opacity: 0.95; } 50% { opacity: 0.35; } }
    .pirate-bob { animation: pirate-bob 2.6s ease-in-out infinite; }
    .pirate-flee .pirate-bob { animation-duration: 0.9s; }
    .pirate-ring { fill: none; stroke: var(--accent); stroke-width: 3; stroke-dasharray: 6 4; animation: pirate-ring-pulse 1.4s ease-in-out infinite; }
    .pirate-hull { fill: var(--ink); stroke: var(--piece-rim); stroke-width: 1.6; stroke-linejoin: round; }
    .pirate-mast { stroke: var(--ink); stroke-width: 2.4; stroke-linecap: round; }
    .pirate-sail { fill: var(--token); stroke: var(--ink); stroke-width: 1.4; stroke-linejoin: round; }
    .pirate-flag { fill: var(--token-hot); stroke: var(--ink); stroke-width: 1; stroke-linejoin: round; }
    .pirate-badge { fill: var(--token); stroke: var(--ink); stroke-width: 1.6; }
    .pirate-badge-text { fill: var(--token-ink); font-weight: 800; text-anchor: middle; font-size: 12px; }
    .pirate-flee .pirate-sail { opacity: 0.7; }
    @media (prefers-reduced-motion: reduce) { .pirate-bob, .pirate-ring { animation: none; } }
  `;
  document.head.appendChild(el);
}

/** A small ship drawn around (0, 0): hull, mast, two sails and a flag, with a strength badge underneath. */
export function pirateMarkup(strength: number, fleeing: boolean): string {
  const s = Math.max(1, Math.round(Number(strength) || 1));
  return `
    <g class="${fleeing ? 'pirate-flee' : ''}">
      <g class="pirate-bob">
        <path class="pirate-hull" d="M-17,5 L17,5 L11,15 L-11,15 Z" />
        <line class="pirate-mast" x1="0" y1="5" x2="0" y2="-19" />
        <path class="pirate-sail" d="M2.5,-16 L17,-4 L2.5,-4 Z" />
        <path class="pirate-sail" d="M-2.5,-12 L-15,-4 L-2.5,-4 Z" />
        <path class="pirate-flag" d="M0,-19 L10,-15.5 L0,-12 Z" />
      </g>
      <g transform="translate(0,25)">
        <circle class="pirate-badge" r="10" />
        <text class="pirate-badge-text" y="4.4">${s}</text>
      </g>
    </g>`;
}

/**
 * The pirates layer: one ship per pirate on its sea tile. A pirate you can drive off right now (`drives` = the server's `pirateDrives`)
 * gets a pulsing ring and a click handler; everyone sees the strength badge and the title text (what it takes).
 */
export function renderPiratesMarkup(
  pirates: { id: string; hexId: number; strength: number; mode: string }[],
  hexes: any[],
  drives: number[]
): string {
  if (!pirates || pirates.length === 0) return '';
  ensurePirateStyles();
  const canDrive = new Set<number>(drives || []);
  let html = '';
  for (const p of pirates) {
    const h = hexes[p.hexId];
    if (!h || h.fog) continue;
    const fleeing = p.mode === 'flee';
    const clickable = canDrive.has(p.hexId);
    const title = `Pirate ship, strength ${p.strength}${fleeing ? ' (fleeing)' : ''}: ${
      clickable ? 'click to drive it off' : `driving it off takes ${p.strength} played knight${p.strength === 1 ? '' : 's'} and a road, bridge or port touching this tile`
    }`;
    html += `
      <g transform="translate(${Number(h.x).toFixed(1)}, ${(Number(h.y) - 4).toFixed(1)}) scale(1.2)" data-pirate-id="${esc(p.id)}"
         ${clickable ? `onclick="clickPirate(${p.hexId})" style="cursor:pointer"` : 'style="pointer-events:none"'}>
        <title>${esc(title)}</title>
        ${clickable ? '<circle class="pirate-ring" r="27" />' : ''}
        ${pirateMarkup(p.strength, fleeing)}
      </g>`;
  }
  return html;
}

/** Drive off the pirate on this tile (only offered on pirates the server listed in your `pirateDrives`). */
export function clickPirate(hexId: number): void {
  if (hasDraggedMap || !state) return;
  playTone(600, 0.1);
  socket.emit('act', { code: state.code, type: 'drive_off_pirate', payload: { hexId } });
}
