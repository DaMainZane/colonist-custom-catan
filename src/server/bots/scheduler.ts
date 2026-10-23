import {
  executeTradeBetweenPlayers,
  handleEndTurn,
  handleMoveRobber,
  handlePlaceCity,
  handlePlaceRoad,
  handlePlaceSettlement,
  handleRollDice,
  handleStealFromVictim
} from '../actions';
import { RESOURCES } from '../constants';
import { broadcastRoom } from '../net';
import { addLog } from '../rooms';
import {
  advanceSetupTurn,
  canPlaceSettlement,
  checkGoldPhaseTransition,
  checkWinner,
  givePlayerResourceFromBank,
  updateLargestArmy
} from '../rules';
import type { Player, Room } from '../types';
import {
  analyzeBotStrategy,
  chooseBestGoldResourceForBot,
  chooseBestRoadForHardBot,
  chooseBestRobberHexForHardBot,
  evaluateTradeForHardBot,
  scoreVertexForHardBot,
  tryHardBotBankTrade,
  tryHardBotProposeTrade
} from './strategy';

export function scheduleBotAction(room: Room): void {
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

function runBotTurnStep(room: Room, bot: Player): void {
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
  } else if (room.phase === 'ROBBER_STEAL') {
    const victimId = (room.robberVictims || [])[0];
    if (victimId) handleStealFromVictim(room, bot, victimId);
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

function playBotDevCard(room: Room, bot: Player, cardType: string): void {
  const idx = bot.devCards.indexOf(cardType);
  if (idx === -1) return;
  bot.devCards.splice(idx, 1);
  bot.playedDevCardThisTurn = true;

  if (cardType === 'knight') {
    bot.knightsPlayed++;
    addLog(room, `${bot.avatar} ${bot.name} played a Knight`, bot.color);
    updateLargestArmy(room);
    checkWinner(room);
    room.PreRobberPhase = room.phase;
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
