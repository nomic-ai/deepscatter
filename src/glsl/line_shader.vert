precision mediump float;

attribute vec2 a_position;

varying vec4 fill;

uniform mat3 u_window_scale;
uniform mat3 u_zoom;
uniform float u_height;
uniform vec4 u_color;
uniform float u_width;

mat3 pixelspace_to_glspace;

vec2 calculate_position(in vec2 position,
                        in mat3 window_scale,
                        in mat3 zoom) {
    vec3 pos2d = vec3(position, 1.0) * window_scale * zoom;
    pos2d = pos2d * pixelspace_to_glspace;
    return pos2d.xy;
}


void main() {
  pixelspace_to_glspace = mat3(
      2. / u_width, 0., -1.,
      0., - 2. / u_height, 1.,
      0., 0., 1.
  );

  fill = vec4(.5, .5, .5, .5);
  vec2 position = calculate_position(a_position,
    u_window_scale, u_zoom);
  gl_Position = vec4(position, 1., 1.);
}
