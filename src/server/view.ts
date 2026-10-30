// MODULE: client state builder (engine state -> the `gameState` shape the current client renders) | USED BY: server/net
import { encodeRecipe, getPlayer, isOtherVersion, publicVP, score, techPanelFor, totalCards, visibleWildCards, wildTokensOf } from '../shared';
import type { Board, GameState, PlayerState } from '../shared';
import { pieceCost } from '../packs/base/building';
import { victimsOnHex } from '../packs/base/robbing';
import { techActionsFor } from '../packs/base/techEffects';
import {
  FEED_SEA_COST,
  UPGRADE_HARBOR,
  bridgeUpgradeView,
  feedSpotsView,
  fishClientView,
  harborClientView,
  harborCount,
  harborLimitFor,
  harborSpotsView,
  harborTradesLeft,
  harborUpgradeCost,
  netSpotsView,
  pirateClientView,
  pirateDriveView,
  tideClientView,
  wreckClientView
} from '../packs/tidebound';
import { openTrades, tradeRatios } from '../packs/base/trading';
import { ensureTradeTimers } from './bots/scheduler';
import { roomStatus } from './rooms';
import { gameRegistry, registry } from './runtime';
import { syncTurnClock, turnClockView } from './turnClock';
import type { Room } from './types';

/** Engine phase ids -> the legacy phase names the client switches on. */
const PHASE_NAMES: Record<string, string> = {
  setup_settlement: 'SETUP_SETTLEMENT',
  setup_road: 'SETUP_ROAD',
  roll: 'ROLL',
  main: 'MAIN',
  discard: 'DISCARD',
  robber: 'ROBBER',
  robber_steal: 'ROBBER_STEAL',
  pick: 'GOLD_PICK',
  gameover: 'GAMEOVER'
};

/** Board in the legacy shape. Hidden (fog) hexes never leak their type or number before game over. */
export function clientBoard(board: Board, revealAll: boolean): any {
  return {
    hexes: board.hexes.map(h => {
      const { ext, ...rest } = h;
      const hidden = !!ext?.hidden;
      if (hidden && !revealAll) return { ...rest, type: ext.maskAs || 'fog', number: null, fog: true };
      return { ...rest, fog: hidden };
    }),
    vertices: board.vertices.map(v => {
      const { piece, ...rest } = v;
      return { ...rest, building: piece ? { owner: piece.owner, type: piece.type } : null };
    }),
    edges: board.edges.map(e => {
      const { piece, ...rest } = e;
      return { ...rest, road: piece ? piece.owner : null, pieceType: piece ? piece.type : null };
    }),
    robberHexId: board.robberHexId
  };
}

function zeroResources(): Record<string, number> {
  return Object.fromEntries([...registry.resources.keys()].map(r => [r, 0]));
}

function fillResources(partial: Record<string, number>): Record<string, number> {
  return { ...zeroResources(), ...partial };
}

