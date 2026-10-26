# Backlog Priority (easiest to hardest)

Source: Dashboard > Catan Project. Written 2026-10-26.

## Built-in preset ideas

**Classic-adjacent**
- Classic 3-4p: standard balanced board, the baseline
- Beginner: fixed fair layout, no 6/8 adjacent, gentler robber
- Seafarers-style Islands: several landmasses, more ports
- Big Table (5-6p): extended board with scaled resources and dev cards

**Variant modes**
- Speed Catan: low VP target, short timers, generous starting resources
- Resource Rush: double production, cheap builds
- Scarcity: extra desert/ocean tiles, fewer resources, harsh robber
- Balanced Fair: auto-tuned number placement to equalize pip counts per spot
- Chaos: random terrain, numbers, and ports
- Robber's Revenge: more frequent 7s, lower discard limit
- Peaceful: no robber or no stealing

**Shape-based** (depends on the shape bug fix)
- River Valley: a river splits the map in two
- Archipelago: many small islands
- Ring / Donut: hollow center
- Duel (2p): small map

## Tier 1: quick wins (hours)
1. Seed show toggle
2. Increase size of settlement and city
3. Randomize first player to place settlement
4. Lobby UI scrolls instead of expanding
5. Add built-in presets (config data, custom presets already work)

## Tier 2: small features (about a day)
6. Invalid trade ratio prompt, plus suggestion when a port offers a better ratio
7. Preset or auto-scale dev cards based on max card count
8. Turn timer + visualizer (none exists yet)
9. Auto-discard when player timer runs out (depends on 8)
10. Optimize victory screen

## Tier 3: medium (a few days)
11. Fix river/islands "add to shape" bug (falls back to hexagon). Unblocks shape-based presets.
12. Settings and navigation UI rework
13. Reconnect after accidental logout (session persistence + state resync)
14. Data log for bot training (JSON lines of states, actions, outcomes; settle the schema first)

## Tier 4: hard (a week or more)
15. Port spawn rework to match real game (rule for modded terrain, cap ports per landmass)
16. Optimize bot initial placement (pip count, resource diversity, port access, expansion room)
17. Optimize for bigger maps (profile first: rendering vs pathfinding)
18. Full board UI rework, split per use case (board, hand/resources, chat/log, trade, actions) and ship piece by piece

## Suggested order
Clear Tier 1 together, then the turn timer, then the shape bug. The shape fix (11), port rework (15) and big-map optimization (17) all touch map generation, so do them back to back. Do the UI rework last or in parallel since it touches everything else.
