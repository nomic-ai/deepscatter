// this is a vertex shader wrapped in a javascript function
export default function vertex_shader(custom_attributes) {
  return `
precision mediump float;

${custom_attributes}

// Temporary placeholders to allow compiling;
/*    attribute float char0;
attribute float char2;
attribute float char4;
*/  

// Transform from data space to the open window.
uniform mat3 u_window_scale;
// Transform from the open window to the d3-zoom.
uniform mat3 u_zoom;
// Base point size
uniform float u_size;
// The maximum index to plot.
uniform float u_maxix;
// The current time.
uniform float u_time;
uniform float u_k;
uniform float u_render_text_min_ix;
uniform float u_string_index;
varying vec4 fill;

varying float my_mod;
varying float text_mode;

varying vec2 letter_pos;

// These must be dynamically defined.


vec4 discard_me = vec4(100.0, 100.0, 1.0, 1.0);

/*************** COLOR SCALES *******************************/



uniform sampler2D u_colormap;

// Ha! A gazillion version of this function:
// https://gist.github.com/kylemcdonald/f8df3bc2f8d38ca2b7cb
vec3 hsv2rgb( in vec3 c )
{
  vec3 rgb = clamp( abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0 );
  rgb = rgb*rgb*(3.0-2.0*rgb);
  return c.z * mix( vec3(1.0), rgb, c.y);
}

vec4 catscale(in float x) {
  // Category data is integers hashed to the strings.
  // Each can get its unique colors.
  vec3 hsv = vec3(mod(x, 11255.0)/11255.0, 0.7, 0.7);
  return vec4(hsv2rgb(hsv), 1.0);
}

vec4 masterscale(in float x) {
  if (x >= 1.0) {
    // Greater than 1.0, use a categorical scale for strings.
    return catscale(x);
  }
  if (x >= 0.0) {
    // Between 0 and 1, use viridis.
    return texture2D(u_colormap, vec2(1.0 - x, 0.5));
  }
  return vec4(0.0, 0.0, 0.0, 0.0);
}
/*************** END COLOR SCALES *******************************/

// Making d3-zoom work well with webgl requires two transformations at the end.
// First, we have to move each point to the left by one and up by by 1.0 because
// (mumbles to hide lack of understanding...) the [-1, 1] scales vs d3's [0, 1] scales

const mat3 untransform = mat3(
  vec3(1.0, 0.0, -1.0),
  vec3(0.0, 1.0, -1.0),
  vec3(0.0, 0.0, 1.0));
  // and finally, flip the y axis to resemble canvas and svg where 0 is the top.
const vec3 flip_y = vec3(1.0, -1.0, 1.0);
  
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
        
        gl_PointSize = u_size*exp(log(u_k)*0.5) * depth_size_adjust;// * time_adjust;// * step(0.0, time_adjust) * time_adjust;// * depth_size_adjust;// ;
        if (gl_PointSize <= 0.00001) {
          gl_Position = discard_me;
          return;
          } else {
            // First apply the d3 zoom transform; perform the uniform translations;
            vec3 pos2d = vec3(position.x, -position.y, 1.0) * u_window_scale * u_zoom * untransform * flip_y;
            gl_Position = vec4(pos2d, 1);
            
            // HSV rainbow
            //fill = vec4(hsv2rgb(vec3(mod(plot_time + u_time*0.25, 1.0), 0.7, 0.7)), 1.0);
            
            // These are sent to the frag shader;
            
            fill = masterscale(ix/u_maxix);
            text_mode = -1.0;
            
            if (1.0 < 0.0) {
              
              //        text_mode = u_render_text_min_ix - ix;
              /*
              if (text_mode > 0.0) {
              // Text needs more space.
              
              // We could get very fancy here. Store the bounding box in the texture.
              // The char0 here packs two ascii bytes into a float. It's not clear to me
              // if you can do four or not.
              
              float chardex;
              
              gl_PointSize = min(gl_PointSize * 4.0, 64.0);
              float char_width = 0.003 / 4.0;
              if (u_string_index <= 0.01) {
              chardex = (char0 - mod(char0, 256.0))/256.0;
              } else if (u_string_index <= 1.01) {
              chardex = fract(char0 / 256.0) * 256.0;
              gl_Position = gl_Position + vec4(char_width* u_string_index  * gl_PointSize, 0.0, 0.0, 0.0);
              } else if (u_string_index <= 2.01) {
              chardex = (char2 - mod(char2, 256.0))/256.0;
              gl_Position = gl_Position + vec4(char_width* u_string_index  * gl_PointSize, 0.0, 0.0, 0.0);
              } else if (u_string_index <= 3.01) {
              chardex = fract(char2 / 256.0) * 256.0;
              gl_Position = gl_Position + vec4(char_width* u_string_index  * gl_PointSize, 0.0, 0.0, 0.0);
              } else if (u_string_index <= 4.01) {
              chardex = (char4 - mod(char4, 256.0))/256.0;
              gl_Position = gl_Position + vec4(char_width* u_string_index  * gl_PointSize, 0.0, 0.0, 0.0);
              } else if (u_string_index <= 5.01) {
              chardex = fract(char4 / 256.0) * 256.0;
              gl_Position = gl_Position + vec4(char_width* u_string_index  * gl_PointSize, 0.0, 0.0, 0.0);
              } else {
              gl_Position = discard_me;
              return;
            }
            // Bail if the charcode isn't defined.
            if (chardex > 128.0) {
            // Something has gone wrong; this is not an ascii point.
            // Pink question mark.              
            fill = vec4(0.9, 0.1, 0.1, 0.5);
            
            chardex = 63.0;
          }
          letter_pos = vec2(fract(chardex / 16.0), floor((chardex - 16.0) / 16.0)/16.0);
          */
          } else if (u_string_index > 0.0) {
            gl_Position = discard_me;
          }
        }
      }
    }
    `
  }
