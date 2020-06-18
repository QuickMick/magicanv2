(function () {
	'use strict';

	function noop() {}

	function assign(tar, src) {
		for (const k in src) tar[k] = src[k];
		return tar;
	}

	function is_promise(value) {
		return value && typeof value.then === 'function';
	}

	function add_location(element, file, line, column, char) {
		element.__svelte_meta = {
			loc: { file, line, column, char }
		};
	}

	function run(fn) {
		return fn();
	}

	function blank_object() {
		return Object.create(null);
	}

	function run_all(fns) {
		fns.forEach(run);
	}

	function is_function(thing) {
		return typeof thing === 'function';
	}

	function safe_not_equal(a, b) {
		return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
	}

	function append(target, node) {
		target.appendChild(node);
	}

	function insert(target, node, anchor) {
		target.insertBefore(node, anchor);
	}

	function detach(node) {
		node.parentNode.removeChild(node);
	}

	function destroy_each(iterations, detaching) {
		for (let i = 0; i < iterations.length; i += 1) {
			if (iterations[i]) iterations[i].d(detaching);
		}
	}

	function element(name) {
		return document.createElement(name);
	}

	function text(data) {
		return document.createTextNode(data);
	}

	function space() {
		return text(' ');
	}

	function empty() {
		return text('');
	}

	function listen(node, event, handler, options) {
		node.addEventListener(event, handler, options);
		return () => node.removeEventListener(event, handler, options);
	}

	function prevent_default(fn) {
		return function(event) {
			event.preventDefault();
			return fn.call(this, event);
		};
	}

	function stop_propagation(fn) {
		return function(event) {
			event.stopPropagation();
			return fn.call(this, event);
		};
	}

	function attr(node, attribute, value) {
		if (value == null) node.removeAttribute(attribute);
		else node.setAttribute(attribute, value);
	}

	function to_number(value) {
		return value === '' ? undefined : +value;
	}

	function children(element) {
		return Array.from(element.childNodes);
	}

	function set_data(text, data) {
		data = '' + data;
		if (text.data !== data) text.data = data;
	}

	function toggle_class(element, name, toggle) {
		element.classList[toggle ? 'add' : 'remove'](name);
	}

	let current_component;

	function set_current_component(component) {
		current_component = component;
	}

	function get_current_component() {
		if (!current_component) throw new Error(`Function called outside component initialization`);
		return current_component;
	}

	function onMount(fn) {
		get_current_component().$$.on_mount.push(fn);
	}

	const dirty_components = [];

	let update_promise;
	const binding_callbacks = [];
	const render_callbacks = [];
	const flush_callbacks = [];

	function schedule_update() {
		if (!update_promise) {
			update_promise = Promise.resolve();
			update_promise.then(flush);
		}
	}

	function add_binding_callback(fn) {
		binding_callbacks.push(fn);
	}

	function add_render_callback(fn) {
		render_callbacks.push(fn);
	}

	function flush() {
		const seen_callbacks = new Set();

		do {
			// first, call beforeUpdate functions
			// and update components
			while (dirty_components.length) {
				const component = dirty_components.shift();
				set_current_component(component);
				update(component.$$);
			}

			while (binding_callbacks.length) binding_callbacks.shift()();

			// then, once components are updated, call
			// afterUpdate functions. This may cause
			// subsequent updates...
			while (render_callbacks.length) {
				const callback = render_callbacks.pop();
				if (!seen_callbacks.has(callback)) {
					callback();

					// ...so guard against infinite loops
					seen_callbacks.add(callback);
				}
			}
		} while (dirty_components.length);

		while (flush_callbacks.length) {
			flush_callbacks.pop()();
		}

		update_promise = null;
	}

	function update($$) {
		if ($$.fragment) {
			$$.update($$.dirty);
			run_all($$.before_render);
			$$.fragment.p($$.dirty, $$.ctx);
			$$.dirty = null;

			$$.after_render.forEach(add_render_callback);
		}
	}

	let outros;

	function group_outros() {
		outros = {
			remaining: 0,
			callbacks: []
		};
	}

	function check_outros() {
		if (!outros.remaining) {
			run_all(outros.callbacks);
		}
	}

	function on_outro(callback) {
		outros.callbacks.push(callback);
	}

	function handle_promise(promise, info) {
		const token = info.token = {};

		function update(type, index, key, value) {
			if (info.token !== token) return;

			info.resolved = key && { [key]: value };

			const child_ctx = assign(assign({}, info.ctx), info.resolved);
			const block = type && (info.current = type)(child_ctx);

			if (info.block) {
				if (info.blocks) {
					info.blocks.forEach((block, i) => {
						if (i !== index && block) {
							group_outros();
							on_outro(() => {
								block.d(1);
								info.blocks[i] = null;
							});
							block.o(1);
							check_outros();
						}
					});
				} else {
					info.block.d(1);
				}

				block.c();
				if (block.i) block.i(1);
				block.m(info.mount(), info.anchor);

				flush();
			}

			info.block = block;
			if (info.blocks) info.blocks[index] = block;
		}

		if (is_promise(promise)) {
			promise.then(value => {
				update(info.then, 1, info.value, value);
			}, error => {
				update(info.catch, 2, info.error, error);
			});

			// if we previously had a then/catch block, destroy it
			if (info.current !== info.pending) {
				update(info.pending, 0);
				return true;
			}
		} else {
			if (info.current !== info.then) {
				update(info.then, 1, info.value, promise);
				return true;
			}

			info.resolved = { [info.value]: promise };
		}
	}

	function mount_component(component, target, anchor) {
		const { fragment, on_mount, on_destroy, after_render } = component.$$;

		fragment.m(target, anchor);

		// onMount happens after the initial afterUpdate. Because
		// afterUpdate callbacks happen in reverse order (inner first)
		// we schedule onMount callbacks before afterUpdate callbacks
		add_render_callback(() => {
			const new_on_destroy = on_mount.map(run).filter(is_function);
			if (on_destroy) {
				on_destroy.push(...new_on_destroy);
			} else {
				// Edge case - component was destroyed immediately,
				// most likely as a result of a binding initialising
				run_all(new_on_destroy);
			}
			component.$$.on_mount = [];
		});

		after_render.forEach(add_render_callback);
	}

	function destroy(component, detaching) {
		if (component.$$) {
			run_all(component.$$.on_destroy);
			component.$$.fragment.d(detaching);

			// TODO null out other refs, including component.$$ (but need to
			// preserve final state?)
			component.$$.on_destroy = component.$$.fragment = null;
			component.$$.ctx = {};
		}
	}

	function make_dirty(component, key) {
		if (!component.$$.dirty) {
			dirty_components.push(component);
			schedule_update();
			component.$$.dirty = {};
		}
		component.$$.dirty[key] = true;
	}

	function init(component, options, instance, create_fragment, not_equal$$1, prop_names) {
		const parent_component = current_component;
		set_current_component(component);

		const props = options.props || {};

		const $$ = component.$$ = {
			fragment: null,
			ctx: null,

			// state
			props: prop_names,
			update: noop,
			not_equal: not_equal$$1,
			bound: blank_object(),

			// lifecycle
			on_mount: [],
			on_destroy: [],
			before_render: [],
			after_render: [],
			context: new Map(parent_component ? parent_component.$$.context : []),

			// everything else
			callbacks: blank_object(),
			dirty: null
		};

		let ready = false;

		$$.ctx = instance
			? instance(component, props, (key, value) => {
				if ($$.ctx && not_equal$$1($$.ctx[key], $$.ctx[key] = value)) {
					if ($$.bound[key]) $$.bound[key](value);
					if (ready) make_dirty(component, key);
				}
			})
			: props;

		$$.update();
		ready = true;
		run_all($$.before_render);
		$$.fragment = create_fragment($$.ctx);

		if (options.target) {
			if (options.hydrate) {
				$$.fragment.l(children(options.target));
			} else {
				$$.fragment.c();
			}

			if (options.intro && component.$$.fragment.i) component.$$.fragment.i();
			mount_component(component, options.target, options.anchor);
			flush();
		}

		set_current_component(parent_component);
	}

	class SvelteComponent {
		$destroy() {
			destroy(this, true);
			this.$destroy = noop;
		}

		$on(type, callback) {
			const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
			callbacks.push(callback);

			return () => {
				const index = callbacks.indexOf(callback);
				if (index !== -1) callbacks.splice(index, 1);
			};
		}

		$set() {
			// overridden by instance, if it has props
		}
	}

	class SvelteComponentDev extends SvelteComponent {
		constructor(options) {
			if (!options || (!options.target && !options.$$inline)) {
				throw new Error(`'target' is a required option`);
			}

			super();
		}

		$destroy() {
			super.$destroy();
			this.$destroy = () => {
				console.warn(`Component was already destroyed`); // eslint-disable-line no-console
			};
		}
	}

	// path to where the images are downloaded
	//const CARD_DATA = require("./scryfall-default-cards.json");


	//const fs = require("fs");

	const ObjectId = () => { return Date.now() }; // require("bson-objectid");

	function timeout() {
	  return new Promise((resolve, reject) => {
	    setTimeout(() => {
	      resolve();
	    }, 70);
	  });
	}




	/*

	*/


	class MtgInterface {

	  constructor(ipcRenderer) {
	    this.__cache = {};
	    this.ipcRenderer = ipcRenderer;
	    this.downloads = Promise.resolve();
	    this.fetches = Promise.resolve();


	    this.loadProms = {};
	    this.existProms = {};

	    ipcRenderer.on("fileLoaded", (sender, data) => {
	      const c = this.loadProms[data.id];
	      if (!c) return;
	      if (data.error) c.reject(data.error);
	      else c.resolve(JSON.parse(data.result || "{}"));
	      delete this.loadProms[data.id];
	    });

	    ipcRenderer.on("fileChecked", (sender, data) => {
	      const c = this.existProms[data.id];
	      if (!c) return;
	      if (data.error) c.resolve(false); //c.reject(data.error);
	      else c.resolve(true);
	      delete this.existProms[data.id];
	    });
	  }


	  doesFileExist(path) {
	    const id = ObjectId().toString();
	    const p = new Promise((resolve, reject) => {

	      this.ipcRenderer.send("checkFile", { path, id });
	      this.existProms[id] = { resolve, reject };
	    });
	    return p;
	  }

	  saveFile(path, content) {
	    const id = ObjectId().toString();
	    content = JSON.stringify(content);
	    this.ipcRenderer.send("saveFile", { path, content, id });

	    /*  return new Promise((resolve, reject) => {
	        fs.writeFile(file, content, function(err) {
	          if (err) return reject(err);
	          resolve();
	        });
	      });*/
	  }

	  loadFile(path) {
	    const id = ObjectId().toString();
	    const p = new Promise((resolve, reject) => {
	      this.ipcRenderer.send("loadFile", { path, id });
	      this.loadProms[id] = { resolve, reject };
	    });
	    return p;
	  }


	  search(opts = {}) {
	    // https://api.scryfall.com/cards/search?order=cmc&q=c%3Ared+pow%3D3 
	    // https://scryfall.com/search?as=grid&order=name&q=myr+oracle%3Atoken+type%3Acreature+commander%3AWUBRG

	    let baseurl;

	    if (typeof opts != "string") {
	      baseurl = `https://api.scryfall.com/cards/search?${opts.page?"page="+opts.page+"&":""}order=cmc&q=`;
	      const queries = [];

	      if (opts.name) {
	        queries.push(opts.name);
	      }

	      if (opts.edhcolors && opts.edhcolors.size) {
	        let cs = "";
	        for (let color of opts.edhcolors) {
	          color = color.toUpperCase();
	          if (color === "C") {
	            cs = "C";
	            break;
	          }
	          cs += color;
	        }
	        queries.push("commander%3A" + cs);
	      }


	      if (opts.type) {
	        let type = opts.type.trim().replace(/\s\s+/gm, " ").replace(/\s/gm, "+type%3A");
	        queries.push("type%3A" + type);
	      }
	      if (opts.text) {
	        let text = opts.text.trim().replace(/\s\s+/gm, " ").replace(/\s+/gm, "+oracle%3A");
	        queries.push("oracle%3A" + text);
	      }

	      baseurl = baseurl + queries.join("+");
	    } else {
	      baseurl = opts;
	    }
	    console.log("searchquery", baseurl);
	    return fetch(baseurl)
	      .then(async response => {
	        const a = await response.json();
	        return a;
	      })
	      .then(response => {
	        for (let c of response.data) {
	          console.log("c", c);
	          if (!c.image_uris) {
	            if (c.card_faces) {
	              c.image_uris = c.card_faces[0].image_uris;
	              const biu = c.card_faces[1].image_uris;
	              c.backside = biu ? biu.border_crop || biu.normal : "";
	            }
	          }
	          c.url = c ? c.image_uris.border_crop || c.image_uris.normal : "";
	          c.cardmarket = (c.purchase_uris || {}).cardmarket || "";
	          this.__cache[c.name] = c;
	        }
	        return response;
	      })
	      .catch(e => { console.log(e); return { code: "not_found", data: [] }; });

	  }

	  async cardByName(name) {
	    if (this.__cache[name]) return this.__cache[name];

	    const p = name; //path.join(__dirname, TEMP, name);
	    const exists = await this.doesFileExist(p);

	    try {
	      if (exists) {
	        this.__cache[name] = await this.loadFile(p);
	        return this.__cache[name];
	      }
	    } catch (e) {
	      console.error("could not load local file", name, e.message);
	    }


	    await timeout();
	    //https://api.scryfall.com/cards/named?fuzzy=aust+com 
	    const fixed = name.replace(/\s/g, "+");
	    const result = await fetch('https://api.scryfall.com/cards/named?fuzzy=' + fixed)
	      .then(response => response.json()).catch(e => { console.log(e); return { code: "not_found" }; });

	    this.__cache[name] = result;
	    this.__cache[result.name] = result;
	    this.saveFile(name, this.__cache[name]);
	    return result;
	    // .then(data => console.log(data));
	    /* for (let card of CARD_DATA) {
	       if (card.name.toLowerCase() == name.toLowerCase()) return card;
	     }*/
	  }

	  async sort(deckString, update = () => {}) {
	    deckString = deckString.replace(/#.*/gm, "");
	    const deckRaw = deckString.trim().replace(/\((.*?)\)|([0-9]*\n)/g, "\n").replace(/\s*\n+\s*\n+/g, "\n").split("\n");

	    let creatures = {};
	    let spells = {};
	    let lands = {};



	    let maybe = [];
	    const errors = [];


	    let progress = 0;
	    for (let card of deckRaw) {

	      let count = Math.floor(((card.match(/(\d+)/) || [])[0] || 1));
	      if (isNaN(count)) {
	        count = 1;
	      }
	      progress++;

	      if (card.trim().startsWith("//")) {
	        maybe.push(card.trim());
	        continue;
	      }
	      const name = card.replace(/(\d+)/, "").trim();
	      if (!name) continue; // cant work with this data
	      // search the according data
	      try {
	        let data = await this.cardByName(name);

	        if (data.type_line.toLowerCase().includes("land")) {
	          lands[data.name] = lands[data.name] || { data, count: 0, name: data.name };
	          lands[data.name].count++;
	        } else if (data.type_line.toLowerCase().includes("creature")) {
	          creatures[data.name] = creatures[data.name] || { data, count: 0, name: data.name };
	          creatures[data.name].count++;
	        } else {
	          spells[data.name] = spells[data.name] || { data, count: 0, name: data.name };
	          spells[data.name].count++;
	        }

	      } catch (e) {
	        errors.push(name);
	      }
	      update(progress, deckRaw.length);
	    }

	    creatures = Object.values(creatures).sort((a, b) => a.data.cmc > b.data.cmc ? 1 : -1);
	    spells = Object.values(spells).sort((a, b) => a.data.cmc > b.data.cmc ? 1 : -1);
	    lands = Object.values(lands).sort((a, b) => a.name > b.name ? 1 : -1);
	    let output = "# Creatures";
	    for (let cur of creatures) {
	      output += "\n" + cur.count + " " + cur.name;
	    }
	    output += "\n\n# Spells";
	    for (let cur of spells) {
	      output += "\n" + cur.count + " " + cur.name;
	    }

	    output += "\n\n# Lands";
	    for (let cur of lands) {
	      output += "\n" + cur.count + " " + cur.name;
	    }

	    output += "\n\n# Maybe";
	    for (let cur of maybe) {
	      output += "\n//" + cur;
	    }

	    output += "\n\n# Not Found";
	    for (let cur of errors) {
	      output += "\n//" + cur.count + " " + cur.name;
	    }


	    return output;
	  }


	  /**
	   * converts a deck string to a readable object
	   * and downloads the img data on demand, if it does not exist
	   *
	   * @param {String} deckString the complete deck, copied from a site or e.g forge
	   * @memberof MtgInterface
	   */
	  async createDeck(deckString, update = () => {}, sort = false) {
	    // convert the deck string to an array







	    let groups = [...deckString.match(/#(.*?)(\n|$)/g) || ["main"]];
	    const deckRaw = deckString.trim().replace(/\((.*?)\)|([0-9]*\n)/g, "\n").replace(/\s*\n+\s*\n+/g, "\n").split("\n");
	    if (!deckRaw) return [];
	    if (!deckRaw[0].includes("#")) {
	      if (groups[0] !== "main") {
	        groups = ["main"].concat(groups);
	      }
	    } else {
	      deckRaw.shift();
	    }


	    groups = groups.map(v => { return { deck: {}, name: v.replace("#", "").trim() } });

	    let curGroup = 0;

	    let progress = 0;
	    let ignored = 0;
	    // iterate each found card
	    for (let card of deckRaw) {
	      if (!card) continue;
	      if (card.trim().startsWith("//")) continue;
	      if (card.includes("#")) {
	        curGroup++;
	        if (curGroup > groups.length) curGroup = 0;
	        continue;
	      }
	      progress++;

	      const deck = groups[curGroup].deck;
	      update(progress, deckRaw.length - groups.length + 1 - ignored);
	      // extract the count from the string and free the name

	      let count = Math.floor(((card.match(/(\d+)/) || [])[0] || 1));
	      if (isNaN(count)) {
	        count = 1;
	      }
	      const name = card.replace(/(\d+)/, "").trim();
	      if (!name) continue; // cant work with this data
	      // search the according data
	      let data = await this.cardByName(name);

	      if (data.name)
	        deckString = deckString.replace(name, data.name);
	      if (data.code == "not_found") {
	        data = {
	          image_uris: {},
	          legalities: {},
	          prices: { usd: 0 },
	          mana_cost: "",
	          cmc: 0,
	          type_line: "land",
	          purchase_uris: { cardmarket: "" }
	        };
	      }
	      if (deck[name]) {
	        deck[name].count += count;
	      } else {
	        // wrap data in easy readable format
	        let backside = "";
	        if (!data.image_uris) {
	          if (data.card_faces) {
	            data.image_uris = data.card_faces[0].image_uris;
	            const biu = data.card_faces[1].image_uris;
	            backside = biu ? biu.border_crop || biu.normal : "";
	          }
	          console.log("err", data);
	        }

	        const url = data ? data.image_uris.border_crop || data.image_uris.normal : "";
	        deck[name] = {
	          name,
	          count,
	          url,
	          backside,
	          data
	        };
	      }
	    }
	    let landCount = 0;
	    const overallDevotion = {
	      blue: 0,
	      black: 0,
	      red: 0,
	      white: 0,
	      green: 0,
	      colorless: 0,
	      generic: 0,
	      sum: 0
	    };
	    const overallManaCurve = [];
	    //mana_cost: "{W}{U}{B}{R}{G} {C}"

	    let overallCount = 0;
	    let overallCost = 0;

	    let creatureCount = 0;
	    let instantCount = 0;
	    let sorceryCount = 0;
	    let enchantmentCount = 0;
	    let artifactCount = 0;
	    let planeswalkerCount = 0;

	    let typeCounts = {};

	    //mana_cost.split("G").length - 1
	    for (let group of groups) {

	      group.cards = Object.values(group.deck);
	      group.cards = group.cards.sort((a, b) => a.data.cmc > b.data.cmc ? 1 : -1);

	      let count = 0;
	      let cost = 0;
	      const isMaybe = group.name.toLowerCase() == "maybe";


	      const devotion = {
	        blue: 0,
	        black: 0,
	        red: 0,
	        white: 0,
	        green: 0,
	        colorless: 0,
	        generic: 0,
	        sum: 0
	      };
	      const manaCurve = [];
	      for (let card of group.cards) {
	        count += card.count;
	        if (!isMaybe) {

	          cost += parseFloat(card.data.prices.usd || 0) * card.count;

	          if (card.data.type_line.toLowerCase().includes("land")) {
	            landCount += card.count;
	          } else {
	            manaCurve[card.data.cmc || 0] = (manaCurve[card.data.cmc || 0] || 0) + card.count;
	          }

	          if (card.data.type_line.toLowerCase().includes("creature")) {
	            creatureCount += card.count;
	          }
	          if (card.data.type_line.toLowerCase().includes("artifact")) {
	            artifactCount += card.count;
	          }
	          if (card.data.type_line.toLowerCase().includes("enchantment")) {
	            enchantmentCount += card.count;
	          }
	          if (card.data.type_line.toLowerCase().includes("instant")) {
	            instantCount += card.count;
	          }
	          if (card.data.type_line.toLowerCase().includes("sorcery")) {
	            sorceryCount += card.count;
	          }
	          if (card.data.type_line.toLowerCase().includes("planeswalker")) {
	            planeswalkerCount += card.count;
	          }

	          // and now all

	          const types = card.data.type_line.toLowerCase().replace("-", " ").replace("—", " ").replace("//", " ").replace("basic", " ").split(" ");
	          for (let t of types) {
	            t = t.trim();
	            if (!t) continue;
	            if (!typeCounts[t]) typeCounts[t] = 0;
	            typeCounts[t]++;
	          }

	        }

	        card.data.mana_cost = card.data.mana_cost || "";
	        devotion.blue += (card.data.mana_cost.split("U").length - 1) * card.count;
	        devotion.black += (card.data.mana_cost.split("B").length - 1) * card.count;
	        devotion.red += (card.data.mana_cost.split("R").length - 1) * card.count;
	        devotion.white += (card.data.mana_cost.split("W").length - 1) * card.count;
	        devotion.green += (card.data.mana_cost.split("G").length - 1) * card.count;
	        devotion.colorless += (card.data.mana_cost.split("C").length - 1) * card.count;
	        devotion.generic += Math.floor(card.data.mana_cost.replace(/[^0-9.]/g, " ").trim().replace(/\s\s+/g, " ").split(" ").reduce((total, num) => Math.floor(total) + Math.floor(num))) * card.count;
	        // devotion.generic += Math.floor(card.data.mana_cost.replace(/[^0-9.]/g, "") || 0) * card.count;
	        devotion.sum = (devotion.sum || 0) + (Math.floor(card.data.cmc) * card.count); // devotion.blue + devotion.black + devotion.red + devotion.green + devotion.white + devotion.colorless + devotion.generic;
	      }



	      group.count = count;
	      group.mana = devotion;
	      group.cost = cost;

	      group.manaCurve = manaCurve;
	      for (let i = 0; i < manaCurve.length; i++) {
	        manaCurve[i] = manaCurve[i] || 0;
	        if (isMaybe) continue;
	        overallManaCurve[i] = (overallManaCurve[i] || 0) + (manaCurve[i] || 0);
	      }
	      if (!isMaybe) {

	        overallCost += cost;
	        overallCount += count;

	        overallDevotion.blue += devotion.blue;
	        overallDevotion.black += devotion.black;
	        overallDevotion.red += devotion.red;
	        overallDevotion.white += devotion.white;
	        overallDevotion.green += devotion.green;
	        overallDevotion.colorless += devotion.colorless;

	        overallDevotion.generic += devotion.generic;
	        overallDevotion.sum += devotion.sum;
	      }
	    }

	    for (let i = 0; i < overallManaCurve.length; i++) {
	      overallManaCurve[i] = overallManaCurve[i] || 0;
	    }

	    let justDevotion = overallDevotion.blue + overallDevotion.black + overallDevotion.red + overallDevotion.white + overallDevotion.green + overallDevotion.colorless;
	    justDevotion = justDevotion || 1;
	    const manaProposal = {
	      blue: overallDevotion.blue / justDevotion,
	      black: overallDevotion.black / justDevotion,
	      red: overallDevotion.red / justDevotion,
	      white: overallDevotion.white / justDevotion,
	      green: overallDevotion.green / justDevotion,
	      colorless: overallDevotion.colorless / justDevotion,
	    };

	    groups["manaProposal"] = manaProposal;

	    groups["landCount"] = landCount;
	    groups["cardCount"] = overallCount;
	    groups["averageMana"] = overallDevotion.sum / (overallCount - landCount);
	    groups["cost"] = overallCost;
	    groups["mana"] = overallDevotion;
	    groups["corrected"] = deckString;
	    groups["manaCurve"] = overallManaCurve;


	    groups["creatureCount"] = creatureCount;
	    groups["instantCount"] = instantCount;
	    groups["sorceryCount"] = sorceryCount;
	    groups["planeswalkerCount"] = planeswalkerCount;
	    groups["enchantmentCount"] = enchantmentCount;
	    groups["artifactCount"] = artifactCount;
	    groups["typeCounts"] = typeCounts;

	    delete typeCounts.enchantment;
	    delete typeCounts.planeswalker;
	    delete typeCounts.sorcery;
	    delete typeCounts.instant;
	    delete typeCounts.artifact;
	    delete typeCounts.creature;
	    delete typeCounts.land;

	    let typeNames = Object.keys(typeCounts);
	    console.log("b", typeNames);
	    typeNames = typeNames.sort((a, b) => typeCounts[a] < typeCounts[b] ? 1 : -1);
	    console.log("a", typeNames);
	    groups["typeNames"] = typeNames;
	    return groups;
	  }
	}

	var cardLoader = MtgInterface;

	/* editor.svelte generated by Svelte v3.0.0 */

	const file = "editor.svelte";

	function add_css() {
		var style = element("style");
		style.id = 'svelte-yxz9np-style';
		style.textContent = ".content.svelte-yxz9np{--raisin-black:hsla(200, 8%, 15%, 1);--roman-silver:hsla(196, 15%, 60%, 1);--colorless:hsla(0, 0%, 89%, 1);--black:hsla(83, 8%, 38%, 1);--white:hsl(48, 64%, 89%);--red:hsla(0, 71%, 84%, 1);--green:hsla(114, 60%, 75%, 1);--blue:hsla(235, 55%, 81%, 1)}.content.svelte-yxz9np{display:flex;flex-direction:row;width:100%;height:100%}.help-symbol.svelte-yxz9np{border-radius:50%;border:1px solid black;width:16px;height:16px;text-align:center;position:absolute;right:10px;top:10px;cursor:pointer}.help-symbol.svelte-yxz9np:hover{border-color:blue;color:blue}.toggle-search.svelte-yxz9np{background:blue;width:30px;height:30px;cursor:pointer;position:absolute;left:-30px;top:50%;user-select:none}.hide.svelte-yxz9np .toggle-search.svelte-yxz9np{left:-52px}.statistics.svelte-yxz9np{display:flex;flex-direction:column}.input.svelte-yxz9np{width:100%;height:100%;box-sizing:border-box;padding:10px;resize:none}.controls.svelte-yxz9np{flex-shrink:0;width:300px;height:100%;background:lightgray;display:flex;flex-direction:column}.help.svelte-yxz9np{padding:0px 10px 10px 10px;user-select:none;position:relative}.group-content.svelte-yxz9np{flex-grow:1;display:flex;flex-wrap:wrap;transition:height 500ms ease}.group-content.hidden.svelte-yxz9np{overflow:hidden;height:45px}.all-type-count.svelte-yxz9np{height:125px;overflow:auto;background:lightsteelblue;padding:10px}.type-selector.svelte-yxz9np{cursor:pointer}.type-selector.svelte-yxz9np:not(.highlighted-creature):hover{background:aliceblue}.highlighted-creature.svelte-yxz9np{background:steelblue}.card-search.svelte-yxz9np{height:100%;flex-grow:1;background:white;display:flex;flex-direction:column;position:absolute;right:0;width:33%;z-index:100;box-shadow:0px 0px 10px black}.card-search.hide.svelte-yxz9np{right:-33%}.search-params.svelte-yxz9np{flex-shrink:0;display:flex;flex-direction:column}.search-result.svelte-yxz9np{height:100%;flex-grow:1;background:white;display:flex;flex-direction:row;overflow:auto;position:relative;user-select:none;flex-wrap:wrap}.display.svelte-yxz9np{flex-grow:1;background:gray;display:flex;flex-direction:column;flex-wrap:nowrap;overflow:auto;position:relative;user-select:none}.loading-wrapper.svelte-yxz9np{position:absolute;left:50%;top:0;bottom:0;display:flex;align-items:center}.entry.svelte-yxz9np{position:relative;padding:10px;flex-shrink:0}.shoping.svelte-yxz9np{position:absolute;z-index:10;font-size:3em;text-shadow:0px 0px 6px black;text-align:center;bottom:10%;right:10%;display:none}.entry.svelte-yxz9np:hover .shoping.svelte-yxz9np{display:block}.shoping.svelte-yxz9np .link.svelte-yxz9np{text-decoration:none}.shoping.svelte-yxz9np .link.svelte-yxz9np:hover{color:transparent;text-shadow:0 0 0 blue}.card.svelte-yxz9np{position:absolute;border:6px solid rgb(22, 22, 22);border-radius:10px;outline:0;box-shadow:0px 0px 10px black}.card.banned.svelte-yxz9np{border:6px solid red}.card.highlighted.svelte-yxz9np{border:6px solid yellow}.card.type-highlight.svelte-yxz9np{border:6px solid blueviolet}.card.svelte-yxz9np:hover{border:6px solid blue;cursor:pointer}.card-context-menu.svelte-yxz9np{position:absolute;z-index:100;background:rgba(255, 255, 255, 0.7);height:100%;width:100%;margin-left:-3px;margin-top:-3px;overflow:auto}.card-context-entry.svelte-yxz9np{margin:10px;font-weight:bold;background:white;padding:5px;border-radius:9px;box-shadow:0 0 6px black;cursor:pointer}.card-context-entry.svelte-yxz9np:hover{background:wheat}.price.svelte-yxz9np,.banned-text.svelte-yxz9np,.count.svelte-yxz9np{font-size:34px;text-shadow:0px 0px 9px black;color:red;position:absolute;z-index:100;font-weight:bold;left:34px}.banned-text.svelte-yxz9np{font-size:100%;text-shadow:0px 0px 9px black;color:red;position:absolute;z-index:100;font-weight:bold;left:17%}.count.svelte-yxz9np{top:165px}.price.svelte-yxz9np{bottom:7px;color:wheat;font-size:12px;background:black;left:45%;font-weight:normal}.group-header.svelte-yxz9np{display:flex;background:darkgrey;margin:8px 0;box-shadow:0px 0px 8px black;width:100%;flex-direction:row}.group-header.svelte-yxz9np h2.svelte-yxz9np{padding:0 25px;margin:0px}.group-statistics.svelte-yxz9np{display:flex;flex-direction:row}.mana-proposal.svelte-yxz9np,.mana-devotion.svelte-yxz9np{display:flex;flex-direction:row}.deck-value.svelte-yxz9np,.group-value.svelte-yxz9np{padding:5px;color:black;border-radius:50%;width:15px;height:15px;text-align:center;margin:5px;display:flex;text-align:center;align-items:center;font-size:11px;font-weight:bold}.blue.svelte-yxz9np{background-color:var(--blue)}.black.svelte-yxz9np{color:white;background-color:var(--black)}.red.svelte-yxz9np{background-color:var(--red)}.white.svelte-yxz9np{background-color:var(--white)}.green.svelte-yxz9np{background-color:var(--green)}.colorless.svelte-yxz9np{background-color:var(--colorless)}.sum.svelte-yxz9np{background-color:goldenrod}.color-param.svelte-yxz9np{display:flex;flex-direction:row}.mana-curve.svelte-yxz9np{display:flex;flex-direction:column}.all-curves.svelte-yxz9np{display:flex;flex-grow:1;flex-direction:row;height:80px}.all-labels.svelte-yxz9np{display:flex;flex-shrink:0;flex-direction:row}.curve-element.svelte-yxz9np{width:20px;display:flex;position:absolute;bottom:0;background:gray;align-items:center;height:100%}.curve-label.svelte-yxz9np{width:20px}.curve-wrapper.svelte-yxz9np{width:20px;position:relative;cursor:pointer}.curve-element.svelte-yxz9np:hover{background:lightcoral}.highlighted.svelte-yxz9np .curve-element.svelte-yxz9np{background:lightblue}.curve-label.highlighted.svelte-yxz9np{background:lightblue}.curve-label.svelte-yxz9np:hover{background:lightcoral}h4.svelte-yxz9np{margin-top:5px;margin-bottom:5px}.lds-ripple.svelte-yxz9np{display:inline-block;position:relative;width:80px;height:80px}.lds-ripple.svelte-yxz9np div.svelte-yxz9np{position:absolute;border:4px solid #fff;opacity:1;border-radius:50%;animation:svelte-yxz9np-lds-ripple 1s cubic-bezier(0, 0.2, 0.8, 1) infinite}.card-search.svelte-yxz9np .lds-ripple div.svelte-yxz9np{border:4px solid black}.lds-ripple.svelte-yxz9np div.svelte-yxz9np:nth-child(2){animation-delay:-0.5s}@keyframes svelte-yxz9np-lds-ripple{0%{top:36px;left:36px;width:0;height:0;opacity:1}100%{top:0px;left:0px;width:72px;height:72px;opacity:0}}\n/*# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWRpdG9yLnN2ZWx0ZSIsInNvdXJjZXMiOlsiZWRpdG9yLnN2ZWx0ZSJdLCJzb3VyY2VzQ29udGVudCI6WyI8c2NyaXB0PlxyXG4gIGltcG9ydCB7IG9uTW91bnQgfSBmcm9tIFwic3ZlbHRlXCI7XHJcbiAgLy8gY29uc3QgeyBpcGNSZW5kZXJlciB9ID0gcmVxdWlyZShcImVsZWN0cm9uXCIpO1xyXG5cclxuICBjb25zdCBpcGMgPSByZXF1aXJlKFwiZWxlY3Ryb25cIikuaXBjUmVuZGVyZXI7XHJcbiAgaW1wb3J0IGNsIGZyb20gXCIuL2NhcmQtbG9hZGVyLmpzXCI7XHJcbiAgY29uc3QgQ2FyZExvYWRlciA9IG5ldyBjbChpcGMpO1xyXG4gIC8vIGltcG9ydCBMWlVURjggZnJvbSBcImx6dXRmOFwiO1xyXG4gIC8vaW1wb3J0IENvb2tpZXMgZnJvbSBcImpzLWNvb2tpZVwiO1xyXG5cclxuICBjb25zdCBDb29raWVzID0ge1xyXG4gICAgc2V0OiAoKSA9PiB7fSxcclxuICAgIGdldDogKCkgPT4ge31cclxuICB9O1xyXG5cclxuICBjb25zdCBDQVJEX1JBVElPID0gMC43MTc2NDcwNTg4MjtcclxuICBsZXQgX2hlaWdodCA9IDMwMDtcclxuICBsZXQgX3dpZHRoID0gTWF0aC5mbG9vcihfaGVpZ2h0ICogQ0FSRF9SQVRJTyk7XHJcblxyXG4gIGxldCB1c2VDb29raWVzID0gdHJ1ZTtcclxuXHJcbiAgZnVuY3Rpb24gZW5hYmxlU2F2aW5nKCkge1xyXG4gICAgdXNlQ29va2llcyA9IHRydWU7XHJcbiAgICBDb29raWVzLnNldChcInVzZUNvb2tpZXNcIiwgdHJ1ZSk7XHJcbiAgICBzYXZlQWxsVG9Db29raWVzKCk7XHJcbiAgfVxyXG5cclxuICBjb25zdCBvbGRTZXQgPSBDb29raWVzLnNldDtcclxuICBDb29raWVzLnNldCA9IChhLCBiKSA9PiB7XHJcbiAgICBpZiAodXNlQ29va2llcykgb2xkU2V0KGEsIGIpO1xyXG4gICAgZWxzZSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKFwic2F2aW5nIGRpc2FibGVkXCIpO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGxldCBoZWlnaHQgPSBfaGVpZ2h0O1xyXG4gIGxldCB3aWR0aCA9IF93aWR0aDtcclxuICBsZXQgY2FyZFNlYXJjaEFjdGl2ZSA9IHRydWU7XHJcbiAgbGV0IHN0YXRpc3RpY3NBY3RpdmUgPSB0cnVlO1xyXG4gIGxldCBzY2FsaW5nID0gMTAwO1xyXG5cclxuICBsZXQgZGlzcGxheTtcclxuXHJcbiAgbGV0IGRldm90aW9uSGlnaGxpZ2h0ID0gLTE7XHJcblxyXG4gIGZ1bmN0aW9uIGhpZ2hsaWdodERldm90aW9uKG1hbmEpIHtcclxuICAgIGlmIChkZXZvdGlvbkhpZ2hsaWdodCA9PSBtYW5hKSBkZXZvdGlvbkhpZ2hsaWdodCA9IC0xO1xyXG4gICAgZWxzZSBkZXZvdGlvbkhpZ2hsaWdodCA9IG1hbmEgKyBcIlwiO1xyXG4gIH1cclxuXHJcbiAgJDoge1xyXG4gICAgY29uc3QgcyA9IE1hdGguZmxvb3Ioc2NhbGluZyB8fCAxMDApIC8gMTAwO1xyXG4gICAgaGVpZ2h0ID0gX2hlaWdodCAqIHM7XHJcbiAgICB3aWR0aCA9IF93aWR0aCAqIHM7XHJcbiAgfVxyXG5cclxuICBsZXQgcHJvbWlzZSA9IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gcmVzb2x2ZShbXSkpO1xyXG4gIGxldCBjYXJkU2VhcmNoUHJvbWlzZSA9IG5ldyBQcm9taXNlKHJlc29sdmUgPT5cclxuICAgIHJlc29sdmUoeyBkYXRhOiBbXSwgaGFzX21vcmU6IGZhbHNlLCB0b3RhbF9jYXJkczogMCB9KVxyXG4gICk7XHJcblxyXG4gIGxldCBpbnB1dDtcclxuICBsZXQgZm9ybWF0O1xyXG4gIGxldCBwcm9ncmVzcyA9IDA7XHJcbiAgbGV0IGFsbCA9IDA7XHJcblxyXG4gIGxldCBzcE5hbWU7XHJcbiAgbGV0IHNwVGV4dDtcclxuICBsZXQgc3BUeXBlO1xyXG5cclxuICBsZXQgc3BFREhCbHVlO1xyXG4gIGxldCBzcEVESEJsYWNrO1xyXG4gIGxldCBzcEVESFJlZDtcclxuICBsZXQgc3BFREhXaGl0ZTtcclxuICBsZXQgc3BFREhHcmVlbjtcclxuICBsZXQgc3BFREhDb2xvcmxlc3M7XHJcblxyXG4gIGxldCBkZWNrU2VhY2ggPSBudWxsO1xyXG4gIGxldCBkZWNrU2VhcmNoSW5wdXQ7XHJcblxyXG4gIGZ1bmN0aW9uIGNoYW5nZURlY2tTZWFyY2goZ3JvdXBzKSB7XHJcbiAgICBpZiAoIWdyb3VwcykgcmV0dXJuZGVja1NlYWNoID0gbnVsbDtcclxuICAgIGxldCBzID0gZGVja1NlYXJjaElucHV0LnZhbHVlO1xyXG4gICAgaWYgKCFzKSByZXR1cm4gKGRlY2tTZWFjaCA9IG51bGwpO1xyXG5cclxuICAgIHMgPSBzXHJcbiAgICAgIC50cmltKClcclxuICAgICAgLnJlcGxhY2UoL1xcc1xccysvZ20sIFwiIFwiKVxyXG4gICAgICAudG9Mb3dlckNhc2UoKVxyXG4gICAgICAucmVwbGFjZSgvXFxzL2dtLCBcIigufFxcbikqXCIpO1xyXG4gICAgLyogICAgLnNwbGl0KFwiK1wiKVxyXG4gICAgICAuam9pbihcInxcIik7Ki9cclxuICAgIGNvbnNvbGUubG9nKFwic2VhcmNoOlwiLCBzKTtcclxuICAgIGNvbnN0IHJlc3VsdCA9IFtdO1xyXG4gICAgbGV0IGNvdW50ID0gMDtcclxuICAgIGNvbnN0IHIgPSBuZXcgUmVnRXhwKHMsIFwiZ21cIik7XHJcbiAgICBmb3IgKGxldCBncm91cCBvZiBncm91cHMpIHtcclxuICAgICAgZm9yIChsZXQgY2FyZCBvZiBncm91cC5jYXJkcykge1xyXG4gICAgICAgIGlmICghY2FyZCB8fCAhY2FyZC5kYXRhIHx8ICFjYXJkLmRhdGEub3JhY2xlX3RleHQpIGNvbnRpbnVlO1xyXG4gICAgICAgIGlmICghY2FyZC5kYXRhLm9yYWNsZV90ZXh0LnRvTG93ZXJDYXNlKCkubWF0Y2gocikpIGNvbnRpbnVlO1xyXG4gICAgICAgIGNvdW50ICs9IGNhcmQuY291bnQ7XHJcbiAgICAgICAgcmVzdWx0LnB1c2goY2FyZCk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBkZWNrU2VhY2ggPSBbXHJcbiAgICAgIHtcclxuICAgICAgICBjYXJkczogcmVzdWx0LFxyXG4gICAgICAgIGNvc3Q6IDAsXHJcbiAgICAgICAgY291bnQsXHJcbiAgICAgICAgZGVjazoge30sXHJcbiAgICAgICAgbWFuYToge1xyXG4gICAgICAgICAgYmxhY2s6IDAsXHJcbiAgICAgICAgICBibHVlOiAwLFxyXG4gICAgICAgICAgY29sb3JsZXNzOiAwLFxyXG4gICAgICAgICAgZ2VuZXJpYzogMjQwLFxyXG4gICAgICAgICAgZ3JlZW46IDAsXHJcbiAgICAgICAgICByZWQ6IDAsXHJcbiAgICAgICAgICBzdW06IDI0MCxcclxuICAgICAgICAgIHdoaXRlOiAwXHJcbiAgICAgICAgfSxcclxuICAgICAgICBtYW5hQ3VydmU6IFtdLFxyXG4gICAgICAgIG5hbWU6IFwic2VhcmNoIHJlc3VsdFwiXHJcbiAgICAgIH1cclxuICAgIF07XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIGNsZWFyRm9yQ29sb3JsZXNzKCkge1xyXG4gICAgc3BFREhCbHVlLmNoZWNrZWQgPSBmYWxzZTtcclxuICAgIHNwRURIQmxhY2suY2hlY2tlZCA9IGZhbHNlO1xyXG4gICAgc3BFREhSZWQuY2hlY2tlZCA9IGZhbHNlO1xyXG4gICAgc3BFREhXaGl0ZS5jaGVja2VkID0gZmFsc2U7XHJcbiAgICBzcEVESEdyZWVuLmNoZWNrZWQgPSBmYWxzZTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIGNsZWFyQ29sb3JsZXNzKCkge1xyXG4gICAgc3BFREhDb2xvcmxlc3MuY2hlY2tlZCA9IGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gc2VhcmNoQ2FyZHMobmV4dFVybCkge1xyXG4gICAgaWYgKHR5cGVvZiBuZXh0VXJsID09IFwic3RyaW5nXCIpIHtcclxuICAgICAgY2FyZFNlYXJjaFByb21pc2UgPSBDYXJkTG9hZGVyLnNlYXJjaChuZXh0VXJsKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3QgY29sb3JzID0gbmV3IFNldCgpO1xyXG4gICAgaWYgKHNwRURIQ29sb3JsZXNzLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJDXCIpO1xyXG4gICAgaWYgKHNwRURIQmx1ZS5jaGVja2VkKSBjb2xvcnMuYWRkKFwiVVwiKTtcclxuICAgIGlmIChzcEVESEJsYWNrLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJCXCIpO1xyXG4gICAgaWYgKHNwRURIUmVkLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJSXCIpO1xyXG4gICAgaWYgKHNwRURIV2hpdGUuY2hlY2tlZCkgY29sb3JzLmFkZChcIldcIik7XHJcbiAgICBpZiAoc3BFREhHcmVlbi5jaGVja2VkKSBjb2xvcnMuYWRkKFwiR1wiKTtcclxuXHJcbiAgICBjYXJkU2VhcmNoUHJvbWlzZSA9IENhcmRMb2FkZXIuc2VhcmNoKHtcclxuICAgICAgbmFtZTogc3BOYW1lLnZhbHVlLFxyXG4gICAgICB0ZXh0OiBzcFRleHQudmFsdWUsXHJcbiAgICAgIHR5cGU6IHNwVHlwZS52YWx1ZSxcclxuICAgICAgZWRoY29sb3JzOiBjb2xvcnNcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgbGV0IGN1cnJlbnRDYXJkQ29udGV4dCA9IG51bGw7XHJcbiAgZnVuY3Rpb24gY2FyZENvbnRleHRNZW51KGV2dCwgY2FyZCwgZ3JvdXBzKSB7XHJcbiAgICBldnQucHJldmVudERlZmF1bHQoKTtcclxuICAgIGlmIChldnQud2hpY2ggPT0gMyAmJiBncm91cHMubGVuZ3RoID4gMSkge1xyXG4gICAgICAvLyByaWdodCBjbGlja1xyXG4gICAgICBjdXJyZW50Q2FyZENvbnRleHQgPSBjYXJkO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gY2FyZENvbnRleHRDbGljayhldnQsIGNhcmQsIGdyb3VwKSB7XHJcbiAgICBjdXJyZW50Q2FyZENvbnRleHQgPSBudWxsO1xyXG4gICAgZXZ0LnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgZXZ0LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICBsZXQgZGVjayA9IGlucHV0LnZhbHVlO1xyXG5cclxuICAgIGNvbnN0IHIgPSBuZXcgUmVnRXhwKGBeLioke2NhcmQubmFtZX0uKiRgLCBcImdtaVwiKTtcclxuICAgIGRlY2sgPSBkZWNrLnJlcGxhY2UociwgXCJcIik7XHJcbiAgICBsZXQgaW5kZXggPSBkZWNrLmluZGV4T2YoZ3JvdXAubmFtZSk7XHJcbiAgICBpZiAoaW5kZXggPCAwKSByZXR1cm47XHJcbiAgICBpbmRleCArPSBncm91cC5uYW1lLmxlbmd0aDtcclxuXHJcbiAgICBjb25zdCBpbnNlcnQgPSBcIlxcblwiICsgY2FyZC5jb3VudCArIFwiIFwiICsgY2FyZC5uYW1lO1xyXG4gICAgZGVjayA9IGRlY2suc2xpY2UoMCwgaW5kZXgpICsgaW5zZXJ0ICsgZGVjay5zbGljZShpbmRleCk7XHJcbiAgICBpbnB1dC52YWx1ZSA9IGRlY2s7XHJcbiAgICByZWxvYWQoKTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIG9uTWFpbk1vdXNlRG93bihldnQpIHtcclxuICAgIGN1cnJlbnRDYXJkQ29udGV4dCA9IG51bGw7XHJcbiAgfVxyXG5cclxuICBsZXQgaGlkZGVuR3JvdXBzID0gbmV3IFNldCgpO1xyXG5cclxuICBmdW5jdGlvbiB0b2dnbGVHcm91cFZpc2liaWxpdHkoZ3JvdXApIHtcclxuICAgIGlmIChoaWRkZW5Hcm91cHMuaGFzKGdyb3VwLm5hbWUpKSBoaWRkZW5Hcm91cHMuZGVsZXRlKGdyb3VwLm5hbWUpO1xyXG4gICAgZWxzZSBoaWRkZW5Hcm91cHMuYWRkKGdyb3VwLm5hbWUpO1xyXG5cclxuICAgIGhpZGRlbkdyb3VwcyA9IGhpZGRlbkdyb3VwcztcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHNwKHAsIGEpIHtcclxuICAgIHByb2dyZXNzID0gcDtcclxuICAgIGFsbCA9IGE7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiByZXNldERlY2tTZWFyY2goKSB7XHJcbiAgICBkZWNrU2VhY2ggPSBudWxsO1xyXG4gICAgaWYgKCFkZWNrU2VhcmNoSW5wdXQpIHJldHVybjtcclxuICAgIGRlY2tTZWFyY2hJbnB1dC52YWx1ZSA9IFwiXCI7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBzb3J0RGVja1N0cmluZygpIHtcclxuICAgIHByb21pc2UgPSBDYXJkTG9hZGVyLnNvcnQoaW5wdXQudmFsdWUgfHwgXCJcIiwgKHAsIGEpID0+IHtcclxuICAgICAgcmVzZXREZWNrU2VhcmNoKCk7XHJcbiAgICAgIHNwKHAsIGEpO1xyXG4gICAgfSlcclxuICAgICAgLmNhdGNoKGUgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZSk7XHJcbiAgICAgICAgdGhyb3cgZTtcclxuICAgICAgfSlcclxuICAgICAgLnRoZW4ocmVzID0+IHtcclxuICAgICAgICBpbnB1dC52YWx1ZSA9IHJlcztcclxuICAgICAgICByZXR1cm4gdXBkYXRlKHsga2V5Q29kZTogMjcgfSwgdHJ1ZSk7XHJcbiAgICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgbGV0IGRlY2tOYW1lSW5wdXQ7XHJcbiAgZnVuY3Rpb24gc2F2ZURlY2soKSB7XHJcbiAgICBpZiAoIWRlY2tOYW1lSW5wdXQpIHJldHVybiBhbGVydChcInBscyBpbnB1dCBhIG5hbWVcIik7XHJcblxyXG4gICAgLy8gY29uc3QgZmlsZW5hbWUgPSAoZGVja05hbWVJbnB1dC52YWx1ZSB8fCBcInVua25vd24gZGVja1wiKSArIFwiLnR4dFwiO1xyXG5cclxuICAgIGlwYy5zZW5kKFwic2F2ZURlY2tcIiwgeyBkZWNrOiBpbnB1dC52YWx1ZSwgbmFtZTogZGVja05hbWVJbnB1dC52YWx1ZSB9KTtcclxuXHJcbiAgICAvKiAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtkZWNrXSwgeyB0eXBlOiBcInRleHQvcGxhaW47Y2hhcnNldD11dGYtOFwiIH0pO1xyXG4gICAgaWYgKHdpbmRvdy5uYXZpZ2F0b3IubXNTYXZlT3JPcGVuQmxvYilcclxuICAgICAgLy8gSUUxMCtcclxuICAgICAgd2luZG93Lm5hdmlnYXRvci5tc1NhdmVPck9wZW5CbG9iKGJsb2IsIGZpbGVuYW1lKTtcclxuICAgIGVsc2Uge1xyXG4gICAgICAvLyBPdGhlcnNcclxuICAgICAgdmFyIGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiYVwiKSxcclxuICAgICAgICB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgICBhLmhyZWYgPSB1cmw7XHJcbiAgICAgIGEuZG93bmxvYWQgPSBmaWxlbmFtZTtcclxuICAgICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcclxuICAgICAgYS5jbGljaygpO1xyXG4gICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XHJcbiAgICAgICAgd2luZG93LlVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcclxuICAgICAgfSwgMCk7XHJcbiAgICB9Ki9cclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIG9uRGVja05hbWVUeXBlKCkge1xyXG4gICAgQ29va2llcy5zZXQoXCJkZWNrTmFtZVwiLCBkZWNrTmFtZUlucHV0LnZhbHVlKTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIG1haW5LZXlEb3duKGV2dCkge1xyXG4gICAgaWYgKGV2dC5jdHJsS2V5IHx8IGV2dC5tZXRhS2V5KSB7XHJcbiAgICAgIHN3aXRjaCAoZXZ0LndoaWNoKSB7XHJcbiAgICAgICAgY2FzZSA4MzogLy8gc1xyXG4gICAgICAgICAgZXZ0LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgICBldnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICBzYXZlRGVjaygpO1xyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIG1haW5LZXlVcChldnQpIHtcclxuICAgIHVwZGF0ZShldnQpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgZnVuY3Rpb24gdXBkYXRlKGV2dCkge1xyXG4gICAgaWYgKGV2dC5rZXlDb2RlICE9PSAyNykgcmV0dXJuO1xyXG5cclxuICAgIGxldCBzY3JvbGxQb3NpdGlvbiA9IDA7XHJcbiAgICBpZiAoZGlzcGxheSkge1xyXG4gICAgICBzY3JvbGxQb3NpdGlvbiA9IGRpc3BsYXkuc2Nyb2xsVG9wO1xyXG4gICAgfVxyXG5cclxuICAgIHByb21pc2UgPSBDYXJkTG9hZGVyLmNyZWF0ZURlY2soaW5wdXQudmFsdWUgfHwgXCJcIiwgKHAsIGEpID0+IHtcclxuICAgICAgcmVzZXREZWNrU2VhcmNoKCk7XHJcbiAgICAgIHNwKHAsIGEpO1xyXG4gICAgfSlcclxuICAgICAgLmNhdGNoKGUgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZSk7XHJcbiAgICAgICAgdGhyb3cgZTtcclxuICAgICAgfSlcclxuICAgICAgLnRoZW4ocmVzID0+IHtcclxuICAgICAgICBpbnB1dC52YWx1ZSA9IHJlcy5jb3JyZWN0ZWQ7XHJcbiAgICAgICAgQ29va2llcy5zZXQoXCJkZWNrXCIsIGlucHV0LnZhbHVlKTtcclxuICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgIGRpc3BsYXkuc2Nyb2xsVG9wID0gc2Nyb2xsUG9zaXRpb247XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgcmV0dXJuIHJlcztcclxuICAgICAgfSk7XHJcblxyXG4gICAgcmV0dXJuIHByb21pc2U7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIHJlbG9hZCgpIHtcclxuICAgIHJlc2V0RGVja1NlYXJjaCgpO1xyXG4gICAgdXBkYXRlKHsga2V5Q29kZTogMjcgfSk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBhcHBlbmRDYXJkKG5hbWUpIHtcclxuICAgIGlmICghbmFtZSkgcmV0dXJuO1xyXG4gICAgcmVzZXREZWNrU2VhcmNoKCk7XHJcbiAgICBpbnB1dC52YWx1ZSA9IGlucHV0LnZhbHVlICsgXCJcXG4xIFwiICsgbmFtZTtcclxuICAgIHJlbG9hZCgpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gcmVtb3ZlKGNhcmQpIHtcclxuICAgIGNvbnN0IHIgPSBuZXcgUmVnRXhwKGBeLioke2NhcmQubmFtZX0uKiRgLCBcImdtXCIpO1xyXG5cclxuICAgIGlucHV0LnZhbHVlID0gaW5wdXQudmFsdWUucmVwbGFjZShyLCBcIi8vIFwiICsgY2FyZC5jb3VudCArIFwiIFwiICsgY2FyZC5uYW1lKTtcclxuICAgIHByb21pc2UgPSBDYXJkTG9hZGVyLmNyZWF0ZURlY2soaW5wdXQudmFsdWUgfHwgXCJcIiwgKHAsIGEpID0+XHJcbiAgICAgIHNwKHAsIGEpXHJcbiAgICApLmNhdGNoKGUgPT4ge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGUpO1xyXG4gICAgICB0aHJvdyBlO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBjb3B5RGVjaygpIHtcclxuICAgIGNvbnN0IGRlY2sgPSBpbnB1dC52YWx1ZTtcclxuXHJcbiAgICBpbnB1dC52YWx1ZSA9IGlucHV0LnZhbHVlLnJlcGxhY2UoLyMuKnxcXC9cXC8uKi9nbSwgXCJcXG5cIik7XHJcblxyXG4gICAgaW5wdXQuc2VsZWN0KCk7XHJcblxyXG4gICAgaW5wdXQuc2V0U2VsZWN0aW9uUmFuZ2UoMCwgOTk5OTkpO1xyXG4gICAgZG9jdW1lbnQuZXhlY0NvbW1hbmQoXCJjb3B5XCIpO1xyXG5cclxuICAgIGlucHV0LnZhbHVlID0gZGVjaztcclxuXHJcbiAgICBhbGVydChcIkRlY2sgY29waWVkIHRvIGNsaXBib2FyZFwiKTtcclxuICB9XHJcblxyXG4gIGxldCBoZWxwQWN0aXZlID0gZmFsc2U7XHJcbiAgb25Nb3VudChhc3luYyAoKSA9PiB7XHJcbiAgICBjb25zdCBkZWZhdWx0RGVjayA9IGAjbGFuZHNcclxubW91bnRhaW5cclxuMiBwbGFpbnNcclxuMyBzd2FtcHNcclxuIyBtYWluIGRlY2tcclxuMjAgYmxpZ2h0c3RlZWwgY29sb3NzdXNgO1xyXG5cclxuICAgIHVzZUNvb2tpZXMgPSBDb29raWVzLmdldChcInVzZUNvb2tpZXNcIik7XHJcblxyXG4gICAgY29uc3QgdXJsUGFyYW1zID0gbmV3IFVSTFNlYXJjaFBhcmFtcyh3aW5kb3cubG9jYXRpb24uc2VhcmNoKTtcclxuICAgIGNvbnN0IHNoYXJlZERlY2sgPSB1cmxQYXJhbXMuZ2V0KFwiZFwiKTtcclxuXHJcbiAgICBsZXQgc3RhcnQgPSB1c2VDb29raWVzID8gQ29va2llcy5nZXQoXCJkZWNrXCIpIHx8IGRlZmF1bHREZWNrIDogZGVmYXVsdERlY2s7XHJcblxyXG4gICAgaWYgKHNoYXJlZERlY2spIHtcclxuICAgICAgdXNlQ29va2llcyA9IGZhbHNlO1xyXG4gICAgICAvKiBjb25zdCBidWZmZXIgPSBuZXcgVWludDhBcnJheShzaGFyZWREZWNrLnNwbGl0KFwiLFwiKSk7XHJcbiAgICAqIGNvbnN0IGRlY29tcHJlc3NlZCA9IExaVVRGOC5kZWNvbXByZXNzKGJ1ZmZlcik7XHJcbiAgICAgIGlmIChkZWNvbXByZXNzZWQpIHtcclxuICAgICAgICBzdGFydCA9IGRlY29tcHJlc3NlZDtcclxuICAgICAgfSovXHJcbiAgICB9XHJcblxyXG4gICAgdXJsUGFyYW1zLmRlbGV0ZShcImRcIik7XHJcbiAgICB3aW5kb3cuaGlzdG9yeS5yZXBsYWNlU3RhdGUoe30sIFwiXCIsIGAke3dpbmRvdy5sb2NhdGlvbi5wYXRobmFtZX1gKTtcclxuXHJcbiAgICAvLyAgICB3aW5kb3cuaGlzdG9yeS5yZXBsYWNlU3RhdGUoXHJcbiAgICAvLyAgIHt9LFxyXG4gICAgLy8gICAnJyxcclxuICAgIC8vICAgYCR7d2luZG93LmxvY2F0aW9uLnBhdGhuYW1lfT8ke3BhcmFtc30ke3dpbmRvdy5sb2NhdGlvbi5oYXNofWAsXHJcbiAgICAvLyApXHJcblxyXG4gICAgLy8gIGhlbHBBY3RpdmUgPSBDb29raWVzLmdldChcImhlbHBBY3RpdmVcIikgPT0gXCJ0cnVlXCI7XHJcbiAgICAvLyBjb25zb2xlLmxvZyhcImhlbHA6XCIsIENvb2tpZXMuZ2V0KFwiaGVscEFjdGl2ZVwiKSk7XHJcbiAgICBjYXJkU2VhcmNoQWN0aXZlID0gQ29va2llcy5nZXQoXCJjYXJkU2VhcmNoQWN0aXZlXCIpID09IFwidHJ1ZVwiO1xyXG4gICAgY29uc29sZS5sb2coXCJzZWFyY2g6XCIsIENvb2tpZXMuZ2V0KFwiY2FyZFNlYXJjaEFjdGl2ZVwiKSk7XHJcbiAgICBzdGF0aXN0aWNzQWN0aXZlID0gQ29va2llcy5nZXQoXCJzdGF0aXN0aWNzQWN0aXZlXCIpID09IFwidHJ1ZVwiO1xyXG4gICAgY29uc29sZS5sb2coXCJzdGF0aXN0aWNzOlwiLCBDb29raWVzLmdldChcInN0YXRpc3RpY3NBY3RpdmVcIikpO1xyXG5cclxuICAgIHN0YXRpc3RpY3NBY3RpdmU7XHJcbiAgICBpbnB1dC52YWx1ZSA9IHN0YXJ0O1xyXG4gICAgcmVsb2FkKCk7XHJcblxyXG4gICAgaXBjLm9uKFwibG9hZERlY2tcIiwgKHNlbmRlciwgZGF0YSkgPT4ge1xyXG4gICAgICBjb25zb2xlLmxvZyhcIkxPQURJTkcgREVDS1wiLCBkYXRhLm5hbWUpO1xyXG4gICAgICBpbnB1dC52YWx1ZSA9IGRhdGEuZGVjaztcclxuICAgICAgZGVja05hbWVJbnB1dC52YWx1ZSA9IChkYXRhLm5hbWUgfHwgXCJcIikucmVwbGFjZShcIi5nZGVja1wiLCBcIlwiKTtcclxuICAgICAgcmVsb2FkKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvKiBjb25zb2xlLmxvZyhcIlNUU0ZTREZcIiwgQ29va2llcy5nZXQoXCJkZWNrXCIpKSxcclxuICAgICAgKHByb21pc2UgPSBDYXJkTG9hZGVyLmNyZWF0ZURlY2soc3RhcnQsIChwLCBhKSA9PiBzcChwLCBhKSkpOyovXHJcbiAgfSk7XHJcblxyXG4gIGZ1bmN0aW9uIHNhdmVBbGxUb0Nvb2tpZXMoKSB7XHJcbiAgICBDb29raWVzLnNldChcImNhcmRTZWFyY2hBY3RpdmVcIiwgY2FyZFNlYXJjaEFjdGl2ZSk7XHJcbiAgICBDb29raWVzLnNldChcInN0YXRpc3RpY3NBY3RpdmVcIiwgc3RhdGlzdGljc0FjdGl2ZSk7XHJcbiAgICBDb29raWVzLnNldChcImRlY2tcIiwgaW5wdXQudmFsdWUpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gc2hhcmVEZWNrKCkge1xyXG4gICAgLyogICBpZiAoIWlucHV0IHx8ICFpbnB1dC52YWx1ZSkge1xyXG4gICAgICBhbGVydChcIlRoZSBkZWNrIGlzIGVtcHR5LCBub3RoaW5nIGNvcGllZFwiKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3QgY29tcHJlc3NlZCA9IExaVVRGOC5jb21wcmVzcyhpbnB1dC52YWx1ZSB8fCBcImVtcHR5IGRlY2sgc2hhcmVkXCIpO1xyXG4gICAgLy93aW5kb3cuaGlzdG9yeS5wdXNoU3RhdGUoXCJwYWdlMlwiLCBcIlRpdGxlXCIsIFwiP2Q9XCIgKyBjb21wcmVzc2VkKTtcclxuICAgIGNvbnNvbGUubG9nKGAke3dpbmRvdy5sb2NhdGlvbi5wYXRobmFtZX0/ZD0ke2NvbXByZXNzZWR9YCk7XHJcblxyXG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwidGV4dGFyZWFcIik7XHJcbiAgICBlbC52YWx1ZSA9IGAke3dpbmRvdy5sb2NhdGlvbi5ocmVmfT9kPSR7Y29tcHJlc3NlZH1gO1xyXG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChlbCk7XHJcbiAgICBlbC5zZWxlY3QoKTtcclxuICAgIGRvY3VtZW50LmV4ZWNDb21tYW5kKFwiY29weVwiKTtcclxuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoZWwpO1xyXG4gICAgYWxlcnQoXCJsaW5rIHRvIGRlY2sgY29waWVkXCIpOyovXHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBvblR5cGluZygpIHtcclxuICAgIENvb2tpZXMuc2V0KFwiZGVja1wiLCBpbnB1dC52YWx1ZSwgeyBleHBpcmVzOiA3IH0pO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gZ2V0SGVpZ2h0KG1hbmEsIGdyb3Vwcykge1xyXG4gICAgcmV0dXJuIDEwMCAqIChtYW5hIC8gTWF0aC5tYXgoLi4uZ3JvdXBzW1wibWFuYUN1cnZlXCJdKSk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBvcGVuSGVscCgpIHtcclxuICAgIGhlbHBBY3RpdmUgPSAhaGVscEFjdGl2ZTtcclxuICAgIC8vICBDb29raWVzLnNldChcImhlbHBBY3RpdmVcIiwgaGVscEFjdGl2ZSArIFwiXCIpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gdG9nZ2xlU2VhcmNoKCkge1xyXG4gICAgY2FyZFNlYXJjaEFjdGl2ZSA9ICFjYXJkU2VhcmNoQWN0aXZlO1xyXG4gICAgQ29va2llcy5zZXQoXCJjYXJkU2VhcmNoQWN0aXZlXCIsIGNhcmRTZWFyY2hBY3RpdmUgKyBcIlwiKTtcclxuICB9XHJcbiAgZnVuY3Rpb24gdG9nZ2xlU3RhdGlzdGljcygpIHtcclxuICAgIHN0YXRpc3RpY3NBY3RpdmUgPSAhc3RhdGlzdGljc0FjdGl2ZTtcclxuICAgIENvb2tpZXMuc2V0KFwic3RhdGlzdGljc0FjdGl2ZVwiLCBzdGF0aXN0aWNzQWN0aXZlICsgXCJcIik7XHJcbiAgfVxyXG5cclxuICBsZXQgaGlnaGxpZ2h0ZWRDcmVhdHVyZSA9IFwiXCI7XHJcbiAgZnVuY3Rpb24gaGlnaGxpZ2h0Q3JlYXR1cmUodHlwZU5hbWUpIHtcclxuICAgIGlmICh0eXBlTmFtZSA9PSBoaWdobGlnaHRlZENyZWF0dXJlKSB7XHJcbiAgICAgIGhpZ2hsaWdodGVkQ3JlYXR1cmUgPSBcIlwiO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBoaWdobGlnaHRlZENyZWF0dXJlID0gdHlwZU5hbWU7XHJcbiAgICB9XHJcbiAgfVxyXG48L3NjcmlwdD5cclxuXHJcbjxzdHlsZT5cclxuICAuY29udGVudCB7XHJcbiAgICAtLXJhaXNpbi1ibGFjazogaHNsYSgyMDAsIDglLCAxNSUsIDEpO1xyXG4gICAgLS1yb21hbi1zaWx2ZXI6IGhzbGEoMTk2LCAxNSUsIDYwJSwgMSk7XHJcbiAgICAtLWNvbG9ybGVzczogaHNsYSgwLCAwJSwgODklLCAxKTtcclxuICAgIC0tYmxhY2s6IGhzbGEoODMsIDglLCAzOCUsIDEpO1xyXG4gICAgLS13aGl0ZTogaHNsKDQ4LCA2NCUsIDg5JSk7XHJcbiAgICAtLXJlZDogaHNsYSgwLCA3MSUsIDg0JSwgMSk7XHJcbiAgICAtLWdyZWVuOiBoc2xhKDExNCwgNjAlLCA3NSUsIDEpO1xyXG4gICAgLS1ibHVlOiBoc2xhKDIzNSwgNTUlLCA4MSUsIDEpO1xyXG4gIH1cclxuXHJcbiAgLmNvbnRlbnQge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgICB3aWR0aDogMTAwJTtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICB9XHJcblxyXG4gIC5oZWxwLXN5bWJvbCB7XHJcbiAgICBib3JkZXItcmFkaXVzOiA1MCU7XHJcbiAgICBib3JkZXI6IDFweCBzb2xpZCBibGFjaztcclxuICAgIHdpZHRoOiAxNnB4O1xyXG4gICAgaGVpZ2h0OiAxNnB4O1xyXG4gICAgdGV4dC1hbGlnbjogY2VudGVyO1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgcmlnaHQ6IDEwcHg7XHJcbiAgICB0b3A6IDEwcHg7XHJcbiAgICBjdXJzb3I6IHBvaW50ZXI7XHJcbiAgfVxyXG5cclxuICAuaGVscC1zeW1ib2w6aG92ZXIge1xyXG4gICAgYm9yZGVyLWNvbG9yOiBibHVlO1xyXG4gICAgY29sb3I6IGJsdWU7XHJcbiAgfVxyXG5cclxuICAudG9nZ2xlLXNlYXJjaCB7XHJcbiAgICBiYWNrZ3JvdW5kOiBibHVlO1xyXG4gICAgd2lkdGg6IDMwcHg7XHJcbiAgICBoZWlnaHQ6IDMwcHg7XHJcbiAgICBjdXJzb3I6IHBvaW50ZXI7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICBsZWZ0OiAtMzBweDtcclxuICAgIHRvcDogNTAlO1xyXG4gICAgdXNlci1zZWxlY3Q6IG5vbmU7XHJcbiAgfVxyXG5cclxuICAuaGlkZSAudG9nZ2xlLXNlYXJjaCB7XHJcbiAgICBsZWZ0OiAtNTJweDtcclxuICB9XHJcblxyXG4gIC5zdGF0aXN0aWNzIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gIH1cclxuICAuaW5wdXQge1xyXG4gICAgd2lkdGg6IDEwMCU7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgICBib3gtc2l6aW5nOiBib3JkZXItYm94O1xyXG4gICAgcGFkZGluZzogMTBweDtcclxuICAgIHJlc2l6ZTogbm9uZTtcclxuICB9XHJcblxyXG4gIC5jb250cm9scyB7XHJcbiAgICBmbGV4LXNocmluazogMDtcclxuICAgIHdpZHRoOiAzMDBweDtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICAgIGJhY2tncm91bmQ6IGxpZ2h0Z3JheTtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gIH1cclxuXHJcbiAgLmhlbHAge1xyXG4gICAgcGFkZGluZzogMHB4IDEwcHggMTBweCAxMHB4O1xyXG4gICAgdXNlci1zZWxlY3Q6IG5vbmU7XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgfVxyXG5cclxuICAuZ3JvdXAtY29udGVudCB7XHJcbiAgICBmbGV4LWdyb3c6IDE7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC13cmFwOiB3cmFwO1xyXG4gICAgdHJhbnNpdGlvbjogaGVpZ2h0IDUwMG1zIGVhc2U7XHJcbiAgfVxyXG5cclxuICAuZ3JvdXAtY29udGVudC5oaWRkZW4ge1xyXG4gICAgb3ZlcmZsb3c6IGhpZGRlbjtcclxuICAgIGhlaWdodDogNDVweDtcclxuICB9XHJcblxyXG4gIC5hbGwtdHlwZS1jb3VudCB7XHJcbiAgICBoZWlnaHQ6IDEyNXB4O1xyXG4gICAgb3ZlcmZsb3c6IGF1dG87XHJcbiAgICBiYWNrZ3JvdW5kOiBsaWdodHN0ZWVsYmx1ZTtcclxuICAgIHBhZGRpbmc6IDEwcHg7XHJcbiAgfVxyXG5cclxuICAudHlwZS1zZWxlY3RvciB7XHJcbiAgICBjdXJzb3I6IHBvaW50ZXI7XHJcbiAgfVxyXG5cclxuICAudHlwZS1zZWxlY3Rvcjpub3QoLmhpZ2hsaWdodGVkLWNyZWF0dXJlKTpob3ZlciB7XHJcbiAgICBiYWNrZ3JvdW5kOiBhbGljZWJsdWU7XHJcbiAgfVxyXG5cclxuICAuaGlnaGxpZ2h0ZWQtY3JlYXR1cmUge1xyXG4gICAgYmFja2dyb3VuZDogc3RlZWxibHVlO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQtc2VhcmNoIHtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICAgIGZsZXgtZ3JvdzogMTtcclxuICAgIGJhY2tncm91bmQ6IHdoaXRlO1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICByaWdodDogMDtcclxuICAgIHdpZHRoOiAzMyU7XHJcbiAgICB6LWluZGV4OiAxMDA7XHJcbiAgICBib3gtc2hhZG93OiAwcHggMHB4IDEwcHggYmxhY2s7XHJcbiAgfVxyXG5cclxuICAuY2FyZC1zZWFyY2guaGlkZSB7XHJcbiAgICByaWdodDogLTMzJTtcclxuICB9XHJcblxyXG4gIC5zZWFyY2gtcGFyYW1zIHtcclxuICAgIGZsZXgtc2hyaW5rOiAwO1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XHJcbiAgfVxyXG5cclxuICAuc2VhcmNoLXJlc3VsdCB7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgICBmbGV4LWdyb3c6IDE7XHJcbiAgICBiYWNrZ3JvdW5kOiB3aGl0ZTtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gICAgb3ZlcmZsb3c6IGF1dG87XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgICB1c2VyLXNlbGVjdDogbm9uZTtcclxuICAgIGZsZXgtd3JhcDogd3JhcDtcclxuICB9XHJcblxyXG4gIC5kaXNwbGF5IHtcclxuICAgIGZsZXgtZ3JvdzogMTtcclxuICAgIGJhY2tncm91bmQ6IGdyYXk7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcclxuICAgIGZsZXgtd3JhcDogbm93cmFwO1xyXG4gICAgb3ZlcmZsb3c6IGF1dG87XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgICB1c2VyLXNlbGVjdDogbm9uZTtcclxuICB9XHJcblxyXG4gIC5sb2FkaW5nLXdyYXBwZXIge1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgbGVmdDogNTAlO1xyXG4gICAgdG9wOiAwO1xyXG4gICAgYm90dG9tOiAwO1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7XHJcbiAgfVxyXG5cclxuICAuZW50cnkge1xyXG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xyXG4gICAgcGFkZGluZzogMTBweDtcclxuICAgIGZsZXgtc2hyaW5rOiAwO1xyXG4gIH1cclxuXHJcbiAgLnNob3Bpbmcge1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgei1pbmRleDogMTA7XHJcbiAgICBmb250LXNpemU6IDNlbTtcclxuICAgIHRleHQtc2hhZG93OiAwcHggMHB4IDZweCBibGFjaztcclxuICAgIHRleHQtYWxpZ246IGNlbnRlcjtcclxuICAgIGJvdHRvbTogMTAlO1xyXG4gICAgcmlnaHQ6IDEwJTtcclxuICAgIGRpc3BsYXk6IG5vbmU7XHJcbiAgfVxyXG5cclxuICAuZW50cnk6aG92ZXIgLnNob3Bpbmcge1xyXG4gICAgZGlzcGxheTogYmxvY2s7XHJcbiAgfVxyXG5cclxuICAuc2hvcGluZyAubGluayB7XHJcbiAgICB0ZXh0LWRlY29yYXRpb246IG5vbmU7XHJcbiAgfVxyXG5cclxuICAuc2hvcGluZyAubGluazpob3ZlciB7XHJcbiAgICBjb2xvcjogdHJhbnNwYXJlbnQ7XHJcbiAgICB0ZXh0LXNoYWRvdzogMCAwIDAgYmx1ZTtcclxuICB9XHJcblxyXG4gIC5jYXJkIHtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIGJvcmRlcjogNnB4IHNvbGlkIHJnYigyMiwgMjIsIDIyKTtcclxuICAgIGJvcmRlci1yYWRpdXM6IDEwcHg7XHJcbiAgICBvdXRsaW5lOiAwO1xyXG4gICAgYm94LXNoYWRvdzogMHB4IDBweCAxMHB4IGJsYWNrO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQuYmFubmVkIHtcclxuICAgIGJvcmRlcjogNnB4IHNvbGlkIHJlZDtcclxuICB9XHJcblxyXG4gIC5jYXJkLmhpZ2hsaWdodGVkIHtcclxuICAgIGJvcmRlcjogNnB4IHNvbGlkIHllbGxvdztcclxuICB9XHJcblxyXG4gIC5jYXJkLnR5cGUtaGlnaGxpZ2h0IHtcclxuICAgIGJvcmRlcjogNnB4IHNvbGlkIGJsdWV2aW9sZXQ7XHJcbiAgfVxyXG5cclxuICAuY2FyZDpob3ZlciB7XHJcbiAgICBib3JkZXI6IDZweCBzb2xpZCBibHVlO1xyXG4gICAgY3Vyc29yOiBwb2ludGVyO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQtY29udGV4dC1tZW51IHtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIHotaW5kZXg6IDEwMDtcclxuICAgIGJhY2tncm91bmQ6IHJnYmEoMjU1LCAyNTUsIDI1NSwgMC43KTtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICAgIHdpZHRoOiAxMDAlO1xyXG4gICAgLyogcGFkZGluZzogMTBweDsgKi9cclxuICAgIC8qIG1hcmdpbjogMTBweDsgKi9cclxuICAgIG1hcmdpbi1sZWZ0OiAtM3B4O1xyXG4gICAgbWFyZ2luLXRvcDogLTNweDtcclxuICAgIG92ZXJmbG93OiBhdXRvO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQtY29udGV4dC1lbnRyeSB7XHJcbiAgICBtYXJnaW46IDEwcHg7XHJcbiAgICBmb250LXdlaWdodDogYm9sZDtcclxuICAgIGJhY2tncm91bmQ6IHdoaXRlO1xyXG4gICAgcGFkZGluZzogNXB4O1xyXG4gICAgYm9yZGVyLXJhZGl1czogOXB4O1xyXG4gICAgYm94LXNoYWRvdzogMCAwIDZweCBibGFjaztcclxuICAgIGN1cnNvcjogcG9pbnRlcjtcclxuICB9XHJcblxyXG4gIC5jYXJkLWNvbnRleHQtZW50cnk6aG92ZXIge1xyXG4gICAgYmFja2dyb3VuZDogd2hlYXQ7XHJcbiAgfVxyXG5cclxuICAucHJpY2UsXHJcbiAgLmJhbm5lZC10ZXh0LFxyXG4gIC5jb3VudCB7XHJcbiAgICBmb250LXNpemU6IDM0cHg7XHJcbiAgICB0ZXh0LXNoYWRvdzogMHB4IDBweCA5cHggYmxhY2s7XHJcbiAgICBjb2xvcjogcmVkO1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgei1pbmRleDogMTAwO1xyXG4gICAgZm9udC13ZWlnaHQ6IGJvbGQ7XHJcbiAgICBsZWZ0OiAzNHB4O1xyXG4gIH1cclxuXHJcbiAgLmJhbm5lZC10ZXh0IHtcclxuICAgIGZvbnQtc2l6ZTogMTAwJTtcclxuICAgIHRleHQtc2hhZG93OiAwcHggMHB4IDlweCBibGFjaztcclxuICAgIGNvbG9yOiByZWQ7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICB6LWluZGV4OiAxMDA7XHJcbiAgICBmb250LXdlaWdodDogYm9sZDtcclxuICAgIGxlZnQ6IDE3JTtcclxuICB9XHJcbiAgLmNvdW50IHtcclxuICAgIHRvcDogMTY1cHg7XHJcbiAgfVxyXG5cclxuICAucHJpY2Uge1xyXG4gICAgYm90dG9tOiA3cHg7XHJcbiAgICBjb2xvcjogd2hlYXQ7XHJcbiAgICBmb250LXNpemU6IDEycHg7XHJcbiAgICBiYWNrZ3JvdW5kOiBibGFjaztcclxuICAgIGxlZnQ6IDQ1JTtcclxuICAgIGZvbnQtd2VpZ2h0OiBub3JtYWw7XHJcbiAgfVxyXG5cclxuICAuZ3JvdXAtaGVhZGVyIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBiYWNrZ3JvdW5kOiBkYXJrZ3JleTtcclxuICAgIC8qIHBhZGRpbmc6IDhweDsgKi9cclxuICAgIG1hcmdpbjogOHB4IDA7XHJcbiAgICBib3gtc2hhZG93OiAwcHggMHB4IDhweCBibGFjaztcclxuICAgIHdpZHRoOiAxMDAlO1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICB9XHJcblxyXG4gIC5ncm91cC1oZWFkZXIgaDIge1xyXG4gICAgcGFkZGluZzogMCAyNXB4O1xyXG4gICAgbWFyZ2luOiAwcHg7XHJcbiAgfVxyXG5cclxuICAuZ3JvdXAtc3RhdGlzdGljcyB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICB9XHJcblxyXG4gIC5tYW5hLXByb3Bvc2FsLFxyXG4gIC5tYW5hLWRldm90aW9uIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gIH1cclxuXHJcbiAgLmRlY2stdmFsdWUsXHJcbiAgLmdyb3VwLXZhbHVlIHtcclxuICAgIHBhZGRpbmc6IDVweDtcclxuICAgIGNvbG9yOiBibGFjaztcclxuICAgIGJvcmRlci1yYWRpdXM6IDUwJTtcclxuICAgIHdpZHRoOiAxNXB4O1xyXG4gICAgaGVpZ2h0OiAxNXB4O1xyXG4gICAgdGV4dC1hbGlnbjogY2VudGVyO1xyXG4gICAgbWFyZ2luOiA1cHg7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgdGV4dC1hbGlnbjogY2VudGVyO1xyXG4gICAgYWxpZ24taXRlbXM6IGNlbnRlcjtcclxuICAgIGZvbnQtc2l6ZTogMTFweDtcclxuICAgIGZvbnQtd2VpZ2h0OiBib2xkO1xyXG4gIH1cclxuICAuYmx1ZSB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS1ibHVlKTtcclxuICB9XHJcbiAgLmJsYWNrIHtcclxuICAgIGNvbG9yOiB3aGl0ZTtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWJsYWNrKTtcclxuICB9XHJcbiAgLnJlZCB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS1yZWQpO1xyXG4gIH1cclxuICAud2hpdGUge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0td2hpdGUpO1xyXG4gIH1cclxuICAuZ3JlZW4ge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0tZ3JlZW4pO1xyXG4gIH1cclxuICAuY29sb3JsZXNzIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWNvbG9ybGVzcyk7XHJcbiAgfVxyXG4gIC5nZW5lcmljIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IGdvbGRlbnJvZDtcclxuICB9XHJcbiAgLnN1bSB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiBnb2xkZW5yb2Q7XHJcbiAgfVxyXG5cclxuICAuY29sb3ItcGFyYW0ge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgfVxyXG5cclxuICAubWFuYS1jdXJ2ZSB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcclxuICB9XHJcblxyXG4gIC5hbGwtY3VydmVzIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWdyb3c6IDE7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gICAgaGVpZ2h0OiA4MHB4O1xyXG4gIH1cclxuXHJcbiAgLmFsbC1sYWJlbHMge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtc2hyaW5rOiAwO1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICB9XHJcblxyXG4gIC5jdXJ2ZS1lbGVtZW50IHtcclxuICAgIHdpZHRoOiAyMHB4O1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIGJvdHRvbTogMDtcclxuICAgIGJhY2tncm91bmQ6IGdyYXk7XHJcbiAgICAvKiB2ZXJ0aWNhbC1hbGlnbjogbWlkZGxlOyAqL1xyXG4gICAgYWxpZ24taXRlbXM6IGNlbnRlcjtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICB9XHJcblxyXG4gIC5jdXJ2ZS1sYWJlbCB7XHJcbiAgICB3aWR0aDogMjBweDtcclxuICB9XHJcbiAgLmN1cnZlLXdyYXBwZXIge1xyXG4gICAgd2lkdGg6IDIwcHg7XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgICBjdXJzb3I6IHBvaW50ZXI7XHJcbiAgfVxyXG5cclxuICAuY3VydmUtZWxlbWVudDpob3ZlciB7XHJcbiAgICBiYWNrZ3JvdW5kOiBsaWdodGNvcmFsO1xyXG4gIH1cclxuXHJcbiAgLmhpZ2hsaWdodGVkIC5jdXJ2ZS1lbGVtZW50IHtcclxuICAgIGJhY2tncm91bmQ6IGxpZ2h0Ymx1ZTtcclxuICB9XHJcblxyXG4gIC5jdXJ2ZS1sYWJlbC5oaWdobGlnaHRlZCB7XHJcbiAgICBiYWNrZ3JvdW5kOiBsaWdodGJsdWU7XHJcbiAgfVxyXG5cclxuICAuY3VydmUtbGFiZWw6aG92ZXIge1xyXG4gICAgYmFja2dyb3VuZDogbGlnaHRjb3JhbDtcclxuICB9XHJcblxyXG4gIGg0IHtcclxuICAgIG1hcmdpbi10b3A6IDVweDtcclxuICAgIG1hcmdpbi1ib3R0b206IDVweDtcclxuICB9XHJcblxyXG4gIC5sZHMtcmlwcGxlIHtcclxuICAgIGRpc3BsYXk6IGlubGluZS1ibG9jaztcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICAgIHdpZHRoOiA4MHB4O1xyXG4gICAgaGVpZ2h0OiA4MHB4O1xyXG4gIH1cclxuICAubGRzLXJpcHBsZSBkaXYge1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgYm9yZGVyOiA0cHggc29saWQgI2ZmZjtcclxuICAgIG9wYWNpdHk6IDE7XHJcbiAgICBib3JkZXItcmFkaXVzOiA1MCU7XHJcbiAgICBhbmltYXRpb246IGxkcy1yaXBwbGUgMXMgY3ViaWMtYmV6aWVyKDAsIDAuMiwgMC44LCAxKSBpbmZpbml0ZTtcclxuICB9XHJcblxyXG4gIC5jYXJkLXNlYXJjaCAubGRzLXJpcHBsZSBkaXYge1xyXG4gICAgYm9yZGVyOiA0cHggc29saWQgYmxhY2s7XHJcbiAgfVxyXG5cclxuICAubGRzLXJpcHBsZSBkaXY6bnRoLWNoaWxkKDIpIHtcclxuICAgIGFuaW1hdGlvbi1kZWxheTogLTAuNXM7XHJcbiAgfVxyXG4gIEBrZXlmcmFtZXMgbGRzLXJpcHBsZSB7XHJcbiAgICAwJSB7XHJcbiAgICAgIHRvcDogMzZweDtcclxuICAgICAgbGVmdDogMzZweDtcclxuICAgICAgd2lkdGg6IDA7XHJcbiAgICAgIGhlaWdodDogMDtcclxuICAgICAgb3BhY2l0eTogMTtcclxuICAgIH1cclxuICAgIDEwMCUge1xyXG4gICAgICB0b3A6IDBweDtcclxuICAgICAgbGVmdDogMHB4O1xyXG4gICAgICB3aWR0aDogNzJweDtcclxuICAgICAgaGVpZ2h0OiA3MnB4O1xyXG4gICAgICBvcGFjaXR5OiAwO1xyXG4gICAgfVxyXG4gIH1cclxuPC9zdHlsZT5cclxuXHJcbjxzdmVsdGU6d2luZG93XHJcbiAgb246bW91c2V1cD17b25NYWluTW91c2VEb3dufVxyXG4gIG9uOmNvbnRleHRtZW51fHByZXZlbnREZWZhdWx0PXsoKSA9PiBmYWxzZX1cclxuICBvbjprZXl1cD17bWFpbktleVVwfVxyXG4gIG9uOmtleWRvd249e21haW5LZXlEb3dufSAvPlxyXG48ZGl2IGNsYXNzPVwiY29udGVudFwiPlxyXG4gIDxkaXYgY2xhc3M9XCJjb250cm9sc1wiPlxyXG4gICAgPGRpdiBjbGFzcz1cImhlbHBcIj5cclxuICAgICAgPGRpdiBjbGFzcz1cImhlbHAtc3ltYm9sXCIgb246Y2xpY2s9e29wZW5IZWxwfT4/PC9kaXY+XHJcbiAgICAgIHsjaWYgaGVscEFjdGl2ZX1cclxuICAgICAgICA8aDQ+SG93IHRvIHVzZTo8L2g0PlxyXG4gICAgICAgIDxwPnBhc3RlIHlvdXIgZGVjayB0byB0aGUgZm9sbG93aW5nIGlucHV0LjwvcD5cclxuICAgICAgICA8dWw+XHJcbiAgICAgICAgICA8bGk+XHJcbiAgICAgICAgICAgIHdoZW4gYSBsaW5lIHN0YXJ0cyB3aXRoIFwiI1wiIGl0IHdpbGwgYmUgaW50ZXJwcmV0ZWQgYXMgaGVhZGxpbmVcclxuICAgICAgICAgIDwvbGk+XHJcbiAgICAgICAgICA8bGk+XHJcbiAgICAgICAgICAgIGEgY2FyZCBjYW4gYmUgZW50ZXJlZCB3aXRoIGEgbGVhZGluZyBjb3VudCwgb3IganVzdCB3aXRoIGl0cyBuYW1lXHJcbiAgICAgICAgICA8L2xpPlxyXG4gICAgICAgICAgPGxpPnVzZSB0aGUgXCJFU0NcIiBrZXkgdG8gcmVhbG9hZCB0aGUgcHJldmlldzwvbGk+XHJcbiAgICAgICAgICA8bGk+ZG91YmxlY2xpY2sgYSBjYXJkIHRvIHJlbW92ZSBpdDwvbGk+XHJcbiAgICAgICAgPC91bD5cclxuICAgICAgICA8cD5OT1RFOiB3ZSB1c2UgY29va2llcyB0byBzdG9yZSB5b3VyIGRlY2sgYWZ0ZXIgcmVsb2FkLjwvcD5cclxuICAgICAgICA8cD5OT1RFOiBUaGlzIGlzIG5vdCBhbiBvZmZpY2lhbCBNYWdpYyBwcm9kdWt0LjwvcD5cclxuICAgICAgey9pZn1cclxuXHJcbiAgICAgIHsjYXdhaXQgcHJvbWlzZX1cclxuXHJcbiAgICAgICAgPGRpdj5sb2FkaW5nOiB7cHJvZ3Jlc3N9L3thbGx9PC9kaXY+XHJcbiAgICAgIHs6dGhlbiBncm91cHN9XHJcblxyXG4gICAgICAgIHsjaWYgIWhlbHBBY3RpdmV9XHJcbiAgICAgICAgICA8aDQ+R2VuZXJhbDwvaDQ+XHJcblxyXG4gICAgICAgICAgPGRpdj5Ub3RhbCBjYXJkczoge2dyb3Vwc1snY2FyZENvdW50J119PC9kaXY+XHJcbiAgICAgICAgICA8ZGl2PlxyXG4gICAgICAgICAgICBMYW5kczoge2dyb3Vwc1snbGFuZENvdW50J119IE5vbmxhbmRzOiB7Z3JvdXBzWydjYXJkQ291bnQnXSAtIGdyb3Vwc1snbGFuZENvdW50J119XHJcbiAgICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgIGNsYXNzPVwidHlwZS1zZWxlY3RvclwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXsoKSA9PiBoaWdobGlnaHRDcmVhdHVyZSgnY3JlYXR1cmUnKX1cclxuICAgICAgICAgICAgY2xhc3M6aGlnaGxpZ2h0ZWQtY3JlYXR1cmU9eydjcmVhdHVyZScgPT0gaGlnaGxpZ2h0ZWRDcmVhdHVyZX0+XHJcbiAgICAgICAgICAgIENyZWF0dXJlczoge2dyb3Vwc1snY3JlYXR1cmVDb3VudCddfVxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgIGNsYXNzPVwidHlwZS1zZWxlY3RvclwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXsoKSA9PiBoaWdobGlnaHRDcmVhdHVyZSgnaW5zdGFudCcpfVxyXG4gICAgICAgICAgICBjbGFzczpoaWdobGlnaHRlZC1jcmVhdHVyZT17J2luc3RhbnQnID09IGhpZ2hsaWdodGVkQ3JlYXR1cmV9PlxyXG4gICAgICAgICAgICBJbnN0YW50czoge2dyb3Vwc1snaW5zdGFudENvdW50J119XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgY2xhc3M9XCJ0eXBlLXNlbGVjdG9yXCJcclxuICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodENyZWF0dXJlKCdzb3JjZXJ5Jyl9XHJcbiAgICAgICAgICAgIGNsYXNzOmhpZ2hsaWdodGVkLWNyZWF0dXJlPXsnc29yY2VyeScgPT0gaGlnaGxpZ2h0ZWRDcmVhdHVyZX0+XHJcbiAgICAgICAgICAgIFNvcmNlcmllczoge2dyb3Vwc1snc29yY2VyeUNvdW50J119XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgY2xhc3M9XCJ0eXBlLXNlbGVjdG9yXCJcclxuICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodENyZWF0dXJlKCdlbmNoYW50bWVudCcpfVxyXG4gICAgICAgICAgICBjbGFzczpoaWdobGlnaHRlZC1jcmVhdHVyZT17J2VuY2hhbnRtZW50JyA9PSBoaWdobGlnaHRlZENyZWF0dXJlfT5cclxuICAgICAgICAgICAgRW5jaGFudG1lbnRzOiB7Z3JvdXBzWydlbmNoYW50bWVudENvdW50J119XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgY2xhc3M9XCJ0eXBlLXNlbGVjdG9yXCJcclxuICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodENyZWF0dXJlKCdhcnRpZmFjdCcpfVxyXG4gICAgICAgICAgICBjbGFzczpoaWdobGlnaHRlZC1jcmVhdHVyZT17J2FydGlmYWN0JyA9PSBoaWdobGlnaHRlZENyZWF0dXJlfT5cclxuICAgICAgICAgICAgQXJ0aWZhY3RzOiB7Z3JvdXBzWydhcnRpZmFjdENvdW50J119XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgY2xhc3M9XCJ0eXBlLXNlbGVjdG9yXCJcclxuICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodENyZWF0dXJlKCdwbGFuZXN3YWxrZXInKX1cclxuICAgICAgICAgICAgY2xhc3M6aGlnaGxpZ2h0ZWQtY3JlYXR1cmU9eydwbGFuZXN3YWxrZXInID09IGhpZ2hsaWdodGVkQ3JlYXR1cmV9PlxyXG4gICAgICAgICAgICBQbGFuZXN3YWxrZXI6IHtncm91cHNbJ3BsYW5lc3dhbGtlckNvdW50J119XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJhbGwtdHlwZS1jb3VudFwiPlxyXG4gICAgICAgICAgICB7I2VhY2ggZ3JvdXBzWyd0eXBlTmFtZXMnXSBhcyB0eXBlTmFtZX1cclxuICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICBjbGFzcz1cInR5cGUtc2VsZWN0b3JcIlxyXG4gICAgICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodENyZWF0dXJlKHR5cGVOYW1lKX1cclxuICAgICAgICAgICAgICAgIGNsYXNzOmhpZ2hsaWdodGVkLWNyZWF0dXJlPXt0eXBlTmFtZSA9PSBoaWdobGlnaHRlZENyZWF0dXJlfT5cclxuICAgICAgICAgICAgICAgIHt0eXBlTmFtZX06IHtncm91cHNbJ3R5cGVDb3VudHMnXVt0eXBlTmFtZV19XHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgIHsvZWFjaH1cclxuXHJcbiAgICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgICA8ZGl2PkNvc3Q6IHtncm91cHMuY29zdC50b0ZpeGVkKDIpICsgJyQnfTwvZGl2PlxyXG5cclxuICAgICAgICAgIHsjaWYgc3RhdGlzdGljc0FjdGl2ZX1cclxuICAgICAgICAgICAgPGRpdiBjbGFzcz1cInN0YXRpc3RpY3NcIj5cclxuICAgICAgICAgICAgICA8aDQ+RGV2b3Rpb248L2g0PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJtYW5hLWRldm90aW9uXCI+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBibHVlXCI+e2dyb3Vwc1snbWFuYSddLmJsdWV9PC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBibGFja1wiPntncm91cHNbJ21hbmEnXS5ibGFja308L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIHJlZFwiPntncm91cHNbJ21hbmEnXS5yZWR9PC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSB3aGl0ZVwiPntncm91cHNbJ21hbmEnXS53aGl0ZX08L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGdyZWVuXCI+e2dyb3Vwc1snbWFuYSddLmdyZWVufTwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgY29sb3JsZXNzXCI+XHJcbiAgICAgICAgICAgICAgICAgIHtncm91cHNbJ21hbmEnXS5jb2xvcmxlc3N9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgICAgICAgPGg0PkdlbmVyaWMgTWFuYTwvaDQ+XHJcbiAgICAgICAgICAgICAgPGRpdj5SZW1haW5pbmcgZ2VuZXJpYyBtYW5hIGNvc3RzOntncm91cHNbJ21hbmEnXS5nZW5lcmljfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXY+Q01DLU1hbmEtU3VtOntncm91cHNbJ21hbmEnXS5zdW19PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdj5cclxuICAgICAgICAgICAgICAgIEF2ZXJhZ2UgQ01DIHBlciBOb25sYW5kOiB7Z3JvdXBzWydhdmVyYWdlTWFuYSddLnRvRml4ZWQoMil9XHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgPGg0PlN1Z2dlc3RlZCBNYW5hIERpc3RyaWJ1dGlvbjwvaDQ+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cIm1hbmEtcHJvcG9zYWxcIj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGJsdWVcIj5cclxuICAgICAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLmJsdWUgKiBncm91cHNbJ2xhbmRDb3VudCddKS50b0ZpeGVkKDEpfVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBibGFja1wiPlxyXG4gICAgICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10uYmxhY2sgKiBncm91cHNbJ2xhbmRDb3VudCddKS50b0ZpeGVkKDEpfVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSByZWRcIj5cclxuICAgICAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLnJlZCAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIHdoaXRlXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS53aGl0ZSAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGdyZWVuXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS5ncmVlbiAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGNvbG9ybGVzc1wiPlxyXG4gICAgICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10uY29sb3JsZXNzICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgIDxoND5NYW5hIEN1cnZlPC9oND5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwibWFuYS1jdXJ2ZVwiPlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImFsbC1jdXJ2ZXNcIj5cclxuICAgICAgICAgICAgICAgICAgeyNlYWNoIGdyb3Vwc1snbWFuYUN1cnZlJ10gYXMgbWFuYSwgaX1cclxuICAgICAgICAgICAgICAgICAgICB7I2lmIG1hbmEgPiAwfVxyXG4gICAgICAgICAgICAgICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImN1cnZlLXdyYXBwZXJcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzczpoaWdobGlnaHRlZD17ZGV2b3Rpb25IaWdobGlnaHQgPT0gaX1cclxuICAgICAgICAgICAgICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodERldm90aW9uKGkpfT5cclxuICAgICAgICAgICAgICAgICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiY3VydmUtZWxlbWVudFwiXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3R5bGU9eydoZWlnaHQ6JyArIGdldEhlaWdodChtYW5hLCBncm91cHMpICsgJyU7J30+XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAge21hbmEgfHwgJyd9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgICAgICAgey9lYWNofVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcblxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImFsbC1sYWJlbHNcIj5cclxuICAgICAgICAgICAgICAgICAgeyNlYWNoIGdyb3Vwc1snbWFuYUN1cnZlJ10gYXMgbWFuYSwgaX1cclxuICAgICAgICAgICAgICAgICAgICB7I2lmIG1hbmEgPiAwfVxyXG4gICAgICAgICAgICAgICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImN1cnZlLWxhYmVsXCJcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M6aGlnaGxpZ2h0ZWQ9e2Rldm90aW9uSGlnaGxpZ2h0ID09IGl9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG9uOmNsaWNrPXsoKSA9PiBoaWdobGlnaHREZXZvdGlvbihpKX0+XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHtpfVxyXG4gICAgICAgICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgICAgICAgey9lYWNofVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgey9pZn1cclxuICAgICAgICB7L2lmfVxyXG4gICAgICAgIDxkaXY+XHJcbiAgICAgICAgICBzZWFyY2g6XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgYmluZDp0aGlzPXtkZWNrU2VhcmNoSW5wdXR9XHJcbiAgICAgICAgICAgIHRpdGxlPVwiZS5nLjogc2FjcmlmaWNlIGEgKGFydGlmYWN0fGNyZWF0dXJlKVwiXHJcbiAgICAgICAgICAgIG9uOmtleXVwPXsoKSA9PiBjaGFuZ2VEZWNrU2VhcmNoKGdyb3Vwcyl9IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgIHs6Y2F0Y2ggZXJyb3J9XHJcbiAgICAgICAge2Vycm9yfVxyXG4gICAgICB7L2F3YWl0fVxyXG4gICAgICBGb3JtYXQ6XHJcbiAgICAgIDxzZWxlY3RcclxuICAgICAgICBiaW5kOnRoaXM9e2Zvcm1hdH1cclxuICAgICAgICBvbjpibHVyPXtyZWxvYWR9XHJcbiAgICAgICAgb246Y2hhbmdlPXtyZWxvYWR9XHJcbiAgICAgICAgdGl0bGU9XCJzZWxlY3QgdGhlIGxlZ2FsaXR5IGNoZWNrZXJcIj5cclxuICAgICAgICA8b3B0aW9uIHNlbGVjdGVkPmNvbW1hbmRlcjwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+YnJhd2w8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPmR1ZWw8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPmZ1dHVyZTwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+aGlzdG9yaWM8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPmxlZ2FjeTwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+bW9kZXJuPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5vbGRzY2hvb2w8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnBhdXBlcjwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+cGVubnk8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnBpb25lZXI8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnN0YW5kYXJkPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj52aW50YWdlPC9vcHRpb24+XHJcbiAgICAgIDwvc2VsZWN0PlxyXG4gICAgICA8ZGl2IGNsYXNzPVwic2xpZGVjb250YWluZXJcIj5cclxuICAgICAgICBTY2FsZTpcclxuICAgICAgICA8aW5wdXRcclxuICAgICAgICAgIHR5cGU9XCJyYW5nZVwiXHJcbiAgICAgICAgICBtaW49XCIyNVwiXHJcbiAgICAgICAgICBtYXg9XCIxMDBcIlxyXG4gICAgICAgICAgYmluZDp2YWx1ZT17c2NhbGluZ31cclxuICAgICAgICAgIHRpdGxlPVwic2NhbGVzIHRoZSBjYXJkIHNpemUgaW4gdGhlIHJpZ2h0IHZpZXdcIiAvPlxyXG4gICAgICA8L2Rpdj5cclxuICAgICAgPGRpdiBjbGFzcz1cInNhdmUtY29udGFpbmVyXCI+XHJcbiAgICAgICAgU2F2ZSA6XHJcbiAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICBiaW5kOnRoaXM9e2RlY2tOYW1lSW5wdXR9XHJcbiAgICAgICAgICBvbjprZXl1cD17b25EZWNrTmFtZVR5cGV9XHJcbiAgICAgICAgICB2YWx1ZT17Q29va2llcy5nZXQoJ2RlY2tOYW1lJykgfHwgJ3Vua25vd25fZGVjayd9XHJcbiAgICAgICAgICB0aXRsZT1cIlRoZSBuYW1lIG9mIHRoZSBkZWNrIGZvciBzYXZpbmdcIiAvPlxyXG4gICAgICAgIDxidXR0b25cclxuICAgICAgICAgIG9uOmNsaWNrPXtzYXZlRGVja31cclxuICAgICAgICAgIHRpdGxlPVwidGhpcyB3aWxsIGRvd25sb2FkIHlvdSBhIGZpbGUsIGNhbGxlZCBsaWtlIHlvdSBwcm92aWRlIGluIHRoZVxyXG4gICAgICAgICAgZGVja1wiPlxyXG4gICAgICAgICAgc2F2ZVxyXG4gICAgICAgIDwvYnV0dG9uPlxyXG4gICAgICA8L2Rpdj5cclxuICAgICAgPGJ1dHRvblxyXG4gICAgICAgIG9uOmNsaWNrPXt0b2dnbGVTdGF0aXN0aWNzfVxyXG4gICAgICAgIHRpdGxlPVwidG9nZ2xlcyB0aGUgdmlzaWJpbGl0eSBvZiB0aGUgc3RhdGlzdGlja3NcIj5cclxuICAgICAgICB7c3RhdGlzdGljc0FjdGl2ZSA/ICdoaWRlIHN0YXRpc3RpY3MnIDogJ3Nob3cgc3RhdGlzdGljcyd9XHJcbiAgICAgIDwvYnV0dG9uPlxyXG4gICAgICA8YnV0dG9uXHJcbiAgICAgICAgb246Y2xpY2s9e3NvcnREZWNrU3RyaW5nfVxyXG4gICAgICAgIHRpdGxlPVwidGhpcyBzb3J0cyB0aGUgZGVjayB0byBsYW5kcyBzcGVsbHMgYW5kIGNyZWF0dXJlcyAtTk9URTogeW91clxyXG4gICAgICAgIGdyb3VwcyB3aWxsIGJlIHJlcGxhY2VkXCI+XHJcbiAgICAgICAgc29ydFxyXG4gICAgICA8L2J1dHRvbj5cclxuICAgICAgPGJ1dHRvblxyXG4gICAgICAgIG9uOmNsaWNrPXtjb3B5RGVja31cclxuICAgICAgICB0aXRsZT1cInRoaXMgY29waWVzIHRoZSBkZWNrIHdpdGhvdXQgZ3JvdXBzIGFuZCBzdHVmZiB0byB5b3VyIGNsaXBib2FyZFwiPlxyXG4gICAgICAgIGNsZWFuIGNvcHlcclxuICAgICAgPC9idXR0b24+XHJcbiAgICAgIDxidXR0b25cclxuICAgICAgICBvbjpjbGljaz17c2hhcmVEZWNrfVxyXG4gICAgICAgIHRpdGxlPVwiY29waWVzIGEgc3RyaW5nIHRvIHlvdXIgY2xpcGJvYXJkLCB0aGF0IHNoYXJlcyB0aGlzIGRlY2sgd2l0aFxyXG4gICAgICAgIG90aGVyc1wiPlxyXG4gICAgICAgIHNoYXJlXHJcbiAgICAgIDwvYnV0dG9uPlxyXG5cclxuICAgICAgPGJ1dHRvbiBvbjpjbGljaz17cmVsb2FkfT5yZWZyZXNoPC9idXR0b24+XHJcbiAgICA8L2Rpdj5cclxuICAgIDx0ZXh0YXJlYSBiaW5kOnRoaXM9e2lucHV0fSBjbGFzcz1cImlucHV0XCIgb246a2V5dXA9e29uVHlwaW5nfSAvPlxyXG4gIDwvZGl2PlxyXG5cclxuICA8ZGl2IGNsYXNzPVwiZGlzcGxheVwiIGJpbmQ6dGhpcz17ZGlzcGxheX0+XHJcbiAgICB7I2F3YWl0IHByb21pc2V9XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJsb2FkaW5nLXdyYXBwZXJcIj5cclxuICAgICAgICA8ZGl2PmxvYWRpbmc6IHtwcm9ncmVzc30ve2FsbH08L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwibGRzLXJpcHBsZVwiPlxyXG4gICAgICAgICAgPGRpdiAvPlxyXG4gICAgICAgICAgPGRpdiAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICA8L2Rpdj5cclxuICAgIHs6dGhlbiBncm91cHN9XHJcblxyXG4gICAgICB7I2VhY2ggZGVja1NlYWNoIHx8IGdyb3VwcyB8fCBbXSBhcyBncm91cH1cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXBcIj5cclxuXHJcbiAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtaGVhZGVyXCI+XHJcbiAgICAgICAgICAgIDxoMj57Z3JvdXAubmFtZSArICcgLy8gJyArIGdyb3VwLmNvdW50IHx8ICdubyBuYW1lJ308L2gyPlxyXG4gICAgICAgICAgICA8YnV0dG9uIG9uOmNsaWNrPXsoKSA9PiB0b2dnbGVHcm91cFZpc2liaWxpdHkoZ3JvdXApfT5cclxuICAgICAgICAgICAgICB0b2dnbGVcclxuICAgICAgICAgICAgPC9idXR0b24+XHJcbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC1zdGF0aXN0aWNzXCI+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGJsdWVcIj57Z3JvdXAubWFuYS5ibHVlfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSBibGFja1wiPntncm91cC5tYW5hLmJsYWNrfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSByZWRcIj57Z3JvdXAubWFuYS5yZWR9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIHdoaXRlXCI+e2dyb3VwLm1hbmEud2hpdGV9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGdyZWVuXCI+e2dyb3VwLm1hbmEuZ3JlZW59PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGNvbG9ybGVzc1wiPntncm91cC5tYW5hLmNvbG9ybGVzc308L2Rpdj5cclxuICAgICAgICAgICAgICA8IS0tIGdlbmVyaWM6XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGdlbmVyaWNcIj57Z3JvdXAubWFuYS5nZW5lcmljfTwvZGl2PiAtLT5cclxuICAgICAgICAgICAgICBzdW06XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIHN1bVwiPntncm91cC5tYW5hLnN1bX08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgZ3JvdXAtY29zdFwiPlxyXG4gICAgICAgICAgICAgICAge2dyb3VwLmNvc3QudG9GaXhlZCgyKSArICckJ31cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgPC9kaXY+XHJcblxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgIGNsYXNzPVwiZ3JvdXAtY29udGVudFwiXHJcbiAgICAgICAgICAgIGNsYXNzOmhpZGRlbj17aGlkZGVuR3JvdXBzLmhhcyhncm91cC5uYW1lKX0+XHJcblxyXG4gICAgICAgICAgICB7I2VhY2ggZ3JvdXAuY2FyZHMgYXMgY2FyZH1cclxuICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICBjbGFzcz1cImVudHJ5XCJcclxuICAgICAgICAgICAgICAgIHN0eWxlPXsnd2lkdGg6JyArIHdpZHRoICsgJ3B4OyBoZWlnaHQ6JyArIChjYXJkLmNvdW50IDw9IDQgPyBoZWlnaHQgKyAoKGNhcmQuY291bnQgfHwgMSkgLSAxKSAqIDQwIDogaGVpZ2h0ICsgMyAqIDQwKSArICdweDsnfT5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJzaG9waW5nXCI+XHJcbiAgICAgICAgICAgICAgICAgIDxhXHJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJsaW5rXCJcclxuICAgICAgICAgICAgICAgICAgICBocmVmPXtjYXJkLmRhdGEucHVyY2hhc2VfdXJpcy5jYXJkbWFya2V0fVxyXG4gICAgICAgICAgICAgICAgICAgIHRhcmdldD1cIl9ibGFua1wiPlxyXG4gICAgICAgICAgICAgICAgICAgICYjMTI4NzIyO1xyXG4gICAgICAgICAgICAgICAgICA8L2E+XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIHsjZWFjaCB7IGxlbmd0aDogY2FyZC5jb3VudCA+IDQgPyA0IDogY2FyZC5jb3VudCB9IGFzIF8sIGl9XHJcbiAgICAgICAgICAgICAgICAgIDxpbWdcclxuICAgICAgICAgICAgICAgICAgICBjbGFzczpiYW5uZWQ9e2NhcmQuZGF0YS5sZWdhbGl0aWVzW2Zvcm1hdC52YWx1ZV0gIT09ICdsZWdhbCd9XHJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M6aGlnaGxpZ2h0ZWQ9e2Rldm90aW9uSGlnaGxpZ2h0ID09IGNhcmQuZGF0YS5jbWN9XHJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M6dHlwZS1oaWdobGlnaHQ9e2hpZ2hsaWdodGVkQ3JlYXR1cmUgJiYgY2FyZC5kYXRhLnR5cGVfbGluZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAudG9Mb3dlckNhc2UoKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAuaW5jbHVkZXMoaGlnaGxpZ2h0ZWRDcmVhdHVyZSl9XHJcbiAgICAgICAgICAgICAgICAgICAgb246bW91c2V1cHxzdG9wUHJvcGFnYXRpb249e2V2dCA9PiBjYXJkQ29udGV4dE1lbnUoZXZ0LCBjYXJkLCBncm91cHMpfVxyXG4gICAgICAgICAgICAgICAgICAgIG9uOmRibGNsaWNrPXsoKSA9PiByZW1vdmUoY2FyZCl9XHJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJjYXJkXCJcclxuICAgICAgICAgICAgICAgICAgICBzdHlsZT17J21hcmdpbi10b3A6ICcgKyBpICogNDAgKyAncHgnfVxyXG4gICAgICAgICAgICAgICAgICAgIHNyYz17Y2FyZC51cmx9XHJcbiAgICAgICAgICAgICAgICAgICAgYWx0PXtjYXJkLm5hbWV9XHJcbiAgICAgICAgICAgICAgICAgICAge3dpZHRofVxyXG4gICAgICAgICAgICAgICAgICAgIHtoZWlnaHR9IC8+XHJcbiAgICAgICAgICAgICAgICB7L2VhY2h9XHJcblxyXG4gICAgICAgICAgICAgICAgeyNpZiBjYXJkLmRhdGEubGVnYWxpdGllc1tmb3JtYXQudmFsdWVdICE9PSAnbGVnYWwnfVxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiYmFubmVkLXRleHRcIj5CQU5ORUQ8L2Rpdj5cclxuICAgICAgICAgICAgICAgIHsvaWZ9XHJcbiAgICAgICAgICAgICAgICB7I2lmIGNhcmQuY291bnQgPiA0fVxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiY291bnRcIj57Y2FyZC5jb3VudH14PC9kaXY+XHJcbiAgICAgICAgICAgICAgICB7L2lmfVxyXG5cclxuICAgICAgICAgICAgICAgIHsjaWYgc2NhbGluZyA+IDkwfVxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwicHJpY2VcIj57Y2FyZC5kYXRhLnByaWNlcy51c2QgKyAnJCcgfHwgJz8/Pyd9PC9kaXY+XHJcbiAgICAgICAgICAgICAgICB7L2lmfVxyXG5cclxuICAgICAgICAgICAgICAgIHsjaWYgY3VycmVudENhcmRDb250ZXh0ID09PSBjYXJkfVxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiY2FyZC1jb250ZXh0LW1lbnVcIj5cclxuXHJcbiAgICAgICAgICAgICAgICAgICAgeyNlYWNoIGdyb3VwcyBhcyBzdWJHcm91cH1cclxuICAgICAgICAgICAgICAgICAgICAgIHsjaWYgZ3JvdXAubmFtZSAhPSBzdWJHcm91cC5uYW1lfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJjYXJkLWNvbnRleHQtZW50cnlcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgIG9uOm1vdXNlZG93bj17ZXZ0ID0+IGNhcmRDb250ZXh0Q2xpY2soZXZ0LCBjYXJkLCBzdWJHcm91cCl9PlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHtzdWJHcm91cC5uYW1lfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgICAgICAgIHsvaWZ9XHJcbiAgICAgICAgICAgICAgICAgICAgey9lYWNofVxyXG4gICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIHsvaWZ9XHJcblxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICB7L2VhY2h9XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgey9lYWNofVxyXG5cclxuICAgIHs6Y2F0Y2ggZXJyb3J9XHJcblxyXG4gICAgICA8ZGl2IGNsYXNzPVwiZXJyb3JcIj5cclxuICAgICAgICBFUlJPUiwgY2hlY2sgeW91ciBkZWNrbGlzdCBmb3IgY29ycmVjdCBmb3JtYXQgb3IgaW50ZXJuZXQgY29ubmVjdGlvblxyXG4gICAgICAgIGJydWRpXHJcbiAgICAgIDwvZGl2PlxyXG4gICAgey9hd2FpdH1cclxuICA8L2Rpdj5cclxuXHJcbiAgPGRpdiBjbGFzcz1cImNhcmQtc2VhcmNoXCIgY2xhc3M6aGlkZT17IWNhcmRTZWFyY2hBY3RpdmV9PlxyXG4gICAgPGRpdiBjbGFzcz1cInRvZ2dsZS1zZWFyY2hcIiBvbjpjbGljaz17dG9nZ2xlU2VhcmNofT54PC9kaXY+XHJcbiAgICA8ZGl2IGNsYXNzPVwic2VhcmNoLXBhcmFtc1wiPlxyXG4gICAgICA8ZGl2IGNsYXNzPVwic2VhcmNoLXBhcmFtXCI+XHJcbiAgICAgICAgTmFtZTpcclxuICAgICAgICA8aW5wdXQgYmluZDp0aGlzPXtzcE5hbWV9IC8+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgICA8ZGl2IGNsYXNzPVwic2VhcmNoLXBhcmFtXCI+XHJcbiAgICAgICAgVGV4dDpcclxuICAgICAgICA8aW5wdXQgYmluZDp0aGlzPXtzcFRleHR9IC8+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgICA8ZGl2IGNsYXNzPVwic2VhcmNoLXBhcmFtXCI+XHJcbiAgICAgICAgVHlwZTpcclxuICAgICAgICA8aW5wdXQgYmluZDp0aGlzPXtzcFR5cGV9IC8+XHJcbiAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1wYXJhbSBjb2xvci1wYXJhbVwiPlxyXG4gICAgICAgIENvbW1hbmRlci1Db2xvcnM6XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImJsdWVcIj5cclxuICAgICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgICB0eXBlPVwiY2hlY2tib3hcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17Y2xlYXJDb2xvcmxlc3N9XHJcbiAgICAgICAgICAgIGNsYXNzPVwiYmx1ZVwiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhCbHVlfSAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJibGFja1wiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJibGFja1wiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhCbGFja30gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwicmVkXCI+XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgdHlwZT1cImNoZWNrYm94XCJcclxuICAgICAgICAgICAgb246Y2xpY2s9e2NsZWFyQ29sb3JsZXNzfVxyXG4gICAgICAgICAgICBjbGFzcz1cInJlZFwiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhSZWR9IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cIndoaXRlXCI+XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgdHlwZT1cImNoZWNrYm94XCJcclxuICAgICAgICAgICAgb246Y2xpY2s9e2NsZWFyQ29sb3JsZXNzfVxyXG4gICAgICAgICAgICBjbGFzcz1cIndoaXRlXCJcclxuICAgICAgICAgICAgYmluZDp0aGlzPXtzcEVESFdoaXRlfSAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJncmVlblwiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJncmVlblwiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhHcmVlbn0gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiY29sb3JsZXNzXCI+XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgdHlwZT1cImNoZWNrYm94XCJcclxuICAgICAgICAgICAgb246Y2xpY2s9e2NsZWFyRm9yQ29sb3JsZXNzfVxyXG4gICAgICAgICAgICBjbGFzcz1cImNvbG9ybGVzc1wiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhDb2xvcmxlc3N9IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgICA8YnV0dG9uIG9uOmNsaWNrPXtzZWFyY2hDYXJkc30+c2VhcmNoPC9idXR0b24+XHJcbiAgICA8L2Rpdj5cclxuXHJcbiAgICB7I2F3YWl0IGNhcmRTZWFyY2hQcm9taXNlfVxyXG4gICAgICA8ZGl2IGNsYXNzPVwibG9hZGluZy13cmFwcGVyXCI+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImxkcy1yaXBwbGVcIj5cclxuICAgICAgICAgIDxkaXYgLz5cclxuICAgICAgICAgIDxkaXYgLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgPC9kaXY+XHJcbiAgICB7OnRoZW4gcmVzdWx0fVxyXG5cclxuICAgICAgeyNpZiByZXN1bHQuY29kZSAhPT0gJ25vdF9mb3VuZCcgJiYgcmVzdWx0LmRhdGF9XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1yZXN1bHRcIj5cclxuICAgICAgICAgIHsjZWFjaCByZXN1bHQuZGF0YSBhcyBjYXJkfVxyXG4gICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgY2xhc3M9XCJlbnRyeVwiXHJcbiAgICAgICAgICAgICAgc3R5bGU9eyd3aWR0aDonICsgd2lkdGggKyAncHg7IGhlaWdodDonICsgaGVpZ2h0ICsgJ3B4Oyd9PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJzaG9waW5nXCI+XHJcbiAgICAgICAgICAgICAgICA8YSBjbGFzcz1cImxpbmtcIiBocmVmPXtjYXJkLmNhcmRtYXJrZXR9IHRhcmdldD1cIl9ibGFua1wiPlxyXG4gICAgICAgICAgICAgICAgICAmIzEyODcyMjtcclxuICAgICAgICAgICAgICAgIDwvYT5cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICA8aW1nXHJcbiAgICAgICAgICAgICAgICBvbjpkYmxjbGljaz17KCkgPT4gYXBwZW5kQ2FyZChjYXJkLm5hbWUpfVxyXG4gICAgICAgICAgICAgICAgY2xhc3M6YmFubmVkPXtjYXJkLmxlZ2FsaXRpZXNbZm9ybWF0LnZhbHVlXSAhPT0gJ2xlZ2FsJ31cclxuICAgICAgICAgICAgICAgIGNsYXNzPVwiY2FyZFwiXHJcbiAgICAgICAgICAgICAgICBzcmM9e2NhcmQudXJsfVxyXG4gICAgICAgICAgICAgICAgYWx0PXtjYXJkLm5hbWV9XHJcbiAgICAgICAgICAgICAgICB7d2lkdGh9XHJcbiAgICAgICAgICAgICAgICB7aGVpZ2h0fSAvPlxyXG5cclxuICAgICAgICAgICAgICB7I2lmIGNhcmQubGVnYWxpdGllc1tmb3JtYXQudmFsdWVdICE9PSAnbGVnYWwnfVxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImJhbm5lZC10ZXh0XCI+QkFOTkVEPC9kaXY+XHJcbiAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgICB7I2lmIHNjYWxpbmcgPiA5MH1cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJwcmljZVwiPntjYXJkLnByaWNlcy51c2QgKyAnJCcgfHwgJz8/Pyd9PC9kaXY+XHJcbiAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICB7OmVsc2V9XHJcbiAgICAgICAgICAgIDxkaXY+Tm8gY2FyZHMgZm91bmQ8L2Rpdj5cclxuICAgICAgICAgIHsvZWFjaH1cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8YnV0dG9uXHJcbiAgICAgICAgICBkaXNhYmxlZD17IXJlc3VsdC5oYXNfbW9yZX1cclxuICAgICAgICAgIG9uOmNsaWNrPXsoKSA9PiBzZWFyY2hDYXJkcyhyZXN1bHQubmV4dF9wYWdlKX0+XHJcbiAgICAgICAgICBuZXh0XHJcbiAgICAgICAgPC9idXR0b24+XHJcbiAgICAgIHs6ZWxzZX1cclxuICAgICAgICA8ZGl2Pk5vIGNhcmRzIGZvdW5kPC9kaXY+XHJcbiAgICAgIHsvaWZ9XHJcbiAgICB7OmNhdGNoIGVycm9yfVxyXG4gICAgICA8ZGl2IGNsYXNzPVwiZXJyb3JcIj5cclxuICAgICAgICBFUlJPUiwgY2hlY2sgeW91ciBkZWNrbGlzdCBmb3IgY29ycmVjdCBmb3JtYXQgb3IgaW50ZXJuZXQgY29ubmVjdGlvblxyXG4gICAgICAgIGJydWRpXHJcbiAgICAgIDwvZGl2PlxyXG4gICAgey9hd2FpdH1cclxuXHJcbiAgPC9kaXY+XHJcbjwvZGl2PlxyXG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBcWNFLFFBQVEsY0FBQyxDQUFDLEFBQ1IsY0FBYyxDQUFFLHFCQUFxQixDQUNyQyxjQUFjLENBQUUsc0JBQXNCLENBQ3RDLFdBQVcsQ0FBRSxtQkFBbUIsQ0FDaEMsT0FBTyxDQUFFLG9CQUFvQixDQUM3QixPQUFPLENBQUUsaUJBQWlCLENBQzFCLEtBQUssQ0FBRSxvQkFBb0IsQ0FDM0IsT0FBTyxDQUFFLHNCQUFzQixDQUMvQixNQUFNLENBQUUsc0JBQXNCLEFBQ2hDLENBQUMsQUFFRCxRQUFRLGNBQUMsQ0FBQyxBQUNSLE9BQU8sQ0FBRSxJQUFJLENBQ2IsY0FBYyxDQUFFLEdBQUcsQ0FDbkIsS0FBSyxDQUFFLElBQUksQ0FDWCxNQUFNLENBQUUsSUFBSSxBQUNkLENBQUMsQUFFRCxZQUFZLGNBQUMsQ0FBQyxBQUNaLGFBQWEsQ0FBRSxHQUFHLENBQ2xCLE1BQU0sQ0FBRSxHQUFH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 */";
		append(document.head, style);
	}

	function get_each_context(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.card = list[i];
		return child_ctx;
	}

	function get_each_context_3(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.subGroup = list[i];
		return child_ctx;
	}

	function get_each_context_4(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx._ = list[i];
		child_ctx.i = i;
		return child_ctx;
	}

	function get_each_context_2(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.card = list[i];
		return child_ctx;
	}

	function get_each_context_1(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.group = list[i];
		return child_ctx;
	}

	function get_each_context_5(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.mana = list[i];
		child_ctx.i = i;
		return child_ctx;
	}

	function get_each_context_6(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.mana = list[i];
		child_ctx.i = i;
		return child_ctx;
	}

	function get_each_context_7(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.typeName = list[i];
		return child_ctx;
	}

	// (912:6) {#if helpActive}
	function create_if_block_12(ctx) {
		var h4, t1, p0, t3, ul, li0, t5, li1, t7, li2, t9, li3, t11, p1, t13, p2;

		return {
			c: function create() {
				h4 = element("h4");
				h4.textContent = "How to use:";
				t1 = space();
				p0 = element("p");
				p0.textContent = "paste your deck to the following input.";
				t3 = space();
				ul = element("ul");
				li0 = element("li");
				li0.textContent = "when a line starts with \"#\" it will be interpreted as headline";
				t5 = space();
				li1 = element("li");
				li1.textContent = "a card can be entered with a leading count, or just with its name";
				t7 = space();
				li2 = element("li");
				li2.textContent = "use the \"ESC\" key to reaload the preview";
				t9 = space();
				li3 = element("li");
				li3.textContent = "doubleclick a card to remove it";
				t11 = space();
				p1 = element("p");
				p1.textContent = "NOTE: we use cookies to store your deck after reload.";
				t13 = space();
				p2 = element("p");
				p2.textContent = "NOTE: This is not an official Magic produkt.";
				h4.className = "svelte-yxz9np";
				add_location(h4, file, 912, 8, 19509);
				add_location(p0, file, 913, 8, 19539);
				add_location(li0, file, 915, 10, 19611);
				add_location(li1, file, 918, 10, 19720);
				add_location(li2, file, 921, 10, 19832);
				add_location(li3, file, 922, 10, 19893);
				add_location(ul, file, 914, 8, 19595);
				add_location(p1, file, 924, 8, 19958);
				add_location(p2, file, 925, 8, 20028);
			},

			m: function mount(target, anchor) {
				insert(target, h4, anchor);
				insert(target, t1, anchor);
				insert(target, p0, anchor);
				insert(target, t3, anchor);
				insert(target, ul, anchor);
				append(ul, li0);
				append(ul, t5);
				append(ul, li1);
				append(ul, t7);
				append(ul, li2);
				append(ul, t9);
				append(ul, li3);
				insert(target, t11, anchor);
				insert(target, p1, anchor);
				insert(target, t13, anchor);
				insert(target, p2, anchor);
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(h4);
					detach(t1);
					detach(p0);
					detach(t3);
					detach(ul);
					detach(t11);
					detach(p1);
					detach(t13);
					detach(p2);
				}
			}
		};
	}

	// (1075:6) {:catch error}
	function create_catch_block_2(ctx) {
		var t_value = ctx.error, t;

		return {
			c: function create() {
				t = text(t_value);
			},

			m: function mount(target, anchor) {
				insert(target, t, anchor);
			},

			p: function update_1(changed, ctx) {
				if ((changed.promise) && t_value !== (t_value = ctx.error)) {
					set_data(t, t_value);
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(t);
				}
			}
		};
	}

	// (932:6) {:then groups}
	function create_then_block_2(ctx) {
		var t0, div, t1, input_1, dispose;

		var if_block = (!ctx.helpActive) && create_if_block_8(ctx);

		function keyup_handler() {
			return ctx.keyup_handler(ctx);
		}

		return {
			c: function create() {
				if (if_block) if_block.c();
				t0 = space();
				div = element("div");
				t1 = text("search:\r\n          ");
				input_1 = element("input");
				input_1.title = "e.g.: sacrifice a (artifact|creature)";
				add_location(input_1, file, 1069, 10, 25856);
				add_location(div, file, 1067, 8, 25820);
				dispose = listen(input_1, "keyup", keyup_handler);
			},

			m: function mount(target, anchor) {
				if (if_block) if_block.m(target, anchor);
				insert(target, t0, anchor);
				insert(target, div, anchor);
				append(div, t1);
				append(div, input_1);
				add_binding_callback(() => ctx.input_1_binding(input_1, null));
			},

			p: function update_1(changed, new_ctx) {
				ctx = new_ctx;
				if (!ctx.helpActive) {
					if (if_block) {
						if_block.p(changed, ctx);
					} else {
						if_block = create_if_block_8(ctx);
						if_block.c();
						if_block.m(t0.parentNode, t0);
					}
				} else if (if_block) {
					if_block.d(1);
					if_block = null;
				}

				if (changed.items) {
					ctx.input_1_binding(null, input_1);
					ctx.input_1_binding(input_1, null);
				}
			},

			d: function destroy(detaching) {
				if (if_block) if_block.d(detaching);

				if (detaching) {
					detach(t0);
					detach(div);
				}

				ctx.input_1_binding(null, input_1);
				dispose();
			}
		};
	}

	// (934:8) {#if !helpActive}
	function create_if_block_8(ctx) {
		var h4, t1, div0, t2, t3_value = ctx.groups['cardCount'], t3, t4, div1, t5, t6_value = ctx.groups['landCount'], t6, t7, t8_value = ctx.groups['cardCount'] - ctx.groups['landCount'], t8, t9, div2, t10, t11_value = ctx.groups['creatureCount'], t11, t12, div3, t13, t14_value = ctx.groups['instantCount'], t14, t15, div4, t16, t17_value = ctx.groups['sorceryCount'], t17, t18, div5, t19, t20_value = ctx.groups['enchantmentCount'], t20, t21, div6, t22, t23_value = ctx.groups['artifactCount'], t23, t24, div7, t25, t26_value = ctx.groups['planeswalkerCount'], t26, t27, div8, t28, div9, t29, t30_value = ctx.groups.cost.toFixed(2) + '$', t30, t31, if_block_anchor, dispose;

		var each_value_7 = ctx.groups['typeNames'];

		var each_blocks = [];

		for (var i = 0; i < each_value_7.length; i += 1) {
			each_blocks[i] = create_each_block_7(get_each_context_7(ctx, each_value_7, i));
		}

		var if_block = (ctx.statisticsActive) && create_if_block_9(ctx);

		return {
			c: function create() {
				h4 = element("h4");
				h4.textContent = "General";
				t1 = space();
				div0 = element("div");
				t2 = text("Total cards: ");
				t3 = text(t3_value);
				t4 = space();
				div1 = element("div");
				t5 = text("Lands: ");
				t6 = text(t6_value);
				t7 = text(" Nonlands: ");
				t8 = text(t8_value);
				t9 = space();
				div2 = element("div");
				t10 = text("Creatures: ");
				t11 = text(t11_value);
				t12 = space();
				div3 = element("div");
				t13 = text("Instants: ");
				t14 = text(t14_value);
				t15 = space();
				div4 = element("div");
				t16 = text("Sorceries: ");
				t17 = text(t17_value);
				t18 = space();
				div5 = element("div");
				t19 = text("Enchantments: ");
				t20 = text(t20_value);
				t21 = space();
				div6 = element("div");
				t22 = text("Artifacts: ");
				t23 = text(t23_value);
				t24 = space();
				div7 = element("div");
				t25 = text("Planeswalker: ");
				t26 = text(t26_value);
				t27 = space();
				div8 = element("div");

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}

				t28 = space();
				div9 = element("div");
				t29 = text("Cost: ");
				t30 = text(t30_value);
				t31 = space();
				if (if_block) if_block.c();
				if_block_anchor = empty();
				h4.className = "svelte-yxz9np";
				add_location(h4, file, 934, 10, 20229);
				add_location(div0, file, 936, 10, 20259);
				add_location(div1, file, 937, 10, 20316);
				div2.className = "type-selector svelte-yxz9np";
				toggle_class(div2, "highlighted-creature", 'creature' == ctx.highlightedCreature);
				add_location(div2, file, 941, 10, 20449);
				div3.className = "type-selector svelte-yxz9np";
				toggle_class(div3, "highlighted-creature", 'instant' == ctx.highlightedCreature);
				add_location(div3, file, 947, 10, 20705);
				div4.className = "type-selector svelte-yxz9np";
				toggle_class(div4, "highlighted-creature", 'sorcery' == ctx.highlightedCreature);
				add_location(div4, file, 953, 10, 20957);
				div5.className = "type-selector svelte-yxz9np";
				toggle_class(div5, "highlighted-creature", 'enchantment' == ctx.highlightedCreature);
				add_location(div5, file, 959, 10, 21210);
				div6.className = "type-selector svelte-yxz9np";
				toggle_class(div6, "highlighted-creature", 'artifact' == ctx.highlightedCreature);
				add_location(div6, file, 965, 10, 21478);
				div7.className = "type-selector svelte-yxz9np";
				toggle_class(div7, "highlighted-creature", 'planeswalker' == ctx.highlightedCreature);
				add_location(div7, file, 971, 10, 21734);
				div8.className = "all-type-count svelte-yxz9np";
				add_location(div8, file, 977, 10, 22005);
				add_location(div9, file, 989, 10, 22425);

				dispose = [
					listen(div2, "click", ctx.click_handler),
					listen(div3, "click", ctx.click_handler_1),
					listen(div4, "click", ctx.click_handler_2),
					listen(div5, "click", ctx.click_handler_3),
					listen(div6, "click", ctx.click_handler_4),
					listen(div7, "click", ctx.click_handler_5)
				];
			},

			m: function mount(target, anchor) {
				insert(target, h4, anchor);
				insert(target, t1, anchor);
				insert(target, div0, anchor);
				append(div0, t2);
				append(div0, t3);
				insert(target, t4, anchor);
				insert(target, div1, anchor);
				append(div1, t5);
				append(div1, t6);
				append(div1, t7);
				append(div1, t8);
				insert(target, t9, anchor);
				insert(target, div2, anchor);
				append(div2, t10);
				append(div2, t11);
				insert(target, t12, anchor);
				insert(target, div3, anchor);
				append(div3, t13);
				append(div3, t14);
				insert(target, t15, anchor);
				insert(target, div4, anchor);
				append(div4, t16);
				append(div4, t17);
				insert(target, t18, anchor);
				insert(target, div5, anchor);
				append(div5, t19);
				append(div5, t20);
				insert(target, t21, anchor);
				insert(target, div6, anchor);
				append(div6, t22);
				append(div6, t23);
				insert(target, t24, anchor);
				insert(target, div7, anchor);
				append(div7, t25);
				append(div7, t26);
				insert(target, t27, anchor);
				insert(target, div8, anchor);

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(div8, null);
				}

				insert(target, t28, anchor);
				insert(target, div9, anchor);
				append(div9, t29);
				append(div9, t30);
				insert(target, t31, anchor);
				if (if_block) if_block.m(target, anchor);
				insert(target, if_block_anchor, anchor);
			},

			p: function update_1(changed, ctx) {
				if ((changed.promise) && t3_value !== (t3_value = ctx.groups['cardCount'])) {
					set_data(t3, t3_value);
				}

				if ((changed.promise) && t6_value !== (t6_value = ctx.groups['landCount'])) {
					set_data(t6, t6_value);
				}

				if ((changed.promise) && t8_value !== (t8_value = ctx.groups['cardCount'] - ctx.groups['landCount'])) {
					set_data(t8, t8_value);
				}

				if ((changed.promise) && t11_value !== (t11_value = ctx.groups['creatureCount'])) {
					set_data(t11, t11_value);
				}

				if (changed.highlightedCreature) {
					toggle_class(div2, "highlighted-creature", 'creature' == ctx.highlightedCreature);
				}

				if ((changed.promise) && t14_value !== (t14_value = ctx.groups['instantCount'])) {
					set_data(t14, t14_value);
				}

				if (changed.highlightedCreature) {
					toggle_class(div3, "highlighted-creature", 'instant' == ctx.highlightedCreature);
				}

				if ((changed.promise) && t17_value !== (t17_value = ctx.groups['sorceryCount'])) {
					set_data(t17, t17_value);
				}

				if (changed.highlightedCreature) {
					toggle_class(div4, "highlighted-creature", 'sorcery' == ctx.highlightedCreature);
				}

				if ((changed.promise) && t20_value !== (t20_value = ctx.groups['enchantmentCount'])) {
					set_data(t20, t20_value);
				}

				if (changed.highlightedCreature) {
					toggle_class(div5, "highlighted-creature", 'enchantment' == ctx.highlightedCreature);
				}

				if ((changed.promise) && t23_value !== (t23_value = ctx.groups['artifactCount'])) {
					set_data(t23, t23_value);
				}

				if (changed.highlightedCreature) {
					toggle_class(div6, "highlighted-creature", 'artifact' == ctx.highlightedCreature);
				}

				if ((changed.promise) && t26_value !== (t26_value = ctx.groups['planeswalkerCount'])) {
					set_data(t26, t26_value);
				}

				if (changed.highlightedCreature) {
					toggle_class(div7, "highlighted-creature", 'planeswalker' == ctx.highlightedCreature);
				}

				if (changed.promise || changed.highlightedCreature) {
					each_value_7 = ctx.groups['typeNames'];

					for (var i = 0; i < each_value_7.length; i += 1) {
						const child_ctx = get_each_context_7(ctx, each_value_7, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
						} else {
							each_blocks[i] = create_each_block_7(child_ctx);
							each_blocks[i].c();
							each_blocks[i].m(div8, null);
						}
					}

					for (; i < each_blocks.length; i += 1) {
						each_blocks[i].d(1);
					}
					each_blocks.length = each_value_7.length;
				}

				if ((changed.promise) && t30_value !== (t30_value = ctx.groups.cost.toFixed(2) + '$')) {
					set_data(t30, t30_value);
				}

				if (ctx.statisticsActive) {
					if (if_block) {
						if_block.p(changed, ctx);
					} else {
						if_block = create_if_block_9(ctx);
						if_block.c();
						if_block.m(if_block_anchor.parentNode, if_block_anchor);
					}
				} else if (if_block) {
					if_block.d(1);
					if_block = null;
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(h4);
					detach(t1);
					detach(div0);
					detach(t4);
					detach(div1);
					detach(t9);
					detach(div2);
					detach(t12);
					detach(div3);
					detach(t15);
					detach(div4);
					detach(t18);
					detach(div5);
					detach(t21);
					detach(div6);
					detach(t24);
					detach(div7);
					detach(t27);
					detach(div8);
				}

				destroy_each(each_blocks, detaching);

				if (detaching) {
					detach(t28);
					detach(div9);
					detach(t31);
				}

				if (if_block) if_block.d(detaching);

				if (detaching) {
					detach(if_block_anchor);
				}

				run_all(dispose);
			}
		};
	}

	// (979:12) {#each groups['typeNames'] as typeName}
	function create_each_block_7(ctx) {
		var div, t0_value = ctx.typeName, t0, t1, t2_value = ctx.groups['typeCounts'][ctx.typeName], t2, dispose;

		function click_handler_6() {
			return ctx.click_handler_6(ctx);
		}

		return {
			c: function create() {
				div = element("div");
				t0 = text(t0_value);
				t1 = text(": ");
				t2 = text(t2_value);
				div.className = "type-selector svelte-yxz9np";
				toggle_class(div, "highlighted-creature", ctx.typeName == ctx.highlightedCreature);
				add_location(div, file, 979, 14, 22102);
				dispose = listen(div, "click", click_handler_6);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
				append(div, t0);
				append(div, t1);
				append(div, t2);
			},

			p: function update_1(changed, new_ctx) {
				ctx = new_ctx;
				if ((changed.promise) && t0_value !== (t0_value = ctx.typeName)) {
					set_data(t0, t0_value);
				}

				if ((changed.promise) && t2_value !== (t2_value = ctx.groups['typeCounts'][ctx.typeName])) {
					set_data(t2, t2_value);
				}

				if ((changed.promise || changed.highlightedCreature)) {
					toggle_class(div, "highlighted-creature", ctx.typeName == ctx.highlightedCreature);
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}

				dispose();
			}
		};
	}

	// (992:10) {#if statisticsActive}
	function create_if_block_9(ctx) {
		var div20, h40, t1, div6, div0, t2_value = ctx.groups['mana'].blue, t2, t3, div1, t4_value = ctx.groups['mana'].black, t4, t5, div2, t6_value = ctx.groups['mana'].red, t6, t7, div3, t8_value = ctx.groups['mana'].white, t8, t9, div4, t10_value = ctx.groups['mana'].green, t10, t11, div5, t12_value = ctx.groups['mana'].colorless, t12, t13, h41, t15, div7, t16, t17_value = ctx.groups['mana'].generic, t17, t18, div8, t19, t20_value = ctx.groups['mana'].sum, t20, t21, div9, t22, t23_value = ctx.groups['averageMana'].toFixed(2), t23, t24, h42, t26, div16, div10, t27_value = (ctx.groups['manaProposal'].blue * ctx.groups['landCount']).toFixed(1), t27, t28, div11, t29_value = (ctx.groups['manaProposal'].black * ctx.groups['landCount']).toFixed(1), t29, t30, div12, t31_value = (ctx.groups['manaProposal'].red * ctx.groups['landCount']).toFixed(1), t31, t32, div13, t33_value = (ctx.groups['manaProposal'].white * ctx.groups['landCount']).toFixed(1), t33, t34, div14, t35_value = (ctx.groups['manaProposal'].green * ctx.groups['landCount']).toFixed(1), t35, t36, div15, t37_value = (ctx.groups['manaProposal'].colorless * ctx.groups['landCount']).toFixed(1), t37, t38, h43, t40, div19, div17, t41, div18;

		var each_value_6 = ctx.groups['manaCurve'];

		var each_blocks_1 = [];

		for (var i = 0; i < each_value_6.length; i += 1) {
			each_blocks_1[i] = create_each_block_6(get_each_context_6(ctx, each_value_6, i));
		}

		var each_value_5 = ctx.groups['manaCurve'];

		var each_blocks = [];

		for (var i = 0; i < each_value_5.length; i += 1) {
			each_blocks[i] = create_each_block_5(get_each_context_5(ctx, each_value_5, i));
		}

		return {
			c: function create() {
				div20 = element("div");
				h40 = element("h4");
				h40.textContent = "Devotion";
				t1 = space();
				div6 = element("div");
				div0 = element("div");
				t2 = text(t2_value);
				t3 = space();
				div1 = element("div");
				t4 = text(t4_value);
				t5 = space();
				div2 = element("div");
				t6 = text(t6_value);
				t7 = space();
				div3 = element("div");
				t8 = text(t8_value);
				t9 = space();
				div4 = element("div");
				t10 = text(t10_value);
				t11 = space();
				div5 = element("div");
				t12 = text(t12_value);
				t13 = space();
				h41 = element("h4");
				h41.textContent = "Generic Mana";
				t15 = space();
				div7 = element("div");
				t16 = text("Remaining generic mana costs:");
				t17 = text(t17_value);
				t18 = space();
				div8 = element("div");
				t19 = text("CMC-Mana-Sum:");
				t20 = text(t20_value);
				t21 = space();
				div9 = element("div");
				t22 = text("Average CMC per Nonland: ");
				t23 = text(t23_value);
				t24 = space();
				h42 = element("h4");
				h42.textContent = "Suggested Mana Distribution";
				t26 = space();
				div16 = element("div");
				div10 = element("div");
				t27 = text(t27_value);
				t28 = space();
				div11 = element("div");
				t29 = text(t29_value);
				t30 = space();
				div12 = element("div");
				t31 = text(t31_value);
				t32 = space();
				div13 = element("div");
				t33 = text(t33_value);
				t34 = space();
				div14 = element("div");
				t35 = text(t35_value);
				t36 = space();
				div15 = element("div");
				t37 = text(t37_value);
				t38 = space();
				h43 = element("h4");
				h43.textContent = "Mana Curve";
				t40 = space();
				div19 = element("div");
				div17 = element("div");

				for (var i = 0; i < each_blocks_1.length; i += 1) {
					each_blocks_1[i].c();
				}

				t41 = space();
				div18 = element("div");

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}
				h40.className = "svelte-yxz9np";
				add_location(h40, file, 993, 14, 22562);
				div0.className = "deck-value blue svelte-yxz9np";
				add_location(div0, file, 995, 16, 22640);
				div1.className = "deck-value black svelte-yxz9np";
				add_location(div1, file, 996, 16, 22714);
				div2.className = "deck-value red svelte-yxz9np";
				add_location(div2, file, 997, 16, 22790);
				div3.className = "deck-value white svelte-yxz9np";
				add_location(div3, file, 998, 16, 22862);
				div4.className = "deck-value green svelte-yxz9np";
				add_location(div4, file, 999, 16, 22938);
				div5.className = "deck-value colorless svelte-yxz9np";
				add_location(div5, file, 1000, 16, 23014);
				div6.className = "mana-devotion svelte-yxz9np";
				add_location(div6, file, 994, 14, 22595);
				h41.className = "svelte-yxz9np";
				add_location(h41, file, 1005, 14, 23158);
				add_location(div7, file, 1006, 14, 23195);
				add_location(div8, file, 1007, 14, 23275);
				add_location(div9, file, 1008, 14, 23335);
				h42.className = "svelte-yxz9np";
				add_location(h42, file, 1011, 14, 23455);
				div10.className = "deck-value blue svelte-yxz9np";
				add_location(div10, file, 1013, 16, 23552);
				div11.className = "deck-value black svelte-yxz9np";
				add_location(div11, file, 1016, 16, 23707);
				div12.className = "deck-value red svelte-yxz9np";
				add_location(div12, file, 1019, 16, 23864);
				div13.className = "deck-value white svelte-yxz9np";
				add_location(div13, file, 1022, 16, 24017);
				div14.className = "deck-value green svelte-yxz9np";
				add_location(div14, file, 1025, 16, 24174);
				div15.className = "deck-value colorless svelte-yxz9np";
				add_location(div15, file, 1028, 16, 24331);
				div16.className = "mana-proposal svelte-yxz9np";
				add_location(div16, file, 1012, 14, 23507);
				h43.className = "svelte-yxz9np";
				add_location(h43, file, 1032, 14, 24516);
				div17.className = "all-curves svelte-yxz9np";
				add_location(div17, file, 1034, 16, 24593);
				div18.className = "all-labels svelte-yxz9np";
				add_location(div18, file, 1051, 16, 25276);
				div19.className = "mana-curve svelte-yxz9np";
				add_location(div19, file, 1033, 14, 24551);
				div20.className = "statistics svelte-yxz9np";
				add_location(div20, file, 992, 12, 22522);
			},

			m: function mount(target, anchor) {
				insert(target, div20, anchor);
				append(div20, h40);
				append(div20, t1);
				append(div20, div6);
				append(div6, div0);
				append(div0, t2);
				append(div6, t3);
				append(div6, div1);
				append(div1, t4);
				append(div6, t5);
				append(div6, div2);
				append(div2, t6);
				append(div6, t7);
				append(div6, div3);
				append(div3, t8);
				append(div6, t9);
				append(div6, div4);
				append(div4, t10);
				append(div6, t11);
				append(div6, div5);
				append(div5, t12);
				append(div20, t13);
				append(div20, h41);
				append(div20, t15);
				append(div20, div7);
				append(div7, t16);
				append(div7, t17);
				append(div20, t18);
				append(div20, div8);
				append(div8, t19);
				append(div8, t20);
				append(div20, t21);
				append(div20, div9);
				append(div9, t22);
				append(div9, t23);
				append(div20, t24);
				append(div20, h42);
				append(div20, t26);
				append(div20, div16);
				append(div16, div10);
				append(div10, t27);
				append(div16, t28);
				append(div16, div11);
				append(div11, t29);
				append(div16, t30);
				append(div16, div12);
				append(div12, t31);
				append(div16, t32);
				append(div16, div13);
				append(div13, t33);
				append(div16, t34);
				append(div16, div14);
				append(div14, t35);
				append(div16, t36);
				append(div16, div15);
				append(div15, t37);
				append(div20, t38);
				append(div20, h43);
				append(div20, t40);
				append(div20, div19);
				append(div19, div17);

				for (var i = 0; i < each_blocks_1.length; i += 1) {
					each_blocks_1[i].m(div17, null);
				}

				append(div19, t41);
				append(div19, div18);

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(div18, null);
				}
			},

			p: function update_1(changed, ctx) {
				if ((changed.promise) && t2_value !== (t2_value = ctx.groups['mana'].blue)) {
					set_data(t2, t2_value);
				}

				if ((changed.promise) && t4_value !== (t4_value = ctx.groups['mana'].black)) {
					set_data(t4, t4_value);
				}

				if ((changed.promise) && t6_value !== (t6_value = ctx.groups['mana'].red)) {
					set_data(t6, t6_value);
				}

				if ((changed.promise) && t8_value !== (t8_value = ctx.groups['mana'].white)) {
					set_data(t8, t8_value);
				}

				if ((changed.promise) && t10_value !== (t10_value = ctx.groups['mana'].green)) {
					set_data(t10, t10_value);
				}

				if ((changed.promise) && t12_value !== (t12_value = ctx.groups['mana'].colorless)) {
					set_data(t12, t12_value);
				}

				if ((changed.promise) && t17_value !== (t17_value = ctx.groups['mana'].generic)) {
					set_data(t17, t17_value);
				}

				if ((changed.promise) && t20_value !== (t20_value = ctx.groups['mana'].sum)) {
					set_data(t20, t20_value);
				}

				if ((changed.promise) && t23_value !== (t23_value = ctx.groups['averageMana'].toFixed(2))) {
					set_data(t23, t23_value);
				}

				if ((changed.promise) && t27_value !== (t27_value = (ctx.groups['manaProposal'].blue * ctx.groups['landCount']).toFixed(1))) {
					set_data(t27, t27_value);
				}

				if ((changed.promise) && t29_value !== (t29_value = (ctx.groups['manaProposal'].black * ctx.groups['landCount']).toFixed(1))) {
					set_data(t29, t29_value);
				}

				if ((changed.promise) && t31_value !== (t31_value = (ctx.groups['manaProposal'].red * ctx.groups['landCount']).toFixed(1))) {
					set_data(t31, t31_value);
				}

				if ((changed.promise) && t33_value !== (t33_value = (ctx.groups['manaProposal'].white * ctx.groups['landCount']).toFixed(1))) {
					set_data(t33, t33_value);
				}

				if ((changed.promise) && t35_value !== (t35_value = (ctx.groups['manaProposal'].green * ctx.groups['landCount']).toFixed(1))) {
					set_data(t35, t35_value);
				}

				if ((changed.promise) && t37_value !== (t37_value = (ctx.groups['manaProposal'].colorless * ctx.groups['landCount']).toFixed(1))) {
					set_data(t37, t37_value);
				}

				if (changed.promise || changed.devotionHighlight || changed.getHeight) {
					each_value_6 = ctx.groups['manaCurve'];

					for (var i = 0; i < each_value_6.length; i += 1) {
						const child_ctx = get_each_context_6(ctx, each_value_6, i);

						if (each_blocks_1[i]) {
							each_blocks_1[i].p(changed, child_ctx);
						} else {
							each_blocks_1[i] = create_each_block_6(child_ctx);
							each_blocks_1[i].c();
							each_blocks_1[i].m(div17, null);
						}
					}

					for (; i < each_blocks_1.length; i += 1) {
						each_blocks_1[i].d(1);
					}
					each_blocks_1.length = each_value_6.length;
				}

				if (changed.promise || changed.devotionHighlight) {
					each_value_5 = ctx.groups['manaCurve'];

					for (var i = 0; i < each_value_5.length; i += 1) {
						const child_ctx = get_each_context_5(ctx, each_value_5, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
						} else {
							each_blocks[i] = create_each_block_5(child_ctx);
							each_blocks[i].c();
							each_blocks[i].m(div18, null);
						}
					}

					for (; i < each_blocks.length; i += 1) {
						each_blocks[i].d(1);
					}
					each_blocks.length = each_value_5.length;
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div20);
				}

				destroy_each(each_blocks_1, detaching);

				destroy_each(each_blocks, detaching);
			}
		};
	}

	// (1037:20) {#if mana > 0}
	function create_if_block_11(ctx) {
		var div1, div0, t_value = ctx.mana || '', t, div0_style_value, dispose;

		function click_handler_7() {
			return ctx.click_handler_7(ctx);
		}

		return {
			c: function create() {
				div1 = element("div");
				div0 = element("div");
				t = text(t_value);
				div0.className = "curve-element svelte-yxz9np";
				div0.style.cssText = div0_style_value = 'height:' + getHeight(ctx.mana, ctx.groups) + '%;';
				add_location(div0, file, 1041, 24, 24944);
				div1.className = "curve-wrapper svelte-yxz9np";
				toggle_class(div1, "highlighted", ctx.devotionHighlight == ctx.i);
				add_location(div1, file, 1037, 22, 24735);
				dispose = listen(div1, "click", click_handler_7);
			},

			m: function mount(target, anchor) {
				insert(target, div1, anchor);
				append(div1, div0);
				append(div0, t);
			},

			p: function update_1(changed, new_ctx) {
				ctx = new_ctx;
				if ((changed.promise) && t_value !== (t_value = ctx.mana || '')) {
					set_data(t, t_value);
				}

				if ((changed.promise) && div0_style_value !== (div0_style_value = 'height:' + getHeight(ctx.mana, ctx.groups) + '%;')) {
					div0.style.cssText = div0_style_value;
				}

				if (changed.devotionHighlight) {
					toggle_class(div1, "highlighted", ctx.devotionHighlight == ctx.i);
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div1);
				}

				dispose();
			}
		};
	}

	// (1036:18) {#each groups['manaCurve'] as mana, i}
	function create_each_block_6(ctx) {
		var if_block_anchor;

		var if_block = (ctx.mana > 0) && create_if_block_11(ctx);

		return {
			c: function create() {
				if (if_block) if_block.c();
				if_block_anchor = empty();
			},

			m: function mount(target, anchor) {
				if (if_block) if_block.m(target, anchor);
				insert(target, if_block_anchor, anchor);
			},

			p: function update_1(changed, ctx) {
				if (ctx.mana > 0) {
					if (if_block) {
						if_block.p(changed, ctx);
					} else {
						if_block = create_if_block_11(ctx);
						if_block.c();
						if_block.m(if_block_anchor.parentNode, if_block_anchor);
					}
				} else if (if_block) {
					if_block.d(1);
					if_block = null;
				}
			},

			d: function destroy(detaching) {
				if (if_block) if_block.d(detaching);

				if (detaching) {
					detach(if_block_anchor);
				}
			}
		};
	}

	// (1054:20) {#if mana > 0}
	function create_if_block_10(ctx) {
		var div, t, dispose;

		function click_handler_8() {
			return ctx.click_handler_8(ctx);
		}

		return {
			c: function create() {
				div = element("div");
				t = text(ctx.i);
				div.className = "curve-label svelte-yxz9np";
				toggle_class(div, "highlighted", ctx.devotionHighlight == ctx.i);
				add_location(div, file, 1054, 22, 25418);
				dispose = listen(div, "click", click_handler_8);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
				append(div, t);
			},

			p: function update_1(changed, new_ctx) {
				ctx = new_ctx;
				if (changed.devotionHighlight) {
					toggle_class(div, "highlighted", ctx.devotionHighlight == ctx.i);
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}

				dispose();
			}
		};
	}

	// (1053:18) {#each groups['manaCurve'] as mana, i}
	function create_each_block_5(ctx) {
		var if_block_anchor;

		var if_block = (ctx.mana > 0) && create_if_block_10(ctx);

		return {
			c: function create() {
				if (if_block) if_block.c();
				if_block_anchor = empty();
			},

			m: function mount(target, anchor) {
				if (if_block) if_block.m(target, anchor);
				insert(target, if_block_anchor, anchor);
			},

			p: function update_1(changed, ctx) {
				if (ctx.mana > 0) {
					if (if_block) {
						if_block.p(changed, ctx);
					} else {
						if_block = create_if_block_10(ctx);
						if_block.c();
						if_block.m(if_block_anchor.parentNode, if_block_anchor);
					}
				} else if (if_block) {
					if_block.d(1);
					if_block = null;
				}
			},

			d: function destroy(detaching) {
				if (if_block) if_block.d(detaching);

				if (detaching) {
					detach(if_block_anchor);
				}
			}
		};
	}

	// (929:22)             <div>loading: {progress}
	function create_pending_block_2(ctx) {
		var div, t0, t1, t2, t3;

		return {
			c: function create() {
				div = element("div");
				t0 = text("loading: ");
				t1 = text(ctx.progress);
				t2 = text("/");
				t3 = text(ctx.all);
				add_location(div, file, 930, 8, 20130);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
				append(div, t0);
				append(div, t1);
				append(div, t2);
				append(div, t3);
			},

			p: function update_1(changed, ctx) {
				if (changed.progress) {
					set_data(t1, ctx.progress);
				}

				if (changed.all) {
					set_data(t3, ctx.all);
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}
			}
		};
	}

	// (1250:4) {:catch error}
	function create_catch_block_1(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "ERROR, check your decklist for correct format or internet connection\r\n        brudi";
				div.className = "error";
				add_location(div, file, 1251, 6, 32253);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
			},

			p: noop,

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}
			}
		};
	}

	// (1158:4) {:then groups}
	function create_then_block_1(ctx) {
		var each_1_anchor;

		var each_value_1 = ctx.deckSeach || ctx.groups || [];

		var each_blocks = [];

		for (var i = 0; i < each_value_1.length; i += 1) {
			each_blocks[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
		}

		return {
			c: function create() {
				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}

				each_1_anchor = empty();
			},

			m: function mount(target, anchor) {
				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(target, anchor);
				}

				insert(target, each_1_anchor, anchor);
			},

			p: function update_1(changed, ctx) {
				if (changed.hiddenGroups || changed.deckSeach || changed.promise || changed.width || changed.height || changed.currentCardContext || changed.scaling || changed.format || changed.devotionHighlight || changed.highlightedCreature) {
					each_value_1 = ctx.deckSeach || ctx.groups || [];

					for (var i = 0; i < each_value_1.length; i += 1) {
						const child_ctx = get_each_context_1(ctx, each_value_1, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
						} else {
							each_blocks[i] = create_each_block_1(child_ctx);
							each_blocks[i].c();
							each_blocks[i].m(each_1_anchor.parentNode, each_1_anchor);
						}
					}

					for (; i < each_blocks.length; i += 1) {
						each_blocks[i].d(1);
					}
					each_blocks.length = each_value_1.length;
				}
			},

			d: function destroy(detaching) {
				destroy_each(each_blocks, detaching);

				if (detaching) {
					detach(each_1_anchor);
				}
			}
		};
	}

	// (1201:16) {#each { length: card.count > 4 ? 4 : card.count } as _, i}
	function create_each_block_4(ctx) {
		var img, img_src_value, img_alt_value, dispose;

		function mouseup_handler(...args) {
			return ctx.mouseup_handler(ctx, ...args);
		}

		function dblclick_handler() {
			return ctx.dblclick_handler(ctx);
		}

		return {
			c: function create() {
				img = element("img");
				img.className = "card svelte-yxz9np";
				img.style.cssText = 'margin-top: ' + ctx.i * 40 + 'px';
				img.src = img_src_value = ctx.card.url;
				img.alt = img_alt_value = ctx.card.name;
				img.width = ctx.width;
				img.height = ctx.height;
				toggle_class(img, "banned", ctx.card.data.legalities[ctx.format.value] !== 'legal');
				toggle_class(img, "highlighted", ctx.devotionHighlight == ctx.card.data.cmc);
				toggle_class(img, "type-highlight", ctx.highlightedCreature && ctx.card.data.type_line
	                        .toLowerCase()
	                        .includes(ctx.highlightedCreature));
				add_location(img, file, 1201, 18, 30402);

				dispose = [
					listen(img, "mouseup", stop_propagation(mouseup_handler)),
					listen(img, "dblclick", dblclick_handler)
				];
			},

			m: function mount(target, anchor) {
				insert(target, img, anchor);
			},

			p: function update_1(changed, new_ctx) {
				ctx = new_ctx;
				if ((changed.deckSeach || changed.promise) && img_src_value !== (img_src_value = ctx.card.url)) {
					img.src = img_src_value;
				}

				if ((changed.deckSeach || changed.promise) && img_alt_value !== (img_alt_value = ctx.card.name)) {
					img.alt = img_alt_value;
				}

				if (changed.width) {
					img.width = ctx.width;
				}

				if (changed.height) {
					img.height = ctx.height;
				}

				if ((changed.deckSeach || changed.promise || changed.format)) {
					toggle_class(img, "banned", ctx.card.data.legalities[ctx.format.value] !== 'legal');
				}

				if ((changed.devotionHighlight || changed.deckSeach || changed.promise)) {
					toggle_class(img, "highlighted", ctx.devotionHighlight == ctx.card.data.cmc);
				}

				if ((changed.highlightedCreature || changed.deckSeach || changed.promise)) {
					toggle_class(img, "type-highlight", ctx.highlightedCreature && ctx.card.data.type_line
	                        .toLowerCase()
	                        .includes(ctx.highlightedCreature));
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(img);
				}

				run_all(dispose);
			}
		};
	}

	// (1218:16) {#if card.data.legalities[format.value] !== 'legal'}
	function create_if_block_7(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "BANNED";
				div.className = "banned-text svelte-yxz9np";
				add_location(div, file, 1218, 18, 31240);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}
			}
		};
	}

	// (1221:16) {#if card.count > 4}
	function create_if_block_6(ctx) {
		var div, t0_value = ctx.card.count, t0, t1;

		return {
			c: function create() {
				div = element("div");
				t0 = text(t0_value);
				t1 = text("x");
				div.className = "count svelte-yxz9np";
				add_location(div, file, 1221, 18, 31358);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
				append(div, t0);
				append(div, t1);
			},

			p: function update_1(changed, ctx) {
				if ((changed.deckSeach || changed.promise) && t0_value !== (t0_value = ctx.card.count)) {
					set_data(t0, t0_value);
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}
			}
		};
	}

	// (1225:16) {#if scaling > 90}
	function create_if_block_5(ctx) {
		var div, t_value = ctx.card.data.prices.usd + '$' || '???', t;

		return {
			c: function create() {
				div = element("div");
				t = text(t_value);
				div.className = "price svelte-yxz9np";
				add_location(div, file, 1225, 18, 31477);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
				append(div, t);
			},

			p: function update_1(changed, ctx) {
				if ((changed.deckSeach || changed.promise) && t_value !== (t_value = ctx.card.data.prices.usd + '$' || '???')) {
					set_data(t, t_value);
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}
			}
		};
	}

	// (1229:16) {#if currentCardContext === card}
	function create_if_block_3(ctx) {
		var div;

		var each_value_3 = ctx.groups;

		var each_blocks = [];

		for (var i = 0; i < each_value_3.length; i += 1) {
			each_blocks[i] = create_each_block_3(get_each_context_3(ctx, each_value_3, i));
		}

		return {
			c: function create() {
				div = element("div");

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}
				div.className = "card-context-menu svelte-yxz9np";
				add_location(div, file, 1229, 18, 31635);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(div, null);
				}
			},

			p: function update_1(changed, ctx) {
				if (changed.deckSeach || changed.promise) {
					each_value_3 = ctx.groups;

					for (var i = 0; i < each_value_3.length; i += 1) {
						const child_ctx = get_each_context_3(ctx, each_value_3, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
						} else {
							each_blocks[i] = create_each_block_3(child_ctx);
							each_blocks[i].c();
							each_blocks[i].m(div, null);
						}
					}

					for (; i < each_blocks.length; i += 1) {
						each_blocks[i].d(1);
					}
					each_blocks.length = each_value_3.length;
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}

				destroy_each(each_blocks, detaching);
			}
		};
	}

	// (1233:22) {#if group.name != subGroup.name}
	function create_if_block_4(ctx) {
		var div, t_value = ctx.subGroup.name, t, dispose;

		function mousedown_handler(...args) {
			return ctx.mousedown_handler(ctx, ...args);
		}

		return {
			c: function create() {
				div = element("div");
				t = text(t_value);
				div.className = "card-context-entry svelte-yxz9np";
				add_location(div, file, 1233, 24, 31799);
				dispose = listen(div, "mousedown", mousedown_handler);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
				append(div, t);
			},

			p: function update_1(changed, new_ctx) {
				ctx = new_ctx;
				if ((changed.promise) && t_value !== (t_value = ctx.subGroup.name)) {
					set_data(t, t_value);
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}

				dispose();
			}
		};
	}

	// (1232:20) {#each groups as subGroup}
	function create_each_block_3(ctx) {
		var if_block_anchor;

		var if_block = (ctx.group.name != ctx.subGroup.name) && create_if_block_4(ctx);

		return {
			c: function create() {
				if (if_block) if_block.c();
				if_block_anchor = empty();
			},

			m: function mount(target, anchor) {
				if (if_block) if_block.m(target, anchor);
				insert(target, if_block_anchor, anchor);
			},

			p: function update_1(changed, ctx) {
				if (ctx.group.name != ctx.subGroup.name) {
					if (if_block) {
						if_block.p(changed, ctx);
					} else {
						if_block = create_if_block_4(ctx);
						if_block.c();
						if_block.m(if_block_anchor.parentNode, if_block_anchor);
					}
				} else if (if_block) {
					if_block.d(1);
					if_block = null;
				}
			},

			d: function destroy(detaching) {
				if (if_block) if_block.d(detaching);

				if (detaching) {
					detach(if_block_anchor);
				}
			}
		};
	}

	// (1189:12) {#each group.cards as card}
	function create_each_block_2(ctx) {
		var div1, div0, a, t0, a_href_value, t1, t2, t3, t4, t5, div1_style_value;

		var each_value_4 = { length: ctx.card.count > 4 ? 4 : ctx.card.count };

		var each_blocks = [];

		for (var i = 0; i < each_value_4.length; i += 1) {
			each_blocks[i] = create_each_block_4(get_each_context_4(ctx, each_value_4, i));
		}

		var if_block0 = (ctx.card.data.legalities[ctx.format.value] !== 'legal') && create_if_block_7(ctx);

		var if_block1 = (ctx.card.count > 4) && create_if_block_6(ctx);

		var if_block2 = (ctx.scaling > 90) && create_if_block_5(ctx);

		var if_block3 = (ctx.currentCardContext === ctx.card) && create_if_block_3(ctx);

		return {
			c: function create() {
				div1 = element("div");
				div0 = element("div");
				a = element("a");
				t0 = text("🛒");
				t1 = space();

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}

				t2 = space();
				if (if_block0) if_block0.c();
				t3 = space();
				if (if_block1) if_block1.c();
				t4 = space();
				if (if_block2) if_block2.c();
				t5 = space();
				if (if_block3) if_block3.c();
				a.className = "link svelte-yxz9np";
				a.href = a_href_value = ctx.card.data.purchase_uris.cardmarket;
				a.target = "_blank";
				add_location(a, file, 1193, 18, 30089);
				div0.className = "shoping svelte-yxz9np";
				add_location(div0, file, 1192, 16, 30048);
				div1.className = "entry svelte-yxz9np";
				div1.style.cssText = div1_style_value = 'width:' + ctx.width + 'px; height:' + (ctx.card.count <= 4 ? ctx.height + ((ctx.card.count || 1) - 1) * 40 : ctx.height + 3 * 40) + 'px;';
				add_location(div1, file, 1189, 14, 29850);
			},

			m: function mount(target, anchor) {
				insert(target, div1, anchor);
				append(div1, div0);
				append(div0, a);
				append(a, t0);
				append(div1, t1);

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(div1, null);
				}

				append(div1, t2);
				if (if_block0) if_block0.m(div1, null);
				append(div1, t3);
				if (if_block1) if_block1.m(div1, null);
				append(div1, t4);
				if (if_block2) if_block2.m(div1, null);
				append(div1, t5);
				if (if_block3) if_block3.m(div1, null);
			},

			p: function update_1(changed, ctx) {
				if ((changed.deckSeach || changed.promise) && a_href_value !== (a_href_value = ctx.card.data.purchase_uris.cardmarket)) {
					a.href = a_href_value;
				}

				if (changed.deckSeach || changed.promise || changed.width || changed.height || changed.format || changed.devotionHighlight || changed.highlightedCreature) {
					each_value_4 = { length: ctx.card.count > 4 ? 4 : ctx.card.count };

					for (var i = 0; i < each_value_4.length; i += 1) {
						const child_ctx = get_each_context_4(ctx, each_value_4, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
						} else {
							each_blocks[i] = create_each_block_4(child_ctx);
							each_blocks[i].c();
							each_blocks[i].m(div1, t2);
						}
					}

					for (; i < each_blocks.length; i += 1) {
						each_blocks[i].d(1);
					}
					each_blocks.length = each_value_4.length;
				}

				if (ctx.card.data.legalities[ctx.format.value] !== 'legal') {
					if (!if_block0) {
						if_block0 = create_if_block_7(ctx);
						if_block0.c();
						if_block0.m(div1, t3);
					}
				} else if (if_block0) {
					if_block0.d(1);
					if_block0 = null;
				}

				if (ctx.card.count > 4) {
					if (if_block1) {
						if_block1.p(changed, ctx);
					} else {
						if_block1 = create_if_block_6(ctx);
						if_block1.c();
						if_block1.m(div1, t4);
					}
				} else if (if_block1) {
					if_block1.d(1);
					if_block1 = null;
				}

				if (ctx.scaling > 90) {
					if (if_block2) {
						if_block2.p(changed, ctx);
					} else {
						if_block2 = create_if_block_5(ctx);
						if_block2.c();
						if_block2.m(div1, t5);
					}
				} else if (if_block2) {
					if_block2.d(1);
					if_block2 = null;
				}

				if (ctx.currentCardContext === ctx.card) {
					if (if_block3) {
						if_block3.p(changed, ctx);
					} else {
						if_block3 = create_if_block_3(ctx);
						if_block3.c();
						if_block3.m(div1, null);
					}
				} else if (if_block3) {
					if_block3.d(1);
					if_block3 = null;
				}

				if ((changed.width || changed.deckSeach || changed.promise || changed.height) && div1_style_value !== (div1_style_value = 'width:' + ctx.width + 'px; height:' + (ctx.card.count <= 4 ? ctx.height + ((ctx.card.count || 1) - 1) * 40 : ctx.height + 3 * 40) + 'px;')) {
					div1.style.cssText = div1_style_value;
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div1);
				}

				destroy_each(each_blocks, detaching);

				if (if_block0) if_block0.d();
				if (if_block1) if_block1.d();
				if (if_block2) if_block2.d();
				if (if_block3) if_block3.d();
			}
		};
	}

	// (1160:6) {#each deckSeach || groups || [] as group}
	function create_each_block_1(ctx) {
		var div11, div9, h2, t0_value = ctx.group.name + ' // ' + ctx.group.count || 'no name', t0, t1, button, t3, div8, div0, t4_value = ctx.group.mana.blue, t4, t5, div1, t6_value = ctx.group.mana.black, t6, t7, div2, t8_value = ctx.group.mana.red, t8, t9, div3, t10_value = ctx.group.mana.white, t10, t11, div4, t12_value = ctx.group.mana.green, t12, t13, div5, t14_value = ctx.group.mana.colorless, t14, t15, div6, t16_value = ctx.group.mana.sum, t16, t17, div7, t18_value = ctx.group.cost.toFixed(2) + '$', t18, t19, div10, dispose;

		function click_handler_9() {
			return ctx.click_handler_9(ctx);
		}

		var each_value_2 = ctx.group.cards;

		var each_blocks = [];

		for (var i = 0; i < each_value_2.length; i += 1) {
			each_blocks[i] = create_each_block_2(get_each_context_2(ctx, each_value_2, i));
		}

		return {
			c: function create() {
				div11 = element("div");
				div9 = element("div");
				h2 = element("h2");
				t0 = text(t0_value);
				t1 = space();
				button = element("button");
				button.textContent = "toggle";
				t3 = space();
				div8 = element("div");
				div0 = element("div");
				t4 = text(t4_value);
				t5 = space();
				div1 = element("div");
				t6 = text(t6_value);
				t7 = space();
				div2 = element("div");
				t8 = text(t8_value);
				t9 = space();
				div3 = element("div");
				t10 = text(t10_value);
				t11 = space();
				div4 = element("div");
				t12 = text(t12_value);
				t13 = space();
				div5 = element("div");
				t14 = text(t14_value);
				t15 = text("\r\n              \r\n              sum:\r\n              ");
				div6 = element("div");
				t16 = text(t16_value);
				t17 = space();
				div7 = element("div");
				t18 = text(t18_value);
				t19 = space();
				div10 = element("div");

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}
				h2.className = "svelte-yxz9np";
				add_location(h2, file, 1163, 12, 28684);
				add_location(button, file, 1164, 12, 28755);
				div0.className = "group-value blue svelte-yxz9np";
				add_location(div0, file, 1168, 14, 28914);
				div1.className = "group-value black svelte-yxz9np";
				add_location(div1, file, 1169, 14, 28983);
				div2.className = "group-value red svelte-yxz9np";
				add_location(div2, file, 1170, 14, 29054);
				div3.className = "group-value white svelte-yxz9np";
				add_location(div3, file, 1171, 14, 29121);
				div4.className = "group-value green svelte-yxz9np";
				add_location(div4, file, 1172, 14, 29192);
				div5.className = "group-value colorless svelte-yxz9np";
				add_location(div5, file, 1173, 14, 29263);
				div6.className = "group-value sum svelte-yxz9np";
				add_location(div6, file, 1177, 14, 29470);
				div7.className = "group-value group-cost svelte-yxz9np";
				add_location(div7, file, 1178, 14, 29537);
				div8.className = "group-statistics svelte-yxz9np";
				add_location(div8, file, 1167, 12, 28868);
				div9.className = "group-header svelte-yxz9np";
				add_location(div9, file, 1162, 10, 28644);
				div10.className = "group-content svelte-yxz9np";
				toggle_class(div10, "hidden", ctx.hiddenGroups.has(ctx.group.name));
				add_location(div10, file, 1184, 10, 29694);
				div11.className = "group";
				add_location(div11, file, 1160, 8, 28611);
				dispose = listen(button, "click", click_handler_9);
			},

			m: function mount(target, anchor) {
				insert(target, div11, anchor);
				append(div11, div9);
				append(div9, h2);
				append(h2, t0);
				append(div9, t1);
				append(div9, button);
				append(div9, t3);
				append(div9, div8);
				append(div8, div0);
				append(div0, t4);
				append(div8, t5);
				append(div8, div1);
				append(div1, t6);
				append(div8, t7);
				append(div8, div2);
				append(div2, t8);
				append(div8, t9);
				append(div8, div3);
				append(div3, t10);
				append(div8, t11);
				append(div8, div4);
				append(div4, t12);
				append(div8, t13);
				append(div8, div5);
				append(div5, t14);
				append(div8, t15);
				append(div8, div6);
				append(div6, t16);
				append(div8, t17);
				append(div8, div7);
				append(div7, t18);
				append(div11, t19);
				append(div11, div10);

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(div10, null);
				}
			},

			p: function update_1(changed, new_ctx) {
				ctx = new_ctx;
				if ((changed.deckSeach || changed.promise) && t0_value !== (t0_value = ctx.group.name + ' // ' + ctx.group.count || 'no name')) {
					set_data(t0, t0_value);
				}

				if ((changed.deckSeach || changed.promise) && t4_value !== (t4_value = ctx.group.mana.blue)) {
					set_data(t4, t4_value);
				}

				if ((changed.deckSeach || changed.promise) && t6_value !== (t6_value = ctx.group.mana.black)) {
					set_data(t6, t6_value);
				}

				if ((changed.deckSeach || changed.promise) && t8_value !== (t8_value = ctx.group.mana.red)) {
					set_data(t8, t8_value);
				}

				if ((changed.deckSeach || changed.promise) && t10_value !== (t10_value = ctx.group.mana.white)) {
					set_data(t10, t10_value);
				}

				if ((changed.deckSeach || changed.promise) && t12_value !== (t12_value = ctx.group.mana.green)) {
					set_data(t12, t12_value);
				}

				if ((changed.deckSeach || changed.promise) && t14_value !== (t14_value = ctx.group.mana.colorless)) {
					set_data(t14, t14_value);
				}

				if ((changed.deckSeach || changed.promise) && t16_value !== (t16_value = ctx.group.mana.sum)) {
					set_data(t16, t16_value);
				}

				if ((changed.deckSeach || changed.promise) && t18_value !== (t18_value = ctx.group.cost.toFixed(2) + '$')) {
					set_data(t18, t18_value);
				}

				if (changed.width || changed.deckSeach || changed.promise || changed.height || changed.currentCardContext || changed.scaling || changed.format || changed.devotionHighlight || changed.highlightedCreature) {
					each_value_2 = ctx.group.cards;

					for (var i = 0; i < each_value_2.length; i += 1) {
						const child_ctx = get_each_context_2(ctx, each_value_2, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
						} else {
							each_blocks[i] = create_each_block_2(child_ctx);
							each_blocks[i].c();
							each_blocks[i].m(div10, null);
						}
					}

					for (; i < each_blocks.length; i += 1) {
						each_blocks[i].d(1);
					}
					each_blocks.length = each_value_2.length;
				}

				if ((changed.hiddenGroups || changed.deckSeach || changed.promise)) {
					toggle_class(div10, "hidden", ctx.hiddenGroups.has(ctx.group.name));
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div11);
				}

				destroy_each(each_blocks, detaching);

				dispose();
			}
		};
	}

	// (1150:20)         <div class="loading-wrapper">          <div>loading: {progress}
	function create_pending_block_1(ctx) {
		var div4, div0, t0, t1, t2, t3, t4, div3, div1, t5, div2;

		return {
			c: function create() {
				div4 = element("div");
				div0 = element("div");
				t0 = text("loading: ");
				t1 = text(ctx.progress);
				t2 = text("/");
				t3 = text(ctx.all);
				t4 = space();
				div3 = element("div");
				div1 = element("div");
				t5 = space();
				div2 = element("div");
				add_location(div0, file, 1151, 8, 28391);
				div1.className = "svelte-yxz9np";
				add_location(div1, file, 1153, 10, 28473);
				div2.className = "svelte-yxz9np";
				add_location(div2, file, 1154, 10, 28492);
				div3.className = "lds-ripple svelte-yxz9np";
				add_location(div3, file, 1152, 8, 28437);
				div4.className = "loading-wrapper svelte-yxz9np";
				add_location(div4, file, 1150, 6, 28352);
			},

			m: function mount(target, anchor) {
				insert(target, div4, anchor);
				append(div4, div0);
				append(div0, t0);
				append(div0, t1);
				append(div0, t2);
				append(div0, t3);
				append(div4, t4);
				append(div4, div3);
				append(div3, div1);
				append(div3, t5);
				append(div3, div2);
			},

			p: function update_1(changed, ctx) {
				if (changed.progress) {
					set_data(t1, ctx.progress);
				}

				if (changed.all) {
					set_data(t3, ctx.all);
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div4);
				}
			}
		};
	}

	// (1371:4) {:catch error}
	function create_catch_block(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "ERROR, check your decklist for correct format or internet connection\r\n        brudi";
				div.className = "error";
				add_location(div, file, 1371, 6, 35766);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
			},

			p: noop,

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}
			}
		};
	}

	// (1330:4) {:then result}
	function create_then_block(ctx) {
		var if_block_anchor;

		function select_block_type(ctx) {
			if (ctx.result.code !== 'not_found' && ctx.result.data) return create_if_block;
			return create_else_block_1;
		}

		var current_block_type = select_block_type(ctx);
		var if_block = current_block_type(ctx);

		return {
			c: function create() {
				if_block.c();
				if_block_anchor = empty();
			},

			m: function mount(target, anchor) {
				if_block.m(target, anchor);
				insert(target, if_block_anchor, anchor);
			},

			p: function update_1(changed, ctx) {
				if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
					if_block.p(changed, ctx);
				} else {
					if_block.d(1);
					if_block = current_block_type(ctx);
					if (if_block) {
						if_block.c();
						if_block.m(if_block_anchor.parentNode, if_block_anchor);
					}
				}
			},

			d: function destroy(detaching) {
				if_block.d(detaching);

				if (detaching) {
					detach(if_block_anchor);
				}
			}
		};
	}

	// (1368:6) {:else}
	function create_else_block_1(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "No cards found";
				add_location(div, file, 1368, 8, 35700);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
			},

			p: noop,

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}
			}
		};
	}

	// (1332:6) {#if result.code !== 'not_found' && result.data}
	function create_if_block(ctx) {
		var div, t0, button, t1, button_disabled_value, dispose;

		var each_value = ctx.result.data;

		var each_blocks = [];

		for (var i = 0; i < each_value.length; i += 1) {
			each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
		}

		var each_1_else = null;

		if (!each_value.length) {
			each_1_else = create_else_block(ctx);
			each_1_else.c();
		}

		function click_handler_10() {
			return ctx.click_handler_10(ctx);
		}

		return {
			c: function create() {
				div = element("div");

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}

				t0 = space();
				button = element("button");
				t1 = text("next");
				div.className = "search-result svelte-yxz9np";
				add_location(div, file, 1332, 8, 34469);
				button.disabled = button_disabled_value = !ctx.result.has_more;
				add_location(button, file, 1362, 8, 35535);
				dispose = listen(button, "click", click_handler_10);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(div, null);
				}

				if (each_1_else) {
					each_1_else.m(div, null);
				}

				insert(target, t0, anchor);
				insert(target, button, anchor);
				append(button, t1);
			},

			p: function update_1(changed, new_ctx) {
				ctx = new_ctx;
				if (changed.width || changed.height || changed.scaling || changed.cardSearchPromise || changed.format) {
					each_value = ctx.result.data;

					for (var i = 0; i < each_value.length; i += 1) {
						const child_ctx = get_each_context(ctx, each_value, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
						} else {
							each_blocks[i] = create_each_block(child_ctx);
							each_blocks[i].c();
							each_blocks[i].m(div, null);
						}
					}

					for (; i < each_blocks.length; i += 1) {
						each_blocks[i].d(1);
					}
					each_blocks.length = each_value.length;
				}

				if (each_value.length) {
					if (each_1_else) {
						each_1_else.d(1);
						each_1_else = null;
					}
				} else if (!each_1_else) {
					each_1_else = create_else_block(ctx);
					each_1_else.c();
					each_1_else.m(div, null);
				}

				if ((changed.cardSearchPromise) && button_disabled_value !== (button_disabled_value = !ctx.result.has_more)) {
					button.disabled = button_disabled_value;
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}

				destroy_each(each_blocks, detaching);

				if (each_1_else) each_1_else.d();

				if (detaching) {
					detach(t0);
					detach(button);
				}

				dispose();
			}
		};
	}

	// (1359:10) {:else}
	function create_else_block(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "No cards found";
				add_location(div, file, 1359, 12, 35465);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}
			}
		};
	}

	// (1352:14) {#if card.legalities[format.value] !== 'legal'}
	function create_if_block_2(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "BANNED";
				div.className = "banned-text svelte-yxz9np";
				add_location(div, file, 1352, 16, 35224);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}
			}
		};
	}

	// (1355:14) {#if scaling > 90}
	function create_if_block_1(ctx) {
		var div, t_value = ctx.card.prices.usd + '$' || '???', t;

		return {
			c: function create() {
				div = element("div");
				t = text(t_value);
				div.className = "price svelte-yxz9np";
				add_location(div, file, 1355, 16, 35334);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
				append(div, t);
			},

			p: function update_1(changed, ctx) {
				if ((changed.cardSearchPromise) && t_value !== (t_value = ctx.card.prices.usd + '$' || '???')) {
					set_data(t, t_value);
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}
			}
		};
	}

	// (1334:10) {#each result.data as card}
	function create_each_block(ctx) {
		var div1, div0, a, t0, a_href_value, t1, img, img_src_value, img_alt_value, t2, t3, div1_style_value, dispose;

		function dblclick_handler_1() {
			return ctx.dblclick_handler_1(ctx);
		}

		var if_block0 = (ctx.card.legalities[ctx.format.value] !== 'legal') && create_if_block_2(ctx);

		var if_block1 = (ctx.scaling > 90) && create_if_block_1(ctx);

		return {
			c: function create() {
				div1 = element("div");
				div0 = element("div");
				a = element("a");
				t0 = text("🛒");
				t1 = space();
				img = element("img");
				t2 = space();
				if (if_block0) if_block0.c();
				t3 = space();
				if (if_block1) if_block1.c();
				a.className = "link svelte-yxz9np";
				a.href = a_href_value = ctx.card.cardmarket;
				a.target = "_blank";
				add_location(a, file, 1338, 16, 34711);
				div0.className = "shoping svelte-yxz9np";
				add_location(div0, file, 1337, 14, 34672);
				img.className = "card svelte-yxz9np";
				img.src = img_src_value = ctx.card.url;
				img.alt = img_alt_value = ctx.card.name;
				img.width = ctx.width;
				img.height = ctx.height;
				toggle_class(img, "banned", ctx.card.legalities[ctx.format.value] !== 'legal');
				add_location(img, file, 1342, 14, 34855);
				div1.className = "entry svelte-yxz9np";
				div1.style.cssText = div1_style_value = 'width:' + ctx.width + 'px; height:' + ctx.height + 'px;';
				add_location(div1, file, 1334, 12, 34549);
				dispose = listen(img, "dblclick", dblclick_handler_1);
			},

			m: function mount(target, anchor) {
				insert(target, div1, anchor);
				append(div1, div0);
				append(div0, a);
				append(a, t0);
				append(div1, t1);
				append(div1, img);
				append(div1, t2);
				if (if_block0) if_block0.m(div1, null);
				append(div1, t3);
				if (if_block1) if_block1.m(div1, null);
			},

			p: function update_1(changed, new_ctx) {
				ctx = new_ctx;
				if ((changed.cardSearchPromise) && a_href_value !== (a_href_value = ctx.card.cardmarket)) {
					a.href = a_href_value;
				}

				if ((changed.cardSearchPromise) && img_src_value !== (img_src_value = ctx.card.url)) {
					img.src = img_src_value;
				}

				if ((changed.cardSearchPromise) && img_alt_value !== (img_alt_value = ctx.card.name)) {
					img.alt = img_alt_value;
				}

				if (changed.width) {
					img.width = ctx.width;
				}

				if (changed.height) {
					img.height = ctx.height;
				}

				if ((changed.cardSearchPromise || changed.format)) {
					toggle_class(img, "banned", ctx.card.legalities[ctx.format.value] !== 'legal');
				}

				if (ctx.card.legalities[ctx.format.value] !== 'legal') {
					if (!if_block0) {
						if_block0 = create_if_block_2(ctx);
						if_block0.c();
						if_block0.m(div1, t3);
					}
				} else if (if_block0) {
					if_block0.d(1);
					if_block0 = null;
				}

				if (ctx.scaling > 90) {
					if (if_block1) {
						if_block1.p(changed, ctx);
					} else {
						if_block1 = create_if_block_1(ctx);
						if_block1.c();
						if_block1.m(div1, null);
					}
				} else if (if_block1) {
					if_block1.d(1);
					if_block1 = null;
				}

				if ((changed.width || changed.height) && div1_style_value !== (div1_style_value = 'width:' + ctx.width + 'px; height:' + ctx.height + 'px;')) {
					div1.style.cssText = div1_style_value;
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div1);
				}

				if (if_block0) if_block0.d();
				if (if_block1) if_block1.d();
				dispose();
			}
		};
	}

	// (1323:30)         <div class="loading-wrapper">          <div class="lds-ripple">            <div />            <div />          </div>        </div>      {:then result}
	function create_pending_block(ctx) {
		var div3, div2, div0, t, div1;

		return {
			c: function create() {
				div3 = element("div");
				div2 = element("div");
				div0 = element("div");
				t = space();
				div1 = element("div");
				div0.className = "svelte-yxz9np";
				add_location(div0, file, 1325, 10, 34325);
				div1.className = "svelte-yxz9np";
				add_location(div1, file, 1326, 10, 34344);
				div2.className = "lds-ripple svelte-yxz9np";
				add_location(div2, file, 1324, 8, 34289);
				div3.className = "loading-wrapper svelte-yxz9np";
				add_location(div3, file, 1323, 6, 34250);
			},

			m: function mount(target, anchor) {
				insert(target, div3, anchor);
				append(div3, div2);
				append(div2, div0);
				append(div2, t);
				append(div2, div1);
			},

			p: noop,

			d: function destroy(detaching) {
				if (detaching) {
					detach(div3);
				}
			}
		};
	}

	function create_fragment(ctx) {
		var div19, div4, div3, div0, t1, t2, promise_1, t3, select, option0, option1, option2, option3, option4, option5, option6, option7, option8, option9, option10, option11, option12, t17, div1, t18, input0, t19, div2, t20, input1, input1_value_value, t21, button0, t23, button1, t24_value = ctx.statisticsActive ? 'hide statistics' : 'show statistics', t24, t25, button2, t27, button3, t29, button4, t31, button5, t33, textarea, t34, div5, promise_2, t35, div18, div6, t37, div17, div7, t38, input2, t39, div8, t40, input3, t41, div9, t42, input4, t43, div16, t44, div10, input5, t45, div11, input6, t46, div12, input7, t47, div13, input8, t48, div14, input9, t49, div15, input10, t50, button6, t52, promise_3, dispose;

		var if_block = (ctx.helpActive) && create_if_block_12(ctx);

		let info = {
			ctx,
			current: null,
			pending: create_pending_block_2,
			then: create_then_block_2,
			catch: create_catch_block_2,
			value: 'groups',
			error: 'error'
		};

		handle_promise(promise_1 = ctx.promise, info);

		let info_1 = {
			ctx,
			current: null,
			pending: create_pending_block_1,
			then: create_then_block_1,
			catch: create_catch_block_1,
			value: 'groups',
			error: 'error'
		};

		handle_promise(promise_2 = ctx.promise, info_1);

		let info_2 = {
			ctx,
			current: null,
			pending: create_pending_block,
			then: create_then_block,
			catch: create_catch_block,
			value: 'result',
			error: 'error'
		};

		handle_promise(promise_3 = ctx.cardSearchPromise, info_2);

		return {
			c: function create() {
				div19 = element("div");
				div4 = element("div");
				div3 = element("div");
				div0 = element("div");
				div0.textContent = "?";
				t1 = space();
				if (if_block) if_block.c();
				t2 = space();

				info.block.c();

				t3 = text("\r\n      Format:\r\n      ");
				select = element("select");
				option0 = element("option");
				option0.textContent = "commander";
				option1 = element("option");
				option1.textContent = "brawl";
				option2 = element("option");
				option2.textContent = "duel";
				option3 = element("option");
				option3.textContent = "future";
				option4 = element("option");
				option4.textContent = "historic";
				option5 = element("option");
				option5.textContent = "legacy";
				option6 = element("option");
				option6.textContent = "modern";
				option7 = element("option");
				option7.textContent = "oldschool";
				option8 = element("option");
				option8.textContent = "pauper";
				option9 = element("option");
				option9.textContent = "penny";
				option10 = element("option");
				option10.textContent = "pioneer";
				option11 = element("option");
				option11.textContent = "standard";
				option12 = element("option");
				option12.textContent = "vintage";
				t17 = space();
				div1 = element("div");
				t18 = text("Scale:\r\n        ");
				input0 = element("input");
				t19 = space();
				div2 = element("div");
				t20 = text("Save :\r\n        ");
				input1 = element("input");
				t21 = space();
				button0 = element("button");
				button0.textContent = "save";
				t23 = space();
				button1 = element("button");
				t24 = text(t24_value);
				t25 = space();
				button2 = element("button");
				button2.textContent = "sort";
				t27 = space();
				button3 = element("button");
				button3.textContent = "clean copy";
				t29 = space();
				button4 = element("button");
				button4.textContent = "share";
				t31 = space();
				button5 = element("button");
				button5.textContent = "refresh";
				t33 = space();
				textarea = element("textarea");
				t34 = space();
				div5 = element("div");

				info_1.block.c();

				t35 = space();
				div18 = element("div");
				div6 = element("div");
				div6.textContent = "x";
				t37 = space();
				div17 = element("div");
				div7 = element("div");
				t38 = text("Name:\r\n        ");
				input2 = element("input");
				t39 = space();
				div8 = element("div");
				t40 = text("Text:\r\n        ");
				input3 = element("input");
				t41 = space();
				div9 = element("div");
				t42 = text("Type:\r\n        ");
				input4 = element("input");
				t43 = space();
				div16 = element("div");
				t44 = text("Commander-Colors:\r\n        ");
				div10 = element("div");
				input5 = element("input");
				t45 = space();
				div11 = element("div");
				input6 = element("input");
				t46 = space();
				div12 = element("div");
				input7 = element("input");
				t47 = space();
				div13 = element("div");
				input8 = element("input");
				t48 = space();
				div14 = element("div");
				input9 = element("input");
				t49 = space();
				div15 = element("div");
				input10 = element("input");
				t50 = space();
				button6 = element("button");
				button6.textContent = "search";
				t52 = space();

				info_2.block.c();
				div0.className = "help-symbol svelte-yxz9np";
				add_location(div0, file, 910, 6, 19423);
				option0.selected = true;
				option0.__value = "commander";
				option0.value = option0.__value;
				add_location(option0, file, 1083, 8, 26259);
				option1.__value = "brawl";
				option1.value = option1.__value;
				add_location(option1, file, 1084, 8, 26304);
				option2.__value = "duel";
				option2.value = option2.__value;
				add_location(option2, file, 1085, 8, 26336);
				option3.__value = "future";
				option3.value = option3.__value;
				add_location(option3, file, 1086, 8, 26367);
				option4.__value = "historic";
				option4.value = option4.__value;
				add_location(option4, file, 1087, 8, 26400);
				option5.__value = "legacy";
				option5.value = option5.__value;
				add_location(option5, file, 1088, 8, 26435);
				option6.__value = "modern";
				option6.value = option6.__value;
				add_location(option6, file, 1089, 8, 26468);
				option7.__value = "oldschool";
				option7.value = option7.__value;
				add_location(option7, file, 1090, 8, 26501);
				option8.__value = "pauper";
				option8.value = option8.__value;
				add_location(option8, file, 1091, 8, 26537);
				option9.__value = "penny";
				option9.value = option9.__value;
				add_location(option9, file, 1092, 8, 26570);
				option10.__value = "pioneer";
				option10.value = option10.__value;
				add_location(option10, file, 1093, 8, 26602);
				option11.__value = "standard";
				option11.value = option11.__value;
				add_location(option11, file, 1094, 8, 26636);
				option12.__value = "vintage";
				option12.value = option12.__value;
				add_location(option12, file, 1095, 8, 26671);
				select.title = "select the legality checker";
				add_location(select, file, 1078, 6, 26114);
				attr(input0, "type", "range");
				input0.min = "25";
				input0.max = "100";
				input0.title = "scales the card size in the right view";
				add_location(input0, file, 1099, 8, 26774);
				div1.className = "slidecontainer";
				add_location(div1, file, 1097, 6, 26720);
				input1.value = input1_value_value = ctx.Cookies.get('deckName') || 'unknown_deck';
				input1.title = "The name of the deck for saving";
				add_location(input1, file, 1108, 8, 27014);
				button0.title = "this will download you a file, called like you provide in the\r\n          deck";
				add_location(button0, file, 1113, 8, 27219);
				div2.className = "save-container";
				add_location(div2, file, 1106, 6, 26960);
				button1.title = "toggles the visibility of the statisticks";
				add_location(button1, file, 1120, 6, 27412);
				button2.title = "this sorts the deck to lands spells and creatures -NOTE: your\r\n        groups will be replaced";
				add_location(button2, file, 1125, 6, 27609);
				button3.title = "this copies the deck without groups and stuff to your clipboard";
				add_location(button3, file, 1131, 6, 27803);
				button4.title = "copies a string to your clipboard, that shares this deck with\r\n        others";
				add_location(button4, file, 1136, 6, 27966);
				add_location(button5, file, 1143, 6, 28141);
				div3.className = "help svelte-yxz9np";
				add_location(div3, file, 909, 4, 19397);
				textarea.className = "input svelte-yxz9np";
				add_location(textarea, file, 1145, 4, 28201);
				div4.className = "controls svelte-yxz9np";
				add_location(div4, file, 908, 2, 19369);
				div5.className = "display svelte-yxz9np";
				add_location(div5, file, 1148, 2, 28281);
				div6.className = "toggle-search svelte-yxz9np";
				add_location(div6, file, 1259, 4, 32471);
				add_location(input2, file, 1263, 8, 32621);
				div7.className = "search-param";
				add_location(div7, file, 1261, 6, 32570);
				add_location(input3, file, 1267, 8, 32722);
				div8.className = "search-param";
				add_location(div8, file, 1265, 6, 32671);
				add_location(input4, file, 1271, 8, 32823);
				div9.className = "search-param";
				add_location(div9, file, 1269, 6, 32772);
				attr(input5, "type", "checkbox");
				input5.className = "blue svelte-yxz9np";
				add_location(input5, file, 1277, 10, 32980);
				div10.className = "blue svelte-yxz9np";
				add_location(div10, file, 1276, 8, 32950);
				attr(input6, "type", "checkbox");
				input6.className = "black svelte-yxz9np";
				add_location(input6, file, 1284, 10, 33175);
				div11.className = "black svelte-yxz9np";
				add_location(div11, file, 1283, 8, 33144);
				attr(input7, "type", "checkbox");
				input7.className = "red svelte-yxz9np";
				add_location(input7, file, 1291, 10, 33370);
				div12.className = "red svelte-yxz9np";
				add_location(div12, file, 1290, 8, 33341);
				attr(input8, "type", "checkbox");
				input8.className = "white svelte-yxz9np";
				add_location(input8, file, 1298, 10, 33563);
				div13.className = "white svelte-yxz9np";
				add_location(div13, file, 1297, 8, 33532);
				attr(input9, "type", "checkbox");
				input9.className = "green svelte-yxz9np";
				add_location(input9, file, 1305, 10, 33760);
				div14.className = "green svelte-yxz9np";
				add_location(div14, file, 1304, 8, 33729);
				attr(input10, "type", "checkbox");
				input10.className = "colorless svelte-yxz9np";
				add_location(input10, file, 1312, 10, 33961);
				div15.className = "colorless svelte-yxz9np";
				add_location(div15, file, 1311, 8, 33926);
				div16.className = "search-param color-param svelte-yxz9np";
				add_location(div16, file, 1274, 6, 32875);
				add_location(button6, file, 1319, 6, 34150);
				div17.className = "search-params svelte-yxz9np";
				add_location(div17, file, 1260, 4, 32535);
				div18.className = "card-search svelte-yxz9np";
				toggle_class(div18, "hide", !ctx.cardSearchActive);
				add_location(div18, file, 1258, 2, 32409);
				div19.className = "content svelte-yxz9np";
				add_location(div19, file, 907, 0, 19344);

				dispose = [
					listen(window, "mouseup", ctx.onMainMouseDown),
					listen(window, "contextmenu", prevent_default(contextmenu_handler)),
					listen(window, "keyup", ctx.mainKeyUp),
					listen(window, "keydown", ctx.mainKeyDown),
					listen(div0, "click", ctx.openHelp),
					listen(select, "blur", ctx.reload),
					listen(select, "change", ctx.reload),
					listen(input0, "change", ctx.input0_change_input_handler),
					listen(input0, "input", ctx.input0_change_input_handler),
					listen(input1, "keyup", ctx.onDeckNameType),
					listen(button0, "click", ctx.saveDeck),
					listen(button1, "click", ctx.toggleStatistics),
					listen(button2, "click", ctx.sortDeckString),
					listen(button3, "click", ctx.copyDeck),
					listen(button4, "click", shareDeck),
					listen(button5, "click", ctx.reload),
					listen(textarea, "keyup", ctx.onTyping),
					listen(div6, "click", ctx.toggleSearch),
					listen(input5, "click", ctx.clearColorless),
					listen(input6, "click", ctx.clearColorless),
					listen(input7, "click", ctx.clearColorless),
					listen(input8, "click", ctx.clearColorless),
					listen(input9, "click", ctx.clearColorless),
					listen(input10, "click", ctx.clearForColorless),
					listen(button6, "click", ctx.searchCards)
				];
			},

			l: function claim(nodes) {
				throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
			},

			m: function mount(target, anchor) {
				insert(target, div19, anchor);
				append(div19, div4);
				append(div4, div3);
				append(div3, div0);
				append(div3, t1);
				if (if_block) if_block.m(div3, null);
				append(div3, t2);

				info.block.m(div3, info.anchor = null);
				info.mount = () => div3;
				info.anchor = t3;

				append(div3, t3);
				append(div3, select);
				append(select, option0);
				append(select, option1);
				append(select, option2);
				append(select, option3);
				append(select, option4);
				append(select, option5);
				append(select, option6);
				append(select, option7);
				append(select, option8);
				append(select, option9);
				append(select, option10);
				append(select, option11);
				append(select, option12);
				add_binding_callback(() => ctx.select_binding(select, null));
				append(div3, t17);
				append(div3, div1);
				append(div1, t18);
				append(div1, input0);

				input0.value = ctx.scaling;

				append(div3, t19);
				append(div3, div2);
				append(div2, t20);
				append(div2, input1);
				add_binding_callback(() => ctx.input1_binding(input1, null));
				append(div2, t21);
				append(div2, button0);
				append(div3, t23);
				append(div3, button1);
				append(button1, t24);
				append(div3, t25);
				append(div3, button2);
				append(div3, t27);
				append(div3, button3);
				append(div3, t29);
				append(div3, button4);
				append(div3, t31);
				append(div3, button5);
				append(div4, t33);
				append(div4, textarea);
				add_binding_callback(() => ctx.textarea_binding(textarea, null));
				append(div19, t34);
				append(div19, div5);

				info_1.block.m(div5, info_1.anchor = null);
				info_1.mount = () => div5;
				info_1.anchor = null;

				add_binding_callback(() => ctx.div5_binding(div5, null));
				append(div19, t35);
				append(div19, div18);
				append(div18, div6);
				append(div18, t37);
				append(div18, div17);
				append(div17, div7);
				append(div7, t38);
				append(div7, input2);
				add_binding_callback(() => ctx.input2_binding(input2, null));
				append(div17, t39);
				append(div17, div8);
				append(div8, t40);
				append(div8, input3);
				add_binding_callback(() => ctx.input3_binding(input3, null));
				append(div17, t41);
				append(div17, div9);
				append(div9, t42);
				append(div9, input4);
				add_binding_callback(() => ctx.input4_binding(input4, null));
				append(div17, t43);
				append(div17, div16);
				append(div16, t44);
				append(div16, div10);
				append(div10, input5);
				add_binding_callback(() => ctx.input5_binding(input5, null));
				append(div16, t45);
				append(div16, div11);
				append(div11, input6);
				add_binding_callback(() => ctx.input6_binding(input6, null));
				append(div16, t46);
				append(div16, div12);
				append(div12, input7);
				add_binding_callback(() => ctx.input7_binding(input7, null));
				append(div16, t47);
				append(div16, div13);
				append(div13, input8);
				add_binding_callback(() => ctx.input8_binding(input8, null));
				append(div16, t48);
				append(div16, div14);
				append(div14, input9);
				add_binding_callback(() => ctx.input9_binding(input9, null));
				append(div16, t49);
				append(div16, div15);
				append(div15, input10);
				add_binding_callback(() => ctx.input10_binding(input10, null));
				append(div17, t50);
				append(div17, button6);
				append(div18, t52);

				info_2.block.m(div18, info_2.anchor = null);
				info_2.mount = () => div18;
				info_2.anchor = null;
			},

			p: function update_1(changed, new_ctx) {
				ctx = new_ctx;
				if (ctx.helpActive) {
					if (!if_block) {
						if_block = create_if_block_12(ctx);
						if_block.c();
						if_block.m(div3, t2);
					}
				} else if (if_block) {
					if_block.d(1);
					if_block = null;
				}

				info.ctx = ctx;

				if (('promise' in changed) && promise_1 !== (promise_1 = ctx.promise) && handle_promise(promise_1, info)) ; else {
					info.block.p(changed, assign(assign({}, ctx), info.resolved));
				}

				if (changed.items) {
					ctx.select_binding(null, select);
					ctx.select_binding(select, null);
				}
				if (changed.scaling) input0.value = ctx.scaling;
				if (changed.items) {
					ctx.input1_binding(null, input1);
					ctx.input1_binding(input1, null);
				}

				if ((changed.Cookies) && input1_value_value !== (input1_value_value = ctx.Cookies.get('deckName') || 'unknown_deck')) {
					input1.value = input1_value_value;
				}

				if ((changed.statisticsActive) && t24_value !== (t24_value = ctx.statisticsActive ? 'hide statistics' : 'show statistics')) {
					set_data(t24, t24_value);
				}

				if (changed.items) {
					ctx.textarea_binding(null, textarea);
					ctx.textarea_binding(textarea, null);
				}
				info_1.ctx = ctx;

				if (('promise' in changed) && promise_2 !== (promise_2 = ctx.promise) && handle_promise(promise_2, info_1)) ; else {
					info_1.block.p(changed, assign(assign({}, ctx), info_1.resolved));
				}

				if (changed.items) {
					ctx.div5_binding(null, div5);
					ctx.div5_binding(div5, null);
				}
				if (changed.items) {
					ctx.input2_binding(null, input2);
					ctx.input2_binding(input2, null);
				}
				if (changed.items) {
					ctx.input3_binding(null, input3);
					ctx.input3_binding(input3, null);
				}
				if (changed.items) {
					ctx.input4_binding(null, input4);
					ctx.input4_binding(input4, null);
				}
				if (changed.items) {
					ctx.input5_binding(null, input5);
					ctx.input5_binding(input5, null);
				}
				if (changed.items) {
					ctx.input6_binding(null, input6);
					ctx.input6_binding(input6, null);
				}
				if (changed.items) {
					ctx.input7_binding(null, input7);
					ctx.input7_binding(input7, null);
				}
				if (changed.items) {
					ctx.input8_binding(null, input8);
					ctx.input8_binding(input8, null);
				}
				if (changed.items) {
					ctx.input9_binding(null, input9);
					ctx.input9_binding(input9, null);
				}
				if (changed.items) {
					ctx.input10_binding(null, input10);
					ctx.input10_binding(input10, null);
				}
				info_2.ctx = ctx;

				if (('cardSearchPromise' in changed) && promise_3 !== (promise_3 = ctx.cardSearchPromise) && handle_promise(promise_3, info_2)) ; else {
					info_2.block.p(changed, assign(assign({}, ctx), info_2.resolved));
				}

				if (changed.cardSearchActive) {
					toggle_class(div18, "hide", !ctx.cardSearchActive);
				}
			},

			i: noop,
			o: noop,

			d: function destroy(detaching) {
				if (detaching) {
					detach(div19);
				}

				if (if_block) if_block.d();

				info.block.d();
				info = null;

				ctx.select_binding(null, select);
				ctx.input1_binding(null, input1);
				ctx.textarea_binding(null, textarea);

				info_1.block.d();
				info_1 = null;

				ctx.div5_binding(null, div5);
				ctx.input2_binding(null, input2);
				ctx.input3_binding(null, input3);
				ctx.input4_binding(null, input4);
				ctx.input5_binding(null, input5);
				ctx.input6_binding(null, input6);
				ctx.input7_binding(null, input7);
				ctx.input8_binding(null, input8);
				ctx.input9_binding(null, input9);
				ctx.input10_binding(null, input10);

				info_2.block.d();
				info_2 = null;

				run_all(dispose);
			}
		};
	}

	const CARD_RATIO = 0.71764705882;

	let _height = 300;

	function shareDeck() {
	  /*   if (!input || !input.value) {
	    alert("The deck is empty, nothing copied");
	    return;
	  }
	  const compressed = LZUTF8.compress(input.value || "empty deck shared");
	  //window.history.pushState("page2", "Title", "?d=" + compressed);
	  console.log(`${window.location.pathname}?d=${compressed}`);

	  const el = document.createElement("textarea");
	  el.value = `${window.location.href}?d=${compressed}`;
	  document.body.appendChild(el);
	  el.select();
	  document.execCommand("copy");
	  document.body.removeChild(el);
	  alert("link to deck copied");*/
	}

	function getHeight(mana, groups) {
	  return 100 * (mana / Math.max(...groups["manaCurve"]));
	}

	function contextmenu_handler() {
		return false;
	}

	function instance($$self, $$props, $$invalidate) {
		// const { ipcRenderer } = require("electron");

	  const ipc = require("electron").ipcRenderer;
	  const CardLoader = new cardLoader(ipc);
	  // import LZUTF8 from "lzutf8";
	  //import Cookies from "js-cookie";

	  const Cookies = {
	    set: () => {},
	    get: () => {}
	  };
	  let _width = Math.floor(_height * CARD_RATIO);

	  let useCookies = true;

	  const oldSet = Cookies.set;
	  Cookies.set = (a, b) => {
	    if (useCookies) oldSet(a, b);
	    else {
	      console.log("saving disabled");
	    }
	  }; $$invalidate('Cookies', Cookies);

	  let height = _height;
	  let width = _width;
	  let cardSearchActive = true;
	  let statisticsActive = true;
	  let scaling = 100;

	  let display;

	  let devotionHighlight = -1;

	  function highlightDevotion(mana) {
	    if (devotionHighlight == mana) $$invalidate('devotionHighlight', devotionHighlight = -1);
	    else $$invalidate('devotionHighlight', devotionHighlight = mana + "");
	  }

	  let promise = new Promise(resolve => resolve([]));
	  let cardSearchPromise = new Promise(resolve =>
	    resolve({ data: [], has_more: false, total_cards: 0 })
	  );

	  let input;
	  let format;
	  let progress = 0;
	  let all = 0;

	  let spName;
	  let spText;
	  let spType;

	  let spEDHBlue;
	  let spEDHBlack;
	  let spEDHRed;
	  let spEDHWhite;
	  let spEDHGreen;
	  let spEDHColorless;

	  let deckSeach = null;
	  let deckSearchInput;

	  function changeDeckSearch(groups) {
	    if (!groups) returndeckSeach = null;
	    let s = deckSearchInput.value;
	    if (!s) var $$result = (deckSeach = null); $$invalidate('deckSeach', deckSeach); return $$result;

	    s = s
	      .trim()
	      .replace(/\s\s+/gm, " ")
	      .toLowerCase()
	      .replace(/\s/gm, "(.|\n)*");
	    /*    .split("+")
	      .join("|");*/
	    console.log("search:", s);
	    const result = [];
	    let count = 0;
	    const r = new RegExp(s, "gm");
	    for (let group of groups) {
	      for (let card of group.cards) {
	        if (!card || !card.data || !card.data.oracle_text) continue;
	        if (!card.data.oracle_text.toLowerCase().match(r)) continue;
	        count += card.count;
	        result.push(card);
	      }
	    }

	    $$invalidate('deckSeach', deckSeach = [
	      {
	        cards: result,
	        cost: 0,
	        count,
	        deck: {},
	        mana: {
	          black: 0,
	          blue: 0,
	          colorless: 0,
	          generic: 240,
	          green: 0,
	          red: 0,
	          sum: 240,
	          white: 0
	        },
	        manaCurve: [],
	        name: "search result"
	      }
	    ]);
	  }
	  function clearForColorless() {
	    spEDHBlue.checked = false; $$invalidate('spEDHBlue', spEDHBlue);
	    spEDHBlack.checked = false; $$invalidate('spEDHBlack', spEDHBlack);
	    spEDHRed.checked = false; $$invalidate('spEDHRed', spEDHRed);
	    spEDHWhite.checked = false; $$invalidate('spEDHWhite', spEDHWhite);
	    spEDHGreen.checked = false; $$invalidate('spEDHGreen', spEDHGreen);
	  }

	  function clearColorless() {
	    spEDHColorless.checked = false; $$invalidate('spEDHColorless', spEDHColorless);
	  }

	  function searchCards(nextUrl) {
	    if (typeof nextUrl == "string") {
	      $$invalidate('cardSearchPromise', cardSearchPromise = CardLoader.search(nextUrl));
	      return;
	    }
	    const colors = new Set();
	    if (spEDHColorless.checked) colors.add("C");
	    if (spEDHBlue.checked) colors.add("U");
	    if (spEDHBlack.checked) colors.add("B");
	    if (spEDHRed.checked) colors.add("R");
	    if (spEDHWhite.checked) colors.add("W");
	    if (spEDHGreen.checked) colors.add("G");

	    $$invalidate('cardSearchPromise', cardSearchPromise = CardLoader.search({
	      name: spName.value,
	      text: spText.value,
	      type: spType.value,
	      edhcolors: colors
	    }));
	  }

	  let currentCardContext = null;
	  function cardContextMenu(evt, card, groups) {
	    evt.preventDefault();
	    if (evt.which == 3 && groups.length > 1) {
	      // right click
	      $$invalidate('currentCardContext', currentCardContext = card);
	    }
	    return false;
	  }

	  function cardContextClick(evt, card, group) {
	    $$invalidate('currentCardContext', currentCardContext = null);
	    evt.stopPropagation();
	    evt.preventDefault();
	    let deck = input.value;

	    const r = new RegExp(`^.*${card.name}.*$`, "gmi");
	    deck = deck.replace(r, "");
	    let index = deck.indexOf(group.name);
	    if (index < 0) return;
	    index += group.name.length;

	    const insert = "\n" + card.count + " " + card.name;
	    deck = deck.slice(0, index) + insert + deck.slice(index);
	    input.value = deck; $$invalidate('input', input);
	    reload();
	  }

	  function onMainMouseDown(evt) {
	    $$invalidate('currentCardContext', currentCardContext = null);
	  }

	  let hiddenGroups = new Set();

	  function toggleGroupVisibility(group) {
	    if (hiddenGroups.has(group.name)) hiddenGroups.delete(group.name);
	    else hiddenGroups.add(group.name);

	    $$invalidate('hiddenGroups', hiddenGroups);
	  }

	  function sp(p, a) {
	    $$invalidate('progress', progress = p);
	    $$invalidate('all', all = a);
	  }

	  function resetDeckSearch() {
	    $$invalidate('deckSeach', deckSeach = null);
	    if (!deckSearchInput) return;
	    deckSearchInput.value = ""; $$invalidate('deckSearchInput', deckSearchInput);
	  }

	  function sortDeckString() {
	    $$invalidate('promise', promise = CardLoader.sort(input.value || "", (p, a) => {
	      resetDeckSearch();
	      sp(p, a);
	    })
	      .catch(e => {
	        console.error(e);
	        throw e;
	      })
	      .then(res => {
	        input.value = res; $$invalidate('input', input);
	        return update({ keyCode: 27 }, true);
	      }));
	  }

	  let deckNameInput;
	  function saveDeck() {
	    if (!deckNameInput) return alert("pls input a name");

	    // const filename = (deckNameInput.value || "unknown deck") + ".txt";

	    ipc.send("saveDeck", { deck: input.value, name: deckNameInput.value });

	    /*  const blob = new Blob([deck], { type: "text/plain;charset=utf-8" });
	    if (window.navigator.msSaveOrOpenBlob)
	      // IE10+
	      window.navigator.msSaveOrOpenBlob(blob, filename);
	    else {
	      // Others
	      var a = document.createElement("a"),
	        url = URL.createObjectURL(blob);
	      a.href = url;
	      a.download = filename;
	      document.body.appendChild(a);
	      a.click();
	      setTimeout(function() {
	        document.body.removeChild(a);
	        window.URL.revokeObjectURL(url);
	      }, 0);
	    }*/
	  }

	  function onDeckNameType() {
	    Cookies.set("deckName", deckNameInput.value);
	  }

	  function mainKeyDown(evt) {
	    if (evt.ctrlKey || evt.metaKey) {
	      switch (evt.which) {
	        case 83: // s
	          evt.preventDefault();
	          evt.stopPropagation();
	          saveDeck();
	          break;
	      }
	    }
	  }

	  function mainKeyUp(evt) {
	    update(evt);
	  }

	  async function update(evt) {
	    if (evt.keyCode !== 27) return;

	    let scrollPosition = 0;
	    if (display) {
	      scrollPosition = display.scrollTop;
	    }

	    $$invalidate('promise', promise = CardLoader.createDeck(input.value || "", (p, a) => {
	      resetDeckSearch();
	      sp(p, a);
	    })
	      .catch(e => {
	        console.error(e);
	        throw e;
	      })
	      .then(res => {
	        input.value = res.corrected; $$invalidate('input', input);
	        Cookies.set("deck", input.value);
	        setTimeout(() => {
	          display.scrollTop = scrollPosition; $$invalidate('display', display);
	        });
	        return res;
	      }));

	    return promise;
	  }
	  function reload() {
	    resetDeckSearch();
	    update({ keyCode: 27 });
	  }

	  function appendCard(name) {
	    if (!name) return;
	    resetDeckSearch();
	    input.value = input.value + "\n1 " + name; $$invalidate('input', input);
	    reload();
	  }

	  function remove(card) {
	    const r = new RegExp(`^.*${card.name}.*$`, "gm");

	    input.value = input.value.replace(r, "// " + card.count + " " + card.name); $$invalidate('input', input);
	    $$invalidate('promise', promise = CardLoader.createDeck(input.value || "", (p, a) =>
	      sp(p, a)
	    ).catch(e => {
	      console.error(e);
	      throw e;
	    }));
	  }

	  function copyDeck() {
	    const deck = input.value;

	    input.value = input.value.replace(/#.*|\/\/.*/gm, "\n"); $$invalidate('input', input);

	    input.select();

	    input.setSelectionRange(0, 99999);
	    document.execCommand("copy");

	    input.value = deck; $$invalidate('input', input);

	    alert("Deck copied to clipboard");
	  }

	  let helpActive = false;
	  onMount(async () => {
	    const defaultDeck = `#lands
mountain
2 plains
3 swamps
# main deck
20 blightsteel colossus`;

	    $$invalidate('useCookies', useCookies = Cookies.get("useCookies"));

	    const urlParams = new URLSearchParams(window.location.search);
	    const sharedDeck = urlParams.get("d");

	    let start = useCookies ? Cookies.get("deck") || defaultDeck : defaultDeck;

	    if (sharedDeck) {
	      $$invalidate('useCookies', useCookies = false);
	      /* const buffer = new Uint8Array(sharedDeck.split(","));
	    * const decompressed = LZUTF8.decompress(buffer);
	      if (decompressed) {
	        start = decompressed;
	      }*/
	    }

	    urlParams.delete("d");
	    window.history.replaceState({}, "", `${window.location.pathname}`);

	    //    window.history.replaceState(
	    //   {},
	    //   '',
	    //   `${window.location.pathname}?${params}${window.location.hash}`,
	    // )

	    //  helpActive = Cookies.get("helpActive") == "true";
	    // console.log("help:", Cookies.get("helpActive"));
	    $$invalidate('cardSearchActive', cardSearchActive = Cookies.get("cardSearchActive") == "true");
	    console.log("search:", Cookies.get("cardSearchActive"));
	    $$invalidate('statisticsActive', statisticsActive = Cookies.get("statisticsActive") == "true");
	    console.log("statistics:", Cookies.get("statisticsActive"));
	    input.value = start; $$invalidate('input', input);
	    reload();

	    ipc.on("loadDeck", (sender, data) => {
	      console.log("LOADING DECK", data.name);
	      input.value = data.deck; $$invalidate('input', input);
	      deckNameInput.value = (data.name || "").replace(".gdeck", ""); $$invalidate('deckNameInput', deckNameInput);
	      reload();
	    });

	    /* console.log("STSFSDF", Cookies.get("deck")),
	      (promise = CardLoader.createDeck(start, (p, a) => sp(p, a)));*/
	  });

	  function onTyping() {
	    Cookies.set("deck", input.value, { expires: 7 });
	  }

	  function openHelp() {
	    $$invalidate('helpActive', helpActive = !helpActive);
	    //  Cookies.set("helpActive", helpActive + "");
	  }

	  function toggleSearch() {
	    $$invalidate('cardSearchActive', cardSearchActive = !cardSearchActive);
	    Cookies.set("cardSearchActive", cardSearchActive + "");
	  }
	  function toggleStatistics() {
	    $$invalidate('statisticsActive', statisticsActive = !statisticsActive);
	    Cookies.set("statisticsActive", statisticsActive + "");
	  }

	  let highlightedCreature = "";
	  function highlightCreature(typeName) {
	    if (typeName == highlightedCreature) {
	      $$invalidate('highlightedCreature', highlightedCreature = "");
	      return;
	    } else {
	      $$invalidate('highlightedCreature', highlightedCreature = typeName);
	    }
	  }

		function click_handler() {
			return highlightCreature('creature');
		}

		function click_handler_1() {
			return highlightCreature('instant');
		}

		function click_handler_2() {
			return highlightCreature('sorcery');
		}

		function click_handler_3() {
			return highlightCreature('enchantment');
		}

		function click_handler_4() {
			return highlightCreature('artifact');
		}

		function click_handler_5() {
			return highlightCreature('planeswalker');
		}

		function click_handler_6({ typeName }) {
			return highlightCreature(typeName);
		}

		function click_handler_7({ i }) {
			return highlightDevotion(i);
		}

		function click_handler_8({ i }) {
			return highlightDevotion(i);
		}

		function input_1_binding($$node, check) {
			deckSearchInput = $$node;
			$$invalidate('deckSearchInput', deckSearchInput);
		}

		function keyup_handler({ groups }) {
			return changeDeckSearch(groups);
		}

		function select_binding($$node, check) {
			format = $$node;
			$$invalidate('format', format);
		}

		function input0_change_input_handler() {
			scaling = to_number(this.value);
			$$invalidate('scaling', scaling);
		}

		function input1_binding($$node, check) {
			deckNameInput = $$node;
			$$invalidate('deckNameInput', deckNameInput);
		}

		function textarea_binding($$node, check) {
			input = $$node;
			$$invalidate('input', input);
		}

		function click_handler_9({ group }) {
			return toggleGroupVisibility(group);
		}

		function mouseup_handler({ card, groups }, evt) {
			return cardContextMenu(evt, card, groups);
		}

		function dblclick_handler({ card }) {
			return remove(card);
		}

		function mousedown_handler({ card, subGroup }, evt) {
			return cardContextClick(evt, card, subGroup);
		}

		function div5_binding($$node, check) {
			display = $$node;
			$$invalidate('display', display);
		}

		function input2_binding($$node, check) {
			spName = $$node;
			$$invalidate('spName', spName);
		}

		function input3_binding($$node, check) {
			spText = $$node;
			$$invalidate('spText', spText);
		}

		function input4_binding($$node, check) {
			spType = $$node;
			$$invalidate('spType', spType);
		}

		function input5_binding($$node, check) {
			spEDHBlue = $$node;
			$$invalidate('spEDHBlue', spEDHBlue);
		}

		function input6_binding($$node, check) {
			spEDHBlack = $$node;
			$$invalidate('spEDHBlack', spEDHBlack);
		}

		function input7_binding($$node, check) {
			spEDHRed = $$node;
			$$invalidate('spEDHRed', spEDHRed);
		}

		function input8_binding($$node, check) {
			spEDHWhite = $$node;
			$$invalidate('spEDHWhite', spEDHWhite);
		}

		function input9_binding($$node, check) {
			spEDHGreen = $$node;
			$$invalidate('spEDHGreen', spEDHGreen);
		}

		function input10_binding($$node, check) {
			spEDHColorless = $$node;
			$$invalidate('spEDHColorless', spEDHColorless);
		}

		function dblclick_handler_1({ card }) {
			return appendCard(card.name);
		}

		function click_handler_10({ result }) {
			return searchCards(result.next_page);
		}

		$$self.$$.update = ($$dirty = { scaling: 1, _height: 1, _width: 1 }) => {
			if ($$dirty.scaling || $$dirty._height || $$dirty._width) { {
	        const s = Math.floor(scaling || 100) / 100;
	        $$invalidate('height', height = _height * s);
	        $$invalidate('width', width = _width * s);
	      } }
		};

		return {
			Cookies,
			height,
			width,
			cardSearchActive,
			statisticsActive,
			scaling,
			display,
			devotionHighlight,
			highlightDevotion,
			promise,
			cardSearchPromise,
			input,
			format,
			progress,
			all,
			spName,
			spText,
			spType,
			spEDHBlue,
			spEDHBlack,
			spEDHRed,
			spEDHWhite,
			spEDHGreen,
			spEDHColorless,
			deckSeach,
			deckSearchInput,
			changeDeckSearch,
			clearForColorless,
			clearColorless,
			searchCards,
			currentCardContext,
			cardContextMenu,
			cardContextClick,
			onMainMouseDown,
			hiddenGroups,
			toggleGroupVisibility,
			sortDeckString,
			deckNameInput,
			saveDeck,
			onDeckNameType,
			mainKeyDown,
			mainKeyUp,
			reload,
			appendCard,
			remove,
			copyDeck,
			helpActive,
			onTyping,
			openHelp,
			toggleSearch,
			toggleStatistics,
			highlightedCreature,
			highlightCreature,
			click_handler,
			click_handler_1,
			click_handler_2,
			click_handler_3,
			click_handler_4,
			click_handler_5,
			click_handler_6,
			click_handler_7,
			click_handler_8,
			input_1_binding,
			keyup_handler,
			select_binding,
			input0_change_input_handler,
			input1_binding,
			textarea_binding,
			click_handler_9,
			mouseup_handler,
			dblclick_handler,
			mousedown_handler,
			div5_binding,
			input2_binding,
			input3_binding,
			input4_binding,
			input5_binding,
			input6_binding,
			input7_binding,
			input8_binding,
			input9_binding,
			input10_binding,
			dblclick_handler_1,
			click_handler_10
		};
	}

	class Editor extends SvelteComponentDev {
		constructor(options) {
			super(options);
			if (!document.getElementById("svelte-yxz9np-style")) add_css();
			init(this, options, instance, create_fragment, safe_not_equal, []);
		}
	}
	Editor.$compile = {"vars":[{"name":"onMount","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"ipc","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"cl","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"CardLoader","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"Cookies","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":false,"referenced":true,"writable":false},{"name":"CARD_RATIO","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"_height","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":true},{"name":"_width","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":true},{"name":"useCookies","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":false,"writable":true},{"name":"enableSaving","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"oldSet","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"height","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"width","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"cardSearchActive","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"statisticsActive","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"scaling","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"display","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"devotionHighlight","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"highlightDevotion","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"promise","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"cardSearchPromise","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"input","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"format","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"progress","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"all","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"spName","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"spText","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"spType","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"spEDHBlue","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"spEDHBlack","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"spEDHRed","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"spEDHWhite","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"spEDHGreen","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"spEDHColorless","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"deckSeach","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"deckSearchInput","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"changeDeckSearch","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"clearForColorless","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"clearColorless","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"searchCards","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"currentCardContext","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"cardContextMenu","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"cardContextClick","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"onMainMouseDown","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"hiddenGroups","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"toggleGroupVisibility","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"sp","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"resetDeckSearch","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"sortDeckString","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"deckNameInput","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"saveDeck","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"onDeckNameType","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"mainKeyDown","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"mainKeyUp","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"update","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"reload","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"appendCard","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"remove","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"copyDeck","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"helpActive","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"saveAllToCookies","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"shareDeck","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"onTyping","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"getHeight","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"openHelp","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"toggleSearch","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"toggleStatistics","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"highlightedCreature","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"highlightCreature","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false}]};

	window.__dirname = "./";


	window.onload = function() {
	  const renderTarget = new Editor({
	    target: document.body,
	    props: {
	      test: "sdfdsf"
	    }
	  });
	};

}());
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWRpdG9yLWJ1bmRsZS5qcyIsInNvdXJjZXMiOlsibm9kZV9tb2R1bGVzL3N2ZWx0ZS9pbnRlcm5hbC5tanMiLCJjYXJkLWxvYWRlci5qcyIsImVkaXRvci5zdmVsdGUiLCJlZGl0b3ItbWFpbi5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJmdW5jdGlvbiBub29wKCkge31cblxuY29uc3QgaWRlbnRpdHkgPSB4ID0+IHg7XG5cbmZ1bmN0aW9uIGFzc2lnbih0YXIsIHNyYykge1xuXHRmb3IgKGNvbnN0IGsgaW4gc3JjKSB0YXJba10gPSBzcmNba107XG5cdHJldHVybiB0YXI7XG59XG5cbmZ1bmN0aW9uIGlzX3Byb21pc2UodmFsdWUpIHtcblx0cmV0dXJuIHZhbHVlICYmIHR5cGVvZiB2YWx1ZS50aGVuID09PSAnZnVuY3Rpb24nO1xufVxuXG5mdW5jdGlvbiBhZGRfbG9jYXRpb24oZWxlbWVudCwgZmlsZSwgbGluZSwgY29sdW1uLCBjaGFyKSB7XG5cdGVsZW1lbnQuX19zdmVsdGVfbWV0YSA9IHtcblx0XHRsb2M6IHsgZmlsZSwgbGluZSwgY29sdW1uLCBjaGFyIH1cblx0fTtcbn1cblxuZnVuY3Rpb24gcnVuKGZuKSB7XG5cdHJldHVybiBmbigpO1xufVxuXG5mdW5jdGlvbiBibGFua19vYmplY3QoKSB7XG5cdHJldHVybiBPYmplY3QuY3JlYXRlKG51bGwpO1xufVxuXG5mdW5jdGlvbiBydW5fYWxsKGZucykge1xuXHRmbnMuZm9yRWFjaChydW4pO1xufVxuXG5mdW5jdGlvbiBpc19mdW5jdGlvbih0aGluZykge1xuXHRyZXR1cm4gdHlwZW9mIHRoaW5nID09PSAnZnVuY3Rpb24nO1xufVxuXG5mdW5jdGlvbiBzYWZlX25vdF9lcXVhbChhLCBiKSB7XG5cdHJldHVybiBhICE9IGEgPyBiID09IGIgOiBhICE9PSBiIHx8ICgoYSAmJiB0eXBlb2YgYSA9PT0gJ29iamVjdCcpIHx8IHR5cGVvZiBhID09PSAnZnVuY3Rpb24nKTtcbn1cblxuZnVuY3Rpb24gbm90X2VxdWFsKGEsIGIpIHtcblx0cmV0dXJuIGEgIT0gYSA/IGIgPT0gYiA6IGEgIT09IGI7XG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlX3N0b3JlKHN0b3JlLCBuYW1lKSB7XG5cdGlmICghc3RvcmUgfHwgdHlwZW9mIHN0b3JlLnN1YnNjcmliZSAhPT0gJ2Z1bmN0aW9uJykge1xuXHRcdHRocm93IG5ldyBFcnJvcihgJyR7bmFtZX0nIGlzIG5vdCBhIHN0b3JlIHdpdGggYSAnc3Vic2NyaWJlJyBtZXRob2RgKTtcblx0fVxufVxuXG5mdW5jdGlvbiBzdWJzY3JpYmUoY29tcG9uZW50LCBzdG9yZSwgY2FsbGJhY2spIHtcblx0Y29tcG9uZW50LiQkLm9uX2Rlc3Ryb3kucHVzaChzdG9yZS5zdWJzY3JpYmUoY2FsbGJhY2spKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlX3Nsb3QoZGVmaW5pdGlvbiwgY3R4LCBmbikge1xuXHRpZiAoZGVmaW5pdGlvbikge1xuXHRcdGNvbnN0IHNsb3RfY3R4ID0gZ2V0X3Nsb3RfY29udGV4dChkZWZpbml0aW9uLCBjdHgsIGZuKTtcblx0XHRyZXR1cm4gZGVmaW5pdGlvblswXShzbG90X2N0eCk7XG5cdH1cbn1cblxuZnVuY3Rpb24gZ2V0X3Nsb3RfY29udGV4dChkZWZpbml0aW9uLCBjdHgsIGZuKSB7XG5cdHJldHVybiBkZWZpbml0aW9uWzFdXG5cdFx0PyBhc3NpZ24oe30sIGFzc2lnbihjdHguJCRzY29wZS5jdHgsIGRlZmluaXRpb25bMV0oZm4gPyBmbihjdHgpIDoge30pKSlcblx0XHQ6IGN0eC4kJHNjb3BlLmN0eDtcbn1cblxuZnVuY3Rpb24gZ2V0X3Nsb3RfY2hhbmdlcyhkZWZpbml0aW9uLCBjdHgsIGNoYW5nZWQsIGZuKSB7XG5cdHJldHVybiBkZWZpbml0aW9uWzFdXG5cdFx0PyBhc3NpZ24oe30sIGFzc2lnbihjdHguJCRzY29wZS5jaGFuZ2VkIHx8IHt9LCBkZWZpbml0aW9uWzFdKGZuID8gZm4oY2hhbmdlZCkgOiB7fSkpKVxuXHRcdDogY3R4LiQkc2NvcGUuY2hhbmdlZCB8fCB7fTtcbn1cblxuZnVuY3Rpb24gZXhjbHVkZV9pbnRlcm5hbF9wcm9wcyhwcm9wcykge1xuXHRjb25zdCByZXN1bHQgPSB7fTtcblx0Zm9yIChjb25zdCBrIGluIHByb3BzKSBpZiAoa1swXSAhPT0gJyQnKSByZXN1bHRba10gPSBwcm9wc1trXTtcblx0cmV0dXJuIHJlc3VsdDtcbn1cblxuY29uc3QgdGFza3MgPSBuZXcgU2V0KCk7XG5sZXQgcnVubmluZyA9IGZhbHNlO1xuXG5mdW5jdGlvbiBydW5fdGFza3MoKSB7XG5cdHRhc2tzLmZvckVhY2godGFzayA9PiB7XG5cdFx0aWYgKCF0YXNrWzBdKHdpbmRvdy5wZXJmb3JtYW5jZS5ub3coKSkpIHtcblx0XHRcdHRhc2tzLmRlbGV0ZSh0YXNrKTtcblx0XHRcdHRhc2tbMV0oKTtcblx0XHR9XG5cdH0pO1xuXG5cdHJ1bm5pbmcgPSB0YXNrcy5zaXplID4gMDtcblx0aWYgKHJ1bm5pbmcpIHJlcXVlc3RBbmltYXRpb25GcmFtZShydW5fdGFza3MpO1xufVxuXG5mdW5jdGlvbiBjbGVhcl9sb29wcygpIHtcblx0Ly8gZm9yIHRlc3RpbmcuLi5cblx0dGFza3MuZm9yRWFjaCh0YXNrID0+IHRhc2tzLmRlbGV0ZSh0YXNrKSk7XG5cdHJ1bm5pbmcgPSBmYWxzZTtcbn1cblxuZnVuY3Rpb24gbG9vcChmbikge1xuXHRsZXQgdGFzaztcblxuXHRpZiAoIXJ1bm5pbmcpIHtcblx0XHRydW5uaW5nID0gdHJ1ZTtcblx0XHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUocnVuX3Rhc2tzKTtcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0cHJvbWlzZTogbmV3IFByb21pc2UoZnVsZmlsID0+IHtcblx0XHRcdHRhc2tzLmFkZCh0YXNrID0gW2ZuLCBmdWxmaWxdKTtcblx0XHR9KSxcblx0XHRhYm9ydCgpIHtcblx0XHRcdHRhc2tzLmRlbGV0ZSh0YXNrKTtcblx0XHR9XG5cdH07XG59XG5cbmZ1bmN0aW9uIGFwcGVuZCh0YXJnZXQsIG5vZGUpIHtcblx0dGFyZ2V0LmFwcGVuZENoaWxkKG5vZGUpO1xufVxuXG5mdW5jdGlvbiBpbnNlcnQodGFyZ2V0LCBub2RlLCBhbmNob3IpIHtcblx0dGFyZ2V0Lmluc2VydEJlZm9yZShub2RlLCBhbmNob3IpO1xufVxuXG5mdW5jdGlvbiBkZXRhY2gobm9kZSkge1xuXHRub2RlLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQobm9kZSk7XG59XG5cbmZ1bmN0aW9uIGRldGFjaF9iZXR3ZWVuKGJlZm9yZSwgYWZ0ZXIpIHtcblx0d2hpbGUgKGJlZm9yZS5uZXh0U2libGluZyAmJiBiZWZvcmUubmV4dFNpYmxpbmcgIT09IGFmdGVyKSB7XG5cdFx0YmVmb3JlLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoYmVmb3JlLm5leHRTaWJsaW5nKTtcblx0fVxufVxuXG5mdW5jdGlvbiBkZXRhY2hfYmVmb3JlKGFmdGVyKSB7XG5cdHdoaWxlIChhZnRlci5wcmV2aW91c1NpYmxpbmcpIHtcblx0XHRhZnRlci5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGFmdGVyLnByZXZpb3VzU2libGluZyk7XG5cdH1cbn1cblxuZnVuY3Rpb24gZGV0YWNoX2FmdGVyKGJlZm9yZSkge1xuXHR3aGlsZSAoYmVmb3JlLm5leHRTaWJsaW5nKSB7XG5cdFx0YmVmb3JlLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoYmVmb3JlLm5leHRTaWJsaW5nKTtcblx0fVxufVxuXG5mdW5jdGlvbiBkZXN0cm95X2VhY2goaXRlcmF0aW9ucywgZGV0YWNoaW5nKSB7XG5cdGZvciAobGV0IGkgPSAwOyBpIDwgaXRlcmF0aW9ucy5sZW5ndGg7IGkgKz0gMSkge1xuXHRcdGlmIChpdGVyYXRpb25zW2ldKSBpdGVyYXRpb25zW2ldLmQoZGV0YWNoaW5nKTtcblx0fVxufVxuXG5mdW5jdGlvbiBlbGVtZW50KG5hbWUpIHtcblx0cmV0dXJuIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQobmFtZSk7XG59XG5cbmZ1bmN0aW9uIHN2Z19lbGVtZW50KG5hbWUpIHtcblx0cmV0dXJuIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUygnaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnLCBuYW1lKTtcbn1cblxuZnVuY3Rpb24gdGV4dChkYXRhKSB7XG5cdHJldHVybiBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZShkYXRhKTtcbn1cblxuZnVuY3Rpb24gc3BhY2UoKSB7XG5cdHJldHVybiB0ZXh0KCcgJyk7XG59XG5cbmZ1bmN0aW9uIGVtcHR5KCkge1xuXHRyZXR1cm4gdGV4dCgnJyk7XG59XG5cbmZ1bmN0aW9uIGxpc3Rlbihub2RlLCBldmVudCwgaGFuZGxlciwgb3B0aW9ucykge1xuXHRub2RlLmFkZEV2ZW50TGlzdGVuZXIoZXZlbnQsIGhhbmRsZXIsIG9wdGlvbnMpO1xuXHRyZXR1cm4gKCkgPT4gbm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKGV2ZW50LCBoYW5kbGVyLCBvcHRpb25zKTtcbn1cblxuZnVuY3Rpb24gcHJldmVudF9kZWZhdWx0KGZuKSB7XG5cdHJldHVybiBmdW5jdGlvbihldmVudCkge1xuXHRcdGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG5cdFx0cmV0dXJuIGZuLmNhbGwodGhpcywgZXZlbnQpO1xuXHR9O1xufVxuXG5mdW5jdGlvbiBzdG9wX3Byb3BhZ2F0aW9uKGZuKSB7XG5cdHJldHVybiBmdW5jdGlvbihldmVudCkge1xuXHRcdGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuXHRcdHJldHVybiBmbi5jYWxsKHRoaXMsIGV2ZW50KTtcblx0fTtcbn1cblxuZnVuY3Rpb24gYXR0cihub2RlLCBhdHRyaWJ1dGUsIHZhbHVlKSB7XG5cdGlmICh2YWx1ZSA9PSBudWxsKSBub2RlLnJlbW92ZUF0dHJpYnV0ZShhdHRyaWJ1dGUpO1xuXHRlbHNlIG5vZGUuc2V0QXR0cmlidXRlKGF0dHJpYnV0ZSwgdmFsdWUpO1xufVxuXG5mdW5jdGlvbiBzZXRfYXR0cmlidXRlcyhub2RlLCBhdHRyaWJ1dGVzKSB7XG5cdGZvciAoY29uc3Qga2V5IGluIGF0dHJpYnV0ZXMpIHtcblx0XHRpZiAoa2V5ID09PSAnc3R5bGUnKSB7XG5cdFx0XHRub2RlLnN0eWxlLmNzc1RleHQgPSBhdHRyaWJ1dGVzW2tleV07XG5cdFx0fSBlbHNlIGlmIChrZXkgaW4gbm9kZSkge1xuXHRcdFx0bm9kZVtrZXldID0gYXR0cmlidXRlc1trZXldO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRhdHRyKG5vZGUsIGtleSwgYXR0cmlidXRlc1trZXldKTtcblx0XHR9XG5cdH1cbn1cblxuZnVuY3Rpb24gc2V0X2N1c3RvbV9lbGVtZW50X2RhdGEobm9kZSwgcHJvcCwgdmFsdWUpIHtcblx0aWYgKHByb3AgaW4gbm9kZSkge1xuXHRcdG5vZGVbcHJvcF0gPSB2YWx1ZTtcblx0fSBlbHNlIHtcblx0XHRhdHRyKG5vZGUsIHByb3AsIHZhbHVlKTtcblx0fVxufVxuXG5mdW5jdGlvbiB4bGlua19hdHRyKG5vZGUsIGF0dHJpYnV0ZSwgdmFsdWUpIHtcblx0bm9kZS5zZXRBdHRyaWJ1dGVOUygnaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluaycsIGF0dHJpYnV0ZSwgdmFsdWUpO1xufVxuXG5mdW5jdGlvbiBnZXRfYmluZGluZ19ncm91cF92YWx1ZShncm91cCkge1xuXHRjb25zdCB2YWx1ZSA9IFtdO1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IGdyb3VwLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0aWYgKGdyb3VwW2ldLmNoZWNrZWQpIHZhbHVlLnB1c2goZ3JvdXBbaV0uX192YWx1ZSk7XG5cdH1cblx0cmV0dXJuIHZhbHVlO1xufVxuXG5mdW5jdGlvbiB0b19udW1iZXIodmFsdWUpIHtcblx0cmV0dXJuIHZhbHVlID09PSAnJyA/IHVuZGVmaW5lZCA6ICt2YWx1ZTtcbn1cblxuZnVuY3Rpb24gdGltZV9yYW5nZXNfdG9fYXJyYXkocmFuZ2VzKSB7XG5cdGNvbnN0IGFycmF5ID0gW107XG5cdGZvciAobGV0IGkgPSAwOyBpIDwgcmFuZ2VzLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0YXJyYXkucHVzaCh7IHN0YXJ0OiByYW5nZXMuc3RhcnQoaSksIGVuZDogcmFuZ2VzLmVuZChpKSB9KTtcblx0fVxuXHRyZXR1cm4gYXJyYXk7XG59XG5cbmZ1bmN0aW9uIGNoaWxkcmVuKGVsZW1lbnQpIHtcblx0cmV0dXJuIEFycmF5LmZyb20oZWxlbWVudC5jaGlsZE5vZGVzKTtcbn1cblxuZnVuY3Rpb24gY2xhaW1fZWxlbWVudChub2RlcywgbmFtZSwgYXR0cmlidXRlcywgc3ZnKSB7XG5cdGZvciAobGV0IGkgPSAwOyBpIDwgbm9kZXMubGVuZ3RoOyBpICs9IDEpIHtcblx0XHRjb25zdCBub2RlID0gbm9kZXNbaV07XG5cdFx0aWYgKG5vZGUubm9kZU5hbWUgPT09IG5hbWUpIHtcblx0XHRcdGZvciAobGV0IGogPSAwOyBqIDwgbm9kZS5hdHRyaWJ1dGVzLmxlbmd0aDsgaiArPSAxKSB7XG5cdFx0XHRcdGNvbnN0IGF0dHJpYnV0ZSA9IG5vZGUuYXR0cmlidXRlc1tqXTtcblx0XHRcdFx0aWYgKCFhdHRyaWJ1dGVzW2F0dHJpYnV0ZS5uYW1lXSkgbm9kZS5yZW1vdmVBdHRyaWJ1dGUoYXR0cmlidXRlLm5hbWUpO1xuXHRcdFx0fVxuXHRcdFx0cmV0dXJuIG5vZGVzLnNwbGljZShpLCAxKVswXTsgLy8gVE9ETyBzdHJpcCB1bndhbnRlZCBhdHRyaWJ1dGVzXG5cdFx0fVxuXHR9XG5cblx0cmV0dXJuIHN2ZyA/IHN2Z19lbGVtZW50KG5hbWUpIDogZWxlbWVudChuYW1lKTtcbn1cblxuZnVuY3Rpb24gY2xhaW1fdGV4dChub2RlcywgZGF0YSkge1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IG5vZGVzLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0Y29uc3Qgbm9kZSA9IG5vZGVzW2ldO1xuXHRcdGlmIChub2RlLm5vZGVUeXBlID09PSAzKSB7XG5cdFx0XHRub2RlLmRhdGEgPSBkYXRhO1xuXHRcdFx0cmV0dXJuIG5vZGVzLnNwbGljZShpLCAxKVswXTtcblx0XHR9XG5cdH1cblxuXHRyZXR1cm4gdGV4dChkYXRhKTtcbn1cblxuZnVuY3Rpb24gc2V0X2RhdGEodGV4dCwgZGF0YSkge1xuXHRkYXRhID0gJycgKyBkYXRhO1xuXHRpZiAodGV4dC5kYXRhICE9PSBkYXRhKSB0ZXh0LmRhdGEgPSBkYXRhO1xufVxuXG5mdW5jdGlvbiBzZXRfaW5wdXRfdHlwZShpbnB1dCwgdHlwZSkge1xuXHR0cnkge1xuXHRcdGlucHV0LnR5cGUgPSB0eXBlO1xuXHR9IGNhdGNoIChlKSB7XG5cdFx0Ly8gZG8gbm90aGluZ1xuXHR9XG59XG5cbmZ1bmN0aW9uIHNldF9zdHlsZShub2RlLCBrZXksIHZhbHVlKSB7XG5cdG5vZGUuc3R5bGUuc2V0UHJvcGVydHkoa2V5LCB2YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIHNlbGVjdF9vcHRpb24oc2VsZWN0LCB2YWx1ZSkge1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IHNlbGVjdC5vcHRpb25zLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0Y29uc3Qgb3B0aW9uID0gc2VsZWN0Lm9wdGlvbnNbaV07XG5cblx0XHRpZiAob3B0aW9uLl9fdmFsdWUgPT09IHZhbHVlKSB7XG5cdFx0XHRvcHRpb24uc2VsZWN0ZWQgPSB0cnVlO1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0fVxufVxuXG5mdW5jdGlvbiBzZWxlY3Rfb3B0aW9ucyhzZWxlY3QsIHZhbHVlKSB7XG5cdGZvciAobGV0IGkgPSAwOyBpIDwgc2VsZWN0Lm9wdGlvbnMubGVuZ3RoOyBpICs9IDEpIHtcblx0XHRjb25zdCBvcHRpb24gPSBzZWxlY3Qub3B0aW9uc1tpXTtcblx0XHRvcHRpb24uc2VsZWN0ZWQgPSB+dmFsdWUuaW5kZXhPZihvcHRpb24uX192YWx1ZSk7XG5cdH1cbn1cblxuZnVuY3Rpb24gc2VsZWN0X3ZhbHVlKHNlbGVjdCkge1xuXHRjb25zdCBzZWxlY3RlZF9vcHRpb24gPSBzZWxlY3QucXVlcnlTZWxlY3RvcignOmNoZWNrZWQnKSB8fCBzZWxlY3Qub3B0aW9uc1swXTtcblx0cmV0dXJuIHNlbGVjdGVkX29wdGlvbiAmJiBzZWxlY3RlZF9vcHRpb24uX192YWx1ZTtcbn1cblxuZnVuY3Rpb24gc2VsZWN0X211bHRpcGxlX3ZhbHVlKHNlbGVjdCkge1xuXHRyZXR1cm4gW10ubWFwLmNhbGwoc2VsZWN0LnF1ZXJ5U2VsZWN0b3JBbGwoJzpjaGVja2VkJyksIG9wdGlvbiA9PiBvcHRpb24uX192YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIGFkZF9yZXNpemVfbGlzdGVuZXIoZWxlbWVudCwgZm4pIHtcblx0aWYgKGdldENvbXB1dGVkU3R5bGUoZWxlbWVudCkucG9zaXRpb24gPT09ICdzdGF0aWMnKSB7XG5cdFx0ZWxlbWVudC5zdHlsZS5wb3NpdGlvbiA9ICdyZWxhdGl2ZSc7XG5cdH1cblxuXHRjb25zdCBvYmplY3QgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdvYmplY3QnKTtcblx0b2JqZWN0LnNldEF0dHJpYnV0ZSgnc3R5bGUnLCAnZGlzcGxheTogYmxvY2s7IHBvc2l0aW9uOiBhYnNvbHV0ZTsgdG9wOiAwOyBsZWZ0OiAwOyBoZWlnaHQ6IDEwMCU7IHdpZHRoOiAxMDAlOyBvdmVyZmxvdzogaGlkZGVuOyBwb2ludGVyLWV2ZW50czogbm9uZTsgei1pbmRleDogLTE7Jyk7XG5cdG9iamVjdC50eXBlID0gJ3RleHQvaHRtbCc7XG5cblx0bGV0IHdpbjtcblxuXHRvYmplY3Qub25sb2FkID0gKCkgPT4ge1xuXHRcdHdpbiA9IG9iamVjdC5jb250ZW50RG9jdW1lbnQuZGVmYXVsdFZpZXc7XG5cdFx0d2luLmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIGZuKTtcblx0fTtcblxuXHRpZiAoL1RyaWRlbnQvLnRlc3QobmF2aWdhdG9yLnVzZXJBZ2VudCkpIHtcblx0XHRlbGVtZW50LmFwcGVuZENoaWxkKG9iamVjdCk7XG5cdFx0b2JqZWN0LmRhdGEgPSAnYWJvdXQ6YmxhbmsnO1xuXHR9IGVsc2Uge1xuXHRcdG9iamVjdC5kYXRhID0gJ2Fib3V0OmJsYW5rJztcblx0XHRlbGVtZW50LmFwcGVuZENoaWxkKG9iamVjdCk7XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdGNhbmNlbDogKCkgPT4ge1xuXHRcdFx0d2luICYmIHdpbi5yZW1vdmVFdmVudExpc3RlbmVyICYmIHdpbi5yZW1vdmVFdmVudExpc3RlbmVyKCdyZXNpemUnLCBmbik7XG5cdFx0XHRlbGVtZW50LnJlbW92ZUNoaWxkKG9iamVjdCk7XG5cdFx0fVxuXHR9O1xufVxuXG5mdW5jdGlvbiB0b2dnbGVfY2xhc3MoZWxlbWVudCwgbmFtZSwgdG9nZ2xlKSB7XG5cdGVsZW1lbnQuY2xhc3NMaXN0W3RvZ2dsZSA/ICdhZGQnIDogJ3JlbW92ZSddKG5hbWUpO1xufVxuXG5mdW5jdGlvbiBjdXN0b21fZXZlbnQodHlwZSwgZGV0YWlsKSB7XG5cdGNvbnN0IGUgPSBkb2N1bWVudC5jcmVhdGVFdmVudCgnQ3VzdG9tRXZlbnQnKTtcblx0ZS5pbml0Q3VzdG9tRXZlbnQodHlwZSwgZmFsc2UsIGZhbHNlLCBkZXRhaWwpO1xuXHRyZXR1cm4gZTtcbn1cblxubGV0IHN0eWxlc2hlZXQ7XG5sZXQgYWN0aXZlID0gMDtcbmxldCBjdXJyZW50X3J1bGVzID0ge307XG5cbi8vIGh0dHBzOi8vZ2l0aHViLmNvbS9kYXJrc2t5YXBwL3N0cmluZy1oYXNoL2Jsb2IvbWFzdGVyL2luZGV4LmpzXG5mdW5jdGlvbiBoYXNoKHN0cikge1xuXHRsZXQgaGFzaCA9IDUzODE7XG5cdGxldCBpID0gc3RyLmxlbmd0aDtcblxuXHR3aGlsZSAoaS0tKSBoYXNoID0gKChoYXNoIDw8IDUpIC0gaGFzaCkgXiBzdHIuY2hhckNvZGVBdChpKTtcblx0cmV0dXJuIGhhc2ggPj4+IDA7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZV9ydWxlKG5vZGUsIGEsIGIsIGR1cmF0aW9uLCBkZWxheSwgZWFzZSwgZm4sIHVpZCA9IDApIHtcblx0Y29uc3Qgc3RlcCA9IDE2LjY2NiAvIGR1cmF0aW9uO1xuXHRsZXQga2V5ZnJhbWVzID0gJ3tcXG4nO1xuXG5cdGZvciAobGV0IHAgPSAwOyBwIDw9IDE7IHAgKz0gc3RlcCkge1xuXHRcdGNvbnN0IHQgPSBhICsgKGIgLSBhKSAqIGVhc2UocCk7XG5cdFx0a2V5ZnJhbWVzICs9IHAgKiAxMDAgKyBgJXske2ZuKHQsIDEgLSB0KX19XFxuYDtcblx0fVxuXG5cdGNvbnN0IHJ1bGUgPSBrZXlmcmFtZXMgKyBgMTAwJSB7JHtmbihiLCAxIC0gYil9fVxcbn1gO1xuXHRjb25zdCBuYW1lID0gYF9fc3ZlbHRlXyR7aGFzaChydWxlKX1fJHt1aWR9YDtcblxuXHRpZiAoIWN1cnJlbnRfcnVsZXNbbmFtZV0pIHtcblx0XHRpZiAoIXN0eWxlc2hlZXQpIHtcblx0XHRcdGNvbnN0IHN0eWxlID0gZWxlbWVudCgnc3R5bGUnKTtcblx0XHRcdGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQoc3R5bGUpO1xuXHRcdFx0c3R5bGVzaGVldCA9IHN0eWxlLnNoZWV0O1xuXHRcdH1cblxuXHRcdGN1cnJlbnRfcnVsZXNbbmFtZV0gPSB0cnVlO1xuXHRcdHN0eWxlc2hlZXQuaW5zZXJ0UnVsZShgQGtleWZyYW1lcyAke25hbWV9ICR7cnVsZX1gLCBzdHlsZXNoZWV0LmNzc1J1bGVzLmxlbmd0aCk7XG5cdH1cblxuXHRjb25zdCBhbmltYXRpb24gPSBub2RlLnN0eWxlLmFuaW1hdGlvbiB8fCAnJztcblx0bm9kZS5zdHlsZS5hbmltYXRpb24gPSBgJHthbmltYXRpb24gPyBgJHthbmltYXRpb259LCBgIDogYGB9JHtuYW1lfSAke2R1cmF0aW9ufW1zIGxpbmVhciAke2RlbGF5fW1zIDEgYm90aGA7XG5cblx0YWN0aXZlICs9IDE7XG5cdHJldHVybiBuYW1lO1xufVxuXG5mdW5jdGlvbiBkZWxldGVfcnVsZShub2RlLCBuYW1lKSB7XG5cdG5vZGUuc3R5bGUuYW5pbWF0aW9uID0gKG5vZGUuc3R5bGUuYW5pbWF0aW9uIHx8ICcnKVxuXHRcdC5zcGxpdCgnLCAnKVxuXHRcdC5maWx0ZXIobmFtZVxuXHRcdFx0PyBhbmltID0+IGFuaW0uaW5kZXhPZihuYW1lKSA8IDAgLy8gcmVtb3ZlIHNwZWNpZmljIGFuaW1hdGlvblxuXHRcdFx0OiBhbmltID0+IGFuaW0uaW5kZXhPZignX19zdmVsdGUnKSA9PT0gLTEgLy8gcmVtb3ZlIGFsbCBTdmVsdGUgYW5pbWF0aW9uc1xuXHRcdClcblx0XHQuam9pbignLCAnKTtcblxuXHRpZiAobmFtZSAmJiAhLS1hY3RpdmUpIGNsZWFyX3J1bGVzKCk7XG59XG5cbmZ1bmN0aW9uIGNsZWFyX3J1bGVzKCkge1xuXHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUoKCkgPT4ge1xuXHRcdGlmIChhY3RpdmUpIHJldHVybjtcblx0XHRsZXQgaSA9IHN0eWxlc2hlZXQuY3NzUnVsZXMubGVuZ3RoO1xuXHRcdHdoaWxlIChpLS0pIHN0eWxlc2hlZXQuZGVsZXRlUnVsZShpKTtcblx0XHRjdXJyZW50X3J1bGVzID0ge307XG5cdH0pO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVfYW5pbWF0aW9uKG5vZGUsIGZyb20sIGZuLCBwYXJhbXMpIHtcblx0aWYgKCFmcm9tKSByZXR1cm4gbm9vcDtcblxuXHRjb25zdCB0byA9IG5vZGUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG5cdGlmIChmcm9tLmxlZnQgPT09IHRvLmxlZnQgJiYgZnJvbS5yaWdodCA9PT0gdG8ucmlnaHQgJiYgZnJvbS50b3AgPT09IHRvLnRvcCAmJiBmcm9tLmJvdHRvbSA9PT0gdG8uYm90dG9tKSByZXR1cm4gbm9vcDtcblxuXHRjb25zdCB7XG5cdFx0ZGVsYXkgPSAwLFxuXHRcdGR1cmF0aW9uID0gMzAwLFxuXHRcdGVhc2luZyA9IGlkZW50aXR5LFxuXHRcdHN0YXJ0OiBzdGFydF90aW1lID0gd2luZG93LnBlcmZvcm1hbmNlLm5vdygpICsgZGVsYXksXG5cdFx0ZW5kID0gc3RhcnRfdGltZSArIGR1cmF0aW9uLFxuXHRcdHRpY2sgPSBub29wLFxuXHRcdGNzc1xuXHR9ID0gZm4obm9kZSwgeyBmcm9tLCB0byB9LCBwYXJhbXMpO1xuXG5cdGxldCBydW5uaW5nID0gdHJ1ZTtcblx0bGV0IHN0YXJ0ZWQgPSBmYWxzZTtcblx0bGV0IG5hbWU7XG5cblx0Y29uc3QgY3NzX3RleHQgPSBub2RlLnN0eWxlLmNzc1RleHQ7XG5cblx0ZnVuY3Rpb24gc3RhcnQoKSB7XG5cdFx0aWYgKGNzcykge1xuXHRcdFx0aWYgKGRlbGF5KSBub2RlLnN0eWxlLmNzc1RleHQgPSBjc3NfdGV4dDsgLy8gVE9ETyBjcmVhdGUgZGVsYXllZCBhbmltYXRpb24gaW5zdGVhZD9cblx0XHRcdG5hbWUgPSBjcmVhdGVfcnVsZShub2RlLCAwLCAxLCBkdXJhdGlvbiwgMCwgZWFzaW5nLCBjc3MpO1xuXHRcdH1cblxuXHRcdHN0YXJ0ZWQgPSB0cnVlO1xuXHR9XG5cblx0ZnVuY3Rpb24gc3RvcCgpIHtcblx0XHRpZiAoY3NzKSBkZWxldGVfcnVsZShub2RlLCBuYW1lKTtcblx0XHRydW5uaW5nID0gZmFsc2U7XG5cdH1cblxuXHRsb29wKG5vdyA9PiB7XG5cdFx0aWYgKCFzdGFydGVkICYmIG5vdyA+PSBzdGFydF90aW1lKSB7XG5cdFx0XHRzdGFydCgpO1xuXHRcdH1cblxuXHRcdGlmIChzdGFydGVkICYmIG5vdyA+PSBlbmQpIHtcblx0XHRcdHRpY2soMSwgMCk7XG5cdFx0XHRzdG9wKCk7XG5cdFx0fVxuXG5cdFx0aWYgKCFydW5uaW5nKSB7XG5cdFx0XHRyZXR1cm4gZmFsc2U7XG5cdFx0fVxuXG5cdFx0aWYgKHN0YXJ0ZWQpIHtcblx0XHRcdGNvbnN0IHAgPSBub3cgLSBzdGFydF90aW1lO1xuXHRcdFx0Y29uc3QgdCA9IDAgKyAxICogZWFzaW5nKHAgLyBkdXJhdGlvbik7XG5cdFx0XHR0aWNrKHQsIDEgLSB0KTtcblx0XHR9XG5cblx0XHRyZXR1cm4gdHJ1ZTtcblx0fSk7XG5cblx0aWYgKGRlbGF5KSB7XG5cdFx0aWYgKGNzcykgbm9kZS5zdHlsZS5jc3NUZXh0ICs9IGNzcygwLCAxKTtcblx0fSBlbHNlIHtcblx0XHRzdGFydCgpO1xuXHR9XG5cblx0dGljaygwLCAxKTtcblxuXHRyZXR1cm4gc3RvcDtcbn1cblxuZnVuY3Rpb24gZml4X3Bvc2l0aW9uKG5vZGUpIHtcblx0Y29uc3Qgc3R5bGUgPSBnZXRDb21wdXRlZFN0eWxlKG5vZGUpO1xuXG5cdGlmIChzdHlsZS5wb3NpdGlvbiAhPT0gJ2Fic29sdXRlJyAmJiBzdHlsZS5wb3NpdGlvbiAhPT0gJ2ZpeGVkJykge1xuXHRcdGNvbnN0IHsgd2lkdGgsIGhlaWdodCB9ID0gc3R5bGU7XG5cdFx0Y29uc3QgYSA9IG5vZGUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG5cdFx0bm9kZS5zdHlsZS5wb3NpdGlvbiA9ICdhYnNvbHV0ZSc7XG5cdFx0bm9kZS5zdHlsZS53aWR0aCA9IHdpZHRoO1xuXHRcdG5vZGUuc3R5bGUuaGVpZ2h0ID0gaGVpZ2h0O1xuXHRcdGNvbnN0IGIgPSBub2RlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXG5cdFx0aWYgKGEubGVmdCAhPT0gYi5sZWZ0IHx8IGEudG9wICE9PSBiLnRvcCkge1xuXHRcdFx0Y29uc3Qgc3R5bGUgPSBnZXRDb21wdXRlZFN0eWxlKG5vZGUpO1xuXHRcdFx0Y29uc3QgdHJhbnNmb3JtID0gc3R5bGUudHJhbnNmb3JtID09PSAnbm9uZScgPyAnJyA6IHN0eWxlLnRyYW5zZm9ybTtcblxuXHRcdFx0bm9kZS5zdHlsZS50cmFuc2Zvcm0gPSBgJHt0cmFuc2Zvcm19IHRyYW5zbGF0ZSgke2EubGVmdCAtIGIubGVmdH1weCwgJHthLnRvcCAtIGIudG9wfXB4KWA7XG5cdFx0fVxuXHR9XG59XG5cbmxldCBjdXJyZW50X2NvbXBvbmVudDtcblxuZnVuY3Rpb24gc2V0X2N1cnJlbnRfY29tcG9uZW50KGNvbXBvbmVudCkge1xuXHRjdXJyZW50X2NvbXBvbmVudCA9IGNvbXBvbmVudDtcbn1cblxuZnVuY3Rpb24gZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkge1xuXHRpZiAoIWN1cnJlbnRfY29tcG9uZW50KSB0aHJvdyBuZXcgRXJyb3IoYEZ1bmN0aW9uIGNhbGxlZCBvdXRzaWRlIGNvbXBvbmVudCBpbml0aWFsaXphdGlvbmApO1xuXHRyZXR1cm4gY3VycmVudF9jb21wb25lbnQ7XG59XG5cbmZ1bmN0aW9uIGJlZm9yZVVwZGF0ZShmbikge1xuXHRnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5iZWZvcmVfcmVuZGVyLnB1c2goZm4pO1xufVxuXG5mdW5jdGlvbiBvbk1vdW50KGZuKSB7XG5cdGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLm9uX21vdW50LnB1c2goZm4pO1xufVxuXG5mdW5jdGlvbiBhZnRlclVwZGF0ZShmbikge1xuXHRnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5hZnRlcl9yZW5kZXIucHVzaChmbik7XG59XG5cbmZ1bmN0aW9uIG9uRGVzdHJveShmbikge1xuXHRnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5vbl9kZXN0cm95LnB1c2goZm4pO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVFdmVudERpc3BhdGNoZXIoKSB7XG5cdGNvbnN0IGNvbXBvbmVudCA9IGN1cnJlbnRfY29tcG9uZW50O1xuXG5cdHJldHVybiAodHlwZSwgZGV0YWlsKSA9PiB7XG5cdFx0Y29uc3QgY2FsbGJhY2tzID0gY29tcG9uZW50LiQkLmNhbGxiYWNrc1t0eXBlXTtcblxuXHRcdGlmIChjYWxsYmFja3MpIHtcblx0XHRcdC8vIFRPRE8gYXJlIHRoZXJlIHNpdHVhdGlvbnMgd2hlcmUgZXZlbnRzIGNvdWxkIGJlIGRpc3BhdGNoZWRcblx0XHRcdC8vIGluIGEgc2VydmVyIChub24tRE9NKSBlbnZpcm9ubWVudD9cblx0XHRcdGNvbnN0IGV2ZW50ID0gY3VzdG9tX2V2ZW50KHR5cGUsIGRldGFpbCk7XG5cdFx0XHRjYWxsYmFja3Muc2xpY2UoKS5mb3JFYWNoKGZuID0+IHtcblx0XHRcdFx0Zm4uY2FsbChjb21wb25lbnQsIGV2ZW50KTtcblx0XHRcdH0pO1xuXHRcdH1cblx0fTtcbn1cblxuZnVuY3Rpb24gc2V0Q29udGV4dChrZXksIGNvbnRleHQpIHtcblx0Z2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuY29udGV4dC5zZXQoa2V5LCBjb250ZXh0KTtcbn1cblxuZnVuY3Rpb24gZ2V0Q29udGV4dChrZXkpIHtcblx0cmV0dXJuIGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLmNvbnRleHQuZ2V0KGtleSk7XG59XG5cbi8vIFRPRE8gZmlndXJlIG91dCBpZiB3ZSBzdGlsbCB3YW50IHRvIHN1cHBvcnRcbi8vIHNob3J0aGFuZCBldmVudHMsIG9yIGlmIHdlIHdhbnQgdG8gaW1wbGVtZW50XG4vLyBhIHJlYWwgYnViYmxpbmcgbWVjaGFuaXNtXG5mdW5jdGlvbiBidWJibGUoY29tcG9uZW50LCBldmVudCkge1xuXHRjb25zdCBjYWxsYmFja3MgPSBjb21wb25lbnQuJCQuY2FsbGJhY2tzW2V2ZW50LnR5cGVdO1xuXG5cdGlmIChjYWxsYmFja3MpIHtcblx0XHRjYWxsYmFja3Muc2xpY2UoKS5mb3JFYWNoKGZuID0+IGZuKGV2ZW50KSk7XG5cdH1cbn1cblxuY29uc3QgZGlydHlfY29tcG9uZW50cyA9IFtdO1xuY29uc3QgaW50cm9zID0geyBlbmFibGVkOiBmYWxzZSB9O1xuXG5sZXQgdXBkYXRlX3Byb21pc2U7XG5jb25zdCBiaW5kaW5nX2NhbGxiYWNrcyA9IFtdO1xuY29uc3QgcmVuZGVyX2NhbGxiYWNrcyA9IFtdO1xuY29uc3QgZmx1c2hfY2FsbGJhY2tzID0gW107XG5cbmZ1bmN0aW9uIHNjaGVkdWxlX3VwZGF0ZSgpIHtcblx0aWYgKCF1cGRhdGVfcHJvbWlzZSkge1xuXHRcdHVwZGF0ZV9wcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG5cdFx0dXBkYXRlX3Byb21pc2UudGhlbihmbHVzaCk7XG5cdH1cbn1cblxuZnVuY3Rpb24gdGljaygpIHtcblx0c2NoZWR1bGVfdXBkYXRlKCk7XG5cdHJldHVybiB1cGRhdGVfcHJvbWlzZTtcbn1cblxuZnVuY3Rpb24gYWRkX2JpbmRpbmdfY2FsbGJhY2soZm4pIHtcblx0YmluZGluZ19jYWxsYmFja3MucHVzaChmbik7XG59XG5cbmZ1bmN0aW9uIGFkZF9yZW5kZXJfY2FsbGJhY2soZm4pIHtcblx0cmVuZGVyX2NhbGxiYWNrcy5wdXNoKGZuKTtcbn1cblxuZnVuY3Rpb24gYWRkX2ZsdXNoX2NhbGxiYWNrKGZuKSB7XG5cdGZsdXNoX2NhbGxiYWNrcy5wdXNoKGZuKTtcbn1cblxuZnVuY3Rpb24gZmx1c2goKSB7XG5cdGNvbnN0IHNlZW5fY2FsbGJhY2tzID0gbmV3IFNldCgpO1xuXG5cdGRvIHtcblx0XHQvLyBmaXJzdCwgY2FsbCBiZWZvcmVVcGRhdGUgZnVuY3Rpb25zXG5cdFx0Ly8gYW5kIHVwZGF0ZSBjb21wb25lbnRzXG5cdFx0d2hpbGUgKGRpcnR5X2NvbXBvbmVudHMubGVuZ3RoKSB7XG5cdFx0XHRjb25zdCBjb21wb25lbnQgPSBkaXJ0eV9jb21wb25lbnRzLnNoaWZ0KCk7XG5cdFx0XHRzZXRfY3VycmVudF9jb21wb25lbnQoY29tcG9uZW50KTtcblx0XHRcdHVwZGF0ZShjb21wb25lbnQuJCQpO1xuXHRcdH1cblxuXHRcdHdoaWxlIChiaW5kaW5nX2NhbGxiYWNrcy5sZW5ndGgpIGJpbmRpbmdfY2FsbGJhY2tzLnNoaWZ0KCkoKTtcblxuXHRcdC8vIHRoZW4sIG9uY2UgY29tcG9uZW50cyBhcmUgdXBkYXRlZCwgY2FsbFxuXHRcdC8vIGFmdGVyVXBkYXRlIGZ1bmN0aW9ucy4gVGhpcyBtYXkgY2F1c2Vcblx0XHQvLyBzdWJzZXF1ZW50IHVwZGF0ZXMuLi5cblx0XHR3aGlsZSAocmVuZGVyX2NhbGxiYWNrcy5sZW5ndGgpIHtcblx0XHRcdGNvbnN0IGNhbGxiYWNrID0gcmVuZGVyX2NhbGxiYWNrcy5wb3AoKTtcblx0XHRcdGlmICghc2Vlbl9jYWxsYmFja3MuaGFzKGNhbGxiYWNrKSkge1xuXHRcdFx0XHRjYWxsYmFjaygpO1xuXG5cdFx0XHRcdC8vIC4uLnNvIGd1YXJkIGFnYWluc3QgaW5maW5pdGUgbG9vcHNcblx0XHRcdFx0c2Vlbl9jYWxsYmFja3MuYWRkKGNhbGxiYWNrKTtcblx0XHRcdH1cblx0XHR9XG5cdH0gd2hpbGUgKGRpcnR5X2NvbXBvbmVudHMubGVuZ3RoKTtcblxuXHR3aGlsZSAoZmx1c2hfY2FsbGJhY2tzLmxlbmd0aCkge1xuXHRcdGZsdXNoX2NhbGxiYWNrcy5wb3AoKSgpO1xuXHR9XG5cblx0dXBkYXRlX3Byb21pc2UgPSBudWxsO1xufVxuXG5mdW5jdGlvbiB1cGRhdGUoJCQpIHtcblx0aWYgKCQkLmZyYWdtZW50KSB7XG5cdFx0JCQudXBkYXRlKCQkLmRpcnR5KTtcblx0XHRydW5fYWxsKCQkLmJlZm9yZV9yZW5kZXIpO1xuXHRcdCQkLmZyYWdtZW50LnAoJCQuZGlydHksICQkLmN0eCk7XG5cdFx0JCQuZGlydHkgPSBudWxsO1xuXG5cdFx0JCQuYWZ0ZXJfcmVuZGVyLmZvckVhY2goYWRkX3JlbmRlcl9jYWxsYmFjayk7XG5cdH1cbn1cblxubGV0IHByb21pc2U7XG5cbmZ1bmN0aW9uIHdhaXQoKSB7XG5cdGlmICghcHJvbWlzZSkge1xuXHRcdHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcblx0XHRwcm9taXNlLnRoZW4oKCkgPT4ge1xuXHRcdFx0cHJvbWlzZSA9IG51bGw7XG5cdFx0fSk7XG5cdH1cblxuXHRyZXR1cm4gcHJvbWlzZTtcbn1cblxuZnVuY3Rpb24gZGlzcGF0Y2gobm9kZSwgZGlyZWN0aW9uLCBraW5kKSB7XG5cdG5vZGUuZGlzcGF0Y2hFdmVudChjdXN0b21fZXZlbnQoYCR7ZGlyZWN0aW9uID8gJ2ludHJvJyA6ICdvdXRybyd9JHtraW5kfWApKTtcbn1cblxubGV0IG91dHJvcztcblxuZnVuY3Rpb24gZ3JvdXBfb3V0cm9zKCkge1xuXHRvdXRyb3MgPSB7XG5cdFx0cmVtYWluaW5nOiAwLFxuXHRcdGNhbGxiYWNrczogW11cblx0fTtcbn1cblxuZnVuY3Rpb24gY2hlY2tfb3V0cm9zKCkge1xuXHRpZiAoIW91dHJvcy5yZW1haW5pbmcpIHtcblx0XHRydW5fYWxsKG91dHJvcy5jYWxsYmFja3MpO1xuXHR9XG59XG5cbmZ1bmN0aW9uIG9uX291dHJvKGNhbGxiYWNrKSB7XG5cdG91dHJvcy5jYWxsYmFja3MucHVzaChjYWxsYmFjayk7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZV9pbl90cmFuc2l0aW9uKG5vZGUsIGZuLCBwYXJhbXMpIHtcblx0bGV0IGNvbmZpZyA9IGZuKG5vZGUsIHBhcmFtcyk7XG5cdGxldCBydW5uaW5nID0gZmFsc2U7XG5cdGxldCBhbmltYXRpb25fbmFtZTtcblx0bGV0IHRhc2s7XG5cdGxldCB1aWQgPSAwO1xuXG5cdGZ1bmN0aW9uIGNsZWFudXAoKSB7XG5cdFx0aWYgKGFuaW1hdGlvbl9uYW1lKSBkZWxldGVfcnVsZShub2RlLCBhbmltYXRpb25fbmFtZSk7XG5cdH1cblxuXHRmdW5jdGlvbiBnbygpIHtcblx0XHRjb25zdCB7XG5cdFx0XHRkZWxheSA9IDAsXG5cdFx0XHRkdXJhdGlvbiA9IDMwMCxcblx0XHRcdGVhc2luZyA9IGlkZW50aXR5LFxuXHRcdFx0dGljazogdGljayQkMSA9IG5vb3AsXG5cdFx0XHRjc3Ncblx0XHR9ID0gY29uZmlnO1xuXG5cdFx0aWYgKGNzcykgYW5pbWF0aW9uX25hbWUgPSBjcmVhdGVfcnVsZShub2RlLCAwLCAxLCBkdXJhdGlvbiwgZGVsYXksIGVhc2luZywgY3NzLCB1aWQrKyk7XG5cdFx0dGljayQkMSgwLCAxKTtcblxuXHRcdGNvbnN0IHN0YXJ0X3RpbWUgPSB3aW5kb3cucGVyZm9ybWFuY2Uubm93KCkgKyBkZWxheTtcblx0XHRjb25zdCBlbmRfdGltZSA9IHN0YXJ0X3RpbWUgKyBkdXJhdGlvbjtcblxuXHRcdGlmICh0YXNrKSB0YXNrLmFib3J0KCk7XG5cdFx0cnVubmluZyA9IHRydWU7XG5cblx0XHR0YXNrID0gbG9vcChub3cgPT4ge1xuXHRcdFx0aWYgKHJ1bm5pbmcpIHtcblx0XHRcdFx0aWYgKG5vdyA+PSBlbmRfdGltZSkge1xuXHRcdFx0XHRcdHRpY2skJDEoMSwgMCk7XG5cdFx0XHRcdFx0Y2xlYW51cCgpO1xuXHRcdFx0XHRcdHJldHVybiBydW5uaW5nID0gZmFsc2U7XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRpZiAobm93ID49IHN0YXJ0X3RpbWUpIHtcblx0XHRcdFx0XHRjb25zdCB0ID0gZWFzaW5nKChub3cgLSBzdGFydF90aW1lKSAvIGR1cmF0aW9uKTtcblx0XHRcdFx0XHR0aWNrJCQxKHQsIDEgLSB0KTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXG5cdFx0XHRyZXR1cm4gcnVubmluZztcblx0XHR9KTtcblx0fVxuXG5cdGxldCBzdGFydGVkID0gZmFsc2U7XG5cblx0cmV0dXJuIHtcblx0XHRzdGFydCgpIHtcblx0XHRcdGlmIChzdGFydGVkKSByZXR1cm47XG5cblx0XHRcdGRlbGV0ZV9ydWxlKG5vZGUpO1xuXG5cdFx0XHRpZiAodHlwZW9mIGNvbmZpZyA9PT0gJ2Z1bmN0aW9uJykge1xuXHRcdFx0XHRjb25maWcgPSBjb25maWcoKTtcblx0XHRcdFx0d2FpdCgpLnRoZW4oZ28pO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0Z28oKTtcblx0XHRcdH1cblx0XHR9LFxuXG5cdFx0aW52YWxpZGF0ZSgpIHtcblx0XHRcdHN0YXJ0ZWQgPSBmYWxzZTtcblx0XHR9LFxuXG5cdFx0ZW5kKCkge1xuXHRcdFx0aWYgKHJ1bm5pbmcpIHtcblx0XHRcdFx0Y2xlYW51cCgpO1xuXHRcdFx0XHRydW5uaW5nID0gZmFsc2U7XG5cdFx0XHR9XG5cdFx0fVxuXHR9O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVfb3V0X3RyYW5zaXRpb24obm9kZSwgZm4sIHBhcmFtcykge1xuXHRsZXQgY29uZmlnID0gZm4obm9kZSwgcGFyYW1zKTtcblx0bGV0IHJ1bm5pbmcgPSB0cnVlO1xuXHRsZXQgYW5pbWF0aW9uX25hbWU7XG5cblx0Y29uc3QgZ3JvdXAgPSBvdXRyb3M7XG5cblx0Z3JvdXAucmVtYWluaW5nICs9IDE7XG5cblx0ZnVuY3Rpb24gZ28oKSB7XG5cdFx0Y29uc3Qge1xuXHRcdFx0ZGVsYXkgPSAwLFxuXHRcdFx0ZHVyYXRpb24gPSAzMDAsXG5cdFx0XHRlYXNpbmcgPSBpZGVudGl0eSxcblx0XHRcdHRpY2s6IHRpY2skJDEgPSBub29wLFxuXHRcdFx0Y3NzXG5cdFx0fSA9IGNvbmZpZztcblxuXHRcdGlmIChjc3MpIGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgMSwgMCwgZHVyYXRpb24sIGRlbGF5LCBlYXNpbmcsIGNzcyk7XG5cblx0XHRjb25zdCBzdGFydF90aW1lID0gd2luZG93LnBlcmZvcm1hbmNlLm5vdygpICsgZGVsYXk7XG5cdFx0Y29uc3QgZW5kX3RpbWUgPSBzdGFydF90aW1lICsgZHVyYXRpb247XG5cblx0XHRsb29wKG5vdyA9PiB7XG5cdFx0XHRpZiAocnVubmluZykge1xuXHRcdFx0XHRpZiAobm93ID49IGVuZF90aW1lKSB7XG5cdFx0XHRcdFx0dGljayQkMSgwLCAxKTtcblxuXHRcdFx0XHRcdGlmICghLS1ncm91cC5yZW1haW5pbmcpIHtcblx0XHRcdFx0XHRcdC8vIHRoaXMgd2lsbCByZXN1bHQgaW4gYGVuZCgpYCBiZWluZyBjYWxsZWQsXG5cdFx0XHRcdFx0XHQvLyBzbyB3ZSBkb24ndCBuZWVkIHRvIGNsZWFuIHVwIGhlcmVcblx0XHRcdFx0XHRcdHJ1bl9hbGwoZ3JvdXAuY2FsbGJhY2tzKTtcblx0XHRcdFx0XHR9XG5cblx0XHRcdFx0XHRyZXR1cm4gZmFsc2U7XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRpZiAobm93ID49IHN0YXJ0X3RpbWUpIHtcblx0XHRcdFx0XHRjb25zdCB0ID0gZWFzaW5nKChub3cgLSBzdGFydF90aW1lKSAvIGR1cmF0aW9uKTtcblx0XHRcdFx0XHR0aWNrJCQxKDEgLSB0LCB0KTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXG5cdFx0XHRyZXR1cm4gcnVubmluZztcblx0XHR9KTtcblx0fVxuXG5cdGlmICh0eXBlb2YgY29uZmlnID09PSAnZnVuY3Rpb24nKSB7XG5cdFx0d2FpdCgpLnRoZW4oKCkgPT4ge1xuXHRcdFx0Y29uZmlnID0gY29uZmlnKCk7XG5cdFx0XHRnbygpO1xuXHRcdH0pO1xuXHR9IGVsc2Uge1xuXHRcdGdvKCk7XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdGVuZChyZXNldCkge1xuXHRcdFx0aWYgKHJlc2V0ICYmIGNvbmZpZy50aWNrKSB7XG5cdFx0XHRcdGNvbmZpZy50aWNrKDEsIDApO1xuXHRcdFx0fVxuXG5cdFx0XHRpZiAocnVubmluZykge1xuXHRcdFx0XHRpZiAoYW5pbWF0aW9uX25hbWUpIGRlbGV0ZV9ydWxlKG5vZGUsIGFuaW1hdGlvbl9uYW1lKTtcblx0XHRcdFx0cnVubmluZyA9IGZhbHNlO1xuXHRcdFx0fVxuXHRcdH1cblx0fTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlX2JpZGlyZWN0aW9uYWxfdHJhbnNpdGlvbihub2RlLCBmbiwgcGFyYW1zLCBpbnRybykge1xuXHRsZXQgY29uZmlnID0gZm4obm9kZSwgcGFyYW1zKTtcblxuXHRsZXQgdCA9IGludHJvID8gMCA6IDE7XG5cblx0bGV0IHJ1bm5pbmdfcHJvZ3JhbSA9IG51bGw7XG5cdGxldCBwZW5kaW5nX3Byb2dyYW0gPSBudWxsO1xuXHRsZXQgYW5pbWF0aW9uX25hbWUgPSBudWxsO1xuXG5cdGZ1bmN0aW9uIGNsZWFyX2FuaW1hdGlvbigpIHtcblx0XHRpZiAoYW5pbWF0aW9uX25hbWUpIGRlbGV0ZV9ydWxlKG5vZGUsIGFuaW1hdGlvbl9uYW1lKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGluaXQocHJvZ3JhbSwgZHVyYXRpb24pIHtcblx0XHRjb25zdCBkID0gcHJvZ3JhbS5iIC0gdDtcblx0XHRkdXJhdGlvbiAqPSBNYXRoLmFicyhkKTtcblxuXHRcdHJldHVybiB7XG5cdFx0XHRhOiB0LFxuXHRcdFx0YjogcHJvZ3JhbS5iLFxuXHRcdFx0ZCxcblx0XHRcdGR1cmF0aW9uLFxuXHRcdFx0c3RhcnQ6IHByb2dyYW0uc3RhcnQsXG5cdFx0XHRlbmQ6IHByb2dyYW0uc3RhcnQgKyBkdXJhdGlvbixcblx0XHRcdGdyb3VwOiBwcm9ncmFtLmdyb3VwXG5cdFx0fTtcblx0fVxuXG5cdGZ1bmN0aW9uIGdvKGIpIHtcblx0XHRjb25zdCB7XG5cdFx0XHRkZWxheSA9IDAsXG5cdFx0XHRkdXJhdGlvbiA9IDMwMCxcblx0XHRcdGVhc2luZyA9IGlkZW50aXR5LFxuXHRcdFx0dGljazogdGljayQkMSA9IG5vb3AsXG5cdFx0XHRjc3Ncblx0XHR9ID0gY29uZmlnO1xuXG5cdFx0Y29uc3QgcHJvZ3JhbSA9IHtcblx0XHRcdHN0YXJ0OiB3aW5kb3cucGVyZm9ybWFuY2Uubm93KCkgKyBkZWxheSxcblx0XHRcdGJcblx0XHR9O1xuXG5cdFx0aWYgKCFiKSB7XG5cdFx0XHRwcm9ncmFtLmdyb3VwID0gb3V0cm9zO1xuXHRcdFx0b3V0cm9zLnJlbWFpbmluZyArPSAxO1xuXHRcdH1cblxuXHRcdGlmIChydW5uaW5nX3Byb2dyYW0pIHtcblx0XHRcdHBlbmRpbmdfcHJvZ3JhbSA9IHByb2dyYW07XG5cdFx0fSBlbHNlIHtcblx0XHRcdC8vIGlmIHRoaXMgaXMgYW4gaW50cm8sIGFuZCB0aGVyZSdzIGEgZGVsYXksIHdlIG5lZWQgdG8gZG9cblx0XHRcdC8vIGFuIGluaXRpYWwgdGljayBhbmQvb3IgYXBwbHkgQ1NTIGFuaW1hdGlvbiBpbW1lZGlhdGVseVxuXHRcdFx0aWYgKGNzcykge1xuXHRcdFx0XHRjbGVhcl9hbmltYXRpb24oKTtcblx0XHRcdFx0YW5pbWF0aW9uX25hbWUgPSBjcmVhdGVfcnVsZShub2RlLCB0LCBiLCBkdXJhdGlvbiwgZGVsYXksIGVhc2luZywgY3NzKTtcblx0XHRcdH1cblxuXHRcdFx0aWYgKGIpIHRpY2skJDEoMCwgMSk7XG5cblx0XHRcdHJ1bm5pbmdfcHJvZ3JhbSA9IGluaXQocHJvZ3JhbSwgZHVyYXRpb24pO1xuXHRcdFx0YWRkX3JlbmRlcl9jYWxsYmFjaygoKSA9PiBkaXNwYXRjaChub2RlLCBiLCAnc3RhcnQnKSk7XG5cblx0XHRcdGxvb3Aobm93ID0+IHtcblx0XHRcdFx0aWYgKHBlbmRpbmdfcHJvZ3JhbSAmJiBub3cgPiBwZW5kaW5nX3Byb2dyYW0uc3RhcnQpIHtcblx0XHRcdFx0XHRydW5uaW5nX3Byb2dyYW0gPSBpbml0KHBlbmRpbmdfcHJvZ3JhbSwgZHVyYXRpb24pO1xuXHRcdFx0XHRcdHBlbmRpbmdfcHJvZ3JhbSA9IG51bGw7XG5cblx0XHRcdFx0XHRkaXNwYXRjaChub2RlLCBydW5uaW5nX3Byb2dyYW0uYiwgJ3N0YXJ0Jyk7XG5cblx0XHRcdFx0XHRpZiAoY3NzKSB7XG5cdFx0XHRcdFx0XHRjbGVhcl9hbmltYXRpb24oKTtcblx0XHRcdFx0XHRcdGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgdCwgcnVubmluZ19wcm9ncmFtLmIsIHJ1bm5pbmdfcHJvZ3JhbS5kdXJhdGlvbiwgMCwgZWFzaW5nLCBjb25maWcuY3NzKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRpZiAocnVubmluZ19wcm9ncmFtKSB7XG5cdFx0XHRcdFx0aWYgKG5vdyA+PSBydW5uaW5nX3Byb2dyYW0uZW5kKSB7XG5cdFx0XHRcdFx0XHR0aWNrJCQxKHQgPSBydW5uaW5nX3Byb2dyYW0uYiwgMSAtIHQpO1xuXHRcdFx0XHRcdFx0ZGlzcGF0Y2gobm9kZSwgcnVubmluZ19wcm9ncmFtLmIsICdlbmQnKTtcblxuXHRcdFx0XHRcdFx0aWYgKCFwZW5kaW5nX3Byb2dyYW0pIHtcblx0XHRcdFx0XHRcdFx0Ly8gd2UncmUgZG9uZVxuXHRcdFx0XHRcdFx0XHRpZiAocnVubmluZ19wcm9ncmFtLmIpIHtcblx0XHRcdFx0XHRcdFx0XHQvLyBpbnRybyDigJQgd2UgY2FuIHRpZHkgdXAgaW1tZWRpYXRlbHlcblx0XHRcdFx0XHRcdFx0XHRjbGVhcl9hbmltYXRpb24oKTtcblx0XHRcdFx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRcdFx0XHQvLyBvdXRybyDigJQgbmVlZHMgdG8gYmUgY29vcmRpbmF0ZWRcblx0XHRcdFx0XHRcdFx0XHRpZiAoIS0tcnVubmluZ19wcm9ncmFtLmdyb3VwLnJlbWFpbmluZykgcnVuX2FsbChydW5uaW5nX3Byb2dyYW0uZ3JvdXAuY2FsbGJhY2tzKTtcblx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0fVxuXG5cdFx0XHRcdFx0XHRydW5uaW5nX3Byb2dyYW0gPSBudWxsO1xuXHRcdFx0XHRcdH1cblxuXHRcdFx0XHRcdGVsc2UgaWYgKG5vdyA+PSBydW5uaW5nX3Byb2dyYW0uc3RhcnQpIHtcblx0XHRcdFx0XHRcdGNvbnN0IHAgPSBub3cgLSBydW5uaW5nX3Byb2dyYW0uc3RhcnQ7XG5cdFx0XHRcdFx0XHR0ID0gcnVubmluZ19wcm9ncmFtLmEgKyBydW5uaW5nX3Byb2dyYW0uZCAqIGVhc2luZyhwIC8gcnVubmluZ19wcm9ncmFtLmR1cmF0aW9uKTtcblx0XHRcdFx0XHRcdHRpY2skJDEodCwgMSAtIHQpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXG5cdFx0XHRcdHJldHVybiAhIShydW5uaW5nX3Byb2dyYW0gfHwgcGVuZGluZ19wcm9ncmFtKTtcblx0XHRcdH0pO1xuXHRcdH1cblx0fVxuXG5cdHJldHVybiB7XG5cdFx0cnVuKGIpIHtcblx0XHRcdGlmICh0eXBlb2YgY29uZmlnID09PSAnZnVuY3Rpb24nKSB7XG5cdFx0XHRcdHdhaXQoKS50aGVuKCgpID0+IHtcblx0XHRcdFx0XHRjb25maWcgPSBjb25maWcoKTtcblx0XHRcdFx0XHRnbyhiKTtcblx0XHRcdFx0fSk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRnbyhiKTtcblx0XHRcdH1cblx0XHR9LFxuXG5cdFx0ZW5kKCkge1xuXHRcdFx0Y2xlYXJfYW5pbWF0aW9uKCk7XG5cdFx0XHRydW5uaW5nX3Byb2dyYW0gPSBwZW5kaW5nX3Byb2dyYW0gPSBudWxsO1xuXHRcdH1cblx0fTtcbn1cblxuZnVuY3Rpb24gaGFuZGxlX3Byb21pc2UocHJvbWlzZSwgaW5mbykge1xuXHRjb25zdCB0b2tlbiA9IGluZm8udG9rZW4gPSB7fTtcblxuXHRmdW5jdGlvbiB1cGRhdGUodHlwZSwgaW5kZXgsIGtleSwgdmFsdWUpIHtcblx0XHRpZiAoaW5mby50b2tlbiAhPT0gdG9rZW4pIHJldHVybjtcblxuXHRcdGluZm8ucmVzb2x2ZWQgPSBrZXkgJiYgeyBba2V5XTogdmFsdWUgfTtcblxuXHRcdGNvbnN0IGNoaWxkX2N0eCA9IGFzc2lnbihhc3NpZ24oe30sIGluZm8uY3R4KSwgaW5mby5yZXNvbHZlZCk7XG5cdFx0Y29uc3QgYmxvY2sgPSB0eXBlICYmIChpbmZvLmN1cnJlbnQgPSB0eXBlKShjaGlsZF9jdHgpO1xuXG5cdFx0aWYgKGluZm8uYmxvY2spIHtcblx0XHRcdGlmIChpbmZvLmJsb2Nrcykge1xuXHRcdFx0XHRpbmZvLmJsb2Nrcy5mb3JFYWNoKChibG9jaywgaSkgPT4ge1xuXHRcdFx0XHRcdGlmIChpICE9PSBpbmRleCAmJiBibG9jaykge1xuXHRcdFx0XHRcdFx0Z3JvdXBfb3V0cm9zKCk7XG5cdFx0XHRcdFx0XHRvbl9vdXRybygoKSA9PiB7XG5cdFx0XHRcdFx0XHRcdGJsb2NrLmQoMSk7XG5cdFx0XHRcdFx0XHRcdGluZm8uYmxvY2tzW2ldID0gbnVsbDtcblx0XHRcdFx0XHRcdH0pO1xuXHRcdFx0XHRcdFx0YmxvY2subygxKTtcblx0XHRcdFx0XHRcdGNoZWNrX291dHJvcygpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fSk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRpbmZvLmJsb2NrLmQoMSk7XG5cdFx0XHR9XG5cblx0XHRcdGJsb2NrLmMoKTtcblx0XHRcdGlmIChibG9jay5pKSBibG9jay5pKDEpO1xuXHRcdFx0YmxvY2subShpbmZvLm1vdW50KCksIGluZm8uYW5jaG9yKTtcblxuXHRcdFx0Zmx1c2goKTtcblx0XHR9XG5cblx0XHRpbmZvLmJsb2NrID0gYmxvY2s7XG5cdFx0aWYgKGluZm8uYmxvY2tzKSBpbmZvLmJsb2Nrc1tpbmRleF0gPSBibG9jaztcblx0fVxuXG5cdGlmIChpc19wcm9taXNlKHByb21pc2UpKSB7XG5cdFx0cHJvbWlzZS50aGVuKHZhbHVlID0+IHtcblx0XHRcdHVwZGF0ZShpbmZvLnRoZW4sIDEsIGluZm8udmFsdWUsIHZhbHVlKTtcblx0XHR9LCBlcnJvciA9PiB7XG5cdFx0XHR1cGRhdGUoaW5mby5jYXRjaCwgMiwgaW5mby5lcnJvciwgZXJyb3IpO1xuXHRcdH0pO1xuXG5cdFx0Ly8gaWYgd2UgcHJldmlvdXNseSBoYWQgYSB0aGVuL2NhdGNoIGJsb2NrLCBkZXN0cm95IGl0XG5cdFx0aWYgKGluZm8uY3VycmVudCAhPT0gaW5mby5wZW5kaW5nKSB7XG5cdFx0XHR1cGRhdGUoaW5mby5wZW5kaW5nLCAwKTtcblx0XHRcdHJldHVybiB0cnVlO1xuXHRcdH1cblx0fSBlbHNlIHtcblx0XHRpZiAoaW5mby5jdXJyZW50ICE9PSBpbmZvLnRoZW4pIHtcblx0XHRcdHVwZGF0ZShpbmZvLnRoZW4sIDEsIGluZm8udmFsdWUsIHByb21pc2UpO1xuXHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0fVxuXG5cdFx0aW5mby5yZXNvbHZlZCA9IHsgW2luZm8udmFsdWVdOiBwcm9taXNlIH07XG5cdH1cbn1cblxuZnVuY3Rpb24gZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKSB7XG5cdGJsb2NrLmQoMSk7XG5cdGxvb2t1cC5kZWxldGUoYmxvY2sua2V5KTtcbn1cblxuZnVuY3Rpb24gb3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCkge1xuXHRvbl9vdXRybygoKSA9PiB7XG5cdFx0ZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKTtcblx0fSk7XG5cblx0YmxvY2subygxKTtcbn1cblxuZnVuY3Rpb24gZml4X2FuZF9vdXRyb19hbmRfZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKSB7XG5cdGJsb2NrLmYoKTtcblx0b3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCk7XG59XG5cbmZ1bmN0aW9uIHVwZGF0ZV9rZXllZF9lYWNoKG9sZF9ibG9ja3MsIGNoYW5nZWQsIGdldF9rZXksIGR5bmFtaWMsIGN0eCwgbGlzdCwgbG9va3VwLCBub2RlLCBkZXN0cm95LCBjcmVhdGVfZWFjaF9ibG9jaywgbmV4dCwgZ2V0X2NvbnRleHQpIHtcblx0bGV0IG8gPSBvbGRfYmxvY2tzLmxlbmd0aDtcblx0bGV0IG4gPSBsaXN0Lmxlbmd0aDtcblxuXHRsZXQgaSA9IG87XG5cdGNvbnN0IG9sZF9pbmRleGVzID0ge307XG5cdHdoaWxlIChpLS0pIG9sZF9pbmRleGVzW29sZF9ibG9ja3NbaV0ua2V5XSA9IGk7XG5cblx0Y29uc3QgbmV3X2Jsb2NrcyA9IFtdO1xuXHRjb25zdCBuZXdfbG9va3VwID0gbmV3IE1hcCgpO1xuXHRjb25zdCBkZWx0YXMgPSBuZXcgTWFwKCk7XG5cblx0aSA9IG47XG5cdHdoaWxlIChpLS0pIHtcblx0XHRjb25zdCBjaGlsZF9jdHggPSBnZXRfY29udGV4dChjdHgsIGxpc3QsIGkpO1xuXHRcdGNvbnN0IGtleSA9IGdldF9rZXkoY2hpbGRfY3R4KTtcblx0XHRsZXQgYmxvY2sgPSBsb29rdXAuZ2V0KGtleSk7XG5cblx0XHRpZiAoIWJsb2NrKSB7XG5cdFx0XHRibG9jayA9IGNyZWF0ZV9lYWNoX2Jsb2NrKGtleSwgY2hpbGRfY3R4KTtcblx0XHRcdGJsb2NrLmMoKTtcblx0XHR9IGVsc2UgaWYgKGR5bmFtaWMpIHtcblx0XHRcdGJsb2NrLnAoY2hhbmdlZCwgY2hpbGRfY3R4KTtcblx0XHR9XG5cblx0XHRuZXdfbG9va3VwLnNldChrZXksIG5ld19ibG9ja3NbaV0gPSBibG9jayk7XG5cblx0XHRpZiAoa2V5IGluIG9sZF9pbmRleGVzKSBkZWx0YXMuc2V0KGtleSwgTWF0aC5hYnMoaSAtIG9sZF9pbmRleGVzW2tleV0pKTtcblx0fVxuXG5cdGNvbnN0IHdpbGxfbW92ZSA9IG5ldyBTZXQoKTtcblx0Y29uc3QgZGlkX21vdmUgPSBuZXcgU2V0KCk7XG5cblx0ZnVuY3Rpb24gaW5zZXJ0KGJsb2NrKSB7XG5cdFx0aWYgKGJsb2NrLmkpIGJsb2NrLmkoMSk7XG5cdFx0YmxvY2subShub2RlLCBuZXh0KTtcblx0XHRsb29rdXAuc2V0KGJsb2NrLmtleSwgYmxvY2spO1xuXHRcdG5leHQgPSBibG9jay5maXJzdDtcblx0XHRuLS07XG5cdH1cblxuXHR3aGlsZSAobyAmJiBuKSB7XG5cdFx0Y29uc3QgbmV3X2Jsb2NrID0gbmV3X2Jsb2Nrc1tuIC0gMV07XG5cdFx0Y29uc3Qgb2xkX2Jsb2NrID0gb2xkX2Jsb2Nrc1tvIC0gMV07XG5cdFx0Y29uc3QgbmV3X2tleSA9IG5ld19ibG9jay5rZXk7XG5cdFx0Y29uc3Qgb2xkX2tleSA9IG9sZF9ibG9jay5rZXk7XG5cblx0XHRpZiAobmV3X2Jsb2NrID09PSBvbGRfYmxvY2spIHtcblx0XHRcdC8vIGRvIG5vdGhpbmdcblx0XHRcdG5leHQgPSBuZXdfYmxvY2suZmlyc3Q7XG5cdFx0XHRvLS07XG5cdFx0XHRuLS07XG5cdFx0fVxuXG5cdFx0ZWxzZSBpZiAoIW5ld19sb29rdXAuaGFzKG9sZF9rZXkpKSB7XG5cdFx0XHQvLyByZW1vdmUgb2xkIGJsb2NrXG5cdFx0XHRkZXN0cm95KG9sZF9ibG9jaywgbG9va3VwKTtcblx0XHRcdG8tLTtcblx0XHR9XG5cblx0XHRlbHNlIGlmICghbG9va3VwLmhhcyhuZXdfa2V5KSB8fCB3aWxsX21vdmUuaGFzKG5ld19rZXkpKSB7XG5cdFx0XHRpbnNlcnQobmV3X2Jsb2NrKTtcblx0XHR9XG5cblx0XHRlbHNlIGlmIChkaWRfbW92ZS5oYXMob2xkX2tleSkpIHtcblx0XHRcdG8tLTtcblxuXHRcdH0gZWxzZSBpZiAoZGVsdGFzLmdldChuZXdfa2V5KSA+IGRlbHRhcy5nZXQob2xkX2tleSkpIHtcblx0XHRcdGRpZF9tb3ZlLmFkZChuZXdfa2V5KTtcblx0XHRcdGluc2VydChuZXdfYmxvY2spO1xuXG5cdFx0fSBlbHNlIHtcblx0XHRcdHdpbGxfbW92ZS5hZGQob2xkX2tleSk7XG5cdFx0XHRvLS07XG5cdFx0fVxuXHR9XG5cblx0d2hpbGUgKG8tLSkge1xuXHRcdGNvbnN0IG9sZF9ibG9jayA9IG9sZF9ibG9ja3Nbb107XG5cdFx0aWYgKCFuZXdfbG9va3VwLmhhcyhvbGRfYmxvY2sua2V5KSkgZGVzdHJveShvbGRfYmxvY2ssIGxvb2t1cCk7XG5cdH1cblxuXHR3aGlsZSAobikgaW5zZXJ0KG5ld19ibG9ja3NbbiAtIDFdKTtcblxuXHRyZXR1cm4gbmV3X2Jsb2Nrcztcbn1cblxuZnVuY3Rpb24gbWVhc3VyZShibG9ja3MpIHtcblx0Y29uc3QgcmVjdHMgPSB7fTtcblx0bGV0IGkgPSBibG9ja3MubGVuZ3RoO1xuXHR3aGlsZSAoaS0tKSByZWN0c1tibG9ja3NbaV0ua2V5XSA9IGJsb2Nrc1tpXS5ub2RlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXHRyZXR1cm4gcmVjdHM7XG59XG5cbmZ1bmN0aW9uIGdldF9zcHJlYWRfdXBkYXRlKGxldmVscywgdXBkYXRlcykge1xuXHRjb25zdCB1cGRhdGUgPSB7fTtcblxuXHRjb25zdCB0b19udWxsX291dCA9IHt9O1xuXHRjb25zdCBhY2NvdW50ZWRfZm9yID0ge307XG5cblx0bGV0IGkgPSBsZXZlbHMubGVuZ3RoO1xuXHR3aGlsZSAoaS0tKSB7XG5cdFx0Y29uc3QgbyA9IGxldmVsc1tpXTtcblx0XHRjb25zdCBuID0gdXBkYXRlc1tpXTtcblxuXHRcdGlmIChuKSB7XG5cdFx0XHRmb3IgKGNvbnN0IGtleSBpbiBvKSB7XG5cdFx0XHRcdGlmICghKGtleSBpbiBuKSkgdG9fbnVsbF9vdXRba2V5XSA9IDE7XG5cdFx0XHR9XG5cblx0XHRcdGZvciAoY29uc3Qga2V5IGluIG4pIHtcblx0XHRcdFx0aWYgKCFhY2NvdW50ZWRfZm9yW2tleV0pIHtcblx0XHRcdFx0XHR1cGRhdGVba2V5XSA9IG5ba2V5XTtcblx0XHRcdFx0XHRhY2NvdW50ZWRfZm9yW2tleV0gPSAxO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cblx0XHRcdGxldmVsc1tpXSA9IG47XG5cdFx0fSBlbHNlIHtcblx0XHRcdGZvciAoY29uc3Qga2V5IGluIG8pIHtcblx0XHRcdFx0YWNjb3VudGVkX2ZvcltrZXldID0gMTtcblx0XHRcdH1cblx0XHR9XG5cdH1cblxuXHRmb3IgKGNvbnN0IGtleSBpbiB0b19udWxsX291dCkge1xuXHRcdGlmICghKGtleSBpbiB1cGRhdGUpKSB1cGRhdGVba2V5XSA9IHVuZGVmaW5lZDtcblx0fVxuXG5cdHJldHVybiB1cGRhdGU7XG59XG5cbmNvbnN0IGludmFsaWRfYXR0cmlidXRlX25hbWVfY2hhcmFjdGVyID0gL1tcXHMnXCI+Lz1cXHV7RkREMH0tXFx1e0ZERUZ9XFx1e0ZGRkV9XFx1e0ZGRkZ9XFx1ezFGRkZFfVxcdXsxRkZGRn1cXHV7MkZGRkV9XFx1ezJGRkZGfVxcdXszRkZGRX1cXHV7M0ZGRkZ9XFx1ezRGRkZFfVxcdXs0RkZGRn1cXHV7NUZGRkV9XFx1ezVGRkZGfVxcdXs2RkZGRX1cXHV7NkZGRkZ9XFx1ezdGRkZFfVxcdXs3RkZGRn1cXHV7OEZGRkV9XFx1ezhGRkZGfVxcdXs5RkZGRX1cXHV7OUZGRkZ9XFx1e0FGRkZFfVxcdXtBRkZGRn1cXHV7QkZGRkV9XFx1e0JGRkZGfVxcdXtDRkZGRX1cXHV7Q0ZGRkZ9XFx1e0RGRkZFfVxcdXtERkZGRn1cXHV7RUZGRkV9XFx1e0VGRkZGfVxcdXtGRkZGRX1cXHV7RkZGRkZ9XFx1ezEwRkZGRX1cXHV7MTBGRkZGfV0vdTtcbi8vIGh0dHBzOi8vaHRtbC5zcGVjLndoYXR3Zy5vcmcvbXVsdGlwYWdlL3N5bnRheC5odG1sI2F0dHJpYnV0ZXMtMlxuLy8gaHR0cHM6Ly9pbmZyYS5zcGVjLndoYXR3Zy5vcmcvI25vbmNoYXJhY3RlclxuXG5mdW5jdGlvbiBzcHJlYWQoYXJncykge1xuXHRjb25zdCBhdHRyaWJ1dGVzID0gT2JqZWN0LmFzc2lnbih7fSwgLi4uYXJncyk7XG5cdGxldCBzdHIgPSAnJztcblxuXHRPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKS5mb3JFYWNoKG5hbWUgPT4ge1xuXHRcdGlmIChpbnZhbGlkX2F0dHJpYnV0ZV9uYW1lX2NoYXJhY3Rlci50ZXN0KG5hbWUpKSByZXR1cm47XG5cblx0XHRjb25zdCB2YWx1ZSA9IGF0dHJpYnV0ZXNbbmFtZV07XG5cdFx0aWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybjtcblx0XHRpZiAodmFsdWUgPT09IHRydWUpIHN0ciArPSBcIiBcIiArIG5hbWU7XG5cblx0XHRjb25zdCBlc2NhcGVkID0gU3RyaW5nKHZhbHVlKVxuXHRcdFx0LnJlcGxhY2UoL1wiL2csICcmIzM0OycpXG5cdFx0XHQucmVwbGFjZSgvJy9nLCAnJiMzOTsnKTtcblxuXHRcdHN0ciArPSBcIiBcIiArIG5hbWUgKyBcIj1cIiArIEpTT04uc3RyaW5naWZ5KGVzY2FwZWQpO1xuXHR9KTtcblxuXHRyZXR1cm4gc3RyO1xufVxuXG5jb25zdCBlc2NhcGVkID0ge1xuXHQnXCInOiAnJnF1b3Q7Jyxcblx0XCInXCI6ICcmIzM5OycsXG5cdCcmJzogJyZhbXA7Jyxcblx0JzwnOiAnJmx0OycsXG5cdCc+JzogJyZndDsnXG59O1xuXG5mdW5jdGlvbiBlc2NhcGUoaHRtbCkge1xuXHRyZXR1cm4gU3RyaW5nKGh0bWwpLnJlcGxhY2UoL1tcIicmPD5dL2csIG1hdGNoID0+IGVzY2FwZWRbbWF0Y2hdKTtcbn1cblxuZnVuY3Rpb24gZWFjaChpdGVtcywgZm4pIHtcblx0bGV0IHN0ciA9ICcnO1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IGl0ZW1zLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0c3RyICs9IGZuKGl0ZW1zW2ldLCBpKTtcblx0fVxuXHRyZXR1cm4gc3RyO1xufVxuXG5jb25zdCBtaXNzaW5nX2NvbXBvbmVudCA9IHtcblx0JCRyZW5kZXI6ICgpID0+ICcnXG59O1xuXG5mdW5jdGlvbiB2YWxpZGF0ZV9jb21wb25lbnQoY29tcG9uZW50LCBuYW1lKSB7XG5cdGlmICghY29tcG9uZW50IHx8ICFjb21wb25lbnQuJCRyZW5kZXIpIHtcblx0XHRpZiAobmFtZSA9PT0gJ3N2ZWx0ZTpjb21wb25lbnQnKSBuYW1lICs9ICcgdGhpcz17Li4ufSc7XG5cdFx0dGhyb3cgbmV3IEVycm9yKGA8JHtuYW1lfT4gaXMgbm90IGEgdmFsaWQgU1NSIGNvbXBvbmVudC4gWW91IG1heSBuZWVkIHRvIHJldmlldyB5b3VyIGJ1aWxkIGNvbmZpZyB0byBlbnN1cmUgdGhhdCBkZXBlbmRlbmNpZXMgYXJlIGNvbXBpbGVkLCByYXRoZXIgdGhhbiBpbXBvcnRlZCBhcyBwcmUtY29tcGlsZWQgbW9kdWxlc2ApO1xuXHR9XG5cblx0cmV0dXJuIGNvbXBvbmVudDtcbn1cblxuZnVuY3Rpb24gZGVidWcoZmlsZSwgbGluZSwgY29sdW1uLCB2YWx1ZXMpIHtcblx0Y29uc29sZS5sb2coYHtAZGVidWd9ICR7ZmlsZSA/IGZpbGUgKyAnICcgOiAnJ30oJHtsaW5lfToke2NvbHVtbn0pYCk7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tY29uc29sZVxuXHRjb25zb2xlLmxvZyh2YWx1ZXMpOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLWNvbnNvbGVcblx0cmV0dXJuICcnO1xufVxuXG5sZXQgb25fZGVzdHJveTtcblxuZnVuY3Rpb24gY3JlYXRlX3Nzcl9jb21wb25lbnQoZm4pIHtcblx0ZnVuY3Rpb24gJCRyZW5kZXIocmVzdWx0LCBwcm9wcywgYmluZGluZ3MsIHNsb3RzKSB7XG5cdFx0Y29uc3QgcGFyZW50X2NvbXBvbmVudCA9IGN1cnJlbnRfY29tcG9uZW50O1xuXG5cdFx0Y29uc3QgJCQgPSB7XG5cdFx0XHRvbl9kZXN0cm95LFxuXHRcdFx0Y29udGV4dDogbmV3IE1hcChwYXJlbnRfY29tcG9uZW50ID8gcGFyZW50X2NvbXBvbmVudC4kJC5jb250ZXh0IDogW10pLFxuXG5cdFx0XHQvLyB0aGVzZSB3aWxsIGJlIGltbWVkaWF0ZWx5IGRpc2NhcmRlZFxuXHRcdFx0b25fbW91bnQ6IFtdLFxuXHRcdFx0YmVmb3JlX3JlbmRlcjogW10sXG5cdFx0XHRhZnRlcl9yZW5kZXI6IFtdLFxuXHRcdFx0Y2FsbGJhY2tzOiBibGFua19vYmplY3QoKVxuXHRcdH07XG5cblx0XHRzZXRfY3VycmVudF9jb21wb25lbnQoeyAkJCB9KTtcblxuXHRcdGNvbnN0IGh0bWwgPSBmbihyZXN1bHQsIHByb3BzLCBiaW5kaW5ncywgc2xvdHMpO1xuXG5cdFx0c2V0X2N1cnJlbnRfY29tcG9uZW50KHBhcmVudF9jb21wb25lbnQpO1xuXHRcdHJldHVybiBodG1sO1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRyZW5kZXI6IChwcm9wcyA9IHt9LCBvcHRpb25zID0ge30pID0+IHtcblx0XHRcdG9uX2Rlc3Ryb3kgPSBbXTtcblxuXHRcdFx0Y29uc3QgcmVzdWx0ID0geyBoZWFkOiAnJywgY3NzOiBuZXcgU2V0KCkgfTtcblx0XHRcdGNvbnN0IGh0bWwgPSAkJHJlbmRlcihyZXN1bHQsIHByb3BzLCB7fSwgb3B0aW9ucyk7XG5cblx0XHRcdHJ1bl9hbGwob25fZGVzdHJveSk7XG5cblx0XHRcdHJldHVybiB7XG5cdFx0XHRcdGh0bWwsXG5cdFx0XHRcdGNzczoge1xuXHRcdFx0XHRcdGNvZGU6IEFycmF5LmZyb20ocmVzdWx0LmNzcykubWFwKGNzcyA9PiBjc3MuY29kZSkuam9pbignXFxuJyksXG5cdFx0XHRcdFx0bWFwOiBudWxsIC8vIFRPRE9cblx0XHRcdFx0fSxcblx0XHRcdFx0aGVhZDogcmVzdWx0LmhlYWRcblx0XHRcdH07XG5cdFx0fSxcblxuXHRcdCQkcmVuZGVyXG5cdH07XG59XG5cbmZ1bmN0aW9uIGdldF9zdG9yZV92YWx1ZShzdG9yZSkge1xuXHRsZXQgdmFsdWU7XG5cdHN0b3JlLnN1YnNjcmliZShfID0+IHZhbHVlID0gXykoKTtcblx0cmV0dXJuIHZhbHVlO1xufVxuXG5mdW5jdGlvbiBiaW5kKGNvbXBvbmVudCwgbmFtZSwgY2FsbGJhY2spIHtcblx0aWYgKGNvbXBvbmVudC4kJC5wcm9wcy5pbmRleE9mKG5hbWUpID09PSAtMSkgcmV0dXJuO1xuXHRjb21wb25lbnQuJCQuYm91bmRbbmFtZV0gPSBjYWxsYmFjaztcblx0Y2FsbGJhY2soY29tcG9uZW50LiQkLmN0eFtuYW1lXSk7XG59XG5cbmZ1bmN0aW9uIG1vdW50X2NvbXBvbmVudChjb21wb25lbnQsIHRhcmdldCwgYW5jaG9yKSB7XG5cdGNvbnN0IHsgZnJhZ21lbnQsIG9uX21vdW50LCBvbl9kZXN0cm95LCBhZnRlcl9yZW5kZXIgfSA9IGNvbXBvbmVudC4kJDtcblxuXHRmcmFnbWVudC5tKHRhcmdldCwgYW5jaG9yKTtcblxuXHQvLyBvbk1vdW50IGhhcHBlbnMgYWZ0ZXIgdGhlIGluaXRpYWwgYWZ0ZXJVcGRhdGUuIEJlY2F1c2Vcblx0Ly8gYWZ0ZXJVcGRhdGUgY2FsbGJhY2tzIGhhcHBlbiBpbiByZXZlcnNlIG9yZGVyIChpbm5lciBmaXJzdClcblx0Ly8gd2Ugc2NoZWR1bGUgb25Nb3VudCBjYWxsYmFja3MgYmVmb3JlIGFmdGVyVXBkYXRlIGNhbGxiYWNrc1xuXHRhZGRfcmVuZGVyX2NhbGxiYWNrKCgpID0+IHtcblx0XHRjb25zdCBuZXdfb25fZGVzdHJveSA9IG9uX21vdW50Lm1hcChydW4pLmZpbHRlcihpc19mdW5jdGlvbik7XG5cdFx0aWYgKG9uX2Rlc3Ryb3kpIHtcblx0XHRcdG9uX2Rlc3Ryb3kucHVzaCguLi5uZXdfb25fZGVzdHJveSk7XG5cdFx0fSBlbHNlIHtcblx0XHRcdC8vIEVkZ2UgY2FzZSAtIGNvbXBvbmVudCB3YXMgZGVzdHJveWVkIGltbWVkaWF0ZWx5LFxuXHRcdFx0Ly8gbW9zdCBsaWtlbHkgYXMgYSByZXN1bHQgb2YgYSBiaW5kaW5nIGluaXRpYWxpc2luZ1xuXHRcdFx0cnVuX2FsbChuZXdfb25fZGVzdHJveSk7XG5cdFx0fVxuXHRcdGNvbXBvbmVudC4kJC5vbl9tb3VudCA9IFtdO1xuXHR9KTtcblxuXHRhZnRlcl9yZW5kZXIuZm9yRWFjaChhZGRfcmVuZGVyX2NhbGxiYWNrKTtcbn1cblxuZnVuY3Rpb24gZGVzdHJveShjb21wb25lbnQsIGRldGFjaGluZykge1xuXHRpZiAoY29tcG9uZW50LiQkKSB7XG5cdFx0cnVuX2FsbChjb21wb25lbnQuJCQub25fZGVzdHJveSk7XG5cdFx0Y29tcG9uZW50LiQkLmZyYWdtZW50LmQoZGV0YWNoaW5nKTtcblxuXHRcdC8vIFRPRE8gbnVsbCBvdXQgb3RoZXIgcmVmcywgaW5jbHVkaW5nIGNvbXBvbmVudC4kJCAoYnV0IG5lZWQgdG9cblx0XHQvLyBwcmVzZXJ2ZSBmaW5hbCBzdGF0ZT8pXG5cdFx0Y29tcG9uZW50LiQkLm9uX2Rlc3Ryb3kgPSBjb21wb25lbnQuJCQuZnJhZ21lbnQgPSBudWxsO1xuXHRcdGNvbXBvbmVudC4kJC5jdHggPSB7fTtcblx0fVxufVxuXG5mdW5jdGlvbiBtYWtlX2RpcnR5KGNvbXBvbmVudCwga2V5KSB7XG5cdGlmICghY29tcG9uZW50LiQkLmRpcnR5KSB7XG5cdFx0ZGlydHlfY29tcG9uZW50cy5wdXNoKGNvbXBvbmVudCk7XG5cdFx0c2NoZWR1bGVfdXBkYXRlKCk7XG5cdFx0Y29tcG9uZW50LiQkLmRpcnR5ID0ge307XG5cdH1cblx0Y29tcG9uZW50LiQkLmRpcnR5W2tleV0gPSB0cnVlO1xufVxuXG5mdW5jdGlvbiBpbml0KGNvbXBvbmVudCwgb3B0aW9ucywgaW5zdGFuY2UsIGNyZWF0ZV9mcmFnbWVudCwgbm90X2VxdWFsJCQxLCBwcm9wX25hbWVzKSB7XG5cdGNvbnN0IHBhcmVudF9jb21wb25lbnQgPSBjdXJyZW50X2NvbXBvbmVudDtcblx0c2V0X2N1cnJlbnRfY29tcG9uZW50KGNvbXBvbmVudCk7XG5cblx0Y29uc3QgcHJvcHMgPSBvcHRpb25zLnByb3BzIHx8IHt9O1xuXG5cdGNvbnN0ICQkID0gY29tcG9uZW50LiQkID0ge1xuXHRcdGZyYWdtZW50OiBudWxsLFxuXHRcdGN0eDogbnVsbCxcblxuXHRcdC8vIHN0YXRlXG5cdFx0cHJvcHM6IHByb3BfbmFtZXMsXG5cdFx0dXBkYXRlOiBub29wLFxuXHRcdG5vdF9lcXVhbDogbm90X2VxdWFsJCQxLFxuXHRcdGJvdW5kOiBibGFua19vYmplY3QoKSxcblxuXHRcdC8vIGxpZmVjeWNsZVxuXHRcdG9uX21vdW50OiBbXSxcblx0XHRvbl9kZXN0cm95OiBbXSxcblx0XHRiZWZvcmVfcmVuZGVyOiBbXSxcblx0XHRhZnRlcl9yZW5kZXI6IFtdLFxuXHRcdGNvbnRleHQ6IG5ldyBNYXAocGFyZW50X2NvbXBvbmVudCA/IHBhcmVudF9jb21wb25lbnQuJCQuY29udGV4dCA6IFtdKSxcblxuXHRcdC8vIGV2ZXJ5dGhpbmcgZWxzZVxuXHRcdGNhbGxiYWNrczogYmxhbmtfb2JqZWN0KCksXG5cdFx0ZGlydHk6IG51bGxcblx0fTtcblxuXHRsZXQgcmVhZHkgPSBmYWxzZTtcblxuXHQkJC5jdHggPSBpbnN0YW5jZVxuXHRcdD8gaW5zdGFuY2UoY29tcG9uZW50LCBwcm9wcywgKGtleSwgdmFsdWUpID0+IHtcblx0XHRcdGlmICgkJC5jdHggJiYgbm90X2VxdWFsJCQxKCQkLmN0eFtrZXldLCAkJC5jdHhba2V5XSA9IHZhbHVlKSkge1xuXHRcdFx0XHRpZiAoJCQuYm91bmRba2V5XSkgJCQuYm91bmRba2V5XSh2YWx1ZSk7XG5cdFx0XHRcdGlmIChyZWFkeSkgbWFrZV9kaXJ0eShjb21wb25lbnQsIGtleSk7XG5cdFx0XHR9XG5cdFx0fSlcblx0XHQ6IHByb3BzO1xuXG5cdCQkLnVwZGF0ZSgpO1xuXHRyZWFkeSA9IHRydWU7XG5cdHJ1bl9hbGwoJCQuYmVmb3JlX3JlbmRlcik7XG5cdCQkLmZyYWdtZW50ID0gY3JlYXRlX2ZyYWdtZW50KCQkLmN0eCk7XG5cblx0aWYgKG9wdGlvbnMudGFyZ2V0KSB7XG5cdFx0aWYgKG9wdGlvbnMuaHlkcmF0ZSkge1xuXHRcdFx0JCQuZnJhZ21lbnQubChjaGlsZHJlbihvcHRpb25zLnRhcmdldCkpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHQkJC5mcmFnbWVudC5jKCk7XG5cdFx0fVxuXG5cdFx0aWYgKG9wdGlvbnMuaW50cm8gJiYgY29tcG9uZW50LiQkLmZyYWdtZW50LmkpIGNvbXBvbmVudC4kJC5mcmFnbWVudC5pKCk7XG5cdFx0bW91bnRfY29tcG9uZW50KGNvbXBvbmVudCwgb3B0aW9ucy50YXJnZXQsIG9wdGlvbnMuYW5jaG9yKTtcblx0XHRmbHVzaCgpO1xuXHR9XG5cblx0c2V0X2N1cnJlbnRfY29tcG9uZW50KHBhcmVudF9jb21wb25lbnQpO1xufVxuXG5sZXQgU3ZlbHRlRWxlbWVudDtcbmlmICh0eXBlb2YgSFRNTEVsZW1lbnQgIT09ICd1bmRlZmluZWQnKSB7XG5cdFN2ZWx0ZUVsZW1lbnQgPSBjbGFzcyBleHRlbmRzIEhUTUxFbGVtZW50IHtcblx0XHRjb25zdHJ1Y3RvcigpIHtcblx0XHRcdHN1cGVyKCk7XG5cdFx0XHR0aGlzLmF0dGFjaFNoYWRvdyh7IG1vZGU6ICdvcGVuJyB9KTtcblx0XHR9XG5cblx0XHRjb25uZWN0ZWRDYWxsYmFjaygpIHtcblx0XHRcdGZvciAoY29uc3Qga2V5IGluIHRoaXMuJCQuc2xvdHRlZCkge1xuXHRcdFx0XHR0aGlzLmFwcGVuZENoaWxkKHRoaXMuJCQuc2xvdHRlZFtrZXldKTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRhdHRyaWJ1dGVDaGFuZ2VkQ2FsbGJhY2soYXR0ciQkMSwgb2xkVmFsdWUsIG5ld1ZhbHVlKSB7XG5cdFx0XHR0aGlzW2F0dHIkJDFdID0gbmV3VmFsdWU7XG5cdFx0fVxuXG5cdFx0JGRlc3Ryb3koKSB7XG5cdFx0XHRkZXN0cm95KHRoaXMsIHRydWUpO1xuXHRcdFx0dGhpcy4kZGVzdHJveSA9IG5vb3A7XG5cdFx0fVxuXG5cdFx0JG9uKHR5cGUsIGNhbGxiYWNrKSB7XG5cdFx0XHQvLyBUT0RPIHNob3VsZCB0aGlzIGRlbGVnYXRlIHRvIGFkZEV2ZW50TGlzdGVuZXI/XG5cdFx0XHRjb25zdCBjYWxsYmFja3MgPSAodGhpcy4kJC5jYWxsYmFja3NbdHlwZV0gfHwgKHRoaXMuJCQuY2FsbGJhY2tzW3R5cGVdID0gW10pKTtcblx0XHRcdGNhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKTtcblxuXHRcdFx0cmV0dXJuICgpID0+IHtcblx0XHRcdFx0Y29uc3QgaW5kZXggPSBjYWxsYmFja3MuaW5kZXhPZihjYWxsYmFjayk7XG5cdFx0XHRcdGlmIChpbmRleCAhPT0gLTEpIGNhbGxiYWNrcy5zcGxpY2UoaW5kZXgsIDEpO1xuXHRcdFx0fTtcblx0XHR9XG5cblx0XHQkc2V0KCkge1xuXHRcdFx0Ly8gb3ZlcnJpZGRlbiBieSBpbnN0YW5jZSwgaWYgaXQgaGFzIHByb3BzXG5cdFx0fVxuXHR9O1xufVxuXG5jbGFzcyBTdmVsdGVDb21wb25lbnQge1xuXHQkZGVzdHJveSgpIHtcblx0XHRkZXN0cm95KHRoaXMsIHRydWUpO1xuXHRcdHRoaXMuJGRlc3Ryb3kgPSBub29wO1xuXHR9XG5cblx0JG9uKHR5cGUsIGNhbGxiYWNrKSB7XG5cdFx0Y29uc3QgY2FsbGJhY2tzID0gKHRoaXMuJCQuY2FsbGJhY2tzW3R5cGVdIHx8ICh0aGlzLiQkLmNhbGxiYWNrc1t0eXBlXSA9IFtdKSk7XG5cdFx0Y2FsbGJhY2tzLnB1c2goY2FsbGJhY2spO1xuXG5cdFx0cmV0dXJuICgpID0+IHtcblx0XHRcdGNvbnN0IGluZGV4ID0gY2FsbGJhY2tzLmluZGV4T2YoY2FsbGJhY2spO1xuXHRcdFx0aWYgKGluZGV4ICE9PSAtMSkgY2FsbGJhY2tzLnNwbGljZShpbmRleCwgMSk7XG5cdFx0fTtcblx0fVxuXG5cdCRzZXQoKSB7XG5cdFx0Ly8gb3ZlcnJpZGRlbiBieSBpbnN0YW5jZSwgaWYgaXQgaGFzIHByb3BzXG5cdH1cbn1cblxuY2xhc3MgU3ZlbHRlQ29tcG9uZW50RGV2IGV4dGVuZHMgU3ZlbHRlQ29tcG9uZW50IHtcblx0Y29uc3RydWN0b3Iob3B0aW9ucykge1xuXHRcdGlmICghb3B0aW9ucyB8fCAoIW9wdGlvbnMudGFyZ2V0ICYmICFvcHRpb25zLiQkaW5saW5lKSkge1xuXHRcdFx0dGhyb3cgbmV3IEVycm9yKGAndGFyZ2V0JyBpcyBhIHJlcXVpcmVkIG9wdGlvbmApO1xuXHRcdH1cblxuXHRcdHN1cGVyKCk7XG5cdH1cblxuXHQkZGVzdHJveSgpIHtcblx0XHRzdXBlci4kZGVzdHJveSgpO1xuXHRcdHRoaXMuJGRlc3Ryb3kgPSAoKSA9PiB7XG5cdFx0XHRjb25zb2xlLndhcm4oYENvbXBvbmVudCB3YXMgYWxyZWFkeSBkZXN0cm95ZWRgKTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1jb25zb2xlXG5cdFx0fTtcblx0fVxufVxuXG5leHBvcnQgeyBjcmVhdGVfYW5pbWF0aW9uLCBmaXhfcG9zaXRpb24sIGhhbmRsZV9wcm9taXNlLCBhcHBlbmQsIGluc2VydCwgZGV0YWNoLCBkZXRhY2hfYmV0d2VlbiwgZGV0YWNoX2JlZm9yZSwgZGV0YWNoX2FmdGVyLCBkZXN0cm95X2VhY2gsIGVsZW1lbnQsIHN2Z19lbGVtZW50LCB0ZXh0LCBzcGFjZSwgZW1wdHksIGxpc3RlbiwgcHJldmVudF9kZWZhdWx0LCBzdG9wX3Byb3BhZ2F0aW9uLCBhdHRyLCBzZXRfYXR0cmlidXRlcywgc2V0X2N1c3RvbV9lbGVtZW50X2RhdGEsIHhsaW5rX2F0dHIsIGdldF9iaW5kaW5nX2dyb3VwX3ZhbHVlLCB0b19udW1iZXIsIHRpbWVfcmFuZ2VzX3RvX2FycmF5LCBjaGlsZHJlbiwgY2xhaW1fZWxlbWVudCwgY2xhaW1fdGV4dCwgc2V0X2RhdGEsIHNldF9pbnB1dF90eXBlLCBzZXRfc3R5bGUsIHNlbGVjdF9vcHRpb24sIHNlbGVjdF9vcHRpb25zLCBzZWxlY3RfdmFsdWUsIHNlbGVjdF9tdWx0aXBsZV92YWx1ZSwgYWRkX3Jlc2l6ZV9saXN0ZW5lciwgdG9nZ2xlX2NsYXNzLCBjdXN0b21fZXZlbnQsIGRlc3Ryb3lfYmxvY2ssIG91dHJvX2FuZF9kZXN0cm95X2Jsb2NrLCBmaXhfYW5kX291dHJvX2FuZF9kZXN0cm95X2Jsb2NrLCB1cGRhdGVfa2V5ZWRfZWFjaCwgbWVhc3VyZSwgY3VycmVudF9jb21wb25lbnQsIHNldF9jdXJyZW50X2NvbXBvbmVudCwgYmVmb3JlVXBkYXRlLCBvbk1vdW50LCBhZnRlclVwZGF0ZSwgb25EZXN0cm95LCBjcmVhdGVFdmVudERpc3BhdGNoZXIsIHNldENvbnRleHQsIGdldENvbnRleHQsIGJ1YmJsZSwgY2xlYXJfbG9vcHMsIGxvb3AsIGRpcnR5X2NvbXBvbmVudHMsIGludHJvcywgc2NoZWR1bGVfdXBkYXRlLCB0aWNrLCBhZGRfYmluZGluZ19jYWxsYmFjaywgYWRkX3JlbmRlcl9jYWxsYmFjaywgYWRkX2ZsdXNoX2NhbGxiYWNrLCBmbHVzaCwgZ2V0X3NwcmVhZF91cGRhdGUsIGludmFsaWRfYXR0cmlidXRlX25hbWVfY2hhcmFjdGVyLCBzcHJlYWQsIGVzY2FwZWQsIGVzY2FwZSwgZWFjaCwgbWlzc2luZ19jb21wb25lbnQsIHZhbGlkYXRlX2NvbXBvbmVudCwgZGVidWcsIGNyZWF0ZV9zc3JfY29tcG9uZW50LCBnZXRfc3RvcmVfdmFsdWUsIGdyb3VwX291dHJvcywgY2hlY2tfb3V0cm9zLCBvbl9vdXRybywgY3JlYXRlX2luX3RyYW5zaXRpb24sIGNyZWF0ZV9vdXRfdHJhbnNpdGlvbiwgY3JlYXRlX2JpZGlyZWN0aW9uYWxfdHJhbnNpdGlvbiwgbm9vcCwgaWRlbnRpdHksIGFzc2lnbiwgaXNfcHJvbWlzZSwgYWRkX2xvY2F0aW9uLCBydW4sIGJsYW5rX29iamVjdCwgcnVuX2FsbCwgaXNfZnVuY3Rpb24sIHNhZmVfbm90X2VxdWFsLCBub3RfZXF1YWwsIHZhbGlkYXRlX3N0b3JlLCBzdWJzY3JpYmUsIGNyZWF0ZV9zbG90LCBnZXRfc2xvdF9jb250ZXh0LCBnZXRfc2xvdF9jaGFuZ2VzLCBleGNsdWRlX2ludGVybmFsX3Byb3BzLCBiaW5kLCBtb3VudF9jb21wb25lbnQsIGluaXQsIFN2ZWx0ZUVsZW1lbnQsIFN2ZWx0ZUNvbXBvbmVudCwgU3ZlbHRlQ29tcG9uZW50RGV2IH07XG4iLCIvLyBwYXRoIHRvIHdoZXJlIHRoZSBpbWFnZXMgYXJlIGRvd25sb2FkZWRcclxuLy9jb25zdCBDQVJEX0RBVEEgPSByZXF1aXJlKFwiLi9zY3J5ZmFsbC1kZWZhdWx0LWNhcmRzLmpzb25cIik7XHJcblxyXG5cclxuLy9jb25zdCBmcyA9IHJlcXVpcmUoXCJmc1wiKTtcclxuXHJcbmNvbnN0IE9iamVjdElkID0gKCkgPT4geyByZXR1cm4gRGF0ZS5ub3coKSB9OyAvLyByZXF1aXJlKFwiYnNvbi1vYmplY3RpZFwiKTtcclxuXHJcblxyXG5jb25zdCBURU1QID0gXCJ0ZW1wXCI7XHJcbmNvbnN0IF9fZGlybmFtZSA9IFwiLi9cIjtcclxuXHJcbmZ1bmN0aW9uIHRpbWVvdXQoKSB7XHJcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICByZXNvbHZlKCk7XHJcbiAgICB9LCA3MCk7XHJcbiAgfSk7XHJcbn1cclxuXHJcblxyXG5cclxuXHJcbi8qXHJcblxyXG4qL1xyXG5cclxuXHJcbmNsYXNzIE10Z0ludGVyZmFjZSB7XHJcblxyXG4gIGNvbnN0cnVjdG9yKGlwY1JlbmRlcmVyKSB7XHJcbiAgICB0aGlzLl9fY2FjaGUgPSB7fTtcclxuICAgIHRoaXMuaXBjUmVuZGVyZXIgPSBpcGNSZW5kZXJlcjtcclxuICAgIHRoaXMuZG93bmxvYWRzID0gUHJvbWlzZS5yZXNvbHZlKCk7XHJcbiAgICB0aGlzLmZldGNoZXMgPSBQcm9taXNlLnJlc29sdmUoKTtcclxuXHJcblxyXG4gICAgdGhpcy5sb2FkUHJvbXMgPSB7fTtcclxuICAgIHRoaXMuZXhpc3RQcm9tcyA9IHt9O1xyXG5cclxuICAgIGlwY1JlbmRlcmVyLm9uKFwiZmlsZUxvYWRlZFwiLCAoc2VuZGVyLCBkYXRhKSA9PiB7XHJcbiAgICAgIGNvbnN0IGMgPSB0aGlzLmxvYWRQcm9tc1tkYXRhLmlkXTtcclxuICAgICAgaWYgKCFjKSByZXR1cm47XHJcbiAgICAgIGlmIChkYXRhLmVycm9yKSBjLnJlamVjdChkYXRhLmVycm9yKTtcclxuICAgICAgZWxzZSBjLnJlc29sdmUoSlNPTi5wYXJzZShkYXRhLnJlc3VsdCB8fCBcInt9XCIpKVxyXG4gICAgICBkZWxldGUgdGhpcy5sb2FkUHJvbXNbZGF0YS5pZF07XHJcbiAgICB9KTtcclxuXHJcbiAgICBpcGNSZW5kZXJlci5vbihcImZpbGVDaGVja2VkXCIsIChzZW5kZXIsIGRhdGEpID0+IHtcclxuICAgICAgY29uc3QgYyA9IHRoaXMuZXhpc3RQcm9tc1tkYXRhLmlkXTtcclxuICAgICAgaWYgKCFjKSByZXR1cm47XHJcbiAgICAgIGlmIChkYXRhLmVycm9yKSBjLnJlc29sdmUoZmFsc2UpOyAvL2MucmVqZWN0KGRhdGEuZXJyb3IpO1xyXG4gICAgICBlbHNlIGMucmVzb2x2ZSh0cnVlKVxyXG4gICAgICBkZWxldGUgdGhpcy5leGlzdFByb21zW2RhdGEuaWRdO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuXHJcbiAgZG9lc0ZpbGVFeGlzdChwYXRoKSB7XHJcbiAgICBjb25zdCBpZCA9IE9iamVjdElkKCkudG9TdHJpbmcoKTtcclxuICAgIGNvbnN0IHAgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcblxyXG4gICAgICB0aGlzLmlwY1JlbmRlcmVyLnNlbmQoXCJjaGVja0ZpbGVcIiwgeyBwYXRoLCBpZCB9KTtcclxuICAgICAgdGhpcy5leGlzdFByb21zW2lkXSA9IHsgcmVzb2x2ZSwgcmVqZWN0IH07XHJcbiAgICB9KTtcclxuICAgIHJldHVybiBwO1xyXG4gIH1cclxuXHJcbiAgc2F2ZUZpbGUocGF0aCwgY29udGVudCkge1xyXG4gICAgY29uc3QgaWQgPSBPYmplY3RJZCgpLnRvU3RyaW5nKCk7XHJcbiAgICBjb250ZW50ID0gSlNPTi5zdHJpbmdpZnkoY29udGVudCk7XHJcbiAgICB0aGlzLmlwY1JlbmRlcmVyLnNlbmQoXCJzYXZlRmlsZVwiLCB7IHBhdGgsIGNvbnRlbnQsIGlkIH0pO1xyXG5cclxuICAgIC8qICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICAgIGZzLndyaXRlRmlsZShmaWxlLCBjb250ZW50LCBmdW5jdGlvbihlcnIpIHtcclxuICAgICAgICAgIGlmIChlcnIpIHJldHVybiByZWplY3QoZXJyKTtcclxuICAgICAgICAgIHJlc29sdmUoKTtcclxuICAgICAgICB9KTtcclxuICAgICAgfSk7Ki9cclxuICB9XHJcblxyXG4gIGxvYWRGaWxlKHBhdGgpIHtcclxuICAgIGNvbnN0IGlkID0gT2JqZWN0SWQoKS50b1N0cmluZygpO1xyXG4gICAgY29uc3QgcCA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgdGhpcy5pcGNSZW5kZXJlci5zZW5kKFwibG9hZEZpbGVcIiwgeyBwYXRoLCBpZCB9KTtcclxuICAgICAgdGhpcy5sb2FkUHJvbXNbaWRdID0geyByZXNvbHZlLCByZWplY3QgfTtcclxuICAgIH0pO1xyXG4gICAgcmV0dXJuIHA7XHJcbiAgfVxyXG5cclxuXHJcbiAgc2VhcmNoKG9wdHMgPSB7fSkge1xyXG4gICAgLy8gaHR0cHM6Ly9hcGkuc2NyeWZhbGwuY29tL2NhcmRzL3NlYXJjaD9vcmRlcj1jbWMmcT1jJTNBcmVkK3BvdyUzRDMgXHJcbiAgICAvLyBodHRwczovL3NjcnlmYWxsLmNvbS9zZWFyY2g/YXM9Z3JpZCZvcmRlcj1uYW1lJnE9bXlyK29yYWNsZSUzQXRva2VuK3R5cGUlM0FjcmVhdHVyZStjb21tYW5kZXIlM0FXVUJSR1xyXG5cclxuICAgIGxldCBiYXNldXJsO1xyXG5cclxuICAgIGlmICh0eXBlb2Ygb3B0cyAhPSBcInN0cmluZ1wiKSB7XHJcbiAgICAgIGJhc2V1cmwgPSBgaHR0cHM6Ly9hcGkuc2NyeWZhbGwuY29tL2NhcmRzL3NlYXJjaD8ke29wdHMucGFnZT9cInBhZ2U9XCIrb3B0cy5wYWdlK1wiJlwiOlwiXCJ9b3JkZXI9Y21jJnE9YDtcclxuICAgICAgY29uc3QgcXVlcmllcyA9IFtdO1xyXG5cclxuICAgICAgaWYgKG9wdHMubmFtZSkge1xyXG4gICAgICAgIHF1ZXJpZXMucHVzaChvcHRzLm5hbWUpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAob3B0cy5lZGhjb2xvcnMgJiYgb3B0cy5lZGhjb2xvcnMuc2l6ZSkge1xyXG4gICAgICAgIGxldCBjcyA9IFwiXCI7XHJcbiAgICAgICAgZm9yIChsZXQgY29sb3Igb2Ygb3B0cy5lZGhjb2xvcnMpIHtcclxuICAgICAgICAgIGNvbG9yID0gY29sb3IudG9VcHBlckNhc2UoKTtcclxuICAgICAgICAgIGlmIChjb2xvciA9PT0gXCJDXCIpIHtcclxuICAgICAgICAgICAgY3MgPSBcIkNcIjtcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBjcyArPSBjb2xvcjtcclxuICAgICAgICB9XHJcbiAgICAgICAgcXVlcmllcy5wdXNoKFwiY29tbWFuZGVyJTNBXCIgKyBjcyk7XHJcbiAgICAgIH1cclxuXHJcblxyXG4gICAgICBpZiAob3B0cy50eXBlKSB7XHJcbiAgICAgICAgbGV0IHR5cGUgPSBvcHRzLnR5cGUudHJpbSgpLnJlcGxhY2UoL1xcc1xccysvZ20sIFwiIFwiKS5yZXBsYWNlKC9cXHMvZ20sIFwiK3R5cGUlM0FcIik7XHJcbiAgICAgICAgcXVlcmllcy5wdXNoKFwidHlwZSUzQVwiICsgdHlwZSk7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKG9wdHMudGV4dCkge1xyXG4gICAgICAgIGxldCB0ZXh0ID0gb3B0cy50ZXh0LnRyaW0oKS5yZXBsYWNlKC9cXHNcXHMrL2dtLCBcIiBcIikucmVwbGFjZSgvXFxzKy9nbSwgXCIrb3JhY2xlJTNBXCIpO1xyXG4gICAgICAgIHF1ZXJpZXMucHVzaChcIm9yYWNsZSUzQVwiICsgdGV4dCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGJhc2V1cmwgPSBiYXNldXJsICsgcXVlcmllcy5qb2luKFwiK1wiKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGJhc2V1cmwgPSBvcHRzO1xyXG4gICAgfVxyXG4gICAgY29uc29sZS5sb2coXCJzZWFyY2hxdWVyeVwiLCBiYXNldXJsKTtcclxuICAgIHJldHVybiBmZXRjaChiYXNldXJsKVxyXG4gICAgICAudGhlbihhc3luYyByZXNwb25zZSA9PiB7XHJcbiAgICAgICAgY29uc3QgYSA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKTtcclxuICAgICAgICByZXR1cm4gYTtcclxuICAgICAgfSlcclxuICAgICAgLnRoZW4ocmVzcG9uc2UgPT4ge1xyXG4gICAgICAgIGZvciAobGV0IGMgb2YgcmVzcG9uc2UuZGF0YSkge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coXCJjXCIsIGMpO1xyXG4gICAgICAgICAgaWYgKCFjLmltYWdlX3VyaXMpIHtcclxuICAgICAgICAgICAgaWYgKGMuY2FyZF9mYWNlcykge1xyXG4gICAgICAgICAgICAgIGMuaW1hZ2VfdXJpcyA9IGMuY2FyZF9mYWNlc1swXS5pbWFnZV91cmlzO1xyXG4gICAgICAgICAgICAgIGNvbnN0IGJpdSA9IGMuY2FyZF9mYWNlc1sxXS5pbWFnZV91cmlzO1xyXG4gICAgICAgICAgICAgIGMuYmFja3NpZGUgPSBiaXUgPyBiaXUuYm9yZGVyX2Nyb3AgfHwgYml1Lm5vcm1hbCA6IFwiXCI7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGMudXJsID0gYyA/IGMuaW1hZ2VfdXJpcy5ib3JkZXJfY3JvcCB8fCBjLmltYWdlX3VyaXMubm9ybWFsIDogXCJcIjtcclxuICAgICAgICAgIGMuY2FyZG1hcmtldCA9IChjLnB1cmNoYXNlX3VyaXMgfHwge30pLmNhcmRtYXJrZXQgfHwgXCJcIjtcclxuICAgICAgICAgIHRoaXMuX19jYWNoZVtjLm5hbWVdID0gYztcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHJlc3BvbnNlO1xyXG4gICAgICB9KVxyXG4gICAgICAuY2F0Y2goZSA9PiB7IGNvbnNvbGUubG9nKGUpOyByZXR1cm4geyBjb2RlOiBcIm5vdF9mb3VuZFwiLCBkYXRhOiBbXSB9OyB9KTtcclxuXHJcbiAgfVxyXG5cclxuICBhc3luYyBjYXJkQnlOYW1lKG5hbWUpIHtcclxuICAgIGlmICh0aGlzLl9fY2FjaGVbbmFtZV0pIHJldHVybiB0aGlzLl9fY2FjaGVbbmFtZV07XHJcblxyXG4gICAgY29uc3QgcCA9IG5hbWU7IC8vcGF0aC5qb2luKF9fZGlybmFtZSwgVEVNUCwgbmFtZSk7XHJcbiAgICBjb25zdCBleGlzdHMgPSBhd2FpdCB0aGlzLmRvZXNGaWxlRXhpc3QocCk7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgaWYgKGV4aXN0cykge1xyXG4gICAgICAgIHRoaXMuX19jYWNoZVtuYW1lXSA9IGF3YWl0IHRoaXMubG9hZEZpbGUocCk7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX19jYWNoZVtuYW1lXTtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKFwiY291bGQgbm90IGxvYWQgbG9jYWwgZmlsZVwiLCBuYW1lLCBlLm1lc3NhZ2UpO1xyXG4gICAgfVxyXG5cclxuXHJcbiAgICBhd2FpdCB0aW1lb3V0KCk7XHJcbiAgICAvL2h0dHBzOi8vYXBpLnNjcnlmYWxsLmNvbS9jYXJkcy9uYW1lZD9mdXp6eT1hdXN0K2NvbSBcclxuICAgIGNvbnN0IGZpeGVkID0gbmFtZS5yZXBsYWNlKC9cXHMvZywgXCIrXCIpO1xyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZmV0Y2goJ2h0dHBzOi8vYXBpLnNjcnlmYWxsLmNvbS9jYXJkcy9uYW1lZD9mdXp6eT0nICsgZml4ZWQpXHJcbiAgICAgIC50aGVuKHJlc3BvbnNlID0+IHJlc3BvbnNlLmpzb24oKSkuY2F0Y2goZSA9PiB7IGNvbnNvbGUubG9nKGUpOyByZXR1cm4geyBjb2RlOiBcIm5vdF9mb3VuZFwiIH07IH0pO1xyXG5cclxuICAgIHRoaXMuX19jYWNoZVtuYW1lXSA9IHJlc3VsdDtcclxuICAgIHRoaXMuX19jYWNoZVtyZXN1bHQubmFtZV0gPSByZXN1bHQ7XHJcbiAgICB0aGlzLnNhdmVGaWxlKG5hbWUsIHRoaXMuX19jYWNoZVtuYW1lXSk7XHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgLy8gLnRoZW4oZGF0YSA9PiBjb25zb2xlLmxvZyhkYXRhKSk7XHJcbiAgICAvKiBmb3IgKGxldCBjYXJkIG9mIENBUkRfREFUQSkge1xyXG4gICAgICAgaWYgKGNhcmQubmFtZS50b0xvd2VyQ2FzZSgpID09IG5hbWUudG9Mb3dlckNhc2UoKSkgcmV0dXJuIGNhcmQ7XHJcbiAgICAgfSovXHJcbiAgfVxyXG5cclxuICBhc3luYyBzb3J0KGRlY2tTdHJpbmcsIHVwZGF0ZSA9ICgpID0+IHt9KSB7XHJcbiAgICBkZWNrU3RyaW5nID0gZGVja1N0cmluZy5yZXBsYWNlKC8jLiovZ20sIFwiXCIpO1xyXG4gICAgY29uc3QgZGVja1JhdyA9IGRlY2tTdHJpbmcudHJpbSgpLnJlcGxhY2UoL1xcKCguKj8pXFwpfChbMC05XSpcXG4pL2csIFwiXFxuXCIpLnJlcGxhY2UoL1xccypcXG4rXFxzKlxcbisvZywgXCJcXG5cIikuc3BsaXQoXCJcXG5cIik7XHJcblxyXG4gICAgbGV0IGNyZWF0dXJlcyA9IHt9O1xyXG4gICAgbGV0IHNwZWxscyA9IHt9O1xyXG4gICAgbGV0IGxhbmRzID0ge307XHJcblxyXG5cclxuXHJcbiAgICBsZXQgbWF5YmUgPSBbXTtcclxuICAgIGNvbnN0IGVycm9ycyA9IFtdO1xyXG5cclxuXHJcbiAgICBsZXQgcHJvZ3Jlc3MgPSAwO1xyXG4gICAgZm9yIChsZXQgY2FyZCBvZiBkZWNrUmF3KSB7XHJcblxyXG4gICAgICBsZXQgY291bnQgPSBNYXRoLmZsb29yKCgoY2FyZC5tYXRjaCgvKFxcZCspLykgfHwgW10pWzBdIHx8IDEpKTtcclxuICAgICAgaWYgKGlzTmFOKGNvdW50KSkge1xyXG4gICAgICAgIGNvdW50ID0gMTtcclxuICAgICAgfVxyXG4gICAgICBwcm9ncmVzcysrO1xyXG5cclxuICAgICAgaWYgKGNhcmQudHJpbSgpLnN0YXJ0c1dpdGgoXCIvL1wiKSkge1xyXG4gICAgICAgIG1heWJlLnB1c2goY2FyZC50cmltKCkpO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgbmFtZSA9IGNhcmQucmVwbGFjZSgvKFxcZCspLywgXCJcIikudHJpbSgpO1xyXG4gICAgICBpZiAoIW5hbWUpIGNvbnRpbnVlOyAvLyBjYW50IHdvcmsgd2l0aCB0aGlzIGRhdGFcclxuICAgICAgLy8gc2VhcmNoIHRoZSBhY2NvcmRpbmcgZGF0YVxyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGxldCBkYXRhID0gYXdhaXQgdGhpcy5jYXJkQnlOYW1lKG5hbWUpO1xyXG5cclxuICAgICAgICBpZiAoZGF0YS50eXBlX2xpbmUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhcImxhbmRcIikpIHtcclxuICAgICAgICAgIGxhbmRzW2RhdGEubmFtZV0gPSBsYW5kc1tkYXRhLm5hbWVdIHx8IHsgZGF0YSwgY291bnQ6IDAsIG5hbWU6IGRhdGEubmFtZSB9O1xyXG4gICAgICAgICAgbGFuZHNbZGF0YS5uYW1lXS5jb3VudCsrO1xyXG4gICAgICAgIH0gZWxzZSBpZiAoZGF0YS50eXBlX2xpbmUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhcImNyZWF0dXJlXCIpKSB7XHJcbiAgICAgICAgICBjcmVhdHVyZXNbZGF0YS5uYW1lXSA9IGNyZWF0dXJlc1tkYXRhLm5hbWVdIHx8IHsgZGF0YSwgY291bnQ6IDAsIG5hbWU6IGRhdGEubmFtZSB9O1xyXG4gICAgICAgICAgY3JlYXR1cmVzW2RhdGEubmFtZV0uY291bnQrKztcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgc3BlbGxzW2RhdGEubmFtZV0gPSBzcGVsbHNbZGF0YS5uYW1lXSB8fCB7IGRhdGEsIGNvdW50OiAwLCBuYW1lOiBkYXRhLm5hbWUgfTtcclxuICAgICAgICAgIHNwZWxsc1tkYXRhLm5hbWVdLmNvdW50Kys7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGVycm9ycy5wdXNoKG5hbWUpO1xyXG4gICAgICB9XHJcbiAgICAgIHVwZGF0ZShwcm9ncmVzcywgZGVja1Jhdy5sZW5ndGgpO1xyXG4gICAgfVxyXG5cclxuICAgIGNyZWF0dXJlcyA9IE9iamVjdC52YWx1ZXMoY3JlYXR1cmVzKS5zb3J0KChhLCBiKSA9PiBhLmRhdGEuY21jID4gYi5kYXRhLmNtYyA/IDEgOiAtMSk7XHJcbiAgICBzcGVsbHMgPSBPYmplY3QudmFsdWVzKHNwZWxscykuc29ydCgoYSwgYikgPT4gYS5kYXRhLmNtYyA+IGIuZGF0YS5jbWMgPyAxIDogLTEpO1xyXG4gICAgbGFuZHMgPSBPYmplY3QudmFsdWVzKGxhbmRzKS5zb3J0KChhLCBiKSA9PiBhLm5hbWUgPiBiLm5hbWUgPyAxIDogLTEpO1xyXG4gICAgbGV0IG91dHB1dCA9IFwiIyBDcmVhdHVyZXNcIjtcclxuICAgIGZvciAobGV0IGN1ciBvZiBjcmVhdHVyZXMpIHtcclxuICAgICAgb3V0cHV0ICs9IFwiXFxuXCIgKyBjdXIuY291bnQgKyBcIiBcIiArIGN1ci5uYW1lO1xyXG4gICAgfVxyXG4gICAgb3V0cHV0ICs9IFwiXFxuXFxuIyBTcGVsbHNcIjtcclxuICAgIGZvciAobGV0IGN1ciBvZiBzcGVsbHMpIHtcclxuICAgICAgb3V0cHV0ICs9IFwiXFxuXCIgKyBjdXIuY291bnQgKyBcIiBcIiArIGN1ci5uYW1lO1xyXG4gICAgfVxyXG5cclxuICAgIG91dHB1dCArPSBcIlxcblxcbiMgTGFuZHNcIlxyXG4gICAgZm9yIChsZXQgY3VyIG9mIGxhbmRzKSB7XHJcbiAgICAgIG91dHB1dCArPSBcIlxcblwiICsgY3VyLmNvdW50ICsgXCIgXCIgKyBjdXIubmFtZTtcclxuICAgIH1cclxuXHJcbiAgICBvdXRwdXQgKz0gXCJcXG5cXG4jIE1heWJlXCJcclxuICAgIGZvciAobGV0IGN1ciBvZiBtYXliZSkge1xyXG4gICAgICBvdXRwdXQgKz0gXCJcXG4vL1wiICsgY3VyO1xyXG4gICAgfVxyXG5cclxuICAgIG91dHB1dCArPSBcIlxcblxcbiMgTm90IEZvdW5kXCJcclxuICAgIGZvciAobGV0IGN1ciBvZiBlcnJvcnMpIHtcclxuICAgICAgb3V0cHV0ICs9IFwiXFxuLy9cIiArIGN1ci5jb3VudCArIFwiIFwiICsgY3VyLm5hbWU7XHJcbiAgICB9XHJcblxyXG5cclxuICAgIHJldHVybiBvdXRwdXQ7XHJcbiAgfVxyXG5cclxuXHJcbiAgLyoqXHJcbiAgICogY29udmVydHMgYSBkZWNrIHN0cmluZyB0byBhIHJlYWRhYmxlIG9iamVjdFxyXG4gICAqIGFuZCBkb3dubG9hZHMgdGhlIGltZyBkYXRhIG9uIGRlbWFuZCwgaWYgaXQgZG9lcyBub3QgZXhpc3RcclxuICAgKlxyXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBkZWNrU3RyaW5nIHRoZSBjb21wbGV0ZSBkZWNrLCBjb3BpZWQgZnJvbSBhIHNpdGUgb3IgZS5nIGZvcmdlXHJcbiAgICogQG1lbWJlcm9mIE10Z0ludGVyZmFjZVxyXG4gICAqL1xyXG4gIGFzeW5jIGNyZWF0ZURlY2soZGVja1N0cmluZywgdXBkYXRlID0gKCkgPT4ge30sIHNvcnQgPSBmYWxzZSkge1xyXG4gICAgLy8gY29udmVydCB0aGUgZGVjayBzdHJpbmcgdG8gYW4gYXJyYXlcclxuXHJcblxyXG5cclxuXHJcblxyXG5cclxuXHJcbiAgICBsZXQgZ3JvdXBzID0gWy4uLmRlY2tTdHJpbmcubWF0Y2goLyMoLio/KShcXG58JCkvZykgfHwgW1wibWFpblwiXV07XHJcbiAgICBjb25zdCBkZWNrUmF3ID0gZGVja1N0cmluZy50cmltKCkucmVwbGFjZSgvXFwoKC4qPylcXCl8KFswLTldKlxcbikvZywgXCJcXG5cIikucmVwbGFjZSgvXFxzKlxcbitcXHMqXFxuKy9nLCBcIlxcblwiKS5zcGxpdChcIlxcblwiKTtcclxuICAgIGlmICghZGVja1JhdykgcmV0dXJuIFtdO1xyXG4gICAgaWYgKCFkZWNrUmF3WzBdLmluY2x1ZGVzKFwiI1wiKSkge1xyXG4gICAgICBpZiAoZ3JvdXBzWzBdICE9PSBcIm1haW5cIikge1xyXG4gICAgICAgIGdyb3VwcyA9IFtcIm1haW5cIl0uY29uY2F0KGdyb3Vwcyk7XHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGRlY2tSYXcuc2hpZnQoKTtcclxuICAgIH1cclxuXHJcblxyXG4gICAgZ3JvdXBzID0gZ3JvdXBzLm1hcCh2ID0+IHsgcmV0dXJuIHsgZGVjazoge30sIG5hbWU6IHYucmVwbGFjZShcIiNcIiwgXCJcIikudHJpbSgpIH0gfSk7XHJcblxyXG4gICAgbGV0IGN1ckdyb3VwID0gMDtcclxuXHJcbiAgICBsZXQgcHJvZ3Jlc3MgPSAwO1xyXG4gICAgbGV0IGlnbm9yZWQgPSAwO1xyXG4gICAgLy8gaXRlcmF0ZSBlYWNoIGZvdW5kIGNhcmRcclxuICAgIGZvciAobGV0IGNhcmQgb2YgZGVja1Jhdykge1xyXG4gICAgICBpZiAoIWNhcmQpIGNvbnRpbnVlO1xyXG4gICAgICBpZiAoY2FyZC50cmltKCkuc3RhcnRzV2l0aChcIi8vXCIpKSBjb250aW51ZTtcclxuICAgICAgaWYgKGNhcmQuaW5jbHVkZXMoXCIjXCIpKSB7XHJcbiAgICAgICAgY3VyR3JvdXArKztcclxuICAgICAgICBpZiAoY3VyR3JvdXAgPiBncm91cHMubGVuZ3RoKSBjdXJHcm91cCA9IDA7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuICAgICAgcHJvZ3Jlc3MrKztcclxuXHJcbiAgICAgIGNvbnN0IGRlY2sgPSBncm91cHNbY3VyR3JvdXBdLmRlY2s7XHJcbiAgICAgIHVwZGF0ZShwcm9ncmVzcywgZGVja1Jhdy5sZW5ndGggLSBncm91cHMubGVuZ3RoICsgMSAtIGlnbm9yZWQpO1xyXG4gICAgICAvLyBleHRyYWN0IHRoZSBjb3VudCBmcm9tIHRoZSBzdHJpbmcgYW5kIGZyZWUgdGhlIG5hbWVcclxuXHJcbiAgICAgIGxldCBjb3VudCA9IE1hdGguZmxvb3IoKChjYXJkLm1hdGNoKC8oXFxkKykvKSB8fCBbXSlbMF0gfHwgMSkpO1xyXG4gICAgICBpZiAoaXNOYU4oY291bnQpKSB7XHJcbiAgICAgICAgY291bnQgPSAxO1xyXG4gICAgICB9XHJcbiAgICAgIGNvbnN0IG5hbWUgPSBjYXJkLnJlcGxhY2UoLyhcXGQrKS8sIFwiXCIpLnRyaW0oKTtcclxuICAgICAgaWYgKCFuYW1lKSBjb250aW51ZTsgLy8gY2FudCB3b3JrIHdpdGggdGhpcyBkYXRhXHJcbiAgICAgIC8vIHNlYXJjaCB0aGUgYWNjb3JkaW5nIGRhdGFcclxuICAgICAgbGV0IGRhdGEgPSBhd2FpdCB0aGlzLmNhcmRCeU5hbWUobmFtZSk7XHJcblxyXG4gICAgICBpZiAoZGF0YS5uYW1lKVxyXG4gICAgICAgIGRlY2tTdHJpbmcgPSBkZWNrU3RyaW5nLnJlcGxhY2UobmFtZSwgZGF0YS5uYW1lKTtcclxuICAgICAgaWYgKGRhdGEuY29kZSA9PSBcIm5vdF9mb3VuZFwiKSB7XHJcbiAgICAgICAgZGF0YSA9IHtcclxuICAgICAgICAgIGltYWdlX3VyaXM6IHt9LFxyXG4gICAgICAgICAgbGVnYWxpdGllczoge30sXHJcbiAgICAgICAgICBwcmljZXM6IHsgdXNkOiAwIH0sXHJcbiAgICAgICAgICBtYW5hX2Nvc3Q6IFwiXCIsXHJcbiAgICAgICAgICBjbWM6IDAsXHJcbiAgICAgICAgICB0eXBlX2xpbmU6IFwibGFuZFwiLFxyXG4gICAgICAgICAgcHVyY2hhc2VfdXJpczogeyBjYXJkbWFya2V0OiBcIlwiIH1cclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChkZWNrW25hbWVdKSB7XHJcbiAgICAgICAgZGVja1tuYW1lXS5jb3VudCArPSBjb3VudDtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICAvLyB3cmFwIGRhdGEgaW4gZWFzeSByZWFkYWJsZSBmb3JtYXRcclxuICAgICAgICBsZXQgYmFja3NpZGUgPSBcIlwiO1xyXG4gICAgICAgIGlmICghZGF0YS5pbWFnZV91cmlzKSB7XHJcbiAgICAgICAgICBpZiAoZGF0YS5jYXJkX2ZhY2VzKSB7XHJcbiAgICAgICAgICAgIGRhdGEuaW1hZ2VfdXJpcyA9IGRhdGEuY2FyZF9mYWNlc1swXS5pbWFnZV91cmlzO1xyXG4gICAgICAgICAgICBjb25zdCBiaXUgPSBkYXRhLmNhcmRfZmFjZXNbMV0uaW1hZ2VfdXJpcztcclxuICAgICAgICAgICAgYmFja3NpZGUgPSBiaXUgPyBiaXUuYm9yZGVyX2Nyb3AgfHwgYml1Lm5vcm1hbCA6IFwiXCI7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhcImVyclwiLCBkYXRhKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHVybCA9IGRhdGEgPyBkYXRhLmltYWdlX3VyaXMuYm9yZGVyX2Nyb3AgfHwgZGF0YS5pbWFnZV91cmlzLm5vcm1hbCA6IFwiXCI7XHJcbiAgICAgICAgZGVja1tuYW1lXSA9IHtcclxuICAgICAgICAgIG5hbWUsXHJcbiAgICAgICAgICBjb3VudCxcclxuICAgICAgICAgIHVybCxcclxuICAgICAgICAgIGJhY2tzaWRlLFxyXG4gICAgICAgICAgZGF0YVxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIGxldCBsYW5kQ291bnQgPSAwO1xyXG4gICAgY29uc3Qgb3ZlcmFsbERldm90aW9uID0ge1xyXG4gICAgICBibHVlOiAwLFxyXG4gICAgICBibGFjazogMCxcclxuICAgICAgcmVkOiAwLFxyXG4gICAgICB3aGl0ZTogMCxcclxuICAgICAgZ3JlZW46IDAsXHJcbiAgICAgIGNvbG9ybGVzczogMCxcclxuICAgICAgZ2VuZXJpYzogMCxcclxuICAgICAgc3VtOiAwXHJcbiAgICB9O1xyXG4gICAgY29uc3Qgb3ZlcmFsbE1hbmFDdXJ2ZSA9IFtdO1xyXG4gICAgLy9tYW5hX2Nvc3Q6IFwie1d9e1V9e0J9e1J9e0d9IHtDfVwiXHJcblxyXG4gICAgbGV0IG92ZXJhbGxDb3VudCA9IDA7XHJcbiAgICBsZXQgb3ZlcmFsbENvc3QgPSAwO1xyXG5cclxuICAgIGxldCBjcmVhdHVyZUNvdW50ID0gMDtcclxuICAgIGxldCBpbnN0YW50Q291bnQgPSAwO1xyXG4gICAgbGV0IHNvcmNlcnlDb3VudCA9IDA7XHJcbiAgICBsZXQgZW5jaGFudG1lbnRDb3VudCA9IDA7XHJcbiAgICBsZXQgYXJ0aWZhY3RDb3VudCA9IDA7XHJcbiAgICBsZXQgcGxhbmVzd2Fsa2VyQ291bnQgPSAwO1xyXG5cclxuICAgIGxldCB0eXBlQ291bnRzID0ge307XHJcblxyXG4gICAgLy9tYW5hX2Nvc3Quc3BsaXQoXCJHXCIpLmxlbmd0aCAtIDFcclxuICAgIGZvciAobGV0IGdyb3VwIG9mIGdyb3Vwcykge1xyXG5cclxuICAgICAgZ3JvdXAuY2FyZHMgPSBPYmplY3QudmFsdWVzKGdyb3VwLmRlY2spO1xyXG4gICAgICBncm91cC5jYXJkcyA9IGdyb3VwLmNhcmRzLnNvcnQoKGEsIGIpID0+IGEuZGF0YS5jbWMgPiBiLmRhdGEuY21jID8gMSA6IC0xKTtcclxuXHJcbiAgICAgIGxldCBjb3VudCA9IDA7XHJcbiAgICAgIGxldCBjb3N0ID0gMDtcclxuICAgICAgY29uc3QgaXNNYXliZSA9IGdyb3VwLm5hbWUudG9Mb3dlckNhc2UoKSA9PSBcIm1heWJlXCI7XHJcblxyXG5cclxuICAgICAgY29uc3QgZGV2b3Rpb24gPSB7XHJcbiAgICAgICAgYmx1ZTogMCxcclxuICAgICAgICBibGFjazogMCxcclxuICAgICAgICByZWQ6IDAsXHJcbiAgICAgICAgd2hpdGU6IDAsXHJcbiAgICAgICAgZ3JlZW46IDAsXHJcbiAgICAgICAgY29sb3JsZXNzOiAwLFxyXG4gICAgICAgIGdlbmVyaWM6IDAsXHJcbiAgICAgICAgc3VtOiAwXHJcbiAgICAgIH07XHJcbiAgICAgIGNvbnN0IG1hbmFDdXJ2ZSA9IFtdO1xyXG4gICAgICBmb3IgKGxldCBjYXJkIG9mIGdyb3VwLmNhcmRzKSB7XHJcbiAgICAgICAgY291bnQgKz0gY2FyZC5jb3VudDtcclxuICAgICAgICBpZiAoIWlzTWF5YmUpIHtcclxuXHJcbiAgICAgICAgICBjb3N0ICs9IHBhcnNlRmxvYXQoY2FyZC5kYXRhLnByaWNlcy51c2QgfHwgMCkgKiBjYXJkLmNvdW50O1xyXG5cclxuICAgICAgICAgIGlmIChjYXJkLmRhdGEudHlwZV9saW5lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJsYW5kXCIpKSB7XHJcbiAgICAgICAgICAgIGxhbmRDb3VudCArPSBjYXJkLmNvdW50O1xyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgbWFuYUN1cnZlW2NhcmQuZGF0YS5jbWMgfHwgMF0gPSAobWFuYUN1cnZlW2NhcmQuZGF0YS5jbWMgfHwgMF0gfHwgMCkgKyBjYXJkLmNvdW50O1xyXG4gICAgICAgICAgfVxyXG5cclxuICAgICAgICAgIGlmIChjYXJkLmRhdGEudHlwZV9saW5lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJjcmVhdHVyZVwiKSkge1xyXG4gICAgICAgICAgICBjcmVhdHVyZUNvdW50ICs9IGNhcmQuY291bnQ7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBpZiAoY2FyZC5kYXRhLnR5cGVfbGluZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKFwiYXJ0aWZhY3RcIikpIHtcclxuICAgICAgICAgICAgYXJ0aWZhY3RDb3VudCArPSBjYXJkLmNvdW50O1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgaWYgKGNhcmQuZGF0YS50eXBlX2xpbmUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhcImVuY2hhbnRtZW50XCIpKSB7XHJcbiAgICAgICAgICAgIGVuY2hhbnRtZW50Q291bnQgKz0gY2FyZC5jb3VudDtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGlmIChjYXJkLmRhdGEudHlwZV9saW5lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJpbnN0YW50XCIpKSB7XHJcbiAgICAgICAgICAgIGluc3RhbnRDb3VudCArPSBjYXJkLmNvdW50O1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgaWYgKGNhcmQuZGF0YS50eXBlX2xpbmUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhcInNvcmNlcnlcIikpIHtcclxuICAgICAgICAgICAgc29yY2VyeUNvdW50ICs9IGNhcmQuY291bnQ7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBpZiAoY2FyZC5kYXRhLnR5cGVfbGluZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKFwicGxhbmVzd2Fsa2VyXCIpKSB7XHJcbiAgICAgICAgICAgIHBsYW5lc3dhbGtlckNvdW50ICs9IGNhcmQuY291bnQ7XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgLy8gYW5kIG5vdyBhbGxcclxuXHJcbiAgICAgICAgICBjb25zdCB0eXBlcyA9IGNhcmQuZGF0YS50eXBlX2xpbmUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKFwiLVwiLCBcIiBcIikucmVwbGFjZShcIuKAlFwiLCBcIiBcIikucmVwbGFjZShcIi8vXCIsIFwiIFwiKS5yZXBsYWNlKFwiYmFzaWNcIiwgXCIgXCIpLnNwbGl0KFwiIFwiKTtcclxuICAgICAgICAgIGZvciAobGV0IHQgb2YgdHlwZXMpIHtcclxuICAgICAgICAgICAgdCA9IHQudHJpbSgpO1xyXG4gICAgICAgICAgICBpZiAoIXQpIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICBpZiAoIXR5cGVDb3VudHNbdF0pIHR5cGVDb3VudHNbdF0gPSAwO1xyXG4gICAgICAgICAgICB0eXBlQ291bnRzW3RdKys7XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY2FyZC5kYXRhLm1hbmFfY29zdCA9IGNhcmQuZGF0YS5tYW5hX2Nvc3QgfHwgXCJcIjtcclxuICAgICAgICBkZXZvdGlvbi5ibHVlICs9IChjYXJkLmRhdGEubWFuYV9jb3N0LnNwbGl0KFwiVVwiKS5sZW5ndGggLSAxKSAqIGNhcmQuY291bnQ7XHJcbiAgICAgICAgZGV2b3Rpb24uYmxhY2sgKz0gKGNhcmQuZGF0YS5tYW5hX2Nvc3Quc3BsaXQoXCJCXCIpLmxlbmd0aCAtIDEpICogY2FyZC5jb3VudDtcclxuICAgICAgICBkZXZvdGlvbi5yZWQgKz0gKGNhcmQuZGF0YS5tYW5hX2Nvc3Quc3BsaXQoXCJSXCIpLmxlbmd0aCAtIDEpICogY2FyZC5jb3VudDtcclxuICAgICAgICBkZXZvdGlvbi53aGl0ZSArPSAoY2FyZC5kYXRhLm1hbmFfY29zdC5zcGxpdChcIldcIikubGVuZ3RoIC0gMSkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIGRldm90aW9uLmdyZWVuICs9IChjYXJkLmRhdGEubWFuYV9jb3N0LnNwbGl0KFwiR1wiKS5sZW5ndGggLSAxKSAqIGNhcmQuY291bnQ7XHJcbiAgICAgICAgZGV2b3Rpb24uY29sb3JsZXNzICs9IChjYXJkLmRhdGEubWFuYV9jb3N0LnNwbGl0KFwiQ1wiKS5sZW5ndGggLSAxKSAqIGNhcmQuY291bnQ7XHJcbiAgICAgICAgZGV2b3Rpb24uZ2VuZXJpYyArPSBNYXRoLmZsb29yKGNhcmQuZGF0YS5tYW5hX2Nvc3QucmVwbGFjZSgvW14wLTkuXS9nLCBcIiBcIikudHJpbSgpLnJlcGxhY2UoL1xcc1xccysvZywgXCIgXCIpLnNwbGl0KFwiIFwiKS5yZWR1Y2UoKHRvdGFsLCBudW0pID0+IE1hdGguZmxvb3IodG90YWwpICsgTWF0aC5mbG9vcihudW0pKSkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIC8vIGRldm90aW9uLmdlbmVyaWMgKz0gTWF0aC5mbG9vcihjYXJkLmRhdGEubWFuYV9jb3N0LnJlcGxhY2UoL1teMC05Ll0vZywgXCJcIikgfHwgMCkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIGRldm90aW9uLnN1bSA9IChkZXZvdGlvbi5zdW0gfHwgMCkgKyAoTWF0aC5mbG9vcihjYXJkLmRhdGEuY21jKSAqIGNhcmQuY291bnQpOyAvLyBkZXZvdGlvbi5ibHVlICsgZGV2b3Rpb24uYmxhY2sgKyBkZXZvdGlvbi5yZWQgKyBkZXZvdGlvbi5ncmVlbiArIGRldm90aW9uLndoaXRlICsgZGV2b3Rpb24uY29sb3JsZXNzICsgZGV2b3Rpb24uZ2VuZXJpYztcclxuICAgICAgfVxyXG5cclxuXHJcblxyXG4gICAgICBncm91cC5jb3VudCA9IGNvdW50O1xyXG4gICAgICBncm91cC5tYW5hID0gZGV2b3Rpb247XHJcbiAgICAgIGdyb3VwLmNvc3QgPSBjb3N0O1xyXG5cclxuICAgICAgZ3JvdXAubWFuYUN1cnZlID0gbWFuYUN1cnZlO1xyXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG1hbmFDdXJ2ZS5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIG1hbmFDdXJ2ZVtpXSA9IG1hbmFDdXJ2ZVtpXSB8fCAwO1xyXG4gICAgICAgIGlmIChpc01heWJlKSBjb250aW51ZTtcclxuICAgICAgICBvdmVyYWxsTWFuYUN1cnZlW2ldID0gKG92ZXJhbGxNYW5hQ3VydmVbaV0gfHwgMCkgKyAobWFuYUN1cnZlW2ldIHx8IDApO1xyXG4gICAgICB9XHJcbiAgICAgIGlmICghaXNNYXliZSkge1xyXG5cclxuICAgICAgICBvdmVyYWxsQ29zdCArPSBjb3N0O1xyXG4gICAgICAgIG92ZXJhbGxDb3VudCArPSBjb3VudDtcclxuXHJcbiAgICAgICAgb3ZlcmFsbERldm90aW9uLmJsdWUgKz0gZGV2b3Rpb24uYmx1ZTtcclxuICAgICAgICBvdmVyYWxsRGV2b3Rpb24uYmxhY2sgKz0gZGV2b3Rpb24uYmxhY2s7XHJcbiAgICAgICAgb3ZlcmFsbERldm90aW9uLnJlZCArPSBkZXZvdGlvbi5yZWQ7XHJcbiAgICAgICAgb3ZlcmFsbERldm90aW9uLndoaXRlICs9IGRldm90aW9uLndoaXRlO1xyXG4gICAgICAgIG92ZXJhbGxEZXZvdGlvbi5ncmVlbiArPSBkZXZvdGlvbi5ncmVlbjtcclxuICAgICAgICBvdmVyYWxsRGV2b3Rpb24uY29sb3JsZXNzICs9IGRldm90aW9uLmNvbG9ybGVzcztcclxuXHJcbiAgICAgICAgb3ZlcmFsbERldm90aW9uLmdlbmVyaWMgKz0gZGV2b3Rpb24uZ2VuZXJpYztcclxuICAgICAgICBvdmVyYWxsRGV2b3Rpb24uc3VtICs9IGRldm90aW9uLnN1bTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgb3ZlcmFsbE1hbmFDdXJ2ZS5sZW5ndGg7IGkrKykge1xyXG4gICAgICBvdmVyYWxsTWFuYUN1cnZlW2ldID0gb3ZlcmFsbE1hbmFDdXJ2ZVtpXSB8fCAwO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG5vbmxhbmRzID0gb3ZlcmFsbENvdW50IC0gbGFuZENvdW50O1xyXG5cclxuICAgIGxldCBqdXN0RGV2b3Rpb24gPSBvdmVyYWxsRGV2b3Rpb24uYmx1ZSArIG92ZXJhbGxEZXZvdGlvbi5ibGFjayArIG92ZXJhbGxEZXZvdGlvbi5yZWQgKyBvdmVyYWxsRGV2b3Rpb24ud2hpdGUgKyBvdmVyYWxsRGV2b3Rpb24uZ3JlZW4gKyBvdmVyYWxsRGV2b3Rpb24uY29sb3JsZXNzO1xyXG4gICAganVzdERldm90aW9uID0ganVzdERldm90aW9uIHx8IDE7XHJcbiAgICBjb25zdCBtYW5hUHJvcG9zYWwgPSB7XHJcbiAgICAgIGJsdWU6IG92ZXJhbGxEZXZvdGlvbi5ibHVlIC8ganVzdERldm90aW9uLFxyXG4gICAgICBibGFjazogb3ZlcmFsbERldm90aW9uLmJsYWNrIC8ganVzdERldm90aW9uLFxyXG4gICAgICByZWQ6IG92ZXJhbGxEZXZvdGlvbi5yZWQgLyBqdXN0RGV2b3Rpb24sXHJcbiAgICAgIHdoaXRlOiBvdmVyYWxsRGV2b3Rpb24ud2hpdGUgLyBqdXN0RGV2b3Rpb24sXHJcbiAgICAgIGdyZWVuOiBvdmVyYWxsRGV2b3Rpb24uZ3JlZW4gLyBqdXN0RGV2b3Rpb24sXHJcbiAgICAgIGNvbG9ybGVzczogb3ZlcmFsbERldm90aW9uLmNvbG9ybGVzcyAvIGp1c3REZXZvdGlvbixcclxuICAgIH07XHJcblxyXG4gICAgZ3JvdXBzW1wibWFuYVByb3Bvc2FsXCJdID0gbWFuYVByb3Bvc2FsO1xyXG5cclxuICAgIGdyb3Vwc1tcImxhbmRDb3VudFwiXSA9IGxhbmRDb3VudDtcclxuICAgIGdyb3Vwc1tcImNhcmRDb3VudFwiXSA9IG92ZXJhbGxDb3VudDtcclxuICAgIGdyb3Vwc1tcImF2ZXJhZ2VNYW5hXCJdID0gb3ZlcmFsbERldm90aW9uLnN1bSAvIChvdmVyYWxsQ291bnQgLSBsYW5kQ291bnQpO1xyXG4gICAgZ3JvdXBzW1wiY29zdFwiXSA9IG92ZXJhbGxDb3N0O1xyXG4gICAgZ3JvdXBzW1wibWFuYVwiXSA9IG92ZXJhbGxEZXZvdGlvbjtcclxuICAgIGdyb3Vwc1tcImNvcnJlY3RlZFwiXSA9IGRlY2tTdHJpbmc7XHJcbiAgICBncm91cHNbXCJtYW5hQ3VydmVcIl0gPSBvdmVyYWxsTWFuYUN1cnZlO1xyXG5cclxuXHJcbiAgICBncm91cHNbXCJjcmVhdHVyZUNvdW50XCJdID0gY3JlYXR1cmVDb3VudDtcclxuICAgIGdyb3Vwc1tcImluc3RhbnRDb3VudFwiXSA9IGluc3RhbnRDb3VudDtcclxuICAgIGdyb3Vwc1tcInNvcmNlcnlDb3VudFwiXSA9IHNvcmNlcnlDb3VudDtcclxuICAgIGdyb3Vwc1tcInBsYW5lc3dhbGtlckNvdW50XCJdID0gcGxhbmVzd2Fsa2VyQ291bnQ7XHJcbiAgICBncm91cHNbXCJlbmNoYW50bWVudENvdW50XCJdID0gZW5jaGFudG1lbnRDb3VudDtcclxuICAgIGdyb3Vwc1tcImFydGlmYWN0Q291bnRcIl0gPSBhcnRpZmFjdENvdW50O1xyXG4gICAgZ3JvdXBzW1widHlwZUNvdW50c1wiXSA9IHR5cGVDb3VudHM7XHJcblxyXG4gICAgZGVsZXRlIHR5cGVDb3VudHMuZW5jaGFudG1lbnQ7XHJcbiAgICBkZWxldGUgdHlwZUNvdW50cy5wbGFuZXN3YWxrZXI7XHJcbiAgICBkZWxldGUgdHlwZUNvdW50cy5zb3JjZXJ5O1xyXG4gICAgZGVsZXRlIHR5cGVDb3VudHMuaW5zdGFudDtcclxuICAgIGRlbGV0ZSB0eXBlQ291bnRzLmFydGlmYWN0O1xyXG4gICAgZGVsZXRlIHR5cGVDb3VudHMuY3JlYXR1cmU7XHJcbiAgICBkZWxldGUgdHlwZUNvdW50cy5sYW5kO1xyXG5cclxuICAgIGxldCB0eXBlTmFtZXMgPSBPYmplY3Qua2V5cyh0eXBlQ291bnRzKTtcclxuICAgIGNvbnNvbGUubG9nKFwiYlwiLCB0eXBlTmFtZXMpO1xyXG4gICAgdHlwZU5hbWVzID0gdHlwZU5hbWVzLnNvcnQoKGEsIGIpID0+IHR5cGVDb3VudHNbYV0gPCB0eXBlQ291bnRzW2JdID8gMSA6IC0xKTtcclxuICAgIGNvbnNvbGUubG9nKFwiYVwiLCB0eXBlTmFtZXMpO1xyXG4gICAgZ3JvdXBzW1widHlwZU5hbWVzXCJdID0gdHlwZU5hbWVzO1xyXG4gICAgcmV0dXJuIGdyb3VwcztcclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gTXRnSW50ZXJmYWNlOyIsIjxzY3JpcHQ+XHJcbiAgaW1wb3J0IHsgb25Nb3VudCB9IGZyb20gXCJzdmVsdGVcIjtcclxuICAvLyBjb25zdCB7IGlwY1JlbmRlcmVyIH0gPSByZXF1aXJlKFwiZWxlY3Ryb25cIik7XHJcblxyXG4gIGNvbnN0IGlwYyA9IHJlcXVpcmUoXCJlbGVjdHJvblwiKS5pcGNSZW5kZXJlcjtcclxuICBpbXBvcnQgY2wgZnJvbSBcIi4vY2FyZC1sb2FkZXIuanNcIjtcclxuICBjb25zdCBDYXJkTG9hZGVyID0gbmV3IGNsKGlwYyk7XHJcbiAgLy8gaW1wb3J0IExaVVRGOCBmcm9tIFwibHp1dGY4XCI7XHJcbiAgLy9pbXBvcnQgQ29va2llcyBmcm9tIFwianMtY29va2llXCI7XHJcblxyXG4gIGNvbnN0IENvb2tpZXMgPSB7XHJcbiAgICBzZXQ6ICgpID0+IHt9LFxyXG4gICAgZ2V0OiAoKSA9PiB7fVxyXG4gIH07XHJcblxyXG4gIGNvbnN0IENBUkRfUkFUSU8gPSAwLjcxNzY0NzA1ODgyO1xyXG4gIGxldCBfaGVpZ2h0ID0gMzAwO1xyXG4gIGxldCBfd2lkdGggPSBNYXRoLmZsb29yKF9oZWlnaHQgKiBDQVJEX1JBVElPKTtcclxuXHJcbiAgbGV0IHVzZUNvb2tpZXMgPSB0cnVlO1xyXG5cclxuICBmdW5jdGlvbiBlbmFibGVTYXZpbmcoKSB7XHJcbiAgICB1c2VDb29raWVzID0gdHJ1ZTtcclxuICAgIENvb2tpZXMuc2V0KFwidXNlQ29va2llc1wiLCB0cnVlKTtcclxuICAgIHNhdmVBbGxUb0Nvb2tpZXMoKTtcclxuICB9XHJcblxyXG4gIGNvbnN0IG9sZFNldCA9IENvb2tpZXMuc2V0O1xyXG4gIENvb2tpZXMuc2V0ID0gKGEsIGIpID0+IHtcclxuICAgIGlmICh1c2VDb29raWVzKSBvbGRTZXQoYSwgYik7XHJcbiAgICBlbHNlIHtcclxuICAgICAgY29uc29sZS5sb2coXCJzYXZpbmcgZGlzYWJsZWRcIik7XHJcbiAgICB9XHJcbiAgfTtcclxuXHJcbiAgbGV0IGhlaWdodCA9IF9oZWlnaHQ7XHJcbiAgbGV0IHdpZHRoID0gX3dpZHRoO1xyXG4gIGxldCBjYXJkU2VhcmNoQWN0aXZlID0gdHJ1ZTtcclxuICBsZXQgc3RhdGlzdGljc0FjdGl2ZSA9IHRydWU7XHJcbiAgbGV0IHNjYWxpbmcgPSAxMDA7XHJcblxyXG4gIGxldCBkaXNwbGF5O1xyXG5cclxuICBsZXQgZGV2b3Rpb25IaWdobGlnaHQgPSAtMTtcclxuXHJcbiAgZnVuY3Rpb24gaGlnaGxpZ2h0RGV2b3Rpb24obWFuYSkge1xyXG4gICAgaWYgKGRldm90aW9uSGlnaGxpZ2h0ID09IG1hbmEpIGRldm90aW9uSGlnaGxpZ2h0ID0gLTE7XHJcbiAgICBlbHNlIGRldm90aW9uSGlnaGxpZ2h0ID0gbWFuYSArIFwiXCI7XHJcbiAgfVxyXG5cclxuICAkOiB7XHJcbiAgICBjb25zdCBzID0gTWF0aC5mbG9vcihzY2FsaW5nIHx8IDEwMCkgLyAxMDA7XHJcbiAgICBoZWlnaHQgPSBfaGVpZ2h0ICogcztcclxuICAgIHdpZHRoID0gX3dpZHRoICogcztcclxuICB9XHJcblxyXG4gIGxldCBwcm9taXNlID0gbmV3IFByb21pc2UocmVzb2x2ZSA9PiByZXNvbHZlKFtdKSk7XHJcbiAgbGV0IGNhcmRTZWFyY2hQcm9taXNlID0gbmV3IFByb21pc2UocmVzb2x2ZSA9PlxyXG4gICAgcmVzb2x2ZSh7IGRhdGE6IFtdLCBoYXNfbW9yZTogZmFsc2UsIHRvdGFsX2NhcmRzOiAwIH0pXHJcbiAgKTtcclxuXHJcbiAgbGV0IGlucHV0O1xyXG4gIGxldCBmb3JtYXQ7XHJcbiAgbGV0IHByb2dyZXNzID0gMDtcclxuICBsZXQgYWxsID0gMDtcclxuXHJcbiAgbGV0IHNwTmFtZTtcclxuICBsZXQgc3BUZXh0O1xyXG4gIGxldCBzcFR5cGU7XHJcblxyXG4gIGxldCBzcEVESEJsdWU7XHJcbiAgbGV0IHNwRURIQmxhY2s7XHJcbiAgbGV0IHNwRURIUmVkO1xyXG4gIGxldCBzcEVESFdoaXRlO1xyXG4gIGxldCBzcEVESEdyZWVuO1xyXG4gIGxldCBzcEVESENvbG9ybGVzcztcclxuXHJcbiAgbGV0IGRlY2tTZWFjaCA9IG51bGw7XHJcbiAgbGV0IGRlY2tTZWFyY2hJbnB1dDtcclxuXHJcbiAgZnVuY3Rpb24gY2hhbmdlRGVja1NlYXJjaChncm91cHMpIHtcclxuICAgIGlmICghZ3JvdXBzKSByZXR1cm5kZWNrU2VhY2ggPSBudWxsO1xyXG4gICAgbGV0IHMgPSBkZWNrU2VhcmNoSW5wdXQudmFsdWU7XHJcbiAgICBpZiAoIXMpIHJldHVybiAoZGVja1NlYWNoID0gbnVsbCk7XHJcblxyXG4gICAgcyA9IHNcclxuICAgICAgLnRyaW0oKVxyXG4gICAgICAucmVwbGFjZSgvXFxzXFxzKy9nbSwgXCIgXCIpXHJcbiAgICAgIC50b0xvd2VyQ2FzZSgpXHJcbiAgICAgIC5yZXBsYWNlKC9cXHMvZ20sIFwiKC58XFxuKSpcIik7XHJcbiAgICAvKiAgICAuc3BsaXQoXCIrXCIpXHJcbiAgICAgIC5qb2luKFwifFwiKTsqL1xyXG4gICAgY29uc29sZS5sb2coXCJzZWFyY2g6XCIsIHMpO1xyXG4gICAgY29uc3QgcmVzdWx0ID0gW107XHJcbiAgICBsZXQgY291bnQgPSAwO1xyXG4gICAgY29uc3QgciA9IG5ldyBSZWdFeHAocywgXCJnbVwiKTtcclxuICAgIGZvciAobGV0IGdyb3VwIG9mIGdyb3Vwcykge1xyXG4gICAgICBmb3IgKGxldCBjYXJkIG9mIGdyb3VwLmNhcmRzKSB7XHJcbiAgICAgICAgaWYgKCFjYXJkIHx8ICFjYXJkLmRhdGEgfHwgIWNhcmQuZGF0YS5vcmFjbGVfdGV4dCkgY29udGludWU7XHJcbiAgICAgICAgaWYgKCFjYXJkLmRhdGEub3JhY2xlX3RleHQudG9Mb3dlckNhc2UoKS5tYXRjaChyKSkgY29udGludWU7XHJcbiAgICAgICAgY291bnQgKz0gY2FyZC5jb3VudDtcclxuICAgICAgICByZXN1bHQucHVzaChjYXJkKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGRlY2tTZWFjaCA9IFtcclxuICAgICAge1xyXG4gICAgICAgIGNhcmRzOiByZXN1bHQsXHJcbiAgICAgICAgY29zdDogMCxcclxuICAgICAgICBjb3VudCxcclxuICAgICAgICBkZWNrOiB7fSxcclxuICAgICAgICBtYW5hOiB7XHJcbiAgICAgICAgICBibGFjazogMCxcclxuICAgICAgICAgIGJsdWU6IDAsXHJcbiAgICAgICAgICBjb2xvcmxlc3M6IDAsXHJcbiAgICAgICAgICBnZW5lcmljOiAyNDAsXHJcbiAgICAgICAgICBncmVlbjogMCxcclxuICAgICAgICAgIHJlZDogMCxcclxuICAgICAgICAgIHN1bTogMjQwLFxyXG4gICAgICAgICAgd2hpdGU6IDBcclxuICAgICAgICB9LFxyXG4gICAgICAgIG1hbmFDdXJ2ZTogW10sXHJcbiAgICAgICAgbmFtZTogXCJzZWFyY2ggcmVzdWx0XCJcclxuICAgICAgfVxyXG4gICAgXTtcclxuICB9XHJcbiAgZnVuY3Rpb24gY2xlYXJGb3JDb2xvcmxlc3MoKSB7XHJcbiAgICBzcEVESEJsdWUuY2hlY2tlZCA9IGZhbHNlO1xyXG4gICAgc3BFREhCbGFjay5jaGVja2VkID0gZmFsc2U7XHJcbiAgICBzcEVESFJlZC5jaGVja2VkID0gZmFsc2U7XHJcbiAgICBzcEVESFdoaXRlLmNoZWNrZWQgPSBmYWxzZTtcclxuICAgIHNwRURIR3JlZW4uY2hlY2tlZCA9IGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gY2xlYXJDb2xvcmxlc3MoKSB7XHJcbiAgICBzcEVESENvbG9ybGVzcy5jaGVja2VkID0gZmFsc2U7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBzZWFyY2hDYXJkcyhuZXh0VXJsKSB7XHJcbiAgICBpZiAodHlwZW9mIG5leHRVcmwgPT0gXCJzdHJpbmdcIikge1xyXG4gICAgICBjYXJkU2VhcmNoUHJvbWlzZSA9IENhcmRMb2FkZXIuc2VhcmNoKG5leHRVcmwpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCBjb2xvcnMgPSBuZXcgU2V0KCk7XHJcbiAgICBpZiAoc3BFREhDb2xvcmxlc3MuY2hlY2tlZCkgY29sb3JzLmFkZChcIkNcIik7XHJcbiAgICBpZiAoc3BFREhCbHVlLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJVXCIpO1xyXG4gICAgaWYgKHNwRURIQmxhY2suY2hlY2tlZCkgY29sb3JzLmFkZChcIkJcIik7XHJcbiAgICBpZiAoc3BFREhSZWQuY2hlY2tlZCkgY29sb3JzLmFkZChcIlJcIik7XHJcbiAgICBpZiAoc3BFREhXaGl0ZS5jaGVja2VkKSBjb2xvcnMuYWRkKFwiV1wiKTtcclxuICAgIGlmIChzcEVESEdyZWVuLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJHXCIpO1xyXG5cclxuICAgIGNhcmRTZWFyY2hQcm9taXNlID0gQ2FyZExvYWRlci5zZWFyY2goe1xyXG4gICAgICBuYW1lOiBzcE5hbWUudmFsdWUsXHJcbiAgICAgIHRleHQ6IHNwVGV4dC52YWx1ZSxcclxuICAgICAgdHlwZTogc3BUeXBlLnZhbHVlLFxyXG4gICAgICBlZGhjb2xvcnM6IGNvbG9yc1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBsZXQgY3VycmVudENhcmRDb250ZXh0ID0gbnVsbDtcclxuICBmdW5jdGlvbiBjYXJkQ29udGV4dE1lbnUoZXZ0LCBjYXJkLCBncm91cHMpIHtcclxuICAgIGV2dC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgaWYgKGV2dC53aGljaCA9PSAzICYmIGdyb3Vwcy5sZW5ndGggPiAxKSB7XHJcbiAgICAgIC8vIHJpZ2h0IGNsaWNrXHJcbiAgICAgIGN1cnJlbnRDYXJkQ29udGV4dCA9IGNhcmQ7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBjYXJkQ29udGV4dENsaWNrKGV2dCwgY2FyZCwgZ3JvdXApIHtcclxuICAgIGN1cnJlbnRDYXJkQ29udGV4dCA9IG51bGw7XHJcbiAgICBldnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICBldnQucHJldmVudERlZmF1bHQoKTtcclxuICAgIGxldCBkZWNrID0gaW5wdXQudmFsdWU7XHJcblxyXG4gICAgY29uc3QgciA9IG5ldyBSZWdFeHAoYF4uKiR7Y2FyZC5uYW1lfS4qJGAsIFwiZ21pXCIpO1xyXG4gICAgZGVjayA9IGRlY2sucmVwbGFjZShyLCBcIlwiKTtcclxuICAgIGxldCBpbmRleCA9IGRlY2suaW5kZXhPZihncm91cC5uYW1lKTtcclxuICAgIGlmIChpbmRleCA8IDApIHJldHVybjtcclxuICAgIGluZGV4ICs9IGdyb3VwLm5hbWUubGVuZ3RoO1xyXG5cclxuICAgIGNvbnN0IGluc2VydCA9IFwiXFxuXCIgKyBjYXJkLmNvdW50ICsgXCIgXCIgKyBjYXJkLm5hbWU7XHJcbiAgICBkZWNrID0gZGVjay5zbGljZSgwLCBpbmRleCkgKyBpbnNlcnQgKyBkZWNrLnNsaWNlKGluZGV4KTtcclxuICAgIGlucHV0LnZhbHVlID0gZGVjaztcclxuICAgIHJlbG9hZCgpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gb25NYWluTW91c2VEb3duKGV2dCkge1xyXG4gICAgY3VycmVudENhcmRDb250ZXh0ID0gbnVsbDtcclxuICB9XHJcblxyXG4gIGxldCBoaWRkZW5Hcm91cHMgPSBuZXcgU2V0KCk7XHJcblxyXG4gIGZ1bmN0aW9uIHRvZ2dsZUdyb3VwVmlzaWJpbGl0eShncm91cCkge1xyXG4gICAgaWYgKGhpZGRlbkdyb3Vwcy5oYXMoZ3JvdXAubmFtZSkpIGhpZGRlbkdyb3Vwcy5kZWxldGUoZ3JvdXAubmFtZSk7XHJcbiAgICBlbHNlIGhpZGRlbkdyb3Vwcy5hZGQoZ3JvdXAubmFtZSk7XHJcblxyXG4gICAgaGlkZGVuR3JvdXBzID0gaGlkZGVuR3JvdXBzO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gc3AocCwgYSkge1xyXG4gICAgcHJvZ3Jlc3MgPSBwO1xyXG4gICAgYWxsID0gYTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHJlc2V0RGVja1NlYXJjaCgpIHtcclxuICAgIGRlY2tTZWFjaCA9IG51bGw7XHJcbiAgICBpZiAoIWRlY2tTZWFyY2hJbnB1dCkgcmV0dXJuO1xyXG4gICAgZGVja1NlYXJjaElucHV0LnZhbHVlID0gXCJcIjtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHNvcnREZWNrU3RyaW5nKCkge1xyXG4gICAgcHJvbWlzZSA9IENhcmRMb2FkZXIuc29ydChpbnB1dC52YWx1ZSB8fCBcIlwiLCAocCwgYSkgPT4ge1xyXG4gICAgICByZXNldERlY2tTZWFyY2goKTtcclxuICAgICAgc3AocCwgYSk7XHJcbiAgICB9KVxyXG4gICAgICAuY2F0Y2goZSA9PiB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihlKTtcclxuICAgICAgICB0aHJvdyBlO1xyXG4gICAgICB9KVxyXG4gICAgICAudGhlbihyZXMgPT4ge1xyXG4gICAgICAgIGlucHV0LnZhbHVlID0gcmVzO1xyXG4gICAgICAgIHJldHVybiB1cGRhdGUoeyBrZXlDb2RlOiAyNyB9LCB0cnVlKTtcclxuICAgICAgfSk7XHJcbiAgfVxyXG5cclxuICBsZXQgZGVja05hbWVJbnB1dDtcclxuICBmdW5jdGlvbiBzYXZlRGVjaygpIHtcclxuICAgIGlmICghZGVja05hbWVJbnB1dCkgcmV0dXJuIGFsZXJ0KFwicGxzIGlucHV0IGEgbmFtZVwiKTtcclxuXHJcbiAgICAvLyBjb25zdCBmaWxlbmFtZSA9IChkZWNrTmFtZUlucHV0LnZhbHVlIHx8IFwidW5rbm93biBkZWNrXCIpICsgXCIudHh0XCI7XHJcblxyXG4gICAgaXBjLnNlbmQoXCJzYXZlRGVja1wiLCB7IGRlY2s6IGlucHV0LnZhbHVlLCBuYW1lOiBkZWNrTmFtZUlucHV0LnZhbHVlIH0pO1xyXG5cclxuICAgIC8qICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2RlY2tdLCB7IHR5cGU6IFwidGV4dC9wbGFpbjtjaGFyc2V0PXV0Zi04XCIgfSk7XHJcbiAgICBpZiAod2luZG93Lm5hdmlnYXRvci5tc1NhdmVPck9wZW5CbG9iKVxyXG4gICAgICAvLyBJRTEwK1xyXG4gICAgICB3aW5kb3cubmF2aWdhdG9yLm1zU2F2ZU9yT3BlbkJsb2IoYmxvYiwgZmlsZW5hbWUpO1xyXG4gICAgZWxzZSB7XHJcbiAgICAgIC8vIE90aGVyc1xyXG4gICAgICB2YXIgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJhXCIpLFxyXG4gICAgICAgIHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XHJcbiAgICAgIGEuaHJlZiA9IHVybDtcclxuICAgICAgYS5kb3dubG9hZCA9IGZpbGVuYW1lO1xyXG4gICAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xyXG4gICAgICBhLmNsaWNrKCk7XHJcbiAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcclxuICAgICAgICB3aW5kb3cuVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xyXG4gICAgICB9LCAwKTtcclxuICAgIH0qL1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gb25EZWNrTmFtZVR5cGUoKSB7XHJcbiAgICBDb29raWVzLnNldChcImRlY2tOYW1lXCIsIGRlY2tOYW1lSW5wdXQudmFsdWUpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gbWFpbktleURvd24oZXZ0KSB7XHJcbiAgICBpZiAoZXZ0LmN0cmxLZXkgfHwgZXZ0Lm1ldGFLZXkpIHtcclxuICAgICAgc3dpdGNoIChldnQud2hpY2gpIHtcclxuICAgICAgICBjYXNlIDgzOiAvLyBzXHJcbiAgICAgICAgICBldnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICAgIGV2dC5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICAgIHNhdmVEZWNrKCk7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gbWFpbktleVVwKGV2dCkge1xyXG4gICAgdXBkYXRlKGV2dCk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBmdW5jdGlvbiB1cGRhdGUoZXZ0KSB7XHJcbiAgICBpZiAoZXZ0LmtleUNvZGUgIT09IDI3KSByZXR1cm47XHJcblxyXG4gICAgbGV0IHNjcm9sbFBvc2l0aW9uID0gMDtcclxuICAgIGlmIChkaXNwbGF5KSB7XHJcbiAgICAgIHNjcm9sbFBvc2l0aW9uID0gZGlzcGxheS5zY3JvbGxUb3A7XHJcbiAgICB9XHJcblxyXG4gICAgcHJvbWlzZSA9IENhcmRMb2FkZXIuY3JlYXRlRGVjayhpbnB1dC52YWx1ZSB8fCBcIlwiLCAocCwgYSkgPT4ge1xyXG4gICAgICByZXNldERlY2tTZWFyY2goKTtcclxuICAgICAgc3AocCwgYSk7XHJcbiAgICB9KVxyXG4gICAgICAuY2F0Y2goZSA9PiB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihlKTtcclxuICAgICAgICB0aHJvdyBlO1xyXG4gICAgICB9KVxyXG4gICAgICAudGhlbihyZXMgPT4ge1xyXG4gICAgICAgIGlucHV0LnZhbHVlID0gcmVzLmNvcnJlY3RlZDtcclxuICAgICAgICBDb29raWVzLnNldChcImRlY2tcIiwgaW5wdXQudmFsdWUpO1xyXG4gICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgZGlzcGxheS5zY3JvbGxUb3AgPSBzY3JvbGxQb3NpdGlvbjtcclxuICAgICAgICB9KTtcclxuICAgICAgICByZXR1cm4gcmVzO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICByZXR1cm4gcHJvbWlzZTtcclxuICB9XHJcbiAgZnVuY3Rpb24gcmVsb2FkKCkge1xyXG4gICAgcmVzZXREZWNrU2VhcmNoKCk7XHJcbiAgICB1cGRhdGUoeyBrZXlDb2RlOiAyNyB9KTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIGFwcGVuZENhcmQobmFtZSkge1xyXG4gICAgaWYgKCFuYW1lKSByZXR1cm47XHJcbiAgICByZXNldERlY2tTZWFyY2goKTtcclxuICAgIGlucHV0LnZhbHVlID0gaW5wdXQudmFsdWUgKyBcIlxcbjEgXCIgKyBuYW1lO1xyXG4gICAgcmVsb2FkKCk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiByZW1vdmUoY2FyZCkge1xyXG4gICAgY29uc3QgciA9IG5ldyBSZWdFeHAoYF4uKiR7Y2FyZC5uYW1lfS4qJGAsIFwiZ21cIik7XHJcblxyXG4gICAgaW5wdXQudmFsdWUgPSBpbnB1dC52YWx1ZS5yZXBsYWNlKHIsIFwiLy8gXCIgKyBjYXJkLmNvdW50ICsgXCIgXCIgKyBjYXJkLm5hbWUpO1xyXG4gICAgcHJvbWlzZSA9IENhcmRMb2FkZXIuY3JlYXRlRGVjayhpbnB1dC52YWx1ZSB8fCBcIlwiLCAocCwgYSkgPT5cclxuICAgICAgc3AocCwgYSlcclxuICAgICkuY2F0Y2goZSA9PiB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoZSk7XHJcbiAgICAgIHRocm93IGU7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIGNvcHlEZWNrKCkge1xyXG4gICAgY29uc3QgZGVjayA9IGlucHV0LnZhbHVlO1xyXG5cclxuICAgIGlucHV0LnZhbHVlID0gaW5wdXQudmFsdWUucmVwbGFjZSgvIy4qfFxcL1xcLy4qL2dtLCBcIlxcblwiKTtcclxuXHJcbiAgICBpbnB1dC5zZWxlY3QoKTtcclxuXHJcbiAgICBpbnB1dC5zZXRTZWxlY3Rpb25SYW5nZSgwLCA5OTk5OSk7XHJcbiAgICBkb2N1bWVudC5leGVjQ29tbWFuZChcImNvcHlcIik7XHJcblxyXG4gICAgaW5wdXQudmFsdWUgPSBkZWNrO1xyXG5cclxuICAgIGFsZXJ0KFwiRGVjayBjb3BpZWQgdG8gY2xpcGJvYXJkXCIpO1xyXG4gIH1cclxuXHJcbiAgbGV0IGhlbHBBY3RpdmUgPSBmYWxzZTtcclxuICBvbk1vdW50KGFzeW5jICgpID0+IHtcclxuICAgIGNvbnN0IGRlZmF1bHREZWNrID0gYCNsYW5kc1xyXG5tb3VudGFpblxyXG4yIHBsYWluc1xyXG4zIHN3YW1wc1xyXG4jIG1haW4gZGVja1xyXG4yMCBibGlnaHRzdGVlbCBjb2xvc3N1c2A7XHJcblxyXG4gICAgdXNlQ29va2llcyA9IENvb2tpZXMuZ2V0KFwidXNlQ29va2llc1wiKTtcclxuXHJcbiAgICBjb25zdCB1cmxQYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKHdpbmRvdy5sb2NhdGlvbi5zZWFyY2gpO1xyXG4gICAgY29uc3Qgc2hhcmVkRGVjayA9IHVybFBhcmFtcy5nZXQoXCJkXCIpO1xyXG5cclxuICAgIGxldCBzdGFydCA9IHVzZUNvb2tpZXMgPyBDb29raWVzLmdldChcImRlY2tcIikgfHwgZGVmYXVsdERlY2sgOiBkZWZhdWx0RGVjaztcclxuXHJcbiAgICBpZiAoc2hhcmVkRGVjaykge1xyXG4gICAgICB1c2VDb29raWVzID0gZmFsc2U7XHJcbiAgICAgIC8qIGNvbnN0IGJ1ZmZlciA9IG5ldyBVaW50OEFycmF5KHNoYXJlZERlY2suc3BsaXQoXCIsXCIpKTtcclxuICAgICogY29uc3QgZGVjb21wcmVzc2VkID0gTFpVVEY4LmRlY29tcHJlc3MoYnVmZmVyKTtcclxuICAgICAgaWYgKGRlY29tcHJlc3NlZCkge1xyXG4gICAgICAgIHN0YXJ0ID0gZGVjb21wcmVzc2VkO1xyXG4gICAgICB9Ki9cclxuICAgIH1cclxuXHJcbiAgICB1cmxQYXJhbXMuZGVsZXRlKFwiZFwiKTtcclxuICAgIHdpbmRvdy5oaXN0b3J5LnJlcGxhY2VTdGF0ZSh7fSwgXCJcIiwgYCR7d2luZG93LmxvY2F0aW9uLnBhdGhuYW1lfWApO1xyXG5cclxuICAgIC8vICAgIHdpbmRvdy5oaXN0b3J5LnJlcGxhY2VTdGF0ZShcclxuICAgIC8vICAge30sXHJcbiAgICAvLyAgICcnLFxyXG4gICAgLy8gICBgJHt3aW5kb3cubG9jYXRpb24ucGF0aG5hbWV9PyR7cGFyYW1zfSR7d2luZG93LmxvY2F0aW9uLmhhc2h9YCxcclxuICAgIC8vIClcclxuXHJcbiAgICAvLyAgaGVscEFjdGl2ZSA9IENvb2tpZXMuZ2V0KFwiaGVscEFjdGl2ZVwiKSA9PSBcInRydWVcIjtcclxuICAgIC8vIGNvbnNvbGUubG9nKFwiaGVscDpcIiwgQ29va2llcy5nZXQoXCJoZWxwQWN0aXZlXCIpKTtcclxuICAgIGNhcmRTZWFyY2hBY3RpdmUgPSBDb29raWVzLmdldChcImNhcmRTZWFyY2hBY3RpdmVcIikgPT0gXCJ0cnVlXCI7XHJcbiAgICBjb25zb2xlLmxvZyhcInNlYXJjaDpcIiwgQ29va2llcy5nZXQoXCJjYXJkU2VhcmNoQWN0aXZlXCIpKTtcclxuICAgIHN0YXRpc3RpY3NBY3RpdmUgPSBDb29raWVzLmdldChcInN0YXRpc3RpY3NBY3RpdmVcIikgPT0gXCJ0cnVlXCI7XHJcbiAgICBjb25zb2xlLmxvZyhcInN0YXRpc3RpY3M6XCIsIENvb2tpZXMuZ2V0KFwic3RhdGlzdGljc0FjdGl2ZVwiKSk7XHJcblxyXG4gICAgc3RhdGlzdGljc0FjdGl2ZTtcclxuICAgIGlucHV0LnZhbHVlID0gc3RhcnQ7XHJcbiAgICByZWxvYWQoKTtcclxuXHJcbiAgICBpcGMub24oXCJsb2FkRGVja1wiLCAoc2VuZGVyLCBkYXRhKSA9PiB7XHJcbiAgICAgIGNvbnNvbGUubG9nKFwiTE9BRElORyBERUNLXCIsIGRhdGEubmFtZSk7XHJcbiAgICAgIGlucHV0LnZhbHVlID0gZGF0YS5kZWNrO1xyXG4gICAgICBkZWNrTmFtZUlucHV0LnZhbHVlID0gKGRhdGEubmFtZSB8fCBcIlwiKS5yZXBsYWNlKFwiLmdkZWNrXCIsIFwiXCIpO1xyXG4gICAgICByZWxvYWQoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8qIGNvbnNvbGUubG9nKFwiU1RTRlNERlwiLCBDb29raWVzLmdldChcImRlY2tcIikpLFxyXG4gICAgICAocHJvbWlzZSA9IENhcmRMb2FkZXIuY3JlYXRlRGVjayhzdGFydCwgKHAsIGEpID0+IHNwKHAsIGEpKSk7Ki9cclxuICB9KTtcclxuXHJcbiAgZnVuY3Rpb24gc2F2ZUFsbFRvQ29va2llcygpIHtcclxuICAgIENvb2tpZXMuc2V0KFwiY2FyZFNlYXJjaEFjdGl2ZVwiLCBjYXJkU2VhcmNoQWN0aXZlKTtcclxuICAgIENvb2tpZXMuc2V0KFwic3RhdGlzdGljc0FjdGl2ZVwiLCBzdGF0aXN0aWNzQWN0aXZlKTtcclxuICAgIENvb2tpZXMuc2V0KFwiZGVja1wiLCBpbnB1dC52YWx1ZSk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBzaGFyZURlY2soKSB7XHJcbiAgICAvKiAgIGlmICghaW5wdXQgfHwgIWlucHV0LnZhbHVlKSB7XHJcbiAgICAgIGFsZXJ0KFwiVGhlIGRlY2sgaXMgZW1wdHksIG5vdGhpbmcgY29waWVkXCIpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCBjb21wcmVzc2VkID0gTFpVVEY4LmNvbXByZXNzKGlucHV0LnZhbHVlIHx8IFwiZW1wdHkgZGVjayBzaGFyZWRcIik7XHJcbiAgICAvL3dpbmRvdy5oaXN0b3J5LnB1c2hTdGF0ZShcInBhZ2UyXCIsIFwiVGl0bGVcIiwgXCI/ZD1cIiArIGNvbXByZXNzZWQpO1xyXG4gICAgY29uc29sZS5sb2coYCR7d2luZG93LmxvY2F0aW9uLnBhdGhuYW1lfT9kPSR7Y29tcHJlc3NlZH1gKTtcclxuXHJcbiAgICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJ0ZXh0YXJlYVwiKTtcclxuICAgIGVsLnZhbHVlID0gYCR7d2luZG93LmxvY2F0aW9uLmhyZWZ9P2Q9JHtjb21wcmVzc2VkfWA7XHJcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGVsKTtcclxuICAgIGVsLnNlbGVjdCgpO1xyXG4gICAgZG9jdW1lbnQuZXhlY0NvbW1hbmQoXCJjb3B5XCIpO1xyXG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChlbCk7XHJcbiAgICBhbGVydChcImxpbmsgdG8gZGVjayBjb3BpZWRcIik7Ki9cclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIG9uVHlwaW5nKCkge1xyXG4gICAgQ29va2llcy5zZXQoXCJkZWNrXCIsIGlucHV0LnZhbHVlLCB7IGV4cGlyZXM6IDcgfSk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBnZXRIZWlnaHQobWFuYSwgZ3JvdXBzKSB7XHJcbiAgICByZXR1cm4gMTAwICogKG1hbmEgLyBNYXRoLm1heCguLi5ncm91cHNbXCJtYW5hQ3VydmVcIl0pKTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIG9wZW5IZWxwKCkge1xyXG4gICAgaGVscEFjdGl2ZSA9ICFoZWxwQWN0aXZlO1xyXG4gICAgLy8gIENvb2tpZXMuc2V0KFwiaGVscEFjdGl2ZVwiLCBoZWxwQWN0aXZlICsgXCJcIik7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiB0b2dnbGVTZWFyY2goKSB7XHJcbiAgICBjYXJkU2VhcmNoQWN0aXZlID0gIWNhcmRTZWFyY2hBY3RpdmU7XHJcbiAgICBDb29raWVzLnNldChcImNhcmRTZWFyY2hBY3RpdmVcIiwgY2FyZFNlYXJjaEFjdGl2ZSArIFwiXCIpO1xyXG4gIH1cclxuICBmdW5jdGlvbiB0b2dnbGVTdGF0aXN0aWNzKCkge1xyXG4gICAgc3RhdGlzdGljc0FjdGl2ZSA9ICFzdGF0aXN0aWNzQWN0aXZlO1xyXG4gICAgQ29va2llcy5zZXQoXCJzdGF0aXN0aWNzQWN0aXZlXCIsIHN0YXRpc3RpY3NBY3RpdmUgKyBcIlwiKTtcclxuICB9XHJcblxyXG4gIGxldCBoaWdobGlnaHRlZENyZWF0dXJlID0gXCJcIjtcclxuICBmdW5jdGlvbiBoaWdobGlnaHRDcmVhdHVyZSh0eXBlTmFtZSkge1xyXG4gICAgaWYgKHR5cGVOYW1lID09IGhpZ2hsaWdodGVkQ3JlYXR1cmUpIHtcclxuICAgICAgaGlnaGxpZ2h0ZWRDcmVhdHVyZSA9IFwiXCI7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGhpZ2hsaWdodGVkQ3JlYXR1cmUgPSB0eXBlTmFtZTtcclxuICAgIH1cclxuICB9XHJcbjwvc2NyaXB0PlxyXG5cclxuPHN0eWxlPlxyXG4gIC5jb250ZW50IHtcclxuICAgIC0tcmFpc2luLWJsYWNrOiBoc2xhKDIwMCwgOCUsIDE1JSwgMSk7XHJcbiAgICAtLXJvbWFuLXNpbHZlcjogaHNsYSgxOTYsIDE1JSwgNjAlLCAxKTtcclxuICAgIC0tY29sb3JsZXNzOiBoc2xhKDAsIDAlLCA4OSUsIDEpO1xyXG4gICAgLS1ibGFjazogaHNsYSg4MywgOCUsIDM4JSwgMSk7XHJcbiAgICAtLXdoaXRlOiBoc2woNDgsIDY0JSwgODklKTtcclxuICAgIC0tcmVkOiBoc2xhKDAsIDcxJSwgODQlLCAxKTtcclxuICAgIC0tZ3JlZW46IGhzbGEoMTE0LCA2MCUsIDc1JSwgMSk7XHJcbiAgICAtLWJsdWU6IGhzbGEoMjM1LCA1NSUsIDgxJSwgMSk7XHJcbiAgfVxyXG5cclxuICAuY29udGVudCB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICAgIHdpZHRoOiAxMDAlO1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gIH1cclxuXHJcbiAgLmhlbHAtc3ltYm9sIHtcclxuICAgIGJvcmRlci1yYWRpdXM6IDUwJTtcclxuICAgIGJvcmRlcjogMXB4IHNvbGlkIGJsYWNrO1xyXG4gICAgd2lkdGg6IDE2cHg7XHJcbiAgICBoZWlnaHQ6IDE2cHg7XHJcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICByaWdodDogMTBweDtcclxuICAgIHRvcDogMTBweDtcclxuICAgIGN1cnNvcjogcG9pbnRlcjtcclxuICB9XHJcblxyXG4gIC5oZWxwLXN5bWJvbDpob3ZlciB7XHJcbiAgICBib3JkZXItY29sb3I6IGJsdWU7XHJcbiAgICBjb2xvcjogYmx1ZTtcclxuICB9XHJcblxyXG4gIC50b2dnbGUtc2VhcmNoIHtcclxuICAgIGJhY2tncm91bmQ6IGJsdWU7XHJcbiAgICB3aWR0aDogMzBweDtcclxuICAgIGhlaWdodDogMzBweDtcclxuICAgIGN1cnNvcjogcG9pbnRlcjtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIGxlZnQ6IC0zMHB4O1xyXG4gICAgdG9wOiA1MCU7XHJcbiAgICB1c2VyLXNlbGVjdDogbm9uZTtcclxuICB9XHJcblxyXG4gIC5oaWRlIC50b2dnbGUtc2VhcmNoIHtcclxuICAgIGxlZnQ6IC01MnB4O1xyXG4gIH1cclxuXHJcbiAgLnN0YXRpc3RpY3Mge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XHJcbiAgfVxyXG4gIC5pbnB1dCB7XHJcbiAgICB3aWR0aDogMTAwJTtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICAgIGJveC1zaXppbmc6IGJvcmRlci1ib3g7XHJcbiAgICBwYWRkaW5nOiAxMHB4O1xyXG4gICAgcmVzaXplOiBub25lO1xyXG4gIH1cclxuXHJcbiAgLmNvbnRyb2xzIHtcclxuICAgIGZsZXgtc2hyaW5rOiAwO1xyXG4gICAgd2lkdGg6IDMwMHB4O1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gICAgYmFja2dyb3VuZDogbGlnaHRncmF5O1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XHJcbiAgfVxyXG5cclxuICAuaGVscCB7XHJcbiAgICBwYWRkaW5nOiAwcHggMTBweCAxMHB4IDEwcHg7XHJcbiAgICB1c2VyLXNlbGVjdDogbm9uZTtcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICB9XHJcblxyXG4gIC5ncm91cC1jb250ZW50IHtcclxuICAgIGZsZXgtZ3JvdzogMTtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LXdyYXA6IHdyYXA7XHJcbiAgICB0cmFuc2l0aW9uOiBoZWlnaHQgNTAwbXMgZWFzZTtcclxuICB9XHJcblxyXG4gIC5ncm91cC1jb250ZW50LmhpZGRlbiB7XHJcbiAgICBvdmVyZmxvdzogaGlkZGVuO1xyXG4gICAgaGVpZ2h0OiA0NXB4O1xyXG4gIH1cclxuXHJcbiAgLmFsbC10eXBlLWNvdW50IHtcclxuICAgIGhlaWdodDogMTI1cHg7XHJcbiAgICBvdmVyZmxvdzogYXV0bztcclxuICAgIGJhY2tncm91bmQ6IGxpZ2h0c3RlZWxibHVlO1xyXG4gICAgcGFkZGluZzogMTBweDtcclxuICB9XHJcblxyXG4gIC50eXBlLXNlbGVjdG9yIHtcclxuICAgIGN1cnNvcjogcG9pbnRlcjtcclxuICB9XHJcblxyXG4gIC50eXBlLXNlbGVjdG9yOm5vdCguaGlnaGxpZ2h0ZWQtY3JlYXR1cmUpOmhvdmVyIHtcclxuICAgIGJhY2tncm91bmQ6IGFsaWNlYmx1ZTtcclxuICB9XHJcblxyXG4gIC5oaWdobGlnaHRlZC1jcmVhdHVyZSB7XHJcbiAgICBiYWNrZ3JvdW5kOiBzdGVlbGJsdWU7XHJcbiAgfVxyXG5cclxuICAuY2FyZC1zZWFyY2gge1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gICAgZmxleC1ncm93OiAxO1xyXG4gICAgYmFja2dyb3VuZDogd2hpdGU7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIHJpZ2h0OiAwO1xyXG4gICAgd2lkdGg6IDMzJTtcclxuICAgIHotaW5kZXg6IDEwMDtcclxuICAgIGJveC1zaGFkb3c6IDBweCAwcHggMTBweCBibGFjaztcclxuICB9XHJcblxyXG4gIC5jYXJkLXNlYXJjaC5oaWRlIHtcclxuICAgIHJpZ2h0OiAtMzMlO1xyXG4gIH1cclxuXHJcbiAgLnNlYXJjaC1wYXJhbXMge1xyXG4gICAgZmxleC1zaHJpbms6IDA7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcclxuICB9XHJcblxyXG4gIC5zZWFyY2gtcmVzdWx0IHtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICAgIGZsZXgtZ3JvdzogMTtcclxuICAgIGJhY2tncm91bmQ6IHdoaXRlO1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgICBvdmVyZmxvdzogYXV0bztcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICAgIHVzZXItc2VsZWN0OiBub25lO1xyXG4gICAgZmxleC13cmFwOiB3cmFwO1xyXG4gIH1cclxuXHJcbiAgLmRpc3BsYXkge1xyXG4gICAgZmxleC1ncm93OiAxO1xyXG4gICAgYmFja2dyb3VuZDogZ3JheTtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gICAgZmxleC13cmFwOiBub3dyYXA7XHJcbiAgICBvdmVyZmxvdzogYXV0bztcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICAgIHVzZXItc2VsZWN0OiBub25lO1xyXG4gIH1cclxuXHJcbiAgLmxvYWRpbmctd3JhcHBlciB7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICBsZWZ0OiA1MCU7XHJcbiAgICB0b3A6IDA7XHJcbiAgICBib3R0b206IDA7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgYWxpZ24taXRlbXM6IGNlbnRlcjtcclxuICB9XHJcblxyXG4gIC5lbnRyeSB7XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgICBwYWRkaW5nOiAxMHB4O1xyXG4gICAgZmxleC1zaHJpbms6IDA7XHJcbiAgfVxyXG5cclxuICAuc2hvcGluZyB7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICB6LWluZGV4OiAxMDtcclxuICAgIGZvbnQtc2l6ZTogM2VtO1xyXG4gICAgdGV4dC1zaGFkb3c6IDBweCAwcHggNnB4IGJsYWNrO1xyXG4gICAgdGV4dC1hbGlnbjogY2VudGVyO1xyXG4gICAgYm90dG9tOiAxMCU7XHJcbiAgICByaWdodDogMTAlO1xyXG4gICAgZGlzcGxheTogbm9uZTtcclxuICB9XHJcblxyXG4gIC5lbnRyeTpob3ZlciAuc2hvcGluZyB7XHJcbiAgICBkaXNwbGF5OiBibG9jaztcclxuICB9XHJcblxyXG4gIC5zaG9waW5nIC5saW5rIHtcclxuICAgIHRleHQtZGVjb3JhdGlvbjogbm9uZTtcclxuICB9XHJcblxyXG4gIC5zaG9waW5nIC5saW5rOmhvdmVyIHtcclxuICAgIGNvbG9yOiB0cmFuc3BhcmVudDtcclxuICAgIHRleHQtc2hhZG93OiAwIDAgMCBibHVlO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQge1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgcmdiKDIyLCAyMiwgMjIpO1xyXG4gICAgYm9yZGVyLXJhZGl1czogMTBweDtcclxuICAgIG91dGxpbmU6IDA7XHJcbiAgICBib3gtc2hhZG93OiAwcHggMHB4IDEwcHggYmxhY2s7XHJcbiAgfVxyXG5cclxuICAuY2FyZC5iYW5uZWQge1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgcmVkO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQuaGlnaGxpZ2h0ZWQge1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgeWVsbG93O1xyXG4gIH1cclxuXHJcbiAgLmNhcmQudHlwZS1oaWdobGlnaHQge1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgYmx1ZXZpb2xldDtcclxuICB9XHJcblxyXG4gIC5jYXJkOmhvdmVyIHtcclxuICAgIGJvcmRlcjogNnB4IHNvbGlkIGJsdWU7XHJcbiAgICBjdXJzb3I6IHBvaW50ZXI7XHJcbiAgfVxyXG5cclxuICAuY2FyZC1jb250ZXh0LW1lbnUge1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgei1pbmRleDogMTAwO1xyXG4gICAgYmFja2dyb3VuZDogcmdiYSgyNTUsIDI1NSwgMjU1LCAwLjcpO1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gICAgd2lkdGg6IDEwMCU7XHJcbiAgICAvKiBwYWRkaW5nOiAxMHB4OyAqL1xyXG4gICAgLyogbWFyZ2luOiAxMHB4OyAqL1xyXG4gICAgbWFyZ2luLWxlZnQ6IC0zcHg7XHJcbiAgICBtYXJnaW4tdG9wOiAtM3B4O1xyXG4gICAgb3ZlcmZsb3c6IGF1dG87XHJcbiAgfVxyXG5cclxuICAuY2FyZC1jb250ZXh0LWVudHJ5IHtcclxuICAgIG1hcmdpbjogMTBweDtcclxuICAgIGZvbnQtd2VpZ2h0OiBib2xkO1xyXG4gICAgYmFja2dyb3VuZDogd2hpdGU7XHJcbiAgICBwYWRkaW5nOiA1cHg7XHJcbiAgICBib3JkZXItcmFkaXVzOiA5cHg7XHJcbiAgICBib3gtc2hhZG93OiAwIDAgNnB4IGJsYWNrO1xyXG4gICAgY3Vyc29yOiBwb2ludGVyO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQtY29udGV4dC1lbnRyeTpob3ZlciB7XHJcbiAgICBiYWNrZ3JvdW5kOiB3aGVhdDtcclxuICB9XHJcblxyXG4gIC5wcmljZSxcclxuICAuYmFubmVkLXRleHQsXHJcbiAgLmNvdW50IHtcclxuICAgIGZvbnQtc2l6ZTogMzRweDtcclxuICAgIHRleHQtc2hhZG93OiAwcHggMHB4IDlweCBibGFjaztcclxuICAgIGNvbG9yOiByZWQ7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICB6LWluZGV4OiAxMDA7XHJcbiAgICBmb250LXdlaWdodDogYm9sZDtcclxuICAgIGxlZnQ6IDM0cHg7XHJcbiAgfVxyXG5cclxuICAuYmFubmVkLXRleHQge1xyXG4gICAgZm9udC1zaXplOiAxMDAlO1xyXG4gICAgdGV4dC1zaGFkb3c6IDBweCAwcHggOXB4IGJsYWNrO1xyXG4gICAgY29sb3I6IHJlZDtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIHotaW5kZXg6IDEwMDtcclxuICAgIGZvbnQtd2VpZ2h0OiBib2xkO1xyXG4gICAgbGVmdDogMTclO1xyXG4gIH1cclxuICAuY291bnQge1xyXG4gICAgdG9wOiAxNjVweDtcclxuICB9XHJcblxyXG4gIC5wcmljZSB7XHJcbiAgICBib3R0b206IDdweDtcclxuICAgIGNvbG9yOiB3aGVhdDtcclxuICAgIGZvbnQtc2l6ZTogMTJweDtcclxuICAgIGJhY2tncm91bmQ6IGJsYWNrO1xyXG4gICAgbGVmdDogNDUlO1xyXG4gICAgZm9udC13ZWlnaHQ6IG5vcm1hbDtcclxuICB9XHJcblxyXG4gIC5ncm91cC1oZWFkZXIge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGJhY2tncm91bmQ6IGRhcmtncmV5O1xyXG4gICAgLyogcGFkZGluZzogOHB4OyAqL1xyXG4gICAgbWFyZ2luOiA4cHggMDtcclxuICAgIGJveC1zaGFkb3c6IDBweCAwcHggOHB4IGJsYWNrO1xyXG4gICAgd2lkdGg6IDEwMCU7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gIH1cclxuXHJcbiAgLmdyb3VwLWhlYWRlciBoMiB7XHJcbiAgICBwYWRkaW5nOiAwIDI1cHg7XHJcbiAgICBtYXJnaW46IDBweDtcclxuICB9XHJcblxyXG4gIC5ncm91cC1zdGF0aXN0aWNzIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gIH1cclxuXHJcbiAgLm1hbmEtcHJvcG9zYWwsXHJcbiAgLm1hbmEtZGV2b3Rpb24ge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgfVxyXG5cclxuICAuZGVjay12YWx1ZSxcclxuICAuZ3JvdXAtdmFsdWUge1xyXG4gICAgcGFkZGluZzogNXB4O1xyXG4gICAgY29sb3I6IGJsYWNrO1xyXG4gICAgYm9yZGVyLXJhZGl1czogNTAlO1xyXG4gICAgd2lkdGg6IDE1cHg7XHJcbiAgICBoZWlnaHQ6IDE1cHg7XHJcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7XHJcbiAgICBtYXJnaW46IDVweDtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7XHJcbiAgICBhbGlnbi1pdGVtczogY2VudGVyO1xyXG4gICAgZm9udC1zaXplOiAxMXB4O1xyXG4gICAgZm9udC13ZWlnaHQ6IGJvbGQ7XHJcbiAgfVxyXG4gIC5ibHVlIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWJsdWUpO1xyXG4gIH1cclxuICAuYmxhY2sge1xyXG4gICAgY29sb3I6IHdoaXRlO1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0tYmxhY2spO1xyXG4gIH1cclxuICAucmVkIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLXJlZCk7XHJcbiAgfVxyXG4gIC53aGl0ZSB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS13aGl0ZSk7XHJcbiAgfVxyXG4gIC5ncmVlbiB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS1ncmVlbik7XHJcbiAgfVxyXG4gIC5jb2xvcmxlc3Mge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0tY29sb3JsZXNzKTtcclxuICB9XHJcbiAgLmdlbmVyaWMge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogZ29sZGVucm9kO1xyXG4gIH1cclxuICAuc3VtIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IGdvbGRlbnJvZDtcclxuICB9XHJcblxyXG4gIC5jb2xvci1wYXJhbSB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICB9XHJcblxyXG4gIC5tYW5hLWN1cnZlIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gIH1cclxuXHJcbiAgLmFsbC1jdXJ2ZXMge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZ3JvdzogMTtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgICBoZWlnaHQ6IDgwcHg7XHJcbiAgfVxyXG5cclxuICAuYWxsLWxhYmVscyB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1zaHJpbms6IDA7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gIH1cclxuXHJcbiAgLmN1cnZlLWVsZW1lbnQge1xyXG4gICAgd2lkdGg6IDIwcHg7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgYm90dG9tOiAwO1xyXG4gICAgYmFja2dyb3VuZDogZ3JheTtcclxuICAgIC8qIHZlcnRpY2FsLWFsaWduOiBtaWRkbGU7ICovXHJcbiAgICBhbGlnbi1pdGVtczogY2VudGVyO1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gIH1cclxuXHJcbiAgLmN1cnZlLWxhYmVsIHtcclxuICAgIHdpZHRoOiAyMHB4O1xyXG4gIH1cclxuICAuY3VydmUtd3JhcHBlciB7XHJcbiAgICB3aWR0aDogMjBweDtcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICAgIGN1cnNvcjogcG9pbnRlcjtcclxuICB9XHJcblxyXG4gIC5jdXJ2ZS1lbGVtZW50OmhvdmVyIHtcclxuICAgIGJhY2tncm91bmQ6IGxpZ2h0Y29yYWw7XHJcbiAgfVxyXG5cclxuICAuaGlnaGxpZ2h0ZWQgLmN1cnZlLWVsZW1lbnQge1xyXG4gICAgYmFja2dyb3VuZDogbGlnaHRibHVlO1xyXG4gIH1cclxuXHJcbiAgLmN1cnZlLWxhYmVsLmhpZ2hsaWdodGVkIHtcclxuICAgIGJhY2tncm91bmQ6IGxpZ2h0Ymx1ZTtcclxuICB9XHJcblxyXG4gIC5jdXJ2ZS1sYWJlbDpob3ZlciB7XHJcbiAgICBiYWNrZ3JvdW5kOiBsaWdodGNvcmFsO1xyXG4gIH1cclxuXHJcbiAgaDQge1xyXG4gICAgbWFyZ2luLXRvcDogNXB4O1xyXG4gICAgbWFyZ2luLWJvdHRvbTogNXB4O1xyXG4gIH1cclxuXHJcbiAgLmxkcy1yaXBwbGUge1xyXG4gICAgZGlzcGxheTogaW5saW5lLWJsb2NrO1xyXG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xyXG4gICAgd2lkdGg6IDgwcHg7XHJcbiAgICBoZWlnaHQ6IDgwcHg7XHJcbiAgfVxyXG4gIC5sZHMtcmlwcGxlIGRpdiB7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICBib3JkZXI6IDRweCBzb2xpZCAjZmZmO1xyXG4gICAgb3BhY2l0eTogMTtcclxuICAgIGJvcmRlci1yYWRpdXM6IDUwJTtcclxuICAgIGFuaW1hdGlvbjogbGRzLXJpcHBsZSAxcyBjdWJpYy1iZXppZXIoMCwgMC4yLCAwLjgsIDEpIGluZmluaXRlO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQtc2VhcmNoIC5sZHMtcmlwcGxlIGRpdiB7XHJcbiAgICBib3JkZXI6IDRweCBzb2xpZCBibGFjaztcclxuICB9XHJcblxyXG4gIC5sZHMtcmlwcGxlIGRpdjpudGgtY2hpbGQoMikge1xyXG4gICAgYW5pbWF0aW9uLWRlbGF5OiAtMC41cztcclxuICB9XHJcbiAgQGtleWZyYW1lcyBsZHMtcmlwcGxlIHtcclxuICAgIDAlIHtcclxuICAgICAgdG9wOiAzNnB4O1xyXG4gICAgICBsZWZ0OiAzNnB4O1xyXG4gICAgICB3aWR0aDogMDtcclxuICAgICAgaGVpZ2h0OiAwO1xyXG4gICAgICBvcGFjaXR5OiAxO1xyXG4gICAgfVxyXG4gICAgMTAwJSB7XHJcbiAgICAgIHRvcDogMHB4O1xyXG4gICAgICBsZWZ0OiAwcHg7XHJcbiAgICAgIHdpZHRoOiA3MnB4O1xyXG4gICAgICBoZWlnaHQ6IDcycHg7XHJcbiAgICAgIG9wYWNpdHk6IDA7XHJcbiAgICB9XHJcbiAgfVxyXG48L3N0eWxlPlxyXG5cclxuPHN2ZWx0ZTp3aW5kb3dcclxuICBvbjptb3VzZXVwPXtvbk1haW5Nb3VzZURvd259XHJcbiAgb246Y29udGV4dG1lbnV8cHJldmVudERlZmF1bHQ9eygpID0+IGZhbHNlfVxyXG4gIG9uOmtleXVwPXttYWluS2V5VXB9XHJcbiAgb246a2V5ZG93bj17bWFpbktleURvd259IC8+XHJcbjxkaXYgY2xhc3M9XCJjb250ZW50XCI+XHJcbiAgPGRpdiBjbGFzcz1cImNvbnRyb2xzXCI+XHJcbiAgICA8ZGl2IGNsYXNzPVwiaGVscFwiPlxyXG4gICAgICA8ZGl2IGNsYXNzPVwiaGVscC1zeW1ib2xcIiBvbjpjbGljaz17b3BlbkhlbHB9Pj88L2Rpdj5cclxuICAgICAgeyNpZiBoZWxwQWN0aXZlfVxyXG4gICAgICAgIDxoND5Ib3cgdG8gdXNlOjwvaDQ+XHJcbiAgICAgICAgPHA+cGFzdGUgeW91ciBkZWNrIHRvIHRoZSBmb2xsb3dpbmcgaW5wdXQuPC9wPlxyXG4gICAgICAgIDx1bD5cclxuICAgICAgICAgIDxsaT5cclxuICAgICAgICAgICAgd2hlbiBhIGxpbmUgc3RhcnRzIHdpdGggXCIjXCIgaXQgd2lsbCBiZSBpbnRlcnByZXRlZCBhcyBoZWFkbGluZVxyXG4gICAgICAgICAgPC9saT5cclxuICAgICAgICAgIDxsaT5cclxuICAgICAgICAgICAgYSBjYXJkIGNhbiBiZSBlbnRlcmVkIHdpdGggYSBsZWFkaW5nIGNvdW50LCBvciBqdXN0IHdpdGggaXRzIG5hbWVcclxuICAgICAgICAgIDwvbGk+XHJcbiAgICAgICAgICA8bGk+dXNlIHRoZSBcIkVTQ1wiIGtleSB0byByZWFsb2FkIHRoZSBwcmV2aWV3PC9saT5cclxuICAgICAgICAgIDxsaT5kb3VibGVjbGljayBhIGNhcmQgdG8gcmVtb3ZlIGl0PC9saT5cclxuICAgICAgICA8L3VsPlxyXG4gICAgICAgIDxwPk5PVEU6IHdlIHVzZSBjb29raWVzIHRvIHN0b3JlIHlvdXIgZGVjayBhZnRlciByZWxvYWQuPC9wPlxyXG4gICAgICAgIDxwPk5PVEU6IFRoaXMgaXMgbm90IGFuIG9mZmljaWFsIE1hZ2ljIHByb2R1a3QuPC9wPlxyXG4gICAgICB7L2lmfVxyXG5cclxuICAgICAgeyNhd2FpdCBwcm9taXNlfVxyXG5cclxuICAgICAgICA8ZGl2PmxvYWRpbmc6IHtwcm9ncmVzc30ve2FsbH08L2Rpdj5cclxuICAgICAgezp0aGVuIGdyb3Vwc31cclxuXHJcbiAgICAgICAgeyNpZiAhaGVscEFjdGl2ZX1cclxuICAgICAgICAgIDxoND5HZW5lcmFsPC9oND5cclxuXHJcbiAgICAgICAgICA8ZGl2PlRvdGFsIGNhcmRzOiB7Z3JvdXBzWydjYXJkQ291bnQnXX08L2Rpdj5cclxuICAgICAgICAgIDxkaXY+XHJcbiAgICAgICAgICAgIExhbmRzOiB7Z3JvdXBzWydsYW5kQ291bnQnXX0gTm9ubGFuZHM6IHtncm91cHNbJ2NhcmRDb3VudCddIC0gZ3JvdXBzWydsYW5kQ291bnQnXX1cclxuICAgICAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgY2xhc3M9XCJ0eXBlLXNlbGVjdG9yXCJcclxuICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodENyZWF0dXJlKCdjcmVhdHVyZScpfVxyXG4gICAgICAgICAgICBjbGFzczpoaWdobGlnaHRlZC1jcmVhdHVyZT17J2NyZWF0dXJlJyA9PSBoaWdobGlnaHRlZENyZWF0dXJlfT5cclxuICAgICAgICAgICAgQ3JlYXR1cmVzOiB7Z3JvdXBzWydjcmVhdHVyZUNvdW50J119XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgY2xhc3M9XCJ0eXBlLXNlbGVjdG9yXCJcclxuICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodENyZWF0dXJlKCdpbnN0YW50Jyl9XHJcbiAgICAgICAgICAgIGNsYXNzOmhpZ2hsaWdodGVkLWNyZWF0dXJlPXsnaW5zdGFudCcgPT0gaGlnaGxpZ2h0ZWRDcmVhdHVyZX0+XHJcbiAgICAgICAgICAgIEluc3RhbnRzOiB7Z3JvdXBzWydpbnN0YW50Q291bnQnXX1cclxuICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICBjbGFzcz1cInR5cGUtc2VsZWN0b3JcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17KCkgPT4gaGlnaGxpZ2h0Q3JlYXR1cmUoJ3NvcmNlcnknKX1cclxuICAgICAgICAgICAgY2xhc3M6aGlnaGxpZ2h0ZWQtY3JlYXR1cmU9eydzb3JjZXJ5JyA9PSBoaWdobGlnaHRlZENyZWF0dXJlfT5cclxuICAgICAgICAgICAgU29yY2VyaWVzOiB7Z3JvdXBzWydzb3JjZXJ5Q291bnQnXX1cclxuICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICBjbGFzcz1cInR5cGUtc2VsZWN0b3JcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17KCkgPT4gaGlnaGxpZ2h0Q3JlYXR1cmUoJ2VuY2hhbnRtZW50Jyl9XHJcbiAgICAgICAgICAgIGNsYXNzOmhpZ2hsaWdodGVkLWNyZWF0dXJlPXsnZW5jaGFudG1lbnQnID09IGhpZ2hsaWdodGVkQ3JlYXR1cmV9PlxyXG4gICAgICAgICAgICBFbmNoYW50bWVudHM6IHtncm91cHNbJ2VuY2hhbnRtZW50Q291bnQnXX1cclxuICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICBjbGFzcz1cInR5cGUtc2VsZWN0b3JcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17KCkgPT4gaGlnaGxpZ2h0Q3JlYXR1cmUoJ2FydGlmYWN0Jyl9XHJcbiAgICAgICAgICAgIGNsYXNzOmhpZ2hsaWdodGVkLWNyZWF0dXJlPXsnYXJ0aWZhY3QnID09IGhpZ2hsaWdodGVkQ3JlYXR1cmV9PlxyXG4gICAgICAgICAgICBBcnRpZmFjdHM6IHtncm91cHNbJ2FydGlmYWN0Q291bnQnXX1cclxuICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICBjbGFzcz1cInR5cGUtc2VsZWN0b3JcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17KCkgPT4gaGlnaGxpZ2h0Q3JlYXR1cmUoJ3BsYW5lc3dhbGtlcicpfVxyXG4gICAgICAgICAgICBjbGFzczpoaWdobGlnaHRlZC1jcmVhdHVyZT17J3BsYW5lc3dhbGtlcicgPT0gaGlnaGxpZ2h0ZWRDcmVhdHVyZX0+XHJcbiAgICAgICAgICAgIFBsYW5lc3dhbGtlcjoge2dyb3Vwc1sncGxhbmVzd2Fsa2VyQ291bnQnXX1cclxuICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgPGRpdiBjbGFzcz1cImFsbC10eXBlLWNvdW50XCI+XHJcbiAgICAgICAgICAgIHsjZWFjaCBncm91cHNbJ3R5cGVOYW1lcyddIGFzIHR5cGVOYW1lfVxyXG4gICAgICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgICAgIGNsYXNzPVwidHlwZS1zZWxlY3RvclwiXHJcbiAgICAgICAgICAgICAgICBvbjpjbGljaz17KCkgPT4gaGlnaGxpZ2h0Q3JlYXR1cmUodHlwZU5hbWUpfVxyXG4gICAgICAgICAgICAgICAgY2xhc3M6aGlnaGxpZ2h0ZWQtY3JlYXR1cmU9e3R5cGVOYW1lID09IGhpZ2hsaWdodGVkQ3JlYXR1cmV9PlxyXG4gICAgICAgICAgICAgICAge3R5cGVOYW1lfToge2dyb3Vwc1sndHlwZUNvdW50cyddW3R5cGVOYW1lXX1cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgey9lYWNofVxyXG5cclxuICAgICAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgICAgIDxkaXY+Q29zdDoge2dyb3Vwcy5jb3N0LnRvRml4ZWQoMikgKyAnJCd9PC9kaXY+XHJcblxyXG4gICAgICAgICAgeyNpZiBzdGF0aXN0aWNzQWN0aXZlfVxyXG4gICAgICAgICAgICA8ZGl2IGNsYXNzPVwic3RhdGlzdGljc1wiPlxyXG4gICAgICAgICAgICAgIDxoND5EZXZvdGlvbjwvaDQ+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cIm1hbmEtZGV2b3Rpb25cIj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGJsdWVcIj57Z3JvdXBzWydtYW5hJ10uYmx1ZX08L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGJsYWNrXCI+e2dyb3Vwc1snbWFuYSddLmJsYWNrfTwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgcmVkXCI+e2dyb3Vwc1snbWFuYSddLnJlZH08L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIHdoaXRlXCI+e2dyb3Vwc1snbWFuYSddLndoaXRlfTwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgZ3JlZW5cIj57Z3JvdXBzWydtYW5hJ10uZ3JlZW59PC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBjb2xvcmxlc3NcIj5cclxuICAgICAgICAgICAgICAgICAge2dyb3Vwc1snbWFuYSddLmNvbG9ybGVzc31cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgICAgICAgICA8aDQ+R2VuZXJpYyBNYW5hPC9oND5cclxuICAgICAgICAgICAgICA8ZGl2PlJlbWFpbmluZyBnZW5lcmljIG1hbmEgY29zdHM6e2dyb3Vwc1snbWFuYSddLmdlbmVyaWN9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdj5DTUMtTWFuYS1TdW06e2dyb3Vwc1snbWFuYSddLnN1bX08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2PlxyXG4gICAgICAgICAgICAgICAgQXZlcmFnZSBDTUMgcGVyIE5vbmxhbmQ6IHtncm91cHNbJ2F2ZXJhZ2VNYW5hJ10udG9GaXhlZCgyKX1cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICA8aDQ+U3VnZ2VzdGVkIE1hbmEgRGlzdHJpYnV0aW9uPC9oND5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwibWFuYS1wcm9wb3NhbFwiPlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgYmx1ZVwiPlxyXG4gICAgICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10uYmx1ZSAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGJsYWNrXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS5ibGFjayAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIHJlZFwiPlxyXG4gICAgICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10ucmVkICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgd2hpdGVcIj5cclxuICAgICAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLndoaXRlICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgZ3JlZW5cIj5cclxuICAgICAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLmdyZWVuICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgY29sb3JsZXNzXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS5jb2xvcmxlc3MgKiBncm91cHNbJ2xhbmRDb3VudCddKS50b0ZpeGVkKDEpfVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgPGg0Pk1hbmEgQ3VydmU8L2g0PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJtYW5hLWN1cnZlXCI+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiYWxsLWN1cnZlc1wiPlxyXG4gICAgICAgICAgICAgICAgICB7I2VhY2ggZ3JvdXBzWydtYW5hQ3VydmUnXSBhcyBtYW5hLCBpfVxyXG4gICAgICAgICAgICAgICAgICAgIHsjaWYgbWFuYSA+IDB9XHJcbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiY3VydmUtd3JhcHBlclwiXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzOmhpZ2hsaWdodGVkPXtkZXZvdGlvbkhpZ2hsaWdodCA9PSBpfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBvbjpjbGljaz17KCkgPT4gaGlnaGxpZ2h0RGV2b3Rpb24oaSl9PlxyXG4gICAgICAgICAgICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJjdXJ2ZS1lbGVtZW50XCJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICBzdHlsZT17J2hlaWdodDonICsgZ2V0SGVpZ2h0KG1hbmEsIGdyb3VwcykgKyAnJTsnfT5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICB7bWFuYSB8fCAnJ31cclxuICAgICAgICAgICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgICAgICB7L2lmfVxyXG4gICAgICAgICAgICAgICAgICB7L2VhY2h9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiYWxsLWxhYmVsc1wiPlxyXG4gICAgICAgICAgICAgICAgICB7I2VhY2ggZ3JvdXBzWydtYW5hQ3VydmUnXSBhcyBtYW5hLCBpfVxyXG4gICAgICAgICAgICAgICAgICAgIHsjaWYgbWFuYSA+IDB9XHJcbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiY3VydmUtbGFiZWxcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzczpoaWdobGlnaHRlZD17ZGV2b3Rpb25IaWdobGlnaHQgPT0gaX1cclxuICAgICAgICAgICAgICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodERldm90aW9uKGkpfT5cclxuICAgICAgICAgICAgICAgICAgICAgICAge2l9XHJcbiAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgICAgICB7L2lmfVxyXG4gICAgICAgICAgICAgICAgICB7L2VhY2h9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICB7L2lmfVxyXG4gICAgICAgIHsvaWZ9XHJcbiAgICAgICAgPGRpdj5cclxuICAgICAgICAgIHNlYXJjaDpcclxuICAgICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e2RlY2tTZWFyY2hJbnB1dH1cclxuICAgICAgICAgICAgdGl0bGU9XCJlLmcuOiBzYWNyaWZpY2UgYSAoYXJ0aWZhY3R8Y3JlYXR1cmUpXCJcclxuICAgICAgICAgICAgb246a2V5dXA9eygpID0+IGNoYW5nZURlY2tTZWFyY2goZ3JvdXBzKX0gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgezpjYXRjaCBlcnJvcn1cclxuICAgICAgICB7ZXJyb3J9XHJcbiAgICAgIHsvYXdhaXR9XHJcbiAgICAgIEZvcm1hdDpcclxuICAgICAgPHNlbGVjdFxyXG4gICAgICAgIGJpbmQ6dGhpcz17Zm9ybWF0fVxyXG4gICAgICAgIG9uOmJsdXI9e3JlbG9hZH1cclxuICAgICAgICBvbjpjaGFuZ2U9e3JlbG9hZH1cclxuICAgICAgICB0aXRsZT1cInNlbGVjdCB0aGUgbGVnYWxpdHkgY2hlY2tlclwiPlxyXG4gICAgICAgIDxvcHRpb24gc2VsZWN0ZWQ+Y29tbWFuZGVyPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5icmF3bDwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+ZHVlbDwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+ZnV0dXJlPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5oaXN0b3JpYzwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+bGVnYWN5PC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5tb2Rlcm48L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPm9sZHNjaG9vbDwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+cGF1cGVyPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5wZW5ueTwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+cGlvbmVlcjwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+c3RhbmRhcmQ8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnZpbnRhZ2U8L29wdGlvbj5cclxuICAgICAgPC9zZWxlY3Q+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJzbGlkZWNvbnRhaW5lclwiPlxyXG4gICAgICAgIFNjYWxlOlxyXG4gICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgdHlwZT1cInJhbmdlXCJcclxuICAgICAgICAgIG1pbj1cIjI1XCJcclxuICAgICAgICAgIG1heD1cIjEwMFwiXHJcbiAgICAgICAgICBiaW5kOnZhbHVlPXtzY2FsaW5nfVxyXG4gICAgICAgICAgdGl0bGU9XCJzY2FsZXMgdGhlIGNhcmQgc2l6ZSBpbiB0aGUgcmlnaHQgdmlld1wiIC8+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgICA8ZGl2IGNsYXNzPVwic2F2ZS1jb250YWluZXJcIj5cclxuICAgICAgICBTYXZlIDpcclxuICAgICAgICA8aW5wdXRcclxuICAgICAgICAgIGJpbmQ6dGhpcz17ZGVja05hbWVJbnB1dH1cclxuICAgICAgICAgIG9uOmtleXVwPXtvbkRlY2tOYW1lVHlwZX1cclxuICAgICAgICAgIHZhbHVlPXtDb29raWVzLmdldCgnZGVja05hbWUnKSB8fCAndW5rbm93bl9kZWNrJ31cclxuICAgICAgICAgIHRpdGxlPVwiVGhlIG5hbWUgb2YgdGhlIGRlY2sgZm9yIHNhdmluZ1wiIC8+XHJcbiAgICAgICAgPGJ1dHRvblxyXG4gICAgICAgICAgb246Y2xpY2s9e3NhdmVEZWNrfVxyXG4gICAgICAgICAgdGl0bGU9XCJ0aGlzIHdpbGwgZG93bmxvYWQgeW91IGEgZmlsZSwgY2FsbGVkIGxpa2UgeW91IHByb3ZpZGUgaW4gdGhlXHJcbiAgICAgICAgICBkZWNrXCI+XHJcbiAgICAgICAgICBzYXZlXHJcbiAgICAgICAgPC9idXR0b24+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgICA8YnV0dG9uXHJcbiAgICAgICAgb246Y2xpY2s9e3RvZ2dsZVN0YXRpc3RpY3N9XHJcbiAgICAgICAgdGl0bGU9XCJ0b2dnbGVzIHRoZSB2aXNpYmlsaXR5IG9mIHRoZSBzdGF0aXN0aWNrc1wiPlxyXG4gICAgICAgIHtzdGF0aXN0aWNzQWN0aXZlID8gJ2hpZGUgc3RhdGlzdGljcycgOiAnc2hvdyBzdGF0aXN0aWNzJ31cclxuICAgICAgPC9idXR0b24+XHJcbiAgICAgIDxidXR0b25cclxuICAgICAgICBvbjpjbGljaz17c29ydERlY2tTdHJpbmd9XHJcbiAgICAgICAgdGl0bGU9XCJ0aGlzIHNvcnRzIHRoZSBkZWNrIHRvIGxhbmRzIHNwZWxscyBhbmQgY3JlYXR1cmVzIC1OT1RFOiB5b3VyXHJcbiAgICAgICAgZ3JvdXBzIHdpbGwgYmUgcmVwbGFjZWRcIj5cclxuICAgICAgICBzb3J0XHJcbiAgICAgIDwvYnV0dG9uPlxyXG4gICAgICA8YnV0dG9uXHJcbiAgICAgICAgb246Y2xpY2s9e2NvcHlEZWNrfVxyXG4gICAgICAgIHRpdGxlPVwidGhpcyBjb3BpZXMgdGhlIGRlY2sgd2l0aG91dCBncm91cHMgYW5kIHN0dWZmIHRvIHlvdXIgY2xpcGJvYXJkXCI+XHJcbiAgICAgICAgY2xlYW4gY29weVxyXG4gICAgICA8L2J1dHRvbj5cclxuICAgICAgPGJ1dHRvblxyXG4gICAgICAgIG9uOmNsaWNrPXtzaGFyZURlY2t9XHJcbiAgICAgICAgdGl0bGU9XCJjb3BpZXMgYSBzdHJpbmcgdG8geW91ciBjbGlwYm9hcmQsIHRoYXQgc2hhcmVzIHRoaXMgZGVjayB3aXRoXHJcbiAgICAgICAgb3RoZXJzXCI+XHJcbiAgICAgICAgc2hhcmVcclxuICAgICAgPC9idXR0b24+XHJcblxyXG4gICAgICA8YnV0dG9uIG9uOmNsaWNrPXtyZWxvYWR9PnJlZnJlc2g8L2J1dHRvbj5cclxuICAgIDwvZGl2PlxyXG4gICAgPHRleHRhcmVhIGJpbmQ6dGhpcz17aW5wdXR9IGNsYXNzPVwiaW5wdXRcIiBvbjprZXl1cD17b25UeXBpbmd9IC8+XHJcbiAgPC9kaXY+XHJcblxyXG4gIDxkaXYgY2xhc3M9XCJkaXNwbGF5XCIgYmluZDp0aGlzPXtkaXNwbGF5fT5cclxuICAgIHsjYXdhaXQgcHJvbWlzZX1cclxuICAgICAgPGRpdiBjbGFzcz1cImxvYWRpbmctd3JhcHBlclwiPlxyXG4gICAgICAgIDxkaXY+bG9hZGluZzoge3Byb2dyZXNzfS97YWxsfTwvZGl2PlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJsZHMtcmlwcGxlXCI+XHJcbiAgICAgICAgICA8ZGl2IC8+XHJcbiAgICAgICAgICA8ZGl2IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgezp0aGVuIGdyb3Vwc31cclxuXHJcbiAgICAgIHsjZWFjaCBkZWNrU2VhY2ggfHwgZ3JvdXBzIHx8IFtdIGFzIGdyb3VwfVxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJncm91cFwiPlxyXG5cclxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC1oZWFkZXJcIj5cclxuICAgICAgICAgICAgPGgyPntncm91cC5uYW1lICsgJyAvLyAnICsgZ3JvdXAuY291bnQgfHwgJ25vIG5hbWUnfTwvaDI+XHJcbiAgICAgICAgICAgIDxidXR0b24gb246Y2xpY2s9eygpID0+IHRvZ2dsZUdyb3VwVmlzaWJpbGl0eShncm91cCl9PlxyXG4gICAgICAgICAgICAgIHRvZ2dsZVxyXG4gICAgICAgICAgICA8L2J1dHRvbj5cclxuICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXN0YXRpc3RpY3NcIj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgYmx1ZVwiPntncm91cC5tYW5hLmJsdWV9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGJsYWNrXCI+e2dyb3VwLm1hbmEuYmxhY2t9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIHJlZFwiPntncm91cC5tYW5hLnJlZH08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgd2hpdGVcIj57Z3JvdXAubWFuYS53aGl0ZX08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgZ3JlZW5cIj57Z3JvdXAubWFuYS5ncmVlbn08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgY29sb3JsZXNzXCI+e2dyb3VwLm1hbmEuY29sb3JsZXNzfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDwhLS0gZ2VuZXJpYzpcclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgZ2VuZXJpY1wiPntncm91cC5tYW5hLmdlbmVyaWN9PC9kaXY+IC0tPlxyXG4gICAgICAgICAgICAgIHN1bTpcclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgc3VtXCI+e2dyb3VwLm1hbmEuc3VtfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSBncm91cC1jb3N0XCI+XHJcbiAgICAgICAgICAgICAgICB7Z3JvdXAuY29zdC50b0ZpeGVkKDIpICsgJyQnfVxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgY2xhc3M9XCJncm91cC1jb250ZW50XCJcclxuICAgICAgICAgICAgY2xhc3M6aGlkZGVuPXtoaWRkZW5Hcm91cHMuaGFzKGdyb3VwLm5hbWUpfT5cclxuXHJcbiAgICAgICAgICAgIHsjZWFjaCBncm91cC5jYXJkcyBhcyBjYXJkfVxyXG4gICAgICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgICAgIGNsYXNzPVwiZW50cnlcIlxyXG4gICAgICAgICAgICAgICAgc3R5bGU9eyd3aWR0aDonICsgd2lkdGggKyAncHg7IGhlaWdodDonICsgKGNhcmQuY291bnQgPD0gNCA/IGhlaWdodCArICgoY2FyZC5jb3VudCB8fCAxKSAtIDEpICogNDAgOiBoZWlnaHQgKyAzICogNDApICsgJ3B4Oyd9PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cInNob3BpbmdcIj5cclxuICAgICAgICAgICAgICAgICAgPGFcclxuICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImxpbmtcIlxyXG4gICAgICAgICAgICAgICAgICAgIGhyZWY9e2NhcmQuZGF0YS5wdXJjaGFzZV91cmlzLmNhcmRtYXJrZXR9XHJcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0PVwiX2JsYW5rXCI+XHJcbiAgICAgICAgICAgICAgICAgICAgJiMxMjg3MjI7XHJcbiAgICAgICAgICAgICAgICAgIDwvYT5cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgeyNlYWNoIHsgbGVuZ3RoOiBjYXJkLmNvdW50ID4gNCA/IDQgOiBjYXJkLmNvdW50IH0gYXMgXywgaX1cclxuICAgICAgICAgICAgICAgICAgPGltZ1xyXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzOmJhbm5lZD17Y2FyZC5kYXRhLmxlZ2FsaXRpZXNbZm9ybWF0LnZhbHVlXSAhPT0gJ2xlZ2FsJ31cclxuICAgICAgICAgICAgICAgICAgICBjbGFzczpoaWdobGlnaHRlZD17ZGV2b3Rpb25IaWdobGlnaHQgPT0gY2FyZC5kYXRhLmNtY31cclxuICAgICAgICAgICAgICAgICAgICBjbGFzczp0eXBlLWhpZ2hsaWdodD17aGlnaGxpZ2h0ZWRDcmVhdHVyZSAmJiBjYXJkLmRhdGEudHlwZV9saW5lXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC50b0xvd2VyQ2FzZSgpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC5pbmNsdWRlcyhoaWdobGlnaHRlZENyZWF0dXJlKX1cclxuICAgICAgICAgICAgICAgICAgICBvbjptb3VzZXVwfHN0b3BQcm9wYWdhdGlvbj17ZXZ0ID0+IGNhcmRDb250ZXh0TWVudShldnQsIGNhcmQsIGdyb3Vwcyl9XHJcbiAgICAgICAgICAgICAgICAgICAgb246ZGJsY2xpY2s9eygpID0+IHJlbW92ZShjYXJkKX1cclxuICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImNhcmRcIlxyXG4gICAgICAgICAgICAgICAgICAgIHN0eWxlPXsnbWFyZ2luLXRvcDogJyArIGkgKiA0MCArICdweCd9XHJcbiAgICAgICAgICAgICAgICAgICAgc3JjPXtjYXJkLnVybH1cclxuICAgICAgICAgICAgICAgICAgICBhbHQ9e2NhcmQubmFtZX1cclxuICAgICAgICAgICAgICAgICAgICB7d2lkdGh9XHJcbiAgICAgICAgICAgICAgICAgICAge2hlaWdodH0gLz5cclxuICAgICAgICAgICAgICAgIHsvZWFjaH1cclxuXHJcbiAgICAgICAgICAgICAgICB7I2lmIGNhcmQuZGF0YS5sZWdhbGl0aWVzW2Zvcm1hdC52YWx1ZV0gIT09ICdsZWdhbCd9XHJcbiAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJiYW5uZWQtdGV4dFwiPkJBTk5FRDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgICAgIHsjaWYgY2FyZC5jb3VudCA+IDR9XHJcbiAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJjb3VudFwiPntjYXJkLmNvdW50fXg8L2Rpdj5cclxuICAgICAgICAgICAgICAgIHsvaWZ9XHJcblxyXG4gICAgICAgICAgICAgICAgeyNpZiBzY2FsaW5nID4gOTB9XHJcbiAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJwcmljZVwiPntjYXJkLmRhdGEucHJpY2VzLnVzZCArICckJyB8fCAnPz8/J308L2Rpdj5cclxuICAgICAgICAgICAgICAgIHsvaWZ9XHJcblxyXG4gICAgICAgICAgICAgICAgeyNpZiBjdXJyZW50Q2FyZENvbnRleHQgPT09IGNhcmR9XHJcbiAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJjYXJkLWNvbnRleHQtbWVudVwiPlxyXG5cclxuICAgICAgICAgICAgICAgICAgICB7I2VhY2ggZ3JvdXBzIGFzIHN1Ykdyb3VwfVxyXG4gICAgICAgICAgICAgICAgICAgICAgeyNpZiBncm91cC5uYW1lICE9IHN1Ykdyb3VwLm5hbWV9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImNhcmQtY29udGV4dC1lbnRyeVwiXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgb246bW91c2Vkb3duPXtldnQgPT4gY2FyZENvbnRleHRDbGljayhldnQsIGNhcmQsIHN1Ykdyb3VwKX0+XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAge3N1Ykdyb3VwLm5hbWV9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgICAgICAgICB7L2VhY2h9XHJcbiAgICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgey9pZn1cclxuXHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgIHsvZWFjaH1cclxuICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICB7L2VhY2h9XHJcblxyXG4gICAgezpjYXRjaCBlcnJvcn1cclxuXHJcbiAgICAgIDxkaXYgY2xhc3M9XCJlcnJvclwiPlxyXG4gICAgICAgIEVSUk9SLCBjaGVjayB5b3VyIGRlY2tsaXN0IGZvciBjb3JyZWN0IGZvcm1hdCBvciBpbnRlcm5ldCBjb25uZWN0aW9uXHJcbiAgICAgICAgYnJ1ZGlcclxuICAgICAgPC9kaXY+XHJcbiAgICB7L2F3YWl0fVxyXG4gIDwvZGl2PlxyXG5cclxuICA8ZGl2IGNsYXNzPVwiY2FyZC1zZWFyY2hcIiBjbGFzczpoaWRlPXshY2FyZFNlYXJjaEFjdGl2ZX0+XHJcbiAgICA8ZGl2IGNsYXNzPVwidG9nZ2xlLXNlYXJjaFwiIG9uOmNsaWNrPXt0b2dnbGVTZWFyY2h9Png8L2Rpdj5cclxuICAgIDxkaXYgY2xhc3M9XCJzZWFyY2gtcGFyYW1zXCI+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJzZWFyY2gtcGFyYW1cIj5cclxuICAgICAgICBOYW1lOlxyXG4gICAgICAgIDxpbnB1dCBiaW5kOnRoaXM9e3NwTmFtZX0gLz5cclxuICAgICAgPC9kaXY+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJzZWFyY2gtcGFyYW1cIj5cclxuICAgICAgICBUZXh0OlxyXG4gICAgICAgIDxpbnB1dCBiaW5kOnRoaXM9e3NwVGV4dH0gLz5cclxuICAgICAgPC9kaXY+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJzZWFyY2gtcGFyYW1cIj5cclxuICAgICAgICBUeXBlOlxyXG4gICAgICAgIDxpbnB1dCBiaW5kOnRoaXM9e3NwVHlwZX0gLz5cclxuICAgICAgPC9kaXY+XHJcblxyXG4gICAgICA8ZGl2IGNsYXNzPVwic2VhcmNoLXBhcmFtIGNvbG9yLXBhcmFtXCI+XHJcbiAgICAgICAgQ29tbWFuZGVyLUNvbG9yczpcclxuICAgICAgICA8ZGl2IGNsYXNzPVwiYmx1ZVwiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJibHVlXCJcclxuICAgICAgICAgICAgYmluZDp0aGlzPXtzcEVESEJsdWV9IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImJsYWNrXCI+XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgdHlwZT1cImNoZWNrYm94XCJcclxuICAgICAgICAgICAgb246Y2xpY2s9e2NsZWFyQ29sb3JsZXNzfVxyXG4gICAgICAgICAgICBjbGFzcz1cImJsYWNrXCJcclxuICAgICAgICAgICAgYmluZDp0aGlzPXtzcEVESEJsYWNrfSAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJyZWRcIj5cclxuICAgICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgICB0eXBlPVwiY2hlY2tib3hcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17Y2xlYXJDb2xvcmxlc3N9XHJcbiAgICAgICAgICAgIGNsYXNzPVwicmVkXCJcclxuICAgICAgICAgICAgYmluZDp0aGlzPXtzcEVESFJlZH0gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwid2hpdGVcIj5cclxuICAgICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgICB0eXBlPVwiY2hlY2tib3hcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17Y2xlYXJDb2xvcmxlc3N9XHJcbiAgICAgICAgICAgIGNsYXNzPVwid2hpdGVcIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIV2hpdGV9IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImdyZWVuXCI+XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgdHlwZT1cImNoZWNrYm94XCJcclxuICAgICAgICAgICAgb246Y2xpY2s9e2NsZWFyQ29sb3JsZXNzfVxyXG4gICAgICAgICAgICBjbGFzcz1cImdyZWVuXCJcclxuICAgICAgICAgICAgYmluZDp0aGlzPXtzcEVESEdyZWVufSAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJjb2xvcmxlc3NcIj5cclxuICAgICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgICB0eXBlPVwiY2hlY2tib3hcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17Y2xlYXJGb3JDb2xvcmxlc3N9XHJcbiAgICAgICAgICAgIGNsYXNzPVwiY29sb3JsZXNzXCJcclxuICAgICAgICAgICAgYmluZDp0aGlzPXtzcEVESENvbG9ybGVzc30gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgPC9kaXY+XHJcbiAgICAgIDxidXR0b24gb246Y2xpY2s9e3NlYXJjaENhcmRzfT5zZWFyY2g8L2J1dHRvbj5cclxuICAgIDwvZGl2PlxyXG5cclxuICAgIHsjYXdhaXQgY2FyZFNlYXJjaFByb21pc2V9XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJsb2FkaW5nLXdyYXBwZXJcIj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwibGRzLXJpcHBsZVwiPlxyXG4gICAgICAgICAgPGRpdiAvPlxyXG4gICAgICAgICAgPGRpdiAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICA8L2Rpdj5cclxuICAgIHs6dGhlbiByZXN1bHR9XHJcblxyXG4gICAgICB7I2lmIHJlc3VsdC5jb2RlICE9PSAnbm90X2ZvdW5kJyAmJiByZXN1bHQuZGF0YX1cclxuICAgICAgICA8ZGl2IGNsYXNzPVwic2VhcmNoLXJlc3VsdFwiPlxyXG4gICAgICAgICAgeyNlYWNoIHJlc3VsdC5kYXRhIGFzIGNhcmR9XHJcbiAgICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgICBjbGFzcz1cImVudHJ5XCJcclxuICAgICAgICAgICAgICBzdHlsZT17J3dpZHRoOicgKyB3aWR0aCArICdweDsgaGVpZ2h0OicgKyBoZWlnaHQgKyAncHg7J30+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cInNob3BpbmdcIj5cclxuICAgICAgICAgICAgICAgIDxhIGNsYXNzPVwibGlua1wiIGhyZWY9e2NhcmQuY2FyZG1hcmtldH0gdGFyZ2V0PVwiX2JsYW5rXCI+XHJcbiAgICAgICAgICAgICAgICAgICYjMTI4NzIyO1xyXG4gICAgICAgICAgICAgICAgPC9hPlxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgIDxpbWdcclxuICAgICAgICAgICAgICAgIG9uOmRibGNsaWNrPXsoKSA9PiBhcHBlbmRDYXJkKGNhcmQubmFtZSl9XHJcbiAgICAgICAgICAgICAgICBjbGFzczpiYW5uZWQ9e2NhcmQubGVnYWxpdGllc1tmb3JtYXQudmFsdWVdICE9PSAnbGVnYWwnfVxyXG4gICAgICAgICAgICAgICAgY2xhc3M9XCJjYXJkXCJcclxuICAgICAgICAgICAgICAgIHNyYz17Y2FyZC51cmx9XHJcbiAgICAgICAgICAgICAgICBhbHQ9e2NhcmQubmFtZX1cclxuICAgICAgICAgICAgICAgIHt3aWR0aH1cclxuICAgICAgICAgICAgICAgIHtoZWlnaHR9IC8+XHJcblxyXG4gICAgICAgICAgICAgIHsjaWYgY2FyZC5sZWdhbGl0aWVzW2Zvcm1hdC52YWx1ZV0gIT09ICdsZWdhbCd9XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiYmFubmVkLXRleHRcIj5CQU5ORUQ8L2Rpdj5cclxuICAgICAgICAgICAgICB7L2lmfVxyXG4gICAgICAgICAgICAgIHsjaWYgc2NhbGluZyA+IDkwfVxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cInByaWNlXCI+e2NhcmQucHJpY2VzLnVzZCArICckJyB8fCAnPz8/J308L2Rpdj5cclxuICAgICAgICAgICAgICB7L2lmfVxyXG4gICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIHs6ZWxzZX1cclxuICAgICAgICAgICAgPGRpdj5ObyBjYXJkcyBmb3VuZDwvZGl2PlxyXG4gICAgICAgICAgey9lYWNofVxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxidXR0b25cclxuICAgICAgICAgIGRpc2FibGVkPXshcmVzdWx0Lmhhc19tb3JlfVxyXG4gICAgICAgICAgb246Y2xpY2s9eygpID0+IHNlYXJjaENhcmRzKHJlc3VsdC5uZXh0X3BhZ2UpfT5cclxuICAgICAgICAgIG5leHRcclxuICAgICAgICA8L2J1dHRvbj5cclxuICAgICAgezplbHNlfVxyXG4gICAgICAgIDxkaXY+Tm8gY2FyZHMgZm91bmQ8L2Rpdj5cclxuICAgICAgey9pZn1cclxuICAgIHs6Y2F0Y2ggZXJyb3J9XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJlcnJvclwiPlxyXG4gICAgICAgIEVSUk9SLCBjaGVjayB5b3VyIGRlY2tsaXN0IGZvciBjb3JyZWN0IGZvcm1hdCBvciBpbnRlcm5ldCBjb25uZWN0aW9uXHJcbiAgICAgICAgYnJ1ZGlcclxuICAgICAgPC9kaXY+XHJcbiAgICB7L2F3YWl0fVxyXG5cclxuICA8L2Rpdj5cclxuPC9kaXY+XHJcbiIsImNvbnN0IF9fZGlybmFtZSA9IFwiLi9cIjtcclxud2luZG93Ll9fZGlybmFtZSA9IFwiLi9cIjtcclxuaW1wb3J0IE1haW5WaWV3IGZyb20gXCIuL2VkaXRvci5zdmVsdGVcIjtcclxuXHJcblxyXG53aW5kb3cub25sb2FkID0gZnVuY3Rpb24oKSB7XHJcbiAgY29uc3QgcmVuZGVyVGFyZ2V0ID0gbmV3IE1haW5WaWV3KHtcclxuICAgIHRhcmdldDogZG9jdW1lbnQuYm9keSxcclxuICAgIHByb3BzOiB7XHJcbiAgICAgIHRlc3Q6IFwic2RmZHNmXCJcclxuICAgIH1cclxuICB9KTtcclxufTsiXSwibmFtZXMiOlsiY2wiLCJNYWluVmlldyJdLCJtYXBwaW5ncyI6Ijs7O0NBQUEsU0FBUyxJQUFJLEdBQUcsRUFBRTtBQUNsQixBQUVBO0NBQ0EsU0FBUyxNQUFNLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRTtDQUMxQixDQUFDLEtBQUssTUFBTSxDQUFDLElBQUksR0FBRyxFQUFFLEdBQUcsQ0FB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LENBQUMsT0FBTyxFQUFFLE1BQU0sS0FBSzs7Q0FFL0MsTUFBTSxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsRUFBRSxJQUFJLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQztDQUN2RCxNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDLEdBQUcsRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLENBQUM7Q0FDaEQsS0FBSyxDQUFDLENBQUM7Q0FDUCxJQUFJLE9BQU8sQ0FBQyxDQUFDO0NBQ2IsR0FBRzs7Q0FFSCxFQUFFLFFBQVEsQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFO0NBQzFCLElBQUksTUFBTSxFQUFFLEdBQUcsUUFBUSxFQUFFLENBQUMsUUFBUSxFQUFFLENBQUM7Q0FDckMsSUFBSSxPQUFPLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQztDQUN0QyxJQUFJLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQzs7Q0FFN0Q7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsR0FBRzs7Q0FFSCxFQUFFLFFBQVEsQ0FBQyxJQUFJLEVBQUU7Q0FDakIsSUFBSSxNQUFNLEVBQUUsR0FBRyxRQUFRLEVBQUUsQ0FBQyxRQUFRLEVBQUUsQ0FBQztDQUNyQyxJQUFJLE1BQU0sQ0FBQyxHQUFHLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLE1BQU0sS0FBSztDQUMvQyxNQUFNLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxFQUFFLElBQUksRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDO0NBQ3RELE1BQU0sSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsQ0FBQztDQUMvQyxLQUFLLENBQUMsQ0FBQztDQUNQLElBQUksT0FBTyxDQUFDLENBQUM7Q0FD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Q0FBQyxLQUFLLEVBQUUsQ0FBQztDQUN2QyxTQUFTLE1BQU07Q0FDZixVQUFVLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7Q0FDdkYsVUFBVSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssRUFBRSxDQUFDO0NBQ3BDLFNBQVM7O0NBRVQsT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFO0NBQ2xCLFFBQVEsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztDQUMxQixPQUFPO0NBQ1AsTUFBTSxNQUFNLENBQUMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztDQUN2QyxLQUFLOztDQUVMLElBQUksU0FBUyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztDQUMxRixJQUFJLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7Q0FDcEYsSUFBSSxLQUFLLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDLElBQUks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LENBQUMsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsSUFBSSxFQUFFLENBQUM7Q0FDeEQsUUFBUSxRQUFRLENBQUMsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQztDQUNsRixRQUFRLFFBQVEsQ0FBQyxLQUFLLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDO0NBQ25GLFFBQVEsUUFBUSxDQUFDLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUM7Q0FDakYsUUFBUSxRQUFRLENBQUMsS0FBSyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQztDQUNuRixRQUFRLFFBQVEsQ0FBQyxLQUFLLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDO0NBQ25GLFFBQVEsUUFBUSxDQUFDLFNBQVMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUM7Q0FDdkYsUUFBUSxRQUFRLENBQUMsT0FBTyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxLQUFLLEVBQUUsR0FBRyxLQUFLLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQztDQUN2TTtDQUNBLFFBQVEsUUFBUSxDQUFDLEdBQUcsR0FBRyxDQUFDLFFBQVEsQ0FBQyxHQUFHLElBQUksQ0FBQyxLQUFLLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7Q0FDdEYsT0FBTzs7OztDQUlQLE1BQU0sS0FBSyxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUM7Q0FDMUIsTUFBTSxLQUFLLENBQUMsSUFBSSxHQUFHLFFBQVEsQ0FBQztDQUM1QixNQUFNLEtBQUssQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDOztDQUV4QixNQUFNLEtBQUssQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO0NBQ2xDLE1BQU0sS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7Q0FDakQsUUFBUSxTQUFTLENBQUMsQ0FBQyxDQUFDLEdBQUcsU0FBUyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztDQUN6QyxRQUFRLElBQUksT0FBTyxFQUFFLFNBQVM7Q0FDOUIsUUFBUSxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7Q0FDL0UsT0FBTztDQUNQLE1BQU0sSUFBSSxDQUFDLE9BQU8sRUFBRTs7Q0FFcEIsUUFBUSxXQUFXLElBQUksSUFBSSxDQUFDO0NBQzVCLFFBQVEsWUFBWSxJQUFJLEtBQUssQ0FBQzs7Q0FFOUIsUUFBUSxlQUFlLENBQUMsSUFBSSxJQUFJLFFBQVEsQ0FBQyxJQUFJLENBQUM7Q0FDOUMsUUFBUSxlQUFlLENBQUMsS0FBSyxJQUFJLFFBQVEsQ0FBQyxLQUFLLENBQUM7Q0FDaEQsUUFBUSxlQUFlLENBQUMsR0FBRyxJQUFJLFFBQVEsQ0FBQyxHQUFHLENBQUM7Q0FDNUMsUUFBUSxlQUFlLENBQUMsS0FBSyxJQUFJLFFBQVEsQ0FBQyxLQUFLLENBQUM7Q0FDaEQsUUFBUSxlQUFlLENBQUMsS0FBSyxJQUFJLFFBQVEsQ0FBQyxLQUFLLENBQUM7Q0FDaEQsUUFBUSxlQUFlLENBQUMsU0FBUyxJQUFJLFFBQVEsQ0FBQyxTQUFTLENBQUM7O0NBRXhELFFBQVEsZUFBZSxDQUFDLE9BQU8sSUFBSSxRQUFRLENBQUMsT0FBTyxDQUFDO0NBQ3BELFFBQVEsZUFBZSxDQUFDLEdBQUcsSUFBSSxRQUFRLENBQUMsR0FBRyxDQUFDO0NBQzVDLE9BQU87Q0FDUCxLQUFLOztDQUVMLElBQUksS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLGdCQUFnQixDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtDQUN0RCxNQUFNLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxHQUFHLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztDQUNyRCxLQUFLO0FBQ0wsQUFFQTtDQUNBLElBQUksSUFBSSxZQUFZLEdBQUcsZUFBZSxDQUFDLElBQUksR0FBRyxlQUFlLENBQUMsS0FBSyxHQUFHLGVBQWUsQ0FBQyxHQUFHLEdBQUcsZUFBZSxDQUFDLEtBQUssR0FBRyxlQUFlLENBQUMsS0FBSyxHQUFHLGVBQWUsQ0FBQyxTQUFTLENBQUM7Q0FDdEssSUFBSSxZQUFZLEdBQUcsWUFBWSxJQUFJLENBQUMsQ0FBQztDQUNyQyxJQUFJLE1BQU0sWUFBWSxHQUFHO0NBQ3pCLE1BQU0sSUFBSSxFQUFFLGVBQWUsQ0FBQyxJQUFJLEdBQUcsWUFBWTtDQUMvQyxNQUFNLEtBQUssRUFBRSxlQUFlLENBQUMsS0FBSyxHQUFHLFlBQVk7Q0FDakQsTUFBTSxHQUFHLEVBQUUsZUFBZSxDQUFDLEdBQUcsR0FBRyxZQUFZO0NBQzdDLE1BQU0sS0FBSyxFQUFFLGVBQWUsQ0FBQyxLQUFLLEdBQUcsWUFBWTtDQUNqRCxNQUFNLEtBQUssRUFBRSxlQUFlLENBQUMsS0FBSyxHQUFHLFlBQVk7Q0FDakQsTUFBTSxTQUFTLEVBQUUsZUFBZSxDQUFDLFNBQVMsR0FBRyxZQUFZO0NBQ3pELEtBQUssQ0FBQzs7Q0FFTixJQUFJLE1BQU0sQ0FBQyxjQUFjLENBQUMsR0FBRyxZQUFZLENBQUM7O0NBRTFDLElBQUksTUFBTSxDQUFDLFdBQVcsQ0FBQyxHQUFHLFNBQVMsQ0FBQztDQUNwQyxJQUFJLE1BQU0sQ0FBQyxXQUFXLENBQUMsR0FBRyxZQUFZLENBQUM7Q0FDdkMsSUFBSSxNQUFNLENBQUMsYUFBYSxDQUFDLEdBQUcsZUFBZSxDQUFDLEdBQUcsSUFBSSxZQUFZLEdBQUcsU0FBUyxDQUFDLENBQUM7Q0FDN0UsSUFBSSxNQUFNLENBQUMsTUFBTSxDQUFDLEdBQUcsV0FBVyxDQUFDO0NBQ2pDLElBQUksTUFBTSxDQUFDLE1BQU0sQ0FBQyxHQUFHLGVBQWUsQ0FBQztDQUNyQyxJQUFJLE1BQU0sQ0FBQyxXQUFXLENBQUMsR0FBRyxVQUFVLENBQUM7Q0FDckMsSUFBSSxNQUFNLENBQUMsV0FBVyxDQUFDLEdBQUcsZ0JBQWdCLENBQUM7OztDQUczQyxJQUFJLE1BQU0sQ0FBQyxlQUFlLENBQUMsR0FBRyxhQUFhLENBQUM7Q0FDNUMsSUFBSSxNQUFNLENBQUMsY0FBYyxDQUFDLEdBQUcsWUFBWSxDQUFDO0NBQzFDLElBQUksTUFBTSxDQUFDLGNBQWMsQ0FBQyxHQUFHLFlBQVksQ0FBQztDQUMxQyxJQUFJLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLGlCQUFpQixDQUFDO0NBQ3BELElBQUksTUFBTSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsZ0JBQWdCLENBQUM7Q0FDbEQsSUFBSSxNQUFNLENBQUMsZUFBZSxDQUFDLEdBQUcsYUFBYSxDQUFDO0NBQzVDLElBQUksTUFBTSxDQUFDLFlBQVksQ0FBQyxHQUFHLFVBQVUsQ0FBQzs7Q0FFdEMsSUFBSSxPQUFPLFVBQVUsQ0FBQyxXQUFXLENBQUM7Q0FDbEMsSUFBSSxPQUFPLFVBQVUsQ0FBQyxZQUFZLENBQUM7Q0FDbkMsSUFBSSxPQUFPLFVBQVUsQ0FBQyxPQUFPLENBQUM7Q0FDOUIsSUFBSSxPQUFPLFVBQVUsQ0FBQyxPQUFPLENBQUM7Q0FDOUIsSUFBSSxPQUFPLFVBQVUsQ0FBQyxRQUFRLENBQUM7Q0FDL0IsSUFBSSxPQUFPLFVBQVUsQ0FBQyxRQUFRLENBQUM7Q0FDL0IsSUFBSSxPQUFPLFVBQVUsQ0FBQyxJQUFJLENBQUM7O0NBRTNCLElBQUksSUFBSSxTQUFTLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztDQUM1QyxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLFNBQVMsQ0FBQyxDQUFDO0NBQ2hDLElBQUksU0FBUyxHQUFHLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxLQUFLLFVBQVUsQ0FBQyxDQUFDLENBQUMsR0FBRyxVQUFVLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7Q0FDakYsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxTQUFTLENBQUMsQ0FBQztDQUNoQyxJQUFJLE1BQU0sQ0FBQyxXQUFXLENBQUMsR0FBRyxTQUFTLENBQUM7Q0FDcEMsSUFBSSxPQUFPLE1BQU0sQ0FBQztDQUNsQixHQUFHO0NBQ0gsQ0FBQzs7Q0FFRCxjQUFjLEdBQUcsWUFBWTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7b0JDMGdCcEIsS0FBSzs7Ozs7Ozs7Ozs7O3dEQUFMLEtBQUs7Ozs7Ozs7Ozs7Ozs7Ozs7O2tCQTlJRCxLQUFDLFVBQVU7Ozs7Ozs7Ozs7Ozs7Ozs7dUNBMklGOzs7Ozs7Ozs7Ozs7OztRQTNJVCxLQUFDLFVBQVU7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O3VDQUdLLE1BQU0sQ0FBQyxXQUFXLENBQUMsbUNBRTVCLE1BQU0sQ0FBQyxXQUFXLENBQUMseUJBQWEsTUFBTSxDQUFDLFdBQVcsQ0FBQyxPQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMscUNBT3JFLE1BQU0sQ0FBQyxlQUFlLENBQUMsdUNBTXhCLE1BQU0sQ0FBQyxjQUFjLENBQUMsdUNBTXJCLE1BQU0sQ0FBQyxjQUFjLENBQUMsdUNBTW5CLE1BQU0sQ0FBQyxrQkFBa0IsQ0FBQyx1Q0FNN0IsTUFBTSxDQUFDLGVBQWUsQ0FBQyx1Q0FNcEIsTUFBTSxDQUFDLG1CQUFtQixDQUFDLGtEQWNoQyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsR0FBRyxHQUFHOzt5QkFYL0IsTUFBTSxDQUFDLFdBQVcsQ0FBQzs7OzttQ0FBeEI7Ozs7c0JBYUMsZ0JBQWdCOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O29DQWJqQjs7Ozs7Ozs7Ozs7Ozs7OzsrQ0FsQzBCLFVBQVUsUUFBSSxtQkFBbUI7OzsrQ0FNakMsU0FBUyxRQUFJLG1CQUFtQjs7OytDQU1oQyxTQUFTLFFBQUksbUJBQW1COzs7K0NBTWhDLGFBQWEsUUFBSSxtQkFBbUI7OzsrQ0FNcEMsVUFBVSxRQUFJLG1CQUFtQjs7OytDQU1qQyxjQUFjLFFBQUksbUJBQW1COzs7Ozs7OzJCQS9CdkQ7MkJBTUE7MkJBTUE7MkJBTUE7MkJBTUE7MkJBTUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7b0NBS1I7Ozs7Ozs7Ozs7Ozs7OzBEQTFDZSxNQUFNLENBQUMsV0FBVyxDQUFDOzs7OzBEQUU1QixNQUFNLENBQUMsV0FBVyxDQUFDOzs7OzBEQUFhLE1BQU0sQ0FBQyxXQUFXLENBQUMsT0FBRyxNQUFNLENBQUMsV0FBVyxDQUFDOzs7OzREQU9yRSxNQUFNLENBQUMsZUFBZSxDQUFDOzs7OztnREFEUCxVQUFVLFFBQUksbUJBQW1COzs7NERBT2xELE1BQU0sQ0FBQyxjQUFjLENBQUM7Ozs7O2dEQURMLFNBQVMsUUFBSSxtQkFBbUI7Ozs0REFPaEQsTUFBTSxDQUFDLGNBQWMsQ0FBQzs7Ozs7Z0RBRE4sU0FBUyxRQUFJLG1CQUFtQjs7OzREQU83QyxNQUFNLENBQUMsa0JBQWtCLENBQUM7Ozs7O2dEQURiLGFBQWEsUUFBSSxtQkFBbUI7Ozs0REFPcEQsTUFBTSxDQUFDLGVBQWUsQ0FBQzs7Ozs7Z0RBRFAsVUFBVSxRQUFJLG1CQUFtQjs7OzREQU85QyxNQUFNLENBQUMsbUJBQW1CLENBQUM7Ozs7O2dEQURkLGNBQWMsUUFBSSxtQkFBbUI7Ozs7d0JBSTFELE1BQU0sQ0FBQyxXQUFXLENBQUM7O3NDQUF4Qjs7Ozs7Ozs7Ozs7OzRCQUFBOzs7aUJBQUEsc0JBQUE7Ozs0REFXUSxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsR0FBRyxHQUFHOzs7O1lBRW5DLGdCQUFnQjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OzswQkFSZCxRQUFRLHlCQUFJLE1BQU0sQ0FBQyxZQUFZLENBQUMsS0FBQyxRQUFRLENBQUM7Ozs7Ozs7Ozs7Ozs7a0RBRGYsUUFBUSxRQUFJLG1CQUFtQjs7bUNBRGpEOzs7Ozs7Ozs7Ozs7MERBRVQsUUFBUTs7OzswREFBSSxNQUFNLENBQUMsWUFBWSxDQUFDLEtBQUMsUUFBUSxDQUFDOzs7OzttREFEZixRQUFRLFFBQUksbUJBQW1COzs7Ozs7Ozs7Ozs7Ozs7O2lEQWE3QixNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSwrQkFDbEIsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEtBQUssK0JBQ3RCLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLCtCQUNoQixNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsS0FBSyxnQ0FDcEIsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEtBQUssa0NBRWhELE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxTQUFTLGlEQUtNLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxPQUFPLHVDQUN0QyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBRyx1Q0FFVCxNQUFNLENBQUMsYUFBYSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxnREFLdkQsS0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUMsSUFBSSxPQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLCtCQUc5RCxLQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQyxLQUFLLE9BQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUMsK0JBRy9ELEtBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDLEdBQUcsT0FBRyxNQUFNLENBQUMsV0FBVyxDQUFDLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQywrQkFHN0QsS0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUMsS0FBSyxPQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLCtCQUcvRCxLQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQyxLQUFLLE9BQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUMsK0JBRy9ELEtBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDLFNBQVMsT0FBRyxNQUFNLENBQUMsV0FBVyxDQUFDLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQzs7eUJBTTdELE1BQU0sQ0FBQyxXQUFXLENBQUM7Ozs7bUNBQXhCOzs7O3lCQWlCSyxNQUFNLENBQUMsV0FBVyxDQUFDOzs7O21DQUF4Qjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O3NDQWpCQTs7Ozs7OztvQ0FpQkE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7c0NBakJBOzs7Ozs7O29DQWlCQTs7Ozs7OzBEQXpEMEIsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUk7Ozs7MERBQ2xCLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxLQUFLOzs7OzBEQUN0QixNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBRzs7OzswREFDaEIsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEtBQUs7Ozs7NERBQ3BCLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxLQUFLOzs7OzREQUVoRCxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsU0FBUzs7Ozs0REFLTSxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTzs7Ozs0REFDdEMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUc7Ozs7NERBRVQsTUFBTSxDQUFDLGFBQWEsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7Ozs7d0RBS3ZELEtBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDLElBQUksT0FBRyxNQUFNLENBQUMsV0FBVyxDQUFDLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQzs7Ozt3REFHOUQsS0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUMsS0FBSyxPQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDOzs7O3dEQUcvRCxLQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQyxHQUFHLE9BQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUM7Ozs7d0RBRzdELEtBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDLEtBQUssT0FBRyxNQUFNLENBQUMsV0FBVyxDQUFDLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQzs7Ozt3REFHL0QsS0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUMsS0FBSyxPQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDOzs7O3dEQUcvRCxLQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQyxTQUFTLE9BQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUM7Ozs7O3dCQU03RCxNQUFNLENBQUMsV0FBVyxDQUFDOztzQ0FBeEI7Ozs7Ozs7Ozs7Ozs4QkFBQTs7O21CQUFBLHNCQUFBOzs7O3dCQWlCSyxNQUFNLENBQUMsV0FBVyxDQUFDOztzQ0FBeEI7Ozs7Ozs7Ozs7Ozs0QkFBQTs7O2lCQUFBLHNCQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Z0NBUk8sSUFBSSxJQUFJLEVBQUU7Ozs7Ozs7Ozs7Ozs0Q0FESixTQUFTLEdBQUcsU0FBUyxLQUFDLElBQUksTUFBRSxNQUFNLENBQUMsR0FBRyxJQUFJOzs7MENBSmhDLGlCQUFpQixRQUFJLENBQUM7O29DQUMvQjs7Ozs7Ozs7Ozs7d0RBSVAsSUFBSSxJQUFJLEVBQUU7Ozs7c0VBREosU0FBUyxHQUFHLFNBQVMsS0FBQyxJQUFJLE1BQUUsTUFBTSxDQUFDLEdBQUcsSUFBSTs7Ozs7MkNBSmhDLGlCQUFpQixRQUFJLENBQUM7Ozs7Ozs7Ozs7Ozs7Ozs7OztzQkFIeEMsSUFBSSxHQUFHLENBQUM7Ozs7Ozs7Ozs7Ozs7O1lBQVIsSUFBSSxHQUFHLENBQUM7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O2lCQXNCUixDQUFDOzt5Q0FGaUIsaUJBQWlCLFFBQUksQ0FBQzs7bUNBQy9COzs7Ozs7Ozs7OzswQ0FEUyxpQkFBaUIsUUFBSSxDQUFDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7c0JBSHhDLElBQUksR0FBRyxDQUFDOzs7Ozs7Ozs7Ozs7OztZQUFSLElBQUksR0FBRyxDQUFDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztrQkEzSFYsUUFBUTs7a0JBQUcsR0FBRzs7Ozs7Ozs7Ozs7Ozs7c0JBQWQsUUFBUTs7OztzQkFBRyxHQUFHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7eUJBcU94QixTQUFTLFFBQUksTUFBTSxJQUFJLEVBQUU7Ozs7bUNBQTlCOzs7Ozs7b0NBQUE7Ozs7Ozs7O29DQUFBOzs7Ozs7Ozs7d0JBQUssU0FBUyxRQUFJLE1BQU0sSUFBSSxFQUFFOztzQ0FBOUI7Ozs7Ozs7Ozs7Ozs0QkFBQTs7O2lCQUFBLHNCQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7d0JBbURtQixjQUFjLE9BQUcsQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJO2tDQUNoQyxJQUFJLENBQUMsR0FBRztrQ0FDUixJQUFJLENBQUMsSUFBSTtvQkFDYixLQUFLO3FCQUNMLE1BQU07b0NBWk8sSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLEtBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLE9BQU87eUNBQ3pDLGlCQUFpQixRQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRzs0Q0FDL0IsbUJBQW1CLFFBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTOzBCQUMzRCxXQUFXLEVBQUU7MEJBQ2IsUUFBUSxLQUFDLG1CQUFtQixDQUFDOzs7OzZDQUNOOzZCQUNmOzs7Ozs7Ozs7O3lGQUdSLElBQUksQ0FBQyxHQUFHOzs7O3lGQUNSLElBQUksQ0FBQyxJQUFJOzs7OztxQkFDYixLQUFLOzs7O3NCQUNMLE1BQU07Ozs7cUNBWk8sSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLEtBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLE9BQU87Ozs7MENBQ3pDLGlCQUFpQixRQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRzs7Ozs2Q0FDL0IsbUJBQW1CLFFBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTOzBCQUMzRCxXQUFXLEVBQUU7MEJBQ2IsUUFBUSxLQUFDLG1CQUFtQixDQUFDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OzBCQWVoQixJQUFJLENBQUMsS0FBSzs7Ozs7Ozs7Ozs7Ozs7Ozs7OytFQUFWLElBQUksQ0FBQyxLQUFLOzs7Ozs7Ozs7Ozs7Ozs7eUJBSVYsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxHQUFHLEdBQUcsSUFBSSxLQUFLOzs7Ozs7Ozs7Ozs7Ozs7OzZFQUFuQyxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLEdBQUcsR0FBRyxJQUFJLEtBQUs7Ozs7Ozs7Ozs7Ozs7Ozs7O3lCQU05QyxNQUFNOzs7O21DQUFYOzs7Ozs7OztvQ0FBQTs7Ozs7Ozs7OztvQ0FBQTs7Ozs7Ozt3QkFBSyxNQUFNOztzQ0FBWDs7Ozs7Ozs7Ozs7OzRCQUFBOzs7aUJBQUEsc0JBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7eUJBS0ssUUFBUSxDQUFDLElBQUk7Ozs7Ozs7Ozs7Ozt1Q0FEQTs7Ozs7Ozs7Ozt3REFDYixRQUFRLENBQUMsSUFBSTs7Ozs7Ozs7Ozs7Ozs7Ozs7OztzQkFKYixLQUFLLENBQUMsSUFBSSxRQUFJLFFBQVEsQ0FBQyxJQUFJOzs7Ozs7Ozs7Ozs7OztZQUEzQixLQUFLLENBQUMsSUFBSSxRQUFJLFFBQVEsQ0FBQyxJQUFJOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O3FCQWhDL0IsRUFBRSxNQUFNLE1BQUUsSUFBSSxDQUFDLEtBQUssR0FBRyxDQUFDLEdBQUcsQ0FBQyxPQUFHLElBQUksQ0FBQyxLQUFLLEVBQUU7Ozs7bUNBQWhEOzs7O3VCQWlCRyxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsS0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssT0FBTzs7dUJBRzlDLElBQUksQ0FBQyxLQUFLLEdBQUcsQ0FBQzs7dUJBSWQsT0FBTyxHQUFHLEVBQUU7O3VCQUlaLGtCQUFrQixTQUFLLElBQUk7Ozs7Ozs7Ozs7b0NBNUI5Qjs7Ozs7Ozs7Ozs7OztnQ0FMUSxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxVQUFVOzs7Ozs7NENBSnJDLFFBQVEsT0FBRyxLQUFLLEdBQUcsYUFBYSxRQUFJLElBQUksQ0FBQyxLQUFLLElBQUksQ0FBQyxPQUFHLE1BQU0sR0FBRyxDQUFDLEtBQUMsSUFBSSxDQUFDLEtBQUssSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsT0FBRyxNQUFNLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEtBQUs7Ozs7Ozs7Ozs7O29DQVMzSDs7Ozs7Ozs7Ozs7Ozs7O3VGQUxRLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVU7Ozs7O29CQUtyQyxFQUFFLE1BQU0sTUFBRSxJQUFJLENBQUMsS0FBSyxHQUFHLENBQUMsR0FBRyxDQUFDLE9BQUcsSUFBSSxDQUFDLEtBQUssRUFBRTs7c0NBQWhEOzs7Ozs7Ozs7Ozs7NEJBQUE7OztpQkFBQSxzQkFBQTs7O1lBaUJHLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxLQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxPQUFPOzs7Ozs7Ozs7OztZQUc5QyxJQUFJLENBQUMsS0FBSyxHQUFHLENBQUM7Ozs7Ozs7Ozs7Ozs7WUFJZCxPQUFPLEdBQUcsRUFBRTs7Ozs7Ozs7Ozs7OztZQUlaLGtCQUFrQixTQUFLLElBQUk7Ozs7Ozs7Ozs7Ozs7OEhBckN6QixRQUFRLE9BQUcsS0FBSyxHQUFHLGFBQWEsUUFBSSxJQUFJLENBQUMsS0FBSyxJQUFJLENBQUMsT0FBRyxNQUFNLEdBQUcsQ0FBQyxLQUFDLElBQUksQ0FBQyxLQUFLLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLE9BQUcsTUFBTSxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUMsR0FBRyxLQUFLOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O3NDQTVCNUgsS0FBSyxDQUFDLElBQUksR0FBRyxNQUFNLE9BQUcsS0FBSyxDQUFDLEtBQUssSUFBSSxTQUFTLGlEQUtsQixLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksK0JBQ2QsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLCtCQUNsQixLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsZ0NBQ1osS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLGtDQUNoQixLQUFLLENBQUMsSUFBSSxDQUFDLEtBQUssa0NBQ1osS0FBSyxDQUFDLElBQUksQ0FBQyxTQUFTLGtDQUkxQixLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsa0NBRXpDLEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxHQUFHLEdBQUc7Ozs7Ozt5QkFTekIsS0FBSyxDQUFDLEtBQUs7Ozs7bUNBQWhCOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztvQ0FBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O3NDQUZZLFlBQVksQ0FBQyxHQUFHLEtBQUMsS0FBSyxDQUFDLElBQUksQ0FBQzs7OztzQ0F0QnhCOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztvQ0F3QmhCOzs7Ozs7OytFQXpCRyxLQUFLLENBQUMsSUFBSSxHQUFHLE1BQU0sT0FBRyxLQUFLLENBQUMsS0FBSyxJQUFJLFNBQVM7Ozs7K0VBS2xCLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSTs7OzsrRUFDZCxLQUFLLENBQUMsSUFBSSxDQUFDLEtBQUs7Ozs7K0VBQ2xCLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRzs7OztpRkFDWixLQUFLLENBQUMsSUFBSSxDQUFDLEtBQUs7Ozs7aUZBQ2hCLEtBQUssQ0FBQyxJQUFJLENBQUMsS0FBSzs7OztpRkFDWixLQUFLLENBQUMsSUFBSSxDQUFDLFNBQVM7Ozs7aUZBSTFCLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRzs7OztpRkFFekMsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEdBQUcsR0FBRzs7Ozs7d0JBU3pCLEtBQUssQ0FBQyxLQUFLOztzQ0FBaEI7Ozs7Ozs7Ozs7Ozs0QkFBQTs7O2lCQUFBLHNCQUFBOzs7O3VDQUZZLFlBQVksQ0FBQyxHQUFHLEtBQUMsS0FBSyxDQUFDLElBQUksQ0FBQzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztrQkFuQy9CLFFBQVE7O2tCQUFHLEdBQUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztzQkFBZCxRQUFROzs7O3NCQUFHLEdBQUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7V0FvTDFCLE1BQU0sQ0FBQyxJQUFJLEtBQUssV0FBVyxRQUFJLE1BQU0sQ0FBQyxJQUFJOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O3VCQUVwQyxNQUFNLENBQUMsSUFBSTs7OztpQ0FBaEI7Ozs7OztrQkFBQTs7Ozs7Ozs7Ozs7OztvQ0FBQTs7Ozs7Ozs7OzhDQThCUSxLQUFDLE1BQU0sQ0FBQyxRQUFROztzQ0FDaEI7Ozs7OztvQ0EvQlI7Ozs7Ozs7Ozs7Ozs7Ozs7c0JBQUssTUFBTSxDQUFDLElBQUk7O29DQUFoQjs7Ozs7Ozs7Ozs7OzRCQUFBOzs7aUJBQUEsb0JBQUE7OzttQkFBQTs7Ozs7Ozs7Ozs7MEZBOEJRLEtBQUMsTUFBTSxDQUFDLFFBQVE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7eUJBUkEsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLEdBQUcsR0FBRyxJQUFJLEtBQUs7Ozs7Ozs7Ozs7Ozs7Ozs7a0VBQTlCLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxHQUFHLEdBQUcsSUFBSSxLQUFLOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7dUJBSi9DLElBQUksQ0FBQyxVQUFVLEtBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLE9BQU87O3VCQUd6QyxPQUFPLEdBQUcsRUFBRTs7Ozs7Ozs7Ozs7Ozs7O2dDQWhCTyxJQUFJLENBQUMsVUFBVTs7Ozs7O2tDQVFoQyxJQUFJLENBQUMsR0FBRztrQ0FDUixJQUFJLENBQUMsSUFBSTtvQkFDYixLQUFLO3FCQUNMLE1BQU07b0NBTE8sSUFBSSxDQUFDLFVBQVUsS0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssT0FBTzs7OzRDQVJsRCxRQUFRLE9BQUcsS0FBSyxHQUFHLGFBQWEsT0FBRyxNQUFNLEdBQUcsS0FBSzs7c0NBT3pDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7NEVBTFMsSUFBSSxDQUFDLFVBQVU7Ozs7OEVBUWhDLElBQUksQ0FBQyxHQUFHOzs7OzhFQUNSLElBQUksQ0FBQyxJQUFJOzs7OztxQkFDYixLQUFLOzs7O3NCQUNMLE1BQU07Ozs7cUNBTE8sSUFBSSxDQUFDLFVBQVUsS0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssT0FBTzs7O1lBT3BELElBQUksQ0FBQyxVQUFVLEtBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLE9BQU87Ozs7Ozs7Ozs7O1lBR3pDLE9BQU8sR0FBRyxFQUFFOzs7Ozs7Ozs7Ozs7O3NGQWxCVixRQUFRLE9BQUcsS0FBSyxHQUFHLGFBQWEsT0FBRyxNQUFNLEdBQUcsS0FBSzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O3NTQXJON0QsZ0JBQWdCLEdBQUcsaUJBQWlCLEdBQUcsaUJBQWlCOztzQkFwTnRELFVBQVU7Ozs7Ozs7Ozs7OztpQ0FpQlAsT0FBTzs7Ozs7Ozs7Ozs7O2lDQTZOVCxPQUFPOzs7Ozs7Ozs7Ozs7aUNBNktQLGlCQUFpQjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7NENBbk5aLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLElBQUksY0FBYzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Z0NBbUpuQixLQUFDLGdCQUFnQjs7Ozs7O21DQW5XMUMsZUFBZTttREFDSTtpQ0FDckIsU0FBUzttQ0FDUCxXQUFXOytCQUlnQixRQUFRO2dDQTBLaEMsTUFBTTtrQ0FDSixNQUFNOzs7aUNBNkJMLGNBQWM7a0NBSWQsUUFBUTtrQ0FPVixnQkFBZ0I7a0NBS2hCLGNBQWM7a0NBTWQsUUFBUTs4QkFLUixTQUFTO2tDQU1ILE1BQU07bUNBRTBCLFFBQVE7K0JBa0h2QixZQUFZO2lDQW9CL0IsY0FBYztpQ0FPZCxjQUFjO2lDQU9kLGNBQWM7aUNBT2QsY0FBYztpQ0FPZCxjQUFjO2tDQU9kLGlCQUFpQjtrQ0FLZixXQUFXOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7dUJBeE5iLE9BQU87Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztZQWhNbEIsVUFBVTs7Ozs7Ozs7Ozs7OztpRUFpQlAsT0FBTzs7Ozs7Ozs7NENBK0tDLE9BQU87Ozs7Ozs4RUFRWixPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxJQUFJLGNBQWM7Ozs7cUVBWWpELGdCQUFnQixHQUFHLGlCQUFpQixHQUFHLGlCQUFpQjs7Ozs7Ozs7OztpRUEwQnJELE9BQU87Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7MkVBNktQLGlCQUFpQjs7Ozs7aUNBaEVVLEtBQUMsZ0JBQWdCOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0NBM3RDdEQsTUFBTSxVQUFVLEdBQUcsYUFBYSxDQUFDOztDQUNqQyxJQUFJLE9BQU8sR0FBRyxHQUFHLENBQUM7O0NBaVlsQixTQUFTLFNBQVMsR0FBRztDQUN2QjtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTs7Q0FFQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNFLENBQUM7O0NBTUQsU0FBUyxTQUFTLENBQUMsSUFBSSxFQUFFLE1BQU0sRUFBRTtDQUNqQyxFQUFFLE9BQU8sR0FBRyxJQUFJLElBQUksR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQztDQUN6RCxDQUFDOzs7Ozs7Ozs7R0FyYUQsTUFBTSxHQUFHLEdBQUcsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDLFdBQVcsQ0FBQztHQUU1QyxNQUFNLFVBQVUsR0FBRyxJQUFJQSxVQUFFLENBQUMsR0FBRyxDQUFDLENBQUM7Ozs7R0FJL0IsTUFBTSxPQUFPLEdBQUc7S0FDZCxHQUFHLEVBQUUsTUFBTSxFQUFFO0tBQ2IsR0FBRyxFQUFFLE1BQU0sRUFBRTtJQUNkLENBQUM7R0FJRixJQUFJLE1BQU0sR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sR0FBRyxVQUFVLENBQUMsQ0FBQzs7R0FFOUMsSUFBSSxVQUFVLEdBQUcsSUFBSSxDQUFDOztHQVF0QixNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDO0dBQzNCLE9BQU8sQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxLQUFLO0tBQ3RCLElBQUksVUFBVSxFQUFFLE1BQU0sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7VUFDeEI7T0FDSCxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQixDQUFDLENBQUM7TUFDaEM7SUFDRixtQ0FBQzs7R0FFRixJQUFJLE1BQU0sR0FBRyxPQUFPLENBQUM7R0FDckIsSUFBSSxLQUFLLEdBQUcsTUFBTSxDQUFDO0dBQ25CLElBQUksZ0JBQWdCLEdBQUcsSUFBSSxDQUFDO0dBQzVCLElBQUksZ0JBQWdCLEdBQUcsSUFBSSxDQUFDO0dBQzVCLElBQUksT0FBTyxHQUFHLEdBQUcsQ0FBQzs7R0FFbEIsSUFBSSxPQUFPLENBQUM7O0dBRVosSUFBSSxpQkFBaUIsR0FBRyxDQUFDLENBQUMsQ0FBQzs7R0FFM0IsU0FBUyxpQkFBaUIsQ0FBQyxJQUFJLEVBQUU7S0FDL0IsSUFBSSxpQkFBaUIsSUFBSSxJQUFJLG9DQUFFLGlCQUFpQixHQUFHLENBQUMsRUFBQyxDQUFDOzRDQUNqRCxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsR0FBRSxDQUFDO0lBQ3BDOztHQVFELElBQUksT0FBTyxHQUFHLElBQUksT0FBTyxDQUFDLE9BQU8sSUFBSSxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztHQUNsRCxJQUFJLGlCQUFpQixHQUFHLElBQUksT0FBTyxDQUFDLE9BQU87S0FDekMsT0FBTyxDQUFDLEVBQUUsSUFBSSxFQUFFLEVBQUUsRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLFdBQVcsRUFBRSxDQUFDLEVBQUUsQ0FBQztJQUN2RCxDQUFDOztHQUVGLElBQUksS0FBSyxDQUFDO0dBQ1YsSUFBSSxNQUFNLENBQUM7R0FDWCxJQUFJLFFBQVEsR0FBRyxDQUFDLENBQUM7R0FDakIsSUFBSSxHQUFHLEdBQUcsQ0FBQyxDQUFDOztHQUVaLElBQUksTUFBTSxDQUFDO0dBQ1gsSUFBSSxNQUFNLENBQUM7R0FDWCxJQUFJLE1BQU0sQ0FBQzs7R0FFWCxJQUFJLFNBQVMsQ0FBQztHQUNkLElBQUksVUFBVSxDQUFDO0dBQ2YsSUFBSSxRQUFRLENBQUM7R0FDYixJQUFJLFVBQVUsQ0FBQztHQUNmLElBQUksVUFBVSxDQUFDO0dBQ2YsSUFBSSxjQUFjLENBQUM7O0dBRW5CLElBQUksU0FBUyxHQUFHLElBQUksQ0FBQztHQUNyQixJQUFJLGVBQWUsQ0FBQzs7R0FFcEIsU0FBUyxnQkFBZ0IsQ0FBQyxNQUFNLEVBQUU7S0FDaEMsSUFBSSxDQUFDLE1BQU0sRUFBRSxlQUFlLEdBQUcsSUFBSSxDQUFDO0tBQ3BDLElBQUksQ0FBQyxHQUFHLGVBQWUsQ0FBQyxLQUFLLENBQUM7S0FDOUIsSUFBSSxDQUFDLENBQUMsRUFBRSxnQkFBUSxTQUFTLEdBQUcsSUFBSSx3REFBQyxDQUFDOztLQUVsQyxDQUFDLEdBQUcsQ0FBQztRQUNGLElBQUksRUFBRTtRQUNOLE9BQU8sQ0FBQyxTQUFTLEVBQUUsR0FBRyxDQUFDO1FBQ3ZCLFdBQVcsRUFBRTtRQUNiLE9BQU8sQ0FBQyxNQUFNLEVBQUUsU0FBUyxDQUFDLENBQUM7OztLQUc5QixPQUFPLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxDQUFDLENBQUMsQ0FBQztLQUMxQixNQUFNLE1BQU0sR0FBRyxFQUFFLENBQUM7S0FDbEIsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFDO0tBQ2QsTUFBTSxDQUFDLEdBQUcsSUFBSSxNQUFNLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxDQUFDO0tBQzlCLEtBQUssSUFBSSxLQUFLLElBQUksTUFBTSxFQUFFO09BQ3hCLEtBQUssSUFBSSxJQUFJLElBQUksS0FBSyxDQUFDLEtBQUssRUFBRTtTQUM1QixJQUFJLENBQUMsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLFNBQVM7U0FDNUQsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLFdBQVcsRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxTQUFTO1NBQzVELEtBQUssSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDO1NBQ3BCLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDbkI7TUFDRjs7K0JBRUQsU0FBUyxHQUFHO09BQ1Y7U0FDRSxLQUFLLEVBQUUsTUFBTTtTQUNiLElBQUksRUFBRSxDQUFDO1NBQ1AsS0FBSztTQUNMLElBQUksRUFBRSxFQUFFO1NBQ1IsSUFBSSxFQUFFO1dBQ0osS0FBSyxFQUFFLENBQUM7V0FDUixJQUFJLEVBQUUsQ0FBQztXQUNQLFNBQVMsRUFBRSxDQUFDO1dBQ1osT0FBTyxFQUFFLEdBQUc7V0FDWixLQUFLLEVBQUUsQ0FBQztXQUNSLEdBQUcsRUFBRSxDQUFDO1dBQ04sR0FBRyxFQUFFLEdBQUc7V0FDUixLQUFLLEVBQUUsQ0FBQztVQUNUO1NBQ0QsU0FBUyxFQUFFLEVBQUU7U0FDYixJQUFJLEVBQUUsZUFBZTtRQUN0QjtPQUNGLENBQUM7SUFDSDtHQUNELFNBQVMsaUJBQWlCLEdBQUc7S0FDM0IsU0FBUyxDQUFDLE9BQU8sR0FBRyxLQUFLLHVDQUFDO0tBQzFCLFVBQVUsQ0FBQyxPQUFPLEdBQUcsS0FBSyx5Q0FBQztLQUMzQixRQUFRLENBQUMsT0FBTyxHQUFHLEtBQUsscUNBQUM7S0FDekIsVUFBVSxDQUFDLE9BQU8sR0FBRyxLQUFLLHlDQUFDO0tBQzNCLFVBQVUsQ0FBQyxPQUFPLEdBQUcsS0FBSyx5Q0FBQztJQUM1Qjs7R0FFRCxTQUFTLGNBQWMsR0FBRztLQUN4QixjQUFjLENBQUMsT0FBTyxHQUFHLEtBQUssaURBQUM7SUFDaEM7O0dBRUQsU0FBUyxXQUFXLENBQUMsT0FBTyxFQUFFO0tBQzVCLElBQUksT0FBTyxPQUFPLElBQUksUUFBUSxFQUFFO3lDQUM5QixpQkFBaUIsR0FBRyxVQUFVLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBQyxDQUFDO09BQy9DLE9BQU87TUFDUjtLQUNELE1BQU0sTUFBTSxHQUFHLElBQUksR0FBRyxFQUFFLENBQUM7S0FDekIsSUFBSSxjQUFjLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7S0FDNUMsSUFBSSxTQUFTLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7S0FDdkMsSUFBSSxVQUFVLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7S0FDeEMsSUFBSSxRQUFRLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7S0FDdEMsSUFBSSxVQUFVLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7S0FDeEMsSUFBSSxVQUFVLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7O3VDQUV4QyxpQkFBaUIsR0FBRyxVQUFVLENBQUMsTUFBTSxDQUFDO09BQ3BDLElBQUksRUFBRSxNQUFNLENBQUMsS0FBSztPQUNsQixJQUFJLEVBQUUsTUFBTSxDQUFDLEtBQUs7T0FDbEIsSUFBSSxFQUFFLE1BQU0sQ0FBQyxLQUFLO09BQ2xCLFNBQVMsRUFBRSxNQUFNO01BQ2xCLEVBQUMsQ0FBQztJQUNKOztHQUVELElBQUksa0JBQWtCLEdBQUcsSUFBSSxDQUFDO0dBQzlCLFNBQVMsZUFBZSxDQUFDLEdBQUcsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFO0tBQzFDLEdBQUcsQ0FBQyxjQUFjLEVBQUUsQ0FBQztLQUNyQixJQUFJLEdBQUcsQ0FBQyxLQUFLLElBQUksQ0FBQyxJQUFJLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFOzswQ0FFdkMsa0JBQWtCLEdBQUcsS0FBSSxDQUFDO01BQzNCO0tBQ0QsT0FBTyxLQUFLLENBQUM7SUFDZDs7R0FFRCxTQUFTLGdCQUFnQixDQUFDLEdBQUcsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFO3dDQUMxQyxrQkFBa0IsR0FBRyxLQUFJLENBQUM7S0FDMUIsR0FBRyxDQUFDLGVBQWUsRUFBRSxDQUFDO0tBQ3RCLEdBQUcsQ0FBQyxjQUFjLEVBQUUsQ0FBQztLQUNyQixJQUFJLElBQUksR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDOztLQUV2QixNQUFNLENBQUMsR0FBRyxJQUFJLE1BQU0sQ0FBQyxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEtBQUssQ0FBQyxDQUFDO0tBQ2xELElBQUksR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQztLQUMzQixJQUFJLEtBQUssR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztLQUNyQyxJQUFJLEtBQUssR0FBRyxDQUFDLEVBQUUsT0FBTztLQUN0QixLQUFLLElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUM7O0tBRTNCLE1BQU0sTUFBTSxHQUFHLElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxHQUFHLEdBQUcsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDO0tBQ25ELElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxLQUFLLENBQUMsR0FBRyxNQUFNLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQztLQUN6RCxLQUFLLENBQUMsS0FBSyxHQUFHLElBQUksK0JBQUM7S0FDbkIsTUFBTSxFQUFFLENBQUM7SUFDVjs7R0FFRCxTQUFTLGVBQWUsQ0FBQyxHQUFHLEVBQUU7d0NBQzVCLGtCQUFrQixHQUFHLEtBQUksQ0FBQztJQUMzQjs7R0FFRCxJQUFJLFlBQVksR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFDOztHQUU3QixTQUFTLHFCQUFxQixDQUFDLEtBQUssRUFBRTtLQUNwQyxJQUFJLFlBQVksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxFQUFFLFlBQVksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO1VBQzdELFlBQVksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDOztLQUVsQywwQ0FBMkIsQ0FBQztJQUM3Qjs7R0FFRCxTQUFTLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFOzhCQUNoQixRQUFRLEdBQUcsRUFBQyxDQUFDO3lCQUNiLEdBQUcsR0FBRyxFQUFDLENBQUM7SUFDVDs7R0FFRCxTQUFTLGVBQWUsR0FBRzsrQkFDekIsU0FBUyxHQUFHLEtBQUksQ0FBQztLQUNqQixJQUFJLENBQUMsZUFBZSxFQUFFLE9BQU87S0FDN0IsZUFBZSxDQUFDLEtBQUssR0FBRyxFQUFFLG1EQUFDO0lBQzVCOztHQUVELFNBQVMsY0FBYyxHQUFHOzZCQUN4QixPQUFPLEdBQUcsVUFBVSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLEtBQUs7T0FDckQsZUFBZSxFQUFFLENBQUM7T0FDbEIsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztNQUNWLENBQUM7UUFDQyxLQUFLLENBQUMsQ0FBQyxJQUFJO1NBQ1YsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztTQUNqQixNQUFNLENBQUMsQ0FBQztRQUNULENBQUM7UUFDRCxJQUFJLENBQUMsR0FBRyxJQUFJO1NBQ1gsS0FBSyxDQUFDLEtBQUssR0FBRyxHQUFHLCtCQUFDO1NBQ2xCLE9BQU8sTUFBTSxDQUFDLEVBQUUsT0FBTyxFQUFFLEVBQUUsRUFBRSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQ3RDLEVBQUMsQ0FBQztJQUNOOztHQUVELElBQUksYUFBYSxDQUFDO0dBQ2xCLFNBQVMsUUFBUSxHQUFHO0tBQ2xCLElBQUksQ0FBQyxhQUFhLEVBQUUsT0FBTyxLQUFLLENBQUMsa0JBQWtCLENBQUMsQ0FBQzs7OztLQUlyRCxHQUFHLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxFQUFFLElBQUksRUFBRSxLQUFLLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxhQUFhLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztJQW1CeEU7O0dBRUQsU0FBUyxjQUFjLEdBQUc7S0FDeEIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQzlDOztHQUVELFNBQVMsV0FBVyxDQUFDLEdBQUcsRUFBRTtLQUN4QixJQUFJLEdBQUcsQ0FBQyxPQUFPLElBQUksR0FBRyxDQUFDLE9BQU8sRUFBRTtPQUM5QixRQUFRLEdBQUcsQ0FBQyxLQUFLO1NBQ2YsS0FBSyxFQUFFO1dBQ0wsR0FBRyxDQUFDLGNBQWMsRUFBRSxDQUFDO1dBQ3JCLEdBQUcsQ0FBQyxlQUFlLEVBQUUsQ0FBQztXQUN0QixRQUFRLEVBQUUsQ0FBQztXQUNYLE1BQU07UUFDVDtNQUNGO0lBQ0Y7O0dBRUQsU0FBUyxTQUFTLENBQUMsR0FBRyxFQUFFO0tBQ3RCLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNiOztHQUVELGVBQWUsTUFBTSxDQUFDLEdBQUcsRUFBRTtLQUN6QixJQUFJLEdBQUcsQ0FBQyxPQUFPLEtBQUssRUFBRSxFQUFFLE9BQU87O0tBRS9CLElBQUksY0FBYyxHQUFHLENBQUMsQ0FBQztLQUN2QixJQUFJLE9BQU8sRUFBRTtPQUNYLGNBQWMsR0FBRyxPQUFPLENBQUMsU0FBUyxDQUFDO01BQ3BDOzs2QkFFRCxPQUFPLEdBQUcsVUFBVSxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsS0FBSyxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLEtBQUs7T0FDM0QsZUFBZSxFQUFFLENBQUM7T0FDbEIsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztNQUNWLENBQUM7UUFDQyxLQUFLLENBQUMsQ0FBQyxJQUFJO1NBQ1YsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztTQUNqQixNQUFNLENBQUMsQ0FBQztRQUNULENBQUM7UUFDRCxJQUFJLENBQUMsR0FBRyxJQUFJO1NBQ1gsS0FBSyxDQUFDLEtBQUssR0FBRyxHQUFHLENBQUMsU0FBUywrQkFBQztTQUM1QixPQUFPLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUM7U0FDakMsVUFBVSxDQUFDLE1BQU07V0FDZixPQUFPLENBQUMsU0FBUyxHQUFHLGNBQWMsbUNBQUM7VUFDcEMsQ0FBQyxDQUFDO1NBQ0gsT0FBTyxHQUFHLENBQUM7UUFDWixFQUFDLENBQUM7O0tBRUwsT0FBTyxPQUFPLENBQUM7SUFDaEI7R0FDRCxTQUFTLE1BQU0sR0FBRztLQUNoQixlQUFlLEVBQUUsQ0FBQztLQUNsQixNQUFNLENBQUMsRUFBRSxPQUFPLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQztJQUN6Qjs7R0FFRCxTQUFTLFVBQVUsQ0FBQyxJQUFJLEVBQUU7S0FDeEIsSUFBSSxDQUFDLElBQUksRUFBRSxPQUFPO0tBQ2xCLGVBQWUsRUFBRSxDQUFDO0tBQ2xCLEtBQUssQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDLEtBQUssR0FBRyxNQUFNLEdBQUcsSUFBSSwrQkFBQztLQUMxQyxNQUFNLEVBQUUsQ0FBQztJQUNWOztHQUVELFNBQVMsTUFBTSxDQUFDLElBQUksRUFBRTtLQUNwQixNQUFNLENBQUMsR0FBRyxJQUFJLE1BQU0sQ0FBQyxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLElBQUksQ0FBQyxDQUFDOztLQUVqRCxLQUFLLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsRUFBRSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQywrQkFBQzs2QkFDM0UsT0FBTyxHQUFHLFVBQVUsQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLEtBQUssSUFBSSxFQUFFLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQztPQUN0RCxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQztNQUNULENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSTtPQUNYLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7T0FDakIsTUFBTSxDQUFDLENBQUM7TUFDVCxFQUFDLENBQUM7SUFDSjs7R0FFRCxTQUFTLFFBQVEsR0FBRztLQUNsQixNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDOztLQUV6QixLQUFLLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLGNBQWMsRUFBRSxJQUFJLENBQUMsK0JBQUM7O0tBRXhELEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQzs7S0FFZixLQUFLLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxFQUFFLEtBQUssQ0FBQyxDQUFDO0tBQ2xDLFFBQVEsQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUM7O0tBRTdCLEtBQUssQ0FBQyxLQUFLLEdBQUcsSUFBSSwrQkFBQzs7S0FFbkIsS0FBSyxDQUFDLDBCQUEwQixDQUFDLENBQUM7SUFDbkM7O0dBRUQsSUFBSSxVQUFVLEdBQUcsS0FBSyxDQUFDO0dBQ3ZCLE9BQU8sQ0FBQyxZQUFZO0tBQ2xCLE1BQU0sV0FBVyxHQUFHLENBQUM7Ozs7O3VCQUtGLENBQUMsQ0FBQzs7Z0NBRXJCLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLFlBQVksRUFBQyxDQUFDOztLQUV2QyxNQUFNLFNBQVMsR0FBRyxJQUFJLGVBQWUsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0tBQzlELE1BQU0sVUFBVSxHQUFHLFNBQVMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7O0tBRXRDLElBQUksS0FBSyxHQUFHLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxJQUFJLFdBQVcsR0FBRyxXQUFXLENBQUM7O0tBRTFFLElBQUksVUFBVSxFQUFFO2tDQUNkLFVBQVUsR0FBRyxNQUFLLENBQUM7Ozs7OztNQU1wQjs7S0FFRCxTQUFTLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0tBQ3RCLE1BQU0sQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLEVBQUUsRUFBRSxFQUFFLEVBQUUsQ0FBQyxFQUFFLE1BQU0sQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDOzs7Ozs7Ozs7O3NDQVVuRSxnQkFBZ0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixDQUFDLElBQUksT0FBTSxDQUFDO0tBQzdELE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDO3NDQUN4RCxnQkFBZ0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixDQUFDLElBQUksT0FBTSxDQUFDO0tBQzdELE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDO0tBRzVELEtBQUssQ0FBQyxLQUFLLEdBQUcsS0FBSywrQkFBQztLQUNwQixNQUFNLEVBQUUsQ0FBQzs7S0FFVCxHQUFHLENBQUMsRUFBRSxDQUFDLFVBQVUsRUFBRSxDQUFDLE1BQU0sRUFBRSxJQUFJLEtBQUs7T0FDbkMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxjQUFjLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO09BQ3ZDLEtBQUssQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDLElBQUksK0JBQUM7T0FDeEIsYUFBYSxDQUFDLEtBQUssR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLElBQUksRUFBRSxFQUFFLE9BQU8sQ0FBQyxRQUFRLEVBQUUsRUFBRSxDQUFDLCtDQUFDO09BQzlELE1BQU0sRUFBRSxDQUFDO01BQ1YsQ0FBQyxDQUFDOzs7O0lBSUosQ0FBQyxDQUFDOztHQTBCSCxTQUFTLFFBQVEsR0FBRztLQUNsQixPQUFPLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsT0FBTyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDbEQ7O0dBTUQsU0FBUyxRQUFRLEdBQUc7Z0NBQ2xCLFVBQVUsR0FBRyxDQUFDLFdBQVUsQ0FBQzs7SUFFMUI7O0dBRUQsU0FBUyxZQUFZLEdBQUc7c0NBQ3RCLGdCQUFnQixHQUFHLENBQUMsaUJBQWdCLENBQUM7S0FDckMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsRUFBRSxnQkFBZ0IsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUN4RDtHQUNELFNBQVMsZ0JBQWdCLEdBQUc7c0NBQzFCLGdCQUFnQixHQUFHLENBQUMsaUJBQWdCLENBQUM7S0FDckMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsRUFBRSxnQkFBZ0IsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUN4RDs7R0FFRCxJQUFJLG1CQUFtQixHQUFHLEVBQUUsQ0FBQztHQUM3QixTQUFTLGlCQUFpQixDQUFDLFFBQVEsRUFBRTtLQUNuQyxJQUFJLFFBQVEsSUFBSSxtQkFBbUIsRUFBRTsyQ0FDbkMsbUJBQW1CLEdBQUcsR0FBRSxDQUFDO09BQ3pCLE9BQU87TUFDUixNQUFNOzJDQUNMLG1CQUFtQixHQUFHLFNBQVEsQ0FBQztNQUNoQztJQUNGOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OytEQS9ZRTtTQUNELE1BQU0sQ0FBQyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQztnQ0FDM0MsTUFBTSxHQUFHLE9BQU8sR0FBRyxFQUFDLENBQUM7K0JBQ3JCLEtBQUssR0FBRyxNQUFNLEdBQUcsRUFBQyxDQUFDO1FBQ3BCOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0NDckRILE1BQU0sQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDO0FBQ3hCLEFBQ0E7O0NBRUEsTUFBTSxDQUFDLE1BQU0sR0FBRyxXQUFXO0NBQzNCLEVBQUUsTUFBTSxZQUFZLEdBQUcsSUFBSUMsTUFBUSxDQUFDO0NBQ3BDLElBQUksTUFBTSxFQUFFLFFBQVEsQ0FBQyxJQUFJO0NBQ3pCLElBQUksS0FBSyxFQUFFO0NBQ1gsTUFBTSxJQUFJLEVBQUUsUUFBUTtDQUNwQixLQUFLO0NBQ0wsR0FBRyxDQUFDLENBQUM7Q0FDTCxDQUFDOzs7OyJ9
