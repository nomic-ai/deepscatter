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
    for (let i = 0; i < 10; i++) {
      if (scatterplot.deeptable.transformations['struct' + i]) {
        continue;
      }
      scatterplot.deeptable.transformations['struct' + i] = async function (
        tile,
      ) {
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

        const d = makeData({
          type: new Struct([
            new Field('x', new Float32()),
            new Field('y', new Float32()),
          ]),
          children: [vectorFromArray(x_).data[0], vectorFromArray(y_).data[0]],
        });
        const r = new Vector([d]);
        return r;
      };

      scatterplot.deeptable.map((d) => d.get_column('struct' + i));
    }
    await new Promise((resolve) => {
      setTimeout(() => resolve());
    }, 100);
    let r = 'struct' + (positionNum++ % 10);
    await scatterplot.plotAPI({
      duration: 1000,
      encoding: {
        x: {
          field: r,
          subfield: ['x'],
          transform: 'literal',
          domain: [-10, 10],
        },
        y: {
          field: r,
          subfield: ['y'],
          transform: 'literal',
          domain: [-10, 10],
        },
      },
    });
    // await scatterplot.plotAPI({
    //   encoding: {
    //     x: {
    //       field: scatterplot.prefs.encoding.x.field === 'x' ? 'y' : 'x',
    //       transform:
    //         scatterplot.prefs.encoding.x.field === 'x' ? 'linear' : 'literal',
    //     },
    //     y: {
    //       field: scatterplot.prefs.encoding.y.field === 'y' ? 'x' : 'y',
    //       transform:
    //         scatterplot.prefs.encoding.y.field === 'y' ? 'linear' : 'literal',
    //     },
    //   },
    // });
  }
</script>

<button on:click={click}> Switch positions </button>
