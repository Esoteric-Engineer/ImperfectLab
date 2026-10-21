# ImperfectLab

Make custom characters for *Marvel Nemesis: Rise of the Imperfects* (GameCube, USA) and export them as
`.imperfect` files.

A character is a model of your own (`.glb`) on top of one of the game's 18 characters. Pick the base character, map a new model's skeleton onto theirs, set the names, stats, aura and pictures, and save.
Anyone with their own copy of the game and this patcher can then open the file and patch the character in as the 19th character.

<b>No game files are included.</b> A `.imperfect` file holds only the author's model, pictures and settings; everything taken from the game is read from your own disc when the character is patched in.

## Requirements

- Your own copy of the game: USA, game ID `GVLE69`, as `.iso`, `.gcm` or `.ciso`, or an extracted disc folder.
- Python 3.10 or newer with Pillow and PySide6: `pip install pillow pyside6`
- About 1.5 GB of free space per patched disc.

## Run

From this folder (or after `pip install .`, as `imperfectlab`):

```bash
  python3 -m imperfectlab                                   # launch the editor
  python3 -m imperfectlab patch GAME.iso CHAR.imperfect     # patch a .imperfect file into the game
  python3 -m imperfectlab info CHAR.imperfect               # get info about a .imperfect file
```

The patched disc is `GAME (Name).iso`, with a report of what changed next to it.

## Notes

- Models rigged as 3ds Max Biped, Mixamo, Rigify, Unreal mannequin, VRM/VRoid and Unity Humanoid map automatically. Other types will work, but require manual mapping.
- The `.imperfect` file format is documented at `docs/FORMAT.md`.

## Development
```bash
  python3 -m unittest discover -s tests -t tests
```

Tests that need the game or other repositories skip unless these point at them: `IMPERFECTLAB_ISO` (an unmodified GVLE69 disc) and `IMPERFECTLAB_MNROI` (a mnroi checkout, to check the vendored tools).
`tools/sync_vendor.py` refreshes `imperfectlab/vendor/mnroi/` from a mnroi checkout.

## Credits

- The [mnroi decompilation](https://github.com/Esoteric-Engineer/mnroi). Format tools from the decomp are used (`imperfectlab/vendor/mnroi/`).

This is a fan project, not affiliated with or endorsed by Marvel, Electronic Arts or Nintendo.