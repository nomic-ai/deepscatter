import { GeoJsonObject } from 'geojson';
import { Renderer } from './rendering';
import { BBox, RBush3D } from 'rbush-3d';
import { QuadtileSet } from './Dataset';
import Scatterplot from './deepscatter';
import { Timer, timer } from 'd3-timer';

export class LabelMaker extends Renderer {
  public layers: GeoJsonObject[] = [];
  public ctx: CanvasRenderingContext2D;
  public tree: DepthTree;
  public timer?: Timer;
  public label_key: string;

  constructor(selector: string, scatterplot: Scatterplot) {
    super(scatterplot.div.node(), scatterplot._root, scatterplot);
    this.canvas = scatterplot.elements[2].selectAll('canvas').node();
    this.tree = new DepthTree(0.5, [1, 1e6], this.ctx);
    this.tree.accessor = (x, y) => {
      const f = scatterplot._zoom.scales();
      return [f.x(x), f.y(y)];
    };
    this.bind_zoom(scatterplot._renderer.zoom);
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
  }

  start(ticks: number = 1e6) {
    // Render for a set number of ticks. Probably overkill.
    if (this.timer) {
      this.timer.stop();
    }

    this.timer = timer(() => {
      this.render();
      ticks -= 1;
      if (ticks <= 0) {
        this.stop();
      }
    });
  }

  stop() {
    if (this.timer) {
      this.timer.stop();
      this.ctx.clearRect(0, 0, 4096, 4096);
      this.timer = undefined;
    }
  }

  public update(
    featureset: GeoJSON.FeatureCollection,
    label_key: string,
    size_key: string,
    color_key
  ) {
    // Insert an entire feature collection all at once.
    this.tree = new DepthTree(0.5, [0.1, 1e6], this.ctx);
    this.label_key = label_key;

    for (const feature of featureset.features) {
      const { properties, geometry } = feature;
      if (geometry.type === 'Point') {
        let size = 18;
        let label = '';
        if (
          properties[size_key] !== undefined &&
          properties[size_key] !== null
        ) {
          size *= properties[size_key];
        }
        if (
          properties[label_key] !== undefined &&
          properties[label_key] !== null
        ) {
          label = properties[label_key];
        }
        const p: RawPoint = {
          x: geometry.coordinates[0],
          y: geometry.coordinates[1],
          text: label,
          height: size,
        };
        // bulk insert not supported
        this.tree.insert_point(p);
      }
    }
    console.log(this.tree.insertion_log);
  }

  render() {
    const context = this.ctx;
    const { x_, y_ } = this.zoom.scales();
    const { transform } = this.zoom;
    const { width, height } = this;

    context.clearRect(0, 0, width, height);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.globalAlpha = 1;

    const size_adjust = transform.k; //Math.exp(Math.log(transform.k) * .5)
    const corners = this.zoom.current_corners();
    const overlaps = this.tree.search({
      minX: corners.x[0],
      minY: corners.y[0],
      minZ: transform.k,
      maxX: corners.x[1],
      maxY: corners.y[1],
      maxZ: transform.k,
    });
    //    context.fillStyle = "rgba(0, 0, 0, 0)";
    context.clearRect(0, 0, 4096, 4096);
    const dim = this.scatterplot.dim('color');
    for (const d of overlaps) {
      const { data: datum } = d;
      context.font = `${datum.height}pt verdana`;
      const x = x_(datum.x) as number;
      const y = y_(datum.y) as number;

      context.globalAlpha = 1;
      context.fillStyle = 'white';
      if (dim.field === this.label_key) {
        context.shadowColor = dim.scale(datum.text);
      } else {
        context.shadowColor = 'black';
      }
      context.shadowBlur = 19;
      context.lineWidth = 3;
      context.strokeText(datum.text, x, y);
      context.shadowBlur = 0;

      context.lineWidth = 4;
      context.fillStyle = 'white';
      //      const height = datum.height;
      //      const width = datum.pixel_width;
      context.fillText(datum.text, x, y);
    }
  }
}

// Stuff the user must pass.
type RawPoint = {
  x: number;
  y: number;
  text: string;
  // The pixel heights of the point.
  height: number;
};

// Stuff we calculate
type Point = RawPoint & {
  pixel_width: number;
  pixel_height: number;
};

// Cast into 3d space as a rectangle.
type P3d = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  data: Point;
};

function measure_text(d: RawPoint, context: CanvasRenderingContext2D) {
  // Called for the side-effect of setting `d.aspect_ratio` on the passed item.
  context.font = `${d.height}pt verdana`;
  if (d.text === '') {
    return null;
  }
  const ms = context.measureText(d.text);
  let {
    actualBoundingBoxLeft,
    actualBoundingBoxRight,
    actualBoundingBoxAscent,
    actualBoundingBoxDescent,
  } = ms;

  if (
    Number.isNaN(actualBoundingBoxLeft) ||
    actualBoundingBoxLeft === undefined
  ) {
    // Some browsers don't support the full standard.
    actualBoundingBoxLeft = 0;
    actualBoundingBoxRight = ms.width;
    // Hard coded at 6px
    actualBoundingBoxAscent = d.height;
    actualBoundingBoxDescent = 0;
  }
  const pixel_width = actualBoundingBoxLeft + actualBoundingBoxRight;

  return {
    pixel_height: actualBoundingBoxAscent - actualBoundingBoxDescent,
    pixel_width,
  };
}

