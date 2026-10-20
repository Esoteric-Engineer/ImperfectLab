"""Test data made on the fly: a small skinned humanoid GLB and a stand-in for a base skeleton."""
import json
import os
import struct

from imperfectlab.model.skeleton import Skeleton

ISO = os.environ.get("IMPERFECTLAB_ISO")
DOOMPATCHER = os.environ.get("IMPERFECTLAB_DOOMPATCHER")
MNROI = os.environ.get("IMPERFECTLAB_MNROI")

# glTF frame (Y up, the character facing +Z, its left at +X): joint, parent, position
MIXAMO = [
    ("Hips", None, (0, 1.0, 0)), ("Spine", "Hips", (0, 1.1, 0)), ("Spine1", "Spine", (0, 1.2, 0)),
    ("Spine2", "Spine1", (0, 1.3, 0)), ("Neck", "Spine2", (0, 1.5, 0)), ("Head", "Neck", (0, 1.6, 0)),
]
for _side, _x in (("Left", 1), ("Right", -1)):
    MIXAMO += [
        (_side + "Shoulder", "Spine2", (0.05 * _x, 1.45, 0)),
        (_side + "Arm", _side + "Shoulder", (0.18 * _x, 1.45, 0)),
        (_side + "ForeArm", _side + "Arm", (0.45 * _x, 1.45, 0)),
        (_side + "Hand", _side + "ForeArm", (0.7 * _x, 1.45, 0)),
        (_side + "HandIndex1", _side + "Hand", (0.78 * _x, 1.45, 0.02)),
        (_side + "HandIndex2", _side + "HandIndex1", (0.81 * _x, 1.45, 0.02)),
        (_side + "HandIndex3", _side + "HandIndex2", (0.84 * _x, 1.45, 0.02)),
        (_side + "HandMiddle1", _side + "Hand", (0.78 * _x, 1.45, 0.0)),
        (_side + "HandRing1", _side + "Hand", (0.78 * _x, 1.45, -0.02)),
        (_side + "HandRing2", _side + "HandRing1", (0.81 * _x, 1.45, -0.02)),
        (_side + "HandRing3", _side + "HandRing2", (0.84 * _x, 1.45, -0.02)),
        (_side + "HandThumb1", _side + "Hand", (0.73 * _x, 1.44, 0.04)),
        (_side + "HandThumb2", _side + "HandThumb1", (0.76 * _x, 1.44, 0.06)),
        (_side + "UpLeg", "Hips", (0.1 * _x, 0.95, 0)),
        (_side + "Leg", _side + "UpLeg", (0.1 * _x, 0.5, 0)),
        (_side + "Foot", _side + "Leg", (0.1 * _x, 0.08, 0)),
        (_side + "ToeBase", _side + "Foot", (0.1 * _x, 0.02, 0.1)),
    ]


