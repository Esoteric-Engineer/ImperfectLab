"""The vendored mnroi format tools, imported by bare name as they import each other.

Only their parse/build functions on bytes are used here: their cmd_* functions and module-level
paths (BIG, DOL) assume the decomp's working directory.
"""
import os
import sys

VENDOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor", "mnroi")
if VENDOR not in sys.path:
    sys.path.insert(0, VENDOR)

import aptpatch  # noqa: E402,F401
import gltf  # noqa: E402,F401
import gshtool  # noqa: E402,F401
import gxtex  # noqa: E402,F401
import nbig  # noqa: E402,F401
import nfxtool  # noqa: E402,F401
import ngbtool  # noqa: E402,F401
import ngmexport  # noqa: E402,F401
import ngmtool  # noqa: E402,F401
import nottool  # noqa: E402,F401
import nvbtool  # noqa: E402,F401
import refpack  # noqa: E402,F401


class LabError(Exception):
    pass


def call(fn, *args, **kw):
    """fn(*args), with the vendored tools' SystemExit turned into LabError."""
    try:
        return fn(*args, **kw)
    except SystemExit as e:
        raise LabError(str(e.code)) from None
