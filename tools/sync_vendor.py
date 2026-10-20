#!/usr/bin/env python3
"""Copy the format tools ImperfectLab uses from a mnroi checkout into imperfectlab/vendor/mnroi/.

  python3 tools/sync_vendor.py ../mnroi          copy the files and write VENDOR.md
  python3 tools/sync_vendor.py ../mnroi --check  only compare, exit 1 on a difference

The files are copied unmodified; mnroi is CC0 1.0.
"""
import hashlib
import os
import shutil
import subprocess
import sys

FILES = ("aptdump.py", "aptpatch.py", "gltf.py", "gshtool.py", "gxtex.py", "nbig.py", "nfxtool.py",
         "ngbtool.py", "ngmexport.py", "ngmtool.py", "nmstool.py", "nottool.py", "nvbtool.py", "refpack.py")
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(HERE, "imperfectlab", "vendor", "mnroi")


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def commit(repo):
    try:
        out = subprocess.run(["git", "-C", repo, "log", "-1", "--format=%H %s"], capture_output=True, text=True,
                             check=True).stdout.strip()
        dirty = subprocess.run(["git", "-C", repo, "status", "--porcelain", "--", "tools"], capture_output=True,
                               text=True, check=True).stdout.strip()
        return out + (" (tools/ has uncommitted changes)" if dirty else "")
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def main(argv):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    repo = os.path.abspath(argv[1])
    src = os.path.join(repo, "tools")
    if "--check" in argv:
        bad = [n for n in FILES if sha256(os.path.join(src, n)) != sha256(os.path.join(DEST, n))]
        for n in bad:
            print("differs: " + n)
        print("%d of %d vendored files match %s" % (len(FILES) - len(bad), len(FILES), src))
        sys.exit(1 if bad else 0)
    os.makedirs(DEST, exist_ok=True)
    rows = []
    for n in FILES:
        shutil.copyfile(os.path.join(src, n), os.path.join(DEST, n))
        rows.append("| `%s` | `%s` |" % (n, sha256(os.path.join(DEST, n))))
    shutil.copyfile(os.path.join(repo, "LICENSE"), os.path.join(DEST, "LICENSE"))
    with open(os.path.join(DEST, "VENDOR.md"), "w") as f:
        f.write("# Vendored mnroi tools\n\n"
                "Unmodified copies of `tools/` files from the mnroi decompilation "
                "(https://github.com/Esoteric-Engineer/mnroi), CC0 1.0 (`LICENSE`).\n"
                "Refresh with `python3 tools/sync_vendor.py <mnroi checkout>`.\n\n"
                "Source commit: %s\n\n| File | sha256 |\n|---|---|\n%s\n" % (commit(repo), "\n".join(rows)))
    print("copied %d files from %s" % (len(FILES), src))


if __name__ == "__main__":
    main(sys.argv)
