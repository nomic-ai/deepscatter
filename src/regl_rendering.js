import wrapREGL from 'regl';
import { select, create } from 'd3-selection';
import { range, sum, max } from 'd3-array';
import { rgb } from 'd3-color';
import { interpolatePuOr, interpolateViridis, interpolateWarm, interpolateCool } from 'd3-scale-chromatic';
import { Zoom, window_transform } from './interaction.js';
// import { aesthetic_variables } from './shaders';
import { Renderer } from './rendering.js';
import GLBench from 'gl-bench/dist/gl-bench';
import {contours} from 'd3-contour';
import gaussian_blur from './glsl/gaussian_blur.frag';
import vertex_shader from './glsl/general.vert';
import frag_shader from './glsl/general.frag';
import {easeSinInOut, easeCubicInOut} from 'd3-ease';
import unpackFloat from "glsl-read-float";
import { aesthetic_variables, AestheticSet } from './AestheticSet.js'

export class ReglRenderer extends Renderer {

constructor(selector, tileSet, scatterplot) {
  super(selector, tileSet, scatterplot)
  this.regl = wrapREGL(
    {
//      extensions: 'angle_instanced_arrays',
      optionalExtensions: ["OES_element_index_uint"],
      canvas: this.canvas.node(),
    }
  );

  /* BOILERPLATE */
  let gl = this.canvas.node().getContext('webgl') || this.canvas.node().getContext('experimental-webgl');

  const benchmark = false;
  if (benchmark) {
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
    }
  this.aes = new AestheticSet(scatterplot, this.regl, tileSet);

  // allocate buffers in 64 MB blocks.
  this.buffer_size = 1024 * 1024 * 64

  this.initialize_textures()
  // Not the right way, for sure.
  this._initializations = [
    // some things that need to be initialized before the renderer is loaded.
    this.tileSet
    .promise
    .then(() => {this.remake_renderer();
      this._webgl_scale_history = [this.default_webgl_scale, this.default_webgl_scale]
    })
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


apply_webgl_scale() {
  // Should probably be attached to AestheticSet, not to this class.

  // The webgl transform can either be 'literal', in which case it uses
  // the settings linked to the zoom pyramid, or semantic (linear, log, etc.)
  // in which case it has to calculate off of the x and y dimensions.

  this._use_scale_to_download_tiles = true;
  if (
    this.aes.encoding.x.transform && this.aes.encoding.x.transform != "literal" ||
    this.aes.encoding.y.transform && this.aes.encoding.y.transform != "literal"
  ) {

    const webglscale = window_transform(this.aes.x.scale, this.aes.y.scale).flat();
    this._webgl_scale_history.unshift(webglscale);
    this._use_scale_to_download_tiles = false;
  } else {
    // Use the default linked to the coordinates used to build the tree.
    this._webgl_scale_history.unshift(this.default_webgl_scale);
  }
}

get props() {
  const prefs = this.prefs
  const { transform } = this.zoom;
  const {k} = transform;
  const props = {
    // Copy the aesthetic as a string.
    aes: {"encoding": this.aes.encoding},
    colors_as_grid: 0,
    corners: this.zoom.current_corners(),
    zoom_balance: prefs.zoom_balance,
    transform: transform,
    max_ix: this.max_ix,
    time: (Date.now() - this.zoom._start)/1000,
    update_time: (Date.now() - this.most_recent_restart)/1000,
    string_index: 0,
    prefs: JSON.parse(JSON.stringify(prefs)),
    color_type: undefined,
    start_time: this.most_recent_restart,
    webgl_scale: this._webgl_scale_history[0],
    last_webgl_scale: this._webgl_scale_history[1],
    use_scale_for_tiles: this._use_scale_to_download_tiles,
    grid_mode: 0,
    color_picker_mode: 0 // whether to draw as a color picker.
  }
  props.zoom_matrix = [
    [props.transform.k, 0, props.transform.x],
    [0, props.transform.k, props.transform.y],
    [0, 0, 1],
  ].flat()

  // Clone.
  return JSON.parse(JSON.stringify(props))
}

get default_webgl_scale() {
  if (this._default_webgl_scale) {
    return this._default_webgl_scale
  } else {
    this._default_webgl_scale = this.zoom.webgl_scale()
    return this._default_webgl_scale
  }
}

render_points(props) {

  // Regl is faster if it can render a large number of draw calls together.
  let prop_list = [];
  for (let tile of this.visible_tiles()) {
    // Do the binding operation; returns truthy if it's already done.
    const manager = new TileBufferManager(this.regl, tile, this)
    try {
      if (!manager.ready(props.prefs, props.block_for_buffers)) {
        // The 'ready' call also pushes a creation request into
        // the deferred_functions queue.
        continue
      }
    } catch (err) {
      // console.warn(err)
      // throw "Dead"
      continue
    }

    const this_props = {
      manager: manager,
      image_locations: manager.image_locations,
      sprites: this.sprites,
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
  if (this._use_scale_to_download_tiles) {
    tileSet.download_to_depth(this.props.max_ix, this.zoom.current_corners())
  } else {
    tileSet.download_to_depth(prefs.max_points)
  }

  regl.clear({
    color: [0.9, 0.9, 0.93, 0],
    depth: 1
  });

  const start = Date.now()
  let current = () => undefined
  while (Date.now() - start < 10 && this.deferred_functions.length) {
    // Keep popping deferred functions off the queue until we've spent 10 milliseconds doing it.
    current = this.deferred_functions.shift()
    try {
      current()
    } catch (err) {
      console.warn(err, current)
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

  if (this.geolines) {
    this.fbos.lines.use( () => {
      regl.clear({color: [0, 0, 0, 0]});
      this.geolines.render(props)
    })
  }
  if (this.geo_polygons.length) {
    this.fbos.lines.use( () => {
      regl.clear({color: [0, 0, 0, 0]});
      for (let handler of this.geo_polygons) {
        handler.render(props)
      }
    })
  }

  // this.blur(this.fbos.points, this.fbos.ping, 1)

  regl.clear({color: [0, 0, 0, 0]});


  // Copy the points buffer to the main buffer.
  for (let layer of [this.fbos.lines, this.fbos.points]) {
    regl({
      blend: {
        enable: true,
        func: {
          srcRGB: 'one',
          srcAlpha: 'one',
          dstRGB: 'one minus src alpha',
          dstAlpha: 'one minus src alpha',
        }
      },

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
        tex: () => layer,
        wRcp: ({viewportWidth}) => 1.0 / viewportWidth,
        hRcp: ({viewportHeight}) => 1.0 / viewportHeight
      },
    })()
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

  for (let k of aesthetic_variables) {
    console.log(k)
    const v = this.aes[k]

    v.current.create_textures()
    v.last.create_textures()
/*      [this.aesthetic_maps[`last_${k}`],
     this.aesthetic_maps[k]] = this.aes[k].create_textures();*/
  }

  this.fbos = this.fbos || {}

  this.fbos.minicounter =
    regl.framebuffer({
      width: 512,
      height: 512,
      depth: false
    })

  this.fbos.lines =
    regl.framebuffer({
      //type: 'half float',
      width: this.width,
      height: this.height,
      depth: false
    })

  this.fbos.points =
    regl.framebuffer({
      //type: 'half float',
      width: this.width,
      height: this.height,
      depth: false
    })

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

counter(x_field) {



}


plot_as_grid(x_field, y_field, buffer = this.fbos.minicounter) {
  const {scatterplot, regl, tileSet} = this.aes;

  const saved_aes = this.aes;

  if (buffer === undefined) {
    // Mock up dummy syntax to use the main draw buffer.
    buffer = {
      width: this.width,
      height: this.height,
      use: f => f()
    }
  }

  const { width, height } = buffer;

  this.aes = new AestheticSet(scatterplot, regl, tileSet);

  const x_length = map._root.table.getColumn(x_field).data.dictionary.length

  let stride = 1;

  let nearest_pow_2 = 1;
  while (nearest_pow_2 < x_length) {
    nearest_pow_2 *= 2
  }

  const encoding = {
    x: {
      field: x_field,
      transform: "linear",
      domain: [-2047, -2047 + nearest_pow_2]
    },
    y: y_field !== undefined ? {
      field : y_field,
      transform : "linear",
      domain: [-2047, -2020]

    } : {constant : -1},
    alpha: 1/255 * 10,
    size: 33,
    color: {
      constant: [0, 0, 0],
      transform: "literal"
    },
    jitter_radius: 1/256 * 10, // maps to x jitter
    jitter_speed: y_field === undefined ? 1 : 1/256 // maps to y jitter
  }
  console.log(`map.plotAPI({encoding: ${JSON.stringify(encoding)}})`)
  // Twice to overwrite the defaults and avoid interpolation.
  this.aes.apply_encoding(encoding)
  this.aes.apply_encoding(encoding)
  this.aes.x[1] = saved_aes.x[0]
  this.aes.y[1] = saved_aes.y[0]
  this.aes.filter = saved_aes.filter

  const props = this.props
  props.block_for_buffers = true;
  props.grid_mode = 1;
  props.prefs.jitter = false


  const minilist = new Uint8Array(width * height * 4);

  buffer.use( () => {
    this.regl.clear({color: [0, 0, 0, 0]});
    this.render_points(props)
    regl.read({data: minilist})
  })
  // Then revert back.
  this.aes = saved_aes
}

count_colors(field) {
  const { regl, props } = this;
  props.prefs.jitter = null;
  if (field !== undefined) {
    console.warn("PROBABLY BROKEN BECAUSE OF THE NEW AES", field, props.prefs, field)
    props.aes.encoding.color = {
      field: field,
      domain: [-2047, 2047],
      // range: "shufbow"
    }
  } else {
    field = this.aes.color.field
  }

  props.only_color = -1;
  props.prefs.jitter = null;
  props.prefs.last_jitter = null;
  props.colors_as_grid = 1.0;
  props.block_for_buffers = true;

  const { width, height } = this.fbos.minicounter
  const minilist = new Uint8Array(width * height * 4);
  const counts = new Map()
  this.fbos.minicounter.use(() => {
    regl.clear({color: [0, 0, 0, 0]});
    this.render_points(props)
    regl.read(
      {data: minilist}
    )
  })
  console.log(minilist)
  for (const [k, v] of this.tileSet.dictionary_lookups[field]) {
    if (typeof(k)=="string") {continue}
    const col = Math.floor(k/64);
    const row = (k % 64);
    const step = width/64
    let score = 0;
    let overflown = false;
    for (let j of range(step)) {
      for (let i of range(step)) {
        const value = minilist[
          col * step * 4 + i * 4 + //column
          row * step * 4 * width + j*width*4 + //row
          3];
        // Can't be sure that we've got precision up above half precision.
        // So for factors with > 128 items, count them manually.
        if (value >= 128) {
          overflown = true
          continue
        }
        score += value;
      }
    }
    if (!overflown) {
      // The cells might be filled up at 128;
      counts.set(v, score)
    } else {
      console.log(k, v, "overflown, performing manually")
      counts.set(v, this.n_visible(k))
    }
//        console.log(k, v, col, row, score)
  }
  return counts;
}

n_visible(only_color = -1) {
  /*const backup_aes = this.aesthetic;
  const {scatterplot, regl, tileSet} = this.aesthetic;
  this.aesthetic = new AestheticSet(scatterplot, regl, tileSets)

  this.aesthetic.filter = backup_aes.aesthetic.filter;
  const local_aes = {
    size: {constant: 1},
    color: {constant: [0, 0, 0, 1/255]},

  }

  this.aesthetic.update
  */
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
//    console.log(sum(this.contour_alpha_vals))
    my_contours.forEach( (d) => {
      d.label = this.tileSet.dictionary_lookups[field].get(ix)
    })
    contour_set = contour_set.concat(my_contours)
  }
  return contour_set
}

color_pick(x, y, verbose = false) {

  const {props, height} = this;

  props.color_picker_mode = 1

  let color_at_point;

  this.fbos.colorpicker.use(() => {
    this.regl.clear({color: [0, 0, 0, 0]});

    // read onto the contour vals.
    this.render_points(props)
    // Must be flipped
    color_at_point = this.regl.read({x: x, y: height - y, width: 1, height: 1});
  })

  const float = unpackFloat(...color_at_point)

  const p = this.tileSet.findPoint(float);

  if (p.length==0) {return undefined}

  return p[0];
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

  props.aes.encoding.color = {
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
    //console.log("blah")
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

  const parameters = {
    depth: { enable: false },
    stencil: { enable: false },
    blend: {
      enable: function(state, {color_picker_mode}) {return color_picker_mode < 0.5},
      func: {
        srcRGB: 'one',
        srcAlpha: 'one',
        dstRGB: 'one minus src alpha',
        dstAlpha: 'one minus src alpha',
      }
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
      u_update_time: regl.prop('update_time'),
      u_transition_duration: function(context, props) {
        //const fraction = (props.time)/props.prefs.duration;
        return props.prefs.duration;
      },
      u_only_color: function(context, props) {
        if (props.only_color !== undefined) {
          return props.only_color
        }
        // Use -2 to disable color plotting. -1 is a special
        // value to plot all.
        return -2
      },
      u_color_picker_mode: regl.prop("color_picker_mode"),
      u_position_interpolation_mode: function(context, props) {
        // 1 indicates that there should be a continuous loop between the two points.
        if (this.aes.position_interpolation) {
          return 1
        }
        return 0
      },
      /*
      u_corners: (context, props) => [
        props.corners.x[0],
        props.corners.x[1],
        props.corners.y[0],
        props.corners.y[1]
      ],*/
      u_grid_mode: (_, {grid_mode}) => grid_mode,
      u_colors_as_grid: regl.prop("colors_as_grid"),
      u_constant_color: function(context, props) {
        return this.aes.color.current.constant !== undefined ?
        this.aes.color.current.constant:
        [-1, -1, -1]
      },
      u_constant_last_color: function(context, props) {
        return this.aes.color.last.constant != undefined ?
        this.aes.color.last.constant:
        [-1, -1, -1]
      },
      u_width: ({viewportWidth}) => viewportWidth,
      u_height: ({viewportHeight}) => viewportHeight,
      u_aspect_ratio: ({viewportWidth, viewportHeight}) => viewportWidth/viewportHeight,
      u_sprites: function(context, props) {
        return props.sprites ?
        props.sprites : this.fbos.dummy
      },
      u_last_jitter: function (context, props) {
        return encode_jitter_to_int(props.prefs.last_jitter);
      },
      u_jitter: function(context, props) {
        return encode_jitter_to_int(props.prefs.jitter);
      },
      u_zoom_balance: regl.prop('zoom_balance'),
      u_maxix: function(context, props) {
        return props.max_ix;
      },
      u_k: function(context, props) {
        return props.transform.k;
      },
      u_window_scale: regl.prop('webgl_scale'),
      u_last_window_scale: regl.prop('last_webgl_scale'),
      u_time: function(context, props) {
        return props.time;
      },

      u_filter_numeric: function(context, props) {
        return this.aes.filter.current.ops_to_array()
      },

      u_filter_last_numeric: function(context, props) {
        return this.aes.filter.last.ops_to_array()
      },

      u_zoom: function(context, props) {
        return props.zoom_matrix;
      }
    }
  }
  for (let k of ['ix']) {
    parameters.attributes[k] = function(state, props) {
      return props.manager.regl_elements.get(k)
    }
  }

  for (let k of ['x', 'y', 'color', 'jitter_radius',
                 'jitter_speed', 'size', 'alpha', 'filter'
               ]) {

//    const aes = this.aes[k]

    for (let time of ["current", "last"]) {
      const temporal = time == "current" ? "" : "last_";

      parameters.uniforms[`u_${temporal}${k}_map`] = () => {
        return this.aes[k][time].textures[1]
      }

      if (k == 'filter' && temporal == 'last') {
        // Don't track the previous filter; not enough slots in webgl.
        continue
      }

      parameters.uniforms[`u_${temporal}${k}_needs_map`] =
      (state, props) => {
        // Currently, a texture lookup is only used for dictionaries.
        return this.aes[k][time].use_map_on_regl
      }

      parameters.uniforms["u_" + temporal + k + "_domain"] = (state, props) => {
        // wrap as function to clue regl that it might change.
        if (k === "size") {return [1, 1]}
        return this.aes[k][time].domain
      }

      if (k != "filter" && k != "color") {
        parameters.uniforms["u_" + temporal + k + "_range"] =
          (state, props) => {
          // wrap as function to clue regl that it might change.
          // console.log(k, aesthetic[temporal + "range"])
          return this.aes[k][time].range
        }
      }

      parameters.uniforms[`u_${temporal}${k}_transform`] = (state, props) => {
        const t = this.aes[k][time].transform
        if (t == "linear") return 1
        if (t == "sqrt") return 2
        if (t == "log") return 3
        if (t == "literal") return 4
        throw "Invalid transform"
      }

      parameters.attributes[`a_${temporal}${k}`] = (state, props) => {

        /*if (props.only_color > -2) {
          return props.manager.regl_elements.get(
            this.aes.encoding.color.field)
        }*/

        const val = this.aes[k][time].field
        const regl_buffer = props.manager.regl_elements.get(val)
        //console.log(props.manager.regl_elements.get(val))
        if (regl_buffer) {
            return regl_buffer
        } else if (this.aes[k][time].constant !== undefined) {
          //console.log([...props.manager.regl_elements.keys()])
          //console.log(aesthetic[temporal + "constant"], "constant", k)
          return {constant: this.aes[k][time].constant}
        } else if (this.aes[k][time]) {
          return {constant: this.aes[k][time].default_val}
        }
        // return {constant: 1}
        throw `No defined field for ${temporal}${k}`
    }



    }



    // Copy the parameters from the data name.
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

ready(prefs, block_for_buffers = false) {
  const { renderer, regl_elements } = this;
  const { aes } = renderer;
  if (! aes.is_aesthetic_set) {
    throw "Aesthetic must be an aesthetic set"
  }
  let keys = [...Object.entries(aes)]
  keys = keys
  .map(([k, v]) => {

    if (aesthetic_variables.indexOf(k) == -1) {
      return []
    }

//      if (k === undefined) {return}
    const needed = [];
    for (let aes of [v.current, v.last]) {
//      if (!v || v === undefined) return needed;
      if (aes.field) needed.push(aes.field);
    }
    return needed
  })
  .flat()

  for (let key of keys.concat(["ix"])) {
    const current = this.regl_elements.get(key);

    if (current === null) {
      // It's in the process of being built.
      return false
    } else if (current === undefined) {
      if (!this.tile.ready) {
        // Can't build b/c no tile ready.
        return false
      }
      // Request that the buffer be created before returning false.
      regl_elements.set(key, null)
      if (block_for_buffers) {
        this.create_regl_buffer(key)
      } else {
        renderer.deferred_functions.push(() => this.create_regl_buffer(key))
        return false
      }

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
  const column = tile.table.getColumn(key + "_dict_index") || tile.table.getColumn(key)
  if (key == "position") {
    console.warn("CREATING POSITION BUFFER (DEPRECATED)")
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

  const buffer_desc = this.renderer.buffers.allocate_block(
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


function encode_jitter_to_int(jitter) {
if (jitter == "spiral") {
  // animated in a logarithmic spiral.
  return 1
} else if (jitter == "uniform") {
  // Static jitter inside a circle
  return 2
} else if (jitter == "normal") {
  // Static, normally distributed, standard deviation 1.
  return 3
} else if (jitter == "circle") {
  // animated, evenly distributed in a circle with radius 1.
  return 4
} else {
  return 0
}
}
