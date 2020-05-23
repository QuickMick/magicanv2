const RMI_TIMEOUT = 3000;

class RmiCaller {
  constructor(socket, sendEventName, receiveEventName) {
    if (!socket) throw new Error("no socket passed to RMI handler");
    this.socket = socket;
    this.rmis = {}; // contains resolve methods from promies for rmi
    this._destroyed = false;
    this.timeouts = new Set();
    this._sendEventName = sendEventName;
    this.socket.on(receiveEventName, (result = {}) => {
      const resolve = this.rmis[result.correlation];
      if (!resolve) {
        console.log("could not find rmi cb for", result.correlation);
        return;
      }
      resolve(result.payload || {});
    });
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    for (let id of this.timeouts) {
      clearTimeout(id);
    }
    for (let key in this.rmis) {
      const func = this.rmis[key];
      if (!func) return;
      func();
    }
  }

  call(type, payload = {}) {
    if (this._destroyed) return;
    return new Promise((resolve, reject) => {
      const packet = {
        type,
        payload,
        correlation: uuid()
      };

      let isResolved = false;
      // let the RMI timeout, so there is no memory leak,
      // when e.g. the client disconnects during one
      const timeoutId = setTimeout(() => {
        if (this._destroyed) return;
        this.timeouts.delete(timeoutId);
        // just in case do a check, if clearTimeout did not work properly
        if (isResolved) return;
        console.log("rmi timed out for ", packet.correlation);
        reject("RMI_TIMEOUT");
        delete this.rmis[packet.correlation];
      }, RMI_TIMEOUT);

      this.timeouts.add(timeoutId);

      // the funktion is called in the socket event handler for
      // rmi resolves
      this.rmis[packet.correlation] = (result) => {
        this.timeouts.delete(timeoutId);
        isResolved = true;
        clearTimeout(timeoutId);
        if (this._destroyed) return;
        delete this.rmis[packet.correlation];
        if (packet.error) return reject(new Error(packet.error));

        resolve(result); // this ends the RMI request
      };

      this.socket.emit(this._sendEventName, packet);
    });
  }

  /**
   * if there is an error during an rmi-call,
   * this will retriy it a few times
   *
   * @param {*} type
   * @param {*} payload
   * @param {number} [count=3] how often it should be retried
   * @returns
   * @memberof RmiHandler
   */
  async retry(type, payload, count = 3) {
    // do nothing anymore, if there is no retry leftover
    if (count == 0) return;
    try {
      return await this.call(type, payload);
    } catch (e) {
      // decrement the count before passing, 
      // so the next call does the retry one time less
      return this.retry(type, payload, --count);
    }
  }
}

module.exports = RmiCaller;