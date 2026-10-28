// MODULE: base development cards (knight, victory point, road building, year of plenty, monopoly) | USED BY: packs/base/index
import { getPlayer, pushPhase } from '../../shared';
import type { PackApi } from '../../shared';
import { setStealSource } from './robbing';

export function registerDevCards(api: PackApi): void {
  api.devcard({
    id: 'knight',
    name: 'Knight',
    playable: true,
    play(ctx, pid) {
      const p = getPlayer(ctx.g, pid)!;
      p.stats.knightsPlayed = (p.stats.knightsPlayed || 0) + 1;
      ctx.log(`${p.avatar} ${p.name} played a Knight`, p.color);
      setStealSource(ctx.g, 'knight');
      pushPhase(ctx, 'robber');
    }
  });

  api.devcard({ id: 'vp', name: 'Victory Point', playable: false, vp: 1 });

  api.devcard({
    id: 'roadBuilding',
    name: 'Road Building',
    playable: true,
    play(ctx, pid) {
      const p = getPlayer(ctx.g, pid)!;
      p.pending.freeRoads = (p.pending.freeRoads || 0) + 2;
      ctx.log(`${p.avatar} ${p.name} played Road Building (+2 free roads)`, p.color);
    }
  });

  api.devcard({
    id: 'yearOfPlenty',
    name: 'Year of Plenty',
    playable: true,
    play(ctx, pid) {
      const p = getPlayer(ctx.g, pid)!;
      p.pending.pick = (p.pending.pick || 0) + 2;
      ctx.log(`${p.avatar} ${p.name} played Year of Plenty (+2 picks)`, p.color);
    }
  });

  api.devcard({
    id: 'monopoly',
    name: 'Monopoly',
    playable: true,
    validate(ctx, _pid, payload) {
      return ctx.reg.resources.has(payload?.resource) ? null : 'Choose a resource to monopolize';
    },
    legal(ctx) {
      return [...ctx.reg.resources.keys()].map(resource => ({ resource }));
    },
    play(ctx, pid, payload) {
      const p = getPlayer(ctx.g, pid)!;
      const res: string = payload.resource;
      let taken = 0;
      for (const other of ctx.g.players) {
        if (other.id === pid) continue;
        const amt = other.resources[res] || 0;
        if (amt <= 0) continue;
        taken += amt;
        other.resources[res] = 0;
        ctx.emit('transferred', { from: other.id, to: pid, resource: res, amount: amt, kind: 'monopoly' });
      }
      p.resources[res] = (p.resources[res] || 0) + taken;
      ctx.log(`${p.avatar} ${p.name} Monopolized ${taken} ${res}!`, p.color);
    }
  });
}
