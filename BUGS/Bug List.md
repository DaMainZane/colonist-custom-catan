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
