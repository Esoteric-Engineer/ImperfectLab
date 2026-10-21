"""What the editor works on: the character, the user's disc, and what is derived from them."""
import os

from PySide6.QtCore import QObject, QSettings, Signal

from ..formats import LabError
from ..game import roster as R
from ..package import imperfect


class State(QObject):
    character_changed = Signal()
    game_changed = Signal()
    model_changed = Signal()
    mapping_changed = Signal()
    dirty_changed = Signal(bool)

    def __init__(self):
        super().__init__()
        self.settings = QSettings("ImperfectLab", "ImperfectLab")
        self.character = imperfect.Character()
        self.path = None
        self.dirty = False
        self.game = None
        self.model = None
        self.model_error = None
        self._templates = None
        self._bases = {}
        self._skeletons = {}

    # the character

    def touch(self, what="character"):
        if not self.dirty:
            self.dirty = True
            self.dirty_changed.emit(True)
        {"character": self.character_changed, "model": self.model_changed,
         "mapping": self.mapping_changed}[what].emit()

    def saved(self, path):
        self.path = path
        self.dirty = False
        self.dirty_changed.emit(False)
        self.remember_recent(path)

    def set_character(self, character, path=None):
        self.character = character
        self.path = path
        self.dirty = False
        self.load_model()
        self.dirty_changed.emit(False)
        self.character_changed.emit()
        self.model_changed.emit()
        self.mapping_changed.emit()

    def load_model(self):
        from ..model import glb
        self.model, self.model_error = None, None
        if self.character.glb:
            try:
                self.model = glb.Model(self.character.glb)
            except LabError as e:
                self.model_error = str(e)

    # the game

    def set_game(self, source):
        if self.game is not None and self.game is not source:
            self.game.close()
        self.game = source
        self._templates, self._bases, self._skeletons = None, {}, {}
        if source is not None:
            self.settings.setValue("game", source.path)
        self.game_changed.emit()

    def templates(self):
        if self._templates is None and self.game is not None:
            self._templates = R.Templates(self.game.entry("Misc/Global.not"))
        return self._templates

    def base(self, key=None):
        key = key or self.character.base
        if self.game is None:
            return None
        if key not in self._bases:
            self._bases[key] = R.BaseCharacter(self.game, key, self.templates())
        return self._bases[key]

    def skeleton(self, key=None):
        """The base's skeleton, or None (no disc, or a body class without a bone table yet)."""
        from ..model.skeleton import Skeleton
        key = key or self.character.base
        if self.game is None:
            return None
        if key not in self._skeletons:
            try:
                self._skeletons[key] = Skeleton.of_base(self.base(key))
            except LabError:
                self._skeletons[key] = None
        return self._skeletons[key]

    # settings

    def recent(self):
        v = self.settings.value("recent", [])
        if isinstance(v, str):
            v = [v]
        return [p for p in (v or []) if os.path.exists(p)]

    def remember_recent(self, path):
        items = [path] + [p for p in self.recent() if p != path]
        self.settings.setValue("recent", items[:8])
