// MODULE: world setup page (host only, between the name page and the board): which screen shows, tile preview, roster, scenarios, DLC cards | USED BY: render/index.ts
// The controls on the page (bots, presets, map menu, rules) keep their ids and handlers; this file decides what is visible
// and draws the preview, player strip, scenario presets, live "what is on" summary, and DLC/addon cards from mapOptions.
import { socket } from '../socket';
import { mapOptions, state } from '../store';
import { avatarFace } from '../avatars';
import { uiIcon } from '../icons';
import { esc } from '../util';
import type { AddonInfoView, DlcInfoView, ScenarioPresetView } from '../types';

let lastPreviewSig = '';
let lastRosterSig = '';
let lastDlcSig = '';

/** Built-in catalog fallback for DLC packs not yet registered in the server registry, so the setup UI is always complete. */
const CATALOG_DLCS: DlcInfoView[] = [
  { id: 'heartland', name: 'Heartland', addons: ['heartland.estates', 'heartland.Storehouse', 'heartland.harvest_festival'] },
  { id: 'tidebound', name: 'Tidebound', addons: ['tidebound.bridges', 'tidebound.ships', 'tidebound.harbors', 'tidebound.rising_sea'] },
  { id: 'bulwark', name: 'Bulwark', addons: ['bulwark.walls', 'bulwark.watchtowers', 'bulwark.gates', 'bulwark.garrison'] },
  { id: 'ledger', name: 'Golden Ledger', addons: ['ledger.coins', 'ledger.contracts', 'ledger.guilds', 'ledger.loans'] },
  { id: 'wayfarers', name: 'Wayfarers', addons: ['wayfarers.caravans', 'wayfarers.outposts', 'wayfarers.wonders', 'wayfarers.relics'] },
  { id: 'crimson', name: 'Crimson Order', addons: ['crimson.raiders', 'crimson.fortress', 'crimson.siege', 'crimson.bounties'] },
  { id: 'whispers', name: 'Whispers', addons: ['whispers.pacts', 'whispers.spies', 'whispers.rumors', 'whispers.overthrow'] },
  { id: 'wildlands', name: 'Wildlands', addons: ['wildlands.seasons', 'wildlands.camps', 'wildlands.volcano', 'wildlands.plague'] }
];

