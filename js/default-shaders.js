/* 内置默认着色器（GLSL ES 1.00，WebGL1/2 均兼容）。
 * 可用 uniform：
 *   u_time       float  秒
 *   u_resolution vec2   画布像素尺寸
 *   u_mouse      vec2   鼠标位置（像素）
 */
(function (global) {
  'use strict';

  var DEFAULT_VERTEX = [
    'attribute vec2 a_position;',
    'varying vec2 v_uv;',
    '',
    'void main() {',
    '    v_uv = a_position * 0.5 + 0.5;',
    '    gl_Position = vec4(a_position, 0.0, 1.0);',
    '}',
    ''
  ].join('\n');

  var DEFAULT_FRAGMENT = [
    'precision mediump float;',
    '',
    'uniform float u_time;',
    'uniform vec2 u_resolution;',
    'uniform vec2 u_mouse;',
    'varying vec2 v_uv;',
    '',
    'void main() {',
    '    vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);',
    '    vec2 m = (u_mouse * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);',
    '',
    '    float d = length(uv - m);',
    '    float wave = sin(10.0 * d - u_time * 2.0) * 0.5 + 0.5;',
    '',
    '    vec3 col = 0.5 + 0.5 * cos(u_time + uv.xyx + vec3(0.0, 2.0, 4.0));',
    '    col *= smoothstep(1.2, 0.2, d) * 0.6 + wave * 0.4;',
    '',
    '    gl_FragColor = vec4(col, 1.0);',
    '}',
    ''
  ].join('\n');

  global.DefaultShaders = { vertex: DEFAULT_VERTEX, fragment: DEFAULT_FRAGMENT };
})(typeof self !== 'undefined' ? self : this);
