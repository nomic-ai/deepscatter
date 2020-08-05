import { select } from 'd3-selection';
import { p_in_rect } from './tile.js'
export class Renderer {
  // A renderer handles drawing to a display element.
  constructor(selector, tileSet, scatterplot) {
    this.scatterplot = scatterplot;
    this.holder = select(selector);
    console.log(this.holder.node())
    this.canvas = select(this.holder.node().firstElementChild)
    console.log(this.canvas.node())
    this.tileSet = tileSet;
    this.prefs = scatterplot.prefs;
    this.width = +this.canvas.attr("width");
    this.height = +this.canvas.attr("height");
    this.deferred_functions = []
    this._use_scale_to_download_tiles = true
  }

  get max_ix() {
    const prefs = this.prefs;
    if (!this._use_scale_to_download_tiles) {
      return prefs.max_points;
    }
    const {k} = this.zoom.transform
    const point_size_adjust = Math.exp(Math.log(k) * prefs.zoom_balance)
    return prefs.max_points * k * k / point_size_adjust / point_size_adjust;
  }

  is_visible(point) {
    return p_in_rect(point, this._zoom.current_corners) &&
    point.ix < this.prefs.max_points * this._zoom.k
  }

  visible_tiles() {
    // yield the currently visible tiles based on the zoom state
    // and a maximum index passed manually.
    const { max_ix } = this;
    const { tileSet } = this;
    // Materialize using a tileset method.
    let all_tiles;
    if (this._use_scale_to_download_tiles) {
      all_tiles = tileSet.map(d => d)
        .filter(tile => tile.is_visible(max_ix, this.zoom.current_corners()))
      } else {
        all_tiles = tileSet.map(d => d)
          .filter(tile => tile.min_ix < this.max_ix)
      }
    all_tiles.sort((a, b) => a.min_ix - b.min_ix)

//    all_tiles.map(d => console.log(`${d.key} (${d.min_ix} - ${d.max_ix})`))

    return all_tiles
  }

  bind_zoom(zoom) {
    this.zoom = zoom;
    return this
  }


  *initialize() {
    // Asynchronously wait for the basic elements to be done.
    return Promise.all(this._initializations).then(d => {
      this.zoom.restart_timer(500000)
    })

  }
}

export class CanvasRenderer extends Renderer {

}
