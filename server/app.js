// Dependencies

const express = require('express');
const http = require('http');
const path = require('path');
const socketIO = require('socket.io');
const ClientHandler = require("./clienthandler");
const app = express();
const server = http.Server(app);
const io = socketIO(server);


const clientHandler = new ClientHandler();
clientHandler.init(io);
//const GameController = require("./server/gamecontroller");

app.set('port', 3333);
app.use('/', express.static(__dirname + './../public'));

// Routing
app.get('/', function(request, response) {
  response.sendFile(path.join(__dirname, 'public/index.html'));
});

// Starts the server.
server.listen(3333, function() {
  console.log('Starting server on port 3333');
});

//new GameController(io);