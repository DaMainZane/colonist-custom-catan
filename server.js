const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
const PLAYER_COLORS = [
  '#e53935', // Red
  '#1e88e5', // Blue
  '#fb8c00', // Orange
  '#43a047', // Green
  '#8e24aa', // Purple
  '#fdd835', // Yellow
  '#00acc1', // Cyan
  '#f4511e'  // Coral
];

const rooms = {};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clamp(val, min, max, fallback) {
  const n = Number(val);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function getPips(num) {
  if (!num || num === 7) return 0;
  return Math.max(0, 6 - Math.abs(7 - num));
}

function rebuildBoardTopology(hexes, existingPorts = {}, autoGeneratePorts = false) {
  const hexSize = 95;
  const vertices = [];
  const edges = [];

  function getOrCreateVertex(x, y) {
    for (const v of vertices) {
      if (Math.hypot(v.x - x, v.y - y) < 8) return v;
    }
    const v = {
      id: vertices.length,
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      hexIds: [],
      adjacentVertices: [],
      edgeIds: [],
      building: null,
      port: null
    };
    vertices.push(v);
    return v;
  }

  function getOrCreateEdge(v1, v2, hexId) {
    const minV = Math.min(v1.id, v2.id);
    const maxV = Math.max(v1.id, v2.id);
    for (const e of edges) {
      if (e.v1 === minV && e.v2 === maxV) {
        if (!e.hexIds.includes(hexId)) e.hexIds.push(hexId);
        return e;
      }
    }
    const key = `${Math.round((v1.x + v2.x) / 2)},${Math.round((v1.y + v2.y) / 2)}`;
    const e = {
      id: edges.length,
      v1: minV,
      v2: maxV,
      key,
      hexIds: [hexId],
      road: null,
      port: existingPorts[key] || null
    };
    edges.push(e);
    if (!v1.adjacentVertices.includes(v2.id)) v1.adjacentVertices.push(v2.id);
    if (!v2.adjacentVertices.includes(v1.id)) v2.adjacentVertices.push(v1.id);
    if (!v1.edgeIds.includes(e.id)) v1.edgeIds.push(e.id);
    if (!v2.edgeIds.includes(e.id)) v2.edgeIds.push(e.id);
    return e;
  }

  let robberHexId = 0;
  let foundDesert = false;

  hexes.forEach((h, idx) => {
    h.id = idx;
    const cx = hexSize * Math.sqrt(3) * (h.q + h.r / 2);
    const cy = hexSize * (3 / 2) * h.r;
    h.x = Number(cx.toFixed(2));
    h.y = Number(cy.toFixed(2));

    h.corners = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (60 * i - 30);
      h.corners.push({
        x: Number((cx + hexSize * Math.cos(angle)).toFixed(2)),
        y: Number((cy + hexSize * Math.sin(angle)).toFixed(2))
      });
    }

    if (h.type === 'water') {
      h.number = null;
      h.vertexIds = [];
      return;
    }

    if (h.type === 'desert' && !foundDesert) {
      robberHexId = idx;
      foundDesert = true;
    }

    const cornerVertices = h.corners.map(pt => {
      const v = getOrCreateVertex(pt.x, pt.y);
      if (!v.hexIds.includes(idx)) v.hexIds.push(idx);
      return v;
    });

    for (let i = 0; i < 6; i++) {
      getOrCreateEdge(cornerVertices[i], cornerVertices[(i + 1) % 6], idx);
    }

    h.vertexIds = cornerVertices.map(v => v.id);
  });

  if (!foundDesert) {
    const firstLand = hexes.find(h => h.type !== 'water');
    if (firstLand) robberHexId = firstLand.id;
  }

  const coastalEdges = edges.filter(e => e.hexIds.length === 1);
  coastalEdges.sort((a, b) => {
    const va = vertices[a.v1], vb = vertices[a.v2];
    const vc = vertices[b.v1], vd = vertices[b.v2];
    return Math.atan2((va.y + vb.y) / 2, (va.x + vb.x) / 2) - Math.atan2((vc.y + vd.y) / 2, (vc.x + vd.x) / 2);
  });

  if (autoGeneratePorts) {
    const portTypes = shuffle(['3:1', 'wood', '3:1', 'brick', '3:1', 'sheep', '3:1', 'wheat', 'ore']);
    let portIdx = 0;
    for (let i = 0; i < coastalEdges.length; i += 3) {
      const edge = coastalEdges[i];
      const v1 = vertices[edge.v1];
      const v2 = vertices[edge.v2];
      if (v1 && v2 && !v1.port && !v2.port) {
        const pType = portTypes[portIdx % portTypes.length];
        portIdx++;
        edge.port = pType;
      }
    }
  }

  edges.forEach(e => {
    if (e.hexIds.length !== 1) e.port = null;
    if (e.port && vertices[e.v1] && vertices[e.v2]) {
      vertices[e.v1].port = e.port;
      vertices[e.v2].port = e.port;
    }
  });

  return { hexes, vertices, edges, robberHexId };
}

function generateBoard(settings, preset = 'standard') {
  const radius = clamp(settings.boardRadius, 1, 4, 2);
  const coords = [];

  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      coords.push({ q, r });
    }
  }

  const totalHexes = coords.length;
  if (preset === 'blank') {
    const hexes = coords.map((c, i) => ({ id: i, q: c.q, r: c.r, type: 'water', number: null }));
    return rebuildBoardTopology(hexes, {}, false);
  }

  const goldCount = preset === 'goldRush'
    ? Math.max(5, Math.floor(totalHexes / 3))
    : Math.min(clamp(settings.goldTiles, 0, 40, 2), totalHexes - 1);
  const desertCount = Math.min(clamp(settings.desertTiles, 0, 15, 1), Math.max(0, totalHexes - goldCount));
  const remaining = Math.max(0, totalHexes - goldCount - desertCount);

  const tileTypes = [];
  for (let i = 0; i < goldCount; i++) tileTypes.push('gold');
  for (let i = 0; i < desertCount; i++) tileTypes.push('desert');

  const baseWeights = ['wood', 'wheat', 'sheep', 'brick', 'ore'];
  for (let i = 0; i < remaining; i++) {
    tileTypes.push(baseWeights[i % baseWeights.length]);
  }
  const shuffledTypes = shuffle(tileTypes);

  const numberPoolBase = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
  const numberPool = [];
  for (let i = 0; i < totalHexes; i++) {
    numberPool.push(numberPoolBase[i % numberPoolBase.length]);
  }
  const shuffledNumbers = shuffle(numberPool);

  let numIdx = 0;
  const hexes = coords.map((c, idx) => {
    let type = shuffledTypes[idx] || 'wood';
    if (preset === 'archipelago' && Math.random() < 0.22 && (c.q !== 0 || c.r !== 0)) {
      type = 'water';
    }
    const number = (type === 'desert' || type === 'water') ? null : shuffledNumbers[numIdx++];
    return { id: idx, q: c.q, r: c.r, type, number };
  });

  return rebuildBoardTopology(hexes, {}, true);
}

