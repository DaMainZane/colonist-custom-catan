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
  state, camZoom, camPanX, camPanY, activeBrush, isMouseDown, hasDraggedMap,
  setBuildModeValue, setCamZoom, setCamPan, getClientSpeed,
  addInFlightResource, releaseInFlightResource, addInFlightDev, releaseInFlightDev
} from '../store';
import { renderHand } from './hand';
import { overlayPatternDefsMarkup, renderHexOverlaysMarkup } from './overlay';
import { renderSidebar, visibleRect } from './sidebar';
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

// Base size of settlements, cities, and roads at default zoom. The zoom-out boost and its cap scale with it.
const BUILDING_BASE_SCALE = 1.5;
const ROAD_BASE_SCALE = 1.15;

let cachedBoundsKey = '';
let cachedBounds = { centerX0: 0, centerY0: 0, contentW: 1000, contentH: 900 };
let lastBuildingScale = -1;
let lastRoadScale = -1;
let cameraRafPending = false;

// Layer dirty-keys so gameplay updates (rolls, trades, builds, selections) do not rebuild static hex terrain or ports.
let lastTerrainKey = '';
let lastPortsKey = '';
let lastPlacedRoadsKey = '';

interface HexGeomCache {
  rawPts: string;
  pathSub: string;
  tilePoly: string;
  innerPoly: string;
}
let cachedGeomBoardKey = '';
let hexGeomCache = new Map<number, HexGeomCache>();

interface RoadConnInfo {
  ownerName: string;
  ownerColor: string;
  totalRoads: number;
  longestStretch: number;
  longestPathEdges: Set<number>;
  componentEdges: number[];
}
const roadAnalysisCache = new Map<number, RoadConnInfo>();

