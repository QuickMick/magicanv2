<script>
  import { onMount } from "svelte";
  // const { ipcRenderer } = require("electron");
  import PlayTester from "./playtester.svelte";
  const ipc = require("electron").ipcRenderer;
  import cl from "./card-loader.js";
  const CardLoader = new cl(ipc);
  // import LZUTF8 from "lzutf8";
  //import Cookies from "js-cookie";

  const Cookies = {
    set: () => {},
    get: () => {}
  };

  const CARD_RATIO = 0.71764705882;
  let _height = 300;
  let _width = Math.floor(_height * CARD_RATIO);

  let useCookies = true;

  function enableSaving() {
    useCookies = true;
    Cookies.set("useCookies", true);
    saveAllToCookies();
  }

  const oldSet = Cookies.set;
  Cookies.set = (a, b) => {
    if (useCookies) oldSet(a, b);
    else {
      console.log("saving disabled");
    }
  };

  let height = _height;
  let width = _width;
  let cardSearchActive = false;
  let playTesterActive = false;
  let statisticsActive = true;
  let scaling = 100;

  let display;

  let devotionHighlight = -1;

  function highlightDevotion(mana) {
    if (devotionHighlight == mana) devotionHighlight = -1;
    else devotionHighlight = mana + "";
  }

  $: {
    const s = Math.floor(scaling || 100) / 100;
    height = _height * s;
    width = _width * s;
  }

  let promise = new Promise(resolve => resolve([]));
  let cardSearchPromise = new Promise(resolve =>
    resolve({ data: [], has_more: false, total_cards: 0 })
  );

  let input;
  let format;
  let progress = 0;
  let all = 0;

  let spName;
  let spText;
  let spType;

  let spEDHBlue;
  let spEDHBlack;
  let spEDHRed;
  let spEDHWhite;
  let spEDHGreen;
  let spEDHColorless;

  let deckSeach = null;
  let deckSearchInput;

  function changeDeckSearch(groups) {
    if (!groups) returndeckSeach = null;
    let s = deckSearchInput.value;
    if (!s) return (deckSeach = null);

    s = s
      .trim()
      .replace(/\s\s+/gm, " ")
      .toLowerCase()
      .replace(/\s/gm, "(.|\n)*");
    /*    .split("+")
      .join("|");*/
    console.log("search:", s);
    const result = [];
    let count = 0;
    const r = new RegExp(s, "gm");
    for (let group of groups) {
      for (let card of group.cards) {
        if (!card || !card.data || !card.data.oracle_text) continue;
        if (!card.data.oracle_text.toLowerCase().match(r)) continue;
        count += card.count;
        result.push(card);
      }
    }

    deckSeach = [
      {
        cards: result,
        cost: 0,
        count,
        deck: {},
        mana: {
          black: 0,
          blue: 0,
          colorless: 0,
          generic: 240,
          green: 0,
          red: 0,
          sum: 240,
          white: 0
        },
        manaCurve: [],
        name: "search result"
      }
    ];
  }
  function clearForColorless() {
    spEDHBlue.checked = false;
    spEDHBlack.checked = false;
    spEDHRed.checked = false;
    spEDHWhite.checked = false;
    spEDHGreen.checked = false;
  }

  function clearColorless() {
    spEDHColorless.checked = false;
  }

  function searchCards(nextUrl) {
    if (typeof nextUrl == "string") {
      cardSearchPromise = CardLoader.search(nextUrl);
      return;
    }
    const colors = new Set();
    if (spEDHColorless.checked) colors.add("C");
    if (spEDHBlue.checked) colors.add("U");
    if (spEDHBlack.checked) colors.add("B");
    if (spEDHRed.checked) colors.add("R");
    if (spEDHWhite.checked) colors.add("W");
    if (spEDHGreen.checked) colors.add("G");

    cardSearchPromise = CardLoader.search({
      name: spName.value,
      text: spText.value,
      type: spType.value,
      edhcolors: colors
    });
  }

  let currentCardContext = null;
  function cardContextMenu(evt, card, groups) {
    evt.preventDefault();
    if (evt.which == 3 && groups.length > 1) {
      // right click
      currentCardContext = card;
    }
    return false;
  }

  function cardContextClick(evt, card, group) {
    currentCardContext = null;
    evt.stopPropagation();
    evt.preventDefault();
    let deck = input.value;

    const r = new RegExp(`^.*${card.name}.*$`, "gmi");
    deck = deck.replace(r, "");
    let index = deck.indexOf(group.name);
    if (index < 0) return;
    index += group.name.length;

    const insert = "\n" + card.count + " " + card.name;
    deck = deck.slice(0, index) + insert + deck.slice(index);
    input.value = deck;
    reload();
  }

  function onMainMouseDown(evt) {
    currentCardContext = null;
  }

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

  function resetDeckSearch() {
    deckSeach = null;
    if (!deckSearchInput) return;
    deckSearchInput.value = "";
  }

  function sortDeckString() {
    promise = CardLoader.sort(input.value || "", (p, a) => {
      resetDeckSearch();
      sp(p, a);
    })
      .catch(e => {
        console.error(e);
        throw e;
      })
      .then(res => {
        input.value = res;
        return update({ keyCode: 27 }, true);
      });
  }

  let deckNameInput;
  function saveDeck() {
    if (!deckNameInput) return alert("pls input a name");

    // const filename = (deckNameInput.value || "unknown deck") + ".txt";

    ipc.send("saveDeck", { deck: input.value, name: deckNameInput.value });

    /*  const blob = new Blob([deck], { type: "text/plain;charset=utf-8" });
    if (window.navigator.msSaveOrOpenBlob)
      // IE10+
      window.navigator.msSaveOrOpenBlob(blob, filename);
    else {
      // Others
      var a = document.createElement("a"),
        url = URL.createObjectURL(blob);
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function() {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 0);
    }*/
  }

  function onDeckNameType() {
    Cookies.set("deckName", deckNameInput.value);
  }

  function mainKeyDown(evt) {
    if (evt.ctrlKey || evt.metaKey) {
      switch (evt.which) {
        case 83: // s
          evt.preventDefault();
          evt.stopPropagation();
          saveDeck();
          break;
      }
    }
  }

  function mainKeyUp(evt) {
    update(evt);
  }

  async function update(evt) {
    if (evt.keyCode !== 27) return;

    let scrollPosition = 0;
    if (display) {
      scrollPosition = display.scrollTop;
    }

    promise = CardLoader.createDeck(input.value || "", (p, a) => {
      resetDeckSearch();
      sp(p, a);
    })
      .catch(e => {
        console.error(e);
        throw e;
      })
      .then(res => {
        input.value = res.corrected;
        Cookies.set("deck", input.value);
        setTimeout(() => {
          display.scrollTop = scrollPosition;
        });
        return res;
      });

    return promise;
  }
  function reload() {
    resetDeckSearch();
    update({ keyCode: 27 });
  }

  function appendCard(name) {
    if (!name) return;
    resetDeckSearch();
    input.value = input.value + "\n1 " + name;
    reload();
  }

  function remove(card) {
    const r = new RegExp(`^.*${card.name}.*$`, "gm");

    input.value = input.value.replace(r, "// " + card.count + " " + card.name);
    promise = CardLoader.createDeck(input.value || "", (p, a) =>
      sp(p, a)
    ).catch(e => {
      console.error(e);
      throw e;
    });
  }

  function copyDeck() {
    const deck = input.value;

    input.value = input.value.replace(/#.*|\/\/.*/gm, "\n");

    input.select();

    input.setSelectionRange(0, 99999);
    document.execCommand("copy");

    input.value = deck;

    alert("Deck copied to clipboard");
  }

  let helpActive = false;
  onMount(async () => {
    const defaultDeck = `#lands
mountain
2 plains
3 swamps
# main deck
20 blightsteel colossus`;

    useCookies = Cookies.get("useCookies");

    const urlParams = new URLSearchParams(window.location.search);
    const sharedDeck = urlParams.get("d");

    let start = useCookies ? Cookies.get("deck") || defaultDeck : defaultDeck;

    if (sharedDeck) {
      useCookies = false;
      /* const buffer = new Uint8Array(sharedDeck.split(","));
    * const decompressed = LZUTF8.decompress(buffer);
      if (decompressed) {
        start = decompressed;
      }*/
    }

    urlParams.delete("d");
    window.history.replaceState({}, "", `${window.location.pathname}`);

    //    window.history.replaceState(
    //   {},
    //   '',
    //   `${window.location.pathname}?${params}${window.location.hash}`,
    // )

    //  helpActive = Cookies.get("helpActive") == "true";
    // console.log("help:", Cookies.get("helpActive"));
    cardSearchActive = Cookies.get("cardSearchActive") == "true";
    console.log("search:", Cookies.get("cardSearchActive"));
    statisticsActive = Cookies.get("statisticsActive") == "true";
    console.log("statistics:", Cookies.get("statisticsActive"));

    statisticsActive;
    input.value = start;
    reload();

    ipc.on("loadDeck", (sender, data) => {
      console.log("LOADING DECK", data.name);
      input.value = data.deck;
      deckNameInput.value = (data.name || "").replace(".gdeck", "");
      reload();
    });

    /* console.log("STSFSDF", Cookies.get("deck")),
      (promise = CardLoader.createDeck(start, (p, a) => sp(p, a)));*/
  });

  function saveAllToCookies() {
    Cookies.set("cardSearchActive", cardSearchActive);
    Cookies.set("statisticsActive", statisticsActive);
    Cookies.set("deck", input.value);
  }

  function shareDeck() {
    /*   if (!input || !input.value) {
      alert("The deck is empty, nothing copied");
      return;
    }
    const compressed = LZUTF8.compress(input.value || "empty deck shared");
    //window.history.pushState("page2", "Title", "?d=" + compressed);
    console.log(`${window.location.pathname}?d=${compressed}`);

    const el = document.createElement("textarea");
    el.value = `${window.location.href}?d=${compressed}`;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
    alert("link to deck copied");*/
  }

  function onTyping() {
    Cookies.set("deck", input.value, { expires: 7 });
  }

  function getHeight(mana, groups) {
    return 100 * (mana / Math.max(...groups["manaCurve"]));
  }

  function openHelp() {
    helpActive = !helpActive;
    //  Cookies.set("helpActive", helpActive + "");
  }

  function togglePlayTest() {
    playTesterActive = !playTesterActive;
  }

  function toggleSearch() {
    cardSearchActive = !cardSearchActive;
    Cookies.set("cardSearchActive", cardSearchActive + "");
  }
  function toggleStatistics() {
    statisticsActive = !statisticsActive;
    Cookies.set("statisticsActive", statisticsActive + "");
  }

  let highlightedCreature = "";
  function highlightCreature(typeName) {
    if (typeName == highlightedCreature) {
      highlightedCreature = "";
      return;
    } else {
      highlightedCreature = typeName;
    }
  }
</script>

<style>
  .content {
    --raisin-black: hsla(200, 8%, 15%, 1);
    --roman-silver: hsla(196, 15%, 60%, 1);
    --colorless: hsla(0, 0%, 89%, 1);
    --black: hsla(83, 8%, 38%, 1);
    --white: hsl(48, 64%, 89%);
    --red: hsla(0, 71%, 84%, 1);
    --green: hsla(114, 60%, 75%, 1);
    --blue: hsla(235, 55%, 81%, 1);
  }

  .content {
    display: flex;
    flex-direction: row;
    width: 100%;
    height: 100%;
  }

  .help-symbol {
    border-radius: 50%;
    border: 1px solid black;
    width: 16px;
    height: 16px;
    text-align: center;
    position: absolute;
    right: 10px;
    top: 10px;
    cursor: pointer;
  }

  .help-symbol:hover {
    border-color: blue;
    color: blue;
  }

  .toggle-search {
    background: blue;
    width: 30px;
    height: 30px;
    cursor: pointer;
    position: absolute;
    left: -30px;
    top: 50%;
    user-select: none;
  }

  .hide .toggle-search {
    left: -52px;
  }

  .statistics {
    display: flex;
    flex-direction: column;
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
    position: relative;
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

  .all-type-count {
    height: 125px;
    overflow: auto;
    background: lightsteelblue;
    padding: 10px;
  }

  .type-selector {
    cursor: pointer;
  }

  .type-selector:not(.highlighted-creature):hover {
    background: aliceblue;
  }

  .highlighted-creature {
    background: steelblue;
  }

  .play-tester {
    height: 100%;
    flex-grow: 1;
    background: white;
    display: flex;
    flex-direction: column;
    position: absolute;
    right: 0;
    width: 100%;
    z-index: 150;
    box-shadow: 0px 0px 10px black;
  }

  .play-tester.hide {
    display: none;
  }

  .card-search {
    height: 100%;
    flex-grow: 1;
    background: white;
    display: flex;
    flex-direction: column;
    position: absolute;
    right: 0;
    width: 33%;
    z-index: 100;
    box-shadow: 0px 0px 10px black;
  }

  .card-search.hide {
    right: -33%;
  }

  .search-params {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
  }

  .search-result {
    height: 100%;
    flex-grow: 1;
    background: white;
    display: flex;
    flex-direction: row;
    overflow: auto;
    position: relative;
    user-select: none;
    flex-wrap: wrap;
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
    flex-shrink: 0;
  }

  .shoping {
    position: absolute;
    z-index: 10;
    font-size: 3em;
    text-shadow: 0px 0px 6px black;
    text-align: center;
    bottom: 10%;
    right: 10%;
    display: none;
  }

  .entry:hover .shoping {
    display: block;
  }

  .shoping .link {
    text-decoration: none;
  }

  .shoping .link:hover {
    color: transparent;
    text-shadow: 0 0 0 blue;
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

  .card.highlighted {
    border: 6px solid yellow;
  }

  .card.type-highlight {
    border: 6px solid blueviolet;
  }

  .card:hover {
    border: 6px solid blue;
    cursor: pointer;
  }

  .card-context-menu {
    position: absolute;
    z-index: 100;
    background: rgba(255, 255, 255, 0.7);
    height: 100%;
    width: 100%;
    /* padding: 10px; */
    /* margin: 10px; */
    margin-left: -3px;
    margin-top: -3px;
    overflow: auto;
  }

  .card-context-entry {
    margin: 10px;
    font-weight: bold;
    background: white;
    padding: 5px;
    border-radius: 9px;
    box-shadow: 0 0 6px black;
    cursor: pointer;
  }

  .card-context-entry:hover {
    background: wheat;
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
    font-size: 100%;
    text-shadow: 0px 0px 9px black;
    color: red;
    position: absolute;
    z-index: 100;
    font-weight: bold;
    left: 17%;
  }
  .count {
    top: 165px;
  }

  .price {
    bottom: 7px;
    color: wheat;
    font-size: 12px;
    background: black;
    left: 45%;
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

  .mana-proposal,
  .mana-devotion {
    display: flex;
    flex-direction: row;
  }

  .deck-value,
  .group-value {
    padding: 5px;
    color: black;
    border-radius: 50%;
    width: 15px;
    height: 15px;
    text-align: center;
    margin: 5px;
    display: flex;
    text-align: center;
    align-items: center;
    font-size: 11px;
    font-weight: bold;
  }
  .blue {
    background-color: var(--blue);
  }
  .black {
    color: white;
    background-color: var(--black);
  }
  .red {
    background-color: var(--red);
  }
  .white {
    background-color: var(--white);
  }
  .green {
    background-color: var(--green);
  }
  .colorless {
    background-color: var(--colorless);
  }
  .generic {
    background-color: goldenrod;
  }
  .sum {
    background-color: goldenrod;
  }

  .color-param {
    display: flex;
    flex-direction: row;
  }

  .mana-curve {
    display: flex;
    flex-direction: column;
  }

  .all-curves {
    display: flex;
    flex-grow: 1;
    flex-direction: row;
    height: 80px;
  }

  .all-labels {
    display: flex;
    flex-shrink: 0;
    flex-direction: row;
  }

  .curve-element {
    width: 20px;
    display: flex;
    position: absolute;
    bottom: 0;
    background: gray;
    /* vertical-align: middle; */
    align-items: center;
    height: 100%;
  }

  .curve-label {
    width: 20px;
  }
  .curve-wrapper {
    width: 20px;
    position: relative;
    cursor: pointer;
  }

  .curve-element:hover {
    background: lightcoral;
  }

  .highlighted .curve-element {
    background: lightblue;
  }

  .curve-label.highlighted {
    background: lightblue;
  }

  .curve-label:hover {
    background: lightcoral;
  }

  h4 {
    margin-top: 5px;
    margin-bottom: 5px;
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

  .card-search .lds-ripple div {
    border: 4px solid black;
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

<svelte:window
  on:mouseup={onMainMouseDown}
  on:contextmenu|preventDefault={() => false}
  on:keyup={mainKeyUp}
  on:keydown={mainKeyDown} />
<div class="content">
  <div class="controls">
    <div class="help">
      <div class="help-symbol" on:click={openHelp}>?</div>
      {#if helpActive}
        <h4>How to use:</h4>
        <p>paste your deck to the following input.</p>
        <ul>
          <li>
            when a line starts with "#" it will be interpreted as headline
          </li>
          <li>
            a card can be entered with a leading count, or just with its name
          </li>
          <li>use the "ESC" key to reaload the preview</li>
          <li>doubleclick a card to remove it</li>
        </ul>
        <p>NOTE: we use cookies to store your deck after reload.</p>
        <p>NOTE: This is not an official Magic produkt.</p>
      {/if}

      {#await promise}

        <div>loading: {progress}/{all}</div>
      {:then groups}

        {#if !helpActive}
          <h4>General</h4>

          <div>Total cards: {groups['cardCount']}</div>
          <div>
            Lands: {groups['landCount']} Nonlands: {groups['cardCount'] - groups['landCount']}
          </div>

          <div
            class="type-selector"
            on:click={() => highlightCreature('creature')}
            class:highlighted-creature={'creature' == highlightedCreature}>
            Creatures: {groups['creatureCount']}
          </div>
          <div
            class="type-selector"
            on:click={() => highlightCreature('instant')}
            class:highlighted-creature={'instant' == highlightedCreature}>
            Instants: {groups['instantCount']}
          </div>
          <div
            class="type-selector"
            on:click={() => highlightCreature('sorcery')}
            class:highlighted-creature={'sorcery' == highlightedCreature}>
            Sorceries: {groups['sorceryCount']}
          </div>
          <div
            class="type-selector"
            on:click={() => highlightCreature('enchantment')}
            class:highlighted-creature={'enchantment' == highlightedCreature}>
            Enchantments: {groups['enchantmentCount']}
          </div>
          <div
            class="type-selector"
            on:click={() => highlightCreature('artifact')}
            class:highlighted-creature={'artifact' == highlightedCreature}>
            Artifacts: {groups['artifactCount']}
          </div>
          <div
            class="type-selector"
            on:click={() => highlightCreature('planeswalker')}
            class:highlighted-creature={'planeswalker' == highlightedCreature}>
            Planeswalker: {groups['planeswalkerCount']}
          </div>
          <div class="all-type-count">
            {#each groups['typeNames'] as typeName}
              <div
                class="type-selector"
                on:click={() => highlightCreature(typeName)}
                class:highlighted-creature={typeName == highlightedCreature}>
                {typeName}: {groups['typeCounts'][typeName]}
              </div>
            {/each}

          </div>

          <div>Cost: {groups.cost.toFixed(2) + '$'}</div>

          {#if statisticsActive}
            <div class="statistics">
              <h4>Devotion</h4>
              <div class="mana-devotion">
                <div class="deck-value blue">{groups['mana'].blue}</div>
                <div class="deck-value black">{groups['mana'].black}</div>
                <div class="deck-value red">{groups['mana'].red}</div>
                <div class="deck-value white">{groups['mana'].white}</div>
                <div class="deck-value green">{groups['mana'].green}</div>
                <div class="deck-value colorless">
                  {groups['mana'].colorless}
                </div>
              </div>

              <h4>Generic Mana</h4>
              <div>Remaining generic mana costs:{groups['mana'].generic}</div>
              <div>CMC-Mana-Sum:{groups['mana'].sum}</div>
              <div>
                Average CMC per Nonland: {groups['averageMana'].toFixed(2)}
              </div>
              <h4>Suggested Mana Distribution</h4>
              <div class="mana-proposal">
                <div class="deck-value blue">
                  {(groups['manaProposal'].blue * groups['landCount']).toFixed(1)}
                </div>
                <div class="deck-value black">
                  {(groups['manaProposal'].black * groups['landCount']).toFixed(1)}
                </div>
                <div class="deck-value red">
                  {(groups['manaProposal'].red * groups['landCount']).toFixed(1)}
                </div>
                <div class="deck-value white">
                  {(groups['manaProposal'].white * groups['landCount']).toFixed(1)}
                </div>
                <div class="deck-value green">
                  {(groups['manaProposal'].green * groups['landCount']).toFixed(1)}
                </div>
                <div class="deck-value colorless">
                  {(groups['manaProposal'].colorless * groups['landCount']).toFixed(1)}
                </div>
              </div>
              <h4>Mana Curve</h4>
              <div class="mana-curve">
                <div class="all-curves">
                  {#each groups['manaCurve'] as mana, i}
                    {#if mana > 0}
                      <div
                        class="curve-wrapper"
                        class:highlighted={devotionHighlight == i}
                        on:click={() => highlightDevotion(i)}>
                        <div
                          class="curve-element"
                          style={'height:' + getHeight(mana, groups) + '%;'}>
                          {mana || ''}
                        </div>
                      </div>
                    {/if}
                  {/each}
                </div>

                <div class="all-labels">
                  {#each groups['manaCurve'] as mana, i}
                    {#if mana > 0}
                      <div
                        class="curve-label"
                        class:highlighted={devotionHighlight == i}
                        on:click={() => highlightDevotion(i)}>
                        {i}
                      </div>
                    {/if}
                  {/each}
                </div>
              </div>
            </div>
          {/if}
        {/if}
        <div>
          search:
          <input
            bind:this={deckSearchInput}
            title="e.g.: sacrifice a (artifact|creature)"
            on:keyup={() => changeDeckSearch(groups)} />
        </div>
      {:catch error}
        {error}
      {/await}
      Format:
      <select
        bind:this={format}
        on:blur={reload}
        on:change={reload}
        title="select the legality checker">
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
      <div class="slidecontainer">
        Scale:
        <input
          type="range"
          min="25"
          max="100"
          bind:value={scaling}
          title="scales the card size in the right view" />
      </div>
      <div class="save-container">
        Save :
        <input
          bind:this={deckNameInput}
          on:keyup={onDeckNameType}
          value={Cookies.get('deckName') || 'unknown_deck'}
          title="The name of the deck for saving" />
        <button
          on:click={saveDeck}
          title="this will download you a file, called like you provide in the
          deck">
          save
        </button>
      </div>
      <button
        on:click={toggleStatistics}
        title="toggles the visibility of the statisticks">
        {statisticsActive ? 'hide statistics' : 'show statistics'}
      </button>

      <button on:click={togglePlayTest} title="test your deck">playtest</button>

      <button
        on:click={sortDeckString}
        title="this sorts the deck to lands spells and creatures -NOTE: your
        groups will be replaced">
        sort
      </button>
      <button
        on:click={copyDeck}
        title="this copies the deck without groups and stuff to your clipboard">
        clean copy
      </button>
      <button
        on:click={shareDeck}
        title="copies a string to your clipboard, that shares this deck with
        others">
        share
      </button>

      <button on:click={reload}>refresh</button>
    </div>
    <textarea bind:this={input} class="input" on:keyup={onTyping} />
  </div>

  <div class="display" bind:this={display}>
    {#await promise}
      <div class="loading-wrapper">
        <div>loading: {progress}/{all}</div>
        <div class="lds-ripple">
          <div />
          <div />
        </div>
      </div>
    {:then groups}

      {#each deckSeach || groups || [] as group}
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
              <!-- generic:
              <div class="group-value generic">{group.mana.generic}</div> -->
              sum:
              <div class="group-value sum">{group.mana.sum}</div>
              <div class="group-value group-cost">
                {group.cost.toFixed(2) + '$'}
              </div>
              chances:
              <!-- <div class="group-value sum">{group.chances}</div> -->
            </div>

          </div>
          <div
            class="group-content"
            class:hidden={hiddenGroups.has(group.name)}>

            {#each group.cards as card}
              <div
                class="entry"
                style={'width:' + width + 'px; height:' + (card.count <= 4 ? height + ((card.count || 1) - 1) * 40 : height + 3 * 40) + 'px;'}>
                <div class="shoping">
                  <a
                    class="link"
                    href={card.data.purchase_uris.cardmarket}
                    target="_blank">
                    &#128722;
                  </a>
                </div>
                {#each { length: card.count > 4 ? 4 : card.count } as _, i}
                  <img
                    class:banned={card.data.legalities[format.value] !== 'legal'}
                    class:highlighted={devotionHighlight == card.data.cmc}
                    class:type-highlight={highlightedCreature && card.data.type_line
                        .toLowerCase()
                        .includes(highlightedCreature)}
                    on:mouseup|stopPropagation={evt => cardContextMenu(evt, card, groups)}
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

                {#if scaling > 90}
                  <div class="price">{card.data.prices.usd + '$' || '???'}</div>
                {/if}

                {#if currentCardContext === card}
                  <div class="card-context-menu">

                    {#each groups as subGroup}
                      {#if group.name != subGroup.name}
                        <div
                          class="card-context-entry"
                          on:mousedown={evt => cardContextClick(evt, card, subGroup)}>
                          {subGroup.name}
                        </div>
                      {/if}
                    {/each}
                  </div>
                {/if}

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

  {#if playTesterActive}
    <div class="play-tester">
      <PlayTester bind:playTesterActive {promise} />
    </div>
  {/if}

  <div class="card-search" class:hide={!cardSearchActive}>
    <div class="toggle-search" on:click={toggleSearch}>x</div>
    <div class="search-params">
      <div class="search-param">
        Name:
        <input bind:this={spName} />
      </div>
      <div class="search-param">
        Text:
        <input bind:this={spText} />
      </div>
      <div class="search-param">
        Type:
        <input bind:this={spType} />
      </div>

      <div class="search-param color-param">
        Commander-Colors:
        <div class="blue">
          <input
            type="checkbox"
            on:click={clearColorless}
            class="blue"
            bind:this={spEDHBlue} />
        </div>
        <div class="black">
          <input
            type="checkbox"
            on:click={clearColorless}
            class="black"
            bind:this={spEDHBlack} />
        </div>
        <div class="red">
          <input
            type="checkbox"
            on:click={clearColorless}
            class="red"
            bind:this={spEDHRed} />
        </div>
        <div class="white">
          <input
            type="checkbox"
            on:click={clearColorless}
            class="white"
            bind:this={spEDHWhite} />
        </div>
        <div class="green">
          <input
            type="checkbox"
            on:click={clearColorless}
            class="green"
            bind:this={spEDHGreen} />
        </div>
        <div class="colorless">
          <input
            type="checkbox"
            on:click={clearForColorless}
            class="colorless"
            bind:this={spEDHColorless} />
        </div>
      </div>
      <button on:click={searchCards}>search</button>
    </div>

    {#await cardSearchPromise}
      <div class="loading-wrapper">
        <div class="lds-ripple">
          <div />
          <div />
        </div>
      </div>
    {:then result}

      {#if result.code !== 'not_found' && result.data}
        <div class="search-result">
          {#each result.data as card}
            <div
              class="entry"
              style={'width:' + width + 'px; height:' + height + 'px;'}>
              <div class="shoping">
                <a class="link" href={card.cardmarket} target="_blank">
                  &#128722;
                </a>
              </div>
              <img
                on:dblclick={() => appendCard(card.name)}
                class:banned={card.legalities[format.value] !== 'legal'}
                class="card"
                src={card.url}
                alt={card.name}
                {width}
                {height} />

              {#if card.legalities[format.value] !== 'legal'}
                <div class="banned-text">BANNED</div>
              {/if}
              {#if scaling > 90}
                <div class="price">{card.prices.usd + '$' || '???'}</div>
              {/if}
            </div>
          {:else}
            <div>No cards found</div>
          {/each}
        </div>
        <button
          disabled={!result.has_more}
          on:click={() => searchCards(result.next_page)}>
          next
        </button>
      {:else}
        <div>No cards found</div>
      {/if}
    {:catch error}
      <div class="error">
        ERROR, check your decklist for correct format or internet connection
        brudi
      </div>
    {/await}

  </div>
</div>
