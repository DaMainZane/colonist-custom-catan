// MODULE: tech panel (hub-and-spoke tree: a hub, one ring of techs per tier, one spoke per branch, all generated from the server's `techTree` rows; costs as mini resource cards; hover for the description; plus the Harbor charters (raise a whole port to 2:1) and Ground work controls) and the Tech button in the action bar | USED BY: client/render/index, client/main
import { getMiniSvg, uiIcon } from '../icons';
import { playTone } from '../audio';
import { socket } from '../socket';
import { state } from '../store';
import type { Resources, TechActionsView, TechRowView } from '../types';
import { esc } from '../util';

/** Icon (from `icons.ts`) per tech. A tech added later by a DLC falls back to its branch icon, then to the hub icon. */
const TECH_ICONS: Record<string, string> = {
  'tidebound.harbor_charters': 'waves',
  'bulwark.stockpiling': 'bank',
  'warlords.plunder': 'sword',
  'wildearth.ground_work': 'tree',
  'guildhall.road_levy': 'road'
};
const BRANCH_ICONS: Record<string, string> = {
  tidebound: 'waves',
  bulwark: 'bank',
  warlords: 'sword',
  wildearth: 'tree',
  guildhall: 'road'
};
/** Muted tile token that tints each branch (flat fill, the glyph stays dark). Unknown branches use fog. */
const BRANCH_TILE: Record<string, string> = {
  tidebound: '--tile-water',
  bulwark: '--tile-ore',
  warlords: '--tile-brick',
  wildearth: '--tile-wood',
  guildhall: '--tile-wheat'
};

