"""Paletted UI images (.gsh records), encoded with Pillow's quantizer: the same record layout as
gshtool.encode_record, much faster, and cached because the four HUD language banks get the same
pictures."""
import hashlib
import struct

from ..formats import LabError, gshtool, gxtex

_cache = {}


def encode(record, im):
    """record with its pixels and palette replaced by im (a PIL image of the record's size)."""
    from PIL import Image
    key = (hashlib.sha1(record).digest(), im.size, hashlib.sha1(im.tobytes()).digest())
    hit = _cache.get(key)
    if hit is not None:
        return hit
    pic = gshtool.Picture(record)
    if pic.format not in (gxtex.C4, gxtex.C8) or pic.palette_format is None:
        raise LabError("only C4 and C8 images with a palette are encoded")
    w, h = pic.width, pic.height
    if im.size != (w, h):
        raise LabError("an image is %dx%d, not %dx%d" % (im.size + (w, h)))
    rgba = im.convert("RGBA")
    clear = rgba.getchannel("A").point(lambda v: 255 if v == 0 else 0)
    rgba.paste((0, 0, 0, 0), mask=clear)
    q = rgba.quantize(colors=pic.colours, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    pal = q.getpalette(rawmode="RGBA") or []
    idx = q.tobytes()
    vals = [idx[y * w + x] if x < w and y < h else 0 for x, y in gxtex.blocks(pic.format, w, h)]
    if pic.format == gxtex.C4:
        data = bytes(vals[i] << 4 | vals[i + 1] for i in range(0, len(vals), 2))
    else:
        data = bytes(vals)
    colours = [gxtex.to_colour(pic.palette_format, tuple(pal[i:i + 4])) for i in range(0, min(len(pal), 4 * pic.colours), 4)]
    colours += [0] * (pic.colours - len(colours))
    out = bytearray(record)
    out[pic.pixel_off:pic.pixel_off + len(data)] = data
    out[pic.palette_off:pic.palette_off + 2 * pic.colours] = struct.pack(">%dH" % pic.colours, *colours)
    out = bytes(out)
    _cache[key] = out
    return out


def crop_resize(im, box, size):
    """The part of im inside box (float pixel edges, may extend past the picture, which is then
    transparent) resized to size."""
    import math
    from PIL import Image
    x0, y0, x1, y1 = box
    ix0, iy0, ix1, iy1 = math.floor(x0), math.floor(y0), math.ceil(x1), math.ceil(y1)
    region = im.convert("RGBA").crop((ix0, iy0, max(ix1, ix0 + 1), max(iy1, iy0 + 1)))
    return region.resize(size, Image.LANCZOS, box=(x0 - ix0, y0 - iy0, x1 - ix0, y1 - iy0))


def add(bank, new):
    """Add images to a gshtool.Bank: new = {name: (template name, PIL image of the template's size)}."""
    sort = bank.names == sorted(bank.names)
    for name, (template, im) in new.items():
        if name in bank.records:
            raise LabError("image %s exists" % name)
        bank.records[name] = encode(bank.records[template], im)
        bank.names.append(name)
    if sort:
        bank.names.sort()
    return bank
