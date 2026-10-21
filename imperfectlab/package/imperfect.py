""".imperfect files: a character as a recipe plus the author's own assets (docs/FORMAT.md).

A file holds no game data: the base character is a name, and everything taken from the game is read
from the user's own disc when the character is patched in.
"""
import copy
import hashlib
import io
import json
import re
import struct
import zipfile

from .. import __version__
from ..formats import LabError
from ..game import roster

FORMAT = "imperfect"
VERSION = 1
GAME = "GVLE69-0"
MAX_TOTAL = 64 << 20
MAX_RATIO = 200
MAX_IMAGE_SIDE = 4096
STAT_RANGE = (1, 7)

UI_SLOTS = ("select_rest", "select_ready", "select_readyalt", "load_wide", "load_narrow", "load_wide_alt",
            "load_narrow_alt", "tile", "tile_selected", "hud", "hud_rage", "hud_alt", "hud_alt_rage", "banner")
MEMBER = re.compile(r"^(manifest\.json|model/model\.glb|textures/[A-Za-z0-9_-]{1,48}\.png|ui/(%s)\.png)$" % "|".join(UI_SLOTS))
INTERNAL = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,9}$")
DISPLAY = re.compile(r"^[A-Z0-9 .'&!-]{1,16}$")
SUFFIX = re.compile(r"^(_[A-Za-z0-9]{1,7})?$")
COLOR = re.compile(r"^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$")
AURA_MODES = ("base", "swap", "tint")
LIFT = ("light", "medium", "heavy")
GAMEPLAY = {"damage_taken": (0.1, 3.0), "health": (10, 1000), "run_speed": (1.0, 30.0),
            "sprint_speed": (1.0, 40.0), "rage_per_super": (0.0, 100.0), "rage_duration": (1000, 120000)}
POSES = ("rest", "ready", "readyalt")


def default_stats():
    return {"normal": [4] * 6, "alt": [4] * 6}


class Material:
    def __init__(self, gltf_material, name, include=True, suffix="", size=(256, 256), two_sided=False,
                 texture=None, alt="same", bind=None):
        self.gltf_material, self.name, self.include, self.suffix = gltf_material, name, include, suffix
        self.size, self.two_sided, self.texture, self.alt = tuple(size), two_sided, texture, alt
        self.bind = bind

    def to_json(self):
        return {"gltf_material": self.gltf_material, "name": self.name, "include": self.include,
                "suffix": self.suffix, "size": list(self.size), "two_sided": self.two_sided,
                "texture": self.texture, "alt": self.alt, "bind": self.bind}


class Character:
    """The in-memory project: what the GUI edits and what a .imperfect file stores."""

    def __init__(self):
        self.internal_name = "NewHero"
        self.display_name = "NEW HERO"
        self.name_color = "#FFFFFF"
        self.base = "johnnyohm"
        self.credits = {"author": "", "description": "", "assets": []}
        self.glb = None
        self.mapping = {}
        self.overrides = {}
        self.fit = {"scale": None, "torso_squash": True, "flip": None}
        self.materials = []
        self.aura = {"mode": "base", "color": "#40A0FF", "alt_color": "#50FF50"}
        self.stats = default_stats()
        self.gameplay = {}
        self.ui = {"select": {}, "fade": 36, "strip_scale": None, "ready_voice": None, "banner": True}
        self.files = {}

    def copy(self):
        return copy.deepcopy(self)

    def texture_member(self, name):
        return "textures/%s.png" % name

    def manifest(self):
        files = dict(self.files)
        if self.glb is not None:
            files["model/model.glb"] = self.glb
        return {
            "format": FORMAT, "version": VERSION, "game": GAME, "generator": "ImperfectLab %s" % __version__,
            "character": {"internal_name": self.internal_name, "display_name": self.display_name, "name_color": self.name_color},
            "base": self.base,
            "credits": self.credits,
            "model": {"mapping": {str(k): v for k, v in sorted(self.mapping.items())},
                      "overrides": dict(sorted(self.overrides.items())), "fit": self.fit,
                      "materials": [m.to_json() for m in self.materials]},
            "aura": self.aura,
            "stats": {"display": self.stats, "gameplay": self.gameplay},
            "ui": self.ui,
            "moves": {},
            "files": {k: hashlib.sha256(v).hexdigest() for k, v in sorted(files.items())},
        }

    def problems(self):
        """[(level, message)] that need no game disc to find."""
        out = []
        if not INTERNAL.match(self.internal_name or ""):
            out.append(("error", "the internal name must be 1-10 letters and digits, starting with a letter"))
        if not DISPLAY.match(self.display_name or ""):
            out.append(("error", "the display name must be 1-16 characters: A-Z, 0-9, space and . ' & ! -"))
        if self.base not in roster.BASES:
            out.append(("error", "pick a base character"))
        if self.glb is None:
            out.append(("error", "import a model (.glb)"))
        if not any(m.include for m in self.materials) and self.glb is not None:
            out.append(("error", "every material is excluded: nothing would be drawn"))
        suffixes = [m.suffix for m in self.materials if m.include]
        if len(set(suffixes)) != len(suffixes):
            out.append(("error", "two materials have the same game name suffix"))
        for m in self.materials:
            if m.texture and m.texture not in self.files:
                out.append(("error", "the texture of %s is missing" % m.name))
        if not self.files.get("ui/select_ready.png"):
            out.append(("warning", "no select-screen portrait: the base's portraits are used"))
        return out


