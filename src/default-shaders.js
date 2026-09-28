export const DEFAULT_VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`.trimStart();

export const DEFAULT_FRAGMENT_SHADER = `
precision highp float;

varying vec2 v_uv;
uniform float u_time;
uniform vec2 u_resolution;

void main() {
  vec2 p = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
  float radius = length(p);
  float angle = atan(p.y, p.x) + u_time * 0.45;
  float bands = 0.5 + 0.5 * sin(angle * 6.0 - radius * 12.0 + u_time);
  vec3 color = 0.5 + 0.5 * cos(u_time + vec3(0.0, 2.0, 4.0) + bands + radius);
  color = mix(color, vec3(v_uv, 0.55), 0.18);
  gl_FragColor = vec4(color, 1.0);
}
`.trimStart();
