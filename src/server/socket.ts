import type { Server } from 'socket.io';
import {
  executeTradeBetweenPlayers,
  handleEndTurn,
  handleMoveRobber,
  handlePlaceCity,
  handlePlaceRoad,
  handlePlaceSettlement,
  handleRollDice,
  handleStealFromVictim
} from './actions';
import { PLAYER_COLORS, RESOURCES } from './constants';
import { broadcastRoom } from './net';
import { addLog, createDevDeck, createPlayer, createRoom, rooms } from './rooms';
import {
  checkGoldPhaseTransition,
  checkWinner,
  getBankRemaining,
  getTradeRatios,
  givePlayerResourceFromBank,
  updateLargestArmy
} from './rules';
import { generateBoard, hexDistance, rebuildBoardTopology } from './topology';
import { clamp, shuffle } from './util';

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket) => {
    const safe = (fn: (data: any) => void) => (data: any = {}) => {
      try { fn(data); } catch (err) { console.error('Socket handler error:', err); }
    };

    socket.on('createRoom', safe(({ name }) => {
      const cleanName = (name || 'Settler').trim().substring(0, 16);
      const room = createRoom(socket.id, cleanName);
      socket.join(room.code);
      broadcastRoom(room);
    }));

    socket.on('joinRoom', safe(({ code, name }) => {
      const cleanCode = (code || '').trim().toUpperCase();
      const cleanName = (name || 'Settler').trim().substring(0, 16);
      const room = rooms[cleanCode];
      if (!room) return socket.emit('errorMsg', 'Room not found!');
      if (room.status !== 'LOBBY') return socket.emit('errorMsg', 'Game already started!');
      if (room.players.length >= room.settings.maxPlayers) return socket.emit('errorMsg', 'Room is full!');

      const newP = createPlayer(socket.id, cleanName, room.players.length, false);
      room.players.push(newP);
      socket.join(room.code);
      addLog(room, `${newP.avatar} ${cleanName} joined the lobby`, newP.color);
      broadcastRoom(room);
    }));

    socket.on('addBot', safe(({ code }) => {
      const room = rooms[code];
      if (!room || room.hostId !== socket.id || room.status !== 'LOBBY') return;
      if (room.players.length >= room.settings.maxPlayers) return;
      const botNames = ['Breeze', 'Sonny', 'Jess', 'TupacShakur', 'IdrisElba', 'Cleopatra', 'Napoleon'];
      const used = new Set(room.players.map(p => p.name));
      const botName = botNames.find(n => !used.has(n)) || `Bot ${room.players.length}`;
      const bot = createPlayer(`bot_${Date.now()}_${Math.random()}`, botName, room.players.length, true);
      room.players.push(bot);
      addLog(room, `🤖 ${bot.name} [ADVANCED HARD] added`, bot.color);
      broadcastRoom(room);
    }));

    socket.on('removeBot', safe(({ code }) => {
      const room = rooms[code];
      if (!room || room.hostId !== socket.id || room.status !== 'LOBBY') return;
      const idx = room.players.findLastIndex(p => p.isBot);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        broadcastRoom(room);
      }
    }));

    socket.on('updateSettings', safe(({ code, newSettings }) => {
      const room = rooms[code];
      if (!room || room.hostId !== socket.id || room.status !== 'LOBBY' || !newSettings) return;
      const oldRadius = room.settings.boardRadius;
      const oldGold = room.settings.goldTiles;
      const oldDesert = room.settings.desertTiles;
      const oldFog = room.settings.fogTiles ?? 0;

      room.settings = {
        boardRadius: clamp(newSettings.boardRadius, 1, 50, room.settings.boardRadius),
        goldTiles: clamp(newSettings.goldTiles, 0, 500, room.settings.goldTiles),
        desertTiles: clamp(newSettings.desertTiles, 0, 200, room.settings.desertTiles),
        fogTiles: clamp(newSettings.fogTiles, 0, 2000, room.settings.fogTiles ?? 0),
        vpToWin: clamp(newSettings.vpToWin, 3, 50, room.settings.vpToWin),
        maxPlayers: clamp(newSettings.maxPlayers, 2, 8, room.settings.maxPlayers),
        cardDiscardLimit: clamp(newSettings.cardDiscardLimit, 3, 50, room.settings.cardDiscardLimit),
        bankResourcePerType: clamp(newSettings.bankResourcePerType, 5, 999, room.settings.bankResourcePerType),
        devKnights: clamp(newSettings.devKnights, 0, 100, room.settings.devKnights),
        devVp: clamp(newSettings.devVp, 0, 50, room.settings.devVp),
        devRoadBuilding: clamp(newSettings.devRoadBuilding, 0, 50, room.settings.devRoadBuilding),
        devYearOfPlenty: clamp(newSettings.devYearOfPlenty, 0, 50, room.settings.devYearOfPlenty),
        devMonopoly: clamp(newSettings.devMonopoly, 0, 50, room.settings.devMonopoly),
        maxSettlements: clamp(newSettings.maxSettlements, 2, 20, room.settings.maxSettlements),
        maxCities: clamp(newSettings.maxCities, 1, 20, room.settings.maxCities),
        maxRoads: clamp(newSettings.maxRoads, 5, 50, room.settings.maxRoads)
      };

      room.devDeck = createDevDeck(room.settings);

      if (
        oldRadius !== room.settings.boardRadius ||
        oldGold !== room.settings.goldTiles ||
        oldDesert !== room.settings.desertTiles ||
        oldFog !== (room.settings.fogTiles ?? 0)
      ) {
        room.board = generateBoard(room.settings);
      }
      broadcastRoom(room);
    }));

    socket.on('applyMapPreset', safe(({ code, preset }) => {
      const room = rooms[code];
      if (!room || room.hostId !== socket.id || room.status !== 'LOBBY') return;
      room.board = generateBoard(room.settings, preset);
      broadcastRoom(room);
    }));

    socket.on('paintHex', safe(({ code, hexId, paintType, paintValue }) => {
      const room = rooms[code];
      if (!room || room.hostId !== socket.id || room.status !== 'LOBBY') return;
      const hex = room.board.hexes[hexId];
      if (!hex) return;

      const existingPorts: Record<string, string> = {};
      room.board.edges.forEach(e => { if (e.port) existingPorts[e.key] = e.port; });

      if (paintType === 'terrain') {
        if (paintValue === 'fog') {
          if (hex.type === 'water' || hex.type === 'desert' || !hex.type || hex.type === 'fog') {
            hex.type = RESOURCES[Math.floor(Math.random() * RESOURCES.length)];
          }
          if (!hex.number) {
            const nums = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
            hex.number = nums[Math.floor(Math.random() * nums.length)];
          }
          hex.fog = true;
        } else {
          hex.fog = false;
          hex.type = paintValue;
          if (paintValue === 'desert' || paintValue === 'water') hex.number = null;
          else if (!hex.number) hex.number = 6;
        }
        room.board = rebuildBoardTopology(room.board.hexes, existingPorts, false);
      } else if (paintType === 'number') {
        if (hex.type !== 'water' && hex.type !== 'desert') {
          hex.number = paintValue === 'none' ? null : Number(paintValue);
        }
      } else if (paintType === 'robber') {
        if (hex.type !== 'water' && !hex.fog) room.board.robberHexId = hex.id;
      }
      broadcastRoom(room);
    }));

    socket.on('paintPort', safe(({ code, edgeId, portValue }) => {
      const room = rooms[code];
      if (!room || room.hostId !== socket.id || room.status !== 'LOBBY') return;
      const edge = room.board.edges[edgeId];
      if (!edge || edge.hexIds.length !== 1) return;

      const targetHex = room.board.hexes[edge.hexIds[0]];
      const existingPorts: Record<string, string> = {};
      room.board.edges.forEach(e => {
        if (!e.port) return;
        if (portValue !== 'none' && targetHex && e.id !== edge.id && e.hexIds.length === 1) {
          const otherHex = room.board.hexes[e.hexIds[0]];
          if (otherHex && hexDistance(targetHex, otherHex) <= 1) return;
        }
        existingPorts[e.key] = e.port;
      });
      if (portValue === 'none') delete existingPorts[edge.key];
      else existingPorts[edge.key] = portValue;

      room.board = rebuildBoardTopology(room.board.hexes, existingPorts, false);
      broadcastRoom(room);
    }));

    socket.on('startGame', safe(({ code }) => {
      const room = rooms[code];
      if (!room || room.hostId !== socket.id || room.status !== 'LOBBY') return;
      if (room.players.length < 2) return socket.emit('errorMsg', 'Add at least 1 Bot or wait for a 2nd player!');
      if (room.board.vertices.length < room.players.length * 4) {
        return socket.emit('errorMsg', 'Map needs more land tiles for this player count!');
      }

      room.players = shuffle(room.players);
      room.players.forEach((p, idx) => {
        p.color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
        p.settlementsLeft = room.settings.maxSettlements;
        p.citiesLeft = room.settings.maxCities;
        p.roadsLeft = room.settings.maxRoads;
      });

      room.status = 'SETUP';
      room.devDeck = createDevDeck(room.settings);

      const n = room.players.length;
      const forward = Array.from({ length: n }, (_, i) => i);
      room.setupOrder = [...forward, ...[...forward].reverse()];
      room.setupStep = 0;
      room.turnIndex = room.setupOrder[0];
      room.phase = 'SETUP_SETTLEMENT';

      const firstPlayer = room.players[0];
      addLog(room, `🎲 Turn order randomized! ${firstPlayer.avatar} ${firstPlayer.name} goes first!`, firstPlayer.color);
      broadcastRoom(room);
    }));

    socket.on('clickVertex', safe(({ code, vertexId }) => {
      const room = rooms[code];
      if (!room) return;
      const player = room.players[room.turnIndex];
      if (!player || player.id !== socket.id) return;
      const v = room.board.vertices[vertexId];
      if (!v) return;

      if (room.phase === 'ROBBER_STEAL' && v.building && (room.robberVictims || []).includes(v.building.owner)) {
        handleStealFromVictim(room, player, v.building.owner);
        return;
      }

      if (v.building && v.building.owner === player.id && v.building.type === 'settlement') {
        handlePlaceCity(room, player, vertexId);
      } else if (!v.building) {
        handlePlaceSettlement(room, player, vertexId);
      }
    }));

    socket.on('stealFromPlayer', safe(({ code, victimId }) => {
      const room = rooms[code];
      if (!room) return;
      const player = room.players[room.turnIndex];
      if (!player || player.id !== socket.id) return;
      handleStealFromVictim(room, player, victimId);
    }));

    socket.on('clickEdge', safe(({ code, edgeId }) => {
      const room = rooms[code];
      if (!room) return;
      const player = room.players[room.turnIndex];
      if (!player || player.id !== socket.id) return;
      handlePlaceRoad(room, player, edgeId);
    }));

    socket.on('clickHex', safe(({ code, hexId }) => {
      const room = rooms[code];
      if (!room) return;
      const player = room.players[room.turnIndex];
      if (!player || player.id !== socket.id) return;
      handleMoveRobber(room, player, hexId);
    }));

    socket.on('rollDice', safe(({ code }) => {
      const room = rooms[code];
      if (!room) return;
      const player = room.players[room.turnIndex];
      if (!player || player.id !== socket.id) return;
      handleRollDice(room, player);
    }));

    socket.on('pickGoldResource', safe(({ code, resource }) => {
      const room = rooms[code];
      if (!room || !RESOURCES.includes(resource)) return;
      const player = room.players.find(p => p.id === socket.id);
      if (!player || player.goldPending <= 0) return;

      const granted = givePlayerResourceFromBank(room, player, resource, 1);
      if (granted === 0) return socket.emit('errorMsg', `Bank is out of ${resource.toUpperCase()}!`);
      player.goldPending--;
      addLog(room, `${player.avatar} ${player.name} picked ${resource} from Gold`, player.color);
      checkGoldPhaseTransition(room);
      broadcastRoom(room);
    }));

    socket.on('discardCards', safe(({ code, discards }) => {
      const room = rooms[code];
      if (!room || room.phase !== 'DISCARD' || !discards) return;
      const player = room.players.find(p => p.id === socket.id);
      if (!player || player.discardPending <= 0) return;

      let count = 0;
      for (const r of RESOURCES) {
        const amt = Number(discards[r]) || 0;
        if (amt < 0 || amt > player.resources[r]) return;
        count += amt;
      }
      if (count !== player.discardPending) return;

      for (const r of RESOURCES) player.resources[r] -= Number(discards[r]) || 0;
      player.discardPending = 0;
      addLog(room, `${player.avatar} ${player.name} discarded ${count} cards`, player.color);

      if (room.players.every(p => p.discardPending === 0)) room.phase = 'ROBBER';
      broadcastRoom(room);
    }));

    socket.on('buyDevCard', safe(({ code }) => {
      const room = rooms[code];
      if (!room || room.phase !== 'MAIN') return;
      const player = room.players[room.turnIndex];
      if (!player || player.id !== socket.id || room.devDeck.length === 0) return;
      if (player.resources.sheep < 1 || player.resources.wheat < 1 || player.resources.ore < 1) return;

      player.resources.sheep--; player.resources.wheat--; player.resources.ore--;
      player.newDevCards.push(room.devDeck.pop());
      addLog(room, `${player.avatar} ${player.name} bought a Development Card`, player.color);
      checkWinner(room);
      broadcastRoom(room);
    }));

    socket.on('playDevCard', safe(({ code, cardType, monopolyResource }) => {
      const room = rooms[code];
      if (!room || (room.phase !== 'MAIN' && room.phase !== 'ROLL')) return;
      const player = room.players[room.turnIndex];
      if (!player || player.id !== socket.id || player.playedDevCardThisTurn) return;

      const idx = player.devCards.indexOf(cardType);
      if (idx === -1) return;

      player.devCards.splice(idx, 1);
      player.playedDevCardThisTurn = true;

      if (cardType === 'knight') {
        player.knightsPlayed++;
        addLog(room, `${player.avatar} ${player.name} played a Knight`, player.color);
        updateLargestArmy(room);
        checkWinner(room);
        room.PreRobberPhase = room.phase;
        room.phase = 'ROBBER';
      } else if (cardType === 'roadBuilding') {
        player.freeRoads += 2;
        addLog(room, `${player.avatar} ${player.name} played Road Building (+2 free roads)`, player.color);
      } else if (cardType === 'yearOfPlenty') {
        player.goldPending += 2;
        room.PreGoldPhase = room.phase;
        room.phase = 'GOLD_PICK';
        checkGoldPhaseTransition(room);
        addLog(room, `${player.avatar} ${player.name} played Year of Plenty (+2 picks)`, player.color);
      } else if (cardType === 'monopoly' && RESOURCES.includes(monopolyResource)) {
        let stolen = 0;
        for (const other of room.players) {
          if (other.id !== player.id) {
            stolen += other.resources[monopolyResource] || 0;
            other.resources[monopolyResource] = 0;
          }
        }
        player.resources[monopolyResource] += stolen;
        addLog(room, `${player.avatar} ${player.name} Monopolized ${stolen} ${monopolyResource}!`, player.color);
      }
      broadcastRoom(room);
    }));

    socket.on('bankTrade', safe(({ code, give, get }) => {
      const room = rooms[code];
      if (!room || room.phase !== 'MAIN' || !give || !get) return;
      const player = room.players[room.turnIndex];
      if (!player || player.id !== socket.id) return;

      const ratios = getTradeRatios(room, player.id);
      const bank = getBankRemaining(room);
      let credits = 0;
      for (const r of RESOURCES) {
        const amt = Number(give[r]) || 0;
        if (amt > player.resources[r]) return socket.emit('errorMsg', `Not enough ${r.toUpperCase()}!`);
        if (amt % ratios[r] !== 0) {
          return socket.emit('errorMsg', `Bank trade requires ${ratios[r]}:1 for ${r.toUpperCase()}! Use Player Trade 👥 to offer custom amounts.`);
        }
        credits += amt / ratios[r];
      }
      const requested = RESOURCES.reduce((s, r) => s + (Number(get[r]) || 0), 0);
      if (credits <= 0 || credits !== requested) {
        return socket.emit('errorMsg', `Bank trade mismatch: your offered cards equal ${credits} resource(s), but you selected ${requested} wanted card(s).`);
      }

      for (const r of RESOURCES) {
        if ((Number(get[r]) || 0) > bank[r]) {
          return socket.emit('errorMsg', `Bank does not have enough ${r.toUpperCase()}!`);
        }
      }

      for (const r of RESOURCES) {
        player.resources[r] -= Number(give[r]) || 0;
        player.resources[r] += Number(get[r]) || 0;
      }
      addLog(room, `${player.avatar} ${player.name} traded with the Bank 🏦`, player.color);
      broadcastRoom(room);
    }));

    socket.on('proposeTrade', safe(({ code, offer, request }) => {
      const room = rooms[code];
      if (!room || room.phase !== 'MAIN' || !offer || !request) return;
      const player = room.players[room.turnIndex];
      if (!player || player.id !== socket.id) return;

      let offerSum = 0, reqSum = 0;
      for (const r of RESOURCES) {
        const o = Number(offer[r]) || 0;
        const req = Number(request[r]) || 0;
        if (o > player.resources[r]) return socket.emit('errorMsg', `You don't have enough ${r}!`);
        offerSum += o;
        reqSum += req;
      }
      if (offerSum === 0 || reqSum === 0) {
        return socket.emit('errorMsg', 'Select at least 1 card to Give and 1 card you Want!');
      }

      const responses: Record<string, string> = {};
      room.players.forEach(p => {
        if (p.id !== player.id) responses[p.id] = 'pending';
      });

      room.activeTrade = {
        id: Date.now(),
        fromId: player.id,
        fromName: player.name,
        fromAvatar: player.avatar,
        fromColor: player.color,
        offer,
        request,
        responses
      };

      const offStr = RESOURCES.filter(r => offer[r] > 0).map(r => `${offer[r]} ${r}`).join(', ');
      const reqStr = RESOURCES.filter(r => request[r] > 0).map(r => `${request[r]} ${r}`).join(', ');
      addLog(room, `${player.avatar} ${player.name} wants to give [${offStr}] for [${reqStr}]`, player.color);
      broadcastRoom(room);
    }));

    // Human responds (Accept / Decline) to another player's or Bot's trade offer
    socket.on('respondTrade', safe(({ code, decision }) => {
      const room = rooms[code];
      if (!room || !room.activeTrade) return;
      const trade = room.activeTrade;
      const partner = room.players.find(p => p.id === socket.id);
      const proposer = room.players.find(p => p.id === trade.fromId);
      if (!partner || !proposer || partner.id === proposer.id) return;

      if (decision === 'declined') {
        trade.responses[partner.id] = 'declined';
        broadcastRoom(room);
        return;
      }

      // Verify partner has the requested resources
      for (const r of RESOURCES) {
        if ((Number(trade.request[r]) || 0) > (partner.resources[r] || 0)) {
          return socket.emit('errorMsg', 'You do not have the required resources for this trade!');
        }
      }

      trade.responses[partner.id] = 'accepted';

      // If the proposer is a Bot (or if immediate execution is desired), execute the swap right away!
      if (proposer.isBot) {
        executeTradeBetweenPlayers(room, proposer, partner, trade);
      } else {
        broadcastRoom(room);
      }
    }));

    // Proposer clicks on a specific player/bot who accepted the trade to finalize the swap
    socket.on('confirmTradeWithPartner', safe(({ code, partnerId }) => {
      const room = rooms[code];
      if (!room || !room.activeTrade) return;
      const trade = room.activeTrade;
      if (trade.fromId !== socket.id) return;

      const proposer = room.players.find(p => p.id === trade.fromId);
      let partner = room.players.find(p => p.id === partnerId);
      if (!partner) {
        // Fallback: pick first player/bot who accepted
        const firstAcceptedId = Object.keys(trade.responses || {}).find(id => trade.responses[id] === 'accepted');
        partner = room.players.find(p => p.id === firstAcceptedId);
      }
      if (!partner || trade.responses[partner.id] !== 'accepted') {
        return socket.emit('errorMsg', 'Wait for a player or bot to accept (✔) your trade offer!');
      }

      executeTradeBetweenPlayers(room, proposer, partner, trade);
    }));

    socket.on('cancelTrade', safe(({ code }) => {
      const room = rooms[code];
      if (!room || !room.activeTrade) return;
      if (room.activeTrade.fromId === socket.id) {
        room.activeTrade = null;
      } else if (room.activeTrade.responses) {
        room.activeTrade.responses[socket.id] = 'declined';
      }
      broadcastRoom(room);
    }));

    socket.on('endTurn', safe(({ code }) => {
      const room = rooms[code];
      if (!room) return;
      const player = room.players[room.turnIndex];
      if (!player || player.id !== socket.id) return;
      handleEndTurn(room, player);
    }));

    socket.on('sendChat', safe(({ code, text }) => {
      const room = rooms[code];
      if (!room || !text) return;
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;
      room.chats.push({
        sender: player.name,
        avatar: player.avatar,
        color: player.color,
        text: String(text).trim().substring(0, 120)
      });
      if (room.chats.length > 60) room.chats.shift();
      broadcastRoom(room);
    }));

    socket.on('disconnect', () => {
      try {
        for (const code of Object.keys(rooms)) {
          const room = rooms[code];
          const idx = room.players.findIndex(p => p.id === socket.id);
          if (idx === -1) continue;

          if (room.status === 'LOBBY') {
            room.players.splice(idx, 1);
            if (room.players.filter(p => !p.isBot).length === 0) {
              if (room.botTimer) clearTimeout(room.botTimer);
              delete rooms[code];
            } else {
              if (room.hostId === socket.id) {
                const nextHuman = room.players.find(p => !p.isBot);
                if (nextHuman) room.hostId = nextHuman.id;
              }
              broadcastRoom(room);
            }
          } else {
            const p = room.players[idx];
            p.isBot = true;
            p.difficulty = 'ADVANCED HARD';
            if (!p.name.includes('(Bot)')) p.name += ' (Bot)';
            addLog(room, `🤖 ${p.name} disconnected — Hard Bot took over.`, p.color);
            broadcastRoom(room);
          }
        }
      } catch (e) { console.error(e); }
    });
  });
}
