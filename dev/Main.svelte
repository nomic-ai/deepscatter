<script>
  import { onMount } from 'svelte';
  import FourClasses from './FourClasses.svelte';
  import SinglePoint from './SinglePoint.svelte';
  const modes = {
    FourClasses: FourClasses,
    SinglePoint: SinglePoint,
  };

  $: mode = '';
  onMount(() => {
    mode = window.location.hash.slice(1);
    // window.onhashchange(() => {
    //   mode = window.location.hash.slice(1);
    // });
  });
</script>

{#if mode in modes}
  <svelte:component this={modes[mode]} />
{:else}
  <h1>Put a load mode from the list in the hash.</h1>
  <div>
    {#each Object.keys(modes) as modename}
      <a href="#{modename}">{modename}</a><br />
    {/each}
  </div>
{/if}
