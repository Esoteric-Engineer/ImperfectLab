# Limitations

Game limits that shape what ImperfectLab builds, found on GVLE69 in Dolphin.<br />
The decomp's [`docs/characters.md`](https://github.com/Esoteric-Engineer/mnroi/blob/main/docs/characters.md) has the code behind them.

## Memory when a match loads

A match loads the two characters' models into whatever memory is left after boot. When it runs out, the game crashes on the versus loading screen and Dolphin reports `Invalid write to 0x0000000c, PC = 0x8023f35c`.
Large custom models and the aura tint (below) both use that memory.

## Aura tint

- **The power-mode glow keeps the base's color.** It belongs to the base's cast name, and its data has no reader yet.
- **A transparent tint is still a tint.** A color with opacity `00` hides the aura (tested in Dolphin), but the copies are still made and take the same effect memory as any other color.
- **Effect memory.** Every effect is loaded into a 300,000-byte cache, 290,971 bytes of it used by the game. When a tint's copies don't fit the rest, the patch grows the cache in `main.dol` by what they need plus 2 KB, and that memory comes out of what a match has to load into.
- **A full tint (`all`) may grow it by at most 8,224 bytes**; a base whose full tint needs more is built with only its idle and power-up effects (`power`), which fits every base without growing it. Currently only affects Iron Man.
  Tested with custom models:

  | Base | Tint | Cache grown by | Match | Result |
  |---|---|---|---|---|
  | Johnny Ohm | all | 8,224 | mirror | loaded |
  | Human Torch | all | 8,224 | mirror | loaded |
  | Johnny Ohm | all | 11,296 | mirror | loaded |
  | Iron Man | all | 10,272 | vs Wolverine | crashed |
  | Iron Man | power | 0 | mirror | loaded |

  Johnny Ohm loaded at 11,296 where Iron Man crashed at 10,272: the models matter as much as the tint, so a very large model can still need `power` on another base.

What each base's full tint needs:

| Base | Full tint grows the cache by |
|---|---|
| Iron Man | 10,272 (falls back to `power`) |
| Johnny Ohm, Human Torch | 8,224 |
| Heatwave, Roekel | 7,200 |
| Aftershock, Biohazard, Storm | 5,152 |
| Defcon, Megalith | 4,128 |
| Daredevil, Elektra, Magneto, Paradox, Spider-Man, Venom, Wolverine | 0 |
| Thing | nothing to tint |

## Tuning

Every character with changed stats, a tint or changed cutscenes gets its own tuning file. Each one listed in `Misc/nvblist.txt` takes 12,354 bytes when the game boots, and the list itself has room for about 53 more bytes (a line costs its two names plus 2, so `PLAYER <internal name>` costs the name's length plus 8).

So a patch of several characters fits only a few that need tuning: two with 10-letter internal names, five with 2-letter ones. The check on the **Multi-Character Patch** page adds the lines up before building. Characters with the base's or a swapped aura, the base's gameplay and cutscenes and no long baton throw need no line, so nine of those fit.

## Baton throw

A Daredevil-based character's `throw_reach` (`base_moves`, [`FORMAT.md`](FORMAT.md)):

- **What it hits.** The target must be in front, more than 4 m away and no more than 10 m above or below.
- **Memory and space.** The character has its own copy of Daredevil's animations (about 2.7 MB on the disc), so a match against Daredevil loads both. It needs its own tuning file, so it takes a line in the tuning list (above).
- **`main.dol` changes.** `fn_8019DB24` (animation time setter) is rewritten in place so that a club that hits comes back from where it hit.

## Swapped moves

Moves taken from other bases (`moves`, [`FORMAT.md`](FORMAT.md)):

- **Only the animation changes.** Damage, cost, reach, sounds and effects stay the base's, and a cue the base has no effect for does nothing (the Thing's super throw on Daredevil has no hit flash).
- **Other body classes are approximate.** Their animations are mapped bone by bone, but limbs differ: a brute's grab on a male character holds the opponent at arm's length.
- **Memory and space.** The character has its own copy of the base's animations (about 1 to 3 MB on the disc), so a match against the base loads both.
- **Finishing moves are not moves.** They are cutscenes (below), not motion-set animations.

## Cutscenes

Cutscenes and audio changed on the **Cutscenes** page (`cutscenes`, [`FORMAT.md`](FORMAT.md)):

- **Effects come from the base unless moved.** A cutscene's effects are looked up on the character's tuning file, so by default the base's effect plays, which can look weird.
- **`theirs` fits only so many effects.** It gives each effect a free slot in the character's tuning file, and a base has only 2 (Johnny Ohm) to 10 (Daredevil, Paradox, Elektra) of them. Taking every kind's effects from another base fits about 89% of them, a finisher's alone about 98%; the rest stay the base's. The page and the patch notes say how many fit.
- **`none` removes only the cutscene's own effects.** The character's always-on effects, such as a glow, still show.
- **Projectiles and sounds stay the base's.**
- **Other body classes are approximate.** Their animations are mapped bone by bone, but limbs differ, as for swapped moves. The victim's side of a finisher is unchanged.
- **New audio replaces the whole mix** (voice, music and sounds) and can be no longer than the track it replaces; a shorter one is padded with silence, because the cutscene keeps time with its audio.

## More characters

The roster tables in `main.dol` hold 20 records, and the 19th character takes the last one (a filler copy of the Thing). For a 20th and more, up to a 27th, the patch copies the three tables, grown to one record per character, into a new data section, and points their only four readers (`fn_80431CCC` and `fn_8044F070`) at the copies. `fn_8044F070` searches the order table up to a fixed index, which is raised with the count.

- **27 is the most the select screen shows.** Its grid is 9 tiles wide and 3 rows deep; the new characters fill the third row, and a 4th row would be off the screen.
- **The section takes 3,296 bytes (two characters) to 4,384 bytes (nine) from the memory a match loads into.** It sits where the arena used to start, `0x806809C0`, and the arena now starts after it. `OSInit` picks the arena start from `__ArenaLo`, or from `_stack_addr` when the disc's BI2 debug flag is below 2; Dolphin boots GVLE69 through the second, so both are moved.
- **`main.dol` no longer fits before the FST** (the disc leaves 64 bytes), so the FST moves after it and `boot.bin` points to it.
- **Each character adds its four HUD portraits to every `HUD/hud<LANG>.1.gsh`** (and its name banner to `hud<LANG>.2.gsh`), which the game loads for a match.
- Tested in Dolphin: the 18 original characters in a match, and the Doctor Doom and Captain America mod's disc picking both new characters with this `main.dol` in place of its compiled one. The same layout with 27 characters played in Dolphin, including matches against the 27th. A loader that sets the boot info's arena start itself (`0x80000030`) would put the arena over the tables; Dolphin does not.