let open = false;
let built = false;
let lastHtml = '';
/** The tile picked in the Ground work list, waiting for the resource choice. */
let pickedHex: number | null = null;

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const CSS = `
#techPanel{position:fixed;inset:0;z-index:80;display:none;align-items:center;justify-content:center;padding:12px;background:rgba(20,20,20,.5);--tp-node:64px;--tp-hub:76px}
#techPanel .tp-card{width:min(720px,100%);max-height:calc(100vh - 24px);overflow:auto;padding:14px 18px 18px;border-radius:var(--r-lg);background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}
#techPanel .tp-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
#techPanel .tp-head h3{margin:0;font-size:15px;font-weight:700}
#techPanel .tp-sub{margin:2px 0 4px;font-size:12px;font-weight:500;color:var(--ink-dim)}

#techPanel .tp-stage{position:relative;aspect-ratio:1;margin:0 auto;width:max(300px,min(600px,100%,calc(100vh - 190px)))}
#techPanel .tp-lines{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
#techPanel .tp-ring{fill:none;stroke:var(--line);stroke-width:1.5px;stroke-dasharray:3 5;vector-effect:non-scaling-stroke}
#techPanel .tp-line{stroke:var(--surface-3);stroke-width:4px;stroke-linecap:round;vector-effect:non-scaling-stroke}
#techPanel .tp-line.owned{stroke:var(--ok)}

#techPanel .tp-hub{position:absolute;left:50%;top:50%;width:var(--tp-hub);height:var(--tp-hub);transform:translate(-50%,-50%);border-radius:50%;background:var(--accent);color:var(--on-accent);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;box-shadow:0 0 0 6px var(--surface-2)}

#techPanel .tp-node{position:absolute;width:var(--tp-node);height:var(--tp-node);transform:translate(-50%,-50%);outline:none}
#techPanel .tp-node:hover,#techPanel .tp-node:focus-visible{z-index:6}
#techPanel .tp-disc{position:relative;width:100%;height:100%;border-radius:50%;background:var(--bc,var(--tile-fog));color:var(--target-dark);display:flex;align-items:center;justify-content:center;transition:transform .12s}
#techPanel .tp-disc svg.ui-icon{width:30px;height:30px}
#techPanel .tp-node.st-can .tp-disc{cursor:pointer;box-shadow:0 0 0 3px var(--accent)}
#techPanel .tp-node.st-can:hover .tp-disc,#techPanel .tp-node.st-can:focus-visible .tp-disc{transform:translateY(-3px)}
#techPanel .tp-node.st-owned .tp-disc{box-shadow:0 0 0 3px var(--ok)}
#techPanel .tp-node.st-locked .tp-disc{filter:grayscale(.45) brightness(.82)}
#techPanel .tp-node:focus-visible .tp-disc{outline:2px solid var(--accent);outline-offset:4px}
#techPanel .tp-check{position:absolute;right:-5px;bottom:-5px;width:22px;height:22px;border-radius:50%;background:var(--ok);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px var(--surface)}
#techPanel .tp-check svg.ui-icon{width:14px;height:14px}

#techPanel .tp-cap{position:absolute;top:calc(100% + 6px);left:50%;transform:translateX(-50%);width:112px;display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none}
#techPanel .tp-name{font-size:11px;font-weight:700;line-height:1.15;text-align:center}
#techPanel .tp-cap .recipe-mini-card{width:22px;height:30px;border-width:1px}
#techPanel .tp-cap .recipe-mini-card svg.glyph{width:15px;height:15px}

#techPanel .tp-tip{position:absolute;display:none;width:220px;padding:10px 12px;border-radius:var(--r);background:#2b2d30;color:#f4f1ea;box-shadow:0 6px 18px rgba(0,0,0,.38);pointer-events:none;z-index:8;animation:tpTipIn .12s ease-out}
#techPanel .tp-node:hover .tp-tip,#techPanel .tp-node:focus-visible .tp-tip{display:block}
#techPanel .tp-tip.tip-t{bottom:calc(100% + 8px)}
#techPanel .tp-tip.tip-b{top:calc(100% + 68px)}
#techPanel .tp-tip.tip-c{left:50%;margin-left:-110px}
#techPanel .tp-tip.tip-l{left:0}
#techPanel .tp-tip.tip-r{right:0}
#techPanel .tp-tip-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
#techPanel .tp-tip-name{font-size:13px;font-weight:700}
#techPanel .tp-tip-tier{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#b8b3a8;white-space:nowrap}
#techPanel .tp-tip-desc{margin-top:4px;font-size:12px;font-weight:500;line-height:1.35;color:#d8d3c8}
#techPanel .tp-tip-foot{margin-top:6px;font-size:11px;font-weight:700;color:#b8b3a8}
#techPanel .tp-tip-foot.can{color:#f0a85e}
#techPanel .tp-tip-foot.owned{color:#8fc489}
@keyframes tpTipIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}

#techPanel .tp-actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:14px}
#techPanel .tp-extra{flex:1 1 240px;max-width:340px;padding:10px 12px;border-radius:var(--r);background:var(--surface-2);display:flex;flex-direction:column;gap:6px}
#techPanel .tp-extra-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:700;font-size:12px}
#techPanel .tp-extra .recipe-cards-strip{align-self:flex-start}
#techPanel .tp-extra .recipe-mini-card{width:22px;height:30px;border-width:1px}
#techPanel .tp-extra .recipe-mini-card svg.glyph{width:15px;height:15px}
#techPanel .tp-port{font-size:12px;font-weight:600}
#techPanel .tp-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
#techPanel .tp-mini{border:0;border-radius:var(--r-sm);padding:5px 10px;min-height:28px;font-size:12px;font-weight:700;cursor:pointer;background:var(--surface-3);color:var(--ink)}
#techPanel .tp-mini:hover{background:var(--surface)}
#techPanel .tp-mini.sel{background:var(--accent);color:var(--on-accent)}
#techPanel .tp-mini:disabled{opacity:.45;cursor:not-allowed}
#techPanel .tp-done{font-size:12px;font-weight:800;color:var(--ok)}
#techPanel .tp-why{font-size:11.5px;font-weight:500;color:var(--ink-dim)}
@media (max-width:640px){#techPanel{--tp-node:52px;--tp-hub:60px}#techPanel .tp-disc svg.ui-icon{width:24px;height:24px}}
`;

