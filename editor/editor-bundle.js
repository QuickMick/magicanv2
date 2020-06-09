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
	    groups["enchantmentCount"] = enchantmentCount;
	    groups["artifactCount"] = artifactCount;
	    return groups;
	  }
	}

	var cardLoader = MtgInterface;

	/* editor.svelte generated by Svelte v3.0.0 */

	const file = "editor.svelte";

	function add_css() {
		var style = element("style");
		style.id = 'svelte-xaax2-style';
		style.textContent = ".content.svelte-xaax2{--raisin-black:hsla(200, 8%, 15%, 1);--roman-silver:hsla(196, 15%, 60%, 1);--colorless:hsla(0, 0%, 89%, 1);--black:hsla(83, 8%, 38%, 1);--white:hsl(48, 64%, 89%);--red:hsla(0, 71%, 84%, 1);--green:hsla(114, 60%, 75%, 1);--blue:hsla(235, 55%, 81%, 1)}.content.svelte-xaax2{display:flex;flex-direction:row;width:100%;height:100%}.help-symbol.svelte-xaax2{border-radius:50%;border:1px solid black;width:16px;height:16px;text-align:center;position:absolute;right:10px;top:10px;cursor:pointer}.help-symbol.svelte-xaax2:hover{border-color:blue;color:blue}.toggle-search.svelte-xaax2{background:blue;width:30px;height:30px;cursor:pointer;position:absolute;left:-30px;top:50%;user-select:none}.hide.svelte-xaax2 .toggle-search.svelte-xaax2{left:-52px}.statistics.svelte-xaax2{display:flex;flex-direction:column}.input.svelte-xaax2{width:100%;height:100%;box-sizing:border-box;padding:10px;resize:none}.controls.svelte-xaax2{flex-shrink:0;width:300px;height:100%;background:lightgray;display:flex;flex-direction:column}.help.svelte-xaax2{padding:0px 10px 10px 10px;user-select:none;position:relative}.group-content.svelte-xaax2{flex-grow:1;display:flex;flex-wrap:wrap;transition:height 500ms ease}.group-content.hidden.svelte-xaax2{overflow:hidden;height:45px}.card-search.svelte-xaax2{height:100%;flex-grow:1;background:white;display:flex;flex-direction:column;position:absolute;right:0;width:33%;z-index:100;box-shadow:0px 0px 10px black}.card-search.hide.svelte-xaax2{right:-33%}.search-params.svelte-xaax2{flex-shrink:0;display:flex;flex-direction:column}.search-result.svelte-xaax2{height:100%;flex-grow:1;background:white;display:flex;flex-direction:row;overflow:auto;position:relative;user-select:none;flex-wrap:wrap}.display.svelte-xaax2{flex-grow:1;background:gray;display:flex;flex-direction:column;flex-wrap:nowrap;overflow:auto;position:relative;user-select:none}.loading-wrapper.svelte-xaax2{position:absolute;left:50%;top:0;bottom:0;display:flex;align-items:center}.entry.svelte-xaax2{position:relative;padding:10px;flex-shrink:0}.shoping.svelte-xaax2{position:absolute;z-index:10;font-size:3em;text-shadow:0px 0px 6px black;text-align:center;bottom:10%;right:10%;display:none}.entry.svelte-xaax2:hover .shoping.svelte-xaax2{display:block}.shoping.svelte-xaax2 .link.svelte-xaax2{text-decoration:none}.shoping.svelte-xaax2 .link.svelte-xaax2:hover{color:transparent;text-shadow:0 0 0 blue}.card.svelte-xaax2{position:absolute;border:6px solid rgb(22, 22, 22);border-radius:10px;outline:0;box-shadow:0px 0px 10px black}.card.banned.svelte-xaax2{border:6px solid red}.card.highlighted.svelte-xaax2{border:6px solid yellow}.card.svelte-xaax2:hover{border:6px solid blue;cursor:pointer}.card-context-menu.svelte-xaax2{position:absolute;z-index:100;background:rgba(255, 255, 255, 0.7);height:100%;width:100%;margin-left:-3px;margin-top:-3px;overflow:auto}.card-context-entry.svelte-xaax2{margin:10px;font-weight:bold;background:white;padding:5px;border-radius:9px;box-shadow:0 0 6px black;cursor:pointer}.card-context-entry.svelte-xaax2:hover{background:wheat}.price.svelte-xaax2,.banned-text.svelte-xaax2,.count.svelte-xaax2{font-size:34px;text-shadow:0px 0px 9px black;color:red;position:absolute;z-index:100;font-weight:bold;left:34px}.banned-text.svelte-xaax2{font-size:100%;text-shadow:0px 0px 9px black;color:red;position:absolute;z-index:100;font-weight:bold;left:17%}.count.svelte-xaax2{top:165px}.price.svelte-xaax2{bottom:7px;color:wheat;font-size:12px;background:black;left:45%;font-weight:normal}.group-header.svelte-xaax2{display:flex;background:darkgrey;margin:8px 0;box-shadow:0px 0px 8px black;width:100%;flex-direction:row}.group-header.svelte-xaax2 h2.svelte-xaax2{padding:0 25px;margin:0px}.group-statistics.svelte-xaax2{display:flex;flex-direction:row}.mana-proposal.svelte-xaax2,.mana-devotion.svelte-xaax2{display:flex;flex-direction:row}.deck-value.svelte-xaax2,.group-value.svelte-xaax2{padding:5px;color:black;border-radius:50%;width:15px;height:15px;text-align:center;margin:5px;display:flex;text-align:center;align-items:center;font-size:11px;font-weight:bold}.blue.svelte-xaax2{background-color:var(--blue)}.black.svelte-xaax2{color:white;background-color:var(--black)}.red.svelte-xaax2{background-color:var(--red)}.white.svelte-xaax2{background-color:var(--white)}.green.svelte-xaax2{background-color:var(--green)}.colorless.svelte-xaax2{background-color:var(--colorless)}.sum.svelte-xaax2{background-color:goldenrod}.color-param.svelte-xaax2{display:flex;flex-direction:row}.mana-curve.svelte-xaax2{display:flex;flex-direction:column}.all-curves.svelte-xaax2{display:flex;flex-grow:1;flex-direction:row;height:80px}.all-labels.svelte-xaax2{display:flex;flex-shrink:0;flex-direction:row}.curve-element.svelte-xaax2{width:20px;display:flex;position:absolute;bottom:0;background:gray;align-items:center;height:100%}.curve-label.svelte-xaax2{width:20px}.curve-wrapper.svelte-xaax2{width:20px;position:relative;cursor:pointer}.curve-element.svelte-xaax2:hover{background:lightcoral}.highlighted.svelte-xaax2 .curve-element.svelte-xaax2{background:lightblue}.curve-label.highlighted.svelte-xaax2{background:lightblue}.curve-label.svelte-xaax2:hover{background:lightcoral}h4.svelte-xaax2{margin-top:5px;margin-bottom:5px}.lds-ripple.svelte-xaax2{display:inline-block;position:relative;width:80px;height:80px}.lds-ripple.svelte-xaax2 div.svelte-xaax2{position:absolute;border:4px solid #fff;opacity:1;border-radius:50%;animation:svelte-xaax2-lds-ripple 1s cubic-bezier(0, 0.2, 0.8, 1) infinite}.card-search.svelte-xaax2 .lds-ripple div.svelte-xaax2{border:4px solid black}.lds-ripple.svelte-xaax2 div.svelte-xaax2:nth-child(2){animation-delay:-0.5s}@keyframes svelte-xaax2-lds-ripple{0%{top:36px;left:36px;width:0;height:0;opacity:1}100%{top:0px;left:0px;width:72px;height:72px;opacity:0}}\n/*# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWRpdG9yLnN2ZWx0ZSIsInNvdXJjZXMiOlsiZWRpdG9yLnN2ZWx0ZSJdLCJzb3VyY2VzQ29udGVudCI6WyI8c2NyaXB0PlxyXG4gIGltcG9ydCB7IG9uTW91bnQgfSBmcm9tIFwic3ZlbHRlXCI7XHJcbiAgLy8gY29uc3QgeyBpcGNSZW5kZXJlciB9ID0gcmVxdWlyZShcImVsZWN0cm9uXCIpO1xyXG5cclxuICBjb25zdCBpcGMgPSByZXF1aXJlKFwiZWxlY3Ryb25cIikuaXBjUmVuZGVyZXI7XHJcbiAgaW1wb3J0IGNsIGZyb20gXCIuL2NhcmQtbG9hZGVyLmpzXCI7XHJcbiAgY29uc3QgQ2FyZExvYWRlciA9IG5ldyBjbChpcGMpO1xyXG4gIC8vIGltcG9ydCBMWlVURjggZnJvbSBcImx6dXRmOFwiO1xyXG4gIC8vaW1wb3J0IENvb2tpZXMgZnJvbSBcImpzLWNvb2tpZVwiO1xyXG5cclxuICBjb25zdCBDb29raWVzID0ge1xyXG4gICAgc2V0OiAoKSA9PiB7fSxcclxuICAgIGdldDogKCkgPT4ge31cclxuICB9O1xyXG5cclxuICBjb25zdCBDQVJEX1JBVElPID0gMC43MTc2NDcwNTg4MjtcclxuICBsZXQgX2hlaWdodCA9IDMwMDtcclxuICBsZXQgX3dpZHRoID0gTWF0aC5mbG9vcihfaGVpZ2h0ICogQ0FSRF9SQVRJTyk7XHJcblxyXG4gIGxldCB1c2VDb29raWVzID0gdHJ1ZTtcclxuXHJcbiAgZnVuY3Rpb24gZW5hYmxlU2F2aW5nKCkge1xyXG4gICAgdXNlQ29va2llcyA9IHRydWU7XHJcbiAgICBDb29raWVzLnNldChcInVzZUNvb2tpZXNcIiwgdHJ1ZSk7XHJcbiAgICBzYXZlQWxsVG9Db29raWVzKCk7XHJcbiAgfVxyXG5cclxuICBjb25zdCBvbGRTZXQgPSBDb29raWVzLnNldDtcclxuICBDb29raWVzLnNldCA9IChhLCBiKSA9PiB7XHJcbiAgICBpZiAodXNlQ29va2llcykgb2xkU2V0KGEsIGIpO1xyXG4gICAgZWxzZSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKFwic2F2aW5nIGRpc2FibGVkXCIpO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGxldCBoZWlnaHQgPSBfaGVpZ2h0O1xyXG4gIGxldCB3aWR0aCA9IF93aWR0aDtcclxuICBsZXQgY2FyZFNlYXJjaEFjdGl2ZSA9IHRydWU7XHJcbiAgbGV0IHN0YXRpc3RpY3NBY3RpdmUgPSB0cnVlO1xyXG4gIGxldCBzY2FsaW5nID0gMTAwO1xyXG5cclxuICBsZXQgZGlzcGxheTtcclxuXHJcbiAgbGV0IGRldm90aW9uSGlnaGxpZ2h0ID0gLTE7XHJcblxyXG4gIGZ1bmN0aW9uIGhpZ2hsaWdodERldm90aW9uKG1hbmEpIHtcclxuICAgIGlmIChkZXZvdGlvbkhpZ2hsaWdodCA9PSBtYW5hKSBkZXZvdGlvbkhpZ2hsaWdodCA9IC0xO1xyXG4gICAgZWxzZSBkZXZvdGlvbkhpZ2hsaWdodCA9IG1hbmEgKyBcIlwiO1xyXG4gIH1cclxuXHJcbiAgJDoge1xyXG4gICAgY29uc3QgcyA9IE1hdGguZmxvb3Ioc2NhbGluZyB8fCAxMDApIC8gMTAwO1xyXG4gICAgaGVpZ2h0ID0gX2hlaWdodCAqIHM7XHJcbiAgICB3aWR0aCA9IF93aWR0aCAqIHM7XHJcbiAgfVxyXG5cclxuICBsZXQgcHJvbWlzZSA9IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gcmVzb2x2ZShbXSkpO1xyXG4gIGxldCBjYXJkU2VhcmNoUHJvbWlzZSA9IG5ldyBQcm9taXNlKHJlc29sdmUgPT5cclxuICAgIHJlc29sdmUoeyBkYXRhOiBbXSwgaGFzX21vcmU6IGZhbHNlLCB0b3RhbF9jYXJkczogMCB9KVxyXG4gICk7XHJcblxyXG4gIGxldCBpbnB1dDtcclxuICBsZXQgZm9ybWF0O1xyXG4gIGxldCBwcm9ncmVzcyA9IDA7XHJcbiAgbGV0IGFsbCA9IDA7XHJcblxyXG4gIGxldCBzcE5hbWU7XHJcbiAgbGV0IHNwVGV4dDtcclxuICBsZXQgc3BUeXBlO1xyXG5cclxuICBsZXQgc3BFREhCbHVlO1xyXG4gIGxldCBzcEVESEJsYWNrO1xyXG4gIGxldCBzcEVESFJlZDtcclxuICBsZXQgc3BFREhXaGl0ZTtcclxuICBsZXQgc3BFREhHcmVlbjtcclxuICBsZXQgc3BFREhDb2xvcmxlc3M7XHJcblxyXG4gIGxldCBkZWNrU2VhY2ggPSBudWxsO1xyXG4gIGxldCBkZWNrU2VhcmNoSW5wdXQ7XHJcblxyXG4gIGZ1bmN0aW9uIGNoYW5nZURlY2tTZWFyY2goZ3JvdXBzKSB7XHJcbiAgICBpZiAoIWdyb3VwcykgcmV0dXJuZGVja1NlYWNoID0gbnVsbDtcclxuICAgIGxldCBzID0gZGVja1NlYXJjaElucHV0LnZhbHVlO1xyXG4gICAgaWYgKCFzKSByZXR1cm4gKGRlY2tTZWFjaCA9IG51bGwpO1xyXG5cclxuICAgIHMgPSBzXHJcbiAgICAgIC50cmltKClcclxuICAgICAgLnJlcGxhY2UoL1xcc1xccysvZ20sIFwiIFwiKVxyXG4gICAgICAudG9Mb3dlckNhc2UoKVxyXG4gICAgICAucmVwbGFjZSgvXFxzL2dtLCBcIigufFxcbikqXCIpO1xyXG4gICAgLyogICAgLnNwbGl0KFwiK1wiKVxyXG4gICAgICAuam9pbihcInxcIik7Ki9cclxuICAgIGNvbnNvbGUubG9nKFwic2VhcmNoOlwiLCBzKTtcclxuICAgIGNvbnN0IHJlc3VsdCA9IFtdO1xyXG4gICAgbGV0IGNvdW50ID0gMDtcclxuICAgIGNvbnN0IHIgPSBuZXcgUmVnRXhwKHMsIFwiZ21cIik7XHJcbiAgICBmb3IgKGxldCBncm91cCBvZiBncm91cHMpIHtcclxuICAgICAgZm9yIChsZXQgY2FyZCBvZiBncm91cC5jYXJkcykge1xyXG4gICAgICAgIGlmICghY2FyZCB8fCAhY2FyZC5kYXRhIHx8ICFjYXJkLmRhdGEub3JhY2xlX3RleHQpIGNvbnRpbnVlO1xyXG4gICAgICAgIGlmICghY2FyZC5kYXRhLm9yYWNsZV90ZXh0LnRvTG93ZXJDYXNlKCkubWF0Y2gocikpIGNvbnRpbnVlO1xyXG4gICAgICAgIGNvdW50ICs9IGNhcmQuY291bnQ7XHJcbiAgICAgICAgcmVzdWx0LnB1c2goY2FyZCk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBkZWNrU2VhY2ggPSBbXHJcbiAgICAgIHtcclxuICAgICAgICBjYXJkczogcmVzdWx0LFxyXG4gICAgICAgIGNvc3Q6IDAsXHJcbiAgICAgICAgY291bnQsXHJcbiAgICAgICAgZGVjazoge30sXHJcbiAgICAgICAgbWFuYToge1xyXG4gICAgICAgICAgYmxhY2s6IDAsXHJcbiAgICAgICAgICBibHVlOiAwLFxyXG4gICAgICAgICAgY29sb3JsZXNzOiAwLFxyXG4gICAgICAgICAgZ2VuZXJpYzogMjQwLFxyXG4gICAgICAgICAgZ3JlZW46IDAsXHJcbiAgICAgICAgICByZWQ6IDAsXHJcbiAgICAgICAgICBzdW06IDI0MCxcclxuICAgICAgICAgIHdoaXRlOiAwXHJcbiAgICAgICAgfSxcclxuICAgICAgICBtYW5hQ3VydmU6IFtdLFxyXG4gICAgICAgIG5hbWU6IFwic2VhcmNoIHJlc3VsdFwiXHJcbiAgICAgIH1cclxuICAgIF07XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIGNsZWFyRm9yQ29sb3JsZXNzKCkge1xyXG4gICAgc3BFREhCbHVlLmNoZWNrZWQgPSBmYWxzZTtcclxuICAgIHNwRURIQmxhY2suY2hlY2tlZCA9IGZhbHNlO1xyXG4gICAgc3BFREhSZWQuY2hlY2tlZCA9IGZhbHNlO1xyXG4gICAgc3BFREhXaGl0ZS5jaGVja2VkID0gZmFsc2U7XHJcbiAgICBzcEVESEdyZWVuLmNoZWNrZWQgPSBmYWxzZTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIGNsZWFyQ29sb3JsZXNzKCkge1xyXG4gICAgc3BFREhDb2xvcmxlc3MuY2hlY2tlZCA9IGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gc2VhcmNoQ2FyZHMobmV4dFVybCkge1xyXG4gICAgaWYgKHR5cGVvZiBuZXh0VXJsID09IFwic3RyaW5nXCIpIHtcclxuICAgICAgY2FyZFNlYXJjaFByb21pc2UgPSBDYXJkTG9hZGVyLnNlYXJjaChuZXh0VXJsKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3QgY29sb3JzID0gbmV3IFNldCgpO1xyXG4gICAgaWYgKHNwRURIQ29sb3JsZXNzLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJDXCIpO1xyXG4gICAgaWYgKHNwRURIQmx1ZS5jaGVja2VkKSBjb2xvcnMuYWRkKFwiVVwiKTtcclxuICAgIGlmIChzcEVESEJsYWNrLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJCXCIpO1xyXG4gICAgaWYgKHNwRURIUmVkLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJSXCIpO1xyXG4gICAgaWYgKHNwRURIV2hpdGUuY2hlY2tlZCkgY29sb3JzLmFkZChcIldcIik7XHJcbiAgICBpZiAoc3BFREhHcmVlbi5jaGVja2VkKSBjb2xvcnMuYWRkKFwiR1wiKTtcclxuXHJcbiAgICBjYXJkU2VhcmNoUHJvbWlzZSA9IENhcmRMb2FkZXIuc2VhcmNoKHtcclxuICAgICAgbmFtZTogc3BOYW1lLnZhbHVlLFxyXG4gICAgICB0ZXh0OiBzcFRleHQudmFsdWUsXHJcbiAgICAgIHR5cGU6IHNwVHlwZS52YWx1ZSxcclxuICAgICAgZWRoY29sb3JzOiBjb2xvcnNcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgbGV0IGN1cnJlbnRDYXJkQ29udGV4dCA9IG51bGw7XHJcbiAgZnVuY3Rpb24gY2FyZENvbnRleHRNZW51KGV2dCwgY2FyZCwgZ3JvdXBzKSB7XHJcbiAgICBldnQucHJldmVudERlZmF1bHQoKTtcclxuICAgIGlmIChldnQud2hpY2ggPT0gMyAmJiBncm91cHMubGVuZ3RoID4gMSkge1xyXG4gICAgICAvLyByaWdodCBjbGlja1xyXG4gICAgICBjdXJyZW50Q2FyZENvbnRleHQgPSBjYXJkO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gY2FyZENvbnRleHRDbGljayhldnQsIGNhcmQsIGdyb3VwKSB7XHJcbiAgICBjdXJyZW50Q2FyZENvbnRleHQgPSBudWxsO1xyXG4gICAgZXZ0LnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgZXZ0LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICBsZXQgZGVjayA9IGlucHV0LnZhbHVlO1xyXG5cclxuICAgIGNvbnN0IHIgPSBuZXcgUmVnRXhwKGBeLioke2NhcmQubmFtZX0uKiRgLCBcImdtaVwiKTtcclxuICAgIGRlY2sgPSBkZWNrLnJlcGxhY2UociwgXCJcIik7XHJcbiAgICBsZXQgaW5kZXggPSBkZWNrLmluZGV4T2YoZ3JvdXAubmFtZSk7XHJcbiAgICBpZiAoaW5kZXggPCAwKSByZXR1cm47XHJcbiAgICBpbmRleCArPSBncm91cC5uYW1lLmxlbmd0aDtcclxuXHJcbiAgICBjb25zdCBpbnNlcnQgPSBcIlxcblwiICsgY2FyZC5jb3VudCArIFwiIFwiICsgY2FyZC5uYW1lO1xyXG4gICAgZGVjayA9IGRlY2suc2xpY2UoMCwgaW5kZXgpICsgaW5zZXJ0ICsgZGVjay5zbGljZShpbmRleCk7XHJcbiAgICBpbnB1dC52YWx1ZSA9IGRlY2s7XHJcbiAgICByZWxvYWQoKTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIG9uTWFpbk1vdXNlRG93bihldnQpIHtcclxuICAgIGN1cnJlbnRDYXJkQ29udGV4dCA9IG51bGw7XHJcbiAgfVxyXG5cclxuICBsZXQgaGlkZGVuR3JvdXBzID0gbmV3IFNldCgpO1xyXG5cclxuICBmdW5jdGlvbiB0b2dnbGVHcm91cFZpc2liaWxpdHkoZ3JvdXApIHtcclxuICAgIGlmIChoaWRkZW5Hcm91cHMuaGFzKGdyb3VwLm5hbWUpKSBoaWRkZW5Hcm91cHMuZGVsZXRlKGdyb3VwLm5hbWUpO1xyXG4gICAgZWxzZSBoaWRkZW5Hcm91cHMuYWRkKGdyb3VwLm5hbWUpO1xyXG5cclxuICAgIGhpZGRlbkdyb3VwcyA9IGhpZGRlbkdyb3VwcztcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHNwKHAsIGEpIHtcclxuICAgIHByb2dyZXNzID0gcDtcclxuICAgIGFsbCA9IGE7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiByZXNldERlY2tTZWFyY2goKSB7XHJcbiAgICBkZWNrU2VhY2ggPSBudWxsO1xyXG4gICAgaWYgKCFkZWNrU2VhcmNoSW5wdXQpIHJldHVybjtcclxuICAgIGRlY2tTZWFyY2hJbnB1dC52YWx1ZSA9IFwiXCI7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBzb3J0RGVja1N0cmluZygpIHtcclxuICAgIHByb21pc2UgPSBDYXJkTG9hZGVyLnNvcnQoaW5wdXQudmFsdWUgfHwgXCJcIiwgKHAsIGEpID0+IHtcclxuICAgICAgcmVzZXREZWNrU2VhcmNoKCk7XHJcbiAgICAgIHNwKHAsIGEpO1xyXG4gICAgfSlcclxuICAgICAgLmNhdGNoKGUgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZSk7XHJcbiAgICAgICAgdGhyb3cgZTtcclxuICAgICAgfSlcclxuICAgICAgLnRoZW4ocmVzID0+IHtcclxuICAgICAgICBpbnB1dC52YWx1ZSA9IHJlcztcclxuICAgICAgICByZXR1cm4gdXBkYXRlKHsga2V5Q29kZTogMjcgfSwgdHJ1ZSk7XHJcbiAgICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgbGV0IGRlY2tOYW1lSW5wdXQ7XHJcbiAgZnVuY3Rpb24gc2F2ZURlY2soKSB7XHJcbiAgICBpZiAoIWRlY2tOYW1lSW5wdXQpIHJldHVybiBhbGVydChcInBscyBpbnB1dCBhIG5hbWVcIik7XHJcblxyXG4gICAgLy8gY29uc3QgZmlsZW5hbWUgPSAoZGVja05hbWVJbnB1dC52YWx1ZSB8fCBcInVua25vd24gZGVja1wiKSArIFwiLnR4dFwiO1xyXG5cclxuICAgIGlwYy5zZW5kKFwic2F2ZURlY2tcIiwgeyBkZWNrOiBpbnB1dC52YWx1ZSwgbmFtZTogZGVja05hbWVJbnB1dC52YWx1ZSB9KTtcclxuXHJcbiAgICAvKiAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtkZWNrXSwgeyB0eXBlOiBcInRleHQvcGxhaW47Y2hhcnNldD11dGYtOFwiIH0pO1xyXG4gICAgaWYgKHdpbmRvdy5uYXZpZ2F0b3IubXNTYXZlT3JPcGVuQmxvYilcclxuICAgICAgLy8gSUUxMCtcclxuICAgICAgd2luZG93Lm5hdmlnYXRvci5tc1NhdmVPck9wZW5CbG9iKGJsb2IsIGZpbGVuYW1lKTtcclxuICAgIGVsc2Uge1xyXG4gICAgICAvLyBPdGhlcnNcclxuICAgICAgdmFyIGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiYVwiKSxcclxuICAgICAgICB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgICBhLmhyZWYgPSB1cmw7XHJcbiAgICAgIGEuZG93bmxvYWQgPSBmaWxlbmFtZTtcclxuICAgICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcclxuICAgICAgYS5jbGljaygpO1xyXG4gICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XHJcbiAgICAgICAgd2luZG93LlVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcclxuICAgICAgfSwgMCk7XHJcbiAgICB9Ki9cclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIG9uRGVja05hbWVUeXBlKCkge1xyXG4gICAgQ29va2llcy5zZXQoXCJkZWNrTmFtZVwiLCBkZWNrTmFtZUlucHV0LnZhbHVlKTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIG1haW5LZXlEb3duKGV2dCkge1xyXG4gICAgaWYgKGV2dC5jdHJsS2V5IHx8IGV2dC5tZXRhS2V5KSB7XHJcbiAgICAgIHN3aXRjaCAoZXZ0LndoaWNoKSB7XHJcbiAgICAgICAgY2FzZSA4MzogLy8gc1xyXG4gICAgICAgICAgZXZ0LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgICBldnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICBzYXZlRGVjaygpO1xyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIG1haW5LZXlVcChldnQpIHtcclxuICAgIHVwZGF0ZShldnQpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgZnVuY3Rpb24gdXBkYXRlKGV2dCkge1xyXG4gICAgaWYgKGV2dC5rZXlDb2RlICE9PSAyNykgcmV0dXJuO1xyXG5cclxuICAgIGxldCBzY3JvbGxQb3NpdGlvbiA9IDA7XHJcbiAgICBpZiAoZGlzcGxheSkge1xyXG4gICAgICBzY3JvbGxQb3NpdGlvbiA9IGRpc3BsYXkuc2Nyb2xsVG9wO1xyXG4gICAgfVxyXG5cclxuICAgIHByb21pc2UgPSBDYXJkTG9hZGVyLmNyZWF0ZURlY2soaW5wdXQudmFsdWUgfHwgXCJcIiwgKHAsIGEpID0+IHtcclxuICAgICAgcmVzZXREZWNrU2VhcmNoKCk7XHJcbiAgICAgIHNwKHAsIGEpO1xyXG4gICAgfSlcclxuICAgICAgLmNhdGNoKGUgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZSk7XHJcbiAgICAgICAgdGhyb3cgZTtcclxuICAgICAgfSlcclxuICAgICAgLnRoZW4ocmVzID0+IHtcclxuICAgICAgICBpbnB1dC52YWx1ZSA9IHJlcy5jb3JyZWN0ZWQ7XHJcbiAgICAgICAgQ29va2llcy5zZXQoXCJkZWNrXCIsIGlucHV0LnZhbHVlKTtcclxuICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgIGRpc3BsYXkuc2Nyb2xsVG9wID0gc2Nyb2xsUG9zaXRpb247XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgcmV0dXJuIHJlcztcclxuICAgICAgfSk7XHJcblxyXG4gICAgcmV0dXJuIHByb21pc2U7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIHJlbG9hZCgpIHtcclxuICAgIHJlc2V0RGVja1NlYXJjaCgpO1xyXG4gICAgdXBkYXRlKHsga2V5Q29kZTogMjcgfSk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBhcHBlbmRDYXJkKG5hbWUpIHtcclxuICAgIGlmICghbmFtZSkgcmV0dXJuO1xyXG4gICAgcmVzZXREZWNrU2VhcmNoKCk7XHJcbiAgICBpbnB1dC52YWx1ZSA9IGlucHV0LnZhbHVlICsgXCJcXG4xIFwiICsgbmFtZTtcclxuICAgIHJlbG9hZCgpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gcmVtb3ZlKGNhcmQpIHtcclxuICAgIGNvbnN0IHIgPSBuZXcgUmVnRXhwKGBeLioke2NhcmQubmFtZX0uKiRgLCBcImdtXCIpO1xyXG5cclxuICAgIGlucHV0LnZhbHVlID0gaW5wdXQudmFsdWUucmVwbGFjZShyLCBcIi8vIFwiICsgY2FyZC5jb3VudCArIFwiIFwiICsgY2FyZC5uYW1lKTtcclxuICAgIHByb21pc2UgPSBDYXJkTG9hZGVyLmNyZWF0ZURlY2soaW5wdXQudmFsdWUgfHwgXCJcIiwgKHAsIGEpID0+XHJcbiAgICAgIHNwKHAsIGEpXHJcbiAgICApLmNhdGNoKGUgPT4ge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGUpO1xyXG4gICAgICB0aHJvdyBlO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBjb3B5RGVjaygpIHtcclxuICAgIGNvbnN0IGRlY2sgPSBpbnB1dC52YWx1ZTtcclxuXHJcbiAgICBpbnB1dC52YWx1ZSA9IGlucHV0LnZhbHVlLnJlcGxhY2UoLyMuKnxcXC9cXC8uKi9nbSwgXCJcXG5cIik7XHJcblxyXG4gICAgaW5wdXQuc2VsZWN0KCk7XHJcblxyXG4gICAgaW5wdXQuc2V0U2VsZWN0aW9uUmFuZ2UoMCwgOTk5OTkpO1xyXG4gICAgZG9jdW1lbnQuZXhlY0NvbW1hbmQoXCJjb3B5XCIpO1xyXG5cclxuICAgIGlucHV0LnZhbHVlID0gZGVjaztcclxuXHJcbiAgICBhbGVydChcIkRlY2sgY29waWVkIHRvIGNsaXBib2FyZFwiKTtcclxuICB9XHJcblxyXG4gIGxldCBoZWxwQWN0aXZlID0gZmFsc2U7XHJcbiAgb25Nb3VudChhc3luYyAoKSA9PiB7XHJcbiAgICBjb25zdCBkZWZhdWx0RGVjayA9IGAjbGFuZHNcclxubW91bnRhaW5cclxuMiBwbGFpbnNcclxuMyBzd2FtcHNcclxuIyBtYWluIGRlY2tcclxuMjAgYmxpZ2h0c3RlZWwgY29sb3NzdXNgO1xyXG5cclxuICAgIHVzZUNvb2tpZXMgPSBDb29raWVzLmdldChcInVzZUNvb2tpZXNcIik7XHJcblxyXG4gICAgY29uc3QgdXJsUGFyYW1zID0gbmV3IFVSTFNlYXJjaFBhcmFtcyh3aW5kb3cubG9jYXRpb24uc2VhcmNoKTtcclxuICAgIGNvbnN0IHNoYXJlZERlY2sgPSB1cmxQYXJhbXMuZ2V0KFwiZFwiKTtcclxuXHJcbiAgICBsZXQgc3RhcnQgPSB1c2VDb29raWVzID8gQ29va2llcy5nZXQoXCJkZWNrXCIpIHx8IGRlZmF1bHREZWNrIDogZGVmYXVsdERlY2s7XHJcblxyXG4gICAgaWYgKHNoYXJlZERlY2spIHtcclxuICAgICAgdXNlQ29va2llcyA9IGZhbHNlO1xyXG4gICAgICAvKiBjb25zdCBidWZmZXIgPSBuZXcgVWludDhBcnJheShzaGFyZWREZWNrLnNwbGl0KFwiLFwiKSk7XHJcbiAgICAqIGNvbnN0IGRlY29tcHJlc3NlZCA9IExaVVRGOC5kZWNvbXByZXNzKGJ1ZmZlcik7XHJcbiAgICAgIGlmIChkZWNvbXByZXNzZWQpIHtcclxuICAgICAgICBzdGFydCA9IGRlY29tcHJlc3NlZDtcclxuICAgICAgfSovXHJcbiAgICB9XHJcblxyXG4gICAgdXJsUGFyYW1zLmRlbGV0ZShcImRcIik7XHJcbiAgICB3aW5kb3cuaGlzdG9yeS5yZXBsYWNlU3RhdGUoe30sIFwiXCIsIGAke3dpbmRvdy5sb2NhdGlvbi5wYXRobmFtZX1gKTtcclxuXHJcbiAgICAvLyAgICB3aW5kb3cuaGlzdG9yeS5yZXBsYWNlU3RhdGUoXHJcbiAgICAvLyAgIHt9LFxyXG4gICAgLy8gICAnJyxcclxuICAgIC8vICAgYCR7d2luZG93LmxvY2F0aW9uLnBhdGhuYW1lfT8ke3BhcmFtc30ke3dpbmRvdy5sb2NhdGlvbi5oYXNofWAsXHJcbiAgICAvLyApXHJcblxyXG4gICAgLy8gIGhlbHBBY3RpdmUgPSBDb29raWVzLmdldChcImhlbHBBY3RpdmVcIikgPT0gXCJ0cnVlXCI7XHJcbiAgICAvLyBjb25zb2xlLmxvZyhcImhlbHA6XCIsIENvb2tpZXMuZ2V0KFwiaGVscEFjdGl2ZVwiKSk7XHJcbiAgICBjYXJkU2VhcmNoQWN0aXZlID0gQ29va2llcy5nZXQoXCJjYXJkU2VhcmNoQWN0aXZlXCIpID09IFwidHJ1ZVwiO1xyXG4gICAgY29uc29sZS5sb2coXCJzZWFyY2g6XCIsIENvb2tpZXMuZ2V0KFwiY2FyZFNlYXJjaEFjdGl2ZVwiKSk7XHJcbiAgICBzdGF0aXN0aWNzQWN0aXZlID0gQ29va2llcy5nZXQoXCJzdGF0aXN0aWNzQWN0aXZlXCIpID09IFwidHJ1ZVwiO1xyXG4gICAgY29uc29sZS5sb2coXCJzdGF0aXN0aWNzOlwiLCBDb29raWVzLmdldChcInN0YXRpc3RpY3NBY3RpdmVcIikpO1xyXG5cclxuICAgIHN0YXRpc3RpY3NBY3RpdmU7XHJcbiAgICBpbnB1dC52YWx1ZSA9IHN0YXJ0O1xyXG4gICAgcmVsb2FkKCk7XHJcblxyXG4gICAgaXBjLm9uKFwibG9hZERlY2tcIiwgKHNlbmRlciwgZGF0YSkgPT4ge1xyXG4gICAgICBjb25zb2xlLmxvZyhcIkxPQURJTkcgREVDS1wiLCBkYXRhLm5hbWUpO1xyXG4gICAgICBpbnB1dC52YWx1ZSA9IGRhdGEuZGVjaztcclxuICAgICAgZGVja05hbWVJbnB1dC52YWx1ZSA9IChkYXRhLm5hbWUgfHwgXCJcIikucmVwbGFjZShcIi5nZGVja1wiLCBcIlwiKTtcclxuICAgICAgcmVsb2FkKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvKiBjb25zb2xlLmxvZyhcIlNUU0ZTREZcIiwgQ29va2llcy5nZXQoXCJkZWNrXCIpKSxcclxuICAgICAgKHByb21pc2UgPSBDYXJkTG9hZGVyLmNyZWF0ZURlY2soc3RhcnQsIChwLCBhKSA9PiBzcChwLCBhKSkpOyovXHJcbiAgfSk7XHJcblxyXG4gIGZ1bmN0aW9uIHNhdmVBbGxUb0Nvb2tpZXMoKSB7XHJcbiAgICBDb29raWVzLnNldChcImNhcmRTZWFyY2hBY3RpdmVcIiwgY2FyZFNlYXJjaEFjdGl2ZSk7XHJcbiAgICBDb29raWVzLnNldChcInN0YXRpc3RpY3NBY3RpdmVcIiwgc3RhdGlzdGljc0FjdGl2ZSk7XHJcbiAgICBDb29raWVzLnNldChcImRlY2tcIiwgaW5wdXQudmFsdWUpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gc2hhcmVEZWNrKCkge1xyXG4gICAgLyogICBpZiAoIWlucHV0IHx8ICFpbnB1dC52YWx1ZSkge1xyXG4gICAgICBhbGVydChcIlRoZSBkZWNrIGlzIGVtcHR5LCBub3RoaW5nIGNvcGllZFwiKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3QgY29tcHJlc3NlZCA9IExaVVRGOC5jb21wcmVzcyhpbnB1dC52YWx1ZSB8fCBcImVtcHR5IGRlY2sgc2hhcmVkXCIpO1xyXG4gICAgLy93aW5kb3cuaGlzdG9yeS5wdXNoU3RhdGUoXCJwYWdlMlwiLCBcIlRpdGxlXCIsIFwiP2Q9XCIgKyBjb21wcmVzc2VkKTtcclxuICAgIGNvbnNvbGUubG9nKGAke3dpbmRvdy5sb2NhdGlvbi5wYXRobmFtZX0/ZD0ke2NvbXByZXNzZWR9YCk7XHJcblxyXG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwidGV4dGFyZWFcIik7XHJcbiAgICBlbC52YWx1ZSA9IGAke3dpbmRvdy5sb2NhdGlvbi5ocmVmfT9kPSR7Y29tcHJlc3NlZH1gO1xyXG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChlbCk7XHJcbiAgICBlbC5zZWxlY3QoKTtcclxuICAgIGRvY3VtZW50LmV4ZWNDb21tYW5kKFwiY29weVwiKTtcclxuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoZWwpO1xyXG4gICAgYWxlcnQoXCJsaW5rIHRvIGRlY2sgY29waWVkXCIpOyovXHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBvblR5cGluZygpIHtcclxuICAgIENvb2tpZXMuc2V0KFwiZGVja1wiLCBpbnB1dC52YWx1ZSwgeyBleHBpcmVzOiA3IH0pO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gZ2V0SGVpZ2h0KG1hbmEsIGdyb3Vwcykge1xyXG4gICAgcmV0dXJuIDEwMCAqIChtYW5hIC8gTWF0aC5tYXgoLi4uZ3JvdXBzW1wibWFuYUN1cnZlXCJdKSk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBvcGVuSGVscCgpIHtcclxuICAgIGhlbHBBY3RpdmUgPSAhaGVscEFjdGl2ZTtcclxuICAgIC8vICBDb29raWVzLnNldChcImhlbHBBY3RpdmVcIiwgaGVscEFjdGl2ZSArIFwiXCIpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gdG9nZ2xlU2VhcmNoKCkge1xyXG4gICAgY2FyZFNlYXJjaEFjdGl2ZSA9ICFjYXJkU2VhcmNoQWN0aXZlO1xyXG4gICAgQ29va2llcy5zZXQoXCJjYXJkU2VhcmNoQWN0aXZlXCIsIGNhcmRTZWFyY2hBY3RpdmUgKyBcIlwiKTtcclxuICB9XHJcbiAgZnVuY3Rpb24gdG9nZ2xlU3RhdGlzdGljcygpIHtcclxuICAgIHN0YXRpc3RpY3NBY3RpdmUgPSAhc3RhdGlzdGljc0FjdGl2ZTtcclxuICAgIENvb2tpZXMuc2V0KFwic3RhdGlzdGljc0FjdGl2ZVwiLCBzdGF0aXN0aWNzQWN0aXZlICsgXCJcIik7XHJcbiAgfVxyXG48L3NjcmlwdD5cclxuXHJcbjxzdHlsZT5cclxuICAuY29udGVudCB7XHJcbiAgICAtLXJhaXNpbi1ibGFjazogaHNsYSgyMDAsIDglLCAxNSUsIDEpO1xyXG4gICAgLS1yb21hbi1zaWx2ZXI6IGhzbGEoMTk2LCAxNSUsIDYwJSwgMSk7XHJcbiAgICAtLWNvbG9ybGVzczogaHNsYSgwLCAwJSwgODklLCAxKTtcclxuICAgIC0tYmxhY2s6IGhzbGEoODMsIDglLCAzOCUsIDEpO1xyXG4gICAgLS13aGl0ZTogaHNsKDQ4LCA2NCUsIDg5JSk7XHJcbiAgICAtLXJlZDogaHNsYSgwLCA3MSUsIDg0JSwgMSk7XHJcbiAgICAtLWdyZWVuOiBoc2xhKDExNCwgNjAlLCA3NSUsIDEpO1xyXG4gICAgLS1ibHVlOiBoc2xhKDIzNSwgNTUlLCA4MSUsIDEpO1xyXG4gIH1cclxuXHJcbiAgLmNvbnRlbnQge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgICB3aWR0aDogMTAwJTtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICB9XHJcblxyXG4gIC5oZWxwLXN5bWJvbCB7XHJcbiAgICBib3JkZXItcmFkaXVzOiA1MCU7XHJcbiAgICBib3JkZXI6IDFweCBzb2xpZCBibGFjaztcclxuICAgIHdpZHRoOiAxNnB4O1xyXG4gICAgaGVpZ2h0OiAxNnB4O1xyXG4gICAgdGV4dC1hbGlnbjogY2VudGVyO1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgcmlnaHQ6IDEwcHg7XHJcbiAgICB0b3A6IDEwcHg7XHJcbiAgICBjdXJzb3I6IHBvaW50ZXI7XHJcbiAgfVxyXG5cclxuICAuaGVscC1zeW1ib2w6aG92ZXIge1xyXG4gICAgYm9yZGVyLWNvbG9yOiBibHVlO1xyXG4gICAgY29sb3I6IGJsdWU7XHJcbiAgfVxyXG5cclxuICAudG9nZ2xlLXNlYXJjaCB7XHJcbiAgICBiYWNrZ3JvdW5kOiBibHVlO1xyXG4gICAgd2lkdGg6IDMwcHg7XHJcbiAgICBoZWlnaHQ6IDMwcHg7XHJcbiAgICBjdXJzb3I6IHBvaW50ZXI7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICBsZWZ0OiAtMzBweDtcclxuICAgIHRvcDogNTAlO1xyXG4gICAgdXNlci1zZWxlY3Q6IG5vbmU7XHJcbiAgfVxyXG5cclxuICAuaGlkZSAudG9nZ2xlLXNlYXJjaCB7XHJcbiAgICBsZWZ0OiAtNTJweDtcclxuICB9XHJcblxyXG4gIC5zdGF0aXN0aWNzIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gIH1cclxuICAuaW5wdXQge1xyXG4gICAgd2lkdGg6IDEwMCU7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgICBib3gtc2l6aW5nOiBib3JkZXItYm94O1xyXG4gICAgcGFkZGluZzogMTBweDtcclxuICAgIHJlc2l6ZTogbm9uZTtcclxuICB9XHJcblxyXG4gIC5jb250cm9scyB7XHJcbiAgICBmbGV4LXNocmluazogMDtcclxuICAgIHdpZHRoOiAzMDBweDtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICAgIGJhY2tncm91bmQ6IGxpZ2h0Z3JheTtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gIH1cclxuXHJcbiAgLmhlbHAge1xyXG4gICAgcGFkZGluZzogMHB4IDEwcHggMTBweCAxMHB4O1xyXG4gICAgdXNlci1zZWxlY3Q6IG5vbmU7XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgfVxyXG5cclxuICAuZ3JvdXAtY29udGVudCB7XHJcbiAgICBmbGV4LWdyb3c6IDE7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC13cmFwOiB3cmFwO1xyXG4gICAgdHJhbnNpdGlvbjogaGVpZ2h0IDUwMG1zIGVhc2U7XHJcbiAgfVxyXG5cclxuICAuZ3JvdXAtY29udGVudC5oaWRkZW4ge1xyXG4gICAgb3ZlcmZsb3c6IGhpZGRlbjtcclxuICAgIGhlaWdodDogNDVweDtcclxuICB9XHJcblxyXG4gIC5jYXJkLXNlYXJjaCB7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgICBmbGV4LWdyb3c6IDE7XHJcbiAgICBiYWNrZ3JvdW5kOiB3aGl0ZTtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgcmlnaHQ6IDA7XHJcbiAgICB3aWR0aDogMzMlO1xyXG4gICAgei1pbmRleDogMTAwO1xyXG4gICAgYm94LXNoYWRvdzogMHB4IDBweCAxMHB4IGJsYWNrO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQtc2VhcmNoLmhpZGUge1xyXG4gICAgcmlnaHQ6IC0zMyU7XHJcbiAgfVxyXG5cclxuICAuc2VhcmNoLXBhcmFtcyB7XHJcbiAgICBmbGV4LXNocmluazogMDtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gIH1cclxuXHJcbiAgLnNlYXJjaC1yZXN1bHQge1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gICAgZmxleC1ncm93OiAxO1xyXG4gICAgYmFja2dyb3VuZDogd2hpdGU7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICAgIG92ZXJmbG93OiBhdXRvO1xyXG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xyXG4gICAgdXNlci1zZWxlY3Q6IG5vbmU7XHJcbiAgICBmbGV4LXdyYXA6IHdyYXA7XHJcbiAgfVxyXG5cclxuICAuZGlzcGxheSB7XHJcbiAgICBmbGV4LWdyb3c6IDE7XHJcbiAgICBiYWNrZ3JvdW5kOiBncmF5O1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XHJcbiAgICBmbGV4LXdyYXA6IG5vd3JhcDtcclxuICAgIG92ZXJmbG93OiBhdXRvO1xyXG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xyXG4gICAgdXNlci1zZWxlY3Q6IG5vbmU7XHJcbiAgfVxyXG5cclxuICAubG9hZGluZy13cmFwcGVyIHtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIGxlZnQ6IDUwJTtcclxuICAgIHRvcDogMDtcclxuICAgIGJvdHRvbTogMDtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBhbGlnbi1pdGVtczogY2VudGVyO1xyXG4gIH1cclxuXHJcbiAgLmVudHJ5IHtcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICAgIHBhZGRpbmc6IDEwcHg7XHJcbiAgICBmbGV4LXNocmluazogMDtcclxuICB9XHJcblxyXG4gIC5zaG9waW5nIHtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIHotaW5kZXg6IDEwO1xyXG4gICAgZm9udC1zaXplOiAzZW07XHJcbiAgICB0ZXh0LXNoYWRvdzogMHB4IDBweCA2cHggYmxhY2s7XHJcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7XHJcbiAgICBib3R0b206IDEwJTtcclxuICAgIHJpZ2h0OiAxMCU7XHJcbiAgICBkaXNwbGF5OiBub25lO1xyXG4gIH1cclxuXHJcbiAgLmVudHJ5OmhvdmVyIC5zaG9waW5nIHtcclxuICAgIGRpc3BsYXk6IGJsb2NrO1xyXG4gIH1cclxuXHJcbiAgLnNob3BpbmcgLmxpbmsge1xyXG4gICAgdGV4dC1kZWNvcmF0aW9uOiBub25lO1xyXG4gIH1cclxuXHJcbiAgLnNob3BpbmcgLmxpbms6aG92ZXIge1xyXG4gICAgY29sb3I6IHRyYW5zcGFyZW50O1xyXG4gICAgdGV4dC1zaGFkb3c6IDAgMCAwIGJsdWU7XHJcbiAgfVxyXG5cclxuICAuY2FyZCB7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICBib3JkZXI6IDZweCBzb2xpZCByZ2IoMjIsIDIyLCAyMik7XHJcbiAgICBib3JkZXItcmFkaXVzOiAxMHB4O1xyXG4gICAgb3V0bGluZTogMDtcclxuICAgIGJveC1zaGFkb3c6IDBweCAwcHggMTBweCBibGFjaztcclxuICB9XHJcblxyXG4gIC5jYXJkLmJhbm5lZCB7XHJcbiAgICBib3JkZXI6IDZweCBzb2xpZCByZWQ7XHJcbiAgfVxyXG5cclxuICAuY2FyZC5oaWdobGlnaHRlZCB7XHJcbiAgICBib3JkZXI6IDZweCBzb2xpZCB5ZWxsb3c7XHJcbiAgfVxyXG5cclxuICAuY2FyZDpob3ZlciB7XHJcbiAgICBib3JkZXI6IDZweCBzb2xpZCBibHVlO1xyXG4gICAgY3Vyc29yOiBwb2ludGVyO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQtY29udGV4dC1tZW51IHtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIHotaW5kZXg6IDEwMDtcclxuICAgIGJhY2tncm91bmQ6IHJnYmEoMjU1LCAyNTUsIDI1NSwgMC43KTtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICAgIHdpZHRoOiAxMDAlO1xyXG4gICAgLyogcGFkZGluZzogMTBweDsgKi9cclxuICAgIC8qIG1hcmdpbjogMTBweDsgKi9cclxuICAgIG1hcmdpbi1sZWZ0OiAtM3B4O1xyXG4gICAgbWFyZ2luLXRvcDogLTNweDtcclxuICAgIG92ZXJmbG93OiBhdXRvO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQtY29udGV4dC1lbnRyeSB7XHJcbiAgICBtYXJnaW46IDEwcHg7XHJcbiAgICBmb250LXdlaWdodDogYm9sZDtcclxuICAgIGJhY2tncm91bmQ6IHdoaXRlO1xyXG4gICAgcGFkZGluZzogNXB4O1xyXG4gICAgYm9yZGVyLXJhZGl1czogOXB4O1xyXG4gICAgYm94LXNoYWRvdzogMCAwIDZweCBibGFjaztcclxuICAgIGN1cnNvcjogcG9pbnRlcjtcclxuICB9XHJcblxyXG4gIC5jYXJkLWNvbnRleHQtZW50cnk6aG92ZXIge1xyXG4gICAgYmFja2dyb3VuZDogd2hlYXQ7XHJcbiAgfVxyXG5cclxuICAucHJpY2UsXHJcbiAgLmJhbm5lZC10ZXh0LFxyXG4gIC5jb3VudCB7XHJcbiAgICBmb250LXNpemU6IDM0cHg7XHJcbiAgICB0ZXh0LXNoYWRvdzogMHB4IDBweCA5cHggYmxhY2s7XHJcbiAgICBjb2xvcjogcmVkO1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgei1pbmRleDogMTAwO1xyXG4gICAgZm9udC13ZWlnaHQ6IGJvbGQ7XHJcbiAgICBsZWZ0OiAzNHB4O1xyXG4gIH1cclxuXHJcbiAgLmJhbm5lZC10ZXh0IHtcclxuICAgIGZvbnQtc2l6ZTogMTAwJTtcclxuICAgIHRleHQtc2hhZG93OiAwcHggMHB4IDlweCBibGFjaztcclxuICAgIGNvbG9yOiByZWQ7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICB6LWluZGV4OiAxMDA7XHJcbiAgICBmb250LXdlaWdodDogYm9sZDtcclxuICAgIGxlZnQ6IDE3JTtcclxuICB9XHJcbiAgLmNvdW50IHtcclxuICAgIHRvcDogMTY1cHg7XHJcbiAgfVxyXG5cclxuICAucHJpY2Uge1xyXG4gICAgYm90dG9tOiA3cHg7XHJcbiAgICBjb2xvcjogd2hlYXQ7XHJcbiAgICBmb250LXNpemU6IDEycHg7XHJcbiAgICBiYWNrZ3JvdW5kOiBibGFjaztcclxuICAgIGxlZnQ6IDQ1JTtcclxuICAgIGZvbnQtd2VpZ2h0OiBub3JtYWw7XHJcbiAgfVxyXG5cclxuICAuZ3JvdXAtaGVhZGVyIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBiYWNrZ3JvdW5kOiBkYXJrZ3JleTtcclxuICAgIC8qIHBhZGRpbmc6IDhweDsgKi9cclxuICAgIG1hcmdpbjogOHB4IDA7XHJcbiAgICBib3gtc2hhZG93OiAwcHggMHB4IDhweCBibGFjaztcclxuICAgIHdpZHRoOiAxMDAlO1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICB9XHJcblxyXG4gIC5ncm91cC1oZWFkZXIgaDIge1xyXG4gICAgcGFkZGluZzogMCAyNXB4O1xyXG4gICAgbWFyZ2luOiAwcHg7XHJcbiAgfVxyXG5cclxuICAuZ3JvdXAtc3RhdGlzdGljcyB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICB9XHJcblxyXG4gIC5tYW5hLXByb3Bvc2FsLFxyXG4gIC5tYW5hLWRldm90aW9uIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gIH1cclxuXHJcbiAgLmRlY2stdmFsdWUsXHJcbiAgLmdyb3VwLXZhbHVlIHtcclxuICAgIHBhZGRpbmc6IDVweDtcclxuICAgIGNvbG9yOiBibGFjaztcclxuICAgIGJvcmRlci1yYWRpdXM6IDUwJTtcclxuICAgIHdpZHRoOiAxNXB4O1xyXG4gICAgaGVpZ2h0OiAxNXB4O1xyXG4gICAgdGV4dC1hbGlnbjogY2VudGVyO1xyXG4gICAgbWFyZ2luOiA1cHg7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgdGV4dC1hbGlnbjogY2VudGVyO1xyXG4gICAgYWxpZ24taXRlbXM6IGNlbnRlcjtcclxuICAgIGZvbnQtc2l6ZTogMTFweDtcclxuICAgIGZvbnQtd2VpZ2h0OiBib2xkO1xyXG4gIH1cclxuICAuYmx1ZSB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS1ibHVlKTtcclxuICB9XHJcbiAgLmJsYWNrIHtcclxuICAgIGNvbG9yOiB3aGl0ZTtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWJsYWNrKTtcclxuICB9XHJcbiAgLnJlZCB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS1yZWQpO1xyXG4gIH1cclxuICAud2hpdGUge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0td2hpdGUpO1xyXG4gIH1cclxuICAuZ3JlZW4ge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0tZ3JlZW4pO1xyXG4gIH1cclxuICAuY29sb3JsZXNzIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWNvbG9ybGVzcyk7XHJcbiAgfVxyXG4gIC5nZW5lcmljIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IGdvbGRlbnJvZDtcclxuICB9XHJcbiAgLnN1bSB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiBnb2xkZW5yb2Q7XHJcbiAgfVxyXG5cclxuICAuY29sb3ItcGFyYW0ge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgfVxyXG5cclxuICAubWFuYS1jdXJ2ZSB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcclxuICB9XHJcblxyXG4gIC5hbGwtY3VydmVzIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWdyb3c6IDE7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gICAgaGVpZ2h0OiA4MHB4O1xyXG4gIH1cclxuXHJcbiAgLmFsbC1sYWJlbHMge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtc2hyaW5rOiAwO1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICB9XHJcblxyXG4gIC5jdXJ2ZS1lbGVtZW50IHtcclxuICAgIHdpZHRoOiAyMHB4O1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIGJvdHRvbTogMDtcclxuICAgIGJhY2tncm91bmQ6IGdyYXk7XHJcbiAgICAvKiB2ZXJ0aWNhbC1hbGlnbjogbWlkZGxlOyAqL1xyXG4gICAgYWxpZ24taXRlbXM6IGNlbnRlcjtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICB9XHJcblxyXG4gIC5jdXJ2ZS1sYWJlbCB7XHJcbiAgICB3aWR0aDogMjBweDtcclxuICB9XHJcbiAgLmN1cnZlLXdyYXBwZXIge1xyXG4gICAgd2lkdGg6IDIwcHg7XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgICBjdXJzb3I6IHBvaW50ZXI7XHJcbiAgfVxyXG5cclxuICAuY3VydmUtZWxlbWVudDpob3ZlciB7XHJcbiAgICBiYWNrZ3JvdW5kOiBsaWdodGNvcmFsO1xyXG4gIH1cclxuXHJcbiAgLmhpZ2hsaWdodGVkIC5jdXJ2ZS1lbGVtZW50IHtcclxuICAgIGJhY2tncm91bmQ6IGxpZ2h0Ymx1ZTtcclxuICB9XHJcblxyXG4gIC5jdXJ2ZS1sYWJlbC5oaWdobGlnaHRlZCB7XHJcbiAgICBiYWNrZ3JvdW5kOiBsaWdodGJsdWU7XHJcbiAgfVxyXG5cclxuICAuY3VydmUtbGFiZWw6aG92ZXIge1xyXG4gICAgYmFja2dyb3VuZDogbGlnaHRjb3JhbDtcclxuICB9XHJcblxyXG4gIGg0IHtcclxuICAgIG1hcmdpbi10b3A6IDVweDtcclxuICAgIG1hcmdpbi1ib3R0b206IDVweDtcclxuICB9XHJcblxyXG4gIC5sZHMtcmlwcGxlIHtcclxuICAgIGRpc3BsYXk6IGlubGluZS1ibG9jaztcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICAgIHdpZHRoOiA4MHB4O1xyXG4gICAgaGVpZ2h0OiA4MHB4O1xyXG4gIH1cclxuICAubGRzLXJpcHBsZSBkaXYge1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgYm9yZGVyOiA0cHggc29saWQgI2ZmZjtcclxuICAgIG9wYWNpdHk6IDE7XHJcbiAgICBib3JkZXItcmFkaXVzOiA1MCU7XHJcbiAgICBhbmltYXRpb246IGxkcy1yaXBwbGUgMXMgY3ViaWMtYmV6aWVyKDAsIDAuMiwgMC44LCAxKSBpbmZpbml0ZTtcclxuICB9XHJcblxyXG4gIC5jYXJkLXNlYXJjaCAubGRzLXJpcHBsZSBkaXYge1xyXG4gICAgYm9yZGVyOiA0cHggc29saWQgYmxhY2s7XHJcbiAgfVxyXG5cclxuICAubGRzLXJpcHBsZSBkaXY6bnRoLWNoaWxkKDIpIHtcclxuICAgIGFuaW1hdGlvbi1kZWxheTogLTAuNXM7XHJcbiAgfVxyXG4gIEBrZXlmcmFtZXMgbGRzLXJpcHBsZSB7XHJcbiAgICAwJSB7XHJcbiAgICAgIHRvcDogMzZweDtcclxuICAgICAgbGVmdDogMzZweDtcclxuICAgICAgd2lkdGg6IDA7XHJcbiAgICAgIGhlaWdodDogMDtcclxuICAgICAgb3BhY2l0eTogMTtcclxuICAgIH1cclxuICAgIDEwMCUge1xyXG4gICAgICB0b3A6IDBweDtcclxuICAgICAgbGVmdDogMHB4O1xyXG4gICAgICB3aWR0aDogNzJweDtcclxuICAgICAgaGVpZ2h0OiA3MnB4O1xyXG4gICAgICBvcGFjaXR5OiAwO1xyXG4gICAgfVxyXG4gIH1cclxuPC9zdHlsZT5cclxuXHJcbjxzdmVsdGU6d2luZG93XHJcbiAgb246bW91c2V1cD17b25NYWluTW91c2VEb3dufVxyXG4gIG9uOmNvbnRleHRtZW51fHByZXZlbnREZWZhdWx0PXsoKSA9PiBmYWxzZX1cclxuICBvbjprZXl1cD17bWFpbktleVVwfVxyXG4gIG9uOmtleWRvd249e21haW5LZXlEb3dufSAvPlxyXG48ZGl2IGNsYXNzPVwiY29udGVudFwiPlxyXG4gIDxkaXYgY2xhc3M9XCJjb250cm9sc1wiPlxyXG4gICAgPGRpdiBjbGFzcz1cImhlbHBcIj5cclxuICAgICAgPGRpdiBjbGFzcz1cImhlbHAtc3ltYm9sXCIgb246Y2xpY2s9e29wZW5IZWxwfT4/PC9kaXY+XHJcbiAgICAgIHsjaWYgaGVscEFjdGl2ZX1cclxuICAgICAgICA8aDQ+SG93IHRvIHVzZTo8L2g0PlxyXG4gICAgICAgIDxwPnBhc3RlIHlvdXIgZGVjayB0byB0aGUgZm9sbG93aW5nIGlucHV0LjwvcD5cclxuICAgICAgICA8dWw+XHJcbiAgICAgICAgICA8bGk+XHJcbiAgICAgICAgICAgIHdoZW4gYSBsaW5lIHN0YXJ0cyB3aXRoIFwiI1wiIGl0IHdpbGwgYmUgaW50ZXJwcmV0ZWQgYXMgaGVhZGxpbmVcclxuICAgICAgICAgIDwvbGk+XHJcbiAgICAgICAgICA8bGk+XHJcbiAgICAgICAgICAgIGEgY2FyZCBjYW4gYmUgZW50ZXJlZCB3aXRoIGEgbGVhZGluZyBjb3VudCwgb3IganVzdCB3aXRoIGl0cyBuYW1lXHJcbiAgICAgICAgICA8L2xpPlxyXG4gICAgICAgICAgPGxpPnVzZSB0aGUgXCJFU0NcIiBrZXkgdG8gcmVhbG9hZCB0aGUgcHJldmlldzwvbGk+XHJcbiAgICAgICAgICA8bGk+ZG91YmxlY2xpY2sgYSBjYXJkIHRvIHJlbW92ZSBpdDwvbGk+XHJcbiAgICAgICAgPC91bD5cclxuICAgICAgICA8cD5OT1RFOiB3ZSB1c2UgY29va2llcyB0byBzdG9yZSB5b3VyIGRlY2sgYWZ0ZXIgcmVsb2FkLjwvcD5cclxuICAgICAgICA8cD5OT1RFOiBUaGlzIGlzIG5vdCBhbiBvZmZpY2lhbCBNYWdpYyBwcm9kdWt0LjwvcD5cclxuICAgICAgey9pZn1cclxuXHJcbiAgICAgIHsjYXdhaXQgcHJvbWlzZX1cclxuXHJcbiAgICAgICAgPGRpdj5sb2FkaW5nOiB7cHJvZ3Jlc3N9L3thbGx9PC9kaXY+XHJcbiAgICAgIHs6dGhlbiBncm91cHN9XHJcblxyXG4gICAgICAgIHsjaWYgIWhlbHBBY3RpdmV9XHJcbiAgICAgICAgICA8aDQ+R2VuZXJhbDwvaDQ+XHJcblxyXG4gICAgICAgICAgPGRpdj5Ub3RhbCBjYXJkczoge2dyb3Vwc1snY2FyZENvdW50J119PC9kaXY+XHJcbiAgICAgICAgICA8ZGl2PlxyXG4gICAgICAgICAgICBMYW5kczoge2dyb3Vwc1snbGFuZENvdW50J119IE5vbmxhbmRzOiB7Z3JvdXBzWydjYXJkQ291bnQnXSAtIGdyb3Vwc1snbGFuZENvdW50J119XHJcbiAgICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgICA8ZGl2PkNyZWF0dXJlczoge2dyb3Vwc1snY3JlYXR1cmVDb3VudCddfTwvZGl2PlxyXG4gICAgICAgICAgPGRpdj5JbnN0YW50czoge2dyb3Vwc1snaW5zdGFudENvdW50J119PC9kaXY+XHJcbiAgICAgICAgICA8ZGl2PlNvcmNlcmllczoge2dyb3Vwc1snc29yY2VyeUNvdW50J119PC9kaXY+XHJcbiAgICAgICAgICA8ZGl2PkVuY2hhbnRtZW50czoge2dyb3Vwc1snZW5jaGFudG1lbnRDb3VudCddfTwvZGl2PlxyXG4gICAgICAgICAgPGRpdj5BcnRpZmFjdHM6IHtncm91cHNbJ2FydGlmYWN0Q291bnQnXX08L2Rpdj5cclxuXHJcbiAgICAgICAgICA8ZGl2PkNvc3Q6IHtncm91cHMuY29zdC50b0ZpeGVkKDIpICsgJyQnfTwvZGl2PlxyXG5cclxuICAgICAgICAgIHsjaWYgc3RhdGlzdGljc0FjdGl2ZX1cclxuICAgICAgICAgICAgPGRpdiBjbGFzcz1cInN0YXRpc3RpY3NcIj5cclxuICAgICAgICAgICAgICA8aDQ+RGV2b3Rpb248L2g0PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJtYW5hLWRldm90aW9uXCI+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBibHVlXCI+e2dyb3Vwc1snbWFuYSddLmJsdWV9PC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBibGFja1wiPntncm91cHNbJ21hbmEnXS5ibGFja308L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIHJlZFwiPntncm91cHNbJ21hbmEnXS5yZWR9PC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSB3aGl0ZVwiPntncm91cHNbJ21hbmEnXS53aGl0ZX08L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGdyZWVuXCI+e2dyb3Vwc1snbWFuYSddLmdyZWVufTwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgY29sb3JsZXNzXCI+XHJcbiAgICAgICAgICAgICAgICAgIHtncm91cHNbJ21hbmEnXS5jb2xvcmxlc3N9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgICAgICAgPGg0PkdlbmVyaWMgTWFuYTwvaDQ+XHJcbiAgICAgICAgICAgICAgPGRpdj5SZW1haW5pbmcgZ2VuZXJpYyBtYW5hIGNvc3RzOntncm91cHNbJ21hbmEnXS5nZW5lcmljfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXY+Q01DLU1hbmEtU3VtOntncm91cHNbJ21hbmEnXS5zdW19PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdj5cclxuICAgICAgICAgICAgICAgIEF2ZXJhZ2UgQ01DIHBlciBOb25sYW5kOiB7Z3JvdXBzWydhdmVyYWdlTWFuYSddLnRvRml4ZWQoMil9XHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgPGg0PlN1Z2dlc3RlZCBNYW5hIERpc3RyaWJ1dGlvbjwvaDQ+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cIm1hbmEtcHJvcG9zYWxcIj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGJsdWVcIj5cclxuICAgICAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLmJsdWUgKiBncm91cHNbJ2xhbmRDb3VudCddKS50b0ZpeGVkKDEpfVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBibGFja1wiPlxyXG4gICAgICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10uYmxhY2sgKiBncm91cHNbJ2xhbmRDb3VudCddKS50b0ZpeGVkKDEpfVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSByZWRcIj5cclxuICAgICAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLnJlZCAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIHdoaXRlXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS53aGl0ZSAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGdyZWVuXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS5ncmVlbiAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGNvbG9ybGVzc1wiPlxyXG4gICAgICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10uY29sb3JsZXNzICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgIDxoND5NYW5hIEN1cnZlPC9oND5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwibWFuYS1jdXJ2ZVwiPlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImFsbC1jdXJ2ZXNcIj5cclxuICAgICAgICAgICAgICAgICAgeyNlYWNoIGdyb3Vwc1snbWFuYUN1cnZlJ10gYXMgbWFuYSwgaX1cclxuICAgICAgICAgICAgICAgICAgICB7I2lmIG1hbmEgPiAwfVxyXG4gICAgICAgICAgICAgICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImN1cnZlLXdyYXBwZXJcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzczpoaWdobGlnaHRlZD17ZGV2b3Rpb25IaWdobGlnaHQgPT0gaX1cclxuICAgICAgICAgICAgICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodERldm90aW9uKGkpfT5cclxuICAgICAgICAgICAgICAgICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiY3VydmUtZWxlbWVudFwiXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3R5bGU9eydoZWlnaHQ6JyArIGdldEhlaWdodChtYW5hLCBncm91cHMpICsgJyU7J30+XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAge21hbmEgfHwgJyd9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgICAgICAgey9lYWNofVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcblxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImFsbC1sYWJlbHNcIj5cclxuICAgICAgICAgICAgICAgICAgeyNlYWNoIGdyb3Vwc1snbWFuYUN1cnZlJ10gYXMgbWFuYSwgaX1cclxuICAgICAgICAgICAgICAgICAgICB7I2lmIG1hbmEgPiAwfVxyXG4gICAgICAgICAgICAgICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImN1cnZlLWxhYmVsXCJcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M6aGlnaGxpZ2h0ZWQ9e2Rldm90aW9uSGlnaGxpZ2h0ID09IGl9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG9uOmNsaWNrPXsoKSA9PiBoaWdobGlnaHREZXZvdGlvbihpKX0+XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHtpfVxyXG4gICAgICAgICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgICAgICAgey9lYWNofVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgey9pZn1cclxuICAgICAgICB7L2lmfVxyXG4gICAgICAgIDxkaXY+XHJcbiAgICAgICAgICBzZWFyY2g6XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgYmluZDp0aGlzPXtkZWNrU2VhcmNoSW5wdXR9XHJcbiAgICAgICAgICAgIHRpdGxlPVwiZS5nLjogc2FjcmlmaWNlIGEgKGFydGlmYWN0fGNyZWF0dXJlKVwiXHJcbiAgICAgICAgICAgIG9uOmtleXVwPXsoKSA9PiBjaGFuZ2VEZWNrU2VhcmNoKGdyb3Vwcyl9IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgIHs6Y2F0Y2ggZXJyb3J9XHJcbiAgICAgICAge2Vycm9yfVxyXG4gICAgICB7L2F3YWl0fVxyXG4gICAgICBGb3JtYXQ6XHJcbiAgICAgIDxzZWxlY3RcclxuICAgICAgICBiaW5kOnRoaXM9e2Zvcm1hdH1cclxuICAgICAgICBvbjpibHVyPXtyZWxvYWR9XHJcbiAgICAgICAgb246Y2hhbmdlPXtyZWxvYWR9XHJcbiAgICAgICAgdGl0bGU9XCJzZWxlY3QgdGhlIGxlZ2FsaXR5IGNoZWNrZXJcIj5cclxuICAgICAgICA8b3B0aW9uIHNlbGVjdGVkPmNvbW1hbmRlcjwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+YnJhd2w8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPmR1ZWw8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPmZ1dHVyZTwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+aGlzdG9yaWM8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPmxlZ2FjeTwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+bW9kZXJuPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5vbGRzY2hvb2w8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnBhdXBlcjwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+cGVubnk8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnBpb25lZXI8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnN0YW5kYXJkPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj52aW50YWdlPC9vcHRpb24+XHJcbiAgICAgIDwvc2VsZWN0PlxyXG4gICAgICA8ZGl2IGNsYXNzPVwic2xpZGVjb250YWluZXJcIj5cclxuICAgICAgICBTY2FsZTpcclxuICAgICAgICA8aW5wdXRcclxuICAgICAgICAgIHR5cGU9XCJyYW5nZVwiXHJcbiAgICAgICAgICBtaW49XCIyNVwiXHJcbiAgICAgICAgICBtYXg9XCIxMDBcIlxyXG4gICAgICAgICAgYmluZDp2YWx1ZT17c2NhbGluZ31cclxuICAgICAgICAgIHRpdGxlPVwic2NhbGVzIHRoZSBjYXJkIHNpemUgaW4gdGhlIHJpZ2h0IHZpZXdcIiAvPlxyXG4gICAgICA8L2Rpdj5cclxuICAgICAgPGRpdiBjbGFzcz1cInNhdmUtY29udGFpbmVyXCI+XHJcbiAgICAgICAgU2F2ZSA6XHJcbiAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICBiaW5kOnRoaXM9e2RlY2tOYW1lSW5wdXR9XHJcbiAgICAgICAgICBvbjprZXl1cD17b25EZWNrTmFtZVR5cGV9XHJcbiAgICAgICAgICB2YWx1ZT17Q29va2llcy5nZXQoJ2RlY2tOYW1lJykgfHwgJ3Vua25vd25fZGVjayd9XHJcbiAgICAgICAgICB0aXRsZT1cIlRoZSBuYW1lIG9mIHRoZSBkZWNrIGZvciBzYXZpbmdcIiAvPlxyXG4gICAgICAgIDxidXR0b25cclxuICAgICAgICAgIG9uOmNsaWNrPXtzYXZlRGVja31cclxuICAgICAgICAgIHRpdGxlPVwidGhpcyB3aWxsIGRvd25sb2FkIHlvdSBhIGZpbGUsIGNhbGxlZCBsaWtlIHlvdSBwcm92aWRlIGluIHRoZVxyXG4gICAgICAgICAgZGVja1wiPlxyXG4gICAgICAgICAgc2F2ZVxyXG4gICAgICAgIDwvYnV0dG9uPlxyXG4gICAgICA8L2Rpdj5cclxuICAgICAgPGJ1dHRvblxyXG4gICAgICAgIG9uOmNsaWNrPXt0b2dnbGVTdGF0aXN0aWNzfVxyXG4gICAgICAgIHRpdGxlPVwidG9nZ2xlcyB0aGUgdmlzaWJpbGl0eSBvZiB0aGUgc3RhdGlzdGlja3NcIj5cclxuICAgICAgICB7c3RhdGlzdGljc0FjdGl2ZSA/ICdoaWRlIHN0YXRpc3RpY3MnIDogJ3Nob3cgc3RhdGlzdGljcyd9XHJcbiAgICAgIDwvYnV0dG9uPlxyXG4gICAgICA8YnV0dG9uXHJcbiAgICAgICAgb246Y2xpY2s9e3NvcnREZWNrU3RyaW5nfVxyXG4gICAgICAgIHRpdGxlPVwidGhpcyBzb3J0cyB0aGUgZGVjayB0byBsYW5kcyBzcGVsbHMgYW5kIGNyZWF0dXJlcyAtTk9URTogeW91clxyXG4gICAgICAgIGdyb3VwcyB3aWxsIGJlIHJlcGxhY2VkXCI+XHJcbiAgICAgICAgc29ydFxyXG4gICAgICA8L2J1dHRvbj5cclxuICAgICAgPGJ1dHRvblxyXG4gICAgICAgIG9uOmNsaWNrPXtjb3B5RGVja31cclxuICAgICAgICB0aXRsZT1cInRoaXMgY29waWVzIHRoZSBkZWNrIHdpdGhvdXQgZ3JvdXBzIGFuZCBzdHVmZiB0byB5b3VyIGNsaXBib2FyZFwiPlxyXG4gICAgICAgIGNsZWFuIGNvcHlcclxuICAgICAgPC9idXR0b24+XHJcbiAgICAgIDxidXR0b25cclxuICAgICAgICBvbjpjbGljaz17c2hhcmVEZWNrfVxyXG4gICAgICAgIHRpdGxlPVwiY29waWVzIGEgc3RyaW5nIHRvIHlvdXIgY2xpcGJvYXJkLCB0aGF0IHNoYXJlcyB0aGlzIGRlY2sgd2l0aFxyXG4gICAgICAgIG90aGVyc1wiPlxyXG4gICAgICAgIHNoYXJlXHJcbiAgICAgIDwvYnV0dG9uPlxyXG5cclxuICAgICAgPGJ1dHRvbiBvbjpjbGljaz17cmVsb2FkfT5yZWZyZXNoPC9idXR0b24+XHJcbiAgICA8L2Rpdj5cclxuICAgIDx0ZXh0YXJlYSBiaW5kOnRoaXM9e2lucHV0fSBjbGFzcz1cImlucHV0XCIgb246a2V5dXA9e29uVHlwaW5nfSAvPlxyXG4gIDwvZGl2PlxyXG5cclxuICA8ZGl2IGNsYXNzPVwiZGlzcGxheVwiIGJpbmQ6dGhpcz17ZGlzcGxheX0+XHJcbiAgICB7I2F3YWl0IHByb21pc2V9XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJsb2FkaW5nLXdyYXBwZXJcIj5cclxuICAgICAgICA8ZGl2PmxvYWRpbmc6IHtwcm9ncmVzc30ve2FsbH08L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwibGRzLXJpcHBsZVwiPlxyXG4gICAgICAgICAgPGRpdiAvPlxyXG4gICAgICAgICAgPGRpdiAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICA8L2Rpdj5cclxuICAgIHs6dGhlbiBncm91cHN9XHJcblxyXG4gICAgICB7I2VhY2ggZGVja1NlYWNoIHx8IGdyb3VwcyB8fCBbXSBhcyBncm91cH1cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXBcIj5cclxuXHJcbiAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtaGVhZGVyXCI+XHJcbiAgICAgICAgICAgIDxoMj57Z3JvdXAubmFtZSArICcgLy8gJyArIGdyb3VwLmNvdW50IHx8ICdubyBuYW1lJ308L2gyPlxyXG4gICAgICAgICAgICA8YnV0dG9uIG9uOmNsaWNrPXsoKSA9PiB0b2dnbGVHcm91cFZpc2liaWxpdHkoZ3JvdXApfT5cclxuICAgICAgICAgICAgICB0b2dnbGVcclxuICAgICAgICAgICAgPC9idXR0b24+XHJcbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC1zdGF0aXN0aWNzXCI+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGJsdWVcIj57Z3JvdXAubWFuYS5ibHVlfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSBibGFja1wiPntncm91cC5tYW5hLmJsYWNrfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSByZWRcIj57Z3JvdXAubWFuYS5yZWR9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIHdoaXRlXCI+e2dyb3VwLm1hbmEud2hpdGV9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGdyZWVuXCI+e2dyb3VwLm1hbmEuZ3JlZW59PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGNvbG9ybGVzc1wiPntncm91cC5tYW5hLmNvbG9ybGVzc308L2Rpdj5cclxuICAgICAgICAgICAgICA8IS0tIGdlbmVyaWM6XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGdlbmVyaWNcIj57Z3JvdXAubWFuYS5nZW5lcmljfTwvZGl2PiAtLT5cclxuICAgICAgICAgICAgICBzdW06XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIHN1bVwiPntncm91cC5tYW5hLnN1bX08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgZ3JvdXAtY29zdFwiPlxyXG4gICAgICAgICAgICAgICAge2dyb3VwLmNvc3QudG9GaXhlZCgyKSArICckJ31cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgPC9kaXY+XHJcblxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgIGNsYXNzPVwiZ3JvdXAtY29udGVudFwiXHJcbiAgICAgICAgICAgIGNsYXNzOmhpZGRlbj17aGlkZGVuR3JvdXBzLmhhcyhncm91cC5uYW1lKX0+XHJcblxyXG4gICAgICAgICAgICB7I2VhY2ggZ3JvdXAuY2FyZHMgYXMgY2FyZH1cclxuICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICBjbGFzcz1cImVudHJ5XCJcclxuICAgICAgICAgICAgICAgIHN0eWxlPXsnd2lkdGg6JyArIHdpZHRoICsgJ3B4OyBoZWlnaHQ6JyArIChjYXJkLmNvdW50IDw9IDQgPyBoZWlnaHQgKyAoKGNhcmQuY291bnQgfHwgMSkgLSAxKSAqIDQwIDogaGVpZ2h0ICsgMyAqIDQwKSArICdweDsnfT5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJzaG9waW5nXCI+XHJcbiAgICAgICAgICAgICAgICAgIDxhXHJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJsaW5rXCJcclxuICAgICAgICAgICAgICAgICAgICBocmVmPXtjYXJkLmRhdGEucHVyY2hhc2VfdXJpcy5jYXJkbWFya2V0fVxyXG4gICAgICAgICAgICAgICAgICAgIHRhcmdldD1cIl9ibGFua1wiPlxyXG4gICAgICAgICAgICAgICAgICAgICYjMTI4NzIyO1xyXG4gICAgICAgICAgICAgICAgICA8L2E+XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIHsjZWFjaCB7IGxlbmd0aDogY2FyZC5jb3VudCA+IDQgPyA0IDogY2FyZC5jb3VudCB9IGFzIF8sIGl9XHJcbiAgICAgICAgICAgICAgICAgIDxpbWdcclxuICAgICAgICAgICAgICAgICAgICBjbGFzczpiYW5uZWQ9e2NhcmQuZGF0YS5sZWdhbGl0aWVzW2Zvcm1hdC52YWx1ZV0gIT09ICdsZWdhbCd9XHJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M6aGlnaGxpZ2h0ZWQ9e2Rldm90aW9uSGlnaGxpZ2h0ID09IGNhcmQuZGF0YS5jbWN9XHJcbiAgICAgICAgICAgICAgICAgICAgb246bW91c2V1cHxzdG9wUHJvcGFnYXRpb249e2V2dCA9PiBjYXJkQ29udGV4dE1lbnUoZXZ0LCBjYXJkLCBncm91cHMpfVxyXG4gICAgICAgICAgICAgICAgICAgIG9uOmRibGNsaWNrPXsoKSA9PiByZW1vdmUoY2FyZCl9XHJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJjYXJkXCJcclxuICAgICAgICAgICAgICAgICAgICBzdHlsZT17J21hcmdpbi10b3A6ICcgKyBpICogNDAgKyAncHgnfVxyXG4gICAgICAgICAgICAgICAgICAgIHNyYz17Y2FyZC51cmx9XHJcbiAgICAgICAgICAgICAgICAgICAgYWx0PXtjYXJkLm5hbWV9XHJcbiAgICAgICAgICAgICAgICAgICAge3dpZHRofVxyXG4gICAgICAgICAgICAgICAgICAgIHtoZWlnaHR9IC8+XHJcbiAgICAgICAgICAgICAgICB7L2VhY2h9XHJcblxyXG4gICAgICAgICAgICAgICAgeyNpZiBjYXJkLmRhdGEubGVnYWxpdGllc1tmb3JtYXQudmFsdWVdICE9PSAnbGVnYWwnfVxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiYmFubmVkLXRleHRcIj5CQU5ORUQ8L2Rpdj5cclxuICAgICAgICAgICAgICAgIHsvaWZ9XHJcbiAgICAgICAgICAgICAgICB7I2lmIGNhcmQuY291bnQgPiA0fVxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiY291bnRcIj57Y2FyZC5jb3VudH14PC9kaXY+XHJcbiAgICAgICAgICAgICAgICB7L2lmfVxyXG5cclxuICAgICAgICAgICAgICAgIHsjaWYgc2NhbGluZyA+IDkwfVxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwicHJpY2VcIj57Y2FyZC5kYXRhLnByaWNlcy51c2QgKyAnJCcgfHwgJz8/Pyd9PC9kaXY+XHJcbiAgICAgICAgICAgICAgICB7L2lmfVxyXG5cclxuICAgICAgICAgICAgICAgIHsjaWYgY3VycmVudENhcmRDb250ZXh0ID09PSBjYXJkfVxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiY2FyZC1jb250ZXh0LW1lbnVcIj5cclxuXHJcbiAgICAgICAgICAgICAgICAgICAgeyNlYWNoIGdyb3VwcyBhcyBzdWJHcm91cH1cclxuICAgICAgICAgICAgICAgICAgICAgIHsjaWYgZ3JvdXAubmFtZSAhPSBzdWJHcm91cC5uYW1lfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJjYXJkLWNvbnRleHQtZW50cnlcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgIG9uOm1vdXNlZG93bj17ZXZ0ID0+IGNhcmRDb250ZXh0Q2xpY2soZXZ0LCBjYXJkLCBzdWJHcm91cCl9PlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHtzdWJHcm91cC5uYW1lfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgICAgICAgIHsvaWZ9XHJcbiAgICAgICAgICAgICAgICAgICAgey9lYWNofVxyXG4gICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIHsvaWZ9XHJcblxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICB7L2VhY2h9XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgey9lYWNofVxyXG5cclxuICAgIHs6Y2F0Y2ggZXJyb3J9XHJcblxyXG4gICAgICA8ZGl2IGNsYXNzPVwiZXJyb3JcIj5cclxuICAgICAgICBFUlJPUiwgY2hlY2sgeW91ciBkZWNrbGlzdCBmb3IgY29ycmVjdCBmb3JtYXQgb3IgaW50ZXJuZXQgY29ubmVjdGlvblxyXG4gICAgICAgIGJydWRpXHJcbiAgICAgIDwvZGl2PlxyXG4gICAgey9hd2FpdH1cclxuICA8L2Rpdj5cclxuXHJcbiAgPGRpdiBjbGFzcz1cImNhcmQtc2VhcmNoXCIgY2xhc3M6aGlkZT17IWNhcmRTZWFyY2hBY3RpdmV9PlxyXG4gICAgPGRpdiBjbGFzcz1cInRvZ2dsZS1zZWFyY2hcIiBvbjpjbGljaz17dG9nZ2xlU2VhcmNofT54PC9kaXY+XHJcbiAgICA8ZGl2IGNsYXNzPVwic2VhcmNoLXBhcmFtc1wiPlxyXG4gICAgICA8ZGl2IGNsYXNzPVwic2VhcmNoLXBhcmFtXCI+XHJcbiAgICAgICAgTmFtZTpcclxuICAgICAgICA8aW5wdXQgYmluZDp0aGlzPXtzcE5hbWV9IC8+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgICA8ZGl2IGNsYXNzPVwic2VhcmNoLXBhcmFtXCI+XHJcbiAgICAgICAgVGV4dDpcclxuICAgICAgICA8aW5wdXQgYmluZDp0aGlzPXtzcFRleHR9IC8+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgICA8ZGl2IGNsYXNzPVwic2VhcmNoLXBhcmFtXCI+XHJcbiAgICAgICAgVHlwZTpcclxuICAgICAgICA8aW5wdXQgYmluZDp0aGlzPXtzcFR5cGV9IC8+XHJcbiAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1wYXJhbSBjb2xvci1wYXJhbVwiPlxyXG4gICAgICAgIENvbW1hbmRlci1Db2xvcnM6XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImJsdWVcIj5cclxuICAgICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgICB0eXBlPVwiY2hlY2tib3hcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17Y2xlYXJDb2xvcmxlc3N9XHJcbiAgICAgICAgICAgIGNsYXNzPVwiYmx1ZVwiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhCbHVlfSAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJibGFja1wiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJibGFja1wiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhCbGFja30gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwicmVkXCI+XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgdHlwZT1cImNoZWNrYm94XCJcclxuICAgICAgICAgICAgb246Y2xpY2s9e2NsZWFyQ29sb3JsZXNzfVxyXG4gICAgICAgICAgICBjbGFzcz1cInJlZFwiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhSZWR9IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cIndoaXRlXCI+XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgdHlwZT1cImNoZWNrYm94XCJcclxuICAgICAgICAgICAgb246Y2xpY2s9e2NsZWFyQ29sb3JsZXNzfVxyXG4gICAgICAgICAgICBjbGFzcz1cIndoaXRlXCJcclxuICAgICAgICAgICAgYmluZDp0aGlzPXtzcEVESFdoaXRlfSAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJncmVlblwiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJncmVlblwiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhHcmVlbn0gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiY29sb3JsZXNzXCI+XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgdHlwZT1cImNoZWNrYm94XCJcclxuICAgICAgICAgICAgb246Y2xpY2s9e2NsZWFyRm9yQ29sb3JsZXNzfVxyXG4gICAgICAgICAgICBjbGFzcz1cImNvbG9ybGVzc1wiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhDb2xvcmxlc3N9IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgICA8YnV0dG9uIG9uOmNsaWNrPXtzZWFyY2hDYXJkc30+c2VhcmNoPC9idXR0b24+XHJcbiAgICA8L2Rpdj5cclxuXHJcbiAgICB7I2F3YWl0IGNhcmRTZWFyY2hQcm9taXNlfVxyXG4gICAgICA8ZGl2IGNsYXNzPVwibG9hZGluZy13cmFwcGVyXCI+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImxkcy1yaXBwbGVcIj5cclxuICAgICAgICAgIDxkaXYgLz5cclxuICAgICAgICAgIDxkaXYgLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgPC9kaXY+XHJcbiAgICB7OnRoZW4gcmVzdWx0fVxyXG5cclxuICAgICAgeyNpZiByZXN1bHQuY29kZSAhPT0gJ25vdF9mb3VuZCcgJiYgcmVzdWx0LmRhdGF9XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1yZXN1bHRcIj5cclxuICAgICAgICAgIHsjZWFjaCByZXN1bHQuZGF0YSBhcyBjYXJkfVxyXG4gICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgY2xhc3M9XCJlbnRyeVwiXHJcbiAgICAgICAgICAgICAgc3R5bGU9eyd3aWR0aDonICsgd2lkdGggKyAncHg7IGhlaWdodDonICsgaGVpZ2h0ICsgJ3B4Oyd9PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJzaG9waW5nXCI+XHJcbiAgICAgICAgICAgICAgICA8YSBjbGFzcz1cImxpbmtcIiBocmVmPXtjYXJkLmNhcmRtYXJrZXR9IHRhcmdldD1cIl9ibGFua1wiPlxyXG4gICAgICAgICAgICAgICAgICAmIzEyODcyMjtcclxuICAgICAgICAgICAgICAgIDwvYT5cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICA8aW1nXHJcbiAgICAgICAgICAgICAgICBvbjpkYmxjbGljaz17KCkgPT4gYXBwZW5kQ2FyZChjYXJkLm5hbWUpfVxyXG4gICAgICAgICAgICAgICAgY2xhc3M6YmFubmVkPXtjYXJkLmxlZ2FsaXRpZXNbZm9ybWF0LnZhbHVlXSAhPT0gJ2xlZ2FsJ31cclxuICAgICAgICAgICAgICAgIGNsYXNzPVwiY2FyZFwiXHJcbiAgICAgICAgICAgICAgICBzcmM9e2NhcmQudXJsfVxyXG4gICAgICAgICAgICAgICAgYWx0PXtjYXJkLm5hbWV9XHJcbiAgICAgICAgICAgICAgICB7d2lkdGh9XHJcbiAgICAgICAgICAgICAgICB7aGVpZ2h0fSAvPlxyXG5cclxuICAgICAgICAgICAgICB7I2lmIGNhcmQubGVnYWxpdGllc1tmb3JtYXQudmFsdWVdICE9PSAnbGVnYWwnfVxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImJhbm5lZC10ZXh0XCI+QkFOTkVEPC9kaXY+XHJcbiAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgICB7I2lmIHNjYWxpbmcgPiA5MH1cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJwcmljZVwiPntjYXJkLnByaWNlcy51c2QgKyAnJCcgfHwgJz8/Pyd9PC9kaXY+XHJcbiAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICB7OmVsc2V9XHJcbiAgICAgICAgICAgIDxkaXY+Tm8gY2FyZHMgZm91bmQ8L2Rpdj5cclxuICAgICAgICAgIHsvZWFjaH1cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8YnV0dG9uXHJcbiAgICAgICAgICBkaXNhYmxlZD17IXJlc3VsdC5oYXNfbW9yZX1cclxuICAgICAgICAgIG9uOmNsaWNrPXsoKSA9PiBzZWFyY2hDYXJkcyhyZXN1bHQubmV4dF9wYWdlKX0+XHJcbiAgICAgICAgICBuZXh0XHJcbiAgICAgICAgPC9idXR0b24+XHJcbiAgICAgIHs6ZWxzZX1cclxuICAgICAgICA8ZGl2Pk5vIGNhcmRzIGZvdW5kPC9kaXY+XHJcbiAgICAgIHsvaWZ9XHJcbiAgICB7OmNhdGNoIGVycm9yfVxyXG4gICAgICA8ZGl2IGNsYXNzPVwiZXJyb3JcIj5cclxuICAgICAgICBFUlJPUiwgY2hlY2sgeW91ciBkZWNrbGlzdCBmb3IgY29ycmVjdCBmb3JtYXQgb3IgaW50ZXJuZXQgY29ubmVjdGlvblxyXG4gICAgICAgIGJydWRpXHJcbiAgICAgIDwvZGl2PlxyXG4gICAgey9hd2FpdH1cclxuXHJcbiAgPC9kaXY+XHJcbjwvZGl2PlxyXG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBMmJFLFFBQVEsYUFBQyxDQUFDLEFBQ1IsY0FBYyxDQUFFLHFCQUFxQixDQUNyQyxjQUFjLENBQUUsc0JBQXNCLENBQ3RDLFdBQVcsQ0FBRSxtQkFBbUIsQ0FDaEMsT0FBTyxDQUFFLG9CQUFvQixDQUM3QixPQUFPLENBQUUsaUJBQWlCLENBQzFCLEtBQUssQ0FBRSxvQkFBb0IsQ0FDM0IsT0FBTyxDQUFFLHNCQUFzQixDQUMvQixNQUFNLENBQUUsc0JBQXNCLEFBQ2hDLENBQUMsQUFFRCxRQUFRLGFBQUMsQ0FBQyxBQUNSLE9BQU8sQ0FBRSxJQUFJLENBQ2IsY0FBYyxDQUFFLEdBQUcsQ0FDbkIsS0FBSyxDQUFFLElBQUksQ0FDWCxNQUFNLENBQUUsSUFBSSxBQUNkLENBQUMsQUFFRCxZQUFZLGFBQUMsQ0FB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 */";
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

	// (879:6) {#if helpActive}
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
				h4.className = "svelte-xaax2";
				add_location(h4, file, 879, 8, 18886);
				add_location(p0, file, 880, 8, 18916);
				add_location(li0, file, 882, 10, 18988);
				add_location(li1, file, 885, 10, 19097);
				add_location(li2, file, 888, 10, 19209);
				add_location(li3, file, 889, 10, 19270);
				add_location(ul, file, 881, 8, 18972);
				add_location(p1, file, 891, 8, 19335);
				add_location(p2, file, 892, 8, 19405);
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

	// (1000:6) {:catch error}
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

	// (899:6) {:then groups}
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
				add_location(input_1, file, 994, 10, 23557);
				add_location(div, file, 992, 8, 23521);
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

	// (901:8) {#if !helpActive}
	function create_if_block_8(ctx) {
		var h4, t1, div0, t2, t3_value = ctx.groups['cardCount'], t3, t4, div1, t5, t6_value = ctx.groups['landCount'], t6, t7, t8_value = ctx.groups['cardCount'] - ctx.groups['landCount'], t8, t9, div2, t10, t11_value = ctx.groups['creatureCount'], t11, t12, div3, t13, t14_value = ctx.groups['instantCount'], t14, t15, div4, t16, t17_value = ctx.groups['sorceryCount'], t17, t18, div5, t19, t20_value = ctx.groups['enchantmentCount'], t20, t21, div6, t22, t23_value = ctx.groups['artifactCount'], t23, t24, div7, t25, t26_value = ctx.groups.cost.toFixed(2) + '$', t26, t27, if_block_anchor;

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
				t25 = text("Cost: ");
				t26 = text(t26_value);
				t27 = space();
				if (if_block) if_block.c();
				if_block_anchor = empty();
				h4.className = "svelte-xaax2";
				add_location(h4, file, 901, 10, 19606);
				add_location(div0, file, 903, 10, 19636);
				add_location(div1, file, 904, 10, 19693);
				add_location(div2, file, 908, 10, 19826);
				add_location(div3, file, 909, 10, 19885);
				add_location(div4, file, 910, 10, 19942);
				add_location(div5, file, 911, 10, 20000);
				add_location(div6, file, 912, 10, 20065);
				add_location(div7, file, 914, 10, 20126);
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

				if ((changed.promise) && t14_value !== (t14_value = ctx.groups['instantCount'])) {
					set_data(t14, t14_value);
				}

				if ((changed.promise) && t17_value !== (t17_value = ctx.groups['sorceryCount'])) {
					set_data(t17, t17_value);
				}

				if ((changed.promise) && t20_value !== (t20_value = ctx.groups['enchantmentCount'])) {
					set_data(t20, t20_value);
				}

				if ((changed.promise) && t23_value !== (t23_value = ctx.groups['artifactCount'])) {
					set_data(t23, t23_value);
				}

				if ((changed.promise) && t26_value !== (t26_value = ctx.groups.cost.toFixed(2) + '$')) {
					set_data(t26, t26_value);
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
				}

				if (if_block) if_block.d(detaching);

				if (detaching) {
					detach(if_block_anchor);
				}
			}
		};
	}

	// (917:10) {#if statisticsActive}
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
				h40.className = "svelte-xaax2";
				add_location(h40, file, 918, 14, 20263);
				div0.className = "deck-value blue svelte-xaax2";
				add_location(div0, file, 920, 16, 20341);
				div1.className = "deck-value black svelte-xaax2";
				add_location(div1, file, 921, 16, 20415);
				div2.className = "deck-value red svelte-xaax2";
				add_location(div2, file, 922, 16, 20491);
				div3.className = "deck-value white svelte-xaax2";
				add_location(div3, file, 923, 16, 20563);
				div4.className = "deck-value green svelte-xaax2";
				add_location(div4, file, 924, 16, 20639);
				div5.className = "deck-value colorless svelte-xaax2";
				add_location(div5, file, 925, 16, 20715);
				div6.className = "mana-devotion svelte-xaax2";
				add_location(div6, file, 919, 14, 20296);
				h41.className = "svelte-xaax2";
				add_location(h41, file, 930, 14, 20859);
				add_location(div7, file, 931, 14, 20896);
				add_location(div8, file, 932, 14, 20976);
				add_location(div9, file, 933, 14, 21036);
				h42.className = "svelte-xaax2";
				add_location(h42, file, 936, 14, 21156);
				div10.className = "deck-value blue svelte-xaax2";
				add_location(div10, file, 938, 16, 21253);
				div11.className = "deck-value black svelte-xaax2";
				add_location(div11, file, 941, 16, 21408);
				div12.className = "deck-value red svelte-xaax2";
				add_location(div12, file, 944, 16, 21565);
				div13.className = "deck-value white svelte-xaax2";
				add_location(div13, file, 947, 16, 21718);
				div14.className = "deck-value green svelte-xaax2";
				add_location(div14, file, 950, 16, 21875);
				div15.className = "deck-value colorless svelte-xaax2";
				add_location(div15, file, 953, 16, 22032);
				div16.className = "mana-proposal svelte-xaax2";
				add_location(div16, file, 937, 14, 21208);
				h43.className = "svelte-xaax2";
				add_location(h43, file, 957, 14, 22217);
				div17.className = "all-curves svelte-xaax2";
				add_location(div17, file, 959, 16, 22294);
				div18.className = "all-labels svelte-xaax2";
				add_location(div18, file, 976, 16, 22977);
				div19.className = "mana-curve svelte-xaax2";
				add_location(div19, file, 958, 14, 22252);
				div20.className = "statistics svelte-xaax2";
				add_location(div20, file, 917, 12, 20223);
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

	// (962:20) {#if mana > 0}
	function create_if_block_11(ctx) {
		var div1, div0, t_value = ctx.mana || '', t, div0_style_value, dispose;

		function click_handler() {
			return ctx.click_handler(ctx);
		}

		return {
			c: function create() {
				div1 = element("div");
				div0 = element("div");
				t = text(t_value);
				div0.className = "curve-element svelte-xaax2";
				div0.style.cssText = div0_style_value = 'height:' + getHeight(ctx.mana, ctx.groups) + '%;';
				add_location(div0, file, 966, 24, 22645);
				div1.className = "curve-wrapper svelte-xaax2";
				toggle_class(div1, "highlighted", ctx.devotionHighlight == ctx.i);
				add_location(div1, file, 962, 22, 22436);
				dispose = listen(div1, "click", click_handler);
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

	// (961:18) {#each groups['manaCurve'] as mana, i}
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

	// (979:20) {#if mana > 0}
	function create_if_block_10(ctx) {
		var div, t, dispose;

		function click_handler_1() {
			return ctx.click_handler_1(ctx);
		}

		return {
			c: function create() {
				div = element("div");
				t = text(ctx.i);
				div.className = "curve-label svelte-xaax2";
				toggle_class(div, "highlighted", ctx.devotionHighlight == ctx.i);
				add_location(div, file, 979, 22, 23119);
				dispose = listen(div, "click", click_handler_1);
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

	// (978:18) {#each groups['manaCurve'] as mana, i}
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

	// (896:22)             <div>loading: {progress}
	function create_pending_block_2(ctx) {
		var div, t0, t1, t2, t3;

		return {
			c: function create() {
				div = element("div");
				t0 = text("loading: ");
				t1 = text(ctx.progress);
				t2 = text("/");
				t3 = text(ctx.all);
				add_location(div, file, 897, 8, 19507);
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

	// (1172:4) {:catch error}
	function create_catch_block_1(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "ERROR, check your decklist for correct format or internet connection\r\n        brudi";
				div.className = "error";
				add_location(div, file, 1173, 6, 29771);
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

	// (1083:4) {:then groups}
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
				if (changed.hiddenGroups || changed.deckSeach || changed.promise || changed.width || changed.height || changed.currentCardContext || changed.scaling || changed.format || changed.devotionHighlight) {
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

	// (1126:16) {#each { length: card.count > 4 ? 4 : card.count } as _, i}
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
				img.className = "card svelte-xaax2";
				img.style.cssText = 'margin-top: ' + ctx.i * 40 + 'px';
				img.src = img_src_value = ctx.card.url;
				img.alt = img_alt_value = ctx.card.name;
				img.width = ctx.width;
				img.height = ctx.height;
				toggle_class(img, "banned", ctx.card.data.legalities[ctx.format.value] !== 'legal');
				toggle_class(img, "highlighted", ctx.devotionHighlight == ctx.card.data.cmc);
				add_location(img, file, 1126, 18, 28103);

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
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(img);
				}

				run_all(dispose);
			}
		};
	}

	// (1140:16) {#if card.data.legalities[format.value] !== 'legal'}
	function create_if_block_7(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "BANNED";
				div.className = "banned-text svelte-xaax2";
				add_location(div, file, 1140, 18, 28758);
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

	// (1143:16) {#if card.count > 4}
	function create_if_block_6(ctx) {
		var div, t0_value = ctx.card.count, t0, t1;

		return {
			c: function create() {
				div = element("div");
				t0 = text(t0_value);
				t1 = text("x");
				div.className = "count svelte-xaax2";
				add_location(div, file, 1143, 18, 28876);
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

	// (1147:16) {#if scaling > 90}
	function create_if_block_5(ctx) {
		var div, t_value = ctx.card.data.prices.usd + '$' || '???', t;

		return {
			c: function create() {
				div = element("div");
				t = text(t_value);
				div.className = "price svelte-xaax2";
				add_location(div, file, 1147, 18, 28995);
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

	// (1151:16) {#if currentCardContext === card}
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
				div.className = "card-context-menu svelte-xaax2";
				add_location(div, file, 1151, 18, 29153);
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

	// (1155:22) {#if group.name != subGroup.name}
	function create_if_block_4(ctx) {
		var div, t_value = ctx.subGroup.name, t, dispose;

		function mousedown_handler(...args) {
			return ctx.mousedown_handler(ctx, ...args);
		}

		return {
			c: function create() {
				div = element("div");
				t = text(t_value);
				div.className = "card-context-entry svelte-xaax2";
				add_location(div, file, 1155, 24, 29317);
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

	// (1154:20) {#each groups as subGroup}
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

	// (1114:12) {#each group.cards as card}
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
				a.className = "link svelte-xaax2";
				a.href = a_href_value = ctx.card.data.purchase_uris.cardmarket;
				a.target = "_blank";
				add_location(a, file, 1118, 18, 27790);
				div0.className = "shoping svelte-xaax2";
				add_location(div0, file, 1117, 16, 27749);
				div1.className = "entry svelte-xaax2";
				div1.style.cssText = div1_style_value = 'width:' + ctx.width + 'px; height:' + (ctx.card.count <= 4 ? ctx.height + ((ctx.card.count || 1) - 1) * 40 : ctx.height + 3 * 40) + 'px;';
				add_location(div1, file, 1114, 14, 27551);
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

				if (changed.deckSeach || changed.promise || changed.width || changed.height || changed.format || changed.devotionHighlight) {
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

	// (1085:6) {#each deckSeach || groups || [] as group}
	function create_each_block_1(ctx) {
		var div11, div9, h2, t0_value = ctx.group.name + ' // ' + ctx.group.count || 'no name', t0, t1, button, t3, div8, div0, t4_value = ctx.group.mana.blue, t4, t5, div1, t6_value = ctx.group.mana.black, t6, t7, div2, t8_value = ctx.group.mana.red, t8, t9, div3, t10_value = ctx.group.mana.white, t10, t11, div4, t12_value = ctx.group.mana.green, t12, t13, div5, t14_value = ctx.group.mana.colorless, t14, t15, div6, t16_value = ctx.group.mana.sum, t16, t17, div7, t18_value = ctx.group.cost.toFixed(2) + '$', t18, t19, div10, dispose;

		function click_handler_2() {
			return ctx.click_handler_2(ctx);
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
				h2.className = "svelte-xaax2";
				add_location(h2, file, 1088, 12, 26385);
				add_location(button, file, 1089, 12, 26456);
				div0.className = "group-value blue svelte-xaax2";
				add_location(div0, file, 1093, 14, 26615);
				div1.className = "group-value black svelte-xaax2";
				add_location(div1, file, 1094, 14, 26684);
				div2.className = "group-value red svelte-xaax2";
				add_location(div2, file, 1095, 14, 26755);
				div3.className = "group-value white svelte-xaax2";
				add_location(div3, file, 1096, 14, 26822);
				div4.className = "group-value green svelte-xaax2";
				add_location(div4, file, 1097, 14, 26893);
				div5.className = "group-value colorless svelte-xaax2";
				add_location(div5, file, 1098, 14, 26964);
				div6.className = "group-value sum svelte-xaax2";
				add_location(div6, file, 1102, 14, 27171);
				div7.className = "group-value group-cost svelte-xaax2";
				add_location(div7, file, 1103, 14, 27238);
				div8.className = "group-statistics svelte-xaax2";
				add_location(div8, file, 1092, 12, 26569);
				div9.className = "group-header svelte-xaax2";
				add_location(div9, file, 1087, 10, 26345);
				div10.className = "group-content svelte-xaax2";
				toggle_class(div10, "hidden", ctx.hiddenGroups.has(ctx.group.name));
				add_location(div10, file, 1109, 10, 27395);
				div11.className = "group";
				add_location(div11, file, 1085, 8, 26312);
				dispose = listen(button, "click", click_handler_2);
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

				if (changed.width || changed.deckSeach || changed.promise || changed.height || changed.currentCardContext || changed.scaling || changed.format || changed.devotionHighlight) {
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

	// (1075:20)         <div class="loading-wrapper">          <div>loading: {progress}
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
				add_location(div0, file, 1076, 8, 26092);
				div1.className = "svelte-xaax2";
				add_location(div1, file, 1078, 10, 26174);
				div2.className = "svelte-xaax2";
				add_location(div2, file, 1079, 10, 26193);
				div3.className = "lds-ripple svelte-xaax2";
				add_location(div3, file, 1077, 8, 26138);
				div4.className = "loading-wrapper svelte-xaax2";
				add_location(div4, file, 1075, 6, 26053);
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

	// (1293:4) {:catch error}
	function create_catch_block(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "ERROR, check your decklist for correct format or internet connection\r\n        brudi";
				div.className = "error";
				add_location(div, file, 1293, 6, 33284);
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

	// (1252:4) {:then result}
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

	// (1290:6) {:else}
	function create_else_block_1(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "No cards found";
				add_location(div, file, 1290, 8, 33218);
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

	// (1254:6) {#if result.code !== 'not_found' && result.data}
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

		function click_handler_3() {
			return ctx.click_handler_3(ctx);
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
				div.className = "search-result svelte-xaax2";
				add_location(div, file, 1254, 8, 31987);
				button.disabled = button_disabled_value = !ctx.result.has_more;
				add_location(button, file, 1284, 8, 33053);
				dispose = listen(button, "click", click_handler_3);
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

	// (1281:10) {:else}
	function create_else_block(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "No cards found";
				add_location(div, file, 1281, 12, 32983);
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

	// (1274:14) {#if card.legalities[format.value] !== 'legal'}
	function create_if_block_2(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "BANNED";
				div.className = "banned-text svelte-xaax2";
				add_location(div, file, 1274, 16, 32742);
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

	// (1277:14) {#if scaling > 90}
	function create_if_block_1(ctx) {
		var div, t_value = ctx.card.prices.usd + '$' || '???', t;

		return {
			c: function create() {
				div = element("div");
				t = text(t_value);
				div.className = "price svelte-xaax2";
				add_location(div, file, 1277, 16, 32852);
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

	// (1256:10) {#each result.data as card}
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
				a.className = "link svelte-xaax2";
				a.href = a_href_value = ctx.card.cardmarket;
				a.target = "_blank";
				add_location(a, file, 1260, 16, 32229);
				div0.className = "shoping svelte-xaax2";
				add_location(div0, file, 1259, 14, 32190);
				img.className = "card svelte-xaax2";
				img.src = img_src_value = ctx.card.url;
				img.alt = img_alt_value = ctx.card.name;
				img.width = ctx.width;
				img.height = ctx.height;
				toggle_class(img, "banned", ctx.card.legalities[ctx.format.value] !== 'legal');
				add_location(img, file, 1264, 14, 32373);
				div1.className = "entry svelte-xaax2";
				div1.style.cssText = div1_style_value = 'width:' + ctx.width + 'px; height:' + ctx.height + 'px;';
				add_location(div1, file, 1256, 12, 32067);
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

	// (1245:30)         <div class="loading-wrapper">          <div class="lds-ripple">            <div />            <div />          </div>        </div>      {:then result}
	function create_pending_block(ctx) {
		var div3, div2, div0, t, div1;

		return {
			c: function create() {
				div3 = element("div");
				div2 = element("div");
				div0 = element("div");
				t = space();
				div1 = element("div");
				div0.className = "svelte-xaax2";
				add_location(div0, file, 1247, 10, 31843);
				div1.className = "svelte-xaax2";
				add_location(div1, file, 1248, 10, 31862);
				div2.className = "lds-ripple svelte-xaax2";
				add_location(div2, file, 1246, 8, 31807);
				div3.className = "loading-wrapper svelte-xaax2";
				add_location(div3, file, 1245, 6, 31768);
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
				div0.className = "help-symbol svelte-xaax2";
				add_location(div0, file, 877, 6, 18800);
				option0.selected = true;
				option0.__value = "commander";
				option0.value = option0.__value;
				add_location(option0, file, 1008, 8, 23960);
				option1.__value = "brawl";
				option1.value = option1.__value;
				add_location(option1, file, 1009, 8, 24005);
				option2.__value = "duel";
				option2.value = option2.__value;
				add_location(option2, file, 1010, 8, 24037);
				option3.__value = "future";
				option3.value = option3.__value;
				add_location(option3, file, 1011, 8, 24068);
				option4.__value = "historic";
				option4.value = option4.__value;
				add_location(option4, file, 1012, 8, 24101);
				option5.__value = "legacy";
				option5.value = option5.__value;
				add_location(option5, file, 1013, 8, 24136);
				option6.__value = "modern";
				option6.value = option6.__value;
				add_location(option6, file, 1014, 8, 24169);
				option7.__value = "oldschool";
				option7.value = option7.__value;
				add_location(option7, file, 1015, 8, 24202);
				option8.__value = "pauper";
				option8.value = option8.__value;
				add_location(option8, file, 1016, 8, 24238);
				option9.__value = "penny";
				option9.value = option9.__value;
				add_location(option9, file, 1017, 8, 24271);
				option10.__value = "pioneer";
				option10.value = option10.__value;
				add_location(option10, file, 1018, 8, 24303);
				option11.__value = "standard";
				option11.value = option11.__value;
				add_location(option11, file, 1019, 8, 24337);
				option12.__value = "vintage";
				option12.value = option12.__value;
				add_location(option12, file, 1020, 8, 24372);
				select.title = "select the legality checker";
				add_location(select, file, 1003, 6, 23815);
				attr(input0, "type", "range");
				input0.min = "25";
				input0.max = "100";
				input0.title = "scales the card size in the right view";
				add_location(input0, file, 1024, 8, 24475);
				div1.className = "slidecontainer";
				add_location(div1, file, 1022, 6, 24421);
				input1.value = input1_value_value = ctx.Cookies.get('deckName') || 'unknown_deck';
				input1.title = "The name of the deck for saving";
				add_location(input1, file, 1033, 8, 24715);
				button0.title = "this will download you a file, called like you provide in the\r\n          deck";
				add_location(button0, file, 1038, 8, 24920);
				div2.className = "save-container";
				add_location(div2, file, 1031, 6, 24661);
				button1.title = "toggles the visibility of the statisticks";
				add_location(button1, file, 1045, 6, 25113);
				button2.title = "this sorts the deck to lands spells and creatures -NOTE: your\r\n        groups will be replaced";
				add_location(button2, file, 1050, 6, 25310);
				button3.title = "this copies the deck without groups and stuff to your clipboard";
				add_location(button3, file, 1056, 6, 25504);
				button4.title = "copies a string to your clipboard, that shares this deck with\r\n        others";
				add_location(button4, file, 1061, 6, 25667);
				add_location(button5, file, 1068, 6, 25842);
				div3.className = "help svelte-xaax2";
				add_location(div3, file, 876, 4, 18774);
				textarea.className = "input svelte-xaax2";
				add_location(textarea, file, 1070, 4, 25902);
				div4.className = "controls svelte-xaax2";
				add_location(div4, file, 875, 2, 18746);
				div5.className = "display svelte-xaax2";
				add_location(div5, file, 1073, 2, 25982);
				div6.className = "toggle-search svelte-xaax2";
				add_location(div6, file, 1181, 4, 29989);
				add_location(input2, file, 1185, 8, 30139);
				div7.className = "search-param";
				add_location(div7, file, 1183, 6, 30088);
				add_location(input3, file, 1189, 8, 30240);
				div8.className = "search-param";
				add_location(div8, file, 1187, 6, 30189);
				add_location(input4, file, 1193, 8, 30341);
				div9.className = "search-param";
				add_location(div9, file, 1191, 6, 30290);
				attr(input5, "type", "checkbox");
				input5.className = "blue svelte-xaax2";
				add_location(input5, file, 1199, 10, 30498);
				div10.className = "blue svelte-xaax2";
				add_location(div10, file, 1198, 8, 30468);
				attr(input6, "type", "checkbox");
				input6.className = "black svelte-xaax2";
				add_location(input6, file, 1206, 10, 30693);
				div11.className = "black svelte-xaax2";
				add_location(div11, file, 1205, 8, 30662);
				attr(input7, "type", "checkbox");
				input7.className = "red svelte-xaax2";
				add_location(input7, file, 1213, 10, 30888);
				div12.className = "red svelte-xaax2";
				add_location(div12, file, 1212, 8, 30859);
				attr(input8, "type", "checkbox");
				input8.className = "white svelte-xaax2";
				add_location(input8, file, 1220, 10, 31081);
				div13.className = "white svelte-xaax2";
				add_location(div13, file, 1219, 8, 31050);
				attr(input9, "type", "checkbox");
				input9.className = "green svelte-xaax2";
				add_location(input9, file, 1227, 10, 31278);
				div14.className = "green svelte-xaax2";
				add_location(div14, file, 1226, 8, 31247);
				attr(input10, "type", "checkbox");
				input10.className = "colorless svelte-xaax2";
				add_location(input10, file, 1234, 10, 31479);
				div15.className = "colorless svelte-xaax2";
				add_location(div15, file, 1233, 8, 31444);
				div16.className = "search-param color-param svelte-xaax2";
				add_location(div16, file, 1196, 6, 30393);
				add_location(button6, file, 1241, 6, 31668);
				div17.className = "search-params svelte-xaax2";
				add_location(div17, file, 1182, 4, 30053);
				div18.className = "card-search svelte-xaax2";
				toggle_class(div18, "hide", !ctx.cardSearchActive);
				add_location(div18, file, 1180, 2, 29927);
				div19.className = "content svelte-xaax2";
				add_location(div19, file, 874, 0, 18721);

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

		function click_handler({ i }) {
			return highlightDevotion(i);
		}

		function click_handler_1({ i }) {
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

		function click_handler_2({ group }) {
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

		function click_handler_3({ result }) {
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
			click_handler,
			click_handler_1,
			input_1_binding,
			keyup_handler,
			select_binding,
			input0_change_input_handler,
			input1_binding,
			textarea_binding,
			click_handler_2,
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
			click_handler_3
		};
	}

	class Editor extends SvelteComponentDev {
		constructor(options) {
			super(options);
			if (!document.getElementById("svelte-xaax2-style")) add_css();
			init(this, options, instance, create_fragment, safe_not_equal, []);
		}
	}
	Editor.$compile = {"vars":[{"name":"onMount","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"ipc","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"cl","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"CardLoader","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"Cookies","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":false,"referenced":true,"writable":false},{"name":"CARD_RATIO","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"_height","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":true},{"name":"_width","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":true},{"name":"useCookies","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":false,"writable":true},{"name":"enableSaving","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"oldSet","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"height","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"width","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"cardSearchActive","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"statisticsActive","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"scaling","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"display","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"devotionHighlight","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"highlightDevotion","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"promise","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"cardSearchPromise","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"input","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"format","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"progress","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"all","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"spName","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"spText","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"spType","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"spEDHBlue","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"spEDHBlack","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"spEDHRed","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"spEDHWhite","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"spEDHGreen","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"spEDHColorless","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"deckSeach","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"deckSearchInput","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"changeDeckSearch","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"clearForColorless","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"clearColorless","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"searchCards","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"currentCardContext","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"cardContextMenu","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"cardContextClick","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"onMainMouseDown","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"hiddenGroups","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"toggleGroupVisibility","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"sp","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"resetDeckSearch","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"sortDeckString","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"deckNameInput","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"saveDeck","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"onDeckNameType","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"mainKeyDown","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"mainKeyUp","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"update","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"reload","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"appendCard","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"remove","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"copyDeck","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"helpActive","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"saveAllToCookies","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"shareDeck","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"onTyping","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"getHeight","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"openHelp","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"toggleSearch","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"toggleStatistics","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false}]};

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWRpdG9yLWJ1bmRsZS5qcyIsInNvdXJjZXMiOlsibm9kZV9tb2R1bGVzL3N2ZWx0ZS9pbnRlcm5hbC5tanMiLCJjYXJkLWxvYWRlci5qcyIsImVkaXRvci5zdmVsdGUiLCJlZGl0b3ItbWFpbi5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJmdW5jdGlvbiBub29wKCkge31cblxuY29uc3QgaWRlbnRpdHkgPSB4ID0+IHg7XG5cbmZ1bmN0aW9uIGFzc2lnbih0YXIsIHNyYykge1xuXHRmb3IgKGNvbnN0IGsgaW4gc3JjKSB0YXJba10gPSBzcmNba107XG5cdHJldHVybiB0YXI7XG59XG5cbmZ1bmN0aW9uIGlzX3Byb21pc2UodmFsdWUpIHtcblx0cmV0dXJuIHZhbHVlICYmIHR5cGVvZiB2YWx1ZS50aGVuID09PSAnZnVuY3Rpb24nO1xufVxuXG5mdW5jdGlvbiBhZGRfbG9jYXRpb24oZWxlbWVudCwgZmlsZSwgbGluZSwgY29sdW1uLCBjaGFyKSB7XG5cdGVsZW1lbnQuX19zdmVsdGVfbWV0YSA9IHtcblx0XHRsb2M6IHsgZmlsZSwgbGluZSwgY29sdW1uLCBjaGFyIH1cblx0fTtcbn1cblxuZnVuY3Rpb24gcnVuKGZuKSB7XG5cdHJldHVybiBmbigpO1xufVxuXG5mdW5jdGlvbiBibGFua19vYmplY3QoKSB7XG5cdHJldHVybiBPYmplY3QuY3JlYXRlKG51bGwpO1xufVxuXG5mdW5jdGlvbiBydW5fYWxsKGZucykge1xuXHRmbnMuZm9yRWFjaChydW4pO1xufVxuXG5mdW5jdGlvbiBpc19mdW5jdGlvbih0aGluZykge1xuXHRyZXR1cm4gdHlwZW9mIHRoaW5nID09PSAnZnVuY3Rpb24nO1xufVxuXG5mdW5jdGlvbiBzYWZlX25vdF9lcXVhbChhLCBiKSB7XG5cdHJldHVybiBhICE9IGEgPyBiID09IGIgOiBhICE9PSBiIHx8ICgoYSAmJiB0eXBlb2YgYSA9PT0gJ29iamVjdCcpIHx8IHR5cGVvZiBhID09PSAnZnVuY3Rpb24nKTtcbn1cblxuZnVuY3Rpb24gbm90X2VxdWFsKGEsIGIpIHtcblx0cmV0dXJuIGEgIT0gYSA/IGIgPT0gYiA6IGEgIT09IGI7XG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlX3N0b3JlKHN0b3JlLCBuYW1lKSB7XG5cdGlmICghc3RvcmUgfHwgdHlwZW9mIHN0b3JlLnN1YnNjcmliZSAhPT0gJ2Z1bmN0aW9uJykge1xuXHRcdHRocm93IG5ldyBFcnJvcihgJyR7bmFtZX0nIGlzIG5vdCBhIHN0b3JlIHdpdGggYSAnc3Vic2NyaWJlJyBtZXRob2RgKTtcblx0fVxufVxuXG5mdW5jdGlvbiBzdWJzY3JpYmUoY29tcG9uZW50LCBzdG9yZSwgY2FsbGJhY2spIHtcblx0Y29tcG9uZW50LiQkLm9uX2Rlc3Ryb3kucHVzaChzdG9yZS5zdWJzY3JpYmUoY2FsbGJhY2spKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlX3Nsb3QoZGVmaW5pdGlvbiwgY3R4LCBmbikge1xuXHRpZiAoZGVmaW5pdGlvbikge1xuXHRcdGNvbnN0IHNsb3RfY3R4ID0gZ2V0X3Nsb3RfY29udGV4dChkZWZpbml0aW9uLCBjdHgsIGZuKTtcblx0XHRyZXR1cm4gZGVmaW5pdGlvblswXShzbG90X2N0eCk7XG5cdH1cbn1cblxuZnVuY3Rpb24gZ2V0X3Nsb3RfY29udGV4dChkZWZpbml0aW9uLCBjdHgsIGZuKSB7XG5cdHJldHVybiBkZWZpbml0aW9uWzFdXG5cdFx0PyBhc3NpZ24oe30sIGFzc2lnbihjdHguJCRzY29wZS5jdHgsIGRlZmluaXRpb25bMV0oZm4gPyBmbihjdHgpIDoge30pKSlcblx0XHQ6IGN0eC4kJHNjb3BlLmN0eDtcbn1cblxuZnVuY3Rpb24gZ2V0X3Nsb3RfY2hhbmdlcyhkZWZpbml0aW9uLCBjdHgsIGNoYW5nZWQsIGZuKSB7XG5cdHJldHVybiBkZWZpbml0aW9uWzFdXG5cdFx0PyBhc3NpZ24oe30sIGFzc2lnbihjdHguJCRzY29wZS5jaGFuZ2VkIHx8IHt9LCBkZWZpbml0aW9uWzFdKGZuID8gZm4oY2hhbmdlZCkgOiB7fSkpKVxuXHRcdDogY3R4LiQkc2NvcGUuY2hhbmdlZCB8fCB7fTtcbn1cblxuZnVuY3Rpb24gZXhjbHVkZV9pbnRlcm5hbF9wcm9wcyhwcm9wcykge1xuXHRjb25zdCByZXN1bHQgPSB7fTtcblx0Zm9yIChjb25zdCBrIGluIHByb3BzKSBpZiAoa1swXSAhPT0gJyQnKSByZXN1bHRba10gPSBwcm9wc1trXTtcblx0cmV0dXJuIHJlc3VsdDtcbn1cblxuY29uc3QgdGFza3MgPSBuZXcgU2V0KCk7XG5sZXQgcnVubmluZyA9IGZhbHNlO1xuXG5mdW5jdGlvbiBydW5fdGFza3MoKSB7XG5cdHRhc2tzLmZvckVhY2godGFzayA9PiB7XG5cdFx0aWYgKCF0YXNrWzBdKHdpbmRvdy5wZXJmb3JtYW5jZS5ub3coKSkpIHtcblx0XHRcdHRhc2tzLmRlbGV0ZSh0YXNrKTtcblx0XHRcdHRhc2tbMV0oKTtcblx0XHR9XG5cdH0pO1xuXG5cdHJ1bm5pbmcgPSB0YXNrcy5zaXplID4gMDtcblx0aWYgKHJ1bm5pbmcpIHJlcXVlc3RBbmltYXRpb25GcmFtZShydW5fdGFza3MpO1xufVxuXG5mdW5jdGlvbiBjbGVhcl9sb29wcygpIHtcblx0Ly8gZm9yIHRlc3RpbmcuLi5cblx0dGFza3MuZm9yRWFjaCh0YXNrID0+IHRhc2tzLmRlbGV0ZSh0YXNrKSk7XG5cdHJ1bm5pbmcgPSBmYWxzZTtcbn1cblxuZnVuY3Rpb24gbG9vcChmbikge1xuXHRsZXQgdGFzaztcblxuXHRpZiAoIXJ1bm5pbmcpIHtcblx0XHRydW5uaW5nID0gdHJ1ZTtcblx0XHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUocnVuX3Rhc2tzKTtcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0cHJvbWlzZTogbmV3IFByb21pc2UoZnVsZmlsID0+IHtcblx0XHRcdHRhc2tzLmFkZCh0YXNrID0gW2ZuLCBmdWxmaWxdKTtcblx0XHR9KSxcblx0XHRhYm9ydCgpIHtcblx0XHRcdHRhc2tzLmRlbGV0ZSh0YXNrKTtcblx0XHR9XG5cdH07XG59XG5cbmZ1bmN0aW9uIGFwcGVuZCh0YXJnZXQsIG5vZGUpIHtcblx0dGFyZ2V0LmFwcGVuZENoaWxkKG5vZGUpO1xufVxuXG5mdW5jdGlvbiBpbnNlcnQodGFyZ2V0LCBub2RlLCBhbmNob3IpIHtcblx0dGFyZ2V0Lmluc2VydEJlZm9yZShub2RlLCBhbmNob3IpO1xufVxuXG5mdW5jdGlvbiBkZXRhY2gobm9kZSkge1xuXHRub2RlLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQobm9kZSk7XG59XG5cbmZ1bmN0aW9uIGRldGFjaF9iZXR3ZWVuKGJlZm9yZSwgYWZ0ZXIpIHtcblx0d2hpbGUgKGJlZm9yZS5uZXh0U2libGluZyAmJiBiZWZvcmUubmV4dFNpYmxpbmcgIT09IGFmdGVyKSB7XG5cdFx0YmVmb3JlLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoYmVmb3JlLm5leHRTaWJsaW5nKTtcblx0fVxufVxuXG5mdW5jdGlvbiBkZXRhY2hfYmVmb3JlKGFmdGVyKSB7XG5cdHdoaWxlIChhZnRlci5wcmV2aW91c1NpYmxpbmcpIHtcblx0XHRhZnRlci5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGFmdGVyLnByZXZpb3VzU2libGluZyk7XG5cdH1cbn1cblxuZnVuY3Rpb24gZGV0YWNoX2FmdGVyKGJlZm9yZSkge1xuXHR3aGlsZSAoYmVmb3JlLm5leHRTaWJsaW5nKSB7XG5cdFx0YmVmb3JlLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoYmVmb3JlLm5leHRTaWJsaW5nKTtcblx0fVxufVxuXG5mdW5jdGlvbiBkZXN0cm95X2VhY2goaXRlcmF0aW9ucywgZGV0YWNoaW5nKSB7XG5cdGZvciAobGV0IGkgPSAwOyBpIDwgaXRlcmF0aW9ucy5sZW5ndGg7IGkgKz0gMSkge1xuXHRcdGlmIChpdGVyYXRpb25zW2ldKSBpdGVyYXRpb25zW2ldLmQoZGV0YWNoaW5nKTtcblx0fVxufVxuXG5mdW5jdGlvbiBlbGVtZW50KG5hbWUpIHtcblx0cmV0dXJuIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQobmFtZSk7XG59XG5cbmZ1bmN0aW9uIHN2Z19lbGVtZW50KG5hbWUpIHtcblx0cmV0dXJuIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUygnaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnLCBuYW1lKTtcbn1cblxuZnVuY3Rpb24gdGV4dChkYXRhKSB7XG5cdHJldHVybiBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZShkYXRhKTtcbn1cblxuZnVuY3Rpb24gc3BhY2UoKSB7XG5cdHJldHVybiB0ZXh0KCcgJyk7XG59XG5cbmZ1bmN0aW9uIGVtcHR5KCkge1xuXHRyZXR1cm4gdGV4dCgnJyk7XG59XG5cbmZ1bmN0aW9uIGxpc3Rlbihub2RlLCBldmVudCwgaGFuZGxlciwgb3B0aW9ucykge1xuXHRub2RlLmFkZEV2ZW50TGlzdGVuZXIoZXZlbnQsIGhhbmRsZXIsIG9wdGlvbnMpO1xuXHRyZXR1cm4gKCkgPT4gbm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKGV2ZW50LCBoYW5kbGVyLCBvcHRpb25zKTtcbn1cblxuZnVuY3Rpb24gcHJldmVudF9kZWZhdWx0KGZuKSB7XG5cdHJldHVybiBmdW5jdGlvbihldmVudCkge1xuXHRcdGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG5cdFx0cmV0dXJuIGZuLmNhbGwodGhpcywgZXZlbnQpO1xuXHR9O1xufVxuXG5mdW5jdGlvbiBzdG9wX3Byb3BhZ2F0aW9uKGZuKSB7XG5cdHJldHVybiBmdW5jdGlvbihldmVudCkge1xuXHRcdGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuXHRcdHJldHVybiBmbi5jYWxsKHRoaXMsIGV2ZW50KTtcblx0fTtcbn1cblxuZnVuY3Rpb24gYXR0cihub2RlLCBhdHRyaWJ1dGUsIHZhbHVlKSB7XG5cdGlmICh2YWx1ZSA9PSBudWxsKSBub2RlLnJlbW92ZUF0dHJpYnV0ZShhdHRyaWJ1dGUpO1xuXHRlbHNlIG5vZGUuc2V0QXR0cmlidXRlKGF0dHJpYnV0ZSwgdmFsdWUpO1xufVxuXG5mdW5jdGlvbiBzZXRfYXR0cmlidXRlcyhub2RlLCBhdHRyaWJ1dGVzKSB7XG5cdGZvciAoY29uc3Qga2V5IGluIGF0dHJpYnV0ZXMpIHtcblx0XHRpZiAoa2V5ID09PSAnc3R5bGUnKSB7XG5cdFx0XHRub2RlLnN0eWxlLmNzc1RleHQgPSBhdHRyaWJ1dGVzW2tleV07XG5cdFx0fSBlbHNlIGlmIChrZXkgaW4gbm9kZSkge1xuXHRcdFx0bm9kZVtrZXldID0gYXR0cmlidXRlc1trZXldO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRhdHRyKG5vZGUsIGtleSwgYXR0cmlidXRlc1trZXldKTtcblx0XHR9XG5cdH1cbn1cblxuZnVuY3Rpb24gc2V0X2N1c3RvbV9lbGVtZW50X2RhdGEobm9kZSwgcHJvcCwgdmFsdWUpIHtcblx0aWYgKHByb3AgaW4gbm9kZSkge1xuXHRcdG5vZGVbcHJvcF0gPSB2YWx1ZTtcblx0fSBlbHNlIHtcblx0XHRhdHRyKG5vZGUsIHByb3AsIHZhbHVlKTtcblx0fVxufVxuXG5mdW5jdGlvbiB4bGlua19hdHRyKG5vZGUsIGF0dHJpYnV0ZSwgdmFsdWUpIHtcblx0bm9kZS5zZXRBdHRyaWJ1dGVOUygnaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluaycsIGF0dHJpYnV0ZSwgdmFsdWUpO1xufVxuXG5mdW5jdGlvbiBnZXRfYmluZGluZ19ncm91cF92YWx1ZShncm91cCkge1xuXHRjb25zdCB2YWx1ZSA9IFtdO1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IGdyb3VwLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0aWYgKGdyb3VwW2ldLmNoZWNrZWQpIHZhbHVlLnB1c2goZ3JvdXBbaV0uX192YWx1ZSk7XG5cdH1cblx0cmV0dXJuIHZhbHVlO1xufVxuXG5mdW5jdGlvbiB0b19udW1iZXIodmFsdWUpIHtcblx0cmV0dXJuIHZhbHVlID09PSAnJyA/IHVuZGVmaW5lZCA6ICt2YWx1ZTtcbn1cblxuZnVuY3Rpb24gdGltZV9yYW5nZXNfdG9fYXJyYXkocmFuZ2VzKSB7XG5cdGNvbnN0IGFycmF5ID0gW107XG5cdGZvciAobGV0IGkgPSAwOyBpIDwgcmFuZ2VzLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0YXJyYXkucHVzaCh7IHN0YXJ0OiByYW5nZXMuc3RhcnQoaSksIGVuZDogcmFuZ2VzLmVuZChpKSB9KTtcblx0fVxuXHRyZXR1cm4gYXJyYXk7XG59XG5cbmZ1bmN0aW9uIGNoaWxkcmVuKGVsZW1lbnQpIHtcblx0cmV0dXJuIEFycmF5LmZyb20oZWxlbWVudC5jaGlsZE5vZGVzKTtcbn1cblxuZnVuY3Rpb24gY2xhaW1fZWxlbWVudChub2RlcywgbmFtZSwgYXR0cmlidXRlcywgc3ZnKSB7XG5cdGZvciAobGV0IGkgPSAwOyBpIDwgbm9kZXMubGVuZ3RoOyBpICs9IDEpIHtcblx0XHRjb25zdCBub2RlID0gbm9kZXNbaV07XG5cdFx0aWYgKG5vZGUubm9kZU5hbWUgPT09IG5hbWUpIHtcblx0XHRcdGZvciAobGV0IGogPSAwOyBqIDwgbm9kZS5hdHRyaWJ1dGVzLmxlbmd0aDsgaiArPSAxKSB7XG5cdFx0XHRcdGNvbnN0IGF0dHJpYnV0ZSA9IG5vZGUuYXR0cmlidXRlc1tqXTtcblx0XHRcdFx0aWYgKCFhdHRyaWJ1dGVzW2F0dHJpYnV0ZS5uYW1lXSkgbm9kZS5yZW1vdmVBdHRyaWJ1dGUoYXR0cmlidXRlLm5hbWUpO1xuXHRcdFx0fVxuXHRcdFx0cmV0dXJuIG5vZGVzLnNwbGljZShpLCAxKVswXTsgLy8gVE9ETyBzdHJpcCB1bndhbnRlZCBhdHRyaWJ1dGVzXG5cdFx0fVxuXHR9XG5cblx0cmV0dXJuIHN2ZyA/IHN2Z19lbGVtZW50KG5hbWUpIDogZWxlbWVudChuYW1lKTtcbn1cblxuZnVuY3Rpb24gY2xhaW1fdGV4dChub2RlcywgZGF0YSkge1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IG5vZGVzLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0Y29uc3Qgbm9kZSA9IG5vZGVzW2ldO1xuXHRcdGlmIChub2RlLm5vZGVUeXBlID09PSAzKSB7XG5cdFx0XHRub2RlLmRhdGEgPSBkYXRhO1xuXHRcdFx0cmV0dXJuIG5vZGVzLnNwbGljZShpLCAxKVswXTtcblx0XHR9XG5cdH1cblxuXHRyZXR1cm4gdGV4dChkYXRhKTtcbn1cblxuZnVuY3Rpb24gc2V0X2RhdGEodGV4dCwgZGF0YSkge1xuXHRkYXRhID0gJycgKyBkYXRhO1xuXHRpZiAodGV4dC5kYXRhICE9PSBkYXRhKSB0ZXh0LmRhdGEgPSBkYXRhO1xufVxuXG5mdW5jdGlvbiBzZXRfaW5wdXRfdHlwZShpbnB1dCwgdHlwZSkge1xuXHR0cnkge1xuXHRcdGlucHV0LnR5cGUgPSB0eXBlO1xuXHR9IGNhdGNoIChlKSB7XG5cdFx0Ly8gZG8gbm90aGluZ1xuXHR9XG59XG5cbmZ1bmN0aW9uIHNldF9zdHlsZShub2RlLCBrZXksIHZhbHVlKSB7XG5cdG5vZGUuc3R5bGUuc2V0UHJvcGVydHkoa2V5LCB2YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIHNlbGVjdF9vcHRpb24oc2VsZWN0LCB2YWx1ZSkge1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IHNlbGVjdC5vcHRpb25zLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0Y29uc3Qgb3B0aW9uID0gc2VsZWN0Lm9wdGlvbnNbaV07XG5cblx0XHRpZiAob3B0aW9uLl9fdmFsdWUgPT09IHZhbHVlKSB7XG5cdFx0XHRvcHRpb24uc2VsZWN0ZWQgPSB0cnVlO1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0fVxufVxuXG5mdW5jdGlvbiBzZWxlY3Rfb3B0aW9ucyhzZWxlY3QsIHZhbHVlKSB7XG5cdGZvciAobGV0IGkgPSAwOyBpIDwgc2VsZWN0Lm9wdGlvbnMubGVuZ3RoOyBpICs9IDEpIHtcblx0XHRjb25zdCBvcHRpb24gPSBzZWxlY3Qub3B0aW9uc1tpXTtcblx0XHRvcHRpb24uc2VsZWN0ZWQgPSB+dmFsdWUuaW5kZXhPZihvcHRpb24uX192YWx1ZSk7XG5cdH1cbn1cblxuZnVuY3Rpb24gc2VsZWN0X3ZhbHVlKHNlbGVjdCkge1xuXHRjb25zdCBzZWxlY3RlZF9vcHRpb24gPSBzZWxlY3QucXVlcnlTZWxlY3RvcignOmNoZWNrZWQnKSB8fCBzZWxlY3Qub3B0aW9uc1swXTtcblx0cmV0dXJuIHNlbGVjdGVkX29wdGlvbiAmJiBzZWxlY3RlZF9vcHRpb24uX192YWx1ZTtcbn1cblxuZnVuY3Rpb24gc2VsZWN0X211bHRpcGxlX3ZhbHVlKHNlbGVjdCkge1xuXHRyZXR1cm4gW10ubWFwLmNhbGwoc2VsZWN0LnF1ZXJ5U2VsZWN0b3JBbGwoJzpjaGVja2VkJyksIG9wdGlvbiA9PiBvcHRpb24uX192YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIGFkZF9yZXNpemVfbGlzdGVuZXIoZWxlbWVudCwgZm4pIHtcblx0aWYgKGdldENvbXB1dGVkU3R5bGUoZWxlbWVudCkucG9zaXRpb24gPT09ICdzdGF0aWMnKSB7XG5cdFx0ZWxlbWVudC5zdHlsZS5wb3NpdGlvbiA9ICdyZWxhdGl2ZSc7XG5cdH1cblxuXHRjb25zdCBvYmplY3QgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdvYmplY3QnKTtcblx0b2JqZWN0LnNldEF0dHJpYnV0ZSgnc3R5bGUnLCAnZGlzcGxheTogYmxvY2s7IHBvc2l0aW9uOiBhYnNvbHV0ZTsgdG9wOiAwOyBsZWZ0OiAwOyBoZWlnaHQ6IDEwMCU7IHdpZHRoOiAxMDAlOyBvdmVyZmxvdzogaGlkZGVuOyBwb2ludGVyLWV2ZW50czogbm9uZTsgei1pbmRleDogLTE7Jyk7XG5cdG9iamVjdC50eXBlID0gJ3RleHQvaHRtbCc7XG5cblx0bGV0IHdpbjtcblxuXHRvYmplY3Qub25sb2FkID0gKCkgPT4ge1xuXHRcdHdpbiA9IG9iamVjdC5jb250ZW50RG9jdW1lbnQuZGVmYXVsdFZpZXc7XG5cdFx0d2luLmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIGZuKTtcblx0fTtcblxuXHRpZiAoL1RyaWRlbnQvLnRlc3QobmF2aWdhdG9yLnVzZXJBZ2VudCkpIHtcblx0XHRlbGVtZW50LmFwcGVuZENoaWxkKG9iamVjdCk7XG5cdFx0b2JqZWN0LmRhdGEgPSAnYWJvdXQ6YmxhbmsnO1xuXHR9IGVsc2Uge1xuXHRcdG9iamVjdC5kYXRhID0gJ2Fib3V0OmJsYW5rJztcblx0XHRlbGVtZW50LmFwcGVuZENoaWxkKG9iamVjdCk7XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdGNhbmNlbDogKCkgPT4ge1xuXHRcdFx0d2luICYmIHdpbi5yZW1vdmVFdmVudExpc3RlbmVyICYmIHdpbi5yZW1vdmVFdmVudExpc3RlbmVyKCdyZXNpemUnLCBmbik7XG5cdFx0XHRlbGVtZW50LnJlbW92ZUNoaWxkKG9iamVjdCk7XG5cdFx0fVxuXHR9O1xufVxuXG5mdW5jdGlvbiB0b2dnbGVfY2xhc3MoZWxlbWVudCwgbmFtZSwgdG9nZ2xlKSB7XG5cdGVsZW1lbnQuY2xhc3NMaXN0W3RvZ2dsZSA/ICdhZGQnIDogJ3JlbW92ZSddKG5hbWUpO1xufVxuXG5mdW5jdGlvbiBjdXN0b21fZXZlbnQodHlwZSwgZGV0YWlsKSB7XG5cdGNvbnN0IGUgPSBkb2N1bWVudC5jcmVhdGVFdmVudCgnQ3VzdG9tRXZlbnQnKTtcblx0ZS5pbml0Q3VzdG9tRXZlbnQodHlwZSwgZmFsc2UsIGZhbHNlLCBkZXRhaWwpO1xuXHRyZXR1cm4gZTtcbn1cblxubGV0IHN0eWxlc2hlZXQ7XG5sZXQgYWN0aXZlID0gMDtcbmxldCBjdXJyZW50X3J1bGVzID0ge307XG5cbi8vIGh0dHBzOi8vZ2l0aHViLmNvbS9kYXJrc2t5YXBwL3N0cmluZy1oYXNoL2Jsb2IvbWFzdGVyL2luZGV4LmpzXG5mdW5jdGlvbiBoYXNoKHN0cikge1xuXHRsZXQgaGFzaCA9IDUzODE7XG5cdGxldCBpID0gc3RyLmxlbmd0aDtcblxuXHR3aGlsZSAoaS0tKSBoYXNoID0gKChoYXNoIDw8IDUpIC0gaGFzaCkgXiBzdHIuY2hhckNvZGVBdChpKTtcblx0cmV0dXJuIGhhc2ggPj4+IDA7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZV9ydWxlKG5vZGUsIGEsIGIsIGR1cmF0aW9uLCBkZWxheSwgZWFzZSwgZm4sIHVpZCA9IDApIHtcblx0Y29uc3Qgc3RlcCA9IDE2LjY2NiAvIGR1cmF0aW9uO1xuXHRsZXQga2V5ZnJhbWVzID0gJ3tcXG4nO1xuXG5cdGZvciAobGV0IHAgPSAwOyBwIDw9IDE7IHAgKz0gc3RlcCkge1xuXHRcdGNvbnN0IHQgPSBhICsgKGIgLSBhKSAqIGVhc2UocCk7XG5cdFx0a2V5ZnJhbWVzICs9IHAgKiAxMDAgKyBgJXske2ZuKHQsIDEgLSB0KX19XFxuYDtcblx0fVxuXG5cdGNvbnN0IHJ1bGUgPSBrZXlmcmFtZXMgKyBgMTAwJSB7JHtmbihiLCAxIC0gYil9fVxcbn1gO1xuXHRjb25zdCBuYW1lID0gYF9fc3ZlbHRlXyR7aGFzaChydWxlKX1fJHt1aWR9YDtcblxuXHRpZiAoIWN1cnJlbnRfcnVsZXNbbmFtZV0pIHtcblx0XHRpZiAoIXN0eWxlc2hlZXQpIHtcblx0XHRcdGNvbnN0IHN0eWxlID0gZWxlbWVudCgnc3R5bGUnKTtcblx0XHRcdGRvY3VtZW50LmhlYWQuYXBwZW5kQ2hpbGQoc3R5bGUpO1xuXHRcdFx0c3R5bGVzaGVldCA9IHN0eWxlLnNoZWV0O1xuXHRcdH1cblxuXHRcdGN1cnJlbnRfcnVsZXNbbmFtZV0gPSB0cnVlO1xuXHRcdHN0eWxlc2hlZXQuaW5zZXJ0UnVsZShgQGtleWZyYW1lcyAke25hbWV9ICR7cnVsZX1gLCBzdHlsZXNoZWV0LmNzc1J1bGVzLmxlbmd0aCk7XG5cdH1cblxuXHRjb25zdCBhbmltYXRpb24gPSBub2RlLnN0eWxlLmFuaW1hdGlvbiB8fCAnJztcblx0bm9kZS5zdHlsZS5hbmltYXRpb24gPSBgJHthbmltYXRpb24gPyBgJHthbmltYXRpb259LCBgIDogYGB9JHtuYW1lfSAke2R1cmF0aW9ufW1zIGxpbmVhciAke2RlbGF5fW1zIDEgYm90aGA7XG5cblx0YWN0aXZlICs9IDE7XG5cdHJldHVybiBuYW1lO1xufVxuXG5mdW5jdGlvbiBkZWxldGVfcnVsZShub2RlLCBuYW1lKSB7XG5cdG5vZGUuc3R5bGUuYW5pbWF0aW9uID0gKG5vZGUuc3R5bGUuYW5pbWF0aW9uIHx8ICcnKVxuXHRcdC5zcGxpdCgnLCAnKVxuXHRcdC5maWx0ZXIobmFtZVxuXHRcdFx0PyBhbmltID0+IGFuaW0uaW5kZXhPZihuYW1lKSA8IDAgLy8gcmVtb3ZlIHNwZWNpZmljIGFuaW1hdGlvblxuXHRcdFx0OiBhbmltID0+IGFuaW0uaW5kZXhPZignX19zdmVsdGUnKSA9PT0gLTEgLy8gcmVtb3ZlIGFsbCBTdmVsdGUgYW5pbWF0aW9uc1xuXHRcdClcblx0XHQuam9pbignLCAnKTtcblxuXHRpZiAobmFtZSAmJiAhLS1hY3RpdmUpIGNsZWFyX3J1bGVzKCk7XG59XG5cbmZ1bmN0aW9uIGNsZWFyX3J1bGVzKCkge1xuXHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUoKCkgPT4ge1xuXHRcdGlmIChhY3RpdmUpIHJldHVybjtcblx0XHRsZXQgaSA9IHN0eWxlc2hlZXQuY3NzUnVsZXMubGVuZ3RoO1xuXHRcdHdoaWxlIChpLS0pIHN0eWxlc2hlZXQuZGVsZXRlUnVsZShpKTtcblx0XHRjdXJyZW50X3J1bGVzID0ge307XG5cdH0pO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVfYW5pbWF0aW9uKG5vZGUsIGZyb20sIGZuLCBwYXJhbXMpIHtcblx0aWYgKCFmcm9tKSByZXR1cm4gbm9vcDtcblxuXHRjb25zdCB0byA9IG5vZGUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG5cdGlmIChmcm9tLmxlZnQgPT09IHRvLmxlZnQgJiYgZnJvbS5yaWdodCA9PT0gdG8ucmlnaHQgJiYgZnJvbS50b3AgPT09IHRvLnRvcCAmJiBmcm9tLmJvdHRvbSA9PT0gdG8uYm90dG9tKSByZXR1cm4gbm9vcDtcblxuXHRjb25zdCB7XG5cdFx0ZGVsYXkgPSAwLFxuXHRcdGR1cmF0aW9uID0gMzAwLFxuXHRcdGVhc2luZyA9IGlkZW50aXR5LFxuXHRcdHN0YXJ0OiBzdGFydF90aW1lID0gd2luZG93LnBlcmZvcm1hbmNlLm5vdygpICsgZGVsYXksXG5cdFx0ZW5kID0gc3RhcnRfdGltZSArIGR1cmF0aW9uLFxuXHRcdHRpY2sgPSBub29wLFxuXHRcdGNzc1xuXHR9ID0gZm4obm9kZSwgeyBmcm9tLCB0byB9LCBwYXJhbXMpO1xuXG5cdGxldCBydW5uaW5nID0gdHJ1ZTtcblx0bGV0IHN0YXJ0ZWQgPSBmYWxzZTtcblx0bGV0IG5hbWU7XG5cblx0Y29uc3QgY3NzX3RleHQgPSBub2RlLnN0eWxlLmNzc1RleHQ7XG5cblx0ZnVuY3Rpb24gc3RhcnQoKSB7XG5cdFx0aWYgKGNzcykge1xuXHRcdFx0aWYgKGRlbGF5KSBub2RlLnN0eWxlLmNzc1RleHQgPSBjc3NfdGV4dDsgLy8gVE9ETyBjcmVhdGUgZGVsYXllZCBhbmltYXRpb24gaW5zdGVhZD9cblx0XHRcdG5hbWUgPSBjcmVhdGVfcnVsZShub2RlLCAwLCAxLCBkdXJhdGlvbiwgMCwgZWFzaW5nLCBjc3MpO1xuXHRcdH1cblxuXHRcdHN0YXJ0ZWQgPSB0cnVlO1xuXHR9XG5cblx0ZnVuY3Rpb24gc3RvcCgpIHtcblx0XHRpZiAoY3NzKSBkZWxldGVfcnVsZShub2RlLCBuYW1lKTtcblx0XHRydW5uaW5nID0gZmFsc2U7XG5cdH1cblxuXHRsb29wKG5vdyA9PiB7XG5cdFx0aWYgKCFzdGFydGVkICYmIG5vdyA+PSBzdGFydF90aW1lKSB7XG5cdFx0XHRzdGFydCgpO1xuXHRcdH1cblxuXHRcdGlmIChzdGFydGVkICYmIG5vdyA+PSBlbmQpIHtcblx0XHRcdHRpY2soMSwgMCk7XG5cdFx0XHRzdG9wKCk7XG5cdFx0fVxuXG5cdFx0aWYgKCFydW5uaW5nKSB7XG5cdFx0XHRyZXR1cm4gZmFsc2U7XG5cdFx0fVxuXG5cdFx0aWYgKHN0YXJ0ZWQpIHtcblx0XHRcdGNvbnN0IHAgPSBub3cgLSBzdGFydF90aW1lO1xuXHRcdFx0Y29uc3QgdCA9IDAgKyAxICogZWFzaW5nKHAgLyBkdXJhdGlvbik7XG5cdFx0XHR0aWNrKHQsIDEgLSB0KTtcblx0XHR9XG5cblx0XHRyZXR1cm4gdHJ1ZTtcblx0fSk7XG5cblx0aWYgKGRlbGF5KSB7XG5cdFx0aWYgKGNzcykgbm9kZS5zdHlsZS5jc3NUZXh0ICs9IGNzcygwLCAxKTtcblx0fSBlbHNlIHtcblx0XHRzdGFydCgpO1xuXHR9XG5cblx0dGljaygwLCAxKTtcblxuXHRyZXR1cm4gc3RvcDtcbn1cblxuZnVuY3Rpb24gZml4X3Bvc2l0aW9uKG5vZGUpIHtcblx0Y29uc3Qgc3R5bGUgPSBnZXRDb21wdXRlZFN0eWxlKG5vZGUpO1xuXG5cdGlmIChzdHlsZS5wb3NpdGlvbiAhPT0gJ2Fic29sdXRlJyAmJiBzdHlsZS5wb3NpdGlvbiAhPT0gJ2ZpeGVkJykge1xuXHRcdGNvbnN0IHsgd2lkdGgsIGhlaWdodCB9ID0gc3R5bGU7XG5cdFx0Y29uc3QgYSA9IG5vZGUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG5cdFx0bm9kZS5zdHlsZS5wb3NpdGlvbiA9ICdhYnNvbHV0ZSc7XG5cdFx0bm9kZS5zdHlsZS53aWR0aCA9IHdpZHRoO1xuXHRcdG5vZGUuc3R5bGUuaGVpZ2h0ID0gaGVpZ2h0O1xuXHRcdGNvbnN0IGIgPSBub2RlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXG5cdFx0aWYgKGEubGVmdCAhPT0gYi5sZWZ0IHx8IGEudG9wICE9PSBiLnRvcCkge1xuXHRcdFx0Y29uc3Qgc3R5bGUgPSBnZXRDb21wdXRlZFN0eWxlKG5vZGUpO1xuXHRcdFx0Y29uc3QgdHJhbnNmb3JtID0gc3R5bGUudHJhbnNmb3JtID09PSAnbm9uZScgPyAnJyA6IHN0eWxlLnRyYW5zZm9ybTtcblxuXHRcdFx0bm9kZS5zdHlsZS50cmFuc2Zvcm0gPSBgJHt0cmFuc2Zvcm19IHRyYW5zbGF0ZSgke2EubGVmdCAtIGIubGVmdH1weCwgJHthLnRvcCAtIGIudG9wfXB4KWA7XG5cdFx0fVxuXHR9XG59XG5cbmxldCBjdXJyZW50X2NvbXBvbmVudDtcblxuZnVuY3Rpb24gc2V0X2N1cnJlbnRfY29tcG9uZW50KGNvbXBvbmVudCkge1xuXHRjdXJyZW50X2NvbXBvbmVudCA9IGNvbXBvbmVudDtcbn1cblxuZnVuY3Rpb24gZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkge1xuXHRpZiAoIWN1cnJlbnRfY29tcG9uZW50KSB0aHJvdyBuZXcgRXJyb3IoYEZ1bmN0aW9uIGNhbGxlZCBvdXRzaWRlIGNvbXBvbmVudCBpbml0aWFsaXphdGlvbmApO1xuXHRyZXR1cm4gY3VycmVudF9jb21wb25lbnQ7XG59XG5cbmZ1bmN0aW9uIGJlZm9yZVVwZGF0ZShmbikge1xuXHRnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5iZWZvcmVfcmVuZGVyLnB1c2goZm4pO1xufVxuXG5mdW5jdGlvbiBvbk1vdW50KGZuKSB7XG5cdGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLm9uX21vdW50LnB1c2goZm4pO1xufVxuXG5mdW5jdGlvbiBhZnRlclVwZGF0ZShmbikge1xuXHRnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5hZnRlcl9yZW5kZXIucHVzaChmbik7XG59XG5cbmZ1bmN0aW9uIG9uRGVzdHJveShmbikge1xuXHRnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5vbl9kZXN0cm95LnB1c2goZm4pO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVFdmVudERpc3BhdGNoZXIoKSB7XG5cdGNvbnN0IGNvbXBvbmVudCA9IGN1cnJlbnRfY29tcG9uZW50O1xuXG5cdHJldHVybiAodHlwZSwgZGV0YWlsKSA9PiB7XG5cdFx0Y29uc3QgY2FsbGJhY2tzID0gY29tcG9uZW50LiQkLmNhbGxiYWNrc1t0eXBlXTtcblxuXHRcdGlmIChjYWxsYmFja3MpIHtcblx0XHRcdC8vIFRPRE8gYXJlIHRoZXJlIHNpdHVhdGlvbnMgd2hlcmUgZXZlbnRzIGNvdWxkIGJlIGRpc3BhdGNoZWRcblx0XHRcdC8vIGluIGEgc2VydmVyIChub24tRE9NKSBlbnZpcm9ubWVudD9cblx0XHRcdGNvbnN0IGV2ZW50ID0gY3VzdG9tX2V2ZW50KHR5cGUsIGRldGFpbCk7XG5cdFx0XHRjYWxsYmFja3Muc2xpY2UoKS5mb3JFYWNoKGZuID0+IHtcblx0XHRcdFx0Zm4uY2FsbChjb21wb25lbnQsIGV2ZW50KTtcblx0XHRcdH0pO1xuXHRcdH1cblx0fTtcbn1cblxuZnVuY3Rpb24gc2V0Q29udGV4dChrZXksIGNvbnRleHQpIHtcblx0Z2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuY29udGV4dC5zZXQoa2V5LCBjb250ZXh0KTtcbn1cblxuZnVuY3Rpb24gZ2V0Q29udGV4dChrZXkpIHtcblx0cmV0dXJuIGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLmNvbnRleHQuZ2V0KGtleSk7XG59XG5cbi8vIFRPRE8gZmlndXJlIG91dCBpZiB3ZSBzdGlsbCB3YW50IHRvIHN1cHBvcnRcbi8vIHNob3J0aGFuZCBldmVudHMsIG9yIGlmIHdlIHdhbnQgdG8gaW1wbGVtZW50XG4vLyBhIHJlYWwgYnViYmxpbmcgbWVjaGFuaXNtXG5mdW5jdGlvbiBidWJibGUoY29tcG9uZW50LCBldmVudCkge1xuXHRjb25zdCBjYWxsYmFja3MgPSBjb21wb25lbnQuJCQuY2FsbGJhY2tzW2V2ZW50LnR5cGVdO1xuXG5cdGlmIChjYWxsYmFja3MpIHtcblx0XHRjYWxsYmFja3Muc2xpY2UoKS5mb3JFYWNoKGZuID0+IGZuKGV2ZW50KSk7XG5cdH1cbn1cblxuY29uc3QgZGlydHlfY29tcG9uZW50cyA9IFtdO1xuY29uc3QgaW50cm9zID0geyBlbmFibGVkOiBmYWxzZSB9O1xuXG5sZXQgdXBkYXRlX3Byb21pc2U7XG5jb25zdCBiaW5kaW5nX2NhbGxiYWNrcyA9IFtdO1xuY29uc3QgcmVuZGVyX2NhbGxiYWNrcyA9IFtdO1xuY29uc3QgZmx1c2hfY2FsbGJhY2tzID0gW107XG5cbmZ1bmN0aW9uIHNjaGVkdWxlX3VwZGF0ZSgpIHtcblx0aWYgKCF1cGRhdGVfcHJvbWlzZSkge1xuXHRcdHVwZGF0ZV9wcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG5cdFx0dXBkYXRlX3Byb21pc2UudGhlbihmbHVzaCk7XG5cdH1cbn1cblxuZnVuY3Rpb24gdGljaygpIHtcblx0c2NoZWR1bGVfdXBkYXRlKCk7XG5cdHJldHVybiB1cGRhdGVfcHJvbWlzZTtcbn1cblxuZnVuY3Rpb24gYWRkX2JpbmRpbmdfY2FsbGJhY2soZm4pIHtcblx0YmluZGluZ19jYWxsYmFja3MucHVzaChmbik7XG59XG5cbmZ1bmN0aW9uIGFkZF9yZW5kZXJfY2FsbGJhY2soZm4pIHtcblx0cmVuZGVyX2NhbGxiYWNrcy5wdXNoKGZuKTtcbn1cblxuZnVuY3Rpb24gYWRkX2ZsdXNoX2NhbGxiYWNrKGZuKSB7XG5cdGZsdXNoX2NhbGxiYWNrcy5wdXNoKGZuKTtcbn1cblxuZnVuY3Rpb24gZmx1c2goKSB7XG5cdGNvbnN0IHNlZW5fY2FsbGJhY2tzID0gbmV3IFNldCgpO1xuXG5cdGRvIHtcblx0XHQvLyBmaXJzdCwgY2FsbCBiZWZvcmVVcGRhdGUgZnVuY3Rpb25zXG5cdFx0Ly8gYW5kIHVwZGF0ZSBjb21wb25lbnRzXG5cdFx0d2hpbGUgKGRpcnR5X2NvbXBvbmVudHMubGVuZ3RoKSB7XG5cdFx0XHRjb25zdCBjb21wb25lbnQgPSBkaXJ0eV9jb21wb25lbnRzLnNoaWZ0KCk7XG5cdFx0XHRzZXRfY3VycmVudF9jb21wb25lbnQoY29tcG9uZW50KTtcblx0XHRcdHVwZGF0ZShjb21wb25lbnQuJCQpO1xuXHRcdH1cblxuXHRcdHdoaWxlIChiaW5kaW5nX2NhbGxiYWNrcy5sZW5ndGgpIGJpbmRpbmdfY2FsbGJhY2tzLnNoaWZ0KCkoKTtcblxuXHRcdC8vIHRoZW4sIG9uY2UgY29tcG9uZW50cyBhcmUgdXBkYXRlZCwgY2FsbFxuXHRcdC8vIGFmdGVyVXBkYXRlIGZ1bmN0aW9ucy4gVGhpcyBtYXkgY2F1c2Vcblx0XHQvLyBzdWJzZXF1ZW50IHVwZGF0ZXMuLi5cblx0XHR3aGlsZSAocmVuZGVyX2NhbGxiYWNrcy5sZW5ndGgpIHtcblx0XHRcdGNvbnN0IGNhbGxiYWNrID0gcmVuZGVyX2NhbGxiYWNrcy5wb3AoKTtcblx0XHRcdGlmICghc2Vlbl9jYWxsYmFja3MuaGFzKGNhbGxiYWNrKSkge1xuXHRcdFx0XHRjYWxsYmFjaygpO1xuXG5cdFx0XHRcdC8vIC4uLnNvIGd1YXJkIGFnYWluc3QgaW5maW5pdGUgbG9vcHNcblx0XHRcdFx0c2Vlbl9jYWxsYmFja3MuYWRkKGNhbGxiYWNrKTtcblx0XHRcdH1cblx0XHR9XG5cdH0gd2hpbGUgKGRpcnR5X2NvbXBvbmVudHMubGVuZ3RoKTtcblxuXHR3aGlsZSAoZmx1c2hfY2FsbGJhY2tzLmxlbmd0aCkge1xuXHRcdGZsdXNoX2NhbGxiYWNrcy5wb3AoKSgpO1xuXHR9XG5cblx0dXBkYXRlX3Byb21pc2UgPSBudWxsO1xufVxuXG5mdW5jdGlvbiB1cGRhdGUoJCQpIHtcblx0aWYgKCQkLmZyYWdtZW50KSB7XG5cdFx0JCQudXBkYXRlKCQkLmRpcnR5KTtcblx0XHRydW5fYWxsKCQkLmJlZm9yZV9yZW5kZXIpO1xuXHRcdCQkLmZyYWdtZW50LnAoJCQuZGlydHksICQkLmN0eCk7XG5cdFx0JCQuZGlydHkgPSBudWxsO1xuXG5cdFx0JCQuYWZ0ZXJfcmVuZGVyLmZvckVhY2goYWRkX3JlbmRlcl9jYWxsYmFjayk7XG5cdH1cbn1cblxubGV0IHByb21pc2U7XG5cbmZ1bmN0aW9uIHdhaXQoKSB7XG5cdGlmICghcHJvbWlzZSkge1xuXHRcdHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcblx0XHRwcm9taXNlLnRoZW4oKCkgPT4ge1xuXHRcdFx0cHJvbWlzZSA9IG51bGw7XG5cdFx0fSk7XG5cdH1cblxuXHRyZXR1cm4gcHJvbWlzZTtcbn1cblxuZnVuY3Rpb24gZGlzcGF0Y2gobm9kZSwgZGlyZWN0aW9uLCBraW5kKSB7XG5cdG5vZGUuZGlzcGF0Y2hFdmVudChjdXN0b21fZXZlbnQoYCR7ZGlyZWN0aW9uID8gJ2ludHJvJyA6ICdvdXRybyd9JHtraW5kfWApKTtcbn1cblxubGV0IG91dHJvcztcblxuZnVuY3Rpb24gZ3JvdXBfb3V0cm9zKCkge1xuXHRvdXRyb3MgPSB7XG5cdFx0cmVtYWluaW5nOiAwLFxuXHRcdGNhbGxiYWNrczogW11cblx0fTtcbn1cblxuZnVuY3Rpb24gY2hlY2tfb3V0cm9zKCkge1xuXHRpZiAoIW91dHJvcy5yZW1haW5pbmcpIHtcblx0XHRydW5fYWxsKG91dHJvcy5jYWxsYmFja3MpO1xuXHR9XG59XG5cbmZ1bmN0aW9uIG9uX291dHJvKGNhbGxiYWNrKSB7XG5cdG91dHJvcy5jYWxsYmFja3MucHVzaChjYWxsYmFjayk7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZV9pbl90cmFuc2l0aW9uKG5vZGUsIGZuLCBwYXJhbXMpIHtcblx0bGV0IGNvbmZpZyA9IGZuKG5vZGUsIHBhcmFtcyk7XG5cdGxldCBydW5uaW5nID0gZmFsc2U7XG5cdGxldCBhbmltYXRpb25fbmFtZTtcblx0bGV0IHRhc2s7XG5cdGxldCB1aWQgPSAwO1xuXG5cdGZ1bmN0aW9uIGNsZWFudXAoKSB7XG5cdFx0aWYgKGFuaW1hdGlvbl9uYW1lKSBkZWxldGVfcnVsZShub2RlLCBhbmltYXRpb25fbmFtZSk7XG5cdH1cblxuXHRmdW5jdGlvbiBnbygpIHtcblx0XHRjb25zdCB7XG5cdFx0XHRkZWxheSA9IDAsXG5cdFx0XHRkdXJhdGlvbiA9IDMwMCxcblx0XHRcdGVhc2luZyA9IGlkZW50aXR5LFxuXHRcdFx0dGljazogdGljayQkMSA9IG5vb3AsXG5cdFx0XHRjc3Ncblx0XHR9ID0gY29uZmlnO1xuXG5cdFx0aWYgKGNzcykgYW5pbWF0aW9uX25hbWUgPSBjcmVhdGVfcnVsZShub2RlLCAwLCAxLCBkdXJhdGlvbiwgZGVsYXksIGVhc2luZywgY3NzLCB1aWQrKyk7XG5cdFx0dGljayQkMSgwLCAxKTtcblxuXHRcdGNvbnN0IHN0YXJ0X3RpbWUgPSB3aW5kb3cucGVyZm9ybWFuY2Uubm93KCkgKyBkZWxheTtcblx0XHRjb25zdCBlbmRfdGltZSA9IHN0YXJ0X3RpbWUgKyBkdXJhdGlvbjtcblxuXHRcdGlmICh0YXNrKSB0YXNrLmFib3J0KCk7XG5cdFx0cnVubmluZyA9IHRydWU7XG5cblx0XHR0YXNrID0gbG9vcChub3cgPT4ge1xuXHRcdFx0aWYgKHJ1bm5pbmcpIHtcblx0XHRcdFx0aWYgKG5vdyA+PSBlbmRfdGltZSkge1xuXHRcdFx0XHRcdHRpY2skJDEoMSwgMCk7XG5cdFx0XHRcdFx0Y2xlYW51cCgpO1xuXHRcdFx0XHRcdHJldHVybiBydW5uaW5nID0gZmFsc2U7XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRpZiAobm93ID49IHN0YXJ0X3RpbWUpIHtcblx0XHRcdFx0XHRjb25zdCB0ID0gZWFzaW5nKChub3cgLSBzdGFydF90aW1lKSAvIGR1cmF0aW9uKTtcblx0XHRcdFx0XHR0aWNrJCQxKHQsIDEgLSB0KTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXG5cdFx0XHRyZXR1cm4gcnVubmluZztcblx0XHR9KTtcblx0fVxuXG5cdGxldCBzdGFydGVkID0gZmFsc2U7XG5cblx0cmV0dXJuIHtcblx0XHRzdGFydCgpIHtcblx0XHRcdGlmIChzdGFydGVkKSByZXR1cm47XG5cblx0XHRcdGRlbGV0ZV9ydWxlKG5vZGUpO1xuXG5cdFx0XHRpZiAodHlwZW9mIGNvbmZpZyA9PT0gJ2Z1bmN0aW9uJykge1xuXHRcdFx0XHRjb25maWcgPSBjb25maWcoKTtcblx0XHRcdFx0d2FpdCgpLnRoZW4oZ28pO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0Z28oKTtcblx0XHRcdH1cblx0XHR9LFxuXG5cdFx0aW52YWxpZGF0ZSgpIHtcblx0XHRcdHN0YXJ0ZWQgPSBmYWxzZTtcblx0XHR9LFxuXG5cdFx0ZW5kKCkge1xuXHRcdFx0aWYgKHJ1bm5pbmcpIHtcblx0XHRcdFx0Y2xlYW51cCgpO1xuXHRcdFx0XHRydW5uaW5nID0gZmFsc2U7XG5cdFx0XHR9XG5cdFx0fVxuXHR9O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVfb3V0X3RyYW5zaXRpb24obm9kZSwgZm4sIHBhcmFtcykge1xuXHRsZXQgY29uZmlnID0gZm4obm9kZSwgcGFyYW1zKTtcblx0bGV0IHJ1bm5pbmcgPSB0cnVlO1xuXHRsZXQgYW5pbWF0aW9uX25hbWU7XG5cblx0Y29uc3QgZ3JvdXAgPSBvdXRyb3M7XG5cblx0Z3JvdXAucmVtYWluaW5nICs9IDE7XG5cblx0ZnVuY3Rpb24gZ28oKSB7XG5cdFx0Y29uc3Qge1xuXHRcdFx0ZGVsYXkgPSAwLFxuXHRcdFx0ZHVyYXRpb24gPSAzMDAsXG5cdFx0XHRlYXNpbmcgPSBpZGVudGl0eSxcblx0XHRcdHRpY2s6IHRpY2skJDEgPSBub29wLFxuXHRcdFx0Y3NzXG5cdFx0fSA9IGNvbmZpZztcblxuXHRcdGlmIChjc3MpIGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgMSwgMCwgZHVyYXRpb24sIGRlbGF5LCBlYXNpbmcsIGNzcyk7XG5cblx0XHRjb25zdCBzdGFydF90aW1lID0gd2luZG93LnBlcmZvcm1hbmNlLm5vdygpICsgZGVsYXk7XG5cdFx0Y29uc3QgZW5kX3RpbWUgPSBzdGFydF90aW1lICsgZHVyYXRpb247XG5cblx0XHRsb29wKG5vdyA9PiB7XG5cdFx0XHRpZiAocnVubmluZykge1xuXHRcdFx0XHRpZiAobm93ID49IGVuZF90aW1lKSB7XG5cdFx0XHRcdFx0dGljayQkMSgwLCAxKTtcblxuXHRcdFx0XHRcdGlmICghLS1ncm91cC5yZW1haW5pbmcpIHtcblx0XHRcdFx0XHRcdC8vIHRoaXMgd2lsbCByZXN1bHQgaW4gYGVuZCgpYCBiZWluZyBjYWxsZWQsXG5cdFx0XHRcdFx0XHQvLyBzbyB3ZSBkb24ndCBuZWVkIHRvIGNsZWFuIHVwIGhlcmVcblx0XHRcdFx0XHRcdHJ1bl9hbGwoZ3JvdXAuY2FsbGJhY2tzKTtcblx0XHRcdFx0XHR9XG5cblx0XHRcdFx0XHRyZXR1cm4gZmFsc2U7XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRpZiAobm93ID49IHN0YXJ0X3RpbWUpIHtcblx0XHRcdFx0XHRjb25zdCB0ID0gZWFzaW5nKChub3cgLSBzdGFydF90aW1lKSAvIGR1cmF0aW9uKTtcblx0XHRcdFx0XHR0aWNrJCQxKDEgLSB0LCB0KTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXG5cdFx0XHRyZXR1cm4gcnVubmluZztcblx0XHR9KTtcblx0fVxuXG5cdGlmICh0eXBlb2YgY29uZmlnID09PSAnZnVuY3Rpb24nKSB7XG5cdFx0d2FpdCgpLnRoZW4oKCkgPT4ge1xuXHRcdFx0Y29uZmlnID0gY29uZmlnKCk7XG5cdFx0XHRnbygpO1xuXHRcdH0pO1xuXHR9IGVsc2Uge1xuXHRcdGdvKCk7XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdGVuZChyZXNldCkge1xuXHRcdFx0aWYgKHJlc2V0ICYmIGNvbmZpZy50aWNrKSB7XG5cdFx0XHRcdGNvbmZpZy50aWNrKDEsIDApO1xuXHRcdFx0fVxuXG5cdFx0XHRpZiAocnVubmluZykge1xuXHRcdFx0XHRpZiAoYW5pbWF0aW9uX25hbWUpIGRlbGV0ZV9ydWxlKG5vZGUsIGFuaW1hdGlvbl9uYW1lKTtcblx0XHRcdFx0cnVubmluZyA9IGZhbHNlO1xuXHRcdFx0fVxuXHRcdH1cblx0fTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlX2JpZGlyZWN0aW9uYWxfdHJhbnNpdGlvbihub2RlLCBmbiwgcGFyYW1zLCBpbnRybykge1xuXHRsZXQgY29uZmlnID0gZm4obm9kZSwgcGFyYW1zKTtcblxuXHRsZXQgdCA9IGludHJvID8gMCA6IDE7XG5cblx0bGV0IHJ1bm5pbmdfcHJvZ3JhbSA9IG51bGw7XG5cdGxldCBwZW5kaW5nX3Byb2dyYW0gPSBudWxsO1xuXHRsZXQgYW5pbWF0aW9uX25hbWUgPSBudWxsO1xuXG5cdGZ1bmN0aW9uIGNsZWFyX2FuaW1hdGlvbigpIHtcblx0XHRpZiAoYW5pbWF0aW9uX25hbWUpIGRlbGV0ZV9ydWxlKG5vZGUsIGFuaW1hdGlvbl9uYW1lKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGluaXQocHJvZ3JhbSwgZHVyYXRpb24pIHtcblx0XHRjb25zdCBkID0gcHJvZ3JhbS5iIC0gdDtcblx0XHRkdXJhdGlvbiAqPSBNYXRoLmFicyhkKTtcblxuXHRcdHJldHVybiB7XG5cdFx0XHRhOiB0LFxuXHRcdFx0YjogcHJvZ3JhbS5iLFxuXHRcdFx0ZCxcblx0XHRcdGR1cmF0aW9uLFxuXHRcdFx0c3RhcnQ6IHByb2dyYW0uc3RhcnQsXG5cdFx0XHRlbmQ6IHByb2dyYW0uc3RhcnQgKyBkdXJhdGlvbixcblx0XHRcdGdyb3VwOiBwcm9ncmFtLmdyb3VwXG5cdFx0fTtcblx0fVxuXG5cdGZ1bmN0aW9uIGdvKGIpIHtcblx0XHRjb25zdCB7XG5cdFx0XHRkZWxheSA9IDAsXG5cdFx0XHRkdXJhdGlvbiA9IDMwMCxcblx0XHRcdGVhc2luZyA9IGlkZW50aXR5LFxuXHRcdFx0dGljazogdGljayQkMSA9IG5vb3AsXG5cdFx0XHRjc3Ncblx0XHR9ID0gY29uZmlnO1xuXG5cdFx0Y29uc3QgcHJvZ3JhbSA9IHtcblx0XHRcdHN0YXJ0OiB3aW5kb3cucGVyZm9ybWFuY2Uubm93KCkgKyBkZWxheSxcblx0XHRcdGJcblx0XHR9O1xuXG5cdFx0aWYgKCFiKSB7XG5cdFx0XHRwcm9ncmFtLmdyb3VwID0gb3V0cm9zO1xuXHRcdFx0b3V0cm9zLnJlbWFpbmluZyArPSAxO1xuXHRcdH1cblxuXHRcdGlmIChydW5uaW5nX3Byb2dyYW0pIHtcblx0XHRcdHBlbmRpbmdfcHJvZ3JhbSA9IHByb2dyYW07XG5cdFx0fSBlbHNlIHtcblx0XHRcdC8vIGlmIHRoaXMgaXMgYW4gaW50cm8sIGFuZCB0aGVyZSdzIGEgZGVsYXksIHdlIG5lZWQgdG8gZG9cblx0XHRcdC8vIGFuIGluaXRpYWwgdGljayBhbmQvb3IgYXBwbHkgQ1NTIGFuaW1hdGlvbiBpbW1lZGlhdGVseVxuXHRcdFx0aWYgKGNzcykge1xuXHRcdFx0XHRjbGVhcl9hbmltYXRpb24oKTtcblx0XHRcdFx0YW5pbWF0aW9uX25hbWUgPSBjcmVhdGVfcnVsZShub2RlLCB0LCBiLCBkdXJhdGlvbiwgZGVsYXksIGVhc2luZywgY3NzKTtcblx0XHRcdH1cblxuXHRcdFx0aWYgKGIpIHRpY2skJDEoMCwgMSk7XG5cblx0XHRcdHJ1bm5pbmdfcHJvZ3JhbSA9IGluaXQocHJvZ3JhbSwgZHVyYXRpb24pO1xuXHRcdFx0YWRkX3JlbmRlcl9jYWxsYmFjaygoKSA9PiBkaXNwYXRjaChub2RlLCBiLCAnc3RhcnQnKSk7XG5cblx0XHRcdGxvb3Aobm93ID0+IHtcblx0XHRcdFx0aWYgKHBlbmRpbmdfcHJvZ3JhbSAmJiBub3cgPiBwZW5kaW5nX3Byb2dyYW0uc3RhcnQpIHtcblx0XHRcdFx0XHRydW5uaW5nX3Byb2dyYW0gPSBpbml0KHBlbmRpbmdfcHJvZ3JhbSwgZHVyYXRpb24pO1xuXHRcdFx0XHRcdHBlbmRpbmdfcHJvZ3JhbSA9IG51bGw7XG5cblx0XHRcdFx0XHRkaXNwYXRjaChub2RlLCBydW5uaW5nX3Byb2dyYW0uYiwgJ3N0YXJ0Jyk7XG5cblx0XHRcdFx0XHRpZiAoY3NzKSB7XG5cdFx0XHRcdFx0XHRjbGVhcl9hbmltYXRpb24oKTtcblx0XHRcdFx0XHRcdGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgdCwgcnVubmluZ19wcm9ncmFtLmIsIHJ1bm5pbmdfcHJvZ3JhbS5kdXJhdGlvbiwgMCwgZWFzaW5nLCBjb25maWcuY3NzKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRpZiAocnVubmluZ19wcm9ncmFtKSB7XG5cdFx0XHRcdFx0aWYgKG5vdyA+PSBydW5uaW5nX3Byb2dyYW0uZW5kKSB7XG5cdFx0XHRcdFx0XHR0aWNrJCQxKHQgPSBydW5uaW5nX3Byb2dyYW0uYiwgMSAtIHQpO1xuXHRcdFx0XHRcdFx0ZGlzcGF0Y2gobm9kZSwgcnVubmluZ19wcm9ncmFtLmIsICdlbmQnKTtcblxuXHRcdFx0XHRcdFx0aWYgKCFwZW5kaW5nX3Byb2dyYW0pIHtcblx0XHRcdFx0XHRcdFx0Ly8gd2UncmUgZG9uZVxuXHRcdFx0XHRcdFx0XHRpZiAocnVubmluZ19wcm9ncmFtLmIpIHtcblx0XHRcdFx0XHRcdFx0XHQvLyBpbnRybyDigJQgd2UgY2FuIHRpZHkgdXAgaW1tZWRpYXRlbHlcblx0XHRcdFx0XHRcdFx0XHRjbGVhcl9hbmltYXRpb24oKTtcblx0XHRcdFx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRcdFx0XHQvLyBvdXRybyDigJQgbmVlZHMgdG8gYmUgY29vcmRpbmF0ZWRcblx0XHRcdFx0XHRcdFx0XHRpZiAoIS0tcnVubmluZ19wcm9ncmFtLmdyb3VwLnJlbWFpbmluZykgcnVuX2FsbChydW5uaW5nX3Byb2dyYW0uZ3JvdXAuY2FsbGJhY2tzKTtcblx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0fVxuXG5cdFx0XHRcdFx0XHRydW5uaW5nX3Byb2dyYW0gPSBudWxsO1xuXHRcdFx0XHRcdH1cblxuXHRcdFx0XHRcdGVsc2UgaWYgKG5vdyA+PSBydW5uaW5nX3Byb2dyYW0uc3RhcnQpIHtcblx0XHRcdFx0XHRcdGNvbnN0IHAgPSBub3cgLSBydW5uaW5nX3Byb2dyYW0uc3RhcnQ7XG5cdFx0XHRcdFx0XHR0ID0gcnVubmluZ19wcm9ncmFtLmEgKyBydW5uaW5nX3Byb2dyYW0uZCAqIGVhc2luZyhwIC8gcnVubmluZ19wcm9ncmFtLmR1cmF0aW9uKTtcblx0XHRcdFx0XHRcdHRpY2skJDEodCwgMSAtIHQpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXG5cdFx0XHRcdHJldHVybiAhIShydW5uaW5nX3Byb2dyYW0gfHwgcGVuZGluZ19wcm9ncmFtKTtcblx0XHRcdH0pO1xuXHRcdH1cblx0fVxuXG5cdHJldHVybiB7XG5cdFx0cnVuKGIpIHtcblx0XHRcdGlmICh0eXBlb2YgY29uZmlnID09PSAnZnVuY3Rpb24nKSB7XG5cdFx0XHRcdHdhaXQoKS50aGVuKCgpID0+IHtcblx0XHRcdFx0XHRjb25maWcgPSBjb25maWcoKTtcblx0XHRcdFx0XHRnbyhiKTtcblx0XHRcdFx0fSk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRnbyhiKTtcblx0XHRcdH1cblx0XHR9LFxuXG5cdFx0ZW5kKCkge1xuXHRcdFx0Y2xlYXJfYW5pbWF0aW9uKCk7XG5cdFx0XHRydW5uaW5nX3Byb2dyYW0gPSBwZW5kaW5nX3Byb2dyYW0gPSBudWxsO1xuXHRcdH1cblx0fTtcbn1cblxuZnVuY3Rpb24gaGFuZGxlX3Byb21pc2UocHJvbWlzZSwgaW5mbykge1xuXHRjb25zdCB0b2tlbiA9IGluZm8udG9rZW4gPSB7fTtcblxuXHRmdW5jdGlvbiB1cGRhdGUodHlwZSwgaW5kZXgsIGtleSwgdmFsdWUpIHtcblx0XHRpZiAoaW5mby50b2tlbiAhPT0gdG9rZW4pIHJldHVybjtcblxuXHRcdGluZm8ucmVzb2x2ZWQgPSBrZXkgJiYgeyBba2V5XTogdmFsdWUgfTtcblxuXHRcdGNvbnN0IGNoaWxkX2N0eCA9IGFzc2lnbihhc3NpZ24oe30sIGluZm8uY3R4KSwgaW5mby5yZXNvbHZlZCk7XG5cdFx0Y29uc3QgYmxvY2sgPSB0eXBlICYmIChpbmZvLmN1cnJlbnQgPSB0eXBlKShjaGlsZF9jdHgpO1xuXG5cdFx0aWYgKGluZm8uYmxvY2spIHtcblx0XHRcdGlmIChpbmZvLmJsb2Nrcykge1xuXHRcdFx0XHRpbmZvLmJsb2Nrcy5mb3JFYWNoKChibG9jaywgaSkgPT4ge1xuXHRcdFx0XHRcdGlmIChpICE9PSBpbmRleCAmJiBibG9jaykge1xuXHRcdFx0XHRcdFx0Z3JvdXBfb3V0cm9zKCk7XG5cdFx0XHRcdFx0XHRvbl9vdXRybygoKSA9PiB7XG5cdFx0XHRcdFx0XHRcdGJsb2NrLmQoMSk7XG5cdFx0XHRcdFx0XHRcdGluZm8uYmxvY2tzW2ldID0gbnVsbDtcblx0XHRcdFx0XHRcdH0pO1xuXHRcdFx0XHRcdFx0YmxvY2subygxKTtcblx0XHRcdFx0XHRcdGNoZWNrX291dHJvcygpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fSk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRpbmZvLmJsb2NrLmQoMSk7XG5cdFx0XHR9XG5cblx0XHRcdGJsb2NrLmMoKTtcblx0XHRcdGlmIChibG9jay5pKSBibG9jay5pKDEpO1xuXHRcdFx0YmxvY2subShpbmZvLm1vdW50KCksIGluZm8uYW5jaG9yKTtcblxuXHRcdFx0Zmx1c2goKTtcblx0XHR9XG5cblx0XHRpbmZvLmJsb2NrID0gYmxvY2s7XG5cdFx0aWYgKGluZm8uYmxvY2tzKSBpbmZvLmJsb2Nrc1tpbmRleF0gPSBibG9jaztcblx0fVxuXG5cdGlmIChpc19wcm9taXNlKHByb21pc2UpKSB7XG5cdFx0cHJvbWlzZS50aGVuKHZhbHVlID0+IHtcblx0XHRcdHVwZGF0ZShpbmZvLnRoZW4sIDEsIGluZm8udmFsdWUsIHZhbHVlKTtcblx0XHR9LCBlcnJvciA9PiB7XG5cdFx0XHR1cGRhdGUoaW5mby5jYXRjaCwgMiwgaW5mby5lcnJvciwgZXJyb3IpO1xuXHRcdH0pO1xuXG5cdFx0Ly8gaWYgd2UgcHJldmlvdXNseSBoYWQgYSB0aGVuL2NhdGNoIGJsb2NrLCBkZXN0cm95IGl0XG5cdFx0aWYgKGluZm8uY3VycmVudCAhPT0gaW5mby5wZW5kaW5nKSB7XG5cdFx0XHR1cGRhdGUoaW5mby5wZW5kaW5nLCAwKTtcblx0XHRcdHJldHVybiB0cnVlO1xuXHRcdH1cblx0fSBlbHNlIHtcblx0XHRpZiAoaW5mby5jdXJyZW50ICE9PSBpbmZvLnRoZW4pIHtcblx0XHRcdHVwZGF0ZShpbmZvLnRoZW4sIDEsIGluZm8udmFsdWUsIHByb21pc2UpO1xuXHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0fVxuXG5cdFx0aW5mby5yZXNvbHZlZCA9IHsgW2luZm8udmFsdWVdOiBwcm9taXNlIH07XG5cdH1cbn1cblxuZnVuY3Rpb24gZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKSB7XG5cdGJsb2NrLmQoMSk7XG5cdGxvb2t1cC5kZWxldGUoYmxvY2sua2V5KTtcbn1cblxuZnVuY3Rpb24gb3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCkge1xuXHRvbl9vdXRybygoKSA9PiB7XG5cdFx0ZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKTtcblx0fSk7XG5cblx0YmxvY2subygxKTtcbn1cblxuZnVuY3Rpb24gZml4X2FuZF9vdXRyb19hbmRfZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKSB7XG5cdGJsb2NrLmYoKTtcblx0b3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCk7XG59XG5cbmZ1bmN0aW9uIHVwZGF0ZV9rZXllZF9lYWNoKG9sZF9ibG9ja3MsIGNoYW5nZWQsIGdldF9rZXksIGR5bmFtaWMsIGN0eCwgbGlzdCwgbG9va3VwLCBub2RlLCBkZXN0cm95LCBjcmVhdGVfZWFjaF9ibG9jaywgbmV4dCwgZ2V0X2NvbnRleHQpIHtcblx0bGV0IG8gPSBvbGRfYmxvY2tzLmxlbmd0aDtcblx0bGV0IG4gPSBsaXN0Lmxlbmd0aDtcblxuXHRsZXQgaSA9IG87XG5cdGNvbnN0IG9sZF9pbmRleGVzID0ge307XG5cdHdoaWxlIChpLS0pIG9sZF9pbmRleGVzW29sZF9ibG9ja3NbaV0ua2V5XSA9IGk7XG5cblx0Y29uc3QgbmV3X2Jsb2NrcyA9IFtdO1xuXHRjb25zdCBuZXdfbG9va3VwID0gbmV3IE1hcCgpO1xuXHRjb25zdCBkZWx0YXMgPSBuZXcgTWFwKCk7XG5cblx0aSA9IG47XG5cdHdoaWxlIChpLS0pIHtcblx0XHRjb25zdCBjaGlsZF9jdHggPSBnZXRfY29udGV4dChjdHgsIGxpc3QsIGkpO1xuXHRcdGNvbnN0IGtleSA9IGdldF9rZXkoY2hpbGRfY3R4KTtcblx0XHRsZXQgYmxvY2sgPSBsb29rdXAuZ2V0KGtleSk7XG5cblx0XHRpZiAoIWJsb2NrKSB7XG5cdFx0XHRibG9jayA9IGNyZWF0ZV9lYWNoX2Jsb2NrKGtleSwgY2hpbGRfY3R4KTtcblx0XHRcdGJsb2NrLmMoKTtcblx0XHR9IGVsc2UgaWYgKGR5bmFtaWMpIHtcblx0XHRcdGJsb2NrLnAoY2hhbmdlZCwgY2hpbGRfY3R4KTtcblx0XHR9XG5cblx0XHRuZXdfbG9va3VwLnNldChrZXksIG5ld19ibG9ja3NbaV0gPSBibG9jayk7XG5cblx0XHRpZiAoa2V5IGluIG9sZF9pbmRleGVzKSBkZWx0YXMuc2V0KGtleSwgTWF0aC5hYnMoaSAtIG9sZF9pbmRleGVzW2tleV0pKTtcblx0fVxuXG5cdGNvbnN0IHdpbGxfbW92ZSA9IG5ldyBTZXQoKTtcblx0Y29uc3QgZGlkX21vdmUgPSBuZXcgU2V0KCk7XG5cblx0ZnVuY3Rpb24gaW5zZXJ0KGJsb2NrKSB7XG5cdFx0aWYgKGJsb2NrLmkpIGJsb2NrLmkoMSk7XG5cdFx0YmxvY2subShub2RlLCBuZXh0KTtcblx0XHRsb29rdXAuc2V0KGJsb2NrLmtleSwgYmxvY2spO1xuXHRcdG5leHQgPSBibG9jay5maXJzdDtcblx0XHRuLS07XG5cdH1cblxuXHR3aGlsZSAobyAmJiBuKSB7XG5cdFx0Y29uc3QgbmV3X2Jsb2NrID0gbmV3X2Jsb2Nrc1tuIC0gMV07XG5cdFx0Y29uc3Qgb2xkX2Jsb2NrID0gb2xkX2Jsb2Nrc1tvIC0gMV07XG5cdFx0Y29uc3QgbmV3X2tleSA9IG5ld19ibG9jay5rZXk7XG5cdFx0Y29uc3Qgb2xkX2tleSA9IG9sZF9ibG9jay5rZXk7XG5cblx0XHRpZiAobmV3X2Jsb2NrID09PSBvbGRfYmxvY2spIHtcblx0XHRcdC8vIGRvIG5vdGhpbmdcblx0XHRcdG5leHQgPSBuZXdfYmxvY2suZmlyc3Q7XG5cdFx0XHRvLS07XG5cdFx0XHRuLS07XG5cdFx0fVxuXG5cdFx0ZWxzZSBpZiAoIW5ld19sb29rdXAuaGFzKG9sZF9rZXkpKSB7XG5cdFx0XHQvLyByZW1vdmUgb2xkIGJsb2NrXG5cdFx0XHRkZXN0cm95KG9sZF9ibG9jaywgbG9va3VwKTtcblx0XHRcdG8tLTtcblx0XHR9XG5cblx0XHRlbHNlIGlmICghbG9va3VwLmhhcyhuZXdfa2V5KSB8fCB3aWxsX21vdmUuaGFzKG5ld19rZXkpKSB7XG5cdFx0XHRpbnNlcnQobmV3X2Jsb2NrKTtcblx0XHR9XG5cblx0XHRlbHNlIGlmIChkaWRfbW92ZS5oYXMob2xkX2tleSkpIHtcblx0XHRcdG8tLTtcblxuXHRcdH0gZWxzZSBpZiAoZGVsdGFzLmdldChuZXdfa2V5KSA+IGRlbHRhcy5nZXQob2xkX2tleSkpIHtcblx0XHRcdGRpZF9tb3ZlLmFkZChuZXdfa2V5KTtcblx0XHRcdGluc2VydChuZXdfYmxvY2spO1xuXG5cdFx0fSBlbHNlIHtcblx0XHRcdHdpbGxfbW92ZS5hZGQob2xkX2tleSk7XG5cdFx0XHRvLS07XG5cdFx0fVxuXHR9XG5cblx0d2hpbGUgKG8tLSkge1xuXHRcdGNvbnN0IG9sZF9ibG9jayA9IG9sZF9ibG9ja3Nbb107XG5cdFx0aWYgKCFuZXdfbG9va3VwLmhhcyhvbGRfYmxvY2sua2V5KSkgZGVzdHJveShvbGRfYmxvY2ssIGxvb2t1cCk7XG5cdH1cblxuXHR3aGlsZSAobikgaW5zZXJ0KG5ld19ibG9ja3NbbiAtIDFdKTtcblxuXHRyZXR1cm4gbmV3X2Jsb2Nrcztcbn1cblxuZnVuY3Rpb24gbWVhc3VyZShibG9ja3MpIHtcblx0Y29uc3QgcmVjdHMgPSB7fTtcblx0bGV0IGkgPSBibG9ja3MubGVuZ3RoO1xuXHR3aGlsZSAoaS0tKSByZWN0c1tibG9ja3NbaV0ua2V5XSA9IGJsb2Nrc1tpXS5ub2RlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXHRyZXR1cm4gcmVjdHM7XG59XG5cbmZ1bmN0aW9uIGdldF9zcHJlYWRfdXBkYXRlKGxldmVscywgdXBkYXRlcykge1xuXHRjb25zdCB1cGRhdGUgPSB7fTtcblxuXHRjb25zdCB0b19udWxsX291dCA9IHt9O1xuXHRjb25zdCBhY2NvdW50ZWRfZm9yID0ge307XG5cblx0bGV0IGkgPSBsZXZlbHMubGVuZ3RoO1xuXHR3aGlsZSAoaS0tKSB7XG5cdFx0Y29uc3QgbyA9IGxldmVsc1tpXTtcblx0XHRjb25zdCBuID0gdXBkYXRlc1tpXTtcblxuXHRcdGlmIChuKSB7XG5cdFx0XHRmb3IgKGNvbnN0IGtleSBpbiBvKSB7XG5cdFx0XHRcdGlmICghKGtleSBpbiBuKSkgdG9fbnVsbF9vdXRba2V5XSA9IDE7XG5cdFx0XHR9XG5cblx0XHRcdGZvciAoY29uc3Qga2V5IGluIG4pIHtcblx0XHRcdFx0aWYgKCFhY2NvdW50ZWRfZm9yW2tleV0pIHtcblx0XHRcdFx0XHR1cGRhdGVba2V5XSA9IG5ba2V5XTtcblx0XHRcdFx0XHRhY2NvdW50ZWRfZm9yW2tleV0gPSAxO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cblx0XHRcdGxldmVsc1tpXSA9IG47XG5cdFx0fSBlbHNlIHtcblx0XHRcdGZvciAoY29uc3Qga2V5IGluIG8pIHtcblx0XHRcdFx0YWNjb3VudGVkX2ZvcltrZXldID0gMTtcblx0XHRcdH1cblx0XHR9XG5cdH1cblxuXHRmb3IgKGNvbnN0IGtleSBpbiB0b19udWxsX291dCkge1xuXHRcdGlmICghKGtleSBpbiB1cGRhdGUpKSB1cGRhdGVba2V5XSA9IHVuZGVmaW5lZDtcblx0fVxuXG5cdHJldHVybiB1cGRhdGU7XG59XG5cbmNvbnN0IGludmFsaWRfYXR0cmlidXRlX25hbWVfY2hhcmFjdGVyID0gL1tcXHMnXCI+Lz1cXHV7RkREMH0tXFx1e0ZERUZ9XFx1e0ZGRkV9XFx1e0ZGRkZ9XFx1ezFGRkZFfVxcdXsxRkZGRn1cXHV7MkZGRkV9XFx1ezJGRkZGfVxcdXszRkZGRX1cXHV7M0ZGRkZ9XFx1ezRGRkZFfVxcdXs0RkZGRn1cXHV7NUZGRkV9XFx1ezVGRkZGfVxcdXs2RkZGRX1cXHV7NkZGRkZ9XFx1ezdGRkZFfVxcdXs3RkZGRn1cXHV7OEZGRkV9XFx1ezhGRkZGfVxcdXs5RkZGRX1cXHV7OUZGRkZ9XFx1e0FGRkZFfVxcdXtBRkZGRn1cXHV7QkZGRkV9XFx1e0JGRkZGfVxcdXtDRkZGRX1cXHV7Q0ZGRkZ9XFx1e0RGRkZFfVxcdXtERkZGRn1cXHV7RUZGRkV9XFx1e0VGRkZGfVxcdXtGRkZGRX1cXHV7RkZGRkZ9XFx1ezEwRkZGRX1cXHV7MTBGRkZGfV0vdTtcbi8vIGh0dHBzOi8vaHRtbC5zcGVjLndoYXR3Zy5vcmcvbXVsdGlwYWdlL3N5bnRheC5odG1sI2F0dHJpYnV0ZXMtMlxuLy8gaHR0cHM6Ly9pbmZyYS5zcGVjLndoYXR3Zy5vcmcvI25vbmNoYXJhY3RlclxuXG5mdW5jdGlvbiBzcHJlYWQoYXJncykge1xuXHRjb25zdCBhdHRyaWJ1dGVzID0gT2JqZWN0LmFzc2lnbih7fSwgLi4uYXJncyk7XG5cdGxldCBzdHIgPSAnJztcblxuXHRPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKS5mb3JFYWNoKG5hbWUgPT4ge1xuXHRcdGlmIChpbnZhbGlkX2F0dHJpYnV0ZV9uYW1lX2NoYXJhY3Rlci50ZXN0KG5hbWUpKSByZXR1cm47XG5cblx0XHRjb25zdCB2YWx1ZSA9IGF0dHJpYnV0ZXNbbmFtZV07XG5cdFx0aWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybjtcblx0XHRpZiAodmFsdWUgPT09IHRydWUpIHN0ciArPSBcIiBcIiArIG5hbWU7XG5cblx0XHRjb25zdCBlc2NhcGVkID0gU3RyaW5nKHZhbHVlKVxuXHRcdFx0LnJlcGxhY2UoL1wiL2csICcmIzM0OycpXG5cdFx0XHQucmVwbGFjZSgvJy9nLCAnJiMzOTsnKTtcblxuXHRcdHN0ciArPSBcIiBcIiArIG5hbWUgKyBcIj1cIiArIEpTT04uc3RyaW5naWZ5KGVzY2FwZWQpO1xuXHR9KTtcblxuXHRyZXR1cm4gc3RyO1xufVxuXG5jb25zdCBlc2NhcGVkID0ge1xuXHQnXCInOiAnJnF1b3Q7Jyxcblx0XCInXCI6ICcmIzM5OycsXG5cdCcmJzogJyZhbXA7Jyxcblx0JzwnOiAnJmx0OycsXG5cdCc+JzogJyZndDsnXG59O1xuXG5mdW5jdGlvbiBlc2NhcGUoaHRtbCkge1xuXHRyZXR1cm4gU3RyaW5nKGh0bWwpLnJlcGxhY2UoL1tcIicmPD5dL2csIG1hdGNoID0+IGVzY2FwZWRbbWF0Y2hdKTtcbn1cblxuZnVuY3Rpb24gZWFjaChpdGVtcywgZm4pIHtcblx0bGV0IHN0ciA9ICcnO1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IGl0ZW1zLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0c3RyICs9IGZuKGl0ZW1zW2ldLCBpKTtcblx0fVxuXHRyZXR1cm4gc3RyO1xufVxuXG5jb25zdCBtaXNzaW5nX2NvbXBvbmVudCA9IHtcblx0JCRyZW5kZXI6ICgpID0+ICcnXG59O1xuXG5mdW5jdGlvbiB2YWxpZGF0ZV9jb21wb25lbnQoY29tcG9uZW50LCBuYW1lKSB7XG5cdGlmICghY29tcG9uZW50IHx8ICFjb21wb25lbnQuJCRyZW5kZXIpIHtcblx0XHRpZiAobmFtZSA9PT0gJ3N2ZWx0ZTpjb21wb25lbnQnKSBuYW1lICs9ICcgdGhpcz17Li4ufSc7XG5cdFx0dGhyb3cgbmV3IEVycm9yKGA8JHtuYW1lfT4gaXMgbm90IGEgdmFsaWQgU1NSIGNvbXBvbmVudC4gWW91IG1heSBuZWVkIHRvIHJldmlldyB5b3VyIGJ1aWxkIGNvbmZpZyB0byBlbnN1cmUgdGhhdCBkZXBlbmRlbmNpZXMgYXJlIGNvbXBpbGVkLCByYXRoZXIgdGhhbiBpbXBvcnRlZCBhcyBwcmUtY29tcGlsZWQgbW9kdWxlc2ApO1xuXHR9XG5cblx0cmV0dXJuIGNvbXBvbmVudDtcbn1cblxuZnVuY3Rpb24gZGVidWcoZmlsZSwgbGluZSwgY29sdW1uLCB2YWx1ZXMpIHtcblx0Y29uc29sZS5sb2coYHtAZGVidWd9ICR7ZmlsZSA/IGZpbGUgKyAnICcgOiAnJ30oJHtsaW5lfToke2NvbHVtbn0pYCk7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tY29uc29sZVxuXHRjb25zb2xlLmxvZyh2YWx1ZXMpOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLWNvbnNvbGVcblx0cmV0dXJuICcnO1xufVxuXG5sZXQgb25fZGVzdHJveTtcblxuZnVuY3Rpb24gY3JlYXRlX3Nzcl9jb21wb25lbnQoZm4pIHtcblx0ZnVuY3Rpb24gJCRyZW5kZXIocmVzdWx0LCBwcm9wcywgYmluZGluZ3MsIHNsb3RzKSB7XG5cdFx0Y29uc3QgcGFyZW50X2NvbXBvbmVudCA9IGN1cnJlbnRfY29tcG9uZW50O1xuXG5cdFx0Y29uc3QgJCQgPSB7XG5cdFx0XHRvbl9kZXN0cm95LFxuXHRcdFx0Y29udGV4dDogbmV3IE1hcChwYXJlbnRfY29tcG9uZW50ID8gcGFyZW50X2NvbXBvbmVudC4kJC5jb250ZXh0IDogW10pLFxuXG5cdFx0XHQvLyB0aGVzZSB3aWxsIGJlIGltbWVkaWF0ZWx5IGRpc2NhcmRlZFxuXHRcdFx0b25fbW91bnQ6IFtdLFxuXHRcdFx0YmVmb3JlX3JlbmRlcjogW10sXG5cdFx0XHRhZnRlcl9yZW5kZXI6IFtdLFxuXHRcdFx0Y2FsbGJhY2tzOiBibGFua19vYmplY3QoKVxuXHRcdH07XG5cblx0XHRzZXRfY3VycmVudF9jb21wb25lbnQoeyAkJCB9KTtcblxuXHRcdGNvbnN0IGh0bWwgPSBmbihyZXN1bHQsIHByb3BzLCBiaW5kaW5ncywgc2xvdHMpO1xuXG5cdFx0c2V0X2N1cnJlbnRfY29tcG9uZW50KHBhcmVudF9jb21wb25lbnQpO1xuXHRcdHJldHVybiBodG1sO1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRyZW5kZXI6IChwcm9wcyA9IHt9LCBvcHRpb25zID0ge30pID0+IHtcblx0XHRcdG9uX2Rlc3Ryb3kgPSBbXTtcblxuXHRcdFx0Y29uc3QgcmVzdWx0ID0geyBoZWFkOiAnJywgY3NzOiBuZXcgU2V0KCkgfTtcblx0XHRcdGNvbnN0IGh0bWwgPSAkJHJlbmRlcihyZXN1bHQsIHByb3BzLCB7fSwgb3B0aW9ucyk7XG5cblx0XHRcdHJ1bl9hbGwob25fZGVzdHJveSk7XG5cblx0XHRcdHJldHVybiB7XG5cdFx0XHRcdGh0bWwsXG5cdFx0XHRcdGNzczoge1xuXHRcdFx0XHRcdGNvZGU6IEFycmF5LmZyb20ocmVzdWx0LmNzcykubWFwKGNzcyA9PiBjc3MuY29kZSkuam9pbignXFxuJyksXG5cdFx0XHRcdFx0bWFwOiBudWxsIC8vIFRPRE9cblx0XHRcdFx0fSxcblx0XHRcdFx0aGVhZDogcmVzdWx0LmhlYWRcblx0XHRcdH07XG5cdFx0fSxcblxuXHRcdCQkcmVuZGVyXG5cdH07XG59XG5cbmZ1bmN0aW9uIGdldF9zdG9yZV92YWx1ZShzdG9yZSkge1xuXHRsZXQgdmFsdWU7XG5cdHN0b3JlLnN1YnNjcmliZShfID0+IHZhbHVlID0gXykoKTtcblx0cmV0dXJuIHZhbHVlO1xufVxuXG5mdW5jdGlvbiBiaW5kKGNvbXBvbmVudCwgbmFtZSwgY2FsbGJhY2spIHtcblx0aWYgKGNvbXBvbmVudC4kJC5wcm9wcy5pbmRleE9mKG5hbWUpID09PSAtMSkgcmV0dXJuO1xuXHRjb21wb25lbnQuJCQuYm91bmRbbmFtZV0gPSBjYWxsYmFjaztcblx0Y2FsbGJhY2soY29tcG9uZW50LiQkLmN0eFtuYW1lXSk7XG59XG5cbmZ1bmN0aW9uIG1vdW50X2NvbXBvbmVudChjb21wb25lbnQsIHRhcmdldCwgYW5jaG9yKSB7XG5cdGNvbnN0IHsgZnJhZ21lbnQsIG9uX21vdW50LCBvbl9kZXN0cm95LCBhZnRlcl9yZW5kZXIgfSA9IGNvbXBvbmVudC4kJDtcblxuXHRmcmFnbWVudC5tKHRhcmdldCwgYW5jaG9yKTtcblxuXHQvLyBvbk1vdW50IGhhcHBlbnMgYWZ0ZXIgdGhlIGluaXRpYWwgYWZ0ZXJVcGRhdGUuIEJlY2F1c2Vcblx0Ly8gYWZ0ZXJVcGRhdGUgY2FsbGJhY2tzIGhhcHBlbiBpbiByZXZlcnNlIG9yZGVyIChpbm5lciBmaXJzdClcblx0Ly8gd2Ugc2NoZWR1bGUgb25Nb3VudCBjYWxsYmFja3MgYmVmb3JlIGFmdGVyVXBkYXRlIGNhbGxiYWNrc1xuXHRhZGRfcmVuZGVyX2NhbGxiYWNrKCgpID0+IHtcblx0XHRjb25zdCBuZXdfb25fZGVzdHJveSA9IG9uX21vdW50Lm1hcChydW4pLmZpbHRlcihpc19mdW5jdGlvbik7XG5cdFx0aWYgKG9uX2Rlc3Ryb3kpIHtcblx0XHRcdG9uX2Rlc3Ryb3kucHVzaCguLi5uZXdfb25fZGVzdHJveSk7XG5cdFx0fSBlbHNlIHtcblx0XHRcdC8vIEVkZ2UgY2FzZSAtIGNvbXBvbmVudCB3YXMgZGVzdHJveWVkIGltbWVkaWF0ZWx5LFxuXHRcdFx0Ly8gbW9zdCBsaWtlbHkgYXMgYSByZXN1bHQgb2YgYSBiaW5kaW5nIGluaXRpYWxpc2luZ1xuXHRcdFx0cnVuX2FsbChuZXdfb25fZGVzdHJveSk7XG5cdFx0fVxuXHRcdGNvbXBvbmVudC4kJC5vbl9tb3VudCA9IFtdO1xuXHR9KTtcblxuXHRhZnRlcl9yZW5kZXIuZm9yRWFjaChhZGRfcmVuZGVyX2NhbGxiYWNrKTtcbn1cblxuZnVuY3Rpb24gZGVzdHJveShjb21wb25lbnQsIGRldGFjaGluZykge1xuXHRpZiAoY29tcG9uZW50LiQkKSB7XG5cdFx0cnVuX2FsbChjb21wb25lbnQuJCQub25fZGVzdHJveSk7XG5cdFx0Y29tcG9uZW50LiQkLmZyYWdtZW50LmQoZGV0YWNoaW5nKTtcblxuXHRcdC8vIFRPRE8gbnVsbCBvdXQgb3RoZXIgcmVmcywgaW5jbHVkaW5nIGNvbXBvbmVudC4kJCAoYnV0IG5lZWQgdG9cblx0XHQvLyBwcmVzZXJ2ZSBmaW5hbCBzdGF0ZT8pXG5cdFx0Y29tcG9uZW50LiQkLm9uX2Rlc3Ryb3kgPSBjb21wb25lbnQuJCQuZnJhZ21lbnQgPSBudWxsO1xuXHRcdGNvbXBvbmVudC4kJC5jdHggPSB7fTtcblx0fVxufVxuXG5mdW5jdGlvbiBtYWtlX2RpcnR5KGNvbXBvbmVudCwga2V5KSB7XG5cdGlmICghY29tcG9uZW50LiQkLmRpcnR5KSB7XG5cdFx0ZGlydHlfY29tcG9uZW50cy5wdXNoKGNvbXBvbmVudCk7XG5cdFx0c2NoZWR1bGVfdXBkYXRlKCk7XG5cdFx0Y29tcG9uZW50LiQkLmRpcnR5ID0ge307XG5cdH1cblx0Y29tcG9uZW50LiQkLmRpcnR5W2tleV0gPSB0cnVlO1xufVxuXG5mdW5jdGlvbiBpbml0KGNvbXBvbmVudCwgb3B0aW9ucywgaW5zdGFuY2UsIGNyZWF0ZV9mcmFnbWVudCwgbm90X2VxdWFsJCQxLCBwcm9wX25hbWVzKSB7XG5cdGNvbnN0IHBhcmVudF9jb21wb25lbnQgPSBjdXJyZW50X2NvbXBvbmVudDtcblx0c2V0X2N1cnJlbnRfY29tcG9uZW50KGNvbXBvbmVudCk7XG5cblx0Y29uc3QgcHJvcHMgPSBvcHRpb25zLnByb3BzIHx8IHt9O1xuXG5cdGNvbnN0ICQkID0gY29tcG9uZW50LiQkID0ge1xuXHRcdGZyYWdtZW50OiBudWxsLFxuXHRcdGN0eDogbnVsbCxcblxuXHRcdC8vIHN0YXRlXG5cdFx0cHJvcHM6IHByb3BfbmFtZXMsXG5cdFx0dXBkYXRlOiBub29wLFxuXHRcdG5vdF9lcXVhbDogbm90X2VxdWFsJCQxLFxuXHRcdGJvdW5kOiBibGFua19vYmplY3QoKSxcblxuXHRcdC8vIGxpZmVjeWNsZVxuXHRcdG9uX21vdW50OiBbXSxcblx0XHRvbl9kZXN0cm95OiBbXSxcblx0XHRiZWZvcmVfcmVuZGVyOiBbXSxcblx0XHRhZnRlcl9yZW5kZXI6IFtdLFxuXHRcdGNvbnRleHQ6IG5ldyBNYXAocGFyZW50X2NvbXBvbmVudCA/IHBhcmVudF9jb21wb25lbnQuJCQuY29udGV4dCA6IFtdKSxcblxuXHRcdC8vIGV2ZXJ5dGhpbmcgZWxzZVxuXHRcdGNhbGxiYWNrczogYmxhbmtfb2JqZWN0KCksXG5cdFx0ZGlydHk6IG51bGxcblx0fTtcblxuXHRsZXQgcmVhZHkgPSBmYWxzZTtcblxuXHQkJC5jdHggPSBpbnN0YW5jZVxuXHRcdD8gaW5zdGFuY2UoY29tcG9uZW50LCBwcm9wcywgKGtleSwgdmFsdWUpID0+IHtcblx0XHRcdGlmICgkJC5jdHggJiYgbm90X2VxdWFsJCQxKCQkLmN0eFtrZXldLCAkJC5jdHhba2V5XSA9IHZhbHVlKSkge1xuXHRcdFx0XHRpZiAoJCQuYm91bmRba2V5XSkgJCQuYm91bmRba2V5XSh2YWx1ZSk7XG5cdFx0XHRcdGlmIChyZWFkeSkgbWFrZV9kaXJ0eShjb21wb25lbnQsIGtleSk7XG5cdFx0XHR9XG5cdFx0fSlcblx0XHQ6IHByb3BzO1xuXG5cdCQkLnVwZGF0ZSgpO1xuXHRyZWFkeSA9IHRydWU7XG5cdHJ1bl9hbGwoJCQuYmVmb3JlX3JlbmRlcik7XG5cdCQkLmZyYWdtZW50ID0gY3JlYXRlX2ZyYWdtZW50KCQkLmN0eCk7XG5cblx0aWYgKG9wdGlvbnMudGFyZ2V0KSB7XG5cdFx0aWYgKG9wdGlvbnMuaHlkcmF0ZSkge1xuXHRcdFx0JCQuZnJhZ21lbnQubChjaGlsZHJlbihvcHRpb25zLnRhcmdldCkpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHQkJC5mcmFnbWVudC5jKCk7XG5cdFx0fVxuXG5cdFx0aWYgKG9wdGlvbnMuaW50cm8gJiYgY29tcG9uZW50LiQkLmZyYWdtZW50LmkpIGNvbXBvbmVudC4kJC5mcmFnbWVudC5pKCk7XG5cdFx0bW91bnRfY29tcG9uZW50KGNvbXBvbmVudCwgb3B0aW9ucy50YXJnZXQsIG9wdGlvbnMuYW5jaG9yKTtcblx0XHRmbHVzaCgpO1xuXHR9XG5cblx0c2V0X2N1cnJlbnRfY29tcG9uZW50KHBhcmVudF9jb21wb25lbnQpO1xufVxuXG5sZXQgU3ZlbHRlRWxlbWVudDtcbmlmICh0eXBlb2YgSFRNTEVsZW1lbnQgIT09ICd1bmRlZmluZWQnKSB7XG5cdFN2ZWx0ZUVsZW1lbnQgPSBjbGFzcyBleHRlbmRzIEhUTUxFbGVtZW50IHtcblx0XHRjb25zdHJ1Y3RvcigpIHtcblx0XHRcdHN1cGVyKCk7XG5cdFx0XHR0aGlzLmF0dGFjaFNoYWRvdyh7IG1vZGU6ICdvcGVuJyB9KTtcblx0XHR9XG5cblx0XHRjb25uZWN0ZWRDYWxsYmFjaygpIHtcblx0XHRcdGZvciAoY29uc3Qga2V5IGluIHRoaXMuJCQuc2xvdHRlZCkge1xuXHRcdFx0XHR0aGlzLmFwcGVuZENoaWxkKHRoaXMuJCQuc2xvdHRlZFtrZXldKTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRhdHRyaWJ1dGVDaGFuZ2VkQ2FsbGJhY2soYXR0ciQkMSwgb2xkVmFsdWUsIG5ld1ZhbHVlKSB7XG5cdFx0XHR0aGlzW2F0dHIkJDFdID0gbmV3VmFsdWU7XG5cdFx0fVxuXG5cdFx0JGRlc3Ryb3koKSB7XG5cdFx0XHRkZXN0cm95KHRoaXMsIHRydWUpO1xuXHRcdFx0dGhpcy4kZGVzdHJveSA9IG5vb3A7XG5cdFx0fVxuXG5cdFx0JG9uKHR5cGUsIGNhbGxiYWNrKSB7XG5cdFx0XHQvLyBUT0RPIHNob3VsZCB0aGlzIGRlbGVnYXRlIHRvIGFkZEV2ZW50TGlzdGVuZXI/XG5cdFx0XHRjb25zdCBjYWxsYmFja3MgPSAodGhpcy4kJC5jYWxsYmFja3NbdHlwZV0gfHwgKHRoaXMuJCQuY2FsbGJhY2tzW3R5cGVdID0gW10pKTtcblx0XHRcdGNhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKTtcblxuXHRcdFx0cmV0dXJuICgpID0+IHtcblx0XHRcdFx0Y29uc3QgaW5kZXggPSBjYWxsYmFja3MuaW5kZXhPZihjYWxsYmFjayk7XG5cdFx0XHRcdGlmIChpbmRleCAhPT0gLTEpIGNhbGxiYWNrcy5zcGxpY2UoaW5kZXgsIDEpO1xuXHRcdFx0fTtcblx0XHR9XG5cblx0XHQkc2V0KCkge1xuXHRcdFx0Ly8gb3ZlcnJpZGRlbiBieSBpbnN0YW5jZSwgaWYgaXQgaGFzIHByb3BzXG5cdFx0fVxuXHR9O1xufVxuXG5jbGFzcyBTdmVsdGVDb21wb25lbnQge1xuXHQkZGVzdHJveSgpIHtcblx0XHRkZXN0cm95KHRoaXMsIHRydWUpO1xuXHRcdHRoaXMuJGRlc3Ryb3kgPSBub29wO1xuXHR9XG5cblx0JG9uKHR5cGUsIGNhbGxiYWNrKSB7XG5cdFx0Y29uc3QgY2FsbGJhY2tzID0gKHRoaXMuJCQuY2FsbGJhY2tzW3R5cGVdIHx8ICh0aGlzLiQkLmNhbGxiYWNrc1t0eXBlXSA9IFtdKSk7XG5cdFx0Y2FsbGJhY2tzLnB1c2goY2FsbGJhY2spO1xuXG5cdFx0cmV0dXJuICgpID0+IHtcblx0XHRcdGNvbnN0IGluZGV4ID0gY2FsbGJhY2tzLmluZGV4T2YoY2FsbGJhY2spO1xuXHRcdFx0aWYgKGluZGV4ICE9PSAtMSkgY2FsbGJhY2tzLnNwbGljZShpbmRleCwgMSk7XG5cdFx0fTtcblx0fVxuXG5cdCRzZXQoKSB7XG5cdFx0Ly8gb3ZlcnJpZGRlbiBieSBpbnN0YW5jZSwgaWYgaXQgaGFzIHByb3BzXG5cdH1cbn1cblxuY2xhc3MgU3ZlbHRlQ29tcG9uZW50RGV2IGV4dGVuZHMgU3ZlbHRlQ29tcG9uZW50IHtcblx0Y29uc3RydWN0b3Iob3B0aW9ucykge1xuXHRcdGlmICghb3B0aW9ucyB8fCAoIW9wdGlvbnMudGFyZ2V0ICYmICFvcHRpb25zLiQkaW5saW5lKSkge1xuXHRcdFx0dGhyb3cgbmV3IEVycm9yKGAndGFyZ2V0JyBpcyBhIHJlcXVpcmVkIG9wdGlvbmApO1xuXHRcdH1cblxuXHRcdHN1cGVyKCk7XG5cdH1cblxuXHQkZGVzdHJveSgpIHtcblx0XHRzdXBlci4kZGVzdHJveSgpO1xuXHRcdHRoaXMuJGRlc3Ryb3kgPSAoKSA9PiB7XG5cdFx0XHRjb25zb2xlLndhcm4oYENvbXBvbmVudCB3YXMgYWxyZWFkeSBkZXN0cm95ZWRgKTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1jb25zb2xlXG5cdFx0fTtcblx0fVxufVxuXG5leHBvcnQgeyBjcmVhdGVfYW5pbWF0aW9uLCBmaXhfcG9zaXRpb24sIGhhbmRsZV9wcm9taXNlLCBhcHBlbmQsIGluc2VydCwgZGV0YWNoLCBkZXRhY2hfYmV0d2VlbiwgZGV0YWNoX2JlZm9yZSwgZGV0YWNoX2FmdGVyLCBkZXN0cm95X2VhY2gsIGVsZW1lbnQsIHN2Z19lbGVtZW50LCB0ZXh0LCBzcGFjZSwgZW1wdHksIGxpc3RlbiwgcHJldmVudF9kZWZhdWx0LCBzdG9wX3Byb3BhZ2F0aW9uLCBhdHRyLCBzZXRfYXR0cmlidXRlcywgc2V0X2N1c3RvbV9lbGVtZW50X2RhdGEsIHhsaW5rX2F0dHIsIGdldF9iaW5kaW5nX2dyb3VwX3ZhbHVlLCB0b19udW1iZXIsIHRpbWVfcmFuZ2VzX3RvX2FycmF5LCBjaGlsZHJlbiwgY2xhaW1fZWxlbWVudCwgY2xhaW1fdGV4dCwgc2V0X2RhdGEsIHNldF9pbnB1dF90eXBlLCBzZXRfc3R5bGUsIHNlbGVjdF9vcHRpb24sIHNlbGVjdF9vcHRpb25zLCBzZWxlY3RfdmFsdWUsIHNlbGVjdF9tdWx0aXBsZV92YWx1ZSwgYWRkX3Jlc2l6ZV9saXN0ZW5lciwgdG9nZ2xlX2NsYXNzLCBjdXN0b21fZXZlbnQsIGRlc3Ryb3lfYmxvY2ssIG91dHJvX2FuZF9kZXN0cm95X2Jsb2NrLCBmaXhfYW5kX291dHJvX2FuZF9kZXN0cm95X2Jsb2NrLCB1cGRhdGVfa2V5ZWRfZWFjaCwgbWVhc3VyZSwgY3VycmVudF9jb21wb25lbnQsIHNldF9jdXJyZW50X2NvbXBvbmVudCwgYmVmb3JlVXBkYXRlLCBvbk1vdW50LCBhZnRlclVwZGF0ZSwgb25EZXN0cm95LCBjcmVhdGVFdmVudERpc3BhdGNoZXIsIHNldENvbnRleHQsIGdldENvbnRleHQsIGJ1YmJsZSwgY2xlYXJfbG9vcHMsIGxvb3AsIGRpcnR5X2NvbXBvbmVudHMsIGludHJvcywgc2NoZWR1bGVfdXBkYXRlLCB0aWNrLCBhZGRfYmluZGluZ19jYWxsYmFjaywgYWRkX3JlbmRlcl9jYWxsYmFjaywgYWRkX2ZsdXNoX2NhbGxiYWNrLCBmbHVzaCwgZ2V0X3NwcmVhZF91cGRhdGUsIGludmFsaWRfYXR0cmlidXRlX25hbWVfY2hhcmFjdGVyLCBzcHJlYWQsIGVzY2FwZWQsIGVzY2FwZSwgZWFjaCwgbWlzc2luZ19jb21wb25lbnQsIHZhbGlkYXRlX2NvbXBvbmVudCwgZGVidWcsIGNyZWF0ZV9zc3JfY29tcG9uZW50LCBnZXRfc3RvcmVfdmFsdWUsIGdyb3VwX291dHJvcywgY2hlY2tfb3V0cm9zLCBvbl9vdXRybywgY3JlYXRlX2luX3RyYW5zaXRpb24sIGNyZWF0ZV9vdXRfdHJhbnNpdGlvbiwgY3JlYXRlX2JpZGlyZWN0aW9uYWxfdHJhbnNpdGlvbiwgbm9vcCwgaWRlbnRpdHksIGFzc2lnbiwgaXNfcHJvbWlzZSwgYWRkX2xvY2F0aW9uLCBydW4sIGJsYW5rX29iamVjdCwgcnVuX2FsbCwgaXNfZnVuY3Rpb24sIHNhZmVfbm90X2VxdWFsLCBub3RfZXF1YWwsIHZhbGlkYXRlX3N0b3JlLCBzdWJzY3JpYmUsIGNyZWF0ZV9zbG90LCBnZXRfc2xvdF9jb250ZXh0LCBnZXRfc2xvdF9jaGFuZ2VzLCBleGNsdWRlX2ludGVybmFsX3Byb3BzLCBiaW5kLCBtb3VudF9jb21wb25lbnQsIGluaXQsIFN2ZWx0ZUVsZW1lbnQsIFN2ZWx0ZUNvbXBvbmVudCwgU3ZlbHRlQ29tcG9uZW50RGV2IH07XG4iLCIvLyBwYXRoIHRvIHdoZXJlIHRoZSBpbWFnZXMgYXJlIGRvd25sb2FkZWRcclxuLy9jb25zdCBDQVJEX0RBVEEgPSByZXF1aXJlKFwiLi9zY3J5ZmFsbC1kZWZhdWx0LWNhcmRzLmpzb25cIik7XHJcblxyXG5cclxuLy9jb25zdCBmcyA9IHJlcXVpcmUoXCJmc1wiKTtcclxuXHJcbmNvbnN0IE9iamVjdElkID0gKCkgPT4geyByZXR1cm4gRGF0ZS5ub3coKSB9OyAvLyByZXF1aXJlKFwiYnNvbi1vYmplY3RpZFwiKTtcclxuXHJcblxyXG5jb25zdCBURU1QID0gXCJ0ZW1wXCI7XHJcbmNvbnN0IF9fZGlybmFtZSA9IFwiLi9cIjtcclxuXHJcbmZ1bmN0aW9uIHRpbWVvdXQoKSB7XHJcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICByZXNvbHZlKCk7XHJcbiAgICB9LCA3MCk7XHJcbiAgfSk7XHJcbn1cclxuXHJcblxyXG5cclxuXHJcbi8qXHJcblxyXG4qL1xyXG5cclxuXHJcbmNsYXNzIE10Z0ludGVyZmFjZSB7XHJcblxyXG4gIGNvbnN0cnVjdG9yKGlwY1JlbmRlcmVyKSB7XHJcbiAgICB0aGlzLl9fY2FjaGUgPSB7fTtcclxuICAgIHRoaXMuaXBjUmVuZGVyZXIgPSBpcGNSZW5kZXJlcjtcclxuICAgIHRoaXMuZG93bmxvYWRzID0gUHJvbWlzZS5yZXNvbHZlKCk7XHJcbiAgICB0aGlzLmZldGNoZXMgPSBQcm9taXNlLnJlc29sdmUoKTtcclxuXHJcblxyXG4gICAgdGhpcy5sb2FkUHJvbXMgPSB7fTtcclxuICAgIHRoaXMuZXhpc3RQcm9tcyA9IHt9O1xyXG5cclxuICAgIGlwY1JlbmRlcmVyLm9uKFwiZmlsZUxvYWRlZFwiLCAoc2VuZGVyLCBkYXRhKSA9PiB7XHJcbiAgICAgIGNvbnN0IGMgPSB0aGlzLmxvYWRQcm9tc1tkYXRhLmlkXTtcclxuICAgICAgaWYgKCFjKSByZXR1cm47XHJcbiAgICAgIGlmIChkYXRhLmVycm9yKSBjLnJlamVjdChkYXRhLmVycm9yKTtcclxuICAgICAgZWxzZSBjLnJlc29sdmUoSlNPTi5wYXJzZShkYXRhLnJlc3VsdCB8fCBcInt9XCIpKVxyXG4gICAgICBkZWxldGUgdGhpcy5sb2FkUHJvbXNbZGF0YS5pZF07XHJcbiAgICB9KTtcclxuXHJcbiAgICBpcGNSZW5kZXJlci5vbihcImZpbGVDaGVja2VkXCIsIChzZW5kZXIsIGRhdGEpID0+IHtcclxuICAgICAgY29uc3QgYyA9IHRoaXMuZXhpc3RQcm9tc1tkYXRhLmlkXTtcclxuICAgICAgaWYgKCFjKSByZXR1cm47XHJcbiAgICAgIGlmIChkYXRhLmVycm9yKSBjLnJlc29sdmUoZmFsc2UpOyAvL2MucmVqZWN0KGRhdGEuZXJyb3IpO1xyXG4gICAgICBlbHNlIGMucmVzb2x2ZSh0cnVlKVxyXG4gICAgICBkZWxldGUgdGhpcy5leGlzdFByb21zW2RhdGEuaWRdO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuXHJcbiAgZG9lc0ZpbGVFeGlzdChwYXRoKSB7XHJcbiAgICBjb25zdCBpZCA9IE9iamVjdElkKCkudG9TdHJpbmcoKTtcclxuICAgIGNvbnN0IHAgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcblxyXG4gICAgICB0aGlzLmlwY1JlbmRlcmVyLnNlbmQoXCJjaGVja0ZpbGVcIiwgeyBwYXRoLCBpZCB9KTtcclxuICAgICAgdGhpcy5leGlzdFByb21zW2lkXSA9IHsgcmVzb2x2ZSwgcmVqZWN0IH07XHJcbiAgICB9KTtcclxuICAgIHJldHVybiBwO1xyXG4gIH1cclxuXHJcbiAgc2F2ZUZpbGUocGF0aCwgY29udGVudCkge1xyXG4gICAgY29uc3QgaWQgPSBPYmplY3RJZCgpLnRvU3RyaW5nKCk7XHJcbiAgICBjb250ZW50ID0gSlNPTi5zdHJpbmdpZnkoY29udGVudCk7XHJcbiAgICB0aGlzLmlwY1JlbmRlcmVyLnNlbmQoXCJzYXZlRmlsZVwiLCB7IHBhdGgsIGNvbnRlbnQsIGlkIH0pO1xyXG5cclxuICAgIC8qICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICAgIGZzLndyaXRlRmlsZShmaWxlLCBjb250ZW50LCBmdW5jdGlvbihlcnIpIHtcclxuICAgICAgICAgIGlmIChlcnIpIHJldHVybiByZWplY3QoZXJyKTtcclxuICAgICAgICAgIHJlc29sdmUoKTtcclxuICAgICAgICB9KTtcclxuICAgICAgfSk7Ki9cclxuICB9XHJcblxyXG4gIGxvYWRGaWxlKHBhdGgpIHtcclxuICAgIGNvbnN0IGlkID0gT2JqZWN0SWQoKS50b1N0cmluZygpO1xyXG4gICAgY29uc3QgcCA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgdGhpcy5pcGNSZW5kZXJlci5zZW5kKFwibG9hZEZpbGVcIiwgeyBwYXRoLCBpZCB9KTtcclxuICAgICAgdGhpcy5sb2FkUHJvbXNbaWRdID0geyByZXNvbHZlLCByZWplY3QgfTtcclxuICAgIH0pO1xyXG4gICAgcmV0dXJuIHA7XHJcbiAgfVxyXG5cclxuXHJcbiAgc2VhcmNoKG9wdHMgPSB7fSkge1xyXG4gICAgLy8gaHR0cHM6Ly9hcGkuc2NyeWZhbGwuY29tL2NhcmRzL3NlYXJjaD9vcmRlcj1jbWMmcT1jJTNBcmVkK3BvdyUzRDMgXHJcbiAgICAvLyBodHRwczovL3NjcnlmYWxsLmNvbS9zZWFyY2g/YXM9Z3JpZCZvcmRlcj1uYW1lJnE9bXlyK29yYWNsZSUzQXRva2VuK3R5cGUlM0FjcmVhdHVyZStjb21tYW5kZXIlM0FXVUJSR1xyXG5cclxuICAgIGxldCBiYXNldXJsO1xyXG5cclxuICAgIGlmICh0eXBlb2Ygb3B0cyAhPSBcInN0cmluZ1wiKSB7XHJcbiAgICAgIGJhc2V1cmwgPSBgaHR0cHM6Ly9hcGkuc2NyeWZhbGwuY29tL2NhcmRzL3NlYXJjaD8ke29wdHMucGFnZT9cInBhZ2U9XCIrb3B0cy5wYWdlK1wiJlwiOlwiXCJ9b3JkZXI9Y21jJnE9YDtcclxuICAgICAgY29uc3QgcXVlcmllcyA9IFtdO1xyXG5cclxuICAgICAgaWYgKG9wdHMubmFtZSkge1xyXG4gICAgICAgIHF1ZXJpZXMucHVzaChvcHRzLm5hbWUpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAob3B0cy5lZGhjb2xvcnMgJiYgb3B0cy5lZGhjb2xvcnMuc2l6ZSkge1xyXG4gICAgICAgIGxldCBjcyA9IFwiXCI7XHJcbiAgICAgICAgZm9yIChsZXQgY29sb3Igb2Ygb3B0cy5lZGhjb2xvcnMpIHtcclxuICAgICAgICAgIGNvbG9yID0gY29sb3IudG9VcHBlckNhc2UoKTtcclxuICAgICAgICAgIGlmIChjb2xvciA9PT0gXCJDXCIpIHtcclxuICAgICAgICAgICAgY3MgPSBcIkNcIjtcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBjcyArPSBjb2xvcjtcclxuICAgICAgICB9XHJcbiAgICAgICAgcXVlcmllcy5wdXNoKFwiY29tbWFuZGVyJTNBXCIgKyBjcyk7XHJcbiAgICAgIH1cclxuXHJcblxyXG4gICAgICBpZiAob3B0cy50eXBlKSB7XHJcbiAgICAgICAgbGV0IHR5cGUgPSBvcHRzLnR5cGUudHJpbSgpLnJlcGxhY2UoL1xcc1xccysvZ20sIFwiIFwiKS5yZXBsYWNlKC9cXHMvZ20sIFwiK3R5cGUlM0FcIik7XHJcbiAgICAgICAgcXVlcmllcy5wdXNoKFwidHlwZSUzQVwiICsgdHlwZSk7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKG9wdHMudGV4dCkge1xyXG4gICAgICAgIGxldCB0ZXh0ID0gb3B0cy50ZXh0LnRyaW0oKS5yZXBsYWNlKC9cXHNcXHMrL2dtLCBcIiBcIikucmVwbGFjZSgvXFxzKy9nbSwgXCIrb3JhY2xlJTNBXCIpO1xyXG4gICAgICAgIHF1ZXJpZXMucHVzaChcIm9yYWNsZSUzQVwiICsgdGV4dCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGJhc2V1cmwgPSBiYXNldXJsICsgcXVlcmllcy5qb2luKFwiK1wiKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGJhc2V1cmwgPSBvcHRzO1xyXG4gICAgfVxyXG4gICAgY29uc29sZS5sb2coXCJzZWFyY2hxdWVyeVwiLCBiYXNldXJsKTtcclxuICAgIHJldHVybiBmZXRjaChiYXNldXJsKVxyXG4gICAgICAudGhlbihhc3luYyByZXNwb25zZSA9PiB7XHJcbiAgICAgICAgY29uc3QgYSA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKTtcclxuICAgICAgICByZXR1cm4gYTtcclxuICAgICAgfSlcclxuICAgICAgLnRoZW4ocmVzcG9uc2UgPT4ge1xyXG4gICAgICAgIGZvciAobGV0IGMgb2YgcmVzcG9uc2UuZGF0YSkge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coXCJjXCIsIGMpO1xyXG4gICAgICAgICAgaWYgKCFjLmltYWdlX3VyaXMpIHtcclxuICAgICAgICAgICAgaWYgKGMuY2FyZF9mYWNlcykge1xyXG4gICAgICAgICAgICAgIGMuaW1hZ2VfdXJpcyA9IGMuY2FyZF9mYWNlc1swXS5pbWFnZV91cmlzO1xyXG4gICAgICAgICAgICAgIGNvbnN0IGJpdSA9IGMuY2FyZF9mYWNlc1sxXS5pbWFnZV91cmlzO1xyXG4gICAgICAgICAgICAgIGMuYmFja3NpZGUgPSBiaXUgPyBiaXUuYm9yZGVyX2Nyb3AgfHwgYml1Lm5vcm1hbCA6IFwiXCI7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGMudXJsID0gYyA/IGMuaW1hZ2VfdXJpcy5ib3JkZXJfY3JvcCB8fCBjLmltYWdlX3VyaXMubm9ybWFsIDogXCJcIjtcclxuICAgICAgICAgIGMuY2FyZG1hcmtldCA9IChjLnB1cmNoYXNlX3VyaXMgfHwge30pLmNhcmRtYXJrZXQgfHwgXCJcIjtcclxuICAgICAgICAgIHRoaXMuX19jYWNoZVtjLm5hbWVdID0gYztcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHJlc3BvbnNlO1xyXG4gICAgICB9KVxyXG4gICAgICAuY2F0Y2goZSA9PiB7IGNvbnNvbGUubG9nKGUpOyByZXR1cm4geyBjb2RlOiBcIm5vdF9mb3VuZFwiLCBkYXRhOiBbXSB9OyB9KTtcclxuXHJcbiAgfVxyXG5cclxuICBhc3luYyBjYXJkQnlOYW1lKG5hbWUpIHtcclxuICAgIGlmICh0aGlzLl9fY2FjaGVbbmFtZV0pIHJldHVybiB0aGlzLl9fY2FjaGVbbmFtZV07XHJcblxyXG4gICAgY29uc3QgcCA9IG5hbWU7IC8vcGF0aC5qb2luKF9fZGlybmFtZSwgVEVNUCwgbmFtZSk7XHJcbiAgICBjb25zdCBleGlzdHMgPSBhd2FpdCB0aGlzLmRvZXNGaWxlRXhpc3QocCk7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgaWYgKGV4aXN0cykge1xyXG4gICAgICAgIHRoaXMuX19jYWNoZVtuYW1lXSA9IGF3YWl0IHRoaXMubG9hZEZpbGUocCk7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX19jYWNoZVtuYW1lXTtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKFwiY291bGQgbm90IGxvYWQgbG9jYWwgZmlsZVwiLCBuYW1lLCBlLm1lc3NhZ2UpO1xyXG4gICAgfVxyXG5cclxuXHJcbiAgICBhd2FpdCB0aW1lb3V0KCk7XHJcbiAgICAvL2h0dHBzOi8vYXBpLnNjcnlmYWxsLmNvbS9jYXJkcy9uYW1lZD9mdXp6eT1hdXN0K2NvbSBcclxuICAgIGNvbnN0IGZpeGVkID0gbmFtZS5yZXBsYWNlKC9cXHMvZywgXCIrXCIpO1xyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZmV0Y2goJ2h0dHBzOi8vYXBpLnNjcnlmYWxsLmNvbS9jYXJkcy9uYW1lZD9mdXp6eT0nICsgZml4ZWQpXHJcbiAgICAgIC50aGVuKHJlc3BvbnNlID0+IHJlc3BvbnNlLmpzb24oKSkuY2F0Y2goZSA9PiB7IGNvbnNvbGUubG9nKGUpOyByZXR1cm4geyBjb2RlOiBcIm5vdF9mb3VuZFwiIH07IH0pO1xyXG5cclxuICAgIHRoaXMuX19jYWNoZVtuYW1lXSA9IHJlc3VsdDtcclxuICAgIHRoaXMuX19jYWNoZVtyZXN1bHQubmFtZV0gPSByZXN1bHQ7XHJcbiAgICB0aGlzLnNhdmVGaWxlKG5hbWUsIHRoaXMuX19jYWNoZVtuYW1lXSk7XHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgLy8gLnRoZW4oZGF0YSA9PiBjb25zb2xlLmxvZyhkYXRhKSk7XHJcbiAgICAvKiBmb3IgKGxldCBjYXJkIG9mIENBUkRfREFUQSkge1xyXG4gICAgICAgaWYgKGNhcmQubmFtZS50b0xvd2VyQ2FzZSgpID09IG5hbWUudG9Mb3dlckNhc2UoKSkgcmV0dXJuIGNhcmQ7XHJcbiAgICAgfSovXHJcbiAgfVxyXG5cclxuICBhc3luYyBzb3J0KGRlY2tTdHJpbmcsIHVwZGF0ZSA9ICgpID0+IHt9KSB7XHJcbiAgICBkZWNrU3RyaW5nID0gZGVja1N0cmluZy5yZXBsYWNlKC8jLiovZ20sIFwiXCIpO1xyXG4gICAgY29uc3QgZGVja1JhdyA9IGRlY2tTdHJpbmcudHJpbSgpLnJlcGxhY2UoL1xcKCguKj8pXFwpfChbMC05XSpcXG4pL2csIFwiXFxuXCIpLnJlcGxhY2UoL1xccypcXG4rXFxzKlxcbisvZywgXCJcXG5cIikuc3BsaXQoXCJcXG5cIik7XHJcblxyXG4gICAgbGV0IGNyZWF0dXJlcyA9IHt9O1xyXG4gICAgbGV0IHNwZWxscyA9IHt9O1xyXG4gICAgbGV0IGxhbmRzID0ge307XHJcbiAgICBsZXQgbWF5YmUgPSBbXTtcclxuICAgIGNvbnN0IGVycm9ycyA9IFtdO1xyXG5cclxuXHJcbiAgICBsZXQgcHJvZ3Jlc3MgPSAwO1xyXG4gICAgZm9yIChsZXQgY2FyZCBvZiBkZWNrUmF3KSB7XHJcblxyXG4gICAgICBsZXQgY291bnQgPSBNYXRoLmZsb29yKCgoY2FyZC5tYXRjaCgvKFxcZCspLykgfHwgW10pWzBdIHx8IDEpKTtcclxuICAgICAgaWYgKGlzTmFOKGNvdW50KSkge1xyXG4gICAgICAgIGNvdW50ID0gMTtcclxuICAgICAgfVxyXG4gICAgICBwcm9ncmVzcysrO1xyXG5cclxuICAgICAgaWYgKGNhcmQudHJpbSgpLnN0YXJ0c1dpdGgoXCIvL1wiKSkge1xyXG4gICAgICAgIG1heWJlLnB1c2goY2FyZC50cmltKCkpO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgbmFtZSA9IGNhcmQucmVwbGFjZSgvKFxcZCspLywgXCJcIikudHJpbSgpO1xyXG4gICAgICBpZiAoIW5hbWUpIGNvbnRpbnVlOyAvLyBjYW50IHdvcmsgd2l0aCB0aGlzIGRhdGFcclxuICAgICAgLy8gc2VhcmNoIHRoZSBhY2NvcmRpbmcgZGF0YVxyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGxldCBkYXRhID0gYXdhaXQgdGhpcy5jYXJkQnlOYW1lKG5hbWUpO1xyXG5cclxuICAgICAgICBpZiAoZGF0YS50eXBlX2xpbmUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhcImxhbmRcIikpIHtcclxuICAgICAgICAgIGxhbmRzW2RhdGEubmFtZV0gPSBsYW5kc1tkYXRhLm5hbWVdIHx8IHsgZGF0YSwgY291bnQ6IDAsIG5hbWU6IGRhdGEubmFtZSB9O1xyXG4gICAgICAgICAgbGFuZHNbZGF0YS5uYW1lXS5jb3VudCsrO1xyXG4gICAgICAgIH0gZWxzZSBpZiAoZGF0YS50eXBlX2xpbmUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhcImNyZWF0dXJlXCIpKSB7XHJcbiAgICAgICAgICBjcmVhdHVyZXNbZGF0YS5uYW1lXSA9IGNyZWF0dXJlc1tkYXRhLm5hbWVdIHx8IHsgZGF0YSwgY291bnQ6IDAsIG5hbWU6IGRhdGEubmFtZSB9O1xyXG4gICAgICAgICAgY3JlYXR1cmVzW2RhdGEubmFtZV0uY291bnQrKztcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgc3BlbGxzW2RhdGEubmFtZV0gPSBzcGVsbHNbZGF0YS5uYW1lXSB8fCB7IGRhdGEsIGNvdW50OiAwLCBuYW1lOiBkYXRhLm5hbWUgfTtcclxuICAgICAgICAgIHNwZWxsc1tkYXRhLm5hbWVdLmNvdW50Kys7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGVycm9ycy5wdXNoKG5hbWUpO1xyXG4gICAgICB9XHJcbiAgICAgIHVwZGF0ZShwcm9ncmVzcywgZGVja1Jhdy5sZW5ndGgpO1xyXG4gICAgfVxyXG5cclxuICAgIGNyZWF0dXJlcyA9IE9iamVjdC52YWx1ZXMoY3JlYXR1cmVzKS5zb3J0KChhLCBiKSA9PiBhLmRhdGEuY21jID4gYi5kYXRhLmNtYyA/IDEgOiAtMSk7XHJcbiAgICBzcGVsbHMgPSBPYmplY3QudmFsdWVzKHNwZWxscykuc29ydCgoYSwgYikgPT4gYS5kYXRhLmNtYyA+IGIuZGF0YS5jbWMgPyAxIDogLTEpO1xyXG4gICAgbGFuZHMgPSBPYmplY3QudmFsdWVzKGxhbmRzKS5zb3J0KChhLCBiKSA9PiBhLm5hbWUgPiBiLm5hbWUgPyAxIDogLTEpO1xyXG4gICAgbGV0IG91dHB1dCA9IFwiIyBDcmVhdHVyZXNcIjtcclxuICAgIGZvciAobGV0IGN1ciBvZiBjcmVhdHVyZXMpIHtcclxuICAgICAgb3V0cHV0ICs9IFwiXFxuXCIgKyBjdXIuY291bnQgKyBcIiBcIiArIGN1ci5uYW1lO1xyXG4gICAgfVxyXG4gICAgb3V0cHV0ICs9IFwiXFxuXFxuIyBTcGVsbHNcIjtcclxuICAgIGZvciAobGV0IGN1ciBvZiBzcGVsbHMpIHtcclxuICAgICAgb3V0cHV0ICs9IFwiXFxuXCIgKyBjdXIuY291bnQgKyBcIiBcIiArIGN1ci5uYW1lO1xyXG4gICAgfVxyXG5cclxuICAgIG91dHB1dCArPSBcIlxcblxcbiMgTGFuZHNcIlxyXG4gICAgZm9yIChsZXQgY3VyIG9mIGxhbmRzKSB7XHJcbiAgICAgIG91dHB1dCArPSBcIlxcblwiICsgY3VyLmNvdW50ICsgXCIgXCIgKyBjdXIubmFtZTtcclxuICAgIH1cclxuXHJcbiAgICBvdXRwdXQgKz0gXCJcXG5cXG4jIE1heWJlXCJcclxuICAgIGZvciAobGV0IGN1ciBvZiBtYXliZSkge1xyXG4gICAgICBvdXRwdXQgKz0gXCJcXG4vL1wiICsgY3VyO1xyXG4gICAgfVxyXG5cclxuICAgIG91dHB1dCArPSBcIlxcblxcbiMgTm90IEZvdW5kXCJcclxuICAgIGZvciAobGV0IGN1ciBvZiBlcnJvcnMpIHtcclxuICAgICAgb3V0cHV0ICs9IFwiXFxuLy9cIiArIGN1ci5jb3VudCArIFwiIFwiICsgY3VyLm5hbWU7XHJcbiAgICB9XHJcblxyXG5cclxuICAgIHJldHVybiBvdXRwdXQ7XHJcbiAgfVxyXG5cclxuXHJcbiAgLyoqXHJcbiAgICogY29udmVydHMgYSBkZWNrIHN0cmluZyB0byBhIHJlYWRhYmxlIG9iamVjdFxyXG4gICAqIGFuZCBkb3dubG9hZHMgdGhlIGltZyBkYXRhIG9uIGRlbWFuZCwgaWYgaXQgZG9lcyBub3QgZXhpc3RcclxuICAgKlxyXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBkZWNrU3RyaW5nIHRoZSBjb21wbGV0ZSBkZWNrLCBjb3BpZWQgZnJvbSBhIHNpdGUgb3IgZS5nIGZvcmdlXHJcbiAgICogQG1lbWJlcm9mIE10Z0ludGVyZmFjZVxyXG4gICAqL1xyXG4gIGFzeW5jIGNyZWF0ZURlY2soZGVja1N0cmluZywgdXBkYXRlID0gKCkgPT4ge30sIHNvcnQgPSBmYWxzZSkge1xyXG4gICAgLy8gY29udmVydCB0aGUgZGVjayBzdHJpbmcgdG8gYW4gYXJyYXlcclxuXHJcblxyXG5cclxuXHJcblxyXG5cclxuXHJcbiAgICBsZXQgZ3JvdXBzID0gWy4uLmRlY2tTdHJpbmcubWF0Y2goLyMoLio/KShcXG58JCkvZykgfHwgW1wibWFpblwiXV07XHJcbiAgICBjb25zdCBkZWNrUmF3ID0gZGVja1N0cmluZy50cmltKCkucmVwbGFjZSgvXFwoKC4qPylcXCl8KFswLTldKlxcbikvZywgXCJcXG5cIikucmVwbGFjZSgvXFxzKlxcbitcXHMqXFxuKy9nLCBcIlxcblwiKS5zcGxpdChcIlxcblwiKTtcclxuICAgIGlmICghZGVja1JhdykgcmV0dXJuIFtdO1xyXG4gICAgaWYgKCFkZWNrUmF3WzBdLmluY2x1ZGVzKFwiI1wiKSkge1xyXG4gICAgICBpZiAoZ3JvdXBzWzBdICE9PSBcIm1haW5cIikge1xyXG4gICAgICAgIGdyb3VwcyA9IFtcIm1haW5cIl0uY29uY2F0KGdyb3Vwcyk7XHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGRlY2tSYXcuc2hpZnQoKTtcclxuICAgIH1cclxuXHJcblxyXG4gICAgZ3JvdXBzID0gZ3JvdXBzLm1hcCh2ID0+IHsgcmV0dXJuIHsgZGVjazoge30sIG5hbWU6IHYucmVwbGFjZShcIiNcIiwgXCJcIikudHJpbSgpIH0gfSk7XHJcblxyXG4gICAgbGV0IGN1ckdyb3VwID0gMDtcclxuXHJcbiAgICBsZXQgcHJvZ3Jlc3MgPSAwO1xyXG4gICAgbGV0IGlnbm9yZWQgPSAwO1xyXG4gICAgLy8gaXRlcmF0ZSBlYWNoIGZvdW5kIGNhcmRcclxuICAgIGZvciAobGV0IGNhcmQgb2YgZGVja1Jhdykge1xyXG4gICAgICBpZiAoIWNhcmQpIGNvbnRpbnVlO1xyXG4gICAgICBpZiAoY2FyZC50cmltKCkuc3RhcnRzV2l0aChcIi8vXCIpKSBjb250aW51ZTtcclxuICAgICAgaWYgKGNhcmQuaW5jbHVkZXMoXCIjXCIpKSB7XHJcbiAgICAgICAgY3VyR3JvdXArKztcclxuICAgICAgICBpZiAoY3VyR3JvdXAgPiBncm91cHMubGVuZ3RoKSBjdXJHcm91cCA9IDA7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuICAgICAgcHJvZ3Jlc3MrKztcclxuXHJcbiAgICAgIGNvbnN0IGRlY2sgPSBncm91cHNbY3VyR3JvdXBdLmRlY2s7XHJcbiAgICAgIHVwZGF0ZShwcm9ncmVzcywgZGVja1Jhdy5sZW5ndGggLSBncm91cHMubGVuZ3RoICsgMSAtIGlnbm9yZWQpO1xyXG4gICAgICAvLyBleHRyYWN0IHRoZSBjb3VudCBmcm9tIHRoZSBzdHJpbmcgYW5kIGZyZWUgdGhlIG5hbWVcclxuXHJcbiAgICAgIGxldCBjb3VudCA9IE1hdGguZmxvb3IoKChjYXJkLm1hdGNoKC8oXFxkKykvKSB8fCBbXSlbMF0gfHwgMSkpO1xyXG4gICAgICBpZiAoaXNOYU4oY291bnQpKSB7XHJcbiAgICAgICAgY291bnQgPSAxO1xyXG4gICAgICB9XHJcbiAgICAgIGNvbnN0IG5hbWUgPSBjYXJkLnJlcGxhY2UoLyhcXGQrKS8sIFwiXCIpLnRyaW0oKTtcclxuICAgICAgaWYgKCFuYW1lKSBjb250aW51ZTsgLy8gY2FudCB3b3JrIHdpdGggdGhpcyBkYXRhXHJcbiAgICAgIC8vIHNlYXJjaCB0aGUgYWNjb3JkaW5nIGRhdGFcclxuICAgICAgbGV0IGRhdGEgPSBhd2FpdCB0aGlzLmNhcmRCeU5hbWUobmFtZSk7XHJcblxyXG4gICAgICBpZiAoZGF0YS5uYW1lKVxyXG4gICAgICAgIGRlY2tTdHJpbmcgPSBkZWNrU3RyaW5nLnJlcGxhY2UobmFtZSwgZGF0YS5uYW1lKTtcclxuICAgICAgaWYgKGRhdGEuY29kZSA9PSBcIm5vdF9mb3VuZFwiKSB7XHJcbiAgICAgICAgZGF0YSA9IHtcclxuICAgICAgICAgIGltYWdlX3VyaXM6IHt9LFxyXG4gICAgICAgICAgbGVnYWxpdGllczoge30sXHJcbiAgICAgICAgICBwcmljZXM6IHsgdXNkOiAwIH0sXHJcbiAgICAgICAgICBtYW5hX2Nvc3Q6IFwiXCIsXHJcbiAgICAgICAgICBjbWM6IDAsXHJcbiAgICAgICAgICB0eXBlX2xpbmU6IFwibGFuZFwiLFxyXG4gICAgICAgICAgcHVyY2hhc2VfdXJpczogeyBjYXJkbWFya2V0OiBcIlwiIH1cclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChkZWNrW25hbWVdKSB7XHJcbiAgICAgICAgZGVja1tuYW1lXS5jb3VudCArPSBjb3VudDtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICAvLyB3cmFwIGRhdGEgaW4gZWFzeSByZWFkYWJsZSBmb3JtYXRcclxuICAgICAgICBsZXQgYmFja3NpZGUgPSBcIlwiO1xyXG4gICAgICAgIGlmICghZGF0YS5pbWFnZV91cmlzKSB7XHJcbiAgICAgICAgICBpZiAoZGF0YS5jYXJkX2ZhY2VzKSB7XHJcbiAgICAgICAgICAgIGRhdGEuaW1hZ2VfdXJpcyA9IGRhdGEuY2FyZF9mYWNlc1swXS5pbWFnZV91cmlzO1xyXG4gICAgICAgICAgICBjb25zdCBiaXUgPSBkYXRhLmNhcmRfZmFjZXNbMV0uaW1hZ2VfdXJpcztcclxuICAgICAgICAgICAgYmFja3NpZGUgPSBiaXUgPyBiaXUuYm9yZGVyX2Nyb3AgfHwgYml1Lm5vcm1hbCA6IFwiXCI7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhcImVyclwiLCBkYXRhKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHVybCA9IGRhdGEgPyBkYXRhLmltYWdlX3VyaXMuYm9yZGVyX2Nyb3AgfHwgZGF0YS5pbWFnZV91cmlzLm5vcm1hbCA6IFwiXCI7XHJcbiAgICAgICAgZGVja1tuYW1lXSA9IHtcclxuICAgICAgICAgIG5hbWUsXHJcbiAgICAgICAgICBjb3VudCxcclxuICAgICAgICAgIHVybCxcclxuICAgICAgICAgIGJhY2tzaWRlLFxyXG4gICAgICAgICAgZGF0YVxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIGxldCBsYW5kQ291bnQgPSAwO1xyXG4gICAgY29uc3Qgb3ZlcmFsbERldm90aW9uID0ge1xyXG4gICAgICBibHVlOiAwLFxyXG4gICAgICBibGFjazogMCxcclxuICAgICAgcmVkOiAwLFxyXG4gICAgICB3aGl0ZTogMCxcclxuICAgICAgZ3JlZW46IDAsXHJcbiAgICAgIGNvbG9ybGVzczogMCxcclxuICAgICAgZ2VuZXJpYzogMCxcclxuICAgICAgc3VtOiAwXHJcbiAgICB9O1xyXG4gICAgY29uc3Qgb3ZlcmFsbE1hbmFDdXJ2ZSA9IFtdO1xyXG4gICAgLy9tYW5hX2Nvc3Q6IFwie1d9e1V9e0J9e1J9e0d9IHtDfVwiXHJcblxyXG4gICAgbGV0IG92ZXJhbGxDb3VudCA9IDA7XHJcbiAgICBsZXQgb3ZlcmFsbENvc3QgPSAwO1xyXG5cclxuICAgIGxldCBjcmVhdHVyZUNvdW50ID0gMDtcclxuICAgIGxldCBpbnN0YW50Q291bnQgPSAwO1xyXG4gICAgbGV0IHNvcmNlcnlDb3VudCA9IDA7XHJcbiAgICBsZXQgZW5jaGFudG1lbnRDb3VudCA9IDA7XHJcbiAgICBsZXQgYXJ0aWZhY3RDb3VudCA9IDA7XHJcblxyXG4gICAgLy9tYW5hX2Nvc3Quc3BsaXQoXCJHXCIpLmxlbmd0aCAtIDFcclxuICAgIGZvciAobGV0IGdyb3VwIG9mIGdyb3Vwcykge1xyXG5cclxuICAgICAgZ3JvdXAuY2FyZHMgPSBPYmplY3QudmFsdWVzKGdyb3VwLmRlY2spO1xyXG4gICAgICBncm91cC5jYXJkcyA9IGdyb3VwLmNhcmRzLnNvcnQoKGEsIGIpID0+IGEuZGF0YS5jbWMgPiBiLmRhdGEuY21jID8gMSA6IC0xKTtcclxuXHJcbiAgICAgIGxldCBjb3VudCA9IDA7XHJcbiAgICAgIGxldCBjb3N0ID0gMDtcclxuICAgICAgY29uc3QgaXNNYXliZSA9IGdyb3VwLm5hbWUudG9Mb3dlckNhc2UoKSA9PSBcIm1heWJlXCI7XHJcblxyXG5cclxuICAgICAgY29uc3QgZGV2b3Rpb24gPSB7XHJcbiAgICAgICAgYmx1ZTogMCxcclxuICAgICAgICBibGFjazogMCxcclxuICAgICAgICByZWQ6IDAsXHJcbiAgICAgICAgd2hpdGU6IDAsXHJcbiAgICAgICAgZ3JlZW46IDAsXHJcbiAgICAgICAgY29sb3JsZXNzOiAwLFxyXG4gICAgICAgIGdlbmVyaWM6IDAsXHJcbiAgICAgICAgc3VtOiAwXHJcbiAgICAgIH07XHJcbiAgICAgIGNvbnN0IG1hbmFDdXJ2ZSA9IFtdO1xyXG4gICAgICBmb3IgKGxldCBjYXJkIG9mIGdyb3VwLmNhcmRzKSB7XHJcbiAgICAgICAgY291bnQgKz0gY2FyZC5jb3VudDtcclxuICAgICAgICBpZiAoIWlzTWF5YmUpIHtcclxuXHJcbiAgICAgICAgICBjb3N0ICs9IHBhcnNlRmxvYXQoY2FyZC5kYXRhLnByaWNlcy51c2QgfHwgMCkgKiBjYXJkLmNvdW50O1xyXG5cclxuICAgICAgICAgIGlmIChjYXJkLmRhdGEudHlwZV9saW5lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJsYW5kXCIpKSB7XHJcbiAgICAgICAgICAgIGxhbmRDb3VudCArPSBjYXJkLmNvdW50O1xyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgbWFuYUN1cnZlW2NhcmQuZGF0YS5jbWMgfHwgMF0gPSAobWFuYUN1cnZlW2NhcmQuZGF0YS5jbWMgfHwgMF0gfHwgMCkgKyBjYXJkLmNvdW50O1xyXG4gICAgICAgICAgfVxyXG5cclxuICAgICAgICAgIGlmIChjYXJkLmRhdGEudHlwZV9saW5lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJjcmVhdHVyZVwiKSkge1xyXG4gICAgICAgICAgICBjcmVhdHVyZUNvdW50ICs9IGNhcmQuY291bnQ7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBpZiAoY2FyZC5kYXRhLnR5cGVfbGluZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKFwiYXJ0aWZhY3RcIikpIHtcclxuICAgICAgICAgICAgYXJ0aWZhY3RDb3VudCArPSBjYXJkLmNvdW50O1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgaWYgKGNhcmQuZGF0YS50eXBlX2xpbmUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhcImVuY2hhbnRtZW50XCIpKSB7XHJcbiAgICAgICAgICAgIGVuY2hhbnRtZW50Q291bnQgKz0gY2FyZC5jb3VudDtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGlmIChjYXJkLmRhdGEudHlwZV9saW5lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJpbnN0YW50XCIpKSB7XHJcbiAgICAgICAgICAgIGluc3RhbnRDb3VudCArPSBjYXJkLmNvdW50O1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgaWYgKGNhcmQuZGF0YS50eXBlX2xpbmUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhcInNvcmNlcnlcIikpIHtcclxuICAgICAgICAgICAgc29yY2VyeUNvdW50ICs9IGNhcmQuY291bnQ7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuXHJcbiAgICAgICAgY2FyZC5kYXRhLm1hbmFfY29zdCA9IGNhcmQuZGF0YS5tYW5hX2Nvc3QgfHwgXCJcIjtcclxuICAgICAgICBkZXZvdGlvbi5ibHVlICs9IChjYXJkLmRhdGEubWFuYV9jb3N0LnNwbGl0KFwiVVwiKS5sZW5ndGggLSAxKSAqIGNhcmQuY291bnQ7XHJcbiAgICAgICAgZGV2b3Rpb24uYmxhY2sgKz0gKGNhcmQuZGF0YS5tYW5hX2Nvc3Quc3BsaXQoXCJCXCIpLmxlbmd0aCAtIDEpICogY2FyZC5jb3VudDtcclxuICAgICAgICBkZXZvdGlvbi5yZWQgKz0gKGNhcmQuZGF0YS5tYW5hX2Nvc3Quc3BsaXQoXCJSXCIpLmxlbmd0aCAtIDEpICogY2FyZC5jb3VudDtcclxuICAgICAgICBkZXZvdGlvbi53aGl0ZSArPSAoY2FyZC5kYXRhLm1hbmFfY29zdC5zcGxpdChcIldcIikubGVuZ3RoIC0gMSkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIGRldm90aW9uLmdyZWVuICs9IChjYXJkLmRhdGEubWFuYV9jb3N0LnNwbGl0KFwiR1wiKS5sZW5ndGggLSAxKSAqIGNhcmQuY291bnQ7XHJcbiAgICAgICAgZGV2b3Rpb24uY29sb3JsZXNzICs9IChjYXJkLmRhdGEubWFuYV9jb3N0LnNwbGl0KFwiQ1wiKS5sZW5ndGggLSAxKSAqIGNhcmQuY291bnQ7XHJcbiAgICAgICAgZGV2b3Rpb24uZ2VuZXJpYyArPSBNYXRoLmZsb29yKGNhcmQuZGF0YS5tYW5hX2Nvc3QucmVwbGFjZSgvW14wLTkuXS9nLCBcIiBcIikudHJpbSgpLnJlcGxhY2UoL1xcc1xccysvZywgXCIgXCIpLnNwbGl0KFwiIFwiKS5yZWR1Y2UoKHRvdGFsLCBudW0pID0+IE1hdGguZmxvb3IodG90YWwpICsgTWF0aC5mbG9vcihudW0pKSkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIC8vIGRldm90aW9uLmdlbmVyaWMgKz0gTWF0aC5mbG9vcihjYXJkLmRhdGEubWFuYV9jb3N0LnJlcGxhY2UoL1teMC05Ll0vZywgXCJcIikgfHwgMCkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIGRldm90aW9uLnN1bSA9IChkZXZvdGlvbi5zdW0gfHwgMCkgKyAoTWF0aC5mbG9vcihjYXJkLmRhdGEuY21jKSAqIGNhcmQuY291bnQpOyAvLyBkZXZvdGlvbi5ibHVlICsgZGV2b3Rpb24uYmxhY2sgKyBkZXZvdGlvbi5yZWQgKyBkZXZvdGlvbi5ncmVlbiArIGRldm90aW9uLndoaXRlICsgZGV2b3Rpb24uY29sb3JsZXNzICsgZGV2b3Rpb24uZ2VuZXJpYztcclxuICAgICAgfVxyXG5cclxuXHJcblxyXG4gICAgICBncm91cC5jb3VudCA9IGNvdW50O1xyXG4gICAgICBncm91cC5tYW5hID0gZGV2b3Rpb247XHJcbiAgICAgIGdyb3VwLmNvc3QgPSBjb3N0O1xyXG5cclxuICAgICAgZ3JvdXAubWFuYUN1cnZlID0gbWFuYUN1cnZlO1xyXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG1hbmFDdXJ2ZS5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIG1hbmFDdXJ2ZVtpXSA9IG1hbmFDdXJ2ZVtpXSB8fCAwO1xyXG4gICAgICAgIGlmIChpc01heWJlKSBjb250aW51ZTtcclxuICAgICAgICBvdmVyYWxsTWFuYUN1cnZlW2ldID0gKG92ZXJhbGxNYW5hQ3VydmVbaV0gfHwgMCkgKyAobWFuYUN1cnZlW2ldIHx8IDApO1xyXG4gICAgICB9XHJcbiAgICAgIGlmICghaXNNYXliZSkge1xyXG5cclxuICAgICAgICBvdmVyYWxsQ29zdCArPSBjb3N0O1xyXG4gICAgICAgIG92ZXJhbGxDb3VudCArPSBjb3VudDtcclxuXHJcbiAgICAgICAgb3ZlcmFsbERldm90aW9uLmJsdWUgKz0gZGV2b3Rpb24uYmx1ZTtcclxuICAgICAgICBvdmVyYWxsRGV2b3Rpb24uYmxhY2sgKz0gZGV2b3Rpb24uYmxhY2s7XHJcbiAgICAgICAgb3ZlcmFsbERldm90aW9uLnJlZCArPSBkZXZvdGlvbi5yZWQ7XHJcbiAgICAgICAgb3ZlcmFsbERldm90aW9uLndoaXRlICs9IGRldm90aW9uLndoaXRlO1xyXG4gICAgICAgIG92ZXJhbGxEZXZvdGlvbi5ncmVlbiArPSBkZXZvdGlvbi5ncmVlbjtcclxuICAgICAgICBvdmVyYWxsRGV2b3Rpb24uY29sb3JsZXNzICs9IGRldm90aW9uLmNvbG9ybGVzcztcclxuXHJcbiAgICAgICAgb3ZlcmFsbERldm90aW9uLmdlbmVyaWMgKz0gZGV2b3Rpb24uZ2VuZXJpYztcclxuICAgICAgICBvdmVyYWxsRGV2b3Rpb24uc3VtICs9IGRldm90aW9uLnN1bTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgb3ZlcmFsbE1hbmFDdXJ2ZS5sZW5ndGg7IGkrKykge1xyXG4gICAgICBvdmVyYWxsTWFuYUN1cnZlW2ldID0gb3ZlcmFsbE1hbmFDdXJ2ZVtpXSB8fCAwO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG5vbmxhbmRzID0gb3ZlcmFsbENvdW50IC0gbGFuZENvdW50O1xyXG5cclxuICAgIGxldCBqdXN0RGV2b3Rpb24gPSBvdmVyYWxsRGV2b3Rpb24uYmx1ZSArIG92ZXJhbGxEZXZvdGlvbi5ibGFjayArIG92ZXJhbGxEZXZvdGlvbi5yZWQgKyBvdmVyYWxsRGV2b3Rpb24ud2hpdGUgKyBvdmVyYWxsRGV2b3Rpb24uZ3JlZW4gKyBvdmVyYWxsRGV2b3Rpb24uY29sb3JsZXNzO1xyXG4gICAganVzdERldm90aW9uID0ganVzdERldm90aW9uIHx8IDE7XHJcbiAgICBjb25zdCBtYW5hUHJvcG9zYWwgPSB7XHJcbiAgICAgIGJsdWU6IG92ZXJhbGxEZXZvdGlvbi5ibHVlIC8ganVzdERldm90aW9uLFxyXG4gICAgICBibGFjazogb3ZlcmFsbERldm90aW9uLmJsYWNrIC8ganVzdERldm90aW9uLFxyXG4gICAgICByZWQ6IG92ZXJhbGxEZXZvdGlvbi5yZWQgLyBqdXN0RGV2b3Rpb24sXHJcbiAgICAgIHdoaXRlOiBvdmVyYWxsRGV2b3Rpb24ud2hpdGUgLyBqdXN0RGV2b3Rpb24sXHJcbiAgICAgIGdyZWVuOiBvdmVyYWxsRGV2b3Rpb24uZ3JlZW4gLyBqdXN0RGV2b3Rpb24sXHJcbiAgICAgIGNvbG9ybGVzczogb3ZlcmFsbERldm90aW9uLmNvbG9ybGVzcyAvIGp1c3REZXZvdGlvbixcclxuICAgIH07XHJcblxyXG4gICAgZ3JvdXBzW1wibWFuYVByb3Bvc2FsXCJdID0gbWFuYVByb3Bvc2FsO1xyXG5cclxuICAgIGdyb3Vwc1tcImxhbmRDb3VudFwiXSA9IGxhbmRDb3VudDtcclxuICAgIGdyb3Vwc1tcImNhcmRDb3VudFwiXSA9IG92ZXJhbGxDb3VudDtcclxuICAgIGdyb3Vwc1tcImF2ZXJhZ2VNYW5hXCJdID0gb3ZlcmFsbERldm90aW9uLnN1bSAvIChvdmVyYWxsQ291bnQgLSBsYW5kQ291bnQpO1xyXG4gICAgZ3JvdXBzW1wiY29zdFwiXSA9IG92ZXJhbGxDb3N0O1xyXG4gICAgZ3JvdXBzW1wibWFuYVwiXSA9IG92ZXJhbGxEZXZvdGlvbjtcclxuICAgIGdyb3Vwc1tcImNvcnJlY3RlZFwiXSA9IGRlY2tTdHJpbmc7XHJcbiAgICBncm91cHNbXCJtYW5hQ3VydmVcIl0gPSBvdmVyYWxsTWFuYUN1cnZlO1xyXG5cclxuXHJcbiAgICBncm91cHNbXCJjcmVhdHVyZUNvdW50XCJdID0gY3JlYXR1cmVDb3VudDtcclxuICAgIGdyb3Vwc1tcImluc3RhbnRDb3VudFwiXSA9IGluc3RhbnRDb3VudDtcclxuICAgIGdyb3Vwc1tcInNvcmNlcnlDb3VudFwiXSA9IHNvcmNlcnlDb3VudDtcclxuICAgIGdyb3Vwc1tcImVuY2hhbnRtZW50Q291bnRcIl0gPSBlbmNoYW50bWVudENvdW50O1xyXG4gICAgZ3JvdXBzW1wiYXJ0aWZhY3RDb3VudFwiXSA9IGFydGlmYWN0Q291bnQ7XHJcbiAgICByZXR1cm4gZ3JvdXBzO1xyXG4gIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBNdGdJbnRlcmZhY2U7IiwiPHNjcmlwdD5cclxuICBpbXBvcnQgeyBvbk1vdW50IH0gZnJvbSBcInN2ZWx0ZVwiO1xyXG4gIC8vIGNvbnN0IHsgaXBjUmVuZGVyZXIgfSA9IHJlcXVpcmUoXCJlbGVjdHJvblwiKTtcclxuXHJcbiAgY29uc3QgaXBjID0gcmVxdWlyZShcImVsZWN0cm9uXCIpLmlwY1JlbmRlcmVyO1xyXG4gIGltcG9ydCBjbCBmcm9tIFwiLi9jYXJkLWxvYWRlci5qc1wiO1xyXG4gIGNvbnN0IENhcmRMb2FkZXIgPSBuZXcgY2woaXBjKTtcclxuICAvLyBpbXBvcnQgTFpVVEY4IGZyb20gXCJsenV0ZjhcIjtcclxuICAvL2ltcG9ydCBDb29raWVzIGZyb20gXCJqcy1jb29raWVcIjtcclxuXHJcbiAgY29uc3QgQ29va2llcyA9IHtcclxuICAgIHNldDogKCkgPT4ge30sXHJcbiAgICBnZXQ6ICgpID0+IHt9XHJcbiAgfTtcclxuXHJcbiAgY29uc3QgQ0FSRF9SQVRJTyA9IDAuNzE3NjQ3MDU4ODI7XHJcbiAgbGV0IF9oZWlnaHQgPSAzMDA7XHJcbiAgbGV0IF93aWR0aCA9IE1hdGguZmxvb3IoX2hlaWdodCAqIENBUkRfUkFUSU8pO1xyXG5cclxuICBsZXQgdXNlQ29va2llcyA9IHRydWU7XHJcblxyXG4gIGZ1bmN0aW9uIGVuYWJsZVNhdmluZygpIHtcclxuICAgIHVzZUNvb2tpZXMgPSB0cnVlO1xyXG4gICAgQ29va2llcy5zZXQoXCJ1c2VDb29raWVzXCIsIHRydWUpO1xyXG4gICAgc2F2ZUFsbFRvQ29va2llcygpO1xyXG4gIH1cclxuXHJcbiAgY29uc3Qgb2xkU2V0ID0gQ29va2llcy5zZXQ7XHJcbiAgQ29va2llcy5zZXQgPSAoYSwgYikgPT4ge1xyXG4gICAgaWYgKHVzZUNvb2tpZXMpIG9sZFNldChhLCBiKTtcclxuICAgIGVsc2Uge1xyXG4gICAgICBjb25zb2xlLmxvZyhcInNhdmluZyBkaXNhYmxlZFwiKTtcclxuICAgIH1cclxuICB9O1xyXG5cclxuICBsZXQgaGVpZ2h0ID0gX2hlaWdodDtcclxuICBsZXQgd2lkdGggPSBfd2lkdGg7XHJcbiAgbGV0IGNhcmRTZWFyY2hBY3RpdmUgPSB0cnVlO1xyXG4gIGxldCBzdGF0aXN0aWNzQWN0aXZlID0gdHJ1ZTtcclxuICBsZXQgc2NhbGluZyA9IDEwMDtcclxuXHJcbiAgbGV0IGRpc3BsYXk7XHJcblxyXG4gIGxldCBkZXZvdGlvbkhpZ2hsaWdodCA9IC0xO1xyXG5cclxuICBmdW5jdGlvbiBoaWdobGlnaHREZXZvdGlvbihtYW5hKSB7XHJcbiAgICBpZiAoZGV2b3Rpb25IaWdobGlnaHQgPT0gbWFuYSkgZGV2b3Rpb25IaWdobGlnaHQgPSAtMTtcclxuICAgIGVsc2UgZGV2b3Rpb25IaWdobGlnaHQgPSBtYW5hICsgXCJcIjtcclxuICB9XHJcblxyXG4gICQ6IHtcclxuICAgIGNvbnN0IHMgPSBNYXRoLmZsb29yKHNjYWxpbmcgfHwgMTAwKSAvIDEwMDtcclxuICAgIGhlaWdodCA9IF9oZWlnaHQgKiBzO1xyXG4gICAgd2lkdGggPSBfd2lkdGggKiBzO1xyXG4gIH1cclxuXHJcbiAgbGV0IHByb21pc2UgPSBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHJlc29sdmUoW10pKTtcclxuICBsZXQgY2FyZFNlYXJjaFByb21pc2UgPSBuZXcgUHJvbWlzZShyZXNvbHZlID0+XHJcbiAgICByZXNvbHZlKHsgZGF0YTogW10sIGhhc19tb3JlOiBmYWxzZSwgdG90YWxfY2FyZHM6IDAgfSlcclxuICApO1xyXG5cclxuICBsZXQgaW5wdXQ7XHJcbiAgbGV0IGZvcm1hdDtcclxuICBsZXQgcHJvZ3Jlc3MgPSAwO1xyXG4gIGxldCBhbGwgPSAwO1xyXG5cclxuICBsZXQgc3BOYW1lO1xyXG4gIGxldCBzcFRleHQ7XHJcbiAgbGV0IHNwVHlwZTtcclxuXHJcbiAgbGV0IHNwRURIQmx1ZTtcclxuICBsZXQgc3BFREhCbGFjaztcclxuICBsZXQgc3BFREhSZWQ7XHJcbiAgbGV0IHNwRURIV2hpdGU7XHJcbiAgbGV0IHNwRURIR3JlZW47XHJcbiAgbGV0IHNwRURIQ29sb3JsZXNzO1xyXG5cclxuICBsZXQgZGVja1NlYWNoID0gbnVsbDtcclxuICBsZXQgZGVja1NlYXJjaElucHV0O1xyXG5cclxuICBmdW5jdGlvbiBjaGFuZ2VEZWNrU2VhcmNoKGdyb3Vwcykge1xyXG4gICAgaWYgKCFncm91cHMpIHJldHVybmRlY2tTZWFjaCA9IG51bGw7XHJcbiAgICBsZXQgcyA9IGRlY2tTZWFyY2hJbnB1dC52YWx1ZTtcclxuICAgIGlmICghcykgcmV0dXJuIChkZWNrU2VhY2ggPSBudWxsKTtcclxuXHJcbiAgICBzID0gc1xyXG4gICAgICAudHJpbSgpXHJcbiAgICAgIC5yZXBsYWNlKC9cXHNcXHMrL2dtLCBcIiBcIilcclxuICAgICAgLnRvTG93ZXJDYXNlKClcclxuICAgICAgLnJlcGxhY2UoL1xccy9nbSwgXCIoLnxcXG4pKlwiKTtcclxuICAgIC8qICAgIC5zcGxpdChcIitcIilcclxuICAgICAgLmpvaW4oXCJ8XCIpOyovXHJcbiAgICBjb25zb2xlLmxvZyhcInNlYXJjaDpcIiwgcyk7XHJcbiAgICBjb25zdCByZXN1bHQgPSBbXTtcclxuICAgIGxldCBjb3VudCA9IDA7XHJcbiAgICBjb25zdCByID0gbmV3IFJlZ0V4cChzLCBcImdtXCIpO1xyXG4gICAgZm9yIChsZXQgZ3JvdXAgb2YgZ3JvdXBzKSB7XHJcbiAgICAgIGZvciAobGV0IGNhcmQgb2YgZ3JvdXAuY2FyZHMpIHtcclxuICAgICAgICBpZiAoIWNhcmQgfHwgIWNhcmQuZGF0YSB8fCAhY2FyZC5kYXRhLm9yYWNsZV90ZXh0KSBjb250aW51ZTtcclxuICAgICAgICBpZiAoIWNhcmQuZGF0YS5vcmFjbGVfdGV4dC50b0xvd2VyQ2FzZSgpLm1hdGNoKHIpKSBjb250aW51ZTtcclxuICAgICAgICBjb3VudCArPSBjYXJkLmNvdW50O1xyXG4gICAgICAgIHJlc3VsdC5wdXNoKGNhcmQpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgZGVja1NlYWNoID0gW1xyXG4gICAgICB7XHJcbiAgICAgICAgY2FyZHM6IHJlc3VsdCxcclxuICAgICAgICBjb3N0OiAwLFxyXG4gICAgICAgIGNvdW50LFxyXG4gICAgICAgIGRlY2s6IHt9LFxyXG4gICAgICAgIG1hbmE6IHtcclxuICAgICAgICAgIGJsYWNrOiAwLFxyXG4gICAgICAgICAgYmx1ZTogMCxcclxuICAgICAgICAgIGNvbG9ybGVzczogMCxcclxuICAgICAgICAgIGdlbmVyaWM6IDI0MCxcclxuICAgICAgICAgIGdyZWVuOiAwLFxyXG4gICAgICAgICAgcmVkOiAwLFxyXG4gICAgICAgICAgc3VtOiAyNDAsXHJcbiAgICAgICAgICB3aGl0ZTogMFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgbWFuYUN1cnZlOiBbXSxcclxuICAgICAgICBuYW1lOiBcInNlYXJjaCByZXN1bHRcIlxyXG4gICAgICB9XHJcbiAgICBdO1xyXG4gIH1cclxuICBmdW5jdGlvbiBjbGVhckZvckNvbG9ybGVzcygpIHtcclxuICAgIHNwRURIQmx1ZS5jaGVja2VkID0gZmFsc2U7XHJcbiAgICBzcEVESEJsYWNrLmNoZWNrZWQgPSBmYWxzZTtcclxuICAgIHNwRURIUmVkLmNoZWNrZWQgPSBmYWxzZTtcclxuICAgIHNwRURIV2hpdGUuY2hlY2tlZCA9IGZhbHNlO1xyXG4gICAgc3BFREhHcmVlbi5jaGVja2VkID0gZmFsc2U7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBjbGVhckNvbG9ybGVzcygpIHtcclxuICAgIHNwRURIQ29sb3JsZXNzLmNoZWNrZWQgPSBmYWxzZTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHNlYXJjaENhcmRzKG5leHRVcmwpIHtcclxuICAgIGlmICh0eXBlb2YgbmV4dFVybCA9PSBcInN0cmluZ1wiKSB7XHJcbiAgICAgIGNhcmRTZWFyY2hQcm9taXNlID0gQ2FyZExvYWRlci5zZWFyY2gobmV4dFVybCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IGNvbG9ycyA9IG5ldyBTZXQoKTtcclxuICAgIGlmIChzcEVESENvbG9ybGVzcy5jaGVja2VkKSBjb2xvcnMuYWRkKFwiQ1wiKTtcclxuICAgIGlmIChzcEVESEJsdWUuY2hlY2tlZCkgY29sb3JzLmFkZChcIlVcIik7XHJcbiAgICBpZiAoc3BFREhCbGFjay5jaGVja2VkKSBjb2xvcnMuYWRkKFwiQlwiKTtcclxuICAgIGlmIChzcEVESFJlZC5jaGVja2VkKSBjb2xvcnMuYWRkKFwiUlwiKTtcclxuICAgIGlmIChzcEVESFdoaXRlLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJXXCIpO1xyXG4gICAgaWYgKHNwRURIR3JlZW4uY2hlY2tlZCkgY29sb3JzLmFkZChcIkdcIik7XHJcblxyXG4gICAgY2FyZFNlYXJjaFByb21pc2UgPSBDYXJkTG9hZGVyLnNlYXJjaCh7XHJcbiAgICAgIG5hbWU6IHNwTmFtZS52YWx1ZSxcclxuICAgICAgdGV4dDogc3BUZXh0LnZhbHVlLFxyXG4gICAgICB0eXBlOiBzcFR5cGUudmFsdWUsXHJcbiAgICAgIGVkaGNvbG9yczogY29sb3JzXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIGxldCBjdXJyZW50Q2FyZENvbnRleHQgPSBudWxsO1xyXG4gIGZ1bmN0aW9uIGNhcmRDb250ZXh0TWVudShldnQsIGNhcmQsIGdyb3Vwcykge1xyXG4gICAgZXZ0LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICBpZiAoZXZ0LndoaWNoID09IDMgJiYgZ3JvdXBzLmxlbmd0aCA+IDEpIHtcclxuICAgICAgLy8gcmlnaHQgY2xpY2tcclxuICAgICAgY3VycmVudENhcmRDb250ZXh0ID0gY2FyZDtcclxuICAgIH1cclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIGNhcmRDb250ZXh0Q2xpY2soZXZ0LCBjYXJkLCBncm91cCkge1xyXG4gICAgY3VycmVudENhcmRDb250ZXh0ID0gbnVsbDtcclxuICAgIGV2dC5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgIGV2dC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgbGV0IGRlY2sgPSBpbnB1dC52YWx1ZTtcclxuXHJcbiAgICBjb25zdCByID0gbmV3IFJlZ0V4cChgXi4qJHtjYXJkLm5hbWV9LiokYCwgXCJnbWlcIik7XHJcbiAgICBkZWNrID0gZGVjay5yZXBsYWNlKHIsIFwiXCIpO1xyXG4gICAgbGV0IGluZGV4ID0gZGVjay5pbmRleE9mKGdyb3VwLm5hbWUpO1xyXG4gICAgaWYgKGluZGV4IDwgMCkgcmV0dXJuO1xyXG4gICAgaW5kZXggKz0gZ3JvdXAubmFtZS5sZW5ndGg7XHJcblxyXG4gICAgY29uc3QgaW5zZXJ0ID0gXCJcXG5cIiArIGNhcmQuY291bnQgKyBcIiBcIiArIGNhcmQubmFtZTtcclxuICAgIGRlY2sgPSBkZWNrLnNsaWNlKDAsIGluZGV4KSArIGluc2VydCArIGRlY2suc2xpY2UoaW5kZXgpO1xyXG4gICAgaW5wdXQudmFsdWUgPSBkZWNrO1xyXG4gICAgcmVsb2FkKCk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBvbk1haW5Nb3VzZURvd24oZXZ0KSB7XHJcbiAgICBjdXJyZW50Q2FyZENvbnRleHQgPSBudWxsO1xyXG4gIH1cclxuXHJcbiAgbGV0IGhpZGRlbkdyb3VwcyA9IG5ldyBTZXQoKTtcclxuXHJcbiAgZnVuY3Rpb24gdG9nZ2xlR3JvdXBWaXNpYmlsaXR5KGdyb3VwKSB7XHJcbiAgICBpZiAoaGlkZGVuR3JvdXBzLmhhcyhncm91cC5uYW1lKSkgaGlkZGVuR3JvdXBzLmRlbGV0ZShncm91cC5uYW1lKTtcclxuICAgIGVsc2UgaGlkZGVuR3JvdXBzLmFkZChncm91cC5uYW1lKTtcclxuXHJcbiAgICBoaWRkZW5Hcm91cHMgPSBoaWRkZW5Hcm91cHM7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBzcChwLCBhKSB7XHJcbiAgICBwcm9ncmVzcyA9IHA7XHJcbiAgICBhbGwgPSBhO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gcmVzZXREZWNrU2VhcmNoKCkge1xyXG4gICAgZGVja1NlYWNoID0gbnVsbDtcclxuICAgIGlmICghZGVja1NlYXJjaElucHV0KSByZXR1cm47XHJcbiAgICBkZWNrU2VhcmNoSW5wdXQudmFsdWUgPSBcIlwiO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gc29ydERlY2tTdHJpbmcoKSB7XHJcbiAgICBwcm9taXNlID0gQ2FyZExvYWRlci5zb3J0KGlucHV0LnZhbHVlIHx8IFwiXCIsIChwLCBhKSA9PiB7XHJcbiAgICAgIHJlc2V0RGVja1NlYXJjaCgpO1xyXG4gICAgICBzcChwLCBhKTtcclxuICAgIH0pXHJcbiAgICAgIC5jYXRjaChlID0+IHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGUpO1xyXG4gICAgICAgIHRocm93IGU7XHJcbiAgICAgIH0pXHJcbiAgICAgIC50aGVuKHJlcyA9PiB7XHJcbiAgICAgICAgaW5wdXQudmFsdWUgPSByZXM7XHJcbiAgICAgICAgcmV0dXJuIHVwZGF0ZSh7IGtleUNvZGU6IDI3IH0sIHRydWUpO1xyXG4gICAgICB9KTtcclxuICB9XHJcblxyXG4gIGxldCBkZWNrTmFtZUlucHV0O1xyXG4gIGZ1bmN0aW9uIHNhdmVEZWNrKCkge1xyXG4gICAgaWYgKCFkZWNrTmFtZUlucHV0KSByZXR1cm4gYWxlcnQoXCJwbHMgaW5wdXQgYSBuYW1lXCIpO1xyXG5cclxuICAgIC8vIGNvbnN0IGZpbGVuYW1lID0gKGRlY2tOYW1lSW5wdXQudmFsdWUgfHwgXCJ1bmtub3duIGRlY2tcIikgKyBcIi50eHRcIjtcclxuXHJcbiAgICBpcGMuc2VuZChcInNhdmVEZWNrXCIsIHsgZGVjazogaW5wdXQudmFsdWUsIG5hbWU6IGRlY2tOYW1lSW5wdXQudmFsdWUgfSk7XHJcblxyXG4gICAgLyogIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbZGVja10sIHsgdHlwZTogXCJ0ZXh0L3BsYWluO2NoYXJzZXQ9dXRmLThcIiB9KTtcclxuICAgIGlmICh3aW5kb3cubmF2aWdhdG9yLm1zU2F2ZU9yT3BlbkJsb2IpXHJcbiAgICAgIC8vIElFMTArXHJcbiAgICAgIHdpbmRvdy5uYXZpZ2F0b3IubXNTYXZlT3JPcGVuQmxvYihibG9iLCBmaWxlbmFtZSk7XHJcbiAgICBlbHNlIHtcclxuICAgICAgLy8gT3RoZXJzXHJcbiAgICAgIHZhciBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImFcIiksXHJcbiAgICAgICAgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcclxuICAgICAgYS5ocmVmID0gdXJsO1xyXG4gICAgICBhLmRvd25sb2FkID0gZmlsZW5hbWU7XHJcbiAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XHJcbiAgICAgIGEuY2xpY2soKTtcclxuICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcclxuICAgICAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGEpO1xyXG4gICAgICAgIHdpbmRvdy5VUkwucmV2b2tlT2JqZWN0VVJMKHVybCk7XHJcbiAgICAgIH0sIDApO1xyXG4gICAgfSovXHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBvbkRlY2tOYW1lVHlwZSgpIHtcclxuICAgIENvb2tpZXMuc2V0KFwiZGVja05hbWVcIiwgZGVja05hbWVJbnB1dC52YWx1ZSk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBtYWluS2V5RG93bihldnQpIHtcclxuICAgIGlmIChldnQuY3RybEtleSB8fCBldnQubWV0YUtleSkge1xyXG4gICAgICBzd2l0Y2ggKGV2dC53aGljaCkge1xyXG4gICAgICAgIGNhc2UgODM6IC8vIHNcclxuICAgICAgICAgIGV2dC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgICAgZXZ0LnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICAgICAgc2F2ZURlY2soKTtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBtYWluS2V5VXAoZXZ0KSB7XHJcbiAgICB1cGRhdGUoZXZ0KTtcclxuICB9XHJcblxyXG4gIGFzeW5jIGZ1bmN0aW9uIHVwZGF0ZShldnQpIHtcclxuICAgIGlmIChldnQua2V5Q29kZSAhPT0gMjcpIHJldHVybjtcclxuXHJcbiAgICBsZXQgc2Nyb2xsUG9zaXRpb24gPSAwO1xyXG4gICAgaWYgKGRpc3BsYXkpIHtcclxuICAgICAgc2Nyb2xsUG9zaXRpb24gPSBkaXNwbGF5LnNjcm9sbFRvcDtcclxuICAgIH1cclxuXHJcbiAgICBwcm9taXNlID0gQ2FyZExvYWRlci5jcmVhdGVEZWNrKGlucHV0LnZhbHVlIHx8IFwiXCIsIChwLCBhKSA9PiB7XHJcbiAgICAgIHJlc2V0RGVja1NlYXJjaCgpO1xyXG4gICAgICBzcChwLCBhKTtcclxuICAgIH0pXHJcbiAgICAgIC5jYXRjaChlID0+IHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGUpO1xyXG4gICAgICAgIHRocm93IGU7XHJcbiAgICAgIH0pXHJcbiAgICAgIC50aGVuKHJlcyA9PiB7XHJcbiAgICAgICAgaW5wdXQudmFsdWUgPSByZXMuY29ycmVjdGVkO1xyXG4gICAgICAgIENvb2tpZXMuc2V0KFwiZGVja1wiLCBpbnB1dC52YWx1ZSk7XHJcbiAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICBkaXNwbGF5LnNjcm9sbFRvcCA9IHNjcm9sbFBvc2l0aW9uO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIHJldHVybiByZXM7XHJcbiAgICAgIH0pO1xyXG5cclxuICAgIHJldHVybiBwcm9taXNlO1xyXG4gIH1cclxuICBmdW5jdGlvbiByZWxvYWQoKSB7XHJcbiAgICByZXNldERlY2tTZWFyY2goKTtcclxuICAgIHVwZGF0ZSh7IGtleUNvZGU6IDI3IH0pO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gYXBwZW5kQ2FyZChuYW1lKSB7XHJcbiAgICBpZiAoIW5hbWUpIHJldHVybjtcclxuICAgIHJlc2V0RGVja1NlYXJjaCgpO1xyXG4gICAgaW5wdXQudmFsdWUgPSBpbnB1dC52YWx1ZSArIFwiXFxuMSBcIiArIG5hbWU7XHJcbiAgICByZWxvYWQoKTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHJlbW92ZShjYXJkKSB7XHJcbiAgICBjb25zdCByID0gbmV3IFJlZ0V4cChgXi4qJHtjYXJkLm5hbWV9LiokYCwgXCJnbVwiKTtcclxuXHJcbiAgICBpbnB1dC52YWx1ZSA9IGlucHV0LnZhbHVlLnJlcGxhY2UociwgXCIvLyBcIiArIGNhcmQuY291bnQgKyBcIiBcIiArIGNhcmQubmFtZSk7XHJcbiAgICBwcm9taXNlID0gQ2FyZExvYWRlci5jcmVhdGVEZWNrKGlucHV0LnZhbHVlIHx8IFwiXCIsIChwLCBhKSA9PlxyXG4gICAgICBzcChwLCBhKVxyXG4gICAgKS5jYXRjaChlID0+IHtcclxuICAgICAgY29uc29sZS5lcnJvcihlKTtcclxuICAgICAgdGhyb3cgZTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gY29weURlY2soKSB7XHJcbiAgICBjb25zdCBkZWNrID0gaW5wdXQudmFsdWU7XHJcblxyXG4gICAgaW5wdXQudmFsdWUgPSBpbnB1dC52YWx1ZS5yZXBsYWNlKC8jLip8XFwvXFwvLiovZ20sIFwiXFxuXCIpO1xyXG5cclxuICAgIGlucHV0LnNlbGVjdCgpO1xyXG5cclxuICAgIGlucHV0LnNldFNlbGVjdGlvblJhbmdlKDAsIDk5OTk5KTtcclxuICAgIGRvY3VtZW50LmV4ZWNDb21tYW5kKFwiY29weVwiKTtcclxuXHJcbiAgICBpbnB1dC52YWx1ZSA9IGRlY2s7XHJcblxyXG4gICAgYWxlcnQoXCJEZWNrIGNvcGllZCB0byBjbGlwYm9hcmRcIik7XHJcbiAgfVxyXG5cclxuICBsZXQgaGVscEFjdGl2ZSA9IGZhbHNlO1xyXG4gIG9uTW91bnQoYXN5bmMgKCkgPT4ge1xyXG4gICAgY29uc3QgZGVmYXVsdERlY2sgPSBgI2xhbmRzXHJcbm1vdW50YWluXHJcbjIgcGxhaW5zXHJcbjMgc3dhbXBzXHJcbiMgbWFpbiBkZWNrXHJcbjIwIGJsaWdodHN0ZWVsIGNvbG9zc3VzYDtcclxuXHJcbiAgICB1c2VDb29raWVzID0gQ29va2llcy5nZXQoXCJ1c2VDb29raWVzXCIpO1xyXG5cclxuICAgIGNvbnN0IHVybFBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMod2luZG93LmxvY2F0aW9uLnNlYXJjaCk7XHJcbiAgICBjb25zdCBzaGFyZWREZWNrID0gdXJsUGFyYW1zLmdldChcImRcIik7XHJcblxyXG4gICAgbGV0IHN0YXJ0ID0gdXNlQ29va2llcyA/IENvb2tpZXMuZ2V0KFwiZGVja1wiKSB8fCBkZWZhdWx0RGVjayA6IGRlZmF1bHREZWNrO1xyXG5cclxuICAgIGlmIChzaGFyZWREZWNrKSB7XHJcbiAgICAgIHVzZUNvb2tpZXMgPSBmYWxzZTtcclxuICAgICAgLyogY29uc3QgYnVmZmVyID0gbmV3IFVpbnQ4QXJyYXkoc2hhcmVkRGVjay5zcGxpdChcIixcIikpO1xyXG4gICAgKiBjb25zdCBkZWNvbXByZXNzZWQgPSBMWlVURjguZGVjb21wcmVzcyhidWZmZXIpO1xyXG4gICAgICBpZiAoZGVjb21wcmVzc2VkKSB7XHJcbiAgICAgICAgc3RhcnQgPSBkZWNvbXByZXNzZWQ7XHJcbiAgICAgIH0qL1xyXG4gICAgfVxyXG5cclxuICAgIHVybFBhcmFtcy5kZWxldGUoXCJkXCIpO1xyXG4gICAgd2luZG93Lmhpc3RvcnkucmVwbGFjZVN0YXRlKHt9LCBcIlwiLCBgJHt3aW5kb3cubG9jYXRpb24ucGF0aG5hbWV9YCk7XHJcblxyXG4gICAgLy8gICAgd2luZG93Lmhpc3RvcnkucmVwbGFjZVN0YXRlKFxyXG4gICAgLy8gICB7fSxcclxuICAgIC8vICAgJycsXHJcbiAgICAvLyAgIGAke3dpbmRvdy5sb2NhdGlvbi5wYXRobmFtZX0/JHtwYXJhbXN9JHt3aW5kb3cubG9jYXRpb24uaGFzaH1gLFxyXG4gICAgLy8gKVxyXG5cclxuICAgIC8vICBoZWxwQWN0aXZlID0gQ29va2llcy5nZXQoXCJoZWxwQWN0aXZlXCIpID09IFwidHJ1ZVwiO1xyXG4gICAgLy8gY29uc29sZS5sb2coXCJoZWxwOlwiLCBDb29raWVzLmdldChcImhlbHBBY3RpdmVcIikpO1xyXG4gICAgY2FyZFNlYXJjaEFjdGl2ZSA9IENvb2tpZXMuZ2V0KFwiY2FyZFNlYXJjaEFjdGl2ZVwiKSA9PSBcInRydWVcIjtcclxuICAgIGNvbnNvbGUubG9nKFwic2VhcmNoOlwiLCBDb29raWVzLmdldChcImNhcmRTZWFyY2hBY3RpdmVcIikpO1xyXG4gICAgc3RhdGlzdGljc0FjdGl2ZSA9IENvb2tpZXMuZ2V0KFwic3RhdGlzdGljc0FjdGl2ZVwiKSA9PSBcInRydWVcIjtcclxuICAgIGNvbnNvbGUubG9nKFwic3RhdGlzdGljczpcIiwgQ29va2llcy5nZXQoXCJzdGF0aXN0aWNzQWN0aXZlXCIpKTtcclxuXHJcbiAgICBzdGF0aXN0aWNzQWN0aXZlO1xyXG4gICAgaW5wdXQudmFsdWUgPSBzdGFydDtcclxuICAgIHJlbG9hZCgpO1xyXG5cclxuICAgIGlwYy5vbihcImxvYWREZWNrXCIsIChzZW5kZXIsIGRhdGEpID0+IHtcclxuICAgICAgY29uc29sZS5sb2coXCJMT0FESU5HIERFQ0tcIiwgZGF0YS5uYW1lKTtcclxuICAgICAgaW5wdXQudmFsdWUgPSBkYXRhLmRlY2s7XHJcbiAgICAgIGRlY2tOYW1lSW5wdXQudmFsdWUgPSAoZGF0YS5uYW1lIHx8IFwiXCIpLnJlcGxhY2UoXCIuZ2RlY2tcIiwgXCJcIik7XHJcbiAgICAgIHJlbG9hZCgpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgLyogY29uc29sZS5sb2coXCJTVFNGU0RGXCIsIENvb2tpZXMuZ2V0KFwiZGVja1wiKSksXHJcbiAgICAgIChwcm9taXNlID0gQ2FyZExvYWRlci5jcmVhdGVEZWNrKHN0YXJ0LCAocCwgYSkgPT4gc3AocCwgYSkpKTsqL1xyXG4gIH0pO1xyXG5cclxuICBmdW5jdGlvbiBzYXZlQWxsVG9Db29raWVzKCkge1xyXG4gICAgQ29va2llcy5zZXQoXCJjYXJkU2VhcmNoQWN0aXZlXCIsIGNhcmRTZWFyY2hBY3RpdmUpO1xyXG4gICAgQ29va2llcy5zZXQoXCJzdGF0aXN0aWNzQWN0aXZlXCIsIHN0YXRpc3RpY3NBY3RpdmUpO1xyXG4gICAgQ29va2llcy5zZXQoXCJkZWNrXCIsIGlucHV0LnZhbHVlKTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHNoYXJlRGVjaygpIHtcclxuICAgIC8qICAgaWYgKCFpbnB1dCB8fCAhaW5wdXQudmFsdWUpIHtcclxuICAgICAgYWxlcnQoXCJUaGUgZGVjayBpcyBlbXB0eSwgbm90aGluZyBjb3BpZWRcIik7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IGNvbXByZXNzZWQgPSBMWlVURjguY29tcHJlc3MoaW5wdXQudmFsdWUgfHwgXCJlbXB0eSBkZWNrIHNoYXJlZFwiKTtcclxuICAgIC8vd2luZG93Lmhpc3RvcnkucHVzaFN0YXRlKFwicGFnZTJcIiwgXCJUaXRsZVwiLCBcIj9kPVwiICsgY29tcHJlc3NlZCk7XHJcbiAgICBjb25zb2xlLmxvZyhgJHt3aW5kb3cubG9jYXRpb24ucGF0aG5hbWV9P2Q9JHtjb21wcmVzc2VkfWApO1xyXG5cclxuICAgIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInRleHRhcmVhXCIpO1xyXG4gICAgZWwudmFsdWUgPSBgJHt3aW5kb3cubG9jYXRpb24uaHJlZn0/ZD0ke2NvbXByZXNzZWR9YDtcclxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZWwpO1xyXG4gICAgZWwuc2VsZWN0KCk7XHJcbiAgICBkb2N1bWVudC5leGVjQ29tbWFuZChcImNvcHlcIik7XHJcbiAgICBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGVsKTtcclxuICAgIGFsZXJ0KFwibGluayB0byBkZWNrIGNvcGllZFwiKTsqL1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gb25UeXBpbmcoKSB7XHJcbiAgICBDb29raWVzLnNldChcImRlY2tcIiwgaW5wdXQudmFsdWUsIHsgZXhwaXJlczogNyB9KTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIGdldEhlaWdodChtYW5hLCBncm91cHMpIHtcclxuICAgIHJldHVybiAxMDAgKiAobWFuYSAvIE1hdGgubWF4KC4uLmdyb3Vwc1tcIm1hbmFDdXJ2ZVwiXSkpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gb3BlbkhlbHAoKSB7XHJcbiAgICBoZWxwQWN0aXZlID0gIWhlbHBBY3RpdmU7XHJcbiAgICAvLyAgQ29va2llcy5zZXQoXCJoZWxwQWN0aXZlXCIsIGhlbHBBY3RpdmUgKyBcIlwiKTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHRvZ2dsZVNlYXJjaCgpIHtcclxuICAgIGNhcmRTZWFyY2hBY3RpdmUgPSAhY2FyZFNlYXJjaEFjdGl2ZTtcclxuICAgIENvb2tpZXMuc2V0KFwiY2FyZFNlYXJjaEFjdGl2ZVwiLCBjYXJkU2VhcmNoQWN0aXZlICsgXCJcIik7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIHRvZ2dsZVN0YXRpc3RpY3MoKSB7XHJcbiAgICBzdGF0aXN0aWNzQWN0aXZlID0gIXN0YXRpc3RpY3NBY3RpdmU7XHJcbiAgICBDb29raWVzLnNldChcInN0YXRpc3RpY3NBY3RpdmVcIiwgc3RhdGlzdGljc0FjdGl2ZSArIFwiXCIpO1xyXG4gIH1cclxuPC9zY3JpcHQ+XHJcblxyXG48c3R5bGU+XHJcbiAgLmNvbnRlbnQge1xyXG4gICAgLS1yYWlzaW4tYmxhY2s6IGhzbGEoMjAwLCA4JSwgMTUlLCAxKTtcclxuICAgIC0tcm9tYW4tc2lsdmVyOiBoc2xhKDE5NiwgMTUlLCA2MCUsIDEpO1xyXG4gICAgLS1jb2xvcmxlc3M6IGhzbGEoMCwgMCUsIDg5JSwgMSk7XHJcbiAgICAtLWJsYWNrOiBoc2xhKDgzLCA4JSwgMzglLCAxKTtcclxuICAgIC0td2hpdGU6IGhzbCg0OCwgNjQlLCA4OSUpO1xyXG4gICAgLS1yZWQ6IGhzbGEoMCwgNzElLCA4NCUsIDEpO1xyXG4gICAgLS1ncmVlbjogaHNsYSgxMTQsIDYwJSwgNzUlLCAxKTtcclxuICAgIC0tYmx1ZTogaHNsYSgyMzUsIDU1JSwgODElLCAxKTtcclxuICB9XHJcblxyXG4gIC5jb250ZW50IHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gICAgd2lkdGg6IDEwMCU7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgfVxyXG5cclxuICAuaGVscC1zeW1ib2wge1xyXG4gICAgYm9yZGVyLXJhZGl1czogNTAlO1xyXG4gICAgYm9yZGVyOiAxcHggc29saWQgYmxhY2s7XHJcbiAgICB3aWR0aDogMTZweDtcclxuICAgIGhlaWdodDogMTZweDtcclxuICAgIHRleHQtYWxpZ246IGNlbnRlcjtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIHJpZ2h0OiAxMHB4O1xyXG4gICAgdG9wOiAxMHB4O1xyXG4gICAgY3Vyc29yOiBwb2ludGVyO1xyXG4gIH1cclxuXHJcbiAgLmhlbHAtc3ltYm9sOmhvdmVyIHtcclxuICAgIGJvcmRlci1jb2xvcjogYmx1ZTtcclxuICAgIGNvbG9yOiBibHVlO1xyXG4gIH1cclxuXHJcbiAgLnRvZ2dsZS1zZWFyY2gge1xyXG4gICAgYmFja2dyb3VuZDogYmx1ZTtcclxuICAgIHdpZHRoOiAzMHB4O1xyXG4gICAgaGVpZ2h0OiAzMHB4O1xyXG4gICAgY3Vyc29yOiBwb2ludGVyO1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgbGVmdDogLTMwcHg7XHJcbiAgICB0b3A6IDUwJTtcclxuICAgIHVzZXItc2VsZWN0OiBub25lO1xyXG4gIH1cclxuXHJcbiAgLmhpZGUgLnRvZ2dsZS1zZWFyY2gge1xyXG4gICAgbGVmdDogLTUycHg7XHJcbiAgfVxyXG5cclxuICAuc3RhdGlzdGljcyB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcclxuICB9XHJcbiAgLmlucHV0IHtcclxuICAgIHdpZHRoOiAxMDAlO1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gICAgYm94LXNpemluZzogYm9yZGVyLWJveDtcclxuICAgIHBhZGRpbmc6IDEwcHg7XHJcbiAgICByZXNpemU6IG5vbmU7XHJcbiAgfVxyXG5cclxuICAuY29udHJvbHMge1xyXG4gICAgZmxleC1zaHJpbms6IDA7XHJcbiAgICB3aWR0aDogMzAwcHg7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgICBiYWNrZ3JvdW5kOiBsaWdodGdyYXk7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcclxuICB9XHJcblxyXG4gIC5oZWxwIHtcclxuICAgIHBhZGRpbmc6IDBweCAxMHB4IDEwcHggMTBweDtcclxuICAgIHVzZXItc2VsZWN0OiBub25lO1xyXG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xyXG4gIH1cclxuXHJcbiAgLmdyb3VwLWNvbnRlbnQge1xyXG4gICAgZmxleC1ncm93OiAxO1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtd3JhcDogd3JhcDtcclxuICAgIHRyYW5zaXRpb246IGhlaWdodCA1MDBtcyBlYXNlO1xyXG4gIH1cclxuXHJcbiAgLmdyb3VwLWNvbnRlbnQuaGlkZGVuIHtcclxuICAgIG92ZXJmbG93OiBoaWRkZW47XHJcbiAgICBoZWlnaHQ6IDQ1cHg7XHJcbiAgfVxyXG5cclxuICAuY2FyZC1zZWFyY2gge1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gICAgZmxleC1ncm93OiAxO1xyXG4gICAgYmFja2dyb3VuZDogd2hpdGU7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIHJpZ2h0OiAwO1xyXG4gICAgd2lkdGg6IDMzJTtcclxuICAgIHotaW5kZXg6IDEwMDtcclxuICAgIGJveC1zaGFkb3c6IDBweCAwcHggMTBweCBibGFjaztcclxuICB9XHJcblxyXG4gIC5jYXJkLXNlYXJjaC5oaWRlIHtcclxuICAgIHJpZ2h0OiAtMzMlO1xyXG4gIH1cclxuXHJcbiAgLnNlYXJjaC1wYXJhbXMge1xyXG4gICAgZmxleC1zaHJpbms6IDA7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcclxuICB9XHJcblxyXG4gIC5zZWFyY2gtcmVzdWx0IHtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICAgIGZsZXgtZ3JvdzogMTtcclxuICAgIGJhY2tncm91bmQ6IHdoaXRlO1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgICBvdmVyZmxvdzogYXV0bztcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICAgIHVzZXItc2VsZWN0OiBub25lO1xyXG4gICAgZmxleC13cmFwOiB3cmFwO1xyXG4gIH1cclxuXHJcbiAgLmRpc3BsYXkge1xyXG4gICAgZmxleC1ncm93OiAxO1xyXG4gICAgYmFja2dyb3VuZDogZ3JheTtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gICAgZmxleC13cmFwOiBub3dyYXA7XHJcbiAgICBvdmVyZmxvdzogYXV0bztcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICAgIHVzZXItc2VsZWN0OiBub25lO1xyXG4gIH1cclxuXHJcbiAgLmxvYWRpbmctd3JhcHBlciB7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICBsZWZ0OiA1MCU7XHJcbiAgICB0b3A6IDA7XHJcbiAgICBib3R0b206IDA7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgYWxpZ24taXRlbXM6IGNlbnRlcjtcclxuICB9XHJcblxyXG4gIC5lbnRyeSB7XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgICBwYWRkaW5nOiAxMHB4O1xyXG4gICAgZmxleC1zaHJpbms6IDA7XHJcbiAgfVxyXG5cclxuICAuc2hvcGluZyB7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICB6LWluZGV4OiAxMDtcclxuICAgIGZvbnQtc2l6ZTogM2VtO1xyXG4gICAgdGV4dC1zaGFkb3c6IDBweCAwcHggNnB4IGJsYWNrO1xyXG4gICAgdGV4dC1hbGlnbjogY2VudGVyO1xyXG4gICAgYm90dG9tOiAxMCU7XHJcbiAgICByaWdodDogMTAlO1xyXG4gICAgZGlzcGxheTogbm9uZTtcclxuICB9XHJcblxyXG4gIC5lbnRyeTpob3ZlciAuc2hvcGluZyB7XHJcbiAgICBkaXNwbGF5OiBibG9jaztcclxuICB9XHJcblxyXG4gIC5zaG9waW5nIC5saW5rIHtcclxuICAgIHRleHQtZGVjb3JhdGlvbjogbm9uZTtcclxuICB9XHJcblxyXG4gIC5zaG9waW5nIC5saW5rOmhvdmVyIHtcclxuICAgIGNvbG9yOiB0cmFuc3BhcmVudDtcclxuICAgIHRleHQtc2hhZG93OiAwIDAgMCBibHVlO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQge1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgcmdiKDIyLCAyMiwgMjIpO1xyXG4gICAgYm9yZGVyLXJhZGl1czogMTBweDtcclxuICAgIG91dGxpbmU6IDA7XHJcbiAgICBib3gtc2hhZG93OiAwcHggMHB4IDEwcHggYmxhY2s7XHJcbiAgfVxyXG5cclxuICAuY2FyZC5iYW5uZWQge1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgcmVkO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQuaGlnaGxpZ2h0ZWQge1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgeWVsbG93O1xyXG4gIH1cclxuXHJcbiAgLmNhcmQ6aG92ZXIge1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgYmx1ZTtcclxuICAgIGN1cnNvcjogcG9pbnRlcjtcclxuICB9XHJcblxyXG4gIC5jYXJkLWNvbnRleHQtbWVudSB7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICB6LWluZGV4OiAxMDA7XHJcbiAgICBiYWNrZ3JvdW5kOiByZ2JhKDI1NSwgMjU1LCAyNTUsIDAuNyk7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgICB3aWR0aDogMTAwJTtcclxuICAgIC8qIHBhZGRpbmc6IDEwcHg7ICovXHJcbiAgICAvKiBtYXJnaW46IDEwcHg7ICovXHJcbiAgICBtYXJnaW4tbGVmdDogLTNweDtcclxuICAgIG1hcmdpbi10b3A6IC0zcHg7XHJcbiAgICBvdmVyZmxvdzogYXV0bztcclxuICB9XHJcblxyXG4gIC5jYXJkLWNvbnRleHQtZW50cnkge1xyXG4gICAgbWFyZ2luOiAxMHB4O1xyXG4gICAgZm9udC13ZWlnaHQ6IGJvbGQ7XHJcbiAgICBiYWNrZ3JvdW5kOiB3aGl0ZTtcclxuICAgIHBhZGRpbmc6IDVweDtcclxuICAgIGJvcmRlci1yYWRpdXM6IDlweDtcclxuICAgIGJveC1zaGFkb3c6IDAgMCA2cHggYmxhY2s7XHJcbiAgICBjdXJzb3I6IHBvaW50ZXI7XHJcbiAgfVxyXG5cclxuICAuY2FyZC1jb250ZXh0LWVudHJ5OmhvdmVyIHtcclxuICAgIGJhY2tncm91bmQ6IHdoZWF0O1xyXG4gIH1cclxuXHJcbiAgLnByaWNlLFxyXG4gIC5iYW5uZWQtdGV4dCxcclxuICAuY291bnQge1xyXG4gICAgZm9udC1zaXplOiAzNHB4O1xyXG4gICAgdGV4dC1zaGFkb3c6IDBweCAwcHggOXB4IGJsYWNrO1xyXG4gICAgY29sb3I6IHJlZDtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIHotaW5kZXg6IDEwMDtcclxuICAgIGZvbnQtd2VpZ2h0OiBib2xkO1xyXG4gICAgbGVmdDogMzRweDtcclxuICB9XHJcblxyXG4gIC5iYW5uZWQtdGV4dCB7XHJcbiAgICBmb250LXNpemU6IDEwMCU7XHJcbiAgICB0ZXh0LXNoYWRvdzogMHB4IDBweCA5cHggYmxhY2s7XHJcbiAgICBjb2xvcjogcmVkO1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgei1pbmRleDogMTAwO1xyXG4gICAgZm9udC13ZWlnaHQ6IGJvbGQ7XHJcbiAgICBsZWZ0OiAxNyU7XHJcbiAgfVxyXG4gIC5jb3VudCB7XHJcbiAgICB0b3A6IDE2NXB4O1xyXG4gIH1cclxuXHJcbiAgLnByaWNlIHtcclxuICAgIGJvdHRvbTogN3B4O1xyXG4gICAgY29sb3I6IHdoZWF0O1xyXG4gICAgZm9udC1zaXplOiAxMnB4O1xyXG4gICAgYmFja2dyb3VuZDogYmxhY2s7XHJcbiAgICBsZWZ0OiA0NSU7XHJcbiAgICBmb250LXdlaWdodDogbm9ybWFsO1xyXG4gIH1cclxuXHJcbiAgLmdyb3VwLWhlYWRlciB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgYmFja2dyb3VuZDogZGFya2dyZXk7XHJcbiAgICAvKiBwYWRkaW5nOiA4cHg7ICovXHJcbiAgICBtYXJnaW46IDhweCAwO1xyXG4gICAgYm94LXNoYWRvdzogMHB4IDBweCA4cHggYmxhY2s7XHJcbiAgICB3aWR0aDogMTAwJTtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgfVxyXG5cclxuICAuZ3JvdXAtaGVhZGVyIGgyIHtcclxuICAgIHBhZGRpbmc6IDAgMjVweDtcclxuICAgIG1hcmdpbjogMHB4O1xyXG4gIH1cclxuXHJcbiAgLmdyb3VwLXN0YXRpc3RpY3Mge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgfVxyXG5cclxuICAubWFuYS1wcm9wb3NhbCxcclxuICAubWFuYS1kZXZvdGlvbiB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICB9XHJcblxyXG4gIC5kZWNrLXZhbHVlLFxyXG4gIC5ncm91cC12YWx1ZSB7XHJcbiAgICBwYWRkaW5nOiA1cHg7XHJcbiAgICBjb2xvcjogYmxhY2s7XHJcbiAgICBib3JkZXItcmFkaXVzOiA1MCU7XHJcbiAgICB3aWR0aDogMTVweDtcclxuICAgIGhlaWdodDogMTVweDtcclxuICAgIHRleHQtYWxpZ246IGNlbnRlcjtcclxuICAgIG1hcmdpbjogNXB4O1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIHRleHQtYWxpZ246IGNlbnRlcjtcclxuICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7XHJcbiAgICBmb250LXNpemU6IDExcHg7XHJcbiAgICBmb250LXdlaWdodDogYm9sZDtcclxuICB9XHJcbiAgLmJsdWUge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0tYmx1ZSk7XHJcbiAgfVxyXG4gIC5ibGFjayB7XHJcbiAgICBjb2xvcjogd2hpdGU7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS1ibGFjayk7XHJcbiAgfVxyXG4gIC5yZWQge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0tcmVkKTtcclxuICB9XHJcbiAgLndoaXRlIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLXdoaXRlKTtcclxuICB9XHJcbiAgLmdyZWVuIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWdyZWVuKTtcclxuICB9XHJcbiAgLmNvbG9ybGVzcyB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS1jb2xvcmxlc3MpO1xyXG4gIH1cclxuICAuZ2VuZXJpYyB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiBnb2xkZW5yb2Q7XHJcbiAgfVxyXG4gIC5zdW0ge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogZ29sZGVucm9kO1xyXG4gIH1cclxuXHJcbiAgLmNvbG9yLXBhcmFtIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gIH1cclxuXHJcbiAgLm1hbmEtY3VydmUge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XHJcbiAgfVxyXG5cclxuICAuYWxsLWN1cnZlcyB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1ncm93OiAxO1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICAgIGhlaWdodDogODBweDtcclxuICB9XHJcblxyXG4gIC5hbGwtbGFiZWxzIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LXNocmluazogMDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgfVxyXG5cclxuICAuY3VydmUtZWxlbWVudCB7XHJcbiAgICB3aWR0aDogMjBweDtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICBib3R0b206IDA7XHJcbiAgICBiYWNrZ3JvdW5kOiBncmF5O1xyXG4gICAgLyogdmVydGljYWwtYWxpZ246IG1pZGRsZTsgKi9cclxuICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgfVxyXG5cclxuICAuY3VydmUtbGFiZWwge1xyXG4gICAgd2lkdGg6IDIwcHg7XHJcbiAgfVxyXG4gIC5jdXJ2ZS13cmFwcGVyIHtcclxuICAgIHdpZHRoOiAyMHB4O1xyXG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xyXG4gICAgY3Vyc29yOiBwb2ludGVyO1xyXG4gIH1cclxuXHJcbiAgLmN1cnZlLWVsZW1lbnQ6aG92ZXIge1xyXG4gICAgYmFja2dyb3VuZDogbGlnaHRjb3JhbDtcclxuICB9XHJcblxyXG4gIC5oaWdobGlnaHRlZCAuY3VydmUtZWxlbWVudCB7XHJcbiAgICBiYWNrZ3JvdW5kOiBsaWdodGJsdWU7XHJcbiAgfVxyXG5cclxuICAuY3VydmUtbGFiZWwuaGlnaGxpZ2h0ZWQge1xyXG4gICAgYmFja2dyb3VuZDogbGlnaHRibHVlO1xyXG4gIH1cclxuXHJcbiAgLmN1cnZlLWxhYmVsOmhvdmVyIHtcclxuICAgIGJhY2tncm91bmQ6IGxpZ2h0Y29yYWw7XHJcbiAgfVxyXG5cclxuICBoNCB7XHJcbiAgICBtYXJnaW4tdG9wOiA1cHg7XHJcbiAgICBtYXJnaW4tYm90dG9tOiA1cHg7XHJcbiAgfVxyXG5cclxuICAubGRzLXJpcHBsZSB7XHJcbiAgICBkaXNwbGF5OiBpbmxpbmUtYmxvY2s7XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgICB3aWR0aDogODBweDtcclxuICAgIGhlaWdodDogODBweDtcclxuICB9XHJcbiAgLmxkcy1yaXBwbGUgZGl2IHtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIGJvcmRlcjogNHB4IHNvbGlkICNmZmY7XHJcbiAgICBvcGFjaXR5OiAxO1xyXG4gICAgYm9yZGVyLXJhZGl1czogNTAlO1xyXG4gICAgYW5pbWF0aW9uOiBsZHMtcmlwcGxlIDFzIGN1YmljLWJlemllcigwLCAwLjIsIDAuOCwgMSkgaW5maW5pdGU7XHJcbiAgfVxyXG5cclxuICAuY2FyZC1zZWFyY2ggLmxkcy1yaXBwbGUgZGl2IHtcclxuICAgIGJvcmRlcjogNHB4IHNvbGlkIGJsYWNrO1xyXG4gIH1cclxuXHJcbiAgLmxkcy1yaXBwbGUgZGl2Om50aC1jaGlsZCgyKSB7XHJcbiAgICBhbmltYXRpb24tZGVsYXk6IC0wLjVzO1xyXG4gIH1cclxuICBAa2V5ZnJhbWVzIGxkcy1yaXBwbGUge1xyXG4gICAgMCUge1xyXG4gICAgICB0b3A6IDM2cHg7XHJcbiAgICAgIGxlZnQ6IDM2cHg7XHJcbiAgICAgIHdpZHRoOiAwO1xyXG4gICAgICBoZWlnaHQ6IDA7XHJcbiAgICAgIG9wYWNpdHk6IDE7XHJcbiAgICB9XHJcbiAgICAxMDAlIHtcclxuICAgICAgdG9wOiAwcHg7XHJcbiAgICAgIGxlZnQ6IDBweDtcclxuICAgICAgd2lkdGg6IDcycHg7XHJcbiAgICAgIGhlaWdodDogNzJweDtcclxuICAgICAgb3BhY2l0eTogMDtcclxuICAgIH1cclxuICB9XHJcbjwvc3R5bGU+XHJcblxyXG48c3ZlbHRlOndpbmRvd1xyXG4gIG9uOm1vdXNldXA9e29uTWFpbk1vdXNlRG93bn1cclxuICBvbjpjb250ZXh0bWVudXxwcmV2ZW50RGVmYXVsdD17KCkgPT4gZmFsc2V9XHJcbiAgb246a2V5dXA9e21haW5LZXlVcH1cclxuICBvbjprZXlkb3duPXttYWluS2V5RG93bn0gLz5cclxuPGRpdiBjbGFzcz1cImNvbnRlbnRcIj5cclxuICA8ZGl2IGNsYXNzPVwiY29udHJvbHNcIj5cclxuICAgIDxkaXYgY2xhc3M9XCJoZWxwXCI+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJoZWxwLXN5bWJvbFwiIG9uOmNsaWNrPXtvcGVuSGVscH0+PzwvZGl2PlxyXG4gICAgICB7I2lmIGhlbHBBY3RpdmV9XHJcbiAgICAgICAgPGg0PkhvdyB0byB1c2U6PC9oND5cclxuICAgICAgICA8cD5wYXN0ZSB5b3VyIGRlY2sgdG8gdGhlIGZvbGxvd2luZyBpbnB1dC48L3A+XHJcbiAgICAgICAgPHVsPlxyXG4gICAgICAgICAgPGxpPlxyXG4gICAgICAgICAgICB3aGVuIGEgbGluZSBzdGFydHMgd2l0aCBcIiNcIiBpdCB3aWxsIGJlIGludGVycHJldGVkIGFzIGhlYWRsaW5lXHJcbiAgICAgICAgICA8L2xpPlxyXG4gICAgICAgICAgPGxpPlxyXG4gICAgICAgICAgICBhIGNhcmQgY2FuIGJlIGVudGVyZWQgd2l0aCBhIGxlYWRpbmcgY291bnQsIG9yIGp1c3Qgd2l0aCBpdHMgbmFtZVxyXG4gICAgICAgICAgPC9saT5cclxuICAgICAgICAgIDxsaT51c2UgdGhlIFwiRVNDXCIga2V5IHRvIHJlYWxvYWQgdGhlIHByZXZpZXc8L2xpPlxyXG4gICAgICAgICAgPGxpPmRvdWJsZWNsaWNrIGEgY2FyZCB0byByZW1vdmUgaXQ8L2xpPlxyXG4gICAgICAgIDwvdWw+XHJcbiAgICAgICAgPHA+Tk9URTogd2UgdXNlIGNvb2tpZXMgdG8gc3RvcmUgeW91ciBkZWNrIGFmdGVyIHJlbG9hZC48L3A+XHJcbiAgICAgICAgPHA+Tk9URTogVGhpcyBpcyBub3QgYW4gb2ZmaWNpYWwgTWFnaWMgcHJvZHVrdC48L3A+XHJcbiAgICAgIHsvaWZ9XHJcblxyXG4gICAgICB7I2F3YWl0IHByb21pc2V9XHJcblxyXG4gICAgICAgIDxkaXY+bG9hZGluZzoge3Byb2dyZXNzfS97YWxsfTwvZGl2PlxyXG4gICAgICB7OnRoZW4gZ3JvdXBzfVxyXG5cclxuICAgICAgICB7I2lmICFoZWxwQWN0aXZlfVxyXG4gICAgICAgICAgPGg0PkdlbmVyYWw8L2g0PlxyXG5cclxuICAgICAgICAgIDxkaXY+VG90YWwgY2FyZHM6IHtncm91cHNbJ2NhcmRDb3VudCddfTwvZGl2PlxyXG4gICAgICAgICAgPGRpdj5cclxuICAgICAgICAgICAgTGFuZHM6IHtncm91cHNbJ2xhbmRDb3VudCddfSBOb25sYW5kczoge2dyb3Vwc1snY2FyZENvdW50J10gLSBncm91cHNbJ2xhbmRDb3VudCddfVxyXG4gICAgICAgICAgPC9kaXY+XHJcblxyXG4gICAgICAgICAgPGRpdj5DcmVhdHVyZXM6IHtncm91cHNbJ2NyZWF0dXJlQ291bnQnXX08L2Rpdj5cclxuICAgICAgICAgIDxkaXY+SW5zdGFudHM6IHtncm91cHNbJ2luc3RhbnRDb3VudCddfTwvZGl2PlxyXG4gICAgICAgICAgPGRpdj5Tb3JjZXJpZXM6IHtncm91cHNbJ3NvcmNlcnlDb3VudCddfTwvZGl2PlxyXG4gICAgICAgICAgPGRpdj5FbmNoYW50bWVudHM6IHtncm91cHNbJ2VuY2hhbnRtZW50Q291bnQnXX08L2Rpdj5cclxuICAgICAgICAgIDxkaXY+QXJ0aWZhY3RzOiB7Z3JvdXBzWydhcnRpZmFjdENvdW50J119PC9kaXY+XHJcblxyXG4gICAgICAgICAgPGRpdj5Db3N0OiB7Z3JvdXBzLmNvc3QudG9GaXhlZCgyKSArICckJ308L2Rpdj5cclxuXHJcbiAgICAgICAgICB7I2lmIHN0YXRpc3RpY3NBY3RpdmV9XHJcbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJzdGF0aXN0aWNzXCI+XHJcbiAgICAgICAgICAgICAgPGg0PkRldm90aW9uPC9oND5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwibWFuYS1kZXZvdGlvblwiPlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgYmx1ZVwiPntncm91cHNbJ21hbmEnXS5ibHVlfTwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgYmxhY2tcIj57Z3JvdXBzWydtYW5hJ10uYmxhY2t9PC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSByZWRcIj57Z3JvdXBzWydtYW5hJ10ucmVkfTwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgd2hpdGVcIj57Z3JvdXBzWydtYW5hJ10ud2hpdGV9PC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBncmVlblwiPntncm91cHNbJ21hbmEnXS5ncmVlbn08L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGNvbG9ybGVzc1wiPlxyXG4gICAgICAgICAgICAgICAgICB7Z3JvdXBzWydtYW5hJ10uY29sb3JsZXNzfVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcblxyXG4gICAgICAgICAgICAgIDxoND5HZW5lcmljIE1hbmE8L2g0PlxyXG4gICAgICAgICAgICAgIDxkaXY+UmVtYWluaW5nIGdlbmVyaWMgbWFuYSBjb3N0czp7Z3JvdXBzWydtYW5hJ10uZ2VuZXJpY308L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2PkNNQy1NYW5hLVN1bTp7Z3JvdXBzWydtYW5hJ10uc3VtfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXY+XHJcbiAgICAgICAgICAgICAgICBBdmVyYWdlIENNQyBwZXIgTm9ubGFuZDoge2dyb3Vwc1snYXZlcmFnZU1hbmEnXS50b0ZpeGVkKDIpfVxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgIDxoND5TdWdnZXN0ZWQgTWFuYSBEaXN0cmlidXRpb248L2g0PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJtYW5hLXByb3Bvc2FsXCI+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBibHVlXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS5ibHVlICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgYmxhY2tcIj5cclxuICAgICAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLmJsYWNrICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgcmVkXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS5yZWQgKiBncm91cHNbJ2xhbmRDb3VudCddKS50b0ZpeGVkKDEpfVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSB3aGl0ZVwiPlxyXG4gICAgICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10ud2hpdGUgKiBncm91cHNbJ2xhbmRDb3VudCddKS50b0ZpeGVkKDEpfVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBncmVlblwiPlxyXG4gICAgICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10uZ3JlZW4gKiBncm91cHNbJ2xhbmRDb3VudCddKS50b0ZpeGVkKDEpfVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBjb2xvcmxlc3NcIj5cclxuICAgICAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLmNvbG9ybGVzcyAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICA8aDQ+TWFuYSBDdXJ2ZTwvaDQ+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cIm1hbmEtY3VydmVcIj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJhbGwtY3VydmVzXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsjZWFjaCBncm91cHNbJ21hbmFDdXJ2ZSddIGFzIG1hbmEsIGl9XHJcbiAgICAgICAgICAgICAgICAgICAgeyNpZiBtYW5hID4gMH1cclxuICAgICAgICAgICAgICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJjdXJ2ZS13cmFwcGVyXCJcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M6aGlnaGxpZ2h0ZWQ9e2Rldm90aW9uSGlnaGxpZ2h0ID09IGl9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG9uOmNsaWNrPXsoKSA9PiBoaWdobGlnaHREZXZvdGlvbihpKX0+XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImN1cnZlLWVsZW1lbnRcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHN0eWxlPXsnaGVpZ2h0OicgKyBnZXRIZWlnaHQobWFuYSwgZ3JvdXBzKSArICclOyd9PlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHttYW5hIHx8ICcnfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgICAgIHsvaWZ9XHJcbiAgICAgICAgICAgICAgICAgIHsvZWFjaH1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJhbGwtbGFiZWxzXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsjZWFjaCBncm91cHNbJ21hbmFDdXJ2ZSddIGFzIG1hbmEsIGl9XHJcbiAgICAgICAgICAgICAgICAgICAgeyNpZiBtYW5hID4gMH1cclxuICAgICAgICAgICAgICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJjdXJ2ZS1sYWJlbFwiXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzOmhpZ2hsaWdodGVkPXtkZXZvdGlvbkhpZ2hsaWdodCA9PSBpfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBvbjpjbGljaz17KCkgPT4gaGlnaGxpZ2h0RGV2b3Rpb24oaSl9PlxyXG4gICAgICAgICAgICAgICAgICAgICAgICB7aX1cclxuICAgICAgICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgICAgIHsvaWZ9XHJcbiAgICAgICAgICAgICAgICAgIHsvZWFjaH1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIHsvaWZ9XHJcbiAgICAgICAgey9pZn1cclxuICAgICAgICA8ZGl2PlxyXG4gICAgICAgICAgc2VhcmNoOlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17ZGVja1NlYXJjaElucHV0fVxyXG4gICAgICAgICAgICB0aXRsZT1cImUuZy46IHNhY3JpZmljZSBhIChhcnRpZmFjdHxjcmVhdHVyZSlcIlxyXG4gICAgICAgICAgICBvbjprZXl1cD17KCkgPT4gY2hhbmdlRGVja1NlYXJjaChncm91cHMpfSAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICB7OmNhdGNoIGVycm9yfVxyXG4gICAgICAgIHtlcnJvcn1cclxuICAgICAgey9hd2FpdH1cclxuICAgICAgRm9ybWF0OlxyXG4gICAgICA8c2VsZWN0XHJcbiAgICAgICAgYmluZDp0aGlzPXtmb3JtYXR9XHJcbiAgICAgICAgb246Ymx1cj17cmVsb2FkfVxyXG4gICAgICAgIG9uOmNoYW5nZT17cmVsb2FkfVxyXG4gICAgICAgIHRpdGxlPVwic2VsZWN0IHRoZSBsZWdhbGl0eSBjaGVja2VyXCI+XHJcbiAgICAgICAgPG9wdGlvbiBzZWxlY3RlZD5jb21tYW5kZXI8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPmJyYXdsPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5kdWVsPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5mdXR1cmU8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPmhpc3RvcmljPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5sZWdhY3k8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPm1vZGVybjwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+b2xkc2Nob29sPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5wYXVwZXI8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnBlbm55PC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5waW9uZWVyPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5zdGFuZGFyZDwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+dmludGFnZTwvb3B0aW9uPlxyXG4gICAgICA8L3NlbGVjdD5cclxuICAgICAgPGRpdiBjbGFzcz1cInNsaWRlY29udGFpbmVyXCI+XHJcbiAgICAgICAgU2NhbGU6XHJcbiAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICB0eXBlPVwicmFuZ2VcIlxyXG4gICAgICAgICAgbWluPVwiMjVcIlxyXG4gICAgICAgICAgbWF4PVwiMTAwXCJcclxuICAgICAgICAgIGJpbmQ6dmFsdWU9e3NjYWxpbmd9XHJcbiAgICAgICAgICB0aXRsZT1cInNjYWxlcyB0aGUgY2FyZCBzaXplIGluIHRoZSByaWdodCB2aWV3XCIgLz5cclxuICAgICAgPC9kaXY+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJzYXZlLWNvbnRhaW5lclwiPlxyXG4gICAgICAgIFNhdmUgOlxyXG4gICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgYmluZDp0aGlzPXtkZWNrTmFtZUlucHV0fVxyXG4gICAgICAgICAgb246a2V5dXA9e29uRGVja05hbWVUeXBlfVxyXG4gICAgICAgICAgdmFsdWU9e0Nvb2tpZXMuZ2V0KCdkZWNrTmFtZScpIHx8ICd1bmtub3duX2RlY2snfVxyXG4gICAgICAgICAgdGl0bGU9XCJUaGUgbmFtZSBvZiB0aGUgZGVjayBmb3Igc2F2aW5nXCIgLz5cclxuICAgICAgICA8YnV0dG9uXHJcbiAgICAgICAgICBvbjpjbGljaz17c2F2ZURlY2t9XHJcbiAgICAgICAgICB0aXRsZT1cInRoaXMgd2lsbCBkb3dubG9hZCB5b3UgYSBmaWxlLCBjYWxsZWQgbGlrZSB5b3UgcHJvdmlkZSBpbiB0aGVcclxuICAgICAgICAgIGRlY2tcIj5cclxuICAgICAgICAgIHNhdmVcclxuICAgICAgICA8L2J1dHRvbj5cclxuICAgICAgPC9kaXY+XHJcbiAgICAgIDxidXR0b25cclxuICAgICAgICBvbjpjbGljaz17dG9nZ2xlU3RhdGlzdGljc31cclxuICAgICAgICB0aXRsZT1cInRvZ2dsZXMgdGhlIHZpc2liaWxpdHkgb2YgdGhlIHN0YXRpc3RpY2tzXCI+XHJcbiAgICAgICAge3N0YXRpc3RpY3NBY3RpdmUgPyAnaGlkZSBzdGF0aXN0aWNzJyA6ICdzaG93IHN0YXRpc3RpY3MnfVxyXG4gICAgICA8L2J1dHRvbj5cclxuICAgICAgPGJ1dHRvblxyXG4gICAgICAgIG9uOmNsaWNrPXtzb3J0RGVja1N0cmluZ31cclxuICAgICAgICB0aXRsZT1cInRoaXMgc29ydHMgdGhlIGRlY2sgdG8gbGFuZHMgc3BlbGxzIGFuZCBjcmVhdHVyZXMgLU5PVEU6IHlvdXJcclxuICAgICAgICBncm91cHMgd2lsbCBiZSByZXBsYWNlZFwiPlxyXG4gICAgICAgIHNvcnRcclxuICAgICAgPC9idXR0b24+XHJcbiAgICAgIDxidXR0b25cclxuICAgICAgICBvbjpjbGljaz17Y29weURlY2t9XHJcbiAgICAgICAgdGl0bGU9XCJ0aGlzIGNvcGllcyB0aGUgZGVjayB3aXRob3V0IGdyb3VwcyBhbmQgc3R1ZmYgdG8geW91ciBjbGlwYm9hcmRcIj5cclxuICAgICAgICBjbGVhbiBjb3B5XHJcbiAgICAgIDwvYnV0dG9uPlxyXG4gICAgICA8YnV0dG9uXHJcbiAgICAgICAgb246Y2xpY2s9e3NoYXJlRGVja31cclxuICAgICAgICB0aXRsZT1cImNvcGllcyBhIHN0cmluZyB0byB5b3VyIGNsaXBib2FyZCwgdGhhdCBzaGFyZXMgdGhpcyBkZWNrIHdpdGhcclxuICAgICAgICBvdGhlcnNcIj5cclxuICAgICAgICBzaGFyZVxyXG4gICAgICA8L2J1dHRvbj5cclxuXHJcbiAgICAgIDxidXR0b24gb246Y2xpY2s9e3JlbG9hZH0+cmVmcmVzaDwvYnV0dG9uPlxyXG4gICAgPC9kaXY+XHJcbiAgICA8dGV4dGFyZWEgYmluZDp0aGlzPXtpbnB1dH0gY2xhc3M9XCJpbnB1dFwiIG9uOmtleXVwPXtvblR5cGluZ30gLz5cclxuICA8L2Rpdj5cclxuXHJcbiAgPGRpdiBjbGFzcz1cImRpc3BsYXlcIiBiaW5kOnRoaXM9e2Rpc3BsYXl9PlxyXG4gICAgeyNhd2FpdCBwcm9taXNlfVxyXG4gICAgICA8ZGl2IGNsYXNzPVwibG9hZGluZy13cmFwcGVyXCI+XHJcbiAgICAgICAgPGRpdj5sb2FkaW5nOiB7cHJvZ3Jlc3N9L3thbGx9PC9kaXY+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImxkcy1yaXBwbGVcIj5cclxuICAgICAgICAgIDxkaXYgLz5cclxuICAgICAgICAgIDxkaXYgLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgPC9kaXY+XHJcbiAgICB7OnRoZW4gZ3JvdXBzfVxyXG5cclxuICAgICAgeyNlYWNoIGRlY2tTZWFjaCB8fCBncm91cHMgfHwgW10gYXMgZ3JvdXB9XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwXCI+XHJcblxyXG4gICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLWhlYWRlclwiPlxyXG4gICAgICAgICAgICA8aDI+e2dyb3VwLm5hbWUgKyAnIC8vICcgKyBncm91cC5jb3VudCB8fCAnbm8gbmFtZSd9PC9oMj5cclxuICAgICAgICAgICAgPGJ1dHRvbiBvbjpjbGljaz17KCkgPT4gdG9nZ2xlR3JvdXBWaXNpYmlsaXR5KGdyb3VwKX0+XHJcbiAgICAgICAgICAgICAgdG9nZ2xlXHJcbiAgICAgICAgICAgIDwvYnV0dG9uPlxyXG4gICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtc3RhdGlzdGljc1wiPlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSBibHVlXCI+e2dyb3VwLm1hbmEuYmx1ZX08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgYmxhY2tcIj57Z3JvdXAubWFuYS5ibGFja308L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgcmVkXCI+e2dyb3VwLm1hbmEucmVkfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSB3aGl0ZVwiPntncm91cC5tYW5hLndoaXRlfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSBncmVlblwiPntncm91cC5tYW5hLmdyZWVufTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSBjb2xvcmxlc3NcIj57Z3JvdXAubWFuYS5jb2xvcmxlc3N9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPCEtLSBnZW5lcmljOlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSBnZW5lcmljXCI+e2dyb3VwLm1hbmEuZ2VuZXJpY308L2Rpdj4gLS0+XHJcbiAgICAgICAgICAgICAgc3VtOlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSBzdW1cIj57Z3JvdXAubWFuYS5zdW19PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGdyb3VwLWNvc3RcIj5cclxuICAgICAgICAgICAgICAgIHtncm91cC5jb3N0LnRvRml4ZWQoMikgKyAnJCd9XHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICBjbGFzcz1cImdyb3VwLWNvbnRlbnRcIlxyXG4gICAgICAgICAgICBjbGFzczpoaWRkZW49e2hpZGRlbkdyb3Vwcy5oYXMoZ3JvdXAubmFtZSl9PlxyXG5cclxuICAgICAgICAgICAgeyNlYWNoIGdyb3VwLmNhcmRzIGFzIGNhcmR9XHJcbiAgICAgICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICAgICAgY2xhc3M9XCJlbnRyeVwiXHJcbiAgICAgICAgICAgICAgICBzdHlsZT17J3dpZHRoOicgKyB3aWR0aCArICdweDsgaGVpZ2h0OicgKyAoY2FyZC5jb3VudCA8PSA0ID8gaGVpZ2h0ICsgKChjYXJkLmNvdW50IHx8IDEpIC0gMSkgKiA0MCA6IGhlaWdodCArIDMgKiA0MCkgKyAncHg7J30+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwic2hvcGluZ1wiPlxyXG4gICAgICAgICAgICAgICAgICA8YVxyXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwibGlua1wiXHJcbiAgICAgICAgICAgICAgICAgICAgaHJlZj17Y2FyZC5kYXRhLnB1cmNoYXNlX3VyaXMuY2FyZG1hcmtldH1cclxuICAgICAgICAgICAgICAgICAgICB0YXJnZXQ9XCJfYmxhbmtcIj5cclxuICAgICAgICAgICAgICAgICAgICAmIzEyODcyMjtcclxuICAgICAgICAgICAgICAgICAgPC9hPlxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICB7I2VhY2ggeyBsZW5ndGg6IGNhcmQuY291bnQgPiA0ID8gNCA6IGNhcmQuY291bnQgfSBhcyBfLCBpfVxyXG4gICAgICAgICAgICAgICAgICA8aW1nXHJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M6YmFubmVkPXtjYXJkLmRhdGEubGVnYWxpdGllc1tmb3JtYXQudmFsdWVdICE9PSAnbGVnYWwnfVxyXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzOmhpZ2hsaWdodGVkPXtkZXZvdGlvbkhpZ2hsaWdodCA9PSBjYXJkLmRhdGEuY21jfVxyXG4gICAgICAgICAgICAgICAgICAgIG9uOm1vdXNldXB8c3RvcFByb3BhZ2F0aW9uPXtldnQgPT4gY2FyZENvbnRleHRNZW51KGV2dCwgY2FyZCwgZ3JvdXBzKX1cclxuICAgICAgICAgICAgICAgICAgICBvbjpkYmxjbGljaz17KCkgPT4gcmVtb3ZlKGNhcmQpfVxyXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiY2FyZFwiXHJcbiAgICAgICAgICAgICAgICAgICAgc3R5bGU9eydtYXJnaW4tdG9wOiAnICsgaSAqIDQwICsgJ3B4J31cclxuICAgICAgICAgICAgICAgICAgICBzcmM9e2NhcmQudXJsfVxyXG4gICAgICAgICAgICAgICAgICAgIGFsdD17Y2FyZC5uYW1lfVxyXG4gICAgICAgICAgICAgICAgICAgIHt3aWR0aH1cclxuICAgICAgICAgICAgICAgICAgICB7aGVpZ2h0fSAvPlxyXG4gICAgICAgICAgICAgICAgey9lYWNofVxyXG5cclxuICAgICAgICAgICAgICAgIHsjaWYgY2FyZC5kYXRhLmxlZ2FsaXRpZXNbZm9ybWF0LnZhbHVlXSAhPT0gJ2xlZ2FsJ31cclxuICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImJhbm5lZC10ZXh0XCI+QkFOTkVEPC9kaXY+XHJcbiAgICAgICAgICAgICAgICB7L2lmfVxyXG4gICAgICAgICAgICAgICAgeyNpZiBjYXJkLmNvdW50ID4gNH1cclxuICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImNvdW50XCI+e2NhcmQuY291bnR9eDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgey9pZn1cclxuXHJcbiAgICAgICAgICAgICAgICB7I2lmIHNjYWxpbmcgPiA5MH1cclxuICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cInByaWNlXCI+e2NhcmQuZGF0YS5wcmljZXMudXNkICsgJyQnIHx8ICc/Pz8nfTwvZGl2PlxyXG4gICAgICAgICAgICAgICAgey9pZn1cclxuXHJcbiAgICAgICAgICAgICAgICB7I2lmIGN1cnJlbnRDYXJkQ29udGV4dCA9PT0gY2FyZH1cclxuICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImNhcmQtY29udGV4dC1tZW51XCI+XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIHsjZWFjaCBncm91cHMgYXMgc3ViR3JvdXB9XHJcbiAgICAgICAgICAgICAgICAgICAgICB7I2lmIGdyb3VwLm5hbWUgIT0gc3ViR3JvdXAubmFtZX1cclxuICAgICAgICAgICAgICAgICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiY2FyZC1jb250ZXh0LWVudHJ5XCJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICBvbjptb3VzZWRvd249e2V2dCA9PiBjYXJkQ29udGV4dENsaWNrKGV2dCwgY2FyZCwgc3ViR3JvdXApfT5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICB7c3ViR3JvdXAubmFtZX1cclxuICAgICAgICAgICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICAgICAgICB7L2lmfVxyXG4gICAgICAgICAgICAgICAgICAgIHsvZWFjaH1cclxuICAgICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICB7L2lmfVxyXG5cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgey9lYWNofVxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgIHsvZWFjaH1cclxuXHJcbiAgICB7OmNhdGNoIGVycm9yfVxyXG5cclxuICAgICAgPGRpdiBjbGFzcz1cImVycm9yXCI+XHJcbiAgICAgICAgRVJST1IsIGNoZWNrIHlvdXIgZGVja2xpc3QgZm9yIGNvcnJlY3QgZm9ybWF0IG9yIGludGVybmV0IGNvbm5lY3Rpb25cclxuICAgICAgICBicnVkaVxyXG4gICAgICA8L2Rpdj5cclxuICAgIHsvYXdhaXR9XHJcbiAgPC9kaXY+XHJcblxyXG4gIDxkaXYgY2xhc3M9XCJjYXJkLXNlYXJjaFwiIGNsYXNzOmhpZGU9eyFjYXJkU2VhcmNoQWN0aXZlfT5cclxuICAgIDxkaXYgY2xhc3M9XCJ0b2dnbGUtc2VhcmNoXCIgb246Y2xpY2s9e3RvZ2dsZVNlYXJjaH0+eDwvZGl2PlxyXG4gICAgPGRpdiBjbGFzcz1cInNlYXJjaC1wYXJhbXNcIj5cclxuICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1wYXJhbVwiPlxyXG4gICAgICAgIE5hbWU6XHJcbiAgICAgICAgPGlucHV0IGJpbmQ6dGhpcz17c3BOYW1lfSAvPlxyXG4gICAgICA8L2Rpdj5cclxuICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1wYXJhbVwiPlxyXG4gICAgICAgIFRleHQ6XHJcbiAgICAgICAgPGlucHV0IGJpbmQ6dGhpcz17c3BUZXh0fSAvPlxyXG4gICAgICA8L2Rpdj5cclxuICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1wYXJhbVwiPlxyXG4gICAgICAgIFR5cGU6XHJcbiAgICAgICAgPGlucHV0IGJpbmQ6dGhpcz17c3BUeXBlfSAvPlxyXG4gICAgICA8L2Rpdj5cclxuXHJcbiAgICAgIDxkaXYgY2xhc3M9XCJzZWFyY2gtcGFyYW0gY29sb3ItcGFyYW1cIj5cclxuICAgICAgICBDb21tYW5kZXItQ29sb3JzOlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJibHVlXCI+XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgdHlwZT1cImNoZWNrYm94XCJcclxuICAgICAgICAgICAgb246Y2xpY2s9e2NsZWFyQ29sb3JsZXNzfVxyXG4gICAgICAgICAgICBjbGFzcz1cImJsdWVcIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIQmx1ZX0gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiYmxhY2tcIj5cclxuICAgICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgICB0eXBlPVwiY2hlY2tib3hcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17Y2xlYXJDb2xvcmxlc3N9XHJcbiAgICAgICAgICAgIGNsYXNzPVwiYmxhY2tcIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIQmxhY2t9IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cInJlZFwiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJyZWRcIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIUmVkfSAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJ3aGl0ZVwiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJ3aGl0ZVwiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhXaGl0ZX0gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JlZW5cIj5cclxuICAgICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgICB0eXBlPVwiY2hlY2tib3hcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17Y2xlYXJDb2xvcmxlc3N9XHJcbiAgICAgICAgICAgIGNsYXNzPVwiZ3JlZW5cIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIR3JlZW59IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImNvbG9ybGVzc1wiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckZvckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJjb2xvcmxlc3NcIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIQ29sb3JsZXNzfSAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICA8L2Rpdj5cclxuICAgICAgPGJ1dHRvbiBvbjpjbGljaz17c2VhcmNoQ2FyZHN9PnNlYXJjaDwvYnV0dG9uPlxyXG4gICAgPC9kaXY+XHJcblxyXG4gICAgeyNhd2FpdCBjYXJkU2VhcmNoUHJvbWlzZX1cclxuICAgICAgPGRpdiBjbGFzcz1cImxvYWRpbmctd3JhcHBlclwiPlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJsZHMtcmlwcGxlXCI+XHJcbiAgICAgICAgICA8ZGl2IC8+XHJcbiAgICAgICAgICA8ZGl2IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgezp0aGVuIHJlc3VsdH1cclxuXHJcbiAgICAgIHsjaWYgcmVzdWx0LmNvZGUgIT09ICdub3RfZm91bmQnICYmIHJlc3VsdC5kYXRhfVxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJzZWFyY2gtcmVzdWx0XCI+XHJcbiAgICAgICAgICB7I2VhY2ggcmVzdWx0LmRhdGEgYXMgY2FyZH1cclxuICAgICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICAgIGNsYXNzPVwiZW50cnlcIlxyXG4gICAgICAgICAgICAgIHN0eWxlPXsnd2lkdGg6JyArIHdpZHRoICsgJ3B4OyBoZWlnaHQ6JyArIGhlaWdodCArICdweDsnfT5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwic2hvcGluZ1wiPlxyXG4gICAgICAgICAgICAgICAgPGEgY2xhc3M9XCJsaW5rXCIgaHJlZj17Y2FyZC5jYXJkbWFya2V0fSB0YXJnZXQ9XCJfYmxhbmtcIj5cclxuICAgICAgICAgICAgICAgICAgJiMxMjg3MjI7XHJcbiAgICAgICAgICAgICAgICA8L2E+XHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgPGltZ1xyXG4gICAgICAgICAgICAgICAgb246ZGJsY2xpY2s9eygpID0+IGFwcGVuZENhcmQoY2FyZC5uYW1lKX1cclxuICAgICAgICAgICAgICAgIGNsYXNzOmJhbm5lZD17Y2FyZC5sZWdhbGl0aWVzW2Zvcm1hdC52YWx1ZV0gIT09ICdsZWdhbCd9XHJcbiAgICAgICAgICAgICAgICBjbGFzcz1cImNhcmRcIlxyXG4gICAgICAgICAgICAgICAgc3JjPXtjYXJkLnVybH1cclxuICAgICAgICAgICAgICAgIGFsdD17Y2FyZC5uYW1lfVxyXG4gICAgICAgICAgICAgICAge3dpZHRofVxyXG4gICAgICAgICAgICAgICAge2hlaWdodH0gLz5cclxuXHJcbiAgICAgICAgICAgICAgeyNpZiBjYXJkLmxlZ2FsaXRpZXNbZm9ybWF0LnZhbHVlXSAhPT0gJ2xlZ2FsJ31cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJiYW5uZWQtdGV4dFwiPkJBTk5FRDwvZGl2PlxyXG4gICAgICAgICAgICAgIHsvaWZ9XHJcbiAgICAgICAgICAgICAgeyNpZiBzY2FsaW5nID4gOTB9XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwicHJpY2VcIj57Y2FyZC5wcmljZXMudXNkICsgJyQnIHx8ICc/Pz8nfTwvZGl2PlxyXG4gICAgICAgICAgICAgIHsvaWZ9XHJcbiAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgezplbHNlfVxyXG4gICAgICAgICAgICA8ZGl2Pk5vIGNhcmRzIGZvdW5kPC9kaXY+XHJcbiAgICAgICAgICB7L2VhY2h9XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGJ1dHRvblxyXG4gICAgICAgICAgZGlzYWJsZWQ9eyFyZXN1bHQuaGFzX21vcmV9XHJcbiAgICAgICAgICBvbjpjbGljaz17KCkgPT4gc2VhcmNoQ2FyZHMocmVzdWx0Lm5leHRfcGFnZSl9PlxyXG4gICAgICAgICAgbmV4dFxyXG4gICAgICAgIDwvYnV0dG9uPlxyXG4gICAgICB7OmVsc2V9XHJcbiAgICAgICAgPGRpdj5ObyBjYXJkcyBmb3VuZDwvZGl2PlxyXG4gICAgICB7L2lmfVxyXG4gICAgezpjYXRjaCBlcnJvcn1cclxuICAgICAgPGRpdiBjbGFzcz1cImVycm9yXCI+XHJcbiAgICAgICAgRVJST1IsIGNoZWNrIHlvdXIgZGVja2xpc3QgZm9yIGNvcnJlY3QgZm9ybWF0IG9yIGludGVybmV0IGNvbm5lY3Rpb25cclxuICAgICAgICBicnVkaVxyXG4gICAgICA8L2Rpdj5cclxuICAgIHsvYXdhaXR9XHJcblxyXG4gIDwvZGl2PlxyXG48L2Rpdj5cclxuIiwiY29uc3QgX19kaXJuYW1lID0gXCIuL1wiO1xyXG53aW5kb3cuX19kaXJuYW1lID0gXCIuL1wiO1xyXG5pbXBvcnQgTWFpblZpZXcgZnJvbSBcIi4vZWRpdG9yLnN2ZWx0ZVwiO1xyXG5cclxuXHJcbndpbmRvdy5vbmxvYWQgPSBmdW5jdGlvbigpIHtcclxuICBjb25zdCByZW5kZXJUYXJnZXQgPSBuZXcgTWFpblZpZXcoe1xyXG4gICAgdGFyZ2V0OiBkb2N1bWVudC5ib2R5LFxyXG4gICAgcHJvcHM6IHtcclxuICAgICAgdGVzdDogXCJzZGZkc2ZcIlxyXG4gICAgfVxyXG4gIH0pO1xyXG59OyJdLCJuYW1lcyI6WyJjbCIsIk1haW5WaWV3Il0sIm1hcHBpbmdzIjoiOzs7Q0FBQSxTQUFTLElBQUksR0FBRyxFQUFFO0FBQ2xCLEFBRUE7Q0FDQSxTQUFTLE1BQU0sQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFO0NBQzFCLENBQUMsS0FBSyxNQUFNLENBQUMsSUFBSSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztDQUN0QyxDQUFDLE9BQU8sR0FBRyxDQUFDO0NBQ1osQ0FBQzs7Q0FFRCxTQUFTLFVBQVUsQ0FBQyxLQUFLLEVBQUU7Q0FDM0IsQ0FBQyxPQUFPLEtBQUssSUFBSSxPQUFPLEtBQUssQ0FBQyxJQUFJLEtBQUssVUFBVSxDQUFDO0NBQ2xELENBQUM7O0NBRUQsU0FBUyxZQUFZLENBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRTtDQUN6RCxDQUFDLE9BQU8sQ0FBQyxhQUFhLEdBQUc7Q0FDekIsRUFB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LElBQUksR0FBRyxHQUFHLENBQUMsS0FBSyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDO0NBQ2xELEtBQUs7O0NBRUwsSUFBSSxNQUFNLElBQUksY0FBYTtDQUMzQixJQUFJLEtBQUssSUFBSSxHQUFHLElBQUksS0FBSyxFQUFFO0NBQzNCLE1BQU0sTUFBTSxJQUFJLElBQUksR0FBRyxHQUFHLENBQUMsS0FBSyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDO0NBQ2xELEtBQUs7O0NBRUwsSUFBSSxNQUFNLElBQUksY0FBYTtDQUMzQixJQUFJLEtBQUssSUFBSSxHQUFHLElBQUksS0FBSyxFQUFFO0NBQzNCLE1BQU0sTUFBTSxJQUFJLE1BQU0sR0FBRyxHQUFHLENBQUM7Q0FDN0IsS0FBSzs7Q0FFTCxJQUFJLE1BQU0sSUFBSSxrQkFBaUI7Q0FDL0IsSUFBSSxLQUFLLElBQUksR0FBRyxJQUFJLE1BQU0sRUFBRTtDQUM1QixNQUFNLE1BQU0sSUFBSSxNQUFNLEdBQUcsR0FBRyxDQUFDLEtBQUssR0FBRyxHQUFHLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQztDQUNwRCxLQUFLOzs7Q0FHTCxJQUFJLE9BQU8sTUFBTSxDQUFDO0NBQ2xCLEdBQUc7OztDQUdIO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0EsRUFBRSxNQUFNLFVBQVUsQ0FBQyxVQUFVLEVBQUUsTUFBTSxHQUFHLE1BQU0sRUFBRSxFQUFFLElBQUksR0FBRyxLQUFLLEVBQUU7Q0FDaEU7Ozs7Ozs7O0NBUUEsSUFBSSxJQUFJLE1BQU0sR0FBRyxDQUFDLEdBQUcsVUFBVSxDQUFDLEtBQUssQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7Q0FDcEUsSUFBSSxNQUFNLE9BQU8sR0FBRyxVQUFVLENBQUMsSUFBSSxFQUFFLENBQUMsT0FBTyxDQUFDLHVCQUF1QixFQUFFLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxlQUFlLEVBQUUsSUFBSSxDQUFDLENBQUMsS0FB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Q0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUM7Q0FDbEYsUUFBUSxRQUFRLENBQUMsS0FBSyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQztDQUNuRixRQUFRLFFBQVEsQ0FBQyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDO0NBQ2pGLFFBQVEsUUFBUSxDQUFDLEtBQUssSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUM7Q0FDbkYsUUFBUSxRQUFRLENBQUMsS0FBSyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQztDQUNuRixRQUFRLFFBQVEsQ0FBQyxTQUFTLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDO0NBQ3ZGLFFBQVEsUUFBUSxDQUFDLE9BQU8sSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxVQUFVLEVBQUUsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxHQUFH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
