import { select, event } from 'd3-selection';
import { timer, timerFlush, interval } from 'd3-timer';
import { zoom, zoomTransform, zoomIdentity } from 'd3-zoom';
import { mean, range, min, extent } from 'd3-array';
import { scaleLinear } from 'd3-scale';

export class Mouseover {
  // Easiest just to inherit from zoom.
  constructor(zoom) {
    zoom.canvas.on("mouseover", () => {
      const {x_, y_} = zoom.scales()
      const closest = zoom.tileSet.find_closest(
        [x_.invert(event.x),
         y_.invert(event.y)
        ])
    })
  }
}

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

  zoom_to(k, x, y, duration = 4000) {

    const scales = this.scales()
    const { canvas, zoomer, width, height } = this;

    const t = zoomIdentity
    .translate(width/2, height/2)
    .scale(k)
    .translate(-scales.x(x), -scales.y(y))

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
          .extent([[0, 0], [width, height]])
          .on("zoom", () => {
            this.transform = event.transform;
            this.renderers.forEach( d => d.tick())
          })

    canvas.call(zoomer);

    this.add_mouseover()

    this.zoomer = zoomer

  }

  add_mouseover() {
    const tel = select("#deepscatter-svg")
    .selectAll("g.label")
    .data([1])

    tel
    .enter()
    .append("g")
    .attr("class", "label")
    .merge(tel)

    tel.append("circle")
    .attr("r", 3)
    .style("fill", "pink")
    tel.append("text")

    this.canvas.on("mousemove", () => {
      const {x_, y_} = this.scales()
      const closest = this.tileSet.find_closest(
        [x_.invert(event.x),
         y_.invert(event.y)
        ])

      tel
      .attr("transform", `translate(
        ${x_(closest.x)},
        ${y_(closest.y)}
      )`)
        .select("text")
        .text(closest[this.prefs.label_field])

        .style("font-size", "18px")
        .style("fill", "white")

    })
  }


  current_corners() {
    // The corners of the current zoom transform, in data coordinates.
    const { width, height, transform } = this;

    // Use the rescaled versions of the scales.
    const scales = this.scales()
    if (scales === undefined) {
      return undefined
    }
    const {x_, y_ } = scales;

    return {
      x: [x_.invert(0), x_.invert(width)],
      y: [y_.invert(0), y_.invert(width)]
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

  scales() {
    // General x and y scales that map from data space
    // to pixel coordinates, and also
    // rescaled ones that describe the current zoom.
    // The base scales are called 'x' and 'y',
    // and the zoomed ones are called 'x_' and 'y_'.
    if (this._scales) {
      this._scales.x_ = this.transform.rescaleX(this._scales.x)
      this._scales.y_ = this.transform.rescaleY(this._scales.y)
      return this._scales
    }

    const { width, height, tileSet } = this;
    const square_box = min([width, height])

    const scales = {};
    if (this.tileSet.limits === undefined) {
      return undefined;
    }

    for (let [name, dim] of [['x', width], ['y', height]]) {
      // The smaller dimension is buffered on either
      // both sides.
      const buffer = (dim - square_box)/2
      const limits = tileSet.limits[name]
      scales[name] =
        scaleLinear()
        .domain(limits)
        .range([buffer, dim-buffer])
    }

    scales.x_ = this.transform.rescaleX(scales.x)
    scales.y_ = this.transform.rescaleY(scales.y)

    this._scales = scales
    return scales
  }

  webgl_scale(flatten = true) {
    const {width, height} = this
    const {x, y} = this.scales()
    let values = window_transform(x, y, width, height)
    if (flatten) {
      // Needed for regl, although unclear
      values = values.map(d => d.flat())
    }
    return values
  }

  tick(force = false) {

    this._start = this._start || Date.now()

    // Force indicates that the tick must run even the timer metadata
    // says we are not animating.

    if (this._timer) {
      // console.log(Date.now() - this._timer.stop_at, this._timer.stop_at <= Date.now())
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


function window_transform(x_scale, y_scale, width, height) {

  // width and height are svg parameters; x and y scales project from the data x and y into the
  // the webgl space.

  // Given two d3 scales in coordinate space, create two matrices that project from the original
  // space into [-1, 1] webgl space.


  function gap(array) {
    // Return the magnitude of a scale.
    return array[1] - array[0]
  }

  let x_mid = mean(x_scale.domain())
  let y_mid = mean(y_scale.domain())

  const xmulti = gap(x_scale.range())/gap(x_scale.domain());
  const ymulti = gap(y_scale.range())/gap(y_scale.domain());

  // the xscale and yscale ranges may not be the full width or height.

  const aspect_ratio = width/height;

  // translates from data space to scaled space.
  const m1 =  [
    // transform by the scale;
    [xmulti, 0, -xmulti * x_mid + mean(x_scale.range()) ],
    [0, ymulti, -ymulti * y_mid + mean(y_scale.range()) ],
    [0, 0, 1]
  ]

  // translate from scaled space to webgl space.
  // The '2' here is because webgl space runs from -1 to 1.
  const m2 = [
    [2 / width, 0, -1],
    [0, - 2 / height, 1],
    [0, 0, 1]
  ]

  return [m1, m2]
}
