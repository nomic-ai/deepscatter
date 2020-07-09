precision mediump float;

varying float pic_mode;
varying vec4 fill;
varying vec4 stroke;
varying vec2 letter_pos;
uniform float u_only_color;
uniform sampler2D u_sprites;

bool out_of_circle(in vec2 coord) {
  vec2 cxy = 2.0 * coord - 1.0;
  float r_sq = dot(cxy, cxy);
  if (r_sq > 1.0) {return false;}
  return true;
}

bool out_of_triangle(in vec2 coord) {
  if (coord.y > (2. * abs(coord.x-.5))) {
    return false;
  }
  return true;
}

void main() {

  if (u_only_color >= -1.5) {
    gl_FragColor = vec4(0., 0., 0., 6./255.);
    return;
  }


  if (pic_mode < 0.5 ) {
    // Drop parts of the rectangle outside the unit circle.
    // I took this from observable.
/*    if (r > 0.85) {
      gl_FragColor = vec4(30., 30., 30., 1.);
    } */
    /*if (out_of_triangle(gl_PointCoord)) {
      discard;
    }*/
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
