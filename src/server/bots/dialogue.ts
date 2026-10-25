// MODULE: contextual bot trash talk and chat reactions on game events (style follows the bot's tier) | USED BY: server/game
import type { GameEvent, PlayerState } from '../../shared';
import type { Room } from '../types';
import { tierFromDifficulty, tierProfile } from './tiers';

const lastChatAt = new Map<string, number>();

/** Friendly lines (Main). Secondary and Overload use their own sets below and fall back to these. */
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

type LineKey = keyof typeof LINES;

const STYLE_LINES: Record<'neutral' | 'cold', Partial<Record<LineKey, string[]>>> = {
  neutral: {
    rolledSeven: ['Seven.', 'Robber time.', 'Discard if you are over the limit.'],
    robbedVictim: ['Noted.', 'That hurt.', 'Targeting me was a choice.'],
    robberThief: ['Taking one.', 'Standard play.', 'Robber placement was efficient.'],
    monopoly: ['Monopoly.', 'Collecting.'],
    knight: ['Knight played.', 'Robber moves.'],
    longestRoad: ['Longest Road.', 'Road length secured.'],
    largestArmy: ['Largest Army.', 'Army secured.'],
    cityBuilt: ['City built.', 'Upgraded.'],
    tradeCompleted: ['Trade done.', 'Accepted.'],
    wonGame: ['Game over.', 'GG.']
  },
  cold: {
    rolledSeven: ['Seven. Count your cards.', 'The robber answers to me.', 'Some of you are about to lose half your hand.'],
    robbedVictim: ['That was a mistake.', 'I keep a list.', 'You will regret it.'],
    robberThief: ['Yours now mine.', 'You made this easy.', 'Predictable.'],
    monopoly: ['Everything you held was already mine.', 'Hand it over.'],
    knight: ['The robber moves where I say.', 'Another step closer.'],
    longestRoad: ['The road is mine. Try to take it.', 'Your roads are in my way.'],
    largestArmy: ['The army is mine.', 'Resistance is inefficient.'],
    cityBuilt: ['Expansion continues.', 'Production doubles. Yours will not.'],
    tradeCompleted: ['Acceptable.', 'You needed that more than I did.'],
    wonGame: ['As calculated.', 'You were never ahead.']
  }
};

function pick(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)];
}

/** One line for this bot: the set for its tier's chat style, or the friendly set when that style has none for the event. */
function say(bot: PlayerState, key: LineKey): string {
  const style = tierProfile(tierFromDifficulty(bot.difficulty)).chat;
  const pool = style === 'friendly' ? undefined : STYLE_LINES[style][key];
  return pick(pool && pool.length > 0 ? pool : LINES[key]);
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
        pushBotChat(room, winner, say(winner, 'wonGame'), true);
      }
      return;
    }

    if (ev.type === 'awardChanged') {
      const holder = g.players.find(p => p.id === d.playerId);
      if (holder?.isBot) {
        pushBotChat(room, holder, say(holder, d.award === 'longestRoad' ? 'longestRoad' : 'largestArmy'), true);
      }
    }

    if (ev.type === 'devPlayed' && actor?.isBot) {
      if (d.card === 'monopoly') {
        pushBotChat(room, actor, say(actor, 'monopoly'), true);
      } else if (d.card === 'knight' && Math.random() < 0.45) {
        pushBotChat(room, actor, say(actor, 'knight'));
      }
    }

    if (ev.type === 'rolled' && d.sum === 7 && actor?.isBot && Math.random() < 0.55) {
      pushBotChat(room, actor, say(actor, 'rolledSeven'));
    }

    if (ev.type === 'transferred' && d.kind === 'steal') {
      const victim = g.players.find(p => p.id === d.from);
      const thief = g.players.find(p => p.id === d.to);
      if (victim?.isBot && Math.random() < 0.65) {
        pushBotChat(room, victim, say(victim, 'robbedVictim'));
      } else if (thief?.isBot && Math.random() < 0.5) {
        pushBotChat(room, thief, say(thief, 'robberThief'));
      }
    }

    if (ev.type === 'built' && d.piece === 'city' && actor?.isBot && Math.random() < 0.5) {
      pushBotChat(room, actor, say(actor, 'cityBuilt'));
    }
  }

  if (actionType === 'confirm_trade' && actor?.isBot && Math.random() < 0.45) {
    pushBotChat(room, actor, say(actor, 'tradeCompleted'));
  }
}
