import { socket } from '../socket';
import { state, buildMode, victoryTab, hideVictoryOverlay } from '../store';
import { renderActiveTradeModal } from './trade';
import { renderHand } from './hand';
import { renderInlineDrawer } from './drawer';
import { renderSidebar } from './sidebar';
import { renderBoard } from './board';
import { renderPresetRow } from '../presets';
import { turnClockHtml, syncTurnClockDisplay } from './turnclock';
import { uiIcon, dieFaceSvg, getMiniSvg, getDevSvg, settlementMarkup, cityMarkup, robberMarkup } from '../icons';
import { esc } from '../util';
import { avatarFace } from '../avatars';
import type { PlayerView } from '../types';

export function renderAll(): void {
  const me = state.players.find(p => p.id === socket.id);
  const current = state.players[state.turnIndex];
  const isMyTurn = !!current && current.id === socket.id;

  const s = state.settings || {};
  const curSpeed = Number(s.gameSpeed) || 1;
  const speedBadge = document.getElementById('navSpeedBadge');
  if (speedBadge) speedBadge.textContent = `${curSpeed}x`;
  const speedSlider = document.getElementById('menuSpeedSlider') as HTMLInputElement | null;
  if (speedSlider) speedSlider.value = String(curSpeed);
  const speedLabel = document.getElementById('menuSpeedLabel');
  if (speedLabel) {
    const desc = curSpeed < 1 ? 'Slow' : curSpeed === 1 ? 'Normal' : curSpeed <= 2 ? 'Fast' : curSpeed <= 4 ? 'Faster' : 'Blitz';
    speedLabel.textContent = `${curSpeed}x (${desc})`;
  }
  document.querySelectorAll('.speed-preset-btn').forEach(btn => {
    const bSpeed = Number((btn as HTMLElement).dataset.speed);
    btn.classList.toggle('active', Math.abs(bSpeed - curSpeed) < 0.05);
  });
  const selHeader = document.getElementById('setGameSpeedHeader') as HTMLSelectElement | null;
  if (selHeader) selHeader.value = String(curSpeed);
  const selCards = document.getElementById('setGameSpeed') as HTMLSelectElement | null;
  if (selCards) selCards.value = String(curSpeed);

  const lobbyBar = document.getElementById('lobbyToolbar')!;
  // "Back to lobby" means nothing while you are already there.
  const backBtn = document.getElementById('btnBackToLobby');
  if (backBtn) backBtn.style.display = state.status === 'LOBBY' ? 'none' : '';
  if (state.status === 'LOBBY') {
    const setVal = (id: string, v: any) => { (document.getElementById(id) as HTMLInputElement).value = v; };
    setVal('setRadius', s.boardRadius);
    setVal('setVp', s.vpToWin);
    setVal('setMaxP', s.maxPlayers);
    setVal('setDiscard', s.cardDiscardLimit);
    setVal('setTurnTime', s.turnTimerSec ?? 0);
    setVal('setTurnInc', s.turnIncrementSec ?? 0);
    setVal('setTradeTime', s.tradeTimerSec ?? 20);
    if (document.getElementById('setBotChat')) setVal('setBotChat', s.botChat ?? 'normal');
    setVal('setGold', s.goldTiles);
    setVal('setDesert', s.desertTiles);
    if (document.getElementById('setFog')) setVal('setFog', s.fogTiles ?? 0);
    setVal('setBankRes', s.bankResourcePerType);
    setVal('setDevKnight', s.devKnights);
    setVal('setDevVp', s.devVp);
    setVal('setDevRb', s.devRoadBuilding);
    setVal('setDevYop', s.devYearOfPlenty);
    setVal('setDevMono', s.devMonopoly);
    setVal('setMaxRoad', s.maxRoads);
    setVal('setMaxSettle', s.maxSettlements);
    setVal('setMaxCity', s.maxCities);
    renderPresetRow();
  } else {
    lobbyBar.style.display = 'none';
  }

  document.getElementById('die1')!.innerHTML = dieFaceSvg(state.lastDice[0]);
  document.getElementById('die2')!.innerHTML = dieFaceSvg(state.lastDice[1]);

  // Piece badges on buttons
  if (me) {
    document.getElementById('badgeRoadCnt')!.textContent = String(me.roadsLeft);
    document.getElementById('badgeSettleCnt')!.textContent = String(me.settlementsLeft);
    document.getElementById('badgeCityCnt')!.textContent = String(me.citiesLeft);
  }

  const pill = document.getElementById('turnStatusPill')!;
  pill.classList.toggle('mine', isMyTurn && state.status !== 'LOBBY' && state.status !== 'GAMEOVER');
  if (state.status === 'LOBBY') {
    pill.innerHTML = state.hostId === socket.id
      ? `Lobby · paint the map or add bots`
      : `Lobby · only the host edits · move your cursor, hold Shift for a laser`;
  } else if (state.status === 'GAMEOVER') {
    pill.innerHTML = `<strong>${esc(state.winner?.name)}</strong> won the game`;
  } else {
    const phaseTxt = ({
      SETUP_SETTLEMENT: 'Place Settlement',
      SETUP_ROAD: 'Place Road',
      ROLL: 'Roll Dice',
      GOLD_PICK: 'Pick Gold Resource',
      DISCARD: 'Waiting for Discards (7 Rolled)',
      ROBBER: 'Move Robber',
      ROBBER_STEAL: 'Choose Player to Rob',
      MAIN: 'Turn'
    } as Record<string, string>)[state.phase] || state.phase;
    pill.innerHTML = `<span class="avatar" style="background:${esc(current?.color)}">${avatarFace(current?.avatar, current?.name || '?')}</span> <strong>${esc(current?.name)}</strong> · ${phaseTxt}${turnClockHtml()}`;
  }
  syncTurnClockDisplay();

  const btn = (id: string) => document.getElementById(id) as HTMLButtonElement;
  btn('btnTradeDrawer').disabled = !(isMyTurn && state.phase === 'MAIN');
  btn('btnBuyDev').disabled = !(isMyTurn && state.phase === 'MAIN' && me?.resources.sheep >= 1 && me?.resources.wheat >= 1 && me?.resources.ore >= 1 && state.devDeckCount > 0);
  btn('btnBuildRoad').disabled = !(isMyTurn && (state.phase === 'MAIN' || state.phase === 'SETUP_ROAD'));
  btn('btnBuildSettle').disabled = !(isMyTurn && (state.phase === 'MAIN' || state.phase === 'SETUP_SETTLEMENT'));
  btn('btnBuildCity').disabled = !(isMyTurn && state.phase === 'MAIN');

  btn('btnBuildRoad').classList.toggle('active-mode', buildMode === 'road');
  btn('btnBuildSettle').classList.toggle('active-mode', buildMode === 'settlement');
  btn('btnBuildCity').classList.toggle('active-mode', buildMode === 'city');

  const mainBtn = btn('btnMainTurnAction');
  if (state.phase === 'ROLL') {
    mainBtn.disabled = !isMyTurn;
    document.getElementById('mainBtnIcon')!.innerHTML = uiIcon('dice', 22);
    document.getElementById('mainBtnLbl')!.textContent = 'Roll';
  } else {
    mainBtn.disabled = !(isMyTurn && state.phase === 'MAIN');
    document.getElementById('mainBtnIcon')!.innerHTML = uiIcon('pass', 22);
    document.getElementById('mainBtnLbl')!.textContent = 'Pass';
  }
  mainBtn.classList.toggle('primary', !mainBtn.disabled);
  document.getElementById('dicePair')!.classList.toggle('can-roll', isMyTurn && state.phase === 'ROLL');

  renderVictoryScreen();
  renderActiveTradeModal(me);
  renderHand(me, isMyTurn);
  renderInlineDrawer(me, isMyTurn);
  renderSidebar();
  renderBoard(me, isMyTurn);
}

