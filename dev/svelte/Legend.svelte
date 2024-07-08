<script>
  import { scaleOrdinal } from 'd3-scale';
  import { Scatterplot } from '../../src/scatterplot';
  import { schemeCategory10 } from 'd3-scale-chromatic';

  export let scatterplot;
  let scale = scaleOrdinal(schemeCategory10);
  $: if (scatterplot !== null) {
    scatterplot.add_hook('listener', function () {
      const color = scatterplot.dim('color');
      console.log({ color });
      if (color.scale) {
        scale = color.scale;
      }
    });
  }

  $: domain = scale.domain();
  $: bg = (d) => `background-color:${scale(d)}`;
</script>

<div>LEGEND</div>
<div id="legend">
  {#each domain as val}
    <div style={bg(val)}>{val}</div>
  {/each}
</div>

<style>
  #legend {
    right: 4vw;
  }
</style>
