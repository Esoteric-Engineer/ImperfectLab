"""The versus character-select UI for select-screen id 18 (from Doompatcher's patch_ui.py): the select
screen's lists and grid, the tile, the hero name and color, and the in-match HUD portraits."""
import struct

from ..formats import LabError, aptpatch, call, gshtool, nbig
from . import images

NEW_ID = 18
P = "Apt/clash/"


def split(files):
    return {n.rsplit(".", 1)[-1].lower(): (n, b) for n, b in files}


class Archive(list):
    """The files of a nested UI archive, remembering its tag."""
    tag = nbig.TAG


def load_archive(data):
    files, tag = call(nbig.parse, data)
    out = Archive(files)
    out.tag = tag
    return out


def rebuild(files, apt_bytes, const_bytes, other=None):
    other = dict(other or {}, apt=apt_bytes, const=const_bytes)
    return nbig.save([(n, other.get(n.rsplit(".", 1)[-1].lower(), b)) for n, b in files], tag=files.tag)


def open_movie(data):
    files = load_archive(data)
    d = split(files)
    return files, d, aptpatch.Apt(d["apt"][1], d["const"][1])


def patch_charselect(data, voice=None):
    """The select screen's lists with entry 18; voice: the FE_SFX_* number its ready voice plays, or None
    (no voice, which the game accepts)."""
    files, d, apt = open_movie(data)
    block = apt.frame_actions(apt.apt_off, 0)[0]

    at = apt.find_push(block, lambda v: v[:1] == ["aObject"] and v[-1] == 18 and "thumb17" in v)
    items = apt.get_push(at)
    thumb = apt.push_str(block, "thumb%d" % NEW_ID)
    apt.set_push(at, [items[0], thumb] + items[1:-1] + [apt.const_int(NEW_ID + 1)])

    at = apt.find_push(block, lambda v: v[:1] == ["aCharObject"] and v[-1] == 18)
    items = apt.get_push(at)
    apt.set_push(at, [items[0]] + [items[1]] * 27 + [apt.const_int(27)])

    at = apt.find_push(block, lambda v: v[:1] == ["g_aCharacterOrder"] and v[-1] == 18 and v[1] == 17)
    items = apt.get_push(at)
    apt.set_push(at, [items[0], apt.const_int(NEW_ID)] + items[1:-1] + [apt.const_int(NEW_ID + 1)])

    if voice is not None:
        add_voice(apt, block, voice)
    a, c = apt.build()
    return rebuild(files, a, c)


def add_voice(apt, block, voice):
    """g_aCharacterAudio is built by pushing the 18 FE_SFX_* values, Van Roekel's first, then 18 and
    InitArray: a 19th value goes under them and the count becomes 19."""
    pool = apt.pool(block)
    ops = list(apt.walk(block))
    start = next((k for k, (at, op) in enumerate(ops) if op == 0x96 and
                  [apt.const_value(i, pool) for i in apt.get_push(at)] == ["g_aCharacterAudio", "_global"]), None)
    if start is None:
        raise LabError("the select screen's voice list was not found")
    count = next((k for k in range(start, min(len(ops) - 1, start + 120)) if ops[k][1] == 0x96 and ops[k + 1][1] == 0x42 and
                  [apt.const_value(i, pool) for i in apt.get_push(ops[k][0])] == [18]), None)
    if count is None:
        raise LabError("the select screen's voice list has an unexpected shape")
    at = ops[start][0]
    items = apt.get_push(at)
    apt.set_push(at, [items[0], apt.const_int(voice), items[1]])
    apt.set_push(ops[count][0], [apt.const_int(NEW_ID + 1)])


def sfx_values(main_data):
    """{FE_SFX_* name: number} as main.big sets them."""
    files, d, apt = open_movie(main_data)
    out = {}
    movie = apt.apt_off
    for f in range(apt.u32(movie + 8)):
        for block in apt.frame_actions(movie, f):
            if apt.d[block] != 0x88:
                continue
            pool = apt.pool(block)
            for at, op in apt.walk(block):
                if op == 0x96:
                    vals = [apt.const_value(i, pool) for i in apt.get_push(at)]
                    if len(vals) == 2 and isinstance(vals[0], str) and vals[0].startswith("FE_SFX_") and isinstance(vals[1], int):
                        out.setdefault(vals[0], vals[1])
    return out


TILE_TEMPLATE = 4


