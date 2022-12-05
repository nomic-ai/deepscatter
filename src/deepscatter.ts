import { select, Selection } from 'd3-selection';
import { geoPath, geoIdentity } from 'd3-geo';
import { max, range, sum } from 'd3-array';
import merge from 'lodash.merge';
import Zoom from './interaction';
import { ReglRenderer } from './regl_rendering';
import { Dataset } from './Dataset';
import type { APICall, onZoomCallback } from './types';
import type { StructRowProxy } from 'apache-arrow';
import type { FeatureCollection } from 'geojson';
import { LabelMaker } from './label_rendering';
import { Renderer } from './rendering';

// DOM elements that deepscatter uses.
const base_elements = [
  {
    id: 'canvas-2d-background',
    nodetype: 'canvas',
  },
  {
    id: 'webgl-canvas',
    nodetype: 'canvas',
  },
  {
    id: 'canvas-2d',
    nodetype: 'canvas',
  },
  {
    id: 'deepscatter-svg',
    nodetype: 'svg',
  },
];

export default class Scatterplot {
  public _renderer: ReglRenderer;
  public width: number;
  public height: number;
  public _root: Dataset<any>;
  public elements?: Selection<SVGElement, any, any, any>[];
  public secondary_renderers: Record<string, Renderer> = {};
  div: Selection<any, any, any, any>;
  bound: boolean;
  //  d3 : Object;
  private _zoom: Zoom;
  // The queue of draw calls are a chain of promises.
  private plot_queue: Promise<void> = Promise.resolve(0);
  public prefs: APICall;
  ready: Promise<void>;
  public click_handler: ClickFunction;
  public tooltip_handler: TooltipHTML;
  // In order to preserve JSON serializable nature of prefs, the consumer directly sets this
  public on_zoom?: onZoomCallback;

  constructor(selector: string, width: number, height: number) {
    this.bound = false;
    if (selector !== undefined) {
      this.bind(selector, width, height);
    }
    this.width = width;
    this.height = height;
    // Unresolvable.
    this.ready = new Promise(() => {
      /*pass*/
    });
    this.click_handler = new ClickFunction(this);
    this.tooltip_handler = new TooltipHTML(this);
    this.prefs = {
      zoom_balance: 0.35,
      duration: 2000,
      max_points: 100,
      encoding: {},
      point_size: 1, // base size before aes modifications.
      alpha: 40, // Overall screen saturation target.
    };
    //    this.d3 = { select };
  }
  /**
   * @param selector A selector for the root element of the deepscatter; must already exist.
   * @param width Width of the plot, in pixels.
   * @param height Height of the plot, in pixels.
   */
  bind(selector: string, width: number, height: number) {
    // Attach a plot to a particular DOM element.
    // Binding is a permanent relationship. Maybe shouldn't be, but is.

    this.div = select(selector)
      .selectAll('div.deepscatter_container')
      .data([1])
      .join('div')
      .attr('class', 'deepscatter_container')
      .style('position', 'absolute');

    // Styling this as position absolute with no top/left
    // forces the children to inherit the relative position
    // of the div, not the div's parent.

    if (this.div.empty()) {
      console.error(selector);
      throw 'Must pass a valid div selector';
    }

    this.elements = [];

    for (const d of base_elements) {
      const container = this.div
        .append('div')
        .attr('id', `container-for-${d.id}`)
        .style('position', 'absolute')
        .style('top', 0)
        .style('left', 0)
        .style('pointer-events', d.id === 'deepscatter-svg' ? 'auto' : 'none');

      container
        .append(d.nodetype)
        .attr('id', d.id)
        .attr('width', width || window.innerWidth)
        .attr('height', height || window.innerHeight);

      this.elements.push(container);
    }
    this.bound = true;
  }

