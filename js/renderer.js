/*
 * 主线程 WebGL 渲染器：
 * - WebGL2 -> WebGL1 -> experimental-webgl 逐级降级（浏览器差异处理）
 * - program 编译/链接，失败时保留上一个可用 program 或回退默认着色器
 * - webglcontextlost / webglcontextrestored 处理与资源重建
 * - 渲染循环 try/catch + 可选的每帧 gl.getError() 运行时错误捕获
 */
(function (global) {
  'use strict';

  function Renderer(canvas, hooks) {
    this.canvas = canvas;
    this.hooks = hooks || {};
    this.gl = null;
    this.glKind = '';
    this.program = null;
    this.programLabel = 'none';
    this.defaultProgram = null;
    this.buffer = null;
    this.uniforms = {};
    this.contextLost = false;
    this.running = false;
    this.startTime = performance.now();
    this.mouse = { x: 0, y: 0 };
    this.checkGLErrorPerFrame = false;
    this.frames = 0;
    this.fpsTime = performance.now();
    this.loseContextExt = null;
    this.lastRuntimeError = '';

    this.boundLoop = this.loop.bind(this);
    this.initGL();
    this.bindEvents();
  }

  Renderer.prototype.log = function (level, msg) {
    if (this.hooks.onLog) this.hooks.onLog(level, msg);
  };

  Renderer.prototype.setStatus = function (status, label) {
    if (this.hooks.onStatus) this.hooks.onStatus(status, label);
  };

  Renderer.prototype.initGL = function () {
    var attrs = { antialias: true, preserveDrawingBuffer: false };
    var gl = this.canvas.getContext('webgl2', attrs);
    this.glKind = 'WebGL2';
    if (!gl) {
      gl = this.canvas.getContext('webgl', attrs) ||
           this.canvas.getContext('experimental-webgl', attrs);
      this.glKind = 'WebGL1';
    }
    if (!gl) {
      this.gl = null;
      this.setStatus('err', 'WebGL 不可用');
      this.log('error', '[环境] 当前浏览器不支持 WebGL，无法渲染。');
      return;
    }
    this.gl = gl;
    this.loseContextExt = gl.getExtension('WEBGL_lose_context') || null;

    // 全屏三角形
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    // 构建默认 program 作为兜底
    this.defaultProgram = this.buildProgram(
      DefaultShaders.vertex, DefaultShaders.fragment);
    if (this.defaultProgram.program) {
      this.useProgram(this.defaultProgram.program, 'default');
    } else {
      this.log('error', '[环境] 内置默认着色器编译失败：' +
        this.defaultProgram.errors.map(function (e) { return e.message; }).join('; '));
    }

    var info = this.glKind;
    try {
      var dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) info += ' / ' + gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
    } catch (e) { /* 忽略 */ }
    if (this.hooks.onGLInfo) this.hooks.onGLInfo(info);
    this.log('info', '[环境] ' + info + (this.loseContextExt ? '' : '（无 WEBGL_lose_context 扩展）'));
  };

  Renderer.prototype.bindEvents = function () {
    var self = this;

    this.canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault(); // 允许之后恢复
      self.contextLost = true;
      self.program = null;
      self.defaultProgram = null;
      self.setStatus('err', '上下文丢失');
      self.log('warn', '[运行时] WebGL 上下文丢失，等待恢复…');
      if (self.hooks.onContextLost) self.hooks.onContextLost();
    });

    this.canvas.addEventListener('webglcontextrestored', function () {
      self.contextLost = false;
      self.log('ok', '[运行时] WebGL 上下文已恢复，正在重建资源…');
      self.initGL();
      if (self.hooks.onContextRestored) self.hooks.onContextRestored();
    });

    this.canvas.addEventListener('pointermove', function (e) {
      var r = self.canvas.getBoundingClientRect();
      var dpr = self.canvas.width / Math.max(1, r.width);
      self.mouse.x = (e.clientX - r.left) * dpr;
      self.mouse.y = self.canvas.height - (e.clientY - r.top) * dpr;
    });
  };

  /** 编译 + 链接，返回 {program, errors:[{stage,severity,line,col,message}]} */
  Renderer.prototype.buildProgram = function (vsSource, fsSource) {
    var gl = this.gl;
    var errors = [];
    if (!gl) return { program: null, errors: [{ stage: 'env', severity: 'ERROR', line: 0, col: 0, message: 'WebGL 不可用' }] };

    function compile(type, source, stage) {
      var shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      var ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
      var log = gl.getShaderInfoLog(shader) || '';
      if (!ok) {
        GLSLErrors.parseInfoLog(log).forEach(function (e) {
          e.stage = stage;
          errors.push(e);
        });
        gl.deleteShader(shader);
        return null;
      }
      // 编译成功也可能有 warning
      GLSLErrors.parseInfoLog(log).forEach(function (e) {
        if (e.severity === 'WARNING') {
          e.stage = stage;
          errors.push(e);
        }
      });
      return shader;
    }

    var vs = compile(gl.VERTEX_SHADER, vsSource, 'vert');
    var fs = compile(gl.FRAGMENT_SHADER, fsSource, 'frag');
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return { program: null, errors: errors };
    }

    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      var linkLog = gl.getProgramInfoLog(program) || '';
      GLSLErrors.parseLinkLog(linkLog).forEach(function (e) {
        e.stage = 'link';
        errors.push(e);
      });
      gl.deleteProgram(program);
      return { program: null, errors: errors };
    }
    return { program: program, errors: errors };
  };

  Renderer.prototype.useProgram = function (program, label) {
    var gl = this.gl;
    if (this.program && this.program !== program &&
        (!this.defaultProgram || this.program !== this.defaultProgram.program)) {
      gl.deleteProgram(this.program);
    }
    this.program = program;
    this.programLabel = label;
    gl.useProgram(program);

    var loc = gl.getAttribLocation(program, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.uniforms = {
      u_time: gl.getUniformLocation(program, 'u_time'),
      u_resolution: gl.getUniformLocation(program, 'u_resolution'),
      u_mouse: gl.getUniformLocation(program, 'u_mouse')
    };
    if (this.hooks.onProgramChange) this.hooks.onProgramChange(label);
  };

  /**
   * 热重载入口：尝试应用新着色器。
   * 成功 -> 切换到新 program；失败 -> 保留现状（或回退默认），返回错误列表。
   */
  Renderer.prototype.applyShaders = function (vsSource, fsSource) {
    if (!this.gl || this.contextLost) {
      return { ok: false, errors: [{ stage: 'env', severity: 'ERROR', line: 0, col: 0, message: '上下文不可用' }] };
    }
    var result = this.buildProgram(vsSource, fsSource);
    if (result.program) {
      this.useProgram(result.program, 'user');
      this.setStatus('ok', '运行中');
      return { ok: true, errors: result.errors };
    }
    // 失败：若当前没有可用 program，回退到默认着色器
    if (!this.program && this.defaultProgram && this.defaultProgram.program) {
      this.useProgram(this.defaultProgram.program, 'default (fallback)');
      this.log('warn', '[降级] 用户着色器失败，已回退到默认着色器。');
    }
    this.setStatus('err', '着色器错误');
    return { ok: false, errors: result.errors };
  };

  Renderer.prototype.simulateContextLoss = function () {
    if (this.loseContextExt) {
      this.loseContextExt.loseContext();
    } else {
      this.log('warn', '[运行时] 当前环境不支持 WEBGL_lose_context，无法模拟。');
    }
  };

  Renderer.prototype.forceRestore = function () {
    if (this.loseContextExt) this.loseContextExt.restoreContext();
  };

  Renderer.prototype.resize = function () {
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var w = Math.floor(this.canvas.clientWidth * dpr);
    var h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  };

  Renderer.prototype.start = function () {
    if (!this.running) {
      this.running = true;
      this.startTime = performance.now();
      requestAnimationFrame(this.boundLoop);
    }
  };

  Renderer.prototype.loop = function (now) {
    if (!this.running) return;
    requestAnimationFrame(this.boundLoop);
    if (!this.gl || this.contextLost || !this.program) return;

    try {
      this.resize();
      var gl = this.gl;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      if (this.uniforms.u_time) gl.uniform1f(this.uniforms.u_time, (now - this.startTime) / 1000);
      if (this.uniforms.u_resolution) gl.uniform2f(this.uniforms.u_resolution, this.canvas.width, this.canvas.height);
      if (this.uniforms.u_mouse) gl.uniform2f(this.uniforms.u_mouse, this.mouse.x, this.mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (this.checkGLErrorPerFrame) {
        var err = gl.getError();
        if (err !== gl.NO_ERROR) {
          var key = '0x' + err.toString(16);
          if (key !== this.lastRuntimeError) {
            this.lastRuntimeError = key;
            this.setStatus('warn', 'GL 运行时错误');
            this.log('error', '[运行时] gl.getError() = ' + key);
          }
        }
      }
    } catch (e) {
      var msg = String((e && e.message) || e);
      if (msg !== this.lastRuntimeError) {
        this.lastRuntimeError = msg;
        this.setStatus('err', '运行时异常');
        this.log('error', '[运行时] 渲染循环异常：' + msg);
      }
    }

    this.frames++;
    if (now - this.fpsTime >= 1000) {
      if (this.hooks.onFps) {
        this.hooks.onFps(Math.round(this.frames * 1000 / (now - this.fpsTime)));
      }
      this.frames = 0;
      this.fpsTime = now;
    }
  };

  global.Renderer = Renderer;
})(typeof self !== 'undefined' ? self : this);
