// MODULE: contextual bot trash talk and chat reactions on game events | USED BY: server/game
import type { GameEvent, PlayerState } from '../../shared';
import type { Room } from '../types';

const lastChatAt = new Map<string, number>();

const LINES = {
  rolledSeven: [
    'Seven! Pay the tax, everyone.',
    'Time to collect some rent.',
    'Nobody is safe with 8+ cards!',
    'Ooh, a 7. Who looks the richest right now?'
  ],
  robbedVictim: [
    'Hey! I needed that card!',
    'Seriously?! Rob the leader, not me!',
    'I will remember this betrayal.',
    'My brick! You will pay for that.'
  ],
  robberThief: [
    'Thanks for the donation!',
    'Pleasure doing business with you.',
    'Just borrowing this, promise.',
    'Nothing personal, strictly optimal.'
  ],
  monopoly: [
    'Hand it ALL over! Monopoly time!',
    'All your resources belong to me now.',
    'Thanks for saving those up for me!'
  ],
  knight: [
    'Marching the army out!',
    'Get off my tile, robber.',
    'Another Knight for the collection.'
  ],
  longestRoad: [
    'Longest Road is mine! Catch me if you can.',
    'All roads lead to my victory.',
    'That highway took serious planning!'
  ],
  largestArmy: [
    'Largest Army secured! Bow before the knights.',
    'Nobody messes with this army.',
    'Two more points from sheer military might!'
  ],
  cityBuilt: [
    'Another metropolis online!',
    'Double production starts now.',
    'Upgrading to a city—good luck stopping me.'
  ],
  tradeCompleted: [
    'Good trade, pleasure doing business.',
    'Deal! That works for both of us.',
    'Fair swap.'
  ],
  wonGame: [
    'GG! Calculated from turn 1.',
    'Good game everyone! Rematch?',
    'Victory! My resource engine was unstoppable.'
  ]
};

function pick(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)];
}

function pushBotChat(room: Room, bot: PlayerState, text: string, force = false): void {
  const now = Date.now();
  const prev = lastChatAt.get(room.code) || 0;
  if (!force && now - prev < 2200) return;
  lastChatAt.set(room.code, now);
  room.chats.push({
    sender: bot.name,
    avatar: bot.avatar,
    color: bot.color,
    text
  });
  if (room.chats.length > 60) room.chats.shift();
}

export function emitBotDialogue(room: Room, actorId: string, actionType: string, events: GameEvent[]): void {
  const g = room.game;
  if (!g) return;
  const actor = g.players.find(p => p.id === actorId);

  for (const ev of events) {
    const d = ev.data ?? {};

    if (ev.type === 'gameOver') {
      const winner = g.players.find(p => p.id === d.playerId);
      if (winner?.isBot) {
        pushBotChat(room, winner, pick(LINES.wonGame), true);
      }
      return;
    }

    if (ev.type === 'awardChanged') {
      const holder = g.players.find(p => p.id === d.playerId);
      if (holder?.isBot) {
        const pool = d.award === 'longestRoad' ? LINES.longestRoad : LINES.largestArmy;
        pushBotChat(room, holder, pick(pool), true);
      }
    }

    if (ev.type === 'devPlayed' && actor?.isBot) {
      if (d.card === 'monopoly') {
        pushBotChat(room, actor, pick(LINES.monopoly), true);
      } else if (d.card === 'knight' && Math.random() < 0.45) {
        pushBotChat(room, actor, pick(LINES.knight));
      }
    }

    if (ev.type === 'rolled' && d.sum === 7 && actor?.isBot && Math.random() < 0.55) {
      pushBotChat(room, actor, pick(LINES.rolledSeven));
    }

    if (ev.type === 'transferred' && d.kind === 'steal') {
      const victim = g.players.find(p => p.id === d.from);
      const thief = g.players.find(p => p.id === d.to);
      if (victim?.isBot && Math.random() < 0.65) {
        pushBotChat(room, victim, pick(LINES.robbedVictim));
      } else if (thief?.isBot && Math.random() < 0.5) {
        pushBotChat(room, thief, pick(LINES.robberThief));
      }
    }

    if (ev.type === 'built' && d.piece === 'city' && actor?.isBot && Math.random() < 0.5) {
      pushBotChat(room, actor, pick(LINES.cityBuilt));
    }
  }

  if (actionType === 'confirm_trade' && actor?.isBot && Math.random() < 0.45) {
    pushBotChat(room, actor, pick(LINES.tradeCompleted));
  }
}
