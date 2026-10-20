"""Same-size edits to main.dol that turn the filler roster record 19 into a playable character.

The roster tables are Game/unlockables.c in the decomp (docs/characters.md section 2): 0x4C-byte
records {char name[0x20]; char key[0x20]; s8 stats[6]; s8 pad[2]; int unlocked}.
"""
import struct

from ..formats import LabError

NORMAL_TABLE = 0x4C751C
ALT_TABLE = 0x4C7B0C
ORDER_TABLE = 0x4C80FC
RECORD = 0x4C
SLOT = 19
STATS = ("intel", "strength", "speed", "durability", "energy", "skill")

LIMITS = [
    (0x1007DC, "2c000012", "2c000013"),  # clashCharSelect_GetCharList: for (i = 1; i <= 18; i++)
    (0x101758, "2c000012", "2c000013"),  # Control_SetSelectInfo clamps, both players
    (0x101760, "38000012", "38000013"),
    (0x101788, "2c000012", "2c000013"),
    (0x101790, "38000012", "38000013"),
]
FILLER = {NORMAL_TABLE: "plr_thing", ALT_TABLE: "plr_altThing"}


def record_offset(table, index):
    return table + RECORD * index


def read_record(dol, table, index):
    o = record_offset(table, index)
    text = lambda b: b.split(b"\0")[0].decode("latin-1")
    return {"name": text(dol[o:o + 0x20]), "key": text(dol[o + 0x20:o + 0x40]),
            "stats": list(struct.unpack_from(">6b", dol, o + 0x40)),
            "unlocked": struct.unpack_from(">i", dol, o + 0x48)[0]}


def entity_names(internal):
    return "plr_" + internal.lower(), "plr_alt" + internal.lower().capitalize()


def _field(text, size=0x20):
    b = text.encode("latin-1")
    if len(b) >= size:
        raise LabError("%r does not fit a %d-byte field" % (text, size))
    return b + b"\0" * (size - len(b))


def patch(dol, internal, display, stats, alt_stats):
    out = bytearray(dol)

    def put(off, old, new):
        if bytes(out[off:off + len(old)]) != old or len(old) != len(new):
            raise LabError("main.dol differs from GVLE69 at 0x%X" % off)
        out[off:off + len(new)] = new

    for off, old, new in LIMITS:
        put(off, bytes.fromhex(old), bytes.fromhex(new))
    names = dict(zip((NORMAL_TABLE, ALT_TABLE), entity_names(internal)))
    for table, values in ((NORMAL_TABLE, stats), (ALT_TABLE, alt_stats)):
        if len(values) != 6 or not all(0 <= v <= 10 for v in values):
            raise LabError("stats must be six values from 0 to 10")
        o = record_offset(table, SLOT)
        put(o, _field(FILLER[table]), _field(names[table]))
        put(o + 0x20, _field("~kT_THING"), _field(display))
        put(o + 0x40, bytes(out[o + 0x40:o + 0x48]), struct.pack(">6b2x", *values))
    put(ORDER_TABLE + 4 * SLOT, b"\0\0\0\0", struct.pack(">I", SLOT))
    return bytes(out)
