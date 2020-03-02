import wrapREGL from 'regl';
import { select } from 'd3-selection';
import { timer, timerFlush, interval } from 'd3-timer';
import { zoom, zoomTransform, zoomIdentity } from 'd3-zoom';
import { range } from 'd3-array';
import { rgb } from 'd3-color';
import { interpolateViridis, interpolateWarm, interpolateCool } from 'd3-scale-chromatic';

export default class ReglRenderer {

  constructor(selector, tileSet) {
    this.holder = select(selector);
    this.canvas = this.holder.select("canvas")
    this.tileSet = tileSet;
    this.regl = wrapREGL(this.canvas.node());

    this.prefs = {
      pointSize: 2,
      max_points: 200000,
      // Share of points that should get text drawn.
      text_threshold: 0.01
    }
    this.width = +this.canvas.attr("width")
    this.height = +this.canvas.attr("height")
    // Not the right way, for sure.
    this.initialize_textures()
    this.initialize_zoom()
    this.restart_timer(1e06)
  }


  zoom_to(k, x, y, duration = 1000) {
    const { canvas, zoomer } = this;
    const t = d3.zoomIdentity.translate(x, y).scale(k);
    canvas.transition().duration(duration).call(zoomer.transform, t);
  }
  
  initialize_zoom() {
  
    const { width, height, canvas, prefs } = this;
    const zoomer = zoom()
          .scaleExtent([1/3, 100000])
          .extent([[0, height], [width, 0]])
          .on("zoom", () => {
            const k = this.canvas.node().__zoom.k;
//            this.restart_timer(1000)

          })

    canvas.call(zoomer);
    canvas.call(zoomer.translateBy, width/2, height/2);
    //  start.x = width/2;
    //  start.y = height/2;
    this.tick(true)

    this.zoomer = zoomer
  }

  restart_timer(run_at_least = 1000) {
    // Restart the timer and run it for
    // run_at_least milliseconds or the current timeout,
    // whichever is greater.
    
    const { tick, canvas } = this;
    let stop_at = Date.now() + run_at_least;
    if (this._timer) {
      if (this._timer.stop_at > stop_at) {
        stop_at = this._timer.stop_at
      }
      this._timer.stop()
    }

    const t = interval(this.tick.bind(this), 1000/120)
    this._timer = t;

    this._timer.stop_at = stop_at;
    
    timerFlush();

    
    return this._timer;
  }

  data(dataset) {
    if (data === undefined) {
      return this.tileSet
    } else {
      this.tileSet = dataset
      return this
    }
  }

  current_corners() {
    // The corners of the current zoom transform, in webgl coordinates.
    const { width, height } = this;
    const t = zoomTransform(this.canvas.node())
    const unscaled = [
      t.invert([0, 0]),
      t.invert([width, height])
    ]
    return {
      x: [unscaled[0][0]/width*2, unscaled[1][0]/width*2],
      y: [unscaled[0][1]/height*2, unscaled[1][1]/height*2],
      k: t.k
    }
  }

  tick(force = false) {

    if (!force && this._timer && this._timer.stop_at <= Date.now()) {
      console.log("Timer ending")
      this._timer.stop()
      return;
    }

    const { prefs } = this;

    const { regl, tileSet, canvas, current_corners } = this;

    const n = canvas.node()
    const transform = zoomTransform(n)
    const {k} = transform;

    const props = {
      size: prefs.pointSize || 7,
      transform: transform,
      max_ix: prefs.max_points,// * k,
      time: Date.now()/1000,
      render_text: prefs.max_points * k * prefs.text_threshold,
      string_index: 0,
    }
    
//    console.log(props.max_ix)

    tileSet.download_to_depth(props.max_ix, this.current_corners())

    regl.clear({
      color: [0.25, 0.1, 0.2, 1],
      depth: 1
    });

    let n_visible = 0;

    const tiles_to_draw = tileSet
      .map(d => d)
      .filter(d => d.is_visible(props.max_ix, this.current_corners()))
          .map(d => [this.seek_renderer(d), d._buffer, +(d.key.split("/")[0])])
      .filter(d => d[0])

    // The highest (most prominent levels) should be drawn last.
    // This is not always true, probably; for instance,
    // it's nice to have smaller points drawn on top of larger ones.
    tiles_to_draw.sort((a, b) => a[2] < b[2])

    tiles_to_draw
      .map(([renderer, buffer, key]) => {
        n_visible += 1;
        props.points = buffer;        
        [0, 1, 2, 3, 4, 5].forEach(string_index => {
          props.string_index = string_index;
          renderer(props);
        })
      })
  }

  seek_renderer(tile, force = false) {
    // returns a renderer if one exists, else undefined.    
    if (tile._regl && !force) {
      return tile._regl
    } else {
      if (!tile.underway_promises.has(!"regl")) {
        tile.underway_promises.add("regl")
        Promise.all([tile.buffer(), tile.dataTypes()])
          .then(([buffer, datatypes]) => {
            tile._regl = this.make_renderer(buffer, datatypes);
          })
      }
      // It's underway, but there's nothing to do until it gets here.
      return undefined
    }
  }
  
