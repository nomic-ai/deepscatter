import { select, event } from 'd3-selection';
import { timer, timerFlush, interval } from 'd3-timer';
import { zoom, zoomTransform, zoomIdentity } from 'd3-zoom';
import { range, min } from 'd3-array';

export default class Zoom {

  constructor(selector, prefs) {
    // There can be many canvases that display the zoom, but
    // this is initialized with the topmost most one that
    // also registers events.

    this.prefs = prefs;
    this.canvas = select(selector);
    this.width = +this.canvas.attr("width");
    this.height = +this.canvas.attr("height");

    // A zoom keeps track of all the renderers
    // that it's in charge of adjusting.

    this.renderers = [];
  }

  attach_tiles(tiles) {
    this.tileSet = tiles;
    return this;
  }

  attach_renderer(renderer) {
    renderer.zoom = this;
    this.renderers.push(renderer);
    renderer.zoom.initialize_zoom()
    return this;
  }

  zoom_to(k, x, y, duration = 100) {
    const { canvas, zoomer } = this;
    const t = zoomIdentity.translate(x, y).scale(k);
    canvas
      .transition()
      .duration(duration)
      .call(zoomer.transform, t);
  }

  initialize_zoom() {
    
    const { width, height, canvas } = this;
    console.log("INITIALIZING ZOOM", width, height, canvas);
    this.transform = zoomIdentity;

    const zoomer = zoom()
          .scaleExtent([1/3, 100000])
          .extent([[0, height], [width, 0]])
          .on("zoom", () => {
            this.transform = event.transform;
            this.renderers.forEach( d => d.tick())
          })
    canvas.call(zoomer);
    canvas.call(zoomer.translateBy, width/2, height/2);
    this.zoomer = zoomer
  }

  current_corners() {
    // The corners of the current zoom transform, in webgl coordinates.
    const { width, height } = this;
    const t = this.transform;
    const unscaled = [
      t.invert([0, 0]),
      t.invert([width, height])
    ]
    console.log("unscaled", unscaled)
    return {
      x: [unscaled[0][0]/width*2, unscaled[1][0]/width*2],
      y: [unscaled[0][1]/height*2, unscaled[1][1]/height*2],
      k: t.k
    }
  }

  restart_timer(run_at_least = 1000) {
    // Restart the timer and run it for
    // run_at_least milliseconds or the current timeout,
    // whichever is greater.

    const { tick, canvas } = this;
    let stop_at = Date.now() + run_at_least;
    if (this._timer) {
      if (this._timer.stop_at > stop_at) {
        stop_at = this._timer.stop_at
      }
      this._timer.stop()
    }

    const t = timer(this.tick.bind(this));
    this._timer = t;

    this._timer.stop_at = stop_at;

    timerFlush();

    return this._timer;
  }

  data(dataset) {
    if (data === undefined) {
      return this.tileSet
    } else {
      this.tileSet = dataset
      return this
    }
  }

  current_corners() {
    // The corners of the current zoom transform, in webgl coordinates.
    const { width, height } = this;
    const t = zoomTransform(this.canvas.node())
    const unscaled = [
      t.invert([0, 0]),
      t.invert([width, height])
    ]

    return {
      x: [unscaled[0][0]/width*2, unscaled[1][0]/width*2],
      y: [unscaled[0][1]/height*2, unscaled[1][1]/height*2],
      k: t.k
    }
  }

  webgl_scale(symmetrical = true) {
    // symmetrcial: do x and y need to take up the same units?
    const { tileSet, width, height } = this;

    const [xmin, xmax] = tileSet.limits[0]
    const [ymin, ymax] = tileSet.limits[1]
    const aspect_ratio = width/height;
    // multiply by 2 b/c webgl is in the range [-1, 1].
    const scale_factor = min([(xmax - xmin)/width*aspect_ratio, (ymax-ymin)/height]) * 2;

    let xscale, yscale;
    if (aspect_ratio < 1) {
      xscale = scale_factor;
      yscale = scale_factor * aspect_ratio;
    } else {
      xscale = scale_factor / aspect_ratio;
      yscale = scale_factor;
    }


    return [
      // transform by the scale;
      [xscale, 0, (xmin + xmax) / 2 * xscale / 2],
      [0, yscale, (ymin + ymax) / 2 * yscale / 2],
      [0, 0, 1]
    ]
  }

  tick(force = false) {

    this._start = this._start || Date.now()

    // Force indicates that the tick must run even the timer metadata
    // says we are not animating.

    if (this._timer) {
      console.log(Date.now() - this._timer.stop_at, this._timer.stop_at <= Date.now())
    }
    if (force !== true) {
      if (this._timer) {
        if (this._timer.stop_at <= Date.now()) {
          console.log("Timer ending")
          this._timer.stop()
          return;
        }
      }
    }

    for (let renderer of this.renderers) {
      renderer.tick()
    }
  }
}
