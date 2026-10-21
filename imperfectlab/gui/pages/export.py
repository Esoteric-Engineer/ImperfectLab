import os

from PySide6.QtCore import QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (QFileDialog, QHBoxLayout, QLabel, QLineEdit, QListWidget, QMessageBox, QPlainTextEdit,
                               QProgressBar, QPushButton)

from ...build import patch
from ...game.source import GameSource
from ...model import mapping
from ..widgets import heading, note
from . import Page


class ExportPage(Page):
    title = "8. Save & patch"

    def __init__(self, win):
        super().__init__(win)
        lay = self.scrolled()
        lay.addWidget(heading("Checks"))
        self.checks = QListWidget()
        self.checks.setFixedHeight(150)
        lay.addWidget(self.checks)
        row = QHBoxLayout()
        self.full = QPushButton("Check against the game disc")
        self.full.clicked.connect(self.full_check)
        row.addWidget(self.full)
        row.addStretch()
        lay.addLayout(row)

        lay.addWidget(heading("Share"))
        lay.addWidget(note("A .imperfect file holds your model, pictures and settings, and no game data: anyone with their "
                           "own copy of the game can open it and patch the character in."))
        row = QHBoxLayout()
        save = QPushButton("Save .imperfect...")
        save.clicked.connect(self.win.save_as)
        row.addWidget(save)
        row.addStretch()
        lay.addLayout(row)

        lay.addWidget(heading("Patch the game"))
        lay.addWidget(note("Writes a new disc image with the character as the 19th fighter. Your disc is only read. It must be an unmodified dump: patch a fresh copy each time, not an image that was already patched."))
        row = QHBoxLayout()
        row.addWidget(QLabel("Your disc:"))
        self.source = QLabel()
        row.addWidget(self.source, 1)
        lay.addLayout(row)
        row = QHBoxLayout()
        row.addWidget(QLabel("New disc:"))
        self.out = QLineEdit()
        self.out.textEdited.connect(lambda _: setattr(self, "out_edited", True))
        self.out_edited = False
        row.addWidget(self.out, 1)
        browse = QPushButton("Browse...")
        browse.clicked.connect(self.browse)
        row.addWidget(browse)
        lay.addLayout(row)
        row = QHBoxLayout()
        self.go = QPushButton("Patch")
        self.go.clicked.connect(self.run_patch)
        row.addWidget(self.go)
        self.open_dir = QPushButton("Open folder")
        self.open_dir.clicked.connect(self.open_folder)
        self.open_dir.setEnabled(False)
        row.addWidget(self.open_dir)
        row.addStretch()
        lay.addLayout(row)
        self.bar = QProgressBar()
        self.bar.hide()
        self.stage = QLabel()
        lay.addWidget(self.stage)
        lay.addWidget(self.bar)
        self.log = QPlainTextEdit()
        self.log.setReadOnly(True)
        self.log.setMinimumHeight(200)
        lay.addWidget(self.log)
        self.state.game_changed.connect(self.refresh)
        self.state.character_changed.connect(self.refresh)
        self._job = None

    def refresh(self):
        g, c = self.state.game, self.state.character
        self.source.setText(g.path if g else "choose it in the Game step")
        if g and not self.out_edited:
            path = g.path.rstrip("/")
            folder = os.path.dirname(path)
            stem = os.path.basename(path) if os.path.isdir(path) else os.path.splitext(os.path.basename(path))[0]
            self.out.setText(os.path.join(folder, "%s (%s).iso" % (stem, c.display_name.title())))
        self.go.setEnabled(g is not None and self._job is None)
        self.full.setEnabled(g is not None and self._job is None)
        self.checks.clear()
        problems = list(c.problems())
        sk, m = (self.state.skeleton() if g else None), self.state.model
        if g is None:
            problems.append(("warning", "choose the game disc to check the mapping and to patch"))
        elif sk is None:
            problems.append(("error", "%s's skeleton is not supported yet: pick another base" % self.state.base().label))
        elif m is not None:
            problems += mapping.check(m, sk, c.mapping, c.overrides)
        if g is not None and c.aura.get("mode") == "tint":
            aura = self.win.pages[4].roots()
            if aura is not None and not (aura[0] or aura[1]):
                problems.append(("error", "%s has no effects to tint: choose another aura in the Aura step" % self.state.base().label))
        for level, msg in problems:
            self.checks.addItem(("✖ " if level == "error" else "⚠ ") + msg)
        if not problems:
            self.checks.addItem("✔ No problems found (the full check builds everything against the disc).")

    def browse(self):
        path, _ = QFileDialog.getSaveFileName(self, "The new disc image", self.out.text(), "Disc images (*.iso)")
        if path:
            self.out.setText(path if path.lower().endswith(".iso") else path + ".iso")
            self.out_edited = True

    def busy(self, on, text=""):
        self.go.setEnabled(not on and self.state.game is not None)
        self.full.setEnabled(not on and self.state.game is not None)
        self.bar.setVisible(on)
        self.stage.setText(text)

    def progress(self, stage, done, total):
        self.stage.setText(stage + "...")
        if total:
            self.bar.setRange(0, 1000)
            self.bar.setValue(int(1000 * done / total))
        else:
            self.bar.setRange(0, 0)

    def full_check(self):
        if self._job is not None:
            return
        g = self.state.game
        c = self.state.character.copy()
        self.busy(True, "Building everything in memory...")
        self.log.clear()

        def done(result):
            self.finished(job)
            self.log.setPlainText("✔ The character builds against this disc.\n\n" + "\n".join(result.notes) + "\n\n" +
                                  "\n".join("changes %s" % n for n in sorted(result.sets)) + "\n" +
                                  "\n".join("adds %s" % n for n in sorted(result.adds)))

        def failed(msg):
            self.finished(job)
            self.log.setPlainText("✖ " + msg)

        job = self._job = self.win.jobs.start(lambda report: patch.Builder(g, c, report).build(), done, failed, self.progress)

    def run_patch(self):
        if self._job is not None:
            return
        g, c = self.state.game, self.state.character.copy()
        out = self.out.text().strip()
        if not out:
            self.browse()
            out = self.out.text().strip()
            if not out:
                return
        out = os.path.abspath(os.path.expanduser(out))
        overwrite = False
        if os.path.exists(out):
            if os.path.isdir(g.path) is False and os.path.exists(g.path) and os.path.samefile(out, g.path):
                self.win.error("The new disc must be a new file, not your original disc.")
                return
            if QMessageBox.question(self, "Replace?", "%s exists. Replace it?" % out) != QMessageBox.Yes:
                return
            overwrite = True
        errors = [m for level, m in c.problems() if level == "error"]
        if errors:
            self.win.error("Fix these first:\n" + "\n".join(errors))
            return
        self.log.clear()
        self.busy(True, "Starting...")
        self.last_out = out

        def work(report):
            src = GameSource(g.path)
            try:
                r = patch.patch(src, c, out, report, overwrite)
            finally:
                src.close()
            text = patch.report(c, r)
            with open(os.path.splitext(out)[0] + " - report.txt", "w") as f:
                f.write(text)
            return text

        def done(text):
            self.finished(job)
            self.stage.setText("Done: %s" % out)
            self.log.setPlainText(text)
            self.open_dir.setEnabled(True)

        def failed(msg):
            self.finished(job)
            self.log.setPlainText("✖ Patching failed:\n" + msg)

        job = self._job = self.win.jobs.start(work, done, failed, self.progress)

    def finished(self, job):
        if self._job is job:
            self._job = None
            self.busy(False, "")

    def open_folder(self):
        QDesktopServices.openUrl(QUrl.fromLocalFile(os.path.dirname(self.last_out)))
