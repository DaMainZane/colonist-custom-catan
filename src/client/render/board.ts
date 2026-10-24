// MODULE: board SVG renderer, camera, board input and board animations | USED BY: render/index.ts, main.ts
// Flat style from "Design UI Philosophy.md": matte tiles with a small gap, pictogram glyph + circle number token,
// pieces with a light rim, quiet highlights (accent color) for anything the player can click.
import { RES_META } from '../constants';
import { getBoardIconSvg, getMiniSvg, getDevSvg, uiIcon, settlementMarkup, cityMarkup, robberMarkup } from '../icons';
import {
  playTone,
  playPlaceRoadSound,
  playPlaceSettlementSound,
  playPlaceCitySound,
  playPlaceRobberSound,
  playStealCardSound,
  playDiscardSound,
  playTradeSound,
  playBuyDevCardSound,
  playAwardSound
} from '../audio';
import { socket } from '../socket';
import {
  state, buildMode, camZoom, camPanX, camPanY, activeBrush, isMouseDown, hasDraggedMap, setBuildModeValue,
  setCamZoom, setCamPan, getClientSpeed
} from '../store';
import { esc } from '../util';

const knownRoads = new Set<number>();
const knownBuildings = new Map<number, string>();
const knownFogHexes = new Set<number>();
let knownRobberHexId: number | null = null;
// Tiles that just produced go dark for a moment, then fade back. Keyed so repaints do not restart it.
const ROLL_DIM_MS = 2000;
let knownRollKey = '';
let rollStart = 0;
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

// Number token: circle with the number (6 and 8 in the "hot" color).
function tokenMarkup(n: number): string {
  const hot = n === 6 || n === 8;
  const ink = hot ? 'var(--token-hot)' : 'var(--token-ink)';
  return `
    <g transform="translate(0,22)">
      <circle r="19" style="fill:var(--token)"/>
      <text class="token-text" y="8" font-size="22" style="fill:${ink}">${n}</text>
    </g>`;
}

