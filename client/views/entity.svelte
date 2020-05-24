<script>
  import { activeElement } from "./store.js";
  export let cam = {
    x: 0,
    y: 0
  };
  export let data = {
    x: 0,
    y: 0,
    _id: ""
  };

  const CARD_RATIO = 0.71764705882;

  export let height = 300;
  export let width = height * CARD_RATIO;

  function setActive(evt) {
    activeElement.set(data._id);
  }
</script>

<style>
  .active {
    border: 2px solid blue;
  }

  rect {
    fill: green;
  }
</style>

<svg x={data.x} y={data.y}>
  <rect
    on:mousedown|stopPropagation|preventDefault={setActive}
    {width}
    {height} />
  <foreignObject class="ignore no-select" {width} {height}>
    <div class:active={$activeElement}>
      <img {width} {height} src="imgs/swamp.jpg" alt="sfsdf" />
    </div>
  </foreignObject>
</svg>
