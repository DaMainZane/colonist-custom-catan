// MODULE: socket handlers (lobby editing + game actions; every game action goes through engine dispatch) | USED BY: server/main
import type { Server } from 'socket.io';
import { AVATARS, PLAYER_COLORS } from '../shared';
import { victimsOnHex } from '../packs/base/robbing';
import { CITY, ROAD, SETTLEMENT } from '../packs/base/constants';
import { clearBotTimers, createLobbyPlayer, createRoom, freeAvatar, humanIds, addLobbyLog, rebindPlayerId, rooms } from './rooms';
import { applyMapStart, applyRecipeStyle, isPreset, mergeSettingsDetailed, paintHex, paintPort, recipeKey, recommendedRadius, refreshMap } from './lobby';
import { mapOptionsView } from './mapmenu';
import { applyLoadedPreset, loadPreset, presetStyle, serializePreset } from './presets';
import { rematch, runAction, startGame } from './game';
import { broadcastRoom } from './net';
import { registry } from './runtime';
import { DEFAULT_TIER, TAKEOVER_TIER, normalizeTier, tierLabel } from './bots/tiers';
import { reactToChat } from './bots/dialogue';
import type { Room } from './types';

const BOT_NAMES = ['Breeze', 'Sonny', 'Jess', 'TupacShakur', 'IdrisElba', 'Cleopatra', 'Napoleon'];
const ROOM_DISCONNECT_TTL_MS = 10 * 60 * 1000;

function tryReclaimSeat(room: Room, socket: any, clientId?: string, name?: string): boolean {
  room.clientTokens = room.clientTokens || {};
  room.disconnectedSeats = room.disconnectedSeats || {};
  const cleanClientId = typeof clientId === 'string' ? clientId.trim().substring(0, 64) : '';
  const cleanName = typeof name === 'string' ? name.trim().substring(0, 16) : '';

  let targetOldId: string | undefined;
  if (cleanClientId && room.clientTokens[cleanClientId]) {
    targetOldId = room.clientTokens[cleanClientId];
  }
  if (!targetOldId && cleanClientId) {
    const byToken = Object.values(room.disconnectedSeats).find(s => s.clientId === cleanClientId);
    if (byToken) targetOldId = byToken.playerId;
  }
  if (!targetOldId && cleanName) {
    const lower = cleanName.toLowerCase();
    const byName = Object.values(room.disconnectedSeats).find(s => s.originalName.toLowerCase() === lower);
    if (byName) targetOldId = byName.playerId;
  }
  if (!targetOldId) return false;

  const seatInfo = room.disconnectedSeats[targetOldId];
  const restoreName = seatInfo?.originalName || (cleanName || undefined);
  const restoreAvatar = seatInfo?.originalAvatar;
  const wasHost = seatInfo?.wasHost ?? (room.hostId === targetOldId);

  if (!rebindPlayerId(room, targetOldId, socket.id, restoreName, restoreAvatar)) {
    return false;
  }

  delete room.disconnectedSeats[targetOldId];
  if (cleanClientId) {
    room.clientTokens[cleanClientId] = socket.id;
  }
  if (wasHost || !humanIds(room).includes(room.hostId)) {
    room.hostId = socket.id;
  }
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = undefined;
  }

  socket.join(room.code);
  const p = room.game
    ? room.game.players.find(pl => pl.id === socket.id)
    : room.lobbyPlayers.find(pl => pl.id === socket.id);

  if (room.game && p) {
    room.game.log.push({ text: `🔌 ${p.name} reconnected and reclaimed their seat!`, color: p.color });
    if (room.game.log.length > 80) room.game.log.shift();
  } else if (p) {
    addLobbyLog(room, `🔌 ${p.avatar} ${p.name} reconnected to the lobby`, p.color);
  }

  socket.emit('reconnected', { code: room.code, name: p?.name || restoreName || '' });
  broadcastRoom(room);
  return true;
}