  /**
   *
   * @param name The name of the new column to be created. If it already exists, this will throw an error in invocation
   * @param codes The codes to be assigned labels. This can be either a list of ids (in which case all ids will have the value 1.0 assigned)
   *   **or** a keyed of values like {'Rome': 3, 'Vienna': 13} in which case the numeric values will be used.
   * @param key_field The field in which to look for the identifiers.
   */
  add_identifier_column(
    name: string,
    codes: string[] | Record<string, number>,
    key_field: string
  ) {
    const true_codes: Record<string, number> = Array.isArray(codes)
      ? Object.fromEntries(codes.map((next) => [next, 1]))
      : codes;
    this._root.add_label_identifiers(true_codes, name, key_field);
  }

  async add_labels_from_url(
    url: string,
    name: string,
    label_key: string,
    size_key: string | undefined
  ) {
    const features = await fetch(url)
      .then((data) => data.json() as Promise<FeatureCollection>)
      .catch((error) => {
        console.log(error);
      });
    this.add_labels(features, name, label_key, size_key);
  }
  /**
   *
   * @param features A geojson feature collection containing point labels
   * @param name A unique key to associate with this labelset. Labels can be enabled or disabled using this key.
   * @param label_key The text field in which the labels are stored in the geojson object.
   * @param size_key A field in the dataset to associate with the *size* of the labels.
   *
   * Usage:
   *
   * To add a set of labels to your map, create a geojson array of points where
   * the 'properties' field contains a column to use for labels. E.g., each entry might look like
   * this. Each feature will be inserted into a label hierarchy to attempt to avoid inclusion.
   * If the label_key corresponds to the currently active color dimension on your map,
   * the labels will be drawn with appropriately colored outlines: otherwise, they will
   * all have a black outline.
   * **Currently it is necessary that labels be inserted in order**.
   *
   *
   */
  add_labels(
    features: FeatureCollection,
    name: string,
    label_key: string,
    size_key: string | undefined
  ) {
    const labels = new LabelMaker(this.div, this);
    labels.update(features, label_key, size_key);
    this.secondary_renderers[name] = labels;
    this.secondary_renderers[name].start();
  }

  async reinitialize() {
    const { prefs } = this;
    if (prefs.source_url !== undefined) {
      this._root = Dataset.from_quadfeather(prefs.source_url, prefs, this);
    } else if (prefs.arrow_table !== undefined) {
      this._root = Dataset.from_arrow_table(prefs.arrow_table, prefs, this);
    } else {
      throw new Error('No source_url or arrow_table specified');
    }
    await this._root.ready;

    this._renderer = new ReglRenderer(
      '#container-for-webgl-canvas',
      this._root,
      this
    );

    this._zoom = new Zoom('#deepscatter-svg', this.prefs, this);
    this._zoom.attach_tiles(this._root);
    this._zoom.attach_renderer('regl', this._renderer);
    this._zoom.initialize_zoom();

    // Needs the zoom built as well.

    const bkgd = select('#container-for-canvas-2d-background').select('canvas');
    const ctx = bkgd.node().getContext('2d');

    ctx.fillStyle = prefs.background_color || 'rgba(133, 133, 111, .8)';
    ctx.fillRect(0, 0, window.innerWidth * 2, window.innerHeight * 2);

    this._renderer.initialize();

    this.ready = this._root.promise;
    return this.ready;
  }

  /*
  registerBackgroundMap(url) {
    if (!this.geojson) {
      this.geojson = "in progress"
      d3json(url).then(d => {
        const holder = new GeoLines(d, this._renderer.regl)
        this._renderer.geolines = holder
      })
    }
  }
  */
  /*
  registerPolygonMap(definition) {
    const { file, color } = definition;
    if (!this.feather_features) {
      this.feather_features = {};
      this._renderer.geo_polygons = [];
    }
    if (!this.feather_features[file]) {
      this.feather_features[file] = 'in progress';
      const promise = fetch(file)
        .then((response) => response.arrayBuffer())
        .then((response) => {
          const table = Table.from(response);
          const holder = new FeatureHandler(this._renderer.regl, table);
          this._renderer.geo_polygons.push(holder);
        });
    }
  }
  */

