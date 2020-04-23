import wrapREGL from 'regl';
import { select, create } from 'd3-selection';
import { range, sum } from 'd3-array';
import { rgb } from 'd3-color';
import { interpolatePuOr, interpolateViridis, interpolateWarm, interpolateCool } from 'd3-scale-chromatic';
import { Zoom } from './interaction.js';
import { vertex_shader, frag_shader } from './shaders.glsl';
import { Renderer } from './rendering.js';
import GLBench from 'gl-bench/dist/gl-bench';


export class ReglRenderer extends Renderer {

  constructor(selector, tileSet, prefs, parent) {
    super(selector, tileSet, prefs, parent)
    console.log("CANV", this.canvas, this.canvas.node())
    this.regl = wrapREGL(this.canvas.node());

    /* BOILERPLATE */
    let gl = this.canvas.node().getContext('webgl') || this.canvas.node().getContext('experimental-webgl');
    let bench = new GLBench(gl);
    function draw(now) {
      bench.begin('Drawing speed');
      // some bottleneck
      bench.end('');
      bench.nextFrame(now);
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
    /* END BOILERPLATE */

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

    this.tick_num = this.tick_num || 0;
    this.tick_num++;

    const props = {
      size: prefs.point_size || 7,
      transform: transform,
      max_ix: prefs.max_points * k,
      time: (Date.now() - this.zoom._start)/1000,
      render_label_threshold: prefs.max_points * k * prefs.label_threshold,
      string_index: 0,
      prefs: prefs
    }


    tileSet.download_to_depth(props.max_ix, this.zoom.current_corners())

    regl.clear({
      color: [0.1, 0.1, 0.13, 0],
      depth: 1
    });

    let n_visible = 0;

    // Run this in a thread.
    this.tileSet.update_visibility_buffer(
      this.zoom.current_corners(),
      this._parent.filters,
      5,
      props.max_ix,
      Date.now(),
      true
    )

    // Bundle up the regl draw calls.
    let prop_list = [];

    for (let tile of this.visible_tiles(props.max_ix)) {
      // seek_renderer initiates a promise for the
      // tile's regl elements buffer.

      if (this.seek_renderer(tile) == undefined) {
        continue
      }

      n_visible += 1;
      if ((tile.min_ix) < (props.max_ix * prefs.label_threshold)) {
        this._set_word_buffers(tile);
      }
      const this_props = {
        count: tile._regl_elements.count,
        data: tile._regl_elements.data,
        visibility: tile._regl_elements.visibility
      }
      Object.assign(this_props, props)
      prop_list.push(this_props)
      //this._renderer(props);
    }
    this._renderer(prop_list)
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

  spritesheet_setter(word) {
    // Set if not there.
    let ctx = 0;
    if (!this.spritesheet) {
      var offscreen = create("canvas")
        .attr("width", 4096)
        .attr("width", 4096)
        .style("display", "none")

      ctx = offscreen.node().getContext('2d');
      const font_size = 32
      ctx.font = `${font_size}px Times New Roman`;
      ctx.fillStyle = "black";
      ctx.lookups = new Map()
      ctx.position = [0, font_size - font_size / 4.]
      this.spritesheet = ctx
    } else {
      ctx = this.spritesheet
    }
    let [x, y] = ctx.position;

    if (ctx.lookups.get(word)) {
      return ctx.lookups.get(word)
    }
    const w_ = ctx.measureText(word).width
    if (w_ > 4096) {
      return
    }
    if ((x + w_) > 4096) {
      x = 0
      y += font_size
    }
    ctx.fillText(word, x, y);
    lookups.set(word, {x: x, y: y, width: w_})
    ctx.strokeRect(x, y - font_size, width, font_size)
    x += w_
    ctx.position = [x, y]
    return lookups.get(word)
  }

  _character_map(height=32) {
    const n_grid = 16;

    var offscreen = create("canvas")
    .attr("height", 16 * height)
    .attr("width", 16 * height)
    .style("display", "none")

    const c = offscreen.node().getContext('2d');

    c.font = `${height - height/3}px Georgia`;

    // Draw the first 255 characters. (Are there even any after 127?)
    range(128).map(i =>
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

  _set_word_buffers(tile) {

    // hard coded at eight letters.
    if (tile._regl_settings == undefined) {
      tile._regl_settings = {}
    }
    const { prefs } = this;

    if (tile._data == undefined) {
      return
    }

    if (tile._regl_settings.flexbuff == `${prefs.label_field}-ASCII`) {
      return
    } else {
      tile._regl_settings.flexbuff = `${prefs.label_field}-ASCII`
    }

    console.log(`Setting ${prefs.label_field} text buffers on ${tile.key}`)

    const {offset, stride} = tile.__datatypes['flexbuff1']
    let position = offset;
    const wordbuffer = new Float32Array(4);
    tile.charset = tile.parent ? new Set(tile.parent.charset) : new Set();
    for (let datum of tile) {
      for (let block of [0, 1, 2, 3]) {
        let [one, two] = [0, 1].map(
          i => datum[prefs.label_field].charCodeAt(i + block * 2)
        )

        tile.charset.add(String.fromCharCode(one));
        tile.charset.add(String.fromCharCode(two));


        if (one > 255) {
          one = 127;
        } else if (isNaN(one)) {
          one = 8
        }
        if (two > 255) {
          two = 127;
        } else if (isNaN(two)) {
          two = 8
        }
        wordbuffer[block] = two * 256 + one;
      }
      tile._regl_elements.data.subdata(
        wordbuffer, position
      )
      position += stride;
    }

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
      p = rgb(p);
      return [p.r, p.g, p.b, p.opacity * 255]
    })
/*    this.character_texture = regl.texture({
      shape: [4096, 4096]
    })*/
    this.color_scale = regl.texture([viridis])
//    const char_textures = this._character_map(64)
//    this.char_texture = regl.texture(char_textures);
    this.year = regl.texture({shape: [1024, 32] })
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
    const count = points.length /
                  (Object.entries(datatypes).length - 1);
    const elements = {
      'count': count,
      'data': regl.buffer(points),
      'visibility': regl.buffer({
        usage: 'dynamic',
        data: new Array(points.length).fill(0),
        type: 'float'
      }),
      'texture_locations': regl.buffer({
        'usage': 'dynamic',
        length: count * 4,
        type: 'float'
      })
    }
    return elements


  }

  remake_renderer() {
    const datatypes = this.tileSet.__datatypes;

    if (this.tileSet._datatypes == undefined) {
      // start the promise.
      this.tileSet.dataTypes()
      return false
    }

    const { regl, width, height, zoom, prefs } = this;

    // This should be scoped somewhere to allow resizing.
    const [webgl_scale, untransform_matrix] =
    zoom.webgl_scale()

    const parameters = {
      depth: { enable: false },
      stencil: { enable: false },

      primitive: "points",
      frag: frag_shader,
      vert: vertex_shader,
      count: regl.prop('count'),
      attributes: {
        a_visibility: {
          buffer: function(context, props) {
                      return props.visibility
                  },
          offset: 0,
          stride: 4
         }
      },

      uniforms: {
        u_aspect_ratio: width/height,
        u_colormap: this.color_scale,
        u_color_domain: function(context, props) {
          // return props._scales.color.domain()
          console.log("DOMAIN", props.prefs.color_domain)
          return props.prefs.color_domain
        },
        u_render_text_min_ix: function(context, props) {
          return props.render_label_threshold
        },
        u_jitter: function(context, props) {
          if (props.prefs.jitter == "spiral") {
            return 1
          } else if (props.prefs.jitter == "uniform") {
            return 2
          } else if (props.prefs.jitter == "normal") {
            return 3
          } else {
            return 0
          }
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
        u_window_scale: webgl_scale,
        u_untransform: untransform_matrix,
        u_time: function(context, props) {
          return props.time;
        },
        u_zoom: function(context, props) {
          const zoom_matrix = [
            [props.transform.k, 0, props.transform.x],
            [0, props.transform.k, props.transform.y],
            [0, 0, 1],
          ].flat()

          return zoom_matrix;
        },
        u_size: regl.prop('size')
      }
    }

    for (let k of ['position', 'ix']) {
      parameters.attributes[k] = Object.assign({}, datatypes[k])
    }


    for (let k of ['color', 'label']) { //, 'a_size', 'a_time', 'a_opacity', 'a_text']) {
      let field;
      if (k == 'label') {
        field = 'flexbuff1';
      } else {
        field = prefs[`${k}_field`];
        const domain = prefs[`${k}_domain`]
        parameters.uniforms["u_" + k + "_domain"] = domain;
        // Copy the parameters from the data name.
      }
      parameters.attributes["a_" + k] = Object.assign(
        {},
        datatypes[field]
      );
    }

    Object.entries(parameters.attributes).forEach(([k, v]) => {
      // Not defined in the tile data.
      if (k == "a_visibility") {return}
      delete v.dtype
      v.buffer = function(context, props) {
        return props.data
      }
    })

    this._renderer = regl(parameters)
    return this._renderer
  }

}
