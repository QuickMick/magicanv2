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

            if (!isMaybe) {
              count += card.count;

              cost += parseFloat(card.data.prices.usd || 0) * card.count;

              if (card.data.type_line.toLowerCase().includes("land")) {
                landCount += card.count;
              } else {
                manaCurve[card.data.cmc || 0] = (manaCurve[card.data.cmc || 0] || 0) + card.count;
              }


              if (card.data.type_line.toLowerCase().includes("creature")) {
                console.log("creature", card.name, card.count);
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
        groups["sorceryCount"] = sorceryCount;
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
    	child_ctx[63] = list[i];
    	return child_ctx;
    }

    function get_each_context_3(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[73] = list[i];
    	child_ctx[75] = i;
    	return child_ctx;
    }

    function get_each_context_2(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[63] = list[i];
    	return child_ctx;
    }

    function get_each_context_1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[68] = list[i];
    	return child_ctx;
    }

    function get_each_context_4(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[76] = list[i];
    	child_ctx[75] = i;
    	return child_ctx;
    }

    function get_each_context_5(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[76] = list[i];
    	child_ctx[75] = i;
    	return child_ctx;
    }

    // (647:6) {#if helpActive}
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

    // (768:6) {:catch error}
    function create_catch_block_2(ctx) {
    	let t_value = /*error*/ ctx[66] + "";
    	let t;

    	return {
    		c() {
    			t = text(t_value);
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*promise*/ 64 && t_value !== (t_value = /*error*/ ctx[66] + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (667:6) {:then groups}
    function create_then_block_2(ctx) {
    	let t0;
    	let div;
    	let t1;
    	let input_1;
    	let mounted;
    	let dispose;
    	let if_block = !/*helpActive*/ ctx[23] && create_if_block_6(ctx);

    	function keyup_handler(...args) {
    		return /*keyup_handler*/ ctx[46](/*groups*/ ctx[67], ...args);
    	}

    	return {
    		c() {
    			if (if_block) if_block.c();
    			t0 = space();
    			div = element("div");
    			t1 = text("search:\r\n          ");
    			input_1 = element("input");
    			attr(input_1, "title", "e.g.: sacrifice a (artifact|creature)");
    		},
    		m(target, anchor) {
    			if (if_block) if_block.m(target, anchor);
    			insert(target, t0, anchor);
    			insert(target, div, anchor);
    			append(div, t1);
    			append(div, input_1);
    			/*input_1_binding*/ ctx[45](input_1);

    			if (!mounted) {
    				dispose = listen(input_1, "keyup", keyup_handler);
    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (!/*helpActive*/ ctx[23]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block_6(ctx);
    					if_block.c();
    					if_block.m(t0.parentNode, t0);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		d(detaching) {
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(t0);
    			if (detaching) detach(div);
    			/*input_1_binding*/ ctx[45](null);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (669:8) {#if !helpActive}
    function create_if_block_6(ctx) {
    	let h4;
    	let t1;
    	let div0;
    	let t2;
    	let t3_value = /*groups*/ ctx[67]["cardCount"] + "";
    	let t3;
    	let t4;
    	let div1;
    	let t5;
    	let t6_value = /*groups*/ ctx[67]["landCount"] + "";
    	let t6;
    	let t7;
    	let t8_value = /*groups*/ ctx[67]["cardCount"] - /*groups*/ ctx[67]["landCount"] + "";
    	let t8;
    	let t9;
    	let div2;
    	let t10;
    	let t11_value = /*groups*/ ctx[67]["creatureCount"] + "";
    	let t11;
    	let t12;
    	let div3;
    	let t13;
    	let t14_value = /*groups*/ ctx[67]["instantCount"] + "";
    	let t14;
    	let t15;
    	let div4;
    	let t16;
    	let t17_value = /*groups*/ ctx[67]["sorceryCount"] + "";
    	let t17;
    	let t18;
    	let div5;
    	let t19;
    	let t20_value = /*groups*/ ctx[67]["enchantmentCount"] + "";
    	let t20;
    	let t21;
    	let div6;
    	let t22;
    	let t23_value = /*groups*/ ctx[67]["artifactCount"] + "";
    	let t23;
    	let t24;
    	let div7;
    	let t25;
    	let t26_value = /*groups*/ ctx[67].cost.toFixed(2) + "$" + "";
    	let t26;
    	let t27;
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
    			insert(target, div7, anchor);
    			append(div7, t25);
    			append(div7, t26);
    			insert(target, t27, anchor);
    			if (if_block) if_block.m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*promise*/ 64 && t3_value !== (t3_value = /*groups*/ ctx[67]["cardCount"] + "")) set_data(t3, t3_value);
    			if (dirty[0] & /*promise*/ 64 && t6_value !== (t6_value = /*groups*/ ctx[67]["landCount"] + "")) set_data(t6, t6_value);
    			if (dirty[0] & /*promise*/ 64 && t8_value !== (t8_value = /*groups*/ ctx[67]["cardCount"] - /*groups*/ ctx[67]["landCount"] + "")) set_data(t8, t8_value);
    			if (dirty[0] & /*promise*/ 64 && t11_value !== (t11_value = /*groups*/ ctx[67]["creatureCount"] + "")) set_data(t11, t11_value);
    			if (dirty[0] & /*promise*/ 64 && t14_value !== (t14_value = /*groups*/ ctx[67]["instantCount"] + "")) set_data(t14, t14_value);
    			if (dirty[0] & /*promise*/ 64 && t17_value !== (t17_value = /*groups*/ ctx[67]["sorceryCount"] + "")) set_data(t17, t17_value);
    			if (dirty[0] & /*promise*/ 64 && t20_value !== (t20_value = /*groups*/ ctx[67]["enchantmentCount"] + "")) set_data(t20, t20_value);
    			if (dirty[0] & /*promise*/ 64 && t23_value !== (t23_value = /*groups*/ ctx[67]["artifactCount"] + "")) set_data(t23, t23_value);
    			if (dirty[0] & /*promise*/ 64 && t26_value !== (t26_value = /*groups*/ ctx[67].cost.toFixed(2) + "$" + "")) set_data(t26, t26_value);

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
    			if (detaching) detach(div7);
    			if (detaching) detach(t27);
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    // (685:10) {#if statisticsActive}
    function create_if_block_7(ctx) {
    	let div20;
    	let h40;
    	let t1;
    	let div6;
    	let div0;
    	let t2_value = /*groups*/ ctx[67]["mana"].blue + "";
    	let t2;
    	let t3;
    	let div1;
    	let t4_value = /*groups*/ ctx[67]["mana"].black + "";
    	let t4;
    	let t5;
    	let div2;
    	let t6_value = /*groups*/ ctx[67]["mana"].red + "";
    	let t6;
    	let t7;
    	let div3;
    	let t8_value = /*groups*/ ctx[67]["mana"].white + "";
    	let t8;
    	let t9;
    	let div4;
    	let t10_value = /*groups*/ ctx[67]["mana"].green + "";
    	let t10;
    	let t11;
    	let div5;
    	let t12_value = /*groups*/ ctx[67]["mana"].colorless + "";
    	let t12;
    	let t13;
    	let h41;
    	let t15;
    	let div7;
    	let t16;
    	let t17_value = /*groups*/ ctx[67]["mana"].generic + "";
    	let t17;
    	let t18;
    	let div8;
    	let t19;
    	let t20_value = /*groups*/ ctx[67]["mana"].sum + "";
    	let t20;
    	let t21;
    	let div9;
    	let t22;
    	let t23_value = /*groups*/ ctx[67]["averageMana"].toFixed(2) + "";
    	let t23;
    	let t24;
    	let h42;
    	let t26;
    	let div16;
    	let div10;
    	let t27_value = (/*groups*/ ctx[67]["manaProposal"].blue * /*groups*/ ctx[67]["landCount"]).toFixed(1) + "";
    	let t27;
    	let t28;
    	let div11;
    	let t29_value = (/*groups*/ ctx[67]["manaProposal"].black * /*groups*/ ctx[67]["landCount"]).toFixed(1) + "";
    	let t29;
    	let t30;
    	let div12;
    	let t31_value = (/*groups*/ ctx[67]["manaProposal"].red * /*groups*/ ctx[67]["landCount"]).toFixed(1) + "";
    	let t31;
    	let t32;
    	let div13;
    	let t33_value = (/*groups*/ ctx[67]["manaProposal"].white * /*groups*/ ctx[67]["landCount"]).toFixed(1) + "";
    	let t33;
    	let t34;
    	let div14;
    	let t35_value = (/*groups*/ ctx[67]["manaProposal"].green * /*groups*/ ctx[67]["landCount"]).toFixed(1) + "";
    	let t35;
    	let t36;
    	let div15;
    	let t37_value = (/*groups*/ ctx[67]["manaProposal"].colorless * /*groups*/ ctx[67]["landCount"]).toFixed(1) + "";
    	let t37;
    	let t38;
    	let h43;
    	let t40;
    	let div19;
    	let div17;
    	let t41;
    	let div18;
    	let each_value_5 = /*groups*/ ctx[67]["manaCurve"];
    	let each_blocks_1 = [];

    	for (let i = 0; i < each_value_5.length; i += 1) {
    		each_blocks_1[i] = create_each_block_5(get_each_context_5(ctx, each_value_5, i));
    	}

    	let each_value_4 = /*groups*/ ctx[67]["manaCurve"];
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
    			if (dirty[0] & /*promise*/ 64 && t2_value !== (t2_value = /*groups*/ ctx[67]["mana"].blue + "")) set_data(t2, t2_value);
    			if (dirty[0] & /*promise*/ 64 && t4_value !== (t4_value = /*groups*/ ctx[67]["mana"].black + "")) set_data(t4, t4_value);
    			if (dirty[0] & /*promise*/ 64 && t6_value !== (t6_value = /*groups*/ ctx[67]["mana"].red + "")) set_data(t6, t6_value);
    			if (dirty[0] & /*promise*/ 64 && t8_value !== (t8_value = /*groups*/ ctx[67]["mana"].white + "")) set_data(t8, t8_value);
    			if (dirty[0] & /*promise*/ 64 && t10_value !== (t10_value = /*groups*/ ctx[67]["mana"].green + "")) set_data(t10, t10_value);
    			if (dirty[0] & /*promise*/ 64 && t12_value !== (t12_value = /*groups*/ ctx[67]["mana"].colorless + "")) set_data(t12, t12_value);
    			if (dirty[0] & /*promise*/ 64 && t17_value !== (t17_value = /*groups*/ ctx[67]["mana"].generic + "")) set_data(t17, t17_value);
    			if (dirty[0] & /*promise*/ 64 && t20_value !== (t20_value = /*groups*/ ctx[67]["mana"].sum + "")) set_data(t20, t20_value);
    			if (dirty[0] & /*promise*/ 64 && t23_value !== (t23_value = /*groups*/ ctx[67]["averageMana"].toFixed(2) + "")) set_data(t23, t23_value);
    			if (dirty[0] & /*promise*/ 64 && t27_value !== (t27_value = (/*groups*/ ctx[67]["manaProposal"].blue * /*groups*/ ctx[67]["landCount"]).toFixed(1) + "")) set_data(t27, t27_value);
    			if (dirty[0] & /*promise*/ 64 && t29_value !== (t29_value = (/*groups*/ ctx[67]["manaProposal"].black * /*groups*/ ctx[67]["landCount"]).toFixed(1) + "")) set_data(t29, t29_value);
    			if (dirty[0] & /*promise*/ 64 && t31_value !== (t31_value = (/*groups*/ ctx[67]["manaProposal"].red * /*groups*/ ctx[67]["landCount"]).toFixed(1) + "")) set_data(t31, t31_value);
    			if (dirty[0] & /*promise*/ 64 && t33_value !== (t33_value = (/*groups*/ ctx[67]["manaProposal"].white * /*groups*/ ctx[67]["landCount"]).toFixed(1) + "")) set_data(t33, t33_value);
    			if (dirty[0] & /*promise*/ 64 && t35_value !== (t35_value = (/*groups*/ ctx[67]["manaProposal"].green * /*groups*/ ctx[67]["landCount"]).toFixed(1) + "")) set_data(t35, t35_value);
    			if (dirty[0] & /*promise*/ 64 && t37_value !== (t37_value = (/*groups*/ ctx[67]["manaProposal"].colorless * /*groups*/ ctx[67]["landCount"]).toFixed(1) + "")) set_data(t37, t37_value);

    			if (dirty[0] & /*devotionHighlight, highlightDevotion, promise*/ 16777312) {
    				each_value_5 = /*groups*/ ctx[67]["manaCurve"];
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

    			if (dirty[0] & /*devotionHighlight, highlightDevotion, promise*/ 16777312) {
    				each_value_4 = /*groups*/ ctx[67]["manaCurve"];
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

    // (730:20) {#if mana > 0}
    function create_if_block_9(ctx) {
    	let div1;
    	let div0;
    	let t0_value = (/*mana*/ ctx[76] || "") + "";
    	let t0;
    	let div0_style_value;
    	let t1;
    	let mounted;
    	let dispose;

    	function click_handler(...args) {
    		return /*click_handler*/ ctx[43](/*i*/ ctx[75], ...args);
    	}

    	return {
    		c() {
    			div1 = element("div");
    			div0 = element("div");
    			t0 = text(t0_value);
    			t1 = space();
    			attr(div0, "class", "curve-element svelte-cf5kd");
    			attr(div0, "style", div0_style_value = "height:" + getHeight(/*mana*/ ctx[76], /*groups*/ ctx[67]) + "%;");
    			attr(div1, "class", "curve-wrapper svelte-cf5kd");
    			toggle_class(div1, "highlighted", /*devotionHighlight*/ ctx[5] == /*i*/ ctx[75]);
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
    			if (dirty[0] & /*promise*/ 64 && t0_value !== (t0_value = (/*mana*/ ctx[76] || "") + "")) set_data(t0, t0_value);

    			if (dirty[0] & /*promise*/ 64 && div0_style_value !== (div0_style_value = "height:" + getHeight(/*mana*/ ctx[76], /*groups*/ ctx[67]) + "%;")) {
    				attr(div0, "style", div0_style_value);
    			}

    			if (dirty[0] & /*devotionHighlight*/ 32) {
    				toggle_class(div1, "highlighted", /*devotionHighlight*/ ctx[5] == /*i*/ ctx[75]);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div1);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (729:18) {#each groups['manaCurve'] as mana, i}
    function create_each_block_5(ctx) {
    	let if_block_anchor;
    	let if_block = /*mana*/ ctx[76] > 0 && create_if_block_9(ctx);

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
    			if (/*mana*/ ctx[76] > 0) {
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

    // (747:20) {#if mana > 0}
    function create_if_block_8(ctx) {
    	let div;
    	let t0;
    	let t1;
    	let mounted;
    	let dispose;

    	function click_handler_1(...args) {
    		return /*click_handler_1*/ ctx[44](/*i*/ ctx[75], ...args);
    	}

    	return {
    		c() {
    			div = element("div");
    			t0 = text(/*i*/ ctx[75]);
    			t1 = space();
    			attr(div, "class", "curve-label svelte-cf5kd");
    			toggle_class(div, "highlighted", /*devotionHighlight*/ ctx[5] == /*i*/ ctx[75]);
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
    				toggle_class(div, "highlighted", /*devotionHighlight*/ ctx[5] == /*i*/ ctx[75]);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (746:18) {#each groups['manaCurve'] as mana, i}
    function create_each_block_4(ctx) {
    	let if_block_anchor;
    	let if_block = /*mana*/ ctx[76] > 0 && create_if_block_8(ctx);

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
    			if (/*mana*/ ctx[76] > 0) {
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

    // (664:22)             <div>loading: {progress}
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

    // (897:4) {:catch error}
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

    // (831:4) {:then groups}
    function create_then_block_1(ctx) {
    	let each_1_anchor;
    	let each_value_1 = /*deckSeach*/ ctx[20] || /*groups*/ ctx[67] || [];
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
    			if (dirty[0] & /*hiddenGroups, deckSeach, promise, width, height, scaling, format, devotionHighlight, toggleGroupVisibility*/ 542114419 | dirty[1] & /*remove*/ 8) {
    				each_value_1 = /*deckSeach*/ ctx[20] || /*groups*/ ctx[67] || [];
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

    // (867:16) {#each { length: card.count > 4 ? 4 : card.count } as _, i}
    function create_each_block_3(ctx) {
    	let img;
    	let img_style_value;
    	let img_src_value;
    	let img_alt_value;
    	let mounted;
    	let dispose;

    	function dblclick_handler(...args) {
    		return /*dblclick_handler*/ ctx[51](/*card*/ ctx[63], ...args);
    	}

    	return {
    		c() {
    			img = element("img");
    			attr(img, "class", "card svelte-cf5kd");
    			attr(img, "style", img_style_value = "margin-top: " + /*i*/ ctx[75] * 40 + "px");
    			if (img.src !== (img_src_value = /*card*/ ctx[63].url)) attr(img, "src", img_src_value);
    			attr(img, "alt", img_alt_value = /*card*/ ctx[63].name);
    			attr(img, "width", /*width*/ ctx[1]);
    			attr(img, "height", /*height*/ ctx[0]);
    			toggle_class(img, "banned", /*card*/ ctx[63].data.legalities[/*format*/ ctx[9].value] !== "legal");
    			toggle_class(img, "highlighted", /*devotionHighlight*/ ctx[5] == /*card*/ ctx[63].data.cmc);
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

    			if (dirty[0] & /*deckSeach, promise*/ 1048640 && img.src !== (img_src_value = /*card*/ ctx[63].url)) {
    				attr(img, "src", img_src_value);
    			}

    			if (dirty[0] & /*deckSeach, promise*/ 1048640 && img_alt_value !== (img_alt_value = /*card*/ ctx[63].name)) {
    				attr(img, "alt", img_alt_value);
    			}

    			if (dirty[0] & /*width*/ 2) {
    				attr(img, "width", /*width*/ ctx[1]);
    			}

    			if (dirty[0] & /*height*/ 1) {
    				attr(img, "height", /*height*/ ctx[0]);
    			}

    			if (dirty[0] & /*deckSeach, promise, format*/ 1049152) {
    				toggle_class(img, "banned", /*card*/ ctx[63].data.legalities[/*format*/ ctx[9].value] !== "legal");
    			}

    			if (dirty[0] & /*devotionHighlight, deckSeach, promise*/ 1048672) {
    				toggle_class(img, "highlighted", /*devotionHighlight*/ ctx[5] == /*card*/ ctx[63].data.cmc);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(img);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (880:16) {#if card.data.legalities[format.value] !== 'legal'}
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

    // (883:16) {#if card.count > 4}
    function create_if_block_4(ctx) {
    	let div;
    	let t0_value = /*card*/ ctx[63].count + "";
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
    			if (dirty[0] & /*deckSeach, promise*/ 1048640 && t0_value !== (t0_value = /*card*/ ctx[63].count + "")) set_data(t0, t0_value);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (887:16) {#if scaling > 90}
    function create_if_block_3(ctx) {
    	let div;
    	let t_value = (/*card*/ ctx[63].data.prices.usd + "$" || "???") + "";
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
    			if (dirty[0] & /*deckSeach, promise*/ 1048640 && t_value !== (t_value = (/*card*/ ctx[63].data.prices.usd + "$" || "???") + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (862:12) {#each group.cards as card}
    function create_each_block_2(ctx) {
    	let div;
    	let t0;
    	let t1;
    	let t2;
    	let t3;
    	let div_style_value;

    	let each_value_3 = {
    		length: /*card*/ ctx[63].count > 4 ? 4 : /*card*/ ctx[63].count
    	};

    	let each_blocks = [];

    	for (let i = 0; i < each_value_3.length; i += 1) {
    		each_blocks[i] = create_each_block_3(get_each_context_3(ctx, each_value_3, i));
    	}

    	let if_block0 = /*card*/ ctx[63].data.legalities[/*format*/ ctx[9].value] !== "legal" && create_if_block_5(ctx);
    	let if_block1 = /*card*/ ctx[63].count > 4 && create_if_block_4(ctx);
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

    			attr(div, "style", div_style_value = "width:" + /*width*/ ctx[1] + "px; height:" + (/*card*/ ctx[63].count <= 4
    			? /*height*/ ctx[0] + ((/*card*/ ctx[63].count || 1) - 1) * 40
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
    			if (dirty[0] & /*deckSeach, promise, width, height, format, devotionHighlight*/ 1049187 | dirty[1] & /*remove*/ 8) {
    				each_value_3 = {
    					length: /*card*/ ctx[63].count > 4 ? 4 : /*card*/ ctx[63].count
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

    			if (/*card*/ ctx[63].data.legalities[/*format*/ ctx[9].value] !== "legal") {
    				if (if_block0) ; else {
    					if_block0 = create_if_block_5(ctx);
    					if_block0.c();
    					if_block0.m(div, t1);
    				}
    			} else if (if_block0) {
    				if_block0.d(1);
    				if_block0 = null;
    			}

    			if (/*card*/ ctx[63].count > 4) {
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

    			if (dirty[0] & /*width, deckSeach, promise, height*/ 1048643 && div_style_value !== (div_style_value = "width:" + /*width*/ ctx[1] + "px; height:" + (/*card*/ ctx[63].count <= 4
    			? /*height*/ ctx[0] + ((/*card*/ ctx[63].count || 1) - 1) * 40
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

    // (833:6) {#each deckSeach || groups || [] as group}
    function create_each_block_1(ctx) {
    	let div11;
    	let div9;
    	let h2;
    	let t0_value = (/*group*/ ctx[68].name + " // " + /*group*/ ctx[68].count || "no name") + "";
    	let t0;
    	let t1;
    	let button;
    	let t3;
    	let div8;
    	let div0;
    	let t4_value = /*group*/ ctx[68].mana.blue + "";
    	let t4;
    	let t5;
    	let div1;
    	let t6_value = /*group*/ ctx[68].mana.black + "";
    	let t6;
    	let t7;
    	let div2;
    	let t8_value = /*group*/ ctx[68].mana.red + "";
    	let t8;
    	let t9;
    	let div3;
    	let t10_value = /*group*/ ctx[68].mana.white + "";
    	let t10;
    	let t11;
    	let div4;
    	let t12_value = /*group*/ ctx[68].mana.green + "";
    	let t12;
    	let t13;
    	let div5;
    	let t14_value = /*group*/ ctx[68].mana.colorless + "";
    	let t14;
    	let t15;
    	let div6;
    	let t16_value = /*group*/ ctx[68].mana.sum + "";
    	let t16;
    	let t17;
    	let div7;
    	let t18_value = /*group*/ ctx[68].cost.toFixed(2) + "$" + "";
    	let t18;
    	let t19;
    	let div10;
    	let t20;
    	let mounted;
    	let dispose;

    	function click_handler_2(...args) {
    		return /*click_handler_2*/ ctx[50](/*group*/ ctx[68], ...args);
    	}

    	let each_value_2 = /*group*/ ctx[68].cards;
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
    			toggle_class(div10, "hidden", /*hiddenGroups*/ ctx[22].has(/*group*/ ctx[68].name));
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
    			if (dirty[0] & /*deckSeach, promise*/ 1048640 && t0_value !== (t0_value = (/*group*/ ctx[68].name + " // " + /*group*/ ctx[68].count || "no name") + "")) set_data(t0, t0_value);
    			if (dirty[0] & /*deckSeach, promise*/ 1048640 && t4_value !== (t4_value = /*group*/ ctx[68].mana.blue + "")) set_data(t4, t4_value);
    			if (dirty[0] & /*deckSeach, promise*/ 1048640 && t6_value !== (t6_value = /*group*/ ctx[68].mana.black + "")) set_data(t6, t6_value);
    			if (dirty[0] & /*deckSeach, promise*/ 1048640 && t8_value !== (t8_value = /*group*/ ctx[68].mana.red + "")) set_data(t8, t8_value);
    			if (dirty[0] & /*deckSeach, promise*/ 1048640 && t10_value !== (t10_value = /*group*/ ctx[68].mana.white + "")) set_data(t10, t10_value);
    			if (dirty[0] & /*deckSeach, promise*/ 1048640 && t12_value !== (t12_value = /*group*/ ctx[68].mana.green + "")) set_data(t12, t12_value);
    			if (dirty[0] & /*deckSeach, promise*/ 1048640 && t14_value !== (t14_value = /*group*/ ctx[68].mana.colorless + "")) set_data(t14, t14_value);
    			if (dirty[0] & /*deckSeach, promise*/ 1048640 && t16_value !== (t16_value = /*group*/ ctx[68].mana.sum + "")) set_data(t16, t16_value);
    			if (dirty[0] & /*deckSeach, promise*/ 1048640 && t18_value !== (t18_value = /*group*/ ctx[68].cost.toFixed(2) + "$" + "")) set_data(t18, t18_value);

    			if (dirty[0] & /*width, deckSeach, promise, height, scaling, format, devotionHighlight*/ 1049203 | dirty[1] & /*remove*/ 8) {
    				each_value_2 = /*group*/ ctx[68].cards;
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

    			if (dirty[0] & /*hiddenGroups, deckSeach, promise*/ 5242944) {
    				toggle_class(div10, "hidden", /*hiddenGroups*/ ctx[22].has(/*group*/ ctx[68].name));
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

    // (823:20)         <div class="loading-wrapper">          <div>loading: {progress}
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

    // (1009:4) {:catch error}
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

    // (973:4) {:then result}
    function create_then_block(ctx) {
    	let if_block_anchor;

    	function select_block_type(ctx, dirty) {
    		if (/*result*/ ctx[62].code !== "not_found" && /*result*/ ctx[62].data) return create_if_block;
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

    // (1006:6) {:else}
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

    // (975:6) {#if result.code !== 'not_found' && result.data}
    function create_if_block(ctx) {
    	let div;
    	let t0;
    	let button;
    	let t1;
    	let button_disabled_value;
    	let mounted;
    	let dispose;
    	let each_value = /*result*/ ctx[62].data;
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	let each_1_else = null;

    	if (!each_value.length) {
    		each_1_else = create_else_block(ctx);
    	}

    	function click_handler_3(...args) {
    		return /*click_handler_3*/ ctx[61](/*result*/ ctx[62], ...args);
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
    			button.disabled = button_disabled_value = !/*result*/ ctx[62].has_more;
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

    			if (dirty[0] & /*width, height, cardSearchPromise, scaling, format*/ 659 | dirty[1] & /*appendCard*/ 4) {
    				each_value = /*result*/ ctx[62].data;
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

    			if (dirty[0] & /*cardSearchPromise*/ 128 && button_disabled_value !== (button_disabled_value = !/*result*/ ctx[62].has_more)) {
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

    // (997:10) {:else}
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

    // (990:14) {#if card.legalities[format.value] !== 'legal'}
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

    // (993:14) {#if scaling > 90}
    function create_if_block_1(ctx) {
    	let div;
    	let t_value = (/*card*/ ctx[63].prices.usd + "$" || "???") + "";
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
    			if (dirty[0] & /*cardSearchPromise*/ 128 && t_value !== (t_value = (/*card*/ ctx[63].prices.usd + "$" || "???") + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (977:10) {#each result.data as card}
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
    		return /*dblclick_handler_1*/ ctx[60](/*card*/ ctx[63], ...args);
    	}

    	let if_block0 = /*card*/ ctx[63].legalities[/*format*/ ctx[9].value] !== "legal" && create_if_block_2(ctx);
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
    			if (img.src !== (img_src_value = /*card*/ ctx[63].url)) attr(img, "src", img_src_value);
    			attr(img, "alt", img_alt_value = /*card*/ ctx[63].name);
    			attr(img, "width", /*width*/ ctx[1]);
    			attr(img, "height", /*height*/ ctx[0]);
    			toggle_class(img, "banned", /*card*/ ctx[63].legalities[/*format*/ ctx[9].value] !== "legal");
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

    			if (dirty[0] & /*cardSearchPromise*/ 128 && img.src !== (img_src_value = /*card*/ ctx[63].url)) {
    				attr(img, "src", img_src_value);
    			}

    			if (dirty[0] & /*cardSearchPromise*/ 128 && img_alt_value !== (img_alt_value = /*card*/ ctx[63].name)) {
    				attr(img, "alt", img_alt_value);
    			}

    			if (dirty[0] & /*width*/ 2) {
    				attr(img, "width", /*width*/ ctx[1]);
    			}

    			if (dirty[0] & /*height*/ 1) {
    				attr(img, "height", /*height*/ ctx[0]);
    			}

    			if (dirty[0] & /*cardSearchPromise, format*/ 640) {
    				toggle_class(img, "banned", /*card*/ ctx[63].legalities[/*format*/ ctx[9].value] !== "legal");
    			}

    			if (/*card*/ ctx[63].legalities[/*format*/ ctx[9].value] !== "legal") {
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

    // (966:30)         <div class="loading-wrapper">          <div class="lds-ripple">            <div />            <div />          </div>        </div>      {:then result}
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

    	let t20_value = (/*statisticsActive*/ ctx[3]
    	? "hide statistics"
    	: "show statistics") + "";

    	let t20;
    	let t21;
    	let button1;
    	let t23;
    	let button2;
    	let t25;
    	let button3;
    	let t27;
    	let textarea;
    	let t28;
    	let div4;
    	let promise_2;
    	let t29;
    	let div16;
    	let div5;
    	let t31;
    	let div15;
    	let div6;
    	let t32;
    	let input1;
    	let t33;
    	let div7;
    	let t34;
    	let input2;
    	let t35;
    	let div14;
    	let t36;
    	let div8;
    	let input3;
    	let t37;
    	let div9;
    	let input4;
    	let t38;
    	let div10;
    	let input5;
    	let t39;
    	let div11;
    	let input6;
    	let t40;
    	let div12;
    	let input7;
    	let t41;
    	let div13;
    	let input8;
    	let t42;
    	let button4;
    	let t44;
    	let promise_3;
    	let mounted;
    	let dispose;
    	let if_block = /*helpActive*/ ctx[23] && create_if_block_10(ctx);

    	let info = {
    		ctx,
    		current: null,
    		token: null,
    		pending: create_pending_block_2,
    		then: create_then_block_2,
    		catch: create_catch_block_2,
    		value: 67,
    		error: 66
    	};

    	handle_promise(promise_1 = /*promise*/ ctx[6], info);

    	let info_1 = {
    		ctx,
    		current: null,
    		token: null,
    		pending: create_pending_block_1,
    		then: create_then_block_1,
    		catch: create_catch_block_1,
    		value: 67,
    		error: 66
    	};

    	handle_promise(promise_2 = /*promise*/ ctx[6], info_1);

    	let info_2 = {
    		ctx,
    		current: null,
    		token: null,
    		pending: create_pending_block,
    		then: create_then_block,
    		catch: create_catch_block,
    		value: 62,
    		error: 66
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
    			t20 = text(t20_value);
    			t21 = space();
    			button1 = element("button");
    			button1.textContent = "sort";
    			t23 = space();
    			button2 = element("button");
    			button2.textContent = "clean copy";
    			t25 = space();
    			button3 = element("button");
    			button3.textContent = "refresh";
    			t27 = space();
    			textarea = element("textarea");
    			t28 = space();
    			div4 = element("div");
    			info_1.block.c();
    			t29 = space();
    			div16 = element("div");
    			div5 = element("div");
    			div5.textContent = "x";
    			t31 = space();
    			div15 = element("div");
    			div6 = element("div");
    			t32 = text("Name:\r\n        ");
    			input1 = element("input");
    			t33 = space();
    			div7 = element("div");
    			t34 = text("Text:\r\n        ");
    			input2 = element("input");
    			t35 = space();
    			div14 = element("div");
    			t36 = text("Commander-Colors:\r\n        ");
    			div8 = element("div");
    			input3 = element("input");
    			t37 = space();
    			div9 = element("div");
    			input4 = element("input");
    			t38 = space();
    			div10 = element("div");
    			input5 = element("input");
    			t39 = space();
    			div11 = element("div");
    			input6 = element("input");
    			t40 = space();
    			div12 = element("div");
    			input7 = element("input");
    			t41 = space();
    			div13 = element("div");
    			input8 = element("input");
    			t42 = space();
    			button4 = element("button");
    			button4.textContent = "search";
    			t44 = space();
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
    			attr(select, "title", "select the legality checker");
    			attr(input0, "type", "range");
    			attr(input0, "min", "25");
    			attr(input0, "max", "100");
    			attr(input0, "title", "scales the card size in the right view");
    			attr(div1, "class", "slidecontainer");
    			attr(button0, "title", "toggles the visibility of the statisticks");
    			attr(button1, "title", "this sorts the deck to lands spells and creatures -NOTE: your\r\n        groups will be replaced");
    			attr(button2, "title", "this copies the deck without groups and stuff to your clipboard");
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
    			/*select_binding*/ ctx[47](select);
    			append(div2, t17);
    			append(div2, div1);
    			append(div1, t18);
    			append(div1, input0);
    			set_input_value(input0, /*scaling*/ ctx[4]);
    			append(div2, t19);
    			append(div2, button0);
    			append(button0, t20);
    			append(div2, t21);
    			append(div2, button1);
    			append(div2, t23);
    			append(div2, button2);
    			append(div2, t25);
    			append(div2, button3);
    			append(div3, t27);
    			append(div3, textarea);
    			/*textarea_binding*/ ctx[49](textarea);
    			append(div17, t28);
    			append(div17, div4);
    			info_1.block.m(div4, info_1.anchor = null);
    			info_1.mount = () => div4;
    			info_1.anchor = null;
    			append(div17, t29);
    			append(div17, div16);
    			append(div16, div5);
    			append(div16, t31);
    			append(div16, div15);
    			append(div15, div6);
    			append(div6, t32);
    			append(div6, input1);
    			/*input1_binding*/ ctx[52](input1);
    			append(div15, t33);
    			append(div15, div7);
    			append(div7, t34);
    			append(div7, input2);
    			/*input2_binding*/ ctx[53](input2);
    			append(div15, t35);
    			append(div15, div14);
    			append(div14, t36);
    			append(div14, div8);
    			append(div8, input3);
    			/*input3_binding*/ ctx[54](input3);
    			append(div14, t37);
    			append(div14, div9);
    			append(div9, input4);
    			/*input4_binding*/ ctx[55](input4);
    			append(div14, t38);
    			append(div14, div10);
    			append(div10, input5);
    			/*input5_binding*/ ctx[56](input5);
    			append(div14, t39);
    			append(div14, div11);
    			append(div11, input6);
    			/*input6_binding*/ ctx[57](input6);
    			append(div14, t40);
    			append(div14, div12);
    			append(div12, input7);
    			/*input7_binding*/ ctx[58](input7);
    			append(div14, t41);
    			append(div14, div13);
    			append(div13, input8);
    			/*input8_binding*/ ctx[59](input8);
    			append(div15, t42);
    			append(div15, button4);
    			append(div16, t44);
    			info_2.block.m(div16, info_2.anchor = null);
    			info_2.mount = () => div16;
    			info_2.anchor = null;

    			if (!mounted) {
    				dispose = [
    					listen(window, "keyup", /*update*/ ctx[31]),
    					listen(div0, "click", /*openHelp*/ ctx[37]),
    					listen(select, "blur", /*reload*/ ctx[32]),
    					listen(select, "change", /*reload*/ ctx[32]),
    					listen(input0, "change", /*input0_change_input_handler*/ ctx[48]),
    					listen(input0, "input", /*input0_change_input_handler*/ ctx[48]),
    					listen(button0, "click", /*toggleStatistics*/ ctx[39]),
    					listen(button1, "click", /*sortDeckString*/ ctx[30]),
    					listen(button2, "click", /*copyDeck*/ ctx[35]),
    					listen(button3, "click", /*reload*/ ctx[32]),
    					listen(textarea, "keyup", /*onTyping*/ ctx[36]),
    					listen(div5, "click", /*toggleSearch*/ ctx[38]),
    					listen(input3, "click", /*clearColorless*/ ctx[27]),
    					listen(input4, "click", /*clearColorless*/ ctx[27]),
    					listen(input5, "click", /*clearColorless*/ ctx[27]),
    					listen(input6, "click", /*clearColorless*/ ctx[27]),
    					listen(input7, "click", /*clearColorless*/ ctx[27]),
    					listen(input8, "click", /*clearForColorless*/ ctx[26]),
    					listen(button4, "click", /*searchCards*/ ctx[28])
    				];

    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (/*helpActive*/ ctx[23]) {
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
    				child_ctx[67] = info.resolved;
    				info.block.p(child_ctx, dirty);
    			}

    			if (dirty[0] & /*scaling*/ 16) {
    				set_input_value(input0, /*scaling*/ ctx[4]);
    			}

    			if (dirty[0] & /*statisticsActive*/ 8 && t20_value !== (t20_value = (/*statisticsActive*/ ctx[3]
    			? "hide statistics"
    			: "show statistics") + "")) set_data(t20, t20_value);

    			info_1.ctx = ctx;

    			if (dirty[0] & /*promise*/ 64 && promise_2 !== (promise_2 = /*promise*/ ctx[6]) && handle_promise(promise_2, info_1)) ; else {
    				const child_ctx = ctx.slice();
    				child_ctx[67] = info_1.resolved;
    				info_1.block.p(child_ctx, dirty);
    			}

    			info_2.ctx = ctx;

    			if (dirty[0] & /*cardSearchPromise*/ 128 && promise_3 !== (promise_3 = /*cardSearchPromise*/ ctx[7]) && handle_promise(promise_3, info_2)) ; else {
    				const child_ctx = ctx.slice();
    				child_ctx[62] = info_2.resolved;
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
    			/*select_binding*/ ctx[47](null);
    			/*textarea_binding*/ ctx[49](null);
    			info_1.block.d();
    			info_1.token = null;
    			info_1 = null;
    			/*input1_binding*/ ctx[52](null);
    			/*input2_binding*/ ctx[53](null);
    			/*input3_binding*/ ctx[54](null);
    			/*input4_binding*/ ctx[55](null);
    			/*input5_binding*/ ctx[56](null);
    			/*input6_binding*/ ctx[57](null);
    			/*input7_binding*/ ctx[58](null);
    			/*input8_binding*/ ctx[59](null);
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
    	let deckSeach = null;
    	let deckSearchInput;

    	function changeDeckSearch(groups) {
    		if (!groups) returndeckSeach = null;
    		let s = deckSearchInput.value;
    		if (!s) return $$invalidate(20, deckSeach = null);
    		s = s.trim().replace(/\s\s+/gm, " ").toLowerCase().replace(/\s/gm, "(.|\n)*");

    		/*.split("+")
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

    		$$invalidate(20, deckSeach = [
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
    		$$invalidate(22, hiddenGroups);
    	}

    	function sp(p, a) {
    		$$invalidate(10, progress = p);
    		$$invalidate(11, all = a);
    	}

    	function resetDeckSearch() {
    		$$invalidate(20, deckSeach = null);
    		if (!deckSearchInput) return;
    		$$invalidate(21, deckSearchInput.value = "", deckSearchInput);
    	}

    	function sortDeckString() {
    		$$invalidate(6, promise = cardLoader.sort(input.value || "", (p, a) => {
    			resetDeckSearch();
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
    			resetDeckSearch();
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
    		resetDeckSearch();
    		update({ keyCode: 27 });
    	}

    	function appendCard(name) {
    		if (!name) return;
    		resetDeckSearch();
    		$$invalidate(8, input.value = input.value + "\n1 " + name, input);
    		reload();
    	}

    	function remove(card) {
    		const r = new RegExp(`^.*${card.name}.*$`, "gm");
    		$$invalidate(8, input.value = input.value.replace(r, "// " + card.count + " " + card.name), input);

    		$$invalidate(6, promise = cardLoader.createDeck(input.value || "", (p, a) => sp(p, a)).catch(e => {
    			console.error(e);
    			throw e;
    		}));
    	}

    	function copyDeck() {
    		const deck = input.value;
    		$$invalidate(8, input.value = input.value.replace(/#.*|\/\/.*/gm, "\n"), input);
    		input.select();
    		input.setSelectionRange(0, 99999);
    		document.execCommand("copy");
    		$$invalidate(8, input.value = deck, input);
    	}

    	let helpActive = true;

    	onMount(async () => {
    		const start = js_cookie.get("deck") || `#lands
mountain
2 plains
3 swamps
# main deck
20 blightsteel colossus`;

    		$$invalidate(23, helpActive = js_cookie.get("helpActive") == "true");
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
    		$$invalidate(23, helpActive = !helpActive);
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

    	function input_1_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(21, deckSearchInput = $$value);
    		});
    	}

    	const keyup_handler = groups => changeDeckSearch(groups);

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
    		deckSeach,
    		deckSearchInput,
    		hiddenGroups,
    		helpActive,
    		highlightDevotion,
    		changeDeckSearch,
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
    		resetDeckSearch,
    		click_handler,
    		click_handler_1,
    		input_1_binding,
    		keyup_handler,
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWRpdG9yLWJ1bmRsZS5qcyIsInNvdXJjZXMiOlsibm9kZV9tb2R1bGVzL3N2ZWx0ZS9pbnRlcm5hbC9pbmRleC5tanMiLCJjYXJkLWxvYWRlci5qcyIsIm5vZGVfbW9kdWxlcy9qcy1jb29raWUvc3JjL2pzLmNvb2tpZS5qcyIsImVkaXRvci5zdmVsdGUiLCJlZGl0b3ItbWFpbi5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJmdW5jdGlvbiBub29wKCkgeyB9XG5jb25zdCBpZGVudGl0eSA9IHggPT4geDtcbmZ1bmN0aW9uIGFzc2lnbih0YXIsIHNyYykge1xuICAgIC8vIEB0cy1pZ25vcmVcbiAgICBmb3IgKGNvbnN0IGsgaW4gc3JjKVxuICAgICAgICB0YXJba10gPSBzcmNba107XG4gICAgcmV0dXJuIHRhcjtcbn1cbmZ1bmN0aW9uIGlzX3Byb21pc2UodmFsdWUpIHtcbiAgICByZXR1cm4gdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgdmFsdWUudGhlbiA9PT0gJ2Z1bmN0aW9uJztcbn1cbmZ1bmN0aW9uIGFkZF9sb2NhdGlvbihlbGVtZW50LCBmaWxlLCBsaW5lLCBjb2x1bW4sIGNoYXIpIHtcbiAgICBlbGVtZW50Ll9fc3ZlbHRlX21ldGEgPSB7XG4gICAgICAgIGxvYzogeyBmaWxlLCBsaW5lLCBjb2x1bW4sIGNoYXIgfVxuICAgIH07XG59XG5mdW5jdGlvbiBydW4oZm4pIHtcbiAgICByZXR1cm4gZm4oKTtcbn1cbmZ1bmN0aW9uIGJsYW5rX29iamVjdCgpIHtcbiAgICByZXR1cm4gT2JqZWN0LmNyZWF0ZShudWxsKTtcbn1cbmZ1bmN0aW9uIHJ1bl9hbGwoZm5zKSB7XG4gICAgZm5zLmZvckVhY2gocnVuKTtcbn1cbmZ1bmN0aW9uIGlzX2Z1bmN0aW9uKHRoaW5nKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB0aGluZyA9PT0gJ2Z1bmN0aW9uJztcbn1cbmZ1bmN0aW9uIHNhZmVfbm90X2VxdWFsKGEsIGIpIHtcbiAgICByZXR1cm4gYSAhPSBhID8gYiA9PSBiIDogYSAhPT0gYiB8fCAoKGEgJiYgdHlwZW9mIGEgPT09ICdvYmplY3QnKSB8fCB0eXBlb2YgYSA9PT0gJ2Z1bmN0aW9uJyk7XG59XG5mdW5jdGlvbiBub3RfZXF1YWwoYSwgYikge1xuICAgIHJldHVybiBhICE9IGEgPyBiID09IGIgOiBhICE9PSBiO1xufVxuZnVuY3Rpb24gdmFsaWRhdGVfc3RvcmUoc3RvcmUsIG5hbWUpIHtcbiAgICBpZiAoc3RvcmUgIT0gbnVsbCAmJiB0eXBlb2Ygc3RvcmUuc3Vic2NyaWJlICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJyR7bmFtZX0nIGlzIG5vdCBhIHN0b3JlIHdpdGggYSAnc3Vic2NyaWJlJyBtZXRob2RgKTtcbiAgICB9XG59XG5mdW5jdGlvbiBzdWJzY3JpYmUoc3RvcmUsIC4uLmNhbGxiYWNrcykge1xuICAgIGlmIChzdG9yZSA9PSBudWxsKSB7XG4gICAgICAgIHJldHVybiBub29wO1xuICAgIH1cbiAgICBjb25zdCB1bnN1YiA9IHN0b3JlLnN1YnNjcmliZSguLi5jYWxsYmFja3MpO1xuICAgIHJldHVybiB1bnN1Yi51bnN1YnNjcmliZSA/ICgpID0+IHVuc3ViLnVuc3Vic2NyaWJlKCkgOiB1bnN1Yjtcbn1cbmZ1bmN0aW9uIGdldF9zdG9yZV92YWx1ZShzdG9yZSkge1xuICAgIGxldCB2YWx1ZTtcbiAgICBzdWJzY3JpYmUoc3RvcmUsIF8gPT4gdmFsdWUgPSBfKSgpO1xuICAgIHJldHVybiB2YWx1ZTtcbn1cbmZ1bmN0aW9uIGNvbXBvbmVudF9zdWJzY3JpYmUoY29tcG9uZW50LCBzdG9yZSwgY2FsbGJhY2spIHtcbiAgICBjb21wb25lbnQuJCQub25fZGVzdHJveS5wdXNoKHN1YnNjcmliZShzdG9yZSwgY2FsbGJhY2spKTtcbn1cbmZ1bmN0aW9uIGNyZWF0ZV9zbG90KGRlZmluaXRpb24sIGN0eCwgJCRzY29wZSwgZm4pIHtcbiAgICBpZiAoZGVmaW5pdGlvbikge1xuICAgICAgICBjb25zdCBzbG90X2N0eCA9IGdldF9zbG90X2NvbnRleHQoZGVmaW5pdGlvbiwgY3R4LCAkJHNjb3BlLCBmbik7XG4gICAgICAgIHJldHVybiBkZWZpbml0aW9uWzBdKHNsb3RfY3R4KTtcbiAgICB9XG59XG5mdW5jdGlvbiBnZXRfc2xvdF9jb250ZXh0KGRlZmluaXRpb24sIGN0eCwgJCRzY29wZSwgZm4pIHtcbiAgICByZXR1cm4gZGVmaW5pdGlvblsxXSAmJiBmblxuICAgICAgICA/IGFzc2lnbigkJHNjb3BlLmN0eC5zbGljZSgpLCBkZWZpbml0aW9uWzFdKGZuKGN0eCkpKVxuICAgICAgICA6ICQkc2NvcGUuY3R4O1xufVxuZnVuY3Rpb24gZ2V0X3Nsb3RfY2hhbmdlcyhkZWZpbml0aW9uLCAkJHNjb3BlLCBkaXJ0eSwgZm4pIHtcbiAgICBpZiAoZGVmaW5pdGlvblsyXSAmJiBmbikge1xuICAgICAgICBjb25zdCBsZXRzID0gZGVmaW5pdGlvblsyXShmbihkaXJ0eSkpO1xuICAgICAgICBpZiAoJCRzY29wZS5kaXJ0eSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICByZXR1cm4gbGV0cztcbiAgICAgICAgfVxuICAgICAgICBpZiAodHlwZW9mIGxldHMgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICBjb25zdCBtZXJnZWQgPSBbXTtcbiAgICAgICAgICAgIGNvbnN0IGxlbiA9IE1hdGgubWF4KCQkc2NvcGUuZGlydHkubGVuZ3RoLCBsZXRzLmxlbmd0aCk7XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxlbjsgaSArPSAxKSB7XG4gICAgICAgICAgICAgICAgbWVyZ2VkW2ldID0gJCRzY29wZS5kaXJ0eVtpXSB8IGxldHNbaV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gbWVyZ2VkO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAkJHNjb3BlLmRpcnR5IHwgbGV0cztcbiAgICB9XG4gICAgcmV0dXJuICQkc2NvcGUuZGlydHk7XG59XG5mdW5jdGlvbiB1cGRhdGVfc2xvdChzbG90LCBzbG90X2RlZmluaXRpb24sIGN0eCwgJCRzY29wZSwgZGlydHksIGdldF9zbG90X2NoYW5nZXNfZm4sIGdldF9zbG90X2NvbnRleHRfZm4pIHtcbiAgICBjb25zdCBzbG90X2NoYW5nZXMgPSBnZXRfc2xvdF9jaGFuZ2VzKHNsb3RfZGVmaW5pdGlvbiwgJCRzY29wZSwgZGlydHksIGdldF9zbG90X2NoYW5nZXNfZm4pO1xuICAgIGlmIChzbG90X2NoYW5nZXMpIHtcbiAgICAgICAgY29uc3Qgc2xvdF9jb250ZXh0ID0gZ2V0X3Nsb3RfY29udGV4dChzbG90X2RlZmluaXRpb24sIGN0eCwgJCRzY29wZSwgZ2V0X3Nsb3RfY29udGV4dF9mbik7XG4gICAgICAgIHNsb3QucChzbG90X2NvbnRleHQsIHNsb3RfY2hhbmdlcyk7XG4gICAgfVxufVxuZnVuY3Rpb24gZXhjbHVkZV9pbnRlcm5hbF9wcm9wcyhwcm9wcykge1xuICAgIGNvbnN0IHJlc3VsdCA9IHt9O1xuICAgIGZvciAoY29uc3QgayBpbiBwcm9wcylcbiAgICAgICAgaWYgKGtbMF0gIT09ICckJylcbiAgICAgICAgICAgIHJlc3VsdFtrXSA9IHByb3BzW2tdO1xuICAgIHJldHVybiByZXN1bHQ7XG59XG5mdW5jdGlvbiBjb21wdXRlX3Jlc3RfcHJvcHMocHJvcHMsIGtleXMpIHtcbiAgICBjb25zdCByZXN0ID0ge307XG4gICAga2V5cyA9IG5ldyBTZXQoa2V5cyk7XG4gICAgZm9yIChjb25zdCBrIGluIHByb3BzKVxuICAgICAgICBpZiAoIWtleXMuaGFzKGspICYmIGtbMF0gIT09ICckJylcbiAgICAgICAgICAgIHJlc3Rba10gPSBwcm9wc1trXTtcbiAgICByZXR1cm4gcmVzdDtcbn1cbmZ1bmN0aW9uIG9uY2UoZm4pIHtcbiAgICBsZXQgcmFuID0gZmFsc2U7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICguLi5hcmdzKSB7XG4gICAgICAgIGlmIChyYW4pXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIHJhbiA9IHRydWU7XG4gICAgICAgIGZuLmNhbGwodGhpcywgLi4uYXJncyk7XG4gICAgfTtcbn1cbmZ1bmN0aW9uIG51bGxfdG9fZW1wdHkodmFsdWUpIHtcbiAgICByZXR1cm4gdmFsdWUgPT0gbnVsbCA/ICcnIDogdmFsdWU7XG59XG5mdW5jdGlvbiBzZXRfc3RvcmVfdmFsdWUoc3RvcmUsIHJldCwgdmFsdWUgPSByZXQpIHtcbiAgICBzdG9yZS5zZXQodmFsdWUpO1xuICAgIHJldHVybiByZXQ7XG59XG5jb25zdCBoYXNfcHJvcCA9IChvYmosIHByb3ApID0+IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmosIHByb3ApO1xuZnVuY3Rpb24gYWN0aW9uX2Rlc3Ryb3llcihhY3Rpb25fcmVzdWx0KSB7XG4gICAgcmV0dXJuIGFjdGlvbl9yZXN1bHQgJiYgaXNfZnVuY3Rpb24oYWN0aW9uX3Jlc3VsdC5kZXN0cm95KSA/IGFjdGlvbl9yZXN1bHQuZGVzdHJveSA6IG5vb3A7XG59XG5cbmNvbnN0IGlzX2NsaWVudCA9IHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnO1xubGV0IG5vdyA9IGlzX2NsaWVudFxuICAgID8gKCkgPT4gd2luZG93LnBlcmZvcm1hbmNlLm5vdygpXG4gICAgOiAoKSA9PiBEYXRlLm5vdygpO1xubGV0IHJhZiA9IGlzX2NsaWVudCA/IGNiID0+IHJlcXVlc3RBbmltYXRpb25GcmFtZShjYikgOiBub29wO1xuLy8gdXNlZCBpbnRlcm5hbGx5IGZvciB0ZXN0aW5nXG5mdW5jdGlvbiBzZXRfbm93KGZuKSB7XG4gICAgbm93ID0gZm47XG59XG5mdW5jdGlvbiBzZXRfcmFmKGZuKSB7XG4gICAgcmFmID0gZm47XG59XG5cbmNvbnN0IHRhc2tzID0gbmV3IFNldCgpO1xuZnVuY3Rpb24gcnVuX3Rhc2tzKG5vdykge1xuICAgIHRhc2tzLmZvckVhY2godGFzayA9PiB7XG4gICAgICAgIGlmICghdGFzay5jKG5vdykpIHtcbiAgICAgICAgICAgIHRhc2tzLmRlbGV0ZSh0YXNrKTtcbiAgICAgICAgICAgIHRhc2suZigpO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgaWYgKHRhc2tzLnNpemUgIT09IDApXG4gICAgICAgIHJhZihydW5fdGFza3MpO1xufVxuLyoqXG4gKiBGb3IgdGVzdGluZyBwdXJwb3NlcyBvbmx5IVxuICovXG5mdW5jdGlvbiBjbGVhcl9sb29wcygpIHtcbiAgICB0YXNrcy5jbGVhcigpO1xufVxuLyoqXG4gKiBDcmVhdGVzIGEgbmV3IHRhc2sgdGhhdCBydW5zIG9uIGVhY2ggcmFmIGZyYW1lXG4gKiB1bnRpbCBpdCByZXR1cm5zIGEgZmFsc3kgdmFsdWUgb3IgaXMgYWJvcnRlZFxuICovXG5mdW5jdGlvbiBsb29wKGNhbGxiYWNrKSB7XG4gICAgbGV0IHRhc2s7XG4gICAgaWYgKHRhc2tzLnNpemUgPT09IDApXG4gICAgICAgIHJhZihydW5fdGFza3MpO1xuICAgIHJldHVybiB7XG4gICAgICAgIHByb21pc2U6IG5ldyBQcm9taXNlKGZ1bGZpbGwgPT4ge1xuICAgICAgICAgICAgdGFza3MuYWRkKHRhc2sgPSB7IGM6IGNhbGxiYWNrLCBmOiBmdWxmaWxsIH0pO1xuICAgICAgICB9KSxcbiAgICAgICAgYWJvcnQoKSB7XG4gICAgICAgICAgICB0YXNrcy5kZWxldGUodGFzayk7XG4gICAgICAgIH1cbiAgICB9O1xufVxuXG5mdW5jdGlvbiBhcHBlbmQodGFyZ2V0LCBub2RlKSB7XG4gICAgdGFyZ2V0LmFwcGVuZENoaWxkKG5vZGUpO1xufVxuZnVuY3Rpb24gaW5zZXJ0KHRhcmdldCwgbm9kZSwgYW5jaG9yKSB7XG4gICAgdGFyZ2V0Lmluc2VydEJlZm9yZShub2RlLCBhbmNob3IgfHwgbnVsbCk7XG59XG5mdW5jdGlvbiBkZXRhY2gobm9kZSkge1xuICAgIG5vZGUucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChub2RlKTtcbn1cbmZ1bmN0aW9uIGRlc3Ryb3lfZWFjaChpdGVyYXRpb25zLCBkZXRhY2hpbmcpIHtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGl0ZXJhdGlvbnMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgaWYgKGl0ZXJhdGlvbnNbaV0pXG4gICAgICAgICAgICBpdGVyYXRpb25zW2ldLmQoZGV0YWNoaW5nKTtcbiAgICB9XG59XG5mdW5jdGlvbiBlbGVtZW50KG5hbWUpIHtcbiAgICByZXR1cm4gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChuYW1lKTtcbn1cbmZ1bmN0aW9uIGVsZW1lbnRfaXMobmFtZSwgaXMpIHtcbiAgICByZXR1cm4gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChuYW1lLCB7IGlzIH0pO1xufVxuZnVuY3Rpb24gb2JqZWN0X3dpdGhvdXRfcHJvcGVydGllcyhvYmosIGV4Y2x1ZGUpIHtcbiAgICBjb25zdCB0YXJnZXQgPSB7fTtcbiAgICBmb3IgKGNvbnN0IGsgaW4gb2JqKSB7XG4gICAgICAgIGlmIChoYXNfcHJvcChvYmosIGspXG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICAmJiBleGNsdWRlLmluZGV4T2YoaykgPT09IC0xKSB7XG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICB0YXJnZXRba10gPSBvYmpba107XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRhcmdldDtcbn1cbmZ1bmN0aW9uIHN2Z19lbGVtZW50KG5hbWUpIHtcbiAgICByZXR1cm4gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKCdodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZycsIG5hbWUpO1xufVxuZnVuY3Rpb24gdGV4dChkYXRhKSB7XG4gICAgcmV0dXJuIGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKGRhdGEpO1xufVxuZnVuY3Rpb24gc3BhY2UoKSB7XG4gICAgcmV0dXJuIHRleHQoJyAnKTtcbn1cbmZ1bmN0aW9uIGVtcHR5KCkge1xuICAgIHJldHVybiB0ZXh0KCcnKTtcbn1cbmZ1bmN0aW9uIGxpc3Rlbihub2RlLCBldmVudCwgaGFuZGxlciwgb3B0aW9ucykge1xuICAgIG5vZGUuYWRkRXZlbnRMaXN0ZW5lcihldmVudCwgaGFuZGxlciwgb3B0aW9ucyk7XG4gICAgcmV0dXJuICgpID0+IG5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcihldmVudCwgaGFuZGxlciwgb3B0aW9ucyk7XG59XG5mdW5jdGlvbiBwcmV2ZW50X2RlZmF1bHQoZm4pIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgcmV0dXJuIGZuLmNhbGwodGhpcywgZXZlbnQpO1xuICAgIH07XG59XG5mdW5jdGlvbiBzdG9wX3Byb3BhZ2F0aW9uKGZuKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICByZXR1cm4gZm4uY2FsbCh0aGlzLCBldmVudCk7XG4gICAgfTtcbn1cbmZ1bmN0aW9uIHNlbGYoZm4pIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgaWYgKGV2ZW50LnRhcmdldCA9PT0gdGhpcylcbiAgICAgICAgICAgIGZuLmNhbGwodGhpcywgZXZlbnQpO1xuICAgIH07XG59XG5mdW5jdGlvbiBhdHRyKG5vZGUsIGF0dHJpYnV0ZSwgdmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbClcbiAgICAgICAgbm9kZS5yZW1vdmVBdHRyaWJ1dGUoYXR0cmlidXRlKTtcbiAgICBlbHNlIGlmIChub2RlLmdldEF0dHJpYnV0ZShhdHRyaWJ1dGUpICE9PSB2YWx1ZSlcbiAgICAgICAgbm9kZS5zZXRBdHRyaWJ1dGUoYXR0cmlidXRlLCB2YWx1ZSk7XG59XG5mdW5jdGlvbiBzZXRfYXR0cmlidXRlcyhub2RlLCBhdHRyaWJ1dGVzKSB7XG4gICAgLy8gQHRzLWlnbm9yZVxuICAgIGNvbnN0IGRlc2NyaXB0b3JzID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcnMobm9kZS5fX3Byb3RvX18pO1xuICAgIGZvciAoY29uc3Qga2V5IGluIGF0dHJpYnV0ZXMpIHtcbiAgICAgICAgaWYgKGF0dHJpYnV0ZXNba2V5XSA9PSBudWxsKSB7XG4gICAgICAgICAgICBub2RlLnJlbW92ZUF0dHJpYnV0ZShrZXkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGtleSA9PT0gJ3N0eWxlJykge1xuICAgICAgICAgICAgbm9kZS5zdHlsZS5jc3NUZXh0ID0gYXR0cmlidXRlc1trZXldO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGtleSA9PT0gJ19fdmFsdWUnKSB7XG4gICAgICAgICAgICBub2RlLnZhbHVlID0gbm9kZVtrZXldID0gYXR0cmlidXRlc1trZXldO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGRlc2NyaXB0b3JzW2tleV0gJiYgZGVzY3JpcHRvcnNba2V5XS5zZXQpIHtcbiAgICAgICAgICAgIG5vZGVba2V5XSA9IGF0dHJpYnV0ZXNba2V5XTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGF0dHIobm9kZSwga2V5LCBhdHRyaWJ1dGVzW2tleV0pO1xuICAgICAgICB9XG4gICAgfVxufVxuZnVuY3Rpb24gc2V0X3N2Z19hdHRyaWJ1dGVzKG5vZGUsIGF0dHJpYnV0ZXMpIHtcbiAgICBmb3IgKGNvbnN0IGtleSBpbiBhdHRyaWJ1dGVzKSB7XG4gICAgICAgIGF0dHIobm9kZSwga2V5LCBhdHRyaWJ1dGVzW2tleV0pO1xuICAgIH1cbn1cbmZ1bmN0aW9uIHNldF9jdXN0b21fZWxlbWVudF9kYXRhKG5vZGUsIHByb3AsIHZhbHVlKSB7XG4gICAgaWYgKHByb3AgaW4gbm9kZSkge1xuICAgICAgICBub2RlW3Byb3BdID0gdmFsdWU7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICBhdHRyKG5vZGUsIHByb3AsIHZhbHVlKTtcbiAgICB9XG59XG5mdW5jdGlvbiB4bGlua19hdHRyKG5vZGUsIGF0dHJpYnV0ZSwgdmFsdWUpIHtcbiAgICBub2RlLnNldEF0dHJpYnV0ZU5TKCdodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rJywgYXR0cmlidXRlLCB2YWx1ZSk7XG59XG5mdW5jdGlvbiBnZXRfYmluZGluZ19ncm91cF92YWx1ZShncm91cCkge1xuICAgIGNvbnN0IHZhbHVlID0gW107XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBncm91cC5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBpZiAoZ3JvdXBbaV0uY2hlY2tlZClcbiAgICAgICAgICAgIHZhbHVlLnB1c2goZ3JvdXBbaV0uX192YWx1ZSk7XG4gICAgfVxuICAgIHJldHVybiB2YWx1ZTtcbn1cbmZ1bmN0aW9uIHRvX251bWJlcih2YWx1ZSkge1xuICAgIHJldHVybiB2YWx1ZSA9PT0gJycgPyB1bmRlZmluZWQgOiArdmFsdWU7XG59XG5mdW5jdGlvbiB0aW1lX3Jhbmdlc190b19hcnJheShyYW5nZXMpIHtcbiAgICBjb25zdCBhcnJheSA9IFtdO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmFuZ2VzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgIGFycmF5LnB1c2goeyBzdGFydDogcmFuZ2VzLnN0YXJ0KGkpLCBlbmQ6IHJhbmdlcy5lbmQoaSkgfSk7XG4gICAgfVxuICAgIHJldHVybiBhcnJheTtcbn1cbmZ1bmN0aW9uIGNoaWxkcmVuKGVsZW1lbnQpIHtcbiAgICByZXR1cm4gQXJyYXkuZnJvbShlbGVtZW50LmNoaWxkTm9kZXMpO1xufVxuZnVuY3Rpb24gY2xhaW1fZWxlbWVudChub2RlcywgbmFtZSwgYXR0cmlidXRlcywgc3ZnKSB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBub2Rlcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBub2RlID0gbm9kZXNbaV07XG4gICAgICAgIGlmIChub2RlLm5vZGVOYW1lID09PSBuYW1lKSB7XG4gICAgICAgICAgICBsZXQgaiA9IDA7XG4gICAgICAgICAgICB3aGlsZSAoaiA8IG5vZGUuYXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBhdHRyaWJ1dGUgPSBub2RlLmF0dHJpYnV0ZXNbal07XG4gICAgICAgICAgICAgICAgaWYgKGF0dHJpYnV0ZXNbYXR0cmlidXRlLm5hbWVdKSB7XG4gICAgICAgICAgICAgICAgICAgIGorKztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUucmVtb3ZlQXR0cmlidXRlKGF0dHJpYnV0ZS5uYW1lKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gbm9kZXMuc3BsaWNlKGksIDEpWzBdO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBzdmcgPyBzdmdfZWxlbWVudChuYW1lKSA6IGVsZW1lbnQobmFtZSk7XG59XG5mdW5jdGlvbiBjbGFpbV90ZXh0KG5vZGVzLCBkYXRhKSB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBub2Rlcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBub2RlID0gbm9kZXNbaV07XG4gICAgICAgIGlmIChub2RlLm5vZGVUeXBlID09PSAzKSB7XG4gICAgICAgICAgICBub2RlLmRhdGEgPSAnJyArIGRhdGE7XG4gICAgICAgICAgICByZXR1cm4gbm9kZXMuc3BsaWNlKGksIDEpWzBdO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0ZXh0KGRhdGEpO1xufVxuZnVuY3Rpb24gY2xhaW1fc3BhY2Uobm9kZXMpIHtcbiAgICByZXR1cm4gY2xhaW1fdGV4dChub2RlcywgJyAnKTtcbn1cbmZ1bmN0aW9uIHNldF9kYXRhKHRleHQsIGRhdGEpIHtcbiAgICBkYXRhID0gJycgKyBkYXRhO1xuICAgIGlmICh0ZXh0LmRhdGEgIT09IGRhdGEpXG4gICAgICAgIHRleHQuZGF0YSA9IGRhdGE7XG59XG5mdW5jdGlvbiBzZXRfaW5wdXRfdmFsdWUoaW5wdXQsIHZhbHVlKSB7XG4gICAgaW5wdXQudmFsdWUgPSB2YWx1ZSA9PSBudWxsID8gJycgOiB2YWx1ZTtcbn1cbmZ1bmN0aW9uIHNldF9pbnB1dF90eXBlKGlucHV0LCB0eXBlKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgaW5wdXQudHlwZSA9IHR5cGU7XG4gICAgfVxuICAgIGNhdGNoIChlKSB7XG4gICAgICAgIC8vIGRvIG5vdGhpbmdcbiAgICB9XG59XG5mdW5jdGlvbiBzZXRfc3R5bGUobm9kZSwga2V5LCB2YWx1ZSwgaW1wb3J0YW50KSB7XG4gICAgbm9kZS5zdHlsZS5zZXRQcm9wZXJ0eShrZXksIHZhbHVlLCBpbXBvcnRhbnQgPyAnaW1wb3J0YW50JyA6ICcnKTtcbn1cbmZ1bmN0aW9uIHNlbGVjdF9vcHRpb24oc2VsZWN0LCB2YWx1ZSkge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgc2VsZWN0Lm9wdGlvbnMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9uID0gc2VsZWN0Lm9wdGlvbnNbaV07XG4gICAgICAgIGlmIChvcHRpb24uX192YWx1ZSA9PT0gdmFsdWUpIHtcbiAgICAgICAgICAgIG9wdGlvbi5zZWxlY3RlZCA9IHRydWU7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICB9XG59XG5mdW5jdGlvbiBzZWxlY3Rfb3B0aW9ucyhzZWxlY3QsIHZhbHVlKSB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWxlY3Qub3B0aW9ucy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBvcHRpb24gPSBzZWxlY3Qub3B0aW9uc1tpXTtcbiAgICAgICAgb3B0aW9uLnNlbGVjdGVkID0gfnZhbHVlLmluZGV4T2Yob3B0aW9uLl9fdmFsdWUpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIHNlbGVjdF92YWx1ZShzZWxlY3QpIHtcbiAgICBjb25zdCBzZWxlY3RlZF9vcHRpb24gPSBzZWxlY3QucXVlcnlTZWxlY3RvcignOmNoZWNrZWQnKSB8fCBzZWxlY3Qub3B0aW9uc1swXTtcbiAgICByZXR1cm4gc2VsZWN0ZWRfb3B0aW9uICYmIHNlbGVjdGVkX29wdGlvbi5fX3ZhbHVlO1xufVxuZnVuY3Rpb24gc2VsZWN0X211bHRpcGxlX3ZhbHVlKHNlbGVjdCkge1xuICAgIHJldHVybiBbXS5tYXAuY2FsbChzZWxlY3QucXVlcnlTZWxlY3RvckFsbCgnOmNoZWNrZWQnKSwgb3B0aW9uID0+IG9wdGlvbi5fX3ZhbHVlKTtcbn1cbi8vIHVuZm9ydHVuYXRlbHkgdGhpcyBjYW4ndCBiZSBhIGNvbnN0YW50IGFzIHRoYXQgd291bGRuJ3QgYmUgdHJlZS1zaGFrZWFibGVcbi8vIHNvIHdlIGNhY2hlIHRoZSByZXN1bHQgaW5zdGVhZFxubGV0IGNyb3Nzb3JpZ2luO1xuZnVuY3Rpb24gaXNfY3Jvc3NvcmlnaW4oKSB7XG4gICAgaWYgKGNyb3Nzb3JpZ2luID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY3Jvc3NvcmlnaW4gPSBmYWxzZTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB3aW5kb3cucGFyZW50KSB7XG4gICAgICAgICAgICAgICAgdm9pZCB3aW5kb3cucGFyZW50LmRvY3VtZW50O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY3Jvc3NvcmlnaW4gPSB0cnVlO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBjcm9zc29yaWdpbjtcbn1cbmZ1bmN0aW9uIGFkZF9yZXNpemVfbGlzdGVuZXIobm9kZSwgZm4pIHtcbiAgICBjb25zdCBjb21wdXRlZF9zdHlsZSA9IGdldENvbXB1dGVkU3R5bGUobm9kZSk7XG4gICAgY29uc3Qgel9pbmRleCA9IChwYXJzZUludChjb21wdXRlZF9zdHlsZS56SW5kZXgpIHx8IDApIC0gMTtcbiAgICBpZiAoY29tcHV0ZWRfc3R5bGUucG9zaXRpb24gPT09ICdzdGF0aWMnKSB7XG4gICAgICAgIG5vZGUuc3R5bGUucG9zaXRpb24gPSAncmVsYXRpdmUnO1xuICAgIH1cbiAgICBjb25zdCBpZnJhbWUgPSBlbGVtZW50KCdpZnJhbWUnKTtcbiAgICBpZnJhbWUuc2V0QXR0cmlidXRlKCdzdHlsZScsIGBkaXNwbGF5OiBibG9jazsgcG9zaXRpb246IGFic29sdXRlOyB0b3A6IDA7IGxlZnQ6IDA7IHdpZHRoOiAxMDAlOyBoZWlnaHQ6IDEwMCU7IGAgK1xuICAgICAgICBgb3ZlcmZsb3c6IGhpZGRlbjsgYm9yZGVyOiAwOyBvcGFjaXR5OiAwOyBwb2ludGVyLWV2ZW50czogbm9uZTsgei1pbmRleDogJHt6X2luZGV4fTtgKTtcbiAgICBpZnJhbWUuc2V0QXR0cmlidXRlKCdhcmlhLWhpZGRlbicsICd0cnVlJyk7XG4gICAgaWZyYW1lLnRhYkluZGV4ID0gLTE7XG4gICAgY29uc3QgY3Jvc3NvcmlnaW4gPSBpc19jcm9zc29yaWdpbigpO1xuICAgIGxldCB1bnN1YnNjcmliZTtcbiAgICBpZiAoY3Jvc3NvcmlnaW4pIHtcbiAgICAgICAgaWZyYW1lLnNyYyA9IGBkYXRhOnRleHQvaHRtbCw8c2NyaXB0Pm9ucmVzaXplPWZ1bmN0aW9uKCl7cGFyZW50LnBvc3RNZXNzYWdlKDAsJyonKX08L3NjcmlwdD5gO1xuICAgICAgICB1bnN1YnNjcmliZSA9IGxpc3Rlbih3aW5kb3csICdtZXNzYWdlJywgKGV2ZW50KSA9PiB7XG4gICAgICAgICAgICBpZiAoZXZlbnQuc291cmNlID09PSBpZnJhbWUuY29udGVudFdpbmRvdylcbiAgICAgICAgICAgICAgICBmbigpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIGlmcmFtZS5zcmMgPSAnYWJvdXQ6YmxhbmsnO1xuICAgICAgICBpZnJhbWUub25sb2FkID0gKCkgPT4ge1xuICAgICAgICAgICAgdW5zdWJzY3JpYmUgPSBsaXN0ZW4oaWZyYW1lLmNvbnRlbnRXaW5kb3csICdyZXNpemUnLCBmbik7XG4gICAgICAgIH07XG4gICAgfVxuICAgIGFwcGVuZChub2RlLCBpZnJhbWUpO1xuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgIGlmIChjcm9zc29yaWdpbikge1xuICAgICAgICAgICAgdW5zdWJzY3JpYmUoKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmICh1bnN1YnNjcmliZSAmJiBpZnJhbWUuY29udGVudFdpbmRvdykge1xuICAgICAgICAgICAgdW5zdWJzY3JpYmUoKTtcbiAgICAgICAgfVxuICAgICAgICBkZXRhY2goaWZyYW1lKTtcbiAgICB9O1xufVxuZnVuY3Rpb24gdG9nZ2xlX2NsYXNzKGVsZW1lbnQsIG5hbWUsIHRvZ2dsZSkge1xuICAgIGVsZW1lbnQuY2xhc3NMaXN0W3RvZ2dsZSA/ICdhZGQnIDogJ3JlbW92ZSddKG5hbWUpO1xufVxuZnVuY3Rpb24gY3VzdG9tX2V2ZW50KHR5cGUsIGRldGFpbCkge1xuICAgIGNvbnN0IGUgPSBkb2N1bWVudC5jcmVhdGVFdmVudCgnQ3VzdG9tRXZlbnQnKTtcbiAgICBlLmluaXRDdXN0b21FdmVudCh0eXBlLCBmYWxzZSwgZmFsc2UsIGRldGFpbCk7XG4gICAgcmV0dXJuIGU7XG59XG5mdW5jdGlvbiBxdWVyeV9zZWxlY3Rvcl9hbGwoc2VsZWN0b3IsIHBhcmVudCA9IGRvY3VtZW50LmJvZHkpIHtcbiAgICByZXR1cm4gQXJyYXkuZnJvbShwYXJlbnQucXVlcnlTZWxlY3RvckFsbChzZWxlY3RvcikpO1xufVxuY2xhc3MgSHRtbFRhZyB7XG4gICAgY29uc3RydWN0b3IoYW5jaG9yID0gbnVsbCkge1xuICAgICAgICB0aGlzLmEgPSBhbmNob3I7XG4gICAgICAgIHRoaXMuZSA9IHRoaXMubiA9IG51bGw7XG4gICAgfVxuICAgIG0oaHRtbCwgdGFyZ2V0LCBhbmNob3IgPSBudWxsKSB7XG4gICAgICAgIGlmICghdGhpcy5lKSB7XG4gICAgICAgICAgICB0aGlzLmUgPSBlbGVtZW50KHRhcmdldC5ub2RlTmFtZSk7XG4gICAgICAgICAgICB0aGlzLnQgPSB0YXJnZXQ7XG4gICAgICAgICAgICB0aGlzLmgoaHRtbCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5pKGFuY2hvcik7XG4gICAgfVxuICAgIGgoaHRtbCkge1xuICAgICAgICB0aGlzLmUuaW5uZXJIVE1MID0gaHRtbDtcbiAgICAgICAgdGhpcy5uID0gQXJyYXkuZnJvbSh0aGlzLmUuY2hpbGROb2Rlcyk7XG4gICAgfVxuICAgIGkoYW5jaG9yKSB7XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5uLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgICAgICBpbnNlcnQodGhpcy50LCB0aGlzLm5baV0sIGFuY2hvcik7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcChodG1sKSB7XG4gICAgICAgIHRoaXMuZCgpO1xuICAgICAgICB0aGlzLmgoaHRtbCk7XG4gICAgICAgIHRoaXMuaSh0aGlzLmEpO1xuICAgIH1cbiAgICBkKCkge1xuICAgICAgICB0aGlzLm4uZm9yRWFjaChkZXRhY2gpO1xuICAgIH1cbn1cblxuY29uc3QgYWN0aXZlX2RvY3MgPSBuZXcgU2V0KCk7XG5sZXQgYWN0aXZlID0gMDtcbi8vIGh0dHBzOi8vZ2l0aHViLmNvbS9kYXJrc2t5YXBwL3N0cmluZy1oYXNoL2Jsb2IvbWFzdGVyL2luZGV4LmpzXG5mdW5jdGlvbiBoYXNoKHN0cikge1xuICAgIGxldCBoYXNoID0gNTM4MTtcbiAgICBsZXQgaSA9IHN0ci5sZW5ndGg7XG4gICAgd2hpbGUgKGktLSlcbiAgICAgICAgaGFzaCA9ICgoaGFzaCA8PCA1KSAtIGhhc2gpIF4gc3RyLmNoYXJDb2RlQXQoaSk7XG4gICAgcmV0dXJuIGhhc2ggPj4+IDA7XG59XG5mdW5jdGlvbiBjcmVhdGVfcnVsZShub2RlLCBhLCBiLCBkdXJhdGlvbiwgZGVsYXksIGVhc2UsIGZuLCB1aWQgPSAwKSB7XG4gICAgY29uc3Qgc3RlcCA9IDE2LjY2NiAvIGR1cmF0aW9uO1xuICAgIGxldCBrZXlmcmFtZXMgPSAne1xcbic7XG4gICAgZm9yIChsZXQgcCA9IDA7IHAgPD0gMTsgcCArPSBzdGVwKSB7XG4gICAgICAgIGNvbnN0IHQgPSBhICsgKGIgLSBhKSAqIGVhc2UocCk7XG4gICAgICAgIGtleWZyYW1lcyArPSBwICogMTAwICsgYCV7JHtmbih0LCAxIC0gdCl9fVxcbmA7XG4gICAgfVxuICAgIGNvbnN0IHJ1bGUgPSBrZXlmcmFtZXMgKyBgMTAwJSB7JHtmbihiLCAxIC0gYil9fVxcbn1gO1xuICAgIGNvbnN0IG5hbWUgPSBgX19zdmVsdGVfJHtoYXNoKHJ1bGUpfV8ke3VpZH1gO1xuICAgIGNvbnN0IGRvYyA9IG5vZGUub3duZXJEb2N1bWVudDtcbiAgICBhY3RpdmVfZG9jcy5hZGQoZG9jKTtcbiAgICBjb25zdCBzdHlsZXNoZWV0ID0gZG9jLl9fc3ZlbHRlX3N0eWxlc2hlZXQgfHwgKGRvYy5fX3N2ZWx0ZV9zdHlsZXNoZWV0ID0gZG9jLmhlYWQuYXBwZW5kQ2hpbGQoZWxlbWVudCgnc3R5bGUnKSkuc2hlZXQpO1xuICAgIGNvbnN0IGN1cnJlbnRfcnVsZXMgPSBkb2MuX19zdmVsdGVfcnVsZXMgfHwgKGRvYy5fX3N2ZWx0ZV9ydWxlcyA9IHt9KTtcbiAgICBpZiAoIWN1cnJlbnRfcnVsZXNbbmFtZV0pIHtcbiAgICAgICAgY3VycmVudF9ydWxlc1tuYW1lXSA9IHRydWU7XG4gICAgICAgIHN0eWxlc2hlZXQuaW5zZXJ0UnVsZShgQGtleWZyYW1lcyAke25hbWV9ICR7cnVsZX1gLCBzdHlsZXNoZWV0LmNzc1J1bGVzLmxlbmd0aCk7XG4gICAgfVxuICAgIGNvbnN0IGFuaW1hdGlvbiA9IG5vZGUuc3R5bGUuYW5pbWF0aW9uIHx8ICcnO1xuICAgIG5vZGUuc3R5bGUuYW5pbWF0aW9uID0gYCR7YW5pbWF0aW9uID8gYCR7YW5pbWF0aW9ufSwgYCA6IGBgfSR7bmFtZX0gJHtkdXJhdGlvbn1tcyBsaW5lYXIgJHtkZWxheX1tcyAxIGJvdGhgO1xuICAgIGFjdGl2ZSArPSAxO1xuICAgIHJldHVybiBuYW1lO1xufVxuZnVuY3Rpb24gZGVsZXRlX3J1bGUobm9kZSwgbmFtZSkge1xuICAgIGNvbnN0IHByZXZpb3VzID0gKG5vZGUuc3R5bGUuYW5pbWF0aW9uIHx8ICcnKS5zcGxpdCgnLCAnKTtcbiAgICBjb25zdCBuZXh0ID0gcHJldmlvdXMuZmlsdGVyKG5hbWVcbiAgICAgICAgPyBhbmltID0+IGFuaW0uaW5kZXhPZihuYW1lKSA8IDAgLy8gcmVtb3ZlIHNwZWNpZmljIGFuaW1hdGlvblxuICAgICAgICA6IGFuaW0gPT4gYW5pbS5pbmRleE9mKCdfX3N2ZWx0ZScpID09PSAtMSAvLyByZW1vdmUgYWxsIFN2ZWx0ZSBhbmltYXRpb25zXG4gICAgKTtcbiAgICBjb25zdCBkZWxldGVkID0gcHJldmlvdXMubGVuZ3RoIC0gbmV4dC5sZW5ndGg7XG4gICAgaWYgKGRlbGV0ZWQpIHtcbiAgICAgICAgbm9kZS5zdHlsZS5hbmltYXRpb24gPSBuZXh0LmpvaW4oJywgJyk7XG4gICAgICAgIGFjdGl2ZSAtPSBkZWxldGVkO1xuICAgICAgICBpZiAoIWFjdGl2ZSlcbiAgICAgICAgICAgIGNsZWFyX3J1bGVzKCk7XG4gICAgfVxufVxuZnVuY3Rpb24gY2xlYXJfcnVsZXMoKSB7XG4gICAgcmFmKCgpID0+IHtcbiAgICAgICAgaWYgKGFjdGl2ZSlcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgYWN0aXZlX2RvY3MuZm9yRWFjaChkb2MgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc3R5bGVzaGVldCA9IGRvYy5fX3N2ZWx0ZV9zdHlsZXNoZWV0O1xuICAgICAgICAgICAgbGV0IGkgPSBzdHlsZXNoZWV0LmNzc1J1bGVzLmxlbmd0aDtcbiAgICAgICAgICAgIHdoaWxlIChpLS0pXG4gICAgICAgICAgICAgICAgc3R5bGVzaGVldC5kZWxldGVSdWxlKGkpO1xuICAgICAgICAgICAgZG9jLl9fc3ZlbHRlX3J1bGVzID0ge307XG4gICAgICAgIH0pO1xuICAgICAgICBhY3RpdmVfZG9jcy5jbGVhcigpO1xuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVfYW5pbWF0aW9uKG5vZGUsIGZyb20sIGZuLCBwYXJhbXMpIHtcbiAgICBpZiAoIWZyb20pXG4gICAgICAgIHJldHVybiBub29wO1xuICAgIGNvbnN0IHRvID0gbm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBpZiAoZnJvbS5sZWZ0ID09PSB0by5sZWZ0ICYmIGZyb20ucmlnaHQgPT09IHRvLnJpZ2h0ICYmIGZyb20udG9wID09PSB0by50b3AgJiYgZnJvbS5ib3R0b20gPT09IHRvLmJvdHRvbSlcbiAgICAgICAgcmV0dXJuIG5vb3A7XG4gICAgY29uc3QgeyBkZWxheSA9IDAsIGR1cmF0aW9uID0gMzAwLCBlYXNpbmcgPSBpZGVudGl0eSwgXG4gICAgLy8gQHRzLWlnbm9yZSB0b2RvOiBzaG91bGQgdGhpcyBiZSBzZXBhcmF0ZWQgZnJvbSBkZXN0cnVjdHVyaW5nPyBPciBzdGFydC9lbmQgYWRkZWQgdG8gcHVibGljIGFwaSBhbmQgZG9jdW1lbnRhdGlvbj9cbiAgICBzdGFydDogc3RhcnRfdGltZSA9IG5vdygpICsgZGVsYXksIFxuICAgIC8vIEB0cy1pZ25vcmUgdG9kbzpcbiAgICBlbmQgPSBzdGFydF90aW1lICsgZHVyYXRpb24sIHRpY2sgPSBub29wLCBjc3MgfSA9IGZuKG5vZGUsIHsgZnJvbSwgdG8gfSwgcGFyYW1zKTtcbiAgICBsZXQgcnVubmluZyA9IHRydWU7XG4gICAgbGV0IHN0YXJ0ZWQgPSBmYWxzZTtcbiAgICBsZXQgbmFtZTtcbiAgICBmdW5jdGlvbiBzdGFydCgpIHtcbiAgICAgICAgaWYgKGNzcykge1xuICAgICAgICAgICAgbmFtZSA9IGNyZWF0ZV9ydWxlKG5vZGUsIDAsIDEsIGR1cmF0aW9uLCBkZWxheSwgZWFzaW5nLCBjc3MpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghZGVsYXkpIHtcbiAgICAgICAgICAgIHN0YXJ0ZWQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgfVxuICAgIGZ1bmN0aW9uIHN0b3AoKSB7XG4gICAgICAgIGlmIChjc3MpXG4gICAgICAgICAgICBkZWxldGVfcnVsZShub2RlLCBuYW1lKTtcbiAgICAgICAgcnVubmluZyA9IGZhbHNlO1xuICAgIH1cbiAgICBsb29wKG5vdyA9PiB7XG4gICAgICAgIGlmICghc3RhcnRlZCAmJiBub3cgPj0gc3RhcnRfdGltZSkge1xuICAgICAgICAgICAgc3RhcnRlZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHN0YXJ0ZWQgJiYgbm93ID49IGVuZCkge1xuICAgICAgICAgICAgdGljaygxLCAwKTtcbiAgICAgICAgICAgIHN0b3AoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXJ1bm5pbmcpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc3RhcnRlZCkge1xuICAgICAgICAgICAgY29uc3QgcCA9IG5vdyAtIHN0YXJ0X3RpbWU7XG4gICAgICAgICAgICBjb25zdCB0ID0gMCArIDEgKiBlYXNpbmcocCAvIGR1cmF0aW9uKTtcbiAgICAgICAgICAgIHRpY2sodCwgMSAtIHQpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH0pO1xuICAgIHN0YXJ0KCk7XG4gICAgdGljaygwLCAxKTtcbiAgICByZXR1cm4gc3RvcDtcbn1cbmZ1bmN0aW9uIGZpeF9wb3NpdGlvbihub2RlKSB7XG4gICAgY29uc3Qgc3R5bGUgPSBnZXRDb21wdXRlZFN0eWxlKG5vZGUpO1xuICAgIGlmIChzdHlsZS5wb3NpdGlvbiAhPT0gJ2Fic29sdXRlJyAmJiBzdHlsZS5wb3NpdGlvbiAhPT0gJ2ZpeGVkJykge1xuICAgICAgICBjb25zdCB7IHdpZHRoLCBoZWlnaHQgfSA9IHN0eWxlO1xuICAgICAgICBjb25zdCBhID0gbm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgbm9kZS5zdHlsZS5wb3NpdGlvbiA9ICdhYnNvbHV0ZSc7XG4gICAgICAgIG5vZGUuc3R5bGUud2lkdGggPSB3aWR0aDtcbiAgICAgICAgbm9kZS5zdHlsZS5oZWlnaHQgPSBoZWlnaHQ7XG4gICAgICAgIGFkZF90cmFuc2Zvcm0obm9kZSwgYSk7XG4gICAgfVxufVxuZnVuY3Rpb24gYWRkX3RyYW5zZm9ybShub2RlLCBhKSB7XG4gICAgY29uc3QgYiA9IG5vZGUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgaWYgKGEubGVmdCAhPT0gYi5sZWZ0IHx8IGEudG9wICE9PSBiLnRvcCkge1xuICAgICAgICBjb25zdCBzdHlsZSA9IGdldENvbXB1dGVkU3R5bGUobm9kZSk7XG4gICAgICAgIGNvbnN0IHRyYW5zZm9ybSA9IHN0eWxlLnRyYW5zZm9ybSA9PT0gJ25vbmUnID8gJycgOiBzdHlsZS50cmFuc2Zvcm07XG4gICAgICAgIG5vZGUuc3R5bGUudHJhbnNmb3JtID0gYCR7dHJhbnNmb3JtfSB0cmFuc2xhdGUoJHthLmxlZnQgLSBiLmxlZnR9cHgsICR7YS50b3AgLSBiLnRvcH1weClgO1xuICAgIH1cbn1cblxubGV0IGN1cnJlbnRfY29tcG9uZW50O1xuZnVuY3Rpb24gc2V0X2N1cnJlbnRfY29tcG9uZW50KGNvbXBvbmVudCkge1xuICAgIGN1cnJlbnRfY29tcG9uZW50ID0gY29tcG9uZW50O1xufVxuZnVuY3Rpb24gZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkge1xuICAgIGlmICghY3VycmVudF9jb21wb25lbnQpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRnVuY3Rpb24gY2FsbGVkIG91dHNpZGUgY29tcG9uZW50IGluaXRpYWxpemF0aW9uYCk7XG4gICAgcmV0dXJuIGN1cnJlbnRfY29tcG9uZW50O1xufVxuZnVuY3Rpb24gYmVmb3JlVXBkYXRlKGZuKSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuYmVmb3JlX3VwZGF0ZS5wdXNoKGZuKTtcbn1cbmZ1bmN0aW9uIG9uTW91bnQoZm4pIHtcbiAgICBnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5vbl9tb3VudC5wdXNoKGZuKTtcbn1cbmZ1bmN0aW9uIGFmdGVyVXBkYXRlKGZuKSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuYWZ0ZXJfdXBkYXRlLnB1c2goZm4pO1xufVxuZnVuY3Rpb24gb25EZXN0cm95KGZuKSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQub25fZGVzdHJveS5wdXNoKGZuKTtcbn1cbmZ1bmN0aW9uIGNyZWF0ZUV2ZW50RGlzcGF0Y2hlcigpIHtcbiAgICBjb25zdCBjb21wb25lbnQgPSBnZXRfY3VycmVudF9jb21wb25lbnQoKTtcbiAgICByZXR1cm4gKHR5cGUsIGRldGFpbCkgPT4ge1xuICAgICAgICBjb25zdCBjYWxsYmFja3MgPSBjb21wb25lbnQuJCQuY2FsbGJhY2tzW3R5cGVdO1xuICAgICAgICBpZiAoY2FsbGJhY2tzKSB7XG4gICAgICAgICAgICAvLyBUT0RPIGFyZSB0aGVyZSBzaXR1YXRpb25zIHdoZXJlIGV2ZW50cyBjb3VsZCBiZSBkaXNwYXRjaGVkXG4gICAgICAgICAgICAvLyBpbiBhIHNlcnZlciAobm9uLURPTSkgZW52aXJvbm1lbnQ/XG4gICAgICAgICAgICBjb25zdCBldmVudCA9IGN1c3RvbV9ldmVudCh0eXBlLCBkZXRhaWwpO1xuICAgICAgICAgICAgY2FsbGJhY2tzLnNsaWNlKCkuZm9yRWFjaChmbiA9PiB7XG4gICAgICAgICAgICAgICAgZm4uY2FsbChjb21wb25lbnQsIGV2ZW50KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfTtcbn1cbmZ1bmN0aW9uIHNldENvbnRleHQoa2V5LCBjb250ZXh0KSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuY29udGV4dC5zZXQoa2V5LCBjb250ZXh0KTtcbn1cbmZ1bmN0aW9uIGdldENvbnRleHQoa2V5KSB7XG4gICAgcmV0dXJuIGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLmNvbnRleHQuZ2V0KGtleSk7XG59XG4vLyBUT0RPIGZpZ3VyZSBvdXQgaWYgd2Ugc3RpbGwgd2FudCB0byBzdXBwb3J0XG4vLyBzaG9ydGhhbmQgZXZlbnRzLCBvciBpZiB3ZSB3YW50IHRvIGltcGxlbWVudFxuLy8gYSByZWFsIGJ1YmJsaW5nIG1lY2hhbmlzbVxuZnVuY3Rpb24gYnViYmxlKGNvbXBvbmVudCwgZXZlbnQpIHtcbiAgICBjb25zdCBjYWxsYmFja3MgPSBjb21wb25lbnQuJCQuY2FsbGJhY2tzW2V2ZW50LnR5cGVdO1xuICAgIGlmIChjYWxsYmFja3MpIHtcbiAgICAgICAgY2FsbGJhY2tzLnNsaWNlKCkuZm9yRWFjaChmbiA9PiBmbihldmVudCkpO1xuICAgIH1cbn1cblxuY29uc3QgZGlydHlfY29tcG9uZW50cyA9IFtdO1xuY29uc3QgaW50cm9zID0geyBlbmFibGVkOiBmYWxzZSB9O1xuY29uc3QgYmluZGluZ19jYWxsYmFja3MgPSBbXTtcbmNvbnN0IHJlbmRlcl9jYWxsYmFja3MgPSBbXTtcbmNvbnN0IGZsdXNoX2NhbGxiYWNrcyA9IFtdO1xuY29uc3QgcmVzb2x2ZWRfcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xubGV0IHVwZGF0ZV9zY2hlZHVsZWQgPSBmYWxzZTtcbmZ1bmN0aW9uIHNjaGVkdWxlX3VwZGF0ZSgpIHtcbiAgICBpZiAoIXVwZGF0ZV9zY2hlZHVsZWQpIHtcbiAgICAgICAgdXBkYXRlX3NjaGVkdWxlZCA9IHRydWU7XG4gICAgICAgIHJlc29sdmVkX3Byb21pc2UudGhlbihmbHVzaCk7XG4gICAgfVxufVxuZnVuY3Rpb24gdGljaygpIHtcbiAgICBzY2hlZHVsZV91cGRhdGUoKTtcbiAgICByZXR1cm4gcmVzb2x2ZWRfcHJvbWlzZTtcbn1cbmZ1bmN0aW9uIGFkZF9yZW5kZXJfY2FsbGJhY2soZm4pIHtcbiAgICByZW5kZXJfY2FsbGJhY2tzLnB1c2goZm4pO1xufVxuZnVuY3Rpb24gYWRkX2ZsdXNoX2NhbGxiYWNrKGZuKSB7XG4gICAgZmx1c2hfY2FsbGJhY2tzLnB1c2goZm4pO1xufVxubGV0IGZsdXNoaW5nID0gZmFsc2U7XG5jb25zdCBzZWVuX2NhbGxiYWNrcyA9IG5ldyBTZXQoKTtcbmZ1bmN0aW9uIGZsdXNoKCkge1xuICAgIGlmIChmbHVzaGluZylcbiAgICAgICAgcmV0dXJuO1xuICAgIGZsdXNoaW5nID0gdHJ1ZTtcbiAgICBkbyB7XG4gICAgICAgIC8vIGZpcnN0LCBjYWxsIGJlZm9yZVVwZGF0ZSBmdW5jdGlvbnNcbiAgICAgICAgLy8gYW5kIHVwZGF0ZSBjb21wb25lbnRzXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGlydHlfY29tcG9uZW50cy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICAgICAgY29uc3QgY29tcG9uZW50ID0gZGlydHlfY29tcG9uZW50c1tpXTtcbiAgICAgICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChjb21wb25lbnQpO1xuICAgICAgICAgICAgdXBkYXRlKGNvbXBvbmVudC4kJCk7XG4gICAgICAgIH1cbiAgICAgICAgZGlydHlfY29tcG9uZW50cy5sZW5ndGggPSAwO1xuICAgICAgICB3aGlsZSAoYmluZGluZ19jYWxsYmFja3MubGVuZ3RoKVxuICAgICAgICAgICAgYmluZGluZ19jYWxsYmFja3MucG9wKCkoKTtcbiAgICAgICAgLy8gdGhlbiwgb25jZSBjb21wb25lbnRzIGFyZSB1cGRhdGVkLCBjYWxsXG4gICAgICAgIC8vIGFmdGVyVXBkYXRlIGZ1bmN0aW9ucy4gVGhpcyBtYXkgY2F1c2VcbiAgICAgICAgLy8gc3Vic2VxdWVudCB1cGRhdGVzLi4uXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmVuZGVyX2NhbGxiYWNrcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICAgICAgY29uc3QgY2FsbGJhY2sgPSByZW5kZXJfY2FsbGJhY2tzW2ldO1xuICAgICAgICAgICAgaWYgKCFzZWVuX2NhbGxiYWNrcy5oYXMoY2FsbGJhY2spKSB7XG4gICAgICAgICAgICAgICAgLy8gLi4uc28gZ3VhcmQgYWdhaW5zdCBpbmZpbml0ZSBsb29wc1xuICAgICAgICAgICAgICAgIHNlZW5fY2FsbGJhY2tzLmFkZChjYWxsYmFjayk7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZW5kZXJfY2FsbGJhY2tzLmxlbmd0aCA9IDA7XG4gICAgfSB3aGlsZSAoZGlydHlfY29tcG9uZW50cy5sZW5ndGgpO1xuICAgIHdoaWxlIChmbHVzaF9jYWxsYmFja3MubGVuZ3RoKSB7XG4gICAgICAgIGZsdXNoX2NhbGxiYWNrcy5wb3AoKSgpO1xuICAgIH1cbiAgICB1cGRhdGVfc2NoZWR1bGVkID0gZmFsc2U7XG4gICAgZmx1c2hpbmcgPSBmYWxzZTtcbiAgICBzZWVuX2NhbGxiYWNrcy5jbGVhcigpO1xufVxuZnVuY3Rpb24gdXBkYXRlKCQkKSB7XG4gICAgaWYgKCQkLmZyYWdtZW50ICE9PSBudWxsKSB7XG4gICAgICAgICQkLnVwZGF0ZSgpO1xuICAgICAgICBydW5fYWxsKCQkLmJlZm9yZV91cGRhdGUpO1xuICAgICAgICBjb25zdCBkaXJ0eSA9ICQkLmRpcnR5O1xuICAgICAgICAkJC5kaXJ0eSA9IFstMV07XG4gICAgICAgICQkLmZyYWdtZW50ICYmICQkLmZyYWdtZW50LnAoJCQuY3R4LCBkaXJ0eSk7XG4gICAgICAgICQkLmFmdGVyX3VwZGF0ZS5mb3JFYWNoKGFkZF9yZW5kZXJfY2FsbGJhY2spO1xuICAgIH1cbn1cblxubGV0IHByb21pc2U7XG5mdW5jdGlvbiB3YWl0KCkge1xuICAgIGlmICghcHJvbWlzZSkge1xuICAgICAgICBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIHByb21pc2UudGhlbigoKSA9PiB7XG4gICAgICAgICAgICBwcm9taXNlID0gbnVsbDtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBwcm9taXNlO1xufVxuZnVuY3Rpb24gZGlzcGF0Y2gobm9kZSwgZGlyZWN0aW9uLCBraW5kKSB7XG4gICAgbm9kZS5kaXNwYXRjaEV2ZW50KGN1c3RvbV9ldmVudChgJHtkaXJlY3Rpb24gPyAnaW50cm8nIDogJ291dHJvJ30ke2tpbmR9YCkpO1xufVxuY29uc3Qgb3V0cm9pbmcgPSBuZXcgU2V0KCk7XG5sZXQgb3V0cm9zO1xuZnVuY3Rpb24gZ3JvdXBfb3V0cm9zKCkge1xuICAgIG91dHJvcyA9IHtcbiAgICAgICAgcjogMCxcbiAgICAgICAgYzogW10sXG4gICAgICAgIHA6IG91dHJvcyAvLyBwYXJlbnQgZ3JvdXBcbiAgICB9O1xufVxuZnVuY3Rpb24gY2hlY2tfb3V0cm9zKCkge1xuICAgIGlmICghb3V0cm9zLnIpIHtcbiAgICAgICAgcnVuX2FsbChvdXRyb3MuYyk7XG4gICAgfVxuICAgIG91dHJvcyA9IG91dHJvcy5wO1xufVxuZnVuY3Rpb24gdHJhbnNpdGlvbl9pbihibG9jaywgbG9jYWwpIHtcbiAgICBpZiAoYmxvY2sgJiYgYmxvY2suaSkge1xuICAgICAgICBvdXRyb2luZy5kZWxldGUoYmxvY2spO1xuICAgICAgICBibG9jay5pKGxvY2FsKTtcbiAgICB9XG59XG5mdW5jdGlvbiB0cmFuc2l0aW9uX291dChibG9jaywgbG9jYWwsIGRldGFjaCwgY2FsbGJhY2spIHtcbiAgICBpZiAoYmxvY2sgJiYgYmxvY2subykge1xuICAgICAgICBpZiAob3V0cm9pbmcuaGFzKGJsb2NrKSlcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgb3V0cm9pbmcuYWRkKGJsb2NrKTtcbiAgICAgICAgb3V0cm9zLmMucHVzaCgoKSA9PiB7XG4gICAgICAgICAgICBvdXRyb2luZy5kZWxldGUoYmxvY2spO1xuICAgICAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICAgICAgaWYgKGRldGFjaClcbiAgICAgICAgICAgICAgICAgICAgYmxvY2suZCgxKTtcbiAgICAgICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgYmxvY2subyhsb2NhbCk7XG4gICAgfVxufVxuY29uc3QgbnVsbF90cmFuc2l0aW9uID0geyBkdXJhdGlvbjogMCB9O1xuZnVuY3Rpb24gY3JlYXRlX2luX3RyYW5zaXRpb24obm9kZSwgZm4sIHBhcmFtcykge1xuICAgIGxldCBjb25maWcgPSBmbihub2RlLCBwYXJhbXMpO1xuICAgIGxldCBydW5uaW5nID0gZmFsc2U7XG4gICAgbGV0IGFuaW1hdGlvbl9uYW1lO1xuICAgIGxldCB0YXNrO1xuICAgIGxldCB1aWQgPSAwO1xuICAgIGZ1bmN0aW9uIGNsZWFudXAoKSB7XG4gICAgICAgIGlmIChhbmltYXRpb25fbmFtZSlcbiAgICAgICAgICAgIGRlbGV0ZV9ydWxlKG5vZGUsIGFuaW1hdGlvbl9uYW1lKTtcbiAgICB9XG4gICAgZnVuY3Rpb24gZ28oKSB7XG4gICAgICAgIGNvbnN0IHsgZGVsYXkgPSAwLCBkdXJhdGlvbiA9IDMwMCwgZWFzaW5nID0gaWRlbnRpdHksIHRpY2sgPSBub29wLCBjc3MgfSA9IGNvbmZpZyB8fCBudWxsX3RyYW5zaXRpb247XG4gICAgICAgIGlmIChjc3MpXG4gICAgICAgICAgICBhbmltYXRpb25fbmFtZSA9IGNyZWF0ZV9ydWxlKG5vZGUsIDAsIDEsIGR1cmF0aW9uLCBkZWxheSwgZWFzaW5nLCBjc3MsIHVpZCsrKTtcbiAgICAgICAgdGljaygwLCAxKTtcbiAgICAgICAgY29uc3Qgc3RhcnRfdGltZSA9IG5vdygpICsgZGVsYXk7XG4gICAgICAgIGNvbnN0IGVuZF90aW1lID0gc3RhcnRfdGltZSArIGR1cmF0aW9uO1xuICAgICAgICBpZiAodGFzaylcbiAgICAgICAgICAgIHRhc2suYWJvcnQoKTtcbiAgICAgICAgcnVubmluZyA9IHRydWU7XG4gICAgICAgIGFkZF9yZW5kZXJfY2FsbGJhY2soKCkgPT4gZGlzcGF0Y2gobm9kZSwgdHJ1ZSwgJ3N0YXJ0JykpO1xuICAgICAgICB0YXNrID0gbG9vcChub3cgPT4ge1xuICAgICAgICAgICAgaWYgKHJ1bm5pbmcpIHtcbiAgICAgICAgICAgICAgICBpZiAobm93ID49IGVuZF90aW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHRpY2soMSwgMCk7XG4gICAgICAgICAgICAgICAgICAgIGRpc3BhdGNoKG5vZGUsIHRydWUsICdlbmQnKTtcbiAgICAgICAgICAgICAgICAgICAgY2xlYW51cCgpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gcnVubmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAobm93ID49IHN0YXJ0X3RpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdCA9IGVhc2luZygobm93IC0gc3RhcnRfdGltZSkgLyBkdXJhdGlvbik7XG4gICAgICAgICAgICAgICAgICAgIHRpY2sodCwgMSAtIHQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBydW5uaW5nO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgbGV0IHN0YXJ0ZWQgPSBmYWxzZTtcbiAgICByZXR1cm4ge1xuICAgICAgICBzdGFydCgpIHtcbiAgICAgICAgICAgIGlmIChzdGFydGVkKVxuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIGRlbGV0ZV9ydWxlKG5vZGUpO1xuICAgICAgICAgICAgaWYgKGlzX2Z1bmN0aW9uKGNvbmZpZykpIHtcbiAgICAgICAgICAgICAgICBjb25maWcgPSBjb25maWcoKTtcbiAgICAgICAgICAgICAgICB3YWl0KCkudGhlbihnbyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBnbygpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBpbnZhbGlkYXRlKCkge1xuICAgICAgICAgICAgc3RhcnRlZCA9IGZhbHNlO1xuICAgICAgICB9LFxuICAgICAgICBlbmQoKSB7XG4gICAgICAgICAgICBpZiAocnVubmluZykge1xuICAgICAgICAgICAgICAgIGNsZWFudXAoKTtcbiAgICAgICAgICAgICAgICBydW5uaW5nID0gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9O1xufVxuZnVuY3Rpb24gY3JlYXRlX291dF90cmFuc2l0aW9uKG5vZGUsIGZuLCBwYXJhbXMpIHtcbiAgICBsZXQgY29uZmlnID0gZm4obm9kZSwgcGFyYW1zKTtcbiAgICBsZXQgcnVubmluZyA9IHRydWU7XG4gICAgbGV0IGFuaW1hdGlvbl9uYW1lO1xuICAgIGNvbnN0IGdyb3VwID0gb3V0cm9zO1xuICAgIGdyb3VwLnIgKz0gMTtcbiAgICBmdW5jdGlvbiBnbygpIHtcbiAgICAgICAgY29uc3QgeyBkZWxheSA9IDAsIGR1cmF0aW9uID0gMzAwLCBlYXNpbmcgPSBpZGVudGl0eSwgdGljayA9IG5vb3AsIGNzcyB9ID0gY29uZmlnIHx8IG51bGxfdHJhbnNpdGlvbjtcbiAgICAgICAgaWYgKGNzcylcbiAgICAgICAgICAgIGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgMSwgMCwgZHVyYXRpb24sIGRlbGF5LCBlYXNpbmcsIGNzcyk7XG4gICAgICAgIGNvbnN0IHN0YXJ0X3RpbWUgPSBub3coKSArIGRlbGF5O1xuICAgICAgICBjb25zdCBlbmRfdGltZSA9IHN0YXJ0X3RpbWUgKyBkdXJhdGlvbjtcbiAgICAgICAgYWRkX3JlbmRlcl9jYWxsYmFjaygoKSA9PiBkaXNwYXRjaChub2RlLCBmYWxzZSwgJ3N0YXJ0JykpO1xuICAgICAgICBsb29wKG5vdyA9PiB7XG4gICAgICAgICAgICBpZiAocnVubmluZykge1xuICAgICAgICAgICAgICAgIGlmIChub3cgPj0gZW5kX3RpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGljaygwLCAxKTtcbiAgICAgICAgICAgICAgICAgICAgZGlzcGF0Y2gobm9kZSwgZmFsc2UsICdlbmQnKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCEtLWdyb3VwLnIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoaXMgd2lsbCByZXN1bHQgaW4gYGVuZCgpYCBiZWluZyBjYWxsZWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBzbyB3ZSBkb24ndCBuZWVkIHRvIGNsZWFuIHVwIGhlcmVcbiAgICAgICAgICAgICAgICAgICAgICAgIHJ1bl9hbGwoZ3JvdXAuYyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAobm93ID49IHN0YXJ0X3RpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdCA9IGVhc2luZygobm93IC0gc3RhcnRfdGltZSkgLyBkdXJhdGlvbik7XG4gICAgICAgICAgICAgICAgICAgIHRpY2soMSAtIHQsIHQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBydW5uaW5nO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgaWYgKGlzX2Z1bmN0aW9uKGNvbmZpZykpIHtcbiAgICAgICAgd2FpdCgpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgY29uZmlnID0gY29uZmlnKCk7XG4gICAgICAgICAgICBnbygpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIGdvKCk7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICAgIGVuZChyZXNldCkge1xuICAgICAgICAgICAgaWYgKHJlc2V0ICYmIGNvbmZpZy50aWNrKSB7XG4gICAgICAgICAgICAgICAgY29uZmlnLnRpY2soMSwgMCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocnVubmluZykge1xuICAgICAgICAgICAgICAgIGlmIChhbmltYXRpb25fbmFtZSlcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlX3J1bGUobm9kZSwgYW5pbWF0aW9uX25hbWUpO1xuICAgICAgICAgICAgICAgIHJ1bm5pbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH07XG59XG5mdW5jdGlvbiBjcmVhdGVfYmlkaXJlY3Rpb25hbF90cmFuc2l0aW9uKG5vZGUsIGZuLCBwYXJhbXMsIGludHJvKSB7XG4gICAgbGV0IGNvbmZpZyA9IGZuKG5vZGUsIHBhcmFtcyk7XG4gICAgbGV0IHQgPSBpbnRybyA/IDAgOiAxO1xuICAgIGxldCBydW5uaW5nX3Byb2dyYW0gPSBudWxsO1xuICAgIGxldCBwZW5kaW5nX3Byb2dyYW0gPSBudWxsO1xuICAgIGxldCBhbmltYXRpb25fbmFtZSA9IG51bGw7XG4gICAgZnVuY3Rpb24gY2xlYXJfYW5pbWF0aW9uKCkge1xuICAgICAgICBpZiAoYW5pbWF0aW9uX25hbWUpXG4gICAgICAgICAgICBkZWxldGVfcnVsZShub2RlLCBhbmltYXRpb25fbmFtZSk7XG4gICAgfVxuICAgIGZ1bmN0aW9uIGluaXQocHJvZ3JhbSwgZHVyYXRpb24pIHtcbiAgICAgICAgY29uc3QgZCA9IHByb2dyYW0uYiAtIHQ7XG4gICAgICAgIGR1cmF0aW9uICo9IE1hdGguYWJzKGQpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgYTogdCxcbiAgICAgICAgICAgIGI6IHByb2dyYW0uYixcbiAgICAgICAgICAgIGQsXG4gICAgICAgICAgICBkdXJhdGlvbixcbiAgICAgICAgICAgIHN0YXJ0OiBwcm9ncmFtLnN0YXJ0LFxuICAgICAgICAgICAgZW5kOiBwcm9ncmFtLnN0YXJ0ICsgZHVyYXRpb24sXG4gICAgICAgICAgICBncm91cDogcHJvZ3JhbS5ncm91cFxuICAgICAgICB9O1xuICAgIH1cbiAgICBmdW5jdGlvbiBnbyhiKSB7XG4gICAgICAgIGNvbnN0IHsgZGVsYXkgPSAwLCBkdXJhdGlvbiA9IDMwMCwgZWFzaW5nID0gaWRlbnRpdHksIHRpY2sgPSBub29wLCBjc3MgfSA9IGNvbmZpZyB8fCBudWxsX3RyYW5zaXRpb247XG4gICAgICAgIGNvbnN0IHByb2dyYW0gPSB7XG4gICAgICAgICAgICBzdGFydDogbm93KCkgKyBkZWxheSxcbiAgICAgICAgICAgIGJcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKCFiKSB7XG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlIHRvZG86IGltcHJvdmUgdHlwaW5nc1xuICAgICAgICAgICAgcHJvZ3JhbS5ncm91cCA9IG91dHJvcztcbiAgICAgICAgICAgIG91dHJvcy5yICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJ1bm5pbmdfcHJvZ3JhbSkge1xuICAgICAgICAgICAgcGVuZGluZ19wcm9ncmFtID0gcHJvZ3JhbTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIC8vIGlmIHRoaXMgaXMgYW4gaW50cm8sIGFuZCB0aGVyZSdzIGEgZGVsYXksIHdlIG5lZWQgdG8gZG9cbiAgICAgICAgICAgIC8vIGFuIGluaXRpYWwgdGljayBhbmQvb3IgYXBwbHkgQ1NTIGFuaW1hdGlvbiBpbW1lZGlhdGVseVxuICAgICAgICAgICAgaWYgKGNzcykge1xuICAgICAgICAgICAgICAgIGNsZWFyX2FuaW1hdGlvbigpO1xuICAgICAgICAgICAgICAgIGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgdCwgYiwgZHVyYXRpb24sIGRlbGF5LCBlYXNpbmcsIGNzcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoYilcbiAgICAgICAgICAgICAgICB0aWNrKDAsIDEpO1xuICAgICAgICAgICAgcnVubmluZ19wcm9ncmFtID0gaW5pdChwcm9ncmFtLCBkdXJhdGlvbik7XG4gICAgICAgICAgICBhZGRfcmVuZGVyX2NhbGxiYWNrKCgpID0+IGRpc3BhdGNoKG5vZGUsIGIsICdzdGFydCcpKTtcbiAgICAgICAgICAgIGxvb3Aobm93ID0+IHtcbiAgICAgICAgICAgICAgICBpZiAocGVuZGluZ19wcm9ncmFtICYmIG5vdyA+IHBlbmRpbmdfcHJvZ3JhbS5zdGFydCkge1xuICAgICAgICAgICAgICAgICAgICBydW5uaW5nX3Byb2dyYW0gPSBpbml0KHBlbmRpbmdfcHJvZ3JhbSwgZHVyYXRpb24pO1xuICAgICAgICAgICAgICAgICAgICBwZW5kaW5nX3Byb2dyYW0gPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICBkaXNwYXRjaChub2RlLCBydW5uaW5nX3Byb2dyYW0uYiwgJ3N0YXJ0Jyk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsZWFyX2FuaW1hdGlvbigpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYW5pbWF0aW9uX25hbWUgPSBjcmVhdGVfcnVsZShub2RlLCB0LCBydW5uaW5nX3Byb2dyYW0uYiwgcnVubmluZ19wcm9ncmFtLmR1cmF0aW9uLCAwLCBlYXNpbmcsIGNvbmZpZy5jc3MpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChydW5uaW5nX3Byb2dyYW0pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG5vdyA+PSBydW5uaW5nX3Byb2dyYW0uZW5kKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aWNrKHQgPSBydW5uaW5nX3Byb2dyYW0uYiwgMSAtIHQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGlzcGF0Y2gobm9kZSwgcnVubmluZ19wcm9ncmFtLmIsICdlbmQnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghcGVuZGluZ19wcm9ncmFtKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gd2UncmUgZG9uZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChydW5uaW5nX3Byb2dyYW0uYikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBpbnRybyDigJQgd2UgY2FuIHRpZHkgdXAgaW1tZWRpYXRlbHlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xlYXJfYW5pbWF0aW9uKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBvdXRybyDigJQgbmVlZHMgdG8gYmUgY29vcmRpbmF0ZWRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCEtLXJ1bm5pbmdfcHJvZ3JhbS5ncm91cC5yKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcnVuX2FsbChydW5uaW5nX3Byb2dyYW0uZ3JvdXAuYyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgcnVubmluZ19wcm9ncmFtID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBlbHNlIGlmIChub3cgPj0gcnVubmluZ19wcm9ncmFtLnN0YXJ0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwID0gbm93IC0gcnVubmluZ19wcm9ncmFtLnN0YXJ0O1xuICAgICAgICAgICAgICAgICAgICAgICAgdCA9IHJ1bm5pbmdfcHJvZ3JhbS5hICsgcnVubmluZ19wcm9ncmFtLmQgKiBlYXNpbmcocCAvIHJ1bm5pbmdfcHJvZ3JhbS5kdXJhdGlvbik7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aWNrKHQsIDEgLSB0KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gISEocnVubmluZ19wcm9ncmFtIHx8IHBlbmRpbmdfcHJvZ3JhbSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgICBydW4oYikge1xuICAgICAgICAgICAgaWYgKGlzX2Z1bmN0aW9uKGNvbmZpZykpIHtcbiAgICAgICAgICAgICAgICB3YWl0KCkudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICAgICAgICAgICAgY29uZmlnID0gY29uZmlnKCk7XG4gICAgICAgICAgICAgICAgICAgIGdvKGIpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgZ28oYik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIGVuZCgpIHtcbiAgICAgICAgICAgIGNsZWFyX2FuaW1hdGlvbigpO1xuICAgICAgICAgICAgcnVubmluZ19wcm9ncmFtID0gcGVuZGluZ19wcm9ncmFtID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGhhbmRsZV9wcm9taXNlKHByb21pc2UsIGluZm8pIHtcbiAgICBjb25zdCB0b2tlbiA9IGluZm8udG9rZW4gPSB7fTtcbiAgICBmdW5jdGlvbiB1cGRhdGUodHlwZSwgaW5kZXgsIGtleSwgdmFsdWUpIHtcbiAgICAgICAgaWYgKGluZm8udG9rZW4gIT09IHRva2VuKVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICBpbmZvLnJlc29sdmVkID0gdmFsdWU7XG4gICAgICAgIGxldCBjaGlsZF9jdHggPSBpbmZvLmN0eDtcbiAgICAgICAgaWYgKGtleSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjaGlsZF9jdHggPSBjaGlsZF9jdHguc2xpY2UoKTtcbiAgICAgICAgICAgIGNoaWxkX2N0eFtrZXldID0gdmFsdWU7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYmxvY2sgPSB0eXBlICYmIChpbmZvLmN1cnJlbnQgPSB0eXBlKShjaGlsZF9jdHgpO1xuICAgICAgICBsZXQgbmVlZHNfZmx1c2ggPSBmYWxzZTtcbiAgICAgICAgaWYgKGluZm8uYmxvY2spIHtcbiAgICAgICAgICAgIGlmIChpbmZvLmJsb2Nrcykge1xuICAgICAgICAgICAgICAgIGluZm8uYmxvY2tzLmZvckVhY2goKGJsb2NrLCBpKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChpICE9PSBpbmRleCAmJiBibG9jaykge1xuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBfb3V0cm9zKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cmFuc2l0aW9uX291dChibG9jaywgMSwgMSwgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uYmxvY2tzW2ldID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgY2hlY2tfb3V0cm9zKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIGluZm8uYmxvY2suZCgxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJsb2NrLmMoKTtcbiAgICAgICAgICAgIHRyYW5zaXRpb25faW4oYmxvY2ssIDEpO1xuICAgICAgICAgICAgYmxvY2subShpbmZvLm1vdW50KCksIGluZm8uYW5jaG9yKTtcbiAgICAgICAgICAgIG5lZWRzX2ZsdXNoID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpbmZvLmJsb2NrID0gYmxvY2s7XG4gICAgICAgIGlmIChpbmZvLmJsb2NrcylcbiAgICAgICAgICAgIGluZm8uYmxvY2tzW2luZGV4XSA9IGJsb2NrO1xuICAgICAgICBpZiAobmVlZHNfZmx1c2gpIHtcbiAgICAgICAgICAgIGZsdXNoKCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKGlzX3Byb21pc2UocHJvbWlzZSkpIHtcbiAgICAgICAgY29uc3QgY3VycmVudF9jb21wb25lbnQgPSBnZXRfY3VycmVudF9jb21wb25lbnQoKTtcbiAgICAgICAgcHJvbWlzZS50aGVuKHZhbHVlID0+IHtcbiAgICAgICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChjdXJyZW50X2NvbXBvbmVudCk7XG4gICAgICAgICAgICB1cGRhdGUoaW5mby50aGVuLCAxLCBpbmZvLnZhbHVlLCB2YWx1ZSk7XG4gICAgICAgICAgICBzZXRfY3VycmVudF9jb21wb25lbnQobnVsbCk7XG4gICAgICAgIH0sIGVycm9yID0+IHtcbiAgICAgICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChjdXJyZW50X2NvbXBvbmVudCk7XG4gICAgICAgICAgICB1cGRhdGUoaW5mby5jYXRjaCwgMiwgaW5mby5lcnJvciwgZXJyb3IpO1xuICAgICAgICAgICAgc2V0X2N1cnJlbnRfY29tcG9uZW50KG51bGwpO1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gaWYgd2UgcHJldmlvdXNseSBoYWQgYSB0aGVuL2NhdGNoIGJsb2NrLCBkZXN0cm95IGl0XG4gICAgICAgIGlmIChpbmZvLmN1cnJlbnQgIT09IGluZm8ucGVuZGluZykge1xuICAgICAgICAgICAgdXBkYXRlKGluZm8ucGVuZGluZywgMCk7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgaWYgKGluZm8uY3VycmVudCAhPT0gaW5mby50aGVuKSB7XG4gICAgICAgICAgICB1cGRhdGUoaW5mby50aGVuLCAxLCBpbmZvLnZhbHVlLCBwcm9taXNlKTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGluZm8ucmVzb2x2ZWQgPSBwcm9taXNlO1xuICAgIH1cbn1cblxuY29uc3QgZ2xvYmFscyA9ICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJ1xuICAgID8gd2luZG93XG4gICAgOiB0eXBlb2YgZ2xvYmFsVGhpcyAhPT0gJ3VuZGVmaW5lZCdcbiAgICAgICAgPyBnbG9iYWxUaGlzXG4gICAgICAgIDogZ2xvYmFsKTtcblxuZnVuY3Rpb24gZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKSB7XG4gICAgYmxvY2suZCgxKTtcbiAgICBsb29rdXAuZGVsZXRlKGJsb2NrLmtleSk7XG59XG5mdW5jdGlvbiBvdXRyb19hbmRfZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKSB7XG4gICAgdHJhbnNpdGlvbl9vdXQoYmxvY2ssIDEsIDEsICgpID0+IHtcbiAgICAgICAgbG9va3VwLmRlbGV0ZShibG9jay5rZXkpO1xuICAgIH0pO1xufVxuZnVuY3Rpb24gZml4X2FuZF9kZXN0cm95X2Jsb2NrKGJsb2NrLCBsb29rdXApIHtcbiAgICBibG9jay5mKCk7XG4gICAgZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKTtcbn1cbmZ1bmN0aW9uIGZpeF9hbmRfb3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCkge1xuICAgIGJsb2NrLmYoKTtcbiAgICBvdXRyb19hbmRfZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKTtcbn1cbmZ1bmN0aW9uIHVwZGF0ZV9rZXllZF9lYWNoKG9sZF9ibG9ja3MsIGRpcnR5LCBnZXRfa2V5LCBkeW5hbWljLCBjdHgsIGxpc3QsIGxvb2t1cCwgbm9kZSwgZGVzdHJveSwgY3JlYXRlX2VhY2hfYmxvY2ssIG5leHQsIGdldF9jb250ZXh0KSB7XG4gICAgbGV0IG8gPSBvbGRfYmxvY2tzLmxlbmd0aDtcbiAgICBsZXQgbiA9IGxpc3QubGVuZ3RoO1xuICAgIGxldCBpID0gbztcbiAgICBjb25zdCBvbGRfaW5kZXhlcyA9IHt9O1xuICAgIHdoaWxlIChpLS0pXG4gICAgICAgIG9sZF9pbmRleGVzW29sZF9ibG9ja3NbaV0ua2V5XSA9IGk7XG4gICAgY29uc3QgbmV3X2Jsb2NrcyA9IFtdO1xuICAgIGNvbnN0IG5ld19sb29rdXAgPSBuZXcgTWFwKCk7XG4gICAgY29uc3QgZGVsdGFzID0gbmV3IE1hcCgpO1xuICAgIGkgPSBuO1xuICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgY29uc3QgY2hpbGRfY3R4ID0gZ2V0X2NvbnRleHQoY3R4LCBsaXN0LCBpKTtcbiAgICAgICAgY29uc3Qga2V5ID0gZ2V0X2tleShjaGlsZF9jdHgpO1xuICAgICAgICBsZXQgYmxvY2sgPSBsb29rdXAuZ2V0KGtleSk7XG4gICAgICAgIGlmICghYmxvY2spIHtcbiAgICAgICAgICAgIGJsb2NrID0gY3JlYXRlX2VhY2hfYmxvY2soa2V5LCBjaGlsZF9jdHgpO1xuICAgICAgICAgICAgYmxvY2suYygpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGR5bmFtaWMpIHtcbiAgICAgICAgICAgIGJsb2NrLnAoY2hpbGRfY3R4LCBkaXJ0eSk7XG4gICAgICAgIH1cbiAgICAgICAgbmV3X2xvb2t1cC5zZXQoa2V5LCBuZXdfYmxvY2tzW2ldID0gYmxvY2spO1xuICAgICAgICBpZiAoa2V5IGluIG9sZF9pbmRleGVzKVxuICAgICAgICAgICAgZGVsdGFzLnNldChrZXksIE1hdGguYWJzKGkgLSBvbGRfaW5kZXhlc1trZXldKSk7XG4gICAgfVxuICAgIGNvbnN0IHdpbGxfbW92ZSA9IG5ldyBTZXQoKTtcbiAgICBjb25zdCBkaWRfbW92ZSA9IG5ldyBTZXQoKTtcbiAgICBmdW5jdGlvbiBpbnNlcnQoYmxvY2spIHtcbiAgICAgICAgdHJhbnNpdGlvbl9pbihibG9jaywgMSk7XG4gICAgICAgIGJsb2NrLm0obm9kZSwgbmV4dCk7XG4gICAgICAgIGxvb2t1cC5zZXQoYmxvY2sua2V5LCBibG9jayk7XG4gICAgICAgIG5leHQgPSBibG9jay5maXJzdDtcbiAgICAgICAgbi0tO1xuICAgIH1cbiAgICB3aGlsZSAobyAmJiBuKSB7XG4gICAgICAgIGNvbnN0IG5ld19ibG9jayA9IG5ld19ibG9ja3NbbiAtIDFdO1xuICAgICAgICBjb25zdCBvbGRfYmxvY2sgPSBvbGRfYmxvY2tzW28gLSAxXTtcbiAgICAgICAgY29uc3QgbmV3X2tleSA9IG5ld19ibG9jay5rZXk7XG4gICAgICAgIGNvbnN0IG9sZF9rZXkgPSBvbGRfYmxvY2sua2V5O1xuICAgICAgICBpZiAobmV3X2Jsb2NrID09PSBvbGRfYmxvY2spIHtcbiAgICAgICAgICAgIC8vIGRvIG5vdGhpbmdcbiAgICAgICAgICAgIG5leHQgPSBuZXdfYmxvY2suZmlyc3Q7XG4gICAgICAgICAgICBvLS07XG4gICAgICAgICAgICBuLS07XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoIW5ld19sb29rdXAuaGFzKG9sZF9rZXkpKSB7XG4gICAgICAgICAgICAvLyByZW1vdmUgb2xkIGJsb2NrXG4gICAgICAgICAgICBkZXN0cm95KG9sZF9ibG9jaywgbG9va3VwKTtcbiAgICAgICAgICAgIG8tLTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmICghbG9va3VwLmhhcyhuZXdfa2V5KSB8fCB3aWxsX21vdmUuaGFzKG5ld19rZXkpKSB7XG4gICAgICAgICAgICBpbnNlcnQobmV3X2Jsb2NrKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChkaWRfbW92ZS5oYXMob2xkX2tleSkpIHtcbiAgICAgICAgICAgIG8tLTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChkZWx0YXMuZ2V0KG5ld19rZXkpID4gZGVsdGFzLmdldChvbGRfa2V5KSkge1xuICAgICAgICAgICAgZGlkX21vdmUuYWRkKG5ld19rZXkpO1xuICAgICAgICAgICAgaW5zZXJ0KG5ld19ibG9jayk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB3aWxsX21vdmUuYWRkKG9sZF9rZXkpO1xuICAgICAgICAgICAgby0tO1xuICAgICAgICB9XG4gICAgfVxuICAgIHdoaWxlIChvLS0pIHtcbiAgICAgICAgY29uc3Qgb2xkX2Jsb2NrID0gb2xkX2Jsb2Nrc1tvXTtcbiAgICAgICAgaWYgKCFuZXdfbG9va3VwLmhhcyhvbGRfYmxvY2sua2V5KSlcbiAgICAgICAgICAgIGRlc3Ryb3kob2xkX2Jsb2NrLCBsb29rdXApO1xuICAgIH1cbiAgICB3aGlsZSAobilcbiAgICAgICAgaW5zZXJ0KG5ld19ibG9ja3NbbiAtIDFdKTtcbiAgICByZXR1cm4gbmV3X2Jsb2Nrcztcbn1cbmZ1bmN0aW9uIHZhbGlkYXRlX2VhY2hfa2V5cyhjdHgsIGxpc3QsIGdldF9jb250ZXh0LCBnZXRfa2V5KSB7XG4gICAgY29uc3Qga2V5cyA9IG5ldyBTZXQoKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3Qga2V5ID0gZ2V0X2tleShnZXRfY29udGV4dChjdHgsIGxpc3QsIGkpKTtcbiAgICAgICAgaWYgKGtleXMuaGFzKGtleSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGhhdmUgZHVwbGljYXRlIGtleXMgaW4gYSBrZXllZCBlYWNoYCk7XG4gICAgICAgIH1cbiAgICAgICAga2V5cy5hZGQoa2V5KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGdldF9zcHJlYWRfdXBkYXRlKGxldmVscywgdXBkYXRlcykge1xuICAgIGNvbnN0IHVwZGF0ZSA9IHt9O1xuICAgIGNvbnN0IHRvX251bGxfb3V0ID0ge307XG4gICAgY29uc3QgYWNjb3VudGVkX2ZvciA9IHsgJCRzY29wZTogMSB9O1xuICAgIGxldCBpID0gbGV2ZWxzLmxlbmd0aDtcbiAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgIGNvbnN0IG8gPSBsZXZlbHNbaV07XG4gICAgICAgIGNvbnN0IG4gPSB1cGRhdGVzW2ldO1xuICAgICAgICBpZiAobikge1xuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gbykge1xuICAgICAgICAgICAgICAgIGlmICghKGtleSBpbiBuKSlcbiAgICAgICAgICAgICAgICAgICAgdG9fbnVsbF9vdXRba2V5XSA9IDE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBuKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFhY2NvdW50ZWRfZm9yW2tleV0pIHtcbiAgICAgICAgICAgICAgICAgICAgdXBkYXRlW2tleV0gPSBuW2tleV07XG4gICAgICAgICAgICAgICAgICAgIGFjY291bnRlZF9mb3Jba2V5XSA9IDE7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbGV2ZWxzW2ldID0gbjtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIG8pIHtcbiAgICAgICAgICAgICAgICBhY2NvdW50ZWRfZm9yW2tleV0gPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIGZvciAoY29uc3Qga2V5IGluIHRvX251bGxfb3V0KSB7XG4gICAgICAgIGlmICghKGtleSBpbiB1cGRhdGUpKVxuICAgICAgICAgICAgdXBkYXRlW2tleV0gPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIHJldHVybiB1cGRhdGU7XG59XG5mdW5jdGlvbiBnZXRfc3ByZWFkX29iamVjdChzcHJlYWRfcHJvcHMpIHtcbiAgICByZXR1cm4gdHlwZW9mIHNwcmVhZF9wcm9wcyA9PT0gJ29iamVjdCcgJiYgc3ByZWFkX3Byb3BzICE9PSBudWxsID8gc3ByZWFkX3Byb3BzIDoge307XG59XG5cbi8vIHNvdXJjZTogaHR0cHM6Ly9odG1sLnNwZWMud2hhdHdnLm9yZy9tdWx0aXBhZ2UvaW5kaWNlcy5odG1sXG5jb25zdCBib29sZWFuX2F0dHJpYnV0ZXMgPSBuZXcgU2V0KFtcbiAgICAnYWxsb3dmdWxsc2NyZWVuJyxcbiAgICAnYWxsb3dwYXltZW50cmVxdWVzdCcsXG4gICAgJ2FzeW5jJyxcbiAgICAnYXV0b2ZvY3VzJyxcbiAgICAnYXV0b3BsYXknLFxuICAgICdjaGVja2VkJyxcbiAgICAnY29udHJvbHMnLFxuICAgICdkZWZhdWx0JyxcbiAgICAnZGVmZXInLFxuICAgICdkaXNhYmxlZCcsXG4gICAgJ2Zvcm1ub3ZhbGlkYXRlJyxcbiAgICAnaGlkZGVuJyxcbiAgICAnaXNtYXAnLFxuICAgICdsb29wJyxcbiAgICAnbXVsdGlwbGUnLFxuICAgICdtdXRlZCcsXG4gICAgJ25vbW9kdWxlJyxcbiAgICAnbm92YWxpZGF0ZScsXG4gICAgJ29wZW4nLFxuICAgICdwbGF5c2lubGluZScsXG4gICAgJ3JlYWRvbmx5JyxcbiAgICAncmVxdWlyZWQnLFxuICAgICdyZXZlcnNlZCcsXG4gICAgJ3NlbGVjdGVkJ1xuXSk7XG5cbmNvbnN0IGludmFsaWRfYXR0cmlidXRlX25hbWVfY2hhcmFjdGVyID0gL1tcXHMnXCI+Lz1cXHV7RkREMH0tXFx1e0ZERUZ9XFx1e0ZGRkV9XFx1e0ZGRkZ9XFx1ezFGRkZFfVxcdXsxRkZGRn1cXHV7MkZGRkV9XFx1ezJGRkZGfVxcdXszRkZGRX1cXHV7M0ZGRkZ9XFx1ezRGRkZFfVxcdXs0RkZGRn1cXHV7NUZGRkV9XFx1ezVGRkZGfVxcdXs2RkZGRX1cXHV7NkZGRkZ9XFx1ezdGRkZFfVxcdXs3RkZGRn1cXHV7OEZGRkV9XFx1ezhGRkZGfVxcdXs5RkZGRX1cXHV7OUZGRkZ9XFx1e0FGRkZFfVxcdXtBRkZGRn1cXHV7QkZGRkV9XFx1e0JGRkZGfVxcdXtDRkZGRX1cXHV7Q0ZGRkZ9XFx1e0RGRkZFfVxcdXtERkZGRn1cXHV7RUZGRkV9XFx1e0VGRkZGfVxcdXtGRkZGRX1cXHV7RkZGRkZ9XFx1ezEwRkZGRX1cXHV7MTBGRkZGfV0vdTtcbi8vIGh0dHBzOi8vaHRtbC5zcGVjLndoYXR3Zy5vcmcvbXVsdGlwYWdlL3N5bnRheC5odG1sI2F0dHJpYnV0ZXMtMlxuLy8gaHR0cHM6Ly9pbmZyYS5zcGVjLndoYXR3Zy5vcmcvI25vbmNoYXJhY3RlclxuZnVuY3Rpb24gc3ByZWFkKGFyZ3MsIGNsYXNzZXNfdG9fYWRkKSB7XG4gICAgY29uc3QgYXR0cmlidXRlcyA9IE9iamVjdC5hc3NpZ24oe30sIC4uLmFyZ3MpO1xuICAgIGlmIChjbGFzc2VzX3RvX2FkZCkge1xuICAgICAgICBpZiAoYXR0cmlidXRlcy5jbGFzcyA9PSBudWxsKSB7XG4gICAgICAgICAgICBhdHRyaWJ1dGVzLmNsYXNzID0gY2xhc3Nlc190b19hZGQ7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBhdHRyaWJ1dGVzLmNsYXNzICs9ICcgJyArIGNsYXNzZXNfdG9fYWRkO1xuICAgICAgICB9XG4gICAgfVxuICAgIGxldCBzdHIgPSAnJztcbiAgICBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKS5mb3JFYWNoKG5hbWUgPT4ge1xuICAgICAgICBpZiAoaW52YWxpZF9hdHRyaWJ1dGVfbmFtZV9jaGFyYWN0ZXIudGVzdChuYW1lKSlcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgY29uc3QgdmFsdWUgPSBhdHRyaWJ1dGVzW25hbWVdO1xuICAgICAgICBpZiAodmFsdWUgPT09IHRydWUpXG4gICAgICAgICAgICBzdHIgKz0gXCIgXCIgKyBuYW1lO1xuICAgICAgICBlbHNlIGlmIChib29sZWFuX2F0dHJpYnV0ZXMuaGFzKG5hbWUudG9Mb3dlckNhc2UoKSkpIHtcbiAgICAgICAgICAgIGlmICh2YWx1ZSlcbiAgICAgICAgICAgICAgICBzdHIgKz0gXCIgXCIgKyBuYW1lO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHZhbHVlICE9IG51bGwpIHtcbiAgICAgICAgICAgIHN0ciArPSBgICR7bmFtZX09XCIke1N0cmluZyh2YWx1ZSkucmVwbGFjZSgvXCIvZywgJyYjMzQ7JykucmVwbGFjZSgvJy9nLCAnJiMzOTsnKX1cImA7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gc3RyO1xufVxuY29uc3QgZXNjYXBlZCA9IHtcbiAgICAnXCInOiAnJnF1b3Q7JyxcbiAgICBcIidcIjogJyYjMzk7JyxcbiAgICAnJic6ICcmYW1wOycsXG4gICAgJzwnOiAnJmx0OycsXG4gICAgJz4nOiAnJmd0Oydcbn07XG5mdW5jdGlvbiBlc2NhcGUoaHRtbCkge1xuICAgIHJldHVybiBTdHJpbmcoaHRtbCkucmVwbGFjZSgvW1wiJyY8Pl0vZywgbWF0Y2ggPT4gZXNjYXBlZFttYXRjaF0pO1xufVxuZnVuY3Rpb24gZWFjaChpdGVtcywgZm4pIHtcbiAgICBsZXQgc3RyID0gJyc7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBpdGVtcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBzdHIgKz0gZm4oaXRlbXNbaV0sIGkpO1xuICAgIH1cbiAgICByZXR1cm4gc3RyO1xufVxuY29uc3QgbWlzc2luZ19jb21wb25lbnQgPSB7XG4gICAgJCRyZW5kZXI6ICgpID0+ICcnXG59O1xuZnVuY3Rpb24gdmFsaWRhdGVfY29tcG9uZW50KGNvbXBvbmVudCwgbmFtZSkge1xuICAgIGlmICghY29tcG9uZW50IHx8ICFjb21wb25lbnQuJCRyZW5kZXIpIHtcbiAgICAgICAgaWYgKG5hbWUgPT09ICdzdmVsdGU6Y29tcG9uZW50JylcbiAgICAgICAgICAgIG5hbWUgKz0gJyB0aGlzPXsuLi59JztcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGA8JHtuYW1lfT4gaXMgbm90IGEgdmFsaWQgU1NSIGNvbXBvbmVudC4gWW91IG1heSBuZWVkIHRvIHJldmlldyB5b3VyIGJ1aWxkIGNvbmZpZyB0byBlbnN1cmUgdGhhdCBkZXBlbmRlbmNpZXMgYXJlIGNvbXBpbGVkLCByYXRoZXIgdGhhbiBpbXBvcnRlZCBhcyBwcmUtY29tcGlsZWQgbW9kdWxlc2ApO1xuICAgIH1cbiAgICByZXR1cm4gY29tcG9uZW50O1xufVxuZnVuY3Rpb24gZGVidWcoZmlsZSwgbGluZSwgY29sdW1uLCB2YWx1ZXMpIHtcbiAgICBjb25zb2xlLmxvZyhge0BkZWJ1Z30gJHtmaWxlID8gZmlsZSArICcgJyA6ICcnfSgke2xpbmV9OiR7Y29sdW1ufSlgKTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1jb25zb2xlXG4gICAgY29uc29sZS5sb2codmFsdWVzKTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1jb25zb2xlXG4gICAgcmV0dXJuICcnO1xufVxubGV0IG9uX2Rlc3Ryb3k7XG5mdW5jdGlvbiBjcmVhdGVfc3NyX2NvbXBvbmVudChmbikge1xuICAgIGZ1bmN0aW9uICQkcmVuZGVyKHJlc3VsdCwgcHJvcHMsIGJpbmRpbmdzLCBzbG90cykge1xuICAgICAgICBjb25zdCBwYXJlbnRfY29tcG9uZW50ID0gY3VycmVudF9jb21wb25lbnQ7XG4gICAgICAgIGNvbnN0ICQkID0ge1xuICAgICAgICAgICAgb25fZGVzdHJveSxcbiAgICAgICAgICAgIGNvbnRleHQ6IG5ldyBNYXAocGFyZW50X2NvbXBvbmVudCA/IHBhcmVudF9jb21wb25lbnQuJCQuY29udGV4dCA6IFtdKSxcbiAgICAgICAgICAgIC8vIHRoZXNlIHdpbGwgYmUgaW1tZWRpYXRlbHkgZGlzY2FyZGVkXG4gICAgICAgICAgICBvbl9tb3VudDogW10sXG4gICAgICAgICAgICBiZWZvcmVfdXBkYXRlOiBbXSxcbiAgICAgICAgICAgIGFmdGVyX3VwZGF0ZTogW10sXG4gICAgICAgICAgICBjYWxsYmFja3M6IGJsYW5rX29iamVjdCgpXG4gICAgICAgIH07XG4gICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudCh7ICQkIH0pO1xuICAgICAgICBjb25zdCBodG1sID0gZm4ocmVzdWx0LCBwcm9wcywgYmluZGluZ3MsIHNsb3RzKTtcbiAgICAgICAgc2V0X2N1cnJlbnRfY29tcG9uZW50KHBhcmVudF9jb21wb25lbnQpO1xuICAgICAgICByZXR1cm4gaHRtbDtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgICAgcmVuZGVyOiAocHJvcHMgPSB7fSwgb3B0aW9ucyA9IHt9KSA9PiB7XG4gICAgICAgICAgICBvbl9kZXN0cm95ID0gW107XG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSB7IHRpdGxlOiAnJywgaGVhZDogJycsIGNzczogbmV3IFNldCgpIH07XG4gICAgICAgICAgICBjb25zdCBodG1sID0gJCRyZW5kZXIocmVzdWx0LCBwcm9wcywge30sIG9wdGlvbnMpO1xuICAgICAgICAgICAgcnVuX2FsbChvbl9kZXN0cm95KTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgaHRtbCxcbiAgICAgICAgICAgICAgICBjc3M6IHtcbiAgICAgICAgICAgICAgICAgICAgY29kZTogQXJyYXkuZnJvbShyZXN1bHQuY3NzKS5tYXAoY3NzID0+IGNzcy5jb2RlKS5qb2luKCdcXG4nKSxcbiAgICAgICAgICAgICAgICAgICAgbWFwOiBudWxsIC8vIFRPRE9cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGhlYWQ6IHJlc3VsdC50aXRsZSArIHJlc3VsdC5oZWFkXG4gICAgICAgICAgICB9O1xuICAgICAgICB9LFxuICAgICAgICAkJHJlbmRlclxuICAgIH07XG59XG5mdW5jdGlvbiBhZGRfYXR0cmlidXRlKG5hbWUsIHZhbHVlLCBib29sZWFuKSB7XG4gICAgaWYgKHZhbHVlID09IG51bGwgfHwgKGJvb2xlYW4gJiYgIXZhbHVlKSlcbiAgICAgICAgcmV0dXJuICcnO1xuICAgIHJldHVybiBgICR7bmFtZX0ke3ZhbHVlID09PSB0cnVlID8gJycgOiBgPSR7dHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyA/IEpTT04uc3RyaW5naWZ5KGVzY2FwZSh2YWx1ZSkpIDogYFwiJHt2YWx1ZX1cImB9YH1gO1xufVxuZnVuY3Rpb24gYWRkX2NsYXNzZXMoY2xhc3Nlcykge1xuICAgIHJldHVybiBjbGFzc2VzID8gYCBjbGFzcz1cIiR7Y2xhc3Nlc31cImAgOiBgYDtcbn1cblxuZnVuY3Rpb24gYmluZChjb21wb25lbnQsIG5hbWUsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgaW5kZXggPSBjb21wb25lbnQuJCQucHJvcHNbbmFtZV07XG4gICAgaWYgKGluZGV4ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY29tcG9uZW50LiQkLmJvdW5kW2luZGV4XSA9IGNhbGxiYWNrO1xuICAgICAgICBjYWxsYmFjayhjb21wb25lbnQuJCQuY3R4W2luZGV4XSk7XG4gICAgfVxufVxuZnVuY3Rpb24gY3JlYXRlX2NvbXBvbmVudChibG9jaykge1xuICAgIGJsb2NrICYmIGJsb2NrLmMoKTtcbn1cbmZ1bmN0aW9uIGNsYWltX2NvbXBvbmVudChibG9jaywgcGFyZW50X25vZGVzKSB7XG4gICAgYmxvY2sgJiYgYmxvY2subChwYXJlbnRfbm9kZXMpO1xufVxuZnVuY3Rpb24gbW91bnRfY29tcG9uZW50KGNvbXBvbmVudCwgdGFyZ2V0LCBhbmNob3IpIHtcbiAgICBjb25zdCB7IGZyYWdtZW50LCBvbl9tb3VudCwgb25fZGVzdHJveSwgYWZ0ZXJfdXBkYXRlIH0gPSBjb21wb25lbnQuJCQ7XG4gICAgZnJhZ21lbnQgJiYgZnJhZ21lbnQubSh0YXJnZXQsIGFuY2hvcik7XG4gICAgLy8gb25Nb3VudCBoYXBwZW5zIGJlZm9yZSB0aGUgaW5pdGlhbCBhZnRlclVwZGF0ZVxuICAgIGFkZF9yZW5kZXJfY2FsbGJhY2soKCkgPT4ge1xuICAgICAgICBjb25zdCBuZXdfb25fZGVzdHJveSA9IG9uX21vdW50Lm1hcChydW4pLmZpbHRlcihpc19mdW5jdGlvbik7XG4gICAgICAgIGlmIChvbl9kZXN0cm95KSB7XG4gICAgICAgICAgICBvbl9kZXN0cm95LnB1c2goLi4ubmV3X29uX2Rlc3Ryb3kpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy8gRWRnZSBjYXNlIC0gY29tcG9uZW50IHdhcyBkZXN0cm95ZWQgaW1tZWRpYXRlbHksXG4gICAgICAgICAgICAvLyBtb3N0IGxpa2VseSBhcyBhIHJlc3VsdCBvZiBhIGJpbmRpbmcgaW5pdGlhbGlzaW5nXG4gICAgICAgICAgICBydW5fYWxsKG5ld19vbl9kZXN0cm95KTtcbiAgICAgICAgfVxuICAgICAgICBjb21wb25lbnQuJCQub25fbW91bnQgPSBbXTtcbiAgICB9KTtcbiAgICBhZnRlcl91cGRhdGUuZm9yRWFjaChhZGRfcmVuZGVyX2NhbGxiYWNrKTtcbn1cbmZ1bmN0aW9uIGRlc3Ryb3lfY29tcG9uZW50KGNvbXBvbmVudCwgZGV0YWNoaW5nKSB7XG4gICAgY29uc3QgJCQgPSBjb21wb25lbnQuJCQ7XG4gICAgaWYgKCQkLmZyYWdtZW50ICE9PSBudWxsKSB7XG4gICAgICAgIHJ1bl9hbGwoJCQub25fZGVzdHJveSk7XG4gICAgICAgICQkLmZyYWdtZW50ICYmICQkLmZyYWdtZW50LmQoZGV0YWNoaW5nKTtcbiAgICAgICAgLy8gVE9ETyBudWxsIG91dCBvdGhlciByZWZzLCBpbmNsdWRpbmcgY29tcG9uZW50LiQkIChidXQgbmVlZCB0b1xuICAgICAgICAvLyBwcmVzZXJ2ZSBmaW5hbCBzdGF0ZT8pXG4gICAgICAgICQkLm9uX2Rlc3Ryb3kgPSAkJC5mcmFnbWVudCA9IG51bGw7XG4gICAgICAgICQkLmN0eCA9IFtdO1xuICAgIH1cbn1cbmZ1bmN0aW9uIG1ha2VfZGlydHkoY29tcG9uZW50LCBpKSB7XG4gICAgaWYgKGNvbXBvbmVudC4kJC5kaXJ0eVswXSA9PT0gLTEpIHtcbiAgICAgICAgZGlydHlfY29tcG9uZW50cy5wdXNoKGNvbXBvbmVudCk7XG4gICAgICAgIHNjaGVkdWxlX3VwZGF0ZSgpO1xuICAgICAgICBjb21wb25lbnQuJCQuZGlydHkuZmlsbCgwKTtcbiAgICB9XG4gICAgY29tcG9uZW50LiQkLmRpcnR5WyhpIC8gMzEpIHwgMF0gfD0gKDEgPDwgKGkgJSAzMSkpO1xufVxuZnVuY3Rpb24gaW5pdChjb21wb25lbnQsIG9wdGlvbnMsIGluc3RhbmNlLCBjcmVhdGVfZnJhZ21lbnQsIG5vdF9lcXVhbCwgcHJvcHMsIGRpcnR5ID0gWy0xXSkge1xuICAgIGNvbnN0IHBhcmVudF9jb21wb25lbnQgPSBjdXJyZW50X2NvbXBvbmVudDtcbiAgICBzZXRfY3VycmVudF9jb21wb25lbnQoY29tcG9uZW50KTtcbiAgICBjb25zdCBwcm9wX3ZhbHVlcyA9IG9wdGlvbnMucHJvcHMgfHwge307XG4gICAgY29uc3QgJCQgPSBjb21wb25lbnQuJCQgPSB7XG4gICAgICAgIGZyYWdtZW50OiBudWxsLFxuICAgICAgICBjdHg6IG51bGwsXG4gICAgICAgIC8vIHN0YXRlXG4gICAgICAgIHByb3BzLFxuICAgICAgICB1cGRhdGU6IG5vb3AsXG4gICAgICAgIG5vdF9lcXVhbCxcbiAgICAgICAgYm91bmQ6IGJsYW5rX29iamVjdCgpLFxuICAgICAgICAvLyBsaWZlY3ljbGVcbiAgICAgICAgb25fbW91bnQ6IFtdLFxuICAgICAgICBvbl9kZXN0cm95OiBbXSxcbiAgICAgICAgYmVmb3JlX3VwZGF0ZTogW10sXG4gICAgICAgIGFmdGVyX3VwZGF0ZTogW10sXG4gICAgICAgIGNvbnRleHQ6IG5ldyBNYXAocGFyZW50X2NvbXBvbmVudCA/IHBhcmVudF9jb21wb25lbnQuJCQuY29udGV4dCA6IFtdKSxcbiAgICAgICAgLy8gZXZlcnl0aGluZyBlbHNlXG4gICAgICAgIGNhbGxiYWNrczogYmxhbmtfb2JqZWN0KCksXG4gICAgICAgIGRpcnR5XG4gICAgfTtcbiAgICBsZXQgcmVhZHkgPSBmYWxzZTtcbiAgICAkJC5jdHggPSBpbnN0YW5jZVxuICAgICAgICA/IGluc3RhbmNlKGNvbXBvbmVudCwgcHJvcF92YWx1ZXMsIChpLCByZXQsIC4uLnJlc3QpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gcmVzdC5sZW5ndGggPyByZXN0WzBdIDogcmV0O1xuICAgICAgICAgICAgaWYgKCQkLmN0eCAmJiBub3RfZXF1YWwoJCQuY3R4W2ldLCAkJC5jdHhbaV0gPSB2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICBpZiAoJCQuYm91bmRbaV0pXG4gICAgICAgICAgICAgICAgICAgICQkLmJvdW5kW2ldKHZhbHVlKTtcbiAgICAgICAgICAgICAgICBpZiAocmVhZHkpXG4gICAgICAgICAgICAgICAgICAgIG1ha2VfZGlydHkoY29tcG9uZW50LCBpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiByZXQ7XG4gICAgICAgIH0pXG4gICAgICAgIDogW107XG4gICAgJCQudXBkYXRlKCk7XG4gICAgcmVhZHkgPSB0cnVlO1xuICAgIHJ1bl9hbGwoJCQuYmVmb3JlX3VwZGF0ZSk7XG4gICAgLy8gYGZhbHNlYCBhcyBhIHNwZWNpYWwgY2FzZSBvZiBubyBET00gY29tcG9uZW50XG4gICAgJCQuZnJhZ21lbnQgPSBjcmVhdGVfZnJhZ21lbnQgPyBjcmVhdGVfZnJhZ21lbnQoJCQuY3R4KSA6IGZhbHNlO1xuICAgIGlmIChvcHRpb25zLnRhcmdldCkge1xuICAgICAgICBpZiAob3B0aW9ucy5oeWRyYXRlKSB7XG4gICAgICAgICAgICBjb25zdCBub2RlcyA9IGNoaWxkcmVuKG9wdGlvbnMudGFyZ2V0KTtcbiAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbm9uLW51bGwtYXNzZXJ0aW9uXG4gICAgICAgICAgICAkJC5mcmFnbWVudCAmJiAkJC5mcmFnbWVudC5sKG5vZGVzKTtcbiAgICAgICAgICAgIG5vZGVzLmZvckVhY2goZGV0YWNoKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbm9uLW51bGwtYXNzZXJ0aW9uXG4gICAgICAgICAgICAkJC5mcmFnbWVudCAmJiAkJC5mcmFnbWVudC5jKCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG9wdGlvbnMuaW50cm8pXG4gICAgICAgICAgICB0cmFuc2l0aW9uX2luKGNvbXBvbmVudC4kJC5mcmFnbWVudCk7XG4gICAgICAgIG1vdW50X2NvbXBvbmVudChjb21wb25lbnQsIG9wdGlvbnMudGFyZ2V0LCBvcHRpb25zLmFuY2hvcik7XG4gICAgICAgIGZsdXNoKCk7XG4gICAgfVxuICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChwYXJlbnRfY29tcG9uZW50KTtcbn1cbmxldCBTdmVsdGVFbGVtZW50O1xuaWYgKHR5cGVvZiBIVE1MRWxlbWVudCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIFN2ZWx0ZUVsZW1lbnQgPSBjbGFzcyBleHRlbmRzIEhUTUxFbGVtZW50IHtcbiAgICAgICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgICAgICBzdXBlcigpO1xuICAgICAgICAgICAgdGhpcy5hdHRhY2hTaGFkb3coeyBtb2RlOiAnb3BlbicgfSk7XG4gICAgICAgIH1cbiAgICAgICAgY29ubmVjdGVkQ2FsbGJhY2soKSB7XG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlIHRvZG86IGltcHJvdmUgdHlwaW5nc1xuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gdGhpcy4kJC5zbG90dGVkKSB7XG4gICAgICAgICAgICAgICAgLy8gQHRzLWlnbm9yZSB0b2RvOiBpbXByb3ZlIHR5cGluZ3NcbiAgICAgICAgICAgICAgICB0aGlzLmFwcGVuZENoaWxkKHRoaXMuJCQuc2xvdHRlZFtrZXldKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBhdHRyaWJ1dGVDaGFuZ2VkQ2FsbGJhY2soYXR0ciwgX29sZFZhbHVlLCBuZXdWYWx1ZSkge1xuICAgICAgICAgICAgdGhpc1thdHRyXSA9IG5ld1ZhbHVlO1xuICAgICAgICB9XG4gICAgICAgICRkZXN0cm95KCkge1xuICAgICAgICAgICAgZGVzdHJveV9jb21wb25lbnQodGhpcywgMSk7XG4gICAgICAgICAgICB0aGlzLiRkZXN0cm95ID0gbm9vcDtcbiAgICAgICAgfVxuICAgICAgICAkb24odHlwZSwgY2FsbGJhY2spIHtcbiAgICAgICAgICAgIC8vIFRPRE8gc2hvdWxkIHRoaXMgZGVsZWdhdGUgdG8gYWRkRXZlbnRMaXN0ZW5lcj9cbiAgICAgICAgICAgIGNvbnN0IGNhbGxiYWNrcyA9ICh0aGlzLiQkLmNhbGxiYWNrc1t0eXBlXSB8fCAodGhpcy4kJC5jYWxsYmFja3NbdHlwZV0gPSBbXSkpO1xuICAgICAgICAgICAgY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spO1xuICAgICAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBpbmRleCA9IGNhbGxiYWNrcy5pbmRleE9mKGNhbGxiYWNrKTtcbiAgICAgICAgICAgICAgICBpZiAoaW5kZXggIT09IC0xKVxuICAgICAgICAgICAgICAgICAgICBjYWxsYmFja3Muc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgJHNldCgpIHtcbiAgICAgICAgICAgIC8vIG92ZXJyaWRkZW4gYnkgaW5zdGFuY2UsIGlmIGl0IGhhcyBwcm9wc1xuICAgICAgICB9XG4gICAgfTtcbn1cbmNsYXNzIFN2ZWx0ZUNvbXBvbmVudCB7XG4gICAgJGRlc3Ryb3koKSB7XG4gICAgICAgIGRlc3Ryb3lfY29tcG9uZW50KHRoaXMsIDEpO1xuICAgICAgICB0aGlzLiRkZXN0cm95ID0gbm9vcDtcbiAgICB9XG4gICAgJG9uKHR5cGUsIGNhbGxiYWNrKSB7XG4gICAgICAgIGNvbnN0IGNhbGxiYWNrcyA9ICh0aGlzLiQkLmNhbGxiYWNrc1t0eXBlXSB8fCAodGhpcy4kJC5jYWxsYmFja3NbdHlwZV0gPSBbXSkpO1xuICAgICAgICBjYWxsYmFja3MucHVzaChjYWxsYmFjayk7XG4gICAgICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBpbmRleCA9IGNhbGxiYWNrcy5pbmRleE9mKGNhbGxiYWNrKTtcbiAgICAgICAgICAgIGlmIChpbmRleCAhPT0gLTEpXG4gICAgICAgICAgICAgICAgY2FsbGJhY2tzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIH07XG4gICAgfVxuICAgICRzZXQoKSB7XG4gICAgICAgIC8vIG92ZXJyaWRkZW4gYnkgaW5zdGFuY2UsIGlmIGl0IGhhcyBwcm9wc1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZGlzcGF0Y2hfZGV2KHR5cGUsIGRldGFpbCkge1xuICAgIGRvY3VtZW50LmRpc3BhdGNoRXZlbnQoY3VzdG9tX2V2ZW50KHR5cGUsIE9iamVjdC5hc3NpZ24oeyB2ZXJzaW9uOiAnMy4yMy4wJyB9LCBkZXRhaWwpKSk7XG59XG5mdW5jdGlvbiBhcHBlbmRfZGV2KHRhcmdldCwgbm9kZSkge1xuICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTUluc2VydFwiLCB7IHRhcmdldCwgbm9kZSB9KTtcbiAgICBhcHBlbmQodGFyZ2V0LCBub2RlKTtcbn1cbmZ1bmN0aW9uIGluc2VydF9kZXYodGFyZ2V0LCBub2RlLCBhbmNob3IpIHtcbiAgICBkaXNwYXRjaF9kZXYoXCJTdmVsdGVET01JbnNlcnRcIiwgeyB0YXJnZXQsIG5vZGUsIGFuY2hvciB9KTtcbiAgICBpbnNlcnQodGFyZ2V0LCBub2RlLCBhbmNob3IpO1xufVxuZnVuY3Rpb24gZGV0YWNoX2Rldihub2RlKSB7XG4gICAgZGlzcGF0Y2hfZGV2KFwiU3ZlbHRlRE9NUmVtb3ZlXCIsIHsgbm9kZSB9KTtcbiAgICBkZXRhY2gobm9kZSk7XG59XG5mdW5jdGlvbiBkZXRhY2hfYmV0d2Vlbl9kZXYoYmVmb3JlLCBhZnRlcikge1xuICAgIHdoaWxlIChiZWZvcmUubmV4dFNpYmxpbmcgJiYgYmVmb3JlLm5leHRTaWJsaW5nICE9PSBhZnRlcikge1xuICAgICAgICBkZXRhY2hfZGV2KGJlZm9yZS5uZXh0U2libGluZyk7XG4gICAgfVxufVxuZnVuY3Rpb24gZGV0YWNoX2JlZm9yZV9kZXYoYWZ0ZXIpIHtcbiAgICB3aGlsZSAoYWZ0ZXIucHJldmlvdXNTaWJsaW5nKSB7XG4gICAgICAgIGRldGFjaF9kZXYoYWZ0ZXIucHJldmlvdXNTaWJsaW5nKTtcbiAgICB9XG59XG5mdW5jdGlvbiBkZXRhY2hfYWZ0ZXJfZGV2KGJlZm9yZSkge1xuICAgIHdoaWxlIChiZWZvcmUubmV4dFNpYmxpbmcpIHtcbiAgICAgICAgZGV0YWNoX2RldihiZWZvcmUubmV4dFNpYmxpbmcpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIGxpc3Rlbl9kZXYobm9kZSwgZXZlbnQsIGhhbmRsZXIsIG9wdGlvbnMsIGhhc19wcmV2ZW50X2RlZmF1bHQsIGhhc19zdG9wX3Byb3BhZ2F0aW9uKSB7XG4gICAgY29uc3QgbW9kaWZpZXJzID0gb3B0aW9ucyA9PT0gdHJ1ZSA/IFtcImNhcHR1cmVcIl0gOiBvcHRpb25zID8gQXJyYXkuZnJvbShPYmplY3Qua2V5cyhvcHRpb25zKSkgOiBbXTtcbiAgICBpZiAoaGFzX3ByZXZlbnRfZGVmYXVsdClcbiAgICAgICAgbW9kaWZpZXJzLnB1c2goJ3ByZXZlbnREZWZhdWx0Jyk7XG4gICAgaWYgKGhhc19zdG9wX3Byb3BhZ2F0aW9uKVxuICAgICAgICBtb2RpZmllcnMucHVzaCgnc3RvcFByb3BhZ2F0aW9uJyk7XG4gICAgZGlzcGF0Y2hfZGV2KFwiU3ZlbHRlRE9NQWRkRXZlbnRMaXN0ZW5lclwiLCB7IG5vZGUsIGV2ZW50LCBoYW5kbGVyLCBtb2RpZmllcnMgfSk7XG4gICAgY29uc3QgZGlzcG9zZSA9IGxpc3Rlbihub2RlLCBldmVudCwgaGFuZGxlciwgb3B0aW9ucyk7XG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgZGlzcGF0Y2hfZGV2KFwiU3ZlbHRlRE9NUmVtb3ZlRXZlbnRMaXN0ZW5lclwiLCB7IG5vZGUsIGV2ZW50LCBoYW5kbGVyLCBtb2RpZmllcnMgfSk7XG4gICAgICAgIGRpc3Bvc2UoKTtcbiAgICB9O1xufVxuZnVuY3Rpb24gYXR0cl9kZXYobm9kZSwgYXR0cmlidXRlLCB2YWx1ZSkge1xuICAgIGF0dHIobm9kZSwgYXR0cmlidXRlLCB2YWx1ZSk7XG4gICAgaWYgKHZhbHVlID09IG51bGwpXG4gICAgICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVJlbW92ZUF0dHJpYnV0ZVwiLCB7IG5vZGUsIGF0dHJpYnV0ZSB9KTtcbiAgICBlbHNlXG4gICAgICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVNldEF0dHJpYnV0ZVwiLCB7IG5vZGUsIGF0dHJpYnV0ZSwgdmFsdWUgfSk7XG59XG5mdW5jdGlvbiBwcm9wX2Rldihub2RlLCBwcm9wZXJ0eSwgdmFsdWUpIHtcbiAgICBub2RlW3Byb3BlcnR5XSA9IHZhbHVlO1xuICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVNldFByb3BlcnR5XCIsIHsgbm9kZSwgcHJvcGVydHksIHZhbHVlIH0pO1xufVxuZnVuY3Rpb24gZGF0YXNldF9kZXYobm9kZSwgcHJvcGVydHksIHZhbHVlKSB7XG4gICAgbm9kZS5kYXRhc2V0W3Byb3BlcnR5XSA9IHZhbHVlO1xuICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVNldERhdGFzZXRcIiwgeyBub2RlLCBwcm9wZXJ0eSwgdmFsdWUgfSk7XG59XG5mdW5jdGlvbiBzZXRfZGF0YV9kZXYodGV4dCwgZGF0YSkge1xuICAgIGRhdGEgPSAnJyArIGRhdGE7XG4gICAgaWYgKHRleHQuZGF0YSA9PT0gZGF0YSlcbiAgICAgICAgcmV0dXJuO1xuICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVNldERhdGFcIiwgeyBub2RlOiB0ZXh0LCBkYXRhIH0pO1xuICAgIHRleHQuZGF0YSA9IGRhdGE7XG59XG5mdW5jdGlvbiB2YWxpZGF0ZV9lYWNoX2FyZ3VtZW50KGFyZykge1xuICAgIGlmICh0eXBlb2YgYXJnICE9PSAnc3RyaW5nJyAmJiAhKGFyZyAmJiB0eXBlb2YgYXJnID09PSAnb2JqZWN0JyAmJiAnbGVuZ3RoJyBpbiBhcmcpKSB7XG4gICAgICAgIGxldCBtc2cgPSAneyNlYWNofSBvbmx5IGl0ZXJhdGVzIG92ZXIgYXJyYXktbGlrZSBvYmplY3RzLic7XG4gICAgICAgIGlmICh0eXBlb2YgU3ltYm9sID09PSAnZnVuY3Rpb24nICYmIGFyZyAmJiBTeW1ib2wuaXRlcmF0b3IgaW4gYXJnKSB7XG4gICAgICAgICAgICBtc2cgKz0gJyBZb3UgY2FuIHVzZSBhIHNwcmVhZCB0byBjb252ZXJ0IHRoaXMgaXRlcmFibGUgaW50byBhbiBhcnJheS4nO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIHZhbGlkYXRlX3Nsb3RzKG5hbWUsIHNsb3QsIGtleXMpIHtcbiAgICBmb3IgKGNvbnN0IHNsb3Rfa2V5IG9mIE9iamVjdC5rZXlzKHNsb3QpKSB7XG4gICAgICAgIGlmICghfmtleXMuaW5kZXhPZihzbG90X2tleSkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgPCR7bmFtZX0+IHJlY2VpdmVkIGFuIHVuZXhwZWN0ZWQgc2xvdCBcIiR7c2xvdF9rZXl9XCIuYCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5jbGFzcyBTdmVsdGVDb21wb25lbnREZXYgZXh0ZW5kcyBTdmVsdGVDb21wb25lbnQge1xuICAgIGNvbnN0cnVjdG9yKG9wdGlvbnMpIHtcbiAgICAgICAgaWYgKCFvcHRpb25zIHx8ICghb3B0aW9ucy50YXJnZXQgJiYgIW9wdGlvbnMuJCRpbmxpbmUpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCd0YXJnZXQnIGlzIGEgcmVxdWlyZWQgb3B0aW9uYCk7XG4gICAgICAgIH1cbiAgICAgICAgc3VwZXIoKTtcbiAgICB9XG4gICAgJGRlc3Ryb3koKSB7XG4gICAgICAgIHN1cGVyLiRkZXN0cm95KCk7XG4gICAgICAgIHRoaXMuJGRlc3Ryb3kgPSAoKSA9PiB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYENvbXBvbmVudCB3YXMgYWxyZWFkeSBkZXN0cm95ZWRgKTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1jb25zb2xlXG4gICAgICAgIH07XG4gICAgfVxuICAgICRjYXB0dXJlX3N0YXRlKCkgeyB9XG4gICAgJGluamVjdF9zdGF0ZSgpIHsgfVxufVxuZnVuY3Rpb24gbG9vcF9ndWFyZCh0aW1lb3V0KSB7XG4gICAgY29uc3Qgc3RhcnQgPSBEYXRlLm5vdygpO1xuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgIGlmIChEYXRlLm5vdygpIC0gc3RhcnQgPiB0aW1lb3V0KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEluZmluaXRlIGxvb3AgZGV0ZWN0ZWRgKTtcbiAgICAgICAgfVxuICAgIH07XG59XG5cbmV4cG9ydCB7IEh0bWxUYWcsIFN2ZWx0ZUNvbXBvbmVudCwgU3ZlbHRlQ29tcG9uZW50RGV2LCBTdmVsdGVFbGVtZW50LCBhY3Rpb25fZGVzdHJveWVyLCBhZGRfYXR0cmlidXRlLCBhZGRfY2xhc3NlcywgYWRkX2ZsdXNoX2NhbGxiYWNrLCBhZGRfbG9jYXRpb24sIGFkZF9yZW5kZXJfY2FsbGJhY2ssIGFkZF9yZXNpemVfbGlzdGVuZXIsIGFkZF90cmFuc2Zvcm0sIGFmdGVyVXBkYXRlLCBhcHBlbmQsIGFwcGVuZF9kZXYsIGFzc2lnbiwgYXR0ciwgYXR0cl9kZXYsIGJlZm9yZVVwZGF0ZSwgYmluZCwgYmluZGluZ19jYWxsYmFja3MsIGJsYW5rX29iamVjdCwgYnViYmxlLCBjaGVja19vdXRyb3MsIGNoaWxkcmVuLCBjbGFpbV9jb21wb25lbnQsIGNsYWltX2VsZW1lbnQsIGNsYWltX3NwYWNlLCBjbGFpbV90ZXh0LCBjbGVhcl9sb29wcywgY29tcG9uZW50X3N1YnNjcmliZSwgY29tcHV0ZV9yZXN0X3Byb3BzLCBjcmVhdGVFdmVudERpc3BhdGNoZXIsIGNyZWF0ZV9hbmltYXRpb24sIGNyZWF0ZV9iaWRpcmVjdGlvbmFsX3RyYW5zaXRpb24sIGNyZWF0ZV9jb21wb25lbnQsIGNyZWF0ZV9pbl90cmFuc2l0aW9uLCBjcmVhdGVfb3V0X3RyYW5zaXRpb24sIGNyZWF0ZV9zbG90LCBjcmVhdGVfc3NyX2NvbXBvbmVudCwgY3VycmVudF9jb21wb25lbnQsIGN1c3RvbV9ldmVudCwgZGF0YXNldF9kZXYsIGRlYnVnLCBkZXN0cm95X2Jsb2NrLCBkZXN0cm95X2NvbXBvbmVudCwgZGVzdHJveV9lYWNoLCBkZXRhY2gsIGRldGFjaF9hZnRlcl9kZXYsIGRldGFjaF9iZWZvcmVfZGV2LCBkZXRhY2hfYmV0d2Vlbl9kZXYsIGRldGFjaF9kZXYsIGRpcnR5X2NvbXBvbmVudHMsIGRpc3BhdGNoX2RldiwgZWFjaCwgZWxlbWVudCwgZWxlbWVudF9pcywgZW1wdHksIGVzY2FwZSwgZXNjYXBlZCwgZXhjbHVkZV9pbnRlcm5hbF9wcm9wcywgZml4X2FuZF9kZXN0cm95X2Jsb2NrLCBmaXhfYW5kX291dHJvX2FuZF9kZXN0cm95X2Jsb2NrLCBmaXhfcG9zaXRpb24sIGZsdXNoLCBnZXRDb250ZXh0LCBnZXRfYmluZGluZ19ncm91cF92YWx1ZSwgZ2V0X2N1cnJlbnRfY29tcG9uZW50LCBnZXRfc2xvdF9jaGFuZ2VzLCBnZXRfc2xvdF9jb250ZXh0LCBnZXRfc3ByZWFkX29iamVjdCwgZ2V0X3NwcmVhZF91cGRhdGUsIGdldF9zdG9yZV92YWx1ZSwgZ2xvYmFscywgZ3JvdXBfb3V0cm9zLCBoYW5kbGVfcHJvbWlzZSwgaGFzX3Byb3AsIGlkZW50aXR5LCBpbml0LCBpbnNlcnQsIGluc2VydF9kZXYsIGludHJvcywgaW52YWxpZF9hdHRyaWJ1dGVfbmFtZV9jaGFyYWN0ZXIsIGlzX2NsaWVudCwgaXNfY3Jvc3NvcmlnaW4sIGlzX2Z1bmN0aW9uLCBpc19wcm9taXNlLCBsaXN0ZW4sIGxpc3Rlbl9kZXYsIGxvb3AsIGxvb3BfZ3VhcmQsIG1pc3NpbmdfY29tcG9uZW50LCBtb3VudF9jb21wb25lbnQsIG5vb3AsIG5vdF9lcXVhbCwgbm93LCBudWxsX3RvX2VtcHR5LCBvYmplY3Rfd2l0aG91dF9wcm9wZXJ0aWVzLCBvbkRlc3Ryb3ksIG9uTW91bnQsIG9uY2UsIG91dHJvX2FuZF9kZXN0cm95X2Jsb2NrLCBwcmV2ZW50X2RlZmF1bHQsIHByb3BfZGV2LCBxdWVyeV9zZWxlY3Rvcl9hbGwsIHJhZiwgcnVuLCBydW5fYWxsLCBzYWZlX25vdF9lcXVhbCwgc2NoZWR1bGVfdXBkYXRlLCBzZWxlY3RfbXVsdGlwbGVfdmFsdWUsIHNlbGVjdF9vcHRpb24sIHNlbGVjdF9vcHRpb25zLCBzZWxlY3RfdmFsdWUsIHNlbGYsIHNldENvbnRleHQsIHNldF9hdHRyaWJ1dGVzLCBzZXRfY3VycmVudF9jb21wb25lbnQsIHNldF9jdXN0b21fZWxlbWVudF9kYXRhLCBzZXRfZGF0YSwgc2V0X2RhdGFfZGV2LCBzZXRfaW5wdXRfdHlwZSwgc2V0X2lucHV0X3ZhbHVlLCBzZXRfbm93LCBzZXRfcmFmLCBzZXRfc3RvcmVfdmFsdWUsIHNldF9zdHlsZSwgc2V0X3N2Z19hdHRyaWJ1dGVzLCBzcGFjZSwgc3ByZWFkLCBzdG9wX3Byb3BhZ2F0aW9uLCBzdWJzY3JpYmUsIHN2Z19lbGVtZW50LCB0ZXh0LCB0aWNrLCB0aW1lX3Jhbmdlc190b19hcnJheSwgdG9fbnVtYmVyLCB0b2dnbGVfY2xhc3MsIHRyYW5zaXRpb25faW4sIHRyYW5zaXRpb25fb3V0LCB1cGRhdGVfa2V5ZWRfZWFjaCwgdXBkYXRlX3Nsb3QsIHZhbGlkYXRlX2NvbXBvbmVudCwgdmFsaWRhdGVfZWFjaF9hcmd1bWVudCwgdmFsaWRhdGVfZWFjaF9rZXlzLCB2YWxpZGF0ZV9zbG90cywgdmFsaWRhdGVfc3RvcmUsIHhsaW5rX2F0dHIgfTtcbiIsIi8vIHBhdGggdG8gd2hlcmUgdGhlIGltYWdlcyBhcmUgZG93bmxvYWRlZFxyXG4vL2NvbnN0IENBUkRfREFUQSA9IHJlcXVpcmUoXCIuL3NjcnlmYWxsLWRlZmF1bHQtY2FyZHMuanNvblwiKTtcclxuXHJcbmZ1bmN0aW9uIHRpbWVvdXQoKSB7XHJcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICByZXNvbHZlKCk7XHJcbiAgICB9LCA3MCk7XHJcbiAgfSk7XHJcbn1cclxuXHJcbmNsYXNzIE10Z0ludGVyZmFjZSB7XHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5fX2NhY2hlID0ge307XHJcbiAgfVxyXG5cclxuICBzZWFyY2gob3B0cyA9IHt9KSB7XHJcbiAgICAvLyBodHRwczovL2FwaS5zY3J5ZmFsbC5jb20vY2FyZHMvc2VhcmNoP29yZGVyPWNtYyZxPWMlM0FyZWQrcG93JTNEMyBcclxuICAgIC8vIGh0dHBzOi8vc2NyeWZhbGwuY29tL3NlYXJjaD9hcz1ncmlkJm9yZGVyPW5hbWUmcT1teXIrb3JhY2xlJTNBdG9rZW4rdHlwZSUzQWNyZWF0dXJlK2NvbW1hbmRlciUzQVdVQlJHXHJcblxyXG4gICAgbGV0IGJhc2V1cmw7XHJcblxyXG4gICAgaWYgKHR5cGVvZiBvcHRzICE9IFwic3RyaW5nXCIpIHtcclxuICAgICAgYmFzZXVybCA9IGBodHRwczovL2FwaS5zY3J5ZmFsbC5jb20vY2FyZHMvc2VhcmNoPyR7b3B0cy5wYWdlP1wicGFnZT1cIitvcHRzLnBhZ2UrXCImXCI6XCJcIn1vcmRlcj1jbWMmcT1gO1xyXG4gICAgICBjb25zdCBxdWVyaWVzID0gW107XHJcblxyXG4gICAgICBpZiAob3B0cy5uYW1lKSB7XHJcbiAgICAgICAgcXVlcmllcy5wdXNoKG9wdHMubmFtZSk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChvcHRzLmVkaGNvbG9ycyAmJiBvcHRzLmVkaGNvbG9ycy5zaXplKSB7XHJcbiAgICAgICAgbGV0IGNzID0gXCJcIjtcclxuICAgICAgICBmb3IgKGxldCBjb2xvciBvZiBvcHRzLmVkaGNvbG9ycykge1xyXG4gICAgICAgICAgY29sb3IgPSBjb2xvci50b1VwcGVyQ2FzZSgpO1xyXG4gICAgICAgICAgaWYgKGNvbG9yID09PSBcIkNcIikge1xyXG4gICAgICAgICAgICBjcyA9IFwiQ1wiO1xyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGNzICs9IGNvbG9yO1xyXG4gICAgICAgIH1cclxuICAgICAgICBxdWVyaWVzLnB1c2goXCJjb21tYW5kZXIlM0FcIiArIGNzKTtcclxuICAgICAgfVxyXG5cclxuXHJcbiAgICAgIGlmIChvcHRzLnR5cGUpIHtcclxuICAgICAgICBxdWVyaWVzLnB1c2goXCJ0eXBlJTNBXCIgKyBvcHRzLnR5cGUpO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChvcHRzLnRleHQpIHtcclxuICAgICAgICBsZXQgdGV4dCA9IG9wdHMudGV4dC50cmltKCkucmVwbGFjZSgvXFxzKy9nbSwgXCIrb3JhY2xlJTNBXCIpO1xyXG4gICAgICAgIHF1ZXJpZXMucHVzaChcIm9yYWNsZSUzQVwiICsgb3B0cy50ZXh0KTtcclxuICAgICAgfVxyXG5cclxuICAgICAgYmFzZXVybCA9IGJhc2V1cmwgKyBxdWVyaWVzLmpvaW4oXCIrXCIpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgYmFzZXVybCA9IG9wdHM7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZmV0Y2goYmFzZXVybClcclxuICAgICAgLnRoZW4oYXN5bmMgcmVzcG9uc2UgPT4ge1xyXG4gICAgICAgIGNvbnN0IGEgPSBhd2FpdCByZXNwb25zZS5qc29uKCk7XHJcbiAgICAgICAgcmV0dXJuIGE7XHJcbiAgICAgIH0pXHJcbiAgICAgIC50aGVuKHJlc3BvbnNlID0+IHtcclxuICAgICAgICBmb3IgKGxldCBjIG9mIHJlc3BvbnNlLmRhdGEpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKFwiY1wiLCBjKTtcclxuICAgICAgICAgIGlmICghYy5pbWFnZV91cmlzKSB7XHJcbiAgICAgICAgICAgIGlmIChjLmNhcmRfZmFjZXMpIHtcclxuICAgICAgICAgICAgICBjLmltYWdlX3VyaXMgPSBjLmNhcmRfZmFjZXNbMF0uaW1hZ2VfdXJpcztcclxuICAgICAgICAgICAgICBjb25zdCBiaXUgPSBjLmNhcmRfZmFjZXNbMV0uaW1hZ2VfdXJpcztcclxuICAgICAgICAgICAgICBjLmJhY2tzaWRlID0gYml1ID8gYml1LmJvcmRlcl9jcm9wIHx8IGJpdS5ub3JtYWwgOiBcIlwiO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBjLnVybCA9IGMgPyBjLmltYWdlX3VyaXMuYm9yZGVyX2Nyb3AgfHwgYy5pbWFnZV91cmlzLm5vcm1hbCA6IFwiXCI7XHJcbiAgICAgICAgICB0aGlzLl9fY2FjaGVbYy5uYW1lXSA9IGM7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiByZXNwb25zZTtcclxuICAgICAgfSlcclxuICAgICAgLmNhdGNoKGUgPT4geyBjb25zb2xlLmxvZyhlKTsgcmV0dXJuIHsgY29kZTogXCJub3RfZm91bmRcIiwgZGF0YTogW10gfTsgfSk7XHJcblxyXG4gIH1cclxuXHJcbiAgYXN5bmMgY2FyZEJ5TmFtZShuYW1lKSB7XHJcbiAgICBpZiAodGhpcy5fX2NhY2hlW25hbWVdKSByZXR1cm4gdGhpcy5fX2NhY2hlW25hbWVdO1xyXG4gICAgYXdhaXQgdGltZW91dCgpO1xyXG4gICAgLy9odHRwczovL2FwaS5zY3J5ZmFsbC5jb20vY2FyZHMvbmFtZWQ/ZnV6enk9YXVzdCtjb20gXHJcbiAgICBjb25zdCBmaXhlZCA9IG5hbWUucmVwbGFjZSgvXFxzL2csIFwiK1wiKTtcclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGZldGNoKCdodHRwczovL2FwaS5zY3J5ZmFsbC5jb20vY2FyZHMvbmFtZWQ/ZnV6enk9JyArIGZpeGVkKVxyXG4gICAgICAudGhlbihyZXNwb25zZSA9PiByZXNwb25zZS5qc29uKCkpLmNhdGNoKGUgPT4geyBjb25zb2xlLmxvZyhlKTsgcmV0dXJuIHsgY29kZTogXCJub3RfZm91bmRcIiB9OyB9KTtcclxuXHJcbiAgICB0aGlzLl9fY2FjaGVbbmFtZV0gPSByZXN1bHQ7XHJcbiAgICB0aGlzLl9fY2FjaGVbcmVzdWx0Lm5hbWVdID0gcmVzdWx0O1xyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICAgIC8vIC50aGVuKGRhdGEgPT4gY29uc29sZS5sb2coZGF0YSkpO1xyXG4gICAgLyogZm9yIChsZXQgY2FyZCBvZiBDQVJEX0RBVEEpIHtcclxuICAgICAgIGlmIChjYXJkLm5hbWUudG9Mb3dlckNhc2UoKSA9PSBuYW1lLnRvTG93ZXJDYXNlKCkpIHJldHVybiBjYXJkO1xyXG4gICAgIH0qL1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgc29ydChkZWNrU3RyaW5nLCB1cGRhdGUgPSAoKSA9PiB7fSkge1xyXG4gICAgZGVja1N0cmluZyA9IGRlY2tTdHJpbmcucmVwbGFjZSgvIy4qL2dtLCBcIlwiKTtcclxuICAgIGNvbnN0IGRlY2tSYXcgPSBkZWNrU3RyaW5nLnRyaW0oKS5yZXBsYWNlKC9cXCgoLio/KVxcKXwoWzAtOV0qXFxuKS9nLCBcIlxcblwiKS5yZXBsYWNlKC9cXHMqXFxuK1xccypcXG4rL2csIFwiXFxuXCIpLnNwbGl0KFwiXFxuXCIpO1xyXG5cclxuICAgIGxldCBjcmVhdHVyZXMgPSB7fTtcclxuICAgIGxldCBzcGVsbHMgPSB7fTtcclxuICAgIGxldCBsYW5kcyA9IHt9O1xyXG4gICAgbGV0IG1heWJlID0gW107XHJcbiAgICBjb25zdCBlcnJvcnMgPSBbXTtcclxuXHJcblxyXG4gICAgbGV0IHByb2dyZXNzID0gMDtcclxuICAgIGZvciAobGV0IGNhcmQgb2YgZGVja1Jhdykge1xyXG5cclxuICAgICAgbGV0IGNvdW50ID0gTWF0aC5mbG9vcigoKGNhcmQubWF0Y2goLyhcXGQrKS8pIHx8IFtdKVswXSB8fCAxKSk7XHJcbiAgICAgIGlmIChpc05hTihjb3VudCkpIHtcclxuICAgICAgICBjb3VudCA9IDE7XHJcbiAgICAgIH1cclxuICAgICAgcHJvZ3Jlc3MrKztcclxuXHJcbiAgICAgIGlmIChjYXJkLnRyaW0oKS5zdGFydHNXaXRoKFwiLy9cIikpIHtcclxuICAgICAgICBtYXliZS5wdXNoKGNhcmQudHJpbSgpKTtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IG5hbWUgPSBjYXJkLnJlcGxhY2UoLyhcXGQrKS8sIFwiXCIpLnRyaW0oKTtcclxuICAgICAgaWYgKCFuYW1lKSBjb250aW51ZTsgLy8gY2FudCB3b3JrIHdpdGggdGhpcyBkYXRhXHJcbiAgICAgIC8vIHNlYXJjaCB0aGUgYWNjb3JkaW5nIGRhdGFcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBsZXQgZGF0YSA9IGF3YWl0IHRoaXMuY2FyZEJ5TmFtZShuYW1lKTtcclxuXHJcbiAgICAgICAgaWYgKGRhdGEudHlwZV9saW5lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJsYW5kXCIpKSB7XHJcbiAgICAgICAgICBsYW5kc1tkYXRhLm5hbWVdID0gbGFuZHNbZGF0YS5uYW1lXSB8fCB7IGRhdGEsIGNvdW50OiAwLCBuYW1lOiBkYXRhLm5hbWUgfTtcclxuICAgICAgICAgIGxhbmRzW2RhdGEubmFtZV0uY291bnQrKztcclxuICAgICAgICB9IGVsc2UgaWYgKGRhdGEudHlwZV9saW5lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJjcmVhdHVyZVwiKSkge1xyXG4gICAgICAgICAgY3JlYXR1cmVzW2RhdGEubmFtZV0gPSBjcmVhdHVyZXNbZGF0YS5uYW1lXSB8fCB7IGRhdGEsIGNvdW50OiAwLCBuYW1lOiBkYXRhLm5hbWUgfTtcclxuICAgICAgICAgIGNyZWF0dXJlc1tkYXRhLm5hbWVdLmNvdW50Kys7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIHNwZWxsc1tkYXRhLm5hbWVdID0gc3BlbGxzW2RhdGEubmFtZV0gfHwgeyBkYXRhLCBjb3VudDogMCwgbmFtZTogZGF0YS5uYW1lIH07XHJcbiAgICAgICAgICBzcGVsbHNbZGF0YS5uYW1lXS5jb3VudCsrO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBlcnJvcnMucHVzaChuYW1lKTtcclxuICAgICAgfVxyXG4gICAgICB1cGRhdGUocHJvZ3Jlc3MsIGRlY2tSYXcubGVuZ3RoKTtcclxuICAgIH1cclxuXHJcbiAgICBjcmVhdHVyZXMgPSBPYmplY3QudmFsdWVzKGNyZWF0dXJlcykuc29ydCgoYSwgYikgPT4gYS5kYXRhLmNtYyA+IGIuZGF0YS5jbWMgPyAxIDogLTEpO1xyXG4gICAgc3BlbGxzID0gT2JqZWN0LnZhbHVlcyhzcGVsbHMpLnNvcnQoKGEsIGIpID0+IGEuZGF0YS5jbWMgPiBiLmRhdGEuY21jID8gMSA6IC0xKTtcclxuICAgIGxhbmRzID0gT2JqZWN0LnZhbHVlcyhsYW5kcykuc29ydCgoYSwgYikgPT4gYS5uYW1lID4gYi5uYW1lID8gMSA6IC0xKTtcclxuICAgIGxldCBvdXRwdXQgPSBcIiMgQ3JlYXR1cmVzXCI7XHJcbiAgICBmb3IgKGxldCBjdXIgb2YgY3JlYXR1cmVzKSB7XHJcbiAgICAgIG91dHB1dCArPSBcIlxcblwiICsgY3VyLmNvdW50ICsgXCIgXCIgKyBjdXIubmFtZTtcclxuICAgIH1cclxuICAgIG91dHB1dCArPSBcIlxcblxcbiMgU3BlbGxzXCI7XHJcbiAgICBmb3IgKGxldCBjdXIgb2Ygc3BlbGxzKSB7XHJcbiAgICAgIG91dHB1dCArPSBcIlxcblwiICsgY3VyLmNvdW50ICsgXCIgXCIgKyBjdXIubmFtZTtcclxuICAgIH1cclxuXHJcbiAgICBvdXRwdXQgKz0gXCJcXG5cXG4jIExhbmRzXCJcclxuICAgIGZvciAobGV0IGN1ciBvZiBsYW5kcykge1xyXG4gICAgICBvdXRwdXQgKz0gXCJcXG5cIiArIGN1ci5jb3VudCArIFwiIFwiICsgY3VyLm5hbWU7XHJcbiAgICB9XHJcblxyXG4gICAgb3V0cHV0ICs9IFwiXFxuXFxuIyBNYXliZVwiXHJcbiAgICBmb3IgKGxldCBjdXIgb2YgbWF5YmUpIHtcclxuICAgICAgb3V0cHV0ICs9IFwiXFxuLy9cIiArIGN1cjtcclxuICAgIH1cclxuXHJcbiAgICBvdXRwdXQgKz0gXCJcXG5cXG4jIE5vdCBGb3VuZFwiXHJcbiAgICBmb3IgKGxldCBjdXIgb2YgZXJyb3JzKSB7XHJcbiAgICAgIG91dHB1dCArPSBcIlxcbi8vXCIgKyBjdXIuY291bnQgKyBcIiBcIiArIGN1ci5uYW1lO1xyXG4gICAgfVxyXG5cclxuXHJcbiAgICByZXR1cm4gb3V0cHV0O1xyXG4gIH1cclxuXHJcblxyXG4gIC8qKlxyXG4gICAqIGNvbnZlcnRzIGEgZGVjayBzdHJpbmcgdG8gYSByZWFkYWJsZSBvYmplY3RcclxuICAgKiBhbmQgZG93bmxvYWRzIHRoZSBpbWcgZGF0YSBvbiBkZW1hbmQsIGlmIGl0IGRvZXMgbm90IGV4aXN0XHJcbiAgICpcclxuICAgKiBAcGFyYW0ge1N0cmluZ30gZGVja1N0cmluZyB0aGUgY29tcGxldGUgZGVjaywgY29waWVkIGZyb20gYSBzaXRlIG9yIGUuZyBmb3JnZVxyXG4gICAqIEBtZW1iZXJvZiBNdGdJbnRlcmZhY2VcclxuICAgKi9cclxuICBhc3luYyBjcmVhdGVEZWNrKGRlY2tTdHJpbmcsIHVwZGF0ZSA9ICgpID0+IHt9LCBzb3J0ID0gZmFsc2UpIHtcclxuICAgIC8vIGNvbnZlcnQgdGhlIGRlY2sgc3RyaW5nIHRvIGFuIGFycmF5XHJcblxyXG5cclxuXHJcblxyXG5cclxuXHJcblxyXG4gICAgbGV0IGdyb3VwcyA9IFsuLi5kZWNrU3RyaW5nLm1hdGNoKC8jKC4qPykoXFxufCQpL2cpIHx8IFtcIm1haW5cIl1dO1xyXG4gICAgY29uc3QgZGVja1JhdyA9IGRlY2tTdHJpbmcudHJpbSgpLnJlcGxhY2UoL1xcKCguKj8pXFwpfChbMC05XSpcXG4pL2csIFwiXFxuXCIpLnJlcGxhY2UoL1xccypcXG4rXFxzKlxcbisvZywgXCJcXG5cIikuc3BsaXQoXCJcXG5cIik7XHJcbiAgICBpZiAoIWRlY2tSYXcpIHJldHVybiBbXTtcclxuICAgIGlmICghZGVja1Jhd1swXS5pbmNsdWRlcyhcIiNcIikpIHtcclxuICAgICAgaWYgKGdyb3Vwc1swXSAhPT0gXCJtYWluXCIpIHtcclxuICAgICAgICBncm91cHMgPSBbXCJtYWluXCJdLmNvbmNhdChncm91cHMpO1xyXG4gICAgICB9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBkZWNrUmF3LnNoaWZ0KCk7XHJcbiAgICB9XHJcblxyXG5cclxuICAgIGdyb3VwcyA9IGdyb3Vwcy5tYXAodiA9PiB7IHJldHVybiB7IGRlY2s6IHt9LCBuYW1lOiB2LnJlcGxhY2UoXCIjXCIsIFwiXCIpLnRyaW0oKSB9IH0pO1xyXG5cclxuICAgIGxldCBjdXJHcm91cCA9IDA7XHJcblxyXG4gICAgbGV0IHByb2dyZXNzID0gMDtcclxuICAgIGxldCBpZ25vcmVkID0gMDtcclxuICAgIC8vIGl0ZXJhdGUgZWFjaCBmb3VuZCBjYXJkXHJcbiAgICBmb3IgKGxldCBjYXJkIG9mIGRlY2tSYXcpIHtcclxuICAgICAgaWYgKCFjYXJkKSBjb250aW51ZTtcclxuICAgICAgaWYgKGNhcmQudHJpbSgpLnN0YXJ0c1dpdGgoXCIvL1wiKSkgY29udGludWU7XHJcbiAgICAgIGlmIChjYXJkLmluY2x1ZGVzKFwiI1wiKSkge1xyXG4gICAgICAgIGN1ckdyb3VwKys7XHJcbiAgICAgICAgaWYgKGN1ckdyb3VwID4gZ3JvdXBzLmxlbmd0aCkgY3VyR3JvdXAgPSAwO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcbiAgICAgIHByb2dyZXNzKys7XHJcblxyXG4gICAgICBjb25zdCBkZWNrID0gZ3JvdXBzW2N1ckdyb3VwXS5kZWNrO1xyXG4gICAgICB1cGRhdGUocHJvZ3Jlc3MsIGRlY2tSYXcubGVuZ3RoIC0gZ3JvdXBzLmxlbmd0aCArIDEgLSBpZ25vcmVkKTtcclxuICAgICAgLy8gZXh0cmFjdCB0aGUgY291bnQgZnJvbSB0aGUgc3RyaW5nIGFuZCBmcmVlIHRoZSBuYW1lXHJcblxyXG4gICAgICBsZXQgY291bnQgPSBNYXRoLmZsb29yKCgoY2FyZC5tYXRjaCgvKFxcZCspLykgfHwgW10pWzBdIHx8IDEpKTtcclxuICAgICAgaWYgKGlzTmFOKGNvdW50KSkge1xyXG4gICAgICAgIGNvdW50ID0gMTtcclxuICAgICAgfVxyXG4gICAgICBjb25zdCBuYW1lID0gY2FyZC5yZXBsYWNlKC8oXFxkKykvLCBcIlwiKS50cmltKCk7XHJcbiAgICAgIGlmICghbmFtZSkgY29udGludWU7IC8vIGNhbnQgd29yayB3aXRoIHRoaXMgZGF0YVxyXG4gICAgICAvLyBzZWFyY2ggdGhlIGFjY29yZGluZyBkYXRhXHJcbiAgICAgIGxldCBkYXRhID0gYXdhaXQgdGhpcy5jYXJkQnlOYW1lKG5hbWUpO1xyXG5cclxuICAgICAgaWYgKGRhdGEubmFtZSlcclxuICAgICAgICBkZWNrU3RyaW5nID0gZGVja1N0cmluZy5yZXBsYWNlKG5hbWUsIGRhdGEubmFtZSk7XHJcbiAgICAgIGlmIChkYXRhLmNvZGUgPT0gXCJub3RfZm91bmRcIikge1xyXG4gICAgICAgIGRhdGEgPSB7IGltYWdlX3VyaXM6IHt9LCBsZWdhbGl0aWVzOiB7fSwgcHJpY2VzOiB7IHVzZDogMCB9LCBtYW5hX2Nvc3Q6IFwiXCIsIGNtYzogMCwgdHlwZV9saW5lOiBcImxhbmRcIiB9O1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChkZWNrW25hbWVdKSB7XHJcbiAgICAgICAgZGVja1tuYW1lXS5jb3VudCArPSBjb3VudDtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICAvLyB3cmFwIGRhdGEgaW4gZWFzeSByZWFkYWJsZSBmb3JtYXRcclxuICAgICAgICBsZXQgYmFja3NpZGUgPSBcIlwiO1xyXG4gICAgICAgIGlmICghZGF0YS5pbWFnZV91cmlzKSB7XHJcbiAgICAgICAgICBpZiAoZGF0YS5jYXJkX2ZhY2VzKSB7XHJcbiAgICAgICAgICAgIGRhdGEuaW1hZ2VfdXJpcyA9IGRhdGEuY2FyZF9mYWNlc1swXS5pbWFnZV91cmlzO1xyXG4gICAgICAgICAgICBjb25zdCBiaXUgPSBkYXRhLmNhcmRfZmFjZXNbMV0uaW1hZ2VfdXJpcztcclxuICAgICAgICAgICAgYmFja3NpZGUgPSBiaXUgPyBiaXUuYm9yZGVyX2Nyb3AgfHwgYml1Lm5vcm1hbCA6IFwiXCI7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhcImVyclwiLCBkYXRhKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHVybCA9IGRhdGEgPyBkYXRhLmltYWdlX3VyaXMuYm9yZGVyX2Nyb3AgfHwgZGF0YS5pbWFnZV91cmlzLm5vcm1hbCA6IFwiXCI7XHJcbiAgICAgICAgZGVja1tuYW1lXSA9IHtcclxuICAgICAgICAgIG5hbWUsXHJcbiAgICAgICAgICBjb3VudCxcclxuICAgICAgICAgIHVybCxcclxuICAgICAgICAgIGJhY2tzaWRlLFxyXG4gICAgICAgICAgZGF0YVxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIGxldCBsYW5kQ291bnQgPSAwO1xyXG4gICAgY29uc3Qgb3ZlcmFsbERldm90aW9uID0ge1xyXG4gICAgICBibHVlOiAwLFxyXG4gICAgICBibGFjazogMCxcclxuICAgICAgcmVkOiAwLFxyXG4gICAgICB3aGl0ZTogMCxcclxuICAgICAgZ3JlZW46IDAsXHJcbiAgICAgIGNvbG9ybGVzczogMCxcclxuICAgICAgZ2VuZXJpYzogMCxcclxuICAgICAgc3VtOiAwXHJcbiAgICB9O1xyXG4gICAgY29uc3Qgb3ZlcmFsbE1hbmFDdXJ2ZSA9IFtdO1xyXG4gICAgLy9tYW5hX2Nvc3Q6IFwie1d9e1V9e0J9e1J9e0d9IHtDfVwiXHJcblxyXG4gICAgbGV0IG92ZXJhbGxDb3VudCA9IDA7XHJcbiAgICBsZXQgb3ZlcmFsbENvc3QgPSAwO1xyXG5cclxuICAgIGxldCBjcmVhdHVyZUNvdW50ID0gMDtcclxuICAgIGxldCBpbnN0YW50Q291bnQgPSAwO1xyXG4gICAgbGV0IHNvcmNlcnlDb3VudCA9IDA7XHJcbiAgICBsZXQgZW5jaGFudG1lbnRDb3VudCA9IDA7XHJcbiAgICBsZXQgYXJ0aWZhY3RDb3VudCA9IDA7XHJcblxyXG4gICAgLy9tYW5hX2Nvc3Quc3BsaXQoXCJHXCIpLmxlbmd0aCAtIDFcclxuICAgIGZvciAobGV0IGdyb3VwIG9mIGdyb3Vwcykge1xyXG5cclxuICAgICAgZ3JvdXAuY2FyZHMgPSBPYmplY3QudmFsdWVzKGdyb3VwLmRlY2spO1xyXG4gICAgICBncm91cC5jYXJkcyA9IGdyb3VwLmNhcmRzLnNvcnQoKGEsIGIpID0+IGEuZGF0YS5jbWMgPiBiLmRhdGEuY21jID8gMSA6IC0xKTtcclxuXHJcbiAgICAgIGxldCBjb3VudCA9IDA7XHJcbiAgICAgIGxldCBjb3N0ID0gMDtcclxuICAgICAgY29uc3QgaXNNYXliZSA9IGdyb3VwLm5hbWUudG9Mb3dlckNhc2UoKSA9PSBcIm1heWJlXCI7XHJcblxyXG5cclxuICAgICAgY29uc3QgZGV2b3Rpb24gPSB7XHJcbiAgICAgICAgYmx1ZTogMCxcclxuICAgICAgICBibGFjazogMCxcclxuICAgICAgICByZWQ6IDAsXHJcbiAgICAgICAgd2hpdGU6IDAsXHJcbiAgICAgICAgZ3JlZW46IDAsXHJcbiAgICAgICAgY29sb3JsZXNzOiAwLFxyXG4gICAgICAgIGdlbmVyaWM6IDAsXHJcbiAgICAgICAgc3VtOiAwXHJcbiAgICAgIH07XHJcbiAgICAgIGNvbnN0IG1hbmFDdXJ2ZSA9IFtdO1xyXG4gICAgICBmb3IgKGxldCBjYXJkIG9mIGdyb3VwLmNhcmRzKSB7XHJcblxyXG4gICAgICAgIGlmICghaXNNYXliZSkge1xyXG4gICAgICAgICAgY291bnQgKz0gY2FyZC5jb3VudDtcclxuXHJcbiAgICAgICAgICBjb3N0ICs9IHBhcnNlRmxvYXQoY2FyZC5kYXRhLnByaWNlcy51c2QgfHwgMCkgKiBjYXJkLmNvdW50O1xyXG5cclxuICAgICAgICAgIGlmIChjYXJkLmRhdGEudHlwZV9saW5lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJsYW5kXCIpKSB7XHJcbiAgICAgICAgICAgIGxhbmRDb3VudCArPSBjYXJkLmNvdW50O1xyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgbWFuYUN1cnZlW2NhcmQuZGF0YS5jbWMgfHwgMF0gPSAobWFuYUN1cnZlW2NhcmQuZGF0YS5jbWMgfHwgMF0gfHwgMCkgKyBjYXJkLmNvdW50O1xyXG4gICAgICAgICAgfVxyXG5cclxuXHJcbiAgICAgICAgICBpZiAoY2FyZC5kYXRhLnR5cGVfbGluZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKFwiY3JlYXR1cmVcIikpIHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coXCJjcmVhdHVyZVwiLCBjYXJkLm5hbWUsIGNhcmQuY291bnQpO1xyXG4gICAgICAgICAgICBjcmVhdHVyZUNvdW50ICs9IGNhcmQuY291bnQ7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBpZiAoY2FyZC5kYXRhLnR5cGVfbGluZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKFwiYXJ0aWZhY3RcIikpIHtcclxuICAgICAgICAgICAgYXJ0aWZhY3RDb3VudCArPSBjYXJkLmNvdW50O1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgaWYgKGNhcmQuZGF0YS50eXBlX2xpbmUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhcImVuY2hhbnRtZW50XCIpKSB7XHJcbiAgICAgICAgICAgIGVuY2hhbnRtZW50Q291bnQgKz0gY2FyZC5jb3VudDtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGlmIChjYXJkLmRhdGEudHlwZV9saW5lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJpbnN0YW50XCIpKSB7XHJcbiAgICAgICAgICAgIGluc3RhbnRDb3VudCArPSBjYXJkLmNvdW50O1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgaWYgKGNhcmQuZGF0YS50eXBlX2xpbmUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhcInNvcmNlcnlcIikpIHtcclxuICAgICAgICAgICAgc29yY2VyeUNvdW50ICs9IGNhcmQuY291bnQ7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuXHJcbiAgICAgICAgY2FyZC5kYXRhLm1hbmFfY29zdCA9IGNhcmQuZGF0YS5tYW5hX2Nvc3QgfHwgXCJcIjtcclxuICAgICAgICBkZXZvdGlvbi5ibHVlICs9IChjYXJkLmRhdGEubWFuYV9jb3N0LnNwbGl0KFwiVVwiKS5sZW5ndGggLSAxKSAqIGNhcmQuY291bnQ7XHJcbiAgICAgICAgZGV2b3Rpb24uYmxhY2sgKz0gKGNhcmQuZGF0YS5tYW5hX2Nvc3Quc3BsaXQoXCJCXCIpLmxlbmd0aCAtIDEpICogY2FyZC5jb3VudDtcclxuICAgICAgICBkZXZvdGlvbi5yZWQgKz0gKGNhcmQuZGF0YS5tYW5hX2Nvc3Quc3BsaXQoXCJSXCIpLmxlbmd0aCAtIDEpICogY2FyZC5jb3VudDtcclxuICAgICAgICBkZXZvdGlvbi53aGl0ZSArPSAoY2FyZC5kYXRhLm1hbmFfY29zdC5zcGxpdChcIldcIikubGVuZ3RoIC0gMSkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIGRldm90aW9uLmdyZWVuICs9IChjYXJkLmRhdGEubWFuYV9jb3N0LnNwbGl0KFwiR1wiKS5sZW5ndGggLSAxKSAqIGNhcmQuY291bnQ7XHJcbiAgICAgICAgZGV2b3Rpb24uY29sb3JsZXNzICs9IChjYXJkLmRhdGEubWFuYV9jb3N0LnNwbGl0KFwiQ1wiKS5sZW5ndGggLSAxKSAqIGNhcmQuY291bnQ7XHJcbiAgICAgICAgZGV2b3Rpb24uZ2VuZXJpYyArPSBNYXRoLmZsb29yKGNhcmQuZGF0YS5tYW5hX2Nvc3QucmVwbGFjZSgvW14wLTkuXS9nLCBcIlwiKSB8fCAwKSAqIGNhcmQuY291bnQ7XHJcbiAgICAgICAgZGV2b3Rpb24uc3VtID0gZGV2b3Rpb24uYmx1ZSArIGRldm90aW9uLmJsYWNrICsgZGV2b3Rpb24ucmVkICsgZGV2b3Rpb24uZ3JlZW4gKyBkZXZvdGlvbi53aGl0ZSArIGRldm90aW9uLmNvbG9ybGVzcyArIGRldm90aW9uLmdlbmVyaWM7XHJcbiAgICAgIH1cclxuXHJcblxyXG5cclxuICAgICAgZ3JvdXAuY291bnQgPSBjb3VudDtcclxuICAgICAgZ3JvdXAubWFuYSA9IGRldm90aW9uO1xyXG4gICAgICBncm91cC5jb3N0ID0gY29zdDtcclxuXHJcbiAgICAgIGdyb3VwLm1hbmFDdXJ2ZSA9IG1hbmFDdXJ2ZTtcclxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtYW5hQ3VydmUubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICBtYW5hQ3VydmVbaV0gPSBtYW5hQ3VydmVbaV0gfHwgMDtcclxuICAgICAgICBpZiAoaXNNYXliZSkgY29udGludWU7XHJcbiAgICAgICAgb3ZlcmFsbE1hbmFDdXJ2ZVtpXSA9IChvdmVyYWxsTWFuYUN1cnZlW2ldIHx8IDApICsgKG1hbmFDdXJ2ZVtpXSB8fCAwKTtcclxuICAgICAgfVxyXG4gICAgICBpZiAoIWlzTWF5YmUpIHtcclxuXHJcbiAgICAgICAgb3ZlcmFsbENvc3QgKz0gY29zdDtcclxuICAgICAgICBvdmVyYWxsQ291bnQgKz0gY291bnQ7XHJcblxyXG4gICAgICAgIG92ZXJhbGxEZXZvdGlvbi5ibHVlICs9IGRldm90aW9uLmJsdWU7XHJcbiAgICAgICAgb3ZlcmFsbERldm90aW9uLmJsYWNrICs9IGRldm90aW9uLmJsYWNrO1xyXG4gICAgICAgIG92ZXJhbGxEZXZvdGlvbi5yZWQgKz0gZGV2b3Rpb24ucmVkO1xyXG4gICAgICAgIG92ZXJhbGxEZXZvdGlvbi53aGl0ZSArPSBkZXZvdGlvbi53aGl0ZTtcclxuICAgICAgICBvdmVyYWxsRGV2b3Rpb24uZ3JlZW4gKz0gZGV2b3Rpb24uZ3JlZW47XHJcbiAgICAgICAgb3ZlcmFsbERldm90aW9uLmNvbG9ybGVzcyArPSBkZXZvdGlvbi5jb2xvcmxlc3M7XHJcblxyXG4gICAgICAgIG92ZXJhbGxEZXZvdGlvbi5nZW5lcmljICs9IGRldm90aW9uLmdlbmVyaWM7XHJcbiAgICAgICAgb3ZlcmFsbERldm90aW9uLnN1bSArPSBkZXZvdGlvbi5zdW07XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG92ZXJhbGxNYW5hQ3VydmUubGVuZ3RoOyBpKyspIHtcclxuICAgICAgb3ZlcmFsbE1hbmFDdXJ2ZVtpXSA9IG92ZXJhbGxNYW5hQ3VydmVbaV0gfHwgMDtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBub25sYW5kcyA9IG92ZXJhbGxDb3VudCAtIGxhbmRDb3VudDtcclxuXHJcbiAgICBsZXQganVzdERldm90aW9uID0gb3ZlcmFsbERldm90aW9uLmJsdWUgKyBvdmVyYWxsRGV2b3Rpb24uYmxhY2sgKyBvdmVyYWxsRGV2b3Rpb24ucmVkICsgb3ZlcmFsbERldm90aW9uLndoaXRlICsgb3ZlcmFsbERldm90aW9uLmdyZWVuICsgb3ZlcmFsbERldm90aW9uLmNvbG9ybGVzcztcclxuICAgIGp1c3REZXZvdGlvbiA9IGp1c3REZXZvdGlvbiB8fCAxO1xyXG4gICAgY29uc3QgbWFuYVByb3Bvc2FsID0ge1xyXG4gICAgICBibHVlOiBvdmVyYWxsRGV2b3Rpb24uYmx1ZSAvIGp1c3REZXZvdGlvbixcclxuICAgICAgYmxhY2s6IG92ZXJhbGxEZXZvdGlvbi5ibGFjayAvIGp1c3REZXZvdGlvbixcclxuICAgICAgcmVkOiBvdmVyYWxsRGV2b3Rpb24ucmVkIC8ganVzdERldm90aW9uLFxyXG4gICAgICB3aGl0ZTogb3ZlcmFsbERldm90aW9uLndoaXRlIC8ganVzdERldm90aW9uLFxyXG4gICAgICBncmVlbjogb3ZlcmFsbERldm90aW9uLmdyZWVuIC8ganVzdERldm90aW9uLFxyXG4gICAgICBjb2xvcmxlc3M6IG92ZXJhbGxEZXZvdGlvbi5jb2xvcmxlc3MgLyBqdXN0RGV2b3Rpb24sXHJcbiAgICB9O1xyXG5cclxuICAgIGdyb3Vwc1tcIm1hbmFQcm9wb3NhbFwiXSA9IG1hbmFQcm9wb3NhbDtcclxuXHJcbiAgICBncm91cHNbXCJsYW5kQ291bnRcIl0gPSBsYW5kQ291bnQ7XHJcbiAgICBncm91cHNbXCJjYXJkQ291bnRcIl0gPSBvdmVyYWxsQ291bnQ7XHJcbiAgICBncm91cHNbXCJhdmVyYWdlTWFuYVwiXSA9IG92ZXJhbGxEZXZvdGlvbi5zdW0gLyAob3ZlcmFsbENvdW50IC0gbGFuZENvdW50KTtcclxuICAgIGdyb3Vwc1tcImNvc3RcIl0gPSBvdmVyYWxsQ29zdDtcclxuICAgIGdyb3Vwc1tcIm1hbmFcIl0gPSBvdmVyYWxsRGV2b3Rpb247XHJcbiAgICBncm91cHNbXCJjb3JyZWN0ZWRcIl0gPSBkZWNrU3RyaW5nO1xyXG4gICAgZ3JvdXBzW1wibWFuYUN1cnZlXCJdID0gb3ZlcmFsbE1hbmFDdXJ2ZTtcclxuXHJcblxyXG4gICAgZ3JvdXBzW1wiY3JlYXR1cmVDb3VudFwiXSA9IGNyZWF0dXJlQ291bnQ7XHJcbiAgICBncm91cHNbXCJpbnN0YW50Q291bnRcIl0gPSBpbnN0YW50Q291bnQ7XHJcbiAgICBncm91cHNbXCJzb3JjZXJ5Q291bnRcIl0gPSBzb3JjZXJ5Q291bnQ7XHJcbiAgICBncm91cHNbXCJlbmNoYW50bWVudENvdW50XCJdID0gZW5jaGFudG1lbnRDb3VudDtcclxuICAgIGdyb3Vwc1tcImFydGlmYWN0Q291bnRcIl0gPSBhcnRpZmFjdENvdW50O1xyXG4gICAgcmV0dXJuIGdyb3VwcztcclxuICB9XHJcbn1cclxuXHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IG5ldyBNdGdJbnRlcmZhY2UoKTsiLCIvKiFcbiAqIEphdmFTY3JpcHQgQ29va2llIHYyLjIuMVxuICogaHR0cHM6Ly9naXRodWIuY29tL2pzLWNvb2tpZS9qcy1jb29raWVcbiAqXG4gKiBDb3B5cmlnaHQgMjAwNiwgMjAxNSBLbGF1cyBIYXJ0bCAmIEZhZ25lciBCcmFja1xuICogUmVsZWFzZWQgdW5kZXIgdGhlIE1JVCBsaWNlbnNlXG4gKi9cbjsoZnVuY3Rpb24gKGZhY3RvcnkpIHtcblx0dmFyIHJlZ2lzdGVyZWRJbk1vZHVsZUxvYWRlcjtcblx0aWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZCkge1xuXHRcdGRlZmluZShmYWN0b3J5KTtcblx0XHRyZWdpc3RlcmVkSW5Nb2R1bGVMb2FkZXIgPSB0cnVlO1xuXHR9XG5cdGlmICh0eXBlb2YgZXhwb3J0cyA9PT0gJ29iamVjdCcpIHtcblx0XHRtb2R1bGUuZXhwb3J0cyA9IGZhY3RvcnkoKTtcblx0XHRyZWdpc3RlcmVkSW5Nb2R1bGVMb2FkZXIgPSB0cnVlO1xuXHR9XG5cdGlmICghcmVnaXN0ZXJlZEluTW9kdWxlTG9hZGVyKSB7XG5cdFx0dmFyIE9sZENvb2tpZXMgPSB3aW5kb3cuQ29va2llcztcblx0XHR2YXIgYXBpID0gd2luZG93LkNvb2tpZXMgPSBmYWN0b3J5KCk7XG5cdFx0YXBpLm5vQ29uZmxpY3QgPSBmdW5jdGlvbiAoKSB7XG5cdFx0XHR3aW5kb3cuQ29va2llcyA9IE9sZENvb2tpZXM7XG5cdFx0XHRyZXR1cm4gYXBpO1xuXHRcdH07XG5cdH1cbn0oZnVuY3Rpb24gKCkge1xuXHRmdW5jdGlvbiBleHRlbmQgKCkge1xuXHRcdHZhciBpID0gMDtcblx0XHR2YXIgcmVzdWx0ID0ge307XG5cdFx0Zm9yICg7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspIHtcblx0XHRcdHZhciBhdHRyaWJ1dGVzID0gYXJndW1lbnRzWyBpIF07XG5cdFx0XHRmb3IgKHZhciBrZXkgaW4gYXR0cmlidXRlcykge1xuXHRcdFx0XHRyZXN1bHRba2V5XSA9IGF0dHJpYnV0ZXNba2V5XTtcblx0XHRcdH1cblx0XHR9XG5cdFx0cmV0dXJuIHJlc3VsdDtcblx0fVxuXG5cdGZ1bmN0aW9uIGRlY29kZSAocykge1xuXHRcdHJldHVybiBzLnJlcGxhY2UoLyglWzAtOUEtWl17Mn0pKy9nLCBkZWNvZGVVUklDb21wb25lbnQpO1xuXHR9XG5cblx0ZnVuY3Rpb24gaW5pdCAoY29udmVydGVyKSB7XG5cdFx0ZnVuY3Rpb24gYXBpKCkge31cblxuXHRcdGZ1bmN0aW9uIHNldCAoa2V5LCB2YWx1ZSwgYXR0cmlidXRlcykge1xuXHRcdFx0aWYgKHR5cGVvZiBkb2N1bWVudCA9PT0gJ3VuZGVmaW5lZCcpIHtcblx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0fVxuXG5cdFx0XHRhdHRyaWJ1dGVzID0gZXh0ZW5kKHtcblx0XHRcdFx0cGF0aDogJy8nXG5cdFx0XHR9LCBhcGkuZGVmYXVsdHMsIGF0dHJpYnV0ZXMpO1xuXG5cdFx0XHRpZiAodHlwZW9mIGF0dHJpYnV0ZXMuZXhwaXJlcyA9PT0gJ251bWJlcicpIHtcblx0XHRcdFx0YXR0cmlidXRlcy5leHBpcmVzID0gbmV3IERhdGUobmV3IERhdGUoKSAqIDEgKyBhdHRyaWJ1dGVzLmV4cGlyZXMgKiA4NjRlKzUpO1xuXHRcdFx0fVxuXG5cdFx0XHQvLyBXZSdyZSB1c2luZyBcImV4cGlyZXNcIiBiZWNhdXNlIFwibWF4LWFnZVwiIGlzIG5vdCBzdXBwb3J0ZWQgYnkgSUVcblx0XHRcdGF0dHJpYnV0ZXMuZXhwaXJlcyA9IGF0dHJpYnV0ZXMuZXhwaXJlcyA/IGF0dHJpYnV0ZXMuZXhwaXJlcy50b1VUQ1N0cmluZygpIDogJyc7XG5cblx0XHRcdHRyeSB7XG5cdFx0XHRcdHZhciByZXN1bHQgPSBKU09OLnN0cmluZ2lmeSh2YWx1ZSk7XG5cdFx0XHRcdGlmICgvXltcXHtcXFtdLy50ZXN0KHJlc3VsdCkpIHtcblx0XHRcdFx0XHR2YWx1ZSA9IHJlc3VsdDtcblx0XHRcdFx0fVxuXHRcdFx0fSBjYXRjaCAoZSkge31cblxuXHRcdFx0dmFsdWUgPSBjb252ZXJ0ZXIud3JpdGUgP1xuXHRcdFx0XHRjb252ZXJ0ZXIud3JpdGUodmFsdWUsIGtleSkgOlxuXHRcdFx0XHRlbmNvZGVVUklDb21wb25lbnQoU3RyaW5nKHZhbHVlKSlcblx0XHRcdFx0XHQucmVwbGFjZSgvJSgyM3wyNHwyNnwyQnwzQXwzQ3wzRXwzRHwyRnwzRnw0MHw1Qnw1RHw1RXw2MHw3Qnw3RHw3QykvZywgZGVjb2RlVVJJQ29tcG9uZW50KTtcblxuXHRcdFx0a2V5ID0gZW5jb2RlVVJJQ29tcG9uZW50KFN0cmluZyhrZXkpKVxuXHRcdFx0XHQucmVwbGFjZSgvJSgyM3wyNHwyNnwyQnw1RXw2MHw3QykvZywgZGVjb2RlVVJJQ29tcG9uZW50KVxuXHRcdFx0XHQucmVwbGFjZSgvW1xcKFxcKV0vZywgZXNjYXBlKTtcblxuXHRcdFx0dmFyIHN0cmluZ2lmaWVkQXR0cmlidXRlcyA9ICcnO1xuXHRcdFx0Zm9yICh2YXIgYXR0cmlidXRlTmFtZSBpbiBhdHRyaWJ1dGVzKSB7XG5cdFx0XHRcdGlmICghYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSkge1xuXHRcdFx0XHRcdGNvbnRpbnVlO1xuXHRcdFx0XHR9XG5cdFx0XHRcdHN0cmluZ2lmaWVkQXR0cmlidXRlcyArPSAnOyAnICsgYXR0cmlidXRlTmFtZTtcblx0XHRcdFx0aWYgKGF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPT09IHRydWUpIHtcblx0XHRcdFx0XHRjb250aW51ZTtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdC8vIENvbnNpZGVycyBSRkMgNjI2NSBzZWN0aW9uIDUuMjpcblx0XHRcdFx0Ly8gLi4uXG5cdFx0XHRcdC8vIDMuICBJZiB0aGUgcmVtYWluaW5nIHVucGFyc2VkLWF0dHJpYnV0ZXMgY29udGFpbnMgYSAleDNCIChcIjtcIilcblx0XHRcdFx0Ly8gICAgIGNoYXJhY3Rlcjpcblx0XHRcdFx0Ly8gQ29uc3VtZSB0aGUgY2hhcmFjdGVycyBvZiB0aGUgdW5wYXJzZWQtYXR0cmlidXRlcyB1cCB0byxcblx0XHRcdFx0Ly8gbm90IGluY2x1ZGluZywgdGhlIGZpcnN0ICV4M0IgKFwiO1wiKSBjaGFyYWN0ZXIuXG5cdFx0XHRcdC8vIC4uLlxuXHRcdFx0XHRzdHJpbmdpZmllZEF0dHJpYnV0ZXMgKz0gJz0nICsgYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXS5zcGxpdCgnOycpWzBdO1xuXHRcdFx0fVxuXG5cdFx0XHRyZXR1cm4gKGRvY3VtZW50LmNvb2tpZSA9IGtleSArICc9JyArIHZhbHVlICsgc3RyaW5naWZpZWRBdHRyaWJ1dGVzKTtcblx0XHR9XG5cblx0XHRmdW5jdGlvbiBnZXQgKGtleSwganNvbikge1xuXHRcdFx0aWYgKHR5cGVvZiBkb2N1bWVudCA9PT0gJ3VuZGVmaW5lZCcpIHtcblx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0fVxuXG5cdFx0XHR2YXIgamFyID0ge307XG5cdFx0XHQvLyBUbyBwcmV2ZW50IHRoZSBmb3IgbG9vcCBpbiB0aGUgZmlyc3QgcGxhY2UgYXNzaWduIGFuIGVtcHR5IGFycmF5XG5cdFx0XHQvLyBpbiBjYXNlIHRoZXJlIGFyZSBubyBjb29raWVzIGF0IGFsbC5cblx0XHRcdHZhciBjb29raWVzID0gZG9jdW1lbnQuY29va2llID8gZG9jdW1lbnQuY29va2llLnNwbGl0KCc7ICcpIDogW107XG5cdFx0XHR2YXIgaSA9IDA7XG5cblx0XHRcdGZvciAoOyBpIDwgY29va2llcy5sZW5ndGg7IGkrKykge1xuXHRcdFx0XHR2YXIgcGFydHMgPSBjb29raWVzW2ldLnNwbGl0KCc9Jyk7XG5cdFx0XHRcdHZhciBjb29raWUgPSBwYXJ0cy5zbGljZSgxKS5qb2luKCc9Jyk7XG5cblx0XHRcdFx0aWYgKCFqc29uICYmIGNvb2tpZS5jaGFyQXQoMCkgPT09ICdcIicpIHtcblx0XHRcdFx0XHRjb29raWUgPSBjb29raWUuc2xpY2UoMSwgLTEpO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0dHJ5IHtcblx0XHRcdFx0XHR2YXIgbmFtZSA9IGRlY29kZShwYXJ0c1swXSk7XG5cdFx0XHRcdFx0Y29va2llID0gKGNvbnZlcnRlci5yZWFkIHx8IGNvbnZlcnRlcikoY29va2llLCBuYW1lKSB8fFxuXHRcdFx0XHRcdFx0ZGVjb2RlKGNvb2tpZSk7XG5cblx0XHRcdFx0XHRpZiAoanNvbikge1xuXHRcdFx0XHRcdFx0dHJ5IHtcblx0XHRcdFx0XHRcdFx0Y29va2llID0gSlNPTi5wYXJzZShjb29raWUpO1xuXHRcdFx0XHRcdFx0fSBjYXRjaCAoZSkge31cblx0XHRcdFx0XHR9XG5cblx0XHRcdFx0XHRqYXJbbmFtZV0gPSBjb29raWU7XG5cblx0XHRcdFx0XHRpZiAoa2V5ID09PSBuYW1lKSB7XG5cdFx0XHRcdFx0XHRicmVhaztcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH0gY2F0Y2ggKGUpIHt9XG5cdFx0XHR9XG5cblx0XHRcdHJldHVybiBrZXkgPyBqYXJba2V5XSA6IGphcjtcblx0XHR9XG5cblx0XHRhcGkuc2V0ID0gc2V0O1xuXHRcdGFwaS5nZXQgPSBmdW5jdGlvbiAoa2V5KSB7XG5cdFx0XHRyZXR1cm4gZ2V0KGtleSwgZmFsc2UgLyogcmVhZCBhcyByYXcgKi8pO1xuXHRcdH07XG5cdFx0YXBpLmdldEpTT04gPSBmdW5jdGlvbiAoa2V5KSB7XG5cdFx0XHRyZXR1cm4gZ2V0KGtleSwgdHJ1ZSAvKiByZWFkIGFzIGpzb24gKi8pO1xuXHRcdH07XG5cdFx0YXBpLnJlbW92ZSA9IGZ1bmN0aW9uIChrZXksIGF0dHJpYnV0ZXMpIHtcblx0XHRcdHNldChrZXksICcnLCBleHRlbmQoYXR0cmlidXRlcywge1xuXHRcdFx0XHRleHBpcmVzOiAtMVxuXHRcdFx0fSkpO1xuXHRcdH07XG5cblx0XHRhcGkuZGVmYXVsdHMgPSB7fTtcblxuXHRcdGFwaS53aXRoQ29udmVydGVyID0gaW5pdDtcblxuXHRcdHJldHVybiBhcGk7XG5cdH1cblxuXHRyZXR1cm4gaW5pdChmdW5jdGlvbiAoKSB7fSk7XG59KSk7XG4iLCI8c2NyaXB0PlxyXG4gIGltcG9ydCB7IG9uTW91bnQgfSBmcm9tIFwic3ZlbHRlXCI7XHJcbiAgaW1wb3J0IENhcmRMb2FkZXIgZnJvbSBcIi4vY2FyZC1sb2FkZXIuanNcIjtcclxuXHJcbiAgaW1wb3J0IENvb2tpZXMgZnJvbSBcImpzLWNvb2tpZVwiO1xyXG5cclxuICBjb25zdCBDQVJEX1JBVElPID0gMC43MTc2NDcwNTg4MjtcclxuICBsZXQgX2hlaWdodCA9IDMwMDtcclxuICBsZXQgX3dpZHRoID0gTWF0aC5mbG9vcihfaGVpZ2h0ICogQ0FSRF9SQVRJTyk7XHJcblxyXG4gIGxldCBoZWlnaHQgPSBfaGVpZ2h0O1xyXG4gIGxldCB3aWR0aCA9IF93aWR0aDtcclxuICBsZXQgY2FyZFNlYXJjaEFjdGl2ZSA9IHRydWU7XHJcbiAgbGV0IHN0YXRpc3RpY3NBY3RpdmUgPSB0cnVlO1xyXG4gIGxldCBzY2FsaW5nID0gMTAwO1xyXG5cclxuICBsZXQgZGV2b3Rpb25IaWdobGlnaHQgPSAtMTtcclxuXHJcbiAgZnVuY3Rpb24gaGlnaGxpZ2h0RGV2b3Rpb24obWFuYSkge1xyXG4gICAgaWYgKGRldm90aW9uSGlnaGxpZ2h0ID09IG1hbmEpIGRldm90aW9uSGlnaGxpZ2h0ID0gLTE7XHJcbiAgICBlbHNlIGRldm90aW9uSGlnaGxpZ2h0ID0gbWFuYSArIFwiXCI7XHJcbiAgfVxyXG5cclxuICAkOiB7XHJcbiAgICBjb25zdCBzID0gTWF0aC5mbG9vcihzY2FsaW5nIHx8IDEwMCkgLyAxMDA7XHJcbiAgICBoZWlnaHQgPSBfaGVpZ2h0ICogcztcclxuICAgIHdpZHRoID0gX3dpZHRoICogcztcclxuICB9XHJcblxyXG4gIGxldCBwcm9taXNlID0gbmV3IFByb21pc2UocmVzb2x2ZSA9PiByZXNvbHZlKFtdKSk7XHJcbiAgbGV0IGNhcmRTZWFyY2hQcm9taXNlID0gbmV3IFByb21pc2UocmVzb2x2ZSA9PlxyXG4gICAgcmVzb2x2ZSh7IGRhdGE6IFtdLCBoYXNfbW9yZTogZmFsc2UsIHRvdGFsX2NhcmRzOiAwIH0pXHJcbiAgKTtcclxuXHJcbiAgbGV0IGlucHV0O1xyXG4gIGxldCBmb3JtYXQ7XHJcbiAgbGV0IHByb2dyZXNzID0gMDtcclxuICBsZXQgYWxsID0gMDtcclxuXHJcbiAgbGV0IHNwTmFtZTtcclxuICBsZXQgc3BUZXh0O1xyXG5cclxuICBsZXQgc3BFREhCbHVlO1xyXG4gIGxldCBzcEVESEJsYWNrO1xyXG4gIGxldCBzcEVESFJlZDtcclxuICBsZXQgc3BFREhXaGl0ZTtcclxuICBsZXQgc3BFREhHcmVlbjtcclxuICBsZXQgc3BFREhDb2xvcmxlc3M7XHJcblxyXG4gIGxldCBkZWNrU2VhY2ggPSBudWxsO1xyXG4gIGxldCBkZWNrU2VhcmNoSW5wdXQ7XHJcblxyXG4gIGZ1bmN0aW9uIGNoYW5nZURlY2tTZWFyY2goZ3JvdXBzKSB7XHJcbiAgICBpZiAoIWdyb3VwcykgcmV0dXJuZGVja1NlYWNoID0gbnVsbDtcclxuICAgIGxldCBzID0gZGVja1NlYXJjaElucHV0LnZhbHVlO1xyXG4gICAgaWYgKCFzKSByZXR1cm4gKGRlY2tTZWFjaCA9IG51bGwpO1xyXG5cclxuICAgIHMgPSBzXHJcbiAgICAgIC50cmltKClcclxuICAgICAgLnJlcGxhY2UoL1xcc1xccysvZ20sIFwiIFwiKVxyXG4gICAgICAudG9Mb3dlckNhc2UoKVxyXG4gICAgICAucmVwbGFjZSgvXFxzL2dtLCBcIigufFxcbikqXCIpO1xyXG4gICAgLyogICAgLnNwbGl0KFwiK1wiKVxyXG4gICAgICAuam9pbihcInxcIik7Ki9cclxuICAgIGNvbnNvbGUubG9nKFwic2VhcmNoOlwiLCBzKTtcclxuICAgIGNvbnN0IHJlc3VsdCA9IFtdO1xyXG4gICAgbGV0IGNvdW50ID0gMDtcclxuICAgIGNvbnN0IHIgPSBuZXcgUmVnRXhwKHMsIFwiZ21cIik7XHJcbiAgICBmb3IgKGxldCBncm91cCBvZiBncm91cHMpIHtcclxuICAgICAgZm9yIChsZXQgY2FyZCBvZiBncm91cC5jYXJkcykge1xyXG4gICAgICAgIGlmICghY2FyZCB8fCAhY2FyZC5kYXRhIHx8ICFjYXJkLmRhdGEub3JhY2xlX3RleHQpIGNvbnRpbnVlO1xyXG4gICAgICAgIGlmICghY2FyZC5kYXRhLm9yYWNsZV90ZXh0LnRvTG93ZXJDYXNlKCkubWF0Y2gocikpIGNvbnRpbnVlO1xyXG4gICAgICAgIGNvdW50ICs9IGNhcmQuY291bnQ7XHJcbiAgICAgICAgcmVzdWx0LnB1c2goY2FyZCk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBkZWNrU2VhY2ggPSBbXHJcbiAgICAgIHtcclxuICAgICAgICBjYXJkczogcmVzdWx0LFxyXG4gICAgICAgIGNvc3Q6IDAsXHJcbiAgICAgICAgY291bnQsXHJcbiAgICAgICAgZGVjazoge30sXHJcbiAgICAgICAgbWFuYToge1xyXG4gICAgICAgICAgYmxhY2s6IDAsXHJcbiAgICAgICAgICBibHVlOiAwLFxyXG4gICAgICAgICAgY29sb3JsZXNzOiAwLFxyXG4gICAgICAgICAgZ2VuZXJpYzogMjQwLFxyXG4gICAgICAgICAgZ3JlZW46IDAsXHJcbiAgICAgICAgICByZWQ6IDAsXHJcbiAgICAgICAgICBzdW06IDI0MCxcclxuICAgICAgICAgIHdoaXRlOiAwXHJcbiAgICAgICAgfSxcclxuICAgICAgICBtYW5hQ3VydmU6IFtdLFxyXG4gICAgICAgIG5hbWU6IFwic2VhcmNoIHJlc3VsdFwiXHJcbiAgICAgIH1cclxuICAgIF07XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIGNsZWFyRm9yQ29sb3JsZXNzKCkge1xyXG4gICAgc3BFREhCbHVlLmNoZWNrZWQgPSBmYWxzZTtcclxuICAgIHNwRURIQmxhY2suY2hlY2tlZCA9IGZhbHNlO1xyXG4gICAgc3BFREhSZWQuY2hlY2tlZCA9IGZhbHNlO1xyXG4gICAgc3BFREhXaGl0ZS5jaGVja2VkID0gZmFsc2U7XHJcbiAgICBzcEVESEdyZWVuLmNoZWNrZWQgPSBmYWxzZTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIGNsZWFyQ29sb3JsZXNzKCkge1xyXG4gICAgc3BFREhDb2xvcmxlc3MuY2hlY2tlZCA9IGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gc2VhcmNoQ2FyZHMobmV4dFVybCkge1xyXG4gICAgaWYgKHR5cGVvZiBuZXh0VXJsID09IFwic3RyaW5nXCIpIHtcclxuICAgICAgY2FyZFNlYXJjaFByb21pc2UgPSBDYXJkTG9hZGVyLnNlYXJjaChuZXh0VXJsKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3QgY29sb3JzID0gbmV3IFNldCgpO1xyXG4gICAgaWYgKHNwRURIQ29sb3JsZXNzLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJDXCIpO1xyXG4gICAgaWYgKHNwRURIQmx1ZS5jaGVja2VkKSBjb2xvcnMuYWRkKFwiVVwiKTtcclxuICAgIGlmIChzcEVESEJsYWNrLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJCXCIpO1xyXG4gICAgaWYgKHNwRURIUmVkLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJSXCIpO1xyXG4gICAgaWYgKHNwRURIV2hpdGUuY2hlY2tlZCkgY29sb3JzLmFkZChcIldcIik7XHJcbiAgICBpZiAoc3BFREhHcmVlbi5jaGVja2VkKSBjb2xvcnMuYWRkKFwiR1wiKTtcclxuXHJcbiAgICBjYXJkU2VhcmNoUHJvbWlzZSA9IENhcmRMb2FkZXIuc2VhcmNoKHtcclxuICAgICAgbmFtZTogc3BOYW1lLnZhbHVlLFxyXG4gICAgICB0ZXh0OiBzcFRleHQudmFsdWUsXHJcbiAgICAgIGVkaGNvbG9yczogY29sb3JzXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIGxldCBoaWRkZW5Hcm91cHMgPSBuZXcgU2V0KCk7XHJcblxyXG4gIGZ1bmN0aW9uIHRvZ2dsZUdyb3VwVmlzaWJpbGl0eShncm91cCkge1xyXG4gICAgaWYgKGhpZGRlbkdyb3Vwcy5oYXMoZ3JvdXAubmFtZSkpIGhpZGRlbkdyb3Vwcy5kZWxldGUoZ3JvdXAubmFtZSk7XHJcbiAgICBlbHNlIGhpZGRlbkdyb3Vwcy5hZGQoZ3JvdXAubmFtZSk7XHJcblxyXG4gICAgaGlkZGVuR3JvdXBzID0gaGlkZGVuR3JvdXBzO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gc3AocCwgYSkge1xyXG4gICAgcHJvZ3Jlc3MgPSBwO1xyXG4gICAgYWxsID0gYTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHJlc2V0RGVja1NlYXJjaCgpIHtcclxuICAgIGRlY2tTZWFjaCA9IG51bGw7XHJcbiAgICBpZiAoIWRlY2tTZWFyY2hJbnB1dCkgcmV0dXJuO1xyXG4gICAgZGVja1NlYXJjaElucHV0LnZhbHVlID0gXCJcIjtcclxuICB9XHJcbiAgZnVuY3Rpb24gc29ydERlY2tTdHJpbmcoKSB7XHJcbiAgICBwcm9taXNlID0gQ2FyZExvYWRlci5zb3J0KGlucHV0LnZhbHVlIHx8IFwiXCIsIChwLCBhKSA9PiB7XHJcbiAgICAgIHJlc2V0RGVja1NlYXJjaCgpO1xyXG4gICAgICBzcChwLCBhKTtcclxuICAgIH0pXHJcbiAgICAgIC5jYXRjaChlID0+IHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGUpO1xyXG4gICAgICAgIHRocm93IGU7XHJcbiAgICAgIH0pXHJcbiAgICAgIC50aGVuKHJlcyA9PiB7XHJcbiAgICAgICAgaW5wdXQudmFsdWUgPSByZXM7XHJcbiAgICAgICAgcmV0dXJuIHVwZGF0ZSh7IGtleUNvZGU6IDI3IH0sIHRydWUpO1xyXG4gICAgICB9KTtcclxuICB9XHJcblxyXG4gIGFzeW5jIGZ1bmN0aW9uIHVwZGF0ZShldnQpIHtcclxuICAgIGlmIChldnQua2V5Q29kZSAhPT0gMjcpIHJldHVybjtcclxuICAgIHByb21pc2UgPSBDYXJkTG9hZGVyLmNyZWF0ZURlY2soaW5wdXQudmFsdWUgfHwgXCJcIiwgKHAsIGEpID0+IHtcclxuICAgICAgcmVzZXREZWNrU2VhcmNoKCk7XHJcbiAgICAgIHNwKHAsIGEpO1xyXG4gICAgfSlcclxuICAgICAgLmNhdGNoKGUgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZSk7XHJcbiAgICAgICAgdGhyb3cgZTtcclxuICAgICAgfSlcclxuICAgICAgLnRoZW4ocmVzID0+IHtcclxuICAgICAgICBpbnB1dC52YWx1ZSA9IHJlcy5jb3JyZWN0ZWQ7XHJcbiAgICAgICAgcmV0dXJuIHJlcztcclxuICAgICAgfSk7XHJcblxyXG4gICAgcmV0dXJuIHByb21pc2U7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIHJlbG9hZCgpIHtcclxuICAgIHJlc2V0RGVja1NlYXJjaCgpO1xyXG4gICAgdXBkYXRlKHsga2V5Q29kZTogMjcgfSk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBhcHBlbmRDYXJkKG5hbWUpIHtcclxuICAgIGlmICghbmFtZSkgcmV0dXJuO1xyXG4gICAgcmVzZXREZWNrU2VhcmNoKCk7XHJcbiAgICBpbnB1dC52YWx1ZSA9IGlucHV0LnZhbHVlICsgXCJcXG4xIFwiICsgbmFtZTtcclxuICAgIHJlbG9hZCgpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gcmVtb3ZlKGNhcmQpIHtcclxuICAgIGNvbnN0IHIgPSBuZXcgUmVnRXhwKGBeLioke2NhcmQubmFtZX0uKiRgLCBcImdtXCIpO1xyXG5cclxuICAgIGlucHV0LnZhbHVlID0gaW5wdXQudmFsdWUucmVwbGFjZShyLCBcIi8vIFwiICsgY2FyZC5jb3VudCArIFwiIFwiICsgY2FyZC5uYW1lKTtcclxuICAgIHByb21pc2UgPSBDYXJkTG9hZGVyLmNyZWF0ZURlY2soaW5wdXQudmFsdWUgfHwgXCJcIiwgKHAsIGEpID0+XHJcbiAgICAgIHNwKHAsIGEpXHJcbiAgICApLmNhdGNoKGUgPT4ge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGUpO1xyXG4gICAgICB0aHJvdyBlO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBjb3B5RGVjaygpIHtcclxuICAgIGNvbnN0IGRlY2sgPSBpbnB1dC52YWx1ZTtcclxuXHJcbiAgICBpbnB1dC52YWx1ZSA9IGlucHV0LnZhbHVlLnJlcGxhY2UoLyMuKnxcXC9cXC8uKi9nbSwgXCJcXG5cIik7XHJcblxyXG4gICAgaW5wdXQuc2VsZWN0KCk7XHJcblxyXG4gICAgaW5wdXQuc2V0U2VsZWN0aW9uUmFuZ2UoMCwgOTk5OTkpO1xyXG4gICAgZG9jdW1lbnQuZXhlY0NvbW1hbmQoXCJjb3B5XCIpO1xyXG5cclxuICAgIGlucHV0LnZhbHVlID0gZGVjaztcclxuICB9XHJcblxyXG4gIGxldCBoZWxwQWN0aXZlID0gdHJ1ZTtcclxuICBvbk1vdW50KGFzeW5jICgpID0+IHtcclxuICAgIGNvbnN0IHN0YXJ0ID1cclxuICAgICAgQ29va2llcy5nZXQoXCJkZWNrXCIpIHx8XHJcbiAgICAgIGAjbGFuZHNcclxubW91bnRhaW5cclxuMiBwbGFpbnNcclxuMyBzd2FtcHNcclxuIyBtYWluIGRlY2tcclxuMjAgYmxpZ2h0c3RlZWwgY29sb3NzdXNgO1xyXG5cclxuICAgIGhlbHBBY3RpdmUgPSBDb29raWVzLmdldChcImhlbHBBY3RpdmVcIikgPT0gXCJ0cnVlXCI7XHJcbiAgICBjb25zb2xlLmxvZyhcImhlbHA6XCIsIENvb2tpZXMuZ2V0KFwiaGVscEFjdGl2ZVwiKSk7XHJcbiAgICBjYXJkU2VhcmNoQWN0aXZlID0gQ29va2llcy5zZXQoXCJjYXJkU2VhcmNoQWN0aXZlXCIpID09IFwidHJ1ZVwiO1xyXG4gICAgY29uc29sZS5sb2coXCJzZWFyY2g6XCIsIENvb2tpZXMuc2V0KFwiY2FyZFNlYXJjaEFjdGl2ZVwiKSk7XHJcbiAgICBzdGF0aXN0aWNzQWN0aXZlID0gQ29va2llcy5zZXQoXCJzdGF0aXN0aWNzQWN0aXZlXCIpID09IFwidHJ1ZVwiO1xyXG4gICAgY29uc29sZS5sb2coXCJzdGF0aXN0aWNzOlwiLCBDb29raWVzLnNldChcInN0YXRpc3RpY3NBY3RpdmVcIikpO1xyXG5cclxuICAgIHN0YXRpc3RpY3NBY3RpdmU7XHJcbiAgICBpbnB1dC52YWx1ZSA9IHN0YXJ0O1xyXG4gICAgY29uc29sZS5sb2coXCJTVFNGU0RGXCIsIENvb2tpZXMuZ2V0KFwiZGVja1wiKSksXHJcbiAgICAgIChwcm9taXNlID0gQ2FyZExvYWRlci5jcmVhdGVEZWNrKHN0YXJ0LCAocCwgYSkgPT4gc3AocCwgYSkpKTtcclxuICB9KTtcclxuXHJcbiAgZnVuY3Rpb24gb25UeXBpbmcoKSB7XHJcbiAgICBDb29raWVzLnNldChcImRlY2tcIiwgaW5wdXQudmFsdWUsIHsgZXhwaXJlczogNyB9KTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIGdldEhlaWdodChtYW5hLCBncm91cHMpIHtcclxuICAgIHJldHVybiAxMDAgKiAobWFuYSAvIE1hdGgubWF4KC4uLmdyb3Vwc1tcIm1hbmFDdXJ2ZVwiXSkpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gb3BlbkhlbHAoKSB7XHJcbiAgICBoZWxwQWN0aXZlID0gIWhlbHBBY3RpdmU7XHJcbiAgICBDb29raWVzLnNldChcImhlbHBBY3RpdmVcIiwgaGVscEFjdGl2ZSArIFwiXCIpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gdG9nZ2xlU2VhcmNoKCkge1xyXG4gICAgY2FyZFNlYXJjaEFjdGl2ZSA9ICFjYXJkU2VhcmNoQWN0aXZlO1xyXG4gICAgQ29va2llcy5zZXQoXCJjYXJkU2VhcmNoQWN0aXZlXCIsIGNhcmRTZWFyY2hBY3RpdmUgKyBcIlwiKTtcclxuICB9XHJcbiAgZnVuY3Rpb24gdG9nZ2xlU3RhdGlzdGljcygpIHtcclxuICAgIHN0YXRpc3RpY3NBY3RpdmUgPSAhc3RhdGlzdGljc0FjdGl2ZTtcclxuICAgIENvb2tpZXMuc2V0KFwic3RhdGlzdGljc0FjdGl2ZVwiLCBzdGF0aXN0aWNzQWN0aXZlICsgXCJcIik7XHJcbiAgfVxyXG48L3NjcmlwdD5cclxuXHJcbjxzdHlsZT5cclxuICAuY29udGVudCB7XHJcbiAgICAtLXJhaXNpbi1ibGFjazogaHNsYSgyMDAsIDglLCAxNSUsIDEpO1xyXG4gICAgLS1yb21hbi1zaWx2ZXI6IGhzbGEoMTk2LCAxNSUsIDYwJSwgMSk7XHJcbiAgICAtLWNvbG9ybGVzczogaHNsYSgwLCAwJSwgODklLCAxKTtcclxuICAgIC0tYmxhY2s6IGhzbGEoODMsIDglLCAzOCUsIDEpO1xyXG4gICAgLS13aGl0ZTogaHNsKDQ4LCA2NCUsIDg5JSk7XHJcbiAgICAtLXJlZDogaHNsYSgwLCA3MSUsIDg0JSwgMSk7XHJcbiAgICAtLWdyZWVuOiBoc2xhKDExNCwgNjAlLCA3NSUsIDEpO1xyXG4gICAgLS1ibHVlOiBoc2xhKDIzNSwgNTUlLCA4MSUsIDEpO1xyXG4gIH1cclxuXHJcbiAgLmNvbnRlbnQge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgICB3aWR0aDogMTAwJTtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICB9XHJcblxyXG4gIC5oZWxwLXN5bWJvbCB7XHJcbiAgICBib3JkZXItcmFkaXVzOiA1MCU7XHJcbiAgICBib3JkZXI6IDFweCBzb2xpZCBibGFjaztcclxuICAgIHdpZHRoOiAxNnB4O1xyXG4gICAgaGVpZ2h0OiAxNnB4O1xyXG4gICAgdGV4dC1hbGlnbjogY2VudGVyO1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgcmlnaHQ6IDEwcHg7XHJcbiAgICB0b3A6IDEwcHg7XHJcbiAgICBjdXJzb3I6IHBvaW50ZXI7XHJcbiAgfVxyXG5cclxuICAuaGVscC1zeW1ib2w6aG92ZXIge1xyXG4gICAgYm9yZGVyLWNvbG9yOiBibHVlO1xyXG4gICAgY29sb3I6IGJsdWU7XHJcbiAgfVxyXG5cclxuICAudG9nZ2xlLXNlYXJjaCB7XHJcbiAgICBiYWNrZ3JvdW5kOiBibHVlO1xyXG4gICAgd2lkdGg6IDMwcHg7XHJcbiAgICBoZWlnaHQ6IDMwcHg7XHJcbiAgICBjdXJzb3I6IHBvaW50ZXI7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICBsZWZ0OiAtMzBweDtcclxuICAgIHRvcDogNTAlO1xyXG4gICAgdXNlci1zZWxlY3Q6IG5vbmU7XHJcbiAgfVxyXG5cclxuICAuaGlkZSAudG9nZ2xlLXNlYXJjaCB7XHJcbiAgICBsZWZ0OiAtNTJweDtcclxuICB9XHJcblxyXG4gIC5zdGF0aXN0aWNzIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gIH1cclxuICAuaW5wdXQge1xyXG4gICAgd2lkdGg6IDEwMCU7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgICBib3gtc2l6aW5nOiBib3JkZXItYm94O1xyXG4gICAgcGFkZGluZzogMTBweDtcclxuICAgIHJlc2l6ZTogbm9uZTtcclxuICB9XHJcblxyXG4gIC5jb250cm9scyB7XHJcbiAgICBmbGV4LXNocmluazogMDtcclxuICAgIHdpZHRoOiAzMDBweDtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICAgIGJhY2tncm91bmQ6IGxpZ2h0Z3JheTtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gIH1cclxuXHJcbiAgLmhlbHAge1xyXG4gICAgcGFkZGluZzogMHB4IDEwcHggMTBweCAxMHB4O1xyXG4gICAgdXNlci1zZWxlY3Q6IG5vbmU7XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgfVxyXG5cclxuICAuZ3JvdXAtY29udGVudCB7XHJcbiAgICBmbGV4LWdyb3c6IDE7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC13cmFwOiB3cmFwO1xyXG4gICAgdHJhbnNpdGlvbjogaGVpZ2h0IDUwMG1zIGVhc2U7XHJcbiAgfVxyXG5cclxuICAuZ3JvdXAtY29udGVudC5oaWRkZW4ge1xyXG4gICAgb3ZlcmZsb3c6IGhpZGRlbjtcclxuICAgIGhlaWdodDogNDVweDtcclxuICB9XHJcblxyXG4gIC5jYXJkLXNlYXJjaCB7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgICBmbGV4LWdyb3c6IDE7XHJcbiAgICBiYWNrZ3JvdW5kOiB3aGl0ZTtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgcmlnaHQ6IDA7XHJcbiAgICB3aWR0aDogMzMlO1xyXG4gICAgei1pbmRleDogMTAwO1xyXG4gICAgYm94LXNoYWRvdzogMHB4IDBweCAxMHB4IGJsYWNrO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQtc2VhcmNoLmhpZGUge1xyXG4gICAgcmlnaHQ6IC0zMyU7XHJcbiAgfVxyXG5cclxuICAuc2VhcmNoLXBhcmFtcyB7XHJcbiAgICBmbGV4LXNocmluazogMDtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gIH1cclxuXHJcbiAgLnNlYXJjaC1yZXN1bHQge1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gICAgZmxleC1ncm93OiAxO1xyXG4gICAgYmFja2dyb3VuZDogd2hpdGU7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICAgIG92ZXJmbG93OiBhdXRvO1xyXG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xyXG4gICAgdXNlci1zZWxlY3Q6IG5vbmU7XHJcbiAgICBmbGV4LXdyYXA6IHdyYXA7XHJcbiAgfVxyXG5cclxuICAuZGlzcGxheSB7XHJcbiAgICBmbGV4LWdyb3c6IDE7XHJcbiAgICBiYWNrZ3JvdW5kOiBncmF5O1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XHJcbiAgICBmbGV4LXdyYXA6IG5vd3JhcDtcclxuICAgIG92ZXJmbG93OiBhdXRvO1xyXG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xyXG4gICAgdXNlci1zZWxlY3Q6IG5vbmU7XHJcbiAgfVxyXG5cclxuICAubG9hZGluZy13cmFwcGVyIHtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIGxlZnQ6IDUwJTtcclxuICAgIHRvcDogMDtcclxuICAgIGJvdHRvbTogMDtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBhbGlnbi1pdGVtczogY2VudGVyO1xyXG4gIH1cclxuXHJcbiAgLmVudHJ5IHtcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICAgIHBhZGRpbmc6IDEwcHg7XHJcbiAgICBmbGV4LXNocmluazogMDtcclxuICB9XHJcbiAgLmNhcmQge1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgcmdiKDIyLCAyMiwgMjIpO1xyXG4gICAgYm9yZGVyLXJhZGl1czogMTBweDtcclxuICAgIG91dGxpbmU6IDA7XHJcbiAgICBib3gtc2hhZG93OiAwcHggMHB4IDEwcHggYmxhY2s7XHJcbiAgfVxyXG5cclxuICAuY2FyZC5iYW5uZWQge1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgcmVkO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQuaGlnaGxpZ2h0ZWQge1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgeWVsbG93O1xyXG4gIH1cclxuXHJcbiAgLmNhcmQ6aG92ZXIge1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgYmx1ZTtcclxuICAgIGN1cnNvcjogcG9pbnRlcjtcclxuICB9XHJcblxyXG4gIC5wcmljZSxcclxuICAuYmFubmVkLXRleHQsXHJcbiAgLmNvdW50IHtcclxuICAgIGZvbnQtc2l6ZTogMzRweDtcclxuICAgIHRleHQtc2hhZG93OiAwcHggMHB4IDlweCBibGFjaztcclxuICAgIGNvbG9yOiByZWQ7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICB6LWluZGV4OiAxMDA7XHJcbiAgICBmb250LXdlaWdodDogYm9sZDtcclxuICAgIGxlZnQ6IDM0cHg7XHJcbiAgfVxyXG5cclxuICAuYmFubmVkLXRleHQge1xyXG4gICAgZm9udC1zaXplOiAxMDAlO1xyXG4gICAgdGV4dC1zaGFkb3c6IDBweCAwcHggOXB4IGJsYWNrO1xyXG4gICAgY29sb3I6IHJlZDtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIHotaW5kZXg6IDEwMDtcclxuICAgIGZvbnQtd2VpZ2h0OiBib2xkO1xyXG4gICAgbGVmdDogMTclO1xyXG4gIH1cclxuICAuY291bnQge1xyXG4gICAgdG9wOiAxNjVweDtcclxuICB9XHJcblxyXG4gIC5wcmljZSB7XHJcbiAgICBib3R0b206IDdweDtcclxuICAgIGNvbG9yOiB3aGVhdDtcclxuICAgIGZvbnQtc2l6ZTogMTJweDtcclxuICAgIGJhY2tncm91bmQ6IGJsYWNrO1xyXG4gICAgbGVmdDogNDUlO1xyXG4gICAgZm9udC13ZWlnaHQ6IG5vcm1hbDtcclxuICB9XHJcblxyXG4gIC5ncm91cC1oZWFkZXIge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGJhY2tncm91bmQ6IGRhcmtncmV5O1xyXG4gICAgLyogcGFkZGluZzogOHB4OyAqL1xyXG4gICAgbWFyZ2luOiA4cHggMDtcclxuICAgIGJveC1zaGFkb3c6IDBweCAwcHggOHB4IGJsYWNrO1xyXG4gICAgd2lkdGg6IDEwMCU7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gIH1cclxuXHJcbiAgLmdyb3VwLWhlYWRlciBoMiB7XHJcbiAgICBwYWRkaW5nOiAwIDI1cHg7XHJcbiAgICBtYXJnaW46IDBweDtcclxuICB9XHJcblxyXG4gIC5ncm91cC1zdGF0aXN0aWNzIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gIH1cclxuXHJcbiAgLm1hbmEtcHJvcG9zYWwsXHJcbiAgLm1hbmEtZGV2b3Rpb24ge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgfVxyXG5cclxuICAuZGVjay12YWx1ZSxcclxuICAuZ3JvdXAtdmFsdWUge1xyXG4gICAgcGFkZGluZzogNXB4O1xyXG4gICAgY29sb3I6IGJsYWNrO1xyXG4gICAgYm9yZGVyLXJhZGl1czogNTAlO1xyXG4gICAgd2lkdGg6IDE1cHg7XHJcbiAgICBoZWlnaHQ6IDE1cHg7XHJcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7XHJcbiAgICBtYXJnaW46IDVweDtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7XHJcbiAgICBhbGlnbi1pdGVtczogY2VudGVyO1xyXG4gICAgZm9udC1zaXplOiAxMXB4O1xyXG4gICAgZm9udC13ZWlnaHQ6IGJvbGQ7XHJcbiAgfVxyXG4gIC5ibHVlIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWJsdWUpO1xyXG4gIH1cclxuICAuYmxhY2sge1xyXG4gICAgY29sb3I6IHdoaXRlO1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0tYmxhY2spO1xyXG4gIH1cclxuICAucmVkIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLXJlZCk7XHJcbiAgfVxyXG4gIC53aGl0ZSB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS13aGl0ZSk7XHJcbiAgfVxyXG4gIC5ncmVlbiB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS1ncmVlbik7XHJcbiAgfVxyXG4gIC5jb2xvcmxlc3Mge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0tY29sb3JsZXNzKTtcclxuICB9XHJcbiAgLmdlbmVyaWMge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogZ29sZGVucm9kO1xyXG4gIH1cclxuICAuc3VtIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IGdvbGRlbnJvZDtcclxuICB9XHJcblxyXG4gIC5jb2xvci1wYXJhbSB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICB9XHJcblxyXG4gIC5tYW5hLWN1cnZlIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gIH1cclxuXHJcbiAgLmFsbC1jdXJ2ZXMge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZ3JvdzogMTtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgICBoZWlnaHQ6IDgwcHg7XHJcbiAgfVxyXG5cclxuICAuYWxsLWxhYmVscyB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1zaHJpbms6IDA7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gIH1cclxuXHJcbiAgLmN1cnZlLWVsZW1lbnQge1xyXG4gICAgd2lkdGg6IDIwcHg7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgYm90dG9tOiAwO1xyXG4gICAgYmFja2dyb3VuZDogZ3JheTtcclxuICAgIC8qIHZlcnRpY2FsLWFsaWduOiBtaWRkbGU7ICovXHJcbiAgICBhbGlnbi1pdGVtczogY2VudGVyO1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gIH1cclxuXHJcbiAgLmN1cnZlLWxhYmVsIHtcclxuICAgIHdpZHRoOiAyMHB4O1xyXG4gIH1cclxuICAuY3VydmUtd3JhcHBlciB7XHJcbiAgICB3aWR0aDogMjBweDtcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICAgIGN1cnNvcjogcG9pbnRlcjtcclxuICB9XHJcblxyXG4gIC5jdXJ2ZS1lbGVtZW50OmhvdmVyIHtcclxuICAgIGJhY2tncm91bmQ6IGxpZ2h0Y29yYWw7XHJcbiAgfVxyXG5cclxuICAuaGlnaGxpZ2h0ZWQgLmN1cnZlLWVsZW1lbnQge1xyXG4gICAgYmFja2dyb3VuZDogbGlnaHRibHVlO1xyXG4gIH1cclxuXHJcbiAgLmN1cnZlLWxhYmVsLmhpZ2hsaWdodGVkIHtcclxuICAgIGJhY2tncm91bmQ6IGxpZ2h0Ymx1ZTtcclxuICB9XHJcblxyXG4gIC5jdXJ2ZS1sYWJlbDpob3ZlciB7XHJcbiAgICBiYWNrZ3JvdW5kOiBsaWdodGNvcmFsO1xyXG4gIH1cclxuXHJcbiAgaDQge1xyXG4gICAgbWFyZ2luLXRvcDogNXB4O1xyXG4gICAgbWFyZ2luLWJvdHRvbTogNXB4O1xyXG4gIH1cclxuXHJcbiAgLmxkcy1yaXBwbGUge1xyXG4gICAgZGlzcGxheTogaW5saW5lLWJsb2NrO1xyXG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xyXG4gICAgd2lkdGg6IDgwcHg7XHJcbiAgICBoZWlnaHQ6IDgwcHg7XHJcbiAgfVxyXG4gIC5sZHMtcmlwcGxlIGRpdiB7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICBib3JkZXI6IDRweCBzb2xpZCAjZmZmO1xyXG4gICAgb3BhY2l0eTogMTtcclxuICAgIGJvcmRlci1yYWRpdXM6IDUwJTtcclxuICAgIGFuaW1hdGlvbjogbGRzLXJpcHBsZSAxcyBjdWJpYy1iZXppZXIoMCwgMC4yLCAwLjgsIDEpIGluZmluaXRlO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQtc2VhcmNoIC5sZHMtcmlwcGxlIGRpdiB7XHJcbiAgICBib3JkZXI6IDRweCBzb2xpZCBibGFjaztcclxuICB9XHJcblxyXG4gIC5sZHMtcmlwcGxlIGRpdjpudGgtY2hpbGQoMikge1xyXG4gICAgYW5pbWF0aW9uLWRlbGF5OiAtMC41cztcclxuICB9XHJcbiAgQGtleWZyYW1lcyBsZHMtcmlwcGxlIHtcclxuICAgIDAlIHtcclxuICAgICAgdG9wOiAzNnB4O1xyXG4gICAgICBsZWZ0OiAzNnB4O1xyXG4gICAgICB3aWR0aDogMDtcclxuICAgICAgaGVpZ2h0OiAwO1xyXG4gICAgICBvcGFjaXR5OiAxO1xyXG4gICAgfVxyXG4gICAgMTAwJSB7XHJcbiAgICAgIHRvcDogMHB4O1xyXG4gICAgICBsZWZ0OiAwcHg7XHJcbiAgICAgIHdpZHRoOiA3MnB4O1xyXG4gICAgICBoZWlnaHQ6IDcycHg7XHJcbiAgICAgIG9wYWNpdHk6IDA7XHJcbiAgICB9XHJcbiAgfVxyXG48L3N0eWxlPlxyXG5cclxuPHN2ZWx0ZTp3aW5kb3cgb246a2V5dXA9e3VwZGF0ZX0gLz5cclxuPGRpdiBjbGFzcz1cImNvbnRlbnRcIj5cclxuICA8ZGl2IGNsYXNzPVwiY29udHJvbHNcIj5cclxuICAgIDxkaXYgY2xhc3M9XCJoZWxwXCI+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJoZWxwLXN5bWJvbFwiIG9uOmNsaWNrPXtvcGVuSGVscH0+PzwvZGl2PlxyXG5cclxuICAgICAgeyNpZiBoZWxwQWN0aXZlfVxyXG4gICAgICAgIDxoND5Ib3cgdG8gdXNlOjwvaDQ+XHJcbiAgICAgICAgPHA+cGFzdGUgeW91ciBkZWNrIHRvIHRoZSBmb2xsb3dpbmcgaW5wdXQuPC9wPlxyXG4gICAgICAgIDx1bD5cclxuICAgICAgICAgIDxsaT5cclxuICAgICAgICAgICAgd2hlbiBhIGxpbmUgc3RhcnRzIHdpdGggXCIjXCIgaXQgd2lsbCBiZSBpbnRlcnByZXRlZCBhcyBoZWFkbGluZVxyXG4gICAgICAgICAgPC9saT5cclxuICAgICAgICAgIDxsaT5cclxuICAgICAgICAgICAgYSBjYXJkIGNhbiBiZSBlbnRlcmVkIHdpdGggYSBsZWFkaW5nIGNvdW50LCBvciBqdXN0IHdpdGggaXRzIG5hbWVcclxuICAgICAgICAgIDwvbGk+XHJcbiAgICAgICAgICA8bGk+dXNlIHRoZSBcIkVTQ1wiIGtleSB0byByZWFsb2FkIHRoZSBwcmV2aWV3PC9saT5cclxuICAgICAgICAgIDxsaT5kb3VibGVjbGljayBhIGNhcmQgdG8gcmVtb3ZlIGl0PC9saT5cclxuICAgICAgICA8L3VsPlxyXG4gICAgICAgIDxwPk5PVEU6IHdlIHVzZSBjb29raWVzIHRvIHN0b3JlIHlvdXIgZGVjayBhZnRlciByZWxvYWQuPC9wPlxyXG4gICAgICAgIDxwPk5PVEU6IFRoaXMgaXMgbm90IGFuIG9mZmljaWFsIE1hZ2ljIHByb2R1a3QuPC9wPlxyXG4gICAgICB7L2lmfVxyXG5cclxuICAgICAgeyNhd2FpdCBwcm9taXNlfVxyXG5cclxuICAgICAgICA8ZGl2PmxvYWRpbmc6IHtwcm9ncmVzc30ve2FsbH08L2Rpdj5cclxuICAgICAgezp0aGVuIGdyb3Vwc31cclxuXHJcbiAgICAgICAgeyNpZiAhaGVscEFjdGl2ZX1cclxuICAgICAgICAgIDxoND5HZW5lcmFsPC9oND5cclxuXHJcbiAgICAgICAgICA8ZGl2PlRvdGFsIGNhcmRzOiB7Z3JvdXBzWydjYXJkQ291bnQnXX08L2Rpdj5cclxuICAgICAgICAgIDxkaXY+XHJcbiAgICAgICAgICAgIExhbmRzOiB7Z3JvdXBzWydsYW5kQ291bnQnXX0gTm9ubGFuZHM6IHtncm91cHNbJ2NhcmRDb3VudCddIC0gZ3JvdXBzWydsYW5kQ291bnQnXX1cclxuICAgICAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgICAgIDxkaXY+Q3JlYXR1cmVzOiB7Z3JvdXBzWydjcmVhdHVyZUNvdW50J119PC9kaXY+XHJcbiAgICAgICAgICA8ZGl2Pkluc3RhbnRzOiB7Z3JvdXBzWydpbnN0YW50Q291bnQnXX08L2Rpdj5cclxuICAgICAgICAgIDxkaXY+U29yY2VyaWVzOiB7Z3JvdXBzWydzb3JjZXJ5Q291bnQnXX08L2Rpdj5cclxuICAgICAgICAgIDxkaXY+RW5jaGFudG1lbnRzOiB7Z3JvdXBzWydlbmNoYW50bWVudENvdW50J119PC9kaXY+XHJcbiAgICAgICAgICA8ZGl2PkFydGlmYWN0czoge2dyb3Vwc1snYXJ0aWZhY3RDb3VudCddfTwvZGl2PlxyXG5cclxuICAgICAgICAgIDxkaXY+Q29zdDoge2dyb3Vwcy5jb3N0LnRvRml4ZWQoMikgKyAnJCd9PC9kaXY+XHJcblxyXG4gICAgICAgICAgeyNpZiBzdGF0aXN0aWNzQWN0aXZlfVxyXG4gICAgICAgICAgICA8ZGl2IGNsYXNzPVwic3RhdGlzdGljc1wiPlxyXG4gICAgICAgICAgICAgIDxoND5EZXZvdGlvbjwvaDQ+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cIm1hbmEtZGV2b3Rpb25cIj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGJsdWVcIj57Z3JvdXBzWydtYW5hJ10uYmx1ZX08L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGJsYWNrXCI+e2dyb3Vwc1snbWFuYSddLmJsYWNrfTwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgcmVkXCI+e2dyb3Vwc1snbWFuYSddLnJlZH08L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIHdoaXRlXCI+e2dyb3Vwc1snbWFuYSddLndoaXRlfTwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgZ3JlZW5cIj57Z3JvdXBzWydtYW5hJ10uZ3JlZW59PC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBjb2xvcmxlc3NcIj5cclxuICAgICAgICAgICAgICAgICAge2dyb3Vwc1snbWFuYSddLmNvbG9ybGVzc31cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgICAgICAgICA8aDQ+R2VuZXJpYyBNYW5hPC9oND5cclxuICAgICAgICAgICAgICA8ZGl2PlJlbWFpbmluZyBnZW5lcmljIG1hbmEgY29zdHM6e2dyb3Vwc1snbWFuYSddLmdlbmVyaWN9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdj5DTUMtTWFuYS1TdW06e2dyb3Vwc1snbWFuYSddLnN1bX08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2PlxyXG4gICAgICAgICAgICAgICAgQXZlcmFnZSBDTUMgcGVyIE5vbmxhbmQ6IHtncm91cHNbJ2F2ZXJhZ2VNYW5hJ10udG9GaXhlZCgyKX1cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICA8aDQ+U3VnZ2VzdGVkIE1hbmEgRGlzdHJpYnV0aW9uPC9oND5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwibWFuYS1wcm9wb3NhbFwiPlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgYmx1ZVwiPlxyXG4gICAgICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10uYmx1ZSAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGJsYWNrXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS5ibGFjayAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIHJlZFwiPlxyXG4gICAgICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10ucmVkICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgd2hpdGVcIj5cclxuICAgICAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLndoaXRlICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgZ3JlZW5cIj5cclxuICAgICAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLmdyZWVuICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgY29sb3JsZXNzXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS5jb2xvcmxlc3MgKiBncm91cHNbJ2xhbmRDb3VudCddKS50b0ZpeGVkKDEpfVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgPGg0Pk1hbmEgQ3VydmU8L2g0PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJtYW5hLWN1cnZlXCI+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiYWxsLWN1cnZlc1wiPlxyXG4gICAgICAgICAgICAgICAgICB7I2VhY2ggZ3JvdXBzWydtYW5hQ3VydmUnXSBhcyBtYW5hLCBpfVxyXG4gICAgICAgICAgICAgICAgICAgIHsjaWYgbWFuYSA+IDB9XHJcbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiY3VydmUtd3JhcHBlclwiXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzOmhpZ2hsaWdodGVkPXtkZXZvdGlvbkhpZ2hsaWdodCA9PSBpfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBvbjpjbGljaz17KCkgPT4gaGlnaGxpZ2h0RGV2b3Rpb24oaSl9PlxyXG4gICAgICAgICAgICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJjdXJ2ZS1lbGVtZW50XCJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICBzdHlsZT17J2hlaWdodDonICsgZ2V0SGVpZ2h0KG1hbmEsIGdyb3VwcykgKyAnJTsnfT5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICB7bWFuYSB8fCAnJ31cclxuICAgICAgICAgICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgICAgICB7L2lmfVxyXG4gICAgICAgICAgICAgICAgICB7L2VhY2h9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiYWxsLWxhYmVsc1wiPlxyXG4gICAgICAgICAgICAgICAgICB7I2VhY2ggZ3JvdXBzWydtYW5hQ3VydmUnXSBhcyBtYW5hLCBpfVxyXG4gICAgICAgICAgICAgICAgICAgIHsjaWYgbWFuYSA+IDB9XHJcbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiY3VydmUtbGFiZWxcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzczpoaWdobGlnaHRlZD17ZGV2b3Rpb25IaWdobGlnaHQgPT0gaX1cclxuICAgICAgICAgICAgICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodERldm90aW9uKGkpfT5cclxuICAgICAgICAgICAgICAgICAgICAgICAge2l9XHJcbiAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgICAgICB7L2lmfVxyXG4gICAgICAgICAgICAgICAgICB7L2VhY2h9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICB7L2lmfVxyXG4gICAgICAgIHsvaWZ9XHJcbiAgICAgICAgPGRpdj5cclxuICAgICAgICAgIHNlYXJjaDpcclxuICAgICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e2RlY2tTZWFyY2hJbnB1dH1cclxuICAgICAgICAgICAgdGl0bGU9XCJlLmcuOiBzYWNyaWZpY2UgYSAoYXJ0aWZhY3R8Y3JlYXR1cmUpXCJcclxuICAgICAgICAgICAgb246a2V5dXA9eygpID0+IGNoYW5nZURlY2tTZWFyY2goZ3JvdXBzKX0gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgezpjYXRjaCBlcnJvcn1cclxuICAgICAgICB7ZXJyb3J9XHJcbiAgICAgIHsvYXdhaXR9XHJcbiAgICAgIEZvcm1hdDpcclxuICAgICAgPHNlbGVjdFxyXG4gICAgICAgIGJpbmQ6dGhpcz17Zm9ybWF0fVxyXG4gICAgICAgIG9uOmJsdXI9e3JlbG9hZH1cclxuICAgICAgICBvbjpjaGFuZ2U9e3JlbG9hZH1cclxuICAgICAgICB0aXRsZT1cInNlbGVjdCB0aGUgbGVnYWxpdHkgY2hlY2tlclwiPlxyXG4gICAgICAgIDxvcHRpb24gc2VsZWN0ZWQ+Y29tbWFuZGVyPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5icmF3bDwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+ZHVlbDwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+ZnV0dXJlPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5oaXN0b3JpYzwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+bGVnYWN5PC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5tb2Rlcm48L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPm9sZHNjaG9vbDwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+cGF1cGVyPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5wZW5ueTwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+cGlvbmVlcjwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+c3RhbmRhcmQ8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnZpbnRhZ2U8L29wdGlvbj5cclxuICAgICAgPC9zZWxlY3Q+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJzbGlkZWNvbnRhaW5lclwiPlxyXG4gICAgICAgIFNjYWxlOlxyXG4gICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgdHlwZT1cInJhbmdlXCJcclxuICAgICAgICAgIG1pbj1cIjI1XCJcclxuICAgICAgICAgIG1heD1cIjEwMFwiXHJcbiAgICAgICAgICBiaW5kOnZhbHVlPXtzY2FsaW5nfVxyXG4gICAgICAgICAgdGl0bGU9XCJzY2FsZXMgdGhlIGNhcmQgc2l6ZSBpbiB0aGUgcmlnaHQgdmlld1wiIC8+XHJcbiAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgPGJ1dHRvblxyXG4gICAgICAgIG9uOmNsaWNrPXt0b2dnbGVTdGF0aXN0aWNzfVxyXG4gICAgICAgIHRpdGxlPVwidG9nZ2xlcyB0aGUgdmlzaWJpbGl0eSBvZiB0aGUgc3RhdGlzdGlja3NcIj5cclxuICAgICAgICB7c3RhdGlzdGljc0FjdGl2ZSA/ICdoaWRlIHN0YXRpc3RpY3MnIDogJ3Nob3cgc3RhdGlzdGljcyd9XHJcbiAgICAgIDwvYnV0dG9uPlxyXG4gICAgICA8YnV0dG9uXHJcbiAgICAgICAgb246Y2xpY2s9e3NvcnREZWNrU3RyaW5nfVxyXG4gICAgICAgIHRpdGxlPVwidGhpcyBzb3J0cyB0aGUgZGVjayB0byBsYW5kcyBzcGVsbHMgYW5kIGNyZWF0dXJlcyAtTk9URTogeW91clxyXG4gICAgICAgIGdyb3VwcyB3aWxsIGJlIHJlcGxhY2VkXCI+XHJcbiAgICAgICAgc29ydFxyXG4gICAgICA8L2J1dHRvbj5cclxuICAgICAgPGJ1dHRvblxyXG4gICAgICAgIG9uOmNsaWNrPXtjb3B5RGVja31cclxuICAgICAgICB0aXRsZT1cInRoaXMgY29waWVzIHRoZSBkZWNrIHdpdGhvdXQgZ3JvdXBzIGFuZCBzdHVmZiB0byB5b3VyIGNsaXBib2FyZFwiPlxyXG4gICAgICAgIGNsZWFuIGNvcHlcclxuICAgICAgPC9idXR0b24+XHJcbiAgICAgIDxidXR0b24gb246Y2xpY2s9e3JlbG9hZH0+cmVmcmVzaDwvYnV0dG9uPlxyXG4gICAgPC9kaXY+XHJcbiAgICA8dGV4dGFyZWEgYmluZDp0aGlzPXtpbnB1dH0gY2xhc3M9XCJpbnB1dFwiIG9uOmtleXVwPXtvblR5cGluZ30gLz5cclxuICA8L2Rpdj5cclxuXHJcbiAgPGRpdiBjbGFzcz1cImRpc3BsYXlcIj5cclxuICAgIHsjYXdhaXQgcHJvbWlzZX1cclxuICAgICAgPGRpdiBjbGFzcz1cImxvYWRpbmctd3JhcHBlclwiPlxyXG4gICAgICAgIDxkaXY+bG9hZGluZzoge3Byb2dyZXNzfS97YWxsfTwvZGl2PlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJsZHMtcmlwcGxlXCI+XHJcbiAgICAgICAgICA8ZGl2IC8+XHJcbiAgICAgICAgICA8ZGl2IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgezp0aGVuIGdyb3Vwc31cclxuXHJcbiAgICAgIHsjZWFjaCBkZWNrU2VhY2ggfHwgZ3JvdXBzIHx8IFtdIGFzIGdyb3VwfVxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJncm91cFwiPlxyXG5cclxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC1oZWFkZXJcIj5cclxuICAgICAgICAgICAgPGgyPntncm91cC5uYW1lICsgJyAvLyAnICsgZ3JvdXAuY291bnQgfHwgJ25vIG5hbWUnfTwvaDI+XHJcbiAgICAgICAgICAgIDxidXR0b24gb246Y2xpY2s9eygpID0+IHRvZ2dsZUdyb3VwVmlzaWJpbGl0eShncm91cCl9PlxyXG4gICAgICAgICAgICAgIHRvZ2dsZVxyXG4gICAgICAgICAgICA8L2J1dHRvbj5cclxuICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXN0YXRpc3RpY3NcIj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgYmx1ZVwiPntncm91cC5tYW5hLmJsdWV9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGJsYWNrXCI+e2dyb3VwLm1hbmEuYmxhY2t9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIHJlZFwiPntncm91cC5tYW5hLnJlZH08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgd2hpdGVcIj57Z3JvdXAubWFuYS53aGl0ZX08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgZ3JlZW5cIj57Z3JvdXAubWFuYS5ncmVlbn08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgY29sb3JsZXNzXCI+e2dyb3VwLm1hbmEuY29sb3JsZXNzfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDwhLS0gZ2VuZXJpYzpcclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgZ2VuZXJpY1wiPntncm91cC5tYW5hLmdlbmVyaWN9PC9kaXY+IC0tPlxyXG4gICAgICAgICAgICAgIHN1bTpcclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgc3VtXCI+e2dyb3VwLm1hbmEuc3VtfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSBncm91cC1jb3N0XCI+XHJcbiAgICAgICAgICAgICAgICB7Z3JvdXAuY29zdC50b0ZpeGVkKDIpICsgJyQnfVxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgY2xhc3M9XCJncm91cC1jb250ZW50XCJcclxuICAgICAgICAgICAgY2xhc3M6aGlkZGVuPXtoaWRkZW5Hcm91cHMuaGFzKGdyb3VwLm5hbWUpfT5cclxuXHJcbiAgICAgICAgICAgIHsjZWFjaCBncm91cC5jYXJkcyBhcyBjYXJkfVxyXG4gICAgICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgICAgIGNsYXNzPVwiZW50cnlcIlxyXG4gICAgICAgICAgICAgICAgc3R5bGU9eyd3aWR0aDonICsgd2lkdGggKyAncHg7IGhlaWdodDonICsgKGNhcmQuY291bnQgPD0gNCA/IGhlaWdodCArICgoY2FyZC5jb3VudCB8fCAxKSAtIDEpICogNDAgOiBoZWlnaHQgKyAzICogNDApICsgJ3B4Oyd9PlxyXG5cclxuICAgICAgICAgICAgICAgIHsjZWFjaCB7IGxlbmd0aDogY2FyZC5jb3VudCA+IDQgPyA0IDogY2FyZC5jb3VudCB9IGFzIF8sIGl9XHJcbiAgICAgICAgICAgICAgICAgIDxpbWdcclxuICAgICAgICAgICAgICAgICAgICBjbGFzczpiYW5uZWQ9e2NhcmQuZGF0YS5sZWdhbGl0aWVzW2Zvcm1hdC52YWx1ZV0gIT09ICdsZWdhbCd9XHJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M6aGlnaGxpZ2h0ZWQ9e2Rldm90aW9uSGlnaGxpZ2h0ID09IGNhcmQuZGF0YS5jbWN9XHJcbiAgICAgICAgICAgICAgICAgICAgb246ZGJsY2xpY2s9eygpID0+IHJlbW92ZShjYXJkKX1cclxuICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImNhcmRcIlxyXG4gICAgICAgICAgICAgICAgICAgIHN0eWxlPXsnbWFyZ2luLXRvcDogJyArIGkgKiA0MCArICdweCd9XHJcbiAgICAgICAgICAgICAgICAgICAgc3JjPXtjYXJkLnVybH1cclxuICAgICAgICAgICAgICAgICAgICBhbHQ9e2NhcmQubmFtZX1cclxuICAgICAgICAgICAgICAgICAgICB7d2lkdGh9XHJcbiAgICAgICAgICAgICAgICAgICAge2hlaWdodH0gLz5cclxuICAgICAgICAgICAgICAgIHsvZWFjaH1cclxuXHJcbiAgICAgICAgICAgICAgICB7I2lmIGNhcmQuZGF0YS5sZWdhbGl0aWVzW2Zvcm1hdC52YWx1ZV0gIT09ICdsZWdhbCd9XHJcbiAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJiYW5uZWQtdGV4dFwiPkJBTk5FRDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgICAgIHsjaWYgY2FyZC5jb3VudCA+IDR9XHJcbiAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJjb3VudFwiPntjYXJkLmNvdW50fXg8L2Rpdj5cclxuICAgICAgICAgICAgICAgIHsvaWZ9XHJcblxyXG4gICAgICAgICAgICAgICAgeyNpZiBzY2FsaW5nID4gOTB9XHJcbiAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJwcmljZVwiPntjYXJkLmRhdGEucHJpY2VzLnVzZCArICckJyB8fCAnPz8/J308L2Rpdj5cclxuICAgICAgICAgICAgICAgIHsvaWZ9XHJcblxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICB7L2VhY2h9XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgey9lYWNofVxyXG5cclxuICAgIHs6Y2F0Y2ggZXJyb3J9XHJcblxyXG4gICAgICA8ZGl2IGNsYXNzPVwiZXJyb3JcIj5cclxuICAgICAgICBFUlJPUiwgY2hlY2sgeW91ciBkZWNrbGlzdCBmb3IgY29ycmVjdCBmb3JtYXQgb3IgaW50ZXJuZXQgY29ubmVjdGlvblxyXG4gICAgICAgIGJydWRpXHJcbiAgICAgIDwvZGl2PlxyXG4gICAgey9hd2FpdH1cclxuICA8L2Rpdj5cclxuXHJcbiAgPGRpdiBjbGFzcz1cImNhcmQtc2VhcmNoXCIgY2xhc3M6aGlkZT17IWNhcmRTZWFyY2hBY3RpdmV9PlxyXG4gICAgPGRpdiBjbGFzcz1cInRvZ2dsZS1zZWFyY2hcIiBvbjpjbGljaz17dG9nZ2xlU2VhcmNofT54PC9kaXY+XHJcbiAgICA8ZGl2IGNsYXNzPVwic2VhcmNoLXBhcmFtc1wiPlxyXG4gICAgICA8ZGl2IGNsYXNzPVwic2VhcmNoLXBhcmFtXCI+XHJcbiAgICAgICAgTmFtZTpcclxuICAgICAgICA8aW5wdXQgYmluZDp0aGlzPXtzcE5hbWV9IC8+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgICA8ZGl2IGNsYXNzPVwic2VhcmNoLXBhcmFtXCI+XHJcbiAgICAgICAgVGV4dDpcclxuICAgICAgICA8aW5wdXQgYmluZDp0aGlzPXtzcFRleHR9IC8+XHJcbiAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1wYXJhbSBjb2xvci1wYXJhbVwiPlxyXG4gICAgICAgIENvbW1hbmRlci1Db2xvcnM6XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImJsdWVcIj5cclxuICAgICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgICB0eXBlPVwiY2hlY2tib3hcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17Y2xlYXJDb2xvcmxlc3N9XHJcbiAgICAgICAgICAgIGNsYXNzPVwiYmx1ZVwiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhCbHVlfSAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJibGFja1wiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJibGFja1wiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhCbGFja30gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwicmVkXCI+XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgdHlwZT1cImNoZWNrYm94XCJcclxuICAgICAgICAgICAgb246Y2xpY2s9e2NsZWFyQ29sb3JsZXNzfVxyXG4gICAgICAgICAgICBjbGFzcz1cInJlZFwiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhSZWR9IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cIndoaXRlXCI+XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgdHlwZT1cImNoZWNrYm94XCJcclxuICAgICAgICAgICAgb246Y2xpY2s9e2NsZWFyQ29sb3JsZXNzfVxyXG4gICAgICAgICAgICBjbGFzcz1cIndoaXRlXCJcclxuICAgICAgICAgICAgYmluZDp0aGlzPXtzcEVESFdoaXRlfSAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJncmVlblwiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJncmVlblwiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhHcmVlbn0gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiY29sb3JsZXNzXCI+XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgdHlwZT1cImNoZWNrYm94XCJcclxuICAgICAgICAgICAgb246Y2xpY2s9e2NsZWFyRm9yQ29sb3JsZXNzfVxyXG4gICAgICAgICAgICBjbGFzcz1cImNvbG9ybGVzc1wiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhDb2xvcmxlc3N9IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgICA8YnV0dG9uIG9uOmNsaWNrPXtzZWFyY2hDYXJkc30+c2VhcmNoPC9idXR0b24+XHJcbiAgICA8L2Rpdj5cclxuXHJcbiAgICB7I2F3YWl0IGNhcmRTZWFyY2hQcm9taXNlfVxyXG4gICAgICA8ZGl2IGNsYXNzPVwibG9hZGluZy13cmFwcGVyXCI+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImxkcy1yaXBwbGVcIj5cclxuICAgICAgICAgIDxkaXYgLz5cclxuICAgICAgICAgIDxkaXYgLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgPC9kaXY+XHJcbiAgICB7OnRoZW4gcmVzdWx0fVxyXG5cclxuICAgICAgeyNpZiByZXN1bHQuY29kZSAhPT0gJ25vdF9mb3VuZCcgJiYgcmVzdWx0LmRhdGF9XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1yZXN1bHRcIj5cclxuICAgICAgICAgIHsjZWFjaCByZXN1bHQuZGF0YSBhcyBjYXJkfVxyXG4gICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgY2xhc3M9XCJlbnRyeVwiXHJcbiAgICAgICAgICAgICAgc3R5bGU9eyd3aWR0aDonICsgd2lkdGggKyAncHg7IGhlaWdodDonICsgaGVpZ2h0ICsgJ3B4Oyd9PlxyXG4gICAgICAgICAgICAgIDxpbWdcclxuICAgICAgICAgICAgICAgIG9uOmRibGNsaWNrPXsoKSA9PiBhcHBlbmRDYXJkKGNhcmQubmFtZSl9XHJcbiAgICAgICAgICAgICAgICBjbGFzczpiYW5uZWQ9e2NhcmQubGVnYWxpdGllc1tmb3JtYXQudmFsdWVdICE9PSAnbGVnYWwnfVxyXG4gICAgICAgICAgICAgICAgY2xhc3M9XCJjYXJkXCJcclxuICAgICAgICAgICAgICAgIHNyYz17Y2FyZC51cmx9XHJcbiAgICAgICAgICAgICAgICBhbHQ9e2NhcmQubmFtZX1cclxuICAgICAgICAgICAgICAgIHt3aWR0aH1cclxuICAgICAgICAgICAgICAgIHtoZWlnaHR9IC8+XHJcblxyXG4gICAgICAgICAgICAgIHsjaWYgY2FyZC5sZWdhbGl0aWVzW2Zvcm1hdC52YWx1ZV0gIT09ICdsZWdhbCd9XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiYmFubmVkLXRleHRcIj5CQU5ORUQ8L2Rpdj5cclxuICAgICAgICAgICAgICB7L2lmfVxyXG4gICAgICAgICAgICAgIHsjaWYgc2NhbGluZyA+IDkwfVxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cInByaWNlXCI+e2NhcmQucHJpY2VzLnVzZCArICckJyB8fCAnPz8/J308L2Rpdj5cclxuICAgICAgICAgICAgICB7L2lmfVxyXG4gICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIHs6ZWxzZX1cclxuICAgICAgICAgICAgPGRpdj5ObyBjYXJkcyBmb3VuZDwvZGl2PlxyXG4gICAgICAgICAgey9lYWNofVxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxidXR0b25cclxuICAgICAgICAgIGRpc2FibGVkPXshcmVzdWx0Lmhhc19tb3JlfVxyXG4gICAgICAgICAgb246Y2xpY2s9eygpID0+IHNlYXJjaENhcmRzKHJlc3VsdC5uZXh0X3BhZ2UpfT5cclxuICAgICAgICAgIG5leHRcclxuICAgICAgICA8L2J1dHRvbj5cclxuICAgICAgezplbHNlfVxyXG4gICAgICAgIDxkaXY+Tm8gY2FyZHMgZm91bmQ8L2Rpdj5cclxuICAgICAgey9pZn1cclxuICAgIHs6Y2F0Y2ggZXJyb3J9XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJlcnJvclwiPlxyXG4gICAgICAgIEVSUk9SLCBjaGVjayB5b3VyIGRlY2tsaXN0IGZvciBjb3JyZWN0IGZvcm1hdCBvciBpbnRlcm5ldCBjb25uZWN0aW9uXHJcbiAgICAgICAgYnJ1ZGlcclxuICAgICAgPC9kaXY+XHJcbiAgICB7L2F3YWl0fVxyXG5cclxuICA8L2Rpdj5cclxuPC9kaXY+XHJcbiIsImltcG9ydCBNYWluVmlldyBmcm9tIFwiLi9lZGl0b3Iuc3ZlbHRlXCI7XHJcblxyXG5cclxuY29uc3QgcmVuZGVyVGFyZ2V0ID0gbmV3IE1haW5WaWV3KHtcclxuICB0YXJnZXQ6IGRvY3VtZW50LmJvZHksXHJcbiAgcHJvcHM6IHtcclxuICAgIHRlc3Q6IFwic2RmZHNmXCJcclxuICB9XHJcbn0pOyJdLCJuYW1lcyI6WyJDYXJkTG9hZGVyIiwiQ29va2llcyIsIk1haW5WaWV3Il0sIm1hcHBpbmdzIjoiOzs7SUFBQSxTQUFTLElBQUksR0FBRyxHQUFHO0FBQ25CLElBT0EsU0FBUyxVQUFVLENBQUMsS0FBSyxFQUFFO0lBQzNCLElBQUksT0FBTyxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLE9BQU8sS0FBSyxDQUFDLElBQUksS0FBSyxVQUFVLENBQUM7SUFDbEYsQ0FBQztBQUNELElBS0EsU0FBUyxHQUFHLENBQUMsRUFBRSxFQUFFO0lBQ2pCLElBQUksT0FBTyxFQUFFLEVBQUUsQ0FBQztJQUNoQixDQUFDO0lBQ0QsU0FBUyxZQUFZLEdBQUc7SUFDeEIsSUFBSSxPQUFPLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDL0IsQ0FBQztJQUNELFNBQVMsT0FBTyxDQUFDLEdBQUcsRUFBRTtJQUN0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LEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQzFGLElBQUksTUFBTSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNwRixJQUFJLEtBQUssR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDLENBQUMsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQzFFLElBQUksSUFBSSxNQUFNLEdBQUcsYUFBYSxDQUFDO0lBQy9CLElBQUksS0FBSyxJQUFJLEdBQUcsSUFBSSxTQUFTLEVBQUU7SUFDL0IsTUFBTSxNQUFNLElBQUksSUFBSSxHQUFHLEdBQUcsQ0FBQyxLQUFLLEdBQUcsR0FBRyxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUM7SUFDbEQsS0FBSztJQUNMLElBQUksTUFBTSxJQUFJLGNBQWMsQ0FBQztJQUM3QixJQUFJLEtBQUssSUFBSSxHQUFHLElBQUksTUFBTSxFQUFFO0lBQzVCLE1BQU0sTUFBTSxJQUFJLElBQUksR0FBRyxHQUFHLENBQUMsS0FBSyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDO0lBQ2xELEtBQUs7O0lBRUwsSUFBSSxNQUFNLElBQUksY0FBYTtJQUMzQixJQUFJLEtBQUssSUFBSSxHQUFHLElBQUksS0FBSyxFQUFFO0lBQzNCLE1BQU0sTUFBTSxJQUFJLElBQUksR0FBRyxHQUFHLENBQUMsS0FBSyxHQUFHLEdB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LENBQUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDO0lBQ25GLFFBQVEsUUFBUSxDQUFDLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUM7SUFDakYsUUFBUSxRQUFRLENBQUMsS0FBSyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQztJQUNuRixRQUFRLFFBQVEsQ0FBQyxLQUFLLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDO0lBQ25GLFFBQVEsUUFBUSxDQUFDLFNBQVMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUM7SUFDdkYsUUFBUSxRQUFRLENBQUMsT0FBTyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDO0lBQ3RHLFFBQVEsUUFBUSxDQUFDLEdBQUcsR0FBRyxRQUFRLENBQUMsSUFBSSxHQUFHLFFBQVEsQ0FBQyxLQUFLLEdBQUcsUUFBUSxDQUFDLEdBQUcsR0FBRyxRQUFRLENBQUMsS0FBSyxHQUFHLFFBQVEsQ0FBQyxLQUFLLEdBQUcsUUFBUSxDQUFDLFNBQVMsR0FBRyxRQUFRLENBQUMsT0FBTyxDQUFDO0lBQy9JLE9BQU87Ozs7SUFJUCxNQUFN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