  visualize_tiles() {
    const map = this;
    const ctx = map.elements[2].selectAll('canvas').node().getContext('2d');

    ctx.clearRect(0, 0, 10_000, 10_000);
    const { x_, y_ } = map._zoom.scales();
    ctx.strokeStyle = '#888888';
    const tiles = map._root.map((t: Tile) => t);
    for (const i of range(13)) {
      setTimeout(() => {
        for (const tile of tiles) {
          if (tile.codes[0] != i) {
            continue;
          }
          if (!tile.extent) {
            continue;
          } // Still loading
          const [x1, x2] = tile.extent.x.map((x: number) => x_(x));
          const [y1, y2] = tile.extent.y.map((y: number) => y_(y));
          const depth = tile.codes[0];
          ctx.lineWidth = 8 / Math.sqrt(depth);
          ctx.globalAlpha = 0.33;
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          if (tile.download_state !== 'Unattempted') {
            ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          }
          ctx.globalAlpha = 1;
        }
      }, i * 400);
    }
    setTimeout(() => ctx.clearRect(0, 0, 10_000, 10_000), 17 * 400);
  }

  async make_big_png(xtimes = 3, points = 1e7, timeper = 100) {
    await this._root.download_to_depth(points);
    const { width, height } = this._renderer;
    this.plotAPI({ duration: 0 });
    const canvas = document.createElement('canvas');
    canvas.setAttribute('width', (xtimes * width).toString());
    canvas.setAttribute('height', (xtimes * height).toString());
    const ctx = canvas.getContext('2d');

    const corners = this._zoom.current_corners();
    const current_zoom = this._zoom.transform.k;
    const xstep = (corners.x[1] - corners.x[0]) / xtimes;
    const ystep = (corners.y[1] - corners.y[0]) / xtimes;

    const p: Promise<void> = new Promise((resolve, reject) => {
      for (let i = 0; i < xtimes; i++) {
        for (let j = 0; j < xtimes; j++) {
          setTimeout(() => {
            this._zoom.zoom_to_bbox(
              {
                x: [corners.x[0] + xstep * i, corners.x[0] + xstep * (i + 1)],
                y: [corners.y[0] + ystep * j, corners.y[0] + ystep * (j + 1)],
              },
              timeper / 5,
              1
            );
            setTimeout(() => {
              this._renderer.fbos.colorpicker.use(() => {
                this._renderer.render_all(this._renderer.props);

                const pixels = this._renderer.regl.read(
                  0,
                  0,
                  width,
                  height
                ) as Uint8Array;
                console.log(i, j, sum(pixels));

                // https://stackoverflow.com/questions/41969562/how-can-i-flip-the-result-of-webglrenderingcontext-readpixels
                const halfHeight = (height / 2) | 0; // the | 0 keeps the result an int
                const bytesPerRow = width * 4;
                // make a temp buffer to hold one row
                var temp = new Uint8Array(width * 4);
                for (var y = 0; y < halfHeight; ++y) {
                  var topOffset = y * bytesPerRow;
                  var bottomOffset = (height - y - 1) * bytesPerRow;
                  // make copy of a row on the top half
                  temp.set(pixels.subarray(topOffset, topOffset + bytesPerRow));
                  // copy a row from the bottom half to the top
                  pixels.copyWithin(
                    topOffset,
                    bottomOffset,
                    bottomOffset + bytesPerRow
                  );
                  // copy the copy of the top half row to the bottom half
                  pixels.set(temp, bottomOffset);
                }
                const imageData = new ImageData(
                  new Uint8ClampedArray(pixels),
                  width
                );
                ctx.putImageData(imageData, width * i, height * j);
                //                ctx?.strokeRect(width * i, height * j, width, height)
              });
              if (i == xtimes - 1 && j === xtimes - 1) {
                resolve();
              }
            }, timeper / 2);
          }, i * timeper * xtimes + j * timeper);
        }
      }
    });

    p.then(() => {
      const canvasUrl = canvas.toDataURL();
      // Create an anchor, and set the href value to our data URL
      const createEl = document.createElement('a');
      createEl.href = canvasUrl;
      createEl.style = 'position:fixed;top:40vh;left:40vw;z-index:999;';
      // This is the name of our downloaded file
      createEl.download = 'deepscatter';

      // Click the download button, causing a download, and then remove it
      createEl.click();
      createEl.remove();
    });
  }
  /**
   * Destroy the scatterplot and release all associated resources.
   * This is necessary because removing a deepscatter instance
   * will not de-allocate tables from GPU memory.
   */
  public destroy() {
    this._renderer?.regl?.destroy();
    this.div?.node().parentElement.replaceChildren();
  }