// Trading port dock strictly aligned to the coastal hex edge (tangent T along v1->v2, outward normal N).
function portMarkup(e: any, v1: any, v2: any, h: any, owned: boolean, isLobbyHost: boolean): string {
  const mx = (v1.x + v2.x) / 2;
  const my = (v1.y + v2.y) / 2;
  const dx = mx - h.x;
  const dy = my - h.y;
  const nLen = Math.hypot(dx, dy) || 1;
  const nx = dx / nLen;
  const ny = dy / nLen;

  const ex = v2.x - v1.x;
  const ey = v2.y - v1.y;
  const eLen = Math.hypot(ex, ey) || 1;
  const tx = ex / eLen;
  const ty = ey / eLen;

  // Two sturdy wooden piers anchored along the hex edge near v1 and v2, extending perpendicular to the hex face
  const b1x = mx - tx * 28 + nx * 2.5;
  const b1y = my - ty * 28 + ny * 2.5;
  const b2x = mx + tx * 28 + nx * 2.5;
  const b2y = my + ty * 28 + ny * 2.5;

  const t1x = mx - tx * 15 + nx * 35;
  const t1y = my - ty * 15 + ny * 35;
  const t2x = mx + tx * 15 + nx * 35;
  const t2y = my + ty * 15 + ny * 35;

  // Cross-planks parallel to the hex edge
  const planks = [11, 19, 27].map(d => {
    const f = (d - 2.5) / (35 - 2.5);
    const halfW = 28 * (1 - f) + 15 * f;
    const px = mx + nx * d;
    const py = my + ny * d;
    return `<line class="port-plank" x1="${(px - tx * halfW).toFixed(1)}" y1="${(py - ty * halfW).toFixed(1)}" x2="${(px + tx * halfW).toFixed(1)}" y2="${(py + ty * halfW).toFixed(1)}" />`;
  }).join('');

  const sx = mx + nx * 42;
  const sy = my + ny * 42;

  const any = e.port === '3:1';
  const kind: string = any ? 'any' : e.port;
  const badgeFill = any ? 'var(--token)' : (RES_META[kind]?.color || 'var(--token)');
  const badgeBorder = any ? 'var(--pier-dark)' : (RES_META[kind]?.border || 'var(--pier-dark)');
  const label = any
    ? `<text class="port-text" x="${sx.toFixed(1)}" y="${(sy + 4.5).toFixed(1)}" font-size="13">3:1</text>`
    : `${getBoardIconSvg(kind, Number(sx.toFixed(1)), Number((sy - 4.5).toFixed(1)), 0.56)}
       <rect class="port-ratio-pill" x="${(sx - 13).toFixed(1)}" y="${(sy + 5).toFixed(1)}" width="26" height="12" rx="6" />
       <text class="port-text" x="${sx.toFixed(1)}" y="${(sy + 14).toFixed(1)}" font-size="8.8">2:1</text>`;

  const canPaintPort = isLobbyHost && activeBrush.type === 'port';
  return `
    <g data-paintable="${canPaintPort ? '1' : ''}" onclick="${canPaintPort ? `onEdgeInteract(${e.id})` : ''}" style="${canPaintPort ? 'cursor:pointer' : ''}">
      <polygon class="port-dock-apron" points="${b1x.toFixed(1)},${b1y.toFixed(1)} ${b2x.toFixed(1)},${b2y.toFixed(1)} ${t2x.toFixed(1)},${t2y.toFixed(1)} ${t1x.toFixed(1)},${t1y.toFixed(1)}" />
      ${planks}
      <line class="port-pier-rim" x1="${b1x.toFixed(1)}" y1="${b1y.toFixed(1)}" x2="${t1x.toFixed(1)}" y2="${t1y.toFixed(1)}" />
      <line class="port-pier-rim" x1="${b2x.toFixed(1)}" y1="${b2y.toFixed(1)}" x2="${t2x.toFixed(1)}" y2="${t2y.toFixed(1)}" />
      <line class="port-pier" x1="${b1x.toFixed(1)}" y1="${b1y.toFixed(1)}" x2="${t1x.toFixed(1)}" y2="${t1y.toFixed(1)}" />
      <line class="port-pier" x1="${b2x.toFixed(1)}" y1="${b2y.toFixed(1)}" x2="${t2x.toFixed(1)}" y2="${t2y.toFixed(1)}" />
      <circle class="port-post" cx="${b1x.toFixed(1)}" cy="${b1y.toFixed(1)}" r="4.2" />
      <circle class="port-post" cx="${b2x.toFixed(1)}" cy="${b2y.toFixed(1)}" r="4.2" />
      ${owned ? `<circle class="port-ring" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="24" />` : ''}
      <circle class="port-badge-outer" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="21" />
      <circle class="port-badge" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="17.5" style="fill:${badgeFill};stroke:${badgeBorder}" />
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
  if (state.phase !== 'ROLL') {
    const rollKey = `${state.turnCount}|${(state.lastRollHexIds || []).join(',')}|${(state.lastDice || []).join(',')}`;
    if (rollKey !== knownRollKey) { knownRollKey = rollKey; rollStart = now; }
  }
  const rollElapsed = now - rollStart;
  const showRollDim = rollElapsed < ROLL_DIM_MS;
  const rollDimStyle = `animation-delay: -${Math.max(0, Math.round(rollElapsed))}ms;`;
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

  let html = `<defs>
    <pattern id="targetStripes" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="14" height="14" style="fill:var(--accent);fill-opacity:0.16" />
      <rect width="6" height="14" style="fill:var(--accent);fill-opacity:0.5" />
    </pattern>
  </defs>`;

  // Shallow water and sandy border under ALL land tiles (not only outer coastal tiles).
  const allLandPolys = hexes
    .filter((h: any) => h.type !== 'water')
    .map((h: any) => h.corners.map((c: any) => `${c.x},${c.y}`).join(' '));
  allLandPolys.forEach((pts: string) => {
    html += `<polygon points="${pts}" style="fill:var(--sea-shallow);stroke:var(--sea-shallow);stroke-width:46;stroke-linejoin:round" />`;
  });

  // Sandy beach under all land tiles so both the coastline and inner tile gaps show sand.
  allLandPolys.forEach((pts: string) => {
    html += `<polygon points="${pts}" style="fill:var(--sand);stroke:var(--sand);stroke-width:16;stroke-linejoin:round" />`;
  });

  const robberAnim = getPieceAnimAttrs('robber_move', now);
  const canPaintHex = isLobbyHost && (activeBrush.type === 'terrain' || activeBrush.type === 'number' || activeBrush.type === 'robber');

  for (const h of hexes) {
    if (h.type === 'water') {
      if (state.status === 'LOBBY') {
        const pts = h.corners.map((c: any) => `${c.x},${c.y}`).join(' ');
        html += `
          <polygon data-paintable="${canPaintHex ? '1' : ''}" points="${pts}" style="fill:rgba(255,255,255,0.07);stroke:rgba(255,255,255,0.32);stroke-width:2;stroke-dasharray:6 4;cursor:${canPaintHex ? 'pointer' : 'grab'}"
            onmousedown="onHexInteract(${h.id}, event)" onmouseenter="onHexEnter(${h.id}, event)" />
        `;
      }
      continue;
    }

    const tilePoly = insetPoints(h, 5.5);
    const innerPoly = insetPoints(h, 7.5);
    const isFog = !!h.fog || h.type === 'fog';
    const tileType = isFog ? 'fog' : h.type;
    const meta = RES_META[tileType] || RES_META.desert;
    const canClickRobber = isMyTurn && state.phase === 'ROBBER' && h.id !== robberHexId && !isFog;
    const hasNumber = !isFog && !!h.number;
    const isRolledHex = !isFog && rolledHexSet.has(h.id);
    const fogAnim = getPieceAnimAttrs(`fog_${h.id}`, now);
    const glyph = hasNumber ? getBoardIconSvg(tileType, 0, -24, 1.45) : getBoardIconSvg(tileType, 0, 0, 1.9);

    html += `
      <g data-paintable="${canPaintHex ? '1' : ''}"
         style="${canPaintHex || canClickRobber ? 'cursor:pointer' : ''}"
         onmousedown="onHexInteract(${h.id}, event)"
         onclick="onHexClick(${h.id}, event)"
         onmouseenter="onHexEnter(${h.id}, event)">
        <polygon points="${tilePoly}" style="fill:${meta.color};stroke:${meta.border};stroke-width:4;stroke-linejoin:round" />
        <g transform="translate(${h.x}, ${h.y})">
          <g class="${fogAnim.isAnimating ? 'fog-reveal-anim' : ''}" style="${fogAnim.delayStyle}">
            ${glyph}
            ${hasNumber ? tokenMarkup(h.number) : ''}
          </g>
        </g>
        ${isRolledHex && showRollDim ? `<polygon class="hex-rolled" points="${innerPoly}" style="${rollDimStyle}" />` : ''}
        ${canClickRobber ? `<polygon class="hex-target" points="${innerPoly}" style="fill:url(#targetStripes)" />` : ''}

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

  // Ports (aligned with hexagon edge; owned ones are ringed in the accent color).
  for (const e of edges) {
    if (e.hexIds.length !== 1) continue;
    const v1 = vertices[e.v1], v2 = vertices[e.v2];
    if (!v1 || !v2) continue;

    const mx = (v1.x + v2.x) / 2, my = (v1.y + v2.y) / 2;
    const h = hexes[e.hexIds[0]];

    if (e.port) {
      const owned = [v1, v2].some((v: any) => v.building && v.building.owner === socket.id);
      html += portMarkup(e, v1, v2, h, owned, isLobbyHost);
    } else if (isLobbyHost && activeBrush.type === 'port') {
      html += `
        <circle data-paintable="1" cx="${mx}" cy="${my}" r="9" style="fill:rgba(255,255,255,0.5);stroke:var(--accent);stroke-width:2;cursor:pointer"
          onclick="onEdgeInteract(${e.id})" />
      `;
    }
  }

  // Roads: auto-connect adjacent roads of the same player into one continuous rimmed road.
  let roadRimsHtml = '';
  let roadBodiesHtml = '';
  let roadHitsHtml = '';
  let roadSpotsHtml = '';

  for (const e of edges) {
    const v1 = vertices[e.v1], v2 = vertices[e.v2];
    if (!v1 || !v2) continue;
    if (e.road) {
      const ownerId = e.road;
      const owner = state.players.find(p => p.id === ownerId);
      const col = owner?.color || '#888';

      // Extend endpoint to vertex if another road of the same player meets there (and no enemy building blocks it)
      const blocked1 = v1.building && v1.building.owner !== ownerId;
      const blocked2 = v2.building && v2.building.owner !== ownerId;
      const conn1 = !blocked1 && (
        (v1.building && v1.building.owner === ownerId) ||
        v1.edgeIds.some((oe: number) => oe !== e.id && edges[oe]?.road === ownerId)
      );
      const conn2 = !blocked2 && (
        (v2.building && v2.building.owner === ownerId) ||
        v2.edgeIds.some((oe: number) => oe !== e.id && edges[oe]?.road === ownerId)
      );

      const t1 = conn1 ? 0.0 : 0.08;
      const t2 = conn2 ? 1.0 : 0.92;
      const x1 = v1.x + (v2.x - v1.x) * t1;
      const y1 = v1.y + (v2.y - v1.y) * t1;
      const x2 = v1.x + (v2.x - v1.x) * t2;
      const y2 = v1.y + (v2.y - v1.y) * t2;

      const mx = (v1.x + v2.x) / 2;
      const my = (v1.y + v2.y) / 2;
      const anim = getPieceAnimAttrs(`road_${e.id}`, now);

      roadRimsHtml += `
        <g transform="translate(${mx}, ${my})">
          ${anim.isAnimating ? `<circle cx="0" cy="0" r="20" class="piece-impact-ring" style="${anim.delayStyle}" />` : ''}
          <g class="${anim.isAnimating ? 'piece-drop-anim' : ''}" style="${anim.delayStyle}">
            <line x1="${(x1 - mx).toFixed(1)}" y1="${(y1 - my).toFixed(1)}" x2="${(x2 - mx).toFixed(1)}" y2="${(y2 - my).toFixed(1)}"
              style="stroke:var(--piece-rim);stroke-width:12;stroke-linecap:round" />
          </g>
        </g>`;

      roadBodiesHtml += `
        <g transform="translate(${mx}, ${my})">
          <g class="${anim.isAnimating ? 'piece-drop-anim' : ''}" style="${anim.delayStyle}">
            <line x1="${(x1 - mx).toFixed(1)}" y1="${(y1 - my).toFixed(1)}" x2="${(x2 - mx).toFixed(1)}" y2="${(y2 - my).toFixed(1)}"
              style="stroke:${col};stroke-width:8;stroke-linecap:round" />
          </g>
        </g>`;

      roadHitsHtml += `
        <line class="road-hit" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
          onmouseenter="onRoadHover(${e.id}, event)"
          onmousemove="onRoadMove(event)"
          onmouseleave="onRoadLeave()" />`;
    } else if (isMyTurn && canClientPlaceRoad(e, me)) {
      const mx = (v1.x + v2.x) / 2, my = (v1.y + v2.y) / 2;
      roadSpotsHtml += `
        <g onclick="clickEdge(${e.id})" style="cursor:pointer">
          <line class="road-spot-line" x1="${v1.x}" y1="${v1.y}" x2="${v2.x}" y2="${v2.y}" />
          <circle class="road-spot-dot" cx="${mx}" cy="${my}" r="8" />
        </g>
      `;
    }
  }

  html += `<g id="roadRimsLayer">${roadRimsHtml}</g><g id="roadBodiesLayer">${roadBodiesHtml}</g><g id="roadHighlightLayer"></g><g id="roadHitsLayer">${roadHitsHtml}</g>${roadSpotsHtml}`;

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
  }
}

