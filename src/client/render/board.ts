import { RES_META } from '../constants';
import { getBoardIconSvg } from '../icons';
import { playTone } from '../audio';
import { socket } from '../socket';
import {
  state, buildMode, camZoom, camPanX, camPanY, activeBrush, isMouseDown, setBuildModeValue,
  setCamZoom, setCamPan
} from '../store';

const knownRoads = new Set<number>();
const knownBuildings = new Map<number, string>();
const knownFogHexes = new Set<number>();
const pieceAnimTimestamps = new Map<string, number>();
const ANIM_DURATION_MS = 500;

let cachedBoundsKey = '';
let cachedBounds = { centerX0: 0, centerY0: 0, contentW: 1000, contentH: 900 };

export function getBoardBounds(): { centerX0: number; centerY0: number; contentW: number; contentH: number } {
  if (!state || !state.board || !state.board.hexes || state.board.hexes.length === 0) {
    return { centerX0: 0, centerY0: 0, contentW: 1000, contentH: 900 };
  }
  const key = `${state.code}_${state.status}_${state.board.hexes.length}`;
  if (key === cachedBoundsKey) return cachedBounds;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  state.board.hexes.forEach((h: any) => {
    h.corners.forEach((pt: any) => {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    });
  });

  const topExtra = state.status === 'LOBBY' ? 210 : 115;
  const bottomExtra = 165;
  const sidePad = 130;

  const contentX = minX - sidePad;
  const contentY = minY - topExtra;
  const contentW = (maxX - minX) + sidePad * 2;
  const contentH = (maxY - minY) + topExtra + bottomExtra;

  cachedBoundsKey = key;
  cachedBounds = {
    centerX0: contentX + contentW / 2,
    centerY0: contentY + contentH / 2,
    contentW,
    contentH
  };
  return cachedBounds;
}

export function updateCameraViewBox(): void {
  if (!state || !state.board) return;
  const svg = document.getElementById('boardSvg');
  if (!svg) return;
  const { centerX0, centerY0, contentW, contentH } = getBoardBounds();
  const baseW = contentW * camZoom;
  const baseH = contentH * camZoom;
  const baseX = (centerX0 - camPanX) - baseW / 2;
  const baseY = (centerY0 - camPanY) - baseH / 2;
  svg.setAttribute('viewBox', `${baseX} ${baseY} ${baseW} ${baseH}`);
}

function getPieceAnimAttrs(key: string, now: number): { isAnimating: boolean; delayStyle: string } {
  const start = pieceAnimTimestamps.get(key);
  if (start === undefined) return { isAnimating: false, delayStyle: '' };
  const elapsed = now - start;
  if (elapsed >= ANIM_DURATION_MS) return { isAnimating: false, delayStyle: '' };
  return {
    isAnimating: true,
    delayStyle: `animation-delay: -${Math.max(0, Math.round(elapsed))}ms;`
  };
}

