// A small WebGL2 viewport: textured meshes in the game's frame, bone lines and a weight heat map.
import type { BoneLine, MeshData } from '../../core/preview'

const FOV = 35.0

const MESH_VS = `#version 300 es
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
}`

const MESH_FS = `#version 300 es
precision mediump float;
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
}`

const LINE_VS = `#version 300 es
layout(location = 0) in vec3 pos;
layout(location = 1) in vec3 col;
uniform mat4 mvp;
out vec3 v_col;
void main() { gl_Position = mvp * vec4(pos, 1.0); v_col = col; }`

const LINE_FS = `#version 300 es
precision mediump float;
in vec3 v_col;
out vec4 frag;
void main() { frag = vec4(v_col, 1.0); }`

type Vec3 = [number, number, number]
type Mat4 = Float32Array

function perspective(fovDeg: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360)
  const m = new Float32Array(16)
  m[0] = f / aspect
  m[5] = f
  m[10] = (far + near) / (near - far)
  m[11] = -1
  m[14] = (2 * far * near) / (near - far)
  return m
}

function lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const norm = (a: Vec3): Vec3 => {
    const n = Math.hypot(...a) || 1
    return [a[0] / n, a[1] / n, a[2] / n]
  }
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const f = norm(sub(center, eye))
  const s = norm(cross(f, up))
  const u = cross(s, f)
  return new Float32Array([s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -dot(s, eye), -dot(u, eye), dot(f, eye), 1])
}

function mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
    out[c * 4 + r] = s
  }
  return out
}

interface Gpu {
  vao: WebGLVertexArrayObject
  buf: WebGLBuffer
  count: number
  texture: WebGLTexture | null
  alpha: number
}

