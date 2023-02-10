/* eslint-disable no-underscore-dangle */
import { select } from 'd3-selection';
import { timer } from 'd3-timer';
import { zoom, zoomIdentity } from 'd3-zoom';
import { mean } from 'd3-array';
import { ScaleLinear, scaleLinear } from 'd3-scale';
// import { annotation, annotationLabel } from 'd3-svg-annotation';
import type { Renderer } from './rendering';
import type QuadtreeRoot from './tile';
import { ReglRenderer } from './regl_rendering';
import Scatterplot from './deepscatter';
import { StructRow } from 'apache-arrow';
import { Rectangle } from './tile';

export default class Zoom {
  public prefs: APICall;
  public svg_element_selection: d3.Selection<
    d3.ContainerElement,
    any,
    any,
    any
  >;
  public width: number;
  public height: number;
  public renderers: Map<string, Renderer>;
  public tileSet?: QuadtreeRoot;
  public _timer?: d3.Timer;
  public _scales?: Record<string, d3.ScaleLinear<number, number>>;
  public zoomer?: d3.ZoomBehavior<Element, any>;
  public transform?: d3.ZoomTransform;
  public _start?: number;
  public scatterplot: Scatterplot;
  constructor(selector: string, prefs: APICall, plot: Scatterplot) {
    // There can be many canvases that display the zoom, but
    // this is initialized with the topmost most one that
    // also registers events.

    this.prefs = prefs;

    this.svg_element_selection = select(selector);
    this.width = +this.svg_element_selection.attr('width');
    this.height = +this.svg_element_selection.attr('height');
    this.renderers = new Map();
    this.scatterplot = plot;
    // A zoom keeps track of all the renderers
    // that it's in charge of adjusting.

    this.renderers = new Map();
  }

  attach_tiles(tiles: QuadtreeRoot) {
    this.tileSet = tiles;
    this.tileSet._zoom = this;
    return this;
  }

  attach_renderer(key: string, renderer: Renderer) {
    this.renderers.set(key, renderer);
    renderer.bind_zoom(this);
    renderer.zoom.initialize_zoom();
    return this;
  }

  zoom_to(k: number, x = null, y = null, duration = 4000) {
    const scales = this.scales();
    const { svg_element_selection: canvas, zoomer, width, height } = this;

    const t = zoomIdentity
      .translate(width / 2, height / 2)
      .scale(k)
      .translate(-scales.x(x), -scales.y(y));

    canvas.transition().duration(duration).call(zoomer.transform, t);
  }

  html_annotation(points: Array<Record<string, string | number>>) {
    const div = this.svg_element_selection.node().parentNode.parentNode;
    let opacity = 0.75;
    if (this.scatterplot.prefs.tooltip_opacity !== undefined) {
      opacity = this.scatterplot.prefs.tooltip_opacity;
    }
    const els = select(div)
      .selectAll('div.tooltip')
      .data(points)
      .join(
        (enter) =>
          enter
            .append('div')
            .attr('class', 'tooltip')
            .style('top', 0)
            .style('left', 0)
            .style('position', 'absolute')
            .style('z-index', 100)
            .style('border-radius', '8px')
            .style('padding', '10px')
            .style('background', 'ivory')
            .style('opacity', opacity),
        (update) => update.html((d) => this.scatterplot.tooltip_html(d.data)),
        (exit) => exit.call((e) => e.remove())
      );

    els
      .html((d) => this.scatterplot.tooltip_html(d.data))
      .style('transform', (d) => {
        const t = `translate(${+d.x + d.dx}px, ${+d.y + d.dy}px)`;
        return t;
      });
  }

  zoom_to_bbox(corners, duration = 4000, buffer = 1.111) {
    // Zooms to two points.
    const scales = this.scales();
    const [x0, x1] = corners.x.map(scales.x);
    const [y0, y1] = corners.y.map(scales.y);

    const { svg_element_selection: canvas, zoomer, width, height } = this;

    const t = zoomIdentity
      .translate(width / 2, height / 2)
      .scale(1 / buffer / Math.max((x1 - x0) / width, (y1 - y0) / height))
      .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);