function createDevDeck(settings) {
  const deck = [];
  const kCount = clamp(settings.devKnights, 0, 100, 14);
  const vpCount = clamp(settings.devVp, 0, 50, 5);
  const rbCount = clamp(settings.devRoadBuilding, 0, 50, 2);
  const yopCount = clamp(settings.devYearOfPlenty, 0, 50, 2);
  const monoCount = clamp(settings.devMonopoly, 0, 50, 2);

  for (let i = 0; i < kCount; i++) deck.push('knight');
  for (let i = 0; i < vpCount; i++) deck.push('vp');
  for (let i = 0; i < rbCount; i++) deck.push('roadBuilding');
  for (let i = 0; i < yopCount; i++) deck.push('yearOfPlenty');
  for (let i = 0; i < monoCount; i++) deck.push('monopoly');

  return shuffle(deck);
}

function createPlayer(id, name, colorIndex, isBot = false) {
  const avatars = ['🦊', '🐼', '🦁', '🐸', '🐯', '🐙', '🦄', '🦅'];
  return {
    id,
    name,
    avatar: isBot ? '🤖' : avatars[colorIndex % avatars.length],
    color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length],
    isBot,
    difficulty: isBot ? 'ADVANCED HARD' : null,
    resources: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 },
    devCards: [],
    newDevCards: [],
    knightsPlayed: 0,
    longestRoadLength: 0,
    goldPending: 0,
    discardPending: 0,
    freeRoads: 0,
    playedDevCardThisTurn: false,
    proposedTradeThisTurn: false,
    settlementsLeft: 5,
    citiesLeft: 4,
    roadsLeft: 15
  };
}

function createRoom(hostId, hostName) {
  const code = Math.random().toString(36).substring(2, 7).toUpperCase();
  const settings = {
    boardRadius: 2,
    goldTiles: 2,
    desertTiles: 1,
    vpToWin: 10,
    maxPlayers: 4,
    cardDiscardLimit: 7,
    bankResourcePerType: 19,
    devKnights: 14,
    devVp: 5,
    devRoadBuilding: 2,
    devYearOfPlenty: 2,
    devMonopoly: 2,
    maxSettlements: 5,
    maxCities: 4,
    maxRoads: 15
  };

  const room = {
    code,
    hostId,
    status: 'LOBBY',
    settings,
    players: [createPlayer(hostId, hostName, 0, false)],
    board: generateBoard(settings),
    devDeck: createDevDeck(settings),
    turnIndex: 0,
    setupStep: 0,
    setupOrder: [],
    phase: 'LOBBY',
    PreGoldPhase: null,
    lastDice: [4, 3],
    longestRoadOwner: null,
    largestArmyOwner: null,
    activeTrade: null,
    winner: null,
    logs: [{ text: `Room ${code} created. Bots are set to ADVANCED HARD.`, color: '#1565c0' }],
    chats: [{ sender: hostName, avatar: '🦊', color: PLAYER_COLORS[0], text: 'Welcome! Customize the board or add Hard Bots to start.' }]
  };
  rooms[code] = room;
  return room;
}

function addLog(room, text, color = null) {
  if (!room) return;
  room.logs.push({ text, color });
  if (room.logs.length > 80) room.logs.shift();
}

function getTotalResources(player) {
  if (!player || !player.resources) return 0;
  return RESOURCES.reduce((sum, r) => sum + (player.resources[r] || 0), 0);
}

function getBankRemaining(room) {
  const maxPer = clamp(room.settings.bankResourcePerType, 1, 999, 19);
  const bank = { wood: maxPer, brick: maxPer, sheep: maxPer, wheat: maxPer, ore: maxPer };
  for (const p of room.players) {
    for (const r of RESOURCES) {
      bank[r] = Math.max(0, bank[r] - (p.resources[r] || 0));
    }
  }
  return bank;
}

function givePlayerResourceFromBank(room, player, resource, amount) {
  if (!RESOURCES.includes(resource) || amount <= 0) return 0;
  const bank = getBankRemaining(room);
  const available = bank[resource] || 0;
  const granted = Math.min(amount, available);
  player.resources[resource] = (player.resources[resource] || 0) + granted;
  return granted;
}

function computePlayerLongestRoad(board, playerId) {
  const playerEdges = board.edges.filter(e => e.road === playerId);
  if (playerEdges.length === 0) return 0;

  let maxLen = 0;
  const visitedEdges = new Set();

  function dfs(vertexId, currentLen) {
    if (currentLen > maxLen) maxLen = currentLen;
    const v = board.vertices[vertexId];
    if (!v) return;
    if (currentLen > 0 && v.building && v.building.owner !== playerId) return;

    for (const edgeId of v.edgeIds) {
      if (visitedEdges.has(edgeId)) continue;
      const edge = board.edges[edgeId];
      if (!edge || edge.road !== playerId) continue;

      visitedEdges.add(edgeId);
      const nextVertex = edge.v1 === vertexId ? edge.v2 : edge.v1;
      dfs(nextVertex, currentLen + 1);
      visitedEdges.delete(edgeId);
    }
  }

  const endpoints = new Set();
  playerEdges.forEach(e => { endpoints.add(e.v1); endpoints.add(e.v2); });
  for (const vId of endpoints) dfs(vId, 0);
  return maxLen;
}

function updateLongestRoad(room) {
  let bestLen = 4;
  if (room.longestRoadOwner) {
    const holder = room.players.find(p => p.id === room.longestRoadOwner);
    if (holder) {
      holder.longestRoadLength = computePlayerLongestRoad(room.board, holder.id);
      if (holder.longestRoadLength >= 5) bestLen = holder.longestRoadLength;
      else room.longestRoadOwner = null;
    }
  }
  for (const p of room.players) {
    p.longestRoadLength = computePlayerLongestRoad(room.board, p.id);
    if (p.longestRoadLength > bestLen) {
      bestLen = p.longestRoadLength;
      room.longestRoadOwner = p.id;
      addLog(room, `${p.avatar} ${p.name} claimed Longest Road (${bestLen})!`, p.color);
    }
  }
}

