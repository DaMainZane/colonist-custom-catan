// MODULE: game engine (createGame, dispatch pipeline, legal actions, awards, win check) | USED BY: server adapter, bots, sims, tests
import { makeCtx } from './ctx';
import type { Ctx, GameEvent } from './ctx';
import { generateBoard } from './mapgen';
import { AVATARS, PLAYER_COLORS } from './palette';
import { scaledPieceLimit } from './pricing';
import { mergeRules } from './registry';
import type { Registry } from './registry';
import { createRng, randomSeed, rngShuffle } from './rng';
import { currentPlayer, getPlayer, score, setPhase } from './state';
import type { Board, GameState, Id, PlayerState, Rules } from './types';

export interface PlayerInit {
  id: Id;
  name: string;
  avatar?: string;
  color?: string;
  isBot?: boolean;
  difficulty?: string | null;
}

export interface GameConfig {
  players: PlayerInit[];
  rules?: Record<string, any>;
  seed?: number;
  /** Use a prepared board (e.g. from the lobby or map editor) instead of generating one. */
  board?: Board;
  preset?: string;
  /** Default true: randomize turn order. */
  shuffleSeats?: boolean;
}

export interface Action { type: string; playerId: Id; payload?: any }
// Both fields are declared on both branches: with `strict: false` TS does not narrow on `ok`, so `res.error` / `res.events` must be readable either way.
export type DispatchResult =
  | { ok: true; events: GameEvent[]; error?: undefined }
  | { ok: false; error: string; events?: undefined };

export function makeSetupOrder(n: number): number[] {
  const forward = Array.from({ length: n }, (_, i) => i);
  return [...forward, ...[...forward].reverse()];
}

export function createGame(reg: Registry, cfg: GameConfig): GameState {
  const seed = cfg.seed ?? randomSeed();
  const rng = createRng(seed);
  const rules: Rules = mergeRules(reg.rules, cfg.rules ?? {});
  if ((rules.vpToWin > 10 || rules.boardRadius > 2) && rules.pieceLimits) {
    const mult = Math.max(1, rules.vpToWin / 10);
    const explicit = cfg.rules?.pieceLimits ?? {};
    const scaled: Record<string, number> = { ...rules.pieceLimits };
    for (const [id, base] of Object.entries(reg.rules.pieceLimits ?? {})) {
      if (explicit[id] === undefined && scaled[id] === base) {
        if (reg.pieces.get(id)?.scaleWithRadius) {
          scaled[id] = scaledPieceLimit(base as number, rules.vpToWin, rules.boardRadius);
        } else if (rules.vpToWin > 10) {
          scaled[id] = Math.ceil((base as number) * mult);
        }
      }
    }
    rules.pieceLimits = scaled;
  }
  const board = cfg.board ?? generateBoard(reg, rules, rng, cfg.preset);
  const seats = cfg.shuffleSeats === false ? cfg.players : rngShuffle(rng, cfg.players);

  const resIds = [...reg.resources.keys()];
  const zero = (): Record<string, number> => Object.fromEntries(resIds.map(r => [r, 0]));

  const players: PlayerState[] = seats.map((pi, idx) => ({
    id: pi.id,
    name: pi.name,
    avatar: pi.avatar ?? (pi.isBot ? '🤖' : AVATARS[idx % AVATARS.length]),
    color: pi.color ?? PLAYER_COLORS[idx % PLAYER_COLORS.length],
    isBot: !!pi.isBot,
    difficulty: pi.difficulty ?? (pi.isBot ? 'ADVANCED HARD' : null),
    resources: zero(),
    devCards: [],
    newDevCards: [],
    pieces: Object.fromEntries([...reg.pieces.keys()].map(id => [id, rules.pieceLimits[id] ?? 0])),
    pending: {},
    stats: {},
    flags: {}
  }));

  const deck: string[] = [];
  for (const id of reg.devcards.keys()) {
    for (let i = 0; i < (rules.devCounts[id] ?? 0); i++) deck.push(id);
  }

  const order = makeSetupOrder(players.length);
  const g: GameState = {
    version: 2,
    seed,
    rng,
    packs: [...reg.packs],
    rules,
    board,
    players,
    bank: Object.fromEntries(resIds.map(r => [r, rules.bankPerResource])),
    deck: rngShuffle(rng, deck),
    turn: order[0],
    turnCount: 0,
    round: 0,
    phase: 'setup_settlement',
    phaseStack: [],
    setup: { order, step: 0, lastVertexId: null },
    dice: [0, 0],
    diceStats: {},
    awards: Object.fromEntries([...reg.awards.keys()].map(id => [id, null])),
    trade: null,
    trades: [],
    winner: null,
    log: [],
    ext: {}
  };

  const ctx = makeCtx(g, reg);
  const first = currentPlayer(g);
  ctx.log(`🎲 Turn order randomized! ${first.avatar} ${first.name} goes first!`, first.color);
  for (const hook of reg.hooks.onGameStart) hook(ctx);
  return g;
}

