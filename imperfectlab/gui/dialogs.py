"""The crop dialog (exact-size pictures) and the select-screen portrait placement dialog."""
from PySide6.QtCore import QRectF, Qt, QTimer
from PySide6.QtGui import QPen
from PySide6.QtWidgets import (QCheckBox, QDialog, QDialogButtonBox, QDoubleSpinBox, QFormLayout, QGraphicsItem,
                               QGraphicsRectItem, QGraphicsScene, QGraphicsView, QHBoxLayout, QLabel, QSpinBox,
                               QTabWidget, QVBoxLayout, QWidget)

from ..build import images, portraits
from ..build.patch import default_placement, glow_rgba
from .widgets import ColorButton, note, pil_to_pixmap


class _Box(QGraphicsRectItem):
    def __init__(self, w, h, changed):
        super().__init__(QRectF(-w / 2, -h / 2, w, h))
        self.changed = changed
        self.setFlags(QGraphicsItem.ItemIsMovable | QGraphicsItem.ItemSendsGeometryChanges)
        self.setPen(QPen(Qt.yellow, 0))
        self.setCursor(Qt.SizeAllCursor)

    def itemChange(self, change, value):
        if change == QGraphicsItem.ItemPositionHasChanged:
            self.changed()
        return super().itemChange(change, value)


class _View(QGraphicsView):
    def __init__(self, scene, box):
        super().__init__(scene)
        self.box = box

    def wheelEvent(self, e):
        r = self.box.rect()
        k = 0.92 if e.angleDelta().y() > 0 else 1 / 0.92
        self.box.setRect(QRectF(-r.width() * k / 2, -r.height() * k / 2, r.width() * k, r.height() * k))
        self.box.changed()

    def resizeEvent(self, e):
        super().resizeEvent(e)
        self.fitInView(self.sceneRect(), Qt.KeepAspectRatio)


