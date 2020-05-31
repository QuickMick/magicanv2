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
            queries.push("oracle%3A" + opts.text);
          }

          baseurl = baseurl + queries.join("+");
        } else {
          baseurl = opts;
        }
        return fetch(baseurl)
          .then(response => response.json())
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
          .catch(e => { console.log(e); return { code: "not_found" }; });

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
        //mana_cost.split("G").length - 1
        for (let group of groups) {

          group.cards = Object.values(group.deck);
          group.cards = group.cards.sort((a, b) => a.data.cmc > b.data.cmc ? 1 : -1);

          let count = 0;
          let cost = 0;
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

            if (!card.data.type_line.toLowerCase().includes("land")) {
              manaCurve[card.data.cmc || 0] = (manaCurve[card.data.cmc || 0] || 0) + card.count;
            } else {
              landCount += card.count;
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

          const isMaybe = group.name.toLowerCase() == "maybe";

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

    function add_css() {
    	var style = element("style");
    	style.id = "svelte-viewjj-style";
    	style.textContent = ".content.svelte-viewjj.svelte-viewjj{--raisin-black:hsla(200, 8%, 15%, 1);--roman-silver:hsla(196, 15%, 60%, 1);--colorless:hsla(0, 0%, 89%, 1);--black:hsla(83, 8%, 38%, 1);--white:hsl(48, 64%, 89%);--red:hsla(0, 71%, 84%, 1);--green:hsla(114, 60%, 75%, 1);--blue:hsla(235, 55%, 81%, 1)}.content.svelte-viewjj.svelte-viewjj{display:flex;flex-direction:row;width:100%;height:100%}.help-symbol.svelte-viewjj.svelte-viewjj{border-radius:50%;border:1px solid black;width:16px;height:16px;text-align:center;position:absolute;right:10px;top:10px;cursor:pointer}.help-symbol.svelte-viewjj.svelte-viewjj:hover{border-color:blue;color:blue}.toggle-search.svelte-viewjj.svelte-viewjj{background:blue;width:30px;height:30px;cursor:pointer;position:absolute;left:-30px;top:50%;user-select:none}.hide.svelte-viewjj .toggle-search.svelte-viewjj{left:-52px}.statistics.svelte-viewjj.svelte-viewjj{display:flex;flex-direction:column}.input.svelte-viewjj.svelte-viewjj{width:100%;height:100%;box-sizing:border-box;padding:10px;resize:none}.controls.svelte-viewjj.svelte-viewjj{flex-shrink:0;width:300px;height:100%;background:lightgray;display:flex;flex-direction:column}.help.svelte-viewjj.svelte-viewjj{padding:0px 10px 10px 10px;user-select:none;position:relative}.group-content.svelte-viewjj.svelte-viewjj{flex-grow:1;display:flex;flex-wrap:wrap;transition:height 500ms ease}.group-content.hidden.svelte-viewjj.svelte-viewjj{overflow:hidden;height:45px}.card-search.svelte-viewjj.svelte-viewjj{height:100%;flex-grow:1;background:white;display:flex;flex-direction:column;position:absolute;right:0;width:33%;z-index:100;box-shadow:0px 0px 10px black}.card-search.hide.svelte-viewjj.svelte-viewjj{right:-33%}.search-params.svelte-viewjj.svelte-viewjj{flex-shrink:0;display:flex;flex-direction:column}.search-result.svelte-viewjj.svelte-viewjj{height:100%;flex-grow:1;background:white;display:flex;flex-direction:row;overflow:auto;position:relative;user-select:none;flex-wrap:wrap}.display.svelte-viewjj.svelte-viewjj{flex-grow:1;background:gray;display:flex;flex-direction:column;flex-wrap:nowrap;overflow:auto;position:relative;user-select:none}.loading-wrapper.svelte-viewjj.svelte-viewjj{position:absolute;left:50%;top:0;bottom:0;display:flex;align-items:center}.entry.svelte-viewjj.svelte-viewjj{position:relative;padding:10px;flex-shrink:0}.card.svelte-viewjj.svelte-viewjj{position:absolute;border:6px solid rgb(22, 22, 22);border-radius:10px;outline:0;box-shadow:0px 0px 10px black}.card.banned.svelte-viewjj.svelte-viewjj{border:6px solid red}.card.highlighted.svelte-viewjj.svelte-viewjj{border:6px solid yellow}.card.svelte-viewjj.svelte-viewjj:hover{border:6px solid blue;cursor:pointer}.price.svelte-viewjj.svelte-viewjj,.banned-text.svelte-viewjj.svelte-viewjj,.count.svelte-viewjj.svelte-viewjj{font-size:34px;text-shadow:0px 0px 9px black;color:red;position:absolute;z-index:100;font-weight:bold;left:34px}.banned-text.svelte-viewjj.svelte-viewjj{font-size:100%;text-shadow:0px 0px 9px black;color:red;position:absolute;z-index:100;font-weight:bold;left:17%}.count.svelte-viewjj.svelte-viewjj{top:165px}.price.svelte-viewjj.svelte-viewjj{bottom:7px;color:wheat;font-size:12px;background:black;left:45%;font-weight:normal}.group-header.svelte-viewjj.svelte-viewjj{display:flex;background:darkgrey;margin:8px 0;box-shadow:0px 0px 8px black;width:100%;flex-direction:row}.group-header.svelte-viewjj h2.svelte-viewjj{padding:0 25px;margin:0px}.group-statistics.svelte-viewjj.svelte-viewjj{display:flex;flex-direction:row}.mana-proposal.svelte-viewjj.svelte-viewjj,.mana-devotion.svelte-viewjj.svelte-viewjj{display:flex;flex-direction:row}.deck-value.svelte-viewjj.svelte-viewjj,.group-value.svelte-viewjj.svelte-viewjj{padding:5px;color:black;border-radius:50%;width:15px;height:15px;text-align:center;margin:5px;display:flex;text-align:center;align-items:center;font-size:11px;font-weight:bold}.blue.svelte-viewjj.svelte-viewjj{background-color:var(--blue)}.black.svelte-viewjj.svelte-viewjj{color:white;background-color:var(--black)}.red.svelte-viewjj.svelte-viewjj{background-color:var(--red)}.white.svelte-viewjj.svelte-viewjj{background-color:var(--white)}.green.svelte-viewjj.svelte-viewjj{background-color:var(--green)}.colorless.svelte-viewjj.svelte-viewjj{background-color:var(--colorless)}.sum.svelte-viewjj.svelte-viewjj{background-color:goldenrod}.color-param.svelte-viewjj.svelte-viewjj{display:flex;flex-direction:row}.mana-curve.svelte-viewjj.svelte-viewjj{display:flex;flex-direction:column}.all-curves.svelte-viewjj.svelte-viewjj{display:flex;flex-grow:1;flex-direction:row;height:80px}.all-labels.svelte-viewjj.svelte-viewjj{display:flex;flex-shrink:0;flex-direction:row}.curve-element.svelte-viewjj.svelte-viewjj{width:20px;display:flex;position:absolute;bottom:0;background:gray;align-items:center;height:100%}.curve-label.svelte-viewjj.svelte-viewjj{width:20px}.curve-wrapper.svelte-viewjj.svelte-viewjj{width:20px;position:relative;cursor:pointer}.curve-element.svelte-viewjj.svelte-viewjj:hover{background:lightcoral}.highlighted.svelte-viewjj .curve-element.svelte-viewjj{background:lightblue}.curve-label.highlighted.svelte-viewjj.svelte-viewjj{background:lightblue}.curve-label.svelte-viewjj.svelte-viewjj:hover{background:lightcoral}h4.svelte-viewjj.svelte-viewjj{margin-top:5px;margin-bottom:5px}.lds-ripple.svelte-viewjj.svelte-viewjj{display:inline-block;position:relative;width:80px;height:80px}.lds-ripple.svelte-viewjj div.svelte-viewjj{position:absolute;border:4px solid #fff;opacity:1;border-radius:50%;animation:svelte-viewjj-lds-ripple 1s cubic-bezier(0, 0.2, 0.8, 1) infinite}.lds-ripple.svelte-viewjj div.svelte-viewjj:nth-child(2){animation-delay:-0.5s}@keyframes svelte-viewjj-lds-ripple{0%{top:36px;left:36px;width:0;height:0;opacity:1}100%{top:0px;left:0px;width:72px;height:72px;opacity:0}}";
    	append(document.head, style);
    }

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[56] = list[i];
    	return child_ctx;
    }

    function get_each_context_3(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[66] = list[i];
    	child_ctx[68] = i;
    	return child_ctx;
    }

    function get_each_context_2(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[56] = list[i];
    	return child_ctx;
    }

    function get_each_context_1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[61] = list[i];
    	return child_ctx;
    }

    function get_each_context_4(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[69] = list[i];
    	child_ctx[68] = i;
    	return child_ctx;
    }

    function get_each_context_5(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[69] = list[i];
    	child_ctx[68] = i;
    	return child_ctx;
    }

    // (572:6) {#if helpActive}
    function create_if_block_9(ctx) {
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
    			attr(h4, "class", "svelte-viewjj");
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

    // (680:6) {:catch error}
    function create_catch_block_2(ctx) {
    	let t_value = /*error*/ ctx[59] + "";
    	let t;

    	return {
    		c() {
    			t = text(t_value);
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*promise*/ 64 && t_value !== (t_value = /*error*/ ctx[59] + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (592:6) {:then groups}
    function create_then_block_2(ctx) {
    	let if_block_anchor;
    	let if_block = !/*helpActive*/ ctx[21] && create_if_block_5(ctx);

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
    					if_block = create_if_block_5(ctx);
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

    // (594:8) {#if !helpActive}
    function create_if_block_5(ctx) {
    	let h4;
    	let t1;
    	let div0;
    	let t2;
    	let t3_value = /*groups*/ ctx[60]["cardCount"] + "";
    	let t3;
    	let t4;
    	let div1;
    	let t5;
    	let t6_value = /*groups*/ ctx[60]["landCount"] + "";
    	let t6;
    	let t7;
    	let t8_value = /*groups*/ ctx[60]["cardCount"] - /*groups*/ ctx[60]["landCount"] + "";
    	let t8;
    	let t9;
    	let div2;
    	let t10;
    	let t11_value = /*groups*/ ctx[60].cost.toFixed(2) + "$" + "";
    	let t11;
    	let t12;
    	let if_block_anchor;
    	let if_block = /*statisticsActive*/ ctx[3] && create_if_block_6(ctx);

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
    			t10 = text("Cost: ");
    			t11 = text(t11_value);
    			t12 = space();
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    			attr(h4, "class", "svelte-viewjj");
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
    			if (if_block) if_block.m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*promise*/ 64 && t3_value !== (t3_value = /*groups*/ ctx[60]["cardCount"] + "")) set_data(t3, t3_value);
    			if (dirty[0] & /*promise*/ 64 && t6_value !== (t6_value = /*groups*/ ctx[60]["landCount"] + "")) set_data(t6, t6_value);
    			if (dirty[0] & /*promise*/ 64 && t8_value !== (t8_value = /*groups*/ ctx[60]["cardCount"] - /*groups*/ ctx[60]["landCount"] + "")) set_data(t8, t8_value);
    			if (dirty[0] & /*promise*/ 64 && t11_value !== (t11_value = /*groups*/ ctx[60].cost.toFixed(2) + "$" + "")) set_data(t11, t11_value);

    			if (/*statisticsActive*/ ctx[3]) {
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
    			if (detaching) detach(h4);
    			if (detaching) detach(t1);
    			if (detaching) detach(div0);
    			if (detaching) detach(t4);
    			if (detaching) detach(div1);
    			if (detaching) detach(t9);
    			if (detaching) detach(div2);
    			if (detaching) detach(t12);
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    // (603:10) {#if statisticsActive}
    function create_if_block_6(ctx) {
    	let div20;
    	let h40;
    	let t1;
    	let div6;
    	let div0;
    	let t2_value = /*groups*/ ctx[60]["mana"].blue + "";
    	let t2;
    	let t3;
    	let div1;
    	let t4_value = /*groups*/ ctx[60]["mana"].black + "";
    	let t4;
    	let t5;
    	let div2;
    	let t6_value = /*groups*/ ctx[60]["mana"].red + "";
    	let t6;
    	let t7;
    	let div3;
    	let t8_value = /*groups*/ ctx[60]["mana"].white + "";
    	let t8;
    	let t9;
    	let div4;
    	let t10_value = /*groups*/ ctx[60]["mana"].green + "";
    	let t10;
    	let t11;
    	let div5;
    	let t12_value = /*groups*/ ctx[60]["mana"].colorless + "";
    	let t12;
    	let t13;
    	let h41;
    	let t15;
    	let div7;
    	let t16;
    	let t17_value = /*groups*/ ctx[60]["mana"].generic + "";
    	let t17;
    	let t18;
    	let div8;
    	let t19;
    	let t20_value = /*groups*/ ctx[60]["mana"].sum + "";
    	let t20;
    	let t21;
    	let div9;
    	let t22;
    	let t23_value = /*groups*/ ctx[60]["averageMana"].toFixed(2) + "";
    	let t23;
    	let t24;
    	let h42;
    	let t26;
    	let div16;
    	let div10;
    	let t27_value = (/*groups*/ ctx[60]["manaProposal"].blue * /*groups*/ ctx[60]["landCount"]).toFixed(1) + "";
    	let t27;
    	let t28;
    	let div11;
    	let t29_value = (/*groups*/ ctx[60]["manaProposal"].black * /*groups*/ ctx[60]["landCount"]).toFixed(1) + "";
    	let t29;
    	let t30;
    	let div12;
    	let t31_value = (/*groups*/ ctx[60]["manaProposal"].red * /*groups*/ ctx[60]["landCount"]).toFixed(1) + "";
    	let t31;
    	let t32;
    	let div13;
    	let t33_value = (/*groups*/ ctx[60]["manaProposal"].white * /*groups*/ ctx[60]["landCount"]).toFixed(1) + "";
    	let t33;
    	let t34;
    	let div14;
    	let t35_value = (/*groups*/ ctx[60]["manaProposal"].green * /*groups*/ ctx[60]["landCount"]).toFixed(1) + "";
    	let t35;
    	let t36;
    	let div15;
    	let t37_value = (/*groups*/ ctx[60]["manaProposal"].colorless * /*groups*/ ctx[60]["landCount"]).toFixed(1) + "";
    	let t37;
    	let t38;
    	let h43;
    	let t40;
    	let div19;
    	let div17;
    	let t41;
    	let div18;
    	let each_value_5 = /*groups*/ ctx[60]["manaCurve"];
    	let each_blocks_1 = [];

    	for (let i = 0; i < each_value_5.length; i += 1) {
    		each_blocks_1[i] = create_each_block_5(get_each_context_5(ctx, each_value_5, i));
    	}

    	let each_value_4 = /*groups*/ ctx[60]["manaCurve"];
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

    			attr(h40, "class", "svelte-viewjj");
    			attr(div0, "class", "deck-value blue svelte-viewjj");
    			attr(div1, "class", "deck-value black svelte-viewjj");
    			attr(div2, "class", "deck-value red svelte-viewjj");
    			attr(div3, "class", "deck-value white svelte-viewjj");
    			attr(div4, "class", "deck-value green svelte-viewjj");
    			attr(div5, "class", "deck-value colorless svelte-viewjj");
    			attr(div6, "class", "mana-devotion svelte-viewjj");
    			attr(h41, "class", "svelte-viewjj");
    			attr(h42, "class", "svelte-viewjj");
    			attr(div10, "class", "deck-value blue svelte-viewjj");
    			attr(div11, "class", "deck-value black svelte-viewjj");
    			attr(div12, "class", "deck-value red svelte-viewjj");
    			attr(div13, "class", "deck-value white svelte-viewjj");
    			attr(div14, "class", "deck-value green svelte-viewjj");
    			attr(div15, "class", "deck-value colorless svelte-viewjj");
    			attr(div16, "class", "mana-proposal svelte-viewjj");
    			attr(h43, "class", "svelte-viewjj");
    			attr(div17, "class", "all-curves svelte-viewjj");
    			attr(div18, "class", "all-labels svelte-viewjj");
    			attr(div19, "class", "mana-curve svelte-viewjj");
    			attr(div20, "class", "statistics svelte-viewjj");
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
    			if (dirty[0] & /*promise*/ 64 && t2_value !== (t2_value = /*groups*/ ctx[60]["mana"].blue + "")) set_data(t2, t2_value);
    			if (dirty[0] & /*promise*/ 64 && t4_value !== (t4_value = /*groups*/ ctx[60]["mana"].black + "")) set_data(t4, t4_value);
    			if (dirty[0] & /*promise*/ 64 && t6_value !== (t6_value = /*groups*/ ctx[60]["mana"].red + "")) set_data(t6, t6_value);
    			if (dirty[0] & /*promise*/ 64 && t8_value !== (t8_value = /*groups*/ ctx[60]["mana"].white + "")) set_data(t8, t8_value);
    			if (dirty[0] & /*promise*/ 64 && t10_value !== (t10_value = /*groups*/ ctx[60]["mana"].green + "")) set_data(t10, t10_value);
    			if (dirty[0] & /*promise*/ 64 && t12_value !== (t12_value = /*groups*/ ctx[60]["mana"].colorless + "")) set_data(t12, t12_value);
    			if (dirty[0] & /*promise*/ 64 && t17_value !== (t17_value = /*groups*/ ctx[60]["mana"].generic + "")) set_data(t17, t17_value);
    			if (dirty[0] & /*promise*/ 64 && t20_value !== (t20_value = /*groups*/ ctx[60]["mana"].sum + "")) set_data(t20, t20_value);
    			if (dirty[0] & /*promise*/ 64 && t23_value !== (t23_value = /*groups*/ ctx[60]["averageMana"].toFixed(2) + "")) set_data(t23, t23_value);
    			if (dirty[0] & /*promise*/ 64 && t27_value !== (t27_value = (/*groups*/ ctx[60]["manaProposal"].blue * /*groups*/ ctx[60]["landCount"]).toFixed(1) + "")) set_data(t27, t27_value);
    			if (dirty[0] & /*promise*/ 64 && t29_value !== (t29_value = (/*groups*/ ctx[60]["manaProposal"].black * /*groups*/ ctx[60]["landCount"]).toFixed(1) + "")) set_data(t29, t29_value);
    			if (dirty[0] & /*promise*/ 64 && t31_value !== (t31_value = (/*groups*/ ctx[60]["manaProposal"].red * /*groups*/ ctx[60]["landCount"]).toFixed(1) + "")) set_data(t31, t31_value);
    			if (dirty[0] & /*promise*/ 64 && t33_value !== (t33_value = (/*groups*/ ctx[60]["manaProposal"].white * /*groups*/ ctx[60]["landCount"]).toFixed(1) + "")) set_data(t33, t33_value);
    			if (dirty[0] & /*promise*/ 64 && t35_value !== (t35_value = (/*groups*/ ctx[60]["manaProposal"].green * /*groups*/ ctx[60]["landCount"]).toFixed(1) + "")) set_data(t35, t35_value);
    			if (dirty[0] & /*promise*/ 64 && t37_value !== (t37_value = (/*groups*/ ctx[60]["manaProposal"].colorless * /*groups*/ ctx[60]["landCount"]).toFixed(1) + "")) set_data(t37, t37_value);

    			if (dirty[0] & /*devotionHighlight, highlightDevotion, promise*/ 4194400) {
    				each_value_5 = /*groups*/ ctx[60]["manaCurve"];
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
    				each_value_4 = /*groups*/ ctx[60]["manaCurve"];
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

    // (648:20) {#if mana > 0}
    function create_if_block_8(ctx) {
    	let div1;
    	let div0;
    	let t0_value = (/*mana*/ ctx[69] || "") + "";
    	let t0;
    	let div0_style_value;
    	let t1;
    	let mounted;
    	let dispose;

    	function click_handler(...args) {
    		return /*click_handler*/ ctx[38](/*i*/ ctx[68], ...args);
    	}

    	return {
    		c() {
    			div1 = element("div");
    			div0 = element("div");
    			t0 = text(t0_value);
    			t1 = space();
    			attr(div0, "class", "curve-element svelte-viewjj");
    			attr(div0, "style", div0_style_value = "height:" + getHeight(/*mana*/ ctx[69], /*groups*/ ctx[60]) + "%;");
    			attr(div1, "class", "curve-wrapper svelte-viewjj");
    			toggle_class(div1, "highlighted", /*devotionHighlight*/ ctx[5] == /*i*/ ctx[68]);
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
    			if (dirty[0] & /*promise*/ 64 && t0_value !== (t0_value = (/*mana*/ ctx[69] || "") + "")) set_data(t0, t0_value);

    			if (dirty[0] & /*promise*/ 64 && div0_style_value !== (div0_style_value = "height:" + getHeight(/*mana*/ ctx[69], /*groups*/ ctx[60]) + "%;")) {
    				attr(div0, "style", div0_style_value);
    			}

    			if (dirty[0] & /*devotionHighlight*/ 32) {
    				toggle_class(div1, "highlighted", /*devotionHighlight*/ ctx[5] == /*i*/ ctx[68]);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div1);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (647:18) {#each groups['manaCurve'] as mana, i}
    function create_each_block_5(ctx) {
    	let if_block_anchor;
    	let if_block = /*mana*/ ctx[69] > 0 && create_if_block_8(ctx);

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
    			if (/*mana*/ ctx[69] > 0) {
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

    // (665:20) {#if mana > 0}
    function create_if_block_7(ctx) {
    	let div;
    	let t0;
    	let t1;
    	let mounted;
    	let dispose;

    	function click_handler_1(...args) {
    		return /*click_handler_1*/ ctx[39](/*mana*/ ctx[69], ...args);
    	}

    	return {
    		c() {
    			div = element("div");
    			t0 = text(/*i*/ ctx[68]);
    			t1 = space();
    			attr(div, "class", "curve-label svelte-viewjj");
    			toggle_class(div, "highlighted", /*devotionHighlight*/ ctx[5] == /*i*/ ctx[68]);
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
    				toggle_class(div, "highlighted", /*devotionHighlight*/ ctx[5] == /*i*/ ctx[68]);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (664:18) {#each groups['manaCurve'] as mana, i}
    function create_each_block_4(ctx) {
    	let if_block_anchor;
    	let if_block = /*mana*/ ctx[69] > 0 && create_if_block_7(ctx);

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
    			if (/*mana*/ ctx[69] > 0) {
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
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    // (589:22)             <div>loading: {progress}
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

    // (786:4) {:catch error}
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

    // (720:4) {:then groups}
    function create_then_block_1(ctx) {
    	let each_1_anchor;
    	let each_value_1 = /*groups*/ ctx[60] || [];
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
    				each_value_1 = /*groups*/ ctx[60] || [];
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

    // (756:16) {#each { length: card.count > 4 ? 4 : card.count } as _, i}
    function create_each_block_3(ctx) {
    	let img;
    	let img_style_value;
    	let img_src_value;
    	let img_alt_value;
    	let mounted;
    	let dispose;

    	function dblclick_handler(...args) {
    		return /*dblclick_handler*/ ctx[44](/*card*/ ctx[56], ...args);
    	}

    	return {
    		c() {
    			img = element("img");
    			attr(img, "class", "card svelte-viewjj");
    			attr(img, "style", img_style_value = "margin-top: " + /*i*/ ctx[68] * 40 + "px");
    			if (img.src !== (img_src_value = /*card*/ ctx[56].url)) attr(img, "src", img_src_value);
    			attr(img, "alt", img_alt_value = /*card*/ ctx[56].name);
    			attr(img, "width", /*width*/ ctx[1]);
    			attr(img, "height", /*height*/ ctx[0]);
    			toggle_class(img, "banned", /*card*/ ctx[56].data.legalities[/*format*/ ctx[9].value] !== "legal");
    			toggle_class(img, "highlighted", /*devotionHighlight*/ ctx[5] == /*card*/ ctx[56].data.cmc);
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

    			if (dirty[0] & /*promise*/ 64 && img.src !== (img_src_value = /*card*/ ctx[56].url)) {
    				attr(img, "src", img_src_value);
    			}

    			if (dirty[0] & /*promise*/ 64 && img_alt_value !== (img_alt_value = /*card*/ ctx[56].name)) {
    				attr(img, "alt", img_alt_value);
    			}

    			if (dirty[0] & /*width*/ 2) {
    				attr(img, "width", /*width*/ ctx[1]);
    			}

    			if (dirty[0] & /*height*/ 1) {
    				attr(img, "height", /*height*/ ctx[0]);
    			}

    			if (dirty[0] & /*promise, format*/ 576) {
    				toggle_class(img, "banned", /*card*/ ctx[56].data.legalities[/*format*/ ctx[9].value] !== "legal");
    			}

    			if (dirty[0] & /*devotionHighlight, promise*/ 96) {
    				toggle_class(img, "highlighted", /*devotionHighlight*/ ctx[5] == /*card*/ ctx[56].data.cmc);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(img);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (769:16) {#if card.data.legalities[format.value] !== 'legal'}
    function create_if_block_4(ctx) {
    	let div;

    	return {
    		c() {
    			div = element("div");
    			div.textContent = "BANNED";
    			attr(div, "class", "banned-text svelte-viewjj");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (772:16) {#if card.count > 4}
    function create_if_block_3(ctx) {
    	let div;
    	let t0_value = /*card*/ ctx[56].count + "";
    	let t0;
    	let t1;

    	return {
    		c() {
    			div = element("div");
    			t0 = text(t0_value);
    			t1 = text("x");
    			attr(div, "class", "count svelte-viewjj");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, t0);
    			append(div, t1);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*promise*/ 64 && t0_value !== (t0_value = /*card*/ ctx[56].count + "")) set_data(t0, t0_value);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (776:16) {#if scaling > 90}
    function create_if_block_2(ctx) {
    	let div;
    	let t_value = (/*card*/ ctx[56].data.prices.usd + "$" || "???") + "";
    	let t;

    	return {
    		c() {
    			div = element("div");
    			t = text(t_value);
    			attr(div, "class", "price svelte-viewjj");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, t);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*promise*/ 64 && t_value !== (t_value = (/*card*/ ctx[56].data.prices.usd + "$" || "???") + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (751:12) {#each group.cards as card}
    function create_each_block_2(ctx) {
    	let div;
    	let t0;
    	let t1;
    	let t2;
    	let t3;
    	let div_style_value;

    	let each_value_3 = {
    		length: /*card*/ ctx[56].count > 4 ? 4 : /*card*/ ctx[56].count
    	};

    	let each_blocks = [];

    	for (let i = 0; i < each_value_3.length; i += 1) {
    		each_blocks[i] = create_each_block_3(get_each_context_3(ctx, each_value_3, i));
    	}

    	let if_block0 = /*card*/ ctx[56].data.legalities[/*format*/ ctx[9].value] !== "legal" && create_if_block_4(ctx);
    	let if_block1 = /*card*/ ctx[56].count > 4 && create_if_block_3(ctx);
    	let if_block2 = /*scaling*/ ctx[4] > 90 && create_if_block_2(ctx);

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
    			attr(div, "class", "entry svelte-viewjj");

    			attr(div, "style", div_style_value = "width:" + /*width*/ ctx[1] + "px; height:" + (/*card*/ ctx[56].count <= 4
    			? /*height*/ ctx[0] + ((/*card*/ ctx[56].count || 1) - 1) * 40
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
    					length: /*card*/ ctx[56].count > 4 ? 4 : /*card*/ ctx[56].count
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

    			if (/*card*/ ctx[56].data.legalities[/*format*/ ctx[9].value] !== "legal") {
    				if (if_block0) ; else {
    					if_block0 = create_if_block_4(ctx);
    					if_block0.c();
    					if_block0.m(div, t1);
    				}
    			} else if (if_block0) {
    				if_block0.d(1);
    				if_block0 = null;
    			}

    			if (/*card*/ ctx[56].count > 4) {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);
    				} else {
    					if_block1 = create_if_block_3(ctx);
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
    					if_block2 = create_if_block_2(ctx);
    					if_block2.c();
    					if_block2.m(div, t3);
    				}
    			} else if (if_block2) {
    				if_block2.d(1);
    				if_block2 = null;
    			}

    			if (dirty[0] & /*width, promise, height*/ 67 && div_style_value !== (div_style_value = "width:" + /*width*/ ctx[1] + "px; height:" + (/*card*/ ctx[56].count <= 4
    			? /*height*/ ctx[0] + ((/*card*/ ctx[56].count || 1) - 1) * 40
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

    // (722:6) {#each groups || [] as group}
    function create_each_block_1(ctx) {
    	let div11;
    	let div9;
    	let h2;
    	let t0_value = (/*group*/ ctx[61].name + " // " + /*group*/ ctx[61].count || "no name") + "";
    	let t0;
    	let t1;
    	let button;
    	let t3;
    	let div8;
    	let div0;
    	let t4_value = /*group*/ ctx[61].mana.blue + "";
    	let t4;
    	let t5;
    	let div1;
    	let t6_value = /*group*/ ctx[61].mana.black + "";
    	let t6;
    	let t7;
    	let div2;
    	let t8_value = /*group*/ ctx[61].mana.red + "";
    	let t8;
    	let t9;
    	let div3;
    	let t10_value = /*group*/ ctx[61].mana.white + "";
    	let t10;
    	let t11;
    	let div4;
    	let t12_value = /*group*/ ctx[61].mana.green + "";
    	let t12;
    	let t13;
    	let div5;
    	let t14_value = /*group*/ ctx[61].mana.colorless + "";
    	let t14;
    	let t15;
    	let div6;
    	let t16_value = /*group*/ ctx[61].mana.sum + "";
    	let t16;
    	let t17;
    	let div7;
    	let t18_value = /*group*/ ctx[61].cost.toFixed(2) + "$" + "";
    	let t18;
    	let t19;
    	let div10;
    	let t20;
    	let mounted;
    	let dispose;

    	function click_handler_2(...args) {
    		return /*click_handler_2*/ ctx[43](/*group*/ ctx[61], ...args);
    	}

    	let each_value_2 = /*group*/ ctx[61].cards;
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
    			attr(h2, "class", "svelte-viewjj");
    			attr(div0, "class", "group-value blue svelte-viewjj");
    			attr(div1, "class", "group-value black svelte-viewjj");
    			attr(div2, "class", "group-value red svelte-viewjj");
    			attr(div3, "class", "group-value white svelte-viewjj");
    			attr(div4, "class", "group-value green svelte-viewjj");
    			attr(div5, "class", "group-value colorless svelte-viewjj");
    			attr(div6, "class", "group-value sum svelte-viewjj");
    			attr(div7, "class", "group-value group-cost svelte-viewjj");
    			attr(div8, "class", "group-statistics svelte-viewjj");
    			attr(div9, "class", "group-header svelte-viewjj");
    			attr(div10, "class", "group-content svelte-viewjj");
    			toggle_class(div10, "hidden", /*hiddenGroups*/ ctx[20].has(/*group*/ ctx[61].name));
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
    			if (dirty[0] & /*promise*/ 64 && t0_value !== (t0_value = (/*group*/ ctx[61].name + " // " + /*group*/ ctx[61].count || "no name") + "")) set_data(t0, t0_value);
    			if (dirty[0] & /*promise*/ 64 && t4_value !== (t4_value = /*group*/ ctx[61].mana.blue + "")) set_data(t4, t4_value);
    			if (dirty[0] & /*promise*/ 64 && t6_value !== (t6_value = /*group*/ ctx[61].mana.black + "")) set_data(t6, t6_value);
    			if (dirty[0] & /*promise*/ 64 && t8_value !== (t8_value = /*group*/ ctx[61].mana.red + "")) set_data(t8, t8_value);
    			if (dirty[0] & /*promise*/ 64 && t10_value !== (t10_value = /*group*/ ctx[61].mana.white + "")) set_data(t10, t10_value);
    			if (dirty[0] & /*promise*/ 64 && t12_value !== (t12_value = /*group*/ ctx[61].mana.green + "")) set_data(t12, t12_value);
    			if (dirty[0] & /*promise*/ 64 && t14_value !== (t14_value = /*group*/ ctx[61].mana.colorless + "")) set_data(t14, t14_value);
    			if (dirty[0] & /*promise*/ 64 && t16_value !== (t16_value = /*group*/ ctx[61].mana.sum + "")) set_data(t16, t16_value);
    			if (dirty[0] & /*promise*/ 64 && t18_value !== (t18_value = /*group*/ ctx[61].cost.toFixed(2) + "$" + "")) set_data(t18, t18_value);

    			if (dirty[0] & /*width, promise, height, scaling, format, devotionHighlight*/ 627 | dirty[1] & /*remove*/ 1) {
    				each_value_2 = /*group*/ ctx[61].cards;
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
    				toggle_class(div10, "hidden", /*hiddenGroups*/ ctx[20].has(/*group*/ ctx[61].name));
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

    // (712:20)         <div class="loading-wrapper">          <div>loading: {progress}
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

    			div3.innerHTML = `<div class="svelte-viewjj"></div> 
          <div class="svelte-viewjj"></div>`;

    			attr(div3, "class", "lds-ripple svelte-viewjj");
    			attr(div4, "class", "loading-wrapper svelte-viewjj");
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

    // (893:4) {:catch error}
    function create_catch_block(ctx) {
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

    // (862:4) {:then result}
    function create_then_block(ctx) {
    	let div;
    	let t0;
    	let button;
    	let t1;
    	let button_disabled_value;
    	let mounted;
    	let dispose;
    	let each_value = /*result*/ ctx[55].data;
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	let each_1_else = null;

    	if (!each_value.length) {
    		each_1_else = create_else_block(ctx);
    	}

    	function click_handler_3(...args) {
    		return /*click_handler_3*/ ctx[54](/*result*/ ctx[55], ...args);
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
    			attr(div, "class", "search-result svelte-viewjj");
    			button.disabled = button_disabled_value = !/*result*/ ctx[55].has_more;
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
    				each_value = /*result*/ ctx[55].data;
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

    			if (dirty[0] & /*cardSearchPromise*/ 128 && button_disabled_value !== (button_disabled_value = !/*result*/ ctx[55].has_more)) {
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

    // (884:8) {:else}
    function create_else_block(ctx) {
    	let div;

    	return {
    		c() {
    			div = element("div");
    			div.textContent = "No cards found";
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (877:12) {#if card.legalities[format.value] !== 'legal'}
    function create_if_block_1(ctx) {
    	let div;

    	return {
    		c() {
    			div = element("div");
    			div.textContent = "BANNED";
    			attr(div, "class", "banned-text svelte-viewjj");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (880:12) {#if scaling > 90}
    function create_if_block(ctx) {
    	let div;
    	let t_value = (/*card*/ ctx[56].prices.usd + "$" || "???") + "";
    	let t;

    	return {
    		c() {
    			div = element("div");
    			t = text(t_value);
    			attr(div, "class", "price svelte-viewjj");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, t);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*cardSearchPromise*/ 128 && t_value !== (t_value = (/*card*/ ctx[56].prices.usd + "$" || "???") + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (864:8) {#each result.data as card}
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
    		return /*dblclick_handler_1*/ ctx[53](/*card*/ ctx[56], ...args);
    	}

    	let if_block0 = /*card*/ ctx[56].legalities[/*format*/ ctx[9].value] !== "legal" && create_if_block_1(ctx);
    	let if_block1 = /*scaling*/ ctx[4] > 90 && create_if_block(ctx);

    	return {
    		c() {
    			div = element("div");
    			img = element("img");
    			t0 = space();
    			if (if_block0) if_block0.c();
    			t1 = space();
    			if (if_block1) if_block1.c();
    			t2 = space();
    			attr(img, "class", "card svelte-viewjj");
    			if (img.src !== (img_src_value = /*card*/ ctx[56].url)) attr(img, "src", img_src_value);
    			attr(img, "alt", img_alt_value = /*card*/ ctx[56].name);
    			attr(img, "width", /*width*/ ctx[1]);
    			attr(img, "height", /*height*/ ctx[0]);
    			toggle_class(img, "banned", /*card*/ ctx[56].legalities[/*format*/ ctx[9].value] !== "legal");
    			attr(div, "class", "entry svelte-viewjj");
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

    			if (dirty[0] & /*cardSearchPromise*/ 128 && img.src !== (img_src_value = /*card*/ ctx[56].url)) {
    				attr(img, "src", img_src_value);
    			}

    			if (dirty[0] & /*cardSearchPromise*/ 128 && img_alt_value !== (img_alt_value = /*card*/ ctx[56].name)) {
    				attr(img, "alt", img_alt_value);
    			}

    			if (dirty[0] & /*width*/ 2) {
    				attr(img, "width", /*width*/ ctx[1]);
    			}

    			if (dirty[0] & /*height*/ 1) {
    				attr(img, "height", /*height*/ ctx[0]);
    			}

    			if (dirty[0] & /*cardSearchPromise, format*/ 640) {
    				toggle_class(img, "banned", /*card*/ ctx[56].legalities[/*format*/ ctx[9].value] !== "legal");
    			}

    			if (/*card*/ ctx[56].legalities[/*format*/ ctx[9].value] !== "legal") {
    				if (if_block0) ; else {
    					if_block0 = create_if_block_1(ctx);
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
    					if_block1 = create_if_block(ctx);
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

    // (855:30)         <div class="loading-wrapper">          <div class="lds-ripple">            <div />            <div />          </div>        </div>      {:then result}
    function create_pending_block(ctx) {
    	let div3;

    	return {
    		c() {
    			div3 = element("div");

    			div3.innerHTML = `<div class="lds-ripple svelte-viewjj"><div class="svelte-viewjj"></div> 
          <div class="svelte-viewjj"></div></div>`;

    			attr(div3, "class", "loading-wrapper svelte-viewjj");
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
    	let textarea;
    	let t24;
    	let div4;
    	let promise_2;
    	let t25;
    	let div16;
    	let div5;
    	let t27;
    	let div15;
    	let div6;
    	let t28;
    	let input1;
    	let t29;
    	let div7;
    	let t30;
    	let input2;
    	let t31;
    	let div14;
    	let t32;
    	let div8;
    	let input3;
    	let t33;
    	let div9;
    	let input4;
    	let t34;
    	let div10;
    	let input5;
    	let t35;
    	let div11;
    	let input6;
    	let t36;
    	let div12;
    	let input7;
    	let t37;
    	let div13;
    	let input8;
    	let t38;
    	let button2;
    	let t40;
    	let promise_3;
    	let mounted;
    	let dispose;
    	let if_block = /*helpActive*/ ctx[21] && create_if_block_9(ctx);

    	let info = {
    		ctx,
    		current: null,
    		token: null,
    		pending: create_pending_block_2,
    		then: create_then_block_2,
    		catch: create_catch_block_2,
    		value: 60,
    		error: 59
    	};

    	handle_promise(promise_1 = /*promise*/ ctx[6], info);

    	let info_1 = {
    		ctx,
    		current: null,
    		token: null,
    		pending: create_pending_block_1,
    		then: create_then_block_1,
    		catch: create_catch_block_1,
    		value: 60,
    		error: 59
    	};

    	handle_promise(promise_2 = /*promise*/ ctx[6], info_1);

    	let info_2 = {
    		ctx,
    		current: null,
    		token: null,
    		pending: create_pending_block,
    		then: create_then_block,
    		catch: create_catch_block,
    		value: 55,
    		error: 59
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
    			textarea = element("textarea");
    			t24 = space();
    			div4 = element("div");
    			info_1.block.c();
    			t25 = space();
    			div16 = element("div");
    			div5 = element("div");
    			div5.textContent = "x";
    			t27 = space();
    			div15 = element("div");
    			div6 = element("div");
    			t28 = text("Name:\r\n        ");
    			input1 = element("input");
    			t29 = space();
    			div7 = element("div");
    			t30 = text("Text:\r\n        ");
    			input2 = element("input");
    			t31 = space();
    			div14 = element("div");
    			t32 = text("Commander-Colors:\r\n        ");
    			div8 = element("div");
    			input3 = element("input");
    			t33 = space();
    			div9 = element("div");
    			input4 = element("input");
    			t34 = space();
    			div10 = element("div");
    			input5 = element("input");
    			t35 = space();
    			div11 = element("div");
    			input6 = element("input");
    			t36 = space();
    			div12 = element("div");
    			input7 = element("input");
    			t37 = space();
    			div13 = element("div");
    			input8 = element("input");
    			t38 = space();
    			button2 = element("button");
    			button2.textContent = "search";
    			t40 = space();
    			info_2.block.c();
    			attr(div0, "class", "help-symbol svelte-viewjj");
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
    			attr(div2, "class", "help svelte-viewjj");
    			attr(textarea, "class", "input svelte-viewjj");
    			attr(div3, "class", "controls svelte-viewjj");
    			attr(div4, "class", "display svelte-viewjj");
    			attr(div5, "class", "toggle-search svelte-viewjj");
    			attr(div6, "class", "search-param");
    			attr(div7, "class", "search-param");
    			attr(input3, "type", "checkbox");
    			attr(input3, "class", "blue svelte-viewjj");
    			attr(div8, "class", "blue svelte-viewjj");
    			attr(input4, "type", "checkbox");
    			attr(input4, "class", "black svelte-viewjj");
    			attr(div9, "class", "black svelte-viewjj");
    			attr(input5, "type", "checkbox");
    			attr(input5, "class", "red svelte-viewjj");
    			attr(div10, "class", "red svelte-viewjj");
    			attr(input6, "type", "checkbox");
    			attr(input6, "class", "white svelte-viewjj");
    			attr(div11, "class", "white svelte-viewjj");
    			attr(input7, "type", "checkbox");
    			attr(input7, "class", "green svelte-viewjj");
    			attr(div12, "class", "green svelte-viewjj");
    			attr(input8, "type", "checkbox");
    			attr(input8, "class", "colorless svelte-viewjj");
    			attr(div13, "class", "colorless svelte-viewjj");
    			attr(div14, "class", "search-param color-param svelte-viewjj");
    			attr(div15, "class", "search-params svelte-viewjj");
    			attr(div16, "class", "card-search svelte-viewjj");
    			toggle_class(div16, "hide", !/*cardSearchActive*/ ctx[2]);
    			attr(div17, "class", "content svelte-viewjj");
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
    			/*select_binding*/ ctx[40](select);
    			append(div2, t17);
    			append(div2, div1);
    			append(div1, t18);
    			append(div1, input0);
    			set_input_value(input0, /*scaling*/ ctx[4]);
    			append(div2, t19);
    			append(div2, button0);
    			append(div2, t21);
    			append(div2, button1);
    			append(div3, t23);
    			append(div3, textarea);
    			/*textarea_binding*/ ctx[42](textarea);
    			append(div17, t24);
    			append(div17, div4);
    			info_1.block.m(div4, info_1.anchor = null);
    			info_1.mount = () => div4;
    			info_1.anchor = null;
    			append(div17, t25);
    			append(div17, div16);
    			append(div16, div5);
    			append(div16, t27);
    			append(div16, div15);
    			append(div15, div6);
    			append(div6, t28);
    			append(div6, input1);
    			/*input1_binding*/ ctx[45](input1);
    			append(div15, t29);
    			append(div15, div7);
    			append(div7, t30);
    			append(div7, input2);
    			/*input2_binding*/ ctx[46](input2);
    			append(div15, t31);
    			append(div15, div14);
    			append(div14, t32);
    			append(div14, div8);
    			append(div8, input3);
    			/*input3_binding*/ ctx[47](input3);
    			append(div14, t33);
    			append(div14, div9);
    			append(div9, input4);
    			/*input4_binding*/ ctx[48](input4);
    			append(div14, t34);
    			append(div14, div10);
    			append(div10, input5);
    			/*input5_binding*/ ctx[49](input5);
    			append(div14, t35);
    			append(div14, div11);
    			append(div11, input6);
    			/*input6_binding*/ ctx[50](input6);
    			append(div14, t36);
    			append(div14, div12);
    			append(div12, input7);
    			/*input7_binding*/ ctx[51](input7);
    			append(div14, t37);
    			append(div14, div13);
    			append(div13, input8);
    			/*input8_binding*/ ctx[52](input8);
    			append(div15, t38);
    			append(div15, button2);
    			append(div16, t40);
    			info_2.block.m(div16, info_2.anchor = null);
    			info_2.mount = () => div16;
    			info_2.anchor = null;

    			if (!mounted) {
    				dispose = [
    					listen(window, "keyup", /*update*/ ctx[28]),
    					listen(div0, "click", /*openHelp*/ ctx[33]),
    					listen(select, "blur", /*reload*/ ctx[29]),
    					listen(select, "change", /*reload*/ ctx[29]),
    					listen(input0, "change", /*input0_change_input_handler*/ ctx[41]),
    					listen(input0, "input", /*input0_change_input_handler*/ ctx[41]),
    					listen(button0, "click", /*toggleStatistics*/ ctx[35]),
    					listen(button1, "click", /*sortDeckString*/ ctx[27]),
    					listen(textarea, "keyup", /*onTyping*/ ctx[32]),
    					listen(div5, "click", /*toggleSearch*/ ctx[34]),
    					listen(input3, "click", /*clearColorless*/ ctx[24]),
    					listen(input4, "click", /*clearColorless*/ ctx[24]),
    					listen(input5, "click", /*clearColorless*/ ctx[24]),
    					listen(input6, "click", /*clearColorless*/ ctx[24]),
    					listen(input7, "click", /*clearColorless*/ ctx[24]),
    					listen(input8, "click", /*clearForColorless*/ ctx[23]),
    					listen(button2, "click", /*searchCards*/ ctx[25])
    				];

    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (/*helpActive*/ ctx[21]) {
    				if (if_block) ; else {
    					if_block = create_if_block_9(ctx);
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
    				child_ctx[60] = info.resolved;
    				info.block.p(child_ctx, dirty);
    			}

    			if (dirty[0] & /*scaling*/ 16) {
    				set_input_value(input0, /*scaling*/ ctx[4]);
    			}

    			info_1.ctx = ctx;

    			if (dirty[0] & /*promise*/ 64 && promise_2 !== (promise_2 = /*promise*/ ctx[6]) && handle_promise(promise_2, info_1)) ; else {
    				const child_ctx = ctx.slice();
    				child_ctx[60] = info_1.resolved;
    				info_1.block.p(child_ctx, dirty);
    			}

    			info_2.ctx = ctx;

    			if (dirty[0] & /*cardSearchPromise*/ 128 && promise_3 !== (promise_3 = /*cardSearchPromise*/ ctx[7]) && handle_promise(promise_3, info_2)) ; else {
    				const child_ctx = ctx.slice();
    				child_ctx[55] = info_2.resolved;
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
    			/*select_binding*/ ctx[40](null);
    			/*textarea_binding*/ ctx[42](null);
    			info_1.block.d();
    			info_1.token = null;
    			info_1 = null;
    			/*input1_binding*/ ctx[45](null);
    			/*input2_binding*/ ctx[46](null);
    			/*input3_binding*/ ctx[47](null);
    			/*input4_binding*/ ctx[48](null);
    			/*input5_binding*/ ctx[49](null);
    			/*input6_binding*/ ctx[50](null);
    			/*input7_binding*/ ctx[51](null);
    			/*input8_binding*/ ctx[52](null);
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
    			data: {},
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
    	const click_handler_1 = mana => highlightDevotion(mana);

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
    		if (!document.getElementById("svelte-viewjj-style")) add_css();
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWRpdG9yLWJ1bmRsZS5qcyIsInNvdXJjZXMiOlsibm9kZV9tb2R1bGVzL3N2ZWx0ZS9pbnRlcm5hbC9pbmRleC5tanMiLCJjYXJkLWxvYWRlci5qcyIsIm5vZGVfbW9kdWxlcy9qcy1jb29raWUvc3JjL2pzLmNvb2tpZS5qcyIsImVkaXRvci5zdmVsdGUiLCJlZGl0b3ItbWFpbi5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJmdW5jdGlvbiBub29wKCkgeyB9XG5jb25zdCBpZGVudGl0eSA9IHggPT4geDtcbmZ1bmN0aW9uIGFzc2lnbih0YXIsIHNyYykge1xuICAgIC8vIEB0cy1pZ25vcmVcbiAgICBmb3IgKGNvbnN0IGsgaW4gc3JjKVxuICAgICAgICB0YXJba10gPSBzcmNba107XG4gICAgcmV0dXJuIHRhcjtcbn1cbmZ1bmN0aW9uIGlzX3Byb21pc2UodmFsdWUpIHtcbiAgICByZXR1cm4gdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgdmFsdWUudGhlbiA9PT0gJ2Z1bmN0aW9uJztcbn1cbmZ1bmN0aW9uIGFkZF9sb2NhdGlvbihlbGVtZW50LCBmaWxlLCBsaW5lLCBjb2x1bW4sIGNoYXIpIHtcbiAgICBlbGVtZW50Ll9fc3ZlbHRlX21ldGEgPSB7XG4gICAgICAgIGxvYzogeyBmaWxlLCBsaW5lLCBjb2x1bW4sIGNoYXIgfVxuICAgIH07XG59XG5mdW5jdGlvbiBydW4oZm4pIHtcbiAgICByZXR1cm4gZm4oKTtcbn1cbmZ1bmN0aW9uIGJsYW5rX29iamVjdCgpIHtcbiAgICByZXR1cm4gT2JqZWN0LmNyZWF0ZShudWxsKTtcbn1cbmZ1bmN0aW9uIHJ1bl9hbGwoZm5zKSB7XG4gICAgZm5zLmZvckVhY2gocnVuKTtcbn1cbmZ1bmN0aW9uIGlzX2Z1bmN0aW9uKHRoaW5nKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB0aGluZyA9PT0gJ2Z1bmN0aW9uJztcbn1cbmZ1bmN0aW9uIHNhZmVfbm90X2VxdWFsKGEsIGIpIHtcbiAgICByZXR1cm4gYSAhPSBhID8gYiA9PSBiIDogYSAhPT0gYiB8fCAoKGEgJiYgdHlwZW9mIGEgPT09ICdvYmplY3QnKSB8fCB0eXBlb2YgYSA9PT0gJ2Z1bmN0aW9uJyk7XG59XG5mdW5jdGlvbiBub3RfZXF1YWwoYSwgYikge1xuICAgIHJldHVybiBhICE9IGEgPyBiID09IGIgOiBhICE9PSBiO1xufVxuZnVuY3Rpb24gdmFsaWRhdGVfc3RvcmUoc3RvcmUsIG5hbWUpIHtcbiAgICBpZiAoc3RvcmUgIT0gbnVsbCAmJiB0eXBlb2Ygc3RvcmUuc3Vic2NyaWJlICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJyR7bmFtZX0nIGlzIG5vdCBhIHN0b3JlIHdpdGggYSAnc3Vic2NyaWJlJyBtZXRob2RgKTtcbiAgICB9XG59XG5mdW5jdGlvbiBzdWJzY3JpYmUoc3RvcmUsIC4uLmNhbGxiYWNrcykge1xuICAgIGlmIChzdG9yZSA9PSBudWxsKSB7XG4gICAgICAgIHJldHVybiBub29wO1xuICAgIH1cbiAgICBjb25zdCB1bnN1YiA9IHN0b3JlLnN1YnNjcmliZSguLi5jYWxsYmFja3MpO1xuICAgIHJldHVybiB1bnN1Yi51bnN1YnNjcmliZSA/ICgpID0+IHVuc3ViLnVuc3Vic2NyaWJlKCkgOiB1bnN1Yjtcbn1cbmZ1bmN0aW9uIGdldF9zdG9yZV92YWx1ZShzdG9yZSkge1xuICAgIGxldCB2YWx1ZTtcbiAgICBzdWJzY3JpYmUoc3RvcmUsIF8gPT4gdmFsdWUgPSBfKSgpO1xuICAgIHJldHVybiB2YWx1ZTtcbn1cbmZ1bmN0aW9uIGNvbXBvbmVudF9zdWJzY3JpYmUoY29tcG9uZW50LCBzdG9yZSwgY2FsbGJhY2spIHtcbiAgICBjb21wb25lbnQuJCQub25fZGVzdHJveS5wdXNoKHN1YnNjcmliZShzdG9yZSwgY2FsbGJhY2spKTtcbn1cbmZ1bmN0aW9uIGNyZWF0ZV9zbG90KGRlZmluaXRpb24sIGN0eCwgJCRzY29wZSwgZm4pIHtcbiAgICBpZiAoZGVmaW5pdGlvbikge1xuICAgICAgICBjb25zdCBzbG90X2N0eCA9IGdldF9zbG90X2NvbnRleHQoZGVmaW5pdGlvbiwgY3R4LCAkJHNjb3BlLCBmbik7XG4gICAgICAgIHJldHVybiBkZWZpbml0aW9uWzBdKHNsb3RfY3R4KTtcbiAgICB9XG59XG5mdW5jdGlvbiBnZXRfc2xvdF9jb250ZXh0KGRlZmluaXRpb24sIGN0eCwgJCRzY29wZSwgZm4pIHtcbiAgICByZXR1cm4gZGVmaW5pdGlvblsxXSAmJiBmblxuICAgICAgICA/IGFzc2lnbigkJHNjb3BlLmN0eC5zbGljZSgpLCBkZWZpbml0aW9uWzFdKGZuKGN0eCkpKVxuICAgICAgICA6ICQkc2NvcGUuY3R4O1xufVxuZnVuY3Rpb24gZ2V0X3Nsb3RfY2hhbmdlcyhkZWZpbml0aW9uLCAkJHNjb3BlLCBkaXJ0eSwgZm4pIHtcbiAgICBpZiAoZGVmaW5pdGlvblsyXSAmJiBmbikge1xuICAgICAgICBjb25zdCBsZXRzID0gZGVmaW5pdGlvblsyXShmbihkaXJ0eSkpO1xuICAgICAgICBpZiAoJCRzY29wZS5kaXJ0eSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICByZXR1cm4gbGV0cztcbiAgICAgICAgfVxuICAgICAgICBpZiAodHlwZW9mIGxldHMgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICBjb25zdCBtZXJnZWQgPSBbXTtcbiAgICAgICAgICAgIGNvbnN0IGxlbiA9IE1hdGgubWF4KCQkc2NvcGUuZGlydHkubGVuZ3RoLCBsZXRzLmxlbmd0aCk7XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxlbjsgaSArPSAxKSB7XG4gICAgICAgICAgICAgICAgbWVyZ2VkW2ldID0gJCRzY29wZS5kaXJ0eVtpXSB8IGxldHNbaV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gbWVyZ2VkO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAkJHNjb3BlLmRpcnR5IHwgbGV0cztcbiAgICB9XG4gICAgcmV0dXJuICQkc2NvcGUuZGlydHk7XG59XG5mdW5jdGlvbiB1cGRhdGVfc2xvdChzbG90LCBzbG90X2RlZmluaXRpb24sIGN0eCwgJCRzY29wZSwgZGlydHksIGdldF9zbG90X2NoYW5nZXNfZm4sIGdldF9zbG90X2NvbnRleHRfZm4pIHtcbiAgICBjb25zdCBzbG90X2NoYW5nZXMgPSBnZXRfc2xvdF9jaGFuZ2VzKHNsb3RfZGVmaW5pdGlvbiwgJCRzY29wZSwgZGlydHksIGdldF9zbG90X2NoYW5nZXNfZm4pO1xuICAgIGlmIChzbG90X2NoYW5nZXMpIHtcbiAgICAgICAgY29uc3Qgc2xvdF9jb250ZXh0ID0gZ2V0X3Nsb3RfY29udGV4dChzbG90X2RlZmluaXRpb24sIGN0eCwgJCRzY29wZSwgZ2V0X3Nsb3RfY29udGV4dF9mbik7XG4gICAgICAgIHNsb3QucChzbG90X2NvbnRleHQsIHNsb3RfY2hhbmdlcyk7XG4gICAgfVxufVxuZnVuY3Rpb24gZXhjbHVkZV9pbnRlcm5hbF9wcm9wcyhwcm9wcykge1xuICAgIGNvbnN0IHJlc3VsdCA9IHt9O1xuICAgIGZvciAoY29uc3QgayBpbiBwcm9wcylcbiAgICAgICAgaWYgKGtbMF0gIT09ICckJylcbiAgICAgICAgICAgIHJlc3VsdFtrXSA9IHByb3BzW2tdO1xuICAgIHJldHVybiByZXN1bHQ7XG59XG5mdW5jdGlvbiBjb21wdXRlX3Jlc3RfcHJvcHMocHJvcHMsIGtleXMpIHtcbiAgICBjb25zdCByZXN0ID0ge307XG4gICAga2V5cyA9IG5ldyBTZXQoa2V5cyk7XG4gICAgZm9yIChjb25zdCBrIGluIHByb3BzKVxuICAgICAgICBpZiAoIWtleXMuaGFzKGspICYmIGtbMF0gIT09ICckJylcbiAgICAgICAgICAgIHJlc3Rba10gPSBwcm9wc1trXTtcbiAgICByZXR1cm4gcmVzdDtcbn1cbmZ1bmN0aW9uIG9uY2UoZm4pIHtcbiAgICBsZXQgcmFuID0gZmFsc2U7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICguLi5hcmdzKSB7XG4gICAgICAgIGlmIChyYW4pXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIHJhbiA9IHRydWU7XG4gICAgICAgIGZuLmNhbGwodGhpcywgLi4uYXJncyk7XG4gICAgfTtcbn1cbmZ1bmN0aW9uIG51bGxfdG9fZW1wdHkodmFsdWUpIHtcbiAgICByZXR1cm4gdmFsdWUgPT0gbnVsbCA/ICcnIDogdmFsdWU7XG59XG5mdW5jdGlvbiBzZXRfc3RvcmVfdmFsdWUoc3RvcmUsIHJldCwgdmFsdWUgPSByZXQpIHtcbiAgICBzdG9yZS5zZXQodmFsdWUpO1xuICAgIHJldHVybiByZXQ7XG59XG5jb25zdCBoYXNfcHJvcCA9IChvYmosIHByb3ApID0+IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmosIHByb3ApO1xuZnVuY3Rpb24gYWN0aW9uX2Rlc3Ryb3llcihhY3Rpb25fcmVzdWx0KSB7XG4gICAgcmV0dXJuIGFjdGlvbl9yZXN1bHQgJiYgaXNfZnVuY3Rpb24oYWN0aW9uX3Jlc3VsdC5kZXN0cm95KSA/IGFjdGlvbl9yZXN1bHQuZGVzdHJveSA6IG5vb3A7XG59XG5cbmNvbnN0IGlzX2NsaWVudCA9IHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnO1xubGV0IG5vdyA9IGlzX2NsaWVudFxuICAgID8gKCkgPT4gd2luZG93LnBlcmZvcm1hbmNlLm5vdygpXG4gICAgOiAoKSA9PiBEYXRlLm5vdygpO1xubGV0IHJhZiA9IGlzX2NsaWVudCA/IGNiID0+IHJlcXVlc3RBbmltYXRpb25GcmFtZShjYikgOiBub29wO1xuLy8gdXNlZCBpbnRlcm5hbGx5IGZvciB0ZXN0aW5nXG5mdW5jdGlvbiBzZXRfbm93KGZuKSB7XG4gICAgbm93ID0gZm47XG59XG5mdW5jdGlvbiBzZXRfcmFmKGZuKSB7XG4gICAgcmFmID0gZm47XG59XG5cbmNvbnN0IHRhc2tzID0gbmV3IFNldCgpO1xuZnVuY3Rpb24gcnVuX3Rhc2tzKG5vdykge1xuICAgIHRhc2tzLmZvckVhY2godGFzayA9PiB7XG4gICAgICAgIGlmICghdGFzay5jKG5vdykpIHtcbiAgICAgICAgICAgIHRhc2tzLmRlbGV0ZSh0YXNrKTtcbiAgICAgICAgICAgIHRhc2suZigpO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgaWYgKHRhc2tzLnNpemUgIT09IDApXG4gICAgICAgIHJhZihydW5fdGFza3MpO1xufVxuLyoqXG4gKiBGb3IgdGVzdGluZyBwdXJwb3NlcyBvbmx5IVxuICovXG5mdW5jdGlvbiBjbGVhcl9sb29wcygpIHtcbiAgICB0YXNrcy5jbGVhcigpO1xufVxuLyoqXG4gKiBDcmVhdGVzIGEgbmV3IHRhc2sgdGhhdCBydW5zIG9uIGVhY2ggcmFmIGZyYW1lXG4gKiB1bnRpbCBpdCByZXR1cm5zIGEgZmFsc3kgdmFsdWUgb3IgaXMgYWJvcnRlZFxuICovXG5mdW5jdGlvbiBsb29wKGNhbGxiYWNrKSB7XG4gICAgbGV0IHRhc2s7XG4gICAgaWYgKHRhc2tzLnNpemUgPT09IDApXG4gICAgICAgIHJhZihydW5fdGFza3MpO1xuICAgIHJldHVybiB7XG4gICAgICAgIHByb21pc2U6IG5ldyBQcm9taXNlKGZ1bGZpbGwgPT4ge1xuICAgICAgICAgICAgdGFza3MuYWRkKHRhc2sgPSB7IGM6IGNhbGxiYWNrLCBmOiBmdWxmaWxsIH0pO1xuICAgICAgICB9KSxcbiAgICAgICAgYWJvcnQoKSB7XG4gICAgICAgICAgICB0YXNrcy5kZWxldGUodGFzayk7XG4gICAgICAgIH1cbiAgICB9O1xufVxuXG5mdW5jdGlvbiBhcHBlbmQodGFyZ2V0LCBub2RlKSB7XG4gICAgdGFyZ2V0LmFwcGVuZENoaWxkKG5vZGUpO1xufVxuZnVuY3Rpb24gaW5zZXJ0KHRhcmdldCwgbm9kZSwgYW5jaG9yKSB7XG4gICAgdGFyZ2V0Lmluc2VydEJlZm9yZShub2RlLCBhbmNob3IgfHwgbnVsbCk7XG59XG5mdW5jdGlvbiBkZXRhY2gobm9kZSkge1xuICAgIG5vZGUucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChub2RlKTtcbn1cbmZ1bmN0aW9uIGRlc3Ryb3lfZWFjaChpdGVyYXRpb25zLCBkZXRhY2hpbmcpIHtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGl0ZXJhdGlvbnMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgaWYgKGl0ZXJhdGlvbnNbaV0pXG4gICAgICAgICAgICBpdGVyYXRpb25zW2ldLmQoZGV0YWNoaW5nKTtcbiAgICB9XG59XG5mdW5jdGlvbiBlbGVtZW50KG5hbWUpIHtcbiAgICByZXR1cm4gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChuYW1lKTtcbn1cbmZ1bmN0aW9uIGVsZW1lbnRfaXMobmFtZSwgaXMpIHtcbiAgICByZXR1cm4gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChuYW1lLCB7IGlzIH0pO1xufVxuZnVuY3Rpb24gb2JqZWN0X3dpdGhvdXRfcHJvcGVydGllcyhvYmosIGV4Y2x1ZGUpIHtcbiAgICBjb25zdCB0YXJnZXQgPSB7fTtcbiAgICBmb3IgKGNvbnN0IGsgaW4gb2JqKSB7XG4gICAgICAgIGlmIChoYXNfcHJvcChvYmosIGspXG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICAmJiBleGNsdWRlLmluZGV4T2YoaykgPT09IC0xKSB7XG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICB0YXJnZXRba10gPSBvYmpba107XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRhcmdldDtcbn1cbmZ1bmN0aW9uIHN2Z19lbGVtZW50KG5hbWUpIHtcbiAgICByZXR1cm4gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKCdodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZycsIG5hbWUpO1xufVxuZnVuY3Rpb24gdGV4dChkYXRhKSB7XG4gICAgcmV0dXJuIGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKGRhdGEpO1xufVxuZnVuY3Rpb24gc3BhY2UoKSB7XG4gICAgcmV0dXJuIHRleHQoJyAnKTtcbn1cbmZ1bmN0aW9uIGVtcHR5KCkge1xuICAgIHJldHVybiB0ZXh0KCcnKTtcbn1cbmZ1bmN0aW9uIGxpc3Rlbihub2RlLCBldmVudCwgaGFuZGxlciwgb3B0aW9ucykge1xuICAgIG5vZGUuYWRkRXZlbnRMaXN0ZW5lcihldmVudCwgaGFuZGxlciwgb3B0aW9ucyk7XG4gICAgcmV0dXJuICgpID0+IG5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcihldmVudCwgaGFuZGxlciwgb3B0aW9ucyk7XG59XG5mdW5jdGlvbiBwcmV2ZW50X2RlZmF1bHQoZm4pIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgcmV0dXJuIGZuLmNhbGwodGhpcywgZXZlbnQpO1xuICAgIH07XG59XG5mdW5jdGlvbiBzdG9wX3Byb3BhZ2F0aW9uKGZuKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICByZXR1cm4gZm4uY2FsbCh0aGlzLCBldmVudCk7XG4gICAgfTtcbn1cbmZ1bmN0aW9uIHNlbGYoZm4pIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgaWYgKGV2ZW50LnRhcmdldCA9PT0gdGhpcylcbiAgICAgICAgICAgIGZuLmNhbGwodGhpcywgZXZlbnQpO1xuICAgIH07XG59XG5mdW5jdGlvbiBhdHRyKG5vZGUsIGF0dHJpYnV0ZSwgdmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbClcbiAgICAgICAgbm9kZS5yZW1vdmVBdHRyaWJ1dGUoYXR0cmlidXRlKTtcbiAgICBlbHNlIGlmIChub2RlLmdldEF0dHJpYnV0ZShhdHRyaWJ1dGUpICE9PSB2YWx1ZSlcbiAgICAgICAgbm9kZS5zZXRBdHRyaWJ1dGUoYXR0cmlidXRlLCB2YWx1ZSk7XG59XG5mdW5jdGlvbiBzZXRfYXR0cmlidXRlcyhub2RlLCBhdHRyaWJ1dGVzKSB7XG4gICAgLy8gQHRzLWlnbm9yZVxuICAgIGNvbnN0IGRlc2NyaXB0b3JzID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcnMobm9kZS5fX3Byb3RvX18pO1xuICAgIGZvciAoY29uc3Qga2V5IGluIGF0dHJpYnV0ZXMpIHtcbiAgICAgICAgaWYgKGF0dHJpYnV0ZXNba2V5XSA9PSBudWxsKSB7XG4gICAgICAgICAgICBub2RlLnJlbW92ZUF0dHJpYnV0ZShrZXkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGtleSA9PT0gJ3N0eWxlJykge1xuICAgICAgICAgICAgbm9kZS5zdHlsZS5jc3NUZXh0ID0gYXR0cmlidXRlc1trZXldO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGtleSA9PT0gJ19fdmFsdWUnKSB7XG4gICAgICAgICAgICBub2RlLnZhbHVlID0gbm9kZVtrZXldID0gYXR0cmlidXRlc1trZXldO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGRlc2NyaXB0b3JzW2tleV0gJiYgZGVzY3JpcHRvcnNba2V5XS5zZXQpIHtcbiAgICAgICAgICAgIG5vZGVba2V5XSA9IGF0dHJpYnV0ZXNba2V5XTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGF0dHIobm9kZSwga2V5LCBhdHRyaWJ1dGVzW2tleV0pO1xuICAgICAgICB9XG4gICAgfVxufVxuZnVuY3Rpb24gc2V0X3N2Z19hdHRyaWJ1dGVzKG5vZGUsIGF0dHJpYnV0ZXMpIHtcbiAgICBmb3IgKGNvbnN0IGtleSBpbiBhdHRyaWJ1dGVzKSB7XG4gICAgICAgIGF0dHIobm9kZSwga2V5LCBhdHRyaWJ1dGVzW2tleV0pO1xuICAgIH1cbn1cbmZ1bmN0aW9uIHNldF9jdXN0b21fZWxlbWVudF9kYXRhKG5vZGUsIHByb3AsIHZhbHVlKSB7XG4gICAgaWYgKHByb3AgaW4gbm9kZSkge1xuICAgICAgICBub2RlW3Byb3BdID0gdmFsdWU7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICBhdHRyKG5vZGUsIHByb3AsIHZhbHVlKTtcbiAgICB9XG59XG5mdW5jdGlvbiB4bGlua19hdHRyKG5vZGUsIGF0dHJpYnV0ZSwgdmFsdWUpIHtcbiAgICBub2RlLnNldEF0dHJpYnV0ZU5TKCdodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rJywgYXR0cmlidXRlLCB2YWx1ZSk7XG59XG5mdW5jdGlvbiBnZXRfYmluZGluZ19ncm91cF92YWx1ZShncm91cCkge1xuICAgIGNvbnN0IHZhbHVlID0gW107XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBncm91cC5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBpZiAoZ3JvdXBbaV0uY2hlY2tlZClcbiAgICAgICAgICAgIHZhbHVlLnB1c2goZ3JvdXBbaV0uX192YWx1ZSk7XG4gICAgfVxuICAgIHJldHVybiB2YWx1ZTtcbn1cbmZ1bmN0aW9uIHRvX251bWJlcih2YWx1ZSkge1xuICAgIHJldHVybiB2YWx1ZSA9PT0gJycgPyB1bmRlZmluZWQgOiArdmFsdWU7XG59XG5mdW5jdGlvbiB0aW1lX3Jhbmdlc190b19hcnJheShyYW5nZXMpIHtcbiAgICBjb25zdCBhcnJheSA9IFtdO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmFuZ2VzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgIGFycmF5LnB1c2goeyBzdGFydDogcmFuZ2VzLnN0YXJ0KGkpLCBlbmQ6IHJhbmdlcy5lbmQoaSkgfSk7XG4gICAgfVxuICAgIHJldHVybiBhcnJheTtcbn1cbmZ1bmN0aW9uIGNoaWxkcmVuKGVsZW1lbnQpIHtcbiAgICByZXR1cm4gQXJyYXkuZnJvbShlbGVtZW50LmNoaWxkTm9kZXMpO1xufVxuZnVuY3Rpb24gY2xhaW1fZWxlbWVudChub2RlcywgbmFtZSwgYXR0cmlidXRlcywgc3ZnKSB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBub2Rlcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBub2RlID0gbm9kZXNbaV07XG4gICAgICAgIGlmIChub2RlLm5vZGVOYW1lID09PSBuYW1lKSB7XG4gICAgICAgICAgICBsZXQgaiA9IDA7XG4gICAgICAgICAgICB3aGlsZSAoaiA8IG5vZGUuYXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBhdHRyaWJ1dGUgPSBub2RlLmF0dHJpYnV0ZXNbal07XG4gICAgICAgICAgICAgICAgaWYgKGF0dHJpYnV0ZXNbYXR0cmlidXRlLm5hbWVdKSB7XG4gICAgICAgICAgICAgICAgICAgIGorKztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUucmVtb3ZlQXR0cmlidXRlKGF0dHJpYnV0ZS5uYW1lKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gbm9kZXMuc3BsaWNlKGksIDEpWzBdO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBzdmcgPyBzdmdfZWxlbWVudChuYW1lKSA6IGVsZW1lbnQobmFtZSk7XG59XG5mdW5jdGlvbiBjbGFpbV90ZXh0KG5vZGVzLCBkYXRhKSB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBub2Rlcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBub2RlID0gbm9kZXNbaV07XG4gICAgICAgIGlmIChub2RlLm5vZGVUeXBlID09PSAzKSB7XG4gICAgICAgICAgICBub2RlLmRhdGEgPSAnJyArIGRhdGE7XG4gICAgICAgICAgICByZXR1cm4gbm9kZXMuc3BsaWNlKGksIDEpWzBdO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0ZXh0KGRhdGEpO1xufVxuZnVuY3Rpb24gY2xhaW1fc3BhY2Uobm9kZXMpIHtcbiAgICByZXR1cm4gY2xhaW1fdGV4dChub2RlcywgJyAnKTtcbn1cbmZ1bmN0aW9uIHNldF9kYXRhKHRleHQsIGRhdGEpIHtcbiAgICBkYXRhID0gJycgKyBkYXRhO1xuICAgIGlmICh0ZXh0LmRhdGEgIT09IGRhdGEpXG4gICAgICAgIHRleHQuZGF0YSA9IGRhdGE7XG59XG5mdW5jdGlvbiBzZXRfaW5wdXRfdmFsdWUoaW5wdXQsIHZhbHVlKSB7XG4gICAgaW5wdXQudmFsdWUgPSB2YWx1ZSA9PSBudWxsID8gJycgOiB2YWx1ZTtcbn1cbmZ1bmN0aW9uIHNldF9pbnB1dF90eXBlKGlucHV0LCB0eXBlKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgaW5wdXQudHlwZSA9IHR5cGU7XG4gICAgfVxuICAgIGNhdGNoIChlKSB7XG4gICAgICAgIC8vIGRvIG5vdGhpbmdcbiAgICB9XG59XG5mdW5jdGlvbiBzZXRfc3R5bGUobm9kZSwga2V5LCB2YWx1ZSwgaW1wb3J0YW50KSB7XG4gICAgbm9kZS5zdHlsZS5zZXRQcm9wZXJ0eShrZXksIHZhbHVlLCBpbXBvcnRhbnQgPyAnaW1wb3J0YW50JyA6ICcnKTtcbn1cbmZ1bmN0aW9uIHNlbGVjdF9vcHRpb24oc2VsZWN0LCB2YWx1ZSkge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgc2VsZWN0Lm9wdGlvbnMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9uID0gc2VsZWN0Lm9wdGlvbnNbaV07XG4gICAgICAgIGlmIChvcHRpb24uX192YWx1ZSA9PT0gdmFsdWUpIHtcbiAgICAgICAgICAgIG9wdGlvbi5zZWxlY3RlZCA9IHRydWU7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICB9XG59XG5mdW5jdGlvbiBzZWxlY3Rfb3B0aW9ucyhzZWxlY3QsIHZhbHVlKSB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWxlY3Qub3B0aW9ucy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBvcHRpb24gPSBzZWxlY3Qub3B0aW9uc1tpXTtcbiAgICAgICAgb3B0aW9uLnNlbGVjdGVkID0gfnZhbHVlLmluZGV4T2Yob3B0aW9uLl9fdmFsdWUpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIHNlbGVjdF92YWx1ZShzZWxlY3QpIHtcbiAgICBjb25zdCBzZWxlY3RlZF9vcHRpb24gPSBzZWxlY3QucXVlcnlTZWxlY3RvcignOmNoZWNrZWQnKSB8fCBzZWxlY3Qub3B0aW9uc1swXTtcbiAgICByZXR1cm4gc2VsZWN0ZWRfb3B0aW9uICYmIHNlbGVjdGVkX29wdGlvbi5fX3ZhbHVlO1xufVxuZnVuY3Rpb24gc2VsZWN0X211bHRpcGxlX3ZhbHVlKHNlbGVjdCkge1xuICAgIHJldHVybiBbXS5tYXAuY2FsbChzZWxlY3QucXVlcnlTZWxlY3RvckFsbCgnOmNoZWNrZWQnKSwgb3B0aW9uID0+IG9wdGlvbi5fX3ZhbHVlKTtcbn1cbi8vIHVuZm9ydHVuYXRlbHkgdGhpcyBjYW4ndCBiZSBhIGNvbnN0YW50IGFzIHRoYXQgd291bGRuJ3QgYmUgdHJlZS1zaGFrZWFibGVcbi8vIHNvIHdlIGNhY2hlIHRoZSByZXN1bHQgaW5zdGVhZFxubGV0IGNyb3Nzb3JpZ2luO1xuZnVuY3Rpb24gaXNfY3Jvc3NvcmlnaW4oKSB7XG4gICAgaWYgKGNyb3Nzb3JpZ2luID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY3Jvc3NvcmlnaW4gPSBmYWxzZTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB3aW5kb3cucGFyZW50KSB7XG4gICAgICAgICAgICAgICAgdm9pZCB3aW5kb3cucGFyZW50LmRvY3VtZW50O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY3Jvc3NvcmlnaW4gPSB0cnVlO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBjcm9zc29yaWdpbjtcbn1cbmZ1bmN0aW9uIGFkZF9yZXNpemVfbGlzdGVuZXIobm9kZSwgZm4pIHtcbiAgICBjb25zdCBjb21wdXRlZF9zdHlsZSA9IGdldENvbXB1dGVkU3R5bGUobm9kZSk7XG4gICAgY29uc3Qgel9pbmRleCA9IChwYXJzZUludChjb21wdXRlZF9zdHlsZS56SW5kZXgpIHx8IDApIC0gMTtcbiAgICBpZiAoY29tcHV0ZWRfc3R5bGUucG9zaXRpb24gPT09ICdzdGF0aWMnKSB7XG4gICAgICAgIG5vZGUuc3R5bGUucG9zaXRpb24gPSAncmVsYXRpdmUnO1xuICAgIH1cbiAgICBjb25zdCBpZnJhbWUgPSBlbGVtZW50KCdpZnJhbWUnKTtcbiAgICBpZnJhbWUuc2V0QXR0cmlidXRlKCdzdHlsZScsIGBkaXNwbGF5OiBibG9jazsgcG9zaXRpb246IGFic29sdXRlOyB0b3A6IDA7IGxlZnQ6IDA7IHdpZHRoOiAxMDAlOyBoZWlnaHQ6IDEwMCU7IGAgK1xuICAgICAgICBgb3ZlcmZsb3c6IGhpZGRlbjsgYm9yZGVyOiAwOyBvcGFjaXR5OiAwOyBwb2ludGVyLWV2ZW50czogbm9uZTsgei1pbmRleDogJHt6X2luZGV4fTtgKTtcbiAgICBpZnJhbWUuc2V0QXR0cmlidXRlKCdhcmlhLWhpZGRlbicsICd0cnVlJyk7XG4gICAgaWZyYW1lLnRhYkluZGV4ID0gLTE7XG4gICAgY29uc3QgY3Jvc3NvcmlnaW4gPSBpc19jcm9zc29yaWdpbigpO1xuICAgIGxldCB1bnN1YnNjcmliZTtcbiAgICBpZiAoY3Jvc3NvcmlnaW4pIHtcbiAgICAgICAgaWZyYW1lLnNyYyA9IGBkYXRhOnRleHQvaHRtbCw8c2NyaXB0Pm9ucmVzaXplPWZ1bmN0aW9uKCl7cGFyZW50LnBvc3RNZXNzYWdlKDAsJyonKX08L3NjcmlwdD5gO1xuICAgICAgICB1bnN1YnNjcmliZSA9IGxpc3Rlbih3aW5kb3csICdtZXNzYWdlJywgKGV2ZW50KSA9PiB7XG4gICAgICAgICAgICBpZiAoZXZlbnQuc291cmNlID09PSBpZnJhbWUuY29udGVudFdpbmRvdylcbiAgICAgICAgICAgICAgICBmbigpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIGlmcmFtZS5zcmMgPSAnYWJvdXQ6YmxhbmsnO1xuICAgICAgICBpZnJhbWUub25sb2FkID0gKCkgPT4ge1xuICAgICAgICAgICAgdW5zdWJzY3JpYmUgPSBsaXN0ZW4oaWZyYW1lLmNvbnRlbnRXaW5kb3csICdyZXNpemUnLCBmbik7XG4gICAgICAgIH07XG4gICAgfVxuICAgIGFwcGVuZChub2RlLCBpZnJhbWUpO1xuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgIGlmIChjcm9zc29yaWdpbikge1xuICAgICAgICAgICAgdW5zdWJzY3JpYmUoKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmICh1bnN1YnNjcmliZSAmJiBpZnJhbWUuY29udGVudFdpbmRvdykge1xuICAgICAgICAgICAgdW5zdWJzY3JpYmUoKTtcbiAgICAgICAgfVxuICAgICAgICBkZXRhY2goaWZyYW1lKTtcbiAgICB9O1xufVxuZnVuY3Rpb24gdG9nZ2xlX2NsYXNzKGVsZW1lbnQsIG5hbWUsIHRvZ2dsZSkge1xuICAgIGVsZW1lbnQuY2xhc3NMaXN0W3RvZ2dsZSA/ICdhZGQnIDogJ3JlbW92ZSddKG5hbWUpO1xufVxuZnVuY3Rpb24gY3VzdG9tX2V2ZW50KHR5cGUsIGRldGFpbCkge1xuICAgIGNvbnN0IGUgPSBkb2N1bWVudC5jcmVhdGVFdmVudCgnQ3VzdG9tRXZlbnQnKTtcbiAgICBlLmluaXRDdXN0b21FdmVudCh0eXBlLCBmYWxzZSwgZmFsc2UsIGRldGFpbCk7XG4gICAgcmV0dXJuIGU7XG59XG5mdW5jdGlvbiBxdWVyeV9zZWxlY3Rvcl9hbGwoc2VsZWN0b3IsIHBhcmVudCA9IGRvY3VtZW50LmJvZHkpIHtcbiAgICByZXR1cm4gQXJyYXkuZnJvbShwYXJlbnQucXVlcnlTZWxlY3RvckFsbChzZWxlY3RvcikpO1xufVxuY2xhc3MgSHRtbFRhZyB7XG4gICAgY29uc3RydWN0b3IoYW5jaG9yID0gbnVsbCkge1xuICAgICAgICB0aGlzLmEgPSBhbmNob3I7XG4gICAgICAgIHRoaXMuZSA9IHRoaXMubiA9IG51bGw7XG4gICAgfVxuICAgIG0oaHRtbCwgdGFyZ2V0LCBhbmNob3IgPSBudWxsKSB7XG4gICAgICAgIGlmICghdGhpcy5lKSB7XG4gICAgICAgICAgICB0aGlzLmUgPSBlbGVtZW50KHRhcmdldC5ub2RlTmFtZSk7XG4gICAgICAgICAgICB0aGlzLnQgPSB0YXJnZXQ7XG4gICAgICAgICAgICB0aGlzLmgoaHRtbCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5pKGFuY2hvcik7XG4gICAgfVxuICAgIGgoaHRtbCkge1xuICAgICAgICB0aGlzLmUuaW5uZXJIVE1MID0gaHRtbDtcbiAgICAgICAgdGhpcy5uID0gQXJyYXkuZnJvbSh0aGlzLmUuY2hpbGROb2Rlcyk7XG4gICAgfVxuICAgIGkoYW5jaG9yKSB7XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5uLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgICAgICBpbnNlcnQodGhpcy50LCB0aGlzLm5baV0sIGFuY2hvcik7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcChodG1sKSB7XG4gICAgICAgIHRoaXMuZCgpO1xuICAgICAgICB0aGlzLmgoaHRtbCk7XG4gICAgICAgIHRoaXMuaSh0aGlzLmEpO1xuICAgIH1cbiAgICBkKCkge1xuICAgICAgICB0aGlzLm4uZm9yRWFjaChkZXRhY2gpO1xuICAgIH1cbn1cblxuY29uc3QgYWN0aXZlX2RvY3MgPSBuZXcgU2V0KCk7XG5sZXQgYWN0aXZlID0gMDtcbi8vIGh0dHBzOi8vZ2l0aHViLmNvbS9kYXJrc2t5YXBwL3N0cmluZy1oYXNoL2Jsb2IvbWFzdGVyL2luZGV4LmpzXG5mdW5jdGlvbiBoYXNoKHN0cikge1xuICAgIGxldCBoYXNoID0gNTM4MTtcbiAgICBsZXQgaSA9IHN0ci5sZW5ndGg7XG4gICAgd2hpbGUgKGktLSlcbiAgICAgICAgaGFzaCA9ICgoaGFzaCA8PCA1KSAtIGhhc2gpIF4gc3RyLmNoYXJDb2RlQXQoaSk7XG4gICAgcmV0dXJuIGhhc2ggPj4+IDA7XG59XG5mdW5jdGlvbiBjcmVhdGVfcnVsZShub2RlLCBhLCBiLCBkdXJhdGlvbiwgZGVsYXksIGVhc2UsIGZuLCB1aWQgPSAwKSB7XG4gICAgY29uc3Qgc3RlcCA9IDE2LjY2NiAvIGR1cmF0aW9uO1xuICAgIGxldCBrZXlmcmFtZXMgPSAne1xcbic7XG4gICAgZm9yIChsZXQgcCA9IDA7IHAgPD0gMTsgcCArPSBzdGVwKSB7XG4gICAgICAgIGNvbnN0IHQgPSBhICsgKGIgLSBhKSAqIGVhc2UocCk7XG4gICAgICAgIGtleWZyYW1lcyArPSBwICogMTAwICsgYCV7JHtmbih0LCAxIC0gdCl9fVxcbmA7XG4gICAgfVxuICAgIGNvbnN0IHJ1bGUgPSBrZXlmcmFtZXMgKyBgMTAwJSB7JHtmbihiLCAxIC0gYil9fVxcbn1gO1xuICAgIGNvbnN0IG5hbWUgPSBgX19zdmVsdGVfJHtoYXNoKHJ1bGUpfV8ke3VpZH1gO1xuICAgIGNvbnN0IGRvYyA9IG5vZGUub3duZXJEb2N1bWVudDtcbiAgICBhY3RpdmVfZG9jcy5hZGQoZG9jKTtcbiAgICBjb25zdCBzdHlsZXNoZWV0ID0gZG9jLl9fc3ZlbHRlX3N0eWxlc2hlZXQgfHwgKGRvYy5fX3N2ZWx0ZV9zdHlsZXNoZWV0ID0gZG9jLmhlYWQuYXBwZW5kQ2hpbGQoZWxlbWVudCgnc3R5bGUnKSkuc2hlZXQpO1xuICAgIGNvbnN0IGN1cnJlbnRfcnVsZXMgPSBkb2MuX19zdmVsdGVfcnVsZXMgfHwgKGRvYy5fX3N2ZWx0ZV9ydWxlcyA9IHt9KTtcbiAgICBpZiAoIWN1cnJlbnRfcnVsZXNbbmFtZV0pIHtcbiAgICAgICAgY3VycmVudF9ydWxlc1tuYW1lXSA9IHRydWU7XG4gICAgICAgIHN0eWxlc2hlZXQuaW5zZXJ0UnVsZShgQGtleWZyYW1lcyAke25hbWV9ICR7cnVsZX1gLCBzdHlsZXNoZWV0LmNzc1J1bGVzLmxlbmd0aCk7XG4gICAgfVxuICAgIGNvbnN0IGFuaW1hdGlvbiA9IG5vZGUuc3R5bGUuYW5pbWF0aW9uIHx8ICcnO1xuICAgIG5vZGUuc3R5bGUuYW5pbWF0aW9uID0gYCR7YW5pbWF0aW9uID8gYCR7YW5pbWF0aW9ufSwgYCA6IGBgfSR7bmFtZX0gJHtkdXJhdGlvbn1tcyBsaW5lYXIgJHtkZWxheX1tcyAxIGJvdGhgO1xuICAgIGFjdGl2ZSArPSAxO1xuICAgIHJldHVybiBuYW1lO1xufVxuZnVuY3Rpb24gZGVsZXRlX3J1bGUobm9kZSwgbmFtZSkge1xuICAgIGNvbnN0IHByZXZpb3VzID0gKG5vZGUuc3R5bGUuYW5pbWF0aW9uIHx8ICcnKS5zcGxpdCgnLCAnKTtcbiAgICBjb25zdCBuZXh0ID0gcHJldmlvdXMuZmlsdGVyKG5hbWVcbiAgICAgICAgPyBhbmltID0+IGFuaW0uaW5kZXhPZihuYW1lKSA8IDAgLy8gcmVtb3ZlIHNwZWNpZmljIGFuaW1hdGlvblxuICAgICAgICA6IGFuaW0gPT4gYW5pbS5pbmRleE9mKCdfX3N2ZWx0ZScpID09PSAtMSAvLyByZW1vdmUgYWxsIFN2ZWx0ZSBhbmltYXRpb25zXG4gICAgKTtcbiAgICBjb25zdCBkZWxldGVkID0gcHJldmlvdXMubGVuZ3RoIC0gbmV4dC5sZW5ndGg7XG4gICAgaWYgKGRlbGV0ZWQpIHtcbiAgICAgICAgbm9kZS5zdHlsZS5hbmltYXRpb24gPSBuZXh0LmpvaW4oJywgJyk7XG4gICAgICAgIGFjdGl2ZSAtPSBkZWxldGVkO1xuICAgICAgICBpZiAoIWFjdGl2ZSlcbiAgICAgICAgICAgIGNsZWFyX3J1bGVzKCk7XG4gICAgfVxufVxuZnVuY3Rpb24gY2xlYXJfcnVsZXMoKSB7XG4gICAgcmFmKCgpID0+IHtcbiAgICAgICAgaWYgKGFjdGl2ZSlcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgYWN0aXZlX2RvY3MuZm9yRWFjaChkb2MgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc3R5bGVzaGVldCA9IGRvYy5fX3N2ZWx0ZV9zdHlsZXNoZWV0O1xuICAgICAgICAgICAgbGV0IGkgPSBzdHlsZXNoZWV0LmNzc1J1bGVzLmxlbmd0aDtcbiAgICAgICAgICAgIHdoaWxlIChpLS0pXG4gICAgICAgICAgICAgICAgc3R5bGVzaGVldC5kZWxldGVSdWxlKGkpO1xuICAgICAgICAgICAgZG9jLl9fc3ZlbHRlX3J1bGVzID0ge307XG4gICAgICAgIH0pO1xuICAgICAgICBhY3RpdmVfZG9jcy5jbGVhcigpO1xuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVfYW5pbWF0aW9uKG5vZGUsIGZyb20sIGZuLCBwYXJhbXMpIHtcbiAgICBpZiAoIWZyb20pXG4gICAgICAgIHJldHVybiBub29wO1xuICAgIGNvbnN0IHRvID0gbm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBpZiAoZnJvbS5sZWZ0ID09PSB0by5sZWZ0ICYmIGZyb20ucmlnaHQgPT09IHRvLnJpZ2h0ICYmIGZyb20udG9wID09PSB0by50b3AgJiYgZnJvbS5ib3R0b20gPT09IHRvLmJvdHRvbSlcbiAgICAgICAgcmV0dXJuIG5vb3A7XG4gICAgY29uc3QgeyBkZWxheSA9IDAsIGR1cmF0aW9uID0gMzAwLCBlYXNpbmcgPSBpZGVudGl0eSwgXG4gICAgLy8gQHRzLWlnbm9yZSB0b2RvOiBzaG91bGQgdGhpcyBiZSBzZXBhcmF0ZWQgZnJvbSBkZXN0cnVjdHVyaW5nPyBPciBzdGFydC9lbmQgYWRkZWQgdG8gcHVibGljIGFwaSBhbmQgZG9jdW1lbnRhdGlvbj9cbiAgICBzdGFydDogc3RhcnRfdGltZSA9IG5vdygpICsgZGVsYXksIFxuICAgIC8vIEB0cy1pZ25vcmUgdG9kbzpcbiAgICBlbmQgPSBzdGFydF90aW1lICsgZHVyYXRpb24sIHRpY2sgPSBub29wLCBjc3MgfSA9IGZuKG5vZGUsIHsgZnJvbSwgdG8gfSwgcGFyYW1zKTtcbiAgICBsZXQgcnVubmluZyA9IHRydWU7XG4gICAgbGV0IHN0YXJ0ZWQgPSBmYWxzZTtcbiAgICBsZXQgbmFtZTtcbiAgICBmdW5jdGlvbiBzdGFydCgpIHtcbiAgICAgICAgaWYgKGNzcykge1xuICAgICAgICAgICAgbmFtZSA9IGNyZWF0ZV9ydWxlKG5vZGUsIDAsIDEsIGR1cmF0aW9uLCBkZWxheSwgZWFzaW5nLCBjc3MpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghZGVsYXkpIHtcbiAgICAgICAgICAgIHN0YXJ0ZWQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgfVxuICAgIGZ1bmN0aW9uIHN0b3AoKSB7XG4gICAgICAgIGlmIChjc3MpXG4gICAgICAgICAgICBkZWxldGVfcnVsZShub2RlLCBuYW1lKTtcbiAgICAgICAgcnVubmluZyA9IGZhbHNlO1xuICAgIH1cbiAgICBsb29wKG5vdyA9PiB7XG4gICAgICAgIGlmICghc3RhcnRlZCAmJiBub3cgPj0gc3RhcnRfdGltZSkge1xuICAgICAgICAgICAgc3RhcnRlZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHN0YXJ0ZWQgJiYgbm93ID49IGVuZCkge1xuICAgICAgICAgICAgdGljaygxLCAwKTtcbiAgICAgICAgICAgIHN0b3AoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXJ1bm5pbmcpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc3RhcnRlZCkge1xuICAgICAgICAgICAgY29uc3QgcCA9IG5vdyAtIHN0YXJ0X3RpbWU7XG4gICAgICAgICAgICBjb25zdCB0ID0gMCArIDEgKiBlYXNpbmcocCAvIGR1cmF0aW9uKTtcbiAgICAgICAgICAgIHRpY2sodCwgMSAtIHQpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH0pO1xuICAgIHN0YXJ0KCk7XG4gICAgdGljaygwLCAxKTtcbiAgICByZXR1cm4gc3RvcDtcbn1cbmZ1bmN0aW9uIGZpeF9wb3NpdGlvbihub2RlKSB7XG4gICAgY29uc3Qgc3R5bGUgPSBnZXRDb21wdXRlZFN0eWxlKG5vZGUpO1xuICAgIGlmIChzdHlsZS5wb3NpdGlvbiAhPT0gJ2Fic29sdXRlJyAmJiBzdHlsZS5wb3NpdGlvbiAhPT0gJ2ZpeGVkJykge1xuICAgICAgICBjb25zdCB7IHdpZHRoLCBoZWlnaHQgfSA9IHN0eWxlO1xuICAgICAgICBjb25zdCBhID0gbm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgbm9kZS5zdHlsZS5wb3NpdGlvbiA9ICdhYnNvbHV0ZSc7XG4gICAgICAgIG5vZGUuc3R5bGUud2lkdGggPSB3aWR0aDtcbiAgICAgICAgbm9kZS5zdHlsZS5oZWlnaHQgPSBoZWlnaHQ7XG4gICAgICAgIGFkZF90cmFuc2Zvcm0obm9kZSwgYSk7XG4gICAgfVxufVxuZnVuY3Rpb24gYWRkX3RyYW5zZm9ybShub2RlLCBhKSB7XG4gICAgY29uc3QgYiA9IG5vZGUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgaWYgKGEubGVmdCAhPT0gYi5sZWZ0IHx8IGEudG9wICE9PSBiLnRvcCkge1xuICAgICAgICBjb25zdCBzdHlsZSA9IGdldENvbXB1dGVkU3R5bGUobm9kZSk7XG4gICAgICAgIGNvbnN0IHRyYW5zZm9ybSA9IHN0eWxlLnRyYW5zZm9ybSA9PT0gJ25vbmUnID8gJycgOiBzdHlsZS50cmFuc2Zvcm07XG4gICAgICAgIG5vZGUuc3R5bGUudHJhbnNmb3JtID0gYCR7dHJhbnNmb3JtfSB0cmFuc2xhdGUoJHthLmxlZnQgLSBiLmxlZnR9cHgsICR7YS50b3AgLSBiLnRvcH1weClgO1xuICAgIH1cbn1cblxubGV0IGN1cnJlbnRfY29tcG9uZW50O1xuZnVuY3Rpb24gc2V0X2N1cnJlbnRfY29tcG9uZW50KGNvbXBvbmVudCkge1xuICAgIGN1cnJlbnRfY29tcG9uZW50ID0gY29tcG9uZW50O1xufVxuZnVuY3Rpb24gZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkge1xuICAgIGlmICghY3VycmVudF9jb21wb25lbnQpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRnVuY3Rpb24gY2FsbGVkIG91dHNpZGUgY29tcG9uZW50IGluaXRpYWxpemF0aW9uYCk7XG4gICAgcmV0dXJuIGN1cnJlbnRfY29tcG9uZW50O1xufVxuZnVuY3Rpb24gYmVmb3JlVXBkYXRlKGZuKSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuYmVmb3JlX3VwZGF0ZS5wdXNoKGZuKTtcbn1cbmZ1bmN0aW9uIG9uTW91bnQoZm4pIHtcbiAgICBnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5vbl9tb3VudC5wdXNoKGZuKTtcbn1cbmZ1bmN0aW9uIGFmdGVyVXBkYXRlKGZuKSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuYWZ0ZXJfdXBkYXRlLnB1c2goZm4pO1xufVxuZnVuY3Rpb24gb25EZXN0cm95KGZuKSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQub25fZGVzdHJveS5wdXNoKGZuKTtcbn1cbmZ1bmN0aW9uIGNyZWF0ZUV2ZW50RGlzcGF0Y2hlcigpIHtcbiAgICBjb25zdCBjb21wb25lbnQgPSBnZXRfY3VycmVudF9jb21wb25lbnQoKTtcbiAgICByZXR1cm4gKHR5cGUsIGRldGFpbCkgPT4ge1xuICAgICAgICBjb25zdCBjYWxsYmFja3MgPSBjb21wb25lbnQuJCQuY2FsbGJhY2tzW3R5cGVdO1xuICAgICAgICBpZiAoY2FsbGJhY2tzKSB7XG4gICAgICAgICAgICAvLyBUT0RPIGFyZSB0aGVyZSBzaXR1YXRpb25zIHdoZXJlIGV2ZW50cyBjb3VsZCBiZSBkaXNwYXRjaGVkXG4gICAgICAgICAgICAvLyBpbiBhIHNlcnZlciAobm9uLURPTSkgZW52aXJvbm1lbnQ/XG4gICAgICAgICAgICBjb25zdCBldmVudCA9IGN1c3RvbV9ldmVudCh0eXBlLCBkZXRhaWwpO1xuICAgICAgICAgICAgY2FsbGJhY2tzLnNsaWNlKCkuZm9yRWFjaChmbiA9PiB7XG4gICAgICAgICAgICAgICAgZm4uY2FsbChjb21wb25lbnQsIGV2ZW50KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfTtcbn1cbmZ1bmN0aW9uIHNldENvbnRleHQoa2V5LCBjb250ZXh0KSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuY29udGV4dC5zZXQoa2V5LCBjb250ZXh0KTtcbn1cbmZ1bmN0aW9uIGdldENvbnRleHQoa2V5KSB7XG4gICAgcmV0dXJuIGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLmNvbnRleHQuZ2V0KGtleSk7XG59XG4vLyBUT0RPIGZpZ3VyZSBvdXQgaWYgd2Ugc3RpbGwgd2FudCB0byBzdXBwb3J0XG4vLyBzaG9ydGhhbmQgZXZlbnRzLCBvciBpZiB3ZSB3YW50IHRvIGltcGxlbWVudFxuLy8gYSByZWFsIGJ1YmJsaW5nIG1lY2hhbmlzbVxuZnVuY3Rpb24gYnViYmxlKGNvbXBvbmVudCwgZXZlbnQpIHtcbiAgICBjb25zdCBjYWxsYmFja3MgPSBjb21wb25lbnQuJCQuY2FsbGJhY2tzW2V2ZW50LnR5cGVdO1xuICAgIGlmIChjYWxsYmFja3MpIHtcbiAgICAgICAgY2FsbGJhY2tzLnNsaWNlKCkuZm9yRWFjaChmbiA9PiBmbihldmVudCkpO1xuICAgIH1cbn1cblxuY29uc3QgZGlydHlfY29tcG9uZW50cyA9IFtdO1xuY29uc3QgaW50cm9zID0geyBlbmFibGVkOiBmYWxzZSB9O1xuY29uc3QgYmluZGluZ19jYWxsYmFja3MgPSBbXTtcbmNvbnN0IHJlbmRlcl9jYWxsYmFja3MgPSBbXTtcbmNvbnN0IGZsdXNoX2NhbGxiYWNrcyA9IFtdO1xuY29uc3QgcmVzb2x2ZWRfcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xubGV0IHVwZGF0ZV9zY2hlZHVsZWQgPSBmYWxzZTtcbmZ1bmN0aW9uIHNjaGVkdWxlX3VwZGF0ZSgpIHtcbiAgICBpZiAoIXVwZGF0ZV9zY2hlZHVsZWQpIHtcbiAgICAgICAgdXBkYXRlX3NjaGVkdWxlZCA9IHRydWU7XG4gICAgICAgIHJlc29sdmVkX3Byb21pc2UudGhlbihmbHVzaCk7XG4gICAgfVxufVxuZnVuY3Rpb24gdGljaygpIHtcbiAgICBzY2hlZHVsZV91cGRhdGUoKTtcbiAgICByZXR1cm4gcmVzb2x2ZWRfcHJvbWlzZTtcbn1cbmZ1bmN0aW9uIGFkZF9yZW5kZXJfY2FsbGJhY2soZm4pIHtcbiAgICByZW5kZXJfY2FsbGJhY2tzLnB1c2goZm4pO1xufVxuZnVuY3Rpb24gYWRkX2ZsdXNoX2NhbGxiYWNrKGZuKSB7XG4gICAgZmx1c2hfY2FsbGJhY2tzLnB1c2goZm4pO1xufVxubGV0IGZsdXNoaW5nID0gZmFsc2U7XG5jb25zdCBzZWVuX2NhbGxiYWNrcyA9IG5ldyBTZXQoKTtcbmZ1bmN0aW9uIGZsdXNoKCkge1xuICAgIGlmIChmbHVzaGluZylcbiAgICAgICAgcmV0dXJuO1xuICAgIGZsdXNoaW5nID0gdHJ1ZTtcbiAgICBkbyB7XG4gICAgICAgIC8vIGZpcnN0LCBjYWxsIGJlZm9yZVVwZGF0ZSBmdW5jdGlvbnNcbiAgICAgICAgLy8gYW5kIHVwZGF0ZSBjb21wb25lbnRzXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGlydHlfY29tcG9uZW50cy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICAgICAgY29uc3QgY29tcG9uZW50ID0gZGlydHlfY29tcG9uZW50c1tpXTtcbiAgICAgICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChjb21wb25lbnQpO1xuICAgICAgICAgICAgdXBkYXRlKGNvbXBvbmVudC4kJCk7XG4gICAgICAgIH1cbiAgICAgICAgZGlydHlfY29tcG9uZW50cy5sZW5ndGggPSAwO1xuICAgICAgICB3aGlsZSAoYmluZGluZ19jYWxsYmFja3MubGVuZ3RoKVxuICAgICAgICAgICAgYmluZGluZ19jYWxsYmFja3MucG9wKCkoKTtcbiAgICAgICAgLy8gdGhlbiwgb25jZSBjb21wb25lbnRzIGFyZSB1cGRhdGVkLCBjYWxsXG4gICAgICAgIC8vIGFmdGVyVXBkYXRlIGZ1bmN0aW9ucy4gVGhpcyBtYXkgY2F1c2VcbiAgICAgICAgLy8gc3Vic2VxdWVudCB1cGRhdGVzLi4uXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmVuZGVyX2NhbGxiYWNrcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICAgICAgY29uc3QgY2FsbGJhY2sgPSByZW5kZXJfY2FsbGJhY2tzW2ldO1xuICAgICAgICAgICAgaWYgKCFzZWVuX2NhbGxiYWNrcy5oYXMoY2FsbGJhY2spKSB7XG4gICAgICAgICAgICAgICAgLy8gLi4uc28gZ3VhcmQgYWdhaW5zdCBpbmZpbml0ZSBsb29wc1xuICAgICAgICAgICAgICAgIHNlZW5fY2FsbGJhY2tzLmFkZChjYWxsYmFjayk7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZW5kZXJfY2FsbGJhY2tzLmxlbmd0aCA9IDA7XG4gICAgfSB3aGlsZSAoZGlydHlfY29tcG9uZW50cy5sZW5ndGgpO1xuICAgIHdoaWxlIChmbHVzaF9jYWxsYmFja3MubGVuZ3RoKSB7XG4gICAgICAgIGZsdXNoX2NhbGxiYWNrcy5wb3AoKSgpO1xuICAgIH1cbiAgICB1cGRhdGVfc2NoZWR1bGVkID0gZmFsc2U7XG4gICAgZmx1c2hpbmcgPSBmYWxzZTtcbiAgICBzZWVuX2NhbGxiYWNrcy5jbGVhcigpO1xufVxuZnVuY3Rpb24gdXBkYXRlKCQkKSB7XG4gICAgaWYgKCQkLmZyYWdtZW50ICE9PSBudWxsKSB7XG4gICAgICAgICQkLnVwZGF0ZSgpO1xuICAgICAgICBydW5fYWxsKCQkLmJlZm9yZV91cGRhdGUpO1xuICAgICAgICBjb25zdCBkaXJ0eSA9ICQkLmRpcnR5O1xuICAgICAgICAkJC5kaXJ0eSA9IFstMV07XG4gICAgICAgICQkLmZyYWdtZW50ICYmICQkLmZyYWdtZW50LnAoJCQuY3R4LCBkaXJ0eSk7XG4gICAgICAgICQkLmFmdGVyX3VwZGF0ZS5mb3JFYWNoKGFkZF9yZW5kZXJfY2FsbGJhY2spO1xuICAgIH1cbn1cblxubGV0IHByb21pc2U7XG5mdW5jdGlvbiB3YWl0KCkge1xuICAgIGlmICghcHJvbWlzZSkge1xuICAgICAgICBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIHByb21pc2UudGhlbigoKSA9PiB7XG4gICAgICAgICAgICBwcm9taXNlID0gbnVsbDtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBwcm9taXNlO1xufVxuZnVuY3Rpb24gZGlzcGF0Y2gobm9kZSwgZGlyZWN0aW9uLCBraW5kKSB7XG4gICAgbm9kZS5kaXNwYXRjaEV2ZW50KGN1c3RvbV9ldmVudChgJHtkaXJlY3Rpb24gPyAnaW50cm8nIDogJ291dHJvJ30ke2tpbmR9YCkpO1xufVxuY29uc3Qgb3V0cm9pbmcgPSBuZXcgU2V0KCk7XG5sZXQgb3V0cm9zO1xuZnVuY3Rpb24gZ3JvdXBfb3V0cm9zKCkge1xuICAgIG91dHJvcyA9IHtcbiAgICAgICAgcjogMCxcbiAgICAgICAgYzogW10sXG4gICAgICAgIHA6IG91dHJvcyAvLyBwYXJlbnQgZ3JvdXBcbiAgICB9O1xufVxuZnVuY3Rpb24gY2hlY2tfb3V0cm9zKCkge1xuICAgIGlmICghb3V0cm9zLnIpIHtcbiAgICAgICAgcnVuX2FsbChvdXRyb3MuYyk7XG4gICAgfVxuICAgIG91dHJvcyA9IG91dHJvcy5wO1xufVxuZnVuY3Rpb24gdHJhbnNpdGlvbl9pbihibG9jaywgbG9jYWwpIHtcbiAgICBpZiAoYmxvY2sgJiYgYmxvY2suaSkge1xuICAgICAgICBvdXRyb2luZy5kZWxldGUoYmxvY2spO1xuICAgICAgICBibG9jay5pKGxvY2FsKTtcbiAgICB9XG59XG5mdW5jdGlvbiB0cmFuc2l0aW9uX291dChibG9jaywgbG9jYWwsIGRldGFjaCwgY2FsbGJhY2spIHtcbiAgICBpZiAoYmxvY2sgJiYgYmxvY2subykge1xuICAgICAgICBpZiAob3V0cm9pbmcuaGFzKGJsb2NrKSlcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgb3V0cm9pbmcuYWRkKGJsb2NrKTtcbiAgICAgICAgb3V0cm9zLmMucHVzaCgoKSA9PiB7XG4gICAgICAgICAgICBvdXRyb2luZy5kZWxldGUoYmxvY2spO1xuICAgICAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICAgICAgaWYgKGRldGFjaClcbiAgICAgICAgICAgICAgICAgICAgYmxvY2suZCgxKTtcbiAgICAgICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgYmxvY2subyhsb2NhbCk7XG4gICAgfVxufVxuY29uc3QgbnVsbF90cmFuc2l0aW9uID0geyBkdXJhdGlvbjogMCB9O1xuZnVuY3Rpb24gY3JlYXRlX2luX3RyYW5zaXRpb24obm9kZSwgZm4sIHBhcmFtcykge1xuICAgIGxldCBjb25maWcgPSBmbihub2RlLCBwYXJhbXMpO1xuICAgIGxldCBydW5uaW5nID0gZmFsc2U7XG4gICAgbGV0IGFuaW1hdGlvbl9uYW1lO1xuICAgIGxldCB0YXNrO1xuICAgIGxldCB1aWQgPSAwO1xuICAgIGZ1bmN0aW9uIGNsZWFudXAoKSB7XG4gICAgICAgIGlmIChhbmltYXRpb25fbmFtZSlcbiAgICAgICAgICAgIGRlbGV0ZV9ydWxlKG5vZGUsIGFuaW1hdGlvbl9uYW1lKTtcbiAgICB9XG4gICAgZnVuY3Rpb24gZ28oKSB7XG4gICAgICAgIGNvbnN0IHsgZGVsYXkgPSAwLCBkdXJhdGlvbiA9IDMwMCwgZWFzaW5nID0gaWRlbnRpdHksIHRpY2sgPSBub29wLCBjc3MgfSA9IGNvbmZpZyB8fCBudWxsX3RyYW5zaXRpb247XG4gICAgICAgIGlmIChjc3MpXG4gICAgICAgICAgICBhbmltYXRpb25fbmFtZSA9IGNyZWF0ZV9ydWxlKG5vZGUsIDAsIDEsIGR1cmF0aW9uLCBkZWxheSwgZWFzaW5nLCBjc3MsIHVpZCsrKTtcbiAgICAgICAgdGljaygwLCAxKTtcbiAgICAgICAgY29uc3Qgc3RhcnRfdGltZSA9IG5vdygpICsgZGVsYXk7XG4gICAgICAgIGNvbnN0IGVuZF90aW1lID0gc3RhcnRfdGltZSArIGR1cmF0aW9uO1xuICAgICAgICBpZiAodGFzaylcbiAgICAgICAgICAgIHRhc2suYWJvcnQoKTtcbiAgICAgICAgcnVubmluZyA9IHRydWU7XG4gICAgICAgIGFkZF9yZW5kZXJfY2FsbGJhY2soKCkgPT4gZGlzcGF0Y2gobm9kZSwgdHJ1ZSwgJ3N0YXJ0JykpO1xuICAgICAgICB0YXNrID0gbG9vcChub3cgPT4ge1xuICAgICAgICAgICAgaWYgKHJ1bm5pbmcpIHtcbiAgICAgICAgICAgICAgICBpZiAobm93ID49IGVuZF90aW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHRpY2soMSwgMCk7XG4gICAgICAgICAgICAgICAgICAgIGRpc3BhdGNoKG5vZGUsIHRydWUsICdlbmQnKTtcbiAgICAgICAgICAgICAgICAgICAgY2xlYW51cCgpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gcnVubmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAobm93ID49IHN0YXJ0X3RpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdCA9IGVhc2luZygobm93IC0gc3RhcnRfdGltZSkgLyBkdXJhdGlvbik7XG4gICAgICAgICAgICAgICAgICAgIHRpY2sodCwgMSAtIHQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBydW5uaW5nO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgbGV0IHN0YXJ0ZWQgPSBmYWxzZTtcbiAgICByZXR1cm4ge1xuICAgICAgICBzdGFydCgpIHtcbiAgICAgICAgICAgIGlmIChzdGFydGVkKVxuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIGRlbGV0ZV9ydWxlKG5vZGUpO1xuICAgICAgICAgICAgaWYgKGlzX2Z1bmN0aW9uKGNvbmZpZykpIHtcbiAgICAgICAgICAgICAgICBjb25maWcgPSBjb25maWcoKTtcbiAgICAgICAgICAgICAgICB3YWl0KCkudGhlbihnbyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBnbygpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBpbnZhbGlkYXRlKCkge1xuICAgICAgICAgICAgc3RhcnRlZCA9IGZhbHNlO1xuICAgICAgICB9LFxuICAgICAgICBlbmQoKSB7XG4gICAgICAgICAgICBpZiAocnVubmluZykge1xuICAgICAgICAgICAgICAgIGNsZWFudXAoKTtcbiAgICAgICAgICAgICAgICBydW5uaW5nID0gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9O1xufVxuZnVuY3Rpb24gY3JlYXRlX291dF90cmFuc2l0aW9uKG5vZGUsIGZuLCBwYXJhbXMpIHtcbiAgICBsZXQgY29uZmlnID0gZm4obm9kZSwgcGFyYW1zKTtcbiAgICBsZXQgcnVubmluZyA9IHRydWU7XG4gICAgbGV0IGFuaW1hdGlvbl9uYW1lO1xuICAgIGNvbnN0IGdyb3VwID0gb3V0cm9zO1xuICAgIGdyb3VwLnIgKz0gMTtcbiAgICBmdW5jdGlvbiBnbygpIHtcbiAgICAgICAgY29uc3QgeyBkZWxheSA9IDAsIGR1cmF0aW9uID0gMzAwLCBlYXNpbmcgPSBpZGVudGl0eSwgdGljayA9IG5vb3AsIGNzcyB9ID0gY29uZmlnIHx8IG51bGxfdHJhbnNpdGlvbjtcbiAgICAgICAgaWYgKGNzcylcbiAgICAgICAgICAgIGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgMSwgMCwgZHVyYXRpb24sIGRlbGF5LCBlYXNpbmcsIGNzcyk7XG4gICAgICAgIGNvbnN0IHN0YXJ0X3RpbWUgPSBub3coKSArIGRlbGF5O1xuICAgICAgICBjb25zdCBlbmRfdGltZSA9IHN0YXJ0X3RpbWUgKyBkdXJhdGlvbjtcbiAgICAgICAgYWRkX3JlbmRlcl9jYWxsYmFjaygoKSA9PiBkaXNwYXRjaChub2RlLCBmYWxzZSwgJ3N0YXJ0JykpO1xuICAgICAgICBsb29wKG5vdyA9PiB7XG4gICAgICAgICAgICBpZiAocnVubmluZykge1xuICAgICAgICAgICAgICAgIGlmIChub3cgPj0gZW5kX3RpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGljaygwLCAxKTtcbiAgICAgICAgICAgICAgICAgICAgZGlzcGF0Y2gobm9kZSwgZmFsc2UsICdlbmQnKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCEtLWdyb3VwLnIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoaXMgd2lsbCByZXN1bHQgaW4gYGVuZCgpYCBiZWluZyBjYWxsZWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBzbyB3ZSBkb24ndCBuZWVkIHRvIGNsZWFuIHVwIGhlcmVcbiAgICAgICAgICAgICAgICAgICAgICAgIHJ1bl9hbGwoZ3JvdXAuYyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAobm93ID49IHN0YXJ0X3RpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdCA9IGVhc2luZygobm93IC0gc3RhcnRfdGltZSkgLyBkdXJhdGlvbik7XG4gICAgICAgICAgICAgICAgICAgIHRpY2soMSAtIHQsIHQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBydW5uaW5nO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgaWYgKGlzX2Z1bmN0aW9uKGNvbmZpZykpIHtcbiAgICAgICAgd2FpdCgpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgY29uZmlnID0gY29uZmlnKCk7XG4gICAgICAgICAgICBnbygpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIGdvKCk7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICAgIGVuZChyZXNldCkge1xuICAgICAgICAgICAgaWYgKHJlc2V0ICYmIGNvbmZpZy50aWNrKSB7XG4gICAgICAgICAgICAgICAgY29uZmlnLnRpY2soMSwgMCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocnVubmluZykge1xuICAgICAgICAgICAgICAgIGlmIChhbmltYXRpb25fbmFtZSlcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlX3J1bGUobm9kZSwgYW5pbWF0aW9uX25hbWUpO1xuICAgICAgICAgICAgICAgIHJ1bm5pbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH07XG59XG5mdW5jdGlvbiBjcmVhdGVfYmlkaXJlY3Rpb25hbF90cmFuc2l0aW9uKG5vZGUsIGZuLCBwYXJhbXMsIGludHJvKSB7XG4gICAgbGV0IGNvbmZpZyA9IGZuKG5vZGUsIHBhcmFtcyk7XG4gICAgbGV0IHQgPSBpbnRybyA/IDAgOiAxO1xuICAgIGxldCBydW5uaW5nX3Byb2dyYW0gPSBudWxsO1xuICAgIGxldCBwZW5kaW5nX3Byb2dyYW0gPSBudWxsO1xuICAgIGxldCBhbmltYXRpb25fbmFtZSA9IG51bGw7XG4gICAgZnVuY3Rpb24gY2xlYXJfYW5pbWF0aW9uKCkge1xuICAgICAgICBpZiAoYW5pbWF0aW9uX25hbWUpXG4gICAgICAgICAgICBkZWxldGVfcnVsZShub2RlLCBhbmltYXRpb25fbmFtZSk7XG4gICAgfVxuICAgIGZ1bmN0aW9uIGluaXQocHJvZ3JhbSwgZHVyYXRpb24pIHtcbiAgICAgICAgY29uc3QgZCA9IHByb2dyYW0uYiAtIHQ7XG4gICAgICAgIGR1cmF0aW9uICo9IE1hdGguYWJzKGQpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgYTogdCxcbiAgICAgICAgICAgIGI6IHByb2dyYW0uYixcbiAgICAgICAgICAgIGQsXG4gICAgICAgICAgICBkdXJhdGlvbixcbiAgICAgICAgICAgIHN0YXJ0OiBwcm9ncmFtLnN0YXJ0LFxuICAgICAgICAgICAgZW5kOiBwcm9ncmFtLnN0YXJ0ICsgZHVyYXRpb24sXG4gICAgICAgICAgICBncm91cDogcHJvZ3JhbS5ncm91cFxuICAgICAgICB9O1xuICAgIH1cbiAgICBmdW5jdGlvbiBnbyhiKSB7XG4gICAgICAgIGNvbnN0IHsgZGVsYXkgPSAwLCBkdXJhdGlvbiA9IDMwMCwgZWFzaW5nID0gaWRlbnRpdHksIHRpY2sgPSBub29wLCBjc3MgfSA9IGNvbmZpZyB8fCBudWxsX3RyYW5zaXRpb247XG4gICAgICAgIGNvbnN0IHByb2dyYW0gPSB7XG4gICAgICAgICAgICBzdGFydDogbm93KCkgKyBkZWxheSxcbiAgICAgICAgICAgIGJcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKCFiKSB7XG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlIHRvZG86IGltcHJvdmUgdHlwaW5nc1xuICAgICAgICAgICAgcHJvZ3JhbS5ncm91cCA9IG91dHJvcztcbiAgICAgICAgICAgIG91dHJvcy5yICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJ1bm5pbmdfcHJvZ3JhbSkge1xuICAgICAgICAgICAgcGVuZGluZ19wcm9ncmFtID0gcHJvZ3JhbTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIC8vIGlmIHRoaXMgaXMgYW4gaW50cm8sIGFuZCB0aGVyZSdzIGEgZGVsYXksIHdlIG5lZWQgdG8gZG9cbiAgICAgICAgICAgIC8vIGFuIGluaXRpYWwgdGljayBhbmQvb3IgYXBwbHkgQ1NTIGFuaW1hdGlvbiBpbW1lZGlhdGVseVxuICAgICAgICAgICAgaWYgKGNzcykge1xuICAgICAgICAgICAgICAgIGNsZWFyX2FuaW1hdGlvbigpO1xuICAgICAgICAgICAgICAgIGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgdCwgYiwgZHVyYXRpb24sIGRlbGF5LCBlYXNpbmcsIGNzcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoYilcbiAgICAgICAgICAgICAgICB0aWNrKDAsIDEpO1xuICAgICAgICAgICAgcnVubmluZ19wcm9ncmFtID0gaW5pdChwcm9ncmFtLCBkdXJhdGlvbik7XG4gICAgICAgICAgICBhZGRfcmVuZGVyX2NhbGxiYWNrKCgpID0+IGRpc3BhdGNoKG5vZGUsIGIsICdzdGFydCcpKTtcbiAgICAgICAgICAgIGxvb3Aobm93ID0+IHtcbiAgICAgICAgICAgICAgICBpZiAocGVuZGluZ19wcm9ncmFtICYmIG5vdyA+IHBlbmRpbmdfcHJvZ3JhbS5zdGFydCkge1xuICAgICAgICAgICAgICAgICAgICBydW5uaW5nX3Byb2dyYW0gPSBpbml0KHBlbmRpbmdfcHJvZ3JhbSwgZHVyYXRpb24pO1xuICAgICAgICAgICAgICAgICAgICBwZW5kaW5nX3Byb2dyYW0gPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICBkaXNwYXRjaChub2RlLCBydW5uaW5nX3Byb2dyYW0uYiwgJ3N0YXJ0Jyk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsZWFyX2FuaW1hdGlvbigpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYW5pbWF0aW9uX25hbWUgPSBjcmVhdGVfcnVsZShub2RlLCB0LCBydW5uaW5nX3Byb2dyYW0uYiwgcnVubmluZ19wcm9ncmFtLmR1cmF0aW9uLCAwLCBlYXNpbmcsIGNvbmZpZy5jc3MpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChydW5uaW5nX3Byb2dyYW0pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG5vdyA+PSBydW5uaW5nX3Byb2dyYW0uZW5kKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aWNrKHQgPSBydW5uaW5nX3Byb2dyYW0uYiwgMSAtIHQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGlzcGF0Y2gobm9kZSwgcnVubmluZ19wcm9ncmFtLmIsICdlbmQnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghcGVuZGluZ19wcm9ncmFtKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gd2UncmUgZG9uZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChydW5uaW5nX3Byb2dyYW0uYikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBpbnRybyDigJQgd2UgY2FuIHRpZHkgdXAgaW1tZWRpYXRlbHlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xlYXJfYW5pbWF0aW9uKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBvdXRybyDigJQgbmVlZHMgdG8gYmUgY29vcmRpbmF0ZWRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCEtLXJ1bm5pbmdfcHJvZ3JhbS5ncm91cC5yKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcnVuX2FsbChydW5uaW5nX3Byb2dyYW0uZ3JvdXAuYyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgcnVubmluZ19wcm9ncmFtID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBlbHNlIGlmIChub3cgPj0gcnVubmluZ19wcm9ncmFtLnN0YXJ0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwID0gbm93IC0gcnVubmluZ19wcm9ncmFtLnN0YXJ0O1xuICAgICAgICAgICAgICAgICAgICAgICAgdCA9IHJ1bm5pbmdfcHJvZ3JhbS5hICsgcnVubmluZ19wcm9ncmFtLmQgKiBlYXNpbmcocCAvIHJ1bm5pbmdfcHJvZ3JhbS5kdXJhdGlvbik7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aWNrKHQsIDEgLSB0KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gISEocnVubmluZ19wcm9ncmFtIHx8IHBlbmRpbmdfcHJvZ3JhbSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgICBydW4oYikge1xuICAgICAgICAgICAgaWYgKGlzX2Z1bmN0aW9uKGNvbmZpZykpIHtcbiAgICAgICAgICAgICAgICB3YWl0KCkudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICAgICAgICAgICAgY29uZmlnID0gY29uZmlnKCk7XG4gICAgICAgICAgICAgICAgICAgIGdvKGIpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgZ28oYik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIGVuZCgpIHtcbiAgICAgICAgICAgIGNsZWFyX2FuaW1hdGlvbigpO1xuICAgICAgICAgICAgcnVubmluZ19wcm9ncmFtID0gcGVuZGluZ19wcm9ncmFtID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGhhbmRsZV9wcm9taXNlKHByb21pc2UsIGluZm8pIHtcbiAgICBjb25zdCB0b2tlbiA9IGluZm8udG9rZW4gPSB7fTtcbiAgICBmdW5jdGlvbiB1cGRhdGUodHlwZSwgaW5kZXgsIGtleSwgdmFsdWUpIHtcbiAgICAgICAgaWYgKGluZm8udG9rZW4gIT09IHRva2VuKVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICBpbmZvLnJlc29sdmVkID0gdmFsdWU7XG4gICAgICAgIGxldCBjaGlsZF9jdHggPSBpbmZvLmN0eDtcbiAgICAgICAgaWYgKGtleSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjaGlsZF9jdHggPSBjaGlsZF9jdHguc2xpY2UoKTtcbiAgICAgICAgICAgIGNoaWxkX2N0eFtrZXldID0gdmFsdWU7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYmxvY2sgPSB0eXBlICYmIChpbmZvLmN1cnJlbnQgPSB0eXBlKShjaGlsZF9jdHgpO1xuICAgICAgICBsZXQgbmVlZHNfZmx1c2ggPSBmYWxzZTtcbiAgICAgICAgaWYgKGluZm8uYmxvY2spIHtcbiAgICAgICAgICAgIGlmIChpbmZvLmJsb2Nrcykge1xuICAgICAgICAgICAgICAgIGluZm8uYmxvY2tzLmZvckVhY2goKGJsb2NrLCBpKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChpICE9PSBpbmRleCAmJiBibG9jaykge1xuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBfb3V0cm9zKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cmFuc2l0aW9uX291dChibG9jaywgMSwgMSwgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uYmxvY2tzW2ldID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgY2hlY2tfb3V0cm9zKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIGluZm8uYmxvY2suZCgxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJsb2NrLmMoKTtcbiAgICAgICAgICAgIHRyYW5zaXRpb25faW4oYmxvY2ssIDEpO1xuICAgICAgICAgICAgYmxvY2subShpbmZvLm1vdW50KCksIGluZm8uYW5jaG9yKTtcbiAgICAgICAgICAgIG5lZWRzX2ZsdXNoID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpbmZvLmJsb2NrID0gYmxvY2s7XG4gICAgICAgIGlmIChpbmZvLmJsb2NrcylcbiAgICAgICAgICAgIGluZm8uYmxvY2tzW2luZGV4XSA9IGJsb2NrO1xuICAgICAgICBpZiAobmVlZHNfZmx1c2gpIHtcbiAgICAgICAgICAgIGZsdXNoKCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKGlzX3Byb21pc2UocHJvbWlzZSkpIHtcbiAgICAgICAgY29uc3QgY3VycmVudF9jb21wb25lbnQgPSBnZXRfY3VycmVudF9jb21wb25lbnQoKTtcbiAgICAgICAgcHJvbWlzZS50aGVuKHZhbHVlID0+IHtcbiAgICAgICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChjdXJyZW50X2NvbXBvbmVudCk7XG4gICAgICAgICAgICB1cGRhdGUoaW5mby50aGVuLCAxLCBpbmZvLnZhbHVlLCB2YWx1ZSk7XG4gICAgICAgICAgICBzZXRfY3VycmVudF9jb21wb25lbnQobnVsbCk7XG4gICAgICAgIH0sIGVycm9yID0+IHtcbiAgICAgICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChjdXJyZW50X2NvbXBvbmVudCk7XG4gICAgICAgICAgICB1cGRhdGUoaW5mby5jYXRjaCwgMiwgaW5mby5lcnJvciwgZXJyb3IpO1xuICAgICAgICAgICAgc2V0X2N1cnJlbnRfY29tcG9uZW50KG51bGwpO1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gaWYgd2UgcHJldmlvdXNseSBoYWQgYSB0aGVuL2NhdGNoIGJsb2NrLCBkZXN0cm95IGl0XG4gICAgICAgIGlmIChpbmZvLmN1cnJlbnQgIT09IGluZm8ucGVuZGluZykge1xuICAgICAgICAgICAgdXBkYXRlKGluZm8ucGVuZGluZywgMCk7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgaWYgKGluZm8uY3VycmVudCAhPT0gaW5mby50aGVuKSB7XG4gICAgICAgICAgICB1cGRhdGUoaW5mby50aGVuLCAxLCBpbmZvLnZhbHVlLCBwcm9taXNlKTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGluZm8ucmVzb2x2ZWQgPSBwcm9taXNlO1xuICAgIH1cbn1cblxuY29uc3QgZ2xvYmFscyA9ICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJ1xuICAgID8gd2luZG93XG4gICAgOiB0eXBlb2YgZ2xvYmFsVGhpcyAhPT0gJ3VuZGVmaW5lZCdcbiAgICAgICAgPyBnbG9iYWxUaGlzXG4gICAgICAgIDogZ2xvYmFsKTtcblxuZnVuY3Rpb24gZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKSB7XG4gICAgYmxvY2suZCgxKTtcbiAgICBsb29rdXAuZGVsZXRlKGJsb2NrLmtleSk7XG59XG5mdW5jdGlvbiBvdXRyb19hbmRfZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKSB7XG4gICAgdHJhbnNpdGlvbl9vdXQoYmxvY2ssIDEsIDEsICgpID0+IHtcbiAgICAgICAgbG9va3VwLmRlbGV0ZShibG9jay5rZXkpO1xuICAgIH0pO1xufVxuZnVuY3Rpb24gZml4X2FuZF9kZXN0cm95X2Jsb2NrKGJsb2NrLCBsb29rdXApIHtcbiAgICBibG9jay5mKCk7XG4gICAgZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKTtcbn1cbmZ1bmN0aW9uIGZpeF9hbmRfb3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCkge1xuICAgIGJsb2NrLmYoKTtcbiAgICBvdXRyb19hbmRfZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKTtcbn1cbmZ1bmN0aW9uIHVwZGF0ZV9rZXllZF9lYWNoKG9sZF9ibG9ja3MsIGRpcnR5LCBnZXRfa2V5LCBkeW5hbWljLCBjdHgsIGxpc3QsIGxvb2t1cCwgbm9kZSwgZGVzdHJveSwgY3JlYXRlX2VhY2hfYmxvY2ssIG5leHQsIGdldF9jb250ZXh0KSB7XG4gICAgbGV0IG8gPSBvbGRfYmxvY2tzLmxlbmd0aDtcbiAgICBsZXQgbiA9IGxpc3QubGVuZ3RoO1xuICAgIGxldCBpID0gbztcbiAgICBjb25zdCBvbGRfaW5kZXhlcyA9IHt9O1xuICAgIHdoaWxlIChpLS0pXG4gICAgICAgIG9sZF9pbmRleGVzW29sZF9ibG9ja3NbaV0ua2V5XSA9IGk7XG4gICAgY29uc3QgbmV3X2Jsb2NrcyA9IFtdO1xuICAgIGNvbnN0IG5ld19sb29rdXAgPSBuZXcgTWFwKCk7XG4gICAgY29uc3QgZGVsdGFzID0gbmV3IE1hcCgpO1xuICAgIGkgPSBuO1xuICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgY29uc3QgY2hpbGRfY3R4ID0gZ2V0X2NvbnRleHQoY3R4LCBsaXN0LCBpKTtcbiAgICAgICAgY29uc3Qga2V5ID0gZ2V0X2tleShjaGlsZF9jdHgpO1xuICAgICAgICBsZXQgYmxvY2sgPSBsb29rdXAuZ2V0KGtleSk7XG4gICAgICAgIGlmICghYmxvY2spIHtcbiAgICAgICAgICAgIGJsb2NrID0gY3JlYXRlX2VhY2hfYmxvY2soa2V5LCBjaGlsZF9jdHgpO1xuICAgICAgICAgICAgYmxvY2suYygpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGR5bmFtaWMpIHtcbiAgICAgICAgICAgIGJsb2NrLnAoY2hpbGRfY3R4LCBkaXJ0eSk7XG4gICAgICAgIH1cbiAgICAgICAgbmV3X2xvb2t1cC5zZXQoa2V5LCBuZXdfYmxvY2tzW2ldID0gYmxvY2spO1xuICAgICAgICBpZiAoa2V5IGluIG9sZF9pbmRleGVzKVxuICAgICAgICAgICAgZGVsdGFzLnNldChrZXksIE1hdGguYWJzKGkgLSBvbGRfaW5kZXhlc1trZXldKSk7XG4gICAgfVxuICAgIGNvbnN0IHdpbGxfbW92ZSA9IG5ldyBTZXQoKTtcbiAgICBjb25zdCBkaWRfbW92ZSA9IG5ldyBTZXQoKTtcbiAgICBmdW5jdGlvbiBpbnNlcnQoYmxvY2spIHtcbiAgICAgICAgdHJhbnNpdGlvbl9pbihibG9jaywgMSk7XG4gICAgICAgIGJsb2NrLm0obm9kZSwgbmV4dCk7XG4gICAgICAgIGxvb2t1cC5zZXQoYmxvY2sua2V5LCBibG9jayk7XG4gICAgICAgIG5leHQgPSBibG9jay5maXJzdDtcbiAgICAgICAgbi0tO1xuICAgIH1cbiAgICB3aGlsZSAobyAmJiBuKSB7XG4gICAgICAgIGNvbnN0IG5ld19ibG9jayA9IG5ld19ibG9ja3NbbiAtIDFdO1xuICAgICAgICBjb25zdCBvbGRfYmxvY2sgPSBvbGRfYmxvY2tzW28gLSAxXTtcbiAgICAgICAgY29uc3QgbmV3X2tleSA9IG5ld19ibG9jay5rZXk7XG4gICAgICAgIGNvbnN0IG9sZF9rZXkgPSBvbGRfYmxvY2sua2V5O1xuICAgICAgICBpZiAobmV3X2Jsb2NrID09PSBvbGRfYmxvY2spIHtcbiAgICAgICAgICAgIC8vIGRvIG5vdGhpbmdcbiAgICAgICAgICAgIG5leHQgPSBuZXdfYmxvY2suZmlyc3Q7XG4gICAgICAgICAgICBvLS07XG4gICAgICAgICAgICBuLS07XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoIW5ld19sb29rdXAuaGFzKG9sZF9rZXkpKSB7XG4gICAgICAgICAgICAvLyByZW1vdmUgb2xkIGJsb2NrXG4gICAgICAgICAgICBkZXN0cm95KG9sZF9ibG9jaywgbG9va3VwKTtcbiAgICAgICAgICAgIG8tLTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmICghbG9va3VwLmhhcyhuZXdfa2V5KSB8fCB3aWxsX21vdmUuaGFzKG5ld19rZXkpKSB7XG4gICAgICAgICAgICBpbnNlcnQobmV3X2Jsb2NrKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChkaWRfbW92ZS5oYXMob2xkX2tleSkpIHtcbiAgICAgICAgICAgIG8tLTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChkZWx0YXMuZ2V0KG5ld19rZXkpID4gZGVsdGFzLmdldChvbGRfa2V5KSkge1xuICAgICAgICAgICAgZGlkX21vdmUuYWRkKG5ld19rZXkpO1xuICAgICAgICAgICAgaW5zZXJ0KG5ld19ibG9jayk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB3aWxsX21vdmUuYWRkKG9sZF9rZXkpO1xuICAgICAgICAgICAgby0tO1xuICAgICAgICB9XG4gICAgfVxuICAgIHdoaWxlIChvLS0pIHtcbiAgICAgICAgY29uc3Qgb2xkX2Jsb2NrID0gb2xkX2Jsb2Nrc1tvXTtcbiAgICAgICAgaWYgKCFuZXdfbG9va3VwLmhhcyhvbGRfYmxvY2sua2V5KSlcbiAgICAgICAgICAgIGRlc3Ryb3kob2xkX2Jsb2NrLCBsb29rdXApO1xuICAgIH1cbiAgICB3aGlsZSAobilcbiAgICAgICAgaW5zZXJ0KG5ld19ibG9ja3NbbiAtIDFdKTtcbiAgICByZXR1cm4gbmV3X2Jsb2Nrcztcbn1cbmZ1bmN0aW9uIHZhbGlkYXRlX2VhY2hfa2V5cyhjdHgsIGxpc3QsIGdldF9jb250ZXh0LCBnZXRfa2V5KSB7XG4gICAgY29uc3Qga2V5cyA9IG5ldyBTZXQoKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3Qga2V5ID0gZ2V0X2tleShnZXRfY29udGV4dChjdHgsIGxpc3QsIGkpKTtcbiAgICAgICAgaWYgKGtleXMuaGFzKGtleSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGhhdmUgZHVwbGljYXRlIGtleXMgaW4gYSBrZXllZCBlYWNoYCk7XG4gICAgICAgIH1cbiAgICAgICAga2V5cy5hZGQoa2V5KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGdldF9zcHJlYWRfdXBkYXRlKGxldmVscywgdXBkYXRlcykge1xuICAgIGNvbnN0IHVwZGF0ZSA9IHt9O1xuICAgIGNvbnN0IHRvX251bGxfb3V0ID0ge307XG4gICAgY29uc3QgYWNjb3VudGVkX2ZvciA9IHsgJCRzY29wZTogMSB9O1xuICAgIGxldCBpID0gbGV2ZWxzLmxlbmd0aDtcbiAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgIGNvbnN0IG8gPSBsZXZlbHNbaV07XG4gICAgICAgIGNvbnN0IG4gPSB1cGRhdGVzW2ldO1xuICAgICAgICBpZiAobikge1xuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gbykge1xuICAgICAgICAgICAgICAgIGlmICghKGtleSBpbiBuKSlcbiAgICAgICAgICAgICAgICAgICAgdG9fbnVsbF9vdXRba2V5XSA9IDE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBuKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFhY2NvdW50ZWRfZm9yW2tleV0pIHtcbiAgICAgICAgICAgICAgICAgICAgdXBkYXRlW2tleV0gPSBuW2tleV07XG4gICAgICAgICAgICAgICAgICAgIGFjY291bnRlZF9mb3Jba2V5XSA9IDE7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbGV2ZWxzW2ldID0gbjtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIG8pIHtcbiAgICAgICAgICAgICAgICBhY2NvdW50ZWRfZm9yW2tleV0gPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIGZvciAoY29uc3Qga2V5IGluIHRvX251bGxfb3V0KSB7XG4gICAgICAgIGlmICghKGtleSBpbiB1cGRhdGUpKVxuICAgICAgICAgICAgdXBkYXRlW2tleV0gPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIHJldHVybiB1cGRhdGU7XG59XG5mdW5jdGlvbiBnZXRfc3ByZWFkX29iamVjdChzcHJlYWRfcHJvcHMpIHtcbiAgICByZXR1cm4gdHlwZW9mIHNwcmVhZF9wcm9wcyA9PT0gJ29iamVjdCcgJiYgc3ByZWFkX3Byb3BzICE9PSBudWxsID8gc3ByZWFkX3Byb3BzIDoge307XG59XG5cbi8vIHNvdXJjZTogaHR0cHM6Ly9odG1sLnNwZWMud2hhdHdnLm9yZy9tdWx0aXBhZ2UvaW5kaWNlcy5odG1sXG5jb25zdCBib29sZWFuX2F0dHJpYnV0ZXMgPSBuZXcgU2V0KFtcbiAgICAnYWxsb3dmdWxsc2NyZWVuJyxcbiAgICAnYWxsb3dwYXltZW50cmVxdWVzdCcsXG4gICAgJ2FzeW5jJyxcbiAgICAnYXV0b2ZvY3VzJyxcbiAgICAnYXV0b3BsYXknLFxuICAgICdjaGVja2VkJyxcbiAgICAnY29udHJvbHMnLFxuICAgICdkZWZhdWx0JyxcbiAgICAnZGVmZXInLFxuICAgICdkaXNhYmxlZCcsXG4gICAgJ2Zvcm1ub3ZhbGlkYXRlJyxcbiAgICAnaGlkZGVuJyxcbiAgICAnaXNtYXAnLFxuICAgICdsb29wJyxcbiAgICAnbXVsdGlwbGUnLFxuICAgICdtdXRlZCcsXG4gICAgJ25vbW9kdWxlJyxcbiAgICAnbm92YWxpZGF0ZScsXG4gICAgJ29wZW4nLFxuICAgICdwbGF5c2lubGluZScsXG4gICAgJ3JlYWRvbmx5JyxcbiAgICAncmVxdWlyZWQnLFxuICAgICdyZXZlcnNlZCcsXG4gICAgJ3NlbGVjdGVkJ1xuXSk7XG5cbmNvbnN0IGludmFsaWRfYXR0cmlidXRlX25hbWVfY2hhcmFjdGVyID0gL1tcXHMnXCI+Lz1cXHV7RkREMH0tXFx1e0ZERUZ9XFx1e0ZGRkV9XFx1e0ZGRkZ9XFx1ezFGRkZFfVxcdXsxRkZGRn1cXHV7MkZGRkV9XFx1ezJGRkZGfVxcdXszRkZGRX1cXHV7M0ZGRkZ9XFx1ezRGRkZFfVxcdXs0RkZGRn1cXHV7NUZGRkV9XFx1ezVGRkZGfVxcdXs2RkZGRX1cXHV7NkZGRkZ9XFx1ezdGRkZFfVxcdXs3RkZGRn1cXHV7OEZGRkV9XFx1ezhGRkZGfVxcdXs5RkZGRX1cXHV7OUZGRkZ9XFx1e0FGRkZFfVxcdXtBRkZGRn1cXHV7QkZGRkV9XFx1e0JGRkZGfVxcdXtDRkZGRX1cXHV7Q0ZGRkZ9XFx1e0RGRkZFfVxcdXtERkZGRn1cXHV7RUZGRkV9XFx1e0VGRkZGfVxcdXtGRkZGRX1cXHV7RkZGRkZ9XFx1ezEwRkZGRX1cXHV7MTBGRkZGfV0vdTtcbi8vIGh0dHBzOi8vaHRtbC5zcGVjLndoYXR3Zy5vcmcvbXVsdGlwYWdlL3N5bnRheC5odG1sI2F0dHJpYnV0ZXMtMlxuLy8gaHR0cHM6Ly9pbmZyYS5zcGVjLndoYXR3Zy5vcmcvI25vbmNoYXJhY3RlclxuZnVuY3Rpb24gc3ByZWFkKGFyZ3MsIGNsYXNzZXNfdG9fYWRkKSB7XG4gICAgY29uc3QgYXR0cmlidXRlcyA9IE9iamVjdC5hc3NpZ24oe30sIC4uLmFyZ3MpO1xuICAgIGlmIChjbGFzc2VzX3RvX2FkZCkge1xuICAgICAgICBpZiAoYXR0cmlidXRlcy5jbGFzcyA9PSBudWxsKSB7XG4gICAgICAgICAgICBhdHRyaWJ1dGVzLmNsYXNzID0gY2xhc3Nlc190b19hZGQ7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBhdHRyaWJ1dGVzLmNsYXNzICs9ICcgJyArIGNsYXNzZXNfdG9fYWRkO1xuICAgICAgICB9XG4gICAgfVxuICAgIGxldCBzdHIgPSAnJztcbiAgICBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKS5mb3JFYWNoKG5hbWUgPT4ge1xuICAgICAgICBpZiAoaW52YWxpZF9hdHRyaWJ1dGVfbmFtZV9jaGFyYWN0ZXIudGVzdChuYW1lKSlcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgY29uc3QgdmFsdWUgPSBhdHRyaWJ1dGVzW25hbWVdO1xuICAgICAgICBpZiAodmFsdWUgPT09IHRydWUpXG4gICAgICAgICAgICBzdHIgKz0gXCIgXCIgKyBuYW1lO1xuICAgICAgICBlbHNlIGlmIChib29sZWFuX2F0dHJpYnV0ZXMuaGFzKG5hbWUudG9Mb3dlckNhc2UoKSkpIHtcbiAgICAgICAgICAgIGlmICh2YWx1ZSlcbiAgICAgICAgICAgICAgICBzdHIgKz0gXCIgXCIgKyBuYW1lO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHZhbHVlICE9IG51bGwpIHtcbiAgICAgICAgICAgIHN0ciArPSBgICR7bmFtZX09XCIke1N0cmluZyh2YWx1ZSkucmVwbGFjZSgvXCIvZywgJyYjMzQ7JykucmVwbGFjZSgvJy9nLCAnJiMzOTsnKX1cImA7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gc3RyO1xufVxuY29uc3QgZXNjYXBlZCA9IHtcbiAgICAnXCInOiAnJnF1b3Q7JyxcbiAgICBcIidcIjogJyYjMzk7JyxcbiAgICAnJic6ICcmYW1wOycsXG4gICAgJzwnOiAnJmx0OycsXG4gICAgJz4nOiAnJmd0Oydcbn07XG5mdW5jdGlvbiBlc2NhcGUoaHRtbCkge1xuICAgIHJldHVybiBTdHJpbmcoaHRtbCkucmVwbGFjZSgvW1wiJyY8Pl0vZywgbWF0Y2ggPT4gZXNjYXBlZFttYXRjaF0pO1xufVxuZnVuY3Rpb24gZWFjaChpdGVtcywgZm4pIHtcbiAgICBsZXQgc3RyID0gJyc7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBpdGVtcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBzdHIgKz0gZm4oaXRlbXNbaV0sIGkpO1xuICAgIH1cbiAgICByZXR1cm4gc3RyO1xufVxuY29uc3QgbWlzc2luZ19jb21wb25lbnQgPSB7XG4gICAgJCRyZW5kZXI6ICgpID0+ICcnXG59O1xuZnVuY3Rpb24gdmFsaWRhdGVfY29tcG9uZW50KGNvbXBvbmVudCwgbmFtZSkge1xuICAgIGlmICghY29tcG9uZW50IHx8ICFjb21wb25lbnQuJCRyZW5kZXIpIHtcbiAgICAgICAgaWYgKG5hbWUgPT09ICdzdmVsdGU6Y29tcG9uZW50JylcbiAgICAgICAgICAgIG5hbWUgKz0gJyB0aGlzPXsuLi59JztcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGA8JHtuYW1lfT4gaXMgbm90IGEgdmFsaWQgU1NSIGNvbXBvbmVudC4gWW91IG1heSBuZWVkIHRvIHJldmlldyB5b3VyIGJ1aWxkIGNvbmZpZyB0byBlbnN1cmUgdGhhdCBkZXBlbmRlbmNpZXMgYXJlIGNvbXBpbGVkLCByYXRoZXIgdGhhbiBpbXBvcnRlZCBhcyBwcmUtY29tcGlsZWQgbW9kdWxlc2ApO1xuICAgIH1cbiAgICByZXR1cm4gY29tcG9uZW50O1xufVxuZnVuY3Rpb24gZGVidWcoZmlsZSwgbGluZSwgY29sdW1uLCB2YWx1ZXMpIHtcbiAgICBjb25zb2xlLmxvZyhge0BkZWJ1Z30gJHtmaWxlID8gZmlsZSArICcgJyA6ICcnfSgke2xpbmV9OiR7Y29sdW1ufSlgKTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1jb25zb2xlXG4gICAgY29uc29sZS5sb2codmFsdWVzKTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1jb25zb2xlXG4gICAgcmV0dXJuICcnO1xufVxubGV0IG9uX2Rlc3Ryb3k7XG5mdW5jdGlvbiBjcmVhdGVfc3NyX2NvbXBvbmVudChmbikge1xuICAgIGZ1bmN0aW9uICQkcmVuZGVyKHJlc3VsdCwgcHJvcHMsIGJpbmRpbmdzLCBzbG90cykge1xuICAgICAgICBjb25zdCBwYXJlbnRfY29tcG9uZW50ID0gY3VycmVudF9jb21wb25lbnQ7XG4gICAgICAgIGNvbnN0ICQkID0ge1xuICAgICAgICAgICAgb25fZGVzdHJveSxcbiAgICAgICAgICAgIGNvbnRleHQ6IG5ldyBNYXAocGFyZW50X2NvbXBvbmVudCA/IHBhcmVudF9jb21wb25lbnQuJCQuY29udGV4dCA6IFtdKSxcbiAgICAgICAgICAgIC8vIHRoZXNlIHdpbGwgYmUgaW1tZWRpYXRlbHkgZGlzY2FyZGVkXG4gICAgICAgICAgICBvbl9tb3VudDogW10sXG4gICAgICAgICAgICBiZWZvcmVfdXBkYXRlOiBbXSxcbiAgICAgICAgICAgIGFmdGVyX3VwZGF0ZTogW10sXG4gICAgICAgICAgICBjYWxsYmFja3M6IGJsYW5rX29iamVjdCgpXG4gICAgICAgIH07XG4gICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudCh7ICQkIH0pO1xuICAgICAgICBjb25zdCBodG1sID0gZm4ocmVzdWx0LCBwcm9wcywgYmluZGluZ3MsIHNsb3RzKTtcbiAgICAgICAgc2V0X2N1cnJlbnRfY29tcG9uZW50KHBhcmVudF9jb21wb25lbnQpO1xuICAgICAgICByZXR1cm4gaHRtbDtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgICAgcmVuZGVyOiAocHJvcHMgPSB7fSwgb3B0aW9ucyA9IHt9KSA9PiB7XG4gICAgICAgICAgICBvbl9kZXN0cm95ID0gW107XG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSB7IHRpdGxlOiAnJywgaGVhZDogJycsIGNzczogbmV3IFNldCgpIH07XG4gICAgICAgICAgICBjb25zdCBodG1sID0gJCRyZW5kZXIocmVzdWx0LCBwcm9wcywge30sIG9wdGlvbnMpO1xuICAgICAgICAgICAgcnVuX2FsbChvbl9kZXN0cm95KTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgaHRtbCxcbiAgICAgICAgICAgICAgICBjc3M6IHtcbiAgICAgICAgICAgICAgICAgICAgY29kZTogQXJyYXkuZnJvbShyZXN1bHQuY3NzKS5tYXAoY3NzID0+IGNzcy5jb2RlKS5qb2luKCdcXG4nKSxcbiAgICAgICAgICAgICAgICAgICAgbWFwOiBudWxsIC8vIFRPRE9cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGhlYWQ6IHJlc3VsdC50aXRsZSArIHJlc3VsdC5oZWFkXG4gICAgICAgICAgICB9O1xuICAgICAgICB9LFxuICAgICAgICAkJHJlbmRlclxuICAgIH07XG59XG5mdW5jdGlvbiBhZGRfYXR0cmlidXRlKG5hbWUsIHZhbHVlLCBib29sZWFuKSB7XG4gICAgaWYgKHZhbHVlID09IG51bGwgfHwgKGJvb2xlYW4gJiYgIXZhbHVlKSlcbiAgICAgICAgcmV0dXJuICcnO1xuICAgIHJldHVybiBgICR7bmFtZX0ke3ZhbHVlID09PSB0cnVlID8gJycgOiBgPSR7dHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyA/IEpTT04uc3RyaW5naWZ5KGVzY2FwZSh2YWx1ZSkpIDogYFwiJHt2YWx1ZX1cImB9YH1gO1xufVxuZnVuY3Rpb24gYWRkX2NsYXNzZXMoY2xhc3Nlcykge1xuICAgIHJldHVybiBjbGFzc2VzID8gYCBjbGFzcz1cIiR7Y2xhc3Nlc31cImAgOiBgYDtcbn1cblxuZnVuY3Rpb24gYmluZChjb21wb25lbnQsIG5hbWUsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgaW5kZXggPSBjb21wb25lbnQuJCQucHJvcHNbbmFtZV07XG4gICAgaWYgKGluZGV4ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY29tcG9uZW50LiQkLmJvdW5kW2luZGV4XSA9IGNhbGxiYWNrO1xuICAgICAgICBjYWxsYmFjayhjb21wb25lbnQuJCQuY3R4W2luZGV4XSk7XG4gICAgfVxufVxuZnVuY3Rpb24gY3JlYXRlX2NvbXBvbmVudChibG9jaykge1xuICAgIGJsb2NrICYmIGJsb2NrLmMoKTtcbn1cbmZ1bmN0aW9uIGNsYWltX2NvbXBvbmVudChibG9jaywgcGFyZW50X25vZGVzKSB7XG4gICAgYmxvY2sgJiYgYmxvY2subChwYXJlbnRfbm9kZXMpO1xufVxuZnVuY3Rpb24gbW91bnRfY29tcG9uZW50KGNvbXBvbmVudCwgdGFyZ2V0LCBhbmNob3IpIHtcbiAgICBjb25zdCB7IGZyYWdtZW50LCBvbl9tb3VudCwgb25fZGVzdHJveSwgYWZ0ZXJfdXBkYXRlIH0gPSBjb21wb25lbnQuJCQ7XG4gICAgZnJhZ21lbnQgJiYgZnJhZ21lbnQubSh0YXJnZXQsIGFuY2hvcik7XG4gICAgLy8gb25Nb3VudCBoYXBwZW5zIGJlZm9yZSB0aGUgaW5pdGlhbCBhZnRlclVwZGF0ZVxuICAgIGFkZF9yZW5kZXJfY2FsbGJhY2soKCkgPT4ge1xuICAgICAgICBjb25zdCBuZXdfb25fZGVzdHJveSA9IG9uX21vdW50Lm1hcChydW4pLmZpbHRlcihpc19mdW5jdGlvbik7XG4gICAgICAgIGlmIChvbl9kZXN0cm95KSB7XG4gICAgICAgICAgICBvbl9kZXN0cm95LnB1c2goLi4ubmV3X29uX2Rlc3Ryb3kpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy8gRWRnZSBjYXNlIC0gY29tcG9uZW50IHdhcyBkZXN0cm95ZWQgaW1tZWRpYXRlbHksXG4gICAgICAgICAgICAvLyBtb3N0IGxpa2VseSBhcyBhIHJlc3VsdCBvZiBhIGJpbmRpbmcgaW5pdGlhbGlzaW5nXG4gICAgICAgICAgICBydW5fYWxsKG5ld19vbl9kZXN0cm95KTtcbiAgICAgICAgfVxuICAgICAgICBjb21wb25lbnQuJCQub25fbW91bnQgPSBbXTtcbiAgICB9KTtcbiAgICBhZnRlcl91cGRhdGUuZm9yRWFjaChhZGRfcmVuZGVyX2NhbGxiYWNrKTtcbn1cbmZ1bmN0aW9uIGRlc3Ryb3lfY29tcG9uZW50KGNvbXBvbmVudCwgZGV0YWNoaW5nKSB7XG4gICAgY29uc3QgJCQgPSBjb21wb25lbnQuJCQ7XG4gICAgaWYgKCQkLmZyYWdtZW50ICE9PSBudWxsKSB7XG4gICAgICAgIHJ1bl9hbGwoJCQub25fZGVzdHJveSk7XG4gICAgICAgICQkLmZyYWdtZW50ICYmICQkLmZyYWdtZW50LmQoZGV0YWNoaW5nKTtcbiAgICAgICAgLy8gVE9ETyBudWxsIG91dCBvdGhlciByZWZzLCBpbmNsdWRpbmcgY29tcG9uZW50LiQkIChidXQgbmVlZCB0b1xuICAgICAgICAvLyBwcmVzZXJ2ZSBmaW5hbCBzdGF0ZT8pXG4gICAgICAgICQkLm9uX2Rlc3Ryb3kgPSAkJC5mcmFnbWVudCA9IG51bGw7XG4gICAgICAgICQkLmN0eCA9IFtdO1xuICAgIH1cbn1cbmZ1bmN0aW9uIG1ha2VfZGlydHkoY29tcG9uZW50LCBpKSB7XG4gICAgaWYgKGNvbXBvbmVudC4kJC5kaXJ0eVswXSA9PT0gLTEpIHtcbiAgICAgICAgZGlydHlfY29tcG9uZW50cy5wdXNoKGNvbXBvbmVudCk7XG4gICAgICAgIHNjaGVkdWxlX3VwZGF0ZSgpO1xuICAgICAgICBjb21wb25lbnQuJCQuZGlydHkuZmlsbCgwKTtcbiAgICB9XG4gICAgY29tcG9uZW50LiQkLmRpcnR5WyhpIC8gMzEpIHwgMF0gfD0gKDEgPDwgKGkgJSAzMSkpO1xufVxuZnVuY3Rpb24gaW5pdChjb21wb25lbnQsIG9wdGlvbnMsIGluc3RhbmNlLCBjcmVhdGVfZnJhZ21lbnQsIG5vdF9lcXVhbCwgcHJvcHMsIGRpcnR5ID0gWy0xXSkge1xuICAgIGNvbnN0IHBhcmVudF9jb21wb25lbnQgPSBjdXJyZW50X2NvbXBvbmVudDtcbiAgICBzZXRfY3VycmVudF9jb21wb25lbnQoY29tcG9uZW50KTtcbiAgICBjb25zdCBwcm9wX3ZhbHVlcyA9IG9wdGlvbnMucHJvcHMgfHwge307XG4gICAgY29uc3QgJCQgPSBjb21wb25lbnQuJCQgPSB7XG4gICAgICAgIGZyYWdtZW50OiBudWxsLFxuICAgICAgICBjdHg6IG51bGwsXG4gICAgICAgIC8vIHN0YXRlXG4gICAgICAgIHByb3BzLFxuICAgICAgICB1cGRhdGU6IG5vb3AsXG4gICAgICAgIG5vdF9lcXVhbCxcbiAgICAgICAgYm91bmQ6IGJsYW5rX29iamVjdCgpLFxuICAgICAgICAvLyBsaWZlY3ljbGVcbiAgICAgICAgb25fbW91bnQ6IFtdLFxuICAgICAgICBvbl9kZXN0cm95OiBbXSxcbiAgICAgICAgYmVmb3JlX3VwZGF0ZTogW10sXG4gICAgICAgIGFmdGVyX3VwZGF0ZTogW10sXG4gICAgICAgIGNvbnRleHQ6IG5ldyBNYXAocGFyZW50X2NvbXBvbmVudCA/IHBhcmVudF9jb21wb25lbnQuJCQuY29udGV4dCA6IFtdKSxcbiAgICAgICAgLy8gZXZlcnl0aGluZyBlbHNlXG4gICAgICAgIGNhbGxiYWNrczogYmxhbmtfb2JqZWN0KCksXG4gICAgICAgIGRpcnR5XG4gICAgfTtcbiAgICBsZXQgcmVhZHkgPSBmYWxzZTtcbiAgICAkJC5jdHggPSBpbnN0YW5jZVxuICAgICAgICA/IGluc3RhbmNlKGNvbXBvbmVudCwgcHJvcF92YWx1ZXMsIChpLCByZXQsIC4uLnJlc3QpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gcmVzdC5sZW5ndGggPyByZXN0WzBdIDogcmV0O1xuICAgICAgICAgICAgaWYgKCQkLmN0eCAmJiBub3RfZXF1YWwoJCQuY3R4W2ldLCAkJC5jdHhbaV0gPSB2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICBpZiAoJCQuYm91bmRbaV0pXG4gICAgICAgICAgICAgICAgICAgICQkLmJvdW5kW2ldKHZhbHVlKTtcbiAgICAgICAgICAgICAgICBpZiAocmVhZHkpXG4gICAgICAgICAgICAgICAgICAgIG1ha2VfZGlydHkoY29tcG9uZW50LCBpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiByZXQ7XG4gICAgICAgIH0pXG4gICAgICAgIDogW107XG4gICAgJCQudXBkYXRlKCk7XG4gICAgcmVhZHkgPSB0cnVlO1xuICAgIHJ1bl9hbGwoJCQuYmVmb3JlX3VwZGF0ZSk7XG4gICAgLy8gYGZhbHNlYCBhcyBhIHNwZWNpYWwgY2FzZSBvZiBubyBET00gY29tcG9uZW50XG4gICAgJCQuZnJhZ21lbnQgPSBjcmVhdGVfZnJhZ21lbnQgPyBjcmVhdGVfZnJhZ21lbnQoJCQuY3R4KSA6IGZhbHNlO1xuICAgIGlmIChvcHRpb25zLnRhcmdldCkge1xuICAgICAgICBpZiAob3B0aW9ucy5oeWRyYXRlKSB7XG4gICAgICAgICAgICBjb25zdCBub2RlcyA9IGNoaWxkcmVuKG9wdGlvbnMudGFyZ2V0KTtcbiAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbm9uLW51bGwtYXNzZXJ0aW9uXG4gICAgICAgICAgICAkJC5mcmFnbWVudCAmJiAkJC5mcmFnbWVudC5sKG5vZGVzKTtcbiAgICAgICAgICAgIG5vZGVzLmZvckVhY2goZGV0YWNoKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbm9uLW51bGwtYXNzZXJ0aW9uXG4gICAgICAgICAgICAkJC5mcmFnbWVudCAmJiAkJC5mcmFnbWVudC5jKCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG9wdGlvbnMuaW50cm8pXG4gICAgICAgICAgICB0cmFuc2l0aW9uX2luKGNvbXBvbmVudC4kJC5mcmFnbWVudCk7XG4gICAgICAgIG1vdW50X2NvbXBvbmVudChjb21wb25lbnQsIG9wdGlvbnMudGFyZ2V0LCBvcHRpb25zLmFuY2hvcik7XG4gICAgICAgIGZsdXNoKCk7XG4gICAgfVxuICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChwYXJlbnRfY29tcG9uZW50KTtcbn1cbmxldCBTdmVsdGVFbGVtZW50O1xuaWYgKHR5cGVvZiBIVE1MRWxlbWVudCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIFN2ZWx0ZUVsZW1lbnQgPSBjbGFzcyBleHRlbmRzIEhUTUxFbGVtZW50IHtcbiAgICAgICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgICAgICBzdXBlcigpO1xuICAgICAgICAgICAgdGhpcy5hdHRhY2hTaGFkb3coeyBtb2RlOiAnb3BlbicgfSk7XG4gICAgICAgIH1cbiAgICAgICAgY29ubmVjdGVkQ2FsbGJhY2soKSB7XG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlIHRvZG86IGltcHJvdmUgdHlwaW5nc1xuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gdGhpcy4kJC5zbG90dGVkKSB7XG4gICAgICAgICAgICAgICAgLy8gQHRzLWlnbm9yZSB0b2RvOiBpbXByb3ZlIHR5cGluZ3NcbiAgICAgICAgICAgICAgICB0aGlzLmFwcGVuZENoaWxkKHRoaXMuJCQuc2xvdHRlZFtrZXldKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBhdHRyaWJ1dGVDaGFuZ2VkQ2FsbGJhY2soYXR0ciwgX29sZFZhbHVlLCBuZXdWYWx1ZSkge1xuICAgICAgICAgICAgdGhpc1thdHRyXSA9IG5ld1ZhbHVlO1xuICAgICAgICB9XG4gICAgICAgICRkZXN0cm95KCkge1xuICAgICAgICAgICAgZGVzdHJveV9jb21wb25lbnQodGhpcywgMSk7XG4gICAgICAgICAgICB0aGlzLiRkZXN0cm95ID0gbm9vcDtcbiAgICAgICAgfVxuICAgICAgICAkb24odHlwZSwgY2FsbGJhY2spIHtcbiAgICAgICAgICAgIC8vIFRPRE8gc2hvdWxkIHRoaXMgZGVsZWdhdGUgdG8gYWRkRXZlbnRMaXN0ZW5lcj9cbiAgICAgICAgICAgIGNvbnN0IGNhbGxiYWNrcyA9ICh0aGlzLiQkLmNhbGxiYWNrc1t0eXBlXSB8fCAodGhpcy4kJC5jYWxsYmFja3NbdHlwZV0gPSBbXSkpO1xuICAgICAgICAgICAgY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spO1xuICAgICAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBpbmRleCA9IGNhbGxiYWNrcy5pbmRleE9mKGNhbGxiYWNrKTtcbiAgICAgICAgICAgICAgICBpZiAoaW5kZXggIT09IC0xKVxuICAgICAgICAgICAgICAgICAgICBjYWxsYmFja3Muc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgJHNldCgpIHtcbiAgICAgICAgICAgIC8vIG92ZXJyaWRkZW4gYnkgaW5zdGFuY2UsIGlmIGl0IGhhcyBwcm9wc1xuICAgICAgICB9XG4gICAgfTtcbn1cbmNsYXNzIFN2ZWx0ZUNvbXBvbmVudCB7XG4gICAgJGRlc3Ryb3koKSB7XG4gICAgICAgIGRlc3Ryb3lfY29tcG9uZW50KHRoaXMsIDEpO1xuICAgICAgICB0aGlzLiRkZXN0cm95ID0gbm9vcDtcbiAgICB9XG4gICAgJG9uKHR5cGUsIGNhbGxiYWNrKSB7XG4gICAgICAgIGNvbnN0IGNhbGxiYWNrcyA9ICh0aGlzLiQkLmNhbGxiYWNrc1t0eXBlXSB8fCAodGhpcy4kJC5jYWxsYmFja3NbdHlwZV0gPSBbXSkpO1xuICAgICAgICBjYWxsYmFja3MucHVzaChjYWxsYmFjayk7XG4gICAgICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBpbmRleCA9IGNhbGxiYWNrcy5pbmRleE9mKGNhbGxiYWNrKTtcbiAgICAgICAgICAgIGlmIChpbmRleCAhPT0gLTEpXG4gICAgICAgICAgICAgICAgY2FsbGJhY2tzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIH07XG4gICAgfVxuICAgICRzZXQoKSB7XG4gICAgICAgIC8vIG92ZXJyaWRkZW4gYnkgaW5zdGFuY2UsIGlmIGl0IGhhcyBwcm9wc1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZGlzcGF0Y2hfZGV2KHR5cGUsIGRldGFpbCkge1xuICAgIGRvY3VtZW50LmRpc3BhdGNoRXZlbnQoY3VzdG9tX2V2ZW50KHR5cGUsIE9iamVjdC5hc3NpZ24oeyB2ZXJzaW9uOiAnMy4yMy4wJyB9LCBkZXRhaWwpKSk7XG59XG5mdW5jdGlvbiBhcHBlbmRfZGV2KHRhcmdldCwgbm9kZSkge1xuICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTUluc2VydFwiLCB7IHRhcmdldCwgbm9kZSB9KTtcbiAgICBhcHBlbmQodGFyZ2V0LCBub2RlKTtcbn1cbmZ1bmN0aW9uIGluc2VydF9kZXYodGFyZ2V0LCBub2RlLCBhbmNob3IpIHtcbiAgICBkaXNwYXRjaF9kZXYoXCJTdmVsdGVET01JbnNlcnRcIiwgeyB0YXJnZXQsIG5vZGUsIGFuY2hvciB9KTtcbiAgICBpbnNlcnQodGFyZ2V0LCBub2RlLCBhbmNob3IpO1xufVxuZnVuY3Rpb24gZGV0YWNoX2Rldihub2RlKSB7XG4gICAgZGlzcGF0Y2hfZGV2KFwiU3ZlbHRlRE9NUmVtb3ZlXCIsIHsgbm9kZSB9KTtcbiAgICBkZXRhY2gobm9kZSk7XG59XG5mdW5jdGlvbiBkZXRhY2hfYmV0d2Vlbl9kZXYoYmVmb3JlLCBhZnRlcikge1xuICAgIHdoaWxlIChiZWZvcmUubmV4dFNpYmxpbmcgJiYgYmVmb3JlLm5leHRTaWJsaW5nICE9PSBhZnRlcikge1xuICAgICAgICBkZXRhY2hfZGV2KGJlZm9yZS5uZXh0U2libGluZyk7XG4gICAgfVxufVxuZnVuY3Rpb24gZGV0YWNoX2JlZm9yZV9kZXYoYWZ0ZXIpIHtcbiAgICB3aGlsZSAoYWZ0ZXIucHJldmlvdXNTaWJsaW5nKSB7XG4gICAgICAgIGRldGFjaF9kZXYoYWZ0ZXIucHJldmlvdXNTaWJsaW5nKTtcbiAgICB9XG59XG5mdW5jdGlvbiBkZXRhY2hfYWZ0ZXJfZGV2KGJlZm9yZSkge1xuICAgIHdoaWxlIChiZWZvcmUubmV4dFNpYmxpbmcpIHtcbiAgICAgICAgZGV0YWNoX2RldihiZWZvcmUubmV4dFNpYmxpbmcpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIGxpc3Rlbl9kZXYobm9kZSwgZXZlbnQsIGhhbmRsZXIsIG9wdGlvbnMsIGhhc19wcmV2ZW50X2RlZmF1bHQsIGhhc19zdG9wX3Byb3BhZ2F0aW9uKSB7XG4gICAgY29uc3QgbW9kaWZpZXJzID0gb3B0aW9ucyA9PT0gdHJ1ZSA/IFtcImNhcHR1cmVcIl0gOiBvcHRpb25zID8gQXJyYXkuZnJvbShPYmplY3Qua2V5cyhvcHRpb25zKSkgOiBbXTtcbiAgICBpZiAoaGFzX3ByZXZlbnRfZGVmYXVsdClcbiAgICAgICAgbW9kaWZpZXJzLnB1c2goJ3ByZXZlbnREZWZhdWx0Jyk7XG4gICAgaWYgKGhhc19zdG9wX3Byb3BhZ2F0aW9uKVxuICAgICAgICBtb2RpZmllcnMucHVzaCgnc3RvcFByb3BhZ2F0aW9uJyk7XG4gICAgZGlzcGF0Y2hfZGV2KFwiU3ZlbHRlRE9NQWRkRXZlbnRMaXN0ZW5lclwiLCB7IG5vZGUsIGV2ZW50LCBoYW5kbGVyLCBtb2RpZmllcnMgfSk7XG4gICAgY29uc3QgZGlzcG9zZSA9IGxpc3Rlbihub2RlLCBldmVudCwgaGFuZGxlciwgb3B0aW9ucyk7XG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgZGlzcGF0Y2hfZGV2KFwiU3ZlbHRlRE9NUmVtb3ZlRXZlbnRMaXN0ZW5lclwiLCB7IG5vZGUsIGV2ZW50LCBoYW5kbGVyLCBtb2RpZmllcnMgfSk7XG4gICAgICAgIGRpc3Bvc2UoKTtcbiAgICB9O1xufVxuZnVuY3Rpb24gYXR0cl9kZXYobm9kZSwgYXR0cmlidXRlLCB2YWx1ZSkge1xuICAgIGF0dHIobm9kZSwgYXR0cmlidXRlLCB2YWx1ZSk7XG4gICAgaWYgKHZhbHVlID09IG51bGwpXG4gICAgICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVJlbW92ZUF0dHJpYnV0ZVwiLCB7IG5vZGUsIGF0dHJpYnV0ZSB9KTtcbiAgICBlbHNlXG4gICAgICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVNldEF0dHJpYnV0ZVwiLCB7IG5vZGUsIGF0dHJpYnV0ZSwgdmFsdWUgfSk7XG59XG5mdW5jdGlvbiBwcm9wX2Rldihub2RlLCBwcm9wZXJ0eSwgdmFsdWUpIHtcbiAgICBub2RlW3Byb3BlcnR5XSA9IHZhbHVlO1xuICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVNldFByb3BlcnR5XCIsIHsgbm9kZSwgcHJvcGVydHksIHZhbHVlIH0pO1xufVxuZnVuY3Rpb24gZGF0YXNldF9kZXYobm9kZSwgcHJvcGVydHksIHZhbHVlKSB7XG4gICAgbm9kZS5kYXRhc2V0W3Byb3BlcnR5XSA9IHZhbHVlO1xuICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVNldERhdGFzZXRcIiwgeyBub2RlLCBwcm9wZXJ0eSwgdmFsdWUgfSk7XG59XG5mdW5jdGlvbiBzZXRfZGF0YV9kZXYodGV4dCwgZGF0YSkge1xuICAgIGRhdGEgPSAnJyArIGRhdGE7XG4gICAgaWYgKHRleHQuZGF0YSA9PT0gZGF0YSlcbiAgICAgICAgcmV0dXJuO1xuICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVNldERhdGFcIiwgeyBub2RlOiB0ZXh0LCBkYXRhIH0pO1xuICAgIHRleHQuZGF0YSA9IGRhdGE7XG59XG5mdW5jdGlvbiB2YWxpZGF0ZV9lYWNoX2FyZ3VtZW50KGFyZykge1xuICAgIGlmICh0eXBlb2YgYXJnICE9PSAnc3RyaW5nJyAmJiAhKGFyZyAmJiB0eXBlb2YgYXJnID09PSAnb2JqZWN0JyAmJiAnbGVuZ3RoJyBpbiBhcmcpKSB7XG4gICAgICAgIGxldCBtc2cgPSAneyNlYWNofSBvbmx5IGl0ZXJhdGVzIG92ZXIgYXJyYXktbGlrZSBvYmplY3RzLic7XG4gICAgICAgIGlmICh0eXBlb2YgU3ltYm9sID09PSAnZnVuY3Rpb24nICYmIGFyZyAmJiBTeW1ib2wuaXRlcmF0b3IgaW4gYXJnKSB7XG4gICAgICAgICAgICBtc2cgKz0gJyBZb3UgY2FuIHVzZSBhIHNwcmVhZCB0byBjb252ZXJ0IHRoaXMgaXRlcmFibGUgaW50byBhbiBhcnJheS4nO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIHZhbGlkYXRlX3Nsb3RzKG5hbWUsIHNsb3QsIGtleXMpIHtcbiAgICBmb3IgKGNvbnN0IHNsb3Rfa2V5IG9mIE9iamVjdC5rZXlzKHNsb3QpKSB7XG4gICAgICAgIGlmICghfmtleXMuaW5kZXhPZihzbG90X2tleSkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgPCR7bmFtZX0+IHJlY2VpdmVkIGFuIHVuZXhwZWN0ZWQgc2xvdCBcIiR7c2xvdF9rZXl9XCIuYCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5jbGFzcyBTdmVsdGVDb21wb25lbnREZXYgZXh0ZW5kcyBTdmVsdGVDb21wb25lbnQge1xuICAgIGNvbnN0cnVjdG9yKG9wdGlvbnMpIHtcbiAgICAgICAgaWYgKCFvcHRpb25zIHx8ICghb3B0aW9ucy50YXJnZXQgJiYgIW9wdGlvbnMuJCRpbmxpbmUpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCd0YXJnZXQnIGlzIGEgcmVxdWlyZWQgb3B0aW9uYCk7XG4gICAgICAgIH1cbiAgICAgICAgc3VwZXIoKTtcbiAgICB9XG4gICAgJGRlc3Ryb3koKSB7XG4gICAgICAgIHN1cGVyLiRkZXN0cm95KCk7XG4gICAgICAgIHRoaXMuJGRlc3Ryb3kgPSAoKSA9PiB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYENvbXBvbmVudCB3YXMgYWxyZWFkeSBkZXN0cm95ZWRgKTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1jb25zb2xlXG4gICAgICAgIH07XG4gICAgfVxuICAgICRjYXB0dXJlX3N0YXRlKCkgeyB9XG4gICAgJGluamVjdF9zdGF0ZSgpIHsgfVxufVxuZnVuY3Rpb24gbG9vcF9ndWFyZCh0aW1lb3V0KSB7XG4gICAgY29uc3Qgc3RhcnQgPSBEYXRlLm5vdygpO1xuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgIGlmIChEYXRlLm5vdygpIC0gc3RhcnQgPiB0aW1lb3V0KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEluZmluaXRlIGxvb3AgZGV0ZWN0ZWRgKTtcbiAgICAgICAgfVxuICAgIH07XG59XG5cbmV4cG9ydCB7IEh0bWxUYWcsIFN2ZWx0ZUNvbXBvbmVudCwgU3ZlbHRlQ29tcG9uZW50RGV2LCBTdmVsdGVFbGVtZW50LCBhY3Rpb25fZGVzdHJveWVyLCBhZGRfYXR0cmlidXRlLCBhZGRfY2xhc3NlcywgYWRkX2ZsdXNoX2NhbGxiYWNrLCBhZGRfbG9jYXRpb24sIGFkZF9yZW5kZXJfY2FsbGJhY2ssIGFkZF9yZXNpemVfbGlzdGVuZXIsIGFkZF90cmFuc2Zvcm0sIGFmdGVyVXBkYXRlLCBhcHBlbmQsIGFwcGVuZF9kZXYsIGFzc2lnbiwgYXR0ciwgYXR0cl9kZXYsIGJlZm9yZVVwZGF0ZSwgYmluZCwgYmluZGluZ19jYWxsYmFja3MsIGJsYW5rX29iamVjdCwgYnViYmxlLCBjaGVja19vdXRyb3MsIGNoaWxkcmVuLCBjbGFpbV9jb21wb25lbnQsIGNsYWltX2VsZW1lbnQsIGNsYWltX3NwYWNlLCBjbGFpbV90ZXh0LCBjbGVhcl9sb29wcywgY29tcG9uZW50X3N1YnNjcmliZSwgY29tcHV0ZV9yZXN0X3Byb3BzLCBjcmVhdGVFdmVudERpc3BhdGNoZXIsIGNyZWF0ZV9hbmltYXRpb24sIGNyZWF0ZV9iaWRpcmVjdGlvbmFsX3RyYW5zaXRpb24sIGNyZWF0ZV9jb21wb25lbnQsIGNyZWF0ZV9pbl90cmFuc2l0aW9uLCBjcmVhdGVfb3V0X3RyYW5zaXRpb24sIGNyZWF0ZV9zbG90LCBjcmVhdGVfc3NyX2NvbXBvbmVudCwgY3VycmVudF9jb21wb25lbnQsIGN1c3RvbV9ldmVudCwgZGF0YXNldF9kZXYsIGRlYnVnLCBkZXN0cm95X2Jsb2NrLCBkZXN0cm95X2NvbXBvbmVudCwgZGVzdHJveV9lYWNoLCBkZXRhY2gsIGRldGFjaF9hZnRlcl9kZXYsIGRldGFjaF9iZWZvcmVfZGV2LCBkZXRhY2hfYmV0d2Vlbl9kZXYsIGRldGFjaF9kZXYsIGRpcnR5X2NvbXBvbmVudHMsIGRpc3BhdGNoX2RldiwgZWFjaCwgZWxlbWVudCwgZWxlbWVudF9pcywgZW1wdHksIGVzY2FwZSwgZXNjYXBlZCwgZXhjbHVkZV9pbnRlcm5hbF9wcm9wcywgZml4X2FuZF9kZXN0cm95X2Jsb2NrLCBmaXhfYW5kX291dHJvX2FuZF9kZXN0cm95X2Jsb2NrLCBmaXhfcG9zaXRpb24sIGZsdXNoLCBnZXRDb250ZXh0LCBnZXRfYmluZGluZ19ncm91cF92YWx1ZSwgZ2V0X2N1cnJlbnRfY29tcG9uZW50LCBnZXRfc2xvdF9jaGFuZ2VzLCBnZXRfc2xvdF9jb250ZXh0LCBnZXRfc3ByZWFkX29iamVjdCwgZ2V0X3NwcmVhZF91cGRhdGUsIGdldF9zdG9yZV92YWx1ZSwgZ2xvYmFscywgZ3JvdXBfb3V0cm9zLCBoYW5kbGVfcHJvbWlzZSwgaGFzX3Byb3AsIGlkZW50aXR5LCBpbml0LCBpbnNlcnQsIGluc2VydF9kZXYsIGludHJvcywgaW52YWxpZF9hdHRyaWJ1dGVfbmFtZV9jaGFyYWN0ZXIsIGlzX2NsaWVudCwgaXNfY3Jvc3NvcmlnaW4sIGlzX2Z1bmN0aW9uLCBpc19wcm9taXNlLCBsaXN0ZW4sIGxpc3Rlbl9kZXYsIGxvb3AsIGxvb3BfZ3VhcmQsIG1pc3NpbmdfY29tcG9uZW50LCBtb3VudF9jb21wb25lbnQsIG5vb3AsIG5vdF9lcXVhbCwgbm93LCBudWxsX3RvX2VtcHR5LCBvYmplY3Rfd2l0aG91dF9wcm9wZXJ0aWVzLCBvbkRlc3Ryb3ksIG9uTW91bnQsIG9uY2UsIG91dHJvX2FuZF9kZXN0cm95X2Jsb2NrLCBwcmV2ZW50X2RlZmF1bHQsIHByb3BfZGV2LCBxdWVyeV9zZWxlY3Rvcl9hbGwsIHJhZiwgcnVuLCBydW5fYWxsLCBzYWZlX25vdF9lcXVhbCwgc2NoZWR1bGVfdXBkYXRlLCBzZWxlY3RfbXVsdGlwbGVfdmFsdWUsIHNlbGVjdF9vcHRpb24sIHNlbGVjdF9vcHRpb25zLCBzZWxlY3RfdmFsdWUsIHNlbGYsIHNldENvbnRleHQsIHNldF9hdHRyaWJ1dGVzLCBzZXRfY3VycmVudF9jb21wb25lbnQsIHNldF9jdXN0b21fZWxlbWVudF9kYXRhLCBzZXRfZGF0YSwgc2V0X2RhdGFfZGV2LCBzZXRfaW5wdXRfdHlwZSwgc2V0X2lucHV0X3ZhbHVlLCBzZXRfbm93LCBzZXRfcmFmLCBzZXRfc3RvcmVfdmFsdWUsIHNldF9zdHlsZSwgc2V0X3N2Z19hdHRyaWJ1dGVzLCBzcGFjZSwgc3ByZWFkLCBzdG9wX3Byb3BhZ2F0aW9uLCBzdWJzY3JpYmUsIHN2Z19lbGVtZW50LCB0ZXh0LCB0aWNrLCB0aW1lX3Jhbmdlc190b19hcnJheSwgdG9fbnVtYmVyLCB0b2dnbGVfY2xhc3MsIHRyYW5zaXRpb25faW4sIHRyYW5zaXRpb25fb3V0LCB1cGRhdGVfa2V5ZWRfZWFjaCwgdXBkYXRlX3Nsb3QsIHZhbGlkYXRlX2NvbXBvbmVudCwgdmFsaWRhdGVfZWFjaF9hcmd1bWVudCwgdmFsaWRhdGVfZWFjaF9rZXlzLCB2YWxpZGF0ZV9zbG90cywgdmFsaWRhdGVfc3RvcmUsIHhsaW5rX2F0dHIgfTtcbiIsIi8vIHBhdGggdG8gd2hlcmUgdGhlIGltYWdlcyBhcmUgZG93bmxvYWRlZFxyXG4vL2NvbnN0IENBUkRfREFUQSA9IHJlcXVpcmUoXCIuL3NjcnlmYWxsLWRlZmF1bHQtY2FyZHMuanNvblwiKTtcclxuXHJcbmZ1bmN0aW9uIHRpbWVvdXQoKSB7XHJcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICByZXNvbHZlKCk7XHJcbiAgICB9LCA3MCk7XHJcbiAgfSk7XHJcbn1cclxuXHJcbmNsYXNzIE10Z0ludGVyZmFjZSB7XHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5fX2NhY2hlID0ge307XHJcbiAgfVxyXG5cclxuICBzZWFyY2gob3B0cyA9IHt9KSB7XHJcbiAgICAvLyBodHRwczovL2FwaS5zY3J5ZmFsbC5jb20vY2FyZHMvc2VhcmNoP29yZGVyPWNtYyZxPWMlM0FyZWQrcG93JTNEMyBcclxuICAgIC8vIGh0dHBzOi8vc2NyeWZhbGwuY29tL3NlYXJjaD9hcz1ncmlkJm9yZGVyPW5hbWUmcT1teXIrb3JhY2xlJTNBdG9rZW4rdHlwZSUzQWNyZWF0dXJlK2NvbW1hbmRlciUzQVdVQlJHXHJcblxyXG4gICAgbGV0IGJhc2V1cmw7XHJcblxyXG4gICAgaWYgKHR5cGVvZiBvcHRzICE9IFwic3RyaW5nXCIpIHtcclxuICAgICAgYmFzZXVybCA9IGBodHRwczovL2FwaS5zY3J5ZmFsbC5jb20vY2FyZHMvc2VhcmNoPyR7b3B0cy5wYWdlP1wicGFnZT1cIitvcHRzLnBhZ2UrXCImXCI6XCJcIn1vcmRlcj1jbWMmcT1gO1xyXG4gICAgICBjb25zdCBxdWVyaWVzID0gW107XHJcblxyXG4gICAgICBpZiAob3B0cy5uYW1lKSB7XHJcbiAgICAgICAgcXVlcmllcy5wdXNoKG9wdHMubmFtZSk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChvcHRzLmVkaGNvbG9ycyAmJiBvcHRzLmVkaGNvbG9ycy5zaXplKSB7XHJcbiAgICAgICAgbGV0IGNzID0gXCJcIjtcclxuICAgICAgICBmb3IgKGxldCBjb2xvciBvZiBvcHRzLmVkaGNvbG9ycykge1xyXG4gICAgICAgICAgY29sb3IgPSBjb2xvci50b1VwcGVyQ2FzZSgpO1xyXG4gICAgICAgICAgaWYgKGNvbG9yID09PSBcIkNcIikge1xyXG4gICAgICAgICAgICBjcyA9IFwiQ1wiO1xyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGNzICs9IGNvbG9yO1xyXG4gICAgICAgIH1cclxuICAgICAgICBxdWVyaWVzLnB1c2goXCJjb21tYW5kZXIlM0FcIiArIGNzKTtcclxuICAgICAgfVxyXG5cclxuXHJcbiAgICAgIGlmIChvcHRzLnR5cGUpIHtcclxuICAgICAgICBxdWVyaWVzLnB1c2goXCJ0eXBlJTNBXCIgKyBvcHRzLnR5cGUpO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChvcHRzLnRleHQpIHtcclxuICAgICAgICBxdWVyaWVzLnB1c2goXCJvcmFjbGUlM0FcIiArIG9wdHMudGV4dCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGJhc2V1cmwgPSBiYXNldXJsICsgcXVlcmllcy5qb2luKFwiK1wiKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGJhc2V1cmwgPSBvcHRzO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGZldGNoKGJhc2V1cmwpXHJcbiAgICAgIC50aGVuKHJlc3BvbnNlID0+IHJlc3BvbnNlLmpzb24oKSlcclxuICAgICAgLnRoZW4ocmVzcG9uc2UgPT4ge1xyXG4gICAgICAgIGZvciAobGV0IGMgb2YgcmVzcG9uc2UuZGF0YSkge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coXCJjXCIsIGMpO1xyXG4gICAgICAgICAgaWYgKCFjLmltYWdlX3VyaXMpIHtcclxuICAgICAgICAgICAgaWYgKGMuY2FyZF9mYWNlcykge1xyXG4gICAgICAgICAgICAgIGMuaW1hZ2VfdXJpcyA9IGMuY2FyZF9mYWNlc1swXS5pbWFnZV91cmlzO1xyXG4gICAgICAgICAgICAgIGNvbnN0IGJpdSA9IGMuY2FyZF9mYWNlc1sxXS5pbWFnZV91cmlzO1xyXG4gICAgICAgICAgICAgIGMuYmFja3NpZGUgPSBiaXUgPyBiaXUuYm9yZGVyX2Nyb3AgfHwgYml1Lm5vcm1hbCA6IFwiXCI7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGMudXJsID0gYyA/IGMuaW1hZ2VfdXJpcy5ib3JkZXJfY3JvcCB8fCBjLmltYWdlX3VyaXMubm9ybWFsIDogXCJcIjtcclxuICAgICAgICAgIHRoaXMuX19jYWNoZVtjLm5hbWVdID0gYztcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHJlc3BvbnNlO1xyXG4gICAgICB9KVxyXG4gICAgICAuY2F0Y2goZSA9PiB7IGNvbnNvbGUubG9nKGUpOyByZXR1cm4geyBjb2RlOiBcIm5vdF9mb3VuZFwiIH07IH0pO1xyXG5cclxuICB9XHJcblxyXG4gIGFzeW5jIGNhcmRCeU5hbWUobmFtZSkge1xyXG4gICAgaWYgKHRoaXMuX19jYWNoZVtuYW1lXSkgcmV0dXJuIHRoaXMuX19jYWNoZVtuYW1lXTtcclxuICAgIGF3YWl0IHRpbWVvdXQoKTtcclxuICAgIC8vaHR0cHM6Ly9hcGkuc2NyeWZhbGwuY29tL2NhcmRzL25hbWVkP2Z1enp5PWF1c3QrY29tIFxyXG4gICAgY29uc3QgZml4ZWQgPSBuYW1lLnJlcGxhY2UoL1xccy9nLCBcIitcIik7XHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBmZXRjaCgnaHR0cHM6Ly9hcGkuc2NyeWZhbGwuY29tL2NhcmRzL25hbWVkP2Z1enp5PScgKyBmaXhlZClcclxuICAgICAgLnRoZW4ocmVzcG9uc2UgPT4gcmVzcG9uc2UuanNvbigpKS5jYXRjaChlID0+IHsgY29uc29sZS5sb2coZSk7IHJldHVybiB7IGNvZGU6IFwibm90X2ZvdW5kXCIgfTsgfSk7XHJcblxyXG4gICAgdGhpcy5fX2NhY2hlW25hbWVdID0gcmVzdWx0O1xyXG4gICAgdGhpcy5fX2NhY2hlW3Jlc3VsdC5uYW1lXSA9IHJlc3VsdDtcclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAvLyAudGhlbihkYXRhID0+IGNvbnNvbGUubG9nKGRhdGEpKTtcclxuICAgIC8qIGZvciAobGV0IGNhcmQgb2YgQ0FSRF9EQVRBKSB7XHJcbiAgICAgICBpZiAoY2FyZC5uYW1lLnRvTG93ZXJDYXNlKCkgPT0gbmFtZS50b0xvd2VyQ2FzZSgpKSByZXR1cm4gY2FyZDtcclxuICAgICB9Ki9cclxuICB9XHJcblxyXG4gIGFzeW5jIHNvcnQoZGVja1N0cmluZywgdXBkYXRlID0gKCkgPT4ge30pIHtcclxuICAgIGRlY2tTdHJpbmcgPSBkZWNrU3RyaW5nLnJlcGxhY2UoLyMuKi9nbSwgXCJcIik7XHJcbiAgICBjb25zdCBkZWNrUmF3ID0gZGVja1N0cmluZy50cmltKCkucmVwbGFjZSgvXFwoKC4qPylcXCl8KFswLTldKlxcbikvZywgXCJcXG5cIikucmVwbGFjZSgvXFxzKlxcbitcXHMqXFxuKy9nLCBcIlxcblwiKS5zcGxpdChcIlxcblwiKTtcclxuXHJcbiAgICBsZXQgY3JlYXR1cmVzID0ge307XHJcbiAgICBsZXQgc3BlbGxzID0ge307XHJcbiAgICBsZXQgbGFuZHMgPSB7fTtcclxuICAgIGxldCBtYXliZSA9IFtdO1xyXG4gICAgY29uc3QgZXJyb3JzID0gW107XHJcblxyXG5cclxuICAgIGxldCBwcm9ncmVzcyA9IDA7XHJcbiAgICBmb3IgKGxldCBjYXJkIG9mIGRlY2tSYXcpIHtcclxuXHJcbiAgICAgIGxldCBjb3VudCA9IE1hdGguZmxvb3IoKChjYXJkLm1hdGNoKC8oXFxkKykvKSB8fCBbXSlbMF0gfHwgMSkpO1xyXG4gICAgICBpZiAoaXNOYU4oY291bnQpKSB7XHJcbiAgICAgICAgY291bnQgPSAxO1xyXG4gICAgICB9XHJcbiAgICAgIHByb2dyZXNzKys7XHJcblxyXG4gICAgICBpZiAoY2FyZC50cmltKCkuc3RhcnRzV2l0aChcIi8vXCIpKSB7XHJcbiAgICAgICAgbWF5YmUucHVzaChjYXJkLnRyaW0oKSk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCBuYW1lID0gY2FyZC5yZXBsYWNlKC8oXFxkKykvLCBcIlwiKS50cmltKCk7XHJcbiAgICAgIGlmICghbmFtZSkgY29udGludWU7IC8vIGNhbnQgd29yayB3aXRoIHRoaXMgZGF0YVxyXG4gICAgICAvLyBzZWFyY2ggdGhlIGFjY29yZGluZyBkYXRhXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgbGV0IGRhdGEgPSBhd2FpdCB0aGlzLmNhcmRCeU5hbWUobmFtZSk7XHJcblxyXG4gICAgICAgIGlmIChkYXRhLnR5cGVfbGluZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKFwibGFuZFwiKSkge1xyXG4gICAgICAgICAgbGFuZHNbZGF0YS5uYW1lXSA9IGxhbmRzW2RhdGEubmFtZV0gfHwgeyBkYXRhLCBjb3VudDogMCwgbmFtZTogZGF0YS5uYW1lIH07XHJcbiAgICAgICAgICBsYW5kc1tkYXRhLm5hbWVdLmNvdW50Kys7XHJcbiAgICAgICAgfSBlbHNlIGlmIChkYXRhLnR5cGVfbGluZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKFwiY3JlYXR1cmVcIikpIHtcclxuICAgICAgICAgIGNyZWF0dXJlc1tkYXRhLm5hbWVdID0gY3JlYXR1cmVzW2RhdGEubmFtZV0gfHwgeyBkYXRhLCBjb3VudDogMCwgbmFtZTogZGF0YS5uYW1lIH07XHJcbiAgICAgICAgICBjcmVhdHVyZXNbZGF0YS5uYW1lXS5jb3VudCsrO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBzcGVsbHNbZGF0YS5uYW1lXSA9IHNwZWxsc1tkYXRhLm5hbWVdIHx8IHsgZGF0YSwgY291bnQ6IDAsIG5hbWU6IGRhdGEubmFtZSB9O1xyXG4gICAgICAgICAgc3BlbGxzW2RhdGEubmFtZV0uY291bnQrKztcclxuICAgICAgICB9XHJcblxyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgZXJyb3JzLnB1c2gobmFtZSk7XHJcbiAgICAgIH1cclxuICAgICAgdXBkYXRlKHByb2dyZXNzLCBkZWNrUmF3Lmxlbmd0aCk7XHJcbiAgICB9XHJcblxyXG4gICAgY3JlYXR1cmVzID0gT2JqZWN0LnZhbHVlcyhjcmVhdHVyZXMpLnNvcnQoKGEsIGIpID0+IGEuZGF0YS5jbWMgPiBiLmRhdGEuY21jID8gMSA6IC0xKTtcclxuICAgIHNwZWxscyA9IE9iamVjdC52YWx1ZXMoc3BlbGxzKS5zb3J0KChhLCBiKSA9PiBhLmRhdGEuY21jID4gYi5kYXRhLmNtYyA/IDEgOiAtMSk7XHJcbiAgICBsYW5kcyA9IE9iamVjdC52YWx1ZXMobGFuZHMpLnNvcnQoKGEsIGIpID0+IGEubmFtZSA+IGIubmFtZSA/IDEgOiAtMSk7XHJcbiAgICBsZXQgb3V0cHV0ID0gXCIjIENyZWF0dXJlc1wiO1xyXG4gICAgZm9yIChsZXQgY3VyIG9mIGNyZWF0dXJlcykge1xyXG4gICAgICBvdXRwdXQgKz0gXCJcXG5cIiArIGN1ci5jb3VudCArIFwiIFwiICsgY3VyLm5hbWU7XHJcbiAgICB9XHJcbiAgICBvdXRwdXQgKz0gXCJcXG5cXG4jIFNwZWxsc1wiO1xyXG4gICAgZm9yIChsZXQgY3VyIG9mIHNwZWxscykge1xyXG4gICAgICBvdXRwdXQgKz0gXCJcXG5cIiArIGN1ci5jb3VudCArIFwiIFwiICsgY3VyLm5hbWU7XHJcbiAgICB9XHJcblxyXG4gICAgb3V0cHV0ICs9IFwiXFxuXFxuIyBMYW5kc1wiXHJcbiAgICBmb3IgKGxldCBjdXIgb2YgbGFuZHMpIHtcclxuICAgICAgb3V0cHV0ICs9IFwiXFxuXCIgKyBjdXIuY291bnQgKyBcIiBcIiArIGN1ci5uYW1lO1xyXG4gICAgfVxyXG5cclxuICAgIG91dHB1dCArPSBcIlxcblxcbiMgTWF5YmVcIlxyXG4gICAgZm9yIChsZXQgY3VyIG9mIG1heWJlKSB7XHJcbiAgICAgIG91dHB1dCArPSBcIlxcbi8vXCIgKyBjdXI7XHJcbiAgICB9XHJcblxyXG4gICAgb3V0cHV0ICs9IFwiXFxuXFxuIyBOb3QgRm91bmRcIlxyXG4gICAgZm9yIChsZXQgY3VyIG9mIGVycm9ycykge1xyXG4gICAgICBvdXRwdXQgKz0gXCJcXG4vL1wiICsgY3VyLmNvdW50ICsgXCIgXCIgKyBjdXIubmFtZTtcclxuICAgIH1cclxuXHJcblxyXG4gICAgcmV0dXJuIG91dHB1dDtcclxuICB9XHJcblxyXG5cclxuICAvKipcclxuICAgKiBjb252ZXJ0cyBhIGRlY2sgc3RyaW5nIHRvIGEgcmVhZGFibGUgb2JqZWN0XHJcbiAgICogYW5kIGRvd25sb2FkcyB0aGUgaW1nIGRhdGEgb24gZGVtYW5kLCBpZiBpdCBkb2VzIG5vdCBleGlzdFxyXG4gICAqXHJcbiAgICogQHBhcmFtIHtTdHJpbmd9IGRlY2tTdHJpbmcgdGhlIGNvbXBsZXRlIGRlY2ssIGNvcGllZCBmcm9tIGEgc2l0ZSBvciBlLmcgZm9yZ2VcclxuICAgKiBAbWVtYmVyb2YgTXRnSW50ZXJmYWNlXHJcbiAgICovXHJcbiAgYXN5bmMgY3JlYXRlRGVjayhkZWNrU3RyaW5nLCB1cGRhdGUgPSAoKSA9PiB7fSwgc29ydCA9IGZhbHNlKSB7XHJcbiAgICAvLyBjb252ZXJ0IHRoZSBkZWNrIHN0cmluZyB0byBhbiBhcnJheVxyXG5cclxuXHJcblxyXG5cclxuXHJcblxyXG5cclxuICAgIGxldCBncm91cHMgPSBbLi4uZGVja1N0cmluZy5tYXRjaCgvIyguKj8pKFxcbnwkKS9nKSB8fCBbXCJtYWluXCJdXTtcclxuICAgIGNvbnN0IGRlY2tSYXcgPSBkZWNrU3RyaW5nLnRyaW0oKS5yZXBsYWNlKC9cXCgoLio/KVxcKXwoWzAtOV0qXFxuKS9nLCBcIlxcblwiKS5yZXBsYWNlKC9cXHMqXFxuK1xccypcXG4rL2csIFwiXFxuXCIpLnNwbGl0KFwiXFxuXCIpO1xyXG4gICAgaWYgKCFkZWNrUmF3KSByZXR1cm4gW107XHJcbiAgICBpZiAoIWRlY2tSYXdbMF0uaW5jbHVkZXMoXCIjXCIpKSB7XHJcbiAgICAgIGlmIChncm91cHNbMF0gIT09IFwibWFpblwiKSB7XHJcbiAgICAgICAgZ3JvdXBzID0gW1wibWFpblwiXS5jb25jYXQoZ3JvdXBzKTtcclxuICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgZGVja1Jhdy5zaGlmdCgpO1xyXG4gICAgfVxyXG5cclxuXHJcbiAgICBncm91cHMgPSBncm91cHMubWFwKHYgPT4geyByZXR1cm4geyBkZWNrOiB7fSwgbmFtZTogdi5yZXBsYWNlKFwiI1wiLCBcIlwiKS50cmltKCkgfSB9KTtcclxuXHJcbiAgICBsZXQgY3VyR3JvdXAgPSAwO1xyXG5cclxuICAgIGxldCBwcm9ncmVzcyA9IDA7XHJcbiAgICBsZXQgaWdub3JlZCA9IDA7XHJcbiAgICAvLyBpdGVyYXRlIGVhY2ggZm91bmQgY2FyZFxyXG4gICAgZm9yIChsZXQgY2FyZCBvZiBkZWNrUmF3KSB7XHJcbiAgICAgIGlmICghY2FyZCkgY29udGludWU7XHJcbiAgICAgIGlmIChjYXJkLnRyaW0oKS5zdGFydHNXaXRoKFwiLy9cIikpIGNvbnRpbnVlO1xyXG4gICAgICBpZiAoY2FyZC5pbmNsdWRlcyhcIiNcIikpIHtcclxuICAgICAgICBjdXJHcm91cCsrO1xyXG4gICAgICAgIGlmIChjdXJHcm91cCA+IGdyb3Vwcy5sZW5ndGgpIGN1ckdyb3VwID0gMDtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG4gICAgICBwcm9ncmVzcysrO1xyXG5cclxuICAgICAgY29uc3QgZGVjayA9IGdyb3Vwc1tjdXJHcm91cF0uZGVjaztcclxuICAgICAgdXBkYXRlKHByb2dyZXNzLCBkZWNrUmF3Lmxlbmd0aCAtIGdyb3Vwcy5sZW5ndGggKyAxIC0gaWdub3JlZCk7XHJcbiAgICAgIC8vIGV4dHJhY3QgdGhlIGNvdW50IGZyb20gdGhlIHN0cmluZyBhbmQgZnJlZSB0aGUgbmFtZVxyXG5cclxuICAgICAgbGV0IGNvdW50ID0gTWF0aC5mbG9vcigoKGNhcmQubWF0Y2goLyhcXGQrKS8pIHx8IFtdKVswXSB8fCAxKSk7XHJcbiAgICAgIGlmIChpc05hTihjb3VudCkpIHtcclxuICAgICAgICBjb3VudCA9IDE7XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgbmFtZSA9IGNhcmQucmVwbGFjZSgvKFxcZCspLywgXCJcIikudHJpbSgpO1xyXG4gICAgICBpZiAoIW5hbWUpIGNvbnRpbnVlOyAvLyBjYW50IHdvcmsgd2l0aCB0aGlzIGRhdGFcclxuICAgICAgLy8gc2VhcmNoIHRoZSBhY2NvcmRpbmcgZGF0YVxyXG4gICAgICBsZXQgZGF0YSA9IGF3YWl0IHRoaXMuY2FyZEJ5TmFtZShuYW1lKTtcclxuXHJcbiAgICAgIGlmIChkYXRhLm5hbWUpXHJcbiAgICAgICAgZGVja1N0cmluZyA9IGRlY2tTdHJpbmcucmVwbGFjZShuYW1lLCBkYXRhLm5hbWUpO1xyXG4gICAgICBpZiAoZGF0YS5jb2RlID09IFwibm90X2ZvdW5kXCIpIHtcclxuICAgICAgICBkYXRhID0geyBpbWFnZV91cmlzOiB7fSwgbGVnYWxpdGllczoge30sIHByaWNlczogeyB1c2Q6IDAgfSwgbWFuYV9jb3N0OiBcIlwiLCBjbWM6IDAsIHR5cGVfbGluZTogXCJsYW5kXCIgfTtcclxuICAgICAgfVxyXG4gICAgICBpZiAoZGVja1tuYW1lXSkge1xyXG4gICAgICAgIGRlY2tbbmFtZV0uY291bnQgKz0gY291bnQ7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gd3JhcCBkYXRhIGluIGVhc3kgcmVhZGFibGUgZm9ybWF0XHJcbiAgICAgICAgbGV0IGJhY2tzaWRlID0gXCJcIjtcclxuICAgICAgICBpZiAoIWRhdGEuaW1hZ2VfdXJpcykge1xyXG4gICAgICAgICAgaWYgKGRhdGEuY2FyZF9mYWNlcykge1xyXG4gICAgICAgICAgICBkYXRhLmltYWdlX3VyaXMgPSBkYXRhLmNhcmRfZmFjZXNbMF0uaW1hZ2VfdXJpcztcclxuICAgICAgICAgICAgY29uc3QgYml1ID0gZGF0YS5jYXJkX2ZhY2VzWzFdLmltYWdlX3VyaXM7XHJcbiAgICAgICAgICAgIGJhY2tzaWRlID0gYml1ID8gYml1LmJvcmRlcl9jcm9wIHx8IGJpdS5ub3JtYWwgOiBcIlwiO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgY29uc29sZS5sb2coXCJlcnJcIiwgZGF0YSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCB1cmwgPSBkYXRhID8gZGF0YS5pbWFnZV91cmlzLmJvcmRlcl9jcm9wIHx8IGRhdGEuaW1hZ2VfdXJpcy5ub3JtYWwgOiBcIlwiO1xyXG4gICAgICAgIGRlY2tbbmFtZV0gPSB7XHJcbiAgICAgICAgICBuYW1lLFxyXG4gICAgICAgICAgY291bnQsXHJcbiAgICAgICAgICB1cmwsXHJcbiAgICAgICAgICBiYWNrc2lkZSxcclxuICAgICAgICAgIGRhdGFcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBsZXQgbGFuZENvdW50ID0gMDtcclxuICAgIGNvbnN0IG92ZXJhbGxEZXZvdGlvbiA9IHtcclxuICAgICAgYmx1ZTogMCxcclxuICAgICAgYmxhY2s6IDAsXHJcbiAgICAgIHJlZDogMCxcclxuICAgICAgd2hpdGU6IDAsXHJcbiAgICAgIGdyZWVuOiAwLFxyXG4gICAgICBjb2xvcmxlc3M6IDAsXHJcbiAgICAgIGdlbmVyaWM6IDAsXHJcbiAgICAgIHN1bTogMFxyXG4gICAgfTtcclxuICAgIGNvbnN0IG92ZXJhbGxNYW5hQ3VydmUgPSBbXTtcclxuICAgIC8vbWFuYV9jb3N0OiBcIntXfXtVfXtCfXtSfXtHfSB7Q31cIlxyXG5cclxuICAgIGxldCBvdmVyYWxsQ291bnQgPSAwO1xyXG4gICAgbGV0IG92ZXJhbGxDb3N0ID0gMDtcclxuICAgIC8vbWFuYV9jb3N0LnNwbGl0KFwiR1wiKS5sZW5ndGggLSAxXHJcbiAgICBmb3IgKGxldCBncm91cCBvZiBncm91cHMpIHtcclxuXHJcbiAgICAgIGdyb3VwLmNhcmRzID0gT2JqZWN0LnZhbHVlcyhncm91cC5kZWNrKTtcclxuICAgICAgZ3JvdXAuY2FyZHMgPSBncm91cC5jYXJkcy5zb3J0KChhLCBiKSA9PiBhLmRhdGEuY21jID4gYi5kYXRhLmNtYyA/IDEgOiAtMSk7XHJcblxyXG4gICAgICBsZXQgY291bnQgPSAwO1xyXG4gICAgICBsZXQgY29zdCA9IDA7XHJcbiAgICAgIGNvbnN0IGRldm90aW9uID0ge1xyXG4gICAgICAgIGJsdWU6IDAsXHJcbiAgICAgICAgYmxhY2s6IDAsXHJcbiAgICAgICAgcmVkOiAwLFxyXG4gICAgICAgIHdoaXRlOiAwLFxyXG4gICAgICAgIGdyZWVuOiAwLFxyXG4gICAgICAgIGNvbG9ybGVzczogMCxcclxuICAgICAgICBnZW5lcmljOiAwLFxyXG4gICAgICAgIHN1bTogMFxyXG4gICAgICB9O1xyXG4gICAgICBjb25zdCBtYW5hQ3VydmUgPSBbXTtcclxuICAgICAgZm9yIChsZXQgY2FyZCBvZiBncm91cC5jYXJkcykge1xyXG4gICAgICAgIGNvdW50ICs9IGNhcmQuY291bnQ7XHJcblxyXG4gICAgICAgIGNvc3QgKz0gcGFyc2VGbG9hdChjYXJkLmRhdGEucHJpY2VzLnVzZCB8fCAwKSAqIGNhcmQuY291bnQ7XHJcblxyXG4gICAgICAgIGlmICghY2FyZC5kYXRhLnR5cGVfbGluZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKFwibGFuZFwiKSkge1xyXG4gICAgICAgICAgbWFuYUN1cnZlW2NhcmQuZGF0YS5jbWMgfHwgMF0gPSAobWFuYUN1cnZlW2NhcmQuZGF0YS5jbWMgfHwgMF0gfHwgMCkgKyBjYXJkLmNvdW50O1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBsYW5kQ291bnQgKz0gY2FyZC5jb3VudDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNhcmQuZGF0YS5tYW5hX2Nvc3QgPSBjYXJkLmRhdGEubWFuYV9jb3N0IHx8IFwiXCI7XHJcbiAgICAgICAgZGV2b3Rpb24uYmx1ZSArPSAoY2FyZC5kYXRhLm1hbmFfY29zdC5zcGxpdChcIlVcIikubGVuZ3RoIC0gMSkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIGRldm90aW9uLmJsYWNrICs9IChjYXJkLmRhdGEubWFuYV9jb3N0LnNwbGl0KFwiQlwiKS5sZW5ndGggLSAxKSAqIGNhcmQuY291bnQ7XHJcbiAgICAgICAgZGV2b3Rpb24ucmVkICs9IChjYXJkLmRhdGEubWFuYV9jb3N0LnNwbGl0KFwiUlwiKS5sZW5ndGggLSAxKSAqIGNhcmQuY291bnQ7XHJcbiAgICAgICAgZGV2b3Rpb24ud2hpdGUgKz0gKGNhcmQuZGF0YS5tYW5hX2Nvc3Quc3BsaXQoXCJXXCIpLmxlbmd0aCAtIDEpICogY2FyZC5jb3VudDtcclxuICAgICAgICBkZXZvdGlvbi5ncmVlbiArPSAoY2FyZC5kYXRhLm1hbmFfY29zdC5zcGxpdChcIkdcIikubGVuZ3RoIC0gMSkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIGRldm90aW9uLmNvbG9ybGVzcyArPSAoY2FyZC5kYXRhLm1hbmFfY29zdC5zcGxpdChcIkNcIikubGVuZ3RoIC0gMSkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIGRldm90aW9uLmdlbmVyaWMgKz0gTWF0aC5mbG9vcihjYXJkLmRhdGEubWFuYV9jb3N0LnJlcGxhY2UoL1teMC05Ll0vZywgXCJcIikgfHwgMCkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIGRldm90aW9uLnN1bSA9IGRldm90aW9uLmJsdWUgKyBkZXZvdGlvbi5ibGFjayArIGRldm90aW9uLnJlZCArIGRldm90aW9uLmdyZWVuICsgZGV2b3Rpb24ud2hpdGUgKyBkZXZvdGlvbi5jb2xvcmxlc3MgKyBkZXZvdGlvbi5nZW5lcmljO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCBpc01heWJlID0gZ3JvdXAubmFtZS50b0xvd2VyQ2FzZSgpID09IFwibWF5YmVcIjtcclxuXHJcbiAgICAgIGdyb3VwLmNvdW50ID0gY291bnQ7XHJcbiAgICAgIGdyb3VwLm1hbmEgPSBkZXZvdGlvbjtcclxuICAgICAgZ3JvdXAuY29zdCA9IGNvc3Q7XHJcblxyXG4gICAgICBncm91cC5tYW5hQ3VydmUgPSBtYW5hQ3VydmU7XHJcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbWFuYUN1cnZlLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgbWFuYUN1cnZlW2ldID0gbWFuYUN1cnZlW2ldIHx8IDA7XHJcbiAgICAgICAgaWYgKGlzTWF5YmUpIGNvbnRpbnVlO1xyXG4gICAgICAgIG92ZXJhbGxNYW5hQ3VydmVbaV0gPSAob3ZlcmFsbE1hbmFDdXJ2ZVtpXSB8fCAwKSArIChtYW5hQ3VydmVbaV0gfHwgMCk7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKCFpc01heWJlKSB7XHJcblxyXG4gICAgICAgIG92ZXJhbGxDb3N0ICs9IGNvc3Q7XHJcbiAgICAgICAgb3ZlcmFsbENvdW50ICs9IGNvdW50O1xyXG5cclxuICAgICAgICBvdmVyYWxsRGV2b3Rpb24uYmx1ZSArPSBkZXZvdGlvbi5ibHVlO1xyXG4gICAgICAgIG92ZXJhbGxEZXZvdGlvbi5ibGFjayArPSBkZXZvdGlvbi5ibGFjaztcclxuICAgICAgICBvdmVyYWxsRGV2b3Rpb24ucmVkICs9IGRldm90aW9uLnJlZDtcclxuICAgICAgICBvdmVyYWxsRGV2b3Rpb24ud2hpdGUgKz0gZGV2b3Rpb24ud2hpdGU7XHJcbiAgICAgICAgb3ZlcmFsbERldm90aW9uLmdyZWVuICs9IGRldm90aW9uLmdyZWVuO1xyXG4gICAgICAgIG92ZXJhbGxEZXZvdGlvbi5jb2xvcmxlc3MgKz0gZGV2b3Rpb24uY29sb3JsZXNzO1xyXG5cclxuICAgICAgICBvdmVyYWxsRGV2b3Rpb24uZ2VuZXJpYyArPSBkZXZvdGlvbi5nZW5lcmljO1xyXG4gICAgICAgIG92ZXJhbGxEZXZvdGlvbi5zdW0gKz0gZGV2b3Rpb24uc3VtO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBvdmVyYWxsTWFuYUN1cnZlLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgIG92ZXJhbGxNYW5hQ3VydmVbaV0gPSBvdmVyYWxsTWFuYUN1cnZlW2ldIHx8IDA7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgbm9ubGFuZHMgPSBvdmVyYWxsQ291bnQgLSBsYW5kQ291bnQ7XHJcblxyXG4gICAgbGV0IGp1c3REZXZvdGlvbiA9IG92ZXJhbGxEZXZvdGlvbi5ibHVlICsgb3ZlcmFsbERldm90aW9uLmJsYWNrICsgb3ZlcmFsbERldm90aW9uLnJlZCArIG92ZXJhbGxEZXZvdGlvbi53aGl0ZSArIG92ZXJhbGxEZXZvdGlvbi5ncmVlbiArIG92ZXJhbGxEZXZvdGlvbi5jb2xvcmxlc3M7XHJcbiAgICBqdXN0RGV2b3Rpb24gPSBqdXN0RGV2b3Rpb24gfHwgMTtcclxuICAgIGNvbnN0IG1hbmFQcm9wb3NhbCA9IHtcclxuICAgICAgYmx1ZTogb3ZlcmFsbERldm90aW9uLmJsdWUgLyBqdXN0RGV2b3Rpb24sXHJcbiAgICAgIGJsYWNrOiBvdmVyYWxsRGV2b3Rpb24uYmxhY2sgLyBqdXN0RGV2b3Rpb24sXHJcbiAgICAgIHJlZDogb3ZlcmFsbERldm90aW9uLnJlZCAvIGp1c3REZXZvdGlvbixcclxuICAgICAgd2hpdGU6IG92ZXJhbGxEZXZvdGlvbi53aGl0ZSAvIGp1c3REZXZvdGlvbixcclxuICAgICAgZ3JlZW46IG92ZXJhbGxEZXZvdGlvbi5ncmVlbiAvIGp1c3REZXZvdGlvbixcclxuICAgICAgY29sb3JsZXNzOiBvdmVyYWxsRGV2b3Rpb24uY29sb3JsZXNzIC8ganVzdERldm90aW9uLFxyXG4gICAgfTtcclxuXHJcbiAgICBncm91cHNbXCJtYW5hUHJvcG9zYWxcIl0gPSBtYW5hUHJvcG9zYWw7XHJcblxyXG4gICAgZ3JvdXBzW1wibGFuZENvdW50XCJdID0gbGFuZENvdW50O1xyXG4gICAgZ3JvdXBzW1wiY2FyZENvdW50XCJdID0gb3ZlcmFsbENvdW50O1xyXG4gICAgZ3JvdXBzW1wiYXZlcmFnZU1hbmFcIl0gPSBvdmVyYWxsRGV2b3Rpb24uc3VtIC8gKG92ZXJhbGxDb3VudCAtIGxhbmRDb3VudCk7XHJcbiAgICBncm91cHNbXCJjb3N0XCJdID0gb3ZlcmFsbENvc3Q7XHJcbiAgICBncm91cHNbXCJtYW5hXCJdID0gb3ZlcmFsbERldm90aW9uO1xyXG4gICAgZ3JvdXBzW1wiY29ycmVjdGVkXCJdID0gZGVja1N0cmluZztcclxuICAgIGdyb3Vwc1tcIm1hbmFDdXJ2ZVwiXSA9IG92ZXJhbGxNYW5hQ3VydmU7XHJcbiAgICByZXR1cm4gZ3JvdXBzO1xyXG4gIH1cclxufVxyXG5cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gbmV3IE10Z0ludGVyZmFjZSgpOyIsIi8qIVxuICogSmF2YVNjcmlwdCBDb29raWUgdjIuMi4xXG4gKiBodHRwczovL2dpdGh1Yi5jb20vanMtY29va2llL2pzLWNvb2tpZVxuICpcbiAqIENvcHlyaWdodCAyMDA2LCAyMDE1IEtsYXVzIEhhcnRsICYgRmFnbmVyIEJyYWNrXG4gKiBSZWxlYXNlZCB1bmRlciB0aGUgTUlUIGxpY2Vuc2VcbiAqL1xuOyhmdW5jdGlvbiAoZmFjdG9yeSkge1xuXHR2YXIgcmVnaXN0ZXJlZEluTW9kdWxlTG9hZGVyO1xuXHRpZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKSB7XG5cdFx0ZGVmaW5lKGZhY3RvcnkpO1xuXHRcdHJlZ2lzdGVyZWRJbk1vZHVsZUxvYWRlciA9IHRydWU7XG5cdH1cblx0aWYgKHR5cGVvZiBleHBvcnRzID09PSAnb2JqZWN0Jykge1xuXHRcdG1vZHVsZS5leHBvcnRzID0gZmFjdG9yeSgpO1xuXHRcdHJlZ2lzdGVyZWRJbk1vZHVsZUxvYWRlciA9IHRydWU7XG5cdH1cblx0aWYgKCFyZWdpc3RlcmVkSW5Nb2R1bGVMb2FkZXIpIHtcblx0XHR2YXIgT2xkQ29va2llcyA9IHdpbmRvdy5Db29raWVzO1xuXHRcdHZhciBhcGkgPSB3aW5kb3cuQ29va2llcyA9IGZhY3RvcnkoKTtcblx0XHRhcGkubm9Db25mbGljdCA9IGZ1bmN0aW9uICgpIHtcblx0XHRcdHdpbmRvdy5Db29raWVzID0gT2xkQ29va2llcztcblx0XHRcdHJldHVybiBhcGk7XG5cdFx0fTtcblx0fVxufShmdW5jdGlvbiAoKSB7XG5cdGZ1bmN0aW9uIGV4dGVuZCAoKSB7XG5cdFx0dmFyIGkgPSAwO1xuXHRcdHZhciByZXN1bHQgPSB7fTtcblx0XHRmb3IgKDsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKykge1xuXHRcdFx0dmFyIGF0dHJpYnV0ZXMgPSBhcmd1bWVudHNbIGkgXTtcblx0XHRcdGZvciAodmFyIGtleSBpbiBhdHRyaWJ1dGVzKSB7XG5cdFx0XHRcdHJlc3VsdFtrZXldID0gYXR0cmlidXRlc1trZXldO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRyZXR1cm4gcmVzdWx0O1xuXHR9XG5cblx0ZnVuY3Rpb24gZGVjb2RlIChzKSB7XG5cdFx0cmV0dXJuIHMucmVwbGFjZSgvKCVbMC05QS1aXXsyfSkrL2csIGRlY29kZVVSSUNvbXBvbmVudCk7XG5cdH1cblxuXHRmdW5jdGlvbiBpbml0IChjb252ZXJ0ZXIpIHtcblx0XHRmdW5jdGlvbiBhcGkoKSB7fVxuXG5cdFx0ZnVuY3Rpb24gc2V0IChrZXksIHZhbHVlLCBhdHRyaWJ1dGVzKSB7XG5cdFx0XHRpZiAodHlwZW9mIGRvY3VtZW50ID09PSAndW5kZWZpbmVkJykge1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGF0dHJpYnV0ZXMgPSBleHRlbmQoe1xuXHRcdFx0XHRwYXRoOiAnLydcblx0XHRcdH0sIGFwaS5kZWZhdWx0cywgYXR0cmlidXRlcyk7XG5cblx0XHRcdGlmICh0eXBlb2YgYXR0cmlidXRlcy5leHBpcmVzID09PSAnbnVtYmVyJykge1xuXHRcdFx0XHRhdHRyaWJ1dGVzLmV4cGlyZXMgPSBuZXcgRGF0ZShuZXcgRGF0ZSgpICogMSArIGF0dHJpYnV0ZXMuZXhwaXJlcyAqIDg2NGUrNSk7XG5cdFx0XHR9XG5cblx0XHRcdC8vIFdlJ3JlIHVzaW5nIFwiZXhwaXJlc1wiIGJlY2F1c2UgXCJtYXgtYWdlXCIgaXMgbm90IHN1cHBvcnRlZCBieSBJRVxuXHRcdFx0YXR0cmlidXRlcy5leHBpcmVzID0gYXR0cmlidXRlcy5leHBpcmVzID8gYXR0cmlidXRlcy5leHBpcmVzLnRvVVRDU3RyaW5nKCkgOiAnJztcblxuXHRcdFx0dHJ5IHtcblx0XHRcdFx0dmFyIHJlc3VsdCA9IEpTT04uc3RyaW5naWZ5KHZhbHVlKTtcblx0XHRcdFx0aWYgKC9eW1xce1xcW10vLnRlc3QocmVzdWx0KSkge1xuXHRcdFx0XHRcdHZhbHVlID0gcmVzdWx0O1xuXHRcdFx0XHR9XG5cdFx0XHR9IGNhdGNoIChlKSB7fVxuXG5cdFx0XHR2YWx1ZSA9IGNvbnZlcnRlci53cml0ZSA/XG5cdFx0XHRcdGNvbnZlcnRlci53cml0ZSh2YWx1ZSwga2V5KSA6XG5cdFx0XHRcdGVuY29kZVVSSUNvbXBvbmVudChTdHJpbmcodmFsdWUpKVxuXHRcdFx0XHRcdC5yZXBsYWNlKC8lKDIzfDI0fDI2fDJCfDNBfDNDfDNFfDNEfDJGfDNGfDQwfDVCfDVEfDVFfDYwfDdCfDdEfDdDKS9nLCBkZWNvZGVVUklDb21wb25lbnQpO1xuXG5cdFx0XHRrZXkgPSBlbmNvZGVVUklDb21wb25lbnQoU3RyaW5nKGtleSkpXG5cdFx0XHRcdC5yZXBsYWNlKC8lKDIzfDI0fDI2fDJCfDVFfDYwfDdDKS9nLCBkZWNvZGVVUklDb21wb25lbnQpXG5cdFx0XHRcdC5yZXBsYWNlKC9bXFwoXFwpXS9nLCBlc2NhcGUpO1xuXG5cdFx0XHR2YXIgc3RyaW5naWZpZWRBdHRyaWJ1dGVzID0gJyc7XG5cdFx0XHRmb3IgKHZhciBhdHRyaWJ1dGVOYW1lIGluIGF0dHJpYnV0ZXMpIHtcblx0XHRcdFx0aWYgKCFhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdKSB7XG5cdFx0XHRcdFx0Y29udGludWU7XG5cdFx0XHRcdH1cblx0XHRcdFx0c3RyaW5naWZpZWRBdHRyaWJ1dGVzICs9ICc7ICcgKyBhdHRyaWJ1dGVOYW1lO1xuXHRcdFx0XHRpZiAoYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9PT0gdHJ1ZSkge1xuXHRcdFx0XHRcdGNvbnRpbnVlO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0Ly8gQ29uc2lkZXJzIFJGQyA2MjY1IHNlY3Rpb24gNS4yOlxuXHRcdFx0XHQvLyAuLi5cblx0XHRcdFx0Ly8gMy4gIElmIHRoZSByZW1haW5pbmcgdW5wYXJzZWQtYXR0cmlidXRlcyBjb250YWlucyBhICV4M0IgKFwiO1wiKVxuXHRcdFx0XHQvLyAgICAgY2hhcmFjdGVyOlxuXHRcdFx0XHQvLyBDb25zdW1lIHRoZSBjaGFyYWN0ZXJzIG9mIHRoZSB1bnBhcnNlZC1hdHRyaWJ1dGVzIHVwIHRvLFxuXHRcdFx0XHQvLyBub3QgaW5jbHVkaW5nLCB0aGUgZmlyc3QgJXgzQiAoXCI7XCIpIGNoYXJhY3Rlci5cblx0XHRcdFx0Ly8gLi4uXG5cdFx0XHRcdHN0cmluZ2lmaWVkQXR0cmlidXRlcyArPSAnPScgKyBhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdLnNwbGl0KCc7JylbMF07XG5cdFx0XHR9XG5cblx0XHRcdHJldHVybiAoZG9jdW1lbnQuY29va2llID0ga2V5ICsgJz0nICsgdmFsdWUgKyBzdHJpbmdpZmllZEF0dHJpYnV0ZXMpO1xuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIGdldCAoa2V5LCBqc29uKSB7XG5cdFx0XHRpZiAodHlwZW9mIGRvY3VtZW50ID09PSAndW5kZWZpbmVkJykge1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdHZhciBqYXIgPSB7fTtcblx0XHRcdC8vIFRvIHByZXZlbnQgdGhlIGZvciBsb29wIGluIHRoZSBmaXJzdCBwbGFjZSBhc3NpZ24gYW4gZW1wdHkgYXJyYXlcblx0XHRcdC8vIGluIGNhc2UgdGhlcmUgYXJlIG5vIGNvb2tpZXMgYXQgYWxsLlxuXHRcdFx0dmFyIGNvb2tpZXMgPSBkb2N1bWVudC5jb29raWUgPyBkb2N1bWVudC5jb29raWUuc3BsaXQoJzsgJykgOiBbXTtcblx0XHRcdHZhciBpID0gMDtcblxuXHRcdFx0Zm9yICg7IGkgPCBjb29raWVzLmxlbmd0aDsgaSsrKSB7XG5cdFx0XHRcdHZhciBwYXJ0cyA9IGNvb2tpZXNbaV0uc3BsaXQoJz0nKTtcblx0XHRcdFx0dmFyIGNvb2tpZSA9IHBhcnRzLnNsaWNlKDEpLmpvaW4oJz0nKTtcblxuXHRcdFx0XHRpZiAoIWpzb24gJiYgY29va2llLmNoYXJBdCgwKSA9PT0gJ1wiJykge1xuXHRcdFx0XHRcdGNvb2tpZSA9IGNvb2tpZS5zbGljZSgxLCAtMSk7XG5cdFx0XHRcdH1cblxuXHRcdFx0XHR0cnkge1xuXHRcdFx0XHRcdHZhciBuYW1lID0gZGVjb2RlKHBhcnRzWzBdKTtcblx0XHRcdFx0XHRjb29raWUgPSAoY29udmVydGVyLnJlYWQgfHwgY29udmVydGVyKShjb29raWUsIG5hbWUpIHx8XG5cdFx0XHRcdFx0XHRkZWNvZGUoY29va2llKTtcblxuXHRcdFx0XHRcdGlmIChqc29uKSB7XG5cdFx0XHRcdFx0XHR0cnkge1xuXHRcdFx0XHRcdFx0XHRjb29raWUgPSBKU09OLnBhcnNlKGNvb2tpZSk7XG5cdFx0XHRcdFx0XHR9IGNhdGNoIChlKSB7fVxuXHRcdFx0XHRcdH1cblxuXHRcdFx0XHRcdGphcltuYW1lXSA9IGNvb2tpZTtcblxuXHRcdFx0XHRcdGlmIChrZXkgPT09IG5hbWUpIHtcblx0XHRcdFx0XHRcdGJyZWFrO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fSBjYXRjaCAoZSkge31cblx0XHRcdH1cblxuXHRcdFx0cmV0dXJuIGtleSA/IGphcltrZXldIDogamFyO1xuXHRcdH1cblxuXHRcdGFwaS5zZXQgPSBzZXQ7XG5cdFx0YXBpLmdldCA9IGZ1bmN0aW9uIChrZXkpIHtcblx0XHRcdHJldHVybiBnZXQoa2V5LCBmYWxzZSAvKiByZWFkIGFzIHJhdyAqLyk7XG5cdFx0fTtcblx0XHRhcGkuZ2V0SlNPTiA9IGZ1bmN0aW9uIChrZXkpIHtcblx0XHRcdHJldHVybiBnZXQoa2V5LCB0cnVlIC8qIHJlYWQgYXMganNvbiAqLyk7XG5cdFx0fTtcblx0XHRhcGkucmVtb3ZlID0gZnVuY3Rpb24gKGtleSwgYXR0cmlidXRlcykge1xuXHRcdFx0c2V0KGtleSwgJycsIGV4dGVuZChhdHRyaWJ1dGVzLCB7XG5cdFx0XHRcdGV4cGlyZXM6IC0xXG5cdFx0XHR9KSk7XG5cdFx0fTtcblxuXHRcdGFwaS5kZWZhdWx0cyA9IHt9O1xuXG5cdFx0YXBpLndpdGhDb252ZXJ0ZXIgPSBpbml0O1xuXG5cdFx0cmV0dXJuIGFwaTtcblx0fVxuXG5cdHJldHVybiBpbml0KGZ1bmN0aW9uICgpIHt9KTtcbn0pKTtcbiIsIjxzY3JpcHQ+XHJcbiAgaW1wb3J0IHsgb25Nb3VudCB9IGZyb20gXCJzdmVsdGVcIjtcclxuICBpbXBvcnQgQ2FyZExvYWRlciBmcm9tIFwiLi9jYXJkLWxvYWRlci5qc1wiO1xyXG5cclxuICBpbXBvcnQgQ29va2llcyBmcm9tIFwianMtY29va2llXCI7XHJcblxyXG4gIGNvbnN0IENBUkRfUkFUSU8gPSAwLjcxNzY0NzA1ODgyO1xyXG4gIGxldCBfaGVpZ2h0ID0gMzAwO1xyXG4gIGxldCBfd2lkdGggPSBNYXRoLmZsb29yKF9oZWlnaHQgKiBDQVJEX1JBVElPKTtcclxuXHJcbiAgbGV0IGhlaWdodCA9IF9oZWlnaHQ7XHJcbiAgbGV0IHdpZHRoID0gX3dpZHRoO1xyXG4gIGxldCBjYXJkU2VhcmNoQWN0aXZlID0gdHJ1ZTtcclxuICBsZXQgc3RhdGlzdGljc0FjdGl2ZSA9IHRydWU7XHJcbiAgbGV0IHNjYWxpbmcgPSAxMDA7XHJcblxyXG4gIGxldCBkZXZvdGlvbkhpZ2hsaWdodCA9IC0xO1xyXG5cclxuICBmdW5jdGlvbiBoaWdobGlnaHREZXZvdGlvbihtYW5hKSB7XHJcbiAgICBpZiAoZGV2b3Rpb25IaWdobGlnaHQgPT0gbWFuYSkgZGV2b3Rpb25IaWdobGlnaHQgPSAtMTtcclxuICAgIGVsc2UgZGV2b3Rpb25IaWdobGlnaHQgPSBtYW5hICsgXCJcIjtcclxuICB9XHJcblxyXG4gICQ6IHtcclxuICAgIGNvbnN0IHMgPSBNYXRoLmZsb29yKHNjYWxpbmcgfHwgMTAwKSAvIDEwMDtcclxuICAgIGhlaWdodCA9IF9oZWlnaHQgKiBzO1xyXG4gICAgd2lkdGggPSBfd2lkdGggKiBzO1xyXG4gIH1cclxuXHJcbiAgbGV0IHByb21pc2UgPSBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHJlc29sdmUoW10pKTtcclxuICBsZXQgY2FyZFNlYXJjaFByb21pc2UgPSBuZXcgUHJvbWlzZShyZXNvbHZlID0+XHJcbiAgICByZXNvbHZlKHsgZGF0YToge30sIGhhc19tb3JlOiBmYWxzZSwgdG90YWxfY2FyZHM6IDAgfSlcclxuICApO1xyXG5cclxuICBsZXQgaW5wdXQ7XHJcbiAgbGV0IGZvcm1hdDtcclxuICBsZXQgcHJvZ3Jlc3MgPSAwO1xyXG4gIGxldCBhbGwgPSAwO1xyXG5cclxuICBsZXQgc3BOYW1lO1xyXG4gIGxldCBzcFRleHQ7XHJcblxyXG4gIGxldCBzcEVESEJsdWU7XHJcbiAgbGV0IHNwRURIQmxhY2s7XHJcbiAgbGV0IHNwRURIUmVkO1xyXG4gIGxldCBzcEVESFdoaXRlO1xyXG4gIGxldCBzcEVESEdyZWVuO1xyXG4gIGxldCBzcEVESENvbG9ybGVzcztcclxuXHJcbiAgZnVuY3Rpb24gY2xlYXJGb3JDb2xvcmxlc3MoKSB7XHJcbiAgICBzcEVESEJsdWUuY2hlY2tlZCA9IGZhbHNlO1xyXG4gICAgc3BFREhCbGFjay5jaGVja2VkID0gZmFsc2U7XHJcbiAgICBzcEVESFJlZC5jaGVja2VkID0gZmFsc2U7XHJcbiAgICBzcEVESFdoaXRlLmNoZWNrZWQgPSBmYWxzZTtcclxuICAgIHNwRURIR3JlZW4uY2hlY2tlZCA9IGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gY2xlYXJDb2xvcmxlc3MoKSB7XHJcbiAgICBzcEVESENvbG9ybGVzcy5jaGVja2VkID0gZmFsc2U7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBzZWFyY2hDYXJkcyhuZXh0VXJsKSB7XHJcbiAgICBpZiAodHlwZW9mIG5leHRVcmwgPT0gXCJzdHJpbmdcIikge1xyXG4gICAgICBjYXJkU2VhcmNoUHJvbWlzZSA9IENhcmRMb2FkZXIuc2VhcmNoKG5leHRVcmwpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCBjb2xvcnMgPSBuZXcgU2V0KCk7XHJcbiAgICBpZiAoc3BFREhDb2xvcmxlc3MuY2hlY2tlZCkgY29sb3JzLmFkZChcIkNcIik7XHJcbiAgICBpZiAoc3BFREhCbHVlLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJVXCIpO1xyXG4gICAgaWYgKHNwRURIQmxhY2suY2hlY2tlZCkgY29sb3JzLmFkZChcIkJcIik7XHJcbiAgICBpZiAoc3BFREhSZWQuY2hlY2tlZCkgY29sb3JzLmFkZChcIlJcIik7XHJcbiAgICBpZiAoc3BFREhXaGl0ZS5jaGVja2VkKSBjb2xvcnMuYWRkKFwiV1wiKTtcclxuICAgIGlmIChzcEVESEdyZWVuLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJHXCIpO1xyXG5cclxuICAgIGNhcmRTZWFyY2hQcm9taXNlID0gQ2FyZExvYWRlci5zZWFyY2goe1xyXG4gICAgICBuYW1lOiBzcE5hbWUudmFsdWUsXHJcbiAgICAgIHRleHQ6IHNwVGV4dC52YWx1ZSxcclxuICAgICAgZWRoY29sb3JzOiBjb2xvcnNcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgbGV0IGhpZGRlbkdyb3VwcyA9IG5ldyBTZXQoKTtcclxuXHJcbiAgZnVuY3Rpb24gdG9nZ2xlR3JvdXBWaXNpYmlsaXR5KGdyb3VwKSB7XHJcbiAgICBpZiAoaGlkZGVuR3JvdXBzLmhhcyhncm91cC5uYW1lKSkgaGlkZGVuR3JvdXBzLmRlbGV0ZShncm91cC5uYW1lKTtcclxuICAgIGVsc2UgaGlkZGVuR3JvdXBzLmFkZChncm91cC5uYW1lKTtcclxuXHJcbiAgICBoaWRkZW5Hcm91cHMgPSBoaWRkZW5Hcm91cHM7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBzcChwLCBhKSB7XHJcbiAgICBwcm9ncmVzcyA9IHA7XHJcbiAgICBhbGwgPSBhO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gc29ydERlY2tTdHJpbmcoKSB7XHJcbiAgICBwcm9taXNlID0gQ2FyZExvYWRlci5zb3J0KGlucHV0LnZhbHVlIHx8IFwiXCIsIChwLCBhKSA9PiB7XHJcbiAgICAgIHNwKHAsIGEpO1xyXG4gICAgfSlcclxuICAgICAgLmNhdGNoKGUgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZSk7XHJcbiAgICAgICAgdGhyb3cgZTtcclxuICAgICAgfSlcclxuICAgICAgLnRoZW4ocmVzID0+IHtcclxuICAgICAgICBpbnB1dC52YWx1ZSA9IHJlcztcclxuICAgICAgICByZXR1cm4gdXBkYXRlKHsga2V5Q29kZTogMjcgfSwgdHJ1ZSk7XHJcbiAgICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgZnVuY3Rpb24gdXBkYXRlKGV2dCkge1xyXG4gICAgaWYgKGV2dC5rZXlDb2RlICE9PSAyNykgcmV0dXJuO1xyXG4gICAgcHJvbWlzZSA9IENhcmRMb2FkZXIuY3JlYXRlRGVjayhpbnB1dC52YWx1ZSB8fCBcIlwiLCAocCwgYSkgPT4ge1xyXG4gICAgICBzcChwLCBhKTtcclxuICAgIH0pXHJcbiAgICAgIC5jYXRjaChlID0+IHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGUpO1xyXG4gICAgICAgIHRocm93IGU7XHJcbiAgICAgIH0pXHJcbiAgICAgIC50aGVuKHJlcyA9PiB7XHJcbiAgICAgICAgaW5wdXQudmFsdWUgPSByZXMuY29ycmVjdGVkO1xyXG4gICAgICAgIHJldHVybiByZXM7XHJcbiAgICAgIH0pO1xyXG5cclxuICAgIHJldHVybiBwcm9taXNlO1xyXG4gIH1cclxuICBmdW5jdGlvbiByZWxvYWQoKSB7XHJcbiAgICB1cGRhdGUoeyBrZXlDb2RlOiAyNyB9KTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIGFwcGVuZENhcmQobmFtZSkge1xyXG4gICAgaWYgKCFuYW1lKSByZXR1cm47XHJcblxyXG4gICAgaW5wdXQudmFsdWUgPSBpbnB1dC52YWx1ZSArIFwiXFxuMSBcIiArIG5hbWU7XHJcbiAgICByZWxvYWQoKTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHJlbW92ZShjYXJkKSB7XHJcbiAgICBjb25zdCByID0gbmV3IFJlZ0V4cChgXi4qJHtjYXJkLm5hbWV9LiokYCwgXCJnbVwiKTtcclxuXHJcbiAgICBpbnB1dC52YWx1ZSA9IGlucHV0LnZhbHVlLnJlcGxhY2UociwgXCJcIik7XHJcbiAgICBwcm9taXNlID0gQ2FyZExvYWRlci5jcmVhdGVEZWNrKGlucHV0LnZhbHVlIHx8IFwiXCIsIChwLCBhKSA9PlxyXG4gICAgICBzcChwLCBhKVxyXG4gICAgKS5jYXRjaChlID0+IHtcclxuICAgICAgY29uc29sZS5lcnJvcihlKTtcclxuICAgICAgdGhyb3cgZTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgbGV0IGhlbHBBY3RpdmUgPSB0cnVlO1xyXG4gIG9uTW91bnQoYXN5bmMgKCkgPT4ge1xyXG4gICAgY29uc3Qgc3RhcnQgPVxyXG4gICAgICBDb29raWVzLmdldChcImRlY2tcIikgfHxcclxuICAgICAgYCNsYW5kc1xyXG5tb3VudGFpblxyXG4yIHBsYWluc1xyXG4zIHN3YW1wc1xyXG4jIG1haW4gZGVja1xyXG4yMCBibGlnaHRzdGVlbCBjb2xvc3N1c2A7XHJcblxyXG4gICAgaGVscEFjdGl2ZSA9IENvb2tpZXMuZ2V0KFwiaGVscEFjdGl2ZVwiKSA9PSBcInRydWVcIjtcclxuICAgIGNvbnNvbGUubG9nKFwiaGVscDpcIiwgQ29va2llcy5nZXQoXCJoZWxwQWN0aXZlXCIpKTtcclxuICAgIGNhcmRTZWFyY2hBY3RpdmUgPSBDb29raWVzLnNldChcImNhcmRTZWFyY2hBY3RpdmVcIikgPT0gXCJ0cnVlXCI7XHJcbiAgICBjb25zb2xlLmxvZyhcInNlYXJjaDpcIiwgQ29va2llcy5zZXQoXCJjYXJkU2VhcmNoQWN0aXZlXCIpKTtcclxuICAgIHN0YXRpc3RpY3NBY3RpdmUgPSBDb29raWVzLnNldChcInN0YXRpc3RpY3NBY3RpdmVcIikgPT0gXCJ0cnVlXCI7XHJcbiAgICBjb25zb2xlLmxvZyhcInN0YXRpc3RpY3M6XCIsIENvb2tpZXMuc2V0KFwic3RhdGlzdGljc0FjdGl2ZVwiKSk7XHJcblxyXG4gICAgc3RhdGlzdGljc0FjdGl2ZTtcclxuICAgIGlucHV0LnZhbHVlID0gc3RhcnQ7XHJcbiAgICBjb25zb2xlLmxvZyhcIlNUU0ZTREZcIiwgQ29va2llcy5nZXQoXCJkZWNrXCIpKSxcclxuICAgICAgKHByb21pc2UgPSBDYXJkTG9hZGVyLmNyZWF0ZURlY2soc3RhcnQsIChwLCBhKSA9PiBzcChwLCBhKSkpO1xyXG4gIH0pO1xyXG5cclxuICBmdW5jdGlvbiBvblR5cGluZygpIHtcclxuICAgIENvb2tpZXMuc2V0KFwiZGVja1wiLCBpbnB1dC52YWx1ZSwgeyBleHBpcmVzOiA3IH0pO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gZ2V0SGVpZ2h0KG1hbmEsIGdyb3Vwcykge1xyXG4gICAgcmV0dXJuIDEwMCAqIChtYW5hIC8gTWF0aC5tYXgoLi4uZ3JvdXBzW1wibWFuYUN1cnZlXCJdKSk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBvcGVuSGVscCgpIHtcclxuICAgIGhlbHBBY3RpdmUgPSAhaGVscEFjdGl2ZTtcclxuICAgIENvb2tpZXMuc2V0KFwiaGVscEFjdGl2ZVwiLCBoZWxwQWN0aXZlICsgXCJcIik7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiB0b2dnbGVTZWFyY2goKSB7XHJcbiAgICBjYXJkU2VhcmNoQWN0aXZlID0gIWNhcmRTZWFyY2hBY3RpdmU7XHJcbiAgICBDb29raWVzLnNldChcImNhcmRTZWFyY2hBY3RpdmVcIiwgY2FyZFNlYXJjaEFjdGl2ZSArIFwiXCIpO1xyXG4gIH1cclxuICBmdW5jdGlvbiB0b2dnbGVTdGF0aXN0aWNzKCkge1xyXG4gICAgc3RhdGlzdGljc0FjdGl2ZSA9ICFzdGF0aXN0aWNzQWN0aXZlO1xyXG4gICAgQ29va2llcy5zZXQoXCJzdGF0aXN0aWNzQWN0aXZlXCIsIHN0YXRpc3RpY3NBY3RpdmUgKyBcIlwiKTtcclxuICB9XHJcbjwvc2NyaXB0PlxyXG5cclxuPHN0eWxlPlxyXG4gIC5jb250ZW50IHtcclxuICAgIC0tcmFpc2luLWJsYWNrOiBoc2xhKDIwMCwgOCUsIDE1JSwgMSk7XHJcbiAgICAtLXJvbWFuLXNpbHZlcjogaHNsYSgxOTYsIDE1JSwgNjAlLCAxKTtcclxuICAgIC0tY29sb3JsZXNzOiBoc2xhKDAsIDAlLCA4OSUsIDEpO1xyXG4gICAgLS1ibGFjazogaHNsYSg4MywgOCUsIDM4JSwgMSk7XHJcbiAgICAtLXdoaXRlOiBoc2woNDgsIDY0JSwgODklKTtcclxuICAgIC0tcmVkOiBoc2xhKDAsIDcxJSwgODQlLCAxKTtcclxuICAgIC0tZ3JlZW46IGhzbGEoMTE0LCA2MCUsIDc1JSwgMSk7XHJcbiAgICAtLWJsdWU6IGhzbGEoMjM1LCA1NSUsIDgxJSwgMSk7XHJcbiAgfVxyXG5cclxuICAuY29udGVudCB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICAgIHdpZHRoOiAxMDAlO1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gIH1cclxuXHJcbiAgLmhlbHAtc3ltYm9sIHtcclxuICAgIGJvcmRlci1yYWRpdXM6IDUwJTtcclxuICAgIGJvcmRlcjogMXB4IHNvbGlkIGJsYWNrO1xyXG4gICAgd2lkdGg6IDE2cHg7XHJcbiAgICBoZWlnaHQ6IDE2cHg7XHJcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICByaWdodDogMTBweDtcclxuICAgIHRvcDogMTBweDtcclxuICAgIGN1cnNvcjogcG9pbnRlcjtcclxuICB9XHJcblxyXG4gIC5oZWxwLXN5bWJvbDpob3ZlciB7XHJcbiAgICBib3JkZXItY29sb3I6IGJsdWU7XHJcbiAgICBjb2xvcjogYmx1ZTtcclxuICB9XHJcblxyXG4gIC50b2dnbGUtc2VhcmNoIHtcclxuICAgIGJhY2tncm91bmQ6IGJsdWU7XHJcbiAgICB3aWR0aDogMzBweDtcclxuICAgIGhlaWdodDogMzBweDtcclxuICAgIGN1cnNvcjogcG9pbnRlcjtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIGxlZnQ6IC0zMHB4O1xyXG4gICAgdG9wOiA1MCU7XHJcbiAgICB1c2VyLXNlbGVjdDogbm9uZTtcclxuICB9XHJcblxyXG4gIC5oaWRlIC50b2dnbGUtc2VhcmNoIHtcclxuICAgIGxlZnQ6IC01MnB4O1xyXG4gIH1cclxuXHJcbiAgLnN0YXRpc3RpY3Mge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XHJcbiAgfVxyXG4gIC5pbnB1dCB7XHJcbiAgICB3aWR0aDogMTAwJTtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICAgIGJveC1zaXppbmc6IGJvcmRlci1ib3g7XHJcbiAgICBwYWRkaW5nOiAxMHB4O1xyXG4gICAgcmVzaXplOiBub25lO1xyXG4gIH1cclxuXHJcbiAgLmNvbnRyb2xzIHtcclxuICAgIGZsZXgtc2hyaW5rOiAwO1xyXG4gICAgd2lkdGg6IDMwMHB4O1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gICAgYmFja2dyb3VuZDogbGlnaHRncmF5O1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XHJcbiAgfVxyXG5cclxuICAuaGVscCB7XHJcbiAgICBwYWRkaW5nOiAwcHggMTBweCAxMHB4IDEwcHg7XHJcbiAgICB1c2VyLXNlbGVjdDogbm9uZTtcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICB9XHJcblxyXG4gIC5ncm91cC1jb250ZW50IHtcclxuICAgIGZsZXgtZ3JvdzogMTtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LXdyYXA6IHdyYXA7XHJcbiAgICB0cmFuc2l0aW9uOiBoZWlnaHQgNTAwbXMgZWFzZTtcclxuICB9XHJcblxyXG4gIC5ncm91cC1jb250ZW50LmhpZGRlbiB7XHJcbiAgICBvdmVyZmxvdzogaGlkZGVuO1xyXG4gICAgaGVpZ2h0OiA0NXB4O1xyXG4gIH1cclxuXHJcbiAgLmNhcmQtc2VhcmNoIHtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICAgIGZsZXgtZ3JvdzogMTtcclxuICAgIGJhY2tncm91bmQ6IHdoaXRlO1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICByaWdodDogMDtcclxuICAgIHdpZHRoOiAzMyU7XHJcbiAgICB6LWluZGV4OiAxMDA7XHJcbiAgICBib3gtc2hhZG93OiAwcHggMHB4IDEwcHggYmxhY2s7XHJcbiAgfVxyXG5cclxuICAuY2FyZC1zZWFyY2guaGlkZSB7XHJcbiAgICByaWdodDogLTMzJTtcclxuICB9XHJcblxyXG4gIC5zZWFyY2gtcGFyYW1zIHtcclxuICAgIGZsZXgtc2hyaW5rOiAwO1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XHJcbiAgfVxyXG5cclxuICAuc2VhcmNoLXJlc3VsdCB7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgICBmbGV4LWdyb3c6IDE7XHJcbiAgICBiYWNrZ3JvdW5kOiB3aGl0ZTtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gICAgb3ZlcmZsb3c6IGF1dG87XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgICB1c2VyLXNlbGVjdDogbm9uZTtcclxuICAgIGZsZXgtd3JhcDogd3JhcDtcclxuICB9XHJcblxyXG4gIC5kaXNwbGF5IHtcclxuICAgIGZsZXgtZ3JvdzogMTtcclxuICAgIGJhY2tncm91bmQ6IGdyYXk7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcclxuICAgIGZsZXgtd3JhcDogbm93cmFwO1xyXG4gICAgb3ZlcmZsb3c6IGF1dG87XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgICB1c2VyLXNlbGVjdDogbm9uZTtcclxuICB9XHJcblxyXG4gIC5sb2FkaW5nLXdyYXBwZXIge1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgbGVmdDogNTAlO1xyXG4gICAgdG9wOiAwO1xyXG4gICAgYm90dG9tOiAwO1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7XHJcbiAgfVxyXG5cclxuICAuZW50cnkge1xyXG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xyXG4gICAgcGFkZGluZzogMTBweDtcclxuICAgIGZsZXgtc2hyaW5rOiAwO1xyXG4gIH1cclxuICAuY2FyZCB7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICBib3JkZXI6IDZweCBzb2xpZCByZ2IoMjIsIDIyLCAyMik7XHJcbiAgICBib3JkZXItcmFkaXVzOiAxMHB4O1xyXG4gICAgb3V0bGluZTogMDtcclxuICAgIGJveC1zaGFkb3c6IDBweCAwcHggMTBweCBibGFjaztcclxuICB9XHJcblxyXG4gIC5jYXJkLmJhbm5lZCB7XHJcbiAgICBib3JkZXI6IDZweCBzb2xpZCByZWQ7XHJcbiAgfVxyXG5cclxuICAuY2FyZC5oaWdobGlnaHRlZCB7XHJcbiAgICBib3JkZXI6IDZweCBzb2xpZCB5ZWxsb3c7XHJcbiAgfVxyXG5cclxuICAuY2FyZDpob3ZlciB7XHJcbiAgICBib3JkZXI6IDZweCBzb2xpZCBibHVlO1xyXG4gICAgY3Vyc29yOiBwb2ludGVyO1xyXG4gIH1cclxuXHJcbiAgLnByaWNlLFxyXG4gIC5iYW5uZWQtdGV4dCxcclxuICAuY291bnQge1xyXG4gICAgZm9udC1zaXplOiAzNHB4O1xyXG4gICAgdGV4dC1zaGFkb3c6IDBweCAwcHggOXB4IGJsYWNrO1xyXG4gICAgY29sb3I6IHJlZDtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIHotaW5kZXg6IDEwMDtcclxuICAgIGZvbnQtd2VpZ2h0OiBib2xkO1xyXG4gICAgbGVmdDogMzRweDtcclxuICB9XHJcblxyXG4gIC5iYW5uZWQtdGV4dCB7XHJcbiAgICBmb250LXNpemU6IDEwMCU7XHJcbiAgICB0ZXh0LXNoYWRvdzogMHB4IDBweCA5cHggYmxhY2s7XHJcbiAgICBjb2xvcjogcmVkO1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgei1pbmRleDogMTAwO1xyXG4gICAgZm9udC13ZWlnaHQ6IGJvbGQ7XHJcbiAgICBsZWZ0OiAxNyU7XHJcbiAgfVxyXG4gIC5jb3VudCB7XHJcbiAgICB0b3A6IDE2NXB4O1xyXG4gIH1cclxuXHJcbiAgLnByaWNlIHtcclxuICAgIGJvdHRvbTogN3B4O1xyXG4gICAgY29sb3I6IHdoZWF0O1xyXG4gICAgZm9udC1zaXplOiAxMnB4O1xyXG4gICAgYmFja2dyb3VuZDogYmxhY2s7XHJcbiAgICBsZWZ0OiA0NSU7XHJcbiAgICBmb250LXdlaWdodDogbm9ybWFsO1xyXG4gIH1cclxuXHJcbiAgLmdyb3VwLWhlYWRlciB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgYmFja2dyb3VuZDogZGFya2dyZXk7XHJcbiAgICAvKiBwYWRkaW5nOiA4cHg7ICovXHJcbiAgICBtYXJnaW46IDhweCAwO1xyXG4gICAgYm94LXNoYWRvdzogMHB4IDBweCA4cHggYmxhY2s7XHJcbiAgICB3aWR0aDogMTAwJTtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgfVxyXG5cclxuICAuZ3JvdXAtaGVhZGVyIGgyIHtcclxuICAgIHBhZGRpbmc6IDAgMjVweDtcclxuICAgIG1hcmdpbjogMHB4O1xyXG4gIH1cclxuXHJcbiAgLmdyb3VwLXN0YXRpc3RpY3Mge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgfVxyXG5cclxuICAubWFuYS1wcm9wb3NhbCxcclxuICAubWFuYS1kZXZvdGlvbiB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICB9XHJcblxyXG4gIC5kZWNrLXZhbHVlLFxyXG4gIC5ncm91cC12YWx1ZSB7XHJcbiAgICBwYWRkaW5nOiA1cHg7XHJcbiAgICBjb2xvcjogYmxhY2s7XHJcbiAgICBib3JkZXItcmFkaXVzOiA1MCU7XHJcbiAgICB3aWR0aDogMTVweDtcclxuICAgIGhlaWdodDogMTVweDtcclxuICAgIHRleHQtYWxpZ246IGNlbnRlcjtcclxuICAgIG1hcmdpbjogNXB4O1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIHRleHQtYWxpZ246IGNlbnRlcjtcclxuICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7XHJcbiAgICBmb250LXNpemU6IDExcHg7XHJcbiAgICBmb250LXdlaWdodDogYm9sZDtcclxuICB9XHJcbiAgLmJsdWUge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0tYmx1ZSk7XHJcbiAgfVxyXG4gIC5ibGFjayB7XHJcbiAgICBjb2xvcjogd2hpdGU7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS1ibGFjayk7XHJcbiAgfVxyXG4gIC5yZWQge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0tcmVkKTtcclxuICB9XHJcbiAgLndoaXRlIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLXdoaXRlKTtcclxuICB9XHJcbiAgLmdyZWVuIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWdyZWVuKTtcclxuICB9XHJcbiAgLmNvbG9ybGVzcyB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS1jb2xvcmxlc3MpO1xyXG4gIH1cclxuICAuZ2VuZXJpYyB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiBnb2xkZW5yb2Q7XHJcbiAgfVxyXG4gIC5zdW0ge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogZ29sZGVucm9kO1xyXG4gIH1cclxuXHJcbiAgLmNvbG9yLXBhcmFtIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gIH1cclxuXHJcbiAgLm1hbmEtY3VydmUge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XHJcbiAgfVxyXG5cclxuICAuYWxsLWN1cnZlcyB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1ncm93OiAxO1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICAgIGhlaWdodDogODBweDtcclxuICB9XHJcblxyXG4gIC5hbGwtbGFiZWxzIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LXNocmluazogMDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgfVxyXG5cclxuICAuY3VydmUtZWxlbWVudCB7XHJcbiAgICB3aWR0aDogMjBweDtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICBib3R0b206IDA7XHJcbiAgICBiYWNrZ3JvdW5kOiBncmF5O1xyXG4gICAgLyogdmVydGljYWwtYWxpZ246IG1pZGRsZTsgKi9cclxuICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgfVxyXG5cclxuICAuY3VydmUtbGFiZWwge1xyXG4gICAgd2lkdGg6IDIwcHg7XHJcbiAgfVxyXG4gIC5jdXJ2ZS13cmFwcGVyIHtcclxuICAgIHdpZHRoOiAyMHB4O1xyXG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xyXG4gICAgY3Vyc29yOiBwb2ludGVyO1xyXG4gIH1cclxuXHJcbiAgLmN1cnZlLWVsZW1lbnQ6aG92ZXIge1xyXG4gICAgYmFja2dyb3VuZDogbGlnaHRjb3JhbDtcclxuICB9XHJcblxyXG4gIC5oaWdobGlnaHRlZCAuY3VydmUtZWxlbWVudCB7XHJcbiAgICBiYWNrZ3JvdW5kOiBsaWdodGJsdWU7XHJcbiAgfVxyXG5cclxuICAuY3VydmUtbGFiZWwuaGlnaGxpZ2h0ZWQge1xyXG4gICAgYmFja2dyb3VuZDogbGlnaHRibHVlO1xyXG4gIH1cclxuXHJcbiAgLmN1cnZlLWxhYmVsOmhvdmVyIHtcclxuICAgIGJhY2tncm91bmQ6IGxpZ2h0Y29yYWw7XHJcbiAgfVxyXG5cclxuICBoNCB7XHJcbiAgICBtYXJnaW4tdG9wOiA1cHg7XHJcbiAgICBtYXJnaW4tYm90dG9tOiA1cHg7XHJcbiAgfVxyXG5cclxuICAubGRzLXJpcHBsZSB7XHJcbiAgICBkaXNwbGF5OiBpbmxpbmUtYmxvY2s7XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgICB3aWR0aDogODBweDtcclxuICAgIGhlaWdodDogODBweDtcclxuICB9XHJcbiAgLmxkcy1yaXBwbGUgZGl2IHtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIGJvcmRlcjogNHB4IHNvbGlkICNmZmY7XHJcbiAgICBvcGFjaXR5OiAxO1xyXG4gICAgYm9yZGVyLXJhZGl1czogNTAlO1xyXG4gICAgYW5pbWF0aW9uOiBsZHMtcmlwcGxlIDFzIGN1YmljLWJlemllcigwLCAwLjIsIDAuOCwgMSkgaW5maW5pdGU7XHJcbiAgfVxyXG4gIC5sZHMtcmlwcGxlIGRpdjpudGgtY2hpbGQoMikge1xyXG4gICAgYW5pbWF0aW9uLWRlbGF5OiAtMC41cztcclxuICB9XHJcbiAgQGtleWZyYW1lcyBsZHMtcmlwcGxlIHtcclxuICAgIDAlIHtcclxuICAgICAgdG9wOiAzNnB4O1xyXG4gICAgICBsZWZ0OiAzNnB4O1xyXG4gICAgICB3aWR0aDogMDtcclxuICAgICAgaGVpZ2h0OiAwO1xyXG4gICAgICBvcGFjaXR5OiAxO1xyXG4gICAgfVxyXG4gICAgMTAwJSB7XHJcbiAgICAgIHRvcDogMHB4O1xyXG4gICAgICBsZWZ0OiAwcHg7XHJcbiAgICAgIHdpZHRoOiA3MnB4O1xyXG4gICAgICBoZWlnaHQ6IDcycHg7XHJcbiAgICAgIG9wYWNpdHk6IDA7XHJcbiAgICB9XHJcbiAgfVxyXG48L3N0eWxlPlxyXG5cclxuPHN2ZWx0ZTp3aW5kb3cgb246a2V5dXA9e3VwZGF0ZX0gLz5cclxuPGRpdiBjbGFzcz1cImNvbnRlbnRcIj5cclxuICA8ZGl2IGNsYXNzPVwiY29udHJvbHNcIj5cclxuICAgIDxkaXYgY2xhc3M9XCJoZWxwXCI+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJoZWxwLXN5bWJvbFwiIG9uOmNsaWNrPXtvcGVuSGVscH0+PzwvZGl2PlxyXG5cclxuICAgICAgeyNpZiBoZWxwQWN0aXZlfVxyXG4gICAgICAgIDxoND5Ib3cgdG8gdXNlOjwvaDQ+XHJcbiAgICAgICAgPHA+cGFzdGUgeW91ciBkZWNrIHRvIHRoZSBmb2xsb3dpbmcgaW5wdXQuPC9wPlxyXG4gICAgICAgIDx1bD5cclxuICAgICAgICAgIDxsaT5cclxuICAgICAgICAgICAgd2hlbiBhIGxpbmUgc3RhcnRzIHdpdGggXCIjXCIgaXQgd2lsbCBiZSBpbnRlcnByZXRlZCBhcyBoZWFkbGluZVxyXG4gICAgICAgICAgPC9saT5cclxuICAgICAgICAgIDxsaT5cclxuICAgICAgICAgICAgYSBjYXJkIGNhbiBiZSBlbnRlcmVkIHdpdGggYSBsZWFkaW5nIGNvdW50LCBvciBqdXN0IHdpdGggaXRzIG5hbWVcclxuICAgICAgICAgIDwvbGk+XHJcbiAgICAgICAgICA8bGk+dXNlIHRoZSBcIkVTQ1wiIGtleSB0byByZWFsb2FkIHRoZSBwcmV2aWV3PC9saT5cclxuICAgICAgICAgIDxsaT5kb3VibGVjbGljayBhIGNhcmQgdG8gcmVtb3ZlIGl0PC9saT5cclxuICAgICAgICA8L3VsPlxyXG4gICAgICAgIDxwPk5PVEU6IHdlIHVzZSBjb29raWVzIHRvIHN0b3JlIHlvdXIgZGVjayBhZnRlciByZWxvYWQuPC9wPlxyXG4gICAgICAgIDxwPk5PVEU6IFRoaXMgaXMgbm90IGFuIG9mZmljaWFsIE1hZ2ljIHByb2R1a3QuPC9wPlxyXG4gICAgICB7L2lmfVxyXG5cclxuICAgICAgeyNhd2FpdCBwcm9taXNlfVxyXG5cclxuICAgICAgICA8ZGl2PmxvYWRpbmc6IHtwcm9ncmVzc30ve2FsbH08L2Rpdj5cclxuICAgICAgezp0aGVuIGdyb3Vwc31cclxuXHJcbiAgICAgICAgeyNpZiAhaGVscEFjdGl2ZX1cclxuICAgICAgICAgIDxoND5HZW5lcmFsPC9oND5cclxuXHJcbiAgICAgICAgICA8ZGl2PlRvdGFsIGNhcmRzOiB7Z3JvdXBzWydjYXJkQ291bnQnXX08L2Rpdj5cclxuICAgICAgICAgIDxkaXY+XHJcbiAgICAgICAgICAgIExhbmRzOiB7Z3JvdXBzWydsYW5kQ291bnQnXX0gTm9ubGFuZHM6IHtncm91cHNbJ2NhcmRDb3VudCddIC0gZ3JvdXBzWydsYW5kQ291bnQnXX1cclxuICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgPGRpdj5Db3N0OiB7Z3JvdXBzLmNvc3QudG9GaXhlZCgyKSArICckJ308L2Rpdj5cclxuXHJcbiAgICAgICAgICB7I2lmIHN0YXRpc3RpY3NBY3RpdmV9XHJcbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJzdGF0aXN0aWNzXCI+XHJcbiAgICAgICAgICAgICAgPGg0PkRldm90aW9uPC9oND5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwibWFuYS1kZXZvdGlvblwiPlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgYmx1ZVwiPntncm91cHNbJ21hbmEnXS5ibHVlfTwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgYmxhY2tcIj57Z3JvdXBzWydtYW5hJ10uYmxhY2t9PC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSByZWRcIj57Z3JvdXBzWydtYW5hJ10ucmVkfTwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgd2hpdGVcIj57Z3JvdXBzWydtYW5hJ10ud2hpdGV9PC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBncmVlblwiPntncm91cHNbJ21hbmEnXS5ncmVlbn08L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGNvbG9ybGVzc1wiPlxyXG4gICAgICAgICAgICAgICAgICB7Z3JvdXBzWydtYW5hJ10uY29sb3JsZXNzfVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcblxyXG4gICAgICAgICAgICAgIDxoND5HZW5lcmljIE1hbmE8L2g0PlxyXG4gICAgICAgICAgICAgIDxkaXY+UmVtYWluaW5nIGdlbmVyaWMgbWFuYSBjb3N0czp7Z3JvdXBzWydtYW5hJ10uZ2VuZXJpY308L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2PkNNQy1NYW5hLVN1bTp7Z3JvdXBzWydtYW5hJ10uc3VtfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXY+XHJcbiAgICAgICAgICAgICAgICBBdmVyYWdlIENNQyBwZXIgTm9ubGFuZDoge2dyb3Vwc1snYXZlcmFnZU1hbmEnXS50b0ZpeGVkKDIpfVxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgIDxoND5TdWdnZXN0ZWQgTWFuYSBEaXN0cmlidXRpb248L2g0PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJtYW5hLXByb3Bvc2FsXCI+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBibHVlXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS5ibHVlICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgYmxhY2tcIj5cclxuICAgICAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLmJsYWNrICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgcmVkXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS5yZWQgKiBncm91cHNbJ2xhbmRDb3VudCddKS50b0ZpeGVkKDEpfVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSB3aGl0ZVwiPlxyXG4gICAgICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10ud2hpdGUgKiBncm91cHNbJ2xhbmRDb3VudCddKS50b0ZpeGVkKDEpfVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBncmVlblwiPlxyXG4gICAgICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10uZ3JlZW4gKiBncm91cHNbJ2xhbmRDb3VudCddKS50b0ZpeGVkKDEpfVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBjb2xvcmxlc3NcIj5cclxuICAgICAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLmNvbG9ybGVzcyAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICA8aDQ+TWFuYSBDdXJ2ZTwvaDQ+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cIm1hbmEtY3VydmVcIj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJhbGwtY3VydmVzXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsjZWFjaCBncm91cHNbJ21hbmFDdXJ2ZSddIGFzIG1hbmEsIGl9XHJcbiAgICAgICAgICAgICAgICAgICAgeyNpZiBtYW5hID4gMH1cclxuICAgICAgICAgICAgICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJjdXJ2ZS13cmFwcGVyXCJcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M6aGlnaGxpZ2h0ZWQ9e2Rldm90aW9uSGlnaGxpZ2h0ID09IGl9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG9uOmNsaWNrPXsoKSA9PiBoaWdobGlnaHREZXZvdGlvbihpKX0+XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImN1cnZlLWVsZW1lbnRcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHN0eWxlPXsnaGVpZ2h0OicgKyBnZXRIZWlnaHQobWFuYSwgZ3JvdXBzKSArICclOyd9PlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHttYW5hIHx8ICcnfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgICAgIHsvaWZ9XHJcbiAgICAgICAgICAgICAgICAgIHsvZWFjaH1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJhbGwtbGFiZWxzXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsjZWFjaCBncm91cHNbJ21hbmFDdXJ2ZSddIGFzIG1hbmEsIGl9XHJcbiAgICAgICAgICAgICAgICAgICAgeyNpZiBtYW5hID4gMH1cclxuICAgICAgICAgICAgICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJjdXJ2ZS1sYWJlbFwiXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzOmhpZ2hsaWdodGVkPXtkZXZvdGlvbkhpZ2hsaWdodCA9PSBpfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBvbjpjbGljaz17KCkgPT4gaGlnaGxpZ2h0RGV2b3Rpb24obWFuYSl9PlxyXG4gICAgICAgICAgICAgICAgICAgICAgICB7aX1cclxuICAgICAgICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgICAgIHsvaWZ9XHJcbiAgICAgICAgICAgICAgICAgIHsvZWFjaH1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIHsvaWZ9XHJcbiAgICAgICAgey9pZn1cclxuXHJcbiAgICAgIHs6Y2F0Y2ggZXJyb3J9XHJcbiAgICAgICAge2Vycm9yfVxyXG4gICAgICB7L2F3YWl0fVxyXG4gICAgICBGb3JtYXQ6XHJcbiAgICAgIDxzZWxlY3QgYmluZDp0aGlzPXtmb3JtYXR9IG9uOmJsdXI9e3JlbG9hZH0gb246Y2hhbmdlPXtyZWxvYWR9PlxyXG4gICAgICAgIDxvcHRpb24gc2VsZWN0ZWQ+Y29tbWFuZGVyPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5icmF3bDwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+ZHVlbDwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+ZnV0dXJlPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5oaXN0b3JpYzwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+bGVnYWN5PC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5tb2Rlcm48L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPm9sZHNjaG9vbDwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+cGF1cGVyPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5wZW5ueTwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+cGlvbmVlcjwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+c3RhbmRhcmQ8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnZpbnRhZ2U8L29wdGlvbj5cclxuICAgICAgPC9zZWxlY3Q+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJzbGlkZWNvbnRhaW5lclwiPlxyXG4gICAgICAgIFNjYWxlOlxyXG4gICAgICAgIDxpbnB1dCB0eXBlPVwicmFuZ2VcIiBtaW49XCIyNVwiIG1heD1cIjEwMFwiIGJpbmQ6dmFsdWU9e3NjYWxpbmd9IC8+XHJcbiAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgPGJ1dHRvbiBvbjpjbGljaz17dG9nZ2xlU3RhdGlzdGljc30+dG9nZ2xlIHN0YXRpc3RpY3M8L2J1dHRvbj5cclxuICAgICAgPGJ1dHRvbiBvbjpjbGljaz17c29ydERlY2tTdHJpbmd9PnNvcnQ8L2J1dHRvbj5cclxuXHJcbiAgICA8L2Rpdj5cclxuICAgIDx0ZXh0YXJlYSBiaW5kOnRoaXM9e2lucHV0fSBjbGFzcz1cImlucHV0XCIgb246a2V5dXA9e29uVHlwaW5nfSAvPlxyXG4gIDwvZGl2PlxyXG5cclxuICA8ZGl2IGNsYXNzPVwiZGlzcGxheVwiPlxyXG4gICAgeyNhd2FpdCBwcm9taXNlfVxyXG4gICAgICA8ZGl2IGNsYXNzPVwibG9hZGluZy13cmFwcGVyXCI+XHJcbiAgICAgICAgPGRpdj5sb2FkaW5nOiB7cHJvZ3Jlc3N9L3thbGx9PC9kaXY+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImxkcy1yaXBwbGVcIj5cclxuICAgICAgICAgIDxkaXYgLz5cclxuICAgICAgICAgIDxkaXYgLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgPC9kaXY+XHJcbiAgICB7OnRoZW4gZ3JvdXBzfVxyXG5cclxuICAgICAgeyNlYWNoIGdyb3VwcyB8fCBbXSBhcyBncm91cH1cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXBcIj5cclxuXHJcbiAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtaGVhZGVyXCI+XHJcbiAgICAgICAgICAgIDxoMj57Z3JvdXAubmFtZSArICcgLy8gJyArIGdyb3VwLmNvdW50IHx8ICdubyBuYW1lJ308L2gyPlxyXG4gICAgICAgICAgICA8YnV0dG9uIG9uOmNsaWNrPXsoKSA9PiB0b2dnbGVHcm91cFZpc2liaWxpdHkoZ3JvdXApfT5cclxuICAgICAgICAgICAgICB0b2dnbGVcclxuICAgICAgICAgICAgPC9idXR0b24+XHJcbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC1zdGF0aXN0aWNzXCI+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGJsdWVcIj57Z3JvdXAubWFuYS5ibHVlfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSBibGFja1wiPntncm91cC5tYW5hLmJsYWNrfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSByZWRcIj57Z3JvdXAubWFuYS5yZWR9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIHdoaXRlXCI+e2dyb3VwLm1hbmEud2hpdGV9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGdyZWVuXCI+e2dyb3VwLm1hbmEuZ3JlZW59PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGNvbG9ybGVzc1wiPntncm91cC5tYW5hLmNvbG9ybGVzc308L2Rpdj5cclxuICAgICAgICAgICAgICA8IS0tIGdlbmVyaWM6XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGdlbmVyaWNcIj57Z3JvdXAubWFuYS5nZW5lcmljfTwvZGl2PiAtLT5cclxuICAgICAgICAgICAgICBzdW06XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIHN1bVwiPntncm91cC5tYW5hLnN1bX08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgZ3JvdXAtY29zdFwiPlxyXG4gICAgICAgICAgICAgICAge2dyb3VwLmNvc3QudG9GaXhlZCgyKSArICckJ31cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgPC9kaXY+XHJcblxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgIGNsYXNzPVwiZ3JvdXAtY29udGVudFwiXHJcbiAgICAgICAgICAgIGNsYXNzOmhpZGRlbj17aGlkZGVuR3JvdXBzLmhhcyhncm91cC5uYW1lKX0+XHJcblxyXG4gICAgICAgICAgICB7I2VhY2ggZ3JvdXAuY2FyZHMgYXMgY2FyZH1cclxuICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICBjbGFzcz1cImVudHJ5XCJcclxuICAgICAgICAgICAgICAgIHN0eWxlPXsnd2lkdGg6JyArIHdpZHRoICsgJ3B4OyBoZWlnaHQ6JyArIChjYXJkLmNvdW50IDw9IDQgPyBoZWlnaHQgKyAoKGNhcmQuY291bnQgfHwgMSkgLSAxKSAqIDQwIDogaGVpZ2h0ICsgMyAqIDQwKSArICdweDsnfT5cclxuXHJcbiAgICAgICAgICAgICAgICB7I2VhY2ggeyBsZW5ndGg6IGNhcmQuY291bnQgPiA0ID8gNCA6IGNhcmQuY291bnQgfSBhcyBfLCBpfVxyXG4gICAgICAgICAgICAgICAgICA8aW1nXHJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M6YmFubmVkPXtjYXJkLmRhdGEubGVnYWxpdGllc1tmb3JtYXQudmFsdWVdICE9PSAnbGVnYWwnfVxyXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzOmhpZ2hsaWdodGVkPXtkZXZvdGlvbkhpZ2hsaWdodCA9PSBjYXJkLmRhdGEuY21jfVxyXG4gICAgICAgICAgICAgICAgICAgIG9uOmRibGNsaWNrPXsoKSA9PiByZW1vdmUoY2FyZCl9XHJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJjYXJkXCJcclxuICAgICAgICAgICAgICAgICAgICBzdHlsZT17J21hcmdpbi10b3A6ICcgKyBpICogNDAgKyAncHgnfVxyXG4gICAgICAgICAgICAgICAgICAgIHNyYz17Y2FyZC51cmx9XHJcbiAgICAgICAgICAgICAgICAgICAgYWx0PXtjYXJkLm5hbWV9XHJcbiAgICAgICAgICAgICAgICAgICAge3dpZHRofVxyXG4gICAgICAgICAgICAgICAgICAgIHtoZWlnaHR9IC8+XHJcbiAgICAgICAgICAgICAgICB7L2VhY2h9XHJcblxyXG4gICAgICAgICAgICAgICAgeyNpZiBjYXJkLmRhdGEubGVnYWxpdGllc1tmb3JtYXQudmFsdWVdICE9PSAnbGVnYWwnfVxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiYmFubmVkLXRleHRcIj5CQU5ORUQ8L2Rpdj5cclxuICAgICAgICAgICAgICAgIHsvaWZ9XHJcbiAgICAgICAgICAgICAgICB7I2lmIGNhcmQuY291bnQgPiA0fVxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiY291bnRcIj57Y2FyZC5jb3VudH14PC9kaXY+XHJcbiAgICAgICAgICAgICAgICB7L2lmfVxyXG5cclxuICAgICAgICAgICAgICAgIHsjaWYgc2NhbGluZyA+IDkwfVxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwicHJpY2VcIj57Y2FyZC5kYXRhLnByaWNlcy51c2QgKyAnJCcgfHwgJz8/Pyd9PC9kaXY+XHJcbiAgICAgICAgICAgICAgICB7L2lmfVxyXG5cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgey9lYWNofVxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgIHsvZWFjaH1cclxuXHJcbiAgICB7OmNhdGNoIGVycm9yfVxyXG5cclxuICAgICAgPGRpdiBjbGFzcz1cImVycm9yXCI+XHJcbiAgICAgICAgRVJST1IsIGNoZWNrIHlvdXIgZGVja2xpc3QgZm9yIGNvcnJlY3QgZm9ybWF0IG9yIGludGVybmV0IGNvbm5lY3Rpb25cclxuICAgICAgICBicnVkaVxyXG4gICAgICA8L2Rpdj5cclxuICAgIHsvYXdhaXR9XHJcbiAgPC9kaXY+XHJcblxyXG4gIDxkaXYgY2xhc3M9XCJjYXJkLXNlYXJjaFwiIGNsYXNzOmhpZGU9eyFjYXJkU2VhcmNoQWN0aXZlfT5cclxuICAgIDxkaXYgY2xhc3M9XCJ0b2dnbGUtc2VhcmNoXCIgb246Y2xpY2s9e3RvZ2dsZVNlYXJjaH0+eDwvZGl2PlxyXG4gICAgPGRpdiBjbGFzcz1cInNlYXJjaC1wYXJhbXNcIj5cclxuICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1wYXJhbVwiPlxyXG4gICAgICAgIE5hbWU6XHJcbiAgICAgICAgPGlucHV0IGJpbmQ6dGhpcz17c3BOYW1lfSAvPlxyXG4gICAgICA8L2Rpdj5cclxuICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1wYXJhbVwiPlxyXG4gICAgICAgIFRleHQ6XHJcbiAgICAgICAgPGlucHV0IGJpbmQ6dGhpcz17c3BUZXh0fSAvPlxyXG4gICAgICA8L2Rpdj5cclxuXHJcbiAgICAgIDxkaXYgY2xhc3M9XCJzZWFyY2gtcGFyYW0gY29sb3ItcGFyYW1cIj5cclxuICAgICAgICBDb21tYW5kZXItQ29sb3JzOlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJibHVlXCI+XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgdHlwZT1cImNoZWNrYm94XCJcclxuICAgICAgICAgICAgb246Y2xpY2s9e2NsZWFyQ29sb3JsZXNzfVxyXG4gICAgICAgICAgICBjbGFzcz1cImJsdWVcIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIQmx1ZX0gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiYmxhY2tcIj5cclxuICAgICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgICB0eXBlPVwiY2hlY2tib3hcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17Y2xlYXJDb2xvcmxlc3N9XHJcbiAgICAgICAgICAgIGNsYXNzPVwiYmxhY2tcIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIQmxhY2t9IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cInJlZFwiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJyZWRcIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIUmVkfSAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJ3aGl0ZVwiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJ3aGl0ZVwiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhXaGl0ZX0gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JlZW5cIj5cclxuICAgICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgICB0eXBlPVwiY2hlY2tib3hcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17Y2xlYXJDb2xvcmxlc3N9XHJcbiAgICAgICAgICAgIGNsYXNzPVwiZ3JlZW5cIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIR3JlZW59IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImNvbG9ybGVzc1wiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckZvckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJjb2xvcmxlc3NcIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIQ29sb3JsZXNzfSAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICA8L2Rpdj5cclxuICAgICAgPGJ1dHRvbiBvbjpjbGljaz17c2VhcmNoQ2FyZHN9PnNlYXJjaDwvYnV0dG9uPlxyXG4gICAgPC9kaXY+XHJcblxyXG4gICAgeyNhd2FpdCBjYXJkU2VhcmNoUHJvbWlzZX1cclxuICAgICAgPGRpdiBjbGFzcz1cImxvYWRpbmctd3JhcHBlclwiPlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJsZHMtcmlwcGxlXCI+XHJcbiAgICAgICAgICA8ZGl2IC8+XHJcbiAgICAgICAgICA8ZGl2IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgezp0aGVuIHJlc3VsdH1cclxuICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1yZXN1bHRcIj5cclxuICAgICAgICB7I2VhY2ggcmVzdWx0LmRhdGEgYXMgY2FyZH1cclxuICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgY2xhc3M9XCJlbnRyeVwiXHJcbiAgICAgICAgICAgIHN0eWxlPXsnd2lkdGg6JyArIHdpZHRoICsgJ3B4OyBoZWlnaHQ6JyArIGhlaWdodCArICdweDsnfT5cclxuICAgICAgICAgICAgPGltZ1xyXG4gICAgICAgICAgICAgIG9uOmRibGNsaWNrPXsoKSA9PiBhcHBlbmRDYXJkKGNhcmQubmFtZSl9XHJcbiAgICAgICAgICAgICAgY2xhc3M6YmFubmVkPXtjYXJkLmxlZ2FsaXRpZXNbZm9ybWF0LnZhbHVlXSAhPT0gJ2xlZ2FsJ31cclxuICAgICAgICAgICAgICBjbGFzcz1cImNhcmRcIlxyXG4gICAgICAgICAgICAgIHNyYz17Y2FyZC51cmx9XHJcbiAgICAgICAgICAgICAgYWx0PXtjYXJkLm5hbWV9XHJcbiAgICAgICAgICAgICAge3dpZHRofVxyXG4gICAgICAgICAgICAgIHtoZWlnaHR9IC8+XHJcblxyXG4gICAgICAgICAgICB7I2lmIGNhcmQubGVnYWxpdGllc1tmb3JtYXQudmFsdWVdICE9PSAnbGVnYWwnfVxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJiYW5uZWQtdGV4dFwiPkJBTk5FRDwvZGl2PlxyXG4gICAgICAgICAgICB7L2lmfVxyXG4gICAgICAgICAgICB7I2lmIHNjYWxpbmcgPiA5MH1cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwicHJpY2VcIj57Y2FyZC5wcmljZXMudXNkICsgJyQnIHx8ICc/Pz8nfTwvZGl2PlxyXG4gICAgICAgICAgICB7L2lmfVxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgezplbHNlfVxyXG4gICAgICAgICAgPGRpdj5ObyBjYXJkcyBmb3VuZDwvZGl2PlxyXG4gICAgICAgIHsvZWFjaH1cclxuICAgICAgPC9kaXY+XHJcbiAgICAgIDxidXR0b25cclxuICAgICAgICBkaXNhYmxlZD17IXJlc3VsdC5oYXNfbW9yZX1cclxuICAgICAgICBvbjpjbGljaz17KCkgPT4gc2VhcmNoQ2FyZHMocmVzdWx0Lm5leHRfcGFnZSl9PlxyXG4gICAgICAgIG5leHRcclxuICAgICAgPC9idXR0b24+XHJcbiAgICB7OmNhdGNoIGVycm9yfVxyXG4gICAgICA8ZGl2IGNsYXNzPVwiZXJyb3JcIj5cclxuICAgICAgICBFUlJPUiwgY2hlY2sgeW91ciBkZWNrbGlzdCBmb3IgY29ycmVjdCBmb3JtYXQgb3IgaW50ZXJuZXQgY29ubmVjdGlvblxyXG4gICAgICAgIGJydWRpXHJcbiAgICAgIDwvZGl2PlxyXG4gICAgey9hd2FpdH1cclxuXHJcbiAgPC9kaXY+XHJcbjwvZGl2PlxyXG4iLCJpbXBvcnQgTWFpblZpZXcgZnJvbSBcIi4vZWRpdG9yLnN2ZWx0ZVwiO1xyXG5cclxuXHJcbmNvbnN0IHJlbmRlclRhcmdldCA9IG5ldyBNYWluVmlldyh7XHJcbiAgdGFyZ2V0OiBkb2N1bWVudC5ib2R5LFxyXG4gIHByb3BzOiB7XHJcbiAgICB0ZXN0OiBcInNkZmRzZlwiXHJcbiAgfVxyXG59KTsiXSwibmFtZXMiOlsiQ2FyZExvYWRlciIsIkNvb2tpZXMiLCJNYWluVmlldyJdLCJtYXBwaW5ncyI6Ijs7O0lBQUEsU0FBUyxJQUFJLEdBQUcsR0FBRztBQUNuQixJQU9BLFNBQVMsVUFBVSxDQUFDLEtBQUssRUFBRTtJQUMzQixJQUFJLE9BQU8sS0FBSyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxPQUFPLEtBQUssQ0FBQyxJQUFJLEtBQUssVUFBVSxDQUFDO0lBQ2xGLENBQUM7QUFDRCxJQUtBLFNBQVMsR0FBRyxDQUFDLEVBQUUsRUFBRTtJQUNqQixJQUFJLE9BQU8sRUFBRSxFQUFFLENBQUM7SUFDaEIsQ0FBQztJQUNELFNBQVMsWUFBWSxHQUFHO0lBQ3hCLElBQUksT0FBTyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQy9CLENBQUM7SUFDRCxTQUFTLE9BQU8sQ0FBQyxHQUFHLEVBQUU7SUFDdEIsSUFBSSxHQUFHLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ3JCLENBQUM7SUFDRCxTQUFTLFdBQVcsQ0FBQyxLQUFLLEVBQUU7SUFDNUIsSUFBSSxPQUFPLE9BQU8sS0FBSyxLQUFLLFVBQVUsQ0FBQztJQUN2QyxDQUFDO0lBQ0QsU0FBUyxjQUFjLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRTtJQUM5QixJQUFJLE9BQU8sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksT0FBTyxDQUFDLEtB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QUUsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO0lBQ3BELE1BQU0sSUFBSSxDQUFDLElBQUksRUFBRSxTQUFTO0lBQzFCO0lBQ0EsTUFBTSxJQUFJO0lBQ1YsUUFBUSxJQUFJLElBQUksR0FBRyxNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUM7O0lBRS9DLFFBQVEsSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLFdBQVcsRUFBRSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsRUFBRTtJQUMzRCxVQUFVLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDckYsVUFBVSxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssRUFBRSxDQUFDO0lBQ25DLFNBQVMsTUFBTSxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsV0FBVyxFQUFFLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxFQUFFO0lBQ3RFLFVBQVUsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxDQUFDLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztJQUM3RixVQUFVLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUM7SUFDdkMsU0FBUyxNQUFNO0lBQ2YsVUFBVSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLENBQUMsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO0lB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QUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDO0lBQ2xGLFFBQVEsUUFBUSxDQUFDLEtBQUssSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUM7SUFDbkYsUUFBUSxRQUFRLENBQUMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQztJQUNqRixRQUFRLFFBQVEsQ0FBQyxLQUFLLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDO0lBQ25GLFFBQVEsUUFBUSxDQUFDLEtBQUssSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUM7SUFDbkYsUUFBUSxRQUFRLENBQUMsU0FBUyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQztJQUN2RixRQUFRLFFBQVEsQ0FBQyxPQUFPLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUM7SUFDdEcsUUFBUSxRQUFRLENBQUMsR0FBRyxHQUFHLFFBQVEsQ0FBQyxJQUFJLEdBQUcsUUFBUSxDQUFDLEtBQUss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
