import os

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QBrush, QColor
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDoubleSpinBox, QFileDialog, QFormLayout, QHBoxLayout, QLabel,
                               QListWidget, QPushButton, QSplitter, QTabWidget, QTreeWidget, QTreeWidgetItem,
                               QVBoxLayout, QWidget)

from ...formats import LabError, call, ngmtool
from ...model import bundle, glb, mapping
from ...model.fit import Fit
from ...package import imperfect
from .. import meshes
from ..viewport import Viewport
from ..widgets import note
from . import Page

MODES = ("Fitted over base", "Fitted", "Your model", "Base character")
NONE = "(none)"
FOLLOW = "(follows its parent)"


def default_materials(model):
    used = sorted({p.material for p in model.prims if p.material is not None})
    out = []
    for k, i in enumerate(used):
        mat = model.materials[i]
        size = (256, 256)
        if mat.image is not None:
            try:
                w, h = model.image(mat.image).size
                size = tuple(min(512, 1 << max(3, (max(8, d) - 1).bit_length())) for d in (w, h))
            except Exception:
                pass
        out.append(imperfect.Material(i, mat.name, True, "" if k == 0 else "_m%d" % k, size))
    return out


class ModelPage(Page):
    title = "3. Model"

    def __init__(self, win):
        super().__init__(win)
        lay = QVBoxLayout(self)
        top = QHBoxLayout()
        imp = QPushButton("Import model (.glb)...")
        imp.clicked.connect(self.import_glb)
        top.addWidget(imp)
        self.automap = QPushButton("Auto-map")
        self.automap.clicked.connect(self.auto_map)
        top.addWidget(self.automap)
        clear = QPushButton("Clear mapping")
        clear.clicked.connect(self.clear_mapping)
        top.addWidget(clear)
        self.info = QLabel()
        top.addWidget(self.info, 1)
        lay.addLayout(top)

        split = QSplitter()
        left = QWidget()
        ll = QVBoxLayout(left)
        ll.setContentsMargins(0, 0, 0, 0)
        self.view = Viewport()
        ll.addWidget(self.view, 1)
        row = QHBoxLayout()
        self.mode = QComboBox()
        self.mode.addItems(MODES)
        self.mode.currentIndexChanged.connect(self.show_scene)
        row.addWidget(self.mode)
        for name in ("front", "right", "back"):
            b = QPushButton(name.capitalize())
            b.clicked.connect(lambda _=False, n=name: self.view.view(n))
            row.addWidget(b)
        self.bones = QCheckBox("Bones")
        self.bones.setChecked(True)
        self.bones.toggled.connect(self.toggle_bones)
        row.addWidget(self.bones)
        row.addStretch()
        self.busy = QLabel()
        row.addWidget(self.busy)
        ll.addLayout(row)
        split.addWidget(left)

        right = QWidget()
        rl = QVBoxLayout(right)
        rl.setContentsMargins(0, 0, 0, 0)
        self.tabs = QTabWidget()
        self.game_tree = QTreeWidget()
        self.game_tree.setHeaderLabels(["Game bone", "Your model's joint"])
        self.game_tree.setColumnWidth(0, 190)
        self.game_tree.currentItemChanged.connect(self.select_game_bone)
        self.tabs.addTab(self.game_tree, "By game bone")
        self.model_tree = QTreeWidget()
        self.model_tree.setHeaderLabels(["Your model's joint", "Vertices", "Moves with", "Override"])
        self.model_tree.setColumnWidth(0, 200)
        self.model_tree.currentItemChanged.connect(self.select_joint)
        self.tabs.addTab(self.model_tree, "By model joint")
        fitw = QWidget()
        form = QFormLayout(fitw)
        self.auto_scale = QCheckBox("Automatic (the legs get the base's length)")
        self.auto_scale.toggled.connect(self.fit_edited)
        self.scale = QDoubleSpinBox()
        self.scale.setDecimals(4)
        self.scale.setRange(0.0001, 10000)
        self.scale.valueChanged.connect(self.fit_edited)
        self.squash = QCheckBox("Fit the torso to the base's shoulder height")
        self.squash.toggled.connect(self.fit_edited)
        self.facing = QComboBox()
        self.facing.addItems(["Detect from the arms", "Facing forwards", "Facing backwards"])
        self.facing.currentIndexChanged.connect(self.fit_edited)
        form.addRow("Scale", self.auto_scale)
        form.addRow("", self.scale)
        form.addRow("Torso", self.squash)
        form.addRow("Facing", self.facing)
        self.report = QLabel()
        self.report.setWordWrap(True)
        form.addRow(self.report)
        self.tabs.addTab(fitw, "Fit")
        rl.addWidget(self.tabs, 3)
        rl.addWidget(note("Problems"))
        self.problems = QListWidget()
        rl.addWidget(self.problems, 1)
        split.addWidget(right)
        split.setSizes([620, 560])
        lay.addWidget(split, 1)

        self.timer = QTimer(self)
        self.timer.setSingleShot(True)
        self.timer.setInterval(350)
        self.timer.timeout.connect(self.update_preview)
        self.fitted, self.base_scene, self.base_key, self.fit = None, None, None, None
        self._job = None
        self._again = False
        self._reframe, self._last_mode = True, None
        s = self.state
        s.model_changed.connect(self.rebuild)
        s.mapping_changed.connect(self.mapping_changed)
        s.game_changed.connect(self.rebuild)
        s.character_changed.connect(self.schedule)
        self.rebuild()

    # data

    def skeleton(self):
        return self.state.skeleton() if self.state.game else None

    def refresh(self):
        self.update_info()
        if self.fitted is None:
            self.schedule()

    def update_info(self):
        m, c = self.state.model, self.state.character
        if self.state.model_error:
            self.info.setText("The model could not be read: %s" % self.state.model_error)
        elif m is None:
            self.info.setText("Import your character's model: a .glb with one skinned mesh (a rig of any common kind).")
        else:
            self.info.setText("%d joints, %d triangles, %d materials" % (len(m.joints), m.triangle_count(), len(m.materials)))
        if self.state.game is None:
            self.info.setText(self.info.text() + " - choose your game disc to map the model.")
        elif self.skeleton() is None:
            self.info.setText(self.info.text() + " - %s's skeleton is not supported yet; pick another base." %
                              self.state.base().label)

    def rebuild(self):
        """Fill both trees from scratch (new model, new base or new disc)."""
        self._refreshing = True
        self.game_tree.clear()
        self.model_tree.clear()
        self.fitted, self.fit = None, None
        self._reframe = True
        sk, m, c = self.skeleton(), self.state.model, self.state.character
        joints = [j.name for j in m.joints] if m else []
        self.combos = {}
        if sk is not None:
            groups = {}
            twist_nodes = {sk.node(t[0]) for t in sk.twist.values()}
            for g in sk.groups:
                item = QTreeWidgetItem([g.capitalize(), ""])
                item.setFlags(item.flags() & ~Qt.ItemIsSelectable)
                groups[g] = item
                self.game_tree.addTopLevelItem(item)
            for n in sk.nodes:
                parent = groups.get(n.group) or groups.setdefault(n.group, QTreeWidgetItem([n.group, ""]))
                label = "%s%s" % (n.name, " *" if n.required else "")
                item = QTreeWidgetItem(parent, [label, ""])
                item.setData(0, Qt.UserRole, n.index)
                item.setToolTip(0, "game bone %d%s" % (n.index, ", required" if n.required else ""))
                if n.index in twist_nodes:
                    item.setText(1, "automatic (twist)")
                    item.setForeground(1, QBrush(QColor("#8a8f99")))
                    continue
                combo = QComboBox()
                combo.addItem(NONE)
                combo.addItems(joints)
                combo.setCurrentText(c.mapping.get(n.index, NONE))
                combo.currentTextChanged.connect(lambda text, node=n.index: self.map_edited(node, text))
                self.game_tree.setItemWidget(item, 1, combo)
                self.combos[n.index] = combo
            for item in groups.values():
                item.setExpanded(True)
        self.joint_items = {}
        if m is not None:
            weighted = m.weighted()
            for j in m.joints:
                parent = self.joint_items.get(j.parent)
                item = QTreeWidgetItem([j.name, str(weighted.get(j.name, 0)), "", ""])
                item.setData(0, Qt.UserRole, j.name)
                if parent is None:
                    self.model_tree.addTopLevelItem(item)
                else:
                    parent.addChild(item)
                self.joint_items[j.name] = item
                if sk is not None and weighted.get(j.name):
                    combo = QComboBox()
                    combo.addItem(FOLLOW)
                    for n in sk.nodes:
                        combo.addItem("%d %s" % (n.index, n.name), n.index)
                    k = combo.findData(c.overrides.get(j.name)) if j.name in c.overrides else 0
                    combo.setCurrentIndex(max(0, k))
                    combo.currentIndexChanged.connect(lambda i, joint=j.name, cb=combo: self.override_edited(joint, cb.itemData(i)))
                    self.model_tree.setItemWidget(item, 3, combo)
            self.model_tree.expandAll()
        self._refreshing = False
        self.load_fit_options()
        self.update_info()
        self.update_status()
        self.schedule()

    def load_fit_options(self):
        self._refreshing = True
        f = self.state.character.fit
        self.auto_scale.setChecked(not f.get("scale"))
        self.scale.setEnabled(bool(f.get("scale")))
        if f.get("scale"):
            self.scale.setValue(f["scale"])
        self.squash.setChecked(f.get("torso_squash", True))
        self.facing.setCurrentIndex({None: 0, False: 1, True: 2}[f.get("flip")])
        self._refreshing = False

    def mapping_changed(self):
        if self._refreshing:
            return
        self._refreshing = True
        c = self.state.character
        for node, combo in self.combos.items():
            want = c.mapping.get(node, NONE)
            if combo.currentText() != want:
                combo.setCurrentText(want)
        self._refreshing = False
        self.update_status()
        self.schedule()

    def update_status(self):
        sk, m, c = self.skeleton(), self.state.model, self.state.character
        self.problems.clear()
        if sk is None or m is None:
            return
        eff = mapping.effective(m, c.mapping, c.overrides)
        for name, item in self.joint_items.items():
            node = eff.get(name)
            item.setText(2, sk.nodes[node].name if node is not None and node < len(sk.nodes) else "pelvis (no mapped parent)")
            direct = name in c.overrides or name in c.mapping.values()
            item.setForeground(2, QBrush(QColor("#e8e8e8" if direct else "#8a8f99")))
        for level, msg in mapping.check(m, sk, c.mapping, c.overrides):
            self.problems.addItem(("✖ " if level == "error" else "⚠ ") + msg)
        if not self.problems.count():
            self.problems.addItem("✔ The mapping is complete.")

    # edits

    def map_edited(self, node, text):
        if self._refreshing:
            return
        c = self.state.character
        if text == NONE:
            c.mapping.pop(node, None)
        else:
            c.mapping[node] = text
        self._refreshing = True
        self.state.touch("mapping")
        self._refreshing = False
        self.update_status()
        self.schedule()

    def override_edited(self, joint, node):
        if self._refreshing:
            return
        c = self.state.character
        if node is None:
            c.overrides.pop(joint, None)
        else:
            c.overrides[joint] = node
        self._refreshing = True
        self.state.touch("mapping")
        self._refreshing = False
        self.update_status()
        self.schedule()

    def fit_edited(self, *_):
        if self._refreshing:
            return
        f = self.state.character.fit
        self.scale.setEnabled(not self.auto_scale.isChecked())
        f["scale"] = None if self.auto_scale.isChecked() else self.scale.value()
        f["torso_squash"] = self.squash.isChecked()
        f["flip"] = {0: None, 1: False, 2: True}[self.facing.currentIndex()]
        self.edited_character()
        self.schedule()

    def auto_map(self):
        sk, m = self.skeleton(), self.state.model
        if sk is None or m is None:
            return
        auto = mapping.auto_map(m, sk)
        c = self.state.character
        c.mapping, c.overrides = auto.mapping, auto.overrides
        self.win.message("Mapped with the %s preset" % auto.preset)
        self.state.touch("mapping")
        self.rebuild()

    def clear_mapping(self):
        c = self.state.character
        c.mapping, c.overrides = {}, {}
        self.state.touch("mapping")
        self.rebuild()

    def import_glb(self):
        path, _ = QFileDialog.getOpenFileName(self, "Import a model", os.path.expanduser("~"), "Binary glTF (*.glb)")
        if path:
            self.import_path(path)

    def import_path(self, path):
        try:
            with open(path, "rb") as f:
                raw = f.read()
            full = glb.Model(raw)
            keep = {mat.image for mat in full.materials if mat.image is not None}
            slim = imperfect.slim_glb(raw, keep)
            model = glb.Model(slim)
        except (OSError, LabError) as e:
            self.win.error("The model could not be imported:\n%s" % e)
            return
        c = self.state.character
        c.glb = slim
        c.materials = default_materials(model)
        c.mapping, c.overrides = {}, {}
        self.state.model, self.state.model_error = model, None
        sk = self.skeleton()
        if sk is not None:
            auto = mapping.auto_map(model, sk)
            c.mapping, c.overrides = auto.mapping, auto.overrides
            self.win.message("Imported %s (%d KB after dropping animations and unused data); mapped with the %s preset" % (
                os.path.basename(path), len(slim) // 1024, auto.preset))
        name = os.path.splitext(os.path.basename(path))[0]
        if not any(a.get("what") == "model" for a in c.credits.get("assets", [])):
            c.credits.setdefault("assets", []).append({"what": "model", "by": "", "license": "", "url": name})
        self.state.touch("model")
        self.rebuild()

    # preview

    def schedule(self):
        if self.isVisible() or self.fitted is None:
            self.timer.start()

    def update_preview(self):
        if self._job is not None:
            self._again = True
            return
        sk, m, c = self.skeleton(), self.state.model, self.state.character
        if sk is None or m is None:
            self.view.set_scene([], [])
            return
        game, base = self.state.game, self.state.base()
        need_base = self.base_key != c.base
        spec = c.copy()
        spec.glb = None

        def work(report):
            f = Fit(m, sk, spec.mapping, spec.overrides, spec.fit.get("scale"), spec.fit.get("torso_squash", True),
                    spec.fit.get("flip"))
            included = [x for x in spec.materials if x.include]
            slots = {x.gltf_material: (None, False) for x in spec.materials}
            slots.update({x.gltf_material: (i, x.two_sided, x.bind) for i, x in enumerate(included)})
            tris = f.triangles(slots)
            images = meshes.material_images(m, c)
            by_slot = {i: images.get(x.gltf_material) for i, x in enumerate(included)}
            fitted = meshes.fitted_meshes(tris, by_slot)
            stats = None
            try:
                ngm = base.bundle_files()[0]
                _, models = call(ngmtool.read, ngm)
                nidx = bundle.NormalIndex(bundle.read_normals(game.entry("Misc/NormalTable.ngn")))
                render = bundle.render_model(models[0], {k: list(v) for k, v in tris.items()}, nidx, "x", ["m"] * len(included),
                                             models[0].meshes[0][5])
                data, _ = bundle.build_ngm(ngm, render, {})
                stats = (len(render.meshes), len(render.indices) // 3, len(data), len(ngm))
            except LabError as e:
                stats = str(e)
            source = meshes.source_meshes(m, c, f.flip)
            base_scene = meshes.base_meshes(game, base) if need_base else None
            return f, fitted, source, base_scene, stats

        self.busy.setText("updating...")

        def done(result):
            self._job = None
            self.busy.setText("")
            self.fit, self.fitted, self.source, base_scene, stats = result
            if base_scene is not None:
                self.base_scene, self.base_key = base_scene, c.base
            if isinstance(stats, tuple):
                parts, tris, size, base_size = stats
                self.report.setText("Scale %.3f%s. In the game: %d triangles in %d parts; model bundle %d KB (%s's is %d KB)." % (
                    self.fit.S, ", facing backwards (turned)" if self.fit.flip else "", tris, parts, size // 1024,
                    self.state.base().label, base_size // 1024))
            elif stats:
                self.report.setText("✖ " + stats)
            self.show_scene()
            if self._again:
                self._again = False
                self.update_preview()

        def failed(msg):
            self._job = None
            self.busy.setText("")
            self.fitted = None
            self.report.setText("✖ " + msg.strip().splitlines()[-1])
            self.view.set_scene([], meshes.game_bones(sk))
            if self._again:
                self._again = False
                self.update_preview()

        self._job = self.win.jobs.start(work, done, failed)

    def show_scene(self):
        sk, m = self.skeleton(), self.state.model
        if sk is None or m is None or self.fitted is None:
            return
        mode = self.mode.currentIndex()
        fit_view = self._reframe or mode != self._last_mode
        self._reframe, self._last_mode = False, mode
        if mode == 2:
            self.view.set_scene(self.source, meshes.source_bones(m, self.fit.flip), fit=fit_view)
        elif mode == 3:
            self.view.set_scene(self.base_scene or [], meshes.game_bones(sk), fit=fit_view)
        elif mode == 1:
            self.view.set_scene(self.fitted, meshes.game_bones(sk), fit=fit_view)
        else:
            ghost = [meshes.MeshData(x.positions, x.normals, x.uvs, x.image, 0.25, x.influences) for x in self.base_scene or []]
            self.view.set_scene(self.fitted + ghost, meshes.game_bones(sk), fit=fit_view)
        self.apply_highlight()

    def toggle_bones(self, on):
        self.view.show_bones = on
        self.view.update()

    # selection

    def select_game_bone(self, item, _=None):
        self.apply_highlight()

    def select_joint(self, item, _=None):
        self.apply_highlight()

    def apply_highlight(self):
        mode = self.mode.currentIndex()
        c = self.state.character
        if self.tabs.currentIndex() == 1:
            item = self.model_tree.currentItem()
            joint = item.data(0, Qt.UserRole) if item else None
            if mode == 2:
                self.view.set_highlight(joint)
            elif joint is not None and self.state.model is not None:
                self.view.set_highlight(mapping.effective(self.state.model, c.mapping, c.overrides).get(joint))
            else:
                self.view.set_highlight(None)
            return
        item = self.game_tree.currentItem()
        node = item.data(0, Qt.UserRole) if item else None
        self.view.set_highlight(c.mapping.get(node) if mode == 2 else node)
