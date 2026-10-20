"""Write a character's model bundle (.ngm, .ngt, .tpl): the base's bundle with its render model replaced
by the fitted mesh and its body textures replaced by the new ones. Everything else in the base's bundle
(hit regions, shadow, extra models such as Magneto's MetalBall.nod, effect textures) is kept."""
import copy
import math
import struct

from ..formats import LabError, call, gxtex, ngmtool

MAX_PALETTE = 20
UV_LIMIT = 32767


def unit(a):
    n = math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def read_normals(ngn):
    """Misc/NormalTable.ngn: u16 count, then count big-endian float3 (the game's shared normal array)."""
    n = struct.unpack_from(">H", ngn, 0)[0]
    return [struct.unpack_from(">3f", ngn, 2 + 12 * i) for i in range(n)]


class NormalIndex:

    def __init__(self, table, cells=8):
        self.t, self.c = table, cells
        self.grid = {}
        for i, n in enumerate(table):
            self.grid.setdefault(self._cell(n), []).append(i)

    def _cell(self, n):
        return tuple(int(math.floor((x + 1) * self.c / 2)) for x in n)

    def nearest(self, n):
        cx, cy, cz = self._cell(n)
        best, bi = -2, 0
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for i in self.grid.get((cx + dx, cy + dy, cz + dz), ()):
                        d = n[0] * self.t[i][0] + n[1] * self.t[i][1] + n[2] * self.t[i][2]
                        if d > best:
                            best, bi = d, i
        return bi


class Stats:
    def __init__(self):
        self.clamped_uvs = 0


def render_model(base, tris_by_mat, nidx, name, materials, mesh_flags, stats=None):
    """A copy of the base's render model (nodes, attachments, flags) drawing tris_by_mat instead."""
    stats = stats or Stats()
    verts, data_of = [], {}
    uvs, uv_of, nrm_of = [], {}, {}
    refs, idx, meshes = [], [], []
    nmap = 0
    allpos = []
    for mat in sorted(tris_by_mat):
        tris = tris_by_mat[mat]
        tris.sort(key=lambda t: sorted(b for v in t for b, _ in v[3]))
        groups, cur, cur_b = [], [], set()
        for t in tris:
            tb = {b for v in t for b, _ in v[3]}
            if len(cur_b | tb) > MAX_PALETTE:
                groups.append((cur, cur_b))
                cur, cur_b = [], set()
            cur.append(t)
            cur_b |= tb
        if cur:
            groups.append((cur, cur_b))
        for gtris, gbones in groups:
            local, pidx = {}, []
            for t in gtris:
                for pos, n, uv, w in t:
                    w = sorted(w, key=lambda x: -x[1])
                    key = (pos, tuple(w))
                    if key not in data_of:
                        bones = [b for b, _ in w] + [w[0][0]] * (3 - len(w))
                        ws = [x for _, x in w] + [0.0] * (3 - len(w))
                        data_of[key] = len(verts)
                        verts.append(tuple(pos) + tuple(ws) + tuple(bones) + (0,))
                        allpos.append(pos)
                    pi = data_of[key]
                    nk = (round(n[0], 4), round(n[1], 4), round(n[2], 4))
                    if nk not in nrm_of:
                        nrm_of[nk] = nidx.nearest(unit(n))
                    ni = nrm_of[nk]
                    u, v = int(round(uv[0] * 512)), int(round(uv[1] * 512))
                    if not -UV_LIMIT - 1 <= u <= UV_LIMIT or not -UV_LIMIT - 1 <= v <= UV_LIMIT:
                        stats.clamped_uvs += 1
                    tk = (max(-32768, min(32767, u)), max(-32768, min(32767, v)))
                    if tk not in uv_of:
                        uv_of[tk] = len(uvs)
                        uvs.append(tk)
                    mk = (pi, ni, uv_of[tk])
                    if mk not in local:
                        local[mk] = nmap + len(local)
                        refs.append(mk)
                    pidx.append(local[mk])
            idx += pidx
            meshes.append((mat, 0, 0, len(pidx), len(local), mesh_flags, bytes(sorted(gbones))))
            nmap += len(local)
    if nmap > 0xFFFF or len(verts) > 0xFFFF or len(uvs) > 0xFFFF:
        raise LabError("the model has too many vertices for the game's 16-bit indices: simplify it")
    if not allpos:
        raise LabError("the model has no triangles left")
    lo = [min(p[i] for p in allpos) for i in range(3)]
    hi = [max(p[i] for p in allpos) for i in range(3)]
    m = copy.copy(base)
    m.name, m.parts, m.meshes = name, list(materials), meshes
    m.bounds = (lo[0], lo[1], lo[2], 0.0, hi[0], hi[1], hi[2], 0.0)
    m.uvs, m.indices = uvs, idx
    m.streams = [ngmtool.Stream(2, refs, verts)]
    return m


def renamed(model, name):
    m = copy.copy(model)
    m.name = name
    return m


def build_ngm(base_ngm, render, renames):
    """The base bundle's bytes with model 0 replaced by render and the models named in renames
    ({old lowercased name: new name}) renamed; returns (bytes, models)."""
    head, models = call(ngmtool.read, base_ngm)
    out = [render]
    for m in models[1:]:
        new = renames.get(m.name.lower())
        out.append(renamed(m, new) if new else m)
    head = list(head)
    head[5] = ngmtool.data_size(out) - 15 + 52 * sum(len(m.meshes) for m in out) + 0x200
    data = ngmtool.build(head, out)
    call(ngmtool.read, data)
    return data, out


def texture_header(template, w, h):
    head = list(template.header)
    head[0], head[1], head[2] = h, w, gxtex.CMPR
    head[11] = 0
    if head[6] > 1:
        head[6] = 1
    return head


def encode_image(im, size):
    """A PIL image as a CMPR TPL image of size (w, h), with Lanczos resampling."""
    from PIL import Image
    w, h = size
    for d in (w, h):
        if d < 8 or d > 1024 or d & (d - 1):
            raise LabError("texture sizes must be powers of two from 8 to 1024, not %dx%d" % (w, h))
    im = im.convert("RGBA")
    if im.size != (w, h):
        im = im.resize((w, h), Image.LANCZOS)
    return gxtex.encode(gxtex.CMPR, im.tobytes(), w, h)


def build_tpl(base_tpl, base_ngt, textures, keep, extra=()):
    """(tpl bytes, ngt bytes): textures [(name, PIL image, (w, h))] first, then the base images named in
    keep, in the base's order, then extra [(name, gxtex.Image)] from elsewhere."""
    images, _ = call(gxtex.read_tpl, base_tpl)
    names = base_ngt.decode("latin-1").split()
    template = images[0]
    out, out_names = [], []
    for name, im, size in textures:
        data = encode_image(im, size)
        out.append(gxtex.Image(texture_header(template, size[0], size[1]), data))
        out_names.append(name)
    keep = {k.lower() for k in keep}
    for name, im in zip(names, images):
        if name.lower() in keep and name not in out_names:
            out.append(gxtex.Image(im.header, im.data))
            out_names.append(name)
    for name, im in extra:
        if name not in out_names:
            out.append(gxtex.Image(im.header, im.data))
            out_names.append(name)
    ngt = b"".join(n.encode("latin-1") + b"\r\n" for n in out_names)
    return gxtex.build_tpl(out), ngt
