precision mediump float;


attribute vec2 a_image_locations;

uniform float u_zoom_balance;

uniform float u_update_time;
uniform float u_transition_duration;

uniform float u_jitter_radius;
uniform float u_jitter;
// Whether to plot only a single category.
uniform float u_only_color;
uniform float u_colors_as_grid;

// Transform from data space to the open window.
uniform mat3 u_window_scale;
uniform mat3 u_last_window_scale;
// Transform from the open window to the d3-zoom.
uniform mat3 u_zoom;

uniform float u_width;
uniform float u_height;

uniform float u_maxix;           // The maximum index to plot.
uniform float u_time;            // The current time.
uniform float u_k;               // The d3-scale factor.
uniform float u_color_picker_mode;

// The same set of items for a variety of aesthetics.

attribute float ix;

attribute float a_x;
attribute float a_last_x;
uniform float u_x_transform;
uniform float u_last_x_transform;
uniform vec2 u_x_domain;
uniform vec2 u_last_x_domain;
uniform sampler2D u_x_map;
uniform sampler2D u_last_x_map;


attribute float a_y;
attribute float a_last_y;
uniform float u_y_transform;
uniform float u_last_y_transform;
uniform vec2 u_y_domain;
uniform vec2 u_last_y_domain;
uniform sampler2D u_y_map;
uniform sampler2D u_last_y_map;


attribute float a_color;
attribute float a_last_color;
uniform float u_color_transform;
uniform float u_last_color_transform;
uniform vec2 u_color_domain;
uniform vec2 u_last_color_domain;
uniform sampler2D u_color_map;
uniform sampler2D u_last_color_map;


attribute float a_jitter_radius;
attribute float a_last_jitter_radius;
uniform float u_jitter_radius_transform;
uniform float u_last_jitter_radius_transform;
uniform vec2 u_jitter_radius_domain;
uniform vec2 u_last_jitter_radius_domain;
uniform sampler2D u_jitter_radius_map;
uniform sampler2D u_last_jitter_radius_map;


attribute float a_size;
attribute float a_last_size;
uniform float u_size_transform;
uniform float u_last_size_transform;
uniform vec2 u_size_domain;
uniform vec2 u_last_size_domain;
uniform sampler2D u_size_map;
uniform sampler2D u_last_size_map;


attribute float a_alpha;
attribute float a_last_alpha;
uniform float u_alpha_transform;
uniform float u_last_alpha_transform;
uniform vec2 u_alpha_domain;
uniform vec2 u_last_alpha_domain;
uniform sampler2D u_alpha_map;
uniform sampler2D u_last_alpha_map;


attribute float a_jitter_speed;
uniform float u_jitter_speed_transform;
uniform vec2 u_jitter_speed_domain;
uniform sampler2D u_jitter_speed_map;


attribute float a_filter;
attribute float a_last_filter;
// useless.
uniform float u_filter_transform;
uniform float u_last_filter_transform;
uniform vec2 u_filter_domain;
uniform vec2 u_last_filter_domain;
uniform sampler2D u_last_filter_map;
uniform sampler2D u_filter_map;


// The fill color.
varying vec4 fill;
// Are we drawing letters, text, or images?
varying float pic_mode;
// What are the coordinates of the letter
// we're drawing on the spritesheet
varying vec2 letter_pos;

float point_size_adjust;

// A coordinate to throw away a vertex point.
vec4 discard_me = vec4(100.0, 100.0, 1.0, 1.0);

// Initialized in the main loop
// mat3 from_coord_to_gl;

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



float interpolate_raw(in float x, in float min, in float max) {
  if (x < min) {return 0.;}
  if (x > max) {return 1.;}
  return (x - min)/(max - min);
}

float interpolate(in float x, in float min, in float max) {
  if (max < min) {
    return 1. - interpolate_raw(x, max, min);
  } else {
    return interpolate_raw(x, min, max);
  }
}