function updateLargestArmy(room) {
  let bestCount = 2;
  if (room.largestArmyOwner) {
    const holder = room.players.find(p => p.id === room.largestArmyOwner);
    if (holder) bestCount = holder.knightsPlayed;
  }
  for (const p of room.players) {
    if (p.knightsPlayed > bestCount) {
      bestCount = p.knightsPlayed;
      room.largestArmyOwner = p.id;
      addLog(room, `${p.avatar} ${p.name} claimed Largest Army (${bestCount})!`, p.color);
    }
  }
}

function getPlayerVP(room, player, includeHidden = false) {
  let vp = 0;
  for (const v of room.board.vertices) {
    if (v.building && v.building.owner === player.id) {
      vp += v.building.type === 'city' ? 2 : 1;
    }
  }
  if (room.longestRoadOwner === player.id) vp += 2;
  if (room.largestArmyOwner === player.id) vp += 2;
  if (includeHidden) {
    vp += [...player.devCards, ...player.newDevCards].filter(c => c === 'vp').length;
  }
  return vp;
}

function checkWinner(room) {
  for (const p of room.players) {
    const totalVp = getPlayerVP(room, p, true);
    if (totalVp >= room.settings.vpToWin) {
      room.status = 'GAMEOVER';
      room.phase = 'GAMEOVER';
      room.activeTrade = null;
      room.winner = { id: p.id, name: p.name, vp: totalVp, color: p.color };
      addLog(room, `🏆 ${p.name} wins the game with ${totalVp} VP!`, p.color);
      return true;
    }
  }
  return false;
}

function canPlaceSettlement(room, playerId, vertexId, isSetup = false) {
  const v = room.board.vertices[vertexId];
  if (!v || v.building) return false;
  for (const adjId of v.adjacentVertices) {
    if (room.board.vertices[adjId]?.building) return false;
  }
  if (isSetup) return true;
  return v.edgeIds.some(eId => room.board.edges[eId]?.road === playerId);
}

function canPlaceRoad(room, playerId, edgeId, mustConnectVertexId = null) {
  const e = room.board.edges[edgeId];
  if (!e || e.road !== null) return false;
  if (mustConnectVertexId !== null) {
    return e.v1 === mustConnectVertexId || e.v2 === mustConnectVertexId;
  }
  for (const vId of [e.v1, e.v2]) {
    const v = room.board.vertices[vId];
    if (!v) continue;
    if (v.building && v.building.owner === playerId) return true;
    if (v.building && v.building.owner !== playerId) continue;
    if (v.edgeIds.some(otherEdgeId => room.board.edges[otherEdgeId]?.road === playerId)) return true;
  }
  return false;
}

function getTradeRatios(room, playerId) {
  const ratios = { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };
  for (const v of room.board.vertices) {
    if (v.building && v.building.owner === playerId && v.port) {
      if (v.port === '3:1') {
        RESOURCES.forEach(r => { if (ratios[r] > 3) ratios[r] = 3; });
      } else if (ratios[v.port]) {
        ratios[v.port] = 2;
      }
    }
  }
  return ratios;
}

function broadcastRoom(room) {
  if (!room) return;
  const bank = getBankRemaining(room);
  for (const p of room.players) {
    if (p.isBot) continue;
    const state = {
      code: room.code,
      hostId: room.hostId,
      status: room.status,
      settings: room.settings,
      board: room.board,
      bank,
      devDeckCount: room.devDeck.length,
      turnIndex: room.turnIndex,
      currentPlayerId: room.players[room.turnIndex]?.id,
      phase: room.phase,
      lastSetupVertexId: room.lastSetupVertexId,
      lastDice: room.lastDice,
      longestRoadOwner: room.longestRoadOwner,
      largestArmyOwner: room.largestArmyOwner,
      activeTrade: room.activeTrade,
      winner: room.winner,
      logs: room.logs,
      chats: room.chats,
      tradeRatios: getTradeRatios(room, p.id),
      players: room.players.map(pl => ({
        id: pl.id,
        name: pl.name,
        avatar: pl.avatar,
        color: pl.color,
        isBot: pl.isBot,
        difficulty: pl.difficulty,
        resourceCount: getTotalResources(pl),
        resources: pl.id === p.id || room.status === 'GAMEOVER' ? pl.resources : undefined,
        devCardCount: pl.devCards.length + pl.newDevCards.length,
        devCards: pl.id === p.id ? pl.devCards : undefined,
        newDevCards: pl.id === p.id ? pl.newDevCards : undefined,
        knightsPlayed: pl.knightsPlayed,
        longestRoadLength: pl.longestRoadLength,
        goldPending: pl.goldPending,
        discardPending: pl.discardPending,
        freeRoads: pl.freeRoads,
        playedDevCardThisTurn: pl.playedDevCardThisTurn,
        settlementsLeft: pl.settlementsLeft,
        citiesLeft: pl.citiesLeft,
        roadsLeft: pl.roadsLeft,
        vp: getPlayerVP(room, pl, pl.id === p.id || room.status === 'GAMEOVER')
      }))
    };
    io.to(p.id).emit('gameState', state);
  }
  scheduleBotAction(room);
}

function checkGoldPhaseTransition(room) {
  const bank = getBankRemaining(room);
  const totalBankAvailable = RESOURCES.reduce((s, r) => s + bank[r], 0);
  if (totalBankAvailable === 0) {
    room.players.forEach(p => { p.goldPending = 0; });
  }

  const anyGoldPending = room.players.some(p => p.goldPending > 0);
  if (!anyGoldPending && room.phase === 'GOLD_PICK') {
    room.phase = room.PreGoldPhase || 'MAIN';
    room.PreGoldPhase = null;
    if (room.phase === 'SETUP_NEXT') advanceSetupTurn(room);
  }
}

function advanceSetupTurn(room) {
  room.setupStep++;
  if (room.setupStep >= room.setupOrder.length) {
    room.status = 'PLAYING';
    room.turnIndex = 0;
    room.phase = 'ROLL';
    addLog(room, `Setup complete! ${room.players[0]?.name}'s turn to roll.`);
  } else {
    room.turnIndex = room.setupOrder[room.setupStep];
    room.phase = 'SETUP_SETTLEMENT';
  }
}

// ============================================================================
// ADVANCED HARD BOT AI ENGINE
// ============================================================================

function getBotProducedResources(room, botId) {
  const prod = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0, gold: 0 };
  for (const v of room.board.vertices) {
    if (v.building && v.building.owner === botId) {
      const mult = v.building.type === 'city' ? 2 : 1;
      for (const hId of v.hexIds) {
        const h = room.board.hexes[hId];
        if (h && prod[h.type] !== undefined) {
          prod[h.type] += getPips(h.number) * mult;
        }
      }
    }
  }
  return prod;
}