  _character_map(height=32) {
    var offscreen = select("#letters")
    const n_grid = 16;
    offscreen.attr("height", 16 * height)
    offscreen.attr("width", 16 * height)
    offscreen.transition().delay(5000).style("opacity", 0).style("display", "none")
    const c = offscreen.node().getContext('2d');
    c.font = `${height - height/3}px Georgia`;
    // Draw the first 255 characters. (Are there even any after 127?)
    d3.range(128).map(i =>
                    c.fillText(String.fromCharCode(i),
                               (height * (i % 16)),
                               Math.floor(i/16)*height - height/3
                              ))
    c.font = `18px Georgia`;    
    c.fillText("This canvas should vanish; it is a character map being used for looking up sprite positions.", 20, height * 9)
    c.fillText("All the white space between letters is currently being drawn, which is hella bad.", 20, height * 9.5)
    c.fillText("Characters not found here should render as red circles.", 20, height * 10.0)
    return c.getImageData(0, 0, 16 * height, 16 * height)
  }

  initialize_textures() {
    const { regl } = this;
    const viridis = range(256)
          .map(i => {
            const p = rgb(interpolateViridis(i/255));
            return [p.r, p.g, p.b, p.opacity * 255]
          })
    const niccoli_rainbow = range(256).map(i => {
      let p;
      if (i < 128) {
        p = interpolateWarm(i/127)
      } else {
        p = interpolateCool((i - 128)/127)
      }
      p = d3.rgb(p);
      return [p.r, p.g, p.b, p.opacity * 255]
    })

    this.rainbow_texture = regl.texture([niccoli_rainbow])
    this.viridis_texture = regl.texture([viridis])
    const char_textures = this._character_map(64)
    this.char_texture = regl.texture(char_textures);
  }

  
  
  make_renderer(points, datatypes) {

    const { regl, width, height } = this;
    // So this is a little bonkers: because the attributes expects 'points' to be defined
    // when you create a regl renderer,
    // I run this renderer call separately for each different tile that's been loaded from the server.
    const vertSize = points[0].length * 4;

    const count = points.length
    
    const parameters = {
      depth: { enable: false },
      stencil: { enable: false },
      frag: `

    precision mediump float;

    varying vec4 fill;
    varying vec2 letter_pos;
    varying float text_mode;
    uniform sampler2D u_charmap;

    void main() {

      // Drop portions of the rectangle not in the 
      // unit circle for this point.


      if (text_mode < 0.0 ) {
        vec2 cxy = 2.0 * gl_PointCoord - 1.0;
        float r = dot(cxy, cxy);
        if (r > 1.0) discard;
        gl_FragColor = fill;
      } else {
        if (gl_PointCoord.x > 0.50) discard;
        vec2 coords = letter_pos + gl_PointCoord/16.0;
        vec4 letter = texture2D(u_charmap, coords);
        if (letter.a <= 0.03) discard;
        gl_FragColor = mix(fill, vec4(0.25, 0.1, 0.2, 1.0), 1.0 - letter.a);
    }
   }
  `,
      vert: vertex_shader("word", "word", datatypes),
      attributes: {
        position: {
          buffer: points,
          stride: vertSize,
          offset: 0
        },
        // Frag color
        myix: {
          buffer: points,
          stride: vertSize,
          offset: 8
        }
      },

      uniforms: {
        u_colormap: this.viridis_texture,
        u_charmap: this.char_texture,
//        u_rainbow: this.rainbow_texture,
//        u_minYear: function(context, props) {
//          return props.minYear
        //        },
        u_render_text_min_ix: function(context, props) {
          return props.render_text
        },
        u_string_index: function(context, props) {
          return props.string_index
        },
        u_maxix: function(context, props) {
          return props.max_ix;
        },
        u_k: function(context, props) {
          return props.transform.k;
        },
        u_time: function(context, props) {
          return props.time;
        },
        u_zoom: function(context, props) {
          return [
            [props.transform.k, 0, 2*props.transform.x/width],
            [0, props.transform.k, 2*props.transform.y/height],
            [0, 0, 1],
          ].flat()
        },
        u_size: regl.prop('size')
      },

      // specify the number of points to draw
      count: count,
      
      // specify that each vertex is a point (not part of a mesh)
      primitive: "points"
    }
    // dynamically add all the other fields we've found, each encoded as a float.
    datatypes.slice(3).forEach(([name, type], i) => {
      parameters.attributes[name] = {
        buffer: points,
        stride: vertSize,
        offset: i * 4 + 12
      }
    })
    return regl(parameters)
  }

}


