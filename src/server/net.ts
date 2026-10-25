// MODULE: socket broadcast (sends each human player their own view, clears one-shot effects, wakes the bots) | USED BY: server/socket, bots/scheduler
import type { Server } from 'socket.io';
import { humanIds } from './rooms';
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

export function broadcastRoom(room: Room): void {
  if (!room) return;
  const build = makeStateBuilder(room);
  if (io) {
    for (const id of humanIds(room)) io.to(id).emit('gameState', build(id));
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
