import Tile from './tile.js';
import Renderer from './regl_rendering.js';
import Zoom from './interaction.js';
import {select} from 'd3-selection';

export default class Scatterplot {
  
  constructor(prefs) {
    
    const { source_url, selector } = prefs;

    this.div = select(selector);
    
    this.canvas = select(selector).selectAll("canvas")
    this.canvas.attr("width", prefs.width || window.innerWidth)
    this.canvas.attr("height", prefs.height || window.innerHeight)

    

    this._root = new Tile(source_url);
    this._renderer = new Renderer(selector, this._root, prefs);
    this._zoom = new Zoom(this.canvas.node(), prefs);
    
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
    
    console.log("Plotting", prefs)
    this._renderer.update_prefs(prefs)
    console.log("Updating", prefs)
    this._renderer.tick()
  }
    
}
