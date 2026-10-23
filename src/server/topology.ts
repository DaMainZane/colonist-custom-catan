import type { Board, Edge, Hex, Settings, Vertex } from './types';
import { clamp, shuffle } from './util';

export function rebuildBoardTopology(
  hexes: Hex[],
  existingPorts: Record<string, string> = {},
  autoGeneratePorts = false
): Board {
  const hexSize = 95;
  const vertices: Vertex[] = [];
  const edges: Edge[] = [];

  function getOrCreateVertex(x: number, y: number): Vertex {
    for (const v of vertices) {
      if (Math.hypot(v.x - x, v.y - y) < 8) return v;
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
    return v;
  }

  function getOrCreateEdge(v1: Vertex, v2: Vertex, hexId: number): Edge {
    const minV = Math.min(v1.id, v2.id);
    const maxV = Math.max(v1.id, v2.id);
    for (const e of edges) {
      if (e.v1 === minV && e.v2 === maxV) {
        if (!e.hexIds.includes(hexId)) e.hexIds.push(hexId);
        return e;
      }
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
    if (!v1.adjacentVertices.includes(v2.id)) v1.adjacentVertices.push(v2.id);
    if (!v2.adjacentVertices.includes(v1.id)) v2.adjacentVertices.push(v1.id);
    if (!v1.edgeIds.includes(e.id)) v1.edgeIds.push(e.id);
    if (!v2.edgeIds.includes(e.id)) v2.edgeIds.push(e.id);
    return e;
  }

  let robberHexId = 0;
  let foundDesert = false;

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
      h.vertexIds = [];
      return;
    }

    if (h.type === 'desert' && !foundDesert) {
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
    const firstLand = hexes.find(h => h.type !== 'water');
    if (firstLand) robberHexId = firstLand.id;
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
    for (let i = 0; i < coastalEdges.length; i += 3) {
      const edge = coastalEdges[i];
      const v1 = vertices[edge.v1];
      const v2 = vertices[edge.v2];
      if (v1 && v2 && !v1.port && !v2.port) {
        const pType = portTypes[portIdx % portTypes.length];
        portIdx++;
        edge.port = pType;
      }
    }
  }

  edges.forEach(e => {
    if (e.hexIds.length !== 1) e.port = null;
    if (e.port && vertices[e.v1] && vertices[e.v2]) {
      vertices[e.v1].port = e.port;
      vertices[e.v2].port = e.port;
    }
  });

  return { hexes, vertices, edges, robberHexId };
}

export function generateBoard(settings: Settings, preset = 'standard'): Board {
  const radius = clamp(settings.boardRadius, 1, 4, 2);
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
    const hexes: Hex[] = coords.map((c, i) => ({ id: i, q: c.q, r: c.r, type: 'water', number: null }));
    return rebuildBoardTopology(hexes, {}, false);
  }

  const goldCount = preset === 'goldRush'
    ? Math.max(5, Math.floor(totalHexes / 3))
    : Math.min(clamp(settings.goldTiles, 0, 40, 2), totalHexes - 1);
  const desertCount = Math.min(clamp(settings.desertTiles, 0, 15, 1), Math.max(0, totalHexes - goldCount));
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
    return { id: idx, q: c.q, r: c.r, type, number };
  });

  return rebuildBoardTopology(hexes, {}, true);
}
