"""Select-screen and loading-screen portraits for select-screen id 18 (from Doompatcher's and the
Captain America mod's portrait scripts).

Johnny Ohm's portrait movies (id 4) are the template whatever the base: their images are redrawn in
place and the archives renamed. Each select-screen pose (REST, READY, READYALT) draws its own picture,
scaled by `scale` and placed so the picture's `anchor` pixel (the face) lands at FACE_AT on the READY
canvas; the canvases start mid-panel, so the top FADE rows fade in.
"""
import struct

from ..formats import LabError, aptpatch, call, gshtool, nbig
from . import images
from .ui import NEW_ID, P, load_archive, rename_archive

TEMPLATE_ID = 4
POSE_TEX = {"1": "rest", "6": "ready", "10": "readyalt"}
POSES = ("rest", "ready", "readyalt")
FACE_AT = (138, 90)
FADE = 36


def archive_name(kind, select_id, alt=False):
    return P + "portraits/%s%d%s.big" % (kind, select_id, "_alt" if alt else "") if kind == "cvs" else \
        P + "portraits/c%d_p0.big" % select_id


def geo_pieces(geo):
    """Per .geo record, its textured pieces: rid, tex, the texture matrix's scale and offset, the box."""
    out = []
    for rid, shapes in call(gshtool.read_geo, geo):
        pieces = []
        for items in shapes:
            tex = next((it for it in items if it[0] == "texture"), None)
            pts = [p[:2] for it in items if it[0] == "triangle" for p in it[1:]]
            if tex is None or not pts:
                continue
            m = tex[4]
            xs, ys = [q[0] for q in pts], [q[1] for q in pts]
            pieces.append({"rid": rid, "tex": str(tex[3]), "s": m[0], "t": (m[12], m[13]),
                           "x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys)})
        if pieces:
            out.append(pieces)
    return out


def shape_offsets(apt_bytes, const_bytes):
    apt = aptpatch.Apt(apt_bytes, const_bytes)
    movie = apt.apt_off
    out = {}
    for f in range(apt.u32(movie + 8)):
        for it, _ in apt.frame_places(movie, f):
            c = apt.u32(it + 12)
            if c == 0xFFFFFFFF or apt.u32(apt.character(c)) != 5:
                continue
            for it2, _ in apt.frame_places(apt.character(c), 0):
                shp = apt.character(apt.u32(it2 + 12))
                if apt.u32(shp) == 1:
                    x, y = struct.unpack_from(">2f", apt.d, it + 32)
                    x2, y2 = struct.unpack_from(">2f", apt.d, it2 + 32)
                    out.setdefault(apt.u32(shp + 24), (x + x2, y + y2))
    return out


def canvas_of(pieces):
    s = pieces[0]["s"]
    X0, Y0 = min(p["x0"] for p in pieces), min(p["y0"] for p in pieces)
    X1, Y1 = max(p["x1"] for p in pieces), max(p["y1"] for p in pieces)
    return s, X0, Y0, int(round((X1 - X0) * s)), int(round((Y1 - Y0) * s))


class SelectLayout:
    """The template's select-screen portrait: per record its pose, canvas size and place on screen."""

    def __init__(self, source):
        src = "c%d_p0" % TEMPLATE_ID
        self.files = load_archive(source.entry(archive_name("c", TEMPLATE_ID)))
        f = dict(self.files)
        self.src = src
        self.records = geo_pieces(f[src + ".geo"])
        self.offsets = shape_offsets(f[src + ".apt"], f[src + ".const"])
        self.bank = call(gshtool.read_gsh, f[src + ".gsh"])
        ready = next(r for r in self.records if any(p["tex"] == "6" for p in r))
        self.s_r, self.X0_r, self.Y0_r = self.screen_box(ready)[:3]
        self.face = (self.X0_r + FACE_AT[0] / self.s_r, self.Y0_r + FACE_AT[1] / self.s_r)

    def screen_box(self, pieces):
        s, X0, Y0, W, H = canvas_of(pieces)
        ox, oy = self.offsets.get(pieces[0]["rid"], (0.0, 0.0))
        return s, X0 + ox, Y0 + oy, W, H

    def pose_of(self, pieces):
        return next((POSE_TEX[p["tex"]] for p in pieces if p["tex"] in POSE_TEX), None)

    def canvases(self):
        """[(record index, pose, (W, H))] for the records that show a pose."""
        out = []
        for i, pieces in enumerate(self.records):
            pose = self.pose_of(pieces)
            if pose:
                out.append((i, pose, canvas_of(pieces)[3:]))
        return out

    def original(self, pose):
        """The template's own picture of a pose, as one canvas (for previews)."""
        from PIL import Image
        for i, pieces in enumerate(self.records):
            if self.pose_of(pieces) != pose:
                continue
            s, X0, Y0, W, H = canvas_of(pieces)
            canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            for p in pieces:
                rec = self.bank.records[p["tex"]]
                pic = gshtool.Picture(rec)
                im = Image.frombytes("RGBA", (pic.width, pic.height), pic.decode(rec))
                at = (-int(round(p["t"][0] + X0 * s)), -int(round(p["t"][1] + Y0 * s)))
                canvas.paste(im, at, im)
            return canvas
        return None

    def compose(self, i, pose, picture, scale, anchor, glow=None, fade=FADE):
        """The canvas of record i drawing picture (PIL RGBA)."""
        from PIL import Image, ImageChops, ImageFilter
        s, X0, Y0, W, H = self.screen_box(self.records[i])
        per_px = scale / self.s_r
        size = (max(1, int(round(picture.width * per_px * s))), max(1, int(round(picture.height * per_px * s))))
        pic = picture.resize(size, Image.LANCZOS)
        canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        at = (int(round((self.face[0] - anchor[0] * per_px - X0) * s)), int(round((self.face[1] - anchor[1] * per_px - Y0) * s)))
        canvas.paste(pic, at)
        if glow:
            a = canvas.getchannel("A").filter(ImageFilter.GaussianBlur(6))
            g = Image.new("RGBA", canvas.size, tuple(glow))
            g.putalpha(a.point(lambda v: min(255, v * 2)))
            g.alpha_composite(canvas)
            canvas = g
        n = int(round(fade * s / self.s_r))
        if n > 0:
            ramp = Image.new("L", (W, H), 255)
            for y in range(min(n, H)):
                ramp.paste(255 * y // n, (0, y, W, y + 1))
            canvas.putalpha(ImageChops.multiply(canvas.getchannel("A"), ramp))
        return canvas

    def build(self, poses, fade=FADE):
        """c18_p0 bytes. poses: {pose: (PIL picture, scale, anchor, glow color RGBA or None)}."""
        from PIL import Image
        bank = call(gshtool.read_gsh, dict(self.files)[self.src + ".gsh"])
        for i, pieces in enumerate(self.records):
            pose = self.pose_of(pieces)
            if pose is None or pose not in poses:
                continue
            picture, scale, anchor, glow = poses[pose]
            canvas = self.compose(i, pose, picture, scale, anchor, glow, fade)
            s, X0, Y0, W, H = canvas_of(pieces)
            for p in pieces:
                pic = gshtool.Picture(bank.records[p["tex"]])
                img = Image.new("RGBA", (pic.width, pic.height), (0, 0, 0, 0))
                img.paste(canvas, (int(round(p["t"][0] + X0 * s)), int(round(p["t"][1] + Y0 * s))))
                bank.records[p["tex"]] = images.encode(bank.records[p["tex"]], img)
        out = [(n, gshtool.build_gsh(bank) if n.lower().endswith(".gsh") else b) for n, b in self.files]
        name = "c%d_p0" % NEW_ID
        return nbig.save([(name + n[len(self.src):], b) for n, b in out], tag=self.files.tag)


def strip_sizes(source, alt=False):
    """[(w, h)] of the loading-screen strips, widest first (128x256 and 32x256)."""
    files = dict(load_archive(source.entry(archive_name("cvs", TEMPLATE_ID, alt))))
    bank = call(gshtool.read_gsh, files["cvs%d%s.gsh" % (TEMPLATE_ID, "_alt" if alt else "")])
    pics = [gshtool.Picture(bank.records[n]) for n in bank.names]
    return sorted(((p.width, p.height) for p in pics), key=lambda wh: -wh[0])


def strip_crop(source, picture, anchor, scale, alt=False):
    """The strips cut from picture around anchor at scale, under the outlines of the template's strips."""
    from PIL import Image
    files = dict(load_archive(source.entry(archive_name("cvs", TEMPLATE_ID, alt))))
    bank = call(gshtool.read_gsh, files["cvs%d%s.gsh" % (TEMPLATE_ID, "_alt" if alt else "")])
    pics = sorted(((n, gshtool.Picture(bank.records[n])) for n in bank.names), key=lambda x: -x[1].width)
    outlines = [Image.frombytes("RGBA", (p.width, p.height), p.decode(bank.records[n])) for n, p in pics]
    W, H = sum(o.width for o in outlines), outlines[0].height
    bw, bh = W / scale, H / scale
    box = (anchor[0] - bw * 0.5, anchor[1] - bh * 0.45, anchor[0] + bw * 0.5, anchor[1] + bh * 0.55)
    face = images.crop_resize(picture, box, (W, H))
    out, x = [], 0
    for o in outlines:
        part = face.crop((x, 0, x + o.width, H))
        a = Image.composite(part.getchannel("A"), Image.new("L", part.size, 0), o.getchannel("A"))
        part.putalpha(a)
        out.append(part)
        x += o.width
    return out


def loading_archive(source, strips, alt=False):
    """cvs18[_alt] bytes from the template's with its strips (widest first) replaced."""
    src = "cvs%d%s" % (TEMPLATE_ID, "_alt" if alt else "")
    files = load_archive(source.entry(archive_name("cvs", TEMPLATE_ID, alt)))
    d = dict(files)
    bank = call(gshtool.read_gsh, d[src + ".gsh"])
    names = sorted(bank.names, key=lambda n: -gshtool.Picture(bank.records[n]).width)
    for n, im in zip(names, strips):
        pic = gshtool.Picture(bank.records[n])
        if im.size != (pic.width, pic.height):
            raise LabError("a loading-screen strip is %dx%d, not %dx%d" % (im.size + (pic.width, pic.height)))
        bank.records[n] = images.encode(bank.records[n], im)
    out = [(n, gshtool.build_gsh(bank) if n.lower().endswith(".gsh") else b) for n, b in files]
    name = "cvs%d%s" % (NEW_ID, "_alt" if alt else "")
    return nbig.save([(name + n[len(src):], b) for n, b in out], tag=files.tag)


def renamed(source, select_id):
    """{archive name: bytes}: the base's own portraits under id 18 (no art supplied)."""
    out = {}
    for kind, alt, old in (("c", False, "c%d_p0"), ("cvs", False, "cvs%d"), ("cvs", True, "cvs%d_alt")):
        data = source.entry(archive_name(kind, select_id, alt))
        out[archive_name(kind, NEW_ID, alt)] = rename_archive(data, old % select_id, old % NEW_ID)
    return out
