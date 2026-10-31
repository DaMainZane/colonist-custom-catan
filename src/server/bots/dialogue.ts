// MODULE: bot dialogue (re-export, the engine lives in bots/dialogue/) | DEPENDS ON: server/bots/dialogue/index | USED BY: server/game, server/socket
// Kept so existing imports of './bots/dialogue' keep working. See bots/dialogue/index.ts for the entry points.
export { emitBotDialogue, emitGameStartDialogue, reactToChat } from './dialogue/index';
