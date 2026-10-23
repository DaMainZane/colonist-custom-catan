export const RESOURCES: string[] = ['wood', 'brick', 'sheep', 'wheat', 'ore'];

export const RES_META: Record<string, { color: string; border: string; name: string }> = {
  wood:   { color: '#119b18', border: '#0c7511', name: 'Wood' },
  brick:  { color: '#f04716', border: '#bd320b', name: 'Brick' },
  sheep:  { color: '#6ec914', border: '#52990d', name: 'Sheep' },
  wheat:  { color: '#fff59d', border: '#d4c028', name: 'Wheat' },
  ore:    { color: '#9da9b0', border: '#74828a', name: 'Ore' },
  desert: { color: '#d4c890', border: '#b3a56b', name: 'Desert' },
  gold:   { color: 'url(#goldGrad)', border: '#d48800', name: 'Gold' },
  fog:    { color: 'url(#fogGrad)', border: '#78909c', name: 'Fog' }
};

