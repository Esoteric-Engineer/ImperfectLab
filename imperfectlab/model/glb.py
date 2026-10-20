"""A character model from a GLB: its joints in the bind pose, its skinned triangles and its textures.

Positions stay in glTF's frame (Y up); model/fit.py turns them into the game's.
"""
import io
import math
import struct

from ..formats import LabError, gltf

MAX_VERTICES = 400000
MAX_ACCESSOR_BYTES = 64 << 20
RIGID_PREFIX = "mesh:"


class Joint:
    __slots__ = ("name", "parent", "pos")

    def __init__(self, name, parent, pos):
        self.name, self.parent, self.pos = name, parent, pos


class Prim:
    """nrm: normals, not necessarily unit length (model/fit.py normalises them in the game frame)."""
    __slots__ = ("material", "pos", "nrm", "uv", "skin", "tris")

    def __init__(self, material, pos, nrm, uv, skin, tris):
        self.material, self.pos, self.nrm, self.uv, self.skin, self.tris = material, pos, nrm, uv, skin, tris


class Material:
    __slots__ = ("name", "image", "tex_coord", "transform")

    def __init__(self, name, image, tex_coord, transform):
        self.name, self.image, self.tex_coord, self.transform = name, image, tex_coord, transform


def _unit(v):
    n = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) or 1.0
    return (v[0] / n, v[1] / n, v[2] / n)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def triangles(mode, idx):
    if mode == 4:
        return [tuple(idx[k:k + 3]) for k in range(0, len(idx) - 2, 3)]
    if mode == 5:
        out = []
        for k in range(len(idx) - 2):
            a, b, c = idx[k], idx[k + 1], idx[k + 2]
            out.append((a, b, c) if k % 2 == 0 else (b, a, c))
        return out
    if mode == 6:
        return [(idx[0], idx[k], idx[k + 1]) for k in range(1, len(idx) - 1)]
    return []


def computed_normals(pos, tris):
    acc = [[0.0, 0.0, 0.0] for _ in pos]
    for a, b, c in tris:
        n = _cross(_sub(pos[b], pos[a]), _sub(pos[c], pos[a]))
        for k in (a, b, c):
            acc[k][0] += n[0]
            acc[k][1] += n[1]
            acc[k][2] += n[2]
    return [_unit(v) for v in acc]


