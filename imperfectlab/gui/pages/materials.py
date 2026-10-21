import os
import re

from PySide6.QtCore import QRegularExpression
from PySide6.QtGui import QRegularExpressionValidator
from PySide6.QtWidgets import (QButtonGroup, QCheckBox, QComboBox, QFileDialog, QFormLayout, QGroupBox, QHBoxLayout,
                               QLabel, QLineEdit, QPushButton, QRadioButton, QSpinBox, QVBoxLayout)

from ...build.patch import hue_shift
from ...formats import LabError
from ...package import imperfect
from ..widgets import Thumb, heading, note
from . import Page

SIZES = [8, 16, 32, 64, 128, 256, 512, 1024]


def load_png(path):
    from PIL import Image
    im = Image.open(path)
    im.load()
    if max(im.size) > imperfect.MAX_IMAGE_SIDE:
        raise LabError("the picture is larger than %d pixels a side" % imperfect.MAX_IMAGE_SIDE)
    return im.convert("RGBA")


class MaterialCard(QGroupBox):

    def __init__(self, page, index):
        self.page, self.index = page, index
        m = self.material()
        super().__init__("Material: %s" % (m.name or m.gltf_material))
        lay = QHBoxLayout(self)
        thumbs = QVBoxLayout()
        self.thumb, self.alt_thumb = Thumb(128), Thumb(128)
        thumbs.addWidget(QLabel("Costume 1"))
        thumbs.addWidget(self.thumb)
        thumbs.addWidget(QLabel("Costume 2"))
        thumbs.addWidget(self.alt_thumb)
        lay.addLayout(thumbs)
        form = QFormLayout()
        self.draw = QCheckBox("Draw this material")
        self.draw.toggled.connect(self.edited)
        form.addRow(self.draw)
        row = QHBoxLayout()
        self.prefix = QLabel()
        self.suffix = QLineEdit()
        self.suffix.setValidator(QRegularExpressionValidator(QRegularExpression(r"(_[A-Za-z0-9]{0,7})?")))
        self.suffix.setMaximumWidth(110)
        self.suffix.textEdited.connect(self.edited)
        row.addWidget(self.prefix)
        row.addWidget(self.suffix)
        row.addStretch()
        form.addRow("Game material", row)
        row = QHBoxLayout()
        self.own = QRadioButton("The model's own")
        self.png = QRadioButton("A picture:")
        grp = QButtonGroup(self)
        grp.addButton(self.own)
        grp.addButton(self.png)
        self.own.toggled.connect(self.edited)
        choose = QPushButton("Choose...")
        choose.clicked.connect(lambda: self.choose("texture"))
        row.addWidget(self.own)
        row.addWidget(self.png)
        row.addWidget(choose)
        row.addStretch()
        form.addRow("Texture", row)
        row = QHBoxLayout()
        self.w, self.h = QComboBox(), QComboBox()
        for cb in (self.w, self.h):
            cb.addItems([str(s) for s in SIZES])
            cb.currentIndexChanged.connect(self.edited)
        row.addWidget(self.w)
        row.addWidget(QLabel("x"))
        row.addWidget(self.h)
        row.addWidget(note("pixels in the game (most characters use 256x256)"))
        row.addStretch()
        form.addRow("Size", row)
        self.two = QCheckBox("Draw both sides (capes, thin cloth)")
        self.two.toggled.connect(self.edited)
        form.addRow(self.two)
        row = QHBoxLayout()
        self.alt_mode = QComboBox()
        self.alt_mode.addItems(["Same texture", "Hue shift", "Another picture"])
        self.alt_mode.currentIndexChanged.connect(self.edited)
        self.hue = QSpinBox()
        self.hue.setRange(-180, 180)
        self.hue.setSuffix("°")
        self.hue.valueChanged.connect(self.edited)
        alt_choose = QPushButton("Choose...")
        alt_choose.clicked.connect(lambda: self.choose("alt"))
        row.addWidget(self.alt_mode)
        row.addWidget(self.hue)
        row.addWidget(alt_choose)
        row.addStretch()
        form.addRow("Costume 2", row)
        self.bind = QComboBox()
        self.bind.currentIndexChanged.connect(self.edited)
        form.addRow("Fixed to", self.bind)
        form.addRow("", note("Normally a material follows the skin weights. Fix it to one game bone for a prop (Daredevil's club is bone 39), and model it where that bone is."))
        lay.addLayout(form, 1)
        self.load()

    def material(self):
        return self.page.state.character.materials[self.index]

    def load(self):
        self.page._refreshing = True
        c, m = self.page.state.character, self.material()
        self.draw.setChecked(m.include)
        self.prefix.setText(c.internal_name + "[_alt]")
        self.suffix.setText(m.suffix)
        self.own.setChecked(not m.texture)
        self.png.setChecked(bool(m.texture))
        self.w.setCurrentText(str(m.size[0]))
        self.h.setCurrentText(str(m.size[1]))
        self.two.setChecked(m.two_sided)
        if m.alt == "same":
            self.alt_mode.setCurrentIndex(0)
        elif m.alt.startswith("hue:"):
            self.alt_mode.setCurrentIndex(1)
            self.hue.setValue(int(float(m.alt[4:])))
        else:
            self.alt_mode.setCurrentIndex(2)
        self.hue.setEnabled(self.alt_mode.currentIndex() == 1)
        self.bind.clear()
        self.bind.addItem("(follows its skin weights)", None)
        sk = self.page.state.skeleton() if self.page.state.game else None
        for n in (sk.nodes if sk else []):
            self.bind.addItem("%d %s" % (n.index, n.name), n.index)
        k = self.bind.findData(m.bind)
        self.bind.setCurrentIndex(max(0, k))
        self.page._refreshing = False
        self.previews()

    def images(self):
        c, m, model = self.page.state.character, self.material(), self.page.state.model
        im = None
        try:
            if m.texture and m.texture in c.files:
                im = imperfect.image(c.files[m.texture])
            elif model is not None and m.gltf_material < len(model.materials) and model.materials[m.gltf_material].image is not None:
                im = model.image(model.materials[m.gltf_material].image)
        except LabError:
            im = None
        alt = im
        if m.alt.startswith("hue:") and im is not None:
            alt = hue_shift(im, float(m.alt[4:]))
        elif m.alt != "same" and m.alt in c.files:
            alt = imperfect.image(c.files[m.alt])
        return im, alt

    def previews(self):
        im, alt = self.images()
        self.thumb.show_image(im)
        self.alt_thumb.show_image(alt)

    def edited(self, *_):
        if self.page._refreshing:
            return
        m, c = self.material(), self.page.state.character
        m.include = self.draw.isChecked()
        m.suffix = self.suffix.text() if re.match(r"^(_[A-Za-z0-9]{1,7})?$", self.suffix.text()) else m.suffix
        if self.own.isChecked():
            m.texture = None
        m.size = (int(self.w.currentText()), int(self.h.currentText()))
        m.two_sided = self.two.isChecked()
        mode = self.alt_mode.currentIndex()
        self.hue.setEnabled(mode == 1)
        if mode == 0:
            m.alt = "same"
        elif mode == 1:
            m.alt = "hue:%d" % self.hue.value()
        elif m.alt == "same" or m.alt.startswith("hue:"):
            m.alt = "same"
            self.choose("alt")
            return
        m.bind = self.bind.currentData()
        self.page.edited_character()
        self.previews()

    def choose(self, which):
        path, _ = QFileDialog.getOpenFileName(self, "Choose a texture", os.path.expanduser("~"),
                                              "Pictures (*.png *.jpg *.jpeg *.tga *.bmp *.webp)")
        if not path:
            self.load()
            return
        try:
            im = load_png(path)
        except Exception as e:
            self.page.win.error("The picture could not be read:\n%s" % e)
            return
        c, m = self.page.state.character, self.material()
        member = "textures/mat%d%s.png" % (m.gltf_material, "_alt" if which == "alt" else "")
        c.files[member] = imperfect.png(im)
        if which == "alt":
            m.alt = member
        else:
            m.texture = member
            if max(im.size) <= 1024:
                m.size = tuple(min(512, 1 << max(3, (d - 1).bit_length())) for d in im.size)
        self.page.edited_character()
        self.load()


class MaterialsPage(Page):
    title = "4. Materials"

    def __init__(self, win):
        super().__init__(win)
        self.lay = self.scrolled()
        self.lay.addWidget(heading("Materials and costumes"))
        self.lay.addWidget(note("Each material of your model becomes a game material with one texture. Costume 2 (the "
                                "alternate costume) uses the same model with its own textures."))
        self.cards = []
        self.box = QVBoxLayout()
        self.lay.addLayout(self.box)
        self.lay.addStretch()
        self.state.model_changed.connect(self.rebuild)
        self.state.character_changed.connect(self.rebuild)
        self.state.game_changed.connect(self.rebuild)
        self.rebuild()

    def rebuild(self):
        for card in self.cards:
            card.setParent(None)
            card.deleteLater()
        self.cards = []
        c = self.state.character
        if not c.materials:
            lab = QGroupBox("No model yet")
            QVBoxLayout(lab).addWidget(note("Import a model in the Model step first."))
            self.cards.append(lab)
            self.box.addWidget(lab)
            return
        for i in range(len(c.materials)):
            card = MaterialCard(self, i)
            self.cards.append(card)
            self.box.addWidget(card)

    def refresh(self):
        for card in self.cards:
            if isinstance(card, MaterialCard):
                card.load()
