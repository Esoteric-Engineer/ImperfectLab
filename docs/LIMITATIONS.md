# Limitations

Game limits that shape what ImperfectLab builds, found on GVLE69 in Dolphin.<br />
The decomp's [`docs/characters.md`](https://github.com/Esoteric-Engineer/mnroi/blob/main/docs/characters.md) has the code behind them.

## Memory when a match loads

A match loads the two characters' models into whatever memory is left after boot. When it runs out, the game crashes on the versus loading screen and Dolphin reports `Invalid write to 0x0000000c, PC = 0x8023f35c`.
Large custom models and the aura tint (below) both use that memory.

## Aura tint

- **The power-mode glow keeps the base's color.** It belongs to the base's cast name, and its data has no reader yet.
- **Fire is redrawn on the grey sprite.** The game's fire sprite (`GE_PAR_FireSprite_04`) is orange in its texture, so a tint can't turn it another color: the copies draw `GE_PAR_FireSprite_grey` with the orange folded into their colors, as costume 2's fire already does (tested in Dolphin). A costume whose bundle lacks the grey sprite (Human Torch's, Iron Man's and Aftershock's costume 1) gets it from Human Torch's costume 2, 8,192 bytes of the memory a match loads into.
- **Flames on a Human Torch base tint only the idle and power-up effects.** His full tint is 127 bytes from growing the cache past the limit (below), and any flames take more.
- **A fully transparent tint hides rather than copies.** A color with opacity `00` points every effect the tint would change at one empty `controller` instead of a copy, so it takes a fraction of a tint's memory (Human Torch's costume 1 hidden and costume 2 tinted fits the game's cache). Only `damage`, `ctrldamage` and `spawner` blocks, and the controllers over them, are copied, so a hidden projectile still hits (tested in Dolphin, Human Torch against the Thing). Any other opacity is a tint and costs as much as any other color.
- **Opacity darkens fire on the grey sprite.** `GE_PAR_FireSprite_grey` is drawn additively (`shader add` in `shaders.nsa`), which ignores alpha, so on it (flames, and tinted fire) a color's opacity scales the color toward black, which adds nothing. Half opacity is half as bright (tested in Dolphin).
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

So a patch of several characters fits only a few that need tuning: two with 10-letter internal names, five with 2-letter ones. The check on the **Multi-Character Patch** page adds the lines up before building. Characters with the base's or a swapped aura, the base's gameplay and cutscenes, no long baton throw, no stretched super attack far or pickup and no recolored stretched lines need no line, so nine of those fit.

## Baton throw

A Daredevil-based character's `throw_reach` (`base_moves`, [`FORMAT.md`](FORMAT.md)):

- **What it hits.** The target must be in front, more than 4 m away and no more than 10 m above or below.
- **Memory and space.** The character has its own copy of Daredevil's animations (about 2.7 MB on the disc), so a match against Daredevil loads both. It needs its own tuning file, so it takes a line in the tuning list (above).
- **`main.dol` changes.** `fn_8019DB24` (animation time setter) is rewritten in place so that a club that hits comes back from where it hit.

## Swapped moves

Moves taken from other bases (`moves`, [`FORMAT.md`](FORMAT.md)):

- **Only the animation changes.** Cost, reach and sounds stay the base's. Damage is one of the character's five values (below), though an animation that picks one brings its pick along. Effects stay the base's too unless taken (`move_effects`), and a cue the base has no effect for does nothing (the Thing's super throw on Daredevil has no hit flash).
- **Other body classes are approximate.** Their animations are mapped bone by bone, but limbs differ: a brute's grab on a male character holds the opponent at arm's length.
- **Memory and space.** The character has its own copy of the base's animations (about 1 to 3 MB on the disc), so a match against the base loads both.
- **Finishing moves are not moves.** They are cutscenes (below), not motion-set animations.
- **Taken effects (`theirs`) share the base's free effect slots with cutscene effects** (below). Moves get them first. A move with no free slot plays the base's effect of that number instead. The page and the patch notes say how many fit.
- **Taken lines are plain colored strands that start at the hand, not at a prop.** The textured strand (`primitive 5`) stretches its texture once along the line rather than repeating it, so only colors are offered.
- **A recolored line is a copy** of about 190 bytes per costume, out of the effect cache (above).
- **The super throw range** (`super_throw_range`) needs the character's own tuning file, so a line in the tuning list (above). A long range with a close grab slides the character over to the opponent.

## Idle moves

Moves that play the idle animation (`move_idle`, [`FORMAT.md`](FORMAT.md)):

- **A looping move plays the idle itself** at the idle's pace, so it doesn't restart every cycle or speed up with the run, and its own events go with it: running makes no footstep sounds, and a looping part of an attack (`WallAttackLoop`) doesn't hit.
- **A move that plays once still hits**, but from where the idle pose holds the fist or foot, so a punch can miss an opponent it used to reach.
- **The victim's side of a throw is unchanged**, so the opponent reacts to a throw the thrower doesn't make.
- **Memory and space** are as for swapped moves: the character has its own copy of the base's animations.

