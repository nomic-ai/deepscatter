<script>
  import {
    makeData,
    Float32,
    Vector,
    vectorFromArray,
    Struct,
    makeVector,
    Field,
  } from 'apache-arrow';

  export let scatterplot;

  let positionNum = 0;
  async function click() {
    if (scatterplot.deeptable.transformations['struct'] === undefined) {
      scatterplot.deeptable.transformations['struct'] = async function (tile) {
        const fields = [];
        const vectors = [];
        for (let h = 0; h < 10; h++) {
          // Create a nested struct with a change.
          const x = (await tile.get_column('x')).toArray();
          const y = (await tile.get_column('y')).toArray();

          const x_ = new Float32Array(x.length);
          const y_ = new Float32Array(y.length);

          for (let i = 0; i < x.length; i++) {
            const r = (Math.random() + Math.random()) / 3;
            const theta = Math.random() * Math.PI * 2;
            x_[i] = x[i] + Math.cos(theta) * r;
            y_[i] = y[i] + Math.sin(theta) * r;
          }
          fields.push(new Field(`x${h}`, new Float32()));
          vectors.push(vectorFromArray(x_).data[0]);
          fields.push(new Field(`y${h}`, new Float32()));
          vectors.push(vectorFromArray(y_).data[0]);
        }

        const d = makeData({
          type: new Struct(fields),
          children: vectors,
        });
        const r = new Vector([d]);
        return r;
      };

      scatterplot.deeptable.map((d) => d.get_column('struct'));
      // await new Promise<void>((resolve) => {
      //   setTimeout(() => resolve(), 100);
      // });
    }
    positionNum = (positionNum + 1) % 10;
    await scatterplot.plotAPI({
      duration: 1000,
      encoding: {
        x: {
          field: 'struct',
          subfield: [`x${positionNum}`],
          transform: 'literal',
          domain: [-10, 10],
        },
        y: {
          field: 'struct',
          subfield: [`y${positionNum}`],
          transform: 'literal',
          domain: [-10, 10],
        },
      },
    });
  }
</script>

<button on:click={click}> Switch positions </button>
