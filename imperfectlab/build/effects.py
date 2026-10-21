"""Misc/game.nfx: recolored copies of the base's effects for the aura tint (experimental).

A tree of effect blocks (a block and every block its effectname/effect0-3 keys name) is copied under
new names with every color turned to the chosen hue, keeping each color's lightness. The copies are
appended; nothing of the base's changes.
"""
import colorsys
import re

from ..formats import LabError, call, nfxtool

REFERENCES = ("effectname", "effect0", "effect1", "effect2", "effect3")
COLOR_KEYS = ("startcol", "endcol", "startcol2", "endcol2")
HEX_KEYS = ("startcolor", "endcolor", "startcolor2", "endcolor2")
PARTICLES = ("partsys", "partsysdam", "billboard", "billboardomni", "partcylinder", "partsubfx")


def tint_roots(source, base):
    """(costume 1 roots, costume 2 roots, their cache bytes, free cache bytes) of what a tint would copy."""
    from . import tuning
    fx = Effects(source.entry("Misc/game.nfx"))
    tun = tuning.Tuning(source, base)
    roots = [r for r in [base.effect1] + [tun.value(f) for f in tuning.POWER_EFFECTS] if fx.has(r)]
    alt = [r for r in [base.alt_effect1] + [tun.value(f, 5) for f in tuning.POWER_EFFECTS] if fx.has(r)]
    return roots, alt, fx.cost(roots) + fx.cost(alt), fx.free()


def hex_rgb(color):
    c = color.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def tint(rgb, target):
    """rgb (0-255 floats) moved to target's hue and saturation, keeping its lightness."""
    h, l, _ = colorsys.rgb_to_hls(*(max(0.0, min(255.0, c)) / 255.0 for c in rgb))
    th, _, ts = colorsys.rgb_to_hls(*(c / 255.0 for c in target))
    return tuple(255.0 * c for c in colorsys.hls_to_rgb(th, l, ts))


class Effects:

    def __init__(self, data):
        self.items = call(nfxtool.read_nfx, data)
        self.by = {}
        for b in nfxtool.blocks(self.items):
            self.by.setdefault(b.name.lower(), b)

    def has(self, name):
        return bool(name) and name.lower() in self.by

    def tree(self, roots):
        """The blocks reachable from roots, in a stable order."""
        out, todo = [], [r for r in roots if self.has(r)]
        seen = set()
        while todo:
            name = todo.pop(0)
            if name.lower() in seen:
                continue
            seen.add(name.lower())
            block = self.by[name.lower()]
            out.append(block)
            for line in block.lines[1:]:
                t = nfxtool.tokens(line)
                if len(t) >= 2 and t[0].lower() in REFERENCES and self.has(t[1]):
                    todo.append(t[1])
        return out

    def cost(self, roots):
        used = dict((b.name.lower(), n) for b, n in nfxtool.cache_use(self.items)[0])
        return sum(used.get(b.name.lower(), 0) for b in self.tree(roots))

    def free(self):
        return nfxtool.CACHE_SIZE - nfxtool.cache_use(self.items)[1]

    def tinted(self, roots, color, prefix):
        """Append tinted copies of the trees of roots; returns {old name: new name}."""
        blocks = self.tree(roots)
        names, k = {}, 0
        for b in blocks:
            while True:
                new = "%s%d" % (prefix, k)
                k += 1
                if not self.has(new) and new.lower() not in {v.lower() for v in names.values()}:
                    break
            if len(new) > 31:
                raise LabError("effect name %s is too long" % new)
            names[b.name.lower()] = new
        target = hex_rgb(color)
        copies = []
        for b in blocks:
            lines = ["%s %s" % (nfxtool.TYPES[b.type], names[b.name.lower()])]
            colored = False
            body = b.lines[1:len(b.lines) - b.ended]
            for line in body:
                t = nfxtool.tokens(line)
                key = t[0].lower() if t else ""
                if key in REFERENCES and len(t) >= 2 and t[1].lower() in names:
                    line = "%s %s" % (t[0], names[t[1].lower()])
                elif key in COLOR_KEYS and len(t) >= 2:
                    vals = nfxtool.scan_floats(t[1], 4)
                    if len(vals) == 4:
                        r, g, bl = tint(vals[1:], target)
                        line = "%s (%s,%d,%d,%d)" % (t[0], _num(vals[0]), round(r), round(g), round(bl))
                        colored = True
                elif key in HEX_KEYS and len(t) >= 2:
                    v = nfxtool.scan_hex(t[1])
                    if v:
                        r, g, bl = tint(((v >> 16) & 255, (v >> 8) & 255, v & 255), target)
                        line = "%s 0x%08x" % (t[0], (v & 0xFF000000) | (round(r) << 16) | (round(g) << 8) | round(bl))
                        colored = True
                lines.append(line)
            if not colored and nfxtool.TYPES[b.type] in PARTICLES:
                lines.append("endcol (255,%d,%d,%d)" % target)
            lines.append("end")
            copies.append(nfxtool.Block(b.type, names[b.name.lower()], lines, True))
        at = len(self.items) - 1 if self.items and self.items[-1] == "" else len(self.items)
        self.items[at:at] = copies
        for c in copies:
            self.by.setdefault(c.name.lower(), c)
        return names

    def build(self):
        problems, _ = nfxtool.problems(self.items)
        new = [p for p in problems if "cache:" in p or "records" in p]
        if new:
            raise LabError("the effect file would be over its limits: %s" % "; ".join(new))
        return nfxtool.build_nfx(self.items)


def _num(x):
    return re.sub(r"\.0$", "", "%g" % x)
