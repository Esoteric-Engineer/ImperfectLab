import math
import unittest

from imperfectlab.formats import LabError
from imperfectlab.model import glb, mapping
from imperfectlab.model.fit import Fit

from helpers import MIXAMO, fake_skeleton, make_glb


def dist(a, b):
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


class Mapping(unittest.TestCase):

    def setUp(self):
        self.sk = fake_skeleton()
        self.model = glb.Model(make_glb())

    def test_mixamo(self):
        auto = mapping.auto_map(self.model, self.sk)
        self.assertEqual(auto.preset, "Mixamo")
        self.assertEqual(mapping.check(self.model, self.sk, auto.mapping, auto.overrides), [])
        self.assertEqual(auto.mapping[self.sk.node("L.hand")], "mixamorig:LeftHand")
        self.assertEqual(auto.mapping[self.sk.node("R.finger_b.0")], "mixamorig:RightHandRing1")
        self.assertEqual(auto.overrides["mixamorig:LeftHandMiddle1"], self.sk.node("L.finger_a.0"))

    def test_biped_names(self):
        biped = {"Hips": "Bip01 Pelvis", "Spine": "Bip01 Spine", "Spine1": "Bip01 Spine1", "Spine2": "Bip01 Spine2",
                 "Neck": "Bip01 Neck", "Head": "Bip01 Head"}
        for side, s in (("Left", "L"), ("Right", "R")):
            for a, b in (("Shoulder", "Clavicle"), ("Arm", "UpperArm"), ("ForeArm", "Forearm"), ("Hand", "Hand"),
                         ("UpLeg", "Thigh"), ("Leg", "Calf"), ("Foot", "Foot"), ("ToeBase", "Toe0"),
                         ("HandIndex1", "Finger1"), ("HandIndex2", "Finger11"), ("HandThumb1", "Finger0"),
                         ("HandThumb2", "Finger01")):
                biped[side + a] = "Bip01 %s %s" % (s, b)
        joints = [("%s_%02d" % (biped.get(j, j), i), parent and "%s_%02d" % (biped.get(parent, parent), [x[0] for x in MIXAMO].index(parent)), p)
                  for i, (j, parent, p) in enumerate(MIXAMO)]
        model = glb.Model(make_glb(joints, prefix=""))
        auto = mapping.auto_map(model, self.sk)
        self.assertTrue(auto.preset.startswith("3ds Max Biped"))
        self.assertEqual(auto.mapping[self.sk.node("pelvis")], "Bip01 Pelvis_00")
        self.assertEqual(mapping.check(model, self.sk, auto.mapping, auto.overrides), [])

    def test_missing_required(self):
        auto = mapping.auto_map(self.model, self.sk)
        del auto.mapping[self.sk.node("L.forearm")]
        errors = [m for level, m in mapping.check(self.model, self.sk, auto.mapping, auto.overrides) if level == "error"]
        self.assertTrue(any("L Forearm" in m for m in errors))
        with self.assertRaises(LabError):
            Fit(self.model, self.sk, auto.mapping, auto.overrides)

    def test_inheritance(self):
        auto = mapping.auto_map(self.model, self.sk)
        eff = mapping.effective(self.model, auto.mapping, auto.overrides)
        self.assertEqual(eff["mixamorig:Spine1"], self.sk.node("spine"))
        self.assertEqual(eff["mixamorig:LeftHandMiddle1"], self.sk.node("L.finger_a.0"))


class Fitting(unittest.TestCase):

    def check_fit(self, joints):
        sk = fake_skeleton()
        model = glb.Model(make_glb(joints))
        auto = mapping.auto_map(model, sk)
        f = Fit(model, sk, auto.mapping, auto.overrides)
        J = sk.positions()
        prim = model.prims[0]
        names = [j for j, _, _ in joints]
        for joint, role in (("LeftHand", "L.hand"), ("RightFoot", "R.foot"), ("Head", "head"), ("LeftArm", "L.upper_arm")):
            k = 3 * names.index(joint)
            q, _, w = f.vertex(prim.pos[k], prim.nrm[k], prim.skin[k])
            self.assertLess(dist(q, J[sk.node(role)]), 0.08, joint)
            self.assertIn(sk.node(role), [n for n, _ in w])
        return f

    def test_fit(self):
        f = self.check_fit(MIXAMO)
        self.assertFalse(f.flip)

    def test_backwards_model(self):
        turned = [(j, parent, (-p[0], p[1], -p[2])) for j, parent, p in MIXAMO]
        self.assertTrue(self.check_fit(turned).flip)

    def test_twist_split(self):
        sk = fake_skeleton()
        model = glb.Model(make_glb())
        auto = mapping.auto_map(model, sk)
        f = Fit(model, sk, auto.mapping, auto.overrides)
        upper, forearm = f.D["mixamorig:LeftArm"], f.D["mixamorig:LeftForeArm"]
        mid = tuple(upper[i] + (forearm[i] - upper[i]) * 0.4 for i in range(3))
        w = dict(f.weights("mixamorig:LeftArm", mid))
        self.assertAlmostEqual(w[sk.node("L.upper_arm")] + w[sk.node("L.upper_twist")], 1.0)
        self.assertGreater(w[sk.node("L.upper_twist")], 0.0)


if __name__ == "__main__":
    unittest.main()
