// MODULE: Turn history recorder & round summarizer | DEPENDS ON: server/types, shared/index | USED BY: server/game, server/types
import type { GameEvent } from '../shared';
import type { Room } from './types';

export interface TurnActionResource {
  resource: string;
  amount: number;
  sign?: '+' | '-' | '';
}

export interface TurnActionItem {
  category: 'roll' | 'produce' | 'build' | 'rob' | 'dev' | 'trade' | 'discard' | 'event' | 'award';
  icon: string;
  text: string;
  badge?: string;
  resources?: TurnActionResource[];
  piece?: string;
  devCard?: string;
  diceSum?: number;
  timestamp: number;
}

export interface PlayerTurnSummary {
  turnCount: number;
  playerId: string;
  playerName: string;
  playerAvatar: string;
  playerColor: string;
  isBot: boolean;
  actions: TurnActionItem[];
}

export interface RoundSummary {
  round: number; // 0 = Setup Phase, 1 = Round 1, etc.
  title: string;
  turns: PlayerTurnSummary[];
}

const RESOURCE_NAMES: Record<string, string> = {
  wood: 'Wood',
  brick: 'Brick',
  sheep: 'Sheep',
  wheat: 'Wheat',
  ore: 'Ore',
  gold: 'Gold',
  fish: 'Fish'
};

/**
 * Records key player actions, resource card changes, and engine events into structured round/turn summaries
 * for the unified Live Log & Turn History view.
 */
