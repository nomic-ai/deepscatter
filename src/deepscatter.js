import { select } from 'd3-selection';
import { geoPath, geoIdentity } from 'd3-geo';
import { max, range } from 'd3-array';
import { Table } from '@apache-arrow/es2015-esm';
import merge from 'lodash.merge';
import Zoom from './interaction.js';
import { ReglRenderer } from './regl_rendering.js';
import Tile from './tile.js';

import ArrowMetaTable from './lookup_textures_from_arrow.js';
import FeatureHandler from './geo_poly.js';

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
  constructor(selector, width, height) {
    this.bound = false;
    if (selector !== undefined) {
      this.bind(selector, width, height);
    }
    this.d3 = { select };
  }

  bind(selector, width, height) {
    // Attach a plot to a particular DOM element.
    // Binding is a permanent relationship. Shouldn't be, but is.

    this.width = width;
    this.height = height;

    this.div = select(selector)
      .selectAll("div.deepscatter_container")
      .data([1])
      .join("div")
      .attr("class", "deepscatter_container")
      .style("position", "absolute")
    // Styling this as position absolute with no top/left
    // forces the children to inherit the relative position
    // of the div, not the div's parent.

    if (this.div.empty()) {
      console.error(selector);
      throw 'Must pass a valid div selector';
    }

    this.elements = [];

    this.prefs = {
      zoom_balance: 0.35,
      duration: 2,
      point_size: 1, // base size before aes modifications.
      alpha: 0.4, // Overall screen saturation target.
      click_function: "alert(`You clicked on a point with data ${JSON.stringify(datum)}`)"
    };

    for (const d of base_elements) {
      const container = this.div
        .append('div')
        .attr('id', `container-for-${d.id}`)
        .style('position', 'absolute')
        .style('top', 0)
        .style('left', 0)
        .style('pointer-events', d.id == 'deepscatter-svg' ? 'auto' : 'none');

      container
        .append(d.nodetype)
        .attr('id', d.id)
        .attr('width', width || window.innerWidth)
        .attr('height', height || window.innerHeight);

      this.elements.push(container);
    }
    this.bound = true;
  }

  async reinitialize() {
    const { prefs } = this;
    this._root = new Tile(this.source_url, prefs);
    await this._root.download();
    this._renderer = new ReglRenderer(
      '#container-for-webgl-canvas',
      this._root,
      this,
    );
    this._zoom = new Zoom('#deepscatter-svg', this.prefs);
    this._zoom.attach_tiles(this._root);
    this._zoom.attach_renderer('regl', this._renderer);
    this._zoom.initialize_zoom();

    // Needs the zoom built as well.

    const bkgd = select('#container-for-canvas-2d-background').select('canvas');
    const ctx = bkgd.node().getContext('2d');

    ctx.fillStyle = prefs.background_color || 'rgba(133, 133, 111, .8)';
    ctx.fillRect(0, 0, window.innerWidth * 2, window.innerHeight * 2);

    this._renderer.initialize();

    return this._root.promise;
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

  visualize_tiles() {
    const map = this;
    const ctx = map.elements[2]
      .selectAll('canvas').node().getContext('2d');

    ctx.clearRect(0, 0, 10000, 10000);
    const { x_, y_ } = map._zoom.scales();
    ctx.strokeStyle = '#888888';
    const tiles = map._root.map((t) => t);
    for (const i of range(13)) {
      setTimeout(() => {
        for (const tile of tiles) {
          if (tile.codes[0] != i) { continue; }
          if (!tile.extent) { continue; } // Still loading
          const [x1, x2] = tile.extent.x.map((x) => x_(x));
          const [y1, y2] = tile.extent.y.map((y) => y_(y));
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
  }

  update_prefs(prefs) {
    if (prefs.encoding && prefs.encoding.alpha) {
      console.warn('Setting alpha through encoding--deprecated.');
      /// DEPRECATED
      prefs.alpha = prefs.encoding.alpha;
    }

    if (prefs.jitter) {
      console.warn('Setting jitter type through base argument--deprectated');
      if (typeof (prefs.encoding.jitter_radius) === 'number') {
        prefs.encoding.jitter_radius = {
          constant: prefs.encoding.jitter_radius,
        };
      }
      prefs.encoding.jitter_radius.method = prefs.jitter;
    }

    // Stash the previous jitter.
    for (const k in ['jitter', 'alpha', 'max_points']) {
      prefs[`last_${k}`] = this.prefs[k] || undefined;
    }

    if (this.prefs.encoding && prefs.encoding) {
      for (const k of Object.keys(this.prefs.encoding)) {
        if (prefs.encoding[k]) {
          this.prefs.encoding[k] = prefs.encoding[k];
        }
      }
    }

    merge(this.prefs, prefs);
  }

  load_lookup_table(item) {
    this.lookup_tables = this.lookup_tables || new Map();
    if (this.lookup_promises.get(item)) {
      return this.lookup_promises.get(item);
    } if (this.lookup_promises.get(item) === null) {
      return undefined;
    }
    // Temporarily set as null to avoid multiple writes.
    this.lookup_promises.set(item, null);
    const metaTable = new ArrowMetaTable(this.prefs, item);
    metaTable.load().then(
      () => this.lookup_tables.set(item, metaTable),
    );
    this.lookup_promises.set(item, metaTable.load());

    return undefined;
  }

  async plotAPI(prefs = {}) {
    if (prefs === undefined || prefs === null) { return Promise.resolve(1); }

    this.update_prefs(prefs);

    // Some things have to be done *before* we can actually run this;
    // this is a spot to defer the tasks.

    const tasks = [];

    if (prefs.lookup_tables) {
      const table_loads = [];
      this.lookup_promises = this.lookup_promises || new Map();
      for (const table of prefs.lookup_tables) {
        if (!this.lookup_promises.get(table)) {
          table_loads.push(this.load_lookup_table(table));
        }
      }
      await Promise.all(table_loads);
    }

    if (prefs.source_url && prefs.source_url !== this.source_url) {
      this.source_url = prefs.source_url;
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

    if (prefs.polygons) {
      for (const polygon of prefs.polygons) {
        this.registerPolygonMap(polygon);
      }
    }

    await this._root.promise;

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
    }
    this._renderer.reglframe = this._renderer.regl.frame(() => {
      this._renderer.tick('Basic');
    });

    this._zoom.restart_timer(60000);
  }

  async root_table() {
    if (!this._root) {
      return false;
    }
    return this._root.table;
  }

  get query() {
    const p = JSON.parse(JSON.stringify(this.prefs));
    p.zoom = { bbox: this._renderer.zoom.current_corners() };
    return p;
  }

  top_n_points(n = 20) {
    const { _root, _renderer } = this;

    const current_corners = _renderer.zoom.current_corners();
    const output = [];
    const filter = _renderer.aes.filter.current.get_function();
    for (const p of _root.points(current_corners, true)) {
      if (filter(p)) {
        output.push(p);
      }
      if (output.length >= n) { return output; }
    }
    return output;
  }

  drawContours(contours, drawTo) {
    const drawTwo = drawTo || select('body');
    const canvas = drawTwo.select('#canvas-2d');
    const ctx = canvas.node().getContext('2d');

    for (const contour of contours) {
      ctx.fillStyle = 'rgba(25, 25, 29, 1)';
      ctx.fillRect(0, 0, window.innerWidth * 2, window.innerHeight * 2);

      ctx.strokeStyle = '#8a0303';// "rbga(255, 255, 255, 1)"
      ctx.fillStyle = 'rgba(30, 30, 34, 1)';

      ctx.lineWidth = max([0.45, 0.25 * Math.exp(Math.log(this._zoom.transform.k / 2))]);

      const path = geoPath(geoIdentity()
        .scale(this._zoom.transform.k)
        .translate([this._zoom.transform.x, this._zoom.transform.y]), ctx);
      ctx.beginPath(), path(contour), ctx.fill();
    }
  }

  contours(aes) {
    const data = this._renderer.calculate_contours(aes);

    const {
      x, y, x_, y_,
    } = this._zoom.scales();
    function fix_point(p) {
      if (!p) { return; }
      if (p.coordinates) {
        return fix_point(p.coordinates);
      }
      if (!p.length) {
        return;
      }
      if (p[0].length) {
        return p.map(fix_point);
      }
      p[0] = x(x_.invert(p[0]));
      p[1] = y(y_.invert(p[1]));
    }
    fix_point(data);
    this.drawContours(data);
  }
}
