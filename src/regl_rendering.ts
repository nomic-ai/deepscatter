/* eslint-disable no-underscore-dangle */
import wrapREGL, { Framebuffer2D, Regl, Texture2D, Buffer } from 'regl';
import { range, sum } from 'd3-array';
// import { contours } from 'd3-contour';
import unpackFloat from 'glsl-read-float';
import Zoom from './interaction';
import { Renderer } from './rendering';
import gaussian_blur from './glsl/gaussian_blur.frag';
import vertex_shader from './glsl/general.vert';
import frag_shader from './glsl/general.frag';
import { AestheticSet } from './AestheticSet';
import { rgb } from 'd3-color';

import type { Tile } from './tile';
import REGL from 'regl';
import { Dataset } from './Dataset';
import { Frame } from '@playwright/test';
import Scatterplot from './deepscatter';

// eslint-disable-next-line import/prefer-default-export
export class ReglRenderer<T extends Tile> extends Renderer {
  public regl: Regl;
  public aes: AestheticSet;
  public buffer_size = 1024 * 1024 * 64;
  private _buffers: MultipurposeBufferSet;
  public _initializations: Promise<void>[];
  public tileSet: Dataset<T>;
  public zoom?: Zoom;
  public _zoom?: Zoom;
  public _start: number;
  public most_recent_restart?: number;
  public _default_webgl_scale?: number[];
  public _webgl_scale_history?: [number[], number[]];
  public _renderer?: Regl;
  public _use_scale_to_download_tiles = true;
  public sprites?: d3.Selection<SVGElement, any, any, any>;
  public fbos: Record<string, Framebuffer2D> = {};
  public textures: Record<string, Texture2D> = {};
  public _fill_buffer?: Buffer;
  public contour_vals?: Uint8Array;
  //  public contour_alpha_vals : Float32Array | Uint8Array | Uint16Array;
  //  public contour_vals : Uint8Array;
  public tick_num?: number;
  public reglframe?: REGL.FrameCallback;
  //  public _renderer :  Renderer;

  constructor(selector, tileSet: Dataset<T>, scatterplot: Scatterplot) {
    super(selector, tileSet, scatterplot);
    const c = this.canvas;
    if (this.canvas === undefined) {
      throw new Error('No canvas found');
    }

    this.regl = wrapREGL({
      //      extensions: 'angle_instanced_arrays',
      optionalExtensions: [
        'OES_standard_derivatives',
        'OES_element_index_uint',
        'OES_texture_float',
        'OES_texture_half_float',
      ],
      canvas: c,
    });
    this.tileSet = tileSet;

    this.aes = new AestheticSet(scatterplot, this.regl, tileSet);

    // allocate buffers in 64 MB blocks.
    this.initialize_textures();

    // Not the right way, for sure.
    this._initializations = [
      // some things that need to be initialized before the renderer is loaded.
      this.tileSet.promise.then(() => {
        this.remake_renderer();
        this._webgl_scale_history = [
          this.default_webgl_scale,
          this.default_webgl_scale,
        ];
      }),
    ];
    this.initialize();
    this._buffers = new MultipurposeBufferSet(this.regl, this.buffer_size);
  }

  get buffers() {
    this._buffers =
      this._buffers || new MultipurposeBufferSet(this.regl, this.buffer_size);
    return this._buffers;
  }

  data(dataset) {
    if (dataset === undefined) {
      // throw
      return this.tileSet;
    }
    this.tileSet = dataset;
    return this;
  }

  /* 
  apply_webgl_scale() {
  // Should probably be attached to AestheticSet, not to this class.

  // The webgl transform can either be 'literal', in which case it uses
  // the settings linked to the zoom pyramid, or semantic (linear, log, etc.)
  // in which case it has to calculate off of the x and y dimensions.

    this._use_scale_to_download_tiles = true;
    if (
      (this.aes.encoding.x.transform && this.aes.encoding.x.transform !== 'literal')
    || (this.aes.encoding.y.transform && this.aes.encoding.y.transform !== 'literal')
    ) {
      const webglscale = window_transform(this.aes.x.scale, this.aes.y.scale).flat();
      this._webgl_scale_history.unshift(webglscale);
      this._use_scale_to_download_tiles = false;
    } else {
      if (!this._webgl_scale_history) {
        this._webgl_scale_history = [];
      }
      // Use the default linked to the coordinates used to build the tree.
      this._webgl_scale_history.unshift(this.default_webgl_scale);
    }
  }
  */

