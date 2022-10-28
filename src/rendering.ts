/* eslint-disable no-underscore-dangle */
import { select } from 'd3-selection';
import { min } from 'd3-array';
import type Scatterplot from './deepscatter';
import type { Tile, Tileset } from './tile';
import type { APICall } from './types';
import type Zoom from './interaction';
import type { AestheticSet } from './AestheticSet';
import { timer, Timer } from 'd3-timer';
import type { Dataset } from './Dataset';

abstract class PlotSetting {
  abstract start: number;
  abstract value: number;
  abstract target: number;
  timer : Timer | undefined;
  transform: 'geometric' | 'arithmetic';
  constructor() {
    this.transform = 'arithmetic';
  }
  update(value: number, duration: number) {
    if (duration === 0) {
      this.value = value;
      if (this.timer !== undefined) {
        this.timer.stop();
      }
      return;
    }
    this.start = this.value;
    this.target = value;
    this.start_timer(duration);
  }
  start_timer(duration: number) {
    if (this.timer !== undefined) {
      this.timer.stop();
    }
    const timer_object = timer((elapsed) => {
      const t = elapsed / duration;
      if (t >= 1) {
        this.value = this.target;
        timer_object.stop();
        return;
      }
      const w1 = 1 - t;
      const w2 = t;
      this.value = this.transform === 'geometric' ? this.start ** (w1) * this.target ** (w2) : this.start * (w1) + this.target * (w2);
    });
    this.timer = timer_object;
  }
}

class MaxPoints extends PlotSetting {
  value = 10_000;
  start = 10_000;
  target = 10_000;
  constructor() {
    super();
    this.transform = 'geometric';
  }
}

class TargetOpacity extends PlotSetting {
  value = 10;
  start = 10;
  target = 10;
}

class PointSize extends PlotSetting {
  value = 2;
  start = 2;
  target = 2;
  constructor() {
    super();
    this.transform = 'geometric';
  }
}

class RenderProps {
  // Aesthetics that adhere to the state of the _renderer_
  // as opposed to the individual points.
  // These can transition a little more beautifully.
  maxPoints: MaxPoints;
  targetOpacity: TargetOpacity;
  pointSize: PointSize;
  constructor() {
    this.maxPoints = new MaxPoints();
    this.targetOpacity = new TargetOpacity();
    this.pointSize = new PointSize();
  }
  apply_prefs(prefs : APICall) {

    const { duration } = prefs;
    this.maxPoints.update(prefs.max_points, duration);
    this.targetOpacity.update(prefs.alpha, duration);
    this.pointSize.update(prefs.point_size, duration);
  }
  get max_points() {
    return this.maxPoints.value;
  }
  get alpha() {
    return this.targetOpacity.value;
  }
  get point_size() {
    return this.pointSize.value;
  }
}

export class Renderer {
  // A renderer handles drawing to a display element.
  public scatterplot : Scatterplot;
  public holder : d3.Selection<any, any, any, any>;
  public canvas : d3.Selection<any, any, any, any>;
  public tileSet : Tileset;
  public width : number;
  public height : number;
  public deferred_functions : Array<() => void>;
  public _use_scale_to_download_tiles  = true;
  public zoom : Zoom;
  public aes : AestheticSet;
  public _zoom : Zoom;
  public _initializations : Promise<any>[];
  public render_props : RenderProps;
  constructor(selector: string, tileSet: Dataset<Tile>, scatterplot: Scatterplot) {
    this.scatterplot = scatterplot;
    this.holder = select(selector);
    this.canvas = select(this.holder.node().firstElementChild);
    this.tileSet = tileSet;
    this.width = +this.canvas.attr('width');
    this.height = +this.canvas.attr('height');
    this.deferred_functions = [];
    this._use_scale_to_download_tiles = true;
    this.render_props = new RenderProps();
  }

  get discard_share() {
    // If jitter is temporal, e.g., or filters are in place,
    // it may make sense to estimate the number of hidden points.
    // For now, I don't actually do it.
    return 0;
  }

  get prefs() : APICall{
    const p = { ...this.scatterplot.prefs };
    p.arrow_table = undefined;
    p.arrow_buffer = undefined;
    return p;

  }

  //color_pick() {
  //  return 1;
  //}

  get alpha() {
    return this.render_props.alpha;
  }
  get optimal_alpha() {
    // This is extends a formula suggested by Ricky Reusser.

    const { zoom_balance } = this.prefs;
    const {
      alpha, point_size,
      max_ix, width, discard_share, height,
    } = this;
    const { k } = this.zoom.transform;
    const target_share = alpha;
    const fraction_of_total_visible = 1 / k ** 2;
    const pixel_area = width * height;
    const total_intended_points = min([max_ix, this.tileSet.highest_known_ix || 1e10]);
    const total_points = total_intended_points * (1 - discard_share);
    const area_of_point = (Math.PI * Math.exp(Math.log(1 * k) * zoom_balance) * point_size) ** 2;
    const target = (target_share * pixel_area)
      / (total_points * fraction_of_total_visible * area_of_point);
    // constrain within realistic bounds.
    // would also be possible to adjust size to meet the goal.
    return target > 1 ? 1 : (target < 1 / 255 ? 1 / 255 : target);
  }

  get point_size() {
    return this.render_props.point_size;
  }
  get max_ix() {
    // By default, prefer dropping points to dropping alpha.
    const { prefs } = this;
    const { max_points } = this.render_props;
    if (!this._use_scale_to_download_tiles) {
      return max_points;
    }
    const { k } = this.zoom.transform;
    const point_size_adjust = Math.exp(Math.log(k) * prefs.zoom_balance);
    return max_points * k * k / point_size_adjust / point_size_adjust;
  }

  visible_tiles(): Tile[] {
    // yield the currently visible tiles based on the zoom state
    // and a maximum index passed manually.
    const { max_ix } = this;
    const { tileSet } = this;
    // Materialize using a tileset method.
    let all_tiles: Tile[];
    const natural_display = this.aes.dim('x').current.field == 'x' &&
      this.aes.dim('y').current.field == 'y' &&
      this.aes.dim('x').last.field == 'x' &&
      this.aes.dim('y').last.field == 'y';
    
    all_tiles = natural_display ? tileSet.map((d : Tile) => d)      
      .filter((tile) => {
        const visible = tile.is_visible(max_ix, this.zoom.current_corners());
        return visible;
      }) : tileSet.map((d) => d)
      .filter((tile) => tile.min_ix < this.max_ix);
    all_tiles.sort((a, b) => a.min_ix - b.min_ix);
    return all_tiles;
  }

  bind_zoom(zoom : Zoom) {
    this.zoom = zoom;
    return this;
  }

  async initialize() {
    // Asynchronously wait for the basic elements to be done.
    await this._initializations;
    this.zoom.restart_timer(500_000);
  }
}
