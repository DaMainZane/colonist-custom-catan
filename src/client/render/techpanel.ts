// MODULE: tech panel (hub-and-spoke view of the tech tree, one spoke per branch, generated from the server's `techTree` rows; plus the buttons of the Harbor charters and Ground work techs) | USED BY: client/render/index, client/main
import { playTone } from '../audio';
import { socket } from '../socket';
import { state } from '../store';
import type { Resources, TechActionsView, TechRowView } from '../types';
import { esc } from '../util';

const BRANCH_NAMES: Record<string, string> = {
  tidebound: 'Tidebound',
  bulwark: 'Bulwark',
  warlords: 'Warlords',
  wildearth: 'Wild Earth',
  guildhall: 'Guildhall'
};

let open = false;
let built = false;
/** The tile picked in the Ground work list, waiting for the resource choice. */
let pickedHex: number | null = null;

/** A branch id as a label: the known DLC names, otherwise the id with capitals ("sky_ports" -> "Sky Ports"). */
function branchLabel(id: string): string {
  return BRANCH_NAMES[id] ?? id.split(/[_\s]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function payText(pay: Resources): string {
  const parts = Object.entries(pay).filter(([, n]) => n > 0).map(([r, n]) => `${n} ${r}`);
  return parts.length ? parts.join(' + ') : 'free';
}

const CSS = `
#techPanelBtn{position:fixed;left:12px;top:50%;transform:translateY(-50%);z-index:60;display:none;padding:8px 12px;border-radius:var(--r-lg,12px);border:1px solid var(--line,#8884);background:var(--surface,#fff);color:inherit;font-weight:700;cursor:pointer;box-shadow:var(--shadow,0 2px 8px #0003)}
#techPanelBtn:hover{background:var(--surface-2,#eee)}
#techPanel{position:fixed;inset:0;z-index:80;display:none;align-items:center;justify-content:center;background:#0008}
#techPanel .tp-card{width:min(920px,94vw);max-height:88vh;overflow:auto;padding:16px 18px;border-radius:var(--r-lg,12px);border:1px solid var(--line,#8884);background:var(--surface,#fff);color:inherit;box-shadow:var(--shadow,0 8px 30px #0006)}
#techPanel .tp-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
#techPanel .tp-head h3{margin:0;font-size:1.15rem}
#techPanel .tp-sub{margin:4px 0 10px;font-size:.85rem;opacity:.75}
#techPanel .tp-close{border:1px solid var(--line,#8884);background:var(--surface-2,#eee);color:inherit;border-radius:8px;padding:4px 10px;cursor:pointer;font-weight:700}
#techPanel .tp-hub{width:84px;height:84px;margin:6px auto 0;border-radius:50%;display:flex;align-items:center;justify-content:center;text-align:center;font-weight:800;font-size:.8rem;background:var(--accent,#2772b0);color:#fff;box-shadow:0 0 0 6px var(--surface-2,#eee)}
#techPanel .tp-stem{width:2px;height:16px;margin:0 auto;background:var(--line,#8886)}
#techPanel .tp-spokes{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;border-top:2px solid var(--line,#8886);padding-top:12px}
#techPanel .tp-branch{flex:1 1 200px;max-width:280px;min-width:190px;padding:10px;border-radius:10px;border:1px solid var(--line,#8884);background:var(--surface-2,#f4f4f4)}
#techPanel .tp-branch h4{margin:0 0 8px;font-size:.95rem}
#techPanel .tp-node{margin-bottom:8px;padding:8px;border-radius:8px;border:1px solid var(--line,#8883);background:var(--surface,#fff)}
#techPanel .tp-node.owned{border-color:var(--ok,#2e7d32);box-shadow:inset 0 0 0 1px var(--ok,#2e7d32)}
#techPanel .tp-name{font-weight:800}
#techPanel .tp-tier{font-weight:600;font-size:.72rem;opacity:.65;margin-left:6px}
#techPanel .tp-desc{font-size:.82rem;margin:3px 0 6px;opacity:.85}
#techPanel .tp-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
#techPanel .tp-cost{font-size:.8rem;font-weight:700}
#techPanel .tp-go{border:0;border-radius:8px;padding:5px 12px;font-weight:800;cursor:pointer;background:var(--ok,#2e7d32);color:#fff}
#techPanel .tp-go:disabled{opacity:.4;cursor:not-allowed}
#techPanel .tp-done{font-size:.8rem;font-weight:800;color:var(--ok,#2e7d32)}
#techPanel .tp-why{font-size:.74rem;opacity:.7;margin-top:4px}
#techPanel .tp-extra{margin-bottom:8px;padding:8px;border-radius:8px;border:1px dashed var(--line,#8886);background:var(--surface,#fff)}
#techPanel .tp-extra-title{font-weight:800;font-size:.8rem;margin-bottom:6px}
#techPanel .tp-port{margin-bottom:6px;font-size:.8rem}
#techPanel .tp-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
#techPanel .tp-mini{border:1px solid var(--line,#8886);border-radius:6px;padding:3px 8px;font-size:.76rem;font-weight:700;cursor:pointer;background:var(--surface-2,#eee);color:inherit}
#techPanel .tp-mini.sel{background:var(--accent,#2772b0);color:#fff;border-color:var(--accent,#2772b0)}
#techPanel .tp-mini:disabled{opacity:.4;cursor:not-allowed}
`;

function ensureDom(): void {
  if (built) return;
  built = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const btn = document.createElement('button');
  btn.id = 'techPanelBtn';
  btn.type = 'button';
  btn.textContent = '🔬 Tech';
  btn.title = 'Open the tech tree';
  btn.setAttribute('onclick', 'toggleTechPanel()');
  document.body.appendChild(btn);

  const panel = document.createElement('div');
  panel.id = 'techPanel';
  panel.addEventListener('click', e => { if (e.target === panel) toggleTechPanel(false); });
  document.body.appendChild(panel);
}

/** Harbor charters: your cities on a 3:1 port, with one button per resource to upgrade it to 2:1. */
function harborHtml(h: NonNullable<TechActionsView['harbor']>, canAct: boolean): string {
  const rows = h.ports.length === 0
    ? '<div class="tp-why">Build a city on a 3:1 port to upgrade it.</div>'
    : h.ports.map(p => {
        if (p.resource) {
          return `<div class="tp-port">City #${p.vertexId} · <span class="tp-done">2:1 ${esc(cap(p.resource))}</span></div>`;
        }
        const buttons = h.resources.map(r =>
          `<button class="tp-mini" type="button" ${canAct && h.affordable ? '' : 'disabled'} onclick="upgradePortClick(${p.vertexId},'${esc(r)}')">${esc(cap(r))}</button>`
        ).join('');
        return `<div class="tp-port">City #${p.vertexId} · 3:1 port. Upgrade to 2:1 for:<div class="tp-chips">${buttons}</div></div>`;
      }).join('');
  const hint = h.ports.some(p => !p.resource) && !h.affordable ? '<div class="tp-why">You do not have the cards for an upgrade yet.</div>' : '';
  return `<div class="tp-extra"><div class="tp-extra-title">Harbor upgrade · ${esc(payText(h.cost))}</div>${rows}${hint}</div>`;
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

function branchHtml(branch: string, rows: TechRowView[], canAct: boolean, extras: string): string {
  const nodes = [...rows].sort((a, b) => a.tier - b.tier).map(r => {
    const reason = !r.owned && !r.canResearch ? r.reason : null;
    const why = reason ? `<div class="tp-why">${esc(reason)}</div>` : '';
    const action = r.owned
      ? `<span class="tp-done">Researched</span>`
      : `<button class="tp-go" type="button" ${r.canResearch && canAct ? '' : 'disabled'} onclick="researchTechClick('${esc(r.id)}')">Research</button>`;
    return `
      <div class="tp-node ${r.owned ? 'owned' : ''}">
        <div><span class="tp-name">${esc(r.name)}</span><span class="tp-tier">Tier ${r.tier}</span></div>
        <div class="tp-desc">${esc(r.description)}</div>
        <div class="tp-row"><span class="tp-cost">${r.cost} cards · ${esc(payText(r.payment))}</span>${action}</div>
        ${why}
      </div>`;
  }).join('');
  return `<div class="tp-branch"><h4>${esc(branchLabel(branch))}</h4>${nodes}${extras}</div>`;
}

/** Called from renderAll. Shows the button while the tree is on; redraws the panel when it is open. */
export function renderTechPanel(isMyTurn: boolean): void {
  ensureDom();
  const btn = document.getElementById('techPanelBtn') as HTMLElement;
  const panel = document.getElementById('techPanel') as HTMLElement;
  const rows = state && state.status !== 'LOBBY' ? state.techTree : null;
  if (!rows) {
    btn.style.display = 'none';
    panel.style.display = 'none';
    open = false;
    return;
  }
  btn.style.display = 'block';
  panel.style.display = open ? 'flex' : 'none';
  if (!open) return;

  const canAct = isMyTurn && state.phase === 'MAIN';
  const actions = state.techActions;
  const branches: string[] = [];
  for (const r of rows) if (!branches.includes(r.branch)) branches.push(r.branch);
  const spokes = branches.map(b => {
    let extras = '';
    if (b === 'tidebound' && actions?.harbor) extras = harborHtml(actions.harbor, canAct);
    else if (b === 'wildearth' && actions?.groundWork) extras = groundHtml(actions.groundWork, canAct);
    return branchHtml(b, rows.filter(r => r.branch === b), canAct, extras);
  }).join('');
  const hint = canAct
    ? 'Prices grow with your settlements and cities. Research takes wheat and ore.'
    : 'You can research on your own turn, after the roll.';
  panel.innerHTML = `
    <div class="tp-card">
      <div class="tp-head"><h3>Tech tree</h3><button class="tp-close" type="button" onclick="toggleTechPanel(false)">Close</button></div>
      <div class="tp-sub">${esc(hint)}</div>
      <div class="tp-hub">Tech<br>hub</div>
      <div class="tp-stem"></div>
      <div class="tp-spokes">${spokes}</div>
    </div>`;
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

/** Harbor charters: upgrade the city on vertex `vertexId` so `resource` trades 2:1 there. */
export function upgradePortClick(vertexId: number, resource: string): void {
  if (!state?.code) return;
  socket.emit('upgradePort', { code: state.code, vertexId, resource });
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