/** Builds the Tech button (inside the action bar, left of Trade) and the panel once. */
function ensureDom(): void {
  if (built) return;
  built = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const btn = document.createElement('button');
  btn.id = 'techPanelBtn';
  btn.type = 'button';
  btn.className = 'act-btn';
  btn.title = 'Open the tech tree';
  btn.style.display = 'none';
  btn.innerHTML = `${uiIcon('tech', 22)}<span class="lbl">Tech</span>`;
  btn.setAttribute('onclick', 'toggleTechPanel()');
  const bar = document.querySelector('.action-bar');
  const trade = document.getElementById('btnTradeDrawer');
  if (bar && trade) bar.insertBefore(btn, trade);
  else if (bar) bar.appendChild(btn);
  else document.body.appendChild(btn);

  const panel = document.createElement('div');
  panel.id = 'techPanel';
  panel.addEventListener('click', e => { if (e.target === panel) toggleTechPanel(false); });
  document.body.appendChild(panel);
}

/** A cost as mini resource cards (one card per unit, dimmed when the hand cannot cover it), like the build recipes. */
export function costStripHtml(cost: Resources, hand: Resources | undefined): string {
  const seen: Record<string, number> = {};
  const units: string[] = [];
  for (const [r, n] of Object.entries(cost)) for (let i = 0; i < Math.max(0, Number(n) || 0); i++) units.push(r);
  if (units.length === 0) return '';
  const cards = units.map(r => {
    seen[r] = (seen[r] || 0) + 1;
    const has = (hand?.[r] || 0) >= seen[r];
    return `<div class="recipe-mini-card card-${esc(r)} ${has ? 'has-res' : 'lacks-res'}">${getMiniSvg(r)}</div>`;
  }).join('');
  return `<div class="recipe-cards-strip">${cards}</div>`;
}

interface Placed {
  row: TechRowView;
  x: number;
  y: number;
}

/**
 * Hub and spoke: one spoke per branch (evenly spaced, the first at the top), one ring per tier.
 * Positions are percentages of a square stage. With only tier 1 there is a single ring; deeper tiers
 * (added later by a DLC) fill the rings between the hub and the edge.
 */
function layout(rows: TechRowView[], branches: string[]): { placed: Placed[]; radii: Map<number, number> } {
  const maxTier = Math.max(1, ...rows.map(r => r.tier));
  const radius = (t: number): number => (maxTier === 1 ? 32 : 17 + ((t - 1) * 17) / (maxTier - 1));
  const radii = new Map<number, number>();
  const groups = new Map<string, TechRowView[]>();
  for (const r of rows) {
    radii.set(r.tier, radius(r.tier));
    const k = `${r.branch}|${r.tier}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const placed: Placed[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const base = -90 + (360 * branches.indexOf(first.branch)) / branches.length;
    group.forEach((row, j) => {
      const a = ((base + (j - (group.length - 1) / 2) * 9) * Math.PI) / 180;
      const rad = radius(row.tier);
      placed.push({ row, x: 50 + rad * Math.cos(a), y: 50 + rad * Math.sin(a) });
    });
  }
  return { placed, radii };
}

function nodeHtml(p: Placed, canAct: boolean, hand: Resources | undefined): string {
  const r = p.row;
  const mode = r.owned ? 'owned' : r.canResearch && canAct ? 'can' : 'locked';
  const icon = TECH_ICONS[r.id] ?? BRANCH_ICONS[r.branch] ?? 'tech';
  const tile = BRANCH_TILE[r.branch] ?? '--tile-fog';
  const tipPos = `${p.y >= 50 ? 'tip-t' : 'tip-b'} ${p.x < 30 ? 'tip-l' : p.x > 70 ? 'tip-r' : 'tip-c'}`;
  const foot = r.owned
    ? 'Researched'
    : mode === 'can'
      ? 'Click to research'
      : r.canResearch
        ? 'Research on your turn'
        : r.reason || 'Not available yet';
  const click = mode === 'can' ? `onclick="researchTechClick('${esc(r.id)}')"` : '';
  return `
    <div class="tp-node st-${mode}" style="left:${p.x.toFixed(2)}%;top:${p.y.toFixed(2)}%;--bc:var(${tile})" tabindex="0" role="button"
         aria-label="${esc(r.name)}${r.owned ? ', researched' : `, ${r.cost} cards`}" ${click}>
      <div class="tp-disc">${uiIcon(icon, 30)}${r.owned ? `<span class="tp-check">${uiIcon('check', 14)}</span>` : ''}</div>
      <div class="tp-cap"><span class="tp-name">${esc(r.name)}</span>${r.owned ? '' : costStripHtml(r.payment, hand)}</div>
      <div class="tp-tip ${tipPos}">
        <div class="tp-tip-head"><span class="tp-tip-name">${esc(r.name)}</span><span class="tp-tip-tier">Tier ${r.tier}</span></div>
        <div class="tp-tip-desc">${esc(r.description)}</div>
        <div class="tp-tip-foot ${r.owned ? 'owned' : mode === 'can' ? 'can' : ''}">${esc(foot)}</div>
      </div>
    </div>`;
}

/** Harbor charters: your cities on a 3:1 port, each with one button that raises the whole port to 2:1 (no resource choice). */
function harborHtml(h: NonNullable<TechActionsView['harbor']>, canAct: boolean, hand: Resources | undefined): string {
  const rows = h.ports.length === 0
    ? '<div class="tp-why">Build a city on a 3:1 port to raise it.</div>'
    : h.ports.map(p => {
        if (p.level >= 1) {
          return `<div class="tp-port">City #${p.vertexId} · <span class="tp-done">2:1 any resource</span></div>`;
        }
        const button = `<button class="tp-mini" type="button" ${canAct && h.affordable ? '' : 'disabled'} onclick="upgradePortClick(${p.vertexId})">Raise to 2:1</button>`;
        return `<div class="tp-port">City #${p.vertexId} · 3:1 port<div class="tp-chips">${button}</div></div>`;
      }).join('');
  return `<div class="tp-extra"><div class="tp-extra-title">Raise the port ${costStripHtml(h.cost, hand)}</div>${rows}</div>`;
}

