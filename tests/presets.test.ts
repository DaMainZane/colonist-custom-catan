import { describe, expect, it } from 'vitest';
import type { Board } from '../src/shared';
import { newBoard } from '../src/server/lobby';
import { loadPreset, serializePreset } from '../src/server/presets';
import { defaultSettings } from '../src/server/runtime';

const hexSig = (b: Board) => b.hexes.map(h => `${h.q},${h.r},${h.type},${h.number},${h.ext.hidden ? 1 : 0}`).join('|');
const portSig = (b: Board) => b.edges.filter(e => e.port).map(e => `${e.key}=${e.port}`).sort().join('|');

function ok(result: ReturnType<typeof loadPreset>) {
  if ('error' in result) throw new Error(result.error);
  return result;
}

describe('custom presets', () => {
  it('round-trips a map through JSON (tiles, numbers, fog, ports, robber, rules)', () => {
    const settings = { ...defaultSettings(), boardRadius: 3, vpToWin: 12, devKnights: 9 };
    const board = newBoard(settings, 'fogIsland');
    expect(board.hexes.some(h => h.ext.hidden)).toBe(true);

    const saved = JSON.parse(JSON.stringify(serializePreset(board, settings, '  My   island  ')));
    expect(saved.name).toBe('My island');

    const loaded = ok(loadPreset(saved, { ...defaultSettings(), maxPlayers: 6, gameSpeed: 4 }));
    expect(hexSig(loaded.board)).toBe(hexSig(board));
    expect(portSig(loaded.board)).toBe(portSig(board));
    expect(loaded.board.robberHexId).toBe(board.robberHexId);
    expect(loaded.settings.boardRadius).toBe(3);
    expect(loaded.settings.vpToWin).toBe(12);
    expect(loaded.settings.devKnights).toBe(9);
    // Seats and game speed stay with the lobby.
    expect(loaded.settings.maxPlayers).toBe(6);
    expect(loaded.settings.gameSpeed).toBe(4);
  });

  it('gives a nameless preset a default name', () => {
    const settings = defaultSettings();
    expect(serializePreset(newBoard(settings), settings, '   ').name).toBe('My map');
  });

  it('rejects broken or hostile presets', () => {
    const old = defaultSettings();
    const failing = (raw: any) => 'error' in loadPreset(raw, old);

    expect(failing(null)).toBe(true);
    expect(failing({})).toBe(true);
    expect(failing({ hexes: [] })).toBe(true);
    expect(failing({ hexes: [[0, 0, 'nope', 0, 0]] })).toBe(true);
    expect(failing({ hexes: [[0, 0, 'fog', 0, 0]] })).toBe(true);
    expect(failing({ hexes: [[0, 0, 'wood', 6, 0], [0, 0, 'brick', 5, 0]] })).toBe(true);
    expect(failing({ hexes: [[0.5, 0, 'wood', 6, 0]] })).toBe(true);
    expect(failing({ hexes: [[999, 0, 'wood', 6, 0]] })).toBe(true);
    expect(failing({ hexes: [[0, 0, 'wood', 13, 0]] })).toBe(true);
    expect(failing({ hexes: [[0, 0, 'water', 0, 0]] })).toBe(true);
  });

  it('ignores unknown ports, out-of-range settings and flags on tiles that cannot hide', () => {
    const old = defaultSettings();
    const loaded = ok(loadPreset({
      name: 'odd',
      hexes: [[0, 0, 'wood', 6, 1], [1, 0, 'desert', 0, 1], [0, 1, 'water', 0, 1]],
      ports: { '0,0': 'not-a-port' },
      settings: { vpToWin: 9999, boardRadius: 'big', maxPlayers: 8 }
    }, old));

    expect(loaded.board.hexes[0].ext.hidden).toBe(true);
    expect(loaded.board.hexes[1].ext.hidden).toBeUndefined();
    expect(loaded.board.hexes[2].ext.hidden).toBeUndefined();
    expect(loaded.board.edges.some(e => e.port)).toBe(false);
    expect(loaded.settings.vpToWin).toBe(50);
    expect(loaded.settings.boardRadius).toBe(old.boardRadius);
    expect(loaded.settings.maxPlayers).toBe(old.maxPlayers);
    // The robber never starts on a hidden tile.
    expect(loaded.board.hexes[loaded.board.robberHexId].ext.hidden).toBeUndefined();
  });
});