export function recordTurnHistory(
  room: Room,
  playerId: string,
  actionType: string,
  payload: any,
  events: GameEvent[]
): void {
  const g = room.game;
  if (!g) return;

  room.turnHistory = room.turnHistory || [];

  const isSetup = g.phase.startsWith('setup') || (g.turnCount || 0) === 0;
  const currentRound = isSetup ? 0 : Math.max(1, g.round || 1);
  const roundTitle = isSetup ? 'Setup Phase' : `Round ${currentRound}`;

  let roundSummary = room.turnHistory.find(r => r.round === currentRound);
  if (!roundSummary) {
    roundSummary = {
      round: currentRound,
      title: roundTitle,
      turns: []
    };
    room.turnHistory.push(roundSummary);
  }

  const p = g.players.find(x => x.id === playerId) || room.lobbyPlayers.find(x => x.id === playerId);
  const turnCount = g.turnCount || 0;

  let turnSummary: PlayerTurnSummary | undefined;
  if (isSetup) {
    const existing = roundSummary.turns.filter(t => t.playerId === playerId);
    const latest = existing[existing.length - 1];
    const hasSettle = latest?.actions.some(a => a.category === 'build' && a.piece === 'settlement');
    const hasRoad = latest?.actions.some(a => a.category === 'build' && a.piece === 'road');
    if (!latest || (hasSettle && hasRoad && (actionType === 'placeSettlement' || actionType === 'buildSettlement' || (actionType === 'build' && payload?.piece === 'settlement')))) {
      turnSummary = {
        turnCount: 0,
        playerId,
        playerName: p?.name || 'Player',
        playerAvatar: p?.avatar || '👤',
        playerColor: p?.color || '#888',
        isBot: !!p?.isBot,
        actions: []
      };
      roundSummary.turns.push(turnSummary);
    } else {
      turnSummary = latest;
    }
  } else {
    turnSummary = roundSummary.turns.find(t => t.playerId === playerId && t.turnCount === turnCount);
    if (!turnSummary) {
      turnSummary = {
        turnCount,
        playerId,
        playerName: p?.name || 'Player',
        playerAvatar: p?.avatar || '👤',
        playerColor: p?.color || '#888',
        isBot: !!p?.isBot,
        actions: []
      };
      roundSummary.turns.push(turnSummary);
    }
  }

  const now = Date.now();

  // Aggregate productions per player so every player's resource gains show with RS card icons
  const productionsByPlayer = new Map<string, Record<string, number>>();
  const bankGiveMap: Record<string, number> = {};
  const bankGetMap: Record<string, number> = {};
  const p2pGiveMap: Record<string, number> = {};
  const p2pGetMap: Record<string, number> = {};
  let p2pPartnerName = '';
  const discardByPlayer = new Map<string, Record<string, number>>();
  const monopolyMap: Record<string, number> = {};

  for (const ev of events) {
    const d = ev.data ?? {};
    switch (ev.type) {
      case 'rolled': {
        const sum = d.sum ?? (d.d1 + d.d2);
        const d1 = d.d1 ?? Math.floor(sum / 2);
        const d2 = d.d2 ?? (sum - d1);
        if (sum === 7) {
          turnSummary.actions.push({
            category: 'roll',
            icon: 'roll',
            diceSum: 7,
            badge: '7',
            text: 'Rolled 7 — Robber activated',
            timestamp: now
          });
        } else {
          turnSummary.actions.push({
            category: 'roll',
            icon: 'roll',
            diceSum: sum,
            badge: String(sum),
            text: `Rolled ${sum} (${d1} + ${d2})`,
            timestamp: now
          });
        }
        break;
      }

      case 'produced': {
        const pid = d.playerId || playerId;
        if (d.resource && d.amount > 0) {
          const map = productionsByPlayer.get(pid) || {};
          map[d.resource] = (map[d.resource] || 0) + d.amount;
          productionsByPlayer.set(pid, map);
        }
        break;
      }

      case 'built': {
        const piece = d.piece || payload?.piece || 'settlement';
        let text = 'Built piece';
        let badge = piece;
        if (piece === 'settlement') {
          text = isSetup ? 'Placed initial Settlement' : 'Built Settlement';
          badge = 'Settlement';
        } else if (piece === 'city') {
          text = 'Upgraded to City';
          badge = 'City';
        } else if (piece === 'road') {
          text = isSetup ? 'Placed initial Road' : 'Built Road';
          badge = 'Road';
        } else if (piece === 'bridge') {
          text = 'Built Bridge';
          badge = 'Bridge';
        } else if (piece === 'rickety_bridge') {
          text = 'Built Rickety Bridge';
          badge = 'Rickety Bridge';
        } else if (piece === 'net') {
          text = 'Placed Fishing Net';
          badge = 'Net';
        } else {
          text = `Built ${piece}`;
          badge = piece;
        }
        turnSummary.actions.push({
          category: 'build',
          icon: piece,
          piece,
          badge,
          text,
          timestamp: now
        });
        break;
      }

      case 'robberMoved': {
        turnSummary.actions.push({
          category: 'rob',
          icon: 'robber',
          badge: `Hex #${d.hexId}`,
          text: `Moved Robber to hex #${d.hexId}`,
          timestamp: now
        });
        break;
      }

      case 'transferred': {
        const amt = Number(d.amount) || 1;
        const res = d.resource || '';
        if (d.kind === 'steal') {
          const victim = g.players.find(x => x.id === d.from);
          const victimName = victim?.name || d.from || 'player';
          turnSummary.actions.push({
            category: 'rob',
            icon: 'steal',
            badge: 'Rob',
            resources: [{ resource: 'mystery', amount: amt, sign: '+' }],
            text: `Robbed from ${victimName}`,
            timestamp: now
          });
        } else if (d.kind === 'discard') {
          const discId = d.from || playerId;
          const map = discardByPlayer.get(discId) || {};
          const key = res || 'mystery';
          map[key] = (map[key] || 0) + amt;
          discardByPlayer.set(discId, map);
        } else if (d.kind === 'playerTrade') {
          const partnerId = d.from === playerId ? d.to : d.from;
          const partner = g.players.find(x => x.id === partnerId);
          if (partner?.name) p2pPartnerName = partner.name;
          if (res) {
            if (d.from === playerId) p2pGiveMap[res] = (p2pGiveMap[res] || 0) + amt;
            else p2pGetMap[res] = (p2pGetMap[res] || 0) + amt;
          }
        } else if (d.kind === 'bankTrade') {
          if (res) {
            if (d.from === playerId) bankGiveMap[res] = (bankGiveMap[res] || 0) + amt;
            else if (d.to === playerId) bankGetMap[res] = (bankGetMap[res] || 0) + amt;
          }
        } else if (d.kind === 'monopoly') {
          if (res) monopolyMap[res] = (monopolyMap[res] || 0) + amt;
        } else if (d.kind === 'pick' || d.kind === 'gold') {
          if (res) {
            turnSummary.actions.push({
              category: 'produce',
              icon: res,
              badge: `+${amt}`,
              resources: [{ resource: res, amount: amt, sign: '+' }],
              text: 'Picked resource',
              timestamp: now
            });
          }
        }
        break;
      }

      case 'devBought': {
        turnSummary.actions.push({
          category: 'dev',
          icon: 'dev',
          devCard: 'back',
          badge: 'Dev Card',
          text: 'Bought Development Card',
          timestamp: now
        });
        break;
      }

      case 'devPlayed': {
        const card = d.card || payload?.card || 'dev';
        let cardTitle = 'Development Card';
        if (card === 'knight') cardTitle = 'Knight';
        else if (card === 'roadBuilding') cardTitle = 'Road Building';
        else if (card === 'yearOfPlenty') cardTitle = 'Year of Plenty';
        else if (card === 'monopoly') cardTitle = 'Monopoly';
        turnSummary.actions.push({
          category: 'dev',
          icon: card,
          devCard: card,
          badge: cardTitle,
          text: `Played ${cardTitle}`,
          timestamp: now
        });
        break;
      }

      case 'bridgeUpgraded': {
        turnSummary.actions.push({
          category: 'build',
          icon: 'bridge',
          piece: 'bridge',
          badge: 'Bridge',
          text: 'Upgraded Rickety Bridge to Bridge',
          timestamp: now
        });
        break;
      }

      case 'bridgeDemolished': {
        const resList: TurnActionResource[] = Object.entries((d.resources || {}) as Record<string, number>)
          .filter(([, n]) => n > 0)
          .map(([resource, amount]) => ({ resource, amount, sign: '+' as const }));
        turnSummary.actions.push({
          category: 'build',
          icon: 'bridge',
          piece: 'bridge',
          badge: 'Demolish',
          resources: resList.length > 0 ? resList : undefined,
          text: `Demolished ${d.piece === 'rickety_bridge' ? 'Rickety Bridge' : 'Bridge'}`,
          timestamp: now
        });
        break;
      }

      case 'harborUpgraded': {
        turnSummary.actions.push({
          category: 'build',
          icon: 'harbor',
          piece: 'harbor',
          badge: 'Harbor',
          text: 'Upgraded port city to 1:1 Harbor',
          timestamp: now
        });
        break;
      }

      case 'portUpgraded': {
        turnSummary.actions.push({
          category: 'build',
          icon: 'harbor',
          piece: 'harbor',
          badge: '2:1 Port',
          text: 'Raised 3:1 port to 2:1',
          timestamp: now
        });
        break;
      }

      case 'seaFed': {
        turnSummary.actions.push({
          category: 'produce',
          icon: 'fish',
          badge: 'Feed Sea',
          resources: [{ resource: 'wheat', amount: 1, sign: '-' }],
          text: `Fed fishing ground on tile #${d.hexId}`,
          timestamp: now
        });
        break;
      }

      case 'techResearched': {
        const techName = d.name || d.techId || 'Tech';
        turnSummary.actions.push({
          category: 'dev',
          icon: 'tech',
          badge: 'Tech',
          text: `Researched ${techName}`,
          timestamp: now
        });
        break;
      }

      case 'pieceBroken': {
        const pieceLabel = d.piece === 'rickety_bridge' ? 'Rickety Bridge' : (d.piece || 'Piece');
        const owner = g.players.find(x => x.id === d.ownerId);
        turnSummary.actions.push({
          category: 'event',
          icon: 'bridge',
          piece: d.piece || 'bridge',
          badge: 'Collapsed',
          text: owner ? `${owner.name}'s ${pieceLabel} collapsed` : `${pieceLabel} collapsed`,
          timestamp: now
        });
        break;
      }

      case 'pirateSpawned': {
        turnSummary.actions.push({
          category: 'event',
          icon: 'pirate',
          badge: `Strength ${d.strength}`,
          text: `Pirate ship appeared on tile #${d.hexId}`,
          timestamp: now
        });
        break;
      }

      case 'pirateRobbed': {
        const victim = g.players.find(x => x.id === d.victimId);
        const n = Number(d.amount) || 0;
        turnSummary.actions.push({
          category: 'rob',
          icon: 'pirate',
          badge: n > 0 ? `-${n}` : 'Raid',
          resources: n > 0 ? [{ resource: 'mystery', amount: n, sign: '-' }] : undefined,
          text: n > 0
            ? `Pirates robbed ${victim?.name || 'a player'}`
            : `Pirates raided ${victim?.name || 'a player'} (no cards)`,
          timestamp: now
        });
        break;
      }

      case 'pirateFleeing': {
        turnSummary.actions.push({
          category: 'event',
          icon: 'pirate',
          badge: 'Fleeing',
          text: 'Pirate ship fled for open water',
          timestamp: now
        });
        break;
      }

      case 'pirateDriven': {
        const driver = g.players.find(x => x.id === d.playerId);
        const amt = Number(d.amount) || 0;
        turnSummary.actions.push({
          category: 'event',
          icon: 'pirate',
          badge: 'Pirate',
          resources: d.resource && amt > 0 ? [{ resource: d.resource, amount: amt, sign: '+' }] : undefined,
          text: `${driver?.name || 'Player'} drove off pirate (str ${d.strength})`,
          timestamp: now
        });
        break;
      }

      case 'awardChanged': {
        const name = d.award === 'longestRoad' ? 'Longest Road' : d.award === 'largestArmy' ? 'Largest Army' : d.award;
        const val = d.value ?? d.count;
        const winner = d.playerId ? g.players.find(x => x.id === d.playerId) : null;
        const prev = d.previousHolderId ? g.players.find(x => x.id === d.previousHolderId) : null;
        const text = d.playerId
          ? `${winner && winner.id !== playerId ? `${winner.name} claimed` : 'Claimed'} ${name}${val !== undefined ? ` (${val})` : ''}`
          : `${prev ? `${prev.name} lost` : 'Lost'} ${name}`;
        turnSummary.actions.push({
          category: 'award',
          icon: 'award',
          badge: name,
          text,
          timestamp: now
        });
        break;
      }

      case 'eventDrawn': {
        turnSummary.actions.push({
          category: 'event',
          icon: 'event',
          badge: d.title || 'Event',
          text: `Event: ${d.title}`,
          timestamp: now
        });
        break;
      }

      case 'gameOver': {
        const winner = g.players.find(x => x.id === d.winnerId);
        turnSummary.actions.push({
          category: 'award',
          icon: 'winner',
          badge: 'Winner',
          text: `${winner?.name || 'Player'} won the game!`,
          timestamp: now
        });
        break;
      }
    }
  }

  // Push consolidated production actions (actor first, then any other players who produced on this roll)
  const orderedProdPids = [
    ...(productionsByPlayer.has(playerId) ? [playerId] : []),
    ...[...productionsByPlayer.keys()].filter(id => id !== playerId)
  ];
  for (const pid of orderedProdPids) {
    const prodMap = productionsByPlayer.get(pid)!;
    const prodEntries = Object.entries(prodMap).filter(([, a]) => a > 0);
    if (prodEntries.length === 0) continue;
    const prodPlayer = g.players.find(x => x.id === pid);
    const total = prodEntries.reduce((s, [, a]) => s + a, 0);
    const resources: TurnActionResource[] = prodEntries.map(([resource, amount]) => ({
      resource,
      amount,
      sign: '+'
    }));
    const label = pid === playerId ? 'Produced' : `${prodPlayer?.name || 'Player'} got`;
    turnSummary.actions.push({
      category: 'produce',
      icon: prodEntries[0][0],
      badge: `+${total}`,
      resources,
      text: label,
      timestamp: now
    });
  }

  // Push consolidated discards
  for (const [discId, discMap] of discardByPlayer.entries()) {
    const entries = Object.entries(discMap).filter(([, a]) => a > 0);
    if (entries.length === 0) continue;
    const discPlayer = g.players.find(x => x.id === discId);
    const total = entries.reduce((s, [, a]) => s + a, 0);
    const resources: TurnActionResource[] = entries.map(([resource, amount]) => ({
      resource,
      amount,
      sign: '-'
    }));
    turnSummary.actions.push({
      category: 'discard',
      icon: entries[0][0],
      badge: `-${total}`,
      resources,
      text: `${discPlayer?.name || 'Player'} discarded`,
      timestamp: now
    });
  }

  // Push consolidated Bank Trade
  const bankGiveEntries = Object.entries(bankGiveMap);
  const bankGetEntries = Object.entries(bankGetMap);
  if (bankGiveEntries.length > 0 || bankGetEntries.length > 0) {
    const resources: TurnActionResource[] = [
      ...bankGiveEntries.map(([resource, amount]) => ({ resource, amount, sign: '-' as const })),
      ...bankGetEntries.map(([resource, amount]) => ({ resource, amount, sign: '+' as const }))
    ];
    turnSummary.actions.push({
      category: 'trade',
      icon: 'bank',
      badge: 'Bank',
      resources,
      text: 'Bank trade',
      timestamp: now
    });
  }

  // Push consolidated Player Trade
  const p2pGiveEntries = Object.entries(p2pGiveMap);
  const p2pGetEntries = Object.entries(p2pGetMap);
  if (p2pGiveEntries.length > 0 || p2pGetEntries.length > 0) {
    const resources: TurnActionResource[] = [
      ...p2pGiveEntries.map(([resource, amount]) => ({ resource, amount, sign: '-' as const })),
      ...p2pGetEntries.map(([resource, amount]) => ({ resource, amount, sign: '+' as const }))
    ];
    turnSummary.actions.push({
      category: 'trade',
      icon: 'trade',
      badge: 'Player Trade',
      resources,
      text: `Traded with ${p2pPartnerName || 'player'}`,
      timestamp: now
    });
  }

  // Push consolidated Monopoly
  for (const [res, amt] of Object.entries(monopolyMap)) {
    if (amt <= 0) continue;
    turnSummary.actions.push({
      category: 'dev',
      icon: 'monopoly',
      devCard: 'monopoly',
      badge: 'Monopoly',
      resources: [{ resource: res, amount: amt, sign: '+' }],
      text: `Monopolized ${RESOURCE_NAMES[res] || res}`,
      timestamp: now
    });
  }

  // If action was endTurn and no other actions happened this turn, log passed turn
  if ((actionType === 'endTurn' || actionType === 'end_turn') && turnSummary.actions.length === 0) {
    turnSummary.actions.push({
      category: 'roll',
      icon: 'pass',
      badge: 'Pass',
      text: 'Passed turn',
      timestamp: now
    });
  }
}