// ---- Dispatch -----------------------------------------------------------

function canAct(g: GameState, reg: Registry, pid: Id, type: string): boolean {
  const def = reg.actions.get(type);
  const phase = reg.phases.get(g.phase);
  if (!def || !phase) return false;
  const rule = def.actor ?? phase.actor;
  return rule ? !!rule(g, pid) : currentPlayer(g)?.id === pid;
}

/** Returns null if the action is allowed right now, otherwise the reason it is not. */
export function checkAction(g: GameState, reg: Registry, action: Action): string | null {
  if (g.phase === 'gameover') return 'The game is over';
  if (!getPlayer(g, action.playerId)) return 'Unknown player';
  const phase = reg.phases.get(g.phase);
  if (!phase) return `Unknown phase "${g.phase}"`;
  if (!phase.actions.includes(action.type)) return `"${action.type}" is not allowed during ${phase.label}`;
  if (!canAct(g, reg, action.playerId, action.type)) return 'Not your turn';
  const def = reg.actions.get(action.type)!;
  return def.validate(makeCtx(g, reg), action.playerId, action.payload ?? {});
}

/** Validates and applies one action. Mutates g. Humans and bots both go through here. */
export function dispatch(g: GameState, reg: Registry, action: Action): DispatchResult {
  const error = checkAction(g, reg, action);
  if (error) return { ok: false, error };
  const ctx = makeCtx(g, reg);
  try {
    reg.actions.get(action.type)!.apply(ctx, action.playerId, action.payload ?? {});
    finalize(ctx, action.type);
    return { ok: true, events: ctx.events };
  } catch (e: any) {
    return { ok: false, error: `Internal error: ${e?.message ?? e}` };
  }
}

function finalize(ctx: Ctx, actionType: string): void {
  updateAwards(ctx, actionType);
  for (const hook of ctx.reg.hooks.afterAction) hook(ctx, actionType);
  checkWinner(ctx);
}

export function updateAwards(ctx: Ctx, actionType: string): void {
  const { g } = ctx;
  for (const a of ctx.reg.awards.values()) {
    if (a.recomputeOn && !a.recomputeOn.includes(actionType)) continue;
    let best = a.min - 1;
    const holderId = g.awards[a.id];
    if (holderId) {
      const holder = getPlayer(g, holderId)!;
      const len = a.metric(ctx, holder);
      holder.stats[a.id] = len;
      if (len >= a.min) best = len;
      else g.awards[a.id] = null;
    }
    for (const p of g.players) {
      const len = a.metric(ctx, p);
      p.stats[a.id] = len;
      if (len > best) {
        best = len;
        g.awards[a.id] = p.id;
        ctx.log(`${p.avatar} ${p.name} claimed ${a.name} (${best})!`, p.color);
        ctx.emit('awardChanged', { award: a.id, playerId: p.id, value: best });
      }
    }
  }
}

export function checkWinner(ctx: Ctx): boolean {
  const { g, reg } = ctx;
  if (g.phase === 'gameover') return true;
  for (const p of g.players) {
    const vp = score(g, reg, p);
    if (vp >= g.rules.vpToWin) {
      g.winner = { id: p.id, name: p.name, vp, color: p.color };
      g.trade = null;
      g.trades = [];
      g.phaseStack = [];
      setPhase(ctx, 'gameover');
      ctx.log(`🏆 ${p.name} wins the game with ${vp} VP!`, p.color);
      ctx.emit('gameOver', { playerId: p.id, vp });
      return true;
    }
  }
  return false;
}

// ---- Legal actions (bots, fuzz tests, UI hints) ---------------------------

export function legalActions(g: GameState, reg: Registry, pid: Id): { type: string; payload: any }[] {
  const phase = reg.phases.get(g.phase);
  if (!phase || g.phase === 'gameover') return [];
  const ctx = makeCtx(g, reg);
  const out: { type: string; payload: any }[] = [];
  for (const type of phase.actions) {
    const def = reg.actions.get(type);
    if (!def?.legal || !canAct(g, reg, pid, type)) continue;
    for (const payload of def.legal(ctx, pid)) {
      if (!def.validate(ctx, pid, payload)) out.push({ type, payload });
    }
  }
  return out;
}

/** Players who may act right now (one normally, several during discard/pick/trade responses). */
export function activeActors(g: GameState, reg: Registry): Id[] {
  const phase = reg.phases.get(g.phase);
  if (!phase || g.phase === 'gameover') return [];
  return g.players
    .filter(p => phase.actions.some(t => canAct(g, reg, p.id, t) && legalActions(g, reg, p.id).length > 0))
    .map(p => p.id);
}
