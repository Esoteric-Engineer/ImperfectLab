from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QPainter
from PySide6.QtWidgets import QCheckBox, QComboBox, QDoubleSpinBox, QGridLayout, QLabel, QSlider, QSpinBox, QWidget

from ...build import tuning
from ...build.patch import WIRE
from ...formats import LabError
from ...game import roster as R
from ..widgets import heading, note
from . import Page

NAMES = ("Intel", "Strength", "Speed", "Durability", "Energy", "Skill")
GAMEPLAY = [
    ("damage_taken", "Damage taken", "%", 10, 300, True),
    ("lift", "Lifting strength", None, None, None, True),
    ("wire_swing", "Wire swing", None, None, None, True),
    ("health", "Health", "", 10, 1000, True),
    ("run_speed", "Run speed", "", 1, 30, False),
    ("sprint_speed", "Sprint speed", "", 1, 40, False),
    ("rage_per_super", "Rage per super attack", "", 0, 100, False),
    ("rage_duration", "Rage duration", " ms", 1000, 120000, False),
]


class StatBar(QWidget):
    """Seven pips with the base's value marked."""

    def __init__(self):
        super().__init__()
        self.value, self.base = 4, None
        self.setFixedSize(150, 18)

    def set(self, value, base):
        self.value, self.base = value, base
        self.update()

    def paintEvent(self, e):
        p = QPainter(self)
        w = (self.width() - 12) / 7
        for i in range(7):
            on = i < self.value
            p.fillRect(int(i * (w + 2)), 3, int(w), 12, QColor("#d8b23a" if on else "#3a3d45"))
            if self.base is not None and i == self.base - 1:
                p.setPen(QColor("#ffffff"))
                p.drawRect(int(i * (w + 2)), 2, int(w) - 1, 13)


