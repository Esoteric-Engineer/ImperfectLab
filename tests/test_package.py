import io
import json
import struct
import unittest
import zipfile

from imperfectlab.formats import LabError
from imperfectlab.model import glb
from imperfectlab.package import imperfect

from helpers import make_glb


def png_bytes(w=4, h=4, colour=(255, 0, 0, 255)):
    from PIL import Image
    return imperfect.png(Image.new("RGBA", (w, h), colour))


def character():
    c = imperfect.Character()
    c.internal_name, c.display_name, c.base = "TestHero", "TEST HERO", "wolverine"
    c.glb = make_glb()
    c.materials = [imperfect.Material(0, "skin", True, "", (64, 64), False, "textures/skin.png", "hue:120")]
    c.files = {"textures/skin.png": png_bytes(), "ui/hud.png": png_bytes(64, 64)}
    c.mapping = {1: "mixamorig:Hips"}
    c.overrides = {"mixamorig:LeftHandMiddle1": 48}
    c.stats = {"normal": [1, 2, 3, 4, 5, 6], "alt": [7, 6, 5, 4, 3, 2]}
    c.gameplay = {"damage_taken": 0.8, "lift": "heavy", "wire_swing": True, "rage_duration": 15000}
    c.aura = {"mode": "tint", "colour": "#112233", "alt_colour": "#445566"}
    c.ui["select"] = {"ready": {"scale": 0.5, "anchor": [10, 20], "glow": "#11223344"}}
    c.credits = {"author": "me", "description": "a test", "assets": [{"what": "model", "by": "me", "licence": "CC0", "url": ""}]}
    return c


def archive(members):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, body in members.items():
            z.writestr(name, body)
    return out.getvalue()


def with_manifest(files, edit=None):
    c = character()
    m = c.manifest()
    m["files"] = {}
    import hashlib
    for name, body in files.items():
        m["files"][name] = hashlib.sha256(body).hexdigest()
    if edit:
        edit(m)
    return archive(dict(files, **{"manifest.json": json.dumps(m)}))


class RoundTrip(unittest.TestCase):

    def test_round_trip(self):
        c = character()
        data = imperfect.save(c)
        d = imperfect.load(data)
        self.assertEqual(d.manifest(), c.manifest())
        self.assertEqual(imperfect.save(d), data)

    def test_problems(self):
        c = character()
        self.assertEqual([p for p in c.problems() if p[0] == "error"], [])
        c.internal_name = "Has Space"
        c.display_name = "lower case"
        msgs = " ".join(m for _, m in c.problems())
        self.assertIn("internal name", msgs)
        self.assertIn("display name", msgs)

    def test_slim_glb(self):
        raw = make_glb(image=png_bytes())
        slim = imperfect.slim_glb(raw, keep_images=())
        a, b = glb.Model(raw), glb.Model(slim)
        self.assertEqual(a.joint_names(), b.joint_names())
        self.assertEqual([p.pos for p in a.prims], [p.pos for p in b.prims])
        self.assertIsNotNone(a.materials[0].image)
        self.assertIsNone(b.materials[0].image)
        self.assertLess(len(slim), len(raw))


class Hostile(unittest.TestCase):

    def files(self):
        return {"model/model.glb": make_glb(), "textures/skin.png": png_bytes(), "ui/hud.png": png_bytes(64, 64)}

    def assertRejected(self, data, text=""):
        with self.assertRaises(LabError) as cm:
            imperfect.load(data)
        self.assertIn(text, str(cm.exception))

    def test_ok(self):
        imperfect.load(with_manifest(self.files()))

    def test_traversal(self):
        for name in ("../evil.png", "/abs.png", "ui\\hud.png", "textures/../../x.png", "scripts/run.py", "textures/x.exe"):
            data = archive({"manifest.json": "{}", name: b"x"})
            self.assertRejected(data, "unexpected member")

    def test_not_zip(self):
        self.assertRejected(b"not a zip", "not a .imperfect")

    def test_bad_hash(self):
        files = self.files()
        data = with_manifest(files, lambda m: m["files"].__setitem__("ui/hud.png", "0" * 64))
        self.assertRejected(data, "damaged")

    def test_unlisted_member(self):
        files = self.files()
        data = with_manifest(files, lambda m: m["files"].pop("ui/hud.png"))
        self.assertRejected(data, "file list")

    def test_fake_png(self):
        files = dict(self.files(), **{"ui/hud.png": b"GIF89a" + bytes(30)})
        self.assertRejected(with_manifest(files), "not a PNG")

    def test_huge_png(self):
        body = bytearray(png_bytes())
        struct.pack_into(">II", body, 16, 5000, 5000)
        files = dict(self.files(), **{"ui/hud.png": bytes(body)})
        self.assertRejected(with_manifest(files), "larger than")

    def test_bomb(self):
        files = dict(self.files(), **{"ui/banner.png": b"\x89PNG\r\n\x1a\n" + bytes(4 << 20)})
        self.assertRejected(with_manifest(files), "compresses")

    def test_bad_json(self):
        data = archive({"manifest.json": b"{not json"})
        self.assertRejected(data, "not valid JSON")

    def test_unknown_key(self):
        self.assertRejected(with_manifest(self.files(), lambda m: m.__setitem__("run", "rm -rf /")), "unknown key")

    def test_newer_version(self):
        self.assertRejected(with_manifest(self.files(), lambda m: m.__setitem__("version", 99)), "newer ImperfectLab")

    def test_bad_values(self):
        cases = [
            lambda m: m["character"].__setitem__("internal_name", "../../x"),
            lambda m: m["character"].__setitem__("display_name", "x" * 40),
            lambda m: m.__setitem__("base", "galactus"),
            lambda m: m["stats"]["display"].__setitem__("normal", [9, 9, 9, 9, 9, 9]),
            lambda m: m["stats"]["gameplay"].__setitem__("damage_taken", "lots"),
            lambda m: m["model"]["materials"][0].__setitem__("size", [300, 300]),
            lambda m: m["model"]["materials"][0].__setitem__("texture", "../../etc/passwd"),
            lambda m: m["aura"].__setitem__("mode", "rainbow"),
            lambda m: m["model"].__setitem__("mapping", {"pelvis": "x"}),
        ]
        for edit in cases:
            with self.subTest():
                self.assertRejected(with_manifest(self.files(), edit))


if __name__ == "__main__":
    unittest.main()
