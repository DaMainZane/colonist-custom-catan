// MODULE: board SVG renderer, camera, board input and board animations | USED BY: render/index.ts, main.ts
// Flat style from "Design UI Philosophy.md": matte tiles with a small gap, pictogram glyph + circle number token,
// pieces with a light rim, quiet highlights (accent color) for anything the player can click.
import { RES_META } from '../constants';
import { getBoardIconSvg, getMiniSvg, getDevSvg, settlementMarkup, cityMarkup, robberMarkup } from '../icons';
import {
  playTone,
  playPlaceRoadSound,
  playPlaceSettlementSound,
  playPlaceCitySound,
  playPlaceRobberSound,
  playStealCardSound,
  playDiscardSound,
  playTradeSound,
  playBuyDevCardSound
} from '../audio';
import { socket } from '../socket';
import {
  state, buildMode, camZoom, camPanX, camPanY, activeBrush, isMouseDown, setBuildModeValue,
  setCamZoom, setCamPan, getClientSpeed
} from '../store';

const knownRoads = new Set<number>();
const knownBuildings = new Map<number, string>();
const knownFogHexes = new Set<number>();
let knownRobberHexId: number | null = null;
const pieceAnimTimestamps = new Map<string, number>();
const ANIM_DURATION_MS = 420;

// Robber sits beside the number token. Shared by the board and the move animation.
const ROBBER_DX = 30;
const ROBBER_DY = -8;

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

// Hex corners pulled toward the center so neighbouring tiles leave a thin gap of sea between them.
function insetPoints(h: any, inset: number): string {
  return h.corners.map((c: any) => {
    const dx = c.x - h.x, dy = c.y - h.y;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.max(0, (len - inset) / len);
    return `${(h.x + dx * k).toFixed(1)},${(h.y + dy * k).toFixed(1)}`;
  }).join(' ');
}

// Number token: circle with the number and probability dots (6 and 8 in the "hot" color).
function tokenMarkup(n: number): string {
  const hot = n === 6 || n === 8;
  const pips = Math.max(0, 6 - Math.abs(7 - n));
  const ink = hot ? 'var(--token-hot)' : 'var(--token-ink)';
  const dots = Array.from({ length: pips }, (_, i) =>
    `<circle cx="${((i - (pips - 1) / 2) * 5).toFixed(1)}" cy="12" r="1.5"/>`
  ).join('');
  return `
    <g transform="translate(0,22)">
      <circle r="19" style="fill:var(--token)"/>
      <text class="token-text" y="4" font-size="21" style="fill:${ink}">${n}</text>
      <g style="fill:${ink}">${dots}</g>
    </g>`;
}

function portMarkup(e: any, v1: any, v2: any, sx: number, sy: number, owned: boolean, isLobbyHost: boolean): string {
  const any = e.port === '3:1';
  const kind: string = any ? 'any' : e.port;
  const badgeFill = any ? 'var(--surface-3)' : (RES_META[kind]?.color || 'var(--surface-3)');
  const label = any
    ? `<text class="port-text" x="${sx}" y="${sy + 4.5}" font-size="12.5">3:1</text>`
    : `${getBoardIconSvg(kind, sx, sy - 4, 0.52)}<text class="port-text" x="${sx}" y="${sy + 11}" font-size="9">2:1</text>`;
  return `
    <g onclick="${isLobbyHost ? `onEdgeInteract(${e.id})` : ''}" style="${isLobbyHost ? 'cursor:pointer' : ''}">
      <line class="port-pier" x1="${v1.x}" y1="${v1.y}" x2="${sx}" y2="${sy}" />
      <line class="port-pier" x1="${v2.x}" y1="${v2.y}" x2="${sx}" y2="${sy}" />
      ${owned ? `<circle class="port-ring" cx="${sx}" cy="${sy}" r="21" />` : ''}
      <circle class="port-badge" cx="${sx}" cy="${sy}" r="17" style="fill:${badgeFill}" />
      ${label}
    </g>`;
}