/** Once the table passes 4 and the map radius is below what that many players need, tell the lobby once per size. */
function noteCrowding(room: Room): void {
  const n = room.lobbyPlayers.length;
  const want = recommendedRadius(n);
  if (n <= 4 || room.settings.boardRadius >= want) return;
  addLobbyLog(room, `${n} players: map radius ${want}+ recommended (now ${room.settings.boardRadius}). Rules and cards tab, Map radius.`, null);
}

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket) => {
    // The map menu is drawn from the registry's options, so the client gets the list once per connection and caches it.
    socket.emit('mapOptions', mapOptionsView());

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

    socket.on('createRoom', safe(({ name, clientId }) => {
      const cleanName = String(name || '').trim().substring(0, 16);
      if (!cleanName) return socket.emit('errorMsg', 'Please enter a nickname first.');
      const room = createRoom(socket.id, cleanName);
      const cleanClientId = typeof clientId === 'string' ? clientId.trim().substring(0, 64) : '';
      if (cleanClientId) {
        room.clientTokens = room.clientTokens || {};
        room.clientTokens[cleanClientId] = socket.id;
      }
      socket.join(room.code);
      broadcastRoom(room);
    }));

    socket.on('joinRoom', safe(({ code, name, clientId }) => {
      const cleanCode = (code || '').trim().toUpperCase();
      const cleanName = String(name || '').trim().substring(0, 16);
      if (!cleanName) return socket.emit('errorMsg', 'Please enter a nickname first.');
      const cleanClientId = typeof clientId === 'string' ? clientId.trim().substring(0, 64) : '';

      // If a room code is specified (or a room has a disconnected seat matching clientId/name), try reclaiming first!
      const candidateRoom = cleanCode
        ? rooms[cleanCode]
        : Object.values(rooms).reverse().find(r =>
            (cleanClientId && (r.clientTokens?.[cleanClientId] || Object.values(r.disconnectedSeats || {}).some(s => s.clientId === cleanClientId))) ||
            (!r.game && r.lobbyPlayers.length < r.settings.maxPlayers)
          );

      if (!candidateRoom) {
        return socket.emit('errorMsg', cleanCode ? 'Room not found!' : 'No open game to join. Ask the host to create one.');
      }

      if (tryReclaimSeat(candidateRoom, socket, cleanClientId, cleanName)) {
        return;
      }

      if (candidateRoom.game) return socket.emit('errorMsg', 'Game already started!');
      if (candidateRoom.lobbyPlayers.length >= candidateRoom.settings.maxPlayers) return socket.emit('errorMsg', 'Room is full!');

      if (candidateRoom.cleanupTimer) {
        clearTimeout(candidateRoom.cleanupTimer);
        candidateRoom.cleanupTimer = undefined;
      }

      const newP = createLobbyPlayer(socket.id, cleanName, candidateRoom.lobbyPlayers.length, false);
      newP.avatar = freeAvatar(candidateRoom);
      candidateRoom.lobbyPlayers.push(newP);
      if (cleanClientId) {
        candidateRoom.clientTokens = candidateRoom.clientTokens || {};
        candidateRoom.clientTokens[cleanClientId] = socket.id;
      }
      socket.join(candidateRoom.code);
      addLobbyLog(candidateRoom, `${newP.avatar} ${cleanName} joined the lobby`, newP.color);
      noteCrowding(candidateRoom);
      broadcastRoom(candidateRoom);
    }));

    socket.on('reconnectRoom', safe(({ code, clientId, name, silent }) => {
      const cleanCode = String(code || '').trim().toUpperCase();
      const cleanClientId = typeof clientId === 'string' ? clientId.trim().substring(0, 64) : '';
      const cleanName = String(name || '').trim().substring(0, 16);

      const room = cleanCode
        ? rooms[cleanCode]
        : Object.values(rooms).reverse().find(r =>
            cleanClientId && (r.clientTokens?.[cleanClientId] || Object.values(r.disconnectedSeats || {}).some(s => s.clientId === cleanClientId))
          );

      if (!room) {
        socket.emit('reconnectFailed', { code: cleanCode });
        if (!silent) socket.emit('errorMsg', 'Previous session expired or room no longer exists.');
        return;
      }

      if (tryReclaimSeat(room, socket, cleanClientId, cleanName)) {
        return;
      }

      // If the room is still in LOBBY and has space, let them join directly if not silent
      if (!silent && !room.game && cleanName && room.lobbyPlayers.length < room.settings.maxPlayers) {
        const newP = createLobbyPlayer(socket.id, cleanName, room.lobbyPlayers.length, false);
        newP.avatar = freeAvatar(room);
        room.lobbyPlayers.push(newP);
        if (cleanClientId) {
          room.clientTokens = room.clientTokens || {};
          room.clientTokens[cleanClientId] = socket.id;
        }
        socket.join(room.code);
        addLobbyLog(room, `${newP.avatar} ${cleanName} joined the lobby`, newP.color);
        broadcastRoom(room);
        return;
      }

      socket.emit('reconnectFailed', { code: cleanCode });
      if (!silent) socket.emit('errorMsg', 'Could not find your seat in that game.');
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
      noteCrowding(room);
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
      const { settings: next, dropped } = mergeSettingsDetailed(newSettings, old);
      room.settings = next;

      // The map follows its recipe (seed, radius, picks, params, tile counts). Other settings leave painted edits alone.
      if (recipeKey(old) !== recipeKey(next)) refreshMap(room);
      if (dropped.length > 0) addLobbyLog(room, `Map code: ignored ${dropped.join(', ')} (not available here).`, null);
      broadcastRoom(room);
    }));

    // New random seed, same picks and radius. The Reroll button.
    socket.on('regenerate', safe(({ code }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      room.settings.mapSeed = '';
      refreshMap(room);
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
      applyMapStart(room, preset);
      broadcastRoom(room);
    }));

    // Custom presets live in the host's browser. The server only turns the lobby map into plain JSON (save)
    // and validates + rebuilds it (load), so a stored or edited preset can never put a bad board in a room.
    socket.on('savePreset', safe(({ code, name }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      socket.emit('presetSaved', { preset: serializePreset(room.board, room.settings, name, room.mapMeta) });
    }));

    socket.on('applyCustomPreset', safe(({ code, preset }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      const loaded = loadPreset(preset, room.settings);
      if ('error' in loaded) return socket.emit('errorMsg', loaded.error);
      // The snapshot is the map. A preset with a recipe also brings back its seed and style (presets v2).
      applyLoadedPreset(room, loaded);
      addLobbyLog(room, `Map preset "${loaded.name}" loaded`, null);
      broadcastRoom(room);
    }));

    // "New seed" on a saved preset: the same style (radius, picks, params), a fresh seed.
    socket.on('applyPresetStyle', safe(({ code, preset }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      const style = presetStyle(preset);
      if (!style) return socket.emit('errorMsg', 'That preset has no map style to reuse.');
      applyRecipeStyle(room, style);
      addLobbyLog(room, 'Map style from a preset applied with a new seed', null);
      broadcastRoom(room);
    }));

    socket.on('paintHex', safe(({ code, hexId, paintType, paintValue }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      room.board = paintHex(room.board, hexId, paintType, paintValue);
      if (room.mapMeta) room.mapMeta.edited = true;
      broadcastRoom(room);
    }));

    socket.on('paintPort', safe(({ code, edgeId, portValue }) => {
      const room = hostLobbyRoom(code);
      if (!room) return;
      room.board = paintPort(room.board, edgeId, portValue);
      if (room.mapMeta) room.mapMeta.edited = true;
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
          room.disconnectedSeats = room.disconnectedSeats || {};
          const tokenEntry = Object.entries(room.clientTokens || {}).find(([, pid]) => pid === socket.id);
          const clientId = tokenEntry?.[0];

          if (!g) {
            const lp = room.lobbyPlayers.find(p => p.id === socket.id);
            if (!lp) continue;
            room.disconnectedSeats[socket.id] = {
              playerId: socket.id,
              clientId,
              originalName: lp.name,
              originalAvatar: lp.avatar,
              wasHost: room.hostId === socket.id,
              disconnectedAt: Date.now()
            };
            const humans = humanIds(room).filter(id => id !== socket.id);
            if (humans.length === 0) {
              clearBotTimers(room);
              room.cleanupTimer = setTimeout(() => {
                if (rooms[code] && humanIds(rooms[code]).filter(id => !rooms[code].disconnectedSeats?.[id]).length === 0) {
                  clearBotTimers(rooms[code]);
                  delete rooms[code];
                }
              }, ROOM_DISCONNECT_TTL_MS);
              continue;
            }
            const idx = room.lobbyPlayers.findIndex(p => p.id === socket.id);
            if (idx !== -1) room.lobbyPlayers.splice(idx, 1);
            delete room.disconnectedSeats[socket.id];
            if (room.hostId === socket.id) room.hostId = humans[0];
            broadcastRoom(room);
            continue;
          }

          const p = g.players.find(pl => pl.id === socket.id);
          if (!p) continue;
          const cleanOriginalName = p.name.replace(/\s*\(Bot\)$/i, '');
          room.disconnectedSeats[socket.id] = {
            playerId: socket.id,
            clientId,
            originalName: cleanOriginalName,
            originalAvatar: p.avatar,
            wasHost: room.hostId === socket.id,
            disconnectedAt: Date.now()
          };
          p.isBot = true;
          p.difficulty = tierLabel(TAKEOVER_TIER);
          if (!p.name.includes('(Bot)')) p.name += ' (Bot)';
          g.log.push({ text: `🤖 ${cleanOriginalName} disconnected — a ${tierLabel(TAKEOVER_TIER)} bot took over (rejoin anytime).`, color: p.color });
          if (g.log.length > 80) g.log.shift();

          const humans = humanIds(room);
          if (humans.length === 0) {
            // Pause bot simulation while no human is connected, but keep the room alive for 10 minutes so the player can reconnect.
            clearBotTimers(room);
            room.cleanupTimer = setTimeout(() => {
              if (rooms[code] && humanIds(rooms[code]).length === 0) {
                clearBotTimers(rooms[code]);
                delete rooms[code];
              }
            }, ROOM_DISCONNECT_TTL_MS);
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