  get props() {
    // Stuff needed for regl.

    // Would be better cached per draw call.
    this.allocate_aesthetic_buffers();
    const {
      prefs,
      aes_to_buffer_num,
      buffer_num_to_variable,
      variable_to_buffer_num,
    } = this;
    const { transform } = this.zoom as Zoom;
    const props = {
      // Copy the aesthetic as a string.
      aes: { encoding: this.aes.encoding },
      colors_as_grid: 0,
      corners: this.zoom!.current_corners(),
      zoom_balance: prefs.zoom_balance,
      transform,
      max_ix: this.max_ix,
      point_size: this.point_size,
      alpha: this.optimal_alpha,
      time: Date.now() - this.zoom!._start,
      update_time: Date.now() - this.most_recent_restart,
      relative_time: (Date.now() - this.most_recent_restart) / prefs.duration,
      string_index: 0,
      prefs: JSON.parse(JSON.stringify(prefs)),
      color_type: undefined,
      start_time: this.most_recent_restart,
      webgl_scale: this._webgl_scale_history[0],
      last_webgl_scale: this._webgl_scale_history[1],
      use_scale_for_tiles: this._use_scale_to_download_tiles,
      grid_mode: 0,
      buffer_num_to_variable,
      aes_to_buffer_num,
      variable_to_buffer_num,
      color_picker_mode: 0, // whether to draw as a color picker.
      zoom_matrix: [
        [transform.k, 0, transform.x],
        [0, transform.k, transform.y],
        [0, 0, 1],
      ].flat(),
    };

    // Clone.
    return JSON.parse(JSON.stringify(props));
  }

  get default_webgl_scale() {
    if (this._default_webgl_scale) {
      return this._default_webgl_scale;
    }
    this._default_webgl_scale = this.zoom.webgl_scale();
    return this._default_webgl_scale;
  }

  render_points(props) {
    // Regl is faster if it can render a large number of draw calls together.
    const prop_list = [];

    let call_no = 0;
    const needs_background_pass =
      (this.aes.store.foreground.states[0].active as boolean) ||
      (this.aes.store.foreground.states[1].active as boolean);
    for (const tile of this.visible_tiles()) {
      // Do the binding operation; returns truthy if it's already done.
      const manager = new TileBufferManager(this.regl, tile, this);
      if (!manager.ready(props.prefs, props.block_for_buffers)) {
        // The 'ready' call also pushes a creation request into
        // the deferred_functions queue.
        continue;
      }
      const this_props = {
        manager,
        number: call_no++,
        foreground: needs_background_pass ? 1 : -1,
        tile_id: tile.numeric_id,
        sprites: this.sprites,
      };
      Object.assign(this_props, props);
      prop_list.push(this_props);
      if (needs_background_pass) {
        const background_props = { ...this_props, foreground: 0 };
        prop_list.push(background_props);
      }
    }
    // Plot background first, and lower tiles before higher tiles.
    prop_list.sort((a, b) => {
      return (
        (3 + a.foreground) * 1000 -
        (3 + b.foreground) * 1000 +
        b.number -
        a.number
      );
    });
    this._renderer(prop_list);
  }

  tick() {
    const { prefs } = this;
    const { regl, tileSet } = this;
    const { props } = this;
    this.tick_num = this.tick_num || 0;
    this.tick_num++;

    // Set a download call in motion.
    if (this._use_scale_to_download_tiles) {
      tileSet.download_most_needed_tiles(
        this.zoom.current_corners(),
        this.props.max_ix,
        5
      );
    } else {
      tileSet.download_most_needed_tiles(prefs.max_points, this.max_ix, 5);
    }
    regl.clear({
      color: [0.9, 0.9, 0.93, 0],
      depth: 1,
    });
    const start = Date.now();
    while (Date.now() - start < 10 && this.deferred_functions.length > 0) {
      // Keep popping deferred functions off the queue until we've spent 10 milliseconds doing it.
      const current = this.deferred_functions.shift();
      if (current === undefined) {
        continue;
      }
      try {
        current();
      } catch (error) {
        console.warn(error, current);
      }
    }
    try {
      this.render_all(props);
    } catch (error) {
      console.warn('ERROR NOTED');
      this.reglframe.cancel();
      throw error;
    }
  }

  single_blur_pass(
    fbo1: Framebuffer2D,
    fbo2: Framebuffer2D,
    direction: [number, number]
  ) {
    const { regl } = this;
    fbo2.use(() => {
      regl.clear({ color: [0, 0, 0, 0] });
      regl({
        frag: gaussian_blur,
        uniforms: {
          iResolution: ({ viewportWidth, viewportHeight }) => [
            viewportWidth,
            viewportHeight,
          ],
          iChannel0: fbo1,
          direction,
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
          position: [-4, -4, 4, -4, 0, 4],
        },
        depth: { enable: false },
        count: 3,
      })();
    });
  }

  blur(fbo1: Framebuffer2D, fbo2: Framebuffer2D, passes = 3) {
    let remaining = passes - 1;
    while (remaining > -1) {
      this.single_blur_pass(fbo1, fbo2, [2 ** remaining, 0]);
      this.single_blur_pass(fbo2, fbo1, [0, 2 ** remaining]);
      remaining -= 1;
    }
  }