class StatsPage(Page):
    title = "6. Stats"

    def __init__(self, win):
        super().__init__(win)
        lay = self.scrolled()
        lay.addWidget(heading("Select-screen stats"))
        lay.addWidget(note("These stats are just for Versus Mode display and don't change how the character fights. Every character in the game has these values, but they don't all display."))
        self.link = QCheckBox("Same stats for both costumes")
        self.link.toggled.connect(self.edited)
        lay.addWidget(self.link)
        grid = QGridLayout()
        grid.addWidget(QLabel("<b>Costume 1</b>"), 0, 1, 1, 3)
        grid.addWidget(QLabel("<b>Costume 2</b>"), 0, 4, 1, 3)
        self.sliders, self.bars, self.values = {}, {}, {}
        for r, name in enumerate(NAMES):
            grid.addWidget(QLabel(name), r + 1, 0)
            for k, costume in enumerate(("normal", "alt")):
                s = QSlider(Qt.Horizontal)
                s.setRange(1, 7)
                s.setFixedWidth(140)
                s.valueChanged.connect(self.edited)
                bar, val = StatBar(), QLabel()
                grid.addWidget(s, r + 1, 1 + 3 * k)
                grid.addWidget(bar, r + 1, 2 + 3 * k)
                grid.addWidget(val, r + 1, 3 + 3 * k)
                self.sliders[costume, r], self.bars[costume, r], self.values[costume, r] = s, bar, val
        lay.addLayout(grid)

        lay.addWidget(heading("Gameplay"))
        lay.addWidget(note("Leave a value unticked to keep the base character's. The CPU difficulty levels keep the "
                           "base's spread. Experimental values have not been tried in the game yet."))
        g = QGridLayout()
        g.addWidget(QLabel("<b>Value</b>"), 0, 0)
        g.addWidget(QLabel("<b>Base</b>"), 0, 1)
        g.addWidget(QLabel("<b>New</b>"), 0, 2)
        self.rows = {}
        for r, (key, label, suffix, lo, hi, tested) in enumerate(GAMEPLAY):
            check = QCheckBox(label + ("" if tested else "  (experimental)"))
            check.toggled.connect(self.edited)
            base = QLabel()
            if key == "lift":
                editor = QComboBox()
                editor.addItems(["light", "medium", "heavy"])
                editor.currentIndexChanged.connect(self.edited)
            elif key == "wire_swing":
                editor = QComboBox()
                editor.addItems(["off", "on"])
                editor.currentIndexChanged.connect(self.edited)
            elif key in ("rage_duration", "health"):
                editor = QSpinBox()
                editor.setRange(lo, hi)
                editor.setSingleStep(500 if key == "rage_duration" else 10)
                editor.setSuffix(suffix)
                editor.valueChanged.connect(self.edited)
            else:
                editor = QDoubleSpinBox()
                editor.setRange(lo, hi)
                editor.setDecimals(1 if key == "damage_taken" else 2)
                editor.setSuffix(suffix)
                editor.valueChanged.connect(self.edited)
            g.addWidget(check, r + 1, 0)
            g.addWidget(base, r + 1, 1)
            g.addWidget(editor, r + 1, 2)
            self.rows[key] = (check, base, editor)
        lay.addLayout(g)
        lay.addStretch()
        self._base_values = {}
        self.state.character_changed.connect(self.refresh)
        self.state.game_changed.connect(self.refresh)
        self.state.mapping_changed.connect(self.refresh)

    def base_values(self):
        b = self.state.base()
        if b is None:
            return None
        if b.key not in self._base_values:
            try:
                v = tuning.Tuning(self.state.game, b).gameplay()
            except LabError:
                v = {}
            ab = b.abilities
            v["lift"] = "heavy" if ab & 0x20 else "medium" if ab & 0x10 else "light"
            v["wire_swing"] = "on" if ab & WIRE else "off"
            v["health"] = R.u32(b.t.prop(b.plr, R.P_MAXHEALTH)) or 100
            v["has_wire"] = bool(ab & WIRE)
            self._base_values[b.key] = v
        return self._base_values[b.key]

    def refresh(self):
        self._refreshing = True
        c, b = self.state.character, self.state.base()
        bv = self.base_values()
        self.link.setChecked(c.stats["normal"] == c.stats["alt"])
        for (costume, r), s in self.sliders.items():
            s.setValue(c.stats[costume][r])
            base = (b.stats if costume == "normal" else b.alt_stats)[r] if b else None
            self.bars[costume, r].set(c.stats[costume][r], base)
            self.values[costume, r].setText("%d%s" % (c.stats[costume][r], " (base %d)" % base if base else ""))
            s.setEnabled(costume == "normal" or not self.link.isChecked())
        for key, (check, base, editor) in self.rows.items():
            have = key in c.gameplay
            check.setChecked(have)
            editor.setEnabled(have)
            if bv is None:
                base.setText("-")
                continue
            value = bv.get(key)
            if key == "damage_taken":
                base.setText("%.0f%%" % (100 * value))
                editor.setValue(100 * c.gameplay.get(key, value))
            elif key in ("lift", "wire_swing"):
                base.setText(value)
                editor.setCurrentText({True: "on", False: "off"}.get(c.gameplay.get(key), c.gameplay.get(key, value))
                                      if key == "wire_swing" else c.gameplay.get(key, value))
                if key == "wire_swing":
                    check.setEnabled(bv.get("has_wire", False))
                    if not bv.get("has_wire"):
                        base.setText("off (the base has no wire moves)")
            elif value is not None:
                base.setText("%g" % value)
                editor.setValue(c.gameplay.get(key, value))
        self._refreshing = False

    def edited(self, *_):
        if self._refreshing:
            return
        c = self.state.character
        for r in range(6):
            c.stats["normal"][r] = self.sliders["normal", r].value()
            c.stats["alt"][r] = c.stats["normal"][r] if self.link.isChecked() else self.sliders["alt", r].value()
        gp = {}
        for key, (check, base, editor) in self.rows.items():
            editor.setEnabled(check.isChecked())
            if not check.isChecked():
                continue
            if key == "damage_taken":
                gp[key] = round(editor.value() / 100.0, 4)
            elif key == "lift":
                gp[key] = editor.currentText()
            elif key == "wire_swing":
                gp[key] = editor.currentText() == "on"
            elif key in ("rage_duration", "health"):
                gp[key] = int(editor.value())
            else:
                gp[key] = round(editor.value(), 3)
        c.gameplay = gp
        self.edited_character()
        self._refreshing = True
        b = self.state.base()
        for (costume, r), s in self.sliders.items():
            s.setValue(c.stats[costume][r])
            s.setEnabled(costume == "normal" or not self.link.isChecked())
            base = (b.stats if costume == "normal" else b.alt_stats)[r] if b else None
            self.bars[costume, r].set(c.stats[costume][r], base)
            self.values[costume, r].setText("%d%s" % (c.stats[costume][r], " (base %d)" % base if base else ""))
        self._refreshing = False
