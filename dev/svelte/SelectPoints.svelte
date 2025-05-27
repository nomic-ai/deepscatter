<script>
  import { Bitmask, Scatterplot } from '../../src/deepscatter';
  export let scatterplot;

  let selectionNumber = 0;

  async function makeSelection() {
    const selection = await scatterplot.deeptable.select_data({
      name: Math.random().toFixed(8),
      tileFunction: async (tile) => {
        const b = new Bitmask(tile.metadata.nPoints);
        for (let i = 0; i < tile.metadata.nPoints; i++) {
          if (Math.random() < 0.001) {
            b.set(i);
          }
        }
        return b.to_arrow();
      },
    });
    await selection.ready;
    await selection.applyToAllLoadedTiles();
    console.log(selection);
    console.log(selection.name);
    scatterplot.plotAPI({
      duration: 1000,
      background_options: {
        size: [0.5, 10],
        opacity: [0.8, 3],
        color: '#AAAAAA',
      },
      encoding: {
        foreground: {
          field: selection.name,
          op: 'gt',
          a: 0,
        },
      },
    });
  }
</script>

<div>
  <button on:click={() => makeSelection()}>Select Points</button>
  <button
    on:click={() => scatterplot.plotAPI({ encoding: { foreground: null } })}
    >Reset</button
  >
</div>
