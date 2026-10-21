"""Patch a character into a copy of the game (from Doompatcher's doompatcher.py)."""
import os
import shutil

from ..formats import LabError, call, gshtool, ngmtool
from ..game import dol as D
from ..game import roster as R
from ..game.bigrepack import plan_repack, write_big
from ..game.disc import GC_DISC_SIZE, write_iso
from ..model import bundle, glb
from ..model.fit import Fit
from ..model.skeleton import Skeleton
from ..package.imperfect import image as read_image
from . import effects, portraits, shaders, templates, tuning, ui

LIFT_BITS = {"light": (0, 0x30), "medium": (0x10, 0x20), "heavy": (0x20, 0)}
WIRE = 0x80


class Result:
    def __init__(self):
        self.dol = None
        self.sets, self.adds = {}, {}
        self.notes = []


def hue_shift(im, degrees):
    from PIL import Image
    h, s, v = im.convert("RGB").convert("HSV").split()
    h = h.point(lambda x: int(x + degrees * 255 / 360) % 256)
    out = Image.merge("HSV", (h, s, v)).convert("RGBA")
    out.putalpha(im.getchannel("A"))
    return out


def color_int(color):
    return int(color.lstrip("#")[:6], 16)


def glow_rgba(color):
    c = color.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4)) + ((int(c[6:8], 16),) if len(c) == 8 else (110,))


