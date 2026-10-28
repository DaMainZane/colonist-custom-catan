// MODULE: Turn history recorder & round summarizer | USED BY: server/game.ts, server/view.ts
import type { GameEvent, GameState } from '../shared';
import type { Room } from './types';

export interface TurnActionItem {
  category: 'roll' | 'produce' | 'build' | 'rob' | 'dev' | 'trade' | 'discard' | 'event' | 'award';
  icon: string;
  text: string;
  badge?: string;
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
  gold: 'Gold'
};

const RESOURCE_ICONS: Record<string, string> = {
  wood: '🌲',
  brick: '🧱',
  sheep: '🐑',
  wheat: '🌾',
  ore: '⛰️',
  gold: '🪙'
};

/**
 * Records key player actions and engine events into structured round summaries for high game transparency.
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
    const hasSettle = latest?.actions.some(a => a.category === 'build' && a.text.includes('Settlement'));
    const hasRoad = latest?.actions.some(a => a.category === 'build' && a.text.includes('Road'));
    if (!latest || (hasSettle && hasRoad && (actionType === 'placeSettlement' || actionType === 'buildSettlement'))) {
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

  // Aggregate productions for the actor
  const productionsMap: Record<string, number> = {};

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
            icon: '🎲',
            badge: '7',
            text: 'Rolled 7 — Robber activated!',
            timestamp: now
          });
        } else {
          turnSummary.actions.push({
            category: 'roll',
            icon: '🎲',
            badge: String(sum),
            text: `Rolled ${sum} (${d1} + ${d2})`,
            timestamp: now
          });
        }
        break;
      }

      case 'produced': {
        if (d.playerId === playerId && d.resource && d.amount > 0) {
          productionsMap[d.resource] = (productionsMap[d.resource] || 0) + d.amount;
        }
        break;
      }

      case 'built': {
        const piece = d.piece || payload?.piece || 'settlement';
        let text = 'Built piece';
        let icon = '🔨';
        let badge = piece;
        if (piece === 'settlement') {
          text = isSetup ? 'Placed initial Settlement' : 'Built Settlement';
          icon = '🏠';
          badge = 'Settlement';
        } else if (piece === 'city') {
          text = 'Upgraded to City';
          icon = '🏰';
          badge = 'City';
        } else if (piece === 'road') {
          text = isSetup ? 'Placed initial Road' : 'Built Road';
          icon = '🛣️';
          badge = 'Road';
        } else {
          text = `Built ${piece}`;
          badge = piece;
        }
        turnSummary.actions.push({
          category: 'build',
          icon,
          badge,
          text,
          timestamp: now
        });
        break;
      }

      case 'robberMoved': {
        turnSummary.actions.push({
          category: 'rob',
          icon: '🥷',
          badge: `#${d.hexId}`,
          text: `Moved Robber to hex #${d.hexId}`,
          timestamp: now
        });
        break;
      }

      case 'transferred': {
        if (d.kind === 'steal') {
          const victim = g.players.find(x => x.id === d.from);
          const victimName = victim?.name || d.from || 'player';
          turnSummary.actions.push({
            category: 'rob',
            icon: '⚔️',
            badge: 'Rob',
            text: `Robbed 1 resource from ${victimName}`,
            timestamp: now
          });
        } else if (d.kind === 'discard') {
          const discPlayer = g.players.find(x => x.id === d.from || x.id === d.to);
          turnSummary.actions.push({
            category: 'discard',
            icon: '🗑️',
            badge: `-${d.amount}`,
            text: `${discPlayer?.name || 'Player'} discarded ${d.amount} cards on 7`,
            timestamp: now
          });
        } else if (d.kind === 'playerTrade') {
          const partnerId = d.from === playerId ? d.to : d.from;
          const partner = g.players.find(x => x.id === partnerId);
          turnSummary.actions.push({
            category: 'trade',
            icon: '🤝',
            badge: 'Player Trade',
            text: `Traded with ${partner?.name || 'player'}`,
            timestamp: now
          });
        } else if (d.kind === 'bankTrade') {
          turnSummary.actions.push({
            category: 'trade',
            icon: '🏦',
            badge: 'Bank',
            text: 'Traded with the Bank',
            timestamp: now
          });
        } else if (d.kind === 'monopoly') {
          turnSummary.actions.push({
            category: 'dev',
            icon: '🃏',
            badge: 'Monopoly',
            text: `Monopolized ${d.amount} ${d.resource}!`,
            timestamp: now
          });
        }
        break;
      }

      case 'devBought': {
        turnSummary.actions.push({
          category: 'dev',
          icon: '🃏',
          badge: 'Dev Card',
          text: 'Bought a Development Card',
          timestamp: now
        });
        break;
      }

      case 'devPlayed': {
        const card = d.card || payload?.card || 'dev';
        let cardTitle = 'Development Card';
        let icon = '🃏';
        if (card === 'knight') {
          cardTitle = 'Knight';
          icon = '⚔️';
        } else if (card === 'roadBuilding') {
          cardTitle = 'Road Building (+2 roads)';
          icon = '🛣️';
        } else if (card === 'yearOfPlenty') {
          cardTitle = 'Year of Plenty (+2 picks)';
          icon = '🌾';
        } else if (card === 'monopoly') {
          cardTitle = 'Monopoly';
          icon = '💰';
        }
        turnSummary.actions.push({
          category: 'dev',
          icon,
          badge: cardTitle,
          text: `Played ${cardTitle}`,
          timestamp: now
        });
        break;
      }

      case 'awardChanged': {
        const name = d.award === 'longestRoad' ? 'Longest Road' : d.award === 'largestArmy' ? 'Largest Army' : d.award;
        turnSummary.actions.push({
          category: 'award',
          icon: '🏆',
          badge: name,
          text: `Claimed ${name} (${d.count})`,
          timestamp: now
        });
        break;
      }

      case 'eventDrawn': {
        turnSummary.actions.push({
          category: 'event',
          icon: '📜',
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
          icon: '👑',
          badge: 'Winner',
          text: `🏆 ${winner?.name || 'Player'} won the game!`,
          timestamp: now
        });
        break;
      }
    }
  }

  // Push consolidated production action if any resources were produced
  const prodEntries = Object.entries(productionsMap);
  if (prodEntries.length > 0) {
    const desc = prodEntries.map(([res, amt]) => {
      const ico = RESOURCE_ICONS[res] || '';
      const nm = RESOURCE_NAMES[res] || res;
      return `${ico} +${amt} ${nm}`.trim();
    }).join(', ');

    turnSummary.actions.push({
      category: 'produce',
      icon: '🌾',
      badge: `+${prodEntries.reduce((s, [, a]) => s + a, 0)}`,
      text: `Produced: ${desc}`,
      timestamp: now
    });
  }

  // If action was endTurn and no other actions happened this turn, log passed turn
  if (actionType === 'endTurn' && turnSummary.actions.length === 0) {
    turnSummary.actions.push({
      category: 'roll',
      icon: '⏭️',
      text: 'Passed turn',
      timestamp: now
    });
  }
}
