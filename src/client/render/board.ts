import { RES_META } from '../constants';
import { getBoardIconSvg } from '../icons';
import { playTone } from '../audio';
import { socket } from '../socket';
import {
  state, buildMode, camZoom, camPanX, camPanY, activeBrush, isMouseDown, setBuildModeValue,
  setCamZoom, setCamPan
} from '../store';

export function renderBoard(me: any, isMyTurn: boolean): void {
  if (!state || !state.board) return;
  const svg = document.getElementById('boardSvg')!;
  const { hexes, vertices, edges, robberHexId } = state.board;
  const isLobbyHost = state.status === 'LOBBY' && state.hostId === socket.id;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  hexes.forEach(h => {
    h.corners.forEach(pt => {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    });
  });

  const topExtra = state.status === 'LOBBY' ? 210 : 115;
  const bottomExtra = 165;
  const sidePad = 130;

  const baseX = (minX - sidePad) - camPanX * camZoom;
  const baseY = (minY - topExtra) - camPanY * camZoom;
  const baseW = ((maxX - minX) + sidePad * 2) * camZoom;
  const baseH = ((maxY - minY) + topExtra + bottomExtra) * camZoom;
  svg.setAttribute('viewBox', `${baseX} ${baseY} ${baseW} ${baseH}`);

  let html = `
    <defs>
      <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ffd700" />
        <stop offset="50%" stop-color="#ff9800" />
        <stop offset="100%" stop-color="#ffd700" />
      </linearGradient>
    </defs>
  `;

  const landPolys = hexes.filter(h => h.type !== 'water').map(h => h.corners.map(c => `${c.x},${c.y}`).join(' '));
  landPolys.forEach(pts => {
    html += `<polygon points="${pts}" fill="#26c6da" stroke="#26c6da" stroke-width="46" stroke-linejoin="round" opacity="0.45" />`;
  });
  landPolys.forEach(pts => {
    html += `<polygon points="${pts}" fill="#f4d799" stroke="#f4d799" stroke-width="22" stroke-linejoin="round" />`;
  });

  for (const h of hexes) {
    const pts = h.corners.map(c => `${c.x},${c.y}`).join(' ');
    if (h.type === 'water') {
      if (state.status === 'LOBBY') {
        html += `
          <polygon points="${pts}" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.22)" stroke-width="2" stroke-dasharray="6,4"
            style="cursor:pointer" onmousedown="onHexInteract(${h.id}, event)" onmouseenter="onHexEnter(${h.id}, event)" />
        `;
      }
      continue;
    }

    const meta = RES_META[h.type] || RES_META.desert;
    const canClickRobber = isMyTurn && state.phase === 'ROBBER' && h.id !== robberHexId;
    const pipsCount = h.number ? Math.max(0, 6 - Math.abs(7 - h.number)) : 0;
    const pipsDots = '•'.repeat(pipsCount);
    const isRedNum = h.number === 6 || h.number === 8;

    html += `
      <g style="${isLobbyHost || canClickRobber ? 'cursor:pointer' : ''}"
         onmousedown="onHexInteract(${h.id}, event)"
         onmouseenter="onHexEnter(${h.id}, event)">
        <polygon points="${pts}" fill="${meta.color}" stroke="${meta.border}" stroke-width="8" stroke-linejoin="round" />
        <polygon points="${pts}" fill="none" stroke="#e8c987" stroke-width="3" />
        ${getBoardIconSvg(h.type, h.x, h.y - 30, 1.25)}

        ${h.number ? `
          <rect x="${h.x - 24}" y="${h.y - 4}" width="48" height="46" rx="9" fill="#f5efe6" stroke="#c5bba8" stroke-width="2.5" />
          <text x="${h.x}" y="${h.y + 22}" text-anchor="middle" font-size="25" font-weight="900" fill="${isRedNum ? '#d50000' : '#111'}">${h.number}</text>
          <text x="${h.x}" y="${h.y + 36}" text-anchor="middle" font-size="14" font-weight="900" letter-spacing="1" fill="${isRedNum ? '#d50000' : '#333'}">${pipsDots}</text>
        ` : ''}

        ${h.id === robberHexId ? `
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
      html += `
        <line x1="${v1.x}" y1="${v1.y}" x2="${v2.x}" y2="${v2.y}" stroke="#222" stroke-width="14" stroke-linecap="round" />
        <line x1="${v1.x}" y1="${v1.y}" x2="${v2.x}" y2="${v2.y}" stroke="${owner?.color || '#fff'}" stroke-width="9" stroke-linecap="round" />
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

  for (const v of vertices) {
    if (v.building) {
      const owner = state.players.find(p => p.id === v.building.owner);
      const col = owner?.color || '#fff';
      const canUpgrade = isMyTurn && state.phase === 'MAIN' && v.building.owner === socket.id &&
        v.building.type === 'settlement' && me.resources.wheat >= 2 && me.resources.ore >= 3 && me.citiesLeft > 0;

      if (v.building.type === 'settlement') {
        html += `
          <g onclick="${canUpgrade ? `clickVertex(${v.id})` : ''}" style="${canUpgrade ? 'cursor:pointer' : ''}">
            <polygon points="${v.x},${v.y-17} ${v.x+14},${v.y-5} ${v.x+14},${v.y+13} ${v.x-14},${v.y+13} ${v.x-14},${v.y-5}"
              fill="${col}" stroke="${canUpgrade ? '#ffd700' : '#111'}" stroke-width="${canUpgrade ? '4' : '3'}" stroke-linejoin="round" />
          </g>
        `;
      } else {
        html += `
          <g>
            <polygon points="${v.x-18},${v.y+14} ${v.x-18},${v.y-6} ${v.x-6},${v.y-19} ${v.x+6},${v.y-6} ${v.x+18},${v.y-6} ${v.x+18},${v.y+14}"
              fill="${col}" stroke="#111" stroke-width="3" stroke-linejoin="round" />
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

// Re-renders the board from current state (used by camera pan/zoom/reset).
export function rerenderBoard(): void {
  if (!state) return;
  renderBoard(
    state.players.find(p => p.id === socket.id),
    state.players[state.turnIndex]?.id === socket.id
  );
}

export function resetCamera(): void {
  setCamZoom(1);
  setCamPan(0, 0);
  rerenderBoard();
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
