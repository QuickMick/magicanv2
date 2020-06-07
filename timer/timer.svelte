<script>
  import { onMount } from "svelte";
  import io from "socket.io-client";

  let connection = null;

  let states = [];

  onMount(() => {
    connection = io();

    connection.on("update", payload => {
      states = payload.states;
    });
  });

  function activate(state) {
    connection.emit("activate", { id: state.id });
  }

  function updateName(evt, state) {
    connection.emit("rename", {
      id: state.id,
      name: evt.srcElement.value
    });
  }
</script>

<style>
  .main {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
  }
  .item {
    cursor: pointer;
    /* width: 200px; */
    /* height: 100px; */
    background: lightgray;
    border: 2px solid black;
    font-size: 30px;
    /* max-height: 50%; */
    /* flex: 0 50%; */
    /* width: 100%; */
    /* height: 100%; */
    flex: 1 0 49%;
  }

  .item.active {
    border: 2px solid red;
    background: gray;
  }

  .item.stop {
    font-size: 30px;
    font-weight: bold;
  }
</style>

<div class="main">
  {#each states as state}
    <div
      class="item"
      class:active={state.activated}
      on:click={() => activate(state)}>
      <input
        on:click|stopPropagation
        value={state.name}
        on:change={evt => updateName(evt, state)} />
      <div>
        {Math.floor(state.time / 60).pad(2)}:{Math.floor(state.time % 60).pad(2)}
      </div>
    </div>
  {/each}

  <div class="item stop" on:click={() => activate({})}>PAUSE</div>
</div>
