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

      async cardByName(name) {
        if (this.__cache[name]) return this.__cache[name];
        await timeout();
        //https://api.scryfall.com/cards/named?fuzzy=aust+com 
        const fixed = name.replace(/\s/g, "+");
        const result = await fetch('https://api.scryfall.com/cards/named?fuzzy=' + fixed)
          .then(response => response.json()).catch(e => { console.log(e); return { code: "not_found" }; });

        this.__cache[name] = result;

        return result;
        // .then(data => console.log(data));
        /* for (let card of CARD_DATA) {
           if (card.name.toLowerCase() == name.toLowerCase()) return card;
         }*/
      }


      /**
       * converts a deck string to a readable object
       * and downloads the img data on demand, if it does not exist
       *
       * @param {String} deckString the complete deck, copied from a site or e.g forge
       * @memberof MtgInterface
       */
      async createDeck(deckString, update = () => {}) {
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
        // iterate each found card
        for (let card of deckRaw) {
          if (!card) continue;
          if (card.includes("#")) {
            curGroup++;
            if (curGroup > groups.length) curGroup = 0;
            continue;
          }
          progress++;
          const deck = groups[curGroup].deck;
          update(progress, deckRaw.length - groups.length + 1);
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
            devotion.blue += (card.data.mana_cost.split("U").length - 1) * card.count;
            devotion.black += (card.data.mana_cost.split("B").length - 1) * card.count;
            devotion.red += (card.data.mana_cost.split("R").length - 1) * card.count;
            devotion.white += (card.data.mana_cost.split("W").length - 1) * card.count;
            devotion.green += (card.data.mana_cost.split("G").length - 1) * card.count;
            devotion.colorless += (card.data.mana_cost.split("C").length - 1) * card.count;
            devotion.generic += Math.floor(card.data.mana_cost.replace(/[^0-9.]/g, "") || 0) * card.count;
            devotion.sum = devotion.blue + devotion.black + devotion.red + devotion.green + devotion.white + devotion.colorless + devotion.generic;
          }
          overallCost += cost;
          overallCount += count;
          group.count = count;
          group.mana = devotion;
          group.cost = cost;

          group.manaCurve = manaCurve;
          for (let i = 0; i < manaCurve.length; i++) {
            manaCurve[i] = manaCurve[i] || 0;
            overallManaCurve[i] = (overallManaCurve[i] || 0) + (manaCurve[i] || 0);
          }

          overallDevotion.blue += devotion.blue;
          overallDevotion.black += devotion.black;
          overallDevotion.red += devotion.red;
          overallDevotion.white += devotion.white;
          overallDevotion.green += devotion.green;
          overallDevotion.colorless += devotion.colorless;

          overallDevotion.generic += devotion.generic;
          overallDevotion.sum += devotion.sum;
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
    	style.id = "svelte-aty83l-style";
    	style.textContent = ".content.svelte-aty83l.svelte-aty83l{--raisin-black:hsla(200, 8%, 15%, 1);--roman-silver:hsla(196, 15%, 60%, 1);--colorless:hsla(0, 0%, 89%, 1);--black:hsla(83, 8%, 38%, 1);--white:hsl(48, 64%, 89%);--red:hsla(0, 71%, 84%, 1);--green:hsla(114, 60%, 75%, 1);--blue:hsla(235, 55%, 81%, 1)}.content.svelte-aty83l.svelte-aty83l{display:flex;flex-direction:row;width:100%;height:100%}.statistics.svelte-aty83l.svelte-aty83l{display:flex;flex-direction:column}.input.svelte-aty83l.svelte-aty83l{width:100%;height:100%;box-sizing:border-box;padding:10px;resize:none}.controls.svelte-aty83l.svelte-aty83l{flex-shrink:0;width:300px;height:100%;background:lightgray;display:flex;flex-direction:column}.help.svelte-aty83l.svelte-aty83l{padding:0px 10px 10px 10px;user-select:none}.group-content.svelte-aty83l.svelte-aty83l{flex-grow:1;display:flex;flex-wrap:wrap;transition:height 500ms ease}.group-content.hidden.svelte-aty83l.svelte-aty83l{overflow:hidden;height:45px}.display.svelte-aty83l.svelte-aty83l{flex-grow:1;background:gray;display:flex;flex-direction:column;flex-wrap:nowrap;overflow:auto;position:relative;user-select:none}.loading-wrapper.svelte-aty83l.svelte-aty83l{position:absolute;left:50%;top:0;bottom:0;display:flex;align-items:center}.entry.svelte-aty83l.svelte-aty83l{position:relative;padding:10px}.card.svelte-aty83l.svelte-aty83l{position:absolute;border:6px solid rgb(22, 22, 22);border-radius:10px;outline:0;box-shadow:0px 0px 10px black}.card.banned.svelte-aty83l.svelte-aty83l{border:6px solid red}.card.svelte-aty83l.svelte-aty83l:hover{border:6px solid blue;cursor:pointer}.price.svelte-aty83l.svelte-aty83l,.banned-text.svelte-aty83l.svelte-aty83l,.count.svelte-aty83l.svelte-aty83l{font-size:34px;text-shadow:0px 0px 9px black;color:red;position:absolute;z-index:100;font-weight:bold;left:34px}.banned-text.svelte-aty83l.svelte-aty83l{bottom:135px}.count.svelte-aty83l.svelte-aty83l{top:165px}.price.svelte-aty83l.svelte-aty83l{bottom:7px;color:wheat;font-size:12px;background:black;left:109px;font-weight:normal}.group-header.svelte-aty83l.svelte-aty83l{display:flex;background:darkgrey;margin:8px 0;box-shadow:0px 0px 8px black;width:100%;flex-direction:row}.group-header.svelte-aty83l h2.svelte-aty83l{padding:0 25px;margin:0px}.group-statistics.svelte-aty83l.svelte-aty83l{display:flex;flex-direction:row}.mana-proposal.svelte-aty83l.svelte-aty83l,.mana-devotion.svelte-aty83l.svelte-aty83l{display:flex;flex-direction:row}.deck-value.svelte-aty83l.svelte-aty83l,.group-value.svelte-aty83l.svelte-aty83l{padding:5px;color:black;border-radius:50%;width:25px;height:25px;text-align:center;margin:5px;display:flex;text-align:center;align-items:center}.blue.svelte-aty83l.svelte-aty83l{background-color:var(--blue)}.black.svelte-aty83l.svelte-aty83l{color:white;background-color:var(--black)}.red.svelte-aty83l.svelte-aty83l{background-color:var(--red)}.white.svelte-aty83l.svelte-aty83l{background-color:var(--white)}.green.svelte-aty83l.svelte-aty83l{background-color:var(--green)}.colorless.svelte-aty83l.svelte-aty83l{background-color:var(--colorless)}.generic.svelte-aty83l.svelte-aty83l{background-color:goldenrod}.sum.svelte-aty83l.svelte-aty83l{background-color:goldenrod}.mana-curve.svelte-aty83l.svelte-aty83l{display:flex;flex-direction:column}.all-curves.svelte-aty83l.svelte-aty83l{display:flex;flex-grow:1;flex-direction:row;height:100px}.all-labels.svelte-aty83l.svelte-aty83l{display:flex;flex-shrink:0;flex-direction:row}.curve-element.svelte-aty83l.svelte-aty83l{width:20px;display:flex;position:absolute;bottom:0;background:gray;align-items:center;height:100%}.curve-label.svelte-aty83l.svelte-aty83l{width:20px}.curve-wrapper.svelte-aty83l.svelte-aty83l{width:20px;position:relative}h4.svelte-aty83l.svelte-aty83l{margin-top:5px;margin-bottom:5px}.lds-ripple.svelte-aty83l.svelte-aty83l{display:inline-block;position:relative;width:80px;height:80px}.lds-ripple.svelte-aty83l div.svelte-aty83l{position:absolute;border:4px solid #fff;opacity:1;border-radius:50%;animation:svelte-aty83l-lds-ripple 1s cubic-bezier(0, 0.2, 0.8, 1) infinite}.lds-ripple.svelte-aty83l div.svelte-aty83l:nth-child(2){animation-delay:-0.5s}@keyframes svelte-aty83l-lds-ripple{0%{top:36px;left:36px;width:0;height:0;opacity:1}100%{top:0px;left:0px;width:72px;height:72px;opacity:0}}";
    	append(document.head, style);
    }

    function get_each_context_2(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[28] = list[i];
    	child_ctx[30] = i;
    	return child_ctx;
    }

    function get_each_context_1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[25] = list[i];
    	return child_ctx;
    }

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[22] = list[i];
    	return child_ctx;
    }

    function get_each_context_3(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[32] = list[i];
    	child_ctx[30] = i;
    	return child_ctx;
    }

    function get_each_context_4(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[32] = list[i];
    	child_ctx[30] = i;
    	return child_ctx;
    }

    // (452:6) {:catch error}
    function create_catch_block_1(ctx) {
    	let t0;
    	let t1_value = /*error*/ ctx[31] + "";
    	let t1;

    	return {
    		c() {
    			t0 = text("asdasdasasdasd ");
    			t1 = text(t1_value);
    		},
    		m(target, anchor) {
    			insert(target, t0, anchor);
    			insert(target, t1, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*promise*/ 8 && t1_value !== (t1_value = /*error*/ ctx[31] + "")) set_data(t1, t1_value);
    		},
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    		}
    	};
    }

    // (383:6) {:then groups}
    function create_then_block_1(ctx) {
    	let div0;
    	let t0;
    	let t1_value = /*groups*/ ctx[21]["cardCount"] + "";
    	let t1;
    	let t2;
    	let div1;
    	let t3;
    	let t4_value = /*groups*/ ctx[21]["landCount"] + "";
    	let t4;
    	let t5;
    	let t6_value = /*groups*/ ctx[21]["cardCount"] - /*groups*/ ctx[21]["landCount"] + "";
    	let t6;
    	let t7;
    	let div2;
    	let t8;
    	let t9_value = /*groups*/ ctx[21].cost.toFixed(2) + "$" + "";
    	let t9;
    	let t10;
    	let div23;
    	let h40;
    	let t12;
    	let div9;
    	let div3;
    	let t13_value = /*groups*/ ctx[21]["mana"].blue + "";
    	let t13;
    	let t14;
    	let div4;
    	let t15_value = /*groups*/ ctx[21]["mana"].black + "";
    	let t15;
    	let t16;
    	let div5;
    	let t17_value = /*groups*/ ctx[21]["mana"].red + "";
    	let t17;
    	let t18;
    	let div6;
    	let t19_value = /*groups*/ ctx[21]["mana"].white + "";
    	let t19;
    	let t20;
    	let div7;
    	let t21_value = /*groups*/ ctx[21]["mana"].green + "";
    	let t21;
    	let t22;
    	let div8;
    	let t23_value = /*groups*/ ctx[21]["mana"].colorless + "";
    	let t23;
    	let t24;
    	let h41;
    	let t26;
    	let div10;
    	let t27;
    	let t28_value = /*groups*/ ctx[21]["mana"].generic + "";
    	let t28;
    	let t29;
    	let div11;
    	let t30;
    	let t31_value = /*groups*/ ctx[21]["mana"].sum + "";
    	let t31;
    	let t32;
    	let div12;
    	let t33;
    	let t34_value = /*groups*/ ctx[21]["averageMana"].toFixed(2) + "";
    	let t34;
    	let t35;
    	let h42;
    	let t37;
    	let div19;
    	let div13;
    	let t38_value = (/*groups*/ ctx[21]["manaProposal"].blue * /*groups*/ ctx[21]["landCount"]).toFixed(1) + "";
    	let t38;
    	let t39;
    	let div14;
    	let t40_value = (/*groups*/ ctx[21]["manaProposal"].black * /*groups*/ ctx[21]["landCount"]).toFixed(1) + "";
    	let t40;
    	let t41;
    	let div15;
    	let t42_value = (/*groups*/ ctx[21]["manaProposal"].red * /*groups*/ ctx[21]["landCount"]).toFixed(1) + "";
    	let t42;
    	let t43;
    	let div16;
    	let t44_value = (/*groups*/ ctx[21]["manaProposal"].white * /*groups*/ ctx[21]["landCount"]).toFixed(1) + "";
    	let t44;
    	let t45;
    	let div17;
    	let t46_value = (/*groups*/ ctx[21]["manaProposal"].green * /*groups*/ ctx[21]["landCount"]).toFixed(1) + "";
    	let t46;
    	let t47;
    	let div18;
    	let t48_value = (/*groups*/ ctx[21]["manaProposal"].colorless * /*groups*/ ctx[21]["landCount"]).toFixed(1) + "";
    	let t48;
    	let t49;
    	let h43;
    	let t51;
    	let div22;
    	let div20;
    	let t52;
    	let div21;
    	let each_value_4 = /*groups*/ ctx[21]["manaCurve"];
    	let each_blocks_1 = [];

    	for (let i = 0; i < each_value_4.length; i += 1) {
    		each_blocks_1[i] = create_each_block_4(get_each_context_4(ctx, each_value_4, i));
    	}

    	let each_value_3 = /*groups*/ ctx[21]["manaCurve"];
    	let each_blocks = [];

    	for (let i = 0; i < each_value_3.length; i += 1) {
    		each_blocks[i] = create_each_block_3(get_each_context_3(ctx, each_value_3, i));
    	}

    	return {
    		c() {
    			div0 = element("div");
    			t0 = text("Total cards: ");
    			t1 = text(t1_value);
    			t2 = space();
    			div1 = element("div");
    			t3 = text("Lands: ");
    			t4 = text(t4_value);
    			t5 = text(" Nonlands: ");
    			t6 = text(t6_value);
    			t7 = space();
    			div2 = element("div");
    			t8 = text("Cost: ");
    			t9 = text(t9_value);
    			t10 = space();
    			div23 = element("div");
    			h40 = element("h4");
    			h40.textContent = "Devotion";
    			t12 = space();
    			div9 = element("div");
    			div3 = element("div");
    			t13 = text(t13_value);
    			t14 = space();
    			div4 = element("div");
    			t15 = text(t15_value);
    			t16 = space();
    			div5 = element("div");
    			t17 = text(t17_value);
    			t18 = space();
    			div6 = element("div");
    			t19 = text(t19_value);
    			t20 = space();
    			div7 = element("div");
    			t21 = text(t21_value);
    			t22 = space();
    			div8 = element("div");
    			t23 = text(t23_value);
    			t24 = space();
    			h41 = element("h4");
    			h41.textContent = "Generic Mana";
    			t26 = space();
    			div10 = element("div");
    			t27 = text("Remaining generic mana costs:");
    			t28 = text(t28_value);
    			t29 = space();
    			div11 = element("div");
    			t30 = text("CMC-Mana-Sum:");
    			t31 = text(t31_value);
    			t32 = space();
    			div12 = element("div");
    			t33 = text("Average CMC per Nonland: ");
    			t34 = text(t34_value);
    			t35 = space();
    			h42 = element("h4");
    			h42.textContent = "Suggested Mana Distribution";
    			t37 = space();
    			div19 = element("div");
    			div13 = element("div");
    			t38 = text(t38_value);
    			t39 = space();
    			div14 = element("div");
    			t40 = text(t40_value);
    			t41 = space();
    			div15 = element("div");
    			t42 = text(t42_value);
    			t43 = space();
    			div16 = element("div");
    			t44 = text(t44_value);
    			t45 = space();
    			div17 = element("div");
    			t46 = text(t46_value);
    			t47 = space();
    			div18 = element("div");
    			t48 = text(t48_value);
    			t49 = space();
    			h43 = element("h4");
    			h43.textContent = "Mana Curve";
    			t51 = space();
    			div22 = element("div");
    			div20 = element("div");

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].c();
    			}

    			t52 = space();
    			div21 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr(h40, "class", "svelte-aty83l");
    			attr(div3, "class", "deck-value blue svelte-aty83l");
    			attr(div4, "class", "deck-value black svelte-aty83l");
    			attr(div5, "class", "deck-value red svelte-aty83l");
    			attr(div6, "class", "deck-value white svelte-aty83l");
    			attr(div7, "class", "deck-value green svelte-aty83l");
    			attr(div8, "class", "deck-value colorless svelte-aty83l");
    			attr(div9, "class", "mana-devotion svelte-aty83l");
    			attr(h41, "class", "svelte-aty83l");
    			attr(h42, "class", "svelte-aty83l");
    			attr(div13, "class", "deck-value blue svelte-aty83l");
    			attr(div14, "class", "deck-value black svelte-aty83l");
    			attr(div15, "class", "deck-value red svelte-aty83l");
    			attr(div16, "class", "deck-value white svelte-aty83l");
    			attr(div17, "class", "deck-value green svelte-aty83l");
    			attr(div18, "class", "deck-value colorless svelte-aty83l");
    			attr(div19, "class", "mana-proposal svelte-aty83l");
    			attr(h43, "class", "svelte-aty83l");
    			attr(div20, "class", "all-curves svelte-aty83l");
    			attr(div21, "class", "all-labels svelte-aty83l");
    			attr(div22, "class", "mana-curve svelte-aty83l");
    			attr(div23, "class", "statistics svelte-aty83l");
    		},
    		m(target, anchor) {
    			insert(target, div0, anchor);
    			append(div0, t0);
    			append(div0, t1);
    			insert(target, t2, anchor);
    			insert(target, div1, anchor);
    			append(div1, t3);
    			append(div1, t4);
    			append(div1, t5);
    			append(div1, t6);
    			insert(target, t7, anchor);
    			insert(target, div2, anchor);
    			append(div2, t8);
    			append(div2, t9);
    			insert(target, t10, anchor);
    			insert(target, div23, anchor);
    			append(div23, h40);
    			append(div23, t12);
    			append(div23, div9);
    			append(div9, div3);
    			append(div3, t13);
    			append(div9, t14);
    			append(div9, div4);
    			append(div4, t15);
    			append(div9, t16);
    			append(div9, div5);
    			append(div5, t17);
    			append(div9, t18);
    			append(div9, div6);
    			append(div6, t19);
    			append(div9, t20);
    			append(div9, div7);
    			append(div7, t21);
    			append(div9, t22);
    			append(div9, div8);
    			append(div8, t23);
    			append(div23, t24);
    			append(div23, h41);
    			append(div23, t26);
    			append(div23, div10);
    			append(div10, t27);
    			append(div10, t28);
    			append(div23, t29);
    			append(div23, div11);
    			append(div11, t30);
    			append(div11, t31);
    			append(div23, t32);
    			append(div23, div12);
    			append(div12, t33);
    			append(div12, t34);
    			append(div23, t35);
    			append(div23, h42);
    			append(div23, t37);
    			append(div23, div19);
    			append(div19, div13);
    			append(div13, t38);
    			append(div19, t39);
    			append(div19, div14);
    			append(div14, t40);
    			append(div19, t41);
    			append(div19, div15);
    			append(div15, t42);
    			append(div19, t43);
    			append(div19, div16);
    			append(div16, t44);
    			append(div19, t45);
    			append(div19, div17);
    			append(div17, t46);
    			append(div19, t47);
    			append(div19, div18);
    			append(div18, t48);
    			append(div23, t49);
    			append(div23, h43);
    			append(div23, t51);
    			append(div23, div22);
    			append(div22, div20);

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].m(div20, null);
    			}

    			append(div22, t52);
    			append(div22, div21);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div21, null);
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*promise*/ 8 && t1_value !== (t1_value = /*groups*/ ctx[21]["cardCount"] + "")) set_data(t1, t1_value);
    			if (dirty[0] & /*promise*/ 8 && t4_value !== (t4_value = /*groups*/ ctx[21]["landCount"] + "")) set_data(t4, t4_value);
    			if (dirty[0] & /*promise*/ 8 && t6_value !== (t6_value = /*groups*/ ctx[21]["cardCount"] - /*groups*/ ctx[21]["landCount"] + "")) set_data(t6, t6_value);
    			if (dirty[0] & /*promise*/ 8 && t9_value !== (t9_value = /*groups*/ ctx[21].cost.toFixed(2) + "$" + "")) set_data(t9, t9_value);
    			if (dirty[0] & /*promise*/ 8 && t13_value !== (t13_value = /*groups*/ ctx[21]["mana"].blue + "")) set_data(t13, t13_value);
    			if (dirty[0] & /*promise*/ 8 && t15_value !== (t15_value = /*groups*/ ctx[21]["mana"].black + "")) set_data(t15, t15_value);
    			if (dirty[0] & /*promise*/ 8 && t17_value !== (t17_value = /*groups*/ ctx[21]["mana"].red + "")) set_data(t17, t17_value);
    			if (dirty[0] & /*promise*/ 8 && t19_value !== (t19_value = /*groups*/ ctx[21]["mana"].white + "")) set_data(t19, t19_value);
    			if (dirty[0] & /*promise*/ 8 && t21_value !== (t21_value = /*groups*/ ctx[21]["mana"].green + "")) set_data(t21, t21_value);
    			if (dirty[0] & /*promise*/ 8 && t23_value !== (t23_value = /*groups*/ ctx[21]["mana"].colorless + "")) set_data(t23, t23_value);
    			if (dirty[0] & /*promise*/ 8 && t28_value !== (t28_value = /*groups*/ ctx[21]["mana"].generic + "")) set_data(t28, t28_value);
    			if (dirty[0] & /*promise*/ 8 && t31_value !== (t31_value = /*groups*/ ctx[21]["mana"].sum + "")) set_data(t31, t31_value);
    			if (dirty[0] & /*promise*/ 8 && t34_value !== (t34_value = /*groups*/ ctx[21]["averageMana"].toFixed(2) + "")) set_data(t34, t34_value);
    			if (dirty[0] & /*promise*/ 8 && t38_value !== (t38_value = (/*groups*/ ctx[21]["manaProposal"].blue * /*groups*/ ctx[21]["landCount"]).toFixed(1) + "")) set_data(t38, t38_value);
    			if (dirty[0] & /*promise*/ 8 && t40_value !== (t40_value = (/*groups*/ ctx[21]["manaProposal"].black * /*groups*/ ctx[21]["landCount"]).toFixed(1) + "")) set_data(t40, t40_value);
    			if (dirty[0] & /*promise*/ 8 && t42_value !== (t42_value = (/*groups*/ ctx[21]["manaProposal"].red * /*groups*/ ctx[21]["landCount"]).toFixed(1) + "")) set_data(t42, t42_value);
    			if (dirty[0] & /*promise*/ 8 && t44_value !== (t44_value = (/*groups*/ ctx[21]["manaProposal"].white * /*groups*/ ctx[21]["landCount"]).toFixed(1) + "")) set_data(t44, t44_value);
    			if (dirty[0] & /*promise*/ 8 && t46_value !== (t46_value = (/*groups*/ ctx[21]["manaProposal"].green * /*groups*/ ctx[21]["landCount"]).toFixed(1) + "")) set_data(t46, t46_value);
    			if (dirty[0] & /*promise*/ 8 && t48_value !== (t48_value = (/*groups*/ ctx[21]["manaProposal"].colorless * /*groups*/ ctx[21]["landCount"]).toFixed(1) + "")) set_data(t48, t48_value);

    			if (dirty[0] & /*promise*/ 8) {
    				each_value_4 = /*groups*/ ctx[21]["manaCurve"];
    				let i;

    				for (i = 0; i < each_value_4.length; i += 1) {
    					const child_ctx = get_each_context_4(ctx, each_value_4, i);

    					if (each_blocks_1[i]) {
    						each_blocks_1[i].p(child_ctx, dirty);
    					} else {
    						each_blocks_1[i] = create_each_block_4(child_ctx);
    						each_blocks_1[i].c();
    						each_blocks_1[i].m(div20, null);
    					}
    				}

    				for (; i < each_blocks_1.length; i += 1) {
    					each_blocks_1[i].d(1);
    				}

    				each_blocks_1.length = each_value_4.length;
    			}

    			if (dirty[0] & /*promise*/ 8) {
    				each_value_3 = /*groups*/ ctx[21]["manaCurve"];
    				let i;

    				for (i = 0; i < each_value_3.length; i += 1) {
    					const child_ctx = get_each_context_3(ctx, each_value_3, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block_3(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(div21, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value_3.length;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div0);
    			if (detaching) detach(t2);
    			if (detaching) detach(div1);
    			if (detaching) detach(t7);
    			if (detaching) detach(div2);
    			if (detaching) detach(t10);
    			if (detaching) detach(div23);
    			destroy_each(each_blocks_1, detaching);
    			destroy_each(each_blocks, detaching);
    		}
    	};
    }

    // (430:16) {#if mana > 0}
    function create_if_block_3(ctx) {
    	let div1;
    	let div0;
    	let t0_value = (/*mana*/ ctx[32] || "") + "";
    	let t0;
    	let div0_style_value;
    	let t1;

    	return {
    		c() {
    			div1 = element("div");
    			div0 = element("div");
    			t0 = text(t0_value);
    			t1 = space();
    			attr(div0, "class", "curve-element svelte-aty83l");
    			attr(div0, "style", div0_style_value = "height:" + getHeight(/*mana*/ ctx[32], /*groups*/ ctx[21]) + "%;");
    			attr(div1, "class", "curve-wrapper svelte-aty83l");
    		},
    		m(target, anchor) {
    			insert(target, div1, anchor);
    			append(div1, div0);
    			append(div0, t0);
    			append(div1, t1);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*promise*/ 8 && t0_value !== (t0_value = (/*mana*/ ctx[32] || "") + "")) set_data(t0, t0_value);

    			if (dirty[0] & /*promise*/ 8 && div0_style_value !== (div0_style_value = "height:" + getHeight(/*mana*/ ctx[32], /*groups*/ ctx[21]) + "%;")) {
    				attr(div0, "style", div0_style_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div1);
    		}
    	};
    }

    // (429:14) {#each groups['manaCurve'] as mana, i}
    function create_each_block_4(ctx) {
    	let if_block_anchor;
    	let if_block = /*mana*/ ctx[32] > 0 && create_if_block_3(ctx);

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
    			if (/*mana*/ ctx[32] > 0) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block_3(ctx);
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

    // (444:16) {#if mana > 0}
    function create_if_block_2(ctx) {
    	let div;
    	let t;

    	return {
    		c() {
    			div = element("div");
    			t = text(/*i*/ ctx[30]);
    			attr(div, "class", "curve-label svelte-aty83l");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, t);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (443:14) {#each groups['manaCurve'] as mana, i}
    function create_each_block_3(ctx) {
    	let if_block_anchor;
    	let if_block = /*mana*/ ctx[32] > 0 && create_if_block_2(ctx);

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
    			if (/*mana*/ ctx[32] > 0) {
    				if (if_block) ; else {
    					if_block = create_if_block_2(ctx);
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

    // (366:22)           <h4>How to use:</h4>          <p>paste your deck to the following input.</p>          <ul>            <li>              when a line starts with "#" it will be interpreted as headline            </li>            <li>              a card can be entered with a leading count, or just with its name            </li>            <li>use the "ESC" key to reaload the preview</li>            <li>doubleclick a card to remove it</li>          </ul>          <p>NOTE: we use cookies to store your deck after reload.</p>          <p>NOTE: This is not an official Magic produkt.</p>            <div>loading: {progress}
    function create_pending_block_1(ctx) {
    	let h4;
    	let t1;
    	let p0;
    	let t3;
    	let ul;
    	let t11;
    	let p1;
    	let t13;
    	let p2;
    	let t15;
    	let div;
    	let t16;
    	let t17;
    	let t18;
    	let t19;

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
    			t15 = space();
    			div = element("div");
    			t16 = text("loading: ");
    			t17 = text(/*progress*/ ctx[6]);
    			t18 = text("/");
    			t19 = text(/*all*/ ctx[7]);
    			attr(h4, "class", "svelte-aty83l");
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
    			insert(target, t15, anchor);
    			insert(target, div, anchor);
    			append(div, t16);
    			append(div, t17);
    			append(div, t18);
    			append(div, t19);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*progress*/ 64) set_data(t17, /*progress*/ ctx[6]);
    			if (dirty[0] & /*all*/ 128) set_data(t19, /*all*/ ctx[7]);
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
    			if (detaching) detach(t15);
    			if (detaching) detach(div);
    		}
    	};
    }

    // (549:4) {:catch error}
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

    // (487:4) {:then groups}
    function create_then_block(ctx) {
    	let each_1_anchor;
    	let each_value = /*groups*/ ctx[21] || [];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
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
    			if (dirty[0] & /*hiddenGroups, promise, width, height, format, remove, toggleGroupVisibility*/ 4907) {
    				each_value = /*groups*/ ctx[21] || [];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(each_1_anchor.parentNode, each_1_anchor);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}
    		},
    		d(detaching) {
    			destroy_each(each_blocks, detaching);
    			if (detaching) detach(each_1_anchor);
    		}
    	};
    }

    // (523:16) {#each { length: card.count > 4 ? 4 : card.count } as _, i}
    function create_each_block_2(ctx) {
    	let img;
    	let img_style_value;
    	let img_src_value;
    	let img_alt_value;
    	let mounted;
    	let dispose;

    	function dblclick_handler(...args) {
    		return /*dblclick_handler*/ ctx[20](/*card*/ ctx[25], ...args);
    	}

    	return {
    		c() {
    			img = element("img");
    			attr(img, "class", "card svelte-aty83l");
    			attr(img, "style", img_style_value = "margin-top: " + /*i*/ ctx[30] * 40 + "px");
    			if (img.src !== (img_src_value = /*card*/ ctx[25].url)) attr(img, "src", img_src_value);
    			attr(img, "alt", img_alt_value = /*card*/ ctx[25].name);
    			attr(img, "width", /*width*/ ctx[1]);
    			attr(img, "height", /*height*/ ctx[0]);
    			toggle_class(img, "banned", /*card*/ ctx[25].data.legalities[/*format*/ ctx[5].value] !== "legal");
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

    			if (dirty[0] & /*promise*/ 8 && img.src !== (img_src_value = /*card*/ ctx[25].url)) {
    				attr(img, "src", img_src_value);
    			}

    			if (dirty[0] & /*promise*/ 8 && img_alt_value !== (img_alt_value = /*card*/ ctx[25].name)) {
    				attr(img, "alt", img_alt_value);
    			}

    			if (dirty[0] & /*width*/ 2) {
    				attr(img, "width", /*width*/ ctx[1]);
    			}

    			if (dirty[0] & /*height*/ 1) {
    				attr(img, "height", /*height*/ ctx[0]);
    			}

    			if (dirty[0] & /*promise, format*/ 40) {
    				toggle_class(img, "banned", /*card*/ ctx[25].data.legalities[/*format*/ ctx[5].value] !== "legal");
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(img);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (535:16) {#if card.data.legalities[format.value] !== 'legal'}
    function create_if_block_1(ctx) {
    	let div;

    	return {
    		c() {
    			div = element("div");
    			div.textContent = "BANNED";
    			attr(div, "class", "banned-text svelte-aty83l");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (538:16) {#if card.count > 4}
    function create_if_block(ctx) {
    	let div;
    	let t0_value = /*card*/ ctx[25].count + "";
    	let t0;
    	let t1;

    	return {
    		c() {
    			div = element("div");
    			t0 = text(t0_value);
    			t1 = text("x");
    			attr(div, "class", "count svelte-aty83l");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, t0);
    			append(div, t1);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*promise*/ 8 && t0_value !== (t0_value = /*card*/ ctx[25].count + "")) set_data(t0, t0_value);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (518:12) {#each group.cards as card}
    function create_each_block_1(ctx) {
    	let div1;
    	let t0;
    	let t1;
    	let t2;
    	let div0;
    	let t3_value = (/*card*/ ctx[25].data.prices.usd + "$" || "???") + "";
    	let t3;
    	let t4;
    	let div1_style_value;

    	let each_value_2 = {
    		length: /*card*/ ctx[25].count > 4 ? 4 : /*card*/ ctx[25].count
    	};

    	let each_blocks = [];

    	for (let i = 0; i < each_value_2.length; i += 1) {
    		each_blocks[i] = create_each_block_2(get_each_context_2(ctx, each_value_2, i));
    	}

    	let if_block0 = /*card*/ ctx[25].data.legalities[/*format*/ ctx[5].value] !== "legal" && create_if_block_1(ctx);
    	let if_block1 = /*card*/ ctx[25].count > 4 && create_if_block(ctx);

    	return {
    		c() {
    			div1 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t0 = space();
    			if (if_block0) if_block0.c();
    			t1 = space();
    			if (if_block1) if_block1.c();
    			t2 = space();
    			div0 = element("div");
    			t3 = text(t3_value);
    			t4 = space();
    			attr(div0, "class", "price svelte-aty83l");
    			attr(div1, "class", "entry svelte-aty83l");

    			attr(div1, "style", div1_style_value = "width:" + /*width*/ ctx[1] + "px; height:" + (/*card*/ ctx[25].count <= 4
    			? /*height*/ ctx[0] + ((/*card*/ ctx[25].count || 1) - 1) * 40
    			: /*height*/ ctx[0] + 3 * 40) + "px;");
    		},
    		m(target, anchor) {
    			insert(target, div1, anchor);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div1, null);
    			}

    			append(div1, t0);
    			if (if_block0) if_block0.m(div1, null);
    			append(div1, t1);
    			if (if_block1) if_block1.m(div1, null);
    			append(div1, t2);
    			append(div1, div0);
    			append(div0, t3);
    			append(div1, t4);
    		},
    		p(ctx, dirty) {
    			if (dirty[0] & /*promise, width, height, format, remove*/ 4139) {
    				each_value_2 = {
    					length: /*card*/ ctx[25].count > 4 ? 4 : /*card*/ ctx[25].count
    				};

    				let i;

    				for (i = 0; i < each_value_2.length; i += 1) {
    					const child_ctx = get_each_context_2(ctx, each_value_2, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block_2(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(div1, t0);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value_2.length;
    			}

    			if (/*card*/ ctx[25].data.legalities[/*format*/ ctx[5].value] !== "legal") {
    				if (if_block0) ; else {
    					if_block0 = create_if_block_1(ctx);
    					if_block0.c();
    					if_block0.m(div1, t1);
    				}
    			} else if (if_block0) {
    				if_block0.d(1);
    				if_block0 = null;
    			}

    			if (/*card*/ ctx[25].count > 4) {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);
    				} else {
    					if_block1 = create_if_block(ctx);
    					if_block1.c();
    					if_block1.m(div1, t2);
    				}
    			} else if (if_block1) {
    				if_block1.d(1);
    				if_block1 = null;
    			}

    			if (dirty[0] & /*promise*/ 8 && t3_value !== (t3_value = (/*card*/ ctx[25].data.prices.usd + "$" || "???") + "")) set_data(t3, t3_value);

    			if (dirty[0] & /*width, promise, height*/ 11 && div1_style_value !== (div1_style_value = "width:" + /*width*/ ctx[1] + "px; height:" + (/*card*/ ctx[25].count <= 4
    			? /*height*/ ctx[0] + ((/*card*/ ctx[25].count || 1) - 1) * 40
    			: /*height*/ ctx[0] + 3 * 40) + "px;")) {
    				attr(div1, "style", div1_style_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div1);
    			destroy_each(each_blocks, detaching);
    			if (if_block0) if_block0.d();
    			if (if_block1) if_block1.d();
    		}
    	};
    }

    // (489:6) {#each groups || [] as group}
    function create_each_block(ctx) {
    	let div12;
    	let div10;
    	let h2;
    	let t0_value = (/*group*/ ctx[22].name + " // " + /*group*/ ctx[22].count || "no name") + "";
    	let t0;
    	let t1;
    	let button;
    	let t3;
    	let div9;
    	let div0;
    	let t4_value = /*group*/ ctx[22].mana.blue + "";
    	let t4;
    	let t5;
    	let div1;
    	let t6_value = /*group*/ ctx[22].mana.black + "";
    	let t6;
    	let t7;
    	let div2;
    	let t8_value = /*group*/ ctx[22].mana.red + "";
    	let t8;
    	let t9;
    	let div3;
    	let t10_value = /*group*/ ctx[22].mana.white + "";
    	let t10;
    	let t11;
    	let div4;
    	let t12_value = /*group*/ ctx[22].mana.green + "";
    	let t12;
    	let t13;
    	let div5;
    	let t14_value = /*group*/ ctx[22].mana.colorless + "";
    	let t14;
    	let t15;
    	let div6;
    	let t16_value = /*group*/ ctx[22].mana.generic + "";
    	let t16;
    	let t17;
    	let div7;
    	let t18_value = /*group*/ ctx[22].mana.sum + "";
    	let t18;
    	let t19;
    	let div8;
    	let t20_value = /*group*/ ctx[22].cost.toFixed(2) + "$" + "";
    	let t20;
    	let t21;
    	let div11;
    	let t22;
    	let mounted;
    	let dispose;

    	function click_handler(...args) {
    		return /*click_handler*/ ctx[19](/*group*/ ctx[22], ...args);
    	}

    	let each_value_1 = /*group*/ ctx[22].cards;
    	let each_blocks = [];

    	for (let i = 0; i < each_value_1.length; i += 1) {
    		each_blocks[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
    	}

    	return {
    		c() {
    			div12 = element("div");
    			div10 = element("div");
    			h2 = element("h2");
    			t0 = text(t0_value);
    			t1 = space();
    			button = element("button");
    			button.textContent = "toggle";
    			t3 = space();
    			div9 = element("div");
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
    			t15 = text("\r\n              generic:\r\n              ");
    			div6 = element("div");
    			t16 = text(t16_value);
    			t17 = text("\r\n              sum:\r\n              ");
    			div7 = element("div");
    			t18 = text(t18_value);
    			t19 = space();
    			div8 = element("div");
    			t20 = text(t20_value);
    			t21 = space();
    			div11 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t22 = space();
    			attr(h2, "class", "svelte-aty83l");
    			attr(div0, "class", "group-value blue svelte-aty83l");
    			attr(div1, "class", "group-value black svelte-aty83l");
    			attr(div2, "class", "group-value red svelte-aty83l");
    			attr(div3, "class", "group-value white svelte-aty83l");
    			attr(div4, "class", "group-value green svelte-aty83l");
    			attr(div5, "class", "group-value colorless svelte-aty83l");
    			attr(div6, "class", "group-value generic svelte-aty83l");
    			attr(div7, "class", "group-value sum svelte-aty83l");
    			attr(div8, "class", "group-value group-cost svelte-aty83l");
    			attr(div9, "class", "group-statistics svelte-aty83l");
    			attr(div10, "class", "group-header svelte-aty83l");
    			attr(div11, "class", "group-content svelte-aty83l");
    			toggle_class(div11, "hidden", /*hiddenGroups*/ ctx[8].has(/*group*/ ctx[22].name));
    			attr(div12, "class", "group");
    		},
    		m(target, anchor) {
    			insert(target, div12, anchor);
    			append(div12, div10);
    			append(div10, h2);
    			append(h2, t0);
    			append(div10, t1);
    			append(div10, button);
    			append(div10, t3);
    			append(div10, div9);
    			append(div9, div0);
    			append(div0, t4);
    			append(div9, t5);
    			append(div9, div1);
    			append(div1, t6);
    			append(div9, t7);
    			append(div9, div2);
    			append(div2, t8);
    			append(div9, t9);
    			append(div9, div3);
    			append(div3, t10);
    			append(div9, t11);
    			append(div9, div4);
    			append(div4, t12);
    			append(div9, t13);
    			append(div9, div5);
    			append(div5, t14);
    			append(div9, t15);
    			append(div9, div6);
    			append(div6, t16);
    			append(div9, t17);
    			append(div9, div7);
    			append(div7, t18);
    			append(div9, t19);
    			append(div9, div8);
    			append(div8, t20);
    			append(div12, t21);
    			append(div12, div11);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div11, null);
    			}

    			append(div12, t22);

    			if (!mounted) {
    				dispose = listen(button, "click", click_handler);
    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;
    			if (dirty[0] & /*promise*/ 8 && t0_value !== (t0_value = (/*group*/ ctx[22].name + " // " + /*group*/ ctx[22].count || "no name") + "")) set_data(t0, t0_value);
    			if (dirty[0] & /*promise*/ 8 && t4_value !== (t4_value = /*group*/ ctx[22].mana.blue + "")) set_data(t4, t4_value);
    			if (dirty[0] & /*promise*/ 8 && t6_value !== (t6_value = /*group*/ ctx[22].mana.black + "")) set_data(t6, t6_value);
    			if (dirty[0] & /*promise*/ 8 && t8_value !== (t8_value = /*group*/ ctx[22].mana.red + "")) set_data(t8, t8_value);
    			if (dirty[0] & /*promise*/ 8 && t10_value !== (t10_value = /*group*/ ctx[22].mana.white + "")) set_data(t10, t10_value);
    			if (dirty[0] & /*promise*/ 8 && t12_value !== (t12_value = /*group*/ ctx[22].mana.green + "")) set_data(t12, t12_value);
    			if (dirty[0] & /*promise*/ 8 && t14_value !== (t14_value = /*group*/ ctx[22].mana.colorless + "")) set_data(t14, t14_value);
    			if (dirty[0] & /*promise*/ 8 && t16_value !== (t16_value = /*group*/ ctx[22].mana.generic + "")) set_data(t16, t16_value);
    			if (dirty[0] & /*promise*/ 8 && t18_value !== (t18_value = /*group*/ ctx[22].mana.sum + "")) set_data(t18, t18_value);
    			if (dirty[0] & /*promise*/ 8 && t20_value !== (t20_value = /*group*/ ctx[22].cost.toFixed(2) + "$" + "")) set_data(t20, t20_value);

    			if (dirty[0] & /*width, promise, height, format, remove*/ 4139) {
    				each_value_1 = /*group*/ ctx[22].cards;
    				let i;

    				for (i = 0; i < each_value_1.length; i += 1) {
    					const child_ctx = get_each_context_1(ctx, each_value_1, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block_1(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(div11, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value_1.length;
    			}

    			if (dirty[0] & /*hiddenGroups, promise*/ 264) {
    				toggle_class(div11, "hidden", /*hiddenGroups*/ ctx[8].has(/*group*/ ctx[22].name));
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div12);
    			destroy_each(each_blocks, detaching);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (479:20)         <div class="loading-wrapper">          <div>loading: {progress}
    function create_pending_block(ctx) {
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
    			t1 = text(/*progress*/ ctx[6]);
    			t2 = text("/");
    			t3 = text(/*all*/ ctx[7]);
    			t4 = space();
    			div3 = element("div");

    			div3.innerHTML = `<div class="svelte-aty83l"></div> 
          <div class="svelte-aty83l"></div>`;

    			attr(div3, "class", "lds-ripple svelte-aty83l");
    			attr(div4, "class", "loading-wrapper svelte-aty83l");
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
    			if (dirty[0] & /*progress*/ 64) set_data(t1, /*progress*/ ctx[6]);
    			if (dirty[0] & /*all*/ 128) set_data(t3, /*all*/ ctx[7]);
    		},
    		d(detaching) {
    			if (detaching) detach(div4);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let div4;
    	let div2;
    	let div1;
    	let promise_1;
    	let t0;
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
    	let t14;
    	let div0;
    	let input_1;
    	let t15;
    	let textarea;
    	let t16;
    	let div3;
    	let promise_2;
    	let mounted;
    	let dispose;

    	let info = {
    		ctx,
    		current: null,
    		token: null,
    		pending: create_pending_block_1,
    		then: create_then_block_1,
    		catch: create_catch_block_1,
    		value: 21,
    		error: 31
    	};

    	handle_promise(promise_1 = /*promise*/ ctx[3], info);

    	let info_1 = {
    		ctx,
    		current: null,
    		token: null,
    		pending: create_pending_block,
    		then: create_then_block,
    		catch: create_catch_block,
    		value: 21,
    		error: 31
    	};

    	handle_promise(promise_2 = /*promise*/ ctx[3], info_1);

    	return {
    		c() {
    			div4 = element("div");
    			div2 = element("div");
    			div1 = element("div");
    			info.block.c();
    			t0 = text("\r\n      Format:\r\n      ");
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
    			t14 = space();
    			div0 = element("div");
    			input_1 = element("input");
    			t15 = space();
    			textarea = element("textarea");
    			t16 = space();
    			div3 = element("div");
    			info_1.block.c();
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
    			attr(input_1, "type", "range");
    			attr(input_1, "min", "25");
    			attr(input_1, "max", "100");
    			attr(div0, "class", "slidecontainer");
    			attr(div1, "class", "help svelte-aty83l");
    			attr(textarea, "class", "input svelte-aty83l");
    			attr(div2, "class", "controls svelte-aty83l");
    			attr(div3, "class", "display svelte-aty83l");
    			attr(div4, "class", "content svelte-aty83l");
    		},
    		m(target, anchor) {
    			insert(target, div4, anchor);
    			append(div4, div2);
    			append(div2, div1);
    			info.block.m(div1, info.anchor = null);
    			info.mount = () => div1;
    			info.anchor = t0;
    			append(div1, t0);
    			append(div1, select);
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
    			/*select_binding*/ ctx[16](select);
    			append(div1, t14);
    			append(div1, div0);
    			append(div0, input_1);
    			set_input_value(input_1, /*scaling*/ ctx[2]);
    			append(div2, t15);
    			append(div2, textarea);
    			/*textarea_binding*/ ctx[18](textarea);
    			append(div4, t16);
    			append(div4, div3);
    			info_1.block.m(div3, info_1.anchor = null);
    			info_1.mount = () => div3;
    			info_1.anchor = null;

    			if (!mounted) {
    				dispose = [
    					listen(window, "keyup", /*update*/ ctx[10]),
    					listen(select, "blur", /*reload*/ ctx[11]),
    					listen(select, "change", /*reload*/ ctx[11]),
    					listen(input_1, "change", /*input_1_change_input_handler*/ ctx[17]),
    					listen(input_1, "input", /*input_1_change_input_handler*/ ctx[17]),
    					listen(textarea, "keyup", /*onTyping*/ ctx[13])
    				];

    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;
    			info.ctx = ctx;

    			if (dirty[0] & /*promise*/ 8 && promise_1 !== (promise_1 = /*promise*/ ctx[3]) && handle_promise(promise_1, info)) ; else {
    				const child_ctx = ctx.slice();
    				child_ctx[21] = info.resolved;
    				info.block.p(child_ctx, dirty);
    			}

    			if (dirty[0] & /*scaling*/ 4) {
    				set_input_value(input_1, /*scaling*/ ctx[2]);
    			}

    			info_1.ctx = ctx;

    			if (dirty[0] & /*promise*/ 8 && promise_2 !== (promise_2 = /*promise*/ ctx[3]) && handle_promise(promise_2, info_1)) ; else {
    				const child_ctx = ctx.slice();
    				child_ctx[21] = info_1.resolved;
    				info_1.block.p(child_ctx, dirty);
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div4);
    			info.block.d();
    			info.token = null;
    			info = null;
    			/*select_binding*/ ctx[16](null);
    			/*textarea_binding*/ ctx[18](null);
    			info_1.block.d();
    			info_1.token = null;
    			info_1 = null;
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
    	let scaling = 50;
    	let promise = new Promise(resolve => resolve([]));
    	let input;
    	let format;
    	let progress = 0;
    	let all = 0;
    	let hiddenGroups = new Set();

    	function toggleGroupVisibility(group) {
    		if (hiddenGroups.has(group.name)) hiddenGroups.delete(group.name); else hiddenGroups.add(group.name);
    		$$invalidate(8, hiddenGroups);
    	}

    	function sp(p, a) {
    		$$invalidate(6, progress = p);
    		$$invalidate(7, all = a);
    	}

    	async function update(evt) {
    		if (evt.keyCode !== 27) return;

    		$$invalidate(3, promise = cardLoader.createDeck(input.value || "", (p, a) => {
    			sp(p, a);
    		}).catch(e => {
    			console.error(e);
    			throw e;
    		}).then(res => {
    			$$invalidate(4, input.value = res.corrected, input);
    			return res;
    		}));
    	}

    	function reload() {
    		update({ keyCode: 27 });
    	}

    	function remove(card) {
    		const r = new RegExp(`^.*${card.name}.*$`, "gm");
    		$$invalidate(4, input.value = input.value.replace(r, ""), input);

    		$$invalidate(3, promise = cardLoader.createDeck(input.value || "", (p, a) => sp(p, a)).catch(e => {
    			console.error(e);
    			throw e;
    		}));
    	}

    	onMount(async () => {
    		const start = js_cookie.get("deck") || `#lands
mountain
2 plains
3 swamps
# main deck
20 blightsteel colossus`;

    		$$invalidate(4, input.value = start, input);
    		(console.log("STSFSDF", js_cookie.get("deck")), $$invalidate(3, promise = cardLoader.createDeck(start, (p, a) => sp(p, a))));
    	});

    	function onTyping() {
    		js_cookie.set("deck", input.value, { expires: 7 });
    	}

    	function select_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(5, format = $$value);
    		});
    	}

    	function input_1_change_input_handler() {
    		scaling = to_number(this.value);
    		$$invalidate(2, scaling);
    	}

    	function textarea_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(4, input = $$value);
    		});
    	}

    	const click_handler = group => toggleGroupVisibility(group);
    	const dblclick_handler = card => remove(card);

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty[0] & /*scaling*/ 4) {
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
    		scaling,
    		promise,
    		input,
    		format,
    		progress,
    		all,
    		hiddenGroups,
    		toggleGroupVisibility,
    		update,
    		reload,
    		remove,
    		onTyping,
    		_width,
    		sp,
    		select_binding,
    		input_1_change_input_handler,
    		textarea_binding,
    		click_handler,
    		dblclick_handler
    	];
    }

    class Editor extends SvelteComponent {
    	constructor(options) {
    		super();
    		if (!document.getElementById("svelte-aty83l-style")) add_css();
    		init(this, options, instance, create_fragment, safe_not_equal, {}, [-1, -1]);
    	}
    }

    const renderTarget = new Editor({
      target: document.body,
      props: {
        test: "sdfdsf"
      }
    });

}());
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWRpdG9yLWJ1bmRsZS5qcyIsInNvdXJjZXMiOlsibm9kZV9tb2R1bGVzL3N2ZWx0ZS9pbnRlcm5hbC9pbmRleC5tanMiLCJjYXJkLWxvYWRlci5qcyIsIm5vZGVfbW9kdWxlcy9qcy1jb29raWUvc3JjL2pzLmNvb2tpZS5qcyIsImVkaXRvci5zdmVsdGUiLCJlZGl0b3ItbWFpbi5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJmdW5jdGlvbiBub29wKCkgeyB9XG5jb25zdCBpZGVudGl0eSA9IHggPT4geDtcbmZ1bmN0aW9uIGFzc2lnbih0YXIsIHNyYykge1xuICAgIC8vIEB0cy1pZ25vcmVcbiAgICBmb3IgKGNvbnN0IGsgaW4gc3JjKVxuICAgICAgICB0YXJba10gPSBzcmNba107XG4gICAgcmV0dXJuIHRhcjtcbn1cbmZ1bmN0aW9uIGlzX3Byb21pc2UodmFsdWUpIHtcbiAgICByZXR1cm4gdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgdmFsdWUudGhlbiA9PT0gJ2Z1bmN0aW9uJztcbn1cbmZ1bmN0aW9uIGFkZF9sb2NhdGlvbihlbGVtZW50LCBmaWxlLCBsaW5lLCBjb2x1bW4sIGNoYXIpIHtcbiAgICBlbGVtZW50Ll9fc3ZlbHRlX21ldGEgPSB7XG4gICAgICAgIGxvYzogeyBmaWxlLCBsaW5lLCBjb2x1bW4sIGNoYXIgfVxuICAgIH07XG59XG5mdW5jdGlvbiBydW4oZm4pIHtcbiAgICByZXR1cm4gZm4oKTtcbn1cbmZ1bmN0aW9uIGJsYW5rX29iamVjdCgpIHtcbiAgICByZXR1cm4gT2JqZWN0LmNyZWF0ZShudWxsKTtcbn1cbmZ1bmN0aW9uIHJ1bl9hbGwoZm5zKSB7XG4gICAgZm5zLmZvckVhY2gocnVuKTtcbn1cbmZ1bmN0aW9uIGlzX2Z1bmN0aW9uKHRoaW5nKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB0aGluZyA9PT0gJ2Z1bmN0aW9uJztcbn1cbmZ1bmN0aW9uIHNhZmVfbm90X2VxdWFsKGEsIGIpIHtcbiAgICByZXR1cm4gYSAhPSBhID8gYiA9PSBiIDogYSAhPT0gYiB8fCAoKGEgJiYgdHlwZW9mIGEgPT09ICdvYmplY3QnKSB8fCB0eXBlb2YgYSA9PT0gJ2Z1bmN0aW9uJyk7XG59XG5mdW5jdGlvbiBub3RfZXF1YWwoYSwgYikge1xuICAgIHJldHVybiBhICE9IGEgPyBiID09IGIgOiBhICE9PSBiO1xufVxuZnVuY3Rpb24gdmFsaWRhdGVfc3RvcmUoc3RvcmUsIG5hbWUpIHtcbiAgICBpZiAoc3RvcmUgIT0gbnVsbCAmJiB0eXBlb2Ygc3RvcmUuc3Vic2NyaWJlICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJyR7bmFtZX0nIGlzIG5vdCBhIHN0b3JlIHdpdGggYSAnc3Vic2NyaWJlJyBtZXRob2RgKTtcbiAgICB9XG59XG5mdW5jdGlvbiBzdWJzY3JpYmUoc3RvcmUsIC4uLmNhbGxiYWNrcykge1xuICAgIGlmIChzdG9yZSA9PSBudWxsKSB7XG4gICAgICAgIHJldHVybiBub29wO1xuICAgIH1cbiAgICBjb25zdCB1bnN1YiA9IHN0b3JlLnN1YnNjcmliZSguLi5jYWxsYmFja3MpO1xuICAgIHJldHVybiB1bnN1Yi51bnN1YnNjcmliZSA/ICgpID0+IHVuc3ViLnVuc3Vic2NyaWJlKCkgOiB1bnN1Yjtcbn1cbmZ1bmN0aW9uIGdldF9zdG9yZV92YWx1ZShzdG9yZSkge1xuICAgIGxldCB2YWx1ZTtcbiAgICBzdWJzY3JpYmUoc3RvcmUsIF8gPT4gdmFsdWUgPSBfKSgpO1xuICAgIHJldHVybiB2YWx1ZTtcbn1cbmZ1bmN0aW9uIGNvbXBvbmVudF9zdWJzY3JpYmUoY29tcG9uZW50LCBzdG9yZSwgY2FsbGJhY2spIHtcbiAgICBjb21wb25lbnQuJCQub25fZGVzdHJveS5wdXNoKHN1YnNjcmliZShzdG9yZSwgY2FsbGJhY2spKTtcbn1cbmZ1bmN0aW9uIGNyZWF0ZV9zbG90KGRlZmluaXRpb24sIGN0eCwgJCRzY29wZSwgZm4pIHtcbiAgICBpZiAoZGVmaW5pdGlvbikge1xuICAgICAgICBjb25zdCBzbG90X2N0eCA9IGdldF9zbG90X2NvbnRleHQoZGVmaW5pdGlvbiwgY3R4LCAkJHNjb3BlLCBmbik7XG4gICAgICAgIHJldHVybiBkZWZpbml0aW9uWzBdKHNsb3RfY3R4KTtcbiAgICB9XG59XG5mdW5jdGlvbiBnZXRfc2xvdF9jb250ZXh0KGRlZmluaXRpb24sIGN0eCwgJCRzY29wZSwgZm4pIHtcbiAgICByZXR1cm4gZGVmaW5pdGlvblsxXSAmJiBmblxuICAgICAgICA/IGFzc2lnbigkJHNjb3BlLmN0eC5zbGljZSgpLCBkZWZpbml0aW9uWzFdKGZuKGN0eCkpKVxuICAgICAgICA6ICQkc2NvcGUuY3R4O1xufVxuZnVuY3Rpb24gZ2V0X3Nsb3RfY2hhbmdlcyhkZWZpbml0aW9uLCAkJHNjb3BlLCBkaXJ0eSwgZm4pIHtcbiAgICBpZiAoZGVmaW5pdGlvblsyXSAmJiBmbikge1xuICAgICAgICBjb25zdCBsZXRzID0gZGVmaW5pdGlvblsyXShmbihkaXJ0eSkpO1xuICAgICAgICBpZiAoJCRzY29wZS5kaXJ0eSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICByZXR1cm4gbGV0cztcbiAgICAgICAgfVxuICAgICAgICBpZiAodHlwZW9mIGxldHMgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICBjb25zdCBtZXJnZWQgPSBbXTtcbiAgICAgICAgICAgIGNvbnN0IGxlbiA9IE1hdGgubWF4KCQkc2NvcGUuZGlydHkubGVuZ3RoLCBsZXRzLmxlbmd0aCk7XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxlbjsgaSArPSAxKSB7XG4gICAgICAgICAgICAgICAgbWVyZ2VkW2ldID0gJCRzY29wZS5kaXJ0eVtpXSB8IGxldHNbaV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gbWVyZ2VkO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAkJHNjb3BlLmRpcnR5IHwgbGV0cztcbiAgICB9XG4gICAgcmV0dXJuICQkc2NvcGUuZGlydHk7XG59XG5mdW5jdGlvbiB1cGRhdGVfc2xvdChzbG90LCBzbG90X2RlZmluaXRpb24sIGN0eCwgJCRzY29wZSwgZGlydHksIGdldF9zbG90X2NoYW5nZXNfZm4sIGdldF9zbG90X2NvbnRleHRfZm4pIHtcbiAgICBjb25zdCBzbG90X2NoYW5nZXMgPSBnZXRfc2xvdF9jaGFuZ2VzKHNsb3RfZGVmaW5pdGlvbiwgJCRzY29wZSwgZGlydHksIGdldF9zbG90X2NoYW5nZXNfZm4pO1xuICAgIGlmIChzbG90X2NoYW5nZXMpIHtcbiAgICAgICAgY29uc3Qgc2xvdF9jb250ZXh0ID0gZ2V0X3Nsb3RfY29udGV4dChzbG90X2RlZmluaXRpb24sIGN0eCwgJCRzY29wZSwgZ2V0X3Nsb3RfY29udGV4dF9mbik7XG4gICAgICAgIHNsb3QucChzbG90X2NvbnRleHQsIHNsb3RfY2hhbmdlcyk7XG4gICAgfVxufVxuZnVuY3Rpb24gZXhjbHVkZV9pbnRlcm5hbF9wcm9wcyhwcm9wcykge1xuICAgIGNvbnN0IHJlc3VsdCA9IHt9O1xuICAgIGZvciAoY29uc3QgayBpbiBwcm9wcylcbiAgICAgICAgaWYgKGtbMF0gIT09ICckJylcbiAgICAgICAgICAgIHJlc3VsdFtrXSA9IHByb3BzW2tdO1xuICAgIHJldHVybiByZXN1bHQ7XG59XG5mdW5jdGlvbiBjb21wdXRlX3Jlc3RfcHJvcHMocHJvcHMsIGtleXMpIHtcbiAgICBjb25zdCByZXN0ID0ge307XG4gICAga2V5cyA9IG5ldyBTZXQoa2V5cyk7XG4gICAgZm9yIChjb25zdCBrIGluIHByb3BzKVxuICAgICAgICBpZiAoIWtleXMuaGFzKGspICYmIGtbMF0gIT09ICckJylcbiAgICAgICAgICAgIHJlc3Rba10gPSBwcm9wc1trXTtcbiAgICByZXR1cm4gcmVzdDtcbn1cbmZ1bmN0aW9uIG9uY2UoZm4pIHtcbiAgICBsZXQgcmFuID0gZmFsc2U7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICguLi5hcmdzKSB7XG4gICAgICAgIGlmIChyYW4pXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIHJhbiA9IHRydWU7XG4gICAgICAgIGZuLmNhbGwodGhpcywgLi4uYXJncyk7XG4gICAgfTtcbn1cbmZ1bmN0aW9uIG51bGxfdG9fZW1wdHkodmFsdWUpIHtcbiAgICByZXR1cm4gdmFsdWUgPT0gbnVsbCA/ICcnIDogdmFsdWU7XG59XG5mdW5jdGlvbiBzZXRfc3RvcmVfdmFsdWUoc3RvcmUsIHJldCwgdmFsdWUgPSByZXQpIHtcbiAgICBzdG9yZS5zZXQodmFsdWUpO1xuICAgIHJldHVybiByZXQ7XG59XG5jb25zdCBoYXNfcHJvcCA9IChvYmosIHByb3ApID0+IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmosIHByb3ApO1xuZnVuY3Rpb24gYWN0aW9uX2Rlc3Ryb3llcihhY3Rpb25fcmVzdWx0KSB7XG4gICAgcmV0dXJuIGFjdGlvbl9yZXN1bHQgJiYgaXNfZnVuY3Rpb24oYWN0aW9uX3Jlc3VsdC5kZXN0cm95KSA/IGFjdGlvbl9yZXN1bHQuZGVzdHJveSA6IG5vb3A7XG59XG5cbmNvbnN0IGlzX2NsaWVudCA9IHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnO1xubGV0IG5vdyA9IGlzX2NsaWVudFxuICAgID8gKCkgPT4gd2luZG93LnBlcmZvcm1hbmNlLm5vdygpXG4gICAgOiAoKSA9PiBEYXRlLm5vdygpO1xubGV0IHJhZiA9IGlzX2NsaWVudCA/IGNiID0+IHJlcXVlc3RBbmltYXRpb25GcmFtZShjYikgOiBub29wO1xuLy8gdXNlZCBpbnRlcm5hbGx5IGZvciB0ZXN0aW5nXG5mdW5jdGlvbiBzZXRfbm93KGZuKSB7XG4gICAgbm93ID0gZm47XG59XG5mdW5jdGlvbiBzZXRfcmFmKGZuKSB7XG4gICAgcmFmID0gZm47XG59XG5cbmNvbnN0IHRhc2tzID0gbmV3IFNldCgpO1xuZnVuY3Rpb24gcnVuX3Rhc2tzKG5vdykge1xuICAgIHRhc2tzLmZvckVhY2godGFzayA9PiB7XG4gICAgICAgIGlmICghdGFzay5jKG5vdykpIHtcbiAgICAgICAgICAgIHRhc2tzLmRlbGV0ZSh0YXNrKTtcbiAgICAgICAgICAgIHRhc2suZigpO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgaWYgKHRhc2tzLnNpemUgIT09IDApXG4gICAgICAgIHJhZihydW5fdGFza3MpO1xufVxuLyoqXG4gKiBGb3IgdGVzdGluZyBwdXJwb3NlcyBvbmx5IVxuICovXG5mdW5jdGlvbiBjbGVhcl9sb29wcygpIHtcbiAgICB0YXNrcy5jbGVhcigpO1xufVxuLyoqXG4gKiBDcmVhdGVzIGEgbmV3IHRhc2sgdGhhdCBydW5zIG9uIGVhY2ggcmFmIGZyYW1lXG4gKiB1bnRpbCBpdCByZXR1cm5zIGEgZmFsc3kgdmFsdWUgb3IgaXMgYWJvcnRlZFxuICovXG5mdW5jdGlvbiBsb29wKGNhbGxiYWNrKSB7XG4gICAgbGV0IHRhc2s7XG4gICAgaWYgKHRhc2tzLnNpemUgPT09IDApXG4gICAgICAgIHJhZihydW5fdGFza3MpO1xuICAgIHJldHVybiB7XG4gICAgICAgIHByb21pc2U6IG5ldyBQcm9taXNlKGZ1bGZpbGwgPT4ge1xuICAgICAgICAgICAgdGFza3MuYWRkKHRhc2sgPSB7IGM6IGNhbGxiYWNrLCBmOiBmdWxmaWxsIH0pO1xuICAgICAgICB9KSxcbiAgICAgICAgYWJvcnQoKSB7XG4gICAgICAgICAgICB0YXNrcy5kZWxldGUodGFzayk7XG4gICAgICAgIH1cbiAgICB9O1xufVxuXG5mdW5jdGlvbiBhcHBlbmQodGFyZ2V0LCBub2RlKSB7XG4gICAgdGFyZ2V0LmFwcGVuZENoaWxkKG5vZGUpO1xufVxuZnVuY3Rpb24gaW5zZXJ0KHRhcmdldCwgbm9kZSwgYW5jaG9yKSB7XG4gICAgdGFyZ2V0Lmluc2VydEJlZm9yZShub2RlLCBhbmNob3IgfHwgbnVsbCk7XG59XG5mdW5jdGlvbiBkZXRhY2gobm9kZSkge1xuICAgIG5vZGUucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChub2RlKTtcbn1cbmZ1bmN0aW9uIGRlc3Ryb3lfZWFjaChpdGVyYXRpb25zLCBkZXRhY2hpbmcpIHtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGl0ZXJhdGlvbnMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgaWYgKGl0ZXJhdGlvbnNbaV0pXG4gICAgICAgICAgICBpdGVyYXRpb25zW2ldLmQoZGV0YWNoaW5nKTtcbiAgICB9XG59XG5mdW5jdGlvbiBlbGVtZW50KG5hbWUpIHtcbiAgICByZXR1cm4gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChuYW1lKTtcbn1cbmZ1bmN0aW9uIGVsZW1lbnRfaXMobmFtZSwgaXMpIHtcbiAgICByZXR1cm4gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChuYW1lLCB7IGlzIH0pO1xufVxuZnVuY3Rpb24gb2JqZWN0X3dpdGhvdXRfcHJvcGVydGllcyhvYmosIGV4Y2x1ZGUpIHtcbiAgICBjb25zdCB0YXJnZXQgPSB7fTtcbiAgICBmb3IgKGNvbnN0IGsgaW4gb2JqKSB7XG4gICAgICAgIGlmIChoYXNfcHJvcChvYmosIGspXG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICAmJiBleGNsdWRlLmluZGV4T2YoaykgPT09IC0xKSB7XG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICB0YXJnZXRba10gPSBvYmpba107XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRhcmdldDtcbn1cbmZ1bmN0aW9uIHN2Z19lbGVtZW50KG5hbWUpIHtcbiAgICByZXR1cm4gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKCdodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZycsIG5hbWUpO1xufVxuZnVuY3Rpb24gdGV4dChkYXRhKSB7XG4gICAgcmV0dXJuIGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKGRhdGEpO1xufVxuZnVuY3Rpb24gc3BhY2UoKSB7XG4gICAgcmV0dXJuIHRleHQoJyAnKTtcbn1cbmZ1bmN0aW9uIGVtcHR5KCkge1xuICAgIHJldHVybiB0ZXh0KCcnKTtcbn1cbmZ1bmN0aW9uIGxpc3Rlbihub2RlLCBldmVudCwgaGFuZGxlciwgb3B0aW9ucykge1xuICAgIG5vZGUuYWRkRXZlbnRMaXN0ZW5lcihldmVudCwgaGFuZGxlciwgb3B0aW9ucyk7XG4gICAgcmV0dXJuICgpID0+IG5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcihldmVudCwgaGFuZGxlciwgb3B0aW9ucyk7XG59XG5mdW5jdGlvbiBwcmV2ZW50X2RlZmF1bHQoZm4pIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgcmV0dXJuIGZuLmNhbGwodGhpcywgZXZlbnQpO1xuICAgIH07XG59XG5mdW5jdGlvbiBzdG9wX3Byb3BhZ2F0aW9uKGZuKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICByZXR1cm4gZm4uY2FsbCh0aGlzLCBldmVudCk7XG4gICAgfTtcbn1cbmZ1bmN0aW9uIHNlbGYoZm4pIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgaWYgKGV2ZW50LnRhcmdldCA9PT0gdGhpcylcbiAgICAgICAgICAgIGZuLmNhbGwodGhpcywgZXZlbnQpO1xuICAgIH07XG59XG5mdW5jdGlvbiBhdHRyKG5vZGUsIGF0dHJpYnV0ZSwgdmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbClcbiAgICAgICAgbm9kZS5yZW1vdmVBdHRyaWJ1dGUoYXR0cmlidXRlKTtcbiAgICBlbHNlIGlmIChub2RlLmdldEF0dHJpYnV0ZShhdHRyaWJ1dGUpICE9PSB2YWx1ZSlcbiAgICAgICAgbm9kZS5zZXRBdHRyaWJ1dGUoYXR0cmlidXRlLCB2YWx1ZSk7XG59XG5mdW5jdGlvbiBzZXRfYXR0cmlidXRlcyhub2RlLCBhdHRyaWJ1dGVzKSB7XG4gICAgLy8gQHRzLWlnbm9yZVxuICAgIGNvbnN0IGRlc2NyaXB0b3JzID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcnMobm9kZS5fX3Byb3RvX18pO1xuICAgIGZvciAoY29uc3Qga2V5IGluIGF0dHJpYnV0ZXMpIHtcbiAgICAgICAgaWYgKGF0dHJpYnV0ZXNba2V5XSA9PSBudWxsKSB7XG4gICAgICAgICAgICBub2RlLnJlbW92ZUF0dHJpYnV0ZShrZXkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGtleSA9PT0gJ3N0eWxlJykge1xuICAgICAgICAgICAgbm9kZS5zdHlsZS5jc3NUZXh0ID0gYXR0cmlidXRlc1trZXldO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGtleSA9PT0gJ19fdmFsdWUnKSB7XG4gICAgICAgICAgICBub2RlLnZhbHVlID0gbm9kZVtrZXldID0gYXR0cmlidXRlc1trZXldO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGRlc2NyaXB0b3JzW2tleV0gJiYgZGVzY3JpcHRvcnNba2V5XS5zZXQpIHtcbiAgICAgICAgICAgIG5vZGVba2V5XSA9IGF0dHJpYnV0ZXNba2V5XTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGF0dHIobm9kZSwga2V5LCBhdHRyaWJ1dGVzW2tleV0pO1xuICAgICAgICB9XG4gICAgfVxufVxuZnVuY3Rpb24gc2V0X3N2Z19hdHRyaWJ1dGVzKG5vZGUsIGF0dHJpYnV0ZXMpIHtcbiAgICBmb3IgKGNvbnN0IGtleSBpbiBhdHRyaWJ1dGVzKSB7XG4gICAgICAgIGF0dHIobm9kZSwga2V5LCBhdHRyaWJ1dGVzW2tleV0pO1xuICAgIH1cbn1cbmZ1bmN0aW9uIHNldF9jdXN0b21fZWxlbWVudF9kYXRhKG5vZGUsIHByb3AsIHZhbHVlKSB7XG4gICAgaWYgKHByb3AgaW4gbm9kZSkge1xuICAgICAgICBub2RlW3Byb3BdID0gdmFsdWU7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICBhdHRyKG5vZGUsIHByb3AsIHZhbHVlKTtcbiAgICB9XG59XG5mdW5jdGlvbiB4bGlua19hdHRyKG5vZGUsIGF0dHJpYnV0ZSwgdmFsdWUpIHtcbiAgICBub2RlLnNldEF0dHJpYnV0ZU5TKCdodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rJywgYXR0cmlidXRlLCB2YWx1ZSk7XG59XG5mdW5jdGlvbiBnZXRfYmluZGluZ19ncm91cF92YWx1ZShncm91cCkge1xuICAgIGNvbnN0IHZhbHVlID0gW107XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBncm91cC5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBpZiAoZ3JvdXBbaV0uY2hlY2tlZClcbiAgICAgICAgICAgIHZhbHVlLnB1c2goZ3JvdXBbaV0uX192YWx1ZSk7XG4gICAgfVxuICAgIHJldHVybiB2YWx1ZTtcbn1cbmZ1bmN0aW9uIHRvX251bWJlcih2YWx1ZSkge1xuICAgIHJldHVybiB2YWx1ZSA9PT0gJycgPyB1bmRlZmluZWQgOiArdmFsdWU7XG59XG5mdW5jdGlvbiB0aW1lX3Jhbmdlc190b19hcnJheShyYW5nZXMpIHtcbiAgICBjb25zdCBhcnJheSA9IFtdO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmFuZ2VzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgIGFycmF5LnB1c2goeyBzdGFydDogcmFuZ2VzLnN0YXJ0KGkpLCBlbmQ6IHJhbmdlcy5lbmQoaSkgfSk7XG4gICAgfVxuICAgIHJldHVybiBhcnJheTtcbn1cbmZ1bmN0aW9uIGNoaWxkcmVuKGVsZW1lbnQpIHtcbiAgICByZXR1cm4gQXJyYXkuZnJvbShlbGVtZW50LmNoaWxkTm9kZXMpO1xufVxuZnVuY3Rpb24gY2xhaW1fZWxlbWVudChub2RlcywgbmFtZSwgYXR0cmlidXRlcywgc3ZnKSB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBub2Rlcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBub2RlID0gbm9kZXNbaV07XG4gICAgICAgIGlmIChub2RlLm5vZGVOYW1lID09PSBuYW1lKSB7XG4gICAgICAgICAgICBsZXQgaiA9IDA7XG4gICAgICAgICAgICB3aGlsZSAoaiA8IG5vZGUuYXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBhdHRyaWJ1dGUgPSBub2RlLmF0dHJpYnV0ZXNbal07XG4gICAgICAgICAgICAgICAgaWYgKGF0dHJpYnV0ZXNbYXR0cmlidXRlLm5hbWVdKSB7XG4gICAgICAgICAgICAgICAgICAgIGorKztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUucmVtb3ZlQXR0cmlidXRlKGF0dHJpYnV0ZS5uYW1lKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gbm9kZXMuc3BsaWNlKGksIDEpWzBdO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBzdmcgPyBzdmdfZWxlbWVudChuYW1lKSA6IGVsZW1lbnQobmFtZSk7XG59XG5mdW5jdGlvbiBjbGFpbV90ZXh0KG5vZGVzLCBkYXRhKSB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBub2Rlcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBub2RlID0gbm9kZXNbaV07XG4gICAgICAgIGlmIChub2RlLm5vZGVUeXBlID09PSAzKSB7XG4gICAgICAgICAgICBub2RlLmRhdGEgPSAnJyArIGRhdGE7XG4gICAgICAgICAgICByZXR1cm4gbm9kZXMuc3BsaWNlKGksIDEpWzBdO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0ZXh0KGRhdGEpO1xufVxuZnVuY3Rpb24gY2xhaW1fc3BhY2Uobm9kZXMpIHtcbiAgICByZXR1cm4gY2xhaW1fdGV4dChub2RlcywgJyAnKTtcbn1cbmZ1bmN0aW9uIHNldF9kYXRhKHRleHQsIGRhdGEpIHtcbiAgICBkYXRhID0gJycgKyBkYXRhO1xuICAgIGlmICh0ZXh0LmRhdGEgIT09IGRhdGEpXG4gICAgICAgIHRleHQuZGF0YSA9IGRhdGE7XG59XG5mdW5jdGlvbiBzZXRfaW5wdXRfdmFsdWUoaW5wdXQsIHZhbHVlKSB7XG4gICAgaW5wdXQudmFsdWUgPSB2YWx1ZSA9PSBudWxsID8gJycgOiB2YWx1ZTtcbn1cbmZ1bmN0aW9uIHNldF9pbnB1dF90eXBlKGlucHV0LCB0eXBlKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgaW5wdXQudHlwZSA9IHR5cGU7XG4gICAgfVxuICAgIGNhdGNoIChlKSB7XG4gICAgICAgIC8vIGRvIG5vdGhpbmdcbiAgICB9XG59XG5mdW5jdGlvbiBzZXRfc3R5bGUobm9kZSwga2V5LCB2YWx1ZSwgaW1wb3J0YW50KSB7XG4gICAgbm9kZS5zdHlsZS5zZXRQcm9wZXJ0eShrZXksIHZhbHVlLCBpbXBvcnRhbnQgPyAnaW1wb3J0YW50JyA6ICcnKTtcbn1cbmZ1bmN0aW9uIHNlbGVjdF9vcHRpb24oc2VsZWN0LCB2YWx1ZSkge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgc2VsZWN0Lm9wdGlvbnMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9uID0gc2VsZWN0Lm9wdGlvbnNbaV07XG4gICAgICAgIGlmIChvcHRpb24uX192YWx1ZSA9PT0gdmFsdWUpIHtcbiAgICAgICAgICAgIG9wdGlvbi5zZWxlY3RlZCA9IHRydWU7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICB9XG59XG5mdW5jdGlvbiBzZWxlY3Rfb3B0aW9ucyhzZWxlY3QsIHZhbHVlKSB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWxlY3Qub3B0aW9ucy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBvcHRpb24gPSBzZWxlY3Qub3B0aW9uc1tpXTtcbiAgICAgICAgb3B0aW9uLnNlbGVjdGVkID0gfnZhbHVlLmluZGV4T2Yob3B0aW9uLl9fdmFsdWUpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIHNlbGVjdF92YWx1ZShzZWxlY3QpIHtcbiAgICBjb25zdCBzZWxlY3RlZF9vcHRpb24gPSBzZWxlY3QucXVlcnlTZWxlY3RvcignOmNoZWNrZWQnKSB8fCBzZWxlY3Qub3B0aW9uc1swXTtcbiAgICByZXR1cm4gc2VsZWN0ZWRfb3B0aW9uICYmIHNlbGVjdGVkX29wdGlvbi5fX3ZhbHVlO1xufVxuZnVuY3Rpb24gc2VsZWN0X211bHRpcGxlX3ZhbHVlKHNlbGVjdCkge1xuICAgIHJldHVybiBbXS5tYXAuY2FsbChzZWxlY3QucXVlcnlTZWxlY3RvckFsbCgnOmNoZWNrZWQnKSwgb3B0aW9uID0+IG9wdGlvbi5fX3ZhbHVlKTtcbn1cbi8vIHVuZm9ydHVuYXRlbHkgdGhpcyBjYW4ndCBiZSBhIGNvbnN0YW50IGFzIHRoYXQgd291bGRuJ3QgYmUgdHJlZS1zaGFrZWFibGVcbi8vIHNvIHdlIGNhY2hlIHRoZSByZXN1bHQgaW5zdGVhZFxubGV0IGNyb3Nzb3JpZ2luO1xuZnVuY3Rpb24gaXNfY3Jvc3NvcmlnaW4oKSB7XG4gICAgaWYgKGNyb3Nzb3JpZ2luID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY3Jvc3NvcmlnaW4gPSBmYWxzZTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB3aW5kb3cucGFyZW50KSB7XG4gICAgICAgICAgICAgICAgdm9pZCB3aW5kb3cucGFyZW50LmRvY3VtZW50O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY3Jvc3NvcmlnaW4gPSB0cnVlO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBjcm9zc29yaWdpbjtcbn1cbmZ1bmN0aW9uIGFkZF9yZXNpemVfbGlzdGVuZXIobm9kZSwgZm4pIHtcbiAgICBjb25zdCBjb21wdXRlZF9zdHlsZSA9IGdldENvbXB1dGVkU3R5bGUobm9kZSk7XG4gICAgY29uc3Qgel9pbmRleCA9IChwYXJzZUludChjb21wdXRlZF9zdHlsZS56SW5kZXgpIHx8IDApIC0gMTtcbiAgICBpZiAoY29tcHV0ZWRfc3R5bGUucG9zaXRpb24gPT09ICdzdGF0aWMnKSB7XG4gICAgICAgIG5vZGUuc3R5bGUucG9zaXRpb24gPSAncmVsYXRpdmUnO1xuICAgIH1cbiAgICBjb25zdCBpZnJhbWUgPSBlbGVtZW50KCdpZnJhbWUnKTtcbiAgICBpZnJhbWUuc2V0QXR0cmlidXRlKCdzdHlsZScsIGBkaXNwbGF5OiBibG9jazsgcG9zaXRpb246IGFic29sdXRlOyB0b3A6IDA7IGxlZnQ6IDA7IHdpZHRoOiAxMDAlOyBoZWlnaHQ6IDEwMCU7IGAgK1xuICAgICAgICBgb3ZlcmZsb3c6IGhpZGRlbjsgYm9yZGVyOiAwOyBvcGFjaXR5OiAwOyBwb2ludGVyLWV2ZW50czogbm9uZTsgei1pbmRleDogJHt6X2luZGV4fTtgKTtcbiAgICBpZnJhbWUuc2V0QXR0cmlidXRlKCdhcmlhLWhpZGRlbicsICd0cnVlJyk7XG4gICAgaWZyYW1lLnRhYkluZGV4ID0gLTE7XG4gICAgY29uc3QgY3Jvc3NvcmlnaW4gPSBpc19jcm9zc29yaWdpbigpO1xuICAgIGxldCB1bnN1YnNjcmliZTtcbiAgICBpZiAoY3Jvc3NvcmlnaW4pIHtcbiAgICAgICAgaWZyYW1lLnNyYyA9IGBkYXRhOnRleHQvaHRtbCw8c2NyaXB0Pm9ucmVzaXplPWZ1bmN0aW9uKCl7cGFyZW50LnBvc3RNZXNzYWdlKDAsJyonKX08L3NjcmlwdD5gO1xuICAgICAgICB1bnN1YnNjcmliZSA9IGxpc3Rlbih3aW5kb3csICdtZXNzYWdlJywgKGV2ZW50KSA9PiB7XG4gICAgICAgICAgICBpZiAoZXZlbnQuc291cmNlID09PSBpZnJhbWUuY29udGVudFdpbmRvdylcbiAgICAgICAgICAgICAgICBmbigpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIGlmcmFtZS5zcmMgPSAnYWJvdXQ6YmxhbmsnO1xuICAgICAgICBpZnJhbWUub25sb2FkID0gKCkgPT4ge1xuICAgICAgICAgICAgdW5zdWJzY3JpYmUgPSBsaXN0ZW4oaWZyYW1lLmNvbnRlbnRXaW5kb3csICdyZXNpemUnLCBmbik7XG4gICAgICAgIH07XG4gICAgfVxuICAgIGFwcGVuZChub2RlLCBpZnJhbWUpO1xuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgIGlmIChjcm9zc29yaWdpbikge1xuICAgICAgICAgICAgdW5zdWJzY3JpYmUoKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmICh1bnN1YnNjcmliZSAmJiBpZnJhbWUuY29udGVudFdpbmRvdykge1xuICAgICAgICAgICAgdW5zdWJzY3JpYmUoKTtcbiAgICAgICAgfVxuICAgICAgICBkZXRhY2goaWZyYW1lKTtcbiAgICB9O1xufVxuZnVuY3Rpb24gdG9nZ2xlX2NsYXNzKGVsZW1lbnQsIG5hbWUsIHRvZ2dsZSkge1xuICAgIGVsZW1lbnQuY2xhc3NMaXN0W3RvZ2dsZSA/ICdhZGQnIDogJ3JlbW92ZSddKG5hbWUpO1xufVxuZnVuY3Rpb24gY3VzdG9tX2V2ZW50KHR5cGUsIGRldGFpbCkge1xuICAgIGNvbnN0IGUgPSBkb2N1bWVudC5jcmVhdGVFdmVudCgnQ3VzdG9tRXZlbnQnKTtcbiAgICBlLmluaXRDdXN0b21FdmVudCh0eXBlLCBmYWxzZSwgZmFsc2UsIGRldGFpbCk7XG4gICAgcmV0dXJuIGU7XG59XG5mdW5jdGlvbiBxdWVyeV9zZWxlY3Rvcl9hbGwoc2VsZWN0b3IsIHBhcmVudCA9IGRvY3VtZW50LmJvZHkpIHtcbiAgICByZXR1cm4gQXJyYXkuZnJvbShwYXJlbnQucXVlcnlTZWxlY3RvckFsbChzZWxlY3RvcikpO1xufVxuY2xhc3MgSHRtbFRhZyB7XG4gICAgY29uc3RydWN0b3IoYW5jaG9yID0gbnVsbCkge1xuICAgICAgICB0aGlzLmEgPSBhbmNob3I7XG4gICAgICAgIHRoaXMuZSA9IHRoaXMubiA9IG51bGw7XG4gICAgfVxuICAgIG0oaHRtbCwgdGFyZ2V0LCBhbmNob3IgPSBudWxsKSB7XG4gICAgICAgIGlmICghdGhpcy5lKSB7XG4gICAgICAgICAgICB0aGlzLmUgPSBlbGVtZW50KHRhcmdldC5ub2RlTmFtZSk7XG4gICAgICAgICAgICB0aGlzLnQgPSB0YXJnZXQ7XG4gICAgICAgICAgICB0aGlzLmgoaHRtbCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5pKGFuY2hvcik7XG4gICAgfVxuICAgIGgoaHRtbCkge1xuICAgICAgICB0aGlzLmUuaW5uZXJIVE1MID0gaHRtbDtcbiAgICAgICAgdGhpcy5uID0gQXJyYXkuZnJvbSh0aGlzLmUuY2hpbGROb2Rlcyk7XG4gICAgfVxuICAgIGkoYW5jaG9yKSB7XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5uLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgICAgICBpbnNlcnQodGhpcy50LCB0aGlzLm5baV0sIGFuY2hvcik7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcChodG1sKSB7XG4gICAgICAgIHRoaXMuZCgpO1xuICAgICAgICB0aGlzLmgoaHRtbCk7XG4gICAgICAgIHRoaXMuaSh0aGlzLmEpO1xuICAgIH1cbiAgICBkKCkge1xuICAgICAgICB0aGlzLm4uZm9yRWFjaChkZXRhY2gpO1xuICAgIH1cbn1cblxuY29uc3QgYWN0aXZlX2RvY3MgPSBuZXcgU2V0KCk7XG5sZXQgYWN0aXZlID0gMDtcbi8vIGh0dHBzOi8vZ2l0aHViLmNvbS9kYXJrc2t5YXBwL3N0cmluZy1oYXNoL2Jsb2IvbWFzdGVyL2luZGV4LmpzXG5mdW5jdGlvbiBoYXNoKHN0cikge1xuICAgIGxldCBoYXNoID0gNTM4MTtcbiAgICBsZXQgaSA9IHN0ci5sZW5ndGg7XG4gICAgd2hpbGUgKGktLSlcbiAgICAgICAgaGFzaCA9ICgoaGFzaCA8PCA1KSAtIGhhc2gpIF4gc3RyLmNoYXJDb2RlQXQoaSk7XG4gICAgcmV0dXJuIGhhc2ggPj4+IDA7XG59XG5mdW5jdGlvbiBjcmVhdGVfcnVsZShub2RlLCBhLCBiLCBkdXJhdGlvbiwgZGVsYXksIGVhc2UsIGZuLCB1aWQgPSAwKSB7XG4gICAgY29uc3Qgc3RlcCA9IDE2LjY2NiAvIGR1cmF0aW9uO1xuICAgIGxldCBrZXlmcmFtZXMgPSAne1xcbic7XG4gICAgZm9yIChsZXQgcCA9IDA7IHAgPD0gMTsgcCArPSBzdGVwKSB7XG4gICAgICAgIGNvbnN0IHQgPSBhICsgKGIgLSBhKSAqIGVhc2UocCk7XG4gICAgICAgIGtleWZyYW1lcyArPSBwICogMTAwICsgYCV7JHtmbih0LCAxIC0gdCl9fVxcbmA7XG4gICAgfVxuICAgIGNvbnN0IHJ1bGUgPSBrZXlmcmFtZXMgKyBgMTAwJSB7JHtmbihiLCAxIC0gYil9fVxcbn1gO1xuICAgIGNvbnN0IG5hbWUgPSBgX19zdmVsdGVfJHtoYXNoKHJ1bGUpfV8ke3VpZH1gO1xuICAgIGNvbnN0IGRvYyA9IG5vZGUub3duZXJEb2N1bWVudDtcbiAgICBhY3RpdmVfZG9jcy5hZGQoZG9jKTtcbiAgICBjb25zdCBzdHlsZXNoZWV0ID0gZG9jLl9fc3ZlbHRlX3N0eWxlc2hlZXQgfHwgKGRvYy5fX3N2ZWx0ZV9zdHlsZXNoZWV0ID0gZG9jLmhlYWQuYXBwZW5kQ2hpbGQoZWxlbWVudCgnc3R5bGUnKSkuc2hlZXQpO1xuICAgIGNvbnN0IGN1cnJlbnRfcnVsZXMgPSBkb2MuX19zdmVsdGVfcnVsZXMgfHwgKGRvYy5fX3N2ZWx0ZV9ydWxlcyA9IHt9KTtcbiAgICBpZiAoIWN1cnJlbnRfcnVsZXNbbmFtZV0pIHtcbiAgICAgICAgY3VycmVudF9ydWxlc1tuYW1lXSA9IHRydWU7XG4gICAgICAgIHN0eWxlc2hlZXQuaW5zZXJ0UnVsZShgQGtleWZyYW1lcyAke25hbWV9ICR7cnVsZX1gLCBzdHlsZXNoZWV0LmNzc1J1bGVzLmxlbmd0aCk7XG4gICAgfVxuICAgIGNvbnN0IGFuaW1hdGlvbiA9IG5vZGUuc3R5bGUuYW5pbWF0aW9uIHx8ICcnO1xuICAgIG5vZGUuc3R5bGUuYW5pbWF0aW9uID0gYCR7YW5pbWF0aW9uID8gYCR7YW5pbWF0aW9ufSwgYCA6IGBgfSR7bmFtZX0gJHtkdXJhdGlvbn1tcyBsaW5lYXIgJHtkZWxheX1tcyAxIGJvdGhgO1xuICAgIGFjdGl2ZSArPSAxO1xuICAgIHJldHVybiBuYW1lO1xufVxuZnVuY3Rpb24gZGVsZXRlX3J1bGUobm9kZSwgbmFtZSkge1xuICAgIGNvbnN0IHByZXZpb3VzID0gKG5vZGUuc3R5bGUuYW5pbWF0aW9uIHx8ICcnKS5zcGxpdCgnLCAnKTtcbiAgICBjb25zdCBuZXh0ID0gcHJldmlvdXMuZmlsdGVyKG5hbWVcbiAgICAgICAgPyBhbmltID0+IGFuaW0uaW5kZXhPZihuYW1lKSA8IDAgLy8gcmVtb3ZlIHNwZWNpZmljIGFuaW1hdGlvblxuICAgICAgICA6IGFuaW0gPT4gYW5pbS5pbmRleE9mKCdfX3N2ZWx0ZScpID09PSAtMSAvLyByZW1vdmUgYWxsIFN2ZWx0ZSBhbmltYXRpb25zXG4gICAgKTtcbiAgICBjb25zdCBkZWxldGVkID0gcHJldmlvdXMubGVuZ3RoIC0gbmV4dC5sZW5ndGg7XG4gICAgaWYgKGRlbGV0ZWQpIHtcbiAgICAgICAgbm9kZS5zdHlsZS5hbmltYXRpb24gPSBuZXh0LmpvaW4oJywgJyk7XG4gICAgICAgIGFjdGl2ZSAtPSBkZWxldGVkO1xuICAgICAgICBpZiAoIWFjdGl2ZSlcbiAgICAgICAgICAgIGNsZWFyX3J1bGVzKCk7XG4gICAgfVxufVxuZnVuY3Rpb24gY2xlYXJfcnVsZXMoKSB7XG4gICAgcmFmKCgpID0+IHtcbiAgICAgICAgaWYgKGFjdGl2ZSlcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgYWN0aXZlX2RvY3MuZm9yRWFjaChkb2MgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc3R5bGVzaGVldCA9IGRvYy5fX3N2ZWx0ZV9zdHlsZXNoZWV0O1xuICAgICAgICAgICAgbGV0IGkgPSBzdHlsZXNoZWV0LmNzc1J1bGVzLmxlbmd0aDtcbiAgICAgICAgICAgIHdoaWxlIChpLS0pXG4gICAgICAgICAgICAgICAgc3R5bGVzaGVldC5kZWxldGVSdWxlKGkpO1xuICAgICAgICAgICAgZG9jLl9fc3ZlbHRlX3J1bGVzID0ge307XG4gICAgICAgIH0pO1xuICAgICAgICBhY3RpdmVfZG9jcy5jbGVhcigpO1xuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVfYW5pbWF0aW9uKG5vZGUsIGZyb20sIGZuLCBwYXJhbXMpIHtcbiAgICBpZiAoIWZyb20pXG4gICAgICAgIHJldHVybiBub29wO1xuICAgIGNvbnN0IHRvID0gbm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBpZiAoZnJvbS5sZWZ0ID09PSB0by5sZWZ0ICYmIGZyb20ucmlnaHQgPT09IHRvLnJpZ2h0ICYmIGZyb20udG9wID09PSB0by50b3AgJiYgZnJvbS5ib3R0b20gPT09IHRvLmJvdHRvbSlcbiAgICAgICAgcmV0dXJuIG5vb3A7XG4gICAgY29uc3QgeyBkZWxheSA9IDAsIGR1cmF0aW9uID0gMzAwLCBlYXNpbmcgPSBpZGVudGl0eSwgXG4gICAgLy8gQHRzLWlnbm9yZSB0b2RvOiBzaG91bGQgdGhpcyBiZSBzZXBhcmF0ZWQgZnJvbSBkZXN0cnVjdHVyaW5nPyBPciBzdGFydC9lbmQgYWRkZWQgdG8gcHVibGljIGFwaSBhbmQgZG9jdW1lbnRhdGlvbj9cbiAgICBzdGFydDogc3RhcnRfdGltZSA9IG5vdygpICsgZGVsYXksIFxuICAgIC8vIEB0cy1pZ25vcmUgdG9kbzpcbiAgICBlbmQgPSBzdGFydF90aW1lICsgZHVyYXRpb24sIHRpY2sgPSBub29wLCBjc3MgfSA9IGZuKG5vZGUsIHsgZnJvbSwgdG8gfSwgcGFyYW1zKTtcbiAgICBsZXQgcnVubmluZyA9IHRydWU7XG4gICAgbGV0IHN0YXJ0ZWQgPSBmYWxzZTtcbiAgICBsZXQgbmFtZTtcbiAgICBmdW5jdGlvbiBzdGFydCgpIHtcbiAgICAgICAgaWYgKGNzcykge1xuICAgICAgICAgICAgbmFtZSA9IGNyZWF0ZV9ydWxlKG5vZGUsIDAsIDEsIGR1cmF0aW9uLCBkZWxheSwgZWFzaW5nLCBjc3MpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghZGVsYXkpIHtcbiAgICAgICAgICAgIHN0YXJ0ZWQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgfVxuICAgIGZ1bmN0aW9uIHN0b3AoKSB7XG4gICAgICAgIGlmIChjc3MpXG4gICAgICAgICAgICBkZWxldGVfcnVsZShub2RlLCBuYW1lKTtcbiAgICAgICAgcnVubmluZyA9IGZhbHNlO1xuICAgIH1cbiAgICBsb29wKG5vdyA9PiB7XG4gICAgICAgIGlmICghc3RhcnRlZCAmJiBub3cgPj0gc3RhcnRfdGltZSkge1xuICAgICAgICAgICAgc3RhcnRlZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHN0YXJ0ZWQgJiYgbm93ID49IGVuZCkge1xuICAgICAgICAgICAgdGljaygxLCAwKTtcbiAgICAgICAgICAgIHN0b3AoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXJ1bm5pbmcpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc3RhcnRlZCkge1xuICAgICAgICAgICAgY29uc3QgcCA9IG5vdyAtIHN0YXJ0X3RpbWU7XG4gICAgICAgICAgICBjb25zdCB0ID0gMCArIDEgKiBlYXNpbmcocCAvIGR1cmF0aW9uKTtcbiAgICAgICAgICAgIHRpY2sodCwgMSAtIHQpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH0pO1xuICAgIHN0YXJ0KCk7XG4gICAgdGljaygwLCAxKTtcbiAgICByZXR1cm4gc3RvcDtcbn1cbmZ1bmN0aW9uIGZpeF9wb3NpdGlvbihub2RlKSB7XG4gICAgY29uc3Qgc3R5bGUgPSBnZXRDb21wdXRlZFN0eWxlKG5vZGUpO1xuICAgIGlmIChzdHlsZS5wb3NpdGlvbiAhPT0gJ2Fic29sdXRlJyAmJiBzdHlsZS5wb3NpdGlvbiAhPT0gJ2ZpeGVkJykge1xuICAgICAgICBjb25zdCB7IHdpZHRoLCBoZWlnaHQgfSA9IHN0eWxlO1xuICAgICAgICBjb25zdCBhID0gbm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgbm9kZS5zdHlsZS5wb3NpdGlvbiA9ICdhYnNvbHV0ZSc7XG4gICAgICAgIG5vZGUuc3R5bGUud2lkdGggPSB3aWR0aDtcbiAgICAgICAgbm9kZS5zdHlsZS5oZWlnaHQgPSBoZWlnaHQ7XG4gICAgICAgIGFkZF90cmFuc2Zvcm0obm9kZSwgYSk7XG4gICAgfVxufVxuZnVuY3Rpb24gYWRkX3RyYW5zZm9ybShub2RlLCBhKSB7XG4gICAgY29uc3QgYiA9IG5vZGUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgaWYgKGEubGVmdCAhPT0gYi5sZWZ0IHx8IGEudG9wICE9PSBiLnRvcCkge1xuICAgICAgICBjb25zdCBzdHlsZSA9IGdldENvbXB1dGVkU3R5bGUobm9kZSk7XG4gICAgICAgIGNvbnN0IHRyYW5zZm9ybSA9IHN0eWxlLnRyYW5zZm9ybSA9PT0gJ25vbmUnID8gJycgOiBzdHlsZS50cmFuc2Zvcm07XG4gICAgICAgIG5vZGUuc3R5bGUudHJhbnNmb3JtID0gYCR7dHJhbnNmb3JtfSB0cmFuc2xhdGUoJHthLmxlZnQgLSBiLmxlZnR9cHgsICR7YS50b3AgLSBiLnRvcH1weClgO1xuICAgIH1cbn1cblxubGV0IGN1cnJlbnRfY29tcG9uZW50O1xuZnVuY3Rpb24gc2V0X2N1cnJlbnRfY29tcG9uZW50KGNvbXBvbmVudCkge1xuICAgIGN1cnJlbnRfY29tcG9uZW50ID0gY29tcG9uZW50O1xufVxuZnVuY3Rpb24gZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkge1xuICAgIGlmICghY3VycmVudF9jb21wb25lbnQpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRnVuY3Rpb24gY2FsbGVkIG91dHNpZGUgY29tcG9uZW50IGluaXRpYWxpemF0aW9uYCk7XG4gICAgcmV0dXJuIGN1cnJlbnRfY29tcG9uZW50O1xufVxuZnVuY3Rpb24gYmVmb3JlVXBkYXRlKGZuKSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuYmVmb3JlX3VwZGF0ZS5wdXNoKGZuKTtcbn1cbmZ1bmN0aW9uIG9uTW91bnQoZm4pIHtcbiAgICBnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5vbl9tb3VudC5wdXNoKGZuKTtcbn1cbmZ1bmN0aW9uIGFmdGVyVXBkYXRlKGZuKSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuYWZ0ZXJfdXBkYXRlLnB1c2goZm4pO1xufVxuZnVuY3Rpb24gb25EZXN0cm95KGZuKSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQub25fZGVzdHJveS5wdXNoKGZuKTtcbn1cbmZ1bmN0aW9uIGNyZWF0ZUV2ZW50RGlzcGF0Y2hlcigpIHtcbiAgICBjb25zdCBjb21wb25lbnQgPSBnZXRfY3VycmVudF9jb21wb25lbnQoKTtcbiAgICByZXR1cm4gKHR5cGUsIGRldGFpbCkgPT4ge1xuICAgICAgICBjb25zdCBjYWxsYmFja3MgPSBjb21wb25lbnQuJCQuY2FsbGJhY2tzW3R5cGVdO1xuICAgICAgICBpZiAoY2FsbGJhY2tzKSB7XG4gICAgICAgICAgICAvLyBUT0RPIGFyZSB0aGVyZSBzaXR1YXRpb25zIHdoZXJlIGV2ZW50cyBjb3VsZCBiZSBkaXNwYXRjaGVkXG4gICAgICAgICAgICAvLyBpbiBhIHNlcnZlciAobm9uLURPTSkgZW52aXJvbm1lbnQ/XG4gICAgICAgICAgICBjb25zdCBldmVudCA9IGN1c3RvbV9ldmVudCh0eXBlLCBkZXRhaWwpO1xuICAgICAgICAgICAgY2FsbGJhY2tzLnNsaWNlKCkuZm9yRWFjaChmbiA9PiB7XG4gICAgICAgICAgICAgICAgZm4uY2FsbChjb21wb25lbnQsIGV2ZW50KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfTtcbn1cbmZ1bmN0aW9uIHNldENvbnRleHQoa2V5LCBjb250ZXh0KSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuY29udGV4dC5zZXQoa2V5LCBjb250ZXh0KTtcbn1cbmZ1bmN0aW9uIGdldENvbnRleHQoa2V5KSB7XG4gICAgcmV0dXJuIGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLmNvbnRleHQuZ2V0KGtleSk7XG59XG4vLyBUT0RPIGZpZ3VyZSBvdXQgaWYgd2Ugc3RpbGwgd2FudCB0byBzdXBwb3J0XG4vLyBzaG9ydGhhbmQgZXZlbnRzLCBvciBpZiB3ZSB3YW50IHRvIGltcGxlbWVudFxuLy8gYSByZWFsIGJ1YmJsaW5nIG1lY2hhbmlzbVxuZnVuY3Rpb24gYnViYmxlKGNvbXBvbmVudCwgZXZlbnQpIHtcbiAgICBjb25zdCBjYWxsYmFja3MgPSBjb21wb25lbnQuJCQuY2FsbGJhY2tzW2V2ZW50LnR5cGVdO1xuICAgIGlmIChjYWxsYmFja3MpIHtcbiAgICAgICAgY2FsbGJhY2tzLnNsaWNlKCkuZm9yRWFjaChmbiA9PiBmbihldmVudCkpO1xuICAgIH1cbn1cblxuY29uc3QgZGlydHlfY29tcG9uZW50cyA9IFtdO1xuY29uc3QgaW50cm9zID0geyBlbmFibGVkOiBmYWxzZSB9O1xuY29uc3QgYmluZGluZ19jYWxsYmFja3MgPSBbXTtcbmNvbnN0IHJlbmRlcl9jYWxsYmFja3MgPSBbXTtcbmNvbnN0IGZsdXNoX2NhbGxiYWNrcyA9IFtdO1xuY29uc3QgcmVzb2x2ZWRfcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xubGV0IHVwZGF0ZV9zY2hlZHVsZWQgPSBmYWxzZTtcbmZ1bmN0aW9uIHNjaGVkdWxlX3VwZGF0ZSgpIHtcbiAgICBpZiAoIXVwZGF0ZV9zY2hlZHVsZWQpIHtcbiAgICAgICAgdXBkYXRlX3NjaGVkdWxlZCA9IHRydWU7XG4gICAgICAgIHJlc29sdmVkX3Byb21pc2UudGhlbihmbHVzaCk7XG4gICAgfVxufVxuZnVuY3Rpb24gdGljaygpIHtcbiAgICBzY2hlZHVsZV91cGRhdGUoKTtcbiAgICByZXR1cm4gcmVzb2x2ZWRfcHJvbWlzZTtcbn1cbmZ1bmN0aW9uIGFkZF9yZW5kZXJfY2FsbGJhY2soZm4pIHtcbiAgICByZW5kZXJfY2FsbGJhY2tzLnB1c2goZm4pO1xufVxuZnVuY3Rpb24gYWRkX2ZsdXNoX2NhbGxiYWNrKGZuKSB7XG4gICAgZmx1c2hfY2FsbGJhY2tzLnB1c2goZm4pO1xufVxubGV0IGZsdXNoaW5nID0gZmFsc2U7XG5jb25zdCBzZWVuX2NhbGxiYWNrcyA9IG5ldyBTZXQoKTtcbmZ1bmN0aW9uIGZsdXNoKCkge1xuICAgIGlmIChmbHVzaGluZylcbiAgICAgICAgcmV0dXJuO1xuICAgIGZsdXNoaW5nID0gdHJ1ZTtcbiAgICBkbyB7XG4gICAgICAgIC8vIGZpcnN0LCBjYWxsIGJlZm9yZVVwZGF0ZSBmdW5jdGlvbnNcbiAgICAgICAgLy8gYW5kIHVwZGF0ZSBjb21wb25lbnRzXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGlydHlfY29tcG9uZW50cy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICAgICAgY29uc3QgY29tcG9uZW50ID0gZGlydHlfY29tcG9uZW50c1tpXTtcbiAgICAgICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChjb21wb25lbnQpO1xuICAgICAgICAgICAgdXBkYXRlKGNvbXBvbmVudC4kJCk7XG4gICAgICAgIH1cbiAgICAgICAgZGlydHlfY29tcG9uZW50cy5sZW5ndGggPSAwO1xuICAgICAgICB3aGlsZSAoYmluZGluZ19jYWxsYmFja3MubGVuZ3RoKVxuICAgICAgICAgICAgYmluZGluZ19jYWxsYmFja3MucG9wKCkoKTtcbiAgICAgICAgLy8gdGhlbiwgb25jZSBjb21wb25lbnRzIGFyZSB1cGRhdGVkLCBjYWxsXG4gICAgICAgIC8vIGFmdGVyVXBkYXRlIGZ1bmN0aW9ucy4gVGhpcyBtYXkgY2F1c2VcbiAgICAgICAgLy8gc3Vic2VxdWVudCB1cGRhdGVzLi4uXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmVuZGVyX2NhbGxiYWNrcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICAgICAgY29uc3QgY2FsbGJhY2sgPSByZW5kZXJfY2FsbGJhY2tzW2ldO1xuICAgICAgICAgICAgaWYgKCFzZWVuX2NhbGxiYWNrcy5oYXMoY2FsbGJhY2spKSB7XG4gICAgICAgICAgICAgICAgLy8gLi4uc28gZ3VhcmQgYWdhaW5zdCBpbmZpbml0ZSBsb29wc1xuICAgICAgICAgICAgICAgIHNlZW5fY2FsbGJhY2tzLmFkZChjYWxsYmFjayk7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZW5kZXJfY2FsbGJhY2tzLmxlbmd0aCA9IDA7XG4gICAgfSB3aGlsZSAoZGlydHlfY29tcG9uZW50cy5sZW5ndGgpO1xuICAgIHdoaWxlIChmbHVzaF9jYWxsYmFja3MubGVuZ3RoKSB7XG4gICAgICAgIGZsdXNoX2NhbGxiYWNrcy5wb3AoKSgpO1xuICAgIH1cbiAgICB1cGRhdGVfc2NoZWR1bGVkID0gZmFsc2U7XG4gICAgZmx1c2hpbmcgPSBmYWxzZTtcbiAgICBzZWVuX2NhbGxiYWNrcy5jbGVhcigpO1xufVxuZnVuY3Rpb24gdXBkYXRlKCQkKSB7XG4gICAgaWYgKCQkLmZyYWdtZW50ICE9PSBudWxsKSB7XG4gICAgICAgICQkLnVwZGF0ZSgpO1xuICAgICAgICBydW5fYWxsKCQkLmJlZm9yZV91cGRhdGUpO1xuICAgICAgICBjb25zdCBkaXJ0eSA9ICQkLmRpcnR5O1xuICAgICAgICAkJC5kaXJ0eSA9IFstMV07XG4gICAgICAgICQkLmZyYWdtZW50ICYmICQkLmZyYWdtZW50LnAoJCQuY3R4LCBkaXJ0eSk7XG4gICAgICAgICQkLmFmdGVyX3VwZGF0ZS5mb3JFYWNoKGFkZF9yZW5kZXJfY2FsbGJhY2spO1xuICAgIH1cbn1cblxubGV0IHByb21pc2U7XG5mdW5jdGlvbiB3YWl0KCkge1xuICAgIGlmICghcHJvbWlzZSkge1xuICAgICAgICBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIHByb21pc2UudGhlbigoKSA9PiB7XG4gICAgICAgICAgICBwcm9taXNlID0gbnVsbDtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBwcm9taXNlO1xufVxuZnVuY3Rpb24gZGlzcGF0Y2gobm9kZSwgZGlyZWN0aW9uLCBraW5kKSB7XG4gICAgbm9kZS5kaXNwYXRjaEV2ZW50KGN1c3RvbV9ldmVudChgJHtkaXJlY3Rpb24gPyAnaW50cm8nIDogJ291dHJvJ30ke2tpbmR9YCkpO1xufVxuY29uc3Qgb3V0cm9pbmcgPSBuZXcgU2V0KCk7XG5sZXQgb3V0cm9zO1xuZnVuY3Rpb24gZ3JvdXBfb3V0cm9zKCkge1xuICAgIG91dHJvcyA9IHtcbiAgICAgICAgcjogMCxcbiAgICAgICAgYzogW10sXG4gICAgICAgIHA6IG91dHJvcyAvLyBwYXJlbnQgZ3JvdXBcbiAgICB9O1xufVxuZnVuY3Rpb24gY2hlY2tfb3V0cm9zKCkge1xuICAgIGlmICghb3V0cm9zLnIpIHtcbiAgICAgICAgcnVuX2FsbChvdXRyb3MuYyk7XG4gICAgfVxuICAgIG91dHJvcyA9IG91dHJvcy5wO1xufVxuZnVuY3Rpb24gdHJhbnNpdGlvbl9pbihibG9jaywgbG9jYWwpIHtcbiAgICBpZiAoYmxvY2sgJiYgYmxvY2suaSkge1xuICAgICAgICBvdXRyb2luZy5kZWxldGUoYmxvY2spO1xuICAgICAgICBibG9jay5pKGxvY2FsKTtcbiAgICB9XG59XG5mdW5jdGlvbiB0cmFuc2l0aW9uX291dChibG9jaywgbG9jYWwsIGRldGFjaCwgY2FsbGJhY2spIHtcbiAgICBpZiAoYmxvY2sgJiYgYmxvY2subykge1xuICAgICAgICBpZiAob3V0cm9pbmcuaGFzKGJsb2NrKSlcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgb3V0cm9pbmcuYWRkKGJsb2NrKTtcbiAgICAgICAgb3V0cm9zLmMucHVzaCgoKSA9PiB7XG4gICAgICAgICAgICBvdXRyb2luZy5kZWxldGUoYmxvY2spO1xuICAgICAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICAgICAgaWYgKGRldGFjaClcbiAgICAgICAgICAgICAgICAgICAgYmxvY2suZCgxKTtcbiAgICAgICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgYmxvY2subyhsb2NhbCk7XG4gICAgfVxufVxuY29uc3QgbnVsbF90cmFuc2l0aW9uID0geyBkdXJhdGlvbjogMCB9O1xuZnVuY3Rpb24gY3JlYXRlX2luX3RyYW5zaXRpb24obm9kZSwgZm4sIHBhcmFtcykge1xuICAgIGxldCBjb25maWcgPSBmbihub2RlLCBwYXJhbXMpO1xuICAgIGxldCBydW5uaW5nID0gZmFsc2U7XG4gICAgbGV0IGFuaW1hdGlvbl9uYW1lO1xuICAgIGxldCB0YXNrO1xuICAgIGxldCB1aWQgPSAwO1xuICAgIGZ1bmN0aW9uIGNsZWFudXAoKSB7XG4gICAgICAgIGlmIChhbmltYXRpb25fbmFtZSlcbiAgICAgICAgICAgIGRlbGV0ZV9ydWxlKG5vZGUsIGFuaW1hdGlvbl9uYW1lKTtcbiAgICB9XG4gICAgZnVuY3Rpb24gZ28oKSB7XG4gICAgICAgIGNvbnN0IHsgZGVsYXkgPSAwLCBkdXJhdGlvbiA9IDMwMCwgZWFzaW5nID0gaWRlbnRpdHksIHRpY2sgPSBub29wLCBjc3MgfSA9IGNvbmZpZyB8fCBudWxsX3RyYW5zaXRpb247XG4gICAgICAgIGlmIChjc3MpXG4gICAgICAgICAgICBhbmltYXRpb25fbmFtZSA9IGNyZWF0ZV9ydWxlKG5vZGUsIDAsIDEsIGR1cmF0aW9uLCBkZWxheSwgZWFzaW5nLCBjc3MsIHVpZCsrKTtcbiAgICAgICAgdGljaygwLCAxKTtcbiAgICAgICAgY29uc3Qgc3RhcnRfdGltZSA9IG5vdygpICsgZGVsYXk7XG4gICAgICAgIGNvbnN0IGVuZF90aW1lID0gc3RhcnRfdGltZSArIGR1cmF0aW9uO1xuICAgICAgICBpZiAodGFzaylcbiAgICAgICAgICAgIHRhc2suYWJvcnQoKTtcbiAgICAgICAgcnVubmluZyA9IHRydWU7XG4gICAgICAgIGFkZF9yZW5kZXJfY2FsbGJhY2soKCkgPT4gZGlzcGF0Y2gobm9kZSwgdHJ1ZSwgJ3N0YXJ0JykpO1xuICAgICAgICB0YXNrID0gbG9vcChub3cgPT4ge1xuICAgICAgICAgICAgaWYgKHJ1bm5pbmcpIHtcbiAgICAgICAgICAgICAgICBpZiAobm93ID49IGVuZF90aW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHRpY2soMSwgMCk7XG4gICAgICAgICAgICAgICAgICAgIGRpc3BhdGNoKG5vZGUsIHRydWUsICdlbmQnKTtcbiAgICAgICAgICAgICAgICAgICAgY2xlYW51cCgpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gcnVubmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAobm93ID49IHN0YXJ0X3RpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdCA9IGVhc2luZygobm93IC0gc3RhcnRfdGltZSkgLyBkdXJhdGlvbik7XG4gICAgICAgICAgICAgICAgICAgIHRpY2sodCwgMSAtIHQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBydW5uaW5nO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgbGV0IHN0YXJ0ZWQgPSBmYWxzZTtcbiAgICByZXR1cm4ge1xuICAgICAgICBzdGFydCgpIHtcbiAgICAgICAgICAgIGlmIChzdGFydGVkKVxuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIGRlbGV0ZV9ydWxlKG5vZGUpO1xuICAgICAgICAgICAgaWYgKGlzX2Z1bmN0aW9uKGNvbmZpZykpIHtcbiAgICAgICAgICAgICAgICBjb25maWcgPSBjb25maWcoKTtcbiAgICAgICAgICAgICAgICB3YWl0KCkudGhlbihnbyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBnbygpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBpbnZhbGlkYXRlKCkge1xuICAgICAgICAgICAgc3RhcnRlZCA9IGZhbHNlO1xuICAgICAgICB9LFxuICAgICAgICBlbmQoKSB7XG4gICAgICAgICAgICBpZiAocnVubmluZykge1xuICAgICAgICAgICAgICAgIGNsZWFudXAoKTtcbiAgICAgICAgICAgICAgICBydW5uaW5nID0gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9O1xufVxuZnVuY3Rpb24gY3JlYXRlX291dF90cmFuc2l0aW9uKG5vZGUsIGZuLCBwYXJhbXMpIHtcbiAgICBsZXQgY29uZmlnID0gZm4obm9kZSwgcGFyYW1zKTtcbiAgICBsZXQgcnVubmluZyA9IHRydWU7XG4gICAgbGV0IGFuaW1hdGlvbl9uYW1lO1xuICAgIGNvbnN0IGdyb3VwID0gb3V0cm9zO1xuICAgIGdyb3VwLnIgKz0gMTtcbiAgICBmdW5jdGlvbiBnbygpIHtcbiAgICAgICAgY29uc3QgeyBkZWxheSA9IDAsIGR1cmF0aW9uID0gMzAwLCBlYXNpbmcgPSBpZGVudGl0eSwgdGljayA9IG5vb3AsIGNzcyB9ID0gY29uZmlnIHx8IG51bGxfdHJhbnNpdGlvbjtcbiAgICAgICAgaWYgKGNzcylcbiAgICAgICAgICAgIGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgMSwgMCwgZHVyYXRpb24sIGRlbGF5LCBlYXNpbmcsIGNzcyk7XG4gICAgICAgIGNvbnN0IHN0YXJ0X3RpbWUgPSBub3coKSArIGRlbGF5O1xuICAgICAgICBjb25zdCBlbmRfdGltZSA9IHN0YXJ0X3RpbWUgKyBkdXJhdGlvbjtcbiAgICAgICAgYWRkX3JlbmRlcl9jYWxsYmFjaygoKSA9PiBkaXNwYXRjaChub2RlLCBmYWxzZSwgJ3N0YXJ0JykpO1xuICAgICAgICBsb29wKG5vdyA9PiB7XG4gICAgICAgICAgICBpZiAocnVubmluZykge1xuICAgICAgICAgICAgICAgIGlmIChub3cgPj0gZW5kX3RpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGljaygwLCAxKTtcbiAgICAgICAgICAgICAgICAgICAgZGlzcGF0Y2gobm9kZSwgZmFsc2UsICdlbmQnKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCEtLWdyb3VwLnIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoaXMgd2lsbCByZXN1bHQgaW4gYGVuZCgpYCBiZWluZyBjYWxsZWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBzbyB3ZSBkb24ndCBuZWVkIHRvIGNsZWFuIHVwIGhlcmVcbiAgICAgICAgICAgICAgICAgICAgICAgIHJ1bl9hbGwoZ3JvdXAuYyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAobm93ID49IHN0YXJ0X3RpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdCA9IGVhc2luZygobm93IC0gc3RhcnRfdGltZSkgLyBkdXJhdGlvbik7XG4gICAgICAgICAgICAgICAgICAgIHRpY2soMSAtIHQsIHQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBydW5uaW5nO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgaWYgKGlzX2Z1bmN0aW9uKGNvbmZpZykpIHtcbiAgICAgICAgd2FpdCgpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgY29uZmlnID0gY29uZmlnKCk7XG4gICAgICAgICAgICBnbygpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIGdvKCk7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICAgIGVuZChyZXNldCkge1xuICAgICAgICAgICAgaWYgKHJlc2V0ICYmIGNvbmZpZy50aWNrKSB7XG4gICAgICAgICAgICAgICAgY29uZmlnLnRpY2soMSwgMCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocnVubmluZykge1xuICAgICAgICAgICAgICAgIGlmIChhbmltYXRpb25fbmFtZSlcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlX3J1bGUobm9kZSwgYW5pbWF0aW9uX25hbWUpO1xuICAgICAgICAgICAgICAgIHJ1bm5pbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH07XG59XG5mdW5jdGlvbiBjcmVhdGVfYmlkaXJlY3Rpb25hbF90cmFuc2l0aW9uKG5vZGUsIGZuLCBwYXJhbXMsIGludHJvKSB7XG4gICAgbGV0IGNvbmZpZyA9IGZuKG5vZGUsIHBhcmFtcyk7XG4gICAgbGV0IHQgPSBpbnRybyA/IDAgOiAxO1xuICAgIGxldCBydW5uaW5nX3Byb2dyYW0gPSBudWxsO1xuICAgIGxldCBwZW5kaW5nX3Byb2dyYW0gPSBudWxsO1xuICAgIGxldCBhbmltYXRpb25fbmFtZSA9IG51bGw7XG4gICAgZnVuY3Rpb24gY2xlYXJfYW5pbWF0aW9uKCkge1xuICAgICAgICBpZiAoYW5pbWF0aW9uX25hbWUpXG4gICAgICAgICAgICBkZWxldGVfcnVsZShub2RlLCBhbmltYXRpb25fbmFtZSk7XG4gICAgfVxuICAgIGZ1bmN0aW9uIGluaXQocHJvZ3JhbSwgZHVyYXRpb24pIHtcbiAgICAgICAgY29uc3QgZCA9IHByb2dyYW0uYiAtIHQ7XG4gICAgICAgIGR1cmF0aW9uICo9IE1hdGguYWJzKGQpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgYTogdCxcbiAgICAgICAgICAgIGI6IHByb2dyYW0uYixcbiAgICAgICAgICAgIGQsXG4gICAgICAgICAgICBkdXJhdGlvbixcbiAgICAgICAgICAgIHN0YXJ0OiBwcm9ncmFtLnN0YXJ0LFxuICAgICAgICAgICAgZW5kOiBwcm9ncmFtLnN0YXJ0ICsgZHVyYXRpb24sXG4gICAgICAgICAgICBncm91cDogcHJvZ3JhbS5ncm91cFxuICAgICAgICB9O1xuICAgIH1cbiAgICBmdW5jdGlvbiBnbyhiKSB7XG4gICAgICAgIGNvbnN0IHsgZGVsYXkgPSAwLCBkdXJhdGlvbiA9IDMwMCwgZWFzaW5nID0gaWRlbnRpdHksIHRpY2sgPSBub29wLCBjc3MgfSA9IGNvbmZpZyB8fCBudWxsX3RyYW5zaXRpb247XG4gICAgICAgIGNvbnN0IHByb2dyYW0gPSB7XG4gICAgICAgICAgICBzdGFydDogbm93KCkgKyBkZWxheSxcbiAgICAgICAgICAgIGJcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKCFiKSB7XG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlIHRvZG86IGltcHJvdmUgdHlwaW5nc1xuICAgICAgICAgICAgcHJvZ3JhbS5ncm91cCA9IG91dHJvcztcbiAgICAgICAgICAgIG91dHJvcy5yICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJ1bm5pbmdfcHJvZ3JhbSkge1xuICAgICAgICAgICAgcGVuZGluZ19wcm9ncmFtID0gcHJvZ3JhbTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIC8vIGlmIHRoaXMgaXMgYW4gaW50cm8sIGFuZCB0aGVyZSdzIGEgZGVsYXksIHdlIG5lZWQgdG8gZG9cbiAgICAgICAgICAgIC8vIGFuIGluaXRpYWwgdGljayBhbmQvb3IgYXBwbHkgQ1NTIGFuaW1hdGlvbiBpbW1lZGlhdGVseVxuICAgICAgICAgICAgaWYgKGNzcykge1xuICAgICAgICAgICAgICAgIGNsZWFyX2FuaW1hdGlvbigpO1xuICAgICAgICAgICAgICAgIGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgdCwgYiwgZHVyYXRpb24sIGRlbGF5LCBlYXNpbmcsIGNzcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoYilcbiAgICAgICAgICAgICAgICB0aWNrKDAsIDEpO1xuICAgICAgICAgICAgcnVubmluZ19wcm9ncmFtID0gaW5pdChwcm9ncmFtLCBkdXJhdGlvbik7XG4gICAgICAgICAgICBhZGRfcmVuZGVyX2NhbGxiYWNrKCgpID0+IGRpc3BhdGNoKG5vZGUsIGIsICdzdGFydCcpKTtcbiAgICAgICAgICAgIGxvb3Aobm93ID0+IHtcbiAgICAgICAgICAgICAgICBpZiAocGVuZGluZ19wcm9ncmFtICYmIG5vdyA+IHBlbmRpbmdfcHJvZ3JhbS5zdGFydCkge1xuICAgICAgICAgICAgICAgICAgICBydW5uaW5nX3Byb2dyYW0gPSBpbml0KHBlbmRpbmdfcHJvZ3JhbSwgZHVyYXRpb24pO1xuICAgICAgICAgICAgICAgICAgICBwZW5kaW5nX3Byb2dyYW0gPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICBkaXNwYXRjaChub2RlLCBydW5uaW5nX3Byb2dyYW0uYiwgJ3N0YXJ0Jyk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsZWFyX2FuaW1hdGlvbigpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYW5pbWF0aW9uX25hbWUgPSBjcmVhdGVfcnVsZShub2RlLCB0LCBydW5uaW5nX3Byb2dyYW0uYiwgcnVubmluZ19wcm9ncmFtLmR1cmF0aW9uLCAwLCBlYXNpbmcsIGNvbmZpZy5jc3MpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChydW5uaW5nX3Byb2dyYW0pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG5vdyA+PSBydW5uaW5nX3Byb2dyYW0uZW5kKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aWNrKHQgPSBydW5uaW5nX3Byb2dyYW0uYiwgMSAtIHQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGlzcGF0Y2gobm9kZSwgcnVubmluZ19wcm9ncmFtLmIsICdlbmQnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghcGVuZGluZ19wcm9ncmFtKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gd2UncmUgZG9uZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChydW5uaW5nX3Byb2dyYW0uYikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBpbnRybyDigJQgd2UgY2FuIHRpZHkgdXAgaW1tZWRpYXRlbHlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xlYXJfYW5pbWF0aW9uKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBvdXRybyDigJQgbmVlZHMgdG8gYmUgY29vcmRpbmF0ZWRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCEtLXJ1bm5pbmdfcHJvZ3JhbS5ncm91cC5yKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcnVuX2FsbChydW5uaW5nX3Byb2dyYW0uZ3JvdXAuYyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgcnVubmluZ19wcm9ncmFtID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBlbHNlIGlmIChub3cgPj0gcnVubmluZ19wcm9ncmFtLnN0YXJ0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwID0gbm93IC0gcnVubmluZ19wcm9ncmFtLnN0YXJ0O1xuICAgICAgICAgICAgICAgICAgICAgICAgdCA9IHJ1bm5pbmdfcHJvZ3JhbS5hICsgcnVubmluZ19wcm9ncmFtLmQgKiBlYXNpbmcocCAvIHJ1bm5pbmdfcHJvZ3JhbS5kdXJhdGlvbik7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aWNrKHQsIDEgLSB0KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gISEocnVubmluZ19wcm9ncmFtIHx8IHBlbmRpbmdfcHJvZ3JhbSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgICBydW4oYikge1xuICAgICAgICAgICAgaWYgKGlzX2Z1bmN0aW9uKGNvbmZpZykpIHtcbiAgICAgICAgICAgICAgICB3YWl0KCkudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICAgICAgICAgICAgY29uZmlnID0gY29uZmlnKCk7XG4gICAgICAgICAgICAgICAgICAgIGdvKGIpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgZ28oYik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIGVuZCgpIHtcbiAgICAgICAgICAgIGNsZWFyX2FuaW1hdGlvbigpO1xuICAgICAgICAgICAgcnVubmluZ19wcm9ncmFtID0gcGVuZGluZ19wcm9ncmFtID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGhhbmRsZV9wcm9taXNlKHByb21pc2UsIGluZm8pIHtcbiAgICBjb25zdCB0b2tlbiA9IGluZm8udG9rZW4gPSB7fTtcbiAgICBmdW5jdGlvbiB1cGRhdGUodHlwZSwgaW5kZXgsIGtleSwgdmFsdWUpIHtcbiAgICAgICAgaWYgKGluZm8udG9rZW4gIT09IHRva2VuKVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICBpbmZvLnJlc29sdmVkID0gdmFsdWU7XG4gICAgICAgIGxldCBjaGlsZF9jdHggPSBpbmZvLmN0eDtcbiAgICAgICAgaWYgKGtleSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjaGlsZF9jdHggPSBjaGlsZF9jdHguc2xpY2UoKTtcbiAgICAgICAgICAgIGNoaWxkX2N0eFtrZXldID0gdmFsdWU7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYmxvY2sgPSB0eXBlICYmIChpbmZvLmN1cnJlbnQgPSB0eXBlKShjaGlsZF9jdHgpO1xuICAgICAgICBsZXQgbmVlZHNfZmx1c2ggPSBmYWxzZTtcbiAgICAgICAgaWYgKGluZm8uYmxvY2spIHtcbiAgICAgICAgICAgIGlmIChpbmZvLmJsb2Nrcykge1xuICAgICAgICAgICAgICAgIGluZm8uYmxvY2tzLmZvckVhY2goKGJsb2NrLCBpKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChpICE9PSBpbmRleCAmJiBibG9jaykge1xuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBfb3V0cm9zKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cmFuc2l0aW9uX291dChibG9jaywgMSwgMSwgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uYmxvY2tzW2ldID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgY2hlY2tfb3V0cm9zKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIGluZm8uYmxvY2suZCgxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJsb2NrLmMoKTtcbiAgICAgICAgICAgIHRyYW5zaXRpb25faW4oYmxvY2ssIDEpO1xuICAgICAgICAgICAgYmxvY2subShpbmZvLm1vdW50KCksIGluZm8uYW5jaG9yKTtcbiAgICAgICAgICAgIG5lZWRzX2ZsdXNoID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpbmZvLmJsb2NrID0gYmxvY2s7XG4gICAgICAgIGlmIChpbmZvLmJsb2NrcylcbiAgICAgICAgICAgIGluZm8uYmxvY2tzW2luZGV4XSA9IGJsb2NrO1xuICAgICAgICBpZiAobmVlZHNfZmx1c2gpIHtcbiAgICAgICAgICAgIGZsdXNoKCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKGlzX3Byb21pc2UocHJvbWlzZSkpIHtcbiAgICAgICAgY29uc3QgY3VycmVudF9jb21wb25lbnQgPSBnZXRfY3VycmVudF9jb21wb25lbnQoKTtcbiAgICAgICAgcHJvbWlzZS50aGVuKHZhbHVlID0+IHtcbiAgICAgICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChjdXJyZW50X2NvbXBvbmVudCk7XG4gICAgICAgICAgICB1cGRhdGUoaW5mby50aGVuLCAxLCBpbmZvLnZhbHVlLCB2YWx1ZSk7XG4gICAgICAgICAgICBzZXRfY3VycmVudF9jb21wb25lbnQobnVsbCk7XG4gICAgICAgIH0sIGVycm9yID0+IHtcbiAgICAgICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChjdXJyZW50X2NvbXBvbmVudCk7XG4gICAgICAgICAgICB1cGRhdGUoaW5mby5jYXRjaCwgMiwgaW5mby5lcnJvciwgZXJyb3IpO1xuICAgICAgICAgICAgc2V0X2N1cnJlbnRfY29tcG9uZW50KG51bGwpO1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gaWYgd2UgcHJldmlvdXNseSBoYWQgYSB0aGVuL2NhdGNoIGJsb2NrLCBkZXN0cm95IGl0XG4gICAgICAgIGlmIChpbmZvLmN1cnJlbnQgIT09IGluZm8ucGVuZGluZykge1xuICAgICAgICAgICAgdXBkYXRlKGluZm8ucGVuZGluZywgMCk7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgaWYgKGluZm8uY3VycmVudCAhPT0gaW5mby50aGVuKSB7XG4gICAgICAgICAgICB1cGRhdGUoaW5mby50aGVuLCAxLCBpbmZvLnZhbHVlLCBwcm9taXNlKTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGluZm8ucmVzb2x2ZWQgPSBwcm9taXNlO1xuICAgIH1cbn1cblxuY29uc3QgZ2xvYmFscyA9ICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJ1xuICAgID8gd2luZG93XG4gICAgOiB0eXBlb2YgZ2xvYmFsVGhpcyAhPT0gJ3VuZGVmaW5lZCdcbiAgICAgICAgPyBnbG9iYWxUaGlzXG4gICAgICAgIDogZ2xvYmFsKTtcblxuZnVuY3Rpb24gZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKSB7XG4gICAgYmxvY2suZCgxKTtcbiAgICBsb29rdXAuZGVsZXRlKGJsb2NrLmtleSk7XG59XG5mdW5jdGlvbiBvdXRyb19hbmRfZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKSB7XG4gICAgdHJhbnNpdGlvbl9vdXQoYmxvY2ssIDEsIDEsICgpID0+IHtcbiAgICAgICAgbG9va3VwLmRlbGV0ZShibG9jay5rZXkpO1xuICAgIH0pO1xufVxuZnVuY3Rpb24gZml4X2FuZF9kZXN0cm95X2Jsb2NrKGJsb2NrLCBsb29rdXApIHtcbiAgICBibG9jay5mKCk7XG4gICAgZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKTtcbn1cbmZ1bmN0aW9uIGZpeF9hbmRfb3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCkge1xuICAgIGJsb2NrLmYoKTtcbiAgICBvdXRyb19hbmRfZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKTtcbn1cbmZ1bmN0aW9uIHVwZGF0ZV9rZXllZF9lYWNoKG9sZF9ibG9ja3MsIGRpcnR5LCBnZXRfa2V5LCBkeW5hbWljLCBjdHgsIGxpc3QsIGxvb2t1cCwgbm9kZSwgZGVzdHJveSwgY3JlYXRlX2VhY2hfYmxvY2ssIG5leHQsIGdldF9jb250ZXh0KSB7XG4gICAgbGV0IG8gPSBvbGRfYmxvY2tzLmxlbmd0aDtcbiAgICBsZXQgbiA9IGxpc3QubGVuZ3RoO1xuICAgIGxldCBpID0gbztcbiAgICBjb25zdCBvbGRfaW5kZXhlcyA9IHt9O1xuICAgIHdoaWxlIChpLS0pXG4gICAgICAgIG9sZF9pbmRleGVzW29sZF9ibG9ja3NbaV0ua2V5XSA9IGk7XG4gICAgY29uc3QgbmV3X2Jsb2NrcyA9IFtdO1xuICAgIGNvbnN0IG5ld19sb29rdXAgPSBuZXcgTWFwKCk7XG4gICAgY29uc3QgZGVsdGFzID0gbmV3IE1hcCgpO1xuICAgIGkgPSBuO1xuICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgY29uc3QgY2hpbGRfY3R4ID0gZ2V0X2NvbnRleHQoY3R4LCBsaXN0LCBpKTtcbiAgICAgICAgY29uc3Qga2V5ID0gZ2V0X2tleShjaGlsZF9jdHgpO1xuICAgICAgICBsZXQgYmxvY2sgPSBsb29rdXAuZ2V0KGtleSk7XG4gICAgICAgIGlmICghYmxvY2spIHtcbiAgICAgICAgICAgIGJsb2NrID0gY3JlYXRlX2VhY2hfYmxvY2soa2V5LCBjaGlsZF9jdHgpO1xuICAgICAgICAgICAgYmxvY2suYygpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGR5bmFtaWMpIHtcbiAgICAgICAgICAgIGJsb2NrLnAoY2hpbGRfY3R4LCBkaXJ0eSk7XG4gICAgICAgIH1cbiAgICAgICAgbmV3X2xvb2t1cC5zZXQoa2V5LCBuZXdfYmxvY2tzW2ldID0gYmxvY2spO1xuICAgICAgICBpZiAoa2V5IGluIG9sZF9pbmRleGVzKVxuICAgICAgICAgICAgZGVsdGFzLnNldChrZXksIE1hdGguYWJzKGkgLSBvbGRfaW5kZXhlc1trZXldKSk7XG4gICAgfVxuICAgIGNvbnN0IHdpbGxfbW92ZSA9IG5ldyBTZXQoKTtcbiAgICBjb25zdCBkaWRfbW92ZSA9IG5ldyBTZXQoKTtcbiAgICBmdW5jdGlvbiBpbnNlcnQoYmxvY2spIHtcbiAgICAgICAgdHJhbnNpdGlvbl9pbihibG9jaywgMSk7XG4gICAgICAgIGJsb2NrLm0obm9kZSwgbmV4dCk7XG4gICAgICAgIGxvb2t1cC5zZXQoYmxvY2sua2V5LCBibG9jayk7XG4gICAgICAgIG5leHQgPSBibG9jay5maXJzdDtcbiAgICAgICAgbi0tO1xuICAgIH1cbiAgICB3aGlsZSAobyAmJiBuKSB7XG4gICAgICAgIGNvbnN0IG5ld19ibG9jayA9IG5ld19ibG9ja3NbbiAtIDFdO1xuICAgICAgICBjb25zdCBvbGRfYmxvY2sgPSBvbGRfYmxvY2tzW28gLSAxXTtcbiAgICAgICAgY29uc3QgbmV3X2tleSA9IG5ld19ibG9jay5rZXk7XG4gICAgICAgIGNvbnN0IG9sZF9rZXkgPSBvbGRfYmxvY2sua2V5O1xuICAgICAgICBpZiAobmV3X2Jsb2NrID09PSBvbGRfYmxvY2spIHtcbiAgICAgICAgICAgIC8vIGRvIG5vdGhpbmdcbiAgICAgICAgICAgIG5leHQgPSBuZXdfYmxvY2suZmlyc3Q7XG4gICAgICAgICAgICBvLS07XG4gICAgICAgICAgICBuLS07XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoIW5ld19sb29rdXAuaGFzKG9sZF9rZXkpKSB7XG4gICAgICAgICAgICAvLyByZW1vdmUgb2xkIGJsb2NrXG4gICAgICAgICAgICBkZXN0cm95KG9sZF9ibG9jaywgbG9va3VwKTtcbiAgICAgICAgICAgIG8tLTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmICghbG9va3VwLmhhcyhuZXdfa2V5KSB8fCB3aWxsX21vdmUuaGFzKG5ld19rZXkpKSB7XG4gICAgICAgICAgICBpbnNlcnQobmV3X2Jsb2NrKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChkaWRfbW92ZS5oYXMob2xkX2tleSkpIHtcbiAgICAgICAgICAgIG8tLTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChkZWx0YXMuZ2V0KG5ld19rZXkpID4gZGVsdGFzLmdldChvbGRfa2V5KSkge1xuICAgICAgICAgICAgZGlkX21vdmUuYWRkKG5ld19rZXkpO1xuICAgICAgICAgICAgaW5zZXJ0KG5ld19ibG9jayk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB3aWxsX21vdmUuYWRkKG9sZF9rZXkpO1xuICAgICAgICAgICAgby0tO1xuICAgICAgICB9XG4gICAgfVxuICAgIHdoaWxlIChvLS0pIHtcbiAgICAgICAgY29uc3Qgb2xkX2Jsb2NrID0gb2xkX2Jsb2Nrc1tvXTtcbiAgICAgICAgaWYgKCFuZXdfbG9va3VwLmhhcyhvbGRfYmxvY2sua2V5KSlcbiAgICAgICAgICAgIGRlc3Ryb3kob2xkX2Jsb2NrLCBsb29rdXApO1xuICAgIH1cbiAgICB3aGlsZSAobilcbiAgICAgICAgaW5zZXJ0KG5ld19ibG9ja3NbbiAtIDFdKTtcbiAgICByZXR1cm4gbmV3X2Jsb2Nrcztcbn1cbmZ1bmN0aW9uIHZhbGlkYXRlX2VhY2hfa2V5cyhjdHgsIGxpc3QsIGdldF9jb250ZXh0LCBnZXRfa2V5KSB7XG4gICAgY29uc3Qga2V5cyA9IG5ldyBTZXQoKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3Qga2V5ID0gZ2V0X2tleShnZXRfY29udGV4dChjdHgsIGxpc3QsIGkpKTtcbiAgICAgICAgaWYgKGtleXMuaGFzKGtleSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGhhdmUgZHVwbGljYXRlIGtleXMgaW4gYSBrZXllZCBlYWNoYCk7XG4gICAgICAgIH1cbiAgICAgICAga2V5cy5hZGQoa2V5KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGdldF9zcHJlYWRfdXBkYXRlKGxldmVscywgdXBkYXRlcykge1xuICAgIGNvbnN0IHVwZGF0ZSA9IHt9O1xuICAgIGNvbnN0IHRvX251bGxfb3V0ID0ge307XG4gICAgY29uc3QgYWNjb3VudGVkX2ZvciA9IHsgJCRzY29wZTogMSB9O1xuICAgIGxldCBpID0gbGV2ZWxzLmxlbmd0aDtcbiAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgIGNvbnN0IG8gPSBsZXZlbHNbaV07XG4gICAgICAgIGNvbnN0IG4gPSB1cGRhdGVzW2ldO1xuICAgICAgICBpZiAobikge1xuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gbykge1xuICAgICAgICAgICAgICAgIGlmICghKGtleSBpbiBuKSlcbiAgICAgICAgICAgICAgICAgICAgdG9fbnVsbF9vdXRba2V5XSA9IDE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBuKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFhY2NvdW50ZWRfZm9yW2tleV0pIHtcbiAgICAgICAgICAgICAgICAgICAgdXBkYXRlW2tleV0gPSBuW2tleV07XG4gICAgICAgICAgICAgICAgICAgIGFjY291bnRlZF9mb3Jba2V5XSA9IDE7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbGV2ZWxzW2ldID0gbjtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIG8pIHtcbiAgICAgICAgICAgICAgICBhY2NvdW50ZWRfZm9yW2tleV0gPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIGZvciAoY29uc3Qga2V5IGluIHRvX251bGxfb3V0KSB7XG4gICAgICAgIGlmICghKGtleSBpbiB1cGRhdGUpKVxuICAgICAgICAgICAgdXBkYXRlW2tleV0gPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIHJldHVybiB1cGRhdGU7XG59XG5mdW5jdGlvbiBnZXRfc3ByZWFkX29iamVjdChzcHJlYWRfcHJvcHMpIHtcbiAgICByZXR1cm4gdHlwZW9mIHNwcmVhZF9wcm9wcyA9PT0gJ29iamVjdCcgJiYgc3ByZWFkX3Byb3BzICE9PSBudWxsID8gc3ByZWFkX3Byb3BzIDoge307XG59XG5cbi8vIHNvdXJjZTogaHR0cHM6Ly9odG1sLnNwZWMud2hhdHdnLm9yZy9tdWx0aXBhZ2UvaW5kaWNlcy5odG1sXG5jb25zdCBib29sZWFuX2F0dHJpYnV0ZXMgPSBuZXcgU2V0KFtcbiAgICAnYWxsb3dmdWxsc2NyZWVuJyxcbiAgICAnYWxsb3dwYXltZW50cmVxdWVzdCcsXG4gICAgJ2FzeW5jJyxcbiAgICAnYXV0b2ZvY3VzJyxcbiAgICAnYXV0b3BsYXknLFxuICAgICdjaGVja2VkJyxcbiAgICAnY29udHJvbHMnLFxuICAgICdkZWZhdWx0JyxcbiAgICAnZGVmZXInLFxuICAgICdkaXNhYmxlZCcsXG4gICAgJ2Zvcm1ub3ZhbGlkYXRlJyxcbiAgICAnaGlkZGVuJyxcbiAgICAnaXNtYXAnLFxuICAgICdsb29wJyxcbiAgICAnbXVsdGlwbGUnLFxuICAgICdtdXRlZCcsXG4gICAgJ25vbW9kdWxlJyxcbiAgICAnbm92YWxpZGF0ZScsXG4gICAgJ29wZW4nLFxuICAgICdwbGF5c2lubGluZScsXG4gICAgJ3JlYWRvbmx5JyxcbiAgICAncmVxdWlyZWQnLFxuICAgICdyZXZlcnNlZCcsXG4gICAgJ3NlbGVjdGVkJ1xuXSk7XG5cbmNvbnN0IGludmFsaWRfYXR0cmlidXRlX25hbWVfY2hhcmFjdGVyID0gL1tcXHMnXCI+Lz1cXHV7RkREMH0tXFx1e0ZERUZ9XFx1e0ZGRkV9XFx1e0ZGRkZ9XFx1ezFGRkZFfVxcdXsxRkZGRn1cXHV7MkZGRkV9XFx1ezJGRkZGfVxcdXszRkZGRX1cXHV7M0ZGRkZ9XFx1ezRGRkZFfVxcdXs0RkZGRn1cXHV7NUZGRkV9XFx1ezVGRkZGfVxcdXs2RkZGRX1cXHV7NkZGRkZ9XFx1ezdGRkZFfVxcdXs3RkZGRn1cXHV7OEZGRkV9XFx1ezhGRkZGfVxcdXs5RkZGRX1cXHV7OUZGRkZ9XFx1e0FGRkZFfVxcdXtBRkZGRn1cXHV7QkZGRkV9XFx1e0JGRkZGfVxcdXtDRkZGRX1cXHV7Q0ZGRkZ9XFx1e0RGRkZFfVxcdXtERkZGRn1cXHV7RUZGRkV9XFx1e0VGRkZGfVxcdXtGRkZGRX1cXHV7RkZGRkZ9XFx1ezEwRkZGRX1cXHV7MTBGRkZGfV0vdTtcbi8vIGh0dHBzOi8vaHRtbC5zcGVjLndoYXR3Zy5vcmcvbXVsdGlwYWdlL3N5bnRheC5odG1sI2F0dHJpYnV0ZXMtMlxuLy8gaHR0cHM6Ly9pbmZyYS5zcGVjLndoYXR3Zy5vcmcvI25vbmNoYXJhY3RlclxuZnVuY3Rpb24gc3ByZWFkKGFyZ3MsIGNsYXNzZXNfdG9fYWRkKSB7XG4gICAgY29uc3QgYXR0cmlidXRlcyA9IE9iamVjdC5hc3NpZ24oe30sIC4uLmFyZ3MpO1xuICAgIGlmIChjbGFzc2VzX3RvX2FkZCkge1xuICAgICAgICBpZiAoYXR0cmlidXRlcy5jbGFzcyA9PSBudWxsKSB7XG4gICAgICAgICAgICBhdHRyaWJ1dGVzLmNsYXNzID0gY2xhc3Nlc190b19hZGQ7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBhdHRyaWJ1dGVzLmNsYXNzICs9ICcgJyArIGNsYXNzZXNfdG9fYWRkO1xuICAgICAgICB9XG4gICAgfVxuICAgIGxldCBzdHIgPSAnJztcbiAgICBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKS5mb3JFYWNoKG5hbWUgPT4ge1xuICAgICAgICBpZiAoaW52YWxpZF9hdHRyaWJ1dGVfbmFtZV9jaGFyYWN0ZXIudGVzdChuYW1lKSlcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgY29uc3QgdmFsdWUgPSBhdHRyaWJ1dGVzW25hbWVdO1xuICAgICAgICBpZiAodmFsdWUgPT09IHRydWUpXG4gICAgICAgICAgICBzdHIgKz0gXCIgXCIgKyBuYW1lO1xuICAgICAgICBlbHNlIGlmIChib29sZWFuX2F0dHJpYnV0ZXMuaGFzKG5hbWUudG9Mb3dlckNhc2UoKSkpIHtcbiAgICAgICAgICAgIGlmICh2YWx1ZSlcbiAgICAgICAgICAgICAgICBzdHIgKz0gXCIgXCIgKyBuYW1lO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHZhbHVlICE9IG51bGwpIHtcbiAgICAgICAgICAgIHN0ciArPSBgICR7bmFtZX09XCIke1N0cmluZyh2YWx1ZSkucmVwbGFjZSgvXCIvZywgJyYjMzQ7JykucmVwbGFjZSgvJy9nLCAnJiMzOTsnKX1cImA7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gc3RyO1xufVxuY29uc3QgZXNjYXBlZCA9IHtcbiAgICAnXCInOiAnJnF1b3Q7JyxcbiAgICBcIidcIjogJyYjMzk7JyxcbiAgICAnJic6ICcmYW1wOycsXG4gICAgJzwnOiAnJmx0OycsXG4gICAgJz4nOiAnJmd0Oydcbn07XG5mdW5jdGlvbiBlc2NhcGUoaHRtbCkge1xuICAgIHJldHVybiBTdHJpbmcoaHRtbCkucmVwbGFjZSgvW1wiJyY8Pl0vZywgbWF0Y2ggPT4gZXNjYXBlZFttYXRjaF0pO1xufVxuZnVuY3Rpb24gZWFjaChpdGVtcywgZm4pIHtcbiAgICBsZXQgc3RyID0gJyc7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBpdGVtcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBzdHIgKz0gZm4oaXRlbXNbaV0sIGkpO1xuICAgIH1cbiAgICByZXR1cm4gc3RyO1xufVxuY29uc3QgbWlzc2luZ19jb21wb25lbnQgPSB7XG4gICAgJCRyZW5kZXI6ICgpID0+ICcnXG59O1xuZnVuY3Rpb24gdmFsaWRhdGVfY29tcG9uZW50KGNvbXBvbmVudCwgbmFtZSkge1xuICAgIGlmICghY29tcG9uZW50IHx8ICFjb21wb25lbnQuJCRyZW5kZXIpIHtcbiAgICAgICAgaWYgKG5hbWUgPT09ICdzdmVsdGU6Y29tcG9uZW50JylcbiAgICAgICAgICAgIG5hbWUgKz0gJyB0aGlzPXsuLi59JztcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGA8JHtuYW1lfT4gaXMgbm90IGEgdmFsaWQgU1NSIGNvbXBvbmVudC4gWW91IG1heSBuZWVkIHRvIHJldmlldyB5b3VyIGJ1aWxkIGNvbmZpZyB0byBlbnN1cmUgdGhhdCBkZXBlbmRlbmNpZXMgYXJlIGNvbXBpbGVkLCByYXRoZXIgdGhhbiBpbXBvcnRlZCBhcyBwcmUtY29tcGlsZWQgbW9kdWxlc2ApO1xuICAgIH1cbiAgICByZXR1cm4gY29tcG9uZW50O1xufVxuZnVuY3Rpb24gZGVidWcoZmlsZSwgbGluZSwgY29sdW1uLCB2YWx1ZXMpIHtcbiAgICBjb25zb2xlLmxvZyhge0BkZWJ1Z30gJHtmaWxlID8gZmlsZSArICcgJyA6ICcnfSgke2xpbmV9OiR7Y29sdW1ufSlgKTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1jb25zb2xlXG4gICAgY29uc29sZS5sb2codmFsdWVzKTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1jb25zb2xlXG4gICAgcmV0dXJuICcnO1xufVxubGV0IG9uX2Rlc3Ryb3k7XG5mdW5jdGlvbiBjcmVhdGVfc3NyX2NvbXBvbmVudChmbikge1xuICAgIGZ1bmN0aW9uICQkcmVuZGVyKHJlc3VsdCwgcHJvcHMsIGJpbmRpbmdzLCBzbG90cykge1xuICAgICAgICBjb25zdCBwYXJlbnRfY29tcG9uZW50ID0gY3VycmVudF9jb21wb25lbnQ7XG4gICAgICAgIGNvbnN0ICQkID0ge1xuICAgICAgICAgICAgb25fZGVzdHJveSxcbiAgICAgICAgICAgIGNvbnRleHQ6IG5ldyBNYXAocGFyZW50X2NvbXBvbmVudCA/IHBhcmVudF9jb21wb25lbnQuJCQuY29udGV4dCA6IFtdKSxcbiAgICAgICAgICAgIC8vIHRoZXNlIHdpbGwgYmUgaW1tZWRpYXRlbHkgZGlzY2FyZGVkXG4gICAgICAgICAgICBvbl9tb3VudDogW10sXG4gICAgICAgICAgICBiZWZvcmVfdXBkYXRlOiBbXSxcbiAgICAgICAgICAgIGFmdGVyX3VwZGF0ZTogW10sXG4gICAgICAgICAgICBjYWxsYmFja3M6IGJsYW5rX29iamVjdCgpXG4gICAgICAgIH07XG4gICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudCh7ICQkIH0pO1xuICAgICAgICBjb25zdCBodG1sID0gZm4ocmVzdWx0LCBwcm9wcywgYmluZGluZ3MsIHNsb3RzKTtcbiAgICAgICAgc2V0X2N1cnJlbnRfY29tcG9uZW50KHBhcmVudF9jb21wb25lbnQpO1xuICAgICAgICByZXR1cm4gaHRtbDtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgICAgcmVuZGVyOiAocHJvcHMgPSB7fSwgb3B0aW9ucyA9IHt9KSA9PiB7XG4gICAgICAgICAgICBvbl9kZXN0cm95ID0gW107XG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSB7IHRpdGxlOiAnJywgaGVhZDogJycsIGNzczogbmV3IFNldCgpIH07XG4gICAgICAgICAgICBjb25zdCBodG1sID0gJCRyZW5kZXIocmVzdWx0LCBwcm9wcywge30sIG9wdGlvbnMpO1xuICAgICAgICAgICAgcnVuX2FsbChvbl9kZXN0cm95KTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgaHRtbCxcbiAgICAgICAgICAgICAgICBjc3M6IHtcbiAgICAgICAgICAgICAgICAgICAgY29kZTogQXJyYXkuZnJvbShyZXN1bHQuY3NzKS5tYXAoY3NzID0+IGNzcy5jb2RlKS5qb2luKCdcXG4nKSxcbiAgICAgICAgICAgICAgICAgICAgbWFwOiBudWxsIC8vIFRPRE9cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGhlYWQ6IHJlc3VsdC50aXRsZSArIHJlc3VsdC5oZWFkXG4gICAgICAgICAgICB9O1xuICAgICAgICB9LFxuICAgICAgICAkJHJlbmRlclxuICAgIH07XG59XG5mdW5jdGlvbiBhZGRfYXR0cmlidXRlKG5hbWUsIHZhbHVlLCBib29sZWFuKSB7XG4gICAgaWYgKHZhbHVlID09IG51bGwgfHwgKGJvb2xlYW4gJiYgIXZhbHVlKSlcbiAgICAgICAgcmV0dXJuICcnO1xuICAgIHJldHVybiBgICR7bmFtZX0ke3ZhbHVlID09PSB0cnVlID8gJycgOiBgPSR7dHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyA/IEpTT04uc3RyaW5naWZ5KGVzY2FwZSh2YWx1ZSkpIDogYFwiJHt2YWx1ZX1cImB9YH1gO1xufVxuZnVuY3Rpb24gYWRkX2NsYXNzZXMoY2xhc3Nlcykge1xuICAgIHJldHVybiBjbGFzc2VzID8gYCBjbGFzcz1cIiR7Y2xhc3Nlc31cImAgOiBgYDtcbn1cblxuZnVuY3Rpb24gYmluZChjb21wb25lbnQsIG5hbWUsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgaW5kZXggPSBjb21wb25lbnQuJCQucHJvcHNbbmFtZV07XG4gICAgaWYgKGluZGV4ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY29tcG9uZW50LiQkLmJvdW5kW2luZGV4XSA9IGNhbGxiYWNrO1xuICAgICAgICBjYWxsYmFjayhjb21wb25lbnQuJCQuY3R4W2luZGV4XSk7XG4gICAgfVxufVxuZnVuY3Rpb24gY3JlYXRlX2NvbXBvbmVudChibG9jaykge1xuICAgIGJsb2NrICYmIGJsb2NrLmMoKTtcbn1cbmZ1bmN0aW9uIGNsYWltX2NvbXBvbmVudChibG9jaywgcGFyZW50X25vZGVzKSB7XG4gICAgYmxvY2sgJiYgYmxvY2subChwYXJlbnRfbm9kZXMpO1xufVxuZnVuY3Rpb24gbW91bnRfY29tcG9uZW50KGNvbXBvbmVudCwgdGFyZ2V0LCBhbmNob3IpIHtcbiAgICBjb25zdCB7IGZyYWdtZW50LCBvbl9tb3VudCwgb25fZGVzdHJveSwgYWZ0ZXJfdXBkYXRlIH0gPSBjb21wb25lbnQuJCQ7XG4gICAgZnJhZ21lbnQgJiYgZnJhZ21lbnQubSh0YXJnZXQsIGFuY2hvcik7XG4gICAgLy8gb25Nb3VudCBoYXBwZW5zIGJlZm9yZSB0aGUgaW5pdGlhbCBhZnRlclVwZGF0ZVxuICAgIGFkZF9yZW5kZXJfY2FsbGJhY2soKCkgPT4ge1xuICAgICAgICBjb25zdCBuZXdfb25fZGVzdHJveSA9IG9uX21vdW50Lm1hcChydW4pLmZpbHRlcihpc19mdW5jdGlvbik7XG4gICAgICAgIGlmIChvbl9kZXN0cm95KSB7XG4gICAgICAgICAgICBvbl9kZXN0cm95LnB1c2goLi4ubmV3X29uX2Rlc3Ryb3kpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy8gRWRnZSBjYXNlIC0gY29tcG9uZW50IHdhcyBkZXN0cm95ZWQgaW1tZWRpYXRlbHksXG4gICAgICAgICAgICAvLyBtb3N0IGxpa2VseSBhcyBhIHJlc3VsdCBvZiBhIGJpbmRpbmcgaW5pdGlhbGlzaW5nXG4gICAgICAgICAgICBydW5fYWxsKG5ld19vbl9kZXN0cm95KTtcbiAgICAgICAgfVxuICAgICAgICBjb21wb25lbnQuJCQub25fbW91bnQgPSBbXTtcbiAgICB9KTtcbiAgICBhZnRlcl91cGRhdGUuZm9yRWFjaChhZGRfcmVuZGVyX2NhbGxiYWNrKTtcbn1cbmZ1bmN0aW9uIGRlc3Ryb3lfY29tcG9uZW50KGNvbXBvbmVudCwgZGV0YWNoaW5nKSB7XG4gICAgY29uc3QgJCQgPSBjb21wb25lbnQuJCQ7XG4gICAgaWYgKCQkLmZyYWdtZW50ICE9PSBudWxsKSB7XG4gICAgICAgIHJ1bl9hbGwoJCQub25fZGVzdHJveSk7XG4gICAgICAgICQkLmZyYWdtZW50ICYmICQkLmZyYWdtZW50LmQoZGV0YWNoaW5nKTtcbiAgICAgICAgLy8gVE9ETyBudWxsIG91dCBvdGhlciByZWZzLCBpbmNsdWRpbmcgY29tcG9uZW50LiQkIChidXQgbmVlZCB0b1xuICAgICAgICAvLyBwcmVzZXJ2ZSBmaW5hbCBzdGF0ZT8pXG4gICAgICAgICQkLm9uX2Rlc3Ryb3kgPSAkJC5mcmFnbWVudCA9IG51bGw7XG4gICAgICAgICQkLmN0eCA9IFtdO1xuICAgIH1cbn1cbmZ1bmN0aW9uIG1ha2VfZGlydHkoY29tcG9uZW50LCBpKSB7XG4gICAgaWYgKGNvbXBvbmVudC4kJC5kaXJ0eVswXSA9PT0gLTEpIHtcbiAgICAgICAgZGlydHlfY29tcG9uZW50cy5wdXNoKGNvbXBvbmVudCk7XG4gICAgICAgIHNjaGVkdWxlX3VwZGF0ZSgpO1xuICAgICAgICBjb21wb25lbnQuJCQuZGlydHkuZmlsbCgwKTtcbiAgICB9XG4gICAgY29tcG9uZW50LiQkLmRpcnR5WyhpIC8gMzEpIHwgMF0gfD0gKDEgPDwgKGkgJSAzMSkpO1xufVxuZnVuY3Rpb24gaW5pdChjb21wb25lbnQsIG9wdGlvbnMsIGluc3RhbmNlLCBjcmVhdGVfZnJhZ21lbnQsIG5vdF9lcXVhbCwgcHJvcHMsIGRpcnR5ID0gWy0xXSkge1xuICAgIGNvbnN0IHBhcmVudF9jb21wb25lbnQgPSBjdXJyZW50X2NvbXBvbmVudDtcbiAgICBzZXRfY3VycmVudF9jb21wb25lbnQoY29tcG9uZW50KTtcbiAgICBjb25zdCBwcm9wX3ZhbHVlcyA9IG9wdGlvbnMucHJvcHMgfHwge307XG4gICAgY29uc3QgJCQgPSBjb21wb25lbnQuJCQgPSB7XG4gICAgICAgIGZyYWdtZW50OiBudWxsLFxuICAgICAgICBjdHg6IG51bGwsXG4gICAgICAgIC8vIHN0YXRlXG4gICAgICAgIHByb3BzLFxuICAgICAgICB1cGRhdGU6IG5vb3AsXG4gICAgICAgIG5vdF9lcXVhbCxcbiAgICAgICAgYm91bmQ6IGJsYW5rX29iamVjdCgpLFxuICAgICAgICAvLyBsaWZlY3ljbGVcbiAgICAgICAgb25fbW91bnQ6IFtdLFxuICAgICAgICBvbl9kZXN0cm95OiBbXSxcbiAgICAgICAgYmVmb3JlX3VwZGF0ZTogW10sXG4gICAgICAgIGFmdGVyX3VwZGF0ZTogW10sXG4gICAgICAgIGNvbnRleHQ6IG5ldyBNYXAocGFyZW50X2NvbXBvbmVudCA/IHBhcmVudF9jb21wb25lbnQuJCQuY29udGV4dCA6IFtdKSxcbiAgICAgICAgLy8gZXZlcnl0aGluZyBlbHNlXG4gICAgICAgIGNhbGxiYWNrczogYmxhbmtfb2JqZWN0KCksXG4gICAgICAgIGRpcnR5XG4gICAgfTtcbiAgICBsZXQgcmVhZHkgPSBmYWxzZTtcbiAgICAkJC5jdHggPSBpbnN0YW5jZVxuICAgICAgICA/IGluc3RhbmNlKGNvbXBvbmVudCwgcHJvcF92YWx1ZXMsIChpLCByZXQsIC4uLnJlc3QpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gcmVzdC5sZW5ndGggPyByZXN0WzBdIDogcmV0O1xuICAgICAgICAgICAgaWYgKCQkLmN0eCAmJiBub3RfZXF1YWwoJCQuY3R4W2ldLCAkJC5jdHhbaV0gPSB2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICBpZiAoJCQuYm91bmRbaV0pXG4gICAgICAgICAgICAgICAgICAgICQkLmJvdW5kW2ldKHZhbHVlKTtcbiAgICAgICAgICAgICAgICBpZiAocmVhZHkpXG4gICAgICAgICAgICAgICAgICAgIG1ha2VfZGlydHkoY29tcG9uZW50LCBpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiByZXQ7XG4gICAgICAgIH0pXG4gICAgICAgIDogW107XG4gICAgJCQudXBkYXRlKCk7XG4gICAgcmVhZHkgPSB0cnVlO1xuICAgIHJ1bl9hbGwoJCQuYmVmb3JlX3VwZGF0ZSk7XG4gICAgLy8gYGZhbHNlYCBhcyBhIHNwZWNpYWwgY2FzZSBvZiBubyBET00gY29tcG9uZW50XG4gICAgJCQuZnJhZ21lbnQgPSBjcmVhdGVfZnJhZ21lbnQgPyBjcmVhdGVfZnJhZ21lbnQoJCQuY3R4KSA6IGZhbHNlO1xuICAgIGlmIChvcHRpb25zLnRhcmdldCkge1xuICAgICAgICBpZiAob3B0aW9ucy5oeWRyYXRlKSB7XG4gICAgICAgICAgICBjb25zdCBub2RlcyA9IGNoaWxkcmVuKG9wdGlvbnMudGFyZ2V0KTtcbiAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbm9uLW51bGwtYXNzZXJ0aW9uXG4gICAgICAgICAgICAkJC5mcmFnbWVudCAmJiAkJC5mcmFnbWVudC5sKG5vZGVzKTtcbiAgICAgICAgICAgIG5vZGVzLmZvckVhY2goZGV0YWNoKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbm9uLW51bGwtYXNzZXJ0aW9uXG4gICAgICAgICAgICAkJC5mcmFnbWVudCAmJiAkJC5mcmFnbWVudC5jKCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG9wdGlvbnMuaW50cm8pXG4gICAgICAgICAgICB0cmFuc2l0aW9uX2luKGNvbXBvbmVudC4kJC5mcmFnbWVudCk7XG4gICAgICAgIG1vdW50X2NvbXBvbmVudChjb21wb25lbnQsIG9wdGlvbnMudGFyZ2V0LCBvcHRpb25zLmFuY2hvcik7XG4gICAgICAgIGZsdXNoKCk7XG4gICAgfVxuICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChwYXJlbnRfY29tcG9uZW50KTtcbn1cbmxldCBTdmVsdGVFbGVtZW50O1xuaWYgKHR5cGVvZiBIVE1MRWxlbWVudCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIFN2ZWx0ZUVsZW1lbnQgPSBjbGFzcyBleHRlbmRzIEhUTUxFbGVtZW50IHtcbiAgICAgICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgICAgICBzdXBlcigpO1xuICAgICAgICAgICAgdGhpcy5hdHRhY2hTaGFkb3coeyBtb2RlOiAnb3BlbicgfSk7XG4gICAgICAgIH1cbiAgICAgICAgY29ubmVjdGVkQ2FsbGJhY2soKSB7XG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlIHRvZG86IGltcHJvdmUgdHlwaW5nc1xuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gdGhpcy4kJC5zbG90dGVkKSB7XG4gICAgICAgICAgICAgICAgLy8gQHRzLWlnbm9yZSB0b2RvOiBpbXByb3ZlIHR5cGluZ3NcbiAgICAgICAgICAgICAgICB0aGlzLmFwcGVuZENoaWxkKHRoaXMuJCQuc2xvdHRlZFtrZXldKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBhdHRyaWJ1dGVDaGFuZ2VkQ2FsbGJhY2soYXR0ciwgX29sZFZhbHVlLCBuZXdWYWx1ZSkge1xuICAgICAgICAgICAgdGhpc1thdHRyXSA9IG5ld1ZhbHVlO1xuICAgICAgICB9XG4gICAgICAgICRkZXN0cm95KCkge1xuICAgICAgICAgICAgZGVzdHJveV9jb21wb25lbnQodGhpcywgMSk7XG4gICAgICAgICAgICB0aGlzLiRkZXN0cm95ID0gbm9vcDtcbiAgICAgICAgfVxuICAgICAgICAkb24odHlwZSwgY2FsbGJhY2spIHtcbiAgICAgICAgICAgIC8vIFRPRE8gc2hvdWxkIHRoaXMgZGVsZWdhdGUgdG8gYWRkRXZlbnRMaXN0ZW5lcj9cbiAgICAgICAgICAgIGNvbnN0IGNhbGxiYWNrcyA9ICh0aGlzLiQkLmNhbGxiYWNrc1t0eXBlXSB8fCAodGhpcy4kJC5jYWxsYmFja3NbdHlwZV0gPSBbXSkpO1xuICAgICAgICAgICAgY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spO1xuICAgICAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBpbmRleCA9IGNhbGxiYWNrcy5pbmRleE9mKGNhbGxiYWNrKTtcbiAgICAgICAgICAgICAgICBpZiAoaW5kZXggIT09IC0xKVxuICAgICAgICAgICAgICAgICAgICBjYWxsYmFja3Muc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgJHNldCgpIHtcbiAgICAgICAgICAgIC8vIG92ZXJyaWRkZW4gYnkgaW5zdGFuY2UsIGlmIGl0IGhhcyBwcm9wc1xuICAgICAgICB9XG4gICAgfTtcbn1cbmNsYXNzIFN2ZWx0ZUNvbXBvbmVudCB7XG4gICAgJGRlc3Ryb3koKSB7XG4gICAgICAgIGRlc3Ryb3lfY29tcG9uZW50KHRoaXMsIDEpO1xuICAgICAgICB0aGlzLiRkZXN0cm95ID0gbm9vcDtcbiAgICB9XG4gICAgJG9uKHR5cGUsIGNhbGxiYWNrKSB7XG4gICAgICAgIGNvbnN0IGNhbGxiYWNrcyA9ICh0aGlzLiQkLmNhbGxiYWNrc1t0eXBlXSB8fCAodGhpcy4kJC5jYWxsYmFja3NbdHlwZV0gPSBbXSkpO1xuICAgICAgICBjYWxsYmFja3MucHVzaChjYWxsYmFjayk7XG4gICAgICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBpbmRleCA9IGNhbGxiYWNrcy5pbmRleE9mKGNhbGxiYWNrKTtcbiAgICAgICAgICAgIGlmIChpbmRleCAhPT0gLTEpXG4gICAgICAgICAgICAgICAgY2FsbGJhY2tzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIH07XG4gICAgfVxuICAgICRzZXQoKSB7XG4gICAgICAgIC8vIG92ZXJyaWRkZW4gYnkgaW5zdGFuY2UsIGlmIGl0IGhhcyBwcm9wc1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZGlzcGF0Y2hfZGV2KHR5cGUsIGRldGFpbCkge1xuICAgIGRvY3VtZW50LmRpc3BhdGNoRXZlbnQoY3VzdG9tX2V2ZW50KHR5cGUsIE9iamVjdC5hc3NpZ24oeyB2ZXJzaW9uOiAnMy4yMy4wJyB9LCBkZXRhaWwpKSk7XG59XG5mdW5jdGlvbiBhcHBlbmRfZGV2KHRhcmdldCwgbm9kZSkge1xuICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTUluc2VydFwiLCB7IHRhcmdldCwgbm9kZSB9KTtcbiAgICBhcHBlbmQodGFyZ2V0LCBub2RlKTtcbn1cbmZ1bmN0aW9uIGluc2VydF9kZXYodGFyZ2V0LCBub2RlLCBhbmNob3IpIHtcbiAgICBkaXNwYXRjaF9kZXYoXCJTdmVsdGVET01JbnNlcnRcIiwgeyB0YXJnZXQsIG5vZGUsIGFuY2hvciB9KTtcbiAgICBpbnNlcnQodGFyZ2V0LCBub2RlLCBhbmNob3IpO1xufVxuZnVuY3Rpb24gZGV0YWNoX2Rldihub2RlKSB7XG4gICAgZGlzcGF0Y2hfZGV2KFwiU3ZlbHRlRE9NUmVtb3ZlXCIsIHsgbm9kZSB9KTtcbiAgICBkZXRhY2gobm9kZSk7XG59XG5mdW5jdGlvbiBkZXRhY2hfYmV0d2Vlbl9kZXYoYmVmb3JlLCBhZnRlcikge1xuICAgIHdoaWxlIChiZWZvcmUubmV4dFNpYmxpbmcgJiYgYmVmb3JlLm5leHRTaWJsaW5nICE9PSBhZnRlcikge1xuICAgICAgICBkZXRhY2hfZGV2KGJlZm9yZS5uZXh0U2libGluZyk7XG4gICAgfVxufVxuZnVuY3Rpb24gZGV0YWNoX2JlZm9yZV9kZXYoYWZ0ZXIpIHtcbiAgICB3aGlsZSAoYWZ0ZXIucHJldmlvdXNTaWJsaW5nKSB7XG4gICAgICAgIGRldGFjaF9kZXYoYWZ0ZXIucHJldmlvdXNTaWJsaW5nKTtcbiAgICB9XG59XG5mdW5jdGlvbiBkZXRhY2hfYWZ0ZXJfZGV2KGJlZm9yZSkge1xuICAgIHdoaWxlIChiZWZvcmUubmV4dFNpYmxpbmcpIHtcbiAgICAgICAgZGV0YWNoX2RldihiZWZvcmUubmV4dFNpYmxpbmcpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIGxpc3Rlbl9kZXYobm9kZSwgZXZlbnQsIGhhbmRsZXIsIG9wdGlvbnMsIGhhc19wcmV2ZW50X2RlZmF1bHQsIGhhc19zdG9wX3Byb3BhZ2F0aW9uKSB7XG4gICAgY29uc3QgbW9kaWZpZXJzID0gb3B0aW9ucyA9PT0gdHJ1ZSA/IFtcImNhcHR1cmVcIl0gOiBvcHRpb25zID8gQXJyYXkuZnJvbShPYmplY3Qua2V5cyhvcHRpb25zKSkgOiBbXTtcbiAgICBpZiAoaGFzX3ByZXZlbnRfZGVmYXVsdClcbiAgICAgICAgbW9kaWZpZXJzLnB1c2goJ3ByZXZlbnREZWZhdWx0Jyk7XG4gICAgaWYgKGhhc19zdG9wX3Byb3BhZ2F0aW9uKVxuICAgICAgICBtb2RpZmllcnMucHVzaCgnc3RvcFByb3BhZ2F0aW9uJyk7XG4gICAgZGlzcGF0Y2hfZGV2KFwiU3ZlbHRlRE9NQWRkRXZlbnRMaXN0ZW5lclwiLCB7IG5vZGUsIGV2ZW50LCBoYW5kbGVyLCBtb2RpZmllcnMgfSk7XG4gICAgY29uc3QgZGlzcG9zZSA9IGxpc3Rlbihub2RlLCBldmVudCwgaGFuZGxlciwgb3B0aW9ucyk7XG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgZGlzcGF0Y2hfZGV2KFwiU3ZlbHRlRE9NUmVtb3ZlRXZlbnRMaXN0ZW5lclwiLCB7IG5vZGUsIGV2ZW50LCBoYW5kbGVyLCBtb2RpZmllcnMgfSk7XG4gICAgICAgIGRpc3Bvc2UoKTtcbiAgICB9O1xufVxuZnVuY3Rpb24gYXR0cl9kZXYobm9kZSwgYXR0cmlidXRlLCB2YWx1ZSkge1xuICAgIGF0dHIobm9kZSwgYXR0cmlidXRlLCB2YWx1ZSk7XG4gICAgaWYgKHZhbHVlID09IG51bGwpXG4gICAgICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVJlbW92ZUF0dHJpYnV0ZVwiLCB7IG5vZGUsIGF0dHJpYnV0ZSB9KTtcbiAgICBlbHNlXG4gICAgICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVNldEF0dHJpYnV0ZVwiLCB7IG5vZGUsIGF0dHJpYnV0ZSwgdmFsdWUgfSk7XG59XG5mdW5jdGlvbiBwcm9wX2Rldihub2RlLCBwcm9wZXJ0eSwgdmFsdWUpIHtcbiAgICBub2RlW3Byb3BlcnR5XSA9IHZhbHVlO1xuICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVNldFByb3BlcnR5XCIsIHsgbm9kZSwgcHJvcGVydHksIHZhbHVlIH0pO1xufVxuZnVuY3Rpb24gZGF0YXNldF9kZXYobm9kZSwgcHJvcGVydHksIHZhbHVlKSB7XG4gICAgbm9kZS5kYXRhc2V0W3Byb3BlcnR5XSA9IHZhbHVlO1xuICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVNldERhdGFzZXRcIiwgeyBub2RlLCBwcm9wZXJ0eSwgdmFsdWUgfSk7XG59XG5mdW5jdGlvbiBzZXRfZGF0YV9kZXYodGV4dCwgZGF0YSkge1xuICAgIGRhdGEgPSAnJyArIGRhdGE7XG4gICAgaWYgKHRleHQuZGF0YSA9PT0gZGF0YSlcbiAgICAgICAgcmV0dXJuO1xuICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVNldERhdGFcIiwgeyBub2RlOiB0ZXh0LCBkYXRhIH0pO1xuICAgIHRleHQuZGF0YSA9IGRhdGE7XG59XG5mdW5jdGlvbiB2YWxpZGF0ZV9lYWNoX2FyZ3VtZW50KGFyZykge1xuICAgIGlmICh0eXBlb2YgYXJnICE9PSAnc3RyaW5nJyAmJiAhKGFyZyAmJiB0eXBlb2YgYXJnID09PSAnb2JqZWN0JyAmJiAnbGVuZ3RoJyBpbiBhcmcpKSB7XG4gICAgICAgIGxldCBtc2cgPSAneyNlYWNofSBvbmx5IGl0ZXJhdGVzIG92ZXIgYXJyYXktbGlrZSBvYmplY3RzLic7XG4gICAgICAgIGlmICh0eXBlb2YgU3ltYm9sID09PSAnZnVuY3Rpb24nICYmIGFyZyAmJiBTeW1ib2wuaXRlcmF0b3IgaW4gYXJnKSB7XG4gICAgICAgICAgICBtc2cgKz0gJyBZb3UgY2FuIHVzZSBhIHNwcmVhZCB0byBjb252ZXJ0IHRoaXMgaXRlcmFibGUgaW50byBhbiBhcnJheS4nO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIHZhbGlkYXRlX3Nsb3RzKG5hbWUsIHNsb3QsIGtleXMpIHtcbiAgICBmb3IgKGNvbnN0IHNsb3Rfa2V5IG9mIE9iamVjdC5rZXlzKHNsb3QpKSB7XG4gICAgICAgIGlmICghfmtleXMuaW5kZXhPZihzbG90X2tleSkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgPCR7bmFtZX0+IHJlY2VpdmVkIGFuIHVuZXhwZWN0ZWQgc2xvdCBcIiR7c2xvdF9rZXl9XCIuYCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5jbGFzcyBTdmVsdGVDb21wb25lbnREZXYgZXh0ZW5kcyBTdmVsdGVDb21wb25lbnQge1xuICAgIGNvbnN0cnVjdG9yKG9wdGlvbnMpIHtcbiAgICAgICAgaWYgKCFvcHRpb25zIHx8ICghb3B0aW9ucy50YXJnZXQgJiYgIW9wdGlvbnMuJCRpbmxpbmUpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCd0YXJnZXQnIGlzIGEgcmVxdWlyZWQgb3B0aW9uYCk7XG4gICAgICAgIH1cbiAgICAgICAgc3VwZXIoKTtcbiAgICB9XG4gICAgJGRlc3Ryb3koKSB7XG4gICAgICAgIHN1cGVyLiRkZXN0cm95KCk7XG4gICAgICAgIHRoaXMuJGRlc3Ryb3kgPSAoKSA9PiB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYENvbXBvbmVudCB3YXMgYWxyZWFkeSBkZXN0cm95ZWRgKTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1jb25zb2xlXG4gICAgICAgIH07XG4gICAgfVxuICAgICRjYXB0dXJlX3N0YXRlKCkgeyB9XG4gICAgJGluamVjdF9zdGF0ZSgpIHsgfVxufVxuZnVuY3Rpb24gbG9vcF9ndWFyZCh0aW1lb3V0KSB7XG4gICAgY29uc3Qgc3RhcnQgPSBEYXRlLm5vdygpO1xuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgIGlmIChEYXRlLm5vdygpIC0gc3RhcnQgPiB0aW1lb3V0KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEluZmluaXRlIGxvb3AgZGV0ZWN0ZWRgKTtcbiAgICAgICAgfVxuICAgIH07XG59XG5cbmV4cG9ydCB7IEh0bWxUYWcsIFN2ZWx0ZUNvbXBvbmVudCwgU3ZlbHRlQ29tcG9uZW50RGV2LCBTdmVsdGVFbGVtZW50LCBhY3Rpb25fZGVzdHJveWVyLCBhZGRfYXR0cmlidXRlLCBhZGRfY2xhc3NlcywgYWRkX2ZsdXNoX2NhbGxiYWNrLCBhZGRfbG9jYXRpb24sIGFkZF9yZW5kZXJfY2FsbGJhY2ssIGFkZF9yZXNpemVfbGlzdGVuZXIsIGFkZF90cmFuc2Zvcm0sIGFmdGVyVXBkYXRlLCBhcHBlbmQsIGFwcGVuZF9kZXYsIGFzc2lnbiwgYXR0ciwgYXR0cl9kZXYsIGJlZm9yZVVwZGF0ZSwgYmluZCwgYmluZGluZ19jYWxsYmFja3MsIGJsYW5rX29iamVjdCwgYnViYmxlLCBjaGVja19vdXRyb3MsIGNoaWxkcmVuLCBjbGFpbV9jb21wb25lbnQsIGNsYWltX2VsZW1lbnQsIGNsYWltX3NwYWNlLCBjbGFpbV90ZXh0LCBjbGVhcl9sb29wcywgY29tcG9uZW50X3N1YnNjcmliZSwgY29tcHV0ZV9yZXN0X3Byb3BzLCBjcmVhdGVFdmVudERpc3BhdGNoZXIsIGNyZWF0ZV9hbmltYXRpb24sIGNyZWF0ZV9iaWRpcmVjdGlvbmFsX3RyYW5zaXRpb24sIGNyZWF0ZV9jb21wb25lbnQsIGNyZWF0ZV9pbl90cmFuc2l0aW9uLCBjcmVhdGVfb3V0X3RyYW5zaXRpb24sIGNyZWF0ZV9zbG90LCBjcmVhdGVfc3NyX2NvbXBvbmVudCwgY3VycmVudF9jb21wb25lbnQsIGN1c3RvbV9ldmVudCwgZGF0YXNldF9kZXYsIGRlYnVnLCBkZXN0cm95X2Jsb2NrLCBkZXN0cm95X2NvbXBvbmVudCwgZGVzdHJveV9lYWNoLCBkZXRhY2gsIGRldGFjaF9hZnRlcl9kZXYsIGRldGFjaF9iZWZvcmVfZGV2LCBkZXRhY2hfYmV0d2Vlbl9kZXYsIGRldGFjaF9kZXYsIGRpcnR5X2NvbXBvbmVudHMsIGRpc3BhdGNoX2RldiwgZWFjaCwgZWxlbWVudCwgZWxlbWVudF9pcywgZW1wdHksIGVzY2FwZSwgZXNjYXBlZCwgZXhjbHVkZV9pbnRlcm5hbF9wcm9wcywgZml4X2FuZF9kZXN0cm95X2Jsb2NrLCBmaXhfYW5kX291dHJvX2FuZF9kZXN0cm95X2Jsb2NrLCBmaXhfcG9zaXRpb24sIGZsdXNoLCBnZXRDb250ZXh0LCBnZXRfYmluZGluZ19ncm91cF92YWx1ZSwgZ2V0X2N1cnJlbnRfY29tcG9uZW50LCBnZXRfc2xvdF9jaGFuZ2VzLCBnZXRfc2xvdF9jb250ZXh0LCBnZXRfc3ByZWFkX29iamVjdCwgZ2V0X3NwcmVhZF91cGRhdGUsIGdldF9zdG9yZV92YWx1ZSwgZ2xvYmFscywgZ3JvdXBfb3V0cm9zLCBoYW5kbGVfcHJvbWlzZSwgaGFzX3Byb3AsIGlkZW50aXR5LCBpbml0LCBpbnNlcnQsIGluc2VydF9kZXYsIGludHJvcywgaW52YWxpZF9hdHRyaWJ1dGVfbmFtZV9jaGFyYWN0ZXIsIGlzX2NsaWVudCwgaXNfY3Jvc3NvcmlnaW4sIGlzX2Z1bmN0aW9uLCBpc19wcm9taXNlLCBsaXN0ZW4sIGxpc3Rlbl9kZXYsIGxvb3AsIGxvb3BfZ3VhcmQsIG1pc3NpbmdfY29tcG9uZW50LCBtb3VudF9jb21wb25lbnQsIG5vb3AsIG5vdF9lcXVhbCwgbm93LCBudWxsX3RvX2VtcHR5LCBvYmplY3Rfd2l0aG91dF9wcm9wZXJ0aWVzLCBvbkRlc3Ryb3ksIG9uTW91bnQsIG9uY2UsIG91dHJvX2FuZF9kZXN0cm95X2Jsb2NrLCBwcmV2ZW50X2RlZmF1bHQsIHByb3BfZGV2LCBxdWVyeV9zZWxlY3Rvcl9hbGwsIHJhZiwgcnVuLCBydW5fYWxsLCBzYWZlX25vdF9lcXVhbCwgc2NoZWR1bGVfdXBkYXRlLCBzZWxlY3RfbXVsdGlwbGVfdmFsdWUsIHNlbGVjdF9vcHRpb24sIHNlbGVjdF9vcHRpb25zLCBzZWxlY3RfdmFsdWUsIHNlbGYsIHNldENvbnRleHQsIHNldF9hdHRyaWJ1dGVzLCBzZXRfY3VycmVudF9jb21wb25lbnQsIHNldF9jdXN0b21fZWxlbWVudF9kYXRhLCBzZXRfZGF0YSwgc2V0X2RhdGFfZGV2LCBzZXRfaW5wdXRfdHlwZSwgc2V0X2lucHV0X3ZhbHVlLCBzZXRfbm93LCBzZXRfcmFmLCBzZXRfc3RvcmVfdmFsdWUsIHNldF9zdHlsZSwgc2V0X3N2Z19hdHRyaWJ1dGVzLCBzcGFjZSwgc3ByZWFkLCBzdG9wX3Byb3BhZ2F0aW9uLCBzdWJzY3JpYmUsIHN2Z19lbGVtZW50LCB0ZXh0LCB0aWNrLCB0aW1lX3Jhbmdlc190b19hcnJheSwgdG9fbnVtYmVyLCB0b2dnbGVfY2xhc3MsIHRyYW5zaXRpb25faW4sIHRyYW5zaXRpb25fb3V0LCB1cGRhdGVfa2V5ZWRfZWFjaCwgdXBkYXRlX3Nsb3QsIHZhbGlkYXRlX2NvbXBvbmVudCwgdmFsaWRhdGVfZWFjaF9hcmd1bWVudCwgdmFsaWRhdGVfZWFjaF9rZXlzLCB2YWxpZGF0ZV9zbG90cywgdmFsaWRhdGVfc3RvcmUsIHhsaW5rX2F0dHIgfTtcbiIsIi8vIHBhdGggdG8gd2hlcmUgdGhlIGltYWdlcyBhcmUgZG93bmxvYWRlZFxyXG4vL2NvbnN0IENBUkRfREFUQSA9IHJlcXVpcmUoXCIuL3NjcnlmYWxsLWRlZmF1bHQtY2FyZHMuanNvblwiKTtcclxuXHJcbmZ1bmN0aW9uIHRpbWVvdXQoKSB7XHJcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICByZXNvbHZlKCk7XHJcbiAgICB9LCA3MCk7XHJcbiAgfSk7XHJcbn1cclxuXHJcbmNsYXNzIE10Z0ludGVyZmFjZSB7XHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5fX2NhY2hlID0ge307XHJcbiAgfVxyXG5cclxuICBhc3luYyBjYXJkQnlOYW1lKG5hbWUpIHtcclxuICAgIGlmICh0aGlzLl9fY2FjaGVbbmFtZV0pIHJldHVybiB0aGlzLl9fY2FjaGVbbmFtZV07XHJcbiAgICBhd2FpdCB0aW1lb3V0KCk7XHJcbiAgICAvL2h0dHBzOi8vYXBpLnNjcnlmYWxsLmNvbS9jYXJkcy9uYW1lZD9mdXp6eT1hdXN0K2NvbSBcclxuICAgIGNvbnN0IGZpeGVkID0gbmFtZS5yZXBsYWNlKC9cXHMvZywgXCIrXCIpO1xyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZmV0Y2goJ2h0dHBzOi8vYXBpLnNjcnlmYWxsLmNvbS9jYXJkcy9uYW1lZD9mdXp6eT0nICsgZml4ZWQpXHJcbiAgICAgIC50aGVuKHJlc3BvbnNlID0+IHJlc3BvbnNlLmpzb24oKSkuY2F0Y2goZSA9PiB7IGNvbnNvbGUubG9nKGUpOyByZXR1cm4geyBjb2RlOiBcIm5vdF9mb3VuZFwiIH07IH0pO1xyXG5cclxuICAgIHRoaXMuX19jYWNoZVtuYW1lXSA9IHJlc3VsdDtcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgLy8gLnRoZW4oZGF0YSA9PiBjb25zb2xlLmxvZyhkYXRhKSk7XHJcbiAgICAvKiBmb3IgKGxldCBjYXJkIG9mIENBUkRfREFUQSkge1xyXG4gICAgICAgaWYgKGNhcmQubmFtZS50b0xvd2VyQ2FzZSgpID09IG5hbWUudG9Mb3dlckNhc2UoKSkgcmV0dXJuIGNhcmQ7XHJcbiAgICAgfSovXHJcbiAgfVxyXG5cclxuXHJcbiAgLyoqXHJcbiAgICogY29udmVydHMgYSBkZWNrIHN0cmluZyB0byBhIHJlYWRhYmxlIG9iamVjdFxyXG4gICAqIGFuZCBkb3dubG9hZHMgdGhlIGltZyBkYXRhIG9uIGRlbWFuZCwgaWYgaXQgZG9lcyBub3QgZXhpc3RcclxuICAgKlxyXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBkZWNrU3RyaW5nIHRoZSBjb21wbGV0ZSBkZWNrLCBjb3BpZWQgZnJvbSBhIHNpdGUgb3IgZS5nIGZvcmdlXHJcbiAgICogQG1lbWJlcm9mIE10Z0ludGVyZmFjZVxyXG4gICAqL1xyXG4gIGFzeW5jIGNyZWF0ZURlY2soZGVja1N0cmluZywgdXBkYXRlID0gKCkgPT4ge30pIHtcclxuICAgIC8vIGNvbnZlcnQgdGhlIGRlY2sgc3RyaW5nIHRvIGFuIGFycmF5XHJcblxyXG4gICAgbGV0IGdyb3VwcyA9IFsuLi5kZWNrU3RyaW5nLm1hdGNoKC8jKC4qPykoXFxufCQpL2cpIHx8IFtcIm1haW5cIl1dO1xyXG4gICAgY29uc3QgZGVja1JhdyA9IGRlY2tTdHJpbmcudHJpbSgpLnJlcGxhY2UoL1xcKCguKj8pXFwpfChbMC05XSpcXG4pL2csIFwiXFxuXCIpLnJlcGxhY2UoL1xccypcXG4rXFxzKlxcbisvZywgXCJcXG5cIikuc3BsaXQoXCJcXG5cIik7XHJcbiAgICBpZiAoIWRlY2tSYXcpIHJldHVybiBbXTtcclxuICAgIGlmICghZGVja1Jhd1swXS5pbmNsdWRlcyhcIiNcIikpIHtcclxuICAgICAgaWYgKGdyb3Vwc1swXSAhPT0gXCJtYWluXCIpIHtcclxuICAgICAgICBncm91cHMgPSBbXCJtYWluXCJdLmNvbmNhdChncm91cHMpO1xyXG4gICAgICB9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBkZWNrUmF3LnNoaWZ0KCk7XHJcbiAgICB9XHJcblxyXG4gICAgZ3JvdXBzID0gZ3JvdXBzLm1hcCh2ID0+IHsgcmV0dXJuIHsgZGVjazoge30sIG5hbWU6IHYucmVwbGFjZShcIiNcIiwgXCJcIikudHJpbSgpIH0gfSk7XHJcblxyXG4gICAgbGV0IGN1ckdyb3VwID0gMDtcclxuXHJcbiAgICBsZXQgcHJvZ3Jlc3MgPSAwO1xyXG4gICAgLy8gaXRlcmF0ZSBlYWNoIGZvdW5kIGNhcmRcclxuICAgIGZvciAobGV0IGNhcmQgb2YgZGVja1Jhdykge1xyXG4gICAgICBpZiAoIWNhcmQpIGNvbnRpbnVlO1xyXG4gICAgICBpZiAoY2FyZC5pbmNsdWRlcyhcIiNcIikpIHtcclxuICAgICAgICBjdXJHcm91cCsrO1xyXG4gICAgICAgIGlmIChjdXJHcm91cCA+IGdyb3Vwcy5sZW5ndGgpIGN1ckdyb3VwID0gMDtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG4gICAgICBwcm9ncmVzcysrO1xyXG4gICAgICBjb25zdCBkZWNrID0gZ3JvdXBzW2N1ckdyb3VwXS5kZWNrO1xyXG4gICAgICB1cGRhdGUocHJvZ3Jlc3MsIGRlY2tSYXcubGVuZ3RoIC0gZ3JvdXBzLmxlbmd0aCArIDEpO1xyXG4gICAgICAvLyBleHRyYWN0IHRoZSBjb3VudCBmcm9tIHRoZSBzdHJpbmcgYW5kIGZyZWUgdGhlIG5hbWVcclxuXHJcbiAgICAgIGxldCBjb3VudCA9IE1hdGguZmxvb3IoKChjYXJkLm1hdGNoKC8oXFxkKykvKSB8fCBbXSlbMF0gfHwgMSkpO1xyXG4gICAgICBpZiAoaXNOYU4oY291bnQpKSB7XHJcbiAgICAgICAgY291bnQgPSAxO1xyXG4gICAgICB9XHJcbiAgICAgIGNvbnN0IG5hbWUgPSBjYXJkLnJlcGxhY2UoLyhcXGQrKS8sIFwiXCIpLnRyaW0oKTtcclxuICAgICAgaWYgKCFuYW1lKSBjb250aW51ZTsgLy8gY2FudCB3b3JrIHdpdGggdGhpcyBkYXRhXHJcbiAgICAgIC8vIHNlYXJjaCB0aGUgYWNjb3JkaW5nIGRhdGFcclxuICAgICAgbGV0IGRhdGEgPSBhd2FpdCB0aGlzLmNhcmRCeU5hbWUobmFtZSk7XHJcblxyXG4gICAgICBpZiAoZGF0YS5uYW1lKVxyXG4gICAgICAgIGRlY2tTdHJpbmcgPSBkZWNrU3RyaW5nLnJlcGxhY2UobmFtZSwgZGF0YS5uYW1lKTtcclxuICAgICAgaWYgKGRhdGEuY29kZSA9PSBcIm5vdF9mb3VuZFwiKSB7XHJcbiAgICAgICAgZGF0YSA9IHsgaW1hZ2VfdXJpczoge30sIGxlZ2FsaXRpZXM6IHt9LCBwcmljZXM6IHsgdXNkOiAwIH0sIG1hbmFfY29zdDogXCJcIiwgY21jOiAwLCB0eXBlX2xpbmU6IFwibGFuZFwiIH07XHJcbiAgICAgIH1cclxuICAgICAgaWYgKGRlY2tbbmFtZV0pIHtcclxuICAgICAgICBkZWNrW25hbWVdLmNvdW50ICs9IGNvdW50O1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vIHdyYXAgZGF0YSBpbiBlYXN5IHJlYWRhYmxlIGZvcm1hdFxyXG4gICAgICAgIGxldCBiYWNrc2lkZSA9IFwiXCI7XHJcbiAgICAgICAgaWYgKCFkYXRhLmltYWdlX3VyaXMpIHtcclxuICAgICAgICAgIGlmIChkYXRhLmNhcmRfZmFjZXMpIHtcclxuICAgICAgICAgICAgZGF0YS5pbWFnZV91cmlzID0gZGF0YS5jYXJkX2ZhY2VzWzBdLmltYWdlX3VyaXM7XHJcbiAgICAgICAgICAgIGNvbnN0IGJpdSA9IGRhdGEuY2FyZF9mYWNlc1sxXS5pbWFnZV91cmlzO1xyXG4gICAgICAgICAgICBiYWNrc2lkZSA9IGJpdSA/IGJpdS5ib3JkZXJfY3JvcCB8fCBiaXUubm9ybWFsIDogXCJcIjtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGNvbnNvbGUubG9nKFwiZXJyXCIsIGRhdGEpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgdXJsID0gZGF0YSA/IGRhdGEuaW1hZ2VfdXJpcy5ib3JkZXJfY3JvcCB8fCBkYXRhLmltYWdlX3VyaXMubm9ybWFsIDogXCJcIjtcclxuICAgICAgICBkZWNrW25hbWVdID0ge1xyXG4gICAgICAgICAgbmFtZSxcclxuICAgICAgICAgIGNvdW50LFxyXG4gICAgICAgICAgdXJsLFxyXG4gICAgICAgICAgYmFja3NpZGUsXHJcbiAgICAgICAgICBkYXRhXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgbGV0IGxhbmRDb3VudCA9IDA7XHJcbiAgICBjb25zdCBvdmVyYWxsRGV2b3Rpb24gPSB7XHJcbiAgICAgIGJsdWU6IDAsXHJcbiAgICAgIGJsYWNrOiAwLFxyXG4gICAgICByZWQ6IDAsXHJcbiAgICAgIHdoaXRlOiAwLFxyXG4gICAgICBncmVlbjogMCxcclxuICAgICAgY29sb3JsZXNzOiAwLFxyXG4gICAgICBnZW5lcmljOiAwLFxyXG4gICAgICBzdW06IDBcclxuICAgIH07XHJcbiAgICBjb25zdCBvdmVyYWxsTWFuYUN1cnZlID0gW107XHJcbiAgICAvL21hbmFfY29zdDogXCJ7V317VX17Qn17Un17R30ge0N9XCJcclxuXHJcbiAgICBsZXQgb3ZlcmFsbENvdW50ID0gMDtcclxuICAgIGxldCBvdmVyYWxsQ29zdCA9IDA7XHJcbiAgICAvL21hbmFfY29zdC5zcGxpdChcIkdcIikubGVuZ3RoIC0gMVxyXG4gICAgZm9yIChsZXQgZ3JvdXAgb2YgZ3JvdXBzKSB7XHJcbiAgICAgIGdyb3VwLmNhcmRzID0gT2JqZWN0LnZhbHVlcyhncm91cC5kZWNrKTtcclxuICAgICAgZ3JvdXAuY2FyZHMgPSBncm91cC5jYXJkcy5zb3J0KChhLCBiKSA9PiBhLmRhdGEuY21jID4gYi5kYXRhLmNtYyA/IDEgOiAtMSk7XHJcblxyXG4gICAgICBsZXQgY291bnQgPSAwO1xyXG4gICAgICBsZXQgY29zdCA9IDA7XHJcbiAgICAgIGNvbnN0IGRldm90aW9uID0ge1xyXG4gICAgICAgIGJsdWU6IDAsXHJcbiAgICAgICAgYmxhY2s6IDAsXHJcbiAgICAgICAgcmVkOiAwLFxyXG4gICAgICAgIHdoaXRlOiAwLFxyXG4gICAgICAgIGdyZWVuOiAwLFxyXG4gICAgICAgIGNvbG9ybGVzczogMCxcclxuICAgICAgICBnZW5lcmljOiAwLFxyXG4gICAgICAgIHN1bTogMFxyXG4gICAgICB9O1xyXG4gICAgICBjb25zdCBtYW5hQ3VydmUgPSBbXTtcclxuICAgICAgZm9yIChsZXQgY2FyZCBvZiBncm91cC5jYXJkcykge1xyXG4gICAgICAgIGNvdW50ICs9IGNhcmQuY291bnQ7XHJcblxyXG4gICAgICAgIGNvc3QgKz0gcGFyc2VGbG9hdChjYXJkLmRhdGEucHJpY2VzLnVzZCB8fCAwKSAqIGNhcmQuY291bnQ7XHJcblxyXG4gICAgICAgIGlmICghY2FyZC5kYXRhLnR5cGVfbGluZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKFwibGFuZFwiKSkge1xyXG4gICAgICAgICAgbWFuYUN1cnZlW2NhcmQuZGF0YS5jbWMgfHwgMF0gPSAobWFuYUN1cnZlW2NhcmQuZGF0YS5jbWMgfHwgMF0gfHwgMCkgKyBjYXJkLmNvdW50O1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBsYW5kQ291bnQgKz0gY2FyZC5jb3VudDtcclxuICAgICAgICB9XHJcbiAgICAgICAgZGV2b3Rpb24uYmx1ZSArPSAoY2FyZC5kYXRhLm1hbmFfY29zdC5zcGxpdChcIlVcIikubGVuZ3RoIC0gMSkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIGRldm90aW9uLmJsYWNrICs9IChjYXJkLmRhdGEubWFuYV9jb3N0LnNwbGl0KFwiQlwiKS5sZW5ndGggLSAxKSAqIGNhcmQuY291bnQ7XHJcbiAgICAgICAgZGV2b3Rpb24ucmVkICs9IChjYXJkLmRhdGEubWFuYV9jb3N0LnNwbGl0KFwiUlwiKS5sZW5ndGggLSAxKSAqIGNhcmQuY291bnQ7XHJcbiAgICAgICAgZGV2b3Rpb24ud2hpdGUgKz0gKGNhcmQuZGF0YS5tYW5hX2Nvc3Quc3BsaXQoXCJXXCIpLmxlbmd0aCAtIDEpICogY2FyZC5jb3VudDtcclxuICAgICAgICBkZXZvdGlvbi5ncmVlbiArPSAoY2FyZC5kYXRhLm1hbmFfY29zdC5zcGxpdChcIkdcIikubGVuZ3RoIC0gMSkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIGRldm90aW9uLmNvbG9ybGVzcyArPSAoY2FyZC5kYXRhLm1hbmFfY29zdC5zcGxpdChcIkNcIikubGVuZ3RoIC0gMSkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIGRldm90aW9uLmdlbmVyaWMgKz0gTWF0aC5mbG9vcihjYXJkLmRhdGEubWFuYV9jb3N0LnJlcGxhY2UoL1teMC05Ll0vZywgXCJcIikgfHwgMCkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIGRldm90aW9uLnN1bSA9IGRldm90aW9uLmJsdWUgKyBkZXZvdGlvbi5ibGFjayArIGRldm90aW9uLnJlZCArIGRldm90aW9uLmdyZWVuICsgZGV2b3Rpb24ud2hpdGUgKyBkZXZvdGlvbi5jb2xvcmxlc3MgKyBkZXZvdGlvbi5nZW5lcmljO1xyXG4gICAgICB9XHJcbiAgICAgIG92ZXJhbGxDb3N0ICs9IGNvc3Q7XHJcbiAgICAgIG92ZXJhbGxDb3VudCArPSBjb3VudDtcclxuICAgICAgZ3JvdXAuY291bnQgPSBjb3VudDtcclxuICAgICAgZ3JvdXAubWFuYSA9IGRldm90aW9uO1xyXG4gICAgICBncm91cC5jb3N0ID0gY29zdDtcclxuXHJcbiAgICAgIGdyb3VwLm1hbmFDdXJ2ZSA9IG1hbmFDdXJ2ZTtcclxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtYW5hQ3VydmUubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICBtYW5hQ3VydmVbaV0gPSBtYW5hQ3VydmVbaV0gfHwgMDtcclxuICAgICAgICBvdmVyYWxsTWFuYUN1cnZlW2ldID0gKG92ZXJhbGxNYW5hQ3VydmVbaV0gfHwgMCkgKyAobWFuYUN1cnZlW2ldIHx8IDApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBvdmVyYWxsRGV2b3Rpb24uYmx1ZSArPSBkZXZvdGlvbi5ibHVlO1xyXG4gICAgICBvdmVyYWxsRGV2b3Rpb24uYmxhY2sgKz0gZGV2b3Rpb24uYmxhY2s7XHJcbiAgICAgIG92ZXJhbGxEZXZvdGlvbi5yZWQgKz0gZGV2b3Rpb24ucmVkO1xyXG4gICAgICBvdmVyYWxsRGV2b3Rpb24ud2hpdGUgKz0gZGV2b3Rpb24ud2hpdGU7XHJcbiAgICAgIG92ZXJhbGxEZXZvdGlvbi5ncmVlbiArPSBkZXZvdGlvbi5ncmVlbjtcclxuICAgICAgb3ZlcmFsbERldm90aW9uLmNvbG9ybGVzcyArPSBkZXZvdGlvbi5jb2xvcmxlc3M7XHJcblxyXG4gICAgICBvdmVyYWxsRGV2b3Rpb24uZ2VuZXJpYyArPSBkZXZvdGlvbi5nZW5lcmljO1xyXG4gICAgICBvdmVyYWxsRGV2b3Rpb24uc3VtICs9IGRldm90aW9uLnN1bTtcclxuICAgIH1cclxuXHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG92ZXJhbGxNYW5hQ3VydmUubGVuZ3RoOyBpKyspIHtcclxuICAgICAgb3ZlcmFsbE1hbmFDdXJ2ZVtpXSA9IG92ZXJhbGxNYW5hQ3VydmVbaV0gfHwgMDtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBub25sYW5kcyA9IG92ZXJhbGxDb3VudCAtIGxhbmRDb3VudDtcclxuXHJcbiAgICBsZXQganVzdERldm90aW9uID0gb3ZlcmFsbERldm90aW9uLmJsdWUgKyBvdmVyYWxsRGV2b3Rpb24uYmxhY2sgKyBvdmVyYWxsRGV2b3Rpb24ucmVkICsgb3ZlcmFsbERldm90aW9uLndoaXRlICsgb3ZlcmFsbERldm90aW9uLmdyZWVuICsgb3ZlcmFsbERldm90aW9uLmNvbG9ybGVzcztcclxuICAgIGp1c3REZXZvdGlvbiA9IGp1c3REZXZvdGlvbiB8fCAxO1xyXG4gICAgY29uc3QgbWFuYVByb3Bvc2FsID0ge1xyXG4gICAgICBibHVlOiBvdmVyYWxsRGV2b3Rpb24uYmx1ZSAvIGp1c3REZXZvdGlvbixcclxuICAgICAgYmxhY2s6IG92ZXJhbGxEZXZvdGlvbi5ibGFjayAvIGp1c3REZXZvdGlvbixcclxuICAgICAgcmVkOiBvdmVyYWxsRGV2b3Rpb24ucmVkIC8ganVzdERldm90aW9uLFxyXG4gICAgICB3aGl0ZTogb3ZlcmFsbERldm90aW9uLndoaXRlIC8ganVzdERldm90aW9uLFxyXG4gICAgICBncmVlbjogb3ZlcmFsbERldm90aW9uLmdyZWVuIC8ganVzdERldm90aW9uLFxyXG4gICAgICBjb2xvcmxlc3M6IG92ZXJhbGxEZXZvdGlvbi5jb2xvcmxlc3MgLyBqdXN0RGV2b3Rpb24sXHJcbiAgICB9O1xyXG5cclxuICAgIGdyb3Vwc1tcIm1hbmFQcm9wb3NhbFwiXSA9IG1hbmFQcm9wb3NhbDtcclxuXHJcbiAgICBncm91cHNbXCJsYW5kQ291bnRcIl0gPSBsYW5kQ291bnQ7XHJcbiAgICBncm91cHNbXCJjYXJkQ291bnRcIl0gPSBvdmVyYWxsQ291bnQ7XHJcbiAgICBncm91cHNbXCJhdmVyYWdlTWFuYVwiXSA9IG92ZXJhbGxEZXZvdGlvbi5zdW0gLyAob3ZlcmFsbENvdW50IC0gbGFuZENvdW50KTtcclxuICAgIGdyb3Vwc1tcImNvc3RcIl0gPSBvdmVyYWxsQ29zdDtcclxuICAgIGdyb3Vwc1tcIm1hbmFcIl0gPSBvdmVyYWxsRGV2b3Rpb247XHJcbiAgICBncm91cHNbXCJjb3JyZWN0ZWRcIl0gPSBkZWNrU3RyaW5nO1xyXG4gICAgZ3JvdXBzW1wibWFuYUN1cnZlXCJdID0gb3ZlcmFsbE1hbmFDdXJ2ZTtcclxuICAgIHJldHVybiBncm91cHM7XHJcbiAgfVxyXG59XHJcblxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBuZXcgTXRnSW50ZXJmYWNlKCk7IiwiLyohXG4gKiBKYXZhU2NyaXB0IENvb2tpZSB2Mi4yLjFcbiAqIGh0dHBzOi8vZ2l0aHViLmNvbS9qcy1jb29raWUvanMtY29va2llXG4gKlxuICogQ29weXJpZ2h0IDIwMDYsIDIwMTUgS2xhdXMgSGFydGwgJiBGYWduZXIgQnJhY2tcbiAqIFJlbGVhc2VkIHVuZGVyIHRoZSBNSVQgbGljZW5zZVxuICovXG47KGZ1bmN0aW9uIChmYWN0b3J5KSB7XG5cdHZhciByZWdpc3RlcmVkSW5Nb2R1bGVMb2FkZXI7XG5cdGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIHtcblx0XHRkZWZpbmUoZmFjdG9yeSk7XG5cdFx0cmVnaXN0ZXJlZEluTW9kdWxlTG9hZGVyID0gdHJ1ZTtcblx0fVxuXHRpZiAodHlwZW9mIGV4cG9ydHMgPT09ICdvYmplY3QnKSB7XG5cdFx0bW9kdWxlLmV4cG9ydHMgPSBmYWN0b3J5KCk7XG5cdFx0cmVnaXN0ZXJlZEluTW9kdWxlTG9hZGVyID0gdHJ1ZTtcblx0fVxuXHRpZiAoIXJlZ2lzdGVyZWRJbk1vZHVsZUxvYWRlcikge1xuXHRcdHZhciBPbGRDb29raWVzID0gd2luZG93LkNvb2tpZXM7XG5cdFx0dmFyIGFwaSA9IHdpbmRvdy5Db29raWVzID0gZmFjdG9yeSgpO1xuXHRcdGFwaS5ub0NvbmZsaWN0ID0gZnVuY3Rpb24gKCkge1xuXHRcdFx0d2luZG93LkNvb2tpZXMgPSBPbGRDb29raWVzO1xuXHRcdFx0cmV0dXJuIGFwaTtcblx0XHR9O1xuXHR9XG59KGZ1bmN0aW9uICgpIHtcblx0ZnVuY3Rpb24gZXh0ZW5kICgpIHtcblx0XHR2YXIgaSA9IDA7XG5cdFx0dmFyIHJlc3VsdCA9IHt9O1xuXHRcdGZvciAoOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSB7XG5cdFx0XHR2YXIgYXR0cmlidXRlcyA9IGFyZ3VtZW50c1sgaSBdO1xuXHRcdFx0Zm9yICh2YXIga2V5IGluIGF0dHJpYnV0ZXMpIHtcblx0XHRcdFx0cmVzdWx0W2tleV0gPSBhdHRyaWJ1dGVzW2tleV07XG5cdFx0XHR9XG5cdFx0fVxuXHRcdHJldHVybiByZXN1bHQ7XG5cdH1cblxuXHRmdW5jdGlvbiBkZWNvZGUgKHMpIHtcblx0XHRyZXR1cm4gcy5yZXBsYWNlKC8oJVswLTlBLVpdezJ9KSsvZywgZGVjb2RlVVJJQ29tcG9uZW50KTtcblx0fVxuXG5cdGZ1bmN0aW9uIGluaXQgKGNvbnZlcnRlcikge1xuXHRcdGZ1bmN0aW9uIGFwaSgpIHt9XG5cblx0XHRmdW5jdGlvbiBzZXQgKGtleSwgdmFsdWUsIGF0dHJpYnV0ZXMpIHtcblx0XHRcdGlmICh0eXBlb2YgZG9jdW1lbnQgPT09ICd1bmRlZmluZWQnKSB7XG5cdFx0XHRcdHJldHVybjtcblx0XHRcdH1cblxuXHRcdFx0YXR0cmlidXRlcyA9IGV4dGVuZCh7XG5cdFx0XHRcdHBhdGg6ICcvJ1xuXHRcdFx0fSwgYXBpLmRlZmF1bHRzLCBhdHRyaWJ1dGVzKTtcblxuXHRcdFx0aWYgKHR5cGVvZiBhdHRyaWJ1dGVzLmV4cGlyZXMgPT09ICdudW1iZXInKSB7XG5cdFx0XHRcdGF0dHJpYnV0ZXMuZXhwaXJlcyA9IG5ldyBEYXRlKG5ldyBEYXRlKCkgKiAxICsgYXR0cmlidXRlcy5leHBpcmVzICogODY0ZSs1KTtcblx0XHRcdH1cblxuXHRcdFx0Ly8gV2UncmUgdXNpbmcgXCJleHBpcmVzXCIgYmVjYXVzZSBcIm1heC1hZ2VcIiBpcyBub3Qgc3VwcG9ydGVkIGJ5IElFXG5cdFx0XHRhdHRyaWJ1dGVzLmV4cGlyZXMgPSBhdHRyaWJ1dGVzLmV4cGlyZXMgPyBhdHRyaWJ1dGVzLmV4cGlyZXMudG9VVENTdHJpbmcoKSA6ICcnO1xuXG5cdFx0XHR0cnkge1xuXHRcdFx0XHR2YXIgcmVzdWx0ID0gSlNPTi5zdHJpbmdpZnkodmFsdWUpO1xuXHRcdFx0XHRpZiAoL15bXFx7XFxbXS8udGVzdChyZXN1bHQpKSB7XG5cdFx0XHRcdFx0dmFsdWUgPSByZXN1bHQ7XG5cdFx0XHRcdH1cblx0XHRcdH0gY2F0Y2ggKGUpIHt9XG5cblx0XHRcdHZhbHVlID0gY29udmVydGVyLndyaXRlID9cblx0XHRcdFx0Y29udmVydGVyLndyaXRlKHZhbHVlLCBrZXkpIDpcblx0XHRcdFx0ZW5jb2RlVVJJQ29tcG9uZW50KFN0cmluZyh2YWx1ZSkpXG5cdFx0XHRcdFx0LnJlcGxhY2UoLyUoMjN8MjR8MjZ8MkJ8M0F8M0N8M0V8M0R8MkZ8M0Z8NDB8NUJ8NUR8NUV8NjB8N0J8N0R8N0MpL2csIGRlY29kZVVSSUNvbXBvbmVudCk7XG5cblx0XHRcdGtleSA9IGVuY29kZVVSSUNvbXBvbmVudChTdHJpbmcoa2V5KSlcblx0XHRcdFx0LnJlcGxhY2UoLyUoMjN8MjR8MjZ8MkJ8NUV8NjB8N0MpL2csIGRlY29kZVVSSUNvbXBvbmVudClcblx0XHRcdFx0LnJlcGxhY2UoL1tcXChcXCldL2csIGVzY2FwZSk7XG5cblx0XHRcdHZhciBzdHJpbmdpZmllZEF0dHJpYnV0ZXMgPSAnJztcblx0XHRcdGZvciAodmFyIGF0dHJpYnV0ZU5hbWUgaW4gYXR0cmlidXRlcykge1xuXHRcdFx0XHRpZiAoIWF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0pIHtcblx0XHRcdFx0XHRjb250aW51ZTtcblx0XHRcdFx0fVxuXHRcdFx0XHRzdHJpbmdpZmllZEF0dHJpYnV0ZXMgKz0gJzsgJyArIGF0dHJpYnV0ZU5hbWU7XG5cdFx0XHRcdGlmIChhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID09PSB0cnVlKSB7XG5cdFx0XHRcdFx0Y29udGludWU7XG5cdFx0XHRcdH1cblxuXHRcdFx0XHQvLyBDb25zaWRlcnMgUkZDIDYyNjUgc2VjdGlvbiA1LjI6XG5cdFx0XHRcdC8vIC4uLlxuXHRcdFx0XHQvLyAzLiAgSWYgdGhlIHJlbWFpbmluZyB1bnBhcnNlZC1hdHRyaWJ1dGVzIGNvbnRhaW5zIGEgJXgzQiAoXCI7XCIpXG5cdFx0XHRcdC8vICAgICBjaGFyYWN0ZXI6XG5cdFx0XHRcdC8vIENvbnN1bWUgdGhlIGNoYXJhY3RlcnMgb2YgdGhlIHVucGFyc2VkLWF0dHJpYnV0ZXMgdXAgdG8sXG5cdFx0XHRcdC8vIG5vdCBpbmNsdWRpbmcsIHRoZSBmaXJzdCAleDNCIChcIjtcIikgY2hhcmFjdGVyLlxuXHRcdFx0XHQvLyAuLi5cblx0XHRcdFx0c3RyaW5naWZpZWRBdHRyaWJ1dGVzICs9ICc9JyArIGF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0uc3BsaXQoJzsnKVswXTtcblx0XHRcdH1cblxuXHRcdFx0cmV0dXJuIChkb2N1bWVudC5jb29raWUgPSBrZXkgKyAnPScgKyB2YWx1ZSArIHN0cmluZ2lmaWVkQXR0cmlidXRlcyk7XG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gZ2V0IChrZXksIGpzb24pIHtcblx0XHRcdGlmICh0eXBlb2YgZG9jdW1lbnQgPT09ICd1bmRlZmluZWQnKSB7XG5cdFx0XHRcdHJldHVybjtcblx0XHRcdH1cblxuXHRcdFx0dmFyIGphciA9IHt9O1xuXHRcdFx0Ly8gVG8gcHJldmVudCB0aGUgZm9yIGxvb3AgaW4gdGhlIGZpcnN0IHBsYWNlIGFzc2lnbiBhbiBlbXB0eSBhcnJheVxuXHRcdFx0Ly8gaW4gY2FzZSB0aGVyZSBhcmUgbm8gY29va2llcyBhdCBhbGwuXG5cdFx0XHR2YXIgY29va2llcyA9IGRvY3VtZW50LmNvb2tpZSA/IGRvY3VtZW50LmNvb2tpZS5zcGxpdCgnOyAnKSA6IFtdO1xuXHRcdFx0dmFyIGkgPSAwO1xuXG5cdFx0XHRmb3IgKDsgaSA8IGNvb2tpZXMubGVuZ3RoOyBpKyspIHtcblx0XHRcdFx0dmFyIHBhcnRzID0gY29va2llc1tpXS5zcGxpdCgnPScpO1xuXHRcdFx0XHR2YXIgY29va2llID0gcGFydHMuc2xpY2UoMSkuam9pbignPScpO1xuXG5cdFx0XHRcdGlmICghanNvbiAmJiBjb29raWUuY2hhckF0KDApID09PSAnXCInKSB7XG5cdFx0XHRcdFx0Y29va2llID0gY29va2llLnNsaWNlKDEsIC0xKTtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdHRyeSB7XG5cdFx0XHRcdFx0dmFyIG5hbWUgPSBkZWNvZGUocGFydHNbMF0pO1xuXHRcdFx0XHRcdGNvb2tpZSA9IChjb252ZXJ0ZXIucmVhZCB8fCBjb252ZXJ0ZXIpKGNvb2tpZSwgbmFtZSkgfHxcblx0XHRcdFx0XHRcdGRlY29kZShjb29raWUpO1xuXG5cdFx0XHRcdFx0aWYgKGpzb24pIHtcblx0XHRcdFx0XHRcdHRyeSB7XG5cdFx0XHRcdFx0XHRcdGNvb2tpZSA9IEpTT04ucGFyc2UoY29va2llKTtcblx0XHRcdFx0XHRcdH0gY2F0Y2ggKGUpIHt9XG5cdFx0XHRcdFx0fVxuXG5cdFx0XHRcdFx0amFyW25hbWVdID0gY29va2llO1xuXG5cdFx0XHRcdFx0aWYgKGtleSA9PT0gbmFtZSkge1xuXHRcdFx0XHRcdFx0YnJlYWs7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9IGNhdGNoIChlKSB7fVxuXHRcdFx0fVxuXG5cdFx0XHRyZXR1cm4ga2V5ID8gamFyW2tleV0gOiBqYXI7XG5cdFx0fVxuXG5cdFx0YXBpLnNldCA9IHNldDtcblx0XHRhcGkuZ2V0ID0gZnVuY3Rpb24gKGtleSkge1xuXHRcdFx0cmV0dXJuIGdldChrZXksIGZhbHNlIC8qIHJlYWQgYXMgcmF3ICovKTtcblx0XHR9O1xuXHRcdGFwaS5nZXRKU09OID0gZnVuY3Rpb24gKGtleSkge1xuXHRcdFx0cmV0dXJuIGdldChrZXksIHRydWUgLyogcmVhZCBhcyBqc29uICovKTtcblx0XHR9O1xuXHRcdGFwaS5yZW1vdmUgPSBmdW5jdGlvbiAoa2V5LCBhdHRyaWJ1dGVzKSB7XG5cdFx0XHRzZXQoa2V5LCAnJywgZXh0ZW5kKGF0dHJpYnV0ZXMsIHtcblx0XHRcdFx0ZXhwaXJlczogLTFcblx0XHRcdH0pKTtcblx0XHR9O1xuXG5cdFx0YXBpLmRlZmF1bHRzID0ge307XG5cblx0XHRhcGkud2l0aENvbnZlcnRlciA9IGluaXQ7XG5cblx0XHRyZXR1cm4gYXBpO1xuXHR9XG5cblx0cmV0dXJuIGluaXQoZnVuY3Rpb24gKCkge30pO1xufSkpO1xuIiwiPHNjcmlwdD5cclxuICBpbXBvcnQgeyBvbk1vdW50IH0gZnJvbSBcInN2ZWx0ZVwiO1xyXG4gIGltcG9ydCBDYXJkTG9hZGVyIGZyb20gXCIuL2NhcmQtbG9hZGVyLmpzXCI7XHJcblxyXG4gIGltcG9ydCBDb29raWVzIGZyb20gXCJqcy1jb29raWVcIjtcclxuXHJcbiAgY29uc3QgQ0FSRF9SQVRJTyA9IDAuNzE3NjQ3MDU4ODI7XHJcbiAgbGV0IF9oZWlnaHQgPSAzMDA7XHJcbiAgbGV0IF93aWR0aCA9IE1hdGguZmxvb3IoX2hlaWdodCAqIENBUkRfUkFUSU8pO1xyXG5cclxuICBsZXQgaGVpZ2h0ID0gX2hlaWdodDtcclxuICBsZXQgd2lkdGggPSBfd2lkdGg7XHJcblxyXG4gIGxldCBzY2FsaW5nID0gNTA7XHJcblxyXG4gICQ6IHtcclxuICAgIGNvbnN0IHMgPSBNYXRoLmZsb29yKHNjYWxpbmcgfHwgMTAwKSAvIDEwMDtcclxuICAgIGhlaWdodCA9IF9oZWlnaHQgKiBzO1xyXG4gICAgd2lkdGggPSBfd2lkdGggKiBzO1xyXG4gIH1cclxuXHJcbiAgbGV0IHByb21pc2UgPSBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHJlc29sdmUoW10pKTtcclxuXHJcbiAgbGV0IGlucHV0O1xyXG4gIGxldCBmb3JtYXQ7XHJcbiAgbGV0IHByb2dyZXNzID0gMDtcclxuICBsZXQgYWxsID0gMDtcclxuXHJcbiAgbGV0IGhpZGRlbkdyb3VwcyA9IG5ldyBTZXQoKTtcclxuXHJcbiAgZnVuY3Rpb24gdG9nZ2xlR3JvdXBWaXNpYmlsaXR5KGdyb3VwKSB7XHJcbiAgICBpZiAoaGlkZGVuR3JvdXBzLmhhcyhncm91cC5uYW1lKSkgaGlkZGVuR3JvdXBzLmRlbGV0ZShncm91cC5uYW1lKTtcclxuICAgIGVsc2UgaGlkZGVuR3JvdXBzLmFkZChncm91cC5uYW1lKTtcclxuXHJcbiAgICBoaWRkZW5Hcm91cHMgPSBoaWRkZW5Hcm91cHM7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBzcChwLCBhKSB7XHJcbiAgICBwcm9ncmVzcyA9IHA7XHJcbiAgICBhbGwgPSBhO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgZnVuY3Rpb24gdXBkYXRlKGV2dCkge1xyXG4gICAgaWYgKGV2dC5rZXlDb2RlICE9PSAyNykgcmV0dXJuO1xyXG4gICAgcHJvbWlzZSA9IENhcmRMb2FkZXIuY3JlYXRlRGVjayhpbnB1dC52YWx1ZSB8fCBcIlwiLCAocCwgYSkgPT4ge1xyXG4gICAgICBzcChwLCBhKTtcclxuICAgIH0pXHJcbiAgICAgIC5jYXRjaChlID0+IHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGUpO1xyXG4gICAgICAgIHRocm93IGU7XHJcbiAgICAgIH0pXHJcbiAgICAgIC50aGVuKHJlcyA9PiB7XHJcbiAgICAgICAgaW5wdXQudmFsdWUgPSByZXMuY29ycmVjdGVkO1xyXG4gICAgICAgIHJldHVybiByZXM7XHJcbiAgICAgIH0pO1xyXG4gIH1cclxuICBmdW5jdGlvbiByZWxvYWQoKSB7XHJcbiAgICB1cGRhdGUoeyBrZXlDb2RlOiAyNyB9KTtcclxuICB9XHJcbiAgZnVuY3Rpb24gcmVtb3ZlKGNhcmQpIHtcclxuICAgIGNvbnN0IHIgPSBuZXcgUmVnRXhwKGBeLioke2NhcmQubmFtZX0uKiRgLCBcImdtXCIpO1xyXG5cclxuICAgIGlucHV0LnZhbHVlID0gaW5wdXQudmFsdWUucmVwbGFjZShyLCBcIlwiKTtcclxuICAgIHByb21pc2UgPSBDYXJkTG9hZGVyLmNyZWF0ZURlY2soaW5wdXQudmFsdWUgfHwgXCJcIiwgKHAsIGEpID0+XHJcbiAgICAgIHNwKHAsIGEpXHJcbiAgICApLmNhdGNoKGUgPT4ge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGUpO1xyXG4gICAgICB0aHJvdyBlO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBvbk1vdW50KGFzeW5jICgpID0+IHtcclxuICAgIGNvbnN0IHN0YXJ0ID1cclxuICAgICAgQ29va2llcy5nZXQoXCJkZWNrXCIpIHx8XHJcbiAgICAgIGAjbGFuZHNcclxubW91bnRhaW5cclxuMiBwbGFpbnNcclxuMyBzd2FtcHNcclxuIyBtYWluIGRlY2tcclxuMjAgYmxpZ2h0c3RlZWwgY29sb3NzdXNgO1xyXG5cclxuICAgIGlucHV0LnZhbHVlID0gc3RhcnQ7XHJcbiAgICBjb25zb2xlLmxvZyhcIlNUU0ZTREZcIiwgQ29va2llcy5nZXQoXCJkZWNrXCIpKSxcclxuICAgICAgKHByb21pc2UgPSBDYXJkTG9hZGVyLmNyZWF0ZURlY2soc3RhcnQsIChwLCBhKSA9PiBzcChwLCBhKSkpO1xyXG4gIH0pO1xyXG5cclxuICBmdW5jdGlvbiBvblR5cGluZygpIHtcclxuICAgIENvb2tpZXMuc2V0KFwiZGVja1wiLCBpbnB1dC52YWx1ZSwgeyBleHBpcmVzOiA3IH0pO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gZ2V0SGVpZ2h0KG1hbmEsIGdyb3Vwcykge1xyXG4gICAgcmV0dXJuIDEwMCAqIChtYW5hIC8gTWF0aC5tYXgoLi4uZ3JvdXBzW1wibWFuYUN1cnZlXCJdKSk7XHJcbiAgfVxyXG48L3NjcmlwdD5cclxuXHJcbjxzdHlsZT5cclxuICAuY29udGVudCB7XHJcbiAgICAtLXJhaXNpbi1ibGFjazogaHNsYSgyMDAsIDglLCAxNSUsIDEpO1xyXG4gICAgLS1yb21hbi1zaWx2ZXI6IGhzbGEoMTk2LCAxNSUsIDYwJSwgMSk7XHJcbiAgICAtLWNvbG9ybGVzczogaHNsYSgwLCAwJSwgODklLCAxKTtcclxuICAgIC0tYmxhY2s6IGhzbGEoODMsIDglLCAzOCUsIDEpO1xyXG4gICAgLS13aGl0ZTogaHNsKDQ4LCA2NCUsIDg5JSk7XHJcbiAgICAtLXJlZDogaHNsYSgwLCA3MSUsIDg0JSwgMSk7XHJcbiAgICAtLWdyZWVuOiBoc2xhKDExNCwgNjAlLCA3NSUsIDEpO1xyXG4gICAgLS1ibHVlOiBoc2xhKDIzNSwgNTUlLCA4MSUsIDEpO1xyXG4gIH1cclxuXHJcbiAgLmNvbnRlbnQge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgICB3aWR0aDogMTAwJTtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICB9XHJcbiAgLnN0YXRpc3RpY3Mge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XHJcbiAgfVxyXG4gIC5pbnB1dCB7XHJcbiAgICB3aWR0aDogMTAwJTtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICAgIGJveC1zaXppbmc6IGJvcmRlci1ib3g7XHJcbiAgICBwYWRkaW5nOiAxMHB4O1xyXG4gICAgcmVzaXplOiBub25lO1xyXG4gIH1cclxuXHJcbiAgLmNvbnRyb2xzIHtcclxuICAgIGZsZXgtc2hyaW5rOiAwO1xyXG4gICAgd2lkdGg6IDMwMHB4O1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gICAgYmFja2dyb3VuZDogbGlnaHRncmF5O1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XHJcbiAgfVxyXG5cclxuICAuaGVscCB7XHJcbiAgICBwYWRkaW5nOiAwcHggMTBweCAxMHB4IDEwcHg7XHJcbiAgICB1c2VyLXNlbGVjdDogbm9uZTtcclxuICB9XHJcblxyXG4gIC5ncm91cC1jb250ZW50IHtcclxuICAgIGZsZXgtZ3JvdzogMTtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LXdyYXA6IHdyYXA7XHJcbiAgICB0cmFuc2l0aW9uOiBoZWlnaHQgNTAwbXMgZWFzZTtcclxuICB9XHJcblxyXG4gIC5ncm91cC1jb250ZW50LmhpZGRlbiB7XHJcbiAgICBvdmVyZmxvdzogaGlkZGVuO1xyXG4gICAgaGVpZ2h0OiA0NXB4O1xyXG4gIH1cclxuXHJcbiAgLmRpc3BsYXkge1xyXG4gICAgZmxleC1ncm93OiAxO1xyXG4gICAgYmFja2dyb3VuZDogZ3JheTtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gICAgZmxleC13cmFwOiBub3dyYXA7XHJcbiAgICBvdmVyZmxvdzogYXV0bztcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICAgIHVzZXItc2VsZWN0OiBub25lO1xyXG4gIH1cclxuXHJcbiAgLmxvYWRpbmctd3JhcHBlciB7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICBsZWZ0OiA1MCU7XHJcbiAgICB0b3A6IDA7XHJcbiAgICBib3R0b206IDA7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgYWxpZ24taXRlbXM6IGNlbnRlcjtcclxuICB9XHJcblxyXG4gIC5lbnRyeSB7XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgICBwYWRkaW5nOiAxMHB4O1xyXG4gIH1cclxuICAuY2FyZCB7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICBib3JkZXI6IDZweCBzb2xpZCByZ2IoMjIsIDIyLCAyMik7XHJcbiAgICBib3JkZXItcmFkaXVzOiAxMHB4O1xyXG4gICAgb3V0bGluZTogMDtcclxuICAgIGJveC1zaGFkb3c6IDBweCAwcHggMTBweCBibGFjaztcclxuICB9XHJcblxyXG4gIC5jYXJkLmJhbm5lZCB7XHJcbiAgICBib3JkZXI6IDZweCBzb2xpZCByZWQ7XHJcbiAgfVxyXG5cclxuICAuY2FyZDpob3ZlciB7XHJcbiAgICBib3JkZXI6IDZweCBzb2xpZCBibHVlO1xyXG4gICAgY3Vyc29yOiBwb2ludGVyO1xyXG4gIH1cclxuXHJcbiAgLnByaWNlLFxyXG4gIC5iYW5uZWQtdGV4dCxcclxuICAuY291bnQge1xyXG4gICAgZm9udC1zaXplOiAzNHB4O1xyXG4gICAgdGV4dC1zaGFkb3c6IDBweCAwcHggOXB4IGJsYWNrO1xyXG4gICAgY29sb3I6IHJlZDtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIHotaW5kZXg6IDEwMDtcclxuICAgIGZvbnQtd2VpZ2h0OiBib2xkO1xyXG4gICAgbGVmdDogMzRweDtcclxuICB9XHJcblxyXG4gIC5iYW5uZWQtdGV4dCB7XHJcbiAgICBib3R0b206IDEzNXB4O1xyXG4gIH1cclxuICAuY291bnQge1xyXG4gICAgdG9wOiAxNjVweDtcclxuICB9XHJcblxyXG4gIC5wcmljZSB7XHJcbiAgICBib3R0b206IDdweDtcclxuICAgIGNvbG9yOiB3aGVhdDtcclxuICAgIGZvbnQtc2l6ZTogMTJweDtcclxuICAgIGJhY2tncm91bmQ6IGJsYWNrO1xyXG4gICAgbGVmdDogMTA5cHg7XHJcbiAgICBmb250LXdlaWdodDogbm9ybWFsO1xyXG4gIH1cclxuXHJcbiAgLmdyb3VwLWhlYWRlciB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgYmFja2dyb3VuZDogZGFya2dyZXk7XHJcbiAgICAvKiBwYWRkaW5nOiA4cHg7ICovXHJcbiAgICBtYXJnaW46IDhweCAwO1xyXG4gICAgYm94LXNoYWRvdzogMHB4IDBweCA4cHggYmxhY2s7XHJcbiAgICB3aWR0aDogMTAwJTtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgfVxyXG5cclxuICAuZ3JvdXAtaGVhZGVyIGgyIHtcclxuICAgIHBhZGRpbmc6IDAgMjVweDtcclxuICAgIG1hcmdpbjogMHB4O1xyXG4gIH1cclxuXHJcbiAgLmdyb3VwLXN0YXRpc3RpY3Mge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgfVxyXG5cclxuICAubWFuYS1wcm9wb3NhbCxcclxuICAubWFuYS1kZXZvdGlvbiB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICB9XHJcblxyXG4gIC5kZWNrLXZhbHVlLFxyXG4gIC5ncm91cC12YWx1ZSB7XHJcbiAgICBwYWRkaW5nOiA1cHg7XHJcbiAgICBjb2xvcjogYmxhY2s7XHJcbiAgICBib3JkZXItcmFkaXVzOiA1MCU7XHJcbiAgICB3aWR0aDogMjVweDtcclxuICAgIGhlaWdodDogMjVweDtcclxuICAgIHRleHQtYWxpZ246IGNlbnRlcjtcclxuICAgIG1hcmdpbjogNXB4O1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIHRleHQtYWxpZ246IGNlbnRlcjtcclxuICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7XHJcbiAgfVxyXG4gIC5ibHVlIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWJsdWUpO1xyXG4gIH1cclxuICAuYmxhY2sge1xyXG4gICAgY29sb3I6IHdoaXRlO1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0tYmxhY2spO1xyXG4gIH1cclxuICAucmVkIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLXJlZCk7XHJcbiAgfVxyXG4gIC53aGl0ZSB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS13aGl0ZSk7XHJcbiAgfVxyXG4gIC5ncmVlbiB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS1ncmVlbik7XHJcbiAgfVxyXG4gIC5jb2xvcmxlc3Mge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0tY29sb3JsZXNzKTtcclxuICB9XHJcbiAgLmdlbmVyaWMge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogZ29sZGVucm9kO1xyXG4gIH1cclxuICAuc3VtIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IGdvbGRlbnJvZDtcclxuICB9XHJcblxyXG4gIC5tYW5hLWN1cnZlIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gIH1cclxuXHJcbiAgLmFsbC1jdXJ2ZXMge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZ3JvdzogMTtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgICBoZWlnaHQ6IDEwMHB4O1xyXG4gIH1cclxuXHJcbiAgLmFsbC1sYWJlbHMge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtc2hyaW5rOiAwO1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICB9XHJcblxyXG4gIC5jdXJ2ZS1lbGVtZW50IHtcclxuICAgIHdpZHRoOiAyMHB4O1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIGJvdHRvbTogMDtcclxuICAgIGJhY2tncm91bmQ6IGdyYXk7XHJcbiAgICAvKiB2ZXJ0aWNhbC1hbGlnbjogbWlkZGxlOyAqL1xyXG4gICAgYWxpZ24taXRlbXM6IGNlbnRlcjtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICB9XHJcblxyXG4gIC5jdXJ2ZS1sYWJlbCB7XHJcbiAgICB3aWR0aDogMjBweDtcclxuICB9XHJcbiAgLmN1cnZlLXdyYXBwZXIge1xyXG4gICAgd2lkdGg6IDIwcHg7XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgfVxyXG5cclxuICBoNCB7XHJcbiAgICBtYXJnaW4tdG9wOiA1cHg7XHJcbiAgICBtYXJnaW4tYm90dG9tOiA1cHg7XHJcbiAgfVxyXG5cclxuICAubGRzLXJpcHBsZSB7XHJcbiAgICBkaXNwbGF5OiBpbmxpbmUtYmxvY2s7XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgICB3aWR0aDogODBweDtcclxuICAgIGhlaWdodDogODBweDtcclxuICB9XHJcbiAgLmxkcy1yaXBwbGUgZGl2IHtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIGJvcmRlcjogNHB4IHNvbGlkICNmZmY7XHJcbiAgICBvcGFjaXR5OiAxO1xyXG4gICAgYm9yZGVyLXJhZGl1czogNTAlO1xyXG4gICAgYW5pbWF0aW9uOiBsZHMtcmlwcGxlIDFzIGN1YmljLWJlemllcigwLCAwLjIsIDAuOCwgMSkgaW5maW5pdGU7XHJcbiAgfVxyXG4gIC5sZHMtcmlwcGxlIGRpdjpudGgtY2hpbGQoMikge1xyXG4gICAgYW5pbWF0aW9uLWRlbGF5OiAtMC41cztcclxuICB9XHJcbiAgQGtleWZyYW1lcyBsZHMtcmlwcGxlIHtcclxuICAgIDAlIHtcclxuICAgICAgdG9wOiAzNnB4O1xyXG4gICAgICBsZWZ0OiAzNnB4O1xyXG4gICAgICB3aWR0aDogMDtcclxuICAgICAgaGVpZ2h0OiAwO1xyXG4gICAgICBvcGFjaXR5OiAxO1xyXG4gICAgfVxyXG4gICAgMTAwJSB7XHJcbiAgICAgIHRvcDogMHB4O1xyXG4gICAgICBsZWZ0OiAwcHg7XHJcbiAgICAgIHdpZHRoOiA3MnB4O1xyXG4gICAgICBoZWlnaHQ6IDcycHg7XHJcbiAgICAgIG9wYWNpdHk6IDA7XHJcbiAgICB9XHJcbiAgfVxyXG48L3N0eWxlPlxyXG5cclxuPHN2ZWx0ZTp3aW5kb3cgb246a2V5dXA9e3VwZGF0ZX0gLz5cclxuPGRpdiBjbGFzcz1cImNvbnRlbnRcIj5cclxuICA8ZGl2IGNsYXNzPVwiY29udHJvbHNcIj5cclxuICAgIDxkaXYgY2xhc3M9XCJoZWxwXCI+XHJcbiAgICAgIHsjYXdhaXQgcHJvbWlzZX1cclxuICAgICAgICA8aDQ+SG93IHRvIHVzZTo8L2g0PlxyXG4gICAgICAgIDxwPnBhc3RlIHlvdXIgZGVjayB0byB0aGUgZm9sbG93aW5nIGlucHV0LjwvcD5cclxuICAgICAgICA8dWw+XHJcbiAgICAgICAgICA8bGk+XHJcbiAgICAgICAgICAgIHdoZW4gYSBsaW5lIHN0YXJ0cyB3aXRoIFwiI1wiIGl0IHdpbGwgYmUgaW50ZXJwcmV0ZWQgYXMgaGVhZGxpbmVcclxuICAgICAgICAgIDwvbGk+XHJcbiAgICAgICAgICA8bGk+XHJcbiAgICAgICAgICAgIGEgY2FyZCBjYW4gYmUgZW50ZXJlZCB3aXRoIGEgbGVhZGluZyBjb3VudCwgb3IganVzdCB3aXRoIGl0cyBuYW1lXHJcbiAgICAgICAgICA8L2xpPlxyXG4gICAgICAgICAgPGxpPnVzZSB0aGUgXCJFU0NcIiBrZXkgdG8gcmVhbG9hZCB0aGUgcHJldmlldzwvbGk+XHJcbiAgICAgICAgICA8bGk+ZG91YmxlY2xpY2sgYSBjYXJkIHRvIHJlbW92ZSBpdDwvbGk+XHJcbiAgICAgICAgPC91bD5cclxuICAgICAgICA8cD5OT1RFOiB3ZSB1c2UgY29va2llcyB0byBzdG9yZSB5b3VyIGRlY2sgYWZ0ZXIgcmVsb2FkLjwvcD5cclxuICAgICAgICA8cD5OT1RFOiBUaGlzIGlzIG5vdCBhbiBvZmZpY2lhbCBNYWdpYyBwcm9kdWt0LjwvcD5cclxuXHJcbiAgICAgICAgPGRpdj5sb2FkaW5nOiB7cHJvZ3Jlc3N9L3thbGx9PC9kaXY+XHJcbiAgICAgIHs6dGhlbiBncm91cHN9XHJcbiAgICAgICAgPGRpdj5Ub3RhbCBjYXJkczoge2dyb3Vwc1snY2FyZENvdW50J119PC9kaXY+XHJcbiAgICAgICAgPGRpdj5cclxuICAgICAgICAgIExhbmRzOiB7Z3JvdXBzWydsYW5kQ291bnQnXX0gTm9ubGFuZHM6IHtncm91cHNbJ2NhcmRDb3VudCddIC0gZ3JvdXBzWydsYW5kQ291bnQnXX1cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2PkNvc3Q6IHtncm91cHMuY29zdC50b0ZpeGVkKDIpICsgJyQnfTwvZGl2PlxyXG5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwic3RhdGlzdGljc1wiPlxyXG4gICAgICAgICAgPGg0PkRldm90aW9uPC9oND5cclxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJtYW5hLWRldm90aW9uXCI+XHJcbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGJsdWVcIj57Z3JvdXBzWydtYW5hJ10uYmx1ZX08L2Rpdj5cclxuICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgYmxhY2tcIj57Z3JvdXBzWydtYW5hJ10uYmxhY2t9PC9kaXY+XHJcbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIHJlZFwiPntncm91cHNbJ21hbmEnXS5yZWR9PC9kaXY+XHJcbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIHdoaXRlXCI+e2dyb3Vwc1snbWFuYSddLndoaXRlfTwvZGl2PlxyXG4gICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBncmVlblwiPntncm91cHNbJ21hbmEnXS5ncmVlbn08L2Rpdj5cclxuICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgY29sb3JsZXNzXCI+e2dyb3Vwc1snbWFuYSddLmNvbG9ybGVzc308L2Rpdj5cclxuICAgICAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgICAgIDxoND5HZW5lcmljIE1hbmE8L2g0PlxyXG4gICAgICAgICAgPGRpdj5SZW1haW5pbmcgZ2VuZXJpYyBtYW5hIGNvc3RzOntncm91cHNbJ21hbmEnXS5nZW5lcmljfTwvZGl2PlxyXG4gICAgICAgICAgPGRpdj5DTUMtTWFuYS1TdW06e2dyb3Vwc1snbWFuYSddLnN1bX08L2Rpdj5cclxuICAgICAgICAgIDxkaXY+QXZlcmFnZSBDTUMgcGVyIE5vbmxhbmQ6IHtncm91cHNbJ2F2ZXJhZ2VNYW5hJ10udG9GaXhlZCgyKX08L2Rpdj5cclxuICAgICAgICAgIDxoND5TdWdnZXN0ZWQgTWFuYSBEaXN0cmlidXRpb248L2g0PlxyXG4gICAgICAgICAgPGRpdiBjbGFzcz1cIm1hbmEtcHJvcG9zYWxcIj5cclxuICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgYmx1ZVwiPlxyXG4gICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS5ibHVlICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGJsYWNrXCI+XHJcbiAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLmJsYWNrICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIHJlZFwiPlxyXG4gICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS5yZWQgKiBncm91cHNbJ2xhbmRDb3VudCddKS50b0ZpeGVkKDEpfVxyXG4gICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgd2hpdGVcIj5cclxuICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10ud2hpdGUgKiBncm91cHNbJ2xhbmRDb3VudCddKS50b0ZpeGVkKDEpfVxyXG4gICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgZ3JlZW5cIj5cclxuICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10uZ3JlZW4gKiBncm91cHNbJ2xhbmRDb3VudCddKS50b0ZpeGVkKDEpfVxyXG4gICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgY29sb3JsZXNzXCI+XHJcbiAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLmNvbG9ybGVzcyAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICA8aDQ+TWFuYSBDdXJ2ZTwvaDQ+XHJcbiAgICAgICAgICA8ZGl2IGNsYXNzPVwibWFuYS1jdXJ2ZVwiPlxyXG4gICAgICAgICAgICA8ZGl2IGNsYXNzPVwiYWxsLWN1cnZlc1wiPlxyXG4gICAgICAgICAgICAgIHsjZWFjaCBncm91cHNbJ21hbmFDdXJ2ZSddIGFzIG1hbmEsIGl9XHJcbiAgICAgICAgICAgICAgICB7I2lmIG1hbmEgPiAwfVxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiY3VydmUtd3JhcHBlclwiPlxyXG4gICAgICAgICAgICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiY3VydmUtZWxlbWVudFwiXHJcbiAgICAgICAgICAgICAgICAgICAgICBzdHlsZT17J2hlaWdodDonICsgZ2V0SGVpZ2h0KG1hbmEsIGdyb3VwcykgKyAnJTsnfT5cclxuICAgICAgICAgICAgICAgICAgICAgIHttYW5hIHx8ICcnfVxyXG4gICAgICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIHsvaWZ9XHJcbiAgICAgICAgICAgICAgey9lYWNofVxyXG4gICAgICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJhbGwtbGFiZWxzXCI+XHJcbiAgICAgICAgICAgICAgeyNlYWNoIGdyb3Vwc1snbWFuYUN1cnZlJ10gYXMgbWFuYSwgaX1cclxuICAgICAgICAgICAgICAgIHsjaWYgbWFuYSA+IDB9XHJcbiAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJjdXJ2ZS1sYWJlbFwiPntpfTwvZGl2PlxyXG4gICAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgICB7L2VhY2h9XHJcbiAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPC9kaXY+XHJcblxyXG4gICAgICB7OmNhdGNoIGVycm9yfVxyXG4gICAgICAgIGFzZGFzZGFzYXNkYXNkIHtlcnJvcn1cclxuICAgICAgey9hd2FpdH1cclxuICAgICAgRm9ybWF0OlxyXG4gICAgICA8c2VsZWN0IGJpbmQ6dGhpcz17Zm9ybWF0fSBvbjpibHVyPXtyZWxvYWR9IG9uOmNoYW5nZT17cmVsb2FkfT5cclxuICAgICAgICA8b3B0aW9uIHNlbGVjdGVkPmNvbW1hbmRlcjwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+YnJhd2w8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPmR1ZWw8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPmZ1dHVyZTwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+aGlzdG9yaWM8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPmxlZ2FjeTwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+bW9kZXJuPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5vbGRzY2hvb2w8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnBhdXBlcjwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+cGVubnk8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnBpb25lZXI8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnN0YW5kYXJkPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj52aW50YWdlPC9vcHRpb24+XHJcbiAgICAgIDwvc2VsZWN0PlxyXG4gICAgICA8ZGl2IGNsYXNzPVwic2xpZGVjb250YWluZXJcIj5cclxuICAgICAgICA8aW5wdXQgdHlwZT1cInJhbmdlXCIgbWluPVwiMjVcIiBtYXg9XCIxMDBcIiBiaW5kOnZhbHVlPXtzY2FsaW5nfSAvPlxyXG4gICAgICA8L2Rpdj5cclxuICAgIDwvZGl2PlxyXG4gICAgPHRleHRhcmVhIGJpbmQ6dGhpcz17aW5wdXR9IGNsYXNzPVwiaW5wdXRcIiBvbjprZXl1cD17b25UeXBpbmd9IC8+XHJcbiAgPC9kaXY+XHJcblxyXG4gIDxkaXYgY2xhc3M9XCJkaXNwbGF5XCI+XHJcbiAgICB7I2F3YWl0IHByb21pc2V9XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJsb2FkaW5nLXdyYXBwZXJcIj5cclxuICAgICAgICA8ZGl2PmxvYWRpbmc6IHtwcm9ncmVzc30ve2FsbH08L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwibGRzLXJpcHBsZVwiPlxyXG4gICAgICAgICAgPGRpdiAvPlxyXG4gICAgICAgICAgPGRpdiAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICA8L2Rpdj5cclxuICAgIHs6dGhlbiBncm91cHN9XHJcblxyXG4gICAgICB7I2VhY2ggZ3JvdXBzIHx8IFtdIGFzIGdyb3VwfVxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJncm91cFwiPlxyXG5cclxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC1oZWFkZXJcIj5cclxuICAgICAgICAgICAgPGgyPntncm91cC5uYW1lICsgJyAvLyAnICsgZ3JvdXAuY291bnQgfHwgJ25vIG5hbWUnfTwvaDI+XHJcbiAgICAgICAgICAgIDxidXR0b24gb246Y2xpY2s9eygpID0+IHRvZ2dsZUdyb3VwVmlzaWJpbGl0eShncm91cCl9PlxyXG4gICAgICAgICAgICAgIHRvZ2dsZVxyXG4gICAgICAgICAgICA8L2J1dHRvbj5cclxuICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXN0YXRpc3RpY3NcIj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgYmx1ZVwiPntncm91cC5tYW5hLmJsdWV9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGJsYWNrXCI+e2dyb3VwLm1hbmEuYmxhY2t9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIHJlZFwiPntncm91cC5tYW5hLnJlZH08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgd2hpdGVcIj57Z3JvdXAubWFuYS53aGl0ZX08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgZ3JlZW5cIj57Z3JvdXAubWFuYS5ncmVlbn08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgY29sb3JsZXNzXCI+e2dyb3VwLm1hbmEuY29sb3JsZXNzfTwvZGl2PlxyXG4gICAgICAgICAgICAgIGdlbmVyaWM6XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGdlbmVyaWNcIj57Z3JvdXAubWFuYS5nZW5lcmljfTwvZGl2PlxyXG4gICAgICAgICAgICAgIHN1bTpcclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgc3VtXCI+e2dyb3VwLm1hbmEuc3VtfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSBncm91cC1jb3N0XCI+XHJcbiAgICAgICAgICAgICAgICB7Z3JvdXAuY29zdC50b0ZpeGVkKDIpICsgJyQnfVxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgY2xhc3M9XCJncm91cC1jb250ZW50XCJcclxuICAgICAgICAgICAgY2xhc3M6aGlkZGVuPXtoaWRkZW5Hcm91cHMuaGFzKGdyb3VwLm5hbWUpfT5cclxuXHJcbiAgICAgICAgICAgIHsjZWFjaCBncm91cC5jYXJkcyBhcyBjYXJkfVxyXG4gICAgICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgICAgIGNsYXNzPVwiZW50cnlcIlxyXG4gICAgICAgICAgICAgICAgc3R5bGU9eyd3aWR0aDonICsgd2lkdGggKyAncHg7IGhlaWdodDonICsgKGNhcmQuY291bnQgPD0gNCA/IGhlaWdodCArICgoY2FyZC5jb3VudCB8fCAxKSAtIDEpICogNDAgOiBoZWlnaHQgKyAzICogNDApICsgJ3B4Oyd9PlxyXG5cclxuICAgICAgICAgICAgICAgIHsjZWFjaCB7IGxlbmd0aDogY2FyZC5jb3VudCA+IDQgPyA0IDogY2FyZC5jb3VudCB9IGFzIF8sIGl9XHJcbiAgICAgICAgICAgICAgICAgIDxpbWdcclxuICAgICAgICAgICAgICAgICAgICBjbGFzczpiYW5uZWQ9e2NhcmQuZGF0YS5sZWdhbGl0aWVzW2Zvcm1hdC52YWx1ZV0gIT09ICdsZWdhbCd9XHJcbiAgICAgICAgICAgICAgICAgICAgb246ZGJsY2xpY2s9eygpID0+IHJlbW92ZShjYXJkKX1cclxuICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImNhcmRcIlxyXG4gICAgICAgICAgICAgICAgICAgIHN0eWxlPXsnbWFyZ2luLXRvcDogJyArIGkgKiA0MCArICdweCd9XHJcbiAgICAgICAgICAgICAgICAgICAgc3JjPXtjYXJkLnVybH1cclxuICAgICAgICAgICAgICAgICAgICBhbHQ9e2NhcmQubmFtZX1cclxuICAgICAgICAgICAgICAgICAgICB7d2lkdGh9XHJcbiAgICAgICAgICAgICAgICAgICAge2hlaWdodH0gLz5cclxuICAgICAgICAgICAgICAgIHsvZWFjaH1cclxuXHJcbiAgICAgICAgICAgICAgICB7I2lmIGNhcmQuZGF0YS5sZWdhbGl0aWVzW2Zvcm1hdC52YWx1ZV0gIT09ICdsZWdhbCd9XHJcbiAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJiYW5uZWQtdGV4dFwiPkJBTk5FRDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgICAgIHsjaWYgY2FyZC5jb3VudCA+IDR9XHJcbiAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJjb3VudFwiPntjYXJkLmNvdW50fXg8L2Rpdj5cclxuICAgICAgICAgICAgICAgIHsvaWZ9XHJcblxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cInByaWNlXCI+e2NhcmQuZGF0YS5wcmljZXMudXNkICsgJyQnIHx8ICc/Pz8nfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICB7L2VhY2h9XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgey9lYWNofVxyXG5cclxuICAgIHs6Y2F0Y2ggZXJyb3J9XHJcblxyXG4gICAgICA8ZGl2IGNsYXNzPVwiZXJyb3JcIj5cclxuICAgICAgICBFUlJPUiwgY2hlY2sgeW91ciBkZWNrbGlzdCBmb3IgY29ycmVjdCBmb3JtYXQgb3IgaW50ZXJuZXQgY29ubmVjdGlvblxyXG4gICAgICAgIGJydWRpXHJcbiAgICAgIDwvZGl2PlxyXG4gICAgey9hd2FpdH1cclxuICA8L2Rpdj5cclxuPC9kaXY+XHJcbiIsImltcG9ydCBNYWluVmlldyBmcm9tIFwiLi9lZGl0b3Iuc3ZlbHRlXCI7XHJcblxyXG5cclxuY29uc3QgcmVuZGVyVGFyZ2V0ID0gbmV3IE1haW5WaWV3KHtcclxuICB0YXJnZXQ6IGRvY3VtZW50LmJvZHksXHJcbiAgcHJvcHM6IHtcclxuICAgIHRlc3Q6IFwic2RmZHNmXCJcclxuICB9XHJcbn0pOyJdLCJuYW1lcyI6WyJDYXJkTG9hZGVyIiwiQ29va2llcyIsIk1haW5WaWV3Il0sIm1hcHBpbmdzIjoiOzs7SUFBQSxTQUFTLElBQUksR0FBRyxHQUFHO0FBQ25CLElBT0EsU0FBUyxVQUFVLENBQUMsS0FBSyxFQUFFO0lBQzNCLElBQUksT0FBTyxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLE9BQU8sS0FBSyxDQUFDLElBQUksS0FBSyxVQUFVLENBQUM7SUFDbEYsQ0FBQztBQUNELElBS0EsU0FBUyxHQUFHLENBQUMsRUFBRSxFQUFFO0lBQ2pCLElBQUksT0FBTyxFQUFFLEVBQUUsQ0FBQztJQUNoQixDQUFDO0lBQ0QsU0FBUyxZQUFZLEdBQUc7SUFDeEIsSUFBSSxPQUFPLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDL0IsQ0FBQztJQUNELFNBQVMsT0FBTyxDQUFDLEdBQUcsRUFBRTtJQUN0QixJQUFJLEdBQUcsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDckIsQ0FBQztJQUNELFNBQVMsV0FBVyxDQUFDLEtBQUssRUFBRTtJQUM1QixJQUFJLE9BQU8sT0FBTyxLQUFLLEtBQUssVUFBVSxDQUFDO0lBQ3ZDLENBQUM7SUFDRCxTQUFTLGNBQWMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFO0lBQzlCLElBQUksT0FBTyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxPQUFPLENBQUMsS0FBSyxRQUFRLEtBQUssT0FBTyxDQUFDLEtBQUssVUFBVSxDQUFDLENBQUM7SUFDbEcsQ0FBQztBQUNELEFBOElBO0lBQ0EsU0FBUyxNQUFNLENBQUMsTUFBTSxFQUFFLElBQUksRUFBRTtJQUM5QixJQUFJLE1BQU0sQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDN0IsQ0FBQztJQUNELFNBQVMsTUFBTSxDQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFO0lBQ3RDLElBQUksTUFBTSxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsTUFBTSxJQUFJLElBQUksQ0FBQyxDQUFDO0lBQzlDLENBQUM7SUFDRCxTQUFTLE1BQU0sQ0FBQyxJQUFJLEVBQUU7SUFDdEIsSUFBSSxJQUFJLENBQUMsVUFBVSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN0QyxDQUFDO0lBQ0QsU0FBUyxZQUFZLENBQUMsVUFBVSxFQUFFLFNBQVMsRUFBRTtJQUM3QyxJQUFJLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxVQUFVLENBQUMsTUFBTSxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUU7SUFDbkQsUUFBUSxJQUFJLFVBQVUsQ0FBQyxDQUFDLENBQUM7SUFDekIsWUFBWSxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDO0lBQ3ZDLEtBQUs7SUFDTCxDQUFDO0lBQ0QsU0FBUyxPQUFPLENBQUMsSUFBSSxFQUFFO0lBQ3ZCLElBQUksT0FBTyxRQUFRLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3hDLENBQUM7QUFDRCxJQWtCQSxTQUFTLElBQUksQ0FBQyxJQUFJLEVBQUU7SUFDcEIsSUFBSSxPQUFPLFFBQVEsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDekMsQ0FBQztJQUNELFNBQVMsS0FBSyxHQUFHO0lBQ2pCLElBQUksT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDckIsQ0FBQztJQUNELFNBQVMsS0FBSyxHQUFHO0lBQ2pCLElBQUksT0FBTyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDcEIsQ0FBQztJQUNELFNBQVMsTUFBTSxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRTtJQUMvQyxJQUFJLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQ25ELElBQUksT0FBTyxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQ25FLENBQUM7QUFDRCxJQXFCQSxTQUFTLElBQUksQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRTtJQUN0QyxJQUFJLElBQUksS0FBSyxJQUFJLElBQUk7SUFDckIsUUFBUSxJQUFJLENBQUMsZUFBZSxDQUFDLFNBQVMsQ0FBQyxDQUFDO0lBQ3hDLFNBQVMsSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEtBQUs7SUFDbkQsUUFBUSxJQUFJLENBQUMsWUFBWSxDQUFDLFNBQVMsRUFBRSxLQUFLLENBQUMsQ0FBQztJQUM1QyxDQUFDO0FBQ0QsSUE2Q0EsU0FBUyxTQUFTLENBQUMsS0FBSyxFQUFFO0lBQzFCLElBQUksT0FBTyxLQUFLLEtBQUssRUFBRSxHQUFHLFNBQVMsR0FBRyxDQUFDLEtBQUssQ0FBQztJQUM3QyxDQUFDO0FBQ0QsSUFPQSxTQUFTLFFBQVEsQ0FBQyxPQUFPLEVBQUU7SUFDM0IsSUFBSSxPQUFPLEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQzFDLENBQUM7QUFDRCxJQWdDQSxTQUFTLFFBQVEsQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFO0lBQzlCLElBQUksSUFBSSxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUM7SUFDckIsSUFBSSxJQUFJLElBQUksQ0FBQyxJQUFJLEtBQUssSUFBSTtJQUMxQixRQUFRLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDO0lBQ3pCLENBQUM7SUFDRCxTQUFTLGVBQWUsQ0FBQyxLQUFLLEVBQUUsS0FBSyxFQUFFO0lBQ3ZDLElBQUksS0FBSyxDQUFDLEtBQUssR0FBRyxLQUFLLElBQUksSUFBSSxHQUFHLEVBQUUsR0FBRyxLQUFLLENBQUM7SUFDN0MsQ0FBQztBQUNELElBdUZBLFNBQVMsWUFBWSxDQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFO0lBQzdDLElBQUksT0FBTyxDQUFDLFNBQVMsQ0FBQyxNQUFNLEdBQUcsS0FBSyxHQUFHLFFBQVEsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3ZELENBQUM7QUFDRCxBQXlLQTtJQUNBLElBQUksaUJBQWlCLENBQUM7SUFDdEIsU0FBUyxxQkFBcUIsQ0FBQyxTQUFTLEVBQUU7SUFDMUMsSUFBSSxpQkFBaUIsR0FBRyxTQUFTLENBQUM7SUFDbEMsQ0FBQztJQUNELFNBQVMscUJBQXFCLEdBQUc7SUFDakMsSUFBSSxJQUFJLENBQUMsaUJBQWlCO0lBQzFCLFFBQVEsTUFBTSxJQUFJLEtBQUssQ0FBQyxDQUFDLGdEQUFnRCxDQUFDLENBQUMsQ0FBQztJQUM1RSxJQUFJLE9BQU8saUJBQWlCLENBQUM7SUFDN0IsQ0FBQztBQUNELElBR0EsU0FBUyxPQUFPLENBQUMsRUFBRSxFQUFFO0lBQ3JCLElBQUkscUJBQXFCLEVBQUUsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUNqRCxDQUFDO0FBQ0QsQUFtQ0E7SUFDQSxNQUFNLGdCQUFnQixHQUFHLEVBQUUsQ0FBQztBQUM1QixJQUNBLE1BQU0saUJBQWlCLEdBQUcsRUFBRSxDQUFDO0lBQzdCLE1BQU0sZ0JBQWdCLEdBQUcsRUFBRSxDQUFDO0lBQzVCLE1BQU0sZUFBZSxHQUFHLEVBQUUsQ0FBQztJQUMzQixNQUFNLGdCQUFnQixHQUFHLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztJQUMzQyxJQUFJLGdCQUFnQixHQUFHLEtBQUssQ0FBQztJQUM3QixTQUFTLGVBQWUsR0FBRztJQUMzQixJQUFJLElBQUksQ0FBQyxnQkFBZ0IsRUFBRTtJQUMzQixRQUFRLGdCQUFnQixHQUFHLElBQUksQ0FBQztJQUNoQyxRQUFRLGdCQUFnQixDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUNyQyxLQUFLO0lBQ0wsQ0FBQztBQUNELElBSUEsU0FBUyxtQkFBbUIsQ0FBQyxFQUFFLEVBQUU7SUFDakMsSUFBSSxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDOUIsQ0FBQztBQUNELElBR0EsSUFBSSxRQUFRLEdBQUcsS0FBSyxDQUFDO0lBQ3JCLE1BQU0sY0FBYyxHQUFHLElBQUksR0FBRyxFQUFFLENBQUM7SUFDakMsU0FBUyxLQUFLLEdBQUc7SUFDakIsSUFBSSxJQUFJLFFBQVE7SUFDaEIsUUFBUSxPQUFPO0lBQ2YsSUFBSSxRQUFRLEdBQUcsSUFBSSxDQUFDO0lBQ3BCLElBQUksR0FBRztJQUNQO0lBQ0E7SUFDQSxRQUFRLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxnQkFBZ0IsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxJQUFJLENBQUMsRUFBRTtJQUM3RCxZQUFZLE1BQU0sU0FBUyxHQUFHLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ2xELFlBQVkscUJBQXFCLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDN0MsWUFBWSxNQUFNLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ2pDLFNBQVM7SUFDVCxRQUFRLGdCQUFnQixDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUM7SUFDcEMsUUFBUSxPQUFPLGlCQUFpQixDQUFDLE1BQU07SUFDdkMsWUFBWSxpQkFBaUIsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDO0lBQ3RDO0lBQ0E7SUFDQTtJQUNBLFFBQVEsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLGdCQUFnQixDQUFDLE1BQU0sRUFBRSxDQUFDLElBQUksQ0FBQyxFQUFFO0lBQzdELFlBQVksTUFBTSxRQUFRLEdBQUcsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDakQsWUFBWSxJQUFJLENBQUMsY0FBYyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsRUFBRTtJQUMvQztJQUNBLGdCQUFnQixjQUFjLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQzdDLGdCQUFnQixRQUFRLEVBQUUsQ0FBQztJQUMzQixhQUFhO0lBQ2IsU0FBUztJQUNULFFBQVEsZ0JBQWdCLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQztJQUNwQyxLQUFLLFFBQVEsZ0JBQWdCLENBQUMsTUFBTSxFQUFFO0lBQ3RDLElBQUksT0FBTyxlQUFlLENBQUMsTUFBTSxFQUFFO0lBQ25DLFFBQVEsZUFBZSxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUM7SUFDaEMsS0FBSztJQUNMLElBQUksZ0JBQWdCLEdBQUcsS0FBSyxDQUFDO0lBQzdCLElBQUksUUFBUSxHQUFHLEtBQUssQ0FBQztJQUNyQixJQUFJLGNBQWMsQ0FBQyxLQUFLLEVBQUUsQ0FBQztJQUMzQixDQUFDO0lBQ0QsU0FBUyxNQUFNLENBQUMsRUFBRSxFQUFFO0lBQ3BCLElBQUksSUFBSSxFQUFFLENBQUMsUUFBUSxLQUFLLElBQUksRUFBRTtJQUM5QixRQUFRLEVBQUUsQ0FBQyxNQUFNLEVBQUUsQ0FBQztJQUNwQixRQUFRLE9BQU8sQ0FBQyxFQUFFLENBQUMsYUFBYSxDQUFDLENBQUM7SUFDbEMsUUFBUSxNQUFNLEtBQUssR0FBRyxFQUFFLENBQUMsS0FBSyxDQUFDO0lBQy9CLFFBQVEsRUFBRSxDQUFDLEtBQUssR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDeEIsUUFBUSxFQUFFLENBQUMsUUFBUSxJQUFJLEVBQUUsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDcEQsUUFBUSxFQUFFLENBQUMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO0lBQ3JELEtBQUs7SUFDTCxDQUFDO0FBQ0QsSUFjQSxNQUFNLFFBQVEsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQzNCLElBQUksTUFBTSxDQUFDO0lBQ1gsU0FBUyxZQUFZLEdBQUc7SUFDeEIsSUFBSSxNQUFNLEdBQUc7SUFDYixRQUFRLENBQUMsRUFBRSxDQUFDO0lBQ1osUUFBUSxDQUFDLEVBQUUsRUFBRTtJQUNiLFFBQVEsQ0FBQyxFQUFFLE1BQU07SUFDakIsS0FBSyxDQUFDO0lBQ04sQ0FBQztJQUNELFNBQVMsWUFBWSxHQUFHO0lBQ3hCLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEVBQUU7SUFDbkIsUUFBUSxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQzFCLEtBQUs7SUFDTCxJQUFJLE1BQU0sR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDO0lBQ3RCLENBQUM7SUFDRCxTQUFTLGFBQWEsQ0FBQyxLQUFLLEVBQUUsS0FBSyxFQUFFO0lBQ3JDLElBQUksSUFBSSxLQUFLLElBQUksS0FBSyxDQUFDLENBQUMsRUFBRTtJQUMxQixRQUFRLFFBQVEsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDL0IsUUFBUSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ3ZCLEtBQUs7SUFDTCxDQUFDO0lBQ0QsU0FBUyxjQUFjLENBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFO0lBQ3hELElBQUksSUFBSSxLQUFLLElBQUksS0FBSyxDQUFDLENBQUMsRUFBRTtJQUMxQixRQUFRLElBQUksUUFBUSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUM7SUFDL0IsWUFBWSxPQUFPO0lBQ25CLFFBQVEsUUFBUSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUM1QixRQUFRLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU07SUFDNUIsWUFBWSxRQUFRLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ25DLFlBQVksSUFBSSxRQUFRLEVBQUU7SUFDMUIsZ0JBQWdCLElBQUksTUFBTTtJQUMxQixvQkFBb0IsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUMvQixnQkFBZ0IsUUFBUSxFQUFFLENBQUM7SUFDM0IsYUFBYTtJQUNiLFNBQVMsQ0FBQyxDQUFDO0lBQ1gsUUFBUSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ3ZCLEtBQUs7SUFDTCxDQUFDO0FBQ0QsQUFnT0E7SUFDQSxTQUFTLGNBQWMsQ0FBQyxPQUFPLEVBQUUsSUFBSSxFQUFFO0lBQ3ZDLElBQUksTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssR0FBRyxFQUFFLENBQUM7SUFDbEMsSUFBSSxTQUFTLE1BQU0sQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEdBQUcsRUFBRSxLQUFLLEVBQUU7SUFDN0MsUUFBUSxJQUFJLElBQUksQ0FBQyxLQUFLLEtBQUssS0FBSztJQUNoQyxZQUFZLE9BQU87SUFDbkIsUUFBUSxJQUFJLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQztJQUM5QixRQUFRLElBQUksU0FBUyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUM7SUFDakMsUUFBUSxJQUFJLEdBQUcsS0FBSyxTQUFTLEVBQUU7SUFDL0IsWUFBWSxTQUFTLEdBQUcsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFDO0lBQzFDLFlBQVksU0FBUyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQztJQUNuQyxTQUFTO0lBQ1QsUUFBUSxNQUFNLEtBQUssR0FBRyxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksRUFBRSxTQUFTLENBQUMsQ0FBQztJQUMvRCxRQUFRLElBQUksV0FBVyxHQUFHLEtBQUssQ0FBQztJQUNoQyxRQUFRLElBQUksSUFBSSxDQUFDLEtBQUssRUFBRTtJQUN4QixZQUFZLElBQUksSUFBSSxDQUFDLE1BQU0sRUFBRTtJQUM3QixnQkFBZ0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxLQUFLO0lBQ2xELG9CQUFvQixJQUFJLENBQUMsS0FBSyxLQUFLLElBQUksS0FBSyxFQUFFO0lBQzlDLHdCQUF3QixZQUFZLEVBQUUsQ0FBQztJQUN2Qyx3QkFBd0IsY0FBYyxDQUFDLEtBQUssRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLE1BQU07SUFDMUQsNEJBQTRCLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDO0lBQ2xELHlCQUF5QixDQUFDLENBQUM7SUFDM0Isd0JBQXdCLFlBQVksRUFBRSxDQUFDO0lBQ3ZDLHFCQUFxQjtJQUNyQixpQkFBaUIsQ0FBQyxDQUFDO0lBQ25CLGFBQWE7SUFDYixpQkFBaUI7SUFDakIsZ0JBQWdCLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ2hDLGFBQWE7SUFDYixZQUFZLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQztJQUN0QixZQUFZLGFBQWEsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDcEMsWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDL0MsWUFBWSxXQUFXLEdBQUcsSUFBSSxDQUFDO0lBQy9CLFNBQVM7SUFDVCxRQUFRLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDO0lBQzNCLFFBQVEsSUFBSSxJQUFJLENBQUMsTUFBTTtJQUN2QixZQUFZLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsS0FBSyxDQUFDO0lBQ3ZDLFFBQVEsSUFBSSxXQUFXLEVBQUU7SUFDekIsWUFBWSxLQUFLLEVBQUUsQ0FBQztJQUNwQixTQUFTO0lBQ1QsS0FBSztJQUNMLElBQUksSUFBSSxVQUFVLENBQUMsT0FBTyxDQUFDLEVBQUU7SUFDN0IsUUFBUSxNQUFNLGlCQUFpQixHQUFHLHFCQUFxQixFQUFFLENBQUM7SUFDMUQsUUFBUSxPQUFPLENBQUMsSUFBSSxDQUFDLEtBQUssSUFBSTtJQUM5QixZQUFZLHFCQUFxQixDQUFDLGlCQUFpQixDQUFDLENBQUM7SUFDckQsWUFBWSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDLEVBQUUsSUFBSSxDQUFDLEtBQUssRUFBRSxLQUFLLENBQUMsQ0FBQztJQUNwRCxZQUFZLHFCQUFxQixDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3hDLFNBQVMsRUFBRSxLQUFLLElBQUk7SUFDcEIsWUFBWSxxQkFBcUIsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0lBQ3JELFlBQVksTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQyxFQUFFLElBQUksQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDckQsWUFBWSxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN4QyxTQUFTLENBQUMsQ0FBQztJQUNYO0lBQ0EsUUFBUSxJQUFJLElBQUksQ0FBQyxPQUFPLEtBQUssSUFBSSxDQUFDLE9BQU8sRUFBRTtJQUMzQyxZQUFZLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQyxDQUFDO0lBQ3BDLFlBQVksT0FBTyxJQUFJLENBQUM7SUFDeEIsU0FBUztJQUNULEtBQUs7SUFDTCxTQUFTO0lBQ1QsUUFBUSxJQUFJLElBQUksQ0FBQyxPQUFPLEtBQUssSUFBSSxDQUFDLElBQUksRUFBRTtJQUN4QyxZQUFZLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUMsRUFBRSxJQUFJLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQ3RELFlBQVksT0FBTyxJQUFJLENBQUM7SUFDeEIsU0FBUztJQUNULFFBQVEsSUFBSSxDQUFDLFFBQVEsR0FBRyxPQUFPLENBQUM7SUFDaEMsS0FBSztJQUNMLENBQUM7QUFDRCxJQXdTQSxTQUFTLGVBQWUsQ0FBQyxTQUFTLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRTtJQUNwRCxJQUFJLE1BQU0sRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLFVBQVUsRUFBRSxZQUFZLEVBQUUsR0FBRyxTQUFTLENBQUMsRUFBRSxDQUFDO0lBQzFFLElBQUksUUFBUSxJQUFJLFFBQVEsQ0FBQyxDQUFDLENBQUMsTUFBTSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQzNDO0lBQ0EsSUFBSSxtQkFBbUIsQ0FBQyxNQUFNO0lBQzlCLFFBQVEsTUFBTSxjQUFjLEdBQUcsUUFBUSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLENBQUM7SUFDckUsUUFBUSxJQUFJLFVBQVUsRUFBRTtJQUN4QixZQUFZLFVBQVUsQ0FBQyxJQUFJLENBQUMsR0FBRyxjQUFjLENBQUMsQ0FBQztJQUMvQyxTQUFTO0lBQ1QsYUFBYTtJQUNiO0lBQ0E7SUFDQSxZQUFZLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQztJQUNwQyxTQUFTO0lBQ1QsUUFBUSxTQUFTLENBQUMsRUFBRSxDQUFDLFFBQVEsR0FBRyxFQUFFLENBQUM7SUFDbkMsS0FBSyxDQUFDLENBQUM7SUFDUCxJQUFJLFlBQVksQ0FBQyxPQUFPLENBQUMsbUJBQW1CLENBQUMsQ0FBQztJQUM5QyxDQUFDO0lBQ0QsU0FBUyxpQkFBaUIsQ0FBQyxTQUFTLEVBQUUsU0FBUyxFQUFFO0lBQ2pELElBQUksTUFBTSxFQUFFLEdBQUcsU0FBUyxDQUFDLEVBQUUsQ0FBQztJQUM1QixJQUFJLElBQUksRUFBRSxDQUFDLFFBQVEsS0FBSyxJQUFJLEVBQUU7SUFDOUIsUUFBUSxPQUFPLENBQUMsRUFBRSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQy9CLFFBQVEsRUFBRSxDQUFDLFFBQVEsSUFBSSxFQUFFLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUNoRDtJQUNBO0lBQ0EsUUFBUSxFQUFFLENBQUMsVUFBVSxHQUFHLEVBQUUsQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFDO0lBQzNDLFFBQVEsRUFBRSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUM7SUFDcEIsS0FBSztJQUNMLENBQUM7SUFDRCxTQUFTLFVBQVUsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxFQUFFO0lBQ2xDLElBQUksSUFBSSxTQUFTLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRTtJQUN0QyxRQUFRLGdCQUFnQixDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUN6QyxRQUFRLGVBQWUsRUFBRSxDQUFDO0lBQzFCLFFBQVEsU0FBUyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ25DLEtBQUs7SUFDTCxJQUFJLFNBQVMsQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDeEQsQ0FBQztJQUNELFNBQVMsSUFBSSxDQUFDLFNBQVMsRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLGVBQWUsRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLEtBQUssR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUU7SUFDN0YsSUFBSSxNQUFNLGdCQUFnQixHQUFHLGlCQUFpQixDQUFDO0lBQy9DLElBQUkscUJBQXFCLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDckMsSUFBSSxNQUFNLFdBQVcsR0FBRyxPQUFPLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FBQztJQUM1QyxJQUFJLE1BQU0sRUFBRSxHQUFHLFNBQVMsQ0FBQyxFQUFFLEdBQUc7SUFDOUIsUUFBUSxRQUFRLEVBQUUsSUFBSTtJQUN0QixRQUFRLEdBQUcsRUFBRSxJQUFJO0lBQ2pCO0lBQ0EsUUFBUSxLQUFLO0lBQ2IsUUFBUSxNQUFNLEVBQUUsSUFBSTtJQUNwQixRQUFRLFNBQVM7SUFDakIsUUFBUSxLQUFLLEVBQUUsWUFBWSxFQUFFO0lBQzdCO0lBQ0EsUUFBUSxRQUFRLEVBQUUsRUFBRTtJQUNwQixRQUFRLFVBQVUsRUFBRSxFQUFFO0lBQ3RCLFFBQVEsYUFBYSxFQUFFLEVBQUU7SUFDekIsUUFBUSxZQUFZLEVBQUUsRUFBRTtJQUN4QixRQUFRLE9BQU8sRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsR0FBRyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQztJQUM3RTtJQUNBLFFBQVEsU0FBUyxFQUFFLFlBQVksRUFBRTtJQUNqQyxRQUFRLEtBQUs7SUFDYixLQUFLLENBQUM7SUFDTixJQUFJLElBQUksS0FBSyxHQUFHLEtBQUssQ0FBQztJQUN0QixJQUFJLEVBQUUsQ0FBQyxHQUFHLEdBQUcsUUFBUTtJQUNyQixVQUFVLFFBQVEsQ0FBQyxTQUFTLEVBQUUsV0FBVyxFQUFFLENBQUMsQ0FBQyxFQUFFLEdBQUcsRUFBRSxHQUFHLElBQUksS0FBSztJQUNoRSxZQUFZLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLEdBQUcsQ0FBQztJQUN0RCxZQUFZLElBQUksRUFBRSxDQUFDLEdBQUcsSUFBSSxTQUFTLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQyxFQUFFO0lBQ25FLGdCQUFnQixJQUFJLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO0lBQy9CLG9CQUFvQixFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ3ZDLGdCQUFnQixJQUFJLEtBQUs7SUFDekIsb0JBQW9CLFVBQVUsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDN0MsYUFBYTtJQUNiLFlBQVksT0FBTyxHQUFHLENBQUM7SUFDdkIsU0FBUyxDQUFDO0lBQ1YsVUFBVSxFQUFFLENBQUM7SUFDYixJQUFJLEVBQUUsQ0FBQyxNQUFNLEVBQUUsQ0FBQztJQUNoQixJQUFJLEtBQUssR0FBRyxJQUFJLENBQUM7SUFDakIsSUFBSSxPQUFPLENBQUMsRUFBRSxDQUFDLGFBQWEsQ0FBQyxDQUFDO0lBQzlCO0lBQ0EsSUFBSSxFQUFFLENBQUMsUUFBUSxHQUFHLGVBQWUsR0FBRyxlQUFlLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQztJQUNwRSxJQUFJLElBQUksT0FBTyxDQUFDLE1BQU0sRUFBRTtJQUN4QixRQUFRLElBQUksT0FBTyxDQUFDLE9BQU8sRUFBRTtJQUM3QixZQUFZLE1BQU0sS0FBSyxHQUFHLFFBQVEsQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDbkQ7SUFDQSxZQUFZLEVBQUUsQ0FBQyxRQUFRLElBQUksRUFBRSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDaEQsWUFBWSxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ2xDLFNBQVM7SUFDVCxhQUFhO0lBQ2I7SUFDQSxZQUFZLEVBQUUsQ0FBQyxRQUFRLElBQUksRUFBRSxDQUFDLFFBQVEsQ0FBQyxDQUFDLEVBQUUsQ0FBQztJQUMzQyxTQUFTO0lBQ1QsUUFBUSxJQUFJLE9BQU8sQ0FBQyxLQUFLO0lBQ3pCLFlBQVksYUFBYSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDakQsUUFBUSxlQUFlLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxNQUFNLEVBQUUsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ25FLFFBQVEsS0FBSyxFQUFFLENBQUM7SUFDaEIsS0FBSztJQUNMLElBQUkscUJBQXFCLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztJQUM1QyxDQUFDO0FBQ0QsSUFvQ0EsTUFBTSxlQUFlLENBQUM7SUFDdEIsSUFBSSxRQUFRLEdBQUc7SUFDZixRQUFRLGlCQUFpQixDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQztJQUNuQyxRQUFRLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFDO0lBQzdCLEtBQUs7SUFDTCxJQUFJLEdBQUcsQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFO0lBQ3hCLFFBQVEsTUFBTSxTQUFTLElBQUksSUFBSSxDQUFDLEVBQUUsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLEtBQUssSUFBSSxDQUFDLEVBQUUsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQztJQUN0RixRQUFRLFNBQVMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDakMsUUFBUSxPQUFPLE1BQU07SUFDckIsWUFBWSxNQUFNLEtBQUssR0FBRyxTQUFTLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ3RELFlBQVksSUFBSSxLQUFLLEtBQUssQ0FBQyxDQUFDO0lBQzVCLGdCQUFnQixTQUFTLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsQ0FBQztJQUMzQyxTQUFTLENBQUM7SUFDVixLQUFLO0lBQ0wsSUFBSSxJQUFJLEdBQUc7SUFDWDtJQUNBLEtBQUs7SUFDTCxDQUFDOztJQzErQ0Q7SUFDQTs7SUFFQSxTQUFTLE9BQU8sR0FBRztJQUNuQixFQUFFLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxLQUFLO0lBQzFDLElBQUksVUFBVSxDQUFDLE1BQU07SUFDckIsTUFBTSxPQUFPLEVBQUUsQ0FBQztJQUNoQixLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFDWCxHQUFHLENBQUMsQ0FBQztJQUNMLENBQUM7O0lBRUQsTUFBTSxZQUFZLENBQUM7O0lBRW5CLEVBQUUsV0FBVyxHQUFHO0lBQ2hCLElBQUksSUFBSSxDQUFDLE9BQU8sR0FBRyxFQUFFLENBQUM7SUFDdEIsR0FBRzs7SUFFSCxFQUFFLE1BQU0sVUFBVSxDQUFDLElBQUksRUFBRTtJQUN6QixJQUFJLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBRSxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDdEQsSUFBSSxNQUFNLE9BQU8sRUFBRSxDQUFDO0lBQ3BCO0lBQ0EsSUFBSSxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUMsQ0FBQztJQUMzQyxJQUFJLE1BQU0sTUFBTSxHQUFHLE1BQU0sS0FBSyxDQUFDLDZDQUE2QyxHQUFHLEtBQUssQ0FBQztJQUNyRixPQUFPLElBQUksQ0FBQyxRQUFRLElBQUksUUFBUSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDOztJQUV2RyxJQUFJLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEdBQUcsTUFBTSxDQUFDOztJQUVoQyxJQUFJLE9BQU8sTUFBTSxDQUFDO0lBQ2xCO0lBQ0E7SUFDQTtJQUNBO0lBQ0EsR0FBRzs7O0lBR0g7SUFDQTtJQUNBO0lBQ0E7SUFDQTtJQUNBO0lBQ0E7SUFDQSxFQUFFLE1BQU0sVUFBVSxDQUFDLFVBQVUsRUFBRSxNQUFNLEdBQUcsTUFBTSxFQUFFLEVBQUU7SUFDbEQ7O0lBRUEsSUFBSSxJQUFJLE1BQU0sR0FBRyxDQUFDLEdBQUcsVUFBVSxDQUFDLEtBQUssQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7SUFDcEUsSUFBSSxNQUFNLE9BQU8sR0FBRyxVQUFVLENBQUMsSUFBSSxFQUFFLENBQUMsT0FBTyxDQUFDLHVCQUF1QixFQUFFLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxlQUFlLEVBQUUsSUFBSSxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3hILElBQUksSUFBSSxDQUFDLE9BQU8sRUFBRSxPQUFPLEVBQUUsQ0FBQztJQUM1QixJQUFJLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxFQUFFO0lBQ25DLE1BQU0sSUFBSSxNQUFNLENBQUMsQ0FBQyxDQUFDLEtBQUssTUFBTSxFQUFFO0lBQ2hDLFFBQVEsTUFBTSxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ3pDLE9BQU87SUFDUCxLQUFLLE1BQU07SUFDWCxNQUFNLE9BQU8sQ0FBQyxLQUFLLEVBQUUsQ0FBQztJQUN0QixLQUFLOztJQUVMLElBQUksTUFBTSxHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDOztJQUV2RixJQUFJLElBQUksUUFBUSxHQUFHLENBQUMsQ0FBQzs7SUFFckIsSUFBSSxJQUFJLFFBQVEsR0FBRyxDQUFDLENBQUM7SUFDckI7SUFDQSxJQUFJLEtBQUssSUFBSSxJQUFJLElBQUksT0FBTyxFQUFFO0lBQzlCLE1BQU0sSUFBSSxDQUFDLElBQUksRUFBRSxTQUFTO0lBQzFCLE1BQU0sSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxFQUFFO0lBQzlCLFFBQVEsUUFBUSxFQUFFLENBQUM7SUFDbkIsUUFBUSxJQUFJLFFBQVEsR0FBRyxNQUFNLENBQUMsTUFBTSxFQUFFLFFBQVEsR0FBRyxDQUFDLENBQUM7SUFDbkQsUUFBUSxTQUFTO0lBQ2pCLE9BQU87SUFDUCxNQUFNLFFBQVEsRUFBRSxDQUFDO0lBQ2pCLE1BQU0sTUFBTSxJQUFJLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDLElBQUksQ0FBQztJQUN6QyxNQUFNLE1BQU0sQ0FBQyxRQUFRLEVBQUUsT0FBTyxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDO0lBQzNEOztJQUVBLE1BQU0sSUFBSSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO0lBQ3BFLE1BQU0sSUFBSSxLQUFLLENBQUMsS0FBSyxDQUFDLEVBQUU7SUFDeEIsUUFBUSxLQUFLLEdBQUcsQ0FBQyxDQUFDO0lBQ2xCLE9BQU87SUFDUCxNQUFNLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO0lBQ3BELE1BQU0sSUFBSSxDQUFDLElBQUksRUFBRSxTQUFTO0lBQzFCO0lBQ0EsTUFBTSxJQUFJLElBQUksR0FBRyxNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUM7O0lBRTdDLE1BQU0sSUFBSSxJQUFJLENBQUMsSUFBSTtJQUNuQixRQUFRLFVBQVUsR0FBRyxVQUFVLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDekQsTUFBTSxJQUFJLElBQUksQ0FBQyxJQUFJLElBQUksV0FBVyxFQUFFO0lBQ3BDLFFBQVEsSUFBSSxHQUFHLEVBQUUsVUFBVSxFQUFFLEVBQUUsRUFBRSxVQUFVLEVBQUUsRUFBRSxFQUFFLE1BQU0sRUFBRSxFQUFFLEdBQUcsRUFBRSxDQUFDLEVBQUUsRUFBRSxTQUFTLEVBQUUsRUFBRSxFQUFFLEdBQUcsRUFBRSxDQUFDLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxDQUFDO0lBQ2hILE9BQU87SUFDUCxNQUFNLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFO0lBQ3RCLFFBQVEsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssSUFBSSxLQUFLLENBQUM7SUFDbEMsT0FBTyxNQUFNO0lBQ2I7SUFDQSxRQUFRLElBQUksUUFBUSxHQUFHLEVBQUUsQ0FBQztJQUMxQixRQUFRLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFO0lBQzlCLFVBQVUsSUFBSSxJQUFJLENBQUMsVUFBVSxFQUFFO0lBQy9CLFlBQVksSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQztJQUM1RCxZQUFZLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDO0lBQ3RELFlBQVksUUFBUSxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsV0FBVyxJQUFJLEdBQUcsQ0FBQyxNQUFNLEdBQUcsRUFBRSxDQUFDO0lBQ2hFLFdBQVc7SUFDWCxVQUFVLE9BQU8sQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxDQUFDO0lBQ25DLFNBQVM7O0lBRVQsUUFBUSxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxXQUFXLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxNQUFNLEdBQUcsRUFBRSxDQUFDO0lBQ3RGLFFBQVEsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHO0lBQ3JCLFVBQVUsSUFBSTtJQUNkLFVBQVUsS0FBSztJQUNmLFVBQVUsR0FBRztJQUNiLFVBQVUsUUFBUTtJQUNsQixVQUFVLElBQUk7SUFDZCxTQUFTLENBQUM7SUFDVixPQUFPO0lBQ1AsS0FBSztJQUNMLElBQUksSUFBSSxTQUFTLEdBQUcsQ0FBQyxDQUFDO0lBQ3RCLElBQUksTUFBTSxlQUFlLEdBQUc7SUFDNUIsTUFBTSxJQUFJLEVBQUUsQ0FBQztJQUNiLE1BQU0sS0FBSyxFQUFFLENBQUM7SUFDZCxNQUFNLEdBQUcsRUFBRSxDQUFDO0lBQ1osTUFBTSxLQUFLLEVBQUUsQ0FBQztJQUNkLE1BQU0sS0FBSyxFQUFFLENBQUM7SUFDZCxNQUFNLFNBQVMsRUFBRSxDQUFDO0lBQ2xCLE1BQU0sT0FBTyxFQUFFLENBQUM7SUFDaEIsTUFBTSxHQUFHLEVBQUUsQ0FBQztJQUNaLEtBQUssQ0FBQztJQUNOLElBQUksTUFBTSxnQkFBZ0IsR0FBRyxFQUFFLENBQUM7SUFDaEM7O0lBRUEsSUFBSSxJQUFJLFlBQVksR0FBRyxDQUFDLENBQUM7SUFDekIsSUFBSSxJQUFJLFdBQVcsR0FBRyxDQUFDLENBQUM7SUFDeEI7SUFDQSxJQUFJLEtBQUssSUFBSSxLQUFLLElBQUksTUFBTSxFQUFFO0lBQzlCLE1BQU0sS0FBSyxDQUFDLEtBQUssR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM5QyxNQUFNLEtBQUssQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDOztJQUVqRixNQUFNLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQztJQUNwQixNQUFNLElBQUksSUFBSSxHQUFHLENBQUMsQ0FBQztJQUNuQixNQUFNLE1BQU0sUUFBUSxHQUFHO0lBQ3ZCLFFBQVEsSUFBSSxFQUFFLENBQUM7SUFDZixRQUFRLEtBQUssRUFBRSxDQUFDO0lBQ2hCLFFBQVEsR0FBRyxFQUFFLENBQUM7SUFDZCxRQUFRLEtBQUssRUFBRSxDQUFDO0lBQ2hCLFFBQVEsS0FBSyxFQUFFLENBQUM7SUFDaEIsUUFBUSxTQUFTLEVBQUUsQ0FBQztJQUNwQixRQUFRLE9BQU8sRUFBRSxDQUFDO0lBQ2xCLFFBQVEsR0FBRyxFQUFFLENBQUM7SUFDZCxPQUFPLENBQUM7SUFDUixNQUFNLE1BQU0sU0FBUyxHQUFHLEVBQUUsQ0FBQztJQUMzQixNQUFNLEtBQUssSUFBSSxJQUFJLElBQUksS0FBSyxDQUFDLEtBQUssRUFBRTtJQUNwQyxRQUFRLEtBQUssSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDOztJQUU1QixRQUFRLElBQUksSUFBSSxVQUFVLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUM7O0lBRW5FLFFBQVEsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLFdBQVcsRUFBRSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsRUFBRTtJQUNqRSxVQUFVLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQztJQUM1RixTQUFTLE1BQU07SUFDZixVQUFVLFNBQVMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDO0lBQ2xDLFNBQVM7SUFDVCxRQUFRLFFBQVEsQ0FBQyxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDO0lBQ2xGLFFBQVEsUUFBUSxDQUFDLEtBQUssSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUM7SUFDbkYsUUFBUSxRQUFRLENBQUMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQztJQUNqRixRQUFRLFFBQVEsQ0FBQyxLQUFLLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDO0lBQ25GLFFBQVEsUUFBUSxDQUFDLEtBQUssSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUM7SUFDbkYsUUFBUSxRQUFRLENBQUMsU0FBUyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQztJQUN2RixRQUFRLFFBQVEsQ0FBQyxPQUFPLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUM7SUFDdEcsUUFBUSxRQUFRLENBQUMsR0FBRyxHQUFHLFFBQVEsQ0FBQyxJQUFJLEdBQUcsUUFBUSxDQUFDLEtBQUssR0FBRyxRQUFRLENBQUMsR0FBRyxHQUFHLFFBQVEsQ0FBQyxLQUFLLEdBQUcsUUFBUSxDQUFDLEtBQUssR0FBRyxRQUFRLENBQUMsU0FBUyxHQUFHLFFBQVEsQ0FBQyxPQUFPLENBQUM7SUFDL0ksT0FBTztJQUNQLE1BQU0sV0FBVyxJQUFJLElBQUksQ0FBQztJQUMxQixNQUFNLFlBQVksSUFBSSxLQUFLLENBQUM7SUFDNUIsTUFBTSxLQUFLLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQztJQUMxQixNQUFNLEtBQUssQ0FBQyxJQUFJLEdBQUcsUUFBUSxDQUFDO0lBQzVCLE1BQU0sS0FBSyxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7O0lBRXhCLE1BQU0sS0FBSyxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUM7SUFDbEMsTUFBTSxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsU0FBUyxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtJQUNqRCxRQUFRLFNBQVMsQ0FB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
