precision mediump float;

varying float pic_mode;
varying vec4 fill;
varying vec4 stroke;
varying vec2 letter_pos;
uniform float u_only_color;
uniform sampler2D u_sprites;

void main() {
  if (u_only_color >= -1.5) {
    gl_FragColor = vec4(0., 0., 0., 6./255.);
    return;
  }

  if (pic_mode < 0.5 ) {
    // Drop parts of the rectangle outside the unit circle.
    // I took this from observable.
    vec2 cxy = 2.0 * gl_PointCoord - 1.0;
    float r = sqrt(dot(cxy, cxy));
    if (r > 1.0) discard;
/*    if (r > 0.85) {
      gl_FragColor = vec4(30., 30., 30., 1.);
    } */
//    if (r < 0.75) discard;
   // Pre-blend the alpha channel.
    gl_FragColor = vec4(fill.rgb * fill.a, fill.a);
  } else {
    vec2 coords = letter_pos + gl_PointCoord/4096.*28.;
    vec4 letter = texture2D(u_sprites, coords);
    if (letter.a <= 0.03) discard;
    gl_FragColor = mix(fill, vec4(0.25, 0.1, 0.2, 1.0), 1.0 - letter.a);
    // gl_FragColor = vec4(fill.xyz, letter.a);
  }
}
