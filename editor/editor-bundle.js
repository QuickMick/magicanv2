(function () {
    'use strict';

    function noop() { }
    function is_promise(value) {
        return value && typeof value === 'object' && typeof value.then === 'function';
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
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
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
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function to_number(value) {
        return value === '' ? undefined : +value;
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.data !== data)
            text.data = data;
    }
    function set_input_value(input, value) {
        input.value = value == null ? '' : value;
    }
    function toggle_class(element, name, toggle) {
        element.classList[toggle ? 'add' : 'remove'](name);
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error(`Function called outside component initialization`);
        return current_component;
    }
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }

    function handle_promise(promise, info) {
        const token = info.token = {};
        function update(type, index, key, value) {
            if (info.token !== token)
                return;
            info.resolved = value;
            let child_ctx = info.ctx;
            if (key !== undefined) {
                child_ctx = child_ctx.slice();
                child_ctx[key] = value;
            }
            const block = type && (info.current = type)(child_ctx);
            let needs_flush = false;
            if (info.block) {
                if (info.blocks) {
                    info.blocks.forEach((block, i) => {
                        if (i !== index && block) {
                            group_outros();
                            transition_out(block, 1, 1, () => {
                                info.blocks[i] = null;
                            });
                            check_outros();
                        }
                    });
                }
                else {
                    info.block.d(1);
                }
                block.c();
                transition_in(block, 1);
                block.m(info.mount(), info.anchor);
                needs_flush = true;
            }
            info.block = block;
            if (info.blocks)
                info.blocks[index] = block;
            if (needs_flush) {
                flush();
            }
        }
        if (is_promise(promise)) {
            const current_component = get_current_component();
            promise.then(value => {
                set_current_component(current_component);
                update(info.then, 1, info.value, value);
                set_current_component(null);
            }, error => {
                set_current_component(current_component);
                update(info.catch, 2, info.error, error);
                set_current_component(null);
            });
            // if we previously had a then/catch block, destroy it
            if (info.current !== info.pending) {
                update(info.pending, 0);
                return true;
            }
        }
        else {
            if (info.current !== info.then) {
                update(info.then, 1, info.value, promise);
                return true;
            }
            info.resolved = promise;
        }
    }

    const globals = (typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
            ? globalThis
            : global);
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if ($$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set() {
            // overridden by instance, if it has props
        }
    }

    // path to where the images are downloaded
    //const CARD_DATA = require("./scryfall-default-cards.json");

    function timeout() {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          resolve();
        }, 70);
      });
    }

    class MtgInterface {

      constructor() {
        this.__cache = {};
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
            queries.push("type%3A" + opts.type);
          }
          if (opts.text) {
            let text = opts.text.trim().replace(/\s+/gm, "+oracle%3A");
            queries.push("oracle%3A" + opts.text);
          }

          baseurl = baseurl + queries.join("+");
        } else {
          baseurl = opts;
        }
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
              this.__cache[c.name] = c;
            }
            return response;
          })
          .catch(e => { console.log(e); return { code: "not_found", data: [] }; });

      }

      async cardByName(name) {
        if (this.__cache[name]) return this.__cache[name];
        await timeout();
        //https://api.scryfall.com/cards/named?fuzzy=aust+com 
        const fixed = name.replace(/\s/g, "+");
        const result = await fetch('https://api.scryfall.com/cards/named?fuzzy=' + fixed)
          .then(response => response.json()).catch(e => { console.log(e); return { code: "not_found" }; });

        this.__cache[name] = result;
        this.__cache[result.name] = result;
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
            data = { image_uris: {}, legalities: {}, prices: { usd: 0 }, mana_cost: "", cmc: 0, type_line: "land" };
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

            cost += parseFloat(card.data.prices.usd || 0) * card.count;

            if (card.data.type_line.toLowerCase().includes("land")) {
              landCount += card.count;
            } else {
              manaCurve[card.data.cmc || 0] = (manaCurve[card.data.cmc || 0] || 0) + card.count;
            }

            if (!isMaybe) {
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
                creatureCount += card.count;
              }
            }


            card.data.mana_cost = card.data.mana_cost || "";
            devotion.blue += (card.data.mana_cost.split("U").length - 1) * card.count;
            devotion.black += (card.data.mana_cost.split("B").length - 1) * card.count;
            devotion.red += (card.data.mana_cost.split("R").length - 1) * card.count;
            devotion.white += (card.data.mana_cost.split("W").length - 1) * card.count;
            devotion.green += (card.data.mana_cost.split("G").length - 1) * card.count;
            devotion.colorless += (card.data.mana_cost.split("C").length - 1) * card.count;
            devotion.generic += Math.floor(card.data.mana_cost.replace(/[^0-9.]/g, "") || 0) * card.count;
            devotion.sum = devotion.blue + devotion.black + devotion.red + devotion.green + devotion.white + devotion.colorless + devotion.generic;
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
        groups["enchantmentCount"] = enchantmentCount;
        groups["artifactCount"] = artifactCount;
        return groups;
      }
    }


    var cardLoader = new MtgInterface();

    function createCommonjsModule(fn, module) {
    	return module = { exports: {} }, fn(module, module.exports), module.exports;
    }

    var js_cookie = createCommonjsModule(function (module, exports) {
    (function (factory) {
    	var registeredInModuleLoader;
    	{
    		module.exports = factory();
    		registeredInModuleLoader = true;
    	}
    	if (!registeredInModuleLoader) {
    		var OldCookies = window.Cookies;
    		var api = window.Cookies = factory();
    		api.noConflict = function () {
    			window.Cookies = OldCookies;
    			return api;
    		};
    	}
    }(function () {
    	function extend () {
    		var i = 0;
    		var result = {};
    		for (; i < arguments.length; i++) {
    			var attributes = arguments[ i ];
    			for (var key in attributes) {
    				result[key] = attributes[key];
    			}
    		}
    		return result;
    	}

    	function decode (s) {
    		return s.replace(/(%[0-9A-Z]{2})+/g, decodeURIComponent);
    	}

    	function init (converter) {
    		function api() {}

    		function set (key, value, attributes) {
    			if (typeof document === 'undefined') {
    				return;
    			}

    			attributes = extend({
    				path: '/'
    			}, api.defaults, attributes);

    			if (typeof attributes.expires === 'number') {
    				attributes.expires = new Date(new Date() * 1 + attributes.expires * 864e+5);
    			}

    			// We're using "expires" because "max-age" is not supported by IE
    			attributes.expires = attributes.expires ? attributes.expires.toUTCString() : '';

    			try {
    				var result = JSON.stringify(value);
    				if (/^[\{\[]/.test(result)) {
    					value = result;
    				}
    			} catch (e) {}

    			value = converter.write ?
    				converter.write(value, key) :
    				encodeURIComponent(String(value))
    					.replace(/%(23|24|26|2B|3A|3C|3E|3D|2F|3F|40|5B|5D|5E|60|7B|7D|7C)/g, decodeURIComponent);

    			key = encodeURIComponent(String(key))
    				.replace(/%(23|24|26|2B|5E|60|7C)/g, decodeURIComponent)
    				.replace(/[\(\)]/g, escape);

    			var stringifiedAttributes = '';
    			for (var attributeName in attributes) {
    				if (!attributes[attributeName]) {
    					continue;
    				}
    				stringifiedAttributes += '; ' + attributeName;
    				if (attributes[attributeName] === true) {
    					continue;
    				}

    				// Considers RFC 6265 section 5.2:
    				// ...
    				// 3.  If the remaining unparsed-attributes contains a %x3B (";")
    				//     character:
    				// Consume the characters of the unparsed-attributes up to,
    				// not including, the first %x3B (";") character.
    				// ...
    				stringifiedAttributes += '=' + attributes[attributeName].split(';')[0];
    			}

    			return (document.cookie = key + '=' + value + stringifiedAttributes);
    		}

    		function get (key, json) {
    			if (typeof document === 'undefined') {
    				return;
    			}

    			var jar = {};
    			// To prevent the for loop in the first place assign an empty array
    			// in case there are no cookies at all.
    			var cookies = document.cookie ? document.cookie.split('; ') : [];
    			var i = 0;

    			for (; i < cookies.length; i++) {
    				var parts = cookies[i].split('=');
    				var cookie = parts.slice(1).join('=');

    				if (!json && cookie.charAt(0) === '"') {
    					cookie = cookie.slice(1, -1);
    				}

    				try {
    					var name = decode(parts[0]);
    					cookie = (converter.read || converter)(cookie, name) ||
    						decode(cookie);

    					if (json) {
    						try {
    							cookie = JSON.parse(cookie);
    						} catch (e) {}
    					}

    					jar[name] = cookie;

    					if (key === name) {
    						break;
    					}
    				} catch (e) {}
    			}

    			return key ? jar[key] : jar;
    		}

    		api.set = set;
    		api.get = function (key) {
    			return get(key, false /* read as raw */);
    		};
    		api.getJSON = function (key) {
    			return get(key, true /* read as json */);
    		};
    		api.remove = function (key, attributes) {
    			set(key, '', extend(attributes, {
    				expires: -1
    			}));
    		};

    		api.defaults = {};

    		api.withConverter = init;

    		return api;
    	}

    	return init(function () {});
    }));
    });

    /* editor.svelte generated by Svelte v3.23.0 */

    const { document: document_1 } = globals;

    function add_css() {
    	var style = element("style");
    	style.id = "svelte-cf5kd-style";
    	style.textContent = ".content.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{--raisin-black:hsla(200, 8%, 15%, 1);--roman-silver:hsla(196, 15%, 60%, 1);--colorless:hsla(0, 0%, 89%, 1);--black:hsla(83, 8%, 38%, 1);--white:hsl(48, 64%, 89%);--red:hsla(0, 71%, 84%, 1);--green:hsla(114, 60%, 75%, 1);--blue:hsla(235, 55%, 81%, 1)}.content.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{display:flex;flex-direction:row;width:100%;height:100%}.help-symbol.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{border-radius:50%;border:1px solid black;width:16px;height:16px;text-align:center;position:absolute;right:10px;top:10px;cursor:pointer}.help-symbol.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd:hover{border-color:blue;color:blue}.toggle-search.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{background:blue;width:30px;height:30px;cursor:pointer;position:absolute;left:-30px;top:50%;user-select:none}.hide.svelte-cf5kd.svelte-cf5kd .toggle-search.svelte-cf5kd.svelte-cf5kd{left:-52px}.statistics.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{display:flex;flex-direction:column}.input.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{width:100%;height:100%;box-sizing:border-box;padding:10px;resize:none}.controls.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{flex-shrink:0;width:300px;height:100%;background:lightgray;display:flex;flex-direction:column}.help.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{padding:0px 10px 10px 10px;user-select:none;position:relative}.group-content.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{flex-grow:1;display:flex;flex-wrap:wrap;transition:height 500ms ease}.group-content.hidden.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{overflow:hidden;height:45px}.card-search.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{height:100%;flex-grow:1;background:white;display:flex;flex-direction:column;position:absolute;right:0;width:33%;z-index:100;box-shadow:0px 0px 10px black}.card-search.hide.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{right:-33%}.search-params.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{flex-shrink:0;display:flex;flex-direction:column}.search-result.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{height:100%;flex-grow:1;background:white;display:flex;flex-direction:row;overflow:auto;position:relative;user-select:none;flex-wrap:wrap}.display.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{flex-grow:1;background:gray;display:flex;flex-direction:column;flex-wrap:nowrap;overflow:auto;position:relative;user-select:none}.loading-wrapper.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{position:absolute;left:50%;top:0;bottom:0;display:flex;align-items:center}.entry.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{position:relative;padding:10px;flex-shrink:0}.card.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{position:absolute;border:6px solid rgb(22, 22, 22);border-radius:10px;outline:0;box-shadow:0px 0px 10px black}.card.banned.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{border:6px solid red}.card.highlighted.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{border:6px solid yellow}.card.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd:hover{border:6px solid blue;cursor:pointer}.price.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd,.banned-text.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd,.count.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{font-size:34px;text-shadow:0px 0px 9px black;color:red;position:absolute;z-index:100;font-weight:bold;left:34px}.banned-text.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{font-size:100%;text-shadow:0px 0px 9px black;color:red;position:absolute;z-index:100;font-weight:bold;left:17%}.count.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{top:165px}.price.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{bottom:7px;color:wheat;font-size:12px;background:black;left:45%;font-weight:normal}.group-header.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{display:flex;background:darkgrey;margin:8px 0;box-shadow:0px 0px 8px black;width:100%;flex-direction:row}.group-header.svelte-cf5kd.svelte-cf5kd h2.svelte-cf5kd.svelte-cf5kd{padding:0 25px;margin:0px}.group-statistics.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{display:flex;flex-direction:row}.mana-proposal.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd,.mana-devotion.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{display:flex;flex-direction:row}.deck-value.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd,.group-value.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{padding:5px;color:black;border-radius:50%;width:15px;height:15px;text-align:center;margin:5px;display:flex;text-align:center;align-items:center;font-size:11px;font-weight:bold}.blue.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{background-color:var(--blue)}.black.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{color:white;background-color:var(--black)}.red.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{background-color:var(--red)}.white.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{background-color:var(--white)}.green.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{background-color:var(--green)}.colorless.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{background-color:var(--colorless)}.sum.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{background-color:goldenrod}.color-param.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{display:flex;flex-direction:row}.mana-curve.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{display:flex;flex-direction:column}.all-curves.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{display:flex;flex-grow:1;flex-direction:row;height:80px}.all-labels.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{display:flex;flex-shrink:0;flex-direction:row}.curve-element.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{width:20px;display:flex;position:absolute;bottom:0;background:gray;align-items:center;height:100%}.curve-label.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{width:20px}.curve-wrapper.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{width:20px;position:relative;cursor:pointer}.curve-element.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd:hover{background:lightcoral}.highlighted.svelte-cf5kd.svelte-cf5kd .curve-element.svelte-cf5kd.svelte-cf5kd{background:lightblue}.curve-label.highlighted.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{background:lightblue}.curve-label.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd:hover{background:lightcoral}h4.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{margin-top:5px;margin-bottom:5px}.lds-ripple.svelte-cf5kd.svelte-cf5kd.svelte-cf5kd{display:inline-block;position:relative;width:80px;height:80px}.lds-ripple.svelte-cf5kd.svelte-cf5kd div.svelte-cf5kd.svelte-cf5kd{position:absolute;border:4px solid #fff;opacity:1;border-radius:50%;animation:svelte-cf5kd-lds-ripple 1s cubic-bezier(0, 0.2, 0.8, 1) infinite}.card-search.svelte-cf5kd .lds-ripple.svelte-cf5kd div.svelte-cf5kd{border:4px solid black}.lds-ripple.svelte-cf5kd.svelte-cf5kd div.svelte-cf5kd.svelte-cf5kd:nth-child(2){animation-delay:-0.5s}@keyframes svelte-cf5kd-lds-ripple{0%{top:36px;left:36px;width:0;height:0;opacity:1}100%{top:0px;left:0px;width:72px;height:72px;opacity:0}}";
    	append(document_1.head, style);
    }

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[57] = list[i];
    	return child_ctx;
    }

    function get_each_context_3(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[67] = list[i];
    	child_ctx[69] = i;
    	return child_ctx;
    }

    function get_each_context_2(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[57] = list[i];
    	return child_ctx;
    }

    function get_each_context_1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[62] = list[i];
    	return child_ctx;
    }

    function get_each_context_4(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[70] = list[i];
    	child_ctx[69] = i;
    	return child_ctx;
    }

    function get_each_context_5(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[70] = list[i];
    	child_ctx[69] = i;
    	return child_ctx;
    }

    // (583:6) {#if helpActive}
    function create_if_block_10(ctx) {
    	let h4;
    	let t1;
    	let p0;
    	let t3;
    	let ul;
    	let t11;
    	let p1;
    	let t13;
    	let p2;

    	return {
    		c() {
    			h4 = element("h4");
    			h4.textContent = "How to use:";
    			t1 = space();
    			p0 = element("p");
    			p0.textContent = "paste your deck to the following input.";
    			t3 = space();
    			ul = element("ul");

    			ul.innerHTML = `<li>
            when a line starts with &quot;#&quot; it will be interpreted as headline
          </li> 
          <li>
            a card can be entered with a leading count, or just with its name
          </li> 
          <li>use the &quot;ESC&quot; key to reaload the preview</li> 
          <li>doubleclick a card to remove it</li>`;

    			t11 = space();
    			p1 = element("p");
    			p1.textContent = "NOTE: we use cookies to store your deck after reload.";
    			t13 = space();
    			p2 = element("p");
    			p2.textContent = "NOTE: This is not an official Magic produkt.";
    			attr(h4, "class", "svelte-cf5kd");
    		},
    		m(target, anchor) {
    			insert(target, h4, anchor);
    			insert(target, t1, anchor);
    			insert(target, p0, anchor);
    			insert(target, t3, anchor);
    			insert(target, ul, anchor);
    			insert(target, t11, anchor);
    			insert(target, p1, anchor);
    			insert(target, t13, anchor);
    			insert(target, p2, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(h4);
    			if (detaching) detach(t1);
    			if (detaching) detach(p0);
    			if (detaching) detach(t3);
    			if (detaching) detach(ul);
    			if (detaching) detach(t11);
    			if (detaching) detach(p1);
    			if (detaching) detach(t13);
    			if (detaching) detach(p2);
    		}
    	};
    }

    // (697:6) {:catch error}
    function create_catch_block_2(ctx) {
    	let t_value = /*error*/ ctx[60] + "";
    	let t;

    	return {
    		c() {
    			t = text(t_value);
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*promise*/ 64 && t_value !== (t_value = /*error*/ ctx[60] + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (603:6) {:then groups}
    function create_then_block_2(ctx) {
    	let if_block_anchor;
    	let if_block = !/*helpActive*/ ctx[21] && create_if_block_6(ctx);

    	return {
    		c() {
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if (if_block) if_block.m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (!/*helpActive*/ ctx[21]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block_6(ctx);
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		d(detaching) {
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    // (605:8) {#if !helpActive}
    function create_if_block_6(ctx) {
    	let h4;
    	let t1;
    	let div0;
    	let t2;
    	let t3_value = /*groups*/ ctx[61]["cardCount"] + "";
    	let t3;
    	let t4;
    	let div1;
    	let t5;
    	let t6_value = /*groups*/ ctx[61]["landCount"] + "";
    	let t6;
    	let t7;
    	let t8_value = /*groups*/ ctx[61]["cardCount"] - /*groups*/ ctx[61]["landCount"] + "";
    	let t8;
    	let t9;
    	let div2;
    	let t10;
    	let t11_value = /*groups*/ ctx[61]["creatureCount"] + "";
    	let t11;
    	let t12;
    	let div3;
    	let t13;
    	let t14_value = /*groups*/ ctx[61]["instantCount"] + "";
    	let t14;
    	let t15;
    	let div4;
    	let t16;
    	let t17_value = /*groups*/ ctx[61]["enchantmentCount"] + "";
    	let t17;
    	let t18;
    	let div5;
    	let t19;
    	let t20_value = /*groups*/ ctx[61]["artifactCount"] + "";
    	let t20;
    	let t21;
    	let div6;
    	let t22;
    	let t23_value = /*groups*/ ctx[61].cost.toFixed(2) + "$" + "";
    	let t23;
    	let t24;
    	let if_block_anchor;
    	let if_block = /*statisticsActive*/ ctx[3] && create_if_block_7(ctx);

    	return {
    		c() {
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
    			t16 = text("Enchantments: ");
    			t17 = text(t17_value);
    			t18 = space();
    			div5 = element("div");
    			t19 = text("Artifacts: ");
    			t20 = text(t20_value);
    			t21 = space();
    			div6 = element("div");
    			t22 = text("Cost: ");
    			t23 = text(t23_value);
    			t24 = space();
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    			attr(h4, "class", "svelte-cf5kd");
    		},
    		m(target, anchor) {
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
    			if (if_block) if_block.m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*promise*/ 64 && t3_value !== (t3_value = /*groups*/ ctx[61]["cardCount"] + "")) set_data(t3, t3_value);
    			if (dirty[0] & /*promise*/ 64 && t6_value !== (t6_value = /*groups*/ ctx[61]["landCount"] + "")) set_data(t6, t6_value);
    			if (dirty[0] & /*promise*/ 64 && t8_value !== (t8_value = /*groups*/ ctx[61]["cardCount"] - /*groups*/ ctx[61]["landCount"] + "")) set_data(t8, t8_value);
    			if (dirty[0] & /*promise*/ 64 && t11_value !== (t11_value = /*groups*/ ctx[61]["creatureCount"] + "")) set_data(t11, t11_value);
    			if (dirty[0] & /*promise*/ 64 && t14_value !== (t14_value = /*groups*/ ctx[61]["instantCount"] + "")) set_data(t14, t14_value);
    			if (dirty[0] & /*promise*/ 64 && t17_value !== (t17_value = /*groups*/ ctx[61]["enchantmentCount"] + "")) set_data(t17, t17_value);
    			if (dirty[0] & /*promise*/ 64 && t20_value !== (t20_value = /*groups*/ ctx[61]["artifactCount"] + "")) set_data(t20, t20_value);
    			if (dirty[0] & /*promise*/ 64 && t23_value !== (t23_value = /*groups*/ ctx[61].cost.toFixed(2) + "$" + "")) set_data(t23, t23_value);

    			if (/*statisticsActive*/ ctx[3]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block_7(ctx);
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(h4);
    			if (detaching) detach(t1);
    			if (detaching) detach(div0);
    			if (detaching) detach(t4);
    			if (detaching) detach(div1);
    			if (detaching) detach(t9);
    			if (detaching) detach(div2);
    			if (detaching) detach(t12);
    			if (detaching) detach(div3);
    			if (detaching) detach(t15);
    			if (detaching) detach(div4);
    			if (detaching) detach(t18);
    			if (detaching) detach(div5);
    			if (detaching) detach(t21);
    			if (detaching) detach(div6);
    			if (detaching) detach(t24);
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    // (620:10) {#if statisticsActive}
    function create_if_block_7(ctx) {
    	let div20;
    	let h40;
    	let t1;
    	let div6;
    	let div0;
    	let t2_value = /*groups*/ ctx[61]["mana"].blue + "";
    	let t2;
    	let t3;
    	let div1;
    	let t4_value = /*groups*/ ctx[61]["mana"].black + "";
    	let t4;
    	let t5;
    	let div2;
    	let t6_value = /*groups*/ ctx[61]["mana"].red + "";
    	let t6;
    	let t7;
    	let div3;
    	let t8_value = /*groups*/ ctx[61]["mana"].white + "";
    	let t8;
    	let t9;
    	let div4;
    	let t10_value = /*groups*/ ctx[61]["mana"].green + "";
    	let t10;
    	let t11;
    	let div5;
    	let t12_value = /*groups*/ ctx[61]["mana"].colorless + "";
    	let t12;
    	let t13;
    	let h41;
    	let t15;
    	let div7;
    	let t16;
    	let t17_value = /*groups*/ ctx[61]["mana"].generic + "";
    	let t17;
    	let t18;
    	let div8;
    	let t19;
    	let t20_value = /*groups*/ ctx[61]["mana"].sum + "";
    	let t20;
    	let t21;
    	let div9;
    	let t22;
    	let t23_value = /*groups*/ ctx[61]["averageMana"].toFixed(2) + "";
    	let t23;
    	let t24;
    	let h42;
    	let t26;
    	let div16;
    	let div10;
    	let t27_value = (/*groups*/ ctx[61]["manaProposal"].blue * /*groups*/ ctx[61]["landCount"]).toFixed(1) + "";
    	let t27;
    	let t28;
    	let div11;
    	let t29_value = (/*groups*/ ctx[61]["manaProposal"].black * /*groups*/ ctx[61]["landCount"]).toFixed(1) + "";
    	let t29;
    	let t30;
    	let div12;
    	let t31_value = (/*groups*/ ctx[61]["manaProposal"].red * /*groups*/ ctx[61]["landCount"]).toFixed(1) + "";
    	let t31;
    	let t32;
    	let div13;
    	let t33_value = (/*groups*/ ctx[61]["manaProposal"].white * /*groups*/ ctx[61]["landCount"]).toFixed(1) + "";
    	let t33;
    	let t34;
    	let div14;
    	let t35_value = (/*groups*/ ctx[61]["manaProposal"].green * /*groups*/ ctx[61]["landCount"]).toFixed(1) + "";
    	let t35;
    	let t36;
    	let div15;
    	let t37_value = (/*groups*/ ctx[61]["manaProposal"].colorless * /*groups*/ ctx[61]["landCount"]).toFixed(1) + "";
    	let t37;
    	let t38;
    	let h43;
    	let t40;
    	let div19;
    	let div17;
    	let t41;
    	let div18;
    	let each_value_5 = /*groups*/ ctx[61]["manaCurve"];
    	let each_blocks_1 = [];

    	for (let i = 0; i < each_value_5.length; i += 1) {
    		each_blocks_1[i] = create_each_block_5(get_each_context_5(ctx, each_value_5, i));
    	}

    	let each_value_4 = /*groups*/ ctx[61]["manaCurve"];
    	let each_blocks = [];

    	for (let i = 0; i < each_value_4.length; i += 1) {
    		each_blocks[i] = create_each_block_4(get_each_context_4(ctx, each_value_4, i));
    	}

    	return {
    		c() {
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

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].c();
    			}

    			t41 = space();
    			div18 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr(h40, "class", "svelte-cf5kd");
    			attr(div0, "class", "deck-value blue svelte-cf5kd");
    			attr(div1, "class", "deck-value black svelte-cf5kd");
    			attr(div2, "class", "deck-value red svelte-cf5kd");
    			attr(div3, "class", "deck-value white svelte-cf5kd");
    			attr(div4, "class", "deck-value green svelte-cf5kd");
    			attr(div5, "class", "deck-value colorless svelte-cf5kd");
    			attr(div6, "class", "mana-devotion svelte-cf5kd");
    			attr(h41, "class", "svelte-cf5kd");
    			attr(h42, "class", "svelte-cf5kd");
    			attr(div10, "class", "deck-value blue svelte-cf5kd");
    			attr(div11, "class", "deck-value black svelte-cf5kd");
    			attr(div12, "class", "deck-value red svelte-cf5kd");
    			attr(div13, "class", "deck-value white svelte-cf5kd");
    			attr(div14, "class", "deck-value green svelte-cf5kd");
    			attr(div15, "class", "deck-value colorless svelte-cf5kd");
    			attr(div16, "class", "mana-proposal svelte-cf5kd");
    			attr(h43, "class", "svelte-cf5kd");
    			attr(div17, "class", "all-curves svelte-cf5kd");
    			attr(div18, "class", "all-labels svelte-cf5kd");
    			attr(div19, "class", "mana-curve svelte-cf5kd");
    			attr(div20, "class", "statistics svelte-cf5kd");
    		},
    		m(target, anchor) {
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

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].m(div17, null);
    			}

    			append(div19, t41);
    			append(div19, div18);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div18, null);
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*promise*/ 64 && t2_value !== (t2_value = /*groups*/ ctx[61]["mana"].blue + "")) set_data(t2, t2_value);
    			if (dirty[0] & /*promise*/ 64 && t4_value !== (t4_value = /*groups*/ ctx[61]["mana"].black + "")) set_data(t4, t4_value);
    			if (dirty[0] & /*promise*/ 64 && t6_value !== (t6_value = /*groups*/ ctx[61]["mana"].red + "")) set_data(t6, t6_value);
    			if (dirty[0] & /*promise*/ 64 && t8_value !== (t8_value = /*groups*/ ctx[61]["mana"].white + "")) set_data(t8, t8_value);
    			if (dirty[0] & /*promise*/ 64 && t10_value !== (t10_value = /*groups*/ ctx[61]["mana"].green + "")) set_data(t10, t10_value);
    			if (dirty[0] & /*promise*/ 64 && t12_value !== (t12_value = /*groups*/ ctx[61]["mana"].colorless + "")) set_data(t12, t12_value);
    			if (dirty[0] & /*promise*/ 64 && t17_value !== (t17_value = /*groups*/ ctx[61]["mana"].generic + "")) set_data(t17, t17_value);
    			if (dirty[0] & /*promise*/ 64 && t20_value !== (t20_value = /*groups*/ ctx[61]["mana"].sum + "")) set_data(t20, t20_value);
    			if (dirty[0] & /*promise*/ 64 && t23_value !== (t23_value = /*groups*/ ctx[61]["averageMana"].toFixed(2) + "")) set_data(t23, t23_value);
    			if (dirty[0] & /*promise*/ 64 && t27_value !== (t27_value = (/*groups*/ ctx[61]["manaProposal"].blue * /*groups*/ ctx[61]["landCount"]).toFixed(1) + "")) set_data(t27, t27_value);
    			if (dirty[0] & /*promise*/ 64 && t29_value !== (t29_value = (/*groups*/ ctx[61]["manaProposal"].black * /*groups*/ ctx[61]["landCount"]).toFixed(1) + "")) set_data(t29, t29_value);
    			if (dirty[0] & /*promise*/ 64 && t31_value !== (t31_value = (/*groups*/ ctx[61]["manaProposal"].red * /*groups*/ ctx[61]["landCount"]).toFixed(1) + "")) set_data(t31, t31_value);
    			if (dirty[0] & /*promise*/ 64 && t33_value !== (t33_value = (/*groups*/ ctx[61]["manaProposal"].white * /*groups*/ ctx[61]["landCount"]).toFixed(1) + "")) set_data(t33, t33_value);
    			if (dirty[0] & /*promise*/ 64 && t35_value !== (t35_value = (/*groups*/ ctx[61]["manaProposal"].green * /*groups*/ ctx[61]["landCount"]).toFixed(1) + "")) set_data(t35, t35_value);
    			if (dirty[0] & /*promise*/ 64 && t37_value !== (t37_value = (/*groups*/ ctx[61]["manaProposal"].colorless * /*groups*/ ctx[61]["landCount"]).toFixed(1) + "")) set_data(t37, t37_value);

    			if (dirty[0] & /*devotionHighlight, highlightDevotion, promise*/ 4194400) {
    				each_value_5 = /*groups*/ ctx[61]["manaCurve"];
    				let i;

    				for (i = 0; i < each_value_5.length; i += 1) {
    					const child_ctx = get_each_context_5(ctx, each_value_5, i);

    					if (each_blocks_1[i]) {
    						each_blocks_1[i].p(child_ctx, dirty);
    					} else {
    						each_blocks_1[i] = create_each_block_5(child_ctx);
    						each_blocks_1[i].c();
    						each_blocks_1[i].m(div17, null);
    					}
    				}

    				for (; i < each_blocks_1.length; i += 1) {
    					each_blocks_1[i].d(1);
    				}

    				each_blocks_1.length = each_value_5.length;
    			}

    			if (dirty[0] & /*devotionHighlight, highlightDevotion, promise*/ 4194400) {
    				each_value_4 = /*groups*/ ctx[61]["manaCurve"];
    				let i;

    				for (i = 0; i < each_value_4.length; i += 1) {
    					const child_ctx = get_each_context_4(ctx, each_value_4, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block_4(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(div18, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value_4.length;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div20);
    			destroy_each(each_blocks_1, detaching);
    			destroy_each(each_blocks, detaching);
    		}
    	};
    }

    // (665:20) {#if mana > 0}
    function create_if_block_9(ctx) {
    	let div1;
    	let div0;
    	let t0_value = (/*mana*/ ctx[70] || "") + "";
    	let t0;
    	let div0_style_value;
    	let t1;
    	let mounted;
    	let dispose;

    	function click_handler(...args) {
    		return /*click_handler*/ ctx[39](/*i*/ ctx[69], ...args);
    	}

    	return {
    		c() {
    			div1 = element("div");
    			div0 = element("div");
    			t0 = text(t0_value);
    			t1 = space();
    			attr(div0, "class", "curve-element svelte-cf5kd");
    			attr(div0, "style", div0_style_value = "height:" + getHeight(/*mana*/ ctx[70], /*groups*/ ctx[61]) + "%;");
    			attr(div1, "class", "curve-wrapper svelte-cf5kd");
    			toggle_class(div1, "highlighted", /*devotionHighlight*/ ctx[5] == /*i*/ ctx[69]);
    		},
    		m(target, anchor) {
    			insert(target, div1, anchor);
    			append(div1, div0);
    			append(div0, t0);
    			append(div1, t1);

    			if (!mounted) {
    				dispose = listen(div1, "click", click_handler);
    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;
    			if (dirty[0] & /*promise*/ 64 && t0_value !== (t0_value = (/*mana*/ ctx[70] || "") + "")) set_data(t0, t0_value);

    			if (dirty[0] & /*promise*/ 64 && div0_style_value !== (div0_style_value = "height:" + getHeight(/*mana*/ ctx[70], /*groups*/ ctx[61]) + "%;")) {
    				attr(div0, "style", div0_style_value);
    			}

    			if (dirty[0] & /*devotionHighlight*/ 32) {
    				toggle_class(div1, "highlighted", /*devotionHighlight*/ ctx[5] == /*i*/ ctx[69]);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div1);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (664:18) {#each groups['manaCurve'] as mana, i}
    function create_each_block_5(ctx) {
    	let if_block_anchor;
    	let if_block = /*mana*/ ctx[70] > 0 && create_if_block_9(ctx);

    	return {
    		c() {
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if (if_block) if_block.m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (/*mana*/ ctx[70] > 0) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
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
    		d(detaching) {
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    // (682:20) {#if mana > 0}
    function create_if_block_8(ctx) {
    	let div;
    	let t0;
    	let t1;
    	let mounted;
    	let dispose;

    	function click_handler_1(...args) {
    		return /*click_handler_1*/ ctx[40](/*i*/ ctx[69], ...args);
    	}

    	return {
    		c() {
    			div = element("div");
    			t0 = text(/*i*/ ctx[69]);
    			t1 = space();
    			attr(div, "class", "curve-label svelte-cf5kd");
    			toggle_class(div, "highlighted", /*devotionHighlight*/ ctx[5] == /*i*/ ctx[69]);
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, t0);
    			append(div, t1);

    			if (!mounted) {
    				dispose = listen(div, "click", click_handler_1);
    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (dirty[0] & /*devotionHighlight*/ 32) {
    				toggle_class(div, "highlighted", /*devotionHighlight*/ ctx[5] == /*i*/ ctx[69]);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (681:18) {#each groups['manaCurve'] as mana, i}
    function create_each_block_4(ctx) {
    	let if_block_anchor;
    	let if_block = /*mana*/ ctx[70] > 0 && create_if_block_8(ctx);

    	return {
    		c() {
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if (if_block) if_block.m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (/*mana*/ ctx[70] > 0) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block_8(ctx);
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		d(detaching) {
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    // (600:22)             <div>loading: {progress}
    function create_pending_block_2(ctx) {
    	let div;
    	let t0;
    	let t1;
    	let t2;
    	let t3;

    	return {
    		c() {
    			div = element("div");
    			t0 = text("loading: ");
    			t1 = text(/*progress*/ ctx[10]);
    			t2 = text("/");
    			t3 = text(/*all*/ ctx[11]);
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, t0);
    			append(div, t1);
    			append(div, t2);
    			append(div, t3);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*progress*/ 1024) set_data(t1, /*progress*/ ctx[10]);
    			if (dirty[0] & /*all*/ 2048) set_data(t3, /*all*/ ctx[11]);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (803:4) {:catch error}
    function create_catch_block_1(ctx) {
    	let div;

    	return {
    		c() {
    			div = element("div");
    			div.textContent = "ERROR, check your decklist for correct format or internet connection\r\n        brudi";
    			attr(div, "class", "error");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (737:4) {:then groups}
    function create_then_block_1(ctx) {
    	let each_1_anchor;
    	let each_value_1 = /*groups*/ ctx[61] || [];
    	let each_blocks = [];

    	for (let i = 0; i < each_value_1.length; i += 1) {
    		each_blocks[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
    	}

    	return {
    		c() {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			each_1_anchor = empty();
    		},
    		m(target, anchor) {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(target, anchor);
    			}

    			insert(target, each_1_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*hiddenGroups, promise, width, height, scaling, format, devotionHighlight, toggleGroupVisibility*/ 68158067 | dirty[1] & /*remove*/ 1) {
    				each_value_1 = /*groups*/ ctx[61] || [];
    				let i;

    				for (i = 0; i < each_value_1.length; i += 1) {
    					const child_ctx = get_each_context_1(ctx, each_value_1, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
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
    		d(detaching) {
    			destroy_each(each_blocks, detaching);
    			if (detaching) detach(each_1_anchor);
    		}
    	};
    }

    // (773:16) {#each { length: card.count > 4 ? 4 : card.count } as _, i}
    function create_each_block_3(ctx) {
    	let img;
    	let img_style_value;
    	let img_src_value;
    	let img_alt_value;
    	let mounted;
    	let dispose;

    	function dblclick_handler(...args) {
    		return /*dblclick_handler*/ ctx[45](/*card*/ ctx[57], ...args);
    	}

    	return {
    		c() {
    			img = element("img");
    			attr(img, "class", "card svelte-cf5kd");
    			attr(img, "style", img_style_value = "margin-top: " + /*i*/ ctx[69] * 40 + "px");
    			if (img.src !== (img_src_value = /*card*/ ctx[57].url)) attr(img, "src", img_src_value);
    			attr(img, "alt", img_alt_value = /*card*/ ctx[57].name);
    			attr(img, "width", /*width*/ ctx[1]);
    			attr(img, "height", /*height*/ ctx[0]);
    			toggle_class(img, "banned", /*card*/ ctx[57].data.legalities[/*format*/ ctx[9].value] !== "legal");
    			toggle_class(img, "highlighted", /*devotionHighlight*/ ctx[5] == /*card*/ ctx[57].data.cmc);
    		},
    		m(target, anchor) {
    			insert(target, img, anchor);

    			if (!mounted) {
    				dispose = listen(img, "dblclick", dblclick_handler);
    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (dirty[0] & /*promise*/ 64 && img.src !== (img_src_value = /*card*/ ctx[57].url)) {
    				attr(img, "src", img_src_value);
    			}

    			if (dirty[0] & /*promise*/ 64 && img_alt_value !== (img_alt_value = /*card*/ ctx[57].name)) {
    				attr(img, "alt", img_alt_value);
    			}

    			if (dirty[0] & /*width*/ 2) {
    				attr(img, "width", /*width*/ ctx[1]);
    			}

    			if (dirty[0] & /*height*/ 1) {
    				attr(img, "height", /*height*/ ctx[0]);
    			}

    			if (dirty[0] & /*promise, format*/ 576) {
    				toggle_class(img, "banned", /*card*/ ctx[57].data.legalities[/*format*/ ctx[9].value] !== "legal");
    			}

    			if (dirty[0] & /*devotionHighlight, promise*/ 96) {
    				toggle_class(img, "highlighted", /*devotionHighlight*/ ctx[5] == /*card*/ ctx[57].data.cmc);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(img);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (786:16) {#if card.data.legalities[format.value] !== 'legal'}
    function create_if_block_5(ctx) {
    	let div;

    	return {
    		c() {
    			div = element("div");
    			div.textContent = "BANNED";
    			attr(div, "class", "banned-text svelte-cf5kd");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (789:16) {#if card.count > 4}
    function create_if_block_4(ctx) {
    	let div;
    	let t0_value = /*card*/ ctx[57].count + "";
    	let t0;
    	let t1;

    	return {
    		c() {
    			div = element("div");
    			t0 = text(t0_value);
    			t1 = text("x");
    			attr(div, "class", "count svelte-cf5kd");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, t0);
    			append(div, t1);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*promise*/ 64 && t0_value !== (t0_value = /*card*/ ctx[57].count + "")) set_data(t0, t0_value);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (793:16) {#if scaling > 90}
    function create_if_block_3(ctx) {
    	let div;
    	let t_value = (/*card*/ ctx[57].data.prices.usd + "$" || "???") + "";
    	let t;

    	return {
    		c() {
    			div = element("div");
    			t = text(t_value);
    			attr(div, "class", "price svelte-cf5kd");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, t);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*promise*/ 64 && t_value !== (t_value = (/*card*/ ctx[57].data.prices.usd + "$" || "???") + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (768:12) {#each group.cards as card}
    function create_each_block_2(ctx) {
    	let div;
    	let t0;
    	let t1;
    	let t2;
    	let t3;
    	let div_style_value;

    	let each_value_3 = {
    		length: /*card*/ ctx[57].count > 4 ? 4 : /*card*/ ctx[57].count
    	};

    	let each_blocks = [];

    	for (let i = 0; i < each_value_3.length; i += 1) {
    		each_blocks[i] = create_each_block_3(get_each_context_3(ctx, each_value_3, i));
    	}

    	let if_block0 = /*card*/ ctx[57].data.legalities[/*format*/ ctx[9].value] !== "legal" && create_if_block_5(ctx);
    	let if_block1 = /*card*/ ctx[57].count > 4 && create_if_block_4(ctx);
    	let if_block2 = /*scaling*/ ctx[4] > 90 && create_if_block_3(ctx);

    	return {
    		c() {
    			div = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t0 = space();
    			if (if_block0) if_block0.c();
    			t1 = space();
    			if (if_block1) if_block1.c();
    			t2 = space();
    			if (if_block2) if_block2.c();
    			t3 = space();
    			attr(div, "class", "entry svelte-cf5kd");

    			attr(div, "style", div_style_value = "width:" + /*width*/ ctx[1] + "px; height:" + (/*card*/ ctx[57].count <= 4
    			? /*height*/ ctx[0] + ((/*card*/ ctx[57].count || 1) - 1) * 40
    			: /*height*/ ctx[0] + 3 * 40) + "px;");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div, null);
    			}

    			append(div, t0);
    			if (if_block0) if_block0.m(div, null);
    			append(div, t1);
    			if (if_block1) if_block1.m(div, null);
    			append(div, t2);
    			if (if_block2) if_block2.m(div, null);
    			append(div, t3);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*promise, width, height, format, devotionHighlight*/ 611 | dirty[1] & /*remove*/ 1) {
    				each_value_3 = {
    					length: /*card*/ ctx[57].count > 4 ? 4 : /*card*/ ctx[57].count
    				};

    				let i;

    				for (i = 0; i < each_value_3.length; i += 1) {
    					const child_ctx = get_each_context_3(ctx, each_value_3, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block_3(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(div, t0);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value_3.length;
    			}

    			if (/*card*/ ctx[57].data.legalities[/*format*/ ctx[9].value] !== "legal") {
    				if (if_block0) ; else {
    					if_block0 = create_if_block_5(ctx);
    					if_block0.c();
    					if_block0.m(div, t1);
    				}
    			} else if (if_block0) {
    				if_block0.d(1);
    				if_block0 = null;
    			}

    			if (/*card*/ ctx[57].count > 4) {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);
    				} else {
    					if_block1 = create_if_block_4(ctx);
    					if_block1.c();
    					if_block1.m(div, t2);
    				}
    			} else if (if_block1) {
    				if_block1.d(1);
    				if_block1 = null;
    			}

    			if (/*scaling*/ ctx[4] > 90) {
    				if (if_block2) {
    					if_block2.p(ctx, dirty);
    				} else {
    					if_block2 = create_if_block_3(ctx);
    					if_block2.c();
    					if_block2.m(div, t3);
    				}
    			} else if (if_block2) {
    				if_block2.d(1);
    				if_block2 = null;
    			}

    			if (dirty[0] & /*width, promise, height*/ 67 && div_style_value !== (div_style_value = "width:" + /*width*/ ctx[1] + "px; height:" + (/*card*/ ctx[57].count <= 4
    			? /*height*/ ctx[0] + ((/*card*/ ctx[57].count || 1) - 1) * 40
    			: /*height*/ ctx[0] + 3 * 40) + "px;")) {
    				attr(div, "style", div_style_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			destroy_each(each_blocks, detaching);
    			if (if_block0) if_block0.d();
    			if (if_block1) if_block1.d();
    			if (if_block2) if_block2.d();
    		}
    	};
    }

    // (739:6) {#each groups || [] as group}
    function create_each_block_1(ctx) {
    	let div11;
    	let div9;
    	let h2;
    	let t0_value = (/*group*/ ctx[62].name + " // " + /*group*/ ctx[62].count || "no name") + "";
    	let t0;
    	let t1;
    	let button;
    	let t3;
    	let div8;
    	let div0;
    	let t4_value = /*group*/ ctx[62].mana.blue + "";
    	let t4;
    	let t5;
    	let div1;
    	let t6_value = /*group*/ ctx[62].mana.black + "";
    	let t6;
    	let t7;
    	let div2;
    	let t8_value = /*group*/ ctx[62].mana.red + "";
    	let t8;
    	let t9;
    	let div3;
    	let t10_value = /*group*/ ctx[62].mana.white + "";
    	let t10;
    	let t11;
    	let div4;
    	let t12_value = /*group*/ ctx[62].mana.green + "";
    	let t12;
    	let t13;
    	let div5;
    	let t14_value = /*group*/ ctx[62].mana.colorless + "";
    	let t14;
    	let t15;
    	let div6;
    	let t16_value = /*group*/ ctx[62].mana.sum + "";
    	let t16;
    	let t17;
    	let div7;
    	let t18_value = /*group*/ ctx[62].cost.toFixed(2) + "$" + "";
    	let t18;
    	let t19;
    	let div10;
    	let t20;
    	let mounted;
    	let dispose;

    	function click_handler_2(...args) {
    		return /*click_handler_2*/ ctx[44](/*group*/ ctx[62], ...args);
    	}

    	let each_value_2 = /*group*/ ctx[62].cards;
    	let each_blocks = [];

    	for (let i = 0; i < each_value_2.length; i += 1) {
    		each_blocks[i] = create_each_block_2(get_each_context_2(ctx, each_value_2, i));
    	}

    	return {
    		c() {
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

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t20 = space();
    			attr(h2, "class", "svelte-cf5kd");
    			attr(div0, "class", "group-value blue svelte-cf5kd");
    			attr(div1, "class", "group-value black svelte-cf5kd");
    			attr(div2, "class", "group-value red svelte-cf5kd");
    			attr(div3, "class", "group-value white svelte-cf5kd");
    			attr(div4, "class", "group-value green svelte-cf5kd");
    			attr(div5, "class", "group-value colorless svelte-cf5kd");
    			attr(div6, "class", "group-value sum svelte-cf5kd");
    			attr(div7, "class", "group-value group-cost svelte-cf5kd");
    			attr(div8, "class", "group-statistics svelte-cf5kd");
    			attr(div9, "class", "group-header svelte-cf5kd");
    			attr(div10, "class", "group-content svelte-cf5kd");
    			toggle_class(div10, "hidden", /*hiddenGroups*/ ctx[20].has(/*group*/ ctx[62].name));
    			attr(div11, "class", "group");
    		},
    		m(target, anchor) {
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

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div10, null);
    			}

    			append(div11, t20);

    			if (!mounted) {
    				dispose = listen(button, "click", click_handler_2);
    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;
    			if (dirty[0] & /*promise*/ 64 && t0_value !== (t0_value = (/*group*/ ctx[62].name + " // " + /*group*/ ctx[62].count || "no name") + "")) set_data(t0, t0_value);
    			if (dirty[0] & /*promise*/ 64 && t4_value !== (t4_value = /*group*/ ctx[62].mana.blue + "")) set_data(t4, t4_value);
    			if (dirty[0] & /*promise*/ 64 && t6_value !== (t6_value = /*group*/ ctx[62].mana.black + "")) set_data(t6, t6_value);
    			if (dirty[0] & /*promise*/ 64 && t8_value !== (t8_value = /*group*/ ctx[62].mana.red + "")) set_data(t8, t8_value);
    			if (dirty[0] & /*promise*/ 64 && t10_value !== (t10_value = /*group*/ ctx[62].mana.white + "")) set_data(t10, t10_value);
    			if (dirty[0] & /*promise*/ 64 && t12_value !== (t12_value = /*group*/ ctx[62].mana.green + "")) set_data(t12, t12_value);
    			if (dirty[0] & /*promise*/ 64 && t14_value !== (t14_value = /*group*/ ctx[62].mana.colorless + "")) set_data(t14, t14_value);
    			if (dirty[0] & /*promise*/ 64 && t16_value !== (t16_value = /*group*/ ctx[62].mana.sum + "")) set_data(t16, t16_value);
    			if (dirty[0] & /*promise*/ 64 && t18_value !== (t18_value = /*group*/ ctx[62].cost.toFixed(2) + "$" + "")) set_data(t18, t18_value);

    			if (dirty[0] & /*width, promise, height, scaling, format, devotionHighlight*/ 627 | dirty[1] & /*remove*/ 1) {
    				each_value_2 = /*group*/ ctx[62].cards;
    				let i;

    				for (i = 0; i < each_value_2.length; i += 1) {
    					const child_ctx = get_each_context_2(ctx, each_value_2, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
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

    			if (dirty[0] & /*hiddenGroups, promise*/ 1048640) {
    				toggle_class(div10, "hidden", /*hiddenGroups*/ ctx[20].has(/*group*/ ctx[62].name));
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div11);
    			destroy_each(each_blocks, detaching);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (729:20)         <div class="loading-wrapper">          <div>loading: {progress}
    function create_pending_block_1(ctx) {
    	let div4;
    	let div0;
    	let t0;
    	let t1;
    	let t2;
    	let t3;
    	let t4;
    	let div3;

    	return {
    		c() {
    			div4 = element("div");
    			div0 = element("div");
    			t0 = text("loading: ");
    			t1 = text(/*progress*/ ctx[10]);
    			t2 = text("/");
    			t3 = text(/*all*/ ctx[11]);
    			t4 = space();
    			div3 = element("div");

    			div3.innerHTML = `<div class="svelte-cf5kd"></div> 
          <div class="svelte-cf5kd"></div>`;

    			attr(div3, "class", "lds-ripple svelte-cf5kd");
    			attr(div4, "class", "loading-wrapper svelte-cf5kd");
    		},
    		m(target, anchor) {
    			insert(target, div4, anchor);
    			append(div4, div0);
    			append(div0, t0);
    			append(div0, t1);
    			append(div0, t2);
    			append(div0, t3);
    			append(div4, t4);
    			append(div4, div3);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*progress*/ 1024) set_data(t1, /*progress*/ ctx[10]);
    			if (dirty[0] & /*all*/ 2048) set_data(t3, /*all*/ ctx[11]);
    		},
    		d(detaching) {
    			if (detaching) detach(div4);
    		}
    	};
    }

    // (915:4) {:catch error}
    function create_catch_block(ctx) {
    	let div;

    	return {
    		c() {
    			div = element("div");
    			div.textContent = "ERROR, check your decklist for correct format or internet connection\r\n        brudi";
    			attr(div, "class", "error svelte-cf5kd");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (879:4) {:then result}
    function create_then_block(ctx) {
    	let if_block_anchor;

    	function select_block_type(ctx, dirty) {
    		if (/*result*/ ctx[56].code !== "not_found" && /*result*/ ctx[56].data) return create_if_block;
    		return create_else_block_1;
    	}

    	let current_block_type = select_block_type(ctx, [-1]);
    	let if_block = current_block_type(ctx);

    	return {
    		c() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if_block.m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (current_block_type === (current_block_type = select_block_type(ctx, dirty)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			}
    		},
    		d(detaching) {
    			if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    // (912:6) {:else}
    function create_else_block_1(ctx) {
    	let div;

    	return {
    		c() {
    			div = element("div");
    			div.textContent = "No cards found";
    			attr(div, "class", "svelte-cf5kd");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (881:6) {#if result.code !== 'not_found' && result.data}
    function create_if_block(ctx) {
    	let div;
    	let t0;
    	let button;
    	let t1;
    	let button_disabled_value;
    	let mounted;
    	let dispose;
    	let each_value = /*result*/ ctx[56].data;
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	let each_1_else = null;

    	if (!each_value.length) {
    		each_1_else = create_else_block(ctx);
    	}

    	function click_handler_3(...args) {
    		return /*click_handler_3*/ ctx[55](/*result*/ ctx[56], ...args);
    	}

    	return {
    		c() {
    			div = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			if (each_1_else) {
    				each_1_else.c();
    			}

    			t0 = space();
    			button = element("button");
    			t1 = text("next");
    			attr(div, "class", "search-result svelte-cf5kd");
    			button.disabled = button_disabled_value = !/*result*/ ctx[56].has_more;
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div, null);
    			}

    			if (each_1_else) {
    				each_1_else.m(div, null);
    			}

    			insert(target, t0, anchor);
    			insert(target, button, anchor);
    			append(button, t1);

    			if (!mounted) {
    				dispose = listen(button, "click", click_handler_3);
    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (dirty[0] & /*width, height, cardSearchPromise, scaling, format, appendCard*/ 1073742483) {
    				each_value = /*result*/ ctx[56].data;
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
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
    			}

    			if (dirty[0] & /*cardSearchPromise*/ 128 && button_disabled_value !== (button_disabled_value = !/*result*/ ctx[56].has_more)) {
    				button.disabled = button_disabled_value;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			destroy_each(each_blocks, detaching);
    			if (each_1_else) each_1_else.d();
    			if (detaching) detach(t0);
    			if (detaching) detach(button);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (903:10) {:else}
    function create_else_block(ctx) {
    	let div;

    	return {
    		c() {
    			div = element("div");
    			div.textContent = "No cards found";
    			attr(div, "class", "svelte-cf5kd");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (896:14) {#if card.legalities[format.value] !== 'legal'}
    function create_if_block_2(ctx) {
    	let div;

    	return {
    		c() {
    			div = element("div");
    			div.textContent = "BANNED";
    			attr(div, "class", "banned-text svelte-cf5kd");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (899:14) {#if scaling > 90}
    function create_if_block_1(ctx) {
    	let div;
    	let t_value = (/*card*/ ctx[57].prices.usd + "$" || "???") + "";
    	let t;

    	return {
    		c() {
    			div = element("div");
    			t = text(t_value);
    			attr(div, "class", "price svelte-cf5kd");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, t);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*cardSearchPromise*/ 128 && t_value !== (t_value = (/*card*/ ctx[57].prices.usd + "$" || "???") + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (883:10) {#each result.data as card}
    function create_each_block(ctx) {
    	let div;
    	let img;
    	let img_src_value;
    	let img_alt_value;
    	let t0;
    	let t1;
    	let t2;
    	let div_style_value;
    	let mounted;
    	let dispose;

    	function dblclick_handler_1(...args) {
    		return /*dblclick_handler_1*/ ctx[54](/*card*/ ctx[57], ...args);
    	}

    	let if_block0 = /*card*/ ctx[57].legalities[/*format*/ ctx[9].value] !== "legal" && create_if_block_2(ctx);
    	let if_block1 = /*scaling*/ ctx[4] > 90 && create_if_block_1(ctx);

    	return {
    		c() {
    			div = element("div");
    			img = element("img");
    			t0 = space();
    			if (if_block0) if_block0.c();
    			t1 = space();
    			if (if_block1) if_block1.c();
    			t2 = space();
    			attr(img, "class", "card svelte-cf5kd");
    			if (img.src !== (img_src_value = /*card*/ ctx[57].url)) attr(img, "src", img_src_value);
    			attr(img, "alt", img_alt_value = /*card*/ ctx[57].name);
    			attr(img, "width", /*width*/ ctx[1]);
    			attr(img, "height", /*height*/ ctx[0]);
    			toggle_class(img, "banned", /*card*/ ctx[57].legalities[/*format*/ ctx[9].value] !== "legal");
    			attr(div, "class", "entry svelte-cf5kd");
    			attr(div, "style", div_style_value = "width:" + /*width*/ ctx[1] + "px; height:" + /*height*/ ctx[0] + "px;");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, img);
    			append(div, t0);
    			if (if_block0) if_block0.m(div, null);
    			append(div, t1);
    			if (if_block1) if_block1.m(div, null);
    			append(div, t2);

    			if (!mounted) {
    				dispose = listen(img, "dblclick", dblclick_handler_1);
    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (dirty[0] & /*cardSearchPromise*/ 128 && img.src !== (img_src_value = /*card*/ ctx[57].url)) {
    				attr(img, "src", img_src_value);
    			}

    			if (dirty[0] & /*cardSearchPromise*/ 128 && img_alt_value !== (img_alt_value = /*card*/ ctx[57].name)) {
    				attr(img, "alt", img_alt_value);
    			}

    			if (dirty[0] & /*width*/ 2) {
    				attr(img, "width", /*width*/ ctx[1]);
    			}

    			if (dirty[0] & /*height*/ 1) {
    				attr(img, "height", /*height*/ ctx[0]);
    			}

    			if (dirty[0] & /*cardSearchPromise, format*/ 640) {
    				toggle_class(img, "banned", /*card*/ ctx[57].legalities[/*format*/ ctx[9].value] !== "legal");
    			}

    			if (/*card*/ ctx[57].legalities[/*format*/ ctx[9].value] !== "legal") {
    				if (if_block0) ; else {
    					if_block0 = create_if_block_2(ctx);
    					if_block0.c();
    					if_block0.m(div, t1);
    				}
    			} else if (if_block0) {
    				if_block0.d(1);
    				if_block0 = null;
    			}

    			if (/*scaling*/ ctx[4] > 90) {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);
    				} else {
    					if_block1 = create_if_block_1(ctx);
    					if_block1.c();
    					if_block1.m(div, t2);
    				}
    			} else if (if_block1) {
    				if_block1.d(1);
    				if_block1 = null;
    			}

    			if (dirty[0] & /*width, height*/ 3 && div_style_value !== (div_style_value = "width:" + /*width*/ ctx[1] + "px; height:" + /*height*/ ctx[0] + "px;")) {
    				attr(div, "style", div_style_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			if (if_block0) if_block0.d();
    			if (if_block1) if_block1.d();
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (872:30)         <div class="loading-wrapper">          <div class="lds-ripple">            <div />            <div />          </div>        </div>      {:then result}
    function create_pending_block(ctx) {
    	let div3;

    	return {
    		c() {
    			div3 = element("div");

    			div3.innerHTML = `<div class="lds-ripple svelte-cf5kd"><div class="svelte-cf5kd"></div> 
          <div class="svelte-cf5kd"></div></div>`;

    			attr(div3, "class", "loading-wrapper svelte-cf5kd");
    		},
    		m(target, anchor) {
    			insert(target, div3, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(div3);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let div17;
    	let div3;
    	let div2;
    	let div0;
    	let t1;
    	let t2;
    	let promise_1;
    	let t3;
    	let select;
    	let option0;
    	let option1;
    	let option2;
    	let option3;
    	let option4;
    	let option5;
    	let option6;
    	let option7;
    	let option8;
    	let option9;
    	let option10;
    	let option11;
    	let option12;
    	let t17;
    	let div1;
    	let t18;
    	let input0;
    	let t19;
    	let button0;
    	let t21;
    	let button1;
    	let t23;
    	let button2;
    	let t25;
    	let textarea;
    	let t26;
    	let div4;
    	let promise_2;
    	let t27;
    	let div16;
    	let div5;
    	let t29;
    	let div15;
    	let div6;
    	let t30;
    	let input1;
    	let t31;
    	let div7;
    	let t32;
    	let input2;
    	let t33;
    	let div14;
    	let t34;
    	let div8;
    	let input3;
    	let t35;
    	let div9;
    	let input4;
    	let t36;
    	let div10;
    	let input5;
    	let t37;
    	let div11;
    	let input6;
    	let t38;
    	let div12;
    	let input7;
    	let t39;
    	let div13;
    	let input8;
    	let t40;
    	let button3;
    	let t42;
    	let promise_3;
    	let mounted;
    	let dispose;
    	let if_block = /*helpActive*/ ctx[21] && create_if_block_10(ctx);

    	let info = {
    		ctx,
    		current: null,
    		token: null,
    		pending: create_pending_block_2,
    		then: create_then_block_2,
    		catch: create_catch_block_2,
    		value: 61,
    		error: 60
    	};

    	handle_promise(promise_1 = /*promise*/ ctx[6], info);

    	let info_1 = {
    		ctx,
    		current: null,
    		token: null,
    		pending: create_pending_block_1,
    		then: create_then_block_1,
    		catch: create_catch_block_1,
    		value: 61,
    		error: 60
    	};

    	handle_promise(promise_2 = /*promise*/ ctx[6], info_1);

    	let info_2 = {
    		ctx,
    		current: null,
    		token: null,
    		pending: create_pending_block,
    		then: create_then_block,
    		catch: create_catch_block,
    		value: 56,
    		error: 60
    	};

    	handle_promise(promise_3 = /*cardSearchPromise*/ ctx[7], info_2);

    	return {
    		c() {
    			div17 = element("div");
    			div3 = element("div");
    			div2 = element("div");
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
    			button0 = element("button");
    			button0.textContent = "toggle statistics";
    			t21 = space();
    			button1 = element("button");
    			button1.textContent = "sort";
    			t23 = space();
    			button2 = element("button");
    			button2.textContent = "clean copy";
    			t25 = space();
    			textarea = element("textarea");
    			t26 = space();
    			div4 = element("div");
    			info_1.block.c();
    			t27 = space();
    			div16 = element("div");
    			div5 = element("div");
    			div5.textContent = "x";
    			t29 = space();
    			div15 = element("div");
    			div6 = element("div");
    			t30 = text("Name:\r\n        ");
    			input1 = element("input");
    			t31 = space();
    			div7 = element("div");
    			t32 = text("Text:\r\n        ");
    			input2 = element("input");
    			t33 = space();
    			div14 = element("div");
    			t34 = text("Commander-Colors:\r\n        ");
    			div8 = element("div");
    			input3 = element("input");
    			t35 = space();
    			div9 = element("div");
    			input4 = element("input");
    			t36 = space();
    			div10 = element("div");
    			input5 = element("input");
    			t37 = space();
    			div11 = element("div");
    			input6 = element("input");
    			t38 = space();
    			div12 = element("div");
    			input7 = element("input");
    			t39 = space();
    			div13 = element("div");
    			input8 = element("input");
    			t40 = space();
    			button3 = element("button");
    			button3.textContent = "search";
    			t42 = space();
    			info_2.block.c();
    			attr(div0, "class", "help-symbol svelte-cf5kd");
    			option0.selected = true;
    			option0.__value = "commander";
    			option0.value = option0.__value;
    			option1.__value = "brawl";
    			option1.value = option1.__value;
    			option2.__value = "duel";
    			option2.value = option2.__value;
    			option3.__value = "future";
    			option3.value = option3.__value;
    			option4.__value = "historic";
    			option4.value = option4.__value;
    			option5.__value = "legacy";
    			option5.value = option5.__value;
    			option6.__value = "modern";
    			option6.value = option6.__value;
    			option7.__value = "oldschool";
    			option7.value = option7.__value;
    			option8.__value = "pauper";
    			option8.value = option8.__value;
    			option9.__value = "penny";
    			option9.value = option9.__value;
    			option10.__value = "pioneer";
    			option10.value = option10.__value;
    			option11.__value = "standard";
    			option11.value = option11.__value;
    			option12.__value = "vintage";
    			option12.value = option12.__value;
    			attr(input0, "type", "range");
    			attr(input0, "min", "25");
    			attr(input0, "max", "100");
    			attr(div1, "class", "slidecontainer");
    			attr(div2, "class", "help svelte-cf5kd");
    			attr(textarea, "class", "input svelte-cf5kd");
    			attr(div3, "class", "controls svelte-cf5kd");
    			attr(div4, "class", "display svelte-cf5kd");
    			attr(div5, "class", "toggle-search svelte-cf5kd");
    			attr(div6, "class", "search-param svelte-cf5kd");
    			attr(div7, "class", "search-param svelte-cf5kd");
    			attr(input3, "type", "checkbox");
    			attr(input3, "class", "blue svelte-cf5kd");
    			attr(div8, "class", "blue svelte-cf5kd");
    			attr(input4, "type", "checkbox");
    			attr(input4, "class", "black svelte-cf5kd");
    			attr(div9, "class", "black svelte-cf5kd");
    			attr(input5, "type", "checkbox");
    			attr(input5, "class", "red svelte-cf5kd");
    			attr(div10, "class", "red svelte-cf5kd");
    			attr(input6, "type", "checkbox");
    			attr(input6, "class", "white svelte-cf5kd");
    			attr(div11, "class", "white svelte-cf5kd");
    			attr(input7, "type", "checkbox");
    			attr(input7, "class", "green svelte-cf5kd");
    			attr(div12, "class", "green svelte-cf5kd");
    			attr(input8, "type", "checkbox");
    			attr(input8, "class", "colorless svelte-cf5kd");
    			attr(div13, "class", "colorless svelte-cf5kd");
    			attr(div14, "class", "search-param color-param svelte-cf5kd");
    			attr(div15, "class", "search-params svelte-cf5kd");
    			attr(div16, "class", "card-search svelte-cf5kd");
    			toggle_class(div16, "hide", !/*cardSearchActive*/ ctx[2]);
    			attr(div17, "class", "content svelte-cf5kd");
    		},
    		m(target, anchor) {
    			insert(target, div17, anchor);
    			append(div17, div3);
    			append(div3, div2);
    			append(div2, div0);
    			append(div2, t1);
    			if (if_block) if_block.m(div2, null);
    			append(div2, t2);
    			info.block.m(div2, info.anchor = null);
    			info.mount = () => div2;
    			info.anchor = t3;
    			append(div2, t3);
    			append(div2, select);
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
    			/*select_binding*/ ctx[41](select);
    			append(div2, t17);
    			append(div2, div1);
    			append(div1, t18);
    			append(div1, input0);
    			set_input_value(input0, /*scaling*/ ctx[4]);
    			append(div2, t19);
    			append(div2, button0);
    			append(div2, t21);
    			append(div2, button1);
    			append(div2, t23);
    			append(div2, button2);
    			append(div3, t25);
    			append(div3, textarea);
    			/*textarea_binding*/ ctx[43](textarea);
    			append(div17, t26);
    			append(div17, div4);
    			info_1.block.m(div4, info_1.anchor = null);
    			info_1.mount = () => div4;
    			info_1.anchor = null;
    			append(div17, t27);
    			append(div17, div16);
    			append(div16, div5);
    			append(div16, t29);
    			append(div16, div15);
    			append(div15, div6);
    			append(div6, t30);
    			append(div6, input1);
    			/*input1_binding*/ ctx[46](input1);
    			append(div15, t31);
    			append(div15, div7);
    			append(div7, t32);
    			append(div7, input2);
    			/*input2_binding*/ ctx[47](input2);
    			append(div15, t33);
    			append(div15, div14);
    			append(div14, t34);
    			append(div14, div8);
    			append(div8, input3);
    			/*input3_binding*/ ctx[48](input3);
    			append(div14, t35);
    			append(div14, div9);
    			append(div9, input4);
    			/*input4_binding*/ ctx[49](input4);
    			append(div14, t36);
    			append(div14, div10);
    			append(div10, input5);
    			/*input5_binding*/ ctx[50](input5);
    			append(div14, t37);
    			append(div14, div11);
    			append(div11, input6);
    			/*input6_binding*/ ctx[51](input6);
    			append(div14, t38);
    			append(div14, div12);
    			append(div12, input7);
    			/*input7_binding*/ ctx[52](input7);
    			append(div14, t39);
    			append(div14, div13);
    			append(div13, input8);
    			/*input8_binding*/ ctx[53](input8);
    			append(div15, t40);
    			append(div15, button3);
    			append(div16, t42);
    			info_2.block.m(div16, info_2.anchor = null);
    			info_2.mount = () => div16;
    			info_2.anchor = null;

    			if (!mounted) {
    				dispose = [
    					listen(window, "keyup", /*update*/ ctx[28]),
    					listen(div0, "click", /*openHelp*/ ctx[34]),
    					listen(select, "blur", /*reload*/ ctx[29]),
    					listen(select, "change", /*reload*/ ctx[29]),
    					listen(input0, "change", /*input0_change_input_handler*/ ctx[42]),
    					listen(input0, "input", /*input0_change_input_handler*/ ctx[42]),
    					listen(button0, "click", /*toggleStatistics*/ ctx[36]),
    					listen(button1, "click", /*sortDeckString*/ ctx[27]),
    					listen(button2, "click", /*copyDeck*/ ctx[32]),
    					listen(textarea, "keyup", /*onTyping*/ ctx[33]),
    					listen(div5, "click", /*toggleSearch*/ ctx[35]),
    					listen(input3, "click", /*clearColorless*/ ctx[24]),
    					listen(input4, "click", /*clearColorless*/ ctx[24]),
    					listen(input5, "click", /*clearColorless*/ ctx[24]),
    					listen(input6, "click", /*clearColorless*/ ctx[24]),
    					listen(input7, "click", /*clearColorless*/ ctx[24]),
    					listen(input8, "click", /*clearForColorless*/ ctx[23]),
    					listen(button3, "click", /*searchCards*/ ctx[25])
    				];

    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (/*helpActive*/ ctx[21]) {
    				if (if_block) ; else {
    					if_block = create_if_block_10(ctx);
    					if_block.c();
    					if_block.m(div2, t2);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}

    			info.ctx = ctx;

    			if (dirty[0] & /*promise*/ 64 && promise_1 !== (promise_1 = /*promise*/ ctx[6]) && handle_promise(promise_1, info)) ; else {
    				const child_ctx = ctx.slice();
    				child_ctx[61] = info.resolved;
    				info.block.p(child_ctx, dirty);
    			}

    			if (dirty[0] & /*scaling*/ 16) {
    				set_input_value(input0, /*scaling*/ ctx[4]);
    			}

    			info_1.ctx = ctx;

    			if (dirty[0] & /*promise*/ 64 && promise_2 !== (promise_2 = /*promise*/ ctx[6]) && handle_promise(promise_2, info_1)) ; else {
    				const child_ctx = ctx.slice();
    				child_ctx[61] = info_1.resolved;
    				info_1.block.p(child_ctx, dirty);
    			}

    			info_2.ctx = ctx;

    			if (dirty[0] & /*cardSearchPromise*/ 128 && promise_3 !== (promise_3 = /*cardSearchPromise*/ ctx[7]) && handle_promise(promise_3, info_2)) ; else {
    				const child_ctx = ctx.slice();
    				child_ctx[56] = info_2.resolved;
    				info_2.block.p(child_ctx, dirty);
    			}

    			if (dirty[0] & /*cardSearchActive*/ 4) {
    				toggle_class(div16, "hide", !/*cardSearchActive*/ ctx[2]);
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div17);
    			if (if_block) if_block.d();
    			info.block.d();
    			info.token = null;
    			info = null;
    			/*select_binding*/ ctx[41](null);
    			/*textarea_binding*/ ctx[43](null);
    			info_1.block.d();
    			info_1.token = null;
    			info_1 = null;
    			/*input1_binding*/ ctx[46](null);
    			/*input2_binding*/ ctx[47](null);
    			/*input3_binding*/ ctx[48](null);
    			/*input4_binding*/ ctx[49](null);
    			/*input5_binding*/ ctx[50](null);
    			/*input6_binding*/ ctx[51](null);
    			/*input7_binding*/ ctx[52](null);
    			/*input8_binding*/ ctx[53](null);
    			info_2.block.d();
    			info_2.token = null;
    			info_2 = null;
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    const CARD_RATIO = 0.71764705882;
    let _height = 300;

    function getHeight(mana, groups) {
    	return 100 * (mana / Math.max(...groups["manaCurve"]));
    }

    function instance($$self, $$props, $$invalidate) {
    	let _width = Math.floor(_height * CARD_RATIO);
    	let height = _height;
    	let width = _width;
    	let cardSearchActive = true;
    	let statisticsActive = true;
    	let scaling = 100;
    	let devotionHighlight = -1;

    	function highlightDevotion(mana) {
    		if (devotionHighlight == mana) $$invalidate(5, devotionHighlight = -1); else $$invalidate(5, devotionHighlight = mana + "");
    	}

    	let promise = new Promise(resolve => resolve([]));

    	let cardSearchPromise = new Promise(resolve => resolve({
    			data: [],
    			has_more: false,
    			total_cards: 0
    		}));

    	let input;
    	let format;
    	let progress = 0;
    	let all = 0;
    	let spName;
    	let spText;
    	let spEDHBlue;
    	let spEDHBlack;
    	let spEDHRed;
    	let spEDHWhite;
    	let spEDHGreen;
    	let spEDHColorless;

    	function clearForColorless() {
    		$$invalidate(14, spEDHBlue.checked = false, spEDHBlue);
    		$$invalidate(15, spEDHBlack.checked = false, spEDHBlack);
    		$$invalidate(16, spEDHRed.checked = false, spEDHRed);
    		$$invalidate(17, spEDHWhite.checked = false, spEDHWhite);
    		$$invalidate(18, spEDHGreen.checked = false, spEDHGreen);
    	}

    	function clearColorless() {
    		$$invalidate(19, spEDHColorless.checked = false, spEDHColorless);
    	}

    	function searchCards(nextUrl) {
    		if (typeof nextUrl == "string") {
    			$$invalidate(7, cardSearchPromise = cardLoader.search(nextUrl));
    			return;
    		}

    		const colors = new Set();
    		if (spEDHColorless.checked) colors.add("C");
    		if (spEDHBlue.checked) colors.add("U");
    		if (spEDHBlack.checked) colors.add("B");
    		if (spEDHRed.checked) colors.add("R");
    		if (spEDHWhite.checked) colors.add("W");
    		if (spEDHGreen.checked) colors.add("G");

    		$$invalidate(7, cardSearchPromise = cardLoader.search({
    			name: spName.value,
    			text: spText.value,
    			edhcolors: colors
    		}));
    	}

    	let hiddenGroups = new Set();

    	function toggleGroupVisibility(group) {
    		if (hiddenGroups.has(group.name)) hiddenGroups.delete(group.name); else hiddenGroups.add(group.name);
    		$$invalidate(20, hiddenGroups);
    	}

    	function sp(p, a) {
    		$$invalidate(10, progress = p);
    		$$invalidate(11, all = a);
    	}

    	function sortDeckString() {
    		$$invalidate(6, promise = cardLoader.sort(input.value || "", (p, a) => {
    			sp(p, a);
    		}).catch(e => {
    			console.error(e);
    			throw e;
    		}).then(res => {
    			$$invalidate(8, input.value = res, input);
    			return update({ keyCode: 27 }, true);
    		}));
    	}

    	async function update(evt) {
    		if (evt.keyCode !== 27) return;

    		$$invalidate(6, promise = cardLoader.createDeck(input.value || "", (p, a) => {
    			sp(p, a);
    		}).catch(e => {
    			console.error(e);
    			throw e;
    		}).then(res => {
    			$$invalidate(8, input.value = res.corrected, input);
    			return res;
    		}));

    		return promise;
    	}

    	function reload() {
    		update({ keyCode: 27 });
    	}

    	function appendCard(name) {
    		if (!name) return;
    		$$invalidate(8, input.value = input.value + "\n1 " + name, input);
    		reload();
    	}

    	function remove(card) {
    		const r = new RegExp(`^.*${card.name}.*$`, "gm");
    		$$invalidate(8, input.value = input.value.replace(r, ""), input);

    		$$invalidate(6, promise = cardLoader.createDeck(input.value || "", (p, a) => sp(p, a)).catch(e => {
    			console.error(e);
    			throw e;
    		}));
    	}

    	function copyDeck() {
    		input.select();
    		input.setSelectionRange(0, 99999);
    		document.execCommand("copy");
    	}

    	let helpActive = true;

    	onMount(async () => {
    		const start = js_cookie.get("deck") || `#lands
mountain
2 plains
3 swamps
# main deck
20 blightsteel colossus`;

    		$$invalidate(21, helpActive = js_cookie.get("helpActive") == "true");
    		console.log("help:", js_cookie.get("helpActive"));
    		$$invalidate(2, cardSearchActive = js_cookie.set("cardSearchActive") == "true");
    		console.log("search:", js_cookie.set("cardSearchActive"));
    		$$invalidate(3, statisticsActive = js_cookie.set("statisticsActive") == "true");
    		console.log("statistics:", js_cookie.set("statisticsActive"));
    		$$invalidate(8, input.value = start, input);
    		(console.log("STSFSDF", js_cookie.get("deck")), $$invalidate(6, promise = cardLoader.createDeck(start, (p, a) => sp(p, a))));
    	});

    	function onTyping() {
    		js_cookie.set("deck", input.value, { expires: 7 });
    	}

    	function openHelp() {
    		$$invalidate(21, helpActive = !helpActive);
    		js_cookie.set("helpActive", helpActive + "");
    	}

    	function toggleSearch() {
    		$$invalidate(2, cardSearchActive = !cardSearchActive);
    		js_cookie.set("cardSearchActive", cardSearchActive + "");
    	}

    	function toggleStatistics() {
    		$$invalidate(3, statisticsActive = !statisticsActive);
    		js_cookie.set("statisticsActive", statisticsActive + "");
    	}

    	const click_handler = i => highlightDevotion(i);
    	const click_handler_1 = i => highlightDevotion(i);

    	function select_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(9, format = $$value);
    		});
    	}

    	function input0_change_input_handler() {
    		scaling = to_number(this.value);
    		$$invalidate(4, scaling);
    	}

    	function textarea_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(8, input = $$value);
    		});
    	}

    	const click_handler_2 = group => toggleGroupVisibility(group);
    	const dblclick_handler = card => remove(card);

    	function input1_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(12, spName = $$value);
    		});
    	}

    	function input2_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(13, spText = $$value);
    		});
    	}

    	function input3_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(14, spEDHBlue = $$value);
    		});
    	}

    	function input4_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(15, spEDHBlack = $$value);
    		});
    	}

    	function input5_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(16, spEDHRed = $$value);
    		});
    	}

    	function input6_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(17, spEDHWhite = $$value);
    		});
    	}

    	function input7_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(18, spEDHGreen = $$value);
    		});
    	}

    	function input8_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(19, spEDHColorless = $$value);
    		});
    	}

    	const dblclick_handler_1 = card => appendCard(card.name);
    	const click_handler_3 = result => searchCards(result.next_page);

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty[0] & /*scaling*/ 16) {
    			$: {
    				const s = Math.floor(scaling || 100) / 100;
    				$$invalidate(0, height = _height * s);
    				$$invalidate(1, width = _width * s);
    			}
    		}
    	};

    	return [
    		height,
    		width,
    		cardSearchActive,
    		statisticsActive,
    		scaling,
    		devotionHighlight,
    		promise,
    		cardSearchPromise,
    		input,
    		format,
    		progress,
    		all,
    		spName,
    		spText,
    		spEDHBlue,
    		spEDHBlack,
    		spEDHRed,
    		spEDHWhite,
    		spEDHGreen,
    		spEDHColorless,
    		hiddenGroups,
    		helpActive,
    		highlightDevotion,
    		clearForColorless,
    		clearColorless,
    		searchCards,
    		toggleGroupVisibility,
    		sortDeckString,
    		update,
    		reload,
    		appendCard,
    		remove,
    		copyDeck,
    		onTyping,
    		openHelp,
    		toggleSearch,
    		toggleStatistics,
    		_width,
    		sp,
    		click_handler,
    		click_handler_1,
    		select_binding,
    		input0_change_input_handler,
    		textarea_binding,
    		click_handler_2,
    		dblclick_handler,
    		input1_binding,
    		input2_binding,
    		input3_binding,
    		input4_binding,
    		input5_binding,
    		input6_binding,
    		input7_binding,
    		input8_binding,
    		dblclick_handler_1,
    		click_handler_3
    	];
    }

    class Editor extends SvelteComponent {
    	constructor(options) {
    		super();
    		if (!document_1.getElementById("svelte-cf5kd-style")) add_css();
    		init(this, options, instance, create_fragment, safe_not_equal, {}, [-1, -1, -1]);
    	}
    }

    const renderTarget = new Editor({
      target: document.body,
      props: {
        test: "sdfdsf"
      }
    });

}());
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWRpdG9yLWJ1bmRsZS5qcyIsInNvdXJjZXMiOlsibm9kZV9tb2R1bGVzL3N2ZWx0ZS9pbnRlcm5hbC9pbmRleC5tanMiLCJjYXJkLWxvYWRlci5qcyIsIm5vZGVfbW9kdWxlcy9qcy1jb29raWUvc3JjL2pzLmNvb2tpZS5qcyIsImVkaXRvci5zdmVsdGUiLCJlZGl0b3ItbWFpbi5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJmdW5jdGlvbiBub29wKCkgeyB9XG5jb25zdCBpZGVudGl0eSA9IHggPT4geDtcbmZ1bmN0aW9uIGFzc2lnbih0YXIsIHNyYykge1xuICAgIC8vIEB0cy1pZ25vcmVcbiAgICBmb3IgKGNvbnN0IGsgaW4gc3JjKVxuICAgICAgICB0YXJba10gPSBzcmNba107XG4gICAgcmV0dXJuIHRhcjtcbn1cbmZ1bmN0aW9uIGlzX3Byb21pc2UodmFsdWUpIHtcbiAgICByZXR1cm4gdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgdmFsdWUudGhlbiA9PT0gJ2Z1bmN0aW9uJztcbn1cbmZ1bmN0aW9uIGFkZF9sb2NhdGlvbihlbGVtZW50LCBmaWxlLCBsaW5lLCBjb2x1bW4sIGNoYXIpIHtcbiAgICBlbGVtZW50Ll9fc3ZlbHRlX21ldGEgPSB7XG4gICAgICAgIGxvYzogeyBmaWxlLCBsaW5lLCBjb2x1bW4sIGNoYXIgfVxuICAgIH07XG59XG5mdW5jdGlvbiBydW4oZm4pIHtcbiAgICByZXR1cm4gZm4oKTtcbn1cbmZ1bmN0aW9uIGJsYW5rX29iamVjdCgpIHtcbiAgICByZXR1cm4gT2JqZWN0LmNyZWF0ZShudWxsKTtcbn1cbmZ1bmN0aW9uIHJ1bl9hbGwoZm5zKSB7XG4gICAgZm5zLmZvckVhY2gocnVuKTtcbn1cbmZ1bmN0aW9uIGlzX2Z1bmN0aW9uKHRoaW5nKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB0aGluZyA9PT0gJ2Z1bmN0aW9uJztcbn1cbmZ1bmN0aW9uIHNhZmVfbm90X2VxdWFsKGEsIGIpIHtcbiAgICByZXR1cm4gYSAhPSBhID8gYiA9PSBiIDogYSAhPT0gYiB8fCAoKGEgJiYgdHlwZW9mIGEgPT09ICdvYmplY3QnKSB8fCB0eXBlb2YgYSA9PT0gJ2Z1bmN0aW9uJyk7XG59XG5mdW5jdGlvbiBub3RfZXF1YWwoYSwgYikge1xuICAgIHJldHVybiBhICE9IGEgPyBiID09IGIgOiBhICE9PSBiO1xufVxuZnVuY3Rpb24gdmFsaWRhdGVfc3RvcmUoc3RvcmUsIG5hbWUpIHtcbiAgICBpZiAoc3RvcmUgIT0gbnVsbCAmJiB0eXBlb2Ygc3RvcmUuc3Vic2NyaWJlICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJyR7bmFtZX0nIGlzIG5vdCBhIHN0b3JlIHdpdGggYSAnc3Vic2NyaWJlJyBtZXRob2RgKTtcbiAgICB9XG59XG5mdW5jdGlvbiBzdWJzY3JpYmUoc3RvcmUsIC4uLmNhbGxiYWNrcykge1xuICAgIGlmIChzdG9yZSA9PSBudWxsKSB7XG4gICAgICAgIHJldHVybiBub29wO1xuICAgIH1cbiAgICBjb25zdCB1bnN1YiA9IHN0b3JlLnN1YnNjcmliZSguLi5jYWxsYmFja3MpO1xuICAgIHJldHVybiB1bnN1Yi51bnN1YnNjcmliZSA/ICgpID0+IHVuc3ViLnVuc3Vic2NyaWJlKCkgOiB1bnN1Yjtcbn1cbmZ1bmN0aW9uIGdldF9zdG9yZV92YWx1ZShzdG9yZSkge1xuICAgIGxldCB2YWx1ZTtcbiAgICBzdWJzY3JpYmUoc3RvcmUsIF8gPT4gdmFsdWUgPSBfKSgpO1xuICAgIHJldHVybiB2YWx1ZTtcbn1cbmZ1bmN0aW9uIGNvbXBvbmVudF9zdWJzY3JpYmUoY29tcG9uZW50LCBzdG9yZSwgY2FsbGJhY2spIHtcbiAgICBjb21wb25lbnQuJCQub25fZGVzdHJveS5wdXNoKHN1YnNjcmliZShzdG9yZSwgY2FsbGJhY2spKTtcbn1cbmZ1bmN0aW9uIGNyZWF0ZV9zbG90KGRlZmluaXRpb24sIGN0eCwgJCRzY29wZSwgZm4pIHtcbiAgICBpZiAoZGVmaW5pdGlvbikge1xuICAgICAgICBjb25zdCBzbG90X2N0eCA9IGdldF9zbG90X2NvbnRleHQoZGVmaW5pdGlvbiwgY3R4LCAkJHNjb3BlLCBmbik7XG4gICAgICAgIHJldHVybiBkZWZpbml0aW9uWzBdKHNsb3RfY3R4KTtcbiAgICB9XG59XG5mdW5jdGlvbiBnZXRfc2xvdF9jb250ZXh0KGRlZmluaXRpb24sIGN0eCwgJCRzY29wZSwgZm4pIHtcbiAgICByZXR1cm4gZGVmaW5pdGlvblsxXSAmJiBmblxuICAgICAgICA/IGFzc2lnbigkJHNjb3BlLmN0eC5zbGljZSgpLCBkZWZpbml0aW9uWzFdKGZuKGN0eCkpKVxuICAgICAgICA6ICQkc2NvcGUuY3R4O1xufVxuZnVuY3Rpb24gZ2V0X3Nsb3RfY2hhbmdlcyhkZWZpbml0aW9uLCAkJHNjb3BlLCBkaXJ0eSwgZm4pIHtcbiAgICBpZiAoZGVmaW5pdGlvblsyXSAmJiBmbikge1xuICAgICAgICBjb25zdCBsZXRzID0gZGVmaW5pdGlvblsyXShmbihkaXJ0eSkpO1xuICAgICAgICBpZiAoJCRzY29wZS5kaXJ0eSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICByZXR1cm4gbGV0cztcbiAgICAgICAgfVxuICAgICAgICBpZiAodHlwZW9mIGxldHMgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICBjb25zdCBtZXJnZWQgPSBbXTtcbiAgICAgICAgICAgIGNvbnN0IGxlbiA9IE1hdGgubWF4KCQkc2NvcGUuZGlydHkubGVuZ3RoLCBsZXRzLmxlbmd0aCk7XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxlbjsgaSArPSAxKSB7XG4gICAgICAgICAgICAgICAgbWVyZ2VkW2ldID0gJCRzY29wZS5kaXJ0eVtpXSB8IGxldHNbaV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gbWVyZ2VkO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAkJHNjb3BlLmRpcnR5IHwgbGV0cztcbiAgICB9XG4gICAgcmV0dXJuICQkc2NvcGUuZGlydHk7XG59XG5mdW5jdGlvbiB1cGRhdGVfc2xvdChzbG90LCBzbG90X2RlZmluaXRpb24sIGN0eCwgJCRzY29wZSwgZGlydHksIGdldF9zbG90X2NoYW5nZXNfZm4sIGdldF9zbG90X2NvbnRleHRfZm4pIHtcbiAgICBjb25zdCBzbG90X2NoYW5nZXMgPSBnZXRfc2xvdF9jaGFuZ2VzKHNsb3RfZGVmaW5pdGlvbiwgJCRzY29wZSwgZGlydHksIGdldF9zbG90X2NoYW5nZXNfZm4pO1xuICAgIGlmIChzbG90X2NoYW5nZXMpIHtcbiAgICAgICAgY29uc3Qgc2xvdF9jb250ZXh0ID0gZ2V0X3Nsb3RfY29udGV4dChzbG90X2RlZmluaXRpb24sIGN0eCwgJCRzY29wZSwgZ2V0X3Nsb3RfY29udGV4dF9mbik7XG4gICAgICAgIHNsb3QucChzbG90X2NvbnRleHQsIHNsb3RfY2hhbmdlcyk7XG4gICAgfVxufVxuZnVuY3Rpb24gZXhjbHVkZV9pbnRlcm5hbF9wcm9wcyhwcm9wcykge1xuICAgIGNvbnN0IHJlc3VsdCA9IHt9O1xuICAgIGZvciAoY29uc3QgayBpbiBwcm9wcylcbiAgICAgICAgaWYgKGtbMF0gIT09ICckJylcbiAgICAgICAgICAgIHJlc3VsdFtrXSA9IHByb3BzW2tdO1xuICAgIHJldHVybiByZXN1bHQ7XG59XG5mdW5jdGlvbiBjb21wdXRlX3Jlc3RfcHJvcHMocHJvcHMsIGtleXMpIHtcbiAgICBjb25zdCByZXN0ID0ge307XG4gICAga2V5cyA9IG5ldyBTZXQoa2V5cyk7XG4gICAgZm9yIChjb25zdCBrIGluIHByb3BzKVxuICAgICAgICBpZiAoIWtleXMuaGFzKGspICYmIGtbMF0gIT09ICckJylcbiAgICAgICAgICAgIHJlc3Rba10gPSBwcm9wc1trXTtcbiAgICByZXR1cm4gcmVzdDtcbn1cbmZ1bmN0aW9uIG9uY2UoZm4pIHtcbiAgICBsZXQgcmFuID0gZmFsc2U7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICguLi5hcmdzKSB7XG4gICAgICAgIGlmIChyYW4pXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIHJhbiA9IHRydWU7XG4gICAgICAgIGZuLmNhbGwodGhpcywgLi4uYXJncyk7XG4gICAgfTtcbn1cbmZ1bmN0aW9uIG51bGxfdG9fZW1wdHkodmFsdWUpIHtcbiAgICByZXR1cm4gdmFsdWUgPT0gbnVsbCA/ICcnIDogdmFsdWU7XG59XG5mdW5jdGlvbiBzZXRfc3RvcmVfdmFsdWUoc3RvcmUsIHJldCwgdmFsdWUgPSByZXQpIHtcbiAgICBzdG9yZS5zZXQodmFsdWUpO1xuICAgIHJldHVybiByZXQ7XG59XG5jb25zdCBoYXNfcHJvcCA9IChvYmosIHByb3ApID0+IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmosIHByb3ApO1xuZnVuY3Rpb24gYWN0aW9uX2Rlc3Ryb3llcihhY3Rpb25fcmVzdWx0KSB7XG4gICAgcmV0dXJuIGFjdGlvbl9yZXN1bHQgJiYgaXNfZnVuY3Rpb24oYWN0aW9uX3Jlc3VsdC5kZXN0cm95KSA/IGFjdGlvbl9yZXN1bHQuZGVzdHJveSA6IG5vb3A7XG59XG5cbmNvbnN0IGlzX2NsaWVudCA9IHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnO1xubGV0IG5vdyA9IGlzX2NsaWVudFxuICAgID8gKCkgPT4gd2luZG93LnBlcmZvcm1hbmNlLm5vdygpXG4gICAgOiAoKSA9PiBEYXRlLm5vdygpO1xubGV0IHJhZiA9IGlzX2NsaWVudCA/IGNiID0+IHJlcXVlc3RBbmltYXRpb25GcmFtZShjYikgOiBub29wO1xuLy8gdXNlZCBpbnRlcm5hbGx5IGZvciB0ZXN0aW5nXG5mdW5jdGlvbiBzZXRfbm93KGZuKSB7XG4gICAgbm93ID0gZm47XG59XG5mdW5jdGlvbiBzZXRfcmFmKGZuKSB7XG4gICAgcmFmID0gZm47XG59XG5cbmNvbnN0IHRhc2tzID0gbmV3IFNldCgpO1xuZnVuY3Rpb24gcnVuX3Rhc2tzKG5vdykge1xuICAgIHRhc2tzLmZvckVhY2godGFzayA9PiB7XG4gICAgICAgIGlmICghdGFzay5jKG5vdykpIHtcbiAgICAgICAgICAgIHRhc2tzLmRlbGV0ZSh0YXNrKTtcbiAgICAgICAgICAgIHRhc2suZigpO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgaWYgKHRhc2tzLnNpemUgIT09IDApXG4gICAgICAgIHJhZihydW5fdGFza3MpO1xufVxuLyoqXG4gKiBGb3IgdGVzdGluZyBwdXJwb3NlcyBvbmx5IVxuICovXG5mdW5jdGlvbiBjbGVhcl9sb29wcygpIHtcbiAgICB0YXNrcy5jbGVhcigpO1xufVxuLyoqXG4gKiBDcmVhdGVzIGEgbmV3IHRhc2sgdGhhdCBydW5zIG9uIGVhY2ggcmFmIGZyYW1lXG4gKiB1bnRpbCBpdCByZXR1cm5zIGEgZmFsc3kgdmFsdWUgb3IgaXMgYWJvcnRlZFxuICovXG5mdW5jdGlvbiBsb29wKGNhbGxiYWNrKSB7XG4gICAgbGV0IHRhc2s7XG4gICAgaWYgKHRhc2tzLnNpemUgPT09IDApXG4gICAgICAgIHJhZihydW5fdGFza3MpO1xuICAgIHJldHVybiB7XG4gICAgICAgIHByb21pc2U6IG5ldyBQcm9taXNlKGZ1bGZpbGwgPT4ge1xuICAgICAgICAgICAgdGFza3MuYWRkKHRhc2sgPSB7IGM6IGNhbGxiYWNrLCBmOiBmdWxmaWxsIH0pO1xuICAgICAgICB9KSxcbiAgICAgICAgYWJvcnQoKSB7XG4gICAgICAgICAgICB0YXNrcy5kZWxldGUodGFzayk7XG4gICAgICAgIH1cbiAgICB9O1xufVxuXG5mdW5jdGlvbiBhcHBlbmQodGFyZ2V0LCBub2RlKSB7XG4gICAgdGFyZ2V0LmFwcGVuZENoaWxkKG5vZGUpO1xufVxuZnVuY3Rpb24gaW5zZXJ0KHRhcmdldCwgbm9kZSwgYW5jaG9yKSB7XG4gICAgdGFyZ2V0Lmluc2VydEJlZm9yZShub2RlLCBhbmNob3IgfHwgbnVsbCk7XG59XG5mdW5jdGlvbiBkZXRhY2gobm9kZSkge1xuICAgIG5vZGUucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChub2RlKTtcbn1cbmZ1bmN0aW9uIGRlc3Ryb3lfZWFjaChpdGVyYXRpb25zLCBkZXRhY2hpbmcpIHtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGl0ZXJhdGlvbnMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgaWYgKGl0ZXJhdGlvbnNbaV0pXG4gICAgICAgICAgICBpdGVyYXRpb25zW2ldLmQoZGV0YWNoaW5nKTtcbiAgICB9XG59XG5mdW5jdGlvbiBlbGVtZW50KG5hbWUpIHtcbiAgICByZXR1cm4gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChuYW1lKTtcbn1cbmZ1bmN0aW9uIGVsZW1lbnRfaXMobmFtZSwgaXMpIHtcbiAgICByZXR1cm4gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChuYW1lLCB7IGlzIH0pO1xufVxuZnVuY3Rpb24gb2JqZWN0X3dpdGhvdXRfcHJvcGVydGllcyhvYmosIGV4Y2x1ZGUpIHtcbiAgICBjb25zdCB0YXJnZXQgPSB7fTtcbiAgICBmb3IgKGNvbnN0IGsgaW4gb2JqKSB7XG4gICAgICAgIGlmIChoYXNfcHJvcChvYmosIGspXG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICAmJiBleGNsdWRlLmluZGV4T2YoaykgPT09IC0xKSB7XG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICB0YXJnZXRba10gPSBvYmpba107XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRhcmdldDtcbn1cbmZ1bmN0aW9uIHN2Z19lbGVtZW50KG5hbWUpIHtcbiAgICByZXR1cm4gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKCdodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZycsIG5hbWUpO1xufVxuZnVuY3Rpb24gdGV4dChkYXRhKSB7XG4gICAgcmV0dXJuIGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKGRhdGEpO1xufVxuZnVuY3Rpb24gc3BhY2UoKSB7XG4gICAgcmV0dXJuIHRleHQoJyAnKTtcbn1cbmZ1bmN0aW9uIGVtcHR5KCkge1xuICAgIHJldHVybiB0ZXh0KCcnKTtcbn1cbmZ1bmN0aW9uIGxpc3Rlbihub2RlLCBldmVudCwgaGFuZGxlciwgb3B0aW9ucykge1xuICAgIG5vZGUuYWRkRXZlbnRMaXN0ZW5lcihldmVudCwgaGFuZGxlciwgb3B0aW9ucyk7XG4gICAgcmV0dXJuICgpID0+IG5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcihldmVudCwgaGFuZGxlciwgb3B0aW9ucyk7XG59XG5mdW5jdGlvbiBwcmV2ZW50X2RlZmF1bHQoZm4pIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgcmV0dXJuIGZuLmNhbGwodGhpcywgZXZlbnQpO1xuICAgIH07XG59XG5mdW5jdGlvbiBzdG9wX3Byb3BhZ2F0aW9uKGZuKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICByZXR1cm4gZm4uY2FsbCh0aGlzLCBldmVudCk7XG4gICAgfTtcbn1cbmZ1bmN0aW9uIHNlbGYoZm4pIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgaWYgKGV2ZW50LnRhcmdldCA9PT0gdGhpcylcbiAgICAgICAgICAgIGZuLmNhbGwodGhpcywgZXZlbnQpO1xuICAgIH07XG59XG5mdW5jdGlvbiBhdHRyKG5vZGUsIGF0dHJpYnV0ZSwgdmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbClcbiAgICAgICAgbm9kZS5yZW1vdmVBdHRyaWJ1dGUoYXR0cmlidXRlKTtcbiAgICBlbHNlIGlmIChub2RlLmdldEF0dHJpYnV0ZShhdHRyaWJ1dGUpICE9PSB2YWx1ZSlcbiAgICAgICAgbm9kZS5zZXRBdHRyaWJ1dGUoYXR0cmlidXRlLCB2YWx1ZSk7XG59XG5mdW5jdGlvbiBzZXRfYXR0cmlidXRlcyhub2RlLCBhdHRyaWJ1dGVzKSB7XG4gICAgLy8gQHRzLWlnbm9yZVxuICAgIGNvbnN0IGRlc2NyaXB0b3JzID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcnMobm9kZS5fX3Byb3RvX18pO1xuICAgIGZvciAoY29uc3Qga2V5IGluIGF0dHJpYnV0ZXMpIHtcbiAgICAgICAgaWYgKGF0dHJpYnV0ZXNba2V5XSA9PSBudWxsKSB7XG4gICAgICAgICAgICBub2RlLnJlbW92ZUF0dHJpYnV0ZShrZXkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGtleSA9PT0gJ3N0eWxlJykge1xuICAgICAgICAgICAgbm9kZS5zdHlsZS5jc3NUZXh0ID0gYXR0cmlidXRlc1trZXldO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGtleSA9PT0gJ19fdmFsdWUnKSB7XG4gICAgICAgICAgICBub2RlLnZhbHVlID0gbm9kZVtrZXldID0gYXR0cmlidXRlc1trZXldO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGRlc2NyaXB0b3JzW2tleV0gJiYgZGVzY3JpcHRvcnNba2V5XS5zZXQpIHtcbiAgICAgICAgICAgIG5vZGVba2V5XSA9IGF0dHJpYnV0ZXNba2V5XTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGF0dHIobm9kZSwga2V5LCBhdHRyaWJ1dGVzW2tleV0pO1xuICAgICAgICB9XG4gICAgfVxufVxuZnVuY3Rpb24gc2V0X3N2Z19hdHRyaWJ1dGVzKG5vZGUsIGF0dHJpYnV0ZXMpIHtcbiAgICBmb3IgKGNvbnN0IGtleSBpbiBhdHRyaWJ1dGVzKSB7XG4gICAgICAgIGF0dHIobm9kZSwga2V5LCBhdHRyaWJ1dGVzW2tleV0pO1xuICAgIH1cbn1cbmZ1bmN0aW9uIHNldF9jdXN0b21fZWxlbWVudF9kYXRhKG5vZGUsIHByb3AsIHZhbHVlKSB7XG4gICAgaWYgKHByb3AgaW4gbm9kZSkge1xuICAgICAgICBub2RlW3Byb3BdID0gdmFsdWU7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICBhdHRyKG5vZGUsIHByb3AsIHZhbHVlKTtcbiAgICB9XG59XG5mdW5jdGlvbiB4bGlua19hdHRyKG5vZGUsIGF0dHJpYnV0ZSwgdmFsdWUpIHtcbiAgICBub2RlLnNldEF0dHJpYnV0ZU5TKCdodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rJywgYXR0cmlidXRlLCB2YWx1ZSk7XG59XG5mdW5jdGlvbiBnZXRfYmluZGluZ19ncm91cF92YWx1ZShncm91cCkge1xuICAgIGNvbnN0IHZhbHVlID0gW107XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBncm91cC5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBpZiAoZ3JvdXBbaV0uY2hlY2tlZClcbiAgICAgICAgICAgIHZhbHVlLnB1c2goZ3JvdXBbaV0uX192YWx1ZSk7XG4gICAgfVxuICAgIHJldHVybiB2YWx1ZTtcbn1cbmZ1bmN0aW9uIHRvX251bWJlcih2YWx1ZSkge1xuICAgIHJldHVybiB2YWx1ZSA9PT0gJycgPyB1bmRlZmluZWQgOiArdmFsdWU7XG59XG5mdW5jdGlvbiB0aW1lX3Jhbmdlc190b19hcnJheShyYW5nZXMpIHtcbiAgICBjb25zdCBhcnJheSA9IFtdO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmFuZ2VzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgIGFycmF5LnB1c2goeyBzdGFydDogcmFuZ2VzLnN0YXJ0KGkpLCBlbmQ6IHJhbmdlcy5lbmQoaSkgfSk7XG4gICAgfVxuICAgIHJldHVybiBhcnJheTtcbn1cbmZ1bmN0aW9uIGNoaWxkcmVuKGVsZW1lbnQpIHtcbiAgICByZXR1cm4gQXJyYXkuZnJvbShlbGVtZW50LmNoaWxkTm9kZXMpO1xufVxuZnVuY3Rpb24gY2xhaW1fZWxlbWVudChub2RlcywgbmFtZSwgYXR0cmlidXRlcywgc3ZnKSB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBub2Rlcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBub2RlID0gbm9kZXNbaV07XG4gICAgICAgIGlmIChub2RlLm5vZGVOYW1lID09PSBuYW1lKSB7XG4gICAgICAgICAgICBsZXQgaiA9IDA7XG4gICAgICAgICAgICB3aGlsZSAoaiA8IG5vZGUuYXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBhdHRyaWJ1dGUgPSBub2RlLmF0dHJpYnV0ZXNbal07XG4gICAgICAgICAgICAgICAgaWYgKGF0dHJpYnV0ZXNbYXR0cmlidXRlLm5hbWVdKSB7XG4gICAgICAgICAgICAgICAgICAgIGorKztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUucmVtb3ZlQXR0cmlidXRlKGF0dHJpYnV0ZS5uYW1lKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gbm9kZXMuc3BsaWNlKGksIDEpWzBdO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBzdmcgPyBzdmdfZWxlbWVudChuYW1lKSA6IGVsZW1lbnQobmFtZSk7XG59XG5mdW5jdGlvbiBjbGFpbV90ZXh0KG5vZGVzLCBkYXRhKSB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBub2Rlcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBub2RlID0gbm9kZXNbaV07XG4gICAgICAgIGlmIChub2RlLm5vZGVUeXBlID09PSAzKSB7XG4gICAgICAgICAgICBub2RlLmRhdGEgPSAnJyArIGRhdGE7XG4gICAgICAgICAgICByZXR1cm4gbm9kZXMuc3BsaWNlKGksIDEpWzBdO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0ZXh0KGRhdGEpO1xufVxuZnVuY3Rpb24gY2xhaW1fc3BhY2Uobm9kZXMpIHtcbiAgICByZXR1cm4gY2xhaW1fdGV4dChub2RlcywgJyAnKTtcbn1cbmZ1bmN0aW9uIHNldF9kYXRhKHRleHQsIGRhdGEpIHtcbiAgICBkYXRhID0gJycgKyBkYXRhO1xuICAgIGlmICh0ZXh0LmRhdGEgIT09IGRhdGEpXG4gICAgICAgIHRleHQuZGF0YSA9IGRhdGE7XG59XG5mdW5jdGlvbiBzZXRfaW5wdXRfdmFsdWUoaW5wdXQsIHZhbHVlKSB7XG4gICAgaW5wdXQudmFsdWUgPSB2YWx1ZSA9PSBudWxsID8gJycgOiB2YWx1ZTtcbn1cbmZ1bmN0aW9uIHNldF9pbnB1dF90eXBlKGlucHV0LCB0eXBlKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgaW5wdXQudHlwZSA9IHR5cGU7XG4gICAgfVxuICAgIGNhdGNoIChlKSB7XG4gICAgICAgIC8vIGRvIG5vdGhpbmdcbiAgICB9XG59XG5mdW5jdGlvbiBzZXRfc3R5bGUobm9kZSwga2V5LCB2YWx1ZSwgaW1wb3J0YW50KSB7XG4gICAgbm9kZS5zdHlsZS5zZXRQcm9wZXJ0eShrZXksIHZhbHVlLCBpbXBvcnRhbnQgPyAnaW1wb3J0YW50JyA6ICcnKTtcbn1cbmZ1bmN0aW9uIHNlbGVjdF9vcHRpb24oc2VsZWN0LCB2YWx1ZSkge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgc2VsZWN0Lm9wdGlvbnMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9uID0gc2VsZWN0Lm9wdGlvbnNbaV07XG4gICAgICAgIGlmIChvcHRpb24uX192YWx1ZSA9PT0gdmFsdWUpIHtcbiAgICAgICAgICAgIG9wdGlvbi5zZWxlY3RlZCA9IHRydWU7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICB9XG59XG5mdW5jdGlvbiBzZWxlY3Rfb3B0aW9ucyhzZWxlY3QsIHZhbHVlKSB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWxlY3Qub3B0aW9ucy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBvcHRpb24gPSBzZWxlY3Qub3B0aW9uc1tpXTtcbiAgICAgICAgb3B0aW9uLnNlbGVjdGVkID0gfnZhbHVlLmluZGV4T2Yob3B0aW9uLl9fdmFsdWUpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIHNlbGVjdF92YWx1ZShzZWxlY3QpIHtcbiAgICBjb25zdCBzZWxlY3RlZF9vcHRpb24gPSBzZWxlY3QucXVlcnlTZWxlY3RvcignOmNoZWNrZWQnKSB8fCBzZWxlY3Qub3B0aW9uc1swXTtcbiAgICByZXR1cm4gc2VsZWN0ZWRfb3B0aW9uICYmIHNlbGVjdGVkX29wdGlvbi5fX3ZhbHVlO1xufVxuZnVuY3Rpb24gc2VsZWN0X211bHRpcGxlX3ZhbHVlKHNlbGVjdCkge1xuICAgIHJldHVybiBbXS5tYXAuY2FsbChzZWxlY3QucXVlcnlTZWxlY3RvckFsbCgnOmNoZWNrZWQnKSwgb3B0aW9uID0+IG9wdGlvbi5fX3ZhbHVlKTtcbn1cbi8vIHVuZm9ydHVuYXRlbHkgdGhpcyBjYW4ndCBiZSBhIGNvbnN0YW50IGFzIHRoYXQgd291bGRuJ3QgYmUgdHJlZS1zaGFrZWFibGVcbi8vIHNvIHdlIGNhY2hlIHRoZSByZXN1bHQgaW5zdGVhZFxubGV0IGNyb3Nzb3JpZ2luO1xuZnVuY3Rpb24gaXNfY3Jvc3NvcmlnaW4oKSB7XG4gICAgaWYgKGNyb3Nzb3JpZ2luID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY3Jvc3NvcmlnaW4gPSBmYWxzZTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB3aW5kb3cucGFyZW50KSB7XG4gICAgICAgICAgICAgICAgdm9pZCB3aW5kb3cucGFyZW50LmRvY3VtZW50O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY3Jvc3NvcmlnaW4gPSB0cnVlO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBjcm9zc29yaWdpbjtcbn1cbmZ1bmN0aW9uIGFkZF9yZXNpemVfbGlzdGVuZXIobm9kZSwgZm4pIHtcbiAgICBjb25zdCBjb21wdXRlZF9zdHlsZSA9IGdldENvbXB1dGVkU3R5bGUobm9kZSk7XG4gICAgY29uc3Qgel9pbmRleCA9IChwYXJzZUludChjb21wdXRlZF9zdHlsZS56SW5kZXgpIHx8IDApIC0gMTtcbiAgICBpZiAoY29tcHV0ZWRfc3R5bGUucG9zaXRpb24gPT09ICdzdGF0aWMnKSB7XG4gICAgICAgIG5vZGUuc3R5bGUucG9zaXRpb24gPSAncmVsYXRpdmUnO1xuICAgIH1cbiAgICBjb25zdCBpZnJhbWUgPSBlbGVtZW50KCdpZnJhbWUnKTtcbiAgICBpZnJhbWUuc2V0QXR0cmlidXRlKCdzdHlsZScsIGBkaXNwbGF5OiBibG9jazsgcG9zaXRpb246IGFic29sdXRlOyB0b3A6IDA7IGxlZnQ6IDA7IHdpZHRoOiAxMDAlOyBoZWlnaHQ6IDEwMCU7IGAgK1xuICAgICAgICBgb3ZlcmZsb3c6IGhpZGRlbjsgYm9yZGVyOiAwOyBvcGFjaXR5OiAwOyBwb2ludGVyLWV2ZW50czogbm9uZTsgei1pbmRleDogJHt6X2luZGV4fTtgKTtcbiAgICBpZnJhbWUuc2V0QXR0cmlidXRlKCdhcmlhLWhpZGRlbicsICd0cnVlJyk7XG4gICAgaWZyYW1lLnRhYkluZGV4ID0gLTE7XG4gICAgY29uc3QgY3Jvc3NvcmlnaW4gPSBpc19jcm9zc29yaWdpbigpO1xuICAgIGxldCB1bnN1YnNjcmliZTtcbiAgICBpZiAoY3Jvc3NvcmlnaW4pIHtcbiAgICAgICAgaWZyYW1lLnNyYyA9IGBkYXRhOnRleHQvaHRtbCw8c2NyaXB0Pm9ucmVzaXplPWZ1bmN0aW9uKCl7cGFyZW50LnBvc3RNZXNzYWdlKDAsJyonKX08L3NjcmlwdD5gO1xuICAgICAgICB1bnN1YnNjcmliZSA9IGxpc3Rlbih3aW5kb3csICdtZXNzYWdlJywgKGV2ZW50KSA9PiB7XG4gICAgICAgICAgICBpZiAoZXZlbnQuc291cmNlID09PSBpZnJhbWUuY29udGVudFdpbmRvdylcbiAgICAgICAgICAgICAgICBmbigpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIGlmcmFtZS5zcmMgPSAnYWJvdXQ6YmxhbmsnO1xuICAgICAgICBpZnJhbWUub25sb2FkID0gKCkgPT4ge1xuICAgICAgICAgICAgdW5zdWJzY3JpYmUgPSBsaXN0ZW4oaWZyYW1lLmNvbnRlbnRXaW5kb3csICdyZXNpemUnLCBmbik7XG4gICAgICAgIH07XG4gICAgfVxuICAgIGFwcGVuZChub2RlLCBpZnJhbWUpO1xuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgIGlmIChjcm9zc29yaWdpbikge1xuICAgICAgICAgICAgdW5zdWJzY3JpYmUoKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmICh1bnN1YnNjcmliZSAmJiBpZnJhbWUuY29udGVudFdpbmRvdykge1xuICAgICAgICAgICAgdW5zdWJzY3JpYmUoKTtcbiAgICAgICAgfVxuICAgICAgICBkZXRhY2goaWZyYW1lKTtcbiAgICB9O1xufVxuZnVuY3Rpb24gdG9nZ2xlX2NsYXNzKGVsZW1lbnQsIG5hbWUsIHRvZ2dsZSkge1xuICAgIGVsZW1lbnQuY2xhc3NMaXN0W3RvZ2dsZSA/ICdhZGQnIDogJ3JlbW92ZSddKG5hbWUpO1xufVxuZnVuY3Rpb24gY3VzdG9tX2V2ZW50KHR5cGUsIGRldGFpbCkge1xuICAgIGNvbnN0IGUgPSBkb2N1bWVudC5jcmVhdGVFdmVudCgnQ3VzdG9tRXZlbnQnKTtcbiAgICBlLmluaXRDdXN0b21FdmVudCh0eXBlLCBmYWxzZSwgZmFsc2UsIGRldGFpbCk7XG4gICAgcmV0dXJuIGU7XG59XG5mdW5jdGlvbiBxdWVyeV9zZWxlY3Rvcl9hbGwoc2VsZWN0b3IsIHBhcmVudCA9IGRvY3VtZW50LmJvZHkpIHtcbiAgICByZXR1cm4gQXJyYXkuZnJvbShwYXJlbnQucXVlcnlTZWxlY3RvckFsbChzZWxlY3RvcikpO1xufVxuY2xhc3MgSHRtbFRhZyB7XG4gICAgY29uc3RydWN0b3IoYW5jaG9yID0gbnVsbCkge1xuICAgICAgICB0aGlzLmEgPSBhbmNob3I7XG4gICAgICAgIHRoaXMuZSA9IHRoaXMubiA9IG51bGw7XG4gICAgfVxuICAgIG0oaHRtbCwgdGFyZ2V0LCBhbmNob3IgPSBudWxsKSB7XG4gICAgICAgIGlmICghdGhpcy5lKSB7XG4gICAgICAgICAgICB0aGlzLmUgPSBlbGVtZW50KHRhcmdldC5ub2RlTmFtZSk7XG4gICAgICAgICAgICB0aGlzLnQgPSB0YXJnZXQ7XG4gICAgICAgICAgICB0aGlzLmgoaHRtbCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5pKGFuY2hvcik7XG4gICAgfVxuICAgIGgoaHRtbCkge1xuICAgICAgICB0aGlzLmUuaW5uZXJIVE1MID0gaHRtbDtcbiAgICAgICAgdGhpcy5uID0gQXJyYXkuZnJvbSh0aGlzLmUuY2hpbGROb2Rlcyk7XG4gICAgfVxuICAgIGkoYW5jaG9yKSB7XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5uLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgICAgICBpbnNlcnQodGhpcy50LCB0aGlzLm5baV0sIGFuY2hvcik7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcChodG1sKSB7XG4gICAgICAgIHRoaXMuZCgpO1xuICAgICAgICB0aGlzLmgoaHRtbCk7XG4gICAgICAgIHRoaXMuaSh0aGlzLmEpO1xuICAgIH1cbiAgICBkKCkge1xuICAgICAgICB0aGlzLm4uZm9yRWFjaChkZXRhY2gpO1xuICAgIH1cbn1cblxuY29uc3QgYWN0aXZlX2RvY3MgPSBuZXcgU2V0KCk7XG5sZXQgYWN0aXZlID0gMDtcbi8vIGh0dHBzOi8vZ2l0aHViLmNvbS9kYXJrc2t5YXBwL3N0cmluZy1oYXNoL2Jsb2IvbWFzdGVyL2luZGV4LmpzXG5mdW5jdGlvbiBoYXNoKHN0cikge1xuICAgIGxldCBoYXNoID0gNTM4MTtcbiAgICBsZXQgaSA9IHN0ci5sZW5ndGg7XG4gICAgd2hpbGUgKGktLSlcbiAgICAgICAgaGFzaCA9ICgoaGFzaCA8PCA1KSAtIGhhc2gpIF4gc3RyLmNoYXJDb2RlQXQoaSk7XG4gICAgcmV0dXJuIGhhc2ggPj4+IDA7XG59XG5mdW5jdGlvbiBjcmVhdGVfcnVsZShub2RlLCBhLCBiLCBkdXJhdGlvbiwgZGVsYXksIGVhc2UsIGZuLCB1aWQgPSAwKSB7XG4gICAgY29uc3Qgc3RlcCA9IDE2LjY2NiAvIGR1cmF0aW9uO1xuICAgIGxldCBrZXlmcmFtZXMgPSAne1xcbic7XG4gICAgZm9yIChsZXQgcCA9IDA7IHAgPD0gMTsgcCArPSBzdGVwKSB7XG4gICAgICAgIGNvbnN0IHQgPSBhICsgKGIgLSBhKSAqIGVhc2UocCk7XG4gICAgICAgIGtleWZyYW1lcyArPSBwICogMTAwICsgYCV7JHtmbih0LCAxIC0gdCl9fVxcbmA7XG4gICAgfVxuICAgIGNvbnN0IHJ1bGUgPSBrZXlmcmFtZXMgKyBgMTAwJSB7JHtmbihiLCAxIC0gYil9fVxcbn1gO1xuICAgIGNvbnN0IG5hbWUgPSBgX19zdmVsdGVfJHtoYXNoKHJ1bGUpfV8ke3VpZH1gO1xuICAgIGNvbnN0IGRvYyA9IG5vZGUub3duZXJEb2N1bWVudDtcbiAgICBhY3RpdmVfZG9jcy5hZGQoZG9jKTtcbiAgICBjb25zdCBzdHlsZXNoZWV0ID0gZG9jLl9fc3ZlbHRlX3N0eWxlc2hlZXQgfHwgKGRvYy5fX3N2ZWx0ZV9zdHlsZXNoZWV0ID0gZG9jLmhlYWQuYXBwZW5kQ2hpbGQoZWxlbWVudCgnc3R5bGUnKSkuc2hlZXQpO1xuICAgIGNvbnN0IGN1cnJlbnRfcnVsZXMgPSBkb2MuX19zdmVsdGVfcnVsZXMgfHwgKGRvYy5fX3N2ZWx0ZV9ydWxlcyA9IHt9KTtcbiAgICBpZiAoIWN1cnJlbnRfcnVsZXNbbmFtZV0pIHtcbiAgICAgICAgY3VycmVudF9ydWxlc1tuYW1lXSA9IHRydWU7XG4gICAgICAgIHN0eWxlc2hlZXQuaW5zZXJ0UnVsZShgQGtleWZyYW1lcyAke25hbWV9ICR7cnVsZX1gLCBzdHlsZXNoZWV0LmNzc1J1bGVzLmxlbmd0aCk7XG4gICAgfVxuICAgIGNvbnN0IGFuaW1hdGlvbiA9IG5vZGUuc3R5bGUuYW5pbWF0aW9uIHx8ICcnO1xuICAgIG5vZGUuc3R5bGUuYW5pbWF0aW9uID0gYCR7YW5pbWF0aW9uID8gYCR7YW5pbWF0aW9ufSwgYCA6IGBgfSR7bmFtZX0gJHtkdXJhdGlvbn1tcyBsaW5lYXIgJHtkZWxheX1tcyAxIGJvdGhgO1xuICAgIGFjdGl2ZSArPSAxO1xuICAgIHJldHVybiBuYW1lO1xufVxuZnVuY3Rpb24gZGVsZXRlX3J1bGUobm9kZSwgbmFtZSkge1xuICAgIGNvbnN0IHByZXZpb3VzID0gKG5vZGUuc3R5bGUuYW5pbWF0aW9uIHx8ICcnKS5zcGxpdCgnLCAnKTtcbiAgICBjb25zdCBuZXh0ID0gcHJldmlvdXMuZmlsdGVyKG5hbWVcbiAgICAgICAgPyBhbmltID0+IGFuaW0uaW5kZXhPZihuYW1lKSA8IDAgLy8gcmVtb3ZlIHNwZWNpZmljIGFuaW1hdGlvblxuICAgICAgICA6IGFuaW0gPT4gYW5pbS5pbmRleE9mKCdfX3N2ZWx0ZScpID09PSAtMSAvLyByZW1vdmUgYWxsIFN2ZWx0ZSBhbmltYXRpb25zXG4gICAgKTtcbiAgICBjb25zdCBkZWxldGVkID0gcHJldmlvdXMubGVuZ3RoIC0gbmV4dC5sZW5ndGg7XG4gICAgaWYgKGRlbGV0ZWQpIHtcbiAgICAgICAgbm9kZS5zdHlsZS5hbmltYXRpb24gPSBuZXh0LmpvaW4oJywgJyk7XG4gICAgICAgIGFjdGl2ZSAtPSBkZWxldGVkO1xuICAgICAgICBpZiAoIWFjdGl2ZSlcbiAgICAgICAgICAgIGNsZWFyX3J1bGVzKCk7XG4gICAgfVxufVxuZnVuY3Rpb24gY2xlYXJfcnVsZXMoKSB7XG4gICAgcmFmKCgpID0+IHtcbiAgICAgICAgaWYgKGFjdGl2ZSlcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgYWN0aXZlX2RvY3MuZm9yRWFjaChkb2MgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc3R5bGVzaGVldCA9IGRvYy5fX3N2ZWx0ZV9zdHlsZXNoZWV0O1xuICAgICAgICAgICAgbGV0IGkgPSBzdHlsZXNoZWV0LmNzc1J1bGVzLmxlbmd0aDtcbiAgICAgICAgICAgIHdoaWxlIChpLS0pXG4gICAgICAgICAgICAgICAgc3R5bGVzaGVldC5kZWxldGVSdWxlKGkpO1xuICAgICAgICAgICAgZG9jLl9fc3ZlbHRlX3J1bGVzID0ge307XG4gICAgICAgIH0pO1xuICAgICAgICBhY3RpdmVfZG9jcy5jbGVhcigpO1xuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVfYW5pbWF0aW9uKG5vZGUsIGZyb20sIGZuLCBwYXJhbXMpIHtcbiAgICBpZiAoIWZyb20pXG4gICAgICAgIHJldHVybiBub29wO1xuICAgIGNvbnN0IHRvID0gbm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBpZiAoZnJvbS5sZWZ0ID09PSB0by5sZWZ0ICYmIGZyb20ucmlnaHQgPT09IHRvLnJpZ2h0ICYmIGZyb20udG9wID09PSB0by50b3AgJiYgZnJvbS5ib3R0b20gPT09IHRvLmJvdHRvbSlcbiAgICAgICAgcmV0dXJuIG5vb3A7XG4gICAgY29uc3QgeyBkZWxheSA9IDAsIGR1cmF0aW9uID0gMzAwLCBlYXNpbmcgPSBpZGVudGl0eSwgXG4gICAgLy8gQHRzLWlnbm9yZSB0b2RvOiBzaG91bGQgdGhpcyBiZSBzZXBhcmF0ZWQgZnJvbSBkZXN0cnVjdHVyaW5nPyBPciBzdGFydC9lbmQgYWRkZWQgdG8gcHVibGljIGFwaSBhbmQgZG9jdW1lbnRhdGlvbj9cbiAgICBzdGFydDogc3RhcnRfdGltZSA9IG5vdygpICsgZGVsYXksIFxuICAgIC8vIEB0cy1pZ25vcmUgdG9kbzpcbiAgICBlbmQgPSBzdGFydF90aW1lICsgZHVyYXRpb24sIHRpY2sgPSBub29wLCBjc3MgfSA9IGZuKG5vZGUsIHsgZnJvbSwgdG8gfSwgcGFyYW1zKTtcbiAgICBsZXQgcnVubmluZyA9IHRydWU7XG4gICAgbGV0IHN0YXJ0ZWQgPSBmYWxzZTtcbiAgICBsZXQgbmFtZTtcbiAgICBmdW5jdGlvbiBzdGFydCgpIHtcbiAgICAgICAgaWYgKGNzcykge1xuICAgICAgICAgICAgbmFtZSA9IGNyZWF0ZV9ydWxlKG5vZGUsIDAsIDEsIGR1cmF0aW9uLCBkZWxheSwgZWFzaW5nLCBjc3MpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghZGVsYXkpIHtcbiAgICAgICAgICAgIHN0YXJ0ZWQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgfVxuICAgIGZ1bmN0aW9uIHN0b3AoKSB7XG4gICAgICAgIGlmIChjc3MpXG4gICAgICAgICAgICBkZWxldGVfcnVsZShub2RlLCBuYW1lKTtcbiAgICAgICAgcnVubmluZyA9IGZhbHNlO1xuICAgIH1cbiAgICBsb29wKG5vdyA9PiB7XG4gICAgICAgIGlmICghc3RhcnRlZCAmJiBub3cgPj0gc3RhcnRfdGltZSkge1xuICAgICAgICAgICAgc3RhcnRlZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHN0YXJ0ZWQgJiYgbm93ID49IGVuZCkge1xuICAgICAgICAgICAgdGljaygxLCAwKTtcbiAgICAgICAgICAgIHN0b3AoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXJ1bm5pbmcpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc3RhcnRlZCkge1xuICAgICAgICAgICAgY29uc3QgcCA9IG5vdyAtIHN0YXJ0X3RpbWU7XG4gICAgICAgICAgICBjb25zdCB0ID0gMCArIDEgKiBlYXNpbmcocCAvIGR1cmF0aW9uKTtcbiAgICAgICAgICAgIHRpY2sodCwgMSAtIHQpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH0pO1xuICAgIHN0YXJ0KCk7XG4gICAgdGljaygwLCAxKTtcbiAgICByZXR1cm4gc3RvcDtcbn1cbmZ1bmN0aW9uIGZpeF9wb3NpdGlvbihub2RlKSB7XG4gICAgY29uc3Qgc3R5bGUgPSBnZXRDb21wdXRlZFN0eWxlKG5vZGUpO1xuICAgIGlmIChzdHlsZS5wb3NpdGlvbiAhPT0gJ2Fic29sdXRlJyAmJiBzdHlsZS5wb3NpdGlvbiAhPT0gJ2ZpeGVkJykge1xuICAgICAgICBjb25zdCB7IHdpZHRoLCBoZWlnaHQgfSA9IHN0eWxlO1xuICAgICAgICBjb25zdCBhID0gbm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgbm9kZS5zdHlsZS5wb3NpdGlvbiA9ICdhYnNvbHV0ZSc7XG4gICAgICAgIG5vZGUuc3R5bGUud2lkdGggPSB3aWR0aDtcbiAgICAgICAgbm9kZS5zdHlsZS5oZWlnaHQgPSBoZWlnaHQ7XG4gICAgICAgIGFkZF90cmFuc2Zvcm0obm9kZSwgYSk7XG4gICAgfVxufVxuZnVuY3Rpb24gYWRkX3RyYW5zZm9ybShub2RlLCBhKSB7XG4gICAgY29uc3QgYiA9IG5vZGUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgaWYgKGEubGVmdCAhPT0gYi5sZWZ0IHx8IGEudG9wICE9PSBiLnRvcCkge1xuICAgICAgICBjb25zdCBzdHlsZSA9IGdldENvbXB1dGVkU3R5bGUobm9kZSk7XG4gICAgICAgIGNvbnN0IHRyYW5zZm9ybSA9IHN0eWxlLnRyYW5zZm9ybSA9PT0gJ25vbmUnID8gJycgOiBzdHlsZS50cmFuc2Zvcm07XG4gICAgICAgIG5vZGUuc3R5bGUudHJhbnNmb3JtID0gYCR7dHJhbnNmb3JtfSB0cmFuc2xhdGUoJHthLmxlZnQgLSBiLmxlZnR9cHgsICR7YS50b3AgLSBiLnRvcH1weClgO1xuICAgIH1cbn1cblxubGV0IGN1cnJlbnRfY29tcG9uZW50O1xuZnVuY3Rpb24gc2V0X2N1cnJlbnRfY29tcG9uZW50KGNvbXBvbmVudCkge1xuICAgIGN1cnJlbnRfY29tcG9uZW50ID0gY29tcG9uZW50O1xufVxuZnVuY3Rpb24gZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkge1xuICAgIGlmICghY3VycmVudF9jb21wb25lbnQpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRnVuY3Rpb24gY2FsbGVkIG91dHNpZGUgY29tcG9uZW50IGluaXRpYWxpemF0aW9uYCk7XG4gICAgcmV0dXJuIGN1cnJlbnRfY29tcG9uZW50O1xufVxuZnVuY3Rpb24gYmVmb3JlVXBkYXRlKGZuKSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuYmVmb3JlX3VwZGF0ZS5wdXNoKGZuKTtcbn1cbmZ1bmN0aW9uIG9uTW91bnQoZm4pIHtcbiAgICBnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5vbl9tb3VudC5wdXNoKGZuKTtcbn1cbmZ1bmN0aW9uIGFmdGVyVXBkYXRlKGZuKSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuYWZ0ZXJfdXBkYXRlLnB1c2goZm4pO1xufVxuZnVuY3Rpb24gb25EZXN0cm95KGZuKSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQub25fZGVzdHJveS5wdXNoKGZuKTtcbn1cbmZ1bmN0aW9uIGNyZWF0ZUV2ZW50RGlzcGF0Y2hlcigpIHtcbiAgICBjb25zdCBjb21wb25lbnQgPSBnZXRfY3VycmVudF9jb21wb25lbnQoKTtcbiAgICByZXR1cm4gKHR5cGUsIGRldGFpbCkgPT4ge1xuICAgICAgICBjb25zdCBjYWxsYmFja3MgPSBjb21wb25lbnQuJCQuY2FsbGJhY2tzW3R5cGVdO1xuICAgICAgICBpZiAoY2FsbGJhY2tzKSB7XG4gICAgICAgICAgICAvLyBUT0RPIGFyZSB0aGVyZSBzaXR1YXRpb25zIHdoZXJlIGV2ZW50cyBjb3VsZCBiZSBkaXNwYXRjaGVkXG4gICAgICAgICAgICAvLyBpbiBhIHNlcnZlciAobm9uLURPTSkgZW52aXJvbm1lbnQ/XG4gICAgICAgICAgICBjb25zdCBldmVudCA9IGN1c3RvbV9ldmVudCh0eXBlLCBkZXRhaWwpO1xuICAgICAgICAgICAgY2FsbGJhY2tzLnNsaWNlKCkuZm9yRWFjaChmbiA9PiB7XG4gICAgICAgICAgICAgICAgZm4uY2FsbChjb21wb25lbnQsIGV2ZW50KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfTtcbn1cbmZ1bmN0aW9uIHNldENvbnRleHQoa2V5LCBjb250ZXh0KSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuY29udGV4dC5zZXQoa2V5LCBjb250ZXh0KTtcbn1cbmZ1bmN0aW9uIGdldENvbnRleHQoa2V5KSB7XG4gICAgcmV0dXJuIGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLmNvbnRleHQuZ2V0KGtleSk7XG59XG4vLyBUT0RPIGZpZ3VyZSBvdXQgaWYgd2Ugc3RpbGwgd2FudCB0byBzdXBwb3J0XG4vLyBzaG9ydGhhbmQgZXZlbnRzLCBvciBpZiB3ZSB3YW50IHRvIGltcGxlbWVudFxuLy8gYSByZWFsIGJ1YmJsaW5nIG1lY2hhbmlzbVxuZnVuY3Rpb24gYnViYmxlKGNvbXBvbmVudCwgZXZlbnQpIHtcbiAgICBjb25zdCBjYWxsYmFja3MgPSBjb21wb25lbnQuJCQuY2FsbGJhY2tzW2V2ZW50LnR5cGVdO1xuICAgIGlmIChjYWxsYmFja3MpIHtcbiAgICAgICAgY2FsbGJhY2tzLnNsaWNlKCkuZm9yRWFjaChmbiA9PiBmbihldmVudCkpO1xuICAgIH1cbn1cblxuY29uc3QgZGlydHlfY29tcG9uZW50cyA9IFtdO1xuY29uc3QgaW50cm9zID0geyBlbmFibGVkOiBmYWxzZSB9O1xuY29uc3QgYmluZGluZ19jYWxsYmFja3MgPSBbXTtcbmNvbnN0IHJlbmRlcl9jYWxsYmFja3MgPSBbXTtcbmNvbnN0IGZsdXNoX2NhbGxiYWNrcyA9IFtdO1xuY29uc3QgcmVzb2x2ZWRfcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xubGV0IHVwZGF0ZV9zY2hlZHVsZWQgPSBmYWxzZTtcbmZ1bmN0aW9uIHNjaGVkdWxlX3VwZGF0ZSgpIHtcbiAgICBpZiAoIXVwZGF0ZV9zY2hlZHVsZWQpIHtcbiAgICAgICAgdXBkYXRlX3NjaGVkdWxlZCA9IHRydWU7XG4gICAgICAgIHJlc29sdmVkX3Byb21pc2UudGhlbihmbHVzaCk7XG4gICAgfVxufVxuZnVuY3Rpb24gdGljaygpIHtcbiAgICBzY2hlZHVsZV91cGRhdGUoKTtcbiAgICByZXR1cm4gcmVzb2x2ZWRfcHJvbWlzZTtcbn1cbmZ1bmN0aW9uIGFkZF9yZW5kZXJfY2FsbGJhY2soZm4pIHtcbiAgICByZW5kZXJfY2FsbGJhY2tzLnB1c2goZm4pO1xufVxuZnVuY3Rpb24gYWRkX2ZsdXNoX2NhbGxiYWNrKGZuKSB7XG4gICAgZmx1c2hfY2FsbGJhY2tzLnB1c2goZm4pO1xufVxubGV0IGZsdXNoaW5nID0gZmFsc2U7XG5jb25zdCBzZWVuX2NhbGxiYWNrcyA9IG5ldyBTZXQoKTtcbmZ1bmN0aW9uIGZsdXNoKCkge1xuICAgIGlmIChmbHVzaGluZylcbiAgICAgICAgcmV0dXJuO1xuICAgIGZsdXNoaW5nID0gdHJ1ZTtcbiAgICBkbyB7XG4gICAgICAgIC8vIGZpcnN0LCBjYWxsIGJlZm9yZVVwZGF0ZSBmdW5jdGlvbnNcbiAgICAgICAgLy8gYW5kIHVwZGF0ZSBjb21wb25lbnRzXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGlydHlfY29tcG9uZW50cy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICAgICAgY29uc3QgY29tcG9uZW50ID0gZGlydHlfY29tcG9uZW50c1tpXTtcbiAgICAgICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChjb21wb25lbnQpO1xuICAgICAgICAgICAgdXBkYXRlKGNvbXBvbmVudC4kJCk7XG4gICAgICAgIH1cbiAgICAgICAgZGlydHlfY29tcG9uZW50cy5sZW5ndGggPSAwO1xuICAgICAgICB3aGlsZSAoYmluZGluZ19jYWxsYmFja3MubGVuZ3RoKVxuICAgICAgICAgICAgYmluZGluZ19jYWxsYmFja3MucG9wKCkoKTtcbiAgICAgICAgLy8gdGhlbiwgb25jZSBjb21wb25lbnRzIGFyZSB1cGRhdGVkLCBjYWxsXG4gICAgICAgIC8vIGFmdGVyVXBkYXRlIGZ1bmN0aW9ucy4gVGhpcyBtYXkgY2F1c2VcbiAgICAgICAgLy8gc3Vic2VxdWVudCB1cGRhdGVzLi4uXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmVuZGVyX2NhbGxiYWNrcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICAgICAgY29uc3QgY2FsbGJhY2sgPSByZW5kZXJfY2FsbGJhY2tzW2ldO1xuICAgICAgICAgICAgaWYgKCFzZWVuX2NhbGxiYWNrcy5oYXMoY2FsbGJhY2spKSB7XG4gICAgICAgICAgICAgICAgLy8gLi4uc28gZ3VhcmQgYWdhaW5zdCBpbmZpbml0ZSBsb29wc1xuICAgICAgICAgICAgICAgIHNlZW5fY2FsbGJhY2tzLmFkZChjYWxsYmFjayk7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZW5kZXJfY2FsbGJhY2tzLmxlbmd0aCA9IDA7XG4gICAgfSB3aGlsZSAoZGlydHlfY29tcG9uZW50cy5sZW5ndGgpO1xuICAgIHdoaWxlIChmbHVzaF9jYWxsYmFja3MubGVuZ3RoKSB7XG4gICAgICAgIGZsdXNoX2NhbGxiYWNrcy5wb3AoKSgpO1xuICAgIH1cbiAgICB1cGRhdGVfc2NoZWR1bGVkID0gZmFsc2U7XG4gICAgZmx1c2hpbmcgPSBmYWxzZTtcbiAgICBzZWVuX2NhbGxiYWNrcy5jbGVhcigpO1xufVxuZnVuY3Rpb24gdXBkYXRlKCQkKSB7XG4gICAgaWYgKCQkLmZyYWdtZW50ICE9PSBudWxsKSB7XG4gICAgICAgICQkLnVwZGF0ZSgpO1xuICAgICAgICBydW5fYWxsKCQkLmJlZm9yZV91cGRhdGUpO1xuICAgICAgICBjb25zdCBkaXJ0eSA9ICQkLmRpcnR5O1xuICAgICAgICAkJC5kaXJ0eSA9IFstMV07XG4gICAgICAgICQkLmZyYWdtZW50ICYmICQkLmZyYWdtZW50LnAoJCQuY3R4LCBkaXJ0eSk7XG4gICAgICAgICQkLmFmdGVyX3VwZGF0ZS5mb3JFYWNoKGFkZF9yZW5kZXJfY2FsbGJhY2spO1xuICAgIH1cbn1cblxubGV0IHByb21pc2U7XG5mdW5jdGlvbiB3YWl0KCkge1xuICAgIGlmICghcHJvbWlzZSkge1xuICAgICAgICBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIHByb21pc2UudGhlbigoKSA9PiB7XG4gICAgICAgICAgICBwcm9taXNlID0gbnVsbDtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBwcm9taXNlO1xufVxuZnVuY3Rpb24gZGlzcGF0Y2gobm9kZSwgZGlyZWN0aW9uLCBraW5kKSB7XG4gICAgbm9kZS5kaXNwYXRjaEV2ZW50KGN1c3RvbV9ldmVudChgJHtkaXJlY3Rpb24gPyAnaW50cm8nIDogJ291dHJvJ30ke2tpbmR9YCkpO1xufVxuY29uc3Qgb3V0cm9pbmcgPSBuZXcgU2V0KCk7XG5sZXQgb3V0cm9zO1xuZnVuY3Rpb24gZ3JvdXBfb3V0cm9zKCkge1xuICAgIG91dHJvcyA9IHtcbiAgICAgICAgcjogMCxcbiAgICAgICAgYzogW10sXG4gICAgICAgIHA6IG91dHJvcyAvLyBwYXJlbnQgZ3JvdXBcbiAgICB9O1xufVxuZnVuY3Rpb24gY2hlY2tfb3V0cm9zKCkge1xuICAgIGlmICghb3V0cm9zLnIpIHtcbiAgICAgICAgcnVuX2FsbChvdXRyb3MuYyk7XG4gICAgfVxuICAgIG91dHJvcyA9IG91dHJvcy5wO1xufVxuZnVuY3Rpb24gdHJhbnNpdGlvbl9pbihibG9jaywgbG9jYWwpIHtcbiAgICBpZiAoYmxvY2sgJiYgYmxvY2suaSkge1xuICAgICAgICBvdXRyb2luZy5kZWxldGUoYmxvY2spO1xuICAgICAgICBibG9jay5pKGxvY2FsKTtcbiAgICB9XG59XG5mdW5jdGlvbiB0cmFuc2l0aW9uX291dChibG9jaywgbG9jYWwsIGRldGFjaCwgY2FsbGJhY2spIHtcbiAgICBpZiAoYmxvY2sgJiYgYmxvY2subykge1xuICAgICAgICBpZiAob3V0cm9pbmcuaGFzKGJsb2NrKSlcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgb3V0cm9pbmcuYWRkKGJsb2NrKTtcbiAgICAgICAgb3V0cm9zLmMucHVzaCgoKSA9PiB7XG4gICAgICAgICAgICBvdXRyb2luZy5kZWxldGUoYmxvY2spO1xuICAgICAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICAgICAgaWYgKGRldGFjaClcbiAgICAgICAgICAgICAgICAgICAgYmxvY2suZCgxKTtcbiAgICAgICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgYmxvY2subyhsb2NhbCk7XG4gICAgfVxufVxuY29uc3QgbnVsbF90cmFuc2l0aW9uID0geyBkdXJhdGlvbjogMCB9O1xuZnVuY3Rpb24gY3JlYXRlX2luX3RyYW5zaXRpb24obm9kZSwgZm4sIHBhcmFtcykge1xuICAgIGxldCBjb25maWcgPSBmbihub2RlLCBwYXJhbXMpO1xuICAgIGxldCBydW5uaW5nID0gZmFsc2U7XG4gICAgbGV0IGFuaW1hdGlvbl9uYW1lO1xuICAgIGxldCB0YXNrO1xuICAgIGxldCB1aWQgPSAwO1xuICAgIGZ1bmN0aW9uIGNsZWFudXAoKSB7XG4gICAgICAgIGlmIChhbmltYXRpb25fbmFtZSlcbiAgICAgICAgICAgIGRlbGV0ZV9ydWxlKG5vZGUsIGFuaW1hdGlvbl9uYW1lKTtcbiAgICB9XG4gICAgZnVuY3Rpb24gZ28oKSB7XG4gICAgICAgIGNvbnN0IHsgZGVsYXkgPSAwLCBkdXJhdGlvbiA9IDMwMCwgZWFzaW5nID0gaWRlbnRpdHksIHRpY2sgPSBub29wLCBjc3MgfSA9IGNvbmZpZyB8fCBudWxsX3RyYW5zaXRpb247XG4gICAgICAgIGlmIChjc3MpXG4gICAgICAgICAgICBhbmltYXRpb25fbmFtZSA9IGNyZWF0ZV9ydWxlKG5vZGUsIDAsIDEsIGR1cmF0aW9uLCBkZWxheSwgZWFzaW5nLCBjc3MsIHVpZCsrKTtcbiAgICAgICAgdGljaygwLCAxKTtcbiAgICAgICAgY29uc3Qgc3RhcnRfdGltZSA9IG5vdygpICsgZGVsYXk7XG4gICAgICAgIGNvbnN0IGVuZF90aW1lID0gc3RhcnRfdGltZSArIGR1cmF0aW9uO1xuICAgICAgICBpZiAodGFzaylcbiAgICAgICAgICAgIHRhc2suYWJvcnQoKTtcbiAgICAgICAgcnVubmluZyA9IHRydWU7XG4gICAgICAgIGFkZF9yZW5kZXJfY2FsbGJhY2soKCkgPT4gZGlzcGF0Y2gobm9kZSwgdHJ1ZSwgJ3N0YXJ0JykpO1xuICAgICAgICB0YXNrID0gbG9vcChub3cgPT4ge1xuICAgICAgICAgICAgaWYgKHJ1bm5pbmcpIHtcbiAgICAgICAgICAgICAgICBpZiAobm93ID49IGVuZF90aW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHRpY2soMSwgMCk7XG4gICAgICAgICAgICAgICAgICAgIGRpc3BhdGNoKG5vZGUsIHRydWUsICdlbmQnKTtcbiAgICAgICAgICAgICAgICAgICAgY2xlYW51cCgpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gcnVubmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAobm93ID49IHN0YXJ0X3RpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdCA9IGVhc2luZygobm93IC0gc3RhcnRfdGltZSkgLyBkdXJhdGlvbik7XG4gICAgICAgICAgICAgICAgICAgIHRpY2sodCwgMSAtIHQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBydW5uaW5nO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgbGV0IHN0YXJ0ZWQgPSBmYWxzZTtcbiAgICByZXR1cm4ge1xuICAgICAgICBzdGFydCgpIHtcbiAgICAgICAgICAgIGlmIChzdGFydGVkKVxuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIGRlbGV0ZV9ydWxlKG5vZGUpO1xuICAgICAgICAgICAgaWYgKGlzX2Z1bmN0aW9uKGNvbmZpZykpIHtcbiAgICAgICAgICAgICAgICBjb25maWcgPSBjb25maWcoKTtcbiAgICAgICAgICAgICAgICB3YWl0KCkudGhlbihnbyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBnbygpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBpbnZhbGlkYXRlKCkge1xuICAgICAgICAgICAgc3RhcnRlZCA9IGZhbHNlO1xuICAgICAgICB9LFxuICAgICAgICBlbmQoKSB7XG4gICAgICAgICAgICBpZiAocnVubmluZykge1xuICAgICAgICAgICAgICAgIGNsZWFudXAoKTtcbiAgICAgICAgICAgICAgICBydW5uaW5nID0gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9O1xufVxuZnVuY3Rpb24gY3JlYXRlX291dF90cmFuc2l0aW9uKG5vZGUsIGZuLCBwYXJhbXMpIHtcbiAgICBsZXQgY29uZmlnID0gZm4obm9kZSwgcGFyYW1zKTtcbiAgICBsZXQgcnVubmluZyA9IHRydWU7XG4gICAgbGV0IGFuaW1hdGlvbl9uYW1lO1xuICAgIGNvbnN0IGdyb3VwID0gb3V0cm9zO1xuICAgIGdyb3VwLnIgKz0gMTtcbiAgICBmdW5jdGlvbiBnbygpIHtcbiAgICAgICAgY29uc3QgeyBkZWxheSA9IDAsIGR1cmF0aW9uID0gMzAwLCBlYXNpbmcgPSBpZGVudGl0eSwgdGljayA9IG5vb3AsIGNzcyB9ID0gY29uZmlnIHx8IG51bGxfdHJhbnNpdGlvbjtcbiAgICAgICAgaWYgKGNzcylcbiAgICAgICAgICAgIGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgMSwgMCwgZHVyYXRpb24sIGRlbGF5LCBlYXNpbmcsIGNzcyk7XG4gICAgICAgIGNvbnN0IHN0YXJ0X3RpbWUgPSBub3coKSArIGRlbGF5O1xuICAgICAgICBjb25zdCBlbmRfdGltZSA9IHN0YXJ0X3RpbWUgKyBkdXJhdGlvbjtcbiAgICAgICAgYWRkX3JlbmRlcl9jYWxsYmFjaygoKSA9PiBkaXNwYXRjaChub2RlLCBmYWxzZSwgJ3N0YXJ0JykpO1xuICAgICAgICBsb29wKG5vdyA9PiB7XG4gICAgICAgICAgICBpZiAocnVubmluZykge1xuICAgICAgICAgICAgICAgIGlmIChub3cgPj0gZW5kX3RpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGljaygwLCAxKTtcbiAgICAgICAgICAgICAgICAgICAgZGlzcGF0Y2gobm9kZSwgZmFsc2UsICdlbmQnKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCEtLWdyb3VwLnIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoaXMgd2lsbCByZXN1bHQgaW4gYGVuZCgpYCBiZWluZyBjYWxsZWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBzbyB3ZSBkb24ndCBuZWVkIHRvIGNsZWFuIHVwIGhlcmVcbiAgICAgICAgICAgICAgICAgICAgICAgIHJ1bl9hbGwoZ3JvdXAuYyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAobm93ID49IHN0YXJ0X3RpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdCA9IGVhc2luZygobm93IC0gc3RhcnRfdGltZSkgLyBkdXJhdGlvbik7XG4gICAgICAgICAgICAgICAgICAgIHRpY2soMSAtIHQsIHQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBydW5uaW5nO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgaWYgKGlzX2Z1bmN0aW9uKGNvbmZpZykpIHtcbiAgICAgICAgd2FpdCgpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgY29uZmlnID0gY29uZmlnKCk7XG4gICAgICAgICAgICBnbygpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIGdvKCk7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICAgIGVuZChyZXNldCkge1xuICAgICAgICAgICAgaWYgKHJlc2V0ICYmIGNvbmZpZy50aWNrKSB7XG4gICAgICAgICAgICAgICAgY29uZmlnLnRpY2soMSwgMCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocnVubmluZykge1xuICAgICAgICAgICAgICAgIGlmIChhbmltYXRpb25fbmFtZSlcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlX3J1bGUobm9kZSwgYW5pbWF0aW9uX25hbWUpO1xuICAgICAgICAgICAgICAgIHJ1bm5pbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH07XG59XG5mdW5jdGlvbiBjcmVhdGVfYmlkaXJlY3Rpb25hbF90cmFuc2l0aW9uKG5vZGUsIGZuLCBwYXJhbXMsIGludHJvKSB7XG4gICAgbGV0IGNvbmZpZyA9IGZuKG5vZGUsIHBhcmFtcyk7XG4gICAgbGV0IHQgPSBpbnRybyA/IDAgOiAxO1xuICAgIGxldCBydW5uaW5nX3Byb2dyYW0gPSBudWxsO1xuICAgIGxldCBwZW5kaW5nX3Byb2dyYW0gPSBudWxsO1xuICAgIGxldCBhbmltYXRpb25fbmFtZSA9IG51bGw7XG4gICAgZnVuY3Rpb24gY2xlYXJfYW5pbWF0aW9uKCkge1xuICAgICAgICBpZiAoYW5pbWF0aW9uX25hbWUpXG4gICAgICAgICAgICBkZWxldGVfcnVsZShub2RlLCBhbmltYXRpb25fbmFtZSk7XG4gICAgfVxuICAgIGZ1bmN0aW9uIGluaXQocHJvZ3JhbSwgZHVyYXRpb24pIHtcbiAgICAgICAgY29uc3QgZCA9IHByb2dyYW0uYiAtIHQ7XG4gICAgICAgIGR1cmF0aW9uICo9IE1hdGguYWJzKGQpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgYTogdCxcbiAgICAgICAgICAgIGI6IHByb2dyYW0uYixcbiAgICAgICAgICAgIGQsXG4gICAgICAgICAgICBkdXJhdGlvbixcbiAgICAgICAgICAgIHN0YXJ0OiBwcm9ncmFtLnN0YXJ0LFxuICAgICAgICAgICAgZW5kOiBwcm9ncmFtLnN0YXJ0ICsgZHVyYXRpb24sXG4gICAgICAgICAgICBncm91cDogcHJvZ3JhbS5ncm91cFxuICAgICAgICB9O1xuICAgIH1cbiAgICBmdW5jdGlvbiBnbyhiKSB7XG4gICAgICAgIGNvbnN0IHsgZGVsYXkgPSAwLCBkdXJhdGlvbiA9IDMwMCwgZWFzaW5nID0gaWRlbnRpdHksIHRpY2sgPSBub29wLCBjc3MgfSA9IGNvbmZpZyB8fCBudWxsX3RyYW5zaXRpb247XG4gICAgICAgIGNvbnN0IHByb2dyYW0gPSB7XG4gICAgICAgICAgICBzdGFydDogbm93KCkgKyBkZWxheSxcbiAgICAgICAgICAgIGJcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKCFiKSB7XG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlIHRvZG86IGltcHJvdmUgdHlwaW5nc1xuICAgICAgICAgICAgcHJvZ3JhbS5ncm91cCA9IG91dHJvcztcbiAgICAgICAgICAgIG91dHJvcy5yICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJ1bm5pbmdfcHJvZ3JhbSkge1xuICAgICAgICAgICAgcGVuZGluZ19wcm9ncmFtID0gcHJvZ3JhbTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIC8vIGlmIHRoaXMgaXMgYW4gaW50cm8sIGFuZCB0aGVyZSdzIGEgZGVsYXksIHdlIG5lZWQgdG8gZG9cbiAgICAgICAgICAgIC8vIGFuIGluaXRpYWwgdGljayBhbmQvb3IgYXBwbHkgQ1NTIGFuaW1hdGlvbiBpbW1lZGlhdGVseVxuICAgICAgICAgICAgaWYgKGNzcykge1xuICAgICAgICAgICAgICAgIGNsZWFyX2FuaW1hdGlvbigpO1xuICAgICAgICAgICAgICAgIGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgdCwgYiwgZHVyYXRpb24sIGRlbGF5LCBlYXNpbmcsIGNzcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoYilcbiAgICAgICAgICAgICAgICB0aWNrKDAsIDEpO1xuICAgICAgICAgICAgcnVubmluZ19wcm9ncmFtID0gaW5pdChwcm9ncmFtLCBkdXJhdGlvbik7XG4gICAgICAgICAgICBhZGRfcmVuZGVyX2NhbGxiYWNrKCgpID0+IGRpc3BhdGNoKG5vZGUsIGIsICdzdGFydCcpKTtcbiAgICAgICAgICAgIGxvb3Aobm93ID0+IHtcbiAgICAgICAgICAgICAgICBpZiAocGVuZGluZ19wcm9ncmFtICYmIG5vdyA+IHBlbmRpbmdfcHJvZ3JhbS5zdGFydCkge1xuICAgICAgICAgICAgICAgICAgICBydW5uaW5nX3Byb2dyYW0gPSBpbml0KHBlbmRpbmdfcHJvZ3JhbSwgZHVyYXRpb24pO1xuICAgICAgICAgICAgICAgICAgICBwZW5kaW5nX3Byb2dyYW0gPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICBkaXNwYXRjaChub2RlLCBydW5uaW5nX3Byb2dyYW0uYiwgJ3N0YXJ0Jyk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsZWFyX2FuaW1hdGlvbigpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYW5pbWF0aW9uX25hbWUgPSBjcmVhdGVfcnVsZShub2RlLCB0LCBydW5uaW5nX3Byb2dyYW0uYiwgcnVubmluZ19wcm9ncmFtLmR1cmF0aW9uLCAwLCBlYXNpbmcsIGNvbmZpZy5jc3MpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChydW5uaW5nX3Byb2dyYW0pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG5vdyA+PSBydW5uaW5nX3Byb2dyYW0uZW5kKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aWNrKHQgPSBydW5uaW5nX3Byb2dyYW0uYiwgMSAtIHQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGlzcGF0Y2gobm9kZSwgcnVubmluZ19wcm9ncmFtLmIsICdlbmQnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghcGVuZGluZ19wcm9ncmFtKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gd2UncmUgZG9uZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChydW5uaW5nX3Byb2dyYW0uYikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBpbnRybyDigJQgd2UgY2FuIHRpZHkgdXAgaW1tZWRpYXRlbHlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xlYXJfYW5pbWF0aW9uKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBvdXRybyDigJQgbmVlZHMgdG8gYmUgY29vcmRpbmF0ZWRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCEtLXJ1bm5pbmdfcHJvZ3JhbS5ncm91cC5yKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcnVuX2FsbChydW5uaW5nX3Byb2dyYW0uZ3JvdXAuYyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgcnVubmluZ19wcm9ncmFtID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBlbHNlIGlmIChub3cgPj0gcnVubmluZ19wcm9ncmFtLnN0YXJ0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwID0gbm93IC0gcnVubmluZ19wcm9ncmFtLnN0YXJ0O1xuICAgICAgICAgICAgICAgICAgICAgICAgdCA9IHJ1bm5pbmdfcHJvZ3JhbS5hICsgcnVubmluZ19wcm9ncmFtLmQgKiBlYXNpbmcocCAvIHJ1bm5pbmdfcHJvZ3JhbS5kdXJhdGlvbik7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aWNrKHQsIDEgLSB0KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gISEocnVubmluZ19wcm9ncmFtIHx8IHBlbmRpbmdfcHJvZ3JhbSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgICBydW4oYikge1xuICAgICAgICAgICAgaWYgKGlzX2Z1bmN0aW9uKGNvbmZpZykpIHtcbiAgICAgICAgICAgICAgICB3YWl0KCkudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICAgICAgICAgICAgY29uZmlnID0gY29uZmlnKCk7XG4gICAgICAgICAgICAgICAgICAgIGdvKGIpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgZ28oYik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIGVuZCgpIHtcbiAgICAgICAgICAgIGNsZWFyX2FuaW1hdGlvbigpO1xuICAgICAgICAgICAgcnVubmluZ19wcm9ncmFtID0gcGVuZGluZ19wcm9ncmFtID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGhhbmRsZV9wcm9taXNlKHByb21pc2UsIGluZm8pIHtcbiAgICBjb25zdCB0b2tlbiA9IGluZm8udG9rZW4gPSB7fTtcbiAgICBmdW5jdGlvbiB1cGRhdGUodHlwZSwgaW5kZXgsIGtleSwgdmFsdWUpIHtcbiAgICAgICAgaWYgKGluZm8udG9rZW4gIT09IHRva2VuKVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICBpbmZvLnJlc29sdmVkID0gdmFsdWU7XG4gICAgICAgIGxldCBjaGlsZF9jdHggPSBpbmZvLmN0eDtcbiAgICAgICAgaWYgKGtleSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjaGlsZF9jdHggPSBjaGlsZF9jdHguc2xpY2UoKTtcbiAgICAgICAgICAgIGNoaWxkX2N0eFtrZXldID0gdmFsdWU7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYmxvY2sgPSB0eXBlICYmIChpbmZvLmN1cnJlbnQgPSB0eXBlKShjaGlsZF9jdHgpO1xuICAgICAgICBsZXQgbmVlZHNfZmx1c2ggPSBmYWxzZTtcbiAgICAgICAgaWYgKGluZm8uYmxvY2spIHtcbiAgICAgICAgICAgIGlmIChpbmZvLmJsb2Nrcykge1xuICAgICAgICAgICAgICAgIGluZm8uYmxvY2tzLmZvckVhY2goKGJsb2NrLCBpKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChpICE9PSBpbmRleCAmJiBibG9jaykge1xuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBfb3V0cm9zKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cmFuc2l0aW9uX291dChibG9jaywgMSwgMSwgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uYmxvY2tzW2ldID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgY2hlY2tfb3V0cm9zKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIGluZm8uYmxvY2suZCgxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJsb2NrLmMoKTtcbiAgICAgICAgICAgIHRyYW5zaXRpb25faW4oYmxvY2ssIDEpO1xuICAgICAgICAgICAgYmxvY2subShpbmZvLm1vdW50KCksIGluZm8uYW5jaG9yKTtcbiAgICAgICAgICAgIG5lZWRzX2ZsdXNoID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpbmZvLmJsb2NrID0gYmxvY2s7XG4gICAgICAgIGlmIChpbmZvLmJsb2NrcylcbiAgICAgICAgICAgIGluZm8uYmxvY2tzW2luZGV4XSA9IGJsb2NrO1xuICAgICAgICBpZiAobmVlZHNfZmx1c2gpIHtcbiAgICAgICAgICAgIGZsdXNoKCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKGlzX3Byb21pc2UocHJvbWlzZSkpIHtcbiAgICAgICAgY29uc3QgY3VycmVudF9jb21wb25lbnQgPSBnZXRfY3VycmVudF9jb21wb25lbnQoKTtcbiAgICAgICAgcHJvbWlzZS50aGVuKHZhbHVlID0+IHtcbiAgICAgICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChjdXJyZW50X2NvbXBvbmVudCk7XG4gICAgICAgICAgICB1cGRhdGUoaW5mby50aGVuLCAxLCBpbmZvLnZhbHVlLCB2YWx1ZSk7XG4gICAgICAgICAgICBzZXRfY3VycmVudF9jb21wb25lbnQobnVsbCk7XG4gICAgICAgIH0sIGVycm9yID0+IHtcbiAgICAgICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChjdXJyZW50X2NvbXBvbmVudCk7XG4gICAgICAgICAgICB1cGRhdGUoaW5mby5jYXRjaCwgMiwgaW5mby5lcnJvciwgZXJyb3IpO1xuICAgICAgICAgICAgc2V0X2N1cnJlbnRfY29tcG9uZW50KG51bGwpO1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gaWYgd2UgcHJldmlvdXNseSBoYWQgYSB0aGVuL2NhdGNoIGJsb2NrLCBkZXN0cm95IGl0XG4gICAgICAgIGlmIChpbmZvLmN1cnJlbnQgIT09IGluZm8ucGVuZGluZykge1xuICAgICAgICAgICAgdXBkYXRlKGluZm8ucGVuZGluZywgMCk7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgaWYgKGluZm8uY3VycmVudCAhPT0gaW5mby50aGVuKSB7XG4gICAgICAgICAgICB1cGRhdGUoaW5mby50aGVuLCAxLCBpbmZvLnZhbHVlLCBwcm9taXNlKTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGluZm8ucmVzb2x2ZWQgPSBwcm9taXNlO1xuICAgIH1cbn1cblxuY29uc3QgZ2xvYmFscyA9ICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJ1xuICAgID8gd2luZG93XG4gICAgOiB0eXBlb2YgZ2xvYmFsVGhpcyAhPT0gJ3VuZGVmaW5lZCdcbiAgICAgICAgPyBnbG9iYWxUaGlzXG4gICAgICAgIDogZ2xvYmFsKTtcblxuZnVuY3Rpb24gZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKSB7XG4gICAgYmxvY2suZCgxKTtcbiAgICBsb29rdXAuZGVsZXRlKGJsb2NrLmtleSk7XG59XG5mdW5jdGlvbiBvdXRyb19hbmRfZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKSB7XG4gICAgdHJhbnNpdGlvbl9vdXQoYmxvY2ssIDEsIDEsICgpID0+IHtcbiAgICAgICAgbG9va3VwLmRlbGV0ZShibG9jay5rZXkpO1xuICAgIH0pO1xufVxuZnVuY3Rpb24gZml4X2FuZF9kZXN0cm95X2Jsb2NrKGJsb2NrLCBsb29rdXApIHtcbiAgICBibG9jay5mKCk7XG4gICAgZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKTtcbn1cbmZ1bmN0aW9uIGZpeF9hbmRfb3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCkge1xuICAgIGJsb2NrLmYoKTtcbiAgICBvdXRyb19hbmRfZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKTtcbn1cbmZ1bmN0aW9uIHVwZGF0ZV9rZXllZF9lYWNoKG9sZF9ibG9ja3MsIGRpcnR5LCBnZXRfa2V5LCBkeW5hbWljLCBjdHgsIGxpc3QsIGxvb2t1cCwgbm9kZSwgZGVzdHJveSwgY3JlYXRlX2VhY2hfYmxvY2ssIG5leHQsIGdldF9jb250ZXh0KSB7XG4gICAgbGV0IG8gPSBvbGRfYmxvY2tzLmxlbmd0aDtcbiAgICBsZXQgbiA9IGxpc3QubGVuZ3RoO1xuICAgIGxldCBpID0gbztcbiAgICBjb25zdCBvbGRfaW5kZXhlcyA9IHt9O1xuICAgIHdoaWxlIChpLS0pXG4gICAgICAgIG9sZF9pbmRleGVzW29sZF9ibG9ja3NbaV0ua2V5XSA9IGk7XG4gICAgY29uc3QgbmV3X2Jsb2NrcyA9IFtdO1xuICAgIGNvbnN0IG5ld19sb29rdXAgPSBuZXcgTWFwKCk7XG4gICAgY29uc3QgZGVsdGFzID0gbmV3IE1hcCgpO1xuICAgIGkgPSBuO1xuICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgY29uc3QgY2hpbGRfY3R4ID0gZ2V0X2NvbnRleHQoY3R4LCBsaXN0LCBpKTtcbiAgICAgICAgY29uc3Qga2V5ID0gZ2V0X2tleShjaGlsZF9jdHgpO1xuICAgICAgICBsZXQgYmxvY2sgPSBsb29rdXAuZ2V0KGtleSk7XG4gICAgICAgIGlmICghYmxvY2spIHtcbiAgICAgICAgICAgIGJsb2NrID0gY3JlYXRlX2VhY2hfYmxvY2soa2V5LCBjaGlsZF9jdHgpO1xuICAgICAgICAgICAgYmxvY2suYygpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGR5bmFtaWMpIHtcbiAgICAgICAgICAgIGJsb2NrLnAoY2hpbGRfY3R4LCBkaXJ0eSk7XG4gICAgICAgIH1cbiAgICAgICAgbmV3X2xvb2t1cC5zZXQoa2V5LCBuZXdfYmxvY2tzW2ldID0gYmxvY2spO1xuICAgICAgICBpZiAoa2V5IGluIG9sZF9pbmRleGVzKVxuICAgICAgICAgICAgZGVsdGFzLnNldChrZXksIE1hdGguYWJzKGkgLSBvbGRfaW5kZXhlc1trZXldKSk7XG4gICAgfVxuICAgIGNvbnN0IHdpbGxfbW92ZSA9IG5ldyBTZXQoKTtcbiAgICBjb25zdCBkaWRfbW92ZSA9IG5ldyBTZXQoKTtcbiAgICBmdW5jdGlvbiBpbnNlcnQoYmxvY2spIHtcbiAgICAgICAgdHJhbnNpdGlvbl9pbihibG9jaywgMSk7XG4gICAgICAgIGJsb2NrLm0obm9kZSwgbmV4dCk7XG4gICAgICAgIGxvb2t1cC5zZXQoYmxvY2sua2V5LCBibG9jayk7XG4gICAgICAgIG5leHQgPSBibG9jay5maXJzdDtcbiAgICAgICAgbi0tO1xuICAgIH1cbiAgICB3aGlsZSAobyAmJiBuKSB7XG4gICAgICAgIGNvbnN0IG5ld19ibG9jayA9IG5ld19ibG9ja3NbbiAtIDFdO1xuICAgICAgICBjb25zdCBvbGRfYmxvY2sgPSBvbGRfYmxvY2tzW28gLSAxXTtcbiAgICAgICAgY29uc3QgbmV3X2tleSA9IG5ld19ibG9jay5rZXk7XG4gICAgICAgIGNvbnN0IG9sZF9rZXkgPSBvbGRfYmxvY2sua2V5O1xuICAgICAgICBpZiAobmV3X2Jsb2NrID09PSBvbGRfYmxvY2spIHtcbiAgICAgICAgICAgIC8vIGRvIG5vdGhpbmdcbiAgICAgICAgICAgIG5leHQgPSBuZXdfYmxvY2suZmlyc3Q7XG4gICAgICAgICAgICBvLS07XG4gICAgICAgICAgICBuLS07XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoIW5ld19sb29rdXAuaGFzKG9sZF9rZXkpKSB7XG4gICAgICAgICAgICAvLyByZW1vdmUgb2xkIGJsb2NrXG4gICAgICAgICAgICBkZXN0cm95KG9sZF9ibG9jaywgbG9va3VwKTtcbiAgICAgICAgICAgIG8tLTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmICghbG9va3VwLmhhcyhuZXdfa2V5KSB8fCB3aWxsX21vdmUuaGFzKG5ld19rZXkpKSB7XG4gICAgICAgICAgICBpbnNlcnQobmV3X2Jsb2NrKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChkaWRfbW92ZS5oYXMob2xkX2tleSkpIHtcbiAgICAgICAgICAgIG8tLTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChkZWx0YXMuZ2V0KG5ld19rZXkpID4gZGVsdGFzLmdldChvbGRfa2V5KSkge1xuICAgICAgICAgICAgZGlkX21vdmUuYWRkKG5ld19rZXkpO1xuICAgICAgICAgICAgaW5zZXJ0KG5ld19ibG9jayk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB3aWxsX21vdmUuYWRkKG9sZF9rZXkpO1xuICAgICAgICAgICAgby0tO1xuICAgICAgICB9XG4gICAgfVxuICAgIHdoaWxlIChvLS0pIHtcbiAgICAgICAgY29uc3Qgb2xkX2Jsb2NrID0gb2xkX2Jsb2Nrc1tvXTtcbiAgICAgICAgaWYgKCFuZXdfbG9va3VwLmhhcyhvbGRfYmxvY2sua2V5KSlcbiAgICAgICAgICAgIGRlc3Ryb3kob2xkX2Jsb2NrLCBsb29rdXApO1xuICAgIH1cbiAgICB3aGlsZSAobilcbiAgICAgICAgaW5zZXJ0KG5ld19ibG9ja3NbbiAtIDFdKTtcbiAgICByZXR1cm4gbmV3X2Jsb2Nrcztcbn1cbmZ1bmN0aW9uIHZhbGlkYXRlX2VhY2hfa2V5cyhjdHgsIGxpc3QsIGdldF9jb250ZXh0LCBnZXRfa2V5KSB7XG4gICAgY29uc3Qga2V5cyA9IG5ldyBTZXQoKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3Qga2V5ID0gZ2V0X2tleShnZXRfY29udGV4dChjdHgsIGxpc3QsIGkpKTtcbiAgICAgICAgaWYgKGtleXMuaGFzKGtleSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGhhdmUgZHVwbGljYXRlIGtleXMgaW4gYSBrZXllZCBlYWNoYCk7XG4gICAgICAgIH1cbiAgICAgICAga2V5cy5hZGQoa2V5KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGdldF9zcHJlYWRfdXBkYXRlKGxldmVscywgdXBkYXRlcykge1xuICAgIGNvbnN0IHVwZGF0ZSA9IHt9O1xuICAgIGNvbnN0IHRvX251bGxfb3V0ID0ge307XG4gICAgY29uc3QgYWNjb3VudGVkX2ZvciA9IHsgJCRzY29wZTogMSB9O1xuICAgIGxldCBpID0gbGV2ZWxzLmxlbmd0aDtcbiAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgIGNvbnN0IG8gPSBsZXZlbHNbaV07XG4gICAgICAgIGNvbnN0IG4gPSB1cGRhdGVzW2ldO1xuICAgICAgICBpZiAobikge1xuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gbykge1xuICAgICAgICAgICAgICAgIGlmICghKGtleSBpbiBuKSlcbiAgICAgICAgICAgICAgICAgICAgdG9fbnVsbF9vdXRba2V5XSA9IDE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBuKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFhY2NvdW50ZWRfZm9yW2tleV0pIHtcbiAgICAgICAgICAgICAgICAgICAgdXBkYXRlW2tleV0gPSBuW2tleV07XG4gICAgICAgICAgICAgICAgICAgIGFjY291bnRlZF9mb3Jba2V5XSA9IDE7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbGV2ZWxzW2ldID0gbjtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIG8pIHtcbiAgICAgICAgICAgICAgICBhY2NvdW50ZWRfZm9yW2tleV0gPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIGZvciAoY29uc3Qga2V5IGluIHRvX251bGxfb3V0KSB7XG4gICAgICAgIGlmICghKGtleSBpbiB1cGRhdGUpKVxuICAgICAgICAgICAgdXBkYXRlW2tleV0gPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIHJldHVybiB1cGRhdGU7XG59XG5mdW5jdGlvbiBnZXRfc3ByZWFkX29iamVjdChzcHJlYWRfcHJvcHMpIHtcbiAgICByZXR1cm4gdHlwZW9mIHNwcmVhZF9wcm9wcyA9PT0gJ29iamVjdCcgJiYgc3ByZWFkX3Byb3BzICE9PSBudWxsID8gc3ByZWFkX3Byb3BzIDoge307XG59XG5cbi8vIHNvdXJjZTogaHR0cHM6Ly9odG1sLnNwZWMud2hhdHdnLm9yZy9tdWx0aXBhZ2UvaW5kaWNlcy5odG1sXG5jb25zdCBib29sZWFuX2F0dHJpYnV0ZXMgPSBuZXcgU2V0KFtcbiAgICAnYWxsb3dmdWxsc2NyZWVuJyxcbiAgICAnYWxsb3dwYXltZW50cmVxdWVzdCcsXG4gICAgJ2FzeW5jJyxcbiAgICAnYXV0b2ZvY3VzJyxcbiAgICAnYXV0b3BsYXknLFxuICAgICdjaGVja2VkJyxcbiAgICAnY29udHJvbHMnLFxuICAgICdkZWZhdWx0JyxcbiAgICAnZGVmZXInLFxuICAgICdkaXNhYmxlZCcsXG4gICAgJ2Zvcm1ub3ZhbGlkYXRlJyxcbiAgICAnaGlkZGVuJyxcbiAgICAnaXNtYXAnLFxuICAgICdsb29wJyxcbiAgICAnbXVsdGlwbGUnLFxuICAgICdtdXRlZCcsXG4gICAgJ25vbW9kdWxlJyxcbiAgICAnbm92YWxpZGF0ZScsXG4gICAgJ29wZW4nLFxuICAgICdwbGF5c2lubGluZScsXG4gICAgJ3JlYWRvbmx5JyxcbiAgICAncmVxdWlyZWQnLFxuICAgICdyZXZlcnNlZCcsXG4gICAgJ3NlbGVjdGVkJ1xuXSk7XG5cbmNvbnN0IGludmFsaWRfYXR0cmlidXRlX25hbWVfY2hhcmFjdGVyID0gL1tcXHMnXCI+Lz1cXHV7RkREMH0tXFx1e0ZERUZ9XFx1e0ZGRkV9XFx1e0ZGRkZ9XFx1ezFGRkZFfVxcdXsxRkZGRn1cXHV7MkZGRkV9XFx1ezJGRkZGfVxcdXszRkZGRX1cXHV7M0ZGRkZ9XFx1ezRGRkZFfVxcdXs0RkZGRn1cXHV7NUZGRkV9XFx1ezVGRkZGfVxcdXs2RkZGRX1cXHV7NkZGRkZ9XFx1ezdGRkZFfVxcdXs3RkZGRn1cXHV7OEZGRkV9XFx1ezhGRkZGfVxcdXs5RkZGRX1cXHV7OUZGRkZ9XFx1e0FGRkZFfVxcdXtBRkZGRn1cXHV7QkZGRkV9XFx1e0JGRkZGfVxcdXtDRkZGRX1cXHV7Q0ZGRkZ9XFx1e0RGRkZFfVxcdXtERkZGRn1cXHV7RUZGRkV9XFx1e0VGRkZGfVxcdXtGRkZGRX1cXHV7RkZGRkZ9XFx1ezEwRkZGRX1cXHV7MTBGRkZGfV0vdTtcbi8vIGh0dHBzOi8vaHRtbC5zcGVjLndoYXR3Zy5vcmcvbXVsdGlwYWdlL3N5bnRheC5odG1sI2F0dHJpYnV0ZXMtMlxuLy8gaHR0cHM6Ly9pbmZyYS5zcGVjLndoYXR3Zy5vcmcvI25vbmNoYXJhY3RlclxuZnVuY3Rpb24gc3ByZWFkKGFyZ3MsIGNsYXNzZXNfdG9fYWRkKSB7XG4gICAgY29uc3QgYXR0cmlidXRlcyA9IE9iamVjdC5hc3NpZ24oe30sIC4uLmFyZ3MpO1xuICAgIGlmIChjbGFzc2VzX3RvX2FkZCkge1xuICAgICAgICBpZiAoYXR0cmlidXRlcy5jbGFzcyA9PSBudWxsKSB7XG4gICAgICAgICAgICBhdHRyaWJ1dGVzLmNsYXNzID0gY2xhc3Nlc190b19hZGQ7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBhdHRyaWJ1dGVzLmNsYXNzICs9ICcgJyArIGNsYXNzZXNfdG9fYWRkO1xuICAgICAgICB9XG4gICAgfVxuICAgIGxldCBzdHIgPSAnJztcbiAgICBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKS5mb3JFYWNoKG5hbWUgPT4ge1xuICAgICAgICBpZiAoaW52YWxpZF9hdHRyaWJ1dGVfbmFtZV9jaGFyYWN0ZXIudGVzdChuYW1lKSlcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgY29uc3QgdmFsdWUgPSBhdHRyaWJ1dGVzW25hbWVdO1xuICAgICAgICBpZiAodmFsdWUgPT09IHRydWUpXG4gICAgICAgICAgICBzdHIgKz0gXCIgXCIgKyBuYW1lO1xuICAgICAgICBlbHNlIGlmIChib29sZWFuX2F0dHJpYnV0ZXMuaGFzKG5hbWUudG9Mb3dlckNhc2UoKSkpIHtcbiAgICAgICAgICAgIGlmICh2YWx1ZSlcbiAgICAgICAgICAgICAgICBzdHIgKz0gXCIgXCIgKyBuYW1lO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHZhbHVlICE9IG51bGwpIHtcbiAgICAgICAgICAgIHN0ciArPSBgICR7bmFtZX09XCIke1N0cmluZyh2YWx1ZSkucmVwbGFjZSgvXCIvZywgJyYjMzQ7JykucmVwbGFjZSgvJy9nLCAnJiMzOTsnKX1cImA7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gc3RyO1xufVxuY29uc3QgZXNjYXBlZCA9IHtcbiAgICAnXCInOiAnJnF1b3Q7JyxcbiAgICBcIidcIjogJyYjMzk7JyxcbiAgICAnJic6ICcmYW1wOycsXG4gICAgJzwnOiAnJmx0OycsXG4gICAgJz4nOiAnJmd0Oydcbn07XG5mdW5jdGlvbiBlc2NhcGUoaHRtbCkge1xuICAgIHJldHVybiBTdHJpbmcoaHRtbCkucmVwbGFjZSgvW1wiJyY8Pl0vZywgbWF0Y2ggPT4gZXNjYXBlZFttYXRjaF0pO1xufVxuZnVuY3Rpb24gZWFjaChpdGVtcywgZm4pIHtcbiAgICBsZXQgc3RyID0gJyc7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBpdGVtcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBzdHIgKz0gZm4oaXRlbXNbaV0sIGkpO1xuICAgIH1cbiAgICByZXR1cm4gc3RyO1xufVxuY29uc3QgbWlzc2luZ19jb21wb25lbnQgPSB7XG4gICAgJCRyZW5kZXI6ICgpID0+ICcnXG59O1xuZnVuY3Rpb24gdmFsaWRhdGVfY29tcG9uZW50KGNvbXBvbmVudCwgbmFtZSkge1xuICAgIGlmICghY29tcG9uZW50IHx8ICFjb21wb25lbnQuJCRyZW5kZXIpIHtcbiAgICAgICAgaWYgKG5hbWUgPT09ICdzdmVsdGU6Y29tcG9uZW50JylcbiAgICAgICAgICAgIG5hbWUgKz0gJyB0aGlzPXsuLi59JztcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGA8JHtuYW1lfT4gaXMgbm90IGEgdmFsaWQgU1NSIGNvbXBvbmVudC4gWW91IG1heSBuZWVkIHRvIHJldmlldyB5b3VyIGJ1aWxkIGNvbmZpZyB0byBlbnN1cmUgdGhhdCBkZXBlbmRlbmNpZXMgYXJlIGNvbXBpbGVkLCByYXRoZXIgdGhhbiBpbXBvcnRlZCBhcyBwcmUtY29tcGlsZWQgbW9kdWxlc2ApO1xuICAgIH1cbiAgICByZXR1cm4gY29tcG9uZW50O1xufVxuZnVuY3Rpb24gZGVidWcoZmlsZSwgbGluZSwgY29sdW1uLCB2YWx1ZXMpIHtcbiAgICBjb25zb2xlLmxvZyhge0BkZWJ1Z30gJHtmaWxlID8gZmlsZSArICcgJyA6ICcnfSgke2xpbmV9OiR7Y29sdW1ufSlgKTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1jb25zb2xlXG4gICAgY29uc29sZS5sb2codmFsdWVzKTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1jb25zb2xlXG4gICAgcmV0dXJuICcnO1xufVxubGV0IG9uX2Rlc3Ryb3k7XG5mdW5jdGlvbiBjcmVhdGVfc3NyX2NvbXBvbmVudChmbikge1xuICAgIGZ1bmN0aW9uICQkcmVuZGVyKHJlc3VsdCwgcHJvcHMsIGJpbmRpbmdzLCBzbG90cykge1xuICAgICAgICBjb25zdCBwYXJlbnRfY29tcG9uZW50ID0gY3VycmVudF9jb21wb25lbnQ7XG4gICAgICAgIGNvbnN0ICQkID0ge1xuICAgICAgICAgICAgb25fZGVzdHJveSxcbiAgICAgICAgICAgIGNvbnRleHQ6IG5ldyBNYXAocGFyZW50X2NvbXBvbmVudCA/IHBhcmVudF9jb21wb25lbnQuJCQuY29udGV4dCA6IFtdKSxcbiAgICAgICAgICAgIC8vIHRoZXNlIHdpbGwgYmUgaW1tZWRpYXRlbHkgZGlzY2FyZGVkXG4gICAgICAgICAgICBvbl9tb3VudDogW10sXG4gICAgICAgICAgICBiZWZvcmVfdXBkYXRlOiBbXSxcbiAgICAgICAgICAgIGFmdGVyX3VwZGF0ZTogW10sXG4gICAgICAgICAgICBjYWxsYmFja3M6IGJsYW5rX29iamVjdCgpXG4gICAgICAgIH07XG4gICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudCh7ICQkIH0pO1xuICAgICAgICBjb25zdCBodG1sID0gZm4ocmVzdWx0LCBwcm9wcywgYmluZGluZ3MsIHNsb3RzKTtcbiAgICAgICAgc2V0X2N1cnJlbnRfY29tcG9uZW50KHBhcmVudF9jb21wb25lbnQpO1xuICAgICAgICByZXR1cm4gaHRtbDtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgICAgcmVuZGVyOiAocHJvcHMgPSB7fSwgb3B0aW9ucyA9IHt9KSA9PiB7XG4gICAgICAgICAgICBvbl9kZXN0cm95ID0gW107XG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSB7IHRpdGxlOiAnJywgaGVhZDogJycsIGNzczogbmV3IFNldCgpIH07XG4gICAgICAgICAgICBjb25zdCBodG1sID0gJCRyZW5kZXIocmVzdWx0LCBwcm9wcywge30sIG9wdGlvbnMpO1xuICAgICAgICAgICAgcnVuX2FsbChvbl9kZXN0cm95KTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgaHRtbCxcbiAgICAgICAgICAgICAgICBjc3M6IHtcbiAgICAgICAgICAgICAgICAgICAgY29kZTogQXJyYXkuZnJvbShyZXN1bHQuY3NzKS5tYXAoY3NzID0+IGNzcy5jb2RlKS5qb2luKCdcXG4nKSxcbiAgICAgICAgICAgICAgICAgICAgbWFwOiBudWxsIC8vIFRPRE9cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGhlYWQ6IHJlc3VsdC50aXRsZSArIHJlc3VsdC5oZWFkXG4gICAgICAgICAgICB9O1xuICAgICAgICB9LFxuICAgICAgICAkJHJlbmRlclxuICAgIH07XG59XG5mdW5jdGlvbiBhZGRfYXR0cmlidXRlKG5hbWUsIHZhbHVlLCBib29sZWFuKSB7XG4gICAgaWYgKHZhbHVlID09IG51bGwgfHwgKGJvb2xlYW4gJiYgIXZhbHVlKSlcbiAgICAgICAgcmV0dXJuICcnO1xuICAgIHJldHVybiBgICR7bmFtZX0ke3ZhbHVlID09PSB0cnVlID8gJycgOiBgPSR7dHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyA/IEpTT04uc3RyaW5naWZ5KGVzY2FwZSh2YWx1ZSkpIDogYFwiJHt2YWx1ZX1cImB9YH1gO1xufVxuZnVuY3Rpb24gYWRkX2NsYXNzZXMoY2xhc3Nlcykge1xuICAgIHJldHVybiBjbGFzc2VzID8gYCBjbGFzcz1cIiR7Y2xhc3Nlc31cImAgOiBgYDtcbn1cblxuZnVuY3Rpb24gYmluZChjb21wb25lbnQsIG5hbWUsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgaW5kZXggPSBjb21wb25lbnQuJCQucHJvcHNbbmFtZV07XG4gICAgaWYgKGluZGV4ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY29tcG9uZW50LiQkLmJvdW5kW2luZGV4XSA9IGNhbGxiYWNrO1xuICAgICAgICBjYWxsYmFjayhjb21wb25lbnQuJCQuY3R4W2luZGV4XSk7XG4gICAgfVxufVxuZnVuY3Rpb24gY3JlYXRlX2NvbXBvbmVudChibG9jaykge1xuICAgIGJsb2NrICYmIGJsb2NrLmMoKTtcbn1cbmZ1bmN0aW9uIGNsYWltX2NvbXBvbmVudChibG9jaywgcGFyZW50X25vZGVzKSB7XG4gICAgYmxvY2sgJiYgYmxvY2subChwYXJlbnRfbm9kZXMpO1xufVxuZnVuY3Rpb24gbW91bnRfY29tcG9uZW50KGNvbXBvbmVudCwgdGFyZ2V0LCBhbmNob3IpIHtcbiAgICBjb25zdCB7IGZyYWdtZW50LCBvbl9tb3VudCwgb25fZGVzdHJveSwgYWZ0ZXJfdXBkYXRlIH0gPSBjb21wb25lbnQuJCQ7XG4gICAgZnJhZ21lbnQgJiYgZnJhZ21lbnQubSh0YXJnZXQsIGFuY2hvcik7XG4gICAgLy8gb25Nb3VudCBoYXBwZW5zIGJlZm9yZSB0aGUgaW5pdGlhbCBhZnRlclVwZGF0ZVxuICAgIGFkZF9yZW5kZXJfY2FsbGJhY2soKCkgPT4ge1xuICAgICAgICBjb25zdCBuZXdfb25fZGVzdHJveSA9IG9uX21vdW50Lm1hcChydW4pLmZpbHRlcihpc19mdW5jdGlvbik7XG4gICAgICAgIGlmIChvbl9kZXN0cm95KSB7XG4gICAgICAgICAgICBvbl9kZXN0cm95LnB1c2goLi4ubmV3X29uX2Rlc3Ryb3kpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy8gRWRnZSBjYXNlIC0gY29tcG9uZW50IHdhcyBkZXN0cm95ZWQgaW1tZWRpYXRlbHksXG4gICAgICAgICAgICAvLyBtb3N0IGxpa2VseSBhcyBhIHJlc3VsdCBvZiBhIGJpbmRpbmcgaW5pdGlhbGlzaW5nXG4gICAgICAgICAgICBydW5fYWxsKG5ld19vbl9kZXN0cm95KTtcbiAgICAgICAgfVxuICAgICAgICBjb21wb25lbnQuJCQub25fbW91bnQgPSBbXTtcbiAgICB9KTtcbiAgICBhZnRlcl91cGRhdGUuZm9yRWFjaChhZGRfcmVuZGVyX2NhbGxiYWNrKTtcbn1cbmZ1bmN0aW9uIGRlc3Ryb3lfY29tcG9uZW50KGNvbXBvbmVudCwgZGV0YWNoaW5nKSB7XG4gICAgY29uc3QgJCQgPSBjb21wb25lbnQuJCQ7XG4gICAgaWYgKCQkLmZyYWdtZW50ICE9PSBudWxsKSB7XG4gICAgICAgIHJ1bl9hbGwoJCQub25fZGVzdHJveSk7XG4gICAgICAgICQkLmZyYWdtZW50ICYmICQkLmZyYWdtZW50LmQoZGV0YWNoaW5nKTtcbiAgICAgICAgLy8gVE9ETyBudWxsIG91dCBvdGhlciByZWZzLCBpbmNsdWRpbmcgY29tcG9uZW50LiQkIChidXQgbmVlZCB0b1xuICAgICAgICAvLyBwcmVzZXJ2ZSBmaW5hbCBzdGF0ZT8pXG4gICAgICAgICQkLm9uX2Rlc3Ryb3kgPSAkJC5mcmFnbWVudCA9IG51bGw7XG4gICAgICAgICQkLmN0eCA9IFtdO1xuICAgIH1cbn1cbmZ1bmN0aW9uIG1ha2VfZGlydHkoY29tcG9uZW50LCBpKSB7XG4gICAgaWYgKGNvbXBvbmVudC4kJC5kaXJ0eVswXSA9PT0gLTEpIHtcbiAgICAgICAgZGlydHlfY29tcG9uZW50cy5wdXNoKGNvbXBvbmVudCk7XG4gICAgICAgIHNjaGVkdWxlX3VwZGF0ZSgpO1xuICAgICAgICBjb21wb25lbnQuJCQuZGlydHkuZmlsbCgwKTtcbiAgICB9XG4gICAgY29tcG9uZW50LiQkLmRpcnR5WyhpIC8gMzEpIHwgMF0gfD0gKDEgPDwgKGkgJSAzMSkpO1xufVxuZnVuY3Rpb24gaW5pdChjb21wb25lbnQsIG9wdGlvbnMsIGluc3RhbmNlLCBjcmVhdGVfZnJhZ21lbnQsIG5vdF9lcXVhbCwgcHJvcHMsIGRpcnR5ID0gWy0xXSkge1xuICAgIGNvbnN0IHBhcmVudF9jb21wb25lbnQgPSBjdXJyZW50X2NvbXBvbmVudDtcbiAgICBzZXRfY3VycmVudF9jb21wb25lbnQoY29tcG9uZW50KTtcbiAgICBjb25zdCBwcm9wX3ZhbHVlcyA9IG9wdGlvbnMucHJvcHMgfHwge307XG4gICAgY29uc3QgJCQgPSBjb21wb25lbnQuJCQgPSB7XG4gICAgICAgIGZyYWdtZW50OiBudWxsLFxuICAgICAgICBjdHg6IG51bGwsXG4gICAgICAgIC8vIHN0YXRlXG4gICAgICAgIHByb3BzLFxuICAgICAgICB1cGRhdGU6IG5vb3AsXG4gICAgICAgIG5vdF9lcXVhbCxcbiAgICAgICAgYm91bmQ6IGJsYW5rX29iamVjdCgpLFxuICAgICAgICAvLyBsaWZlY3ljbGVcbiAgICAgICAgb25fbW91bnQ6IFtdLFxuICAgICAgICBvbl9kZXN0cm95OiBbXSxcbiAgICAgICAgYmVmb3JlX3VwZGF0ZTogW10sXG4gICAgICAgIGFmdGVyX3VwZGF0ZTogW10sXG4gICAgICAgIGNvbnRleHQ6IG5ldyBNYXAocGFyZW50X2NvbXBvbmVudCA/IHBhcmVudF9jb21wb25lbnQuJCQuY29udGV4dCA6IFtdKSxcbiAgICAgICAgLy8gZXZlcnl0aGluZyBlbHNlXG4gICAgICAgIGNhbGxiYWNrczogYmxhbmtfb2JqZWN0KCksXG4gICAgICAgIGRpcnR5XG4gICAgfTtcbiAgICBsZXQgcmVhZHkgPSBmYWxzZTtcbiAgICAkJC5jdHggPSBpbnN0YW5jZVxuICAgICAgICA/IGluc3RhbmNlKGNvbXBvbmVudCwgcHJvcF92YWx1ZXMsIChpLCByZXQsIC4uLnJlc3QpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gcmVzdC5sZW5ndGggPyByZXN0WzBdIDogcmV0O1xuICAgICAgICAgICAgaWYgKCQkLmN0eCAmJiBub3RfZXF1YWwoJCQuY3R4W2ldLCAkJC5jdHhbaV0gPSB2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICBpZiAoJCQuYm91bmRbaV0pXG4gICAgICAgICAgICAgICAgICAgICQkLmJvdW5kW2ldKHZhbHVlKTtcbiAgICAgICAgICAgICAgICBpZiAocmVhZHkpXG4gICAgICAgICAgICAgICAgICAgIG1ha2VfZGlydHkoY29tcG9uZW50LCBpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiByZXQ7XG4gICAgICAgIH0pXG4gICAgICAgIDogW107XG4gICAgJCQudXBkYXRlKCk7XG4gICAgcmVhZHkgPSB0cnVlO1xuICAgIHJ1bl9hbGwoJCQuYmVmb3JlX3VwZGF0ZSk7XG4gICAgLy8gYGZhbHNlYCBhcyBhIHNwZWNpYWwgY2FzZSBvZiBubyBET00gY29tcG9uZW50XG4gICAgJCQuZnJhZ21lbnQgPSBjcmVhdGVfZnJhZ21lbnQgPyBjcmVhdGVfZnJhZ21lbnQoJCQuY3R4KSA6IGZhbHNlO1xuICAgIGlmIChvcHRpb25zLnRhcmdldCkge1xuICAgICAgICBpZiAob3B0aW9ucy5oeWRyYXRlKSB7XG4gICAgICAgICAgICBjb25zdCBub2RlcyA9IGNoaWxkcmVuKG9wdGlvbnMudGFyZ2V0KTtcbiAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbm9uLW51bGwtYXNzZXJ0aW9uXG4gICAgICAgICAgICAkJC5mcmFnbWVudCAmJiAkJC5mcmFnbWVudC5sKG5vZGVzKTtcbiAgICAgICAgICAgIG5vZGVzLmZvckVhY2goZGV0YWNoKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbm9uLW51bGwtYXNzZXJ0aW9uXG4gICAgICAgICAgICAkJC5mcmFnbWVudCAmJiAkJC5mcmFnbWVudC5jKCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG9wdGlvbnMuaW50cm8pXG4gICAgICAgICAgICB0cmFuc2l0aW9uX2luKGNvbXBvbmVudC4kJC5mcmFnbWVudCk7XG4gICAgICAgIG1vdW50X2NvbXBvbmVudChjb21wb25lbnQsIG9wdGlvbnMudGFyZ2V0LCBvcHRpb25zLmFuY2hvcik7XG4gICAgICAgIGZsdXNoKCk7XG4gICAgfVxuICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChwYXJlbnRfY29tcG9uZW50KTtcbn1cbmxldCBTdmVsdGVFbGVtZW50O1xuaWYgKHR5cGVvZiBIVE1MRWxlbWVudCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIFN2ZWx0ZUVsZW1lbnQgPSBjbGFzcyBleHRlbmRzIEhUTUxFbGVtZW50IHtcbiAgICAgICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgICAgICBzdXBlcigpO1xuICAgICAgICAgICAgdGhpcy5hdHRhY2hTaGFkb3coeyBtb2RlOiAnb3BlbicgfSk7XG4gICAgICAgIH1cbiAgICAgICAgY29ubmVjdGVkQ2FsbGJhY2soKSB7XG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlIHRvZG86IGltcHJvdmUgdHlwaW5nc1xuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gdGhpcy4kJC5zbG90dGVkKSB7XG4gICAgICAgICAgICAgICAgLy8gQHRzLWlnbm9yZSB0b2RvOiBpbXByb3ZlIHR5cGluZ3NcbiAgICAgICAgICAgICAgICB0aGlzLmFwcGVuZENoaWxkKHRoaXMuJCQuc2xvdHRlZFtrZXldKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBhdHRyaWJ1dGVDaGFuZ2VkQ2FsbGJhY2soYXR0ciwgX29sZFZhbHVlLCBuZXdWYWx1ZSkge1xuICAgICAgICAgICAgdGhpc1thdHRyXSA9IG5ld1ZhbHVlO1xuICAgICAgICB9XG4gICAgICAgICRkZXN0cm95KCkge1xuICAgICAgICAgICAgZGVzdHJveV9jb21wb25lbnQodGhpcywgMSk7XG4gICAgICAgICAgICB0aGlzLiRkZXN0cm95ID0gbm9vcDtcbiAgICAgICAgfVxuICAgICAgICAkb24odHlwZSwgY2FsbGJhY2spIHtcbiAgICAgICAgICAgIC8vIFRPRE8gc2hvdWxkIHRoaXMgZGVsZWdhdGUgdG8gYWRkRXZlbnRMaXN0ZW5lcj9cbiAgICAgICAgICAgIGNvbnN0IGNhbGxiYWNrcyA9ICh0aGlzLiQkLmNhbGxiYWNrc1t0eXBlXSB8fCAodGhpcy4kJC5jYWxsYmFja3NbdHlwZV0gPSBbXSkpO1xuICAgICAgICAgICAgY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spO1xuICAgICAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBpbmRleCA9IGNhbGxiYWNrcy5pbmRleE9mKGNhbGxiYWNrKTtcbiAgICAgICAgICAgICAgICBpZiAoaW5kZXggIT09IC0xKVxuICAgICAgICAgICAgICAgICAgICBjYWxsYmFja3Muc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgJHNldCgpIHtcbiAgICAgICAgICAgIC8vIG92ZXJyaWRkZW4gYnkgaW5zdGFuY2UsIGlmIGl0IGhhcyBwcm9wc1xuICAgICAgICB9XG4gICAgfTtcbn1cbmNsYXNzIFN2ZWx0ZUNvbXBvbmVudCB7XG4gICAgJGRlc3Ryb3koKSB7XG4gICAgICAgIGRlc3Ryb3lfY29tcG9uZW50KHRoaXMsIDEpO1xuICAgICAgICB0aGlzLiRkZXN0cm95ID0gbm9vcDtcbiAgICB9XG4gICAgJG9uKHR5cGUsIGNhbGxiYWNrKSB7XG4gICAgICAgIGNvbnN0IGNhbGxiYWNrcyA9ICh0aGlzLiQkLmNhbGxiYWNrc1t0eXBlXSB8fCAodGhpcy4kJC5jYWxsYmFja3NbdHlwZV0gPSBbXSkpO1xuICAgICAgICBjYWxsYmFja3MucHVzaChjYWxsYmFjayk7XG4gICAgICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBpbmRleCA9IGNhbGxiYWNrcy5pbmRleE9mKGNhbGxiYWNrKTtcbiAgICAgICAgICAgIGlmIChpbmRleCAhPT0gLTEpXG4gICAgICAgICAgICAgICAgY2FsbGJhY2tzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIH07XG4gICAgfVxuICAgICRzZXQoKSB7XG4gICAgICAgIC8vIG92ZXJyaWRkZW4gYnkgaW5zdGFuY2UsIGlmIGl0IGhhcyBwcm9wc1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZGlzcGF0Y2hfZGV2KHR5cGUsIGRldGFpbCkge1xuICAgIGRvY3VtZW50LmRpc3BhdGNoRXZlbnQoY3VzdG9tX2V2ZW50KHR5cGUsIE9iamVjdC5hc3NpZ24oeyB2ZXJzaW9uOiAnMy4yMy4wJyB9LCBkZXRhaWwpKSk7XG59XG5mdW5jdGlvbiBhcHBlbmRfZGV2KHRhcmdldCwgbm9kZSkge1xuICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTUluc2VydFwiLCB7IHRhcmdldCwgbm9kZSB9KTtcbiAgICBhcHBlbmQodGFyZ2V0LCBub2RlKTtcbn1cbmZ1bmN0aW9uIGluc2VydF9kZXYodGFyZ2V0LCBub2RlLCBhbmNob3IpIHtcbiAgICBkaXNwYXRjaF9kZXYoXCJTdmVsdGVET01JbnNlcnRcIiwgeyB0YXJnZXQsIG5vZGUsIGFuY2hvciB9KTtcbiAgICBpbnNlcnQodGFyZ2V0LCBub2RlLCBhbmNob3IpO1xufVxuZnVuY3Rpb24gZGV0YWNoX2Rldihub2RlKSB7XG4gICAgZGlzcGF0Y2hfZGV2KFwiU3ZlbHRlRE9NUmVtb3ZlXCIsIHsgbm9kZSB9KTtcbiAgICBkZXRhY2gobm9kZSk7XG59XG5mdW5jdGlvbiBkZXRhY2hfYmV0d2Vlbl9kZXYoYmVmb3JlLCBhZnRlcikge1xuICAgIHdoaWxlIChiZWZvcmUubmV4dFNpYmxpbmcgJiYgYmVmb3JlLm5leHRTaWJsaW5nICE9PSBhZnRlcikge1xuICAgICAgICBkZXRhY2hfZGV2KGJlZm9yZS5uZXh0U2libGluZyk7XG4gICAgfVxufVxuZnVuY3Rpb24gZGV0YWNoX2JlZm9yZV9kZXYoYWZ0ZXIpIHtcbiAgICB3aGlsZSAoYWZ0ZXIucHJldmlvdXNTaWJsaW5nKSB7XG4gICAgICAgIGRldGFjaF9kZXYoYWZ0ZXIucHJldmlvdXNTaWJsaW5nKTtcbiAgICB9XG59XG5mdW5jdGlvbiBkZXRhY2hfYWZ0ZXJfZGV2KGJlZm9yZSkge1xuICAgIHdoaWxlIChiZWZvcmUubmV4dFNpYmxpbmcpIHtcbiAgICAgICAgZGV0YWNoX2RldihiZWZvcmUubmV4dFNpYmxpbmcpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIGxpc3Rlbl9kZXYobm9kZSwgZXZlbnQsIGhhbmRsZXIsIG9wdGlvbnMsIGhhc19wcmV2ZW50X2RlZmF1bHQsIGhhc19zdG9wX3Byb3BhZ2F0aW9uKSB7XG4gICAgY29uc3QgbW9kaWZpZXJzID0gb3B0aW9ucyA9PT0gdHJ1ZSA/IFtcImNhcHR1cmVcIl0gOiBvcHRpb25zID8gQXJyYXkuZnJvbShPYmplY3Qua2V5cyhvcHRpb25zKSkgOiBbXTtcbiAgICBpZiAoaGFzX3ByZXZlbnRfZGVmYXVsdClcbiAgICAgICAgbW9kaWZpZXJzLnB1c2goJ3ByZXZlbnREZWZhdWx0Jyk7XG4gICAgaWYgKGhhc19zdG9wX3Byb3BhZ2F0aW9uKVxuICAgICAgICBtb2RpZmllcnMucHVzaCgnc3RvcFByb3BhZ2F0aW9uJyk7XG4gICAgZGlzcGF0Y2hfZGV2KFwiU3ZlbHRlRE9NQWRkRXZlbnRMaXN0ZW5lclwiLCB7IG5vZGUsIGV2ZW50LCBoYW5kbGVyLCBtb2RpZmllcnMgfSk7XG4gICAgY29uc3QgZGlzcG9zZSA9IGxpc3Rlbihub2RlLCBldmVudCwgaGFuZGxlciwgb3B0aW9ucyk7XG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgZGlzcGF0Y2hfZGV2KFwiU3ZlbHRlRE9NUmVtb3ZlRXZlbnRMaXN0ZW5lclwiLCB7IG5vZGUsIGV2ZW50LCBoYW5kbGVyLCBtb2RpZmllcnMgfSk7XG4gICAgICAgIGRpc3Bvc2UoKTtcbiAgICB9O1xufVxuZnVuY3Rpb24gYXR0cl9kZXYobm9kZSwgYXR0cmlidXRlLCB2YWx1ZSkge1xuICAgIGF0dHIobm9kZSwgYXR0cmlidXRlLCB2YWx1ZSk7XG4gICAgaWYgKHZhbHVlID09IG51bGwpXG4gICAgICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVJlbW92ZUF0dHJpYnV0ZVwiLCB7IG5vZGUsIGF0dHJpYnV0ZSB9KTtcbiAgICBlbHNlXG4gICAgICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVNldEF0dHJpYnV0ZVwiLCB7IG5vZGUsIGF0dHJpYnV0ZSwgdmFsdWUgfSk7XG59XG5mdW5jdGlvbiBwcm9wX2Rldihub2RlLCBwcm9wZXJ0eSwgdmFsdWUpIHtcbiAgICBub2RlW3Byb3BlcnR5XSA9IHZhbHVlO1xuICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVNldFByb3BlcnR5XCIsIHsgbm9kZSwgcHJvcGVydHksIHZhbHVlIH0pO1xufVxuZnVuY3Rpb24gZGF0YXNldF9kZXYobm9kZSwgcHJvcGVydHksIHZhbHVlKSB7XG4gICAgbm9kZS5kYXRhc2V0W3Byb3BlcnR5XSA9IHZhbHVlO1xuICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVNldERhdGFzZXRcIiwgeyBub2RlLCBwcm9wZXJ0eSwgdmFsdWUgfSk7XG59XG5mdW5jdGlvbiBzZXRfZGF0YV9kZXYodGV4dCwgZGF0YSkge1xuICAgIGRhdGEgPSAnJyArIGRhdGE7XG4gICAgaWYgKHRleHQuZGF0YSA9PT0gZGF0YSlcbiAgICAgICAgcmV0dXJuO1xuICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVNldERhdGFcIiwgeyBub2RlOiB0ZXh0LCBkYXRhIH0pO1xuICAgIHRleHQuZGF0YSA9IGRhdGE7XG59XG5mdW5jdGlvbiB2YWxpZGF0ZV9lYWNoX2FyZ3VtZW50KGFyZykge1xuICAgIGlmICh0eXBlb2YgYXJnICE9PSAnc3RyaW5nJyAmJiAhKGFyZyAmJiB0eXBlb2YgYXJnID09PSAnb2JqZWN0JyAmJiAnbGVuZ3RoJyBpbiBhcmcpKSB7XG4gICAgICAgIGxldCBtc2cgPSAneyNlYWNofSBvbmx5IGl0ZXJhdGVzIG92ZXIgYXJyYXktbGlrZSBvYmplY3RzLic7XG4gICAgICAgIGlmICh0eXBlb2YgU3ltYm9sID09PSAnZnVuY3Rpb24nICYmIGFyZyAmJiBTeW1ib2wuaXRlcmF0b3IgaW4gYXJnKSB7XG4gICAgICAgICAgICBtc2cgKz0gJyBZb3UgY2FuIHVzZSBhIHNwcmVhZCB0byBjb252ZXJ0IHRoaXMgaXRlcmFibGUgaW50byBhbiBhcnJheS4nO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIHZhbGlkYXRlX3Nsb3RzKG5hbWUsIHNsb3QsIGtleXMpIHtcbiAgICBmb3IgKGNvbnN0IHNsb3Rfa2V5IG9mIE9iamVjdC5rZXlzKHNsb3QpKSB7XG4gICAgICAgIGlmICghfmtleXMuaW5kZXhPZihzbG90X2tleSkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgPCR7bmFtZX0+IHJlY2VpdmVkIGFuIHVuZXhwZWN0ZWQgc2xvdCBcIiR7c2xvdF9rZXl9XCIuYCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5jbGFzcyBTdmVsdGVDb21wb25lbnREZXYgZXh0ZW5kcyBTdmVsdGVDb21wb25lbnQge1xuICAgIGNvbnN0cnVjdG9yKG9wdGlvbnMpIHtcbiAgICAgICAgaWYgKCFvcHRpb25zIHx8ICghb3B0aW9ucy50YXJnZXQgJiYgIW9wdGlvbnMuJCRpbmxpbmUpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCd0YXJnZXQnIGlzIGEgcmVxdWlyZWQgb3B0aW9uYCk7XG4gICAgICAgIH1cbiAgICAgICAgc3VwZXIoKTtcbiAgICB9XG4gICAgJGRlc3Ryb3koKSB7XG4gICAgICAgIHN1cGVyLiRkZXN0cm95KCk7XG4gICAgICAgIHRoaXMuJGRlc3Ryb3kgPSAoKSA9PiB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYENvbXBvbmVudCB3YXMgYWxyZWFkeSBkZXN0cm95ZWRgKTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1jb25zb2xlXG4gICAgICAgIH07XG4gICAgfVxuICAgICRjYXB0dXJlX3N0YXRlKCkgeyB9XG4gICAgJGluamVjdF9zdGF0ZSgpIHsgfVxufVxuZnVuY3Rpb24gbG9vcF9ndWFyZCh0aW1lb3V0KSB7XG4gICAgY29uc3Qgc3RhcnQgPSBEYXRlLm5vdygpO1xuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgIGlmIChEYXRlLm5vdygpIC0gc3RhcnQgPiB0aW1lb3V0KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEluZmluaXRlIGxvb3AgZGV0ZWN0ZWRgKTtcbiAgICAgICAgfVxuICAgIH07XG59XG5cbmV4cG9ydCB7IEh0bWxUYWcsIFN2ZWx0ZUNvbXBvbmVudCwgU3ZlbHRlQ29tcG9uZW50RGV2LCBTdmVsdGVFbGVtZW50LCBhY3Rpb25fZGVzdHJveWVyLCBhZGRfYXR0cmlidXRlLCBhZGRfY2xhc3NlcywgYWRkX2ZsdXNoX2NhbGxiYWNrLCBhZGRfbG9jYXRpb24sIGFkZF9yZW5kZXJfY2FsbGJhY2ssIGFkZF9yZXNpemVfbGlzdGVuZXIsIGFkZF90cmFuc2Zvcm0sIGFmdGVyVXBkYXRlLCBhcHBlbmQsIGFwcGVuZF9kZXYsIGFzc2lnbiwgYXR0ciwgYXR0cl9kZXYsIGJlZm9yZVVwZGF0ZSwgYmluZCwgYmluZGluZ19jYWxsYmFja3MsIGJsYW5rX29iamVjdCwgYnViYmxlLCBjaGVja19vdXRyb3MsIGNoaWxkcmVuLCBjbGFpbV9jb21wb25lbnQsIGNsYWltX2VsZW1lbnQsIGNsYWltX3NwYWNlLCBjbGFpbV90ZXh0LCBjbGVhcl9sb29wcywgY29tcG9uZW50X3N1YnNjcmliZSwgY29tcHV0ZV9yZXN0X3Byb3BzLCBjcmVhdGVFdmVudERpc3BhdGNoZXIsIGNyZWF0ZV9hbmltYXRpb24sIGNyZWF0ZV9iaWRpcmVjdGlvbmFsX3RyYW5zaXRpb24sIGNyZWF0ZV9jb21wb25lbnQsIGNyZWF0ZV9pbl90cmFuc2l0aW9uLCBjcmVhdGVfb3V0X3RyYW5zaXRpb24sIGNyZWF0ZV9zbG90LCBjcmVhdGVfc3NyX2NvbXBvbmVudCwgY3VycmVudF9jb21wb25lbnQsIGN1c3RvbV9ldmVudCwgZGF0YXNldF9kZXYsIGRlYnVnLCBkZXN0cm95X2Jsb2NrLCBkZXN0cm95X2NvbXBvbmVudCwgZGVzdHJveV9lYWNoLCBkZXRhY2gsIGRldGFjaF9hZnRlcl9kZXYsIGRldGFjaF9iZWZvcmVfZGV2LCBkZXRhY2hfYmV0d2Vlbl9kZXYsIGRldGFjaF9kZXYsIGRpcnR5X2NvbXBvbmVudHMsIGRpc3BhdGNoX2RldiwgZWFjaCwgZWxlbWVudCwgZWxlbWVudF9pcywgZW1wdHksIGVzY2FwZSwgZXNjYXBlZCwgZXhjbHVkZV9pbnRlcm5hbF9wcm9wcywgZml4X2FuZF9kZXN0cm95X2Jsb2NrLCBmaXhfYW5kX291dHJvX2FuZF9kZXN0cm95X2Jsb2NrLCBmaXhfcG9zaXRpb24sIGZsdXNoLCBnZXRDb250ZXh0LCBnZXRfYmluZGluZ19ncm91cF92YWx1ZSwgZ2V0X2N1cnJlbnRfY29tcG9uZW50LCBnZXRfc2xvdF9jaGFuZ2VzLCBnZXRfc2xvdF9jb250ZXh0LCBnZXRfc3ByZWFkX29iamVjdCwgZ2V0X3NwcmVhZF91cGRhdGUsIGdldF9zdG9yZV92YWx1ZSwgZ2xvYmFscywgZ3JvdXBfb3V0cm9zLCBoYW5kbGVfcHJvbWlzZSwgaGFzX3Byb3AsIGlkZW50aXR5LCBpbml0LCBpbnNlcnQsIGluc2VydF9kZXYsIGludHJvcywgaW52YWxpZF9hdHRyaWJ1dGVfbmFtZV9jaGFyYWN0ZXIsIGlzX2NsaWVudCwgaXNfY3Jvc3NvcmlnaW4sIGlzX2Z1bmN0aW9uLCBpc19wcm9taXNlLCBsaXN0ZW4sIGxpc3Rlbl9kZXYsIGxvb3AsIGxvb3BfZ3VhcmQsIG1pc3NpbmdfY29tcG9uZW50LCBtb3VudF9jb21wb25lbnQsIG5vb3AsIG5vdF9lcXVhbCwgbm93LCBudWxsX3RvX2VtcHR5LCBvYmplY3Rfd2l0aG91dF9wcm9wZXJ0aWVzLCBvbkRlc3Ryb3ksIG9uTW91bnQsIG9uY2UsIG91dHJvX2FuZF9kZXN0cm95X2Jsb2NrLCBwcmV2ZW50X2RlZmF1bHQsIHByb3BfZGV2LCBxdWVyeV9zZWxlY3Rvcl9hbGwsIHJhZiwgcnVuLCBydW5fYWxsLCBzYWZlX25vdF9lcXVhbCwgc2NoZWR1bGVfdXBkYXRlLCBzZWxlY3RfbXVsdGlwbGVfdmFsdWUsIHNlbGVjdF9vcHRpb24sIHNlbGVjdF9vcHRpb25zLCBzZWxlY3RfdmFsdWUsIHNlbGYsIHNldENvbnRleHQsIHNldF9hdHRyaWJ1dGVzLCBzZXRfY3VycmVudF9jb21wb25lbnQsIHNldF9jdXN0b21fZWxlbWVudF9kYXRhLCBzZXRfZGF0YSwgc2V0X2RhdGFfZGV2LCBzZXRfaW5wdXRfdHlwZSwgc2V0X2lucHV0X3ZhbHVlLCBzZXRfbm93LCBzZXRfcmFmLCBzZXRfc3RvcmVfdmFsdWUsIHNldF9zdHlsZSwgc2V0X3N2Z19hdHRyaWJ1dGVzLCBzcGFjZSwgc3ByZWFkLCBzdG9wX3Byb3BhZ2F0aW9uLCBzdWJzY3JpYmUsIHN2Z19lbGVtZW50LCB0ZXh0LCB0aWNrLCB0aW1lX3Jhbmdlc190b19hcnJheSwgdG9fbnVtYmVyLCB0b2dnbGVfY2xhc3MsIHRyYW5zaXRpb25faW4sIHRyYW5zaXRpb25fb3V0LCB1cGRhdGVfa2V5ZWRfZWFjaCwgdXBkYXRlX3Nsb3QsIHZhbGlkYXRlX2NvbXBvbmVudCwgdmFsaWRhdGVfZWFjaF9hcmd1bWVudCwgdmFsaWRhdGVfZWFjaF9rZXlzLCB2YWxpZGF0ZV9zbG90cywgdmFsaWRhdGVfc3RvcmUsIHhsaW5rX2F0dHIgfTtcbiIsIi8vIHBhdGggdG8gd2hlcmUgdGhlIGltYWdlcyBhcmUgZG93bmxvYWRlZFxyXG4vL2NvbnN0IENBUkRfREFUQSA9IHJlcXVpcmUoXCIuL3NjcnlmYWxsLWRlZmF1bHQtY2FyZHMuanNvblwiKTtcclxuXHJcbmZ1bmN0aW9uIHRpbWVvdXQoKSB7XHJcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICByZXNvbHZlKCk7XHJcbiAgICB9LCA3MCk7XHJcbiAgfSk7XHJcbn1cclxuXHJcbmNsYXNzIE10Z0ludGVyZmFjZSB7XHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5fX2NhY2hlID0ge307XHJcbiAgfVxyXG5cclxuICBzZWFyY2gob3B0cyA9IHt9KSB7XHJcbiAgICAvLyBodHRwczovL2FwaS5zY3J5ZmFsbC5jb20vY2FyZHMvc2VhcmNoP29yZGVyPWNtYyZxPWMlM0FyZWQrcG93JTNEMyBcclxuICAgIC8vIGh0dHBzOi8vc2NyeWZhbGwuY29tL3NlYXJjaD9hcz1ncmlkJm9yZGVyPW5hbWUmcT1teXIrb3JhY2xlJTNBdG9rZW4rdHlwZSUzQWNyZWF0dXJlK2NvbW1hbmRlciUzQVdVQlJHXHJcblxyXG4gICAgbGV0IGJhc2V1cmw7XHJcblxyXG4gICAgaWYgKHR5cGVvZiBvcHRzICE9IFwic3RyaW5nXCIpIHtcclxuICAgICAgYmFzZXVybCA9IGBodHRwczovL2FwaS5zY3J5ZmFsbC5jb20vY2FyZHMvc2VhcmNoPyR7b3B0cy5wYWdlP1wicGFnZT1cIitvcHRzLnBhZ2UrXCImXCI6XCJcIn1vcmRlcj1jbWMmcT1gO1xyXG4gICAgICBjb25zdCBxdWVyaWVzID0gW107XHJcblxyXG4gICAgICBpZiAob3B0cy5uYW1lKSB7XHJcbiAgICAgICAgcXVlcmllcy5wdXNoKG9wdHMubmFtZSk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChvcHRzLmVkaGNvbG9ycyAmJiBvcHRzLmVkaGNvbG9ycy5zaXplKSB7XHJcbiAgICAgICAgbGV0IGNzID0gXCJcIjtcclxuICAgICAgICBmb3IgKGxldCBjb2xvciBvZiBvcHRzLmVkaGNvbG9ycykge1xyXG4gICAgICAgICAgY29sb3IgPSBjb2xvci50b1VwcGVyQ2FzZSgpO1xyXG4gICAgICAgICAgaWYgKGNvbG9yID09PSBcIkNcIikge1xyXG4gICAgICAgICAgICBjcyA9IFwiQ1wiO1xyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGNzICs9IGNvbG9yO1xyXG4gICAgICAgIH1cclxuICAgICAgICBxdWVyaWVzLnB1c2goXCJjb21tYW5kZXIlM0FcIiArIGNzKTtcclxuICAgICAgfVxyXG5cclxuXHJcbiAgICAgIGlmIChvcHRzLnR5cGUpIHtcclxuICAgICAgICBxdWVyaWVzLnB1c2goXCJ0eXBlJTNBXCIgKyBvcHRzLnR5cGUpO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChvcHRzLnRleHQpIHtcclxuICAgICAgICBsZXQgdGV4dCA9IG9wdHMudGV4dC50cmltKCkucmVwbGFjZSgvXFxzKy9nbSwgXCIrb3JhY2xlJTNBXCIpO1xyXG4gICAgICAgIHF1ZXJpZXMucHVzaChcIm9yYWNsZSUzQVwiICsgb3B0cy50ZXh0KTtcclxuICAgICAgfVxyXG5cclxuICAgICAgYmFzZXVybCA9IGJhc2V1cmwgKyBxdWVyaWVzLmpvaW4oXCIrXCIpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgYmFzZXVybCA9IG9wdHM7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZmV0Y2goYmFzZXVybClcclxuICAgICAgLnRoZW4oYXN5bmMgcmVzcG9uc2UgPT4ge1xyXG4gICAgICAgIGNvbnN0IGEgPSBhd2FpdCByZXNwb25zZS5qc29uKCk7XHJcbiAgICAgICAgcmV0dXJuIGE7XHJcbiAgICAgIH0pXHJcbiAgICAgIC50aGVuKHJlc3BvbnNlID0+IHtcclxuICAgICAgICBmb3IgKGxldCBjIG9mIHJlc3BvbnNlLmRhdGEpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKFwiY1wiLCBjKTtcclxuICAgICAgICAgIGlmICghYy5pbWFnZV91cmlzKSB7XHJcbiAgICAgICAgICAgIGlmIChjLmNhcmRfZmFjZXMpIHtcclxuICAgICAgICAgICAgICBjLmltYWdlX3VyaXMgPSBjLmNhcmRfZmFjZXNbMF0uaW1hZ2VfdXJpcztcclxuICAgICAgICAgICAgICBjb25zdCBiaXUgPSBjLmNhcmRfZmFjZXNbMV0uaW1hZ2VfdXJpcztcclxuICAgICAgICAgICAgICBjLmJhY2tzaWRlID0gYml1ID8gYml1LmJvcmRlcl9jcm9wIHx8IGJpdS5ub3JtYWwgOiBcIlwiO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBjLnVybCA9IGMgPyBjLmltYWdlX3VyaXMuYm9yZGVyX2Nyb3AgfHwgYy5pbWFnZV91cmlzLm5vcm1hbCA6IFwiXCI7XHJcbiAgICAgICAgICB0aGlzLl9fY2FjaGVbYy5uYW1lXSA9IGM7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiByZXNwb25zZTtcclxuICAgICAgfSlcclxuICAgICAgLmNhdGNoKGUgPT4geyBjb25zb2xlLmxvZyhlKTsgcmV0dXJuIHsgY29kZTogXCJub3RfZm91bmRcIiwgZGF0YTogW10gfTsgfSk7XHJcblxyXG4gIH1cclxuXHJcbiAgYXN5bmMgY2FyZEJ5TmFtZShuYW1lKSB7XHJcbiAgICBpZiAodGhpcy5fX2NhY2hlW25hbWVdKSByZXR1cm4gdGhpcy5fX2NhY2hlW25hbWVdO1xyXG4gICAgYXdhaXQgdGltZW91dCgpO1xyXG4gICAgLy9odHRwczovL2FwaS5zY3J5ZmFsbC5jb20vY2FyZHMvbmFtZWQ/ZnV6enk9YXVzdCtjb20gXHJcbiAgICBjb25zdCBmaXhlZCA9IG5hbWUucmVwbGFjZSgvXFxzL2csIFwiK1wiKTtcclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGZldGNoKCdodHRwczovL2FwaS5zY3J5ZmFsbC5jb20vY2FyZHMvbmFtZWQ/ZnV6enk9JyArIGZpeGVkKVxyXG4gICAgICAudGhlbihyZXNwb25zZSA9PiByZXNwb25zZS5qc29uKCkpLmNhdGNoKGUgPT4geyBjb25zb2xlLmxvZyhlKTsgcmV0dXJuIHsgY29kZTogXCJub3RfZm91bmRcIiB9OyB9KTtcclxuXHJcbiAgICB0aGlzLl9fY2FjaGVbbmFtZV0gPSByZXN1bHQ7XHJcbiAgICB0aGlzLl9fY2FjaGVbcmVzdWx0Lm5hbWVdID0gcmVzdWx0O1xyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICAgIC8vIC50aGVuKGRhdGEgPT4gY29uc29sZS5sb2coZGF0YSkpO1xyXG4gICAgLyogZm9yIChsZXQgY2FyZCBvZiBDQVJEX0RBVEEpIHtcclxuICAgICAgIGlmIChjYXJkLm5hbWUudG9Mb3dlckNhc2UoKSA9PSBuYW1lLnRvTG93ZXJDYXNlKCkpIHJldHVybiBjYXJkO1xyXG4gICAgIH0qL1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgc29ydChkZWNrU3RyaW5nLCB1cGRhdGUgPSAoKSA9PiB7fSkge1xyXG4gICAgZGVja1N0cmluZyA9IGRlY2tTdHJpbmcucmVwbGFjZSgvIy4qL2dtLCBcIlwiKTtcclxuICAgIGNvbnN0IGRlY2tSYXcgPSBkZWNrU3RyaW5nLnRyaW0oKS5yZXBsYWNlKC9cXCgoLio/KVxcKXwoWzAtOV0qXFxuKS9nLCBcIlxcblwiKS5yZXBsYWNlKC9cXHMqXFxuK1xccypcXG4rL2csIFwiXFxuXCIpLnNwbGl0KFwiXFxuXCIpO1xyXG5cclxuICAgIGxldCBjcmVhdHVyZXMgPSB7fTtcclxuICAgIGxldCBzcGVsbHMgPSB7fTtcclxuICAgIGxldCBsYW5kcyA9IHt9O1xyXG4gICAgbGV0IG1heWJlID0gW107XHJcbiAgICBjb25zdCBlcnJvcnMgPSBbXTtcclxuXHJcblxyXG4gICAgbGV0IHByb2dyZXNzID0gMDtcclxuICAgIGZvciAobGV0IGNhcmQgb2YgZGVja1Jhdykge1xyXG5cclxuICAgICAgbGV0IGNvdW50ID0gTWF0aC5mbG9vcigoKGNhcmQubWF0Y2goLyhcXGQrKS8pIHx8IFtdKVswXSB8fCAxKSk7XHJcbiAgICAgIGlmIChpc05hTihjb3VudCkpIHtcclxuICAgICAgICBjb3VudCA9IDE7XHJcbiAgICAgIH1cclxuICAgICAgcHJvZ3Jlc3MrKztcclxuXHJcbiAgICAgIGlmIChjYXJkLnRyaW0oKS5zdGFydHNXaXRoKFwiLy9cIikpIHtcclxuICAgICAgICBtYXliZS5wdXNoKGNhcmQudHJpbSgpKTtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IG5hbWUgPSBjYXJkLnJlcGxhY2UoLyhcXGQrKS8sIFwiXCIpLnRyaW0oKTtcclxuICAgICAgaWYgKCFuYW1lKSBjb250aW51ZTsgLy8gY2FudCB3b3JrIHdpdGggdGhpcyBkYXRhXHJcbiAgICAgIC8vIHNlYXJjaCB0aGUgYWNjb3JkaW5nIGRhdGFcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBsZXQgZGF0YSA9IGF3YWl0IHRoaXMuY2FyZEJ5TmFtZShuYW1lKTtcclxuXHJcbiAgICAgICAgaWYgKGRhdGEudHlwZV9saW5lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJsYW5kXCIpKSB7XHJcbiAgICAgICAgICBsYW5kc1tkYXRhLm5hbWVdID0gbGFuZHNbZGF0YS5uYW1lXSB8fCB7IGRhdGEsIGNvdW50OiAwLCBuYW1lOiBkYXRhLm5hbWUgfTtcclxuICAgICAgICAgIGxhbmRzW2RhdGEubmFtZV0uY291bnQrKztcclxuICAgICAgICB9IGVsc2UgaWYgKGRhdGEudHlwZV9saW5lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJjcmVhdHVyZVwiKSkge1xyXG4gICAgICAgICAgY3JlYXR1cmVzW2RhdGEubmFtZV0gPSBjcmVhdHVyZXNbZGF0YS5uYW1lXSB8fCB7IGRhdGEsIGNvdW50OiAwLCBuYW1lOiBkYXRhLm5hbWUgfTtcclxuICAgICAgICAgIGNyZWF0dXJlc1tkYXRhLm5hbWVdLmNvdW50Kys7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIHNwZWxsc1tkYXRhLm5hbWVdID0gc3BlbGxzW2RhdGEubmFtZV0gfHwgeyBkYXRhLCBjb3VudDogMCwgbmFtZTogZGF0YS5uYW1lIH07XHJcbiAgICAgICAgICBzcGVsbHNbZGF0YS5uYW1lXS5jb3VudCsrO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBlcnJvcnMucHVzaChuYW1lKTtcclxuICAgICAgfVxyXG4gICAgICB1cGRhdGUocHJvZ3Jlc3MsIGRlY2tSYXcubGVuZ3RoKTtcclxuICAgIH1cclxuXHJcbiAgICBjcmVhdHVyZXMgPSBPYmplY3QudmFsdWVzKGNyZWF0dXJlcykuc29ydCgoYSwgYikgPT4gYS5kYXRhLmNtYyA+IGIuZGF0YS5jbWMgPyAxIDogLTEpO1xyXG4gICAgc3BlbGxzID0gT2JqZWN0LnZhbHVlcyhzcGVsbHMpLnNvcnQoKGEsIGIpID0+IGEuZGF0YS5jbWMgPiBiLmRhdGEuY21jID8gMSA6IC0xKTtcclxuICAgIGxhbmRzID0gT2JqZWN0LnZhbHVlcyhsYW5kcykuc29ydCgoYSwgYikgPT4gYS5uYW1lID4gYi5uYW1lID8gMSA6IC0xKTtcclxuICAgIGxldCBvdXRwdXQgPSBcIiMgQ3JlYXR1cmVzXCI7XHJcbiAgICBmb3IgKGxldCBjdXIgb2YgY3JlYXR1cmVzKSB7XHJcbiAgICAgIG91dHB1dCArPSBcIlxcblwiICsgY3VyLmNvdW50ICsgXCIgXCIgKyBjdXIubmFtZTtcclxuICAgIH1cclxuICAgIG91dHB1dCArPSBcIlxcblxcbiMgU3BlbGxzXCI7XHJcbiAgICBmb3IgKGxldCBjdXIgb2Ygc3BlbGxzKSB7XHJcbiAgICAgIG91dHB1dCArPSBcIlxcblwiICsgY3VyLmNvdW50ICsgXCIgXCIgKyBjdXIubmFtZTtcclxuICAgIH1cclxuXHJcbiAgICBvdXRwdXQgKz0gXCJcXG5cXG4jIExhbmRzXCJcclxuICAgIGZvciAobGV0IGN1ciBvZiBsYW5kcykge1xyXG4gICAgICBvdXRwdXQgKz0gXCJcXG5cIiArIGN1ci5jb3VudCArIFwiIFwiICsgY3VyLm5hbWU7XHJcbiAgICB9XHJcblxyXG4gICAgb3V0cHV0ICs9IFwiXFxuXFxuIyBNYXliZVwiXHJcbiAgICBmb3IgKGxldCBjdXIgb2YgbWF5YmUpIHtcclxuICAgICAgb3V0cHV0ICs9IFwiXFxuLy9cIiArIGN1cjtcclxuICAgIH1cclxuXHJcbiAgICBvdXRwdXQgKz0gXCJcXG5cXG4jIE5vdCBGb3VuZFwiXHJcbiAgICBmb3IgKGxldCBjdXIgb2YgZXJyb3JzKSB7XHJcbiAgICAgIG91dHB1dCArPSBcIlxcbi8vXCIgKyBjdXIuY291bnQgKyBcIiBcIiArIGN1ci5uYW1lO1xyXG4gICAgfVxyXG5cclxuXHJcbiAgICByZXR1cm4gb3V0cHV0O1xyXG4gIH1cclxuXHJcblxyXG4gIC8qKlxyXG4gICAqIGNvbnZlcnRzIGEgZGVjayBzdHJpbmcgdG8gYSByZWFkYWJsZSBvYmplY3RcclxuICAgKiBhbmQgZG93bmxvYWRzIHRoZSBpbWcgZGF0YSBvbiBkZW1hbmQsIGlmIGl0IGRvZXMgbm90IGV4aXN0XHJcbiAgICpcclxuICAgKiBAcGFyYW0ge1N0cmluZ30gZGVja1N0cmluZyB0aGUgY29tcGxldGUgZGVjaywgY29waWVkIGZyb20gYSBzaXRlIG9yIGUuZyBmb3JnZVxyXG4gICAqIEBtZW1iZXJvZiBNdGdJbnRlcmZhY2VcclxuICAgKi9cclxuICBhc3luYyBjcmVhdGVEZWNrKGRlY2tTdHJpbmcsIHVwZGF0ZSA9ICgpID0+IHt9LCBzb3J0ID0gZmFsc2UpIHtcclxuICAgIC8vIGNvbnZlcnQgdGhlIGRlY2sgc3RyaW5nIHRvIGFuIGFycmF5XHJcblxyXG5cclxuXHJcblxyXG5cclxuXHJcblxyXG4gICAgbGV0IGdyb3VwcyA9IFsuLi5kZWNrU3RyaW5nLm1hdGNoKC8jKC4qPykoXFxufCQpL2cpIHx8IFtcIm1haW5cIl1dO1xyXG4gICAgY29uc3QgZGVja1JhdyA9IGRlY2tTdHJpbmcudHJpbSgpLnJlcGxhY2UoL1xcKCguKj8pXFwpfChbMC05XSpcXG4pL2csIFwiXFxuXCIpLnJlcGxhY2UoL1xccypcXG4rXFxzKlxcbisvZywgXCJcXG5cIikuc3BsaXQoXCJcXG5cIik7XHJcbiAgICBpZiAoIWRlY2tSYXcpIHJldHVybiBbXTtcclxuICAgIGlmICghZGVja1Jhd1swXS5pbmNsdWRlcyhcIiNcIikpIHtcclxuICAgICAgaWYgKGdyb3Vwc1swXSAhPT0gXCJtYWluXCIpIHtcclxuICAgICAgICBncm91cHMgPSBbXCJtYWluXCJdLmNvbmNhdChncm91cHMpO1xyXG4gICAgICB9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBkZWNrUmF3LnNoaWZ0KCk7XHJcbiAgICB9XHJcblxyXG5cclxuICAgIGdyb3VwcyA9IGdyb3Vwcy5tYXAodiA9PiB7IHJldHVybiB7IGRlY2s6IHt9LCBuYW1lOiB2LnJlcGxhY2UoXCIjXCIsIFwiXCIpLnRyaW0oKSB9IH0pO1xyXG5cclxuICAgIGxldCBjdXJHcm91cCA9IDA7XHJcblxyXG4gICAgbGV0IHByb2dyZXNzID0gMDtcclxuICAgIGxldCBpZ25vcmVkID0gMDtcclxuICAgIC8vIGl0ZXJhdGUgZWFjaCBmb3VuZCBjYXJkXHJcbiAgICBmb3IgKGxldCBjYXJkIG9mIGRlY2tSYXcpIHtcclxuICAgICAgaWYgKCFjYXJkKSBjb250aW51ZTtcclxuICAgICAgaWYgKGNhcmQudHJpbSgpLnN0YXJ0c1dpdGgoXCIvL1wiKSkgY29udGludWU7XHJcbiAgICAgIGlmIChjYXJkLmluY2x1ZGVzKFwiI1wiKSkge1xyXG4gICAgICAgIGN1ckdyb3VwKys7XHJcbiAgICAgICAgaWYgKGN1ckdyb3VwID4gZ3JvdXBzLmxlbmd0aCkgY3VyR3JvdXAgPSAwO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcbiAgICAgIHByb2dyZXNzKys7XHJcblxyXG4gICAgICBjb25zdCBkZWNrID0gZ3JvdXBzW2N1ckdyb3VwXS5kZWNrO1xyXG4gICAgICB1cGRhdGUocHJvZ3Jlc3MsIGRlY2tSYXcubGVuZ3RoIC0gZ3JvdXBzLmxlbmd0aCArIDEgLSBpZ25vcmVkKTtcclxuICAgICAgLy8gZXh0cmFjdCB0aGUgY291bnQgZnJvbSB0aGUgc3RyaW5nIGFuZCBmcmVlIHRoZSBuYW1lXHJcblxyXG4gICAgICBsZXQgY291bnQgPSBNYXRoLmZsb29yKCgoY2FyZC5tYXRjaCgvKFxcZCspLykgfHwgW10pWzBdIHx8IDEpKTtcclxuICAgICAgaWYgKGlzTmFOKGNvdW50KSkge1xyXG4gICAgICAgIGNvdW50ID0gMTtcclxuICAgICAgfVxyXG4gICAgICBjb25zdCBuYW1lID0gY2FyZC5yZXBsYWNlKC8oXFxkKykvLCBcIlwiKS50cmltKCk7XHJcbiAgICAgIGlmICghbmFtZSkgY29udGludWU7IC8vIGNhbnQgd29yayB3aXRoIHRoaXMgZGF0YVxyXG4gICAgICAvLyBzZWFyY2ggdGhlIGFjY29yZGluZyBkYXRhXHJcbiAgICAgIGxldCBkYXRhID0gYXdhaXQgdGhpcy5jYXJkQnlOYW1lKG5hbWUpO1xyXG5cclxuICAgICAgaWYgKGRhdGEubmFtZSlcclxuICAgICAgICBkZWNrU3RyaW5nID0gZGVja1N0cmluZy5yZXBsYWNlKG5hbWUsIGRhdGEubmFtZSk7XHJcbiAgICAgIGlmIChkYXRhLmNvZGUgPT0gXCJub3RfZm91bmRcIikge1xyXG4gICAgICAgIGRhdGEgPSB7IGltYWdlX3VyaXM6IHt9LCBsZWdhbGl0aWVzOiB7fSwgcHJpY2VzOiB7IHVzZDogMCB9LCBtYW5hX2Nvc3Q6IFwiXCIsIGNtYzogMCwgdHlwZV9saW5lOiBcImxhbmRcIiB9O1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChkZWNrW25hbWVdKSB7XHJcbiAgICAgICAgZGVja1tuYW1lXS5jb3VudCArPSBjb3VudDtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICAvLyB3cmFwIGRhdGEgaW4gZWFzeSByZWFkYWJsZSBmb3JtYXRcclxuICAgICAgICBsZXQgYmFja3NpZGUgPSBcIlwiO1xyXG4gICAgICAgIGlmICghZGF0YS5pbWFnZV91cmlzKSB7XHJcbiAgICAgICAgICBpZiAoZGF0YS5jYXJkX2ZhY2VzKSB7XHJcbiAgICAgICAgICAgIGRhdGEuaW1hZ2VfdXJpcyA9IGRhdGEuY2FyZF9mYWNlc1swXS5pbWFnZV91cmlzO1xyXG4gICAgICAgICAgICBjb25zdCBiaXUgPSBkYXRhLmNhcmRfZmFjZXNbMV0uaW1hZ2VfdXJpcztcclxuICAgICAgICAgICAgYmFja3NpZGUgPSBiaXUgPyBiaXUuYm9yZGVyX2Nyb3AgfHwgYml1Lm5vcm1hbCA6IFwiXCI7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhcImVyclwiLCBkYXRhKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHVybCA9IGRhdGEgPyBkYXRhLmltYWdlX3VyaXMuYm9yZGVyX2Nyb3AgfHwgZGF0YS5pbWFnZV91cmlzLm5vcm1hbCA6IFwiXCI7XHJcbiAgICAgICAgZGVja1tuYW1lXSA9IHtcclxuICAgICAgICAgIG5hbWUsXHJcbiAgICAgICAgICBjb3VudCxcclxuICAgICAgICAgIHVybCxcclxuICAgICAgICAgIGJhY2tzaWRlLFxyXG4gICAgICAgICAgZGF0YVxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIGxldCBsYW5kQ291bnQgPSAwO1xyXG4gICAgY29uc3Qgb3ZlcmFsbERldm90aW9uID0ge1xyXG4gICAgICBibHVlOiAwLFxyXG4gICAgICBibGFjazogMCxcclxuICAgICAgcmVkOiAwLFxyXG4gICAgICB3aGl0ZTogMCxcclxuICAgICAgZ3JlZW46IDAsXHJcbiAgICAgIGNvbG9ybGVzczogMCxcclxuICAgICAgZ2VuZXJpYzogMCxcclxuICAgICAgc3VtOiAwXHJcbiAgICB9O1xyXG4gICAgY29uc3Qgb3ZlcmFsbE1hbmFDdXJ2ZSA9IFtdO1xyXG4gICAgLy9tYW5hX2Nvc3Q6IFwie1d9e1V9e0J9e1J9e0d9IHtDfVwiXHJcblxyXG4gICAgbGV0IG92ZXJhbGxDb3VudCA9IDA7XHJcbiAgICBsZXQgb3ZlcmFsbENvc3QgPSAwO1xyXG5cclxuICAgIGxldCBjcmVhdHVyZUNvdW50ID0gMDtcclxuICAgIGxldCBpbnN0YW50Q291bnQgPSAwO1xyXG4gICAgbGV0IGVuY2hhbnRtZW50Q291bnQgPSAwO1xyXG4gICAgbGV0IGFydGlmYWN0Q291bnQgPSAwO1xyXG5cclxuICAgIC8vbWFuYV9jb3N0LnNwbGl0KFwiR1wiKS5sZW5ndGggLSAxXHJcbiAgICBmb3IgKGxldCBncm91cCBvZiBncm91cHMpIHtcclxuXHJcbiAgICAgIGdyb3VwLmNhcmRzID0gT2JqZWN0LnZhbHVlcyhncm91cC5kZWNrKTtcclxuICAgICAgZ3JvdXAuY2FyZHMgPSBncm91cC5jYXJkcy5zb3J0KChhLCBiKSA9PiBhLmRhdGEuY21jID4gYi5kYXRhLmNtYyA/IDEgOiAtMSk7XHJcblxyXG4gICAgICBsZXQgY291bnQgPSAwO1xyXG4gICAgICBsZXQgY29zdCA9IDA7XHJcbiAgICAgIGNvbnN0IGlzTWF5YmUgPSBncm91cC5uYW1lLnRvTG93ZXJDYXNlKCkgPT0gXCJtYXliZVwiO1xyXG5cclxuXHJcbiAgICAgIGNvbnN0IGRldm90aW9uID0ge1xyXG4gICAgICAgIGJsdWU6IDAsXHJcbiAgICAgICAgYmxhY2s6IDAsXHJcbiAgICAgICAgcmVkOiAwLFxyXG4gICAgICAgIHdoaXRlOiAwLFxyXG4gICAgICAgIGdyZWVuOiAwLFxyXG4gICAgICAgIGNvbG9ybGVzczogMCxcclxuICAgICAgICBnZW5lcmljOiAwLFxyXG4gICAgICAgIHN1bTogMFxyXG4gICAgICB9O1xyXG4gICAgICBjb25zdCBtYW5hQ3VydmUgPSBbXTtcclxuICAgICAgZm9yIChsZXQgY2FyZCBvZiBncm91cC5jYXJkcykge1xyXG4gICAgICAgIGNvdW50ICs9IGNhcmQuY291bnQ7XHJcblxyXG4gICAgICAgIGNvc3QgKz0gcGFyc2VGbG9hdChjYXJkLmRhdGEucHJpY2VzLnVzZCB8fCAwKSAqIGNhcmQuY291bnQ7XHJcblxyXG4gICAgICAgIGlmIChjYXJkLmRhdGEudHlwZV9saW5lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJsYW5kXCIpKSB7XHJcbiAgICAgICAgICBsYW5kQ291bnQgKz0gY2FyZC5jb3VudDtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgbWFuYUN1cnZlW2NhcmQuZGF0YS5jbWMgfHwgMF0gPSAobWFuYUN1cnZlW2NhcmQuZGF0YS5jbWMgfHwgMF0gfHwgMCkgKyBjYXJkLmNvdW50O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKCFpc01heWJlKSB7XHJcbiAgICAgICAgICBpZiAoY2FyZC5kYXRhLnR5cGVfbGluZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKFwiY3JlYXR1cmVcIikpIHtcclxuICAgICAgICAgICAgY3JlYXR1cmVDb3VudCArPSBjYXJkLmNvdW50O1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgaWYgKGNhcmQuZGF0YS50eXBlX2xpbmUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhcImFydGlmYWN0XCIpKSB7XHJcbiAgICAgICAgICAgIGFydGlmYWN0Q291bnQgKz0gY2FyZC5jb3VudDtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGlmIChjYXJkLmRhdGEudHlwZV9saW5lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJlbmNoYW50bWVudFwiKSkge1xyXG4gICAgICAgICAgICBlbmNoYW50bWVudENvdW50ICs9IGNhcmQuY291bnQ7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBpZiAoY2FyZC5kYXRhLnR5cGVfbGluZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKFwiaW5zdGFudFwiKSkge1xyXG4gICAgICAgICAgICBpbnN0YW50Q291bnQgKz0gY2FyZC5jb3VudDtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGlmIChjYXJkLmRhdGEudHlwZV9saW5lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJzb3JjZXJ5XCIpKSB7XHJcbiAgICAgICAgICAgIGNyZWF0dXJlQ291bnQgKz0gY2FyZC5jb3VudDtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG5cclxuICAgICAgICBjYXJkLmRhdGEubWFuYV9jb3N0ID0gY2FyZC5kYXRhLm1hbmFfY29zdCB8fCBcIlwiO1xyXG4gICAgICAgIGRldm90aW9uLmJsdWUgKz0gKGNhcmQuZGF0YS5tYW5hX2Nvc3Quc3BsaXQoXCJVXCIpLmxlbmd0aCAtIDEpICogY2FyZC5jb3VudDtcclxuICAgICAgICBkZXZvdGlvbi5ibGFjayArPSAoY2FyZC5kYXRhLm1hbmFfY29zdC5zcGxpdChcIkJcIikubGVuZ3RoIC0gMSkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIGRldm90aW9uLnJlZCArPSAoY2FyZC5kYXRhLm1hbmFfY29zdC5zcGxpdChcIlJcIikubGVuZ3RoIC0gMSkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIGRldm90aW9uLndoaXRlICs9IChjYXJkLmRhdGEubWFuYV9jb3N0LnNwbGl0KFwiV1wiKS5sZW5ndGggLSAxKSAqIGNhcmQuY291bnQ7XHJcbiAgICAgICAgZGV2b3Rpb24uZ3JlZW4gKz0gKGNhcmQuZGF0YS5tYW5hX2Nvc3Quc3BsaXQoXCJHXCIpLmxlbmd0aCAtIDEpICogY2FyZC5jb3VudDtcclxuICAgICAgICBkZXZvdGlvbi5jb2xvcmxlc3MgKz0gKGNhcmQuZGF0YS5tYW5hX2Nvc3Quc3BsaXQoXCJDXCIpLmxlbmd0aCAtIDEpICogY2FyZC5jb3VudDtcclxuICAgICAgICBkZXZvdGlvbi5nZW5lcmljICs9IE1hdGguZmxvb3IoY2FyZC5kYXRhLm1hbmFfY29zdC5yZXBsYWNlKC9bXjAtOS5dL2csIFwiXCIpIHx8IDApICogY2FyZC5jb3VudDtcclxuICAgICAgICBkZXZvdGlvbi5zdW0gPSBkZXZvdGlvbi5ibHVlICsgZGV2b3Rpb24uYmxhY2sgKyBkZXZvdGlvbi5yZWQgKyBkZXZvdGlvbi5ncmVlbiArIGRldm90aW9uLndoaXRlICsgZGV2b3Rpb24uY29sb3JsZXNzICsgZGV2b3Rpb24uZ2VuZXJpYztcclxuICAgICAgfVxyXG5cclxuXHJcblxyXG4gICAgICBncm91cC5jb3VudCA9IGNvdW50O1xyXG4gICAgICBncm91cC5tYW5hID0gZGV2b3Rpb247XHJcbiAgICAgIGdyb3VwLmNvc3QgPSBjb3N0O1xyXG5cclxuICAgICAgZ3JvdXAubWFuYUN1cnZlID0gbWFuYUN1cnZlO1xyXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG1hbmFDdXJ2ZS5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIG1hbmFDdXJ2ZVtpXSA9IG1hbmFDdXJ2ZVtpXSB8fCAwO1xyXG4gICAgICAgIGlmIChpc01heWJlKSBjb250aW51ZTtcclxuICAgICAgICBvdmVyYWxsTWFuYUN1cnZlW2ldID0gKG92ZXJhbGxNYW5hQ3VydmVbaV0gfHwgMCkgKyAobWFuYUN1cnZlW2ldIHx8IDApO1xyXG4gICAgICB9XHJcbiAgICAgIGlmICghaXNNYXliZSkge1xyXG5cclxuICAgICAgICBvdmVyYWxsQ29zdCArPSBjb3N0O1xyXG4gICAgICAgIG92ZXJhbGxDb3VudCArPSBjb3VudDtcclxuXHJcbiAgICAgICAgb3ZlcmFsbERldm90aW9uLmJsdWUgKz0gZGV2b3Rpb24uYmx1ZTtcclxuICAgICAgICBvdmVyYWxsRGV2b3Rpb24uYmxhY2sgKz0gZGV2b3Rpb24uYmxhY2s7XHJcbiAgICAgICAgb3ZlcmFsbERldm90aW9uLnJlZCArPSBkZXZvdGlvbi5yZWQ7XHJcbiAgICAgICAgb3ZlcmFsbERldm90aW9uLndoaXRlICs9IGRldm90aW9uLndoaXRlO1xyXG4gICAgICAgIG92ZXJhbGxEZXZvdGlvbi5ncmVlbiArPSBkZXZvdGlvbi5ncmVlbjtcclxuICAgICAgICBvdmVyYWxsRGV2b3Rpb24uY29sb3JsZXNzICs9IGRldm90aW9uLmNvbG9ybGVzcztcclxuXHJcbiAgICAgICAgb3ZlcmFsbERldm90aW9uLmdlbmVyaWMgKz0gZGV2b3Rpb24uZ2VuZXJpYztcclxuICAgICAgICBvdmVyYWxsRGV2b3Rpb24uc3VtICs9IGRldm90aW9uLnN1bTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgb3ZlcmFsbE1hbmFDdXJ2ZS5sZW5ndGg7IGkrKykge1xyXG4gICAgICBvdmVyYWxsTWFuYUN1cnZlW2ldID0gb3ZlcmFsbE1hbmFDdXJ2ZVtpXSB8fCAwO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG5vbmxhbmRzID0gb3ZlcmFsbENvdW50IC0gbGFuZENvdW50O1xyXG5cclxuICAgIGxldCBqdXN0RGV2b3Rpb24gPSBvdmVyYWxsRGV2b3Rpb24uYmx1ZSArIG92ZXJhbGxEZXZvdGlvbi5ibGFjayArIG92ZXJhbGxEZXZvdGlvbi5yZWQgKyBvdmVyYWxsRGV2b3Rpb24ud2hpdGUgKyBvdmVyYWxsRGV2b3Rpb24uZ3JlZW4gKyBvdmVyYWxsRGV2b3Rpb24uY29sb3JsZXNzO1xyXG4gICAganVzdERldm90aW9uID0ganVzdERldm90aW9uIHx8IDE7XHJcbiAgICBjb25zdCBtYW5hUHJvcG9zYWwgPSB7XHJcbiAgICAgIGJsdWU6IG92ZXJhbGxEZXZvdGlvbi5ibHVlIC8ganVzdERldm90aW9uLFxyXG4gICAgICBibGFjazogb3ZlcmFsbERldm90aW9uLmJsYWNrIC8ganVzdERldm90aW9uLFxyXG4gICAgICByZWQ6IG92ZXJhbGxEZXZvdGlvbi5yZWQgLyBqdXN0RGV2b3Rpb24sXHJcbiAgICAgIHdoaXRlOiBvdmVyYWxsRGV2b3Rpb24ud2hpdGUgLyBqdXN0RGV2b3Rpb24sXHJcbiAgICAgIGdyZWVuOiBvdmVyYWxsRGV2b3Rpb24uZ3JlZW4gLyBqdXN0RGV2b3Rpb24sXHJcbiAgICAgIGNvbG9ybGVzczogb3ZlcmFsbERldm90aW9uLmNvbG9ybGVzcyAvIGp1c3REZXZvdGlvbixcclxuICAgIH07XHJcblxyXG4gICAgZ3JvdXBzW1wibWFuYVByb3Bvc2FsXCJdID0gbWFuYVByb3Bvc2FsO1xyXG5cclxuICAgIGdyb3Vwc1tcImxhbmRDb3VudFwiXSA9IGxhbmRDb3VudDtcclxuICAgIGdyb3Vwc1tcImNhcmRDb3VudFwiXSA9IG92ZXJhbGxDb3VudDtcclxuICAgIGdyb3Vwc1tcImF2ZXJhZ2VNYW5hXCJdID0gb3ZlcmFsbERldm90aW9uLnN1bSAvIChvdmVyYWxsQ291bnQgLSBsYW5kQ291bnQpO1xyXG4gICAgZ3JvdXBzW1wiY29zdFwiXSA9IG92ZXJhbGxDb3N0O1xyXG4gICAgZ3JvdXBzW1wibWFuYVwiXSA9IG92ZXJhbGxEZXZvdGlvbjtcclxuICAgIGdyb3Vwc1tcImNvcnJlY3RlZFwiXSA9IGRlY2tTdHJpbmc7XHJcbiAgICBncm91cHNbXCJtYW5hQ3VydmVcIl0gPSBvdmVyYWxsTWFuYUN1cnZlO1xyXG5cclxuXHJcbiAgICBncm91cHNbXCJjcmVhdHVyZUNvdW50XCJdID0gY3JlYXR1cmVDb3VudDtcclxuICAgIGdyb3Vwc1tcImluc3RhbnRDb3VudFwiXSA9IGluc3RhbnRDb3VudDtcclxuICAgIGdyb3Vwc1tcImVuY2hhbnRtZW50Q291bnRcIl0gPSBlbmNoYW50bWVudENvdW50O1xyXG4gICAgZ3JvdXBzW1wiYXJ0aWZhY3RDb3VudFwiXSA9IGFydGlmYWN0Q291bnQ7XHJcbiAgICByZXR1cm4gZ3JvdXBzO1xyXG4gIH1cclxufVxyXG5cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gbmV3IE10Z0ludGVyZmFjZSgpOyIsIi8qIVxuICogSmF2YVNjcmlwdCBDb29raWUgdjIuMi4xXG4gKiBodHRwczovL2dpdGh1Yi5jb20vanMtY29va2llL2pzLWNvb2tpZVxuICpcbiAqIENvcHlyaWdodCAyMDA2LCAyMDE1IEtsYXVzIEhhcnRsICYgRmFnbmVyIEJyYWNrXG4gKiBSZWxlYXNlZCB1bmRlciB0aGUgTUlUIGxpY2Vuc2VcbiAqL1xuOyhmdW5jdGlvbiAoZmFjdG9yeSkge1xuXHR2YXIgcmVnaXN0ZXJlZEluTW9kdWxlTG9hZGVyO1xuXHRpZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKSB7XG5cdFx0ZGVmaW5lKGZhY3RvcnkpO1xuXHRcdHJlZ2lzdGVyZWRJbk1vZHVsZUxvYWRlciA9IHRydWU7XG5cdH1cblx0aWYgKHR5cGVvZiBleHBvcnRzID09PSAnb2JqZWN0Jykge1xuXHRcdG1vZHVsZS5leHBvcnRzID0gZmFjdG9yeSgpO1xuXHRcdHJlZ2lzdGVyZWRJbk1vZHVsZUxvYWRlciA9IHRydWU7XG5cdH1cblx0aWYgKCFyZWdpc3RlcmVkSW5Nb2R1bGVMb2FkZXIpIHtcblx0XHR2YXIgT2xkQ29va2llcyA9IHdpbmRvdy5Db29raWVzO1xuXHRcdHZhciBhcGkgPSB3aW5kb3cuQ29va2llcyA9IGZhY3RvcnkoKTtcblx0XHRhcGkubm9Db25mbGljdCA9IGZ1bmN0aW9uICgpIHtcblx0XHRcdHdpbmRvdy5Db29raWVzID0gT2xkQ29va2llcztcblx0XHRcdHJldHVybiBhcGk7XG5cdFx0fTtcblx0fVxufShmdW5jdGlvbiAoKSB7XG5cdGZ1bmN0aW9uIGV4dGVuZCAoKSB7XG5cdFx0dmFyIGkgPSAwO1xuXHRcdHZhciByZXN1bHQgPSB7fTtcblx0XHRmb3IgKDsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKykge1xuXHRcdFx0dmFyIGF0dHJpYnV0ZXMgPSBhcmd1bWVudHNbIGkgXTtcblx0XHRcdGZvciAodmFyIGtleSBpbiBhdHRyaWJ1dGVzKSB7XG5cdFx0XHRcdHJlc3VsdFtrZXldID0gYXR0cmlidXRlc1trZXldO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRyZXR1cm4gcmVzdWx0O1xuXHR9XG5cblx0ZnVuY3Rpb24gZGVjb2RlIChzKSB7XG5cdFx0cmV0dXJuIHMucmVwbGFjZSgvKCVbMC05QS1aXXsyfSkrL2csIGRlY29kZVVSSUNvbXBvbmVudCk7XG5cdH1cblxuXHRmdW5jdGlvbiBpbml0IChjb252ZXJ0ZXIpIHtcblx0XHRmdW5jdGlvbiBhcGkoKSB7fVxuXG5cdFx0ZnVuY3Rpb24gc2V0IChrZXksIHZhbHVlLCBhdHRyaWJ1dGVzKSB7XG5cdFx0XHRpZiAodHlwZW9mIGRvY3VtZW50ID09PSAndW5kZWZpbmVkJykge1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGF0dHJpYnV0ZXMgPSBleHRlbmQoe1xuXHRcdFx0XHRwYXRoOiAnLydcblx0XHRcdH0sIGFwaS5kZWZhdWx0cywgYXR0cmlidXRlcyk7XG5cblx0XHRcdGlmICh0eXBlb2YgYXR0cmlidXRlcy5leHBpcmVzID09PSAnbnVtYmVyJykge1xuXHRcdFx0XHRhdHRyaWJ1dGVzLmV4cGlyZXMgPSBuZXcgRGF0ZShuZXcgRGF0ZSgpICogMSArIGF0dHJpYnV0ZXMuZXhwaXJlcyAqIDg2NGUrNSk7XG5cdFx0XHR9XG5cblx0XHRcdC8vIFdlJ3JlIHVzaW5nIFwiZXhwaXJlc1wiIGJlY2F1c2UgXCJtYXgtYWdlXCIgaXMgbm90IHN1cHBvcnRlZCBieSBJRVxuXHRcdFx0YXR0cmlidXRlcy5leHBpcmVzID0gYXR0cmlidXRlcy5leHBpcmVzID8gYXR0cmlidXRlcy5leHBpcmVzLnRvVVRDU3RyaW5nKCkgOiAnJztcblxuXHRcdFx0dHJ5IHtcblx0XHRcdFx0dmFyIHJlc3VsdCA9IEpTT04uc3RyaW5naWZ5KHZhbHVlKTtcblx0XHRcdFx0aWYgKC9eW1xce1xcW10vLnRlc3QocmVzdWx0KSkge1xuXHRcdFx0XHRcdHZhbHVlID0gcmVzdWx0O1xuXHRcdFx0XHR9XG5cdFx0XHR9IGNhdGNoIChlKSB7fVxuXG5cdFx0XHR2YWx1ZSA9IGNvbnZlcnRlci53cml0ZSA/XG5cdFx0XHRcdGNvbnZlcnRlci53cml0ZSh2YWx1ZSwga2V5KSA6XG5cdFx0XHRcdGVuY29kZVVSSUNvbXBvbmVudChTdHJpbmcodmFsdWUpKVxuXHRcdFx0XHRcdC5yZXBsYWNlKC8lKDIzfDI0fDI2fDJCfDNBfDNDfDNFfDNEfDJGfDNGfDQwfDVCfDVEfDVFfDYwfDdCfDdEfDdDKS9nLCBkZWNvZGVVUklDb21wb25lbnQpO1xuXG5cdFx0XHRrZXkgPSBlbmNvZGVVUklDb21wb25lbnQoU3RyaW5nKGtleSkpXG5cdFx0XHRcdC5yZXBsYWNlKC8lKDIzfDI0fDI2fDJCfDVFfDYwfDdDKS9nLCBkZWNvZGVVUklDb21wb25lbnQpXG5cdFx0XHRcdC5yZXBsYWNlKC9bXFwoXFwpXS9nLCBlc2NhcGUpO1xuXG5cdFx0XHR2YXIgc3RyaW5naWZpZWRBdHRyaWJ1dGVzID0gJyc7XG5cdFx0XHRmb3IgKHZhciBhdHRyaWJ1dGVOYW1lIGluIGF0dHJpYnV0ZXMpIHtcblx0XHRcdFx0aWYgKCFhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdKSB7XG5cdFx0XHRcdFx0Y29udGludWU7XG5cdFx0XHRcdH1cblx0XHRcdFx0c3RyaW5naWZpZWRBdHRyaWJ1dGVzICs9ICc7ICcgKyBhdHRyaWJ1dGVOYW1lO1xuXHRcdFx0XHRpZiAoYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9PT0gdHJ1ZSkge1xuXHRcdFx0XHRcdGNvbnRpbnVlO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0Ly8gQ29uc2lkZXJzIFJGQyA2MjY1IHNlY3Rpb24gNS4yOlxuXHRcdFx0XHQvLyAuLi5cblx0XHRcdFx0Ly8gMy4gIElmIHRoZSByZW1haW5pbmcgdW5wYXJzZWQtYXR0cmlidXRlcyBjb250YWlucyBhICV4M0IgKFwiO1wiKVxuXHRcdFx0XHQvLyAgICAgY2hhcmFjdGVyOlxuXHRcdFx0XHQvLyBDb25zdW1lIHRoZSBjaGFyYWN0ZXJzIG9mIHRoZSB1bnBhcnNlZC1hdHRyaWJ1dGVzIHVwIHRvLFxuXHRcdFx0XHQvLyBub3QgaW5jbHVkaW5nLCB0aGUgZmlyc3QgJXgzQiAoXCI7XCIpIGNoYXJhY3Rlci5cblx0XHRcdFx0Ly8gLi4uXG5cdFx0XHRcdHN0cmluZ2lmaWVkQXR0cmlidXRlcyArPSAnPScgKyBhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdLnNwbGl0KCc7JylbMF07XG5cdFx0XHR9XG5cblx0XHRcdHJldHVybiAoZG9jdW1lbnQuY29va2llID0ga2V5ICsgJz0nICsgdmFsdWUgKyBzdHJpbmdpZmllZEF0dHJpYnV0ZXMpO1xuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIGdldCAoa2V5LCBqc29uKSB7XG5cdFx0XHRpZiAodHlwZW9mIGRvY3VtZW50ID09PSAndW5kZWZpbmVkJykge1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdHZhciBqYXIgPSB7fTtcblx0XHRcdC8vIFRvIHByZXZlbnQgdGhlIGZvciBsb29wIGluIHRoZSBmaXJzdCBwbGFjZSBhc3NpZ24gYW4gZW1wdHkgYXJyYXlcblx0XHRcdC8vIGluIGNhc2UgdGhlcmUgYXJlIG5vIGNvb2tpZXMgYXQgYWxsLlxuXHRcdFx0dmFyIGNvb2tpZXMgPSBkb2N1bWVudC5jb29raWUgPyBkb2N1bWVudC5jb29raWUuc3BsaXQoJzsgJykgOiBbXTtcblx0XHRcdHZhciBpID0gMDtcblxuXHRcdFx0Zm9yICg7IGkgPCBjb29raWVzLmxlbmd0aDsgaSsrKSB7XG5cdFx0XHRcdHZhciBwYXJ0cyA9IGNvb2tpZXNbaV0uc3BsaXQoJz0nKTtcblx0XHRcdFx0dmFyIGNvb2tpZSA9IHBhcnRzLnNsaWNlKDEpLmpvaW4oJz0nKTtcblxuXHRcdFx0XHRpZiAoIWpzb24gJiYgY29va2llLmNoYXJBdCgwKSA9PT0gJ1wiJykge1xuXHRcdFx0XHRcdGNvb2tpZSA9IGNvb2tpZS5zbGljZSgxLCAtMSk7XG5cdFx0XHRcdH1cblxuXHRcdFx0XHR0cnkge1xuXHRcdFx0XHRcdHZhciBuYW1lID0gZGVjb2RlKHBhcnRzWzBdKTtcblx0XHRcdFx0XHRjb29raWUgPSAoY29udmVydGVyLnJlYWQgfHwgY29udmVydGVyKShjb29raWUsIG5hbWUpIHx8XG5cdFx0XHRcdFx0XHRkZWNvZGUoY29va2llKTtcblxuXHRcdFx0XHRcdGlmIChqc29uKSB7XG5cdFx0XHRcdFx0XHR0cnkge1xuXHRcdFx0XHRcdFx0XHRjb29raWUgPSBKU09OLnBhcnNlKGNvb2tpZSk7XG5cdFx0XHRcdFx0XHR9IGNhdGNoIChlKSB7fVxuXHRcdFx0XHRcdH1cblxuXHRcdFx0XHRcdGphcltuYW1lXSA9IGNvb2tpZTtcblxuXHRcdFx0XHRcdGlmIChrZXkgPT09IG5hbWUpIHtcblx0XHRcdFx0XHRcdGJyZWFrO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fSBjYXRjaCAoZSkge31cblx0XHRcdH1cblxuXHRcdFx0cmV0dXJuIGtleSA/IGphcltrZXldIDogamFyO1xuXHRcdH1cblxuXHRcdGFwaS5zZXQgPSBzZXQ7XG5cdFx0YXBpLmdldCA9IGZ1bmN0aW9uIChrZXkpIHtcblx0XHRcdHJldHVybiBnZXQoa2V5LCBmYWxzZSAvKiByZWFkIGFzIHJhdyAqLyk7XG5cdFx0fTtcblx0XHRhcGkuZ2V0SlNPTiA9IGZ1bmN0aW9uIChrZXkpIHtcblx0XHRcdHJldHVybiBnZXQoa2V5LCB0cnVlIC8qIHJlYWQgYXMganNvbiAqLyk7XG5cdFx0fTtcblx0XHRhcGkucmVtb3ZlID0gZnVuY3Rpb24gKGtleSwgYXR0cmlidXRlcykge1xuXHRcdFx0c2V0KGtleSwgJycsIGV4dGVuZChhdHRyaWJ1dGVzLCB7XG5cdFx0XHRcdGV4cGlyZXM6IC0xXG5cdFx0XHR9KSk7XG5cdFx0fTtcblxuXHRcdGFwaS5kZWZhdWx0cyA9IHt9O1xuXG5cdFx0YXBpLndpdGhDb252ZXJ0ZXIgPSBpbml0O1xuXG5cdFx0cmV0dXJuIGFwaTtcblx0fVxuXG5cdHJldHVybiBpbml0KGZ1bmN0aW9uICgpIHt9KTtcbn0pKTtcbiIsIjxzY3JpcHQ+XHJcbiAgaW1wb3J0IHsgb25Nb3VudCB9IGZyb20gXCJzdmVsdGVcIjtcclxuICBpbXBvcnQgQ2FyZExvYWRlciBmcm9tIFwiLi9jYXJkLWxvYWRlci5qc1wiO1xyXG5cclxuICBpbXBvcnQgQ29va2llcyBmcm9tIFwianMtY29va2llXCI7XHJcblxyXG4gIGNvbnN0IENBUkRfUkFUSU8gPSAwLjcxNzY0NzA1ODgyO1xyXG4gIGxldCBfaGVpZ2h0ID0gMzAwO1xyXG4gIGxldCBfd2lkdGggPSBNYXRoLmZsb29yKF9oZWlnaHQgKiBDQVJEX1JBVElPKTtcclxuXHJcbiAgbGV0IGhlaWdodCA9IF9oZWlnaHQ7XHJcbiAgbGV0IHdpZHRoID0gX3dpZHRoO1xyXG4gIGxldCBjYXJkU2VhcmNoQWN0aXZlID0gdHJ1ZTtcclxuICBsZXQgc3RhdGlzdGljc0FjdGl2ZSA9IHRydWU7XHJcbiAgbGV0IHNjYWxpbmcgPSAxMDA7XHJcblxyXG4gIGxldCBkZXZvdGlvbkhpZ2hsaWdodCA9IC0xO1xyXG5cclxuICBmdW5jdGlvbiBoaWdobGlnaHREZXZvdGlvbihtYW5hKSB7XHJcbiAgICBpZiAoZGV2b3Rpb25IaWdobGlnaHQgPT0gbWFuYSkgZGV2b3Rpb25IaWdobGlnaHQgPSAtMTtcclxuICAgIGVsc2UgZGV2b3Rpb25IaWdobGlnaHQgPSBtYW5hICsgXCJcIjtcclxuICB9XHJcblxyXG4gICQ6IHtcclxuICAgIGNvbnN0IHMgPSBNYXRoLmZsb29yKHNjYWxpbmcgfHwgMTAwKSAvIDEwMDtcclxuICAgIGhlaWdodCA9IF9oZWlnaHQgKiBzO1xyXG4gICAgd2lkdGggPSBfd2lkdGggKiBzO1xyXG4gIH1cclxuXHJcbiAgbGV0IHByb21pc2UgPSBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHJlc29sdmUoW10pKTtcclxuICBsZXQgY2FyZFNlYXJjaFByb21pc2UgPSBuZXcgUHJvbWlzZShyZXNvbHZlID0+XHJcbiAgICByZXNvbHZlKHsgZGF0YTogW10sIGhhc19tb3JlOiBmYWxzZSwgdG90YWxfY2FyZHM6IDAgfSlcclxuICApO1xyXG5cclxuICBsZXQgaW5wdXQ7XHJcbiAgbGV0IGZvcm1hdDtcclxuICBsZXQgcHJvZ3Jlc3MgPSAwO1xyXG4gIGxldCBhbGwgPSAwO1xyXG5cclxuICBsZXQgc3BOYW1lO1xyXG4gIGxldCBzcFRleHQ7XHJcblxyXG4gIGxldCBzcEVESEJsdWU7XHJcbiAgbGV0IHNwRURIQmxhY2s7XHJcbiAgbGV0IHNwRURIUmVkO1xyXG4gIGxldCBzcEVESFdoaXRlO1xyXG4gIGxldCBzcEVESEdyZWVuO1xyXG4gIGxldCBzcEVESENvbG9ybGVzcztcclxuXHJcbiAgZnVuY3Rpb24gY2xlYXJGb3JDb2xvcmxlc3MoKSB7XHJcbiAgICBzcEVESEJsdWUuY2hlY2tlZCA9IGZhbHNlO1xyXG4gICAgc3BFREhCbGFjay5jaGVja2VkID0gZmFsc2U7XHJcbiAgICBzcEVESFJlZC5jaGVja2VkID0gZmFsc2U7XHJcbiAgICBzcEVESFdoaXRlLmNoZWNrZWQgPSBmYWxzZTtcclxuICAgIHNwRURIR3JlZW4uY2hlY2tlZCA9IGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gY2xlYXJDb2xvcmxlc3MoKSB7XHJcbiAgICBzcEVESENvbG9ybGVzcy5jaGVja2VkID0gZmFsc2U7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBzZWFyY2hDYXJkcyhuZXh0VXJsKSB7XHJcbiAgICBpZiAodHlwZW9mIG5leHRVcmwgPT0gXCJzdHJpbmdcIikge1xyXG4gICAgICBjYXJkU2VhcmNoUHJvbWlzZSA9IENhcmRMb2FkZXIuc2VhcmNoKG5leHRVcmwpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCBjb2xvcnMgPSBuZXcgU2V0KCk7XHJcbiAgICBpZiAoc3BFREhDb2xvcmxlc3MuY2hlY2tlZCkgY29sb3JzLmFkZChcIkNcIik7XHJcbiAgICBpZiAoc3BFREhCbHVlLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJVXCIpO1xyXG4gICAgaWYgKHNwRURIQmxhY2suY2hlY2tlZCkgY29sb3JzLmFkZChcIkJcIik7XHJcbiAgICBpZiAoc3BFREhSZWQuY2hlY2tlZCkgY29sb3JzLmFkZChcIlJcIik7XHJcbiAgICBpZiAoc3BFREhXaGl0ZS5jaGVja2VkKSBjb2xvcnMuYWRkKFwiV1wiKTtcclxuICAgIGlmIChzcEVESEdyZWVuLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJHXCIpO1xyXG5cclxuICAgIGNhcmRTZWFyY2hQcm9taXNlID0gQ2FyZExvYWRlci5zZWFyY2goe1xyXG4gICAgICBuYW1lOiBzcE5hbWUudmFsdWUsXHJcbiAgICAgIHRleHQ6IHNwVGV4dC52YWx1ZSxcclxuICAgICAgZWRoY29sb3JzOiBjb2xvcnNcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgbGV0IGhpZGRlbkdyb3VwcyA9IG5ldyBTZXQoKTtcclxuXHJcbiAgZnVuY3Rpb24gdG9nZ2xlR3JvdXBWaXNpYmlsaXR5KGdyb3VwKSB7XHJcbiAgICBpZiAoaGlkZGVuR3JvdXBzLmhhcyhncm91cC5uYW1lKSkgaGlkZGVuR3JvdXBzLmRlbGV0ZShncm91cC5uYW1lKTtcclxuICAgIGVsc2UgaGlkZGVuR3JvdXBzLmFkZChncm91cC5uYW1lKTtcclxuXHJcbiAgICBoaWRkZW5Hcm91cHMgPSBoaWRkZW5Hcm91cHM7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBzcChwLCBhKSB7XHJcbiAgICBwcm9ncmVzcyA9IHA7XHJcbiAgICBhbGwgPSBhO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gc29ydERlY2tTdHJpbmcoKSB7XHJcbiAgICBwcm9taXNlID0gQ2FyZExvYWRlci5zb3J0KGlucHV0LnZhbHVlIHx8IFwiXCIsIChwLCBhKSA9PiB7XHJcbiAgICAgIHNwKHAsIGEpO1xyXG4gICAgfSlcclxuICAgICAgLmNhdGNoKGUgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZSk7XHJcbiAgICAgICAgdGhyb3cgZTtcclxuICAgICAgfSlcclxuICAgICAgLnRoZW4ocmVzID0+IHtcclxuICAgICAgICBpbnB1dC52YWx1ZSA9IHJlcztcclxuICAgICAgICByZXR1cm4gdXBkYXRlKHsga2V5Q29kZTogMjcgfSwgdHJ1ZSk7XHJcbiAgICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgZnVuY3Rpb24gdXBkYXRlKGV2dCkge1xyXG4gICAgaWYgKGV2dC5rZXlDb2RlICE9PSAyNykgcmV0dXJuO1xyXG4gICAgcHJvbWlzZSA9IENhcmRMb2FkZXIuY3JlYXRlRGVjayhpbnB1dC52YWx1ZSB8fCBcIlwiLCAocCwgYSkgPT4ge1xyXG4gICAgICBzcChwLCBhKTtcclxuICAgIH0pXHJcbiAgICAgIC5jYXRjaChlID0+IHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGUpO1xyXG4gICAgICAgIHRocm93IGU7XHJcbiAgICAgIH0pXHJcbiAgICAgIC50aGVuKHJlcyA9PiB7XHJcbiAgICAgICAgaW5wdXQudmFsdWUgPSByZXMuY29ycmVjdGVkO1xyXG4gICAgICAgIHJldHVybiByZXM7XHJcbiAgICAgIH0pO1xyXG5cclxuICAgIHJldHVybiBwcm9taXNlO1xyXG4gIH1cclxuICBmdW5jdGlvbiByZWxvYWQoKSB7XHJcbiAgICB1cGRhdGUoeyBrZXlDb2RlOiAyNyB9KTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIGFwcGVuZENhcmQobmFtZSkge1xyXG4gICAgaWYgKCFuYW1lKSByZXR1cm47XHJcblxyXG4gICAgaW5wdXQudmFsdWUgPSBpbnB1dC52YWx1ZSArIFwiXFxuMSBcIiArIG5hbWU7XHJcbiAgICByZWxvYWQoKTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHJlbW92ZShjYXJkKSB7XHJcbiAgICBjb25zdCByID0gbmV3IFJlZ0V4cChgXi4qJHtjYXJkLm5hbWV9LiokYCwgXCJnbVwiKTtcclxuXHJcbiAgICBpbnB1dC52YWx1ZSA9IGlucHV0LnZhbHVlLnJlcGxhY2UociwgXCJcIik7XHJcbiAgICBwcm9taXNlID0gQ2FyZExvYWRlci5jcmVhdGVEZWNrKGlucHV0LnZhbHVlIHx8IFwiXCIsIChwLCBhKSA9PlxyXG4gICAgICBzcChwLCBhKVxyXG4gICAgKS5jYXRjaChlID0+IHtcclxuICAgICAgY29uc29sZS5lcnJvcihlKTtcclxuICAgICAgdGhyb3cgZTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gY29weURlY2soKSB7XHJcbiAgICBpbnB1dC5zZWxlY3QoKTtcclxuICAgIGlucHV0LnNldFNlbGVjdGlvblJhbmdlKDAsIDk5OTk5KTtcclxuICAgIGRvY3VtZW50LmV4ZWNDb21tYW5kKFwiY29weVwiKTtcclxuICB9XHJcblxyXG4gIGxldCBoZWxwQWN0aXZlID0gdHJ1ZTtcclxuICBvbk1vdW50KGFzeW5jICgpID0+IHtcclxuICAgIGNvbnN0IHN0YXJ0ID1cclxuICAgICAgQ29va2llcy5nZXQoXCJkZWNrXCIpIHx8XHJcbiAgICAgIGAjbGFuZHNcclxubW91bnRhaW5cclxuMiBwbGFpbnNcclxuMyBzd2FtcHNcclxuIyBtYWluIGRlY2tcclxuMjAgYmxpZ2h0c3RlZWwgY29sb3NzdXNgO1xyXG5cclxuICAgIGhlbHBBY3RpdmUgPSBDb29raWVzLmdldChcImhlbHBBY3RpdmVcIikgPT0gXCJ0cnVlXCI7XHJcbiAgICBjb25zb2xlLmxvZyhcImhlbHA6XCIsIENvb2tpZXMuZ2V0KFwiaGVscEFjdGl2ZVwiKSk7XHJcbiAgICBjYXJkU2VhcmNoQWN0aXZlID0gQ29va2llcy5zZXQoXCJjYXJkU2VhcmNoQWN0aXZlXCIpID09IFwidHJ1ZVwiO1xyXG4gICAgY29uc29sZS5sb2coXCJzZWFyY2g6XCIsIENvb2tpZXMuc2V0KFwiY2FyZFNlYXJjaEFjdGl2ZVwiKSk7XHJcbiAgICBzdGF0aXN0aWNzQWN0aXZlID0gQ29va2llcy5zZXQoXCJzdGF0aXN0aWNzQWN0aXZlXCIpID09IFwidHJ1ZVwiO1xyXG4gICAgY29uc29sZS5sb2coXCJzdGF0aXN0aWNzOlwiLCBDb29raWVzLnNldChcInN0YXRpc3RpY3NBY3RpdmVcIikpO1xyXG5cclxuICAgIHN0YXRpc3RpY3NBY3RpdmU7XHJcbiAgICBpbnB1dC52YWx1ZSA9IHN0YXJ0O1xyXG4gICAgY29uc29sZS5sb2coXCJTVFNGU0RGXCIsIENvb2tpZXMuZ2V0KFwiZGVja1wiKSksXHJcbiAgICAgIChwcm9taXNlID0gQ2FyZExvYWRlci5jcmVhdGVEZWNrKHN0YXJ0LCAocCwgYSkgPT4gc3AocCwgYSkpKTtcclxuICB9KTtcclxuXHJcbiAgZnVuY3Rpb24gb25UeXBpbmcoKSB7XHJcbiAgICBDb29raWVzLnNldChcImRlY2tcIiwgaW5wdXQudmFsdWUsIHsgZXhwaXJlczogNyB9KTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIGdldEhlaWdodChtYW5hLCBncm91cHMpIHtcclxuICAgIHJldHVybiAxMDAgKiAobWFuYSAvIE1hdGgubWF4KC4uLmdyb3Vwc1tcIm1hbmFDdXJ2ZVwiXSkpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gb3BlbkhlbHAoKSB7XHJcbiAgICBoZWxwQWN0aXZlID0gIWhlbHBBY3RpdmU7XHJcbiAgICBDb29raWVzLnNldChcImhlbHBBY3RpdmVcIiwgaGVscEFjdGl2ZSArIFwiXCIpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gdG9nZ2xlU2VhcmNoKCkge1xyXG4gICAgY2FyZFNlYXJjaEFjdGl2ZSA9ICFjYXJkU2VhcmNoQWN0aXZlO1xyXG4gICAgQ29va2llcy5zZXQoXCJjYXJkU2VhcmNoQWN0aXZlXCIsIGNhcmRTZWFyY2hBY3RpdmUgKyBcIlwiKTtcclxuICB9XHJcbiAgZnVuY3Rpb24gdG9nZ2xlU3RhdGlzdGljcygpIHtcclxuICAgIHN0YXRpc3RpY3NBY3RpdmUgPSAhc3RhdGlzdGljc0FjdGl2ZTtcclxuICAgIENvb2tpZXMuc2V0KFwic3RhdGlzdGljc0FjdGl2ZVwiLCBzdGF0aXN0aWNzQWN0aXZlICsgXCJcIik7XHJcbiAgfVxyXG48L3NjcmlwdD5cclxuXHJcbjxzdHlsZT5cclxuICAuY29udGVudCB7XHJcbiAgICAtLXJhaXNpbi1ibGFjazogaHNsYSgyMDAsIDglLCAxNSUsIDEpO1xyXG4gICAgLS1yb21hbi1zaWx2ZXI6IGhzbGEoMTk2LCAxNSUsIDYwJSwgMSk7XHJcbiAgICAtLWNvbG9ybGVzczogaHNsYSgwLCAwJSwgODklLCAxKTtcclxuICAgIC0tYmxhY2s6IGhzbGEoODMsIDglLCAzOCUsIDEpO1xyXG4gICAgLS13aGl0ZTogaHNsKDQ4LCA2NCUsIDg5JSk7XHJcbiAgICAtLXJlZDogaHNsYSgwLCA3MSUsIDg0JSwgMSk7XHJcbiAgICAtLWdyZWVuOiBoc2xhKDExNCwgNjAlLCA3NSUsIDEpO1xyXG4gICAgLS1ibHVlOiBoc2xhKDIzNSwgNTUlLCA4MSUsIDEpO1xyXG4gIH1cclxuXHJcbiAgLmNvbnRlbnQge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgICB3aWR0aDogMTAwJTtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICB9XHJcblxyXG4gIC5oZWxwLXN5bWJvbCB7XHJcbiAgICBib3JkZXItcmFkaXVzOiA1MCU7XHJcbiAgICBib3JkZXI6IDFweCBzb2xpZCBibGFjaztcclxuICAgIHdpZHRoOiAxNnB4O1xyXG4gICAgaGVpZ2h0OiAxNnB4O1xyXG4gICAgdGV4dC1hbGlnbjogY2VudGVyO1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgcmlnaHQ6IDEwcHg7XHJcbiAgICB0b3A6IDEwcHg7XHJcbiAgICBjdXJzb3I6IHBvaW50ZXI7XHJcbiAgfVxyXG5cclxuICAuaGVscC1zeW1ib2w6aG92ZXIge1xyXG4gICAgYm9yZGVyLWNvbG9yOiBibHVlO1xyXG4gICAgY29sb3I6IGJsdWU7XHJcbiAgfVxyXG5cclxuICAudG9nZ2xlLXNlYXJjaCB7XHJcbiAgICBiYWNrZ3JvdW5kOiBibHVlO1xyXG4gICAgd2lkdGg6IDMwcHg7XHJcbiAgICBoZWlnaHQ6IDMwcHg7XHJcbiAgICBjdXJzb3I6IHBvaW50ZXI7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICBsZWZ0OiAtMzBweDtcclxuICAgIHRvcDogNTAlO1xyXG4gICAgdXNlci1zZWxlY3Q6IG5vbmU7XHJcbiAgfVxyXG5cclxuICAuaGlkZSAudG9nZ2xlLXNlYXJjaCB7XHJcbiAgICBsZWZ0OiAtNTJweDtcclxuICB9XHJcblxyXG4gIC5zdGF0aXN0aWNzIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gIH1cclxuICAuaW5wdXQge1xyXG4gICAgd2lkdGg6IDEwMCU7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgICBib3gtc2l6aW5nOiBib3JkZXItYm94O1xyXG4gICAgcGFkZGluZzogMTBweDtcclxuICAgIHJlc2l6ZTogbm9uZTtcclxuICB9XHJcblxyXG4gIC5jb250cm9scyB7XHJcbiAgICBmbGV4LXNocmluazogMDtcclxuICAgIHdpZHRoOiAzMDBweDtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICAgIGJhY2tncm91bmQ6IGxpZ2h0Z3JheTtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gIH1cclxuXHJcbiAgLmhlbHAge1xyXG4gICAgcGFkZGluZzogMHB4IDEwcHggMTBweCAxMHB4O1xyXG4gICAgdXNlci1zZWxlY3Q6IG5vbmU7XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgfVxyXG5cclxuICAuZ3JvdXAtY29udGVudCB7XHJcbiAgICBmbGV4LWdyb3c6IDE7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC13cmFwOiB3cmFwO1xyXG4gICAgdHJhbnNpdGlvbjogaGVpZ2h0IDUwMG1zIGVhc2U7XHJcbiAgfVxyXG5cclxuICAuZ3JvdXAtY29udGVudC5oaWRkZW4ge1xyXG4gICAgb3ZlcmZsb3c6IGhpZGRlbjtcclxuICAgIGhlaWdodDogNDVweDtcclxuICB9XHJcblxyXG4gIC5jYXJkLXNlYXJjaCB7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgICBmbGV4LWdyb3c6IDE7XHJcbiAgICBiYWNrZ3JvdW5kOiB3aGl0ZTtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgcmlnaHQ6IDA7XHJcbiAgICB3aWR0aDogMzMlO1xyXG4gICAgei1pbmRleDogMTAwO1xyXG4gICAgYm94LXNoYWRvdzogMHB4IDBweCAxMHB4IGJsYWNrO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQtc2VhcmNoLmhpZGUge1xyXG4gICAgcmlnaHQ6IC0zMyU7XHJcbiAgfVxyXG5cclxuICAuc2VhcmNoLXBhcmFtcyB7XHJcbiAgICBmbGV4LXNocmluazogMDtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gIH1cclxuXHJcbiAgLnNlYXJjaC1yZXN1bHQge1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gICAgZmxleC1ncm93OiAxO1xyXG4gICAgYmFja2dyb3VuZDogd2hpdGU7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICAgIG92ZXJmbG93OiBhdXRvO1xyXG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xyXG4gICAgdXNlci1zZWxlY3Q6IG5vbmU7XHJcbiAgICBmbGV4LXdyYXA6IHdyYXA7XHJcbiAgfVxyXG5cclxuICAuZGlzcGxheSB7XHJcbiAgICBmbGV4LWdyb3c6IDE7XHJcbiAgICBiYWNrZ3JvdW5kOiBncmF5O1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XHJcbiAgICBmbGV4LXdyYXA6IG5vd3JhcDtcclxuICAgIG92ZXJmbG93OiBhdXRvO1xyXG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xyXG4gICAgdXNlci1zZWxlY3Q6IG5vbmU7XHJcbiAgfVxyXG5cclxuICAubG9hZGluZy13cmFwcGVyIHtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIGxlZnQ6IDUwJTtcclxuICAgIHRvcDogMDtcclxuICAgIGJvdHRvbTogMDtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBhbGlnbi1pdGVtczogY2VudGVyO1xyXG4gIH1cclxuXHJcbiAgLmVudHJ5IHtcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICAgIHBhZGRpbmc6IDEwcHg7XHJcbiAgICBmbGV4LXNocmluazogMDtcclxuICB9XHJcbiAgLmNhcmQge1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgcmdiKDIyLCAyMiwgMjIpO1xyXG4gICAgYm9yZGVyLXJhZGl1czogMTBweDtcclxuICAgIG91dGxpbmU6IDA7XHJcbiAgICBib3gtc2hhZG93OiAwcHggMHB4IDEwcHggYmxhY2s7XHJcbiAgfVxyXG5cclxuICAuY2FyZC5iYW5uZWQge1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgcmVkO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQuaGlnaGxpZ2h0ZWQge1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgeWVsbG93O1xyXG4gIH1cclxuXHJcbiAgLmNhcmQ6aG92ZXIge1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgYmx1ZTtcclxuICAgIGN1cnNvcjogcG9pbnRlcjtcclxuICB9XHJcblxyXG4gIC5wcmljZSxcclxuICAuYmFubmVkLXRleHQsXHJcbiAgLmNvdW50IHtcclxuICAgIGZvbnQtc2l6ZTogMzRweDtcclxuICAgIHRleHQtc2hhZG93OiAwcHggMHB4IDlweCBibGFjaztcclxuICAgIGNvbG9yOiByZWQ7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICB6LWluZGV4OiAxMDA7XHJcbiAgICBmb250LXdlaWdodDogYm9sZDtcclxuICAgIGxlZnQ6IDM0cHg7XHJcbiAgfVxyXG5cclxuICAuYmFubmVkLXRleHQge1xyXG4gICAgZm9udC1zaXplOiAxMDAlO1xyXG4gICAgdGV4dC1zaGFkb3c6IDBweCAwcHggOXB4IGJsYWNrO1xyXG4gICAgY29sb3I6IHJlZDtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIHotaW5kZXg6IDEwMDtcclxuICAgIGZvbnQtd2VpZ2h0OiBib2xkO1xyXG4gICAgbGVmdDogMTclO1xyXG4gIH1cclxuICAuY291bnQge1xyXG4gICAgdG9wOiAxNjVweDtcclxuICB9XHJcblxyXG4gIC5wcmljZSB7XHJcbiAgICBib3R0b206IDdweDtcclxuICAgIGNvbG9yOiB3aGVhdDtcclxuICAgIGZvbnQtc2l6ZTogMTJweDtcclxuICAgIGJhY2tncm91bmQ6IGJsYWNrO1xyXG4gICAgbGVmdDogNDUlO1xyXG4gICAgZm9udC13ZWlnaHQ6IG5vcm1hbDtcclxuICB9XHJcblxyXG4gIC5ncm91cC1oZWFkZXIge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGJhY2tncm91bmQ6IGRhcmtncmV5O1xyXG4gICAgLyogcGFkZGluZzogOHB4OyAqL1xyXG4gICAgbWFyZ2luOiA4cHggMDtcclxuICAgIGJveC1zaGFkb3c6IDBweCAwcHggOHB4IGJsYWNrO1xyXG4gICAgd2lkdGg6IDEwMCU7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gIH1cclxuXHJcbiAgLmdyb3VwLWhlYWRlciBoMiB7XHJcbiAgICBwYWRkaW5nOiAwIDI1cHg7XHJcbiAgICBtYXJnaW46IDBweDtcclxuICB9XHJcblxyXG4gIC5ncm91cC1zdGF0aXN0aWNzIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gIH1cclxuXHJcbiAgLm1hbmEtcHJvcG9zYWwsXHJcbiAgLm1hbmEtZGV2b3Rpb24ge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgfVxyXG5cclxuICAuZGVjay12YWx1ZSxcclxuICAuZ3JvdXAtdmFsdWUge1xyXG4gICAgcGFkZGluZzogNXB4O1xyXG4gICAgY29sb3I6IGJsYWNrO1xyXG4gICAgYm9yZGVyLXJhZGl1czogNTAlO1xyXG4gICAgd2lkdGg6IDE1cHg7XHJcbiAgICBoZWlnaHQ6IDE1cHg7XHJcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7XHJcbiAgICBtYXJnaW46IDVweDtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7XHJcbiAgICBhbGlnbi1pdGVtczogY2VudGVyO1xyXG4gICAgZm9udC1zaXplOiAxMXB4O1xyXG4gICAgZm9udC13ZWlnaHQ6IGJvbGQ7XHJcbiAgfVxyXG4gIC5ibHVlIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWJsdWUpO1xyXG4gIH1cclxuICAuYmxhY2sge1xyXG4gICAgY29sb3I6IHdoaXRlO1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0tYmxhY2spO1xyXG4gIH1cclxuICAucmVkIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLXJlZCk7XHJcbiAgfVxyXG4gIC53aGl0ZSB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS13aGl0ZSk7XHJcbiAgfVxyXG4gIC5ncmVlbiB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS1ncmVlbik7XHJcbiAgfVxyXG4gIC5jb2xvcmxlc3Mge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0tY29sb3JsZXNzKTtcclxuICB9XHJcbiAgLmdlbmVyaWMge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogZ29sZGVucm9kO1xyXG4gIH1cclxuICAuc3VtIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IGdvbGRlbnJvZDtcclxuICB9XHJcblxyXG4gIC5jb2xvci1wYXJhbSB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICB9XHJcblxyXG4gIC5tYW5hLWN1cnZlIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gIH1cclxuXHJcbiAgLmFsbC1jdXJ2ZXMge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZ3JvdzogMTtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgICBoZWlnaHQ6IDgwcHg7XHJcbiAgfVxyXG5cclxuICAuYWxsLWxhYmVscyB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1zaHJpbms6IDA7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gIH1cclxuXHJcbiAgLmN1cnZlLWVsZW1lbnQge1xyXG4gICAgd2lkdGg6IDIwcHg7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgYm90dG9tOiAwO1xyXG4gICAgYmFja2dyb3VuZDogZ3JheTtcclxuICAgIC8qIHZlcnRpY2FsLWFsaWduOiBtaWRkbGU7ICovXHJcbiAgICBhbGlnbi1pdGVtczogY2VudGVyO1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gIH1cclxuXHJcbiAgLmN1cnZlLWxhYmVsIHtcclxuICAgIHdpZHRoOiAyMHB4O1xyXG4gIH1cclxuICAuY3VydmUtd3JhcHBlciB7XHJcbiAgICB3aWR0aDogMjBweDtcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICAgIGN1cnNvcjogcG9pbnRlcjtcclxuICB9XHJcblxyXG4gIC5jdXJ2ZS1lbGVtZW50OmhvdmVyIHtcclxuICAgIGJhY2tncm91bmQ6IGxpZ2h0Y29yYWw7XHJcbiAgfVxyXG5cclxuICAuaGlnaGxpZ2h0ZWQgLmN1cnZlLWVsZW1lbnQge1xyXG4gICAgYmFja2dyb3VuZDogbGlnaHRibHVlO1xyXG4gIH1cclxuXHJcbiAgLmN1cnZlLWxhYmVsLmhpZ2hsaWdodGVkIHtcclxuICAgIGJhY2tncm91bmQ6IGxpZ2h0Ymx1ZTtcclxuICB9XHJcblxyXG4gIC5jdXJ2ZS1sYWJlbDpob3ZlciB7XHJcbiAgICBiYWNrZ3JvdW5kOiBsaWdodGNvcmFsO1xyXG4gIH1cclxuXHJcbiAgaDQge1xyXG4gICAgbWFyZ2luLXRvcDogNXB4O1xyXG4gICAgbWFyZ2luLWJvdHRvbTogNXB4O1xyXG4gIH1cclxuXHJcbiAgLmxkcy1yaXBwbGUge1xyXG4gICAgZGlzcGxheTogaW5saW5lLWJsb2NrO1xyXG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xyXG4gICAgd2lkdGg6IDgwcHg7XHJcbiAgICBoZWlnaHQ6IDgwcHg7XHJcbiAgfVxyXG4gIC5sZHMtcmlwcGxlIGRpdiB7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICBib3JkZXI6IDRweCBzb2xpZCAjZmZmO1xyXG4gICAgb3BhY2l0eTogMTtcclxuICAgIGJvcmRlci1yYWRpdXM6IDUwJTtcclxuICAgIGFuaW1hdGlvbjogbGRzLXJpcHBsZSAxcyBjdWJpYy1iZXppZXIoMCwgMC4yLCAwLjgsIDEpIGluZmluaXRlO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQtc2VhcmNoIC5sZHMtcmlwcGxlIGRpdiB7XHJcbiAgICBib3JkZXI6IDRweCBzb2xpZCBibGFjaztcclxuICB9XHJcblxyXG4gIC5sZHMtcmlwcGxlIGRpdjpudGgtY2hpbGQoMikge1xyXG4gICAgYW5pbWF0aW9uLWRlbGF5OiAtMC41cztcclxuICB9XHJcbiAgQGtleWZyYW1lcyBsZHMtcmlwcGxlIHtcclxuICAgIDAlIHtcclxuICAgICAgdG9wOiAzNnB4O1xyXG4gICAgICBsZWZ0OiAzNnB4O1xyXG4gICAgICB3aWR0aDogMDtcclxuICAgICAgaGVpZ2h0OiAwO1xyXG4gICAgICBvcGFjaXR5OiAxO1xyXG4gICAgfVxyXG4gICAgMTAwJSB7XHJcbiAgICAgIHRvcDogMHB4O1xyXG4gICAgICBsZWZ0OiAwcHg7XHJcbiAgICAgIHdpZHRoOiA3MnB4O1xyXG4gICAgICBoZWlnaHQ6IDcycHg7XHJcbiAgICAgIG9wYWNpdHk6IDA7XHJcbiAgICB9XHJcbiAgfVxyXG48L3N0eWxlPlxyXG5cclxuPHN2ZWx0ZTp3aW5kb3cgb246a2V5dXA9e3VwZGF0ZX0gLz5cclxuPGRpdiBjbGFzcz1cImNvbnRlbnRcIj5cclxuICA8ZGl2IGNsYXNzPVwiY29udHJvbHNcIj5cclxuICAgIDxkaXYgY2xhc3M9XCJoZWxwXCI+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJoZWxwLXN5bWJvbFwiIG9uOmNsaWNrPXtvcGVuSGVscH0+PzwvZGl2PlxyXG5cclxuICAgICAgeyNpZiBoZWxwQWN0aXZlfVxyXG4gICAgICAgIDxoND5Ib3cgdG8gdXNlOjwvaDQ+XHJcbiAgICAgICAgPHA+cGFzdGUgeW91ciBkZWNrIHRvIHRoZSBmb2xsb3dpbmcgaW5wdXQuPC9wPlxyXG4gICAgICAgIDx1bD5cclxuICAgICAgICAgIDxsaT5cclxuICAgICAgICAgICAgd2hlbiBhIGxpbmUgc3RhcnRzIHdpdGggXCIjXCIgaXQgd2lsbCBiZSBpbnRlcnByZXRlZCBhcyBoZWFkbGluZVxyXG4gICAgICAgICAgPC9saT5cclxuICAgICAgICAgIDxsaT5cclxuICAgICAgICAgICAgYSBjYXJkIGNhbiBiZSBlbnRlcmVkIHdpdGggYSBsZWFkaW5nIGNvdW50LCBvciBqdXN0IHdpdGggaXRzIG5hbWVcclxuICAgICAgICAgIDwvbGk+XHJcbiAgICAgICAgICA8bGk+dXNlIHRoZSBcIkVTQ1wiIGtleSB0byByZWFsb2FkIHRoZSBwcmV2aWV3PC9saT5cclxuICAgICAgICAgIDxsaT5kb3VibGVjbGljayBhIGNhcmQgdG8gcmVtb3ZlIGl0PC9saT5cclxuICAgICAgICA8L3VsPlxyXG4gICAgICAgIDxwPk5PVEU6IHdlIHVzZSBjb29raWVzIHRvIHN0b3JlIHlvdXIgZGVjayBhZnRlciByZWxvYWQuPC9wPlxyXG4gICAgICAgIDxwPk5PVEU6IFRoaXMgaXMgbm90IGFuIG9mZmljaWFsIE1hZ2ljIHByb2R1a3QuPC9wPlxyXG4gICAgICB7L2lmfVxyXG5cclxuICAgICAgeyNhd2FpdCBwcm9taXNlfVxyXG5cclxuICAgICAgICA8ZGl2PmxvYWRpbmc6IHtwcm9ncmVzc30ve2FsbH08L2Rpdj5cclxuICAgICAgezp0aGVuIGdyb3Vwc31cclxuXHJcbiAgICAgICAgeyNpZiAhaGVscEFjdGl2ZX1cclxuICAgICAgICAgIDxoND5HZW5lcmFsPC9oND5cclxuXHJcbiAgICAgICAgICA8ZGl2PlRvdGFsIGNhcmRzOiB7Z3JvdXBzWydjYXJkQ291bnQnXX08L2Rpdj5cclxuICAgICAgICAgIDxkaXY+XHJcbiAgICAgICAgICAgIExhbmRzOiB7Z3JvdXBzWydsYW5kQ291bnQnXX0gTm9ubGFuZHM6IHtncm91cHNbJ2NhcmRDb3VudCddIC0gZ3JvdXBzWydsYW5kQ291bnQnXX1cclxuICAgICAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgICAgIDxkaXY+Q3JlYXR1cmVzOiB7Z3JvdXBzWydjcmVhdHVyZUNvdW50J119PC9kaXY+XHJcbiAgICAgICAgICA8ZGl2Pkluc3RhbnRzOiB7Z3JvdXBzWydpbnN0YW50Q291bnQnXX08L2Rpdj5cclxuICAgICAgICAgIDxkaXY+RW5jaGFudG1lbnRzOiB7Z3JvdXBzWydlbmNoYW50bWVudENvdW50J119PC9kaXY+XHJcbiAgICAgICAgICA8ZGl2PkFydGlmYWN0czoge2dyb3Vwc1snYXJ0aWZhY3RDb3VudCddfTwvZGl2PlxyXG5cclxuICAgICAgICAgIDxkaXY+Q29zdDoge2dyb3Vwcy5jb3N0LnRvRml4ZWQoMikgKyAnJCd9PC9kaXY+XHJcblxyXG4gICAgICAgICAgeyNpZiBzdGF0aXN0aWNzQWN0aXZlfVxyXG4gICAgICAgICAgICA8ZGl2IGNsYXNzPVwic3RhdGlzdGljc1wiPlxyXG4gICAgICAgICAgICAgIDxoND5EZXZvdGlvbjwvaDQ+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cIm1hbmEtZGV2b3Rpb25cIj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGJsdWVcIj57Z3JvdXBzWydtYW5hJ10uYmx1ZX08L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGJsYWNrXCI+e2dyb3Vwc1snbWFuYSddLmJsYWNrfTwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgcmVkXCI+e2dyb3Vwc1snbWFuYSddLnJlZH08L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIHdoaXRlXCI+e2dyb3Vwc1snbWFuYSddLndoaXRlfTwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgZ3JlZW5cIj57Z3JvdXBzWydtYW5hJ10uZ3JlZW59PC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBjb2xvcmxlc3NcIj5cclxuICAgICAgICAgICAgICAgICAge2dyb3Vwc1snbWFuYSddLmNvbG9ybGVzc31cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgICAgICAgICA8aDQ+R2VuZXJpYyBNYW5hPC9oND5cclxuICAgICAgICAgICAgICA8ZGl2PlJlbWFpbmluZyBnZW5lcmljIG1hbmEgY29zdHM6e2dyb3Vwc1snbWFuYSddLmdlbmVyaWN9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdj5DTUMtTWFuYS1TdW06e2dyb3Vwc1snbWFuYSddLnN1bX08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2PlxyXG4gICAgICAgICAgICAgICAgQXZlcmFnZSBDTUMgcGVyIE5vbmxhbmQ6IHtncm91cHNbJ2F2ZXJhZ2VNYW5hJ10udG9GaXhlZCgyKX1cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICA8aDQ+U3VnZ2VzdGVkIE1hbmEgRGlzdHJpYnV0aW9uPC9oND5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwibWFuYS1wcm9wb3NhbFwiPlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgYmx1ZVwiPlxyXG4gICAgICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10uYmx1ZSAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGJsYWNrXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS5ibGFjayAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIHJlZFwiPlxyXG4gICAgICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10ucmVkICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgd2hpdGVcIj5cclxuICAgICAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLndoaXRlICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgZ3JlZW5cIj5cclxuICAgICAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLmdyZWVuICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgY29sb3JsZXNzXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS5jb2xvcmxlc3MgKiBncm91cHNbJ2xhbmRDb3VudCddKS50b0ZpeGVkKDEpfVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgPGg0Pk1hbmEgQ3VydmU8L2g0PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJtYW5hLWN1cnZlXCI+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiYWxsLWN1cnZlc1wiPlxyXG4gICAgICAgICAgICAgICAgICB7I2VhY2ggZ3JvdXBzWydtYW5hQ3VydmUnXSBhcyBtYW5hLCBpfVxyXG4gICAgICAgICAgICAgICAgICAgIHsjaWYgbWFuYSA+IDB9XHJcbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiY3VydmUtd3JhcHBlclwiXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzOmhpZ2hsaWdodGVkPXtkZXZvdGlvbkhpZ2hsaWdodCA9PSBpfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBvbjpjbGljaz17KCkgPT4gaGlnaGxpZ2h0RGV2b3Rpb24oaSl9PlxyXG4gICAgICAgICAgICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJjdXJ2ZS1lbGVtZW50XCJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICBzdHlsZT17J2hlaWdodDonICsgZ2V0SGVpZ2h0KG1hbmEsIGdyb3VwcykgKyAnJTsnfT5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICB7bWFuYSB8fCAnJ31cclxuICAgICAgICAgICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgICAgICB7L2lmfVxyXG4gICAgICAgICAgICAgICAgICB7L2VhY2h9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiYWxsLWxhYmVsc1wiPlxyXG4gICAgICAgICAgICAgICAgICB7I2VhY2ggZ3JvdXBzWydtYW5hQ3VydmUnXSBhcyBtYW5hLCBpfVxyXG4gICAgICAgICAgICAgICAgICAgIHsjaWYgbWFuYSA+IDB9XHJcbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiY3VydmUtbGFiZWxcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzczpoaWdobGlnaHRlZD17ZGV2b3Rpb25IaWdobGlnaHQgPT0gaX1cclxuICAgICAgICAgICAgICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodERldm90aW9uKGkpfT5cclxuICAgICAgICAgICAgICAgICAgICAgICAge2l9XHJcbiAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgICAgICB7L2lmfVxyXG4gICAgICAgICAgICAgICAgICB7L2VhY2h9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICB7L2lmfVxyXG4gICAgICAgIHsvaWZ9XHJcblxyXG4gICAgICB7OmNhdGNoIGVycm9yfVxyXG4gICAgICAgIHtlcnJvcn1cclxuICAgICAgey9hd2FpdH1cclxuICAgICAgRm9ybWF0OlxyXG4gICAgICA8c2VsZWN0IGJpbmQ6dGhpcz17Zm9ybWF0fSBvbjpibHVyPXtyZWxvYWR9IG9uOmNoYW5nZT17cmVsb2FkfT5cclxuICAgICAgICA8b3B0aW9uIHNlbGVjdGVkPmNvbW1hbmRlcjwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+YnJhd2w8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPmR1ZWw8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPmZ1dHVyZTwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+aGlzdG9yaWM8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPmxlZ2FjeTwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+bW9kZXJuPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5vbGRzY2hvb2w8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnBhdXBlcjwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+cGVubnk8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnBpb25lZXI8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnN0YW5kYXJkPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj52aW50YWdlPC9vcHRpb24+XHJcbiAgICAgIDwvc2VsZWN0PlxyXG4gICAgICA8ZGl2IGNsYXNzPVwic2xpZGVjb250YWluZXJcIj5cclxuICAgICAgICBTY2FsZTpcclxuICAgICAgICA8aW5wdXQgdHlwZT1cInJhbmdlXCIgbWluPVwiMjVcIiBtYXg9XCIxMDBcIiBiaW5kOnZhbHVlPXtzY2FsaW5nfSAvPlxyXG4gICAgICA8L2Rpdj5cclxuXHJcbiAgICAgIDxidXR0b24gb246Y2xpY2s9e3RvZ2dsZVN0YXRpc3RpY3N9PnRvZ2dsZSBzdGF0aXN0aWNzPC9idXR0b24+XHJcbiAgICAgIDxidXR0b24gb246Y2xpY2s9e3NvcnREZWNrU3RyaW5nfT5zb3J0PC9idXR0b24+XHJcbiAgICAgIDxidXR0b24gb246Y2xpY2s9e2NvcHlEZWNrfT5jbGVhbiBjb3B5PC9idXR0b24+XHJcbiAgICA8L2Rpdj5cclxuICAgIDx0ZXh0YXJlYSBiaW5kOnRoaXM9e2lucHV0fSBjbGFzcz1cImlucHV0XCIgb246a2V5dXA9e29uVHlwaW5nfSAvPlxyXG4gIDwvZGl2PlxyXG5cclxuICA8ZGl2IGNsYXNzPVwiZGlzcGxheVwiPlxyXG4gICAgeyNhd2FpdCBwcm9taXNlfVxyXG4gICAgICA8ZGl2IGNsYXNzPVwibG9hZGluZy13cmFwcGVyXCI+XHJcbiAgICAgICAgPGRpdj5sb2FkaW5nOiB7cHJvZ3Jlc3N9L3thbGx9PC9kaXY+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImxkcy1yaXBwbGVcIj5cclxuICAgICAgICAgIDxkaXYgLz5cclxuICAgICAgICAgIDxkaXYgLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgPC9kaXY+XHJcbiAgICB7OnRoZW4gZ3JvdXBzfVxyXG5cclxuICAgICAgeyNlYWNoIGdyb3VwcyB8fCBbXSBhcyBncm91cH1cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXBcIj5cclxuXHJcbiAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtaGVhZGVyXCI+XHJcbiAgICAgICAgICAgIDxoMj57Z3JvdXAubmFtZSArICcgLy8gJyArIGdyb3VwLmNvdW50IHx8ICdubyBuYW1lJ308L2gyPlxyXG4gICAgICAgICAgICA8YnV0dG9uIG9uOmNsaWNrPXsoKSA9PiB0b2dnbGVHcm91cFZpc2liaWxpdHkoZ3JvdXApfT5cclxuICAgICAgICAgICAgICB0b2dnbGVcclxuICAgICAgICAgICAgPC9idXR0b24+XHJcbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC1zdGF0aXN0aWNzXCI+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGJsdWVcIj57Z3JvdXAubWFuYS5ibHVlfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSBibGFja1wiPntncm91cC5tYW5hLmJsYWNrfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSByZWRcIj57Z3JvdXAubWFuYS5yZWR9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIHdoaXRlXCI+e2dyb3VwLm1hbmEud2hpdGV9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGdyZWVuXCI+e2dyb3VwLm1hbmEuZ3JlZW59PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGNvbG9ybGVzc1wiPntncm91cC5tYW5hLmNvbG9ybGVzc308L2Rpdj5cclxuICAgICAgICAgICAgICA8IS0tIGdlbmVyaWM6XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGdlbmVyaWNcIj57Z3JvdXAubWFuYS5nZW5lcmljfTwvZGl2PiAtLT5cclxuICAgICAgICAgICAgICBzdW06XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIHN1bVwiPntncm91cC5tYW5hLnN1bX08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgZ3JvdXAtY29zdFwiPlxyXG4gICAgICAgICAgICAgICAge2dyb3VwLmNvc3QudG9GaXhlZCgyKSArICckJ31cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgPC9kaXY+XHJcblxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgIGNsYXNzPVwiZ3JvdXAtY29udGVudFwiXHJcbiAgICAgICAgICAgIGNsYXNzOmhpZGRlbj17aGlkZGVuR3JvdXBzLmhhcyhncm91cC5uYW1lKX0+XHJcblxyXG4gICAgICAgICAgICB7I2VhY2ggZ3JvdXAuY2FyZHMgYXMgY2FyZH1cclxuICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICBjbGFzcz1cImVudHJ5XCJcclxuICAgICAgICAgICAgICAgIHN0eWxlPXsnd2lkdGg6JyArIHdpZHRoICsgJ3B4OyBoZWlnaHQ6JyArIChjYXJkLmNvdW50IDw9IDQgPyBoZWlnaHQgKyAoKGNhcmQuY291bnQgfHwgMSkgLSAxKSAqIDQwIDogaGVpZ2h0ICsgMyAqIDQwKSArICdweDsnfT5cclxuXHJcbiAgICAgICAgICAgICAgICB7I2VhY2ggeyBsZW5ndGg6IGNhcmQuY291bnQgPiA0ID8gNCA6IGNhcmQuY291bnQgfSBhcyBfLCBpfVxyXG4gICAgICAgICAgICAgICAgICA8aW1nXHJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M6YmFubmVkPXtjYXJkLmRhdGEubGVnYWxpdGllc1tmb3JtYXQudmFsdWVdICE9PSAnbGVnYWwnfVxyXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzOmhpZ2hsaWdodGVkPXtkZXZvdGlvbkhpZ2hsaWdodCA9PSBjYXJkLmRhdGEuY21jfVxyXG4gICAgICAgICAgICAgICAgICAgIG9uOmRibGNsaWNrPXsoKSA9PiByZW1vdmUoY2FyZCl9XHJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJjYXJkXCJcclxuICAgICAgICAgICAgICAgICAgICBzdHlsZT17J21hcmdpbi10b3A6ICcgKyBpICogNDAgKyAncHgnfVxyXG4gICAgICAgICAgICAgICAgICAgIHNyYz17Y2FyZC51cmx9XHJcbiAgICAgICAgICAgICAgICAgICAgYWx0PXtjYXJkLm5hbWV9XHJcbiAgICAgICAgICAgICAgICAgICAge3dpZHRofVxyXG4gICAgICAgICAgICAgICAgICAgIHtoZWlnaHR9IC8+XHJcbiAgICAgICAgICAgICAgICB7L2VhY2h9XHJcblxyXG4gICAgICAgICAgICAgICAgeyNpZiBjYXJkLmRhdGEubGVnYWxpdGllc1tmb3JtYXQudmFsdWVdICE9PSAnbGVnYWwnfVxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiYmFubmVkLXRleHRcIj5CQU5ORUQ8L2Rpdj5cclxuICAgICAgICAgICAgICAgIHsvaWZ9XHJcbiAgICAgICAgICAgICAgICB7I2lmIGNhcmQuY291bnQgPiA0fVxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiY291bnRcIj57Y2FyZC5jb3VudH14PC9kaXY+XHJcbiAgICAgICAgICAgICAgICB7L2lmfVxyXG5cclxuICAgICAgICAgICAgICAgIHsjaWYgc2NhbGluZyA+IDkwfVxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwicHJpY2VcIj57Y2FyZC5kYXRhLnByaWNlcy51c2QgKyAnJCcgfHwgJz8/Pyd9PC9kaXY+XHJcbiAgICAgICAgICAgICAgICB7L2lmfVxyXG5cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgey9lYWNofVxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgIHsvZWFjaH1cclxuXHJcbiAgICB7OmNhdGNoIGVycm9yfVxyXG5cclxuICAgICAgPGRpdiBjbGFzcz1cImVycm9yXCI+XHJcbiAgICAgICAgRVJST1IsIGNoZWNrIHlvdXIgZGVja2xpc3QgZm9yIGNvcnJlY3QgZm9ybWF0IG9yIGludGVybmV0IGNvbm5lY3Rpb25cclxuICAgICAgICBicnVkaVxyXG4gICAgICA8L2Rpdj5cclxuICAgIHsvYXdhaXR9XHJcbiAgPC9kaXY+XHJcblxyXG4gIDxkaXYgY2xhc3M9XCJjYXJkLXNlYXJjaFwiIGNsYXNzOmhpZGU9eyFjYXJkU2VhcmNoQWN0aXZlfT5cclxuICAgIDxkaXYgY2xhc3M9XCJ0b2dnbGUtc2VhcmNoXCIgb246Y2xpY2s9e3RvZ2dsZVNlYXJjaH0+eDwvZGl2PlxyXG4gICAgPGRpdiBjbGFzcz1cInNlYXJjaC1wYXJhbXNcIj5cclxuICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1wYXJhbVwiPlxyXG4gICAgICAgIE5hbWU6XHJcbiAgICAgICAgPGlucHV0IGJpbmQ6dGhpcz17c3BOYW1lfSAvPlxyXG4gICAgICA8L2Rpdj5cclxuICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1wYXJhbVwiPlxyXG4gICAgICAgIFRleHQ6XHJcbiAgICAgICAgPGlucHV0IGJpbmQ6dGhpcz17c3BUZXh0fSAvPlxyXG4gICAgICA8L2Rpdj5cclxuXHJcbiAgICAgIDxkaXYgY2xhc3M9XCJzZWFyY2gtcGFyYW0gY29sb3ItcGFyYW1cIj5cclxuICAgICAgICBDb21tYW5kZXItQ29sb3JzOlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJibHVlXCI+XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgdHlwZT1cImNoZWNrYm94XCJcclxuICAgICAgICAgICAgb246Y2xpY2s9e2NsZWFyQ29sb3JsZXNzfVxyXG4gICAgICAgICAgICBjbGFzcz1cImJsdWVcIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIQmx1ZX0gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiYmxhY2tcIj5cclxuICAgICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgICB0eXBlPVwiY2hlY2tib3hcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17Y2xlYXJDb2xvcmxlc3N9XHJcbiAgICAgICAgICAgIGNsYXNzPVwiYmxhY2tcIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIQmxhY2t9IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cInJlZFwiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJyZWRcIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIUmVkfSAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJ3aGl0ZVwiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJ3aGl0ZVwiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhXaGl0ZX0gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JlZW5cIj5cclxuICAgICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgICB0eXBlPVwiY2hlY2tib3hcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17Y2xlYXJDb2xvcmxlc3N9XHJcbiAgICAgICAgICAgIGNsYXNzPVwiZ3JlZW5cIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIR3JlZW59IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImNvbG9ybGVzc1wiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckZvckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJjb2xvcmxlc3NcIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIQ29sb3JsZXNzfSAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICA8L2Rpdj5cclxuICAgICAgPGJ1dHRvbiBvbjpjbGljaz17c2VhcmNoQ2FyZHN9PnNlYXJjaDwvYnV0dG9uPlxyXG4gICAgPC9kaXY+XHJcblxyXG4gICAgeyNhd2FpdCBjYXJkU2VhcmNoUHJvbWlzZX1cclxuICAgICAgPGRpdiBjbGFzcz1cImxvYWRpbmctd3JhcHBlclwiPlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJsZHMtcmlwcGxlXCI+XHJcbiAgICAgICAgICA8ZGl2IC8+XHJcbiAgICAgICAgICA8ZGl2IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgezp0aGVuIHJlc3VsdH1cclxuXHJcbiAgICAgIHsjaWYgcmVzdWx0LmNvZGUgIT09ICdub3RfZm91bmQnICYmIHJlc3VsdC5kYXRhfVxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJzZWFyY2gtcmVzdWx0XCI+XHJcbiAgICAgICAgICB7I2VhY2ggcmVzdWx0LmRhdGEgYXMgY2FyZH1cclxuICAgICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICAgIGNsYXNzPVwiZW50cnlcIlxyXG4gICAgICAgICAgICAgIHN0eWxlPXsnd2lkdGg6JyArIHdpZHRoICsgJ3B4OyBoZWlnaHQ6JyArIGhlaWdodCArICdweDsnfT5cclxuICAgICAgICAgICAgICA8aW1nXHJcbiAgICAgICAgICAgICAgICBvbjpkYmxjbGljaz17KCkgPT4gYXBwZW5kQ2FyZChjYXJkLm5hbWUpfVxyXG4gICAgICAgICAgICAgICAgY2xhc3M6YmFubmVkPXtjYXJkLmxlZ2FsaXRpZXNbZm9ybWF0LnZhbHVlXSAhPT0gJ2xlZ2FsJ31cclxuICAgICAgICAgICAgICAgIGNsYXNzPVwiY2FyZFwiXHJcbiAgICAgICAgICAgICAgICBzcmM9e2NhcmQudXJsfVxyXG4gICAgICAgICAgICAgICAgYWx0PXtjYXJkLm5hbWV9XHJcbiAgICAgICAgICAgICAgICB7d2lkdGh9XHJcbiAgICAgICAgICAgICAgICB7aGVpZ2h0fSAvPlxyXG5cclxuICAgICAgICAgICAgICB7I2lmIGNhcmQubGVnYWxpdGllc1tmb3JtYXQudmFsdWVdICE9PSAnbGVnYWwnfVxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImJhbm5lZC10ZXh0XCI+QkFOTkVEPC9kaXY+XHJcbiAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgICB7I2lmIHNjYWxpbmcgPiA5MH1cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJwcmljZVwiPntjYXJkLnByaWNlcy51c2QgKyAnJCcgfHwgJz8/Pyd9PC9kaXY+XHJcbiAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICB7OmVsc2V9XHJcbiAgICAgICAgICAgIDxkaXY+Tm8gY2FyZHMgZm91bmQ8L2Rpdj5cclxuICAgICAgICAgIHsvZWFjaH1cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8YnV0dG9uXHJcbiAgICAgICAgICBkaXNhYmxlZD17IXJlc3VsdC5oYXNfbW9yZX1cclxuICAgICAgICAgIG9uOmNsaWNrPXsoKSA9PiBzZWFyY2hDYXJkcyhyZXN1bHQubmV4dF9wYWdlKX0+XHJcbiAgICAgICAgICBuZXh0XHJcbiAgICAgICAgPC9idXR0b24+XHJcbiAgICAgIHs6ZWxzZX1cclxuICAgICAgICA8ZGl2Pk5vIGNhcmRzIGZvdW5kPC9kaXY+XHJcbiAgICAgIHsvaWZ9XHJcbiAgICB7OmNhdGNoIGVycm9yfVxyXG4gICAgICA8ZGl2IGNsYXNzPVwiZXJyb3JcIj5cclxuICAgICAgICBFUlJPUiwgY2hlY2sgeW91ciBkZWNrbGlzdCBmb3IgY29ycmVjdCBmb3JtYXQgb3IgaW50ZXJuZXQgY29ubmVjdGlvblxyXG4gICAgICAgIGJydWRpXHJcbiAgICAgIDwvZGl2PlxyXG4gICAgey9hd2FpdH1cclxuXHJcbiAgPC9kaXY+XHJcbjwvZGl2PlxyXG4iLCJpbXBvcnQgTWFpblZpZXcgZnJvbSBcIi4vZWRpdG9yLnN2ZWx0ZVwiO1xyXG5cclxuXHJcbmNvbnN0IHJlbmRlclRhcmdldCA9IG5ldyBNYWluVmlldyh7XHJcbiAgdGFyZ2V0OiBkb2N1bWVudC5ib2R5LFxyXG4gIHByb3BzOiB7XHJcbiAgICB0ZXN0OiBcInNkZmRzZlwiXHJcbiAgfVxyXG59KTsiXSwibmFtZXMiOlsiQ2FyZExvYWRlciIsIkNvb2tpZXMiLCJNYWluVmlldyJdLCJtYXBwaW5ncyI6Ijs7O0lBQUEsU0FBUyxJQUFJLEdBQUcsR0FBRztBQUNuQixJQU9BLFNBQVMsVUFBVSxDQUFDLEtBQUssRUFBRTtJQUMzQixJQUFJLE9BQU8sS0FBSyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxPQUFPLEtBQUssQ0FBQyxJQUFJLEtBQUssVUFBVSxDQUFDO0lBQ2xGLENBQUM7QUFDRCxJQUtBLFNBQVMsR0FBRyxDQUFDLEVBQUUsRUFBRTtJQUNqQixJQUFJLE9BQU8sRUFBRSxFQUFFLENBQUM7SUFDaEIsQ0FBQztJQUNELFNBQVMsWUFBWSxHQUFHO0lBQ3hCLElBQUksT0FBTyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQy9CLENBQUM7SUFDRCxTQUFTLE9BQU8sQ0FBQyxHQUFHLEVBQUU7SUFDdEIsSUFBSSxHQUFHLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ3JCLENBQUM7SUFDRCxTQUFTLFdBQVcsQ0FBQyxLQUFLLEVBQUU7SUFDNUIsSUFBSSxPQUFPLE9BQU8sS0FBSyxLQUFLLFVBQVUsQ0FB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R0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDcEYsSUFBSSxLQUFLLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUMxRSxJQUFJLElBQUksTUFBTSxHQUFHLGFBQWEsQ0FBQztJQUMvQixJQUFJLEtBQUssSUFBSSxHQUFHLElBQUksU0FBUyxFQUFFO0lBQy9CLE1BQU0sTUFBTSxJQUFJLElBQUksR0FBRyxHQUFHLENBQUMsS0FBSyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDO0lBQ2xELEtBQUs7SUFDTCxJQUFJLE1BQU0sSUFBSSxjQUFjLENBQUM7SUFDN0IsSUFBSSxLQUFLLElBQUksR0FBRyxJQUFJLE1BQU0sRUFBRTtJQUM1QixNQUFNLE1BQU0sSUFBSSxJQUFJLEdBQUcsR0FBRyxDQUFDLEtBQUssR0FBRyxHQUFHLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQztJQUNsRCxLQUFLOztJQUVMLElBQUksTUFBTSxJQUFJLGNBQWE7SUFDM0IsSUFBSSxLQUFLLElBQUksR0FBRyxJQUFJLEtBQUssRUFBRTtJQUMzQixNQUFNLE1BQU0sSUFBSSxJQUFJLEdBQUcsR0FBRyxDQUFDLEtBQUssR0FBRyxHQUFHLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQztJQUNsRCxLQUFLOztJQUVMLElBQUksTUFBTSxJQUFJLGNBQWE7SUFDM0IsSUFBSSxLQUFLLElBQUksR0FBRyxJQUFJLEtBQUssRUFBRTtJQUMzQixNQUFNLE1BQU0s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LENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDO0lBQ25GLFFBQVEsUUFBUSxDQUFDLEtBQUssSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUM7SUFDbkYsUUFBUSxRQUFRLENBQUMsU0FBUyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQztJQUN2RixRQUFRLFFBQVEsQ0FBQyxPQUFPLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUM7SUFDdEcsUUFBUSxRQUFRLENBQUMsR0FBRyxHQUFHLFFBQVEsQ0FBQyxJQUFJLEdBQUcsUUFBUSxDQUFDLEtBQUssR0FBRyxRQUFRLENBQUMsR0FBRyxHQUFHLFFBQVEsQ0FBQyxLQUFLLEdBQUcsUUFBUSxDQUFDLEtBQUssR0FBRyxRQUFRLENBQUMsU0FBUyxHQUFHLFFBQVEsQ0FBQyxPQUFPLENBQUM7SUFDL0ksT0FBTzs7OztJQUlQLE1BQU0sS0FBSyxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUM7SUFDMUIsTUFBTSxLQUFLLENBQUMsSUFBSSxHQUFHLFFBQVEsQ0FBQztJQUM1QixNQUFNLEtBQUssQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDOztJQUV4QixNQUFNLEtBQUssQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO0lBQ2xDLE1BQU0sS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7SUFDakQs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
