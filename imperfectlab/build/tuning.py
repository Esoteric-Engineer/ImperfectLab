"""The character's own tuning file, Misc/PLAYER_<Name>.nvb: a copy of the base's with some fields changed,
and its line in Misc/nvblist.txt (docs/characters.md section 4, "Tuning records")."""
import re
import struct

from ..formats import LabError, call, nvbtool

SLOTS = nvbtool.SLOTS
RESISTANCE = (134, 135, 136, 137, 138)
FIELDS = {"run_speed": 104, "sprint_speed": 157, "rage_per_super": 189, "rage_duration": 192}
POWER_EFFECTS = (98, 99)
LIST_BUFFER = 0x200


class Tuning:
    """The base's tuning file and the schema, for reading values and writing an edited copy."""

    def __init__(self, source, base):
        self.base = base
        self.fields = call(nvbtool.parse_ndb, source.entry("Misc/defaults.ndb")).fields("PLAYER")
        self.nvb = call(nvbtool.parse_nvb, source.entry(base.nvb_name()))
        self.list = source.entry("Misc/nvblist.txt")

    def slots(self, fid):
        typ, default = self.fields[fid]
        return typ, self.nvb.slots(fid, default) or [default] * SLOTS

    def value(self, fid, slot=0):
        typ, vals = self.slots(fid)
        v = vals[slot]
        if typ == nvbtool.T_FLOAT:
            return struct.unpack("<f", v)[0]
        if typ == nvbtool.T_INT:
            return struct.unpack("<i", v)[0]
        return v.split(b"\0")[0].decode("latin-1")

    def damage_taken(self):
        return 1.0 - self.value(RESISTANCE[0])

    def gameplay(self):
        """The base's value of each gameplay field (slot 0, a human player's character)."""
        out = {k: self.value(fid) for k, fid in FIELDS.items()}
        out["damage_taken"] = self.damage_taken()
        return out

    def _set(self, nvb, fid, values):
        typ = self.fields[fid][0]
        enc = (lambda v: struct.pack("<f", v)) if typ == nvbtool.T_FLOAT else \
            (lambda v: struct.pack("<i", int(round(v)))) if typ == nvbtool.T_INT else \
            (lambda v: v.encode("latin-1") + b"\0")
        recs = [(0, typ, enc(values[0]))] + [(s, typ, enc(v)) for s, v in enumerate(values) if s and v != values[0]]
        g = nvb.group(fid)
        if g:
            g[1] = recs
        else:
            nvb.groups.append([fid, recs])

    def _scaled(self, fid, new):
        vals = [self.value(fid, s) for s in range(SLOTS)]
        if not vals[0]:
            return [new] * SLOTS
        k = new / vals[0]
        return [v * k for v in vals]

    def build(self, internal, gameplay, power_effects=None):
        """(entry name, .nvb bytes, nvblist.txt bytes) for the edited copy."""
        nvb = call(nvbtool.parse_nvb, nvbtool.build_nvb(self.nvb))
        nvb.raw_name = internal.encode("latin-1") + b"\0" * (0x40 - len(internal))
        for key, fid in FIELDS.items():
            if gameplay.get(key) is not None:
                self._set(nvb, fid, self._scaled(fid, gameplay[key]))
        if gameplay.get("damage_taken") is not None:
            t = gameplay["damage_taken"]
            t0 = self.damage_taken()
            for fid in RESISTANCE:
                taken = [1.0 - self.value(fid, s) for s in range(SLOTS)]
                k = t / t0 if t0 > 0 else None
                self._set(nvb, fid, [1.0 - (x * k if k is not None else t) for x in taken])
        for fid, (normal, alt) in (power_effects or {}).items():
            self._set(nvb, fid, [normal] * (SLOTS - 1) + [alt])
        name = "Misc/PLAYER_%s.nvb" % internal
        return name, nvbtool.build_nvb(nvb), self.listed(internal)

    def listed(self, internal):
        text = self.list.decode("latin-1")
        used = 0
        for line in text.split("\n"):
            if line[:1] in (" ", "/"):
                continue
            t = [x for x in re.split(r"[ \t\r\n/;]+", line) if x]
            if len(t) >= 2:
                used += len(t[0]) + len(t[1]) + 2
                if t[0].upper() == "PLAYER" and t[1].lower() == internal.lower():
                    raise LabError("nvblist.txt already lists PLAYER %s" % internal)
        if used + len("PLAYER") + len(internal) + 2 >= LIST_BUFFER:
            raise LabError("Misc/nvblist.txt has no room for another tuning file")
        if not text.endswith("\r\n"):
            text += "\r\n"
        return (text + "PLAYER %s\r\n" % internal).encode("latin-1")
