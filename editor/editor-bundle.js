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

	function add_flush_callback(fn) {
		flush_callbacks.push(fn);
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

	function bind(component, name, callback) {
		if (component.$$.props.indexOf(name) === -1) return;
		component.$$.bound[name] = callback;
		callback(component.$$.ctx[name]);
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

	/* card.svelte generated by Svelte v3.0.0 */

	const file = "card.svelte";

	function add_css() {
		var style = element("style");
		style.id = 'svelte-k8kj6q-style';
		style.textContent = ".entry.svelte-k8kj6q{position:relative;padding:10px;flex-shrink:0}.card.svelte-k8kj6q{position:absolute;border:6px solid rgb(22, 22, 22);border-radius:10px;outline:0;box-shadow:0px 0px 10px black}\n/*# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FyZC5zdmVsdGUiLCJzb3VyY2VzIjpbImNhcmQuc3ZlbHRlIl0sInNvdXJjZXNDb250ZW50IjpbIjxzY3JpcHQ+XHJcbiAgZXhwb3J0IGxldCBjYXJkID0ge307XHJcblxyXG4gIGNvbnN0IENBUkRfUkFUSU8gPSAwLjcxNzY0NzA1ODgyO1xyXG4gIGxldCBfaGVpZ2h0ID0gMjUwO1xyXG4gIGxldCBfd2lkdGggPSBNYXRoLmZsb29yKF9oZWlnaHQgKiBDQVJEX1JBVElPKTtcclxuICBsZXQgaGVpZ2h0ID0gX2hlaWdodDtcclxuICBsZXQgd2lkdGggPSBfd2lkdGg7XHJcbjwvc2NyaXB0PlxyXG5cclxuPHN0eWxlPlxyXG4gIC5lbnRyeSB7XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgICBwYWRkaW5nOiAxMHB4O1xyXG4gICAgZmxleC1zaHJpbms6IDA7XHJcbiAgfVxyXG5cclxuICAuY2FyZCB7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICBib3JkZXI6IDZweCBzb2xpZCByZ2IoMjIsIDIyLCAyMik7XHJcbiAgICBib3JkZXItcmFkaXVzOiAxMHB4O1xyXG4gICAgb3V0bGluZTogMDtcclxuICAgIGJveC1zaGFkb3c6IDBweCAwcHggMTBweCBibGFjaztcclxuICB9XHJcbjwvc3R5bGU+XHJcblxyXG48ZGl2IGNsYXNzPVwiZW50cnlcIiBzdHlsZT17J3dpZHRoOicgKyB3aWR0aCArICdweDsgaGVpZ2h0OicgKyBoZWlnaHQgKyAncHg7J30+XHJcblxyXG4gIDxpbWdcclxuICAgIGNsYXNzPVwiY2FyZFwiXHJcbiAgICBzdHlsZT17J21hcmdpbi10b3A6IDBweCd9XHJcbiAgICBzcmM9e2NhcmQudXJsfVxyXG4gICAgYWx0PXtjYXJkLm5hbWV9XHJcbiAgICB7d2lkdGh9XHJcbiAgICB7aGVpZ2h0fSAvPlxyXG5cclxuPC9kaXY+XHJcbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFXRSxNQUFNLGNBQUMsQ0FBQyxBQUNOLFFBQVEsQ0FBRSxRQUFRLENBQ2xCLE9BQU8sQ0FBRSxJQUFJLENBQ2IsV0FBVyxDQUFFLENBQUMsQUFDaEIsQ0FBQyxBQUVELEtBQUssY0FBQyxDQUFDLEFBQ0wsUUFBUSxDQUFFLFFBQVEsQ0FDbEIsTUFBTSxDQUFFLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FDakMsYUFBYSxDQUFFLElBQUksQ0FDbkIsT0FBTyxDQUFFLENBQUMsQ0FDVixVQUFVLENBQUUsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxBQUNoQyxDQUFDIn0= */";
		append(document.head, style);
	}

	function create_fragment(ctx) {
		var div, img, img_src_value, img_alt_value, div_style_value;

		return {
			c: function create() {
				div = element("div");
				img = element("img");
				img.className = "card svelte-k8kj6q";
				img.style.cssText = 'margin-top: 0px';
				img.src = img_src_value = ctx.card.url;
				img.alt = img_alt_value = ctx.card.name;
				img.width = ctx.width;
				img.height = ctx.height;
				add_location(img, file, 28, 2, 557);
				div.className = "entry svelte-k8kj6q";
				div.style.cssText = div_style_value = 'width:' + ctx.width + 'px; height:' + ctx.height + 'px;';
				add_location(div, file, 26, 0, 474);
			},

			l: function claim(nodes) {
				throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
				append(div, img);
			},

			p: function update(changed, ctx) {
				if ((changed.card) && img_src_value !== (img_src_value = ctx.card.url)) {
					img.src = img_src_value;
				}

				if ((changed.card) && img_alt_value !== (img_alt_value = ctx.card.name)) {
					img.alt = img_alt_value;
				}
			},

			i: noop,
			o: noop,

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}
			}
		};
	}

	const CARD_RATIO = 0.71764705882;

	let _height = 250;

	function instance($$self, $$props, $$invalidate) {
		let { card = {} } = $$props;
	  let _width = Math.floor(_height * CARD_RATIO);
	  let height = _height;
	  let width = _width;

		$$self.$set = $$props => {
			if ('card' in $$props) $$invalidate('card', card = $$props.card);
		};

		return { card, height, width };
	}

	class Card extends SvelteComponentDev {
		constructor(options) {
			super(options);
			if (!document.getElementById("svelte-k8kj6q-style")) add_css();
			init(this, options, instance, create_fragment, safe_not_equal, ["card"]);

			const { ctx } = this.$$;
			const props = options.props || {};
			if (ctx.card === undefined && !('card' in props)) {
				console.warn("<Card> was created without expected prop 'card'");
			}
		}

		get card() {
			throw new Error("<Card>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
		}

		set card(value) {
			throw new Error("<Card>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
		}
	}
	Card.$compile = {"vars":[{"name":"card","export_name":"card","injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":true},{"name":"CARD_RATIO","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"_height","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":true},{"name":"_width","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":true},{"name":"height","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":true},{"name":"width","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":true}]};

	/* playtester.svelte generated by Svelte v3.0.0 */

	const file$1 = "playtester.svelte";

	function add_css$1() {
		var style = element("style");
		style.id = 'svelte-tq2ewn-style';
		style.textContent = ".all.svelte-tq2ewn{margin:20px}.next-draws.svelte-tq2ewn{margin-top:20px;font-size:25px}.group-content.svelte-tq2ewn{display:flex;flex-wrap:wrap;transition:height 500ms ease}button.svelte-tq2ewn{flex-shrink:0}\n/*# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGxheXRlc3Rlci5zdmVsdGUiLCJzb3VyY2VzIjpbInBsYXl0ZXN0ZXIuc3ZlbHRlIl0sInNvdXJjZXNDb250ZW50IjpbIjxzY3JpcHQ+XHJcbiAgaW1wb3J0IENhcmQgZnJvbSBcIi4vY2FyZC5zdmVsdGVcIjtcclxuXHJcbiAgZXhwb3J0IGxldCBwcm9taXNlO1xyXG4gIGV4cG9ydCBsZXQgcGxheVRlc3RlckFjdGl2ZTtcclxuICBmdW5jdGlvbiB0b2dnbGVQbGF5VGVzdCgpIHtcclxuICAgIHBsYXlUZXN0ZXJBY3RpdmUgPSBmYWxzZTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHNhbXBsZUhhbmQoKSB7XHJcbiAgICBwcm9taXNlID0gcHJvbWlzZTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHNodWZmbGUoYSkge1xyXG4gICAgdmFyIGosIHgsIGk7XHJcbiAgICBmb3IgKGkgPSBhLmxlbmd0aCAtIDE7IGkgPiAwOyBpLS0pIHtcclxuICAgICAgaiA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIChpICsgMSkpO1xyXG4gICAgICB4ID0gYVtpXTtcclxuICAgICAgYVtpXSA9IGFbal07XHJcbiAgICAgIGFbal0gPSB4O1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGE7XHJcbiAgfVxyXG5cclxuICBhc3luYyBmdW5jdGlvbiBjb21iaW5lKGdyb3Vwcykge1xyXG4gICAgbGV0IHJlc3VsdCA9IFtdO1xyXG5cclxuICAgIGZvciAobGV0IGdyb3VwIG9mIGdyb3Vwcykge1xyXG4gICAgICBpZiAoZ3JvdXAubmFtZS5pbmNsdWRlcyhcIm1heWJlXCIpKSBjb250aW51ZTtcclxuICAgICAgaWYgKGdyb3VwLm5hbWUuaW5jbHVkZXMoXCJjb21tYW5kZXJcIikpIGNvbnRpbnVlO1xyXG5cclxuICAgICAgZm9yIChsZXQgY2FyZCBvZiBncm91cC5jYXJkcykge1xyXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY2FyZC5jb3VudDsgaSsrKSB7XHJcbiAgICAgICAgICByZXN1bHQucHVzaChjYXJkKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXN1bHQgPSBzaHVmZmxlKHJlc3VsdCk7IC8vLnNwbGljZSgwLCAxNSk7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBoYW5kOiByZXN1bHQuc3BsaWNlKDAsIDcpLFxyXG4gICAgICBkcmF3czogcmVzdWx0LnNwbGljZSgwLCA3KVxyXG4gICAgfTtcclxuICB9XHJcbjwvc2NyaXB0PlxyXG5cclxuPHN0eWxlPlxyXG4gIC5hbGwge1xyXG4gICAgbWFyZ2luOiAyMHB4O1xyXG4gIH1cclxuICAubmV4dC1kcmF3cyB7XHJcbiAgICBtYXJnaW4tdG9wOiAyMHB4O1xyXG4gICAgZm9udC1zaXplOiAyNXB4O1xyXG4gIH1cclxuICAuZ3JvdXAtY29udGVudCB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC13cmFwOiB3cmFwO1xyXG4gICAgdHJhbnNpdGlvbjogaGVpZ2h0IDUwMG1zIGVhc2U7XHJcbiAgfVxyXG5cclxuICBidXR0b24ge1xyXG4gICAgZmxleC1zaHJpbms6IDA7XHJcbiAgfVxyXG48L3N0eWxlPlxyXG5cclxuPGJ1dHRvbiBvbjpjbGljaz17dG9nZ2xlUGxheVRlc3R9PmhpZGU8L2J1dHRvbj5cclxuXHJcbnsjYXdhaXQgcHJvbWlzZX1cclxuICA8ZGl2IGNsYXNzPVwibG9hZGluZy13cmFwcGVyXCI+ZGVjayBpcyBsb2FkaW5nPC9kaXY+XHJcbns6dGhlbiBncm91cHN9XHJcblxyXG4gIHsjYXdhaXQgY29tYmluZShncm91cHMpfVxyXG4gICAgPGRpdiBjbGFzcz1cImxvYWRpbmctd3JhcHBlclwiPmRlY2sgaXMgbG9hZGluZzwvZGl2PlxyXG4gIHs6dGhlbiBwbGF5fVxyXG4gICAgPGRpdiBjbGFzcz1cIm5leHQtZHJhd3NcIj5IYW5kOjwvZGl2PlxyXG4gICAgPGRpdiBjbGFzcz1cImFsbFwiPlxyXG4gICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtY29udGVudFwiPlxyXG4gICAgICAgIHsjZWFjaCBwbGF5LmhhbmQgYXMgY2FyZH1cclxuICAgICAgICAgIDxDYXJkIHtjYXJkfSAvPlxyXG4gICAgICAgIHsvZWFjaH1cclxuICAgICAgPC9kaXY+XHJcblxyXG4gICAgICA8ZGl2IGNsYXNzPVwibmV4dC1kcmF3c1wiPm5leHQgZHJhd3M6PC9kaXY+XHJcblxyXG4gICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtY29udGVudFwiPlxyXG4gICAgICAgIHsjZWFjaCBwbGF5LmRyYXdzIGFzIGNhcmR9XHJcbiAgICAgICAgICA8Q2FyZCB7Y2FyZH0gLz5cclxuICAgICAgICB7L2VhY2h9XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgPC9kaXY+XHJcbiAgICA8YnV0dG9uIG9uOmNsaWNrPXtzYW1wbGVIYW5kfT5uZXcgc2FtcGxlIGhhbmQ8L2J1dHRvbj5cclxuXHJcbiAgey9hd2FpdH1cclxuXHJcbns6Y2F0Y2ggZXJyb3J9XHJcblxyXG4gIDxkaXYgY2xhc3M9XCJlcnJvclwiPlxyXG4gICAgRVJST1IsIGNoZWNrIHlvdXIgZGVja2xpc3QgZm9yIGNvcnJlY3QgZm9ybWF0IG9yIGludGVybmV0IGNvbm5lY3Rpb24gYnJ1ZGlcclxuICA8L2Rpdj5cclxuey9hd2FpdH1cclxuIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQStDRSxJQUFJLGNBQUMsQ0FBQyxBQUNKLE1BQU0sQ0FBRSxJQUFJLEFBQ2QsQ0FBQyxBQUNELFdBQVcsY0FBQyxDQUFDLEFBQ1gsVUFBVSxDQUFFLElBQUksQ0FDaEIsU0FBUyxDQUFFLElBQUksQUFDakIsQ0FBQyxBQUNELGNBQWMsY0FBQyxDQUFDLEFBQ2QsT0FBTyxDQUFFLElBQUksQ0FDYixTQUFTLENBQUUsSUFBSSxDQUNmLFVBQVUsQ0FBRSxNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksQUFDL0IsQ0FBQyxBQUVELE1BQU0sY0FBQyxDQUFDLEFBQ04sV0FBVyxDQUFFLENBQUMsQUFDaEIsQ0FBQyJ9 */";
		append(document.head, style);
	}

	function get_each_context(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.card = list[i];
		return child_ctx;
	}

	function get_each_context_1(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.card = list[i];
		return child_ctx;
	}

	// (95:0) {:catch error}
	function create_catch_block_1(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "ERROR, check your decklist for correct format or internet connection brudi";
				div.className = "error";
				add_location(div, file$1, 96, 2, 1939);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
			},

			p: noop,
			i: noop,
			o: noop,

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}
			}
		};
	}

	// (70:0) {:then groups}
	function create_then_block(ctx) {
		var await_block_anchor, promise_1, current;

		let info = {
			ctx,
			current: null,
			pending: create_pending_block_1,
			then: create_then_block_1,
			catch: create_catch_block,
			value: 'play',
			error: 'null',
			blocks: Array(3)
		};

		handle_promise(promise_1 = combine(ctx.groups), info);

		return {
			c: function create() {
				await_block_anchor = empty();

				info.block.c();
			},

			m: function mount(target, anchor) {
				insert(target, await_block_anchor, anchor);

				info.block.m(target, info.anchor = anchor);
				info.mount = () => await_block_anchor.parentNode;
				info.anchor = await_block_anchor;

				current = true;
			},

			p: function update(changed, new_ctx) {
				ctx = new_ctx;
				info.ctx = ctx;

				if (('promise' in changed) && promise_1 !== (promise_1 = combine(ctx.groups)) && handle_promise(promise_1, info)) ; else {
					info.block.p(changed, assign(assign({}, ctx), info.resolved));
				}
			},

			i: function intro(local) {
				if (current) return;
				info.block.i();
				current = true;
			},

			o: function outro(local) {
				for (let i = 0; i < 3; i += 1) {
					const block = info.blocks[i];
					if (block) block.o();
				}

				current = false;
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(await_block_anchor);
				}

				info.block.d(detaching);
				info = null;
			}
		};
	}

	// (1:0) <script>    import Card from "./card.svelte";      export let promise;    export let playTesterActive;    function togglePlayTest() {      playTesterActive = false;    }
	function create_catch_block(ctx) {
		return {
			c: noop,
			m: noop,
			p: noop,
			i: noop,
			o: noop,
			d: noop
		};
	}

	// (74:2) {:then play}
	function create_then_block_1(ctx) {
		var div0, t1, div4, div1, t2, div2, t4, div3, t5, button, current, dispose;

		var each_value_1 = ctx.play.hand;

		var each_blocks_1 = [];

		for (var i = 0; i < each_value_1.length; i += 1) {
			each_blocks_1[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
		}

		function outro_block(i, detaching, local) {
			if (each_blocks_1[i]) {
				if (detaching) {
					on_outro(() => {
						each_blocks_1[i].d(detaching);
						each_blocks_1[i] = null;
					});
				}

				each_blocks_1[i].o(local);
			}
		}

		var each_value = ctx.play.draws;

		var each_blocks = [];

		for (var i = 0; i < each_value.length; i += 1) {
			each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
		}

		function outro_block_1(i, detaching, local) {
			if (each_blocks[i]) {
				if (detaching) {
					on_outro(() => {
						each_blocks[i].d(detaching);
						each_blocks[i] = null;
					});
				}

				each_blocks[i].o(local);
			}
		}

		return {
			c: function create() {
				div0 = element("div");
				div0.textContent = "Hand:";
				t1 = space();
				div4 = element("div");
				div1 = element("div");

				for (var i = 0; i < each_blocks_1.length; i += 1) {
					each_blocks_1[i].c();
				}

				t2 = space();
				div2 = element("div");
				div2.textContent = "next draws:";
				t4 = space();
				div3 = element("div");

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}

				t5 = space();
				button = element("button");
				button.textContent = "new sample hand";
				div0.className = "next-draws svelte-tq2ewn";
				add_location(div0, file$1, 74, 4, 1461);
				div1.className = "group-content svelte-tq2ewn";
				add_location(div1, file$1, 76, 6, 1527);
				div2.className = "next-draws svelte-tq2ewn";
				add_location(div2, file$1, 82, 6, 1657);
				div3.className = "group-content svelte-tq2ewn";
				add_location(div3, file$1, 84, 6, 1708);
				div4.className = "all svelte-tq2ewn";
				add_location(div4, file$1, 75, 4, 1502);
				button.className = "svelte-tq2ewn";
				add_location(button, file$1, 90, 4, 1847);
				dispose = listen(button, "click", ctx.sampleHand);
			},

			m: function mount(target, anchor) {
				insert(target, div0, anchor);
				insert(target, t1, anchor);
				insert(target, div4, anchor);
				append(div4, div1);

				for (var i = 0; i < each_blocks_1.length; i += 1) {
					each_blocks_1[i].m(div1, null);
				}

				append(div4, t2);
				append(div4, div2);
				append(div4, t4);
				append(div4, div3);

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(div3, null);
				}

				insert(target, t5, anchor);
				insert(target, button, anchor);
				current = true;
			},

			p: function update(changed, ctx) {
				if (changed.combine || changed.promise) {
					each_value_1 = ctx.play.hand;

					for (var i = 0; i < each_value_1.length; i += 1) {
						const child_ctx = get_each_context_1(ctx, each_value_1, i);

						if (each_blocks_1[i]) {
							each_blocks_1[i].p(changed, child_ctx);
							each_blocks_1[i].i(1);
						} else {
							each_blocks_1[i] = create_each_block_1(child_ctx);
							each_blocks_1[i].c();
							each_blocks_1[i].i(1);
							each_blocks_1[i].m(div1, null);
						}
					}

					group_outros();
					for (; i < each_blocks_1.length; i += 1) outro_block(i, 1, 1);
					check_outros();
				}

				if (changed.combine || changed.promise) {
					each_value = ctx.play.draws;

					for (var i = 0; i < each_value.length; i += 1) {
						const child_ctx = get_each_context(ctx, each_value, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
							each_blocks[i].i(1);
						} else {
							each_blocks[i] = create_each_block(child_ctx);
							each_blocks[i].c();
							each_blocks[i].i(1);
							each_blocks[i].m(div3, null);
						}
					}

					group_outros();
					for (; i < each_blocks.length; i += 1) outro_block_1(i, 1, 1);
					check_outros();
				}
			},

			i: function intro(local) {
				if (current) return;
				for (var i = 0; i < each_value_1.length; i += 1) each_blocks_1[i].i();

				for (var i = 0; i < each_value.length; i += 1) each_blocks[i].i();

				current = true;
			},

			o: function outro(local) {
				each_blocks_1 = each_blocks_1.filter(Boolean);
				for (let i = 0; i < each_blocks_1.length; i += 1) outro_block(i, 0);

				each_blocks = each_blocks.filter(Boolean);
				for (let i = 0; i < each_blocks.length; i += 1) outro_block_1(i, 0);

				current = false;
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div0);
					detach(t1);
					detach(div4);
				}

				destroy_each(each_blocks_1, detaching);

				destroy_each(each_blocks, detaching);

				if (detaching) {
					detach(t5);
					detach(button);
				}

				dispose();
			}
		};
	}

	// (78:8) {#each play.hand as card}
	function create_each_block_1(ctx) {
		var current;

		var card = new Card({
			props: { card: ctx.card },
			$$inline: true
		});

		return {
			c: function create() {
				card.$$.fragment.c();
			},

			m: function mount(target, anchor) {
				mount_component(card, target, anchor);
				current = true;
			},

			p: function update(changed, ctx) {
				var card_changes = {};
				if (changed.combine || changed.promise) card_changes.card = ctx.card;
				card.$set(card_changes);
			},

			i: function intro(local) {
				if (current) return;
				card.$$.fragment.i(local);

				current = true;
			},

			o: function outro(local) {
				card.$$.fragment.o(local);
				current = false;
			},

			d: function destroy(detaching) {
				card.$destroy(detaching);
			}
		};
	}

	// (86:8) {#each play.draws as card}
	function create_each_block(ctx) {
		var current;

		var card = new Card({
			props: { card: ctx.card },
			$$inline: true
		});

		return {
			c: function create() {
				card.$$.fragment.c();
			},

			m: function mount(target, anchor) {
				mount_component(card, target, anchor);
				current = true;
			},

			p: function update(changed, ctx) {
				var card_changes = {};
				if (changed.combine || changed.promise) card_changes.card = ctx.card;
				card.$set(card_changes);
			},

			i: function intro(local) {
				if (current) return;
				card.$$.fragment.i(local);

				current = true;
			},

			o: function outro(local) {
				card.$$.fragment.o(local);
				current = false;
			},

			d: function destroy(detaching) {
				card.$destroy(detaching);
			}
		};
	}

	// (72:26)       <div class="loading-wrapper">deck is loading</div>    {:then play}
	function create_pending_block_1(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "deck is loading";
				div.className = "loading-wrapper";
				add_location(div, file$1, 72, 4, 1389);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
			},

			p: noop,
			i: noop,
			o: noop,

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}
			}
		};
	}

	// (68:16)     <div class="loading-wrapper">deck is loading</div>  {:then groups}
	function create_pending_block(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "deck is loading";
				div.className = "loading-wrapper";
				add_location(div, file$1, 68, 2, 1287);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
			},

			p: noop,
			i: noop,
			o: noop,

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}
			}
		};
	}

	function create_fragment$1(ctx) {
		var button, t_1, await_block_anchor, promise_1, current, dispose;

		let info = {
			ctx,
			current: null,
			pending: create_pending_block,
			then: create_then_block,
			catch: create_catch_block_1,
			value: 'groups',
			error: 'error',
			blocks: Array(3)
		};

		handle_promise(promise_1 = ctx.promise, info);

		return {
			c: function create() {
				button = element("button");
				button.textContent = "hide";
				t_1 = space();
				await_block_anchor = empty();

				info.block.c();
				button.className = "svelte-tq2ewn";
				add_location(button, file$1, 65, 0, 1216);
				dispose = listen(button, "click", ctx.togglePlayTest);
			},

			l: function claim(nodes) {
				throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
			},

			m: function mount(target, anchor) {
				insert(target, button, anchor);
				insert(target, t_1, anchor);
				insert(target, await_block_anchor, anchor);

				info.block.m(target, info.anchor = anchor);
				info.mount = () => await_block_anchor.parentNode;
				info.anchor = await_block_anchor;

				current = true;
			},

			p: function update(changed, new_ctx) {
				ctx = new_ctx;
				info.ctx = ctx;

				if (('promise' in changed) && promise_1 !== (promise_1 = ctx.promise) && handle_promise(promise_1, info)) ; else {
					info.block.p(changed, assign(assign({}, ctx), info.resolved));
				}
			},

			i: function intro(local) {
				if (current) return;
				info.block.i();
				current = true;
			},

			o: function outro(local) {
				for (let i = 0; i < 3; i += 1) {
					const block = info.blocks[i];
					if (block) block.o();
				}

				current = false;
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(button);
					detach(t_1);
					detach(await_block_anchor);
				}

				info.block.d(detaching);
				info = null;

				dispose();
			}
		};
	}

	function shuffle(a) {
	  var j, x, i;
	  for (i = a.length - 1; i > 0; i--) {
	    j = Math.floor(Math.random() * (i + 1));
	    x = a[i];
	    a[i] = a[j];
	    a[j] = x;
	  }
	  return a;
	}

	async function combine(groups) {
	  let result = [];

	  for (let group of groups) {
	    if (group.name.includes("maybe")) continue;
	    if (group.name.includes("commander")) continue;

	    for (let card of group.cards) {
	      for (let i = 0; i < card.count; i++) {
	        result.push(card);
	      }
	    }
	  }

	  result = shuffle(result); //.splice(0, 15);
	  return {
	    hand: result.splice(0, 7),
	    draws: result.splice(0, 7)
	  };
	}

	function instance$1($$self, $$props, $$invalidate) {
		let { promise, playTesterActive } = $$props;
	  function togglePlayTest() {
	    $$invalidate('playTesterActive', playTesterActive = false);
	  }

	  function sampleHand() {
	    $$invalidate('promise', promise);
	  }

		$$self.$set = $$props => {
			if ('promise' in $$props) $$invalidate('promise', promise = $$props.promise);
			if ('playTesterActive' in $$props) $$invalidate('playTesterActive', playTesterActive = $$props.playTesterActive);
		};

		return {
			promise,
			playTesterActive,
			togglePlayTest,
			sampleHand
		};
	}

	class Playtester extends SvelteComponentDev {
		constructor(options) {
			super(options);
			if (!document.getElementById("svelte-tq2ewn-style")) add_css$1();
			init(this, options, instance$1, create_fragment$1, safe_not_equal, ["promise", "playTesterActive"]);

			const { ctx } = this.$$;
			const props = options.props || {};
			if (ctx.promise === undefined && !('promise' in props)) {
				console.warn("<Playtester> was created without expected prop 'promise'");
			}
			if (ctx.playTesterActive === undefined && !('playTesterActive' in props)) {
				console.warn("<Playtester> was created without expected prop 'playTesterActive'");
			}
		}

		get promise() {
			throw new Error("<Playtester>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
		}

		set promise(value) {
			throw new Error("<Playtester>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
		}

		get playTesterActive() {
			throw new Error("<Playtester>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
		}

		set playTesterActive(value) {
			throw new Error("<Playtester>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
		}
	}
	Playtester.$compile = {"vars":[{"name":"Card","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"promise","export_name":"promise","injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"playTesterActive","export_name":"playTesterActive","injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":false,"writable":true},{"name":"togglePlayTest","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"sampleHand","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"shuffle","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"combine","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false}]};

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


	    // TODO: hypergeomatric distribution
	    // for (let group of groups) {
	    //   group.chances = hypergeometricDistribution(group.count, 11, 1, overallCount);
	    // }




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

	const file$2 = "editor.svelte";

	function add_css$2() {
		var style = element("style");
		style.id = 'svelte-h7vjvw-style';
		style.textContent = ".content.svelte-h7vjvw{--raisin-black:hsla(200, 8%, 15%, 1);--roman-silver:hsla(196, 15%, 60%, 1);--colorless:hsla(0, 0%, 89%, 1);--black:hsla(83, 8%, 38%, 1);--white:hsl(48, 64%, 89%);--red:hsla(0, 71%, 84%, 1);--green:hsla(114, 60%, 75%, 1);--blue:hsla(235, 55%, 81%, 1)}.content.svelte-h7vjvw{display:flex;flex-direction:row;width:100%;height:100%}.help-symbol.svelte-h7vjvw{border-radius:50%;border:1px solid black;width:16px;height:16px;text-align:center;position:absolute;right:10px;top:10px;cursor:pointer}.help-symbol.svelte-h7vjvw:hover{border-color:blue;color:blue}.toggle-search.svelte-h7vjvw{background:blue;width:30px;height:30px;cursor:pointer;position:absolute;left:-30px;top:50%;user-select:none}.hide.svelte-h7vjvw .toggle-search.svelte-h7vjvw{left:-52px}.statistics.svelte-h7vjvw{display:flex;flex-direction:column}.input.svelte-h7vjvw{width:100%;height:100%;box-sizing:border-box;padding:10px;resize:none}.controls.svelte-h7vjvw{flex-shrink:0;width:300px;height:100%;background:lightgray;display:flex;flex-direction:column}.help.svelte-h7vjvw{padding:0px 10px 10px 10px;user-select:none;position:relative}.group-content.svelte-h7vjvw{flex-grow:1;display:flex;flex-wrap:wrap;transition:height 500ms ease}.group-content.hidden.svelte-h7vjvw{overflow:hidden;height:45px}.all-type-count.svelte-h7vjvw{height:125px;overflow:auto;background:lightsteelblue;padding:10px}.type-selector.svelte-h7vjvw{cursor:pointer}.type-selector.svelte-h7vjvw:not(.highlighted-creature):hover{background:aliceblue}.highlighted-creature.svelte-h7vjvw{background:steelblue}.play-tester.svelte-h7vjvw{height:100%;flex-grow:1;background:white;display:flex;flex-direction:column;position:absolute;right:0;width:100%;z-index:150;box-shadow:0px 0px 10px black}.card-search.svelte-h7vjvw{height:100%;flex-grow:1;background:white;display:flex;flex-direction:column;position:absolute;right:0;width:33%;z-index:100;box-shadow:0px 0px 10px black}.card-search.hide.svelte-h7vjvw{right:-33%}.search-params.svelte-h7vjvw{flex-shrink:0;display:flex;flex-direction:column}.search-result.svelte-h7vjvw{height:100%;flex-grow:1;background:white;display:flex;flex-direction:row;overflow:auto;position:relative;user-select:none;flex-wrap:wrap}.display.svelte-h7vjvw{flex-grow:1;background:gray;display:flex;flex-direction:column;flex-wrap:nowrap;overflow:auto;position:relative;user-select:none}.loading-wrapper.svelte-h7vjvw{position:absolute;left:50%;top:0;bottom:0;display:flex;align-items:center}.entry.svelte-h7vjvw{position:relative;padding:10px;flex-shrink:0}.shoping.svelte-h7vjvw{position:absolute;z-index:10;font-size:3em;text-shadow:0px 0px 6px black;text-align:center;bottom:10%;right:10%;display:none}.entry.svelte-h7vjvw:hover .shoping.svelte-h7vjvw{display:block}.shoping.svelte-h7vjvw .link.svelte-h7vjvw{text-decoration:none}.shoping.svelte-h7vjvw .link.svelte-h7vjvw:hover{color:transparent;text-shadow:0 0 0 blue}.card.svelte-h7vjvw{position:absolute;border:6px solid rgb(22, 22, 22);border-radius:10px;outline:0;box-shadow:0px 0px 10px black}.card.banned.svelte-h7vjvw{border:6px solid red}.card.highlighted.svelte-h7vjvw{border:6px solid yellow}.card.type-highlight.svelte-h7vjvw{border:6px solid blueviolet}.card.svelte-h7vjvw:hover{border:6px solid blue;cursor:pointer}.card-context-menu.svelte-h7vjvw{position:absolute;z-index:100;background:rgba(255, 255, 255, 0.7);height:100%;width:100%;margin-left:-3px;margin-top:-3px;overflow:auto}.card-context-entry.svelte-h7vjvw{margin:10px;font-weight:bold;background:white;padding:5px;border-radius:9px;box-shadow:0 0 6px black;cursor:pointer}.card-context-entry.svelte-h7vjvw:hover{background:wheat}.price.svelte-h7vjvw,.banned-text.svelte-h7vjvw,.count.svelte-h7vjvw{font-size:34px;text-shadow:0px 0px 9px black;color:red;position:absolute;z-index:100;font-weight:bold;left:34px}.banned-text.svelte-h7vjvw{font-size:100%;text-shadow:0px 0px 9px black;color:red;position:absolute;z-index:100;font-weight:bold;left:17%}.count.svelte-h7vjvw{top:165px}.price.svelte-h7vjvw{bottom:7px;color:wheat;font-size:12px;background:black;left:45%;font-weight:normal}.group-header.svelte-h7vjvw{display:flex;background:darkgrey;margin:8px 0;box-shadow:0px 0px 8px black;width:100%;flex-direction:row}.group-header.svelte-h7vjvw h2.svelte-h7vjvw{padding:0 25px;margin:0px}.group-statistics.svelte-h7vjvw{display:flex;flex-direction:row}.mana-proposal.svelte-h7vjvw,.mana-devotion.svelte-h7vjvw{display:flex;flex-direction:row}.deck-value.svelte-h7vjvw,.group-value.svelte-h7vjvw{padding:5px;color:black;border-radius:50%;width:15px;height:15px;text-align:center;margin:5px;display:flex;text-align:center;align-items:center;font-size:11px;font-weight:bold}.blue.svelte-h7vjvw{background-color:var(--blue)}.black.svelte-h7vjvw{color:white;background-color:var(--black)}.red.svelte-h7vjvw{background-color:var(--red)}.white.svelte-h7vjvw{background-color:var(--white)}.green.svelte-h7vjvw{background-color:var(--green)}.colorless.svelte-h7vjvw{background-color:var(--colorless)}.sum.svelte-h7vjvw{background-color:goldenrod}.color-param.svelte-h7vjvw{display:flex;flex-direction:row}.mana-curve.svelte-h7vjvw{display:flex;flex-direction:column}.all-curves.svelte-h7vjvw{display:flex;flex-grow:1;flex-direction:row;height:80px}.all-labels.svelte-h7vjvw{display:flex;flex-shrink:0;flex-direction:row}.curve-element.svelte-h7vjvw{width:20px;display:flex;position:absolute;bottom:0;background:gray;align-items:center;height:100%}.curve-label.svelte-h7vjvw{width:20px}.curve-wrapper.svelte-h7vjvw{width:20px;position:relative;cursor:pointer}.curve-element.svelte-h7vjvw:hover{background:lightcoral}.highlighted.svelte-h7vjvw .curve-element.svelte-h7vjvw{background:lightblue}.curve-label.highlighted.svelte-h7vjvw{background:lightblue}.curve-label.svelte-h7vjvw:hover{background:lightcoral}h4.svelte-h7vjvw{margin-top:5px;margin-bottom:5px}.lds-ripple.svelte-h7vjvw{display:inline-block;position:relative;width:80px;height:80px}.lds-ripple.svelte-h7vjvw div.svelte-h7vjvw{position:absolute;border:4px solid #fff;opacity:1;border-radius:50%;animation:svelte-h7vjvw-lds-ripple 1s cubic-bezier(0, 0.2, 0.8, 1) infinite}.card-search.svelte-h7vjvw .lds-ripple div.svelte-h7vjvw{border:4px solid black}.lds-ripple.svelte-h7vjvw div.svelte-h7vjvw:nth-child(2){animation-delay:-0.5s}@keyframes svelte-h7vjvw-lds-ripple{0%{top:36px;left:36px;width:0;height:0;opacity:1}100%{top:0px;left:0px;width:72px;height:72px;opacity:0}}\n/*# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWRpdG9yLnN2ZWx0ZSIsInNvdXJjZXMiOlsiZWRpdG9yLnN2ZWx0ZSJdLCJzb3VyY2VzQ29udGVudCI6WyI8c2NyaXB0PlxyXG4gIGltcG9ydCB7IG9uTW91bnQgfSBmcm9tIFwic3ZlbHRlXCI7XHJcbiAgLy8gY29uc3QgeyBpcGNSZW5kZXJlciB9ID0gcmVxdWlyZShcImVsZWN0cm9uXCIpO1xyXG4gIGltcG9ydCBQbGF5VGVzdGVyIGZyb20gXCIuL3BsYXl0ZXN0ZXIuc3ZlbHRlXCI7XHJcbiAgY29uc3QgaXBjID0gcmVxdWlyZShcImVsZWN0cm9uXCIpLmlwY1JlbmRlcmVyO1xyXG4gIGltcG9ydCBjbCBmcm9tIFwiLi9jYXJkLWxvYWRlci5qc1wiO1xyXG4gIGNvbnN0IENhcmRMb2FkZXIgPSBuZXcgY2woaXBjKTtcclxuICAvLyBpbXBvcnQgTFpVVEY4IGZyb20gXCJsenV0ZjhcIjtcclxuICAvL2ltcG9ydCBDb29raWVzIGZyb20gXCJqcy1jb29raWVcIjtcclxuXHJcbiAgY29uc3QgQ29va2llcyA9IHtcclxuICAgIHNldDogKCkgPT4ge30sXHJcbiAgICBnZXQ6ICgpID0+IHt9XHJcbiAgfTtcclxuXHJcbiAgY29uc3QgQ0FSRF9SQVRJTyA9IDAuNzE3NjQ3MDU4ODI7XHJcbiAgbGV0IF9oZWlnaHQgPSAzMDA7XHJcbiAgbGV0IF93aWR0aCA9IE1hdGguZmxvb3IoX2hlaWdodCAqIENBUkRfUkFUSU8pO1xyXG5cclxuICBsZXQgdXNlQ29va2llcyA9IHRydWU7XHJcblxyXG4gIGZ1bmN0aW9uIGVuYWJsZVNhdmluZygpIHtcclxuICAgIHVzZUNvb2tpZXMgPSB0cnVlO1xyXG4gICAgQ29va2llcy5zZXQoXCJ1c2VDb29raWVzXCIsIHRydWUpO1xyXG4gICAgc2F2ZUFsbFRvQ29va2llcygpO1xyXG4gIH1cclxuXHJcbiAgY29uc3Qgb2xkU2V0ID0gQ29va2llcy5zZXQ7XHJcbiAgQ29va2llcy5zZXQgPSAoYSwgYikgPT4ge1xyXG4gICAgaWYgKHVzZUNvb2tpZXMpIG9sZFNldChhLCBiKTtcclxuICAgIGVsc2Uge1xyXG4gICAgICBjb25zb2xlLmxvZyhcInNhdmluZyBkaXNhYmxlZFwiKTtcclxuICAgIH1cclxuICB9O1xyXG5cclxuICBsZXQgaGVpZ2h0ID0gX2hlaWdodDtcclxuICBsZXQgd2lkdGggPSBfd2lkdGg7XHJcbiAgbGV0IGNhcmRTZWFyY2hBY3RpdmUgPSBmYWxzZTtcclxuICBsZXQgcGxheVRlc3RlckFjdGl2ZSA9IGZhbHNlO1xyXG4gIGxldCBzdGF0aXN0aWNzQWN0aXZlID0gdHJ1ZTtcclxuICBsZXQgc2NhbGluZyA9IDEwMDtcclxuXHJcbiAgbGV0IGRpc3BsYXk7XHJcblxyXG4gIGxldCBkZXZvdGlvbkhpZ2hsaWdodCA9IC0xO1xyXG5cclxuICBmdW5jdGlvbiBoaWdobGlnaHREZXZvdGlvbihtYW5hKSB7XHJcbiAgICBpZiAoZGV2b3Rpb25IaWdobGlnaHQgPT0gbWFuYSkgZGV2b3Rpb25IaWdobGlnaHQgPSAtMTtcclxuICAgIGVsc2UgZGV2b3Rpb25IaWdobGlnaHQgPSBtYW5hICsgXCJcIjtcclxuICB9XHJcblxyXG4gICQ6IHtcclxuICAgIGNvbnN0IHMgPSBNYXRoLmZsb29yKHNjYWxpbmcgfHwgMTAwKSAvIDEwMDtcclxuICAgIGhlaWdodCA9IF9oZWlnaHQgKiBzO1xyXG4gICAgd2lkdGggPSBfd2lkdGggKiBzO1xyXG4gIH1cclxuXHJcbiAgbGV0IHByb21pc2UgPSBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHJlc29sdmUoW10pKTtcclxuICBsZXQgY2FyZFNlYXJjaFByb21pc2UgPSBuZXcgUHJvbWlzZShyZXNvbHZlID0+XHJcbiAgICByZXNvbHZlKHsgZGF0YTogW10sIGhhc19tb3JlOiBmYWxzZSwgdG90YWxfY2FyZHM6IDAgfSlcclxuICApO1xyXG5cclxuICBsZXQgaW5wdXQ7XHJcbiAgbGV0IGZvcm1hdDtcclxuICBsZXQgcHJvZ3Jlc3MgPSAwO1xyXG4gIGxldCBhbGwgPSAwO1xyXG5cclxuICBsZXQgc3BOYW1lO1xyXG4gIGxldCBzcFRleHQ7XHJcbiAgbGV0IHNwVHlwZTtcclxuXHJcbiAgbGV0IHNwRURIQmx1ZTtcclxuICBsZXQgc3BFREhCbGFjaztcclxuICBsZXQgc3BFREhSZWQ7XHJcbiAgbGV0IHNwRURIV2hpdGU7XHJcbiAgbGV0IHNwRURIR3JlZW47XHJcbiAgbGV0IHNwRURIQ29sb3JsZXNzO1xyXG5cclxuICBsZXQgZGVja1NlYWNoID0gbnVsbDtcclxuICBsZXQgZGVja1NlYXJjaElucHV0O1xyXG5cclxuICBmdW5jdGlvbiBjaGFuZ2VEZWNrU2VhcmNoKGdyb3Vwcykge1xyXG4gICAgaWYgKCFncm91cHMpIHJldHVybmRlY2tTZWFjaCA9IG51bGw7XHJcbiAgICBsZXQgcyA9IGRlY2tTZWFyY2hJbnB1dC52YWx1ZTtcclxuICAgIGlmICghcykgcmV0dXJuIChkZWNrU2VhY2ggPSBudWxsKTtcclxuXHJcbiAgICBzID0gc1xyXG4gICAgICAudHJpbSgpXHJcbiAgICAgIC5yZXBsYWNlKC9cXHNcXHMrL2dtLCBcIiBcIilcclxuICAgICAgLnRvTG93ZXJDYXNlKClcclxuICAgICAgLnJlcGxhY2UoL1xccy9nbSwgXCIoLnxcXG4pKlwiKTtcclxuICAgIC8qICAgIC5zcGxpdChcIitcIilcclxuICAgICAgLmpvaW4oXCJ8XCIpOyovXHJcbiAgICBjb25zb2xlLmxvZyhcInNlYXJjaDpcIiwgcyk7XHJcbiAgICBjb25zdCByZXN1bHQgPSBbXTtcclxuICAgIGxldCBjb3VudCA9IDA7XHJcbiAgICBjb25zdCByID0gbmV3IFJlZ0V4cChzLCBcImdtXCIpO1xyXG4gICAgZm9yIChsZXQgZ3JvdXAgb2YgZ3JvdXBzKSB7XHJcbiAgICAgIGZvciAobGV0IGNhcmQgb2YgZ3JvdXAuY2FyZHMpIHtcclxuICAgICAgICBpZiAoIWNhcmQgfHwgIWNhcmQuZGF0YSB8fCAhY2FyZC5kYXRhLm9yYWNsZV90ZXh0KSBjb250aW51ZTtcclxuICAgICAgICBpZiAoIWNhcmQuZGF0YS5vcmFjbGVfdGV4dC50b0xvd2VyQ2FzZSgpLm1hdGNoKHIpKSBjb250aW51ZTtcclxuICAgICAgICBjb3VudCArPSBjYXJkLmNvdW50O1xyXG4gICAgICAgIHJlc3VsdC5wdXNoKGNhcmQpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgZGVja1NlYWNoID0gW1xyXG4gICAgICB7XHJcbiAgICAgICAgY2FyZHM6IHJlc3VsdCxcclxuICAgICAgICBjb3N0OiAwLFxyXG4gICAgICAgIGNvdW50LFxyXG4gICAgICAgIGRlY2s6IHt9LFxyXG4gICAgICAgIG1hbmE6IHtcclxuICAgICAgICAgIGJsYWNrOiAwLFxyXG4gICAgICAgICAgYmx1ZTogMCxcclxuICAgICAgICAgIGNvbG9ybGVzczogMCxcclxuICAgICAgICAgIGdlbmVyaWM6IDI0MCxcclxuICAgICAgICAgIGdyZWVuOiAwLFxyXG4gICAgICAgICAgcmVkOiAwLFxyXG4gICAgICAgICAgc3VtOiAyNDAsXHJcbiAgICAgICAgICB3aGl0ZTogMFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgbWFuYUN1cnZlOiBbXSxcclxuICAgICAgICBuYW1lOiBcInNlYXJjaCByZXN1bHRcIlxyXG4gICAgICB9XHJcbiAgICBdO1xyXG4gIH1cclxuICBmdW5jdGlvbiBjbGVhckZvckNvbG9ybGVzcygpIHtcclxuICAgIHNwRURIQmx1ZS5jaGVja2VkID0gZmFsc2U7XHJcbiAgICBzcEVESEJsYWNrLmNoZWNrZWQgPSBmYWxzZTtcclxuICAgIHNwRURIUmVkLmNoZWNrZWQgPSBmYWxzZTtcclxuICAgIHNwRURIV2hpdGUuY2hlY2tlZCA9IGZhbHNlO1xyXG4gICAgc3BFREhHcmVlbi5jaGVja2VkID0gZmFsc2U7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBjbGVhckNvbG9ybGVzcygpIHtcclxuICAgIHNwRURIQ29sb3JsZXNzLmNoZWNrZWQgPSBmYWxzZTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIGNsZWFuU3RyaW5nKCkge1xyXG4gICAgY29uc3QgYXJyYXkgPSBpbnB1dC52YWx1ZS5zcGxpdChcIlxcblwiKTtcclxuICAgIGxldCByZXN1bHQgPSBbXTtcclxuICAgIGZvciAobGV0IGEgb2YgYXJyYXkpIHtcclxuICAgICAgaWYgKCFhKSBjb250aW51ZTtcclxuICAgICAgYSA9IGEudHJpbSgpO1xyXG4gICAgICBpZiAoIWEgfHwgYS5zdGFydHNXaXRoKFwiLy9cIikpIGNvbnRpbnVlO1xyXG4gICAgICAvLyAgaWYgKC9bXFxuXFxyXFxzXSsvZ2kudGVzdChhKSkgY29udGludWU7XHJcblxyXG4gICAgICBpZiAoYS5zdGFydHNXaXRoKFwiI1wiKSkge1xyXG4gICAgICAgIGEgPSBhLnJlcGxhY2UoXCIjXCIsIFwiXFxuI1wiKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBhID0gYS50cmltKCk7XHJcbiAgICAgICAgaWYgKCEvXlxcZC8udGVzdChhKSkge1xyXG4gICAgICAgICAgYSA9IFwiMSBcIiArIGE7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICBhID0gYS5yZXBsYWNlKC9cXHNcXHMrL2csIFwiIFwiKTtcclxuICAgICAgcmVzdWx0LnB1c2goYSk7XHJcbiAgICB9XHJcbiAgICBpbnB1dC52YWx1ZSA9IHJlc3VsdC5qb2luKFwiXFxuXCIpLnRyaW0oKTtcclxuICAgIHVwZGF0ZSh7IGtleUNvZGU6IDI3IH0pO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gc2VhcmNoQ2FyZHMobmV4dFVybCkge1xyXG4gICAgaWYgKHR5cGVvZiBuZXh0VXJsID09IFwic3RyaW5nXCIpIHtcclxuICAgICAgY2FyZFNlYXJjaFByb21pc2UgPSBDYXJkTG9hZGVyLnNlYXJjaChuZXh0VXJsKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3QgY29sb3JzID0gbmV3IFNldCgpO1xyXG4gICAgaWYgKHNwRURIQ29sb3JsZXNzLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJDXCIpO1xyXG4gICAgaWYgKHNwRURIQmx1ZS5jaGVja2VkKSBjb2xvcnMuYWRkKFwiVVwiKTtcclxuICAgIGlmIChzcEVESEJsYWNrLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJCXCIpO1xyXG4gICAgaWYgKHNwRURIUmVkLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJSXCIpO1xyXG4gICAgaWYgKHNwRURIV2hpdGUuY2hlY2tlZCkgY29sb3JzLmFkZChcIldcIik7XHJcbiAgICBpZiAoc3BFREhHcmVlbi5jaGVja2VkKSBjb2xvcnMuYWRkKFwiR1wiKTtcclxuXHJcbiAgICBjYXJkU2VhcmNoUHJvbWlzZSA9IENhcmRMb2FkZXIuc2VhcmNoKHtcclxuICAgICAgbmFtZTogc3BOYW1lLnZhbHVlLFxyXG4gICAgICB0ZXh0OiBzcFRleHQudmFsdWUsXHJcbiAgICAgIHR5cGU6IHNwVHlwZS52YWx1ZSxcclxuICAgICAgZWRoY29sb3JzOiBjb2xvcnNcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgbGV0IGN1cnJlbnRDYXJkQ29udGV4dCA9IG51bGw7XHJcbiAgZnVuY3Rpb24gY2FyZENvbnRleHRNZW51KGV2dCwgY2FyZCwgZ3JvdXBzKSB7XHJcbiAgICBldnQucHJldmVudERlZmF1bHQoKTtcclxuICAgIGlmIChldnQud2hpY2ggPT0gMyAmJiBncm91cHMubGVuZ3RoID4gMSkge1xyXG4gICAgICAvLyByaWdodCBjbGlja1xyXG4gICAgICBjdXJyZW50Q2FyZENvbnRleHQgPSBjYXJkO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gY2FyZENvbnRleHRDbGljayhldnQsIGNhcmQsIGdyb3VwKSB7XHJcbiAgICBjdXJyZW50Q2FyZENvbnRleHQgPSBudWxsO1xyXG4gICAgZXZ0LnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgZXZ0LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICBsZXQgZGVjayA9IGlucHV0LnZhbHVlO1xyXG5cclxuICAgIGNvbnN0IHIgPSBuZXcgUmVnRXhwKGBeLioke2NhcmQubmFtZX0uKiRgLCBcImdtaVwiKTtcclxuICAgIGRlY2sgPSBkZWNrLnJlcGxhY2UociwgXCJcIik7XHJcbiAgICBsZXQgaW5kZXggPSBkZWNrLmluZGV4T2YoZ3JvdXAubmFtZSk7XHJcbiAgICBpZiAoaW5kZXggPCAwKSByZXR1cm47XHJcbiAgICBpbmRleCArPSBncm91cC5uYW1lLmxlbmd0aDtcclxuXHJcbiAgICBjb25zdCBpbnNlcnQgPSBcIlxcblwiICsgY2FyZC5jb3VudCArIFwiIFwiICsgY2FyZC5uYW1lO1xyXG4gICAgZGVjayA9IGRlY2suc2xpY2UoMCwgaW5kZXgpICsgaW5zZXJ0ICsgZGVjay5zbGljZShpbmRleCk7XHJcbiAgICBpbnB1dC52YWx1ZSA9IGRlY2s7XHJcbiAgICByZWxvYWQoKTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIG9uTWFpbk1vdXNlRG93bihldnQpIHtcclxuICAgIGN1cnJlbnRDYXJkQ29udGV4dCA9IG51bGw7XHJcbiAgfVxyXG5cclxuICBsZXQgaGlkZGVuR3JvdXBzID0gbmV3IFNldCgpO1xyXG5cclxuICBmdW5jdGlvbiB0b2dnbGVHcm91cFZpc2liaWxpdHkoZ3JvdXApIHtcclxuICAgIGlmIChoaWRkZW5Hcm91cHMuaGFzKGdyb3VwLm5hbWUpKSBoaWRkZW5Hcm91cHMuZGVsZXRlKGdyb3VwLm5hbWUpO1xyXG4gICAgZWxzZSBoaWRkZW5Hcm91cHMuYWRkKGdyb3VwLm5hbWUpO1xyXG5cclxuICAgIGhpZGRlbkdyb3VwcyA9IGhpZGRlbkdyb3VwcztcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHNwKHAsIGEpIHtcclxuICAgIHByb2dyZXNzID0gcDtcclxuICAgIGFsbCA9IGE7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiByZXNldERlY2tTZWFyY2goKSB7XHJcbiAgICBkZWNrU2VhY2ggPSBudWxsO1xyXG4gICAgaWYgKCFkZWNrU2VhcmNoSW5wdXQpIHJldHVybjtcclxuICAgIGRlY2tTZWFyY2hJbnB1dC52YWx1ZSA9IFwiXCI7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBzb3J0RGVja1N0cmluZygpIHtcclxuICAgIHByb21pc2UgPSBDYXJkTG9hZGVyLnNvcnQoaW5wdXQudmFsdWUgfHwgXCJcIiwgKHAsIGEpID0+IHtcclxuICAgICAgcmVzZXREZWNrU2VhcmNoKCk7XHJcbiAgICAgIHNwKHAsIGEpO1xyXG4gICAgfSlcclxuICAgICAgLmNhdGNoKGUgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZSk7XHJcbiAgICAgICAgdGhyb3cgZTtcclxuICAgICAgfSlcclxuICAgICAgLnRoZW4ocmVzID0+IHtcclxuICAgICAgICBpbnB1dC52YWx1ZSA9IHJlcztcclxuICAgICAgICByZXR1cm4gdXBkYXRlKHsga2V5Q29kZTogMjcgfSwgdHJ1ZSk7XHJcbiAgICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgbGV0IGRlY2tOYW1lSW5wdXQ7XHJcbiAgZnVuY3Rpb24gc2F2ZURlY2soKSB7XHJcbiAgICBpZiAoIWRlY2tOYW1lSW5wdXQpIHJldHVybiBhbGVydChcInBscyBpbnB1dCBhIG5hbWVcIik7XHJcblxyXG4gICAgLy8gY29uc3QgZmlsZW5hbWUgPSAoZGVja05hbWVJbnB1dC52YWx1ZSB8fCBcInVua25vd24gZGVja1wiKSArIFwiLnR4dFwiO1xyXG5cclxuICAgIGlwYy5zZW5kKFwic2F2ZURlY2tcIiwgeyBkZWNrOiBpbnB1dC52YWx1ZSwgbmFtZTogZGVja05hbWVJbnB1dC52YWx1ZSB9KTtcclxuXHJcbiAgICAvKiAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtkZWNrXSwgeyB0eXBlOiBcInRleHQvcGxhaW47Y2hhcnNldD11dGYtOFwiIH0pO1xyXG4gICAgaWYgKHdpbmRvdy5uYXZpZ2F0b3IubXNTYXZlT3JPcGVuQmxvYilcclxuICAgICAgLy8gSUUxMCtcclxuICAgICAgd2luZG93Lm5hdmlnYXRvci5tc1NhdmVPck9wZW5CbG9iKGJsb2IsIGZpbGVuYW1lKTtcclxuICAgIGVsc2Uge1xyXG4gICAgICAvLyBPdGhlcnNcclxuICAgICAgdmFyIGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiYVwiKSxcclxuICAgICAgICB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgICBhLmhyZWYgPSB1cmw7XHJcbiAgICAgIGEuZG93bmxvYWQgPSBmaWxlbmFtZTtcclxuICAgICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcclxuICAgICAgYS5jbGljaygpO1xyXG4gICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xyXG4gICAgICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYSk7XHJcbiAgICAgICAgd2luZG93LlVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcclxuICAgICAgfSwgMCk7XHJcbiAgICB9Ki9cclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIG9uRGVja05hbWVUeXBlKCkge1xyXG4gICAgQ29va2llcy5zZXQoXCJkZWNrTmFtZVwiLCBkZWNrTmFtZUlucHV0LnZhbHVlKTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIG1haW5LZXlEb3duKGV2dCkge1xyXG4gICAgaWYgKGV2dC5jdHJsS2V5IHx8IGV2dC5tZXRhS2V5KSB7XHJcbiAgICAgIHN3aXRjaCAoZXZ0LndoaWNoKSB7XHJcbiAgICAgICAgY2FzZSA4MzogLy8gc1xyXG4gICAgICAgICAgZXZ0LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgICBldnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICBzYXZlRGVjaygpO1xyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIG1haW5LZXlVcChldnQpIHtcclxuICAgIHVwZGF0ZShldnQpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgZnVuY3Rpb24gdXBkYXRlKGV2dCkge1xyXG4gICAgaWYgKGV2dC5rZXlDb2RlICE9PSAyNykgcmV0dXJuO1xyXG5cclxuICAgIGxldCBzY3JvbGxQb3NpdGlvbiA9IDA7XHJcbiAgICBpZiAoZGlzcGxheSkge1xyXG4gICAgICBzY3JvbGxQb3NpdGlvbiA9IGRpc3BsYXkuc2Nyb2xsVG9wO1xyXG4gICAgfVxyXG5cclxuICAgIHByb21pc2UgPSBDYXJkTG9hZGVyLmNyZWF0ZURlY2soaW5wdXQudmFsdWUgfHwgXCJcIiwgKHAsIGEpID0+IHtcclxuICAgICAgcmVzZXREZWNrU2VhcmNoKCk7XHJcbiAgICAgIHNwKHAsIGEpO1xyXG4gICAgfSlcclxuICAgICAgLmNhdGNoKGUgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZSk7XHJcbiAgICAgICAgdGhyb3cgZTtcclxuICAgICAgfSlcclxuICAgICAgLnRoZW4ocmVzID0+IHtcclxuICAgICAgICBpbnB1dC52YWx1ZSA9IHJlcy5jb3JyZWN0ZWQ7XHJcbiAgICAgICAgQ29va2llcy5zZXQoXCJkZWNrXCIsIGlucHV0LnZhbHVlKTtcclxuICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgIGRpc3BsYXkuc2Nyb2xsVG9wID0gc2Nyb2xsUG9zaXRpb247XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgcmV0dXJuIHJlcztcclxuICAgICAgfSk7XHJcblxyXG4gICAgcmV0dXJuIHByb21pc2U7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIHJlbG9hZCgpIHtcclxuICAgIHJlc2V0RGVja1NlYXJjaCgpO1xyXG4gICAgdXBkYXRlKHsga2V5Q29kZTogMjcgfSk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBhcHBlbmRDYXJkKG5hbWUpIHtcclxuICAgIGlmICghbmFtZSkgcmV0dXJuO1xyXG4gICAgcmVzZXREZWNrU2VhcmNoKCk7XHJcbiAgICBpbnB1dC52YWx1ZSA9IGlucHV0LnZhbHVlICsgXCJcXG4xIFwiICsgbmFtZTtcclxuICAgIHJlbG9hZCgpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gcmVtb3ZlKGNhcmQpIHtcclxuICAgIGNvbnN0IHIgPSBuZXcgUmVnRXhwKGBeLioke2NhcmQubmFtZX0uKiRgLCBcImdtXCIpO1xyXG5cclxuICAgIGlucHV0LnZhbHVlID0gaW5wdXQudmFsdWUucmVwbGFjZShyLCBcIi8vIFwiICsgY2FyZC5jb3VudCArIFwiIFwiICsgY2FyZC5uYW1lKTtcclxuICAgIHByb21pc2UgPSBDYXJkTG9hZGVyLmNyZWF0ZURlY2soaW5wdXQudmFsdWUgfHwgXCJcIiwgKHAsIGEpID0+XHJcbiAgICAgIHNwKHAsIGEpXHJcbiAgICApLmNhdGNoKGUgPT4ge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGUpO1xyXG4gICAgICB0aHJvdyBlO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBjb3B5RGVjaygpIHtcclxuICAgIGNvbnN0IGRlY2sgPSBpbnB1dC52YWx1ZTtcclxuXHJcbiAgICBpbnB1dC52YWx1ZSA9IGlucHV0LnZhbHVlLnJlcGxhY2UoLyMuKnxcXC9cXC8uKi9nbSwgXCJcXG5cIik7XHJcblxyXG4gICAgaW5wdXQuc2VsZWN0KCk7XHJcblxyXG4gICAgaW5wdXQuc2V0U2VsZWN0aW9uUmFuZ2UoMCwgOTk5OTkpO1xyXG4gICAgZG9jdW1lbnQuZXhlY0NvbW1hbmQoXCJjb3B5XCIpO1xyXG5cclxuICAgIGlucHV0LnZhbHVlID0gZGVjaztcclxuXHJcbiAgICBhbGVydChcIkRlY2sgY29waWVkIHRvIGNsaXBib2FyZFwiKTtcclxuICB9XHJcblxyXG4gIGxldCBoZWxwQWN0aXZlID0gZmFsc2U7XHJcbiAgb25Nb3VudChhc3luYyAoKSA9PiB7XHJcbiAgICBjb25zdCBkZWZhdWx0RGVjayA9IGAjbGFuZHNcclxubW91bnRhaW5cclxuMiBwbGFpbnNcclxuMyBzd2FtcHNcclxuIyBtYWluIGRlY2tcclxuMjAgYmxpZ2h0c3RlZWwgY29sb3NzdXNgO1xyXG5cclxuICAgIHVzZUNvb2tpZXMgPSBDb29raWVzLmdldChcInVzZUNvb2tpZXNcIik7XHJcblxyXG4gICAgY29uc3QgdXJsUGFyYW1zID0gbmV3IFVSTFNlYXJjaFBhcmFtcyh3aW5kb3cubG9jYXRpb24uc2VhcmNoKTtcclxuICAgIGNvbnN0IHNoYXJlZERlY2sgPSB1cmxQYXJhbXMuZ2V0KFwiZFwiKTtcclxuXHJcbiAgICBsZXQgc3RhcnQgPSB1c2VDb29raWVzID8gQ29va2llcy5nZXQoXCJkZWNrXCIpIHx8IGRlZmF1bHREZWNrIDogZGVmYXVsdERlY2s7XHJcblxyXG4gICAgaWYgKHNoYXJlZERlY2spIHtcclxuICAgICAgdXNlQ29va2llcyA9IGZhbHNlO1xyXG4gICAgICAvKiBjb25zdCBidWZmZXIgPSBuZXcgVWludDhBcnJheShzaGFyZWREZWNrLnNwbGl0KFwiLFwiKSk7XHJcbiAgICAqIGNvbnN0IGRlY29tcHJlc3NlZCA9IExaVVRGOC5kZWNvbXByZXNzKGJ1ZmZlcik7XHJcbiAgICAgIGlmIChkZWNvbXByZXNzZWQpIHtcclxuICAgICAgICBzdGFydCA9IGRlY29tcHJlc3NlZDtcclxuICAgICAgfSovXHJcbiAgICB9XHJcblxyXG4gICAgdXJsUGFyYW1zLmRlbGV0ZShcImRcIik7XHJcbiAgICB3aW5kb3cuaGlzdG9yeS5yZXBsYWNlU3RhdGUoe30sIFwiXCIsIGAke3dpbmRvdy5sb2NhdGlvbi5wYXRobmFtZX1gKTtcclxuXHJcbiAgICAvLyAgICB3aW5kb3cuaGlzdG9yeS5yZXBsYWNlU3RhdGUoXHJcbiAgICAvLyAgIHt9LFxyXG4gICAgLy8gICAnJyxcclxuICAgIC8vICAgYCR7d2luZG93LmxvY2F0aW9uLnBhdGhuYW1lfT8ke3BhcmFtc30ke3dpbmRvdy5sb2NhdGlvbi5oYXNofWAsXHJcbiAgICAvLyApXHJcblxyXG4gICAgLy8gIGhlbHBBY3RpdmUgPSBDb29raWVzLmdldChcImhlbHBBY3RpdmVcIikgPT0gXCJ0cnVlXCI7XHJcbiAgICAvLyBjb25zb2xlLmxvZyhcImhlbHA6XCIsIENvb2tpZXMuZ2V0KFwiaGVscEFjdGl2ZVwiKSk7XHJcbiAgICBjYXJkU2VhcmNoQWN0aXZlID0gQ29va2llcy5nZXQoXCJjYXJkU2VhcmNoQWN0aXZlXCIpID09IFwidHJ1ZVwiO1xyXG4gICAgY29uc29sZS5sb2coXCJzZWFyY2g6XCIsIENvb2tpZXMuZ2V0KFwiY2FyZFNlYXJjaEFjdGl2ZVwiKSk7XHJcbiAgICBzdGF0aXN0aWNzQWN0aXZlID0gQ29va2llcy5nZXQoXCJzdGF0aXN0aWNzQWN0aXZlXCIpID09IFwidHJ1ZVwiO1xyXG4gICAgY29uc29sZS5sb2coXCJzdGF0aXN0aWNzOlwiLCBDb29raWVzLmdldChcInN0YXRpc3RpY3NBY3RpdmVcIikpO1xyXG5cclxuICAgIHN0YXRpc3RpY3NBY3RpdmU7XHJcbiAgICBpbnB1dC52YWx1ZSA9IHN0YXJ0O1xyXG4gICAgcmVsb2FkKCk7XHJcblxyXG4gICAgaXBjLm9uKFwibG9hZERlY2tcIiwgKHNlbmRlciwgZGF0YSkgPT4ge1xyXG4gICAgICBjb25zb2xlLmxvZyhcIkxPQURJTkcgREVDS1wiLCBkYXRhLm5hbWUpO1xyXG4gICAgICBpbnB1dC52YWx1ZSA9IGRhdGEuZGVjaztcclxuICAgICAgZGVja05hbWVJbnB1dC52YWx1ZSA9IChkYXRhLm5hbWUgfHwgXCJcIikucmVwbGFjZShcIi5nZGVja1wiLCBcIlwiKTtcclxuICAgICAgcmVsb2FkKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvKiBjb25zb2xlLmxvZyhcIlNUU0ZTREZcIiwgQ29va2llcy5nZXQoXCJkZWNrXCIpKSxcclxuICAgICAgKHByb21pc2UgPSBDYXJkTG9hZGVyLmNyZWF0ZURlY2soc3RhcnQsIChwLCBhKSA9PiBzcChwLCBhKSkpOyovXHJcbiAgfSk7XHJcblxyXG4gIGZ1bmN0aW9uIHNhdmVBbGxUb0Nvb2tpZXMoKSB7XHJcbiAgICBDb29raWVzLnNldChcImNhcmRTZWFyY2hBY3RpdmVcIiwgY2FyZFNlYXJjaEFjdGl2ZSk7XHJcbiAgICBDb29raWVzLnNldChcInN0YXRpc3RpY3NBY3RpdmVcIiwgc3RhdGlzdGljc0FjdGl2ZSk7XHJcbiAgICBDb29raWVzLnNldChcImRlY2tcIiwgaW5wdXQudmFsdWUpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gc2hhcmVEZWNrKCkge1xyXG4gICAgLyogICBpZiAoIWlucHV0IHx8ICFpbnB1dC52YWx1ZSkge1xyXG4gICAgICBhbGVydChcIlRoZSBkZWNrIGlzIGVtcHR5LCBub3RoaW5nIGNvcGllZFwiKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3QgY29tcHJlc3NlZCA9IExaVVRGOC5jb21wcmVzcyhpbnB1dC52YWx1ZSB8fCBcImVtcHR5IGRlY2sgc2hhcmVkXCIpO1xyXG4gICAgLy93aW5kb3cuaGlzdG9yeS5wdXNoU3RhdGUoXCJwYWdlMlwiLCBcIlRpdGxlXCIsIFwiP2Q9XCIgKyBjb21wcmVzc2VkKTtcclxuICAgIGNvbnNvbGUubG9nKGAke3dpbmRvdy5sb2NhdGlvbi5wYXRobmFtZX0/ZD0ke2NvbXByZXNzZWR9YCk7XHJcblxyXG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwidGV4dGFyZWFcIik7XHJcbiAgICBlbC52YWx1ZSA9IGAke3dpbmRvdy5sb2NhdGlvbi5ocmVmfT9kPSR7Y29tcHJlc3NlZH1gO1xyXG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChlbCk7XHJcbiAgICBlbC5zZWxlY3QoKTtcclxuICAgIGRvY3VtZW50LmV4ZWNDb21tYW5kKFwiY29weVwiKTtcclxuICAgIGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoZWwpO1xyXG4gICAgYWxlcnQoXCJsaW5rIHRvIGRlY2sgY29waWVkXCIpOyovXHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBvblR5cGluZygpIHtcclxuICAgIENvb2tpZXMuc2V0KFwiZGVja1wiLCBpbnB1dC52YWx1ZSwgeyBleHBpcmVzOiA3IH0pO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gZ2V0SGVpZ2h0KG1hbmEsIGdyb3Vwcykge1xyXG4gICAgcmV0dXJuIDEwMCAqIChtYW5hIC8gTWF0aC5tYXgoLi4uZ3JvdXBzW1wibWFuYUN1cnZlXCJdKSk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBvcGVuSGVscCgpIHtcclxuICAgIGhlbHBBY3RpdmUgPSAhaGVscEFjdGl2ZTtcclxuICAgIC8vICBDb29raWVzLnNldChcImhlbHBBY3RpdmVcIiwgaGVscEFjdGl2ZSArIFwiXCIpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gdG9nZ2xlUGxheVRlc3QoKSB7XHJcbiAgICBwbGF5VGVzdGVyQWN0aXZlID0gIXBsYXlUZXN0ZXJBY3RpdmU7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiB0b2dnbGVTZWFyY2goKSB7XHJcbiAgICBjYXJkU2VhcmNoQWN0aXZlID0gIWNhcmRTZWFyY2hBY3RpdmU7XHJcbiAgICBDb29raWVzLnNldChcImNhcmRTZWFyY2hBY3RpdmVcIiwgY2FyZFNlYXJjaEFjdGl2ZSArIFwiXCIpO1xyXG4gIH1cclxuICBmdW5jdGlvbiB0b2dnbGVTdGF0aXN0aWNzKCkge1xyXG4gICAgc3RhdGlzdGljc0FjdGl2ZSA9ICFzdGF0aXN0aWNzQWN0aXZlO1xyXG4gICAgQ29va2llcy5zZXQoXCJzdGF0aXN0aWNzQWN0aXZlXCIsIHN0YXRpc3RpY3NBY3RpdmUgKyBcIlwiKTtcclxuICB9XHJcblxyXG4gIGxldCBoaWdobGlnaHRlZENyZWF0dXJlID0gXCJcIjtcclxuICBmdW5jdGlvbiBoaWdobGlnaHRDcmVhdHVyZSh0eXBlTmFtZSkge1xyXG4gICAgaWYgKHR5cGVOYW1lID09IGhpZ2hsaWdodGVkQ3JlYXR1cmUpIHtcclxuICAgICAgaGlnaGxpZ2h0ZWRDcmVhdHVyZSA9IFwiXCI7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGhpZ2hsaWdodGVkQ3JlYXR1cmUgPSB0eXBlTmFtZTtcclxuICAgIH1cclxuICB9XHJcbjwvc2NyaXB0PlxyXG5cclxuPHN0eWxlPlxyXG4gIC5jb250ZW50IHtcclxuICAgIC0tcmFpc2luLWJsYWNrOiBoc2xhKDIwMCwgOCUsIDE1JSwgMSk7XHJcbiAgICAtLXJvbWFuLXNpbHZlcjogaHNsYSgxOTYsIDE1JSwgNjAlLCAxKTtcclxuICAgIC0tY29sb3JsZXNzOiBoc2xhKDAsIDAlLCA4OSUsIDEpO1xyXG4gICAgLS1ibGFjazogaHNsYSg4MywgOCUsIDM4JSwgMSk7XHJcbiAgICAtLXdoaXRlOiBoc2woNDgsIDY0JSwgODklKTtcclxuICAgIC0tcmVkOiBoc2xhKDAsIDcxJSwgODQlLCAxKTtcclxuICAgIC0tZ3JlZW46IGhzbGEoMTE0LCA2MCUsIDc1JSwgMSk7XHJcbiAgICAtLWJsdWU6IGhzbGEoMjM1LCA1NSUsIDgxJSwgMSk7XHJcbiAgfVxyXG5cclxuICAuY29udGVudCB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICAgIHdpZHRoOiAxMDAlO1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gIH1cclxuXHJcbiAgLmhlbHAtc3ltYm9sIHtcclxuICAgIGJvcmRlci1yYWRpdXM6IDUwJTtcclxuICAgIGJvcmRlcjogMXB4IHNvbGlkIGJsYWNrO1xyXG4gICAgd2lkdGg6IDE2cHg7XHJcbiAgICBoZWlnaHQ6IDE2cHg7XHJcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICByaWdodDogMTBweDtcclxuICAgIHRvcDogMTBweDtcclxuICAgIGN1cnNvcjogcG9pbnRlcjtcclxuICB9XHJcblxyXG4gIC5oZWxwLXN5bWJvbDpob3ZlciB7XHJcbiAgICBib3JkZXItY29sb3I6IGJsdWU7XHJcbiAgICBjb2xvcjogYmx1ZTtcclxuICB9XHJcblxyXG4gIC50b2dnbGUtc2VhcmNoIHtcclxuICAgIGJhY2tncm91bmQ6IGJsdWU7XHJcbiAgICB3aWR0aDogMzBweDtcclxuICAgIGhlaWdodDogMzBweDtcclxuICAgIGN1cnNvcjogcG9pbnRlcjtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIGxlZnQ6IC0zMHB4O1xyXG4gICAgdG9wOiA1MCU7XHJcbiAgICB1c2VyLXNlbGVjdDogbm9uZTtcclxuICB9XHJcblxyXG4gIC5oaWRlIC50b2dnbGUtc2VhcmNoIHtcclxuICAgIGxlZnQ6IC01MnB4O1xyXG4gIH1cclxuXHJcbiAgLnN0YXRpc3RpY3Mge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XHJcbiAgfVxyXG4gIC5pbnB1dCB7XHJcbiAgICB3aWR0aDogMTAwJTtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICAgIGJveC1zaXppbmc6IGJvcmRlci1ib3g7XHJcbiAgICBwYWRkaW5nOiAxMHB4O1xyXG4gICAgcmVzaXplOiBub25lO1xyXG4gIH1cclxuXHJcbiAgLmNvbnRyb2xzIHtcclxuICAgIGZsZXgtc2hyaW5rOiAwO1xyXG4gICAgd2lkdGg6IDMwMHB4O1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gICAgYmFja2dyb3VuZDogbGlnaHRncmF5O1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XHJcbiAgfVxyXG5cclxuICAuaGVscCB7XHJcbiAgICBwYWRkaW5nOiAwcHggMTBweCAxMHB4IDEwcHg7XHJcbiAgICB1c2VyLXNlbGVjdDogbm9uZTtcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICB9XHJcblxyXG4gIC5ncm91cC1jb250ZW50IHtcclxuICAgIGZsZXgtZ3JvdzogMTtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LXdyYXA6IHdyYXA7XHJcbiAgICB0cmFuc2l0aW9uOiBoZWlnaHQgNTAwbXMgZWFzZTtcclxuICB9XHJcblxyXG4gIC5ncm91cC1jb250ZW50LmhpZGRlbiB7XHJcbiAgICBvdmVyZmxvdzogaGlkZGVuO1xyXG4gICAgaGVpZ2h0OiA0NXB4O1xyXG4gIH1cclxuXHJcbiAgLmFsbC10eXBlLWNvdW50IHtcclxuICAgIGhlaWdodDogMTI1cHg7XHJcbiAgICBvdmVyZmxvdzogYXV0bztcclxuICAgIGJhY2tncm91bmQ6IGxpZ2h0c3RlZWxibHVlO1xyXG4gICAgcGFkZGluZzogMTBweDtcclxuICB9XHJcblxyXG4gIC50eXBlLXNlbGVjdG9yIHtcclxuICAgIGN1cnNvcjogcG9pbnRlcjtcclxuICB9XHJcblxyXG4gIC50eXBlLXNlbGVjdG9yOm5vdCguaGlnaGxpZ2h0ZWQtY3JlYXR1cmUpOmhvdmVyIHtcclxuICAgIGJhY2tncm91bmQ6IGFsaWNlYmx1ZTtcclxuICB9XHJcblxyXG4gIC5oaWdobGlnaHRlZC1jcmVhdHVyZSB7XHJcbiAgICBiYWNrZ3JvdW5kOiBzdGVlbGJsdWU7XHJcbiAgfVxyXG5cclxuICAucGxheS10ZXN0ZXIge1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gICAgZmxleC1ncm93OiAxO1xyXG4gICAgYmFja2dyb3VuZDogd2hpdGU7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIHJpZ2h0OiAwO1xyXG4gICAgd2lkdGg6IDEwMCU7XHJcbiAgICB6LWluZGV4OiAxNTA7XHJcbiAgICBib3gtc2hhZG93OiAwcHggMHB4IDEwcHggYmxhY2s7XHJcbiAgfVxyXG5cclxuICAucGxheS10ZXN0ZXIuaGlkZSB7XHJcbiAgICBkaXNwbGF5OiBub25lO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQtc2VhcmNoIHtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICAgIGZsZXgtZ3JvdzogMTtcclxuICAgIGJhY2tncm91bmQ6IHdoaXRlO1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICByaWdodDogMDtcclxuICAgIHdpZHRoOiAzMyU7XHJcbiAgICB6LWluZGV4OiAxMDA7XHJcbiAgICBib3gtc2hhZG93OiAwcHggMHB4IDEwcHggYmxhY2s7XHJcbiAgfVxyXG5cclxuICAuY2FyZC1zZWFyY2guaGlkZSB7XHJcbiAgICByaWdodDogLTMzJTtcclxuICB9XHJcblxyXG4gIC5zZWFyY2gtcGFyYW1zIHtcclxuICAgIGZsZXgtc2hyaW5rOiAwO1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XHJcbiAgfVxyXG5cclxuICAuc2VhcmNoLXJlc3VsdCB7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgICBmbGV4LWdyb3c6IDE7XHJcbiAgICBiYWNrZ3JvdW5kOiB3aGl0ZTtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gICAgb3ZlcmZsb3c6IGF1dG87XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgICB1c2VyLXNlbGVjdDogbm9uZTtcclxuICAgIGZsZXgtd3JhcDogd3JhcDtcclxuICB9XHJcblxyXG4gIC5kaXNwbGF5IHtcclxuICAgIGZsZXgtZ3JvdzogMTtcclxuICAgIGJhY2tncm91bmQ6IGdyYXk7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcclxuICAgIGZsZXgtd3JhcDogbm93cmFwO1xyXG4gICAgb3ZlcmZsb3c6IGF1dG87XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgICB1c2VyLXNlbGVjdDogbm9uZTtcclxuICB9XHJcblxyXG4gIC5sb2FkaW5nLXdyYXBwZXIge1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgbGVmdDogNTAlO1xyXG4gICAgdG9wOiAwO1xyXG4gICAgYm90dG9tOiAwO1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7XHJcbiAgfVxyXG5cclxuICAuZW50cnkge1xyXG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xyXG4gICAgcGFkZGluZzogMTBweDtcclxuICAgIGZsZXgtc2hyaW5rOiAwO1xyXG4gIH1cclxuXHJcbiAgLnNob3Bpbmcge1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgei1pbmRleDogMTA7XHJcbiAgICBmb250LXNpemU6IDNlbTtcclxuICAgIHRleHQtc2hhZG93OiAwcHggMHB4IDZweCBibGFjaztcclxuICAgIHRleHQtYWxpZ246IGNlbnRlcjtcclxuICAgIGJvdHRvbTogMTAlO1xyXG4gICAgcmlnaHQ6IDEwJTtcclxuICAgIGRpc3BsYXk6IG5vbmU7XHJcbiAgfVxyXG5cclxuICAuZW50cnk6aG92ZXIgLnNob3Bpbmcge1xyXG4gICAgZGlzcGxheTogYmxvY2s7XHJcbiAgfVxyXG5cclxuICAuc2hvcGluZyAubGluayB7XHJcbiAgICB0ZXh0LWRlY29yYXRpb246IG5vbmU7XHJcbiAgfVxyXG5cclxuICAuc2hvcGluZyAubGluazpob3ZlciB7XHJcbiAgICBjb2xvcjogdHJhbnNwYXJlbnQ7XHJcbiAgICB0ZXh0LXNoYWRvdzogMCAwIDAgYmx1ZTtcclxuICB9XHJcblxyXG4gIC5jYXJkIHtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIGJvcmRlcjogNnB4IHNvbGlkIHJnYigyMiwgMjIsIDIyKTtcclxuICAgIGJvcmRlci1yYWRpdXM6IDEwcHg7XHJcbiAgICBvdXRsaW5lOiAwO1xyXG4gICAgYm94LXNoYWRvdzogMHB4IDBweCAxMHB4IGJsYWNrO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQuYmFubmVkIHtcclxuICAgIGJvcmRlcjogNnB4IHNvbGlkIHJlZDtcclxuICB9XHJcblxyXG4gIC5jYXJkLmhpZ2hsaWdodGVkIHtcclxuICAgIGJvcmRlcjogNnB4IHNvbGlkIHllbGxvdztcclxuICB9XHJcblxyXG4gIC5jYXJkLnR5cGUtaGlnaGxpZ2h0IHtcclxuICAgIGJvcmRlcjogNnB4IHNvbGlkIGJsdWV2aW9sZXQ7XHJcbiAgfVxyXG5cclxuICAuY2FyZDpob3ZlciB7XHJcbiAgICBib3JkZXI6IDZweCBzb2xpZCBibHVlO1xyXG4gICAgY3Vyc29yOiBwb2ludGVyO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQtY29udGV4dC1tZW51IHtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIHotaW5kZXg6IDEwMDtcclxuICAgIGJhY2tncm91bmQ6IHJnYmEoMjU1LCAyNTUsIDI1NSwgMC43KTtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICAgIHdpZHRoOiAxMDAlO1xyXG4gICAgLyogcGFkZGluZzogMTBweDsgKi9cclxuICAgIC8qIG1hcmdpbjogMTBweDsgKi9cclxuICAgIG1hcmdpbi1sZWZ0OiAtM3B4O1xyXG4gICAgbWFyZ2luLXRvcDogLTNweDtcclxuICAgIG92ZXJmbG93OiBhdXRvO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQtY29udGV4dC1lbnRyeSB7XHJcbiAgICBtYXJnaW46IDEwcHg7XHJcbiAgICBmb250LXdlaWdodDogYm9sZDtcclxuICAgIGJhY2tncm91bmQ6IHdoaXRlO1xyXG4gICAgcGFkZGluZzogNXB4O1xyXG4gICAgYm9yZGVyLXJhZGl1czogOXB4O1xyXG4gICAgYm94LXNoYWRvdzogMCAwIDZweCBibGFjaztcclxuICAgIGN1cnNvcjogcG9pbnRlcjtcclxuICB9XHJcblxyXG4gIC5jYXJkLWNvbnRleHQtZW50cnk6aG92ZXIge1xyXG4gICAgYmFja2dyb3VuZDogd2hlYXQ7XHJcbiAgfVxyXG5cclxuICAucHJpY2UsXHJcbiAgLmJhbm5lZC10ZXh0LFxyXG4gIC5jb3VudCB7XHJcbiAgICBmb250LXNpemU6IDM0cHg7XHJcbiAgICB0ZXh0LXNoYWRvdzogMHB4IDBweCA5cHggYmxhY2s7XHJcbiAgICBjb2xvcjogcmVkO1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgei1pbmRleDogMTAwO1xyXG4gICAgZm9udC13ZWlnaHQ6IGJvbGQ7XHJcbiAgICBsZWZ0OiAzNHB4O1xyXG4gIH1cclxuXHJcbiAgLmJhbm5lZC10ZXh0IHtcclxuICAgIGZvbnQtc2l6ZTogMTAwJTtcclxuICAgIHRleHQtc2hhZG93OiAwcHggMHB4IDlweCBibGFjaztcclxuICAgIGNvbG9yOiByZWQ7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICB6LWluZGV4OiAxMDA7XHJcbiAgICBmb250LXdlaWdodDogYm9sZDtcclxuICAgIGxlZnQ6IDE3JTtcclxuICB9XHJcbiAgLmNvdW50IHtcclxuICAgIHRvcDogMTY1cHg7XHJcbiAgfVxyXG5cclxuICAucHJpY2Uge1xyXG4gICAgYm90dG9tOiA3cHg7XHJcbiAgICBjb2xvcjogd2hlYXQ7XHJcbiAgICBmb250LXNpemU6IDEycHg7XHJcbiAgICBiYWNrZ3JvdW5kOiBibGFjaztcclxuICAgIGxlZnQ6IDQ1JTtcclxuICAgIGZvbnQtd2VpZ2h0OiBub3JtYWw7XHJcbiAgfVxyXG5cclxuICAuZ3JvdXAtaGVhZGVyIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBiYWNrZ3JvdW5kOiBkYXJrZ3JleTtcclxuICAgIC8qIHBhZGRpbmc6IDhweDsgKi9cclxuICAgIG1hcmdpbjogOHB4IDA7XHJcbiAgICBib3gtc2hhZG93OiAwcHggMHB4IDhweCBibGFjaztcclxuICAgIHdpZHRoOiAxMDAlO1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICB9XHJcblxyXG4gIC5ncm91cC1oZWFkZXIgaDIge1xyXG4gICAgcGFkZGluZzogMCAyNXB4O1xyXG4gICAgbWFyZ2luOiAwcHg7XHJcbiAgfVxyXG5cclxuICAuZ3JvdXAtc3RhdGlzdGljcyB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICB9XHJcblxyXG4gIC5tYW5hLXByb3Bvc2FsLFxyXG4gIC5tYW5hLWRldm90aW9uIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gIH1cclxuXHJcbiAgLmRlY2stdmFsdWUsXHJcbiAgLmdyb3VwLXZhbHVlIHtcclxuICAgIHBhZGRpbmc6IDVweDtcclxuICAgIGNvbG9yOiBibGFjaztcclxuICAgIGJvcmRlci1yYWRpdXM6IDUwJTtcclxuICAgIHdpZHRoOiAxNXB4O1xyXG4gICAgaGVpZ2h0OiAxNXB4O1xyXG4gICAgdGV4dC1hbGlnbjogY2VudGVyO1xyXG4gICAgbWFyZ2luOiA1cHg7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgdGV4dC1hbGlnbjogY2VudGVyO1xyXG4gICAgYWxpZ24taXRlbXM6IGNlbnRlcjtcclxuICAgIGZvbnQtc2l6ZTogMTFweDtcclxuICAgIGZvbnQtd2VpZ2h0OiBib2xkO1xyXG4gIH1cclxuICAuYmx1ZSB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS1ibHVlKTtcclxuICB9XHJcbiAgLmJsYWNrIHtcclxuICAgIGNvbG9yOiB3aGl0ZTtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWJsYWNrKTtcclxuICB9XHJcbiAgLnJlZCB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS1yZWQpO1xyXG4gIH1cclxuICAud2hpdGUge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0td2hpdGUpO1xyXG4gIH1cclxuICAuZ3JlZW4ge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0tZ3JlZW4pO1xyXG4gIH1cclxuICAuY29sb3JsZXNzIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWNvbG9ybGVzcyk7XHJcbiAgfVxyXG4gIC5nZW5lcmljIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IGdvbGRlbnJvZDtcclxuICB9XHJcbiAgLnN1bSB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiBnb2xkZW5yb2Q7XHJcbiAgfVxyXG5cclxuICAuY29sb3ItcGFyYW0ge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgfVxyXG5cclxuICAubWFuYS1jdXJ2ZSB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcclxuICB9XHJcblxyXG4gIC5hbGwtY3VydmVzIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWdyb3c6IDE7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gICAgaGVpZ2h0OiA4MHB4O1xyXG4gIH1cclxuXHJcbiAgLmFsbC1sYWJlbHMge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtc2hyaW5rOiAwO1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICB9XHJcblxyXG4gIC5jdXJ2ZS1lbGVtZW50IHtcclxuICAgIHdpZHRoOiAyMHB4O1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIGJvdHRvbTogMDtcclxuICAgIGJhY2tncm91bmQ6IGdyYXk7XHJcbiAgICAvKiB2ZXJ0aWNhbC1hbGlnbjogbWlkZGxlOyAqL1xyXG4gICAgYWxpZ24taXRlbXM6IGNlbnRlcjtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICB9XHJcblxyXG4gIC5jdXJ2ZS1sYWJlbCB7XHJcbiAgICB3aWR0aDogMjBweDtcclxuICB9XHJcbiAgLmN1cnZlLXdyYXBwZXIge1xyXG4gICAgd2lkdGg6IDIwcHg7XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgICBjdXJzb3I6IHBvaW50ZXI7XHJcbiAgfVxyXG5cclxuICAuY3VydmUtZWxlbWVudDpob3ZlciB7XHJcbiAgICBiYWNrZ3JvdW5kOiBsaWdodGNvcmFsO1xyXG4gIH1cclxuXHJcbiAgLmhpZ2hsaWdodGVkIC5jdXJ2ZS1lbGVtZW50IHtcclxuICAgIGJhY2tncm91bmQ6IGxpZ2h0Ymx1ZTtcclxuICB9XHJcblxyXG4gIC5jdXJ2ZS1sYWJlbC5oaWdobGlnaHRlZCB7XHJcbiAgICBiYWNrZ3JvdW5kOiBsaWdodGJsdWU7XHJcbiAgfVxyXG5cclxuICAuY3VydmUtbGFiZWw6aG92ZXIge1xyXG4gICAgYmFja2dyb3VuZDogbGlnaHRjb3JhbDtcclxuICB9XHJcblxyXG4gIGg0IHtcclxuICAgIG1hcmdpbi10b3A6IDVweDtcclxuICAgIG1hcmdpbi1ib3R0b206IDVweDtcclxuICB9XHJcblxyXG4gIC5sZHMtcmlwcGxlIHtcclxuICAgIGRpc3BsYXk6IGlubGluZS1ibG9jaztcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICAgIHdpZHRoOiA4MHB4O1xyXG4gICAgaGVpZ2h0OiA4MHB4O1xyXG4gIH1cclxuICAubGRzLXJpcHBsZSBkaXYge1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgYm9yZGVyOiA0cHggc29saWQgI2ZmZjtcclxuICAgIG9wYWNpdHk6IDE7XHJcbiAgICBib3JkZXItcmFkaXVzOiA1MCU7XHJcbiAgICBhbmltYXRpb246IGxkcy1yaXBwbGUgMXMgY3ViaWMtYmV6aWVyKDAsIDAuMiwgMC44LCAxKSBpbmZpbml0ZTtcclxuICB9XHJcblxyXG4gIC5jYXJkLXNlYXJjaCAubGRzLXJpcHBsZSBkaXYge1xyXG4gICAgYm9yZGVyOiA0cHggc29saWQgYmxhY2s7XHJcbiAgfVxyXG5cclxuICAubGRzLXJpcHBsZSBkaXY6bnRoLWNoaWxkKDIpIHtcclxuICAgIGFuaW1hdGlvbi1kZWxheTogLTAuNXM7XHJcbiAgfVxyXG4gIEBrZXlmcmFtZXMgbGRzLXJpcHBsZSB7XHJcbiAgICAwJSB7XHJcbiAgICAgIHRvcDogMzZweDtcclxuICAgICAgbGVmdDogMzZweDtcclxuICAgICAgd2lkdGg6IDA7XHJcbiAgICAgIGhlaWdodDogMDtcclxuICAgICAgb3BhY2l0eTogMTtcclxuICAgIH1cclxuICAgIDEwMCUge1xyXG4gICAgICB0b3A6IDBweDtcclxuICAgICAgbGVmdDogMHB4O1xyXG4gICAgICB3aWR0aDogNzJweDtcclxuICAgICAgaGVpZ2h0OiA3MnB4O1xyXG4gICAgICBvcGFjaXR5OiAwO1xyXG4gICAgfVxyXG4gIH1cclxuPC9zdHlsZT5cclxuXHJcbjxzdmVsdGU6d2luZG93XHJcbiAgb246bW91c2V1cD17b25NYWluTW91c2VEb3dufVxyXG4gIG9uOmNvbnRleHRtZW51fHByZXZlbnREZWZhdWx0PXsoKSA9PiBmYWxzZX1cclxuICBvbjprZXl1cD17bWFpbktleVVwfVxyXG4gIG9uOmtleWRvd249e21haW5LZXlEb3dufSAvPlxyXG48ZGl2IGNsYXNzPVwiY29udGVudFwiPlxyXG4gIDxkaXYgY2xhc3M9XCJjb250cm9sc1wiPlxyXG4gICAgPGRpdiBjbGFzcz1cImhlbHBcIj5cclxuICAgICAgPGRpdiBjbGFzcz1cImhlbHAtc3ltYm9sXCIgb246Y2xpY2s9e29wZW5IZWxwfT4/PC9kaXY+XHJcbiAgICAgIHsjaWYgaGVscEFjdGl2ZX1cclxuICAgICAgICA8aDQ+SG93IHRvIHVzZTo8L2g0PlxyXG4gICAgICAgIDxwPnBhc3RlIHlvdXIgZGVjayB0byB0aGUgZm9sbG93aW5nIGlucHV0LjwvcD5cclxuICAgICAgICA8dWw+XHJcbiAgICAgICAgICA8bGk+XHJcbiAgICAgICAgICAgIHdoZW4gYSBsaW5lIHN0YXJ0cyB3aXRoIFwiI1wiIGl0IHdpbGwgYmUgaW50ZXJwcmV0ZWQgYXMgaGVhZGxpbmVcclxuICAgICAgICAgIDwvbGk+XHJcbiAgICAgICAgICA8bGk+XHJcbiAgICAgICAgICAgIGEgY2FyZCBjYW4gYmUgZW50ZXJlZCB3aXRoIGEgbGVhZGluZyBjb3VudCwgb3IganVzdCB3aXRoIGl0cyBuYW1lXHJcbiAgICAgICAgICA8L2xpPlxyXG4gICAgICAgICAgPGxpPnVzZSB0aGUgXCJFU0NcIiBrZXkgdG8gcmVhbG9hZCB0aGUgcHJldmlldzwvbGk+XHJcbiAgICAgICAgICA8bGk+ZG91YmxlY2xpY2sgYSBjYXJkIHRvIHJlbW92ZSBpdDwvbGk+XHJcbiAgICAgICAgPC91bD5cclxuICAgICAgICA8cD5OT1RFOiB3ZSB1c2UgY29va2llcyB0byBzdG9yZSB5b3VyIGRlY2sgYWZ0ZXIgcmVsb2FkLjwvcD5cclxuICAgICAgICA8cD5OT1RFOiBUaGlzIGlzIG5vdCBhbiBvZmZpY2lhbCBNYWdpYyBwcm9kdWt0LjwvcD5cclxuICAgICAgey9pZn1cclxuXHJcbiAgICAgIHsjYXdhaXQgcHJvbWlzZX1cclxuXHJcbiAgICAgICAgPGRpdj5sb2FkaW5nOiB7cHJvZ3Jlc3N9L3thbGx9PC9kaXY+XHJcbiAgICAgIHs6dGhlbiBncm91cHN9XHJcblxyXG4gICAgICAgIHsjaWYgIWhlbHBBY3RpdmV9XHJcbiAgICAgICAgICA8aDQ+R2VuZXJhbDwvaDQ+XHJcblxyXG4gICAgICAgICAgPGRpdj5Ub3RhbCBjYXJkczoge2dyb3Vwc1snY2FyZENvdW50J119PC9kaXY+XHJcbiAgICAgICAgICA8ZGl2PlxyXG4gICAgICAgICAgICBMYW5kczoge2dyb3Vwc1snbGFuZENvdW50J119IE5vbmxhbmRzOiB7Z3JvdXBzWydjYXJkQ291bnQnXSAtIGdyb3Vwc1snbGFuZENvdW50J119XHJcbiAgICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgIGNsYXNzPVwidHlwZS1zZWxlY3RvclwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXsoKSA9PiBoaWdobGlnaHRDcmVhdHVyZSgnY3JlYXR1cmUnKX1cclxuICAgICAgICAgICAgY2xhc3M6aGlnaGxpZ2h0ZWQtY3JlYXR1cmU9eydjcmVhdHVyZScgPT0gaGlnaGxpZ2h0ZWRDcmVhdHVyZX0+XHJcbiAgICAgICAgICAgIENyZWF0dXJlczoge2dyb3Vwc1snY3JlYXR1cmVDb3VudCddfVxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgIGNsYXNzPVwidHlwZS1zZWxlY3RvclwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXsoKSA9PiBoaWdobGlnaHRDcmVhdHVyZSgnaW5zdGFudCcpfVxyXG4gICAgICAgICAgICBjbGFzczpoaWdobGlnaHRlZC1jcmVhdHVyZT17J2luc3RhbnQnID09IGhpZ2hsaWdodGVkQ3JlYXR1cmV9PlxyXG4gICAgICAgICAgICBJbnN0YW50czoge2dyb3Vwc1snaW5zdGFudENvdW50J119XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgY2xhc3M9XCJ0eXBlLXNlbGVjdG9yXCJcclxuICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodENyZWF0dXJlKCdzb3JjZXJ5Jyl9XHJcbiAgICAgICAgICAgIGNsYXNzOmhpZ2hsaWdodGVkLWNyZWF0dXJlPXsnc29yY2VyeScgPT0gaGlnaGxpZ2h0ZWRDcmVhdHVyZX0+XHJcbiAgICAgICAgICAgIFNvcmNlcmllczoge2dyb3Vwc1snc29yY2VyeUNvdW50J119XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgY2xhc3M9XCJ0eXBlLXNlbGVjdG9yXCJcclxuICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodENyZWF0dXJlKCdlbmNoYW50bWVudCcpfVxyXG4gICAgICAgICAgICBjbGFzczpoaWdobGlnaHRlZC1jcmVhdHVyZT17J2VuY2hhbnRtZW50JyA9PSBoaWdobGlnaHRlZENyZWF0dXJlfT5cclxuICAgICAgICAgICAgRW5jaGFudG1lbnRzOiB7Z3JvdXBzWydlbmNoYW50bWVudENvdW50J119XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgY2xhc3M9XCJ0eXBlLXNlbGVjdG9yXCJcclxuICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodENyZWF0dXJlKCdhcnRpZmFjdCcpfVxyXG4gICAgICAgICAgICBjbGFzczpoaWdobGlnaHRlZC1jcmVhdHVyZT17J2FydGlmYWN0JyA9PSBoaWdobGlnaHRlZENyZWF0dXJlfT5cclxuICAgICAgICAgICAgQXJ0aWZhY3RzOiB7Z3JvdXBzWydhcnRpZmFjdENvdW50J119XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgY2xhc3M9XCJ0eXBlLXNlbGVjdG9yXCJcclxuICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodENyZWF0dXJlKCdwbGFuZXN3YWxrZXInKX1cclxuICAgICAgICAgICAgY2xhc3M6aGlnaGxpZ2h0ZWQtY3JlYXR1cmU9eydwbGFuZXN3YWxrZXInID09IGhpZ2hsaWdodGVkQ3JlYXR1cmV9PlxyXG4gICAgICAgICAgICBQbGFuZXN3YWxrZXI6IHtncm91cHNbJ3BsYW5lc3dhbGtlckNvdW50J119XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJhbGwtdHlwZS1jb3VudFwiPlxyXG4gICAgICAgICAgICB7I2VhY2ggZ3JvdXBzWyd0eXBlTmFtZXMnXSBhcyB0eXBlTmFtZX1cclxuICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICBjbGFzcz1cInR5cGUtc2VsZWN0b3JcIlxyXG4gICAgICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodENyZWF0dXJlKHR5cGVOYW1lKX1cclxuICAgICAgICAgICAgICAgIGNsYXNzOmhpZ2hsaWdodGVkLWNyZWF0dXJlPXt0eXBlTmFtZSA9PSBoaWdobGlnaHRlZENyZWF0dXJlfT5cclxuICAgICAgICAgICAgICAgIHt0eXBlTmFtZX06IHtncm91cHNbJ3R5cGVDb3VudHMnXVt0eXBlTmFtZV19XHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgIHsvZWFjaH1cclxuXHJcbiAgICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgICA8ZGl2PkNvc3Q6IHtncm91cHMuY29zdC50b0ZpeGVkKDIpICsgJyQnfTwvZGl2PlxyXG5cclxuICAgICAgICAgIHsjaWYgc3RhdGlzdGljc0FjdGl2ZX1cclxuICAgICAgICAgICAgPGRpdiBjbGFzcz1cInN0YXRpc3RpY3NcIj5cclxuICAgICAgICAgICAgICA8aDQ+RGV2b3Rpb248L2g0PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJtYW5hLWRldm90aW9uXCI+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBibHVlXCI+e2dyb3Vwc1snbWFuYSddLmJsdWV9PC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBibGFja1wiPntncm91cHNbJ21hbmEnXS5ibGFja308L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIHJlZFwiPntncm91cHNbJ21hbmEnXS5yZWR9PC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSB3aGl0ZVwiPntncm91cHNbJ21hbmEnXS53aGl0ZX08L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGdyZWVuXCI+e2dyb3Vwc1snbWFuYSddLmdyZWVufTwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgY29sb3JsZXNzXCI+XHJcbiAgICAgICAgICAgICAgICAgIHtncm91cHNbJ21hbmEnXS5jb2xvcmxlc3N9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgICAgICAgPGg0PkdlbmVyaWMgTWFuYTwvaDQ+XHJcbiAgICAgICAgICAgICAgPGRpdj5SZW1haW5pbmcgZ2VuZXJpYyBtYW5hIGNvc3RzOntncm91cHNbJ21hbmEnXS5nZW5lcmljfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXY+Q01DLU1hbmEtU3VtOntncm91cHNbJ21hbmEnXS5zdW19PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdj5cclxuICAgICAgICAgICAgICAgIEF2ZXJhZ2UgQ01DIHBlciBOb25sYW5kOiB7Z3JvdXBzWydhdmVyYWdlTWFuYSddLnRvRml4ZWQoMil9XHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgPGg0PlN1Z2dlc3RlZCBNYW5hIERpc3RyaWJ1dGlvbjwvaDQ+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cIm1hbmEtcHJvcG9zYWxcIj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGJsdWVcIj5cclxuICAgICAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLmJsdWUgKiBncm91cHNbJ2xhbmRDb3VudCddKS50b0ZpeGVkKDEpfVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBibGFja1wiPlxyXG4gICAgICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10uYmxhY2sgKiBncm91cHNbJ2xhbmRDb3VudCddKS50b0ZpeGVkKDEpfVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSByZWRcIj5cclxuICAgICAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLnJlZCAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIHdoaXRlXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS53aGl0ZSAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGdyZWVuXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS5ncmVlbiAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGNvbG9ybGVzc1wiPlxyXG4gICAgICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10uY29sb3JsZXNzICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgIDxoND5NYW5hIEN1cnZlPC9oND5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwibWFuYS1jdXJ2ZVwiPlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImFsbC1jdXJ2ZXNcIj5cclxuICAgICAgICAgICAgICAgICAgeyNlYWNoIGdyb3Vwc1snbWFuYUN1cnZlJ10gYXMgbWFuYSwgaX1cclxuICAgICAgICAgICAgICAgICAgICB7I2lmIG1hbmEgPiAwfVxyXG4gICAgICAgICAgICAgICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImN1cnZlLXdyYXBwZXJcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzczpoaWdobGlnaHRlZD17ZGV2b3Rpb25IaWdobGlnaHQgPT0gaX1cclxuICAgICAgICAgICAgICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodERldm90aW9uKGkpfT5cclxuICAgICAgICAgICAgICAgICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiY3VydmUtZWxlbWVudFwiXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3R5bGU9eydoZWlnaHQ6JyArIGdldEhlaWdodChtYW5hLCBncm91cHMpICsgJyU7J30+XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAge21hbmEgfHwgJyd9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgICAgICAgey9lYWNofVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcblxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImFsbC1sYWJlbHNcIj5cclxuICAgICAgICAgICAgICAgICAgeyNlYWNoIGdyb3Vwc1snbWFuYUN1cnZlJ10gYXMgbWFuYSwgaX1cclxuICAgICAgICAgICAgICAgICAgICB7I2lmIG1hbmEgPiAwfVxyXG4gICAgICAgICAgICAgICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImN1cnZlLWxhYmVsXCJcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M6aGlnaGxpZ2h0ZWQ9e2Rldm90aW9uSGlnaGxpZ2h0ID09IGl9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG9uOmNsaWNrPXsoKSA9PiBoaWdobGlnaHREZXZvdGlvbihpKX0+XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHtpfVxyXG4gICAgICAgICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgICAgICAgey9lYWNofVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgey9pZn1cclxuICAgICAgICB7L2lmfVxyXG4gICAgICAgIDxkaXY+XHJcbiAgICAgICAgICBzZWFyY2g6XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgYmluZDp0aGlzPXtkZWNrU2VhcmNoSW5wdXR9XHJcbiAgICAgICAgICAgIHRpdGxlPVwiZS5nLjogc2FjcmlmaWNlIGEgKGFydGlmYWN0fGNyZWF0dXJlKVwiXHJcbiAgICAgICAgICAgIG9uOmtleXVwPXsoKSA9PiBjaGFuZ2VEZWNrU2VhcmNoKGdyb3Vwcyl9IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgIHs6Y2F0Y2ggZXJyb3J9XHJcbiAgICAgICAge2Vycm9yfVxyXG4gICAgICB7L2F3YWl0fVxyXG4gICAgICBGb3JtYXQ6XHJcbiAgICAgIDxzZWxlY3RcclxuICAgICAgICBiaW5kOnRoaXM9e2Zvcm1hdH1cclxuICAgICAgICBvbjpibHVyPXtyZWxvYWR9XHJcbiAgICAgICAgb246Y2hhbmdlPXtyZWxvYWR9XHJcbiAgICAgICAgdGl0bGU9XCJzZWxlY3QgdGhlIGxlZ2FsaXR5IGNoZWNrZXJcIj5cclxuICAgICAgICA8b3B0aW9uIHNlbGVjdGVkPmNvbW1hbmRlcjwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+YnJhd2w8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPmR1ZWw8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPmZ1dHVyZTwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+aGlzdG9yaWM8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPmxlZ2FjeTwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+bW9kZXJuPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5vbGRzY2hvb2w8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnBhdXBlcjwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+cGVubnk8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnBpb25lZXI8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnN0YW5kYXJkPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj52aW50YWdlPC9vcHRpb24+XHJcbiAgICAgIDwvc2VsZWN0PlxyXG4gICAgICA8ZGl2IGNsYXNzPVwic2xpZGVjb250YWluZXJcIj5cclxuICAgICAgICBTY2FsZTpcclxuICAgICAgICA8aW5wdXRcclxuICAgICAgICAgIHR5cGU9XCJyYW5nZVwiXHJcbiAgICAgICAgICBtaW49XCIyNVwiXHJcbiAgICAgICAgICBtYXg9XCIxMDBcIlxyXG4gICAgICAgICAgYmluZDp2YWx1ZT17c2NhbGluZ31cclxuICAgICAgICAgIHRpdGxlPVwic2NhbGVzIHRoZSBjYXJkIHNpemUgaW4gdGhlIHJpZ2h0IHZpZXdcIiAvPlxyXG4gICAgICA8L2Rpdj5cclxuICAgICAgPGRpdiBjbGFzcz1cInNhdmUtY29udGFpbmVyXCI+XHJcbiAgICAgICAgU2F2ZSA6XHJcbiAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICBiaW5kOnRoaXM9e2RlY2tOYW1lSW5wdXR9XHJcbiAgICAgICAgICBvbjprZXl1cD17b25EZWNrTmFtZVR5cGV9XHJcbiAgICAgICAgICB2YWx1ZT17Q29va2llcy5nZXQoJ2RlY2tOYW1lJykgfHwgJ3Vua25vd25fZGVjayd9XHJcbiAgICAgICAgICB0aXRsZT1cIlRoZSBuYW1lIG9mIHRoZSBkZWNrIGZvciBzYXZpbmdcIiAvPlxyXG4gICAgICAgIDxidXR0b25cclxuICAgICAgICAgIG9uOmNsaWNrPXtzYXZlRGVja31cclxuICAgICAgICAgIHRpdGxlPVwidGhpcyB3aWxsIGRvd25sb2FkIHlvdSBhIGZpbGUsIGNhbGxlZCBsaWtlIHlvdSBwcm92aWRlIGluIHRoZVxyXG4gICAgICAgICAgZGVja1wiPlxyXG4gICAgICAgICAgc2F2ZVxyXG4gICAgICAgIDwvYnV0dG9uPlxyXG4gICAgICA8L2Rpdj5cclxuICAgICAgPGJ1dHRvblxyXG4gICAgICAgIG9uOmNsaWNrPXt0b2dnbGVTdGF0aXN0aWNzfVxyXG4gICAgICAgIHRpdGxlPVwidG9nZ2xlcyB0aGUgdmlzaWJpbGl0eSBvZiB0aGUgc3RhdGlzdGlja3NcIj5cclxuICAgICAgICB7c3RhdGlzdGljc0FjdGl2ZSA/ICdoaWRlIHN0YXRpc3RpY3MnIDogJ3Nob3cgc3RhdGlzdGljcyd9XHJcbiAgICAgIDwvYnV0dG9uPlxyXG5cclxuICAgICAgPGJ1dHRvbiBvbjpjbGljaz17dG9nZ2xlUGxheVRlc3R9IHRpdGxlPVwidGVzdCB5b3VyIGRlY2tcIj5wbGF5dGVzdDwvYnV0dG9uPlxyXG5cclxuICAgICAgPGJ1dHRvblxyXG4gICAgICAgIG9uOmNsaWNrPXtzb3J0RGVja1N0cmluZ31cclxuICAgICAgICB0aXRsZT1cInRoaXMgc29ydHMgdGhlIGRlY2sgdG8gbGFuZHMgc3BlbGxzIGFuZCBjcmVhdHVyZXMgLU5PVEU6IHlvdXJcclxuICAgICAgICBncm91cHMgd2lsbCBiZSByZXBsYWNlZFwiPlxyXG4gICAgICAgIHNvcnRcclxuICAgICAgPC9idXR0b24+XHJcbiAgICAgIDxidXR0b25cclxuICAgICAgICBvbjpjbGljaz17Y29weURlY2t9XHJcbiAgICAgICAgdGl0bGU9XCJ0aGlzIGNvcGllcyB0aGUgZGVjayB3aXRob3V0IGdyb3VwcyBhbmQgc3R1ZmYgdG8geW91ciBjbGlwYm9hcmRcIj5cclxuICAgICAgICBjbGVhbiBjb3B5XHJcbiAgICAgIDwvYnV0dG9uPlxyXG4gICAgICA8YnV0dG9uXHJcbiAgICAgICAgb246Y2xpY2s9e2NsZWFuU3RyaW5nfVxyXG4gICAgICAgIHRpdGxlPVwiY2xlYW5zIHRoZSBpbnB1dCBzdHJpbmcgZnJvbSBjb21tZW50cyBhbmQgbmV3bGluZXNcIj5cclxuICAgICAgICBjbGVhbiBzdHJpbmdcclxuICAgICAgPC9idXR0b24+XHJcbiAgICAgIDxidXR0b25cclxuICAgICAgICBvbjpjbGljaz17c2hhcmVEZWNrfVxyXG4gICAgICAgIHRpdGxlPVwiY29waWVzIGEgc3RyaW5nIHRvIHlvdXIgY2xpcGJvYXJkLCB0aGF0IHNoYXJlcyB0aGlzIGRlY2sgd2l0aFxyXG4gICAgICAgIG90aGVyc1wiPlxyXG4gICAgICAgIHNoYXJlXHJcbiAgICAgIDwvYnV0dG9uPlxyXG5cclxuICAgICAgPGJ1dHRvbiBvbjpjbGljaz17cmVsb2FkfT5yZWZyZXNoPC9idXR0b24+XHJcbiAgICA8L2Rpdj5cclxuICAgIDx0ZXh0YXJlYSBiaW5kOnRoaXM9e2lucHV0fSBjbGFzcz1cImlucHV0XCIgb246a2V5dXA9e29uVHlwaW5nfSAvPlxyXG4gIDwvZGl2PlxyXG5cclxuICA8ZGl2IGNsYXNzPVwiZGlzcGxheVwiIGJpbmQ6dGhpcz17ZGlzcGxheX0+XHJcbiAgICB7I2F3YWl0IHByb21pc2V9XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJsb2FkaW5nLXdyYXBwZXJcIj5cclxuICAgICAgICA8ZGl2PmxvYWRpbmc6IHtwcm9ncmVzc30ve2FsbH08L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwibGRzLXJpcHBsZVwiPlxyXG4gICAgICAgICAgPGRpdiAvPlxyXG4gICAgICAgICAgPGRpdiAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICA8L2Rpdj5cclxuICAgIHs6dGhlbiBncm91cHN9XHJcblxyXG4gICAgICB7I2VhY2ggZGVja1NlYWNoIHx8IGdyb3VwcyB8fCBbXSBhcyBncm91cH1cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXBcIj5cclxuXHJcbiAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtaGVhZGVyXCI+XHJcbiAgICAgICAgICAgIDxoMj57Z3JvdXAubmFtZSArICcgLy8gJyArIGdyb3VwLmNvdW50IHx8ICdubyBuYW1lJ308L2gyPlxyXG4gICAgICAgICAgICA8YnV0dG9uIG9uOmNsaWNrPXsoKSA9PiB0b2dnbGVHcm91cFZpc2liaWxpdHkoZ3JvdXApfT5cclxuICAgICAgICAgICAgICB0b2dnbGVcclxuICAgICAgICAgICAgPC9idXR0b24+XHJcbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC1zdGF0aXN0aWNzXCI+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGJsdWVcIj57Z3JvdXAubWFuYS5ibHVlfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSBibGFja1wiPntncm91cC5tYW5hLmJsYWNrfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSByZWRcIj57Z3JvdXAubWFuYS5yZWR9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIHdoaXRlXCI+e2dyb3VwLm1hbmEud2hpdGV9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGdyZWVuXCI+e2dyb3VwLm1hbmEuZ3JlZW59PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGNvbG9ybGVzc1wiPntncm91cC5tYW5hLmNvbG9ybGVzc308L2Rpdj5cclxuICAgICAgICAgICAgICA8IS0tIGdlbmVyaWM6XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGdlbmVyaWNcIj57Z3JvdXAubWFuYS5nZW5lcmljfTwvZGl2PiAtLT5cclxuICAgICAgICAgICAgICBzdW06XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIHN1bVwiPntncm91cC5tYW5hLnN1bX08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgZ3JvdXAtY29zdFwiPlxyXG4gICAgICAgICAgICAgICAge2dyb3VwLmNvc3QudG9GaXhlZCgyKSArICckJ31cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICBjaGFuY2VzOlxyXG4gICAgICAgICAgICAgIDwhLS0gPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIHN1bVwiPntncm91cC5jaGFuY2VzfTwvZGl2PiAtLT5cclxuICAgICAgICAgICAgPC9kaXY+XHJcblxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgIGNsYXNzPVwiZ3JvdXAtY29udGVudFwiXHJcbiAgICAgICAgICAgIGNsYXNzOmhpZGRlbj17aGlkZGVuR3JvdXBzLmhhcyhncm91cC5uYW1lKX0+XHJcblxyXG4gICAgICAgICAgICB7I2VhY2ggZ3JvdXAuY2FyZHMgYXMgY2FyZH1cclxuICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICBjbGFzcz1cImVudHJ5XCJcclxuICAgICAgICAgICAgICAgIHN0eWxlPXsnd2lkdGg6JyArIHdpZHRoICsgJ3B4OyBoZWlnaHQ6JyArIChjYXJkLmNvdW50IDw9IDQgPyBoZWlnaHQgKyAoKGNhcmQuY291bnQgfHwgMSkgLSAxKSAqIDQwIDogaGVpZ2h0ICsgMyAqIDQwKSArICdweDsnfT5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJzaG9waW5nXCI+XHJcbiAgICAgICAgICAgICAgICAgIDxhXHJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJsaW5rXCJcclxuICAgICAgICAgICAgICAgICAgICBocmVmPXtjYXJkLmRhdGEucHVyY2hhc2VfdXJpcy5jYXJkbWFya2V0fVxyXG4gICAgICAgICAgICAgICAgICAgIHRhcmdldD1cIl9ibGFua1wiPlxyXG4gICAgICAgICAgICAgICAgICAgICYjMTI4NzIyO1xyXG4gICAgICAgICAgICAgICAgICA8L2E+XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIHsjZWFjaCB7IGxlbmd0aDogY2FyZC5jb3VudCA+IDQgPyA0IDogY2FyZC5jb3VudCB9IGFzIF8sIGl9XHJcbiAgICAgICAgICAgICAgICAgIDxpbWdcclxuICAgICAgICAgICAgICAgICAgICBjbGFzczpiYW5uZWQ9e2NhcmQuZGF0YS5sZWdhbGl0aWVzW2Zvcm1hdC52YWx1ZV0gIT09ICdsZWdhbCd9XHJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M6aGlnaGxpZ2h0ZWQ9e2Rldm90aW9uSGlnaGxpZ2h0ID09IGNhcmQuZGF0YS5jbWN9XHJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M6dHlwZS1oaWdobGlnaHQ9e2hpZ2hsaWdodGVkQ3JlYXR1cmUgJiYgY2FyZC5kYXRhLnR5cGVfbGluZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAudG9Mb3dlckNhc2UoKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAuaW5jbHVkZXMoaGlnaGxpZ2h0ZWRDcmVhdHVyZSl9XHJcbiAgICAgICAgICAgICAgICAgICAgb246bW91c2V1cHxzdG9wUHJvcGFnYXRpb249e2V2dCA9PiBjYXJkQ29udGV4dE1lbnUoZXZ0LCBjYXJkLCBncm91cHMpfVxyXG4gICAgICAgICAgICAgICAgICAgIG9uOmRibGNsaWNrPXsoKSA9PiByZW1vdmUoY2FyZCl9XHJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJjYXJkXCJcclxuICAgICAgICAgICAgICAgICAgICBzdHlsZT17J21hcmdpbi10b3A6ICcgKyBpICogNDAgKyAncHgnfVxyXG4gICAgICAgICAgICAgICAgICAgIHNyYz17Y2FyZC51cmx9XHJcbiAgICAgICAgICAgICAgICAgICAgYWx0PXtjYXJkLm5hbWV9XHJcbiAgICAgICAgICAgICAgICAgICAge3dpZHRofVxyXG4gICAgICAgICAgICAgICAgICAgIHtoZWlnaHR9IC8+XHJcbiAgICAgICAgICAgICAgICB7L2VhY2h9XHJcblxyXG4gICAgICAgICAgICAgICAgeyNpZiBjYXJkLmRhdGEubGVnYWxpdGllc1tmb3JtYXQudmFsdWVdICE9PSAnbGVnYWwnfVxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiYmFubmVkLXRleHRcIj5CQU5ORUQ8L2Rpdj5cclxuICAgICAgICAgICAgICAgIHsvaWZ9XHJcbiAgICAgICAgICAgICAgICB7I2lmIGNhcmQuY291bnQgPiA0fVxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiY291bnRcIj57Y2FyZC5jb3VudH14PC9kaXY+XHJcbiAgICAgICAgICAgICAgICB7L2lmfVxyXG5cclxuICAgICAgICAgICAgICAgIHsjaWYgc2NhbGluZyA+IDkwfVxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwicHJpY2VcIj57Y2FyZC5kYXRhLnByaWNlcy51c2QgKyAnJCcgfHwgJz8/Pyd9PC9kaXY+XHJcbiAgICAgICAgICAgICAgICB7L2lmfVxyXG5cclxuICAgICAgICAgICAgICAgIHsjaWYgY3VycmVudENhcmRDb250ZXh0ID09PSBjYXJkfVxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiY2FyZC1jb250ZXh0LW1lbnVcIj5cclxuXHJcbiAgICAgICAgICAgICAgICAgICAgeyNlYWNoIGdyb3VwcyBhcyBzdWJHcm91cH1cclxuICAgICAgICAgICAgICAgICAgICAgIHsjaWYgZ3JvdXAubmFtZSAhPSBzdWJHcm91cC5uYW1lfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJjYXJkLWNvbnRleHQtZW50cnlcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgIG9uOm1vdXNlZG93bj17ZXZ0ID0+IGNhcmRDb250ZXh0Q2xpY2soZXZ0LCBjYXJkLCBzdWJHcm91cCl9PlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHtzdWJHcm91cC5uYW1lfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgICAgICAgIHsvaWZ9XHJcbiAgICAgICAgICAgICAgICAgICAgey9lYWNofVxyXG4gICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIHsvaWZ9XHJcblxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICB7L2VhY2h9XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgey9lYWNofVxyXG5cclxuICAgIHs6Y2F0Y2ggZXJyb3J9XHJcblxyXG4gICAgICA8ZGl2IGNsYXNzPVwiZXJyb3JcIj5cclxuICAgICAgICBFUlJPUiwgY2hlY2sgeW91ciBkZWNrbGlzdCBmb3IgY29ycmVjdCBmb3JtYXQgb3IgaW50ZXJuZXQgY29ubmVjdGlvblxyXG4gICAgICAgIGJydWRpXHJcbiAgICAgIDwvZGl2PlxyXG4gICAgey9hd2FpdH1cclxuICA8L2Rpdj5cclxuXHJcbiAgeyNpZiBwbGF5VGVzdGVyQWN0aXZlfVxyXG4gICAgPGRpdiBjbGFzcz1cInBsYXktdGVzdGVyXCI+XHJcbiAgICAgIDxQbGF5VGVzdGVyIGJpbmQ6cGxheVRlc3RlckFjdGl2ZSB7cHJvbWlzZX0gLz5cclxuICAgIDwvZGl2PlxyXG4gIHsvaWZ9XHJcblxyXG4gIDxkaXYgY2xhc3M9XCJjYXJkLXNlYXJjaFwiIGNsYXNzOmhpZGU9eyFjYXJkU2VhcmNoQWN0aXZlfT5cclxuICAgIDxkaXYgY2xhc3M9XCJ0b2dnbGUtc2VhcmNoXCIgb246Y2xpY2s9e3RvZ2dsZVNlYXJjaH0+eDwvZGl2PlxyXG4gICAgPGRpdiBjbGFzcz1cInNlYXJjaC1wYXJhbXNcIj5cclxuICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1wYXJhbVwiPlxyXG4gICAgICAgIE5hbWU6XHJcbiAgICAgICAgPGlucHV0IGJpbmQ6dGhpcz17c3BOYW1lfSAvPlxyXG4gICAgICA8L2Rpdj5cclxuICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1wYXJhbVwiPlxyXG4gICAgICAgIFRleHQ6XHJcbiAgICAgICAgPGlucHV0IGJpbmQ6dGhpcz17c3BUZXh0fSAvPlxyXG4gICAgICA8L2Rpdj5cclxuICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1wYXJhbVwiPlxyXG4gICAgICAgIFR5cGU6XHJcbiAgICAgICAgPGlucHV0IGJpbmQ6dGhpcz17c3BUeXBlfSAvPlxyXG4gICAgICA8L2Rpdj5cclxuXHJcbiAgICAgIDxkaXYgY2xhc3M9XCJzZWFyY2gtcGFyYW0gY29sb3ItcGFyYW1cIj5cclxuICAgICAgICBDb21tYW5kZXItQ29sb3JzOlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJibHVlXCI+XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgdHlwZT1cImNoZWNrYm94XCJcclxuICAgICAgICAgICAgb246Y2xpY2s9e2NsZWFyQ29sb3JsZXNzfVxyXG4gICAgICAgICAgICBjbGFzcz1cImJsdWVcIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIQmx1ZX0gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiYmxhY2tcIj5cclxuICAgICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgICB0eXBlPVwiY2hlY2tib3hcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17Y2xlYXJDb2xvcmxlc3N9XHJcbiAgICAgICAgICAgIGNsYXNzPVwiYmxhY2tcIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIQmxhY2t9IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cInJlZFwiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJyZWRcIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIUmVkfSAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJ3aGl0ZVwiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJ3aGl0ZVwiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhXaGl0ZX0gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JlZW5cIj5cclxuICAgICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgICB0eXBlPVwiY2hlY2tib3hcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17Y2xlYXJDb2xvcmxlc3N9XHJcbiAgICAgICAgICAgIGNsYXNzPVwiZ3JlZW5cIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIR3JlZW59IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImNvbG9ybGVzc1wiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckZvckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJjb2xvcmxlc3NcIlxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e3NwRURIQ29sb3JsZXNzfSAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICA8L2Rpdj5cclxuICAgICAgPGJ1dHRvbiBvbjpjbGljaz17c2VhcmNoQ2FyZHN9PnNlYXJjaDwvYnV0dG9uPlxyXG4gICAgPC9kaXY+XHJcblxyXG4gICAgeyNhd2FpdCBjYXJkU2VhcmNoUHJvbWlzZX1cclxuICAgICAgPGRpdiBjbGFzcz1cImxvYWRpbmctd3JhcHBlclwiPlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJsZHMtcmlwcGxlXCI+XHJcbiAgICAgICAgICA8ZGl2IC8+XHJcbiAgICAgICAgICA8ZGl2IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgezp0aGVuIHJlc3VsdH1cclxuXHJcbiAgICAgIHsjaWYgcmVzdWx0LmNvZGUgIT09ICdub3RfZm91bmQnICYmIHJlc3VsdC5kYXRhfVxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJzZWFyY2gtcmVzdWx0XCI+XHJcbiAgICAgICAgICB7I2VhY2ggcmVzdWx0LmRhdGEgYXMgY2FyZH1cclxuICAgICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICAgIGNsYXNzPVwiZW50cnlcIlxyXG4gICAgICAgICAgICAgIHN0eWxlPXsnd2lkdGg6JyArIHdpZHRoICsgJ3B4OyBoZWlnaHQ6JyArIGhlaWdodCArICdweDsnfT5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwic2hvcGluZ1wiPlxyXG4gICAgICAgICAgICAgICAgPGEgY2xhc3M9XCJsaW5rXCIgaHJlZj17Y2FyZC5jYXJkbWFya2V0fSB0YXJnZXQ9XCJfYmxhbmtcIj5cclxuICAgICAgICAgICAgICAgICAgJiMxMjg3MjI7XHJcbiAgICAgICAgICAgICAgICA8L2E+XHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgPGltZ1xyXG4gICAgICAgICAgICAgICAgb246ZGJsY2xpY2s9eygpID0+IGFwcGVuZENhcmQoY2FyZC5uYW1lKX1cclxuICAgICAgICAgICAgICAgIGNsYXNzOmJhbm5lZD17Y2FyZC5sZWdhbGl0aWVzW2Zvcm1hdC52YWx1ZV0gIT09ICdsZWdhbCd9XHJcbiAgICAgICAgICAgICAgICBjbGFzcz1cImNhcmRcIlxyXG4gICAgICAgICAgICAgICAgc3JjPXtjYXJkLnVybH1cclxuICAgICAgICAgICAgICAgIGFsdD17Y2FyZC5uYW1lfVxyXG4gICAgICAgICAgICAgICAge3dpZHRofVxyXG4gICAgICAgICAgICAgICAge2hlaWdodH0gLz5cclxuXHJcbiAgICAgICAgICAgICAgeyNpZiBjYXJkLmxlZ2FsaXRpZXNbZm9ybWF0LnZhbHVlXSAhPT0gJ2xlZ2FsJ31cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJiYW5uZWQtdGV4dFwiPkJBTk5FRDwvZGl2PlxyXG4gICAgICAgICAgICAgIHsvaWZ9XHJcbiAgICAgICAgICAgICAgeyNpZiBzY2FsaW5nID4gOTB9XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwicHJpY2VcIj57Y2FyZC5wcmljZXMudXNkICsgJyQnIHx8ICc/Pz8nfTwvZGl2PlxyXG4gICAgICAgICAgICAgIHsvaWZ9XHJcbiAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgezplbHNlfVxyXG4gICAgICAgICAgICA8ZGl2Pk5vIGNhcmRzIGZvdW5kPC9kaXY+XHJcbiAgICAgICAgICB7L2VhY2h9XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGJ1dHRvblxyXG4gICAgICAgICAgZGlzYWJsZWQ9eyFyZXN1bHQuaGFzX21vcmV9XHJcbiAgICAgICAgICBvbjpjbGljaz17KCkgPT4gc2VhcmNoQ2FyZHMocmVzdWx0Lm5leHRfcGFnZSl9PlxyXG4gICAgICAgICAgbmV4dFxyXG4gICAgICAgIDwvYnV0dG9uPlxyXG4gICAgICB7OmVsc2V9XHJcbiAgICAgICAgPGRpdj5ObyBjYXJkcyBmb3VuZDwvZGl2PlxyXG4gICAgICB7L2lmfVxyXG4gICAgezpjYXRjaCBlcnJvcn1cclxuICAgICAgPGRpdiBjbGFzcz1cImVycm9yXCI+XHJcbiAgICAgICAgRVJST1IsIGNoZWNrIHlvdXIgZGVja2xpc3QgZm9yIGNvcnJlY3QgZm9ybWF0IG9yIGludGVybmV0IGNvbm5lY3Rpb25cclxuICAgICAgICBicnVkaVxyXG4gICAgICA8L2Rpdj5cclxuICAgIHsvYXdhaXR9XHJcblxyXG4gIDwvZGl2PlxyXG48L2Rpdj5cclxuIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQW1lRSxRQUFRLGNBQUMsQ0FBQyxBQUNSLGNBQWMsQ0FBRSxxQkFBcUIsQ0FDckMsY0FBYyxDQUFFLHNCQUFzQixDQUN0QyxXQUFXLENBQUUsbUJBQW1CLENBQ2hDLE9BQU8sQ0FBRSxvQkFBb0IsQ0FDN0IsT0FBTyxDQUFFLGlCQUFpQixDQUMxQixLQUFLLENBQUUsb0JBQW9CLENBQzNCLE9BQU8sQ0FBRSxzQkFBc0IsQ0FDL0IsTUFBTSxDQUFFLHNCQUFzQixBQUNoQyxDQUFDLEFBRUQsUUFBUSxjQUFDLENBQUMsQUFDUixPQUFPLENBQUUsSUFBSSxDQUNiLGNBQWMsQ0FBRSxHQUFHLENBQ25CLEtBQUssQ0FBRSxJQUFJLENBQ1gsTUFBTSxDQUFFLElBQUksQUFDZCxDQUFDLEFBRUQsWUFBWSxjQUFDLENBQUMsQUFDWixhQUFhLENBQUUsR0FBRyxDQUNsQixNQUFNLENBQUUsR0FBRyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQ3ZCLEtBQUssQ0FBRSxJQUFJLENBQ1gsTUFBTSxDQUFFLElBQUksQ0FDWixVQUFVLENBQUUsTUFBTSxDQUNsQixRQUFRLENBQUUsUUFBUSxD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 */";
		append(document.head, style);
	}

	function get_each_context$1(ctx, list, i) {
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

	function get_each_context_1$1(ctx, list, i) {
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

	// (959:6) {#if helpActive}
	function create_if_block_13(ctx) {
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
				h4.className = "svelte-h7vjvw";
				add_location(h4, file$2, 959, 8, 20570);
				add_location(p0, file$2, 960, 8, 20600);
				add_location(li0, file$2, 962, 10, 20672);
				add_location(li1, file$2, 965, 10, 20781);
				add_location(li2, file$2, 968, 10, 20893);
				add_location(li3, file$2, 969, 10, 20954);
				add_location(ul, file$2, 961, 8, 20656);
				add_location(p1, file$2, 971, 8, 21019);
				add_location(p2, file$2, 972, 8, 21089);
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

	// (1122:6) {:catch error}
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

	// (979:6) {:then groups}
	function create_then_block_2(ctx) {
		var t0, div, t1, input_1, dispose;

		var if_block = (!ctx.helpActive) && create_if_block_9(ctx);

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
				add_location(input_1, file$2, 1116, 10, 26917);
				add_location(div, file$2, 1114, 8, 26881);
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
						if_block = create_if_block_9(ctx);
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

	// (981:8) {#if !helpActive}
	function create_if_block_9(ctx) {
		var h4, t1, div0, t2, t3_value = ctx.groups['cardCount'], t3, t4, div1, t5, t6_value = ctx.groups['landCount'], t6, t7, t8_value = ctx.groups['cardCount'] - ctx.groups['landCount'], t8, t9, div2, t10, t11_value = ctx.groups['creatureCount'], t11, t12, div3, t13, t14_value = ctx.groups['instantCount'], t14, t15, div4, t16, t17_value = ctx.groups['sorceryCount'], t17, t18, div5, t19, t20_value = ctx.groups['enchantmentCount'], t20, t21, div6, t22, t23_value = ctx.groups['artifactCount'], t23, t24, div7, t25, t26_value = ctx.groups['planeswalkerCount'], t26, t27, div8, t28, div9, t29, t30_value = ctx.groups.cost.toFixed(2) + '$', t30, t31, if_block_anchor, dispose;

		var each_value_7 = ctx.groups['typeNames'];

		var each_blocks = [];

		for (var i = 0; i < each_value_7.length; i += 1) {
			each_blocks[i] = create_each_block_7(get_each_context_7(ctx, each_value_7, i));
		}

		var if_block = (ctx.statisticsActive) && create_if_block_10(ctx);

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
				h4.className = "svelte-h7vjvw";
				add_location(h4, file$2, 981, 10, 21290);
				add_location(div0, file$2, 983, 10, 21320);
				add_location(div1, file$2, 984, 10, 21377);
				div2.className = "type-selector svelte-h7vjvw";
				toggle_class(div2, "highlighted-creature", 'creature' == ctx.highlightedCreature);
				add_location(div2, file$2, 988, 10, 21510);
				div3.className = "type-selector svelte-h7vjvw";
				toggle_class(div3, "highlighted-creature", 'instant' == ctx.highlightedCreature);
				add_location(div3, file$2, 994, 10, 21766);
				div4.className = "type-selector svelte-h7vjvw";
				toggle_class(div4, "highlighted-creature", 'sorcery' == ctx.highlightedCreature);
				add_location(div4, file$2, 1000, 10, 22018);
				div5.className = "type-selector svelte-h7vjvw";
				toggle_class(div5, "highlighted-creature", 'enchantment' == ctx.highlightedCreature);
				add_location(div5, file$2, 1006, 10, 22271);
				div6.className = "type-selector svelte-h7vjvw";
				toggle_class(div6, "highlighted-creature", 'artifact' == ctx.highlightedCreature);
				add_location(div6, file$2, 1012, 10, 22539);
				div7.className = "type-selector svelte-h7vjvw";
				toggle_class(div7, "highlighted-creature", 'planeswalker' == ctx.highlightedCreature);
				add_location(div7, file$2, 1018, 10, 22795);
				div8.className = "all-type-count svelte-h7vjvw";
				add_location(div8, file$2, 1024, 10, 23066);
				add_location(div9, file$2, 1036, 10, 23486);

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

	// (1026:12) {#each groups['typeNames'] as typeName}
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
				div.className = "type-selector svelte-h7vjvw";
				toggle_class(div, "highlighted-creature", ctx.typeName == ctx.highlightedCreature);
				add_location(div, file$2, 1026, 14, 23163);
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

	// (1039:10) {#if statisticsActive}
	function create_if_block_10(ctx) {
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
				h40.className = "svelte-h7vjvw";
				add_location(h40, file$2, 1040, 14, 23623);
				div0.className = "deck-value blue svelte-h7vjvw";
				add_location(div0, file$2, 1042, 16, 23701);
				div1.className = "deck-value black svelte-h7vjvw";
				add_location(div1, file$2, 1043, 16, 23775);
				div2.className = "deck-value red svelte-h7vjvw";
				add_location(div2, file$2, 1044, 16, 23851);
				div3.className = "deck-value white svelte-h7vjvw";
				add_location(div3, file$2, 1045, 16, 23923);
				div4.className = "deck-value green svelte-h7vjvw";
				add_location(div4, file$2, 1046, 16, 23999);
				div5.className = "deck-value colorless svelte-h7vjvw";
				add_location(div5, file$2, 1047, 16, 24075);
				div6.className = "mana-devotion svelte-h7vjvw";
				add_location(div6, file$2, 1041, 14, 23656);
				h41.className = "svelte-h7vjvw";
				add_location(h41, file$2, 1052, 14, 24219);
				add_location(div7, file$2, 1053, 14, 24256);
				add_location(div8, file$2, 1054, 14, 24336);
				add_location(div9, file$2, 1055, 14, 24396);
				h42.className = "svelte-h7vjvw";
				add_location(h42, file$2, 1058, 14, 24516);
				div10.className = "deck-value blue svelte-h7vjvw";
				add_location(div10, file$2, 1060, 16, 24613);
				div11.className = "deck-value black svelte-h7vjvw";
				add_location(div11, file$2, 1063, 16, 24768);
				div12.className = "deck-value red svelte-h7vjvw";
				add_location(div12, file$2, 1066, 16, 24925);
				div13.className = "deck-value white svelte-h7vjvw";
				add_location(div13, file$2, 1069, 16, 25078);
				div14.className = "deck-value green svelte-h7vjvw";
				add_location(div14, file$2, 1072, 16, 25235);
				div15.className = "deck-value colorless svelte-h7vjvw";
				add_location(div15, file$2, 1075, 16, 25392);
				div16.className = "mana-proposal svelte-h7vjvw";
				add_location(div16, file$2, 1059, 14, 24568);
				h43.className = "svelte-h7vjvw";
				add_location(h43, file$2, 1079, 14, 25577);
				div17.className = "all-curves svelte-h7vjvw";
				add_location(div17, file$2, 1081, 16, 25654);
				div18.className = "all-labels svelte-h7vjvw";
				add_location(div18, file$2, 1098, 16, 26337);
				div19.className = "mana-curve svelte-h7vjvw";
				add_location(div19, file$2, 1080, 14, 25612);
				div20.className = "statistics svelte-h7vjvw";
				add_location(div20, file$2, 1039, 12, 23583);
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

	// (1084:20) {#if mana > 0}
	function create_if_block_12(ctx) {
		var div1, div0, t_value = ctx.mana || '', t, div0_style_value, dispose;

		function click_handler_7() {
			return ctx.click_handler_7(ctx);
		}

		return {
			c: function create() {
				div1 = element("div");
				div0 = element("div");
				t = text(t_value);
				div0.className = "curve-element svelte-h7vjvw";
				div0.style.cssText = div0_style_value = 'height:' + getHeight(ctx.mana, ctx.groups) + '%;';
				add_location(div0, file$2, 1088, 24, 26005);
				div1.className = "curve-wrapper svelte-h7vjvw";
				toggle_class(div1, "highlighted", ctx.devotionHighlight == ctx.i);
				add_location(div1, file$2, 1084, 22, 25796);
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

	// (1083:18) {#each groups['manaCurve'] as mana, i}
	function create_each_block_6(ctx) {
		var if_block_anchor;

		var if_block = (ctx.mana > 0) && create_if_block_12(ctx);

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
						if_block = create_if_block_12(ctx);
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

	// (1101:20) {#if mana > 0}
	function create_if_block_11(ctx) {
		var div, t, dispose;

		function click_handler_8() {
			return ctx.click_handler_8(ctx);
		}

		return {
			c: function create() {
				div = element("div");
				t = text(ctx.i);
				div.className = "curve-label svelte-h7vjvw";
				toggle_class(div, "highlighted", ctx.devotionHighlight == ctx.i);
				add_location(div, file$2, 1101, 22, 26479);
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

	// (1100:18) {#each groups['manaCurve'] as mana, i}
	function create_each_block_5(ctx) {
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

	// (976:22)             <div>loading: {progress}
	function create_pending_block_2(ctx) {
		var div, t0, t1, t2, t3;

		return {
			c: function create() {
				div = element("div");
				t0 = text("loading: ");
				t1 = text(ctx.progress);
				t2 = text("/");
				t3 = text(ctx.all);
				add_location(div, file$2, 977, 8, 21191);
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

	// (1307:4) {:catch error}
	function create_catch_block_1$1(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "ERROR, check your decklist for correct format or internet connection\r\n        brudi";
				div.className = "error";
				add_location(div, file$2, 1308, 6, 33654);
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

	// (1213:4) {:then groups}
	function create_then_block_1$1(ctx) {
		var each_1_anchor;

		var each_value_1 = ctx.deckSeach || ctx.groups || [];

		var each_blocks = [];

		for (var i = 0; i < each_value_1.length; i += 1) {
			each_blocks[i] = create_each_block_1$1(get_each_context_1$1(ctx, each_value_1, i));
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
						const child_ctx = get_each_context_1$1(ctx, each_value_1, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
						} else {
							each_blocks[i] = create_each_block_1$1(child_ctx);
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

	// (1258:16) {#each { length: card.count > 4 ? 4 : card.count } as _, i}
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
				img.className = "card svelte-h7vjvw";
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
				add_location(img, file$2, 1258, 18, 31803);

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

	// (1275:16) {#if card.data.legalities[format.value] !== 'legal'}
	function create_if_block_8(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "BANNED";
				div.className = "banned-text svelte-h7vjvw";
				add_location(div, file$2, 1275, 18, 32641);
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

	// (1278:16) {#if card.count > 4}
	function create_if_block_7(ctx) {
		var div, t0_value = ctx.card.count, t0, t1;

		return {
			c: function create() {
				div = element("div");
				t0 = text(t0_value);
				t1 = text("x");
				div.className = "count svelte-h7vjvw";
				add_location(div, file$2, 1278, 18, 32759);
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

	// (1282:16) {#if scaling > 90}
	function create_if_block_6(ctx) {
		var div, t_value = ctx.card.data.prices.usd + '$' || '???', t;

		return {
			c: function create() {
				div = element("div");
				t = text(t_value);
				div.className = "price svelte-h7vjvw";
				add_location(div, file$2, 1282, 18, 32878);
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

	// (1286:16) {#if currentCardContext === card}
	function create_if_block_4(ctx) {
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
				div.className = "card-context-menu svelte-h7vjvw";
				add_location(div, file$2, 1286, 18, 33036);
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

	// (1290:22) {#if group.name != subGroup.name}
	function create_if_block_5(ctx) {
		var div, t_value = ctx.subGroup.name, t, dispose;

		function mousedown_handler(...args) {
			return ctx.mousedown_handler(ctx, ...args);
		}

		return {
			c: function create() {
				div = element("div");
				t = text(t_value);
				div.className = "card-context-entry svelte-h7vjvw";
				add_location(div, file$2, 1290, 24, 33200);
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

	// (1289:20) {#each groups as subGroup}
	function create_each_block_3(ctx) {
		var if_block_anchor;

		var if_block = (ctx.group.name != ctx.subGroup.name) && create_if_block_5(ctx);

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
						if_block = create_if_block_5(ctx);
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

	// (1246:12) {#each group.cards as card}
	function create_each_block_2(ctx) {
		var div1, div0, a, t0, a_href_value, t1, t2, t3, t4, t5, div1_style_value;

		var each_value_4 = { length: ctx.card.count > 4 ? 4 : ctx.card.count };

		var each_blocks = [];

		for (var i = 0; i < each_value_4.length; i += 1) {
			each_blocks[i] = create_each_block_4(get_each_context_4(ctx, each_value_4, i));
		}

		var if_block0 = (ctx.card.data.legalities[ctx.format.value] !== 'legal') && create_if_block_8(ctx);

		var if_block1 = (ctx.card.count > 4) && create_if_block_7(ctx);

		var if_block2 = (ctx.scaling > 90) && create_if_block_6(ctx);

		var if_block3 = (ctx.currentCardContext === ctx.card) && create_if_block_4(ctx);

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
				a.className = "link svelte-h7vjvw";
				a.href = a_href_value = ctx.card.data.purchase_uris.cardmarket;
				a.target = "_blank";
				add_location(a, file$2, 1250, 18, 31490);
				div0.className = "shoping svelte-h7vjvw";
				add_location(div0, file$2, 1249, 16, 31449);
				div1.className = "entry svelte-h7vjvw";
				div1.style.cssText = div1_style_value = 'width:' + ctx.width + 'px; height:' + (ctx.card.count <= 4 ? ctx.height + ((ctx.card.count || 1) - 1) * 40 : ctx.height + 3 * 40) + 'px;';
				add_location(div1, file$2, 1246, 14, 31251);
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
						if_block0 = create_if_block_8(ctx);
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
						if_block1 = create_if_block_7(ctx);
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
						if_block2 = create_if_block_6(ctx);
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
						if_block3 = create_if_block_4(ctx);
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

	// (1215:6) {#each deckSeach || groups || [] as group}
	function create_each_block_1$1(ctx) {
		var div11, div9, h2, t0_value = ctx.group.name + ' // ' + ctx.group.count || 'no name', t0, t1, button, t3, div8, div0, t4_value = ctx.group.mana.blue, t4, t5, div1, t6_value = ctx.group.mana.black, t6, t7, div2, t8_value = ctx.group.mana.red, t8, t9, div3, t10_value = ctx.group.mana.white, t10, t11, div4, t12_value = ctx.group.mana.green, t12, t13, div5, t14_value = ctx.group.mana.colorless, t14, t15, div6, t16_value = ctx.group.mana.sum, t16, t17, div7, t18_value = ctx.group.cost.toFixed(2) + '$', t18, t19, t20, div10, dispose;

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
				t19 = text("\r\n              chances:");
				t20 = space();
				div10 = element("div");

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}
				h2.className = "svelte-h7vjvw";
				add_location(h2, file$2, 1218, 12, 29986);
				add_location(button, file$2, 1219, 12, 30057);
				div0.className = "group-value blue svelte-h7vjvw";
				add_location(div0, file$2, 1223, 14, 30216);
				div1.className = "group-value black svelte-h7vjvw";
				add_location(div1, file$2, 1224, 14, 30285);
				div2.className = "group-value red svelte-h7vjvw";
				add_location(div2, file$2, 1225, 14, 30356);
				div3.className = "group-value white svelte-h7vjvw";
				add_location(div3, file$2, 1226, 14, 30423);
				div4.className = "group-value green svelte-h7vjvw";
				add_location(div4, file$2, 1227, 14, 30494);
				div5.className = "group-value colorless svelte-h7vjvw";
				add_location(div5, file$2, 1228, 14, 30565);
				div6.className = "group-value sum svelte-h7vjvw";
				add_location(div6, file$2, 1232, 14, 30772);
				div7.className = "group-value group-cost svelte-h7vjvw";
				add_location(div7, file$2, 1233, 14, 30839);
				div8.className = "group-statistics svelte-h7vjvw";
				add_location(div8, file$2, 1222, 12, 30170);
				div9.className = "group-header svelte-h7vjvw";
				add_location(div9, file$2, 1217, 10, 29946);
				div10.className = "group-content svelte-h7vjvw";
				toggle_class(div10, "hidden", ctx.hiddenGroups.has(ctx.group.name));
				add_location(div10, file$2, 1241, 10, 31095);
				div11.className = "group";
				add_location(div11, file$2, 1215, 8, 29913);
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
				append(div8, t19);
				append(div11, t20);
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

	// (1205:20)         <div class="loading-wrapper">          <div>loading: {progress}
	function create_pending_block_1$1(ctx) {
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
				add_location(div0, file$2, 1206, 8, 29693);
				div1.className = "svelte-h7vjvw";
				add_location(div1, file$2, 1208, 10, 29775);
				div2.className = "svelte-h7vjvw";
				add_location(div2, file$2, 1209, 10, 29794);
				div3.className = "lds-ripple svelte-h7vjvw";
				add_location(div3, file$2, 1207, 8, 29739);
				div4.className = "loading-wrapper svelte-h7vjvw";
				add_location(div4, file$2, 1205, 6, 29654);
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

	// (1316:2) {#if playTesterActive}
	function create_if_block_3(ctx) {
		var div, updating_playTesterActive, current;

		function playtester_playTesterActive_binding(value) {
			ctx.playtester_playTesterActive_binding.call(null, value);
			updating_playTesterActive = true;
			add_flush_callback(() => updating_playTesterActive = false);
		}

		let playtester_props = { promise: ctx.promise };
		if (ctx.playTesterActive !== void 0) {
			playtester_props.playTesterActive = ctx.playTesterActive;
		}
		var playtester = new Playtester({ props: playtester_props, $$inline: true });

		add_binding_callback(() => bind(playtester, 'playTesterActive', playtester_playTesterActive_binding));

		return {
			c: function create() {
				div = element("div");
				playtester.$$.fragment.c();
				div.className = "play-tester svelte-h7vjvw";
				add_location(div, file$2, 1316, 4, 33838);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
				mount_component(playtester, div, null);
				current = true;
			},

			p: function update_1(changed, ctx) {
				var playtester_changes = {};
				if (changed.promise) playtester_changes.promise = ctx.promise;
				if (!updating_playTesterActive && changed.playTesterActive) {
					playtester_changes.playTesterActive = ctx.playTesterActive;
				}
				playtester.$set(playtester_changes);
			},

			i: function intro(local) {
				if (current) return;
				playtester.$$.fragment.i(local);

				current = true;
			},

			o: function outro(local) {
				playtester.$$.fragment.o(local);
				current = false;
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div);
				}

				playtester.$destroy();
			}
		};
	}

	// (1434:4) {:catch error}
	function create_catch_block$1(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "ERROR, check your decklist for correct format or internet connection\r\n        brudi";
				div.className = "error";
				add_location(div, file$2, 1434, 6, 37301);
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

	// (1393:4) {:then result}
	function create_then_block$1(ctx) {
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

	// (1431:6) {:else}
	function create_else_block_1(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "No cards found";
				add_location(div, file$2, 1431, 8, 37235);
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

	// (1395:6) {#if result.code !== 'not_found' && result.data}
	function create_if_block(ctx) {
		var div, t0, button, t1, button_disabled_value, dispose;

		var each_value = ctx.result.data;

		var each_blocks = [];

		for (var i = 0; i < each_value.length; i += 1) {
			each_blocks[i] = create_each_block$1(get_each_context$1(ctx, each_value, i));
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
				div.className = "search-result svelte-h7vjvw";
				add_location(div, file$2, 1395, 8, 36004);
				button.disabled = button_disabled_value = !ctx.result.has_more;
				add_location(button, file$2, 1425, 8, 37070);
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
						const child_ctx = get_each_context$1(ctx, each_value, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
						} else {
							each_blocks[i] = create_each_block$1(child_ctx);
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

	// (1422:10) {:else}
	function create_else_block(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "No cards found";
				add_location(div, file$2, 1422, 12, 37000);
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

	// (1415:14) {#if card.legalities[format.value] !== 'legal'}
	function create_if_block_2(ctx) {
		var div;

		return {
			c: function create() {
				div = element("div");
				div.textContent = "BANNED";
				div.className = "banned-text svelte-h7vjvw";
				add_location(div, file$2, 1415, 16, 36759);
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

	// (1418:14) {#if scaling > 90}
	function create_if_block_1(ctx) {
		var div, t_value = ctx.card.prices.usd + '$' || '???', t;

		return {
			c: function create() {
				div = element("div");
				t = text(t_value);
				div.className = "price svelte-h7vjvw";
				add_location(div, file$2, 1418, 16, 36869);
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

	// (1397:10) {#each result.data as card}
	function create_each_block$1(ctx) {
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
				a.className = "link svelte-h7vjvw";
				a.href = a_href_value = ctx.card.cardmarket;
				a.target = "_blank";
				add_location(a, file$2, 1401, 16, 36246);
				div0.className = "shoping svelte-h7vjvw";
				add_location(div0, file$2, 1400, 14, 36207);
				img.className = "card svelte-h7vjvw";
				img.src = img_src_value = ctx.card.url;
				img.alt = img_alt_value = ctx.card.name;
				img.width = ctx.width;
				img.height = ctx.height;
				toggle_class(img, "banned", ctx.card.legalities[ctx.format.value] !== 'legal');
				add_location(img, file$2, 1405, 14, 36390);
				div1.className = "entry svelte-h7vjvw";
				div1.style.cssText = div1_style_value = 'width:' + ctx.width + 'px; height:' + ctx.height + 'px;';
				add_location(div1, file$2, 1397, 12, 36084);
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

	// (1386:30)         <div class="loading-wrapper">          <div class="lds-ripple">            <div />            <div />          </div>        </div>      {:then result}
	function create_pending_block$1(ctx) {
		var div3, div2, div0, t, div1;

		return {
			c: function create() {
				div3 = element("div");
				div2 = element("div");
				div0 = element("div");
				t = space();
				div1 = element("div");
				div0.className = "svelte-h7vjvw";
				add_location(div0, file$2, 1388, 10, 35860);
				div1.className = "svelte-h7vjvw";
				add_location(div1, file$2, 1389, 10, 35879);
				div2.className = "lds-ripple svelte-h7vjvw";
				add_location(div2, file$2, 1387, 8, 35824);
				div3.className = "loading-wrapper svelte-h7vjvw";
				add_location(div3, file$2, 1386, 6, 35785);
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

	function create_fragment$2(ctx) {
		var div19, div4, div3, div0, t1, t2, promise_1, t3, select, option0, option1, option2, option3, option4, option5, option6, option7, option8, option9, option10, option11, option12, t17, div1, t18, input0, t19, div2, t20, input1, input1_value_value, t21, button0, t23, button1, t24_value = ctx.statisticsActive ? 'hide statistics' : 'show statistics', t24, t25, button2, t27, button3, t29, button4, t31, button5, t33, button6, t35, button7, t37, textarea, t38, div5, promise_2, t39, t40, div18, div6, t42, div17, div7, t43, input2, t44, div8, t45, input3, t46, div9, t47, input4, t48, div16, t49, div10, input5, t50, div11, input6, t51, div12, input7, t52, div13, input8, t53, div14, input9, t54, div15, input10, t55, button8, t57, promise_3, current, dispose;

		var if_block0 = (ctx.helpActive) && create_if_block_13(ctx);

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
			pending: create_pending_block_1$1,
			then: create_then_block_1$1,
			catch: create_catch_block_1$1,
			value: 'groups',
			error: 'error'
		};

		handle_promise(promise_2 = ctx.promise, info_1);

		var if_block1 = (ctx.playTesterActive) && create_if_block_3(ctx);

		let info_2 = {
			ctx,
			current: null,
			pending: create_pending_block$1,
			then: create_then_block$1,
			catch: create_catch_block$1,
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
				if (if_block0) if_block0.c();
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
				button2.textContent = "playtest";
				t27 = space();
				button3 = element("button");
				button3.textContent = "sort";
				t29 = space();
				button4 = element("button");
				button4.textContent = "clean copy";
				t31 = space();
				button5 = element("button");
				button5.textContent = "clean string";
				t33 = space();
				button6 = element("button");
				button6.textContent = "share";
				t35 = space();
				button7 = element("button");
				button7.textContent = "refresh";
				t37 = space();
				textarea = element("textarea");
				t38 = space();
				div5 = element("div");

				info_1.block.c();

				t39 = space();
				if (if_block1) if_block1.c();
				t40 = space();
				div18 = element("div");
				div6 = element("div");
				div6.textContent = "x";
				t42 = space();
				div17 = element("div");
				div7 = element("div");
				t43 = text("Name:\r\n        ");
				input2 = element("input");
				t44 = space();
				div8 = element("div");
				t45 = text("Text:\r\n        ");
				input3 = element("input");
				t46 = space();
				div9 = element("div");
				t47 = text("Type:\r\n        ");
				input4 = element("input");
				t48 = space();
				div16 = element("div");
				t49 = text("Commander-Colors:\r\n        ");
				div10 = element("div");
				input5 = element("input");
				t50 = space();
				div11 = element("div");
				input6 = element("input");
				t51 = space();
				div12 = element("div");
				input7 = element("input");
				t52 = space();
				div13 = element("div");
				input8 = element("input");
				t53 = space();
				div14 = element("div");
				input9 = element("input");
				t54 = space();
				div15 = element("div");
				input10 = element("input");
				t55 = space();
				button8 = element("button");
				button8.textContent = "search";
				t57 = space();

				info_2.block.c();
				div0.className = "help-symbol svelte-h7vjvw";
				add_location(div0, file$2, 957, 6, 20484);
				option0.selected = true;
				option0.__value = "commander";
				option0.value = option0.__value;
				add_location(option0, file$2, 1130, 8, 27320);
				option1.__value = "brawl";
				option1.value = option1.__value;
				add_location(option1, file$2, 1131, 8, 27365);
				option2.__value = "duel";
				option2.value = option2.__value;
				add_location(option2, file$2, 1132, 8, 27397);
				option3.__value = "future";
				option3.value = option3.__value;
				add_location(option3, file$2, 1133, 8, 27428);
				option4.__value = "historic";
				option4.value = option4.__value;
				add_location(option4, file$2, 1134, 8, 27461);
				option5.__value = "legacy";
				option5.value = option5.__value;
				add_location(option5, file$2, 1135, 8, 27496);
				option6.__value = "modern";
				option6.value = option6.__value;
				add_location(option6, file$2, 1136, 8, 27529);
				option7.__value = "oldschool";
				option7.value = option7.__value;
				add_location(option7, file$2, 1137, 8, 27562);
				option8.__value = "pauper";
				option8.value = option8.__value;
				add_location(option8, file$2, 1138, 8, 27598);
				option9.__value = "penny";
				option9.value = option9.__value;
				add_location(option9, file$2, 1139, 8, 27631);
				option10.__value = "pioneer";
				option10.value = option10.__value;
				add_location(option10, file$2, 1140, 8, 27663);
				option11.__value = "standard";
				option11.value = option11.__value;
				add_location(option11, file$2, 1141, 8, 27697);
				option12.__value = "vintage";
				option12.value = option12.__value;
				add_location(option12, file$2, 1142, 8, 27732);
				select.title = "select the legality checker";
				add_location(select, file$2, 1125, 6, 27175);
				attr(input0, "type", "range");
				input0.min = "25";
				input0.max = "100";
				input0.title = "scales the card size in the right view";
				add_location(input0, file$2, 1146, 8, 27835);
				div1.className = "slidecontainer";
				add_location(div1, file$2, 1144, 6, 27781);
				input1.value = input1_value_value = ctx.Cookies.get('deckName') || 'unknown_deck';
				input1.title = "The name of the deck for saving";
				add_location(input1, file$2, 1155, 8, 28075);
				button0.title = "this will download you a file, called like you provide in the\r\n          deck";
				add_location(button0, file$2, 1160, 8, 28280);
				div2.className = "save-container";
				add_location(div2, file$2, 1153, 6, 28021);
				button1.title = "toggles the visibility of the statisticks";
				add_location(button1, file$2, 1167, 6, 28473);
				button2.title = "test your deck";
				add_location(button2, file$2, 1173, 6, 28672);
				button3.title = "this sorts the deck to lands spells and creatures -NOTE: your\r\n        groups will be replaced";
				add_location(button3, file$2, 1175, 6, 28756);
				button4.title = "this copies the deck without groups and stuff to your clipboard";
				add_location(button4, file$2, 1181, 6, 28950);
				button5.title = "cleans the input string from comments and newlines";
				add_location(button5, file$2, 1186, 6, 29113);
				button6.title = "copies a string to your clipboard, that shares this deck with\r\n        others";
				add_location(button6, file$2, 1191, 6, 29268);
				add_location(button7, file$2, 1198, 6, 29443);
				div3.className = "help svelte-h7vjvw";
				add_location(div3, file$2, 956, 4, 20458);
				textarea.className = "input svelte-h7vjvw";
				add_location(textarea, file$2, 1200, 4, 29503);
				div4.className = "controls svelte-h7vjvw";
				add_location(div4, file$2, 955, 2, 20430);
				div5.className = "display svelte-h7vjvw";
				add_location(div5, file$2, 1203, 2, 29583);
				div6.className = "toggle-search svelte-h7vjvw";
				add_location(div6, file$2, 1322, 4, 34006);
				add_location(input2, file$2, 1326, 8, 34156);
				div7.className = "search-param";
				add_location(div7, file$2, 1324, 6, 34105);
				add_location(input3, file$2, 1330, 8, 34257);
				div8.className = "search-param";
				add_location(div8, file$2, 1328, 6, 34206);
				add_location(input4, file$2, 1334, 8, 34358);
				div9.className = "search-param";
				add_location(div9, file$2, 1332, 6, 34307);
				attr(input5, "type", "checkbox");
				input5.className = "blue svelte-h7vjvw";
				add_location(input5, file$2, 1340, 10, 34515);
				div10.className = "blue svelte-h7vjvw";
				add_location(div10, file$2, 1339, 8, 34485);
				attr(input6, "type", "checkbox");
				input6.className = "black svelte-h7vjvw";
				add_location(input6, file$2, 1347, 10, 34710);
				div11.className = "black svelte-h7vjvw";
				add_location(div11, file$2, 1346, 8, 34679);
				attr(input7, "type", "checkbox");
				input7.className = "red svelte-h7vjvw";
				add_location(input7, file$2, 1354, 10, 34905);
				div12.className = "red svelte-h7vjvw";
				add_location(div12, file$2, 1353, 8, 34876);
				attr(input8, "type", "checkbox");
				input8.className = "white svelte-h7vjvw";
				add_location(input8, file$2, 1361, 10, 35098);
				div13.className = "white svelte-h7vjvw";
				add_location(div13, file$2, 1360, 8, 35067);
				attr(input9, "type", "checkbox");
				input9.className = "green svelte-h7vjvw";
				add_location(input9, file$2, 1368, 10, 35295);
				div14.className = "green svelte-h7vjvw";
				add_location(div14, file$2, 1367, 8, 35264);
				attr(input10, "type", "checkbox");
				input10.className = "colorless svelte-h7vjvw";
				add_location(input10, file$2, 1375, 10, 35496);
				div15.className = "colorless svelte-h7vjvw";
				add_location(div15, file$2, 1374, 8, 35461);
				div16.className = "search-param color-param svelte-h7vjvw";
				add_location(div16, file$2, 1337, 6, 34410);
				add_location(button8, file$2, 1382, 6, 35685);
				div17.className = "search-params svelte-h7vjvw";
				add_location(div17, file$2, 1323, 4, 34070);
				div18.className = "card-search svelte-h7vjvw";
				toggle_class(div18, "hide", !ctx.cardSearchActive);
				add_location(div18, file$2, 1321, 2, 33944);
				div19.className = "content svelte-h7vjvw";
				add_location(div19, file$2, 954, 0, 20405);

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
					listen(button2, "click", ctx.togglePlayTest),
					listen(button3, "click", ctx.sortDeckString),
					listen(button4, "click", ctx.copyDeck),
					listen(button5, "click", ctx.cleanString),
					listen(button6, "click", shareDeck),
					listen(button7, "click", ctx.reload),
					listen(textarea, "keyup", ctx.onTyping),
					listen(div6, "click", ctx.toggleSearch),
					listen(input5, "click", ctx.clearColorless),
					listen(input6, "click", ctx.clearColorless),
					listen(input7, "click", ctx.clearColorless),
					listen(input8, "click", ctx.clearColorless),
					listen(input9, "click", ctx.clearColorless),
					listen(input10, "click", ctx.clearForColorless),
					listen(button8, "click", ctx.searchCards)
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
				if (if_block0) if_block0.m(div3, null);
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
				append(div3, t33);
				append(div3, button6);
				append(div3, t35);
				append(div3, button7);
				append(div4, t37);
				append(div4, textarea);
				add_binding_callback(() => ctx.textarea_binding(textarea, null));
				append(div19, t38);
				append(div19, div5);

				info_1.block.m(div5, info_1.anchor = null);
				info_1.mount = () => div5;
				info_1.anchor = null;

				add_binding_callback(() => ctx.div5_binding(div5, null));
				append(div19, t39);
				if (if_block1) if_block1.m(div19, null);
				append(div19, t40);
				append(div19, div18);
				append(div18, div6);
				append(div18, t42);
				append(div18, div17);
				append(div17, div7);
				append(div7, t43);
				append(div7, input2);
				add_binding_callback(() => ctx.input2_binding(input2, null));
				append(div17, t44);
				append(div17, div8);
				append(div8, t45);
				append(div8, input3);
				add_binding_callback(() => ctx.input3_binding(input3, null));
				append(div17, t46);
				append(div17, div9);
				append(div9, t47);
				append(div9, input4);
				add_binding_callback(() => ctx.input4_binding(input4, null));
				append(div17, t48);
				append(div17, div16);
				append(div16, t49);
				append(div16, div10);
				append(div10, input5);
				add_binding_callback(() => ctx.input5_binding(input5, null));
				append(div16, t50);
				append(div16, div11);
				append(div11, input6);
				add_binding_callback(() => ctx.input6_binding(input6, null));
				append(div16, t51);
				append(div16, div12);
				append(div12, input7);
				add_binding_callback(() => ctx.input7_binding(input7, null));
				append(div16, t52);
				append(div16, div13);
				append(div13, input8);
				add_binding_callback(() => ctx.input8_binding(input8, null));
				append(div16, t53);
				append(div16, div14);
				append(div14, input9);
				add_binding_callback(() => ctx.input9_binding(input9, null));
				append(div16, t54);
				append(div16, div15);
				append(div15, input10);
				add_binding_callback(() => ctx.input10_binding(input10, null));
				append(div17, t55);
				append(div17, button8);
				append(div18, t57);

				info_2.block.m(div18, info_2.anchor = null);
				info_2.mount = () => div18;
				info_2.anchor = null;

				current = true;
			},

			p: function update_1(changed, new_ctx) {
				ctx = new_ctx;
				if (ctx.helpActive) {
					if (!if_block0) {
						if_block0 = create_if_block_13(ctx);
						if_block0.c();
						if_block0.m(div3, t2);
					}
				} else if (if_block0) {
					if_block0.d(1);
					if_block0 = null;
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

				if ((!current || changed.Cookies) && input1_value_value !== (input1_value_value = ctx.Cookies.get('deckName') || 'unknown_deck')) {
					input1.value = input1_value_value;
				}

				if ((!current || changed.statisticsActive) && t24_value !== (t24_value = ctx.statisticsActive ? 'hide statistics' : 'show statistics')) {
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

				if (ctx.playTesterActive) {
					if (if_block1) {
						if_block1.p(changed, ctx);
						if_block1.i(1);
					} else {
						if_block1 = create_if_block_3(ctx);
						if_block1.c();
						if_block1.i(1);
						if_block1.m(div19, t40);
					}
				} else if (if_block1) {
					group_outros();
					on_outro(() => {
						if_block1.d(1);
						if_block1 = null;
					});

					if_block1.o(1);
					check_outros();
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

			i: function intro(local) {
				if (current) return;
				if (if_block1) if_block1.i();
				current = true;
			},

			o: function outro(local) {
				if (if_block1) if_block1.o();
				current = false;
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(div19);
				}

				if (if_block0) if_block0.d();

				info.block.d();
				info = null;

				ctx.select_binding(null, select);
				ctx.input1_binding(null, input1);
				ctx.textarea_binding(null, textarea);

				info_1.block.d();
				info_1 = null;

				ctx.div5_binding(null, div5);
				if (if_block1) if_block1.d();
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

	const CARD_RATIO$1 = 0.71764705882;

	let _height$1 = 300;

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

	function instance$2($$self, $$props, $$invalidate) {
		
	  const ipc = require("electron").ipcRenderer;
	  const CardLoader = new cardLoader(ipc);
	  // import LZUTF8 from "lzutf8";
	  //import Cookies from "js-cookie";

	  const Cookies = {
	    set: () => {},
	    get: () => {}
	  };
	  let _width = Math.floor(_height$1 * CARD_RATIO$1);

	  let useCookies = true;

	  const oldSet = Cookies.set;
	  Cookies.set = (a, b) => {
	    if (useCookies) oldSet(a, b);
	    else {
	      console.log("saving disabled");
	    }
	  }; $$invalidate('Cookies', Cookies);

	  let height = _height$1;
	  let width = _width;
	  let cardSearchActive = false;
	  let playTesterActive = false;
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

	  function cleanString() {
	    const array = input.value.split("\n");
	    let result = [];
	    for (let a of array) {
	      if (!a) continue;
	      a = a.trim();
	      if (!a || a.startsWith("//")) continue;
	      //  if (/[\n\r\s]+/gi.test(a)) continue;

	      if (a.startsWith("#")) {
	        a = a.replace("#", "\n#");
	      } else {
	        a = a.trim();
	        if (!/^\d/.test(a)) {
	          a = "1 " + a;
	        }
	      }

	      a = a.replace(/\s\s+/g, " ");
	      result.push(a);
	    }
	    input.value = result.join("\n").trim(); $$invalidate('input', input);
	    update({ keyCode: 27 });
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

	  function togglePlayTest() {
	    $$invalidate('playTesterActive', playTesterActive = !playTesterActive);
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

		function playtester_playTesterActive_binding(value) {
			playTesterActive = value;
			$$invalidate('playTesterActive', playTesterActive);
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
	        $$invalidate('height', height = _height$1 * s);
	        $$invalidate('width', width = _width * s);
	      } }
		};

		return {
			Cookies,
			height,
			width,
			cardSearchActive,
			playTesterActive,
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
			cleanString,
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
			togglePlayTest,
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
			playtester_playTesterActive_binding,
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
			if (!document.getElementById("svelte-h7vjvw-style")) add_css$2();
			init(this, options, instance$2, create_fragment$2, safe_not_equal, []);
		}
	}
	Editor.$compile = {"vars":[{"name":"onMount","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"PlayTester","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"ipc","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"cl","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"CardLoader","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"Cookies","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":false,"referenced":true,"writable":false},{"name":"CARD_RATIO","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"_height","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":true},{"name":"_width","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":true},{"name":"useCookies","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":false,"writable":true},{"name":"enableSaving","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"oldSet","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"height","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"width","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"cardSearchActive","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"playTesterActive","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"statisticsActive","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"scaling","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"display","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"devotionHighlight","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"highlightDevotion","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"promise","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"cardSearchPromise","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"input","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"format","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"progress","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"all","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"spName","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"spText","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"spType","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"spEDHBlue","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"spEDHBlack","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"spEDHRed","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"spEDHWhite","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"spEDHGreen","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"spEDHColorless","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"deckSeach","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"deckSearchInput","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"changeDeckSearch","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"clearForColorless","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"clearColorless","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"cleanString","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"searchCards","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"currentCardContext","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"cardContextMenu","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"cardContextClick","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"onMainMouseDown","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"hiddenGroups","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"toggleGroupVisibility","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"sp","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"resetDeckSearch","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"sortDeckString","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"deckNameInput","export_name":null,"injected":false,"module":false,"mutated":true,"reassigned":true,"referenced":true,"writable":true},{"name":"saveDeck","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"onDeckNameType","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"mainKeyDown","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"mainKeyUp","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"update","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"reload","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"appendCard","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"remove","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"copyDeck","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"helpActive","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"saveAllToCookies","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":false,"writable":false},{"name":"shareDeck","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"onTyping","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"getHeight","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"openHelp","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"togglePlayTest","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"toggleSearch","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"toggleStatistics","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false},{"name":"highlightedCreature","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":true,"referenced":true,"writable":true},{"name":"highlightCreature","export_name":null,"injected":false,"module":false,"mutated":false,"reassigned":false,"referenced":true,"writable":false}]};

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWRpdG9yLWJ1bmRsZS5qcyIsInNvdXJjZXMiOlsibm9kZV9tb2R1bGVzL3N2ZWx0ZS9pbnRlcm5hbC5tanMiLCJjYXJkLnN2ZWx0ZSIsInBsYXl0ZXN0ZXIuc3ZlbHRlIiwiY2FyZC1sb2FkZXIuanMiLCJlZGl0b3Iuc3ZlbHRlIiwiZWRpdG9yLW1haW4uanMiXSwic291cmNlc0NvbnRlbnQiOlsiZnVuY3Rpb24gbm9vcCgpIHt9XG5cbmNvbnN0IGlkZW50aXR5ID0geCA9PiB4O1xuXG5mdW5jdGlvbiBhc3NpZ24odGFyLCBzcmMpIHtcblx0Zm9yIChjb25zdCBrIGluIHNyYykgdGFyW2tdID0gc3JjW2tdO1xuXHRyZXR1cm4gdGFyO1xufVxuXG5mdW5jdGlvbiBpc19wcm9taXNlKHZhbHVlKSB7XG5cdHJldHVybiB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUudGhlbiA9PT0gJ2Z1bmN0aW9uJztcbn1cblxuZnVuY3Rpb24gYWRkX2xvY2F0aW9uKGVsZW1lbnQsIGZpbGUsIGxpbmUsIGNvbHVtbiwgY2hhcikge1xuXHRlbGVtZW50Ll9fc3ZlbHRlX21ldGEgPSB7XG5cdFx0bG9jOiB7IGZpbGUsIGxpbmUsIGNvbHVtbiwgY2hhciB9XG5cdH07XG59XG5cbmZ1bmN0aW9uIHJ1bihmbikge1xuXHRyZXR1cm4gZm4oKTtcbn1cblxuZnVuY3Rpb24gYmxhbmtfb2JqZWN0KCkge1xuXHRyZXR1cm4gT2JqZWN0LmNyZWF0ZShudWxsKTtcbn1cblxuZnVuY3Rpb24gcnVuX2FsbChmbnMpIHtcblx0Zm5zLmZvckVhY2gocnVuKTtcbn1cblxuZnVuY3Rpb24gaXNfZnVuY3Rpb24odGhpbmcpIHtcblx0cmV0dXJuIHR5cGVvZiB0aGluZyA9PT0gJ2Z1bmN0aW9uJztcbn1cblxuZnVuY3Rpb24gc2FmZV9ub3RfZXF1YWwoYSwgYikge1xuXHRyZXR1cm4gYSAhPSBhID8gYiA9PSBiIDogYSAhPT0gYiB8fCAoKGEgJiYgdHlwZW9mIGEgPT09ICdvYmplY3QnKSB8fCB0eXBlb2YgYSA9PT0gJ2Z1bmN0aW9uJyk7XG59XG5cbmZ1bmN0aW9uIG5vdF9lcXVhbChhLCBiKSB7XG5cdHJldHVybiBhICE9IGEgPyBiID09IGIgOiBhICE9PSBiO1xufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZV9zdG9yZShzdG9yZSwgbmFtZSkge1xuXHRpZiAoIXN0b3JlIHx8IHR5cGVvZiBzdG9yZS5zdWJzY3JpYmUgIT09ICdmdW5jdGlvbicpIHtcblx0XHR0aHJvdyBuZXcgRXJyb3IoYCcke25hbWV9JyBpcyBub3QgYSBzdG9yZSB3aXRoIGEgJ3N1YnNjcmliZScgbWV0aG9kYCk7XG5cdH1cbn1cblxuZnVuY3Rpb24gc3Vic2NyaWJlKGNvbXBvbmVudCwgc3RvcmUsIGNhbGxiYWNrKSB7XG5cdGNvbXBvbmVudC4kJC5vbl9kZXN0cm95LnB1c2goc3RvcmUuc3Vic2NyaWJlKGNhbGxiYWNrKSk7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZV9zbG90KGRlZmluaXRpb24sIGN0eCwgZm4pIHtcblx0aWYgKGRlZmluaXRpb24pIHtcblx0XHRjb25zdCBzbG90X2N0eCA9IGdldF9zbG90X2NvbnRleHQoZGVmaW5pdGlvbiwgY3R4LCBmbik7XG5cdFx0cmV0dXJuIGRlZmluaXRpb25bMF0oc2xvdF9jdHgpO1xuXHR9XG59XG5cbmZ1bmN0aW9uIGdldF9zbG90X2NvbnRleHQoZGVmaW5pdGlvbiwgY3R4LCBmbikge1xuXHRyZXR1cm4gZGVmaW5pdGlvblsxXVxuXHRcdD8gYXNzaWduKHt9LCBhc3NpZ24oY3R4LiQkc2NvcGUuY3R4LCBkZWZpbml0aW9uWzFdKGZuID8gZm4oY3R4KSA6IHt9KSkpXG5cdFx0OiBjdHguJCRzY29wZS5jdHg7XG59XG5cbmZ1bmN0aW9uIGdldF9zbG90X2NoYW5nZXMoZGVmaW5pdGlvbiwgY3R4LCBjaGFuZ2VkLCBmbikge1xuXHRyZXR1cm4gZGVmaW5pdGlvblsxXVxuXHRcdD8gYXNzaWduKHt9LCBhc3NpZ24oY3R4LiQkc2NvcGUuY2hhbmdlZCB8fCB7fSwgZGVmaW5pdGlvblsxXShmbiA/IGZuKGNoYW5nZWQpIDoge30pKSlcblx0XHQ6IGN0eC4kJHNjb3BlLmNoYW5nZWQgfHwge307XG59XG5cbmZ1bmN0aW9uIGV4Y2x1ZGVfaW50ZXJuYWxfcHJvcHMocHJvcHMpIHtcblx0Y29uc3QgcmVzdWx0ID0ge307XG5cdGZvciAoY29uc3QgayBpbiBwcm9wcykgaWYgKGtbMF0gIT09ICckJykgcmVzdWx0W2tdID0gcHJvcHNba107XG5cdHJldHVybiByZXN1bHQ7XG59XG5cbmNvbnN0IHRhc2tzID0gbmV3IFNldCgpO1xubGV0IHJ1bm5pbmcgPSBmYWxzZTtcblxuZnVuY3Rpb24gcnVuX3Rhc2tzKCkge1xuXHR0YXNrcy5mb3JFYWNoKHRhc2sgPT4ge1xuXHRcdGlmICghdGFza1swXSh3aW5kb3cucGVyZm9ybWFuY2Uubm93KCkpKSB7XG5cdFx0XHR0YXNrcy5kZWxldGUodGFzayk7XG5cdFx0XHR0YXNrWzFdKCk7XG5cdFx0fVxuXHR9KTtcblxuXHRydW5uaW5nID0gdGFza3Muc2l6ZSA+IDA7XG5cdGlmIChydW5uaW5nKSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUocnVuX3Rhc2tzKTtcbn1cblxuZnVuY3Rpb24gY2xlYXJfbG9vcHMoKSB7XG5cdC8vIGZvciB0ZXN0aW5nLi4uXG5cdHRhc2tzLmZvckVhY2godGFzayA9PiB0YXNrcy5kZWxldGUodGFzaykpO1xuXHRydW5uaW5nID0gZmFsc2U7XG59XG5cbmZ1bmN0aW9uIGxvb3AoZm4pIHtcblx0bGV0IHRhc2s7XG5cblx0aWYgKCFydW5uaW5nKSB7XG5cdFx0cnVubmluZyA9IHRydWU7XG5cdFx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKHJ1bl90YXNrcyk7XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHByb21pc2U6IG5ldyBQcm9taXNlKGZ1bGZpbCA9PiB7XG5cdFx0XHR0YXNrcy5hZGQodGFzayA9IFtmbiwgZnVsZmlsXSk7XG5cdFx0fSksXG5cdFx0YWJvcnQoKSB7XG5cdFx0XHR0YXNrcy5kZWxldGUodGFzayk7XG5cdFx0fVxuXHR9O1xufVxuXG5mdW5jdGlvbiBhcHBlbmQodGFyZ2V0LCBub2RlKSB7XG5cdHRhcmdldC5hcHBlbmRDaGlsZChub2RlKTtcbn1cblxuZnVuY3Rpb24gaW5zZXJ0KHRhcmdldCwgbm9kZSwgYW5jaG9yKSB7XG5cdHRhcmdldC5pbnNlcnRCZWZvcmUobm9kZSwgYW5jaG9yKTtcbn1cblxuZnVuY3Rpb24gZGV0YWNoKG5vZGUpIHtcblx0bm9kZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKG5vZGUpO1xufVxuXG5mdW5jdGlvbiBkZXRhY2hfYmV0d2VlbihiZWZvcmUsIGFmdGVyKSB7XG5cdHdoaWxlIChiZWZvcmUubmV4dFNpYmxpbmcgJiYgYmVmb3JlLm5leHRTaWJsaW5nICE9PSBhZnRlcikge1xuXHRcdGJlZm9yZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGJlZm9yZS5uZXh0U2libGluZyk7XG5cdH1cbn1cblxuZnVuY3Rpb24gZGV0YWNoX2JlZm9yZShhZnRlcikge1xuXHR3aGlsZSAoYWZ0ZXIucHJldmlvdXNTaWJsaW5nKSB7XG5cdFx0YWZ0ZXIucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChhZnRlci5wcmV2aW91c1NpYmxpbmcpO1xuXHR9XG59XG5cbmZ1bmN0aW9uIGRldGFjaF9hZnRlcihiZWZvcmUpIHtcblx0d2hpbGUgKGJlZm9yZS5uZXh0U2libGluZykge1xuXHRcdGJlZm9yZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGJlZm9yZS5uZXh0U2libGluZyk7XG5cdH1cbn1cblxuZnVuY3Rpb24gZGVzdHJveV9lYWNoKGl0ZXJhdGlvbnMsIGRldGFjaGluZykge1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IGl0ZXJhdGlvbnMubGVuZ3RoOyBpICs9IDEpIHtcblx0XHRpZiAoaXRlcmF0aW9uc1tpXSkgaXRlcmF0aW9uc1tpXS5kKGRldGFjaGluZyk7XG5cdH1cbn1cblxuZnVuY3Rpb24gZWxlbWVudChuYW1lKSB7XG5cdHJldHVybiBkb2N1bWVudC5jcmVhdGVFbGVtZW50KG5hbWUpO1xufVxuXG5mdW5jdGlvbiBzdmdfZWxlbWVudChuYW1lKSB7XG5cdHJldHVybiBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoJ2h0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnJywgbmFtZSk7XG59XG5cbmZ1bmN0aW9uIHRleHQoZGF0YSkge1xuXHRyZXR1cm4gZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoZGF0YSk7XG59XG5cbmZ1bmN0aW9uIHNwYWNlKCkge1xuXHRyZXR1cm4gdGV4dCgnICcpO1xufVxuXG5mdW5jdGlvbiBlbXB0eSgpIHtcblx0cmV0dXJuIHRleHQoJycpO1xufVxuXG5mdW5jdGlvbiBsaXN0ZW4obm9kZSwgZXZlbnQsIGhhbmRsZXIsIG9wdGlvbnMpIHtcblx0bm9kZS5hZGRFdmVudExpc3RlbmVyKGV2ZW50LCBoYW5kbGVyLCBvcHRpb25zKTtcblx0cmV0dXJuICgpID0+IG5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcihldmVudCwgaGFuZGxlciwgb3B0aW9ucyk7XG59XG5cbmZ1bmN0aW9uIHByZXZlbnRfZGVmYXVsdChmbikge1xuXHRyZXR1cm4gZnVuY3Rpb24oZXZlbnQpIHtcblx0XHRldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuXHRcdHJldHVybiBmbi5jYWxsKHRoaXMsIGV2ZW50KTtcblx0fTtcbn1cblxuZnVuY3Rpb24gc3RvcF9wcm9wYWdhdGlvbihmbikge1xuXHRyZXR1cm4gZnVuY3Rpb24oZXZlbnQpIHtcblx0XHRldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcblx0XHRyZXR1cm4gZm4uY2FsbCh0aGlzLCBldmVudCk7XG5cdH07XG59XG5cbmZ1bmN0aW9uIGF0dHIobm9kZSwgYXR0cmlidXRlLCB2YWx1ZSkge1xuXHRpZiAodmFsdWUgPT0gbnVsbCkgbm9kZS5yZW1vdmVBdHRyaWJ1dGUoYXR0cmlidXRlKTtcblx0ZWxzZSBub2RlLnNldEF0dHJpYnV0ZShhdHRyaWJ1dGUsIHZhbHVlKTtcbn1cblxuZnVuY3Rpb24gc2V0X2F0dHJpYnV0ZXMobm9kZSwgYXR0cmlidXRlcykge1xuXHRmb3IgKGNvbnN0IGtleSBpbiBhdHRyaWJ1dGVzKSB7XG5cdFx0aWYgKGtleSA9PT0gJ3N0eWxlJykge1xuXHRcdFx0bm9kZS5zdHlsZS5jc3NUZXh0ID0gYXR0cmlidXRlc1trZXldO1xuXHRcdH0gZWxzZSBpZiAoa2V5IGluIG5vZGUpIHtcblx0XHRcdG5vZGVba2V5XSA9IGF0dHJpYnV0ZXNba2V5XTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0YXR0cihub2RlLCBrZXksIGF0dHJpYnV0ZXNba2V5XSk7XG5cdFx0fVxuXHR9XG59XG5cbmZ1bmN0aW9uIHNldF9jdXN0b21fZWxlbWVudF9kYXRhKG5vZGUsIHByb3AsIHZhbHVlKSB7XG5cdGlmIChwcm9wIGluIG5vZGUpIHtcblx0XHRub2RlW3Byb3BdID0gdmFsdWU7XG5cdH0gZWxzZSB7XG5cdFx0YXR0cihub2RlLCBwcm9wLCB2YWx1ZSk7XG5cdH1cbn1cblxuZnVuY3Rpb24geGxpbmtfYXR0cihub2RlLCBhdHRyaWJ1dGUsIHZhbHVlKSB7XG5cdG5vZGUuc2V0QXR0cmlidXRlTlMoJ2h0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsnLCBhdHRyaWJ1dGUsIHZhbHVlKTtcbn1cblxuZnVuY3Rpb24gZ2V0X2JpbmRpbmdfZ3JvdXBfdmFsdWUoZ3JvdXApIHtcblx0Y29uc3QgdmFsdWUgPSBbXTtcblx0Zm9yIChsZXQgaSA9IDA7IGkgPCBncm91cC5sZW5ndGg7IGkgKz0gMSkge1xuXHRcdGlmIChncm91cFtpXS5jaGVja2VkKSB2YWx1ZS5wdXNoKGdyb3VwW2ldLl9fdmFsdWUpO1xuXHR9XG5cdHJldHVybiB2YWx1ZTtcbn1cblxuZnVuY3Rpb24gdG9fbnVtYmVyKHZhbHVlKSB7XG5cdHJldHVybiB2YWx1ZSA9PT0gJycgPyB1bmRlZmluZWQgOiArdmFsdWU7XG59XG5cbmZ1bmN0aW9uIHRpbWVfcmFuZ2VzX3RvX2FycmF5KHJhbmdlcykge1xuXHRjb25zdCBhcnJheSA9IFtdO1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IHJhbmdlcy5sZW5ndGg7IGkgKz0gMSkge1xuXHRcdGFycmF5LnB1c2goeyBzdGFydDogcmFuZ2VzLnN0YXJ0KGkpLCBlbmQ6IHJhbmdlcy5lbmQoaSkgfSk7XG5cdH1cblx0cmV0dXJuIGFycmF5O1xufVxuXG5mdW5jdGlvbiBjaGlsZHJlbihlbGVtZW50KSB7XG5cdHJldHVybiBBcnJheS5mcm9tKGVsZW1lbnQuY2hpbGROb2Rlcyk7XG59XG5cbmZ1bmN0aW9uIGNsYWltX2VsZW1lbnQobm9kZXMsIG5hbWUsIGF0dHJpYnV0ZXMsIHN2Zykge1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IG5vZGVzLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0Y29uc3Qgbm9kZSA9IG5vZGVzW2ldO1xuXHRcdGlmIChub2RlLm5vZGVOYW1lID09PSBuYW1lKSB7XG5cdFx0XHRmb3IgKGxldCBqID0gMDsgaiA8IG5vZGUuYXR0cmlidXRlcy5sZW5ndGg7IGogKz0gMSkge1xuXHRcdFx0XHRjb25zdCBhdHRyaWJ1dGUgPSBub2RlLmF0dHJpYnV0ZXNbal07XG5cdFx0XHRcdGlmICghYXR0cmlidXRlc1thdHRyaWJ1dGUubmFtZV0pIG5vZGUucmVtb3ZlQXR0cmlidXRlKGF0dHJpYnV0ZS5uYW1lKTtcblx0XHRcdH1cblx0XHRcdHJldHVybiBub2Rlcy5zcGxpY2UoaSwgMSlbMF07IC8vIFRPRE8gc3RyaXAgdW53YW50ZWQgYXR0cmlidXRlc1xuXHRcdH1cblx0fVxuXG5cdHJldHVybiBzdmcgPyBzdmdfZWxlbWVudChuYW1lKSA6IGVsZW1lbnQobmFtZSk7XG59XG5cbmZ1bmN0aW9uIGNsYWltX3RleHQobm9kZXMsIGRhdGEpIHtcblx0Zm9yIChsZXQgaSA9IDA7IGkgPCBub2Rlcy5sZW5ndGg7IGkgKz0gMSkge1xuXHRcdGNvbnN0IG5vZGUgPSBub2Rlc1tpXTtcblx0XHRpZiAobm9kZS5ub2RlVHlwZSA9PT0gMykge1xuXHRcdFx0bm9kZS5kYXRhID0gZGF0YTtcblx0XHRcdHJldHVybiBub2Rlcy5zcGxpY2UoaSwgMSlbMF07XG5cdFx0fVxuXHR9XG5cblx0cmV0dXJuIHRleHQoZGF0YSk7XG59XG5cbmZ1bmN0aW9uIHNldF9kYXRhKHRleHQsIGRhdGEpIHtcblx0ZGF0YSA9ICcnICsgZGF0YTtcblx0aWYgKHRleHQuZGF0YSAhPT0gZGF0YSkgdGV4dC5kYXRhID0gZGF0YTtcbn1cblxuZnVuY3Rpb24gc2V0X2lucHV0X3R5cGUoaW5wdXQsIHR5cGUpIHtcblx0dHJ5IHtcblx0XHRpbnB1dC50eXBlID0gdHlwZTtcblx0fSBjYXRjaCAoZSkge1xuXHRcdC8vIGRvIG5vdGhpbmdcblx0fVxufVxuXG5mdW5jdGlvbiBzZXRfc3R5bGUobm9kZSwga2V5LCB2YWx1ZSkge1xuXHRub2RlLnN0eWxlLnNldFByb3BlcnR5KGtleSwgdmFsdWUpO1xufVxuXG5mdW5jdGlvbiBzZWxlY3Rfb3B0aW9uKHNlbGVjdCwgdmFsdWUpIHtcblx0Zm9yIChsZXQgaSA9IDA7IGkgPCBzZWxlY3Qub3B0aW9ucy5sZW5ndGg7IGkgKz0gMSkge1xuXHRcdGNvbnN0IG9wdGlvbiA9IHNlbGVjdC5vcHRpb25zW2ldO1xuXG5cdFx0aWYgKG9wdGlvbi5fX3ZhbHVlID09PSB2YWx1ZSkge1xuXHRcdFx0b3B0aW9uLnNlbGVjdGVkID0gdHJ1ZTtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdH1cbn1cblxuZnVuY3Rpb24gc2VsZWN0X29wdGlvbnMoc2VsZWN0LCB2YWx1ZSkge1xuXHRmb3IgKGxldCBpID0gMDsgaSA8IHNlbGVjdC5vcHRpb25zLmxlbmd0aDsgaSArPSAxKSB7XG5cdFx0Y29uc3Qgb3B0aW9uID0gc2VsZWN0Lm9wdGlvbnNbaV07XG5cdFx0b3B0aW9uLnNlbGVjdGVkID0gfnZhbHVlLmluZGV4T2Yob3B0aW9uLl9fdmFsdWUpO1xuXHR9XG59XG5cbmZ1bmN0aW9uIHNlbGVjdF92YWx1ZShzZWxlY3QpIHtcblx0Y29uc3Qgc2VsZWN0ZWRfb3B0aW9uID0gc2VsZWN0LnF1ZXJ5U2VsZWN0b3IoJzpjaGVja2VkJykgfHwgc2VsZWN0Lm9wdGlvbnNbMF07XG5cdHJldHVybiBzZWxlY3RlZF9vcHRpb24gJiYgc2VsZWN0ZWRfb3B0aW9uLl9fdmFsdWU7XG59XG5cbmZ1bmN0aW9uIHNlbGVjdF9tdWx0aXBsZV92YWx1ZShzZWxlY3QpIHtcblx0cmV0dXJuIFtdLm1hcC5jYWxsKHNlbGVjdC5xdWVyeVNlbGVjdG9yQWxsKCc6Y2hlY2tlZCcpLCBvcHRpb24gPT4gb3B0aW9uLl9fdmFsdWUpO1xufVxuXG5mdW5jdGlvbiBhZGRfcmVzaXplX2xpc3RlbmVyKGVsZW1lbnQsIGZuKSB7XG5cdGlmIChnZXRDb21wdXRlZFN0eWxlKGVsZW1lbnQpLnBvc2l0aW9uID09PSAnc3RhdGljJykge1xuXHRcdGVsZW1lbnQuc3R5bGUucG9zaXRpb24gPSAncmVsYXRpdmUnO1xuXHR9XG5cblx0Y29uc3Qgb2JqZWN0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnb2JqZWN0Jyk7XG5cdG9iamVjdC5zZXRBdHRyaWJ1dGUoJ3N0eWxlJywgJ2Rpc3BsYXk6IGJsb2NrOyBwb3NpdGlvbjogYWJzb2x1dGU7IHRvcDogMDsgbGVmdDogMDsgaGVpZ2h0OiAxMDAlOyB3aWR0aDogMTAwJTsgb3ZlcmZsb3c6IGhpZGRlbjsgcG9pbnRlci1ldmVudHM6IG5vbmU7IHotaW5kZXg6IC0xOycpO1xuXHRvYmplY3QudHlwZSA9ICd0ZXh0L2h0bWwnO1xuXG5cdGxldCB3aW47XG5cblx0b2JqZWN0Lm9ubG9hZCA9ICgpID0+IHtcblx0XHR3aW4gPSBvYmplY3QuY29udGVudERvY3VtZW50LmRlZmF1bHRWaWV3O1xuXHRcdHdpbi5hZGRFdmVudExpc3RlbmVyKCdyZXNpemUnLCBmbik7XG5cdH07XG5cblx0aWYgKC9UcmlkZW50Ly50ZXN0KG5hdmlnYXRvci51c2VyQWdlbnQpKSB7XG5cdFx0ZWxlbWVudC5hcHBlbmRDaGlsZChvYmplY3QpO1xuXHRcdG9iamVjdC5kYXRhID0gJ2Fib3V0OmJsYW5rJztcblx0fSBlbHNlIHtcblx0XHRvYmplY3QuZGF0YSA9ICdhYm91dDpibGFuayc7XG5cdFx0ZWxlbWVudC5hcHBlbmRDaGlsZChvYmplY3QpO1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRjYW5jZWw6ICgpID0+IHtcblx0XHRcdHdpbiAmJiB3aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lciAmJiB3aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcigncmVzaXplJywgZm4pO1xuXHRcdFx0ZWxlbWVudC5yZW1vdmVDaGlsZChvYmplY3QpO1xuXHRcdH1cblx0fTtcbn1cblxuZnVuY3Rpb24gdG9nZ2xlX2NsYXNzKGVsZW1lbnQsIG5hbWUsIHRvZ2dsZSkge1xuXHRlbGVtZW50LmNsYXNzTGlzdFt0b2dnbGUgPyAnYWRkJyA6ICdyZW1vdmUnXShuYW1lKTtcbn1cblxuZnVuY3Rpb24gY3VzdG9tX2V2ZW50KHR5cGUsIGRldGFpbCkge1xuXHRjb25zdCBlID0gZG9jdW1lbnQuY3JlYXRlRXZlbnQoJ0N1c3RvbUV2ZW50Jyk7XG5cdGUuaW5pdEN1c3RvbUV2ZW50KHR5cGUsIGZhbHNlLCBmYWxzZSwgZGV0YWlsKTtcblx0cmV0dXJuIGU7XG59XG5cbmxldCBzdHlsZXNoZWV0O1xubGV0IGFjdGl2ZSA9IDA7XG5sZXQgY3VycmVudF9ydWxlcyA9IHt9O1xuXG4vLyBodHRwczovL2dpdGh1Yi5jb20vZGFya3NreWFwcC9zdHJpbmctaGFzaC9ibG9iL21hc3Rlci9pbmRleC5qc1xuZnVuY3Rpb24gaGFzaChzdHIpIHtcblx0bGV0IGhhc2ggPSA1MzgxO1xuXHRsZXQgaSA9IHN0ci5sZW5ndGg7XG5cblx0d2hpbGUgKGktLSkgaGFzaCA9ICgoaGFzaCA8PCA1KSAtIGhhc2gpIF4gc3RyLmNoYXJDb2RlQXQoaSk7XG5cdHJldHVybiBoYXNoID4+PiAwO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVfcnVsZShub2RlLCBhLCBiLCBkdXJhdGlvbiwgZGVsYXksIGVhc2UsIGZuLCB1aWQgPSAwKSB7XG5cdGNvbnN0IHN0ZXAgPSAxNi42NjYgLyBkdXJhdGlvbjtcblx0bGV0IGtleWZyYW1lcyA9ICd7XFxuJztcblxuXHRmb3IgKGxldCBwID0gMDsgcCA8PSAxOyBwICs9IHN0ZXApIHtcblx0XHRjb25zdCB0ID0gYSArIChiIC0gYSkgKiBlYXNlKHApO1xuXHRcdGtleWZyYW1lcyArPSBwICogMTAwICsgYCV7JHtmbih0LCAxIC0gdCl9fVxcbmA7XG5cdH1cblxuXHRjb25zdCBydWxlID0ga2V5ZnJhbWVzICsgYDEwMCUgeyR7Zm4oYiwgMSAtIGIpfX1cXG59YDtcblx0Y29uc3QgbmFtZSA9IGBfX3N2ZWx0ZV8ke2hhc2gocnVsZSl9XyR7dWlkfWA7XG5cblx0aWYgKCFjdXJyZW50X3J1bGVzW25hbWVdKSB7XG5cdFx0aWYgKCFzdHlsZXNoZWV0KSB7XG5cdFx0XHRjb25zdCBzdHlsZSA9IGVsZW1lbnQoJ3N0eWxlJyk7XG5cdFx0XHRkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHN0eWxlKTtcblx0XHRcdHN0eWxlc2hlZXQgPSBzdHlsZS5zaGVldDtcblx0XHR9XG5cblx0XHRjdXJyZW50X3J1bGVzW25hbWVdID0gdHJ1ZTtcblx0XHRzdHlsZXNoZWV0Lmluc2VydFJ1bGUoYEBrZXlmcmFtZXMgJHtuYW1lfSAke3J1bGV9YCwgc3R5bGVzaGVldC5jc3NSdWxlcy5sZW5ndGgpO1xuXHR9XG5cblx0Y29uc3QgYW5pbWF0aW9uID0gbm9kZS5zdHlsZS5hbmltYXRpb24gfHwgJyc7XG5cdG5vZGUuc3R5bGUuYW5pbWF0aW9uID0gYCR7YW5pbWF0aW9uID8gYCR7YW5pbWF0aW9ufSwgYCA6IGBgfSR7bmFtZX0gJHtkdXJhdGlvbn1tcyBsaW5lYXIgJHtkZWxheX1tcyAxIGJvdGhgO1xuXG5cdGFjdGl2ZSArPSAxO1xuXHRyZXR1cm4gbmFtZTtcbn1cblxuZnVuY3Rpb24gZGVsZXRlX3J1bGUobm9kZSwgbmFtZSkge1xuXHRub2RlLnN0eWxlLmFuaW1hdGlvbiA9IChub2RlLnN0eWxlLmFuaW1hdGlvbiB8fCAnJylcblx0XHQuc3BsaXQoJywgJylcblx0XHQuZmlsdGVyKG5hbWVcblx0XHRcdD8gYW5pbSA9PiBhbmltLmluZGV4T2YobmFtZSkgPCAwIC8vIHJlbW92ZSBzcGVjaWZpYyBhbmltYXRpb25cblx0XHRcdDogYW5pbSA9PiBhbmltLmluZGV4T2YoJ19fc3ZlbHRlJykgPT09IC0xIC8vIHJlbW92ZSBhbGwgU3ZlbHRlIGFuaW1hdGlvbnNcblx0XHQpXG5cdFx0LmpvaW4oJywgJyk7XG5cblx0aWYgKG5hbWUgJiYgIS0tYWN0aXZlKSBjbGVhcl9ydWxlcygpO1xufVxuXG5mdW5jdGlvbiBjbGVhcl9ydWxlcygpIHtcblx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKCgpID0+IHtcblx0XHRpZiAoYWN0aXZlKSByZXR1cm47XG5cdFx0bGV0IGkgPSBzdHlsZXNoZWV0LmNzc1J1bGVzLmxlbmd0aDtcblx0XHR3aGlsZSAoaS0tKSBzdHlsZXNoZWV0LmRlbGV0ZVJ1bGUoaSk7XG5cdFx0Y3VycmVudF9ydWxlcyA9IHt9O1xuXHR9KTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlX2FuaW1hdGlvbihub2RlLCBmcm9tLCBmbiwgcGFyYW1zKSB7XG5cdGlmICghZnJvbSkgcmV0dXJuIG5vb3A7XG5cblx0Y29uc3QgdG8gPSBub2RlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXHRpZiAoZnJvbS5sZWZ0ID09PSB0by5sZWZ0ICYmIGZyb20ucmlnaHQgPT09IHRvLnJpZ2h0ICYmIGZyb20udG9wID09PSB0by50b3AgJiYgZnJvbS5ib3R0b20gPT09IHRvLmJvdHRvbSkgcmV0dXJuIG5vb3A7XG5cblx0Y29uc3Qge1xuXHRcdGRlbGF5ID0gMCxcblx0XHRkdXJhdGlvbiA9IDMwMCxcblx0XHRlYXNpbmcgPSBpZGVudGl0eSxcblx0XHRzdGFydDogc3RhcnRfdGltZSA9IHdpbmRvdy5wZXJmb3JtYW5jZS5ub3coKSArIGRlbGF5LFxuXHRcdGVuZCA9IHN0YXJ0X3RpbWUgKyBkdXJhdGlvbixcblx0XHR0aWNrID0gbm9vcCxcblx0XHRjc3Ncblx0fSA9IGZuKG5vZGUsIHsgZnJvbSwgdG8gfSwgcGFyYW1zKTtcblxuXHRsZXQgcnVubmluZyA9IHRydWU7XG5cdGxldCBzdGFydGVkID0gZmFsc2U7XG5cdGxldCBuYW1lO1xuXG5cdGNvbnN0IGNzc190ZXh0ID0gbm9kZS5zdHlsZS5jc3NUZXh0O1xuXG5cdGZ1bmN0aW9uIHN0YXJ0KCkge1xuXHRcdGlmIChjc3MpIHtcblx0XHRcdGlmIChkZWxheSkgbm9kZS5zdHlsZS5jc3NUZXh0ID0gY3NzX3RleHQ7IC8vIFRPRE8gY3JlYXRlIGRlbGF5ZWQgYW5pbWF0aW9uIGluc3RlYWQ/XG5cdFx0XHRuYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgMCwgMSwgZHVyYXRpb24sIDAsIGVhc2luZywgY3NzKTtcblx0XHR9XG5cblx0XHRzdGFydGVkID0gdHJ1ZTtcblx0fVxuXG5cdGZ1bmN0aW9uIHN0b3AoKSB7XG5cdFx0aWYgKGNzcykgZGVsZXRlX3J1bGUobm9kZSwgbmFtZSk7XG5cdFx0cnVubmluZyA9IGZhbHNlO1xuXHR9XG5cblx0bG9vcChub3cgPT4ge1xuXHRcdGlmICghc3RhcnRlZCAmJiBub3cgPj0gc3RhcnRfdGltZSkge1xuXHRcdFx0c3RhcnQoKTtcblx0XHR9XG5cblx0XHRpZiAoc3RhcnRlZCAmJiBub3cgPj0gZW5kKSB7XG5cdFx0XHR0aWNrKDEsIDApO1xuXHRcdFx0c3RvcCgpO1xuXHRcdH1cblxuXHRcdGlmICghcnVubmluZykge1xuXHRcdFx0cmV0dXJuIGZhbHNlO1xuXHRcdH1cblxuXHRcdGlmIChzdGFydGVkKSB7XG5cdFx0XHRjb25zdCBwID0gbm93IC0gc3RhcnRfdGltZTtcblx0XHRcdGNvbnN0IHQgPSAwICsgMSAqIGVhc2luZyhwIC8gZHVyYXRpb24pO1xuXHRcdFx0dGljayh0LCAxIC0gdCk7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHRydWU7XG5cdH0pO1xuXG5cdGlmIChkZWxheSkge1xuXHRcdGlmIChjc3MpIG5vZGUuc3R5bGUuY3NzVGV4dCArPSBjc3MoMCwgMSk7XG5cdH0gZWxzZSB7XG5cdFx0c3RhcnQoKTtcblx0fVxuXG5cdHRpY2soMCwgMSk7XG5cblx0cmV0dXJuIHN0b3A7XG59XG5cbmZ1bmN0aW9uIGZpeF9wb3NpdGlvbihub2RlKSB7XG5cdGNvbnN0IHN0eWxlID0gZ2V0Q29tcHV0ZWRTdHlsZShub2RlKTtcblxuXHRpZiAoc3R5bGUucG9zaXRpb24gIT09ICdhYnNvbHV0ZScgJiYgc3R5bGUucG9zaXRpb24gIT09ICdmaXhlZCcpIHtcblx0XHRjb25zdCB7IHdpZHRoLCBoZWlnaHQgfSA9IHN0eWxlO1xuXHRcdGNvbnN0IGEgPSBub2RlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXHRcdG5vZGUuc3R5bGUucG9zaXRpb24gPSAnYWJzb2x1dGUnO1xuXHRcdG5vZGUuc3R5bGUud2lkdGggPSB3aWR0aDtcblx0XHRub2RlLnN0eWxlLmhlaWdodCA9IGhlaWdodDtcblx0XHRjb25zdCBiID0gbm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcblxuXHRcdGlmIChhLmxlZnQgIT09IGIubGVmdCB8fCBhLnRvcCAhPT0gYi50b3ApIHtcblx0XHRcdGNvbnN0IHN0eWxlID0gZ2V0Q29tcHV0ZWRTdHlsZShub2RlKTtcblx0XHRcdGNvbnN0IHRyYW5zZm9ybSA9IHN0eWxlLnRyYW5zZm9ybSA9PT0gJ25vbmUnID8gJycgOiBzdHlsZS50cmFuc2Zvcm07XG5cblx0XHRcdG5vZGUuc3R5bGUudHJhbnNmb3JtID0gYCR7dHJhbnNmb3JtfSB0cmFuc2xhdGUoJHthLmxlZnQgLSBiLmxlZnR9cHgsICR7YS50b3AgLSBiLnRvcH1weClgO1xuXHRcdH1cblx0fVxufVxuXG5sZXQgY3VycmVudF9jb21wb25lbnQ7XG5cbmZ1bmN0aW9uIHNldF9jdXJyZW50X2NvbXBvbmVudChjb21wb25lbnQpIHtcblx0Y3VycmVudF9jb21wb25lbnQgPSBjb21wb25lbnQ7XG59XG5cbmZ1bmN0aW9uIGdldF9jdXJyZW50X2NvbXBvbmVudCgpIHtcblx0aWYgKCFjdXJyZW50X2NvbXBvbmVudCkgdGhyb3cgbmV3IEVycm9yKGBGdW5jdGlvbiBjYWxsZWQgb3V0c2lkZSBjb21wb25lbnQgaW5pdGlhbGl6YXRpb25gKTtcblx0cmV0dXJuIGN1cnJlbnRfY29tcG9uZW50O1xufVxuXG5mdW5jdGlvbiBiZWZvcmVVcGRhdGUoZm4pIHtcblx0Z2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuYmVmb3JlX3JlbmRlci5wdXNoKGZuKTtcbn1cblxuZnVuY3Rpb24gb25Nb3VudChmbikge1xuXHRnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5vbl9tb3VudC5wdXNoKGZuKTtcbn1cblxuZnVuY3Rpb24gYWZ0ZXJVcGRhdGUoZm4pIHtcblx0Z2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuYWZ0ZXJfcmVuZGVyLnB1c2goZm4pO1xufVxuXG5mdW5jdGlvbiBvbkRlc3Ryb3koZm4pIHtcblx0Z2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQub25fZGVzdHJveS5wdXNoKGZuKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlRXZlbnREaXNwYXRjaGVyKCkge1xuXHRjb25zdCBjb21wb25lbnQgPSBjdXJyZW50X2NvbXBvbmVudDtcblxuXHRyZXR1cm4gKHR5cGUsIGRldGFpbCkgPT4ge1xuXHRcdGNvbnN0IGNhbGxiYWNrcyA9IGNvbXBvbmVudC4kJC5jYWxsYmFja3NbdHlwZV07XG5cblx0XHRpZiAoY2FsbGJhY2tzKSB7XG5cdFx0XHQvLyBUT0RPIGFyZSB0aGVyZSBzaXR1YXRpb25zIHdoZXJlIGV2ZW50cyBjb3VsZCBiZSBkaXNwYXRjaGVkXG5cdFx0XHQvLyBpbiBhIHNlcnZlciAobm9uLURPTSkgZW52aXJvbm1lbnQ/XG5cdFx0XHRjb25zdCBldmVudCA9IGN1c3RvbV9ldmVudCh0eXBlLCBkZXRhaWwpO1xuXHRcdFx0Y2FsbGJhY2tzLnNsaWNlKCkuZm9yRWFjaChmbiA9PiB7XG5cdFx0XHRcdGZuLmNhbGwoY29tcG9uZW50LCBldmVudCk7XG5cdFx0XHR9KTtcblx0XHR9XG5cdH07XG59XG5cbmZ1bmN0aW9uIHNldENvbnRleHQoa2V5LCBjb250ZXh0KSB7XG5cdGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLmNvbnRleHQuc2V0KGtleSwgY29udGV4dCk7XG59XG5cbmZ1bmN0aW9uIGdldENvbnRleHQoa2V5KSB7XG5cdHJldHVybiBnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5jb250ZXh0LmdldChrZXkpO1xufVxuXG4vLyBUT0RPIGZpZ3VyZSBvdXQgaWYgd2Ugc3RpbGwgd2FudCB0byBzdXBwb3J0XG4vLyBzaG9ydGhhbmQgZXZlbnRzLCBvciBpZiB3ZSB3YW50IHRvIGltcGxlbWVudFxuLy8gYSByZWFsIGJ1YmJsaW5nIG1lY2hhbmlzbVxuZnVuY3Rpb24gYnViYmxlKGNvbXBvbmVudCwgZXZlbnQpIHtcblx0Y29uc3QgY2FsbGJhY2tzID0gY29tcG9uZW50LiQkLmNhbGxiYWNrc1tldmVudC50eXBlXTtcblxuXHRpZiAoY2FsbGJhY2tzKSB7XG5cdFx0Y2FsbGJhY2tzLnNsaWNlKCkuZm9yRWFjaChmbiA9PiBmbihldmVudCkpO1xuXHR9XG59XG5cbmNvbnN0IGRpcnR5X2NvbXBvbmVudHMgPSBbXTtcbmNvbnN0IGludHJvcyA9IHsgZW5hYmxlZDogZmFsc2UgfTtcblxubGV0IHVwZGF0ZV9wcm9taXNlO1xuY29uc3QgYmluZGluZ19jYWxsYmFja3MgPSBbXTtcbmNvbnN0IHJlbmRlcl9jYWxsYmFja3MgPSBbXTtcbmNvbnN0IGZsdXNoX2NhbGxiYWNrcyA9IFtdO1xuXG5mdW5jdGlvbiBzY2hlZHVsZV91cGRhdGUoKSB7XG5cdGlmICghdXBkYXRlX3Byb21pc2UpIHtcblx0XHR1cGRhdGVfcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xuXHRcdHVwZGF0ZV9wcm9taXNlLnRoZW4oZmx1c2gpO1xuXHR9XG59XG5cbmZ1bmN0aW9uIHRpY2soKSB7XG5cdHNjaGVkdWxlX3VwZGF0ZSgpO1xuXHRyZXR1cm4gdXBkYXRlX3Byb21pc2U7XG59XG5cbmZ1bmN0aW9uIGFkZF9iaW5kaW5nX2NhbGxiYWNrKGZuKSB7XG5cdGJpbmRpbmdfY2FsbGJhY2tzLnB1c2goZm4pO1xufVxuXG5mdW5jdGlvbiBhZGRfcmVuZGVyX2NhbGxiYWNrKGZuKSB7XG5cdHJlbmRlcl9jYWxsYmFja3MucHVzaChmbik7XG59XG5cbmZ1bmN0aW9uIGFkZF9mbHVzaF9jYWxsYmFjayhmbikge1xuXHRmbHVzaF9jYWxsYmFja3MucHVzaChmbik7XG59XG5cbmZ1bmN0aW9uIGZsdXNoKCkge1xuXHRjb25zdCBzZWVuX2NhbGxiYWNrcyA9IG5ldyBTZXQoKTtcblxuXHRkbyB7XG5cdFx0Ly8gZmlyc3QsIGNhbGwgYmVmb3JlVXBkYXRlIGZ1bmN0aW9uc1xuXHRcdC8vIGFuZCB1cGRhdGUgY29tcG9uZW50c1xuXHRcdHdoaWxlIChkaXJ0eV9jb21wb25lbnRzLmxlbmd0aCkge1xuXHRcdFx0Y29uc3QgY29tcG9uZW50ID0gZGlydHlfY29tcG9uZW50cy5zaGlmdCgpO1xuXHRcdFx0c2V0X2N1cnJlbnRfY29tcG9uZW50KGNvbXBvbmVudCk7XG5cdFx0XHR1cGRhdGUoY29tcG9uZW50LiQkKTtcblx0XHR9XG5cblx0XHR3aGlsZSAoYmluZGluZ19jYWxsYmFja3MubGVuZ3RoKSBiaW5kaW5nX2NhbGxiYWNrcy5zaGlmdCgpKCk7XG5cblx0XHQvLyB0aGVuLCBvbmNlIGNvbXBvbmVudHMgYXJlIHVwZGF0ZWQsIGNhbGxcblx0XHQvLyBhZnRlclVwZGF0ZSBmdW5jdGlvbnMuIFRoaXMgbWF5IGNhdXNlXG5cdFx0Ly8gc3Vic2VxdWVudCB1cGRhdGVzLi4uXG5cdFx0d2hpbGUgKHJlbmRlcl9jYWxsYmFja3MubGVuZ3RoKSB7XG5cdFx0XHRjb25zdCBjYWxsYmFjayA9IHJlbmRlcl9jYWxsYmFja3MucG9wKCk7XG5cdFx0XHRpZiAoIXNlZW5fY2FsbGJhY2tzLmhhcyhjYWxsYmFjaykpIHtcblx0XHRcdFx0Y2FsbGJhY2soKTtcblxuXHRcdFx0XHQvLyAuLi5zbyBndWFyZCBhZ2FpbnN0IGluZmluaXRlIGxvb3BzXG5cdFx0XHRcdHNlZW5fY2FsbGJhY2tzLmFkZChjYWxsYmFjayk7XG5cdFx0XHR9XG5cdFx0fVxuXHR9IHdoaWxlIChkaXJ0eV9jb21wb25lbnRzLmxlbmd0aCk7XG5cblx0d2hpbGUgKGZsdXNoX2NhbGxiYWNrcy5sZW5ndGgpIHtcblx0XHRmbHVzaF9jYWxsYmFja3MucG9wKCkoKTtcblx0fVxuXG5cdHVwZGF0ZV9wcm9taXNlID0gbnVsbDtcbn1cblxuZnVuY3Rpb24gdXBkYXRlKCQkKSB7XG5cdGlmICgkJC5mcmFnbWVudCkge1xuXHRcdCQkLnVwZGF0ZSgkJC5kaXJ0eSk7XG5cdFx0cnVuX2FsbCgkJC5iZWZvcmVfcmVuZGVyKTtcblx0XHQkJC5mcmFnbWVudC5wKCQkLmRpcnR5LCAkJC5jdHgpO1xuXHRcdCQkLmRpcnR5ID0gbnVsbDtcblxuXHRcdCQkLmFmdGVyX3JlbmRlci5mb3JFYWNoKGFkZF9yZW5kZXJfY2FsbGJhY2spO1xuXHR9XG59XG5cbmxldCBwcm9taXNlO1xuXG5mdW5jdGlvbiB3YWl0KCkge1xuXHRpZiAoIXByb21pc2UpIHtcblx0XHRwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG5cdFx0cHJvbWlzZS50aGVuKCgpID0+IHtcblx0XHRcdHByb21pc2UgPSBudWxsO1xuXHRcdH0pO1xuXHR9XG5cblx0cmV0dXJuIHByb21pc2U7XG59XG5cbmZ1bmN0aW9uIGRpc3BhdGNoKG5vZGUsIGRpcmVjdGlvbiwga2luZCkge1xuXHRub2RlLmRpc3BhdGNoRXZlbnQoY3VzdG9tX2V2ZW50KGAke2RpcmVjdGlvbiA/ICdpbnRybycgOiAnb3V0cm8nfSR7a2luZH1gKSk7XG59XG5cbmxldCBvdXRyb3M7XG5cbmZ1bmN0aW9uIGdyb3VwX291dHJvcygpIHtcblx0b3V0cm9zID0ge1xuXHRcdHJlbWFpbmluZzogMCxcblx0XHRjYWxsYmFja3M6IFtdXG5cdH07XG59XG5cbmZ1bmN0aW9uIGNoZWNrX291dHJvcygpIHtcblx0aWYgKCFvdXRyb3MucmVtYWluaW5nKSB7XG5cdFx0cnVuX2FsbChvdXRyb3MuY2FsbGJhY2tzKTtcblx0fVxufVxuXG5mdW5jdGlvbiBvbl9vdXRybyhjYWxsYmFjaykge1xuXHRvdXRyb3MuY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVfaW5fdHJhbnNpdGlvbihub2RlLCBmbiwgcGFyYW1zKSB7XG5cdGxldCBjb25maWcgPSBmbihub2RlLCBwYXJhbXMpO1xuXHRsZXQgcnVubmluZyA9IGZhbHNlO1xuXHRsZXQgYW5pbWF0aW9uX25hbWU7XG5cdGxldCB0YXNrO1xuXHRsZXQgdWlkID0gMDtcblxuXHRmdW5jdGlvbiBjbGVhbnVwKCkge1xuXHRcdGlmIChhbmltYXRpb25fbmFtZSkgZGVsZXRlX3J1bGUobm9kZSwgYW5pbWF0aW9uX25hbWUpO1xuXHR9XG5cblx0ZnVuY3Rpb24gZ28oKSB7XG5cdFx0Y29uc3Qge1xuXHRcdFx0ZGVsYXkgPSAwLFxuXHRcdFx0ZHVyYXRpb24gPSAzMDAsXG5cdFx0XHRlYXNpbmcgPSBpZGVudGl0eSxcblx0XHRcdHRpY2s6IHRpY2skJDEgPSBub29wLFxuXHRcdFx0Y3NzXG5cdFx0fSA9IGNvbmZpZztcblxuXHRcdGlmIChjc3MpIGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgMCwgMSwgZHVyYXRpb24sIGRlbGF5LCBlYXNpbmcsIGNzcywgdWlkKyspO1xuXHRcdHRpY2skJDEoMCwgMSk7XG5cblx0XHRjb25zdCBzdGFydF90aW1lID0gd2luZG93LnBlcmZvcm1hbmNlLm5vdygpICsgZGVsYXk7XG5cdFx0Y29uc3QgZW5kX3RpbWUgPSBzdGFydF90aW1lICsgZHVyYXRpb247XG5cblx0XHRpZiAodGFzaykgdGFzay5hYm9ydCgpO1xuXHRcdHJ1bm5pbmcgPSB0cnVlO1xuXG5cdFx0dGFzayA9IGxvb3Aobm93ID0+IHtcblx0XHRcdGlmIChydW5uaW5nKSB7XG5cdFx0XHRcdGlmIChub3cgPj0gZW5kX3RpbWUpIHtcblx0XHRcdFx0XHR0aWNrJCQxKDEsIDApO1xuXHRcdFx0XHRcdGNsZWFudXAoKTtcblx0XHRcdFx0XHRyZXR1cm4gcnVubmluZyA9IGZhbHNlO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0aWYgKG5vdyA+PSBzdGFydF90aW1lKSB7XG5cdFx0XHRcdFx0Y29uc3QgdCA9IGVhc2luZygobm93IC0gc3RhcnRfdGltZSkgLyBkdXJhdGlvbik7XG5cdFx0XHRcdFx0dGljayQkMSh0LCAxIC0gdCk7XG5cdFx0XHRcdH1cblx0XHRcdH1cblxuXHRcdFx0cmV0dXJuIHJ1bm5pbmc7XG5cdFx0fSk7XG5cdH1cblxuXHRsZXQgc3RhcnRlZCA9IGZhbHNlO1xuXG5cdHJldHVybiB7XG5cdFx0c3RhcnQoKSB7XG5cdFx0XHRpZiAoc3RhcnRlZCkgcmV0dXJuO1xuXG5cdFx0XHRkZWxldGVfcnVsZShub2RlKTtcblxuXHRcdFx0aWYgKHR5cGVvZiBjb25maWcgPT09ICdmdW5jdGlvbicpIHtcblx0XHRcdFx0Y29uZmlnID0gY29uZmlnKCk7XG5cdFx0XHRcdHdhaXQoKS50aGVuKGdvKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdGdvKCk7XG5cdFx0XHR9XG5cdFx0fSxcblxuXHRcdGludmFsaWRhdGUoKSB7XG5cdFx0XHRzdGFydGVkID0gZmFsc2U7XG5cdFx0fSxcblxuXHRcdGVuZCgpIHtcblx0XHRcdGlmIChydW5uaW5nKSB7XG5cdFx0XHRcdGNsZWFudXAoKTtcblx0XHRcdFx0cnVubmluZyA9IGZhbHNlO1xuXHRcdFx0fVxuXHRcdH1cblx0fTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlX291dF90cmFuc2l0aW9uKG5vZGUsIGZuLCBwYXJhbXMpIHtcblx0bGV0IGNvbmZpZyA9IGZuKG5vZGUsIHBhcmFtcyk7XG5cdGxldCBydW5uaW5nID0gdHJ1ZTtcblx0bGV0IGFuaW1hdGlvbl9uYW1lO1xuXG5cdGNvbnN0IGdyb3VwID0gb3V0cm9zO1xuXG5cdGdyb3VwLnJlbWFpbmluZyArPSAxO1xuXG5cdGZ1bmN0aW9uIGdvKCkge1xuXHRcdGNvbnN0IHtcblx0XHRcdGRlbGF5ID0gMCxcblx0XHRcdGR1cmF0aW9uID0gMzAwLFxuXHRcdFx0ZWFzaW5nID0gaWRlbnRpdHksXG5cdFx0XHR0aWNrOiB0aWNrJCQxID0gbm9vcCxcblx0XHRcdGNzc1xuXHRcdH0gPSBjb25maWc7XG5cblx0XHRpZiAoY3NzKSBhbmltYXRpb25fbmFtZSA9IGNyZWF0ZV9ydWxlKG5vZGUsIDEsIDAsIGR1cmF0aW9uLCBkZWxheSwgZWFzaW5nLCBjc3MpO1xuXG5cdFx0Y29uc3Qgc3RhcnRfdGltZSA9IHdpbmRvdy5wZXJmb3JtYW5jZS5ub3coKSArIGRlbGF5O1xuXHRcdGNvbnN0IGVuZF90aW1lID0gc3RhcnRfdGltZSArIGR1cmF0aW9uO1xuXG5cdFx0bG9vcChub3cgPT4ge1xuXHRcdFx0aWYgKHJ1bm5pbmcpIHtcblx0XHRcdFx0aWYgKG5vdyA+PSBlbmRfdGltZSkge1xuXHRcdFx0XHRcdHRpY2skJDEoMCwgMSk7XG5cblx0XHRcdFx0XHRpZiAoIS0tZ3JvdXAucmVtYWluaW5nKSB7XG5cdFx0XHRcdFx0XHQvLyB0aGlzIHdpbGwgcmVzdWx0IGluIGBlbmQoKWAgYmVpbmcgY2FsbGVkLFxuXHRcdFx0XHRcdFx0Ly8gc28gd2UgZG9uJ3QgbmVlZCB0byBjbGVhbiB1cCBoZXJlXG5cdFx0XHRcdFx0XHRydW5fYWxsKGdyb3VwLmNhbGxiYWNrcyk7XG5cdFx0XHRcdFx0fVxuXG5cdFx0XHRcdFx0cmV0dXJuIGZhbHNlO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0aWYgKG5vdyA+PSBzdGFydF90aW1lKSB7XG5cdFx0XHRcdFx0Y29uc3QgdCA9IGVhc2luZygobm93IC0gc3RhcnRfdGltZSkgLyBkdXJhdGlvbik7XG5cdFx0XHRcdFx0dGljayQkMSgxIC0gdCwgdCk7XG5cdFx0XHRcdH1cblx0XHRcdH1cblxuXHRcdFx0cmV0dXJuIHJ1bm5pbmc7XG5cdFx0fSk7XG5cdH1cblxuXHRpZiAodHlwZW9mIGNvbmZpZyA9PT0gJ2Z1bmN0aW9uJykge1xuXHRcdHdhaXQoKS50aGVuKCgpID0+IHtcblx0XHRcdGNvbmZpZyA9IGNvbmZpZygpO1xuXHRcdFx0Z28oKTtcblx0XHR9KTtcblx0fSBlbHNlIHtcblx0XHRnbygpO1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRlbmQocmVzZXQpIHtcblx0XHRcdGlmIChyZXNldCAmJiBjb25maWcudGljaykge1xuXHRcdFx0XHRjb25maWcudGljaygxLCAwKTtcblx0XHRcdH1cblxuXHRcdFx0aWYgKHJ1bm5pbmcpIHtcblx0XHRcdFx0aWYgKGFuaW1hdGlvbl9uYW1lKSBkZWxldGVfcnVsZShub2RlLCBhbmltYXRpb25fbmFtZSk7XG5cdFx0XHRcdHJ1bm5pbmcgPSBmYWxzZTtcblx0XHRcdH1cblx0XHR9XG5cdH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZV9iaWRpcmVjdGlvbmFsX3RyYW5zaXRpb24obm9kZSwgZm4sIHBhcmFtcywgaW50cm8pIHtcblx0bGV0IGNvbmZpZyA9IGZuKG5vZGUsIHBhcmFtcyk7XG5cblx0bGV0IHQgPSBpbnRybyA/IDAgOiAxO1xuXG5cdGxldCBydW5uaW5nX3Byb2dyYW0gPSBudWxsO1xuXHRsZXQgcGVuZGluZ19wcm9ncmFtID0gbnVsbDtcblx0bGV0IGFuaW1hdGlvbl9uYW1lID0gbnVsbDtcblxuXHRmdW5jdGlvbiBjbGVhcl9hbmltYXRpb24oKSB7XG5cdFx0aWYgKGFuaW1hdGlvbl9uYW1lKSBkZWxldGVfcnVsZShub2RlLCBhbmltYXRpb25fbmFtZSk7XG5cdH1cblxuXHRmdW5jdGlvbiBpbml0KHByb2dyYW0sIGR1cmF0aW9uKSB7XG5cdFx0Y29uc3QgZCA9IHByb2dyYW0uYiAtIHQ7XG5cdFx0ZHVyYXRpb24gKj0gTWF0aC5hYnMoZCk7XG5cblx0XHRyZXR1cm4ge1xuXHRcdFx0YTogdCxcblx0XHRcdGI6IHByb2dyYW0uYixcblx0XHRcdGQsXG5cdFx0XHRkdXJhdGlvbixcblx0XHRcdHN0YXJ0OiBwcm9ncmFtLnN0YXJ0LFxuXHRcdFx0ZW5kOiBwcm9ncmFtLnN0YXJ0ICsgZHVyYXRpb24sXG5cdFx0XHRncm91cDogcHJvZ3JhbS5ncm91cFxuXHRcdH07XG5cdH1cblxuXHRmdW5jdGlvbiBnbyhiKSB7XG5cdFx0Y29uc3Qge1xuXHRcdFx0ZGVsYXkgPSAwLFxuXHRcdFx0ZHVyYXRpb24gPSAzMDAsXG5cdFx0XHRlYXNpbmcgPSBpZGVudGl0eSxcblx0XHRcdHRpY2s6IHRpY2skJDEgPSBub29wLFxuXHRcdFx0Y3NzXG5cdFx0fSA9IGNvbmZpZztcblxuXHRcdGNvbnN0IHByb2dyYW0gPSB7XG5cdFx0XHRzdGFydDogd2luZG93LnBlcmZvcm1hbmNlLm5vdygpICsgZGVsYXksXG5cdFx0XHRiXG5cdFx0fTtcblxuXHRcdGlmICghYikge1xuXHRcdFx0cHJvZ3JhbS5ncm91cCA9IG91dHJvcztcblx0XHRcdG91dHJvcy5yZW1haW5pbmcgKz0gMTtcblx0XHR9XG5cblx0XHRpZiAocnVubmluZ19wcm9ncmFtKSB7XG5cdFx0XHRwZW5kaW5nX3Byb2dyYW0gPSBwcm9ncmFtO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHQvLyBpZiB0aGlzIGlzIGFuIGludHJvLCBhbmQgdGhlcmUncyBhIGRlbGF5LCB3ZSBuZWVkIHRvIGRvXG5cdFx0XHQvLyBhbiBpbml0aWFsIHRpY2sgYW5kL29yIGFwcGx5IENTUyBhbmltYXRpb24gaW1tZWRpYXRlbHlcblx0XHRcdGlmIChjc3MpIHtcblx0XHRcdFx0Y2xlYXJfYW5pbWF0aW9uKCk7XG5cdFx0XHRcdGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgdCwgYiwgZHVyYXRpb24sIGRlbGF5LCBlYXNpbmcsIGNzcyk7XG5cdFx0XHR9XG5cblx0XHRcdGlmIChiKSB0aWNrJCQxKDAsIDEpO1xuXG5cdFx0XHRydW5uaW5nX3Byb2dyYW0gPSBpbml0KHByb2dyYW0sIGR1cmF0aW9uKTtcblx0XHRcdGFkZF9yZW5kZXJfY2FsbGJhY2soKCkgPT4gZGlzcGF0Y2gobm9kZSwgYiwgJ3N0YXJ0JykpO1xuXG5cdFx0XHRsb29wKG5vdyA9PiB7XG5cdFx0XHRcdGlmIChwZW5kaW5nX3Byb2dyYW0gJiYgbm93ID4gcGVuZGluZ19wcm9ncmFtLnN0YXJ0KSB7XG5cdFx0XHRcdFx0cnVubmluZ19wcm9ncmFtID0gaW5pdChwZW5kaW5nX3Byb2dyYW0sIGR1cmF0aW9uKTtcblx0XHRcdFx0XHRwZW5kaW5nX3Byb2dyYW0gPSBudWxsO1xuXG5cdFx0XHRcdFx0ZGlzcGF0Y2gobm9kZSwgcnVubmluZ19wcm9ncmFtLmIsICdzdGFydCcpO1xuXG5cdFx0XHRcdFx0aWYgKGNzcykge1xuXHRcdFx0XHRcdFx0Y2xlYXJfYW5pbWF0aW9uKCk7XG5cdFx0XHRcdFx0XHRhbmltYXRpb25fbmFtZSA9IGNyZWF0ZV9ydWxlKG5vZGUsIHQsIHJ1bm5pbmdfcHJvZ3JhbS5iLCBydW5uaW5nX3Byb2dyYW0uZHVyYXRpb24sIDAsIGVhc2luZywgY29uZmlnLmNzcyk7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9XG5cblx0XHRcdFx0aWYgKHJ1bm5pbmdfcHJvZ3JhbSkge1xuXHRcdFx0XHRcdGlmIChub3cgPj0gcnVubmluZ19wcm9ncmFtLmVuZCkge1xuXHRcdFx0XHRcdFx0dGljayQkMSh0ID0gcnVubmluZ19wcm9ncmFtLmIsIDEgLSB0KTtcblx0XHRcdFx0XHRcdGRpc3BhdGNoKG5vZGUsIHJ1bm5pbmdfcHJvZ3JhbS5iLCAnZW5kJyk7XG5cblx0XHRcdFx0XHRcdGlmICghcGVuZGluZ19wcm9ncmFtKSB7XG5cdFx0XHRcdFx0XHRcdC8vIHdlJ3JlIGRvbmVcblx0XHRcdFx0XHRcdFx0aWYgKHJ1bm5pbmdfcHJvZ3JhbS5iKSB7XG5cdFx0XHRcdFx0XHRcdFx0Ly8gaW50cm8g4oCUIHdlIGNhbiB0aWR5IHVwIGltbWVkaWF0ZWx5XG5cdFx0XHRcdFx0XHRcdFx0Y2xlYXJfYW5pbWF0aW9uKCk7XG5cdFx0XHRcdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0XHRcdFx0Ly8gb3V0cm8g4oCUIG5lZWRzIHRvIGJlIGNvb3JkaW5hdGVkXG5cdFx0XHRcdFx0XHRcdFx0aWYgKCEtLXJ1bm5pbmdfcHJvZ3JhbS5ncm91cC5yZW1haW5pbmcpIHJ1bl9hbGwocnVubmluZ19wcm9ncmFtLmdyb3VwLmNhbGxiYWNrcyk7XG5cdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdH1cblxuXHRcdFx0XHRcdFx0cnVubmluZ19wcm9ncmFtID0gbnVsbDtcblx0XHRcdFx0XHR9XG5cblx0XHRcdFx0XHRlbHNlIGlmIChub3cgPj0gcnVubmluZ19wcm9ncmFtLnN0YXJ0KSB7XG5cdFx0XHRcdFx0XHRjb25zdCBwID0gbm93IC0gcnVubmluZ19wcm9ncmFtLnN0YXJ0O1xuXHRcdFx0XHRcdFx0dCA9IHJ1bm5pbmdfcHJvZ3JhbS5hICsgcnVubmluZ19wcm9ncmFtLmQgKiBlYXNpbmcocCAvIHJ1bm5pbmdfcHJvZ3JhbS5kdXJhdGlvbik7XG5cdFx0XHRcdFx0XHR0aWNrJCQxKHQsIDEgLSB0KTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRyZXR1cm4gISEocnVubmluZ19wcm9ncmFtIHx8IHBlbmRpbmdfcHJvZ3JhbSk7XG5cdFx0XHR9KTtcblx0XHR9XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHJ1bihiKSB7XG5cdFx0XHRpZiAodHlwZW9mIGNvbmZpZyA9PT0gJ2Z1bmN0aW9uJykge1xuXHRcdFx0XHR3YWl0KCkudGhlbigoKSA9PiB7XG5cdFx0XHRcdFx0Y29uZmlnID0gY29uZmlnKCk7XG5cdFx0XHRcdFx0Z28oYik7XG5cdFx0XHRcdH0pO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0Z28oYik7XG5cdFx0XHR9XG5cdFx0fSxcblxuXHRcdGVuZCgpIHtcblx0XHRcdGNsZWFyX2FuaW1hdGlvbigpO1xuXHRcdFx0cnVubmluZ19wcm9ncmFtID0gcGVuZGluZ19wcm9ncmFtID0gbnVsbDtcblx0XHR9XG5cdH07XG59XG5cbmZ1bmN0aW9uIGhhbmRsZV9wcm9taXNlKHByb21pc2UsIGluZm8pIHtcblx0Y29uc3QgdG9rZW4gPSBpbmZvLnRva2VuID0ge307XG5cblx0ZnVuY3Rpb24gdXBkYXRlKHR5cGUsIGluZGV4LCBrZXksIHZhbHVlKSB7XG5cdFx0aWYgKGluZm8udG9rZW4gIT09IHRva2VuKSByZXR1cm47XG5cblx0XHRpbmZvLnJlc29sdmVkID0ga2V5ICYmIHsgW2tleV06IHZhbHVlIH07XG5cblx0XHRjb25zdCBjaGlsZF9jdHggPSBhc3NpZ24oYXNzaWduKHt9LCBpbmZvLmN0eCksIGluZm8ucmVzb2x2ZWQpO1xuXHRcdGNvbnN0IGJsb2NrID0gdHlwZSAmJiAoaW5mby5jdXJyZW50ID0gdHlwZSkoY2hpbGRfY3R4KTtcblxuXHRcdGlmIChpbmZvLmJsb2NrKSB7XG5cdFx0XHRpZiAoaW5mby5ibG9ja3MpIHtcblx0XHRcdFx0aW5mby5ibG9ja3MuZm9yRWFjaCgoYmxvY2ssIGkpID0+IHtcblx0XHRcdFx0XHRpZiAoaSAhPT0gaW5kZXggJiYgYmxvY2spIHtcblx0XHRcdFx0XHRcdGdyb3VwX291dHJvcygpO1xuXHRcdFx0XHRcdFx0b25fb3V0cm8oKCkgPT4ge1xuXHRcdFx0XHRcdFx0XHRibG9jay5kKDEpO1xuXHRcdFx0XHRcdFx0XHRpbmZvLmJsb2Nrc1tpXSA9IG51bGw7XG5cdFx0XHRcdFx0XHR9KTtcblx0XHRcdFx0XHRcdGJsb2NrLm8oMSk7XG5cdFx0XHRcdFx0XHRjaGVja19vdXRyb3MoKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH0pO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0aW5mby5ibG9jay5kKDEpO1xuXHRcdFx0fVxuXG5cdFx0XHRibG9jay5jKCk7XG5cdFx0XHRpZiAoYmxvY2suaSkgYmxvY2suaSgxKTtcblx0XHRcdGJsb2NrLm0oaW5mby5tb3VudCgpLCBpbmZvLmFuY2hvcik7XG5cblx0XHRcdGZsdXNoKCk7XG5cdFx0fVxuXG5cdFx0aW5mby5ibG9jayA9IGJsb2NrO1xuXHRcdGlmIChpbmZvLmJsb2NrcykgaW5mby5ibG9ja3NbaW5kZXhdID0gYmxvY2s7XG5cdH1cblxuXHRpZiAoaXNfcHJvbWlzZShwcm9taXNlKSkge1xuXHRcdHByb21pc2UudGhlbih2YWx1ZSA9PiB7XG5cdFx0XHR1cGRhdGUoaW5mby50aGVuLCAxLCBpbmZvLnZhbHVlLCB2YWx1ZSk7XG5cdFx0fSwgZXJyb3IgPT4ge1xuXHRcdFx0dXBkYXRlKGluZm8uY2F0Y2gsIDIsIGluZm8uZXJyb3IsIGVycm9yKTtcblx0XHR9KTtcblxuXHRcdC8vIGlmIHdlIHByZXZpb3VzbHkgaGFkIGEgdGhlbi9jYXRjaCBibG9jaywgZGVzdHJveSBpdFxuXHRcdGlmIChpbmZvLmN1cnJlbnQgIT09IGluZm8ucGVuZGluZykge1xuXHRcdFx0dXBkYXRlKGluZm8ucGVuZGluZywgMCk7XG5cdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHR9XG5cdH0gZWxzZSB7XG5cdFx0aWYgKGluZm8uY3VycmVudCAhPT0gaW5mby50aGVuKSB7XG5cdFx0XHR1cGRhdGUoaW5mby50aGVuLCAxLCBpbmZvLnZhbHVlLCBwcm9taXNlKTtcblx0XHRcdHJldHVybiB0cnVlO1xuXHRcdH1cblxuXHRcdGluZm8ucmVzb2x2ZWQgPSB7IFtpbmZvLnZhbHVlXTogcHJvbWlzZSB9O1xuXHR9XG59XG5cbmZ1bmN0aW9uIGRlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCkge1xuXHRibG9jay5kKDEpO1xuXHRsb29rdXAuZGVsZXRlKGJsb2NrLmtleSk7XG59XG5cbmZ1bmN0aW9uIG91dHJvX2FuZF9kZXN0cm95X2Jsb2NrKGJsb2NrLCBsb29rdXApIHtcblx0b25fb3V0cm8oKCkgPT4ge1xuXHRcdGRlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCk7XG5cdH0pO1xuXG5cdGJsb2NrLm8oMSk7XG59XG5cbmZ1bmN0aW9uIGZpeF9hbmRfb3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCkge1xuXHRibG9jay5mKCk7XG5cdG91dHJvX2FuZF9kZXN0cm95X2Jsb2NrKGJsb2NrLCBsb29rdXApO1xufVxuXG5mdW5jdGlvbiB1cGRhdGVfa2V5ZWRfZWFjaChvbGRfYmxvY2tzLCBjaGFuZ2VkLCBnZXRfa2V5LCBkeW5hbWljLCBjdHgsIGxpc3QsIGxvb2t1cCwgbm9kZSwgZGVzdHJveSwgY3JlYXRlX2VhY2hfYmxvY2ssIG5leHQsIGdldF9jb250ZXh0KSB7XG5cdGxldCBvID0gb2xkX2Jsb2Nrcy5sZW5ndGg7XG5cdGxldCBuID0gbGlzdC5sZW5ndGg7XG5cblx0bGV0IGkgPSBvO1xuXHRjb25zdCBvbGRfaW5kZXhlcyA9IHt9O1xuXHR3aGlsZSAoaS0tKSBvbGRfaW5kZXhlc1tvbGRfYmxvY2tzW2ldLmtleV0gPSBpO1xuXG5cdGNvbnN0IG5ld19ibG9ja3MgPSBbXTtcblx0Y29uc3QgbmV3X2xvb2t1cCA9IG5ldyBNYXAoKTtcblx0Y29uc3QgZGVsdGFzID0gbmV3IE1hcCgpO1xuXG5cdGkgPSBuO1xuXHR3aGlsZSAoaS0tKSB7XG5cdFx0Y29uc3QgY2hpbGRfY3R4ID0gZ2V0X2NvbnRleHQoY3R4LCBsaXN0LCBpKTtcblx0XHRjb25zdCBrZXkgPSBnZXRfa2V5KGNoaWxkX2N0eCk7XG5cdFx0bGV0IGJsb2NrID0gbG9va3VwLmdldChrZXkpO1xuXG5cdFx0aWYgKCFibG9jaykge1xuXHRcdFx0YmxvY2sgPSBjcmVhdGVfZWFjaF9ibG9jayhrZXksIGNoaWxkX2N0eCk7XG5cdFx0XHRibG9jay5jKCk7XG5cdFx0fSBlbHNlIGlmIChkeW5hbWljKSB7XG5cdFx0XHRibG9jay5wKGNoYW5nZWQsIGNoaWxkX2N0eCk7XG5cdFx0fVxuXG5cdFx0bmV3X2xvb2t1cC5zZXQoa2V5LCBuZXdfYmxvY2tzW2ldID0gYmxvY2spO1xuXG5cdFx0aWYgKGtleSBpbiBvbGRfaW5kZXhlcykgZGVsdGFzLnNldChrZXksIE1hdGguYWJzKGkgLSBvbGRfaW5kZXhlc1trZXldKSk7XG5cdH1cblxuXHRjb25zdCB3aWxsX21vdmUgPSBuZXcgU2V0KCk7XG5cdGNvbnN0IGRpZF9tb3ZlID0gbmV3IFNldCgpO1xuXG5cdGZ1bmN0aW9uIGluc2VydChibG9jaykge1xuXHRcdGlmIChibG9jay5pKSBibG9jay5pKDEpO1xuXHRcdGJsb2NrLm0obm9kZSwgbmV4dCk7XG5cdFx0bG9va3VwLnNldChibG9jay5rZXksIGJsb2NrKTtcblx0XHRuZXh0ID0gYmxvY2suZmlyc3Q7XG5cdFx0bi0tO1xuXHR9XG5cblx0d2hpbGUgKG8gJiYgbikge1xuXHRcdGNvbnN0IG5ld19ibG9jayA9IG5ld19ibG9ja3NbbiAtIDFdO1xuXHRcdGNvbnN0IG9sZF9ibG9jayA9IG9sZF9ibG9ja3NbbyAtIDFdO1xuXHRcdGNvbnN0IG5ld19rZXkgPSBuZXdfYmxvY2sua2V5O1xuXHRcdGNvbnN0IG9sZF9rZXkgPSBvbGRfYmxvY2sua2V5O1xuXG5cdFx0aWYgKG5ld19ibG9jayA9PT0gb2xkX2Jsb2NrKSB7XG5cdFx0XHQvLyBkbyBub3RoaW5nXG5cdFx0XHRuZXh0ID0gbmV3X2Jsb2NrLmZpcnN0O1xuXHRcdFx0by0tO1xuXHRcdFx0bi0tO1xuXHRcdH1cblxuXHRcdGVsc2UgaWYgKCFuZXdfbG9va3VwLmhhcyhvbGRfa2V5KSkge1xuXHRcdFx0Ly8gcmVtb3ZlIG9sZCBibG9ja1xuXHRcdFx0ZGVzdHJveShvbGRfYmxvY2ssIGxvb2t1cCk7XG5cdFx0XHRvLS07XG5cdFx0fVxuXG5cdFx0ZWxzZSBpZiAoIWxvb2t1cC5oYXMobmV3X2tleSkgfHwgd2lsbF9tb3ZlLmhhcyhuZXdfa2V5KSkge1xuXHRcdFx0aW5zZXJ0KG5ld19ibG9jayk7XG5cdFx0fVxuXG5cdFx0ZWxzZSBpZiAoZGlkX21vdmUuaGFzKG9sZF9rZXkpKSB7XG5cdFx0XHRvLS07XG5cblx0XHR9IGVsc2UgaWYgKGRlbHRhcy5nZXQobmV3X2tleSkgPiBkZWx0YXMuZ2V0KG9sZF9rZXkpKSB7XG5cdFx0XHRkaWRfbW92ZS5hZGQobmV3X2tleSk7XG5cdFx0XHRpbnNlcnQobmV3X2Jsb2NrKTtcblxuXHRcdH0gZWxzZSB7XG5cdFx0XHR3aWxsX21vdmUuYWRkKG9sZF9rZXkpO1xuXHRcdFx0by0tO1xuXHRcdH1cblx0fVxuXG5cdHdoaWxlIChvLS0pIHtcblx0XHRjb25zdCBvbGRfYmxvY2sgPSBvbGRfYmxvY2tzW29dO1xuXHRcdGlmICghbmV3X2xvb2t1cC5oYXMob2xkX2Jsb2NrLmtleSkpIGRlc3Ryb3kob2xkX2Jsb2NrLCBsb29rdXApO1xuXHR9XG5cblx0d2hpbGUgKG4pIGluc2VydChuZXdfYmxvY2tzW24gLSAxXSk7XG5cblx0cmV0dXJuIG5ld19ibG9ja3M7XG59XG5cbmZ1bmN0aW9uIG1lYXN1cmUoYmxvY2tzKSB7XG5cdGNvbnN0IHJlY3RzID0ge307XG5cdGxldCBpID0gYmxvY2tzLmxlbmd0aDtcblx0d2hpbGUgKGktLSkgcmVjdHNbYmxvY2tzW2ldLmtleV0gPSBibG9ja3NbaV0ubm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcblx0cmV0dXJuIHJlY3RzO1xufVxuXG5mdW5jdGlvbiBnZXRfc3ByZWFkX3VwZGF0ZShsZXZlbHMsIHVwZGF0ZXMpIHtcblx0Y29uc3QgdXBkYXRlID0ge307XG5cblx0Y29uc3QgdG9fbnVsbF9vdXQgPSB7fTtcblx0Y29uc3QgYWNjb3VudGVkX2ZvciA9IHt9O1xuXG5cdGxldCBpID0gbGV2ZWxzLmxlbmd0aDtcblx0d2hpbGUgKGktLSkge1xuXHRcdGNvbnN0IG8gPSBsZXZlbHNbaV07XG5cdFx0Y29uc3QgbiA9IHVwZGF0ZXNbaV07XG5cblx0XHRpZiAobikge1xuXHRcdFx0Zm9yIChjb25zdCBrZXkgaW4gbykge1xuXHRcdFx0XHRpZiAoIShrZXkgaW4gbikpIHRvX251bGxfb3V0W2tleV0gPSAxO1xuXHRcdFx0fVxuXG5cdFx0XHRmb3IgKGNvbnN0IGtleSBpbiBuKSB7XG5cdFx0XHRcdGlmICghYWNjb3VudGVkX2ZvcltrZXldKSB7XG5cdFx0XHRcdFx0dXBkYXRlW2tleV0gPSBuW2tleV07XG5cdFx0XHRcdFx0YWNjb3VudGVkX2ZvcltrZXldID0gMTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXG5cdFx0XHRsZXZlbHNbaV0gPSBuO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRmb3IgKGNvbnN0IGtleSBpbiBvKSB7XG5cdFx0XHRcdGFjY291bnRlZF9mb3Jba2V5XSA9IDE7XG5cdFx0XHR9XG5cdFx0fVxuXHR9XG5cblx0Zm9yIChjb25zdCBrZXkgaW4gdG9fbnVsbF9vdXQpIHtcblx0XHRpZiAoIShrZXkgaW4gdXBkYXRlKSkgdXBkYXRlW2tleV0gPSB1bmRlZmluZWQ7XG5cdH1cblxuXHRyZXR1cm4gdXBkYXRlO1xufVxuXG5jb25zdCBpbnZhbGlkX2F0dHJpYnV0ZV9uYW1lX2NoYXJhY3RlciA9IC9bXFxzJ1wiPi89XFx1e0ZERDB9LVxcdXtGREVGfVxcdXtGRkZFfVxcdXtGRkZGfVxcdXsxRkZGRX1cXHV7MUZGRkZ9XFx1ezJGRkZFfVxcdXsyRkZGRn1cXHV7M0ZGRkV9XFx1ezNGRkZGfVxcdXs0RkZGRX1cXHV7NEZGRkZ9XFx1ezVGRkZFfVxcdXs1RkZGRn1cXHV7NkZGRkV9XFx1ezZGRkZGfVxcdXs3RkZGRX1cXHV7N0ZGRkZ9XFx1ezhGRkZFfVxcdXs4RkZGRn1cXHV7OUZGRkV9XFx1ezlGRkZGfVxcdXtBRkZGRX1cXHV7QUZGRkZ9XFx1e0JGRkZFfVxcdXtCRkZGRn1cXHV7Q0ZGRkV9XFx1e0NGRkZGfVxcdXtERkZGRX1cXHV7REZGRkZ9XFx1e0VGRkZFfVxcdXtFRkZGRn1cXHV7RkZGRkV9XFx1e0ZGRkZGfVxcdXsxMEZGRkV9XFx1ezEwRkZGRn1dL3U7XG4vLyBodHRwczovL2h0bWwuc3BlYy53aGF0d2cub3JnL211bHRpcGFnZS9zeW50YXguaHRtbCNhdHRyaWJ1dGVzLTJcbi8vIGh0dHBzOi8vaW5mcmEuc3BlYy53aGF0d2cub3JnLyNub25jaGFyYWN0ZXJcblxuZnVuY3Rpb24gc3ByZWFkKGFyZ3MpIHtcblx0Y29uc3QgYXR0cmlidXRlcyA9IE9iamVjdC5hc3NpZ24oe30sIC4uLmFyZ3MpO1xuXHRsZXQgc3RyID0gJyc7XG5cblx0T2JqZWN0LmtleXMoYXR0cmlidXRlcykuZm9yRWFjaChuYW1lID0+IHtcblx0XHRpZiAoaW52YWxpZF9hdHRyaWJ1dGVfbmFtZV9jaGFyYWN0ZXIudGVzdChuYW1lKSkgcmV0dXJuO1xuXG5cdFx0Y29uc3QgdmFsdWUgPSBhdHRyaWJ1dGVzW25hbWVdO1xuXHRcdGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm47XG5cdFx0aWYgKHZhbHVlID09PSB0cnVlKSBzdHIgKz0gXCIgXCIgKyBuYW1lO1xuXG5cdFx0Y29uc3QgZXNjYXBlZCA9IFN0cmluZyh2YWx1ZSlcblx0XHRcdC5yZXBsYWNlKC9cIi9nLCAnJiMzNDsnKVxuXHRcdFx0LnJlcGxhY2UoLycvZywgJyYjMzk7Jyk7XG5cblx0XHRzdHIgKz0gXCIgXCIgKyBuYW1lICsgXCI9XCIgKyBKU09OLnN0cmluZ2lmeShlc2NhcGVkKTtcblx0fSk7XG5cblx0cmV0dXJuIHN0cjtcbn1cblxuY29uc3QgZXNjYXBlZCA9IHtcblx0J1wiJzogJyZxdW90OycsXG5cdFwiJ1wiOiAnJiMzOTsnLFxuXHQnJic6ICcmYW1wOycsXG5cdCc8JzogJyZsdDsnLFxuXHQnPic6ICcmZ3Q7J1xufTtcblxuZnVuY3Rpb24gZXNjYXBlKGh0bWwpIHtcblx0cmV0dXJuIFN0cmluZyhodG1sKS5yZXBsYWNlKC9bXCInJjw+XS9nLCBtYXRjaCA9PiBlc2NhcGVkW21hdGNoXSk7XG59XG5cbmZ1bmN0aW9uIGVhY2goaXRlbXMsIGZuKSB7XG5cdGxldCBzdHIgPSAnJztcblx0Zm9yIChsZXQgaSA9IDA7IGkgPCBpdGVtcy5sZW5ndGg7IGkgKz0gMSkge1xuXHRcdHN0ciArPSBmbihpdGVtc1tpXSwgaSk7XG5cdH1cblx0cmV0dXJuIHN0cjtcbn1cblxuY29uc3QgbWlzc2luZ19jb21wb25lbnQgPSB7XG5cdCQkcmVuZGVyOiAoKSA9PiAnJ1xufTtcblxuZnVuY3Rpb24gdmFsaWRhdGVfY29tcG9uZW50KGNvbXBvbmVudCwgbmFtZSkge1xuXHRpZiAoIWNvbXBvbmVudCB8fCAhY29tcG9uZW50LiQkcmVuZGVyKSB7XG5cdFx0aWYgKG5hbWUgPT09ICdzdmVsdGU6Y29tcG9uZW50JykgbmFtZSArPSAnIHRoaXM9ey4uLn0nO1xuXHRcdHRocm93IG5ldyBFcnJvcihgPCR7bmFtZX0+IGlzIG5vdCBhIHZhbGlkIFNTUiBjb21wb25lbnQuIFlvdSBtYXkgbmVlZCB0byByZXZpZXcgeW91ciBidWlsZCBjb25maWcgdG8gZW5zdXJlIHRoYXQgZGVwZW5kZW5jaWVzIGFyZSBjb21waWxlZCwgcmF0aGVyIHRoYW4gaW1wb3J0ZWQgYXMgcHJlLWNvbXBpbGVkIG1vZHVsZXNgKTtcblx0fVxuXG5cdHJldHVybiBjb21wb25lbnQ7XG59XG5cbmZ1bmN0aW9uIGRlYnVnKGZpbGUsIGxpbmUsIGNvbHVtbiwgdmFsdWVzKSB7XG5cdGNvbnNvbGUubG9nKGB7QGRlYnVnfSAke2ZpbGUgPyBmaWxlICsgJyAnIDogJyd9KCR7bGluZX06JHtjb2x1bW59KWApOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLWNvbnNvbGVcblx0Y29uc29sZS5sb2codmFsdWVzKTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1jb25zb2xlXG5cdHJldHVybiAnJztcbn1cblxubGV0IG9uX2Rlc3Ryb3k7XG5cbmZ1bmN0aW9uIGNyZWF0ZV9zc3JfY29tcG9uZW50KGZuKSB7XG5cdGZ1bmN0aW9uICQkcmVuZGVyKHJlc3VsdCwgcHJvcHMsIGJpbmRpbmdzLCBzbG90cykge1xuXHRcdGNvbnN0IHBhcmVudF9jb21wb25lbnQgPSBjdXJyZW50X2NvbXBvbmVudDtcblxuXHRcdGNvbnN0ICQkID0ge1xuXHRcdFx0b25fZGVzdHJveSxcblx0XHRcdGNvbnRleHQ6IG5ldyBNYXAocGFyZW50X2NvbXBvbmVudCA/IHBhcmVudF9jb21wb25lbnQuJCQuY29udGV4dCA6IFtdKSxcblxuXHRcdFx0Ly8gdGhlc2Ugd2lsbCBiZSBpbW1lZGlhdGVseSBkaXNjYXJkZWRcblx0XHRcdG9uX21vdW50OiBbXSxcblx0XHRcdGJlZm9yZV9yZW5kZXI6IFtdLFxuXHRcdFx0YWZ0ZXJfcmVuZGVyOiBbXSxcblx0XHRcdGNhbGxiYWNrczogYmxhbmtfb2JqZWN0KClcblx0XHR9O1xuXG5cdFx0c2V0X2N1cnJlbnRfY29tcG9uZW50KHsgJCQgfSk7XG5cblx0XHRjb25zdCBodG1sID0gZm4ocmVzdWx0LCBwcm9wcywgYmluZGluZ3MsIHNsb3RzKTtcblxuXHRcdHNldF9jdXJyZW50X2NvbXBvbmVudChwYXJlbnRfY29tcG9uZW50KTtcblx0XHRyZXR1cm4gaHRtbDtcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0cmVuZGVyOiAocHJvcHMgPSB7fSwgb3B0aW9ucyA9IHt9KSA9PiB7XG5cdFx0XHRvbl9kZXN0cm95ID0gW107XG5cblx0XHRcdGNvbnN0IHJlc3VsdCA9IHsgaGVhZDogJycsIGNzczogbmV3IFNldCgpIH07XG5cdFx0XHRjb25zdCBodG1sID0gJCRyZW5kZXIocmVzdWx0LCBwcm9wcywge30sIG9wdGlvbnMpO1xuXG5cdFx0XHRydW5fYWxsKG9uX2Rlc3Ryb3kpO1xuXG5cdFx0XHRyZXR1cm4ge1xuXHRcdFx0XHRodG1sLFxuXHRcdFx0XHRjc3M6IHtcblx0XHRcdFx0XHRjb2RlOiBBcnJheS5mcm9tKHJlc3VsdC5jc3MpLm1hcChjc3MgPT4gY3NzLmNvZGUpLmpvaW4oJ1xcbicpLFxuXHRcdFx0XHRcdG1hcDogbnVsbCAvLyBUT0RPXG5cdFx0XHRcdH0sXG5cdFx0XHRcdGhlYWQ6IHJlc3VsdC5oZWFkXG5cdFx0XHR9O1xuXHRcdH0sXG5cblx0XHQkJHJlbmRlclxuXHR9O1xufVxuXG5mdW5jdGlvbiBnZXRfc3RvcmVfdmFsdWUoc3RvcmUpIHtcblx0bGV0IHZhbHVlO1xuXHRzdG9yZS5zdWJzY3JpYmUoXyA9PiB2YWx1ZSA9IF8pKCk7XG5cdHJldHVybiB2YWx1ZTtcbn1cblxuZnVuY3Rpb24gYmluZChjb21wb25lbnQsIG5hbWUsIGNhbGxiYWNrKSB7XG5cdGlmIChjb21wb25lbnQuJCQucHJvcHMuaW5kZXhPZihuYW1lKSA9PT0gLTEpIHJldHVybjtcblx0Y29tcG9uZW50LiQkLmJvdW5kW25hbWVdID0gY2FsbGJhY2s7XG5cdGNhbGxiYWNrKGNvbXBvbmVudC4kJC5jdHhbbmFtZV0pO1xufVxuXG5mdW5jdGlvbiBtb3VudF9jb21wb25lbnQoY29tcG9uZW50LCB0YXJnZXQsIGFuY2hvcikge1xuXHRjb25zdCB7IGZyYWdtZW50LCBvbl9tb3VudCwgb25fZGVzdHJveSwgYWZ0ZXJfcmVuZGVyIH0gPSBjb21wb25lbnQuJCQ7XG5cblx0ZnJhZ21lbnQubSh0YXJnZXQsIGFuY2hvcik7XG5cblx0Ly8gb25Nb3VudCBoYXBwZW5zIGFmdGVyIHRoZSBpbml0aWFsIGFmdGVyVXBkYXRlLiBCZWNhdXNlXG5cdC8vIGFmdGVyVXBkYXRlIGNhbGxiYWNrcyBoYXBwZW4gaW4gcmV2ZXJzZSBvcmRlciAoaW5uZXIgZmlyc3QpXG5cdC8vIHdlIHNjaGVkdWxlIG9uTW91bnQgY2FsbGJhY2tzIGJlZm9yZSBhZnRlclVwZGF0ZSBjYWxsYmFja3Ncblx0YWRkX3JlbmRlcl9jYWxsYmFjaygoKSA9PiB7XG5cdFx0Y29uc3QgbmV3X29uX2Rlc3Ryb3kgPSBvbl9tb3VudC5tYXAocnVuKS5maWx0ZXIoaXNfZnVuY3Rpb24pO1xuXHRcdGlmIChvbl9kZXN0cm95KSB7XG5cdFx0XHRvbl9kZXN0cm95LnB1c2goLi4ubmV3X29uX2Rlc3Ryb3kpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHQvLyBFZGdlIGNhc2UgLSBjb21wb25lbnQgd2FzIGRlc3Ryb3llZCBpbW1lZGlhdGVseSxcblx0XHRcdC8vIG1vc3QgbGlrZWx5IGFzIGEgcmVzdWx0IG9mIGEgYmluZGluZyBpbml0aWFsaXNpbmdcblx0XHRcdHJ1bl9hbGwobmV3X29uX2Rlc3Ryb3kpO1xuXHRcdH1cblx0XHRjb21wb25lbnQuJCQub25fbW91bnQgPSBbXTtcblx0fSk7XG5cblx0YWZ0ZXJfcmVuZGVyLmZvckVhY2goYWRkX3JlbmRlcl9jYWxsYmFjayk7XG59XG5cbmZ1bmN0aW9uIGRlc3Ryb3koY29tcG9uZW50LCBkZXRhY2hpbmcpIHtcblx0aWYgKGNvbXBvbmVudC4kJCkge1xuXHRcdHJ1bl9hbGwoY29tcG9uZW50LiQkLm9uX2Rlc3Ryb3kpO1xuXHRcdGNvbXBvbmVudC4kJC5mcmFnbWVudC5kKGRldGFjaGluZyk7XG5cblx0XHQvLyBUT0RPIG51bGwgb3V0IG90aGVyIHJlZnMsIGluY2x1ZGluZyBjb21wb25lbnQuJCQgKGJ1dCBuZWVkIHRvXG5cdFx0Ly8gcHJlc2VydmUgZmluYWwgc3RhdGU/KVxuXHRcdGNvbXBvbmVudC4kJC5vbl9kZXN0cm95ID0gY29tcG9uZW50LiQkLmZyYWdtZW50ID0gbnVsbDtcblx0XHRjb21wb25lbnQuJCQuY3R4ID0ge307XG5cdH1cbn1cblxuZnVuY3Rpb24gbWFrZV9kaXJ0eShjb21wb25lbnQsIGtleSkge1xuXHRpZiAoIWNvbXBvbmVudC4kJC5kaXJ0eSkge1xuXHRcdGRpcnR5X2NvbXBvbmVudHMucHVzaChjb21wb25lbnQpO1xuXHRcdHNjaGVkdWxlX3VwZGF0ZSgpO1xuXHRcdGNvbXBvbmVudC4kJC5kaXJ0eSA9IHt9O1xuXHR9XG5cdGNvbXBvbmVudC4kJC5kaXJ0eVtrZXldID0gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gaW5pdChjb21wb25lbnQsIG9wdGlvbnMsIGluc3RhbmNlLCBjcmVhdGVfZnJhZ21lbnQsIG5vdF9lcXVhbCQkMSwgcHJvcF9uYW1lcykge1xuXHRjb25zdCBwYXJlbnRfY29tcG9uZW50ID0gY3VycmVudF9jb21wb25lbnQ7XG5cdHNldF9jdXJyZW50X2NvbXBvbmVudChjb21wb25lbnQpO1xuXG5cdGNvbnN0IHByb3BzID0gb3B0aW9ucy5wcm9wcyB8fCB7fTtcblxuXHRjb25zdCAkJCA9IGNvbXBvbmVudC4kJCA9IHtcblx0XHRmcmFnbWVudDogbnVsbCxcblx0XHRjdHg6IG51bGwsXG5cblx0XHQvLyBzdGF0ZVxuXHRcdHByb3BzOiBwcm9wX25hbWVzLFxuXHRcdHVwZGF0ZTogbm9vcCxcblx0XHRub3RfZXF1YWw6IG5vdF9lcXVhbCQkMSxcblx0XHRib3VuZDogYmxhbmtfb2JqZWN0KCksXG5cblx0XHQvLyBsaWZlY3ljbGVcblx0XHRvbl9tb3VudDogW10sXG5cdFx0b25fZGVzdHJveTogW10sXG5cdFx0YmVmb3JlX3JlbmRlcjogW10sXG5cdFx0YWZ0ZXJfcmVuZGVyOiBbXSxcblx0XHRjb250ZXh0OiBuZXcgTWFwKHBhcmVudF9jb21wb25lbnQgPyBwYXJlbnRfY29tcG9uZW50LiQkLmNvbnRleHQgOiBbXSksXG5cblx0XHQvLyBldmVyeXRoaW5nIGVsc2Vcblx0XHRjYWxsYmFja3M6IGJsYW5rX29iamVjdCgpLFxuXHRcdGRpcnR5OiBudWxsXG5cdH07XG5cblx0bGV0IHJlYWR5ID0gZmFsc2U7XG5cblx0JCQuY3R4ID0gaW5zdGFuY2Vcblx0XHQ/IGluc3RhbmNlKGNvbXBvbmVudCwgcHJvcHMsIChrZXksIHZhbHVlKSA9PiB7XG5cdFx0XHRpZiAoJCQuY3R4ICYmIG5vdF9lcXVhbCQkMSgkJC5jdHhba2V5XSwgJCQuY3R4W2tleV0gPSB2YWx1ZSkpIHtcblx0XHRcdFx0aWYgKCQkLmJvdW5kW2tleV0pICQkLmJvdW5kW2tleV0odmFsdWUpO1xuXHRcdFx0XHRpZiAocmVhZHkpIG1ha2VfZGlydHkoY29tcG9uZW50LCBrZXkpO1xuXHRcdFx0fVxuXHRcdH0pXG5cdFx0OiBwcm9wcztcblxuXHQkJC51cGRhdGUoKTtcblx0cmVhZHkgPSB0cnVlO1xuXHRydW5fYWxsKCQkLmJlZm9yZV9yZW5kZXIpO1xuXHQkJC5mcmFnbWVudCA9IGNyZWF0ZV9mcmFnbWVudCgkJC5jdHgpO1xuXG5cdGlmIChvcHRpb25zLnRhcmdldCkge1xuXHRcdGlmIChvcHRpb25zLmh5ZHJhdGUpIHtcblx0XHRcdCQkLmZyYWdtZW50LmwoY2hpbGRyZW4ob3B0aW9ucy50YXJnZXQpKTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0JCQuZnJhZ21lbnQuYygpO1xuXHRcdH1cblxuXHRcdGlmIChvcHRpb25zLmludHJvICYmIGNvbXBvbmVudC4kJC5mcmFnbWVudC5pKSBjb21wb25lbnQuJCQuZnJhZ21lbnQuaSgpO1xuXHRcdG1vdW50X2NvbXBvbmVudChjb21wb25lbnQsIG9wdGlvbnMudGFyZ2V0LCBvcHRpb25zLmFuY2hvcik7XG5cdFx0Zmx1c2goKTtcblx0fVxuXG5cdHNldF9jdXJyZW50X2NvbXBvbmVudChwYXJlbnRfY29tcG9uZW50KTtcbn1cblxubGV0IFN2ZWx0ZUVsZW1lbnQ7XG5pZiAodHlwZW9mIEhUTUxFbGVtZW50ICE9PSAndW5kZWZpbmVkJykge1xuXHRTdmVsdGVFbGVtZW50ID0gY2xhc3MgZXh0ZW5kcyBIVE1MRWxlbWVudCB7XG5cdFx0Y29uc3RydWN0b3IoKSB7XG5cdFx0XHRzdXBlcigpO1xuXHRcdFx0dGhpcy5hdHRhY2hTaGFkb3coeyBtb2RlOiAnb3BlbicgfSk7XG5cdFx0fVxuXG5cdFx0Y29ubmVjdGVkQ2FsbGJhY2soKSB7XG5cdFx0XHRmb3IgKGNvbnN0IGtleSBpbiB0aGlzLiQkLnNsb3R0ZWQpIHtcblx0XHRcdFx0dGhpcy5hcHBlbmRDaGlsZCh0aGlzLiQkLnNsb3R0ZWRba2V5XSk7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0YXR0cmlidXRlQ2hhbmdlZENhbGxiYWNrKGF0dHIkJDEsIG9sZFZhbHVlLCBuZXdWYWx1ZSkge1xuXHRcdFx0dGhpc1thdHRyJCQxXSA9IG5ld1ZhbHVlO1xuXHRcdH1cblxuXHRcdCRkZXN0cm95KCkge1xuXHRcdFx0ZGVzdHJveSh0aGlzLCB0cnVlKTtcblx0XHRcdHRoaXMuJGRlc3Ryb3kgPSBub29wO1xuXHRcdH1cblxuXHRcdCRvbih0eXBlLCBjYWxsYmFjaykge1xuXHRcdFx0Ly8gVE9ETyBzaG91bGQgdGhpcyBkZWxlZ2F0ZSB0byBhZGRFdmVudExpc3RlbmVyP1xuXHRcdFx0Y29uc3QgY2FsbGJhY2tzID0gKHRoaXMuJCQuY2FsbGJhY2tzW3R5cGVdIHx8ICh0aGlzLiQkLmNhbGxiYWNrc1t0eXBlXSA9IFtdKSk7XG5cdFx0XHRjYWxsYmFja3MucHVzaChjYWxsYmFjayk7XG5cblx0XHRcdHJldHVybiAoKSA9PiB7XG5cdFx0XHRcdGNvbnN0IGluZGV4ID0gY2FsbGJhY2tzLmluZGV4T2YoY2FsbGJhY2spO1xuXHRcdFx0XHRpZiAoaW5kZXggIT09IC0xKSBjYWxsYmFja3Muc3BsaWNlKGluZGV4LCAxKTtcblx0XHRcdH07XG5cdFx0fVxuXG5cdFx0JHNldCgpIHtcblx0XHRcdC8vIG92ZXJyaWRkZW4gYnkgaW5zdGFuY2UsIGlmIGl0IGhhcyBwcm9wc1xuXHRcdH1cblx0fTtcbn1cblxuY2xhc3MgU3ZlbHRlQ29tcG9uZW50IHtcblx0JGRlc3Ryb3koKSB7XG5cdFx0ZGVzdHJveSh0aGlzLCB0cnVlKTtcblx0XHR0aGlzLiRkZXN0cm95ID0gbm9vcDtcblx0fVxuXG5cdCRvbih0eXBlLCBjYWxsYmFjaykge1xuXHRcdGNvbnN0IGNhbGxiYWNrcyA9ICh0aGlzLiQkLmNhbGxiYWNrc1t0eXBlXSB8fCAodGhpcy4kJC5jYWxsYmFja3NbdHlwZV0gPSBbXSkpO1xuXHRcdGNhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKTtcblxuXHRcdHJldHVybiAoKSA9PiB7XG5cdFx0XHRjb25zdCBpbmRleCA9IGNhbGxiYWNrcy5pbmRleE9mKGNhbGxiYWNrKTtcblx0XHRcdGlmIChpbmRleCAhPT0gLTEpIGNhbGxiYWNrcy5zcGxpY2UoaW5kZXgsIDEpO1xuXHRcdH07XG5cdH1cblxuXHQkc2V0KCkge1xuXHRcdC8vIG92ZXJyaWRkZW4gYnkgaW5zdGFuY2UsIGlmIGl0IGhhcyBwcm9wc1xuXHR9XG59XG5cbmNsYXNzIFN2ZWx0ZUNvbXBvbmVudERldiBleHRlbmRzIFN2ZWx0ZUNvbXBvbmVudCB7XG5cdGNvbnN0cnVjdG9yKG9wdGlvbnMpIHtcblx0XHRpZiAoIW9wdGlvbnMgfHwgKCFvcHRpb25zLnRhcmdldCAmJiAhb3B0aW9ucy4kJGlubGluZSkpIHtcblx0XHRcdHRocm93IG5ldyBFcnJvcihgJ3RhcmdldCcgaXMgYSByZXF1aXJlZCBvcHRpb25gKTtcblx0XHR9XG5cblx0XHRzdXBlcigpO1xuXHR9XG5cblx0JGRlc3Ryb3koKSB7XG5cdFx0c3VwZXIuJGRlc3Ryb3koKTtcblx0XHR0aGlzLiRkZXN0cm95ID0gKCkgPT4ge1xuXHRcdFx0Y29uc29sZS53YXJuKGBDb21wb25lbnQgd2FzIGFscmVhZHkgZGVzdHJveWVkYCk7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tY29uc29sZVxuXHRcdH07XG5cdH1cbn1cblxuZXhwb3J0IHsgY3JlYXRlX2FuaW1hdGlvbiwgZml4X3Bvc2l0aW9uLCBoYW5kbGVfcHJvbWlzZSwgYXBwZW5kLCBpbnNlcnQsIGRldGFjaCwgZGV0YWNoX2JldHdlZW4sIGRldGFjaF9iZWZvcmUsIGRldGFjaF9hZnRlciwgZGVzdHJveV9lYWNoLCBlbGVtZW50LCBzdmdfZWxlbWVudCwgdGV4dCwgc3BhY2UsIGVtcHR5LCBsaXN0ZW4sIHByZXZlbnRfZGVmYXVsdCwgc3RvcF9wcm9wYWdhdGlvbiwgYXR0ciwgc2V0X2F0dHJpYnV0ZXMsIHNldF9jdXN0b21fZWxlbWVudF9kYXRhLCB4bGlua19hdHRyLCBnZXRfYmluZGluZ19ncm91cF92YWx1ZSwgdG9fbnVtYmVyLCB0aW1lX3Jhbmdlc190b19hcnJheSwgY2hpbGRyZW4sIGNsYWltX2VsZW1lbnQsIGNsYWltX3RleHQsIHNldF9kYXRhLCBzZXRfaW5wdXRfdHlwZSwgc2V0X3N0eWxlLCBzZWxlY3Rfb3B0aW9uLCBzZWxlY3Rfb3B0aW9ucywgc2VsZWN0X3ZhbHVlLCBzZWxlY3RfbXVsdGlwbGVfdmFsdWUsIGFkZF9yZXNpemVfbGlzdGVuZXIsIHRvZ2dsZV9jbGFzcywgY3VzdG9tX2V2ZW50LCBkZXN0cm95X2Jsb2NrLCBvdXRyb19hbmRfZGVzdHJveV9ibG9jaywgZml4X2FuZF9vdXRyb19hbmRfZGVzdHJveV9ibG9jaywgdXBkYXRlX2tleWVkX2VhY2gsIG1lYXN1cmUsIGN1cnJlbnRfY29tcG9uZW50LCBzZXRfY3VycmVudF9jb21wb25lbnQsIGJlZm9yZVVwZGF0ZSwgb25Nb3VudCwgYWZ0ZXJVcGRhdGUsIG9uRGVzdHJveSwgY3JlYXRlRXZlbnREaXNwYXRjaGVyLCBzZXRDb250ZXh0LCBnZXRDb250ZXh0LCBidWJibGUsIGNsZWFyX2xvb3BzLCBsb29wLCBkaXJ0eV9jb21wb25lbnRzLCBpbnRyb3MsIHNjaGVkdWxlX3VwZGF0ZSwgdGljaywgYWRkX2JpbmRpbmdfY2FsbGJhY2ssIGFkZF9yZW5kZXJfY2FsbGJhY2ssIGFkZF9mbHVzaF9jYWxsYmFjaywgZmx1c2gsIGdldF9zcHJlYWRfdXBkYXRlLCBpbnZhbGlkX2F0dHJpYnV0ZV9uYW1lX2NoYXJhY3Rlciwgc3ByZWFkLCBlc2NhcGVkLCBlc2NhcGUsIGVhY2gsIG1pc3NpbmdfY29tcG9uZW50LCB2YWxpZGF0ZV9jb21wb25lbnQsIGRlYnVnLCBjcmVhdGVfc3NyX2NvbXBvbmVudCwgZ2V0X3N0b3JlX3ZhbHVlLCBncm91cF9vdXRyb3MsIGNoZWNrX291dHJvcywgb25fb3V0cm8sIGNyZWF0ZV9pbl90cmFuc2l0aW9uLCBjcmVhdGVfb3V0X3RyYW5zaXRpb24sIGNyZWF0ZV9iaWRpcmVjdGlvbmFsX3RyYW5zaXRpb24sIG5vb3AsIGlkZW50aXR5LCBhc3NpZ24sIGlzX3Byb21pc2UsIGFkZF9sb2NhdGlvbiwgcnVuLCBibGFua19vYmplY3QsIHJ1bl9hbGwsIGlzX2Z1bmN0aW9uLCBzYWZlX25vdF9lcXVhbCwgbm90X2VxdWFsLCB2YWxpZGF0ZV9zdG9yZSwgc3Vic2NyaWJlLCBjcmVhdGVfc2xvdCwgZ2V0X3Nsb3RfY29udGV4dCwgZ2V0X3Nsb3RfY2hhbmdlcywgZXhjbHVkZV9pbnRlcm5hbF9wcm9wcywgYmluZCwgbW91bnRfY29tcG9uZW50LCBpbml0LCBTdmVsdGVFbGVtZW50LCBTdmVsdGVDb21wb25lbnQsIFN2ZWx0ZUNvbXBvbmVudERldiB9O1xuIiwiPHNjcmlwdD5cclxuICBleHBvcnQgbGV0IGNhcmQgPSB7fTtcclxuXHJcbiAgY29uc3QgQ0FSRF9SQVRJTyA9IDAuNzE3NjQ3MDU4ODI7XHJcbiAgbGV0IF9oZWlnaHQgPSAyNTA7XHJcbiAgbGV0IF93aWR0aCA9IE1hdGguZmxvb3IoX2hlaWdodCAqIENBUkRfUkFUSU8pO1xyXG4gIGxldCBoZWlnaHQgPSBfaGVpZ2h0O1xyXG4gIGxldCB3aWR0aCA9IF93aWR0aDtcclxuPC9zY3JpcHQ+XHJcblxyXG48c3R5bGU+XHJcbiAgLmVudHJ5IHtcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICAgIHBhZGRpbmc6IDEwcHg7XHJcbiAgICBmbGV4LXNocmluazogMDtcclxuICB9XHJcblxyXG4gIC5jYXJkIHtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIGJvcmRlcjogNnB4IHNvbGlkIHJnYigyMiwgMjIsIDIyKTtcclxuICAgIGJvcmRlci1yYWRpdXM6IDEwcHg7XHJcbiAgICBvdXRsaW5lOiAwO1xyXG4gICAgYm94LXNoYWRvdzogMHB4IDBweCAxMHB4IGJsYWNrO1xyXG4gIH1cclxuPC9zdHlsZT5cclxuXHJcbjxkaXYgY2xhc3M9XCJlbnRyeVwiIHN0eWxlPXsnd2lkdGg6JyArIHdpZHRoICsgJ3B4OyBoZWlnaHQ6JyArIGhlaWdodCArICdweDsnfT5cclxuXHJcbiAgPGltZ1xyXG4gICAgY2xhc3M9XCJjYXJkXCJcclxuICAgIHN0eWxlPXsnbWFyZ2luLXRvcDogMHB4J31cclxuICAgIHNyYz17Y2FyZC51cmx9XHJcbiAgICBhbHQ9e2NhcmQubmFtZX1cclxuICAgIHt3aWR0aH1cclxuICAgIHtoZWlnaHR9IC8+XHJcblxyXG48L2Rpdj5cclxuIiwiPHNjcmlwdD5cclxuICBpbXBvcnQgQ2FyZCBmcm9tIFwiLi9jYXJkLnN2ZWx0ZVwiO1xyXG5cclxuICBleHBvcnQgbGV0IHByb21pc2U7XHJcbiAgZXhwb3J0IGxldCBwbGF5VGVzdGVyQWN0aXZlO1xyXG4gIGZ1bmN0aW9uIHRvZ2dsZVBsYXlUZXN0KCkge1xyXG4gICAgcGxheVRlc3RlckFjdGl2ZSA9IGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gc2FtcGxlSGFuZCgpIHtcclxuICAgIHByb21pc2UgPSBwcm9taXNlO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gc2h1ZmZsZShhKSB7XHJcbiAgICB2YXIgaiwgeCwgaTtcclxuICAgIGZvciAoaSA9IGEubGVuZ3RoIC0gMTsgaSA+IDA7IGktLSkge1xyXG4gICAgICBqID0gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogKGkgKyAxKSk7XHJcbiAgICAgIHggPSBhW2ldO1xyXG4gICAgICBhW2ldID0gYVtqXTtcclxuICAgICAgYVtqXSA9IHg7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gYTtcclxuICB9XHJcblxyXG4gIGFzeW5jIGZ1bmN0aW9uIGNvbWJpbmUoZ3JvdXBzKSB7XHJcbiAgICBsZXQgcmVzdWx0ID0gW107XHJcblxyXG4gICAgZm9yIChsZXQgZ3JvdXAgb2YgZ3JvdXBzKSB7XHJcbiAgICAgIGlmIChncm91cC5uYW1lLmluY2x1ZGVzKFwibWF5YmVcIikpIGNvbnRpbnVlO1xyXG4gICAgICBpZiAoZ3JvdXAubmFtZS5pbmNsdWRlcyhcImNvbW1hbmRlclwiKSkgY29udGludWU7XHJcblxyXG4gICAgICBmb3IgKGxldCBjYXJkIG9mIGdyb3VwLmNhcmRzKSB7XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjYXJkLmNvdW50OyBpKyspIHtcclxuICAgICAgICAgIHJlc3VsdC5wdXNoKGNhcmQpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJlc3VsdCA9IHNodWZmbGUocmVzdWx0KTsgLy8uc3BsaWNlKDAsIDE1KTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIGhhbmQ6IHJlc3VsdC5zcGxpY2UoMCwgNyksXHJcbiAgICAgIGRyYXdzOiByZXN1bHQuc3BsaWNlKDAsIDcpXHJcbiAgICB9O1xyXG4gIH1cclxuPC9zY3JpcHQ+XHJcblxyXG48c3R5bGU+XHJcbiAgLmFsbCB7XHJcbiAgICBtYXJnaW46IDIwcHg7XHJcbiAgfVxyXG4gIC5uZXh0LWRyYXdzIHtcclxuICAgIG1hcmdpbi10b3A6IDIwcHg7XHJcbiAgICBmb250LXNpemU6IDI1cHg7XHJcbiAgfVxyXG4gIC5ncm91cC1jb250ZW50IHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LXdyYXA6IHdyYXA7XHJcbiAgICB0cmFuc2l0aW9uOiBoZWlnaHQgNTAwbXMgZWFzZTtcclxuICB9XHJcblxyXG4gIGJ1dHRvbiB7XHJcbiAgICBmbGV4LXNocmluazogMDtcclxuICB9XHJcbjwvc3R5bGU+XHJcblxyXG48YnV0dG9uIG9uOmNsaWNrPXt0b2dnbGVQbGF5VGVzdH0+aGlkZTwvYnV0dG9uPlxyXG5cclxueyNhd2FpdCBwcm9taXNlfVxyXG4gIDxkaXYgY2xhc3M9XCJsb2FkaW5nLXdyYXBwZXJcIj5kZWNrIGlzIGxvYWRpbmc8L2Rpdj5cclxuezp0aGVuIGdyb3Vwc31cclxuXHJcbiAgeyNhd2FpdCBjb21iaW5lKGdyb3Vwcyl9XHJcbiAgICA8ZGl2IGNsYXNzPVwibG9hZGluZy13cmFwcGVyXCI+ZGVjayBpcyBsb2FkaW5nPC9kaXY+XHJcbiAgezp0aGVuIHBsYXl9XHJcbiAgICA8ZGl2IGNsYXNzPVwibmV4dC1kcmF3c1wiPkhhbmQ6PC9kaXY+XHJcbiAgICA8ZGl2IGNsYXNzPVwiYWxsXCI+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJncm91cC1jb250ZW50XCI+XHJcbiAgICAgICAgeyNlYWNoIHBsYXkuaGFuZCBhcyBjYXJkfVxyXG4gICAgICAgICAgPENhcmQge2NhcmR9IC8+XHJcbiAgICAgICAgey9lYWNofVxyXG4gICAgICA8L2Rpdj5cclxuXHJcbiAgICAgIDxkaXYgY2xhc3M9XCJuZXh0LWRyYXdzXCI+bmV4dCBkcmF3czo8L2Rpdj5cclxuXHJcbiAgICAgIDxkaXYgY2xhc3M9XCJncm91cC1jb250ZW50XCI+XHJcbiAgICAgICAgeyNlYWNoIHBsYXkuZHJhd3MgYXMgY2FyZH1cclxuICAgICAgICAgIDxDYXJkIHtjYXJkfSAvPlxyXG4gICAgICAgIHsvZWFjaH1cclxuICAgICAgPC9kaXY+XHJcbiAgICA8L2Rpdj5cclxuICAgIDxidXR0b24gb246Y2xpY2s9e3NhbXBsZUhhbmR9Pm5ldyBzYW1wbGUgaGFuZDwvYnV0dG9uPlxyXG5cclxuICB7L2F3YWl0fVxyXG5cclxuezpjYXRjaCBlcnJvcn1cclxuXHJcbiAgPGRpdiBjbGFzcz1cImVycm9yXCI+XHJcbiAgICBFUlJPUiwgY2hlY2sgeW91ciBkZWNrbGlzdCBmb3IgY29ycmVjdCBmb3JtYXQgb3IgaW50ZXJuZXQgY29ubmVjdGlvbiBicnVkaVxyXG4gIDwvZGl2PlxyXG57L2F3YWl0fVxyXG4iLCIvLyBwYXRoIHRvIHdoZXJlIHRoZSBpbWFnZXMgYXJlIGRvd25sb2FkZWRcclxuLy9jb25zdCBDQVJEX0RBVEEgPSByZXF1aXJlKFwiLi9zY3J5ZmFsbC1kZWZhdWx0LWNhcmRzLmpzb25cIik7XHJcblxyXG5cclxuLy9jb25zdCBmcyA9IHJlcXVpcmUoXCJmc1wiKTtcclxuXHJcbmNvbnN0IE9iamVjdElkID0gKCkgPT4geyByZXR1cm4gRGF0ZS5ub3coKSB9OyAvLyByZXF1aXJlKFwiYnNvbi1vYmplY3RpZFwiKTtcclxuXHJcblxyXG5jb25zdCBURU1QID0gXCJ0ZW1wXCI7XHJcbmNvbnN0IF9fZGlybmFtZSA9IFwiLi9cIjtcclxuXHJcbmZ1bmN0aW9uIHRpbWVvdXQoKSB7XHJcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICByZXNvbHZlKCk7XHJcbiAgICB9LCA3MCk7XHJcbiAgfSk7XHJcbn1cclxuXHJcbi8qXHJcblxyXG4qL1xyXG5cclxuXHJcbmNsYXNzIE10Z0ludGVyZmFjZSB7XHJcblxyXG4gIGNvbnN0cnVjdG9yKGlwY1JlbmRlcmVyKSB7XHJcbiAgICB0aGlzLl9fY2FjaGUgPSB7fTtcclxuICAgIHRoaXMuaXBjUmVuZGVyZXIgPSBpcGNSZW5kZXJlcjtcclxuICAgIHRoaXMuZG93bmxvYWRzID0gUHJvbWlzZS5yZXNvbHZlKCk7XHJcbiAgICB0aGlzLmZldGNoZXMgPSBQcm9taXNlLnJlc29sdmUoKTtcclxuXHJcblxyXG4gICAgdGhpcy5sb2FkUHJvbXMgPSB7fTtcclxuICAgIHRoaXMuZXhpc3RQcm9tcyA9IHt9O1xyXG5cclxuICAgIGlwY1JlbmRlcmVyLm9uKFwiZmlsZUxvYWRlZFwiLCAoc2VuZGVyLCBkYXRhKSA9PiB7XHJcbiAgICAgIGNvbnN0IGMgPSB0aGlzLmxvYWRQcm9tc1tkYXRhLmlkXTtcclxuICAgICAgaWYgKCFjKSByZXR1cm47XHJcbiAgICAgIGlmIChkYXRhLmVycm9yKSBjLnJlamVjdChkYXRhLmVycm9yKTtcclxuICAgICAgZWxzZSBjLnJlc29sdmUoSlNPTi5wYXJzZShkYXRhLnJlc3VsdCB8fCBcInt9XCIpKVxyXG4gICAgICBkZWxldGUgdGhpcy5sb2FkUHJvbXNbZGF0YS5pZF07XHJcbiAgICB9KTtcclxuXHJcbiAgICBpcGNSZW5kZXJlci5vbihcImZpbGVDaGVja2VkXCIsIChzZW5kZXIsIGRhdGEpID0+IHtcclxuICAgICAgY29uc3QgYyA9IHRoaXMuZXhpc3RQcm9tc1tkYXRhLmlkXTtcclxuICAgICAgaWYgKCFjKSByZXR1cm47XHJcbiAgICAgIGlmIChkYXRhLmVycm9yKSBjLnJlc29sdmUoZmFsc2UpOyAvL2MucmVqZWN0KGRhdGEuZXJyb3IpO1xyXG4gICAgICBlbHNlIGMucmVzb2x2ZSh0cnVlKVxyXG4gICAgICBkZWxldGUgdGhpcy5leGlzdFByb21zW2RhdGEuaWRdO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuXHJcbiAgZG9lc0ZpbGVFeGlzdChwYXRoKSB7XHJcbiAgICBjb25zdCBpZCA9IE9iamVjdElkKCkudG9TdHJpbmcoKTtcclxuICAgIGNvbnN0IHAgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcblxyXG4gICAgICB0aGlzLmlwY1JlbmRlcmVyLnNlbmQoXCJjaGVja0ZpbGVcIiwgeyBwYXRoLCBpZCB9KTtcclxuICAgICAgdGhpcy5leGlzdFByb21zW2lkXSA9IHsgcmVzb2x2ZSwgcmVqZWN0IH07XHJcbiAgICB9KTtcclxuICAgIHJldHVybiBwO1xyXG4gIH1cclxuXHJcbiAgc2F2ZUZpbGUocGF0aCwgY29udGVudCkge1xyXG4gICAgY29uc3QgaWQgPSBPYmplY3RJZCgpLnRvU3RyaW5nKCk7XHJcbiAgICBjb250ZW50ID0gSlNPTi5zdHJpbmdpZnkoY29udGVudCk7XHJcbiAgICB0aGlzLmlwY1JlbmRlcmVyLnNlbmQoXCJzYXZlRmlsZVwiLCB7IHBhdGgsIGNvbnRlbnQsIGlkIH0pO1xyXG5cclxuICAgIC8qICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICAgIGZzLndyaXRlRmlsZShmaWxlLCBjb250ZW50LCBmdW5jdGlvbihlcnIpIHtcclxuICAgICAgICAgIGlmIChlcnIpIHJldHVybiByZWplY3QoZXJyKTtcclxuICAgICAgICAgIHJlc29sdmUoKTtcclxuICAgICAgICB9KTtcclxuICAgICAgfSk7Ki9cclxuICB9XHJcblxyXG4gIGxvYWRGaWxlKHBhdGgpIHtcclxuICAgIGNvbnN0IGlkID0gT2JqZWN0SWQoKS50b1N0cmluZygpO1xyXG4gICAgY29uc3QgcCA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgdGhpcy5pcGNSZW5kZXJlci5zZW5kKFwibG9hZEZpbGVcIiwgeyBwYXRoLCBpZCB9KTtcclxuICAgICAgdGhpcy5sb2FkUHJvbXNbaWRdID0geyByZXNvbHZlLCByZWplY3QgfTtcclxuICAgIH0pO1xyXG4gICAgcmV0dXJuIHA7XHJcbiAgfVxyXG5cclxuXHJcbiAgc2VhcmNoKG9wdHMgPSB7fSkge1xyXG4gICAgLy8gaHR0cHM6Ly9hcGkuc2NyeWZhbGwuY29tL2NhcmRzL3NlYXJjaD9vcmRlcj1jbWMmcT1jJTNBcmVkK3BvdyUzRDMgXHJcbiAgICAvLyBodHRwczovL3NjcnlmYWxsLmNvbS9zZWFyY2g/YXM9Z3JpZCZvcmRlcj1uYW1lJnE9bXlyK29yYWNsZSUzQXRva2VuK3R5cGUlM0FjcmVhdHVyZStjb21tYW5kZXIlM0FXVUJSR1xyXG5cclxuICAgIGxldCBiYXNldXJsO1xyXG5cclxuICAgIGlmICh0eXBlb2Ygb3B0cyAhPSBcInN0cmluZ1wiKSB7XHJcbiAgICAgIGJhc2V1cmwgPSBgaHR0cHM6Ly9hcGkuc2NyeWZhbGwuY29tL2NhcmRzL3NlYXJjaD8ke29wdHMucGFnZT9cInBhZ2U9XCIrb3B0cy5wYWdlK1wiJlwiOlwiXCJ9b3JkZXI9Y21jJnE9YDtcclxuICAgICAgY29uc3QgcXVlcmllcyA9IFtdO1xyXG5cclxuICAgICAgaWYgKG9wdHMubmFtZSkge1xyXG4gICAgICAgIHF1ZXJpZXMucHVzaChvcHRzLm5hbWUpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAob3B0cy5lZGhjb2xvcnMgJiYgb3B0cy5lZGhjb2xvcnMuc2l6ZSkge1xyXG4gICAgICAgIGxldCBjcyA9IFwiXCI7XHJcbiAgICAgICAgZm9yIChsZXQgY29sb3Igb2Ygb3B0cy5lZGhjb2xvcnMpIHtcclxuICAgICAgICAgIGNvbG9yID0gY29sb3IudG9VcHBlckNhc2UoKTtcclxuICAgICAgICAgIGlmIChjb2xvciA9PT0gXCJDXCIpIHtcclxuICAgICAgICAgICAgY3MgPSBcIkNcIjtcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBjcyArPSBjb2xvcjtcclxuICAgICAgICB9XHJcbiAgICAgICAgcXVlcmllcy5wdXNoKFwiY29tbWFuZGVyJTNBXCIgKyBjcyk7XHJcbiAgICAgIH1cclxuXHJcblxyXG4gICAgICBpZiAob3B0cy50eXBlKSB7XHJcbiAgICAgICAgbGV0IHR5cGUgPSBvcHRzLnR5cGUudHJpbSgpLnJlcGxhY2UoL1xcc1xccysvZ20sIFwiIFwiKS5yZXBsYWNlKC9cXHMvZ20sIFwiK3R5cGUlM0FcIik7XHJcbiAgICAgICAgcXVlcmllcy5wdXNoKFwidHlwZSUzQVwiICsgdHlwZSk7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKG9wdHMudGV4dCkge1xyXG4gICAgICAgIGxldCB0ZXh0ID0gb3B0cy50ZXh0LnRyaW0oKS5yZXBsYWNlKC9cXHNcXHMrL2dtLCBcIiBcIikucmVwbGFjZSgvXFxzKy9nbSwgXCIrb3JhY2xlJTNBXCIpO1xyXG4gICAgICAgIHF1ZXJpZXMucHVzaChcIm9yYWNsZSUzQVwiICsgdGV4dCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGJhc2V1cmwgPSBiYXNldXJsICsgcXVlcmllcy5qb2luKFwiK1wiKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGJhc2V1cmwgPSBvcHRzO1xyXG4gICAgfVxyXG4gICAgY29uc29sZS5sb2coXCJzZWFyY2hxdWVyeVwiLCBiYXNldXJsKTtcclxuICAgIHJldHVybiBmZXRjaChiYXNldXJsKVxyXG4gICAgICAudGhlbihhc3luYyByZXNwb25zZSA9PiB7XHJcbiAgICAgICAgY29uc3QgYSA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKTtcclxuICAgICAgICByZXR1cm4gYTtcclxuICAgICAgfSlcclxuICAgICAgLnRoZW4ocmVzcG9uc2UgPT4ge1xyXG4gICAgICAgIGZvciAobGV0IGMgb2YgcmVzcG9uc2UuZGF0YSkge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coXCJjXCIsIGMpO1xyXG4gICAgICAgICAgaWYgKCFjLmltYWdlX3VyaXMpIHtcclxuICAgICAgICAgICAgaWYgKGMuY2FyZF9mYWNlcykge1xyXG4gICAgICAgICAgICAgIGMuaW1hZ2VfdXJpcyA9IGMuY2FyZF9mYWNlc1swXS5pbWFnZV91cmlzO1xyXG4gICAgICAgICAgICAgIGNvbnN0IGJpdSA9IGMuY2FyZF9mYWNlc1sxXS5pbWFnZV91cmlzO1xyXG4gICAgICAgICAgICAgIGMuYmFja3NpZGUgPSBiaXUgPyBiaXUuYm9yZGVyX2Nyb3AgfHwgYml1Lm5vcm1hbCA6IFwiXCI7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGMudXJsID0gYyA/IGMuaW1hZ2VfdXJpcy5ib3JkZXJfY3JvcCB8fCBjLmltYWdlX3VyaXMubm9ybWFsIDogXCJcIjtcclxuICAgICAgICAgIGMuY2FyZG1hcmtldCA9IChjLnB1cmNoYXNlX3VyaXMgfHwge30pLmNhcmRtYXJrZXQgfHwgXCJcIjtcclxuICAgICAgICAgIHRoaXMuX19jYWNoZVtjLm5hbWVdID0gYztcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHJlc3BvbnNlO1xyXG4gICAgICB9KVxyXG4gICAgICAuY2F0Y2goZSA9PiB7IGNvbnNvbGUubG9nKGUpOyByZXR1cm4geyBjb2RlOiBcIm5vdF9mb3VuZFwiLCBkYXRhOiBbXSB9OyB9KTtcclxuXHJcbiAgfVxyXG5cclxuICBhc3luYyBjYXJkQnlOYW1lKG5hbWUpIHtcclxuICAgIGlmICh0aGlzLl9fY2FjaGVbbmFtZV0pIHJldHVybiB0aGlzLl9fY2FjaGVbbmFtZV07XHJcblxyXG4gICAgY29uc3QgcCA9IG5hbWU7IC8vcGF0aC5qb2luKF9fZGlybmFtZSwgVEVNUCwgbmFtZSk7XHJcbiAgICBjb25zdCBleGlzdHMgPSBhd2FpdCB0aGlzLmRvZXNGaWxlRXhpc3QocCk7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgaWYgKGV4aXN0cykge1xyXG4gICAgICAgIHRoaXMuX19jYWNoZVtuYW1lXSA9IGF3YWl0IHRoaXMubG9hZEZpbGUocCk7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX19jYWNoZVtuYW1lXTtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKFwiY291bGQgbm90IGxvYWQgbG9jYWwgZmlsZVwiLCBuYW1lLCBlLm1lc3NhZ2UpO1xyXG4gICAgfVxyXG5cclxuXHJcbiAgICBhd2FpdCB0aW1lb3V0KCk7XHJcbiAgICAvL2h0dHBzOi8vYXBpLnNjcnlmYWxsLmNvbS9jYXJkcy9uYW1lZD9mdXp6eT1hdXN0K2NvbSBcclxuICAgIGNvbnN0IGZpeGVkID0gbmFtZS5yZXBsYWNlKC9cXHMvZywgXCIrXCIpO1xyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZmV0Y2goJ2h0dHBzOi8vYXBpLnNjcnlmYWxsLmNvbS9jYXJkcy9uYW1lZD9mdXp6eT0nICsgZml4ZWQpXHJcbiAgICAgIC50aGVuKHJlc3BvbnNlID0+IHJlc3BvbnNlLmpzb24oKSkuY2F0Y2goZSA9PiB7IGNvbnNvbGUubG9nKGUpOyByZXR1cm4geyBjb2RlOiBcIm5vdF9mb3VuZFwiIH07IH0pO1xyXG5cclxuICAgIHRoaXMuX19jYWNoZVtuYW1lXSA9IHJlc3VsdDtcclxuICAgIHRoaXMuX19jYWNoZVtyZXN1bHQubmFtZV0gPSByZXN1bHQ7XHJcbiAgICB0aGlzLnNhdmVGaWxlKG5hbWUsIHRoaXMuX19jYWNoZVtuYW1lXSk7XHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgLy8gLnRoZW4oZGF0YSA9PiBjb25zb2xlLmxvZyhkYXRhKSk7XHJcbiAgICAvKiBmb3IgKGxldCBjYXJkIG9mIENBUkRfREFUQSkge1xyXG4gICAgICAgaWYgKGNhcmQubmFtZS50b0xvd2VyQ2FzZSgpID09IG5hbWUudG9Mb3dlckNhc2UoKSkgcmV0dXJuIGNhcmQ7XHJcbiAgICAgfSovXHJcbiAgfVxyXG5cclxuICBhc3luYyBzb3J0KGRlY2tTdHJpbmcsIHVwZGF0ZSA9ICgpID0+IHt9KSB7XHJcbiAgICBkZWNrU3RyaW5nID0gZGVja1N0cmluZy5yZXBsYWNlKC8jLiovZ20sIFwiXCIpO1xyXG4gICAgY29uc3QgZGVja1JhdyA9IGRlY2tTdHJpbmcudHJpbSgpLnJlcGxhY2UoL1xcKCguKj8pXFwpfChbMC05XSpcXG4pL2csIFwiXFxuXCIpLnJlcGxhY2UoL1xccypcXG4rXFxzKlxcbisvZywgXCJcXG5cIikuc3BsaXQoXCJcXG5cIik7XHJcblxyXG4gICAgbGV0IGNyZWF0dXJlcyA9IHt9O1xyXG4gICAgbGV0IHNwZWxscyA9IHt9O1xyXG4gICAgbGV0IGxhbmRzID0ge307XHJcblxyXG5cclxuXHJcbiAgICBsZXQgbWF5YmUgPSBbXTtcclxuICAgIGNvbnN0IGVycm9ycyA9IFtdO1xyXG5cclxuXHJcbiAgICBsZXQgcHJvZ3Jlc3MgPSAwO1xyXG4gICAgZm9yIChsZXQgY2FyZCBvZiBkZWNrUmF3KSB7XHJcblxyXG4gICAgICBsZXQgY291bnQgPSBNYXRoLmZsb29yKCgoY2FyZC5tYXRjaCgvKFxcZCspLykgfHwgW10pWzBdIHx8IDEpKTtcclxuICAgICAgaWYgKGlzTmFOKGNvdW50KSkge1xyXG4gICAgICAgIGNvdW50ID0gMTtcclxuICAgICAgfVxyXG4gICAgICBwcm9ncmVzcysrO1xyXG5cclxuICAgICAgaWYgKGNhcmQudHJpbSgpLnN0YXJ0c1dpdGgoXCIvL1wiKSkge1xyXG4gICAgICAgIG1heWJlLnB1c2goY2FyZC50cmltKCkpO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgbmFtZSA9IGNhcmQucmVwbGFjZSgvKFxcZCspLywgXCJcIikudHJpbSgpO1xyXG4gICAgICBpZiAoIW5hbWUpIGNvbnRpbnVlOyAvLyBjYW50IHdvcmsgd2l0aCB0aGlzIGRhdGFcclxuICAgICAgLy8gc2VhcmNoIHRoZSBhY2NvcmRpbmcgZGF0YVxyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGxldCBkYXRhID0gYXdhaXQgdGhpcy5jYXJkQnlOYW1lKG5hbWUpO1xyXG5cclxuICAgICAgICBpZiAoZGF0YS50eXBlX2xpbmUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhcImxhbmRcIikpIHtcclxuICAgICAgICAgIGxhbmRzW2RhdGEubmFtZV0gPSBsYW5kc1tkYXRhLm5hbWVdIHx8IHsgZGF0YSwgY291bnQ6IDAsIG5hbWU6IGRhdGEubmFtZSB9O1xyXG4gICAgICAgICAgbGFuZHNbZGF0YS5uYW1lXS5jb3VudCsrO1xyXG4gICAgICAgIH0gZWxzZSBpZiAoZGF0YS50eXBlX2xpbmUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhcImNyZWF0dXJlXCIpKSB7XHJcbiAgICAgICAgICBjcmVhdHVyZXNbZGF0YS5uYW1lXSA9IGNyZWF0dXJlc1tkYXRhLm5hbWVdIHx8IHsgZGF0YSwgY291bnQ6IDAsIG5hbWU6IGRhdGEubmFtZSB9O1xyXG4gICAgICAgICAgY3JlYXR1cmVzW2RhdGEubmFtZV0uY291bnQrKztcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgc3BlbGxzW2RhdGEubmFtZV0gPSBzcGVsbHNbZGF0YS5uYW1lXSB8fCB7IGRhdGEsIGNvdW50OiAwLCBuYW1lOiBkYXRhLm5hbWUgfTtcclxuICAgICAgICAgIHNwZWxsc1tkYXRhLm5hbWVdLmNvdW50Kys7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGVycm9ycy5wdXNoKG5hbWUpO1xyXG4gICAgICB9XHJcbiAgICAgIHVwZGF0ZShwcm9ncmVzcywgZGVja1Jhdy5sZW5ndGgpO1xyXG4gICAgfVxyXG5cclxuICAgIGNyZWF0dXJlcyA9IE9iamVjdC52YWx1ZXMoY3JlYXR1cmVzKS5zb3J0KChhLCBiKSA9PiBhLmRhdGEuY21jID4gYi5kYXRhLmNtYyA/IDEgOiAtMSk7XHJcbiAgICBzcGVsbHMgPSBPYmplY3QudmFsdWVzKHNwZWxscykuc29ydCgoYSwgYikgPT4gYS5kYXRhLmNtYyA+IGIuZGF0YS5jbWMgPyAxIDogLTEpO1xyXG4gICAgbGFuZHMgPSBPYmplY3QudmFsdWVzKGxhbmRzKS5zb3J0KChhLCBiKSA9PiBhLm5hbWUgPiBiLm5hbWUgPyAxIDogLTEpO1xyXG4gICAgbGV0IG91dHB1dCA9IFwiIyBDcmVhdHVyZXNcIjtcclxuICAgIGZvciAobGV0IGN1ciBvZiBjcmVhdHVyZXMpIHtcclxuICAgICAgb3V0cHV0ICs9IFwiXFxuXCIgKyBjdXIuY291bnQgKyBcIiBcIiArIGN1ci5uYW1lO1xyXG4gICAgfVxyXG4gICAgb3V0cHV0ICs9IFwiXFxuXFxuIyBTcGVsbHNcIjtcclxuICAgIGZvciAobGV0IGN1ciBvZiBzcGVsbHMpIHtcclxuICAgICAgb3V0cHV0ICs9IFwiXFxuXCIgKyBjdXIuY291bnQgKyBcIiBcIiArIGN1ci5uYW1lO1xyXG4gICAgfVxyXG5cclxuICAgIG91dHB1dCArPSBcIlxcblxcbiMgTGFuZHNcIlxyXG4gICAgZm9yIChsZXQgY3VyIG9mIGxhbmRzKSB7XHJcbiAgICAgIG91dHB1dCArPSBcIlxcblwiICsgY3VyLmNvdW50ICsgXCIgXCIgKyBjdXIubmFtZTtcclxuICAgIH1cclxuXHJcbiAgICBvdXRwdXQgKz0gXCJcXG5cXG4jIE1heWJlXCJcclxuICAgIGZvciAobGV0IGN1ciBvZiBtYXliZSkge1xyXG4gICAgICBvdXRwdXQgKz0gXCJcXG4vL1wiICsgY3VyO1xyXG4gICAgfVxyXG5cclxuICAgIG91dHB1dCArPSBcIlxcblxcbiMgTm90IEZvdW5kXCJcclxuICAgIGZvciAobGV0IGN1ciBvZiBlcnJvcnMpIHtcclxuICAgICAgb3V0cHV0ICs9IFwiXFxuLy9cIiArIGN1ci5jb3VudCArIFwiIFwiICsgY3VyLm5hbWU7XHJcbiAgICB9XHJcblxyXG5cclxuICAgIHJldHVybiBvdXRwdXQ7XHJcbiAgfVxyXG5cclxuXHJcbiAgLyoqXHJcbiAgICogY29udmVydHMgYSBkZWNrIHN0cmluZyB0byBhIHJlYWRhYmxlIG9iamVjdFxyXG4gICAqIGFuZCBkb3dubG9hZHMgdGhlIGltZyBkYXRhIG9uIGRlbWFuZCwgaWYgaXQgZG9lcyBub3QgZXhpc3RcclxuICAgKlxyXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBkZWNrU3RyaW5nIHRoZSBjb21wbGV0ZSBkZWNrLCBjb3BpZWQgZnJvbSBhIHNpdGUgb3IgZS5nIGZvcmdlXHJcbiAgICogQG1lbWJlcm9mIE10Z0ludGVyZmFjZVxyXG4gICAqL1xyXG4gIGFzeW5jIGNyZWF0ZURlY2soZGVja1N0cmluZywgdXBkYXRlID0gKCkgPT4ge30sIHNvcnQgPSBmYWxzZSkge1xyXG4gICAgLy8gY29udmVydCB0aGUgZGVjayBzdHJpbmcgdG8gYW4gYXJyYXlcclxuXHJcblxyXG5cclxuXHJcblxyXG5cclxuXHJcbiAgICBsZXQgZ3JvdXBzID0gWy4uLmRlY2tTdHJpbmcubWF0Y2goLyMoLio/KShcXG58JCkvZykgfHwgW1wibWFpblwiXV07XHJcbiAgICBjb25zdCBkZWNrUmF3ID0gZGVja1N0cmluZy50cmltKCkucmVwbGFjZSgvXFwoKC4qPylcXCl8KFswLTldKlxcbikvZywgXCJcXG5cIikucmVwbGFjZSgvXFxzKlxcbitcXHMqXFxuKy9nLCBcIlxcblwiKS5zcGxpdChcIlxcblwiKTtcclxuICAgIGlmICghZGVja1JhdykgcmV0dXJuIFtdO1xyXG4gICAgaWYgKCFkZWNrUmF3WzBdLmluY2x1ZGVzKFwiI1wiKSkge1xyXG4gICAgICBpZiAoZ3JvdXBzWzBdICE9PSBcIm1haW5cIikge1xyXG4gICAgICAgIGdyb3VwcyA9IFtcIm1haW5cIl0uY29uY2F0KGdyb3Vwcyk7XHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGRlY2tSYXcuc2hpZnQoKTtcclxuICAgIH1cclxuXHJcblxyXG4gICAgZ3JvdXBzID0gZ3JvdXBzLm1hcCh2ID0+IHsgcmV0dXJuIHsgZGVjazoge30sIG5hbWU6IHYucmVwbGFjZShcIiNcIiwgXCJcIikudHJpbSgpIH0gfSk7XHJcblxyXG4gICAgbGV0IGN1ckdyb3VwID0gMDtcclxuXHJcbiAgICBsZXQgcHJvZ3Jlc3MgPSAwO1xyXG4gICAgbGV0IGlnbm9yZWQgPSAwO1xyXG4gICAgLy8gaXRlcmF0ZSBlYWNoIGZvdW5kIGNhcmRcclxuICAgIGZvciAobGV0IGNhcmQgb2YgZGVja1Jhdykge1xyXG4gICAgICBpZiAoIWNhcmQpIGNvbnRpbnVlO1xyXG4gICAgICBpZiAoY2FyZC50cmltKCkuc3RhcnRzV2l0aChcIi8vXCIpKSBjb250aW51ZTtcclxuICAgICAgaWYgKGNhcmQuaW5jbHVkZXMoXCIjXCIpKSB7XHJcbiAgICAgICAgY3VyR3JvdXArKztcclxuICAgICAgICBpZiAoY3VyR3JvdXAgPiBncm91cHMubGVuZ3RoKSBjdXJHcm91cCA9IDA7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuICAgICAgcHJvZ3Jlc3MrKztcclxuXHJcbiAgICAgIGNvbnN0IGRlY2sgPSBncm91cHNbY3VyR3JvdXBdLmRlY2s7XHJcbiAgICAgIHVwZGF0ZShwcm9ncmVzcywgZGVja1Jhdy5sZW5ndGggLSBncm91cHMubGVuZ3RoICsgMSAtIGlnbm9yZWQpO1xyXG4gICAgICAvLyBleHRyYWN0IHRoZSBjb3VudCBmcm9tIHRoZSBzdHJpbmcgYW5kIGZyZWUgdGhlIG5hbWVcclxuXHJcbiAgICAgIGxldCBjb3VudCA9IE1hdGguZmxvb3IoKChjYXJkLm1hdGNoKC8oXFxkKykvKSB8fCBbXSlbMF0gfHwgMSkpO1xyXG4gICAgICBpZiAoaXNOYU4oY291bnQpKSB7XHJcbiAgICAgICAgY291bnQgPSAxO1xyXG4gICAgICB9XHJcbiAgICAgIGNvbnN0IG5hbWUgPSBjYXJkLnJlcGxhY2UoLyhcXGQrKS8sIFwiXCIpLnRyaW0oKTtcclxuICAgICAgaWYgKCFuYW1lKSBjb250aW51ZTsgLy8gY2FudCB3b3JrIHdpdGggdGhpcyBkYXRhXHJcbiAgICAgIC8vIHNlYXJjaCB0aGUgYWNjb3JkaW5nIGRhdGFcclxuICAgICAgbGV0IGRhdGEgPSBhd2FpdCB0aGlzLmNhcmRCeU5hbWUobmFtZSk7XHJcblxyXG4gICAgICBpZiAoZGF0YS5uYW1lKVxyXG4gICAgICAgIGRlY2tTdHJpbmcgPSBkZWNrU3RyaW5nLnJlcGxhY2UobmFtZSwgZGF0YS5uYW1lKTtcclxuICAgICAgaWYgKGRhdGEuY29kZSA9PSBcIm5vdF9mb3VuZFwiKSB7XHJcbiAgICAgICAgZGF0YSA9IHtcclxuICAgICAgICAgIGltYWdlX3VyaXM6IHt9LFxyXG4gICAgICAgICAgbGVnYWxpdGllczoge30sXHJcbiAgICAgICAgICBwcmljZXM6IHsgdXNkOiAwIH0sXHJcbiAgICAgICAgICBtYW5hX2Nvc3Q6IFwiXCIsXHJcbiAgICAgICAgICBjbWM6IDAsXHJcbiAgICAgICAgICB0eXBlX2xpbmU6IFwibGFuZFwiLFxyXG4gICAgICAgICAgcHVyY2hhc2VfdXJpczogeyBjYXJkbWFya2V0OiBcIlwiIH1cclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChkZWNrW25hbWVdKSB7XHJcbiAgICAgICAgZGVja1tuYW1lXS5jb3VudCArPSBjb3VudDtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICAvLyB3cmFwIGRhdGEgaW4gZWFzeSByZWFkYWJsZSBmb3JtYXRcclxuICAgICAgICBsZXQgYmFja3NpZGUgPSBcIlwiO1xyXG4gICAgICAgIGlmICghZGF0YS5pbWFnZV91cmlzKSB7XHJcbiAgICAgICAgICBpZiAoZGF0YS5jYXJkX2ZhY2VzKSB7XHJcbiAgICAgICAgICAgIGRhdGEuaW1hZ2VfdXJpcyA9IGRhdGEuY2FyZF9mYWNlc1swXS5pbWFnZV91cmlzO1xyXG4gICAgICAgICAgICBjb25zdCBiaXUgPSBkYXRhLmNhcmRfZmFjZXNbMV0uaW1hZ2VfdXJpcztcclxuICAgICAgICAgICAgYmFja3NpZGUgPSBiaXUgPyBiaXUuYm9yZGVyX2Nyb3AgfHwgYml1Lm5vcm1hbCA6IFwiXCI7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhcImVyclwiLCBkYXRhKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHVybCA9IGRhdGEgPyBkYXRhLmltYWdlX3VyaXMuYm9yZGVyX2Nyb3AgfHwgZGF0YS5pbWFnZV91cmlzLm5vcm1hbCA6IFwiXCI7XHJcbiAgICAgICAgZGVja1tuYW1lXSA9IHtcclxuICAgICAgICAgIG5hbWUsXHJcbiAgICAgICAgICBjb3VudCxcclxuICAgICAgICAgIHVybCxcclxuICAgICAgICAgIGJhY2tzaWRlLFxyXG4gICAgICAgICAgZGF0YVxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIGxldCBsYW5kQ291bnQgPSAwO1xyXG4gICAgY29uc3Qgb3ZlcmFsbERldm90aW9uID0ge1xyXG4gICAgICBibHVlOiAwLFxyXG4gICAgICBibGFjazogMCxcclxuICAgICAgcmVkOiAwLFxyXG4gICAgICB3aGl0ZTogMCxcclxuICAgICAgZ3JlZW46IDAsXHJcbiAgICAgIGNvbG9ybGVzczogMCxcclxuICAgICAgZ2VuZXJpYzogMCxcclxuICAgICAgc3VtOiAwXHJcbiAgICB9O1xyXG4gICAgY29uc3Qgb3ZlcmFsbE1hbmFDdXJ2ZSA9IFtdO1xyXG4gICAgLy9tYW5hX2Nvc3Q6IFwie1d9e1V9e0J9e1J9e0d9IHtDfVwiXHJcblxyXG4gICAgbGV0IG92ZXJhbGxDb3VudCA9IDA7XHJcbiAgICBsZXQgb3ZlcmFsbENvc3QgPSAwO1xyXG5cclxuICAgIGxldCBjcmVhdHVyZUNvdW50ID0gMDtcclxuICAgIGxldCBpbnN0YW50Q291bnQgPSAwO1xyXG4gICAgbGV0IHNvcmNlcnlDb3VudCA9IDA7XHJcbiAgICBsZXQgZW5jaGFudG1lbnRDb3VudCA9IDA7XHJcbiAgICBsZXQgYXJ0aWZhY3RDb3VudCA9IDA7XHJcbiAgICBsZXQgcGxhbmVzd2Fsa2VyQ291bnQgPSAwO1xyXG5cclxuICAgIGxldCB0eXBlQ291bnRzID0ge307XHJcblxyXG4gICAgLy9tYW5hX2Nvc3Quc3BsaXQoXCJHXCIpLmxlbmd0aCAtIDFcclxuICAgIGZvciAobGV0IGdyb3VwIG9mIGdyb3Vwcykge1xyXG5cclxuICAgICAgZ3JvdXAuY2FyZHMgPSBPYmplY3QudmFsdWVzKGdyb3VwLmRlY2spO1xyXG4gICAgICBncm91cC5jYXJkcyA9IGdyb3VwLmNhcmRzLnNvcnQoKGEsIGIpID0+IGEuZGF0YS5jbWMgPiBiLmRhdGEuY21jID8gMSA6IC0xKTtcclxuXHJcbiAgICAgIGxldCBjb3VudCA9IDA7XHJcbiAgICAgIGxldCBjb3N0ID0gMDtcclxuICAgICAgY29uc3QgaXNNYXliZSA9IGdyb3VwLm5hbWUudG9Mb3dlckNhc2UoKSA9PSBcIm1heWJlXCI7XHJcblxyXG5cclxuICAgICAgY29uc3QgZGV2b3Rpb24gPSB7XHJcbiAgICAgICAgYmx1ZTogMCxcclxuICAgICAgICBibGFjazogMCxcclxuICAgICAgICByZWQ6IDAsXHJcbiAgICAgICAgd2hpdGU6IDAsXHJcbiAgICAgICAgZ3JlZW46IDAsXHJcbiAgICAgICAgY29sb3JsZXNzOiAwLFxyXG4gICAgICAgIGdlbmVyaWM6IDAsXHJcbiAgICAgICAgc3VtOiAwXHJcbiAgICAgIH07XHJcbiAgICAgIGNvbnN0IG1hbmFDdXJ2ZSA9IFtdO1xyXG4gICAgICBmb3IgKGxldCBjYXJkIG9mIGdyb3VwLmNhcmRzKSB7XHJcbiAgICAgICAgY291bnQgKz0gY2FyZC5jb3VudDtcclxuICAgICAgICBpZiAoIWlzTWF5YmUpIHtcclxuXHJcbiAgICAgICAgICBjb3N0ICs9IHBhcnNlRmxvYXQoY2FyZC5kYXRhLnByaWNlcy51c2QgfHwgMCkgKiBjYXJkLmNvdW50O1xyXG5cclxuICAgICAgICAgIGlmIChjYXJkLmRhdGEudHlwZV9saW5lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJsYW5kXCIpKSB7XHJcbiAgICAgICAgICAgIGxhbmRDb3VudCArPSBjYXJkLmNvdW50O1xyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgbWFuYUN1cnZlW2NhcmQuZGF0YS5jbWMgfHwgMF0gPSAobWFuYUN1cnZlW2NhcmQuZGF0YS5jbWMgfHwgMF0gfHwgMCkgKyBjYXJkLmNvdW50O1xyXG4gICAgICAgICAgfVxyXG5cclxuICAgICAgICAgIGlmIChjYXJkLmRhdGEudHlwZV9saW5lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJjcmVhdHVyZVwiKSkge1xyXG4gICAgICAgICAgICBjcmVhdHVyZUNvdW50ICs9IGNhcmQuY291bnQ7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBpZiAoY2FyZC5kYXRhLnR5cGVfbGluZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKFwiYXJ0aWZhY3RcIikpIHtcclxuICAgICAgICAgICAgYXJ0aWZhY3RDb3VudCArPSBjYXJkLmNvdW50O1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgaWYgKGNhcmQuZGF0YS50eXBlX2xpbmUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhcImVuY2hhbnRtZW50XCIpKSB7XHJcbiAgICAgICAgICAgIGVuY2hhbnRtZW50Q291bnQgKz0gY2FyZC5jb3VudDtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGlmIChjYXJkLmRhdGEudHlwZV9saW5lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJpbnN0YW50XCIpKSB7XHJcbiAgICAgICAgICAgIGluc3RhbnRDb3VudCArPSBjYXJkLmNvdW50O1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgaWYgKGNhcmQuZGF0YS50eXBlX2xpbmUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhcInNvcmNlcnlcIikpIHtcclxuICAgICAgICAgICAgc29yY2VyeUNvdW50ICs9IGNhcmQuY291bnQ7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBpZiAoY2FyZC5kYXRhLnR5cGVfbGluZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKFwicGxhbmVzd2Fsa2VyXCIpKSB7XHJcbiAgICAgICAgICAgIHBsYW5lc3dhbGtlckNvdW50ICs9IGNhcmQuY291bnQ7XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgLy8gYW5kIG5vdyBhbGxcclxuXHJcbiAgICAgICAgICBjb25zdCB0eXBlcyA9IGNhcmQuZGF0YS50eXBlX2xpbmUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKFwiLVwiLCBcIiBcIikucmVwbGFjZShcIuKAlFwiLCBcIiBcIikucmVwbGFjZShcIi8vXCIsIFwiIFwiKS5yZXBsYWNlKFwiYmFzaWNcIiwgXCIgXCIpLnNwbGl0KFwiIFwiKTtcclxuICAgICAgICAgIGZvciAobGV0IHQgb2YgdHlwZXMpIHtcclxuICAgICAgICAgICAgdCA9IHQudHJpbSgpO1xyXG4gICAgICAgICAgICBpZiAoIXQpIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICBpZiAoIXR5cGVDb3VudHNbdF0pIHR5cGVDb3VudHNbdF0gPSAwO1xyXG4gICAgICAgICAgICB0eXBlQ291bnRzW3RdKys7XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY2FyZC5kYXRhLm1hbmFfY29zdCA9IGNhcmQuZGF0YS5tYW5hX2Nvc3QgfHwgXCJcIjtcclxuICAgICAgICBkZXZvdGlvbi5ibHVlICs9IChjYXJkLmRhdGEubWFuYV9jb3N0LnNwbGl0KFwiVVwiKS5sZW5ndGggLSAxKSAqIGNhcmQuY291bnQ7XHJcbiAgICAgICAgZGV2b3Rpb24uYmxhY2sgKz0gKGNhcmQuZGF0YS5tYW5hX2Nvc3Quc3BsaXQoXCJCXCIpLmxlbmd0aCAtIDEpICogY2FyZC5jb3VudDtcclxuICAgICAgICBkZXZvdGlvbi5yZWQgKz0gKGNhcmQuZGF0YS5tYW5hX2Nvc3Quc3BsaXQoXCJSXCIpLmxlbmd0aCAtIDEpICogY2FyZC5jb3VudDtcclxuICAgICAgICBkZXZvdGlvbi53aGl0ZSArPSAoY2FyZC5kYXRhLm1hbmFfY29zdC5zcGxpdChcIldcIikubGVuZ3RoIC0gMSkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIGRldm90aW9uLmdyZWVuICs9IChjYXJkLmRhdGEubWFuYV9jb3N0LnNwbGl0KFwiR1wiKS5sZW5ndGggLSAxKSAqIGNhcmQuY291bnQ7XHJcbiAgICAgICAgZGV2b3Rpb24uY29sb3JsZXNzICs9IChjYXJkLmRhdGEubWFuYV9jb3N0LnNwbGl0KFwiQ1wiKS5sZW5ndGggLSAxKSAqIGNhcmQuY291bnQ7XHJcbiAgICAgICAgZGV2b3Rpb24uZ2VuZXJpYyArPSBNYXRoLmZsb29yKGNhcmQuZGF0YS5tYW5hX2Nvc3QucmVwbGFjZSgvW14wLTkuXS9nLCBcIiBcIikudHJpbSgpLnJlcGxhY2UoL1xcc1xccysvZywgXCIgXCIpLnNwbGl0KFwiIFwiKS5yZWR1Y2UoKHRvdGFsLCBudW0pID0+IE1hdGguZmxvb3IodG90YWwpICsgTWF0aC5mbG9vcihudW0pKSkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIC8vIGRldm90aW9uLmdlbmVyaWMgKz0gTWF0aC5mbG9vcihjYXJkLmRhdGEubWFuYV9jb3N0LnJlcGxhY2UoL1teMC05Ll0vZywgXCJcIikgfHwgMCkgKiBjYXJkLmNvdW50O1xyXG4gICAgICAgIGRldm90aW9uLnN1bSA9IChkZXZvdGlvbi5zdW0gfHwgMCkgKyAoTWF0aC5mbG9vcihjYXJkLmRhdGEuY21jKSAqIGNhcmQuY291bnQpOyAvLyBkZXZvdGlvbi5ibHVlICsgZGV2b3Rpb24uYmxhY2sgKyBkZXZvdGlvbi5yZWQgKyBkZXZvdGlvbi5ncmVlbiArIGRldm90aW9uLndoaXRlICsgZGV2b3Rpb24uY29sb3JsZXNzICsgZGV2b3Rpb24uZ2VuZXJpYztcclxuICAgICAgfVxyXG5cclxuXHJcblxyXG4gICAgICBncm91cC5jb3VudCA9IGNvdW50O1xyXG4gICAgICBncm91cC5tYW5hID0gZGV2b3Rpb247XHJcbiAgICAgIGdyb3VwLmNvc3QgPSBjb3N0O1xyXG5cclxuXHJcbiAgICAgIGdyb3VwLm1hbmFDdXJ2ZSA9IG1hbmFDdXJ2ZTtcclxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtYW5hQ3VydmUubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICBtYW5hQ3VydmVbaV0gPSBtYW5hQ3VydmVbaV0gfHwgMDtcclxuICAgICAgICBpZiAoaXNNYXliZSkgY29udGludWU7XHJcbiAgICAgICAgb3ZlcmFsbE1hbmFDdXJ2ZVtpXSA9IChvdmVyYWxsTWFuYUN1cnZlW2ldIHx8IDApICsgKG1hbmFDdXJ2ZVtpXSB8fCAwKTtcclxuICAgICAgfVxyXG4gICAgICBpZiAoIWlzTWF5YmUpIHtcclxuXHJcbiAgICAgICAgb3ZlcmFsbENvc3QgKz0gY29zdDtcclxuICAgICAgICBvdmVyYWxsQ291bnQgKz0gY291bnQ7XHJcblxyXG4gICAgICAgIG92ZXJhbGxEZXZvdGlvbi5ibHVlICs9IGRldm90aW9uLmJsdWU7XHJcbiAgICAgICAgb3ZlcmFsbERldm90aW9uLmJsYWNrICs9IGRldm90aW9uLmJsYWNrO1xyXG4gICAgICAgIG92ZXJhbGxEZXZvdGlvbi5yZWQgKz0gZGV2b3Rpb24ucmVkO1xyXG4gICAgICAgIG92ZXJhbGxEZXZvdGlvbi53aGl0ZSArPSBkZXZvdGlvbi53aGl0ZTtcclxuICAgICAgICBvdmVyYWxsRGV2b3Rpb24uZ3JlZW4gKz0gZGV2b3Rpb24uZ3JlZW47XHJcbiAgICAgICAgb3ZlcmFsbERldm90aW9uLmNvbG9ybGVzcyArPSBkZXZvdGlvbi5jb2xvcmxlc3M7XHJcblxyXG4gICAgICAgIG92ZXJhbGxEZXZvdGlvbi5nZW5lcmljICs9IGRldm90aW9uLmdlbmVyaWM7XHJcbiAgICAgICAgb3ZlcmFsbERldm90aW9uLnN1bSArPSBkZXZvdGlvbi5zdW07XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG92ZXJhbGxNYW5hQ3VydmUubGVuZ3RoOyBpKyspIHtcclxuICAgICAgb3ZlcmFsbE1hbmFDdXJ2ZVtpXSA9IG92ZXJhbGxNYW5hQ3VydmVbaV0gfHwgMDtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBub25sYW5kcyA9IG92ZXJhbGxDb3VudCAtIGxhbmRDb3VudDtcclxuXHJcbiAgICBsZXQganVzdERldm90aW9uID0gb3ZlcmFsbERldm90aW9uLmJsdWUgKyBvdmVyYWxsRGV2b3Rpb24uYmxhY2sgKyBvdmVyYWxsRGV2b3Rpb24ucmVkICsgb3ZlcmFsbERldm90aW9uLndoaXRlICsgb3ZlcmFsbERldm90aW9uLmdyZWVuICsgb3ZlcmFsbERldm90aW9uLmNvbG9ybGVzcztcclxuICAgIGp1c3REZXZvdGlvbiA9IGp1c3REZXZvdGlvbiB8fCAxO1xyXG4gICAgY29uc3QgbWFuYVByb3Bvc2FsID0ge1xyXG4gICAgICBibHVlOiBvdmVyYWxsRGV2b3Rpb24uYmx1ZSAvIGp1c3REZXZvdGlvbixcclxuICAgICAgYmxhY2s6IG92ZXJhbGxEZXZvdGlvbi5ibGFjayAvIGp1c3REZXZvdGlvbixcclxuICAgICAgcmVkOiBvdmVyYWxsRGV2b3Rpb24ucmVkIC8ganVzdERldm90aW9uLFxyXG4gICAgICB3aGl0ZTogb3ZlcmFsbERldm90aW9uLndoaXRlIC8ganVzdERldm90aW9uLFxyXG4gICAgICBncmVlbjogb3ZlcmFsbERldm90aW9uLmdyZWVuIC8ganVzdERldm90aW9uLFxyXG4gICAgICBjb2xvcmxlc3M6IG92ZXJhbGxEZXZvdGlvbi5jb2xvcmxlc3MgLyBqdXN0RGV2b3Rpb24sXHJcbiAgICB9O1xyXG5cclxuICAgIGdyb3Vwc1tcIm1hbmFQcm9wb3NhbFwiXSA9IG1hbmFQcm9wb3NhbDtcclxuXHJcbiAgICBncm91cHNbXCJsYW5kQ291bnRcIl0gPSBsYW5kQ291bnQ7XHJcbiAgICBncm91cHNbXCJjYXJkQ291bnRcIl0gPSBvdmVyYWxsQ291bnQ7XHJcbiAgICBncm91cHNbXCJhdmVyYWdlTWFuYVwiXSA9IG92ZXJhbGxEZXZvdGlvbi5zdW0gLyAob3ZlcmFsbENvdW50IC0gbGFuZENvdW50KTtcclxuICAgIGdyb3Vwc1tcImNvc3RcIl0gPSBvdmVyYWxsQ29zdDtcclxuICAgIGdyb3Vwc1tcIm1hbmFcIl0gPSBvdmVyYWxsRGV2b3Rpb247XHJcbiAgICBncm91cHNbXCJjb3JyZWN0ZWRcIl0gPSBkZWNrU3RyaW5nO1xyXG4gICAgZ3JvdXBzW1wibWFuYUN1cnZlXCJdID0gb3ZlcmFsbE1hbmFDdXJ2ZTtcclxuXHJcblxyXG4gICAgLy8gVE9ETzogaHlwZXJnZW9tYXRyaWMgZGlzdHJpYnV0aW9uXHJcbiAgICAvLyBmb3IgKGxldCBncm91cCBvZiBncm91cHMpIHtcclxuICAgIC8vICAgZ3JvdXAuY2hhbmNlcyA9IGh5cGVyZ2VvbWV0cmljRGlzdHJpYnV0aW9uKGdyb3VwLmNvdW50LCAxMSwgMSwgb3ZlcmFsbENvdW50KTtcclxuICAgIC8vIH1cclxuXHJcblxyXG5cclxuXHJcbiAgICBncm91cHNbXCJjcmVhdHVyZUNvdW50XCJdID0gY3JlYXR1cmVDb3VudDtcclxuICAgIGdyb3Vwc1tcImluc3RhbnRDb3VudFwiXSA9IGluc3RhbnRDb3VudDtcclxuICAgIGdyb3Vwc1tcInNvcmNlcnlDb3VudFwiXSA9IHNvcmNlcnlDb3VudDtcclxuICAgIGdyb3Vwc1tcInBsYW5lc3dhbGtlckNvdW50XCJdID0gcGxhbmVzd2Fsa2VyQ291bnQ7XHJcbiAgICBncm91cHNbXCJlbmNoYW50bWVudENvdW50XCJdID0gZW5jaGFudG1lbnRDb3VudDtcclxuICAgIGdyb3Vwc1tcImFydGlmYWN0Q291bnRcIl0gPSBhcnRpZmFjdENvdW50O1xyXG4gICAgZ3JvdXBzW1widHlwZUNvdW50c1wiXSA9IHR5cGVDb3VudHM7XHJcblxyXG4gICAgZGVsZXRlIHR5cGVDb3VudHMuZW5jaGFudG1lbnQ7XHJcbiAgICBkZWxldGUgdHlwZUNvdW50cy5wbGFuZXN3YWxrZXI7XHJcbiAgICBkZWxldGUgdHlwZUNvdW50cy5zb3JjZXJ5O1xyXG4gICAgZGVsZXRlIHR5cGVDb3VudHMuaW5zdGFudDtcclxuICAgIGRlbGV0ZSB0eXBlQ291bnRzLmFydGlmYWN0O1xyXG4gICAgZGVsZXRlIHR5cGVDb3VudHMuY3JlYXR1cmU7XHJcbiAgICBkZWxldGUgdHlwZUNvdW50cy5sYW5kO1xyXG5cclxuICAgIGxldCB0eXBlTmFtZXMgPSBPYmplY3Qua2V5cyh0eXBlQ291bnRzKTtcclxuICAgIGNvbnNvbGUubG9nKFwiYlwiLCB0eXBlTmFtZXMpO1xyXG4gICAgdHlwZU5hbWVzID0gdHlwZU5hbWVzLnNvcnQoKGEsIGIpID0+IHR5cGVDb3VudHNbYV0gPCB0eXBlQ291bnRzW2JdID8gMSA6IC0xKTtcclxuICAgIGNvbnNvbGUubG9nKFwiYVwiLCB0eXBlTmFtZXMpO1xyXG4gICAgZ3JvdXBzW1widHlwZU5hbWVzXCJdID0gdHlwZU5hbWVzO1xyXG4gICAgcmV0dXJuIGdyb3VwcztcclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gTXRnSW50ZXJmYWNlOyIsIjxzY3JpcHQ+XHJcbiAgaW1wb3J0IHsgb25Nb3VudCB9IGZyb20gXCJzdmVsdGVcIjtcclxuICAvLyBjb25zdCB7IGlwY1JlbmRlcmVyIH0gPSByZXF1aXJlKFwiZWxlY3Ryb25cIik7XHJcbiAgaW1wb3J0IFBsYXlUZXN0ZXIgZnJvbSBcIi4vcGxheXRlc3Rlci5zdmVsdGVcIjtcclxuICBjb25zdCBpcGMgPSByZXF1aXJlKFwiZWxlY3Ryb25cIikuaXBjUmVuZGVyZXI7XHJcbiAgaW1wb3J0IGNsIGZyb20gXCIuL2NhcmQtbG9hZGVyLmpzXCI7XHJcbiAgY29uc3QgQ2FyZExvYWRlciA9IG5ldyBjbChpcGMpO1xyXG4gIC8vIGltcG9ydCBMWlVURjggZnJvbSBcImx6dXRmOFwiO1xyXG4gIC8vaW1wb3J0IENvb2tpZXMgZnJvbSBcImpzLWNvb2tpZVwiO1xyXG5cclxuICBjb25zdCBDb29raWVzID0ge1xyXG4gICAgc2V0OiAoKSA9PiB7fSxcclxuICAgIGdldDogKCkgPT4ge31cclxuICB9O1xyXG5cclxuICBjb25zdCBDQVJEX1JBVElPID0gMC43MTc2NDcwNTg4MjtcclxuICBsZXQgX2hlaWdodCA9IDMwMDtcclxuICBsZXQgX3dpZHRoID0gTWF0aC5mbG9vcihfaGVpZ2h0ICogQ0FSRF9SQVRJTyk7XHJcblxyXG4gIGxldCB1c2VDb29raWVzID0gdHJ1ZTtcclxuXHJcbiAgZnVuY3Rpb24gZW5hYmxlU2F2aW5nKCkge1xyXG4gICAgdXNlQ29va2llcyA9IHRydWU7XHJcbiAgICBDb29raWVzLnNldChcInVzZUNvb2tpZXNcIiwgdHJ1ZSk7XHJcbiAgICBzYXZlQWxsVG9Db29raWVzKCk7XHJcbiAgfVxyXG5cclxuICBjb25zdCBvbGRTZXQgPSBDb29raWVzLnNldDtcclxuICBDb29raWVzLnNldCA9IChhLCBiKSA9PiB7XHJcbiAgICBpZiAodXNlQ29va2llcykgb2xkU2V0KGEsIGIpO1xyXG4gICAgZWxzZSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKFwic2F2aW5nIGRpc2FibGVkXCIpO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGxldCBoZWlnaHQgPSBfaGVpZ2h0O1xyXG4gIGxldCB3aWR0aCA9IF93aWR0aDtcclxuICBsZXQgY2FyZFNlYXJjaEFjdGl2ZSA9IGZhbHNlO1xyXG4gIGxldCBwbGF5VGVzdGVyQWN0aXZlID0gZmFsc2U7XHJcbiAgbGV0IHN0YXRpc3RpY3NBY3RpdmUgPSB0cnVlO1xyXG4gIGxldCBzY2FsaW5nID0gMTAwO1xyXG5cclxuICBsZXQgZGlzcGxheTtcclxuXHJcbiAgbGV0IGRldm90aW9uSGlnaGxpZ2h0ID0gLTE7XHJcblxyXG4gIGZ1bmN0aW9uIGhpZ2hsaWdodERldm90aW9uKG1hbmEpIHtcclxuICAgIGlmIChkZXZvdGlvbkhpZ2hsaWdodCA9PSBtYW5hKSBkZXZvdGlvbkhpZ2hsaWdodCA9IC0xO1xyXG4gICAgZWxzZSBkZXZvdGlvbkhpZ2hsaWdodCA9IG1hbmEgKyBcIlwiO1xyXG4gIH1cclxuXHJcbiAgJDoge1xyXG4gICAgY29uc3QgcyA9IE1hdGguZmxvb3Ioc2NhbGluZyB8fCAxMDApIC8gMTAwO1xyXG4gICAgaGVpZ2h0ID0gX2hlaWdodCAqIHM7XHJcbiAgICB3aWR0aCA9IF93aWR0aCAqIHM7XHJcbiAgfVxyXG5cclxuICBsZXQgcHJvbWlzZSA9IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gcmVzb2x2ZShbXSkpO1xyXG4gIGxldCBjYXJkU2VhcmNoUHJvbWlzZSA9IG5ldyBQcm9taXNlKHJlc29sdmUgPT5cclxuICAgIHJlc29sdmUoeyBkYXRhOiBbXSwgaGFzX21vcmU6IGZhbHNlLCB0b3RhbF9jYXJkczogMCB9KVxyXG4gICk7XHJcblxyXG4gIGxldCBpbnB1dDtcclxuICBsZXQgZm9ybWF0O1xyXG4gIGxldCBwcm9ncmVzcyA9IDA7XHJcbiAgbGV0IGFsbCA9IDA7XHJcblxyXG4gIGxldCBzcE5hbWU7XHJcbiAgbGV0IHNwVGV4dDtcclxuICBsZXQgc3BUeXBlO1xyXG5cclxuICBsZXQgc3BFREhCbHVlO1xyXG4gIGxldCBzcEVESEJsYWNrO1xyXG4gIGxldCBzcEVESFJlZDtcclxuICBsZXQgc3BFREhXaGl0ZTtcclxuICBsZXQgc3BFREhHcmVlbjtcclxuICBsZXQgc3BFREhDb2xvcmxlc3M7XHJcblxyXG4gIGxldCBkZWNrU2VhY2ggPSBudWxsO1xyXG4gIGxldCBkZWNrU2VhcmNoSW5wdXQ7XHJcblxyXG4gIGZ1bmN0aW9uIGNoYW5nZURlY2tTZWFyY2goZ3JvdXBzKSB7XHJcbiAgICBpZiAoIWdyb3VwcykgcmV0dXJuZGVja1NlYWNoID0gbnVsbDtcclxuICAgIGxldCBzID0gZGVja1NlYXJjaElucHV0LnZhbHVlO1xyXG4gICAgaWYgKCFzKSByZXR1cm4gKGRlY2tTZWFjaCA9IG51bGwpO1xyXG5cclxuICAgIHMgPSBzXHJcbiAgICAgIC50cmltKClcclxuICAgICAgLnJlcGxhY2UoL1xcc1xccysvZ20sIFwiIFwiKVxyXG4gICAgICAudG9Mb3dlckNhc2UoKVxyXG4gICAgICAucmVwbGFjZSgvXFxzL2dtLCBcIigufFxcbikqXCIpO1xyXG4gICAgLyogICAgLnNwbGl0KFwiK1wiKVxyXG4gICAgICAuam9pbihcInxcIik7Ki9cclxuICAgIGNvbnNvbGUubG9nKFwic2VhcmNoOlwiLCBzKTtcclxuICAgIGNvbnN0IHJlc3VsdCA9IFtdO1xyXG4gICAgbGV0IGNvdW50ID0gMDtcclxuICAgIGNvbnN0IHIgPSBuZXcgUmVnRXhwKHMsIFwiZ21cIik7XHJcbiAgICBmb3IgKGxldCBncm91cCBvZiBncm91cHMpIHtcclxuICAgICAgZm9yIChsZXQgY2FyZCBvZiBncm91cC5jYXJkcykge1xyXG4gICAgICAgIGlmICghY2FyZCB8fCAhY2FyZC5kYXRhIHx8ICFjYXJkLmRhdGEub3JhY2xlX3RleHQpIGNvbnRpbnVlO1xyXG4gICAgICAgIGlmICghY2FyZC5kYXRhLm9yYWNsZV90ZXh0LnRvTG93ZXJDYXNlKCkubWF0Y2gocikpIGNvbnRpbnVlO1xyXG4gICAgICAgIGNvdW50ICs9IGNhcmQuY291bnQ7XHJcbiAgICAgICAgcmVzdWx0LnB1c2goY2FyZCk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBkZWNrU2VhY2ggPSBbXHJcbiAgICAgIHtcclxuICAgICAgICBjYXJkczogcmVzdWx0LFxyXG4gICAgICAgIGNvc3Q6IDAsXHJcbiAgICAgICAgY291bnQsXHJcbiAgICAgICAgZGVjazoge30sXHJcbiAgICAgICAgbWFuYToge1xyXG4gICAgICAgICAgYmxhY2s6IDAsXHJcbiAgICAgICAgICBibHVlOiAwLFxyXG4gICAgICAgICAgY29sb3JsZXNzOiAwLFxyXG4gICAgICAgICAgZ2VuZXJpYzogMjQwLFxyXG4gICAgICAgICAgZ3JlZW46IDAsXHJcbiAgICAgICAgICByZWQ6IDAsXHJcbiAgICAgICAgICBzdW06IDI0MCxcclxuICAgICAgICAgIHdoaXRlOiAwXHJcbiAgICAgICAgfSxcclxuICAgICAgICBtYW5hQ3VydmU6IFtdLFxyXG4gICAgICAgIG5hbWU6IFwic2VhcmNoIHJlc3VsdFwiXHJcbiAgICAgIH1cclxuICAgIF07XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIGNsZWFyRm9yQ29sb3JsZXNzKCkge1xyXG4gICAgc3BFREhCbHVlLmNoZWNrZWQgPSBmYWxzZTtcclxuICAgIHNwRURIQmxhY2suY2hlY2tlZCA9IGZhbHNlO1xyXG4gICAgc3BFREhSZWQuY2hlY2tlZCA9IGZhbHNlO1xyXG4gICAgc3BFREhXaGl0ZS5jaGVja2VkID0gZmFsc2U7XHJcbiAgICBzcEVESEdyZWVuLmNoZWNrZWQgPSBmYWxzZTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIGNsZWFyQ29sb3JsZXNzKCkge1xyXG4gICAgc3BFREhDb2xvcmxlc3MuY2hlY2tlZCA9IGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gY2xlYW5TdHJpbmcoKSB7XHJcbiAgICBjb25zdCBhcnJheSA9IGlucHV0LnZhbHVlLnNwbGl0KFwiXFxuXCIpO1xyXG4gICAgbGV0IHJlc3VsdCA9IFtdO1xyXG4gICAgZm9yIChsZXQgYSBvZiBhcnJheSkge1xyXG4gICAgICBpZiAoIWEpIGNvbnRpbnVlO1xyXG4gICAgICBhID0gYS50cmltKCk7XHJcbiAgICAgIGlmICghYSB8fCBhLnN0YXJ0c1dpdGgoXCIvL1wiKSkgY29udGludWU7XHJcbiAgICAgIC8vICBpZiAoL1tcXG5cXHJcXHNdKy9naS50ZXN0KGEpKSBjb250aW51ZTtcclxuXHJcbiAgICAgIGlmIChhLnN0YXJ0c1dpdGgoXCIjXCIpKSB7XHJcbiAgICAgICAgYSA9IGEucmVwbGFjZShcIiNcIiwgXCJcXG4jXCIpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGEgPSBhLnRyaW0oKTtcclxuICAgICAgICBpZiAoIS9eXFxkLy50ZXN0KGEpKSB7XHJcbiAgICAgICAgICBhID0gXCIxIFwiICsgYTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGEgPSBhLnJlcGxhY2UoL1xcc1xccysvZywgXCIgXCIpO1xyXG4gICAgICByZXN1bHQucHVzaChhKTtcclxuICAgIH1cclxuICAgIGlucHV0LnZhbHVlID0gcmVzdWx0LmpvaW4oXCJcXG5cIikudHJpbSgpO1xyXG4gICAgdXBkYXRlKHsga2V5Q29kZTogMjcgfSk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBzZWFyY2hDYXJkcyhuZXh0VXJsKSB7XHJcbiAgICBpZiAodHlwZW9mIG5leHRVcmwgPT0gXCJzdHJpbmdcIikge1xyXG4gICAgICBjYXJkU2VhcmNoUHJvbWlzZSA9IENhcmRMb2FkZXIuc2VhcmNoKG5leHRVcmwpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCBjb2xvcnMgPSBuZXcgU2V0KCk7XHJcbiAgICBpZiAoc3BFREhDb2xvcmxlc3MuY2hlY2tlZCkgY29sb3JzLmFkZChcIkNcIik7XHJcbiAgICBpZiAoc3BFREhCbHVlLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJVXCIpO1xyXG4gICAgaWYgKHNwRURIQmxhY2suY2hlY2tlZCkgY29sb3JzLmFkZChcIkJcIik7XHJcbiAgICBpZiAoc3BFREhSZWQuY2hlY2tlZCkgY29sb3JzLmFkZChcIlJcIik7XHJcbiAgICBpZiAoc3BFREhXaGl0ZS5jaGVja2VkKSBjb2xvcnMuYWRkKFwiV1wiKTtcclxuICAgIGlmIChzcEVESEdyZWVuLmNoZWNrZWQpIGNvbG9ycy5hZGQoXCJHXCIpO1xyXG5cclxuICAgIGNhcmRTZWFyY2hQcm9taXNlID0gQ2FyZExvYWRlci5zZWFyY2goe1xyXG4gICAgICBuYW1lOiBzcE5hbWUudmFsdWUsXHJcbiAgICAgIHRleHQ6IHNwVGV4dC52YWx1ZSxcclxuICAgICAgdHlwZTogc3BUeXBlLnZhbHVlLFxyXG4gICAgICBlZGhjb2xvcnM6IGNvbG9yc1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBsZXQgY3VycmVudENhcmRDb250ZXh0ID0gbnVsbDtcclxuICBmdW5jdGlvbiBjYXJkQ29udGV4dE1lbnUoZXZ0LCBjYXJkLCBncm91cHMpIHtcclxuICAgIGV2dC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgaWYgKGV2dC53aGljaCA9PSAzICYmIGdyb3Vwcy5sZW5ndGggPiAxKSB7XHJcbiAgICAgIC8vIHJpZ2h0IGNsaWNrXHJcbiAgICAgIGN1cnJlbnRDYXJkQ29udGV4dCA9IGNhcmQ7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBjYXJkQ29udGV4dENsaWNrKGV2dCwgY2FyZCwgZ3JvdXApIHtcclxuICAgIGN1cnJlbnRDYXJkQ29udGV4dCA9IG51bGw7XHJcbiAgICBldnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICBldnQucHJldmVudERlZmF1bHQoKTtcclxuICAgIGxldCBkZWNrID0gaW5wdXQudmFsdWU7XHJcblxyXG4gICAgY29uc3QgciA9IG5ldyBSZWdFeHAoYF4uKiR7Y2FyZC5uYW1lfS4qJGAsIFwiZ21pXCIpO1xyXG4gICAgZGVjayA9IGRlY2sucmVwbGFjZShyLCBcIlwiKTtcclxuICAgIGxldCBpbmRleCA9IGRlY2suaW5kZXhPZihncm91cC5uYW1lKTtcclxuICAgIGlmIChpbmRleCA8IDApIHJldHVybjtcclxuICAgIGluZGV4ICs9IGdyb3VwLm5hbWUubGVuZ3RoO1xyXG5cclxuICAgIGNvbnN0IGluc2VydCA9IFwiXFxuXCIgKyBjYXJkLmNvdW50ICsgXCIgXCIgKyBjYXJkLm5hbWU7XHJcbiAgICBkZWNrID0gZGVjay5zbGljZSgwLCBpbmRleCkgKyBpbnNlcnQgKyBkZWNrLnNsaWNlKGluZGV4KTtcclxuICAgIGlucHV0LnZhbHVlID0gZGVjaztcclxuICAgIHJlbG9hZCgpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gb25NYWluTW91c2VEb3duKGV2dCkge1xyXG4gICAgY3VycmVudENhcmRDb250ZXh0ID0gbnVsbDtcclxuICB9XHJcblxyXG4gIGxldCBoaWRkZW5Hcm91cHMgPSBuZXcgU2V0KCk7XHJcblxyXG4gIGZ1bmN0aW9uIHRvZ2dsZUdyb3VwVmlzaWJpbGl0eShncm91cCkge1xyXG4gICAgaWYgKGhpZGRlbkdyb3Vwcy5oYXMoZ3JvdXAubmFtZSkpIGhpZGRlbkdyb3Vwcy5kZWxldGUoZ3JvdXAubmFtZSk7XHJcbiAgICBlbHNlIGhpZGRlbkdyb3Vwcy5hZGQoZ3JvdXAubmFtZSk7XHJcblxyXG4gICAgaGlkZGVuR3JvdXBzID0gaGlkZGVuR3JvdXBzO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gc3AocCwgYSkge1xyXG4gICAgcHJvZ3Jlc3MgPSBwO1xyXG4gICAgYWxsID0gYTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHJlc2V0RGVja1NlYXJjaCgpIHtcclxuICAgIGRlY2tTZWFjaCA9IG51bGw7XHJcbiAgICBpZiAoIWRlY2tTZWFyY2hJbnB1dCkgcmV0dXJuO1xyXG4gICAgZGVja1NlYXJjaElucHV0LnZhbHVlID0gXCJcIjtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHNvcnREZWNrU3RyaW5nKCkge1xyXG4gICAgcHJvbWlzZSA9IENhcmRMb2FkZXIuc29ydChpbnB1dC52YWx1ZSB8fCBcIlwiLCAocCwgYSkgPT4ge1xyXG4gICAgICByZXNldERlY2tTZWFyY2goKTtcclxuICAgICAgc3AocCwgYSk7XHJcbiAgICB9KVxyXG4gICAgICAuY2F0Y2goZSA9PiB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihlKTtcclxuICAgICAgICB0aHJvdyBlO1xyXG4gICAgICB9KVxyXG4gICAgICAudGhlbihyZXMgPT4ge1xyXG4gICAgICAgIGlucHV0LnZhbHVlID0gcmVzO1xyXG4gICAgICAgIHJldHVybiB1cGRhdGUoeyBrZXlDb2RlOiAyNyB9LCB0cnVlKTtcclxuICAgICAgfSk7XHJcbiAgfVxyXG5cclxuICBsZXQgZGVja05hbWVJbnB1dDtcclxuICBmdW5jdGlvbiBzYXZlRGVjaygpIHtcclxuICAgIGlmICghZGVja05hbWVJbnB1dCkgcmV0dXJuIGFsZXJ0KFwicGxzIGlucHV0IGEgbmFtZVwiKTtcclxuXHJcbiAgICAvLyBjb25zdCBmaWxlbmFtZSA9IChkZWNrTmFtZUlucHV0LnZhbHVlIHx8IFwidW5rbm93biBkZWNrXCIpICsgXCIudHh0XCI7XHJcblxyXG4gICAgaXBjLnNlbmQoXCJzYXZlRGVja1wiLCB7IGRlY2s6IGlucHV0LnZhbHVlLCBuYW1lOiBkZWNrTmFtZUlucHV0LnZhbHVlIH0pO1xyXG5cclxuICAgIC8qICBjb25zdCBibG9iID0gbmV3IEJsb2IoW2RlY2tdLCB7IHR5cGU6IFwidGV4dC9wbGFpbjtjaGFyc2V0PXV0Zi04XCIgfSk7XHJcbiAgICBpZiAod2luZG93Lm5hdmlnYXRvci5tc1NhdmVPck9wZW5CbG9iKVxyXG4gICAgICAvLyBJRTEwK1xyXG4gICAgICB3aW5kb3cubmF2aWdhdG9yLm1zU2F2ZU9yT3BlbkJsb2IoYmxvYiwgZmlsZW5hbWUpO1xyXG4gICAgZWxzZSB7XHJcbiAgICAgIC8vIE90aGVyc1xyXG4gICAgICB2YXIgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJhXCIpLFxyXG4gICAgICAgIHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XHJcbiAgICAgIGEuaHJlZiA9IHVybDtcclxuICAgICAgYS5kb3dubG9hZCA9IGZpbGVuYW1lO1xyXG4gICAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xyXG4gICAgICBhLmNsaWNrKCk7XHJcbiAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChhKTtcclxuICAgICAgICB3aW5kb3cuVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xyXG4gICAgICB9LCAwKTtcclxuICAgIH0qL1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gb25EZWNrTmFtZVR5cGUoKSB7XHJcbiAgICBDb29raWVzLnNldChcImRlY2tOYW1lXCIsIGRlY2tOYW1lSW5wdXQudmFsdWUpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gbWFpbktleURvd24oZXZ0KSB7XHJcbiAgICBpZiAoZXZ0LmN0cmxLZXkgfHwgZXZ0Lm1ldGFLZXkpIHtcclxuICAgICAgc3dpdGNoIChldnQud2hpY2gpIHtcclxuICAgICAgICBjYXNlIDgzOiAvLyBzXHJcbiAgICAgICAgICBldnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICAgIGV2dC5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICAgIHNhdmVEZWNrKCk7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gbWFpbktleVVwKGV2dCkge1xyXG4gICAgdXBkYXRlKGV2dCk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBmdW5jdGlvbiB1cGRhdGUoZXZ0KSB7XHJcbiAgICBpZiAoZXZ0LmtleUNvZGUgIT09IDI3KSByZXR1cm47XHJcblxyXG4gICAgbGV0IHNjcm9sbFBvc2l0aW9uID0gMDtcclxuICAgIGlmIChkaXNwbGF5KSB7XHJcbiAgICAgIHNjcm9sbFBvc2l0aW9uID0gZGlzcGxheS5zY3JvbGxUb3A7XHJcbiAgICB9XHJcblxyXG4gICAgcHJvbWlzZSA9IENhcmRMb2FkZXIuY3JlYXRlRGVjayhpbnB1dC52YWx1ZSB8fCBcIlwiLCAocCwgYSkgPT4ge1xyXG4gICAgICByZXNldERlY2tTZWFyY2goKTtcclxuICAgICAgc3AocCwgYSk7XHJcbiAgICB9KVxyXG4gICAgICAuY2F0Y2goZSA9PiB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihlKTtcclxuICAgICAgICB0aHJvdyBlO1xyXG4gICAgICB9KVxyXG4gICAgICAudGhlbihyZXMgPT4ge1xyXG4gICAgICAgIGlucHV0LnZhbHVlID0gcmVzLmNvcnJlY3RlZDtcclxuICAgICAgICBDb29raWVzLnNldChcImRlY2tcIiwgaW5wdXQudmFsdWUpO1xyXG4gICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgZGlzcGxheS5zY3JvbGxUb3AgPSBzY3JvbGxQb3NpdGlvbjtcclxuICAgICAgICB9KTtcclxuICAgICAgICByZXR1cm4gcmVzO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICByZXR1cm4gcHJvbWlzZTtcclxuICB9XHJcbiAgZnVuY3Rpb24gcmVsb2FkKCkge1xyXG4gICAgcmVzZXREZWNrU2VhcmNoKCk7XHJcbiAgICB1cGRhdGUoeyBrZXlDb2RlOiAyNyB9KTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIGFwcGVuZENhcmQobmFtZSkge1xyXG4gICAgaWYgKCFuYW1lKSByZXR1cm47XHJcbiAgICByZXNldERlY2tTZWFyY2goKTtcclxuICAgIGlucHV0LnZhbHVlID0gaW5wdXQudmFsdWUgKyBcIlxcbjEgXCIgKyBuYW1lO1xyXG4gICAgcmVsb2FkKCk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiByZW1vdmUoY2FyZCkge1xyXG4gICAgY29uc3QgciA9IG5ldyBSZWdFeHAoYF4uKiR7Y2FyZC5uYW1lfS4qJGAsIFwiZ21cIik7XHJcblxyXG4gICAgaW5wdXQudmFsdWUgPSBpbnB1dC52YWx1ZS5yZXBsYWNlKHIsIFwiLy8gXCIgKyBjYXJkLmNvdW50ICsgXCIgXCIgKyBjYXJkLm5hbWUpO1xyXG4gICAgcHJvbWlzZSA9IENhcmRMb2FkZXIuY3JlYXRlRGVjayhpbnB1dC52YWx1ZSB8fCBcIlwiLCAocCwgYSkgPT5cclxuICAgICAgc3AocCwgYSlcclxuICAgICkuY2F0Y2goZSA9PiB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoZSk7XHJcbiAgICAgIHRocm93IGU7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIGNvcHlEZWNrKCkge1xyXG4gICAgY29uc3QgZGVjayA9IGlucHV0LnZhbHVlO1xyXG5cclxuICAgIGlucHV0LnZhbHVlID0gaW5wdXQudmFsdWUucmVwbGFjZSgvIy4qfFxcL1xcLy4qL2dtLCBcIlxcblwiKTtcclxuXHJcbiAgICBpbnB1dC5zZWxlY3QoKTtcclxuXHJcbiAgICBpbnB1dC5zZXRTZWxlY3Rpb25SYW5nZSgwLCA5OTk5OSk7XHJcbiAgICBkb2N1bWVudC5leGVjQ29tbWFuZChcImNvcHlcIik7XHJcblxyXG4gICAgaW5wdXQudmFsdWUgPSBkZWNrO1xyXG5cclxuICAgIGFsZXJ0KFwiRGVjayBjb3BpZWQgdG8gY2xpcGJvYXJkXCIpO1xyXG4gIH1cclxuXHJcbiAgbGV0IGhlbHBBY3RpdmUgPSBmYWxzZTtcclxuICBvbk1vdW50KGFzeW5jICgpID0+IHtcclxuICAgIGNvbnN0IGRlZmF1bHREZWNrID0gYCNsYW5kc1xyXG5tb3VudGFpblxyXG4yIHBsYWluc1xyXG4zIHN3YW1wc1xyXG4jIG1haW4gZGVja1xyXG4yMCBibGlnaHRzdGVlbCBjb2xvc3N1c2A7XHJcblxyXG4gICAgdXNlQ29va2llcyA9IENvb2tpZXMuZ2V0KFwidXNlQ29va2llc1wiKTtcclxuXHJcbiAgICBjb25zdCB1cmxQYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKHdpbmRvdy5sb2NhdGlvbi5zZWFyY2gpO1xyXG4gICAgY29uc3Qgc2hhcmVkRGVjayA9IHVybFBhcmFtcy5nZXQoXCJkXCIpO1xyXG5cclxuICAgIGxldCBzdGFydCA9IHVzZUNvb2tpZXMgPyBDb29raWVzLmdldChcImRlY2tcIikgfHwgZGVmYXVsdERlY2sgOiBkZWZhdWx0RGVjaztcclxuXHJcbiAgICBpZiAoc2hhcmVkRGVjaykge1xyXG4gICAgICB1c2VDb29raWVzID0gZmFsc2U7XHJcbiAgICAgIC8qIGNvbnN0IGJ1ZmZlciA9IG5ldyBVaW50OEFycmF5KHNoYXJlZERlY2suc3BsaXQoXCIsXCIpKTtcclxuICAgICogY29uc3QgZGVjb21wcmVzc2VkID0gTFpVVEY4LmRlY29tcHJlc3MoYnVmZmVyKTtcclxuICAgICAgaWYgKGRlY29tcHJlc3NlZCkge1xyXG4gICAgICAgIHN0YXJ0ID0gZGVjb21wcmVzc2VkO1xyXG4gICAgICB9Ki9cclxuICAgIH1cclxuXHJcbiAgICB1cmxQYXJhbXMuZGVsZXRlKFwiZFwiKTtcclxuICAgIHdpbmRvdy5oaXN0b3J5LnJlcGxhY2VTdGF0ZSh7fSwgXCJcIiwgYCR7d2luZG93LmxvY2F0aW9uLnBhdGhuYW1lfWApO1xyXG5cclxuICAgIC8vICAgIHdpbmRvdy5oaXN0b3J5LnJlcGxhY2VTdGF0ZShcclxuICAgIC8vICAge30sXHJcbiAgICAvLyAgICcnLFxyXG4gICAgLy8gICBgJHt3aW5kb3cubG9jYXRpb24ucGF0aG5hbWV9PyR7cGFyYW1zfSR7d2luZG93LmxvY2F0aW9uLmhhc2h9YCxcclxuICAgIC8vIClcclxuXHJcbiAgICAvLyAgaGVscEFjdGl2ZSA9IENvb2tpZXMuZ2V0KFwiaGVscEFjdGl2ZVwiKSA9PSBcInRydWVcIjtcclxuICAgIC8vIGNvbnNvbGUubG9nKFwiaGVscDpcIiwgQ29va2llcy5nZXQoXCJoZWxwQWN0aXZlXCIpKTtcclxuICAgIGNhcmRTZWFyY2hBY3RpdmUgPSBDb29raWVzLmdldChcImNhcmRTZWFyY2hBY3RpdmVcIikgPT0gXCJ0cnVlXCI7XHJcbiAgICBjb25zb2xlLmxvZyhcInNlYXJjaDpcIiwgQ29va2llcy5nZXQoXCJjYXJkU2VhcmNoQWN0aXZlXCIpKTtcclxuICAgIHN0YXRpc3RpY3NBY3RpdmUgPSBDb29raWVzLmdldChcInN0YXRpc3RpY3NBY3RpdmVcIikgPT0gXCJ0cnVlXCI7XHJcbiAgICBjb25zb2xlLmxvZyhcInN0YXRpc3RpY3M6XCIsIENvb2tpZXMuZ2V0KFwic3RhdGlzdGljc0FjdGl2ZVwiKSk7XHJcblxyXG4gICAgc3RhdGlzdGljc0FjdGl2ZTtcclxuICAgIGlucHV0LnZhbHVlID0gc3RhcnQ7XHJcbiAgICByZWxvYWQoKTtcclxuXHJcbiAgICBpcGMub24oXCJsb2FkRGVja1wiLCAoc2VuZGVyLCBkYXRhKSA9PiB7XHJcbiAgICAgIGNvbnNvbGUubG9nKFwiTE9BRElORyBERUNLXCIsIGRhdGEubmFtZSk7XHJcbiAgICAgIGlucHV0LnZhbHVlID0gZGF0YS5kZWNrO1xyXG4gICAgICBkZWNrTmFtZUlucHV0LnZhbHVlID0gKGRhdGEubmFtZSB8fCBcIlwiKS5yZXBsYWNlKFwiLmdkZWNrXCIsIFwiXCIpO1xyXG4gICAgICByZWxvYWQoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8qIGNvbnNvbGUubG9nKFwiU1RTRlNERlwiLCBDb29raWVzLmdldChcImRlY2tcIikpLFxyXG4gICAgICAocHJvbWlzZSA9IENhcmRMb2FkZXIuY3JlYXRlRGVjayhzdGFydCwgKHAsIGEpID0+IHNwKHAsIGEpKSk7Ki9cclxuICB9KTtcclxuXHJcbiAgZnVuY3Rpb24gc2F2ZUFsbFRvQ29va2llcygpIHtcclxuICAgIENvb2tpZXMuc2V0KFwiY2FyZFNlYXJjaEFjdGl2ZVwiLCBjYXJkU2VhcmNoQWN0aXZlKTtcclxuICAgIENvb2tpZXMuc2V0KFwic3RhdGlzdGljc0FjdGl2ZVwiLCBzdGF0aXN0aWNzQWN0aXZlKTtcclxuICAgIENvb2tpZXMuc2V0KFwiZGVja1wiLCBpbnB1dC52YWx1ZSk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBzaGFyZURlY2soKSB7XHJcbiAgICAvKiAgIGlmICghaW5wdXQgfHwgIWlucHV0LnZhbHVlKSB7XHJcbiAgICAgIGFsZXJ0KFwiVGhlIGRlY2sgaXMgZW1wdHksIG5vdGhpbmcgY29waWVkXCIpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCBjb21wcmVzc2VkID0gTFpVVEY4LmNvbXByZXNzKGlucHV0LnZhbHVlIHx8IFwiZW1wdHkgZGVjayBzaGFyZWRcIik7XHJcbiAgICAvL3dpbmRvdy5oaXN0b3J5LnB1c2hTdGF0ZShcInBhZ2UyXCIsIFwiVGl0bGVcIiwgXCI/ZD1cIiArIGNvbXByZXNzZWQpO1xyXG4gICAgY29uc29sZS5sb2coYCR7d2luZG93LmxvY2F0aW9uLnBhdGhuYW1lfT9kPSR7Y29tcHJlc3NlZH1gKTtcclxuXHJcbiAgICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJ0ZXh0YXJlYVwiKTtcclxuICAgIGVsLnZhbHVlID0gYCR7d2luZG93LmxvY2F0aW9uLmhyZWZ9P2Q9JHtjb21wcmVzc2VkfWA7XHJcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGVsKTtcclxuICAgIGVsLnNlbGVjdCgpO1xyXG4gICAgZG9jdW1lbnQuZXhlY0NvbW1hbmQoXCJjb3B5XCIpO1xyXG4gICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChlbCk7XHJcbiAgICBhbGVydChcImxpbmsgdG8gZGVjayBjb3BpZWRcIik7Ki9cclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIG9uVHlwaW5nKCkge1xyXG4gICAgQ29va2llcy5zZXQoXCJkZWNrXCIsIGlucHV0LnZhbHVlLCB7IGV4cGlyZXM6IDcgfSk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBnZXRIZWlnaHQobWFuYSwgZ3JvdXBzKSB7XHJcbiAgICByZXR1cm4gMTAwICogKG1hbmEgLyBNYXRoLm1heCguLi5ncm91cHNbXCJtYW5hQ3VydmVcIl0pKTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIG9wZW5IZWxwKCkge1xyXG4gICAgaGVscEFjdGl2ZSA9ICFoZWxwQWN0aXZlO1xyXG4gICAgLy8gIENvb2tpZXMuc2V0KFwiaGVscEFjdGl2ZVwiLCBoZWxwQWN0aXZlICsgXCJcIik7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiB0b2dnbGVQbGF5VGVzdCgpIHtcclxuICAgIHBsYXlUZXN0ZXJBY3RpdmUgPSAhcGxheVRlc3RlckFjdGl2ZTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHRvZ2dsZVNlYXJjaCgpIHtcclxuICAgIGNhcmRTZWFyY2hBY3RpdmUgPSAhY2FyZFNlYXJjaEFjdGl2ZTtcclxuICAgIENvb2tpZXMuc2V0KFwiY2FyZFNlYXJjaEFjdGl2ZVwiLCBjYXJkU2VhcmNoQWN0aXZlICsgXCJcIik7XHJcbiAgfVxyXG4gIGZ1bmN0aW9uIHRvZ2dsZVN0YXRpc3RpY3MoKSB7XHJcbiAgICBzdGF0aXN0aWNzQWN0aXZlID0gIXN0YXRpc3RpY3NBY3RpdmU7XHJcbiAgICBDb29raWVzLnNldChcInN0YXRpc3RpY3NBY3RpdmVcIiwgc3RhdGlzdGljc0FjdGl2ZSArIFwiXCIpO1xyXG4gIH1cclxuXHJcbiAgbGV0IGhpZ2hsaWdodGVkQ3JlYXR1cmUgPSBcIlwiO1xyXG4gIGZ1bmN0aW9uIGhpZ2hsaWdodENyZWF0dXJlKHR5cGVOYW1lKSB7XHJcbiAgICBpZiAodHlwZU5hbWUgPT0gaGlnaGxpZ2h0ZWRDcmVhdHVyZSkge1xyXG4gICAgICBoaWdobGlnaHRlZENyZWF0dXJlID0gXCJcIjtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgaGlnaGxpZ2h0ZWRDcmVhdHVyZSA9IHR5cGVOYW1lO1xyXG4gICAgfVxyXG4gIH1cclxuPC9zY3JpcHQ+XHJcblxyXG48c3R5bGU+XHJcbiAgLmNvbnRlbnQge1xyXG4gICAgLS1yYWlzaW4tYmxhY2s6IGhzbGEoMjAwLCA4JSwgMTUlLCAxKTtcclxuICAgIC0tcm9tYW4tc2lsdmVyOiBoc2xhKDE5NiwgMTUlLCA2MCUsIDEpO1xyXG4gICAgLS1jb2xvcmxlc3M6IGhzbGEoMCwgMCUsIDg5JSwgMSk7XHJcbiAgICAtLWJsYWNrOiBoc2xhKDgzLCA4JSwgMzglLCAxKTtcclxuICAgIC0td2hpdGU6IGhzbCg0OCwgNjQlLCA4OSUpO1xyXG4gICAgLS1yZWQ6IGhzbGEoMCwgNzElLCA4NCUsIDEpO1xyXG4gICAgLS1ncmVlbjogaHNsYSgxMTQsIDYwJSwgNzUlLCAxKTtcclxuICAgIC0tYmx1ZTogaHNsYSgyMzUsIDU1JSwgODElLCAxKTtcclxuICB9XHJcblxyXG4gIC5jb250ZW50IHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gICAgd2lkdGg6IDEwMCU7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgfVxyXG5cclxuICAuaGVscC1zeW1ib2wge1xyXG4gICAgYm9yZGVyLXJhZGl1czogNTAlO1xyXG4gICAgYm9yZGVyOiAxcHggc29saWQgYmxhY2s7XHJcbiAgICB3aWR0aDogMTZweDtcclxuICAgIGhlaWdodDogMTZweDtcclxuICAgIHRleHQtYWxpZ246IGNlbnRlcjtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIHJpZ2h0OiAxMHB4O1xyXG4gICAgdG9wOiAxMHB4O1xyXG4gICAgY3Vyc29yOiBwb2ludGVyO1xyXG4gIH1cclxuXHJcbiAgLmhlbHAtc3ltYm9sOmhvdmVyIHtcclxuICAgIGJvcmRlci1jb2xvcjogYmx1ZTtcclxuICAgIGNvbG9yOiBibHVlO1xyXG4gIH1cclxuXHJcbiAgLnRvZ2dsZS1zZWFyY2gge1xyXG4gICAgYmFja2dyb3VuZDogYmx1ZTtcclxuICAgIHdpZHRoOiAzMHB4O1xyXG4gICAgaGVpZ2h0OiAzMHB4O1xyXG4gICAgY3Vyc29yOiBwb2ludGVyO1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgbGVmdDogLTMwcHg7XHJcbiAgICB0b3A6IDUwJTtcclxuICAgIHVzZXItc2VsZWN0OiBub25lO1xyXG4gIH1cclxuXHJcbiAgLmhpZGUgLnRvZ2dsZS1zZWFyY2gge1xyXG4gICAgbGVmdDogLTUycHg7XHJcbiAgfVxyXG5cclxuICAuc3RhdGlzdGljcyB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcclxuICB9XHJcbiAgLmlucHV0IHtcclxuICAgIHdpZHRoOiAxMDAlO1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gICAgYm94LXNpemluZzogYm9yZGVyLWJveDtcclxuICAgIHBhZGRpbmc6IDEwcHg7XHJcbiAgICByZXNpemU6IG5vbmU7XHJcbiAgfVxyXG5cclxuICAuY29udHJvbHMge1xyXG4gICAgZmxleC1zaHJpbms6IDA7XHJcbiAgICB3aWR0aDogMzAwcHg7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgICBiYWNrZ3JvdW5kOiBsaWdodGdyYXk7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcclxuICB9XHJcblxyXG4gIC5oZWxwIHtcclxuICAgIHBhZGRpbmc6IDBweCAxMHB4IDEwcHggMTBweDtcclxuICAgIHVzZXItc2VsZWN0OiBub25lO1xyXG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xyXG4gIH1cclxuXHJcbiAgLmdyb3VwLWNvbnRlbnQge1xyXG4gICAgZmxleC1ncm93OiAxO1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtd3JhcDogd3JhcDtcclxuICAgIHRyYW5zaXRpb246IGhlaWdodCA1MDBtcyBlYXNlO1xyXG4gIH1cclxuXHJcbiAgLmdyb3VwLWNvbnRlbnQuaGlkZGVuIHtcclxuICAgIG92ZXJmbG93OiBoaWRkZW47XHJcbiAgICBoZWlnaHQ6IDQ1cHg7XHJcbiAgfVxyXG5cclxuICAuYWxsLXR5cGUtY291bnQge1xyXG4gICAgaGVpZ2h0OiAxMjVweDtcclxuICAgIG92ZXJmbG93OiBhdXRvO1xyXG4gICAgYmFja2dyb3VuZDogbGlnaHRzdGVlbGJsdWU7XHJcbiAgICBwYWRkaW5nOiAxMHB4O1xyXG4gIH1cclxuXHJcbiAgLnR5cGUtc2VsZWN0b3Ige1xyXG4gICAgY3Vyc29yOiBwb2ludGVyO1xyXG4gIH1cclxuXHJcbiAgLnR5cGUtc2VsZWN0b3I6bm90KC5oaWdobGlnaHRlZC1jcmVhdHVyZSk6aG92ZXIge1xyXG4gICAgYmFja2dyb3VuZDogYWxpY2VibHVlO1xyXG4gIH1cclxuXHJcbiAgLmhpZ2hsaWdodGVkLWNyZWF0dXJlIHtcclxuICAgIGJhY2tncm91bmQ6IHN0ZWVsYmx1ZTtcclxuICB9XHJcblxyXG4gIC5wbGF5LXRlc3RlciB7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgICBmbGV4LWdyb3c6IDE7XHJcbiAgICBiYWNrZ3JvdW5kOiB3aGl0ZTtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgcmlnaHQ6IDA7XHJcbiAgICB3aWR0aDogMTAwJTtcclxuICAgIHotaW5kZXg6IDE1MDtcclxuICAgIGJveC1zaGFkb3c6IDBweCAwcHggMTBweCBibGFjaztcclxuICB9XHJcblxyXG4gIC5wbGF5LXRlc3Rlci5oaWRlIHtcclxuICAgIGRpc3BsYXk6IG5vbmU7XHJcbiAgfVxyXG5cclxuICAuY2FyZC1zZWFyY2gge1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gICAgZmxleC1ncm93OiAxO1xyXG4gICAgYmFja2dyb3VuZDogd2hpdGU7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIHJpZ2h0OiAwO1xyXG4gICAgd2lkdGg6IDMzJTtcclxuICAgIHotaW5kZXg6IDEwMDtcclxuICAgIGJveC1zaGFkb3c6IDBweCAwcHggMTBweCBibGFjaztcclxuICB9XHJcblxyXG4gIC5jYXJkLXNlYXJjaC5oaWRlIHtcclxuICAgIHJpZ2h0OiAtMzMlO1xyXG4gIH1cclxuXHJcbiAgLnNlYXJjaC1wYXJhbXMge1xyXG4gICAgZmxleC1zaHJpbms6IDA7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcclxuICB9XHJcblxyXG4gIC5zZWFyY2gtcmVzdWx0IHtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICAgIGZsZXgtZ3JvdzogMTtcclxuICAgIGJhY2tncm91bmQ6IHdoaXRlO1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgICBvdmVyZmxvdzogYXV0bztcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICAgIHVzZXItc2VsZWN0OiBub25lO1xyXG4gICAgZmxleC13cmFwOiB3cmFwO1xyXG4gIH1cclxuXHJcbiAgLmRpc3BsYXkge1xyXG4gICAgZmxleC1ncm93OiAxO1xyXG4gICAgYmFja2dyb3VuZDogZ3JheTtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gICAgZmxleC13cmFwOiBub3dyYXA7XHJcbiAgICBvdmVyZmxvdzogYXV0bztcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICAgIHVzZXItc2VsZWN0OiBub25lO1xyXG4gIH1cclxuXHJcbiAgLmxvYWRpbmctd3JhcHBlciB7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICBsZWZ0OiA1MCU7XHJcbiAgICB0b3A6IDA7XHJcbiAgICBib3R0b206IDA7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgYWxpZ24taXRlbXM6IGNlbnRlcjtcclxuICB9XHJcblxyXG4gIC5lbnRyeSB7XHJcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgICBwYWRkaW5nOiAxMHB4O1xyXG4gICAgZmxleC1zaHJpbms6IDA7XHJcbiAgfVxyXG5cclxuICAuc2hvcGluZyB7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICB6LWluZGV4OiAxMDtcclxuICAgIGZvbnQtc2l6ZTogM2VtO1xyXG4gICAgdGV4dC1zaGFkb3c6IDBweCAwcHggNnB4IGJsYWNrO1xyXG4gICAgdGV4dC1hbGlnbjogY2VudGVyO1xyXG4gICAgYm90dG9tOiAxMCU7XHJcbiAgICByaWdodDogMTAlO1xyXG4gICAgZGlzcGxheTogbm9uZTtcclxuICB9XHJcblxyXG4gIC5lbnRyeTpob3ZlciAuc2hvcGluZyB7XHJcbiAgICBkaXNwbGF5OiBibG9jaztcclxuICB9XHJcblxyXG4gIC5zaG9waW5nIC5saW5rIHtcclxuICAgIHRleHQtZGVjb3JhdGlvbjogbm9uZTtcclxuICB9XHJcblxyXG4gIC5zaG9waW5nIC5saW5rOmhvdmVyIHtcclxuICAgIGNvbG9yOiB0cmFuc3BhcmVudDtcclxuICAgIHRleHQtc2hhZG93OiAwIDAgMCBibHVlO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQge1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgcmdiKDIyLCAyMiwgMjIpO1xyXG4gICAgYm9yZGVyLXJhZGl1czogMTBweDtcclxuICAgIG91dGxpbmU6IDA7XHJcbiAgICBib3gtc2hhZG93OiAwcHggMHB4IDEwcHggYmxhY2s7XHJcbiAgfVxyXG5cclxuICAuY2FyZC5iYW5uZWQge1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgcmVkO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQuaGlnaGxpZ2h0ZWQge1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgeWVsbG93O1xyXG4gIH1cclxuXHJcbiAgLmNhcmQudHlwZS1oaWdobGlnaHQge1xyXG4gICAgYm9yZGVyOiA2cHggc29saWQgYmx1ZXZpb2xldDtcclxuICB9XHJcblxyXG4gIC5jYXJkOmhvdmVyIHtcclxuICAgIGJvcmRlcjogNnB4IHNvbGlkIGJsdWU7XHJcbiAgICBjdXJzb3I6IHBvaW50ZXI7XHJcbiAgfVxyXG5cclxuICAuY2FyZC1jb250ZXh0LW1lbnUge1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgei1pbmRleDogMTAwO1xyXG4gICAgYmFja2dyb3VuZDogcmdiYSgyNTUsIDI1NSwgMjU1LCAwLjcpO1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gICAgd2lkdGg6IDEwMCU7XHJcbiAgICAvKiBwYWRkaW5nOiAxMHB4OyAqL1xyXG4gICAgLyogbWFyZ2luOiAxMHB4OyAqL1xyXG4gICAgbWFyZ2luLWxlZnQ6IC0zcHg7XHJcbiAgICBtYXJnaW4tdG9wOiAtM3B4O1xyXG4gICAgb3ZlcmZsb3c6IGF1dG87XHJcbiAgfVxyXG5cclxuICAuY2FyZC1jb250ZXh0LWVudHJ5IHtcclxuICAgIG1hcmdpbjogMTBweDtcclxuICAgIGZvbnQtd2VpZ2h0OiBib2xkO1xyXG4gICAgYmFja2dyb3VuZDogd2hpdGU7XHJcbiAgICBwYWRkaW5nOiA1cHg7XHJcbiAgICBib3JkZXItcmFkaXVzOiA5cHg7XHJcbiAgICBib3gtc2hhZG93OiAwIDAgNnB4IGJsYWNrO1xyXG4gICAgY3Vyc29yOiBwb2ludGVyO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQtY29udGV4dC1lbnRyeTpob3ZlciB7XHJcbiAgICBiYWNrZ3JvdW5kOiB3aGVhdDtcclxuICB9XHJcblxyXG4gIC5wcmljZSxcclxuICAuYmFubmVkLXRleHQsXHJcbiAgLmNvdW50IHtcclxuICAgIGZvbnQtc2l6ZTogMzRweDtcclxuICAgIHRleHQtc2hhZG93OiAwcHggMHB4IDlweCBibGFjaztcclxuICAgIGNvbG9yOiByZWQ7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICB6LWluZGV4OiAxMDA7XHJcbiAgICBmb250LXdlaWdodDogYm9sZDtcclxuICAgIGxlZnQ6IDM0cHg7XHJcbiAgfVxyXG5cclxuICAuYmFubmVkLXRleHQge1xyXG4gICAgZm9udC1zaXplOiAxMDAlO1xyXG4gICAgdGV4dC1zaGFkb3c6IDBweCAwcHggOXB4IGJsYWNrO1xyXG4gICAgY29sb3I6IHJlZDtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcclxuICAgIHotaW5kZXg6IDEwMDtcclxuICAgIGZvbnQtd2VpZ2h0OiBib2xkO1xyXG4gICAgbGVmdDogMTclO1xyXG4gIH1cclxuICAuY291bnQge1xyXG4gICAgdG9wOiAxNjVweDtcclxuICB9XHJcblxyXG4gIC5wcmljZSB7XHJcbiAgICBib3R0b206IDdweDtcclxuICAgIGNvbG9yOiB3aGVhdDtcclxuICAgIGZvbnQtc2l6ZTogMTJweDtcclxuICAgIGJhY2tncm91bmQ6IGJsYWNrO1xyXG4gICAgbGVmdDogNDUlO1xyXG4gICAgZm9udC13ZWlnaHQ6IG5vcm1hbDtcclxuICB9XHJcblxyXG4gIC5ncm91cC1oZWFkZXIge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGJhY2tncm91bmQ6IGRhcmtncmV5O1xyXG4gICAgLyogcGFkZGluZzogOHB4OyAqL1xyXG4gICAgbWFyZ2luOiA4cHggMDtcclxuICAgIGJveC1zaGFkb3c6IDBweCAwcHggOHB4IGJsYWNrO1xyXG4gICAgd2lkdGg6IDEwMCU7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gIH1cclxuXHJcbiAgLmdyb3VwLWhlYWRlciBoMiB7XHJcbiAgICBwYWRkaW5nOiAwIDI1cHg7XHJcbiAgICBtYXJnaW46IDBweDtcclxuICB9XHJcblxyXG4gIC5ncm91cC1zdGF0aXN0aWNzIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gIH1cclxuXHJcbiAgLm1hbmEtcHJvcG9zYWwsXHJcbiAgLm1hbmEtZGV2b3Rpb24ge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgfVxyXG5cclxuICAuZGVjay12YWx1ZSxcclxuICAuZ3JvdXAtdmFsdWUge1xyXG4gICAgcGFkZGluZzogNXB4O1xyXG4gICAgY29sb3I6IGJsYWNrO1xyXG4gICAgYm9yZGVyLXJhZGl1czogNTAlO1xyXG4gICAgd2lkdGg6IDE1cHg7XHJcbiAgICBoZWlnaHQ6IDE1cHg7XHJcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7XHJcbiAgICBtYXJnaW46IDVweDtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7XHJcbiAgICBhbGlnbi1pdGVtczogY2VudGVyO1xyXG4gICAgZm9udC1zaXplOiAxMXB4O1xyXG4gICAgZm9udC13ZWlnaHQ6IGJvbGQ7XHJcbiAgfVxyXG4gIC5ibHVlIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLWJsdWUpO1xyXG4gIH1cclxuICAuYmxhY2sge1xyXG4gICAgY29sb3I6IHdoaXRlO1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0tYmxhY2spO1xyXG4gIH1cclxuICAucmVkIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IHZhcigtLXJlZCk7XHJcbiAgfVxyXG4gIC53aGl0ZSB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS13aGl0ZSk7XHJcbiAgfVxyXG4gIC5ncmVlbiB7XHJcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiB2YXIoLS1ncmVlbik7XHJcbiAgfVxyXG4gIC5jb2xvcmxlc3Mge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogdmFyKC0tY29sb3JsZXNzKTtcclxuICB9XHJcbiAgLmdlbmVyaWMge1xyXG4gICAgYmFja2dyb3VuZC1jb2xvcjogZ29sZGVucm9kO1xyXG4gIH1cclxuICAuc3VtIHtcclxuICAgIGJhY2tncm91bmQtY29sb3I6IGdvbGRlbnJvZDtcclxuICB9XHJcblxyXG4gIC5jb2xvci1wYXJhbSB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1kaXJlY3Rpb246IHJvdztcclxuICB9XHJcblxyXG4gIC5tYW5hLWN1cnZlIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xyXG4gIH1cclxuXHJcbiAgLmFsbC1jdXJ2ZXMge1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZ3JvdzogMTtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgICBoZWlnaHQ6IDgwcHg7XHJcbiAgfVxyXG5cclxuICAuYWxsLWxhYmVscyB7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgZmxleC1zaHJpbms6IDA7XHJcbiAgICBmbGV4LWRpcmVjdGlvbjogcm93O1xyXG4gIH1cclxuXHJcbiAgLmN1cnZlLWVsZW1lbnQge1xyXG4gICAgd2lkdGg6IDIwcHg7XHJcbiAgICBkaXNwbGF5OiBmbGV4O1xyXG4gICAgcG9zaXRpb246IGFic29sdXRlO1xyXG4gICAgYm90dG9tOiAwO1xyXG4gICAgYmFja2dyb3VuZDogZ3JheTtcclxuICAgIC8qIHZlcnRpY2FsLWFsaWduOiBtaWRkbGU7ICovXHJcbiAgICBhbGlnbi1pdGVtczogY2VudGVyO1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gIH1cclxuXHJcbiAgLmN1cnZlLWxhYmVsIHtcclxuICAgIHdpZHRoOiAyMHB4O1xyXG4gIH1cclxuICAuY3VydmUtd3JhcHBlciB7XHJcbiAgICB3aWR0aDogMjBweDtcclxuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcclxuICAgIGN1cnNvcjogcG9pbnRlcjtcclxuICB9XHJcblxyXG4gIC5jdXJ2ZS1lbGVtZW50OmhvdmVyIHtcclxuICAgIGJhY2tncm91bmQ6IGxpZ2h0Y29yYWw7XHJcbiAgfVxyXG5cclxuICAuaGlnaGxpZ2h0ZWQgLmN1cnZlLWVsZW1lbnQge1xyXG4gICAgYmFja2dyb3VuZDogbGlnaHRibHVlO1xyXG4gIH1cclxuXHJcbiAgLmN1cnZlLWxhYmVsLmhpZ2hsaWdodGVkIHtcclxuICAgIGJhY2tncm91bmQ6IGxpZ2h0Ymx1ZTtcclxuICB9XHJcblxyXG4gIC5jdXJ2ZS1sYWJlbDpob3ZlciB7XHJcbiAgICBiYWNrZ3JvdW5kOiBsaWdodGNvcmFsO1xyXG4gIH1cclxuXHJcbiAgaDQge1xyXG4gICAgbWFyZ2luLXRvcDogNXB4O1xyXG4gICAgbWFyZ2luLWJvdHRvbTogNXB4O1xyXG4gIH1cclxuXHJcbiAgLmxkcy1yaXBwbGUge1xyXG4gICAgZGlzcGxheTogaW5saW5lLWJsb2NrO1xyXG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xyXG4gICAgd2lkdGg6IDgwcHg7XHJcbiAgICBoZWlnaHQ6IDgwcHg7XHJcbiAgfVxyXG4gIC5sZHMtcmlwcGxlIGRpdiB7XHJcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XHJcbiAgICBib3JkZXI6IDRweCBzb2xpZCAjZmZmO1xyXG4gICAgb3BhY2l0eTogMTtcclxuICAgIGJvcmRlci1yYWRpdXM6IDUwJTtcclxuICAgIGFuaW1hdGlvbjogbGRzLXJpcHBsZSAxcyBjdWJpYy1iZXppZXIoMCwgMC4yLCAwLjgsIDEpIGluZmluaXRlO1xyXG4gIH1cclxuXHJcbiAgLmNhcmQtc2VhcmNoIC5sZHMtcmlwcGxlIGRpdiB7XHJcbiAgICBib3JkZXI6IDRweCBzb2xpZCBibGFjaztcclxuICB9XHJcblxyXG4gIC5sZHMtcmlwcGxlIGRpdjpudGgtY2hpbGQoMikge1xyXG4gICAgYW5pbWF0aW9uLWRlbGF5OiAtMC41cztcclxuICB9XHJcbiAgQGtleWZyYW1lcyBsZHMtcmlwcGxlIHtcclxuICAgIDAlIHtcclxuICAgICAgdG9wOiAzNnB4O1xyXG4gICAgICBsZWZ0OiAzNnB4O1xyXG4gICAgICB3aWR0aDogMDtcclxuICAgICAgaGVpZ2h0OiAwO1xyXG4gICAgICBvcGFjaXR5OiAxO1xyXG4gICAgfVxyXG4gICAgMTAwJSB7XHJcbiAgICAgIHRvcDogMHB4O1xyXG4gICAgICBsZWZ0OiAwcHg7XHJcbiAgICAgIHdpZHRoOiA3MnB4O1xyXG4gICAgICBoZWlnaHQ6IDcycHg7XHJcbiAgICAgIG9wYWNpdHk6IDA7XHJcbiAgICB9XHJcbiAgfVxyXG48L3N0eWxlPlxyXG5cclxuPHN2ZWx0ZTp3aW5kb3dcclxuICBvbjptb3VzZXVwPXtvbk1haW5Nb3VzZURvd259XHJcbiAgb246Y29udGV4dG1lbnV8cHJldmVudERlZmF1bHQ9eygpID0+IGZhbHNlfVxyXG4gIG9uOmtleXVwPXttYWluS2V5VXB9XHJcbiAgb246a2V5ZG93bj17bWFpbktleURvd259IC8+XHJcbjxkaXYgY2xhc3M9XCJjb250ZW50XCI+XHJcbiAgPGRpdiBjbGFzcz1cImNvbnRyb2xzXCI+XHJcbiAgICA8ZGl2IGNsYXNzPVwiaGVscFwiPlxyXG4gICAgICA8ZGl2IGNsYXNzPVwiaGVscC1zeW1ib2xcIiBvbjpjbGljaz17b3BlbkhlbHB9Pj88L2Rpdj5cclxuICAgICAgeyNpZiBoZWxwQWN0aXZlfVxyXG4gICAgICAgIDxoND5Ib3cgdG8gdXNlOjwvaDQ+XHJcbiAgICAgICAgPHA+cGFzdGUgeW91ciBkZWNrIHRvIHRoZSBmb2xsb3dpbmcgaW5wdXQuPC9wPlxyXG4gICAgICAgIDx1bD5cclxuICAgICAgICAgIDxsaT5cclxuICAgICAgICAgICAgd2hlbiBhIGxpbmUgc3RhcnRzIHdpdGggXCIjXCIgaXQgd2lsbCBiZSBpbnRlcnByZXRlZCBhcyBoZWFkbGluZVxyXG4gICAgICAgICAgPC9saT5cclxuICAgICAgICAgIDxsaT5cclxuICAgICAgICAgICAgYSBjYXJkIGNhbiBiZSBlbnRlcmVkIHdpdGggYSBsZWFkaW5nIGNvdW50LCBvciBqdXN0IHdpdGggaXRzIG5hbWVcclxuICAgICAgICAgIDwvbGk+XHJcbiAgICAgICAgICA8bGk+dXNlIHRoZSBcIkVTQ1wiIGtleSB0byByZWFsb2FkIHRoZSBwcmV2aWV3PC9saT5cclxuICAgICAgICAgIDxsaT5kb3VibGVjbGljayBhIGNhcmQgdG8gcmVtb3ZlIGl0PC9saT5cclxuICAgICAgICA8L3VsPlxyXG4gICAgICAgIDxwPk5PVEU6IHdlIHVzZSBjb29raWVzIHRvIHN0b3JlIHlvdXIgZGVjayBhZnRlciByZWxvYWQuPC9wPlxyXG4gICAgICAgIDxwPk5PVEU6IFRoaXMgaXMgbm90IGFuIG9mZmljaWFsIE1hZ2ljIHByb2R1a3QuPC9wPlxyXG4gICAgICB7L2lmfVxyXG5cclxuICAgICAgeyNhd2FpdCBwcm9taXNlfVxyXG5cclxuICAgICAgICA8ZGl2PmxvYWRpbmc6IHtwcm9ncmVzc30ve2FsbH08L2Rpdj5cclxuICAgICAgezp0aGVuIGdyb3Vwc31cclxuXHJcbiAgICAgICAgeyNpZiAhaGVscEFjdGl2ZX1cclxuICAgICAgICAgIDxoND5HZW5lcmFsPC9oND5cclxuXHJcbiAgICAgICAgICA8ZGl2PlRvdGFsIGNhcmRzOiB7Z3JvdXBzWydjYXJkQ291bnQnXX08L2Rpdj5cclxuICAgICAgICAgIDxkaXY+XHJcbiAgICAgICAgICAgIExhbmRzOiB7Z3JvdXBzWydsYW5kQ291bnQnXX0gTm9ubGFuZHM6IHtncm91cHNbJ2NhcmRDb3VudCddIC0gZ3JvdXBzWydsYW5kQ291bnQnXX1cclxuICAgICAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgY2xhc3M9XCJ0eXBlLXNlbGVjdG9yXCJcclxuICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodENyZWF0dXJlKCdjcmVhdHVyZScpfVxyXG4gICAgICAgICAgICBjbGFzczpoaWdobGlnaHRlZC1jcmVhdHVyZT17J2NyZWF0dXJlJyA9PSBoaWdobGlnaHRlZENyZWF0dXJlfT5cclxuICAgICAgICAgICAgQ3JlYXR1cmVzOiB7Z3JvdXBzWydjcmVhdHVyZUNvdW50J119XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgY2xhc3M9XCJ0eXBlLXNlbGVjdG9yXCJcclxuICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodENyZWF0dXJlKCdpbnN0YW50Jyl9XHJcbiAgICAgICAgICAgIGNsYXNzOmhpZ2hsaWdodGVkLWNyZWF0dXJlPXsnaW5zdGFudCcgPT0gaGlnaGxpZ2h0ZWRDcmVhdHVyZX0+XHJcbiAgICAgICAgICAgIEluc3RhbnRzOiB7Z3JvdXBzWydpbnN0YW50Q291bnQnXX1cclxuICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICBjbGFzcz1cInR5cGUtc2VsZWN0b3JcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17KCkgPT4gaGlnaGxpZ2h0Q3JlYXR1cmUoJ3NvcmNlcnknKX1cclxuICAgICAgICAgICAgY2xhc3M6aGlnaGxpZ2h0ZWQtY3JlYXR1cmU9eydzb3JjZXJ5JyA9PSBoaWdobGlnaHRlZENyZWF0dXJlfT5cclxuICAgICAgICAgICAgU29yY2VyaWVzOiB7Z3JvdXBzWydzb3JjZXJ5Q291bnQnXX1cclxuICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICBjbGFzcz1cInR5cGUtc2VsZWN0b3JcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17KCkgPT4gaGlnaGxpZ2h0Q3JlYXR1cmUoJ2VuY2hhbnRtZW50Jyl9XHJcbiAgICAgICAgICAgIGNsYXNzOmhpZ2hsaWdodGVkLWNyZWF0dXJlPXsnZW5jaGFudG1lbnQnID09IGhpZ2hsaWdodGVkQ3JlYXR1cmV9PlxyXG4gICAgICAgICAgICBFbmNoYW50bWVudHM6IHtncm91cHNbJ2VuY2hhbnRtZW50Q291bnQnXX1cclxuICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICBjbGFzcz1cInR5cGUtc2VsZWN0b3JcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17KCkgPT4gaGlnaGxpZ2h0Q3JlYXR1cmUoJ2FydGlmYWN0Jyl9XHJcbiAgICAgICAgICAgIGNsYXNzOmhpZ2hsaWdodGVkLWNyZWF0dXJlPXsnYXJ0aWZhY3QnID09IGhpZ2hsaWdodGVkQ3JlYXR1cmV9PlxyXG4gICAgICAgICAgICBBcnRpZmFjdHM6IHtncm91cHNbJ2FydGlmYWN0Q291bnQnXX1cclxuICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgPGRpdlxyXG4gICAgICAgICAgICBjbGFzcz1cInR5cGUtc2VsZWN0b3JcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17KCkgPT4gaGlnaGxpZ2h0Q3JlYXR1cmUoJ3BsYW5lc3dhbGtlcicpfVxyXG4gICAgICAgICAgICBjbGFzczpoaWdobGlnaHRlZC1jcmVhdHVyZT17J3BsYW5lc3dhbGtlcicgPT0gaGlnaGxpZ2h0ZWRDcmVhdHVyZX0+XHJcbiAgICAgICAgICAgIFBsYW5lc3dhbGtlcjoge2dyb3Vwc1sncGxhbmVzd2Fsa2VyQ291bnQnXX1cclxuICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgPGRpdiBjbGFzcz1cImFsbC10eXBlLWNvdW50XCI+XHJcbiAgICAgICAgICAgIHsjZWFjaCBncm91cHNbJ3R5cGVOYW1lcyddIGFzIHR5cGVOYW1lfVxyXG4gICAgICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgICAgIGNsYXNzPVwidHlwZS1zZWxlY3RvclwiXHJcbiAgICAgICAgICAgICAgICBvbjpjbGljaz17KCkgPT4gaGlnaGxpZ2h0Q3JlYXR1cmUodHlwZU5hbWUpfVxyXG4gICAgICAgICAgICAgICAgY2xhc3M6aGlnaGxpZ2h0ZWQtY3JlYXR1cmU9e3R5cGVOYW1lID09IGhpZ2hsaWdodGVkQ3JlYXR1cmV9PlxyXG4gICAgICAgICAgICAgICAge3R5cGVOYW1lfToge2dyb3Vwc1sndHlwZUNvdW50cyddW3R5cGVOYW1lXX1cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgey9lYWNofVxyXG5cclxuICAgICAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgICAgIDxkaXY+Q29zdDoge2dyb3Vwcy5jb3N0LnRvRml4ZWQoMikgKyAnJCd9PC9kaXY+XHJcblxyXG4gICAgICAgICAgeyNpZiBzdGF0aXN0aWNzQWN0aXZlfVxyXG4gICAgICAgICAgICA8ZGl2IGNsYXNzPVwic3RhdGlzdGljc1wiPlxyXG4gICAgICAgICAgICAgIDxoND5EZXZvdGlvbjwvaDQ+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cIm1hbmEtZGV2b3Rpb25cIj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGJsdWVcIj57Z3JvdXBzWydtYW5hJ10uYmx1ZX08L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGJsYWNrXCI+e2dyb3Vwc1snbWFuYSddLmJsYWNrfTwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgcmVkXCI+e2dyb3Vwc1snbWFuYSddLnJlZH08L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIHdoaXRlXCI+e2dyb3Vwc1snbWFuYSddLndoaXRlfTwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgZ3JlZW5cIj57Z3JvdXBzWydtYW5hJ10uZ3JlZW59PC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVjay12YWx1ZSBjb2xvcmxlc3NcIj5cclxuICAgICAgICAgICAgICAgICAge2dyb3Vwc1snbWFuYSddLmNvbG9ybGVzc31cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgICAgICAgICA8aDQ+R2VuZXJpYyBNYW5hPC9oND5cclxuICAgICAgICAgICAgICA8ZGl2PlJlbWFpbmluZyBnZW5lcmljIG1hbmEgY29zdHM6e2dyb3Vwc1snbWFuYSddLmdlbmVyaWN9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdj5DTUMtTWFuYS1TdW06e2dyb3Vwc1snbWFuYSddLnN1bX08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2PlxyXG4gICAgICAgICAgICAgICAgQXZlcmFnZSBDTUMgcGVyIE5vbmxhbmQ6IHtncm91cHNbJ2F2ZXJhZ2VNYW5hJ10udG9GaXhlZCgyKX1cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICA8aDQ+U3VnZ2VzdGVkIE1hbmEgRGlzdHJpYnV0aW9uPC9oND5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwibWFuYS1wcm9wb3NhbFwiPlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgYmx1ZVwiPlxyXG4gICAgICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10uYmx1ZSAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIGJsYWNrXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS5ibGFjayAqIGdyb3Vwc1snbGFuZENvdW50J10pLnRvRml4ZWQoMSl9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZWNrLXZhbHVlIHJlZFwiPlxyXG4gICAgICAgICAgICAgICAgICB7KGdyb3Vwc1snbWFuYVByb3Bvc2FsJ10ucmVkICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgd2hpdGVcIj5cclxuICAgICAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLndoaXRlICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgZ3JlZW5cIj5cclxuICAgICAgICAgICAgICAgICAgeyhncm91cHNbJ21hbmFQcm9wb3NhbCddLmdyZWVuICogZ3JvdXBzWydsYW5kQ291bnQnXSkudG9GaXhlZCgxKX1cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImRlY2stdmFsdWUgY29sb3JsZXNzXCI+XHJcbiAgICAgICAgICAgICAgICAgIHsoZ3JvdXBzWydtYW5hUHJvcG9zYWwnXS5jb2xvcmxlc3MgKiBncm91cHNbJ2xhbmRDb3VudCddKS50b0ZpeGVkKDEpfVxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgPGg0Pk1hbmEgQ3VydmU8L2g0PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJtYW5hLWN1cnZlXCI+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiYWxsLWN1cnZlc1wiPlxyXG4gICAgICAgICAgICAgICAgICB7I2VhY2ggZ3JvdXBzWydtYW5hQ3VydmUnXSBhcyBtYW5hLCBpfVxyXG4gICAgICAgICAgICAgICAgICAgIHsjaWYgbWFuYSA+IDB9XHJcbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiY3VydmUtd3JhcHBlclwiXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzOmhpZ2hsaWdodGVkPXtkZXZvdGlvbkhpZ2hsaWdodCA9PSBpfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBvbjpjbGljaz17KCkgPT4gaGlnaGxpZ2h0RGV2b3Rpb24oaSl9PlxyXG4gICAgICAgICAgICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJjdXJ2ZS1lbGVtZW50XCJcclxuICAgICAgICAgICAgICAgICAgICAgICAgICBzdHlsZT17J2hlaWdodDonICsgZ2V0SGVpZ2h0KG1hbmEsIGdyb3VwcykgKyAnJTsnfT5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICB7bWFuYSB8fCAnJ31cclxuICAgICAgICAgICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgICAgICB7L2lmfVxyXG4gICAgICAgICAgICAgICAgICB7L2VhY2h9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiYWxsLWxhYmVsc1wiPlxyXG4gICAgICAgICAgICAgICAgICB7I2VhY2ggZ3JvdXBzWydtYW5hQ3VydmUnXSBhcyBtYW5hLCBpfVxyXG4gICAgICAgICAgICAgICAgICAgIHsjaWYgbWFuYSA+IDB9XHJcbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiY3VydmUtbGFiZWxcIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzczpoaWdobGlnaHRlZD17ZGV2b3Rpb25IaWdobGlnaHQgPT0gaX1cclxuICAgICAgICAgICAgICAgICAgICAgICAgb246Y2xpY2s9eygpID0+IGhpZ2hsaWdodERldm90aW9uKGkpfT5cclxuICAgICAgICAgICAgICAgICAgICAgICAge2l9XHJcbiAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgICAgICB7L2lmfVxyXG4gICAgICAgICAgICAgICAgICB7L2VhY2h9XHJcbiAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICB7L2lmfVxyXG4gICAgICAgIHsvaWZ9XHJcbiAgICAgICAgPGRpdj5cclxuICAgICAgICAgIHNlYXJjaDpcclxuICAgICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgICBiaW5kOnRoaXM9e2RlY2tTZWFyY2hJbnB1dH1cclxuICAgICAgICAgICAgdGl0bGU9XCJlLmcuOiBzYWNyaWZpY2UgYSAoYXJ0aWZhY3R8Y3JlYXR1cmUpXCJcclxuICAgICAgICAgICAgb246a2V5dXA9eygpID0+IGNoYW5nZURlY2tTZWFyY2goZ3JvdXBzKX0gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgezpjYXRjaCBlcnJvcn1cclxuICAgICAgICB7ZXJyb3J9XHJcbiAgICAgIHsvYXdhaXR9XHJcbiAgICAgIEZvcm1hdDpcclxuICAgICAgPHNlbGVjdFxyXG4gICAgICAgIGJpbmQ6dGhpcz17Zm9ybWF0fVxyXG4gICAgICAgIG9uOmJsdXI9e3JlbG9hZH1cclxuICAgICAgICBvbjpjaGFuZ2U9e3JlbG9hZH1cclxuICAgICAgICB0aXRsZT1cInNlbGVjdCB0aGUgbGVnYWxpdHkgY2hlY2tlclwiPlxyXG4gICAgICAgIDxvcHRpb24gc2VsZWN0ZWQ+Y29tbWFuZGVyPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5icmF3bDwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+ZHVlbDwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+ZnV0dXJlPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5oaXN0b3JpYzwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+bGVnYWN5PC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5tb2Rlcm48L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPm9sZHNjaG9vbDwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+cGF1cGVyPC9vcHRpb24+XHJcbiAgICAgICAgPG9wdGlvbj5wZW5ueTwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+cGlvbmVlcjwvb3B0aW9uPlxyXG4gICAgICAgIDxvcHRpb24+c3RhbmRhcmQ8L29wdGlvbj5cclxuICAgICAgICA8b3B0aW9uPnZpbnRhZ2U8L29wdGlvbj5cclxuICAgICAgPC9zZWxlY3Q+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJzbGlkZWNvbnRhaW5lclwiPlxyXG4gICAgICAgIFNjYWxlOlxyXG4gICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgdHlwZT1cInJhbmdlXCJcclxuICAgICAgICAgIG1pbj1cIjI1XCJcclxuICAgICAgICAgIG1heD1cIjEwMFwiXHJcbiAgICAgICAgICBiaW5kOnZhbHVlPXtzY2FsaW5nfVxyXG4gICAgICAgICAgdGl0bGU9XCJzY2FsZXMgdGhlIGNhcmQgc2l6ZSBpbiB0aGUgcmlnaHQgdmlld1wiIC8+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgICA8ZGl2IGNsYXNzPVwic2F2ZS1jb250YWluZXJcIj5cclxuICAgICAgICBTYXZlIDpcclxuICAgICAgICA8aW5wdXRcclxuICAgICAgICAgIGJpbmQ6dGhpcz17ZGVja05hbWVJbnB1dH1cclxuICAgICAgICAgIG9uOmtleXVwPXtvbkRlY2tOYW1lVHlwZX1cclxuICAgICAgICAgIHZhbHVlPXtDb29raWVzLmdldCgnZGVja05hbWUnKSB8fCAndW5rbm93bl9kZWNrJ31cclxuICAgICAgICAgIHRpdGxlPVwiVGhlIG5hbWUgb2YgdGhlIGRlY2sgZm9yIHNhdmluZ1wiIC8+XHJcbiAgICAgICAgPGJ1dHRvblxyXG4gICAgICAgICAgb246Y2xpY2s9e3NhdmVEZWNrfVxyXG4gICAgICAgICAgdGl0bGU9XCJ0aGlzIHdpbGwgZG93bmxvYWQgeW91IGEgZmlsZSwgY2FsbGVkIGxpa2UgeW91IHByb3ZpZGUgaW4gdGhlXHJcbiAgICAgICAgICBkZWNrXCI+XHJcbiAgICAgICAgICBzYXZlXHJcbiAgICAgICAgPC9idXR0b24+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgICA8YnV0dG9uXHJcbiAgICAgICAgb246Y2xpY2s9e3RvZ2dsZVN0YXRpc3RpY3N9XHJcbiAgICAgICAgdGl0bGU9XCJ0b2dnbGVzIHRoZSB2aXNpYmlsaXR5IG9mIHRoZSBzdGF0aXN0aWNrc1wiPlxyXG4gICAgICAgIHtzdGF0aXN0aWNzQWN0aXZlID8gJ2hpZGUgc3RhdGlzdGljcycgOiAnc2hvdyBzdGF0aXN0aWNzJ31cclxuICAgICAgPC9idXR0b24+XHJcblxyXG4gICAgICA8YnV0dG9uIG9uOmNsaWNrPXt0b2dnbGVQbGF5VGVzdH0gdGl0bGU9XCJ0ZXN0IHlvdXIgZGVja1wiPnBsYXl0ZXN0PC9idXR0b24+XHJcblxyXG4gICAgICA8YnV0dG9uXHJcbiAgICAgICAgb246Y2xpY2s9e3NvcnREZWNrU3RyaW5nfVxyXG4gICAgICAgIHRpdGxlPVwidGhpcyBzb3J0cyB0aGUgZGVjayB0byBsYW5kcyBzcGVsbHMgYW5kIGNyZWF0dXJlcyAtTk9URTogeW91clxyXG4gICAgICAgIGdyb3VwcyB3aWxsIGJlIHJlcGxhY2VkXCI+XHJcbiAgICAgICAgc29ydFxyXG4gICAgICA8L2J1dHRvbj5cclxuICAgICAgPGJ1dHRvblxyXG4gICAgICAgIG9uOmNsaWNrPXtjb3B5RGVja31cclxuICAgICAgICB0aXRsZT1cInRoaXMgY29waWVzIHRoZSBkZWNrIHdpdGhvdXQgZ3JvdXBzIGFuZCBzdHVmZiB0byB5b3VyIGNsaXBib2FyZFwiPlxyXG4gICAgICAgIGNsZWFuIGNvcHlcclxuICAgICAgPC9idXR0b24+XHJcbiAgICAgIDxidXR0b25cclxuICAgICAgICBvbjpjbGljaz17Y2xlYW5TdHJpbmd9XHJcbiAgICAgICAgdGl0bGU9XCJjbGVhbnMgdGhlIGlucHV0IHN0cmluZyBmcm9tIGNvbW1lbnRzIGFuZCBuZXdsaW5lc1wiPlxyXG4gICAgICAgIGNsZWFuIHN0cmluZ1xyXG4gICAgICA8L2J1dHRvbj5cclxuICAgICAgPGJ1dHRvblxyXG4gICAgICAgIG9uOmNsaWNrPXtzaGFyZURlY2t9XHJcbiAgICAgICAgdGl0bGU9XCJjb3BpZXMgYSBzdHJpbmcgdG8geW91ciBjbGlwYm9hcmQsIHRoYXQgc2hhcmVzIHRoaXMgZGVjayB3aXRoXHJcbiAgICAgICAgb3RoZXJzXCI+XHJcbiAgICAgICAgc2hhcmVcclxuICAgICAgPC9idXR0b24+XHJcblxyXG4gICAgICA8YnV0dG9uIG9uOmNsaWNrPXtyZWxvYWR9PnJlZnJlc2g8L2J1dHRvbj5cclxuICAgIDwvZGl2PlxyXG4gICAgPHRleHRhcmVhIGJpbmQ6dGhpcz17aW5wdXR9IGNsYXNzPVwiaW5wdXRcIiBvbjprZXl1cD17b25UeXBpbmd9IC8+XHJcbiAgPC9kaXY+XHJcblxyXG4gIDxkaXYgY2xhc3M9XCJkaXNwbGF5XCIgYmluZDp0aGlzPXtkaXNwbGF5fT5cclxuICAgIHsjYXdhaXQgcHJvbWlzZX1cclxuICAgICAgPGRpdiBjbGFzcz1cImxvYWRpbmctd3JhcHBlclwiPlxyXG4gICAgICAgIDxkaXY+bG9hZGluZzoge3Byb2dyZXNzfS97YWxsfTwvZGl2PlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJsZHMtcmlwcGxlXCI+XHJcbiAgICAgICAgICA8ZGl2IC8+XHJcbiAgICAgICAgICA8ZGl2IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgezp0aGVuIGdyb3Vwc31cclxuXHJcbiAgICAgIHsjZWFjaCBkZWNrU2VhY2ggfHwgZ3JvdXBzIHx8IFtdIGFzIGdyb3VwfVxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJncm91cFwiPlxyXG5cclxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC1oZWFkZXJcIj5cclxuICAgICAgICAgICAgPGgyPntncm91cC5uYW1lICsgJyAvLyAnICsgZ3JvdXAuY291bnQgfHwgJ25vIG5hbWUnfTwvaDI+XHJcbiAgICAgICAgICAgIDxidXR0b24gb246Y2xpY2s9eygpID0+IHRvZ2dsZUdyb3VwVmlzaWJpbGl0eShncm91cCl9PlxyXG4gICAgICAgICAgICAgIHRvZ2dsZVxyXG4gICAgICAgICAgICA8L2J1dHRvbj5cclxuICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXN0YXRpc3RpY3NcIj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgYmx1ZVwiPntncm91cC5tYW5hLmJsdWV9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIGJsYWNrXCI+e2dyb3VwLm1hbmEuYmxhY2t9PC9kaXY+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXZhbHVlIHJlZFwiPntncm91cC5tYW5hLnJlZH08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgd2hpdGVcIj57Z3JvdXAubWFuYS53aGl0ZX08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgZ3JlZW5cIj57Z3JvdXAubWFuYS5ncmVlbn08L2Rpdj5cclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgY29sb3JsZXNzXCI+e2dyb3VwLm1hbmEuY29sb3JsZXNzfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDwhLS0gZ2VuZXJpYzpcclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgZ2VuZXJpY1wiPntncm91cC5tYW5hLmdlbmVyaWN9PC9kaXY+IC0tPlxyXG4gICAgICAgICAgICAgIHN1bTpcclxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgc3VtXCI+e2dyb3VwLm1hbmEuc3VtfTwvZGl2PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC12YWx1ZSBncm91cC1jb3N0XCI+XHJcbiAgICAgICAgICAgICAgICB7Z3JvdXAuY29zdC50b0ZpeGVkKDIpICsgJyQnfVxyXG4gICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgIGNoYW5jZXM6XHJcbiAgICAgICAgICAgICAgPCEtLSA8ZGl2IGNsYXNzPVwiZ3JvdXAtdmFsdWUgc3VtXCI+e2dyb3VwLmNoYW5jZXN9PC9kaXY+IC0tPlxyXG4gICAgICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgY2xhc3M9XCJncm91cC1jb250ZW50XCJcclxuICAgICAgICAgICAgY2xhc3M6aGlkZGVuPXtoaWRkZW5Hcm91cHMuaGFzKGdyb3VwLm5hbWUpfT5cclxuXHJcbiAgICAgICAgICAgIHsjZWFjaCBncm91cC5jYXJkcyBhcyBjYXJkfVxyXG4gICAgICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgICAgIGNsYXNzPVwiZW50cnlcIlxyXG4gICAgICAgICAgICAgICAgc3R5bGU9eyd3aWR0aDonICsgd2lkdGggKyAncHg7IGhlaWdodDonICsgKGNhcmQuY291bnQgPD0gNCA/IGhlaWdodCArICgoY2FyZC5jb3VudCB8fCAxKSAtIDEpICogNDAgOiBoZWlnaHQgKyAzICogNDApICsgJ3B4Oyd9PlxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cInNob3BpbmdcIj5cclxuICAgICAgICAgICAgICAgICAgPGFcclxuICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImxpbmtcIlxyXG4gICAgICAgICAgICAgICAgICAgIGhyZWY9e2NhcmQuZGF0YS5wdXJjaGFzZV91cmlzLmNhcmRtYXJrZXR9XHJcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0PVwiX2JsYW5rXCI+XHJcbiAgICAgICAgICAgICAgICAgICAgJiMxMjg3MjI7XHJcbiAgICAgICAgICAgICAgICAgIDwvYT5cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgeyNlYWNoIHsgbGVuZ3RoOiBjYXJkLmNvdW50ID4gNCA/IDQgOiBjYXJkLmNvdW50IH0gYXMgXywgaX1cclxuICAgICAgICAgICAgICAgICAgPGltZ1xyXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzOmJhbm5lZD17Y2FyZC5kYXRhLmxlZ2FsaXRpZXNbZm9ybWF0LnZhbHVlXSAhPT0gJ2xlZ2FsJ31cclxuICAgICAgICAgICAgICAgICAgICBjbGFzczpoaWdobGlnaHRlZD17ZGV2b3Rpb25IaWdobGlnaHQgPT0gY2FyZC5kYXRhLmNtY31cclxuICAgICAgICAgICAgICAgICAgICBjbGFzczp0eXBlLWhpZ2hsaWdodD17aGlnaGxpZ2h0ZWRDcmVhdHVyZSAmJiBjYXJkLmRhdGEudHlwZV9saW5lXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC50b0xvd2VyQ2FzZSgpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC5pbmNsdWRlcyhoaWdobGlnaHRlZENyZWF0dXJlKX1cclxuICAgICAgICAgICAgICAgICAgICBvbjptb3VzZXVwfHN0b3BQcm9wYWdhdGlvbj17ZXZ0ID0+IGNhcmRDb250ZXh0TWVudShldnQsIGNhcmQsIGdyb3Vwcyl9XHJcbiAgICAgICAgICAgICAgICAgICAgb246ZGJsY2xpY2s9eygpID0+IHJlbW92ZShjYXJkKX1cclxuICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImNhcmRcIlxyXG4gICAgICAgICAgICAgICAgICAgIHN0eWxlPXsnbWFyZ2luLXRvcDogJyArIGkgKiA0MCArICdweCd9XHJcbiAgICAgICAgICAgICAgICAgICAgc3JjPXtjYXJkLnVybH1cclxuICAgICAgICAgICAgICAgICAgICBhbHQ9e2NhcmQubmFtZX1cclxuICAgICAgICAgICAgICAgICAgICB7d2lkdGh9XHJcbiAgICAgICAgICAgICAgICAgICAge2hlaWdodH0gLz5cclxuICAgICAgICAgICAgICAgIHsvZWFjaH1cclxuXHJcbiAgICAgICAgICAgICAgICB7I2lmIGNhcmQuZGF0YS5sZWdhbGl0aWVzW2Zvcm1hdC52YWx1ZV0gIT09ICdsZWdhbCd9XHJcbiAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJiYW5uZWQtdGV4dFwiPkJBTk5FRDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgICAgIHsjaWYgY2FyZC5jb3VudCA+IDR9XHJcbiAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJjb3VudFwiPntjYXJkLmNvdW50fXg8L2Rpdj5cclxuICAgICAgICAgICAgICAgIHsvaWZ9XHJcblxyXG4gICAgICAgICAgICAgICAgeyNpZiBzY2FsaW5nID4gOTB9XHJcbiAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJwcmljZVwiPntjYXJkLmRhdGEucHJpY2VzLnVzZCArICckJyB8fCAnPz8/J308L2Rpdj5cclxuICAgICAgICAgICAgICAgIHsvaWZ9XHJcblxyXG4gICAgICAgICAgICAgICAgeyNpZiBjdXJyZW50Q2FyZENvbnRleHQgPT09IGNhcmR9XHJcbiAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJjYXJkLWNvbnRleHQtbWVudVwiPlxyXG5cclxuICAgICAgICAgICAgICAgICAgICB7I2VhY2ggZ3JvdXBzIGFzIHN1Ykdyb3VwfVxyXG4gICAgICAgICAgICAgICAgICAgICAgeyNpZiBncm91cC5uYW1lICE9IHN1Ykdyb3VwLm5hbWV9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIDxkaXZcclxuICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImNhcmQtY29udGV4dC1lbnRyeVwiXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgb246bW91c2Vkb3duPXtldnQgPT4gY2FyZENvbnRleHRDbGljayhldnQsIGNhcmQsIHN1Ykdyb3VwKX0+XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAge3N1Ykdyb3VwLm5hbWV9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgICAgICAgICB7L2VhY2h9XHJcbiAgICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgey9pZn1cclxuXHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgIHsvZWFjaH1cclxuICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICB7L2VhY2h9XHJcblxyXG4gICAgezpjYXRjaCBlcnJvcn1cclxuXHJcbiAgICAgIDxkaXYgY2xhc3M9XCJlcnJvclwiPlxyXG4gICAgICAgIEVSUk9SLCBjaGVjayB5b3VyIGRlY2tsaXN0IGZvciBjb3JyZWN0IGZvcm1hdCBvciBpbnRlcm5ldCBjb25uZWN0aW9uXHJcbiAgICAgICAgYnJ1ZGlcclxuICAgICAgPC9kaXY+XHJcbiAgICB7L2F3YWl0fVxyXG4gIDwvZGl2PlxyXG5cclxuICB7I2lmIHBsYXlUZXN0ZXJBY3RpdmV9XHJcbiAgICA8ZGl2IGNsYXNzPVwicGxheS10ZXN0ZXJcIj5cclxuICAgICAgPFBsYXlUZXN0ZXIgYmluZDpwbGF5VGVzdGVyQWN0aXZlIHtwcm9taXNlfSAvPlxyXG4gICAgPC9kaXY+XHJcbiAgey9pZn1cclxuXHJcbiAgPGRpdiBjbGFzcz1cImNhcmQtc2VhcmNoXCIgY2xhc3M6aGlkZT17IWNhcmRTZWFyY2hBY3RpdmV9PlxyXG4gICAgPGRpdiBjbGFzcz1cInRvZ2dsZS1zZWFyY2hcIiBvbjpjbGljaz17dG9nZ2xlU2VhcmNofT54PC9kaXY+XHJcbiAgICA8ZGl2IGNsYXNzPVwic2VhcmNoLXBhcmFtc1wiPlxyXG4gICAgICA8ZGl2IGNsYXNzPVwic2VhcmNoLXBhcmFtXCI+XHJcbiAgICAgICAgTmFtZTpcclxuICAgICAgICA8aW5wdXQgYmluZDp0aGlzPXtzcE5hbWV9IC8+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgICA8ZGl2IGNsYXNzPVwic2VhcmNoLXBhcmFtXCI+XHJcbiAgICAgICAgVGV4dDpcclxuICAgICAgICA8aW5wdXQgYmluZDp0aGlzPXtzcFRleHR9IC8+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgICA8ZGl2IGNsYXNzPVwic2VhcmNoLXBhcmFtXCI+XHJcbiAgICAgICAgVHlwZTpcclxuICAgICAgICA8aW5wdXQgYmluZDp0aGlzPXtzcFR5cGV9IC8+XHJcbiAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1wYXJhbSBjb2xvci1wYXJhbVwiPlxyXG4gICAgICAgIENvbW1hbmRlci1Db2xvcnM6XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImJsdWVcIj5cclxuICAgICAgICAgIDxpbnB1dFxyXG4gICAgICAgICAgICB0eXBlPVwiY2hlY2tib3hcIlxyXG4gICAgICAgICAgICBvbjpjbGljaz17Y2xlYXJDb2xvcmxlc3N9XHJcbiAgICAgICAgICAgIGNsYXNzPVwiYmx1ZVwiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhCbHVlfSAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJibGFja1wiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJibGFja1wiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhCbGFja30gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwicmVkXCI+XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgdHlwZT1cImNoZWNrYm94XCJcclxuICAgICAgICAgICAgb246Y2xpY2s9e2NsZWFyQ29sb3JsZXNzfVxyXG4gICAgICAgICAgICBjbGFzcz1cInJlZFwiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhSZWR9IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cIndoaXRlXCI+XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgdHlwZT1cImNoZWNrYm94XCJcclxuICAgICAgICAgICAgb246Y2xpY2s9e2NsZWFyQ29sb3JsZXNzfVxyXG4gICAgICAgICAgICBjbGFzcz1cIndoaXRlXCJcclxuICAgICAgICAgICAgYmluZDp0aGlzPXtzcEVESFdoaXRlfSAvPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJncmVlblwiPlxyXG4gICAgICAgICAgPGlucHV0XHJcbiAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXHJcbiAgICAgICAgICAgIG9uOmNsaWNrPXtjbGVhckNvbG9ybGVzc31cclxuICAgICAgICAgICAgY2xhc3M9XCJncmVlblwiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhHcmVlbn0gLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiY29sb3JsZXNzXCI+XHJcbiAgICAgICAgICA8aW5wdXRcclxuICAgICAgICAgICAgdHlwZT1cImNoZWNrYm94XCJcclxuICAgICAgICAgICAgb246Y2xpY2s9e2NsZWFyRm9yQ29sb3JsZXNzfVxyXG4gICAgICAgICAgICBjbGFzcz1cImNvbG9ybGVzc1wiXHJcbiAgICAgICAgICAgIGJpbmQ6dGhpcz17c3BFREhDb2xvcmxlc3N9IC8+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgICA8YnV0dG9uIG9uOmNsaWNrPXtzZWFyY2hDYXJkc30+c2VhcmNoPC9idXR0b24+XHJcbiAgICA8L2Rpdj5cclxuXHJcbiAgICB7I2F3YWl0IGNhcmRTZWFyY2hQcm9taXNlfVxyXG4gICAgICA8ZGl2IGNsYXNzPVwibG9hZGluZy13cmFwcGVyXCI+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImxkcy1yaXBwbGVcIj5cclxuICAgICAgICAgIDxkaXYgLz5cclxuICAgICAgICAgIDxkaXYgLz5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgPC9kaXY+XHJcbiAgICB7OnRoZW4gcmVzdWx0fVxyXG5cclxuICAgICAgeyNpZiByZXN1bHQuY29kZSAhPT0gJ25vdF9mb3VuZCcgJiYgcmVzdWx0LmRhdGF9XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1yZXN1bHRcIj5cclxuICAgICAgICAgIHsjZWFjaCByZXN1bHQuZGF0YSBhcyBjYXJkfVxyXG4gICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgY2xhc3M9XCJlbnRyeVwiXHJcbiAgICAgICAgICAgICAgc3R5bGU9eyd3aWR0aDonICsgd2lkdGggKyAncHg7IGhlaWdodDonICsgaGVpZ2h0ICsgJ3B4Oyd9PlxyXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJzaG9waW5nXCI+XHJcbiAgICAgICAgICAgICAgICA8YSBjbGFzcz1cImxpbmtcIiBocmVmPXtjYXJkLmNhcmRtYXJrZXR9IHRhcmdldD1cIl9ibGFua1wiPlxyXG4gICAgICAgICAgICAgICAgICAmIzEyODcyMjtcclxuICAgICAgICAgICAgICAgIDwvYT5cclxuICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICA8aW1nXHJcbiAgICAgICAgICAgICAgICBvbjpkYmxjbGljaz17KCkgPT4gYXBwZW5kQ2FyZChjYXJkLm5hbWUpfVxyXG4gICAgICAgICAgICAgICAgY2xhc3M6YmFubmVkPXtjYXJkLmxlZ2FsaXRpZXNbZm9ybWF0LnZhbHVlXSAhPT0gJ2xlZ2FsJ31cclxuICAgICAgICAgICAgICAgIGNsYXNzPVwiY2FyZFwiXHJcbiAgICAgICAgICAgICAgICBzcmM9e2NhcmQudXJsfVxyXG4gICAgICAgICAgICAgICAgYWx0PXtjYXJkLm5hbWV9XHJcbiAgICAgICAgICAgICAgICB7d2lkdGh9XHJcbiAgICAgICAgICAgICAgICB7aGVpZ2h0fSAvPlxyXG5cclxuICAgICAgICAgICAgICB7I2lmIGNhcmQubGVnYWxpdGllc1tmb3JtYXQudmFsdWVdICE9PSAnbGVnYWwnfVxyXG4gICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImJhbm5lZC10ZXh0XCI+QkFOTkVEPC9kaXY+XHJcbiAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgICB7I2lmIHNjYWxpbmcgPiA5MH1cclxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJwcmljZVwiPntjYXJkLnByaWNlcy51c2QgKyAnJCcgfHwgJz8/Pyd9PC9kaXY+XHJcbiAgICAgICAgICAgICAgey9pZn1cclxuICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICB7OmVsc2V9XHJcbiAgICAgICAgICAgIDxkaXY+Tm8gY2FyZHMgZm91bmQ8L2Rpdj5cclxuICAgICAgICAgIHsvZWFjaH1cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8YnV0dG9uXHJcbiAgICAgICAgICBkaXNhYmxlZD17IXJlc3VsdC5oYXNfbW9yZX1cclxuICAgICAgICAgIG9uOmNsaWNrPXsoKSA9PiBzZWFyY2hDYXJkcyhyZXN1bHQubmV4dF9wYWdlKX0+XHJcbiAgICAgICAgICBuZXh0XHJcbiAgICAgICAgPC9idXR0b24+XHJcbiAgICAgIHs6ZWxzZX1cclxuICAgICAgICA8ZGl2Pk5vIGNhcmRzIGZvdW5kPC9kaXY+XHJcbiAgICAgIHsvaWZ9XHJcbiAgICB7OmNhdGNoIGVycm9yfVxyXG4gICAgICA8ZGl2IGNsYXNzPVwiZXJyb3JcIj5cclxuICAgICAgICBFUlJPUiwgY2hlY2sgeW91ciBkZWNrbGlzdCBmb3IgY29ycmVjdCBmb3JtYXQgb3IgaW50ZXJuZXQgY29ubmVjdGlvblxyXG4gICAgICAgIGJydWRpXHJcbiAgICAgIDwvZGl2PlxyXG4gICAgey9hd2FpdH1cclxuXHJcbiAgPC9kaXY+XHJcbjwvZGl2PlxyXG4iLCJjb25zdCBfX2Rpcm5hbWUgPSBcIi4vXCI7XHJcbndpbmRvdy5fX2Rpcm5hbWUgPSBcIi4vXCI7XHJcbmltcG9ydCBNYWluVmlldyBmcm9tIFwiLi9lZGl0b3Iuc3ZlbHRlXCI7XHJcblxyXG5cclxud2luZG93Lm9ubG9hZCA9IGZ1bmN0aW9uKCkge1xyXG4gIGNvbnN0IHJlbmRlclRhcmdldCA9IG5ldyBNYWluVmlldyh7XHJcbiAgICB0YXJnZXQ6IGRvY3VtZW50LmJvZHksXHJcbiAgICBwcm9wczoge1xyXG4gICAgICB0ZXN0OiBcInNkZmRzZlwiXHJcbiAgICB9XHJcbiAgfSk7XHJcbn07Il0sIm5hbWVzIjpbIkNBUkRfUkFUSU8iLCJfaGVpZ2h0IiwiY2wiLCJNYWluVmlldyJdLCJtYXBwaW5ncyI6Ijs7O0NBQUEsU0FBUyxJQUFJLEdBQUcsRUFBRTtBQUNsQixBQUVBO0NBQ0EsU0FBUyxNQUFNLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRTtDQUMxQixDQUFDLEtBQUssTUFBTSxDQUFDLElBQUksR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7Q0FDdEMsQ0FBQyxPQUFPLEdBQUcsQ0FBQztDQUNaLENBQUM7O0NBRUQsU0FBUyxVQUFVLENBQUMsS0FBSyxFQUFFO0NBQzNCLENBQUMsT0FBTyxLQUFLLElBQUksT0FBTyxLQUFLLENBQUMsSUFBSSxLQUFLLFVBQVUsQ0FBQztDQUNsRCxDQUFDOztDQUVELFNBQVMsWUFBWSxDQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUU7Q0FDekQsQ0FBQyxPQUFPLENBQUMsYUFBYSxHQUFHO0NBQ3pCLEVBQUUsR0FBRyxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFO0NBQ25DLEVBQUUsQ0FBQztDQUNILENBQUM7O0NBRUQsU0FBUyxHQUFHLENBQUMs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SUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQztDQUNsRixRQUFRLFFBQVEsQ0FBQyxLQUFLLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDO0NBQ25GLFFBQVEsUUFBUSxDQUFDLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUM7Q0FDakYsUUFBUSxRQUFRLENBQUMsS0FBSyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQztDQUNuRixRQUFRLFFBQVEsQ0FBQyxLQUFLLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDO0NBQ25GLFFBQVEsUUFBUSxDQUFDLFNBQVMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUM7Q0FDdkYsUUFBUSxRQUFRLENBQUMsT0FBTyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFF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
