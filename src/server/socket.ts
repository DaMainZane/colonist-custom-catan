// MODULE: socket handlers (lobby editing + game actions; every game action goes through engine dispatch) | USED BY: server/main
import type { Server } from 'socket.io';
import { AVATARS, PLAYER_COLORS } from '../shared';
import { victimsOnHex } from '../packs/base/robbing';
import { CITY, ROAD, SETTLEMENT } from '../packs/base/constants';
import { clearBotTimers, createLobbyPlayer, createRoom, freeAvatar, humanIds, addLobbyLog, rooms } from './rooms';
import { newBoard, isPreset, mergeSettings, paintHex, paintPort } from './lobby';
import { loadPreset, serializePreset } from './presets';
import { rematch, runAction, startGame } from './game';
import { broadcastRoom } from './net';
import { registry } from './runtime';
import { DEFAULT_TIER, TAKEOVER_TIER, normalizeTier, tierLabel } from './bots/tiers';
import { reactToChat } from './bots/dialogue';

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
      newP.avatar = freeAvatar(room);
      room.lobbyPlayers.push(newP);
      socket.join(room.code);
      addLobbyLog(room, `${newP.avatar} ${cleanName} joined the lobby`, newP.color);
      broadcastRoom(room);
    }));

    socket.on('addBot', safe(({ code, tier }) => {
      const room = hostLobbyRoom(code);
      if (!room || room.lobbyPlayers.length >= room.settings.maxPlayers) return;
      const tierId = normalizeTier(tier) ?? DEFAULT_TIER;
      const used = new Set(room.lobbyPlayers.map(p => p.name));
      const botName = BOT_NAMES.find(n => !used.has(n)) || `Bot ${room.lobbyPlayers.length}`;
      const bot = createLobbyPlayer(`bot_${Date.now()}_${Math.random()}`, botName, room.lobbyPlayers.length, true, tierId);
      bot.avatar = freeAvatar(room);
      room.lobbyPlayers.push(bot);
      addLobbyLog(room, `🤖 ${bot.name} [${tierLabel(tierId)}] added`, bot.color);
      broadcastRoom(room);
    }));

    // The host picks a tier per bot: when adding it, or by clicking the tier tag in the player list.
    socket.on('setBotTier', safe(({ code, playerId, tier }) => {
      const room = hostLobbyRoom(code);
      const tierId = normalizeTier(tier);
      if (!room || !tierId) return;
      const bot = room.lobbyPlayers.find(p => p.id === playerId && p.isBot);
      if (!bot) return;
      bot.difficulty = tierLabel(tierId);
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
      const next = mergeSettings(newSettings, old);
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
      if (!room || room.hostId !== socket.id) return;
      const num = Number(speed);
      if (!Number.isFinite(num) || num <= 0) return;
      room.settings.gameSpeed = Math.max(0.25, Math.min(10, num));
      broadcastRoom(room);
    }));

    // Avatars: everyone picks their own; the host can also pick for bots. Each avatar is used once per lobby.
    socket.on('setAvatar', safe(({ code, playerId, avatar }) => {
      const room = rooms[code];
      if (!room || room.game || typeof avatar !== 'string' || !AVATARS.includes(avatar)) return;
      const target = room.lobbyPlayers.find(p => p.id === (playerId || socket.id));
      if (!target) return;
      if (target.id !== socket.id && !(target.isBot && room.hostId === socket.id)) return;
      if (room.lobbyPlayers.some(p => p.id !== target.id && p.avatar === avatar)) {
        return socket.emit('errorMsg', 'That avatar is already taken.');
      }
      target.avatar = avatar;
      broadcastRoom(room);
    }));

    // Lobby cursors: only the host edits, everyone else points with a cursor (Shift = laser). Relayed, never stored.
    socket.on('cursor', safe(({ code, x, y, laser, hide }) => {
      const room = rooms[code];
      if (!room || room.game || !room.lobbyPlayers.some(p => p.id === socket.id)) return;
      if (hide) {
        socket.to(room.code).volatile.emit('cursor', { id: socket.id, hide: true });
        return;
      }
      const nx = Number(x), ny = Number(y);
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
      socket.to(room.code).volatile.emit('cursor', { id: socket.id, x: nx, y: ny, laser: !!laser });
    }));

    socket.on('applyMapPreset', safe(({ code, preset }) => {
      const room = hostLobbyRoom(code);
      if (!room || !isPreset(preset)) return;
      room.board = newBoard(room.settings, preset);
      broadcastRoom(room);
    }));

    // Custom presets live in the host's browser. The server only turns the lobby map into plain JSON (save)
    // and validates + rebuilds it (load), so a stored or edited preset can never put a bad board in a room.
    socket.on('savePreset', safe(({ code, name }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      socket.emit('presetSaved', { preset: serializePreset(room.board, room.settings, name) });
    }));

    socket.on('applyCustomPreset', safe(({ code, preset }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      const loaded = loadPreset(preset, room.settings);
      if ('error' in loaded) return socket.emit('errorMsg', loaded.error);
      room.settings = loaded.settings;
      room.board = loaded.board;
      addLobbyLog(room, `Map preset "${loaded.name}" loaded`, null);
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
    socket.on('respondTrade', safe(({ code, decision, tradeId }) => act(code, 'respond_trade', { decision, tradeId }, true)));
    socket.on('counterTrade', safe(({ code, offer, request, tradeId }) => act(code, 'counter_trade', { offer, request, tradeId }, true)));
    socket.on('confirmTradeWithPartner', safe(({ code, partnerId, tradeId }) => act(code, 'confirm_trade', { partnerId, tradeId }, true)));

    socket.on('cancelTrade', safe(({ code, tradeId }) => {
      const g = rooms[code]?.game;
      const list = g?.trades ?? (g?.trade ? [g.trade] : []);
      const trade = tradeId !== undefined && tradeId !== null ? list.find(t => t.id === Number(tradeId)) : list[0];
      if (!trade) return;
      // The proposer withdraws the offer, anyone else just declines it.
      if (trade.fromId === socket.id) act(code, 'cancel_trade', { tradeId: trade.id });
      else act(code, 'respond_trade', { decision: 'declined', tradeId: trade.id });
    }));

    socket.on('sendChat', safe(({ code, text }) => {
      const room = rooms[code];
      if (!room || !text) return;
      const me = room.game ? room.game.players.find(p => p.id === socket.id) : room.lobbyPlayers.find(p => p.id === socket.id);
      if (!me) return;
      const said = String(text).trim().substring(0, 120);
      room.chats.push({ sender: me.name, avatar: me.avatar, color: me.color, text: said });
      if (room.chats.length > 60) room.chats.shift();
      reactToChat(room, socket.id, said);
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
          p.difficulty = tierLabel(TAKEOVER_TIER);
          if (!p.name.includes('(Bot)')) p.name += ' (Bot)';
          g.log.push({ text: `🤖 ${p.name} disconnected — a ${tierLabel(TAKEOVER_TIER)} bot took over.`, color: p.color });
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