export class Viewport {
  canvas: HTMLCanvasElement
  gl: WebGL2RenderingContext | null
  error: string | null = null
  meshes: MeshData[] = []
  lines: BoneLine[] = []
  highlight: string | number | null = null
  showBones = true
  yaw = 0.0
  pitch = 0.15
  dist = 3.0
  center: Vec3 = [0, 0, 1]
  private dirty = true
  private gpu: Gpu[] = []
  private lineGpu: Gpu | null = null
  private meshProg: WebGLProgram | null = null
  private lineProg: WebGLProgram | null = null
  private last: [number, number] | null = null
  private frameOnResize = true
  private raf = 0
  private observer: ResizeObserver

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.gl = canvas.getContext('webgl2', { antialias: true })
    if (!this.gl) this.error = 'WebGL 2 is not available in this browser'
    else {
      this.meshProg = this.program(MESH_VS, MESH_FS)
      this.lineProg = this.program(LINE_VS, LINE_FS)
    }
    canvas.addEventListener('pointerdown', this.down)
    canvas.addEventListener('pointermove', this.move)
    canvas.addEventListener('pointerup', this.up)
    canvas.addEventListener('pointercancel', this.up)
    canvas.addEventListener('wheel', this.wheel, { passive: false })
    this.observer = new ResizeObserver(() => {
      if (this.frameOnResize) this.frame()
      this.update()
    })
    this.observer.observe(canvas)
  }

  dispose() {
    this.observer.disconnect()
    cancelAnimationFrame(this.raf)
    this.release()
  }

  private program(vs: string, fs: string): WebGLProgram | null {
    const gl = this.gl!
    const p = gl.createProgram()!
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as [number, string][]) {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      gl.attachShader(p, s)
    }
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      this.error = 'WebGL shaders failed: ' + gl.getProgramInfoLog(p)
      return null
    }
    return p
  }

  setScene(meshes: MeshData[], lines: BoneLine[], fit = true) {
    this.meshes = meshes
    this.lines = lines
    if (fit) {
      this.frame()
      this.frameOnResize = true
    }
    this.dirty = true
    this.update()
  }

  setHighlight(key: string | number | null) {
    if (key !== this.highlight) {
      this.highlight = key
      this.dirty = true
      this.update()
    }
  }

  setShowBones(on: boolean) {
    this.showBones = on
    this.update()
  }

  frame() {
    const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity]
    const take = (x: number, y: number, z: number) => {
      const v = [x, y, z]
      for (let i = 0; i < 3; i++) {
        if (v[i] < lo[i]) lo[i] = v[i]
        if (v[i] > hi[i]) hi[i] = v[i]
      }
    }
    for (const m of this.meshes) for (let i = 0; i < m.positions.length; i += 3) take(m.positions[i], m.positions[i + 1], m.positions[i + 2])
    if (!this.meshes.some((m) => m.positions.length)) for (const [a, b] of this.lines) { take(...a); take(...b) }
    if (lo[0] === Infinity) return
    this.center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
    const halfH = Math.max(1e-3, (hi[2] - lo[2]) / 2)
    const halfW = Math.max(1e-3, Math.max(hi[0] - lo[0], hi[1] - lo[1]) / 2)
    const aspect = Math.max(1, this.canvas.clientWidth) / Math.max(1, this.canvas.clientHeight)
    const t = Math.tan((FOV * Math.PI) / 360)
    this.dist = 1.15 * Math.max(halfH / t, halfW / (t * aspect)) + halfW
  }

  view(name: 'front' | 'right' | 'back' | 'left') {
    this.yaw = { front: 0.0, right: Math.PI / 2, back: Math.PI, left: -Math.PI / 2 }[name]
    this.pitch = 0.1
    this.update()
  }

  private release() {
    const gl = this.gl
    if (!gl) return
    for (const g of [...this.gpu, ...(this.lineGpu ? [this.lineGpu] : [])]) {
      gl.deleteBuffer(g.buf)
      gl.deleteVertexArray(g.vao)
      if (g.texture) gl.deleteTexture(g.texture)
    }
    this.gpu = []
    this.lineGpu = null
  }

  private upload() {
    const gl = this.gl!
    this.release()
    const hl = this.highlight
    for (const m of this.meshes) {
      const n = m.positions.length / 3
      const data = new Float32Array(n * 9)
      const key = hl === null ? -1 : m.keys.indexOf(hl)
      for (let i = 0; i < n; i++) {
        data.set(m.positions.subarray(i * 3, i * 3 + 3), i * 9)
        data.set(m.normals.subarray(i * 3, i * 3 + 3), i * 9 + 3)
        data.set(m.uvs.subarray(i * 2, i * 2 + 2), i * 9 + 6)
        let heat = 0
        if (key >= 0) for (let k = 0; k < 3; k++) if (m.influenceKeys[i * 3 + k] === key) heat += m.influences[i * 3 + k]
        data[i * 9 + 8] = heat
      }
      const vao = gl.createVertexArray()!
      gl.bindVertexArray(vao)
      const buf = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
      for (const [loc, off, size] of [[0, 0, 3], [1, 12, 3], [2, 24, 2], [3, 32, 1]]) {
        gl.enableVertexAttribArray(loc)
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 36, off)
      }
      gl.bindVertexArray(null)
      let texture: WebGLTexture | null = null
      if (m.image) {
        texture = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
        const px = new Uint8Array(m.image.data.buffer, m.image.data.byteOffset, m.image.width * m.image.height * 4)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, m.image.width, m.image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, px)
        gl.generateMipmap(gl.TEXTURE_2D)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      }
      this.gpu.push({ vao, buf, count: n, texture, alpha: m.alpha })
    }
    if (this.lines.length) {
      const data = new Float32Array(this.lines.length * 12)
      this.lines.forEach(([a, b, key], i) => {
        const col = key !== null && key === hl ? [1.0, 0.85, 0.1] : [0.2, 0.9, 1.0]
        data.set([...a, ...col, ...b, ...col], i * 12)
      })
      const vao = gl.createVertexArray()!
      gl.bindVertexArray(vao)
      const buf = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
      for (const [loc, off] of [[0, 0], [1, 12]]) {
        gl.enableVertexAttribArray(loc)
        gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 24, off)
      }
      gl.bindVertexArray(null)
      this.lineGpu = { vao, buf, count: 2 * this.lines.length, texture: null, alpha: 1 }
    }
    this.dirty = false
  }

  update() {
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(() => this.paint())
  }

  private paint() {
    const gl = this.gl
    if (!gl || this.error) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr)), h = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    gl.viewport(0, 0, w, h)
    gl.clearColor(0.16, 0.17, 0.2, 1.0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    if (this.dirty) this.upload()
    const eye: Vec3 = [
      this.center[0] + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist,
      this.center[1] + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist,
      this.center[2] + Math.sin(this.pitch) * this.dist,
    ]
    const view = lookAt(eye, this.center, [0, 0, 1])
    const proj = perspective(FOV, w / h, this.dist * 0.02, this.dist * 10)
    const mvp = mul(proj, view)
    gl.enable(gl.DEPTH_TEST)
    const p = this.meshProg!
    gl.useProgram(p)
    const u = (n: string) => gl.getUniformLocation(p, n)
    gl.uniformMatrix4fv(u('mvp'), false, mvp)
    gl.uniformMatrix4fv(u('view'), false, view)
    gl.uniform1i(u('tex'), 0)
    gl.uniform1i(u('show_heat'), this.highlight !== null ? 1 : 0)
    for (const g of [...this.gpu].sort((a, b) => b.alpha - a.alpha)) {
      if (g.alpha < 1.0) {
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      }
      gl.uniform1f(u('alpha'), g.alpha)
      gl.uniform1i(u('has_tex'), g.texture ? 1 : 0)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, g.texture)
      gl.bindVertexArray(g.vao)
      gl.drawArrays(gl.TRIANGLES, 0, g.count)
      gl.bindVertexArray(null)
      gl.disable(gl.BLEND)
    }
    if (this.lineGpu && this.showBones) {
      gl.disable(gl.DEPTH_TEST)
      gl.useProgram(this.lineProg)
      gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProg!, 'mvp'), false, mvp)
      gl.bindVertexArray(this.lineGpu.vao)
      gl.drawArrays(gl.LINES, 0, this.lineGpu.count)
      gl.bindVertexArray(null)
      gl.enable(gl.DEPTH_TEST)
    }
  }

  private down = (e: PointerEvent) => {
    this.last = [e.clientX, e.clientY]
    this.frameOnResize = false
    this.canvas.setPointerCapture(e.pointerId)
  }

  private move = (e: PointerEvent) => {
    if (!this.last) return
    const dx = e.clientX - this.last[0], dy = e.clientY - this.last[1]
    this.last = [e.clientX, e.clientY]
    if (e.buttons & 1 && !e.shiftKey) {
      this.yaw -= dx * 0.01
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + dy * 0.01))
    } else {
      const k = this.dist * 0.0015
      const right: Vec3 = [Math.cos(this.yaw), -Math.sin(this.yaw), 0]
      this.center = [this.center[0] - right[0] * dx * k, this.center[1] - right[1] * dx * k, this.center[2] + dy * k]
    }
    this.update()
  }

  private up = () => {
    this.last = null
  }

  private wheel = (e: WheelEvent) => {
    e.preventDefault()
    this.dist *= e.deltaY < 0 ? 0.9 : 1.0 / 0.9
    this.update()
  }
}