function enginePlayerView(g: GameState, p: PlayerState, viewerId: string, over: boolean, isSpectator = false): any {
  const self = p.id === viewerId;
  const reveal = self || over || isSpectator;
  const reg = gameRegistry(g.rules);
  const harborsOn = reg.actions.has(UPGRADE_HARBOR);

  let settlementsOnBoard = 0;
  let citiesOnBoard = 0;
  for (const v of g.board.vertices) {
    if (v.piece?.owner !== p.id) continue;
    if (v.piece.type === 'settlement') settlementsOnBoard++;
    else if (v.piece.type === 'city') citiesOnBoard++;
  }
  let roadsOnBoard = 0;
  for (const e of g.board.edges) {
    if (e.piece?.owner === p.id && e.piece.type === 'road') roadsOnBoard++;
  }

  const allHeldDevs = [...p.devCards, ...p.newDevCards];
  const heldCount = (cardId: string) => allHeldDevs.filter(c => c === cardId).length;
  const vpCards = reveal ? heldCount('vp') : 0;

  return {
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    color: p.color,
    isBot: p.isBot,
    difficulty: p.difficulty,
    // Hand size as the table sees it: resource cards plus fish-like tokens (they count for a discard and can be stolen).
    resourceCount: totalCards(p) + visibleWildCards(g, reg, p.id),
    resources: reveal ? p.resources : undefined,
    // Held wild tokens ({ fish: n }), same visibility as the hand. Undefined when none are held, so a game without them sends nothing new.
    wildTokens: reveal && Object.keys(wildTokensOf(g, p.id)).length > 0 ? wildTokensOf(g, p.id) : undefined,
    devCardCount: p.devCards.length + p.newDevCards.length,
    devCards: reveal ? p.devCards : undefined,
    newDevCards: reveal ? p.newDevCards : undefined,
    knightsPlayed: p.stats.knightsPlayed || 0,
    longestRoadLength: p.stats.longestRoad || 0,
    goldPending: p.pending.pick || 0,
    discardPending: p.pending.discard || 0,
    freeRoads: p.pending.freeRoads || 0,
    playedDevCardThisTurn: !!p.flags.playedDev,
    settlementsLeft: p.pieces.settlement ?? 0,
    citiesLeft: p.pieces.city ?? 0,
    roadsLeft: p.pieces.road ?? 0,
    bridgesLeft: p.pieces.bridge ?? 0,
    // Fishing nets (T7b2): supply left, and (yourself, on your main-phase turn) the vertices a net could go. Both undefined unless nets are in the game.
    netsLeft: p.pieces.net,
    netSpots: self ? netSpotsView(g, reg, p) : undefined,
    // Feed the sea (T7e): the price, and (yourself, on your main-phase turn) the sea tiles you could feed. Both undefined unless the action is in the game.
    feedCost: self && reg.actions.has('feed_sea') ? FEED_SEA_COST : undefined,
    feedSpots: self ? feedSpotsView(g, reg, p) : undefined,
    // Harbors (T8): upgrade price, legal port-city spots on your turn, harbors remaining in your limit, and 1:1 trades left this turn.
    harborCost: self && harborsOn ? harborUpgradeCost(g, reg, p) : undefined,
    harborSpots: self ? harborSpotsView(g, reg, p) : undefined,
    harborsLeft: harborsOn ? Math.max(0, harborLimitFor(g, p.id) - harborCount(g, p.id)) : undefined,
    harborTradesLeft: self && harborsOn && harborCount(g, p.id) > 0 ? harborTradesLeft(g, p.id) : undefined,
    // Pirates (T10b): the tiles of the pirates you could drive off right now (yourself, on your main-phase turn). Undefined unless the action is in the game.
    pirateDrives: self ? pirateDriveView(g, reg, p) : undefined,
    stats: {
      resourcesEarned: p.stats.earned || 0,
      tradesMade: p.stats.trades || 0,
      vpBreakdown: {
        settlement: settlementsOnBoard,
        city: citiesOnBoard * 2,
        devVp: vpCards,
        largestArmy: g.awards.largestArmy === p.id ? 2 : 0,
        longestRoad: g.awards.longestRoad === p.id ? 2 : 0
      },
      resCards: {
        produced: p.stats.resProduced || 0,
        tradedIn: p.stats.resTradedIn || 0,
        tradedOut: p.stats.resTradedOut || 0,
        stolen: p.stats.resStolen || 0,
        robbed: p.stats.resRobbed || 0,
        discarded: p.stats.resDiscarded || 0,
        devGain: p.stats.resDevGain || 0
      },
      devCards: {
        bought: p.stats.devsBought || 0,
        played: p.stats.devsPlayed || 0,
        knight: (p.stats.devPlayed_knight || 0) + (reveal ? heldCount('knight') : 0),
        vp: vpCards,
        roadBuilding: (p.stats.devPlayed_roadBuilding || 0) + (reveal ? heldCount('roadBuilding') : 0),
        yearOfPlenty: (p.stats.devPlayed_yearOfPlenty || 0) + (reveal ? heldCount('yearOfPlenty') : 0),
        monopoly: (p.stats.devPlayed_monopoly || 0) + (reveal ? heldCount('monopoly') : 0)
      },
      activity: {
        turns: Math.max(1, p.stats.turnsTaken || 0),
        rolls: p.stats.rollsCount || 0,
        sevens: p.stats.sevensRolled || 0,
        roadsOnBoard,
        settlementsOnBoard,
        citiesOnBoard,
        roadsBuilt: p.stats.built_road || roadsOnBoard,
        settlementsBuilt: p.stats.built_settlement || settlementsOnBoard,
        citiesBuilt: p.stats.built_city || citiesOnBoard,
        robberMoves: p.stats.robberMoves || 0,
        tradesProposed: p.stats.tradesProposed || 0,
        playerTrades: p.stats.playerTrades || 0,
        bankTrades: p.stats.bankTrades || 0,
        longestRoad: p.stats.longestRoad || 0,
        knightsPlayed: p.stats.knightsPlayed || 0
      },
      byResource: {
        wood: p.stats.res_wood || 0,
        brick: p.stats.res_brick || 0,
        sheep: p.stats.res_sheep || 0,
        wheat: p.stats.res_wheat || 0,
        ore: p.stats.res_ore || 0
      }
    },
    vp: score(g, gameRegistry(g.rules), p, reveal),
    // What other players see. Differs from `vp` only for the viewer's own hidden VP cards.
    publicVp: over ? score(g, gameRegistry(g.rules), p, true) : publicVP(g, gameRegistry(g.rules), p),
    pieceCosts: Object.fromEntries([...gameRegistry(g.rules).pieces.entries()].map(([id, def]) => [id, pieceCost(g, p, def, gameRegistry(g.rules))])),
    // Your price to upgrade a rickety bridge (T4c). Undefined unless rickety bridges are in this game, and only sent to yourself.
    bridgeUpgradeCost: self ? bridgeUpgradeView(g, gameRegistry(g.rules), p) : undefined
  };
}

