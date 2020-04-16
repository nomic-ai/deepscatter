import Tile from './tile.js';
import {ReglRenderer} from './regl_rendering.js';
import Zoom from './interaction.js';
import {select} from 'd3-selection';
import {geoPath, geoIdentity} from 'd3-geo';
import {json as d3json } from 'd3-fetch';
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

  constructor(prefs) {

    const { source_url, selector } = prefs;

    this.div = select(selector);

    this.elements = []
    this.filters = new Map();



    for (const d of base_elements) {
      const container =
      this.div
       .append("div")
       .attr("id", "container-for-" + d.id)
       .style("position", "fixed")
       .style("top", 0)
       .style("left", 0)
       .style("pointer-events", d.id == "webgl-canvas" ? "auto":"none")

     container
       .append(d.nodetype)
       .attr("id", d.id)
       .attr("width", prefs.width || window.innerWidth)
       .attr("height", prefs.height || window.innerHeight)

      this.elements.push(container)
    }

    this._root = new Tile(source_url);

    console.log("Making Renderer", this)

    this._renderer = new ReglRenderer(
      "#container-for-webgl-canvas",
      this._root,
      prefs,
      this
    );



    console.log("Made renderer")
    this._zoom = new Zoom("#webgl-canvas", prefs);

    this._zoom.attach_tiles(this._root);
    this._zoom.attach_renderer(this._renderer);
    this._zoom.initialize_zoom();

    const bkgd = select("#container-for-canvas-2d-background").select("canvas")
    const ctx = bkgd.node().getContext("2d")

    ctx.fillStyle = "rgba(25, 25, 29, 1)"
    ctx.fillRect(0, 0, window.innerWidth * 2, window.innerHeight * 2)
  }

  drawBackgroundMap(url) {
    const bkgd = select("#container-for-canvas-2d-background").select("canvas")
    const ctx = bkgd.node().getContext("2d")

    if (!this.geojson) {
      return d3json(url).then(d => {
        this.geojson = d;

        const {x, y} = this._zoom.scales()

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
            p[0] = x(p[0])
            p[1] = y(p[1])
          }
        }
        for (let feature of this.geojson.features) {
          fix_point(feature.geometry)
        }
      })
    }

    ctx.fillStyle = "rgba(25, 25, 29, 1)"
    ctx.fillRect(0, 0, window.innerWidth * 2, window.innerHeight * 2)

    console.log()
    ctx.strokeStyle = "white"


    const path = geoPath(geoIdentity()
      .scale(this._zoom.transform.k)
      .translate([this._zoom.transform.x, this._zoom.transform.y]), ctx);



    for (let feature of this.geojson.features) {
      ctx.beginPath(), path(feature), ctx.stroke();
    }

  }

  initialize() {
    console.log("Initializing renderer")
    this._renderer.initialize()
    console.log("Initialized renderer")
  }

  plotAPI(prefs) {

    if (prefs.filters) {
      this.filters.clear()
      for (let filter_string of prefs.filters) {
        this.filters.set(filter_string, Function("datum", filter_string))
      }
    }

    this._root.promise.then(d => {
      this._renderer.update_prefs(prefs)
      this._zoom.restart_timer(500000)
    })
  }

}
