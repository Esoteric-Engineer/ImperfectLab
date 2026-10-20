import hashlib
import json
import os
import struct
import sys
from functools import lru_cache

from ..formats import LabError
from .disc import CHUNK, open_disc

GAME_ID = "GVLE69"
SHA1 = {"main.dol": "8e3cc563c300b7730802f69ade112bba1f4c6be5",
        "CLASH.BH": "32836d400df4b4e9f95b9eb790ebb142ab5c28bb",
        "CLASH.BIG": "9519b437d8677dbfb3dea7757aae3511bbfabc71"}


class Entry:
    __slots__ = ("offset", "size", "name", "hash", "data", "usize")

    def __init__(self, offset, size, name, h=None):
        self.offset, self.size, self.name, self.hash, self.data = offset, size, name, h, None
        self.usize = 0


class BigIndex:
    """The BIG4 index of CLASH.BIG, with what a repack keeps of it (tools/bigtool.py has the layout)."""

    def __init__(self, head, rest, slack):
        magic, self.total = head[:4], struct.unpack_from("<I", head, 4)[0]
        count, self.index_size = struct.unpack_from(">II", head, 8)
        if magic != b"BIG4":
            raise LabError("CLASH.BIG is not a BIG4 archive")
        self.entries, p = [], 0
        for _ in range(count):
            off, size = struct.unpack_from(">II", rest, p)
            end = rest.index(b"\0", p + 8)
            self.entries.append(Entry(off, size, rest[p + 8:end].decode("latin-1")))
            p = end + 1
        self.tail = rest[p:self.index_size - 16]
        if self.entries:
            slack = slack[:max(0, self.entries[0].offset - self.index_size)].rstrip(b"\0")
        self.slack = slack
        self.by_name, self.dups = {}, set()
        for e in self.entries:
            key = e.name.lower()
            if key in self.by_name:
                self.dups.add(key)
            self.by_name[key] = e


class GameSource:
    """The user's GVLE69 disc: its main.dol and the entries of CLASH.BIG, read straight off the disc."""

    def __init__(self, path):
        self.path = os.path.abspath(path)
        self.disc = open_disc(self.path)
        if self.disc.game_id != GAME_ID or self.disc.revision != 0:
            raise LabError("this is %s revision %d; ImperfectLab needs Marvel Nemesis for GameCube, USA "
                           "(%s revision 0)" % (self.disc.game_id, self.disc.revision, GAME_ID))
        self.big_file = self.disc.file("CLASH.BIG")
        self.bh_file = self.disc.file("CLASH.BH")
        head = self.disc.read(self.big_file, 0, 16)
        index_size = struct.unpack_from(">I", head, 12)[0]
        rest = self.disc.read(self.big_file, 16, index_size - 16 + 0x40)
        slack = self.disc.read(self.big_file, index_size, 0x40)
        self.index = BigIndex(head, rest, slack)

    @property
    def dol(self):
        return self.disc.dol

    def bh(self):
        return self.disc.read(self.bh_file, 0, self.bh_file.size)

    def has(self, name):
        return name.lower() in self.index.by_name

    def names(self, prefix="", suffix=""):
        return [e.name for e in self.index.entries
                if e.name.lower().startswith(prefix.lower()) and e.name.lower().endswith(suffix.lower())]

    def entry(self, name):
        return _entry(self, name.lower())

    def read_big(self, offset, size):
        return self.disc.read(self.big_file, offset, size)

    def verify(self, progress=None):
        """Raise LabError unless main.dol, CLASH.BH and CLASH.BIG are the original GVLE69 files.
        progress(done, total) is called while CLASH.BIG is hashed."""
        if hashlib.sha1(self.dol).hexdigest() != SHA1["main.dol"]:
            raise LabError("main.dol is not the original GVLE69 one: the disc is already patched or modified")
        if hashlib.sha1(self.bh()).hexdigest() != SHA1["CLASH.BH"]:
            raise LabError("CLASH.BH is not the original GVLE69 one: the disc is already patched or modified")
        h, pos, total = hashlib.sha1(), 0, self.big_file.size
        while pos < total:
            n = min(CHUNK, total - pos)
            h.update(self.disc.read(self.big_file, pos, n))
            pos += n
            if progress:
                progress(pos, total)
        if h.hexdigest() != SHA1["CLASH.BIG"]:
            raise LabError("CLASH.BIG is not the original GVLE69 one: the disc is already patched or modified")
        remember_verified(self.path)

    def is_verified(self):
        return verified(self.path)

    def close(self):
        self.disc.close()


@lru_cache(maxsize=96)
def _entry(source, key):
    e = source.index.by_name.get(key)
    if e is None:
        raise LabError("CLASH.BIG has no entry %s" % key)
    return source.disc.read(source.big_file, e.offset, e.size)


def config_dir():
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
        return os.path.join(base, "ImperfectLab")
    if sys.platform == "darwin":
        return os.path.expanduser("~/Library/Application Support/ImperfectLab")
    return os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"), "imperfectlab")


def _stamp(path):
    st = os.stat(path)
    return "%d:%d" % (st.st_size, st.st_mtime_ns)


def _cache_path():
    return os.path.join(config_dir(), "verified.json")


def _load_cache():
    try:
        with open(_cache_path()) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def verified(path):
    try:
        return _load_cache().get(os.path.abspath(path)) == _stamp(path)
    except OSError:
        return False


def remember_verified(path):
    data = _load_cache()
    try:
        data[os.path.abspath(path)] = _stamp(path)
        os.makedirs(config_dir(), exist_ok=True)
        with open(_cache_path(), "w") as f:
            json.dump(data, f, indent=1)
    except OSError:
        pass
