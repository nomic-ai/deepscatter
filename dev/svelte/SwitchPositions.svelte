<script>
  export let scatterplot;

  async function click() {
    console.log(scatterplot.prefs.encoding.x)
    await scatterplot.plotAPI({
      encoding: {
        x: {
          field: scatterplot.prefs.encoding.x.field === 'x' ? 'y' : 'x',
          transform: scatterplot.prefs.encoding.x.field === 'x' ? 'linear': 'literal'
        },
        y: {
          field: scatterplot.prefs.encoding.y.field === 'y' ? 'x' : 'y',
          transform: scatterplot.prefs.encoding.y.field === 'y' ? 'linear': 'literal'
        }
      }
    })
  }
</script>

<button on:click={click}>
  Switch positions
</button>