# reading

def _type(v, kind, what):
    if not isinstance(v, kind) or isinstance(v, bool) and kind in (int, float):
        raise LabError("manifest: %s has the wrong type" % what)
    return v


def _str(v, what, limit=200, pattern=None, optional=False):
    if v is None and optional:
        return None
    _type(v, str, what)
    if len(v) > limit or pattern and not pattern.match(v):
        raise LabError("manifest: %s is not valid" % what)
    return v


def _num(v, what, lo, hi, optional=True, integer=False):
    if v is None and optional:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or integer and not isinstance(v, int):
        raise LabError("manifest: %s must be a number" % what)
    if not lo <= v <= hi:
        raise LabError("manifest: %s must be from %g to %g" % (what, lo, hi))
    return v


def _keys(d, allowed, what):
    _type(d, dict, what)
    extra = set(d) - set(allowed)
    if extra:
        raise LabError("manifest: unknown key(s) in %s: %s" % (what, ", ".join(sorted(extra))))
    return d


def _color(v, what):
    return _str(v, what, 9, COLOR)


def upgrade(m):
    v = m.get("version")
    if not isinstance(v, int) or v < 1:
        raise LabError("not a valid .imperfect file (no version)")
    if v > VERSION:
        raise LabError("this file needs a newer ImperfectLab (format version %d; this one reads %d)" % (v, VERSION))
    return m


