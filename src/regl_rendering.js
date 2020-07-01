import wrapREGL from 'regl';
import { select, create } from 'd3-selection';
import { range, sum, max } from 'd3-array';
import { rgb } from 'd3-color';
import { interpolatePuOr, interpolateViridis, interpolateWarm, interpolateCool } from 'd3-scale-chromatic';
import { Zoom } from './interaction.js';
// import { aesthetic_variables } from './shaders';
import { Renderer } from './rendering.js';
import Aesthetic from "./Aesthetic.js";
import GLBench from 'gl-bench/dist/gl-bench';
import {contours} from 'd3-contour';
import gaussian_blur from './glsl/gaussian_blur.frag';
import vertex_shader from './glsl/general_vertex.glsl';
import frag_shader from './glsl/general.frag';

export class ReglRenderer extends Renderer {

  constructor(selector, tileSet, prefs, parent) {
    super(selector, tileSet, prefs, parent)
    this.regl = wrapREGL(
      {
        canvas: this.canvas.node(),
      }
    );


    /* BOILERPLATE */
    let gl = this.canvas.node().getContext('webgl') || this.canvas.node().getContext('experimental-webgl');
    let bench = new GLBench(gl, {
      // css: 'position:absolute;top:120;',
      withoutUI: false,
      trackGPU: false,      // don't track GPU load by default
      chartHz: 20,          // chart update speed
      chartLen: 20,
    }
    );

    function draw(now) {
      bench.begin('Drawing speed');
      // some bottleneck
      bench.end('');
      bench.nextFrame(now);
      requestAnimationFrame(draw);
    }

    requestAnimationFrame(draw);
    /* END BOILERPLATE */

    this.aes = {}

    for (const aes_upper of ["Size", "Alpha", "Jitter_speed", "Jitter_radius", "Color", "Filter"]) {
      const aes = aes_upper.toLowerCase()
      this.aes[aes] = new Aesthetic[aes_upper](aes, this.regl, tileSet)
    }

    // allocate buffers in 64 MB blocks.
    this.buffer_size = 1024 * 1024 * 64

    this.initialize_textures()
    // Not the right way, for sure.
    this._initializations = [
      // some things that need to be initialized before the renderer is loaded.
      this.tileSet
      .promise
      .then(() => this.remake_renderer())
    ]
    this.initialize()
  }


  get buffers() {
    this._buffers = this._buffers ||
      new MultipurposeBufferSet(this.regl, this.buffer_size)
    return this._buffers
  }

  data(dataset) {
    if (data === undefined) {
      return this.tileSet
    } else {
      this.tileSet = dataset
      return this
    }
  }

  apply_encoding(encoding) {
    this.encoding = this.encoding || new Map();
    for (let [k, v] of Object.entries(encoding)) {
      if (this.encoding.has(k) &&
          JSON.stringify(v) == this.encoding.get(k)
         ) {
        continue
        } else {
          this.aes[k].update(v)
          this.encoding.set(k, JSON.stringify(v))
        }
    }
  }

  get props() {
    const prefs = this.prefs
    const { transform } = this.zoom;
    const {k} = transform;

    const props = {
      zoom_balance: prefs.zoom_balance,
      transform: transform,
      max_ix: this.max_ix,
      time: (Date.now() - this.zoom._start)/1000,
      string_index: 0,
      prefs: prefs,
      color_type: undefined,
      color_picker_mode: 0 // whether to draw as a color picker.
    }
    // Clone.
    return JSON.parse(JSON.stringify(props))
  }


  render_points(props) {

    // Regl is faster if it can render a large number of draw calls together.
    let prop_list = [];

    for (let tile of this.visible_tiles()) {
      // Do the binding operation; returns truthy if it's already done.

      const manager = new TileBufferManager(this.regl, tile, this)

      try {
        if (!manager.ready(props.prefs)) {
          // The 'ready' call also pushes a creation request into
          // the deferred_functions queue.
          continue
        }
      } catch (err) {
        console.warn(err)
        continue
      }

      const this_props = {
        manager: manager,
        image_locations: manager.image_locations,
        sprites: this.sprites
      }
      Object.assign(this_props, props)
      prop_list.push(this_props)
    }

    if (this._renderer === undefined) {
      if (this._zoom && this._zoom._timer) {
        this._zoom._timer.stop()
      }
      return
    }

    // Do the lowest tiles first.
    prop_list.reverse()
    this._renderer(prop_list)

  }

