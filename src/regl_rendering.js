import wrapREGL from 'regl';
import { select, create } from 'd3-selection';
import { range, sum, shuffle } from 'd3-array';
import { rgb } from 'd3-color';
import { interpolatePuOr, interpolateViridis, interpolateWarm, interpolateCool } from 'd3-scale-chromatic';
import { Zoom } from './interaction.js';
import { vertex_shader, frag_shader } from './shaders.glsl';
import { Renderer } from './rendering.js';
import GLBench from 'gl-bench/dist/gl-bench';

let tiles_allocated = 0;

export class ReglRenderer extends Renderer {

  constructor(selector, tileSet, prefs, parent) {
    super(selector, tileSet, prefs, parent)
    this.regl = wrapREGL(this.canvas.node());
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

    /*
    this.thresh = this.thresh || .1
    this.thresh += 0.0005
    if (this.thresh > 1) {this.thresh = 0.01}

    const my_data = new Uint8Array(range(256).map(i =>{
      const frac = i/255;
      return (Math.abs(this.thresh - frac) < 0.1) ? 255 : 0
    }))
    this.alpha_map.subimage({
      width: 1,
      height: 256,
      data: my_data
    }, 0, 0)
    */

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
      prefs: prefs,
      colormap: this.niccoli_rainbow//viridis256
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
      this.set_full_image(tile, props.max_ix)

      n_visible += 1;
      if ((tile.min_ix) < (props.max_ix * prefs.label_threshold)) {
        //
      }
      const this_props = {
        count: tile._regl_elements.count,
        data: tile._regl_elements.data,
        visibility: tile._regl_elements.visibility,
        image_locations: tile._regl_elements.image_locations,
        sprites: this.sprites
      }
      Object.assign(this_props, props)
      //prop_list.push(this_props)
      this._renderer(this_props);
    }
    //console.log(this)
    //console.log(this._renderer)
    if (this._renderer === undefined) {
      if (this._zoom && this._zoom._timer) {
        this._zoom._timer.stop()
      }
      return
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

      // DEBOUNCING
      this.last_renderer_build_time = this.last_renderer_build_time || 0;
      let BUFFER_THROTTLE = 1/50 * 1000;
      if (Date.now() - this.last_renderer_build_time < BUFFER_THROTTLE) {
        return
      }
      this.last_renderer_build_time = Date.now()

      if (!tile.underway_promises.has(!"regl")) {
        tile.underway_promises.add("regl")
        Promise.all([tile.buffer(), tile.dataTypes()])
        .then(([buffer, datatypes]) => {
          tile._regl_elements = this.make_elements(buffer, datatypes);
          delete tile._buffer
        })
      }
      // It's underway, but there's nothing to do until it gets here.
      return undefined
    }
  }

  initialize_sprites(tile) {

    const { regl }  = this;
    tile._regl_elements.sprites = tile._regl_elements.sprites || this.sprites
    tile._regl_elements.sprites.lookup = tile._regl_elements.sprites.lookup || {};
    tile._regl_elements.sprites.current_position = tile._regl_elements.sprites.current_position || [0, 0]

  }

  set_full_image(tile, maxix) {
    return
    if (!tile._data[0].img_alpha) {
      return
    }
    if (tile._image_set_until === undefined) {
      tile._image_set_until = 0;
    }
    for (let i = tile._image_set_until; i < tile._data.length && i < maxix; i++) {
      this.set_image_data(tile, i)
      tile._image_set_until = i;
    }

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

    const image_alpha = tile._data[ix].img_alpha;
    const image_width = tile._data[ix].img_width;
    const alpha_array =
       Uint8Array.from(atob(image_alpha), c => c.charCodeAt(0))

    const image_height = alpha_array.length/image_width;


    sprites.subimage({
      width: image_width,
      height: image_height,
      data: alpha_array
    }, current_position[0], current_position[1])

    image_locations.subdata(
        [current_position[0] * 4096 + current_position[1]
        , image_width * 4096 + image_height]
        , ix * 8
    )

    current_position[0] += 28;
    if (current_position[0] > 4096 - 28) {
      current_position[1] += 28
      current_position[0] = 0
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

    const viridis = range(256).map(i => {
      const p = rgb(interpolateViridis(1 - i/255));
      return [p.r, p.g, p.b, p.opacity * 255]
    });

    const niccoli_rainbow = range(1024).map(i => {
      let p;
      if (i < 512) {
        p = interpolateWarm(i/511)
      } else {
        p = interpolateCool((512 - (i - 512))/511)
      }
      p = rgb(p);
      return [p.r, p.g, p.b, p.opacity * 255]
    })

    const shufbow = shuffle([...niccoli_rainbow])

    this.alpha_map = regl
      .texture({
        width: 8,
        height: 256,
        type: 'uint8',
        format: 'alpha',
        data: new Uint8Array(Array(8*256).fill(255))
      })

    this.viridis256 = regl.texture([viridis])
    this.niccoli_rainbow = regl.texture([niccoli_rainbow])
    this.shufbow = regl.texture([shufbow])

    this.year = regl.texture({shape: [1024, 32] })


    this.sprites = regl.texture({
        width: 4096,
        height: 4096,
        format: 'alpha',
        type: 'uint8',
      })
    //this.sprites.subimage({
  //    width: 4096, height: 4096, data: new Array(4096*4096).fill(25)})

  }

  make_elements(points, datatypes) {
//    console.log(`building buffer for tile ${tiles_allocated++}`)
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
      'image_locations': regl.buffer({
        'usage': 'dynamic',
        data: new Array(points.length * 2).fill(0),
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
        },
        a_image_locations: {
          buffer: regl.prop('image_locations'),
          offset: 0,
          stride: 8,
        }
      },

      uniforms: {
        u_aspect_ratio: width/height,
        u_sprites: function(context, props) {
          return props.sprites
        },
        u_colormap: function(context, props) {
          return props.colormap
        },
        u_alphamap: this.alpha_map,
        u_alpha_domain: function(context, props) {
          return props.prefs.alpha_domain
        },
          /* u_color_domain: function(context, props) {
          // return props._scales.color.domain()
          console.log("DOMAIN", props.prefs.color_domain)
          return props.prefs.color_domain
        },*/
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
          } else if (props.prefs.jitter == "circle") {
            return 4
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
      parameters.attributes[k] = function(state, props) {
        return {
          buffer: props.data,
          offset: datatypes[k].offset,
          stride: datatypes[k].stride
        }
      }
    }


    for (let k of ['color', 'label',
                   'jitter_radius', 'jitter_period', 'size',
                    'alpha']) { //, 'a_size', 'a_time', 'a_opacity', 'a_text']) {

      parameters.uniforms["u_" + k + "_domain"] = function (state, props) {
        if (k === 'color' && props.colormap._texture.width == 1024) {
          // 1024 dimensional textures are used only for categorical data.
          // (This is a convention--remember it!)
          // If so, the domain needs to align precisely.
          return [0, 1023]
        }
        return this.prefs[`${k}_domain`] || [1, 1]
      }
      // Copy the parameters from the data name.

      parameters.attributes[`a_${k}`] = function(state, props) {
        return {
          buffer : props.data,
          offset :
            // console.log(`${k}_field`, props.prefs[`${k}_field`])
            props.prefs[`${k}_field`] ? datatypes[props.prefs[`${k}_field`]].offset : datatypes['ix'].offset,
          stride :
            props.prefs[`${k}_field`] ? datatypes[props.prefs[`${k}_field`]].stride : datatypes['ix'].stride

        }
      }
    }
    this._renderer = regl(parameters)
    return this._renderer
  }

}
