// This is technically javascript, but I use the glsl suffix
// just for syntax coloring.

let log_spiral_function = `
vec4 logarithmic_spiral_jitter(
  in float ix, // a random seed.
  in float a, // offset
  in float angle_parameter, // angle parameter
  in float randomize_angle, // sd radians
  in float max_r, // Maximum radius of spiral.
  in float randomize_rotation_max_radians, // in standard deviations to the log-multiplier.
  in float randomize_radius, // in standard deviation percentage points.
  in float hole, // donut hole size.
  in float speed, // webgl units per second.
  in float time,// The time, in seconds, to plot at. Generally passed as a uniform or something.
  in float acceleration,
  in float n_spirals
  ) {
  // Note that you must have 'tau' and 'box_muller' and 'ix_to_random'
  // defined above

  // Get two randoms for the price of one.
  vec2 two_gaussians = box_muller(ix, 55.1);

  //Randomly swing the angle, and figure out the implicit k parameter
  highp float calculated_angle = angle_parameter + two_gaussians.x * randomize_angle;
  highp float k = 1. / tan(calculated_angle);

  // The length of the segment to be traversed. I think.
  float arc_length =  sqrt((1. + k*k)/k) * (max_r - a);
  // How long does a circuit take? Add some random noise.
  float period = arc_length / speed;
  float time_period = period * exp(two_gaussians.y / 6.);

  // Every point needs to start at a different place along the circuit.
  float stagger_time = ix_to_random(ix, 3.);

  // Adjust u_time from the clock to our current spot.
  float varying_time = u_time + stagger_time * time_period;

  // Adjust that time by raising to a power to set the speed along the curve.
  // Not sure if this is the soundest way to parametrize.
  float relative_time = pow(1. - mod(varying_time, time_period)/time_period, acceleration);

  // Calculate the radius at this time point.
  float radius = max_r * relative_time + a;

  // The angle implied by that radius.
  float theta  = 1./k * log(radius / a);

  /* A different way to calculate radius from the theta. Not used
  float max_theta = 1. / k * log(max_r / a);
  float theta2 = max_theta * relative_time;
  vec2 pos_theta_style = vec2(a * exp(k * theta2), theta2);
  radius = pos_theta_style.x;
  theta = pos_theta_style.y;
  */

  // If multiple spirals, the theta needs to be rotated for which spiral we're in.
  // Choose it based on a new random seed.
  float which_spiral = floor(ix_to_random(ix, 13.13) * n_spirals);
  float which_spiral_adjust = which_spiral / n_spirals * tau;
  theta = theta + which_spiral_adjust;

  // Add some gaussian jitter to the polar coordinates.
  vec2 polar_jitter = box_muller(ix, 24.);

  highp float radius_adjust = 1. + polar_jitter.x * randomize_radius;
  highp float theta_adjust = polar_jitter.y * randomize_rotation_max_radians;

  // into euclidean space.
  vec3 pos_spiral = vec3(
   cos(theta + theta_adjust)*(radius * radius_adjust + hole),
   sin(theta + theta_adjust)*(radius * radius_adjust + hole),
   0.
  );

  mat3 adjust_to_viewport =
         mat3(
            1./u_aspect_ratio, 0., 0.,
            0., 1., 0.,
            0., 0., 1.);

  return vec4(pos_spiral * adjust_to_viewport, 1.);
}`

