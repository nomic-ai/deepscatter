import { BaseType, select, Selection } from 'd3-selection';
import { range } from 'd3-array';
import merge from 'lodash.merge';
import { Zoom } from './interaction';
import { ReglRenderer } from './regl_rendering';
import {
  tableFromIPC,
  type StructRowProxy,
  vectorFromArray,
} from 'apache-arrow';
import { Dataset } from './Dataset';
import type { FeatureCollection } from 'geojson';
import { LabelMaker } from './label_rendering';
import { Renderer } from './rendering';
import type { ConcreteAesthetic } from './aesthetics/StatefulAesthetic';
import { isURLLabels, isLabelset } from './typing';
import { DataSelection } from './selection';
import { dictionaryFromArrays } from './utilityFunctions';
import type {
  BooleanColumnParams,
  CompositeSelectParams,
  FunctionSelectParams,
  IdSelectParams,
} from './selection';
import type * as DS from './shared';

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

// A hook is a function that you can add onto a scatterplot that is called
// after each plotAPI update.
type Hook = () => void;

// interface AdditionalProps {
//   Bitmask: typeof Bitmask;
//   Dataset: typeof Dataset;
//   QuadtileDataset: typeof Dataset;
//   DataSelection: typeof DataSelection;
//   wrapArrow?: (t: Table) => Dataset;
// }

/**
 * The core type of the module is a single scatterplot that manages
 * all data and renderering.
 */
export class Scatterplot {
  public _renderer?: ReglRenderer;
  public width: number;
  public height: number;
  public _root?: Dataset;
  public elements?: Selection<SVGElement, unknown, Element, unknown>[];
  public secondary_renderers: Record<string, Renderer> = {};
  public selection_history: DS.SelectionRecord[] = [];
  public tileProxy?: DS.TileProxy;
  public util: Record<string, (unknown) => unknown> = {
    dictionaryFromArrays,
    vectorFromArray,
  };
  div: Selection<BaseType | HTMLDivElement, number, BaseType, unknown>;
  bound: boolean;
  //  d3 : Object;
  public _zoom: Zoom;
  // The queue of draw calls are a chain of promises.
  private plot_queue: Promise<void> = Promise.resolve();
  public prefs: DS.CompletePrefs;

  /**
   * Has the scatterplot completed its initial load of the data?
   */
  ready: Promise<void>;

  public click_handler: ClickFunction;
  private hooks: Record<string, Hook> = {};
  public tooltip_handler: TooltipHTML;
  public label_click_handler: LabelClick;
  public handle_highlit_point_change: ChangeToHighlitPointFunction;
  // In order to preserve JSON serializable nature of prefs, the consumer directly sets this
  public on_zoom?: DS.onZoomCallback;
  private mark_ready: () => void = function () {
    /*pass*/
  };
  /**
   * @param selector Either a DOM selector for the div in which the scatterplot will
   * live, or a div element itself. If this is undefined, the scatterplot will
   * not be fully created until you call `bind`.
   * 
   * @param width The width of the scatterplot (in pixels). If not passed will be 
   * inferred from the div.
   * @param height The height of the scatterplot (in pixels). If not passed will be inferred from the 
   */
  constructor(
    selector: string | HTMLDivElement | undefined,
    width?: number,
    height?: number,
    options: DS.ScatterplotOptions = {}
  ) {
    this.bound = false;
    if (selector !== undefined) {
      this.bind(selector, width, height);
    }
    this.width = width;
    this.height = height;
    // mark_ready is called when the scatterplot can start drawing..
    this.ready = new Promise((resolve) => {
      this.mark_ready = resolve;
    });
    this.click_handler = new ClickFunction(this);
    this.tooltip_handler = new TooltipHTML(this);
    this.label_click_handler = new LabelClick(this);
    this.handle_highlit_point_change = new ChangeToHighlitPointFunction(this);
    if (options.tileProxy) {
      this.tileProxy = options.tileProxy;
    }
    if (options.dataset) {
      void this.load_dataset(options.dataset);
    }
    this.prefs = { ...default_API_call } as DS.CompletePrefs;
  }

