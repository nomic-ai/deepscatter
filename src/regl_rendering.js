import wrapREGL from 'regl';
import { select } from 'd3-selection';
import { timer, timerFlush, interval } from 'd3-timer';
import { zoom, zoomTransform, zoomIdentity } from 'd3-zoom';
import { range } from 'd3-array';
import { rgb } from 'd3-color';
import { interpolateViridis, interpolateWarm, interpolateCool } from 'd3-scale-chromatic';
import { Zoom } from './interaction.js';
import vec_shader from './vertex.js';

export class Renderer {
  
  // A renderer handles drawing to a GL canvas.
  constructor(selector, tileSet, prefs, zoom) {
    this.holder = select(selector);
    this.canvas = this.holder.select("canvas")
    this.tileSet = tileSet;
    
    this.regl = wrapREGL(this.canvas.node());
    
    this.prefs = {
      pointSize: 2.5,
      max_points: 10000,
      // Share of points that should get text drawn.
      "label_threshold": 0, 
    }
    
    this.width = +this.canvas.attr("width")
    this.height = +this.canvas.attr("height")
    
    this.zoom = zoom || new Zoom(this.width, this.height, this.canvas, this.prefs)
    .attach_renderer(this)
    .attach_tiles(tileSet)
    
    this.initialize_textures()        
    
    // Not the right way, for sure.
    
    this._initializations = [
      // some things that need to be initialized before the renderer is loaded.
      this.tileSet
      .dataTypes()
      .then(types => this.remake_renderer(types))
      
    ]
    
    this.initialize()
    
  }
  
  update_prefs(prefs) {
    Object.assign(this.prefs, prefs)
  }
  
  *initialize() {
    // Asynchronously wait for the basic elements to be done.
    return Promise.all(this._initializations).then(d => {
      this.zoom.restart_timer(5000)
    })
    
  }
}

export default class ReglRenderer extends Renderer {
  
  zoom_to(k, x, y, duration = 1000) {
    const { canvas, zoomer } = this;
    const t = d3.zoomIdentity.translate(x, y).scale(k);
    canvas.transition().duration(duration).call(zoomer.transform, t);
  }
  
  data(dataset) {
    if (data === undefined) {
      return this.tileSet
    } else {
      this.tileSet = dataset
      return this
    }
  }
  
  tick(force = false) {
    
    const { prefs } = this;
    
    const { regl, tileSet, canvas, width, height } = this;
    const { transform } = this.zoom;
    
    const {k} = transform;
    
    const props = {
      size: prefs.pointSize || 7,
      transform: transform,
      max_ix: prefs.max_points * k,
      time: (Date.now() - this.zoom._start)/1000,
      render_label_threshold: prefs.max_points * k * prefs.label_threshold,
      string_index: 0,
    }
    
    tileSet.download_to_depth(props.max_ix, this.zoom.current_corners())
    
    regl.clear({
      color: [0.25, 0.1, 0.2, 1],
      depth: 1
    });
    
    let n_visible = 0;
    
    const tiles_to_draw = tileSet
    .map(d => d)
    .filter(d => d.is_visible(props.max_ix, this.zoom.current_corners()))
    // seek_renderer initiates a promise for the 
    // tiles regl elements buffer.
    .filter(d => this.seek_renderer(d) != undefined)
    .map(tile => {
      n_visible += 1;
      props.count = tile._regl_elements.count
      props.data = tile._regl_elements.data
      let passes = 1
      if (this.prefs.label_field) {
        passes = 8
      }
      for (let i = 0; i < passes; i++) {
        props.string_index = i;
        this._renderer(props);
      }
    })
  }
  
  seek_renderer(tile, force = false) {
    // returns a renderer if one exists, else it
    // starts the process of binding one to the tile
    // and returns undefined
    if (tile._regl_elements && !force) {
      return tile._regl_elements
    } else {
      if (!tile.underway_promises.has(!"regl")) {
        tile.underway_promises.add("regl")
        Promise.all([tile.buffer(), tile.dataTypes()])
        .then(([buffer, datatypes]) => {
          tile._regl_elements = this.make_elements(buffer, datatypes);
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
    offscreen.transition().delay(2000).attr("opacity", 0).style("display", "none")
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
  
  _set_word_buffers(field, tile) {
    // hard coded at eight letters.
    if (tile._regl_settings = undefined) {
      tile._regl_settings = {}
    }
    
    const { prefs } = this;
    
    if (tile._regl_settings.flexbuff == `${prefs.label_field}-ASCII`) {
      return
    }
    
    const {offset, stride} = this.__datatypes['flexbuff1']
    let position = offset;
    const wordbuffer = new Float32Array(4);
    for (let datum of tile) {
      for (let block of [0, 1, 2, 3]) {
        let [one, two] = [0, 1].map(i => datum.word.charCodeAt(i))
        if (two > 255) {two = 128}
        wordbuffer[i] = one * 256 + two;
      }  
    }
    tile._regl_settings.flexbuff == `${prefs.label_field}-ASCII`
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
  
  make_char_buffer(tile, char_field) {
    if (!tile._char_buffers) {
      tile._char_buffers = {}
    }
    if (tile.char_buffers[char_field]) {
      return tile.char_buffers[char_field]
    }
    
  }
  
  make_elements(points, datatypes) {
    const { regl } = this;
    // -1 because we store 'position', 'x', and 'y';
    const count = points.length / (Object.entries(datatypes).length - 1);
    return {
      'count': count,
      'data': regl.buffer(points)
    }
  }
  
  remake_renderer() {
    const datatypes = this.tileSet.__datatypes;
    if (this.tileSet._datatypes == undefined) {
      // start the promise.
      this.tileSet.dataTypes()
      return false
    } 
    
    const { regl, width, height, zoom } = this;
    
    // This should be scoped somewhere to allow resizing.
    const webgl_scale = zoom.webgl_scale().flat();
    
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
      primitive: "points",
      vert: vertex_shader(datatypes),
      count: function(context,props) {
        return props.count
      },
      uniforms: {
        u_colormap: this.viridis_texture,
        u_charmap: this.char_texture,
        //        u_rainbow: this.rainbow_texture,
        //        u_minYear: function(context, props) {
        //          return props.minYear
        //        },
        u_render_text_min_ix: function(context, props) {
          return props.render_label_threshold
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
        u_window_scale: function(context, props) {
          return webgl_scale;
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
      }
      
    }
    // Add all the other fields we've found, each encoded as a float.
    parameters.attributes = JSON.parse(JSON.stringify(datatypes));
    Object.entries(parameters.attributes).forEach(([k, v]) => {
      delete v.dtype
      v.buffer = function(context, props) {
        return props.data
      }
    })
    this._renderer = regl(parameters)
    return this._renderer
  }
}


function vertex_shader (datatypes) {
  const custom_attributes = Object.entries(datatypes).map(([k, v]) => {
    let name = k;
    let dtype = 'float';
    if (k == "position") {
      dtype = 'vec2'
    }
    return `attribute ${dtype} ${name};`
  }).join("\n");
  return vec_shader(custom_attributes)
}
