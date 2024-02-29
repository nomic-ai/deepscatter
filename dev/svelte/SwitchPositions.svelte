<script>
  export let scatterplot;

  async function click() {
    console.log(scatterplot.prefs.encoding.x)
    await scatterplot.plotAPI({
      encoding: {
        x: {
          field: scatterplot.prefs.encoding.x.field === 'x' ? 'y' : 'x',
          transform: 'literal'
        },
        y: {
          field: scatterplot.prefs.encoding.y.field === 'y' ? 'x' : 'y',
          transform: 'literal'
        }
      }
    })
    console.log(scatterplot.prefs.encoding.x)
  }
</script>

<button on:click={click}>
  Switch positions
</button>