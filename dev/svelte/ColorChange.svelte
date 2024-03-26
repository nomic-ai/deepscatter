<script lang="ts">
  
  export let scatterplot;

  let value = 'category10';
  const schemes = [
    'okabe',
    'category10',
    'dark2',
    'pastel2'    
  ]
  function changeColor() {
    scatterplot.plotAPI({
      encoding: {
        color: {
          field: scatterplot.prefs.encoding.color.field,
          range: value,
//          range: ["red", "yellow", "pink", "purple"],
//          domain: ["Apple", "Banana", "Strawberry", "Mulberry"]
        }
      }
    })
  }
</script>

<select bind:value={value} on:change={changeColor}>
  {#each schemes as scheme}
    <option value={scheme}>{scheme}</option>
  {/each}
</select>