const CATALOG_ADDONS: AddonInfoView[] = [
  { id: 'heartland.estates', name: 'Estates', description: 'Upgrade settlements with rural granaries (+1 yield on 9/10).', pack: 'heartland', deps: [], links: [{ target: 'production', kind: 'mechanic' }, { target: 'piece-cost', kind: 'mechanic' }] },
  { id: 'heartland.Storehouse', name: 'Storehouses', description: 'Raise your safe hand limit by +3 per city.', pack: 'heartland', deps: [], links: [{ target: 'seven-resolver', kind: 'mechanic' }, { target: 'score', kind: 'mechanic' }] },
  { id: 'heartland.harvest_festival', name: 'Harvest Festival', description: 'Every 4 rounds, most diverse producer gains a wild token.', pack: 'heartland', deps: ['heartland.estates'], links: [{ target: 'round-clock', kind: 'mechanic' }, { target: 'wild-token', kind: 'mechanic' }] },
  { id: 'tidebound.bridges', name: 'Causeways & Bridges', description: 'Span 1-hex water crossings to link neighbouring islands.', pack: 'tidebound', deps: [], links: [{ target: 'piece-cost', kind: 'mechanic' }, { target: 'bot-goals', kind: 'bot' }] },
  { id: 'tidebound.ships', name: 'Merchant Ships', description: 'Build coastal shipping lanes and move the pirate fleet.', pack: 'tidebound', deps: [], links: [{ target: 'trade-ratio', kind: 'mechanic' }, { target: 'seven-resolver', kind: 'mechanic' }] },
  { id: 'tidebound.harbors', name: 'Deepwater Harbors', description: 'Upgrade port settlements for 2:1 wildcard maritime swaps.', pack: 'tidebound', deps: ['tidebound.ships'], links: [{ target: 'trade-ratio', kind: 'mechanic' }, { target: 'score', kind: 'mechanic' }] },
  { id: 'tidebound.rising_sea', name: 'Rising Tides', description: 'Low-lying coastal hexes flood on extreme rolls unless diked.', pack: 'tidebound', deps: ['tidebound.bridges'], links: [{ target: 'tile-state', kind: 'mechanic' }, { target: 'overlay', kind: 'ui' }] },
  { id: 'bulwark.walls', name: 'City Walls', description: 'Fortify cities to shield against robber steals and siege damage.', pack: 'bulwark', deps: [], links: [{ target: 'durability', kind: 'mechanic' }, { target: 'strength', kind: 'mechanic' }] },
  { id: 'bulwark.watchtowers', name: 'Watchtowers', description: 'Place vertex markers that guard adjacent hexes from the robber.', pack: 'bulwark', deps: [], links: [{ target: 'marker', kind: 'mechanic' }, { target: 'seven-resolver', kind: 'mechanic' }] },
  { id: 'bulwark.gates', name: 'Toll Gates', description: 'Charge passage permits where opponent roads cross your border.', pack: 'bulwark', deps: ['bulwark.walls'], links: [{ target: 'overlay', kind: 'ui' }, { target: 'ledger', kind: 'mechanic' }] },
  { id: 'bulwark.garrison', name: 'Garrison Knights', description: 'Convert played knights into standing vertex defenders.', pack: 'bulwark', deps: ['bulwark.walls'], links: [{ target: 'strength', kind: 'mechanic' }, { target: 'bot-goals', kind: 'bot' }] },
  { id: 'ledger.coins', name: 'Gold Coins', description: 'Earn treasury coins on barren rolls and buy resources from bank.', pack: 'ledger', deps: [], links: [{ target: 'ledger', kind: 'mechanic' }, { target: 'production', kind: 'mechanic' }] },
  { id: 'ledger.contracts', name: 'Trade Contracts', description: 'Claim open delivery contracts for bonus VP and coins.', pack: 'ledger', deps: ['ledger.coins'], links: [{ target: 'ledger', kind: 'mechanic' }, { target: 'score', kind: 'mechanic' }] },
  { id: 'ledger.guilds', name: 'Merchant Guilds', description: 'Specialize in one resource to discount city and road costs.', pack: 'ledger', deps: [], links: [{ target: 'piece-cost', kind: 'mechanic' }, { target: 'trade-ratio', kind: 'mechanic' }] },
  { id: 'ledger.loans', name: 'Letters of Credit', description: 'Borrow resources now and repay with interest at round end.', pack: 'ledger', deps: ['ledger.coins'], links: [{ target: 'ledger', kind: 'mechanic' }, { target: 'round-clock', kind: 'mechanic' }] },
  { id: 'wayfarers.caravans', name: 'Trade Caravans', description: 'Route camels between settlements for shared resource bonuses.', pack: 'wayfarers', deps: [], links: [{ target: 'marker', kind: 'mechanic' }, { target: 'production', kind: 'mechanic' }] },
  { id: 'wayfarers.outposts', name: 'Frontier Outposts', description: 'Settle distant islands for instant exploration VP.', pack: 'wayfarers', deps: [], links: [{ target: 'score', kind: 'mechanic' }, { target: 'bot-goals', kind: 'bot' }] },
  { id: 'wayfarers.wonders', name: 'Great Wonders', description: 'Multi-stage monuments that grant a unique rule or instant win.', pack: 'wayfarers', deps: [], links: [{ target: 'score', kind: 'mechanic' }, { target: 'piece-cost', kind: 'mechanic' }] },
  { id: 'wayfarers.relics', name: 'Ancient Relics', description: 'Uncover relics on fog tiles for one-time wild tokens.', pack: 'wayfarers', deps: ['wayfarers.outposts'], links: [{ target: 'wild-token', kind: 'mechanic' }, { target: 'history', kind: 'mechanic' }] },
  { id: 'crimson.raiders', name: 'Raider Camps', description: 'Mercenary bands pressure unguarded high-pip hexes.', pack: 'crimson', deps: [], links: [{ target: 'strength', kind: 'mechanic' }, { target: 'seven-resolver', kind: 'mechanic' }] },
  { id: 'crimson.fortress', name: 'Citadels', description: 'Upgrade cities into war citadels with +2 strength.', pack: 'crimson', deps: [], links: [{ target: 'strength', kind: 'mechanic' }, { target: 'score', kind: 'mechanic' }] },
  { id: 'crimson.siege', name: 'Siege Engines', description: 'Crack enemy walls and damage unguarded settlements.', pack: 'crimson', deps: ['bulwark.walls'], links: [{ target: 'durability', kind: 'mechanic' }, { target: 'overlay', kind: 'ui' }] },
  { id: 'crimson.bounties', name: 'War Bounties', description: 'Collect rewards for clearing raiders or rival blockades.', pack: 'crimson', deps: ['crimson.raiders'], links: [{ target: 'ledger', kind: 'mechanic' }, { target: 'bot-goals', kind: 'bot' }] },
  { id: 'whispers.pacts', name: 'Diplomatic Pacts', description: 'Sign non-aggression and shared-port treaties with timed popups.', pack: 'whispers', deps: [], links: [{ target: 'relations', kind: 'mechanic' }, { target: 'overlay', kind: 'ui' }] },
  { id: 'whispers.spies', name: 'Spy Network', description: 'Plant informants to inspect a rival hand or saboteur a road.', pack: 'whispers', deps: [], links: [{ target: 'marker', kind: 'mechanic' }, { target: 'relations', kind: 'mechanic' }] },
  { id: 'whispers.rumors', name: 'Court Rumors', description: 'Seeded intrigue cards that shift relations each round.', pack: 'whispers', deps: ['whispers.pacts'], links: [{ target: 'event-deck', kind: 'mechanic' }, { target: 'relations', kind: 'mechanic' }] },
  { id: 'whispers.overthrow', name: 'Coup & Overthrow', description: 'Form a coalition to dethrone a runaway leader.', pack: 'whispers', deps: ['whispers.pacts'], links: [{ target: 'score', kind: 'mechanic' }, { target: 'overlay', kind: 'ui' }] },
  { id: 'wildlands.seasons', name: 'Four Seasons', description: 'Rotating seasonal modifiers tint hexes and shift yields.', pack: 'wildlands', deps: [], links: [{ target: 'round-clock', kind: 'mechanic' }, { target: 'overlay', kind: 'ui' }] },
  { id: 'wildlands.camps', name: 'Nomad Camps', description: 'Mobile settlements that relocate when a tile depletes.', pack: 'wildlands', deps: [], links: [{ target: 'tile-state', kind: 'mechanic' }, { target: 'piece-cost', kind: 'mechanic' }] },
  { id: 'wildlands.volcano', name: 'Active Volcano', description: 'High-yield magma hexes that crack and erupt on matching rolls.', pack: 'wildlands', deps: [], links: [{ target: 'tile-state', kind: 'mechanic' }, { target: 'durability', kind: 'mechanic' }] },
  { id: 'wildlands.plague', name: 'Blight & Plague', description: 'Contagion markers halve production until quarantined.', pack: 'wildlands', deps: ['wildlands.seasons'], links: [{ target: 'tile-state', kind: 'mechanic' }, { target: 'overlay', kind: 'ui' }] }
];