/** Ground work: pick one of your qualifying tiles, then the basic tile it becomes. One use per game. */
function groundHtml(w: NonNullable<TechActionsView['groundWork']>, canAct: boolean): string {
  const title = '<div class="tp-extra-title">Ground work · one use</div>';
  if (w.used) return `<div class="tp-extra">${title}<div class="tp-done">Used</div></div>`;
  if (w.hexes.length === 0) return `<div class="tp-extra">${title}<div class="tp-why">No land tile next to your settlements or cities qualifies yet.</div></div>`;
  if (pickedHex !== null && !w.hexes.some(h => h.hexId === pickedHex)) pickedHex = null;
  const chosen = w.hexes.find(h => h.hexId === pickedHex);
  const tiles = w.hexes.map(h =>
    `<button class="tp-mini ${h.hexId === pickedHex ? 'sel' : ''}" type="button" onclick="pickGroundHex(${h.hexId})">${esc(cap(h.type))} ${h.number === null ? '(no number)' : h.number} · #${h.hexId}</button>`
  ).join('');
  let picker = '<div class="tp-why">Pick a tile.</div>';
  if (chosen) {
    const note = chosen.number === null ? 'A number is rolled for it.' : `It keeps its ${chosen.number}.`;
    const buttons = w.choices.filter(c => c !== chosen.type).map(c =>
      `<button class="tp-mini" type="button" ${canAct ? '' : 'disabled'} onclick="convertTileClick('${esc(c)}')">${esc(cap(c))}</button>`
    ).join('');
    picker = `<div class="tp-why">${esc(note)} Turn it into:</div><div class="tp-chips">${buttons}</div>`;
  }
  return `<div class="tp-extra">${title}<div class="tp-chips">${tiles}</div>${picker}</div>`;
}

