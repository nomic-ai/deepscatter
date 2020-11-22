import Tile from './tile.js';
import {ReglRenderer} from './regl_rendering.js';
import Zoom from './interaction.js';
import {select} from 'd3-selection';
import {geoPath, geoIdentity} from 'd3-geo';
import {json as d3json } from 'd3-fetch';
import {max, range} from 'd3-array';
import { Table } from 'apache-arrow';
import merge from 'lodash.merge';

import GeoLines from './geo_lines.js'
import FeatureHandler from './geo_poly.js'

const base_elements = [
  {
    id: 'canvas-2d-background',
    nodetype: 'canvas'
  },
  {
    id: 'webgl-canvas',
    nodetype: 'canvas'
  },
  {
    id: 'canvas-2d',
    nodetype: 'canvas'
  },
  {
    id: 'deepscatter-svg',
    nodetype: 'svg'
  }
]

export default class Scatterplot {

  constructor(selector, width, height) {
    console.warn("INITIALIZING")

    this.width = width
    this.height = height

    this.div = select(selector);

    this.elements = []
    this.filters = new Map();

//    this.encoding = {}
//    for (let k of Object.keys(default_aesthetics)) {
//      this.encoding[k] = null;
//    }
//    this.encoding.x = {'field': 'x'}
//    this.encoding.y = {'field': 'y'}
    this.prefs = {
      'zoom_balance': 0.25,
      "duration": 2
    }

    for (const d of base_elements) {
      const container =
      this.div
       .append("div")
       .attr("id", "container-for-" + d.id)
       .style("position", "fixed")
       .style("top", 0)
       .style("left", 0)
       .style("pointer-events", d.id == "deepscatter-svg" ? "auto":"none")

     container
       .append(d.nodetype)
       .attr("id", d.id)
       .attr("width", width || window.innerWidth)
       .attr("height", height || window.innerHeight)

      this.elements.push(container)
    }
  }

  reinitialize() {
    const { prefs } = this;
    this._root = new Tile(this.source_url, prefs);
    this._renderer = new ReglRenderer(
      "#container-for-webgl-canvas",
      this._root,
      this
    );
    this._zoom = new Zoom("#deepscatter-svg", this.prefs);
    this._zoom.attach_tiles(this._root);
    this._zoom.attach_renderer("regl", this._renderer);
    this._zoom.initialize_zoom();

    // Needs the zoom built as well.

    const bkgd = select("#container-for-canvas-2d-background").select("canvas")
    const ctx = bkgd.node().getContext("2d")

    ctx.fillStyle = prefs.background_color || "rgba(133, 133, 111, .8)"
    ctx.fillRect(0, 0, window.innerWidth * 2, window.innerHeight * 2)

    this._renderer.initialize()

    return this._root.promise
  }

  registerBackgroundMap(url) {
    if (!this.geojson) {
      this.geojson = "in progress"
      d3json(url).then(d => {
        const holder = new GeoLines(d, this._renderer.regl)
        this._renderer.geolines = holder
      })
    }
  }

  registerPolygonMap(url) {
     if (!this.feather_features) {
       this.feather_features = {}
       this._renderer.geo_polygons = []
     }
     if (!this.feather_features[url]) {
       this.feather_features[url] = "in progress"
       const promise = fetch(url)
             .then(response => response.arrayBuffer())
             .then(response => {
               let table = Table.from(response);
               const holder = new FeatureHandler(this._renderer.regl, table)
               this._renderer.geo_polygons.push(holder)
             })
      }
  }

  visualize_tiles() {
    const map = this;
    const ctx = map.elements[2]
      .selectAll("canvas").node().getContext("2d");

    ctx.clearRect(0, 0, 10000, 10000)
    const {x_, y_} = map._zoom.scales()
    ctx.strokeStyle = "#FFFFFF"
    const tiles = map._root.map(t => t)
    for (let i of range(13)) {
      setTimeout(() => {
      for (let tile of tiles) {
          if (tile.codes[0] != i) {continue}
          if (!tile.extent) {continue} // Still loading
          const [x1, x2] = tile.extent.x.map(x => x_(x))
          const [y1, y2] = tile.extent.y.map(y => y_(y))
          const depth = tile.codes[0]
          ctx.lineWidth = 8/Math.sqrt(depth)
          ctx.globalAlpha = 0.33
          ctx.strokeRect(x1, y1, x2-x1, y2-y1)
          ctx.globalAlpha = 1
      }}, i * 400)
    }
  }

