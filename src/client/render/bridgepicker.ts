// MODULE: bridge picker (Tidebound T4c: type picker popup on an empty ocean edge, upgrade popup on your own rickety bridge, one popup that sits over the edge) | USED BY: render/board, render/index, main
import { uiIcon } from '../icons';
import { playTone } from '../audio';
import { socket } from '../socket';
import { state, hasDraggedMap, setBuildModeValue } from '../store';
import { esc } from '../util';
import { canClientAffordBridgeUpgrade, getClientPieceCost, isRicketyEnabled } from './board';
import { costStripHtml } from './techpanel';

/** What the popup is for: choosing the type to build on an empty ocean edge, or upgrading the rickety bridge that stands on one. */
interface PickerMode {
  kind: 'build' | 'upgrade';
  edgeId: number;
}

let mode: PickerMode | null = null;
let built = false;
let lastHtml = '';

const CSS = `
#bridgePicker{position:fixed;z-index:70;display:none;transform:translate(-50%,-100%);margin-top:-14px}
#bridgePicker.below{transform:translate(-50%,0);margin-top:14px}
#bridgePicker .bp-card{display:flex;flex-direction:column;gap:8px;min-width:200px;max-width:min(380px,calc(100vw - 16px));padding:10px;border-radius:var(--r-lg);background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}
#bridgePicker .bp-title{font-size:12px;font-weight:700;color:var(--ink-dim)}
#bridgePicker .bp-opts{display:flex;gap:8px}
#bridgePicker .bp-opt{flex:1 1 0;display:flex;flex-direction:column;align-items:flex-start;gap:5px;padding:8px 10px;border:0;border-radius:var(--r);background:var(--surface-2);color:var(--ink);font:inherit;text-align:left;cursor:pointer}
#bridgePicker .bp-opt:hover:not(:disabled),#bridgePicker .bp-opt:focus-visible{background:var(--surface-3);box-shadow:0 0 0 2px var(--accent);outline:none}
#bridgePicker .bp-opt:disabled{opacity:.5;cursor:not-allowed}
#bridgePicker .bp-name{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700}
#bridgePicker .bp-note{font-size:11px;font-weight:500;color:var(--ink-dim)}
#bridgePicker .bp-opt .recipe-cards-strip{align-self:flex-start}
#bridgePicker .bp-opt .recipe-mini-card{width:22px;height:30px;border-width:1px}
#bridgePicker .bp-opt .recipe-mini-card svg.glyph{width:15px;height:15px}
.bridge-upgrade-dot{fill:var(--accent);stroke:var(--surface);stroke-width:2.5;opacity:.95}
`;

function ensureDom(): void {
  if (built) return;
  built = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.id = 'bridgePicker';
  el.innerHTML = '<div class="bp-card"></div>';
  document.body.appendChild(el);

  // Pressing anywhere else (or scrolling, or Escape) puts the popup away. Pressing an edge spot closes it and the click then reopens it there.
  document.addEventListener('pointerdown', e => {
    if (mode && !(e.target as Element | null)?.closest?.('#bridgePicker')) closeBridgePicker();
  }, true);
  document.addEventListener('wheel', () => { if (mode) closeBridgePicker(); }, { capture: true, passive: true });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && mode) closeBridgePicker(); });
}

function myTurnNow(): boolean {
  if (!state) return false;
  const me = state.players.find(p => p.id === socket.id);
  const current = state.players[state.turnIndex];
  return Boolean(me && (state.currentPlayerId === socket.id || (current && current.id === socket.id)));
}

/** One option of the type picker: the name, a one-line note (or why it cannot be built), and the price as mini cards. */
function optionHtml(piece: 'bridge' | 'rickety_bridge', me: any): string {
  const cost = getClientPieceCost(piece, me.id || socket.id || '');
  const left = me.bridgesLeft ?? 0;
  const affordable = Object.entries(cost).every(([r, n]) => (me.resources?.[r] || 0) >= (Number(n) || 0));
  const why = left <= 0 ? 'No bridges left' : !affordable ? 'Not enough resources' : '';
  const name = piece === 'bridge' ? 'Bridge' : 'Rickety bridge';
  const note = piece === 'bridge' ? 'Sturdy' : 'Cheap, 1 health';
  return `
    <button class="bp-opt" type="button" ${why ? 'disabled' : ''} title="${esc(why || name)}" onclick="chooseBridgeType('${piece}')">
      <span class="bp-name">${uiIcon('bridge', 18)}${esc(name)}</span>
      <span class="bp-note">${esc(why || note)}</span>
      ${costStripHtml(cost, me.resources)}
    </button>`;
}