interface VicCol {
  title: string;
  label?: string;
  headHtml: string;
  get: (p: PlayerView) => number;
  primary?: boolean;
  highlightMax?: boolean;
  footerSum?: boolean;
}

function renderVicMatrix(ranked: PlayerView[], cols: VicCol[], showFooterTotal = false): string {
  const maxes = cols.map(c => Math.max(0, ...ranked.map(p => c.get(p))));
  const colTemplate = `minmax(160px, 2.2fr) repeat(${cols.length}, minmax(54px, 1fr))`;

  const headCells = cols.map(c => `
    <div class="vic-col-head" title="${esc(c.title)}">
      <div class="vic-head-badge">${c.headHtml}</div>
      ${c.label ? `<span class="vic-head-lbl">${esc(c.label)}</span>` : ''}
    </div>
  `).join('');

  const rowsHtml = ranked.map((p, idx) => {
    const isWinner = idx === 0;
    const cells = cols.map((c, cIdx) => {
      const val = c.get(p);
      const isBest = c.highlightMax !== false && maxes[cIdx] > 0 && val === maxes[cIdx];
      const cls = c.primary ? 'vic-num primary' : isBest ? 'vic-num best' : 'vic-num';
      return `<div class="vic-cell"><span class="${cls}">${val}</span></div>`;
    }).join('');

    return `
      <div class="vic-matrix-row ${isWinner ? 'is-winner' : ''}" style="grid-template-columns:${colTemplate}">
        <div class="vic-player-cell">
          <span class="avatar p-avatar" style="background:${esc(p.color)}">${avatarFace(p.avatar, p.name)}</span>
          <span class="vic-player-name">${esc(p.name)}</span>
        </div>
        ${cells}
      </div>
    `;
  }).join('');

  let footerHtml = '';
  if (showFooterTotal && ranked.length > 1) {
    const sumCells = cols.map(c => {
      const sum = ranked.reduce((acc, p) => acc + c.get(p), 0);
      return `<div class="vic-cell"><span class="vic-num sum">${sum}</span></div>`;
    }).join('');
    footerHtml = `
      <div class="vic-matrix-row is-footer" style="grid-template-columns:${colTemplate}">
        <div class="vic-player-cell"><span class="vic-footer-lbl">Table Total</span></div>
        ${sumCells}
      </div>
    `;
  }

  return `
    <div class="vic-matrix">
      <div class="vic-matrix-head" style="grid-template-columns:${colTemplate}">
        <div class="vic-player-head"></div>
        ${headCells}
      </div>
      <div class="vic-matrix-body">
        ${rowsHtml}
        ${footerHtml}
      </div>
    </div>
  `;
}

