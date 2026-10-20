"""Fit a model onto a base character's skeleton (from Doompatcher's make_doom_model.py).

The game's animations carry the base's bone offsets, so the mesh is moved onto the base's bind pose:
one scale makes the legs the base's length, each limb bone is turned and stretched so its joints land on
the base's, the torso is squashed to the base's shoulder height, and the weights are renamed to the
base's nodes (three per vertex).
"""
import math

from ..formats import LabError
from .mapping import effective
from .skeleton import SIDES

TORSO_ROLES = ("pelvis", "spine", "chest", "neck", "head")


def add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def mul(a, k): return (a[0] * k, a[1] * k, a[2] * k)
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def length(a): return math.sqrt(dot(a, a))
def unit(a): return mul(a, 1.0 / (length(a) or 1.0))
def mat_apply(m, v): return tuple(dot(m[i], v) for i in range(3))
def mat_mul3(a, b): return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


IDENT = [[1.0, 0, 0], [0, 1.0, 0], [0, 0, 1.0]]


def rot_between(a, b):
    a, b = unit(a), unit(b)
    v, c = cross(a, b), dot(a, b)
    if c < -0.999999:
        raise LabError("a mapped bone points the opposite way from its game bone; check the mapping")
    k = 1.0 / (1.0 + c)
    vx = [[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]]
    vx2 = mat_mul3(vx, vx)
    return [[IDENT[i][j] + vx[i][j] + vx2[i][j] * k for j in range(3)] for i in range(3)]


def conv(v, flip=False):
    return (v[0], -v[2], v[1]) if flip else (-v[0], v[2], v[1])


class Bone:

    def __init__(self, P, Q, s, R=IDENT, axis=None, k=1.0):
        self.P, self.Q, self.s, self.R, self.axis, self.k = P, Q, s, R, axis, k

    def apply(self, v):
        d = mul(sub(v, self.P), self.s)
        if self.axis is not None and self.k != 1.0:
            d = add(d, mul(self.axis, (self.k - 1.0) * dot(d, self.axis)))
        return add(self.Q, mat_apply(self.R, d))


class Torso:

    def __init__(self, P_pelvis, Q_pelvis, s, z_shoulder, kz_up, kz_down):
        self.P, self.Q, self.s, self.zs, self.ku, self.kd = P_pelvis, Q_pelvis, s, z_shoulder, kz_up, kz_down
        self.R = IDENT

    def z(self, z):
        dz = z - self.P[2]
        if dz < 0:
            return self.kd * dz
        if z <= self.zs:
            return self.ku * dz
        return self.ku * (self.zs - self.P[2]) + (z - self.zs)

    def apply(self, v):
        s = self.s
        return (self.Q[0] + s * (v[0] - self.P[0]), self.Q[1] + s * (v[1] - self.P[1]), self.Q[2] + s * self.z(v[2]))


def top3(weights):
    acc = {}
    for b, w in weights:
        if w > 0:
            acc[b] = acc.get(b, 0) + w
    best = sorted(acc.items(), key=lambda x: -x[1])[:3]
    tot = sum(w for _, w in best)
    return [(b, w / tot) for b, w in best]


