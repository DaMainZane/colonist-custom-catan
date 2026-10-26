import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/shared';
import type { Board } from '../src/shared';
import { defaultSettings, fullRules, registry } from '../src/server/runtime';

const rulesFor = (over: Record<string, any> = {}) => fullRules({ ...defaultSettings(), ...over });
const hexagon = (seed: string, radius: number): Board => generateMap(registry, rulesFor({ boardRadius: radius }), { seed }).board;

type Edge = Board['edges'][number];

/** Coast edges in ring order around the center. A full hexagon is convex, so sorting by angle walks the coast. */
function ring(b: Board): { e: Edge; x: number; y: number }[] {
  return b.edges
    .filter(e => e.hexIds.length === 1)
    .map(e => {
      const a = b.vertices[e.v1];
      const c = b.vertices[e.v2];
      return { e, x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    })
    .sort((p, q) => Math.atan2(p.y, p.x) - Math.atan2(q.y, q.x));
}

/** Each port with the number of coast edges between it and the previous / next port. */
function portInfo(b: Board) {
  const r = ring(b);
  const n = r.length;
  const at = r.map((c, i) => (c.e.port ? i : -1)).filter(i => i >= 0);
  return at.map((i, k) => {
    const prev = at[(k + at.length - 1) % at.length];
    const next = at[(k + 1) % at.length];
    return { cell: r[i], ring: r, before: (i - prev - 1 + n) % n, after: (next - i - 1 + n) % n };
  });
}

/** True when the port sits on the outward edge of one of the six corner hexes of a hexagon of this radius. */
function onCornerOutwardEdge(b: Board, radius: number, info: ReturnType<typeof portInfo>[number]): boolean {
  const h = b.hexes[info.cell.e.hexIds[0]];
  const abs = [Math.abs(h.q), Math.abs(h.r), Math.abs(-h.q - h.r)];
  if (abs.filter(v => v === radius).length !== 2) return false;
  const mine = info.ring.filter(c => c.e.hexIds[0] === h.id);
  const farthest = Math.max(...mine.map(c => Math.hypot(c.x, c.y)));
  return Math.abs(Math.hypot(info.cell.x, info.cell.y) - farthest) < 1e-6;
}

describe('plain hexagon ports follow the real board', () => {
  it('standard board: 9 ports, six gaps of 2 and three of 3, spread 2-2-3', () => {
    for (let i = 0; i < 60; i++) {
      const gaps = portInfo(hexagon(`P${i}`, 2)).map(p => p.after);
      expect(gaps).toHaveLength(9);
      expect([...gaps].sort((a, b) => a - b)).toEqual([2, 2, 2, 2, 2, 2, 3, 3, 3]);
      // Start after a 3: the real board repeats 3, 2, 2 around the island.
      const from = gaps.indexOf(3);
      const turned = gaps.map((_, k) => gaps[(from + k) % gaps.length]);
      expect(turned).toEqual([3, 2, 2, 3, 2, 2, 3, 2, 2]);
    }
  });

  it('standard board: the three harbors on a corner of the island have a gap of 2 on both sides', () => {
    for (let i = 0; i < 60; i++) {
      const b = hexagon(`C${i}`, 2);
      const corner = portInfo(b).filter(p => onCornerOutwardEdge(b, 2, p));
      expect(corner).toHaveLength(3);
      for (const p of corner) {
        expect(p.before).toBe(2);
        expect(p.after).toBe(2);
      }
    }
  });

  it('bigger hexagons: 3 (R + 1) ports with gaps of 2 or 3', () => {
    for (const radius of [3, 4]) {
      for (let i = 0; i < 30; i++) {
        const info = portInfo(hexagon(`B${radius}-${i}`, radius));
        expect(info).toHaveLength(3 * (radius + 1));
        for (const p of info) {
          expect(p.after).toBeGreaterThanOrEqual(2);
          expect(p.after).toBeLessThanOrEqual(3);
        }
      }
    }
  });
});

describe('other shapes keep the general port placement', () => {
  it('a continent still gets ports, never two on one hex and never on touching vertices', () => {
    for (let i = 0; i < 12; i++) {
      const { board } = generateMap(registry, rulesFor({ boardRadius: 4 }), { seed: `K${i}`, picks: ['continent'] });
      const ports = board.edges.filter(e => e.port);
      expect(ports.length).toBeGreaterThan(0);
      expect(new Set(ports.map(e => e.hexIds[0])).size).toBe(ports.length);
      expect(new Set(ports.flatMap(e => [e.v1, e.v2])).size).toBe(ports.length * 2);
      for (const e of ports) {
        for (const v of [e.v1, e.v2]) {
          for (const adj of board.vertices[v].adjacentVertices) {
            if (adj === e.v1 || adj === e.v2) continue;
            expect(board.vertices[adj].port).toBeNull();
          }
        }
      }
    }
  });
});
