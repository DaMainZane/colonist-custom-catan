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
  /**
   * 'angle' (default) is the classic placement for a centered board. 'coast' places ports per landmass on open-sea
   * coast only (no lake or river shores), for boards with islands, lakes or rings, and for the plain hexagon in
   * `generateMap` (9 ports on the standard board). Needs `autoPorts`.
   */
  portMode?: 'angle' | 'coast';
  /** 0..1, picks which of the alternating harbor sites carry ports (a half-turn of the real layout) ('coast' mode). */
  portOffset?: number;
  /** Takes the last edge of a harbor site instead of the first, which mirrors the layout ('coast' mode). Only breaks ties in the 'hexagon' layout. */
  portFlip?: boolean;
  /**
   * 'hexagon' = the plain full hexagon ('coast' mode): each harbor sits on the edge the real board uses. On a sea tile with two
   * coast edges that is the edge away from the corner tile next to it, so a harbor on a corner has a gap of 2 on both sides and the
   * gaps go 2, 3, 2, 2, 3, 2 ... around the island. Every other shape keeps the general placement (first edge of the site).
   */
  portLayout?: 'hexagon';
  /**
   * Tile types that take no port ('coast' mode): a land tile of this type never carries one, and a non-land tile of this type
   * (a swamp, an ice shelf, anything a mod adds that is not open sea) is not sea, so no port faces it. Default: none.
   */
  portBlocked?: (type: string) => boolean;
  /** Build vertices and edges between adjacent water tiles so bridges can cross the sea (Tidebound). Default: false. */
  waterEdges?: boolean;
}

export function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

/** Neighbour of a hex across its edge i (the edge between corner i and corner i + 1). */
const EDGE_DIR: [number, number][] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];

/**
 * Coast edges in the order a walker meets them: each edge is followed by one that shares a corner with it, so evenly
 * spaced picks are evenly spaced on the real coast (an angle sort around the middle breaks on bays and inlets).
 * Pieces that do not join (a coast cut by a lake or river shore) follow one after another by edge id.
 */
function walkCoast<T extends { edge: Edge }>(list: T[]): T[] {
  const sorted = [...list].sort((a, b) => a.edge.id - b.edge.id);
  const byCorner = new Map<number, T[]>();
  for (const c of sorted) {
    for (const v of [c.edge.v1, c.edge.v2]) {
      const bucket = byCorner.get(v);
      if (bucket) bucket.push(c); else byCorner.set(v, [c]);
    }
  }
  const used = new Set<T>();
  const out: T[] = [];
  for (const start of sorted) {
    if (used.has(start)) continue;
    let cur: T | undefined = start;
    let leave = start.edge.v2;
    while (cur) {
      used.add(cur);
      out.push(cur);
      const next: T | undefined = (byCorner.get(leave) ?? []).find(c => !used.has(c));
      if (next) leave = next.edge.v1 === leave ? next.edge.v2 : next.edge.v1;
      cur = next;
    }
  }
  return out;
}

/** Ports a landmass may carry per land tile (the real board: 9 ports on 19 tiles). */
export const PORTS_PER_LAND_HEX = 0.45;

/** Most ports a landmass of `size` tiles may carry (0 under 3 tiles, 1 under 6). */
export function portCap(size: number): number {
  if (size < 3) return 0;
  if (size < 6) return 1;
  return Math.max(1, Math.floor(size * PORTS_PER_LAND_HEX + 0.5));
}

/** One port per this many harbor sites. The real frame has 18 sea tiles around the island and a harbor on every second one. */
export const SITES_PER_PORT = 2;

/**
 * Harbor sites: the walked coast cut into runs of edges that look out on the same sea tile (a corner tile of the sea frame
 * has one edge, the others have two). A run never wraps around the end of the walk. Pieces that do not join stay apart.
 */
