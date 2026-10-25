// MODULE: all dialogue lines, plus which (event, style) pairs are silent on purpose | USED BY: bots/dialogue/engine, tests
import type { ChatStyle } from '../../tiers';
import type { DialogueEvent, Line } from '../types';
import { AWARD_LINES } from './awards';
import { BUILD_LINES } from './build';
import { ROBBER_LINES } from './robber';
import { ROLL_LINES } from './roll';
import { TABLE_LINES } from './table';
import { TRADE_LINES } from './trade';

export const ALL_LINES: Line[] = [
  ...ROLL_LINES,
  ...ROBBER_LINES,
  ...BUILD_LINES,
  ...AWARD_LINES,
  ...TRADE_LINES,
  ...TABLE_LINES
];

/** Overload says less on purpose: it never celebrates a good roll and never telegraphs how close it is to winning. */
export const SILENT: Partial<Record<DialogueEvent, ChatStyle[]>> = {
  goodRoll: ['cold'],
  noProduction: ['cold'],
  oneVpLeft: ['cold']
};
