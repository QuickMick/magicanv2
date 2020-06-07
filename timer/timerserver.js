// Dependencies

const express = require('express');
const http = require('http');
const path = require('path');
const socketIO = require('socket.io');
const app = express();
const server = http.Server(app);
const io = socketIO(server);

app.set('port', 3334);
app.use(express.static('public'));
//app.use('/', express.static(__dirname + './public'));

// Routing
app.get('/', function(request, response) {
  response.sendFile(path.join(__dirname, 'public/index.html'));
});

// Starts the server.
server.listen(3334, function() {
  console.log('Starting server on port 3334');
});



const states = [{
  id: 1,
  time: 0,
  name: "mick",
  activated: false
}, {
  id: 2,
  time: 0,
  name: "thomas",
  activated: false
}, {
  id: 3,
  time: 0,
  name: "florian",
  activated: false
}, {
  id: 4,
  time: 0,
  name: "michi",
  activated: false
}];

setInterval(() => {
  for (let state of states) {
    if (!state.activated) continue;
    if (!state.time) state.time = 0;
    state.time += 1;
  }
  io.emit("update", {
    states: states
  });
}, 1000);

io.on('connection', async (socket) => {
  socket.emit("update", {
    states: states
  });

  socket.on("rename", (payload) => {
    for (let state of states) {
      const isActive = state.id == payload.id
      if (!isActive) continue;
      state.name = payload.name;
      break;
    }
    io.emit("update", {
      states: states
    });
  });

  socket.on("activate", (payload) => {
    for (let state of states) {
      const isActive = state.id == payload.id
      state.activated = isActive;
    }
    io.emit("update", {
      states: states
    });
  });
});

//new GameController(io);