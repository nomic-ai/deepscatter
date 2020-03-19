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
attribute vec4 a_label;

uniform vec2 u_color_domain;
uniform vec2 u_size_domain;
uniform vec2 u_time_domain;

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
  float fractional = linstep(-0.5, 0.5, x);
  return texture2D(u_colormap,
    vec2(1.0 - fractional, 0.5));
}

/*************** END COLOR SCALES *******************************/


void main() {

if (ix > u_maxix) {
    // throwaway points that are too low.
    gl_Position = discard_me;
    return;
} else {
  // Manually generate a linear scale.
  float depth_size_adjust = (1.0 - ix / (u_maxix));
  //     gl_PointSize = 10.0;
  //        float time_adjust = sin(u_time / 4.0 + ix/u_maxix)*0.13 + 1.0;
  
  gl_PointSize = u_size*exp(log(u_k)*0.5) * depth_size_adjust;// * time_adjust;// * step(0.0, time_adjust) * time_adjust;// * depth_size_adjust;//
  gl_PointSize = min(gl_PointSize, 16.);
  if (gl_PointSize <= 0.00001) {
    return;
  } else {
  // First apply the d3 zoom transform; perform the uniform translations;
   vec3 pos2d = vec3(position.x, position.y, 1.0) * from_coord_to_gl;
    gl_Position = vec4(pos2d, 1);
    fill = scaleLinear(a_color);
    text_mode = u_render_text_min_ix - ix;
    if (text_mode > 0.0) {
      // Text needs more space.
      // We could get very fancy here. Store the bounding box in the texture.
      // The char0 here packs two ascii bytes into a float. It's not clear to me
      // if you can do four or not.
        
        float chardex;
        
        gl_PointSize = min(gl_PointSize * 4.0, 64.0);
        float char_width = 0.0025 / 4.0;
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
  gl_FragColor = vec4(0.8, 0.8, 0.8, 1.0);
}
`
