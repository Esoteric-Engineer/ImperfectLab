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

Readers must reject:
- any other member name, an absolute path, `..`, a backslash, a directory entry, or a duplicate member;
- more than 64 members, or more than 64 MB unpacked;
- a member over 1 MB that compresses more than 200:1;
- a member whose SHA-256 differs from the manifest's `files` list, or a list that names a member the archive
  lacks or misses one it has;
- a PNG without the PNG signature or larger than 4096 pixels a side, and a GLB without the `glTF` magic;
- an `.asf` that is not EA-XA at 32000 Hz, mono or stereo, whose header disagrees with its data, or that is over 60 seconds.

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
      "bind": null
    }]
  },
  "aura": {"mode": "swap", "tint": "all", "color": "#40A0FF", "alt_color": "#50FF50"},
  "flames": {"parts": ["head"], "body": false, "color": null, "alt_color": "#40A0FF", "size": 1.2, "base_effect": true},
  "stats": {"display": {"normal": [7, 4, 3, 6, 5, 4], "alt": [7, 4, 3, 6, 5, 4]}, "gameplay": {"damage_taken": 0.7, "lift": "medium", "wire_swing": false}},
  "ui": {"select": {"ready": {"scale": 0.8, "anchor": [210, 75], "glow": "#3CFF5A6E"}}, "fade": 36, "strip_scale": null, "ready_voice": null, "banner": true},
  "base_moves": {},
  "moves": { "SuperThrow": "thing" },
  "move_effects": { "SuperThrow": "theirs" },
  "move_lines": { "color": "#C0C0C0", "alt_color": null },
  "move_reach": { "SuperAttackFar": { "distance": 15 }, "WireSwing": {} },
  "cutscenes": { "finisher": "wolverine", "audio": { "finisher_1": "cutscenes/finisher_1.asf" } },
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
- `materials`: one entry per GLB material used.
  - `include`: draw it or not.
  - `suffix`: its game material is `<internal_name>[_alt]<suffix>`; empty or `_` plus 1-7 letters and digits,
    unique.
  - `size`: the texture size, powers of two from 8 to 1024.
  - `two_sided`: draw it from both sides (capes).
  - `texture`: a `textures/` member, or `null` for the GLB's own base color image.
  - `alt`: the alternate costume's texture: `"same"`, a `textures/` member, or `"hue:<degrees>"`.
  - `bind`: `null`, or a game bone number every vertex of the material is fixed to (a prop).

### `aura`
`mode`:
- `base`: the base's aura and effects.
- `swap`: the two costumes exchange the base's normal and alternate auras, effects and intro cutscenes.
- `tint`: copies of the base's effects recolored to `color` (costume 1) and `alt_color` (costume 2), each `#RRGGBB` or `#RRGGBBAA`. The opacity (`AA`, default `FF`) scales the alpha of every recolored effect color, so `00` hides the aura.
  The power-mode glow keeps the base's color.

`tint` (optional, default `all`), what a `tint` copies:
- `all`: the idle and power-up effects, and every effect and projectile the alternate costume has its own of.
- `power`: the idle and power-up effects only.

A base whose full tint needs more memory than a match can spare is built as `power` ([`LIMITATIONS.md`](LIMITATIONS.md)).

### `flames`
Optional; left out when every key has its default. Fire that burns on the character all match, on top of the `aura`:
- `parts` (default `[]`): any of `head chest r_hand l_hand r_foot l_foot`.
- `body` (default `false`): Human Torch's body fire over the whole model instead.
- `color`, `alt_color` (default `null`): the costume's flame color, `#RRGGBB` or `#RRGGBBAA`.
- `size` (default `1`): 0.5-2.0, scales the flames.
- `base_effect` (default `true`): `false` removes the base's own always-on effect, such as Human Torch's body fire.

Older ImperfectLab builds refuse a file with `flames`.

### `stats`
- `display`: six integers 1-7 per costume: intel, strength, speed, durability, energy, skill. Shown on the
  select screen only.
- `gameplay`, every key optional:
  - `damage_taken`: 0.1-3.0, the share of a hit's damage taken.
  - `lift`: `light`, `medium` or `heavy`.
  - `wire_swing`: a boolean.
  - `flight`: `false` disallows flight on a base that flies. `true` is refused.
  - `wall_climb`: `true` lets a base that can't climb walls climb them (`moves` then names their animations). Not allowed on a base that already climbs.
  - `wall_run`: `true` lets a base that can't run on walls run on them, the same way. Not allowed on a base that already runs on walls.
  - `super_throw_range`: 1-20, how far away, in meters, the opponent can be for the super throw (R + X grab) to start.
  - Experimental: `health` (integer 10-1000), `run_speed` (1-30), `sprint_speed` (1-40), `rage_per_super` (0-100)
    and `rage_duration` (integer 1000-120000).

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

### `moves`
Moves taken from other bases: move id -> the base (not the character's own) whose animations it gets. Ids are motion-set state names, listed in `MOVES` in `src/core/build/moves.ts`; a throw or a sequence is one id covering its parts (`SuperThrow` includes the female, brute and victim versions).
`SuperAttackFar` cannot be combined with `base_moves.throw_reach`. Older ImperfectLab builds refuse a non-empty `moves`.
With `stats.gameplay.wall_climb` or `wall_run`, `moves` also adds states the base has none of. `wall_climb` requires `WallClimbUp`, `WallClimbDown`, `WallClimbLeft`, `WallClimbRight` and `WallClimbStand`, `wall_run` requires `WallRunUp`, `WallRunLeft` and `WallRunRight`, and `WallJumpOff`, `WallJumpToWall` and `WallRunJumpOff` are optional for both.

### `move_effects`
Optional, and left out when every taken move plays the base's effects. Move id (one in `moves`) -> `theirs` (the effects that base's version of the move starts, such as Daredevil's cable on his super throw) or `none` (no effects). A move left out starts the base's effects in their place.

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

### `cutscenes`
Optional, and left out when the character keeps its base's cutscenes and audio.
- `intro`, `victory`, `finisher`: the base (not the character's own) whose cutscenes of that kind the character uses. Each is optional.
- `effects`: kind -> `theirs` (that base's effects) or `none` (no effects), for kinds taken from another base. Optional; a kind left out plays the character's base's effects.
- `audio`: audio slot -> a `cutscenes/` member that replaces that audio. A slot is `<kind>_<n>`, numbered from 1 as the **Cutscenes** page lists them. A member is no longer than the stream it replaces and serves both costumes, and a shorter one is padded with silence when patching.

A `cutscenes/` member is an EA `SCHl` audio stream like the game's own (`Sounds/ASF/english/*.asf`): a `PT` header, `SCCl`, `SCDl` blocks of EA-XA ADPCM and `SCEl`. ImperfectLab writes stereo at 32000 Hz, in blocks of 2,156 samples and then 2,128. See [`LIMITATIONS.md`](LIMITATIONS.md) for what the patch can and cannot do.

## Licensing

The author is responsible for having the right to share every asset in the file.<br />
`credits.assets` is shown to whoever opens or patches the file, and ImperfectLab copies it into the patch report; a model under CC BY needs its credit there.