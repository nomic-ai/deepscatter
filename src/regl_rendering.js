import wrapREGL from 'regl';
import { select, create } from 'd3-selection';
import { range, sum } from 'd3-array';
import { rgb } from 'd3-color';
import { interpolatePuOr, interpolateViridis, interpolateWarm, interpolateCool } from 'd3-scale-chromatic';
import { Zoom } from './interaction.js';
import { vertex_shader, frag_shader } from './shaders.glsl';
import { Renderer } from './rendering.js';


export class ReglRenderer extends Renderer {

  constructor(selector, tileSet, prefs, parent) {
    super(selector, tileSet, prefs, parent)
    console.log("CANV", this.canvas, this.canvas.node())
    this.regl = wrapREGL(this.canvas.node());
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

  update_visibility(tile, plot_num, modulo = 3) {
    const plot_cycle = plot_num % modulo;
    const { filters } = this._parent;
    let visibility = [];
    if (!tile._data || !tile._data.length) {
      return
    }
    // Divide the full count into 30 chunks; each has this many
    // items in it. Add .0001 to guarantee capturing the last item.
    const {length} = tile._data
    // In this cycle, we're only updating between these items.
    const first = Math.floor(length * plot_cycle / modulo)
    const last = Math.floor(length * (1 + plot_cycle) / modulo);
    // console.log(first, last, tile._data.length)
    const values = new Array(last - first).fill(0);
    let i = 0;
    let debug;
    for (let datum of tile) {
        // Only do 1 in 30 at each tick.
        if (i >= first && i < last * 0.5) {
          if (filters.every(func => func(datum))) {
            values[i - first] = 1.0
          }
        }
      i++;
      debug = datum;
    }
    // console.log(filters[0](debug), values[values.length - 1])
    // console.log(tile.key, sum(values) / length)
    tile._regl_elements.visibility.subdata(values, first)
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
      color: [0.1, 0.1, 0.13, 1],
      depth: 1
    });

    let n_visible = 0;

    for (let tile of this.visible_tiles(props.max_ix)) {
      // seek_renderer initiates a promise for the
      // tile's regl elements buffer.

      if (this.seek_renderer(tile) == undefined) {
        continue
      }

      this.update_visibility(tile, this.tick_num, 1)

      n_visible += 1;
      if ((tile.min_ix) < (props.max_ix * prefs.label_threshold)) {
        this._set_word_buffers(tile);
      }
      props.count = tile._regl_elements.count;
      props.data = tile._regl_elements.data;
      props.visibility = tile._regl_elements.visibility;
      let passes = 1;
      if (this.prefs.label_field) {
        passes = 8
      }
      for (let i = 0; i < passes; i++) {
        // Draw multiple times for each letter in the buffer.
        props.string_index = i;
        this._renderer(props);
      }
    }
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
    const count = points.length /
                  (Object.entries(datatypes).length - 1);
    return {
      'count': count,
      'data': regl.buffer(points),
      'visibility': regl.buffer({
        usage: 'dynamic',
        length: count * 4,
        type: 'float'
      })
    }

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
        u_colormap: this.viridis_texture,
        u_charmap: this.char_texture,
        u_render_text_min_ix: function(context, props) {
          return props.render_label_threshold
        },
        u_color_domain: function(context, props) {
          // return props._scales.color.domain()
          console.log("DOMAIN", props.prefs.color_domain)
          return props.prefs.color_domain
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
