const Events = require("events");

class EntityHandler extends Events {
  constructor() {
    super();
    this.entities = {
      abcd: {
        x: 0,
        y: 0,
        img: "swamp.jpg",
        _id: "abcd"
      }
    };
  }

  getCurrentState() {
    return this.entities;
  }

  createEntity(data) {

  }

  updateEntity(id, updates) {
    const cur = this.entities[id];
    this.entities[id] = Object.assign(cur, updates);

    this.emit("entity.update", {
      [id]: cur
    });

  }
}
module.exports = EntityHandler();