  tick(force = false) {

    const { prefs } = this;
    const { regl, tileSet, canvas, width, height } = this;
    const { transform } = this.zoom;
    const {k} = transform;
    const {props} = this;

    this.tick_num = this.tick_num || 0;
    this.tick_num++;

    // Set a download call in motion.
    tileSet.download_to_depth(this.props.max_ix, this.zoom.current_corners())

    regl.clear({
      color: [0.9, 0.9, 0.93, 0],
      depth: 1
    });

    const start = Date.now()

    while (Date.now() - start < 10 && this.deferred_functions.length) {
      // Keep popping deferred functions off the queue until we've spent 10 milliseconds doing it.
      try {
        this.deferred_functions.shift()()
      } catch (err) {
        console.warn(err)
      }
    }

    this.render_all(props)

  }

  render_jpeg(props) {

  }

  single_blur_pass(fbo1, fbo2, direction) {
    const { regl } = this;
    fbo2.use( () => {
      regl.clear({color: [0, 0, 0, 0]});
      regl(
        {
        frag: gaussian_blur,
        uniforms: {
          iResolution: ({viewportWidth, viewportHeight}) => [viewportWidth, viewportHeight],
          iChannel0: fbo1,
          direction
        },
        /* blend: {
          enable: true,
          func: {
            srcRGB: 'one',
            srcAlpha: 'one',
            dstRGB: 'one minus src alpha',
            dstAlpha: 'one minus src alpha',
          },
        }, */
        vert: `
          precision mediump float;
          attribute vec2 position;
          varying vec2 uv;
          void main() {
            uv = 0.5 * (position + 1.0);
            gl_Position = vec4(position, 0, 1);
          }`,
          attributes: {
            position: [ -4, -4, 4, -4, 0, 4 ]
          },
          depth: { enable: false },
          count: 3,
      })()
    })
  }

  blur(fbo1, fbo2, passes = 3) {
    let remaining = passes - 1
    while (remaining > -1) {
      this.single_blur_pass(fbo1, fbo2, [2 ** remaining, 0])
      this.single_blur_pass(fbo2, fbo1, [0, 2 ** remaining])
      remaining -= 1
    }
  }

  render_all(props) {

    const { regl } = this;
    this.fbos.points.use( () => {
      regl.clear({color: [0, 0, 0, 0]});
      this.render_points(props)
    })

    // this.blur(this.fbos.points, this.fbos.ping, 1)

    regl.clear({color: [0, 0, 0, 0]});


    // Copy the points buffer to the main buffer.
    regl({
      frag: `
        precision mediump float;
        varying vec2 uv;
        uniform sampler2D tex;
        uniform float wRcp, hRcp;
        void main() {
          gl_FragColor = texture2D(tex, uv);
        }
      `,
      vert: `
        precision mediump float;
        attribute vec2 position;
        varying vec2 uv;
        void main() {
          uv = 0.5 * (position + 1.0);
          gl_Position = vec4(position, 0, 1);
        }
      `,
      attributes: {
        position: [ -4, -4, 4, -4, 0, 4 ]
      },
      depth: { enable: false },
      count: 3,
      uniforms: {
        tex: () => this.fbos.points,
        wRcp: ({viewportWidth}) => 1.0 / viewportWidth,
        hRcp: ({viewportHeight}) => 1.0 / viewportHeight
      },
    })()
  }