function vertex_shader (time, colorvar, datatypes, saturation = .7, value = .7) {
  // The time

  
  const custom_attributes = datatypes.map(([k, dtype]) => {
    if (['x', 'y', 'ix'].indexOf(k) > -1) {
      return '';
    }
    return `attribute float ${k};`;
  }).join("\n");
  
  return `
    precision mediump float;

    attribute vec2 position;
    attribute vec4 color;
    attribute float myix;
    ${custom_attributes}

    uniform mat3 u_zoom;
    uniform float u_size;
    uniform float u_maxix;
    uniform float u_time;
    uniform float u_k;
    uniform float u_render_text_min_ix;
    uniform float u_string_index;
    varying vec4 fill;
    varying float my_mod;
    varying float text_mode;

    varying vec2 letter_pos;


    // These must be dynamically defined.


    float smoothscale(in float x) {
      // This allows smooth animation in a loop if you feed in data with a periodicity of under 2*pi.
      return clamp((cos(${colorvar}) - 1.0) * sign(sin(x/2.0)), 0.0, 2.0)/2.0;
    }


    /*************** COLOR SCALES *******************************/

    vec4 discard_me = vec4(100.0, 100.0, 1.0, 1.0);
    
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

      vec3 hsv = vec3(mod(x, 11255.0)/11255.0, ${saturation}, ${value});
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

      if (myix > u_maxix) {
        // throwaway points that are too low.
        gl_Position = discard_me;
        return;
      } else {
        // Manually generate a linear scale.

       float depth_size_adjust = (1.0 - myix / (u_maxix));

// An example for how to rescale into [0, 1]
//       plot_time = (clamp(${time}, t_min, t_max) - t_min)/(t_max - t_min);

//       time_adjust = smoothscale(u_time - 1.99*plot_time*3.14159265358979323);
  //     gl_PointSize = 10.0;
        gl_PointSize = u_size*exp(log(u_k)*0.5) * depth_size_adjust;// * step(0.0, time_adjust) * time_adjust;// * depth_size_adjust;// ;
        if (gl_PointSize <= 0.00001) {
          gl_Position = discard_me;
        } else {
          // First apply the d3 zoom transform; perform the uniform translations;
          vec3 pos2d = vec3(position.x, -position.y, 1.0) * u_zoom * untransform * flip_y;
          gl_Position = vec4(pos2d, 1);

// HSV rainbow
//        fill = vec4(hsv2rgb(vec3(mod(plot_time + u_time*0.25, 1.0), ${saturation}, ${value})), 1.0);
        //fill = masterscale(${colorvar});

        // These are sent to the frag shader;

        fill = masterscale(myix/u_maxix);

        text_mode = u_render_text_min_ix - myix;
        if (text_mode > 0.0) {
            // Text needs more space.

            // We could get very fancy here. Store the bounding box in the texture.
            // The char0 here packs two ascii bytes into a float. It's not clear to me
            // if you can do four or not.

            float chardex;
            if (u_string_index <= 0.01) {
                chardex = (char0 - mod(char0, 256.0))/256.0;
            } else if (u_string_index <= 1.01) {
                chardex = fract(char0 / 256.0) * 256.0;
                gl_Position = gl_Position + vec4(0.003 * u_string_index  * gl_PointSize, 0.0, 0.0, 0.0);
            } else if (u_string_index <= 2.01) {
                chardex = (char2 - mod(char2, 256.0))/256.0;
                gl_Position = gl_Position + vec4(0.003 * u_string_index  * gl_PointSize, 0.0, 0.0, 0.0);
            } else if (u_string_index <= 3.01) {
                chardex = fract(char2 / 256.0) * 256.0;
                gl_Position = gl_Position + vec4(0.003 * u_string_index  * gl_PointSize, 0.0, 0.0, 0.0);
            } else if (u_string_index <= 4.01) {
                chardex = (char4 - mod(char4, 256.0))/256.0;
                gl_Position = gl_Position + vec4(0.003 * u_string_index  * gl_PointSize, 0.0, 0.0, 0.0);
            } else if (u_string_index <= 5.01) {
                chardex = fract(char4 / 256.0) * 256.0;
                gl_Position = gl_Position + vec4(0.003 * u_string_index  * gl_PointSize, 0.0, 0.0, 0.0);
            } else {
                gl_Position = discard_me;
            }
            // Bail if the charcode isn't defined.
            if (chardex > 128.0) {
                // Something has gone wrong; this is not an ascii point.
                fill = vec4(0.9, 0.1, 0.1, 0.5);
                text_mode = -1.0;
            } else {
               gl_PointSize = gl_PointSize * 4.0;
               letter_pos = vec2(fract(chardex / 16.0), floor((chardex - 16.0) / 16.0)/16.0);
            }
        } else if (u_string_index > 0.0) {
            gl_Position = discard_me;
        }
      }
     }

      // Gar. Three transformations
    }
  `
}