class DepthTree extends RBush3D {
  public scale_factor: number;
  public mindepth: number;
  public maxdepth: number;
  public context: CanvasRenderingContext2D;
  public insertion_log = [];
  private _accessor: (p: Point) => [number, number] = (p) => [p.x, p.y];

  constructor(
    scale_factor = 0.5,
    zoom = [0.1, 1000],
    context: CanvasRenderingContext2D
  ) {
    // scale factor used to determine how quickly points scale.
    // Not implemented.
    // size = exp(log(k) * scale_factor);

    super();
    this.scale_factor = scale_factor;
    this.mindepth = zoom[0];
    this.maxdepth = zoom[1];
    this.context = context;
    window.dtree = this;
  }

  /**
   *
   * @param p1 a point
   * @param p2 another point
   * @returns The lowest zoom level at which the two points collide
   */
  max_collision_depth(p1: Point, p2: Point) {
    const [x1, y1] = this._accessor(p1);
    const [x2, y2] = this._accessor(p2);
    // The zoom factor after which two points do not collide with each other.

    //    console.log(p1.pixel_width + p2.pixel_width)
    // First x
    const xdiff = Math.abs(x1 - x2);
    const xoverlap = (p1.pixel_width + p2.pixel_width) / 8;
    const width_overlap = xoverlap / xdiff;

    const ydiff = Math.abs(y1 - y2);
    const yoverlap = (p2.pixel_height + p2.pixel_height) / 8;
    const height_overlap = yoverlap / ydiff;
    //    console.log("IT's", {width_overlap, height_overlap}, p1.text, p2.text);
    // Then y
    const max_overlap = Math.min(width_overlap, height_overlap);
    return max_overlap;
  }

  set accessor(f) {
    this._accessor = f;
  }

  get accessor() {
    return this._accessor;
  }

  to3d(point: Point, zoom = 1, maxZ: number | undefined) {
    // Each point should have a center, an aspect ratio, and a height.

    // The height is the pixel height at a zoom level of one.
    const [x, y] = this.accessor(point);
    const { pixel_height, pixel_width } = point;
    const p: P3d = {
      minX: x - pixel_width / zoom / 2,
      maxX: x + pixel_width / zoom / 2,
      minY: y - pixel_height / zoom / 2,
      maxY: y + pixel_height / zoom / 2,
      minZ: zoom,
      maxZ: maxZ || this.maxdepth,
      data: {
        ...point,
      },
    };

    if (isNaN(x) || isNaN(y)) throw 'Missing position' + JSON.stringify(point);
    if (isNaN(pixel_width))
      throw 'Missing Aspect Ratio' + JSON.stringify(point);

    return p;
  }

  insert_point(point: RawPoint | Point, mindepth = 1) {
    let measured: Point;
    if (point['pixel_width'] === undefined) {
      console.log('Starting to insert', point.text, 'from', mindepth);
      measured = {
        ...point,
        ...measure_text(point, this.context),
      };
    } else {
      measured = point;
    }

    const p3d = this.to3d(measured, mindepth, this.maxdepth);
    if (!this.collides(p3d)) {
      if (mindepth <= this.mindepth) {
        // It's visible from the minimum depth.
        //        p3d.visible_from = mindepth;
        console.log('inserting ', p3d);
        this.insertion_log.push(p3d.maxX, p3d.minX, p3d.minZ, p3d.data.text);
        this.insert(p3d);
      } else {
        // If we can't find the colliders, try inserting it twice as high up.
        // Recursive, so probably expensive.
        this.insert_point(point, mindepth / 2);
      }
    } else {
      this.insert_after_collisions(p3d);
    }
  }

  insert_after_collisions(p3d: P3d) {
    // The depth until which we're hidden; from min_depth (.1 ish) to max_depth(100 ish)
    let hidden_until = -1;
    // The node hiding this one.
    let hidden_by;
    console.log('Inserting', p3d.data.text);
    for (const overlapper of this.search(p3d)) {
      // Find the most closely overlapping 3d block.
      // Although the other ones will retain 3d blocks'
      // that extend all the way down to the
      // bottom of the depth tree and so collide with this,
      // it's guaranteed that their *data*
      // will not. And it means we can avoid unnecessary trees.

      const blocked_until = this.max_collision_depth(p3d.data, overlapper.data);
      console.log(
        overlapper.data.text,
        ' blocks ',
        p3d.data.text,
        ' until ',
        blocked_until
      );

      if (blocked_until > hidden_until) {
        hidden_until = blocked_until;
        hidden_by = overlapper;
      }
    }

    if (hidden_by && hidden_until < this.maxdepth) {
      console.log(
        hidden_by.data.text,
        ' used to blocks ',
        p3d.data.text,
        ' until ',
        hidden_until
      );
      // Remove the blocker and replace it by two new 3d rectangles.
      const hid_data = hidden_by.data;
      const hid_start = hidden_by.minZ;
      const hid_end = hidden_by.maxZ;
      // Down from here.
      // Up until this point.
      if (hid_start < hidden_until) {
        // Split is only required if the thing is actually visible at the level where
        // they diverge.
        this.remove(hidden_by);
        console.log('SPLITTING', hid_data.text, 'at ', hidden_until);
        const upper_rect = this.to3d(hid_data, hid_start, hidden_until);
        this.insert(upper_rect);
        const lower_rect = this.to3d(hid_data, hidden_until, hid_end);
        this.insert(lower_rect);
      }
      // Insert the new point
      const current_rect = this.to3d(p3d.data, hidden_until, this.maxdepth);
      console.log('INSERTING', current_rect);
      this.insert(current_rect);
      //      revised_3d.visible_from = hidden_until;
    }
  }
}