    canvas.transition().duration(duration).call(zoomer.transform, t);
  }

  initialize_zoom() {
    const { width, height, svg_element_selection: canvas } = this;
    this.transform = zoomIdentity;

    const zoomer = zoom()
      .scaleExtent([1 / 3, 100_000])
      .extent([
        [0, 0],
        [width, height],
      ])
      .on('zoom', (event) => {
        try {
          document.getElementById('tooltipcircle').remove();
        } catch (error) {}
        this.transform = event.transform;
        this.restart_timer(10 * 1000);

        this.scatterplot.on_zoom?.(event.transform);
        event?.sourceEvent?.stopPropagation();
        //        console.log({ event });
      });

    canvas.call(zoomer);

    this.add_mouseover();

    this.zoomer = zoomer;
  }

  synthetic_mouseover(feather_datum) {
    const datum = feather_datum;
    const renderer: ReglRenderer = this.renderers.get('regl');
    const x_aes = renderer.aes.dim('x').current;
    const y_aes = renderer.aes.dim('y').current;
    const { x_, y_ } = this.scales();

    try {
      select('#tooltipcircle').remove();
    } catch (e) {
      console.log('no circle');
    }
    window.x = this.svg_element_selection;
    this.svg_element_selection
      .select('#mousepoints')
      .append('circle')
      .attr('id', 'tooltipcircle')
      .attr('class', 'label')
      .attr('stroke', '#110022')
      .attr('r', 12)
      .attr('cx', x_(x_aes.value_for(datum)))
      .attr('cy', y_(y_aes.value_for(datum)));
  }

  add_mouseover() {
    let last_fired = 0;
    const renderer: ReglRenderer<any> = this.renderers.get(
      'regl'
    ) as ReglRenderer<any>;

    this.svg_element_selection.on('mousemove', (event) => {
      // Debouncing this is really important, it turns out.
      if (Date.now() - last_fired < 50) {
        return;
      }
      last_fired = Date.now();
      const p = renderer.color_pick(event.layerX, event.layerY);
      const data = p ? [p] : [];

      const d = data[0];
      const x_aes = renderer.aes.dim('x').current;
      const y_aes = renderer.aes.dim('y').current;

      type Annotation = {
        x: number;
        y: number;
        dx: number;
        dy: number;
        data: any;
      };
      const annotations: Annotation[] = d
        ? [
            {
              x: event.layerX,
              y: event.layerY,
              data: d,
              dx: 0,
              dy: 30,
            },
          ]
        : [];

      const { x_, y_ } = this.scales();

      this.html_annotation(annotations);
      window.x = this.svg_element_selection;

      const sel = this.svg_element_selection.select('#mousepoints');
      sel
        //        .append('circle')
        .selectAll('circle.label')
        .data(data, (d_) => d_.ix as number)
        .join(
          (enter) =>
            enter
              .append('circle')
              .attr('id', 'tooltipcircle')
              .attr('class', 'label')
              .attr('stroke', '#110022')
              .attr('r', 12)
              .attr('fill', (dd) =>
                this.renderers.get('regl').aes.dim('color').current.apply(dd)
              )
              .attr('cx', (datum) => x_(x_aes.value_for(datum)))
              .attr('cy', (datum) => y_(y_aes.value_for(datum))),
          (update) =>
            update.attr('fill', (dd) =>
              this.renderers.get('regl').aes.dim('color').current.apply(dd)
            ),
          (exit) =>
            exit.call((e) => {
              e.remove();
              if (this.prefs.exit_function) {
                this.prefs.exit_function();
              }
            })
        )
        .on('click', (ev, dd) => {
          this.scatterplot.click_function(dd);
        });
    });
  }

  current_corners(): Rectangle | undefined {
    // The corners of the current zoom transform, in data coordinates.
    const { width, height } = this;

    // Use the rescaled versions of the scales.
    const scales = this.scales();
    if (scales === undefined) {
      return;
    }
    const { x_, y_ } = scales;

    return {
      x: [x_.invert(0) as number, x_.invert(width) as number],
      y: [y_.invert(0) as number, y_.invert(height) as number],
    };
  }

  current_center() {
    const { x, y } = this.current_corners();
    return [(x[0] + x[1]) / 2, (y[0] + y[1]) / 2];
  }

  restart_timer(run_at_least = 10_000) {
    // Restart the timer and run it for
    // run_at_least milliseconds or the current timeout,
    // whichever is greater.
    let stop_at = Date.now() + run_at_least;
    if (this._timer) {
      //@ts-ignore
      if (this._timer.stop_at > stop_at) {
        //@ts-ignore
        stop_at = this._timer.stop_at;
      }
      this._timer.stop();
    }

    const t = timer(this.tick.bind(this));

    this._timer = t;
    //@ts-ignore
    this._timer.stop_at = stop_at;

    return this._timer;
  }

  data(dataset) {
    if (dataset === undefined) {
      return this.tileSet;
    }
    this.tileSet = dataset;
    return this;
  }

  scales(equal_units = true): Record<string, d3.ScaleLinear> {
    // General x and y scales that map from data space
    // to pixel coordinates, and also
    // rescaled ones that describe the current zoom.
    // The base scales are called 'x' and 'y',
    // and the zoomed ones are called 'x_' and 'y_'.

    // equal_units: should a point of x be the same as a point of y?

    if (this._scales) {
      this._scales.x_ = this.transform.rescaleX(this._scales.x);
      this._scales.y_ = this.transform.rescaleY(this._scales.y);
      return this._scales;
    }

    const { width, height } = this;
    if (this.tileSet === undefined) {
      throw new Error('Error--scales created before tileSet present.');
    }
    const { extent } = this.tileSet;
    const scales: Record<string, any> = {};
    if (extent === undefined) {
      throw new Error('Error--scales created before extent present.');
      return {};
    }

    interface Scale_datum {
      limits: [number, number];
      size_range: number;
      pixels_per_unit: number;
    }
    const scale_dat: Record<string, Scale_datum> = {};
    for (const [name, dim] of [
      ['x', width],
      ['y', height],
    ]) {
      const limits = extent[name];
      const size_range = limits[1] - limits[0];
      scale_dat[name] = {
        limits,
        size_range,
        pixels_per_unit: dim / size_range,
      };
    }

    const data_aspect_ratio =
      scale_dat.x.pixels_per_unit / scale_dat.y.pixels_per_unit;

    let x_buffer_size = 0;
    let y_buffer_size = 0;
    let x_target_size = width;
    let y_target_size = height;
    if (data_aspect_ratio > 1) {
      // There are more pixels in the x dimension, so we need a buffer
      // around it.
      x_target_size = width / data_aspect_ratio;
      x_buffer_size = (width - x_target_size) / 2;
    } else {
      y_target_size = height * data_aspect_ratio;
      y_buffer_size = (height - y_target_size) / 2;
    }

    scales.x = scaleLinear()
      .domain(scale_dat.x.limits)
      .range([x_buffer_size, width - x_buffer_size]);

    scales.y = scaleLinear()
      .domain(scale_dat.y.limits)
      .range([y_buffer_size, height - y_buffer_size]);

    scales.x_ = this.transform.rescaleX(scales.x);
    scales.y_ = this.transform.rescaleY(scales.y);

    this._scales = scales;
    return scales;
  }

  webgl_scale(flatten = true) {
    const { x, y } = this.scales();
    const transform = window_transform(x, y).flat();
    return transform;
  }

  tick(force = false) {
    this._start = this._start || Date.now();

    // Force indicates that the tick must run even the timer metadata
    // says we are not animating.

    if (
      force !== true &&
      this._timer && //@ts-ignore
      this._timer.stop_at <= Date.now()
    ) {
      this._timer.stop();
    }
    /*
    for (const renderer of this.renderers.values()) {
      try {
        // renderer.tick()
      } catch (err) {
        this._timer.stop();
        throw err;
      }
    } */
  }
}

export function window_transform(x_scale: ScaleLinear, y_scale) {
  // width and height are svg parameters; x and y scales project from the data x and y into the
  // the webgl space.

  // Given two d3 scales in coordinate space, create two matrices that project from the original
  // space into [-1, 1] webgl space.

  function gap(array) {
    // Return the magnitude of a scale.
    return array[1] - array[0];
  }

  const x_mid = mean(x_scale.domain());
  const y_mid = mean(y_scale.domain());

  const xmulti = gap(x_scale.range()) / gap(x_scale.domain());
  const ymulti = gap(y_scale.range()) / gap(y_scale.domain());

  // translates from data space to scaled space.
  const m1 = [
    // transform by the scale;
    [xmulti, 0, -xmulti * x_mid + mean(x_scale.range())],
    [0, ymulti, -ymulti * y_mid + mean(y_scale.range())],
    [0, 0, 1],
  ];
  // Note--at the end, you need to multiply by this matrix.
  // I calculate it directly on the GPU.
  // translate from scaled space to webgl space.
  // The '2' here is because webgl space runs from -1 to 1.
  /* const m2 = [
    [2 / width, 0, -1],
    [0, - 2 / height, 1],
    [0, 0, 1]
  ] */

  return m1;
}
