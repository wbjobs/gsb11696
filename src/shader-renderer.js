import { DEFAULT_FRAGMENT_SHADER, DEFAULT_VERTEX_SHADER } from "./default-shaders.js";
import { createRuntimeError, glErrorName, parseShaderLog } from "./error-parser.js";

const CONTEXT_IDS = [
  ["webgl2", "WebGL 2"],
  ["experimental-webgl2", "WebGL 2（实验性）"],
  ["webgl", "WebGL 1"],
  ["experimental-webgl", "WebGL 1（实验性）"],
];

const CONTEXT_ATTRIBUTES = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
  failIfMajorPerformanceCaveat: false,
};

function deleteProgramSafely(gl, programRecord) {
  if (!programRecord?.program) return;
  gl.deleteProgram(programRecord.program);
}

export class ShaderRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.animationFrame = 0;
    this.contextLost = false;
    this.userSource = DEFAULT_FRAGMENT_SHADER;
    this.userProgram = null;
    this.defaultProgram = null;
    this.activeProgram = null;
    this.activeKind = "default";
    this.runtimeError = null;
    this.fatalError = null;
    this.startTime = performance.now();
    this.onDiagnostic = () => {};

    const context = this.createContext();
    if (!context) {
      throw new Error("当前浏览器不支持 WebGL，或硬件加速已被禁用。");
    }
    this.gl = context.gl;
    this.contextLabel = context.label;
    this.isWebGL2 = context.name === "webgl2" || context.name === "experimental-webgl2";
    this.highpSupported = this.checkHighpSupport();
    this.defaultFragmentSource = this.prepareDefaultSource();
    this.loseContextExtension = this.gl.getExtension("WEBGL_lose_context");

    this.initializeResources();
  }

  createContext() {
    for (const [name, label] of CONTEXT_IDS) {
      const gl = this.canvas.getContext(name, CONTEXT_ATTRIBUTES);
      if (gl) return { gl, name, label };
    }
    return null;
  }

  checkHighpSupport() {
    const range = this.gl.getShaderPrecisionFormat(
      this.gl.FRAGMENT_SHADER,
      this.gl.HIGH_FLOAT,
    );
    return Boolean(range && range.precision > 0);
  }

  prepareDefaultSource() {
    if (this.highpSupported) return DEFAULT_FRAGMENT_SHADER;
    return DEFAULT_FRAGMENT_SHADER.replace("precision highp float;", "precision mediump float;");
  }

  initializeResources() {
    this.createGeometry();
    const defaultResult = this.buildProgram(DEFAULT_VERTEX_SHADER, this.defaultFragmentSource);
    if (!defaultResult.ok) {
      this.fatalError = {
        message: "内置默认着色器无法在当前浏览器中编译或链接。",
        diagnostics: defaultResult.diagnostics,
      };
      return;
    }

    this.defaultProgram = defaultResult.program;
    this.activeProgram = this.defaultProgram;
    this.activeKind = "default";
  }

  createGeometry() {
    const gl = this.gl;
    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
  }

  compileShader(type, source, stage) {
    try {
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
      const log = gl.getShaderInfoLog(shader) || "";
      if (!ok) {
        gl.deleteShader(shader);
        return {
          ok: false,
          diagnostics: parseShaderLog(log, source, stage),
        };
      }

      return {
        ok: true,
        shader,
        diagnostics: parseShaderLog(log, source, stage).map((item) => ({
          ...item,
          severity: "warning",
        })),
      };
    } catch (exception) {
      return {
        ok: false,
        diagnostics: [{
          id: `${stage}-exception-${Date.now()}`,
          stage,
          severity: "error",
          sourceId: null,
          line: null,
          column: null,
          message: `${stage} 阶段浏览器抛出异常：${exception.message}`,
          position: null,
        }],
      };
    }
  }

  buildProgram(vertexSource, fragmentSource) {
    let vertexRecord = null;
    let fragmentRecord = null;
    let program = null;
    try {
      if (this.contextLost || !this.gl) return { ok: false, diagnostics: [] };

      const gl = this.gl;
      this.drainGLErrors();

      vertexRecord = this.compileShader(gl.VERTEX_SHADER, vertexSource, "vertex");
      const vertex = vertexRecord;
      if (!vertex.ok) return vertex;

      fragmentRecord = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource, "fragment");
      const fragment = fragmentRecord;
      if (!fragment.ok) {
        gl.deleteShader(vertex.shader);
        return fragment;
      }

      program = gl.createProgram();
      gl.attachShader(program, vertex.shader);
      gl.attachShader(program, fragment.shader);
      gl.bindAttribLocation(program, 0, "a_position");
      gl.linkProgram(program);

      const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
      const linkLog = gl.getProgramInfoLog(program) || "";
      gl.deleteShader(vertex.shader);
      gl.deleteShader(fragment.shader);

      if (!linked) {
        gl.deleteProgram(program);
        return {
          ok: false,
          diagnostics: parseShaderLog(linkLog, fragmentSource, "link"),
        };
      }

      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.validateProgram(program);
      const valid = gl.getProgramParameter(program, gl.VALIDATE_STATUS);
      const validateLog = gl.getProgramInfoLog(program) || "";

      if (!valid) {
        gl.deleteProgram(program);
        return {
          ok: false,
          diagnostics: parseShaderLog(validateLog, fragmentSource, "validate"),
        };
      }

      const code = gl.getError();
      if (code !== gl.NO_ERROR) {
        gl.deleteProgram(program);
        return {
          ok: false,
          diagnostics: [{
            id: `build-${code}`,
            stage: "link",
            severity: "error",
            line: null,
            column: null,
            message: `程序构建后检测到 ${glErrorName(gl, code)}`,
            position: null,
          }],
        };
      }

      return {
        ok: true,
        program: {
          program,
          locations: {
            time: gl.getUniformLocation(program, "u_time"),
            resolution: gl.getUniformLocation(program, "u_resolution"),
          },
        },
        diagnostics: parseShaderLog(`${linkLog}${validateLog}`, fragmentSource, "link")
          .map((item) => ({ ...item, severity: "warning" })),
      };
    } catch (exception) {
      if (vertexRecord?.shader) this.gl.deleteShader(vertexRecord.shader);
      if (fragmentRecord?.shader) this.gl.deleteShader(fragmentRecord.shader);
      if (program) this.gl.deleteProgram(program);
      return {
        ok: false,
        diagnostics: [{
          id: `build-exception-${Date.now()}`,
          stage: "link",
          severity: "error",
          sourceId: null,
          line: null,
          column: null,
          message: `链接或校验阶段浏览器抛出异常：${exception.message}`,
          position: null,
        }],
      };
    }
  }

  setUserShader(source) {
    this.userSource = source;
    this.runtimeError = null;
    this.fatalError = null;

    if (this.contextLost) {
      return {
        ok: false,
        diagnostics: [{
          id: "context-lost-compile",
          stage: "context",
          severity: "error",
          line: null,
          column: null,
          message: "上下文已丢失，源码会在恢复后重新编译。",
          position: null,
        }],
      };
    }

    const result = this.buildProgram(DEFAULT_VERTEX_SHADER, this.userSource);
    if (!result.ok) {
      this.activateDefault();
      return result;
    }

    const previous = this.userProgram;
    this.userProgram = result.program;
    this.activeProgram = result.program;
    this.activeKind = "user";
    if (previous) deleteProgramSafely(this.gl, previous);
    return result;
  }

  activateDefault() {
    if (!this.contextLost && this.defaultProgram) {
      this.gl.useProgram(this.defaultProgram.program);
    }
    this.activeProgram = this.defaultProgram;
    this.activeKind = "default";
  }

  fallbackToDefault(error) {
    this.runtimeError = error;
    this.activateDefault();
    this.onDiagnostic(error);
  }

  drainGLErrors() {
    let code = this.gl.getError();
    while (code !== this.gl.NO_ERROR) code = this.gl.getError();
  }

  safeGlCall(label, callback) {
    let result;
    try {
      result = callback();
    } catch (exception) {
      return {
        error: {
          id: `exception-${label}-${Date.now()}`,
          stage: "runtime",
          severity: "error",
          line: null,
          column: null,
          message: `${label} 抛出异常：${exception.message}`,
          exception,
        },
      };
    }

    const code = this.gl.getError();
    if (code !== this.gl.NO_ERROR) {
      return { error: createRuntimeError(this.gl, label, code) };
    }
    return { value: result };
  }

  resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    return { width, height };
  }

  renderFrame = () => {
    if (this.contextLost) return;
    this.animationFrame = requestAnimationFrame(this.renderFrame);
    if (this.fatalError || !this.activeProgram) return;

    const gl = this.gl;
    const record = this.activeProgram;
    const size = this.safeGlCall("resizeCanvas", () => {
      this.resizeCanvas();
      return {
        width: this.canvas.width,
        height: this.canvas.height,
      };
    });
    if (size.error) return this.handleFrameError(size.error);
    const { width, height } = size.value;

    const calls = [
      ["viewport", () => gl.viewport(0, 0, width, height)],
      ["clear", () => {
        gl.clearColor(0.025, 0.03, 0.045, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }],
      ["useProgram", () => gl.useProgram(record.program)],
      ["bindGeometry", () => {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      }],
      ["setUniforms", () => {
        const elapsed = (performance.now() - this.startTime) / 1000;
        if (record.locations.time) gl.uniform1f(record.locations.time, elapsed);
        if (record.locations.resolution) gl.uniform2f(record.locations.resolution, width, height);
      }],
      ["drawArrays", () => gl.drawArrays(gl.TRIANGLES, 0, 3)],
    ];

    this.drainGLErrors();
    for (const [label, call] of calls) {
      const result = this.safeGlCall(label, call);
      if (result.error) {
        return this.handleFrameError(result.error);
      }
    }
  };

  handleFrameError(error) {
    const gl = this.gl;
    if (error.code === gl.CONTEXT_LOST_WEBGL || this.gl.isContextLost?.()) return;
    if (this.activeKind === "user") {
      this.fallbackToDefault(error);
      return;
    }
    this.fatalError = error;
    this.onDiagnostic(error);
    cancelAnimationFrame(this.animationFrame);
  }

  start() {
    if (!this.animationFrame) this.renderFrame();
  }

  forceLoseContext() {
    this.loseContextExtension?.loseContext();
  }

  forceRestoreContext() {
    this.loseContextExtension?.restoreContext();
  }

  probeLinkFailure() {
    const vertexSource = `
attribute vec2 a_position;
varying vec4 v_link_probe;
void main() {
  v_link_probe = vec4(a_position, 0.0, 1.0);
  gl_Position = vec4(a_position, 0.0, 1.0);
}`.trim();
    const fragmentSource = `
${this.highpSupported ? "precision highp float;" : "precision mediump float;"}
varying vec2 v_link_probe;
void main() {
  gl_FragColor = vec4(v_link_probe, 0.0, 1.0);
}`.trim();
    return this.buildProgram(vertexSource, fragmentSource);
  }

  probeRuntimeError() {
    this.drainGLErrors();
    return this.safeGlCall("runtimeProbe", () => this.gl.enable(0x9999));
  }

  async handleContextLost() {
    this.contextLost = true;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    this.activeProgram = null;
    this.userProgram = null;
    this.defaultProgram = null;
    this.vertexBuffer = null;
  }

  handleContextRestored() {
    this.contextLost = false;
    this.runtimeError = null;
    this.fatalError = null;
    this.animationFrame = 0;
    this.loseContextExtension = this.gl.getExtension("WEBGL_lose_context");
    this.initializeResources();

    let result = { ok: true, diagnostics: [] };
    if (this.userSource !== DEFAULT_FRAGMENT_SHADER) {
      result = this.setUserShader(this.userSource);
    }
    this.start();
    return result;
  }

  getEnvironmentInfo() {
    const gl = this.gl;
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);

    return {
      context: this.contextLabel,
      renderer: renderer || "浏览器未提供渲染器信息",
      highp: this.highpSupported,
      contextLostExtension: Boolean(this.loseContextExtension),
    };
  }
}
