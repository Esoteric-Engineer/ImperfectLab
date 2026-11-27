# ImperfectLab

Make custom characters for *Marvel Nemesis: Rise of the Imperfects* (GameCube, USA), export them as
`.imperfect` files and patch them into your own copy of the game.

ImperfectLab runs entirely in the browser: files are never uploaded to a server, and the disc never leaves your computer.

A character is a model of your own (`.glb`) on top of one of the game's 18 characters. Pick the base character, map a new model's skeleton onto theirs, set the names, stats, aura, flames and pictures, optionally swap some of its moves and cutscenes for other characters', stretch its limbs in some moves, give its cutscenes new audio or new animation, replace its sound effects, and save.
Anyone with their own copy of the game and this patcher can then open the file and patch the character in as the 19th character.
Up to nine `.imperfect` characters can also be patched into a single ISO via the **Multi-Character Patch** page, which checks them against each other and the disc first.

<b>No game files are included.</b> A `.imperfect` file holds only the author's model, pictures, cutscene audio and animation, sounds and settings; everything taken from the game is read from your own disc when the character is patched in.

## Requirements

- Your own copy of the game: USA, game ID `GVLE69`, as `.iso`, `.gcm` or `.ciso`, or an extracted disc folder.
- About 1.5 GB of free space per patched disc.
- Any current browser. Chromium-based browsers are recommended (Chrome, Edge, Brave, etc.). Firefox and Safari are also supported, but may run into some issues due to building the patched disc in the browser's own storage (1.4 GB free is needed) before downloading it.

## Run

```bash
npm install     # install deps
npm run dev     # run at http://localhost:5173
npm run build   # builds to dist/
npm run lint    # lint code
npm test        # test
```

## Notes

- Models rigged as 3ds Max Biped, Mixamo, Rigify, Unreal mannequin, VRM/VRoid and Unity Humanoid map automatically. Other types will work, but require manual mapping.
- The `.imperfect` file format is documented at `docs/FORMAT.md`, and the game's limits that shape a build at `docs/LIMITATIONS.md`.

## Development

Tests that need the game skip unless `IMPERFECTLAB_ISO` points at an unmodified GVLE69 disc (`.iso`, `.gcm` or `.ciso`):

```bash
IMPERFECTLAB_ISO=/path/to/GVLE69.iso npm test
```

`IMPERFECTLAB_XBOX` pointing at the Xbox image of [15Cyber's port](https://github.com/15Cyber/marvel-nemesis-recomp) (its `assets/*.iso`) turns on the retail Xbox format tests too. `tests/golden.test.ts` holds GameCube output fixed: regenerate its snapshot (`vitest -u`) only on purpose.

Layout:

- `src/core/`: everything that reads and writes game and character data, with no DOM or React (ESLint holds it to that)
  - `src/core/xbox/`: the Xbox formats, for ports built from the Xbox version
  - `src/core/build/target.ts`: what a build targets (`GAMECUBE` by default; Lab Builder passes its own)
- `src/web/`: browser helpers for other tools (disc and image reading in a worker)
- `src/worker/`: the engine worker that holds the opened disc and runs the core
- `src/io/`: file pickers, downloads, browser storage, and the shared workspace (the disc and Multi-Character Patch list Lab Builder reads)
- `src/ui/`: React app

### The core package

`src/core` and `src/web` are published as `@nemesismods/imperfectlab-core`, which all other tools use:

```bash
npm run build:core                           # dist-core/, versioned 1.<commit count>.0
npm publish ./dist-core --access public      # from main only
```

Import paths follow `src/core` (`@nemesismods/imperfectlab-core/build/batch`), plus `@nemesismods/imperfectlab-core/web`. Consumers need `moduleResolution: "bundler"`.

ImperfectLab is meant to run inside the NemesisMods suite at nemesismods.com/lab (see NemesisModsCore). For the suite's local dev server, `SUITE_BASE=/lab/` serves it under that path.

## Credits

- The [mnroi decompilation](https://github.com/Esoteric-Engineer/mnroi). Format tools from the decomp are ported to TypeScript in `src/core/mnroi/`.

This is a fan project, not affiliated with or endorsed by Marvel, Electronic Arts or Nintendo.