function scoreVertexForHardBot(room, bot, vertexId) {
  const v = room.board.vertices[vertexId];
  if (!v) return -999;

  const existingProd = getBotProducedResources(room, bot.id);
  let score = 0;
  const typesAtVertex = new Set();
  const numbersAtVertex = new Set();

  for (const hId of v.hexIds) {
    const h = room.board.hexes[hId];
    if (!h || h.type === 'water' || h.type === 'desert') continue;

    const pips = getPips(h.number);
    score += pips * 3.0;

    if (h.type === 'gold') {
      score += 6.5; // High priority for Colonist Gold tiles
    } else if (RESOURCES.includes(h.type)) {
      typesAtVertex.add(h.type);
      // Strongly reward resources the bot doesn't produce yet
      if (existingProd[h.type] === 0) score += 5.5;
      if (h.type === 'wheat' || h.type === 'ore') score += 1.5;
    }

    if (h.number) {
      if (numbersAtVertex.has(h.number)) score -= 1.5; // Diversify numbers
      numbersAtVertex.add(h.number);
    }
  }

  // Resource diversity bonus
  score += typesAtVertex.size * 3.5;

  // Synergy bonus: Wood+Brick or Wheat+Ore
  const hasWood = existingProd.wood > 0 || typesAtVertex.has('wood');
  const hasBrick = existingProd.brick > 0 || typesAtVertex.has('brick');
  const hasWheat = existingProd.wheat > 0 || typesAtVertex.has('wheat');
  const hasOre = existingProd.ore > 0 || typesAtVertex.has('ore');
  if (hasWood && hasBrick) score += 4.0;
  if (hasWheat && hasOre) score += 5.0;

  // Port synergy
  if (v.port === '3:1') score += 4.5;
  else if (v.port && (existingProd[v.port] >= 4 || typesAtVertex.has(v.port))) score += 6.5;

  return score;
}

function chooseBestRoadForHardBot(room, bot, mustConnectVertexId = null) {
  const validEdges = room.board.edges.filter(e => canPlaceRoad(room, bot.id, e.id, mustConnectVertexId));
  if (validEdges.length === 0) return null;

  let bestEdge = validEdges[0];
  let bestScore = -9999;

  for (const e of validEdges) {
    let score = 0;
    for (const endVId of [e.v1, e.v2]) {
      const endV = room.board.vertices[endVId];
      if (!endV) continue;

      // Direct buildable settlement spot at endpoint
      if (canPlaceSettlement(room, bot.id, endVId, true)) {
        score += 40 + scoreVertexForHardBot(room, bot, endVId);
      }

      // Check 1 step further for high-value settlement spots
      for (const nextVId of endV.adjacentVertices) {
        if (canPlaceSettlement(room, bot.id, nextVId, true)) {
          score += 18 + scoreVertexForHardBot(room, bot, nextVId) * 0.6;
        }
      }
    }
    score += Math.random() * 1.5;
    if (score > bestScore) {
      bestScore = score;
      bestEdge = e;
    }
  }
  return bestEdge;
}

// Determines what the Hard Bot is currently trying to build, what it needs, and what it refuses to trade away
function analyzeBotStrategy(room, bot) {
  const res = { ...bot.resources };
  const hasUpgradeableSettlement = bot.citiesLeft > 0 &&
    room.board.vertices.some(v => v.building && v.building.owner === bot.id && v.building.type === 'settlement');
  const hasOpenSettleSpot = bot.settlementsLeft > 0 &&
    room.board.vertices.some(v => canPlaceSettlement(room, bot.id, v.id, false));

  const plans = [];

  if (hasUpgradeableSettlement) {
    const missing = [];
    for (let i = res.wheat; i < 2; i++) missing.push('wheat');
    for (let i = res.ore; i < 3; i++) missing.push('ore');
    plans.push({
      type: 'city',
      priority: 100 - missing.length * 18,
      cost: { wood: 0, brick: 0, sheep: 0, wheat: 2, ore: 3 },
      missing
    });
  }

  if (hasOpenSettleSpot) {
    const missing = [];
    if (res.wood < 1) missing.push('wood');
    if (res.brick < 1) missing.push('brick');
    if (res.sheep < 1) missing.push('sheep');
    if (res.wheat < 1) missing.push('wheat');
    plans.push({
      type: 'settlement',
      priority: 95 - missing.length * 18,
      cost: { wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 0 },
      missing
    });
  }

  if (room.devDeck.length > 0) {
    const missing = [];
    if (res.sheep < 1) missing.push('sheep');
    if (res.wheat < 1) missing.push('wheat');
    if (res.ore < 1) missing.push('ore');
    plans.push({
      type: 'dev',
      priority: 72 - missing.length * 16,
      cost: { wood: 0, brick: 0, sheep: 1, wheat: 1, ore: 1 },
      missing
    });
  }

  if (bot.roadsLeft > 0 && !hasOpenSettleSpot) {
    const missing = [];
    if (res.wood < 1) missing.push('wood');
    if (res.brick < 1) missing.push('brick');
    plans.push({
      type: 'road',
      priority: 65 - missing.length * 16,
      cost: { wood: 1, brick: 1, sheep: 0, wheat: 0, ore: 0 },
      missing
    });
  }

  plans.sort((a, b) => b.priority - a.priority);
  const topPlan = plans[0] || {
    type: 'settlement',
    cost: { wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 0 },
    missing: ['wheat']
  };

  const surplus = {};
  RESOURCES.forEach(r => {
    const keep = topPlan.cost[r] || 0;
    surplus[r] = Math.max(0, (res[r] || 0) - keep);
  });

  return { topPlan, plans, surplus };
}

function chooseBestGoldResourceForBot(room, bot) {
  const bank = getBankRemaining(room);
  const avail = RESOURCES.filter(r => bank[r] > 0);
  if (avail.length === 0) return null;

  const { topPlan } = analyzeBotStrategy(room, bot);
  for (const m of topPlan.missing) {
    if (bank[m] > 0) return m;
  }

  // Otherwise pick the rarest resource in hand
  avail.sort((a, b) => (bot.resources[a] || 0) - (bot.resources[b] || 0));
  return avail[0];
}

