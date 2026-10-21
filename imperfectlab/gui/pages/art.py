import os

from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QFileDialog, QGridLayout, QGroupBox, QHBoxLayout, QLabel,
                               QPushButton, QVBoxLayout)

from ...build import portraits, ui
from ...formats import LabError
from ...game import roster as R
from ...package import imperfect
from ..dialogs import CropDialog, PlacementDialog
from ..widgets import Thumb, heading, note
from .materials import load_png
from . import Page

SLOTS = [
    ("select_ready", "Select screen, READY", "free"),
    ("select_rest", "Select screen, REST", "free"),
    ("select_readyalt", "Select screen, costume 2", "free"),
    ("tile", "Tile", "tile0"),
    ("tile_selected", "Tile, selected", "tile1"),
    ("hud", "HUD portrait", "hud"),
    ("hud_rage", "HUD portrait, rage", "hud"),
    ("hud_alt", "HUD portrait, costume 2", "hud"),
    ("hud_alt_rage", "HUD, costume 2 rage", "hud"),
    ("load_wide", "Loading screen, wide strip", "strip0"),
    ("load_narrow", "Loading screen, narrow strip", "strip1"),
    ("load_wide_alt", "Loading, wide, costume 2", "strip0_alt"),
    ("load_narrow_alt", "Loading, narrow, costume 2", "strip1_alt"),
    ("banner", "In-match name banner", "banner"),
]
DEFAULTS = {"tile0": (64, 32), "tile1": (64, 32), "hud": (64, 64), "strip0": (128, 256), "strip1": (32, 256), "strip0_alt": (128, 256), "strip1_alt": (32, 256)}


class SlotCard(QGroupBox):

    def __init__(self, page, slot, title, kind):
        super().__init__(title)
        self.page, self.slot, self.kind = page, slot, kind
        lay = QHBoxLayout(self)
        self.thumb = Thumb(110)
        lay.addWidget(self.thumb)
        side = QVBoxLayout()
        self.size_label = QLabel()
        self.status = note("")
        side.addWidget(self.size_label)
        side.addWidget(self.status)
        row = QHBoxLayout()
        for text, fn in (("Load...", self.load_file), ("Crop again", self.recrop), ("Clear", self.clear)):
            b = QPushButton(text)
            b.clicked.connect(fn)
            row.addWidget(b)
            if text == "Crop again":
                self.recrop_button = b
        side.addLayout(row)
        side.addStretch()
        lay.addLayout(side, 1)

    def member(self):
        return "ui/%s.png" % self.slot

    def size(self):
        return self.page.sizes().get(self.kind) if self.kind != "free" else None

    def refresh(self):
        c = self.page.state.character
        body = c.files.get(self.member())
        size = self.size()
        if self.kind == "free":
            self.size_label.setText("any size; placed with “Place the portrait...”")
        elif size:
            self.size_label.setText("%d x %d pixels" % size)
        else:
            self.size_label.setText("size unknown until the game disc is chosen")
        self.thumb.show_image(imperfect.image(body) if body else None)
        self.recrop_button.setEnabled(self.slot in self.page.sources and self.kind != "free")
        self.status.setText("Your picture" if body else self.page.fallback(self.slot))

    def load_file(self):
        path, _ = QFileDialog.getOpenFileName(self, "Choose a picture", self.page.last_dir, "Pictures (*.png *.jpg *.jpeg *.webp *.bmp *.tga)")
        if not path:
            return
        self.page.last_dir = os.path.dirname(path)
        try:
            im = load_png(path)
        except Exception as e:
            self.page.win.error("The picture could not be read:\n%s" % e)
            return
        self.page.sources[self.slot] = im
        self.use(im)

    def recrop(self):
        if self.slot in self.page.sources:
            self.use(self.page.sources[self.slot], force=True)

    def use(self, im, force=False):
        size = self.size()
        if size and (im.size != size or force):
            im = CropDialog.crop(self, im, size, self.title())
            if im is None:
                return
        elif self.kind != "free" and size is None:
            self.page.win.error("Choose the game disc first: this picture's size comes from the game.")
            return
        self.page.state.character.files[self.member()] = imperfect.png(im)
        self.page.edited_character()
        self.page.refresh()

    def clear(self):
        self.page.state.character.files.pop(self.member(), None)
        self.page.sources.pop(self.slot, None)
        self.page.edited_character()
        self.page.refresh()


