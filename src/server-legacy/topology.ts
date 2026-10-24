import type { Board, Edge, Hex, Settings, Vertex } from './types';
import { clamp, shuffle } from './util';

export function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

export function rebuildBoardTopology(
  hexes: Hex[],
  existingPorts: Record<string, string> = {},
  autoGeneratePorts = false
): Board {
  const hexSize = 95;
  const vertices: Vertex[] = [];
  const edges: Edge[] = [];
  const vertexGrid = new Map<string, Vertex[]>();
  const edgeMap = new Map<string, Edge>();
  const cellSize = 16;

  function getOrCreateVertex(x: number, y: number): Vertex {
    const gx = Math.floor(x / cellSize);
    const gy = Math.floor(y / cellSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = vertexGrid.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const v of bucket) {
          if (Math.hypot(v.x - x, v.y - y) < 8) return v;
        }
      }
    }
    const v: Vertex = {
      id: vertices.length,
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      hexIds: [],
      adjacentVertices: [],
      edgeIds: [],
      building: null,
      port: null
    };
    vertices.push(v);
    const key = `${gx},${gy}`;
    let bucket = vertexGrid.get(key);
    if (!bucket) {
      bucket = [];
      vertexGrid.set(key, bucket);
    }
    bucket.push(v);
    return v;
  }

  function getOrCreateEdge(v1: Vertex, v2: Vertex, hexId: number): Edge {
    const minV = Math.min(v1.id, v2.id);
    const maxV = Math.max(v1.id, v2.id);
    const pairKey = `${minV}_${maxV}`;
    const existing = edgeMap.get(pairKey);
    if (existing) {
      if (!existing.hexIds.includes(hexId)) existing.hexIds.push(hexId);
      return existing;
    }
    const key = `${Math.round((v1.x + v2.x) / 2)},${Math.round((v1.y + v2.y) / 2)}`;
    const e: Edge = {
      id: edges.length,
      v1: minV,
      v2: maxV,
      key,
      hexIds: [hexId],
      road: null,
      port: existingPorts[key] || null
    };
    edges.push(e);
    edgeMap.set(pairKey, e);
    if (!v1.adjacentVertices.includes(v2.id)) v1.adjacentVertices.push(v2.id);
    if (!v2.adjacentVertices.includes(v1.id)) v2.adjacentVertices.push(v1.id);
    if (!v1.edgeIds.includes(e.id)) v1.edgeIds.push(e.id);
    if (!v2.edgeIds.includes(e.id)) v2.edgeIds.push(e.id);
    return e;
  }

  let robberHexId = 0;
  let foundDesert = false;
  const fallbackRes = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
  const fallbackNums = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

  hexes.forEach((h, idx) => {
    h.id = idx;
    const cx = hexSize * Math.sqrt(3) * (h.q + h.r / 2);
    const cy = hexSize * (3 / 2) * h.r;
    h.x = Number(cx.toFixed(2));
    h.y = Number(cy.toFixed(2));

    h.corners = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (60 * i - 30);
      h.corners.push({
        x: Number((cx + hexSize * Math.cos(angle)).toFixed(2)),
        y: Number((cy + hexSize * Math.sin(angle)).toFixed(2))
      });
    }

    if (h.type === 'water') {
      h.number = null;
      h.fog = false;
      h.vertexIds = [];
      return;
    }

    if (h.type === 'fog') {
      h.type = fallbackRes[idx % fallbackRes.length];
      if (!h.number) h.number = fallbackNums[idx % fallbackNums.length];
      h.fog = true;
    }

    if (h.type === 'desert' && !h.fog && !foundDesert) {
      robberHexId = idx;
      foundDesert = true;
    }

    const cornerVertices = h.corners.map(pt => {
      const v = getOrCreateVertex(pt.x, pt.y);
      if (!v.hexIds.includes(idx)) v.hexIds.push(idx);
      return v;
    });

    for (let i = 0; i < 6; i++) {
      getOrCreateEdge(cornerVertices[i], cornerVertices[(i + 1) % 6], idx);
    }

    h.vertexIds = cornerVertices.map(v => v.id);
  });

  if (!foundDesert) {
    const visibleDesert = hexes.find(h => h.type === 'desert' && !h.fog);
    const anyDesert = hexes.find(h => h.type === 'desert');
    const firstVisibleLand = hexes.find(h => h.type !== 'water' && !h.fog);
    const firstLand = hexes.find(h => h.type !== 'water');
    const chosen = visibleDesert || anyDesert || firstVisibleLand || firstLand;
    if (chosen) robberHexId = chosen.id;
  }

  const coastalEdges = edges.filter(e => e.hexIds.length === 1);
  coastalEdges.sort((a, b) => {
    const va = vertices[a.v1], vb = vertices[a.v2];
    const vc = vertices[b.v1], vd = vertices[b.v2];
    return Math.atan2((va.y + vb.y) / 2, (va.x + vb.x) / 2) - Math.atan2((vc.y + vd.y) / 2, (vc.x + vd.x) / 2);
  });

  if (autoGeneratePorts) {
    const portTypes = shuffle(['3:1', 'wood', '3:1', 'brick', '3:1', 'sheep', '3:1', 'wheat', 'ore']);
    let portIdx = 0;

    // Group coastal edges by their coastal land hex so we can pick the best outward-facing edge per hex
    // and ensure no two adjacent hexes (tiles) ever receive a port.
    const edgesByHex = new Map<number, Edge[]>();
    for (const edge of coastalEdges) {
      const hId = edge.hexIds[0];
      let list = edgesByHex.get(hId);
      if (!list) {
        list = [];
        edgesByHex.set(hId, list);
      }
      list.push(edge);
    }

    const coastalHexIds = [...edgesByHex.keys()].sort((idA, idB) => {
      const ha = hexes[idA], hb = hexes[idB];
      return Math.atan2(ha.y || 0, ha.x || 0) - Math.atan2(hb.y || 0, hb.x || 0);
    });

    const placedPortHexes: Hex[] = [];
    for (const hId of coastalHexIds) {
      const h = hexes[hId];
      if (!h) continue;
      // Ports cannot spawn on two tiles next to each other (hexDistance <= 1)
      if (placedPortHexes.some(ph => hexDistance(h, ph) <= 1)) continue;

      const candidateEdges = edgesByHex.get(hId) || [];
      // Pick the edge whose outward direction aligns most closely with the hex's radial position
      const hexAngle = Math.atan2(h.y || 0, h.x || 0);
      candidateEdges.sort((a, b) => {
        const va1 = vertices[a.v1], va2 = vertices[a.v2];
        const vb1 = vertices[b.v1], vb2 = vertices[b.v2];
        const angA = Math.atan2(((va1.y + va2.y) / 2) - (h.y || 0), ((va1.x + va2.x) / 2) - (h.x || 0));
        const angB = Math.atan2(((vb1.y + vb2.y) / 2) - (h.y || 0), ((vb1.x + vb2.x) / 2) - (h.x || 0));
        const diffA = Math.abs(Math.atan2(Math.sin(angA - hexAngle), Math.cos(angA - hexAngle)));
        const diffB = Math.abs(Math.atan2(Math.sin(angB - hexAngle), Math.cos(angB - hexAngle)));
        return diffA - diffB;
      });

      const chosenEdge = candidateEdges.find(edge => {
        const v1 = vertices[edge.v1];
        const v2 = vertices[edge.v2];
        if (!v1 || !v2 || v1.port || v2.port) return false;
        const adjHasPort = v1.adjacentVertices.some(id => vertices[id]?.port) ||
                           v2.adjacentVertices.some(id => vertices[id]?.port);
        return !adjHasPort;
      });

      if (chosenEdge) {
        const pType = portTypes[portIdx % portTypes.length];
        portIdx++;
        chosenEdge.port = pType;
        vertices[chosenEdge.v1].port = pType;
        vertices[chosenEdge.v2].port = pType;
        placedPortHexes.push(h);
      }
    }
  }

  const validPortHexes: Hex[] = [];
  edges.forEach(e => {
    if (e.hexIds.length !== 1) {
      e.port = null;
      return;
    }
    if (e.port) {
      const h = hexes[e.hexIds[0]];
      if (!h || validPortHexes.some(ph => hexDistance(h, ph) <= 1)) {
        e.port = null;
        return;
      }
      if (vertices[e.v1] && vertices[e.v2]) {
        vertices[e.v1].port = e.port;
        vertices[e.v2].port = e.port;
        validPortHexes.push(h);
      }
    }
  });

  return { hexes, vertices, edges, robberHexId };
}

