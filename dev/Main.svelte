<script>
  import { onMount } from 'svelte';

  // Each test file is a svelte component -- routing
  // here is just grabbing the URL and instantiating that
  // component.

  import FourClasses from './FourClasses.svelte';
  import SinglePoint from './SinglePoint.svelte';
  import LabelMaker from './submodules/LabelMaker.svelte';

  const modes = {
    FourClasses,
    SinglePoint,
    LabelMaker,
  };

  $: mode = '';
  onMount(() => {
    mode = window.location.pathname.slice(1);
  });
</script>

{#if mode in modes}
  <svelte:component this={modes[mode]} />
{:else}
  Current mode, {mode} is not in the list of modes.
  <h1>Put a load mode from the list in the hash.</h1>
  <div>
    {#each Object.keys(modes) as modename}
      <a href="/{modename}">{modename}</a><br />
    {/each}
  </div>
{/if}
