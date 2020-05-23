<script>
  import Table from "./table.svelte";
  import { activeElement } from "./store.js";

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
  <Table>ttetsd</Table>
</div>