// Evaluates a player's trade offer from the perspective of an Advanced Hard Bot
function evaluateTradeForHardBot(room, bot, trade) {
  if (!trade || trade.fromId === bot.id) return 'declined';

  // 1. Check if bot actually has all requested resources
  let totalGiveByBot = 0;
  let totalGetByBot = 0;
  for (const r of RESOURCES) {
    const reqAmt = Number(trade.request[r]) || 0;
    const offAmt = Number(trade.offer[r]) || 0;
    if (reqAmt > (bot.resources[r] || 0)) return 'declined';
    totalGiveByBot += reqAmt;
    totalGetByBot += offAmt;
  }
  if (totalGiveByBot === 0 || totalGetByBot === 0) return 'declined';

  // 2. Hard Bot refuses to trade with a player close to winning!
  const proposer = room.players.find(p => p.id === trade.fromId);
  if (proposer) {
    const proposerPublicVp = getPlayerVP(room, proposer, false);
    if (proposerPublicVp >= Math.max(4, room.settings.vpToWin - 2)) {
      return 'declined';
    }
  }

  // 3. Check if trade helps bot's active build plan without sacrificing locked cards
  const { topPlan, surplus } = analyzeBotStrategy(room, bot);

  let helpsMissing = 0;
  let hurtsLocked = false;
  for (const r of RESOURCES) {
    const reqAmt = Number(trade.request[r]) || 0;
    const offAmt = Number(trade.offer[r]) || 0;
    if (offAmt > 0 && topPlan.missing.includes(r)) {
      helpsMissing += offAmt;
    }
    if (reqAmt > surplus[r]) {
      hurtsLocked = true;
    }
  }

  // Accept if it directly gives a needed resource using only surplus cards
  if (helpsMissing > 0 && !hurtsLocked && totalGetByBot >= totalGiveByBot) {
    return 'accepted';
  }

  // Accept favorable 2-for-1 (or better) trades if it doesn't break an immediate 0-missing build
  if (totalGetByBot > totalGiveByBot && topPlan.missing.length > 0 && !hurtsLocked) {
    return 'accepted';
  }

  // Accept even 1-for-1 if the bot has >= 3 of the requested resource and 0 of the offered resource
  if (totalGetByBot === totalGiveByBot) {
    const givesAbundant = RESOURCES.every(r => (trade.request[r] || 0) === 0 || bot.resources[r] >= 3);
    const getsScarce = RESOURCES.some(r => (trade.offer[r] || 0) > 0 && bot.resources[r] === 0);
    if (givesAbundant && getsScarce) return 'accepted';
  }

  return 'declined';
}

function tryHardBotBankTrade(room, bot) {
  const { topPlan, surplus } = analyzeBotStrategy(room, bot);
  if (topPlan.missing.length === 0) return false;

  const targetRes = topPlan.missing[0];
  const bank = getBankRemaining(room);
  if (bank[targetRes] <= 0) return false;

  const ratios = getTradeRatios(room, bot.id);
  for (const r of RESOURCES) {
    if (r === targetRes) continue;
    const ratio = ratios[r];
    if (surplus[r] >= ratio) {
      bot.resources[r] -= ratio;
      bot.resources[targetRes] += 1;
      addLog(room, `${bot.avatar} ${bot.name} traded ${ratio} ${r} for 1 ${targetRes} with the Bank 🏦`, bot.color);
      return true;
    }
  }
  return false;
}

function tryHardBotProposeTrade(room, bot) {
  if (bot.proposedTradeThisTurn || room.activeTrade) return false;
  const { topPlan, surplus } = analyzeBotStrategy(room, bot);
  if (topPlan.missing.length !== 1) return false; // Propose trade when 1 card away from a build!

  const wantRes = topPlan.missing[0];
  const offerRes = RESOURCES.find(r => r !== wantRes && surplus[r] >= 1);
  if (!offerRes) return false;

  // Check if any other player actually has at least 1 card
  const anyOtherHasCards = room.players.some(p => p.id !== bot.id && getTotalResources(p) > 0);
  if (!anyOtherHasCards) return false;

  bot.proposedTradeThisTurn = true;
  const offer = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  const request = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  offer[offerRes] = 1;
  request[wantRes] = 1;

  const responses = {};
  room.players.forEach(p => {
    if (p.id !== bot.id) responses[p.id] = 'pending';
  });

  room.activeTrade = {
    id: Date.now(),
    fromId: bot.id,
    fromName: bot.name,
    fromAvatar: bot.avatar,
    fromColor: bot.color,
    offer,
    request,
    responses
  };

  addLog(room, `${bot.avatar} ${bot.name} wants to give 1 ${offerRes} for 1 ${wantRes}`, bot.color);
  return true;
}

function chooseBestRobberHexForHardBot(room, bot) {
  const candidates = room.board.hexes.filter(h => h.type !== 'water' && h.id !== room.board.robberHexId);
  let bestHex = candidates[0];
  let bestScore = -9999;

  for (const h of candidates) {
    let botHasBuilding = false;
    let oppWeight = 0;
    let maxOppVp = 0;

    for (const vId of h.vertexIds) {
      const b = room.board.vertices[vId]?.building;
      if (!b) continue;
      if (b.owner === bot.id) {
        botHasBuilding = true;
      } else {
        const opp = room.players.find(p => p.id === b.owner);
        const vp = opp ? getPlayerVP(room, opp, false) : 2;
        const mult = b.type === 'city' ? 2 : 1;
        oppWeight += mult * (1 + vp * 0.4);
        if (vp > maxOppVp) maxOppVp = vp;
      }
    }

    if (botHasBuilding) continue; // Never block own hex!

    const pips = getPips(h.number) + (h.type === 'gold' ? 3 : 0);
    const score = oppWeight > 0 ? (pips * 10 * oppWeight) + (maxOppVp * 8) : -pips;
    if (score > bestScore) {
      bestScore = score;
      bestHex = h;
    }
  }

  return bestHex || candidates[0];
}

// ============================================================================
// BOT SCHEDULER & TURN STEPPER
// ============================================================================