export let vertex_shader = `
precision mediump float;

attribute float ix;
attribute vec2 position;
attribute float a_color;
attribute float a_size;
attribute float a_time;
attribute float a_opacity;
attribute float a_jitter_radius;
attribute float a_jitter_period;
attribute float a_visibility;
attribute float a_alpha;

attribute vec2 a_image_locations;

uniform vec2 u_color_domain;
uniform vec2 u_size_domain;
uniform vec2 u_time_domain;
uniform vec2 u_jitter_radius_domain;
uniform vec2 u_jitter_period_domain;
uniform vec2 u_alpha_domain;

uniform float u_aspect_ratio;
uniform float u_jitter;

// Transform from data space to the open window.
uniform mat3 u_window_scale;
// Transform from the open window to the d3-zoom.
uniform mat3 u_zoom;
// Transform from the canvas coordinates to the
// webgl ones.
uniform mat3 u_untransform;
uniform float u_size; // Base point size
uniform float u_maxix; // The maximum index to plot.
uniform float u_time; // The current time.
uniform float u_transition_time; // Between 0 and 1, location in a transition;
uniform float u_k; // The d3-scale factor.
uniform float u_render_text_min_ix; // The minimum index to attempt text regl_rendering.


// Usually 'viridis'.
uniform sampler2D u_colormap;
uniform sampler2D u_previous_colormap;
uniform sampler2D u_alphamap;

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



float linstep (in vec2 range, in float x) {
  return clamp((x - range.x) / (range.y - range.x), 0.0, 1.0);
}

float rescale(in vec2 rangeFrom, in vec2 rangeTo, in float x) {
  return mix(rangeTo.x, rangeTo.y,
  linstep(rangeFrom, x));
}

vec4 scaleLinear(in float x) {
  float fractional = linstep(u_color_domain, x);
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

vec2 box_muller(in float ix, in float seed) {
  // Box-Muller transform gives you two gaussian randoms for two uniforms.
  highp float U = ix_to_random(ix, seed);
  highp float V = ix_to_random(ix, seed + 17.123123);
  return vec2(
    sqrt(-2.*log(U))*cos(tau*V),
    sqrt(-2.*log(U))*sin(tau*V)
  );
}

vec2 unpack2(in float number, in float mod_n) {
  float a = mod(number, mod_n);
  return vec2((number - a) / mod_n, a);
}

vec4 circle_jitter(
  in float ix,
  in float aspect_ratio,
  in float time
) {
  vec2 two_gaussians = box_muller(ix, 12.);

  float stagger_time = two_gaussians.y * tau;
  if (stagger_time > 0.75) {
    stagger_time = stagger_time + tau/2.;
  }

  float period = 6.;
  // How long does a circuit take?
  float time_period = period * exp(two_gaussians.x / 6.);

  // Adjust time from the clock to our current spot.
  float varying_time = time + stagger_time * time_period;
  // Where are we from 0 to 1 relative to the time period

  float relative_time =
     1. - mod(varying_time, time_period)/time_period;

  float theta = relative_time * tau;

  float r_mult = 0. + 0.4 * (sqrt(ix_to_random(ix, 7.)));
  return vec4(cos(theta) * r_mult, aspect_ratio * sin(theta) *
    r_mult, 0., 1.) * 0.05;

}

${log_spiral_function}

void main() {

if (a_visibility < 0.05) {
  gl_Position = discard_me;
  return;
}
if (ix > u_maxix) {
    // throwaway points that are too low.
    gl_Position = discard_me;
    return;
}

float alpha = texture2D(
  u_alphamap,
  vec2(0., linstep(u_alpha_domain, a_alpha))).a;

if (alpha < 0.05) {
  gl_Position = discard_me;
  return;
}


else {
  float depth_size_adjust = (1.0 - ix / (u_maxix));
  float point_size_adjust = exp(log(u_k)*0.5);
  gl_PointSize = u_size * point_size_adjust * depth_size_adjust;// * time_adjust;// * step(0.0, time_adjust) * time_adjust;// * depth_size_adjust;//
  gl_PointSize = min(gl_PointSize, 32.);
  if (gl_PointSize <= 0.00001) {
    return;
  } else {
  // First apply the d3 zoom transform; perform the uniform translations;

    vec3 pos2d = vec3(position.x, position.y, 1.0) * from_coord_to_gl;
    /*
    in float a, // Log parameter
    in float k, // other parameter
    in float max_r, // Number of turns of spiral to do.
    in float randomize_rotation_max_radians,
    in float randomize_shear,
    in float hole,
    in float period,
    in float time
    */

    if (u_jitter < 0.5) {
      gl_Position = vec4(pos2d, 1.);
    } else {
      vec4 jitter;
      if (u_jitter < 1.5) {
      float jitter_circle_r = sqrt(rescale(
        u_jitter_radius_domain,
        vec2(0.1, 1.),
        a_jitter_radius));

      float jitter_period = rescale(
        u_jitter_period_domain,
        vec2(0.002, 0.2),
        a_jitter_period);

          jitter = logarithmic_spiral_jitter(
            ix,
            0.01 * jitter_circle_r, // a
            tau/4. - 0.1, // angle
            0.004, //angle jitter
            0.1 * jitter_circle_r, //radius
            0.1, //random_1
            0.05, //random radius
            0.003, //donut.
            .5 * jitter_period * jitter_circle_r, //period
            u_time,
            1.4, //acceleration
            1.5); // spirals
        } else if (u_jitter < 2.5) { // "uniform"
          jitter = vec4(ix_to_random(ix, 1.) * .005, ix_to_random(ix, 2.) * .005, 0., 0.);
        } else if (u_jitter < 3.5) { // "normal"
          jitter = vec4(box_muller(ix, 1.) * 0.01, 0., 0.);
        } else if (u_jitter < 4.5) { // "circle"
          jitter = circle_jitter(ix, u_aspect_ratio, u_time);
        }
        gl_Position = vec4(pos2d + jitter.xyz * point_size_adjust, 1.);
      }

    fill = scaleLinear(a_color);
    pic_mode = u_render_text_min_ix - ix;
    if (pic_mode > 0.0) {

        gl_PointSize = min(gl_PointSize * 4.0, 28.*2.0);

        // unpack the coordinates.
        vec2 img_location = unpack2(a_image_locations.x, 4096.);
        vec2 img_dimension = unpack2(a_image_locations.y, 4096.);

        letter_pos = img_location/4096.;
//        letter_pos = vec2(ix_to_random(ix, 2.), ix_to_random(ix, 3.));
    }
  }}}
  `

export let frag_shader = `
precision mediump float;

varying float pic_mode;
varying vec4 fill;
varying vec4 stroke;
varying vec2 letter_pos;

uniform sampler2D u_sprites;

void main() {
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
    gl_FragColor = fill;
  } else {
    vec2 coords = letter_pos + gl_PointCoord/4096.*28.;
    vec4 letter = texture2D(u_sprites, coords);
    if (letter.a <= 0.03) discard;
    gl_FragColor = mix(fill, vec4(0.25, 0.1, 0.2, 1.0), 1.0 - letter.a);
    // gl_FragColor = vec4(fill.xyz, letter.a);
  }
}
`
