```
BUG 1
Saw:        UI
Expected:   clicking X in tag for live log unselect it
Actual:     Tags in live log cannot be cancel (x button doesnt work), still selected
Before it:  none
Repro:      none
Severity:   annoying
Error text: none
Screenshot: image 1 in Coding Project/colonist-custom-catan/BUGS/Image
```

```
BUG 2
Saw:        UI
Expected:   interactive tech tree
Actual:     Tech tree cannot zoom in or out, and move around using mouse
Before it:  none
Repro:      none
Severity:   cannot interact with the game UI
Error text: none
Screenshot: image 2 in Coding Project/colonist-custom-catan/BUGS/Image
```

```
BUG 3
Saw:        UI
Expected:   Tech tree only show cost when zoom in close enough to not clutter the screen
Actual:     Tech tree when zoom out still show cost so it does clutter the screen, extremely annoying
Before it:  none
Repro:      none
Severity:   cannot interact with the game UI
Error text: none
Screenshot: image 2 in Coding Project/colonist-custom-catan/BUGS/Image
```

```
BUG 4
Saw:        event (spawning mechanic)
Expected:   Fish token should either spawn single next to shore, or in cluster in the ocean (need a classification for what is ocean, maybe middle tiles between landmass). Cluster fish zone boost fish yield in net (compounding with other means to increase fish from net). More fish in cluster (4 tiles of fish together field higher chance to get fish than 3 tiles)
Actual:     Fish token spawn randomly, all over the place. Lacking mechanic
Decided:    (2026-11-01) Ocean = water tiles that are not next to land. A cluster of 3 fish tiles gives a net the same chance as a settlement on a 4-2-3 spot (6 dots: token 4 = 3, token 2 = 1, token 3 = 2); each extra connected fish tile adds +2 dots (4 tiles = 4-4-3 = 8 dots). It stacks with the other ways to raise net fish.
Rules:      (2026-11-01) The spawn uses a derived random stream, not g.rng. CLAUDE.md already allows that, so it needs no change, and the golden snapshot should stay untouched with Tidebound off. Not checked yet; confirm when coding.
Open:       Yield of a cluster of 1 or 2, and of a single fish next to shore. If the +2 rule runs downward: 2 tiles = 4 dots, 1 tile = 2 dots. Confirm. 
Before it:  none
Repro:      dlc - tidebound
Severity:   wrong rule
Error text: none
Screenshot: image 3 in Coding Project/colonist-custom-catan/BUGS/Image
```

```
BUG 5
Saw:        UI
Expected:   fish icon move/offset automatically into predetermine vertices when other icon comes into its tile so it does overlap (for example the ship icon)
Actual:     being overlapped
Before it:  none
Repro:      dlc - tidebound
Severity:   wrong UI
Error text: none
Screenshot: image 4 in Coding Project/colonist-custom-catan/BUGS/Image
```

```
BUG 6
Saw:        UI
Expected:   pirate icon is similar to the other icon in design, should be easier to see (also icon similar to 5 resources in design) - sheep, tree, etc. icon design is very good
Actual:     very bland 
Before it:  none
Repro:      dlc - tidebound
Severity:   wrong UI
Error text: none
Screenshot: image 5 and 6 (5 is pirate and 6 is resources as reference) in Coding Project/colonist-custom-catan/BUGS/Image
```

```
BUG 7 
Saw:        UI
Expected:   fish icon is similar to the other icon in design, should be easier to see (also icon similar to 5 resources in design) - sheep, tree, etc. icon design is very good
Actual:     very bland 
Before it:  none
Repro:      dlc - tidebound
Severity:   wrong UI
Error text: none
Screenshot: image 7 and 6 (7 is fish and 6 is resources as reference) in Coding Project/colonist-custom-catan/BUGS/Image
```

