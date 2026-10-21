"""Which model joint drives which game node: presets for common rigs, inheritance for unmapped joints,
and the checks a mapping must pass before a fit."""
import re

from .skeleton import CHAINS, SIDES

LIMBS = ("clavicle", "upper_arm", "forearm", "hand", "thigh", "calf", "foot", "toe")


class Preset:

    def __init__(self, name, sides, torso, limbs, fingers, extra, normalize):
        self.name, self.sides, self.torso, self.limbs = name, sides, torso, limbs
        self.fingers, self.extra, self.normalize = fingers, extra, normalize

    def candidates(self):
        """[(role, [names])] for the primary mapping, and [(names, role)] for the extra overrides."""
        out = [(role, names) for role, names in self.torso.items()]
        for side, spelled in zip(SIDES, self.sides):
            for role, names in self.limbs.items():
                out.append(("%s.%s" % (side, role), [n.format(s=spelled) for n in names]))
            for chain, names in self.fingers.items():
                for k, n in enumerate(names):
                    out.append(("%s.%s.%d" % (side, chain, k), [n.format(s=spelled)]))
        extra = []
        for side, spelled in zip(SIDES, self.sides):
            for chain, names in self.extra.items():
                for k, n in enumerate(names):
                    extra.append((n.format(s=spelled), "%s.%s.%d" % (side, chain, k)))
        return out, extra


def _strip(pattern):
    rx = re.compile(pattern, re.I)
    return lambda name: rx.sub("", name).strip().lower()


def _biped(name):
    name = re.sub(r"_\d+$", "", name)
    name = re.sub(r"^bip0*1[ _]", "bip01 ", name, flags=re.I)
    return name.strip().lower()


def _rigify(name):
    name = re.sub(r"^(def|org|mch)[-_]", "", name, flags=re.I)
    return re.sub(r"[._]([lr])$", lambda m: "." + m.group(1), name, flags=re.I).strip().lower()


