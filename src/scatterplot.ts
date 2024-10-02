import { BaseType, select, Selection } from 'd3-selection';
import { range } from 'd3-array';
import merge from 'lodash.merge';
import { Zoom } from './interaction';
import { neededFieldsToPlot, ReglRenderer } from './regl_rendering';
import { tableFromIPC, type StructRowProxy } from 'apache-arrow';
import { Deeptable } from './Deeptable';
import type { FeatureCollection } from 'geojson';
import { LabelMaker } from './label_rendering';
import { Renderer } from './rendering';
import type { ConcreteAesthetic } from './aesthetics/StatefulAesthetic';
import { isURLLabels, isLabelset } from './typing';
import { DataSelection } from './selection';
import type {
  BooleanColumnParams,
  FunctionSelectParams,
  IdSelectParams,
} from './selection';
import type * as DS from './types';

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

/**
 * The core type of the module is a single scatterplot that manages
 * all data and renderering.
 */
export class Scatterplot {
  public _renderer?: ReglRenderer;
  public width: number;
  public height: number;
  public _root?: Deeptable;
  public elements?: Selection<SVGElement, unknown, Element, unknown>[];
  public secondary_renderers: Record<string, Renderer> = {};
  public div?: Selection<BaseType | HTMLDivElement, number, BaseType, unknown>;
  public bound: boolean;
  //  d3 : Object;
  public _zoom?: Zoom;
  // The queue of draw calls are a chain of promises.
  private plot_queue: Promise<void> = Promise.resolve();
  public prefs: DS.CompletePrefs;

  /**
   * Has the scatterplot completed its initial load of the data?
   */
  ready: Promise<void>;

  public click_handler: ClickFunction;
  public mouseover_handler: PointMouseoverFunction;
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

  constructor(selector: string, w?: number, h?: number);
  constructor(options: DS.ScatterplotOptions, w: never, h: never);