```
BUG 8 
Saw:        game mechanic
Expected:   Flooded tile should not yield full resources when roll, but it should halves resources roll, rounded up
Actual:     Flooded tile yield full resources when roll
Decided:    (2026-11-01) Halve each building's yield, rounded up: settlement 1 -> 1, city 2 -> 1, castle (3, if that is its yield) -> 2. Applied per building, not on the player's total.
Before it:  none
Repro:      dlc - tidebound
Severity:   gameplay
Error text: none
Screenshot: none
```

```
BUG 9
Saw:        UI
Expected:   Shipwreck spawn should not block number on tile
Actual:     it is blocking the number
Before it:  none
Repro:      dlc - tidebound
Severity:   wrong UI
Error text: none
Screenshot: image 9 in Coding Project/colonist-custom-catan/BUGS/Image
```

```
BUG 10
Saw:        UI
Expected:   flooded filter no longer include vertical and horizontal line, only wave pattern
Actual:     flooded filter still include ugly vertical and horizontal line, only wave pattern
Before it:  none
Repro:      dlc - tidebound
Severity:   wrong UI
Error text: none
Screenshot: image 9 in Coding Project/colonist-custom-catan/BUGS/Image
```

```
BUG 11
Saw:        UI
Expected:   a tint darker blue (reuse the roll seven filter for robber selection) for tide covered tiles UI
Actual:     barely able to see what tile is covered. UI visibility is low when zoomed out
Before it:  none
Repro:      dlc - tidebound
Severity:   wrong UI
Error text: none
Screenshot: image 9 in Coding Project/colonist-custom-catan/BUGS/Image
```

```
BUG 12
Saw:        gameplay
Expected:   Shipwreck should gives more resources across the board. universal for shipwreck shore and ocean.
Actual:     shipwreck giving barely any resources
Decided:    (2026-11-01) The shipwreck's resource limit is doubled, then filled with random picks from the 5 basic resources. A round bonus is added to the limit: floor(0.7 x round) = round 1: 0, 2: 1, 3: 2, 4: 2, 5: 3, and so on. Same for shore and ocean shipwrecks.
Open:       Assumed the round bonus is added on top of the doubled limit (not doubled with it), and that "round" counts game rounds from 1. The current limit value is not checked yet. Confirm.
Before it:  none
Repro:      dlc - tidebound
Severity:   wrong UI
Error text: none
Screenshot: none
```

```
BUG 13
Saw:        UI
Expected:   bridge icon (both rickety and normal, with color outline to see whose it belong to) is beautiful, standout from normal road design but still follow UI philosophy design. 
Actual:     it is bland, ugly, and uninspiring. also weird lines running across it. not uniform
Before it:  none
Repro:      dlc - tidebound
Severity:   wrong UI
Error text: none
Screenshot: image 10 in Coding Project/colonist-custom-catan/BUGS/Image
```

```
BUG 14
Saw:        optimization
Expected:   Optimized big map to reduce lag when moving around the screen
Actual:     lag spike, stuttering, and framerate issues persist
Before it:  none
Repro:      none
Severity:   Annoying
Error text: none
Screenshot: none
```

```
BUG 15
Saw:        (pick one, see the list below)
Expected:   No weird log message or undefined. Instead it should just say who robbed who. Moving the robber to where should be removed
Actual:     Move the robber to Hex undefined in live log
Before it:  none
Repro:      none
Severity:   Annoying
Error text: none
Screenshot: image 11 in Coding Project/colonist-custom-catan/BUGS/Image
```

```
BUG 16
Saw:        UI
Expected:   Fishing net should clarify it is a tile modification and require a settlement and above to be built on fish token tile
Actual:     no prompt to show this in tech tree, and it is unknown if the mechanic is in game (require a settlement before building net on adjacent tiles).
Before it:  none
Repro:      dlc - tidebound
Severity:   wrong rule
Error text: none
Screenshot: image 12 and 13 in Coding Project/colonist-custom-catan/BUGS/Image
```

```
BUG 17
Saw:        UI
Expected:   Shipwreck when spawn should have an indicator to show it exist for 1 round. 
Actual:     no indicator exist 
Before it:  none
Repro:      dlc - tidebound
Severity:   wrong rule
Error text: none
Screenshot: none
```


















