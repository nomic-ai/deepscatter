export const default_background_options: BackgroundOptions = {
  color: 'gray',
  opacity: 0.2,
  size: 0.66,
  mouseover: false,
};

export const default_API_call: APICall = {
  zoom_balance: 0.35,
  // One second transitions
  duration: 1000,
  // Not many points.
  max_points: 1000,
  // Encoding defaults are handled by the Aesthetic class.
  encoding: {},
  point_size: 1, // base size before aes modifications.
  alpha: 40, // Default screen saturation target.
  background_options: default_background_options,
};
