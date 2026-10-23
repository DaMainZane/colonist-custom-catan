// Shared mutable UI state. Scalars are `let` exports with setters (ES live bindings),
// objects are const and mutated in place, so other modules can keep reading them directly.
import type { GameState, Resources } from './types';

export let state: GameState | null = null;
export let soundOn = true;
export let isMouseDown = false;
export let buildMode: string | null = null;
export let drawerMode: string | null = null;
export let victoryTab = 'dice';
export let hideVictoryOverlay = false;

export let camZoom = 1;
export let camPanX = 0;
export let camPanY = 0;
export let isPanning = false;

export const activeBrush = { type: 'terrain', value: 'wood' };
export const panStart = { x: 0, y: 0 };

export const tradeGive: Resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
export const tradeWant: Resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
export const discardSel: Resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };

export function setState(s: GameState): void { state = s; }
export function setSoundOn(v: boolean): void { soundOn = v; }
export function setIsMouseDown(v: boolean): void { isMouseDown = v; }
export function setBuildModeValue(v: string | null): void { buildMode = v; }
export function setDrawerMode(v: string | null): void { drawerMode = v; }
export function setVictoryTab(v: string): void { victoryTab = v; }
export function setHideVictoryOverlay(v: boolean): void { hideVictoryOverlay = v; }
export function setCamZoom(v: number): void { camZoom = v; }
export function setCamPan(x: number, y: number): void { camPanX = x; camPanY = y; }
export function setIsPanning(v: boolean): void { isPanning = v; }

export function clearRes(r: Resources): void {
  for (const k of Object.keys(r)) r[k] = 0;
}
