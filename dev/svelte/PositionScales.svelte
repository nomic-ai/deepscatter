<script lang="ts">
  export let scatterplot;

  function plotBigX() {
    scatterplot.plotAPI({
      encoding: {
        x: {
          field: 'x',
          domain: [-1, 1],
          range: [-2, 2],
          transform: 'linear',
        },
        y: {
          field: 'y',
          domain: [-1, 1],
          range: [-3, 3],
          transform: 'linear',
        },
      },
    });

    // for (let d of ['x', 'y']) {
    //   scatterplot.deeptable.transformations[`big_${d}`] = async function (
    //     tile,
    //   ) {
    //     const trueVals = (await tile.get_column(d)).toArray();
    //     const out = new Float32Array(trueVals.length);
    //     for (let i = 0; i < out.length; i++) {
    //       out[i] = trueVals[i] * 2;
    //     }
    //     return out;
    //   };
    // }
    // scatterplot.plotAPI({
    //   encoding: {
    //     x: {
    //       field: 'big_x',
    //       transform: 'linear',
    //       domain: scatterplot.deeptable.extent.x.map((d) => d * 2),
    //       range: scatterplot.deeptable.extent.x,
    //     },
    //     y: {
    //       field: 'big_y',
    //       transform: 'linear',
    //       domain: scatterplot.deeptable.extent.y.map((d) => d * 2),
    //       range: scatterplot.deeptable.extent.y,
    //     },
    //   },
    // });
  }
  function plotNormal() {
    scatterplot.plotAPI({
      encoding: {
        x: {
          field: 'x',
          domain: [-1, 1],
          range: [-1, 1],
        },
        y: {
          field: 'y',
          domain: [-1, 1],
          range: [-2, 2],
        },
      },
    });
  }
</script>

<button on:click={plotBigX}>big x</button>
<button on:click={plotNormal}>normal x</button>
