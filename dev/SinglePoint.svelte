<script>
  import { Table, tableFromArrays, tableFromJSON } from 'apache-arrow';
  import { Scatterplot } from '../src/deepscatter';
  import { onMount } from 'svelte';

  const tb = tableFromArrays({
    x: new Float32Array([0.001, 0.5, -0.5]),
    y: new Float32Array([0.001, -0.5, 0.5]),
    ix: new Int32Array([1, 2, 3]),
  });

  tb.schema.metadata.set(
    'extent',
    JSON.stringify({
      x: [-1.1, 1.1],
      y: [-1.1, 1.1],
    }),
  );

  const startSize = 480;

  const prefs = {
    arrow_table: tb,
    max_points: 1,
    alpha: 100, // Target saturation for the full page.
    zoom_balance: 0.22, // Rate at which points increase size. https://observablehq.com/@bmschmidt/zoom-strategies-for-huge-scatterplots-with-three-js
    point_size: startSize, // Default point size before application of size scaling
    background_color: '#EEEEEE',
    encoding: {
      color: {
        constant: '#00FF00',
      },
      x: {
        field: 'x',
        transform: 'literal',
      },
      y: {
        field: 'y',
        transform: 'literal',
      },
    },
  };

  let scatterplot = null;
  onMount(() => {
    scatterplot = new Scatterplot('#deepscatter', 480, 480);
    window.scatterplot = scatterplot;
    scatterplot.plotAPI(prefs);
  });
</script>

<div id="overlay"></div>

<div id="deepscatter"></div>

<style>
  #overlay {
    position: fixed;
    z-index: -10;
    left: 40px;
    top: 40px;
  }
  #deepscatter {
    z-index: 0;
    width: 100vw;
    height: 100vh;
  }
</style>
