const MtgInterface = require("./mtg-interface");

class ClientHandler {
  constructor() {
    this.io = null;
    this.mtgInterface = new MtgInterface();

    // all connected clients
    this.clients = {};


  }

  init(io) {
    this.io = io;
    io.on('connection', async (socket) => {

      socket.on("createdeck", (payload) => {
        //  const createdDeck = await this.mtgInterface.createDeck(payload.deck);
      });

    });

  }

  broadcast(type, msg) {
    this.io.to(this.id).emit(type, msg);
  }

  /* sendAllOthers(senderSocket, type, msg) {
     senderSocket.broadcast.emit(type, msg);
   }

   sendToClient(clientConnectionSocket, type, msg) {
     clientConnectionSocket.emit(type, msg);
   }*/

}






module.exports = ClientHandler;