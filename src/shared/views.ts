// MODULE: per-player filtered view of the game state (hides other hands, hidden tiles, dev cards) | DEPENDS ON: shared/registry, shared/state, shared/tileState, shared/types | USED BY: shared/index
import type { Registry } from './registry';
import { computeVP, totalCards } from './state';
import { visibleWildCards } from './tileState';
import type { GameState, Id } from './types';

/** The shared `ext` as one viewer may see it: other players' held wild tokens (fish) are hidden until the game is over. Same object when no token is held. */
function extFor(g: GameState, viewerId: Id, over: boolean): Record<string, any> {
  const tokens = g.ext?.core?.wildTokens;
  if (!tokens || over) return g.ext;
  return { ...g.ext, core: { ...g.ext.core, wildTokens: viewerId in tokens ? { [viewerId]: tokens[viewerId] } : {} } };
}

export function playerView(g: GameState, reg: Registry, viewerId: Id): any {
  const over = g.phase === 'gameover';

  const players = g.players.map(p => {
    const self = p.id === viewerId;
    const reveal = self || over;
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      color: p.color,
      isBot: p.isBot,
      difficulty: p.difficulty,
      resourceCount: totalCards(p) + visibleWildCards(g, reg, p.id),
      resources: reveal ? p.resources : undefined,
      devCardCount: p.devCards.length + p.newDevCards.length,
      devCards: self ? p.devCards : undefined,
      newDevCards: self ? p.newDevCards : undefined,
      pieces: p.pieces,
      pending: p.pending,
      stats: p.stats,
      flags: self ? p.flags : undefined,
      vp: computeVP(g, reg, p, reveal)
    };
  });

  const view: any = {
    viewerId,
    packs: g.packs,
    rules: g.rules,
    // Hidden hexes never leak their real type or number.
    board: {
      ...g.board,
      hexes: g.board.hexes.map(h =>
        h.ext.hidden ? { ...h, type: h.ext.maskAs || 'hidden', number: null, ext: { hidden: true } } : h
      )
    },
    bank: g.bank,
    deckCount: g.deck.length,
    turn: g.turn,
    turnCount: g.turnCount,
    currentPlayerId: g.players[g.turn]?.id,
    phase: g.phase,
    setup: { lastVertexId: g.setup.lastVertexId },
    dice: g.dice,
    diceStats: g.diceStats,
    awards: g.awards,
    trade: g.trade,
    trades: g.trades,
    winner: g.winner,
    log: g.log,
    ext: extFor(g, viewerId, over),
    players
  };

  for (const hook of reg.hooks.onView) hook(g, reg, viewerId, view);
  return view;
}