  update_prefs(prefs: APICall) {
    // Stash the previous values for interpolation.

    if (this.prefs.encoding && prefs.encoding) {
      for (const k of Object.keys(this.prefs.encoding)) {
        if (prefs.encoding[k] !== undefined) {
          this.prefs.encoding[k] = prefs.encoding[k];
        }
      }
    }
    merge(this.prefs, prefs);
  }

  /**
   *
   * @param dimension The name of the encoding dimension to access
   * information about
   * @returns
   */

  public dim(dimension: string) {
    return this._renderer.aes.dim(dimension).current;
  }

  set tooltip_html(func) {
    this.tooltip_handler.f = func;
  }

  get tooltip_html() {
    /* PUBLIC see set tooltip_html */
    return this.tooltip_handler.f;
  }
  set click_function(func) {
    this.click_handler.f = func;
  }
  get click_function() {
    /* PUBLIC see set click_function */
    return this.click_handler.f;
  }

  async plotAPI(prefs: APICall): Promise<void> {
    if (
      prefs.encoding &&
      prefs.encoding.filter &&
      prefs.encoding.filter.domain
    ) {
      throw new Error('Filtering is not supported in the API');
    }
    await this.plot_queue;
    this.plot_queue = this.unsafe_plotAPI(prefs);
    return await this.plot_queue;
  }

  /**
   * This is the main plot entry point: it's unsafe to fire multiple
   * times in parallel because the transition state can get all borked up.
   *
   * @param prefs The preferences
   */
  private async unsafe_plotAPI(prefs: APICall): Promise<void> {
    if (prefs.click_function) {
      this.click_function = Function('datum', prefs.click_function);
    }
    if (prefs.tooltip_html) {
      this.tooltip_html = Function('datum', prefs.tooltip_html);
    }

    this.update_prefs(prefs);

    // Some things have to be done *before* we can actually run this;
    // this is a spot to defer the tasks.

    const tasks = [];

    if (this._root === undefined) {
      await this.reinitialize();
    }

    // Doesn't block.
    /*
    if (prefs.basemap_geojson) {
      this.registerBackgroundMap(prefs.basemap_geojson)
    }
    */

    if (prefs.basemap_gleofeather) {
      // Deprecated.
      prefs.polygons = [{ file: prefs.basemap_gleofeather }];
    }

    /*
    if (prefs.polygons) {
      for (const polygon of prefs.polygons) {
        this.registerPolygonMap(polygon);
      }
    }
    */

    await this._root.promise;

    this._renderer.render_props.apply_prefs(this.prefs);

    // Doesn't block.
    if (prefs.mutate) {
      this._root.apply_mutations(prefs.mutate);
    }

    const { width, height } = this;
    this.update_prefs(prefs);

    if (prefs.zoom !== undefined) {
      if (prefs.zoom === null) {
        this._zoom.zoom_to(1, width / 2, height / 2);
        prefs.zoom = undefined;
      } else if (prefs.zoom.bbox) {
        this._zoom.zoom_to_bbox(prefs.zoom.bbox, prefs.duration);
      }
    }

    this._renderer.most_recent_restart = Date.now();
    this._renderer.aes.apply_encoding(prefs.encoding);
    //    this._renderer.apply_webgl_scale()
    if (this._renderer.apply_webgl_scale) {
      this._renderer.apply_webgl_scale(prefs);
    }
    if (this._renderer.reglframe) {
      this._renderer.reglframe.cancel();
      this._renderer.reglframe = undefined;
    }

    this._renderer.reglframe = this._renderer.regl.frame(() => {
      this._renderer.tick('Basic');
    });

    this._zoom.restart_timer(60_000);
  }