float linstep(in vec2 range, in float x) {
  return interpolate(x, range.x, range.y);
  float scale_size = range.y - range.x;
  float from_left = x - range.x;
  return clamp(from_left / scale_size, 0.0, 1.0);
}

float linscale(in vec2 range, in float x) {
  float scale_size = range.y - range.x;
  float from_left = x - range.x;
  return from_left / scale_size;
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

/*************** END COLOR SCALES *******************************/



float domainify(in vec2 domain, in float transform, in float attr, in bool clamped) {

  // Clamp an attribute into a domain, with an option log or sqrt transform.
  if (transform == 2.) {
    domain = sqrt(domain);
    attr = sqrt(attr);
  }
  if (transform == 3.) {
    domain = log(domain);
    attr = log(attr);
  }
  if (clamped) {
    return linstep(domain, attr);
  } else {
    return linscale(domain, attr);
  }
}

mat3 pixelspace_to_glspace;

vec2 calculate_position(in vec2 position, in float x_scale_type,
                        in vec2 x_domain, in float y_scale_type,
                        in vec2 y_domain, in mat3 window_scale,
                        in mat3 zoom
                        ) {

    vec3 pos2d = vec3(position, 1.0) * window_scale * zoom;

    if (x_scale_type <= 4. && y_scale_type <= 4.) {
      pos2d = pos2d * pixelspace_to_glspace;
    }
    return pos2d.xy;
}

float cubicInOut(float t) {
  return t < 0.5
    ? 4.0 * t * t * t
    : 1. - 4.0 * pow(1. - t, 3.0);
}


#pragma glslify: logarithmic_spiral_jitter = require('./log_spiral_jitter.vert')
#pragma glslify: packFloat = require('glsl-read-float')
#pragma glslify: easeCubic = require(glsl-easings/sine-in-out)

const vec4 decoder = vec4(-1., 1. / 256. / 256., 1. / 256., 1.);

float RGBAtoFloat(in vec4 floater) {
  // Scale values up by 256.
  return 256. * dot(floater, decoder);
}

vec4 ixToRGBA(in float ix)  {
  float min = fract(ix / 256.);
  float mid = fract((ix - min) / 256.);
  float high = fract((ix - min - mid * 256.) / (256.) / 256.);
  return vec4(min, mid, high, 1.);
}

float texture_float_lookup(in sampler2D texture, in vec2 domain,
                           in float transform, in float attr) {
  float inrange = domainify(domain, transform, attr, true);
  vec4 encoded = texture2D(texture, vec2(0.5, inrange));
  return RGBAtoFloat(encoded);
}

vec2 unpack2(in float number, in float mod_n) {
  float a = mod(number, mod_n);
  return vec2((number - a) / mod_n, a);
}

vec2 circle_jitter(in float ix, in float aspect_ratio, in float time,
                   in float radius, in float speed) {
  vec2 two_gaussians = box_muller(ix, 12.);

  float stagger_time = two_gaussians.y * tau;

  // How long does a circuit take?

  float units_per_period = radius * radius * tau / 2.;
  float units_per_second = speed / 100.;
  float seconds_per_period = units_per_period / units_per_second;
  float time_period = seconds_per_period;
  if (time_period > 1e4) {
    return vec2(0., 0.);
  }

  // Adjust time from the clock to our current spot.
  float varying_time = time + stagger_time * time_period;
  // Where are we from 0 to 1 relative to the time period

  float relative_time = 1. - mod(varying_time, time_period) / time_period;

  float theta = relative_time * tau;

  float r_mult = (sqrt(ix_to_random(ix, 7.)));
  return vec2(cos(theta) * r_mult, aspect_ratio * sin(theta) * r_mult) *
         radius;
}

vec2 calculate_jitter(
  in float jitter_type,
  in float ix, // distinguishing index
  in sampler2D jitter_radius_map, in vec2 jitter_radius_domain, in float jitter_radius_transform,
  in float jitter_radius,
  in sampler2D jitter_speed_map, in vec2 jitter_speed_domain, in float jitter_speed_transform, in float jitter_speed

) {
  if (jitter_type == 0.) {
    // No jitter
    return vec2(0., 0.);
  }

  float jitter_r = texture_float_lookup(jitter_radius_map, jitter_radius_domain,
                                        jitter_radius_transform, jitter_radius);
  if (jitter_type == 3.) {
    // normally distributed on x and y.
    return jitter_r * box_muller(ix, 1.);
  }
  if (jitter_type == 2.) {
    float theta = ix_to_random(ix, 15.) * tau;
    // Rescale.
    float r = jitter_r * sqrt(ix_to_random(ix, 145.));
    return vec2(cos(theta) * r, sin(theta)*r);
  }
  /* Jittering that includes motion) */

  float p_jitter_speed =
      texture_float_lookup(jitter_speed_map, jitter_speed_domain,
                          jitter_speed_transform, jitter_speed);

  if (jitter_type == 1.) {
    return logarithmic_spiral_jitter(
                ix,
                0.005 * jitter_r,                     // a
                1.3302036,                       // angle parameter
                0.005,                                 // angle random
                jitter_r,                             // max radius
                0.03,                                 // random_rotation
                0.06,                                 // random radius
                0.003 * point_size_adjust * jitter_r, // donut.
                .5 * p_jitter_speed * jitter_r / point_size_adjust, // speed
                u_time,                                           // time
                0.8,                                              // acceleration
                2.0,                                              // n_spirals
                .09, //shear
                u_width/u_height         // shear
            );
  }

  if (jitter_type == 4.) {
    // circle
    return circle_jitter(ix, u_width/u_height, u_time, jitter_r, p_jitter_speed);
  }
}


void main() {
  pixelspace_to_glspace = mat3(
      2. / u_width, 0., -1.,
      0., - 2. / u_height, 1.,
      0., 0., 1.
  );
  float interpolation =
    interpolate(u_update_time, 0., u_transition_duration);
  float ease = interpolation;
//  float ease = easeCubic(interpolation);
//  from_coord_to_gl = u_window_scale * u_zoom * pixelspace_to_glspace;

  float debug_mode = 0.;

  if (ix > u_maxix) {
    // throwaway points that are too low.
    gl_Position = discard_me;
    return;
  }

  vec2 position = vec2(a_x, a_y);
  vec2 old_position = vec2(a_last_x, a_last_y);

  position = calculate_position(position, u_x_transform, u_x_domain,
    u_y_transform, u_y_domain, u_window_scale, u_zoom);

  old_position = calculate_position(old_position, u_last_x_transform, u_last_x_domain,
      u_last_y_transform, u_last_y_domain, u_last_window_scale, u_zoom);

  float xpos = clamp((1. + position.x) / 2., 0., 1.);
  float randy = ix_to_random(ix, 13.76);
  float delay = xpos + randy * .1;
  delay = delay * 3.;
  // delay = 0.;
  float frac = interpolate(
    u_update_time,
    delay,
    u_transition_duration + delay
  );

  frac = easeCubic(frac);

  if (frac <= 0.) {
    position = old_position;
  } else if (frac < 1.) {
    // position = mix(old_position, position, u_interpolation);

    vec2 midpoint = box_muller(ix, 3.) * .05 *
       dot(old_position - position, old_position - position)
       + old_position / 2. + position / 2.;

    position = mix(
      mix(old_position, midpoint, frac),
      mix(midpoint, position, frac),
      frac);
    //position = mix(old_position, position, frac);
  } // else position just is what it is.

  if (u_colors_as_grid > 0.) {
    vec2 jitterspec = vec2(
      ix_to_random(ix, 3.),
      ix_to_random(ix, 1.)
    );
    position =
      vec2(
        floor(a_color / 4096. * 64.)/64.,
        //floor(a_color/1024.*32.)/32.,
        mod(a_color, 64.)/64.
      ) + jitterspec / 64.;
  //  position = jitterspec;
    position = position * 2. - 1.;
  }
  float r = ix_to_random(ix, 4.);
  //position = vec2(2. * frac - 1., position.y);

  if (debug_mode > 0.) {
    // Just plot every point.
    gl_PointSize = 1.;
    fill = vec4(1., 1., 1., 1.);
    gl_Position = vec4(position, 1., 1.);
    return;
  }


  float my_filter = texture_float_lookup(u_filter_map, u_filter_domain,
                                      u_filter_transform, a_filter);

  float last_filter = texture_float_lookup(u_last_filter_map, u_last_filter_domain,
                                      u_last_filter_transform, a_last_filter);

  if (ix_to_random(ix, 13.5) > ease) {
    my_filter = last_filter;
  }

  if (my_filter < 0.5) {
    gl_Position = discard_me;
    return;
  }

  //////////////// ALPHA /////////////////////////
  float alpha = texture_float_lookup(u_alpha_map, u_alpha_domain,
                                     u_alpha_transform, a_alpha);
  float last_alpha = texture_float_lookup(u_last_alpha_map, u_last_alpha_domain,
                                     u_last_alpha_transform, a_last_alpha);
  alpha = mix(last_alpha, alpha, ease);

  if (alpha < 1. / 255.) {
    gl_Position = discard_me;
    return;
  }


  float size_multiplier = texture_float_lookup(u_size_map, u_size_domain,
                                             u_size_transform, a_size);

  float last_size_multiplier = texture_float_lookup(u_last_size_map, u_last_size_domain,
                                              u_last_size_transform, a_last_size);

  size_multiplier = mix(last_size_multiplier, size_multiplier, ease);

  float depth_size_adjust = (1.0 - ix / (u_maxix));

  point_size_adjust = exp(log(u_k) * u_zoom_balance);

  gl_PointSize = point_size_adjust * size_multiplier;


  /* JITTER */
  vec2 jitter = calculate_jitter(
    u_jitter, ix, u_jitter_radius_map, u_jitter_radius_domain,u_jitter_radius_transform,
    a_jitter_radius,
    u_jitter_speed_map, u_jitter_speed_domain, u_jitter_speed_transform, a_jitter_speed
  );

  vec2 last_jitter = calculate_jitter(
    u_jitter, ix, u_last_jitter_radius_map, u_last_jitter_radius_domain,u_last_jitter_radius_transform,
    a_last_jitter_radius,
    u_jitter_speed_map, u_jitter_speed_domain, u_jitter_speed_transform, a_jitter_speed
  );

  if (ease < 1.) {
    jitter = mix(last_jitter, jitter, ease);
  }
  gl_Position = vec4(position + jitter * point_size_adjust, 0., 1.);

  // Plot a single tick of alpha.
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
    fill = packFloat(ix);
  } else {
    float fractional_color = linstep(u_color_domain, a_color);
    // fractional_color = 0.;
    fill = texture2D(u_color_map, vec2(0., fractional_color));
    fill = vec4(fill.rgb, alpha);


    /*if (ease < ix_to_random(ix, 3.)) {
      float last_fractional = linstep(u_last_color_domain, a_last_color);
      vec4 last_fill = texture2D(u_last_color_map, vec2(0., last_fractional));

      // Alpha channel interpolation already happened.
      fill = vec4(last_fill.rgb, alpha);

    }*/
    if (ease < 1.) {
      float last_fractional = linstep(u_last_color_domain, a_last_color);
      vec4 last_fill = texture2D(u_last_color_map, vec2(0., last_fractional));

      // Alpha channel interpolation already happened.
      last_fill = vec4(last_fill.rgb, alpha);

      // RGB blending is bad--maybe use https://www.shadertoy.com/view/lsdGzN
      // instead?
      fill = mix(last_fill, fill, ease);
  }

  }

}