export function renderBoard(me: any, isMyTurn: boolean): void {
  if (!state || !state.board) return;
  const svg = document.getElementById('boardSvg')!;
  const { hexes, vertices, edges, robberHexId } = state.board;
  const isLobbyHost = state.status === 'LOBBY' && state.hostId === socket.id;

  if (state.status === 'LOBBY') {
    knownRoads.clear();
    knownBuildings.clear();
    knownFogHexes.clear();
    pieceAnimTimestamps.clear();
    for (const h of hexes) {
      if (h.fog || h.type === 'fog') knownFogHexes.add(h.id);
    }
  }

  const now = performance.now();
  for (const h of hexes) {
    const isFog = !!h.fog || h.type === 'fog';
    if (isFog) {
      knownFogHexes.add(h.id);
    } else if (knownFogHexes.has(h.id)) {
      knownFogHexes.delete(h.id);
      pieceAnimTimestamps.set(`fog_${h.id}`, now);
    }
  }
  for (const e of edges) {
    if (e.road && !knownRoads.has(e.id)) {
      knownRoads.add(e.id);
      pieceAnimTimestamps.set(`road_${e.id}`, now);
    }
  }
  for (const v of vertices) {
    if (v.building) {
      const prev = knownBuildings.get(v.id);
      if (prev !== v.building.type) {
        knownBuildings.set(v.id, v.building.type);
        pieceAnimTimestamps.set(`${v.building.type}_${v.id}`, now);
      }
    }
  }

  updateCameraViewBox();

  let html = `
    <defs>
      <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ffd700" />
        <stop offset="50%" stop-color="#ff9800" />
        <stop offset="100%" stop-color="#ffd700" />
      </linearGradient>
      <linearGradient id="fogGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#cfd8dc" />
        <stop offset="50%" stop-color="#b0bec5" />
        <stop offset="100%" stop-color="#90a4ae" />
      </linearGradient>
    </defs>
  `;

  const coastalHexIds = new Set<number>();
  for (const e of edges) {
    if (e.hexIds.length === 1) coastalHexIds.add(e.hexIds[0]);
  }
  const landPolys = hexes
    .filter((h: any) => h.type !== 'water' && coastalHexIds.has(h.id))
    .map((h: any) => h.corners.map((c: any) => `${c.x},${c.y}`).join(' '));
  landPolys.forEach((pts: string) => {
    html += `<polygon points="${pts}" fill="#26c6da" stroke="#26c6da" stroke-width="46" stroke-linejoin="round" opacity="0.45" />`;
  });
  landPolys.forEach((pts: string) => {
    html += `<polygon points="${pts}" fill="#f4d799" stroke="#f4d799" stroke-width="22" stroke-linejoin="round" />`;
  });

  for (const h of hexes) {
    const pts = h.corners.map((c: any) => `${c.x},${c.y}`).join(' ');
    if (h.type === 'water') {
      if (state.status === 'LOBBY') {
        html += `
          <polygon points="${pts}" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.22)" stroke-width="2" stroke-dasharray="6,4"
            style="cursor:pointer" onmousedown="onHexInteract(${h.id}, event)" onmouseenter="onHexEnter(${h.id}, event)" />
        `;
      }
      continue;
    }

    const isFog = !!h.fog || h.type === 'fog';
    const tileType = isFog ? 'fog' : h.type;
    const meta = RES_META[tileType] || RES_META.desert;
    const canClickRobber = isMyTurn && state.phase === 'ROBBER' && h.id !== robberHexId && !isFog;
    const pipsCount = (!isFog && h.number) ? Math.max(0, 6 - Math.abs(7 - h.number)) : 0;
    const pipsDots = '•'.repeat(pipsCount);
    const isRedNum = h.number === 6 || h.number === 8;
    const fogAnim = getPieceAnimAttrs(`fog_${h.id}`, now);

    html += `
      <g style="${isLobbyHost || canClickRobber ? 'cursor:pointer' : ''}"
         onmousedown="onHexInteract(${h.id}, event)"
         onmouseenter="onHexEnter(${h.id}, event)">
        <polygon points="${pts}" fill="${meta.color}" stroke="${meta.border}" stroke-width="8" stroke-linejoin="round" />
        <polygon points="${pts}" fill="none" stroke="${isFog ? '#eceff1' : '#e8c987'}" stroke-width="3" />
        <g transform="translate(${h.x}, ${h.y})">
          <g class="${fogAnim.isAnimating ? 'fog-reveal-anim' : ''}" style="${fogAnim.delayStyle}">
            ${getBoardIconSvg(tileType, 0, isFog ? -16 : -30, 1.25)}
            ${(!isFog && h.number) ? `
              <rect x="-24" y="-4" width="48" height="46" rx="9" fill="#f5efe6" stroke="#c5bba8" stroke-width="2.5" />
              <text x="0" y="22" text-anchor="middle" font-size="25" font-weight="900" fill="${isRedNum ? '#d50000' : '#111'}">${h.number}</text>
              <text x="0" y="36" text-anchor="middle" font-size="14" font-weight="900" letter-spacing="1" fill="${isRedNum ? '#d50000' : '#333'}">${pipsDots}</text>
            ` : ''}
          </g>
        </g>

        ${h.id === robberHexId && !isFog ? `
          <g transform="translate(${h.x + 28}, ${h.y - 16})">
            <ellipse cx="0" cy="18" rx="14" ry="5" fill="rgba(0,0,0,0.35)" />
            <path d="M-12,16 L12,16 L8,-2 C11,-6 6,-16 0,-16 C-6,-16 -11,-6 -8,-2 Z" fill="#90a4ae" stroke="#263238" stroke-width="2.2" stroke-linejoin="round"/>
            <circle cx="0" cy="-14" r="7.5" fill="#b0bec5" stroke="#263238" stroke-width="2"/>
          </g>
        ` : ''}
      </g>
    `;
  }

  for (const e of edges) {
    if (e.hexIds.length !== 1) continue;
    const v1 = vertices[e.v1], v2 = vertices[e.v2];
    if (!v1 || !v2) continue;

    const mx = (v1.x + v2.x) / 2, my = (v1.y + v2.y) / 2;
    const h = hexes[e.hexIds[0]];
    const dx = mx - h.x, dy = my - h.y;
    const len = Math.hypot(dx, dy) || 1;
    const sx = mx + (dx / len) * 44;
    const sy = my + (dy / len) * 44;

    if (e.port) {
      const portRatio = e.port === '3:1' ? '3:1' : '2:1';
      html += `
        <g onclick="${isLobbyHost ? `onEdgeInteract(${e.id})` : ''}" style="${isLobbyHost ? 'cursor:pointer' : ''}">
          <line x1="${v1.x}" y1="${v1.y}" x2="${sx}" y2="${sy}" stroke="#d9822b" stroke-width="6" stroke-linecap="round" />
          <line x1="${v2.x}" y1="${v2.y}" x2="${sx}" y2="${sy}" stroke="#d9822b" stroke-width="6" stroke-linecap="round" />
          <path d="M ${sx-20} ${sy+10} L ${sx+20} ${sy+10} L ${sx+13} ${sy+20} L ${sx-13} ${sy+20} Z" fill="#8d4925" stroke="#fff" stroke-width="1.5" />
          <path d="M ${sx-17} ${sy+9} Q ${sx} ${sy-28} ${sx+17} ${sy+9} Z" fill="#fff" stroke="#ccc" stroke-width="1.5" />
          ${e.port === '3:1'
            ? `<text x="${sx}" y="${sy - 3}" text-anchor="middle" font-size="14" font-weight="900" fill="#b71c1c">?</text>`
            : getBoardIconSvg(e.port, sx, sy - 6, 0.55)
          }
          <text x="${sx}" y="${sy + 8}" text-anchor="middle" font-size="9.5" font-weight="900" fill="#111">${portRatio}</text>
        </g>
      `;
    } else if (isLobbyHost && activeBrush.type === 'port') {
      html += `
        <circle cx="${mx}" cy="${my}" r="9" fill="rgba(255,255,255,0.45)" stroke="#0288d1" stroke-width="2"
          style="cursor:pointer" onclick="onEdgeInteract(${e.id})" />
      `;
    }
  }

  for (const e of edges) {
    const v1 = vertices[e.v1], v2 = vertices[e.v2];
    if (!v1 || !v2) continue;
    if (e.road) {
      const owner = state.players.find(p => p.id === e.road);
      const mx = (v1.x + v2.x) / 2;
      const my = (v1.y + v2.y) / 2;
      const dx = (v2.x - v1.x) / 2;
      const dy = (v2.y - v1.y) / 2;
      const anim = getPieceAnimAttrs(`road_${e.id}`, now);
      html += `
        <g transform="translate(${mx}, ${my})">
          ${anim.isAnimating ? `<circle cx="0" cy="0" r="20" class="piece-impact-ring" style="${anim.delayStyle}" />` : ''}
          <g class="${anim.isAnimating ? 'piece-drop-anim' : ''}" style="${anim.delayStyle}">
            <line x1="${-dx}" y1="${-dy}" x2="${dx}" y2="${dy}" stroke="#222" stroke-width="14" stroke-linecap="round" />
            <line x1="${-dx}" y1="${-dy}" x2="${dx}" y2="${dy}" stroke="${owner?.color || '#fff'}" stroke-width="9" stroke-linecap="round" />
          </g>
        </g>
      `;
    } else if (isMyTurn && canClientPlaceRoad(e, me)) {
      const mx = (v1.x + v2.x) / 2, my = (v1.y + v2.y) / 2;
      html += `
        <g onclick="clickEdge(${e.id})" style="cursor:pointer">
          <line x1="${v1.x}" y1="${v1.y}" x2="${v2.x}" y2="${v2.y}" stroke="rgba(255,255,255,0.4)" stroke-width="14" stroke-linecap="round" />
          <circle cx="${mx}" cy="${my}" r="10" fill="#4caf50" stroke="#fff" stroke-width="2.5" />
        </g>
      `;
    }
  }

  const robberVictimSet = new Set<string>(state.robberVictims || []);
  for (const v of vertices) {
    if (v.building) {
      const owner = state.players.find(p => p.id === v.building.owner);
      const col = owner?.color || '#fff';
      const canUpgrade = isMyTurn && state.phase === 'MAIN' && v.building.owner === socket.id &&
        v.building.type === 'settlement' && me.resources.wheat >= 2 && me.resources.ore >= 3 && me.citiesLeft > 0;
      const canRobThisBuilding = isMyTurn && state.phase === 'ROBBER_STEAL' &&
        v.hexIds.includes(robberHexId) && robberVictimSet.has(v.building.owner);
      const isClickable = canUpgrade || canRobThisBuilding;

      if (v.building.type === 'settlement') {
        const anim = getPieceAnimAttrs(`settlement_${v.id}`, now);
        html += `
          <g transform="translate(${v.x}, ${v.y})" onclick="${isClickable ? `clickVertex(${v.id})` : ''}" style="${isClickable ? 'cursor:pointer' : ''}">
            ${anim.isAnimating ? `<circle cx="0" cy="4" r="24" class="piece-impact-ring" style="${anim.delayStyle}" />` : ''}
            ${canRobThisBuilding ? `<circle cx="0" cy="0" r="22" fill="none" stroke="#ff1744" stroke-width="3.5" stroke-dasharray="5,3" />` : ''}
            <g class="${anim.isAnimating ? 'piece-drop-anim' : ''}" style="${anim.delayStyle}">
              <polygon points="0,-17 14,-5 14,13 -14,13 -14,-5"
                fill="${col}" stroke="${canUpgrade ? '#ffd700' : (canRobThisBuilding ? '#ff1744' : '#111')}" stroke-width="${isClickable ? '4' : '3'}" stroke-linejoin="round" />
            </g>
          </g>
        `;
      } else {
        const anim = getPieceAnimAttrs(`city_${v.id}`, now);
        html += `
          <g transform="translate(${v.x}, ${v.y})" onclick="${canRobThisBuilding ? `clickVertex(${v.id})` : ''}" style="${canRobThisBuilding ? 'cursor:pointer' : ''}">
            ${anim.isAnimating ? `<circle cx="0" cy="4" r="28" class="piece-impact-ring" style="${anim.delayStyle}" />` : ''}
            ${canRobThisBuilding ? `<circle cx="0" cy="0" r="25" fill="none" stroke="#ff1744" stroke-width="3.5" stroke-dasharray="5,3" />` : ''}
            <g class="${anim.isAnimating ? 'piece-drop-anim' : ''}" style="${anim.delayStyle}">
              <polygon points="-18,14 -18,-6 -6,-19 6,-6 18,-6 18,14"
                fill="${col}" stroke="${canRobThisBuilding ? '#ff1744' : '#111'}" stroke-width="${canRobThisBuilding ? '4' : '3'}" stroke-linejoin="round" />
            </g>
          </g>
        `;
      }
    } else if (isMyTurn && canClientPlaceSettlement(v, me)) {
      html += `
        <circle cx="${v.x}" cy="${v.y}" r="13" fill="rgba(255, 215, 0, 0.9)" stroke="#fff" stroke-width="3"
          class="spot-pulse" onclick="clickVertex(${v.id})" />
      `;
    }
  }

  svg.innerHTML = html;
}