PRESETS = [
    Preset("3ds Max Biped (MUA, many game rips)", ("R", "L"),
           {"pelvis": ["Bip01 Pelvis"], "spine": ["Bip01 Spine"], "chest": ["Bip01 Spine2", "Bip01 Spine1"],
            "neck": ["Bip01 Neck"], "head": ["Bip01 Head"]},
           {"clavicle": ["Bip01 {s} Clavicle"], "upper_arm": ["Bip01 {s} UpperArm"],
            "forearm": ["Bip01 {s} Forearm"], "hand": ["Bip01 {s} Hand"], "thigh": ["Bip01 {s} Thigh"],
            "calf": ["Bip01 {s} Calf"], "foot": ["Bip01 {s} Foot"], "toe": ["Bip01 {s} Toe0"]},
           {"finger_a": ["Bip01 {s} Finger1", "Bip01 {s} Finger11", "Bip01 {s} Finger12"],
            "finger_b": ["Bip01 {s} Finger3", "Bip01 {s} Finger31", "Bip01 {s} Finger32"],
            "thumb": ["Bip01 {s} Finger0", "Bip01 {s} Finger01", "Bip01 {s} Finger02"]},
           {"finger_a": ["Bip01 {s} Finger2", "Bip01 {s} Finger21", "Bip01 {s} Finger22"],
            "finger_b": ["Bip01 {s} Finger4", "Bip01 {s} Finger41", "Bip01 {s} Finger42"]}, _biped),
    Preset("Mixamo", ("Right", "Left"),
           {"pelvis": ["Hips"], "spine": ["Spine"], "chest": ["Spine2", "Spine1"], "neck": ["Neck"], "head": ["Head"]},
           {"clavicle": ["{s}Shoulder"], "upper_arm": ["{s}Arm"], "forearm": ["{s}ForeArm"], "hand": ["{s}Hand"],
            "thigh": ["{s}UpLeg"], "calf": ["{s}Leg"], "foot": ["{s}Foot"], "toe": ["{s}ToeBase"]},
           {"finger_a": ["{s}HandIndex1", "{s}HandIndex2", "{s}HandIndex3"],
            "finger_b": ["{s}HandRing1", "{s}HandRing2", "{s}HandRing3"],
            "thumb": ["{s}HandThumb1", "{s}HandThumb2", "{s}HandThumb3"]},
           {"finger_a": ["{s}HandMiddle1", "{s}HandMiddle2", "{s}HandMiddle3"],
            "finger_b": ["{s}HandPinky1", "{s}HandPinky2", "{s}HandPinky3"]}, _strip(r"^mixamorig\d*[:_]")),
    Preset("Blender Rigify / metarig", ("R", "L"),
           {"pelvis": ["spine"], "spine": ["spine.001"], "chest": ["spine.003", "spine.002"],
            "neck": ["spine.004"], "head": ["spine.006", "spine.005"]},
           {"clavicle": ["shoulder.{s}"], "upper_arm": ["upper_arm.{s}"], "forearm": ["forearm.{s}"],
            "hand": ["hand.{s}"], "thigh": ["thigh.{s}"], "calf": ["shin.{s}"], "foot": ["foot.{s}"],
            "toe": ["toe.{s}"]},
           {"finger_a": ["f_index.01.{s}", "f_index.02.{s}", "f_index.03.{s}"],
            "finger_b": ["f_ring.01.{s}", "f_ring.02.{s}", "f_ring.03.{s}"],
            "thumb": ["thumb.01.{s}", "thumb.02.{s}", "thumb.03.{s}"]},
           {"finger_a": ["f_middle.01.{s}", "f_middle.02.{s}", "f_middle.03.{s}"],
            "finger_b": ["f_pinky.01.{s}", "f_pinky.02.{s}", "f_pinky.03.{s}"]}, _rigify),
    Preset("Unreal mannequin", ("r", "l"),
           {"pelvis": ["pelvis"], "spine": ["spine_01"], "chest": ["spine_03", "spine_02"], "neck": ["neck_01"],
            "head": ["head"]},
           {"clavicle": ["clavicle_{s}"], "upper_arm": ["upperarm_{s}"], "forearm": ["lowerarm_{s}"],
            "hand": ["hand_{s}"], "thigh": ["thigh_{s}"], "calf": ["calf_{s}"], "foot": ["foot_{s}"],
            "toe": ["ball_{s}"]},
           {"finger_a": ["index_01_{s}", "index_02_{s}", "index_03_{s}"],
            "finger_b": ["ring_01_{s}", "ring_02_{s}", "ring_03_{s}"], "thumb": ["thumb_01_{s}", "thumb_02_{s}", "thumb_03_{s}"]},
           {"finger_a": ["middle_01_{s}", "middle_02_{s}", "middle_03_{s}"],
            "finger_b": ["pinky_01_{s}", "pinky_02_{s}", "pinky_03_{s}"]}, _strip(r"^$")),
    Preset("VRM / VRoid", ("R", "L"),
           {"pelvis": ["J_Bip_C_Hips"], "spine": ["J_Bip_C_Spine"], "chest": ["J_Bip_C_UpperChest", "J_Bip_C_Chest"],
            "neck": ["J_Bip_C_Neck"], "head": ["J_Bip_C_Head"]},
           {"clavicle": ["J_Bip_{s}_Shoulder"], "upper_arm": ["J_Bip_{s}_UpperArm"],
            "forearm": ["J_Bip_{s}_LowerArm"], "hand": ["J_Bip_{s}_Hand"], "thigh": ["J_Bip_{s}_UpperLeg"],
            "calf": ["J_Bip_{s}_LowerLeg"], "foot": ["J_Bip_{s}_Foot"], "toe": ["J_Bip_{s}_ToeBase"]},
           {"finger_a": ["J_Bip_{s}_Index1", "J_Bip_{s}_Index2", "J_Bip_{s}_Index3"],
            "finger_b": ["J_Bip_{s}_Ring1", "J_Bip_{s}_Ring2", "J_Bip_{s}_Ring3"],
            "thumb": ["J_Bip_{s}_Thumb1", "J_Bip_{s}_Thumb2", "J_Bip_{s}_Thumb3"]},
           {"finger_a": ["J_Bip_{s}_Middle1", "J_Bip_{s}_Middle2", "J_Bip_{s}_Middle3"],
            "finger_b": ["J_Bip_{s}_Little1", "J_Bip_{s}_Little2", "J_Bip_{s}_Little3"]}, _strip(r"^$")),
    Preset("Unity Humanoid", ("Right", "Left"),
           {"pelvis": ["Hips"], "spine": ["Spine"], "chest": ["UpperChest", "Chest"], "neck": ["Neck"], "head": ["Head"]},
           {"clavicle": ["{s}Shoulder"], "upper_arm": ["{s}UpperArm"], "forearm": ["{s}LowerArm"],
            "hand": ["{s}Hand"], "thigh": ["{s}UpperLeg"], "calf": ["{s}LowerLeg"], "foot": ["{s}Foot"],
            "toe": ["{s}Toes"]},
           {"finger_a": ["{s}IndexProximal", "{s}IndexIntermediate", "{s}IndexDistal"],
            "finger_b": ["{s}RingProximal", "{s}RingIntermediate", "{s}RingDistal"],
            "thumb": ["{s}ThumbProximal", "{s}ThumbIntermediate", "{s}ThumbDistal"]},
           {"finger_a": ["{s}MiddleProximal", "{s}MiddleIntermediate", "{s}MiddleDistal"],
            "finger_b": ["{s}LittleProximal", "{s}LittleIntermediate", "{s}LittleDistal"]}, _strip(r"^$")),
]

