// path to where the images are downloaded
//const CARD_DATA = require("./scryfall-default-cards.json");

function timeout() {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, 70);
  });
}

class MtgInterface {

  constructor() {
    this.__cache = {};
  }

  async cardByName(name) {
    if (this.__cache[name]) return this.__cache[name];
    await timeout();
    //https://api.scryfall.com/cards/named?fuzzy=aust+com 
    const fixed = name.replace(/\s/g, "+");
    const result = await fetch('https://api.scryfall.com/cards/named?fuzzy=' + fixed)
      .then(response => response.json()).catch(e => { console.log(e); return { code: "not_found" }; });

    this.__cache[name] = result;

    return result;
    // .then(data => console.log(data));
    /* for (let card of CARD_DATA) {
       if (card.name.toLowerCase() == name.toLowerCase()) return card;
     }*/
  }


  /**
   * converts a deck string to a readable object
   * and downloads the img data on demand, if it does not exist
   *
   * @param {String} deckString the complete deck, copied from a site or e.g forge
   * @memberof MtgInterface
   */
  async createDeck(deckString, update = () => {}) {
    // convert the deck string to an array

    let groups = [...deckString.match(/#(.*?)(\n|$)/g) || ["main"]];
    const deckRaw = deckString.trim().replace(/\((.*?)\)|([0-9]*\n)/g, "\n").replace(/\s*\n+\s*\n+/g, "\n").split("\n");
    if (!deckRaw) return [];
    if (!deckRaw[0].includes("#")) {
      if (groups[0] !== "main") {
        groups = ["main"].concat(groups);
      }
    } else {
      deckRaw.shift();
    }

    groups = groups.map(v => { return { deck: {}, name: v.replace("#", "").trim() } });

    let curGroup = 0;

    let progress = 0;
    // iterate each found card
    for (let card of deckRaw) {
      if (!card) continue;
      if (card.includes("#")) {
        curGroup++;
        if (curGroup > groups.length) curGroup = 0;
        continue;
      }
      progress++;
      const deck = groups[curGroup].deck;
      update(progress, deckRaw.length - groups.length + 1);
      // extract the count from the string and free the name

      let count = Math.floor(((card.match(/(\d+)/) || [])[0] || 1));
      if (isNaN(count)) {
        count = 1;
      }
      const name = card.replace(/(\d+)/, "").trim();
      if (!name) continue; // cant work with this data
      // search the according data
      let data = await this.cardByName(name);
      if (data.code == "not_found") {
        data = { image_uris: {} };
      }
      if (deck[name]) {
        deck[name].count += count;
      } else {
        // wrap data in easy readable format
        let backside = "";
        if (!data.image_uris) {
          if (data.card_faces) {
            data.image_uris = data.card_faces[0].image_uris;
            const biu = data.card_faces[1].image_uris;
            backside = biu ? biu.border_crop || biu.normal : "";
          }
          console.log("err", data);
        }

        const url = data ? data.image_uris.border_crop || data.image_uris.normal : "";
        deck[name] = {
          name,
          count,
          url,
          backside,
          data
        };
      }
    }

    const overallDevotion = {
      blue: 0,
      black: 0,
      red: 0,
      white: 0,
      green: 0,
      colorless: 0,
      generic: 0,
      sum: 0
    };
    //mana_cost: "{W}{U}{B}{R}{G} {C}"

    let overallCount = 0;
    let overallCost = 0;
    //mana_cost.split("G").length - 1
    for (let group of groups) {
      group.cards = Object.values(group.deck);
      group.cards = group.cards.sort((a, b) => a.data.cmc > b.data.cmc ? 1 : -1);

      let count = 0;
      let cost = 0;
      const devotion = {
        blue: 0,
        black: 0,
        red: 0,
        white: 0,
        green: 0,
        colorless: 0,
        generic: 0,
        sum: 0
      };
      for (let card of group.cards) {
        count += card.count;

        cost += parseFloat(card.data.prices.usd || 0) * card.count;

        devotion.blue += (card.data.mana_cost.split("U").length - 1) * card.count;
        devotion.black += (card.data.mana_cost.split("B").length - 1) * card.count;
        devotion.red += (card.data.mana_cost.split("R").length - 1) * card.count;
        devotion.white += (card.data.mana_cost.split("W").length - 1) * card.count;
        devotion.green += (card.data.mana_cost.split("G").length - 1) * card.count;
        devotion.colorless += (card.data.mana_cost.split("C").length - 1) * card.count;

        devotion.generic += Math.floor(card.data.mana_cost.replace(/[^0-9.]/g, "") || 0) * card.count;

        devotion.sum = devotion.blue + devotion.black + devotion.red + devotion.green + devotion.white + devotion.colorless + devotion.generic;

      }
      overallCost += cost;
      overallCount += count;
      group.count = count;
      group.mana = devotion;
      group.cost = cost;

      overallDevotion.blue += devotion.blue;
      overallDevotion.black += devotion.black;
      overallDevotion.red += devotion.red;
      overallDevotion.white += devotion.white;
      overallDevotion.green += devotion.green;
      overallDevotion.colorless += devotion.colorless;
      overallDevotion.generic += devotion.generic;
      overallDevotion.sum += devotion.sum;
    }
    groups["cardCount"] = overallCount;
    groups["cost"] = overallCost;
    groups["mana"] = overallDevotion;
    return groups;
  }
}


module.exports = new MtgInterface();