from PySide6.QtWidgets import QButtonGroup, QFormLayout, QLabel, QRadioButton

from ...build import effects
from ...formats import LabError
from ..widgets import ColourButton, heading, note
from . import Page

MODES = ("base", "swap", "tint")


class AuraPage(Page):
    title = "5. Aura"

    def __init__(self, win):
        super().__init__(win)
        lay = self.scrolled()
        lay.addWidget(heading("Aura and effects"))
        self.about = note("")
        lay.addWidget(self.about)
        self.radios = {}
        grp = QButtonGroup(self)
        texts = {"base": "The normal base character's",
                 "swap": "Swapped: costume 1 gets the base's alternate aura and costume 2 the normal one",
                 "tint": "Tinted (experimental): the base's idle and power-up effects recoloured"}
        for mode in MODES:
            r = QRadioButton(texts[mode])
            grp.addButton(r)
            r.toggled.connect(self.edited)
            self.radios[mode] = r
            lay.addWidget(r)
        form = QFormLayout()
        self.colour, self.alt_colour = ColourButton(), ColourButton()
        self.colour.changed.connect(self.edited)
        self.alt_colour.changed.connect(self.edited)
        form.addRow("Costume 1 colour", self.colour)
        form.addRow("Costume 2 colour", self.alt_colour)
        lay.addLayout(form)
        self.limits = note("The glow the game draws in power mode belongs to the base's cast name and cannot be "
                           "recoloured yet (its file has no reader); a tint changes the effects around it. The tint's "
                           "copies take room in the game's effect memory; the patch checks it fits.")
        lay.addWidget(self.limits)
        self.cost = QLabel()
        lay.addWidget(self.cost)
        lay.addStretch()
        self.state.character_changed.connect(self.refresh)
        self.state.game_changed.connect(self.refresh)
        self.state.mapping_changed.connect(self.refresh)
        self._roots = {}

    def roots(self):
        base = self.state.base()
        if base is None:
            return None
        if base.key not in self._roots:
            try:
                self._roots[base.key] = effects.tint_roots(self.state.game, base)
            except LabError:
                self._roots[base.key] = ([], [], 0, 0)
        return self._roots[base.key]

    def refresh(self):
        self._refreshing = True
        c = self.state.character
        self.radios[c.aura.get("mode", "base")].setChecked(True)
        self.colour.set(c.aura.get("colour"))
        self.alt_colour.set(c.aura.get("alt_colour"))
        info = self.roots()
        base = self.state.base()
        if info is None:
            self.about.setText("Choose your game disc to see what the base character's aura is.")
            self.radios["tint"].setEnabled(True)
        else:
            roots, alt, cost, free = info
            self.radios["tint"].setEnabled(bool(roots or alt))
            names = ", ".join(roots) or "none"
            self.about.setText("%s's effects: %s. %s" % (base.label, names,
                               "" if roots or alt else "There is nothing to tint; Base and Swap still apply."))
            self.cost.setText("A tint copies %d bytes of effects; %d bytes are free." % (cost, free) if roots or alt else "")
        tint = c.aura.get("mode") == "tint"
        self.colour.setEnabled(tint)
        self.alt_colour.setEnabled(tint)
        self._refreshing = False

    def edited(self, *_):
        if self._refreshing:
            return
        c = self.state.character
        mode = next(m for m, r in self.radios.items() if r.isChecked())
        c.aura = {"mode": mode, "colour": self.colour.colour[:7], "alt_colour": self.alt_colour.colour[:7]}
        self.colour.setEnabled(mode == "tint")
        self.alt_colour.setEnabled(mode == "tint")
        self.edited_character()
