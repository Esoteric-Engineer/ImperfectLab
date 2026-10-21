from PySide6.QtWidgets import QScrollArea, QVBoxLayout, QWidget


class Page(QWidget):
    title = ""

    def __init__(self, win):
        super().__init__()
        self.win = win
        self.state = win.state
        self._refreshing = False

    def refresh(self):
        pass

    def edited_character(self):
        """Mark the project changed after a direct edit of the character."""
        if not self.state.dirty:
            self.state.dirty = True
            self.state.dirty_changed.emit(True)

    def scrolled(self):
        """A layout inside a scroll area that fills the page."""
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        area = QScrollArea()
        area.setWidgetResizable(True)
        inner = QWidget()
        area.setWidget(inner)
        outer.addWidget(area)
        lay = QVBoxLayout(inner)
        lay.setContentsMargins(16, 12, 16, 16)
        return lay
