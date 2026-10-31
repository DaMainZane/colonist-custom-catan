// MODULE: socket broadcast (sends each human player their own view, clears one-shot effects, wakes the bots) | DEPENDS ON: server/mapmenu, server/rooms, server/runtime, server/types, server/view | USED BY: server/bots/scheduler, server/main, server/socket
import type { Server } from 'socket.io';
import { humanIds } from './rooms';
import { mapOptionsForSettings } from './mapmenu';
import { mapRegistryKey } from './runtime';
import type { Room } from './types';
import { makeStateBuilder } from './view';

let io: Server | undefined;
let afterBroadcast: ((room: Room) => void) | null = null;

export function setIo(server: Server): void {
  io = server;
}

/** Called after every broadcast (the bot scheduler registers here, which avoids an import cycle). */
export function setAfterBroadcast(fn: (room: Room) => void): void {
  afterBroadcast = fn;
}

/**
 * The map menu lists a room's options, and an addon's perk exists only while its DLC and addon are on. So in the lobby each socket is
 * sent the list for the room's addon set whenever that set differs from the one it last got (a join, a reconnect, a DLC or addon toggle,
 * a scenario or a preset). A new connection starts with the plain list (key ''), sent once by `registerSocketHandlers`.
 */
function syncMapOptions(socketId: string, room: Room, key: string): void {
  const sock = io?.sockets.sockets.get(socketId);
  if (!sock || sock.data.mapOptionsKey === key) return;
  sock.data.mapOptionsKey = key;
  sock.emit('mapOptions', mapOptionsForSettings(room.settings));
}

export function broadcastRoom(room: Room): void {
  if (!room) return;
  const build = makeStateBuilder(room);
  if (io) {
    const optionsKey = room.game ? null : mapRegistryKey(room.settings);
    for (const id of humanIds(room)) {
      if (optionsKey !== null) syncMapOptions(id, room, optionsKey);
      io.to(id).emit('gameState', build(id));
    }
  }
  const animDelayMs = room.fx.animDelayMs || 0;
  if (animDelayMs > 0) {
    room.animatingUntil = Math.max(room.animatingUntil || 0, Date.now() + animDelayMs);
  }
  room.fx.recentProductions = [];
  room.fx.recentTransfers = [];
  room.fx.animDelayMs = 0;
  if (afterBroadcast) afterBroadcast(room);
}