  constructor(arg: string | DS.ScatterplotOptions, w?: number, h?: number) {
    let options: DS.ScatterplotOptions;
    if (typeof arg === 'string') {
      options = {
        width: w,
        height: h,
        selector: arg,
      } as DS.ScatterplotOptions;
    } else {
      options = arg;
    }
    const {
      selector,
      width,
      height,
      source_url,
      deeptable,
      arrow_buffer,
      arrow_table,
    } = options;
    this.bound = false;
    if (selector !== undefined) {
      this.bind(selector, width, height);
    }
    this.width = width || window.innerWidth;
    this.height = height || window.innerHeight;
    // mark_ready is called when the scatterplot can start drawing..
    this.ready = new Promise((resolve) => {
      this.mark_ready = resolve;
    });

    this.click_handler = new ClickFunction(this);
    this.tooltip_handler = new TooltipHTML(this);
    this.label_click_handler = new LabelClick(this);
    this.handle_highlit_point_change = new ChangeToHighlitPointFunction(this);

    // Attach the deeptable if a method for it was defined.
    if (deeptable) this._root = deeptable;
    if (source_url) void this.load_deeptable({ source_url });
    if (arrow_buffer) void this.load_deeptable({ arrow_buffer });
    if (arrow_table) void this.load_deeptable({ arrow_table });

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
  public bind(
    selector: string | HTMLDivElement,
    width: number | undefined,
    height: number | undefined,
  ) {
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
        container as unknown as Selection<
          SVGElement,
          unknown,
          Element,
          unknown
        >,
      );
    }
    this.bound = true;
  }

  /**
   * Create a data selection. For back-compatability,
   * this wraps the select_data object on a deeptable;
   * it's recommended to use the deeptable directly.
   *
   * @deprecated
   *
   * @param params argument passed to deeptable.select_data.
   * @returns
   */
  async select_data(
    ...params: Parameters<Deeptable['select_data']>
  ): Promise<DataSelection> {
    return this.deeptable.select_data(...params);
  }
  /**
   * Creates a new selection from a set of parameters, and immediately applies it to the plot.
   * @param params A set of parameters defining a selection.
   */
  async select_and_plot(
    params: IdSelectParams | BooleanColumnParams | FunctionSelectParams,
    duration = this.prefs.duration,
  ): Promise<DataSelection> {
    const selection = await this.deeptable.select_data(params);
    if (selection === null) {
      throw new Error(`Invalid selection: ${JSON.stringify(params)}`);
    }
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
   * @param name The name of the new column to be created. If it already exists, this will throw an error in invocation
   * @param codes The codes to be assigned labels. This can be either a list of ids (in which case all ids will have the value 1.0 assigned)
   *   **or** a keyed of values like `{'Rome': 3, 'Vienna': 13}` in which case the numeric values will be used.
   * @param key_field The field in which to look for the identifiers.
   */
  join(
    name: string,
    codes: Record<string, number> | string[],
    key_field: string,
  ) {
    let true_codes: Record<string, number>;

    if (Array.isArray(codes)) {
      true_codes = Object.fromEntries(
        codes.map((next: string | bigint) => [String(next), 1]),
      );
    } else {
      true_codes = codes;
    }

    this.deeptable.add_label_identifiers(true_codes, name, key_field);
  }

  async add_labels_from_url(
    url: string,
    name: string,
    label_key: string,
    size_key: string | undefined,
    options: DS.LabelOptions,
  ): Promise<void> {
    await this.ready;

    await this.deeptable.promise;
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
   * @param size_key A field in the deeptable to associate with the *size* of the labels.
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
    options: DS.LabelOptions = {},
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
  get deeptable() {
    if (this._root === undefined) {
      throw new Error('No deeptable has been loaded');
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
      labelset.options || {},
    );
  }

  async load_deeptable({
    source_url,
    arrow_table,
    arrow_buffer,
    deeptable,
    tileProxy,
  }: DS.DataSpec): Promise<DS.Deeptable> {
    if (source_url !== undefined) {
      this._root = Deeptable.from_quadfeather(source_url, this, tileProxy);
    } else if (arrow_table !== undefined) {
      this._root = Deeptable.fromArrowTable(arrow_table, this);
    } else if (arrow_buffer !== undefined) {
      const tb = tableFromIPC(arrow_buffer);
      this._root = Deeptable.fromArrowTable(tb, this);
    } else if (deeptable !== undefined) {
      this._root = deeptable;
    } else {
      throw new Error('No source_url or arrow_table specified');
    }
    await this._root.ready;
    return this._root;
  }

  async reinitialize() {
    const { prefs } = this;
    await this.deeptable.promise;
    await this.deeptable.root_tile.get_column('x');
    this._renderer = new ReglRenderer(
      '#container-for-webgl-canvas',
      this.deeptable,
      this,
    );
    this._zoom = new Zoom('#deepscatter-svg', this.prefs, this);
    this._zoom.attach_tiles(this.deeptable);
    this._zoom.attach_renderer('regl', this._renderer);
    this._zoom.initialize_zoom();

    // Needs the zoom built as well.
    const bkgd = select('#container-for-canvas-2d-background').select(
      'canvas',
    ) as Selection<
      HTMLCanvasElement,
      unknown,
      HTMLDivElement,
      HTMLCanvasElement
    >;
    const ctx = bkgd.node().getContext('2d');

    if (ctx === null) throw new Error("Can't acquire canvas context");
    ctx.fillStyle = prefs.background_color ?? 'rgba(133, 133, 111, .8)';
    ctx.fillRect(0, 0, window.innerWidth * 2, window.innerHeight * 2);

    void this._renderer.initialize();
    await this.deeptable.promise.then(() => {
      this.mark_ready();
    });
    this.mark_ready();
    return;
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
    const tiles = this.deeptable.map((t) => t);
    for (const i of range(20)) {
      setTimeout(() => {
        for (const tile of tiles) {
          const codes = tile.key.split('/').map((d) => +d);
          if (!codes || codes[0] != i) {
            continue;
          }
          if (!tile.extent) {
            continue;
          } // Still loading
          const [x1, x2] = tile.extent.x.map((x: number) => x_(x));
          const [y1, y2] = tile.extent.y.map((y: number) => y_(y));
          const depth = codes[0];
          ctx.lineWidth = 8 / Math.sqrt(depth);
          ctx.globalAlpha = 0.33;
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          if (tile.hasLoadedColumn('ix')) {
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
      for (const k of Object.keys(
        this.prefs.encoding,
      ) as (keyof typeof this.prefs.encoding)[]) {
        if (prefs.encoding[k] !== undefined) {
          const v = prefs.encoding[k];
          // TODO: fix
          // @ts-expect-error -- I can't make this work.
          this.prefs.encoding[k] =
            v as (typeof this.prefs.encoding)[keyof typeof this.prefs.encoding];
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
    for (const [k, v] of Object.entries(this.secondary_renderers)) {
      // Stop any existing labels
      if (v && v['label_key'] !== undefined) {
        (this.secondary_renderers[k] as LabelMaker).stop();
        (this.secondary_renderers[k] as LabelMaker).delete();
        delete this.secondary_renderers[k];
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

  get mouseover_callback() {
    return this.mouseover_handler.f;
  }

  set mouseover_callback(func) {
    this.mouseover_handler.f = func;
  }

  set label_click(
    func: (d: Record<string, unknown>, scatterplot: Scatterplot) => void,
  ) {
    this.label_click_handler.f = func;
  }

  get label_click(): LabelClick['f'] {
    return this.label_click_handler.f.bind(
      this.label_click_handler,
    ) as LabelClick['f'];
  }

  set highlit_point_change(
    func: (datum: StructRowProxy[], plot: Scatterplot) => void,
  ) {
    this.handle_highlit_point_change.f = func;
  }

  get highlit_point_change(): ChangeToHighlitPointFunction['f'] {
    return this.handle_highlit_point_change.f.bind(
      this.handle_highlit_point_change,
    );
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

    // Ensure that the deeptable exists.
    if (this._root === undefined) {
      const { source_url, arrow_table, arrow_buffer } =
        prefs as DS.InitialAPICall;
      const dataSpec = { source_url, arrow_table, arrow_buffer } as DS.DataSpec;
      if (Object.values(dataSpec).filter((x) => x !== undefined).length !== 1) {
        throw new Error(
          'The initial API call specify exactly one of source_url, arrow_table, or arrow_buffer',
        );
      }
      await this.load_deeptable(dataSpec);
    }
    this.update_prefs(prefs);
    // Then ensure the renderer and interaction handlers exist.
    if (this._zoom === undefined || this._renderer === undefined) {
      await this.reinitialize();
    }
    if (prefs) {
      await this.start_transformations(prefs);
    }

    this.plot_queue = this.unsafe_plotAPI(prefs);

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
      if (!prefs.encoding) {
        resolve();
      }
      if (!this._renderer) {
        throw new Error('No renderer has been initialized');
      }
      //
      const needed_keys = neededFieldsToPlot(prefs.encoding);
      this.deeptable.root_tile.require_columns(
        [...needed_keys].map((k) => k[0]),
      );
      // Immediately start loading what we can onto the GPUs, too.
      for (const tile of this.renderer.visible_tiles()) {
        this._renderer.bufferManager.ready(tile, needed_keys);
      }
      // TODO: There should be a setTimeout here before the resolution
      resolve();
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
      this.click_function = prefs.click_function;
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

    if (prefs.transformations) {
      for (const [k, func] of Object.entries(prefs.transformations)) {
        if (!this.deeptable.transformations[k]) {
          this.deeptable.register_transformation(k, func);
        }
      }
    }

    const renderer = this._renderer;
    const zoom = this._zoom;

    if (renderer === undefined || zoom === undefined) {
      throw new Error(
        'Error: plot called on scatterplot without defined renderer.',
      );
    }
    renderer.render_props.apply_prefs(this.prefs);

    const { width, height } = this;
    this.update_prefs(prefs);

    if (prefs.zoom !== undefined) {
      if (prefs.zoom === null) {
        zoom.zoom_to(1, width / 2, height / 2);
        prefs.zoom = undefined;
      } else if (prefs.zoom?.bbox) {
        zoom.zoom_to_bbox(prefs.zoom.bbox, prefs.duration);
      }
    }

    renderer.most_recent_restart = Date.now();
    renderer.aes.apply_encoding(prefs.encoding ?? {});

    if (renderer.reglframe) {
      const r = renderer.reglframe;
      r.cancel();
      renderer.reglframe = undefined;
    }

    renderer.reglframe = renderer.regl.frame(() => {
      renderer.tick();
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
            {},
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

    zoom.restart_timer(60_000);
  }

  get dataset() {
    return this.deeptable;
  }
  get root_batch() {
    if (!this._root) {
      throw new Error('No deeptable has been loaded');
    }
    return this.deeptable.root_tile.record_batch;
  }

  /**
   * Return the current state of the query. Can be used to save an API
   * call for use programatically.
   */
  get query(): DS.APICall {
    const p = JSON.parse(JSON.stringify(this.prefs)) as DS.APICall;
    p.zoom = { bbox: this.renderer.zoom.current_corners() };
    return p;
  }

  get renderer(): ReglRenderer {
    if (this._renderer === undefined) {
      throw new Error('No renderer has been initialized');
    }
    return this._renderer;
  }

  get zoom(): Zoom {
    if (this._zoom === undefined) {
      throw new Error('No zoom has been initialized');
    }
    return this._zoom;
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

  set f(f: (datum: ArgType, plot: Scatterplot) => FuncType) {
    this._f = f;
  }
}

import type { GeoJsonProperties } from 'geojson';
import { default_API_call } from './defaults';

class LabelClick extends SettableFunction<void, GeoJsonProperties> {
  default(
    feature: GeoJsonProperties,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    plot: Scatterplot | undefined = undefined,
    labelset: LabelMaker | undefined = undefined,
  ) {
    if (feature === null) {
      return;
    }
    if (labelset === null) {
      return;
    }
  }
}

class ClickFunction extends SettableFunction<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  default(datum: StructRowProxy, plot: Scatterplot | undefined = undefined) {
    console.log({ ...datum });
    return;
  }
}

class ChangeToHighlitPointFunction extends SettableFunction<
  void,
  StructRowProxy[]
> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  default(points: StructRowProxy[], plot: Scatterplot | undefined = undefined) {
    return;
  }
}

class PointMouseoverFunction extends SettableFunction<void, StructRowProxy[]> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  default(points: StructRowProxy[], plot: Scatterplot | undefined = undefined) {
    return;
  }
}

/**
 * A holder for a function that returns the HTML that should appear in a tooltip next to a point.
 */

class TooltipHTML extends SettableFunction<string> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  default(point: StructRowProxy, plot: Scatterplot | undefined = undefined) {
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