## Damage

The character's five damage values (`attack_damage_1` to `_5`, [`FORMAT.md`](FORMAT.md)):

- **Values, not moves.** The game has no damage per move. A motion starts with one of the five values, fixed by state in `fn_800DA884`, and its animation can switch to another (event `0x1B`). So changing a value changes every move that hits with it: the Thing's first value is his Attack 1, Attack 2 and Low attack.
- **Each CPU difficulty keeps its own copy** (lower for easy, higher for hard), scaled in proportion to the new value.
- **The opponent's damage taken still applies**, as does the game's per-difficulty multiplier.
- **A held object's swing** uses the object's strength, not these values.
- **Projectiles keep their damage.** They pass their own damage to the hit (`fn_800A0488`), so a ranged attack is unchanged.
- **Memory and space.** Changed values need the character's own tuning file, so they take a line in the tuning list (above).

## Wall climbing and running

A base that can't climb walls or run on them given wall climbing (`wall_climb`) or wall running (`wall_run`, [`FORMAT.md`](FORMAT.md)):

- **The CPU climbs and runs too**, since every AI profile reads the same bits.
- **The animations are added like swapped moves:** the same memory cost, and other body classes are approximate.
- **No ranged attack on the wall** (`WallClimbRangedAttack`). Only Spider-Man and Venom have one, and it fires the base's own projectile.

## Range grab

A Daredevil-based character's `range_grab` (`base_moves`, [`FORMAT.md`](FORMAT.md)):

- **Light props only** unless `stats.gameplay.lift` is raised: Daredevil has no medium or heavy lift.
- **The animation is added like a swapped move:** the same memory cost, and a Venom `WirePull` is approximate on Daredevil's skeleton. `WirePullFly` only plays in flight, so it isn't offered.

## Stretching limbs

Moves that stretch a limb out and back (`move_reach`, [`FORMAT.md`](FORMAT.md)):

- **A hit goes at most 1 m a frame**, as faster passes targets between frames, so a long reach slows the move: a 20 m super attack far takes 40 frames out and back.
- **A stretched super attack far needs the character's own tuning file**, since its distance is also its target range: a line in the tuning list (above). On a Daredevil base the arm hit the opponent about 10 m out. On a Spider-Man base it hit nothing, as his far attack is a web pull.
- **Daredevil's moves that hit with his club's long volume hit from the stretched arm instead**, and a long baton throw can't be combined with a stretched super attack far or super rise attack.
- **The arm doesn't come back from where it hits.**
- **A stretched grab moves the thrower to `distance` from the opponent**, so a grab started nearer or farther shifts the thrower back or forward.
- **A long grab doesn't pull the opponent in.** Their side of the throw plays where they stood, and the hand follows the line's end on them, posed on a stand-in of their body class. It trails briefly when they're launched. Daredevil's opponent animation ends before his cable lets go, so the hand waits where they were.
- **A pickup doesn't know where the object is**: it takes it to be `distance` ahead. A nearer object is overshot, so recolor or hide the line (`move_lines`). Props are found within `distance` (the tuning's pickup range, 10 m by default), so a stretched pickup needs the character's own tuning file: a line in the tuning list (above). The same field also replaces `fn_80158038`'s reach (field 210) for a character with the ability.
- **A swing's wire ends 3 m ahead and 10 m up** from where the character stood, wherever the wire actually lands.
- **A stretched jump only changes how the legs look**: how high and far it goes, its timing and the character's collision are the base's. The feet can pass through a ledge or thin floor at the peak, and the landing and falling animations are not stretched.
- **Memory and space** are as for swapped moves: the character has its own copy of the base's animations.

## Size

A character made bigger or smaller than its base (`model.size`, [`FORMAT.md`](FORMAT.md)):

- **What grows with it**: the model, the base's skeleton, hit regions and shadow, the attack volumes, every animation's bone offsets (so steps and lunges on the ground cover more or less ground), each motion's stride, and the collision body's radius and height (`act_` template `RADIUS` and `HEIGHT`), which the camera, lock-on and aura heights follow.
- **Travel off the ground stays the base's.** An animation whose root rises or falls (jumps, air attacks, dives, wall moves, swings, ledge pull-ups, being knocked into the air) moves the character as far as the base, since sized travel made air attacks miss and wouldn't meet the arena's ledges. So a big character jumps no higher than its base, and a small one as high.
- **What doesn't**: run and sprint speeds (`stats.gameplay.run_speed` and `sprint_speed` change them, and the legs keep pace with the ground either way), grab, aim and pickup ranges, which are measured to the opponent, and effects.
- **The collision body has a floor.** The game makes it at least 0.6 m plus its diameter tall, with a 0.6 m gap under it, so a very small character still takes up about 0.7 m.
- **Throws are approximate.** The opponent's side of a throw is played at their size, so a big thrower's hands land beyond them and a small one's short of them, and the throw's camera is the base's.
- **Cutscenes play on the sized skeleton** with the base's animations and camera.
- **Memory and space** are as for swapped moves: the character has its own copy of the base's animations, so a match against the base loads both.

