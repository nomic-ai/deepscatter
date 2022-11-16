import { mesh } from 'topojson-client';
import vertex_shader from './glsl/line_shader.vert';
import frag_shader from './glsl/line.frag';

export default class GeoLines {
  constructor(topojson, regl) {
    this.regl = regl;
    this.topojson = topojson;
    this.parse_topojson();
    this.prepare_regl();
  }

  parse_topojson() {
    const k = Array.from(Object.keys(this.topojson.objects))[0];
    const lines = mesh(this.topojson, this.topojson.objects[k]);
    const total_length = lines.coordinates
      .map((d) => d.length)
      .reduce((a, b) => a + b);
    const buffer = new Float32Array(total_length * 2);
    const start_points = [];
    let position = 0;

    for (let coordinate_set of lines.coordinates) {
      start_points.push({
        offset: position * 4,
        length: coordinate_set.length,
      });
      for (let [x, y] of coordinate_set) {
        buffer[position] = x;
        buffer[position + 1] = y;
        position += 2;
      }
    }
    this.line_buffer = this.regl.buffer(buffer);
    this.line_meta = start_points;

    /*    const geojson = topojson.merge(this.topojson, this.topojson.objects[k])
    const earcut_data = earcut.flatten(geojson.geometry.coordinates);
    this.triangles = earcut(earcut_data.vertices, earcut_data.holes, earcut_data.dimensions);
*/
  }

  prepare_regl() {
    const { line_buffer, meta, regl } = this;
    const parameters = {
      depth: { enable: false },
      stencil: { enable: false },
      blend: /*function(context, props) {
        if (props.color_picker_mode > 10.5) {
          return undefined;
        }*/ {
        enable: true,
        func: {
          srcRGB: 'src alpha',
          srcAlpha: 1,
          dstRGB: 'one minus src alpha',
          dstAlpha: 1,
        },
        equation: {
          rgb: 'add',
          alpha: 'add',
        },
        color: [0, 0, 0, 0],
      },
      primitive: 'line strip',
      frag: frag_shader,
      vert: vertex_shader,
      count: regl.prop('length'),
      attributes: {
        a_position: {
          buffer: this.line_buffer,
          offset: regl.prop('offset'),
          stride: 8,
        },
      },
      lineWidth: function (state, props) {
        return 1;
        return Math.exp(Math.log(props.transform.k) * 0.5);
      },
      uniforms: {
        u_color: [0.3, 0.3, 0.3, 0.1],
        u_width: ({ viewportWidth }) => viewportWidth,
        u_height: ({ viewportHeight }) => viewportHeight,
        u_aspect_ratio: ({ viewportWidth, viewportHeight }) =>
          viewportWidth / viewportHeight,
        u_zoom_balance: regl.prop('zoom_balance'),
        u_window_scale: regl.prop('webgl_scale'),
        u_zoom: function (context, props) {
          const zoom_matrix = [
            [props.transform.k, 0, props.transform.x],
            [0, props.transform.k, props.transform.y],
            [0, 0, 1],
          ].flat();
          return zoom_matrix;
        },
      },
    };
    this._render = this.regl(parameters);
  }

  render(props) {
    const prop_list = [];
    for (let segment of this.line_meta) {
      const el = {};
      Object.assign(el, props);
      el.length = segment.length;
      el.offset = segment.offset;
      prop_list.push(el);
    }

    this._render(prop_list);
  }
}