def patch_thumbs(data, alias_id, pics=None):
    """The tile: a thumb18 clip one row under thumb9, and an export char18 that is a copy of Johnny Ohm's
    tile sprite drawing pics (unselected, selected PIL images), or else an alias of char<alias_id>."""
    files, d, apt = open_movie(data)
    exports = dict(apt.exports())
    holder = None
    for n in range(apt.u32(apt.apt_off + 20)):
        c = apt.character(n)
        if c and apt.u32(c) == 5 and any(nm == "thumb17" for _, nm in apt.frame_places(c, 0)):
            holder = c
    if holder is None:
        raise LabError("the select screen's thumbnail holder was not found")
    places = {nm: it for it, nm in apt.frame_places(holder, 0) if nm}

    src0, src9 = places["thumb0"], places["thumb9"]
    y0, y9 = struct.unpack_from(">f", apt.d, src0 + 36)[0], struct.unpack_from(">f", apt.d, src9 + 36)[0]
    rec = bytearray(apt.d[src9:src9 + 64])
    struct.pack_into(">f", rec, 36, y9 + (y9 - y0))
    depths = [struct.unpack_from(">i", apt.d, it + 8)[0] for it, _ in apt.frame_places(holder, 0)]
    struct.pack_into(">i", rec, 8, max(depths) + 2)
    struct.pack_into(">I", rec, 52, apt.append_str("thumb%d" % NEW_ID))
    apt.add_frame_item(holder, 0, apt.append(bytes(rec)))

    for block in apt.frame_actions(holder, 0):
        pool = apt.pool(block)
        for at, op in apt.walk(block):
            if op == 0x96:
                items = apt.get_push(at)
                if [apt.const_value(i, pool) for i in items] == [18]:
                    apt.set_push(at, [apt.const_int(NEW_ID + 1)])

    replaced = {}
    if pics:
        new_sprite, geo, gsh = add_tile(apt, exports["char%d" % TILE_TEMPLATE], d["geo"][1], d["gsh"][1], pics)
        apt.add_export("char%d" % NEW_ID, new_sprite)
        replaced = {"geo": geo, "gsh": gsh}
    else:
        apt.add_export("char%d" % NEW_ID, exports["char%d" % alias_id])
    a, c = apt.build()
    return rebuild(files, a, c, replaced)


def tile_sizes(data):
    """[(w, h)] of the two tile pictures (unselected, selected) of the tile template."""
    files, d, apt = open_movie(data)
    sprite = apt.character(dict(apt.exports())["char%d" % TILE_TEMPLATE])
    records = call(gshtool.read_geo, d["geo"][1])
    bank = call(gshtool.read_gsh, d["gsh"][1])
    out, seen = [], set()
    for f in range(apt.u32(sprite + 8)):
        for it, _ in apt.frame_places(sprite, f):
            sh = apt.u32(it + 12)
            if sh in seen:
                continue
            seen.add(sh)
            pic = gshtool.Picture(bank.records[str(geo_texture(records, apt.u32(apt.character(sh) + 24)))])
            out.append((pic.width, pic.height))
    return out


def add_tile(apt, sprite_id, geo, gsh, pics):
    movie = apt.apt_off
    nchars, chars = apt.u32(movie + 20), apt.u32(movie + 24)
    src = apt.character(sprite_id)
    nframes = apt.u32(src + 8)
    table = [apt.u32(chars + 4 * i) for i in range(nchars)]
    records = call(gshtool.read_geo, geo)
    bank = call(gshtool.read_gsh, gsh)
    shape_map, image_map, geo_new, img_new, order = {}, {}, {}, {}, []
    for f in range(nframes):
        for it, _ in apt.frame_places(src, f):
            sh = apt.u32(it + 12)
            if sh in shape_map:
                continue
            shp = apt.character(sh)
            if apt.u32(shp) != 1:
                raise LabError("the tile sprite places a non-shape")
            geo_id = apt.u32(shp + 24)
            new_shape = len(table)
            table.append(apt.append(bytes(apt.d[shp:shp + 28])))
            apt.put32(table[-1] + 24, new_shape)
            shape_map[sh] = new_shape
            old_tex = geo_texture(records, geo_id)
            img = apt.character(old_tex)
            new_img = len(table)
            table.append(apt.append(bytes(apt.d[img:img + 12])))
            apt.put32(table[-1] + 8, new_img)
            image_map[old_tex] = new_img
            geo_new[new_shape] = (geo_id, {old_tex: new_img})
            order.append(old_tex)
    if len(order) != 2:
        raise LabError("expected two tile pictures (unselected, selected), found %d" % len(order))
    for t, im in zip(order, pics):
        pic = gshtool.Picture(bank.records[str(t)])
        if im.size != (pic.width, pic.height):
            raise LabError("the tile picture is %dx%d, not %dx%d" % (im.size + (pic.width, pic.height)))
        img_new[str(image_map[t])] = (str(t), im)
    sizes = {1: 8, 2: 16, 3: 64, 4: 8}
    new_frames = bytearray()
    for f in range(nframes):
        n, items, _ = apt.frame(src, f)
        ptrs = []
        for i in range(n):
            it = apt.u32(items + 4 * i)
            kind = apt.u32(it)
            if kind not in sizes:
                raise LabError("tile sprite frame item type %d is not copied" % kind)
            rec = bytearray(apt.d[it:it + sizes[kind]])
            if kind == 1:
                struct.pack_into(">I", rec, 4, copy_action(apt, apt.u32(it + 4)))
            elif kind == 3:
                if apt.u32(it + 52) or apt.u32(it + 60):
                    raise LabError("tile PlaceObject with a name or clip actions is not copied")
                struct.pack_into(">I", rec, 12, shape_map[apt.u32(it + 12)])
            ptrs.append(apt.append(bytes(rec)))
        new_frames += struct.pack(">II", n, apt.append_u32s(ptrs))
    spr = bytearray(apt.d[src:src + 20])
    struct.pack_into(">I", spr, 12, apt.append(bytes(new_frames)))
    new_sprite = len(table)
    table.append(apt.append(bytes(spr)))
    apt.put32(movie + 24, apt.append_u32s(table))
    apt.put32(movie + 20, len(table))
    new_geo = gshtool.build_geo(call(gshtool.add_shapes, records, geo_new))
    new_gsh = gshtool.build_gsh(images.add(bank, img_new))
    return new_sprite, new_geo, new_gsh


