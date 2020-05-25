<script>
  import { activeElement } from "./store.js";
  const PADDING = 12;
  export let cam = {
    x: 0,
    y: 0
  };
  export let data = {
    x: 0,
    y: 0,
    _id: "",
    img: ""
  };

  const CARD_RATIO = 0.71764705882;

  export let height = 300;
  export let width = height * CARD_RATIO;

  function setActive(evt) {
    activeElement.set(data._id);
  }
</script>

<style>
  rect {
    fill: transparent;
  }

  .card {
    border: 6px solid black;
    border-radius: 10px;
    outline: 0;
  }

  .active {
    border: 6px solid blue;
  }
</style>

<svg x={data.x} y={data.y}>
  <rect
    on:mousedown|stopPropagation|preventDefault={setActive}
    width={width + PADDING}
    height={height + PADDING} />
  <foreignObject
    class="ignore no-select"
    width={width + PADDING}
    height={height + PADDING}>
    <div>
      <img
        class="card"
        class:active={$activeElement === data._id}
        {width}
        {height}
        src={'imgs/' + data.img}
        alt={'imgs/' + data.img} />
    </div>
  </foreignObject>
</svg>
