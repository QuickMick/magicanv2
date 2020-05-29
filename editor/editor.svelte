<script>
  import { onMount } from "svelte";
  import CardLoader from "./card-loader.js";

  import Cookies from "js-cookie";

  const CARD_RATIO = 0.71764705882;
  export let height = 300;
  export let width = Math.floor(height * CARD_RATIO);

  let promise = new Promise(resolve => resolve([]));

  let input;
  let format;
  let progress = 0;
  let all = 0;

  let hiddenGroups = new Set();

  function toggleGroupVisibility(group) {
    if (hiddenGroups.has(group.name)) hiddenGroups.delete(group.name);
    else hiddenGroups.add(group.name);

    hiddenGroups = hiddenGroups;
  }

  function sp(p, a) {
    progress = p;
    all = a;
  }

  async function update(evt) {
    if (evt.keyCode !== 27) return;
    promise = CardLoader.createDeck(input.value || "", (p, a) => {
      sp(p, a);
    })
      .catch(e => {
        console.error(e);
        throw e;
      })
      .then(res => {
        input.value = res.corrected;
        return res;
      });
  }
  function reload() {
    update({ keyCode: 27 });
  }
  function remove(card) {
    const r = new RegExp(`^.*${card.name}.*$`, "gm");

    input.value = input.value.replace(r, "");
    promise = CardLoader.createDeck(input.value || "", (p, a) =>
      sp(p, a)
    ).catch(e => {
      console.error(e);
      throw e;
    });
  }

  onMount(async () => {
    const start =
      Cookies.get("deck") ||
      `#lands
mountain
2 plains
3 swamps
# main deck
20 blightsteel colossus`;

    input.value = start;
    console.log("STSFSDF", Cookies.get("deck")),
      (promise = CardLoader.createDeck(start, (p, a) => sp(p, a)));
  });

  function onTyping() {
    Cookies.set("deck", input.value, { expires: 7 });
  }
</script>

<style>
  .content {
    display: flex;
    flex-direction: row;
    width: 100%;
    height: 100%;
  }

  .input {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: 10px;
    resize: none;
  }

  .controls {
    flex-shrink: 0;
    width: 300px;
    height: 100%;
    background: lightgray;
    display: flex;
    flex-direction: column;
  }

  .help {
    padding: 0px 10px 10px 10px;
    user-select: none;
  }

  .group-content {
    flex-grow: 1;
    display: flex;
    flex-wrap: wrap;
    transition: height 500ms ease;
  }

  .group-content.hidden {
    overflow: hidden;
    height: 45px;
  }

  .display {
    flex-grow: 1;
    background: gray;
    display: flex;
    flex-direction: column;
    flex-wrap: nowrap;
    overflow: auto;
    position: relative;
    user-select: none;
  }

  .loading-wrapper {
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
  }

  .entry {
    position: relative;
    padding: 10px;
  }
  .card {
    position: absolute;
    border: 6px solid rgb(22, 22, 22);
    border-radius: 10px;
    outline: 0;
    box-shadow: 0px 0px 10px black;
  }

  .card.banned {
    border: 6px solid red;
  }

  .card:hover {
    border: 6px solid blue;
    cursor: pointer;
  }

  .price,
  .banned-text,
  .count {
    font-size: 34px;
    text-shadow: 0px 0px 9px black;
    color: red;
    position: absolute;
    z-index: 100;
    font-weight: bold;
    left: 34px;
  }

  .banned-text {
    bottom: 135px;
  }
  .count {
    top: 165px;
  }

  .price {
    bottom: 20px;
    color: wheat;
    font-size: 16px;
    font-weight: normal;
  }

  .group-header {
    display: flex;
    background: darkgrey;
    /* padding: 8px; */
    margin: 8px 0;
    box-shadow: 0px 0px 8px black;
    width: 100%;
    flex-direction: row;
  }

  .group-header h2 {
    padding: 0 25px;
    margin: 0px;
  }

  .group-statistics {
    display: flex;
    flex-direction: row;
  }

  .group-value {
    padding: 5px;
  }
  .blue {
    color: blue;
  }
  .black {
    color: black;
  }
  .red {
    color: red;
  }
  .white {
    color: wheat;
  }
  .green {
    color: green;
  }
  .colorless {
    color: gray;
  }
  .generic {
    color: goldenrod;
  }
  .sum {
    color: goldenrod;
  }

  .lds-ripple {
    display: inline-block;
    position: relative;
    width: 80px;
    height: 80px;
  }
  .lds-ripple div {
    position: absolute;
    border: 4px solid #fff;
    opacity: 1;
    border-radius: 50%;
    animation: lds-ripple 1s cubic-bezier(0, 0.2, 0.8, 1) infinite;
  }
  .lds-ripple div:nth-child(2) {
    animation-delay: -0.5s;
  }
  @keyframes lds-ripple {
    0% {
      top: 36px;
      left: 36px;
      width: 0;
      height: 0;
      opacity: 1;
    }
    100% {
      top: 0px;
      left: 0px;
      width: 72px;
      height: 72px;
      opacity: 0;
    }
  }
