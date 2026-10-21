"""Long work off the UI thread: a job reports progress and ends with a result or an error."""
import traceback

from PySide6.QtCore import QObject, QThread, Signal

from ..formats import LabError


class Job(QThread):
    progress = Signal(str, int, int)
    done = Signal(object)
    failed = Signal(str)

    def __init__(self, fn, parent=None):
        super().__init__(parent)
        self.fn = fn

    def run(self):
        try:
            result = self.fn(lambda stage, done=0, total=0: self.progress.emit(stage, int(done), int(total)))
        except LabError as e:
            self.failed.emit(str(e))
        except Exception:
            self.failed.emit(traceback.format_exc())
        else:
            self.done.emit(result)


class Jobs(QObject):
    """Keeps running jobs alive until they finish."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.running = set()

    def start(self, fn, done=None, failed=None, progress=None):
        job = Job(fn, self)
        if done:
            job.done.connect(done)
        if failed:
            job.failed.connect(failed)
        if progress:
            job.progress.connect(progress)
        self.running.add(job)
        job.finished.connect(lambda: self.running.discard(job))
        job.start()
        return job
