<script>
  import Entity from "./entity.svelte";
  import { activeElement } from "./store.js";
  let svg;

  let cam = {
    x: 0,
    y: 0
  };

  let entities = {
    abcd: {
      x: 0,
      y: 0,
      _id: "abcd"
    }
  };

  function mouseMove(evt) {
    cam.x = evt.clientX;
    cam.y = evt.clientY;
    if ($activeElement) {
      console.log(cam);
      const cur = entities[$activeElement];
      cur.x = cam.x;
      cur.y = cam.y;
      entities[$activeElement] = cur;
    }
  }
</script>

<style>
  .main {
    width: 100%;
    height: 100%;
  }

  svg {
    width: 100%;
    height: 100%;
  }
</style>

<div class="main" on:mousemove={mouseMove}>
  <svg bin:this={svg}>
    {#each Object.values(entities) as entity, index (entity._id)}
      <Entity {cam} data={entity} />
    {/each}
  </svg>
</div>