  set_image_data(tile, ix) {
    // Stores a *single* image onto the texture.
    const { regl }  = this;

    this.initialize_sprites(tile)

    const { sprites, image_locations } = tile._regl_elements;
    const { current_position } = sprites
    if (current_position[1] > (4096 - 18*2)) {
      console.error(`First spritesheet overflow on ${tile.key}`)
      // Just move back to the beginning. Will cause all sorts of havoc.
      sprites.current_position = [0, 0]
      return
    }
//    if (sprites.lookup[ix]) {
//      return sprites.lookup[ix]
//    }

    if (!tile.table.get(ix)._jpeg) {
      return
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
    // ctx.strokeRect(x, y - font_size, width, font_size)
    x += w_
    ctx.position = [x, y]
    return lookups.get(word)
  }


  initialize_textures() {
    const { regl } = this;

      // RGBA color.

    this.aesthetic_maps = this.aesthetic_maps || {}

    for (let k of ["alpha", "color", "size",
                   "jitter_radius", "jitter_speed", "filter"]) {
      [this.aesthetic_maps[`${k}_old`],
       this.aesthetic_maps[k]] = this.aes[k].create_textures();
    }

    this.fbos = this.fbos || {}

    this.fbos.points =
      regl.framebuffer({
            width: this.width,
            height: this.height,
            depth: false      })

    this.fbos.ping =
      regl.framebuffer({
            width: this.width,
            height: this.height,
            depth: false
      })

    this.fbos.pong = regl.framebuffer({
            width: this.width,
            height: this.height,
            depth: false
      })

    this.fbos.contour = this.fbos.contour ||
      regl.framebuffer({
        width: this.width,
        height: this.height,
        depth: false
      })

    this.fbos.colorpicker = this.fbos.colorpicker  ||
      regl.framebuffer({
        width: this.width,
        height: this.height,
        depth: false
      })

    this.fbos.dummy = this.fbos.dummy  ||
      regl.framebuffer({
        width: 1,
        height: 1,
        depth: false
      })

  }

  n_visible(only_color = -1) {

    let {width, height} = this;
    width = Math.floor(width)
    height = Math.floor(height)
    this.contour_vals = this.contour_vals || new Uint8Array(4 * width * height)

    const props = this.props;
    props.only_color = only_color;
    let v;
    this.fbos.contour.use(() => {
      this.regl.clear({color: [0, 0, 0, 0]});
      // read onto the contour vals.
      this.render_points(props)
      this.regl.read(this.contour_vals);
      v = sum(this.contour_vals);
    })
    return v;
  }

  calculate_contours(field = 'lc0') {
    const {width, height} = this;
    let ix = 16;
    let contour_set = []
    const contour_machine = contours()
      .size([parseInt(width), parseInt(height)])
      .thresholds(d3.range(-1, 9).map(p => Math.pow(2, p*2)));

    for (let ix of range(this.tileSet.dictionary_lookups[field].size / 2)) {
      this.draw_contour_buffer(field, ix);
      // Rather than take the fourth element of each channel, I can use
      // a Uint32Array view of the data directly since rgb channels are all
      // zero. This just gives a view 256 * 256 * 256 larger than the actual numbers.
      const my_contours = contour_machine(this.contour_alpha_vals)
      console.log(sum(this.contour_alpha_vals))
      my_contours.forEach( (d) => {
        d.label = this.tileSet.dictionary_lookups[field].get(ix)
      })
      contour_set = contour_set.concat(my_contours)
    }
    return contour_set
  }

  color_pick(x, y) {
    const {props} = this;
    props.color_picker_mode = 1

    let v
    this.fbos.colorpicker.use(() => {
      this.regl.clear({color: [0, 0, 0, 0]});

      // read onto the contour vals.
      this.render_points(props)
      v = this.regl.read({x: x, y: y, width: 1, height: 1});
    })

    const inflated = v[0] + v[1] * 255 + v[2] * 255 * 255

  }

  /*blur(fbo) {
    var passes = [];
    var radii = [Math.round(
      Math.max(1, state.bloom.radius * pixelRatio / state.bloom.downsample))];
    for (var radius = nextPow2(radii[0]) / 2; radius >= 1; radius /= 2) {
      radii.push(radius);
    }
    radii.forEach(radius => {
      for (var pass = 0; pass < state.bloom.blur.passes; pass++) {
        passes.push({
          kernel: 13,
          src: bloomFbo[0],
          dst: bloomFbo[1],
          direction: [radius, 0]
        }, {
          kernel: 13,
          src: bloomFbo[1],
          dst: bloomFbo[0],
          direction: [0, radius]
        });
      }
    })
  }*/

  draw_contour_buffer(field, ix) {

    let {width, height} = this;
    width = Math.floor(width)
    height = Math.floor(height)

    this.contour_vals = this.contour_vals || new Uint8Array(4 * width * height)
    this.contour_alpha_vals = this.contour_alpha_vals || new Uint16Array(width * height)

    const props = this.props;
    props.prefs.encoding.color = {
      field: field
    }
    props.only_color = ix;

    this.fbos.contour.use(() => {
      this.regl.clear({color: [0, 0, 0, 0]});
      // read onto the contour vals.
      this.render_points(props)
      this.regl.read(this.contour_vals);
      console.log(
        this.contour_vals.filter(d => d != 0)
        .map(d => d/6).reduce((a,b) => a + b, 0)
      )
    })

    // 3-pass blur
    this.blur(this.fbos.contour, this.fbos.ping, 3)

    this.fbos.contour.use(() => {
      this.regl.read(this.contour_vals);
      console.log("blah")
      console.log(
        this.contour_vals.filter(d => d != 0)
        .map(d => d/6)
        .reduce((a, b) => a + b, 0)
      )
    })


    let i = 0;

    while (i < width * height * 4) {
      this.contour_alpha_vals[i/4] = this.contour_vals[i + 3] * 255;
      i += 4
    }
    return this.contour_alpha_vals
  }

  remake_renderer() {

    const { regl, width, height, zoom, prefs } = this;
    // This should be scoped somewhere to allow resizing.
    const [webgl_scale, untransform_matrix] =
    zoom.webgl_scale()

    const parameters = {
      depth: { enable: false },
      stencil: { enable: false },
      blend: {
        enable: true,
        func: {
          srcRGB: 'one',
          srcAlpha: 'one',
          dstRGB: 'one minus src alpha',
          dstAlpha: 'one minus src alpha',
        },
      },
      primitive: "points",
      frag: frag_shader,
      vert: vertex_shader,
      count: function(context, props) {
        return props.manager.count
      },
      attributes: {
        a_image_locations: {
          constant: [-1, -1]
        }
      },
      uniforms: {
        // Used to quickly count regions.
        u_only_color: function(context, props) {
          if (props.only_color !== undefined) {
            return props.only_color
          }
          // Use -2 to disable color plotting. -1 is a special
          // value to plot all.
          return -2
        },
        u_color_picker_mode: regl.prop("color_picker_mode"),
        u_aspect_ratio: width/height,
        u_sprites: function(context, props) {
          return props.sprites ?
          props.sprites : this.fbos.dummy
        },
        u_color_map: this.aesthetic_maps.color,
        u_alpha_map: this.aesthetic_maps.alpha,
        u_size_map: this.aesthetic_maps.size,
        u_jitter_radius_map: this.aesthetic_maps.jitter_radius,
        u_jitter_speed_map: this.aesthetic_maps.jitter_speed,
        u_filter_map: this.aesthetic_maps.filter,
        u_jitter: function(context, props) {
          if (props.prefs.jitter == "spiral") {
            // animated in a logarithmic spiral.
            return 1
          } else if (props.prefs.jitter == "uniform") {
            // Static jitter inside a circle
            return 2
          } else if (props.prefs.jitter == "normal") {
            // Static, normally distributed, standard deviation 1.
            return 3
          } else if (props.prefs.jitter == "circle") {
            // animated, evenly distributed in a circle with radius 1.
            return 4
          } else {
            return 0
          }
        },
        u_zoom_balance: regl.prop('zoom_balance'),
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
        }
      }
    }

    for (let k of ['ix', 'position']) {
      parameters.attributes[k] = function(state, props) {
        return props.manager.regl_elements.get(k)
      }
    }

    for (let k of ['color', 'label', 'jitter_radius',
                   'jitter_speed', 'size', 'alpha', 'filter'
                 ]) {
      const aesthetic = this.aes[k]
      parameters.uniforms["u_" + k + "_domain"] = function (state, props) {
        // wrap as function to clue regl that it might change.
        return aesthetic.get_domain()
      }
      parameters.uniforms[`u_${k}_transform`] = function(state, props) {
        const t = aesthetic.transform
        if (t == "linear") return 1
        if (t == "sqrt") return 2
        if (t == "log") return 3
        return 0
      }

      // Copy the parameters from the data name.
      parameters.attributes[`a_${k}`] = function(state, props) {

        if (props.prefs.encoding[k] === null ||
          aesthetic.field === undefined
        ) {
          return { constant: 1 }
        }
        if (typeof(props.prefs.encoding[k]) === "number") {
          return { constant: props.prefs.encoding[k] }
        }
        return props.manager.regl_elements.get(aesthetic.field)
      }
    }
    this._renderer = regl(parameters)
    return this._renderer
  }
}