export function renderVictoryScreen(): void {
  const overlay = document.getElementById('victoryOverlay');
  const reopenBtn = document.getElementById('reopenVictoryBtn');
  if (!overlay || !reopenBtn) return;

  if (state.status !== 'GAMEOVER') {
    overlay.style.display = 'none';
    reopenBtn.style.display = 'none';
    return;
  }

  if (hideVictoryOverlay) {
    overlay.style.display = 'none';
    reopenBtn.style.display = 'inline-flex';
    return;
  }
  overlay.style.display = 'flex';
  reopenBtn.style.display = 'none';

  document.querySelectorAll<HTMLElement>('.vic-tab[data-vtab]').forEach(el => {
    el.classList.toggle('active', el.dataset.vtab === victoryTab);
  });

  const ranked = [...state.players].sort((a, b) => b.vp - a.vp);
  const myRankIdx = ranked.findIndex(p => p.id === socket.id);
  const ord = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
  document.getElementById('vicTitleText')!.textContent =
    myRankIdx === 0
      ? 'Victory!!!'
      : myRankIdx > 0
      ? `You are ${ord[myRankIdx]}!`
      : `${state.winner?.name || 'Player'} Won!`;

  const elapsedSec = state.startedAt && state.finishedAt
    ? Math.max(1, Math.floor((state.finishedAt - state.startedAt) / 1000))
    : 0;
  const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const secs = String(elapsedSec % 60).padStart(2, '0');
  document.getElementById('vicSubText')!.textContent = `Time: ${mins}:${secs} - Turns: ${state.turnCount || 1}`;

  const chartBox = document.getElementById('vicChartContainer')!;

  if (victoryTab === 'dice') {
    const ds = state.diceStats || {};
    let maxCount = 1;
    let totalRolls = 0;
    let bestNum = 7;
    let bestCnt = 0;
    for (let n = 2; n <= 12; n++) {
      const c = ds[n] || 0;
      totalRolls += c;
      if (c > maxCount) maxCount = c;
      if (c > bestCnt) {
        bestCnt = c;
        bestNum = n;
      }
    }

    const BAR_MAX_PX = 165;
    let barsHtml = '';
    for (let n = 2; n <= 12; n++) {
      const c = ds[n] || 0;
      const heightPx = c > 0 ? Math.max(4, Math.round((c / maxCount) * BAR_MAX_PX)) : 0;
      const pct = totalRolls > 0 ? Math.round((c / totalRolls) * 100) : 0;
      barsHtml += `
        <div class="dice-bar-col" title="Roll ${n}: ${c} times (${pct}%)">
          <span class="dice-bar-count">${c > 0 ? c : '0'}</span>
          <div class="dice-bar-fill ${n === 7 ? 'is-seven' : n === 6 || n === 8 ? 'is-hot' : ''}" style="height:${heightPx}px"></div>
          <span class="dice-bar-label ${n === 6 || n === 8 ? 'hot' : ''}">${n}</span>
        </div>
      `;
    }

    const sevensCnt = ds[7] || 0;
    const sevensPct = totalRolls > 0 ? ((sevensCnt / totalRolls) * 100).toFixed(1) : '0.0';
    const playerSevensHtml = ranked.map(p => {
      const s7 = p.stats?.activity?.sevens ?? 0;
      const rolls = p.stats?.activity?.rolls ?? 0;
      return `
        <div class="vic-dice-pchip">
          <span class="avatar" style="background:${esc(p.color)};width:22px;height:22px">${avatarFace(p.avatar, p.name)}</span>
          <span class="vic-dice-pname">${esc(p.name)}</span>
          <span class="vic-dice-pval"><strong>${s7}</strong> 7s <small>/ ${rolls} rolls</small></span>
        </div>
      `;
    }).join('');

    chartBox.innerHTML = `
      <div class="vic-dice-wrap">
        <div class="vic-dice-summary">
          <span>Total Rolls: <strong>${totalRolls}</strong></span>
          <span>·</span>
          <span>7s Rolled: <strong>${sevensCnt}</strong> (${sevensPct}%)</span>
          <span>·</span>
          <span>Most Frequent: <strong>${bestCnt > 0 ? `${bestNum} (${bestCnt}×)` : '—'}</strong></span>
        </div>
        <div class="dice-bars-wrap">${barsHtml}</div>
        <div class="vic-dice-players">${playerSevensHtml}</div>
      </div>
    `;
    return;
  }

  if (victoryTab === 'res_cards') {
    const rc = (p: PlayerView) => p.stats?.resCards;
    chartBox.innerHTML = renderVicMatrix(ranked, [
      {
        title: 'Total Resource Cards Gained',
        label: 'Total',
        headHtml: uiIcon('cards', 22),
        get: p => {
          const r = rc(p);
          return r ? r.produced + r.tradedIn + r.stolen : (p.stats?.resourcesEarned || 0);
        },
        primary: true,
        highlightMax: false
      },
      {
        title: 'Produced from Dice, Setup & Gold',
        label: 'Dice / Gold',
        headHtml: uiIcon('dice', 20),
        get: p => rc(p)?.produced ?? (p.stats?.resourcesEarned || 0)
      },
      {
        title: 'Gained from Dev Cards (Year of Plenty & Monopoly)',
        label: 'Dev Gain',
        headHtml: `<span class="vic-tile-chip dev">${getDevSvg('yearOfPlenty')}</span>`,
        get: p => rc(p)?.devGain ?? 0
      },
      {
        title: 'Received from Trades (Player & Bank)',
        label: 'Trade In',
        headHtml: uiIcon('arrowDown', 20),
        get: p => rc(p)?.tradedIn ?? 0
      },
      {
        title: 'Given in Trades (Player & Bank)',
        label: 'Trade Out',
        headHtml: uiIcon('arrowUp', 20),
        get: p => rc(p)?.tradedOut ?? 0
      },
      {
        title: 'Stolen from Opponents (Robber & Monopoly)',
        label: 'Stolen',
        headHtml: `<svg width="20" height="24" viewBox="-14 -24 28 40" aria-hidden="true">${robberMarkup()}</svg>`,
        get: p => rc(p)?.stolen ?? 0
      },
      {
        title: 'Lost to Opponents (Robber & Monopoly)',
        label: 'Robbed',
        headHtml: uiIcon('close', 20),
        get: p => rc(p)?.robbed ?? 0
      },
      {
        title: 'Discarded on 7 Rolls',
        label: '7s Lost',
        headHtml: uiIcon('minus', 20),
        get: p => rc(p)?.discarded ?? 0
      }
    ], true);
    return;
  }

  if (victoryTab === 'dev_cards') {
    const dc = (p: PlayerView) => p.stats?.devCards;
    chartBox.innerHTML = renderVicMatrix(ranked, [
      {
        title: 'Total Development Cards Bought',
        label: 'Bought',
        headHtml: uiIcon('devbuy', 22),
        get: p => dc(p)?.bought ?? 0,
        primary: true,
        highlightMax: false
      },
      {
        title: 'Development Cards Played',
        label: 'Played',
        headHtml: uiIcon('play', 20),
        get: p => dc(p)?.played ?? 0
      },
      {
        title: 'Knight Cards (Played + Held)',
        label: 'Knight',
        headHtml: `<span class="vic-tile-chip dev">${getDevSvg('knight')}</span>`,
        get: p => dc(p)?.knight ?? p.knightsPlayed ?? 0
      },
      {
        title: 'Victory Point Cards (+1 VP)',
        label: '+1 VP',
        headHtml: `<span class="vic-tile-chip vp"><small>+1</small>${getDevSvg('vp')}</span>`,
        get: p => dc(p)?.vp ?? 0
      },
      {
        title: 'Road Building Cards (Played + Held)',
        label: 'Road Bldg',
        headHtml: `<span class="vic-tile-chip dev">${getDevSvg('roadBuilding')}</span>`,
        get: p => dc(p)?.roadBuilding ?? 0
      },
      {
        title: 'Year of Plenty Cards (Played + Held)',
        label: 'Plenty',
        headHtml: `<span class="vic-tile-chip dev">${getDevSvg('yearOfPlenty')}</span>`,
        get: p => dc(p)?.yearOfPlenty ?? 0
      },
      {
        title: 'Monopoly Cards (Played + Held)',
        label: 'Monopoly',
        headHtml: `<span class="vic-tile-chip dev">${getDevSvg('monopoly')}</span>`,
        get: p => dc(p)?.monopoly ?? 0
      }
    ], true);
    return;
  }

  if (victoryTab === 'activity') {
    const ac = (p: PlayerView) => p.stats?.activity;
    chartBox.innerHTML = renderVicMatrix(ranked, [
      {
        title: 'Turns Taken',
        label: 'Turns',
        headHtml: uiIcon('pass', 20),
        get: p => ac(p)?.turns ?? 0,
        primary: true,
        highlightMax: false
      },
      {
        title: 'Settlements Built',
        label: 'Settle',
        headHtml: `<svg width="24" height="24" viewBox="-16 -16 32 32">${settlementMarkup('#5da2e6')}</svg>`,
        get: p => ac(p)?.settlementsBuilt ?? 0
      },
      {
        title: 'Cities Built',
        label: 'Cities',
        headHtml: `<svg width="26" height="24" viewBox="-18 -16 36 32">${cityMarkup('#5da2e6')}</svg>`,
        get: p => ac(p)?.citiesBuilt ?? 0
      },
      {
        title: 'Roads Built',
        label: 'Roads',
        headHtml: uiIcon('road', 20),
        get: p => ac(p)?.roadsBuilt ?? 0
      },
      {
        title: 'Longest Continuous Road Length',
        label: 'Best Road',
        headHtml: `<span class="vic-tile-chip award">${uiIcon('road', 18)}</span>`,
        get: p => ac(p)?.longestRoad ?? p.longestRoadLength ?? 0
      },
      {
        title: 'Times Moved the Robber',
        label: 'Robber',
        headHtml: `<svg width="20" height="24" viewBox="-14 -24 28 40" aria-hidden="true">${robberMarkup()}</svg>`,
        get: p => ac(p)?.robberMoves ?? 0
      },
      {
        title: 'Completed Player-to-Player Trades',
        label: 'P2P Trade',
        headHtml: uiIcon('users', 20),
        get: p => ac(p)?.playerTrades ?? 0
      },
      {
        title: 'Completed Bank & Port Trades',
        label: 'Bank Trade',
        headHtml: uiIcon('bank', 20),
        get: p => ac(p)?.bankTrades ?? 0
      },
      {
        title: 'Trade Offers & Counter-Offers Proposed',
        label: 'Offers',
        headHtml: uiIcon('swap', 20),
        get: p => ac(p)?.tradesProposed ?? 0
      }
    ], true);
    return;
  }

  if (victoryTab === 'resources') {
    const br = (p: PlayerView, k: string) => p.stats?.byResource?.[k] ?? 0;
    chartBox.innerHTML = renderVicMatrix(ranked, [
      {
        title: 'Total Resources Acquired',
        label: 'Total',
        headHtml: uiIcon('cards', 22),
        get: p => br(p, 'wood') + br(p, 'brick') + br(p, 'sheep') + br(p, 'wheat') + br(p, 'ore'),
        primary: true,
        highlightMax: false
      },
      {
        title: 'Wood Acquired',
        label: 'Wood',
        headHtml: `<span class="vic-res-chip t-wood">${getMiniSvg('wood')}</span>`,
        get: p => br(p, 'wood')
      },
      {
        title: 'Brick Acquired',
        label: 'Brick',
        headHtml: `<span class="vic-res-chip t-brick">${getMiniSvg('brick')}</span>`,
        get: p => br(p, 'brick')
      },
      {
        title: 'Sheep Acquired',
        label: 'Sheep',
        headHtml: `<span class="vic-res-chip t-sheep">${getMiniSvg('sheep')}</span>`,
        get: p => br(p, 'sheep')
      },
      {
        title: 'Wheat Acquired',
        label: 'Wheat',
        headHtml: `<span class="vic-res-chip t-wheat">${getMiniSvg('wheat')}</span>`,
        get: p => br(p, 'wheat')
      },
      {
        title: 'Ore Acquired',
        label: 'Ore',
        headHtml: `<span class="vic-res-chip t-ore">${getMiniSvg('ore')}</span>`,
        get: p => br(p, 'ore')
      }
    ], true);
    return;
  }

  // Default: 'overview' (matches Colonist Overview layout)
  const vpb = (p: PlayerView) => p.stats?.vpBreakdown;
  chartBox.innerHTML = renderVicMatrix(ranked, [
    {
      title: 'Total Victory Points',
      label: 'Total VP',
      headHtml: `<span class="vic-trophy-head">${uiIcon('trophy', 26)}</span>`,
      get: p => p.vp,
      primary: true,
      highlightMax: false
    },
    {
      title: 'Victory Points from Settlements (1 VP each)',
      label: 'Settle',
      headHtml: `<svg width="28" height="28" viewBox="-16 -16 32 32">${settlementMarkup('#5da2e6')}</svg>`,
      get: p => vpb(p)?.settlement ?? Math.max(0, 5 - (p.settlementsLeft ?? 5))
    },
    {
      title: 'Victory Points from Cities (2 VP each)',
      label: 'Cities',
      headHtml: `<svg width="32" height="28" viewBox="-18 -16 36 32">${cityMarkup('#5da2e6')}</svg>`,
      get: p => vpb(p)?.city ?? 0
    },
    {
      title: 'Victory Points from Development Cards (+1 VP each)',
      label: 'VP Cards',
      headHtml: `<span class="vic-tile-chip vp"><small>+1</small>${uiIcon('trophy', 16)}</span>`,
      get: p => vpb(p)?.devVp ?? 0
    },
    {
      title: 'Largest Army Award (2 VP)',
      label: 'Army',
      headHtml: `<span class="vic-tile-chip award">${uiIcon('sword', 19)}</span>`,
      get: p => vpb(p)?.largestArmy ?? (state.largestArmyOwner === p.id ? 2 : 0)
    },
    {
      title: 'Longest Road Award (2 VP)',
      label: 'Road',
      headHtml: `<span class="vic-tile-chip award">${uiIcon('road', 19)}</span>`,
      get: p => vpb(p)?.longestRoad ?? (state.longestRoadOwner === p.id ? 2 : 0)
    }
  ]);
}