export function getBoardBounds(): { centerX0: number; centerY0: number; contentW: number; contentH: number } {
  if (!state || !state.board || !state.board.hexes || state.board.hexes.length === 0) {
    return { centerX0: 0, centerY0: 0, contentW: 1000, contentH: 900 };
  }
  const firstHex = state.board.hexes[0];
  const lastHex = state.board.hexes[state.board.hexes.length - 1];
  const key = `${state.code}_${state.status}_${state.board.hexes.length}_${firstHex?.x ?? 0}_${lastHex?.x ?? 0}`;
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
  svg.setAttribute('viewBox', `${baseX.toFixed(1)} ${baseY.toFixed(1)} ${baseW.toFixed(1)} ${baseH.toFixed(1)}`);

  // Scale settlements, cities, and roads up as the camera zooms out (or on larger boards), only touching style when scale changes.
  const zoomFactor = Math.max(camZoom, Math.max(baseW, baseH) / 720);
  const buildingScale = Math.min(2.8, BUILDING_BASE_SCALE * Math.pow(Math.max(1, zoomFactor), 0.62));
  const roadScale = Math.min(2.45, ROAD_BASE_SCALE * Math.pow(Math.max(1, zoomFactor), 0.58));
  if (Math.abs(buildingScale - lastBuildingScale) >= 0.015) {
    lastBuildingScale = buildingScale;
    svg.style.setProperty('--building-scale', buildingScale.toFixed(3));
    const vLayer = document.getElementById('boardVerticesLayer');
    if (vLayer) vLayer.style.setProperty('--building-scale', buildingScale.toFixed(3));
  }
  if (Math.abs(roadScale - lastRoadScale) >= 0.015) {
    lastRoadScale = roadScale;
    svg.style.setProperty('--road-scale', roadScale.toFixed(3));
  }
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

function ensureHexGeomCache(hexes: any[]): void {
  const first = hexes[0];
  const last = hexes[hexes.length - 1];
  const geomKey = `${state?.code || ''}_${hexes.length}_${first?.x ?? 0}_${first?.y ?? 0}_${last?.x ?? 0}_${last?.y ?? 0}`;
  if (geomKey === cachedGeomBoardKey && hexGeomCache.size === hexes.length) return;
  cachedGeomBoardKey = geomKey;
  hexGeomCache = new Map();
  for (const h of hexes) {
    const rawPts = h.corners.map((c: any) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const pathSub = h.corners
      .map((c: any, idx: number) => `${idx === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join('') + 'Z';
    hexGeomCache.set(h.id, {
      rawPts,
      pathSub,
      tilePoly: insetPoints(h, 5.5),
      innerPoly: insetPoints(h, 7.5)
    });
  }
}

function ensureBoardLayers(svg: HTMLElement): {
  terrainLayer: HTMLElement;
  overlayLayer: HTMLElement;
  portsLayer: HTMLElement;
  hexDynamicLayer: HTMLElement;
  roadRimsLayer: HTMLElement;
  roadBodiesLayer: HTMLElement;
  roadHitsLayer: HTMLElement;
  roadSpotsLayer: HTMLElement;
  verticesLayer: HTMLElement;
} {
  let terrainLayer = document.getElementById('boardTerrainLayer');
  if (!terrainLayer || terrainLayer.parentElement !== svg) {
    svg.innerHTML = `
      ${overlayPatternDefsMarkup()}
      <g id="boardTerrainLayer"></g>
      <g id="boardOverlayLayer"></g>
      <g id="boardHexDynamicLayer"></g>
      <g id="boardPortsLayer"></g>
      <g id="roadHighlightLayer"></g>
      <g id="roadRimsLayer"></g>
      <g id="roadBodiesLayer"></g>
      <g id="roadHitsLayer"></g>
      <g id="roadSpotsLayer"></g>
      <g id="boardVerticesLayer"></g>
    `;
    lastTerrainKey = '';
    lastPortsKey = '';
    lastPlacedRoadsKey = '';
    lastBuildingScale = -1;
    lastRoadScale = -1;
    terrainLayer = document.getElementById('boardTerrainLayer')!;
  }
  return {
    terrainLayer,
    overlayLayer: document.getElementById('boardOverlayLayer')!,
    portsLayer: document.getElementById('boardPortsLayer')!,
    hexDynamicLayer: document.getElementById('boardHexDynamicLayer')!,
    roadRimsLayer: document.getElementById('roadRimsLayer')!,
    roadBodiesLayer: document.getElementById('roadBodiesLayer')!,
    roadHitsLayer: document.getElementById('roadHitsLayer')!,
    roadSpotsLayer: document.getElementById('roadSpotsLayer')!,
    verticesLayer: document.getElementById('boardVerticesLayer')!
  };
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

  // Two sturdy planked piers that run the full length of the coastal hex side (anchored near its two corners)
  // and reach straight out along the outward normal. Narrower at the tip, like a landing.
  const D0 = -4.5;                       // the drawn tile edge sits just inside the geometric edge
  const D1 = 35;                         // pier tip
  const hw0 = Math.max(14, eLen / 2 - 7);
  const hw1 = hw0 * 0.55;
  const b1x = mx - tx * hw0 + nx * D0;
  const b1y = my - ty * hw0 + ny * D0;
  const b2x = mx + tx * hw0 + nx * D0;
  const b2y = my + ty * hw0 + ny * D0;

  const t1x = mx - tx * hw1 + nx * D1;
  const t1y = my - ty * hw1 + ny * D1;
  const t2x = mx + tx * hw1 + nx * D1;
  const t2y = my + ty * hw1 + ny * D1;

  // Cross-planks parallel to the hex edge
  const planks = [7, 16, 25].map(d => {
    const f = (d - D0) / (D1 - D0);
    const halfW = hw0 * (1 - f) + hw1 * f;
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
      <line class="port-pier-rim" x1="${b1x.toFixed(1)}" y1="${b1y.toFixed(1)}" x2="${t1x.toFixed(1)}" y2="${t1y.toFixed(1)}" style="stroke-width:11;stroke-linecap:round" />
      <line class="port-pier-rim" x1="${b2x.toFixed(1)}" y1="${b2y.toFixed(1)}" x2="${t2x.toFixed(1)}" y2="${t2y.toFixed(1)}" style="stroke-width:11;stroke-linecap:round" />
      <line class="port-pier" x1="${b1x.toFixed(1)}" y1="${b1y.toFixed(1)}" x2="${t1x.toFixed(1)}" y2="${t1y.toFixed(1)}" style="stroke-width:6.5;stroke-linecap:round" />
      <line class="port-pier" x1="${b2x.toFixed(1)}" y1="${b2y.toFixed(1)}" x2="${t2x.toFixed(1)}" y2="${t2y.toFixed(1)}" style="stroke-width:6.5;stroke-linecap:round" />
      <circle class="port-post" cx="${b1x.toFixed(1)}" cy="${b1y.toFixed(1)}" r="5.2" />
      <circle class="port-post" cx="${b2x.toFixed(1)}" cy="${b2y.toFixed(1)}" r="5.2" />
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

  ensureHexGeomCache(hexes);
  const layers = ensureBoardLayers(svg);

  if (state.status === 'LOBBY') {
    knownRoads.clear();
    knownBuildings.clear();
    knownFogHexes.clear();
    pieceAnimTimestamps.clear();
    roadAnalysisCache.clear();
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

  let hasActiveFogAnim = false;
  for (const h of hexes) {
    const isFog = !!h.fog || h.type === 'fog';
    if (isFog) {
      knownFogHexes.add(h.id);
    } else if (knownFogHexes.has(h.id)) {
      knownFogHexes.delete(h.id);
      pieceAnimTimestamps.set(`fog_${h.id}`, now);
    }
    if (!hasActiveFogAnim && getPieceAnimAttrs(`fog_${h.id}`, now).isAnimating) {
      hasActiveFogAnim = true;
    }
  }

  let hasActiveRoadAnim = false;
  for (const e of edges) {
    if (e.road && !knownRoads.has(e.id)) {
      knownRoads.add(e.id);
      pieceAnimTimestamps.set(`road_${e.id}`, now);
      if (state.status !== 'LOBBY' && !playedRoadSfx) {
        playedRoadSfx = true;
        playPlaceRoadSound();
      }
    }
    if (!hasActiveRoadAnim && e.road && getPieceAnimAttrs(`road_${e.id}`, now).isAnimating) {
      hasActiveRoadAnim = true;
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

  // 1. Static / Terrain Layer: rebuilds only when board terrain/numbers/fog/lobby brush changes.
  const canPaintHex = isLobbyHost && (activeBrush.type === 'terrain' || activeBrush.type === 'number' || activeBrush.type === 'robber');
  const terrainSigParts: string[] = [
    cachedGeomBoardKey,
    state.status,
    canPaintHex ? '1' : '0',
    hasActiveFogAnim ? String(Math.floor(now / 32)) : '0'
  ];
  for (const h of hexes) {
    const isFog = !!h.fog || h.type === 'fog';
    terrainSigParts.push(`${isFog ? 'fog' : h.type}:${isFog ? '' : (h.number || '')}`);
  }
  const terrainKey = terrainSigParts.join('|');

  if (terrainKey !== lastTerrainKey) {
    lastTerrainKey = terrainKey;
    let landPathD = '';
    for (const h of hexes) {
      if (h.type === 'water') continue;
      const g = hexGeomCache.get(h.id);
      if (g) landPathD += g.pathSub;
    }

    let terrainHtml = '';
    if (landPathD) {
      // Single combined <path> for shallow water and single <path> for sand instead of 2*N separate polygons.
      terrainHtml += `<path d="${landPathD}" style="fill:var(--sea-shallow);stroke:var(--sea-shallow);stroke-width:46;stroke-linejoin:round" />`;
      terrainHtml += `<path d="${landPathD}" style="fill:var(--sand);stroke:var(--sand);stroke-width:16;stroke-linejoin:round" />`;
    }

    for (const h of hexes) {
      const geom = hexGeomCache.get(h.id)!;
      if (h.type === 'water') {
        if (state.status === 'LOBBY') {
          terrainHtml += `
            <polygon data-paintable="${canPaintHex ? '1' : ''}" points="${geom.rawPts}" style="fill:rgba(255,255,255,0.07);stroke:rgba(255,255,255,0.32);stroke-width:2;stroke-dasharray:6 4;cursor:${canPaintHex ? 'pointer' : 'grab'}"
              onmousedown="onHexInteract(${h.id}, event)" onmouseenter="onHexEnter(${h.id}, event)" />
          `;
        }
        continue;
      }

      const isFog = !!h.fog || h.type === 'fog';
      const tileType = isFog ? 'fog' : h.type;
      const meta = RES_META[tileType] || RES_META.desert;
      const hasNumber = !isFog && !!h.number;
      const fogAnim = getPieceAnimAttrs(`fog_${h.id}`, now);
      const glyph = hasNumber ? getBoardIconSvg(tileType, 0, -24, 1.45) : getBoardIconSvg(tileType, 0, 0, 1.9);

      terrainHtml += `
        <g data-paintable="${canPaintHex ? '1' : ''}"
           style="${canPaintHex ? 'cursor:pointer' : ''}"
           onmousedown="onHexInteract(${h.id}, event)"
           onclick="onHexClick(${h.id}, event)"
           onmouseenter="onHexEnter(${h.id}, event)">
          <polygon points="${geom.tilePoly}" style="fill:${meta.color};stroke:${meta.border};stroke-width:4;stroke-linejoin:round" />
          <g transform="translate(${h.x}, ${h.y})">
            <g class="${fogAnim.isAnimating ? 'fog-reveal-anim' : ''}" style="${fogAnim.delayStyle}">
              ${glyph}
              ${hasNumber ? tokenMarkup(h.number) : ''}
            </g>
          </g>
        </g>
      `;
    }
    layers.terrainLayer.innerHTML = terrainHtml;
  }

  // 2. Dynamic Hex Overlay Layer: rolled hex dimming, robber target highlights, and the robber piece.
  const robberAnim = getPieceAnimAttrs('robber_move', now);
  let hexDynHtml = '';
  const isRobberPhase = isMyTurn && state.phase === 'ROBBER';
  for (const h of hexes) {
    if (h.type === 'water') continue;
    const isFog = !!h.fog || h.type === 'fog';
    if (isFog) continue;
    const geom = hexGeomCache.get(h.id)!;
    const isRolledHex = showRollDim && rolledHexSet.has(h.id);
    const canClickRobber = isRobberPhase && h.id !== robberHexId;
    const hasRobber = h.id === robberHexId;

    if (!isRolledHex && !canClickRobber && !hasRobber) continue;

    if (isRolledHex) {
      hexDynHtml += `<polygon class="hex-rolled" points="${geom.innerPoly}" style="${rollDimStyle}" />`;
    }
    if (canClickRobber) {
      hexDynHtml += `
        <g onclick="onHexClick(${h.id}, event)" style="cursor:pointer">
          <polygon class="hex-tint" points="${geom.innerPoly}" />
          <polygon class="hex-target" points="${geom.innerPoly}" />
        </g>`;
    }
    if (hasRobber) {
      hexDynHtml += `
        <g transform="translate(${h.x + ROBBER_DX}, ${h.y + ROBBER_DY})" style="pointer-events:none">
          ${robberAnim.isAnimating ? `<circle cx="0" cy="0" r="24" class="robber-impact-ring" style="${robberAnim.delayStyle}" />` : ''}
          <g class="${robberAnim.isAnimating ? 'robber-drop-anim' : ''}" style="${robberAnim.delayStyle}">
            <g transform="scale(0.85)">${robberMarkup()}</g>
          </g>
        </g>`;
    }
  }
  layers.hexDynamicLayer.innerHTML = hexDynHtml;
  layers.overlayLayer.innerHTML = renderHexOverlaysMarkup(
    hexes,
    id => hexGeomCache.get(id)?.innerPoly,
    (state as any).hexOverlays ?? null
  );

  // 3. Ports Layer: rebuilds only when coastal ports, port ownership, or lobby port brush changes.
  const canPaintPort = isLobbyHost && activeBrush.type === 'port';
  const portsSigParts: string[] = [cachedGeomBoardKey, canPaintPort ? '1' : '0'];
  for (const e of edges) {
    if (e.hexIds.length !== 1) continue;
    if (e.port) {
      const v1 = vertices[e.v1], v2 = vertices[e.v2];
      const owned = Boolean(v1 && v2 && [v1, v2].some((v: any) => v.building && v.building.owner === socket.id));
      portsSigParts.push(`${e.id}:${e.port}:${owned ? '1' : '0'}`);
    }
  }
  const portsKey = portsSigParts.join('|');
  if (portsKey !== lastPortsKey) {
    lastPortsKey = portsKey;
    let portsHtml = '';
    for (const e of edges) {
      if (e.hexIds.length !== 1) continue;
      const v1 = vertices[e.v1], v2 = vertices[e.v2];
      if (!v1 || !v2) continue;

      const mx = (v1.x + v2.x) / 2, my = (v1.y + v2.y) / 2;
      const h = hexes[e.hexIds[0]];

      if (e.port) {
        const owned = [v1, v2].some((v: any) => v.building && v.building.owner === socket.id);
        portsHtml += portMarkup(e, v1, v2, h, owned, isLobbyHost);
      } else if (canPaintPort) {
        portsHtml += `
          <circle data-paintable="1" cx="${mx}" cy="${my}" r="9" style="fill:rgba(255,255,255,0.5);stroke:var(--accent);stroke-width:2;cursor:pointer"
            onclick="onEdgeInteract(${e.id})" />
        `;
      }
    }
    layers.portsLayer.innerHTML = portsHtml;
  }

  // 4. Placed Roads Layers: rebuilds only when placed roads, blocking buildings, or road drop animations change.
  const placedRoadsSigParts: string[] = [
    cachedGeomBoardKey,
    hasActiveRoadAnim ? String(Math.floor(now / 32)) : '0'
  ];
  for (const e of edges) {
    if (e.road) placedRoadsSigParts.push(`r${e.id}:${e.road}`);
  }
  for (const v of vertices) {
    if (v.building) placedRoadsSigParts.push(`b${v.id}:${v.building.owner}`);
  }
  const placedRoadsKey = placedRoadsSigParts.join('|');

  if (placedRoadsKey !== lastPlacedRoadsKey) {
    lastPlacedRoadsKey = placedRoadsKey;
    roadAnalysisCache.clear();
    let roadRimsHtml = '';
    let roadBodiesHtml = '';
    let roadHitsHtml = '';

    for (const e of edges) {
      if (!e.road) continue;
      const v1 = vertices[e.v1], v2 = vertices[e.v2];
      if (!v1 || !v2) continue;
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
            <line class="road-rim-line" x1="${(x1 - mx).toFixed(1)}" y1="${(y1 - my).toFixed(1)}" x2="${(x2 - mx).toFixed(1)}" y2="${(y2 - my).toFixed(1)}" />
          </g>
        </g>`;

      roadBodiesHtml += `
        <g transform="translate(${mx}, ${my})">
          <g class="${anim.isAnimating ? 'piece-drop-anim' : ''}" style="${anim.delayStyle}">
            <line class="road-body-line" x1="${(x1 - mx).toFixed(1)}" y1="${(y1 - my).toFixed(1)}" x2="${(x2 - mx).toFixed(1)}" y2="${(y2 - my).toFixed(1)}"
              style="stroke:${col}" />
          </g>
        </g>`;

      roadHitsHtml += `
        <line class="road-hit" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
          onmouseenter="onRoadHover(${e.id}, event)"
          onmousemove="onRoadMove(event)"
          onmouseleave="onRoadLeave()" />`;
    }

    layers.roadRimsLayer.innerHTML = roadRimsHtml;
    layers.roadBodiesLayer.innerHTML = roadBodiesHtml;
    layers.roadHitsLayer.innerHTML = roadHitsHtml;
  }

  // 5. Road Spots Layer (buildable edges)
  let roadSpotsHtml = '';
  for (const e of edges) {
    if (e.road) continue;
    const v1 = vertices[e.v1], v2 = vertices[e.v2];
    if (!v1 || !v2) continue;
    if (isMyTurn && canClientPlaceRoad(e, me)) {
      const mx = (v1.x + v2.x) / 2, my = (v1.y + v2.y) / 2;
      roadSpotsHtml += `
        <g onclick="clickEdge(${e.id})" style="cursor:pointer">
          <line class="road-spot-line" x1="${v1.x}" y1="${v1.y}" x2="${v2.x}" y2="${v2.y}" />
          <circle class="road-spot-dot" cx="${mx}" cy="${my}" r="8" />
        </g>
      `;
    }
  }
  layers.roadSpotsLayer.innerHTML = roadSpotsHtml;

  // 6. Vertices Layer: settlements, cities, and settlement spots
  const robberVictimSet = new Set<string>(state.robberVictims || []);
  let verticesHtml = '';
  const staticSpots = vertices.length > 120;
  const canAffordCity = me ? canClientAffordPiece(me, 'city') : false;
  for (const v of vertices) {
    if (v.building) {
      const owner = state.players.find(p => p.id === v.building.owner);
      const col = owner?.color || '#888';
      const canUpgrade = isMyTurn && state.phase === 'MAIN' &&
        v.building.owner === socket.id && v.building.type === 'settlement' &&
        me && canAffordCity && me.citiesLeft > 0;
      const canRobThisBuilding = isMyTurn && state.phase === 'ROBBER_STEAL' &&
        v.hexIds.includes(robberHexId) && robberVictimSet.has(v.building.owner);
      const isCity = v.building.type === 'city';
      const isClickable = canUpgrade || canRobThisBuilding;
      const clickAttr = (isCity ? canRobThisBuilding : isClickable) ? `clickVertex(${v.id})` : '';
      const ringR = isCity ? 27 : 22;
      const anim = getPieceAnimAttrs(`${isCity ? 'city' : 'settlement'}_${v.id}`, now);

      verticesHtml += `
        <g transform="translate(${v.x}, ${v.y})" onclick="${clickAttr}" style="${clickAttr ? 'cursor:pointer' : ''}">
          <g class="building-zoom-scale">
            ${anim.isAnimating ? `<circle cx="0" cy="0" r="${ringR + 4}" class="piece-impact-ring" style="${anim.delayStyle}" />` : ''}
            ${clickAttr ? `<circle r="${ringR + 2}" fill="transparent" />` : ''}
            ${canRobThisBuilding ? `<circle r="${ringR}" class="target-ring rob" />` : ''}
            ${!isCity && canUpgrade && !canRobThisBuilding ? `<circle r="${ringR}" class="target-ring upgrade" />` : ''}
            <g class="${anim.isAnimating ? 'piece-drop-anim' : ''}" style="${anim.delayStyle}">
              ${isCity ? cityMarkup(col) : settlementMarkup(col)}
            </g>
          </g>
        </g>
      `;
    } else if (isMyTurn && canClientPlaceSettlement(v, me)) {
      verticesHtml += `
        <g onclick="clickVertex(${v.id})" style="cursor:pointer">
          <circle cx="${v.x}" cy="${v.y}" r="20" fill="transparent" />
          <circle cx="${v.x}" cy="${v.y}" r="11" class="spot-pulse${staticSpots ? ' spot-static' : ''}" />
        </g>
      `;
    }
  }

  layers.verticesLayer.innerHTML = verticesHtml;
}

// Updates camera viewBox smoothly via requestAnimationFrame on pan/zoom without reconstructing the SVG DOM.
export function rerenderBoard(): void {
  if (!state || cameraRafPending) return;
  cameraRafPending = true;
  requestAnimationFrame(() => {
    cameraRafPending = false;
    updateCameraViewBox();
  });
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
function analyzeRoadConnection(startEdgeId: number): RoadConnInfo | null {
  if (!state?.board) return null;
  const cached = roadAnalysisCache.get(startEdgeId);
  if (cached) return cached;

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

  // 2. Bounded DFS over the connected component to find the longest continuous stretch (simple path of edges)
  let bestPath: number[] = [startEdgeId];
  let bestIncludesHovered = true;
  const used = new Set<number>();
  const currentPath: number[] = [];
  let steps = 0;
  const maxSteps = 4000;

  function dfs(vertexId: number, depth: number): void {
    if (++steps > maxSteps) return;
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
      if (steps > maxSteps) return;
    }
  }

  const endpoints = new Set<number>();
  for (const eId of compSet) {
    const e = edges[eId];
    endpoints.add(e.v1);
    endpoints.add(e.v2);
  }
  for (const vId of endpoints) {
    dfs(vId, 0);
    if (steps > maxSteps) break;
  }

  const result: RoadConnInfo = {
    ownerName: owner?.name || 'Player',
    ownerColor: owner?.color || '#888',
    totalRoads: compSet.size,
    longestStretch: bestPath.length,
    longestPathEdges: new Set(bestPath),
    componentEdges: [...compSet]
  };
  roadAnalysisCache.set(startEdgeId, result);
  return result;
}

export function onRoadHover(edgeId: number, ev?: MouseEvent): void {
  if (isMouseDown || hasDraggedMap) return;
  const info = analyzeRoadConnection(edgeId);
  const hlLayer = document.getElementById('roadHighlightLayer');
  const tooltip = document.getElementById('roadHoverTooltip');
  if (!info || !hlLayer || !state?.board) return;

  // Two halos under the roads. Each is one group (opacity on the group), so segments join without overlapping:
  // a faint one for the whole connected network, a stronger one for the longest stretch.
  const { edges, vertices } = state.board;
  const lineOf = (eId: number): string => {
    const e = edges[eId];
    const v1 = vertices[e.v1], v2 = vertices[e.v2];
    return v1 && v2 ? `<line x1="${v1.x}" y1="${v1.y}" x2="${v2.x}" y2="${v2.y}" />` : '';
  };
  const netHtml = info.componentEdges.map(lineOf).join('');
  const bestHtml = [...info.longestPathEdges].map(lineOf).join('');
  hlLayer.innerHTML = `<g class="road-glow-net">${netHtml}</g><g class="road-glow-best">${bestHtml}</g>`;

  if (tooltip) {
    tooltip.textContent = `Road Length: ${info.longestStretch}`;
    tooltip.style.display = 'flex';
    if (ev) onRoadMove(ev);
  }
}

export function onRoadMove(ev: MouseEvent): void {
  if (isMouseDown || hasDraggedMap) return;
  const tooltip = document.getElementById('roadHoverTooltip');
  if (!tooltip || tooltip.style.display === 'none') return;
  const x = Math.max(80, Math.min(window.innerWidth - 80, ev.clientX));
  const y = Math.max(48, ev.clientY - 16);
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

const CLIENT_BASE_PIECE_LIMITS: Record<'road' | 'settlement' | 'city', number> = {
  road: 15,
  settlement: 5,
  city: 4
};

export function countClientActivePieces(ownerId: string, piece: 'road' | 'settlement' | 'city'): number {
  if (!state?.board) return 0;
  if (piece === 'road') {
    let n = 0;
    for (const e of state.board.edges) {
      if (e.road === ownerId) n++;
    }
    return n;
  }
  let n = 0;
  for (const v of state.board.vertices) {
    if (v.building && v.building.owner === ownerId && v.building.type === piece) n++;
  }
  return n;
}

export function isClientPieceDoubleCost(piece: 'road' | 'settlement' | 'city', ownerId: string = socket.id || ''): boolean {
  if (!ownerId || !state?.board) return false;
  return countClientActivePieces(ownerId, piece) >= CLIENT_BASE_PIECE_LIMITS[piece];
}

const CLIENT_BASE_PIECE_COSTS: Record<'road' | 'settlement' | 'city', Record<string, number>> = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 }
};

export function getClientPieceCost(piece: 'road' | 'settlement' | 'city', ownerId: string = socket.id || ''): Record<string, number> {
  const player = state?.players?.find(p => p.id === ownerId);
  const srvCost = player?.pieceCosts?.[piece];
  if (srvCost && typeof srvCost === 'object') return srvCost;
  const mult = isClientPieceDoubleCost(piece, ownerId) ? 2 : 1;
  const base = CLIENT_BASE_PIECE_COSTS[piece];
  return Object.fromEntries(Object.entries(base).map(([r, n]) => [r, n * mult]));
}

export function canClientAffordPiece(me: any, piece: 'road' | 'settlement' | 'city'): boolean {
  if (!me || !me.resources) return false;
  const cost = getClientPieceCost(piece, me.id || socket.id || '');
  return Object.entries(cost).every(([r, n]) => (me.resources[r] || 0) >= (Number(n) || 0));
}

export function canClientPlaceSettlement(v: any, me: any): boolean {
  if (!me || me.settlementsLeft <= 0) return false;
  for (const adjId of v.adjacentVertices) {
    if (state.board.vertices[adjId]?.building) return false;
  }
  if (state.phase === 'SETUP_SETTLEMENT') return true;
  if (state.phase !== 'MAIN') return false;
  if (!canClientAffordPiece(me, 'settlement')) return false;
  return v.edgeIds.some((eId: number) => state.board.edges[eId]?.road === socket.id);
}

export function canClientPlaceRoad(e: any, me: any): boolean {
  if (!me || me.roadsLeft <= 0) return false;
  if (state.phase === 'SETUP_ROAD') {
    return e.v1 === state.lastSetupVertexId || e.v2 === state.lastSetupVertexId;
  }
  if (state.phase !== 'MAIN') return false;
  const canAfford = me.freeRoads > 0 || canClientAffordPiece(me, 'road');
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

let inFlightUiRaf = false;

function syncInFlightUiImmediate(): void {
  if (!state) return;
  const me = state.players.find(p => p.id === socket.id);
  const current = state.players[state.turnIndex];
  const isMyTurn = !!current && current.id === socket.id;
  renderHand(me, isMyTurn);
  renderSidebar();
  if (state.status !== 'GAMEOVER') {
    renderBoard(me, isMyTurn);
  }
}

function syncInFlightUi(): void {
  if (!state || inFlightUiRaf) return;
  inFlightUiRaf = true;
  requestAnimationFrame(() => {
    inFlightUiRaf = false;
    syncInFlightUiImmediate();
  });
}

function getTransferTargetEl(actorId: string, resource: string, kind: string): HTMLElement | null {
  if (actorId === socket.id) {
    if (resource && resource !== 'dev' && resource !== 'mystery') {
      return document.querySelector<HTMLElement>(`#myHandPanel .card-${resource}`) || document.getElementById('myHandPanel');
    }
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

  const flightMs = 720;
  const cardStackStepMs = 95;

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

  let heldAny = false;
  transfers.forEach((tr, groupIdx) => {
    const fromEl = getTransferTargetEl(tr.from, tr.resource, tr.kind);
    const toEl = getTransferTargetEl(tr.to, tr.resource, tr.kind);
    if (!fromEl || !toEl) return;

    const fromRect = visibleRect(fromEl);
    const toRect = visibleRect(toEl);

    const startX = fromRect.left + fromRect.width / 2 - 24;
    const startY = fromRect.top + fromRect.height / 2 - 33;
    const endX = toRect.left + toRect.width / 2 - 24;
    const endY = toRect.top + toRect.height / 2 - 33;

    // Slight vertical offset so simultaneous bidirectional trade cards don't overlap identically
    const curveOffset = (groupIdx % 2 === 0 ? -1 : 1) * 14;
    const totalAmount = Math.max(1, tr.amount || 1);
    const maxStack = transfers.length > 6 ? 2 : 3;
    const count = Math.min(totalAmount, maxStack);
    const isIncomingToPlayer = Boolean(tr.to && tr.to !== 'bank');

    // If bankTrade or buyDev receiving from bank, add a slight beat after the payment cards fly in
    const baseGroupDelay = (tr.from === 'bank' && (tr.kind === 'bankTrade' || tr.kind === 'buyDev'))
      ? 200
      : Math.min(160, groupIdx * 40);

    for (let i = 0; i < count; i++) {
      const cardAmount = i === count - 1
        ? totalAmount - Math.floor(totalAmount / count) * (count - 1)
        : Math.floor(totalAmount / count);

      if (isIncomingToPlayer) {
        heldAny = true;
        if (tr.resource === 'dev') {
          addInFlightDev(tr.to, socket.id, cardAmount);
        } else {
          addInFlightResource(tr.to, socket.id, tr.resource, cardAmount);
        }
      }

      const d = baseGroupDelay + i * cardStackStepMs;
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

        // Land: reveal the card in hand/sidebar right as the flying card arrives, then fade out.
        setTimeout(() => {
          if (isIncomingToPlayer) {
            if (tr.resource === 'dev') {
              releaseInFlightDev(tr.to, socket.id, cardAmount);
            } else {
              releaseInFlightResource(tr.to, socket.id, tr.resource, cardAmount);
            }
            syncInFlightUi();
          }
          cardEl.style.opacity = '0';
          setTimeout(() => cardEl.remove(), 100);
        }, flightMs);
      }, d);
    }
  });

  if (heldAny) {
    syncInFlightUiImmediate();
  }
}

export function triggerFlyingResourceAnimations(productions: any[]): void {
  const svg = document.getElementById('boardSvg') as unknown as SVGSVGElement | null;
  if (!svg || !state?.board) return;
  const ctm = svg.getScreenCTM();
  if (!ctm) return;

  // Short lead-in after dice shake so all producing hexes launch their cards together and finish before bots act.
  const rollBeatMs = 180;
  const flightMs = 780;
  const cardStackStepMs = 110;
  const maxVisualCardsPerProd = productions.length > 6 ? 1 : 2;

  let heldAny = false;
  let soundBudget = 0;

  productions.forEach((prod, prodIdx) => {
    const hex = state.board.hexes[prod.hexId];
    if (!hex) return;

    const pt = svg.createSVGPoint();
    pt.x = hex.x;
    pt.y = hex.y;
    const screenPt = pt.matrixTransform(ctm);

    let targetEl: HTMLElement | null = null;
    if (prod.playerId === socket.id) {
      targetEl = document.querySelector<HTMLElement>(`#myHandPanel .card-${prod.resource}`) || document.getElementById('myHandPanel');
    } else {
      targetEl = document.getElementById(`playerRow_${prod.playerId}`);
    }
    if (!targetEl) return;
    const rect = visibleRect(targetEl);
    const targetX = rect.left + rect.width / 2 - 24;
    const targetY = rect.top + rect.height / 2 - 33;

    const totalAmount = Math.max(1, prod.amount || 1);
    const cardsToFly = Math.min(totalAmount, maxVisualCardsPerProd);
    const groupOffsetMs = Math.min(180, prodIdx * 30);

    for (let i = 0; i < cardsToFly; i++) {
      const cardAmount = i === cardsToFly - 1
        ? totalAmount - Math.floor(totalAmount / cardsToFly) * (cardsToFly - 1)
        : Math.floor(totalAmount / cardsToFly);

      heldAny = true;
      addInFlightResource(prod.playerId, socket.id, prod.resource, cardAmount);

      const d = rollBeatMs + groupOffsetMs + i * cardStackStepMs;
      const playChime = soundBudget < 5;
      if (playChime) soundBudget++;
      const chimeIdx = soundBudget;

      setTimeout(() => {
        const cardEl = document.createElement('div');
        cardEl.className = `flying-res-card card-${prod.resource}`;
        cardEl.style.transition = `left ${flightMs}ms cubic-bezier(0.22, 1, 0.36, 1), top ${flightMs}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${flightMs}ms ease, opacity 90ms ease-out`;
        cardEl.innerHTML = getMiniSvg(prod.resource);
        cardEl.style.left = `${screenPt.x - 24 + (i * 8)}px`;
        cardEl.style.top = `${screenPt.y - 33 - (i * 6)}px`;
        cardEl.style.transform = 'scale(0.85)';
        document.body.appendChild(cardEl);

        if (playChime) {
          playTone(540 + chimeIdx * 45, 0.05);
        }

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            cardEl.style.left = `${targetX}px`;
            cardEl.style.top = `${targetY}px`;
            cardEl.style.transform = 'scale(1)';
          });
        });

        setTimeout(() => {
          releaseInFlightResource(prod.playerId, socket.id, prod.resource, cardAmount);
          syncInFlightUi();
          cardEl.style.opacity = '0';
          setTimeout(() => cardEl.remove(), 100);
        }, flightMs);
      }, d);
    }
  });

  if (heldAny) {
    syncInFlightUiImmediate();
  }
}
