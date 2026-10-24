// MODULE: action "bank_trade" (4:1 or better with ports; registry resources only) | USED BY: packs/base/actions/index
import { getPlayer } from '../../../shared';
import type { ActionDef } from '../../../shared';
import { parseResources, sumResources, tradeRatios } from '../trading';

export const bankTradeAction: ActionDef = {
  type: 'bank_trade',
  validate(ctx, pid, payload) {
    const { g, reg } = ctx;
    const give = parseResources(reg, payload?.give);
    const get = parseResources(reg, payload?.get);
    if (!give || !get) return 'Invalid trade';
    const p = getPlayer(g, pid)!;
    const ratios = tradeRatios(g, reg, pid);

    let credits = 0;
    for (const [r, n] of Object.entries(give)) {
      if (n > (p.resources[r] || 0)) return `Not enough ${r.toUpperCase()}!`;
      if (n % ratios[r] !== 0) {
        return `Bank trade requires ${ratios[r]}:1 for ${r.toUpperCase()}! Use Player Trade to offer custom amounts.`;
      }
      credits += n / ratios[r];
    }
    const wanted = sumResources(get);
    if (credits <= 0 || credits !== wanted) {
      return `Bank trade mismatch: your offered cards equal ${credits} resource(s), but you selected ${wanted} wanted card(s).`;
    }
    for (const [r, n] of Object.entries(get)) {
      if (n > (g.bank[r] || 0)) return `Bank does not have enough ${r.toUpperCase()}!`;
    }
    return null;
  },
  apply(ctx, pid, payload) {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid)!;
    const give = parseResources(reg, payload.give)!;
    const get = parseResources(reg, payload.get)!;
    for (const [r, n] of Object.entries(give)) {
      p.resources[r] -= n;
      g.bank[r] += n;
      ctx.emit('transferred', { from: pid, to: 'bank', resource: r, amount: n, kind: 'bankTrade' });
    }
    for (const [r, n] of Object.entries(get)) {
      p.resources[r] = (p.resources[r] || 0) + n;
      g.bank[r] -= n;
      ctx.emit('transferred', { from: 'bank', to: pid, resource: r, amount: n, kind: 'bankTrade' });
    }
    p.stats.trades = (p.stats.trades || 0) + 1;
    ctx.log(`${p.avatar} ${p.name} traded with the Bank 🏦`, p.color);
  },
  /** One simple swap per (give, get) pair: the cheapest ratio of the given resource for 1 of another. */
  legal(ctx, pid) {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid)!;
    const ratios = tradeRatios(g, reg, pid);
    const out: any[] = [];
    for (const give of reg.resources.keys()) {
      if ((p.resources[give] || 0) < ratios[give]) continue;
      for (const get of reg.resources.keys()) {
        if (get === give || (g.bank[get] || 0) < 1) continue;
        out.push({ give: { [give]: ratios[give] }, get: { [get]: 1 } });
      }
    }
    return out;
  }
};
