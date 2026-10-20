import struct

from ..formats import LabError
from .disc import CHUNK
from .source import Entry

ALIGN = 0x20


def name_hash(name):
    h = 5381
    for c in name.lower().encode("latin-1"):
        h = (h * 33 + c) & 0xFFFFFFFF
    return h


def unpacked_size(data):
    if len(data) >= 5 and data[0] == 0x10 and data[1] == 0xFB:
        return int.from_bytes(data[2:5], "big")
    return 0


def read_bh(d):
    if d[:4] != b"Viv4":
        raise LabError("CLASH.BH is not a Viv4 index")
    count = struct.unpack_from(">I", d, 8)[0]
    return [struct.unpack_from(">IIII", d, 16 + 16 * i) for i in range(count)]


def plan_repack(source, sets, adds):
    """Lay out a new CLASH.BIG: sets replace entries, adds append new ones ({name: bytes}).
    Returns (plan, index bytes, total size, new CLASH.BH bytes)."""
    idx = source.index
    entries = [Entry(e.offset, e.size, e.name) for e in idx.entries]
    rows = read_bh(source.bh())
    if len(rows) != len(entries):
        raise LabError("CLASH.BH and CLASH.BIG disagree")
    for e, r in zip(entries, rows):
        if (r[0], r[1]) != (e.offset, e.size):
            raise LabError("CLASH.BH and CLASH.BIG disagree at %s" % e.name)
        e.hash, e.usize = r[3], r[2]
    by_name = {e.name.lower(): e for e in entries}
    for name, data in sets.items():
        key = name.lower()
        if key in idx.dups:
            raise LabError("%s appears more than once in CLASH.BIG; replacing it is not supported" % name)
        e = by_name.get(key)
        if e is None:
            raise LabError("CLASH.BIG has no entry %s to replace" % name)
        e.data = data
        e.usize = unpacked_size(data)
    for name, data in adds.items():
        if name.lower() in by_name:
            raise LabError("CLASH.BIG already has an entry %s" % name)
        e = Entry(0, 0, name, name_hash(name))
        e.data = data
        e.usize = unpacked_size(data)
        entries.append(e)
        by_name[name.lower()] = e

    new_index_size = 16 + sum(8 + len(e.name) + 1 for e in entries) + len(idx.tail)
    pos = (new_index_size + len(idx.slack) + ALIGN - 1) & ~(ALIGN - 1)
    plan = []
    for e in entries:
        size = len(e.data) if e.data is not None else e.size
        plan.append((e, pos, size))
        pos = (pos + size + ALIGN - 1) & ~(ALIGN - 1)
    total = pos

    index = b"BIG4" + struct.pack("<I", total) + struct.pack(">II", len(entries), new_index_size)
    index += b"".join(struct.pack(">II", off, size) + e.name.encode("latin-1") + b"\0" for e, off, size in plan)
    index += idx.tail
    index += idx.slack

    n = len(entries)
    bh_size = 16 + 16 * n + 16
    bh = b"Viv4" + struct.pack("<I", bh_size) + struct.pack(">II", n, bh_size)
    bh += b"".join(struct.pack(">IIII", off, size, e.usize, e.hash) for e, off, size in plan)
    bh += struct.pack(">IIII", total, 0, 0, 0)
    return plan, index, total, bh


def write_big(source, plan, index, total, dst, progress=None):
    base = dst.tell()
    dst.write(index)
    for e, off, size in plan:
        dst.write(b"\0" * (base + off - dst.tell()))
        if e.data is not None:
            dst.write(e.data)
        else:
            pos = 0
            while pos < size:
                n = min(CHUNK, size - pos)
                dst.write(source.read_big(e.offset + pos, n))
                pos += n
        if progress:
            progress(size)
    dst.write(b"\0" * (base + total - dst.tell()))
    return total
