<script>
  import Table from "./table.svelte";
  import { activeElement } from "./store.js";

  export let connector = null;

  function onMouseUp() {
    activeElement.set(null);
  }
</script>

<style>
  .page {
    width: 100%;
    height: 100%;
  }
</style>

<div class="page" on:mouseup={onMouseUp}>
  <Table {connector}>ttetsd</Table>
</div>
