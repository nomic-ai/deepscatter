<script>
  import { onMount } from 'svelte';
  import { LabelMaker, Scatterplot } from '../../src/deepscatter';

  onMount(() => {
    const scatterplot = new Scatterplot('#labels');
    const d = document.getElementById('labels');
    d.ATTRIBUTE_NODE;
    if (d === null) {
      throw new Error('ComponentDidNotMount');
    }
    const maker = new LabelMaker(scatterplot, 'maker');
  });
</script>

<div class="full" id="labels">
  <canvas class="full fixed"> </canvas>
  <svg class="full fixed"> </svg>
</div>

<style>
  .full {
    width: 100vw;
    height: 100vh;
  }
  .fixed {
    position: fixed;
    top: 0;
    left: 0;
  }
</style>
