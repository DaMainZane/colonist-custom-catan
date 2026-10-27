import { describe, expect, it } from 'vitest';
import { createRoom, humanIds, rooms } from '../src/server/rooms';
import { makeStateBuilder } from '../src/server/view';
import { startGame } from '../src/server/game';

describe('world setup page flag and spectator mode', () => {
  it('a new room starts on the setup page and the host can leave it', () => {
    const room = createRoom('host-socket', 'Host');
    try {
      expect(room.setup).toBe(true);
      expect(makeStateBuilder(room)('host-socket').setup).toBe(true);
      room.setup = false;
      expect(makeStateBuilder(room)('host-socket').setup).toBe(false);
    } finally {
      delete rooms[room.code];
    }
  });

  it('supports host spectating a bot-only game with full hand visibility', () => {
    const room = createRoom('host-socket', 'Host');
    try {
      // Host switches from lobbyPlayers to spectators while keeping hostId
      const hostSeat = room.lobbyPlayers.pop()!;
      room.spectators.push({ id: hostSeat.id, name: hostSeat.name, avatar: hostSeat.avatar });
      room.lobbyPlayers.push(
        { id: 'bot_1', name: 'Bot Alpha', color: '#e03131', avatar: 1, isBot: true, botTier: 'main' },
        { id: 'bot_2', name: 'Bot Beta', color: '#1971c2', avatar: 2, isBot: true, botTier: 'main' },
      );

      // humanIds includes spectators so broadcastRoom and bot turns keep running
      expect(humanIds(room)).toContain('host-socket');

      startGame(room, 'host-socket');
      expect(room.game).not.toBeNull();
      expect(room.setup).toBe(false);

      // Give Bot Alpha a resource card and verify spectator sees it while seated non-self would not
      room.game!.players[0].resources.wood = 3;
      const buildFor = makeStateBuilder(room);
      const specView = buildFor('host-socket') as any;
      expect(specView.isSpectator).toBe(true);
      expect(specView.spectators).toHaveLength(1);
      expect(specView.players[0].resources.wood).toBe(3);
    } finally {
      delete rooms[room.code];
    }
  });
});