function effectiveDlcsAndAddons(): { dlcs: DlcInfoView[]; addons: Map<string, AddonInfoView> } {
  const srvDlcs = mapOptions?.dlcs && mapOptions.dlcs.length > 0 ? mapOptions.dlcs : [];
  const srvAddons = mapOptions?.addons && mapOptions.addons.length > 0 ? mapOptions.addons : [];
  const dlcMap = new Map<string, DlcInfoView>();
  for (const d of CATALOG_DLCS) dlcMap.set(d.id, d);
  for (const d of srvDlcs) dlcMap.set(d.id, d);

  const addonMap = new Map<string, AddonInfoView>();
  for (const a of CATALOG_ADDONS) addonMap.set(a.id, a);
  for (const a of srvAddons) addonMap.set(a.id, a);
  return { dlcs: [...dlcMap.values()], addons: addonMap };
}

/** Tiles only: no number tokens, ports, robber or pieces. Water stays empty so the shape reads on its own. */
function drawPreview(svg: Element): void {
  const hexes = (state?.board?.hexes || []).filter((h: any) => h.type !== 'water' && Array.isArray(h.corners) && h.corners.length === 6);
  const sig = hexes.map((h: any) => `${h.q},${h.r},${h.type}`).join('|');
  if (sig === lastPreviewSig) return;
  lastPreviewSig = sig;
  if (hexes.length === 0) {
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.innerHTML = '<text x="50" y="52" text-anchor="middle" class="pv-empty">No land</text>';
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const h of hexes) {
    for (const c of h.corners) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }
  }
  const pad = 12;
  svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`);
  svg.innerHTML = hexes.map((h: any) => {
    const pts = h.corners.map((c: any) => `${c.x},${c.y}`).join(' ');
    return `<polygon class="pv-hex" points="${pts}" style="fill:var(--tile-${esc(h.type)}, var(--surface-3))"></polygon>`;
  }).join('');
}

function drawRoster(el: HTMLElement): void {
  const players = state?.players || [];
  const spectators = state?.spectators || [];
  const sig =
    players.map(p => `${p.id}|${p.name}|${p.avatar}|${p.color}|${p.difficulty ?? ''}`).join(';') +
    '||' +
    spectators.map(s => `${s.id}|${s.name}|${s.avatar}|${s.color}`).join(';') +
    `|${state?.settings?.maxPlayers}|${state?.hostId}`;
  if (sig === lastRosterSig) return;
  lastRosterSig = sig;
  const chips = players.map(p => {
    const key = String(p.difficulty || '').toLowerCase();
    const tag = p.isBot
      ? `<span class="tag tier-${esc(key)} tier-pick" onclick="cycleBotTier('${esc(p.id)}')" title="Click to change difficulty">Bot · ${esc(p.difficulty || '')}</span>`
      : p.id === state?.hostId ? '<span class="tag accent">Host</span>' : '';
    const pick = p.isBot || p.id === socket.id;
    return `<div class="setup-chip">
      <div class="avatar p-avatar ${pick ? 'avatar-pick' : ''}" style="background:${esc(p.color)}"
        ${pick ? `onclick="cycleAvatar('${esc(p.id)}')" title="Click to change avatar"` : ''}>${avatarFace(p.avatar, p.name)}</div>
      <span class="nm">${esc(p.name)}</span>${tag}
    </div>`;
  }).join('');
  const specChips = spectators.map(s => {
    const hostTag = s.id === state?.hostId ? '<span class="tag accent">Host</span>' : '';
    const pick = s.id === socket.id;
    return `<div class="setup-chip is-spectator">
      <div class="avatar p-avatar ${pick ? 'avatar-pick' : ''}" style="background:${esc(s.color)}"
        ${pick ? `onclick="cycleAvatar('${esc(s.id)}')" title="Click to change avatar"` : ''}>${avatarFace(s.avatar, s.name)}</div>
      <span class="nm">${esc(s.name)}</span>${hostTag}<span class="tag">${uiIcon('eye', 12)} Spectating</span>
    </div>`;
  }).join('');
  const specCount = spectators.length > 0 ? ` · ${spectators.length} spectating` : '';
  el.innerHTML = `<div class="setup-count">${players.length} / ${esc(state?.settings?.maxPlayers ?? '')} seats${specCount}</div>${chips}${specChips}`;
}

function drawScenariosAndDlcs(): void {
  const s = state?.settings || {};
  const dlcMap: Record<string, boolean> = s.dlc && typeof s.dlc === 'object' ? s.dlc : {};
  const addonFlags: Record<string, boolean> = s.addons && typeof s.addons === 'object' ? s.addons : {};
  const eventsOn = !!s.eventsOn;
  const fateTokens = s.fateTokens ?? 2;
  const scenarios: ScenarioPresetView[] = mapOptions?.scenarios || [];
  const { dlcs, addons } = effectiveDlcsAndAddons();

  const sig = JSON.stringify([dlcMap, addonFlags, eventsOn, fateTokens, s.vpToWin, s.boardRadius, scenarios.length, dlcs.length]);
  if (sig === lastDlcSig) return;
  lastDlcSig = sig;

  // 1. Scenarios row
  const scenBox = document.getElementById('scenarioPresets');
  if (scenBox) {
    scenBox.innerHTML = scenarios
      .map(sc => {
        const dlcKeys = Object.keys(sc.dlc).filter(k => sc.dlc[k]);
        const isCurrent =
          s.boardRadius === sc.boardRadius &&
          s.vpToWin === sc.vpToWin &&
          Boolean(s.eventsOn) === Boolean(sc.eventsOn) &&
          dlcKeys.every(k => dlcMap[k] === true) &&
          Object.keys(dlcMap).filter(k => dlcMap[k]).length === dlcKeys.length;
        return `<button type="button" class="chip-btn${isCurrent ? ' chip-accent' : ''}" onclick="applyScenario('${esc(sc.id)}')" title="${esc(sc.description)}">${esc(sc.label)}</button>`;
      })
      .join('');
  }

  // 2. Compute enabled & blocked addons (mirrors shared resolveAddons)
  const enabledAddons = new Set<string>();
  const blockedAddons: { addon: AddonInfoView; missing: string[] }[] = [];
  for (const d of dlcs) {
    if (dlcMap[d.id] !== true) continue;
    for (const aId of d.addons) {
      const a = addons.get(aId);
      if (!a) continue;
      if (addonFlags[a.id] === false) continue;
      const missing = (a.deps || []).filter(depId => !enabledAddons.has(depId));
      if (missing.length > 0) blockedAddons.push({ addon: a, missing });
      else enabledAddons.add(a.id);
    }
  }

  // 3. Live "what is on" summary strip
  const summaryBox = document.getElementById('setupActiveSummary');
  if (summaryBox) {
    const activeDlcNames = dlcs.filter(d => dlcMap[d.id] === true).map(d => d.name);
    const pills: string[] = [];
    pills.push(`<span class="summary-pill accent">${esc(s.vpToWin ?? 10)} VP · Radius ${esc(s.boardRadius ?? 2)}</span>`);
    if (activeDlcNames.length === 0) {
      pills.push(`<span class="summary-pill">Base game only (0 DLCs)</span>`);
    } else {
      pills.push(`<span class="summary-pill on">${activeDlcNames.length} DLC${activeDlcNames.length === 1 ? '' : 's'}: ${esc(activeDlcNames.join(', '))}</span>`);
      pills.push(`<span class="summary-pill">${enabledAddons.size} addon${enabledAddons.size === 1 ? '' : 's'} active</span>`);
    }
    pills.push(
      eventsOn
        ? `<span class="summary-pill on">Events ON · ${esc(fateTokens)} Fate token${fateTokens === 1 ? '' : 's'}</span>`
        : `<span class="summary-pill">Events off</span>`
    );

    const blockedHtml = blockedAddons
      .map(b => {
        const missNames = b.missing.map(m => addons.get(m)?.name || m).join(', ');
        return `<div class="dlc-dep-prompt">
          <span><strong>${esc(b.addon.name)}</strong> needs <strong>${esc(missNames)}</strong> to activate.</span>
          <button type="button" class="chip-btn chip-accent" onclick="enableAddonWithDeps('${esc(b.addon.id)}')">Enable ${esc(missNames)}</button>
        </div>`;
      })
      .join('');

    summaryBox.innerHTML = `<div class="summary-pills-row"><span class="tool-label">Active</span>${pills.join('')}</div>${blockedHtml}`;
  }

  // 4. DLC cards grid
  const grid = document.getElementById('setupDlcGrid');
  if (grid) {
    grid.innerHTML = dlcs
      .map(d => {
        const isDlcOn = dlcMap[d.id] === true;
        const addonList = d.addons.map(id => addons.get(id)).filter((a): a is AddonInfoView => !!a);
        const activeCount = addonList.filter(a => enabledAddons.has(a.id)).length;
        const rowsHtml = addonList
          .map(a => {
            const rawWanted = isDlcOn && addonFlags[a.id] !== false;
            const isActuallyOn = enabledAddons.has(a.id);
            const missingDeps = (a.deps || []).filter(depId => !enabledAddons.has(depId));
            const isBlocked = rawWanted && missingDeps.length > 0;
            const depLabels = missingDeps.map(m => addons.get(m)?.name || m).join(', ');
            return `
              <div class="dlc-addon-row${isActuallyOn ? ' on' : ''}${isBlocked ? ' blocked' : ''}">
                <label class="dlc-addon-label" title="${esc(a.description || '')}">
                  <input type="checkbox" ${rawWanted ? 'checked' : ''} ${!isDlcOn ? 'disabled' : ''}
                    onclick="event.preventDefault(); toggleAddon('${esc(a.id)}')" />
                  <span class="dlc-addon-name">${esc(a.name)}</span>
                </label>
                ${a.description ? `<span class="dlc-addon-desc">${esc(a.description)}</span>` : ''}
                ${
                  isBlocked
                    ? `<button type="button" class="dlc-dep-btn" onclick="enableAddonWithDeps('${esc(a.id)}')" title="Click to enable required dependency">Needs ${esc(depLabels)} · Enable</button>`
                    : ''
                }
              </div>`;
          })
          .join('');

        return `
          <div class="dlc-card${isDlcOn ? ' is-on' : ''}">
            <div class="dlc-card-head" onclick="toggleDlc('${esc(d.id)}')">
              <div class="dlc-card-title">
                <input type="checkbox" class="dlc-master-switch" ${isDlcOn ? 'checked' : ''} onclick="event.stopPropagation(); event.preventDefault(); toggleDlc('${esc(d.id)}')" />
                <strong>${esc(d.name)}</strong>
              </div>
              <span class="dlc-card-badge">${isDlcOn ? `${activeCount}/${addonList.length} on` : 'Off'}</span>
            </div>
            <div class="dlc-card-body">
              ${rowsHtml}
            </div>
          </div>`;
      })
      .join('');
  }
}

/** Host sees the setup page while `state.setup` is on; everyone else sees "Host is creating world" over the board. */
export function renderSetupPage(): void {
  const page = document.getElementById('setupScreen');
  const wait = document.getElementById('hostWaiting');
  if (!page || !wait) return;
  const inLobby = !!state && state.status === 'LOBBY';
  const showSetup = inLobby && !!state!.setup && state!.hostId === socket.id;
  const showWait = inLobby && !!state!.setup && state!.hostId !== socket.id;
  page.style.display = showSetup ? 'flex' : 'none';
  wait.style.display = showWait ? 'flex' : 'none';
  if (!showSetup) return;
  const specBtn = document.getElementById('btnSetupSpectate');
  if (specBtn) {
    const isSpec = !!state?.isSpectator;
    specBtn.classList.toggle('primary', isSpec);
    specBtn.innerHTML = `${uiIcon(isSpec ? 'users' : 'eye', 16)}<span>${isSpec ? 'Join seat' : 'Spectate'}</span>`;
  }
  const svg = document.getElementById('setupPreview');
  const roster = document.getElementById('setupRoster');
  if (svg) drawPreview(svg);
  if (roster) drawRoster(roster);
  drawScenariosAndDlcs();
}

export { effectiveDlcsAndAddons };