def from_manifest(m, files):
    _keys(m, ("format", "version", "game", "generator", "character", "base", "credits", "model", "aura", "stats",
              "ui", "moves", "files"), "the manifest")
    if m.get("format") != FORMAT:
        raise LabError("not a .imperfect file")
    m = upgrade(m)
    if m.get("game") != GAME:
        raise LabError("this file is for %s, not %s" % (m.get("game"), GAME))
    c = Character()
    ch = _keys(m.get("character"), ("internal_name", "display_name", "name_color"), "character")
    c.internal_name = _str(ch.get("internal_name"), "internal_name", 10, INTERNAL)
    c.display_name = _str(ch.get("display_name"), "display_name", 16, DISPLAY)
    c.name_color = _color(ch.get("name_color", "#FFFFFF"), "name_color")
    c.base = _str(m.get("base"), "base", 20)
    if c.base not in roster.BASES:
        raise LabError("manifest: unknown base character %r" % c.base)
    cr = _keys(m.get("credits", {}), ("author", "description", "assets"), "credits")
    assets = _type(cr.get("assets", []), list, "credits.assets")[:32]
    c.credits = {"author": _str(cr.get("author", ""), "credits.author", 200),
                 "description": _str(cr.get("description", ""), "credits.description", 4000),
                 "assets": [{k: _str(a.get(k, ""), "credits.assets", 500) for k in ("what", "by", "license", "url")}
                            for a in assets if isinstance(_keys(a, ("what", "by", "license", "url"), "credits.assets"), dict)]}
    mo = _keys(m.get("model", {}), ("mapping", "overrides", "fit", "materials"), "model")
    mapping = _type(mo.get("mapping", {}), dict, "model.mapping")
    if len(mapping) > 256:
        raise LabError("manifest: the mapping is too long")
    c.mapping = {}
    for k, v in mapping.items():
        if not re.match(r"^\d{1,3}$", k):
            raise LabError("manifest: model.mapping keys are game bone numbers")
        c.mapping[int(k)] = _str(v, "model.mapping", 200)
    overrides = _type(mo.get("overrides", {}), dict, "model.overrides")
    if len(overrides) > 512:
        raise LabError("manifest: too many overrides")
    c.overrides = {_str(k, "model.overrides", 200): _num(v, "model.overrides", 0, 255, integer=True)
                   for k, v in overrides.items()}
    fit = _keys(mo.get("fit", {}), ("scale", "torso_squash", "flip"), "model.fit")
    c.fit = {"scale": _num(fit.get("scale"), "fit.scale", 0.0001, 10000.0),
             "torso_squash": bool(_type(fit.get("torso_squash", True), bool, "fit.torso_squash")),
             "flip": fit.get("flip") if isinstance(fit.get("flip"), bool) else None}
    mats = _type(mo.get("materials", []), list, "model.materials")
    if len(mats) > 16:
        raise LabError("manifest: at most 16 materials")
    c.materials = []
    for d in mats:
        _keys(d, ("gltf_material", "name", "include", "suffix", "size", "two_sided", "texture", "alt", "bind"), "a material")
        size = _type(d.get("size", [256, 256]), list, "material size")
        if len(size) != 2 or any(_num(s, "material size", 8, 1024, False, True) & (s - 1) for s in size):
            raise LabError("manifest: material sizes are powers of two from 8 to 1024")
        tex = _str(d.get("texture"), "material texture", 80, MEMBER, optional=True)
        alt = _str(d.get("alt", "same"), "material alt", 80)
        if alt != "same" and not alt.startswith("hue:") and not MEMBER.match(alt):
            raise LabError("manifest: a material's alt texture is not valid")
        if alt.startswith("hue:"):
            _num(float(alt[4:]) if re.match(r"^hue:-?\d{1,3}(\.\d+)?$", alt) else None, "alt hue", -360, 360, False)
        c.materials.append(Material(_num(d.get("gltf_material"), "gltf_material", 0, 255, False, True),
                                    _str(d.get("name", ""), "material name", 100), bool(d.get("include", True)),
                                    _str(d.get("suffix", ""), "material suffix", 8, SUFFIX), size,
                                    bool(d.get("two_sided", False)), tex, alt,
                                    _num(d.get("bind"), "material bind", 0, 255, integer=True)))
    au = _keys(m.get("aura", {}), ("mode", "color", "alt_color"), "aura")
    c.aura = {"mode": _str(au.get("mode", "base"), "aura.mode", 8), "color": _color(au.get("color", "#40A0FF"), "aura.color"),
              "alt_color": _color(au.get("alt_color", "#50FF50"), "aura.alt_color")}
    if c.aura["mode"] not in AURA_MODES:
        raise LabError("manifest: unknown aura mode")
    st = _keys(m.get("stats", {}), ("display", "gameplay"), "stats")
    disp = _keys(st.get("display", default_stats()), ("normal", "alt"), "stats.display")
    c.stats = {}
    for k in ("normal", "alt"):
        v = _type(disp.get(k), list, "stats.display")
        if len(v) != 6:
            raise LabError("manifest: six display stats per costume")
        c.stats[k] = [_num(x, "a display stat", STAT_RANGE[0], STAT_RANGE[1], False, True) for x in v]
    gp = _keys(st.get("gameplay", {}), tuple(GAMEPLAY) + ("lift", "wire_swing"), "stats.gameplay")
    c.gameplay = {}
    for k, (lo, hi) in GAMEPLAY.items():
        if gp.get(k) is not None:
            c.gameplay[k] = _num(gp[k], k, lo, hi, integer=isinstance(lo, int))
    if gp.get("lift") is not None:
        if gp["lift"] not in LIFT:
            raise LabError("manifest: lift is light, medium or heavy")
        c.gameplay["lift"] = gp["lift"]
    if gp.get("wire_swing") is not None:
        c.gameplay["wire_swing"] = bool(_type(gp["wire_swing"], bool, "wire_swing"))
    ui = _keys(m.get("ui", {}), ("select", "fade", "strip_scale", "ready_voice", "banner"), "ui")
    sel = _keys(ui.get("select", {}), POSES, "ui.select")
    c.ui = {"select": {}, "fade": _num(ui.get("fade", 36), "ui.fade", 0, 256, False, True),
            "strip_scale": _num(ui.get("strip_scale"), "ui.strip_scale", 0.01, 50.0),
            "ready_voice": _str(ui.get("ready_voice"), "ui.ready_voice", 40, re.compile(r"^FE_SFX_[A-Z0-9_]+$"), True),
            "banner": bool(ui.get("banner", True))}
    for pose, p in sel.items():
        _keys(p, ("scale", "anchor", "glow"), "ui.select." + pose)
        anchor = _type(p.get("anchor"), list, "anchor")
        if len(anchor) != 2:
            raise LabError("manifest: an anchor is two numbers")
        c.ui["select"][pose] = {"scale": _num(p.get("scale"), "scale", 0.001, 100.0, False),
                                "anchor": [_num(a, "anchor", -8192, 8192, False) for a in anchor],
                                "glow": _color(p["glow"], "glow") if p.get("glow") else None}
    _type(m.get("moves", {}), dict, "moves")
    c.glb = files.pop("model/model.glb", None)
    c.files = files
    return c