  async root_table() {
    if (!this._root) {
      return false;
    }
    return this._root.record_batch;
  }

  /**
   * Return the current state of the query. Can be used to save an API
   * call for use programatically.
   */
  get query() {
    const p = JSON.parse(JSON.stringify(this.prefs));
    p.zoom = { bbox: this._renderer.zoom.current_corners() };
    return p;
  }

  drawContours(contours, drawTo) {
    const drawTwo = drawTo || select('body');
    const canvas = drawTwo.select('#canvas-2d');
    const context: CanvasRenderingContext2D = canvas.node().getContext('2d');

    for (const contour of contours) {
      context.fillStyle = 'rgba(25, 25, 29, 1)';
      context.fillRect(0, 0, window.innerWidth * 2, window.innerHeight * 2);

      context.strokeStyle = '#8a0303'; // "rbga(255, 255, 255, 1)"
      context.fillStyle = 'rgba(30, 30, 34, 1)';

      context.lineWidth = max([
        0.45,
        0.25 * Math.exp(Math.log(this._zoom.transform.k / 2)),
      ]);

      const path = geoPath(
        geoIdentity()
          .scale(this._zoom.transform.k)
          .translate([this._zoom.transform.x, this._zoom.transform.y]),
        context
      );
      context.beginPath(), path(contour), context.fill();
    }
  }

  contours(aes) {
    const data = this._renderer.calculate_contours(aes);
    const { x, y, x_, y_ } = this._zoom.scales();
    function fix_point(p) {
      if (!p) {
        return;
      }
      if (p.coordinates) {
        return fix_point(p.coordinates);
      }
      if (p.length === 0) {
        return;
      }
      if (p[0].length > 0) {
        return p.map(fix_point);
      }
      p[0] = x(x_.invert(p[0]));
      p[1] = y(y_.invert(p[1]));
    }
    fix_point(data);
    this.drawContours(data);
  }
}

abstract class SettableFunction<FuncType> {
  // A function that can be set by a string or directly with a function,
  // Used for handling interaction
  public _f: undefined | ((arg0: StructRowProxy) => FuncType);
  public string_rep: string;
  abstract default: (arg0: StructRowProxy) => FuncType;
  public plot: Scatterplot;
  constructor(plot: Scatterplot) {
    this.string_rep = '';
    this.plot = plot;
  }
  get f(): (arg0: StructRowProxy) => FuncType {
    if (this._f === undefined) {
      return this.default;
    }
    return this._f;
  }
  set f(f: string | ((arg0: StructRowProxy) => FuncType)) {
    if (typeof f === 'string') {
      if (this.string_rep !== f) {
        this.string_rep = f;
        //@ts-ignore
        this._f = Function('datum', f);
      }
    } else {
      this._f = f;
    }
  }
}

class ClickFunction extends SettableFunction<void> {
  //@ts-ignore bc https://github.com/microsoft/TypeScript/issues/48125
  default(datum: StructRowProxy) {
    console.log({ ...datum });
  }
}

class TooltipHTML extends SettableFunction<string> {
  //@ts-ignore bc https://github.com/microsoft/TypeScript/issues/48125
  default(point: StructRowProxy) {
    // By default, this returns a
    let output = '<dl>';
    const nope = new Set(['x', 'y', 'ix', null, 'tile_key']);
    console.log({ ...point });
    for (const [k, v] of point) {
      if (nope.has(k)) {
        continue;
      }
      // Don't show missing data.
      if (v === null) {
        continue;
      }
      // Don't show empty data.
      if (v === '') {
        continue;
      }
      output += ` <dt>${k}</dt>\n`;
      output += `   <dd>${v}<dd>\n`;
    }
    return `${output}</dl>\n`;
  }
}