class CropDialog(QDialog):
    """Pick the part of a picture that becomes an exact-size game picture."""

    def __init__(self, parent, im, size, title):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.resize(900, 640)
        self.im, self.size = im.convert("RGBA"), size
        self.timer = QTimer(self)
        self.timer.setSingleShot(True)
        self.timer.setInterval(60)
        self.timer.timeout.connect(self.update_preview)
        scene = QGraphicsScene(self)
        scene.addPixmap(pil_to_pixmap(self.im))
        aspect = size[0] / size[1]
        w, h = self.im.size
        bw, bh = (h * aspect, h) if w / h > aspect else (w, w / aspect)
        self.box = _Box(bw, bh, self.schedule)
        self.box.setPos(w / 2, h / 2)
        scene.addItem(self.box)
        scene.setSceneRect(0, 0, w, h)
        lay = QHBoxLayout(self)
        self.view = _View(scene, self.box)
        lay.addWidget(self.view, 1)
        side = QVBoxLayout()
        side.addWidget(note("Drag the box; the mouse wheel resizes it. The result is %dx%d pixels." % size))
        self.preview = QLabel()
        self.preview.setFixedSize(max(140, size[0] * 2), max(140, size[1] * 2))
        self.preview.setAlignment(Qt.AlignCenter)
        side.addWidget(self.preview)
        side.addStretch()
        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        side.addWidget(buttons)
        lay.addLayout(side)
        self.update_preview()

    def schedule(self):
        self.timer.start()

    def cropped(self):
        r = self.box.mapRectToScene(self.box.rect())
        return images.crop_resize(self.im, (r.left(), r.top(), r.right(), r.bottom()), self.size)

    def update_preview(self):
        im = self.cropped()
        scale = max(1, min(self.preview.width() // im.width, self.preview.height() // im.height))
        self.preview.setPixmap(pil_to_pixmap(im.resize((im.width * scale, im.height * scale))))

    @staticmethod
    def crop(parent, im, size, title):
        d = CropDialog(parent, im, size, title)
        return d.cropped() if d.exec() == QDialog.Accepted else None


class _Canvas(QLabel):
    def __init__(self, dragged):
        super().__init__()
        self.dragged = dragged
        self.last = None
        self.setCursor(Qt.OpenHandCursor)
        self.setAlignment(Qt.AlignLeft | Qt.AlignTop)

    def mousePressEvent(self, e):
        self.last = e.position()

    def mouseMoveEvent(self, e):
        if self.last is not None:
            d = e.position() - self.last
            self.last = e.position()
            self.dragged(d.x(), d.y())

    def mouseReleaseEvent(self, e):
        self.last = None


ZOOM = 2


class PlacementDialog(QDialog):
    """Where each select-screen pose's picture sits, previewed as the game will draw it."""

    def __init__(self, parent, state, pictures):
        super().__init__(parent)
        self.setWindowTitle("Place the select-screen portrait")
        self.resize(1000, 720)
        self.state = state
        self.layout_ = portraits.SelectLayout(state.game)
        self.records = {}
        for i, pose, size in self.layout_.canvases():
            if pose not in self.records or size[0] * size[1] > self.records[pose][1][0] * self.records[pose][1][1]:
                self.records[pose] = (i, size)
        c = state.character
        self.pictures = pictures
        sel = c.ui.get("select", {})
        self.spec = {}
        for pose in portraits.POSES:
            p = sel.get(pose) or (sel.get("ready") if pose != "rest" else None) or default_placement(pictures[pose])
            self.spec[pose] = {"scale": p["scale"], "anchor": list(p["anchor"]), "glow": p.get("glow")}
        self.fade = c.ui.get("fade", portraits.FADE)
        lay = QVBoxLayout(self)
        lay.addWidget(note("Drag a picture to move it, and set its size. The faint picture is Johnny Ohm's, which every "
                           "new character's portrait is laid out like; put the face about where his is."))
        self.tabs = QTabWidget()
        self.widgets = {}
        for pose, label in (("ready", "READY (costume 1 picked)"), ("readyalt", "READY (costume 2 picked)"),
                            ("rest", "REST (cursor on the tile)")):
            w = QWidget()
            h = QHBoxLayout(w)
            canvas = _Canvas(lambda dx, dy, pose=pose: self.dragged(pose, dx, dy))
            h.addWidget(canvas, 1)
            form = QFormLayout()
            scale = QDoubleSpinBox()
            scale.setRange(0.01, 20)
            scale.setSingleStep(0.02)
            scale.setDecimals(3)
            ax, ay = QSpinBox(), QSpinBox()
            for s in (ax, ay):
                s.setRange(-8192, 8192)
            glow_on = QCheckBox("Glow")
            glow = ColorButton("#3CFF5A6E", alpha=True)
            ghost = QCheckBox("Show Johnny Ohm's")
            ghost.setChecked(True)
            form.addRow("Size", scale)
            form.addRow("Face x", ax)
            form.addRow("Face y", ay)
            form.addRow(glow_on, glow)
            form.addRow(ghost)
            h.addLayout(form)
            self.widgets[pose] = (canvas, scale, ax, ay, glow_on, glow, ghost)
            for s in (scale, ax, ay):
                s.valueChanged.connect(lambda _=0, pose=pose: self.edited(pose))
            glow_on.toggled.connect(lambda _=0, pose=pose: self.edited(pose))
            glow.changed.connect(lambda _=0, pose=pose: self.edited(pose))
            ghost.toggled.connect(lambda _=0, pose=pose: self.render(pose))
            self.tabs.addTab(w, label)
        lay.addWidget(self.tabs, 1)
        row = QHBoxLayout()
        row.addWidget(QLabel("Fade-in rows at the top"))
        self.fade_spin = QSpinBox()
        self.fade_spin.setRange(0, 200)
        self.fade_spin.setValue(self.fade)
        self.fade_spin.valueChanged.connect(self.fade_edited)
        row.addWidget(self.fade_spin)
        row.addStretch()
        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        row.addWidget(buttons)
        lay.addLayout(row)
        self._loading = False
        for pose in portraits.POSES:
            self.load(pose)

    def load(self, pose):
        self._loading = True
        canvas, scale, ax, ay, glow_on, glow, ghost = self.widgets[pose]
        sp = self.spec[pose]
        scale.setValue(sp["scale"])
        ax.setValue(int(round(sp["anchor"][0])))
        ay.setValue(int(round(sp["anchor"][1])))
        glow_on.setChecked(bool(sp["glow"]))
        if sp["glow"]:
            glow.set(sp["glow"])
        self._loading = False
        self.render(pose)

    def edited(self, pose):
        if self._loading:
            return
        canvas, scale, ax, ay, glow_on, glow, ghost = self.widgets[pose]
        self.spec[pose] = {"scale": scale.value(), "anchor": [ax.value(), ay.value()],
                           "glow": glow.color if glow_on.isChecked() else None}
        self.render(pose)

    def fade_edited(self, v):
        self.fade = v
        for pose in portraits.POSES:
            self.render(pose)

    def dragged(self, pose, dx, dy):
        i, _ = self.records[pose]
        s = self.layout_.screen_box(self.layout_.records[i])[0]
        k = self.spec[pose]["scale"] * s / self.layout_.s_r * ZOOM
        a = self.spec[pose]["anchor"]
        self.spec[pose]["anchor"] = [a[0] - dx / k, a[1] - dy / k]
        self.load(pose)

    def render(self, pose):
        from PIL import Image
        if pose not in self.records:
            return
        canvas, *_, ghost = self.widgets[pose]
        i, (W, H) = self.records[pose]
        sp = self.spec[pose]
        out = self.layout_.compose(i, pose, self.pictures[pose], sp["scale"], sp["anchor"],
                                   glow_rgba(sp["glow"]) if sp["glow"] else None, self.fade)
        bg = Image.new("RGBA", (W, H), (34, 60, 78, 255))
        if ghost.isChecked():
            orig = self.layout_.original(pose)
            if orig is not None:
                faint = orig.copy()
                faint.putalpha(faint.getchannel("A").point(lambda v: v * 35 // 100))
                bg.alpha_composite(faint)
        bg.alpha_composite(out)
        canvas.setPixmap(pil_to_pixmap(bg.resize((W * ZOOM, H * ZOOM), Image.NEAREST)))

    def placements(self):
        return {pose: dict(sp) for pose, sp in self.spec.items()}