class Fit:
    """The model's joints mapped onto skeleton; vertex() moves one vertex onto the base."""

    def __init__(self, model, skeleton, mapping, overrides=None, scale=None, torso_squash=True, flip=None):
        self.model, self.sk = model, skeleton
        self.mapping = {int(k): v for k, v in mapping.items()}
        self.overrides = dict(overrides or {})
        self.J = skeleton.positions()
        self.role_joint = {}
        for node, joint in self.mapping.items():
            role = skeleton.nodes[node].role if node < len(skeleton.nodes) else None
            if role:
                self.role_joint[role] = joint
        missing = [r for r in skeleton.required_roles() if r not in self.role_joint]
        if missing:
            raise LabError("map these game bones first: %s" % ", ".join(
                skeleton.nodes[skeleton.node(r)].name for r in missing))
        R = self.role_joint
        if flip is None:
            right, left = model.by_name[R["R.upper_arm"]].pos, model.by_name[R["L.upper_arm"]].pos
            flip = conv(right)[0] < conv(left)[0]
        self.flip = flip
        self.D = {j.name: conv(j.pos, flip) for j in model.joints}
        self.target = effective(model, self.mapping, self.overrides)
        self.direct = {}
        for node, joint in sorted(self.mapping.items()):
            self.direct.setdefault(joint, node)
        self.direct.update({j: n for j, n in self.overrides.items() if n is not None})
        self.maps = {}
        self._build(scale, torso_squash)
        self._geo, self._wfn = {}, {}

    def _node(self, role):
        return self.sk.node(role)

    def _build(self, scale, torso_squash):
        D, J, R, maps = self.D, self.J, self.role_joint, self.maps
        avg = lambda role: mul(add(D[R["L." + role]], D[R["R." + role]]), 0.5)
        S = (J[self._node("R.thigh")][2] - J[self._node("R.foot")][2]) / (avg("thigh")[2] - avg("foot")[2])
        if scale:
            S = float(scale)
        if not S > 0:
            raise LabError("the model's legs point upwards: check the thigh and foot mapping")
        self.S = S
        pelvis = D[R["pelvis"]]
        z_sh = avg("upper_arm")[2]
        ankle_z = S * avg("foot")[2]
        kz_up = (J[self._node("R.upper_arm")][2] - J[self._node("pelvis")][2]) / (S * (z_sh - pelvis[2]))
        kz_down = (J[self._node("pelvis")][2] - ankle_z) / (S * (pelvis[2] - avg("foot")[2]))
        if not torso_squash:
            kz_up = kz_down = 1.0
        self.torso = Torso(pelvis, J[self._node("pelvis")], S, z_sh, kz_up, kz_down)
        for role in TORSO_ROLES:
            if role in R:
                maps[R[role]] = self.torso

        def seg(b, child_P, Q, Qc):
            d = sub(child_P, D[b])
            Rm = rot_between(d, sub(Qc, Q))
            maps[b] = Bone(D[b], Q, S, Rm, unit(d), length(sub(Qc, Q)) / (S * length(d)))
            return Rm

        for s in SIDES:
            n = lambda role: R.get("%s.%s" % (s, role))
            node = lambda role: self._node("%s.%s" % (s, role))
            chain = [(n(r), node(r)) for r in ("clavicle", "upper_arm", "forearm", "hand") if n(r)]
            for (b, jb), (c, jc) in zip(chain, chain[1:]):
                seg(b, D[c], J[jb], J[jc])
            hand = n("hand")
            fa, fb = self.sk.chain(s, "finger_a"), self.sk.chain(s, "finger_b")
            knuck_joint = R.get("%s.finger_a.0" % s) or R.get("%s.finger_b.0" % s)
            if knuck_joint and fa and fb:
                knuck = D[knuck_joint]
                jo_knuck = mul(add(J[fa[0]], J[fb[0]]), 0.5)
                R_hand = seg(hand, knuck, J[node("hand")], add(J[node("hand")], mul(
                    unit(sub(jo_knuck, J[node("hand")])), S * length(sub(knuck, D[hand])))))
            else:
                R_hand = maps[n("forearm")].R
                maps[hand] = Bone(D[hand], J[node("hand")], S, R_hand)
            for name in ("finger_a", "finger_b", "thumb"):
                nodes = self.sk.chain(s, name)
                joints = []
                for k in range(len(nodes)):
                    j = R.get("%s.%s.%d" % (s, name, k))
                    if j is None:
                        break
                    joints.append(j)
                if not joints:
                    continue
                dirs = [sub(J[nodes[k + 1]], J[nodes[k]]) if k + 1 < len(nodes) else sub(J[nodes[k]], J[nodes[k - 1]])
                        for k in range(len(joints))]
                self._fk(joints, maps[hand], R_hand, dirs, hand)
            hip, knee = J[node("thigh")], J[node("calf")]
            ankle = (J[node("foot")][0], J[node("foot")][1], ankle_z)
            seg(n("thigh"), D[n("calf")], hip, knee)
            seg(n("calf"), D[n("foot")], knee, ankle)
            maps[n("foot")] = Bone(D[n("foot")], ankle, S)
            if n("toe"):
                maps[n("toe")] = Bone(D[n("toe")], maps[n("foot")].apply(D[n("toe")]), S)

    def _fk(self, bones, parent_map, R_parent, dirs, hand):
        D, maps, S = self.D, self.maps, self.S
        Rm = R_parent
        for i, b in enumerate(bones):
            if i + 1 < len(bones):
                d = sub(D[bones[i + 1]], D[b])
            elif len(bones) > 1:
                d = sub(D[b], D[bones[i - 1]])
            else:
                d = sub(D[b], D[hand])
            Rm = mat_mul3(rot_between(mat_apply(Rm, d), dirs[i]), Rm)
            maps[b] = Bone(D[b], parent_map.apply(D[b]), S, Rm)
            parent_map = maps[b]

    def geo(self, joint):
        """The map that moves a vertex of joint: its own, else its nearest fitted ancestor's."""
        m = self._geo.get(joint)
        if m is None:
            name = joint
            while name is not None and name not in self.maps:
                name = self.model.by_name[name].parent
            m = self._geo[joint] = self.maps[name] if name is not None else self.torso
        return m

    def weights(self, joint, v):
        """[(node, weight)] for a vertex at v (game frame, before the fit) of joint."""
        fn = self._wfn.get(joint)
        if fn is None:
            name = joint
            while name is not None and name not in self.direct:
                name = self.model.by_name[name].parent
            fn = self._wfn[joint] = self._weight_fn(name)
        return fn(v)

    def _weight_fn(self, joint):
        if joint is None:
            node = self._node("pelvis")
            return lambda v: [(node, 1.0)]
        node = self.direct[joint]
        role = self.sk.nodes[node].role
        twist = self.sk.twist.get(role) if role and self.role_joint.get(role) == joint else None
        if twist and self.role_joint.get(twist[1]):
            twist_node, child = self._node(twist[0]), self.role_joint[twist[1]]
            t0, t1 = twist[2], twist[3]
            P = self.D[joint]
            d = sub(self.D[child], P)
            dd = dot(d, d) or 1.0

            def split(v):
                t = dot(sub(v, P), d) / dd
                f = max(0.0, min(1.0, (t - t0) / (t1 - t0)))
                return [(node, 1.0 - f), (twist_node, f)]
            return split
        return lambda v: [(node, 1.0)]

    def vertex(self, pos, nrm, skin):
        """(position, normal, [(node, weight)] x3) on the base for a vertex in glTF's frame."""
        p, n = conv(pos, self.flip), unit(conv(nrm, self.flip))
        q, nn, jw = (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), []
        for b, w in skin:
            m = self.geo(b)
            q = add(q, mul(m.apply(p), w))
            nn = add(nn, mul(mat_apply(m.R, n), w))
            jw += [(jb, w * f) for jb, f in self.weights(b, p)]
        return q, unit(nn), top3(jw)

    def triangles(self, materials):
        """{game material index: [(v0, v1, v2)]}, v = (position, normal, uv, weights).
        materials: per GLB material, (game material index or None to drop it, two-sided, node or None);
        a node binds every vertex of the material rigidly to that game node (a prop)."""
        out = {}
        for prim in self.model.prims:
            spec = materials.get(prim.material, (0, False)) if prim.material is not None else (0, False)
            slot, two_sided, bind = (tuple(spec) + (None,))[:3]
            if slot is None:
                continue
            verts = []
            for pos, n, uv, sw in zip(prim.pos, prim.nrm, prim.uv, prim.skin):
                q, nn, w = self.vertex(pos, n, sw)
                verts.append((q, nn, uv, [(bind, 1.0)] if bind is not None else w))
            lst = out.setdefault(slot, [])
            for a, b, c in prim.tris:
                lst.append((verts[a], verts[b], verts[c]))
                if two_sided:
                    flip = lambda v: (v[0], mul(v[1], -1), v[2], v[3])
                    lst.append((flip(verts[a]), flip(verts[c]), flip(verts[b])))
        return out
