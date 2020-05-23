class RmiHandler {
  constructor(socket, sendEventName, receiveEventName) {
    this.socket = socket;

    this._sendEventName = sendEventName;
    this._receiveEventName = receiveEventName;

    this.handlers = {};

    this.socket.on(this._receiveEventName, async (packet = {}) => {
      const handler = this.handlers[packet.type];
      const result = { correlation: packet.correlation };
      // if the handler was not found, return an error
      if (!handler) {
        result.error = "RMI_NOT_HANDLED";
        this.socket.emit(this._sendEventName, result);
        return;
      }

      try {
        const payload = await handler(packet.payload);
        result.payload = payload;
        this.socket.emit(this._sendEventName, result);
      } catch (e) {
        result.error = e.message;
        this.socket.emit(this._sendEventName, result);
      }
    });
  }
  destroy() {
    // TODO: remove listeners from socket?
  }

  add(type, handler) {
    this.handlers[type] = handler;
  }
}

module.exports = RmiHandler;