class TileBufferManager {
  // Handle the interactions of a tile with a regl state.

  // binds elements directly to the tile, so it's safe
  // to re-run this multiple times on the same tile.
  constructor(regl, tile, renderer) {
    this.tile = tile;
    this.regl = regl;
    this.renderer = renderer;
    tile._regl_elements = tile._regl_elements || new Map()
    this.regl_elements = tile._regl_elements
  }

  ready(prefs) {
    const { renderer, regl_elements } = this;
    const keys = Object.entries(prefs.encoding)
    .map(([k, v]) => {
      if (!v) return false
      if (v.field) return v.field
      if (typeof(v) == "string") return v.split("=>").map(str => str.trim())[0]
      return false
    })
    .filter( d => d)
    for (let key of keys.concat(["position", "ix"])) {
      const current = this.regl_elements.get(key);

      if (current === null) {
        // It's in the process of being built.
        return false
      } else if (current === undefined) {
        if (!this.tile.ready) {
          // Can't build b/c no tile ready.
          return false
        }
        // Request that th buffer be created before returning false.
        regl_elements.set(key, null)
        renderer.deferred_functions.push(() => this.create_regl_buffer(key))
        return false
      }
    }
    return true
  }

  get count() {
    const { tile, regl_elements } = this;
    if (regl_elements.has("_count")) {
      return regl_elements.get("_count")
    }
    if (tile.ready) {
      regl_elements.set("_count", tile.table.length)
      return regl_elements.get("_count")
    }
  }

