<script>
  import FourClasses from './FourClasses.svelte';
  import SinglePoint from './SinglePoint.svelte';
  const modes = {
    FourClasses: FourClasses,
    SinglePoint: SinglePoint,
  };

  $: mode = 'SinglePoint';
</script>

{#if mode in modes}
  <svelte:component this={modes[mode]} />
{:else}
  <h1>Mode not found</h1>
{/if}
