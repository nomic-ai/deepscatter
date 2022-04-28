/* eslint-disable no-underscore-dangle */
import { select } from 'd3-selection';
import { min } from 'd3-array';
import type Scatterplot from './deepscatter'
import type { Tileset } from './tile';
import type { APICall } from './types';
import type Zoom from './interaction';
import type { AestheticSet } from './AestheticSet';

export class Renderer {
  // A renderer handles drawing to a display element.
  public scatterplot : Scatterplot;
  public holder : d3.Selection<any, any, any, any>;
  public canvas : d3.Selection<HTMLCanvasElement, any, any, any>;
  public tileSet : Tileset;
  public prefs : APICall;
  public width : number;
  public height : number;
  public deferred_functions : Array<() => void>;
  public _use_scale_to_download_tiles : boolean = true;
  public zoom : Zoom;
  public aes : AestheticSet;
  public _current_click_function_string : string;
  public _click_function : () => void;
  public _zoom : Zoom;
  public _initializations : Promise<any>[];
  constructor(selector, tileSet, scatterplot) {
    this.scatterplot = scatterplot;
    this.holder = select(selector);
    this.canvas = select(this.holder.node().firstElementChild);
    this.tileSet = tileSet;
    this.prefs = scatterplot.prefs;
    this.width = +this.canvas.attr('width');
    this.height = +this.canvas.attr('height');
    this.deferred_functions = [];
    this._use_scale_to_download_tiles = true;
  }

  get discard_share() {
    // If jitter is temporal, e.g., or filters are in place,
    // it may make sense to estimate the number of hidden points.
    // For now, I don't actually do it.
    return 0;
  }

  //color_pick() {
  //  return 1;
  //}

  get optimal_alpha() {
    let { zoom_balance, alpha, point_size } = this.prefs;
    const {
      max_ix, width, discard_share, height,
    } = this;
    const { k } = this.zoom.transform;
    alpha = alpha === undefined ? 0.25 : alpha;
    const target_share = alpha;
    const fraction_of_total_visible = 1 / k ** 2;
    const pixel_area = width * height;
    const total_intended_points = min([max_ix, this.tileSet.highest_known_ix]);
    const total_points = total_intended_points * (1 - discard_share);
    const area_of_point = (Math.PI * Math.exp(Math.log(1 * k) * zoom_balance) * point_size) ** 2;
    // average_alpha * pixel_area = total_points * fraction_of_total_visible *
    // area_of_point * target_opacity
    const target = (target_share * pixel_area)
      / (total_points * fraction_of_total_visible * area_of_point);
    return target > 1 ? 1 : target < 1 / 255 ? 1 / 255 : target;
  }

  get max_ix() {
    // By default, prefer dropping points to dropping alpha.
    const { prefs } = this;
    if (!this._use_scale_to_download_tiles) {
      return prefs.max_points;
    }
    const { k } = this.zoom.transform;
    const point_size_adjust = Math.exp(Math.log(k) * prefs.zoom_balance);
    return prefs.max_points * k * k / point_size_adjust / point_size_adjust;
  }
  /*
  is_visible(point) {
    return p_in_rect(point, this._zoom.current_corners)
    && point.ix < this.prefs.max_points * this._zoom.transform.k;
  } */

  visible_tiles() {
    // yield the currently visible tiles based on the zoom state
    // and a maximum index passed manually.
    //    console.log({ix: this.max_ix})
    const { max_ix } = this;
    const { tileSet } = this;
    // Materialize using a tileset method.
    let all_tiles;
    let natural_display = this.aes.dim('x').current.field == 'x' &&
      this.aes.dim('y').current.field == 'y' &&
      this.aes.dim('x').last.field == 'x' &&
      this.aes.dim('y').last.field == 'y';

    if (natural_display) {
      all_tiles = tileSet.map((d) => d)
        .filter((tile) => tile.is_visible(max_ix, this.zoom.current_corners()));
    } else {
      console.log(this.aes.dim('y').last.field, "not using natural display filtering.")
      all_tiles = tileSet.map((d) => d)
        .filter((tile) => tile.min_ix < this.max_ix);
    }
    all_tiles.sort((a, b) => a.min_ix - b.min_ix);
    return all_tiles;
  }

  bind_zoom(zoom) {
    this.zoom = zoom;
    return this;
  }

  _click_function_from_string() {
    return Function("datum", this.scatterplot.prefs.click_function)
  }

  _click_function_matches_prefs() {
    if (this._click_function_type == "string" && this._click_function == this._click_function_from_string()) {
      return true
    } else if (this._click_function_type == "function" && this._click_function == this.scatterplot.prefs.click_function) {
      return true
    }

    return false
  }

  set click_function(f) {
    if (typeof(this.scatterplot.prefs.click_function) == "function") {
      this._click_function_type = "function"
      this._click_function = this.scatterplot.prefs.click_function
    } else if (typeof(this.scatterplot.prefs.click_function) == "string") {
      this._click_function_type = "string"
      this._click_function = this._click_function_from_string()
    } else {
      // Make sure _click_function is always defined, but use a no-op if we
      // don't recognize the input type.
      console.warn('Unrecognized click_function type; should be string or function.')
      this._click_function_type = null
      this._click_function = (function() {})
    }
  }

  get click_function() {
    // If the click function is unset or doesn't match the current preferences,
    // set it before returning it..
    if ( !(this._click_function) || !(this._click_function_matches_prefs()) ) {
      this.click_function = this.scatterplot.prefs.click_function
    }

    return this._click_function
  }

  * initialize() {
    // Asynchronously wait for the basic elements to be done.
    return Promise.all(this._initializations).then((d) => {
      this.zoom.restart_timer(500000);
    });
  }
}

export class CanvasRenderer extends Renderer {

}
