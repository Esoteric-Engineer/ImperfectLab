"""Misc/Global.not: the new character's act_/plr_/plr_alt templates, copies of the base's."""
from ..formats import LabError, call, nottool
from ..game import roster as R

AURA_SWAP = (R.P_EFFECT1, R.P_CASTID, R.P_ACTOR_FLAGS)


def model_names(internal, costume):
    return {"MODEL": internal + costume + ".nod", "PHYSMODEL": internal + costume + "_phys.nod",
            "SHADOWMODEL": internal + costume + "_shadow.nod"}


def template_names(internal):
    return "act_" + internal, "plr_" + internal, "plr_alt" + internal


def clone(src, new_name, parent=None):
    t = nottool.Template(nottool.name32(new_name), list(src.props), b"\0")
    if parent:
        t.set(0x00, nottool.v_str(parent))
    return t


def build(data, base, internal, aura="base", effect1=None, description=None, abilities=None, health=None):
    """The new Global.not bytes.

    aura: "base" or "swap" (the two player templates exchange EFFECT1, CASTID and ACTOR_FLAGS, so costume 1
    gets the base's alternate aura and costume 2 its normal one). effect1: (normal, alt) effect names that
    replace EFFECT1. abilities: (bits to set, bits to clear). health: ACTOR_HEALTH/MAXHEALTH (an int property)."""
    T = R.Templates(data)
    act_n, plr_n, alt_n = template_names(internal)
    for n in (act_n, plr_n, alt_n):
        if T.has(n):
            raise LabError("Global.not already has a template %s" % n)
    act = clone(T.get(base.act), act_n)
    plr = clone(T.get(base.plr), plr_n, act_n)
    alt = clone(T.get(base.alt), alt_n, act_n)
    for t, costume in ((act, ""), (alt, "_alt")):
        nm = model_names(internal, costume)
        for pid, key in ((R.P_MODEL, "MODEL"), (R.P_SHADOWMODEL, "SHADOWMODEL"), (R.P_PHYSMODEL, "PHYSMODEL")):
            t.set(pid, nottool.v_str(nm[key]))
    if aura == "swap":
        for pid in AURA_SWAP:
            normal, other = T.prop(base.plr, pid), T.prop(base.alt, pid)
            if normal is not None and other is not None:
                plr.set(pid, other)
                alt.set(pid, normal)
    elif aura != "base":
        raise LabError("unknown aura mode %r" % aura)
    if effect1:
        plr.set(R.P_EFFECT1, nottool.v_str(effect1[0]))
        alt.set(R.P_EFFECT1, nottool.v_str(effect1[1]))
    if description:
        for t in (act, plr, alt):
            if t is act or t.get(R.P_DESCRIPTIONID) is not None:
                t.set(R.P_DESCRIPTIONID, nottool.v_str(description))
    if abilities:
        on, off = abilities
        for t, src in ((act, base.act), (plr, base.plr), (alt, base.alt)):
            if t is act or T.get(src).get(R.P_ABILITIES) is not None:
                v = R.u32(T.prop(src, R.P_ABILITIES)) or 0
                t.set(R.P_ABILITIES, nottool.v_int((v | on) & ~off))
    if health is not None:
        act.set(R.P_HEALTH, nottool.v_int(int(round(health))))
        act.set(R.P_MAXHEALTH, nottool.v_int(int(round(health))))
    return call(nottool.build, T.list + [act, plr, alt])
