import Tile from './tile.js';
import {ReglRenderer} from './regl_rendering.js';
import Zoom from './interaction.js';
import {select} from 'd3-selection';

const base_elements = [
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
    this.filters = [];

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


  }

  initialize() {
    console.log("Initializing renderer")
    this._renderer.initialize()
    console.log("Initialized renderer")
  }

  plotAPI(prefs) {
    if (prefs.filters) {
      while (this.filters.length) {
        this.filters.pop()
      }
      for (let filter_string of prefs.filters) {
        this.filters.push(Function("datum", filter_string))
      }
    }
    this._root.promise.then(d => {
      this._renderer.update_prefs(prefs)
      this._zoom.restart_timer(500000)
    })
  }

}