  /**
   * Attaches the scatterplot to a div element (either as a css selector or as a DOM element).
   * This is a permanent relationship.
   * 
   * @param selector A selector for the root element of the deepscatter; must already exist.
   * @param width Width of the plot, in pixels.
   * @param height Height of the plot, in pixels.
   */
  public bind(selector: string | HTMLDivElement, width: number, height: number) {
    // Attach a plot to a particular DOM element.
    // Binding is a permanent relationship. Maybe shouldn't be, but is.

    if (typeof selector === 'string') {
      selector = document.querySelector(selector) as unknown as HTMLDivElement;
    }

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

      const el = container
        .append(d.nodetype)
        .attr('id', d.id)
        .attr('width', width || window.innerWidth)
        .attr('height', height || window.innerHeight);

      if (d.nodetype === 'svg') {
        // SVG z-order can't be changed on the fly, so we
        // preset the order to make label rects show up on top
        // of mouseover points.
        el.append('g').attr('id', 'mousepoints');
        el.append('g').attr('id', 'labelrects');
      }
      this.elements.push(
        container as unknown as Selection<SVGElement, unknown, Element, unknown>
      );
    }
    this.bound = true;
  }

  /**
   * Creates a new selection from a set of parameters, and immediately applies it to the plot.
   * @param params A set of parameters defining a selection.
   */
  async select_and_plot(
    params: IdSelectParams | BooleanColumnParams | FunctionSelectParams,
    duration = this.prefs.duration
  ): Promise<DataSelection> {
    const selection = await this.select_data(params);
    await selection.ready;
    await this.plotAPI({
      duration,
      encoding: {
        foreground: {
          field: selection.name,
          op: 'eq',
          a: 1,
        },
      },
    });
    return selection;
  }
  /**
   *
   * @param params A set of parameters for selecting data based on ids, a boolean column, or a function.
   * @returns A DataSelection object that can be used to extend the selection.
   *
   * See `select_and_plot` for a method that will select data and plot it.
   */
  async select_data(
    params:
      | IdSelectParams
      | BooleanColumnParams
      | FunctionSelectParams
      | CompositeSelectParams
  ) {
    if (
      params.useNameCache &&
      params.name &&
      this.selection_history.length > 0
    ) {
      const old_version = this.selection_history.find(
        (x) => x.name === params.name
      );
      // If we have a cached version, move the cached version to the end and return it.
      if (old_version) {
        this.selection_history = [
          ...this.selection_history.filter((x) => x.name !== params.name),
          old_version,
        ];
        return old_version.selection;
      }
    }
    const selection = new DataSelection(this, params);
    this.selection_history.push({
      selection,
      name: selection.name,
      flushed: false,
    });
    await selection.ready;
    return selection;
  }

  /**
   *
   * @param name The name of the new column to be created. If it already exists, this will throw an error in invocation
   * @param codes The codes to be assigned labels. This can be either a list of ids (in which case all ids will have the value 1.0 assigned)
   *   **or** a keyed of values like `{'Rome': 3, 'Vienna': 13}` in which case the numeric values will be used.
   * @param key_field The field in which to look for the identifiers.
   */
  join(name: string, codes: Record<string, number>, key_field: string) {
    let true_codes: Record<string, number>;

    if (Array.isArray(codes)) {
      true_codes = Object.fromEntries(
        codes.map((next: string | bigint) => [String(next), 1])
      );
    } else {
      this._root.add_label_identifiers(true_codes, name, key_field);
    }
  }

  async add_labels_from_url(
    url: string,
    name: string,
    label_key: string,
    size_key: string | undefined,
    options: DS.LabelOptions
  ): Promise<void> {
    await this.ready;
    await this._root.promise;
    return fetch(url)
      .then(async (data) => {
        const features = await (data.json() as Promise<FeatureCollection>);
        this.add_labels(features, name, label_key, size_key, options);
      })
      .catch((error) => {
        console.warn(error);
        console.error('Broken addition of ', name);
        //        this.stop_labellers();
      });
  }
  /**
   *
   * @param features A geojson feature collection containing point labels
   * @param name A unique key to associate with this labelset. Labels can be enabled or disabled using this key.
   * @param label_key The text field in which the labels are stored in the geojson object.
   * @param size_key A field in the dataset to associate with the *size* of the labels.
   * @param label_options Additional custom passed to the labeller.
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
    size_key: string | undefined,
    options: DS.LabelOptions = {}
  ) {
    const labels = new LabelMaker(this, name, options);
    labels.update(features, label_key, size_key);
    this.secondary_renderers[name] = labels;
    const r = this.secondary_renderers[name] as LabelMaker;
    r.start();
  }

  /**
   * An alias to avoid using the underscored method directly.
   */
  get dataset() {
    if (this._root === undefined) {
      throw new Error('No dataset has been loaded');
    }
    return this._root;
  }

  add_api_label(labelset: DS.Labelset) {
    const geojson: FeatureCollection = {
      type: 'FeatureCollection',
      features: labelset.labels.map((label: DS.Label) => {
        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [label.x, label.y],
          },
          properties: {
            text: label.text,
            size: label.size || undefined,
          },
        };
      }),
    };
    this.add_labels(
      geojson,
      labelset.name,
      'text',
      'size',
      labelset.options || {}
    );
  }

  async load_dataset(params: DS.DataSpec): Promise<DS.Dataset> {
    if (params.source_url !== undefined) {
      this._root = Dataset.from_quadfeather(
        params.source_url,
        this
      );
    } else if (params.arrow_table !== undefined) {
      this._root = Dataset.from_arrow_table(
        params.arrow_table,
        this
      );
    } else if (params.arrow_buffer !== undefined) {
      const tb = tableFromIPC(params.arrow_buffer);
      this._root = Dataset.from_arrow_table(
        tb,
        this
      );
    } else {
      throw new Error('No source_url or arrow_table specified');
    }
    await this._root.ready;
    return this._root;
  }

  async reinitialize() {
    const { prefs } = this;

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

    const bkgd = select('#container-for-canvas-2d-background').select(
      'canvas'
    ) as Selection<
      HTMLCanvasElement,
      unknown,
      HTMLDivElement,
      HTMLCanvasElement
    >;
    const ctx = bkgd.node().getContext('2d');

    ctx.fillStyle = prefs.background_color ?? 'rgba(133, 133, 111, .8)';
    ctx.fillRect(0, 0, window.innerWidth * 2, window.innerHeight * 2);

    void this._renderer.initialize();
    void this._root.promise.then(() => this.mark_ready());
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
    /**
     * Draws a set of rectangles to the screen to illustrate the currently
     * loaded tiles. Useful for debugging and illustration.
     */

    const canvas = this.elements[2]
      .selectAll('canvas')
      .node() as HTMLCanvasElement;

    const ctx = canvas.getContext('2d');

    // as CanvasRenderingContext2D;

    ctx.clearRect(0, 0, 10_000, 10_000);
    const { x_, y_ } = this._zoom.scales();
    ctx.strokeStyle = '#888888';
    const tiles = this._root.map((t) => t);
    for (const i of range(20)) {
      setTimeout(() => {
        for (const tile of tiles) {
          if (!tile.codes || tile.codes[0] != i) {
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

  /**
   * Destroy the scatterplot and release all associated resources.
   * This is necessary because removing a deepscatter instance
   * will not de-allocate tables from GPU memory.
   */
  public destroy() {
    this._renderer?.regl?.destroy();

    const node = this.div?.node() as Node;
    node.parentElement.replaceChildren();
  }

  update_prefs(prefs: DS.APICall) {
    // Stash the previous values for interpolation.

    if (this.prefs.encoding && prefs.encoding) {
      for (const k of Object.keys(this.prefs.encoding)) {
        if (prefs.encoding[k] !== undefined) {
          this.prefs.encoding[k] = prefs.encoding[k] as DS.Encoding;
        }
      }
    }
    merge(this.prefs, prefs);
  }
  /**
   * Hooks provide a mechanism to run arbitrary code after call of plotAPI has resolved.
   * This is useful for--e.g.--updating a legend only when the plot changes.
   *
   * @param name The name of the hook to add.
   * @param hook A function to run after each plot command.
   */
  public add_hook(name: string, hook: Hook, unsafe = false) {
    if (this.hooks[name] !== undefined && !unsafe) {
      throw new Error(`Hook ${name} already exists`);
    }
    this.hooks[name] = hook;
  }

  public remove_hook(name: string, unsafe = false) {
    if (this.hooks[name] === undefined) {
      if (unsafe) {
        return;
      }
      throw new Error(`Hook ${name} does not exist`);
    }
    delete this.hooks[name];
  }

  public stop_labellers() {
    console.log('Stopping labels');
    for (const [k, v] of Object.entries(this.secondary_renderers)) {
      // Stop any existing labels
      if (v && v['label_key'] !== undefined) {
        (this.secondary_renderers[k] as LabelMaker).stop();
        (this.secondary_renderers[k] as LabelMaker).delete();
        this.secondary_renderers[k] = undefined;
      }
    }
  }

  /**
   *
   *
   * @param dimension The name of the encoding dimension to access
   * information about. E.g. ("color", "x", etc.)
   * @returns
   */

  public dim(dimension: DS.Dimension): ConcreteAesthetic {
    return this._renderer.aes.dim(dimension).current;
  }

  set tooltip_html(func) {
    this.tooltip_handler.f = func;
  }

  get tooltip_html() {
    /* PUBLIC see set tooltip_html */
    return this.tooltip_handler.f;
  }

  set label_click(func: (d: Record<string, unknown>, scatterplot: Scatterplot) => void) {
    this.label_click_handler.f = func;
  }

  get label_click() : LabelClick['f'] {
    return this.label_click_handler.f.bind(this.label_click_handler) as LabelClick['f'];
  }

  set highlit_point_change(func :  (datum: StructRowProxy[], plot: Scatterplot) => void) {
    this.handle_highlit_point_change.f = func;
  }

  get highlit_point_change() : ChangeToHighlitPointFunction['f'] {
    return this.handle_highlit_point_change.f.bind(
      this.handle_highlit_point_change
    ) as ChangeToHighlitPointFunction['f']
  }

  set click_function(func) {
    this.click_handler.f = func;
  }
  get click_function() {
    /* PUBLIC see set click_function */
    return this.click_handler.f;
  }
  /**
   * Plots a set of prefs, and returns a promise that resolves
   * upon the completion of the plot (not including any time for transitions).
   */
  async plotAPI(prefs: DS.APICall): Promise<void> {
    if (prefs === undefined) {
      return;
    }
    await this.plot_queue;
    if (prefs) {
      await this.start_transformations(prefs);
    }
    this.plot_queue = this.unsafe_plotAPI(prefs);
    await this.plot_queue;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const [_, hook] of Object.entries(this.hooks)) {
      hook();
    }
    return;
  }

  /**
   * Get a short head start on transformations. This prevents a flicker
   * when a new data field needs to be loaded onto the GPU.
   *
   * @param prefs The API call to prepare.
   * @param delay Delay in milliseconds to give the data to get onto the GPU.
   * 110 ms seems like a decent compromise; barely perceptible to humans as a UI response
   * time, but enough time
   * for three animation ticks to run.
   * @returns A promise that resolves immediately if there's no work to do,
   * or after the delay if there is.
   */
  async start_transformations(prefs: DS.APICall, delay = 110): Promise<void> {
    // If there's not a transition time, things might get weird and a flicker
    // is probably OK. Using the *current* transition time means that the start
    // of a set of duration-0 calls (like, e.g., dragging a time slider) will
    // block but that
    return new Promise((resolve) => {
      if (this.prefs.duration < delay) {
        delay = this.prefs.duration;
      }
      const needed_keys: Set<string> = new Set();
      if (!prefs.encoding) {
        resolve();
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for (const [_, v] of Object.entries(prefs.encoding)) {
        if (v && typeof v !== 'string' && v['field'] !== undefined) {
          needed_keys.add(v['field'] as string);
        }
      }

      if (this._renderer) {
        const promises: Promise<void>[] = [];
        const sine_qua_non: Promise<void>[] = [];
        for (const tile of this._renderer.visible_tiles()) {
          // Allow unready tiles to stay unready; who know's what's going on there.
          const manager = tile._buffer_manager;
          if (manager !== undefined && manager.ready()) {
            for (const key of needed_keys) {
              const { ready, promise } =
                manager.ready_or_not_here_it_comes(key);
              if (!ready) {
                if (promise !== null) {
                  promises.push(promise);
                  if (tile.key === '0/0/0') {
                    // we really need this one done.
                    sine_qua_non.push(promise);
                  }
                }
              }
            }
          }
        }
        if (promises.length === 0) {
          resolve();
        } else {
          const starttime = Date.now();
          // It's important to get at least the first promise done,
          // because it's used to determine some details about state.
          void Promise.all(sine_qua_non).then(() => {
            const endtime = Date.now();
            const elapsed = endtime - starttime;
            if (elapsed < delay) {
              setTimeout(() => {
                resolve();
              }, delay - elapsed);
            } else {
              resolve();
            }
          });
        }
      } else {
        resolve();
      }
    });
  }
  /**
   * This is the main plot entry point: it's unsafe to fire multiple
   * times in parallel because the transition state can get all borked up.
   * plotAPI wraps it in an await wrapper.
   *
   * @param prefs An API call.
   */
  private async unsafe_plotAPI(prefs: DS.APICall): Promise<void> {
    if (prefs === null) {
      return;
    }
    if (prefs.click_function) {
      this.click_function = prefs.click_function;      ;
    }
    if (prefs.tooltip_html) {
      this.tooltip_html = prefs.tooltip_html;
    }

    if (prefs.background_options) {
      // these two numbers can be set either on fg/bg or just on fg
      if (
        prefs.background_options.opacity &&
        typeof prefs.background_options.opacity === 'number'
      ) {
        prefs.background_options.opacity = [
          prefs.background_options.opacity,
          1,
        ];
      }
      if (
        prefs.background_options.size &&
        typeof prefs.background_options.size === 'number'
      ) {
        prefs.background_options.size = [prefs.background_options.size, 1];
      }
    }

    this.update_prefs(prefs);

    if (this._root === undefined) {
      const { source_url, arrow_table, arrow_buffer } =
        prefs as DS.InitialAPICall;
      const dataSpec = { source_url, arrow_table, arrow_buffer } as DS.DataSpec;
      if (Object.values(dataSpec).filter((x) => x !== undefined).length !== 1) {
        throw new Error(
          'The initial API call specify exactly one of source_url, arrow_table, or arrow_buffer'
        );
      }
      await this.load_dataset(dataSpec);
    }

    if (prefs.transformations) {
      for (const [k, func] of Object.entries(prefs.transformations)) {
        if (!this.dataset.transformations[k]) {
          this.dataset.register_transformation(k, func);
        }
      }
    }

    if (this._zoom === undefined) {
      await this.reinitialize();
    }

    this._renderer.render_props.apply_prefs(this.prefs);

    const { width, height } = this;
    this.update_prefs(prefs);

    if (prefs.zoom !== undefined) {
      if (prefs.zoom === null) {
        this._zoom.zoom_to(1, width / 2, height / 2);
        prefs.zoom = undefined;
      } else if (prefs.zoom?.bbox) {
        this._zoom.zoom_to_bbox(prefs.zoom.bbox, prefs.duration);
      }
    }

    this._renderer.most_recent_restart = Date.now();
    this._renderer.aes.apply_encoding(prefs.encoding);

    if (this._renderer.reglframe) {
      const r = this._renderer.reglframe;
      r.cancel();
      this._renderer.reglframe = undefined;
    }

    this._renderer.reglframe = this._renderer.regl.frame(() => {
      this._renderer.tick();
    });

    if (prefs.labels !== undefined) {
      if (isURLLabels(prefs.labels)) {
        const { url, label_field, size_field } = prefs.labels;
        const name = url;
        if (!this.secondary_renderers[name]) {
          this.stop_labellers();
          this.add_labels_from_url(
            url,
            name,
            label_field,
            size_field,
            {}
          ).catch((error) => {
            console.error('Label addition failed.');
            console.error(error);
          });
        }
      } else if (isLabelset(prefs.labels)) {
        if (!prefs.labels.name) {
          throw new Error('API field `labels` must have a name.');
        }
        this.stop_labellers();
        this.add_api_label(prefs.labels);
      } else if (prefs.labels === null) {
        this.stop_labellers();
      } else {
        throw new Error('API field `labels` format not recognized.');
      }
    }

    this._zoom.restart_timer(60_000);
  }

  get root_batch() {
    if (!this._root) {
      throw new Error('No dataset has been loaded');
    }
    return this.dataset.root_tile.record_batch;
  }

  /**
   * Return the current state of the query. Can be used to save an API
   * call for use programatically.
   */
  get query(): DS.APICall {
    const p = JSON.parse(JSON.stringify(this.prefs)) as DS.APICall;
    p.zoom = { bbox: this._renderer.zoom.current_corners() };
    return p;
  }

  sample_points(n = 10): Record<string, number | string>[] {
    const vals: Record<string, number | string>[] = [];
    for (const p of this._root.points(this._zoom.current_corners())) {
      vals.push({ ...p });
      if (vals.length >= n * 3) {
        break;
      }
    }
    vals.sort((a, b) => Number(a.ix) - Number(b.ix));
    return vals.slice(0, n);
  }
}

/**
 A function that can be set by a string or directly with a function
*/
abstract class SettableFunction<FuncType, ArgType = StructRowProxy> {
  public _f: undefined | ((datum: ArgType, plot: Scatterplot) => FuncType);
  public string_rep: string;
  public plot: Scatterplot;
  constructor(plot: Scatterplot) {
    this.string_rep = '';
    this.plot = plot;
  }

  abstract default(datum: ArgType, plot: Scatterplot | undefined): FuncType;

  get f(): (datum: ArgType, plot: Scatterplot) => FuncType {
    if (this._f === undefined) {
      return (datum, plot) => this.default(datum, plot);
    }
    return this._f;
  }

  set f(f: ((datum: ArgType, plot: Scatterplot) => FuncType)) {
    this._f = f;
  }
}

import type { GeoJsonProperties } from 'geojson';
import { default_API_call } from './defaults';

class LabelClick extends SettableFunction<void, GeoJsonProperties> {
  default(
    feature: GeoJsonProperties,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    plot : Scatterplot = undefined,
    labelset: LabelMaker | undefined = undefined
  ) {
    let filter: DS.LambdaChannel<string, boolean> | null
    if (feature === null) {
      return;
    }
    if (feature.__activated == true) {
      filter = null;
      feature.__activated = undefined;
    } else {
      feature.__activated = true;
      const k = labelset.label_key;
      const value = feature[k] as string;
      filter = {
        field: labelset.label_key,
        lambda: (d) => d === value
      };
    }
    void this.plot.plotAPI({
      encoding: { filter },
    });
  }
}

class ClickFunction extends SettableFunction<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  default(datum: StructRowProxy, plot : Scatterplot | undefined = undefined) {
    console.log({ ...datum });
    return;
  }
}

class ChangeToHighlitPointFunction extends SettableFunction<
  void,
  StructRowProxy[]
> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  default(points: StructRowProxy[], plot: Scatterplot = undefined) {
    return;
  }
}

class TooltipHTML extends SettableFunction<string> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  default(point: StructRowProxy, plot: Scatterplot = undefined) {
    // By default, this returns a
    let output = '<dl>';
    const nope: Set<string | null | number | symbol> = new Set([
      'x',
      'y',
      'ix',
      null,
      'tile_key',
    ]);
    for (const [k, v] of point) {
      // Don't show missing data.
      if (v === null) {
        continue;
      }
      if (nope.has(k)) {
        continue;
      }
      // Don't show empty data.
      if (v === '') {
        continue;
      }
      output += ` <dt>${String(k)}</dt>\n`;
      output += `   <dd>${String(v)}<dd>\n`;
    }
    return `${output}</dl>\n`;
  }
}