KEYWORDS = [
    ("pelvis", ("pelvis", "hips", "hip")), ("chest", ("chest", "upperchest", "spine2", "spine3")),
    ("spine", ("spine", "spine1", "torso", "abdomen")), ("neck", ("neck",)), ("head", ("head",)),
    ("clavicle", ("clavicle", "shoulder", "collar")), ("forearm", ("forearm", "lowerarm", "elbow")),
    ("upper_arm", ("upperarm", "arm")), ("hand", ("hand", "wrist")), ("thigh", ("thigh", "upleg", "upperleg")),
    ("calf", ("calf", "shin", "lowerleg", "knee", "leg")), ("foot", ("foot", "ankle")),
    ("toe", ("toe", "toes", "toebase", "ball")),
]
SIDE_TOKENS = {"R": ("r", "right", "rt"), "L": ("l", "left", "lt")}


class AutoMap:

    def __init__(self, preset, mapping, overrides):
        self.preset, self.mapping, self.overrides = preset, mapping, overrides


def auto_map(model, skeleton):
    """The preset that maps the most required nodes, as (name, {node: joint}, {joint: node})."""
    weighted = model.weighted()
    names = model.joint_names()
    best = None
    for preset in PRESETS:
        lookup = {}
        for n in names:
            lookup.setdefault(preset.normalize(n), n)
        primary, extra = preset.candidates()
        mapping, used = {}, set()
        for role, cands in primary:
            node = skeleton.node(role)
            if node is None:
                continue
            for c in cands:
                j = lookup.get(preset.normalize(c))
                if j is not None and j not in used:
                    mapping[node] = j
                    used.add(j)
                    break
        overrides = {}
        for cand, role in extra:
            j, node = lookup.get(preset.normalize(cand)), skeleton.node(role)
            if j is not None and node is not None and j not in used and j in weighted:
                overrides[j] = node
        score = (sum(1 for r in skeleton.required_roles() if skeleton.node(r) in mapping), len(mapping))
        if best is None or score > best[0]:
            best = (score, AutoMap(preset.name, mapping, overrides))
    if best[0][0] < len(skeleton.required_roles()):
        fuzzy = keyword_map(model, skeleton)
        score = (sum(1 for r in skeleton.required_roles() if skeleton.node(r) in fuzzy), len(fuzzy))
        if score > best[0]:
            return AutoMap("name keywords (check every row)", fuzzy, {})
    return best[1]


def tokens(name):
    name = re.sub(r"([a-z])([A-Z])", r"\1 \2", name)
    return [t for t in re.split(r"[^A-Za-z0-9]+", name.lower()) if t]


