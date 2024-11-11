<script>
  import { Deeptable, Scatterplot } from '../src/deepscatter';
  import { onMount } from 'svelte';
  import SwitchPositions from './svelte/SwitchPositions.svelte';
  import ColorChange from './svelte/ColorChange.svelte';
  import SizeSlider from './svelte/SizeSlider.svelte';
  import PositionScales from './svelte/PositionScales.svelte';
  import SelectPoints from './svelte/SelectPoints.svelte';
  const startSize = 0.8;
  const prefs = {
    max_points: 100000,
    alpha: 35, // Target saturation for the full page.
    zoom_balance: 0.05, // Rate at which points increase size. https://observablehq.com/@bmschmidt/zoom-strategies-for-huge-scatterplots-with-three-js
    point_size: startSize, // Default point size before application of size scaling
    background_color: '#EEEDDE',
    duration: 100,
    encoding: {
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
  onMount(async () => {
    const tb = await Deeptable.fromQuadfeather({
      baseUrl: 'http://localhost:8080/everyone',
    });
    window.tb = tb;
    scatterplot = new Scatterplot({ selector: '#deepscatter', deeptable: tb });
    window.scatterplot = scatterplot;
    scatterplot.plotAPI(prefs);
  });
</script>

<div id="overlay">
  <!-- <SwitchPositions {scatterplot}></SwitchPositions>
  <ColorChange {scatterplot}></ColorChange>
  <SizeSlider size={startSize} {scatterplot}></SizeSlider>
  <PositionScales {scatterplot} />
  <SelectPoints {scatterplot}></SelectPoints> -->
</div>

<div id="deepscatter"></div>

<style>
  #overlay {
    position: fixed;
    z-index: 10;
    left: 40px;
    top: 40px;
  }
  #deepscatter {
    z-index: 0;
    width: 100vw;
    height: 100vh;
  }
</style>
