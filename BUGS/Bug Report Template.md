# Bug Report Template

Copy the block under "Report" into a new message to the AI and fill it in. Short answers are fine. Every field has an escape ("don't know" is always allowed), so never skip the report because one field is unclear.

## Report

```
BUG
Saw:        (pick one, see the list below)
Expected:   one sentence, what should have happened
Actual:     one sentence, what happened instead
Before it:  what I did just before (last 1 to 3 actions)
Repro:      paste the debug state, OR: room code + seed + DLC/addon set
Severity:   crash / wrong rule / wrong visual / bot dumb / annoying
Error text: (only if there was one, paste it exactly)
Screenshot: (optional, say which player's view)
```

## "Saw" choices (what you saw on screen, not where the code is)

| Saw | Meaning |
|---|---|
| Picture | Wrong drawing, button, overlay, tint, text or animation |
| Rule | A cost, VP count, or legal/illegal move was wrong |
| Bot | A bot did something dumb or impossible |
| Event | A random or timed thing was wrong (pirate, tide, wreck, a 7, event card) |
| Sync | Lobby, joining, disconnects, or players seeing different things |
| Crash | Error message, frozen game, blank screen |
| Don't know | Let the AI triage |

## Rules for the AI (copied into CLAUDE.md)

1. **Triage first.** Before reading code, name the likely area and the first file to open, in one line, from the report. If "Saw" is "Don't know", use Before it and Repro to guess. Open at most 2 files to confirm. If still unsure, ask one question instead of searching further.
2. **Stay in the area.** Open only the files for that area (see `ROUTER.md`). Search for a symbol before opening a file. No whole folders.
3. **Test first.** Write a failing test that shows the bug, then the fix. A fix with no new test is not done.
4. **Small fix.** Expect 3 files or fewer. If more are needed, say why: it may be a wrong diagnosis.

## Fix report (the AI answers in this shape)

```
CAUSE:        file:function, one sentence
FIX:          files changed (and why, if more than 3)
REGRESSION:   test name, and whether it fails without the fix
NOT VERIFIED: what I could not run or check
COMMANDS:     the exact commands for me to run
```

Commands for PowerShell (no `&&`):

```
npm run headers:write; npm run index; npm run typecheck; npm test
```

## Example

```
BUG
Saw:        Event
Expected:   A pirate should not rob a city it is not touching
Actual:     Pirate on tile #14 robbed a city two tiles away
Before it:  Ended my turn, round 5 started
Repro:      room ABCD, seed 1301, Tidebound on, pirates addon on
Severity:   wrong rule
```

## Still to build

- A "Copy debug state" button (room code, seed, settings, addon set, action log, spectator-view state) so Repro is one paste.
- A symptom router (`BUGS.md`): per "Saw" choice, the files to open first, the test file, and a "check first" hint.
- A test that checks every file named in the router exists.
