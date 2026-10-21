"""A small OpenGL viewport: textured meshes in the game's frame, bone lines and a weight heat map."""
import math
from array import array

from PySide6.QtCore import Qt
from PySide6.QtGui import QImage, QMatrix4x4, QSurfaceFormat, QVector3D
from PySide6.QtOpenGL import (QOpenGLBuffer, QOpenGLShader, QOpenGLShaderProgram, QOpenGLTexture,
                              QOpenGLVertexArrayObject)
from PySide6.QtOpenGLWidgets import QOpenGLWidget

GL_FLOAT, GL_TRIANGLES, GL_LINES = 0x1406, 0x0004, 0x0001
GL_DEPTH_TEST, GL_BLEND, GL_CULL_FACE = 0x0B71, 0x0BE2, 0x0B44
GL_COLOR_BUFFER_BIT, GL_DEPTH_BUFFER_BIT = 0x4000, 0x0100
GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_TEXTURE0 = 0x0302, 0x0303, 0x84C0
FOV = 35.0

MESH_VS = """#version 330 core
layout(location = 0) in vec3 pos;
layout(location = 1) in vec3 nrm;
layout(location = 2) in vec2 uv;
layout(location = 3) in float heat;
uniform mat4 mvp;
uniform mat4 view;
out vec3 v_nrm;
out vec2 v_uv;
out float v_heat;
void main() {
    gl_Position = mvp * vec4(pos, 1.0);
    v_nrm = mat3(view) * nrm;
    v_uv = uv;
    v_heat = heat;
}
"""
MESH_FS = """#version 330 core
in vec3 v_nrm;
in vec2 v_uv;
in float v_heat;
uniform sampler2D tex;
uniform int has_tex;
uniform int show_heat;
uniform float alpha;
out vec4 frag;
void main() {
    vec4 base = has_tex == 1 ? texture(tex, v_uv) : vec4(0.72, 0.72, 0.76, 1.0);
    float light = 0.35 + 0.65 * abs(normalize(v_nrm).z);
    vec3 c = base.rgb * light;
    if (show_heat == 1) {
        vec3 hot = mix(vec3(0.15, 0.35, 1.0), vec3(1.0, 0.2, 0.05), v_heat);
        c = v_heat > 0.0 ? mix(c * 0.5, hot, 0.85) : c * 0.55;
    }
    frag = vec4(c, alpha);
}
"""
LINE_VS = """#version 330 core
layout(location = 0) in vec3 pos;
layout(location = 1) in vec3 col;
uniform mat4 mvp;
out vec3 v_col;
void main() { gl_Position = mvp * vec4(pos, 1.0); v_col = col; }
"""
LINE_FS = """#version 330 core
in vec3 v_col;
out vec4 frag;
void main() { frag = vec4(v_col, 1.0); }
"""


def default_format():
    fmt = QSurfaceFormat()
    fmt.setVersion(3, 3)
    fmt.setProfile(QSurfaceFormat.CoreProfile)
    fmt.setDepthBufferSize(24)
    fmt.setSamples(4)
    return fmt


class _Gpu:
    def __init__(self):
        self.vao = QOpenGLVertexArrayObject()
        self.buf = QOpenGLBuffer(QOpenGLBuffer.VertexBuffer)
        self.count = 0
        self.texture = None
        self.alpha = 1.0


