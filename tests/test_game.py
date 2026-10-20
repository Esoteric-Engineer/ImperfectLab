import os
import subprocess
import sys
import unittest

from imperfectlab.build import effects, templates, tuning
from imperfectlab.build.patch import Builder
from imperfectlab.formats import LabError, nfxtool, nvbtool
from imperfectlab.game import dol as D
from imperfectlab.game import roster as R
from imperfectlab.model.skeleton import Skeleton
from imperfectlab.package import imperfect

from helpers import ISO, MNROI, make_glb
from test_package import png_bytes

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOOM_EDITS = [(0x4C7AC0, b"plr_doctordoom"), (0x4C7AE0, b"DOCTOR DOOM"), (0x4C7B00, bytes([7, 4, 3, 6, 5, 4, 0, 0])),
              (0x4C80B0, b"plr_altDoctordoom"), (0x4C8148, b"\0\0\0\x13")]


def main_dol():
    if MNROI:
        path = os.path.join(MNROI, "orig", "GVLE69", "sys", "main.dol")
        if os.path.exists(path):
            with open(path, "rb") as f:
                return f.read()
    if ISO:
        from imperfectlab.game.source import GameSource
        src = GameSource(ISO)
        src.close()
        return src.dol
    return None


class Dol(unittest.TestCase):

    def setUp(self):
        self.dol = main_dol()
        if self.dol is None:
            self.skipTest("set IMPERFECTLAB_MNROI or IMPERFECTLAB_ISO")

    def test_doom_record(self):
        out = D.patch(self.dol, "DoctorDoom", "DOCTOR DOOM", [7, 4, 3, 6, 5, 4], [7, 4, 3, 6, 5, 4])
        self.assertEqual(len(out), len(self.dol))
        for off, want in DOOM_EDITS:
            self.assertEqual(out[off:off + len(want)], want)
        self.assertEqual(sum(a != b for a, b in zip(out, self.dol)), sum(a != b for a, b in zip(
            D.patch(self.dol, "DoctorDoom", "DOCTOR DOOM", [7, 4, 3, 6, 5, 4], [7, 4, 3, 6, 5, 4]), self.dol)))

    def test_refuses_patched(self):
        out = D.patch(self.dol, "A", "B", [1] * 6, [1] * 6)
        with self.assertRaises(LabError):
            D.patch(out, "A", "B", [1] * 6, [1] * 6)

    def test_bases(self):
        for key in R.keys():
            rec = D.read_record(self.dol, D.NORMAL_TABLE, R.BASES[key][2])
            self.assertTrue(rec["name"].lower().startswith("plr_"), key)