  render_all(props) {
    const { regl } = this;

    this.fbos.points.use(() => {
      regl.clear({ color: [0, 0, 0, 0] });
      this.render_points(props);
    });
    /*
    if (this.geolines) {
      this.fbos.lines.use(() => {
        regl.clear({ color: [0, 0, 0, 0] });
        this.geolines.render(props);
      });
    }

    if (this.geo_polygons && this.geo_polygons.length) {
      this.fbos.lines.use(() => {
        regl.clear({ color: [0, 0, 0, 0] });
        for (const handler of this.geo_polygons) {
          handler.render(props);
        }
      });
    }
    */
    regl.clear({ color: [0, 0, 0, 0] });

    this.fbos.lines.use(() => regl.clear({ color: [0, 0, 0, 0] }));
    //@ts-ignore
    if (this.scatterplot.trimap) {
      // Allows binding a TriMap from `trifeather` object to the regl package without any import.
      // This is the best way to do it that I can think of for now.
      this.fbos.lines.use(() => {
        //@ts-ignore
        this.scatterplot.trimap.zoom = this.zoom;
        //@ts-ignore
        this.scatterplot.trimap.tick('polygon');
      });
    }
    // Copy the points buffer to the main buffer.

    for (const layer of [this.fbos.lines, this.fbos.points]) {
      regl({
        profile: true,
        blend: {
          enable: true,
          func: {
            srcRGB: 'one',
            srcAlpha: 'one',
            dstRGB: 'one minus src alpha',
            dstAlpha: 'one minus src alpha',
          },
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
          gl_Position = vec4(position, 0., 1.);
        }
      `,
        attributes: {
          position: this.fill_buffer,
        },
        depth: { enable: false },
        count: 3,
        uniforms: {
          tex: () => layer,
          wRcp: ({ viewportWidth }) => 1 / viewportWidth,
          hRcp: ({ viewportHeight }) => 1 / viewportHeight,
        },
      })();
    }
  }

  /*
  set_image_data(tile, ix) {
  // Stores a *single* image onto the texture.
    const { regl } = this;

    this.initialize_sprites(tile);

    //    const { sprites, image_locations } = tile._regl_elements;
    const { current_position } = sprites;
    if (current_position[1] > (4096 - 18 * 2)) {
      console.error(`First spritesheet overflow on ${tile.key}`);
      // Just move back to the beginning. Will cause all sorts of havoc.
      sprites.current_position = [0, 0];
      return;
    }
    if (!tile.table.get(ix)._jpeg) {

    }
  }
  */
  /*
  spritesheet_setter(word) {
  // Set if not there.
    let ctx = 0;
    if (!this.spritesheet) {
      const offscreen = create('canvas')
        .attr('width', 4096)
        .attr('width', 4096)
        .style('display', 'none');

      ctx = offscreen.node().getContext('2d');
      const font_size = 32;
      ctx.font = `${font_size}px Times New Roman`;
      ctx.fillStyle = 'black';
      ctx.lookups = new Map();
      ctx.position = [0, font_size - font_size / 4.0];
      this.spritesheet = ctx;
    } else {
      ctx = this.spritesheet;
    }
    let [x, y] = ctx.position;

    if (ctx.lookups.get(word)) {
      return ctx.lookups.get(word);
    }
    const w_ = ctx.measureText(word).width;
    if (w_ > 4096) {
      return;
    }
    if ((x + w_) > 4096) {
      x = 0;
      y += font_size;
    }
    ctx.fillText(word, x, y);
    lookups.set(word, { x, y, width: w_ });
    // ctx.strokeRect(x, y - font_size, width, font_size)
    x += w_;
    ctx.position = [x, y];
    return lookups.get(word);
  }
  */
  initialize_textures() {
    const { regl } = this;
    this.fbos = this.fbos || {};
    this.textures = this.textures || {};
    this.textures.empty_texture = regl.texture(
      range(128).map((d) => range(128).map((d) => [0, 0, 0]))
    );

    this.fbos.minicounter = regl.framebuffer({
      width: 512,
      height: 512,
      depth: false,
    });

    this.fbos.lines = regl.framebuffer({
      // type: 'half float',
      width: this.width,
      height: this.height,
      depth: false,
    });

    this.fbos.points = regl.framebuffer({
      // type: 'half float',
      width: this.width,
      height: this.height,
      depth: false,
    });
    this.fbos.ping = regl.framebuffer({
      width: this.width,
      height: this.height,
      depth: false,
    });

    this.fbos.pong = regl.framebuffer({
      width: this.width,
      height: this.height,
      depth: false,
    });

    this.fbos.contour =
      this.fbos.contour ||
      regl.framebuffer({
        width: this.width,
        height: this.height,
        depth: false,
      });

    this.fbos.colorpicker =
      this.fbos.colorpicker ||
      regl.framebuffer({
        width: this.width,
        height: this.height,
        depth: false,
      });

    this.fbos.dummy =
      this.fbos.dummy ||
      regl.framebuffer({
        width: 1,
        height: 1,
        depth: false,
      });
  }

  get_image_texture(url: string) {
    const { regl } = this;
    this.textures = this.textures || {};
    if (this.textures[url]) {
      return this.textures[url];
    }
    const image = new Image();
    image.src = url;
    //    this.textures[url] = this.fbos.minicounter;
    image.addEventListener('load', () => {
      this.textures[url] = regl.texture(image);
    });
    return this.textures[url];
  }

  /*
  plot_as_grid(x_field, y_field, buffer = this.fbos.minicounter) {
    const { scatterplot, regl, tileSet } = this.aes;

    const saved_aes = this.aes;

    if (buffer === undefined) {
    // Mock up dummy syntax to use the main draw buffer.
      buffer = {
        width: this.width,
        height: this.height,
        use: (f) => f(),
      };
    }

    const { width, height } = buffer;

    this.aes = new AestheticSet(scatterplot, regl, tileSet);

    const x_length = map._root.table.getColumn(x_field).data.dictionary.length;

    const stride = 1;

    let nearest_pow_2 = 1;
    while (nearest_pow_2 < x_length) {
      nearest_pow_2 *= 2;
    }

    const encoding = {
      x: {
        field: x_field,
        transform: 'linear',
        domain: [-2047, -2047 + nearest_pow_2],
      },
      y: y_field !== undefined ? {
        field: y_field,
        transform: 'linear',
        domain: [-2047, -2020],

      } : { constant: -1 },
      size: 1,
      color: {
        constant: [0, 0, 0],
        transform: 'literal',
      },
      jitter_radius: {
        constant: 1 / 2560, // maps to x jitter
        method: 'uniform', // Means x in radius and y in speed.
      },

      jitter_speed: y_field === undefined ? 1 : 1 / 256, // maps to y jitter
    };
    // Twice to overwrite the defaults and avoid interpolation.
    this.aes.apply_encoding(encoding);
    this.aes.apply_encoding(encoding);
    this.aes.x[1] = saved_aes.x[0];
    this.aes.y[1] = saved_aes.y[0];
    this.aes.filter1 = saved_aes.filter1;
    this.aes.filter2 = saved_aes.filter2;

    const { props } = this;
    props.block_for_buffers = true;
    props.grid_mode = 1;

    const minilist = new Uint8Array(width * height * 4);

    buffer.use(() => {
      this.regl.clear({ color: [0, 0, 0, 0] });
      this.render_points(props);
      regl.read({ data: minilist });
    });
    // Then revert back.
    this.aes = saved_aes;
  }
   */
  n_visible(only_color = -1) {
    let { width, height } = this;
    width = Math.floor(width);
    height = Math.floor(height);
    if (this.contour_vals === undefined) {
      this.contour_vals = new Uint8Array(width * height * 4);
    }

    const { props } = this;
    props.only_color = only_color;
    let v;
    this.fbos.contour.use(() => {
      this.regl.clear({ color: [0, 0, 0, 0] });
      // read onto the contour vals.
      this.render_points(props);
      this.regl.read(this.contour_vals);
      // Could be done faster on the GPU itself.
      // But would require writing to float textures, which
      // can be hard.
      v = sum(this.contour_vals);
    });
    return v;
  }

  get integer_buffer(): wrapREGL.Buffer {
    if (this._integer_buffer === undefined) {
      const array = new Float32Array(2 ** 16);
      for (let i = 0; i < 2 ** 16; i++) {
        array[i] = i;
      }
      this._integer_buffer = this.regl.buffer(array);
    }
    return this._integer_buffer;
  }

  color_pick(x: number, y: number) {
    const tile_number = this.color_pick_single(x, y, 'tile_id');
    const row_number = this.color_pick_single(x, y, 'ix_in_tile');
    for (const tile of this.visible_tiles()) {
      if (tile.numeric_id === tile_number) {
        return tile.record_batch.get(row_number);
      }
    }
    //    const p = this.tileSet.findPoint(point_as_int);
    //    if (p.length === 0) { return; }
    //    return p[0];
  }
  color_pick_single(
    x: number,
    y: number,
    field: 'ix_in_tile' | 'ix' | 'tile_id' = 'tile_id'
  ) {
    const { props, height } = this;
    props.color_picker_mode =
      ['ix', 'tile_id', 'ix_in_tile'].indexOf(field) + 1;

    let color_at_point: [number, number, number, number] = [0, 0, 0, 0];
    this.fbos.colorpicker.use(() => {
      this.regl.clear({ color: [0, 0, 0, 0] });
      // read onto the contour vals.
      this.render_points(props);
      // Must be flipped
      try {
        color_at_point = this.regl.read({
          x,
          y: height - y,
          width: 1,
          height: 1,
        });
      } catch {
        console.warn('Read bad data from', {
          x,
          y,
          height,
          attempted: height - y,
        });
      }
    });
    // Subtract one. This inverts the operation `fill = packFloat(ix + 1.);`
    // in glsl/general.vert, to avoid off-by-one errors with the point selected.
    const point_as_float = unpackFloat(...color_at_point) - 1;
    // Coerce to int. unpackFloat returns float but findPoint expects int.
    const point_as_int = Math.round(point_as_float);

    return point_as_int;
  }

  /* blur(fbo) {
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
} */
  get fill_buffer() {
    //
    if (!this._fill_buffer) {
      const { regl } = this;
      this._fill_buffer = regl.buffer({ data: [-4, -4, 4, -4, 0, 4] });
    }
    return this._fill_buffer;
  }

  draw_contour_buffer(field: string, ix: number) {
    let { width, height } = this;
    width = Math.floor(width);
    height = Math.floor(height);

    this.contour_vals = this.contour_vals || new Uint8Array(4 * width * height);
    this.contour_alpha_vals =
      this.contour_alpha_vals || new Uint16Array(width * height);

    const { props } = this;

    props.aes.encoding.color = {
      field,
    };

    props.only_color = ix;

    this.fbos.contour.use(() => {
      this.regl.clear({ color: [0, 0, 0, 0] });
      // read onto the contour vals.
      this.render_points(props);
      this.regl.read(this.contour_vals);
    });

    // 3-pass blur
    this.blur(this.fbos.contour, this.fbos.ping, 3);

    this.fbos.contour.use(() => {
      this.regl.read(this.contour_vals);
    });

    let i = 0;

    while (i < width * height * 4) {
      this.contour_alpha_vals[i / 4] = this.contour_vals[i + 3] * 255;
      i += 4;
    }
    return this.contour_alpha_vals;
  }

  remake_renderer() {
    const { regl } = this;
    // This should be scoped somewhere to allow resizing.

    const parameters = {
      depth: { enable: false },
      stencil: { enable: false },
      blend: {
        enable(_, { color_picker_mode }) {
          return color_picker_mode < 0.5;
        },
        func: {
          srcRGB: 'one',
          srcAlpha: 'one',
          dstRGB: 'one minus src alpha',
          dstAlpha: 'one minus src alpha',
        },
      },
      primitive: 'points',
      frag: frag_shader,
      vert: vertex_shader,
      count(_, props) {
        return props.manager.count;
      },
      attributes: {
        //        buffer_0: (_, props) => props.manager.regl_elements.get('ix'),
        //        buffer_1: this.integer_buffer
      }, // Filled below.
      uniforms: {
        //@ts-ignore
        u_update_time: regl.prop('update_time'),
        u_transition_duration(_, props) {
          return props.prefs.duration; // Using seconds, not milliseconds, in there
        },
        u_only_color(_, props) {
          if (props.only_color !== undefined) {
            return props.only_color;
          }
          // Use -2 to disable color plotting. -1 is a special
          // value to plot all.
          // Other values plot a specific value of the color-encoded field.
          return -2;
        },
        u_use_glyphset: (_, { prefs }) => (prefs.glyph_set ? 1 : 0),
        u_glyphset: (_, { prefs }) => {
          if (prefs.glyph_set) {
            return this.get_image_texture(prefs.glyph_set);
          }
          return this.textures.empty_texture;
        },
        //@ts-ignore
        u_color_picker_mode: regl.prop('color_picker_mode'),
        u_position_interpolation_mode() {
          // 1 indicates that there should be a continuous loop between the two points.
          if (this.aes.position_interpolation) {
            return 1;
          }
          return 0;
        },
        u_grid_mode: (_, { grid_mode }) => grid_mode,
        //@ts-ignore
        u_colors_as_grid: regl.prop('colors_as_grid'),
        /*        u_constant_color: () => (this.aes.dim("color").current.constant !== undefined
          ? this.aes.dim("color").current.constant
          : [-1, -1, -1]),
        u_constant_last_color: () => (this.aes.dim("color").last.constant !== undefined
          ? this.aes.dim("color").last.constant
          : [-1, -1, -1]),*/
        u_tile_id: (_, props) => props.tile_id,
        u_width: ({ viewportWidth }) => viewportWidth,
        u_height: ({ viewportHeight }) => viewportHeight,
        u_one_d_aesthetic_map: this.aes.aesthetic_map.one_d_texture,
        u_color_aesthetic_map: this.aes.aesthetic_map.color_texture,
        u_aspect_ratio: ({ viewportWidth, viewportHeight }) =>
          viewportWidth / viewportHeight,
        //@ts-ignore
        u_zoom_balance: regl.prop('zoom_balance'),
        u_base_size: (_, { point_size }) => point_size,
        u_maxix: (_, { max_ix }) => max_ix,
        u_alpha: (_, { alpha }) => alpha,
        u_foreground_number: (_, { foreground }) => foreground,
        u_background_rgba: () => {
          const color = this.prefs.background_options.color;
          const { r, g, b } = rgb(color);
          return [
            r / 255,
            g / 255,
            b / 255,
            this.prefs.background_options.opacity,
          ] as [number, number, number, number];
        },
        u_background_mouseover: () =>
          this.prefs.background_options.mouseover ? 1 : 0,
        u_background_size: () => this.prefs.background_options.size,
        u_k: (_, props) => {
          return props.transform.k;
        },
        // Allow interpolation between different coordinate systems.
        //@ts-ignore
        u_window_scale: regl.prop('webgl_scale'),
        //@ts-ignore
        u_last_window_scale: regl.prop('last_webgl_scale'),
        u_time: ({ time }) => time,
        u_filter_numeric() {
          return this.aes.dim('filter').current.ops_to_array();
        },
        u_last_filter_numeric() {
          return this.aes.dim('filter').last.ops_to_array();
        },
        u_filter2_numeric() {
          return this.aes.dim('filter2').current.ops_to_array();
        },
        u_last_filter2_numeric() {
          return this.aes.dim('filter2').last.ops_to_array();
        },
        u_foreground_numeric() {
          return this.aes.dim('foreground').current.ops_to_array();
        },
        u_last_foreground_numeric() {
          return this.aes.dim('foreground').last.ops_to_array();
        },
        u_jitter: () => this.aes.dim('jitter_radius').current.jitter_int_format,
        u_last_jitter: () =>
          this.aes.dim('jitter_radius').last.jitter_int_format,
        u_zoom(_, props) {
          return props.zoom_matrix;
        },
      },
    };

    // store needed buffers
    for (const i of range(0, 16)) {
      parameters.attributes[`buffer_${i}`] = (
        _,
        { manager, buffer_num_to_variable }
      ) => {
        const c = manager.regl_elements.get(buffer_num_to_variable[i]);
        return c || { constant: 0 };
      };
    }

    for (const k of [
      'x',
      'y',
      'color',
      'jitter_radius',
      'x0',
      'y0',
      'jitter_speed',
      'size',
      'filter',
      'filter2',
      'foreground',
      //      'character',
    ] as const) {
      for (const time of ['current', 'last']) {
        const temporal = time === 'current' ? '' : 'last_';
        /*        parameters.uniforms[`u_${temporal}${k}_map`] = () => {
          const aes_holder = this.aes.dim(k)[time];
          console.log(aes_holder.textures.one_d);
          return aes_holder.textures.one_d;
        }; */
        parameters.uniforms[`u_${temporal}${k}_map_position`] = () => {
          if (temporal == '' && k == 'filter') {
            //            console.log(this.aes.dim(k)[time].map_position);
          }
          return this.aes.dim(k)[time].map_position;
        };
        parameters.uniforms[`u_${temporal}${k}_buffer_num`] = (
          _,
          { aes_to_buffer_num }
        ) => {
          const val = aes_to_buffer_num[`${k}--${time}`];
          if (val === undefined) {
            return -1;
          }
          return val;
        };

        parameters.uniforms[`u_${temporal}${k}_domain`] = () =>
          this.aes.dim(k)[time].webGLDomain;
        parameters.uniforms[`u_${temporal}${k}_range`] = () =>
          this.aes.dim(k)[time].range;
        parameters.uniforms[`u_${temporal}${k}_transform`] = () => {
          const t = this.aes.dim(k)[time].transform;
          if (t === 'linear') return 1;
          if (t === 'sqrt') return 2;
          if (t === 'log') return 3;
          if (t === 'literal') return 4;
          throw 'Invalid transform';
        };
        parameters.uniforms[`u_${temporal}${k}_constant`] = () => {
          return this.aes.dim(k)[time].constant;
        };
      }
      // Copy the parameters from the data name.
    }
    //@ts-expect-error
    this._renderer = regl(parameters);
    return this._renderer;
  }

  public allocate_aesthetic_buffers() {
    // There are only 14 attribute buffers available to use,
    // once we pass in the index and position in the tile. The order here determines
    // how important it is to capture transitions for them; if
    // we run out of buffers, the previous state of the requested aesthetic will just be thrown
    // away.

    type time = 'current' | 'last';
    type BufferSummary = {
      aesthetic: keyof Encoding;
      time: time;
      field: string;
    };
    const buffers: BufferSummary[] = [];
    const priorities = [
      // How important is safe interpolation?
      'x',
      'y',
      'color',
      'x0',
      'y0',
      'size',
      'jitter_radius',
      'jitter_speed',
      'filter',
      'filter2',
      'foreground',
    ] as const;
    for (const aesthetic of priorities) {
      const times = ['current', 'last'] as const;
      for (const time of times) {
        try {
          if (this.aes.dim(aesthetic)[time].field) {
            buffers.push({
              aesthetic,
              time,
              field: this.aes.dim(aesthetic)[time].field,
            });
          }
        } catch (error) {
          this.reglframe.cancel();
          this.reglframe = undefined;
          throw error;
        }
      }
    }

    buffers.sort((a, b) => {
      // Current values always come first.
      if (a.time < b.time) {
        return -1;
      } // current < last.
      if (b.time < a.time) {
        return 1;
      }
      return priorities.indexOf(a.aesthetic) - priorities.indexOf(b.aesthetic);
    });
    type encodingkey = keyof Encoding;
    //todo not all encoding keys.
    const aes_to_buffer_num: Record<encodingkey, number> = {}; // eg 'x' => 3

    // Pre-allocate the 'ix' buffer.
    const variable_to_buffer_num: Record<string, number> = {
      ix: 0,
      ix_in_tile: 1,
    }; // eg 'year' =>  3
    let num = 1;
    for (const { aesthetic, time, field } of buffers) {
      const k = `${aesthetic}--${time}`;
      if (variable_to_buffer_num[field] !== undefined) {
        aes_to_buffer_num[k] = variable_to_buffer_num[field];
        continue;
      }
      if (num++ < 16) {
        aes_to_buffer_num[k] = num;
        variable_to_buffer_num[field] = num;
        continue;
      } else {
        // Don't use the last value, use the current value.
        // Strategy will break if more than 15 base channels are defined,
        // which is not currently possible.
        aes_to_buffer_num[k] = aes_to_buffer_num[`${aesthetic}--current`];
      }
    }

    const buffer_num_to_variable = [...Object.keys(variable_to_buffer_num)];
    this.aes_to_buffer_num = aes_to_buffer_num;
    this.variable_to_buffer_num = variable_to_buffer_num;
    this.buffer_num_to_variable = buffer_num_to_variable;
  }

  aes_to_buffer_num?: Record<string, number>;
  variable_to_buffer_num?: Record<string, number>;
  buffer_num_to_variable?: string[];

  get discard_share() {
    // If jitter is temporal, e.g., or filters are in place,
    // it may make sense to estimate the number of hidden points.
    return 0;
  }
}

class TileBufferManager {
  // Handle the interactions of a tile with a regl state.

  // binds elements directly to the tile, so it's safe
  // to re-run this multiple times on the same tile.
  public tile: Tile;
  public regl: Regl;
  public renderer: ReglRenderer;
  public regl_elements: Map<string, any>;
  //  public image;

  constructor(regl: Regl, tile: Tile, renderer: ReglRenderer) {
    this.tile = tile;
    this.regl = regl;
    this.renderer = renderer;
    tile._regl_elements =
      tile._regl_elements ||
      new Map([
        [
          'ix_in_tile',
          {
            offset: 0,
            stride: 4,
            buffer: renderer.integer_buffer,
          },
        ],
      ]);
    this.regl_elements = tile._regl_elements;
  }

  ready(_, block_for_buffers = true) {
    // Is the buffer ready with all the aesthetics for the current plot?
    //Block for buffers:
    const { renderer, regl_elements } = this;
    // Don't allocate buffers for dimensions until they're needed.
    const needed_dimensions: Set<Dimension> = new Set();
    for (const [k, v] of renderer.aes) {
      for (const aesthetic of [v.current, v.last]) {
        if (aesthetic.field) {
          needed_dimensions.add(aesthetic.field);
        }
      }
    }
    for (const key of ['ix', 'ix_in_tile', ...needed_dimensions]) {
      const current =
        key === 'ix_in_tile'
          ? this.renderer.integer_buffer
          : this.regl_elements.get(key);

      if (current === null) {
        // It's in the process of being built.
        return false;
      }
      if (current === undefined) {
        if (!this.tile.ready) {
          // Can't build b/c no tile ready.
          return false;
        }
        // Request that the buffer be created before returning false.
        regl_elements.set(key, null);
        if (block_for_buffers) {
          if (key === undefined) {
            continue;
          }
          this.create_regl_buffer(key);
        } else {
          renderer.deferred_functions.push(() => this.create_regl_buffer(key));
          return false;
        }
      }
    }
    return true;
  }

  get count() {
    // Returns the number of points in this table.
    const { regl_elements, tile } = this;
    // return this.tile.record_batch.numRows; // Would probably be fine, but no need to lose the optimized version below.

    if (regl_elements.has('_count')) {
      return regl_elements.get('_count');
    }
    if (tile.ready && tile._batch) {
      regl_elements.set('_count', tile.record_batch.getChild('ix').length);
      return regl_elements.get('_count');
    }
  }

  create_buffer_data(key: string) {
    const { tile } = this;
    if (!tile.ready) {
      throw 'Tile table not present.';
    }

    let column = tile.record_batch.getChild(key);

    if (!column) {
      if (tile.dataset.transformations[key]) {
        // Sometimes the transformation for creating the column may be defined but not yet applied.
        // If so, apply it right away.
        tile._batch = tile.dataset.transformations[key](tile);
        column = tile.record_batch.getChild(key);
        if (!column) {
          throw new Error(`${key} was not created.`);
        }
      } else {
        const col_names = tile.record_batch.schema.fields.map((d) => d.name);
        throw new Error(
          `Requested ${key} but table lacks that; the present columns are "${col_names.join(
            '", "'
          )}"`
        );
      }
    }
    // Anything that isn't a single-precision float must be coerced to one.
    if (column.type.typeId !== 3) {
      const buffer = new Float32Array(tile.record_batch.numRows);
      let source_buffer = column.data[0];
      if (column.type.dictionary) {
        // We set the dictionary values down by 2047 so that we can use
        // even half-precision floats for direct indexing.
        for (let i = 0; i < tile.record_batch.numRows; i++) {
          buffer[i] = source_buffer.values[i] - 2047;
        }
      } else if (source_buffer.stride === 2 && column.type.typeId === 10) {
        // 64-bit timestamped are internally represented as two 32-bit ints in the arrow arrays.
        // This does a moderately expensive copy as a stopgap.
        // This problem may creep up in other 64-bit types as we go, so keep an eye out.
        const copy = new Int32Array(source_buffer.values).buffer;
        const view64 = new BigInt64Array(copy);
        const timetype = column.type.unit;
        // All times are represented as milliseconds on the
        // GPU to align with the Javascript numbers. More or less,
        // at least.

        const divisor =
          timetype === 0
            ? 1e-3 // second
            : timetype === 1
            ? 1 // millisecond
            : timetype === 2
            ? 1e3 // microsecond
            : timetype === 3
            ? 1e6 // nanosecond
            : 42;
        if (divisor === 42) {
          throw new Error(`Unknown time type ${timetype}`);
        }

        for (let i = 0; i < tile.record_batch.numRows; i++) {
          buffer[i] = Number(view64[i]) / divisor;
        }
      } else {
        for (let i = 0; i < tile.record_batch.numRows; i++) {
          buffer[i] = Number(source_buffer.values[i]);
        }
      }
      return buffer;
    }
    // For numeric data, it's safe to simply return the data straight up.
    if (column.data[0].values.constructor === Float64Array) {
      return new Float32Array(column.data[0].values);
    }
    return column.data[0].values;
  }

  create_regl_buffer(key: string) {
    const { regl_elements } = this;
    const data = this.create_buffer_data(key);
    if (data.constructor !== Float32Array) {
      console.warn(typeof data, data);
      throw new Error('Buffer data must be a Float32Array');
    }
    const item_size = 4;
    const data_length = data.length;

    const buffer_desc = this.renderer.buffers.allocate_block(
      data_length,
      item_size
    );

    regl_elements.set(key, buffer_desc);

    buffer_desc.buffer.subdata(data, buffer_desc.offset);
  }
}

