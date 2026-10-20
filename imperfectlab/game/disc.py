import os
import struct
import threading

from ..formats import LabError

SECTOR = 0x8000
CISO_HEADER = 0x8000
GC_DISC_SIZE = 1459978240
CHUNK = 1 << 22
UNSUPPORTED = {b"RVZ\x01": "RVZ", b"WIA\x01": "WIA", b"\x01\xc0\x0b\xb1": "GCZ"}


class Image:

    def __init__(self, path):
        self.f = open(path, "rb")
        self.lock = threading.Lock()
        head = self.f.read(8)
        if head[:4] in UNSUPPORTED:
            raise LabError("%s is a %s image: convert it to ISO first (Dolphin: right-click the game, "
                           "Convert File, format ISO)" % (os.path.basename(path), UNSUPPORTED[head[:4]]))
        self.blocks = None
        if head[:4] == b"CISO":
            self.block_size = struct.unpack_from("<I", head, 4)[0]
            present = self.f.read(CISO_HEADER - 8)
            self.blocks, n = [], 0
            for b in present:
                self.blocks.append(n if b else None)
                n += 1 if b else 0

    def read(self, offset, size):
        with self.lock:
            return self._read(offset, size)

    def _read(self, offset, size):
        if self.blocks is None:
            self.f.seek(offset)
            data = self.f.read(size)
            return data + b"\0" * (size - len(data))
        out = bytearray()
        bs = self.block_size
        while size:
            i, within = divmod(offset, bs)
            n = min(size, bs - within)
            slot = self.blocks[i] if i < len(self.blocks) else None
            if slot is None:
                out += b"\0" * n
            else:
                self.f.seek(CISO_HEADER + slot * bs + within)
                out += self.f.read(n)
            offset += n
            size -= n
        return bytes(out)

    def close(self):
        self.f.close()


class FileEntry:
    __slots__ = ("path", "offset", "size")

    def __init__(self, path, offset, size):
        self.path, self.offset, self.size = path, offset, size


class Disc:
    """A GameCube disc image (.iso, .gcm or .ciso), read-only."""

    def __init__(self, path):
        self.path = path
        self.img = Image(path)
        self.boot = self.img.read(0, 0x440)
        self.bi2 = self.img.read(0x440, 0x2000)
        ap_size, ap_trailer = struct.unpack(">II", self.img.read(0x2440 + 0x14, 8))
        self.apploader = self.img.read(0x2440, 0x20 + ap_size + ap_trailer)
        self.game_id = self.boot[:6].decode("latin-1")
        self.revision = self.boot[7]
        self.dol_offset, self.fst_offset, self.fst_size = struct.unpack_from(">III", self.boot, 0x420)
        self.fst = self.img.read(self.fst_offset, self.fst_size)
        self.dol = self.img.read(self.dol_offset, dol_size(self.img.read(self.dol_offset, 0x100)))
        self.files = parse_fst(self.fst)

    def file(self, path):
        for e in self.files:
            if e.path.lower() == path.lower():
                return e
        raise LabError("the disc has no file %s" % path)

    def read(self, entry, offset, size):
        return self.img.read(entry.offset + offset, size)

    def read_file(self, path):
        e = self.file(path)
        return self.read(e, 0, e.size)

    def close(self):
        self.img.close()


class Folder(Disc):
    """An extracted disc (sys/ and files/, as Dolphin writes it), read-only."""

    def __init__(self, path):
        self.path = path
        self.img = None
        sys_dir = os.path.join(path, "sys")
        get = lambda n: open(os.path.join(sys_dir, n), "rb").read()
        try:
            self.boot, self.bi2, self.apploader = get("boot.bin"), get("bi2.bin"), get("apploader.img")
            self.fst, self.dol = get("fst.bin"), get("main.dol")
        except OSError as e:
            raise LabError("%s is not an extracted disc (sys/boot.bin, bi2.bin, apploader.img, fst.bin and "
                           "main.dol are needed): %s" % (path, e))
        self.game_id = self.boot[:6].decode("latin-1")
        self.revision = self.boot[7]
        self.dol_offset, self.fst_offset, self.fst_size = struct.unpack_from(">III", self.boot, 0x420)
        self.files = parse_fst(self.fst)
        self.handles = {}
        self.lock = threading.Lock()

    def _open(self, entry):
        f = self.handles.get(entry.path)
        if f is None:
            f = self.handles[entry.path] = open(os.path.join(self.path, "files", *entry.path.split("/")), "rb")
        return f

    def read(self, entry, offset, size):
        with self.lock:
            f = self._open(entry)
            f.seek(offset)
            data = f.read(size)
        return data + b"\0" * (size - len(data))

    def close(self):
        for f in self.handles.values():
            f.close()
        self.handles = {}


def open_disc(path):
    return Folder(path) if os.path.isdir(path) else Disc(path)


def dol_size(head):
    offs = struct.unpack_from(">18I", head, 0)
    sizes = struct.unpack_from(">18I", head, 0x90)
    return max(o + s for o, s in zip(offs, sizes) if s)


def parse_fst(fst):
    count = struct.unpack_from(">I", fst, 8)[0]
    names = fst[count * 12:]
    files, stack = [], [(count, "")]

    def name(i):
        off = struct.unpack_from(">I", fst, i * 12)[0] & 0xFFFFFF
        return names[off:names.index(b"\0", off)].decode("latin-1")

    for i in range(1, count):
        while i >= stack[-1][0]:
            stack.pop()
        flags = fst[i * 12]
        a, b = struct.unpack_from(">II", fst, i * 12 + 4)
        if flags:
            stack.append((b, stack[-1][1] + name(i) + "/"))
        else:
            files.append(FileEntry(stack[-1][1] + name(i), a, b))
    return files


def copy(disc, entry, dst, progress=None):
    pos = 0
    while pos < entry.size:
        n = min(CHUNK, entry.size - pos)
        dst.write(disc.read(entry, pos, n))
        pos += n
        if progress:
            progress(n)


def write_iso(out, disc, dol, replace, progress=None):
    """Write a new image: disc with main.dol replaced and the files in replace ({path: bytes or
    callable(fileobj) -> size}) swapped in; every other file is copied from disc."""
    replace = {k.lower(): v for k, v in replace.items()}
    order = sorted(disc.files, key=lambda e: e.offset)
    fst = bytearray(disc.fst)
    count = struct.unpack_from(">I", fst, 8)[0]
    index = {}
    for i, e in zip([j for j in range(1, count) if not fst[j * 12]], disc.files):
        index[e.path] = i
    if len(dol) > disc.fst_offset - disc.dol_offset:
        raise LabError("the patched main.dol does not fit before the FST")

    with open(out, "wb") as f:
        f.write(disc.boot + disc.bi2 + disc.apploader)
        f.seek(disc.dol_offset)
        f.write(dol)
        pos = disc.fst_offset + disc.fst_size
        for e in order:
            start = max(e.offset, (pos + SECTOR - 1) & ~(SECTOR - 1))
            f.seek(start)
            src = replace.get(e.path.lower())
            if src is None:
                copy(disc, e, f, progress)
                size = e.size
            elif callable(src):
                size = src(f)
            else:
                f.write(src)
                size = len(src)
            struct.pack_into(">II", fst, index[e.path] * 12 + 4, start, size)
            pos = start + size
        if pos > GC_DISC_SIZE:
            raise LabError("the patched game is 0x%X bytes, more than a GameCube disc holds" % pos)
        f.seek(disc.fst_offset)
        f.write(fst)
        f.truncate(GC_DISC_SIZE)
    return GC_DISC_SIZE