// Updates camera viewBox immediately on pan/zoom/reset without reconstructing the SVG DOM.
export function rerenderBoard(): void {
  if (!state) return;
  updateCameraViewBox();
}

export function resetCamera(): void {
  setCamZoom(1);
  setCamPan(0, 0);
  updateCameraViewBox();
}

export function onHexInteract(hexId: number, ev?: MouseEvent): void {
  if (ev && (ev.button === 2 || ev.button === 1 || ev.altKey)) return;
  if (state.status === 'LOBBY' && state.hostId === socket.id) {
    if (activeBrush.type === 'terrain' || activeBrush.type === 'number' || activeBrush.type === 'robber') {
      socket.emit('paintHex', {
        code: state.code,
        hexId,
        paintType: activeBrush.type,
        paintValue: activeBrush.value
      });
      playTone(400, 0.04);
    }
  } else if (state.phase === 'ROBBER' && state.players[state.turnIndex]?.id === socket.id) {
    socket.emit('clickHex', { code: state.code, hexId });
    playTone(260, 0.12);
  }
}

// Drag-painting: only paints while the mouse button is held.
export function onHexEnter(hexId: number, ev?: MouseEvent): void {
  if (isMouseDown) onHexInteract(hexId, ev);
}

export function onEdgeInteract(edgeId: number): void {
  if (state.status === 'LOBBY' && state.hostId === socket.id && activeBrush.type === 'port') {
    socket.emit('paintPort', { code: state.code, edgeId, portValue: activeBrush.value });
    playTone(520, 0.06);
  }
}