export function renderBoard(me: any, isMyTurn: boolean): void {
  if (!state || !state.board) return;
  const svg = document.getElementById('boardSvg')!;
  const { hexes, vertices, edges, robberHexId } = state.board;
  const isLobbyHost = state.status === 'LOBBY' && state.hostId === socket.id;
  const rolledHexSet = new Set<number>(state.lastRollHexIds || []);

  if (state.status === 'LOBBY') {
    knownRoads.clear();
    knownBuildings.clear();
    knownFogHexes.clear();
    pieceAnimTimestamps.clear();
    knownRobberHexId = robberHexId;
    for (const h of hexes) {
      if (h.fog || h.type === 'fog') knownFogHexes.add(h.id);
    }
  }

  const now = performance.now();
  let playedRoadSfx = false;
  let playedSettleSfx = false;
  let playedCitySfx = false;

  if (state.status !== 'LOBBY') {
    if (knownRobberHexId !== null && knownRobberHexId !== robberHexId) {
      const prevHexId = knownRobberHexId;
      knownRobberHexId = robberHexId;
      pieceAnimTimestamps.set('robber_move', now);
      playPlaceRobberSound();
      setTimeout(() => triggerRobberMoveAnimation(prevHexId, robberHexId), 0);
    } else if (knownRobberHexId === null) {
      knownRobberHexId = robberHexId;
    }
  }

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
      if (state.status !== 'LOBBY' && !playedRoadSfx) {
        playedRoadSfx = true;
        playPlaceRoadSound();
      }
    }
  }
  for (const v of vertices) {
    if (v.building) {
      const prev = knownBuildings.get(v.id);
      if (prev !== v.building.type) {
        knownBuildings.set(v.id, v.building.type);
        pieceAnimTimestamps.set(`${v.building.type}_${v.id}`, now);
        if (state.status !== 'LOBBY') {
          if (v.building.type === 'city' && !playedCitySfx) {
            playedCitySfx = true;
            playPlaceCitySound();
          } else if (v.building.type === 'settlement' && !playedSettleSfx) {
            playedSettleSfx = true;
            playPlaceSettlementSound();
          }
        }
      }
    }
  }

  updateCameraViewBox();

  let html = '';

  // Shallow water around the land (one soft layer, no outlines).
  const coastalHexIds = new Set<number>();
  for (const e of edges) {
    if (e.hexIds.length === 1) coastalHexIds.add(e.hexIds[0]);
  }
  const landPolys = hexes
    .filter((h: any) => h.type !== 'water' && coastalHexIds.has(h.id))
    .map((h: any) => h.corners.map((c: any) => `${c.x},${c.y}`).join(' '));
  landPolys.forEach((pts: string) => {
    html += `<polygon points="${pts}" style="fill:var(--sea-shallow);stroke:var(--sea-shallow);stroke-width:46;stroke-linejoin:round" />`;
  });

  const robberAnim = getPieceAnimAttrs('robber_move', now);

  for (const h of hexes) {
    if (h.type === 'water') {
      if (state.status === 'LOBBY') {
        const pts = h.corners.map((c: any) => `${c.x},${c.y}`).join(' ');
        html += `
          <polygon points="${pts}" style="fill:rgba(255,255,255,0.07);stroke:rgba(255,255,255,0.32);stroke-width:2;stroke-dasharray:6 4;cursor:pointer"
            onmousedown="onHexInteract(${h.id}, event)" onmouseenter="onHexEnter(${h.id}, event)" />
        `;
      }
      continue;
    }

    const inset = insetPoints(h, 6);
    const isFog = !!h.fog || h.type === 'fog';
    const tileType = isFog ? 'fog' : h.type;
    const meta = RES_META[tileType] || RES_META.desert;
    const canClickRobber = isMyTurn && state.phase === 'ROBBER' && h.id !== robberHexId && !isFog;
    const hasNumber = !isFog && !!h.number;
    const isRolledHex = !isFog && rolledHexSet.has(h.id);
    const fogAnim = getPieceAnimAttrs(`fog_${h.id}`, now);
    const glyph = hasNumber ? getBoardIconSvg(tileType, 0, -24, 1.45) : getBoardIconSvg(tileType, 0, 0, 1.9);

    html += `
      <g style="${isLobbyHost || canClickRobber ? 'cursor:pointer' : ''}"
         onmousedown="onHexInteract(${h.id}, event)"
         onmouseenter="onHexEnter(${h.id}, event)">
        <polygon points="${inset}" style="fill:${meta.color};stroke:${meta.color};stroke-width:6;stroke-linejoin:round" />
        <g transform="translate(${h.x}, ${h.y})">
          <g class="${fogAnim.isAnimating ? 'fog-reveal-anim' : ''}" style="${fogAnim.delayStyle}">
            ${glyph}
            ${hasNumber ? tokenMarkup(h.number) : ''}
          </g>
        </g>
        ${isRolledHex ? `<polygon class="hex-rolled" points="${inset}" />` : ''}
        ${canClickRobber ? `<polygon class="hex-target" points="${inset}" />` : ''}

        ${h.id === robberHexId && !isFog ? `
          <g transform="translate(${h.x + ROBBER_DX}, ${h.y + ROBBER_DY})">
            ${robberAnim.isAnimating ? `<circle cx="0" cy="0" r="24" class="robber-impact-ring" style="${robberAnim.delayStyle}" />` : ''}
            <g class="${robberAnim.isAnimating ? 'robber-drop-anim' : ''}" style="${robberAnim.delayStyle}">
              <g transform="scale(0.85)">${robberMarkup()}</g>
            </g>
          </g>
        ` : ''}
      </g>
    `;
  }

  // Ports (the ones you own are ringed in the accent color).
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
      const owned = [v1, v2].some((v: any) => v.building && v.building.owner === socket.id);
      html += portMarkup(e, v1, v2, sx, sy, owned, isLobbyHost);
    } else if (isLobbyHost && activeBrush.type === 'port') {
      html += `
        <circle cx="${mx}" cy="${my}" r="9" style="fill:rgba(255,255,255,0.5);stroke:var(--accent);stroke-width:2;cursor:pointer"
          onclick="onEdgeInteract(${e.id})" />
      `;
    }
  }

  // Roads and road spots
  for (const e of edges) {
    const v1 = vertices[e.v1], v2 = vertices[e.v2];
    if (!v1 || !v2) continue;
    if (e.road) {
      const owner = state.players.find(p => p.id === e.road);
      const mx = (v1.x + v2.x) / 2;
      const my = (v1.y + v2.y) / 2;
      const hx = ((v2.x - v1.x) / 2) * 0.84;
      const hy = ((v2.y - v1.y) / 2) * 0.84;
      const anim = getPieceAnimAttrs(`road_${e.id}`, now);
      html += `
        <g transform="translate(${mx}, ${my})">
          ${anim.isAnimating ? `<circle cx="0" cy="0" r="20" class="piece-impact-ring" style="${anim.delayStyle}" />` : ''}
          <g class="${anim.isAnimating ? 'piece-drop-anim' : ''}" style="${anim.delayStyle}">
            <line x1="${-hx}" y1="${-hy}" x2="${hx}" y2="${hy}" style="stroke:var(--piece-rim);stroke-width:11;stroke-linecap:round" />
            <line x1="${-hx}" y1="${-hy}" x2="${hx}" y2="${hy}" style="stroke:${owner?.color || '#888'};stroke-width:8;stroke-linecap:round" />
          </g>
        </g>
      `;
    } else if (isMyTurn && canClientPlaceRoad(e, me)) {
      const mx = (v1.x + v2.x) / 2, my = (v1.y + v2.y) / 2;
      html += `
        <g onclick="clickEdge(${e.id})" style="cursor:pointer">
          <line class="road-spot-line" x1="${v1.x}" y1="${v1.y}" x2="${v2.x}" y2="${v2.y}" />
          <circle class="road-spot-dot" cx="${mx}" cy="${my}" r="8" />
        </g>
      `;
    }
  }

  // Settlements, cities and settlement spots
  const robberVictimSet = new Set<string>(state.robberVictims || []);
  for (const v of vertices) {
    if (v.building) {
      const owner = state.players.find(p => p.id === v.building.owner);
      const col = owner?.color || '#888';
      const canUpgrade = isMyTurn && state.phase === 'MAIN' && v.building.owner === socket.id &&
        v.building.type === 'settlement' && me.resources.wheat >= 2 && me.resources.ore >= 3 && me.citiesLeft > 0;
      const canRobThisBuilding = isMyTurn && state.phase === 'ROBBER_STEAL' &&
        v.hexIds.includes(robberHexId) && robberVictimSet.has(v.building.owner);
      const isClickable = canUpgrade || canRobThisBuilding;
      const isCity = v.building.type === 'city';
      const clickAttr = (isCity ? canRobThisBuilding : isClickable) ? `clickVertex(${v.id})` : '';
      const ringR = isCity ? 27 : 22;
      const anim = getPieceAnimAttrs(`${isCity ? 'city' : 'settlement'}_${v.id}`, now);

      html += `
        <g transform="translate(${v.x}, ${v.y})" onclick="${clickAttr}" style="${clickAttr ? 'cursor:pointer' : ''}">
          ${anim.isAnimating ? `<circle cx="0" cy="0" r="${ringR + 4}" class="piece-impact-ring" style="${anim.delayStyle}" />` : ''}
          ${clickAttr ? `<circle r="${ringR + 2}" fill="transparent" />` : ''}
          ${canRobThisBuilding ? `<circle r="${ringR}" class="target-ring rob" />` : ''}
          ${!isCity && canUpgrade && !canRobThisBuilding ? `<circle r="${ringR}" class="target-ring upgrade" />` : ''}
          <g class="${anim.isAnimating ? 'piece-drop-anim' : ''}" style="${anim.delayStyle}">
            ${isCity ? cityMarkup(col) : settlementMarkup(col)}
          </g>
        </g>
      `;
    } else if (isMyTurn && canClientPlaceSettlement(v, me)) {
      html += `
        <g onclick="clickVertex(${v.id})" style="cursor:pointer">
          <circle cx="${v.x}" cy="${v.y}" r="20" fill="transparent" />
          <circle cx="${v.x}" cy="${v.y}" r="11" class="spot-pulse" />
        </g>
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
  setBuildModeValue(null);
  socket.emit('clickVertex', { code: state.code, vertexId });
}

export function clickEdge(edgeId: number): void {
  setBuildModeValue(null);
  socket.emit('clickEdge', { code: state.code, edgeId });
}

export function triggerRobberMoveAnimation(fromHexId: number, toHexId: number): void {
  const svg = document.getElementById('boardSvg') as unknown as SVGSVGElement | null;
  if (!svg || !state?.board) return;
  const fromHex = state.board.hexes[fromHexId];
  const toHex = state.board.hexes[toHexId];
  if (!fromHex || !toHex) return;
  const ctm = svg.getScreenCTM();
  if (!ctm) return;

  const speed = getClientSpeed();
  const flightMs = Math.max(140, Math.round(460 / Math.sqrt(speed)));

  const ptFrom = svg.createSVGPoint();
  ptFrom.x = fromHex.x + ROBBER_DX;
  ptFrom.y = fromHex.y + ROBBER_DY;
  const screenFrom = ptFrom.matrixTransform(ctm);

  const ptTo = svg.createSVGPoint();
  ptTo.x = toHex.x + ROBBER_DX;
  ptTo.y = toHex.y + ROBBER_DY;
  const screenTo = ptTo.matrixTransform(ctm);

  const robberEl = document.createElement('div');
  robberEl.className = 'flying-robber-piece';
  robberEl.style.transition = `left ${flightMs}ms cubic-bezier(0.22, 1, 0.36, 1), top ${flightMs}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${flightMs}ms ease, opacity ${flightMs}ms ease`;
  robberEl.innerHTML = `<svg width="40" height="50" viewBox="-16 -24 32 40">${robberMarkup()}</svg>`;
  robberEl.style.left = `${screenFrom.x - 20}px`;
  robberEl.style.top = `${screenFrom.y - 25}px`;
  robberEl.style.transform = 'scale(1.2) translateY(-14px)';
  document.body.appendChild(robberEl);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      robberEl.style.left = `${screenTo.x - 20}px`;
      robberEl.style.top = `${screenTo.y - 25}px`;
      robberEl.style.transform = 'scale(1) translateY(0px)';
    });
  });

  setTimeout(() => {
    robberEl.style.opacity = '0';
    setTimeout(() => robberEl.remove(), 180);
  }, flightMs);
}

function getTransferTargetEl(actorId: string, resource: string, kind: string): HTMLElement | null {
  if (actorId === socket.id) {
    return document.getElementById('myHandPanel');
  }
  if (actorId === 'bank') {
    if (resource === 'dev' || kind === 'buyDev') {
      return document.getElementById('bankDevDeckItem') || document.getElementById('bankBar');
    }
    return document.getElementById(`bankRes_${resource}`) || document.getElementById('bankBar');
  }
  return document.getElementById(`playerRow_${actorId}`);
}

export function triggerCardTransferAnimations(transfers: any[]): void {
  if (!transfers || transfers.length === 0) return;

  const speed = getClientSpeed();
  const flightMs = Math.max(200, Math.round(720 / Math.sqrt(speed)));
  const stepDelay = Math.max(25, Math.round(85 / speed));

  const hasSteal = transfers.some(t => t.kind === 'steal' || t.kind === 'monopoly');
  const iWasRobbed = transfers.some(t => (t.kind === 'steal' || t.kind === 'monopoly') && t.from === socket.id);
  const hasTrade = transfers.some(t => t.kind === 'playerTrade' || t.kind === 'bankTrade');
  const hasBuyDev = transfers.some(t => t.kind === 'buyDev');
  const hasDiscard = transfers.some(t => t.kind === 'discard');

  if (hasSteal) playStealCardSound(iWasRobbed);
  else if (hasBuyDev) playBuyDevCardSound();
  else if (hasTrade) playTradeSound();
  else if (hasDiscard) playDiscardSound();

  if (iWasRobbed) {
    const handEl = document.getElementById('myHandPanel');
    if (handEl) {
      handEl.classList.remove('hand-stolen-shake');
      void handEl.offsetWidth;
      handEl.classList.add('hand-stolen-shake');
      setTimeout(() => handEl.classList.remove('hand-stolen-shake'), 650);

      const stolenItems = transfers.filter(t => (t.kind === 'steal' || t.kind === 'monopoly') && t.from === socket.id);
      const rect = handEl.getBoundingClientRect();
      stolenItems.forEach((st, idx) => {
        const badge = document.createElement('div');
        badge.className = 'stolen-toast-badge';
        const resName = RES_META[st.resource]?.name || String(st.resource).toUpperCase();
        badge.textContent = `-${st.amount} ${resName} stolen`;
        badge.style.left = `${rect.left + 24 + idx * 120}px`;
        badge.style.top = `${rect.top - 16}px`;
        document.body.appendChild(badge);
        setTimeout(() => badge.remove(), 1200);
      });
    }
  }

  let delay = 0;
  transfers.forEach((tr, groupIdx) => {
    const fromEl = getTransferTargetEl(tr.from, tr.resource, tr.kind);
    const toEl = getTransferTargetEl(tr.to, tr.resource, tr.kind);
    if (!fromEl || !toEl) return;

    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();

    const startX = fromRect.left + fromRect.width / 2 - 24;
    const startY = fromRect.top + fromRect.height / 2 - 33;
    const endX = toRect.left + toRect.width / 2 - 24;
    const endY = toRect.top + toRect.height / 2 - 33;

    // Slight vertical offset so simultaneous bidirectional trade cards don't overlap identically
    const curveOffset = (groupIdx % 2 === 0 ? -1 : 1) * 14;
    const count = Math.min(tr.amount || 1, 4);

    // If bankTrade or buyDev receiving from bank, add a slight beat after the payment cards fly in
    const baseGroupDelay = (tr.from === 'bank' && (tr.kind === 'bankTrade' || tr.kind === 'buyDev'))
      ? Math.max(45, Math.round(170 / speed))
      : 0;

    for (let i = 0; i < count; i++) {
      const d = delay + baseGroupDelay;
      delay += stepDelay;
      setTimeout(() => {
        const cardEl = document.createElement('div');
        const isSteal = tr.kind === 'steal' || tr.kind === 'monopoly';
        let cardClass = `card-${tr.resource}`;
        let innerHtml = '';

        if (tr.resource === 'dev') {
          cardClass = 'card-dev';
          innerHtml = getDevSvg('back');
        } else if (tr.resource === 'mystery') {
          cardClass = 'card-mystery';
          innerHtml = `<span>?</span>`;
        } else {
          innerHtml = getMiniSvg(tr.resource);
        }

        cardEl.className = `flying-res-card ${cardClass} ${isSteal ? 'stolen-card-flight' : ''}`;
        cardEl.style.transition = `left ${flightMs}ms cubic-bezier(0.22, 1, 0.36, 1), top ${flightMs}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${flightMs}ms ease, opacity ${flightMs}ms ease`;
        cardEl.innerHTML = innerHtml;
        cardEl.style.left = `${startX + i * 7}px`;
        cardEl.style.top = `${startY - i * 5 + curveOffset}px`;
        cardEl.style.transform = isSteal ? 'scale(1.1) rotate(-5deg)' : 'scale(0.9)';
        document.body.appendChild(cardEl);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            cardEl.style.left = `${endX + i * 5}px`;
            cardEl.style.top = `${endY - i * 4}px`;
            cardEl.style.transform = 'scale(1) rotate(0deg)';
          });
        });

        setTimeout(() => {
          cardEl.style.opacity = '0';
          setTimeout(() => cardEl.remove(), 200);
        }, Math.max(180, flightMs - 40));
      }, d);
    }
  });
}

export function triggerFlyingResourceAnimations(productions: any[]): void {
  const svg = document.getElementById('boardSvg') as unknown as SVGSVGElement | null;
  if (!svg || !state?.board) return;
  const ctm = svg.getScreenCTM();
  if (!ctm) return;

  const speed = getClientSpeed();
  const flightMs = Math.max(200, Math.round(720 / Math.sqrt(speed)));
  const stepDelay = Math.max(30, Math.round(110 / speed));

  let delay = 0;
  productions.forEach(prod => {
    const hex = state.board.hexes[prod.hexId];
    if (!hex) return;

    const pt = svg.createSVGPoint();
    pt.x = hex.x;
    pt.y = hex.y;
    const screenPt = pt.matrixTransform(ctm);

    let targetEl: HTMLElement | null = null;
    if (prod.playerId === socket.id) {
      targetEl = document.getElementById('myHandPanel');
    } else {
      targetEl = document.getElementById(`playerRow_${prod.playerId}`);
    }
    if (!targetEl) return;
    const rect = targetEl.getBoundingClientRect();
    const targetX = rect.left + rect.width / 2 - 24;
    const targetY = rect.top + rect.height / 2 - 33;

    const cardsToFly = Math.min(prod.amount || 1, 3);
    for (let i = 0; i < cardsToFly; i++) {
      const d = delay;
      delay += stepDelay;
      setTimeout(() => {
        const cardEl = document.createElement('div');
        cardEl.className = `flying-res-card card-${prod.resource}`;
        cardEl.style.transition = `left ${flightMs}ms cubic-bezier(0.22, 1, 0.36, 1), top ${flightMs}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${flightMs}ms ease, opacity ${flightMs}ms ease`;
        cardEl.innerHTML = getMiniSvg(prod.resource);
        cardEl.style.left = `${screenPt.x - 24 + (i * 8)}px`;
        cardEl.style.top = `${screenPt.y - 33 - (i * 6)}px`;
        cardEl.style.transform = 'scale(0.85)';
        document.body.appendChild(cardEl);

        playTone(540 + i * 60, 0.06);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            cardEl.style.left = `${targetX}px`;
            cardEl.style.top = `${targetY}px`;
            cardEl.style.transform = 'scale(1)';
          });
        });

        setTimeout(() => {
          cardEl.style.opacity = '0';
          setTimeout(() => cardEl.remove(), 200);
        }, Math.max(180, flightMs - 40));
      }, d);
    }
  });
}
