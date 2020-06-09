const {
  protocol,
  app,
  BrowserWindow,
  ipcMain,
  Menu
} = require('electron');

const path = require("path");
const fs = require("fs");
const TEMP = "temp";
process.chdir(__dirname);
let mw = null;
const HOME_PATH = path.join(app.getPath('documents'), "deckbuilder");
const DEV = true;
class Window extends BrowserWindow {
  constructor() {
    super({
      width: 800,
      height: 600
    });

    try {
      this.config = fs.readFileSync(path.join(HOME_PATH, "settings.cfg"));
      this.config = JSON.parse(this.config.toString());
    } catch (e) {
      this.config = {};
    }




    if (!fs.existsSync(HOME_PATH)) {
      fs.mkdirSync(HOME_PATH);
    }



    this.setMenu(null);

    this.updateMenu();
    this.loadFile('index.html');

    setTimeout(() => {
      if (this.config.lastDeck) {
        this.loadDeck(this.config.lastDeck);
      }
    }, 1000);
    if (DEV === true) {
      // Open the DevTools.
      this.webContents.openDevTools();
    }




    // Emitted when the window is closed.
    this.on('closed', () => {});

    ipcMain.on("saveDeck", (sender, event) => {
      const file = path.join(HOME_PATH, event.name + ".gdeck");
      fs.writeFile(file, event.deck, (err) => {
        console.log("saved", file);
        this.updateMenu();
      });

    });

    ipcMain.on("checkFile", (sender, event) => {
      const file = path.join(__dirname, TEMP, event.path.replace(/[^a-zA-Z\s.]/g, ""));
      fs.access(file, fs.F_OK, (err) => {
        this.webContents.send("fileChecked", {
          id: event.id,
          error: err
        });
        // return resolve(err ? false : true);
      });
    });

    ipcMain.on("saveFile", (sender, event) => {
      const file = path.join(__dirname, TEMP, event.path.replace(/[^a-zA-Z\s.]/g, ""));
      fs.writeFile(file, event.content, function(err) {
        console.log("saved", file);
      });
    });


    ipcMain.on("loadFile", (sender, event) => {
      console.log(event);
      const file = path.join(__dirname, TEMP, event.path.replace(/[^a-zA-Z\s.]/g, ""));
      fs.readFile(file, 'utf8', (err, data) => {
        this.webContents.send("fileLoaded", {
          id: event.id,
          error: err,
          result: data
        });
      });

    });
  }

  loadDeck(deckFile) {
    const file = path.join(HOME_PATH, deckFile);
    fs.readFile(file, 'utf8', (err, data) => {
      this.webContents.send("loadDeck", {
        name: deckFile,
        deck: data
      });

      this.config.lastDeck = deckFile;

      fs.writeFile(path.join(HOME_PATH, "settings.cfg"), JSON.stringify(this.config), (err) => {
        console.error(err);
      });
    });

  }

  updateMenu() {
    const menuTemplate = [];
    const decks = fs.readdir(HOME_PATH, (err, decks) => {
      for (let deckFile of decks) {
        if (deckFile == "settings.cfg") continue;
        menuTemplate.push({
          label: deckFile,
          click: () => {
            this.loadDeck(deckFile);
          }
        });
      }

      this.setMenu(Menu.buildFromTemplate([{ label: "Decks", submenu: menuTemplate }]));
    });
  }

  static create() {
    if (!mw) {
      mw = new Window();
    }
  }
}



app.on('ready', () => {
  protocol.interceptFileProtocol('file', (request, callback) => {
    const x = app.getAppPath().replace(/\\/g, "\/");
    let url = request.url.replace(x, "").replace("file:\/\/", "").replace(__dirname, "");

    //fs.writeFileSync("./text.txt", url + "\n" + request.url + "\n" + app.getAppPath() + "\n" + x);
    // url = url.replace("/F:/PROGRAMMING/magicanv2/editor/node_modules/electron/dist/resources/default_app.asar/", "");
    url = path.join(__dirname, url);
    url = path.normalize(url);


    url = url;
    console.log(url);
    callback({ path: url });
  }, (error) => {
    if (error) console.error('Failed to register protocol');
  });
  Window.create();

});
app.on('activate', () => Window.create());

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') app.quit();
});