def copy_action(apt, block):
    end = None
    for at, op in apt.walk(block):
        if op in (0x8E, 0x9B):
            raise LabError("action block 0x%X defines a function: not copied" % block)
        end = at + 1
    apt.d += b"\0" * ((block - len(apt.d)) % 4)
    new = apt.append(bytes(apt.d[block:end]), align=1)
    for at, op in list(apt.walk(new)):
        if op in (0x88, 0x96):
            o = (at + 4) & ~3
            n, arr = apt.u32(o), apt.u32(o + 4)
            apt.put32(o + 4, apt.append_u32s([apt.u32(arr + 4 * k) for k in range(n)]))
    return new


def geo_texture(records, rid):
    for r, shapes in records:
        if r == rid:
            tex = [it for items in shapes for it in items if it[0] == "texture"]
            if len(shapes) != 1 or len(tex) != 1:
                raise LabError(".geo record %d is not one textured piece" % rid)
            return tex[0][3]
    raise LabError("no .geo record %d" % rid)


def patch_main(data, name, color=0xFFFFFF):
    files, d, apt = open_movie(data)
    movie = apt.apt_off
    done = set()
    for f in range(apt.u32(movie + 8)):
        for block in apt.frame_actions(movie, f):
            if apt.d[block] != 0x88:
                continue
            pool = apt.pool(block)
            for at, op in list(apt.walk(block)):
                if op != 0x96:
                    continue
                items = apt.get_push(at)
                vals = [apt.const_value(i, pool) for i in items]
                if len(vals) >= 19 and vals[-1] == 18 and vals[-2] == "~kT_THING" and vals[-19] == "~kT_VANROEKEL":
                    apt.set_push(at, items[:-19] + [apt.push_str(block, name)] + items[-19:-1] + [apt.const_int(19)])
                    done.add("names")
                elif len(vals) >= 19 and vals[-1] == 18 and vals[-2] == 11897431 and vals[-19] == 9484461:
                    apt.set_push(at, items[:-19] + [apt.const_int(color)] + items[-19:-1] + [apt.const_int(19)])
                    done.add("colors")
                elif vals[-2:] == ["kGlobal_Max_NumChar", 18]:
                    apt.set_push(at, items[:-1] + [apt.const_int(NEW_ID + 1)])
                    done.add("max")
    if done != {"names", "colors", "max"}:
        raise LabError("main movie: lists not found: %s" % sorted({"names", "colors", "max"} - done))
    a, c = apt.build()
    return rebuild(files, a, c)


def rename_archive(data, old, new):
    files = load_archive(data)
    out = []
    for n, b in files:
        if not n.lower().startswith(old.lower() + "."):
            raise LabError("unexpected file %s in %s" % (n, old))
        out.append((new + n[len(old):], b))
    return nbig.save(out, tag=files.tag)


def add_bank_images(data, pictures=None, copies=None):
    """A .gsh bank with images added: pictures {name: (template, PIL image of the template's size)}, and
    copies {name: existing image} added as exact copies."""
    bank = call(gshtool.read_gsh, data)
    images.add(bank, pictures or {})
    sort = bank.names == sorted(bank.names)
    for name, template in (copies or {}).items():
        if name in bank.records:
            raise LabError("image %s exists" % name)
        bank.records[name] = bank.records[template]
        bank.names.append(name)
    if sort:
        bank.names.sort()
    return gshtool.build_gsh(bank)


def bank_image_size(data, name):
    bank = call(gshtool.read_gsh, data)
    rec = bank.records.get(name)
    if rec is None:
        return None
    pic = gshtool.Picture(rec)
    return pic.width, pic.height