function scheduleBotAction(room) {
  if (!room || room.status === 'LOBBY' || room.status === 'GAMEOVER') return;

  // 1. Bots respond to any active trade offer
  if (room.activeTrade) {
    const trade = room.activeTrade;
    for (const bot of room.players.filter(p => p.isBot)) {
      if (trade.responses && trade.responses[bot.id] === 'pending') {
        setTimeout(() => {
          try {
            if (!room.activeTrade || room.activeTrade.id !== trade.id) return;
            if (room.activeTrade.responses[bot.id] !== 'pending') return;

            const decision = evaluateTradeForHardBot(room, bot, room.activeTrade);
            room.activeTrade.responses[bot.id] = decision;

            // If a Bot proposed the trade and another Bot accepted it, execute immediately
            const proposer = room.players.find(p => p.id === room.activeTrade.fromId);
            if (decision === 'accepted' && proposer && proposer.isBot) {
              executeTradeBetweenPlayers(room, proposer, bot, room.activeTrade);
              return;
            }
            broadcastRoom(room);
          } catch (e) { console.error(e); }
        }, 450);
        return;
      }
    }

    // If a Bot proposed a trade and all humans/bots have declined (or after timeout), clear it so bot continues
    const proposer = room.players.find(p => p.id === trade.fromId);
    if (proposer && proposer.isBot) {
      const vals = Object.values(trade.responses || {});
      if (vals.length > 0 && vals.every(v => v === 'declined')) {
        setTimeout(() => {
          if (room.activeTrade && room.activeTrade.id === trade.id) {
            room.activeTrade = null;
            broadcastRoom(room);
          }
        }, 500);
        return;
      }
      // Wait up to 4.5 seconds for human to accept/decline bot's offer
      if (!trade.timeoutScheduled) {
        trade.timeoutScheduled = true;
        setTimeout(() => {
          if (room.activeTrade && room.activeTrade.id === trade.id) {
            room.activeTrade = null;
            broadcastRoom(room);
          }
        }, 4500);
      }
      return;
    }
  }

  // 2. Bots handle pending Gold Picks or 7-Roll Discards
  for (const bot of room.players.filter(p => p.isBot)) {
    if (bot.goldPending > 0) {
      setTimeout(() => {
        try {
          if (bot.goldPending <= 0) return;
          const pick = chooseBestGoldResourceForBot(room, bot);
          if (!pick) {
            bot.goldPending = 0;
          } else {
            givePlayerResourceFromBank(room, bot, pick, 1);
            bot.goldPending--;
            addLog(room, `${bot.avatar} ${bot.name} picked ${pick} from Gold`, bot.color);
          }
          checkGoldPhaseTransition(room);
          broadcastRoom(room);
        } catch (e) { console.error(e); }
      }, 400);
      return;
    }

    if (room.phase === 'DISCARD' && bot.discardPending > 0) {
      setTimeout(() => {
        try {
          if (bot.discardPending <= 0) return;
          const { surplus } = analyzeBotStrategy(room, bot);
          while (bot.discardPending > 0) {
            // Discard surplus cards first before touching locked build cards
            let pick = RESOURCES.find(r => surplus[r] > 0 && bot.resources[r] > 0);
            if (pick) {
              surplus[pick]--;
            } else {
              const avail = RESOURCES.filter(r => bot.resources[r] > 0);
              if (!avail.length) { bot.discardPending = 0; break; }
              avail.sort((a, b) => bot.resources[b] - bot.resources[a]);
              pick = avail[0];
            }
            bot.resources[pick]--;
            bot.discardPending--;
          }
          addLog(room, `${bot.avatar} ${bot.name} discarded excess cards`, bot.color);
          if (room.players.every(p => p.discardPending === 0)) room.phase = 'ROBBER';
          broadcastRoom(room);
        } catch (e) { console.error(e); }
      }, 450);
      return;
    }
  }

  // 3. Active Bot Turn Execution
  const current = room.players[room.turnIndex];
  if (!current || !current.isBot) return;

  if (room.botTimer) clearTimeout(room.botTimer);
  room.botTimer = setTimeout(() => {
    try { runBotTurnStep(room, current); } catch (e) { console.error(e); }
  }, 600);
}

function runBotTurnStep(room, bot) {
  if (!room || room.status === 'GAMEOVER' || room.players[room.turnIndex]?.id !== bot.id) return;
  if (room.activeTrade) return; // Wait while active trade is open

  if (room.phase === 'SETUP_SETTLEMENT') {
    const valid = room.board.vertices.filter(v => canPlaceSettlement(room, bot.id, v.id, true));
    if (valid.length > 0) {
      valid.sort((a, b) => scoreVertexForHardBot(room, bot, b.id) - scoreVertexForHardBot(room, bot, a.id));
      handlePlaceSettlement(room, bot, valid[0].id);
    } else {
      advanceSetupTurn(room);
      broadcastRoom(room);
    }
  } else if (room.phase === 'SETUP_ROAD') {
    const bestEdge = chooseBestRoadForHardBot(room, bot, room.lastSetupVertexId);
    if (bestEdge) {
      handlePlaceRoad(room, bot, bestEdge.id);
    } else {
      advanceSetupTurn(room);
      broadcastRoom(room);
    }
  } else if (room.phase === 'ROLL') {
    // If Robber is on a hex owned by this Hard Bot and bot has a Knight, play Knight before rolling!
    const robberHex = room.board.hexes[room.board.robberHexId];
    const robberBlockingMe = robberHex && robberHex.vertexIds.some(vId => room.board.vertices[vId]?.building?.owner === bot.id);
    if (robberBlockingMe && !bot.playedDevCardThisTurn && bot.devCards.includes('knight')) {
      playBotDevCard(room, bot, 'knight');
      return;
    }
    handleRollDice(room, bot);
  } else if (room.phase === 'ROBBER') {
    const targetHex = chooseBestRobberHexForHardBot(room, bot);
    if (targetHex) handleMoveRobber(room, bot, targetHex.id);
    else { room.phase = 'MAIN'; broadcastRoom(room); }
  } else if (room.phase === 'MAIN') {
    // 1. Play Dev Card if advantageous
    if (!bot.playedDevCardThisTurn && bot.devCards.length > 0) {
      if (bot.devCards.includes('roadBuilding') && bot.roadsLeft >= 2) {
        return playBotDevCard(room, bot, 'roadBuilding');
      }
      if (bot.devCards.includes('yearOfPlenty')) {
        return playBotDevCard(room, bot, 'yearOfPlenty');
      }
      if (bot.devCards.includes('monopoly')) {
        return playBotDevCard(room, bot, 'monopoly');
      }
      if (bot.devCards.includes('knight')) {
        return playBotDevCard(room, bot, 'knight');
      }
    }

    // 2. Use any Free Roads from Road Building immediately
    if (bot.freeRoads > 0 && bot.roadsLeft > 0) {
      const e = chooseBestRoadForHardBot(room, bot, null);
      if (e) return handlePlaceRoad(room, bot, e.id);
      bot.freeRoads = 0;
    }

    // 3. Build City if affordable
    if (bot.citiesLeft > 0 && bot.resources.wheat >= 2 && bot.resources.ore >= 3) {
      const mySettles = room.board.vertices.filter(v => v.building && v.building.owner === bot.id && v.building.type === 'settlement');
      if (mySettles.length > 0) {
        mySettles.sort((a, b) => scoreVertexForHardBot(room, bot, b.id) - scoreVertexForHardBot(room, bot, a.id));
        return handlePlaceCity(room, bot, mySettles[0].id);
      }
    }

    // 4. Build Settlement if affordable
    if (bot.settlementsLeft > 0 && bot.resources.wood >= 1 && bot.resources.brick >= 1 && bot.resources.sheep >= 1 && bot.resources.wheat >= 1) {
      const validSpots = room.board.vertices.filter(v => canPlaceSettlement(room, bot.id, v.id, false));
      if (validSpots.length > 0) {
        validSpots.sort((a, b) => scoreVertexForHardBot(room, bot, b.id) - scoreVertexForHardBot(room, bot, a.id));
        return handlePlaceSettlement(room, bot, validSpots[0].id);
      }
    }

    // 5. Try Maritime Bank/Port Trade if it unlocks a build
    if (tryHardBotBankTrade(room, bot)) {
      broadcastRoom(room);
      return;
    }

    // 6. Propose a 1-for-1 Trade to Players if 1 card short of a build
    if (tryHardBotProposeTrade(room, bot)) {
      broadcastRoom(room);
      return;
    }

    // 7. Buy Development Card if affordable
    if (room.devDeck.length > 0 && bot.resources.sheep >= 1 && bot.resources.wheat >= 1 && bot.resources.ore >= 1) {
      bot.resources.sheep--; bot.resources.wheat--; bot.resources.ore--;
      bot.newDevCards.push(room.devDeck.pop());
      addLog(room, `${bot.avatar} ${bot.name} bought a Development Card`, bot.color);
      checkWinner(room);
      broadcastRoom(room);
      return;
    }

    // 8. Build Road toward best expansion spot
    if (bot.roadsLeft > 0 && bot.resources.wood >= 1 && bot.resources.brick >= 1) {
      const hasOpenSpot = room.board.vertices.some(v => canPlaceSettlement(room, bot.id, v.id, false));
      const shouldExpand = !hasOpenSpot || (bot.resources.wood >= 2 && bot.resources.brick >= 2);
      if (shouldExpand) {
        const bestEdge = chooseBestRoadForHardBot(room, bot, null);
        if (bestEdge) return handlePlaceRoad(room, bot, bestEdge.id);
      }
    }

    // 9. End Turn
    handleEndTurn(room, bot);
  }
}

