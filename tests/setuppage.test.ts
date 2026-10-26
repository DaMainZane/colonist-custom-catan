import { describe, expect, it } from 'vitest';
import { createRoom, rooms } from '../src/server/rooms';
import { makeStateBuilder } from '../src/server/view';

describe('world setup page flag', () => {
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
});