def side_of(toks):
    for side, words in SIDE_TOKENS.items():
        if any(t in words for t in toks):
            return side
    return None


def keyword_map(model, skeleton):
    mapping, used = {}, set()
    joints = [(j.name, tokens(j.name)) for j in model.joints]
    for role, words in KEYWORDS:
        for side in (None,) + SIDES:
            full = role if role in ("pelvis", "spine", "chest", "neck", "head") else None
            if full and side is not None or not full and side is None:
                continue
            node = skeleton.node(full or "%s.%s" % (side, role))
            if node is None or node in mapping:
                continue
            for name, toks in joints:
                if name in used or side_of(toks) != side:
                    continue
                flat = "".join(t for t in toks if t not in SIDE_TOKENS.get(side or "", ()))
                if any(flat.endswith(w) or w in toks for w in words):
                    mapping[node] = name
                    used.add(name)
                    break
    return mapping


def translate(mapping, overrides, old, new):
    """A mapping moved from skeleton old to skeleton new through the bones' roles (or the same number for
    bones without a role when both skeletons have the same layout); bones with no match are dropped."""
    same = old.body == new.body

    def move(node):
        if node is None or node >= len(old.nodes):
            return None
        role = old.nodes[node].role
        if role:
            return new.node(role)
        return node if same and node < len(new.nodes) and new.nodes[node].name == old.nodes[node].name else None
    m = {}
    for node, joint in mapping.items():
        n = move(node)
        if n is not None:
            m[n] = joint
    o = {}
    for joint, node in overrides.items():
        n = move(node)
        if n is not None:
            o[joint] = n
    return m, o


def effective(model, mapping, overrides):
    """{joint: game node or None}: its own node, else its nearest mapped ancestor's."""
    direct = {}
    for node, joint in sorted(mapping.items()):
        direct.setdefault(joint, node)
    direct.update({j: n for j, n in overrides.items() if n is not None})
    out = {}
    for jt in model.joints:
        chain, name = [], jt.name
        while name is not None and name not in out and name not in direct:
            chain.append(name)
            name = model.by_name[name].parent
        t = out.get(name) if name in out else direct.get(name)
        for n in chain:
            out[n] = t
        if jt.name in direct:
            out[jt.name] = direct[jt.name]
    return out


def check(model, skeleton, mapping, overrides):
    """[(level, message)], level "error" or "warning"."""
    out = []
    names = set(model.joint_names())
    count = len(skeleton.nodes)
    seen = {}
    for node, joint in mapping.items():
        if not 0 <= node < count:
            out.append(("error", "game bone %d does not exist on this base" % node))
        if joint not in names:
            out.append(("error", "the model has no joint %s" % joint))
        elif joint in seen:
            out.append(("error", "%s is mapped to two game bones (%s and %s)" % (
                joint, skeleton.nodes[seen[joint]].name, skeleton.nodes[node].name)))
        seen.setdefault(joint, node)
    for joint, node in overrides.items():
        if joint not in names:
            out.append(("error", "the model has no joint %s" % joint))
        if node is not None and not 0 <= node < count:
            out.append(("error", "game bone %d does not exist on this base" % node))
    for role in skeleton.required_roles():
        if skeleton.node(role) not in mapping:
            out.append(("error", "%s is not mapped" % skeleton.nodes[skeleton.node(role)].name))
    for side in SIDES:
        for chain in CHAINS:
            nodes = skeleton.chain(side, chain)
            mapped = [n in mapping for n in nodes]
            if any(mapped) and mapped != sorted(mapped, reverse=True):
                out.append(("error", "%s %s: map the chain from its first bone, without gaps" % (side, chain)))
    eff = effective(model, mapping, overrides)
    lost = [n for n, c in model.weighted().items() if eff.get(n) is None]
    if lost and not out:
        out.append(("warning", "%d joint(s) with weights have no mapped parent and follow the pelvis: %s" % (
            len(lost), ", ".join(sorted(lost)[:5]))))
    return out
