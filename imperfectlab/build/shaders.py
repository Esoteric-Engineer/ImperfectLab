"""Materials/Shaders/shaders.nsa: one charlight block per new material, as the other characters have."""
from ..formats import LabError

BLOCK = """
%s
{
\tshader charlight
\tspecularity\t3.0
\tshininess\t1.0
\tintensity\t1.0
\ttexture %s
\ttexture2 %s
}
"""


def build(data, materials, texture2="ge_charlight"):
    """materials: material names, each drawing the texture of the same name."""
    low = data.lower()
    for m in materials:
        if b"\n" + m.lower().encode("latin-1") + b"\r\n" in low:
            raise LabError("shaders.nsa already has a material %s" % m)
    if not data.endswith(b"\r\n"):
        data += b"\r\n"
    blocks = "".join(BLOCK % (m, m, texture2) for m in materials)
    return data + blocks.replace("\n", "\r\n").encode("latin-1")


def blocks(data):
    """{lowercased material name: {key: value}} of the top-level keys of each block."""
    out, name, keys, depth = {}, None, None, 0
    for line in data.decode("latin-1").splitlines():
        line = line.split("//")[0].strip()
        if not line or line.startswith(";"):
            continue
        if line.startswith("{"):
            depth += 1
            continue
        if line.startswith("}"):
            depth -= 1
            if depth == 0 and name is not None:
                out.setdefault(name.lower(), keys)
                name = None
            continue
        if depth == 0:
            name, keys = line.split()[0], {}
        elif depth == 1:
            parts = line.split(None, 1)
            keys.setdefault(parts[0].lower(), parts[1].strip() if len(parts) > 1 else "")
    return out