function playBotDevCard(room, bot, cardType) {
  const idx = bot.devCards.indexOf(cardType);
  if (idx === -1) return;
  bot.devCards.splice(idx, 1);
  bot.playedDevCardThisTurn = true;

  if (cardType === 'knight') {
    bot.knightsPlayed++;
    addLog(room, `${bot.avatar} ${bot.name} played a Knight`, bot.color);
    updateLargestArmy(room);
    checkWinner(room);
    room.phase = 'ROBBER';
  } else if (cardType === 'roadBuilding') {
    bot.freeRoads += 2;
    addLog(room, `${bot.avatar} ${bot.name} played Road Building (+2 free roads)`, bot.color);
  } else if (cardType === 'yearOfPlenty') {
    bot.goldPending += 2;
    room.PreGoldPhase = room.phase;
    room.phase = 'GOLD_PICK';
    checkGoldPhaseTransition(room);
    addLog(room, `${bot.avatar} ${bot.name} played Year of Plenty (+2 picks)`, bot.color);
  } else if (cardType === 'monopoly') {
    // Pick resource most held by opponents
    let bestRes = 'wheat';
    let maxOppCount = -1;
    for (const r of RESOURCES) {
      const oppTotal = room.players.reduce((s, p) => p.id !== bot.id ? s + (p.resources[r] || 0) : s, 0);
      if (oppTotal > maxOppCount) {
        maxOppCount = oppTotal;
        bestRes = r;
      }
    }
    let stolen = 0;
    for (const other of room.players) {
      if (other.id !== bot.id) {
        stolen += other.resources[bestRes] || 0;
        other.resources[bestRes] = 0;
      }
    }
    bot.resources[bestRes] += stolen;
    addLog(room, `${bot.avatar} ${bot.name} Monopolized ${stolen} ${bestRes}!`, bot.color);
  }
  broadcastRoom(room);
}

// ============================================================================
// CORE GAME ACTIONS
// ============================================================================

function handlePlaceSettlement(room, player, vertexId) {
  const isSetup = room.phase === 'SETUP_SETTLEMENT';
  if (!isSetup && room.phase !== 'MAIN') return;
  if (player.settlementsLeft <= 0) return;
  if (!canPlaceSettlement(room, player.id, vertexId, isSetup)) return;

  if (!isSetup) {
    if (player.resources.wood < 1 || player.resources.brick < 1 || player.resources.sheep < 1 || player.resources.wheat < 1) return;
    player.resources.wood--; player.resources.brick--; player.resources.sheep--; player.resources.wheat--;
  }

  const v = room.board.vertices[vertexId];
  v.building = { owner: player.id, type: 'settlement' };
  player.settlementsLeft--;
  addLog(room, `${player.avatar} ${player.name} placed a Settlement`, player.color);

  if (isSetup) {
    room.lastSetupVertexId = vertexId;
    if (room.setupStep >= room.players.length) {
      for (const hId of v.hexIds) {
        const hex = room.board.hexes[hId];
        if (!hex) continue;
        if (RESOURCES.includes(hex.type)) givePlayerResourceFromBank(room, player, hex.type, 1);
        else if (hex.type === 'gold') player.goldPending++;
      }
    }
    room.phase = 'SETUP_ROAD';
  } else {
    updateLongestRoad(room);
    checkWinner(room);
  }
  broadcastRoom(room);
}

function handlePlaceRoad(room, player, edgeId) {
  const isSetup = room.phase === 'SETUP_ROAD';
  if (!isSetup && room.phase !== 'MAIN') return;
  if (player.roadsLeft <= 0) return;

  const mustConnect = isSetup ? room.lastSetupVertexId : null;
  if (!canPlaceRoad(room, player.id, edgeId, mustConnect)) return;

  if (!isSetup) {
    if (player.freeRoads > 0) player.freeRoads--;
    else {
      if (player.resources.wood < 1 || player.resources.brick < 1) return;
      player.resources.wood--; player.resources.brick--;
    }
  }

  room.board.edges[edgeId].road = player.id;
  player.roadsLeft--;
  addLog(room, `${player.avatar} ${player.name} placed a Road`, player.color);
  updateLongestRoad(room);

  if (isSetup) {
    room.lastSetupVertexId = null;
    checkGoldPhaseTransition(room);
    if (room.players.some(p => p.goldPending > 0)) {
      room.PreGoldPhase = 'SETUP_NEXT';
      room.phase = 'GOLD_PICK';
    } else {
      advanceSetupTurn(room);
    }
  } else {
    checkWinner(room);
  }
  broadcastRoom(room);
}

function handlePlaceCity(room, player, vertexId) {
  if (room.phase !== 'MAIN' || player.citiesLeft <= 0) return;
  if (player.resources.wheat < 2 || player.resources.ore < 3) return;

  const v = room.board.vertices[vertexId];
  if (!v || !v.building || v.building.owner !== player.id || v.building.type !== 'settlement') return;

  player.resources.wheat -= 2;
  player.resources.ore -= 3;
  v.building.type = 'city';
  player.citiesLeft--;
  player.settlementsLeft++;
  addLog(room, `${player.avatar} ${player.name} upgraded to a City`, player.color);
  checkWinner(room);
  broadcastRoom(room);
}