function lobbyPlayerView(room: Room, p: Room['lobbyPlayers'][number]): any {
  return {
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    color: p.color,
    isBot: p.isBot,
    difficulty: p.difficulty,
    resourceCount: 0,
    resources: zeroResources(),
    devCardCount: 0,
    devCards: [],
    newDevCards: [],
    knightsPlayed: 0,
    longestRoadLength: 0,
    goldPending: 0,
    discardPending: 0,
    freeRoads: 0,
    playedDevCardThisTurn: false,
    settlementsLeft: room.settings.maxSettlements,
    citiesLeft: room.settings.maxCities,
    roadsLeft: room.settings.maxRoads,
    bridgesLeft: 10,
    stats: {
      resourcesEarned: 0,
      tradesMade: 0,
      vpBreakdown: { settlement: 0, city: 0, devVp: 0, largestArmy: 0, longestRoad: 0 },
      resCards: { produced: 0, tradedIn: 0, tradedOut: 0, stolen: 0, robbed: 0, discarded: 0, devGain: 0 },
      devCards: { bought: 0, played: 0, knight: 0, vp: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 },
      activity: {
        turns: 0, rolls: 0, sevens: 0, roadsOnBoard: 0, settlementsOnBoard: 0, citiesOnBoard: 0,
        roadsBuilt: 0, settlementsBuilt: 0, citiesBuilt: 0, robberMoves: 0, tradesProposed: 0,
        playerTrades: 0, bankTrades: 0, longestRoad: 0, knightsPlayed: 0
      },
      byResource: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 }
    },
    vp: 0
  };
}

/**
 * Returns a function that builds the state for one viewer. Everything that is the same for all viewers
 * (board, bank, trade...) is computed once per broadcast.
 */
