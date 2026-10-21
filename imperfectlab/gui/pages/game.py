import os

from PySide6.QtWidgets import QFileDialog, QHBoxLayout, QLabel, QProgressBar, QPushButton

from ...formats import LabError
from ...game.source import GameSource
from ..widgets import heading, note
from . import Page


class GamePage(Page):
    title = "1. Game"

    def __init__(self, win):
        super().__init__(win)
        lay = self.scrolled()
        lay.addWidget(heading("Your copy of the game"))
        lay.addWidget(note(
            "ImperfectLab reads the base characters' skeletons, templates, tuning and portrait layouts from your own "
            "disc: Marvel Nemesis: Rise of the Imperfects for GameCube, USA (GVLE69), as .iso, .gcm or .ciso, or an "
            "extracted disc folder. The disc is only ever read, not modified."))
        row = QHBoxLayout()
        b = QPushButton("Choose disc image...")
        b.clicked.connect(self.choose)
        row.addWidget(b)
        b2 = QPushButton("Choose extracted folder...")
        b2.clicked.connect(self.choose_folder)
        row.addWidget(b2)
        row.addStretch()
        lay.addLayout(row)
        self.path = QLabel()
        self.path.setWordWrap(True)
        self.status = QLabel()
        self.status.setWordWrap(True)
        self.bar = QProgressBar()
        self.bar.hide()
        lay.addWidget(self.path)
        lay.addWidget(self.status)
        lay.addWidget(self.bar)
        lay.addStretch()
        self.state.game_changed.connect(self.refresh)
        self.refresh()

    def refresh(self):
        g = self.state.game
        if g is None:
            self.path.setText("No disc chosen.")
            if not self.bar.isVisible():
                self.status.setText("")
            return
        self.path.setText("<b>%s</b>" % g.path)
        self.status.setText("✔ An unmodified GVLE69 disc. Next: the Character step." if g.is_verified() else "")

    def choose(self):
        start = os.path.dirname(self.state.game.path) if self.state.game else os.path.expanduser("~")
        path, _ = QFileDialog.getOpenFileName(self, "Choose your game disc", start,
                                              "GameCube discs (*.iso *.gcm *.ciso);;All files (*)")
        if path:
            self.open_game(path)

    def choose_folder(self):
        path = QFileDialog.getExistingDirectory(self, "Choose the extracted disc folder (with sys/ and files/)")
        if path:
            self.open_game(path)

    def open_game(self, path, quiet=False):
        try:
            src = GameSource(path)
        except (OSError, LabError) as e:
            if not quiet:
                self.win.error("%s cannot be used:\n%s" % (path, e))
            return
        if src.is_verified():
            self.state.set_game(src)
            return
        self.status.setText("Checking that the disc is an unmodified GVLE69 dump (may take up to a minute the first time)...")
        self.bar.setRange(0, 100)
        self.bar.setValue(0)
        self.bar.show()

        def done(_):
            self.bar.hide()
            self.state.set_game(src)

        def failed(msg):
            self.bar.hide()
            src.close()
            self.status.setText("")
            self.win.error("%s cannot be used:\n%s" % (path, msg))

        def progress(stage, d, t):
            if t:
                self.bar.setValue(int(100 * d / t))

        self.win.jobs.start(lambda report: src.verify(lambda d, t: report("check", d, t)), done, failed, progress)
