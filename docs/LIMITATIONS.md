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

## Motion trails

The ribbons on the **Aura** page (`trails`, [`FORMAT.md`](FORMAT.md)):

- **Straight between joints.** A ribbon runs straight from one joint to the next, so it doesn't follow a bent or bulky limb's outline.
- **Effect memory.** A color's ribbon and controllers take 206 bytes of the effect cache for the arms alone and 452 for every part, and two costumes of the same color share them. They count against what a full aura tint may grow the cache by.

## Glowing eyes

- **Replaces the base's eye markers.** Base effects drawn on the eyes (Storm's power-up arcs) follow the new eyes, and an Iron Man base's own glow is left out.
- **Effect memory.** A color takes 93 bytes of the effect cache (white at size 1 is Iron Man's own and takes none).

## Projectile swap
The `projectile` swap (manifest [`projectile`](FORMAT.md#projectile)):

- **Every shot, not per move.** All tuning fields the base's moves launch from (90-93) get the copy. A carried object is still thrown from the hands.
- **The base's sound.** The shot plays the sound of the shot it replaces, as the character loads only its base's sound bank.
- **Damage and flight are the donor's.**
- **Memory.** About 780 bytes of effect memory per tinted copy (one when both costumes match), plus 2 KB per costume for the explosion texture only Iron Man's bundles have.
- **Launch bone.** The offset is fixed to the bone, so on a limb it turns with the limb during a move.

## Removed projectiles
`projectile.remove` (manifest [`projectile`](FORMAT.md#projectile)):

- **Shots only.** Each move that launches one loses its launch event (`0x04`), but its animation, charge-up effects, sounds and energy cost stay. Carried objects are still thrown.
- **The CPU still tries to use the moves as ranged attacks.**
- **Attack far in their place** (`melee`): the ground moves that shot play the base's attack far instead. Its event `0x1B` picks attack far's damage value, so a super attack hits as hard as attack far, and costs its super energy all the same. The lunge goes as far as attack far's does, so a ranged attack started from far away misses.
- **Air and wall moves keep their animation** without the shot (super jump attack, air ranged, swing, wire and wall attacks), as a ground lunge doesn't fit them.
- **Moves changed on the Moves page** (taken, imported, idle or stretched) keep their animation, without the shot.
- **Space.** Each animation that loses its shot is copied without it, as for swapped moves. A move that plays attack far adds nothing.

## Tuning

Every character with changed stats, a tint or changed cutscenes gets its own tuning file. Each one listed in `Misc/nvblist.txt` takes 12,354 bytes when the game boots, and the list itself has room for about 53 more bytes (a line costs its two names plus 2, so `PLAYER <internal name>` costs the name's length plus 8).

So a patch of several characters fits only a few that need tuning: two with 10-letter internal names, five with 2-letter ones. The check on the **Multi-Character Patch** page adds the lines up before building. Characters with the base's or a swapped aura, the base's gameplay and cutscenes, no long baton throw, no stretched super attack far or pickup and no recolored stretched lines need no line, so nine of those fit.

## Baton throw

A Daredevil-based character's `throw_reach` (`base_moves`, [`FORMAT.md`](FORMAT.md)):

- **What it hits.** The target must be in front, more than 4 m away and no more than 10 m above or below.
- **Memory and space.** The character has its own copy of Daredevil's animations (about 2.7 MB on the disc), so a match against Daredevil loads both. It needs its own tuning file, so it takes a line in the tuning list (above).
- **`main.dol` changes.** `fn_8019DB24` (animation time setter) is rewritten in place so that a club that hits comes back from where it hit.

## Holster

A Daredevil-based character's `holster` (`base_moves`, [`FORMAT.md`](FORMAT.md)):

- **Only power-on and power-off reach for it.** Any other move that has the prop somewhere else than the move before it (the ranged attack outside power mode, or a move set in hand outside it) slides it between the back and the hand while the game fades into the animation.
- **The arm reach is approximate.** Power-on and power-off keep their length (Wolverine's power-on is 10 frames), so the reach is quick and the arm can pass through the head or shoulder. The prop jumps from the back to the hand.
- **Animations that aren't the character's own** show the prop where the club would be: cutscenes, and the victim's side of an opponent's throw.
- **Intros keep the prop on the back**, unless the intro has a new animation, which carries it on the club bone (`R Forearm prop`).
- **Daredevil's own power-on** has flagged torso tracks (bone words `0x10000` and up) that the holster ignores, so the prop may sit a little off the back early in it.
- **The cable must be off**, since it is drawn from the forearm to the club.
- **The fingers keep their grip** from the `IKClaws` clip, which the game plays over every animation, even with the prop on the back.
- **Memory and space** are as for swapped moves: the character has its own copy of the base's animations, and the club's keys on the back add about 115 KB to it.

## Gun

A gun (`z_button.gun`, [`FORMAT.md`](FORMAT.md)).

- **Drawing takes 0.3 seconds** due to the reach animation.
- **The reach for a back holster is approximate.** It bends the upper arm and forearm toward the grip, so the arm can pass through the shoulder or head on the way.
- **A swapped part rides fixed on the hand** while the gun is holstered, so no animation moves it within the hand.
- **The air shot is Elektra's super jump attack** with the gun arm aimed, so its arc and timing are hers, and approximate on another skeleton. A burst fits the jump, so its bullets can come closer than in a ground shot.
- **The arm points straight ahead,** and the game aims each bullet itself, so a bullet at a target above or below leaves at an angle to the barrel.
- **Firing on the move.** From Stand, Walk and Run the shot plays on the arm alone over the game's own stand, walk or run (the motion set's `mix`), so the character moves and steers as usual. The game aims each bullet at the opponent and then turns the character back the way it was running, so a bullet fired while running away leaves at an angle to the barrel, behind the character.
- **The arm is aimed from the chest.** A shot keeps the arm's angles to the chest. Movement can affect the visual "steadiness" of the shot.
- **While a ground shot plays** the game's turn-around, start-to-run and idle animations are skipped (the legs go straight into the run), and the run's footstep sounds go quiet: the game mutes the base animation's sounds while another plays over it.
- **Shots from other states still stand.** An attack the game starts from somewhere other than Stand, Walk or Run (a dodge's exit attack, a combo already under way when Z is pressed, an attack while carrying something) fires the shot in place, as before.
- **The muzzle and barrel are guessed from the model** (the long side of the gun's outline, out of the end farther from the hand), so a gun of an unusual shape can come out aimed off.
- **Only the base's own sounds.** Each shot plays one of the sound events the base's animations play (`sound`), or none. A match loads only each fighter's own sound bank, so other characters' sounds aren't available, and an uploaded sound can't be added: how an event picks its samples from the bank is compiled code that hasn't been decoded. A sample replaced on the **Sounds** page changes every move that plays it, the gun's shot included.
- **Outside a match** the character's own animations carry the gun in its holster, which adds about 85 KB of keys on Wolverine.
- **No rage while the gun is out.** From the draw until it is back in the holster, the character gains no rage, from its own hits or from hits it takes; rage still drains as usual. A bullet that lands after the gun is fully holstered still counts.
- **Storage.** Up to 4 characters can have a gun in one patch. `gun.s` and its table move the start of the arena 0x17e0 bytes later (0x120 more per extra character). The bullet's tuning field needs the character's own tuning file, so it takes a line in the tuning list (above), and the gun 253 bytes of the effect cache.

## Swapped moves

Moves taken from other bases (`moves`, [`FORMAT.md`](FORMAT.md)):

- **Only the animation changes.** Reach and sounds stay the base's, and the energy cost is the move's (below), not the animation's. Damage is one of the character's five values (below), though an animation that picks one brings its pick along. Effects stay the base's too unless taken (`move_effects`), and a cue the base has no effect for does nothing (the Thing's super throw on Daredevil has no hit flash).
- **Other body classes are approximate.** Their animations are mapped bone by bone, but limbs differ: a brute's grab on a male character holds the opponent at arm's length.
- **Memory and space.** The character has its own copy of the base's animations (about 1 to 3 MB on the disc), so a match against the base loads both.
- **Finishing moves are not moves.** They are cutscenes (below), not motion-set animations.
- **Taken effects (`theirs`) share the base's free effect slots with cutscene effects** (below). Moves get them first. A move with no free slot plays the base's effect of that number instead. The page and the patch notes say how many fit.
- **Taken lines are plain colored strands that start at the hand, not at a prop.** The textured strand (`primitive 5`) stretches its texture once along the line rather than repeating it, so only colors are offered.
- **A recolored line is a copy** of about 190 bytes per costume, out of the effect cache (above).
- **The super throw range** (`super_throw_range`) needs the character's own tuning file, so a line in the tuning list (above). A long range with a close grab slides the character over to the opponent.

## Imported move animations

Moves that play a clip from a glTF file (`move_anims`, [`FORMAT.md`](FORMAT.md)):

- **The clip has to be on the model's rig,** or on the game's own skeleton (a base's exported animations, edited). A clip from another rig (a Mixamo clip on a Biped model) is refused.
- **On the game's skeleton, only the body bones are the clip's.** Root's turn, and the markers and props (hand markers, palms, the Root marker the camera follows), stay the base's. Clips from another base of the same body class play bone for bone; another body class is approximate.
- **A base's exported animations are large:** about 6 MB (2.5 MB compressed) in the `.imperfect` file once imported.
- **Assign changed clips** finds a clip only if a body bone is more than 1 cm or 2° off, or a frame count differs; a smaller edit has to be picked on its move by hand.
- **Facing is guessed.** A file whose clips face another way than its rest pose needs a turn (`move_anim_files`); the import guesses it in steps of 90° and can guess wrong.
- **Hit timing is the base's, stretched,** unless timed from the clip: a hit lands where the base's does in the move, not where the clip's swing does.
- **Timed hits are found by a heuristic,** right about 84% of the time against about 32% stretched. A step forward can pass for a kick; a body blow or shoulder charge has no strike to find; a move with more hits than the clip has strikes keeps the stretched timing for the rest.
- **Travel is the base's or the clip's, not both.** A clip that steps on its own steps on top of the base's travel, and one that stands still slides; a short clip on a long lunge travels less (at most 1.5 times the base's pace). With the clip's own, chained attacks fall short of an opponent they knock back.
- **Projectile launches, wires and lines aren't found in the clip;** they keep the stretched timing.
- **The fit is approximate.** Limb lengths stay the base's, so hands may sit a little off the body and feet may slide.
- **Fingers move only where the mapping maps them.**
- **No throws.**
- **Space:** each clip adds about as much as the base's version of the move, and the `.imperfect` file keeps the whole animation file.

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
- **The baton throw's own value** (`attack_damage_throw`) is a sixth value for one animation. The throw's event `0x1B` gets param 5, which `fn_800E1788` (rewritten in place) reads as tuning field 217, a field the game doesn't use. The value goes with the animation, so it covers every move that plays the throw: super attack far, ranged attack and dodge exit super attack.

## Energy costs

The character's energy costs (`energy_*`, [`FORMAT.md`](FORMAT.md)):

- **Costs, not moves.** `fn_800DA884` gives a super move its cost from a tuning field, so moves that share one can't be set apart.
- **0 is the super attack cost.** A super move that caches its cost (all but the super attack, super throw and super ranged attack) takes the super attack cost when its own is 0, so those go down to 0.1.
- **The wall-climb ranged attack is a super attack.** Spider-Man's and Venom's shot from a wall (Super + attack, `WallClimb`, `fn_800D05BC`) has no case in `fn_800DA884`, so it costs the super attack cost, not the ranged one. Flyers' shots while hovering (`fn_800D875C`) set no cost of their own.
- **The super attack cost has another reader.** `fn_8009D818` regenerates health (field 43, Wolverine's healing) only while energy is at least the super attack cost.
- **Memory and space.** Changed costs need the character's own tuning file, so they take a line in the tuning list (above).

## Energy recharge

The character's energy recharge rates (`energy_regen`, `energy_charge`, [`FORMAT.md`](FORMAT.md)):

- **main.dol changes.** The game sets the held rate to 4 times the passive one (GLOBALS field 57) in `fn_8009D71C`. That function is rewritten to also add tuning field 245, which the game never reads otherwise. Characters that don't set it, the game's own included, are unchanged.
- **Memory and space.** Changed rates need the character's own tuning file, so they take a line in the tuning list (above).

## Wall climbing and running

A base that can't climb walls or run on them given wall climbing (`wall_climb`) or wall running (`wall_run`, [`FORMAT.md`](FORMAT.md)):

- **The CPU climbs and runs too**, since every AI profile reads the same bits.
- **The animations are added like swapped moves:** the same memory cost, and other body classes are approximate.
- **No ranged attack on the wall** (`WallClimbRangedAttack`). Only Spider-Man and Venom have one, and it fires the base's own projectile.

## Range grab

A Daredevil-based character's `range_grab` (`base_moves`, [`FORMAT.md`](FORMAT.md)):

- **Light props only** unless `stats.gameplay.lift` is raised: Daredevil has no medium or heavy lift.
- **The animation is added like a swapped move:** the same memory cost, and a Venom `WirePull` is approximate on Daredevil's skeleton. `WirePullFly` only plays in flight, so it isn't offered.

Turning a base's ranged pickup off (`stats.gameplay.range_grab: false`, Spider-Man, Venom, Magneto and Bio-Hazard) clears ability bit 0x2000.

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
- **A new animation keeps the cutscene's length**, audio, effects and fields of view. Animation past the end is cut and a shorter one holds its last pose.
- **Extra tracks stay as they are.** Most cutscenes carry a second set of tracks on some bones (flagged in the bone word; purpose unknown). They are left out of the download and kept unchanged, though edits to those bones still show in the game.
- **Blender bakes on whole frames**, so a jump in pose between two chunks is smoothed over one frame. Camera cuts stay sharp only with **Sampling Animations** off when exporting.

## Sounds

Sounds replaced on the **Sounds** page (`sounds`, [`FORMAT.md`](FORMAT.md)):

- **Only the base's sound effects.** Each character's sound effects are one AEMS bank, `Sounds/SFX_<base>.abk`. Voices and taunts are streamed from files every character shares (`SFX_common.ast`, `Sounds/ASF/`), and the select-screen voice is in the shared `SFX_FE.abk`, so they can't be changed for one character. A sound can only replace one the base already plays: the game's events pick a bank's sounds by their place in it.
- **The character's own bank.** The patch copies the base's bank with the new sounds as `Sounds/SFX_<internal name>.abk` and rewrites `fn_80114420`, which loads each player's bank, in place: it picks a new character's bank by the player's template name (`plr_<name>`), since a new character shares its base's type ID. A sound used for several slots is stored once, and one that replaces a looping sound loops in full.
- **A match against the base shares one set of sounds.** A bank's modules carry global AEMS IDs, and a copy keeps its base's, so the base's bank and the copy can't both be loaded. `fn_80114420` loads one bank per type ID, the first player's: in a match against the base, or against another character built on it, both fighters use the first player's sounds.
- **Memory.** A match loads both players' banks. A bank may be no larger than `SFX_Roekel.abk` (969,672 bytes), the largest character bank, since a Roekel mirror match loads two of those. Uploads are mono DSP ADPCM, about 12 KB a second at 22 kHz, so the room for new sound, beyond what the replaced sounds took, runs from none on Roekel to about 40 seconds on Daredevil.
- **Rates.** A sound with no rate in its bank header plays at 24,000 Hz (`fn_80258188`, the bank parser, sets it before reading the header).
- **Names.** The game has none, only each sound's place in its bank. The names on the **Sounds** page are our own, from `src/core/game/sounds.json` (base -> sound number -> name); an empty name shows only the number. They come from each bank's AEMS modules, whose roles (`CHAFX_step`, `CHAFX_Grunts`, ...) and mixer buses point at pools of the bank's sounds. A sound is named for the modules that can play it. Which game event plays which module is undecoded, so a name says what kind of sound it is, not which move plays it.
- **Used for.** `src/core/game/sound-uses.json` (same shape, only the sounds listed) holds what a sound has been identified as by listening; the page shows it in its own column.

## Z button

The action picked on the **Z-Button Actions** page (`z_button`, [`FORMAT.md`](FORMAT.md)):

- **CPU players never press it.** Their input class doesn't read the table.
- **Two players at once.** The rewrite has room for two active players, which a versus match never exceeds.
- **Stat Change.** Attack damage is set when a move starts (`fn_800DA884`), so a change applies from the next move, not partway through one. Run and sprint speed are read through the same tuning getter and change at once.
- **Change Size scales the skeleton, not the physics body.** The world matrix the bones are posed from (`fn_801A479C`) is scaled, so the model, its shadow, hit regions, attack volumes and where effects attach grow or shrink with it, on top of `model.size`. The collision radius and height that the camera, lock-on and CPU read are scaled too. The Havok body that pushes against walls and the opponent keeps its size.
- **What else stays the same while sized**: run and sprint speed, how high the character jumps, grab, aim and pickup ranges, effect sizes, and the throw positions.
- **Bullet Time slows the game's clock, not each thing in it.** `fn_801AF790` scales every frame's time by the world speed (on top of the game's own slow motion), and the character's own update (`fn_80094E04`, `fn_80074814`, `fn_800748A4`) is given the unslowed time. Its Havok body moves at 1 / the world speed during each physics step (`fn_80061A10`), so it covers full-speed ground and still collides, and its state timers (`fn_800BD2D0`, `fn_800BD3A8`) run at full speed.
- **What Bullet Time slows that belongs to the character**: its own projectiles, thrown objects and effects, which are separate objects. The match clock slows too. Sounds keep their speed and pitch.
- **Pushing while in Bullet Time is stronger.** The character's body moves faster within each physics step, so it shoves the opponent and props harder than usual.
- **A few of the character's own timeouts may run long**: those measured on the game clock outside the state timers.
- **The world speed has a floor of 25%.** Below it, the game takes physics steps only every few frames and movement stutters.
- **The Laser Beam is level.** `z_button.laser` fires along the character's facing and can't aim up or down. It never locks on to the opponent.
- **The character is rooted while firing.** It stands and turns with the stick but can't walk, run, jump or attack. Jumping, being hit or knocked down, or running out of energy ends the beam.
- **Damage comes in ticks**, five a second, as a plain punch's: a block stops a tick as it stops a punch, objects take the damage and can break. The beam stops at the first wall, fighter or object it hits.
- **The CPU reacts only after the first tick.** Before it, a CPU doesn't see the beam coming.
- **Width.** The beam hits a fighter its middle misses if the fighter's body touches the beam's width (0.25 m, times the character's size).
- **One tint for the whole beam.** Every piece is painted the chosen color and keeps only its own transparency, so the beam can't be two-toned. Iron Man's own costume 2 beam is dim, so a very dark color shows little.
- **Memory.** Each beam color takes about 2.4 KB of the effect cache (two colors when the costumes differ), counted with the aura tint's, and each costume's bundle gets about 10 KB of textures.
- **Impersonation copies the other player:** the first other one in a match of more, nobody in a match of one. In a mirror match the moves and model are the character's own.
- **Impersonated moves across body classes are approximate.**
- **Throws stay the character's own across body classes.**
- **Impersonated moves switch only between moves,** while the character stands, walks or runs. Releasing Z mid-air keeps the opponent's moves until landing.
- **The character's own taken moves, imported clips and gun shots** don't play while the opponent's moves are on.
- **The impersonated model is drawn, not swapped.** The character's skeleton, hit regions, attack volumes and camera stay. Across body classes the joints are approximate.
- **The character's own auras, flames and attached effects still show** on the impersonated model, and so does the opponent's damage-stage or Z costume.
- **The skin budget.** Drawing the opponent costs about 100-300 KB of the 512 KB a frame skins into; against a very large model the frame can run out and parts of a fighter draw wrong.
- **Impersonated attack damage and super move costs apply from the next move.** Health becomes theirs at the same fraction, and back on release.

## Damage stages

The textures each costume changes to as health runs down (`model.damage_stages`, [`FORMAT.md`](FORMAT.md)):

- **Every texture is loaded with the match.** Each picture a stage adds is a CMPR texture in that costume's bundle: 32 KB at 256x256, 128 KB at 512x512, on top of the memory above.
- **Each stage adds parts.** Each stage that changes something adds one more part to the costume, and each part is a block in `shaders.nsa`.
- **After Z's Costume Change is released, the costume returns to its damage stage a frame later.**

## More characters

The roster tables in `main.dol` hold 20 records, and the 19th character takes the last one (a filler copy of the Thing). For a 20th and more, up to a 27th, the patch copies the three tables, grown to one record per character, into a new data section, and points their only four readers (`fn_80431CCC` and `fn_8044F070`) at the copies. `fn_8044F070` searches the order table up to a fixed index, which is raised with the count.

- **27 is the most the select screen shows.** Its grid is 9 tiles wide and 3 rows deep; the new characters fill the third row, and a 4th row would be off the screen.
- **The section takes 3,296 bytes (two characters) to 4,384 bytes (nine) from the memory a match loads into.** It sits where the arena used to start, `0x806809C0`, and the arena now starts after it. `OSInit` picks the arena start from `__ArenaLo`, or from `_stack_addr` when the disc's BI2 debug flag is below 2; Dolphin boots GVLE69 through the second, so both are moved.
- **`main.dol` no longer fits before the FST** (the disc leaves 64 bytes), so the FST moves after it and `boot.bin` points to it.
- **Each character adds its four HUD portraits to every `HUD/hud<LANG>.1.gsh`** (and its name banner to `hud<LANG>.2.gsh`), which the game loads for a match.