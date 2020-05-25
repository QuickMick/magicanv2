const Events = require("events");
const ObjectId = require("bson-objectid");

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
    const id = ObjectId().toString();
    if (data.type === "card") {
      const result = {
        x: 0,
        y: 0,
        img: data.img,
        _id: id
      };
      this.entities[id] = result;
      this.emit("created", {
        [id]: result
      });
    }
  }

  updateEntity(id, updates) {
    const cur = this.entities[id];
    this.entities[id] = Object.assign(cur, updates);

    this.emit("updated", {
      [id]: cur
    });

  }
}
module.exports = EntityHandler;