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

  search(opts = {}) {
    // https://api.scryfall.com/cards/search?order=cmc&q=c%3Ared+pow%3D3 
    // https://scryfall.com/search?as=grid&order=name&q=myr+oracle%3Atoken+type%3Acreature+commander%3AWUBRG

    let baseurl;

    if (typeof opts != "string") {
      baseurl = `https://api.scryfall.com/cards/search?${opts.page?"page="+opts.page+"&":""}order=cmc&q=`;
      const queries = [];

      if (opts.name) {
        queries.push(opts.name);
      }

      if (opts.edhcolors && opts.edhcolors.size) {
        let cs = "";
        for (let color of opts.edhcolors) {
          color = color.toUpperCase();
          if (color === "C") {
            cs = "C";
            break;
          }
          cs += color;
        }
        queries.push("commander%3A" + cs);
      }


      if (opts.type) {
        queries.push("type%3A" + opts.type);
      }
      if (opts.text) {
        queries.push("oracle%3A" + opts.text);
      }

      baseurl = baseurl + queries.join("+");
    } else {
      baseurl = opts;
    }
    return fetch(baseurl)
      .then(response => response.json())
      .then(response => {
        for (let c of response.data) {
          console.log("c", c);
          if (!c.image_uris) {
            if (c.card_faces) {
              c.image_uris = c.card_faces[0].image_uris;
              const biu = c.card_faces[1].image_uris;
              c.backside = biu ? biu.border_crop || biu.normal : "";
            }
          }
          c.url = c ? c.image_uris.border_crop || c.image_uris.normal : "";
          this.__cache[c.name] = c;
        }
        return response;
      })
      .catch(e => { console.log(e); return { code: "not_found" }; });

  }

  async cardByName(name) {
    if (this.__cache[name]) return this.__cache[name];
    await timeout();
    //https://api.scryfall.com/cards/named?fuzzy=aust+com 
    const fixed = name.replace(/\s/g, "+");
    const result = await fetch('https://api.scryfall.com/cards/named?fuzzy=' + fixed)
      .then(response => response.json()).catch(e => { console.log(e); return { code: "not_found" }; });

    this.__cache[name] = result;
    this.__cache[result.name] = result;
    return result;
    // .then(data => console.log(data));
    /* for (let card of CARD_DATA) {
       if (card.name.toLowerCase() == name.toLowerCase()) return card;
     }*/
  }

  async sort(deckString, update = () => {}) {
    deckString = deckString.replace(/#.*/gm, "");
    const deckRaw = deckString.trim().replace(/\((.*?)\)|([0-9]*\n)/g, "\n").replace(/\s*\n+\s*\n+/g, "\n").split("\n");

    let creatures = {};
    let spells = {};
    let lands = {};
    let maybe = [];
    const errors = [];


    let progress = 0;
    for (let card of deckRaw) {

      let count = Math.floor(((card.match(/(\d+)/) || [])[0] || 1));
      if (isNaN(count)) {
        count = 1;
      }
      progress++;

      if (card.trim().startsWith("//")) {
        maybe.push(card.trim());
        continue;
      };

      const name = card.replace(/(\d+)/, "").trim();
      if (!name) continue; // cant work with this data
      // search the according data
      try {
        let data = await this.cardByName(name);

        if (data.type_line.toLowerCase().includes("land")) {
          lands[data.name] = lands[data.name] || { data, count: 0, name: data.name };
          lands[data.name].count++;
        } else if (data.type_line.toLowerCase().includes("creature")) {
          creatures[data.name] = creatures[data.name] || { data, count: 0, name: data.name };
          creatures[data.name].count++;
        } else {
          spells[data.name] = spells[data.name] || { data, count: 0, name: data.name };
          spells[data.name].count++;
        }

      } catch (e) {
        errors.push(name);
      }
      update(progress, deckRaw.length);
    }

    creatures = Object.values(creatures).sort((a, b) => a.data.cmc > b.data.cmc ? 1 : -1);
    spells = Object.values(spells).sort((a, b) => a.data.cmc > b.data.cmc ? 1 : -1);
    lands = Object.values(lands).sort((a, b) => a.name > b.name ? 1 : -1);
    let output = "# Creatures";
    for (let cur of creatures) {
      output += "\n" + cur.count + " " + cur.name;
    }
    output += "\n\n# Spells";
    for (let cur of spells) {
      output += "\n" + cur.count + " " + cur.name;
    }

    output += "\n\n# Lands"
    for (let cur of lands) {
      output += "\n" + cur.count + " " + cur.name;
    }

    output += "\n\n# Maybe"
    for (let cur of maybe) {
      output += "\n//" + cur;
    }

    output += "\n\n# Not Found"
    for (let cur of errors) {
      output += "\n//" + cur.count + " " + cur.name;
    }


    return output;
  }


  /**
   * converts a deck string to a readable object
   * and downloads the img data on demand, if it does not exist
   *
   * @param {String} deckString the complete deck, copied from a site or e.g forge
   * @memberof MtgInterface
   */
  async createDeck(deckString, update = () => {}, sort = false) {
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
    let ignored = 0;
    // iterate each found card
    for (let card of deckRaw) {
      if (!card) continue;
      if (card.trim().startsWith("//")) continue;
      if (card.includes("#")) {
        curGroup++;
        if (curGroup > groups.length) curGroup = 0;
        continue;
      }
      progress++;

      const deck = groups[curGroup].deck;
      update(progress, deckRaw.length - groups.length + 1 - ignored);
      // extract the count from the string and free the name

      let count = Math.floor(((card.match(/(\d+)/) || [])[0] || 1));
      if (isNaN(count)) {
        count = 1;
      }
      const name = card.replace(/(\d+)/, "").trim();
      if (!name) continue; // cant work with this data
      // search the according data
      let data = await this.cardByName(name);

      if (data.name)
        deckString = deckString.replace(name, data.name);
      if (data.code == "not_found") {
        data = { image_uris: {}, legalities: {}, prices: { usd: 0 }, mana_cost: "", cmc: 0, type_line: "land" };
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
    let landCount = 0;
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
    const overallManaCurve = [];
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
      const manaCurve = [];
      for (let card of group.cards) {
        count += card.count;

        cost += parseFloat(card.data.prices.usd || 0) * card.count;

        if (!card.data.type_line.toLowerCase().includes("land")) {
          manaCurve[card.data.cmc || 0] = (manaCurve[card.data.cmc || 0] || 0) + card.count;
        } else {
          landCount += card.count;
        }

        card.data.mana_cost = card.data.mana_cost || "";
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

      group.manaCurve = manaCurve;
      for (let i = 0; i < manaCurve.length; i++) {
        manaCurve[i] = manaCurve[i] || 0;
        overallManaCurve[i] = (overallManaCurve[i] || 0) + (manaCurve[i] || 0);
      }

      overallDevotion.blue += devotion.blue;
      overallDevotion.black += devotion.black;
      overallDevotion.red += devotion.red;
      overallDevotion.white += devotion.white;
      overallDevotion.green += devotion.green;
      overallDevotion.colorless += devotion.colorless;

      overallDevotion.generic += devotion.generic;
      overallDevotion.sum += devotion.sum;
    }

    for (let i = 0; i < overallManaCurve.length; i++) {
      overallManaCurve[i] = overallManaCurve[i] || 0;
    }

    const nonlands = overallCount - landCount;

    let justDevotion = overallDevotion.blue + overallDevotion.black + overallDevotion.red + overallDevotion.white + overallDevotion.green + overallDevotion.colorless;
    justDevotion = justDevotion || 1;
    const manaProposal = {
      blue: overallDevotion.blue / justDevotion,
      black: overallDevotion.black / justDevotion,
      red: overallDevotion.red / justDevotion,
      white: overallDevotion.white / justDevotion,
      green: overallDevotion.green / justDevotion,
      colorless: overallDevotion.colorless / justDevotion,
    };

    groups["manaProposal"] = manaProposal;

    groups["landCount"] = landCount;
    groups["cardCount"] = overallCount;
    groups["averageMana"] = overallDevotion.sum / (overallCount - landCount);
    groups["cost"] = overallCost;
    groups["mana"] = overallDevotion;
    groups["corrected"] = deckString;
    groups["manaCurve"] = overallManaCurve;
    return groups;
  }
}


module.exports = new MtgInterface();