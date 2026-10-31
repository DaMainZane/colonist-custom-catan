// MODULE: small pure helpers (clamp, pips) | DEPENDS ON: none | USED BY: server/bots/brain, server/bots/mapProfile, server/bots/trainingLog, server/lobby
export function clamp(val: any, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function getPips(num: number | null | undefined): number {
  if (!num || num === 7) return 0;
  return Math.max(0, 6 - Math.abs(7 - num));
}
