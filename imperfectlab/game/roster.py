"""The 18 playable characters a new one can be based on.

Only what is fixed in the code is listed here; everything that is data (stats, models, effects,
body class, banner sizes) is read from the user's disc by BaseCharacter.
"""
import struct

from ..formats import LabError, call, nottool
from . import dol as D

SELECT_ID = 18
SLOT = D.SLOT

# key: (label, select id, roster index, type ID, template stem, aura index or None)
BASES = {
    "thing": ("Thing", 0, 10, 10, "Thing", None),
    "wolverine": ("Wolverine", 1, 2, 1, "Wolverine", None),
    "paradox": ("Paradox", 2, 15, 14, "Paradox", None),
    "elektra": ("Elektra", 3, 6, 6, "Elektra", None),
    "johnnyohm": ("Johnny Ohm", 4, 14, 16, "JohnnyOhm", 3),
    "spiderman": ("Spider-Man", 5, 3, 3, "SpiderMan", None),
    "daredevil": ("Daredevil", 6, 9, 9, "Daredevil", None),
    "storm": ("Storm", 7, 7, 7, "Storm", 6),
    "aftershock": ("Aftershock", 8, 13, 15, "Aftershock", None),
    "venom": ("Venom", 9, 4, 4, "Venom", None),
    "heatwave": ("Heatwave", 10, 16, 18, "Heatwave", 10),
    "humantorch": ("Human Torch", 11, 8, 8, "HumanTorch", 4),
    "ironman": ("Iron Man", 12, 1, 2, "IronMan", 5),
    "megalith": ("Megalith", 13, 17, 12, "Megalith", 7),
    "magneto": ("Magneto", 14, 5, 5, "Magneto", None),
    "biohazard": ("Biohazard", 15, 12, 17, "Biohazard", 9),
    "defcon": ("DefCon", 16, 11, 13, "DefCon", None),
    "roekel": ("Van Roekel", 17, 18, 11, "Roekel", 8),
}
VOICES = {"thing": "FE_SFX_THING", "wolverine": "FE_SFX_WOLVERINE", "paradox": "FE_SFX_WINK",
          "elektra": "FE_SFX_ELEKTRA", "johnnyohm": "FE_SFX_OHM", "spiderman": "FE_SFX_SPIDEY",
          "daredevil": "FE_SFX_DAREDEVIL", "storm": "FE_SFX_STORM", "aftershock": "FE_SFX_FAULTZONE",
          "venom": "FE_SFX_VENOM", "heatwave": "FE_SFX_SOLARA", "humantorch": "FE_SFX_TORCH",
          "ironman": "FE_SFX_IRONMAN", "megalith": "FE_SFX_BRIGADE", "magneto": "FE_SFX_MAGNETO",
          "biohazard": "FE_SFX_HAZMAT", "defcon": "FE_SFX_DEFCON", "roekel": "FE_SFX_ROEKEL"}
BODY_CLASSES = {0: "male", 1: "female", 2: "brute"}
LANGS = ("ENG", "FRA", "GER", "ITA")

P_MODEL, P_PHYSMODEL, P_MOTIONSET, P_CASTID, P_DESCRIPTIONID = 0x0A, 0x0F, 0x13, 0x14, 0x15
P_SKELETONID, P_EFFECT1, P_ACTOR_FLAGS, P_ABILITIES = 0x27, 0x28, 0x30, 0x32
P_HEALTH, P_MAXHEALTH, P_SHADOWMODEL = 0x33, 0x34, 0x75


def keys():
    return list(BASES)


def label(key):
    return BASES[key][0]


def text(v):
    return v.split(b"\0")[0].decode("latin-1") if v is not None else None


def u32(v):
    return struct.unpack_from("<I", v)[0] if v is not None else None


def f32(v):
    return struct.unpack_from("<f", v)[0] if v is not None else None


class Templates:
    """Misc/Global.not with name lookup and inherited properties."""

    def __init__(self, data):
        self.list = call(nottool.parse, data)
        self.by = {t.name.lower(): t for t in self.list}

    def get(self, name):
        t = self.by.get(name.lower())
        if t is None:
            raise LabError("Global.not has no template %s" % name)
        return t

    def has(self, name):
        return name.lower() in self.by

    def prop(self, name, pid):
        seen = set()
        while name and name.lower() not in seen:
            seen.add(name.lower())
            t = self.by.get(name.lower())
            if t is None:
                return None
            v = t.get(pid)
            if v is not None:
                return v
            name = text(t.get(0x00))
        return None


class BaseCharacter:
    """One base character as this disc has it."""

    def __init__(self, source, key, templates=None):
        if key not in BASES:
            raise LabError("unknown base character %r" % key)
        self.key = key
        self.label, self.select_id, self.roster_index, self.type_id, stem, self.aura_index = BASES[key]
        self.source = source
        self.t = templates or Templates(source.entry("Misc/Global.not"))
        self.act, self.plr, self.alt = "act_" + stem, "plr_" + stem, "plr_alt" + stem
        for n in (self.act, self.plr, self.alt):
            self.t.get(n)
        record = D.read_record(source.dol, D.NORMAL_TABLE, self.roster_index)
        alt_record = D.read_record(source.dol, D.ALT_TABLE, self.roster_index)
        self.stats, self.alt_stats = record["stats"], alt_record["stats"]
        self.entity = record["name"]
        self.hud_name = self.entity[len("plr_"):].lower()
        model = text(self.t.prop(self.plr, P_MODEL))
        self.bundle = model.rsplit(".", 1)[0].lower()
        alt_model = text(self.t.prop(self.alt, P_MODEL))
        self.alt_bundle = alt_model.rsplit(".", 1)[0].lower()
        self.body_class = u32(self.t.prop(self.plr, P_SKELETONID)) or 0
        self.effect1 = text(self.t.prop(self.plr, P_EFFECT1))
        self.alt_effect1 = text(self.t.prop(self.alt, P_EFFECT1))
        self.abilities = u32(self.t.prop(self.plr, P_ABILITIES)) or 0
        self.description = text(self.t.prop(self.plr, P_DESCRIPTIONID))

    @property
    def body(self):
        return BODY_CLASSES.get(self.body_class, "male")

    def nvb_name(self):
        want = "misc/player_%s.nvb" % self.description.lower()
        for n in self.source.names("Misc/", ".nvb"):
            if n.lower() == want:
                return n
        raise LabError("no tuning file for %s" % self.description)

    def bundle_files(self, alt=False):
        b = "Bundles/" + (self.alt_bundle if alt else self.bundle)
        return tuple(self.source.entry(b + ext) for ext in (".ngm", ".ngt", ".tpl"))