export function generateBoard(settings: Settings, preset = 'standard'): Board {
  const radius = clamp(settings.boardRadius, 1, 50, 2);
  const coords: { q: number; r: number }[] = [];

  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      coords.push({ q, r });
    }
  }

  const totalHexes = coords.length;
  if (preset === 'blank') {
    const hexes: Hex[] = coords.map((c, i) => ({ id: i, q: c.q, r: c.r, type: 'water', number: null, fog: false }));
    return rebuildBoardTopology(hexes, {}, false);
  }

  const goldCount = preset === 'goldRush'
    ? Math.max(5, Math.floor(totalHexes / 3))
    : Math.min(clamp(settings.goldTiles, 0, Math.max(40, totalHexes), 2), totalHexes - 1);
  const desertCount = Math.min(clamp(settings.desertTiles, 0, Math.max(15, totalHexes), 1), Math.max(0, totalHexes - goldCount));
  const remaining = Math.max(0, totalHexes - goldCount - desertCount);

  const tileTypes: string[] = [];
  for (let i = 0; i < goldCount; i++) tileTypes.push('gold');
  for (let i = 0; i < desertCount; i++) tileTypes.push('desert');

  const baseWeights = ['wood', 'wheat', 'sheep', 'brick', 'ore'];
  for (let i = 0; i < remaining; i++) {
    tileTypes.push(baseWeights[i % baseWeights.length]);
  }
  const shuffledTypes = shuffle(tileTypes);

  const numberPoolBase = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
  const numberPool: number[] = [];
  for (let i = 0; i < totalHexes; i++) {
    numberPool.push(numberPoolBase[i % numberPoolBase.length]);
  }
  const shuffledNumbers = shuffle(numberPool);

  let numIdx = 0;
  const hexes: Hex[] = coords.map((c, idx) => {
    let type = shuffledTypes[idx] || 'wood';
    if (preset === 'archipelago' && Math.random() < 0.22 && (c.q !== 0 || c.r !== 0)) {
      type = 'water';
    }
    const number = (type === 'desert' || type === 'water') ? null : shuffledNumbers[numIdx++];
    return { id: idx, q: c.q, r: c.r, type, number, fog: false };
  });

  const fogCount = preset === 'fogIsland'
    ? Math.max(4, Math.floor(totalHexes * 0.42))
    : clamp(settings.fogTiles ?? 0, 0, totalHexes, 0);

  if (fogCount > 0) {
    const firstDesertIdx = hexes.findIndex(h => h.type === 'desert');
    const fogCandidates = hexes.filter((h, idx) => h.type !== 'water' && h.type !== 'desert' && idx !== firstDesertIdx);
    const shuffledCandidates = shuffle(fogCandidates);
    const toFog = Math.min(fogCount, shuffledCandidates.length);
    for (let i = 0; i < toFog; i++) {
      shuffledCandidates[i].fog = true;
    }
  }

  return rebuildBoardTopology(hexes, {}, true);
}

