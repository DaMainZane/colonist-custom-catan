// MODULE: pure hex-grid topology (vertices, edges, ports, robber start) | USED BY: mapgen, map editor (later), tests
import type { Board, Edge, Hex, Vertex } from './types';

export interface HexInit { q: number; r: number; type: string; number: number | null; ext?: Record<string, any> }

export interface TopologyOptions {
  /** Existing ports keyed by edge midpoint key. */
  ports?: Record<string, string>;
  /** Already-shuffled port ids to place automatically on the coast. null = no auto ports. */
  autoPorts?: string[] | null;
  isLand?: (type: string) => boolean;
  /** Preferred robber start tile type (default desert). */
  robberType?: string;
}

export function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

export function buildTopology(inits: HexInit[], opts: TopologyOptions = {}): Board {
  const isLand = opts.isLand ?? ((t: string) => t !== 'water');
  const existingPorts = opts.ports ?? {};
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
      port: null,
      piece: null
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
      port: existingPorts[key] || null,
      piece: null
    };
    edges.push(e);
    edgeMap.set(pairKey, e);
    if (!v1.adjacentVertices.includes(v2.id)) v1.adjacentVertices.push(v2.id);
    if (!v2.adjacentVertices.includes(v1.id)) v2.adjacentVertices.push(v1.id);
    if (!v1.edgeIds.includes(e.id)) v1.edgeIds.push(e.id);
    if (!v2.edgeIds.includes(e.id)) v2.edgeIds.push(e.id);
    return e;
  }

  const hexes: Hex[] = inits.map((h, idx) => ({
    id: idx,
    q: h.q,
    r: h.r,
    x: 0,
    y: 0,
    type: h.type,
    number: h.number,
    corners: [],
    vertexIds: [],
    ext: h.ext ? { ...h.ext } : {}
  }));

  hexes.forEach((h, idx) => {
    const cx = hexSize * Math.sqrt(3) * (h.q + h.r / 2);
    const cy = hexSize * (3 / 2) * h.r;
    h.x = Number(cx.toFixed(2));
    h.y = Number(cy.toFixed(2));

    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (60 * i - 30);
      h.corners.push({
        x: Number((cx + hexSize * Math.cos(angle)).toFixed(2)),
        y: Number((cy + hexSize * Math.sin(angle)).toFixed(2))
      });
    }

    if (!isLand(h.type)) {
      h.number = null;
      h.vertexIds = [];
      return;
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

  // Robber start: visible desert, any desert, first visible land, first land.
  const robberType = opts.robberType ?? 'desert';
  const robber =
    hexes.find(h => h.type === robberType && !h.ext.hidden) ||
    hexes.find(h => h.type === robberType) ||
    hexes.find(h => isLand(h.type) && !h.ext.hidden) ||
    hexes.find(h => isLand(h.type));
  const robberHexId = robber ? robber.id : 0;

  const coastalEdges = edges.filter(e => e.hexIds.length === 1);
  coastalEdges.sort((a, b) => {
    const va = vertices[a.v1], vb = vertices[a.v2];
    const vc = vertices[b.v1], vd = vertices[b.v2];
    return Math.atan2((va.y + vb.y) / 2, (va.x + vb.x) / 2) - Math.atan2((vc.y + vd.y) / 2, (vc.x + vd.x) / 2);
  });

  if (opts.autoPorts && opts.autoPorts.length > 0) {
    const portTypes = opts.autoPorts;
    let portIdx = 0;

    // Group coastal edges by land hex so each hex gets at most one port and
    // no two adjacent hexes (hexDistance <= 1) both get one.
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
      return Math.atan2(ha.y, ha.x) - Math.atan2(hb.y, hb.x);
    });

    const placedPortHexes: Hex[] = [];
    for (const hId of coastalHexIds) {
      const h = hexes[hId];
      if (!h) continue;
      if (placedPortHexes.some(ph => hexDistance(h, ph) <= 1)) continue;

      const candidateEdges = edgesByHex.get(hId) || [];
      // Prefer the edge facing outward from the board centre.
      const hexAngle = Math.atan2(h.y, h.x);
      candidateEdges.sort((a, b) => {
        const va1 = vertices[a.v1], va2 = vertices[a.v2];
        const vb1 = vertices[b.v1], vb2 = vertices[b.v2];
        const angA = Math.atan2(((va1.y + va2.y) / 2) - h.y, ((va1.x + va2.x) / 2) - h.x);
        const angB = Math.atan2(((vb1.y + vb2.y) / 2) - h.y, ((vb1.x + vb2.x) / 2) - h.x);
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

  // Final pass: ports only on coastal edges, and never on two adjacent hexes.
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
