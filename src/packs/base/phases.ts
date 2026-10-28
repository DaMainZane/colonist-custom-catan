// MODULE: base phases (setup, roll, main, discard, robber, robber steal, pick, game over) | USED BY: packs/base/index
import { getPlayer } from '../../shared';
import type { GameState, Id, PackApi } from '../../shared';

const hasPending = (key: string) => (g: GameState, pid: Id): boolean => (getPlayer(g, pid)?.pending[key] || 0) > 0;

export function registerPhases(api: PackApi): void {
  api.phase({ id: 'setup_settlement', label: 'Place a settlement', actions: ['build'] });
  api.phase({ id: 'setup_road', label: 'Place a road', actions: ['build'] });

  api.phase({ id: 'roll', label: 'Roll the dice', actions: ['roll', 'play_dev'] });

  api.phase({
    id: 'main',
    label: 'Your turn',
    actions: [
      'build', 'buy_dev', 'play_dev', 'bank_trade',
      'propose_trade', 'respond_trade', 'counter_trade', 'confirm_trade', 'cancel_trade', 'research_tech',
      'upgrade_port', 'convert_tile', 'end_turn'
    ]
  });

  api.phase({ id: 'discard', label: 'Discard cards', actions: ['discard'], actor: hasPending('discard') });
  api.phase({ id: 'robber', label: 'Move the robber', actions: ['move_robber'] });
  api.phase({ id: 'robber_steal', label: 'Choose who to rob', actions: ['steal'] });
  api.phase({ id: 'pick', label: 'Pick resources', actions: ['pick'], actor: hasPending('pick') });
  api.phase({ id: 'gameover', label: 'Game over', actions: [] });
}