def load(data):
    """A Character from .imperfect bytes, checked as if the file were hostile."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise LabError("not a .imperfect file (not a ZIP archive)") from None
    infos = z.infolist()
    if len(infos) > 64:
        raise LabError("the file has too many members")
    total = 0
    for info in infos:
        name = info.filename
        if info.is_dir() or "\\" in name or name.startswith("/") or ".." in name.split("/") or not MEMBER.match(name):
            raise LabError("the file contains an unexpected member: %r" % name[:80])
        total += info.file_size
        if total > MAX_TOTAL:
            raise LabError("the file is too large once unpacked")
        if info.file_size > (1 << 20) and info.file_size > MAX_RATIO * max(info.compress_size, 1):
            raise LabError("a member compresses suspiciously well: %s" % name)
    names = [i.filename for i in infos]
    if len(set(names)) != len(names):
        raise LabError("the file has duplicate members")
    if "manifest.json" not in names:
        raise LabError("the file has no manifest.json")
    raw = {}
    for info in infos:
        with z.open(info) as f:
            body = f.read(info.file_size + 1)
        if len(body) != info.file_size:
            raise LabError("a member's size does not match the archive's directory")
        raw[info.filename] = body
    try:
        m = json.loads(raw.pop("manifest.json").decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise LabError("manifest.json is not valid JSON") from None
    if not isinstance(m, dict):
        raise LabError("manifest.json is not an object")
    hashes = _type(m.get("files", {}), dict, "files")
    if set(hashes) != set(raw):
        raise LabError("the manifest's file list does not match the archive")
    for name, body in raw.items():
        if hashlib.sha256(body).hexdigest() != hashes[name]:
            raise LabError("%s is damaged (its checksum does not match)" % name)
        check_member(name, body)
    return from_manifest(m, raw)


def check_member(name, body):
    if name.endswith(".png"):
        if body[:8] != b"\x89PNG\r\n\x1a\n":
            raise LabError("%s is not a PNG image" % name)
        w, h = struct.unpack(">II", body[16:24]) if len(body) >= 24 else (0, 0)
        if not (0 < w <= MAX_IMAGE_SIDE and 0 < h <= MAX_IMAGE_SIDE):
            raise LabError("%s is larger than %d pixels a side" % (name, MAX_IMAGE_SIDE))
    elif name.endswith(".glb"):
        if body[:4] != b"glTF" or len(body) < 20:
            raise LabError("%s is not a GLB model" % name)


def image(body):
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_SIDE * MAX_IMAGE_SIDE
    try:
        im = Image.open(io.BytesIO(body))
        if max(im.size) > MAX_IMAGE_SIDE:
            raise LabError("an image is larger than %d pixels a side" % MAX_IMAGE_SIDE)
        return im.convert("RGBA")
    except LabError:
        raise
    except Exception as e:
        raise LabError("an image could not be read: %s" % e) from None


def png(im):
    out = io.BytesIO()
    im.save(out, "PNG", optimize=True)
    return out.getvalue()


def save(character):
    """.imperfect bytes. The same content always gives the same bytes."""
    m = character.manifest()
    files = dict(character.files)
    if character.glb is not None:
        files["model/model.glb"] = character.glb
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, body in [("manifest.json", json.dumps(m, indent=1, sort_keys=True).encode("utf-8"))] + sorted(files.items()):
            if not MEMBER.match(name):
                raise LabError("cannot store %s in a .imperfect file" % name)
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, body)
    return out.getvalue()


def slim_glb(data, keep_images):
    """The GLB without animations, without material textures other than the base color, and with only
    the images in keep_images; the binary chunk keeps only what is still referenced."""
    from ..formats import gltf
    g = gltf.GLB(data)
    j = copy.deepcopy(g.j)
    j.pop("animations", None)
    tex_keys = ("normalTexture", "occlusionTexture", "emissiveTexture")
    for mat in j.get("materials", []):
        for k in tex_keys:
            mat.pop(k, None)
        mat.get("pbrMetallicRoughness", {}).pop("metallicRoughnessTexture", None)
        sg = mat.get("extensions", {}).get("KHR_materials_pbrSpecularGlossiness")
        if sg:
            sg.pop("specularGlossinessTexture", None)
    keep_images = set(keep_images)
    used_tex = set()
    for mat in j.get("materials", []):
        for t in (mat.get("pbrMetallicRoughness", {}).get("baseColorTexture"),
                  mat.get("extensions", {}).get("KHR_materials_pbrSpecularGlossiness", {}).get("diffuseTexture")):
            if t is not None:
                if j["textures"][t["index"]].get("source") in keep_images:
                    used_tex.add(t["index"])
                else:
                    mat.get("pbrMetallicRoughness", {}).pop("baseColorTexture", None)
                    mat.get("extensions", {}).get("KHR_materials_pbrSpecularGlossiness", {}).pop("diffuseTexture", None)
    tex_map = {old: new for new, old in enumerate(sorted(used_tex))}
    img_map = {old: new for new, old in enumerate(sorted({j["textures"][t].get("source") for t in used_tex} - {None}))}
    j["textures"] = [dict(j["textures"][t], source=img_map.get(j["textures"][t].get("source"))) for t in sorted(used_tex)]
    j["images"] = [j["images"][i] for i in sorted(img_map)]
    for mat in j.get("materials", []):
        for t in (mat.get("pbrMetallicRoughness", {}).get("baseColorTexture"),
                  mat.get("extensions", {}).get("KHR_materials_pbrSpecularGlossiness", {}).get("diffuseTexture")):
            if t is not None:
                t["index"] = tex_map[t["index"]]
    for k in ("textures", "images"):
        if not j[k]:
            j.pop(k)
    used_acc = set()
    for mesh in j.get("meshes", []):
        for p in mesh["primitives"]:
            used_acc.update(p["attributes"].values())
            if "indices" in p:
                used_acc.add(p["indices"])
            p.pop("targets", None)
    for sk in j.get("skins", []):
        if "inverseBindMatrices" in sk:
            used_acc.add(sk["inverseBindMatrices"])
    acc_map = {old: new for new, old in enumerate(sorted(used_acc))}
    accessors = [j["accessors"][i] for i in sorted(used_acc)]
    views = sorted({a["bufferView"] for a in accessors if "bufferView" in a} |
                   {im["bufferView"] for im in j.get("images", []) if "bufferView" in im})
    view_map = {old: new for new, old in enumerate(views)}
    blob, new_views = bytearray(), []
    for v in views:
        bv = dict(j["bufferViews"][v])
        while len(blob) % 4:
            blob.append(0)
        chunk = g.bin[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
        bv["byteOffset"] = len(blob)
        bv["buffer"] = 0
        blob += chunk
        new_views.append(bv)
    for a in accessors:
        if "bufferView" in a:
            a["bufferView"] = view_map[a["bufferView"]]
    for im in j.get("images", []):
        if "bufferView" in im:
            im["bufferView"] = view_map[im["bufferView"]]
    for mesh in j.get("meshes", []):
        for p in mesh["primitives"]:
            p["attributes"] = {k: acc_map[v] for k, v in p["attributes"].items()}
            if "indices" in p:
                p["indices"] = acc_map[p["indices"]]
    for sk in j.get("skins", []):
        if "inverseBindMatrices" in sk:
            sk["inverseBindMatrices"] = acc_map[sk["inverseBindMatrices"]]
    j["accessors"], j["bufferViews"] = accessors, new_views
    while len(blob) % 4:
        blob.append(0)
    j["buffers"] = [{"byteLength": len(blob)}]
    js = json.dumps(j, separators=(",", ":")).encode("utf-8")
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    return (struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js +
            struct.pack("<I4s", len(blob), b"BIN\0") + bytes(blob))
