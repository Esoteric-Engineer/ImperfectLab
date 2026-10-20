"""ImperfectLab: make custom characters for Marvel Nemesis: Rise of the Imperfects (GameCube, USA).

  python -m imperfectlab                                   open the editor
  python -m imperfectlab patch GAME.iso CHAR.imperfect [OUT.iso] [--overwrite]
                                                           write a patched copy of GAME.iso
  python -m imperfectlab info CHAR.imperfect               what a character file holds, and its credits
  python -m imperfectlab validate CHAR.imperfect [GAME.iso]
                                                           check a character file (against a disc too)
  python -m imperfectlab verify GAME.iso                   check that a disc is an unmodified GVLE69 dump
"""
import os
import sys
import time

from .formats import LabError


def load_character(path):
    from .package import imperfect
    with open(path, "rb") as f:
        return imperfect.load(f.read())


def printer():
    last = [None, 0.0]

    def progress(stage, done=0, total=0):
        now = time.time()
        if stage != last[0]:
            print("\n== " + stage, flush=True)
            last[0] = stage
        if total and (now - last[1] > 1.0 or done >= total):
            print("   %3d%%" % (100 * done // total), flush=True)
            last[1] = now
    return progress


def cmd_patch(args, overwrite):
    from .build import patch
    from .game.source import GameSource
    if len(args) < 2:
        raise SystemExit(__doc__)
    character = load_character(args[1])
    out = args[2] if len(args) > 2 else os.path.splitext(args[0])[0] + " (%s).iso" % character.display_name.title()
    t0 = time.time()
    src = GameSource(args[0])
    result = patch.patch(src, character, out, printer(), overwrite)
    rep = patch.report(character, result)
    with open(os.path.splitext(out)[0] + " - report.txt", "w") as f:
        f.write(rep)
    print("\n" + rep)
    print("Done in %.0f s: %s" % (time.time() - t0, out))


def cmd_info(args):
    c = load_character(args[0])
    from .game import roster
    print("%s (internal name %s), based on %s" % (c.display_name, c.internal_name, roster.label(c.base)))
    print("stats %s / alternate %s; aura %s" % (c.stats["normal"], c.stats["alt"], c.aura["mode"]))
    if c.gameplay:
        print("gameplay: " + ", ".join("%s %s" % kv for kv in sorted(c.gameplay.items())))
    print("model: %d bytes, %d materials, %d mapped bones" % (len(c.glb or b""), len(c.materials), len(c.mapping)))
    print("files: " + ", ".join(sorted(c.files)))
    cr = c.credits
    print("\nby %s\n%s" % (cr.get("author") or "(no author)", cr.get("description", "")))
    for a in cr.get("assets", []):
        print("  %s: %s, %s %s" % (a.get("what"), a.get("by"), a.get("licence"), a.get("url")))


def cmd_validate(args):
    c = load_character(args[0])
    problems = c.problems()
    if len(args) > 1:
        from .build.patch import Builder
        from .game.source import GameSource
        try:
            r = Builder(GameSource(args[1]), c).build()
            problems += [("note", n) for n in r.notes]
        except LabError as e:
            problems.append(("error", str(e)))
    for level, msg in problems:
        print("%-7s %s" % (level, msg))
    errors = [p for p in problems if p[0] == "error"]
    print("%s: %s" % (args[0], "%d error(s)" % len(errors) if errors else "OK"))
    sys.exit(1 if errors else 0)


def cmd_verify(args):
    from .game.source import GameSource
    src = GameSource(args[0])
    src.verify(lambda done, total: printer()("Hashing CLASH.BIG", done, total))
    print("%s: an unmodified GVLE69 disc" % args[0])


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    overwrite = "--overwrite" in argv
    argv = [a for a in argv if a != "--overwrite"]
    try:
        if not argv:
            from .gui.app import main as gui
            return gui()
        cmd, args = argv[0], argv[1:]
        if cmd == "patch":
            cmd_patch(args, overwrite)
        elif cmd == "info" and args:
            cmd_info(args)
        elif cmd == "validate" and args:
            cmd_validate(args)
        elif cmd == "verify" and args:
            cmd_verify(args)
        else:
            raise SystemExit(__doc__)
    except LabError as e:
        raise SystemExit("error: %s" % e)


if __name__ == "__main__":
    main()