class Builder:
    """Everything the character changes in the game, as bytes, before anything is written."""

    def __init__(self, source, character, progress=None):
        self.src, self.c = source, character
        self.progress = progress or (lambda stage, done=0, total=0: None)
        self.base = R.BaseCharacter(source, character.base)
        self.r = Result()

    def note(self, text):
        self.r.notes.append(text)

    def check_names(self):
        c, n = self.c, self.c.internal_name.lower()
        errors = [msg for level, msg in c.problems() if level == "error"]
        if errors:
            raise LabError("; ".join(errors))
        t = R.Templates(self.src.entry("Misc/Global.not"))
        for name in templates.template_names(c.internal_name):
            if t.has(name):
                raise LabError("the game already has a character template %s: pick another internal name" % name)
        for costume in ("", "_alt"):
            if self.src.has("Bundles/%s%s.ngm" % (n, costume)):
                raise LabError("the game already has a model bundle %s%s: pick another internal name" % (n, costume))
        if self.src.has("Misc/PLAYER_%s.nvb" % c.internal_name):
            raise LabError("the game already has a tuning file for %s: pick another internal name" % c.internal_name)
        hud = call(gshtool.read_gsh, self.src.entry("HUD/hudENG.1.gsh"))
        if "plr_" + n in hud.records or "plr_alt" + n in hud.records:
            raise LabError("the game already has HUD portraits named plr_%s: pick another internal name" % n)

    def build(self):
        self.check_names()
        c = self.c
        self.progress("Roster")
        self.r.dol = D.patch(self.src.dol, c.internal_name, c.display_name, c.stats["normal"], c.stats["alt"])
        self.progress("Model")
        materials = self.model()
        self.progress("Templates, materials and tuning")
        effect1, power = self.effects()
        description = self.tuning(power)
        self.templates(effect1, description)
        tex2 = self.texture2
        self.r.sets["Materials/Shaders/shaders.nsa"] = shaders.build(
            self.src.entry("Materials/Shaders/shaders.nsa"), materials, tex2)
        self.progress("Select screen, portraits and HUD")
        self.ui()
        self.r.adds = dict(list(self.ui_adds.items()) + list(self.bundle_adds.items()) + list(self.r.adds.items()))
        return self.r

    # model

    def material_images(self, model):
        c, out = self.c, []
        for m in c.materials:
            if not m.include:
                continue
            if m.texture:
                im = read_image(c.files[m.texture])
            else:
                idx = model.materials[m.gltf_material].image if m.gltf_material < len(model.materials) else None
                if idx is None:
                    raise LabError("material %s has no texture in the GLB: give it a PNG" % m.name)
                im = model.image(idx)
            if m.alt == "same":
                alt = im
            elif m.alt.startswith("hue:"):
                alt = hue_shift(im, float(m.alt[4:]))
            else:
                alt = read_image(c.files[m.alt])
            out.append((m, im, alt))
        return out

    def model(self):
        c, base = self.c, self.base
        model = glb.Model(c.glb)
        sk = Skeleton.of_base(base)
        f = Fit(model, sk, c.mapping, c.overrides, c.fit.get("scale"), c.fit.get("torso_squash", True), c.fit.get("flip"))
        included = [m for m in c.materials if m.include]
        slots = {m.gltf_material: (None, False) for m in c.materials}
        slots.update({m.gltf_material: (i, m.two_sided, m.bind) for i, m in enumerate(included)})
        for m in included:
            if m.bind is not None and m.bind >= len(sk.nodes):
                raise LabError("material %s is bound to game bone %d, which %s does not have" % (m.name, m.bind, base.label))
        tris = f.triangles(slots)
        images = self.material_images(model)
        normals = bundle.NormalIndex(bundle.read_normals(self.src.entry("Misc/NormalTable.ngn")))
        nsa = shaders.blocks(self.src.entry("Materials/Shaders/shaders.nsa"))
        self.texture2 = "ge_charlight"
        self.bundle_adds, all_materials = {}, []
        stats = bundle.Stats()
        for costume, alt in (("", False), ("_alt", True)):
            ngm, ngt, tpl = base.bundle_files(alt)
            head, models = call(ngmtool.read, ngm)
            render_base = models[0]
            replaced, kept_by_others = set(), set()
            for part in render_base.parts:
                keys = nsa.get(part.lower(), {})
                replaced.add(part.lower())
                replaced.update(keys.get(k, "").split()[0].lower() for k in ("texture", "texture2", "envmap") if keys.get(k))
                if not alt and keys.get("shader", "").split()[:1] == ["charlight"] and keys.get("texture2") and self.texture2 == "ge_charlight":
                    self.texture2 = keys["texture2"].split()[0]
            for m in models[1:]:
                for part in m.parts:
                    keys = nsa.get(part.lower(), {})
                    kept_by_others.add(part.lower())
                    kept_by_others.update(keys.get(k, "").split()[0].lower() for k in ("texture", "texture2", "envmap") if keys.get(k))
            names = ngt.decode("latin-1").split()
            keep = [n for n in names if n.lower() not in replaced or n.lower() in kept_by_others or n.lower() == self.texture2.lower()]
            extra = []
            if self.texture2.lower() not in {n.lower() for n in names}:
                from ..formats import gxtex
                jo_names = self.src.entry("Bundles/johnnyohm.ngt").decode("latin-1").split()
                jo_ims, _ = call(gxtex.read_tpl, self.src.entry("Bundles/johnnyohm.tpl"))
                extra = [(self.texture2, jo_ims[[n.lower() for n in jo_names].index(self.texture2.lower())])]
            mats = [c.internal_name + costume + m.suffix for m in included]
            all_materials += mats
            nm = templates.model_names(c.internal_name, costume)
            plr = base.alt if alt else base.plr
            renames = {}
            for pid, key in ((R.P_PHYSMODEL, "PHYSMODEL"), (R.P_SHADOWMODEL, "SHADOWMODEL")):
                old = R.text(base.t.prop(plr, pid))
                if old:
                    renames[old.lower()] = nm[key]
            render = bundle.render_model(render_base, {k: list(v) for k, v in tris.items()}, normals, nm["MODEL"], mats,
                                         render_base.meshes[0][5] if render_base.meshes else (0, 0, 0), stats)
            data, out = bundle.build_ngm(ngm, render, renames)
            missing = [old for old in renames if old not in {m.name.lower() for m in models[1:]}]
            if missing:
                self.note("the base bundle has no model named %s" % ", ".join(missing))
            textures = [(mat, im_alt if alt else im, m.size) for mat, (m, im, im_alt) in zip(mats, images)]
            tpl_out, ngt_out = bundle.build_tpl(tpl, ngt, textures, keep, extra)
            b = c.internal_name.lower() + costume
            for ext, d in (("ngm", data), ("ngt", ngt_out), ("tpl", tpl_out)):
                self.bundle_adds["Bundles/%s.%s" % (b, ext)] = d
            if not alt:
                st = render.streams[0]
                self.note("model: %d parts, %d positions, %d vertices, %d triangles; scale %.3f; .ngm %d bytes, .tpl %d bytes" % (
                    len(render.meshes), len(st.vertices), len(st.refs), len(render.indices) // 3, f.S, len(data), len(tpl_out)))
        if stats.clamped_uvs:
            self.note("warning: %d UVs were outside the range the game stores and were clamped" % stats.clamped_uvs)
        self.fit = f
        return all_materials

    # templates, effects and tuning

    def effects(self):
        c, base = self.c, self.base
        if c.aura.get("mode") != "tint":
            return None, None
        fx = effects.Effects(self.src.entry("Misc/game.nfx"))
        tun = tuning.Tuning(self.src, base)
        power_n = [tun.value(fid) for fid in tuning.POWER_EFFECTS]
        power_a = [tun.value(fid, 5) for fid in tuning.POWER_EFFECTS]
        roots_n = [r for r in [base.effect1] + power_n if fx.has(r)]
        roots_a = [r for r in [base.alt_effect1] + power_a if fx.has(r)]
        if not roots_n and not roots_a:
            raise LabError("%s has no effects to tint; use the Base or Swap aura" % base.label)
        prefix = c.internal_name[:8].lower()
        mn = fx.tinted(roots_n, c.aura["color"], prefix + "fx")
        ma = fx.tinted(roots_a, c.aura["alt_color"], prefix + "ax")
        self.r.sets["Misc/game.nfx"] = fx.build()
        self.note("aura tint: %d effect blocks copied, %d bytes of effect cache left" % (len(mn) + len(ma), fx.free()))
        pick = lambda m, name: m.get((name or "").lower(), name)
        effect1 = (pick(mn, base.effect1), pick(ma, base.alt_effect1)) if base.effect1 else None
        power = {}
        for fid, n, a in zip(tuning.POWER_EFFECTS, power_n, power_a):
            if (n or "").lower() in mn or (a or "").lower() in ma:
                power[fid] = (pick(mn, n), pick(ma, a))
        return effect1, power

    def tuning(self, power):
        c = self.c
        fields = {k: v for k, v in c.gameplay.items() if k in tuning.FIELDS or k == "damage_taken"}
        if not fields and not power:
            return None
        tun = tuning.Tuning(self.src, self.base)
        name, nvb, listed = tun.build(c.internal_name, fields, power)
        self.r.adds[name] = nvb
        self.r.sets["Misc/nvblist.txt"] = listed
        return c.internal_name

    def templates(self, effect1, description):
        c, base = self.c, self.base
        gp = c.gameplay
        on = off = 0
        if gp.get("lift"):
            a, b = LIFT_BITS[gp["lift"]]
            on, off = on | a, off | b
        if gp.get("wire_swing") is not None:
            if gp["wire_swing"]:
                on |= WIRE
            else:
                off |= WIRE
        mode = "swap" if c.aura.get("mode") == "swap" else "base"
        self.r.sets["Misc/Global.not"] = templates.build(
            self.src.entry("Misc/Global.not"), base, c.internal_name, mode, effect1, description,
            (on, off) if on or off else None, gp.get("health"))

    # UI

    def picture(self, slot):
        body = self.c.files.get("ui/%s.png" % slot)
        return read_image(body) if body else None

    def ui(self):
        c, base, src = self.c, self.base, self.src
        P = ui.P
        sets, adds = self.r.sets, {}
        voice = c.ui.get("ready_voice")
        if voice:
            values = ui.sfx_values(src.entry(P + "main.big"))
            if voice not in values:
                raise LabError("the game has no select-screen voice %s" % voice)
            voice = values[voice]
        sets[P + "screens/clashCharSelect.big"] = ui.patch_charselect(src.entry(P + "screens/clashCharSelect.big"), voice)
        tiles = [self.picture("tile"), self.picture("tile_selected")]
        if tiles[0] and not tiles[1]:
            tiles[1] = tiles[0]
        thumbs = src.entry(P + "screens/clashCharSelect_thumbs.big")
        sets[P + "screens/clashCharSelect_thumbs.big"] = ui.patch_thumbs(thumbs, base.select_id, tiles if tiles[0] else None)
        for name in ("main.big", "mainBE.big"):
            sets[P + name] = ui.patch_main(src.entry(P + name), c.display_name, color_int(c.name_color))
        self.hud()
        ready = self.picture("select_ready")
        if ready is None:
            for name, data in portraits.renamed(src, base.select_id).items():
                (sets if src.has(name) else adds)[name] = data
            self.note("no select-screen portrait: %s's portraits are used" % base.label)
        else:
            sets.update(self.select_portrait(ready))
            for alt in (False, True):
                name = portraits.archive_name("cvs", ui.NEW_ID, alt)
                (sets if src.has(name) else adds)[name] = portraits.loading_archive(src, self.strips(ready, alt), alt)
        self.ui_adds = adds

    def select_portrait(self, ready):
        c = self.c
        layout = portraits.SelectLayout(self.src)
        sel = c.ui.get("select", {})
        pictures = {"rest": self.picture("select_rest") or ready, "ready": ready,
                    "readyalt": self.picture("select_readyalt") or ready}
        default = sel.get("ready") or default_placement(ready)
        poses = {}
        for pose in portraits.POSES:
            p = sel.get(pose) or (default if pose != "rest" or self.picture("select_rest") is None else
                                  default_placement(pictures["rest"]))
            glow = p.get("glow")
            poses[pose] = (pictures[pose], p["scale"], p["anchor"], glow_rgba(glow) if glow else None)
        return {portraits.archive_name("c", ui.NEW_ID): layout.build(poses, c.ui.get("fade", portraits.FADE))}

    def strips(self, ready, alt):
        own = [self.picture(("load_wide_alt", "load_narrow_alt")[k] if alt else ("load_wide", "load_narrow")[k]) for k in (0, 1)]
        if alt and not all(own):
            own = [self.picture("load_wide"), self.picture("load_narrow")]
        sizes = portraits.strip_sizes(self.src, alt)
        if all(own) and [im.size for im in own] == sizes:
            return own
        sel = self.c.ui.get("select", {})
        p = sel.get("readyalt" if alt else "ready") or sel.get("ready") or default_placement(ready)
        pic = self.picture("select_readyalt") if alt and self.picture("select_readyalt") else ready
        scale = self.c.ui.get("strip_scale") or 3.0 * p["scale"]
        return portraits.strip_crop(self.src, pic, p["anchor"], scale, alt)

    def hud(self):
        c, base, src = self.c, self.base, self.src
        n, b = c.internal_name.lower(), base.hud_name
        icon, rage = self.picture("hud"), self.picture("hud_rage")
        icon_alt, rage_alt = self.picture("hud_alt"), self.picture("hud_alt_rage")
        new = {"plr_%s" % n: ("plr_%s" % b, icon), "plr_%s_rage" % n: ("plr_%s_rage" % b, rage or icon),
               "plr_alt%s" % n: ("plr_alt%s" % b, icon_alt or icon),
               "plr_alt%s_rage" % n: ("plr_alt%s_rage" % b, rage_alt or rage or icon_alt or icon)}
        images = {k: v for k, v in new.items() if v[1] is not None}
        copies = {k: v[0] for k, v in new.items() if v[1] is None}
        banner = self.picture("banner") if c.ui.get("banner", True) else None
        for lang in R.LANGS:
            name = "HUD/hud%s.1.gsh" % lang
            self.r.sets[name] = ui.add_bank_images(src.entry(name), images, copies)
            if banner is not None:
                name2 = "HUD/hud%s.2.gsh" % lang
                tmpl = "ovr_%s%s" % (b, lang)
                size = ui.bank_image_size(src.entry(name2), tmpl)
                if size is None:
                    self.note("no %s banner to copy for %s" % (lang, base.label))
                    continue
                im = banner if banner.size == size else fit_banner(banner, size)
                self.r.sets[name2] = ui.add_bank_images(src.entry(name2), {"ovr_%s%s" % (n, lang): (tmpl, im)})
        if copies:
            self.note("HUD portraits not supplied (%s): %s's are used" % (", ".join(sorted(copies)), base.label))


def default_placement(picture):
    """A first guess for a pose: the picture scaled to the READY canvas's height, its upper middle
    (where a face usually is) at the face point."""
    bbox = picture.getbbox() or (0, 0, picture.width, picture.height)
    scale = 330.0 / max(1, bbox[3] - bbox[1])
    return {"scale": scale, "anchor": [(bbox[0] + bbox[2]) / 2.0, bbox[1] + (bbox[3] - bbox[1]) * 0.12], "glow": None}


def fit_banner(im, size):
    from PIL import Image
    w, h = size
    k = min(w / im.width, h / im.height)
    small = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    out.paste(small, ((w - small.width) // 2, (h - small.height) // 2))
    return out


def patch(source, character, out, progress=None, overwrite=False):
    """Write a patched copy of source's disc to out; the source is only read. Returns the Result."""
    progress = progress or (lambda stage, done=0, total=0: None)
    out = os.path.abspath(out)
    if os.path.exists(out):
        if os.path.samefile(out, source.path):
            raise LabError("the output must be a new file, not the source disc")
        if not overwrite:
            raise LabError("%s exists" % out)
    if os.path.abspath(out) == os.path.abspath(source.path):
        raise LabError("the output must be a new file, not the source disc")
    folder = os.path.dirname(out) or "."
    if shutil.disk_usage(folder).free < GC_DISC_SIZE + (64 << 20):
        raise LabError("not enough free space in %s (a patched disc takes 1.4 GB)" % folder)
    if not source.is_verified():
        progress("Checking the source disc")
        source.verify(lambda done, total: progress("Checking the source disc", done, total))
    r = Builder(source, character, progress).build()
    plan, index, total, bh = plan_repack(source, r.sets, r.adds)
    part = out + ".part"
    big_total = sum(size for _, _, size in plan)
    written = [0]

    def big_progress(n):
        written[0] += n
        progress("Writing", written[0], big_total)

    try:
        progress("Writing", 0, big_total)
        write_iso(part, source.disc, r.dol, {
            "CLASH.BH": bh,
            "CLASH.BIG": lambda f: write_big(source, plan, index, total, f, big_progress),
        })
        os.replace(part, out)
    except BaseException:
        if os.path.exists(part):
            os.remove(part)
        raise
    return r


def report(character, result):
    lines = ["ImperfectLab patch report", "", "Character: %s (%s), base %s" % (
        character.display_name, character.internal_name, R.label(character.base)), ""]
    lines += ["main.dol: roster record 19, select-screen limits 18 -> 19"]
    lines += ["changed: %s (%d bytes)" % (k, len(v)) for k, v in sorted(result.sets.items())]
    lines += ["added:   %s (%d bytes)" % (k, len(v)) for k, v in sorted(result.adds.items())]
    lines += [""] + result.notes
    credits = character.credits or {}
    if credits.get("author") or credits.get("assets"):
        lines += ["", "Credits: %s" % credits.get("author", "")]
        lines += ["  %s by %s (%s) %s" % (a.get("what"), a.get("by"), a.get("license"), a.get("url")) for a in credits.get("assets", [])]
    return "\n".join(lines) + "\n"
