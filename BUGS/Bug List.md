```
BUG 1
Saw:        world gen for tidebound dlc
Expected:   when tidebound dlc is selected, the board should be generated with many islands, bigger tile radius to accomodate for the 4-6 water tiles inbetween each landmass
Actual:     no changes in world gen, preset/options are not overwriten by tidebound
Before it:  toggle dlc tidebound on, changes the map radius to make board bigger, and start game.
Repro:      all seed + DLC - tidebound: ravenous shore
Severity:   wrong rule
Error text: none
Screenshot: image 1 and 2 in claude chat
```

```
BUG 2
Saw:        UI
Expected:   live log recording 2 separate stream of information
Actual:     these 2 stream of information should have been merge into one (live log merged into turn history)
Before it:  toggle dlc tidebound on, changes the map radius to make board bigger, and start game.
Repro:      none
Severity:   wrong visual
Error text: none
Screenshot: image 3 in claude chat
```

```
BUG 3
Saw:        Gameplay
Expected:   Live Log should announce and record dev card usage, for knights: on who, for monopoly: how many of what, for plenty: what chose
Actual:     it does not say anything about dev card usage
Before it:  none
Repro:      none
Severity:   annoying
Error text: none
Screenshot: none
```

```
BUG 4
Saw:        UI
Expected:   Live log should not records turn passed for trading
Actual:     it records passing trade as pass turn
Before it:  none
Repro:      none
Severity:   annoying
Error text: none
Screenshot: Image 4 in claude chat
```

```
BUG 5
Saw:        UI
Expected:   # for resources cost tips on hover, stack same card type with one edge showing so player can see how many are required while still showing resources (for actions + tech tree + live log (basically anything that uses the resource icon))
Actual:     It show item separately, side by side, taking up space
Before it:  none
Repro:      none
Severity:   annoying
Error text: none
Screenshot: Image 5 in claude chat
```