export function onHexClick(hexId: number, ev?: MouseEvent): void {
  if (hasDraggedMap) return;
  if (ev && (ev.button === 2 || ev.button === 1 || ev.altKey)) return;
  if (state.status !== 'LOBBY' && state.phase === 'ROBBER' && state.players[state.turnIndex]?.id === socket.id) {
    socket.emit('clickHex', { code: state.code, hexId });
    playTone(260, 0.12);
  }
}

// Drag-painting: only paints while the mouse button is held in Lobby.
export function onHexEnter(hexId: number, ev?: MouseEvent): void {
  if (isMouseDown && state?.status === 'LOBBY') onHexInteract(hexId, ev);
}

export function onEdgeInteract(edgeId: number): void {
  if (hasDraggedMap) return;
  if (state.status === 'LOBBY' && state.hostId === socket.id && activeBrush.type === 'port') {
    socket.emit('paintPort', { code: state.code, edgeId, portValue: activeBrush.value });
    playTone(520, 0.06);
  }
}

// Computes the connected road network containing `startEdgeId` and its longest continuous simple path (stretch).
function analyzeRoadConnection(startEdgeId: number): {
  ownerName: string;
  ownerColor: string;
  totalRoads: number;
  longestStretch: number;
  longestPathEdges: Set<number>;
  componentEdges: number[];
} | null {
  if (!state?.board) return null;
  const { edges, vertices } = state.board;
  const startEdge = edges[startEdgeId];
  if (!startEdge || !startEdge.road) return null;
  const ownerId = startEdge.road;
  const owner = state.players.find(p => p.id === ownerId);

  // 1. BFS to find all roads in this connected component (respecting enemy buildings on vertices)
  const compSet = new Set<number>([startEdgeId]);
  const queue: number[] = [startEdgeId];
  while (queue.length > 0) {
    const curId = queue.shift()!;
    const cur = edges[curId];
    for (const vId of [cur.v1, cur.v2]) {
      const v = vertices[vId];
      if (!v) continue;
      if (v.building && v.building.owner !== ownerId) continue;
      for (const adjEdgeId of v.edgeIds) {
        if (!compSet.has(adjEdgeId) && edges[adjEdgeId]?.road === ownerId) {
          compSet.add(adjEdgeId);
          queue.push(adjEdgeId);
        }
      }
    }
  }

  // 2. DFS over the connected component to find the longest continuous stretch (simple path of edges)
  let bestPath: number[] = [startEdgeId];
  let bestIncludesHovered = true;
  const used = new Set<number>();
  const currentPath: number[] = [];

  function dfs(vertexId: number, depth: number): void {
    const includesHovered = currentPath.includes(startEdgeId);
    if (
      currentPath.length > bestPath.length ||
      (currentPath.length === bestPath.length && includesHovered && !bestIncludesHovered)
    ) {
      bestPath = [...currentPath];
      bestIncludesHovered = includesHovered;
    }

    const v = vertices[vertexId];
    if (!v) return;
    if (depth > 0 && v.building && v.building.owner !== ownerId) return;

    for (const edgeId of v.edgeIds) {
      if (used.has(edgeId) || !compSet.has(edgeId)) continue;
      const edge = edges[edgeId];
      if (!edge || edge.road !== ownerId) continue;
      used.add(edgeId);
      currentPath.push(edgeId);
      dfs(edge.v1 === vertexId ? edge.v2 : edge.v1, depth + 1);
      currentPath.pop();
      used.delete(edgeId);
    }
  }

  const endpoints = new Set<number>();
  for (const eId of compSet) {
    const e = edges[eId];
    endpoints.add(e.v1);
    endpoints.add(e.v2);
  }
  for (const vId of endpoints) dfs(vId, 0);

  return {
    ownerName: owner?.name || 'Player',
    ownerColor: owner?.color || '#888',
    totalRoads: compSet.size,
    longestStretch: bestPath.length,
    longestPathEdges: new Set(bestPath),
    componentEdges: [...compSet]
  };
}

