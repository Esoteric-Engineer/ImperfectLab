"""A base character's game skeleton: node positions from its render model plus the hand-made role
table of its body class (skeletons/<class>.json), since the game stores no bone names."""
import json
import os

from ..formats import LabError, call, ngmtool

HERE = os.path.dirname(os.path.abspath(__file__))
SIDES = ("R", "L")
CHAINS = ("finger_a", "finger_b", "thumb")


def load_table(body):
    path = os.path.join(HERE, "skeletons", body + ".json")
    if not os.path.exists(path):
        raise LabError("%s bases are not supported yet (no bone table for that body class)" % body)
    with open(path) as f:
        return json.load(f)


class Node:
    __slots__ = ("index", "parent", "pos", "name", "group", "role", "required")

    def __init__(self, index, parent, pos, info):
        self.index, self.parent, self.pos = index, parent, pos
        self.name = info.get("name", "Node %d" % index)
        self.group = info.get("group", "props")
        self.role = info.get("role")
        self.required = info.get("required", False)


class Skeleton:

    def __init__(self, render_model, body):
        table = load_table(body)
        self.body = body
        self.groups = table["groups"]
        self.twist = table.get("twist", {})
        info = table["nodes"]
        self.nodes, anchor = [], {}
        for i, (a, b, parent, _) in enumerate(render_model.nodes):
            known = info.get(str(i))
            if known is None and 0 <= parent < len(self.nodes):
                up = self.nodes[anchor.get(parent, parent)]
                anchor[i] = up.index
                known = {"name": "Extra %d (on %s)" % (i, up.name), "group": "face" if up.role == "head" else up.group}
            self.nodes.append(Node(i, parent, tuple(-x for x in b[:3]), known or {}))
        self.roles = {n.role: n.index for n in self.nodes if n.role}

    @classmethod
    def of_base(cls, base):
        head, models = call(ngmtool.read, base.bundle_files()[0])
        return cls(models[0], base.body)

    def node(self, role):
        return self.roles.get(role)

    def positions(self):
        return [n.pos for n in self.nodes]

    def chain(self, side, name):
        out, k = [], 0
        while "%s.%s.%d" % (side, name, k) in self.roles:
            out.append(self.roles["%s.%s.%d" % (side, name, k)])
            k += 1
        return out

    def required_roles(self):
        return [n.role for n in self.nodes if n.required]

    def by_group(self):
        out = {g: [] for g in self.groups}
        for n in self.nodes:
            out.setdefault(n.group, []).append(n)
        return out
