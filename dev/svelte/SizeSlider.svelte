<script>
  export let scatterplot;
  export let value;
  let min = Math.sqrt(0.5);
  let max = Math.sqrt(20);

  function changeSize() {
    scatterplot
      .plotAPI({
        duration: 0,
        point_size: value,
      })
      .then(() => {
        scatterplot.plotAPI({
          duration: 1000,
        });
      });
  }
</script>

<input type="range" bind:value {min} {max} step="0.01" on:change={changeSize} />