/*
function interpolate_regl_property(props, name : string, weight : 'linear' | 'log' | 'sqrt' = 'linear') {
  const { relative_time, prefs } = props
  if (relative_time >= 1) {
    return prefs[name];
  }
  const start = prefs[`last_${name}`] || prefs[name];
  const end = prefs[name];
  if (weight === 'linear') {
//    console.log(start, end, relative_time)
    return start * (1 - relative_time) + end * relative_time;
  } else if (weight === 'log') {
    return Math.exp(Math.log(start) * (1 - relative_time) + Math.log(end) * relative_time);
  } else if (weight === 'sqrt') {
    return Math.sqrt(
      (Math.sqrt(start) * (1 - relative_time)) ** 2 +
      (Math.sqrt(end) * relative_time) ** 2
    )
  }
}
*/

class MultipurposeBufferSet {
  // An abstraction creating an expandable set of buffers that can be subdivided
  // to put more than one variable on the same
  // block of memory. Reusing buffers this way can have performance benefits over allocating
  // multiple different buffers for each small block used.

  // The general purpose here is to call 'allocate_block' that releases a block of memory
  // to use in creating a new array to be passed to regl.
  public regl: Regl;
  public buffers: Buffer[];
  public buffer_size: number;
  public buffer_offsets: number[];
  public pointer: number;