function handleRollDice(room, player) {
  if (room.phase !== 'ROLL') return;
  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  const sum = d1 + d2;
  room.lastDice = [d1, d2];
  addLog(room, `${player.avatar} ${player.name} rolled ${sum} (${d1} + ${d2})`, player.color);

  if (sum === 7) {
    let anyDiscard = false;
    for (const p of room.players) {
      const total = getTotalResources(p);
      if (total > room.settings.cardDiscardLimit) {
        p.discardPending = Math.floor(total / 2);
        anyDiscard = true;
      }
    }
    room.phase = anyDiscard ? 'DISCARD' : 'ROBBER';
  } else {
    const matching = room.board.hexes.filter(h => h.number === sum && h.id !== room.board.robberHexId && h.type !== 'water');
    for (const hex of matching) {
      for (const vId of hex.vertexIds) {
        const b = room.board.vertices[vId]?.building;
        if (b) {
          const owner = room.players.find(p => p.id === b.owner);
          const amt = b.type === 'city' ? 2 : 1;
          if (owner) {
            if (hex.type === 'gold') {
              owner.goldPending += amt;
              addLog(room, `${owner.avatar} ${owner.name} earned ${amt} Gold pick(s)!`, owner.color);
            } else if (RESOURCES.includes(hex.type)) {
              givePlayerResourceFromBank(room, owner, hex.type, amt);
            }
          }
        }
      }
    }
    checkGoldPhaseTransition(room);
    if (room.players.some(p => p.goldPending > 0)) {
      room.PreGoldPhase = 'MAIN';
      room.phase = 'GOLD_PICK';
    } else {
      room.phase = 'MAIN';
    }
  }
  broadcastRoom(room);
}

function handleMoveRobber(room, player, hexId) {
  if (room.phase !== 'ROBBER') return;
  const hex = room.board.hexes[hexId];
  if (!hex || hex.type === 'water' || hex.id === room.board.robberHexId) return;

  room.board.robberHexId = hex.id;
  addLog(room, `${player.avatar} ${player.name} moved the Robber`, player.color);

  const victimIds = new Set();
  for (const vId of hex.vertexIds) {
    const b = room.board.vertices[vId]?.building;
    if (b && b.owner !== player.id) victimIds.add(b.owner);
  }
  const victims = [...victimIds]
    .map(id => room.players.find(p => p.id === id))
    .filter(p => p && getTotalResources(p) > 0);

  if (victims.length > 0) {
    // Target victim with highest VP
    victims.sort((a, b) => getPlayerVP(room, b, false) - getPlayerVP(room, a, false));
    const victim = victims[0];
    const pool = [];
    RESOURCES.forEach(r => { for (let i = 0; i < victim.resources[r]; i++) pool.push(r); });
    if (pool.length > 0) {
      const stolen = pool[Math.floor(Math.random() * pool.length)];
      victim.resources[stolen]--;
      player.resources[stolen]++;
      addLog(room, `${player.avatar} ${player.name} stole 1 resource from ${victim.name}`, player.color);
    }
  }
  room.phase = 'MAIN';
  broadcastRoom(room);
}

function executeTradeBetweenPlayers(room, proposer, partner, trade) {
  if (!proposer || !partner || proposer.id === partner.id) return false;
  for (const r of RESOURCES) {
    if ((Number(trade.offer[r]) || 0) > (proposer.resources[r] || 0)) return false;
    if ((Number(trade.request[r]) || 0) > (partner.resources[r] || 0)) return false;
  }
  for (const r of RESOURCES) {
    const o = Number(trade.offer[r]) || 0;
    const req = Number(trade.request[r]) || 0;
    proposer.resources[r] = proposer.resources[r] - o + req;
    partner.resources[r] = partner.resources[r] - req + o;
  }
  addLog(room, `🤝 ${proposer.name} traded with ${partner.name}!`, proposer.color);
  room.activeTrade = null;
  broadcastRoom(room);
  return true;
}

function handleEndTurn(room, player) {
  if (room.phase !== 'MAIN') return;
  player.devCards.push(...player.newDevCards);
  player.newDevCards = [];
  player.playedDevCardThisTurn = false;
  player.proposedTradeThisTurn = false;
  player.freeRoads = 0;
  room.activeTrade = null;

  if (checkWinner(room)) return broadcastRoom(room);

  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  room.phase = 'ROLL';
  broadcastRoom(room);
}

// ============================================================================
// SOCKET.IO HANDLERS
// ============================================================================

io.on('connection', (socket) => {
  const safe = (fn) => (data = {}) => {
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

    room.settings = {
      boardRadius: clamp(newSettings.boardRadius, 1, 4, room.settings.boardRadius),
      goldTiles: clamp(newSettings.goldTiles, 0, 40, room.settings.goldTiles),
      desertTiles: clamp(newSettings.desertTiles, 0, 15, room.settings.desertTiles),
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

    if (oldRadius !== room.settings.boardRadius || oldGold !== room.settings.goldTiles) {
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

    const existingPorts = {};
    room.board.edges.forEach(e => { if (e.port) existingPorts[e.key] = e.port; });

    if (paintType === 'terrain') {
      hex.type = paintValue;
      if (paintValue === 'desert' || paintValue === 'water') hex.number = null;
      else if (!hex.number) hex.number = 6;
      room.board = rebuildBoardTopology(room.board.hexes, existingPorts, false);
    } else if (paintType === 'number') {
      if (hex.type !== 'water' && hex.type !== 'desert') {
        hex.number = paintValue === 'none' ? null : Number(paintValue);
      }
    } else if (paintType === 'robber') {
      if (hex.type !== 'water') room.board.robberHexId = hex.id;
    }
    broadcastRoom(room);
  }));

  socket.on('paintPort', safe(({ code, edgeId, portValue }) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id || room.status !== 'LOBBY') return;
    const edge = room.board.edges[edgeId];
    if (!edge || edge.hexIds.length !== 1) return;

    const existingPorts = {};
    room.board.edges.forEach(e => { if (e.port) existingPorts[e.key] = e.port; });
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

    if (v.building && v.building.owner === player.id && v.building.type === 'settlement') {
      handlePlaceCity(room, player, vertexId);
    } else if (!v.building) {
      handlePlaceSettlement(room, player, vertexId);
    }
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

    const responses = {};
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Colonist-Style HexSettlers (Hard Bots + Full Trade) running at http://localhost:${PORT}`);
});