  create_position_buffer() {
    const { table } = this.tile
    const x = table.getColumn("x").data.values
    const y = table.getColumn("y").data.values
    const buffer = new Float32Array(this.count * 2)
    for (let i = 0; i < this.count; i += 1) {
        buffer[i*2] = x[i]
        buffer[i*2 + 1] = y[i]
    }
    return buffer
  }

  create_buffer_data(key) {
    const { tile } = this;
    if (!tile.ready) {
      throw "Tile table not present."
    }
    const column = tile.table.getColumn(key)

    if (key == "position") {
      return this.create_position_buffer()
    }
    if (column.dictionary) {
      const buffer = new Float32Array(tile.table.length)
      let row = 0;
      for (let val of column.data.values) {
        const char_value = tile.local_dictionary_lookups[key].get(val)
        buffer[row] = tile.dictionary_lookups[key].get(char_value)
        row += 1;
      }
      return buffer
    } else if (column.data.values.constructor != Float32Array) {
      const buffer = new Float32Array(tile.table.length)
      for (let i = 0; i < tile.table.length; i++) {
        buffer[i] = column.data.values[i]
      }
      return buffer
    } else {
      // For numeric data, it's safe to simply return the data straight up.
      return column.data.values
    }
  }

  create_regl_buffer(key) {
    const { regl, regl_elements } = this;

    const data = this.create_buffer_data(key)
    let item_size = 4
    let data_length = data.length

    if (key == "position") {
      item_size = 8
      data_length = data_length / 2
    }

    const buffer_desc = this.renderer.buffers.allocate_block(
      // Divided by four b/c always a float.
      data_length, item_size)

    regl_elements.set(
      key,
      buffer_desc
    )
    buffer_desc.buffer.subdata(data, buffer_desc.offset)
  }
}

class MultipurposeBufferSet {
  constructor(regl, buffer_size) {
    this.regl = regl
    this.buffer_size = buffer_size
    this.buffers = []
    // Track the ends in case we want to allocate smaller items.
    this.buffer_offsets = []
    this.generate_new_buffer()
  }

  generate_new_buffer() {
    // Adds to beginning of list.
    // console.log(`Creating buffer number ${this.buffers.length}`)
    if (this.pointer) {this.buffer_offsets.unshift(this.pointer)}
    this.pointer = 0
    this.buffers.unshift(
      this.regl.buffer({
        type: "float",
        length: this.buffer_size,
        usage: "dynamic"
      })
    )
  }

  allocate_block(items, bytes_per_item) {
    // Allocate a block of this buffer.
    // NB size is in **bytes**
    if (this.pointer + items * bytes_per_item > this.buffer_size) {
      // May lead to ragged ends. Could be smarter about reallocation here,
      // too.
      this.generate_new_buffer()
    }
    const value = {
      // First slot stores the active buffer.
      buffer: this.buffers[0],
      offset: this.pointer,
      stride: bytes_per_item
    }
    this.pointer += items * bytes_per_item
    return value
  }
}
