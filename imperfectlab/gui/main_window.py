import os

from PySide6.QtCore import Qt
from PySide6.QtGui import QAction, QKeySequence
from PySide6.QtWidgets import (QFileDialog, QHBoxLayout, QLabel, QListWidget, QMainWindow, QMessageBox, QStackedWidget, QWidget)

from .. import __version__
from ..formats import LabError
from ..package import imperfect
from .jobs import Jobs
from .state import State


class MainWindow(QMainWindow):

    def __init__(self):
        super().__init__()
        from .pages import aura, art, character, export, game, materials, model, stats
        self.state = State()
        self.jobs = Jobs(self)
        self.resize(1360, 860)
        central = QWidget()
        lay = QHBoxLayout(central)
        self.steps = QListWidget()
        self.steps.setFixedWidth(170)
        self.steps.setStyleSheet("QListWidget{font-size:14px} QListWidget::item{padding:9px}")
        self.stack = QStackedWidget()
        lay.addWidget(self.steps)
        lay.addWidget(self.stack, 1)
        self.setCentralWidget(central)
        self.pages = [cls(self) for cls in (game.GamePage, character.CharacterPage, model.ModelPage,
                                            materials.MaterialsPage, aura.AuraPage, stats.StatsPage, art.ArtPage,
                                            export.ExportPage)]
        for p in self.pages:
            self.steps.addItem(p.title)
            self.stack.addWidget(p)
        self.steps.currentRowChanged.connect(self.show_page)
        self.game_label = QLabel()
        self.statusBar().addPermanentWidget(self.game_label)
        self._menus()
        s = self.state
        s.dirty_changed.connect(lambda _: self.update_title())
        s.character_changed.connect(self.update_title)
        s.game_changed.connect(self.update_game_label)
        self.update_title()
        self.update_game_label()
        self.steps.setCurrentRow(0)
        last = s.settings.value("game")
        if last and os.path.exists(last):
            self.pages[0].open_game(last, quiet=True)

    def _menus(self):
        m = self.menuBar().addMenu("&File")
        for text, key, fn in (("&New character", QKeySequence.New, self.new), ("&Open...", QKeySequence.Open, self.open),
                              ("&Save", QKeySequence.Save, self.save), ("Save &as...", QKeySequence.SaveAs, self.save_as)):
            a = QAction(text, self)
            a.setShortcut(key)
            a.triggered.connect(fn)
            m.addAction(a)
        self.recent_menu = m.addMenu("Open &recent")
        self.recent_menu.aboutToShow.connect(self._fill_recent)
        m.addSeparator()
        q = QAction("&Quit", self)
        q.setShortcut(QKeySequence.Quit)
        q.triggered.connect(self.close)
        m.addAction(q)
        h = self.menuBar().addMenu("&Help")
        a = QAction("&About ImperfectLab", self)
        a.triggered.connect(self.about)
        h.addAction(a)

    def _fill_recent(self):
        self.recent_menu.clear()
        for p in self.state.recent():
            a = QAction(p, self)
            a.triggered.connect(lambda _=False, p=p: self.open_path(p))
            self.recent_menu.addAction(a)
        if not self.recent_menu.actions():
            a = QAction("(none)", self)
            a.setEnabled(False)
            self.recent_menu.addAction(a)

    def show_page(self, i):
        self.stack.setCurrentIndex(i)
        self.pages[i].refresh()

    def current_page(self):
        return self.pages[self.stack.currentIndex()]

    def update_title(self):
        c, s = self.state.character, self.state
        name = os.path.basename(s.path) if s.path else "%s (unsaved)" % c.display_name
        self.setWindowTitle("%s%s - ImperfectLab" % (name, " *" if s.dirty else ""))

    def update_game_label(self):
        g = self.state.game
        self.game_label.setText("Game: %s" % os.path.basename(g.path) if g else "No game disc chosen")

    def message(self, text, timeout=6000):
        self.statusBar().showMessage(text, timeout)

    def error(self, text, title="ImperfectLab"):
        QMessageBox.warning(self, title, text)

    # files

    def confirm_discard(self):
        if not self.state.dirty:
            return True
        r = QMessageBox.question(self, "Unsaved changes", "Save the changes to %s first?" % self.state.character.display_name,
                                 QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel)
        if r == QMessageBox.Save:
            return self.save()
        return r == QMessageBox.Discard

    def new(self):
        if self.confirm_discard():
            self.state.set_character(imperfect.Character())
            self.steps.setCurrentRow(1)

    def open(self):
        if not self.confirm_discard():
            return
        path, _ = QFileDialog.getOpenFileName(self, "Open a character", self._dir(), "ImperfectLab characters (*.imperfect)")
        if path:
            self.open_path(path, confirmed=True)

    def open_path(self, path, confirmed=False):
        if not confirmed and not self.confirm_discard():
            return
        try:
            with open(path, "rb") as f:
                c = imperfect.load(f.read())
        except (OSError, LabError) as e:
            self.error("%s could not be opened:\n%s" % (os.path.basename(path), e))
            return
        self.state.set_character(c, path)
        self.state.remember_recent(path)
        self.show_credits(c)
        self.steps.setCurrentRow(7 if self.state.game else 0)

    def show_credits(self, c):
        cr = c.credits or {}
        lines = ["<b>%s</b> (based on %s)" % (c.display_name, c.base)]
        if cr.get("author"):
            lines.append("by %s" % cr["author"])
        if cr.get("description"):
            lines.append(cr["description"].replace("\n", "<br>"))
        for a in cr.get("assets", []):
            lines.append("%s: %s, %s %s" % (a.get("what"), a.get("by"), a.get("license"), a.get("url")))
        box = QMessageBox(QMessageBox.Information, "Credits", "<br>".join(lines), QMessageBox.Ok, self)
        box.setAttribute(Qt.WA_DeleteOnClose)
        box.setModal(False)
        box.show()

    def _dir(self):
        return os.path.dirname(self.state.path) if self.state.path else os.path.expanduser("~")

    def save(self):
        if not self.state.path:
            return self.save_as()
        return self.write(self.state.path)

    def save_as(self):
        c = self.state.character
        default = os.path.join(self._dir(), c.internal_name.lower() + ".imperfect")
        path, _ = QFileDialog.getSaveFileName(self, "Save the character", default, "ImperfectLab characters (*.imperfect)")
        if not path:
            return False
        if not path.lower().endswith(".imperfect"):
            path += ".imperfect"
        return self.write(path)

    def write(self, path):
        try:
            data = imperfect.save(self.state.character)
            tmp = path + ".part"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
        except (OSError, LabError) as e:
            self.error("Saving failed:\n%s" % e)
            return False
        self.state.saved(path)
        self.update_title()
        self.message("Saved %s (%d KB)" % (path, len(data) // 1024))
        return True

    def closeEvent(self, e):
        if self.confirm_discard():
            e.accept()
        else:
            e.ignore()

    def about(self):
        QMessageBox.about(self, "About ImperfectLab",
            "<b>ImperfectLab %s</b><br>"
            "Custom characters for Marvel Nemesis: Rise of the Imperfects (GameCube, USA).<br><br>"
            "By <a href='https://esotericengineer.com'>EsotericEngineer</a>  |  <a href='https://github.com/Esoteric-Engineer/ImperfectLab'>Source</a><br><br />"
            % __version__)