export function makeStateBuilder(room: Room): (viewerId: string) => any {
  const g = room.game;
  const status = roomStatus(room);
  const over = status === 'GAMEOVER';
  const board = clientBoard(g ? g.board : room.board, over);

  const bank = g
    ? g.bank
    : Object.fromEntries([...registry.resources.keys()].map(r => [r, room.settings.bankResourcePerType]));
  const devDeckCount = g
    ? g.deck.length
    : room.settings.devKnights + room.settings.devVp + room.settings.devRoadBuilding +
      room.settings.devYearOfPlenty + room.settings.devMonopoly;

  ensureTradeTimers(room);
  syncTurnClock(room);
  const activeTrades = g
    ? openTrades(g).map(t => {
        const from = getPlayer(g, t.fromId);
        const timerMeta = room.tradeTimers?.get(t.id);
        return {
          id: t.id,
          fromId: t.fromId,
          fromName: from?.name,
          fromAvatar: from?.avatar,
          fromColor: from?.color,
          offer: fillResources(t.offer),
          request: fillResources(t.request),
          responses: t.responses,
          createdAt: timerMeta?.createdAt ?? Date.now(),
          expiresAt: timerMeta?.expiresAt ?? (Date.now() + 20000),
          durationMs: timerMeta?.durationMs ?? 20000,
          // Time left, not a timestamp: the client counts down from when the message arrives, so a wrong clock cannot empty the bar.
          remainingMs: timerMeta ? Math.max(0, timerMeta.expiresAt - Date.now()) : 20000
        };
      })
    : [];
  const activeTrade = activeTrades[0] ?? null;

  const current = g ? g.players[g.turn] : room.lobbyPlayers[0];
  const robberVictims = g && g.phase === 'robber_steal' && current ? victimsOnHex(g, g.board.robberHexId, current.id) : [];
  const defaultRatios = Object.fromEntries([...registry.resources.keys()].map(r => [r, 4]));
  // Tidebound Tides (T6): flooded and warned tiles as hex overlays, plus the tide facts the title card and heat map need. Null when Tides is off.
  const tideView = g ? tideClientView(g, gameRegistry(g.rules)) : null;

  // Fish icons (T7c): sea tile id -> boosts left. Public. Null when Fishing is off or no tile has an icon.
  const fishIcons = g ? fishClientView(g, gameRegistry(g.rules)) : null;
  // Port upgrade levels (T1, T8): vertex id -> level (1 = raised 2:1 port, 2 = 1:1 harbor). Null when no port is upgraded.
  const portLevels = g ? harborClientView(g) : null;
  // Active shipwrecks (T9): public wreck markers on sea or shore tiles. Null when Wrecks is off or no wrecks are active.
  const wrecks = g ? wreckClientView(g, gameRegistry(g.rules)) : null;
  // Active pirates (T10): public markers with their strength and mode. Null when Pirates is off or none are out.
  const pirates = g ? pirateClientView(g, gameRegistry(g.rules)) : null;

  const shared = {
    fishIcons,
    portLevels,
    wrecks,
    pirates,
    hexOverlays: tideView ? tideView.overlays : null,
    tide: tideView ? tideView.tide : null,
    code: room.code,
    hostId: room.hostId,
    status,
    // Host is on the world setup page (lobby only). Everyone else waits.
    setup: !g && !!room.setup,
    settings: room.settings,
    board,
    bank,
    // Cards of each resource in the game (bank + every hand). Cards are conserved, so this is the real supply, whatever the lobby setting
    // said: the bank and dev deck may have been scaled to the table and board at game start.
    bankSupply: g
      ? Object.fromEntries(Object.keys(g.bank).map(r => [r, (g.bank[r] || 0) + g.players.reduce((s, p) => s + (p.resources[r] || 0), 0)]))
      : null,
    devDeckCount,
    turnIndex: g ? g.turn : 0,
    currentPlayerId: current?.id,
    phase: g ? PHASE_NAMES[g.phase] ?? g.phase.toUpperCase() : 'LOBBY',
    robberVictims,
    lastSetupVertexId: g ? g.setup.lastVertexId : null,
    lastDice: g && g.dice[0] ? g.dice : [4, 3],
    lastRollHexIds: room.fx.lastRollHexIds,
    recentProductions: room.fx.recentProductions,
    diceStats: g ? g.diceStats : {},
    turnCount: g ? Math.max(1, g.turnCount) : 1,
    startedAt: room.startedAt,
    finishedAt: room.finishedAt,
    longestRoadOwner: g ? g.awards.longestRoad ?? null : null,
    largestArmyOwner: g ? g.awards.largestArmy ?? null : null,
    activeTrade,
    activeTrades,
    turnClock: g ? turnClockView(room) : null,
    winner: g ? g.winner : null,
    round: g ? (g.round || 0) : 0,
    turnHistory: room.turnHistory || [],
    logs: g ? g.log : room.lobbyLog,
    chats: room.chats,
    spectators: (room.spectators || []).map(s => ({
      id: s.id,
      name: s.name,
      avatar: s.avatar,
      color: s.color
    })),
    // How the lobby map was made: recipe, one-line share code, the generator's report. The seed is shown even with Fog (design 5.8).
    mapMeta: !g && room.mapMeta
      ? {
          recipe: room.mapMeta.recipe,
          code: encodeRecipe(room.mapMeta.recipe),
          report: room.mapMeta.report,
          edited: room.mapMeta.edited,
          otherVersion: isOtherVersion(room.mapMeta.recipe)
        }
      : null
  };

  return (viewerId: string) => {
    const isSpectator = (room.spectators || []).some(s => s.id === viewerId) ||
      (!!g && !g.players.some(p => p.id === viewerId));
    const recentTransfers = room.fx.recentTransfers.map(t => {
      if (t.secretForOthers && viewerId !== t.from && viewerId !== t.to && !over && !isSpectator) return { ...t, resource: 'mystery' };
      return t;
    });
    return {
      ...shared,
      isSpectator,
      recentTransfers,
      tradeRatios: g && !isSpectator ? tradeRatios(g, gameRegistry(g.rules), viewerId) : defaultRatios,
      // The viewer's own tech panel. Null when the tree is off or the viewer only watches, so games without it send nothing new.
      techTree: g && g.rules?.techTreeOn && !isSpectator ? techPanelFor(g, gameRegistry(g.rules), viewerId) : null,
      // What the owned root techs can act on (harbor cities, Ground work tiles). Null on the same terms as `techTree`.
      techActions: g && g.rules?.techTreeOn && !isSpectator ? techActionsFor(g, gameRegistry(g.rules), viewerId) : null,
      players: g
        ? g.players.map(p => enginePlayerView(g, p, viewerId, over, isSpectator))
        : room.lobbyPlayers.map(p => lobbyPlayerView(room, p))
    };
  };
}