  constructor(regl: Regl, buffer_size: number) {
    this.regl = regl;
    this.buffer_size = buffer_size;
    this.buffers = [];
    // Track the ends in case we want to allocate smaller items.
    this.buffer_offsets = [];
    this.pointer = 0;
    this.generate_new_buffer();
  }

  generate_new_buffer() {
    // Adds to beginning of list.
    if (this.pointer) {
      this.buffer_offsets.unshift(this.pointer);
    }
    this.pointer = 0;
    this.buffers.unshift(
      this.regl.buffer({
        type: 'float',
        length: this.buffer_size,
        usage: 'dynamic',
      })
    );
  }

  /**
   *
   * @param items The number of datapoints in the arrow column being allocated
   * @param bytes_per_item The number of bytes per item in the arrow column being allocated
   * @returns
   */

  allocate_block(items: number, bytes_per_item: number) {
    // Call dibs on a block of this buffer.
    // NB size is in **bytes**
    if (this.pointer + items * bytes_per_item > this.buffer_size) {
      // May lead to ragged ends. Could be smarter about reallocation here,
      // too.
      this.generate_new_buffer();
    }

    const value = {
      // First slot stores the active buffer.
      buffer: this.buffers[0],
      offset: this.pointer,
      stride: bytes_per_item,
    };
    this.pointer += items * bytes_per_item;
    return value;
  }
}