export function onRoadHover(edgeId: number, ev?: MouseEvent): void {
  const info = analyzeRoadConnection(edgeId);
  const hlLayer = document.getElementById('roadHighlightLayer');
  const tooltip = document.getElementById('roadHoverTooltip');
  if (!info || !hlLayer || !state?.board) return;

  const { edges, vertices } = state.board;
  let hlHtml = '';
  for (const eId of info.componentEdges) {
    const e = edges[eId];
    const v1 = vertices[e.v1], v2 = vertices[e.v2];
    if (!v1 || !v2) continue;
    const isLongest = info.longestPathEdges.has(eId);
    hlHtml += `<line class="${isLongest ? 'road-stretch-glow' : 'road-network-glow'}" x1="${v1.x}" y1="${v1.y}" x2="${v2.x}" y2="${v2.y}" />`;
  }
  hlLayer.innerHTML = hlHtml;

  if (tooltip) {
    tooltip.innerHTML = `
      <div class="rht-head"><span class="rht-dot" style="background:${info.ownerColor}"></span><span>${esc(info.ownerName)}</span></div>
      <div class="rht-stats">Longest stretch: <strong>${info.longestStretch}</strong> · Connected: <strong>${info.totalRoads}</strong> ${info.totalRoads === 1 ? 'road' : 'roads'}</div>
    `;
    tooltip.style.display = 'flex';
    if (ev) onRoadMove(ev);
  }
}

