import { select, event } from 'd3-selection';
import { timer, timerFlush, interval } from 'd3-timer';
import { zoom, zoomTransform, zoomIdentity } from 'd3-zoom';
import { mean, range, min, extent } from 'd3-array';
import { scaleLinear } from 'd3-scale';

/*export class Mouseover {
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
}*/

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

     this.renderers = new Map();
  }

  attach_tiles(tiles) {
    this.tileSet = tiles;
    this.tileSet._zoom = this
    return this;
  }

  attach_renderer(key, renderer) {
    renderer.zoom = this;
    this.renderers.set(key, renderer);
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

  zoom_to_bbox(corners, duration = 4) {

    // Zooms to two points.
    const scales = this.scales();
    const [x0, x1] = corners.x.map(scales.x)
    const [y0, y1] = corners.y.map(scales.y)

    console.log(x0, y0, x1, y1)
    const { canvas, zoomer, width, height } = this;

    const t = zoomIdentity
        .translate(width / 2, height / 2)
        .scale(0.9 / Math.max((x1 - x0) / width, (y1 - y0) / height))
        .translate(-(x0 + x1) / 2, -(y0 + y1) / 2)

    canvas
      .transition()
      .duration(duration * 1000)
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
            this.restart_timer(10 * 1000)
          })

    canvas.call(zoomer);

    this.add_mouseover()

    this.zoomer = zoomer

  }

  add_mouseover() {

    const defaultClick = "`window.open('https://babel.hathitrust.org/cgi/pt?id=${datum.id}', target = 'blank')`"

    const clickfunc = new Function("datum",
      "window.open(`https://babel.hathitrust.org/cgi/pt?id=${datum.id}`, target = 'blank')")

    let last_fired = 0;

    const labels = select("#deepscatter-svg")
      .append("g")
      .attr("class", "label")


    this.canvas.on("mousemove", () => {

      // Debouncing this is really important, it turns out.
      if (Date.now() - last_fired < 50) {
        return
      }
      last_fired = Date.now()

      const {x_, y_} = this.scales() || {}

      // Might happen before the data is loaded.
      if (x_ === undefined) {return}
      const closest = this.tileSet.find_closest(
        [x_.invert(event.x),
         y_.invert(event.y)
       ],
       undefined
/*       function(node) {
          return true
       } */
     );

    // if undefined, empty arrary.
    const data = closest ? [closest] : [];

    const labelSet = labels
      .selectAll("g")
      .data(data)
      .join("g")
      .attr("transform", d => `translate(
        ${x_(d.x)},
        ${y_(d.y)}
      )`)      .on("click", d => clickfunc(d))

      /*
    */
    labelSet
      .selectAll("circle")
      .data(d => [d])
      .join("circle")
      .attr("r", 6)
      .style("fill", "pink")

    labelSet
      .selectAll("text")
      .data(d => [d])
      .join("text")
      .attr("transform", "translate(3, 3)")
      .text(d => d[this.prefs.label_field])
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

  restart_timer(run_at_least = 10000) {
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

  scales(equal_units = true) {
    // General x and y scales that map from data space
    // to pixel coordinates, and also
    // rescaled ones that describe the current zoom.
    // The base scales are called 'x' and 'y',
    // and the zoomed ones are called 'x_' and 'y_'.

    // equal_units: should a point of x be the same as a point of y?

    if (this._scales) {
      this._scales.x_ = this.transform.rescaleX(this._scales.x)
      this._scales.y_ = this.transform.rescaleY(this._scales.y)
      return this._scales
    }

    const { width, height, tileSet } = this;

    const { extent } = this.tileSet

    const scales = {};
    if (extent === undefined) {
      return undefined;
    }

    const scale_dat = {'x': {}, 'y': {}}

    for (let [name, dim] of [['x', width], ['y', height]]) {
      const limits = extent[name]
      scale_dat[name].limits = limits;
      scale_dat[name].size_range = limits[1] - limits[0]
      scale_dat[name].pixels_per_unit = dim / scale_dat[name].size_range
    }

    const data_aspect_ratio =
       scale_dat.x.pixels_per_unit / scale_dat.y.pixels_per_unit

    let x_buffer_size = 0, y_buffer_size = 0,
    x_target_size = width, y_target_size = height;
    if (data_aspect_ratio > 1) {
      // There are more pixels in the x dimension, so we need a buffer
      // around it.
      x_target_size = width / data_aspect_ratio;
      x_buffer_size = (width - x_target_size)/2
    } else {
      y_target_size = height * data_aspect_ratio;
      y_buffer_size = (height - y_target_size)/2
    }


    scales.x =
      scaleLinear()
      .domain(scale_dat.x.limits)
      .range([x_buffer_size, width-x_buffer_size])

    scales.y =
      scaleLinear()
      .domain(scale_dat.y.limits)
      .range([y_buffer_size, height-y_buffer_size])

    scales.x_ = this.transform.rescaleX(scales.x)
    scales.y_ = this.transform.rescaleY(scales.y)

    this._scales = scales
    return scales
  }

  webgl_scale(flatten = true) {
    const {width, height} = this
    const {x, y} = this.scales()
    let transform = window_transform(x, y).flat()
    return transform
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

    for (let renderer of this.renderers.values()) {
      try {
        renderer.tick()
      } catch(err) {
        this._timer.stop()
        throw err
      }
    }
  }
}


export function window_transform(x_scale, y_scale) {

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

  // translates from data space to scaled space.
  const m1 =  [
    // transform by the scale;
    [xmulti, 0, -xmulti * x_mid + mean(x_scale.range()) ],
    [0, ymulti, -ymulti * y_mid + mean(y_scale.range()) ],
    [0, 0, 1]
  ]

  // Note--at the end, you need to multiply by this matrix.
  // I calculate it directly on the GPU.
  // translate from scaled space to webgl space.
  // The '2' here is because webgl space runs from -1 to 1.
  /*const m2 = [
    [2 / width, 0, -1],
    [0, - 2 / height, 1],
    [0, 0, 1]
  ]*/

  return m1
}
