/*
 * Web Worker：在后台线程用 OffscreenCanvas 创建独立 WebGL 上下文，
 * 预编译/预链接用户着色器，把驱动原始 infoLog 返回主线程解析。
 * 好处：编译出错不会影响主线程正在渲染的 program。
 */
/* eslint-disable no-restricted-globals */
'use strict';

var gl = null;
var glError = null;

function getGL() {
  if (gl || glError) return gl;
  try {
    if (typeof OffscreenCanvas === 'undefined') {
      glError = 'NO_OFFSCREEN_CANVAS';
      return null;
    }
    var canvas = new OffscreenCanvas(1, 1);
    gl = canvas.getContext('webgl2') || canvas.getContext('webgl') ||
         canvas.getContext('experimental-webgl');
    if (!gl) glError = 'NO_WEBGL_IN_WORKER';
  } catch (e) {
    glError = 'WORKER_GL_EXCEPTION: ' + (e && e.message);
    gl = null;
  }
  return gl;
}

function compileOne(type, source) {
  var shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  var ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  var log = gl.getShaderInfoLog(shader) || '';
  gl.deleteShader(shader);
  return { ok: ok, log: log };
}

self.onmessage = function (e) {
  var data = e.data;
  var result = { id: data.id };

  if (!getGL()) {
    result.unsupported = glError || 'UNKNOWN';
    self.postMessage(result);
    return;
  }

  try {
    result.vertex = compileOne(gl.VERTEX_SHADER, data.vertex);
    result.fragment = compileOne(gl.FRAGMENT_SHADER, data.fragment);

    // 两个都编译成功才尝试链接
    if (result.vertex.ok && result.fragment.ok) {
      var prog = gl.createProgram();
      var vs = gl.createShader(gl.VERTEX_SHADER);
      var fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(vs, data.vertex);
      gl.compileShader(vs);
      gl.shaderSource(fs, data.fragment);
      gl.compileShader(fs);
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      result.link = {
        ok: gl.getProgramParameter(prog, gl.LINK_STATUS),
        log: gl.getProgramInfoLog(prog) || ''
      };
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    }
  } catch (err) {
    result.exception = String((err && err.message) || err);
  }

  self.postMessage(result);
};
