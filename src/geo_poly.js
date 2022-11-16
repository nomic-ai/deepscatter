import vertex_shader from './glsl/geopolygons.vert';
import frag_shader from './glsl/geopolygons.frag';

export default class FeatureHandler {
  constructor(regl, feature_set) {
    this.feature_set = feature_set;
    this.element_handler = new Map(); // Elements can't share buffers (?) so just use a map.
    this.coord_handler = new BufferHandler(regl); // Use just a few buffers to store all the data.
    this.props = new Map();
    this.regl = regl;
    this.prepare_features();
    this.prepare_regl();
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
      primitive: 'triangle',
      frag: frag_shader,
      vert: vertex_shader,
      //        count: regl.prop("length"),
      elements: function (state, props) {
        return props.elements;
      },

      attributes: {
        a_position: (_, { position }) => position,
      },

      uniforms: {
        u_centroid: regl.prop('centroid'),
        u_theta: (_, { angle }) => angle,
        u_scale: (_, { scale }) => scale,
        u_incidence: (_, { radial_jitter_type }) =>
          radial_jitter_type == 'distortion' ? 1 : 0,
        u_color: (_, { color, alpha }) => [...color, alpha],
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
    for (let feature of this.features) {
      feature.alpha = 1; //;feature.alpha || .7 + Math.random() * .15
      feature.color = [0.2, 0.2, 0.2];
      const el = {
        centroid: [
          feature.properties.centroid_x,
          feature.properties.centroid_y,
        ],
        color: feature.color ? feature.color : [0.5, 0.5, 0.5],
        angle: feature.angle ? feature.angle : 0,
        scale: feature.scale ? feature.scale : 1,
        alpha: feature.alpha ? feature.alpha : 1,
        position: feature.coords,
        elements: feature.vertices,
        radial_jitter_type: 'distortion',
        translate: feature.translate ? feature.translate : [0, 0],
      };
      Object.assign(el, props);
      prop_list.push(el);
    }
    this._render(prop_list);
  }

  prepare_features() {
    this.features = [];
    const { feature_set, features, element_handler, coord_handler } = this;
    for (let ix = 0; ix < this.feature_set.length; ix++) {
      const feature = this.feature_set.get(ix);
      element_handler.set(
        ix,
        this.regl.elements({
          primitive: 'triangles',
          usage: 'static',
          data: feature.vertices,
          type: 'uint' + feature.coord_resolution,
          length: feature.vertices.length, // in bytes
          count: (feature.vertices.length / feature.coord_resolution) * 8,
        })
      );
      coord_handler.post_data(ix, feature.coordinates);
      const f = {
        ix,
        vertices: element_handler.get(ix),
        coords: coord_handler.get(ix),
        properties: feature,
      }; // Other data can be bound to this if desired.
      features.push(f);
    }
  }

  *[Symbol.iterator]() {
    for (let feature of this.features) {
      yield feature;
    }
  }

  get_prop(prop, id) {
    if (this.props.get(prop) === undefined) {
      this.props.set(prop, new Map());
    }
    return this.props.get(prop).get(id);
  }
  set_prop(prop, id, value) {
    if (this.props.get(prop) === undefined) {
      this.props.set(prop, new Map());
    }
    return this.props.get(prop).set(id, value);
  }
}

class BufferHandler {
  // simple data structure to post blocks of data to regl buffers.

  // Rather than allocate a new buffer for each polygon, which is kind of wasteful,
  // just set them up in 2 MB blocks and keep using until the next call will overflow.

  // Something is wrong with the regl scoping here, so it breaks if you have more than one buffer.
  // Currently, I just make sure that the buffer is crazy big--would be worth fixing, though.

  constructor(regl, size = 2 ** 26) {
    this.regl = regl;
    this.size = size;
    this.buffers = [
      regl.buffer({ length: this.size, type: 'float', usage: 'static' }),
    ];
    this.current_buffer = 0;
    this.current_position = 0;
    this.lookup = new Map();
  }

  get(id) {
    return this.lookup.get(id);
  }

  post_data(id, data, stride = 8) {
    // Must post as a uint8Array, because that's what it looks like
    // in Arrow.
    if (data.length + this.current_position > this.size) {
      this.current_buffer += 1;
      this.buffers[this.current_buffer] = this.regl.buffer({
        length: this.size,
        type: 'float',
        usage: 'static',
      });
      this.current_position = 0;
    }
    const buffer = this.buffers[this.current_buffer];
    // regl docs -- 'typedarrays are copied bit-for-bit into the buffer
    // with no type conversion.' So we can send a UintArray8 to a float array no problem.
    buffer.subdata(data, this.current_position);
    const description = {
      buffer: buffer,
      stride: stride ? stride : 8,
      offset: this.current_position,
    };
    this.lookup.set(id, description);
    this.current_position += data.length * 4;
    return description;
  }
}
