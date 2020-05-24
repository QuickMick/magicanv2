import io from "socket.io-client";
import { connected, initialized } from "./views/store.js";
class Connector {
  constructor() {
    this.io = null;

    this.initialized = false;

    connected.set(false);
    initialized.set(false);
  }

  on(msg, cb) {
    this.io.on(msg, cb);
  }

  init() {
    this.io = io();
    this.io.on('connect', () => connected.set(true));
    this.io.on("init", () => {
      initialized.set(true);
    });
    this.io.on("entity.update", () => {
      if (!this.initialized) return;
    });
  }

  send(name, msg) {
    this.io.emit(name, msg);
  }
}

export default new Connector();