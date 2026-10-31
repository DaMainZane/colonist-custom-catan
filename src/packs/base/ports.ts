// MODULE: base ports and map presets (standard, blank, archipelago) | DEPENDS ON: packs/base/constants, shared/index | USED BY: packs/base/index
import type { PackApi } from '../../shared';
import { GENERIC_PORT } from './constants';

const RESOURCE_PORTS = ['wood', 'brick', 'sheep', 'wheat', 'ore'];

export function registerPortsAndPresets(api: PackApi): void {
  api.port({ id: GENERIC_PORT, name: '3:1', ratio: 3, resource: null, copies: 4 });
  for (const r of RESOURCE_PORTS) {
    api.port({ id: r, name: `2:1 ${r}`, ratio: 2, resource: r });
  }

  api.preset({ id: 'standard', label: 'Standard' });
  api.preset({ id: 'blank', label: 'Blank (all water)', blank: true });
  api.preset({ id: 'archipelago', label: 'Archipelago', waterChance: 0.22 });
}
