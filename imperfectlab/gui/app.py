import os
import sys


def main(argv=None):
    try:
        from PySide6.QtGui import QSurfaceFormat
        from PySide6.QtWidgets import QApplication
    except ImportError:
        raise SystemExit("the editor needs PySide6: pip install pyside6 ")
    from .main_window import MainWindow
    from .viewport import default_format
    argv = sys.argv if argv is None else argv
    QSurfaceFormat.setDefaultFormat(default_format())
    app = QApplication(argv)
    app.setApplicationName("ImperfectLab")
    app.setOrganizationName("ImperfectLab")
    app.setStyle("Fusion")
    win = MainWindow()
    win.show()
    files = [a for a in argv[1:] if a.lower().endswith(".imperfect") and os.path.exists(a)]
    if files:
        win.open_path(files[0])
    return app.exec()
