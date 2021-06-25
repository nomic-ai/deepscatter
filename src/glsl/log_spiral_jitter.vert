
const float tau = 2. * 3.14159265359;

highp float ix_to_random(in float ix, in float seed) {
  // For high numbers, taking the log avoids coincidence.
  highp float seed2 = log(ix) + 1.;
  vec2 co = vec2(seed2, seed);
  highp float a = 12.9898;
  highp float b = 78.233;
  highp float c = 43758.5453;
  highp float dt= dot(co.xy ,vec2(a,b));
  highp float sn= mod(dt,3.14);
  return fract(sin(sn) * c);
}

highp vec2 box_muller(in float ix, in float seed) {
  // Box-Muller transform gives you two gaussian randoms for two uniforms.
  highp float U = ix_to_random(ix, seed);
  highp float V = ix_to_random(ix, seed + 17.123123);
  return vec2(
    sqrt(-2.*log(U))*cos(tau*V),
    sqrt(-2.*log(U))*sin(tau*V)
  );
}

vec2 logarithmic_spiral_jitter(
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
  in float n_spirals,
  in float shear,
  in float aspect_ratio
  ) {
  // Each point starts at a different place on the spiral.
  vec2 two_gaussians = box_muller(ix, 55.1);

  highp float calculated_angle = angle_parameter + two_gaussians.x * randomize_angle;
  float k = 1. / tan(calculated_angle);
  if (k > 100000.) {
    k = 0.;
  }

  // The length of the segment to be traversed.
  float arc_length =  sqrt((1. + k*k)/k) * (max_r - a);
  float period = arc_length / speed;

  // Every point needs to start at a different place along the curve.
  float stagger_time = ix_to_random(ix, 3.);

  // How long does a circuit take? Add some random noise.
  float time_period = period * exp(box_muller(ix, 0.031).x / 6.);

  // Adjust u_time from the clock to our current spot.
  float varying_time = time + stagger_time * time_period;

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

  vec2 shear_adjust = box_muller(ix, 59.1) * shear;

  mat3 shear_mat = mat3(
    1., shear_adjust.x, 0.,
    shear_adjust.y, 1., 0.,
    0., 0., 1.);
  // into euclidean space.
  vec3 pos_spiral = vec3(
   cos(theta + theta_adjust)*(radius * radius_adjust + hole),
   sin(theta + theta_adjust)*(radius * radius_adjust + hole),
   0.
  );
  mat3 adjust_to_viewport =
         mat3(
            1./aspect_ratio, 0., 0.,
            0., 1., 0.,
            0., 0., 1.);

  pos_spiral = pos_spiral * shear_mat * 
               adjust_to_viewport;
  return pos_spiral.xy;
}

#pragma glslify: export(logarithmic_spiral_jitter)
