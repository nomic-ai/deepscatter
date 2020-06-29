
precision mediump float;

#pragma glslify: logarithmic_spiral_jitter = require('./log_spiral_jitter.glsl')

attribute vec2 a_image_locations;

uniform float u_zoom_balance;

uniform float u_jitter_radius;
uniform float u_aspect_ratio;
uniform float u_jitter;
// Whether to plot only a single category.
uniform float u_only_color;

// Transform from data space to the open window.
uniform mat3 u_window_scale;
// Transform from the open window to the d3-zoom.
uniform mat3 u_zoom;
// Transform from the canvas coordinates to the
// webgl ones.
uniform mat3 u_untransform;
uniform float u_maxix;           // The maximum index to plot.
uniform float u_time;            // The current time.
uniform float u_transition_time; // Between 0 and 1, location in a transition;
uniform float u_k;               // The d3-scale factor.
uniform float u_color_picker_mode;



// The same set of items for a variety of aesthetics.

attribute float ix;
attribute vec2 position;


attribute float a_color;
uniform float u_color_transform;
uniform vec2 u_color_domain;
uniform sampler2D u_color_map;
uniform sampler2D u_color_previous_map;

attribute float a_jitter_radius;
uniform float u_jitter_radius_transform;
uniform vec2 u_jitter_radius_domain;
uniform sampler2D u_jitter_radius_map;
uniform sampler2D u_jitter_radius_previous_map;

attribute float a_size;
uniform float u_size_transform;
uniform vec2 u_size_domain;
uniform sampler2D u_size_map;
uniform sampler2D u_size_previous_map;

attribute float a_alpha;
uniform float u_alpha_transform;
uniform vec2 u_alpha_domain;
uniform sampler2D u_alpha_map;
uniform sampler2D u_alpha_previous_map;

attribute float a_jitter_speed;
uniform float u_jitter_speed_transform;
uniform vec2 u_jitter_speed_domain;
uniform sampler2D u_jitter_speed_map;
uniform sampler2D u_jitter_speed_previous_map;

attribute float a_filter;
uniform float u_filter_transform;
uniform vec2 u_filter_domain;
uniform sampler2D u_filter_map;
uniform sampler2D u_filter_previous_map;

// The fill color.
varying vec4 fill;
// Are we drawing letters, text, or images?
varying float pic_mode;
// What are the coordinates of the letter
// we're drawing on the spritesheet
varying vec2 letter_pos;

// A coordinate to throw away a vertex point.
vec4 discard_me = vec4(100.0, 100.0, 1.0, 1.0);

mat3 from_coord_to_gl = u_window_scale * u_zoom * u_untransform;

const float e = 1.618282;
// I've been convinced.
const float tau = 2. * 3.14159265359;

/*************** COLOR SCALES *******************************/

// Ha! A gazillion version of this function:
// https://gist.github.com/kylemcdonald/f8df3bc2f8d38ca2b7cb
vec3 hsv2rgb(in vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0,
                   0.0, 1.0);
  rgb = rgb * rgb * (3.0 - 2.0 * rgb);
  return c.z * mix(vec3(1.0), rgb, c.y);
}

float linstep(in vec2 range, in float x) {
  float scale_size = range.y - range.x;
  float from_left = x - range.x;
  return clamp(from_left / scale_size, 0.0, 1.0);
}

/*************** END COLOR SCALES *******************************/

vec4 decoder = vec4(-1., 1. / 256. / 256., 1. / 256., 1.);

float RGBAtoFloat(in vec4 floater) {
  // Scale values up by 256.
  return 256. * dot(floater, decoder);
}

float texture_float_lookup(in sampler2D texture, in vec2 domain,
                           in float transform, in float attr) {
  if (transform == 2.) {
    domain = sqrt(domain);
    attr = sqrt(attr);
  }
  if (transform == 3.) {
    domain = log(domain);
    attr = log(attr);
  }
  float inrange = linstep(domain, attr);
  vec4 encoded = texture2D(texture, vec2(0.5, inrange));
  return RGBAtoFloat(encoded);
}

highp float ix_to_random(in float ix, in float seed) {
  // For high numbers, taking the log avoids coincidence.
  highp float seed2 = log(ix) + 1.;
  vec2 co = vec2(seed2, seed);
  highp float a = 12.9898;
  highp float b = 78.233;
  highp float c = 43758.5453;
  highp float dt = dot(co.xy, vec2(a, b));
  highp float sn = mod(dt, 3.14);
  return fract(sin(sn) * c);
}

vec2 box_muller(in float ix, in float seed) {
  // Box-Muller transform gives you two gaussian randoms for two uniforms.
  highp float U = ix_to_random(ix, seed);
  highp float V = ix_to_random(ix, seed + 17.123123);
  return vec2(sqrt(-2. * log(U)) * cos(tau * V),
              sqrt(-2. * log(U)) * sin(tau * V));
}

vec2 unpack2(in float number, in float mod_n) {
  float a = mod(number, mod_n);
  return vec2((number - a) / mod_n, a);
}

