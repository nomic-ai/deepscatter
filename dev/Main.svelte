<script>
    import { Scatterplot } from '../src/deepscatter';
    import { onMount } from 'svelte'
    import SwitchPositions from './svelte/SwitchPositions.svelte';
  import ColorChange from './svelte/ColorChange.svelte';
    
    const prefs = {
      source_url: '/tiles',
      max_points: 1000000,
      alpha: 35, // Target saturation for the full page.
      zoom_balance: 0.22, // Rate at which points increase size. https://observablehq.com/@bmschmidt/zoom-strategies-for-huge-scatterplots-with-three-js
      point_size: 2, // Default point size before application of size scaling
      background_color: '#EEEDDE',
      encoding: {
        color: {
          field: 'class',
          range: 'category10',
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
  onMount( () => {
    scatterplot = new Scatterplot('#deepscatter');
    window.scatterplot = scatterplot;
    scatterplot.plotAPI(prefs)
  })
</script>

<div id="overlay">
  <SwitchPositions {scatterplot}>
  </SwitchPositions>
  <ColorChange {scatterplot}></ColorChange>
</div>

<div id="deepscatter">
  
</div>

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