function contentHtml(m: PickerMode, me: any): string {
  if (m.kind === 'build') {
    return `
      <div class="bp-title">Build on this edge</div>
      <div class="bp-opts">${optionHtml('bridge', me)}${optionHtml('rickety_bridge', me)}</div>`;
  }
  const cost = me.bridgeUpgradeCost || {};
  const affordable = canClientAffordBridgeUpgrade(me);
  return `
    <div class="bp-title">Rickety bridge</div>
    <div class="bp-opts">
      <button class="bp-opt" type="button" ${affordable ? '' : 'disabled'} title="${esc(affordable ? 'Upgrade to a full bridge' : 'Not enough resources')}" onclick="confirmBridgeUpgrade()">
        <span class="bp-name">${uiIcon('bridge', 18)}Upgrade to a full bridge</span>
        <span class="bp-note">${affordable ? 'Replaces it in place' : 'Not enough resources'}</span>
        ${costStripHtml(cost, me.resources)}
      </button>
    </div>`;
}

/** Screen position of the middle of an edge (same approach as the robber flight). */
function edgeScreenPoint(edgeId: number): { x: number; y: number } | null {
  const svg = document.getElementById('boardSvg') as unknown as SVGSVGElement | null;
  const e = state?.board?.edges?.[edgeId];
  if (!svg || !e) return null;
  const v1 = state.board.vertices[e.v1];
  const v2 = state.board.vertices[e.v2];
  const ctm = svg.getScreenCTM();
  if (!v1 || !v2 || !ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = (v1.x + v2.x) / 2;
  pt.y = (v1.y + v2.y) / 2;
  const out = pt.matrixTransform(ctm);
  return { x: out.x, y: out.y };
}

function place(edgeId: number): void {
  const el = document.getElementById('bridgePicker');
  const pt = edgeScreenPoint(edgeId);
  if (!el || !pt) return;
  el.style.left = `${Math.min(Math.max(pt.x, 150), Math.max(150, window.innerWidth - 150))}px`;
  el.style.top = `${pt.y}px`;
  // Near the top of the screen the popup opens below the edge instead of above it.
  el.classList.toggle('below', pt.y < 170);
}

/** Draws the popup for the current mode, or puts it away when it no longer applies (not your turn, the edge changed, the addon is off). */
function refresh(isMyTurn: boolean): void {
  ensureDom();
  const el = document.getElementById('bridgePicker') as HTMLElement;
  if (!mode) {
    el.style.display = 'none';
    lastHtml = '';
    return;
  }
  const me = state?.players?.find(p => p.id === socket.id);
  const edge = state?.board?.edges?.[mode.edgeId];
  const valid = !!(
    state && me && edge && isMyTurn && state.phase === 'MAIN' && isRicketyEnabled(me) &&
    (mode.kind === 'build'
      ? !edge.road && edge.hexIds.length === 0
      : edge.pieceType === 'rickety_bridge' && edge.road === socket.id)
  );
  if (!valid) {
    closeBridgePicker();
    return;
  }
  const html = contentHtml(mode, me);
  // Skip the redraw when nothing changed, so a hovered button does not flicker on every broadcast.
  if (html !== lastHtml) {
    (el.querySelector('.bp-card') as HTMLElement).innerHTML = html;
    lastHtml = html;
  }
  el.style.display = 'block';
}

/** Called from renderAll: keeps the open popup in step with the state (prices, resources) or closes it. */
export function renderBridgePicker(isMyTurn: boolean): void {
  refresh(isMyTurn);
}

export function closeBridgePicker(): void {
  mode = null;
  lastHtml = '';
  const el = document.getElementById('bridgePicker');
  if (el) el.style.display = 'none';
}

/** An empty ocean edge was clicked and rickety bridges are in the game: ask which kind to build. */
export function openBridgePicker(edgeId: number): void {
  if (!state?.code) return;
  mode = { kind: 'build', edgeId };
  lastHtml = '';
  refresh(myTurnNow());
  if (mode) {
    place(edgeId);
    playTone(520, 0.04);
  }
}

/** One of your own rickety bridges was clicked (the bridge or its marker): offer the upgrade. */
export function clickPlacedBridge(edgeId: number): void {
  if (hasDraggedMap) return;
  if (!state?.code || state.phase !== 'MAIN' || !myTurnNow()) return;
  const edge = state.board.edges[edgeId];
  if (!edge || edge.pieceType !== 'rickety_bridge' || edge.road !== socket.id) return;
  mode = { kind: 'upgrade', edgeId };
  lastHtml = '';
  refresh(true);
  if (mode) {
    place(edgeId);
    playTone(520, 0.04);
  }
}

/** The picker's choice: build a full bridge or a rickety one on the edge the popup is over. */
export function chooseBridgeType(piece: string): void {
  if (!mode || mode.kind !== 'build' || !state?.code) return;
  if (piece !== 'bridge' && piece !== 'rickety_bridge') return;
  const edgeId = mode.edgeId;
  closeBridgePicker();
  setBuildModeValue(null);
  socket.emit('clickEdge', { code: state.code, edgeId, piece });
  playTone(600, 0.08);
}

/** The upgrade button: turn the rickety bridge the popup is over into a full bridge. */
export function confirmBridgeUpgrade(): void {
  if (!mode || mode.kind !== 'upgrade' || !state?.code) return;
  const edgeId = mode.edgeId;
  closeBridgePicker();
  socket.emit('upgradeBridge', { code: state.code, edgeId });
  playTone(600, 0.08);
}