vec4 circle_jitter(in float ix, in float aspect_ratio, in float time,
                   in float radius, in float speed) {
  vec2 two_gaussians = box_muller(ix, 12.);

  float stagger_time = two_gaussians.y * tau;

  // How long does a circuit take?

  float units_per_period = radius * radius * tau / 2.;
  float units_per_second = speed / 100.;
  float seconds_per_period = units_per_period / units_per_second;
  float time_period = seconds_per_period;
  if (time_period > 1e4) {
    return vec4(0., 0., 0., 0.);
  }

  // Adjust time from the clock to our current spot.
  float varying_time = time + stagger_time * time_period;
  // Where are we from 0 to 1 relative to the time period

  float relative_time = 1. - mod(varying_time, time_period) / time_period;

  float theta = relative_time * tau;

  float r_mult = (sqrt(ix_to_random(ix, 7.)));
  return vec4(cos(theta) * r_mult, aspect_ratio * sin(theta) * r_mult, 0., 1.) *
         radius;
}


void main() {

  float debug_mode = 0.;

  if (debug_mode > 0.) {
    // Just plot every point.
    gl_PointSize = 3.;
    fill = vec4(1., 1., 1., 1.);
    vec3 pos2d = vec3(position.x, position.y, 1.0) * from_coord_to_gl;
    gl_Position = vec4(pos2d, 1.);
    return;
  }

  if (ix > u_maxix) {
    // throwaway points that are too low.
    gl_Position = discard_me;
    return;
  }

  float filter = texture_float_lookup(u_filter_map, u_filter_domain,
                                      u_filter_transform, a_filter);

  if (filter < .5) {
    gl_Position = discard_me;
    return;
  }

  float alpha = texture_float_lookup(u_alpha_map, u_alpha_domain,
                                     u_alpha_transform, a_alpha);

  if (alpha < 1. / 255.) {
    gl_Position = discard_me;
    return;
  } else {
    float size_multiplier = texture_float_lookup(u_size_map, u_size_domain,
                                                 u_size_transform, a_size);
    float depth_size_adjust = (1.0 - ix / (u_maxix));
    float point_size_adjust = exp(log(u_k) * u_zoom_balance);

    gl_PointSize = point_size_adjust * size_multiplier;

    if (u_jitter > 0.) {
      vec2 two_randoms = box_muller(ix, 22.0);
      float period = 10.0 * exp(two_randoms.y);
      float one_random = ix_to_random(ix, 33.0) * tau;
      float size_adjust =
          sin((one_random + u_time) / period); // * exp(two_randoms.x);
      size_adjust = min(size_adjust, 1.3);
    }
    if (gl_PointSize <= 0.00001) {
      return;
    } else {
      // First apply the d3 zoom transform; perform the uniform translations;

      vec3 pos2d = vec3(position.x, position.y, 1.0) * from_coord_to_gl;

      if (u_jitter < 0.5) {
        gl_Position = vec4(pos2d, 1.);
      } else {
        vec4 jitter;

        float jitter_r =
            texture_float_lookup(u_jitter_radius_map, u_jitter_radius_domain,
                                 u_jitter_radius_transform, a_jitter_radius);

        if (u_jitter < 1.5) {
          float jitter_speed =
              texture_float_lookup(u_jitter_speed_map, u_jitter_speed_domain,
                                   u_jitter_speed_transform, a_jitter_speed);

          jitter = logarithmic_spiral_jitter(
              ix,
              0.005 * jitter_r,                     // a
              1.3302036,                       // angle parameter
              0.005,                                 // angle random
              jitter_r,                             // max radius
              0.03,                                 // random_rotation
              0.06,                                 // random radius
              0.003 * point_size_adjust * jitter_r, // donut.
              .5 * jitter_speed * jitter_r / point_size_adjust, // speed
              u_time,                                           // time
              0.8,                                              // acceleration
              2.0,                                              // n_spirals
              .09, //shear
              u_aspect_ratio         // shear
          );
        } else if (u_jitter < 2.5) { // "uniform"
          jitter = jitter_r *
                   vec4(ix_to_random(ix, 1.), ix_to_random(ix, 2.), 0., 0.);
        } else if (u_jitter < 3.5) { // "normal"
          jitter = jitter_r * vec4(box_muller(ix, 1.), 0., 0.);
        } else if (u_jitter < 4.5) { // "circle"
          float jitter_speed =
              texture_float_lookup(u_jitter_speed_map, u_jitter_speed_domain,
                                   u_jitter_speed_transform, a_jitter_speed);
          jitter =
              circle_jitter(ix, u_aspect_ratio, u_time, jitter_r, jitter_speed);
        }
        gl_Position = vec4(pos2d + jitter.xyz * point_size_adjust, 1.);
      }

      if (u_only_color >= -1.5) {

        if (u_only_color > -.5 && a_color != u_only_color) {
          gl_Position = discard_me;
          return;
        } else {
          // -1 is a special value meaning 'plot everything'.
          fill = vec4(0., 0., 0., 1. / 255.);
          gl_PointSize = 1.;
        }
      } else if (u_color_picker_mode > 0.) {
        fill = vec4(fract(ix / 255.), fract(floor(ix / 255.) / 255.),
                    fract(floor(ix / 255. / 255.) / 255.), 1.);
      } else {
        float fractional_color = linstep(u_color_domain, a_color);
        // fractional_color = 0.;
        fill = texture2D(u_color_map, vec2(0., fractional_color));
        fill = vec4(fill.rgb, alpha);
      }
      pic_mode = 0.;

      if (pic_mode > 0.0) {

        gl_PointSize = min(gl_PointSize * 4.0, 28. * 2.0);

        // unpack the coordinates.
        vec2 img_location = unpack2(a_image_locations.x, 4096.);
        vec2 img_dimension = unpack2(a_image_locations.y, 4096.);

        letter_pos = img_location / 4096.;
        //        letter_pos = vec2(ix_to_random(ix, 2.), ix_to_random(ix, 3.));
      }
    }
  }


}
