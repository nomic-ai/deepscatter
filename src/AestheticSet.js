import {dimensions as Aesthetic, default_aesthetics, StatefulAesthetic} from "./Aesthetic.js"

export const aesthetic_variables = Array.from(Object.keys(Aesthetic))
  .map(d => d.toLowerCase())

export class AestheticSet {
  constructor(scatterplot, regl, tileSet, fields = null) {

    const { width, height } = scatterplot;

    this.is_aesthetic_set = true; // For type checking.
    this.scatterplot = scatterplot
    this.regl = regl
    this.tileSet = tileSet;
    if (fields === null) {
      for (let field of Array.from(Object.keys(Aesthetic))) {
        const aes = field//.toLowerCase()
        const args = [aes, this.scatterplot, this.regl, tileSet]
        /*if (aes == "x") {
          args.unshift(scatterplot.width)
        }
        if (aes == "y") {
          args.unshift(scatterplot.height)
        }*/
        this[aes.toLowerCase()] = new StatefulAesthetic(...args)
      }
    }

    const starting_aesthetics = {};
    
    for (let [k, v] of Object.entries(default_aesthetics)) {
      starting_aesthetics[k] = v.constant || v;
    }
    
    this.encoding = JSON.parse(JSON.stringify(starting_aesthetics))
    
    this.apply_encoding(this.encoding)
  }

  interpret_position(encoding) {
    if (encoding) {
      // First--set position interpolation mode to
      // true if x0 or position0 has been manually passed.

      // If it hasn't, set it to false *only* if the positional
      // parameters have changed.
      if (encoding.x0 || encoding.position0) {
        this.position_interpolation = true
      } else {
        if (encoding.x || encoding.position) {
          this.position_interpolation = false
        }
      }
      for (let p of ["position", "position0"]) {
        const suffix = p.replace("position", "")
        if (encoding[p]) {
          if (encoding[p] === "literal") {
          // A shortcut.
            encoding["x" + suffix] = {
              "field": "x", "transform": "literal"
            }
            encoding["y" + suffix] = {
              "field": "y", "transform": "literal"
            }
          } else {
            const field = encoding[p]
            encoding["x" + suffix] = {
              "field": field + ".x", "transform": "literal"
            }
            encoding["y" + suffix] = {
              "field": field + ".y", "transform": "literal"
            }
          }
          delete encoding[p]
        }
      }
    }
    delete encoding["position"]
    delete encoding["position0"]

  }

  apply_encoding(encoding) {

    if (encoding === undefined || encoding === null) {
      encoding = {}
    }

    // Overwrite position fields.
    this.interpret_position(encoding)

    // Make believe that that the x0 and y0 values were there already.
    if (encoding.x0) {
      this.x.update(encoding.x0)
    }

    if (encoding.y0) {
      this.y.update(encoding.y0)
    }

    for (let k of aesthetic_variables) {
        this[k].update(encoding[k]);
      }
  }

}