def make_glb(joints=MIXAMO, prefix="mixamorig:", image=None):
    """A GLB with one small skinned triangle at each joint, weighted to it, and one material."""
    index = {j: i for i, (j, _, _) in enumerate(joints)}
    nodes = []
    for j, parent, p in joints:
        q = joints[index[parent]][2] if parent else (0, 0, 0)
        nodes.append({"name": prefix + j, "translation": [p[k] - q[k] for k in range(3)]})
    for i, (_, parent, _) in enumerate(joints):
        if parent:
            nodes[index[parent]].setdefault("children", []).append(i)
    pos, nrm, uv, jnt, wgt, idx = [], [], [], [], [], []
    for i, (_, _, p) in enumerate(joints):
        base = len(pos)
        for d in ((0.01, 0, 0), (0, 0.01, 0), (0, 0, 0.01)):
            pos.append(tuple(p[k] + d[k] for k in range(3)))
            nrm.append((0.0, 0.0, 1.0))
            uv.append((0.5, 0.5))
            jnt.append((i, 0, 0, 0))
            wgt.append((1.0, 0.0, 0.0, 0.0))
        idx += [base, base + 1, base + 2]
    ibm = []
    for _, _, p in joints:
        ibm += [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1]
    blob, views, accessors = bytearray(), [], []

    def view(data):
        while len(blob) % 4:
            blob.append(0)
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)})
        blob.extend(data)
        return len(views) - 1

    def accessor(fmt, rows, kind, ctype):
        flat = [x for r in rows for x in r] if isinstance(rows[0], tuple) else rows
        accessors.append({"bufferView": view(struct.pack("<%d%s" % (len(flat), fmt), *flat)), "componentType": ctype,
                          "count": len(rows) if isinstance(rows[0], tuple) else len(rows) // (16 if kind == "MAT4" else 1),
                          "type": kind})
        return len(accessors) - 1

    attrs = {"POSITION": accessor("f", pos, "VEC3", 5126), "NORMAL": accessor("f", nrm, "VEC3", 5126),
             "TEXCOORD_0": accessor("f", uv, "VEC2", 5126), "JOINTS_0": accessor("H", jnt, "VEC4", 5123),
             "WEIGHTS_0": accessor("f", wgt, "VEC4", 5126)}
    accessors[attrs["POSITION"]]["min"] = [min(p[k] for p in pos) for k in range(3)]
    accessors[attrs["POSITION"]]["max"] = [max(p[k] for p in pos) for k in range(3)]
    a_idx = accessor("H", idx, "SCALAR", 5123)
    a_ibm = accessor("f", ibm, "MAT4", 5126)
    j = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0, len(nodes)]}],
         "nodes": nodes + [{"name": "body", "mesh": 0, "skin": 0}],
         "skins": [{"joints": list(range(len(nodes))), "inverseBindMatrices": a_ibm}],
         "meshes": [{"primitives": [{"attributes": attrs, "indices": a_idx, "material": 0}]}],
         "materials": [{"name": "skin"}], "accessors": accessors, "bufferViews": views}
    if image is not None:
        j["images"] = [{"bufferView": view(image), "mimeType": "image/png"}]
        j["textures"] = [{"source": 0}]
        j["materials"][0]["pbrMetallicRoughness"] = {"baseColorTexture": {"index": 0}}
    while len(blob) % 4:
        blob.append(0)
    j["buffers"] = [{"byteLength": len(blob)}]
    js = json.dumps(j).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    return (struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js +
            struct.pack("<I4s", len(blob), b"BIN\0") + bytes(blob))


class FakeRenderModel:
    """Johnny Ohm-like node positions for the male role table (game frame: Z up, facing +Y, right at +X)."""

    def __init__(self):
        pos = {0: (0, 0, 0), 1: (0, 0, 1.22), 2: (0, 0, 1.27), 3: (0, 0, 1.43), 4: (0, 0, 1.68), 5: (0, 0, 1.77),
               60: (0, 0, 1.18)}
        for side, x, o, legs in (("R", 1, 22, (65, 66, 67, 68)), ("L", -1, 42, (61, 62, 63, 64))):
            for k, px in enumerate((0.03, 0.22, 0.36, 0.49, 0.59, 0.76)):
                pos[o + k] = (px * x, 0.0, 1.57)
            for k in range(3):
                pos[o + 6 + k] = ((0.89 + 0.05 * k) * x, 0.04, 1.58)
                pos[o + 9 + k] = ((0.89 + 0.05 * k) * x, -0.03, 1.58)
            pos[o + 12], pos[o + 13] = (0.82 * x, 0.07, 1.56), (0.88 * x, 0.07, 1.56)
            for n, z in zip(legs, (1.09, 0.61, 0.15, 0.05)):
                pos[n] = (0.15 * x, 0.03 if n == legs[3] else 0.0, z)
        self.nodes = []
        for i in range(72):
            p = pos.get(i, (0.0, 0.0, 1.0))
            self.nodes.append(((0.0, 0.0, 0.0, 1.0), (-p[0], -p[1], -p[2], 1.0), -1 if i == 0 else 0, 0))


def fake_skeleton():
    return Skeleton(FakeRenderModel(), "male")
