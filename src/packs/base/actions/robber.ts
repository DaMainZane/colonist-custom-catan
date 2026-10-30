// MODULE: actions "move_robber" and "steal" (victim choice when 2+ players are on the hex) | USED BY: packs/base/actions/index
import { getPlayer, popPhase, publicVP, setPhase, stealableWildTokens } from '../../../shared';
import type { ActionDef } from '../../../shared';
import { clearStealSource, stealOne, victimsOnHex } from '../robbing';

export const moveRobberAction: ActionDef = {
  type: 'move_robber',
  validate(ctx, _pid, payload) {
    const { g, reg } = ctx;
    const hex = g.board.hexes[payload?.hexId];
    if (!hex) return 'Choose a tile';
    if (!reg.tiles.get(hex.type)?.land || hex.ext.hidden) return 'The robber cannot go there';
    if (hex.id === g.board.robberHexId) return 'The robber must move to a different tile';
    return null;
  },
  apply(ctx, pid, payload) {
    const { g } = ctx;
    const p = getPlayer(g, pid)!;
    const from = g.board.robberHexId;
    g.board.robberHexId = payload.hexId;
    ctx.emit('robberMoved', { playerId: pid, from, to: payload.hexId });
    ctx.log(`${p.avatar} ${p.name} moved the Robber`, p.color);

    const victims = victimsOnHex(g, payload.hexId, pid);
    if (victims.length >= 2) {
      // Keeps the return stack, so "steal" returns to wherever the robber was entered from.
      setPhase(ctx, 'robber_steal');
      return;
    }
    if (victims.length === 1) stealOne(ctx, pid, victims[0]);
    clearStealSource(g);
    popPhase(ctx);
  },
  legal(ctx) {
    return ctx.g.board.hexes.map(h => ({ hexId: h.id }));
  }
};

export const stealAction: ActionDef = {
  type: 'steal',
  validate(ctx, pid, payload) {
    const victims = victimsOnHex(ctx.g, ctx.g.board.robberHexId, pid);
    return victims.includes(payload?.victimId) ? null : 'Choose a player next to the robber';
  },
  apply(ctx, pid, payload) {
    stealOne(ctx, pid, payload.victimId);
    clearStealSource(ctx.g);
    popPhase(ctx);
  },
  /** Players with cards first, then by visible VP (highest first), so a simple bot can take the first entry. */
  legal(ctx, pid) {
    const { g, reg } = ctx;
    const victims = victimsOnHex(g, g.board.robberHexId, pid).map(id => getPlayer(g, id)!);
    const cards = (p: typeof victims[number]) => Object.values(p.resources).reduce((a, b) => a + b, 0) + stealableWildTokens(g, reg, p.id);
    victims.sort((a, b) => {
      if ((cards(b) > 0 ? 1 : 0) !== (cards(a) > 0 ? 1 : 0)) return (cards(b) > 0 ? 1 : 0) - (cards(a) > 0 ? 1 : 0);
      return publicVP(g, reg, b) - publicVP(g, reg, a);
    });
    return victims.map(v => ({ victimId: v.id }));
  }
};
