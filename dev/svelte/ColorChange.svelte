<script>
  export let scatterplot;

  let value = 'category10';
  const schemes = [
    'category10',
    'dark2',
    'pastel2'    
  ]
  function changeColor() {
    console.log({value})
    scatterplot.plotAPI({
      encoding: {
        field: scatterplot.prefs.encoding.field,
        range: value,

      }
    })
  }
</script>

<select bind:value={value} on:change={changeColor}>
  {#each schemes as scheme}
    <option value={scheme}>{scheme}</option>
  {/each}
</select>