class Model:
    """Everything ImperfectLab takes from a GLB."""

    def __init__(self, data):
        if data[:4] != b"glTF":
            raise LabError("not a binary glTF (.glb) file")
        try:
            self.g = gltf.GLB(data)
            self._load()
        except LabError:
            raise
        except (KeyError, IndexError, ValueError, TypeError, struct.error) as e:
            raise LabError("the GLB could not be read: %s" % (e,)) from None

    def _accessor(self, i):
        a = self.g.j["accessors"][i]
        if "sparse" in a:
            raise LabError("sparse accessors are not supported")
        n = gltf.NCOMP[a["type"]] * struct.calcsize("<" + gltf.COMP[a["componentType"]])
        if a["count"] * n > MAX_ACCESSOR_BYTES:
            raise LabError("an accessor is too large")
        bv = self.g.j["bufferViews"][a["bufferView"]]
        end = bv.get("byteOffset", 0) + bv["byteLength"]
        if end > len(self.g.bin) or a.get("byteOffset", 0) + (a["count"] - 1) * (bv.get("byteStride") or n) + n > bv["byteLength"]:
            raise LabError("accessor %d runs past its buffer" % i)
        return self.g.accessor(i)

    def _load(self):
        j = self.g.j
        nodes = j.get("nodes", [])
        world = self.g.world()
        parent = self.g.parent
        mesh_nodes = [i for i, nd in enumerate(nodes) if "mesh" in nd]
        skins = sorted({nodes[i]["skin"] for i in mesh_nodes if "skin" in nodes[i]})
        if len(skins) > 1:
            raise LabError("the model has %d skins; ImperfectLab takes one" % len(skins))
        names, used = {}, set()
        joint_nodes = j["skins"][skins[0]]["joints"] if skins else []

        def unique(base):
            name, k = base, 2
            while name in used:
                name, k = "%s.%d" % (base, k), k + 1
            used.add(name)
            return name
        for n in joint_nodes:
            names[n] = unique(nodes[n].get("name") or "joint_%d" % n)

        def joint_parent(n):
            p = parent.get(n)
            while p is not None and p not in names:
                p = parent.get(p)
            return p

        self.joints = []
        for n in joint_nodes:
            p = joint_parent(n)
            self.joints.append(Joint(names[n], names.get(p), tuple(world[n][r][3] for r in range(3))))
        jm = []
        if skins:
            sk = j["skins"][skins[0]]
            ibm = ([gltf.col_major(m) for m in self._accessor(sk["inverseBindMatrices"])]
                   if "inverseBindMatrices" in sk else [gltf.identity() for _ in joint_nodes])
            jm = [gltf.mat_mul(world[n], ibm[k]) for k, n in enumerate(joint_nodes)]

        self.materials = []
        for i, m in enumerate(j.get("materials", [])):
            t = m.get("pbrMetallicRoughness", {}).get("baseColorTexture")
            if t is None:
                t = m.get("extensions", {}).get("KHR_materials_pbrSpecularGlossiness", {}).get("diffuseTexture")
            image = j["textures"][t["index"]].get("source") if t else None
            tf = (t or {}).get("extensions", {}).get("KHR_texture_transform")
            self.materials.append(Material(m.get("name") or "material_%d" % i, image,
                                           (tf or {}).get("texCoord", (t or {}).get("texCoord", 0)), tf))

        self.prims, total = [], 0
        for n in mesh_nodes:
            skinned = "skin" in nodes[n]
            rigid = None
            if not skinned:
                rigid = unique(RIGID_PREFIX + (nodes[n].get("name") or "node_%d" % n))
                p = joint_parent(n)
                self.joints.append(Joint(rigid, names.get(p), tuple(world[n][r][3] for r in range(3))))
            for prim in j["meshes"][nodes[n]["mesh"]]["primitives"]:
                a = prim["attributes"]
                if prim.get("mode", 4) not in (4, 5, 6) or "POSITION" not in a:
                    continue
                mat = prim.get("material")
                tc = self.materials[mat].tex_coord if mat is not None else 0
                P = self._accessor(a["POSITION"])
                total += len(P)
                if total > MAX_VERTICES:
                    raise LabError("the model has more than %d vertices" % MAX_VERTICES)
                idx = self._accessor(prim["indices"]) if "indices" in prim else list(range(len(P)))
                if idx and max(idx) >= len(P):
                    raise LabError("a primitive indexes past its vertices")
                tris = [t for t in triangles(prim.get("mode", 4), idx) if len(set(t)) == 3]
                Nn = self._accessor(a["NORMAL"]) if "NORMAL" in a else None
                key = "TEXCOORD_%d" % tc
                UV = self._accessor(a[key]) if key in a else [(0.0, 0.0)] * len(P)
                if mat is not None and self.materials[mat].transform:
                    UV = [transform_uv(uv, self.materials[mat].transform) for uv in UV]
                pos, nrm, skin = [], [], []
                if skinned:
                    J, Wt = self._accessor(a["JOINTS_0"]), self._accessor(a["WEIGHTS_0"])
                    for k, p in enumerate(P):
                        px, nx = (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)
                        sw = [(ji, w) for ji, w in zip(J[k], Wt[k]) if w > 0]
                        if not sw or any(ji >= len(jm) for ji, _ in sw):
                            raise LabError("a vertex has no valid skin weights")
                        tot = sum(w for _, w in sw)
                        for ji, w in sw:
                            px = _add_scaled(px, gltf.mat_vec(jm[ji], p), w / tot)
                            if Nn:
                                nx = _add_scaled(nx, gltf.mat_vec(jm[ji], Nn[k], 0.0), w / tot)
                        pos.append(px)
                        nrm.append(nx)
                        skin.append([(names[joint_nodes[ji]], w / tot) for ji, w in sw])
                else:
                    m = world[n]
                    for k, p in enumerate(P):
                        pos.append(gltf.mat_vec(m, p))
                        if Nn:
                            nrm.append(gltf.mat_vec(m, Nn[k], 0.0))
                        skin.append([(rigid, 1.0)])
                if not Nn:
                    nrm = computed_normals(pos, tris)
                self.prims.append(Prim(mat, pos, nrm, UV, skin, tris))
        if not self.prims:
            raise LabError("the model has no triangles")
        if not self.joints:
            raise LabError("the model has no skeleton (no skin and no mesh nodes to bind)")
        self.by_name = {jt.name: jt for jt in self.joints}

    def joint_names(self):
        return [jt.name for jt in self.joints]

    def weighted(self):
        """{joint name: number of vertices weighted to it}."""
        out = {}
        for p in self.prims:
            for sw in p.skin:
                for name, _ in sw:
                    out[name] = out.get(name, 0) + 1
        return out

    def ancestors(self, name):
        out = []
        p = self.by_name[name].parent
        while p is not None and p not in out:
            out.append(p)
            p = self.by_name[p].parent
        return out

    def image_bytes(self, i):
        im = self.g.j["images"][i]
        if "uri" in im:
            raise LabError("the GLB names an external image file; embed the textures in the GLB")
        return self.g.view(im["bufferView"])[0]

    def image(self, i):
        from PIL import Image
        return Image.open(io.BytesIO(self.image_bytes(i))).convert("RGBA")

    def triangle_count(self):
        return sum(len(p.tris) for p in self.prims)


def _add_scaled(a, b, k):
    return (a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k)


def transform_uv(uv, tf):
    ox, oy = tf.get("offset", (0.0, 0.0))
    sx, sy = tf.get("scale", (1.0, 1.0))
    r = tf.get("rotation", 0.0)
    u, v = uv[0] * sx, uv[1] * sy
    if r:
        c, s = math.cos(r), math.sin(r)
        u, v = c * u + s * v, -s * u + c * v
    return (u + ox, v + oy)