class Viewport(QOpenGLWidget):

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFormat(default_format())
        self.setMinimumSize(320, 320)
        self.meshes, self.lines = [], []
        self.highlight = None
        self.show_bones = True
        self.yaw, self.pitch, self.dist = 0.0, 0.15, 3.0
        self.center = QVector3D(0, 0, 1)
        self.radius = 1.0
        self._dirty = True
        self._gpu, self._line_gpu = [], None
        self._last = None
        self._frame_on_resize = True
        self.error = None

    # scene

    def set_scene(self, meshes, lines=(), fit=True):
        """meshes: [MeshData]; lines: [(p0, p1, key)]."""
        self.meshes, self.lines = list(meshes), list(lines)
        if fit:
            self.frame()
            self._frame_on_resize = True
        self._dirty = True
        self.update()

    def set_highlight(self, key):
        if key != self.highlight:
            self.highlight = key
            self._dirty = True
            self.update()

    def frame(self):
        pts = [p for m in self.meshes for p in m.positions] or [p for a, b, _ in self.lines for p in (a, b)]
        if not pts:
            return
        lo = [min(p[i] for p in pts) for i in range(3)]
        hi = [max(p[i] for p in pts) for i in range(3)]
        self.center = QVector3D(*[(lo[i] + hi[i]) / 2 for i in range(3)])
        self.radius = max(1e-3, math.sqrt(sum((hi[i] - lo[i]) ** 2 for i in range(3))) / 2)
        half_h = max(1e-3, (hi[2] - lo[2]) / 2)
        half_w = max(1e-3, max(hi[0] - lo[0], hi[1] - lo[1]) / 2)
        aspect = max(1, self.width()) / max(1, self.height())
        t = math.tan(math.radians(FOV / 2))
        self.dist = 1.15 * max(half_h / t, half_w / (t * aspect)) + half_w

    def view(self, name):
        self.yaw = {"front": 0.0, "right": math.pi / 2, "back": math.pi, "left": -math.pi / 2}[name]
        self.pitch = 0.1
        self.update()

    # GL

    def initializeGL(self):
        self.gl = self.context().functions()
        self.gl.glEnable(GL_DEPTH_TEST)
        self.mesh_prog = self._program(MESH_VS, MESH_FS)
        self.line_prog = self._program(LINE_VS, LINE_FS)
        self.u = {name: self.mesh_prog.uniformLocation(name) for name in ("mvp", "view", "tex", "has_tex", "show_heat", "alpha")}
        self.u_line = self.line_prog.uniformLocation("mvp")
        self.context().aboutToBeDestroyed.connect(self._cleanup)
        self._dirty = True

    def _cleanup(self):
        self.makeCurrent()
        self._release()
        self.doneCurrent()

    def _program(self, vs, fs):
        p = QOpenGLShaderProgram(self)
        ok = p.addShaderFromSourceCode(QOpenGLShader.Vertex, vs) and p.addShaderFromSourceCode(QOpenGLShader.Fragment, fs)
        if not ok or not p.link():
            self.error = "OpenGL 3.3 shaders failed: " + p.log()
        return p

    def _release(self):
        for g in self._gpu:
            g.buf.destroy()
            g.vao.destroy()
            if g.texture is not None:
                g.texture.destroy()
        if self._line_gpu:
            self._line_gpu.buf.destroy()
            self._line_gpu.vao.destroy()
        self._gpu, self._line_gpu = [], None

    def _upload(self):
        self._release()
        hl = self.highlight
        for m in self.meshes:
            g = _Gpu()
            data = array("f")
            for i, (p, n, uv) in enumerate(zip(m.positions, m.normals, m.uvs)):
                heat = 0.0
                if hl is not None and m.influences:
                    heat = sum(w for k, w in m.influences[i] if k == hl)
                data.extend((p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1], heat))
            g.count = len(m.positions)
            g.alpha = m.alpha
            g.vao.create()
            g.vao.bind()
            g.buf.create()
            g.buf.bind()
            raw = data.tobytes()
            g.buf.allocate(raw, len(raw))
            prog = self.mesh_prog
            prog.bind()
            for loc, off, size in ((0, 0, 3), (1, 12, 3), (2, 24, 2), (3, 32, 1)):
                prog.enableAttributeArray(loc)
                prog.setAttributeBuffer(loc, GL_FLOAT, off, size, 36)
            g.vao.release()
            g.buf.release()
            if m.image is not None:
                im = m.image.convert("RGBA")
                qimg = QImage(im.tobytes(), im.width, im.height, im.width * 4, QImage.Format_RGBA8888).copy()
                g.texture = QOpenGLTexture(qimg)
                g.texture.setWrapMode(QOpenGLTexture.Repeat)
                g.texture.setMinificationFilter(QOpenGLTexture.LinearMipMapLinear)
                g.texture.setMagnificationFilter(QOpenGLTexture.Linear)
            self._gpu.append(g)
        if self.lines:
            g = _Gpu()
            data = array("f")
            for a, b, key in self.lines:
                col = (1.0, 0.85, 0.1) if key is not None and key == hl else (0.2, 0.9, 1.0)
                data.extend((a[0], a[1], a[2]) + col + (b[0], b[1], b[2]) + col)
            g.count = 2 * len(self.lines)
            g.vao.create()
            g.vao.bind()
            g.buf.create()
            g.buf.bind()
            raw = data.tobytes()
            g.buf.allocate(raw, len(raw))
            self.line_prog.bind()
            for loc, off in ((0, 0), (1, 12)):
                self.line_prog.enableAttributeArray(loc)
                self.line_prog.setAttributeBuffer(loc, GL_FLOAT, off, 3, 24)
            g.vao.release()
            g.buf.release()
            self._line_gpu = g
        self._dirty = False

    def resizeGL(self, w, h):
        if self._frame_on_resize:
            self.frame()

    def matrices(self):
        eye = self.center + QVector3D(math.sin(self.yaw) * math.cos(self.pitch),
                                      math.cos(self.yaw) * math.cos(self.pitch),
                                      math.sin(self.pitch)) * self.dist
        view = QMatrix4x4()
        view.lookAt(eye, self.center, QVector3D(0, 0, 1))
        proj = QMatrix4x4()
        proj.perspective(FOV, max(1, self.width()) / max(1, self.height()), self.dist * 0.02, self.dist * 10)
        return proj, view

    def paintGL(self):
        gl = self.gl
        gl.glClearColor(0.16, 0.17, 0.2, 1.0)
        gl.glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)
        if self.error:
            return
        if self._dirty:
            self._upload()
        proj, view = self.matrices()
        mvp = proj * view
        gl.glEnable(GL_DEPTH_TEST)
        prog, u = self.mesh_prog, self.u
        prog.bind()
        prog.setUniformValue(u["mvp"], mvp)
        prog.setUniformValue(u["view"], view)
        prog.setUniformValue1i(u["tex"], 0)
        prog.setUniformValue1i(u["show_heat"], 1 if self.highlight is not None else 0)
        for g in sorted(self._gpu, key=lambda g: -g.alpha):
            if g.alpha < 1.0:
                gl.glEnable(GL_BLEND)
                gl.glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
            prog.setUniformValue1f(u["alpha"], float(g.alpha))
            prog.setUniformValue1i(u["has_tex"], 1 if g.texture is not None else 0)
            if g.texture is not None:
                g.texture.bind(0)
            g.vao.bind()
            gl.glDrawArrays(GL_TRIANGLES, 0, g.count)
            g.vao.release()
            if g.texture is not None:
                g.texture.release()
            gl.glDisable(GL_BLEND)
        if self._line_gpu and self.show_bones:
            gl.glDisable(GL_DEPTH_TEST)
            self.line_prog.bind()
            self.line_prog.setUniformValue(self.u_line, mvp)
            self._line_gpu.vao.bind()
            gl.glDrawArrays(GL_LINES, 0, self._line_gpu.count)
            self._line_gpu.vao.release()
            gl.glEnable(GL_DEPTH_TEST)

    # mouse

    def mousePressEvent(self, e):
        self._last = e.position()
        self._frame_on_resize = False

    def mouseMoveEvent(self, e):
        if self._last is None:
            return
        d = e.position() - self._last
        self._last = e.position()
        if e.buttons() & Qt.LeftButton and not e.modifiers() & Qt.ShiftModifier:
            self.yaw -= d.x() * 0.01
            self.pitch = max(-1.5, min(1.5, self.pitch + d.y() * 0.01))
        else:
            k = self.dist * 0.0015
            right = QVector3D(math.cos(self.yaw), -math.sin(self.yaw), 0)
            self.center += right * (-d.x() * k) + QVector3D(0, 0, d.y() * k)
        self.update()

    def mouseReleaseEvent(self, e):
        self._last = None

    def wheelEvent(self, e):
        self.dist *= 0.9 if e.angleDelta().y() > 0 else 1.0 / 0.9
        self.update()