export function canClientPlaceSettlement(v: any, me: any): boolean {
  if (!me || me.settlementsLeft <= 0) return false;
  for (const adjId of v.adjacentVertices) {
    if (state.board.vertices[adjId]?.building) return false;
  }
  if (state.phase === 'SETUP_SETTLEMENT') return true;
  if (state.phase !== 'MAIN') return false;
  if (buildMode && buildMode !== 'settlement') return false;
  if (me.resources.wood < 1 || me.resources.brick < 1 || me.resources.sheep < 1 || me.resources.wheat < 1) return false;
  return v.edgeIds.some((eId: number) => state.board.edges[eId]?.road === socket.id);
}

export function canClientPlaceRoad(e: any, me: any): boolean {
  if (!me || me.roadsLeft <= 0) return false;
  if (state.phase === 'SETUP_ROAD') {
    return e.v1 === state.lastSetupVertexId || e.v2 === state.lastSetupVertexId;
  }
  if (state.phase !== 'MAIN') return false;
  if (buildMode && buildMode !== 'road' && me.freeRoads === 0) return false;
  const canAfford = me.freeRoads > 0 || (me.resources.wood >= 1 && me.resources.brick >= 1);
  if (!canAfford) return false;

  for (const vId of [e.v1, e.v2]) {
    const v = state.board.vertices[vId];
    if (!v) continue;
    if (v.building && v.building.owner === socket.id) return true;
    if (v.building && v.building.owner !== socket.id) continue;
    if (v.edgeIds.some((oe: number) => state.board.edges[oe]?.road === socket.id)) return true;
  }
  return false;
}

export function clickVertex(vertexId: number): void {
  playTone(580, 0.09);
  setBuildModeValue(null);
  socket.emit('clickVertex', { code: state.code, vertexId });
}

export function clickEdge(edgeId: number): void {
  playTone(460, 0.08);
  setBuildModeValue(null);
  socket.emit('clickEdge', { code: state.code, edgeId });
}

