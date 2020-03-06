import { scaleLog, scaleSequential, scaleLinear, scaleQuantize, scaleThreshold, scalePow, scaleOrdinal } from 'd3-scale';
import { format as d3Format } from 'd3-format';
import { range, extent, max, min, mean } from 'd3-array';
import { easeCubicOut, easeSinInOut } from 'd3-ease';
import { timer as d3Timer, timerFlush } from 'd3-timer';
import { quadtree as modquadtree } from 'd3-quadtree';
import { zoom as d3Zoom, zoomIdentity } from 'd3-zoom';
import {
  schemePiYG,
  schemeYlOrBr,
  schemeSet2,
  schemeAccent,
  interpolateViridis,
  schemeCategory10,
  schemeSet3,
} from 'd3-scale-chromatic';
import { select, selectAll, event, mouse } from 'd3-selection';
import { map, keys, set } from 'd3-collection';
import * as d3Fetch from 'd3-fetch';

import Tile from './tile.js';
import Renderer from './regl_rendering.js';

export default class Scatterplot {
  
  constructor(state) {
    console.log("Building", state)
    const { source_url, selector } = state;
    this._root = new Tile(source_url)
    this._renderer = new Renderer(selector, this._root)
    
    // I think probably this should be a primary level 
    // creation to handle interactions independently 
    // of any specific renderer?
    this._zoom = this._renderer._zoom;
  }

  initialize() {
    this._renderer.initialize()
  }

  plotAPI(state) {
    console.log("Plotting", state)
    this._renderer.update_prefs(state)
    console.log("Updating", state)
    this._renderer.tick()
  }
    
}
