<script>
  import Card from "./card.svelte";

  export let promise;
  export let playTesterActive;
  function togglePlayTest() {
    playTesterActive = false;
  }

  function sampleHand() {
    promise = promise;
  }

  function shuffle(a) {
    var j, x, i;
    for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      x = a[i];
      a[i] = a[j];
      a[j] = x;
    }
    return a;
  }

  async function combine(groups) {
    let result = [];

    for (let group of groups) {
      if (group.name.includes("maybe")) continue;
      if (group.name.includes("commander")) continue;

      for (let card of group.cards) {
        for (let i = 0; i < card.count; i++) {
          result.push(card);
        }
      }
    }

    result = shuffle(result); //.splice(0, 15);
    return {
      hand: result.splice(0, 7),
      draws: result.splice(0, 7)
    };
  }
</script>

<style>
  .all {
    margin: 20px;
  }
  .next-draws {
    margin-top: 20px;
    font-size: 25px;
  }
  .group-content {
    display: flex;
    flex-wrap: wrap;
    transition: height 500ms ease;
  }

  button {
    flex-shrink: 0;
  }
</style>

<button on:click={togglePlayTest}>hide</button>

{#await promise}
  <div class="loading-wrapper">deck is loading</div>
{:then groups}

  {#await combine(groups)}
    <div class="loading-wrapper">deck is loading</div>
  {:then play}
    <div class="next-draws">Hand:</div>
    <div class="all">
      <div class="group-content">
        {#each play.hand as card}
          <Card {card} />
        {/each}
      </div>

      <div class="next-draws">next draws:</div>

      <div class="group-content">
        {#each play.draws as card}
          <Card {card} />
        {/each}
      </div>
    </div>
    <button on:click={sampleHand}>new sample hand</button>

  {/await}

{:catch error}

  <div class="error">
    ERROR, check your decklist for correct format or internet connection brudi
  </div>
{/await}
