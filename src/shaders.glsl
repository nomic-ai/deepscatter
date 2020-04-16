// This is technically javascript, but I use the glsl suffix
// just for syntax coloring.

export let vertex_shader = `
precision mediump float;

attribute float ix;
attribute vec2 position ;
attribute float a_color;
attribute float a_size ;
attribute float a_time;
attribute float a_opacity;
attribute float a_visibility;
attribute vec4 a_label;

uniform vec2 u_color_domain;
uniform vec2 u_size_domain;
uniform vec2 u_time_domain;
uniform float u_aspect_ratio;

// Transform from data space to the open window.
uniform mat3 u_window_scale;
// Transform from the open window to the d3-zoom.
uniform mat3 u_zoom;
// Transform from the canvas coordinates to the
// webgl ones.
uniform mat3 u_untransform;
// Base point size
uniform float u_size;
// The maximum index to plot.
uniform float u_maxix;
// The current time.
uniform float u_time;
// The d3-scale factor.
uniform float u_k;
// The minimum index to attempt text regl_rendering.
uniform float u_render_text_min_ix;
// If drawing text, which text element should we draw?
uniform float u_string_index;
// Usually 'viridis'.
uniform sampler2D u_colormap;

// The fill color.
varying vec4 fill;
// Are we drawing letters, text, or images?
varying float text_mode;
// What are the coordinates of the letter
// we're drawing on the spritesheet
varying vec2 letter_pos;


// A coordinate to throw away a vertex point.
vec4 discard_me = vec4(100.0, 100.0, 1.0, 1.0);

mat3 from_coord_to_gl = u_window_scale * u_zoom * u_untransform;


/*************** COLOR SCALES *******************************/


// Ha! A gazillion version of this function:
// https://gist.github.com/kylemcdonald/f8df3bc2f8d38ca2b7cb
vec3 hsv2rgb( in vec3 c )
{
  vec3 rgb = clamp( abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0 );
  rgb = rgb*rgb*(3.0-2.0*rgb);
  return c.z * mix( vec3(1.0), rgb, c.y);
}

vec4 scaleCategorical(in float x) {
  // Category data is integers hashed to the strings.
  // Each can get its own unique colors in one plane of HSV space.
  vec3 hsv = vec3(mod(x, 11255.0)/11255.0, 0.7, 0.7);
  return vec4(hsv2rgb(hsv), 1.0);
}

float linstep (in float edge0, float edge1, float x) {
  return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
}

vec4 scaleLinear(in float x) {
  float fractional = linstep(u_color_domain.x, u_color_domain.y, x);
  return texture2D(u_colormap,
    vec2(1.0 - fractional, 0.5));
}

/*************** END COLOR SCALES *******************************/
/*float ix_to_random(in float ix, in float seed) {
  return fract(sin(ix * seed) * 43758.5453);
}*/

highp float ix_to_random(in float ix, in float seed)
{
    vec2 co = vec2(ix, seed);
    highp float a = 12.9898;
    highp float b = 78.233;
    highp float c = 43758.5453;
    highp float dt= dot(co.xy ,vec2(a,b));
    highp float sn= mod(dt,3.14);
    return fract(sin(sn) * c);
}

float ix_to_gaussian(in float ix, in float seed) {
  return ix_to_random(ix, seed) +
    ix_to_random(ix, seed + 1.) +
    ix_to_random(ix, seed + 2.) +
    ix_to_random(ix, seed + 3.) +
    ix_to_random(ix, seed + 4.) +
    ix_to_random(ix, seed + 5.) - 3.;
}

const float e = 1.618282;
// I've been convinced.
const float tau = 2. * 3.14159265359;

vec4 logarithmic_spiral_position(
  in vec3 pos2d,
  in float ix,
  in float a, // Log parameter
  in float turns, // Number of turns of spiral to do.
  in float point_size_adjust,
  in float time
  ) {
  // If this is staged between 0 and tau, it's a Random
  // location; otherwise, it's a band (or two)

  // float turns = 4.;
  // float a = 0.31;

  if (abs(pos2d.x) > 1.1 || abs(pos2d.y) > 1.1) {
    // discard even if the spiraling arm might happen to be flying by us.
    return vec4(100., 100., 1., 1.);
  }

  // Each point starts at a different place on the spiral.
  float stagger_time = ix_to_gaussian(ix, 11.) * 1.5;
  if (stagger_time > 0.75) {
    stagger_time = stagger_time + tau/2.;
  }


  // How long does a circuit take?
  float time_period = 85. * exp(ix_to_gaussian(ix, 12.)/ 6.) * (pos2d.x + 1.);




  // Adjust u_time from the clock to our current spot.
  float varying_time = u_time + stagger_time * time_period;
  // Where are we from 0 to 1 relative to the time period
  float relative_time =
     mod(varying_time, time_period)/time_period;

  // The core parameters of a log spiral.


  float theta = (1. - relative_time) * turns * tau;
  float radius = (pow(e, a * theta) - 1.0) * .0005 * point_size_adjust + .0005;

  // into euclidean space.
  vec3 pos_spiral = vec3(
   cos(theta)*radius,
   sin(theta)*radius,
   0.
  );

  float rotation = ix_to_random(ix, 3.) * tau * 0.5;

  float x_jitter = 0.*ix_to_gaussian(ix, 1.);
  float y_jitter = 0.*ix_to_gaussian(ix, 2.);

  float shear_x = 0.4 * abs(ix_to_gaussian(ix, 4.));
  mat3 transform =
      // Random jitter and zoom scale
      mat3(point_size_adjust, 0., x_jitter * .01 * point_size_adjust,
         0., point_size_adjust, y_jitter * .01 * point_size_adjust,
         0., 0., 1.) *
      // random skew.
         mat3(
           1., shear_x, 0.,
           0., 1., 0.,
           0., 0., 1.

         ) *
         // random rotation
         mat3(
            cos(rotation), -sin(rotation), 0,
            sin(rotation), cos(rotation), 0,
            0, 0, 1) *
        // rescale to viewport
         mat3(
            1., 0., 0.,
            0., -u_aspect_ratio, 0.,
            0., 0., 1.)
         ;


  return vec4((pos2d + pos_spiral * 5. *transform), 1.);
}


void main() {

if (a_visibility < 0.05) {
  gl_Position = discard_me;
  return;
}
if (ix > u_maxix) {
    // throwaway points that are too low.
    gl_Position = discard_me;
    return;
} else {
  float depth_size_adjust = (1.0 - ix / (u_maxix));
  float point_size_adjust = exp(log(u_k)*0.5);
  gl_PointSize = u_size * point_size_adjust * depth_size_adjust;// * time_adjust;// * step(0.0, time_adjust) * time_adjust;// * depth_size_adjust;//
  gl_PointSize = min(gl_PointSize, 16.);
  if (gl_PointSize <= 0.00001) {
    return;
  } else {
  // First apply the d3 zoom transform; perform the uniform translations;

    vec3 pos2d = vec3(position.x, position.y, 1.0) * from_coord_to_gl;

    gl_Position = logarithmic_spiral_position(
      pos2d,
      ix,
      0.27, // a
      4.0, // turns
      point_size_adjust,
      u_time);

    fill = scaleLinear(a_color);
    text_mode = u_render_text_min_ix - ix;
    if (text_mode > 0.0) {
      // Text needs more space.
      // We could get very fancy here. Store the bounding box in the texture.
      // The char0 here packs two ascii bytes into a float. It's not clear to me
      // if you can do four or not.

        float chardex;

        gl_PointSize = min(gl_PointSize * 4.0, 64.0);
        float char_width = 0.0025 / 4.0 * gl_PointSize;
        float joint_index;
        float pos = -1.0;
        float char_x = -char_width;

        for (int i = 0; i < 4; i++) {
          // Cycle through the letter-byte-characters.
          joint_index = a_label[i];

          pos = pos + 1.0;
          char_x = char_x + char_width;
          chardex = mod(joint_index, 256.0);
          if (pos >= u_string_index) {break; }

          pos = pos + 1.0;
          char_x = char_x + char_width;
          chardex = (joint_index-chardex)/256.0;
          if (pos >= u_string_index) { break; }
        }

        gl_Position = gl_Position + vec4(char_x, 0., 0., 0.);

        // Bail if the charcode isn't defined.
        if (chardex > 128.0) {
          // Something has gone wrong; this is not an ascii point.
          // Pink question mark.
          fill = vec4(0.9, 0.1, 0.1, 0.5);
          chardex = 63.0;
        }
        letter_pos = vec2(fract(chardex / 16.0), floor((chardex - 16.0) / 16.0)/16.0);
        } else if (u_string_index > 0.0) {
          gl_Position = discard_me;
          return;
        }
      }
    }
  }
  `

export let frag_shader = `
precision mediump float;

varying vec4 fill;
varying vec2 letter_pos;
varying float text_mode;

uniform sampler2D u_charmap;

void main() {
  if (text_mode < 0.0 ) {
    // Drop parts of the rectangle outside the unit circle.
    // I took this from observable.
    vec2 cxy = 2.0 * gl_PointCoord - 1.0;
    float r = dot(cxy, cxy);
    if (r > 1.0) discard;
//    if (r < 0.5) discard;

    gl_FragColor = fill;
  } else {
    // Letters rarely go all the way wide.
    if (gl_PointCoord.x > 0.65) discard;
    vec2 coords = letter_pos + gl_PointCoord/16.0;
    vec4 letter = texture2D(u_charmap, coords);
    if (letter.a <= 0.03) discard;
    gl_FragColor = mix(fill, vec4(0.25, 0.1, 0.2, 1.0), 1.0 - letter.a);
  }
}
`
