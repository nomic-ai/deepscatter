class ImageTile extends BaseTile {
  constructor(regl) {
    super();
    this.regl = regl;
    this.data = [];
  }

  get sprites() {
    const { regl } = this;
    this._sprites = this._sprites || {
      tex: regl.texture({
        width: 4096,
        height: 4096,
        format: 'rgba',
        type: 'uint8',
      }),
      image_locations: regl.buffer({
        usage: 'dynamic',
        data: Array.from({ length: points.length * 4 }).fill(0),
        type: 'float',
      }),
      current_position = [0, 0],
      lookup = {},
    };
  }

  add_jpg(datum) {
    this.image_index = this.image_index || -1;

    const { sprites, image_locations } = this._regl_elements;
    const { current_position } = sprites;

    const img = new Image();

    const img_width = datum.img_width;
    const img_height = datum.img_height;
    const objectURL = URL.createObjectURL(new Blob([datum._jpeg]));

    if (current_position[1] > 4096 - 18 * 2) {
      console.error('First spritesheet overflow of images');
      // Just move back to the beginning. Will cause all sorts of havoc.
      sprites.current_position = [0, 0];
      return;
    }

    img.onerror = function (err) {
      console.error(err, 'error');
    };
    img.height = img_height;

    img.addEventListener('load', function () {
      sprites.subimage(
        {
          width: img_width,
          height: img_height,
          data: img,
        },
        current_position[0],
        current_position[1]
      );

      image_locations.subdata(
        [current_position[0], current_position[1], img_width, img_height],
        this.image_index++
      );
    });
    img.src = objectURL;

    current_position[0] += img_width;
    if (current_position[0] > 4096 - img_width * 2) {
      current_position[1] += img_height;
      current_position[0] = 0;
    }
  }
}