function coastSites<T extends { edge: Edge; sea: string }>(ring: T[]): T[][] {
  const n = ring.length;
  const joined = (a: T, b: T): boolean =>
    a.sea === b.sea && (a.edge.v1 === b.edge.v1 || a.edge.v1 === b.edge.v2 || a.edge.v2 === b.edge.v1 || a.edge.v2 === b.edge.v2);
  let start = 0;
  for (let i = 0; i < n; i++) {
    if (!joined(ring[(i + n - 1) % n], ring[i])) { start = i; break; }
  }
  const sites: T[][] = [];
  for (let k = 0; k < n; k++) {
    const c = ring[(start + k) % n];
    const last = sites[sites.length - 1];
    if (last && joined(last[last.length - 1], c)) last.push(c); else sites.push([c]);
  }
  return sites;
}

/**
 * Ports per landmass (Map Generation Design, section 9). Open sea only: water that reaches the canvas edge is ocean,
 * walled-in water (a lake, a lagoon) and river channels get no ports. The base board's rule, for any shape: cut each
 * coast into harbor sites (see `coastSites`) and give every second site a port, spread evenly. The standard board has
 * 18 sites and 9 ports in the real layout; a hexagon of radius R gets 3 (R + 1). A landmass gets at least one port from
 * 6 tiles up, at most one under 6 tiles and none under 3 tiles, and never more than `portCap` (a small island has a long
 * coast for its size, so the site rule alone buried it in ports). A resource-port mix is dealt round-robin across the
 * landmasses. Rules: one port per hex and none on a vertex next to a port. Ports on neighbouring hexes are fine (the real
 * board has them). `offset` picks which half of the sites carry ports, `flip` mirrors the layout.
 */
