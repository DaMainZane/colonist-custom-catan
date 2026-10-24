// MODULE: socket handlers (lobby editing + game actions; every game action goes through engine dispatch) | USED BY: server/main
import type { Server } from 'socket.io';
import { PLAYER_COLORS } from '../shared';
import { victimsOnHex } from '../packs/base/robbing';
import { CITY, ROAD, SETTLEMENT } from '../packs/base/constants';
import { clearBotTimers, createLobbyPlayer, createRoom, humanIds, addLobbyLog, rooms } from './rooms';
import { newBoard, isPreset, paintHex, paintPort } from './lobby';
import { rematch, runAction, startGame } from './game';
import { broadcastRoom } from './net';
import { registry } from './runtime';
import type { Settings } from './types';
import { clamp } from './util';

const BOT_NAMES = ['Breeze', 'Sonny', 'Jess', 'TupacShakur', 'IdrisElba', 'Cleopatra', 'Napoleon'];

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket) => {
    const safe = (fn: (data: any) => void) => (data: any = {}) => {
      try { fn(data); } catch (err) { console.error('Socket handler error:', err); }
    };

    /**
     * Runs one engine action for this socket's player and broadcasts the result.
     * `report` sends the engine's reason back to the player (used where the old server did too).
     */
    const act = (code: string, type: string, payload: any = {}, report = false): void => {
      const room = rooms[code];
      if (!room || !room.game) return;
      const res = runAction(room, socket.id, type, payload);
      if (!res.ok) {
        if (report) socket.emit('errorMsg', res.error);
        return;
      }
      broadcastRoom(room);
    };

    const hostLobbyRoom = (code: string) => {
      const room = rooms[code];
      return room && room.hostId === socket.id && !room.game ? room : null;
    };

    // ---- Lobby ------------------------------------------------------------

    socket.on('createRoom', safe(({ name }) => {
      const cleanName = (name || 'Settler').trim().substring(0, 16);
      const room = createRoom(socket.id, cleanName);
      socket.join(room.code);
      broadcastRoom(room);
    }));

    socket.on('joinRoom', safe(({ code, name }) => {
      const cleanCode = (code || '').trim().toUpperCase();
      const cleanName = (name || 'Settler').trim().substring(0, 16);
      // No code (the normal case for a private group): take the newest lobby that still has a seat.
      const room = cleanCode
        ? rooms[cleanCode]
        : Object.values(rooms).reverse().find(r => !r.game && r.lobbyPlayers.length < r.settings.maxPlayers);
      if (!room) return socket.emit('errorMsg', cleanCode ? 'Room not found!' : 'No open game to join. Ask the host to create one.');
      if (room.game) return socket.emit('errorMsg', 'Game already started!');
      if (room.lobbyPlayers.length >= room.settings.maxPlayers) return socket.emit('errorMsg', 'Room is full!');

      const newP = createLobbyPlayer(socket.id, cleanName, room.lobbyPlayers.length, false);
      room.lobbyPlayers.push(newP);
      socket.join(room.code);
      addLobbyLog(room, `${newP.avatar} ${cleanName} joined the lobby`, newP.color);
      broadcastRoom(room);
    }));

    socket.on('addBot', safe(({ code }) => {
      const room = hostLobbyRoom(code);
      if (!room || room.lobbyPlayers.length >= room.settings.maxPlayers) return;
      const used = new Set(room.lobbyPlayers.map(p => p.name));
      const botName = BOT_NAMES.find(n => !used.has(n)) || `Bot ${room.lobbyPlayers.length}`;
      const bot = createLobbyPlayer(`bot_${Date.now()}_${Math.random()}`, botName, room.lobbyPlayers.length, true);
      room.lobbyPlayers.push(bot);
      addLobbyLog(room, `🤖 ${bot.name} [ADVANCED HARD] added`, bot.color);
      broadcastRoom(room);
    }));

    socket.on('removeBot', safe(({ code }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      const idx = room.lobbyPlayers.findLastIndex(p => p.isBot);
      if (idx !== -1) {
        room.lobbyPlayers.splice(idx, 1);
        broadcastRoom(room);
      }
    }));

    socket.on('updateSettings', safe(({ code, newSettings }) => {
      const room = hostLobbyRoom(code);
      if (!room || !newSettings) return;
      const old = room.settings;
      const speed = Number(newSettings.gameSpeed);
      const gameSpeed = Number.isFinite(speed) && speed > 0 ? Math.max(0.25, Math.min(10, speed)) : (old.gameSpeed ?? 1);

      const next: Settings = {
        boardRadius: clamp(newSettings.boardRadius, 1, 50, old.boardRadius),
        goldTiles: clamp(newSettings.goldTiles, 0, 500, old.goldTiles),
        desertTiles: clamp(newSettings.desertTiles, 0, 200, old.desertTiles),
        fogTiles: clamp(newSettings.fogTiles, 0, 2000, old.fogTiles ?? 0),
        vpToWin: clamp(newSettings.vpToWin, 3, 50, old.vpToWin),
        maxPlayers: clamp(newSettings.maxPlayers, 2, 8, old.maxPlayers),
        cardDiscardLimit: clamp(newSettings.cardDiscardLimit, 3, 50, old.cardDiscardLimit),
        bankResourcePerType: clamp(newSettings.bankResourcePerType, 5, 999, old.bankResourcePerType),
        devKnights: clamp(newSettings.devKnights, 0, 100, old.devKnights),
        devVp: clamp(newSettings.devVp, 0, 50, old.devVp),
        devRoadBuilding: clamp(newSettings.devRoadBuilding, 0, 50, old.devRoadBuilding),
        devYearOfPlenty: clamp(newSettings.devYearOfPlenty, 0, 50, old.devYearOfPlenty),
        devMonopoly: clamp(newSettings.devMonopoly, 0, 50, old.devMonopoly),
        maxSettlements: clamp(newSettings.maxSettlements, 2, 20, old.maxSettlements),
        maxCities: clamp(newSettings.maxCities, 1, 20, old.maxCities),
        maxRoads: clamp(newSettings.maxRoads, 5, 50, old.maxRoads),
        gameSpeed
      };
      room.settings = next;

      const boardChanged =
        old.boardRadius !== next.boardRadius ||
        old.goldTiles !== next.goldTiles ||
        old.desertTiles !== next.desertTiles ||
        (old.fogTiles ?? 0) !== (next.fogTiles ?? 0);
      if (boardChanged) room.board = newBoard(next);
      broadcastRoom(room);
    }));

    socket.on('setGameSpeed', safe(({ code, speed }) => {
      const room = rooms[code];
      if (!room) return;
      const num = Number(speed);
      if (!Number.isFinite(num) || num <= 0) return;
      room.settings.gameSpeed = Math.max(0.25, Math.min(10, num));
      broadcastRoom(room);
    }));

    socket.on('applyMapPreset', safe(({ code, preset }) => {
      const room = hostLobbyRoom(code);
      if (!room || !isPreset(preset)) return;
      room.board = newBoard(room.settings, preset);
      broadcastRoom(room);
    }));

    socket.on('paintHex', safe(({ code, hexId, paintType, paintValue }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      room.board = paintHex(room.board, hexId, paintType, paintValue);
      broadcastRoom(room);
    }));

    socket.on('paintPort', safe(({ code, edgeId, portValue }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      room.board = paintPort(room.board, edgeId, portValue);
      broadcastRoom(room);
    }));

    socket.on('startGame', safe(({ code }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      const error = startGame(room);
      if (error) return socket.emit('errorMsg', error);
      broadcastRoom(room);
    }));

    socket.on('rematchLobby', safe(({ code }) => {
      const room = rooms[code];
      if (!room) return;
      rematch(room);
      broadcastRoom(room);
    }));

    // ---- Board clicks -------------------------------------------------------

    socket.on('clickVertex', safe(({ code, vertexId }) => {
      const g = rooms[code]?.game;
      if (!g) return;
      const v = g.board.vertices[vertexId];
      if (!v) return;

      if (g.phase === 'robber_steal' && v.piece && victimsOnHex(g, g.board.robberHexId, socket.id).includes(v.piece.owner)) {
        return act(code, 'steal', { victimId: v.piece.owner });
      }
      if (v.piece && v.piece.owner === socket.id && v.piece.type === SETTLEMENT) {
        return act(code, 'build', { piece: CITY, loc: vertexId });
      }
      if (!v.piece) act(code, 'build', { piece: SETTLEMENT, loc: vertexId });
    }));

    socket.on('clickEdge', safe(({ code, edgeId }) => act(code, 'build', { piece: ROAD, loc: edgeId })));
    socket.on('clickHex', safe(({ code, hexId }) => act(code, 'move_robber', { hexId })));
    socket.on('stealFromPlayer', safe(({ code, victimId }) => act(code, 'steal', { victimId })));

    // ---- Turn actions ---------------------------------------------------------

    socket.on('rollDice', safe(({ code }) => act(code, 'roll')));
    socket.on('endTurn', safe(({ code }) => act(code, 'end_turn')));
    socket.on('buyDevCard', safe(({ code }) => act(code, 'buy_dev')));
    socket.on('pickGoldResource', safe(({ code, resource }) => act(code, 'pick', { resource }, true)));
    socket.on('discardCards', safe(({ code, discards }) => act(code, 'discard', { cards: discards })));

    socket.on('playDevCard', safe(({ code, cardType, monopolyResource }) => {
      act(code, 'play_dev', { card: cardType, resource: monopolyResource });
    }));

    socket.on('bankTrade', safe(({ code, give, get }) => act(code, 'bank_trade', { give, get }, true)));
    socket.on('proposeTrade', safe(({ code, offer, request }) => act(code, 'propose_trade', { offer, request }, true)));
    socket.on('respondTrade', safe(({ code, decision }) => act(code, 'respond_trade', { decision }, true)));
    socket.on('confirmTradeWithPartner', safe(({ code, partnerId }) => act(code, 'confirm_trade', { partnerId }, true)));

    socket.on('cancelTrade', safe(({ code }) => {
      const trade = rooms[code]?.game?.trade;
      if (!trade) return;
      // The proposer withdraws the offer, anyone else just declines it.
      if (trade.fromId === socket.id) act(code, 'cancel_trade');
      else act(code, 'respond_trade', { decision: 'declined' });
    }));

    socket.on('sendChat', safe(({ code, text }) => {
      const room = rooms[code];
      if (!room || !text) return;
      const me = room.game ? room.game.players.find(p => p.id === socket.id) : room.lobbyPlayers.find(p => p.id === socket.id);
      if (!me) return;
      room.chats.push({ sender: me.name, avatar: me.avatar, color: me.color, text: String(text).trim().substring(0, 120) });
      if (room.chats.length > 60) room.chats.shift();
      broadcastRoom(room);
    }));

    // ---- Disconnect ---------------------------------------------------------------

    socket.on('disconnect', () => {
      try {
        for (const code of Object.keys(rooms)) {
          const room = rooms[code];
          const g = room.game;

          if (!g) {
            const idx = room.lobbyPlayers.findIndex(p => p.id === socket.id);
            if (idx === -1) continue;
            room.lobbyPlayers.splice(idx, 1);
            if (humanIds(room).length === 0) {
              clearBotTimers(room);
              delete rooms[code];
              continue;
            }
            if (room.hostId === socket.id) room.hostId = humanIds(room)[0];
            broadcastRoom(room);
            continue;
          }

          const p = g.players.find(pl => pl.id === socket.id);
          if (!p) continue;
          p.isBot = true;
          p.difficulty = 'ADVANCED HARD';
          if (!p.name.includes('(Bot)')) p.name += ' (Bot)';
          g.log.push({ text: `🤖 ${p.name} disconnected — Hard Bot took over.`, color: p.color });
          if (g.log.length > 80) g.log.shift();

          const humans = humanIds(room);
          if (humans.length === 0) {
            // Nobody can ever rejoin (identity is the socket id until Step 3), so stop simulating.
            clearBotTimers(room);
            delete rooms[code];
            continue;
          }
          if (room.hostId === socket.id) room.hostId = humans[0];
          broadcastRoom(room);
        }
      } catch (e) { console.error(e); }
    });
  });
}

// Used by tests/sim to confirm the registry and the client-visible colours stay in sync.
export const SEAT_COLORS = PLAYER_COLORS;
export const KNOWN_TILE_IDS = (): string[] => [...registry.tiles.keys()];
