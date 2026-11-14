# The `.imperfect` format, version 1

A `.imperfect` file is one custom character for *Marvel Nemesis: Rise of the Imperfects* (GameCube, USA, `GVLE69` revision 0).<br />
It holds the author's own model, pictures and settings, plus a recipe that ImperfectLab applies to the player's own copy of the game.

**It never holds game data**. The base character it builds on is named, and its skeleton, moves, sounds, tuning and portrait layouts are read from the player's disc at patch time.

## Container

A ZIP archive (deflate). Only these members may appear, and nothing else is read:

| Member | Contents |
|---|---|
| `manifest.json` | the recipe (below), UTF-8 JSON |
| `model/model.glb` | the character's model, binary glTF 2.0 |
| `textures/<name>.png` | textures that replace or complement the model's own (`<name>`: 1-48 of `A-Z a-z 0-9 _ -`) |
| `ui/<slot>.png` | select-screen, loading-screen, tile and HUD pictures (slots below) |
| `cutscenes/<name>.asf` | new cutscene audio ([`cutscenes`](#cutscenes); `<name>`: 1-48 of `A-Z a-z 0-9 _ -`) |
| `cutscenes/<name>.glb` | new cutscene animation, binary glTF 2.0 ([`cutscenes`](#cutscenes)) |
| `sounds/<name>.dsp` | sounds that replace the base's (`<name>`: 1-48 of `A-Z a-z 0-9 _ -`; [`sounds`](#sounds)) |
| `animations/<name>.glb` | clips that moves play, binary glTF 2.0 (`<name>`: 1-48 of `A-Z a-z 0-9 _ -`; [`move_anims`](#move_anims)) |

Readers must reject:
- any other member name, an absolute path, `..`, a backslash, a directory entry, or a duplicate member;
- more than 256 members, or more than 64 MB unpacked;
- a member over 1 MB that compresses more than 200:1;
- a member whose SHA-256 differs from the manifest's `files` list, or a list that names a member the archive
  lacks or misses one it has;
- a PNG without the PNG signature or larger than 4096 pixels a side, and a GLB without the `glTF` magic;
- an `.asf` that is not EA-XA at 32000 Hz, mono or stereo, whose header disagrees with its data, or that is over 60 seconds;
- a `.dsp` whose header disagrees with its data, or that is not mono DSP ADPCM at 8000-32000 Hz and at most 30 seconds long.

ImperfectLab writes the members with fixed timestamps, so the same character always gives the same bytes.

## `manifest.json`

Unknown keys are an error. A reader refuses a `version` newer than it knows and upgrades older ones.

```json
{
  "format": "imperfect",
  "version": 1,
  "game": "GVLE69-0",
  "generator": "ImperfectLab 0.1.0",
  "character": {"internal_name": "DoctorDoom", "display_name": "DOCTOR DOOM", "name_color": "#FFFFFF"},
  "base": "johnnyohm",
  "credits": {"author": "...", "description": "...", "assets": [{ 
    "what": "model",
    "by": "...",
    "license": "CC BY 4.0",
    "url": "..."
  }]},
  "model": {
    "mapping": {"1": "Bip01 Pelvis_00", "5": "Bip01 Head_07"},
    "overrides": {"Bip01 L Finger2_016": 48},
    "fit": {"scale": null, "torso_squash": true, "flip": null},
    "materials": [{" 
      gltf_material": 0,
      "name": "17401",
      "include": true,
      "suffix": "",
      "size": [512, 512],
      "two_sided": false,
      "texture": "textures/body.png",
      "alt": "textures/body_alt.png",
      "bind": null,
      "damage": { "normal": ["textures/mat0_d1.png", "prev", "hue:-30"], "alt": ["textures/mat0_d1_alt.png", "prev", "prev"] }
    }],
    "damage_stages": [{ "enabled": true, "health": 75 }, { "enabled": false, "health": 50 }, { "enabled": true, "health": 25 }]
  },
  "aura": {"mode": "swap", "tint": "all", "color": "#40A0FF", "alt_color": "#50FF50"},
  "flames": {"parts": ["head"], "body": false, "color": null, "alt_color": "#40A0FF", "size": 1.2, "base_effect": true},
  "trails": {"parts": ["arms", "legs"], "color": "#FFFFFF60", "alt_color": "#40A0FF80", "length": 0.2},
  "eyes": {"color": "#FF2000", "alt_color": "#40A0FF", "size": 1.2, "position": [0.033, 0.129, 0.046]},
  "projectile": {"base": "ironman", "color": "#FF2000", "alt_color": "#FF2000", "from": "bone", "bone": "head", "position": [0, 0.629, 0.046]},
  "stats": {"display": {"normal": [7, 4, 3, 6, 5, 4], "alt": [7, 4, 3, 6, 5, 4]}, "gameplay": {"damage_taken": 0.7, "lift": "medium", "wire_swing": false}},
  "ui": {"select": {"ready": {"scale": 0.8, "anchor": [210, 75], "glow": "#3CFF5A6E"}}, "fade": 36, "strip_scale": null, "ready_voice": null, "banner": true},
  "base_moves": {},
  "moves": { "SuperThrow": "thing" },
  "move_effects": { "SuperThrow": "theirs" },
  "move_lines": { "color": "#C0C0C0", "alt_color": null },
  "move_reach": { "SuperAttackFar": { "distance": 15 }, "WireSwing": {} },
  "move_idle": ["Run"],
  "move_anims": { "PowerOn": { "file": "animations/cyclops.glb", "clip": "power_3" } },
  "move_anim_files": { "animations/cyclops.glb": { "turn": -90 } },
  "cutscenes": { "finisher": "wolverine", "audio": { "finisher_1": "cutscenes/finisher_1.asf" } },
  "sounds": { "3": {"file": "sounds/sound3.dsp"}, "10": {"game": "spiderman:4"} },
  "z_button": { "stealth": { "undetected": true, "untouchable": true, "visible": 0.2 }, "costume": { "normal": { "0": "alt" }, "alt": { "0": "textures/mat0_altz.png" } }, "stats": { "attack_damage_3": 40, "damage_taken": 0.5, "lift": "heavy" }, "size": 2, "bullet": 0.5, "gun": { "side": "right", "damage": 10, "energy": 5, "bullets": 3, "automatic": true, "holster": { "place": "back_right", "position": [0.05, -0.2, 0.05], "rotation": [-90, 45, 180] }, "swap": { "position": [0.05, -0.2, 0.05], "rotation": [-90, 45, 0] }, "sound": "116:3" }, "requires": { "energy": { "seconds": 8, "regen": false } } },
  "files": {"model/model.glb": "<sha256>", "ui/select_ready.png": "<sha256>"}
}
```

### `character`
- `internal_name`: 1-10 letters and digits, starting with a letter. The character's templates are `act_<name>`, `plr_<name>` and `plr_alt<name>`, its model bundles `Bundles/<name lowercased>[_alt]`, its HUD portraits `plr_<name lowercased>`. It must not be used by the game already (checked against the disc).
- `display_name`: 1-16 of `A-Z 0-9 space . ' & ! -`: the name on the select and loading screens.
- `name_color`: `#RRGGBB`, the select screen's name color.

### `base`
One of `thing wolverine paradox elektra johnnyohm spiderman daredevil storm aftershock venom heatwave humantorch ironman megalith magneto biohazard defcon roekel`.
The character uses the base's moves, animations, sounds, AI, effects and (unless `stats.gameplay` changes it) tuning, except where `moves` takes moves from other bases.
Game bone numbers in `model` belong to the base's body class (male, female or brute), which have different skeletons.

### `model`
- `mapping`: game bone number (a node of the base's skeleton, as ImperfectLab lists them) to the name of a joint of the GLB's skin. A GLB mesh with no skin is bound to its node, named `mesh:<node name>`.
- `overrides`: joint name to game bone number, for joints that are not the primary choice of any game bone (for example a middle finger following the index finger's game bone). Every other joint follows its nearest mapped ancestor.
- `fit.scale`: `null` (the legs are made the base's length) or a number. `fit.torso_squash`: fit the torso to the base's shoulder height. `fit.flip`: `null` (detected from the arms), or whether the model faces backwards. `fit.floor_from_mesh`: measure the ankles' height from the model's lowest point instead of its origin, for a model whose origin isn't at its feet. Absent means off, and a file only carries it when on.
- `size`: 0.1-3.0, the character's size in the game as a multiple of the base's. The fitted model, the base's skeleton, its own animations (except how far the character travels off the ground), hit regions, attack volumes and collision body grow or shrink with it ([`LIMITATIONS.md`](LIMITATIONS.md)). Absent means 1, and a file only carries it when it isn't.
- `materials`: one entry per GLB material used.
  - `include`: draw it or not.
  - `suffix`: its game material is `<internal_name>[_alt]<suffix>`; empty or `_` plus 1-7 letters and digits,
    unique.
  - `size`: the texture size, powers of two from 8 to 1024.
  - `two_sided`: draw it from both sides (capes).
  - `texture`: a `textures/` member, or `null` for the GLB's own base color image.
  - `alt`: the alternate costume's texture: `"same"`, a `textures/` member, or `"hue:<degrees>"`.
  - `bind`: `null`, or a game bone number every vertex of the material is fixed to (a prop).
  - `damage`: optional, `normal` and `alt`, each three entries (one per damage stage): `"prev"` (the previous enabled
    stage's texture, or the costume's own before the first), `"hue:<degrees>"` (the costume's own texture, hue-shifted) or a
    `textures/` member. A costume left out is all `"prev"`.
  - `finish`: optional, `{envmap, intensity}`: a metallic finish. The material uses the game's `glossenvcharlight` shader with one of the game's sphere maps,
    `envmap` (`GE_env_WinkOnyx`, `GE_env_polishedMetal`, `GE_env_Iron`, `GE_env_Ironman_look`, `GE_env_polishedMetalSpidey`, `GE_env_WinkOnyxGold`, `GE_env_WinkOnyxBlue` or `GE_env_WinkOnyx_green`), added at `intensity` (0-1).
    Also covers the material's Z costume and damage stages. Absent means plain `charlight`.
- `damage_stages`: optional, three `{enabled, health}`. An enabled stage shows from `health` (an integer 1-99, % of max
  health) down; the enabled stages' `health` must fall. Absent means all off at 75, 50 and 25.

### `aura`
`mode`:
- `base`: the base's aura and effects.
- `swap`: the two costumes exchange the base's normal and alternate auras, effects and intro cutscenes.
- `tint`: copies of the base's effects recolored to `color` (costume 1) and `alt_color` (costume 2), each `#RRGGBB` or `#RRGGBBAA`. The opacity (`AA`, default `FF`) scales the alpha of every recolored effect color. `00` hides the costume's effects: they are replaced with an empty effect rather than copied, which takes far less memory.
  The power-mode glow keeps the base's color.

`tint` (optional, default `all`), what a `tint` copies:
- `all`: the idle and power-up effects, and every effect and projectile the alternate costume has its own of.
- `power`: the idle and power-up effects only.

A base whose full tint needs more memory than a match can spare is built as `power` ([`LIMITATIONS.md`](LIMITATIONS.md)).

### `flames`
Optional; left out when every key has its default. Fire that burns on the character all match, on top of the `aura`:
- `parts` (default `[]`): any of `head chest r_hand l_hand r_foot l_foot`.
- `body` (default `false`): Human Torch's body fire over the whole model instead.
- `color`, `alt_color` (default `null`): the costume's flame color, `#RRGGBB` or `#RRGGBBAA`. The flames are drawn additively, so the opacity (`AA`) darkens the color, and `00` hides them.
- `size` (default `1`): 0.5-2.0, scales the flames.
- `base_effect` (default `true`): `false` removes the base's own always-on effect, such as Human Torch's body fire.

### `trails`
Optional; left out when `parts` is empty. See-through ribbons that trail behind body parts as they move, the game's blade trails (`trail` blocks) swept between joints:
- `parts`: any of `arms legs body head`.
- `color`, `alt_color` (default `#FFFFFF60`): the costume's trail color, `#RRGGBB` or `#RRGGBBAA`.
- `length` (default `0.2`): 0.05-0.5, how long in seconds a ribbon lingers.

### `eyes`
Optional; left out when off. Iron Man's eye glow on two eye markers on the head bone:
- `color`, `alt_color` (defaults `#FFFFFF`, `#00FF00`): `#RRGGBB` or `#RRGGBBAA`; fully transparent means no glow.
- `size` (default `1`): 0.25-3, times Iron Man's.
- `position` (default `[0.033, 0.129, 0.046]`): meters from the head bone. X (0-0.3) is each eye's distance from the middle; Y (forward) and Z (up) are -0.3-0.3.

### `projectile`
Optional; left out when off. Another base's shot, recolored, in place of the shots the character's moves launch ([`LIMITATIONS.md`](LIMITATIONS.md#projectile-swap)). Refused on a base none of whose moves shoot (`wolverine paradox daredevil aftershock`).
- `base` (default `ironman`): whose shot. Only `ironman` so far.
- `color`, `alt_color` (default `#FF2000`): `#RRGGBB` or `#RRGGBBAA`; fully transparent hides the shot, which still hits.
- `from` (default `bone`): `own` (the base's own launch point) or `bone`.
- `bone` (default `head`; left out when `from` is `own`): `pelvis spine chest neck head`, or `R.` or `L.` followed by `clavicle upper_arm upper_twist forearm forearm_twist hand thigh calf foot toe`.
- `position` (left out when `from` is `own`): meters from the bone, X, Y (forward) and Z (up), each -1 to 1. Defaults to `[0, 0.629, 0.046]` on `head`, `[0, 0, 0]` on any other bone.

Or, to take the shots out instead ([`LIMITATIONS.md`](LIMITATIONS.md#removed-projectiles)), `{ "remove": true }` with no other key but:
- `melee` (default `false`): `true` plays the base's attack far in place of the ground moves that shot.

### `stats`
- `display`: six integers 1-7 per costume: intel, strength, speed, durability, energy, skill. Shown on the
  select screen only.
- `gameplay`, every key optional:
  - `damage_taken`: 0.1-3.0, the share of a hit's damage taken.
  - `lift`: `light`, `medium` or `heavy`.
  - `wire_swing`: a boolean.
  - `flight`: `false` disallows flight on a base that flies. `true` is refused.
  - `range_grab`: `false` turns off the ranged pickup (pulling props in from a distance) on a base that has it: Spider-Man, Venom, Magneto and Bio-Hazard. `true` is refused: a Daredevil base gets one with `base_moves.range_grab`.
  - `low_energy_stun`: `false` stops Megalith being stunned when his energy runs low. `true` gives the stun to another base (`moves` then names `LowEnergyStun`, taken from Megalith).
  - `wall_climb`: `true` lets a base that can't climb walls climb them (`moves` then names their animations). Not allowed on a base that already climbs.
  - `wall_run`: `true` lets a base that can't run on walls run on them, the same way. Not allowed on a base that already runs on walls.
  - `super_throw_range`: 1-20, how far away, in meters, the opponent can be for the super throw (R + X grab) to start.
  - `attack_damage_1` to `attack_damage_5`: 1-1000, the character's five damage values. Every attack hits with one of them.
  - `attack_damage_throw`: 1-1000, a Daredevil base's baton throw (`Daredevil_RangedAttack.nad`: super attack far, ranged attack and dodge exit super attack) hits with this instead of `attack_damage_3`.
  - Energy costs, 0-100 out of a full bar of 100. Super moves: `energy_super_attack` (super attacks 1-4, far and air), `energy_super_low`,
    `energy_super_stomp`, `energy_super_rise`, `energy_super_jump_attack`, `energy_super_jump_desc`, `energy_super_wall`,
    `energy_super_swing` (super swing and wire attacks), `energy_dodge_super`, `energy_super_throw`, `energy_super_air_throw` and
    `energy_super_ranged`; all but `energy_super_attack`, `energy_super_throw` and `energy_super_ranged` start at 0.1. Other use: `energy_super_run` (per second, and the wire swing),
    `energy_super_jump`, `energy_flight` (per second flying up), `energy_flight_min` (needed to take off) and `energy_wire_extend`.
  - Energy recharge, 0-100 per second out of a full bar of 100. 0 turns either off. `energy_regen` (on its own) or `energy_charge` (while holding R).
  - `health`: integer 10-1000.
  - `run_speed`: 1-30. `sprint_speed`: 1-40.
  - `rage_duration`: integer 1000-120000, in milliseconds.
  - Experimental: `rage_per_super` (0-100).

  The base's spread between the human player and the CPU difficulty levels is kept.

### `ui`
- `select`: per pose (`rest`, `ready`, `readyalt`): `scale` (picture pixels to select-screen canvas pixels),
  `anchor` (the picture pixel, usually the face, placed at the portrait's face point) and `glow` (`#RRGGBBAA`
  or `null`).
- `fade`: rows faded in at the top of the select-screen portrait.
- `strip_scale`: the loading-screen strips' crop scale when no strip pictures are given (`null`: three times
  the READY scale).
- `ready_voice`: `null` (no sound effect when selected) or one of the game's select-screen sounds, `FE_SFX_<NAME>` (`FE_SFX_OHM`, `FE_SFX_DAREDEVIL`, ...).
- `banner`: use `ui/banner.png` as the in-match name banner.

Picture slots, all optional:

| Slot | Size | When missing |
|---|---|---|
| `select_ready` | any | the base's select-screen and loading-screen portraits are used |
| `select_rest`, `select_readyalt` | any | `select_ready` |
| `load_wide`, `load_narrow` (+ `_alt`) | the game's strips (128x256, 32x256) | cut from the READY picture |
| `tile`, `tile_selected` | 64x32 | the base's tile |
| `hud`, `hud_rage`, `hud_alt`, `hud_alt_rage` | 64x64 | `hud` (or the base's portraits when `hud` is missing too) |
| `banner` | the base's banner size | no banner |

### `base_moves`
Options for moves only one base has. Each key belongs to particular bases, and a reader refuses a key the base does not have.

Daredevil (`daredevil`):
- `throw_reach`: 8-35, how far the baton throw reaches, in meters.
- `throw_cable`: a boolean, default `true`. `false` removes the cable drawn from the forearm to the club.
- `range_grab`: `true` lets him grab props from a distance as Spider-Man does.
- `no_throw`: turns the baton throw off. `in_hand` keeps move animations with the club in the hand, hitting up close. `attack_far` plays the Attack far animation instead, with its damage, except in moves changed on the Moves page (`moves`, `move_anims`, `move_idle`, `move_reach`). Can't be combined with `throw_reach`.
- `air_throw`: `true` makes the `SuperJumpAttack` throw the club from the air at the nearest opponent. Can't be combined with `no_throw`, nor with `SuperJumpAttack` in `moves`, `move_anims`, `move_idle` or `move_reach`, nor with `holster.drawn.SuperJumpAttack: false`.
- `air_throw_reach`: 8-35, how far the air throw reaches, in meters. Requires `air_throw`. Defaults to the baton throw's reach (`throw_reach`, or Daredevil's).
- `holster`: optional, carries what is fixed to game bone 39 (the club) on the back outside power mode and in the versus intros, and ends the baton throw's catch in the power-stand grip. Requires `throw_cable: false` and a prop on bone 39.
  - `position`: three numbers from -0.6 to 0.6, the prop's middle from the chest bone in meters.
  - `rotation`: three numbers from -180 to 180, degrees about X, Y and Z, rotating the prop from the middle.
  - `drawn` (optional): move id -> `true` (in hand) or `false` (on the back), overriding the default of in hand for power-stand, `Super*` states, `RangedAttack` and `DodgeExitSuperAttack` and on the back otherwise. `PowerOn`, `PowerOff` and `IKClaws` can't be listed, and `SuperAttackFar`, `RangedAttack`, `DodgeExitSuperAttack`, `SuperRiseAttack` and, with `air_throw`, `SuperJumpAttack` can't be `false`.
- `grip`: optional, holds what is fixed to game bone 39 (the club) in one hand, where the model has it. Requires a prop on bone 39.
  - `hand`: `right` or `left`, default `right`. `left` requires `throw_cable: false`, nothing else fixed to game bone 59, and no left-hand `z_button.gun`.
  - `position`: three numbers from -0.6 to 0.6, default `[0, 0, 0]`, meters moved from where the prop is modeled, in the hand's frame at bind (X the character's right, Y forward, Z up).
  - `rotation`: three numbers from -180 to 180, default `[0, 0, 0]`, degrees about X, Y and Z, turning the prop about its middle.
- `shield_throw`: optional, PSP Captain America's shield throw in place of the baton throw: `SuperAttackFar` and `SuperRangedAttack` launch what is fixed to game bone 39 as a projectile. Requires a prop on bone 39, `grip`, `throw_cable: false`, no `no_throw`, `throw_reach` or `air_throw`, and no `projectile` swap or removal.
  - `return`: `physics` (default, as on the PSP) or `fly_back` (turns back to the hand).

### `moves`
Moves taken from other bases: move id -> the base (not the character's own) whose animations it gets. Ids are motion-set state names, listed in `MOVES` in `src/core/build/moves.ts`; a throw or a sequence is one id covering its parts (`SuperThrow` includes the female, brute and victim versions).
`SuperAttackFar` cannot be combined with `base_moves.throw_reach`. Older ImperfectLab builds refuse a non-empty `moves`.
With `stats.gameplay.wall_climb` or `wall_run`, `moves` also adds states the base has none of. `wall_climb` requires `WallClimbUp`, `WallClimbDown`, `WallClimbLeft`, `WallClimbRight` and `WallClimbStand`, `wall_run` requires `WallRunUp`, `WallRunLeft` and `WallRunRight`, and `WallJumpOff`, `WallJumpToWall` and `WallRunJumpOff` are optional for both.

### `move_effects`
Optional, and left out when every taken move plays the base's effects. Move id (one in `moves`) -> `theirs` (the effects that base's version of the move starts, such as Daredevil's cable on his super throw) or `none` (no effects). A move left out starts the base's effects in their place.
Whatever the choice, a taken move that shoots launches the base's projectile: the one the base's own version of the move launches, or else the base's first one.

### `move_lines`
Optional. `color` and `alt_color` (each `null` or `#RRGGBB`/`#RRGGBBAA`, AA scaling the opacity, so `00` hides the line): the color, per costume, of the lines (`constraint` effects such as Daredevil's cable or Spider-Man's web) that `theirs` and stretched (`move_reach`) moves draw. `null` keeps the line as it is.

### `move_reach`
Optional, left out when no move stretches. Move id (the base's own move or one in `moves`) -> a limb stretched out and back within the move's animation (an arm by its forearm, a leg by its foot). What the move does with the limb decides how:
- a **hit** (a fist's or a foot's hit volume): `distance` meters further than the move reaches, at most 1 m a frame, the move slowed to fit. On `SuperAttackFar` and `SuperRiseAttack` the arm also gets the long hit volume (attachments 43 and 44) and the baton throw's return, and `SuperAttackFar`'s `distance` is its target range too.
- the **wire** (`WireSwing`, `WireExtend`): out to the wire's end, held until the wire lets go. No `distance`.
- a **jump** (`Jump`, `RunJump`, `SuperJump`, `SuperRunJump`): the legs' feet `distance` meters further along the shin, growing from nothing at takeoff to full in the middle of the animation and back by its end, or with `hold` held at full for most of it. The jump itself is unchanged.
- a **line** from the forearm (a long grab, such as Spider-Man's web or Daredevil's cable): out to the opponent, who the grab puts `distance` meters away, and held on the line's end on them until it lets go. A ranged pickup (`WirePull`, `WirePullFly`) goes out to the object at `distance` and back with it, and `distance` is also how far away a prop can be (the tuning's pickup range, 10 m by default).

Keys: `distance` (1-35, needed for a hit or a line; 0.25-3 for a jump), `limbs` (optional): any of `right_arm left_arm right_leg left_leg`, by default every limb the move uses; one it doesn't use is refused, and `hold` (optional, jumps only): `true` to hold the stretch instead of easing it in and out.
Not allowed on `SuperAttackFar` with `base_moves.throw_reach`. See [`LIMITATIONS.md`](LIMITATIONS.md).

### `move_idle`
Optional, left out when empty. A list of move ids (not `Stand`, and none in `moves`) that play the character's idle (`Stand`) animation instead of their own. A move that plays once keeps its length, events and root (its travel and turning), with the idle's pose on every other bone. A looping move (`Run`, `Walk`) plays the idle itself, at the idle's own rate instead of the move's stride. The victim's side of a throw is unchanged.
Not allowed with `move_reach` on the same move, nor on `SuperAttackFar` with `base_moves.throw_reach`. See [`LIMITATIONS.md`](LIMITATIONS.md).

### `move_anims`
Optional, left out when empty. Move id -> a clip of an `animations/` member that the move plays instead of the base's animation:
- `file`: the `animations/` member.
- `clip`: the name of one of its glTF animations.
- `states` (optional): state -> clip, the clip each of the move's states plays instead of `clip` (`Block` has `BlockStart`, `Block`, `BlockEnd`). Each key is one of the move's states.
- `timing` (optional): `clip` to time the move's hit windows from the clip's strikes; left out, the base's timing is stretched to the clip's length.
- `travel` (optional): `base` to keep the base move's Root travel; left out, Root takes the clip's own ground travel.

The move can't be in `moves` or `move_idle`, and can't be one with a victim (a throw). It can be stretched (`move_reach`). The clip's joints are named as the model's (`model`); with no model, as the presets map them. A file whose joints are named as the game's bones drives the base's bones directly, with or without a model. An `animations/` member keeps the glTF's nodes, skin and animations; the meshes, materials and images are dropped. See [`LIMITATIONS.md`](LIMITATIONS.md).

### `move_anim_files`
Optional, left out when no file is turned. `animations/` member -> `turn`: degrees (-180 to 180) its clips are turned about the up axis, counter-clockwise seen from above, before they are fitted. A file left out takes 0.

### `cutscenes`
Optional, and left out when the character keeps its base's cutscenes and audio.
- `intro`, `victory`, `finisher`: the base (not the character's own) whose cutscenes of that kind the character uses. Each is optional.
- `effects`: kind -> `theirs` (that base's effects) or `none` (no effects), for kinds taken from another base. Optional; a kind left out plays the character's base's effects.
- `audio`: audio slot -> a `cutscenes/` member that replaces that audio. A slot is `<kind>_<n>`, numbered from 1 as the **Cutscenes** page lists them. A member is no longer than the stream it replaces and serves both costumes, and a shorter one is padded with silence when patching.
- `animation`: cutscene -> a `cutscenes/` `.glb` that re-animates it. A cutscene is `<kind>_<n>`, numbered from 1 as the **Cutscenes** page lists them under **Animation**.

A `cutscenes/` `.glb` is what the page's download gives, edited: binary glTF 2.0 at 30 frames a second (frame 0 at 0 seconds) with, by node name, each camera (`nis_camera`, `nis_camera2`) and each character as a skinned armature whose joints are named as the page names that body class's bones (a finisher's opponent is `victim`). Each joint's world pose is taken relative to its rest pose, so its rest orientation may differ from the download's.

A `cutscenes/` member is an EA `SCHl` audio stream like the game's own (`Sounds/ASF/english/*.asf`): a `PT` header, `SCCl`, `SCDl` blocks of EA-XA ADPCM and `SCEl`. ImperfectLab writes stereo at 32000 Hz, in blocks of 2,156 samples and then 2,128. See [`LIMITATIONS.md`](LIMITATIONS.md) for what the patch can and cannot do.

### `sounds`
Optional, and left out when no sound changes. The index of a sound in the base's SFX bank (`Sounds/SFX_<base>.abk`, from 0. Exactly one of:
- `game`: `<base>:<index>`, a sound from any base's bank, read from the player's disc at patch time.
- `file`: a `sounds/` member. Several sounds may name the same one.

A `sounds/` member is a standard Nintendo `.dsp` file. ImperfectLab writes mono, unlooped files at the replaced sound's rate or lower.

### `z_button`
Optional, left out when Z does nothing (default). Holding Z runs every action given, at least one of `stealth`, `costume`, `stats`, `size`, `bullet`, `gun`, `laser` and `impersonate`.
- `action`: only in older files, where `stealth` is Stealth Mode. A reader takes it as `stealth`; a writer leaves it out.
- `stealth`: optional, Stealth Mode's effects, at least one of them:
  - `undetected`: `true` when the CPU loses track of the character. Optional, `false` by default.
  - `untouchable`: `true` when enemies can't hit or grab the character. Optional, `false` by default.
  - `visible`: how visible the character is, from 0 (not drawn) to 0.95. Optional, left out when the character doesn't fade.
- `costume`: optional, Costume Change. `normal` (costume 1) and `alt` (costume 2) each map a material's `gltf_material` to the texture it draws while Z is held: `normal` or `alt` (that costume's texture), `hue:<degrees>` (costume 1's, hue-shifted, as a material's `alt`) or a `textures/` member. A material left out switches to the other costume's texture.
- `stats`: optional, Stat Change. The values that replace the character's own while Z is held, at least one of them: `attack_damage_1` to `_5`, `damage_taken`, `run_speed` and `sprint_speed`, with the ranges of `stats.gameplay`, and `lift`.
- `size`: optional, Change Size. 0.1-3.0, the character's size while Z is held as a multiple of its own (`model.size` included). It grows or shrinks over a quarter of a second, and back on release.
- `bullet`: optional, Bullet Time. 0.25-0.9, the speed everything but the character runs at while Z is held: opponents, CPU players, projectiles, thrown objects and effects. The world eases into it over at most a quarter of a second, and back on release.
- `gun`: optional, Gun. The gun rides in a holster at a hip or on the back; holding Z draws it, and once it's in hand any attack but a rise attack, on the ground or in the air, fires it instead. On the ground the character keeps standing, walking or running while it fires. Any base.
  - `side`: `right` or `left` (default `right`), the hand that holds and shoots it.
  - `damage`: integer 1-1000 (default 10), each bullet's damage.
  - `energy`: 0-100 (default 5) of a full bar of 100, what each shot takes. A shot needs that much to start.
  - `bullets`: integer 1-10 (default 2), the bullets in each shot's quick burst.
  - `automatic`: `true` keeps shooting while attack is held, each shot taking its energy (default `false`).
  - `holster`: where the gun is holstered.
    - `place`: `hip_right`, `hip_left`, `back_left` or `back_right` (default the hip on `side`).
    - `position`: the gun's middle from the place's bone at bind, in the character's axes (X right, Y forward, Z up): three numbers from -0.6 to 0.6, in meters. `rotation`: three numbers from -180 to 180, degrees about X, Y and Z, X first.
  - `swap`: optional, left out when nothing swaps. What the gun hand holds while the gun is holstered.
  - `sound`: optional, what each shot plays from the character's sound bank: a sound event and its variant as `"<event>:<variant>"` (event 0-65535, variant 0-4294967295), as an animation event 0x17 has them. Left out, the gun is silent.
- `laser`: optional, Laser Beam. Holding Z fires a tinted copy of Iron Man's finisher beam from a bone, level along the character's facing. Not with `gun`. Any base.
  - `color`, `alt_color`: `#RRGGBB` (default `#FF2010`), costume 1's and 2's beam.
  - `bone`: one of `projectile.bone`'s (default `chest`), the bone the beam leaves from.
  - `position`: three numbers from -1 to 1, the beam's origin in meters from the bone at bind, in the character's axes (X right, Y forward, Z up). Default (0, 0.123, 0.073) on the chest and (0, 0, 0) on any other bone.
  - `damage`: integer 1-200 (default 20), damage a second.
  - `range`: integer 5-60 (default 30), the beam's longest reach in meters.
- `impersonate`: optional, Impersonation. While Z is held the character takes on the other player's parts, each `true` or left out, at least one:
  - `moves`: their moves, the projectiles and effects those fire, their abilities and their sound bank. Not with `gun`.
  - `model`: their model and shadow, posed by the character's moves. Not with `gun` or `costume`.
  - `stats`: their damage, damage taken, speeds, energy costs and recharge, rage, max health and lifting strength. Not with `stats`.
- `requires`: optional, left out when empty. What the action needs.
  - `energy`: the action drains energy and can't start with none. `seconds` (1 to 60) is how long a full bar lasts. `regen` (optional, `false` by default) keeps the game's energy regeneration running while active, so the bar lasts longer.

### `gun`
Only in files from ImperfectLab builds before the gun became a Z action, where R drew it. A reader takes it as `z_button.gun` and ignores its `drawn`; a writer leaves it out.

## Licensing

The author is responsible for having the right to share every asset in the file.<br />
`credits.assets` is shown to whoever opens or patches the file, and ImperfectLab copies it into the patch report; a model under CC BY needs its credit there.