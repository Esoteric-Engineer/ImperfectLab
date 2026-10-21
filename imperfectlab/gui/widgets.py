"""Small shared widgets."""
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor, QImage, QPixmap
from PySide6.QtWidgets import QColorDialog, QLabel, QPushButton, QSizePolicy


def pil_to_pixmap(im, max_side=None):
    im = im.convert("RGBA")
    if max_side and max(im.size) > max_side:
        k = max_side / max(im.size)
        im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))))
    q = QImage(im.tobytes(), im.width, im.height, im.width * 4, QImage.Format_RGBA8888).copy()
    return QPixmap.fromImage(q)


def checker(w, h, cell=8):
    from PIL import Image
    im = Image.new("RGBA", (w, h), (90, 90, 96, 255))
    px = im.load()
    for y in range(h):
        for x in range(w):
            if (x // cell + y // cell) % 2:
                px[x, y] = (120, 120, 128, 255)
    return im


class ColorButton(QPushButton):
    changed = Signal(str)

    def __init__(self, color="#FFFFFF", alpha=False, parent=None):
        super().__init__(parent)
        self.alpha = alpha
        self.setFixedWidth(90)
        self.clicked.connect(self.pick)
        self.set(color)

    def set(self, color):
        self.color = color or "#FFFFFF"
        rgb = self.color[:7]
        self.setText(self.color.upper())
        light = QColor(rgb).lightness() > 140
        self.setStyleSheet("background:%s;color:%s" % (rgb, "black" if light else "white"))

    def pick(self):
        c = QColor(self.color[:7])
        if len(self.color) == 9:
            c.setAlpha(int(self.color[7:9], 16))
        opts = QColorDialog.ShowAlphaChannel if self.alpha else QColorDialog.ColorDialogOption(0)
        got = QColorDialog.getColor(c, self, "Pick a color", opts)
        if got.isValid():
            text = "#%02X%02X%02X" % (got.red(), got.green(), got.blue())
            if self.alpha:
                text += "%02X" % got.alpha()
            self.set(text)
            self.changed.emit(text)


class Thumb(QLabel):
    """An image preview that keeps its aspect."""

    def __init__(self, side=128, parent=None):
        super().__init__(parent)
        self.side = side
        self.setFixedSize(side, side)
        self.setAlignment(Qt.AlignCenter)
        self.setStyleSheet("background:#2a2c33;border:1px solid #444")
        self.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)

    def show_image(self, im):
        if im is None:
            self.clear()
            self.setText("-")
            return
        self.setPixmap(pil_to_pixmap(im, self.side - 4))


def note(text):
    lab = QLabel(text)
    lab.setWordWrap(True)
    lab.setStyleSheet("color:#9aa0aa")
    return lab


def heading(text):
    lab = QLabel(text)
    lab.setStyleSheet("font-size:15px;font-weight:600;margin-top:6px")
    return lab