class ArtPage(Page):
    title = "7. Art"

    def __init__(self, win):
        super().__init__(win)
        lay = self.scrolled()
        lay.addWidget(heading("Portraits, tile and HUD"))
        lay.addWidget(note("Art is optional, defaulting to the base character's art when unset. Exact-size pictures open a crop box when they don't fit."))
        row = QHBoxLayout()
        self.place = QPushButton("Place the portrait...")
        self.place.clicked.connect(self.placement)
        row.addWidget(self.place)
        self.banner = QCheckBox("Use the name banner picture in matches (experimental)")
        self.banner.toggled.connect(self.banner_toggled)
        row.addWidget(self.banner)
        row.addStretch()
        lay.addLayout(row)
        row = QHBoxLayout()
        row.addWidget(QLabel("Voice when picked (experimental):"))
        self.voice = QComboBox()
        self.voice.addItem("none (no voice)", None)
        for key in R.keys():
            self.voice.addItem("%s's" % R.label(key), R.VOICES[key])
        self.voice.currentIndexChanged.connect(self.voice_changed)
        row.addWidget(self.voice)
        row.addStretch()
        lay.addLayout(row)
        grid = QGridLayout()
        self.cards = []
        for k, (slot, title, kind) in enumerate(SLOTS):
            card = SlotCard(self, slot, title, kind)
            self.cards.append(card)
            grid.addWidget(card, k // 2, k % 2)
        lay.addLayout(grid)
        lay.addStretch()
        self.sources = {}
        self.last_dir = os.path.expanduser("~")
        self._sizes = {}
        self.state.character_changed.connect(self.refresh)
        self.state.game_changed.connect(self.game_changed)
        self.state.mapping_changed.connect(self.game_changed)

    def game_changed(self):
        self._sizes = {}
        self.refresh()

    def sizes(self):
        g = self.state.game
        if g is None:
            return {}
        if not self._sizes:
            try:
                tiles = ui.tile_sizes(g.entry(ui.P + "screens/clashCharSelect_thumbs.big"))
                strips, strips_alt = portraits.strip_sizes(g), portraits.strip_sizes(g, True)
                base = self.state.base()
                hud = ui.bank_image_size(g.entry("HUD/hudENG.1.gsh"), "plr_%s" % base.hud_name)
                banner = ui.bank_image_size(g.entry("HUD/hudENG.2.gsh"), "ovr_%sENG" % base.hud_name)
                self._sizes = {"tile0": tiles[0], "tile1": tiles[1], "strip0": strips[0], "strip1": strips[1],
                               "strip0_alt": strips_alt[0], "strip1_alt": strips_alt[1], "hud": hud, "banner": banner}
            except (LabError, IndexError, KeyError):
                self._sizes = dict(DEFAULTS)
        return self._sizes

    def fallback(self, slot):
        files = self.state.character.files
        base = self.state.base()
        name = base.label if base else "the base character"
        ready = "ui/select_ready.png" in files
        if slot == "select_ready":
            return "%s's portraits are used" % name
        if slot.startswith("select_"):
            return "READY's picture is used" if ready else "%s's portraits are used" % name
        if slot.startswith("tile"):
            return "the unselected tile is used" if slot == "tile_selected" and "ui/tile.png" in files else "%s's tile is used" % name
        if slot.startswith("load_"):
            if not ready:
                return "%s's are used" % name
            return "costume 1's strip is used" if slot.endswith("_alt") and "ui/load_wide.png" in files else "cut from the READY portrait"
        if slot == "hud":
            return "%s's HUD portraits are used" % name
        if slot.startswith("hud_"):
            return "the HUD portrait is used" if "ui/hud.png" in files else "%s's is used" % name
        if slot == "banner":
            return "no banner (the game leaves it out)"
        return ""

    def refresh(self):
        self._refreshing = True
        self.banner.setChecked(self.state.character.ui.get("banner", True))
        self.voice.setCurrentIndex(max(0, self.voice.findData(self.state.character.ui.get("ready_voice"))))
        self._refreshing = False
        self.place.setEnabled(self.state.game is not None and "ui/select_ready.png" in self.state.character.files)
        for card in self.cards:
            card.refresh()

    def voice_changed(self, i):
        if not self._refreshing:
            self.state.character.ui["ready_voice"] = self.voice.itemData(i)
            self.edited_character()

    def banner_toggled(self, on):
        if not self._refreshing:
            self.state.character.ui["banner"] = on
            self.edited_character()

    def placement(self):
        c = self.state.character
        ready = imperfect.image(c.files["ui/select_ready.png"])
        pics = {"ready": ready,
                "readyalt": imperfect.image(c.files["ui/select_readyalt.png"]) if "ui/select_readyalt.png" in c.files else ready,
                "rest": imperfect.image(c.files["ui/select_rest.png"]) if "ui/select_rest.png" in c.files else ready}
        try:
            d = PlacementDialog(self, self.state, pics)
        except LabError as e:
            self.win.error(str(e))
            return
        if d.exec() == QDialog.Accepted:
            c.ui["select"] = d.placements()
            c.ui["fade"] = d.fade
            self.edited_character()
