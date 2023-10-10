/* eslint-disable no-underscore-dangle */
import { select } from 'd3-selection';
import { min } from 'd3-array';
import type Scatterplot from './deepscatter';
import type { Tile } from './tile';
import type Zoom from './interaction';
import type { AestheticSet } from './AestheticSet';
import { timer, Timer } from 'd3-timer';
import { Dataset } from './Dataset';
import type * as DS from './shared.d'
import { Table } from 'apache-arrow';
import { X } from './Aesthetic';
class PlotSetting {
  start: number;
  value: number;
  target: number;
  timer: Timer | undefined;
  transform: 'geometric' | 'arithmetic' = 'arithmetic';
  constructor(
    start: number,
    transform: 'geometric' | 'arithmetic' = 'arithmetic' as const
  ) {
    this.transform = transform;
    this.start = start;
    this.value = start;
    this.target = start;
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
      this.value =
        this.transform === 'geometric'
          ? this.start ** w1 * this.target ** w2
          : this.start * w1 + this.target * w2;
    });
    this.timer = timer_object;
  }
}

class RenderProps {
  // Aesthetics that adhere to the state of the _renderer_
  // as opposed to the individual points.
  // These can transition a little more beautifully.
  maxPoints: PlotSetting;
  targetOpacity: PlotSetting;
  pointSize: PlotSetting;
  foregroundOpacity: PlotSetting;
  backgroundOpacity: PlotSetting;
  foregroundSize: PlotSetting;
  backgroundSize: PlotSetting;
  constructor() {
    this.maxPoints = new PlotSetting(10_000, 'geometric');
    this.pointSize = new PlotSetting(1, 'geometric');
    this.targetOpacity = new PlotSetting(50);
    this.foregroundOpacity = new PlotSetting(1);
    this.backgroundOpacity = new PlotSetting(0.5);
    this.foregroundSize = new PlotSetting(1, 'geometric');
    this.backgroundSize = new PlotSetting(1, 'geometric');
  }
  apply_prefs(prefs: DS.CompletePrefs) {
    const { duration } = prefs;
    this.maxPoints.update(prefs.max_points, duration);
    this.targetOpacity.update(prefs.alpha, duration);
    this.pointSize.update(prefs.point_size, duration);
    this.foregroundOpacity.update(
      prefs.background_options.opacity[1],
      duration
    );
    this.backgroundOpacity.update(
      prefs.background_options.opacity[0],
      duration
    );
    this.foregroundSize.update(prefs.background_options.size[1], duration);
    this.backgroundSize.update(prefs.background_options.size[0], duration);
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
  get foreground_opacity() {
    return this.foregroundOpacity.value;
  }
  get background_opacity() {
    return this.backgroundOpacity.value;
  }
  get foreground_size() {
    return this.foregroundSize.value;
  }
  get background_size() {
    return this.backgroundSize.value;
  }
}

export class Renderer<TileType extends Tile> {
  // A renderer handles drawing to a display element.
  public scatterplot: Scatterplot<TileType>;
  public holder: d3.Selection<any, any, any, any>;
  public canvas: HTMLCanvasElement;
  public dataset: Dataset<TileType>;
  public width: number;
  public height: number;
  public deferred_functions: Array<() => Promise<void> | void>;
  public _use_scale_to_download_tiles = true;
  public zoom?: Zoom<TileType>;
  public aes?: AestheticSet<TileType>;
  public _zoom?: Zoom<TileType>;
  public _initializations: Promise<void>[] = [];
  public render_props: RenderProps = new RenderProps();
  constructor(
    selector: string,
    tileSet: Dataset<TileType>,
    scatterplot: Scatterplot<TileType>
  ) {
    this.scatterplot = scatterplot;
    this.holder = select(selector);
    this.canvas = select(
      this.holder.node().firstElementChild
    ).node() as HTMLCanvasElement;
    this.dataset = tileSet;
    this.width = +select(this.canvas).attr('width');
    this.height = +select(this.canvas).attr('height');
    this.deferred_functions = [];
    this._use_scale_to_download_tiles = true;
  }

  get discard_share() {
    // If jitter is temporal, e.g., or filters are in place,
    // it may make sense to estimate the number of hidden points.
    // For now, I don't actually do it.
    return 0;
  }
  /**
   * Render prefs are scatterplot prefs, but for a single tile
   * instead of for a whole table.
   */
  get prefs() {
    const p = { ...this.scatterplot.prefs } as DS.CompletePrefs & {arrow_table?: Table, arrow_buffer?: Uint8Array };
    // Delete the arrow stuff b/c serializing it is crazy expensive.
    p.arrow_table = undefined;
    p.arrow_buffer = undefined;
    return p;
  }

  get alpha() {
    return this.render_props.alpha;
  }

  get optimal_alpha() {
    // This extends a formula suggested by Ricky Reusser to include
    // discard share.

    const zoom_balance = this.prefs.zoom_balance ?? 1;
    const { alpha, point_size, max_ix, width, discard_share, height } = this;
    const k = this.zoom?.transform?.k ?? 1;
    const target_share = alpha / 100;
    const fraction_of_total_visible = 1 / k ** 2;
    const pixelRatio = window.devicePixelRatio || 1;

    const pixel_area = (width * height) / pixelRatio;
    const total_intended_points = min([
      max_ix,
      (this.dataset.highest_known_ix) || 1e10,
    ]);

    const total_points = total_intended_points * (1 - discard_share);

    const size_adjust = Math.exp(Math.log(k) * zoom_balance);
    const area_of_point =
      Math.PI * ((size_adjust * point_size) / pixelRatio / 2) ** 2;
    const target =
      (target_share * pixel_area) /
      (total_points * fraction_of_total_visible * area_of_point);
    // constrain within realistic bounds.
    // would also be possible to adjust size to meet the goal.
    return target < 1 / 255 ? 1 / 255 : target;
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
    return (max_points * k * k) / point_size_adjust / point_size_adjust;
  }

  visible_tiles(): Array<TileType> {
    // yield the currently visible tiles based on the zoom state
    // and a maximum index passed manually.
    const { max_ix } = this;
    const { dataset: tileSet } = this;
    // Materialize using a tileset method.

    const x = this.aes.dim('x') as X;
    const natural_display =
      this.aes.dim('x').current.field == 'x' &&
      this.aes.dim('y').current.field == 'y' &&
      this.aes.dim('x').last.field == 'x' &&
      this.aes.dim('y').last.field == 'y';

    const all_tiles = natural_display
      ? tileSet
          .map((d: TileType) => d)
          .filter((tile) => {
            const visible = tile.is_visible(
              max_ix,
              this.zoom.current_corners()
            );
            return visible;
          })
      : tileSet.map((d) => d).filter((tile) => tile.min_ix < this.max_ix);
    all_tiles.sort((a, b) => a.min_ix - b.min_ix);
    return all_tiles;
  }

  bind_zoom(zoom: Zoom) {
    this.zoom = zoom;
    return this;
  }

  async initialize() {
    // Asynchronously wait for the basic elements to be done.
    // await this._initializations;
    // this.zoom.restart_timer(500_000);
  }
}