  update_prefs(prefs) {

    // Stash the previous jitter.
    prefs.last_jitter = this.prefs.jitter || undefined;

    merge(this.prefs, prefs)
  }

  load_lookup_table(item) {
    this.lookup_tables = this.lookup_tables || new Map()
    if (this.lookup_promises.get(item)) {
      return this.lookup_promises.get(item)
    } else {
      const url = `${this.prefs.source_url}/${item}.feather`
      const promise = fetch(url)
            .then(response => response.arrayBuffer())
            .then(response => {
              let table = Table.from(response);
              this.lookup_tables.set(item, table)
              return "complete"
            })
      this.lookup_promises.set(item, promise)
      return promise
    }
  }

  async plotAPI(prefs = {}) {

    if (prefs === undefined || prefs === null) {return Promise.resolve(1)}

    this.update_prefs(prefs);
    /*
    if (!this._root) {
      return this.reinitialize().then(this.plotAPI(prefs))
    } */

    // Some things have to be done *before* we can actually run this;
    // this is a spot to defer the tasks.

    const tasks = []

    if (prefs.lookup_tables) {
      let table_loads = [];
      this.lookup_promises = this.lookup_promises || new Map()
      for (const table of prefs.lookup_tables) {
        if (!this.lookup_promises.get(table)) {
          table_loads.push(this.load_lookup_table(table))
        }
      }
      await Promise.all(table_loads);
    }

    if (prefs['source_url'] && prefs.source_url !== this.source_url) {
      this.source_url = prefs.source_url
      await this.reinitialize()
    }

    // Doesn't block.
    if (prefs.basemap_geojson) {
      this.registerBackgroundMap(prefs.basemap_geojson)
    }

    if (prefs.basemap_gleofeather) {
      this.registerPolygonMap(prefs.basemap_gleofeather)
    }


    await this._root.promise

    // Doesn't block.
    if (prefs.mutate) {
      this._root.apply_mutations(prefs.mutate)
    }

    const {width, height} = this;
    this.update_prefs(prefs)

    if (prefs.zoom !== undefined) {
      if (prefs.zoom === null) {
        this._zoom.zoom_to(1, width/2, height/2)
        prefs.zoom = undefined;
      } else if (prefs.zoom.bbox) {
        this._zoom.zoom_to_bbox(prefs.zoom.bbox, prefs.duration)
      }
    }
    this._renderer.most_recent_restart = Date.now()
    this._renderer.aes.apply_encoding(prefs.encoding)
//    this._renderer.apply_webgl_scale()
    if (this._renderer.apply_webgl_scale) {
      this._renderer.apply_webgl_scale(prefs)
    }
    this._zoom.restart_timer(60000)
  }

  drawContours(contours, drawTo) {

    const drawTwo = drawTo || select("body");
    const canvas = drawTwo.select("#canvas-2d")
    const ctx = canvas.node().getContext("2d")

    for (const contour of contours) {
      ctx.fillStyle = "rgba(25, 25, 29, 1)"
      ctx.fillRect(0, 0, window.innerWidth * 2, window.innerHeight * 2)

      ctx.strokeStyle = "#8a0303"//"rbga(255, 255, 255, 1)"
      ctx.fillStyle = 'rgba(30, 30, 34, 1)'

      ctx.lineWidth = max([0.45, 0.25 * Math.exp(Math.log(this._zoom.transform.k/2))]);

      const path = geoPath(geoIdentity()
        .scale(this._zoom.transform.k)
        .translate([this._zoom.transform.x, this._zoom.transform.y]), ctx);
        ctx.beginPath(), path(contour), ctx.fill();
      }
  }

  contours(aes) {
    const data = this._renderer.calculate_contours(aes)

    const {x, y, x_, y_} = this._zoom.scales()
    function fix_point(p) {
      if (!p) {return}
      if (p.coordinates) {
        return fix_point(p.coordinates)
      }
      if (!p.length) {
        return
      }
      if (p[0].length) {
        return p.map(fix_point)
      } else {
        p[0] = x(x_.invert(p[0]))
        p[1] = y(y_.invert(p[1]))
      }
    }
    fix_point(data)
    this.drawContours(data)
  }

}
