from PySide6.QtCore import QRegularExpression
from PySide6.QtGui import QIcon, QRegularExpressionValidator
from PySide6.QtWidgets import (QAbstractItemView, QComboBox, QFormLayout, QHBoxLayout, QHeaderView, QLabel,
                               QLineEdit, QPlainTextEdit, QPushButton, QTableWidget, QTableWidgetItem)

from ...formats import LabError, gshtool
from ...game import roster as R
from ...package import imperfect
from ..widgets import ColorButton, heading, note, pil_to_pixmap
from . import Page

ASSET_KEYS = ("what", "by", "license", "url")


class CharacterPage(Page):
    title = "2. Character"

    def __init__(self, win):
        super().__init__(win)
        lay = self.scrolled()
        lay.addWidget(heading("Names"))
        form = QFormLayout()
        self.internal = QLineEdit()
        self.internal.setValidator(QRegularExpressionValidator(QRegularExpression(r"[A-Za-z][A-Za-z0-9]{0,9}")))
        self.internal.textEdited.connect(self.edited)
        form.addRow("Internal name", self.internal)
        form.addRow("", note("1-10 letters and digits. Must not be one of the game's own characters."))
        self.display = QLineEdit()
        self.display.setMaxLength(16)
        self.display.setValidator(QRegularExpressionValidator(QRegularExpression(r"[A-Za-z0-9 .'&!-]{0,16}")))
        self.display.textEdited.connect(self.edited)
        form.addRow("Display name", self.display)
        form.addRow("", note("Up to 16 characters, shown on the select and loading screens."))
        self.color = ColorButton()
        self.color.changed.connect(self.edited)
        form.addRow("Name color", self.color)
        lay.addLayout(form)

        lay.addWidget(heading("Base character"))
        lay.addWidget(note("The new character copies the base's moves, animations, sounds, AI and effects. It's model is fitted onto the base's skeleton."))
        row = QHBoxLayout()
        self.base = QComboBox()
        self.base.setMinimumWidth(240)
        self.base.currentIndexChanged.connect(self.base_changed)
        row.addWidget(self.base)
        self.base_info = QLabel()
        row.addWidget(self.base_info, 1)
        lay.addLayout(row)

        lay.addWidget(heading("Credits"))
        lay.addWidget(note("Shown to everyone who opens or patches the file. A model under CC BY must be credited."))
        form2 = QFormLayout()
        self.author = QLineEdit()
        self.author.textEdited.connect(self.edited)
        form2.addRow("Author", self.author)
        self.description = QPlainTextEdit()
        self.description.setFixedHeight(80)
        self.description.textChanged.connect(self.edited)
        form2.addRow("Description", self.description)
        lay.addLayout(form2)
        self.assets = QTableWidget(0, 4)
        self.assets.setHorizontalHeaderLabels(["What", "By", "License", "Link"])
        self.assets.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.assets.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.assets.setFixedHeight(150)
        self.assets.itemChanged.connect(self.edited)
        lay.addWidget(self.assets)
        row = QHBoxLayout()
        add, rem = QPushButton("Add credit"), QPushButton("Remove")
        add.clicked.connect(self.add_asset)
        rem.clicked.connect(self.remove_asset)
        row.addWidget(add)
        row.addWidget(rem)
        row.addStretch()
        lay.addLayout(row)
        lay.addStretch()
        self.state.character_changed.connect(self.refresh)
        self.state.game_changed.connect(self.fill_bases)
        self.fill_bases()

    def fill_bases(self):
        self._refreshing = True
        self.base.clear()
        game = self.state.game
        hud = None
        if game is not None:
            try:
                hud = gshtool.read_gsh(game.entry("HUD/hudENG.1.gsh"))
            except LabError:
                hud = None
        for key in R.keys():
            label = R.label(key)
            icon = QIcon()
            if game is not None:
                try:
                    b = self.state.base(key)
                    if self.state.skeleton(key) is None:
                        label += " (%s: not supported yet)" % b.body
                    rec = hud.records.get("plr_%s" % b.hud_name) if hud else None
                    if rec:
                        from PIL import Image
                        pic = gshtool.Picture(rec)
                        icon = QIcon(pil_to_pixmap(Image.frombytes("RGBA", (pic.width, pic.height), pic.decode(rec))))
                except LabError:
                    pass
            self.base.addItem(icon, label, key)
        self._refreshing = False
        self.refresh()

    def refresh(self):
        self._refreshing = True
        c = self.state.character
        if self.internal.text() != c.internal_name:
            self.internal.setText(c.internal_name)
        if self.display.text() != c.display_name:
            self.display.setText(c.display_name)
        self.color.set(c.name_color)
        i = self.base.findData(c.base)
        if i >= 0:
            self.base.setCurrentIndex(i)
        self.author.setText(c.credits.get("author", ""))
        if self.description.toPlainText() != c.credits.get("description", ""):
            self.description.setPlainText(c.credits.get("description", ""))
        assets = c.credits.get("assets", [])
        self.assets.setRowCount(len(assets))
        for r, a in enumerate(assets):
            for k, key in enumerate(ASSET_KEYS):
                self.assets.setItem(r, k, QTableWidgetItem(a.get(key, "")))
        self.update_base_info()
        self._refreshing = False

    def update_base_info(self):
        b = self.state.base() if self.state.game else None
        if b is None:
            self.base_info.setText("Choose your game disc to see the base characters' details.")
            return
        sk = self.state.skeleton()
        self.base_info.setText("%s body, %s; select-screen stats %s%s" % (
            b.body, "%d bones" % len(sk.nodes) if sk else "skeleton not supported yet", b.stats,
            "" if sk else " . Pick another base"))

    def edited(self, *_):
        if self._refreshing:
            return
        c = self.state.character
        c.internal_name = self.internal.text()
        up = self.display.text().upper()
        if up != self.display.text():
            pos = self.display.cursorPosition()
            self.display.setText(up)
            self.display.setCursorPosition(pos)
        c.display_name = up
        c.name_color = self.color.color
        c.credits = {"author": self.author.text(), "description": self.description.toPlainText(),
                     "assets": [{key: (self.assets.item(r, k).text() if self.assets.item(r, k) else "")
                                 for k, key in enumerate(ASSET_KEYS)} for r in range(self.assets.rowCount())]}
        self.state.dirty = True
        self.state.dirty_changed.emit(True)
        self.win.update_title()

    def base_changed(self, i):
        if self._refreshing or i < 0:
            return
        key = self.base.itemData(i)
        c = self.state.character
        if key == c.base:
            return
        from ...model import mapping
        old = self.state.skeleton(c.base) if self.state.game else None
        c.base = key
        sk = self.state.skeleton()
        if sk is not None and old is not None:
            c.mapping, c.overrides = mapping.translate(c.mapping, c.overrides, old, sk)
            for m in c.materials:
                if m.bind is not None:
                    moved = mapping.translate({m.bind: ""}, {}, old, sk)[0]
                    m.bind = next(iter(moved), None)
        if self.state.model is not None and sk is not None:
            missing = [r for r in sk.required_roles() if sk.node(r) not in c.mapping]
            if missing:
                auto = mapping.auto_map(self.state.model, sk)
                c.mapping, c.overrides = auto.mapping, auto.overrides
        if self.state.game is not None:
            b = self.state.base()
            c.stats = {"normal": list(b.stats), "alt": list(b.alt_stats)} if c.stats == imperfect.default_stats() else c.stats
        self.update_base_info()
        self.state.touch("mapping")

    def add_asset(self):
        self.assets.insertRow(self.assets.rowCount())
        self.edited()

    def remove_asset(self):
        rows = sorted({i.row() for i in self.assets.selectedIndexes()}, reverse=True)
        for r in rows:
            self.assets.removeRow(r)
        self.edited()
