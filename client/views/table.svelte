<script>
  import Entity from "./entity.svelte";
  import { activeElement } from "./store.js";
  import { onMount } from "svelte";
  export let connector = null;

  onMount(() => {
    connector.on("entity.update", msg => {
      for (let id in msg) {
        const update = msg[id];
        const entity = entities[id];
        if (!entity) return;
        entities[msg.id] = Object.assign(entity, update);
      }
    });
  });
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
    if ($activeElement) {
      const cur = entities[$activeElement];
      //cur.x = evt.clientX;
      //  cur.y = evt.clientY;
      connector.send("update.entity", {
        _id: $activeElement,
        data: { x: evt.clientX, y: evt.clientY }
      });
      entities[$activeElement] = cur;
    } else {
      cam.x = evt.clientX;
      cam.y = evt.clientY;
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