/** Called from renderAll. Shows the Tech button while the tree is on; redraws the panel when it is open and something changed. */
export function renderTechPanel(isMyTurn: boolean): void {
  ensureDom();
  const btn = document.getElementById('techPanelBtn') as HTMLElement;
  const panel = document.getElementById('techPanel') as HTMLElement;
  const rows = state && state.status !== 'LOBBY' ? state.techTree : null;
  if (!rows) {
    btn.style.display = 'none';
    btn.classList.remove('active-mode');
    panel.style.display = 'none';
    open = false;
    lastHtml = '';
    return;
  }
  btn.style.display = '';
  btn.classList.toggle('active-mode', open);
  panel.style.display = open ? 'flex' : 'none';
  if (!open) {
    lastHtml = '';
    return;
  }

  const canAct = isMyTurn && state.phase === 'MAIN';
  const hand = state.players.find(p => p.id === socket.id)?.resources;
  const actions = state.techActions;
  const branches: string[] = [];
  for (const r of rows) if (!branches.includes(r.branch)) branches.push(r.branch);
  const { placed, radii } = layout(rows, branches);
  const at = new Map(placed.map(p => [p.row.id, p]));

  const rings = [...radii.values()].map(rad => `<circle class="tp-ring" cx="50" cy="50" r="${rad}"/>`).join('');
  const lines = placed.map(p => {
    const parents = p.row.prereqs.map(id => at.get(id)).filter((q): q is Placed => !!q);
    const from = parents.length > 0 ? parents : [{ x: 50, y: 50 } as Placed];
    return from.map(q => `<line class="tp-line ${p.row.owned ? 'owned' : ''}" x1="${q.x.toFixed(2)}" y1="${q.y.toFixed(2)}" x2="${p.x.toFixed(2)}" y2="${p.y.toFixed(2)}"/>`).join('');
  }).join('');
  const nodes = placed.map(p => nodeHtml(p, canAct, hand)).join('');

  const extras = [
    actions?.harbor ? harborHtml(actions.harbor, canAct, hand) : '',
    actions?.groundWork ? groundHtml(actions.groundWork, canAct) : ''
  ].join('');
  const hint = canAct
    ? 'Click a highlighted tech to research it. Hover for details. Prices grow with your settlements and cities.'
    : 'You can research on your own turn, after the roll. Hover a tech for details.';

  const html = `
    <div class="tp-card">
      <div class="tp-head"><h3>Tech tree</h3><button class="btn sm" type="button" onclick="toggleTechPanel(false)">Close</button></div>
      <div class="tp-sub">${esc(hint)}</div>
      <div class="tp-stage">
        <svg class="tp-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${rings}${lines}</svg>
        <div class="tp-hub">${uiIcon('tech', 26)}<span>Tech</span></div>
        ${nodes}
      </div>
      ${extras ? `<div class="tp-actions">${extras}</div>` : ''}
    </div>`;
  // Skip the redraw when nothing changed, so a hovered description does not flicker on every broadcast.
  if (html !== lastHtml) {
    panel.innerHTML = html;
    lastHtml = html;
  }
}

function myTurnNow(): boolean {
  if (!state) return false;
  const me = state.players.find(p => p.id === socket.id);
  const current = state.players[state.turnIndex];
  return Boolean(me && (state.currentPlayerId === socket.id || (current && current.id === socket.id)));
}

export function toggleTechPanel(force?: boolean): void {
  open = typeof force === 'boolean' ? force : !open;
  playTone(open ? 560 : 460, 0.05);
  if (!state) return;
  renderTechPanel(myTurnNow());
}

export function researchTechClick(techId: string): void {
  if (!state?.code) return;
  socket.emit('researchTech', { code: state.code, techId });
  playTone(600, 0.08);
}

/** Harbor charters: raise the port under the city on vertex `vertexId` from 3:1 to 2:1 for every resource. */
export function upgradePortClick(vertexId: number): void {
  if (!state?.code) return;
  socket.emit('upgradePort', { code: state.code, vertexId });
  playTone(600, 0.08);
}

/** Ground work, step 1: remember which tile the player picked, then show the resource choice. */
export function pickGroundHex(hexId: number): void {
  pickedHex = pickedHex === hexId ? null : hexId;
  playTone(520, 0.04);
  if (state) renderTechPanel(myTurnNow());
}

/** Ground work, step 2: turn the picked tile into the basic tile `resource`. */
export function convertTileClick(resource: string): void {
  if (!state?.code || pickedHex === null) return;
  socket.emit('convertTile', { code: state.code, hexId: pickedHex, resource });
  pickedHex = null;
  playTone(600, 0.08);
}