## Cutscenes

Cutscenes and audio changed on the **Cutscenes** page (`cutscenes`, [`FORMAT.md`](FORMAT.md)):

- **Effects come from the base unless moved.** A cutscene's effects are looked up on the character's tuning file, so by default the base's effect plays, which can look weird.
- **`theirs` fits only so many effects.** It gives each effect a free slot in the character's tuning file, and a base has only 2 (Johnny Ohm) to 10 (Daredevil, Paradox, Elektra) of them. Taking every kind's effects from another base fits about 89% of them, a finisher's alone about 98%; the rest stay the base's. The page and the patch notes say how many fit.
- **`none` removes only the cutscene's own effects.** The character's always-on effects, such as a glow, still show.
- **Projectiles and sounds stay the base's.**
- **Other body classes are approximate.** Their animations are mapped bone by bone, but limbs differ, as for swapped moves. The victim's side of a finisher is unchanged.
- **New audio replaces the whole mix** (voice, music and sounds) and can be no longer than the track it replaces; a shorter one is padded with silence, because the cutscene keeps time with its audio.

## Sounds

Sounds replaced on the **Sounds** page (`sounds`, [`FORMAT.md`](FORMAT.md)):

- **Only the base's sound effects.** Each character's sound effects are one AEMS bank, `Sounds/SFX_<base>.abk`. Voices and taunts are streamed from files every character shares (`SFX_common.ast`, `Sounds/ASF/`), and the select-screen voice is in the shared `SFX_FE.abk`, so they can't be changed for one character. A sound can only replace one the base already plays: the game's events pick a bank's sounds by their place in it.
- **The character's own bank.** The patch copies the base's bank with the new sounds as `Sounds/SFX_<internal name>.abk` and rewrites `fn_80114420`, which loads each player's bank, in place: it picks a new character's bank by the player's template name (`plr_<name>`), since a new character shares its base's type ID. A sound used for several slots is stored once, and one that replaces a looping sound loops in full.
- **A match against the base shares one set of sounds.** A bank's modules carry global AEMS IDs, and a copy keeps its base's, so the base's bank and the copy can't both be loaded. `fn_80114420` loads one bank per type ID, the first player's: in a match against the base, or against another character built on it, both fighters use the first player's sounds.
- **Memory.** A match loads both players' banks. A bank may be no larger than `SFX_Roekel.abk` (969,672 bytes), the largest character bank, since a Roekel mirror match loads two of those. Uploads are mono DSP ADPCM, about 12 KB a second at 22 kHz, so the room for new sound, beyond what the replaced sounds took, runs from none on Roekel to about 40 seconds on Daredevil.
- **Rates.** A sound with no rate in its bank header plays at 24,000 Hz (`fn_80258188`, the bank parser, sets it before reading the header).
- **Names.** The game has none, only each sound's place in its bank. The names the **Sounds** page shows are our own, from `src/core/game/sounds.json` (base -> the sound's number as the page lists it -> name); a sound with an empty name shows only its number.

## Z button

The action picked on the **Z-Button Actions** page (`z_button`, [`FORMAT.md`](FORMAT.md)):

- **CPU players never press it.** Their input class doesn't read the table.
- **Two players at once.** The rewrite has room for two active players, which a versus match never exceeds.

## More characters

The roster tables in `main.dol` hold 20 records, and the 19th character takes the last one (a filler copy of the Thing). For a 20th and more, up to a 27th, the patch copies the three tables, grown to one record per character, into a new data section, and points their only four readers (`fn_80431CCC` and `fn_8044F070`) at the copies. `fn_8044F070` searches the order table up to a fixed index, which is raised with the count.

- **27 is the most the select screen shows.** Its grid is 9 tiles wide and 3 rows deep; the new characters fill the third row, and a 4th row would be off the screen.
- **The section takes 3,296 bytes (two characters) to 4,384 bytes (nine) from the memory a match loads into.** It sits where the arena used to start, `0x806809C0`, and the arena now starts after it. `OSInit` picks the arena start from `__ArenaLo`, or from `_stack_addr` when the disc's BI2 debug flag is below 2; Dolphin boots GVLE69 through the second, so both are moved.
- **`main.dol` no longer fits before the FST** (the disc leaves 64 bytes), so the FST moves after it and `boot.bin` points to it.
- **Each character adds its four HUD portraits to every `HUD/hud<LANG>.1.gsh`** (and its name banner to `hud<LANG>.2.gsh`), which the game loads for a match.