@unittest.skipUnless(ISO, "IMPERFECTLAB_ISO is not set")
class Game(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        from imperfectlab.game.source import GameSource
        cls.src = GameSource(ISO)

    @classmethod
    def tearDownClass(cls):
        cls.src.close()

    def test_all_bases_load(self):
        t = R.Templates(self.src.entry("Misc/Global.not"))
        for key in R.keys():
            b = R.BaseCharacter(self.src, key, t)
            self.assertTrue(self.src.has("Bundles/%s.ngm" % b.bundle), key)
            self.assertTrue(self.src.has(b.nvb_name()), key)
            sk = Skeleton.of_base(b)
            self.assertTrue(all(sk.node(r) is not None for r in sk.required_roles()), key)
            self.assertEqual(len(sk.nodes), {"thing": 66, "wolverine": 72, "storm": 81, "defcon": 97}.get(key, len(sk.nodes)))

    def test_translate_between_classes(self):
        from imperfectlab.model import mapping
        male = Skeleton.of_base(R.BaseCharacter(self.src, "johnnyohm"))
        for key in ("storm", "thing"):
            other = Skeleton.of_base(R.BaseCharacter(self.src, key))
            m, o = mapping.translate({male.node("L.hand"): "hand", 39: "club"}, {"mid": male.node("L.finger_a.0")}, male, other)
            self.assertEqual(m, {other.node("L.hand"): "hand"})
            self.assertEqual(o, {"mid": other.node("L.finger_a.0")})

    def test_voice(self):
        from imperfectlab.build import ui
        values = ui.sfx_values(self.src.entry(ui.P + "main.big"))
        self.assertEqual(len([k for k in R.VOICES.values() if k in values]), 18)
        files, d, apt = ui.open_movie(ui.patch_charselect(self.src.entry(ui.P + "screens/clashCharSelect.big"), values["FE_SFX_OHM"]))
        block = apt.frame_actions(apt.apt_off, 0)[0]
        pool = apt.pool(block)
        pushes = [[apt.const_value(i, pool) for i in apt.get_push(at)] for at, op in apt.walk(block) if op == 0x96]
        self.assertIn(["g_aCharacterAudio", values["FE_SFX_OHM"], "_global"], pushes)

    def test_tint_roots(self):
        jo = effects.tint_roots(self.src, R.BaseCharacter(self.src, "johnnyohm"))
        thing = effects.tint_roots(self.src, R.BaseCharacter(self.src, "thing"))
        self.assertIn("jOhmStand", jo[0])
        self.assertEqual((thing[0], thing[1]), ([], []))

    def test_template_swap(self):
        base = R.BaseCharacter(self.src, "johnnyohm")
        t = R.Templates(templates.build(self.src.entry("Misc/Global.not"), base, "Tester", "swap"))
        self.assertEqual(R.text(t.prop("plr_Tester", R.P_CASTID)), "ALT_JOHNNYOHM")
        self.assertEqual(R.text(t.prop("plr_altTester", R.P_CASTID)), "JOHNNYOHM")
        self.assertEqual(R.text(t.prop("plr_altTester", R.P_MODEL)), "Tester_alt.nod")

    def test_tuning_keeps_spread(self):
        base = R.BaseCharacter(self.src, "johnnyohm")
        tun = tuning.Tuning(self.src, base)
        name, data, listed = tun.build("Tester", {"damage_taken": 0.4, "run_speed": 13.9})
        nvb = nvbtool.parse_nvb(data)
        self.assertEqual(name, "Misc/PLAYER_Tester.nvb")
        self.assertEqual(nvb.name, "Tester")
        fields = nvbtool.parse_ndb(self.src.entry("Misc/defaults.ndb")).fields("PLAYER")
        slots = lambda fid: [float(nvbtool.fmt(fields[fid][0], v)) for v in nvb.slots(fid, fields[fid][1])]
        self.assertAlmostEqual(slots(104)[0], 13.9, places=4)
        taken = [1 - x for x in slots(134)]
        self.assertAlmostEqual(taken[0], 0.4, places=4)
        self.assertLess(taken[3], taken[0])
        self.assertTrue(listed.endswith(b"PLAYER Tester\r\n"))

    def test_tint(self):
        fx = effects.Effects(self.src.entry("Misc/game.nfx"))
        names = fx.tinted(["jOhmStand"], "#FF2020", "testfx")
        self.assertEqual(len(names), 7)
        data = fx.build()
        items = nfxtool.read_nfx(data)
        problems, _ = nfxtool.problems(items)
        self.assertFalse([p for p in problems if "cache:" in p or "records" in p])
        copy = next(b for b in nfxtool.blocks(items) if b.name == names["johmarc"])
        cols = [r.value for r in copy.records()[0] if nfxtool.KEYS[r.key] in ("startcol", "endcol")]
        self.assertTrue(cols and all((c >> 16) & 255 > (c & 255) for c in cols))

    def test_synthetic_character_builds(self):
        c = imperfect.Character()
        c.internal_name, c.display_name, c.base = "Synth", "SYNTH", "wolverine"
        c.glb = make_glb()
        c.materials = [imperfect.Material(0, "skin", True, "", (64, 64), False, "textures/skin.png")]
        c.files = {"textures/skin.png": png_bytes(), "ui/hud.png": png_bytes(64, 64)}
        from imperfectlab.model import glb, mapping
        auto = mapping.auto_map(glb.Model(c.glb), Skeleton.of_base(R.BaseCharacter(self.src, c.base)))
        c.mapping, c.overrides = auto.mapping, auto.overrides
        c.gameplay = {"lift": "heavy"}
        r = Builder(self.src, c).build()
        self.assertIn("Bundles/synth.ngm", r.adds)
        self.assertIn("Bundles/synth_alt.tpl", r.adds)
        t = R.Templates(r.sets["Misc/Global.not"])
        self.assertEqual(R.u32(t.prop("plr_Synth", R.P_ABILITIES)) & 0x30, 0x20)

    def test_name_taken(self):
        c = imperfect.Character()
        c.internal_name, c.display_name, c.glb = "Wolverine", "W", make_glb()
        c.materials = [imperfect.Material(0, "skin", True, "", (64, 64), False, "textures/skin.png")]
        c.files = {"textures/skin.png": png_bytes()}
        with self.assertRaises(LabError):
            Builder(self.src, c).build()


@unittest.skipUnless(MNROI, "IMPERFECTLAB_MNROI is not set")
class Vendor(unittest.TestCase):

    def test_vendored_files_match(self):
        r = subprocess.run([sys.executable, "-B", os.path.join(HERE, "tools", "sync_vendor.py"), MNROI, "--check"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
