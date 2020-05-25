const fs = require('fs');
const path = require("path");
const request = require('request');
// path to where the images are downloaded
const IMG_OUTPUT_FOLDER = path.join(__dirname, "../public/imgs");
const CARD_DATA = require("./scryfall-default-cards.json");


function download(uri, filename) {
  return new Promise((resolve, reject) => {
    request.head(uri, function(err, res, body) {
      request(uri).pipe(fs.createWriteStream(filename))
        .on('close', () => resolve())
        .on("error", (err) => reject(err));
    });
  });
};

function doesFileExist(path) {
  return new Promise((resolve, reject) => {
    fs.access(path, fs.F_OK, (err) => {
      if (err) resolve(false);
      return resolve(true);
      // return resolve(err ? false : true);
    });
  });
}

function cardByName(name) {
  for (let card of CARD_DATA) {
    if (card.name.toLowerCase() == name.toLowerCase()) return card;
  }
}

class MtgInterface {

  constructor() {

  }

  /**
   * converts a deck string to a readable object
   * and downloads the img data on demand, if it does not exist
   *
   * @param {String} deckString the complete deck, copied from a site or e.g forge
   * @memberof MtgInterface
   */
  async createDeck(deckString) {
    // convert the deck string to an array
    const deckRaw = deckString.trim().replace(/\((.*?)\)|([0-9]*\n)/g, "\n").replace(/\s*\n+\s*\n+/g, "\n").split("\n");
    const deck = {};
    const imgs = [];
    const downloads = [];
    const errors = [];

    // iterate each found card
    for (let card of deckRaw) {
      if (!card) continue;
      // extract the count from the string and free the name
      const count = ((card.match(/(\d+)/) || [])[0] || 1);
      const name = card.replace(/(\d+)/, "").trim();
      if (!name) continue; // cant work with this data
      // search the according data
      const data = cardByName(name);
      // put into error list, if there is a name, but no data 
      // typo?
      if (!data) {
        errors.push(name);
        continue;
      }
      // if card was mentioned multiple times, summ the counts up
      if (deck[name]) {
        deck[name].count += count;
      } else {
        // wrap data in easy readable format
        deck[name] = {
          count,
          data
        };
      }
      // download the image, if it does not exist
      const targetPath = path.join(IMG_OUTPUT_FOLDER, data.id + ".jpg");
      const url = data.image_uris.border_crop || data.image_uris.normal;
      imgs.push(data.id);
      // if there occures an error in filecheck, catch it and download the file
      downloads.push(doesFileExist(targetPath).catch(() => download(url, targetPath)).catch(e => console.log(e)));
    }

    // await here, because the imgs should be ready, 
    // when the client fetches them
    await Promise.all(downloads);

    return {
      deck, // all deckdata with counts 
      imgs, // client needs to fetch this
      errors
    };
  }


  async loadSingle(card) {
    if (!card) throw new Error("No card name provided");
    const name = card.replace(/(\d+)/, "").trim();
    if (!name) throw new Error("Cannot parse card name"); // cant work with this data
    // search the according data
    const data = cardByName(name);
    // put into error list, if there is a name, but no data 
    // typo?
    if (!data) {
      throw new Error("Card not found");
    }

    // download the image, if it does not exist
    const targetFileName = data.id + ".jpg";
    const targetPath = path.join(IMG_OUTPUT_FOLDER, targetFileName);
    const url = data.image_uris.border_crop || data.image_uris.normal;
    // if there occures an error in filecheck, catch it and download the file
    const doesExist = await doesFileExist(targetPath);
    const result = {
      img: targetFileName,
      data
    };

    if (doesExist) return result;
    await download(url, targetPath);
    return result;
  }
}


module.exports = MtgInterface;