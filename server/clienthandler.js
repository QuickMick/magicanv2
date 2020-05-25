const MtgInterface = require("./mtg-interface");
const EntityHandler = require("./entityhandler");

class ClientHandler {
  constructor() {
    this.io = null;
    this.mtgInterface = new MtgInterface();
    this.entityHandler = new EntityHandler();
    // all connected clients
    this.clients = {};

  }

  init(io) {
    this.io = io;

    this.entityHandler.on("updated", (update) => {
      this.broadcast("entity.updated", update);
    });

    this.entityHandler.on("created", (update) => {
      this.broadcast("entity.created", update);
    });

    io.on('connection', async (socket) => {
      socket.emit("init", {
        entities: this.entityHandler.getCurrentState()
      });

      socket.on("create.deck", (payload) => {
        //  const createdDeck = await this.mtgInterface.createDeck(payload.deck);
      });


      socket.on("create.single", async (payload) => {

        try {
          const result = await this.mtgInterface.loadSingle(payload.cardName);
          result.type = "card";
          this.entityHandler.createEntity(result);
          //  const createdDeck = await this.mtgInterface.createDeck(payload.deck);
        } catch (e) {
          console.error(e);
          socket.emit("error", { error: "cannot load card" });
        }
      });

      socket.on("update.entity", (payload) => {
        this.entityHandler.updateEntity(payload._id, payload.data);


      });
    });

  }

  broadcast(type, msg) {
    //  this.io.to(this.id).emit(type, msg);
    this.io.emit(type, msg);
  }

  sendAllOthers(senderSocket, type, msg) {
    senderSocket.broadcast.emit(type, msg);
  }

  sendToClient(clientConnectionSocket, type, msg) {
    clientConnectionSocket.emit(type, msg);
  }

}






module.exports = ClientHandler;