function placeCoastPorts(
  hexes: Hex[], vertices: Vertex[], edges: Edge[], edgeMap: Map<string, Edge>,
  isLand: (t: string) => boolean, types: string[], offset: number, blocked: (t: string) => boolean, flip: boolean, hexLayout: boolean
): void {
  const n = hexes.length;
  const at = new Map<string, number>();
  hexes.forEach((h, i) => at.set(`${h.q},${h.r}`, i));
  const land = hexes.map(h => isLand(h.type));
  // Non-land tiles that are not sea: they stop the sea flood and no port faces them.
  const solid = hexes.map((h, i) => !land[i] && blocked(h.type));

  // Water: a connected body that reaches the canvas edge is open sea.
  const ocean = new Uint8Array(n);
  const seen = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (land[s] || solid[s] || seen[s]) continue;
    const comp = [s];
    seen[s] = 1;
    let open = false;
    for (let k = 0; k < comp.length; k++) {
      const h = hexes[comp[k]];
      for (const [dq, dr] of EDGE_DIR) {
        const j = at.get(`${h.q + dq},${h.r + dr}`);
        if (j === undefined) { open = true; continue; }
        if (land[j] || solid[j] || seen[j]) continue;
        seen[j] = 1;
        comp.push(j);
      }
    }
    if (open) for (const c of comp) ocean[c] = 1;
  }

  // Landmasses: land hexes joined across a shared edge.
  const parent = hexes.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  for (const e of edges) {
    if (e.hexIds.length === 2) parent[find(e.hexIds[0])] = find(e.hexIds[1]);
  }
  const massOf = new Map<number, number>();
  const massSize: number[] = [];
  const massHexes: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (!land[i]) continue;
    const root = find(i);
    if (!massOf.has(root)) { massOf.set(root, massSize.length); massSize.push(0); massHexes.push([]); }
    const m = massOf.get(root)!;
    massSize[m]++;
    massHexes[m].push(i);
  }

  // Coast edges on open sea, per landmass.
  // `sea` names the tile an edge looks out on (off the canvas too), which is what makes a harbor site.
  interface Coast { edge: Edge; hex: number; sea: string }
  const coast: Coast[][] = massSize.map(() => []);
  for (let i = 0; i < n; i++) {
    if (!land[i] || blocked(hexes[i].type)) continue;
    const h = hexes[i];
    for (let k = 0; k < 6; k++) {
      const sea = `${h.q + EDGE_DIR[k][0]},${h.r + EDGE_DIR[k][1]}`;
      const j = at.get(sea);
      if (j !== undefined && (land[j] || !ocean[j] || hexes[j].ext?.river)) continue;
      const a = h.vertexIds[k];
      const b = h.vertexIds[(k + 1) % 6];
      const edge = edgeMap.get(`${Math.min(a, b)}_${Math.max(a, b)}`);
      if (edge && edge.hexIds.length === 1) coast[massOf.get(find(i))!].push({ edge, hex: i, sea });
    }
  }

  // Harbor sites per landmass and how many ports each gets: every second site, within the caps.
  const rings = coast.map(c => walkCoast(c));
  const sites = rings.map(r => coastSites(r));
  const quota = massSize.map(() => 0);
  massSize.forEach((size, m) => {
    if (size < 3 || coast[m].length === 0) return;
    let q = Math.round(sites[m].length / SITES_PER_PORT);
    if (size >= 6) q = Math.max(q, 1);
    else q = Math.min(q, 1);
    quota[m] = Math.min(q, coast[m].length, portCap(size));
  });

  // Deal the port types round-robin over the landmasses, so each one gets a mix.
  const dealt: string[][] = massSize.map(() => []);
  const left = [...quota];
  let t = 0;
  for (;;) {
    let any = false;
    for (let m = 0; m < massSize.length; m++) {
      if (left[m] <= 0) continue;
      dealt[m].push(types[t % types.length]);
      t++;
      left[m]--;
      any = true;
    }
    if (!any) break;
  }

  const placedHex = new Set<number>();
  for (let m = 0; m < massSize.length; m++) {
    if (quota[m] <= 0) continue;
    const ring = rings[m];
    const slots = sites[m];
    const count = slots.length;
    let done = 0;
    // A port fits when no port corner touches either of its corners and no other port sits on its hex.
    const tryEdge = (c: Coast): boolean => {
      const v1 = vertices[c.edge.v1];
      const v2 = vertices[c.edge.v2];
      if (c.edge.port || v1.port || v2.port) return false;
      if (v1.adjacentVertices.some(id => vertices[id].port) || v2.adjacentVertices.some(id => vertices[id].port)) return false;
      if (placedHex.has(c.hex)) return false;
      const type = dealt[m][done];
      c.edge.port = type;
      v1.port = type;
      v2.port = type;
      placedHex.add(c.hex);
      done++;
      return true;
    };
    // Which edge a site tries first. General shapes: its first edge (its last when mirrored). Plain hexagon: the real board's choice,
    // the edge of a two-edge sea tile that is NOT next to a corner tile (a corner tile has one edge). With no corner beside it
    // (bigger hexagons) the first edge is taken, the last when mirrored. The other edge of the site is the fallback.
    const edgeOrder = (idx: number): Coast[] => {
      const site = slots[idx];
      const first = site;
      const last = [...site].reverse();
      if (!hexLayout || site.length !== 2) return flip ? last : first;
      const cornerAfter = slots[(idx + 1) % count].length === 1;
      const cornerBefore = slots[(idx - 1 + count) % count].length === 1;
      if (cornerAfter && !cornerBefore) return first;
      if (cornerBefore && !cornerAfter) return last;
      return flip ? last : first;
    };
    const trySite = (idx: number): boolean => edgeOrder(idx).some(tryEdge);
    // First pass: sites spread evenly (every second one when the coast allows), the nearest free site when one is taken.
    for (let j = 0; j < quota[m]; j++) {
      const target = Math.floor(((j + offset) * count) / quota[m]) % count;
      for (let d = 0; d < count; d++) {
        const step = d % 2 === 0 ? d / 2 : -(d + 1) / 2;
        if (trySite((((target + step) % count) + count) % count)) break;
      }
    }
    // Second pass: fill any shortfall (crowded or jagged coasts) with whatever still fits.
    for (const c of ring) {
      if (done >= quota[m]) break;
      tryEdge(c);
    }
  }
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

  if (opts.autoPorts && opts.autoPorts.length > 0 && opts.portMode === 'coast') {
    placeCoastPorts(hexes, vertices, edges, edgeMap, isLand, opts.autoPorts, opts.portOffset ?? 0, opts.portBlocked ?? (() => false), !!opts.portFlip, opts.portLayout === 'hexagon');
  } else if (opts.autoPorts && opts.autoPorts.length > 0) {
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

  // Final pass: ports only on coastal edges, and never on two adjacent hexes (coast mode allows neighbours, not two on one hex).
  const portHexGap = opts.portMode === 'coast' ? 0 : 1;
  const validPortHexes: Hex[] = [];
  edges.forEach(e => {
    if (e.hexIds.length !== 1) {
      e.port = null;
      return;
    }
    if (e.port) {
      const h = hexes[e.hexIds[0]];
      if (!h || validPortHexes.some(ph => hexDistance(h, ph) <= portHexGap)) {
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

  const board: Board = { hexes, vertices, edges, robberHexId };
  if (opts.waterEdges) {
    addWaterTopology(board, isLand, opts.portBlocked ?? (() => false));
  }
  return board;
}

/**
 * Adds vertices on water tiles and edges between pairs of adjacent water tiles so bridges can cross the sea (Tidebound).
 * Safe to call on a board that already has water edges (idempotent). Never modifies `v.hexIds` or `e.hexIds` for land/coastal
 * elements, so `v.hexIds.length > 0` still identifies land vertices and `e.hexIds.length === 0` identifies ocean edges
 * whose two bordering tiles are both water.
 */
export function addWaterTopology(
  board: Board,
  isLand: (type: string) => boolean = t => t !== 'water',
  blocked: (type: string) => boolean = () => false
): Board {
  const { hexes, vertices, edges } = board;
  const hexSize = 58;
  const isWater = (h: Hex | undefined): boolean => !!h && !isLand(h.type) && !blocked(h.type);

  const vertexMap = new Map<string, Vertex>();
  for (const v of vertices) {
    vertexMap.set(`${v.x.toFixed(1)}_${v.y.toFixed(1)}`, v);
  }
  const edgeMap = new Map<string, Edge>();
  for (const e of edges) {
    edgeMap.set(`${Math.min(e.v1, e.v2)}_${Math.max(e.v1, e.v2)}`, e);
  }

  function getOrCreateVertex(x: number, y: number): Vertex {
    const key = `${x.toFixed(1)}_${y.toFixed(1)}`;
    let v = vertexMap.get(key);
    if (!v) {
      v = { id: vertices.length, x, y, hexIds: [], adjacentVertices: [], edgeIds: [], port: null, piece: null };
      vertices.push(v);
      vertexMap.set(key, v);
    }
    return v;
  }

  function getOrCreateWaterEdge(v1: Vertex, v2: Vertex): Edge {
    const a = Math.min(v1.id, v2.id);
    const b = Math.max(v1.id, v2.id);
    const pairKey = `${a}_${b}`;
    let e = edgeMap.get(pairKey);
    if (!e) {
      const mx = (v1.x + v2.x) / 2;
      const my = (v1.y + v2.y) / 2;
      e = {
        id: edges.length,
        v1: a,
        v2: b,
        key: `${mx.toFixed(1)}_${my.toFixed(1)}`,
        hexIds: [],
        port: null,
        piece: null
      };
      edges.push(e);
      edgeMap.set(pairKey, e);
      if (!v1.adjacentVertices.includes(v2.id)) v1.adjacentVertices.push(v2.id);
      if (!v2.adjacentVertices.includes(v1.id)) v2.adjacentVertices.push(v1.id);
      if (!v1.edgeIds.includes(e.id)) v1.edgeIds.push(e.id);
      if (!v2.edgeIds.includes(e.id)) v2.edgeIds.push(e.id);
    }
    return e;
  }

  const at = new Map<string, number>();
  hexes.forEach((h, i) => at.set(`${h.q},${h.r}`, i));

  for (const h of hexes) {
    if (!isWater(h)) continue;
    if (!h.corners || h.corners.length < 6) {
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
    }
    const cornerVertices = h.corners.map(pt => getOrCreateVertex(pt.x, pt.y));
    h.vertexIds = cornerVertices.map(v => v.id);
    for (let i = 0; i < 6; i++) {
      const j = at.get(`${h.q + EDGE_DIR[i][0]},${h.r + EDGE_DIR[i][1]}`);
      if (j !== undefined && isWater(hexes[j])) {
        getOrCreateWaterEdge(cornerVertices[i], cornerVertices[(i + 1) % 6]);
      }
    }
  }

  return board;
}
