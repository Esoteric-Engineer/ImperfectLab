"""Triangle lists for the viewport, all in the game's frame (Z up, facing +Y)."""
import struct

from ..build import shaders
from ..formats import call, gxtex, ngmtool
from ..model.fit import conv, unit
from ..package.imperfect import image as read_image


class MeshData:
    """Unindexed triangles. influences: per vertex [(key, weight)], for heat maps; key is a source
    joint name or a game node."""

    def __init__(self, positions, normals, uvs, image=None, alpha=1.0, influences=None):
        self.positions, self.normals, self.uvs = positions, normals, uvs
        self.image, self.alpha, self.influences = image, alpha, influences


def source_meshes(model, character, flip=False):
    images = material_images(model, character)
    out = []
    for prim in model.prims:
        pos, nrm, uv, inf = [], [], [], []
        for tri in prim.tris:
            for k in tri:
                pos.append(conv(prim.pos[k], flip))
                nrm.append(unit(conv(prim.nrm[k], flip)))
                uv.append(prim.uv[k])
                inf.append(prim.skin[k])
        out.append(MeshData(pos, nrm, uv, images.get(prim.material), influences=inf))
    return out


def material_images(model, character):
    """{GLB material: PIL image} as the character will draw it (costume 1)."""
    out = {}
    specs = {m.gltf_material: m for m in character.materials}
    for i, mat in enumerate(model.materials):
        m = specs.get(i)
        try:
            if m is not None and m.texture and m.texture in character.files:
                out[i] = read_image(character.files[m.texture])
            elif mat.image is not None:
                out[i] = model.image(mat.image)
        except Exception:
            pass
    return out


def fitted_meshes(tris_by_mat, images):
    out = []
    for slot, tris in sorted(tris_by_mat.items()):
        pos, nrm, uv, inf = [], [], [], []
        for t in tris:
            for p, n, u, w in t:
                pos.append(p)
                nrm.append(n)
                uv.append(u)
                inf.append(w)
        out.append(MeshData(pos, nrm, uv, images.get(slot), influences=inf))
    return out


def base_meshes(source, base, alpha=1.0):
    """The base character's own render model, textured."""
    ngm, ngt, tpl = base.bundle_files()
    _, models = call(ngmtool.read, ngm)
    m = models[0]
    names = [n.lower() for n in ngt.decode("latin-1").split()]
    tpl_images, _ = call(gxtex.read_tpl, tpl)
    nsa = shaders.blocks(source.entry("Materials/Shaders/shaders.nsa"))
    normals_raw = source.entry("Misc/NormalTable.ngn")
    count = struct.unpack_from(">H", normals_raw, 0)[0]
    normals = [struct.unpack_from(">3f", normals_raw, 2 + 12 * i) for i in range(count)]
    cache = {}

    def texture(part):
        name = (nsa.get(part.lower(), {}).get("texture", "") or part).split()[0].lower()
        if name not in cache:
            cache[name] = None
            if name in names:
                from PIL import Image
                im = tpl_images[names.index(name)]
                rgba = gxtex.decode(im.format, im.base(), im.width, im.height)
                cache[name] = Image.frombytes("RGBA", (im.width, im.height), rgba)
        return cache[name]

    out = []
    start, off = [0] * len(m.streams), 0
    for part, stream, strips, lists, count, _, nodes in m.meshes:
        st = m.streams[stream]
        lo = start[stream]
        start[stream] += count
        idx = m.indices[off:off + strips + lists]
        off += strips + lists
        tris = []
        for i in range(strips - 2):
            a, b, c = idx[i], idx[i + 1], idx[i + 2]
            if a != b and b != c and a != c:
                tris.append((a, b, c) if i % 2 == 0 else (b, a, c))
        tris += [tuple(idx[k:k + 3]) for k in range(strips, strips + lists, 3)]
        pos, nrm, uv, inf = [], [], [], []
        for t in tris:
            for r in t:
                vi, ni, ui = st.refs[r]
                v = st.vertices[vi]
                pos.append(v[:3])
                nrm.append(normals[ni] if ni < len(normals) else (0.0, 0.0, 1.0))
                u = m.uvs[ui] if ui < len(m.uvs) else (0, 0)
                uv.append((u[0] / 512.0, u[1] / 512.0))
                if st.kind == 2:
                    inf.append([(v[6 + j], v[3 + j]) for j in range(3) if v[3 + j] > 0])
                elif st.kind == 1:
                    inf.append([(v[3], 1.0)])
                else:
                    inf.append([(nodes[0], 1.0)] if nodes else [])
        out.append(MeshData(pos, nrm, uv, texture(m.parts[part]) if part < len(m.parts) else None, alpha, inf))
    return out


def game_bones(skeleton):
    J = skeleton.positions()
    return [(J[n.parent], J[n.index], n.index) for n in skeleton.nodes if n.parent is not None and n.parent >= 0]


def source_bones(model, flip=False):
    out = []
    for j in model.joints:
        if j.parent is not None:
            out.append((conv(model.by_name[j.parent].pos, flip), conv(j.pos, flip), j.name))
    return out