</style>

<svelte:window on:keyup={update} />
<div class="content">
  <div class="controls">
    <div class="help">
      <h4>How to use:</h4>
      <p>paste your deck to the following input.</p>
      <ul>
        <li>when a line starts with "#" it will be interpreted as headline</li>
        <li>
          a card can be entered with a leading count, or just with its name
        </li>
        <li>use the "ESC" key to reaload the preview</li>
        <li>doubleclick a card to remove it</li>
      </ul>
      <p>NOTE: we use cookies to store your deck after reload.</p>
      <p>NOTE: This is not an official Magic produkt.</p>

      {#await promise}
        <div>loading: {progress}/{all}</div>
      {:then groups}
        <div>Total cards: {groups['cardCount']}</div>
      {:catch error}
        asdasdasasdasd {error}
      {/await}
      Format:
      <select bind:this={format} on:blur={reload} on:change={reload}>
        <option selected>commander</option>
        <option>brawl</option>
        <option>duel</option>
        <option>future</option>
        <option>historic</option>
        <option>legacy</option>
        <option>modern</option>
        <option>oldschool</option>
        <option>pauper</option>
        <option>penny</option>
        <option>pioneer</option>
        <option>standard</option>
        <option>vintage</option>
      </select>

    </div>
    <textarea bind:this={input} class="input" on:keyup={onTyping} />
  </div>

  <div class="display">
    {#await promise}
      <div class="loading-wrapper">
        <div class="lds-ripple">
          <div />
          <div />
        </div>
      </div>
    {:then groups}
      <div class="statistics">
        <div class="deck-value blue">{groups['mana'].blue}</div>
        <div class="deck-value black">{groups['mana'].black}</div>
        <div class="deck-value red">{groups['mana'].red}</div>
        <div class="deck-value white">{groups['mana'].white}</div>
        <div class="deck-value green">{groups['mana'].green}</div>
        <div class="deck-value colorless">{groups['mana'].colorless}</div>
        <div class="deck-value generic">{groups['mana'].generic}</div>
        <div class="deck-value sum">{groups['mana'].sum}</div>
        <div class="deck-value group-cost">{groups.cost + '$'}</div>
      </div>
      {#each groups || [] as group}
        <div class="group">

          <div class="group-header">
            <h2>{group.name + ' // ' + group.count || 'no name'}</h2>
            <button on:click={() => toggleGroupVisibility(group)}>
              toggle
            </button>
            <div class="group-statistics">
              <div class="group-value blue">{group.mana.blue}</div>
              <div class="group-value black">{group.mana.black}</div>
              <div class="group-value red">{group.mana.red}</div>
              <div class="group-value white">{group.mana.white}</div>
              <div class="group-value green">{group.mana.green}</div>
              <div class="group-value colorless">{group.mana.colorless}</div>
              <div class="group-value generic">{group.mana.generic}</div>
              <div class="group-value sum">{group.mana.sum}</div>
              <div class="group-value group-cost">{group.cost + '$'}</div>

            </div>
          </div>
          <div
            class="group-content"
            class:hidden={hiddenGroups.has(group.name)}>

            {#each group.cards as card}
              <div
                class="entry"
                style={'width:' + width + 'px; height:' + (card.count <= 4 ? height + ((card.count || 1) - 1) * 40 : height + 3 * 40) + 'px;'}>

                {#each { length: card.count > 4 ? 4 : card.count } as _, i}
                  <img
                    class:banned={card.data.legalities[format.value] !== 'legal'}
                    on:dblclick={() => remove(card)}
                    class="card"
                    style={'margin-top: ' + i * 40 + 'px'}
                    src={card.url}
                    alt={card.name}
                    {width}
                    {height} />
                {/each}

                {#if card.data.legalities[format.value] !== 'legal'}
                  <div class="banned-text">BANNED</div>
                {/if}
                {#if card.count > 4}
                  <div class="count">{card.count}x</div>
                {/if}

                <div class="price">{card.data.prices.usd + '$' || '???'}</div>
              </div>
            {/each}
          </div>
        </div>
      {/each}

    {:catch error}

      <div class="error">
        ERROR, check your decklist for correct format or internet connection
        brudi
      </div>
    {/await}
  </div>
</div>
