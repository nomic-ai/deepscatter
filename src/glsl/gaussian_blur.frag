precision mediump float;

#pragma glslify: blur = require('glsl-fast-gaussian-blur/13')

uniform vec2 iResolution;
uniform sampler2D iChannel0;
uniform vec2 direction;

void main() {
  vec2 uv = vec2(gl_FragCoord.xy / iResolution.xy);
  gl_FragColor = blur(iChannel0, uv, iResolution.xy, direction);
}