export function onRoadMove(ev: MouseEvent): void {
  const tooltip = document.getElementById('roadHoverTooltip');
  if (!tooltip || tooltip.style.display === 'none') return;
  const x = Math.min(window.innerWidth - 240, ev.clientX + 14);
  const y = Math.max(12, ev.clientY - 48);
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

export function onRoadLeave(): void {
  const hlLayer = document.getElementById('roadHighlightLayer');
  const tooltip = document.getElementById('roadHoverTooltip');
  if (hlLayer) hlLayer.innerHTML = '';
  if (tooltip) tooltip.style.display = 'none';
}

export function triggerAwardAnimation(
  award: 'longestRoad' | 'largestArmy',
  newOwner: any,
  prevOwner: any
): void {
  if (!newOwner) return;
  const isStolen = !!prevOwner && prevOwner.id !== newOwner.id;
  playAwardSound(isStolen);

  const isRoad = award === 'longestRoad';
  const title = isRoad ? 'Longest Road' : 'Largest Army';
  const kicker = isStolen ? `${title} Stolen!` : `${title} Claimed!`;
  const sub = isStolen
    ? `Taken from ${esc(prevOwner.name)} · ${isRoad ? `${newOwner.longestRoad ?? 5}+ roads` : `${newOwner.army ?? 3}+ knights`}`
    : `${isRoad ? `${newOwner.longestRoad ?? 5} connected roads` : `${newOwner.army ?? 3} knights played`}`;

  const banner = document.createElement('div');
  banner.className = `award-epic-banner ${isStolen ? 'stolen' : ''}`;
  banner.innerHTML = `
    <div class="award-rays"></div>
    <div class="award-badge-icon">${uiIcon(isRoad ? 'road' : 'sword', 24)}</div>
    <div class="award-info">
      <div class="award-kicker">${kicker}</div>
      <div class="award-headline" style="color:${newOwner.color || 'var(--ink)'}">${esc(newOwner.name)}</div>
      <div class="award-sub">${sub}</div>
    </div>
    <div class="award-vp-pill">+2 VP</div>
  `;
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 2450);
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
        cardEl.style.transition = `left ${flightMs}ms cubic-bezier(0.22, 1, 0.36, 1), top ${flightMs}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${flightMs}ms ease, opacity 90ms ease-out`;
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

        // Land, then vanish at once (short fade, no lingering).
        setTimeout(() => {
          cardEl.style.opacity = '0';
          setTimeout(() => cardEl.remove(), 100);
        }, flightMs);
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
        cardEl.style.transition = `left ${flightMs}ms cubic-bezier(0.22, 1, 0.36, 1), top ${flightMs}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${flightMs}ms ease, opacity 90ms ease-out`;
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
          setTimeout(() => cardEl.remove(), 100);
        }, flightMs);
      }, d);
    }
  });
}
