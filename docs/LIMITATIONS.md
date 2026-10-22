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

Every character with changed stats or a tint gets its own tuning file. Each one listed in `Misc/nvblist.txt` takes 12,354 bytes when the game boots, and the list itself has room for about 53 more bytes (a line costs its two names plus 2).

## A 20th character

The roster tables in `main.dol` hold 20 records, and the 19th character takes the last one (a filler copy of the Thing). For a 20th, the patch copies the three tables, grown to 21 records, into a new data section, and points their only four readers (`fn_80431CCC` and `fn_8044F070`) at the copies.

- **The section takes 3,296 bytes from the memory a match loads into.** It sits where the arena used to start, `0x806809C0`, and the arena now starts after it. `OSInit` picks the arena start from `__ArenaLo`, or from `_stack_addr` when the disc's BI2 debug flag is below 2; Dolphin boots GVLE69 through the second, so both are moved.
- **`main.dol` no longer fits before the FST** (the disc leaves 64 bytes), so the FST moves after it and `boot.bin` points to it.
- Tested in Dolphin: the 18 original characters in a match, and the Doctor Doom and Captain America mod's disc picking both new characters with this `main.dol` in place of its compiled one. A loader that sets the boot info's arena start itself (`0x80000030`) would put the arena over the tables; Dolphin does not.
