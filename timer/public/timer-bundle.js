(function () {
    'use strict';

    function noop() { }
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
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function stop_propagation(fn) {
        return function (event) {
            event.stopPropagation();
            // @ts-ignore
            return fn.call(this, event);
        };
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.data !== data)
            text.data = data;
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
    // TODO figure out if we still want to support
    // shorthand events, or if we want to implement
    // a real bubbling mechanism
    function bubble(component, event) {
        const callbacks = component.$$.callbacks[event.type];
        if (callbacks) {
            callbacks.slice().forEach(fn => fn(event));
        }
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
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
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

    function createCommonjsModule(fn, module) {
    	return module = { exports: {} }, fn(module, module.exports), module.exports;
    }

    /**
     * Parses an URI
     *
     * @author Steven Levithan <stevenlevithan.com> (MIT license)
     * @api private
     */

    var re = /^(?:(?![^:@]+:[^:@\/]*@)(http|https|ws|wss):\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?((?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}|[^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/;

    var parts = [
        'source', 'protocol', 'authority', 'userInfo', 'user', 'password', 'host', 'port', 'relative', 'path', 'directory', 'file', 'query', 'anchor'
    ];

    var parseuri = function parseuri(str) {
        var src = str,
            b = str.indexOf('['),
            e = str.indexOf(']');

        if (b != -1 && e != -1) {
            str = str.substring(0, b) + str.substring(b, e).replace(/:/g, ';') + str.substring(e, str.length);
        }

        var m = re.exec(str || ''),
            uri = {},
            i = 14;

        while (i--) {
            uri[parts[i]] = m[i] || '';
        }

        if (b != -1 && e != -1) {
            uri.source = src;
            uri.host = uri.host.substring(1, uri.host.length - 1).replace(/;/g, ':');
            uri.authority = uri.authority.replace('[', '').replace(']', '').replace(/;/g, ':');
            uri.ipv6uri = true;
        }

        return uri;
    };

    var global$1 = (typeof global !== "undefined" ? global :
                typeof self !== "undefined" ? self :
                typeof window !== "undefined" ? window : {});

    // shim for using process in browser
    // based off https://github.com/defunctzombie/node-process/blob/master/browser.js

    function defaultSetTimout() {
        throw new Error('setTimeout has not been defined');
    }
    function defaultClearTimeout () {
        throw new Error('clearTimeout has not been defined');
    }
    var cachedSetTimeout = defaultSetTimout;
    var cachedClearTimeout = defaultClearTimeout;
    if (typeof global$1.setTimeout === 'function') {
        cachedSetTimeout = setTimeout;
    }
    if (typeof global$1.clearTimeout === 'function') {
        cachedClearTimeout = clearTimeout;
    }

    function runTimeout(fun) {
        if (cachedSetTimeout === setTimeout) {
            //normal enviroments in sane situations
            return setTimeout(fun, 0);
        }
        // if setTimeout wasn't available but was latter defined
        if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
            cachedSetTimeout = setTimeout;
            return setTimeout(fun, 0);
        }
        try {
            // when when somebody has screwed with setTimeout but no I.E. maddness
            return cachedSetTimeout(fun, 0);
        } catch(e){
            try {
                // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
                return cachedSetTimeout.call(null, fun, 0);
            } catch(e){
                // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
                return cachedSetTimeout.call(this, fun, 0);
            }
        }


    }
    function runClearTimeout(marker) {
        if (cachedClearTimeout === clearTimeout) {
            //normal enviroments in sane situations
            return clearTimeout(marker);
        }
        // if clearTimeout wasn't available but was latter defined
        if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
            cachedClearTimeout = clearTimeout;
            return clearTimeout(marker);
        }
        try {
            // when when somebody has screwed with setTimeout but no I.E. maddness
            return cachedClearTimeout(marker);
        } catch (e){
            try {
                // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
                return cachedClearTimeout.call(null, marker);
            } catch (e){
                // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
                // Some versions of I.E. have different rules for clearTimeout vs setTimeout
                return cachedClearTimeout.call(this, marker);
            }
        }



    }
    var queue = [];
    var draining = false;
    var currentQueue;
    var queueIndex = -1;

    function cleanUpNextTick() {
        if (!draining || !currentQueue) {
            return;
        }
        draining = false;
        if (currentQueue.length) {
            queue = currentQueue.concat(queue);
        } else {
            queueIndex = -1;
        }
        if (queue.length) {
            drainQueue();
        }
    }

    function drainQueue() {
        if (draining) {
            return;
        }
        var timeout = runTimeout(cleanUpNextTick);
        draining = true;

        var len = queue.length;
        while(len) {
            currentQueue = queue;
            queue = [];
            while (++queueIndex < len) {
                if (currentQueue) {
                    currentQueue[queueIndex].run();
                }
            }
            queueIndex = -1;
            len = queue.length;
        }
        currentQueue = null;
        draining = false;
        runClearTimeout(timeout);
    }
    function nextTick(fun) {
        var args = new Array(arguments.length - 1);
        if (arguments.length > 1) {
            for (var i = 1; i < arguments.length; i++) {
                args[i - 1] = arguments[i];
            }
        }
        queue.push(new Item(fun, args));
        if (queue.length === 1 && !draining) {
            runTimeout(drainQueue);
        }
    }
    // v8 likes predictible objects
    function Item(fun, array) {
        this.fun = fun;
        this.array = array;
    }
    Item.prototype.run = function () {
        this.fun.apply(null, this.array);
    };
    var title = 'browser';
    var platform = 'browser';
    var browser = true;
    var env = {};
    var argv = [];
    var version = ''; // empty string to avoid regexp issues
    var versions = {};
    var release = {};
    var config = {};

    function noop$1() {}

    var on = noop$1;
    var addListener = noop$1;
    var once = noop$1;
    var off = noop$1;
    var removeListener = noop$1;
    var removeAllListeners = noop$1;
    var emit = noop$1;

    function binding(name) {
        throw new Error('process.binding is not supported');
    }

    function cwd () { return '/' }
    function chdir (dir) {
        throw new Error('process.chdir is not supported');
    }function umask() { return 0; }

    // from https://github.com/kumavis/browser-process-hrtime/blob/master/index.js
    var performance = global$1.performance || {};
    var performanceNow =
      performance.now        ||
      performance.mozNow     ||
      performance.msNow      ||
      performance.oNow       ||
      performance.webkitNow  ||
      function(){ return (new Date()).getTime() };

    // generate timestamp or delta
    // see http://nodejs.org/api/process.html#process_process_hrtime
    function hrtime(previousTimestamp){
      var clocktime = performanceNow.call(performance)*1e-3;
      var seconds = Math.floor(clocktime);
      var nanoseconds = Math.floor((clocktime%1)*1e9);
      if (previousTimestamp) {
        seconds = seconds - previousTimestamp[0];
        nanoseconds = nanoseconds - previousTimestamp[1];
        if (nanoseconds<0) {
          seconds--;
          nanoseconds += 1e9;
        }
      }
      return [seconds,nanoseconds]
    }

    var startTime = new Date();
    function uptime() {
      var currentTime = new Date();
      var dif = currentTime - startTime;
      return dif / 1000;
    }

    var process = {
      nextTick: nextTick,
      title: title,
      browser: browser,
      env: env,
      argv: argv,
      version: version,
      versions: versions,
      on: on,
      addListener: addListener,
      once: once,
      off: off,
      removeListener: removeListener,
      removeAllListeners: removeAllListeners,
      emit: emit,
      binding: binding,
      cwd: cwd,
      chdir: chdir,
      umask: umask,
      hrtime: hrtime,
      platform: platform,
      release: release,
      config: config,
      uptime: uptime
    };

    /**
     * Helpers.
     */

    var s = 1000;
    var m = s * 60;
    var h = m * 60;
    var d = h * 24;
    var w = d * 7;
    var y = d * 365.25;

    /**
     * Parse or format the given `val`.
     *
     * Options:
     *
     *  - `long` verbose formatting [false]
     *
     * @param {String|Number} val
     * @param {Object} [options]
     * @throws {Error} throw an error if val is not a non-empty string or a number
     * @return {String|Number}
     * @api public
     */

    var ms = function(val, options) {
      options = options || {};
      var type = typeof val;
      if (type === 'string' && val.length > 0) {
        return parse(val);
      } else if (type === 'number' && isFinite(val)) {
        return options.long ? fmtLong(val) : fmtShort(val);
      }
      throw new Error(
        'val is not a non-empty string or a valid number. val=' +
          JSON.stringify(val)
      );
    };

    /**
     * Parse the given `str` and return milliseconds.
     *
     * @param {String} str
     * @return {Number}
     * @api private
     */

    function parse(str) {
      str = String(str);
      if (str.length > 100) {
        return;
      }
      var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
        str
      );
      if (!match) {
        return;
      }
      var n = parseFloat(match[1]);
      var type = (match[2] || 'ms').toLowerCase();
      switch (type) {
        case 'years':
        case 'year':
        case 'yrs':
        case 'yr':
        case 'y':
          return n * y;
        case 'weeks':
        case 'week':
        case 'w':
          return n * w;
        case 'days':
        case 'day':
        case 'd':
          return n * d;
        case 'hours':
        case 'hour':
        case 'hrs':
        case 'hr':
        case 'h':
          return n * h;
        case 'minutes':
        case 'minute':
        case 'mins':
        case 'min':
        case 'm':
          return n * m;
        case 'seconds':
        case 'second':
        case 'secs':
        case 'sec':
        case 's':
          return n * s;
        case 'milliseconds':
        case 'millisecond':
        case 'msecs':
        case 'msec':
        case 'ms':
          return n;
        default:
          return undefined;
      }
    }

    /**
     * Short format for `ms`.
     *
     * @param {Number} ms
     * @return {String}
     * @api private
     */

    function fmtShort(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) {
        return Math.round(ms / d) + 'd';
      }
      if (msAbs >= h) {
        return Math.round(ms / h) + 'h';
      }
      if (msAbs >= m) {
        return Math.round(ms / m) + 'm';
      }
      if (msAbs >= s) {
        return Math.round(ms / s) + 's';
      }
      return ms + 'ms';
    }

    /**
     * Long format for `ms`.
     *
     * @param {Number} ms
     * @return {String}
     * @api private
     */

    function fmtLong(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) {
        return plural(ms, msAbs, d, 'day');
      }
      if (msAbs >= h) {
        return plural(ms, msAbs, h, 'hour');
      }
      if (msAbs >= m) {
        return plural(ms, msAbs, m, 'minute');
      }
      if (msAbs >= s) {
        return plural(ms, msAbs, s, 'second');
      }
      return ms + ' ms';
    }

    /**
     * Pluralization helper.
     */

    function plural(ms, msAbs, n, name) {
      var isPlural = msAbs >= n * 1.5;
      return Math.round(ms / n) + ' ' + name + (isPlural ? 's' : '');
    }

    /**
     * This is the common logic for both the Node.js and web browser
     * implementations of `debug()`.
     */

    function setup(env) {
    	createDebug.debug = createDebug;
    	createDebug.default = createDebug;
    	createDebug.coerce = coerce;
    	createDebug.disable = disable;
    	createDebug.enable = enable;
    	createDebug.enabled = enabled;
    	createDebug.humanize = ms;

    	Object.keys(env).forEach(key => {
    		createDebug[key] = env[key];
    	});

    	/**
    	* Active `debug` instances.
    	*/
    	createDebug.instances = [];

    	/**
    	* The currently active debug mode names, and names to skip.
    	*/

    	createDebug.names = [];
    	createDebug.skips = [];

    	/**
    	* Map of special "%n" handling functions, for the debug "format" argument.
    	*
    	* Valid key names are a single, lower or upper-case letter, i.e. "n" and "N".
    	*/
    	createDebug.formatters = {};

    	/**
    	* Selects a color for a debug namespace
    	* @param {String} namespace The namespace string for the for the debug instance to be colored
    	* @return {Number|String} An ANSI color code for the given namespace
    	* @api private
    	*/
    	function selectColor(namespace) {
    		let hash = 0;

    		for (let i = 0; i < namespace.length; i++) {
    			hash = ((hash << 5) - hash) + namespace.charCodeAt(i);
    			hash |= 0; // Convert to 32bit integer
    		}

    		return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
    	}
    	createDebug.selectColor = selectColor;

    	/**
    	* Create a debugger with the given `namespace`.
    	*
    	* @param {String} namespace
    	* @return {Function}
    	* @api public
    	*/
    	function createDebug(namespace) {
    		let prevTime;

    		function debug(...args) {
    			// Disabled?
    			if (!debug.enabled) {
    				return;
    			}

    			const self = debug;

    			// Set `diff` timestamp
    			const curr = Number(new Date());
    			const ms = curr - (prevTime || curr);
    			self.diff = ms;
    			self.prev = prevTime;
    			self.curr = curr;
    			prevTime = curr;

    			args[0] = createDebug.coerce(args[0]);

    			if (typeof args[0] !== 'string') {
    				// Anything else let's inspect with %O
    				args.unshift('%O');
    			}

    			// Apply any `formatters` transformations
    			let index = 0;
    			args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
    				// If we encounter an escaped % then don't increase the array index
    				if (match === '%%') {
    					return match;
    				}
    				index++;
    				const formatter = createDebug.formatters[format];
    				if (typeof formatter === 'function') {
    					const val = args[index];
    					match = formatter.call(self, val);

    					// Now we need to remove `args[index]` since it's inlined in the `format`
    					args.splice(index, 1);
    					index--;
    				}
    				return match;
    			});

    			// Apply env-specific formatting (colors, etc.)
    			createDebug.formatArgs.call(self, args);

    			const logFn = self.log || createDebug.log;
    			logFn.apply(self, args);
    		}

    		debug.namespace = namespace;
    		debug.enabled = createDebug.enabled(namespace);
    		debug.useColors = createDebug.useColors();
    		debug.color = selectColor(namespace);
    		debug.destroy = destroy;
    		debug.extend = extend;
    		// Debug.formatArgs = formatArgs;
    		// debug.rawLog = rawLog;

    		// env-specific initialization logic for debug instances
    		if (typeof createDebug.init === 'function') {
    			createDebug.init(debug);
    		}

    		createDebug.instances.push(debug);

    		return debug;
    	}

    	function destroy() {
    		const index = createDebug.instances.indexOf(this);
    		if (index !== -1) {
    			createDebug.instances.splice(index, 1);
    			return true;
    		}
    		return false;
    	}

    	function extend(namespace, delimiter) {
    		const newDebug = createDebug(this.namespace + (typeof delimiter === 'undefined' ? ':' : delimiter) + namespace);
    		newDebug.log = this.log;
    		return newDebug;
    	}

    	/**
    	* Enables a debug mode by namespaces. This can include modes
    	* separated by a colon and wildcards.
    	*
    	* @param {String} namespaces
    	* @api public
    	*/
    	function enable(namespaces) {
    		createDebug.save(namespaces);

    		createDebug.names = [];
    		createDebug.skips = [];

    		let i;
    		const split = (typeof namespaces === 'string' ? namespaces : '').split(/[\s,]+/);
    		const len = split.length;

    		for (i = 0; i < len; i++) {
    			if (!split[i]) {
    				// ignore empty strings
    				continue;
    			}

    			namespaces = split[i].replace(/\*/g, '.*?');

    			if (namespaces[0] === '-') {
    				createDebug.skips.push(new RegExp('^' + namespaces.substr(1) + '$'));
    			} else {
    				createDebug.names.push(new RegExp('^' + namespaces + '$'));
    			}
    		}

    		for (i = 0; i < createDebug.instances.length; i++) {
    			const instance = createDebug.instances[i];
    			instance.enabled = createDebug.enabled(instance.namespace);
    		}
    	}

    	/**
    	* Disable debug output.
    	*
    	* @return {String} namespaces
    	* @api public
    	*/
    	function disable() {
    		const namespaces = [
    			...createDebug.names.map(toNamespace),
    			...createDebug.skips.map(toNamespace).map(namespace => '-' + namespace)
    		].join(',');
    		createDebug.enable('');
    		return namespaces;
    	}

    	/**
    	* Returns true if the given mode name is enabled, false otherwise.
    	*
    	* @param {String} name
    	* @return {Boolean}
    	* @api public
    	*/
    	function enabled(name) {
    		if (name[name.length - 1] === '*') {
    			return true;
    		}

    		let i;
    		let len;

    		for (i = 0, len = createDebug.skips.length; i < len; i++) {
    			if (createDebug.skips[i].test(name)) {
    				return false;
    			}
    		}

    		for (i = 0, len = createDebug.names.length; i < len; i++) {
    			if (createDebug.names[i].test(name)) {
    				return true;
    			}
    		}

    		return false;
    	}

    	/**
    	* Convert regexp to namespace
    	*
    	* @param {RegExp} regxep
    	* @return {String} namespace
    	* @api private
    	*/
    	function toNamespace(regexp) {
    		return regexp.toString()
    			.substring(2, regexp.toString().length - 2)
    			.replace(/\.\*\?$/, '*');
    	}

    	/**
    	* Coerce `val`.
    	*
    	* @param {Mixed} val
    	* @return {Mixed}
    	* @api private
    	*/
    	function coerce(val) {
    		if (val instanceof Error) {
    			return val.stack || val.message;
    		}
    		return val;
    	}

    	createDebug.enable(createDebug.load());

    	return createDebug;
    }

    var common = setup;

    var browser$1 = createCommonjsModule(function (module, exports) {
    /* eslint-env browser */

    /**
     * This is the web browser implementation of `debug()`.
     */

    exports.log = log;
    exports.formatArgs = formatArgs;
    exports.save = save;
    exports.load = load;
    exports.useColors = useColors;
    exports.storage = localstorage();

    /**
     * Colors.
     */

    exports.colors = [
    	'#0000CC',
    	'#0000FF',
    	'#0033CC',
    	'#0033FF',
    	'#0066CC',
    	'#0066FF',
    	'#0099CC',
    	'#0099FF',
    	'#00CC00',
    	'#00CC33',
    	'#00CC66',
    	'#00CC99',
    	'#00CCCC',
    	'#00CCFF',
    	'#3300CC',
    	'#3300FF',
    	'#3333CC',
    	'#3333FF',
    	'#3366CC',
    	'#3366FF',
    	'#3399CC',
    	'#3399FF',
    	'#33CC00',
    	'#33CC33',
    	'#33CC66',
    	'#33CC99',
    	'#33CCCC',
    	'#33CCFF',
    	'#6600CC',
    	'#6600FF',
    	'#6633CC',
    	'#6633FF',
    	'#66CC00',
    	'#66CC33',
    	'#9900CC',
    	'#9900FF',
    	'#9933CC',
    	'#9933FF',
    	'#99CC00',
    	'#99CC33',
    	'#CC0000',
    	'#CC0033',
    	'#CC0066',
    	'#CC0099',
    	'#CC00CC',
    	'#CC00FF',
    	'#CC3300',
    	'#CC3333',
    	'#CC3366',
    	'#CC3399',
    	'#CC33CC',
    	'#CC33FF',
    	'#CC6600',
    	'#CC6633',
    	'#CC9900',
    	'#CC9933',
    	'#CCCC00',
    	'#CCCC33',
    	'#FF0000',
    	'#FF0033',
    	'#FF0066',
    	'#FF0099',
    	'#FF00CC',
    	'#FF00FF',
    	'#FF3300',
    	'#FF3333',
    	'#FF3366',
    	'#FF3399',
    	'#FF33CC',
    	'#FF33FF',
    	'#FF6600',
    	'#FF6633',
    	'#FF9900',
    	'#FF9933',
    	'#FFCC00',
    	'#FFCC33'
    ];

    /**
     * Currently only WebKit-based Web Inspectors, Firefox >= v31,
     * and the Firebug extension (any Firefox version) are known
     * to support "%c" CSS customizations.
     *
     * TODO: add a `localStorage` variable to explicitly enable/disable colors
     */

    // eslint-disable-next-line complexity
    function useColors() {
    	// NB: In an Electron preload script, document will be defined but not fully
    	// initialized. Since we know we're in Chrome, we'll just detect this case
    	// explicitly
    	if (typeof window !== 'undefined' && window.process && (window.process.type === 'renderer' || window.process.__nwjs)) {
    		return true;
    	}

    	// Internet Explorer and Edge do not support colors.
    	if (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
    		return false;
    	}

    	// Is webkit? http://stackoverflow.com/a/16459606/376773
    	// document is undefined in react-native: https://github.com/facebook/react-native/pull/1632
    	return (typeof document !== 'undefined' && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance) ||
    		// Is firebug? http://stackoverflow.com/a/398120/376773
    		(typeof window !== 'undefined' && window.console && (window.console.firebug || (window.console.exception && window.console.table))) ||
    		// Is firefox >= v31?
    		// https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
    		(typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31) ||
    		// Double check webkit in userAgent just in case we are in a worker
    		(typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/));
    }

    /**
     * Colorize log arguments if enabled.
     *
     * @api public
     */

    function formatArgs(args) {
    	args[0] = (this.useColors ? '%c' : '') +
    		this.namespace +
    		(this.useColors ? ' %c' : ' ') +
    		args[0] +
    		(this.useColors ? '%c ' : ' ') +
    		'+' + module.exports.humanize(this.diff);

    	if (!this.useColors) {
    		return;
    	}

    	const c = 'color: ' + this.color;
    	args.splice(1, 0, c, 'color: inherit');

    	// The final "%c" is somewhat tricky, because there could be other
    	// arguments passed either before or after the %c, so we need to
    	// figure out the correct index to insert the CSS into
    	let index = 0;
    	let lastC = 0;
    	args[0].replace(/%[a-zA-Z%]/g, match => {
    		if (match === '%%') {
    			return;
    		}
    		index++;
    		if (match === '%c') {
    			// We only are interested in the *last* %c
    			// (the user may have provided their own)
    			lastC = index;
    		}
    	});

    	args.splice(lastC, 0, c);
    }

    /**
     * Invokes `console.log()` when available.
     * No-op when `console.log` is not a "function".
     *
     * @api public
     */
    function log(...args) {
    	// This hackery is required for IE8/9, where
    	// the `console.log` function doesn't have 'apply'
    	return typeof console === 'object' &&
    		console.log &&
    		console.log(...args);
    }

    /**
     * Save `namespaces`.
     *
     * @param {String} namespaces
     * @api private
     */
    function save(namespaces) {
    	try {
    		if (namespaces) {
    			exports.storage.setItem('debug', namespaces);
    		} else {
    			exports.storage.removeItem('debug');
    		}
    	} catch (error) {
    		// Swallow
    		// XXX (@Qix-) should we be logging these?
    	}
    }

    /**
     * Load `namespaces`.
     *
     * @return {String} returns the previously persisted debug modes
     * @api private
     */
    function load() {
    	let r;
    	try {
    		r = exports.storage.getItem('debug');
    	} catch (error) {
    		// Swallow
    		// XXX (@Qix-) should we be logging these?
    	}

    	// If debug isn't set in LS, and we're in Electron, try to load $DEBUG
    	if (!r && typeof process !== 'undefined' && 'env' in process) {
    		r = process.env.DEBUG;
    	}

    	return r;
    }

    /**
     * Localstorage attempts to return the localstorage.
     *
     * This is necessary because safari throws
     * when a user disables cookies/localstorage
     * and you attempt to access it.
     *
     * @return {LocalStorage}
     * @api private
     */

    function localstorage() {
    	try {
    		// TVMLKit (Apple TV JS Runtime) does not have a window object, just localStorage in the global context
    		// The Browser also has localStorage in the global context.
    		return localStorage;
    	} catch (error) {
    		// Swallow
    		// XXX (@Qix-) should we be logging these?
    	}
    }

    module.exports = common(exports);

    const {formatters} = module.exports;

    /**
     * Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
     */

    formatters.j = function (v) {
    	try {
    		return JSON.stringify(v);
    	} catch (error) {
    		return '[UnexpectedJSONParseError]: ' + error.message;
    	}
    };
    });
    var browser_1 = browser$1.log;
    var browser_2 = browser$1.formatArgs;
    var browser_3 = browser$1.save;
    var browser_4 = browser$1.load;
    var browser_5 = browser$1.useColors;
    var browser_6 = browser$1.storage;
    var browser_7 = browser$1.colors;

    /**
     * Module dependencies.
     */


    var debug = browser$1('socket.io-client:url');

    /**
     * Module exports.
     */

    var url_1 = url;

    /**
     * URL parser.
     *
     * @param {String} url
     * @param {Object} An object meant to mimic window.location.
     *                 Defaults to window.location.
     * @api public
     */

    function url (uri, loc) {
      var obj = uri;

      // default to window.location
      loc = loc || (typeof location !== 'undefined' && location);
      if (null == uri) uri = loc.protocol + '//' + loc.host;

      // relative path support
      if ('string' === typeof uri) {
        if ('/' === uri.charAt(0)) {
          if ('/' === uri.charAt(1)) {
            uri = loc.protocol + uri;
          } else {
            uri = loc.host + uri;
          }
        }

        if (!/^(https?|wss?):\/\//.test(uri)) {
          debug('protocol-less url %s', uri);
          if ('undefined' !== typeof loc) {
            uri = loc.protocol + '//' + uri;
          } else {
            uri = 'https://' + uri;
          }
        }

        // parse
        debug('parse %s', uri);
        obj = parseuri(uri);
      }

      // make sure we treat `localhost:80` and `localhost` equally
      if (!obj.port) {
        if (/^(http|ws)$/.test(obj.protocol)) {
          obj.port = '80';
        } else if (/^(http|ws)s$/.test(obj.protocol)) {
          obj.port = '443';
        }
      }

      obj.path = obj.path || '/';

      var ipv6 = obj.host.indexOf(':') !== -1;
      var host = ipv6 ? '[' + obj.host + ']' : obj.host;

      // define unique id
      obj.id = obj.protocol + '://' + host + ':' + obj.port;
      // define href
      obj.href = obj.protocol + '://' + host + (loc && loc.port === obj.port ? '' : (':' + obj.port));

      return obj;
    }

    /**
     * Helpers.
     */

    var s$1 = 1000;
    var m$1 = s$1 * 60;
    var h$1 = m$1 * 60;
    var d$1 = h$1 * 24;
    var y$1 = d$1 * 365.25;

    /**
     * Parse or format the given `val`.
     *
     * Options:
     *
     *  - `long` verbose formatting [false]
     *
     * @param {String|Number} val
     * @param {Object} [options]
     * @throws {Error} throw an error if val is not a non-empty string or a number
     * @return {String|Number}
     * @api public
     */

    var ms$1 = function(val, options) {
      options = options || {};
      var type = typeof val;
      if (type === 'string' && val.length > 0) {
        return parse$1(val);
      } else if (type === 'number' && isNaN(val) === false) {
        return options.long ? fmtLong$1(val) : fmtShort$1(val);
      }
      throw new Error(
        'val is not a non-empty string or a valid number. val=' +
          JSON.stringify(val)
      );
    };

    /**
     * Parse the given `str` and return milliseconds.
     *
     * @param {String} str
     * @return {Number}
     * @api private
     */

    function parse$1(str) {
      str = String(str);
      if (str.length > 100) {
        return;
      }
      var match = /^((?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$/i.exec(
        str
      );
      if (!match) {
        return;
      }
      var n = parseFloat(match[1]);
      var type = (match[2] || 'ms').toLowerCase();
      switch (type) {
        case 'years':
        case 'year':
        case 'yrs':
        case 'yr':
        case 'y':
          return n * y$1;
        case 'days':
        case 'day':
        case 'd':
          return n * d$1;
        case 'hours':
        case 'hour':
        case 'hrs':
        case 'hr':
        case 'h':
          return n * h$1;
        case 'minutes':
        case 'minute':
        case 'mins':
        case 'min':
        case 'm':
          return n * m$1;
        case 'seconds':
        case 'second':
        case 'secs':
        case 'sec':
        case 's':
          return n * s$1;
        case 'milliseconds':
        case 'millisecond':
        case 'msecs':
        case 'msec':
        case 'ms':
          return n;
        default:
          return undefined;
      }
    }

    /**
     * Short format for `ms`.
     *
     * @param {Number} ms
     * @return {String}
     * @api private
     */

    function fmtShort$1(ms) {
      if (ms >= d$1) {
        return Math.round(ms / d$1) + 'd';
      }
      if (ms >= h$1) {
        return Math.round(ms / h$1) + 'h';
      }
      if (ms >= m$1) {
        return Math.round(ms / m$1) + 'm';
      }
      if (ms >= s$1) {
        return Math.round(ms / s$1) + 's';
      }
      return ms + 'ms';
    }

    /**
     * Long format for `ms`.
     *
     * @param {Number} ms
     * @return {String}
     * @api private
     */

    function fmtLong$1(ms) {
      return plural$1(ms, d$1, 'day') ||
        plural$1(ms, h$1, 'hour') ||
        plural$1(ms, m$1, 'minute') ||
        plural$1(ms, s$1, 'second') ||
        ms + ' ms';
    }

    /**
     * Pluralization helper.
     */

    function plural$1(ms, n, name) {
      if (ms < n) {
        return;
      }
      if (ms < n * 1.5) {
        return Math.floor(ms / n) + ' ' + name;
      }
      return Math.ceil(ms / n) + ' ' + name + 's';
    }

    var debug$1 = createCommonjsModule(function (module, exports) {
    /**
     * This is the common logic for both the Node.js and web browser
     * implementations of `debug()`.
     *
     * Expose `debug()` as the module.
     */

    exports = module.exports = createDebug.debug = createDebug['default'] = createDebug;
    exports.coerce = coerce;
    exports.disable = disable;
    exports.enable = enable;
    exports.enabled = enabled;
    exports.humanize = ms$1;

    /**
     * Active `debug` instances.
     */
    exports.instances = [];

    /**
     * The currently active debug mode names, and names to skip.
     */

    exports.names = [];
    exports.skips = [];

    /**
     * Map of special "%n" handling functions, for the debug "format" argument.
     *
     * Valid key names are a single, lower or upper-case letter, i.e. "n" and "N".
     */

    exports.formatters = {};

    /**
     * Select a color.
     * @param {String} namespace
     * @return {Number}
     * @api private
     */

    function selectColor(namespace) {
      var hash = 0, i;

      for (i in namespace) {
        hash  = ((hash << 5) - hash) + namespace.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
      }

      return exports.colors[Math.abs(hash) % exports.colors.length];
    }

    /**
     * Create a debugger with the given `namespace`.
     *
     * @param {String} namespace
     * @return {Function}
     * @api public
     */

    function createDebug(namespace) {

      var prevTime;

      function debug() {
        // disabled?
        if (!debug.enabled) return;

        var self = debug;

        // set `diff` timestamp
        var curr = +new Date();
        var ms = curr - (prevTime || curr);
        self.diff = ms;
        self.prev = prevTime;
        self.curr = curr;
        prevTime = curr;

        // turn the `arguments` into a proper Array
        var args = new Array(arguments.length);
        for (var i = 0; i < args.length; i++) {
          args[i] = arguments[i];
        }

        args[0] = exports.coerce(args[0]);

        if ('string' !== typeof args[0]) {
          // anything else let's inspect with %O
          args.unshift('%O');
        }

        // apply any `formatters` transformations
        var index = 0;
        args[0] = args[0].replace(/%([a-zA-Z%])/g, function(match, format) {
          // if we encounter an escaped % then don't increase the array index
          if (match === '%%') return match;
          index++;
          var formatter = exports.formatters[format];
          if ('function' === typeof formatter) {
            var val = args[index];
            match = formatter.call(self, val);

            // now we need to remove `args[index]` since it's inlined in the `format`
            args.splice(index, 1);
            index--;
          }
          return match;
        });

        // apply env-specific formatting (colors, etc.)
        exports.formatArgs.call(self, args);

        var logFn = debug.log || exports.log || console.log.bind(console);
        logFn.apply(self, args);
      }

      debug.namespace = namespace;
      debug.enabled = exports.enabled(namespace);
      debug.useColors = exports.useColors();
      debug.color = selectColor(namespace);
      debug.destroy = destroy;

      // env-specific initialization logic for debug instances
      if ('function' === typeof exports.init) {
        exports.init(debug);
      }

      exports.instances.push(debug);

      return debug;
    }

    function destroy () {
      var index = exports.instances.indexOf(this);
      if (index !== -1) {
        exports.instances.splice(index, 1);
        return true;
      } else {
        return false;
      }
    }

    /**
     * Enables a debug mode by namespaces. This can include modes
     * separated by a colon and wildcards.
     *
     * @param {String} namespaces
     * @api public
     */

    function enable(namespaces) {
      exports.save(namespaces);

      exports.names = [];
      exports.skips = [];

      var i;
      var split = (typeof namespaces === 'string' ? namespaces : '').split(/[\s,]+/);
      var len = split.length;

      for (i = 0; i < len; i++) {
        if (!split[i]) continue; // ignore empty strings
        namespaces = split[i].replace(/\*/g, '.*?');
        if (namespaces[0] === '-') {
          exports.skips.push(new RegExp('^' + namespaces.substr(1) + '$'));
        } else {
          exports.names.push(new RegExp('^' + namespaces + '$'));
        }
      }

      for (i = 0; i < exports.instances.length; i++) {
        var instance = exports.instances[i];
        instance.enabled = exports.enabled(instance.namespace);
      }
    }

    /**
     * Disable debug output.
     *
     * @api public
     */

    function disable() {
      exports.enable('');
    }

    /**
     * Returns true if the given mode name is enabled, false otherwise.
     *
     * @param {String} name
     * @return {Boolean}
     * @api public
     */

    function enabled(name) {
      if (name[name.length - 1] === '*') {
        return true;
      }
      var i, len;
      for (i = 0, len = exports.skips.length; i < len; i++) {
        if (exports.skips[i].test(name)) {
          return false;
        }
      }
      for (i = 0, len = exports.names.length; i < len; i++) {
        if (exports.names[i].test(name)) {
          return true;
        }
      }
      return false;
    }

    /**
     * Coerce `val`.
     *
     * @param {Mixed} val
     * @return {Mixed}
     * @api private
     */

    function coerce(val) {
      if (val instanceof Error) return val.stack || val.message;
      return val;
    }
    });
    var debug_1 = debug$1.coerce;
    var debug_2 = debug$1.disable;
    var debug_3 = debug$1.enable;
    var debug_4 = debug$1.enabled;
    var debug_5 = debug$1.humanize;
    var debug_6 = debug$1.instances;
    var debug_7 = debug$1.names;
    var debug_8 = debug$1.skips;
    var debug_9 = debug$1.formatters;

    var browser$2 = createCommonjsModule(function (module, exports) {
    /**
     * This is the web browser implementation of `debug()`.
     *
     * Expose `debug()` as the module.
     */

    exports = module.exports = debug$1;
    exports.log = log;
    exports.formatArgs = formatArgs;
    exports.save = save;
    exports.load = load;
    exports.useColors = useColors;
    exports.storage = 'undefined' != typeof chrome
                   && 'undefined' != typeof chrome.storage
                      ? chrome.storage.local
                      : localstorage();

    /**
     * Colors.
     */

    exports.colors = [
      '#0000CC', '#0000FF', '#0033CC', '#0033FF', '#0066CC', '#0066FF', '#0099CC',
      '#0099FF', '#00CC00', '#00CC33', '#00CC66', '#00CC99', '#00CCCC', '#00CCFF',
      '#3300CC', '#3300FF', '#3333CC', '#3333FF', '#3366CC', '#3366FF', '#3399CC',
      '#3399FF', '#33CC00', '#33CC33', '#33CC66', '#33CC99', '#33CCCC', '#33CCFF',
      '#6600CC', '#6600FF', '#6633CC', '#6633FF', '#66CC00', '#66CC33', '#9900CC',
      '#9900FF', '#9933CC', '#9933FF', '#99CC00', '#99CC33', '#CC0000', '#CC0033',
      '#CC0066', '#CC0099', '#CC00CC', '#CC00FF', '#CC3300', '#CC3333', '#CC3366',
      '#CC3399', '#CC33CC', '#CC33FF', '#CC6600', '#CC6633', '#CC9900', '#CC9933',
      '#CCCC00', '#CCCC33', '#FF0000', '#FF0033', '#FF0066', '#FF0099', '#FF00CC',
      '#FF00FF', '#FF3300', '#FF3333', '#FF3366', '#FF3399', '#FF33CC', '#FF33FF',
      '#FF6600', '#FF6633', '#FF9900', '#FF9933', '#FFCC00', '#FFCC33'
    ];

    /**
     * Currently only WebKit-based Web Inspectors, Firefox >= v31,
     * and the Firebug extension (any Firefox version) are known
     * to support "%c" CSS customizations.
     *
     * TODO: add a `localStorage` variable to explicitly enable/disable colors
     */

    function useColors() {
      // NB: In an Electron preload script, document will be defined but not fully
      // initialized. Since we know we're in Chrome, we'll just detect this case
      // explicitly
      if (typeof window !== 'undefined' && window.process && window.process.type === 'renderer') {
        return true;
      }

      // Internet Explorer and Edge do not support colors.
      if (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
        return false;
      }

      // is webkit? http://stackoverflow.com/a/16459606/376773
      // document is undefined in react-native: https://github.com/facebook/react-native/pull/1632
      return (typeof document !== 'undefined' && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance) ||
        // is firebug? http://stackoverflow.com/a/398120/376773
        (typeof window !== 'undefined' && window.console && (window.console.firebug || (window.console.exception && window.console.table))) ||
        // is firefox >= v31?
        // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
        (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31) ||
        // double check webkit in userAgent just in case we are in a worker
        (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/));
    }

    /**
     * Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
     */

    exports.formatters.j = function(v) {
      try {
        return JSON.stringify(v);
      } catch (err) {
        return '[UnexpectedJSONParseError]: ' + err.message;
      }
    };


    /**
     * Colorize log arguments if enabled.
     *
     * @api public
     */

    function formatArgs(args) {
      var useColors = this.useColors;

      args[0] = (useColors ? '%c' : '')
        + this.namespace
        + (useColors ? ' %c' : ' ')
        + args[0]
        + (useColors ? '%c ' : ' ')
        + '+' + exports.humanize(this.diff);

      if (!useColors) return;

      var c = 'color: ' + this.color;
      args.splice(1, 0, c, 'color: inherit');

      // the final "%c" is somewhat tricky, because there could be other
      // arguments passed either before or after the %c, so we need to
      // figure out the correct index to insert the CSS into
      var index = 0;
      var lastC = 0;
      args[0].replace(/%[a-zA-Z%]/g, function(match) {
        if ('%%' === match) return;
        index++;
        if ('%c' === match) {
          // we only are interested in the *last* %c
          // (the user may have provided their own)
          lastC = index;
        }
      });

      args.splice(lastC, 0, c);
    }

    /**
     * Invokes `console.log()` when available.
     * No-op when `console.log` is not a "function".
     *
     * @api public
     */

    function log() {
      // this hackery is required for IE8/9, where
      // the `console.log` function doesn't have 'apply'
      return 'object' === typeof console
        && console.log
        && Function.prototype.apply.call(console.log, console, arguments);
    }

    /**
     * Save `namespaces`.
     *
     * @param {String} namespaces
     * @api private
     */

    function save(namespaces) {
      try {
        if (null == namespaces) {
          exports.storage.removeItem('debug');
        } else {
          exports.storage.debug = namespaces;
        }
      } catch(e) {}
    }

    /**
     * Load `namespaces`.
     *
     * @return {String} returns the previously persisted debug modes
     * @api private
     */

    function load() {
      var r;
      try {
        r = exports.storage.debug;
      } catch(e) {}

      // If debug isn't set in LS, and we're in Electron, try to load $DEBUG
      if (!r && typeof process !== 'undefined' && 'env' in process) {
        r = process.env.DEBUG;
      }

      return r;
    }

    /**
     * Enable namespaces listed in `localStorage.debug` initially.
     */

    exports.enable(load());

    /**
     * Localstorage attempts to return the localstorage.
     *
     * This is necessary because safari throws
     * when a user disables cookies/localstorage
     * and you attempt to access it.
     *
     * @return {LocalStorage}
     * @api private
     */

    function localstorage() {
      try {
        return window.localStorage;
      } catch (e) {}
    }
    });
    var browser_1$1 = browser$2.log;
    var browser_2$1 = browser$2.formatArgs;
    var browser_3$1 = browser$2.save;
    var browser_4$1 = browser$2.load;
    var browser_5$1 = browser$2.useColors;
    var browser_6$1 = browser$2.storage;
    var browser_7$1 = browser$2.colors;

    var componentEmitter = createCommonjsModule(function (module) {
    /**
     * Expose `Emitter`.
     */

    {
      module.exports = Emitter;
    }

    /**
     * Initialize a new `Emitter`.
     *
     * @api public
     */

    function Emitter(obj) {
      if (obj) return mixin(obj);
    }
    /**
     * Mixin the emitter properties.
     *
     * @param {Object} obj
     * @return {Object}
     * @api private
     */

    function mixin(obj) {
      for (var key in Emitter.prototype) {
        obj[key] = Emitter.prototype[key];
      }
      return obj;
    }

    /**
     * Listen on the given `event` with `fn`.
     *
     * @param {String} event
     * @param {Function} fn
     * @return {Emitter}
     * @api public
     */

    Emitter.prototype.on =
    Emitter.prototype.addEventListener = function(event, fn){
      this._callbacks = this._callbacks || {};
      (this._callbacks['$' + event] = this._callbacks['$' + event] || [])
        .push(fn);
      return this;
    };

    /**
     * Adds an `event` listener that will be invoked a single
     * time then automatically removed.
     *
     * @param {String} event
     * @param {Function} fn
     * @return {Emitter}
     * @api public
     */

    Emitter.prototype.once = function(event, fn){
      function on() {
        this.off(event, on);
        fn.apply(this, arguments);
      }

      on.fn = fn;
      this.on(event, on);
      return this;
    };

    /**
     * Remove the given callback for `event` or all
     * registered callbacks.
     *
     * @param {String} event
     * @param {Function} fn
     * @return {Emitter}
     * @api public
     */

    Emitter.prototype.off =
    Emitter.prototype.removeListener =
    Emitter.prototype.removeAllListeners =
    Emitter.prototype.removeEventListener = function(event, fn){
      this._callbacks = this._callbacks || {};

      // all
      if (0 == arguments.length) {
        this._callbacks = {};
        return this;
      }

      // specific event
      var callbacks = this._callbacks['$' + event];
      if (!callbacks) return this;

      // remove all handlers
      if (1 == arguments.length) {
        delete this._callbacks['$' + event];
        return this;
      }

      // remove specific handler
      var cb;
      for (var i = 0; i < callbacks.length; i++) {
        cb = callbacks[i];
        if (cb === fn || cb.fn === fn) {
          callbacks.splice(i, 1);
          break;
        }
      }
      return this;
    };

    /**
     * Emit `event` with the given args.
     *
     * @param {String} event
     * @param {Mixed} ...
     * @return {Emitter}
     */

    Emitter.prototype.emit = function(event){
      this._callbacks = this._callbacks || {};
      var args = [].slice.call(arguments, 1)
        , callbacks = this._callbacks['$' + event];

      if (callbacks) {
        callbacks = callbacks.slice(0);
        for (var i = 0, len = callbacks.length; i < len; ++i) {
          callbacks[i].apply(this, args);
        }
      }

      return this;
    };

    /**
     * Return array of callbacks for `event`.
     *
     * @param {String} event
     * @return {Array}
     * @api public
     */

    Emitter.prototype.listeners = function(event){
      this._callbacks = this._callbacks || {};
      return this._callbacks['$' + event] || [];
    };

    /**
     * Check if this emitter has `event` handlers.
     *
     * @param {String} event
     * @return {Boolean}
     * @api public
     */

    Emitter.prototype.hasListeners = function(event){
      return !! this.listeners(event).length;
    };
    });

    var toString = {}.toString;

    var isarray = Array.isArray || function (arr) {
      return toString.call(arr) == '[object Array]';
    };

    var lookup = [];
    var revLookup = [];
    var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array;
    var inited = false;
    function init$1 () {
      inited = true;
      var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      for (var i = 0, len = code.length; i < len; ++i) {
        lookup[i] = code[i];
        revLookup[code.charCodeAt(i)] = i;
      }

      revLookup['-'.charCodeAt(0)] = 62;
      revLookup['_'.charCodeAt(0)] = 63;
    }

    function toByteArray (b64) {
      if (!inited) {
        init$1();
      }
      var i, j, l, tmp, placeHolders, arr;
      var len = b64.length;

      if (len % 4 > 0) {
        throw new Error('Invalid string. Length must be a multiple of 4')
      }

      // the number of equal signs (place holders)
      // if there are two placeholders, than the two characters before it
      // represent one byte
      // if there is only one, then the three characters before it represent 2 bytes
      // this is just a cheap hack to not do indexOf twice
      placeHolders = b64[len - 2] === '=' ? 2 : b64[len - 1] === '=' ? 1 : 0;

      // base64 is 4/3 + up to two characters of the original data
      arr = new Arr(len * 3 / 4 - placeHolders);

      // if there are placeholders, only get up to the last complete 4 chars
      l = placeHolders > 0 ? len - 4 : len;

      var L = 0;

      for (i = 0, j = 0; i < l; i += 4, j += 3) {
        tmp = (revLookup[b64.charCodeAt(i)] << 18) | (revLookup[b64.charCodeAt(i + 1)] << 12) | (revLookup[b64.charCodeAt(i + 2)] << 6) | revLookup[b64.charCodeAt(i + 3)];
        arr[L++] = (tmp >> 16) & 0xFF;
        arr[L++] = (tmp >> 8) & 0xFF;
        arr[L++] = tmp & 0xFF;
      }

      if (placeHolders === 2) {
        tmp = (revLookup[b64.charCodeAt(i)] << 2) | (revLookup[b64.charCodeAt(i + 1)] >> 4);
        arr[L++] = tmp & 0xFF;
      } else if (placeHolders === 1) {
        tmp = (revLookup[b64.charCodeAt(i)] << 10) | (revLookup[b64.charCodeAt(i + 1)] << 4) | (revLookup[b64.charCodeAt(i + 2)] >> 2);
        arr[L++] = (tmp >> 8) & 0xFF;
        arr[L++] = tmp & 0xFF;
      }

      return arr
    }

    function tripletToBase64 (num) {
      return lookup[num >> 18 & 0x3F] + lookup[num >> 12 & 0x3F] + lookup[num >> 6 & 0x3F] + lookup[num & 0x3F]
    }

    function encodeChunk (uint8, start, end) {
      var tmp;
      var output = [];
      for (var i = start; i < end; i += 3) {
        tmp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2]);
        output.push(tripletToBase64(tmp));
      }
      return output.join('')
    }

    function fromByteArray (uint8) {
      if (!inited) {
        init$1();
      }
      var tmp;
      var len = uint8.length;
      var extraBytes = len % 3; // if we have 1 byte left, pad 2 bytes
      var output = '';
      var parts = [];
      var maxChunkLength = 16383; // must be multiple of 3

      // go through the array every three bytes, we'll deal with trailing stuff later
      for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
        parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)));
      }

      // pad the end with zeros, but make sure to not forget the extra bytes
      if (extraBytes === 1) {
        tmp = uint8[len - 1];
        output += lookup[tmp >> 2];
        output += lookup[(tmp << 4) & 0x3F];
        output += '==';
      } else if (extraBytes === 2) {
        tmp = (uint8[len - 2] << 8) + (uint8[len - 1]);
        output += lookup[tmp >> 10];
        output += lookup[(tmp >> 4) & 0x3F];
        output += lookup[(tmp << 2) & 0x3F];
        output += '=';
      }

      parts.push(output);

      return parts.join('')
    }

    var base64 = /*#__PURE__*/Object.freeze({
        toByteArray: toByteArray,
        fromByteArray: fromByteArray
    });

    function read (buffer, offset, isLE, mLen, nBytes) {
      var e, m;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var nBits = -7;
      var i = isLE ? (nBytes - 1) : 0;
      var d = isLE ? -1 : 1;
      var s = buffer[offset + i];

      i += d;

      e = s & ((1 << (-nBits)) - 1);
      s >>= (-nBits);
      nBits += eLen;
      for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

      m = e & ((1 << (-nBits)) - 1);
      e >>= (-nBits);
      nBits += mLen;
      for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

      if (e === 0) {
        e = 1 - eBias;
      } else if (e === eMax) {
        return m ? NaN : ((s ? -1 : 1) * Infinity)
      } else {
        m = m + Math.pow(2, mLen);
        e = e - eBias;
      }
      return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
    }

    function write (buffer, value, offset, isLE, mLen, nBytes) {
      var e, m, c;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0);
      var i = isLE ? 0 : (nBytes - 1);
      var d = isLE ? 1 : -1;
      var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

      value = Math.abs(value);

      if (isNaN(value) || value === Infinity) {
        m = isNaN(value) ? 1 : 0;
        e = eMax;
      } else {
        e = Math.floor(Math.log(value) / Math.LN2);
        if (value * (c = Math.pow(2, -e)) < 1) {
          e--;
          c *= 2;
        }
        if (e + eBias >= 1) {
          value += rt / c;
        } else {
          value += rt * Math.pow(2, 1 - eBias);
        }
        if (value * c >= 2) {
          e++;
          c /= 2;
        }

        if (e + eBias >= eMax) {
          m = 0;
          e = eMax;
        } else if (e + eBias >= 1) {
          m = (value * c - 1) * Math.pow(2, mLen);
          e = e + eBias;
        } else {
          m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
          e = 0;
        }
      }

      for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

      e = (e << mLen) | m;
      eLen += mLen;
      for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

      buffer[offset + i - d] |= s * 128;
    }

    var toString$1 = {}.toString;

    var isArray = Array.isArray || function (arr) {
      return toString$1.call(arr) == '[object Array]';
    };

    var INSPECT_MAX_BYTES = 50;

    /**
     * If `Buffer.TYPED_ARRAY_SUPPORT`:
     *   === true    Use Uint8Array implementation (fastest)
     *   === false   Use Object implementation (most compatible, even IE6)
     *
     * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
     * Opera 11.6+, iOS 4.2+.
     *
     * Due to various browser bugs, sometimes the Object implementation will be used even
     * when the browser supports typed arrays.
     *
     * Note:
     *
     *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
     *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
     *
     *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
     *
     *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
     *     incorrect length in some situations.

     * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
     * get the Object implementation, which is slower but behaves correctly.
     */
    Buffer.TYPED_ARRAY_SUPPORT = global$1.TYPED_ARRAY_SUPPORT !== undefined
      ? global$1.TYPED_ARRAY_SUPPORT
      : true;

    function kMaxLength () {
      return Buffer.TYPED_ARRAY_SUPPORT
        ? 0x7fffffff
        : 0x3fffffff
    }

    function createBuffer (that, length) {
      if (kMaxLength() < length) {
        throw new RangeError('Invalid typed array length')
      }
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        // Return an augmented `Uint8Array` instance, for best performance
        that = new Uint8Array(length);
        that.__proto__ = Buffer.prototype;
      } else {
        // Fallback: Return an object instance of the Buffer class
        if (that === null) {
          that = new Buffer(length);
        }
        that.length = length;
      }

      return that
    }

    /**
     * The Buffer constructor returns instances of `Uint8Array` that have their
     * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
     * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
     * and the `Uint8Array` methods. Square bracket notation works as expected -- it
     * returns a single octet.
     *
     * The `Uint8Array` prototype remains unmodified.
     */

    function Buffer (arg, encodingOrOffset, length) {
      if (!Buffer.TYPED_ARRAY_SUPPORT && !(this instanceof Buffer)) {
        return new Buffer(arg, encodingOrOffset, length)
      }

      // Common case.
      if (typeof arg === 'number') {
        if (typeof encodingOrOffset === 'string') {
          throw new Error(
            'If encoding is specified then the first argument must be a string'
          )
        }
        return allocUnsafe(this, arg)
      }
      return from(this, arg, encodingOrOffset, length)
    }

    Buffer.poolSize = 8192; // not used by this implementation

    // TODO: Legacy, not needed anymore. Remove in next major version.
    Buffer._augment = function (arr) {
      arr.__proto__ = Buffer.prototype;
      return arr
    };

    function from (that, value, encodingOrOffset, length) {
      if (typeof value === 'number') {
        throw new TypeError('"value" argument must not be a number')
      }

      if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
        return fromArrayBuffer(that, value, encodingOrOffset, length)
      }

      if (typeof value === 'string') {
        return fromString(that, value, encodingOrOffset)
      }

      return fromObject(that, value)
    }

    /**
     * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
     * if value is a number.
     * Buffer.from(str[, encoding])
     * Buffer.from(array)
     * Buffer.from(buffer)
     * Buffer.from(arrayBuffer[, byteOffset[, length]])
     **/
    Buffer.from = function (value, encodingOrOffset, length) {
      return from(null, value, encodingOrOffset, length)
    };

    if (Buffer.TYPED_ARRAY_SUPPORT) {
      Buffer.prototype.__proto__ = Uint8Array.prototype;
      Buffer.__proto__ = Uint8Array;
    }

    function assertSize (size) {
      if (typeof size !== 'number') {
        throw new TypeError('"size" argument must be a number')
      } else if (size < 0) {
        throw new RangeError('"size" argument must not be negative')
      }
    }

    function alloc (that, size, fill, encoding) {
      assertSize(size);
      if (size <= 0) {
        return createBuffer(that, size)
      }
      if (fill !== undefined) {
        // Only pay attention to encoding if it's a string. This
        // prevents accidentally sending in a number that would
        // be interpretted as a start offset.
        return typeof encoding === 'string'
          ? createBuffer(that, size).fill(fill, encoding)
          : createBuffer(that, size).fill(fill)
      }
      return createBuffer(that, size)
    }

    /**
     * Creates a new filled Buffer instance.
     * alloc(size[, fill[, encoding]])
     **/
    Buffer.alloc = function (size, fill, encoding) {
      return alloc(null, size, fill, encoding)
    };

    function allocUnsafe (that, size) {
      assertSize(size);
      that = createBuffer(that, size < 0 ? 0 : checked(size) | 0);
      if (!Buffer.TYPED_ARRAY_SUPPORT) {
        for (var i = 0; i < size; ++i) {
          that[i] = 0;
        }
      }
      return that
    }

    /**
     * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
     * */
    Buffer.allocUnsafe = function (size) {
      return allocUnsafe(null, size)
    };
    /**
     * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
     */
    Buffer.allocUnsafeSlow = function (size) {
      return allocUnsafe(null, size)
    };

    function fromString (that, string, encoding) {
      if (typeof encoding !== 'string' || encoding === '') {
        encoding = 'utf8';
      }

      if (!Buffer.isEncoding(encoding)) {
        throw new TypeError('"encoding" must be a valid string encoding')
      }

      var length = byteLength(string, encoding) | 0;
      that = createBuffer(that, length);

      var actual = that.write(string, encoding);

      if (actual !== length) {
        // Writing a hex string, for example, that contains invalid characters will
        // cause everything after the first invalid character to be ignored. (e.g.
        // 'abxxcd' will be treated as 'ab')
        that = that.slice(0, actual);
      }

      return that
    }

    function fromArrayLike (that, array) {
      var length = array.length < 0 ? 0 : checked(array.length) | 0;
      that = createBuffer(that, length);
      for (var i = 0; i < length; i += 1) {
        that[i] = array[i] & 255;
      }
      return that
    }

    function fromArrayBuffer (that, array, byteOffset, length) {
      array.byteLength; // this throws if `array` is not a valid ArrayBuffer

      if (byteOffset < 0 || array.byteLength < byteOffset) {
        throw new RangeError('\'offset\' is out of bounds')
      }

      if (array.byteLength < byteOffset + (length || 0)) {
        throw new RangeError('\'length\' is out of bounds')
      }

      if (byteOffset === undefined && length === undefined) {
        array = new Uint8Array(array);
      } else if (length === undefined) {
        array = new Uint8Array(array, byteOffset);
      } else {
        array = new Uint8Array(array, byteOffset, length);
      }

      if (Buffer.TYPED_ARRAY_SUPPORT) {
        // Return an augmented `Uint8Array` instance, for best performance
        that = array;
        that.__proto__ = Buffer.prototype;
      } else {
        // Fallback: Return an object instance of the Buffer class
        that = fromArrayLike(that, array);
      }
      return that
    }

    function fromObject (that, obj) {
      if (internalIsBuffer(obj)) {
        var len = checked(obj.length) | 0;
        that = createBuffer(that, len);

        if (that.length === 0) {
          return that
        }

        obj.copy(that, 0, 0, len);
        return that
      }

      if (obj) {
        if ((typeof ArrayBuffer !== 'undefined' &&
            obj.buffer instanceof ArrayBuffer) || 'length' in obj) {
          if (typeof obj.length !== 'number' || isnan(obj.length)) {
            return createBuffer(that, 0)
          }
          return fromArrayLike(that, obj)
        }

        if (obj.type === 'Buffer' && isArray(obj.data)) {
          return fromArrayLike(that, obj.data)
        }
      }

      throw new TypeError('First argument must be a string, Buffer, ArrayBuffer, Array, or array-like object.')
    }

    function checked (length) {
      // Note: cannot use `length < kMaxLength()` here because that fails when
      // length is NaN (which is otherwise coerced to zero.)
      if (length >= kMaxLength()) {
        throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                             'size: 0x' + kMaxLength().toString(16) + ' bytes')
      }
      return length | 0
    }
    Buffer.isBuffer = isBuffer;
    function internalIsBuffer (b) {
      return !!(b != null && b._isBuffer)
    }

    Buffer.compare = function compare (a, b) {
      if (!internalIsBuffer(a) || !internalIsBuffer(b)) {
        throw new TypeError('Arguments must be Buffers')
      }

      if (a === b) return 0

      var x = a.length;
      var y = b.length;

      for (var i = 0, len = Math.min(x, y); i < len; ++i) {
        if (a[i] !== b[i]) {
          x = a[i];
          y = b[i];
          break
        }
      }

      if (x < y) return -1
      if (y < x) return 1
      return 0
    };

    Buffer.isEncoding = function isEncoding (encoding) {
      switch (String(encoding).toLowerCase()) {
        case 'hex':
        case 'utf8':
        case 'utf-8':
        case 'ascii':
        case 'latin1':
        case 'binary':
        case 'base64':
        case 'ucs2':
        case 'ucs-2':
        case 'utf16le':
        case 'utf-16le':
          return true
        default:
          return false
      }
    };

    Buffer.concat = function concat (list, length) {
      if (!isArray(list)) {
        throw new TypeError('"list" argument must be an Array of Buffers')
      }

      if (list.length === 0) {
        return Buffer.alloc(0)
      }

      var i;
      if (length === undefined) {
        length = 0;
        for (i = 0; i < list.length; ++i) {
          length += list[i].length;
        }
      }

      var buffer = Buffer.allocUnsafe(length);
      var pos = 0;
      for (i = 0; i < list.length; ++i) {
        var buf = list[i];
        if (!internalIsBuffer(buf)) {
          throw new TypeError('"list" argument must be an Array of Buffers')
        }
        buf.copy(buffer, pos);
        pos += buf.length;
      }
      return buffer
    };

    function byteLength (string, encoding) {
      if (internalIsBuffer(string)) {
        return string.length
      }
      if (typeof ArrayBuffer !== 'undefined' && typeof ArrayBuffer.isView === 'function' &&
          (ArrayBuffer.isView(string) || string instanceof ArrayBuffer)) {
        return string.byteLength
      }
      if (typeof string !== 'string') {
        string = '' + string;
      }

      var len = string.length;
      if (len === 0) return 0

      // Use a for loop to avoid recursion
      var loweredCase = false;
      for (;;) {
        switch (encoding) {
          case 'ascii':
          case 'latin1':
          case 'binary':
            return len
          case 'utf8':
          case 'utf-8':
          case undefined:
            return utf8ToBytes(string).length
          case 'ucs2':
          case 'ucs-2':
          case 'utf16le':
          case 'utf-16le':
            return len * 2
          case 'hex':
            return len >>> 1
          case 'base64':
            return base64ToBytes(string).length
          default:
            if (loweredCase) return utf8ToBytes(string).length // assume utf8
            encoding = ('' + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    }
    Buffer.byteLength = byteLength;

    function slowToString (encoding, start, end) {
      var loweredCase = false;

      // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
      // property of a typed array.

      // This behaves neither like String nor Uint8Array in that we set start/end
      // to their upper/lower bounds if the value passed is out of range.
      // undefined is handled specially as per ECMA-262 6th Edition,
      // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
      if (start === undefined || start < 0) {
        start = 0;
      }
      // Return early if start > this.length. Done here to prevent potential uint32
      // coercion fail below.
      if (start > this.length) {
        return ''
      }

      if (end === undefined || end > this.length) {
        end = this.length;
      }

      if (end <= 0) {
        return ''
      }

      // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
      end >>>= 0;
      start >>>= 0;

      if (end <= start) {
        return ''
      }

      if (!encoding) encoding = 'utf8';

      while (true) {
        switch (encoding) {
          case 'hex':
            return hexSlice(this, start, end)

          case 'utf8':
          case 'utf-8':
            return utf8Slice(this, start, end)

          case 'ascii':
            return asciiSlice(this, start, end)

          case 'latin1':
          case 'binary':
            return latin1Slice(this, start, end)

          case 'base64':
            return base64Slice(this, start, end)

          case 'ucs2':
          case 'ucs-2':
          case 'utf16le':
          case 'utf-16le':
            return utf16leSlice(this, start, end)

          default:
            if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
            encoding = (encoding + '').toLowerCase();
            loweredCase = true;
        }
      }
    }

    // The property is used by `Buffer.isBuffer` and `is-buffer` (in Safari 5-7) to detect
    // Buffer instances.
    Buffer.prototype._isBuffer = true;

    function swap (b, n, m) {
      var i = b[n];
      b[n] = b[m];
      b[m] = i;
    }

    Buffer.prototype.swap16 = function swap16 () {
      var len = this.length;
      if (len % 2 !== 0) {
        throw new RangeError('Buffer size must be a multiple of 16-bits')
      }
      for (var i = 0; i < len; i += 2) {
        swap(this, i, i + 1);
      }
      return this
    };

    Buffer.prototype.swap32 = function swap32 () {
      var len = this.length;
      if (len % 4 !== 0) {
        throw new RangeError('Buffer size must be a multiple of 32-bits')
      }
      for (var i = 0; i < len; i += 4) {
        swap(this, i, i + 3);
        swap(this, i + 1, i + 2);
      }
      return this
    };

    Buffer.prototype.swap64 = function swap64 () {
      var len = this.length;
      if (len % 8 !== 0) {
        throw new RangeError('Buffer size must be a multiple of 64-bits')
      }
      for (var i = 0; i < len; i += 8) {
        swap(this, i, i + 7);
        swap(this, i + 1, i + 6);
        swap(this, i + 2, i + 5);
        swap(this, i + 3, i + 4);
      }
      return this
    };

    Buffer.prototype.toString = function toString () {
      var length = this.length | 0;
      if (length === 0) return ''
      if (arguments.length === 0) return utf8Slice(this, 0, length)
      return slowToString.apply(this, arguments)
    };

    Buffer.prototype.equals = function equals (b) {
      if (!internalIsBuffer(b)) throw new TypeError('Argument must be a Buffer')
      if (this === b) return true
      return Buffer.compare(this, b) === 0
    };

    Buffer.prototype.inspect = function inspect () {
      var str = '';
      var max = INSPECT_MAX_BYTES;
      if (this.length > 0) {
        str = this.toString('hex', 0, max).match(/.{2}/g).join(' ');
        if (this.length > max) str += ' ... ';
      }
      return '<Buffer ' + str + '>'
    };

    Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
      if (!internalIsBuffer(target)) {
        throw new TypeError('Argument must be a Buffer')
      }

      if (start === undefined) {
        start = 0;
      }
      if (end === undefined) {
        end = target ? target.length : 0;
      }
      if (thisStart === undefined) {
        thisStart = 0;
      }
      if (thisEnd === undefined) {
        thisEnd = this.length;
      }

      if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
        throw new RangeError('out of range index')
      }

      if (thisStart >= thisEnd && start >= end) {
        return 0
      }
      if (thisStart >= thisEnd) {
        return -1
      }
      if (start >= end) {
        return 1
      }

      start >>>= 0;
      end >>>= 0;
      thisStart >>>= 0;
      thisEnd >>>= 0;

      if (this === target) return 0

      var x = thisEnd - thisStart;
      var y = end - start;
      var len = Math.min(x, y);

      var thisCopy = this.slice(thisStart, thisEnd);
      var targetCopy = target.slice(start, end);

      for (var i = 0; i < len; ++i) {
        if (thisCopy[i] !== targetCopy[i]) {
          x = thisCopy[i];
          y = targetCopy[i];
          break
        }
      }

      if (x < y) return -1
      if (y < x) return 1
      return 0
    };

    // Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
    // OR the last index of `val` in `buffer` at offset <= `byteOffset`.
    //
    // Arguments:
    // - buffer - a Buffer to search
    // - val - a string, Buffer, or number
    // - byteOffset - an index into `buffer`; will be clamped to an int32
    // - encoding - an optional encoding, relevant is val is a string
    // - dir - true for indexOf, false for lastIndexOf
    function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
      // Empty buffer means no match
      if (buffer.length === 0) return -1

      // Normalize byteOffset
      if (typeof byteOffset === 'string') {
        encoding = byteOffset;
        byteOffset = 0;
      } else if (byteOffset > 0x7fffffff) {
        byteOffset = 0x7fffffff;
      } else if (byteOffset < -0x80000000) {
        byteOffset = -0x80000000;
      }
      byteOffset = +byteOffset;  // Coerce to Number.
      if (isNaN(byteOffset)) {
        // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
        byteOffset = dir ? 0 : (buffer.length - 1);
      }

      // Normalize byteOffset: negative offsets start from the end of the buffer
      if (byteOffset < 0) byteOffset = buffer.length + byteOffset;
      if (byteOffset >= buffer.length) {
        if (dir) return -1
        else byteOffset = buffer.length - 1;
      } else if (byteOffset < 0) {
        if (dir) byteOffset = 0;
        else return -1
      }

      // Normalize val
      if (typeof val === 'string') {
        val = Buffer.from(val, encoding);
      }

      // Finally, search either indexOf (if dir is true) or lastIndexOf
      if (internalIsBuffer(val)) {
        // Special case: looking for empty string/buffer always fails
        if (val.length === 0) {
          return -1
        }
        return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
      } else if (typeof val === 'number') {
        val = val & 0xFF; // Search for a byte value [0-255]
        if (Buffer.TYPED_ARRAY_SUPPORT &&
            typeof Uint8Array.prototype.indexOf === 'function') {
          if (dir) {
            return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
          } else {
            return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
          }
        }
        return arrayIndexOf(buffer, [ val ], byteOffset, encoding, dir)
      }

      throw new TypeError('val must be string, number or Buffer')
    }

    function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
      var indexSize = 1;
      var arrLength = arr.length;
      var valLength = val.length;

      if (encoding !== undefined) {
        encoding = String(encoding).toLowerCase();
        if (encoding === 'ucs2' || encoding === 'ucs-2' ||
            encoding === 'utf16le' || encoding === 'utf-16le') {
          if (arr.length < 2 || val.length < 2) {
            return -1
          }
          indexSize = 2;
          arrLength /= 2;
          valLength /= 2;
          byteOffset /= 2;
        }
      }

      function read (buf, i) {
        if (indexSize === 1) {
          return buf[i]
        } else {
          return buf.readUInt16BE(i * indexSize)
        }
      }

      var i;
      if (dir) {
        var foundIndex = -1;
        for (i = byteOffset; i < arrLength; i++) {
          if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
            if (foundIndex === -1) foundIndex = i;
            if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
          } else {
            if (foundIndex !== -1) i -= i - foundIndex;
            foundIndex = -1;
          }
        }
      } else {
        if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength;
        for (i = byteOffset; i >= 0; i--) {
          var found = true;
          for (var j = 0; j < valLength; j++) {
            if (read(arr, i + j) !== read(val, j)) {
              found = false;
              break
            }
          }
          if (found) return i
        }
      }

      return -1
    }

    Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
      return this.indexOf(val, byteOffset, encoding) !== -1
    };

    Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
    };

    Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
    };

    function hexWrite (buf, string, offset, length) {
      offset = Number(offset) || 0;
      var remaining = buf.length - offset;
      if (!length) {
        length = remaining;
      } else {
        length = Number(length);
        if (length > remaining) {
          length = remaining;
        }
      }

      // must be an even number of digits
      var strLen = string.length;
      if (strLen % 2 !== 0) throw new TypeError('Invalid hex string')

      if (length > strLen / 2) {
        length = strLen / 2;
      }
      for (var i = 0; i < length; ++i) {
        var parsed = parseInt(string.substr(i * 2, 2), 16);
        if (isNaN(parsed)) return i
        buf[offset + i] = parsed;
      }
      return i
    }

    function utf8Write (buf, string, offset, length) {
      return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
    }

    function asciiWrite (buf, string, offset, length) {
      return blitBuffer(asciiToBytes(string), buf, offset, length)
    }

    function latin1Write (buf, string, offset, length) {
      return asciiWrite(buf, string, offset, length)
    }

    function base64Write (buf, string, offset, length) {
      return blitBuffer(base64ToBytes(string), buf, offset, length)
    }

    function ucs2Write (buf, string, offset, length) {
      return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
    }

    Buffer.prototype.write = function write (string, offset, length, encoding) {
      // Buffer#write(string)
      if (offset === undefined) {
        encoding = 'utf8';
        length = this.length;
        offset = 0;
      // Buffer#write(string, encoding)
      } else if (length === undefined && typeof offset === 'string') {
        encoding = offset;
        length = this.length;
        offset = 0;
      // Buffer#write(string, offset[, length][, encoding])
      } else if (isFinite(offset)) {
        offset = offset | 0;
        if (isFinite(length)) {
          length = length | 0;
          if (encoding === undefined) encoding = 'utf8';
        } else {
          encoding = length;
          length = undefined;
        }
      // legacy write(string, encoding, offset, length) - remove in v0.13
      } else {
        throw new Error(
          'Buffer.write(string, encoding, offset[, length]) is no longer supported'
        )
      }

      var remaining = this.length - offset;
      if (length === undefined || length > remaining) length = remaining;

      if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
        throw new RangeError('Attempt to write outside buffer bounds')
      }

      if (!encoding) encoding = 'utf8';

      var loweredCase = false;
      for (;;) {
        switch (encoding) {
          case 'hex':
            return hexWrite(this, string, offset, length)

          case 'utf8':
          case 'utf-8':
            return utf8Write(this, string, offset, length)

          case 'ascii':
            return asciiWrite(this, string, offset, length)

          case 'latin1':
          case 'binary':
            return latin1Write(this, string, offset, length)

          case 'base64':
            // Warning: maxLength not taken into account in base64Write
            return base64Write(this, string, offset, length)

          case 'ucs2':
          case 'ucs-2':
          case 'utf16le':
          case 'utf-16le':
            return ucs2Write(this, string, offset, length)

          default:
            if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
            encoding = ('' + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    };

    Buffer.prototype.toJSON = function toJSON () {
      return {
        type: 'Buffer',
        data: Array.prototype.slice.call(this._arr || this, 0)
      }
    };

    function base64Slice (buf, start, end) {
      if (start === 0 && end === buf.length) {
        return fromByteArray(buf)
      } else {
        return fromByteArray(buf.slice(start, end))
      }
    }

    function utf8Slice (buf, start, end) {
      end = Math.min(buf.length, end);
      var res = [];

      var i = start;
      while (i < end) {
        var firstByte = buf[i];
        var codePoint = null;
        var bytesPerSequence = (firstByte > 0xEF) ? 4
          : (firstByte > 0xDF) ? 3
          : (firstByte > 0xBF) ? 2
          : 1;

        if (i + bytesPerSequence <= end) {
          var secondByte, thirdByte, fourthByte, tempCodePoint;

          switch (bytesPerSequence) {
            case 1:
              if (firstByte < 0x80) {
                codePoint = firstByte;
              }
              break
            case 2:
              secondByte = buf[i + 1];
              if ((secondByte & 0xC0) === 0x80) {
                tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F);
                if (tempCodePoint > 0x7F) {
                  codePoint = tempCodePoint;
                }
              }
              break
            case 3:
              secondByte = buf[i + 1];
              thirdByte = buf[i + 2];
              if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
                tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F);
                if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
                  codePoint = tempCodePoint;
                }
              }
              break
            case 4:
              secondByte = buf[i + 1];
              thirdByte = buf[i + 2];
              fourthByte = buf[i + 3];
              if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
                tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F);
                if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
                  codePoint = tempCodePoint;
                }
              }
          }
        }

        if (codePoint === null) {
          // we did not generate a valid codePoint so insert a
          // replacement char (U+FFFD) and advance only 1 byte
          codePoint = 0xFFFD;
          bytesPerSequence = 1;
        } else if (codePoint > 0xFFFF) {
          // encode to utf16 (surrogate pair dance)
          codePoint -= 0x10000;
          res.push(codePoint >>> 10 & 0x3FF | 0xD800);
          codePoint = 0xDC00 | codePoint & 0x3FF;
        }

        res.push(codePoint);
        i += bytesPerSequence;
      }

      return decodeCodePointsArray(res)
    }

    // Based on http://stackoverflow.com/a/22747272/680742, the browser with
    // the lowest limit is Chrome, with 0x10000 args.
    // We go 1 magnitude less, for safety
    var MAX_ARGUMENTS_LENGTH = 0x1000;

    function decodeCodePointsArray (codePoints) {
      var len = codePoints.length;
      if (len <= MAX_ARGUMENTS_LENGTH) {
        return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
      }

      // Decode in chunks to avoid "call stack size exceeded".
      var res = '';
      var i = 0;
      while (i < len) {
        res += String.fromCharCode.apply(
          String,
          codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
        );
      }
      return res
    }

    function asciiSlice (buf, start, end) {
      var ret = '';
      end = Math.min(buf.length, end);

      for (var i = start; i < end; ++i) {
        ret += String.fromCharCode(buf[i] & 0x7F);
      }
      return ret
    }

    function latin1Slice (buf, start, end) {
      var ret = '';
      end = Math.min(buf.length, end);

      for (var i = start; i < end; ++i) {
        ret += String.fromCharCode(buf[i]);
      }
      return ret
    }

    function hexSlice (buf, start, end) {
      var len = buf.length;

      if (!start || start < 0) start = 0;
      if (!end || end < 0 || end > len) end = len;

      var out = '';
      for (var i = start; i < end; ++i) {
        out += toHex(buf[i]);
      }
      return out
    }

    function utf16leSlice (buf, start, end) {
      var bytes = buf.slice(start, end);
      var res = '';
      for (var i = 0; i < bytes.length; i += 2) {
        res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
      }
      return res
    }

    Buffer.prototype.slice = function slice (start, end) {
      var len = this.length;
      start = ~~start;
      end = end === undefined ? len : ~~end;

      if (start < 0) {
        start += len;
        if (start < 0) start = 0;
      } else if (start > len) {
        start = len;
      }

      if (end < 0) {
        end += len;
        if (end < 0) end = 0;
      } else if (end > len) {
        end = len;
      }

      if (end < start) end = start;

      var newBuf;
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        newBuf = this.subarray(start, end);
        newBuf.__proto__ = Buffer.prototype;
      } else {
        var sliceLen = end - start;
        newBuf = new Buffer(sliceLen, undefined);
        for (var i = 0; i < sliceLen; ++i) {
          newBuf[i] = this[i + start];
        }
      }

      return newBuf
    };

    /*
     * Need to make sure that buffer isn't trying to write out of bounds.
     */
    function checkOffset (offset, ext, length) {
      if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
      if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
    }

    Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
      offset = offset | 0;
      byteLength = byteLength | 0;
      if (!noAssert) checkOffset(offset, byteLength, this.length);

      var val = this[offset];
      var mul = 1;
      var i = 0;
      while (++i < byteLength && (mul *= 0x100)) {
        val += this[offset + i] * mul;
      }

      return val
    };

    Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
      offset = offset | 0;
      byteLength = byteLength | 0;
      if (!noAssert) {
        checkOffset(offset, byteLength, this.length);
      }

      var val = this[offset + --byteLength];
      var mul = 1;
      while (byteLength > 0 && (mul *= 0x100)) {
        val += this[offset + --byteLength] * mul;
      }

      return val
    };

    Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 1, this.length);
      return this[offset]
    };

    Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 2, this.length);
      return this[offset] | (this[offset + 1] << 8)
    };

    Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 2, this.length);
      return (this[offset] << 8) | this[offset + 1]
    };

    Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 4, this.length);

      return ((this[offset]) |
          (this[offset + 1] << 8) |
          (this[offset + 2] << 16)) +
          (this[offset + 3] * 0x1000000)
    };

    Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 4, this.length);

      return (this[offset] * 0x1000000) +
        ((this[offset + 1] << 16) |
        (this[offset + 2] << 8) |
        this[offset + 3])
    };

    Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
      offset = offset | 0;
      byteLength = byteLength | 0;
      if (!noAssert) checkOffset(offset, byteLength, this.length);

      var val = this[offset];
      var mul = 1;
      var i = 0;
      while (++i < byteLength && (mul *= 0x100)) {
        val += this[offset + i] * mul;
      }
      mul *= 0x80;

      if (val >= mul) val -= Math.pow(2, 8 * byteLength);

      return val
    };

    Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
      offset = offset | 0;
      byteLength = byteLength | 0;
      if (!noAssert) checkOffset(offset, byteLength, this.length);

      var i = byteLength;
      var mul = 1;
      var val = this[offset + --i];
      while (i > 0 && (mul *= 0x100)) {
        val += this[offset + --i] * mul;
      }
      mul *= 0x80;

      if (val >= mul) val -= Math.pow(2, 8 * byteLength);

      return val
    };

    Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 1, this.length);
      if (!(this[offset] & 0x80)) return (this[offset])
      return ((0xff - this[offset] + 1) * -1)
    };

    Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 2, this.length);
      var val = this[offset] | (this[offset + 1] << 8);
      return (val & 0x8000) ? val | 0xFFFF0000 : val
    };

    Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 2, this.length);
      var val = this[offset + 1] | (this[offset] << 8);
      return (val & 0x8000) ? val | 0xFFFF0000 : val
    };

    Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 4, this.length);

      return (this[offset]) |
        (this[offset + 1] << 8) |
        (this[offset + 2] << 16) |
        (this[offset + 3] << 24)
    };

    Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 4, this.length);

      return (this[offset] << 24) |
        (this[offset + 1] << 16) |
        (this[offset + 2] << 8) |
        (this[offset + 3])
    };

    Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 4, this.length);
      return read(this, offset, true, 23, 4)
    };

    Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 4, this.length);
      return read(this, offset, false, 23, 4)
    };

    Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 8, this.length);
      return read(this, offset, true, 52, 8)
    };

    Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 8, this.length);
      return read(this, offset, false, 52, 8)
    };

    function checkInt (buf, value, offset, ext, max, min) {
      if (!internalIsBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
      if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
      if (offset + ext > buf.length) throw new RangeError('Index out of range')
    }

    Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
      value = +value;
      offset = offset | 0;
      byteLength = byteLength | 0;
      if (!noAssert) {
        var maxBytes = Math.pow(2, 8 * byteLength) - 1;
        checkInt(this, value, offset, byteLength, maxBytes, 0);
      }

      var mul = 1;
      var i = 0;
      this[offset] = value & 0xFF;
      while (++i < byteLength && (mul *= 0x100)) {
        this[offset + i] = (value / mul) & 0xFF;
      }

      return offset + byteLength
    };

    Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
      value = +value;
      offset = offset | 0;
      byteLength = byteLength | 0;
      if (!noAssert) {
        var maxBytes = Math.pow(2, 8 * byteLength) - 1;
        checkInt(this, value, offset, byteLength, maxBytes, 0);
      }

      var i = byteLength - 1;
      var mul = 1;
      this[offset + i] = value & 0xFF;
      while (--i >= 0 && (mul *= 0x100)) {
        this[offset + i] = (value / mul) & 0xFF;
      }

      return offset + byteLength
    };

    Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0);
      if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value);
      this[offset] = (value & 0xff);
      return offset + 1
    };

    function objectWriteUInt16 (buf, value, offset, littleEndian) {
      if (value < 0) value = 0xffff + value + 1;
      for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; ++i) {
        buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
          (littleEndian ? i : 1 - i) * 8;
      }
    }

    Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0);
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        this[offset] = (value & 0xff);
        this[offset + 1] = (value >>> 8);
      } else {
        objectWriteUInt16(this, value, offset, true);
      }
      return offset + 2
    };

    Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0);
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        this[offset] = (value >>> 8);
        this[offset + 1] = (value & 0xff);
      } else {
        objectWriteUInt16(this, value, offset, false);
      }
      return offset + 2
    };

    function objectWriteUInt32 (buf, value, offset, littleEndian) {
      if (value < 0) value = 0xffffffff + value + 1;
      for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; ++i) {
        buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff;
      }
    }

    Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0);
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        this[offset + 3] = (value >>> 24);
        this[offset + 2] = (value >>> 16);
        this[offset + 1] = (value >>> 8);
        this[offset] = (value & 0xff);
      } else {
        objectWriteUInt32(this, value, offset, true);
      }
      return offset + 4
    };

    Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0);
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        this[offset] = (value >>> 24);
        this[offset + 1] = (value >>> 16);
        this[offset + 2] = (value >>> 8);
        this[offset + 3] = (value & 0xff);
      } else {
        objectWriteUInt32(this, value, offset, false);
      }
      return offset + 4
    };

    Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) {
        var limit = Math.pow(2, 8 * byteLength - 1);

        checkInt(this, value, offset, byteLength, limit - 1, -limit);
      }

      var i = 0;
      var mul = 1;
      var sub = 0;
      this[offset] = value & 0xFF;
      while (++i < byteLength && (mul *= 0x100)) {
        if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
          sub = 1;
        }
        this[offset + i] = ((value / mul) >> 0) - sub & 0xFF;
      }

      return offset + byteLength
    };

    Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) {
        var limit = Math.pow(2, 8 * byteLength - 1);

        checkInt(this, value, offset, byteLength, limit - 1, -limit);
      }

      var i = byteLength - 1;
      var mul = 1;
      var sub = 0;
      this[offset + i] = value & 0xFF;
      while (--i >= 0 && (mul *= 0x100)) {
        if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
          sub = 1;
        }
        this[offset + i] = ((value / mul) >> 0) - sub & 0xFF;
      }

      return offset + byteLength
    };

    Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80);
      if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value);
      if (value < 0) value = 0xff + value + 1;
      this[offset] = (value & 0xff);
      return offset + 1
    };

    Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000);
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        this[offset] = (value & 0xff);
        this[offset + 1] = (value >>> 8);
      } else {
        objectWriteUInt16(this, value, offset, true);
      }
      return offset + 2
    };

    Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000);
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        this[offset] = (value >>> 8);
        this[offset + 1] = (value & 0xff);
      } else {
        objectWriteUInt16(this, value, offset, false);
      }
      return offset + 2
    };

    Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000);
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        this[offset] = (value & 0xff);
        this[offset + 1] = (value >>> 8);
        this[offset + 2] = (value >>> 16);
        this[offset + 3] = (value >>> 24);
      } else {
        objectWriteUInt32(this, value, offset, true);
      }
      return offset + 4
    };

    Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000);
      if (value < 0) value = 0xffffffff + value + 1;
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        this[offset] = (value >>> 24);
        this[offset + 1] = (value >>> 16);
        this[offset + 2] = (value >>> 8);
        this[offset + 3] = (value & 0xff);
      } else {
        objectWriteUInt32(this, value, offset, false);
      }
      return offset + 4
    };

    function checkIEEE754 (buf, value, offset, ext, max, min) {
      if (offset + ext > buf.length) throw new RangeError('Index out of range')
      if (offset < 0) throw new RangeError('Index out of range')
    }

    function writeFloat (buf, value, offset, littleEndian, noAssert) {
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38);
      }
      write(buf, value, offset, littleEndian, 23, 4);
      return offset + 4
    }

    Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
      return writeFloat(this, value, offset, true, noAssert)
    };

    Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
      return writeFloat(this, value, offset, false, noAssert)
    };

    function writeDouble (buf, value, offset, littleEndian, noAssert) {
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308);
      }
      write(buf, value, offset, littleEndian, 52, 8);
      return offset + 8
    }

    Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
      return writeDouble(this, value, offset, true, noAssert)
    };

    Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
      return writeDouble(this, value, offset, false, noAssert)
    };

    // copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
    Buffer.prototype.copy = function copy (target, targetStart, start, end) {
      if (!start) start = 0;
      if (!end && end !== 0) end = this.length;
      if (targetStart >= target.length) targetStart = target.length;
      if (!targetStart) targetStart = 0;
      if (end > 0 && end < start) end = start;

      // Copy 0 bytes; we're done
      if (end === start) return 0
      if (target.length === 0 || this.length === 0) return 0

      // Fatal error conditions
      if (targetStart < 0) {
        throw new RangeError('targetStart out of bounds')
      }
      if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
      if (end < 0) throw new RangeError('sourceEnd out of bounds')

      // Are we oob?
      if (end > this.length) end = this.length;
      if (target.length - targetStart < end - start) {
        end = target.length - targetStart + start;
      }

      var len = end - start;
      var i;

      if (this === target && start < targetStart && targetStart < end) {
        // descending copy from end
        for (i = len - 1; i >= 0; --i) {
          target[i + targetStart] = this[i + start];
        }
      } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
        // ascending copy from start
        for (i = 0; i < len; ++i) {
          target[i + targetStart] = this[i + start];
        }
      } else {
        Uint8Array.prototype.set.call(
          target,
          this.subarray(start, start + len),
          targetStart
        );
      }

      return len
    };

    // Usage:
    //    buffer.fill(number[, offset[, end]])
    //    buffer.fill(buffer[, offset[, end]])
    //    buffer.fill(string[, offset[, end]][, encoding])
    Buffer.prototype.fill = function fill (val, start, end, encoding) {
      // Handle string cases:
      if (typeof val === 'string') {
        if (typeof start === 'string') {
          encoding = start;
          start = 0;
          end = this.length;
        } else if (typeof end === 'string') {
          encoding = end;
          end = this.length;
        }
        if (val.length === 1) {
          var code = val.charCodeAt(0);
          if (code < 256) {
            val = code;
          }
        }
        if (encoding !== undefined && typeof encoding !== 'string') {
          throw new TypeError('encoding must be a string')
        }
        if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
          throw new TypeError('Unknown encoding: ' + encoding)
        }
      } else if (typeof val === 'number') {
        val = val & 255;
      }

      // Invalid ranges are not set to a default, so can range check early.
      if (start < 0 || this.length < start || this.length < end) {
        throw new RangeError('Out of range index')
      }

      if (end <= start) {
        return this
      }

      start = start >>> 0;
      end = end === undefined ? this.length : end >>> 0;

      if (!val) val = 0;

      var i;
      if (typeof val === 'number') {
        for (i = start; i < end; ++i) {
          this[i] = val;
        }
      } else {
        var bytes = internalIsBuffer(val)
          ? val
          : utf8ToBytes(new Buffer(val, encoding).toString());
        var len = bytes.length;
        for (i = 0; i < end - start; ++i) {
          this[i + start] = bytes[i % len];
        }
      }

      return this
    };

    // HELPER FUNCTIONS
    // ================

    var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g;

    function base64clean (str) {
      // Node strips out invalid characters like \n and \t from the string, base64-js does not
      str = stringtrim(str).replace(INVALID_BASE64_RE, '');
      // Node converts strings with length < 2 to ''
      if (str.length < 2) return ''
      // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
      while (str.length % 4 !== 0) {
        str = str + '=';
      }
      return str
    }

    function stringtrim (str) {
      if (str.trim) return str.trim()
      return str.replace(/^\s+|\s+$/g, '')
    }

    function toHex (n) {
      if (n < 16) return '0' + n.toString(16)
      return n.toString(16)
    }

    function utf8ToBytes (string, units) {
      units = units || Infinity;
      var codePoint;
      var length = string.length;
      var leadSurrogate = null;
      var bytes = [];

      for (var i = 0; i < length; ++i) {
        codePoint = string.charCodeAt(i);

        // is surrogate component
        if (codePoint > 0xD7FF && codePoint < 0xE000) {
          // last char was a lead
          if (!leadSurrogate) {
            // no lead yet
            if (codePoint > 0xDBFF) {
              // unexpected trail
              if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
              continue
            } else if (i + 1 === length) {
              // unpaired lead
              if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
              continue
            }

            // valid lead
            leadSurrogate = codePoint;

            continue
          }

          // 2 leads in a row
          if (codePoint < 0xDC00) {
            if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
            leadSurrogate = codePoint;
            continue
          }

          // valid surrogate pair
          codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000;
        } else if (leadSurrogate) {
          // valid bmp char, but last char was a lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
        }

        leadSurrogate = null;

        // encode utf8
        if (codePoint < 0x80) {
          if ((units -= 1) < 0) break
          bytes.push(codePoint);
        } else if (codePoint < 0x800) {
          if ((units -= 2) < 0) break
          bytes.push(
            codePoint >> 0x6 | 0xC0,
            codePoint & 0x3F | 0x80
          );
        } else if (codePoint < 0x10000) {
          if ((units -= 3) < 0) break
          bytes.push(
            codePoint >> 0xC | 0xE0,
            codePoint >> 0x6 & 0x3F | 0x80,
            codePoint & 0x3F | 0x80
          );
        } else if (codePoint < 0x110000) {
          if ((units -= 4) < 0) break
          bytes.push(
            codePoint >> 0x12 | 0xF0,
            codePoint >> 0xC & 0x3F | 0x80,
            codePoint >> 0x6 & 0x3F | 0x80,
            codePoint & 0x3F | 0x80
          );
        } else {
          throw new Error('Invalid code point')
        }
      }

      return bytes
    }

    function asciiToBytes (str) {
      var byteArray = [];
      for (var i = 0; i < str.length; ++i) {
        // Node's code seems to be doing this and not & 0x7F..
        byteArray.push(str.charCodeAt(i) & 0xFF);
      }
      return byteArray
    }

    function utf16leToBytes (str, units) {
      var c, hi, lo;
      var byteArray = [];
      for (var i = 0; i < str.length; ++i) {
        if ((units -= 2) < 0) break

        c = str.charCodeAt(i);
        hi = c >> 8;
        lo = c % 256;
        byteArray.push(lo);
        byteArray.push(hi);
      }

      return byteArray
    }


    function base64ToBytes (str) {
      return toByteArray(base64clean(str))
    }

    function blitBuffer (src, dst, offset, length) {
      for (var i = 0; i < length; ++i) {
        if ((i + offset >= dst.length) || (i >= src.length)) break
        dst[i + offset] = src[i];
      }
      return i
    }

    function isnan (val) {
      return val !== val // eslint-disable-line no-self-compare
    }


    // the following is from is-buffer, also by Feross Aboukhadijeh and with same lisence
    // The _isBuffer check is for Safari 5-7 support, because it's missing
    // Object.prototype.constructor. Remove this eventually
    function isBuffer(obj) {
      return obj != null && (!!obj._isBuffer || isFastBuffer(obj) || isSlowBuffer(obj))
    }

    function isFastBuffer (obj) {
      return !!obj.constructor && typeof obj.constructor.isBuffer === 'function' && obj.constructor.isBuffer(obj)
    }

    // For Node v0.10 support. Remove this eventually.
    function isSlowBuffer (obj) {
      return typeof obj.readFloatLE === 'function' && typeof obj.slice === 'function' && isFastBuffer(obj.slice(0, 0))
    }

    var isBuffer$1 = isBuf;

    var withNativeBuffer = typeof Buffer === 'function' && typeof isBuffer === 'function';
    var withNativeArrayBuffer = typeof ArrayBuffer === 'function';

    var isView = function (obj) {
      return typeof ArrayBuffer.isView === 'function' ? ArrayBuffer.isView(obj) : (obj.buffer instanceof ArrayBuffer);
    };

    /**
     * Returns true if obj is a buffer or an arraybuffer.
     *
     * @api private
     */

    function isBuf(obj) {
      return (withNativeBuffer && isBuffer(obj)) ||
              (withNativeArrayBuffer && (obj instanceof ArrayBuffer || isView(obj)));
    }

    /*global Blob,File*/

    /**
     * Module requirements
     */



    var toString$2 = Object.prototype.toString;
    var withNativeBlob = typeof Blob === 'function' || (typeof Blob !== 'undefined' && toString$2.call(Blob) === '[object BlobConstructor]');
    var withNativeFile = typeof File === 'function' || (typeof File !== 'undefined' && toString$2.call(File) === '[object FileConstructor]');

    /**
     * Replaces every Buffer | ArrayBuffer in packet with a numbered placeholder.
     * Anything with blobs or files should be fed through removeBlobs before coming
     * here.
     *
     * @param {Object} packet - socket.io event packet
     * @return {Object} with deconstructed packet and list of buffers
     * @api public
     */

    var deconstructPacket = function(packet) {
      var buffers = [];
      var packetData = packet.data;
      var pack = packet;
      pack.data = _deconstructPacket(packetData, buffers);
      pack.attachments = buffers.length; // number of binary 'attachments'
      return {packet: pack, buffers: buffers};
    };

    function _deconstructPacket(data, buffers) {
      if (!data) return data;

      if (isBuffer$1(data)) {
        var placeholder = { _placeholder: true, num: buffers.length };
        buffers.push(data);
        return placeholder;
      } else if (isarray(data)) {
        var newData = new Array(data.length);
        for (var i = 0; i < data.length; i++) {
          newData[i] = _deconstructPacket(data[i], buffers);
        }
        return newData;
      } else if (typeof data === 'object' && !(data instanceof Date)) {
        var newData = {};
        for (var key in data) {
          newData[key] = _deconstructPacket(data[key], buffers);
        }
        return newData;
      }
      return data;
    }

    /**
     * Reconstructs a binary packet from its placeholder packet and buffers
     *
     * @param {Object} packet - event packet with placeholders
     * @param {Array} buffers - binary buffers to put in placeholder positions
     * @return {Object} reconstructed packet
     * @api public
     */

    var reconstructPacket = function(packet, buffers) {
      packet.data = _reconstructPacket(packet.data, buffers);
      packet.attachments = undefined; // no longer useful
      return packet;
    };

    function _reconstructPacket(data, buffers) {
      if (!data) return data;

      if (data && data._placeholder) {
        return buffers[data.num]; // appropriate buffer (should be natural order anyway)
      } else if (isarray(data)) {
        for (var i = 0; i < data.length; i++) {
          data[i] = _reconstructPacket(data[i], buffers);
        }
      } else if (typeof data === 'object') {
        for (var key in data) {
          data[key] = _reconstructPacket(data[key], buffers);
        }
      }

      return data;
    }

    /**
     * Asynchronously removes Blobs or Files from data via
     * FileReader's readAsArrayBuffer method. Used before encoding
     * data as msgpack. Calls callback with the blobless data.
     *
     * @param {Object} data
     * @param {Function} callback
     * @api private
     */

    var removeBlobs = function(data, callback) {
      function _removeBlobs(obj, curKey, containingObject) {
        if (!obj) return obj;

        // convert any blob
        if ((withNativeBlob && obj instanceof Blob) ||
            (withNativeFile && obj instanceof File)) {
          pendingBlobs++;

          // async filereader
          var fileReader = new FileReader();
          fileReader.onload = function() { // this.result == arraybuffer
            if (containingObject) {
              containingObject[curKey] = this.result;
            }
            else {
              bloblessData = this.result;
            }

            // if nothing pending its callback time
            if(! --pendingBlobs) {
              callback(bloblessData);
            }
          };

          fileReader.readAsArrayBuffer(obj); // blob -> arraybuffer
        } else if (isarray(obj)) { // handle array
          for (var i = 0; i < obj.length; i++) {
            _removeBlobs(obj[i], i, obj);
          }
        } else if (typeof obj === 'object' && !isBuffer$1(obj)) { // and object
          for (var key in obj) {
            _removeBlobs(obj[key], key, obj);
          }
        }
      }

      var pendingBlobs = 0;
      var bloblessData = data;
      _removeBlobs(bloblessData);
      if (!pendingBlobs) {
        callback(bloblessData);
      }
    };

    var binary = {
    	deconstructPacket: deconstructPacket,
    	reconstructPacket: reconstructPacket,
    	removeBlobs: removeBlobs
    };

    var socket_ioParser = createCommonjsModule(function (module, exports) {
    /**
     * Module dependencies.
     */

    var debug = browser$2('socket.io-parser');





    /**
     * Protocol version.
     *
     * @api public
     */

    exports.protocol = 4;

    /**
     * Packet types.
     *
     * @api public
     */

    exports.types = [
      'CONNECT',
      'DISCONNECT',
      'EVENT',
      'ACK',
      'ERROR',
      'BINARY_EVENT',
      'BINARY_ACK'
    ];

    /**
     * Packet type `connect`.
     *
     * @api public
     */

    exports.CONNECT = 0;

    /**
     * Packet type `disconnect`.
     *
     * @api public
     */

    exports.DISCONNECT = 1;

    /**
     * Packet type `event`.
     *
     * @api public
     */

    exports.EVENT = 2;

    /**
     * Packet type `ack`.
     *
     * @api public
     */

    exports.ACK = 3;

    /**
     * Packet type `error`.
     *
     * @api public
     */

    exports.ERROR = 4;

    /**
     * Packet type 'binary event'
     *
     * @api public
     */

    exports.BINARY_EVENT = 5;

    /**
     * Packet type `binary ack`. For acks with binary arguments.
     *
     * @api public
     */

    exports.BINARY_ACK = 6;

    /**
     * Encoder constructor.
     *
     * @api public
     */

    exports.Encoder = Encoder;

    /**
     * Decoder constructor.
     *
     * @api public
     */

    exports.Decoder = Decoder;

    /**
     * A socket.io Encoder instance
     *
     * @api public
     */

    function Encoder() {}

    var ERROR_PACKET = exports.ERROR + '"encode error"';

    /**
     * Encode a packet as a single string if non-binary, or as a
     * buffer sequence, depending on packet type.
     *
     * @param {Object} obj - packet object
     * @param {Function} callback - function to handle encodings (likely engine.write)
     * @return Calls callback with Array of encodings
     * @api public
     */

    Encoder.prototype.encode = function(obj, callback){
      debug('encoding packet %j', obj);

      if (exports.BINARY_EVENT === obj.type || exports.BINARY_ACK === obj.type) {
        encodeAsBinary(obj, callback);
      } else {
        var encoding = encodeAsString(obj);
        callback([encoding]);
      }
    };

    /**
     * Encode packet as string.
     *
     * @param {Object} packet
     * @return {String} encoded
     * @api private
     */

    function encodeAsString(obj) {

      // first is type
      var str = '' + obj.type;

      // attachments if we have them
      if (exports.BINARY_EVENT === obj.type || exports.BINARY_ACK === obj.type) {
        str += obj.attachments + '-';
      }

      // if we have a namespace other than `/`
      // we append it followed by a comma `,`
      if (obj.nsp && '/' !== obj.nsp) {
        str += obj.nsp + ',';
      }

      // immediately followed by the id
      if (null != obj.id) {
        str += obj.id;
      }

      // json data
      if (null != obj.data) {
        var payload = tryStringify(obj.data);
        if (payload !== false) {
          str += payload;
        } else {
          return ERROR_PACKET;
        }
      }

      debug('encoded %j as %s', obj, str);
      return str;
    }

    function tryStringify(str) {
      try {
        return JSON.stringify(str);
      } catch(e){
        return false;
      }
    }

    /**
     * Encode packet as 'buffer sequence' by removing blobs, and
     * deconstructing packet into object with placeholders and
     * a list of buffers.
     *
     * @param {Object} packet
     * @return {Buffer} encoded
     * @api private
     */

    function encodeAsBinary(obj, callback) {

      function writeEncoding(bloblessData) {
        var deconstruction = binary.deconstructPacket(bloblessData);
        var pack = encodeAsString(deconstruction.packet);
        var buffers = deconstruction.buffers;

        buffers.unshift(pack); // add packet info to beginning of data list
        callback(buffers); // write all the buffers
      }

      binary.removeBlobs(obj, writeEncoding);
    }

    /**
     * A socket.io Decoder instance
     *
     * @return {Object} decoder
     * @api public
     */

    function Decoder() {
      this.reconstructor = null;
    }

    /**
     * Mix in `Emitter` with Decoder.
     */

    componentEmitter(Decoder.prototype);

    /**
     * Decodes an encoded packet string into packet JSON.
     *
     * @param {String} obj - encoded packet
     * @return {Object} packet
     * @api public
     */

    Decoder.prototype.add = function(obj) {
      var packet;
      if (typeof obj === 'string') {
        packet = decodeString(obj);
        if (exports.BINARY_EVENT === packet.type || exports.BINARY_ACK === packet.type) { // binary packet's json
          this.reconstructor = new BinaryReconstructor(packet);

          // no attachments, labeled binary but no binary data to follow
          if (this.reconstructor.reconPack.attachments === 0) {
            this.emit('decoded', packet);
          }
        } else { // non-binary full packet
          this.emit('decoded', packet);
        }
      } else if (isBuffer$1(obj) || obj.base64) { // raw binary data
        if (!this.reconstructor) {
          throw new Error('got binary data when not reconstructing a packet');
        } else {
          packet = this.reconstructor.takeBinaryData(obj);
          if (packet) { // received final buffer
            this.reconstructor = null;
            this.emit('decoded', packet);
          }
        }
      } else {
        throw new Error('Unknown type: ' + obj);
      }
    };

    /**
     * Decode a packet String (JSON data)
     *
     * @param {String} str
     * @return {Object} packet
     * @api private
     */

    function decodeString(str) {
      var i = 0;
      // look up type
      var p = {
        type: Number(str.charAt(0))
      };

      if (null == exports.types[p.type]) {
        return error('unknown packet type ' + p.type);
      }

      // look up attachments if type binary
      if (exports.BINARY_EVENT === p.type || exports.BINARY_ACK === p.type) {
        var buf = '';
        while (str.charAt(++i) !== '-') {
          buf += str.charAt(i);
          if (i == str.length) break;
        }
        if (buf != Number(buf) || str.charAt(i) !== '-') {
          throw new Error('Illegal attachments');
        }
        p.attachments = Number(buf);
      }

      // look up namespace (if any)
      if ('/' === str.charAt(i + 1)) {
        p.nsp = '';
        while (++i) {
          var c = str.charAt(i);
          if (',' === c) break;
          p.nsp += c;
          if (i === str.length) break;
        }
      } else {
        p.nsp = '/';
      }

      // look up id
      var next = str.charAt(i + 1);
      if ('' !== next && Number(next) == next) {
        p.id = '';
        while (++i) {
          var c = str.charAt(i);
          if (null == c || Number(c) != c) {
            --i;
            break;
          }
          p.id += str.charAt(i);
          if (i === str.length) break;
        }
        p.id = Number(p.id);
      }

      // look up json data
      if (str.charAt(++i)) {
        var payload = tryParse(str.substr(i));
        var isPayloadValid = payload !== false && (p.type === exports.ERROR || isarray(payload));
        if (isPayloadValid) {
          p.data = payload;
        } else {
          return error('invalid payload');
        }
      }

      debug('decoded %s as %j', str, p);
      return p;
    }

    function tryParse(str) {
      try {
        return JSON.parse(str);
      } catch(e){
        return false;
      }
    }

    /**
     * Deallocates a parser's resources
     *
     * @api public
     */

    Decoder.prototype.destroy = function() {
      if (this.reconstructor) {
        this.reconstructor.finishedReconstruction();
      }
    };

    /**
     * A manager of a binary event's 'buffer sequence'. Should
     * be constructed whenever a packet of type BINARY_EVENT is
     * decoded.
     *
     * @param {Object} packet
     * @return {BinaryReconstructor} initialized reconstructor
     * @api private
     */

    function BinaryReconstructor(packet) {
      this.reconPack = packet;
      this.buffers = [];
    }

    /**
     * Method to be called when binary data received from connection
     * after a BINARY_EVENT packet.
     *
     * @param {Buffer | ArrayBuffer} binData - the raw binary data received
     * @return {null | Object} returns null if more binary data is expected or
     *   a reconstructed packet object if all buffers have been received.
     * @api private
     */

    BinaryReconstructor.prototype.takeBinaryData = function(binData) {
      this.buffers.push(binData);
      if (this.buffers.length === this.reconPack.attachments) { // done with buffer list
        var packet = binary.reconstructPacket(this.reconPack, this.buffers);
        this.finishedReconstruction();
        return packet;
      }
      return null;
    };

    /**
     * Cleans up binary packet reconstruction variables.
     *
     * @api private
     */

    BinaryReconstructor.prototype.finishedReconstruction = function() {
      this.reconPack = null;
      this.buffers = [];
    };

    function error(msg) {
      return {
        type: exports.ERROR,
        data: 'parser error: ' + msg
      };
    }
    });
    var socket_ioParser_1 = socket_ioParser.protocol;
    var socket_ioParser_2 = socket_ioParser.types;
    var socket_ioParser_3 = socket_ioParser.CONNECT;
    var socket_ioParser_4 = socket_ioParser.DISCONNECT;
    var socket_ioParser_5 = socket_ioParser.EVENT;
    var socket_ioParser_6 = socket_ioParser.ACK;
    var socket_ioParser_7 = socket_ioParser.ERROR;
    var socket_ioParser_8 = socket_ioParser.BINARY_EVENT;
    var socket_ioParser_9 = socket_ioParser.BINARY_ACK;
    var socket_ioParser_10 = socket_ioParser.Encoder;
    var socket_ioParser_11 = socket_ioParser.Decoder;

    var hasCors = createCommonjsModule(function (module) {
    /**
     * Module exports.
     *
     * Logic borrowed from Modernizr:
     *
     *   - https://github.com/Modernizr/Modernizr/blob/master/feature-detects/cors.js
     */

    try {
      module.exports = typeof XMLHttpRequest !== 'undefined' &&
        'withCredentials' in new XMLHttpRequest();
    } catch (err) {
      // if XMLHttp support is disabled in IE then it will throw
      // when trying to create
      module.exports = false;
    }
    });

    var globalThis_browser = (function () {
      if (typeof self !== 'undefined') {
        return self;
      } else if (typeof window !== 'undefined') {
        return window;
      } else {
        return Function('return this')(); // eslint-disable-line no-new-func
      }
    })();

    // browser shim for xmlhttprequest module




    var xmlhttprequest = function (opts) {
      var xdomain = opts.xdomain;

      // scheme must be same when usign XDomainRequest
      // http://blogs.msdn.com/b/ieinternals/archive/2010/05/13/xdomainrequest-restrictions-limitations-and-workarounds.aspx
      var xscheme = opts.xscheme;

      // XDomainRequest has a flow of not sending cookie, therefore it should be disabled as a default.
      // https://github.com/Automattic/engine.io-client/pull/217
      var enablesXDR = opts.enablesXDR;

      // XMLHttpRequest can be disabled on IE
      try {
        if ('undefined' !== typeof XMLHttpRequest && (!xdomain || hasCors)) {
          return new XMLHttpRequest();
        }
      } catch (e) { }

      // Use XDomainRequest for IE8 if enablesXDR is true
      // because loading bar keeps flashing when using jsonp-polling
      // https://github.com/yujiosaka/socke.io-ie8-loading-example
      try {
        if ('undefined' !== typeof XDomainRequest && !xscheme && enablesXDR) {
          return new XDomainRequest();
        }
      } catch (e) { }

      if (!xdomain) {
        try {
          return new globalThis_browser[['Active'].concat('Object').join('X')]('Microsoft.XMLHTTP');
        } catch (e) { }
      }
    };

    /**
     * Gets the keys for an object.
     *
     * @return {Array} keys
     * @api private
     */

    var keys = Object.keys || function keys (obj){
      var arr = [];
      var has = Object.prototype.hasOwnProperty;

      for (var i in obj) {
        if (has.call(obj, i)) {
          arr.push(i);
        }
      }
      return arr;
    };

    /* global Blob File */

    /*
     * Module requirements.
     */



    var toString$3 = Object.prototype.toString;
    var withNativeBlob$1 = typeof Blob === 'function' ||
                            typeof Blob !== 'undefined' && toString$3.call(Blob) === '[object BlobConstructor]';
    var withNativeFile$1 = typeof File === 'function' ||
                            typeof File !== 'undefined' && toString$3.call(File) === '[object FileConstructor]';

    /**
     * Module exports.
     */

    var hasBinary2 = hasBinary;

    /**
     * Checks for binary data.
     *
     * Supports Buffer, ArrayBuffer, Blob and File.
     *
     * @param {Object} anything
     * @api public
     */

    function hasBinary (obj) {
      if (!obj || typeof obj !== 'object') {
        return false;
      }

      if (isarray(obj)) {
        for (var i = 0, l = obj.length; i < l; i++) {
          if (hasBinary(obj[i])) {
            return true;
          }
        }
        return false;
      }

      if ((typeof Buffer === 'function' && isBuffer && isBuffer(obj)) ||
        (typeof ArrayBuffer === 'function' && obj instanceof ArrayBuffer) ||
        (withNativeBlob$1 && obj instanceof Blob) ||
        (withNativeFile$1 && obj instanceof File)
      ) {
        return true;
      }

      // see: https://github.com/Automattic/has-binary/pull/4
      if (obj.toJSON && typeof obj.toJSON === 'function' && arguments.length === 1) {
        return hasBinary(obj.toJSON(), true);
      }

      for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key) && hasBinary(obj[key])) {
          return true;
        }
      }

      return false;
    }

    /**
     * An abstraction for slicing an arraybuffer even when
     * ArrayBuffer.prototype.slice is not supported
     *
     * @api public
     */

    var arraybuffer_slice = function(arraybuffer, start, end) {
      var bytes = arraybuffer.byteLength;
      start = start || 0;
      end = end || bytes;

      if (arraybuffer.slice) { return arraybuffer.slice(start, end); }

      if (start < 0) { start += bytes; }
      if (end < 0) { end += bytes; }
      if (end > bytes) { end = bytes; }

      if (start >= bytes || start >= end || bytes === 0) {
        return new ArrayBuffer(0);
      }

      var abv = new Uint8Array(arraybuffer);
      var result = new Uint8Array(end - start);
      for (var i = start, ii = 0; i < end; i++, ii++) {
        result[ii] = abv[i];
      }
      return result.buffer;
    };

    var after_1 = after;

    function after(count, callback, err_cb) {
        var bail = false;
        err_cb = err_cb || noop$2;
        proxy.count = count;

        return (count === 0) ? callback() : proxy

        function proxy(err, result) {
            if (proxy.count <= 0) {
                throw new Error('after called too many times')
            }
            --proxy.count;

            // after first error, rest are passed to err_cb
            if (err) {
                bail = true;
                callback(err);
                // future error callbacks will go to error handler
                callback = err_cb;
            } else if (proxy.count === 0 && !bail) {
                callback(null, result);
            }
        }
    }

    function noop$2() {}

    /*! https://mths.be/utf8js v2.1.2 by @mathias */

    var stringFromCharCode = String.fromCharCode;

    // Taken from https://mths.be/punycode
    function ucs2decode(string) {
    	var output = [];
    	var counter = 0;
    	var length = string.length;
    	var value;
    	var extra;
    	while (counter < length) {
    		value = string.charCodeAt(counter++);
    		if (value >= 0xD800 && value <= 0xDBFF && counter < length) {
    			// high surrogate, and there is a next character
    			extra = string.charCodeAt(counter++);
    			if ((extra & 0xFC00) == 0xDC00) { // low surrogate
    				output.push(((value & 0x3FF) << 10) + (extra & 0x3FF) + 0x10000);
    			} else {
    				// unmatched surrogate; only append this code unit, in case the next
    				// code unit is the high surrogate of a surrogate pair
    				output.push(value);
    				counter--;
    			}
    		} else {
    			output.push(value);
    		}
    	}
    	return output;
    }

    // Taken from https://mths.be/punycode
    function ucs2encode(array) {
    	var length = array.length;
    	var index = -1;
    	var value;
    	var output = '';
    	while (++index < length) {
    		value = array[index];
    		if (value > 0xFFFF) {
    			value -= 0x10000;
    			output += stringFromCharCode(value >>> 10 & 0x3FF | 0xD800);
    			value = 0xDC00 | value & 0x3FF;
    		}
    		output += stringFromCharCode(value);
    	}
    	return output;
    }

    function checkScalarValue(codePoint, strict) {
    	if (codePoint >= 0xD800 && codePoint <= 0xDFFF) {
    		if (strict) {
    			throw Error(
    				'Lone surrogate U+' + codePoint.toString(16).toUpperCase() +
    				' is not a scalar value'
    			);
    		}
    		return false;
    	}
    	return true;
    }
    /*--------------------------------------------------------------------------*/

    function createByte(codePoint, shift) {
    	return stringFromCharCode(((codePoint >> shift) & 0x3F) | 0x80);
    }

    function encodeCodePoint(codePoint, strict) {
    	if ((codePoint & 0xFFFFFF80) == 0) { // 1-byte sequence
    		return stringFromCharCode(codePoint);
    	}
    	var symbol = '';
    	if ((codePoint & 0xFFFFF800) == 0) { // 2-byte sequence
    		symbol = stringFromCharCode(((codePoint >> 6) & 0x1F) | 0xC0);
    	}
    	else if ((codePoint & 0xFFFF0000) == 0) { // 3-byte sequence
    		if (!checkScalarValue(codePoint, strict)) {
    			codePoint = 0xFFFD;
    		}
    		symbol = stringFromCharCode(((codePoint >> 12) & 0x0F) | 0xE0);
    		symbol += createByte(codePoint, 6);
    	}
    	else if ((codePoint & 0xFFE00000) == 0) { // 4-byte sequence
    		symbol = stringFromCharCode(((codePoint >> 18) & 0x07) | 0xF0);
    		symbol += createByte(codePoint, 12);
    		symbol += createByte(codePoint, 6);
    	}
    	symbol += stringFromCharCode((codePoint & 0x3F) | 0x80);
    	return symbol;
    }

    function utf8encode(string, opts) {
    	opts = opts || {};
    	var strict = false !== opts.strict;

    	var codePoints = ucs2decode(string);
    	var length = codePoints.length;
    	var index = -1;
    	var codePoint;
    	var byteString = '';
    	while (++index < length) {
    		codePoint = codePoints[index];
    		byteString += encodeCodePoint(codePoint, strict);
    	}
    	return byteString;
    }

    /*--------------------------------------------------------------------------*/

    function readContinuationByte() {
    	if (byteIndex >= byteCount) {
    		throw Error('Invalid byte index');
    	}

    	var continuationByte = byteArray[byteIndex] & 0xFF;
    	byteIndex++;

    	if ((continuationByte & 0xC0) == 0x80) {
    		return continuationByte & 0x3F;
    	}

    	// If we end up here, it’s not a continuation byte
    	throw Error('Invalid continuation byte');
    }

    function decodeSymbol(strict) {
    	var byte1;
    	var byte2;
    	var byte3;
    	var byte4;
    	var codePoint;

    	if (byteIndex > byteCount) {
    		throw Error('Invalid byte index');
    	}

    	if (byteIndex == byteCount) {
    		return false;
    	}

    	// Read first byte
    	byte1 = byteArray[byteIndex] & 0xFF;
    	byteIndex++;

    	// 1-byte sequence (no continuation bytes)
    	if ((byte1 & 0x80) == 0) {
    		return byte1;
    	}

    	// 2-byte sequence
    	if ((byte1 & 0xE0) == 0xC0) {
    		byte2 = readContinuationByte();
    		codePoint = ((byte1 & 0x1F) << 6) | byte2;
    		if (codePoint >= 0x80) {
    			return codePoint;
    		} else {
    			throw Error('Invalid continuation byte');
    		}
    	}

    	// 3-byte sequence (may include unpaired surrogates)
    	if ((byte1 & 0xF0) == 0xE0) {
    		byte2 = readContinuationByte();
    		byte3 = readContinuationByte();
    		codePoint = ((byte1 & 0x0F) << 12) | (byte2 << 6) | byte3;
    		if (codePoint >= 0x0800) {
    			return checkScalarValue(codePoint, strict) ? codePoint : 0xFFFD;
    		} else {
    			throw Error('Invalid continuation byte');
    		}
    	}

    	// 4-byte sequence
    	if ((byte1 & 0xF8) == 0xF0) {
    		byte2 = readContinuationByte();
    		byte3 = readContinuationByte();
    		byte4 = readContinuationByte();
    		codePoint = ((byte1 & 0x07) << 0x12) | (byte2 << 0x0C) |
    			(byte3 << 0x06) | byte4;
    		if (codePoint >= 0x010000 && codePoint <= 0x10FFFF) {
    			return codePoint;
    		}
    	}

    	throw Error('Invalid UTF-8 detected');
    }

    var byteArray;
    var byteCount;
    var byteIndex;
    function utf8decode(byteString, opts) {
    	opts = opts || {};
    	var strict = false !== opts.strict;

    	byteArray = ucs2decode(byteString);
    	byteCount = byteArray.length;
    	byteIndex = 0;
    	var codePoints = [];
    	var tmp;
    	while ((tmp = decodeSymbol(strict)) !== false) {
    		codePoints.push(tmp);
    	}
    	return ucs2encode(codePoints);
    }

    var utf8 = {
    	version: '2.1.2',
    	encode: utf8encode,
    	decode: utf8decode
    };

    var base64Arraybuffer = createCommonjsModule(function (module, exports) {
    /*
     * base64-arraybuffer
     * https://github.com/niklasvh/base64-arraybuffer
     *
     * Copyright (c) 2012 Niklas von Hertzen
     * Licensed under the MIT license.
     */
    (function(){

      var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

      // Use a lookup table to find the index.
      var lookup = new Uint8Array(256);
      for (var i = 0; i < chars.length; i++) {
        lookup[chars.charCodeAt(i)] = i;
      }

      exports.encode = function(arraybuffer) {
        var bytes = new Uint8Array(arraybuffer),
        i, len = bytes.length, base64 = "";

        for (i = 0; i < len; i+=3) {
          base64 += chars[bytes[i] >> 2];
          base64 += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
          base64 += chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
          base64 += chars[bytes[i + 2] & 63];
        }

        if ((len % 3) === 2) {
          base64 = base64.substring(0, base64.length - 1) + "=";
        } else if (len % 3 === 1) {
          base64 = base64.substring(0, base64.length - 2) + "==";
        }

        return base64;
      };

      exports.decode =  function(base64) {
        var bufferLength = base64.length * 0.75,
        len = base64.length, i, p = 0,
        encoded1, encoded2, encoded3, encoded4;

        if (base64[base64.length - 1] === "=") {
          bufferLength--;
          if (base64[base64.length - 2] === "=") {
            bufferLength--;
          }
        }

        var arraybuffer = new ArrayBuffer(bufferLength),
        bytes = new Uint8Array(arraybuffer);

        for (i = 0; i < len; i+=4) {
          encoded1 = lookup[base64.charCodeAt(i)];
          encoded2 = lookup[base64.charCodeAt(i+1)];
          encoded3 = lookup[base64.charCodeAt(i+2)];
          encoded4 = lookup[base64.charCodeAt(i+3)];

          bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
          bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
          bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
        }

        return arraybuffer;
      };
    })();
    });
    var base64Arraybuffer_1 = base64Arraybuffer.encode;
    var base64Arraybuffer_2 = base64Arraybuffer.decode;

    /**
     * Create a blob builder even when vendor prefixes exist
     */

    var BlobBuilder = typeof BlobBuilder !== 'undefined' ? BlobBuilder :
      typeof WebKitBlobBuilder !== 'undefined' ? WebKitBlobBuilder :
      typeof MSBlobBuilder !== 'undefined' ? MSBlobBuilder :
      typeof MozBlobBuilder !== 'undefined' ? MozBlobBuilder : 
      false;

    /**
     * Check if Blob constructor is supported
     */

    var blobSupported = (function() {
      try {
        var a = new Blob(['hi']);
        return a.size === 2;
      } catch(e) {
        return false;
      }
    })();

    /**
     * Check if Blob constructor supports ArrayBufferViews
     * Fails in Safari 6, so we need to map to ArrayBuffers there.
     */

    var blobSupportsArrayBufferView = blobSupported && (function() {
      try {
        var b = new Blob([new Uint8Array([1,2])]);
        return b.size === 2;
      } catch(e) {
        return false;
      }
    })();

    /**
     * Check if BlobBuilder is supported
     */

    var blobBuilderSupported = BlobBuilder
      && BlobBuilder.prototype.append
      && BlobBuilder.prototype.getBlob;

    /**
     * Helper function that maps ArrayBufferViews to ArrayBuffers
     * Used by BlobBuilder constructor and old browsers that didn't
     * support it in the Blob constructor.
     */

    function mapArrayBufferViews(ary) {
      return ary.map(function(chunk) {
        if (chunk.buffer instanceof ArrayBuffer) {
          var buf = chunk.buffer;

          // if this is a subarray, make a copy so we only
          // include the subarray region from the underlying buffer
          if (chunk.byteLength !== buf.byteLength) {
            var copy = new Uint8Array(chunk.byteLength);
            copy.set(new Uint8Array(buf, chunk.byteOffset, chunk.byteLength));
            buf = copy.buffer;
          }

          return buf;
        }

        return chunk;
      });
    }

    function BlobBuilderConstructor(ary, options) {
      options = options || {};

      var bb = new BlobBuilder();
      mapArrayBufferViews(ary).forEach(function(part) {
        bb.append(part);
      });

      return (options.type) ? bb.getBlob(options.type) : bb.getBlob();
    }
    function BlobConstructor(ary, options) {
      return new Blob(mapArrayBufferViews(ary), options || {});
    }
    if (typeof Blob !== 'undefined') {
      BlobBuilderConstructor.prototype = Blob.prototype;
      BlobConstructor.prototype = Blob.prototype;
    }

    var blob = (function() {
      if (blobSupported) {
        return blobSupportsArrayBufferView ? Blob : BlobConstructor;
      } else if (blobBuilderSupported) {
        return BlobBuilderConstructor;
      } else {
        return undefined;
      }
    })();

    var browser$3 = createCommonjsModule(function (module, exports) {
    /**
     * Module dependencies.
     */







    var base64encoder;
    if (typeof ArrayBuffer !== 'undefined') {
      base64encoder = base64Arraybuffer;
    }

    /**
     * Check if we are running an android browser. That requires us to use
     * ArrayBuffer with polling transports...
     *
     * http://ghinda.net/jpeg-blob-ajax-android/
     */

    var isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

    /**
     * Check if we are running in PhantomJS.
     * Uploading a Blob with PhantomJS does not work correctly, as reported here:
     * https://github.com/ariya/phantomjs/issues/11395
     * @type boolean
     */
    var isPhantomJS = typeof navigator !== 'undefined' && /PhantomJS/i.test(navigator.userAgent);

    /**
     * When true, avoids using Blobs to encode payloads.
     * @type boolean
     */
    var dontSendBlobs = isAndroid || isPhantomJS;

    /**
     * Current protocol version.
     */

    exports.protocol = 3;

    /**
     * Packet types.
     */

    var packets = exports.packets = {
        open:     0    // non-ws
      , close:    1    // non-ws
      , ping:     2
      , pong:     3
      , message:  4
      , upgrade:  5
      , noop:     6
    };

    var packetslist = keys(packets);

    /**
     * Premade error packet.
     */

    var err = { type: 'error', data: 'parser error' };

    /**
     * Create a blob api even for blob builder when vendor prefixes exist
     */



    /**
     * Encodes a packet.
     *
     *     <packet type id> [ <data> ]
     *
     * Example:
     *
     *     5hello world
     *     3
     *     4
     *
     * Binary is encoded in an identical principle
     *
     * @api private
     */

    exports.encodePacket = function (packet, supportsBinary, utf8encode, callback) {
      if (typeof supportsBinary === 'function') {
        callback = supportsBinary;
        supportsBinary = false;
      }

      if (typeof utf8encode === 'function') {
        callback = utf8encode;
        utf8encode = null;
      }

      var data = (packet.data === undefined)
        ? undefined
        : packet.data.buffer || packet.data;

      if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
        return encodeArrayBuffer(packet, supportsBinary, callback);
      } else if (typeof blob !== 'undefined' && data instanceof blob) {
        return encodeBlob(packet, supportsBinary, callback);
      }

      // might be an object with { base64: true, data: dataAsBase64String }
      if (data && data.base64) {
        return encodeBase64Object(packet, callback);
      }

      // Sending data as a utf-8 string
      var encoded = packets[packet.type];

      // data fragment is optional
      if (undefined !== packet.data) {
        encoded += utf8encode ? utf8.encode(String(packet.data), { strict: false }) : String(packet.data);
      }

      return callback('' + encoded);

    };

    function encodeBase64Object(packet, callback) {
      // packet data is an object { base64: true, data: dataAsBase64String }
      var message = 'b' + exports.packets[packet.type] + packet.data.data;
      return callback(message);
    }

    /**
     * Encode packet helpers for binary types
     */

    function encodeArrayBuffer(packet, supportsBinary, callback) {
      if (!supportsBinary) {
        return exports.encodeBase64Packet(packet, callback);
      }

      var data = packet.data;
      var contentArray = new Uint8Array(data);
      var resultBuffer = new Uint8Array(1 + data.byteLength);

      resultBuffer[0] = packets[packet.type];
      for (var i = 0; i < contentArray.length; i++) {
        resultBuffer[i+1] = contentArray[i];
      }

      return callback(resultBuffer.buffer);
    }

    function encodeBlobAsArrayBuffer(packet, supportsBinary, callback) {
      if (!supportsBinary) {
        return exports.encodeBase64Packet(packet, callback);
      }

      var fr = new FileReader();
      fr.onload = function() {
        exports.encodePacket({ type: packet.type, data: fr.result }, supportsBinary, true, callback);
      };
      return fr.readAsArrayBuffer(packet.data);
    }

    function encodeBlob(packet, supportsBinary, callback) {
      if (!supportsBinary) {
        return exports.encodeBase64Packet(packet, callback);
      }

      if (dontSendBlobs) {
        return encodeBlobAsArrayBuffer(packet, supportsBinary, callback);
      }

      var length = new Uint8Array(1);
      length[0] = packets[packet.type];
      var blob$1 = new blob([length.buffer, packet.data]);

      return callback(blob$1);
    }

    /**
     * Encodes a packet with binary data in a base64 string
     *
     * @param {Object} packet, has `type` and `data`
     * @return {String} base64 encoded message
     */

    exports.encodeBase64Packet = function(packet, callback) {
      var message = 'b' + exports.packets[packet.type];
      if (typeof blob !== 'undefined' && packet.data instanceof blob) {
        var fr = new FileReader();
        fr.onload = function() {
          var b64 = fr.result.split(',')[1];
          callback(message + b64);
        };
        return fr.readAsDataURL(packet.data);
      }

      var b64data;
      try {
        b64data = String.fromCharCode.apply(null, new Uint8Array(packet.data));
      } catch (e) {
        // iPhone Safari doesn't let you apply with typed arrays
        var typed = new Uint8Array(packet.data);
        var basic = new Array(typed.length);
        for (var i = 0; i < typed.length; i++) {
          basic[i] = typed[i];
        }
        b64data = String.fromCharCode.apply(null, basic);
      }
      message += btoa(b64data);
      return callback(message);
    };

    /**
     * Decodes a packet. Changes format to Blob if requested.
     *
     * @return {Object} with `type` and `data` (if any)
     * @api private
     */

    exports.decodePacket = function (data, binaryType, utf8decode) {
      if (data === undefined) {
        return err;
      }
      // String data
      if (typeof data === 'string') {
        if (data.charAt(0) === 'b') {
          return exports.decodeBase64Packet(data.substr(1), binaryType);
        }

        if (utf8decode) {
          data = tryDecode(data);
          if (data === false) {
            return err;
          }
        }
        var type = data.charAt(0);

        if (Number(type) != type || !packetslist[type]) {
          return err;
        }

        if (data.length > 1) {
          return { type: packetslist[type], data: data.substring(1) };
        } else {
          return { type: packetslist[type] };
        }
      }

      var asArray = new Uint8Array(data);
      var type = asArray[0];
      var rest = arraybuffer_slice(data, 1);
      if (blob && binaryType === 'blob') {
        rest = new blob([rest]);
      }
      return { type: packetslist[type], data: rest };
    };

    function tryDecode(data) {
      try {
        data = utf8.decode(data, { strict: false });
      } catch (e) {
        return false;
      }
      return data;
    }

    /**
     * Decodes a packet encoded in a base64 string
     *
     * @param {String} base64 encoded message
     * @return {Object} with `type` and `data` (if any)
     */

    exports.decodeBase64Packet = function(msg, binaryType) {
      var type = packetslist[msg.charAt(0)];
      if (!base64encoder) {
        return { type: type, data: { base64: true, data: msg.substr(1) } };
      }

      var data = base64encoder.decode(msg.substr(1));

      if (binaryType === 'blob' && blob) {
        data = new blob([data]);
      }

      return { type: type, data: data };
    };

    /**
     * Encodes multiple messages (payload).
     *
     *     <length>:data
     *
     * Example:
     *
     *     11:hello world2:hi
     *
     * If any contents are binary, they will be encoded as base64 strings. Base64
     * encoded strings are marked with a b before the length specifier
     *
     * @param {Array} packets
     * @api private
     */

    exports.encodePayload = function (packets, supportsBinary, callback) {
      if (typeof supportsBinary === 'function') {
        callback = supportsBinary;
        supportsBinary = null;
      }

      var isBinary = hasBinary2(packets);

      if (supportsBinary && isBinary) {
        if (blob && !dontSendBlobs) {
          return exports.encodePayloadAsBlob(packets, callback);
        }

        return exports.encodePayloadAsArrayBuffer(packets, callback);
      }

      if (!packets.length) {
        return callback('0:');
      }

      function setLengthHeader(message) {
        return message.length + ':' + message;
      }

      function encodeOne(packet, doneCallback) {
        exports.encodePacket(packet, !isBinary ? false : supportsBinary, false, function(message) {
          doneCallback(null, setLengthHeader(message));
        });
      }

      map(packets, encodeOne, function(err, results) {
        return callback(results.join(''));
      });
    };

    /**
     * Async array map using after
     */

    function map(ary, each, done) {
      var result = new Array(ary.length);
      var next = after_1(ary.length, done);

      var eachWithIndex = function(i, el, cb) {
        each(el, function(error, msg) {
          result[i] = msg;
          cb(error, result);
        });
      };

      for (var i = 0; i < ary.length; i++) {
        eachWithIndex(i, ary[i], next);
      }
    }

    /*
     * Decodes data when a payload is maybe expected. Possible binary contents are
     * decoded from their base64 representation
     *
     * @param {String} data, callback method
     * @api public
     */

    exports.decodePayload = function (data, binaryType, callback) {
      if (typeof data !== 'string') {
        return exports.decodePayloadAsBinary(data, binaryType, callback);
      }

      if (typeof binaryType === 'function') {
        callback = binaryType;
        binaryType = null;
      }

      var packet;
      if (data === '') {
        // parser error - ignoring payload
        return callback(err, 0, 1);
      }

      var length = '', n, msg;

      for (var i = 0, l = data.length; i < l; i++) {
        var chr = data.charAt(i);

        if (chr !== ':') {
          length += chr;
          continue;
        }

        if (length === '' || (length != (n = Number(length)))) {
          // parser error - ignoring payload
          return callback(err, 0, 1);
        }

        msg = data.substr(i + 1, n);

        if (length != msg.length) {
          // parser error - ignoring payload
          return callback(err, 0, 1);
        }

        if (msg.length) {
          packet = exports.decodePacket(msg, binaryType, false);

          if (err.type === packet.type && err.data === packet.data) {
            // parser error in individual packet - ignoring payload
            return callback(err, 0, 1);
          }

          var ret = callback(packet, i + n, l);
          if (false === ret) return;
        }

        // advance cursor
        i += n;
        length = '';
      }

      if (length !== '') {
        // parser error - ignoring payload
        return callback(err, 0, 1);
      }

    };

    /**
     * Encodes multiple messages (payload) as binary.
     *
     * <1 = binary, 0 = string><number from 0-9><number from 0-9>[...]<number
     * 255><data>
     *
     * Example:
     * 1 3 255 1 2 3, if the binary contents are interpreted as 8 bit integers
     *
     * @param {Array} packets
     * @return {ArrayBuffer} encoded payload
     * @api private
     */

    exports.encodePayloadAsArrayBuffer = function(packets, callback) {
      if (!packets.length) {
        return callback(new ArrayBuffer(0));
      }

      function encodeOne(packet, doneCallback) {
        exports.encodePacket(packet, true, true, function(data) {
          return doneCallback(null, data);
        });
      }

      map(packets, encodeOne, function(err, encodedPackets) {
        var totalLength = encodedPackets.reduce(function(acc, p) {
          var len;
          if (typeof p === 'string'){
            len = p.length;
          } else {
            len = p.byteLength;
          }
          return acc + len.toString().length + len + 2; // string/binary identifier + separator = 2
        }, 0);

        var resultArray = new Uint8Array(totalLength);

        var bufferIndex = 0;
        encodedPackets.forEach(function(p) {
          var isString = typeof p === 'string';
          var ab = p;
          if (isString) {
            var view = new Uint8Array(p.length);
            for (var i = 0; i < p.length; i++) {
              view[i] = p.charCodeAt(i);
            }
            ab = view.buffer;
          }

          if (isString) { // not true binary
            resultArray[bufferIndex++] = 0;
          } else { // true binary
            resultArray[bufferIndex++] = 1;
          }

          var lenStr = ab.byteLength.toString();
          for (var i = 0; i < lenStr.length; i++) {
            resultArray[bufferIndex++] = parseInt(lenStr[i]);
          }
          resultArray[bufferIndex++] = 255;

          var view = new Uint8Array(ab);
          for (var i = 0; i < view.length; i++) {
            resultArray[bufferIndex++] = view[i];
          }
        });

        return callback(resultArray.buffer);
      });
    };

    /**
     * Encode as Blob
     */

    exports.encodePayloadAsBlob = function(packets, callback) {
      function encodeOne(packet, doneCallback) {
        exports.encodePacket(packet, true, true, function(encoded) {
          var binaryIdentifier = new Uint8Array(1);
          binaryIdentifier[0] = 1;
          if (typeof encoded === 'string') {
            var view = new Uint8Array(encoded.length);
            for (var i = 0; i < encoded.length; i++) {
              view[i] = encoded.charCodeAt(i);
            }
            encoded = view.buffer;
            binaryIdentifier[0] = 0;
          }

          var len = (encoded instanceof ArrayBuffer)
            ? encoded.byteLength
            : encoded.size;

          var lenStr = len.toString();
          var lengthAry = new Uint8Array(lenStr.length + 1);
          for (var i = 0; i < lenStr.length; i++) {
            lengthAry[i] = parseInt(lenStr[i]);
          }
          lengthAry[lenStr.length] = 255;

          if (blob) {
            var blob$1 = new blob([binaryIdentifier.buffer, lengthAry.buffer, encoded]);
            doneCallback(null, blob$1);
          }
        });
      }

      map(packets, encodeOne, function(err, results) {
        return callback(new blob(results));
      });
    };

    /*
     * Decodes data when a payload is maybe expected. Strings are decoded by
     * interpreting each byte as a key code for entries marked to start with 0. See
     * description of encodePayloadAsBinary
     *
     * @param {ArrayBuffer} data, callback method
     * @api public
     */

    exports.decodePayloadAsBinary = function (data, binaryType, callback) {
      if (typeof binaryType === 'function') {
        callback = binaryType;
        binaryType = null;
      }

      var bufferTail = data;
      var buffers = [];

      while (bufferTail.byteLength > 0) {
        var tailArray = new Uint8Array(bufferTail);
        var isString = tailArray[0] === 0;
        var msgLength = '';

        for (var i = 1; ; i++) {
          if (tailArray[i] === 255) break;

          // 310 = char length of Number.MAX_VALUE
          if (msgLength.length > 310) {
            return callback(err, 0, 1);
          }

          msgLength += tailArray[i];
        }

        bufferTail = arraybuffer_slice(bufferTail, 2 + msgLength.length);
        msgLength = parseInt(msgLength);

        var msg = arraybuffer_slice(bufferTail, 0, msgLength);
        if (isString) {
          try {
            msg = String.fromCharCode.apply(null, new Uint8Array(msg));
          } catch (e) {
            // iPhone Safari doesn't let you apply to typed arrays
            var typed = new Uint8Array(msg);
            msg = '';
            for (var i = 0; i < typed.length; i++) {
              msg += String.fromCharCode(typed[i]);
            }
          }
        }

        buffers.push(msg);
        bufferTail = arraybuffer_slice(bufferTail, msgLength);
      }

      var total = buffers.length;
      buffers.forEach(function(buffer, i) {
        callback(exports.decodePacket(buffer, binaryType, true), i, total);
      });
    };
    });
    var browser_1$2 = browser$3.protocol;
    var browser_2$2 = browser$3.packets;
    var browser_3$2 = browser$3.encodePacket;
    var browser_4$2 = browser$3.encodeBase64Packet;
    var browser_5$2 = browser$3.decodePacket;
    var browser_6$2 = browser$3.decodeBase64Packet;
    var browser_7$2 = browser$3.encodePayload;
    var browser_8 = browser$3.decodePayload;
    var browser_9 = browser$3.encodePayloadAsArrayBuffer;
    var browser_10 = browser$3.encodePayloadAsBlob;
    var browser_11 = browser$3.decodePayloadAsBinary;

    var componentEmitter$1 = createCommonjsModule(function (module) {
    /**
     * Expose `Emitter`.
     */

    {
      module.exports = Emitter;
    }

    /**
     * Initialize a new `Emitter`.
     *
     * @api public
     */

    function Emitter(obj) {
      if (obj) return mixin(obj);
    }
    /**
     * Mixin the emitter properties.
     *
     * @param {Object} obj
     * @return {Object}
     * @api private
     */

    function mixin(obj) {
      for (var key in Emitter.prototype) {
        obj[key] = Emitter.prototype[key];
      }
      return obj;
    }

    /**
     * Listen on the given `event` with `fn`.
     *
     * @param {String} event
     * @param {Function} fn
     * @return {Emitter}
     * @api public
     */

    Emitter.prototype.on =
    Emitter.prototype.addEventListener = function(event, fn){
      this._callbacks = this._callbacks || {};
      (this._callbacks['$' + event] = this._callbacks['$' + event] || [])
        .push(fn);
      return this;
    };

    /**
     * Adds an `event` listener that will be invoked a single
     * time then automatically removed.
     *
     * @param {String} event
     * @param {Function} fn
     * @return {Emitter}
     * @api public
     */

    Emitter.prototype.once = function(event, fn){
      function on() {
        this.off(event, on);
        fn.apply(this, arguments);
      }

      on.fn = fn;
      this.on(event, on);
      return this;
    };

    /**
     * Remove the given callback for `event` or all
     * registered callbacks.
     *
     * @param {String} event
     * @param {Function} fn
     * @return {Emitter}
     * @api public
     */

    Emitter.prototype.off =
    Emitter.prototype.removeListener =
    Emitter.prototype.removeAllListeners =
    Emitter.prototype.removeEventListener = function(event, fn){
      this._callbacks = this._callbacks || {};

      // all
      if (0 == arguments.length) {
        this._callbacks = {};
        return this;
      }

      // specific event
      var callbacks = this._callbacks['$' + event];
      if (!callbacks) return this;

      // remove all handlers
      if (1 == arguments.length) {
        delete this._callbacks['$' + event];
        return this;
      }

      // remove specific handler
      var cb;
      for (var i = 0; i < callbacks.length; i++) {
        cb = callbacks[i];
        if (cb === fn || cb.fn === fn) {
          callbacks.splice(i, 1);
          break;
        }
      }

      // Remove event specific arrays for event types that no
      // one is subscribed for to avoid memory leak.
      if (callbacks.length === 0) {
        delete this._callbacks['$' + event];
      }

      return this;
    };

    /**
     * Emit `event` with the given args.
     *
     * @param {String} event
     * @param {Mixed} ...
     * @return {Emitter}
     */

    Emitter.prototype.emit = function(event){
      this._callbacks = this._callbacks || {};

      var args = new Array(arguments.length - 1)
        , callbacks = this._callbacks['$' + event];

      for (var i = 1; i < arguments.length; i++) {
        args[i - 1] = arguments[i];
      }

      if (callbacks) {
        callbacks = callbacks.slice(0);
        for (var i = 0, len = callbacks.length; i < len; ++i) {
          callbacks[i].apply(this, args);
        }
      }

      return this;
    };

    /**
     * Return array of callbacks for `event`.
     *
     * @param {String} event
     * @return {Array}
     * @api public
     */

    Emitter.prototype.listeners = function(event){
      this._callbacks = this._callbacks || {};
      return this._callbacks['$' + event] || [];
    };

    /**
     * Check if this emitter has `event` handlers.
     *
     * @param {String} event
     * @return {Boolean}
     * @api public
     */

    Emitter.prototype.hasListeners = function(event){
      return !! this.listeners(event).length;
    };
    });

    /**
     * Module dependencies.
     */




    /**
     * Module exports.
     */

    var transport = Transport;

    /**
     * Transport abstract constructor.
     *
     * @param {Object} options.
     * @api private
     */

    function Transport (opts) {
      this.path = opts.path;
      this.hostname = opts.hostname;
      this.port = opts.port;
      this.secure = opts.secure;
      this.query = opts.query;
      this.timestampParam = opts.timestampParam;
      this.timestampRequests = opts.timestampRequests;
      this.readyState = '';
      this.agent = opts.agent || false;
      this.socket = opts.socket;
      this.enablesXDR = opts.enablesXDR;
      this.withCredentials = opts.withCredentials;

      // SSL options for Node.js client
      this.pfx = opts.pfx;
      this.key = opts.key;
      this.passphrase = opts.passphrase;
      this.cert = opts.cert;
      this.ca = opts.ca;
      this.ciphers = opts.ciphers;
      this.rejectUnauthorized = opts.rejectUnauthorized;
      this.forceNode = opts.forceNode;

      // results of ReactNative environment detection
      this.isReactNative = opts.isReactNative;

      // other options for Node.js client
      this.extraHeaders = opts.extraHeaders;
      this.localAddress = opts.localAddress;
    }

    /**
     * Mix in `Emitter`.
     */

    componentEmitter$1(Transport.prototype);

    /**
     * Emits an error.
     *
     * @param {String} str
     * @return {Transport} for chaining
     * @api public
     */

    Transport.prototype.onError = function (msg, desc) {
      var err = new Error(msg);
      err.type = 'TransportError';
      err.description = desc;
      this.emit('error', err);
      return this;
    };

    /**
     * Opens the transport.
     *
     * @api public
     */

    Transport.prototype.open = function () {
      if ('closed' === this.readyState || '' === this.readyState) {
        this.readyState = 'opening';
        this.doOpen();
      }

      return this;
    };

    /**
     * Closes the transport.
     *
     * @api private
     */

    Transport.prototype.close = function () {
      if ('opening' === this.readyState || 'open' === this.readyState) {
        this.doClose();
        this.onClose();
      }

      return this;
    };

    /**
     * Sends multiple packets.
     *
     * @param {Array} packets
     * @api private
     */

    Transport.prototype.send = function (packets) {
      if ('open' === this.readyState) {
        this.write(packets);
      } else {
        throw new Error('Transport not open');
      }
    };

    /**
     * Called upon open
     *
     * @api private
     */

    Transport.prototype.onOpen = function () {
      this.readyState = 'open';
      this.writable = true;
      this.emit('open');
    };

    /**
     * Called with data.
     *
     * @param {String} data
     * @api private
     */

    Transport.prototype.onData = function (data) {
      var packet = browser$3.decodePacket(data, this.socket.binaryType);
      this.onPacket(packet);
    };

    /**
     * Called with a decoded packet.
     */

    Transport.prototype.onPacket = function (packet) {
      this.emit('packet', packet);
    };

    /**
     * Called upon close.
     *
     * @api private
     */

    Transport.prototype.onClose = function () {
      this.readyState = 'closed';
      this.emit('close');
    };

    /**
     * Compiles a querystring
     * Returns string representation of the object
     *
     * @param {Object}
     * @api private
     */

    var encode = function (obj) {
      var str = '';

      for (var i in obj) {
        if (obj.hasOwnProperty(i)) {
          if (str.length) str += '&';
          str += encodeURIComponent(i) + '=' + encodeURIComponent(obj[i]);
        }
      }

      return str;
    };

    /**
     * Parses a simple querystring into an object
     *
     * @param {String} qs
     * @api private
     */

    var decode = function(qs){
      var qry = {};
      var pairs = qs.split('&');
      for (var i = 0, l = pairs.length; i < l; i++) {
        var pair = pairs[i].split('=');
        qry[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
      }
      return qry;
    };

    var parseqs = {
    	encode: encode,
    	decode: decode
    };

    var componentInherit = function(a, b){
      var fn = function(){};
      fn.prototype = b.prototype;
      a.prototype = new fn;
      a.prototype.constructor = a;
    };

    var alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'.split('')
      , length = 64
      , map = {}
      , seed = 0
      , i = 0
      , prev;

    /**
     * Return a string representing the specified number.
     *
     * @param {Number} num The number to convert.
     * @returns {String} The string representation of the number.
     * @api public
     */
    function encode$1(num) {
      var encoded = '';

      do {
        encoded = alphabet[num % length] + encoded;
        num = Math.floor(num / length);
      } while (num > 0);

      return encoded;
    }

    /**
     * Return the integer value specified by the given string.
     *
     * @param {String} str The string to convert.
     * @returns {Number} The integer value represented by the string.
     * @api public
     */
    function decode$1(str) {
      var decoded = 0;

      for (i = 0; i < str.length; i++) {
        decoded = decoded * length + map[str.charAt(i)];
      }

      return decoded;
    }

    /**
     * Yeast: A tiny growing id generator.
     *
     * @returns {String} A unique id.
     * @api public
     */
    function yeast() {
      var now = encode$1(+new Date());

      if (now !== prev) return seed = 0, prev = now;
      return now +'.'+ encode$1(seed++);
    }

    //
    // Map each character to its index.
    //
    for (; i < length; i++) map[alphabet[i]] = i;

    //
    // Expose the `yeast`, `encode` and `decode` functions.
    //
    yeast.encode = encode$1;
    yeast.decode = decode$1;
    var yeast_1 = yeast;

    /**
     * Module dependencies.
     */






    var debug$2 = browser$1('engine.io-client:polling');

    /**
     * Module exports.
     */

    var polling = Polling;

    /**
     * Is XHR2 supported?
     */

    var hasXHR2 = (function () {
      var XMLHttpRequest = xmlhttprequest;
      var xhr = new XMLHttpRequest({ xdomain: false });
      return null != xhr.responseType;
    })();

    /**
     * Polling interface.
     *
     * @param {Object} opts
     * @api private
     */

    function Polling (opts) {
      var forceBase64 = (opts && opts.forceBase64);
      if (!hasXHR2 || forceBase64) {
        this.supportsBinary = false;
      }
      transport.call(this, opts);
    }

    /**
     * Inherits from Transport.
     */

    componentInherit(Polling, transport);

    /**
     * Transport name.
     */

    Polling.prototype.name = 'polling';

    /**
     * Opens the socket (triggers polling). We write a PING message to determine
     * when the transport is open.
     *
     * @api private
     */

    Polling.prototype.doOpen = function () {
      this.poll();
    };

    /**
     * Pauses polling.
     *
     * @param {Function} callback upon buffers are flushed and transport is paused
     * @api private
     */

    Polling.prototype.pause = function (onPause) {
      var self = this;

      this.readyState = 'pausing';

      function pause () {
        debug$2('paused');
        self.readyState = 'paused';
        onPause();
      }

      if (this.polling || !this.writable) {
        var total = 0;

        if (this.polling) {
          debug$2('we are currently polling - waiting to pause');
          total++;
          this.once('pollComplete', function () {
            debug$2('pre-pause polling complete');
            --total || pause();
          });
        }

        if (!this.writable) {
          debug$2('we are currently writing - waiting to pause');
          total++;
          this.once('drain', function () {
            debug$2('pre-pause writing complete');
            --total || pause();
          });
        }
      } else {
        pause();
      }
    };

    /**
     * Starts polling cycle.
     *
     * @api public
     */

    Polling.prototype.poll = function () {
      debug$2('polling');
      this.polling = true;
      this.doPoll();
      this.emit('poll');
    };

    /**
     * Overloads onData to detect payloads.
     *
     * @api private
     */

    Polling.prototype.onData = function (data) {
      var self = this;
      debug$2('polling got data %s', data);
      var callback = function (packet, index, total) {
        // if its the first message we consider the transport open
        if ('opening' === self.readyState) {
          self.onOpen();
        }

        // if its a close packet, we close the ongoing requests
        if ('close' === packet.type) {
          self.onClose();
          return false;
        }

        // otherwise bypass onData and handle the message
        self.onPacket(packet);
      };

      // decode payload
      browser$3.decodePayload(data, this.socket.binaryType, callback);

      // if an event did not trigger closing
      if ('closed' !== this.readyState) {
        // if we got data we're not polling
        this.polling = false;
        this.emit('pollComplete');

        if ('open' === this.readyState) {
          this.poll();
        } else {
          debug$2('ignoring poll - transport state "%s"', this.readyState);
        }
      }
    };

    /**
     * For polling, send a close packet.
     *
     * @api private
     */

    Polling.prototype.doClose = function () {
      var self = this;

      function close () {
        debug$2('writing close packet');
        self.write([{ type: 'close' }]);
      }

      if ('open' === this.readyState) {
        debug$2('transport open - closing');
        close();
      } else {
        // in case we're trying to close while
        // handshaking is in progress (GH-164)
        debug$2('transport not open - deferring close');
        this.once('open', close);
      }
    };

    /**
     * Writes a packets payload.
     *
     * @param {Array} data packets
     * @param {Function} drain callback
     * @api private
     */

    Polling.prototype.write = function (packets) {
      var self = this;
      this.writable = false;
      var callbackfn = function () {
        self.writable = true;
        self.emit('drain');
      };

      browser$3.encodePayload(packets, this.supportsBinary, function (data) {
        self.doWrite(data, callbackfn);
      });
    };

    /**
     * Generates uri for connection.
     *
     * @api private
     */

    Polling.prototype.uri = function () {
      var query = this.query || {};
      var schema = this.secure ? 'https' : 'http';
      var port = '';

      // cache busting is forced
      if (false !== this.timestampRequests) {
        query[this.timestampParam] = yeast_1();
      }

      if (!this.supportsBinary && !query.sid) {
        query.b64 = 1;
      }

      query = parseqs.encode(query);

      // avoid port if default for schema
      if (this.port && (('https' === schema && Number(this.port) !== 443) ||
         ('http' === schema && Number(this.port) !== 80))) {
        port = ':' + this.port;
      }

      // prepend ? to query
      if (query.length) {
        query = '?' + query;
      }

      var ipv6 = this.hostname.indexOf(':') !== -1;
      return schema + '://' + (ipv6 ? '[' + this.hostname + ']' : this.hostname) + port + this.path + query;
    };

    /* global attachEvent */

    /**
     * Module requirements.
     */





    var debug$3 = browser$1('engine.io-client:polling-xhr');


    /**
     * Module exports.
     */

    var pollingXhr = XHR;
    var Request_1 = Request;

    /**
     * Empty function
     */

    function empty () {}

    /**
     * XHR Polling constructor.
     *
     * @param {Object} opts
     * @api public
     */

    function XHR (opts) {
      polling.call(this, opts);
      this.requestTimeout = opts.requestTimeout;
      this.extraHeaders = opts.extraHeaders;

      if (typeof location !== 'undefined') {
        var isSSL = 'https:' === location.protocol;
        var port = location.port;

        // some user agents have empty `location.port`
        if (!port) {
          port = isSSL ? 443 : 80;
        }

        this.xd = (typeof location !== 'undefined' && opts.hostname !== location.hostname) ||
          port !== opts.port;
        this.xs = opts.secure !== isSSL;
      }
    }

    /**
     * Inherits from Polling.
     */

    componentInherit(XHR, polling);

    /**
     * XHR supports binary
     */

    XHR.prototype.supportsBinary = true;

    /**
     * Creates a request.
     *
     * @param {String} method
     * @api private
     */

    XHR.prototype.request = function (opts) {
      opts = opts || {};
      opts.uri = this.uri();
      opts.xd = this.xd;
      opts.xs = this.xs;
      opts.agent = this.agent || false;
      opts.supportsBinary = this.supportsBinary;
      opts.enablesXDR = this.enablesXDR;
      opts.withCredentials = this.withCredentials;

      // SSL options for Node.js client
      opts.pfx = this.pfx;
      opts.key = this.key;
      opts.passphrase = this.passphrase;
      opts.cert = this.cert;
      opts.ca = this.ca;
      opts.ciphers = this.ciphers;
      opts.rejectUnauthorized = this.rejectUnauthorized;
      opts.requestTimeout = this.requestTimeout;

      // other options for Node.js client
      opts.extraHeaders = this.extraHeaders;

      return new Request(opts);
    };

    /**
     * Sends data.
     *
     * @param {String} data to send.
     * @param {Function} called upon flush.
     * @api private
     */

    XHR.prototype.doWrite = function (data, fn) {
      var isBinary = typeof data !== 'string' && data !== undefined;
      var req = this.request({ method: 'POST', data: data, isBinary: isBinary });
      var self = this;
      req.on('success', fn);
      req.on('error', function (err) {
        self.onError('xhr post error', err);
      });
      this.sendXhr = req;
    };

    /**
     * Starts a poll cycle.
     *
     * @api private
     */

    XHR.prototype.doPoll = function () {
      debug$3('xhr poll');
      var req = this.request();
      var self = this;
      req.on('data', function (data) {
        self.onData(data);
      });
      req.on('error', function (err) {
        self.onError('xhr poll error', err);
      });
      this.pollXhr = req;
    };

    /**
     * Request constructor
     *
     * @param {Object} options
     * @api public
     */

    function Request (opts) {
      this.method = opts.method || 'GET';
      this.uri = opts.uri;
      this.xd = !!opts.xd;
      this.xs = !!opts.xs;
      this.async = false !== opts.async;
      this.data = undefined !== opts.data ? opts.data : null;
      this.agent = opts.agent;
      this.isBinary = opts.isBinary;
      this.supportsBinary = opts.supportsBinary;
      this.enablesXDR = opts.enablesXDR;
      this.withCredentials = opts.withCredentials;
      this.requestTimeout = opts.requestTimeout;

      // SSL options for Node.js client
      this.pfx = opts.pfx;
      this.key = opts.key;
      this.passphrase = opts.passphrase;
      this.cert = opts.cert;
      this.ca = opts.ca;
      this.ciphers = opts.ciphers;
      this.rejectUnauthorized = opts.rejectUnauthorized;

      // other options for Node.js client
      this.extraHeaders = opts.extraHeaders;

      this.create();
    }

    /**
     * Mix in `Emitter`.
     */

    componentEmitter$1(Request.prototype);

    /**
     * Creates the XHR object and sends the request.
     *
     * @api private
     */

    Request.prototype.create = function () {
      var opts = { agent: this.agent, xdomain: this.xd, xscheme: this.xs, enablesXDR: this.enablesXDR };

      // SSL options for Node.js client
      opts.pfx = this.pfx;
      opts.key = this.key;
      opts.passphrase = this.passphrase;
      opts.cert = this.cert;
      opts.ca = this.ca;
      opts.ciphers = this.ciphers;
      opts.rejectUnauthorized = this.rejectUnauthorized;

      var xhr = this.xhr = new xmlhttprequest(opts);
      var self = this;

      try {
        debug$3('xhr open %s: %s', this.method, this.uri);
        xhr.open(this.method, this.uri, this.async);
        try {
          if (this.extraHeaders) {
            xhr.setDisableHeaderCheck && xhr.setDisableHeaderCheck(true);
            for (var i in this.extraHeaders) {
              if (this.extraHeaders.hasOwnProperty(i)) {
                xhr.setRequestHeader(i, this.extraHeaders[i]);
              }
            }
          }
        } catch (e) {}

        if ('POST' === this.method) {
          try {
            if (this.isBinary) {
              xhr.setRequestHeader('Content-type', 'application/octet-stream');
            } else {
              xhr.setRequestHeader('Content-type', 'text/plain;charset=UTF-8');
            }
          } catch (e) {}
        }

        try {
          xhr.setRequestHeader('Accept', '*/*');
        } catch (e) {}

        // ie6 check
        if ('withCredentials' in xhr) {
          xhr.withCredentials = this.withCredentials;
        }

        if (this.requestTimeout) {
          xhr.timeout = this.requestTimeout;
        }

        if (this.hasXDR()) {
          xhr.onload = function () {
            self.onLoad();
          };
          xhr.onerror = function () {
            self.onError(xhr.responseText);
          };
        } else {
          xhr.onreadystatechange = function () {
            if (xhr.readyState === 2) {
              try {
                var contentType = xhr.getResponseHeader('Content-Type');
                if (self.supportsBinary && contentType === 'application/octet-stream' || contentType === 'application/octet-stream; charset=UTF-8') {
                  xhr.responseType = 'arraybuffer';
                }
              } catch (e) {}
            }
            if (4 !== xhr.readyState) return;
            if (200 === xhr.status || 1223 === xhr.status) {
              self.onLoad();
            } else {
              // make sure the `error` event handler that's user-set
              // does not throw in the same tick and gets caught here
              setTimeout(function () {
                self.onError(typeof xhr.status === 'number' ? xhr.status : 0);
              }, 0);
            }
          };
        }

        debug$3('xhr data %s', this.data);
        xhr.send(this.data);
      } catch (e) {
        // Need to defer since .create() is called directly fhrom the constructor
        // and thus the 'error' event can only be only bound *after* this exception
        // occurs.  Therefore, also, we cannot throw here at all.
        setTimeout(function () {
          self.onError(e);
        }, 0);
        return;
      }

      if (typeof document !== 'undefined') {
        this.index = Request.requestsCount++;
        Request.requests[this.index] = this;
      }
    };

    /**
     * Called upon successful response.
     *
     * @api private
     */

    Request.prototype.onSuccess = function () {
      this.emit('success');
      this.cleanup();
    };

    /**
     * Called if we have data.
     *
     * @api private
     */

    Request.prototype.onData = function (data) {
      this.emit('data', data);
      this.onSuccess();
    };

    /**
     * Called upon error.
     *
     * @api private
     */

    Request.prototype.onError = function (err) {
      this.emit('error', err);
      this.cleanup(true);
    };

    /**
     * Cleans up house.
     *
     * @api private
     */

    Request.prototype.cleanup = function (fromError) {
      if ('undefined' === typeof this.xhr || null === this.xhr) {
        return;
      }
      // xmlhttprequest
      if (this.hasXDR()) {
        this.xhr.onload = this.xhr.onerror = empty;
      } else {
        this.xhr.onreadystatechange = empty;
      }

      if (fromError) {
        try {
          this.xhr.abort();
        } catch (e) {}
      }

      if (typeof document !== 'undefined') {
        delete Request.requests[this.index];
      }

      this.xhr = null;
    };

    /**
     * Called upon load.
     *
     * @api private
     */

    Request.prototype.onLoad = function () {
      var data;
      try {
        var contentType;
        try {
          contentType = this.xhr.getResponseHeader('Content-Type');
        } catch (e) {}
        if (contentType === 'application/octet-stream' || contentType === 'application/octet-stream; charset=UTF-8') {
          data = this.xhr.response || this.xhr.responseText;
        } else {
          data = this.xhr.responseText;
        }
      } catch (e) {
        this.onError(e);
      }
      if (null != data) {
        this.onData(data);
      }
    };

    /**
     * Check if it has XDomainRequest.
     *
     * @api private
     */

    Request.prototype.hasXDR = function () {
      return typeof XDomainRequest !== 'undefined' && !this.xs && this.enablesXDR;
    };

    /**
     * Aborts the request.
     *
     * @api public
     */

    Request.prototype.abort = function () {
      this.cleanup();
    };

    /**
     * Aborts pending requests when unloading the window. This is needed to prevent
     * memory leaks (e.g. when using IE) and to ensure that no spurious error is
     * emitted.
     */

    Request.requestsCount = 0;
    Request.requests = {};

    if (typeof document !== 'undefined') {
      if (typeof attachEvent === 'function') {
        attachEvent('onunload', unloadHandler);
      } else if (typeof addEventListener === 'function') {
        var terminationEvent = 'onpagehide' in globalThis_browser ? 'pagehide' : 'unload';
        addEventListener(terminationEvent, unloadHandler, false);
      }
    }

    function unloadHandler () {
      for (var i in Request.requests) {
        if (Request.requests.hasOwnProperty(i)) {
          Request.requests[i].abort();
        }
      }
    }
    pollingXhr.Request = Request_1;

    /**
     * Module requirements.
     */





    /**
     * Module exports.
     */

    var pollingJsonp = JSONPPolling;

    /**
     * Cached regular expressions.
     */

    var rNewline = /\n/g;
    var rEscapedNewline = /\\n/g;

    /**
     * Global JSONP callbacks.
     */

    var callbacks;

    /**
     * Noop.
     */

    function empty$1 () { }

    /**
     * JSONP Polling constructor.
     *
     * @param {Object} opts.
     * @api public
     */

    function JSONPPolling (opts) {
      polling.call(this, opts);

      this.query = this.query || {};

      // define global callbacks array if not present
      // we do this here (lazily) to avoid unneeded global pollution
      if (!callbacks) {
        // we need to consider multiple engines in the same page
        callbacks = globalThis_browser.___eio = (globalThis_browser.___eio || []);
      }

      // callback identifier
      this.index = callbacks.length;

      // add callback to jsonp global
      var self = this;
      callbacks.push(function (msg) {
        self.onData(msg);
      });

      // append to query string
      this.query.j = this.index;

      // prevent spurious errors from being emitted when the window is unloaded
      if (typeof addEventListener === 'function') {
        addEventListener('beforeunload', function () {
          if (self.script) self.script.onerror = empty$1;
        }, false);
      }
    }

    /**
     * Inherits from Polling.
     */

    componentInherit(JSONPPolling, polling);

    /*
     * JSONP only supports binary as base64 encoded strings
     */

    JSONPPolling.prototype.supportsBinary = false;

    /**
     * Closes the socket.
     *
     * @api private
     */

    JSONPPolling.prototype.doClose = function () {
      if (this.script) {
        this.script.parentNode.removeChild(this.script);
        this.script = null;
      }

      if (this.form) {
        this.form.parentNode.removeChild(this.form);
        this.form = null;
        this.iframe = null;
      }

      polling.prototype.doClose.call(this);
    };

    /**
     * Starts a poll cycle.
     *
     * @api private
     */

    JSONPPolling.prototype.doPoll = function () {
      var self = this;
      var script = document.createElement('script');

      if (this.script) {
        this.script.parentNode.removeChild(this.script);
        this.script = null;
      }

      script.async = true;
      script.src = this.uri();
      script.onerror = function (e) {
        self.onError('jsonp poll error', e);
      };

      var insertAt = document.getElementsByTagName('script')[0];
      if (insertAt) {
        insertAt.parentNode.insertBefore(script, insertAt);
      } else {
        (document.head || document.body).appendChild(script);
      }
      this.script = script;

      var isUAgecko = 'undefined' !== typeof navigator && /gecko/i.test(navigator.userAgent);

      if (isUAgecko) {
        setTimeout(function () {
          var iframe = document.createElement('iframe');
          document.body.appendChild(iframe);
          document.body.removeChild(iframe);
        }, 100);
      }
    };

    /**
     * Writes with a hidden iframe.
     *
     * @param {String} data to send
     * @param {Function} called upon flush.
     * @api private
     */

    JSONPPolling.prototype.doWrite = function (data, fn) {
      var self = this;

      if (!this.form) {
        var form = document.createElement('form');
        var area = document.createElement('textarea');
        var id = this.iframeId = 'eio_iframe_' + this.index;
        var iframe;

        form.className = 'socketio';
        form.style.position = 'absolute';
        form.style.top = '-1000px';
        form.style.left = '-1000px';
        form.target = id;
        form.method = 'POST';
        form.setAttribute('accept-charset', 'utf-8');
        area.name = 'd';
        form.appendChild(area);
        document.body.appendChild(form);

        this.form = form;
        this.area = area;
      }

      this.form.action = this.uri();

      function complete () {
        initIframe();
        fn();
      }

      function initIframe () {
        if (self.iframe) {
          try {
            self.form.removeChild(self.iframe);
          } catch (e) {
            self.onError('jsonp polling iframe removal error', e);
          }
        }

        try {
          // ie6 dynamic iframes with target="" support (thanks Chris Lambacher)
          var html = '<iframe src="javascript:0" name="' + self.iframeId + '">';
          iframe = document.createElement(html);
        } catch (e) {
          iframe = document.createElement('iframe');
          iframe.name = self.iframeId;
          iframe.src = 'javascript:0';
        }

        iframe.id = self.iframeId;

        self.form.appendChild(iframe);
        self.iframe = iframe;
      }

      initIframe();

      // escape \n to prevent it from being converted into \r\n by some UAs
      // double escaping is required for escaped new lines because unescaping of new lines can be done safely on server-side
      data = data.replace(rEscapedNewline, '\\\n');
      this.area.value = data.replace(rNewline, '\\n');

      try {
        this.form.submit();
      } catch (e) {}

      if (this.iframe.attachEvent) {
        this.iframe.onreadystatechange = function () {
          if (self.iframe.readyState === 'complete') {
            complete();
          }
        };
      } else {
        this.iframe.onload = complete;
      }
    };

    var require$$1 = {};

    /**
     * Module dependencies.
     */






    var debug$4 = browser$1('engine.io-client:websocket');

    var BrowserWebSocket, NodeWebSocket;

    if (typeof WebSocket !== 'undefined') {
      BrowserWebSocket = WebSocket;
    } else if (typeof self !== 'undefined') {
      BrowserWebSocket = self.WebSocket || self.MozWebSocket;
    }

    if (typeof window === 'undefined') {
      try {
        NodeWebSocket = require$$1;
      } catch (e) { }
    }

    /**
     * Get either the `WebSocket` or `MozWebSocket` globals
     * in the browser or try to resolve WebSocket-compatible
     * interface exposed by `ws` for Node-like environment.
     */

    var WebSocketImpl = BrowserWebSocket || NodeWebSocket;

    /**
     * Module exports.
     */

    var websocket = WS;

    /**
     * WebSocket transport constructor.
     *
     * @api {Object} connection options
     * @api public
     */

    function WS (opts) {
      var forceBase64 = (opts && opts.forceBase64);
      if (forceBase64) {
        this.supportsBinary = false;
      }
      this.perMessageDeflate = opts.perMessageDeflate;
      this.usingBrowserWebSocket = BrowserWebSocket && !opts.forceNode;
      this.protocols = opts.protocols;
      if (!this.usingBrowserWebSocket) {
        WebSocketImpl = NodeWebSocket;
      }
      transport.call(this, opts);
    }

    /**
     * Inherits from Transport.
     */

    componentInherit(WS, transport);

    /**
     * Transport name.
     *
     * @api public
     */

    WS.prototype.name = 'websocket';

    /*
     * WebSockets support binary
     */

    WS.prototype.supportsBinary = true;

    /**
     * Opens socket.
     *
     * @api private
     */

    WS.prototype.doOpen = function () {
      if (!this.check()) {
        // let probe timeout
        return;
      }

      var uri = this.uri();
      var protocols = this.protocols;

      var opts = {};

      if (!this.isReactNative) {
        opts.agent = this.agent;
        opts.perMessageDeflate = this.perMessageDeflate;

        // SSL options for Node.js client
        opts.pfx = this.pfx;
        opts.key = this.key;
        opts.passphrase = this.passphrase;
        opts.cert = this.cert;
        opts.ca = this.ca;
        opts.ciphers = this.ciphers;
        opts.rejectUnauthorized = this.rejectUnauthorized;
      }

      if (this.extraHeaders) {
        opts.headers = this.extraHeaders;
      }
      if (this.localAddress) {
        opts.localAddress = this.localAddress;
      }

      try {
        this.ws =
          this.usingBrowserWebSocket && !this.isReactNative
            ? protocols
              ? new WebSocketImpl(uri, protocols)
              : new WebSocketImpl(uri)
            : new WebSocketImpl(uri, protocols, opts);
      } catch (err) {
        return this.emit('error', err);
      }

      if (this.ws.binaryType === undefined) {
        this.supportsBinary = false;
      }

      if (this.ws.supports && this.ws.supports.binary) {
        this.supportsBinary = true;
        this.ws.binaryType = 'nodebuffer';
      } else {
        this.ws.binaryType = 'arraybuffer';
      }

      this.addEventListeners();
    };

    /**
     * Adds event listeners to the socket
     *
     * @api private
     */

    WS.prototype.addEventListeners = function () {
      var self = this;

      this.ws.onopen = function () {
        self.onOpen();
      };
      this.ws.onclose = function () {
        self.onClose();
      };
      this.ws.onmessage = function (ev) {
        self.onData(ev.data);
      };
      this.ws.onerror = function (e) {
        self.onError('websocket error', e);
      };
    };

    /**
     * Writes data to socket.
     *
     * @param {Array} array of packets.
     * @api private
     */

    WS.prototype.write = function (packets) {
      var self = this;
      this.writable = false;

      // encodePacket efficient as it uses WS framing
      // no need for encodePayload
      var total = packets.length;
      for (var i = 0, l = total; i < l; i++) {
        (function (packet) {
          browser$3.encodePacket(packet, self.supportsBinary, function (data) {
            if (!self.usingBrowserWebSocket) {
              // always create a new object (GH-437)
              var opts = {};
              if (packet.options) {
                opts.compress = packet.options.compress;
              }

              if (self.perMessageDeflate) {
                var len = 'string' === typeof data ? Buffer.byteLength(data) : data.length;
                if (len < self.perMessageDeflate.threshold) {
                  opts.compress = false;
                }
              }
            }

            // Sometimes the websocket has already been closed but the browser didn't
            // have a chance of informing us about it yet, in that case send will
            // throw an error
            try {
              if (self.usingBrowserWebSocket) {
                // TypeError is thrown when passing the second argument on Safari
                self.ws.send(data);
              } else {
                self.ws.send(data, opts);
              }
            } catch (e) {
              debug$4('websocket closed before onclose event');
            }

            --total || done();
          });
        })(packets[i]);
      }

      function done () {
        self.emit('flush');

        // fake drain
        // defer to next tick to allow Socket to clear writeBuffer
        setTimeout(function () {
          self.writable = true;
          self.emit('drain');
        }, 0);
      }
    };

    /**
     * Called upon close
     *
     * @api private
     */

    WS.prototype.onClose = function () {
      transport.prototype.onClose.call(this);
    };

    /**
     * Closes socket.
     *
     * @api private
     */

    WS.prototype.doClose = function () {
      if (typeof this.ws !== 'undefined') {
        this.ws.close();
      }
    };

    /**
     * Generates uri for connection.
     *
     * @api private
     */

    WS.prototype.uri = function () {
      var query = this.query || {};
      var schema = this.secure ? 'wss' : 'ws';
      var port = '';

      // avoid port if default for schema
      if (this.port && (('wss' === schema && Number(this.port) !== 443) ||
        ('ws' === schema && Number(this.port) !== 80))) {
        port = ':' + this.port;
      }

      // append timestamp to URI
      if (this.timestampRequests) {
        query[this.timestampParam] = yeast_1();
      }

      // communicate binary support capabilities
      if (!this.supportsBinary) {
        query.b64 = 1;
      }

      query = parseqs.encode(query);

      // prepend ? to query
      if (query.length) {
        query = '?' + query;
      }

      var ipv6 = this.hostname.indexOf(':') !== -1;
      return schema + '://' + (ipv6 ? '[' + this.hostname + ']' : this.hostname) + port + this.path + query;
    };

    /**
     * Feature detection for WebSocket.
     *
     * @return {Boolean} whether this transport is available.
     * @api public
     */

    WS.prototype.check = function () {
      return !!WebSocketImpl && !('__initialize' in WebSocketImpl && this.name === WS.prototype.name);
    };

    /**
     * Module dependencies
     */






    /**
     * Export transports.
     */

    var polling_1 = polling$1;
    var websocket_1 = websocket;

    /**
     * Polling transport polymorphic constructor.
     * Decides on xhr vs jsonp based on feature detection.
     *
     * @api private
     */

    function polling$1 (opts) {
      var xhr;
      var xd = false;
      var xs = false;
      var jsonp = false !== opts.jsonp;

      if (typeof location !== 'undefined') {
        var isSSL = 'https:' === location.protocol;
        var port = location.port;

        // some user agents have empty `location.port`
        if (!port) {
          port = isSSL ? 443 : 80;
        }

        xd = opts.hostname !== location.hostname || port !== opts.port;
        xs = opts.secure !== isSSL;
      }

      opts.xdomain = xd;
      opts.xscheme = xs;
      xhr = new xmlhttprequest(opts);

      if ('open' in xhr && !opts.forceJSONP) {
        return new pollingXhr(opts);
      } else {
        if (!jsonp) throw new Error('JSONP disabled');
        return new pollingJsonp(opts);
      }
    }

    var transports = {
    	polling: polling_1,
    	websocket: websocket_1
    };

    var indexOf = [].indexOf;

    var indexof = function(arr, obj){
      if (indexOf) return arr.indexOf(obj);
      for (var i = 0; i < arr.length; ++i) {
        if (arr[i] === obj) return i;
      }
      return -1;
    };

    /**
     * Module dependencies.
     */



    var debug$5 = browser$1('engine.io-client:socket');





    /**
     * Module exports.
     */

    var socket = Socket;

    /**
     * Socket constructor.
     *
     * @param {String|Object} uri or options
     * @param {Object} options
     * @api public
     */

    function Socket (uri, opts) {
      if (!(this instanceof Socket)) return new Socket(uri, opts);

      opts = opts || {};

      if (uri && 'object' === typeof uri) {
        opts = uri;
        uri = null;
      }

      if (uri) {
        uri = parseuri(uri);
        opts.hostname = uri.host;
        opts.secure = uri.protocol === 'https' || uri.protocol === 'wss';
        opts.port = uri.port;
        if (uri.query) opts.query = uri.query;
      } else if (opts.host) {
        opts.hostname = parseuri(opts.host).host;
      }

      this.secure = null != opts.secure ? opts.secure
        : (typeof location !== 'undefined' && 'https:' === location.protocol);

      if (opts.hostname && !opts.port) {
        // if no port is specified manually, use the protocol default
        opts.port = this.secure ? '443' : '80';
      }

      this.agent = opts.agent || false;
      this.hostname = opts.hostname ||
        (typeof location !== 'undefined' ? location.hostname : 'localhost');
      this.port = opts.port || (typeof location !== 'undefined' && location.port
          ? location.port
          : (this.secure ? 443 : 80));
      this.query = opts.query || {};
      if ('string' === typeof this.query) this.query = parseqs.decode(this.query);
      this.upgrade = false !== opts.upgrade;
      this.path = (opts.path || '/engine.io').replace(/\/$/, '') + '/';
      this.forceJSONP = !!opts.forceJSONP;
      this.jsonp = false !== opts.jsonp;
      this.forceBase64 = !!opts.forceBase64;
      this.enablesXDR = !!opts.enablesXDR;
      this.withCredentials = false !== opts.withCredentials;
      this.timestampParam = opts.timestampParam || 't';
      this.timestampRequests = opts.timestampRequests;
      this.transports = opts.transports || ['polling', 'websocket'];
      this.transportOptions = opts.transportOptions || {};
      this.readyState = '';
      this.writeBuffer = [];
      this.prevBufferLen = 0;
      this.policyPort = opts.policyPort || 843;
      this.rememberUpgrade = opts.rememberUpgrade || false;
      this.binaryType = null;
      this.onlyBinaryUpgrades = opts.onlyBinaryUpgrades;
      this.perMessageDeflate = false !== opts.perMessageDeflate ? (opts.perMessageDeflate || {}) : false;

      if (true === this.perMessageDeflate) this.perMessageDeflate = {};
      if (this.perMessageDeflate && null == this.perMessageDeflate.threshold) {
        this.perMessageDeflate.threshold = 1024;
      }

      // SSL options for Node.js client
      this.pfx = opts.pfx || null;
      this.key = opts.key || null;
      this.passphrase = opts.passphrase || null;
      this.cert = opts.cert || null;
      this.ca = opts.ca || null;
      this.ciphers = opts.ciphers || null;
      this.rejectUnauthorized = opts.rejectUnauthorized === undefined ? true : opts.rejectUnauthorized;
      this.forceNode = !!opts.forceNode;

      // detect ReactNative environment
      this.isReactNative = (typeof navigator !== 'undefined' && typeof navigator.product === 'string' && navigator.product.toLowerCase() === 'reactnative');

      // other options for Node.js or ReactNative client
      if (typeof self === 'undefined' || this.isReactNative) {
        if (opts.extraHeaders && Object.keys(opts.extraHeaders).length > 0) {
          this.extraHeaders = opts.extraHeaders;
        }

        if (opts.localAddress) {
          this.localAddress = opts.localAddress;
        }
      }

      // set on handshake
      this.id = null;
      this.upgrades = null;
      this.pingInterval = null;
      this.pingTimeout = null;

      // set on heartbeat
      this.pingIntervalTimer = null;
      this.pingTimeoutTimer = null;

      this.open();
    }

    Socket.priorWebsocketSuccess = false;

    /**
     * Mix in `Emitter`.
     */

    componentEmitter$1(Socket.prototype);

    /**
     * Protocol version.
     *
     * @api public
     */

    Socket.protocol = browser$3.protocol; // this is an int

    /**
     * Expose deps for legacy compatibility
     * and standalone browser access.
     */

    Socket.Socket = Socket;
    Socket.Transport = transport;
    Socket.transports = transports;
    Socket.parser = browser$3;

    /**
     * Creates transport of the given type.
     *
     * @param {String} transport name
     * @return {Transport}
     * @api private
     */

    Socket.prototype.createTransport = function (name) {
      debug$5('creating transport "%s"', name);
      var query = clone(this.query);

      // append engine.io protocol identifier
      query.EIO = browser$3.protocol;

      // transport name
      query.transport = name;

      // per-transport options
      var options = this.transportOptions[name] || {};

      // session id if we already have one
      if (this.id) query.sid = this.id;

      var transport = new transports[name]({
        query: query,
        socket: this,
        agent: options.agent || this.agent,
        hostname: options.hostname || this.hostname,
        port: options.port || this.port,
        secure: options.secure || this.secure,
        path: options.path || this.path,
        forceJSONP: options.forceJSONP || this.forceJSONP,
        jsonp: options.jsonp || this.jsonp,
        forceBase64: options.forceBase64 || this.forceBase64,
        enablesXDR: options.enablesXDR || this.enablesXDR,
        withCredentials: options.withCredentials || this.withCredentials,
        timestampRequests: options.timestampRequests || this.timestampRequests,
        timestampParam: options.timestampParam || this.timestampParam,
        policyPort: options.policyPort || this.policyPort,
        pfx: options.pfx || this.pfx,
        key: options.key || this.key,
        passphrase: options.passphrase || this.passphrase,
        cert: options.cert || this.cert,
        ca: options.ca || this.ca,
        ciphers: options.ciphers || this.ciphers,
        rejectUnauthorized: options.rejectUnauthorized || this.rejectUnauthorized,
        perMessageDeflate: options.perMessageDeflate || this.perMessageDeflate,
        extraHeaders: options.extraHeaders || this.extraHeaders,
        forceNode: options.forceNode || this.forceNode,
        localAddress: options.localAddress || this.localAddress,
        requestTimeout: options.requestTimeout || this.requestTimeout,
        protocols: options.protocols || void (0),
        isReactNative: this.isReactNative
      });

      return transport;
    };

    function clone (obj) {
      var o = {};
      for (var i in obj) {
        if (obj.hasOwnProperty(i)) {
          o[i] = obj[i];
        }
      }
      return o;
    }

    /**
     * Initializes transport to use and starts probe.
     *
     * @api private
     */
    Socket.prototype.open = function () {
      var transport;
      if (this.rememberUpgrade && Socket.priorWebsocketSuccess && this.transports.indexOf('websocket') !== -1) {
        transport = 'websocket';
      } else if (0 === this.transports.length) {
        // Emit error on next tick so it can be listened to
        var self = this;
        setTimeout(function () {
          self.emit('error', 'No transports available');
        }, 0);
        return;
      } else {
        transport = this.transports[0];
      }
      this.readyState = 'opening';

      // Retry with the next transport if the transport is disabled (jsonp: false)
      try {
        transport = this.createTransport(transport);
      } catch (e) {
        this.transports.shift();
        this.open();
        return;
      }

      transport.open();
      this.setTransport(transport);
    };

    /**
     * Sets the current transport. Disables the existing one (if any).
     *
     * @api private
     */

    Socket.prototype.setTransport = function (transport) {
      debug$5('setting transport %s', transport.name);
      var self = this;

      if (this.transport) {
        debug$5('clearing existing transport %s', this.transport.name);
        this.transport.removeAllListeners();
      }

      // set up transport
      this.transport = transport;

      // set up transport listeners
      transport
      .on('drain', function () {
        self.onDrain();
      })
      .on('packet', function (packet) {
        self.onPacket(packet);
      })
      .on('error', function (e) {
        self.onError(e);
      })
      .on('close', function () {
        self.onClose('transport close');
      });
    };

    /**
     * Probes a transport.
     *
     * @param {String} transport name
     * @api private
     */

    Socket.prototype.probe = function (name) {
      debug$5('probing transport "%s"', name);
      var transport = this.createTransport(name, { probe: 1 });
      var failed = false;
      var self = this;

      Socket.priorWebsocketSuccess = false;

      function onTransportOpen () {
        if (self.onlyBinaryUpgrades) {
          var upgradeLosesBinary = !this.supportsBinary && self.transport.supportsBinary;
          failed = failed || upgradeLosesBinary;
        }
        if (failed) return;

        debug$5('probe transport "%s" opened', name);
        transport.send([{ type: 'ping', data: 'probe' }]);
        transport.once('packet', function (msg) {
          if (failed) return;
          if ('pong' === msg.type && 'probe' === msg.data) {
            debug$5('probe transport "%s" pong', name);
            self.upgrading = true;
            self.emit('upgrading', transport);
            if (!transport) return;
            Socket.priorWebsocketSuccess = 'websocket' === transport.name;

            debug$5('pausing current transport "%s"', self.transport.name);
            self.transport.pause(function () {
              if (failed) return;
              if ('closed' === self.readyState) return;
              debug$5('changing transport and sending upgrade packet');

              cleanup();

              self.setTransport(transport);
              transport.send([{ type: 'upgrade' }]);
              self.emit('upgrade', transport);
              transport = null;
              self.upgrading = false;
              self.flush();
            });
          } else {
            debug$5('probe transport "%s" failed', name);
            var err = new Error('probe error');
            err.transport = transport.name;
            self.emit('upgradeError', err);
          }
        });
      }

      function freezeTransport () {
        if (failed) return;

        // Any callback called by transport should be ignored since now
        failed = true;

        cleanup();

        transport.close();
        transport = null;
      }

      // Handle any error that happens while probing
      function onerror (err) {
        var error = new Error('probe error: ' + err);
        error.transport = transport.name;

        freezeTransport();

        debug$5('probe transport "%s" failed because of error: %s', name, err);

        self.emit('upgradeError', error);
      }

      function onTransportClose () {
        onerror('transport closed');
      }

      // When the socket is closed while we're probing
      function onclose () {
        onerror('socket closed');
      }

      // When the socket is upgraded while we're probing
      function onupgrade (to) {
        if (transport && to.name !== transport.name) {
          debug$5('"%s" works - aborting "%s"', to.name, transport.name);
          freezeTransport();
        }
      }

      // Remove all listeners on the transport and on self
      function cleanup () {
        transport.removeListener('open', onTransportOpen);
        transport.removeListener('error', onerror);
        transport.removeListener('close', onTransportClose);
        self.removeListener('close', onclose);
        self.removeListener('upgrading', onupgrade);
      }

      transport.once('open', onTransportOpen);
      transport.once('error', onerror);
      transport.once('close', onTransportClose);

      this.once('close', onclose);
      this.once('upgrading', onupgrade);

      transport.open();
    };

    /**
     * Called when connection is deemed open.
     *
     * @api public
     */

    Socket.prototype.onOpen = function () {
      debug$5('socket open');
      this.readyState = 'open';
      Socket.priorWebsocketSuccess = 'websocket' === this.transport.name;
      this.emit('open');
      this.flush();

      // we check for `readyState` in case an `open`
      // listener already closed the socket
      if ('open' === this.readyState && this.upgrade && this.transport.pause) {
        debug$5('starting upgrade probes');
        for (var i = 0, l = this.upgrades.length; i < l; i++) {
          this.probe(this.upgrades[i]);
        }
      }
    };

    /**
     * Handles a packet.
     *
     * @api private
     */

    Socket.prototype.onPacket = function (packet) {
      if ('opening' === this.readyState || 'open' === this.readyState ||
          'closing' === this.readyState) {
        debug$5('socket receive: type "%s", data "%s"', packet.type, packet.data);

        this.emit('packet', packet);

        // Socket is live - any packet counts
        this.emit('heartbeat');

        switch (packet.type) {
          case 'open':
            this.onHandshake(JSON.parse(packet.data));
            break;

          case 'pong':
            this.setPing();
            this.emit('pong');
            break;

          case 'error':
            var err = new Error('server error');
            err.code = packet.data;
            this.onError(err);
            break;

          case 'message':
            this.emit('data', packet.data);
            this.emit('message', packet.data);
            break;
        }
      } else {
        debug$5('packet received with socket readyState "%s"', this.readyState);
      }
    };

    /**
     * Called upon handshake completion.
     *
     * @param {Object} handshake obj
     * @api private
     */

    Socket.prototype.onHandshake = function (data) {
      this.emit('handshake', data);
      this.id = data.sid;
      this.transport.query.sid = data.sid;
      this.upgrades = this.filterUpgrades(data.upgrades);
      this.pingInterval = data.pingInterval;
      this.pingTimeout = data.pingTimeout;
      this.onOpen();
      // In case open handler closes socket
      if ('closed' === this.readyState) return;
      this.setPing();

      // Prolong liveness of socket on heartbeat
      this.removeListener('heartbeat', this.onHeartbeat);
      this.on('heartbeat', this.onHeartbeat);
    };

    /**
     * Resets ping timeout.
     *
     * @api private
     */

    Socket.prototype.onHeartbeat = function (timeout) {
      clearTimeout(this.pingTimeoutTimer);
      var self = this;
      self.pingTimeoutTimer = setTimeout(function () {
        if ('closed' === self.readyState) return;
        self.onClose('ping timeout');
      }, timeout || (self.pingInterval + self.pingTimeout));
    };

    /**
     * Pings server every `this.pingInterval` and expects response
     * within `this.pingTimeout` or closes connection.
     *
     * @api private
     */

    Socket.prototype.setPing = function () {
      var self = this;
      clearTimeout(self.pingIntervalTimer);
      self.pingIntervalTimer = setTimeout(function () {
        debug$5('writing ping packet - expecting pong within %sms', self.pingTimeout);
        self.ping();
        self.onHeartbeat(self.pingTimeout);
      }, self.pingInterval);
    };

    /**
    * Sends a ping packet.
    *
    * @api private
    */

    Socket.prototype.ping = function () {
      var self = this;
      this.sendPacket('ping', function () {
        self.emit('ping');
      });
    };

    /**
     * Called on `drain` event
     *
     * @api private
     */

    Socket.prototype.onDrain = function () {
      this.writeBuffer.splice(0, this.prevBufferLen);

      // setting prevBufferLen = 0 is very important
      // for example, when upgrading, upgrade packet is sent over,
      // and a nonzero prevBufferLen could cause problems on `drain`
      this.prevBufferLen = 0;

      if (0 === this.writeBuffer.length) {
        this.emit('drain');
      } else {
        this.flush();
      }
    };

    /**
     * Flush write buffers.
     *
     * @api private
     */

    Socket.prototype.flush = function () {
      if ('closed' !== this.readyState && this.transport.writable &&
        !this.upgrading && this.writeBuffer.length) {
        debug$5('flushing %d packets in socket', this.writeBuffer.length);
        this.transport.send(this.writeBuffer);
        // keep track of current length of writeBuffer
        // splice writeBuffer and callbackBuffer on `drain`
        this.prevBufferLen = this.writeBuffer.length;
        this.emit('flush');
      }
    };

    /**
     * Sends a message.
     *
     * @param {String} message.
     * @param {Function} callback function.
     * @param {Object} options.
     * @return {Socket} for chaining.
     * @api public
     */

    Socket.prototype.write =
    Socket.prototype.send = function (msg, options, fn) {
      this.sendPacket('message', msg, options, fn);
      return this;
    };

    /**
     * Sends a packet.
     *
     * @param {String} packet type.
     * @param {String} data.
     * @param {Object} options.
     * @param {Function} callback function.
     * @api private
     */

    Socket.prototype.sendPacket = function (type, data, options, fn) {
      if ('function' === typeof data) {
        fn = data;
        data = undefined;
      }

      if ('function' === typeof options) {
        fn = options;
        options = null;
      }

      if ('closing' === this.readyState || 'closed' === this.readyState) {
        return;
      }

      options = options || {};
      options.compress = false !== options.compress;

      var packet = {
        type: type,
        data: data,
        options: options
      };
      this.emit('packetCreate', packet);
      this.writeBuffer.push(packet);
      if (fn) this.once('flush', fn);
      this.flush();
    };

    /**
     * Closes the connection.
     *
     * @api private
     */

    Socket.prototype.close = function () {
      if ('opening' === this.readyState || 'open' === this.readyState) {
        this.readyState = 'closing';

        var self = this;

        if (this.writeBuffer.length) {
          this.once('drain', function () {
            if (this.upgrading) {
              waitForUpgrade();
            } else {
              close();
            }
          });
        } else if (this.upgrading) {
          waitForUpgrade();
        } else {
          close();
        }
      }

      function close () {
        self.onClose('forced close');
        debug$5('socket closing - telling transport to close');
        self.transport.close();
      }

      function cleanupAndClose () {
        self.removeListener('upgrade', cleanupAndClose);
        self.removeListener('upgradeError', cleanupAndClose);
        close();
      }

      function waitForUpgrade () {
        // wait for upgrade to finish since we can't send packets while pausing a transport
        self.once('upgrade', cleanupAndClose);
        self.once('upgradeError', cleanupAndClose);
      }

      return this;
    };

    /**
     * Called upon transport error
     *
     * @api private
     */

    Socket.prototype.onError = function (err) {
      debug$5('socket error %j', err);
      Socket.priorWebsocketSuccess = false;
      this.emit('error', err);
      this.onClose('transport error', err);
    };

    /**
     * Called upon transport close.
     *
     * @api private
     */

    Socket.prototype.onClose = function (reason, desc) {
      if ('opening' === this.readyState || 'open' === this.readyState || 'closing' === this.readyState) {
        debug$5('socket close with reason: "%s"', reason);
        var self = this;

        // clear timers
        clearTimeout(this.pingIntervalTimer);
        clearTimeout(this.pingTimeoutTimer);

        // stop event from firing again for transport
        this.transport.removeAllListeners('close');

        // ensure transport won't stay open
        this.transport.close();

        // ignore further transport communication
        this.transport.removeAllListeners();

        // set ready state
        this.readyState = 'closed';

        // clear session id
        this.id = null;

        // emit close event
        this.emit('close', reason, desc);

        // clean buffers after, so users can still
        // grab the buffers on `close` event
        self.writeBuffer = [];
        self.prevBufferLen = 0;
      }
    };

    /**
     * Filters upgrades, returning only those matching client transports.
     *
     * @param {Array} server upgrades
     * @api private
     *
     */

    Socket.prototype.filterUpgrades = function (upgrades) {
      var filteredUpgrades = [];
      for (var i = 0, j = upgrades.length; i < j; i++) {
        if (~indexof(this.transports, upgrades[i])) filteredUpgrades.push(upgrades[i]);
      }
      return filteredUpgrades;
    };

    var lib = socket;

    /**
     * Exports parser
     *
     * @api public
     *
     */
    var parser = browser$3;
    lib.parser = parser;

    var toArray_1 = toArray;

    function toArray(list, index) {
        var array = [];

        index = index || 0;

        for (var i = index || 0; i < list.length; i++) {
            array[i - index] = list[i];
        }

        return array
    }

    /**
     * Module exports.
     */

    var on_1 = on$1;

    /**
     * Helper for subscriptions.
     *
     * @param {Object|EventEmitter} obj with `Emitter` mixin or `EventEmitter`
     * @param {String} event name
     * @param {Function} callback
     * @api public
     */

    function on$1 (obj, ev, fn) {
      obj.on(ev, fn);
      return {
        destroy: function () {
          obj.removeListener(ev, fn);
        }
      };
    }

    /**
     * Slice reference.
     */

    var slice = [].slice;

    /**
     * Bind `obj` to `fn`.
     *
     * @param {Object} obj
     * @param {Function|String} fn or string
     * @return {Function}
     * @api public
     */

    var componentBind = function(obj, fn){
      if ('string' == typeof fn) fn = obj[fn];
      if ('function' != typeof fn) throw new Error('bind() requires a function');
      var args = slice.call(arguments, 2);
      return function(){
        return fn.apply(obj, args.concat(slice.call(arguments)));
      }
    };

    var socket$1 = createCommonjsModule(function (module, exports) {
    /**
     * Module dependencies.
     */






    var debug = browser$1('socket.io-client:socket');



    /**
     * Module exports.
     */

    module.exports = exports = Socket;

    /**
     * Internal events (blacklisted).
     * These events can't be emitted by the user.
     *
     * @api private
     */

    var events = {
      connect: 1,
      connect_error: 1,
      connect_timeout: 1,
      connecting: 1,
      disconnect: 1,
      error: 1,
      reconnect: 1,
      reconnect_attempt: 1,
      reconnect_failed: 1,
      reconnect_error: 1,
      reconnecting: 1,
      ping: 1,
      pong: 1
    };

    /**
     * Shortcut to `Emitter#emit`.
     */

    var emit = componentEmitter.prototype.emit;

    /**
     * `Socket` constructor.
     *
     * @api public
     */

    function Socket (io, nsp, opts) {
      this.io = io;
      this.nsp = nsp;
      this.json = this; // compat
      this.ids = 0;
      this.acks = {};
      this.receiveBuffer = [];
      this.sendBuffer = [];
      this.connected = false;
      this.disconnected = true;
      this.flags = {};
      if (opts && opts.query) {
        this.query = opts.query;
      }
      if (this.io.autoConnect) this.open();
    }

    /**
     * Mix in `Emitter`.
     */

    componentEmitter(Socket.prototype);

    /**
     * Subscribe to open, close and packet events
     *
     * @api private
     */

    Socket.prototype.subEvents = function () {
      if (this.subs) return;

      var io = this.io;
      this.subs = [
        on_1(io, 'open', componentBind(this, 'onopen')),
        on_1(io, 'packet', componentBind(this, 'onpacket')),
        on_1(io, 'close', componentBind(this, 'onclose'))
      ];
    };

    /**
     * "Opens" the socket.
     *
     * @api public
     */

    Socket.prototype.open =
    Socket.prototype.connect = function () {
      if (this.connected) return this;

      this.subEvents();
      this.io.open(); // ensure open
      if ('open' === this.io.readyState) this.onopen();
      this.emit('connecting');
      return this;
    };

    /**
     * Sends a `message` event.
     *
     * @return {Socket} self
     * @api public
     */

    Socket.prototype.send = function () {
      var args = toArray_1(arguments);
      args.unshift('message');
      this.emit.apply(this, args);
      return this;
    };

    /**
     * Override `emit`.
     * If the event is in `events`, it's emitted normally.
     *
     * @param {String} event name
     * @return {Socket} self
     * @api public
     */

    Socket.prototype.emit = function (ev) {
      if (events.hasOwnProperty(ev)) {
        emit.apply(this, arguments);
        return this;
      }

      var args = toArray_1(arguments);
      var packet = {
        type: (this.flags.binary !== undefined ? this.flags.binary : hasBinary2(args)) ? socket_ioParser.BINARY_EVENT : socket_ioParser.EVENT,
        data: args
      };

      packet.options = {};
      packet.options.compress = !this.flags || false !== this.flags.compress;

      // event ack callback
      if ('function' === typeof args[args.length - 1]) {
        debug('emitting packet with ack id %d', this.ids);
        this.acks[this.ids] = args.pop();
        packet.id = this.ids++;
      }

      if (this.connected) {
        this.packet(packet);
      } else {
        this.sendBuffer.push(packet);
      }

      this.flags = {};

      return this;
    };

    /**
     * Sends a packet.
     *
     * @param {Object} packet
     * @api private
     */

    Socket.prototype.packet = function (packet) {
      packet.nsp = this.nsp;
      this.io.packet(packet);
    };

    /**
     * Called upon engine `open`.
     *
     * @api private
     */

    Socket.prototype.onopen = function () {
      debug('transport is open - connecting');

      // write connect packet if necessary
      if ('/' !== this.nsp) {
        if (this.query) {
          var query = typeof this.query === 'object' ? parseqs.encode(this.query) : this.query;
          debug('sending connect packet with query %s', query);
          this.packet({type: socket_ioParser.CONNECT, query: query});
        } else {
          this.packet({type: socket_ioParser.CONNECT});
        }
      }
    };

    /**
     * Called upon engine `close`.
     *
     * @param {String} reason
     * @api private
     */

    Socket.prototype.onclose = function (reason) {
      debug('close (%s)', reason);
      this.connected = false;
      this.disconnected = true;
      delete this.id;
      this.emit('disconnect', reason);
    };

    /**
     * Called with socket packet.
     *
     * @param {Object} packet
     * @api private
     */

    Socket.prototype.onpacket = function (packet) {
      var sameNamespace = packet.nsp === this.nsp;
      var rootNamespaceError = packet.type === socket_ioParser.ERROR && packet.nsp === '/';

      if (!sameNamespace && !rootNamespaceError) return;

      switch (packet.type) {
        case socket_ioParser.CONNECT:
          this.onconnect();
          break;

        case socket_ioParser.EVENT:
          this.onevent(packet);
          break;

        case socket_ioParser.BINARY_EVENT:
          this.onevent(packet);
          break;

        case socket_ioParser.ACK:
          this.onack(packet);
          break;

        case socket_ioParser.BINARY_ACK:
          this.onack(packet);
          break;

        case socket_ioParser.DISCONNECT:
          this.ondisconnect();
          break;

        case socket_ioParser.ERROR:
          this.emit('error', packet.data);
          break;
      }
    };

    /**
     * Called upon a server event.
     *
     * @param {Object} packet
     * @api private
     */

    Socket.prototype.onevent = function (packet) {
      var args = packet.data || [];
      debug('emitting event %j', args);

      if (null != packet.id) {
        debug('attaching ack callback to event');
        args.push(this.ack(packet.id));
      }

      if (this.connected) {
        emit.apply(this, args);
      } else {
        this.receiveBuffer.push(args);
      }
    };

    /**
     * Produces an ack callback to emit with an event.
     *
     * @api private
     */

    Socket.prototype.ack = function (id) {
      var self = this;
      var sent = false;
      return function () {
        // prevent double callbacks
        if (sent) return;
        sent = true;
        var args = toArray_1(arguments);
        debug('sending ack %j', args);

        self.packet({
          type: hasBinary2(args) ? socket_ioParser.BINARY_ACK : socket_ioParser.ACK,
          id: id,
          data: args
        });
      };
    };

    /**
     * Called upon a server acknowlegement.
     *
     * @param {Object} packet
     * @api private
     */

    Socket.prototype.onack = function (packet) {
      var ack = this.acks[packet.id];
      if ('function' === typeof ack) {
        debug('calling ack %s with %j', packet.id, packet.data);
        ack.apply(this, packet.data);
        delete this.acks[packet.id];
      } else {
        debug('bad ack %s', packet.id);
      }
    };

    /**
     * Called upon server connect.
     *
     * @api private
     */

    Socket.prototype.onconnect = function () {
      this.connected = true;
      this.disconnected = false;
      this.emit('connect');
      this.emitBuffered();
    };

    /**
     * Emit buffered events (received and emitted).
     *
     * @api private
     */

    Socket.prototype.emitBuffered = function () {
      var i;
      for (i = 0; i < this.receiveBuffer.length; i++) {
        emit.apply(this, this.receiveBuffer[i]);
      }
      this.receiveBuffer = [];

      for (i = 0; i < this.sendBuffer.length; i++) {
        this.packet(this.sendBuffer[i]);
      }
      this.sendBuffer = [];
    };

    /**
     * Called upon server disconnect.
     *
     * @api private
     */

    Socket.prototype.ondisconnect = function () {
      debug('server disconnect (%s)', this.nsp);
      this.destroy();
      this.onclose('io server disconnect');
    };

    /**
     * Called upon forced client/server side disconnections,
     * this method ensures the manager stops tracking us and
     * that reconnections don't get triggered for this.
     *
     * @api private.
     */

    Socket.prototype.destroy = function () {
      if (this.subs) {
        // clean subscriptions to avoid reconnections
        for (var i = 0; i < this.subs.length; i++) {
          this.subs[i].destroy();
        }
        this.subs = null;
      }

      this.io.destroy(this);
    };

    /**
     * Disconnects the socket manually.
     *
     * @return {Socket} self
     * @api public
     */

    Socket.prototype.close =
    Socket.prototype.disconnect = function () {
      if (this.connected) {
        debug('performing disconnect (%s)', this.nsp);
        this.packet({ type: socket_ioParser.DISCONNECT });
      }

      // remove socket from pool
      this.destroy();

      if (this.connected) {
        // fire events
        this.onclose('io client disconnect');
      }
      return this;
    };

    /**
     * Sets the compress flag.
     *
     * @param {Boolean} if `true`, compresses the sending data
     * @return {Socket} self
     * @api public
     */

    Socket.prototype.compress = function (compress) {
      this.flags.compress = compress;
      return this;
    };

    /**
     * Sets the binary flag
     *
     * @param {Boolean} whether the emitted data contains binary
     * @return {Socket} self
     * @api public
     */

    Socket.prototype.binary = function (binary) {
      this.flags.binary = binary;
      return this;
    };
    });

    /**
     * Expose `Backoff`.
     */

    var backo2 = Backoff;

    /**
     * Initialize backoff timer with `opts`.
     *
     * - `min` initial timeout in milliseconds [100]
     * - `max` max timeout [10000]
     * - `jitter` [0]
     * - `factor` [2]
     *
     * @param {Object} opts
     * @api public
     */

    function Backoff(opts) {
      opts = opts || {};
      this.ms = opts.min || 100;
      this.max = opts.max || 10000;
      this.factor = opts.factor || 2;
      this.jitter = opts.jitter > 0 && opts.jitter <= 1 ? opts.jitter : 0;
      this.attempts = 0;
    }

    /**
     * Return the backoff duration.
     *
     * @return {Number}
     * @api public
     */

    Backoff.prototype.duration = function(){
      var ms = this.ms * Math.pow(this.factor, this.attempts++);
      if (this.jitter) {
        var rand =  Math.random();
        var deviation = Math.floor(rand * this.jitter * ms);
        ms = (Math.floor(rand * 10) & 1) == 0  ? ms - deviation : ms + deviation;
      }
      return Math.min(ms, this.max) | 0;
    };

    /**
     * Reset the number of attempts.
     *
     * @api public
     */

    Backoff.prototype.reset = function(){
      this.attempts = 0;
    };

    /**
     * Set the minimum duration
     *
     * @api public
     */

    Backoff.prototype.setMin = function(min){
      this.ms = min;
    };

    /**
     * Set the maximum duration
     *
     * @api public
     */

    Backoff.prototype.setMax = function(max){
      this.max = max;
    };

    /**
     * Set the jitter
     *
     * @api public
     */

    Backoff.prototype.setJitter = function(jitter){
      this.jitter = jitter;
    };

    /**
     * Module dependencies.
     */







    var debug$6 = browser$1('socket.io-client:manager');



    /**
     * IE6+ hasOwnProperty
     */

    var has = Object.prototype.hasOwnProperty;

    /**
     * Module exports
     */

    var manager = Manager;

    /**
     * `Manager` constructor.
     *
     * @param {String} engine instance or engine uri/opts
     * @param {Object} options
     * @api public
     */

    function Manager (uri, opts) {
      if (!(this instanceof Manager)) return new Manager(uri, opts);
      if (uri && ('object' === typeof uri)) {
        opts = uri;
        uri = undefined;
      }
      opts = opts || {};

      opts.path = opts.path || '/socket.io';
      this.nsps = {};
      this.subs = [];
      this.opts = opts;
      this.reconnection(opts.reconnection !== false);
      this.reconnectionAttempts(opts.reconnectionAttempts || Infinity);
      this.reconnectionDelay(opts.reconnectionDelay || 1000);
      this.reconnectionDelayMax(opts.reconnectionDelayMax || 5000);
      this.randomizationFactor(opts.randomizationFactor || 0.5);
      this.backoff = new backo2({
        min: this.reconnectionDelay(),
        max: this.reconnectionDelayMax(),
        jitter: this.randomizationFactor()
      });
      this.timeout(null == opts.timeout ? 20000 : opts.timeout);
      this.readyState = 'closed';
      this.uri = uri;
      this.connecting = [];
      this.lastPing = null;
      this.encoding = false;
      this.packetBuffer = [];
      var _parser = opts.parser || socket_ioParser;
      this.encoder = new _parser.Encoder();
      this.decoder = new _parser.Decoder();
      this.autoConnect = opts.autoConnect !== false;
      if (this.autoConnect) this.open();
    }

    /**
     * Propagate given event to sockets and emit on `this`
     *
     * @api private
     */

    Manager.prototype.emitAll = function () {
      this.emit.apply(this, arguments);
      for (var nsp in this.nsps) {
        if (has.call(this.nsps, nsp)) {
          this.nsps[nsp].emit.apply(this.nsps[nsp], arguments);
        }
      }
    };

    /**
     * Update `socket.id` of all sockets
     *
     * @api private
     */

    Manager.prototype.updateSocketIds = function () {
      for (var nsp in this.nsps) {
        if (has.call(this.nsps, nsp)) {
          this.nsps[nsp].id = this.generateId(nsp);
        }
      }
    };

    /**
     * generate `socket.id` for the given `nsp`
     *
     * @param {String} nsp
     * @return {String}
     * @api private
     */

    Manager.prototype.generateId = function (nsp) {
      return (nsp === '/' ? '' : (nsp + '#')) + this.engine.id;
    };

    /**
     * Mix in `Emitter`.
     */

    componentEmitter(Manager.prototype);

    /**
     * Sets the `reconnection` config.
     *
     * @param {Boolean} true/false if it should automatically reconnect
     * @return {Manager} self or value
     * @api public
     */

    Manager.prototype.reconnection = function (v) {
      if (!arguments.length) return this._reconnection;
      this._reconnection = !!v;
      return this;
    };

    /**
     * Sets the reconnection attempts config.
     *
     * @param {Number} max reconnection attempts before giving up
     * @return {Manager} self or value
     * @api public
     */

    Manager.prototype.reconnectionAttempts = function (v) {
      if (!arguments.length) return this._reconnectionAttempts;
      this._reconnectionAttempts = v;
      return this;
    };

    /**
     * Sets the delay between reconnections.
     *
     * @param {Number} delay
     * @return {Manager} self or value
     * @api public
     */

    Manager.prototype.reconnectionDelay = function (v) {
      if (!arguments.length) return this._reconnectionDelay;
      this._reconnectionDelay = v;
      this.backoff && this.backoff.setMin(v);
      return this;
    };

    Manager.prototype.randomizationFactor = function (v) {
      if (!arguments.length) return this._randomizationFactor;
      this._randomizationFactor = v;
      this.backoff && this.backoff.setJitter(v);
      return this;
    };

    /**
     * Sets the maximum delay between reconnections.
     *
     * @param {Number} delay
     * @return {Manager} self or value
     * @api public
     */

    Manager.prototype.reconnectionDelayMax = function (v) {
      if (!arguments.length) return this._reconnectionDelayMax;
      this._reconnectionDelayMax = v;
      this.backoff && this.backoff.setMax(v);
      return this;
    };

    /**
     * Sets the connection timeout. `false` to disable
     *
     * @return {Manager} self or value
     * @api public
     */

    Manager.prototype.timeout = function (v) {
      if (!arguments.length) return this._timeout;
      this._timeout = v;
      return this;
    };

    /**
     * Starts trying to reconnect if reconnection is enabled and we have not
     * started reconnecting yet
     *
     * @api private
     */

    Manager.prototype.maybeReconnectOnOpen = function () {
      // Only try to reconnect if it's the first time we're connecting
      if (!this.reconnecting && this._reconnection && this.backoff.attempts === 0) {
        // keeps reconnection from firing twice for the same reconnection loop
        this.reconnect();
      }
    };

    /**
     * Sets the current transport `socket`.
     *
     * @param {Function} optional, callback
     * @return {Manager} self
     * @api public
     */

    Manager.prototype.open =
    Manager.prototype.connect = function (fn, opts) {
      debug$6('readyState %s', this.readyState);
      if (~this.readyState.indexOf('open')) return this;

      debug$6('opening %s', this.uri);
      this.engine = lib(this.uri, this.opts);
      var socket = this.engine;
      var self = this;
      this.readyState = 'opening';
      this.skipReconnect = false;

      // emit `open`
      var openSub = on_1(socket, 'open', function () {
        self.onopen();
        fn && fn();
      });

      // emit `connect_error`
      var errorSub = on_1(socket, 'error', function (data) {
        debug$6('connect_error');
        self.cleanup();
        self.readyState = 'closed';
        self.emitAll('connect_error', data);
        if (fn) {
          var err = new Error('Connection error');
          err.data = data;
          fn(err);
        } else {
          // Only do this if there is no fn to handle the error
          self.maybeReconnectOnOpen();
        }
      });

      // emit `connect_timeout`
      if (false !== this._timeout) {
        var timeout = this._timeout;
        debug$6('connect attempt will timeout after %d', timeout);

        // set timer
        var timer = setTimeout(function () {
          debug$6('connect attempt timed out after %d', timeout);
          openSub.destroy();
          socket.close();
          socket.emit('error', 'timeout');
          self.emitAll('connect_timeout', timeout);
        }, timeout);

        this.subs.push({
          destroy: function () {
            clearTimeout(timer);
          }
        });
      }

      this.subs.push(openSub);
      this.subs.push(errorSub);

      return this;
    };

    /**
     * Called upon transport open.
     *
     * @api private
     */

    Manager.prototype.onopen = function () {
      debug$6('open');

      // clear old subs
      this.cleanup();

      // mark as open
      this.readyState = 'open';
      this.emit('open');

      // add new subs
      var socket = this.engine;
      this.subs.push(on_1(socket, 'data', componentBind(this, 'ondata')));
      this.subs.push(on_1(socket, 'ping', componentBind(this, 'onping')));
      this.subs.push(on_1(socket, 'pong', componentBind(this, 'onpong')));
      this.subs.push(on_1(socket, 'error', componentBind(this, 'onerror')));
      this.subs.push(on_1(socket, 'close', componentBind(this, 'onclose')));
      this.subs.push(on_1(this.decoder, 'decoded', componentBind(this, 'ondecoded')));
    };

    /**
     * Called upon a ping.
     *
     * @api private
     */

    Manager.prototype.onping = function () {
      this.lastPing = new Date();
      this.emitAll('ping');
    };

    /**
     * Called upon a packet.
     *
     * @api private
     */

    Manager.prototype.onpong = function () {
      this.emitAll('pong', new Date() - this.lastPing);
    };

    /**
     * Called with data.
     *
     * @api private
     */

    Manager.prototype.ondata = function (data) {
      this.decoder.add(data);
    };

    /**
     * Called when parser fully decodes a packet.
     *
     * @api private
     */

    Manager.prototype.ondecoded = function (packet) {
      this.emit('packet', packet);
    };

    /**
     * Called upon socket error.
     *
     * @api private
     */

    Manager.prototype.onerror = function (err) {
      debug$6('error', err);
      this.emitAll('error', err);
    };

    /**
     * Creates a new socket for the given `nsp`.
     *
     * @return {Socket}
     * @api public
     */

    Manager.prototype.socket = function (nsp, opts) {
      var socket = this.nsps[nsp];
      if (!socket) {
        socket = new socket$1(this, nsp, opts);
        this.nsps[nsp] = socket;
        var self = this;
        socket.on('connecting', onConnecting);
        socket.on('connect', function () {
          socket.id = self.generateId(nsp);
        });

        if (this.autoConnect) {
          // manually call here since connecting event is fired before listening
          onConnecting();
        }
      }

      function onConnecting () {
        if (!~indexof(self.connecting, socket)) {
          self.connecting.push(socket);
        }
      }

      return socket;
    };

    /**
     * Called upon a socket close.
     *
     * @param {Socket} socket
     */

    Manager.prototype.destroy = function (socket) {
      var index = indexof(this.connecting, socket);
      if (~index) this.connecting.splice(index, 1);
      if (this.connecting.length) return;

      this.close();
    };

    /**
     * Writes a packet.
     *
     * @param {Object} packet
     * @api private
     */

    Manager.prototype.packet = function (packet) {
      debug$6('writing packet %j', packet);
      var self = this;
      if (packet.query && packet.type === 0) packet.nsp += '?' + packet.query;

      if (!self.encoding) {
        // encode, then write to engine with result
        self.encoding = true;
        this.encoder.encode(packet, function (encodedPackets) {
          for (var i = 0; i < encodedPackets.length; i++) {
            self.engine.write(encodedPackets[i], packet.options);
          }
          self.encoding = false;
          self.processPacketQueue();
        });
      } else { // add packet to the queue
        self.packetBuffer.push(packet);
      }
    };

    /**
     * If packet buffer is non-empty, begins encoding the
     * next packet in line.
     *
     * @api private
     */

    Manager.prototype.processPacketQueue = function () {
      if (this.packetBuffer.length > 0 && !this.encoding) {
        var pack = this.packetBuffer.shift();
        this.packet(pack);
      }
    };

    /**
     * Clean up transport subscriptions and packet buffer.
     *
     * @api private
     */

    Manager.prototype.cleanup = function () {
      debug$6('cleanup');

      var subsLength = this.subs.length;
      for (var i = 0; i < subsLength; i++) {
        var sub = this.subs.shift();
        sub.destroy();
      }

      this.packetBuffer = [];
      this.encoding = false;
      this.lastPing = null;

      this.decoder.destroy();
    };

    /**
     * Close the current socket.
     *
     * @api private
     */

    Manager.prototype.close =
    Manager.prototype.disconnect = function () {
      debug$6('disconnect');
      this.skipReconnect = true;
      this.reconnecting = false;
      if ('opening' === this.readyState) {
        // `onclose` will not fire because
        // an open event never happened
        this.cleanup();
      }
      this.backoff.reset();
      this.readyState = 'closed';
      if (this.engine) this.engine.close();
    };

    /**
     * Called upon engine close.
     *
     * @api private
     */

    Manager.prototype.onclose = function (reason) {
      debug$6('onclose');

      this.cleanup();
      this.backoff.reset();
      this.readyState = 'closed';
      this.emit('close', reason);

      if (this._reconnection && !this.skipReconnect) {
        this.reconnect();
      }
    };

    /**
     * Attempt a reconnection.
     *
     * @api private
     */

    Manager.prototype.reconnect = function () {
      if (this.reconnecting || this.skipReconnect) return this;

      var self = this;

      if (this.backoff.attempts >= this._reconnectionAttempts) {
        debug$6('reconnect failed');
        this.backoff.reset();
        this.emitAll('reconnect_failed');
        this.reconnecting = false;
      } else {
        var delay = this.backoff.duration();
        debug$6('will wait %dms before reconnect attempt', delay);

        this.reconnecting = true;
        var timer = setTimeout(function () {
          if (self.skipReconnect) return;

          debug$6('attempting reconnect');
          self.emitAll('reconnect_attempt', self.backoff.attempts);
          self.emitAll('reconnecting', self.backoff.attempts);

          // check again for the case socket closed in above events
          if (self.skipReconnect) return;

          self.open(function (err) {
            if (err) {
              debug$6('reconnect attempt error');
              self.reconnecting = false;
              self.reconnect();
              self.emitAll('reconnect_error', err.data);
            } else {
              debug$6('reconnect success');
              self.onreconnect();
            }
          });
        }, delay);

        this.subs.push({
          destroy: function () {
            clearTimeout(timer);
          }
        });
      }
    };

    /**
     * Called upon successful reconnect.
     *
     * @api private
     */

    Manager.prototype.onreconnect = function () {
      var attempt = this.backoff.attempts;
      this.reconnecting = false;
      this.backoff.reset();
      this.updateSocketIds();
      this.emitAll('reconnect', attempt);
    };

    var lib$1 = createCommonjsModule(function (module, exports) {
    /**
     * Module dependencies.
     */




    var debug = browser$1('socket.io-client');

    /**
     * Module exports.
     */

    module.exports = exports = lookup;

    /**
     * Managers cache.
     */

    var cache = exports.managers = {};

    /**
     * Looks up an existing `Manager` for multiplexing.
     * If the user summons:
     *
     *   `io('http://localhost/a');`
     *   `io('http://localhost/b');`
     *
     * We reuse the existing instance based on same scheme/port/host,
     * and we initialize sockets for each namespace.
     *
     * @api public
     */

    function lookup (uri, opts) {
      if (typeof uri === 'object') {
        opts = uri;
        uri = undefined;
      }

      opts = opts || {};

      var parsed = url_1(uri);
      var source = parsed.source;
      var id = parsed.id;
      var path = parsed.path;
      var sameNamespace = cache[id] && path in cache[id].nsps;
      var newConnection = opts.forceNew || opts['force new connection'] ||
                          false === opts.multiplex || sameNamespace;

      var io;

      if (newConnection) {
        debug('ignoring socket cache for %s', source);
        io = manager(source, opts);
      } else {
        if (!cache[id]) {
          debug('new io instance for %s', source);
          cache[id] = manager(source, opts);
        }
        io = cache[id];
      }
      if (parsed.query && !opts.query) {
        opts.query = parsed.query;
      }
      return io.socket(parsed.path, opts);
    }

    /**
     * Protocol version.
     *
     * @api public
     */

    exports.protocol = socket_ioParser.protocol;

    /**
     * `connect`.
     *
     * @param {String} uri
     * @api public
     */

    exports.connect = lookup;

    /**
     * Expose constructors for standalone build.
     *
     * @api public
     */

    exports.Manager = manager;
    exports.Socket = socket$1;
    });
    var lib_1 = lib$1.managers;
    var lib_2 = lib$1.protocol;
    var lib_3 = lib$1.connect;
    var lib_4 = lib$1.Manager;
    var lib_5 = lib$1.Socket;

    /* timer.svelte generated by Svelte v3.23.0 */

    function add_css() {
    	var style = element("style");
    	style.id = "svelte-1oma4mt-style";
    	style.textContent = ".main.svelte-1oma4mt{width:100%;height:100%;display:flex;flex-direction:row;flex-wrap:wrap}.item.svelte-1oma4mt{cursor:pointer;background:lightgray;border:2px solid black;font-size:30px;flex:1 0 49%}.item.active.svelte-1oma4mt{border:2px solid red;background:gray}.item.stop.svelte-1oma4mt{font-size:30px;font-weight:bold}";
    	append(document.head, style);
    }

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[8] = list[i];
    	return child_ctx;
    }

    // (63:2) {#each states as state}
    function create_each_block(ctx) {
    	let div1;
    	let input;
    	let input_value_value;
    	let t0;
    	let div0;
    	let t1_value = Math.floor(/*state*/ ctx[8].time / 60).pad(2) + "";
    	let t1;
    	let t2;
    	let t3_value = Math.floor(/*state*/ ctx[8].time % 60).pad(2) + "";
    	let t3;
    	let mounted;
    	let dispose;

    	function change_handler(...args) {
    		return /*change_handler*/ ctx[5](/*state*/ ctx[8], ...args);
    	}

    	function click_handler_1(...args) {
    		return /*click_handler_1*/ ctx[6](/*state*/ ctx[8], ...args);
    	}

    	return {
    		c() {
    			div1 = element("div");
    			input = element("input");
    			t0 = space();
    			div0 = element("div");
    			t1 = text(t1_value);
    			t2 = text(":");
    			t3 = text(t3_value);
    			input.value = input_value_value = /*state*/ ctx[8].name;
    			attr(div1, "class", "item svelte-1oma4mt");
    			toggle_class(div1, "active", /*state*/ ctx[8].activated);
    		},
    		m(target, anchor) {
    			insert(target, div1, anchor);
    			append(div1, input);
    			append(div1, t0);
    			append(div1, div0);
    			append(div0, t1);
    			append(div0, t2);
    			append(div0, t3);

    			if (!mounted) {
    				dispose = [
    					listen(input, "click", stop_propagation(/*click_handler*/ ctx[4])),
    					listen(input, "change", change_handler),
    					listen(div1, "click", click_handler_1)
    				];

    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (dirty & /*states*/ 1 && input_value_value !== (input_value_value = /*state*/ ctx[8].name) && input.value !== input_value_value) {
    				input.value = input_value_value;
    			}

    			if (dirty & /*states*/ 1 && t1_value !== (t1_value = Math.floor(/*state*/ ctx[8].time / 60).pad(2) + "")) set_data(t1, t1_value);
    			if (dirty & /*states*/ 1 && t3_value !== (t3_value = Math.floor(/*state*/ ctx[8].time % 60).pad(2) + "")) set_data(t3, t3_value);

    			if (dirty & /*states*/ 1) {
    				toggle_class(div1, "active", /*state*/ ctx[8].activated);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div1);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let div1;
    	let t0;
    	let div0;
    	let mounted;
    	let dispose;
    	let each_value = /*states*/ ctx[0];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	return {
    		c() {
    			div1 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t0 = space();
    			div0 = element("div");
    			div0.textContent = "PAUSE";
    			attr(div0, "class", "item stop svelte-1oma4mt");
    			attr(div1, "class", "main svelte-1oma4mt");
    		},
    		m(target, anchor) {
    			insert(target, div1, anchor);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div1, null);
    			}

    			append(div1, t0);
    			append(div1, div0);

    			if (!mounted) {
    				dispose = listen(div0, "click", /*click_handler_2*/ ctx[7]);
    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*states, activate, Math, updateName*/ 7) {
    				each_value = /*states*/ ctx[0];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(div1, t0);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div1);
    			destroy_each(each_blocks, detaching);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let connection = null;
    	let states = [];

    	onMount(() => {
    		connection = lib$1();

    		connection.on("update", payload => {
    			$$invalidate(0, states = payload.states);
    		});
    	});

    	function activate(state) {
    		connection.emit("activate", { id: state.id });
    	}

    	function updateName(evt, state) {
    		connection.emit("rename", { id: state.id, name: evt.srcElement.value });
    	}

    	function click_handler(event) {
    		bubble($$self, event);
    	}

    	const change_handler = (state, evt) => updateName(evt, state);
    	const click_handler_1 = state => activate(state);
    	const click_handler_2 = () => activate({});

    	return [
    		states,
    		activate,
    		updateName,
    		connection,
    		click_handler,
    		change_handler,
    		click_handler_1,
    		click_handler_2
    	];
    }

    class Timer extends SvelteComponent {
    	constructor(options) {
    		super();
    		if (!document.getElementById("svelte-1oma4mt-style")) add_css();
    		init(this, options, instance, create_fragment, safe_not_equal, {});
    	}
    }

    Number.prototype.pad = function(size) {
      var s = String(this);
      while (s.length < (size || 2)) { s = "0" + s; }
      return s;
    };

    const renderTarget = new Timer({
      target: document.body,
      props: {
        test: "sdfdsf"
      }
    });

}());
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGltZXItYnVuZGxlLmpzIiwic291cmNlcyI6WyIuLi9ub2RlX21vZHVsZXMvc3ZlbHRlL2ludGVybmFsL2luZGV4Lm1qcyIsIi4uL25vZGVfbW9kdWxlcy9wYXJzZXVyaS9pbmRleC5qcyIsIi4uL25vZGVfbW9kdWxlcy9yb2xsdXAtcGx1Z2luLW5vZGUtZ2xvYmFscy9zcmMvZ2xvYmFsLmpzIiwiLi4vbm9kZV9tb2R1bGVzL3Byb2Nlc3MtZXM2L2Jyb3dzZXIuanMiLCIuLi9ub2RlX21vZHVsZXMvbXMvaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMvZGVidWcvc3JjL2NvbW1vbi5qcyIsIi4uL25vZGVfbW9kdWxlcy9kZWJ1Zy9zcmMvYnJvd3Nlci5qcyIsIi4uL25vZGVfbW9kdWxlcy9zb2NrZXQuaW8tY2xpZW50L2xpYi91cmwuanMiLCIuLi9ub2RlX21vZHVsZXMvc29ja2V0LmlvLXBhcnNlci9ub2RlX21vZHVsZXMvbXMvaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMvc29ja2V0LmlvLXBhcnNlci9ub2RlX21vZHVsZXMvZGVidWcvc3JjL2RlYnVnLmpzIiwiLi4vbm9kZV9tb2R1bGVzL3NvY2tldC5pby1wYXJzZXIvbm9kZV9tb2R1bGVzL2RlYnVnL3NyYy9icm93c2VyLmpzIiwiLi4vbm9kZV9tb2R1bGVzL2NvbXBvbmVudC1lbWl0dGVyL2luZGV4LmpzIiwiLi4vbm9kZV9tb2R1bGVzL2lzYXJyYXkvaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMvYnVmZmVyLWVzNi9iYXNlNjQuanMiLCIuLi9ub2RlX21vZHVsZXMvYnVmZmVyLWVzNi9pZWVlNzU0LmpzIiwiLi4vbm9kZV9tb2R1bGVzL2J1ZmZlci1lczYvaXNBcnJheS5qcyIsIi4uL25vZGVfbW9kdWxlcy9idWZmZXItZXM2L2luZGV4LmpzIiwiLi4vbm9kZV9tb2R1bGVzL3NvY2tldC5pby1wYXJzZXIvaXMtYnVmZmVyLmpzIiwiLi4vbm9kZV9tb2R1bGVzL3NvY2tldC5pby1wYXJzZXIvYmluYXJ5LmpzIiwiLi4vbm9kZV9tb2R1bGVzL3NvY2tldC5pby1wYXJzZXIvaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMvaGFzLWNvcnMvaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMvZW5naW5lLmlvLWNsaWVudC9saWIvZ2xvYmFsVGhpcy5icm93c2VyLmpzIiwiLi4vbm9kZV9tb2R1bGVzL2VuZ2luZS5pby1jbGllbnQvbGliL3htbGh0dHByZXF1ZXN0LmpzIiwiLi4vbm9kZV9tb2R1bGVzL2VuZ2luZS5pby1wYXJzZXIvbGliL2tleXMuanMiLCIuLi9ub2RlX21vZHVsZXMvaGFzLWJpbmFyeTIvaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMvYXJyYXlidWZmZXIuc2xpY2UvaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMvYWZ0ZXIvaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMvZW5naW5lLmlvLXBhcnNlci9saWIvdXRmOC5qcyIsIi4uL25vZGVfbW9kdWxlcy9iYXNlNjQtYXJyYXlidWZmZXIvbGliL2Jhc2U2NC1hcnJheWJ1ZmZlci5qcyIsIi4uL25vZGVfbW9kdWxlcy9ibG9iL2luZGV4LmpzIiwiLi4vbm9kZV9tb2R1bGVzL2VuZ2luZS5pby1wYXJzZXIvbGliL2Jyb3dzZXIuanMiLCIuLi9ub2RlX21vZHVsZXMvZW5naW5lLmlvLWNsaWVudC9ub2RlX21vZHVsZXMvY29tcG9uZW50LWVtaXR0ZXIvaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMvZW5naW5lLmlvLWNsaWVudC9saWIvdHJhbnNwb3J0LmpzIiwiLi4vbm9kZV9tb2R1bGVzL3BhcnNlcXMvaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMvY29tcG9uZW50LWluaGVyaXQvaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMveWVhc3QvaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMvZW5naW5lLmlvLWNsaWVudC9saWIvdHJhbnNwb3J0cy9wb2xsaW5nLmpzIiwiLi4vbm9kZV9tb2R1bGVzL2VuZ2luZS5pby1jbGllbnQvbGliL3RyYW5zcG9ydHMvcG9sbGluZy14aHIuanMiLCIuLi9ub2RlX21vZHVsZXMvZW5naW5lLmlvLWNsaWVudC9saWIvdHJhbnNwb3J0cy9wb2xsaW5nLWpzb25wLmpzIiwiLi4vbm9kZV9tb2R1bGVzL3JvbGx1cC1wbHVnaW4tbm9kZS1yZXNvbHZlL3NyYy9lbXB0eS5qcyIsIi4uL25vZGVfbW9kdWxlcy9lbmdpbmUuaW8tY2xpZW50L2xpYi90cmFuc3BvcnRzL3dlYnNvY2tldC5qcyIsIi4uL25vZGVfbW9kdWxlcy9lbmdpbmUuaW8tY2xpZW50L2xpYi90cmFuc3BvcnRzL2luZGV4LmpzIiwiLi4vbm9kZV9tb2R1bGVzL2luZGV4b2YvaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMvZW5naW5lLmlvLWNsaWVudC9saWIvc29ja2V0LmpzIiwiLi4vbm9kZV9tb2R1bGVzL2VuZ2luZS5pby1jbGllbnQvbGliL2luZGV4LmpzIiwiLi4vbm9kZV9tb2R1bGVzL3RvLWFycmF5L2luZGV4LmpzIiwiLi4vbm9kZV9tb2R1bGVzL3NvY2tldC5pby1jbGllbnQvbGliL29uLmpzIiwiLi4vbm9kZV9tb2R1bGVzL2NvbXBvbmVudC1iaW5kL2luZGV4LmpzIiwiLi4vbm9kZV9tb2R1bGVzL3NvY2tldC5pby1jbGllbnQvbGliL3NvY2tldC5qcyIsIi4uL25vZGVfbW9kdWxlcy9iYWNrbzIvaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMvc29ja2V0LmlvLWNsaWVudC9saWIvbWFuYWdlci5qcyIsIi4uL25vZGVfbW9kdWxlcy9zb2NrZXQuaW8tY2xpZW50L2xpYi9pbmRleC5qcyIsIi4uL3RpbWVyLnN2ZWx0ZSIsIi4uL3RpbWVyLW1haW4uanMiXSwic291cmNlc0NvbnRlbnQiOlsiZnVuY3Rpb24gbm9vcCgpIHsgfVxuY29uc3QgaWRlbnRpdHkgPSB4ID0+IHg7XG5mdW5jdGlvbiBhc3NpZ24odGFyLCBzcmMpIHtcbiAgICAvLyBAdHMtaWdub3JlXG4gICAgZm9yIChjb25zdCBrIGluIHNyYylcbiAgICAgICAgdGFyW2tdID0gc3JjW2tdO1xuICAgIHJldHVybiB0YXI7XG59XG5mdW5jdGlvbiBpc19wcm9taXNlKHZhbHVlKSB7XG4gICAgcmV0dXJuIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIHZhbHVlLnRoZW4gPT09ICdmdW5jdGlvbic7XG59XG5mdW5jdGlvbiBhZGRfbG9jYXRpb24oZWxlbWVudCwgZmlsZSwgbGluZSwgY29sdW1uLCBjaGFyKSB7XG4gICAgZWxlbWVudC5fX3N2ZWx0ZV9tZXRhID0ge1xuICAgICAgICBsb2M6IHsgZmlsZSwgbGluZSwgY29sdW1uLCBjaGFyIH1cbiAgICB9O1xufVxuZnVuY3Rpb24gcnVuKGZuKSB7XG4gICAgcmV0dXJuIGZuKCk7XG59XG5mdW5jdGlvbiBibGFua19vYmplY3QoKSB7XG4gICAgcmV0dXJuIE9iamVjdC5jcmVhdGUobnVsbCk7XG59XG5mdW5jdGlvbiBydW5fYWxsKGZucykge1xuICAgIGZucy5mb3JFYWNoKHJ1bik7XG59XG5mdW5jdGlvbiBpc19mdW5jdGlvbih0aGluZykge1xuICAgIHJldHVybiB0eXBlb2YgdGhpbmcgPT09ICdmdW5jdGlvbic7XG59XG5mdW5jdGlvbiBzYWZlX25vdF9lcXVhbChhLCBiKSB7XG4gICAgcmV0dXJuIGEgIT0gYSA/IGIgPT0gYiA6IGEgIT09IGIgfHwgKChhICYmIHR5cGVvZiBhID09PSAnb2JqZWN0JykgfHwgdHlwZW9mIGEgPT09ICdmdW5jdGlvbicpO1xufVxuZnVuY3Rpb24gbm90X2VxdWFsKGEsIGIpIHtcbiAgICByZXR1cm4gYSAhPSBhID8gYiA9PSBiIDogYSAhPT0gYjtcbn1cbmZ1bmN0aW9uIHZhbGlkYXRlX3N0b3JlKHN0b3JlLCBuYW1lKSB7XG4gICAgaWYgKHN0b3JlICE9IG51bGwgJiYgdHlwZW9mIHN0b3JlLnN1YnNjcmliZSAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCcke25hbWV9JyBpcyBub3QgYSBzdG9yZSB3aXRoIGEgJ3N1YnNjcmliZScgbWV0aG9kYCk7XG4gICAgfVxufVxuZnVuY3Rpb24gc3Vic2NyaWJlKHN0b3JlLCAuLi5jYWxsYmFja3MpIHtcbiAgICBpZiAoc3RvcmUgPT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gbm9vcDtcbiAgICB9XG4gICAgY29uc3QgdW5zdWIgPSBzdG9yZS5zdWJzY3JpYmUoLi4uY2FsbGJhY2tzKTtcbiAgICByZXR1cm4gdW5zdWIudW5zdWJzY3JpYmUgPyAoKSA9PiB1bnN1Yi51bnN1YnNjcmliZSgpIDogdW5zdWI7XG59XG5mdW5jdGlvbiBnZXRfc3RvcmVfdmFsdWUoc3RvcmUpIHtcbiAgICBsZXQgdmFsdWU7XG4gICAgc3Vic2NyaWJlKHN0b3JlLCBfID0+IHZhbHVlID0gXykoKTtcbiAgICByZXR1cm4gdmFsdWU7XG59XG5mdW5jdGlvbiBjb21wb25lbnRfc3Vic2NyaWJlKGNvbXBvbmVudCwgc3RvcmUsIGNhbGxiYWNrKSB7XG4gICAgY29tcG9uZW50LiQkLm9uX2Rlc3Ryb3kucHVzaChzdWJzY3JpYmUoc3RvcmUsIGNhbGxiYWNrKSk7XG59XG5mdW5jdGlvbiBjcmVhdGVfc2xvdChkZWZpbml0aW9uLCBjdHgsICQkc2NvcGUsIGZuKSB7XG4gICAgaWYgKGRlZmluaXRpb24pIHtcbiAgICAgICAgY29uc3Qgc2xvdF9jdHggPSBnZXRfc2xvdF9jb250ZXh0KGRlZmluaXRpb24sIGN0eCwgJCRzY29wZSwgZm4pO1xuICAgICAgICByZXR1cm4gZGVmaW5pdGlvblswXShzbG90X2N0eCk7XG4gICAgfVxufVxuZnVuY3Rpb24gZ2V0X3Nsb3RfY29udGV4dChkZWZpbml0aW9uLCBjdHgsICQkc2NvcGUsIGZuKSB7XG4gICAgcmV0dXJuIGRlZmluaXRpb25bMV0gJiYgZm5cbiAgICAgICAgPyBhc3NpZ24oJCRzY29wZS5jdHguc2xpY2UoKSwgZGVmaW5pdGlvblsxXShmbihjdHgpKSlcbiAgICAgICAgOiAkJHNjb3BlLmN0eDtcbn1cbmZ1bmN0aW9uIGdldF9zbG90X2NoYW5nZXMoZGVmaW5pdGlvbiwgJCRzY29wZSwgZGlydHksIGZuKSB7XG4gICAgaWYgKGRlZmluaXRpb25bMl0gJiYgZm4pIHtcbiAgICAgICAgY29uc3QgbGV0cyA9IGRlZmluaXRpb25bMl0oZm4oZGlydHkpKTtcbiAgICAgICAgaWYgKCQkc2NvcGUuZGlydHkgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgcmV0dXJuIGxldHM7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHR5cGVvZiBsZXRzID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgY29uc3QgbWVyZ2VkID0gW107XG4gICAgICAgICAgICBjb25zdCBsZW4gPSBNYXRoLm1heCgkJHNjb3BlLmRpcnR5Lmxlbmd0aCwgbGV0cy5sZW5ndGgpO1xuICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsZW47IGkgKz0gMSkge1xuICAgICAgICAgICAgICAgIG1lcmdlZFtpXSA9ICQkc2NvcGUuZGlydHlbaV0gfCBsZXRzW2ldO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIG1lcmdlZDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJCRzY29wZS5kaXJ0eSB8IGxldHM7XG4gICAgfVxuICAgIHJldHVybiAkJHNjb3BlLmRpcnR5O1xufVxuZnVuY3Rpb24gdXBkYXRlX3Nsb3Qoc2xvdCwgc2xvdF9kZWZpbml0aW9uLCBjdHgsICQkc2NvcGUsIGRpcnR5LCBnZXRfc2xvdF9jaGFuZ2VzX2ZuLCBnZXRfc2xvdF9jb250ZXh0X2ZuKSB7XG4gICAgY29uc3Qgc2xvdF9jaGFuZ2VzID0gZ2V0X3Nsb3RfY2hhbmdlcyhzbG90X2RlZmluaXRpb24sICQkc2NvcGUsIGRpcnR5LCBnZXRfc2xvdF9jaGFuZ2VzX2ZuKTtcbiAgICBpZiAoc2xvdF9jaGFuZ2VzKSB7XG4gICAgICAgIGNvbnN0IHNsb3RfY29udGV4dCA9IGdldF9zbG90X2NvbnRleHQoc2xvdF9kZWZpbml0aW9uLCBjdHgsICQkc2NvcGUsIGdldF9zbG90X2NvbnRleHRfZm4pO1xuICAgICAgICBzbG90LnAoc2xvdF9jb250ZXh0LCBzbG90X2NoYW5nZXMpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIGV4Y2x1ZGVfaW50ZXJuYWxfcHJvcHMocHJvcHMpIHtcbiAgICBjb25zdCByZXN1bHQgPSB7fTtcbiAgICBmb3IgKGNvbnN0IGsgaW4gcHJvcHMpXG4gICAgICAgIGlmIChrWzBdICE9PSAnJCcpXG4gICAgICAgICAgICByZXN1bHRba10gPSBwcm9wc1trXTtcbiAgICByZXR1cm4gcmVzdWx0O1xufVxuZnVuY3Rpb24gY29tcHV0ZV9yZXN0X3Byb3BzKHByb3BzLCBrZXlzKSB7XG4gICAgY29uc3QgcmVzdCA9IHt9O1xuICAgIGtleXMgPSBuZXcgU2V0KGtleXMpO1xuICAgIGZvciAoY29uc3QgayBpbiBwcm9wcylcbiAgICAgICAgaWYgKCFrZXlzLmhhcyhrKSAmJiBrWzBdICE9PSAnJCcpXG4gICAgICAgICAgICByZXN0W2tdID0gcHJvcHNba107XG4gICAgcmV0dXJuIHJlc3Q7XG59XG5mdW5jdGlvbiBvbmNlKGZuKSB7XG4gICAgbGV0IHJhbiA9IGZhbHNlO1xuICAgIHJldHVybiBmdW5jdGlvbiAoLi4uYXJncykge1xuICAgICAgICBpZiAocmFuKVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICByYW4gPSB0cnVlO1xuICAgICAgICBmbi5jYWxsKHRoaXMsIC4uLmFyZ3MpO1xuICAgIH07XG59XG5mdW5jdGlvbiBudWxsX3RvX2VtcHR5KHZhbHVlKSB7XG4gICAgcmV0dXJuIHZhbHVlID09IG51bGwgPyAnJyA6IHZhbHVlO1xufVxuZnVuY3Rpb24gc2V0X3N0b3JlX3ZhbHVlKHN0b3JlLCByZXQsIHZhbHVlID0gcmV0KSB7XG4gICAgc3RvcmUuc2V0KHZhbHVlKTtcbiAgICByZXR1cm4gcmV0O1xufVxuY29uc3QgaGFzX3Byb3AgPSAob2JqLCBwcm9wKSA9PiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqLCBwcm9wKTtcbmZ1bmN0aW9uIGFjdGlvbl9kZXN0cm95ZXIoYWN0aW9uX3Jlc3VsdCkge1xuICAgIHJldHVybiBhY3Rpb25fcmVzdWx0ICYmIGlzX2Z1bmN0aW9uKGFjdGlvbl9yZXN1bHQuZGVzdHJveSkgPyBhY3Rpb25fcmVzdWx0LmRlc3Ryb3kgOiBub29wO1xufVxuXG5jb25zdCBpc19jbGllbnQgPSB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJztcbmxldCBub3cgPSBpc19jbGllbnRcbiAgICA/ICgpID0+IHdpbmRvdy5wZXJmb3JtYW5jZS5ub3coKVxuICAgIDogKCkgPT4gRGF0ZS5ub3coKTtcbmxldCByYWYgPSBpc19jbGllbnQgPyBjYiA9PiByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoY2IpIDogbm9vcDtcbi8vIHVzZWQgaW50ZXJuYWxseSBmb3IgdGVzdGluZ1xuZnVuY3Rpb24gc2V0X25vdyhmbikge1xuICAgIG5vdyA9IGZuO1xufVxuZnVuY3Rpb24gc2V0X3JhZihmbikge1xuICAgIHJhZiA9IGZuO1xufVxuXG5jb25zdCB0YXNrcyA9IG5ldyBTZXQoKTtcbmZ1bmN0aW9uIHJ1bl90YXNrcyhub3cpIHtcbiAgICB0YXNrcy5mb3JFYWNoKHRhc2sgPT4ge1xuICAgICAgICBpZiAoIXRhc2suYyhub3cpKSB7XG4gICAgICAgICAgICB0YXNrcy5kZWxldGUodGFzayk7XG4gICAgICAgICAgICB0YXNrLmYoKTtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIGlmICh0YXNrcy5zaXplICE9PSAwKVxuICAgICAgICByYWYocnVuX3Rhc2tzKTtcbn1cbi8qKlxuICogRm9yIHRlc3RpbmcgcHVycG9zZXMgb25seSFcbiAqL1xuZnVuY3Rpb24gY2xlYXJfbG9vcHMoKSB7XG4gICAgdGFza3MuY2xlYXIoKTtcbn1cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyB0YXNrIHRoYXQgcnVucyBvbiBlYWNoIHJhZiBmcmFtZVxuICogdW50aWwgaXQgcmV0dXJucyBhIGZhbHN5IHZhbHVlIG9yIGlzIGFib3J0ZWRcbiAqL1xuZnVuY3Rpb24gbG9vcChjYWxsYmFjaykge1xuICAgIGxldCB0YXNrO1xuICAgIGlmICh0YXNrcy5zaXplID09PSAwKVxuICAgICAgICByYWYocnVuX3Rhc2tzKTtcbiAgICByZXR1cm4ge1xuICAgICAgICBwcm9taXNlOiBuZXcgUHJvbWlzZShmdWxmaWxsID0+IHtcbiAgICAgICAgICAgIHRhc2tzLmFkZCh0YXNrID0geyBjOiBjYWxsYmFjaywgZjogZnVsZmlsbCB9KTtcbiAgICAgICAgfSksXG4gICAgICAgIGFib3J0KCkge1xuICAgICAgICAgICAgdGFza3MuZGVsZXRlKHRhc2spO1xuICAgICAgICB9XG4gICAgfTtcbn1cblxuZnVuY3Rpb24gYXBwZW5kKHRhcmdldCwgbm9kZSkge1xuICAgIHRhcmdldC5hcHBlbmRDaGlsZChub2RlKTtcbn1cbmZ1bmN0aW9uIGluc2VydCh0YXJnZXQsIG5vZGUsIGFuY2hvcikge1xuICAgIHRhcmdldC5pbnNlcnRCZWZvcmUobm9kZSwgYW5jaG9yIHx8IG51bGwpO1xufVxuZnVuY3Rpb24gZGV0YWNoKG5vZGUpIHtcbiAgICBub2RlLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQobm9kZSk7XG59XG5mdW5jdGlvbiBkZXN0cm95X2VhY2goaXRlcmF0aW9ucywgZGV0YWNoaW5nKSB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBpdGVyYXRpb25zLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgIGlmIChpdGVyYXRpb25zW2ldKVxuICAgICAgICAgICAgaXRlcmF0aW9uc1tpXS5kKGRldGFjaGluZyk7XG4gICAgfVxufVxuZnVuY3Rpb24gZWxlbWVudChuYW1lKSB7XG4gICAgcmV0dXJuIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQobmFtZSk7XG59XG5mdW5jdGlvbiBlbGVtZW50X2lzKG5hbWUsIGlzKSB7XG4gICAgcmV0dXJuIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQobmFtZSwgeyBpcyB9KTtcbn1cbmZ1bmN0aW9uIG9iamVjdF93aXRob3V0X3Byb3BlcnRpZXMob2JqLCBleGNsdWRlKSB7XG4gICAgY29uc3QgdGFyZ2V0ID0ge307XG4gICAgZm9yIChjb25zdCBrIGluIG9iaikge1xuICAgICAgICBpZiAoaGFzX3Byb3Aob2JqLCBrKVxuICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgJiYgZXhjbHVkZS5pbmRleE9mKGspID09PSAtMSkge1xuICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgdGFyZ2V0W2tdID0gb2JqW2tdO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0YXJnZXQ7XG59XG5mdW5jdGlvbiBzdmdfZWxlbWVudChuYW1lKSB7XG4gICAgcmV0dXJuIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUygnaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnLCBuYW1lKTtcbn1cbmZ1bmN0aW9uIHRleHQoZGF0YSkge1xuICAgIHJldHVybiBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZShkYXRhKTtcbn1cbmZ1bmN0aW9uIHNwYWNlKCkge1xuICAgIHJldHVybiB0ZXh0KCcgJyk7XG59XG5mdW5jdGlvbiBlbXB0eSgpIHtcbiAgICByZXR1cm4gdGV4dCgnJyk7XG59XG5mdW5jdGlvbiBsaXN0ZW4obm9kZSwgZXZlbnQsIGhhbmRsZXIsIG9wdGlvbnMpIHtcbiAgICBub2RlLmFkZEV2ZW50TGlzdGVuZXIoZXZlbnQsIGhhbmRsZXIsIG9wdGlvbnMpO1xuICAgIHJldHVybiAoKSA9PiBub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoZXZlbnQsIGhhbmRsZXIsIG9wdGlvbnMpO1xufVxuZnVuY3Rpb24gcHJldmVudF9kZWZhdWx0KGZuKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgIHJldHVybiBmbi5jYWxsKHRoaXMsIGV2ZW50KTtcbiAgICB9O1xufVxuZnVuY3Rpb24gc3RvcF9wcm9wYWdhdGlvbihmbikge1xuICAgIHJldHVybiBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgcmV0dXJuIGZuLmNhbGwodGhpcywgZXZlbnQpO1xuICAgIH07XG59XG5mdW5jdGlvbiBzZWxmKGZuKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgIGlmIChldmVudC50YXJnZXQgPT09IHRoaXMpXG4gICAgICAgICAgICBmbi5jYWxsKHRoaXMsIGV2ZW50KTtcbiAgICB9O1xufVxuZnVuY3Rpb24gYXR0cihub2RlLCBhdHRyaWJ1dGUsIHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpXG4gICAgICAgIG5vZGUucmVtb3ZlQXR0cmlidXRlKGF0dHJpYnV0ZSk7XG4gICAgZWxzZSBpZiAobm9kZS5nZXRBdHRyaWJ1dGUoYXR0cmlidXRlKSAhPT0gdmFsdWUpXG4gICAgICAgIG5vZGUuc2V0QXR0cmlidXRlKGF0dHJpYnV0ZSwgdmFsdWUpO1xufVxuZnVuY3Rpb24gc2V0X2F0dHJpYnV0ZXMobm9kZSwgYXR0cmlidXRlcykge1xuICAgIC8vIEB0cy1pZ25vcmVcbiAgICBjb25zdCBkZXNjcmlwdG9ycyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3JzKG5vZGUuX19wcm90b19fKTtcbiAgICBmb3IgKGNvbnN0IGtleSBpbiBhdHRyaWJ1dGVzKSB7XG4gICAgICAgIGlmIChhdHRyaWJ1dGVzW2tleV0gPT0gbnVsbCkge1xuICAgICAgICAgICAgbm9kZS5yZW1vdmVBdHRyaWJ1dGUoa2V5KTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChrZXkgPT09ICdzdHlsZScpIHtcbiAgICAgICAgICAgIG5vZGUuc3R5bGUuY3NzVGV4dCA9IGF0dHJpYnV0ZXNba2V5XTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChrZXkgPT09ICdfX3ZhbHVlJykge1xuICAgICAgICAgICAgbm9kZS52YWx1ZSA9IG5vZGVba2V5XSA9IGF0dHJpYnV0ZXNba2V5XTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChkZXNjcmlwdG9yc1trZXldICYmIGRlc2NyaXB0b3JzW2tleV0uc2V0KSB7XG4gICAgICAgICAgICBub2RlW2tleV0gPSBhdHRyaWJ1dGVzW2tleV07XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBhdHRyKG5vZGUsIGtleSwgYXR0cmlidXRlc1trZXldKTtcbiAgICAgICAgfVxuICAgIH1cbn1cbmZ1bmN0aW9uIHNldF9zdmdfYXR0cmlidXRlcyhub2RlLCBhdHRyaWJ1dGVzKSB7XG4gICAgZm9yIChjb25zdCBrZXkgaW4gYXR0cmlidXRlcykge1xuICAgICAgICBhdHRyKG5vZGUsIGtleSwgYXR0cmlidXRlc1trZXldKTtcbiAgICB9XG59XG5mdW5jdGlvbiBzZXRfY3VzdG9tX2VsZW1lbnRfZGF0YShub2RlLCBwcm9wLCB2YWx1ZSkge1xuICAgIGlmIChwcm9wIGluIG5vZGUpIHtcbiAgICAgICAgbm9kZVtwcm9wXSA9IHZhbHVlO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgYXR0cihub2RlLCBwcm9wLCB2YWx1ZSk7XG4gICAgfVxufVxuZnVuY3Rpb24geGxpbmtfYXR0cihub2RlLCBhdHRyaWJ1dGUsIHZhbHVlKSB7XG4gICAgbm9kZS5zZXRBdHRyaWJ1dGVOUygnaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluaycsIGF0dHJpYnV0ZSwgdmFsdWUpO1xufVxuZnVuY3Rpb24gZ2V0X2JpbmRpbmdfZ3JvdXBfdmFsdWUoZ3JvdXApIHtcbiAgICBjb25zdCB2YWx1ZSA9IFtdO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZ3JvdXAubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgaWYgKGdyb3VwW2ldLmNoZWNrZWQpXG4gICAgICAgICAgICB2YWx1ZS5wdXNoKGdyb3VwW2ldLl9fdmFsdWUpO1xuICAgIH1cbiAgICByZXR1cm4gdmFsdWU7XG59XG5mdW5jdGlvbiB0b19udW1iZXIodmFsdWUpIHtcbiAgICByZXR1cm4gdmFsdWUgPT09ICcnID8gdW5kZWZpbmVkIDogK3ZhbHVlO1xufVxuZnVuY3Rpb24gdGltZV9yYW5nZXNfdG9fYXJyYXkocmFuZ2VzKSB7XG4gICAgY29uc3QgYXJyYXkgPSBbXTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJhbmdlcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBhcnJheS5wdXNoKHsgc3RhcnQ6IHJhbmdlcy5zdGFydChpKSwgZW5kOiByYW5nZXMuZW5kKGkpIH0pO1xuICAgIH1cbiAgICByZXR1cm4gYXJyYXk7XG59XG5mdW5jdGlvbiBjaGlsZHJlbihlbGVtZW50KSB7XG4gICAgcmV0dXJuIEFycmF5LmZyb20oZWxlbWVudC5jaGlsZE5vZGVzKTtcbn1cbmZ1bmN0aW9uIGNsYWltX2VsZW1lbnQobm9kZXMsIG5hbWUsIGF0dHJpYnV0ZXMsIHN2Zykge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbm9kZXMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgY29uc3Qgbm9kZSA9IG5vZGVzW2ldO1xuICAgICAgICBpZiAobm9kZS5ub2RlTmFtZSA9PT0gbmFtZSkge1xuICAgICAgICAgICAgbGV0IGogPSAwO1xuICAgICAgICAgICAgd2hpbGUgKGogPCBub2RlLmF0dHJpYnV0ZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYXR0cmlidXRlID0gbm9kZS5hdHRyaWJ1dGVzW2pdO1xuICAgICAgICAgICAgICAgIGlmIChhdHRyaWJ1dGVzW2F0dHJpYnV0ZS5uYW1lXSkge1xuICAgICAgICAgICAgICAgICAgICBqKys7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBub2RlLnJlbW92ZUF0dHJpYnV0ZShhdHRyaWJ1dGUubmFtZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIG5vZGVzLnNwbGljZShpLCAxKVswXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gc3ZnID8gc3ZnX2VsZW1lbnQobmFtZSkgOiBlbGVtZW50KG5hbWUpO1xufVxuZnVuY3Rpb24gY2xhaW1fdGV4dChub2RlcywgZGF0YSkge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbm9kZXMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgY29uc3Qgbm9kZSA9IG5vZGVzW2ldO1xuICAgICAgICBpZiAobm9kZS5ub2RlVHlwZSA9PT0gMykge1xuICAgICAgICAgICAgbm9kZS5kYXRhID0gJycgKyBkYXRhO1xuICAgICAgICAgICAgcmV0dXJuIG5vZGVzLnNwbGljZShpLCAxKVswXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdGV4dChkYXRhKTtcbn1cbmZ1bmN0aW9uIGNsYWltX3NwYWNlKG5vZGVzKSB7XG4gICAgcmV0dXJuIGNsYWltX3RleHQobm9kZXMsICcgJyk7XG59XG5mdW5jdGlvbiBzZXRfZGF0YSh0ZXh0LCBkYXRhKSB7XG4gICAgZGF0YSA9ICcnICsgZGF0YTtcbiAgICBpZiAodGV4dC5kYXRhICE9PSBkYXRhKVxuICAgICAgICB0ZXh0LmRhdGEgPSBkYXRhO1xufVxuZnVuY3Rpb24gc2V0X2lucHV0X3ZhbHVlKGlucHV0LCB2YWx1ZSkge1xuICAgIGlucHV0LnZhbHVlID0gdmFsdWUgPT0gbnVsbCA/ICcnIDogdmFsdWU7XG59XG5mdW5jdGlvbiBzZXRfaW5wdXRfdHlwZShpbnB1dCwgdHlwZSkge1xuICAgIHRyeSB7XG4gICAgICAgIGlucHV0LnR5cGUgPSB0eXBlO1xuICAgIH1cbiAgICBjYXRjaCAoZSkge1xuICAgICAgICAvLyBkbyBub3RoaW5nXG4gICAgfVxufVxuZnVuY3Rpb24gc2V0X3N0eWxlKG5vZGUsIGtleSwgdmFsdWUsIGltcG9ydGFudCkge1xuICAgIG5vZGUuc3R5bGUuc2V0UHJvcGVydHkoa2V5LCB2YWx1ZSwgaW1wb3J0YW50ID8gJ2ltcG9ydGFudCcgOiAnJyk7XG59XG5mdW5jdGlvbiBzZWxlY3Rfb3B0aW9uKHNlbGVjdCwgdmFsdWUpIHtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHNlbGVjdC5vcHRpb25zLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgIGNvbnN0IG9wdGlvbiA9IHNlbGVjdC5vcHRpb25zW2ldO1xuICAgICAgICBpZiAob3B0aW9uLl9fdmFsdWUgPT09IHZhbHVlKSB7XG4gICAgICAgICAgICBvcHRpb24uc2VsZWN0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgfVxufVxuZnVuY3Rpb24gc2VsZWN0X29wdGlvbnMoc2VsZWN0LCB2YWx1ZSkge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgc2VsZWN0Lm9wdGlvbnMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9uID0gc2VsZWN0Lm9wdGlvbnNbaV07XG4gICAgICAgIG9wdGlvbi5zZWxlY3RlZCA9IH52YWx1ZS5pbmRleE9mKG9wdGlvbi5fX3ZhbHVlKTtcbiAgICB9XG59XG5mdW5jdGlvbiBzZWxlY3RfdmFsdWUoc2VsZWN0KSB7XG4gICAgY29uc3Qgc2VsZWN0ZWRfb3B0aW9uID0gc2VsZWN0LnF1ZXJ5U2VsZWN0b3IoJzpjaGVja2VkJykgfHwgc2VsZWN0Lm9wdGlvbnNbMF07XG4gICAgcmV0dXJuIHNlbGVjdGVkX29wdGlvbiAmJiBzZWxlY3RlZF9vcHRpb24uX192YWx1ZTtcbn1cbmZ1bmN0aW9uIHNlbGVjdF9tdWx0aXBsZV92YWx1ZShzZWxlY3QpIHtcbiAgICByZXR1cm4gW10ubWFwLmNhbGwoc2VsZWN0LnF1ZXJ5U2VsZWN0b3JBbGwoJzpjaGVja2VkJyksIG9wdGlvbiA9PiBvcHRpb24uX192YWx1ZSk7XG59XG4vLyB1bmZvcnR1bmF0ZWx5IHRoaXMgY2FuJ3QgYmUgYSBjb25zdGFudCBhcyB0aGF0IHdvdWxkbid0IGJlIHRyZWUtc2hha2VhYmxlXG4vLyBzbyB3ZSBjYWNoZSB0aGUgcmVzdWx0IGluc3RlYWRcbmxldCBjcm9zc29yaWdpbjtcbmZ1bmN0aW9uIGlzX2Nyb3Nzb3JpZ2luKCkge1xuICAgIGlmIChjcm9zc29yaWdpbiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGNyb3Nzb3JpZ2luID0gZmFsc2U7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgd2luZG93LnBhcmVudCkge1xuICAgICAgICAgICAgICAgIHZvaWQgd2luZG93LnBhcmVudC5kb2N1bWVudDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNyb3Nzb3JpZ2luID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gY3Jvc3NvcmlnaW47XG59XG5mdW5jdGlvbiBhZGRfcmVzaXplX2xpc3RlbmVyKG5vZGUsIGZuKSB7XG4gICAgY29uc3QgY29tcHV0ZWRfc3R5bGUgPSBnZXRDb21wdXRlZFN0eWxlKG5vZGUpO1xuICAgIGNvbnN0IHpfaW5kZXggPSAocGFyc2VJbnQoY29tcHV0ZWRfc3R5bGUuekluZGV4KSB8fCAwKSAtIDE7XG4gICAgaWYgKGNvbXB1dGVkX3N0eWxlLnBvc2l0aW9uID09PSAnc3RhdGljJykge1xuICAgICAgICBub2RlLnN0eWxlLnBvc2l0aW9uID0gJ3JlbGF0aXZlJztcbiAgICB9XG4gICAgY29uc3QgaWZyYW1lID0gZWxlbWVudCgnaWZyYW1lJyk7XG4gICAgaWZyYW1lLnNldEF0dHJpYnV0ZSgnc3R5bGUnLCBgZGlzcGxheTogYmxvY2s7IHBvc2l0aW9uOiBhYnNvbHV0ZTsgdG9wOiAwOyBsZWZ0OiAwOyB3aWR0aDogMTAwJTsgaGVpZ2h0OiAxMDAlOyBgICtcbiAgICAgICAgYG92ZXJmbG93OiBoaWRkZW47IGJvcmRlcjogMDsgb3BhY2l0eTogMDsgcG9pbnRlci1ldmVudHM6IG5vbmU7IHotaW5kZXg6ICR7el9pbmRleH07YCk7XG4gICAgaWZyYW1lLnNldEF0dHJpYnV0ZSgnYXJpYS1oaWRkZW4nLCAndHJ1ZScpO1xuICAgIGlmcmFtZS50YWJJbmRleCA9IC0xO1xuICAgIGNvbnN0IGNyb3Nzb3JpZ2luID0gaXNfY3Jvc3NvcmlnaW4oKTtcbiAgICBsZXQgdW5zdWJzY3JpYmU7XG4gICAgaWYgKGNyb3Nzb3JpZ2luKSB7XG4gICAgICAgIGlmcmFtZS5zcmMgPSBgZGF0YTp0ZXh0L2h0bWwsPHNjcmlwdD5vbnJlc2l6ZT1mdW5jdGlvbigpe3BhcmVudC5wb3N0TWVzc2FnZSgwLCcqJyl9PC9zY3JpcHQ+YDtcbiAgICAgICAgdW5zdWJzY3JpYmUgPSBsaXN0ZW4od2luZG93LCAnbWVzc2FnZScsIChldmVudCkgPT4ge1xuICAgICAgICAgICAgaWYgKGV2ZW50LnNvdXJjZSA9PT0gaWZyYW1lLmNvbnRlbnRXaW5kb3cpXG4gICAgICAgICAgICAgICAgZm4oKTtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICBpZnJhbWUuc3JjID0gJ2Fib3V0OmJsYW5rJztcbiAgICAgICAgaWZyYW1lLm9ubG9hZCA9ICgpID0+IHtcbiAgICAgICAgICAgIHVuc3Vic2NyaWJlID0gbGlzdGVuKGlmcmFtZS5jb250ZW50V2luZG93LCAncmVzaXplJywgZm4pO1xuICAgICAgICB9O1xuICAgIH1cbiAgICBhcHBlbmQobm9kZSwgaWZyYW1lKTtcbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgICBpZiAoY3Jvc3NvcmlnaW4pIHtcbiAgICAgICAgICAgIHVuc3Vic2NyaWJlKCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAodW5zdWJzY3JpYmUgJiYgaWZyYW1lLmNvbnRlbnRXaW5kb3cpIHtcbiAgICAgICAgICAgIHVuc3Vic2NyaWJlKCk7XG4gICAgICAgIH1cbiAgICAgICAgZGV0YWNoKGlmcmFtZSk7XG4gICAgfTtcbn1cbmZ1bmN0aW9uIHRvZ2dsZV9jbGFzcyhlbGVtZW50LCBuYW1lLCB0b2dnbGUpIHtcbiAgICBlbGVtZW50LmNsYXNzTGlzdFt0b2dnbGUgPyAnYWRkJyA6ICdyZW1vdmUnXShuYW1lKTtcbn1cbmZ1bmN0aW9uIGN1c3RvbV9ldmVudCh0eXBlLCBkZXRhaWwpIHtcbiAgICBjb25zdCBlID0gZG9jdW1lbnQuY3JlYXRlRXZlbnQoJ0N1c3RvbUV2ZW50Jyk7XG4gICAgZS5pbml0Q3VzdG9tRXZlbnQodHlwZSwgZmFsc2UsIGZhbHNlLCBkZXRhaWwpO1xuICAgIHJldHVybiBlO1xufVxuZnVuY3Rpb24gcXVlcnlfc2VsZWN0b3JfYWxsKHNlbGVjdG9yLCBwYXJlbnQgPSBkb2N1bWVudC5ib2R5KSB7XG4gICAgcmV0dXJuIEFycmF5LmZyb20ocGFyZW50LnF1ZXJ5U2VsZWN0b3JBbGwoc2VsZWN0b3IpKTtcbn1cbmNsYXNzIEh0bWxUYWcge1xuICAgIGNvbnN0cnVjdG9yKGFuY2hvciA9IG51bGwpIHtcbiAgICAgICAgdGhpcy5hID0gYW5jaG9yO1xuICAgICAgICB0aGlzLmUgPSB0aGlzLm4gPSBudWxsO1xuICAgIH1cbiAgICBtKGh0bWwsIHRhcmdldCwgYW5jaG9yID0gbnVsbCkge1xuICAgICAgICBpZiAoIXRoaXMuZSkge1xuICAgICAgICAgICAgdGhpcy5lID0gZWxlbWVudCh0YXJnZXQubm9kZU5hbWUpO1xuICAgICAgICAgICAgdGhpcy50ID0gdGFyZ2V0O1xuICAgICAgICAgICAgdGhpcy5oKGh0bWwpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuaShhbmNob3IpO1xuICAgIH1cbiAgICBoKGh0bWwpIHtcbiAgICAgICAgdGhpcy5lLmlubmVySFRNTCA9IGh0bWw7XG4gICAgICAgIHRoaXMubiA9IEFycmF5LmZyb20odGhpcy5lLmNoaWxkTm9kZXMpO1xuICAgIH1cbiAgICBpKGFuY2hvcikge1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMubi5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICAgICAgaW5zZXJ0KHRoaXMudCwgdGhpcy5uW2ldLCBhbmNob3IpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHAoaHRtbCkge1xuICAgICAgICB0aGlzLmQoKTtcbiAgICAgICAgdGhpcy5oKGh0bWwpO1xuICAgICAgICB0aGlzLmkodGhpcy5hKTtcbiAgICB9XG4gICAgZCgpIHtcbiAgICAgICAgdGhpcy5uLmZvckVhY2goZGV0YWNoKTtcbiAgICB9XG59XG5cbmNvbnN0IGFjdGl2ZV9kb2NzID0gbmV3IFNldCgpO1xubGV0IGFjdGl2ZSA9IDA7XG4vLyBodHRwczovL2dpdGh1Yi5jb20vZGFya3NreWFwcC9zdHJpbmctaGFzaC9ibG9iL21hc3Rlci9pbmRleC5qc1xuZnVuY3Rpb24gaGFzaChzdHIpIHtcbiAgICBsZXQgaGFzaCA9IDUzODE7XG4gICAgbGV0IGkgPSBzdHIubGVuZ3RoO1xuICAgIHdoaWxlIChpLS0pXG4gICAgICAgIGhhc2ggPSAoKGhhc2ggPDwgNSkgLSBoYXNoKSBeIHN0ci5jaGFyQ29kZUF0KGkpO1xuICAgIHJldHVybiBoYXNoID4+PiAwO1xufVxuZnVuY3Rpb24gY3JlYXRlX3J1bGUobm9kZSwgYSwgYiwgZHVyYXRpb24sIGRlbGF5LCBlYXNlLCBmbiwgdWlkID0gMCkge1xuICAgIGNvbnN0IHN0ZXAgPSAxNi42NjYgLyBkdXJhdGlvbjtcbiAgICBsZXQga2V5ZnJhbWVzID0gJ3tcXG4nO1xuICAgIGZvciAobGV0IHAgPSAwOyBwIDw9IDE7IHAgKz0gc3RlcCkge1xuICAgICAgICBjb25zdCB0ID0gYSArIChiIC0gYSkgKiBlYXNlKHApO1xuICAgICAgICBrZXlmcmFtZXMgKz0gcCAqIDEwMCArIGAleyR7Zm4odCwgMSAtIHQpfX1cXG5gO1xuICAgIH1cbiAgICBjb25zdCBydWxlID0ga2V5ZnJhbWVzICsgYDEwMCUgeyR7Zm4oYiwgMSAtIGIpfX1cXG59YDtcbiAgICBjb25zdCBuYW1lID0gYF9fc3ZlbHRlXyR7aGFzaChydWxlKX1fJHt1aWR9YDtcbiAgICBjb25zdCBkb2MgPSBub2RlLm93bmVyRG9jdW1lbnQ7XG4gICAgYWN0aXZlX2RvY3MuYWRkKGRvYyk7XG4gICAgY29uc3Qgc3R5bGVzaGVldCA9IGRvYy5fX3N2ZWx0ZV9zdHlsZXNoZWV0IHx8IChkb2MuX19zdmVsdGVfc3R5bGVzaGVldCA9IGRvYy5oZWFkLmFwcGVuZENoaWxkKGVsZW1lbnQoJ3N0eWxlJykpLnNoZWV0KTtcbiAgICBjb25zdCBjdXJyZW50X3J1bGVzID0gZG9jLl9fc3ZlbHRlX3J1bGVzIHx8IChkb2MuX19zdmVsdGVfcnVsZXMgPSB7fSk7XG4gICAgaWYgKCFjdXJyZW50X3J1bGVzW25hbWVdKSB7XG4gICAgICAgIGN1cnJlbnRfcnVsZXNbbmFtZV0gPSB0cnVlO1xuICAgICAgICBzdHlsZXNoZWV0Lmluc2VydFJ1bGUoYEBrZXlmcmFtZXMgJHtuYW1lfSAke3J1bGV9YCwgc3R5bGVzaGVldC5jc3NSdWxlcy5sZW5ndGgpO1xuICAgIH1cbiAgICBjb25zdCBhbmltYXRpb24gPSBub2RlLnN0eWxlLmFuaW1hdGlvbiB8fCAnJztcbiAgICBub2RlLnN0eWxlLmFuaW1hdGlvbiA9IGAke2FuaW1hdGlvbiA/IGAke2FuaW1hdGlvbn0sIGAgOiBgYH0ke25hbWV9ICR7ZHVyYXRpb259bXMgbGluZWFyICR7ZGVsYXl9bXMgMSBib3RoYDtcbiAgICBhY3RpdmUgKz0gMTtcbiAgICByZXR1cm4gbmFtZTtcbn1cbmZ1bmN0aW9uIGRlbGV0ZV9ydWxlKG5vZGUsIG5hbWUpIHtcbiAgICBjb25zdCBwcmV2aW91cyA9IChub2RlLnN0eWxlLmFuaW1hdGlvbiB8fCAnJykuc3BsaXQoJywgJyk7XG4gICAgY29uc3QgbmV4dCA9IHByZXZpb3VzLmZpbHRlcihuYW1lXG4gICAgICAgID8gYW5pbSA9PiBhbmltLmluZGV4T2YobmFtZSkgPCAwIC8vIHJlbW92ZSBzcGVjaWZpYyBhbmltYXRpb25cbiAgICAgICAgOiBhbmltID0+IGFuaW0uaW5kZXhPZignX19zdmVsdGUnKSA9PT0gLTEgLy8gcmVtb3ZlIGFsbCBTdmVsdGUgYW5pbWF0aW9uc1xuICAgICk7XG4gICAgY29uc3QgZGVsZXRlZCA9IHByZXZpb3VzLmxlbmd0aCAtIG5leHQubGVuZ3RoO1xuICAgIGlmIChkZWxldGVkKSB7XG4gICAgICAgIG5vZGUuc3R5bGUuYW5pbWF0aW9uID0gbmV4dC5qb2luKCcsICcpO1xuICAgICAgICBhY3RpdmUgLT0gZGVsZXRlZDtcbiAgICAgICAgaWYgKCFhY3RpdmUpXG4gICAgICAgICAgICBjbGVhcl9ydWxlcygpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIGNsZWFyX3J1bGVzKCkge1xuICAgIHJhZigoKSA9PiB7XG4gICAgICAgIGlmIChhY3RpdmUpXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIGFjdGl2ZV9kb2NzLmZvckVhY2goZG9jID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHN0eWxlc2hlZXQgPSBkb2MuX19zdmVsdGVfc3R5bGVzaGVldDtcbiAgICAgICAgICAgIGxldCBpID0gc3R5bGVzaGVldC5jc3NSdWxlcy5sZW5ndGg7XG4gICAgICAgICAgICB3aGlsZSAoaS0tKVxuICAgICAgICAgICAgICAgIHN0eWxlc2hlZXQuZGVsZXRlUnVsZShpKTtcbiAgICAgICAgICAgIGRvYy5fX3N2ZWx0ZV9ydWxlcyA9IHt9O1xuICAgICAgICB9KTtcbiAgICAgICAgYWN0aXZlX2RvY3MuY2xlYXIoKTtcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlX2FuaW1hdGlvbihub2RlLCBmcm9tLCBmbiwgcGFyYW1zKSB7XG4gICAgaWYgKCFmcm9tKVxuICAgICAgICByZXR1cm4gbm9vcDtcbiAgICBjb25zdCB0byA9IG5vZGUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgaWYgKGZyb20ubGVmdCA9PT0gdG8ubGVmdCAmJiBmcm9tLnJpZ2h0ID09PSB0by5yaWdodCAmJiBmcm9tLnRvcCA9PT0gdG8udG9wICYmIGZyb20uYm90dG9tID09PSB0by5ib3R0b20pXG4gICAgICAgIHJldHVybiBub29wO1xuICAgIGNvbnN0IHsgZGVsYXkgPSAwLCBkdXJhdGlvbiA9IDMwMCwgZWFzaW5nID0gaWRlbnRpdHksIFxuICAgIC8vIEB0cy1pZ25vcmUgdG9kbzogc2hvdWxkIHRoaXMgYmUgc2VwYXJhdGVkIGZyb20gZGVzdHJ1Y3R1cmluZz8gT3Igc3RhcnQvZW5kIGFkZGVkIHRvIHB1YmxpYyBhcGkgYW5kIGRvY3VtZW50YXRpb24/XG4gICAgc3RhcnQ6IHN0YXJ0X3RpbWUgPSBub3coKSArIGRlbGF5LCBcbiAgICAvLyBAdHMtaWdub3JlIHRvZG86XG4gICAgZW5kID0gc3RhcnRfdGltZSArIGR1cmF0aW9uLCB0aWNrID0gbm9vcCwgY3NzIH0gPSBmbihub2RlLCB7IGZyb20sIHRvIH0sIHBhcmFtcyk7XG4gICAgbGV0IHJ1bm5pbmcgPSB0cnVlO1xuICAgIGxldCBzdGFydGVkID0gZmFsc2U7XG4gICAgbGV0IG5hbWU7XG4gICAgZnVuY3Rpb24gc3RhcnQoKSB7XG4gICAgICAgIGlmIChjc3MpIHtcbiAgICAgICAgICAgIG5hbWUgPSBjcmVhdGVfcnVsZShub2RlLCAwLCAxLCBkdXJhdGlvbiwgZGVsYXksIGVhc2luZywgY3NzKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWRlbGF5KSB7XG4gICAgICAgICAgICBzdGFydGVkID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBmdW5jdGlvbiBzdG9wKCkge1xuICAgICAgICBpZiAoY3NzKVxuICAgICAgICAgICAgZGVsZXRlX3J1bGUobm9kZSwgbmFtZSk7XG4gICAgICAgIHJ1bm5pbmcgPSBmYWxzZTtcbiAgICB9XG4gICAgbG9vcChub3cgPT4ge1xuICAgICAgICBpZiAoIXN0YXJ0ZWQgJiYgbm93ID49IHN0YXJ0X3RpbWUpIHtcbiAgICAgICAgICAgIHN0YXJ0ZWQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChzdGFydGVkICYmIG5vdyA+PSBlbmQpIHtcbiAgICAgICAgICAgIHRpY2soMSwgMCk7XG4gICAgICAgICAgICBzdG9wKCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFydW5uaW5nKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHN0YXJ0ZWQpIHtcbiAgICAgICAgICAgIGNvbnN0IHAgPSBub3cgLSBzdGFydF90aW1lO1xuICAgICAgICAgICAgY29uc3QgdCA9IDAgKyAxICogZWFzaW5nKHAgLyBkdXJhdGlvbik7XG4gICAgICAgICAgICB0aWNrKHQsIDEgLSB0KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9KTtcbiAgICBzdGFydCgpO1xuICAgIHRpY2soMCwgMSk7XG4gICAgcmV0dXJuIHN0b3A7XG59XG5mdW5jdGlvbiBmaXhfcG9zaXRpb24obm9kZSkge1xuICAgIGNvbnN0IHN0eWxlID0gZ2V0Q29tcHV0ZWRTdHlsZShub2RlKTtcbiAgICBpZiAoc3R5bGUucG9zaXRpb24gIT09ICdhYnNvbHV0ZScgJiYgc3R5bGUucG9zaXRpb24gIT09ICdmaXhlZCcpIHtcbiAgICAgICAgY29uc3QgeyB3aWR0aCwgaGVpZ2h0IH0gPSBzdHlsZTtcbiAgICAgICAgY29uc3QgYSA9IG5vZGUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIG5vZGUuc3R5bGUucG9zaXRpb24gPSAnYWJzb2x1dGUnO1xuICAgICAgICBub2RlLnN0eWxlLndpZHRoID0gd2lkdGg7XG4gICAgICAgIG5vZGUuc3R5bGUuaGVpZ2h0ID0gaGVpZ2h0O1xuICAgICAgICBhZGRfdHJhbnNmb3JtKG5vZGUsIGEpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIGFkZF90cmFuc2Zvcm0obm9kZSwgYSkge1xuICAgIGNvbnN0IGIgPSBub2RlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgIGlmIChhLmxlZnQgIT09IGIubGVmdCB8fCBhLnRvcCAhPT0gYi50b3ApIHtcbiAgICAgICAgY29uc3Qgc3R5bGUgPSBnZXRDb21wdXRlZFN0eWxlKG5vZGUpO1xuICAgICAgICBjb25zdCB0cmFuc2Zvcm0gPSBzdHlsZS50cmFuc2Zvcm0gPT09ICdub25lJyA/ICcnIDogc3R5bGUudHJhbnNmb3JtO1xuICAgICAgICBub2RlLnN0eWxlLnRyYW5zZm9ybSA9IGAke3RyYW5zZm9ybX0gdHJhbnNsYXRlKCR7YS5sZWZ0IC0gYi5sZWZ0fXB4LCAke2EudG9wIC0gYi50b3B9cHgpYDtcbiAgICB9XG59XG5cbmxldCBjdXJyZW50X2NvbXBvbmVudDtcbmZ1bmN0aW9uIHNldF9jdXJyZW50X2NvbXBvbmVudChjb21wb25lbnQpIHtcbiAgICBjdXJyZW50X2NvbXBvbmVudCA9IGNvbXBvbmVudDtcbn1cbmZ1bmN0aW9uIGdldF9jdXJyZW50X2NvbXBvbmVudCgpIHtcbiAgICBpZiAoIWN1cnJlbnRfY29tcG9uZW50KVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZ1bmN0aW9uIGNhbGxlZCBvdXRzaWRlIGNvbXBvbmVudCBpbml0aWFsaXphdGlvbmApO1xuICAgIHJldHVybiBjdXJyZW50X2NvbXBvbmVudDtcbn1cbmZ1bmN0aW9uIGJlZm9yZVVwZGF0ZShmbikge1xuICAgIGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLmJlZm9yZV91cGRhdGUucHVzaChmbik7XG59XG5mdW5jdGlvbiBvbk1vdW50KGZuKSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQub25fbW91bnQucHVzaChmbik7XG59XG5mdW5jdGlvbiBhZnRlclVwZGF0ZShmbikge1xuICAgIGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLmFmdGVyX3VwZGF0ZS5wdXNoKGZuKTtcbn1cbmZ1bmN0aW9uIG9uRGVzdHJveShmbikge1xuICAgIGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLm9uX2Rlc3Ryb3kucHVzaChmbik7XG59XG5mdW5jdGlvbiBjcmVhdGVFdmVudERpc3BhdGNoZXIoKSB7XG4gICAgY29uc3QgY29tcG9uZW50ID0gZ2V0X2N1cnJlbnRfY29tcG9uZW50KCk7XG4gICAgcmV0dXJuICh0eXBlLCBkZXRhaWwpID0+IHtcbiAgICAgICAgY29uc3QgY2FsbGJhY2tzID0gY29tcG9uZW50LiQkLmNhbGxiYWNrc1t0eXBlXTtcbiAgICAgICAgaWYgKGNhbGxiYWNrcykge1xuICAgICAgICAgICAgLy8gVE9ETyBhcmUgdGhlcmUgc2l0dWF0aW9ucyB3aGVyZSBldmVudHMgY291bGQgYmUgZGlzcGF0Y2hlZFxuICAgICAgICAgICAgLy8gaW4gYSBzZXJ2ZXIgKG5vbi1ET00pIGVudmlyb25tZW50P1xuICAgICAgICAgICAgY29uc3QgZXZlbnQgPSBjdXN0b21fZXZlbnQodHlwZSwgZGV0YWlsKTtcbiAgICAgICAgICAgIGNhbGxiYWNrcy5zbGljZSgpLmZvckVhY2goZm4gPT4ge1xuICAgICAgICAgICAgICAgIGZuLmNhbGwoY29tcG9uZW50LCBldmVudCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH07XG59XG5mdW5jdGlvbiBzZXRDb250ZXh0KGtleSwgY29udGV4dCkge1xuICAgIGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLmNvbnRleHQuc2V0KGtleSwgY29udGV4dCk7XG59XG5mdW5jdGlvbiBnZXRDb250ZXh0KGtleSkge1xuICAgIHJldHVybiBnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5jb250ZXh0LmdldChrZXkpO1xufVxuLy8gVE9ETyBmaWd1cmUgb3V0IGlmIHdlIHN0aWxsIHdhbnQgdG8gc3VwcG9ydFxuLy8gc2hvcnRoYW5kIGV2ZW50cywgb3IgaWYgd2Ugd2FudCB0byBpbXBsZW1lbnRcbi8vIGEgcmVhbCBidWJibGluZyBtZWNoYW5pc21cbmZ1bmN0aW9uIGJ1YmJsZShjb21wb25lbnQsIGV2ZW50KSB7XG4gICAgY29uc3QgY2FsbGJhY2tzID0gY29tcG9uZW50LiQkLmNhbGxiYWNrc1tldmVudC50eXBlXTtcbiAgICBpZiAoY2FsbGJhY2tzKSB7XG4gICAgICAgIGNhbGxiYWNrcy5zbGljZSgpLmZvckVhY2goZm4gPT4gZm4oZXZlbnQpKTtcbiAgICB9XG59XG5cbmNvbnN0IGRpcnR5X2NvbXBvbmVudHMgPSBbXTtcbmNvbnN0IGludHJvcyA9IHsgZW5hYmxlZDogZmFsc2UgfTtcbmNvbnN0IGJpbmRpbmdfY2FsbGJhY2tzID0gW107XG5jb25zdCByZW5kZXJfY2FsbGJhY2tzID0gW107XG5jb25zdCBmbHVzaF9jYWxsYmFja3MgPSBbXTtcbmNvbnN0IHJlc29sdmVkX3Byb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcbmxldCB1cGRhdGVfc2NoZWR1bGVkID0gZmFsc2U7XG5mdW5jdGlvbiBzY2hlZHVsZV91cGRhdGUoKSB7XG4gICAgaWYgKCF1cGRhdGVfc2NoZWR1bGVkKSB7XG4gICAgICAgIHVwZGF0ZV9zY2hlZHVsZWQgPSB0cnVlO1xuICAgICAgICByZXNvbHZlZF9wcm9taXNlLnRoZW4oZmx1c2gpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIHRpY2soKSB7XG4gICAgc2NoZWR1bGVfdXBkYXRlKCk7XG4gICAgcmV0dXJuIHJlc29sdmVkX3Byb21pc2U7XG59XG5mdW5jdGlvbiBhZGRfcmVuZGVyX2NhbGxiYWNrKGZuKSB7XG4gICAgcmVuZGVyX2NhbGxiYWNrcy5wdXNoKGZuKTtcbn1cbmZ1bmN0aW9uIGFkZF9mbHVzaF9jYWxsYmFjayhmbikge1xuICAgIGZsdXNoX2NhbGxiYWNrcy5wdXNoKGZuKTtcbn1cbmxldCBmbHVzaGluZyA9IGZhbHNlO1xuY29uc3Qgc2Vlbl9jYWxsYmFja3MgPSBuZXcgU2V0KCk7XG5mdW5jdGlvbiBmbHVzaCgpIHtcbiAgICBpZiAoZmx1c2hpbmcpXG4gICAgICAgIHJldHVybjtcbiAgICBmbHVzaGluZyA9IHRydWU7XG4gICAgZG8ge1xuICAgICAgICAvLyBmaXJzdCwgY2FsbCBiZWZvcmVVcGRhdGUgZnVuY3Rpb25zXG4gICAgICAgIC8vIGFuZCB1cGRhdGUgY29tcG9uZW50c1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRpcnR5X2NvbXBvbmVudHMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgICAgIGNvbnN0IGNvbXBvbmVudCA9IGRpcnR5X2NvbXBvbmVudHNbaV07XG4gICAgICAgICAgICBzZXRfY3VycmVudF9jb21wb25lbnQoY29tcG9uZW50KTtcbiAgICAgICAgICAgIHVwZGF0ZShjb21wb25lbnQuJCQpO1xuICAgICAgICB9XG4gICAgICAgIGRpcnR5X2NvbXBvbmVudHMubGVuZ3RoID0gMDtcbiAgICAgICAgd2hpbGUgKGJpbmRpbmdfY2FsbGJhY2tzLmxlbmd0aClcbiAgICAgICAgICAgIGJpbmRpbmdfY2FsbGJhY2tzLnBvcCgpKCk7XG4gICAgICAgIC8vIHRoZW4sIG9uY2UgY29tcG9uZW50cyBhcmUgdXBkYXRlZCwgY2FsbFxuICAgICAgICAvLyBhZnRlclVwZGF0ZSBmdW5jdGlvbnMuIFRoaXMgbWF5IGNhdXNlXG4gICAgICAgIC8vIHN1YnNlcXVlbnQgdXBkYXRlcy4uLlxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJlbmRlcl9jYWxsYmFja3MubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgICAgIGNvbnN0IGNhbGxiYWNrID0gcmVuZGVyX2NhbGxiYWNrc1tpXTtcbiAgICAgICAgICAgIGlmICghc2Vlbl9jYWxsYmFja3MuaGFzKGNhbGxiYWNrKSkge1xuICAgICAgICAgICAgICAgIC8vIC4uLnNvIGd1YXJkIGFnYWluc3QgaW5maW5pdGUgbG9vcHNcbiAgICAgICAgICAgICAgICBzZWVuX2NhbGxiYWNrcy5hZGQoY2FsbGJhY2spO1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmVuZGVyX2NhbGxiYWNrcy5sZW5ndGggPSAwO1xuICAgIH0gd2hpbGUgKGRpcnR5X2NvbXBvbmVudHMubGVuZ3RoKTtcbiAgICB3aGlsZSAoZmx1c2hfY2FsbGJhY2tzLmxlbmd0aCkge1xuICAgICAgICBmbHVzaF9jYWxsYmFja3MucG9wKCkoKTtcbiAgICB9XG4gICAgdXBkYXRlX3NjaGVkdWxlZCA9IGZhbHNlO1xuICAgIGZsdXNoaW5nID0gZmFsc2U7XG4gICAgc2Vlbl9jYWxsYmFja3MuY2xlYXIoKTtcbn1cbmZ1bmN0aW9uIHVwZGF0ZSgkJCkge1xuICAgIGlmICgkJC5mcmFnbWVudCAhPT0gbnVsbCkge1xuICAgICAgICAkJC51cGRhdGUoKTtcbiAgICAgICAgcnVuX2FsbCgkJC5iZWZvcmVfdXBkYXRlKTtcbiAgICAgICAgY29uc3QgZGlydHkgPSAkJC5kaXJ0eTtcbiAgICAgICAgJCQuZGlydHkgPSBbLTFdO1xuICAgICAgICAkJC5mcmFnbWVudCAmJiAkJC5mcmFnbWVudC5wKCQkLmN0eCwgZGlydHkpO1xuICAgICAgICAkJC5hZnRlcl91cGRhdGUuZm9yRWFjaChhZGRfcmVuZGVyX2NhbGxiYWNrKTtcbiAgICB9XG59XG5cbmxldCBwcm9taXNlO1xuZnVuY3Rpb24gd2FpdCgpIHtcbiAgICBpZiAoIXByb21pc2UpIHtcbiAgICAgICAgcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICBwcm9taXNlLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgcHJvbWlzZSA9IG51bGw7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gcHJvbWlzZTtcbn1cbmZ1bmN0aW9uIGRpc3BhdGNoKG5vZGUsIGRpcmVjdGlvbiwga2luZCkge1xuICAgIG5vZGUuZGlzcGF0Y2hFdmVudChjdXN0b21fZXZlbnQoYCR7ZGlyZWN0aW9uID8gJ2ludHJvJyA6ICdvdXRybyd9JHtraW5kfWApKTtcbn1cbmNvbnN0IG91dHJvaW5nID0gbmV3IFNldCgpO1xubGV0IG91dHJvcztcbmZ1bmN0aW9uIGdyb3VwX291dHJvcygpIHtcbiAgICBvdXRyb3MgPSB7XG4gICAgICAgIHI6IDAsXG4gICAgICAgIGM6IFtdLFxuICAgICAgICBwOiBvdXRyb3MgLy8gcGFyZW50IGdyb3VwXG4gICAgfTtcbn1cbmZ1bmN0aW9uIGNoZWNrX291dHJvcygpIHtcbiAgICBpZiAoIW91dHJvcy5yKSB7XG4gICAgICAgIHJ1bl9hbGwob3V0cm9zLmMpO1xuICAgIH1cbiAgICBvdXRyb3MgPSBvdXRyb3MucDtcbn1cbmZ1bmN0aW9uIHRyYW5zaXRpb25faW4oYmxvY2ssIGxvY2FsKSB7XG4gICAgaWYgKGJsb2NrICYmIGJsb2NrLmkpIHtcbiAgICAgICAgb3V0cm9pbmcuZGVsZXRlKGJsb2NrKTtcbiAgICAgICAgYmxvY2suaShsb2NhbCk7XG4gICAgfVxufVxuZnVuY3Rpb24gdHJhbnNpdGlvbl9vdXQoYmxvY2ssIGxvY2FsLCBkZXRhY2gsIGNhbGxiYWNrKSB7XG4gICAgaWYgKGJsb2NrICYmIGJsb2NrLm8pIHtcbiAgICAgICAgaWYgKG91dHJvaW5nLmhhcyhibG9jaykpXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIG91dHJvaW5nLmFkZChibG9jayk7XG4gICAgICAgIG91dHJvcy5jLnB1c2goKCkgPT4ge1xuICAgICAgICAgICAgb3V0cm9pbmcuZGVsZXRlKGJsb2NrKTtcbiAgICAgICAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICAgICAgICAgIGlmIChkZXRhY2gpXG4gICAgICAgICAgICAgICAgICAgIGJsb2NrLmQoMSk7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGJsb2NrLm8obG9jYWwpO1xuICAgIH1cbn1cbmNvbnN0IG51bGxfdHJhbnNpdGlvbiA9IHsgZHVyYXRpb246IDAgfTtcbmZ1bmN0aW9uIGNyZWF0ZV9pbl90cmFuc2l0aW9uKG5vZGUsIGZuLCBwYXJhbXMpIHtcbiAgICBsZXQgY29uZmlnID0gZm4obm9kZSwgcGFyYW1zKTtcbiAgICBsZXQgcnVubmluZyA9IGZhbHNlO1xuICAgIGxldCBhbmltYXRpb25fbmFtZTtcbiAgICBsZXQgdGFzaztcbiAgICBsZXQgdWlkID0gMDtcbiAgICBmdW5jdGlvbiBjbGVhbnVwKCkge1xuICAgICAgICBpZiAoYW5pbWF0aW9uX25hbWUpXG4gICAgICAgICAgICBkZWxldGVfcnVsZShub2RlLCBhbmltYXRpb25fbmFtZSk7XG4gICAgfVxuICAgIGZ1bmN0aW9uIGdvKCkge1xuICAgICAgICBjb25zdCB7IGRlbGF5ID0gMCwgZHVyYXRpb24gPSAzMDAsIGVhc2luZyA9IGlkZW50aXR5LCB0aWNrID0gbm9vcCwgY3NzIH0gPSBjb25maWcgfHwgbnVsbF90cmFuc2l0aW9uO1xuICAgICAgICBpZiAoY3NzKVxuICAgICAgICAgICAgYW5pbWF0aW9uX25hbWUgPSBjcmVhdGVfcnVsZShub2RlLCAwLCAxLCBkdXJhdGlvbiwgZGVsYXksIGVhc2luZywgY3NzLCB1aWQrKyk7XG4gICAgICAgIHRpY2soMCwgMSk7XG4gICAgICAgIGNvbnN0IHN0YXJ0X3RpbWUgPSBub3coKSArIGRlbGF5O1xuICAgICAgICBjb25zdCBlbmRfdGltZSA9IHN0YXJ0X3RpbWUgKyBkdXJhdGlvbjtcbiAgICAgICAgaWYgKHRhc2spXG4gICAgICAgICAgICB0YXNrLmFib3J0KCk7XG4gICAgICAgIHJ1bm5pbmcgPSB0cnVlO1xuICAgICAgICBhZGRfcmVuZGVyX2NhbGxiYWNrKCgpID0+IGRpc3BhdGNoKG5vZGUsIHRydWUsICdzdGFydCcpKTtcbiAgICAgICAgdGFzayA9IGxvb3Aobm93ID0+IHtcbiAgICAgICAgICAgIGlmIChydW5uaW5nKSB7XG4gICAgICAgICAgICAgICAgaWYgKG5vdyA+PSBlbmRfdGltZSkge1xuICAgICAgICAgICAgICAgICAgICB0aWNrKDEsIDApO1xuICAgICAgICAgICAgICAgICAgICBkaXNwYXRjaChub2RlLCB0cnVlLCAnZW5kJyk7XG4gICAgICAgICAgICAgICAgICAgIGNsZWFudXAoKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJ1bm5pbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKG5vdyA+PSBzdGFydF90aW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHQgPSBlYXNpbmcoKG5vdyAtIHN0YXJ0X3RpbWUpIC8gZHVyYXRpb24pO1xuICAgICAgICAgICAgICAgICAgICB0aWNrKHQsIDEgLSB0KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gcnVubmluZztcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIGxldCBzdGFydGVkID0gZmFsc2U7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgc3RhcnQoKSB7XG4gICAgICAgICAgICBpZiAoc3RhcnRlZClcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICBkZWxldGVfcnVsZShub2RlKTtcbiAgICAgICAgICAgIGlmIChpc19mdW5jdGlvbihjb25maWcpKSB7XG4gICAgICAgICAgICAgICAgY29uZmlnID0gY29uZmlnKCk7XG4gICAgICAgICAgICAgICAgd2FpdCgpLnRoZW4oZ28pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgZ28oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgaW52YWxpZGF0ZSgpIHtcbiAgICAgICAgICAgIHN0YXJ0ZWQgPSBmYWxzZTtcbiAgICAgICAgfSxcbiAgICAgICAgZW5kKCkge1xuICAgICAgICAgICAgaWYgKHJ1bm5pbmcpIHtcbiAgICAgICAgICAgICAgICBjbGVhbnVwKCk7XG4gICAgICAgICAgICAgICAgcnVubmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfTtcbn1cbmZ1bmN0aW9uIGNyZWF0ZV9vdXRfdHJhbnNpdGlvbihub2RlLCBmbiwgcGFyYW1zKSB7XG4gICAgbGV0IGNvbmZpZyA9IGZuKG5vZGUsIHBhcmFtcyk7XG4gICAgbGV0IHJ1bm5pbmcgPSB0cnVlO1xuICAgIGxldCBhbmltYXRpb25fbmFtZTtcbiAgICBjb25zdCBncm91cCA9IG91dHJvcztcbiAgICBncm91cC5yICs9IDE7XG4gICAgZnVuY3Rpb24gZ28oKSB7XG4gICAgICAgIGNvbnN0IHsgZGVsYXkgPSAwLCBkdXJhdGlvbiA9IDMwMCwgZWFzaW5nID0gaWRlbnRpdHksIHRpY2sgPSBub29wLCBjc3MgfSA9IGNvbmZpZyB8fCBudWxsX3RyYW5zaXRpb247XG4gICAgICAgIGlmIChjc3MpXG4gICAgICAgICAgICBhbmltYXRpb25fbmFtZSA9IGNyZWF0ZV9ydWxlKG5vZGUsIDEsIDAsIGR1cmF0aW9uLCBkZWxheSwgZWFzaW5nLCBjc3MpO1xuICAgICAgICBjb25zdCBzdGFydF90aW1lID0gbm93KCkgKyBkZWxheTtcbiAgICAgICAgY29uc3QgZW5kX3RpbWUgPSBzdGFydF90aW1lICsgZHVyYXRpb247XG4gICAgICAgIGFkZF9yZW5kZXJfY2FsbGJhY2soKCkgPT4gZGlzcGF0Y2gobm9kZSwgZmFsc2UsICdzdGFydCcpKTtcbiAgICAgICAgbG9vcChub3cgPT4ge1xuICAgICAgICAgICAgaWYgKHJ1bm5pbmcpIHtcbiAgICAgICAgICAgICAgICBpZiAobm93ID49IGVuZF90aW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHRpY2soMCwgMSk7XG4gICAgICAgICAgICAgICAgICAgIGRpc3BhdGNoKG5vZGUsIGZhbHNlLCAnZW5kJyk7XG4gICAgICAgICAgICAgICAgICAgIGlmICghLS1ncm91cC5yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGlzIHdpbGwgcmVzdWx0IGluIGBlbmQoKWAgYmVpbmcgY2FsbGVkLFxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gc28gd2UgZG9uJ3QgbmVlZCB0byBjbGVhbiB1cCBoZXJlXG4gICAgICAgICAgICAgICAgICAgICAgICBydW5fYWxsKGdyb3VwLmMpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKG5vdyA+PSBzdGFydF90aW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHQgPSBlYXNpbmcoKG5vdyAtIHN0YXJ0X3RpbWUpIC8gZHVyYXRpb24pO1xuICAgICAgICAgICAgICAgICAgICB0aWNrKDEgLSB0LCB0KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gcnVubmluZztcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIGlmIChpc19mdW5jdGlvbihjb25maWcpKSB7XG4gICAgICAgIHdhaXQoKS50aGVuKCgpID0+IHtcbiAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICAgIGNvbmZpZyA9IGNvbmZpZygpO1xuICAgICAgICAgICAgZ28oKTtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICBnbygpO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgICBlbmQocmVzZXQpIHtcbiAgICAgICAgICAgIGlmIChyZXNldCAmJiBjb25maWcudGljaykge1xuICAgICAgICAgICAgICAgIGNvbmZpZy50aWNrKDEsIDApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHJ1bm5pbmcpIHtcbiAgICAgICAgICAgICAgICBpZiAoYW5pbWF0aW9uX25hbWUpXG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZV9ydWxlKG5vZGUsIGFuaW1hdGlvbl9uYW1lKTtcbiAgICAgICAgICAgICAgICBydW5uaW5nID0gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9O1xufVxuZnVuY3Rpb24gY3JlYXRlX2JpZGlyZWN0aW9uYWxfdHJhbnNpdGlvbihub2RlLCBmbiwgcGFyYW1zLCBpbnRybykge1xuICAgIGxldCBjb25maWcgPSBmbihub2RlLCBwYXJhbXMpO1xuICAgIGxldCB0ID0gaW50cm8gPyAwIDogMTtcbiAgICBsZXQgcnVubmluZ19wcm9ncmFtID0gbnVsbDtcbiAgICBsZXQgcGVuZGluZ19wcm9ncmFtID0gbnVsbDtcbiAgICBsZXQgYW5pbWF0aW9uX25hbWUgPSBudWxsO1xuICAgIGZ1bmN0aW9uIGNsZWFyX2FuaW1hdGlvbigpIHtcbiAgICAgICAgaWYgKGFuaW1hdGlvbl9uYW1lKVxuICAgICAgICAgICAgZGVsZXRlX3J1bGUobm9kZSwgYW5pbWF0aW9uX25hbWUpO1xuICAgIH1cbiAgICBmdW5jdGlvbiBpbml0KHByb2dyYW0sIGR1cmF0aW9uKSB7XG4gICAgICAgIGNvbnN0IGQgPSBwcm9ncmFtLmIgLSB0O1xuICAgICAgICBkdXJhdGlvbiAqPSBNYXRoLmFicyhkKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGE6IHQsXG4gICAgICAgICAgICBiOiBwcm9ncmFtLmIsXG4gICAgICAgICAgICBkLFxuICAgICAgICAgICAgZHVyYXRpb24sXG4gICAgICAgICAgICBzdGFydDogcHJvZ3JhbS5zdGFydCxcbiAgICAgICAgICAgIGVuZDogcHJvZ3JhbS5zdGFydCArIGR1cmF0aW9uLFxuICAgICAgICAgICAgZ3JvdXA6IHByb2dyYW0uZ3JvdXBcbiAgICAgICAgfTtcbiAgICB9XG4gICAgZnVuY3Rpb24gZ28oYikge1xuICAgICAgICBjb25zdCB7IGRlbGF5ID0gMCwgZHVyYXRpb24gPSAzMDAsIGVhc2luZyA9IGlkZW50aXR5LCB0aWNrID0gbm9vcCwgY3NzIH0gPSBjb25maWcgfHwgbnVsbF90cmFuc2l0aW9uO1xuICAgICAgICBjb25zdCBwcm9ncmFtID0ge1xuICAgICAgICAgICAgc3RhcnQ6IG5vdygpICsgZGVsYXksXG4gICAgICAgICAgICBiXG4gICAgICAgIH07XG4gICAgICAgIGlmICghYikge1xuICAgICAgICAgICAgLy8gQHRzLWlnbm9yZSB0b2RvOiBpbXByb3ZlIHR5cGluZ3NcbiAgICAgICAgICAgIHByb2dyYW0uZ3JvdXAgPSBvdXRyb3M7XG4gICAgICAgICAgICBvdXRyb3MuciArPSAxO1xuICAgICAgICB9XG4gICAgICAgIGlmIChydW5uaW5nX3Byb2dyYW0pIHtcbiAgICAgICAgICAgIHBlbmRpbmdfcHJvZ3JhbSA9IHByb2dyYW07XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAvLyBpZiB0aGlzIGlzIGFuIGludHJvLCBhbmQgdGhlcmUncyBhIGRlbGF5LCB3ZSBuZWVkIHRvIGRvXG4gICAgICAgICAgICAvLyBhbiBpbml0aWFsIHRpY2sgYW5kL29yIGFwcGx5IENTUyBhbmltYXRpb24gaW1tZWRpYXRlbHlcbiAgICAgICAgICAgIGlmIChjc3MpIHtcbiAgICAgICAgICAgICAgICBjbGVhcl9hbmltYXRpb24oKTtcbiAgICAgICAgICAgICAgICBhbmltYXRpb25fbmFtZSA9IGNyZWF0ZV9ydWxlKG5vZGUsIHQsIGIsIGR1cmF0aW9uLCBkZWxheSwgZWFzaW5nLCBjc3MpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGIpXG4gICAgICAgICAgICAgICAgdGljaygwLCAxKTtcbiAgICAgICAgICAgIHJ1bm5pbmdfcHJvZ3JhbSA9IGluaXQocHJvZ3JhbSwgZHVyYXRpb24pO1xuICAgICAgICAgICAgYWRkX3JlbmRlcl9jYWxsYmFjaygoKSA9PiBkaXNwYXRjaChub2RlLCBiLCAnc3RhcnQnKSk7XG4gICAgICAgICAgICBsb29wKG5vdyA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKHBlbmRpbmdfcHJvZ3JhbSAmJiBub3cgPiBwZW5kaW5nX3Byb2dyYW0uc3RhcnQpIHtcbiAgICAgICAgICAgICAgICAgICAgcnVubmluZ19wcm9ncmFtID0gaW5pdChwZW5kaW5nX3Byb2dyYW0sIGR1cmF0aW9uKTtcbiAgICAgICAgICAgICAgICAgICAgcGVuZGluZ19wcm9ncmFtID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgZGlzcGF0Y2gobm9kZSwgcnVubmluZ19wcm9ncmFtLmIsICdzdGFydCcpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoY3NzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjbGVhcl9hbmltYXRpb24oKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgdCwgcnVubmluZ19wcm9ncmFtLmIsIHJ1bm5pbmdfcHJvZ3JhbS5kdXJhdGlvbiwgMCwgZWFzaW5nLCBjb25maWcuY3NzKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAocnVubmluZ19wcm9ncmFtKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChub3cgPj0gcnVubmluZ19wcm9ncmFtLmVuZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGljayh0ID0gcnVubmluZ19wcm9ncmFtLmIsIDEgLSB0KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpc3BhdGNoKG5vZGUsIHJ1bm5pbmdfcHJvZ3JhbS5iLCAnZW5kJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXBlbmRpbmdfcHJvZ3JhbSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHdlJ3JlIGRvbmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocnVubmluZ19wcm9ncmFtLmIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gaW50cm8g4oCUIHdlIGNhbiB0aWR5IHVwIGltbWVkaWF0ZWx5XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsZWFyX2FuaW1hdGlvbigpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gb3V0cm8g4oCUIG5lZWRzIHRvIGJlIGNvb3JkaW5hdGVkXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghLS1ydW5uaW5nX3Byb2dyYW0uZ3JvdXAucilcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJ1bl9hbGwocnVubmluZ19wcm9ncmFtLmdyb3VwLmMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHJ1bm5pbmdfcHJvZ3JhbSA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAobm93ID49IHJ1bm5pbmdfcHJvZ3JhbS5zdGFydCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcCA9IG5vdyAtIHJ1bm5pbmdfcHJvZ3JhbS5zdGFydDtcbiAgICAgICAgICAgICAgICAgICAgICAgIHQgPSBydW5uaW5nX3Byb2dyYW0uYSArIHJ1bm5pbmdfcHJvZ3JhbS5kICogZWFzaW5nKHAgLyBydW5uaW5nX3Byb2dyYW0uZHVyYXRpb24pO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGljayh0LCAxIC0gdCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuICEhKHJ1bm5pbmdfcHJvZ3JhbSB8fCBwZW5kaW5nX3Byb2dyYW0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgICAgcnVuKGIpIHtcbiAgICAgICAgICAgIGlmIChpc19mdW5jdGlvbihjb25maWcpKSB7XG4gICAgICAgICAgICAgICAgd2FpdCgpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZyA9IGNvbmZpZygpO1xuICAgICAgICAgICAgICAgICAgICBnbyhiKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIGdvKGIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBlbmQoKSB7XG4gICAgICAgICAgICBjbGVhcl9hbmltYXRpb24oKTtcbiAgICAgICAgICAgIHJ1bm5pbmdfcHJvZ3JhbSA9IHBlbmRpbmdfcHJvZ3JhbSA9IG51bGw7XG4gICAgICAgIH1cbiAgICB9O1xufVxuXG5mdW5jdGlvbiBoYW5kbGVfcHJvbWlzZShwcm9taXNlLCBpbmZvKSB7XG4gICAgY29uc3QgdG9rZW4gPSBpbmZvLnRva2VuID0ge307XG4gICAgZnVuY3Rpb24gdXBkYXRlKHR5cGUsIGluZGV4LCBrZXksIHZhbHVlKSB7XG4gICAgICAgIGlmIChpbmZvLnRva2VuICE9PSB0b2tlbilcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgaW5mby5yZXNvbHZlZCA9IHZhbHVlO1xuICAgICAgICBsZXQgY2hpbGRfY3R4ID0gaW5mby5jdHg7XG4gICAgICAgIGlmIChrZXkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY2hpbGRfY3R4ID0gY2hpbGRfY3R4LnNsaWNlKCk7XG4gICAgICAgICAgICBjaGlsZF9jdHhba2V5XSA9IHZhbHVlO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGJsb2NrID0gdHlwZSAmJiAoaW5mby5jdXJyZW50ID0gdHlwZSkoY2hpbGRfY3R4KTtcbiAgICAgICAgbGV0IG5lZWRzX2ZsdXNoID0gZmFsc2U7XG4gICAgICAgIGlmIChpbmZvLmJsb2NrKSB7XG4gICAgICAgICAgICBpZiAoaW5mby5ibG9ja3MpIHtcbiAgICAgICAgICAgICAgICBpbmZvLmJsb2Nrcy5mb3JFYWNoKChibG9jaywgaSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoaSAhPT0gaW5kZXggJiYgYmxvY2spIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGdyb3VwX291dHJvcygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdHJhbnNpdGlvbl9vdXQoYmxvY2ssIDEsIDEsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmZvLmJsb2Nrc1tpXSA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoZWNrX291dHJvcygpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBpbmZvLmJsb2NrLmQoMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBibG9jay5jKCk7XG4gICAgICAgICAgICB0cmFuc2l0aW9uX2luKGJsb2NrLCAxKTtcbiAgICAgICAgICAgIGJsb2NrLm0oaW5mby5tb3VudCgpLCBpbmZvLmFuY2hvcik7XG4gICAgICAgICAgICBuZWVkc19mbHVzaCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaW5mby5ibG9jayA9IGJsb2NrO1xuICAgICAgICBpZiAoaW5mby5ibG9ja3MpXG4gICAgICAgICAgICBpbmZvLmJsb2Nrc1tpbmRleF0gPSBibG9jaztcbiAgICAgICAgaWYgKG5lZWRzX2ZsdXNoKSB7XG4gICAgICAgICAgICBmbHVzaCgpO1xuICAgICAgICB9XG4gICAgfVxuICAgIGlmIChpc19wcm9taXNlKHByb21pc2UpKSB7XG4gICAgICAgIGNvbnN0IGN1cnJlbnRfY29tcG9uZW50ID0gZ2V0X2N1cnJlbnRfY29tcG9uZW50KCk7XG4gICAgICAgIHByb21pc2UudGhlbih2YWx1ZSA9PiB7XG4gICAgICAgICAgICBzZXRfY3VycmVudF9jb21wb25lbnQoY3VycmVudF9jb21wb25lbnQpO1xuICAgICAgICAgICAgdXBkYXRlKGluZm8udGhlbiwgMSwgaW5mby52YWx1ZSwgdmFsdWUpO1xuICAgICAgICAgICAgc2V0X2N1cnJlbnRfY29tcG9uZW50KG51bGwpO1xuICAgICAgICB9LCBlcnJvciA9PiB7XG4gICAgICAgICAgICBzZXRfY3VycmVudF9jb21wb25lbnQoY3VycmVudF9jb21wb25lbnQpO1xuICAgICAgICAgICAgdXBkYXRlKGluZm8uY2F0Y2gsIDIsIGluZm8uZXJyb3IsIGVycm9yKTtcbiAgICAgICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChudWxsKTtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIGlmIHdlIHByZXZpb3VzbHkgaGFkIGEgdGhlbi9jYXRjaCBibG9jaywgZGVzdHJveSBpdFxuICAgICAgICBpZiAoaW5mby5jdXJyZW50ICE9PSBpbmZvLnBlbmRpbmcpIHtcbiAgICAgICAgICAgIHVwZGF0ZShpbmZvLnBlbmRpbmcsIDApO1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIGlmIChpbmZvLmN1cnJlbnQgIT09IGluZm8udGhlbikge1xuICAgICAgICAgICAgdXBkYXRlKGluZm8udGhlbiwgMSwgaW5mby52YWx1ZSwgcHJvbWlzZSk7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpbmZvLnJlc29sdmVkID0gcHJvbWlzZTtcbiAgICB9XG59XG5cbmNvbnN0IGdsb2JhbHMgPSAodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCdcbiAgICA/IHdpbmRvd1xuICAgIDogdHlwZW9mIGdsb2JhbFRoaXMgIT09ICd1bmRlZmluZWQnXG4gICAgICAgID8gZ2xvYmFsVGhpc1xuICAgICAgICA6IGdsb2JhbCk7XG5cbmZ1bmN0aW9uIGRlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCkge1xuICAgIGJsb2NrLmQoMSk7XG4gICAgbG9va3VwLmRlbGV0ZShibG9jay5rZXkpO1xufVxuZnVuY3Rpb24gb3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCkge1xuICAgIHRyYW5zaXRpb25fb3V0KGJsb2NrLCAxLCAxLCAoKSA9PiB7XG4gICAgICAgIGxvb2t1cC5kZWxldGUoYmxvY2sua2V5KTtcbiAgICB9KTtcbn1cbmZ1bmN0aW9uIGZpeF9hbmRfZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKSB7XG4gICAgYmxvY2suZigpO1xuICAgIGRlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCk7XG59XG5mdW5jdGlvbiBmaXhfYW5kX291dHJvX2FuZF9kZXN0cm95X2Jsb2NrKGJsb2NrLCBsb29rdXApIHtcbiAgICBibG9jay5mKCk7XG4gICAgb3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCk7XG59XG5mdW5jdGlvbiB1cGRhdGVfa2V5ZWRfZWFjaChvbGRfYmxvY2tzLCBkaXJ0eSwgZ2V0X2tleSwgZHluYW1pYywgY3R4LCBsaXN0LCBsb29rdXAsIG5vZGUsIGRlc3Ryb3ksIGNyZWF0ZV9lYWNoX2Jsb2NrLCBuZXh0LCBnZXRfY29udGV4dCkge1xuICAgIGxldCBvID0gb2xkX2Jsb2Nrcy5sZW5ndGg7XG4gICAgbGV0IG4gPSBsaXN0Lmxlbmd0aDtcbiAgICBsZXQgaSA9IG87XG4gICAgY29uc3Qgb2xkX2luZGV4ZXMgPSB7fTtcbiAgICB3aGlsZSAoaS0tKVxuICAgICAgICBvbGRfaW5kZXhlc1tvbGRfYmxvY2tzW2ldLmtleV0gPSBpO1xuICAgIGNvbnN0IG5ld19ibG9ja3MgPSBbXTtcbiAgICBjb25zdCBuZXdfbG9va3VwID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IGRlbHRhcyA9IG5ldyBNYXAoKTtcbiAgICBpID0gbjtcbiAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgIGNvbnN0IGNoaWxkX2N0eCA9IGdldF9jb250ZXh0KGN0eCwgbGlzdCwgaSk7XG4gICAgICAgIGNvbnN0IGtleSA9IGdldF9rZXkoY2hpbGRfY3R4KTtcbiAgICAgICAgbGV0IGJsb2NrID0gbG9va3VwLmdldChrZXkpO1xuICAgICAgICBpZiAoIWJsb2NrKSB7XG4gICAgICAgICAgICBibG9jayA9IGNyZWF0ZV9lYWNoX2Jsb2NrKGtleSwgY2hpbGRfY3R4KTtcbiAgICAgICAgICAgIGJsb2NrLmMoKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChkeW5hbWljKSB7XG4gICAgICAgICAgICBibG9jay5wKGNoaWxkX2N0eCwgZGlydHkpO1xuICAgICAgICB9XG4gICAgICAgIG5ld19sb29rdXAuc2V0KGtleSwgbmV3X2Jsb2Nrc1tpXSA9IGJsb2NrKTtcbiAgICAgICAgaWYgKGtleSBpbiBvbGRfaW5kZXhlcylcbiAgICAgICAgICAgIGRlbHRhcy5zZXQoa2V5LCBNYXRoLmFicyhpIC0gb2xkX2luZGV4ZXNba2V5XSkpO1xuICAgIH1cbiAgICBjb25zdCB3aWxsX21vdmUgPSBuZXcgU2V0KCk7XG4gICAgY29uc3QgZGlkX21vdmUgPSBuZXcgU2V0KCk7XG4gICAgZnVuY3Rpb24gaW5zZXJ0KGJsb2NrKSB7XG4gICAgICAgIHRyYW5zaXRpb25faW4oYmxvY2ssIDEpO1xuICAgICAgICBibG9jay5tKG5vZGUsIG5leHQpO1xuICAgICAgICBsb29rdXAuc2V0KGJsb2NrLmtleSwgYmxvY2spO1xuICAgICAgICBuZXh0ID0gYmxvY2suZmlyc3Q7XG4gICAgICAgIG4tLTtcbiAgICB9XG4gICAgd2hpbGUgKG8gJiYgbikge1xuICAgICAgICBjb25zdCBuZXdfYmxvY2sgPSBuZXdfYmxvY2tzW24gLSAxXTtcbiAgICAgICAgY29uc3Qgb2xkX2Jsb2NrID0gb2xkX2Jsb2Nrc1tvIC0gMV07XG4gICAgICAgIGNvbnN0IG5ld19rZXkgPSBuZXdfYmxvY2sua2V5O1xuICAgICAgICBjb25zdCBvbGRfa2V5ID0gb2xkX2Jsb2NrLmtleTtcbiAgICAgICAgaWYgKG5ld19ibG9jayA9PT0gb2xkX2Jsb2NrKSB7XG4gICAgICAgICAgICAvLyBkbyBub3RoaW5nXG4gICAgICAgICAgICBuZXh0ID0gbmV3X2Jsb2NrLmZpcnN0O1xuICAgICAgICAgICAgby0tO1xuICAgICAgICAgICAgbi0tO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKCFuZXdfbG9va3VwLmhhcyhvbGRfa2V5KSkge1xuICAgICAgICAgICAgLy8gcmVtb3ZlIG9sZCBibG9ja1xuICAgICAgICAgICAgZGVzdHJveShvbGRfYmxvY2ssIGxvb2t1cCk7XG4gICAgICAgICAgICBvLS07XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoIWxvb2t1cC5oYXMobmV3X2tleSkgfHwgd2lsbF9tb3ZlLmhhcyhuZXdfa2V5KSkge1xuICAgICAgICAgICAgaW5zZXJ0KG5ld19ibG9jayk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoZGlkX21vdmUuaGFzKG9sZF9rZXkpKSB7XG4gICAgICAgICAgICBvLS07XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoZGVsdGFzLmdldChuZXdfa2V5KSA+IGRlbHRhcy5nZXQob2xkX2tleSkpIHtcbiAgICAgICAgICAgIGRpZF9tb3ZlLmFkZChuZXdfa2V5KTtcbiAgICAgICAgICAgIGluc2VydChuZXdfYmxvY2spO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgd2lsbF9tb3ZlLmFkZChvbGRfa2V5KTtcbiAgICAgICAgICAgIG8tLTtcbiAgICAgICAgfVxuICAgIH1cbiAgICB3aGlsZSAoby0tKSB7XG4gICAgICAgIGNvbnN0IG9sZF9ibG9jayA9IG9sZF9ibG9ja3Nbb107XG4gICAgICAgIGlmICghbmV3X2xvb2t1cC5oYXMob2xkX2Jsb2NrLmtleSkpXG4gICAgICAgICAgICBkZXN0cm95KG9sZF9ibG9jaywgbG9va3VwKTtcbiAgICB9XG4gICAgd2hpbGUgKG4pXG4gICAgICAgIGluc2VydChuZXdfYmxvY2tzW24gLSAxXSk7XG4gICAgcmV0dXJuIG5ld19ibG9ja3M7XG59XG5mdW5jdGlvbiB2YWxpZGF0ZV9lYWNoX2tleXMoY3R4LCBsaXN0LCBnZXRfY29udGV4dCwgZ2V0X2tleSkge1xuICAgIGNvbnN0IGtleXMgPSBuZXcgU2V0KCk7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IGtleSA9IGdldF9rZXkoZ2V0X2NvbnRleHQoY3R4LCBsaXN0LCBpKSk7XG4gICAgICAgIGlmIChrZXlzLmhhcyhrZXkpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBoYXZlIGR1cGxpY2F0ZSBrZXlzIGluIGEga2V5ZWQgZWFjaGApO1xuICAgICAgICB9XG4gICAgICAgIGtleXMuYWRkKGtleSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBnZXRfc3ByZWFkX3VwZGF0ZShsZXZlbHMsIHVwZGF0ZXMpIHtcbiAgICBjb25zdCB1cGRhdGUgPSB7fTtcbiAgICBjb25zdCB0b19udWxsX291dCA9IHt9O1xuICAgIGNvbnN0IGFjY291bnRlZF9mb3IgPSB7ICQkc2NvcGU6IDEgfTtcbiAgICBsZXQgaSA9IGxldmVscy5sZW5ndGg7XG4gICAgd2hpbGUgKGktLSkge1xuICAgICAgICBjb25zdCBvID0gbGV2ZWxzW2ldO1xuICAgICAgICBjb25zdCBuID0gdXBkYXRlc1tpXTtcbiAgICAgICAgaWYgKG4pIHtcbiAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIG8pIHtcbiAgICAgICAgICAgICAgICBpZiAoIShrZXkgaW4gbikpXG4gICAgICAgICAgICAgICAgICAgIHRvX251bGxfb3V0W2tleV0gPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gbikge1xuICAgICAgICAgICAgICAgIGlmICghYWNjb3VudGVkX2ZvcltrZXldKSB7XG4gICAgICAgICAgICAgICAgICAgIHVwZGF0ZVtrZXldID0gbltrZXldO1xuICAgICAgICAgICAgICAgICAgICBhY2NvdW50ZWRfZm9yW2tleV0gPSAxO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGxldmVsc1tpXSA9IG47XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBvKSB7XG4gICAgICAgICAgICAgICAgYWNjb3VudGVkX2ZvcltrZXldID0gMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICBmb3IgKGNvbnN0IGtleSBpbiB0b19udWxsX291dCkge1xuICAgICAgICBpZiAoIShrZXkgaW4gdXBkYXRlKSlcbiAgICAgICAgICAgIHVwZGF0ZVtrZXldID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICByZXR1cm4gdXBkYXRlO1xufVxuZnVuY3Rpb24gZ2V0X3NwcmVhZF9vYmplY3Qoc3ByZWFkX3Byb3BzKSB7XG4gICAgcmV0dXJuIHR5cGVvZiBzcHJlYWRfcHJvcHMgPT09ICdvYmplY3QnICYmIHNwcmVhZF9wcm9wcyAhPT0gbnVsbCA/IHNwcmVhZF9wcm9wcyA6IHt9O1xufVxuXG4vLyBzb3VyY2U6IGh0dHBzOi8vaHRtbC5zcGVjLndoYXR3Zy5vcmcvbXVsdGlwYWdlL2luZGljZXMuaHRtbFxuY29uc3QgYm9vbGVhbl9hdHRyaWJ1dGVzID0gbmV3IFNldChbXG4gICAgJ2FsbG93ZnVsbHNjcmVlbicsXG4gICAgJ2FsbG93cGF5bWVudHJlcXVlc3QnLFxuICAgICdhc3luYycsXG4gICAgJ2F1dG9mb2N1cycsXG4gICAgJ2F1dG9wbGF5JyxcbiAgICAnY2hlY2tlZCcsXG4gICAgJ2NvbnRyb2xzJyxcbiAgICAnZGVmYXVsdCcsXG4gICAgJ2RlZmVyJyxcbiAgICAnZGlzYWJsZWQnLFxuICAgICdmb3Jtbm92YWxpZGF0ZScsXG4gICAgJ2hpZGRlbicsXG4gICAgJ2lzbWFwJyxcbiAgICAnbG9vcCcsXG4gICAgJ211bHRpcGxlJyxcbiAgICAnbXV0ZWQnLFxuICAgICdub21vZHVsZScsXG4gICAgJ25vdmFsaWRhdGUnLFxuICAgICdvcGVuJyxcbiAgICAncGxheXNpbmxpbmUnLFxuICAgICdyZWFkb25seScsXG4gICAgJ3JlcXVpcmVkJyxcbiAgICAncmV2ZXJzZWQnLFxuICAgICdzZWxlY3RlZCdcbl0pO1xuXG5jb25zdCBpbnZhbGlkX2F0dHJpYnV0ZV9uYW1lX2NoYXJhY3RlciA9IC9bXFxzJ1wiPi89XFx1e0ZERDB9LVxcdXtGREVGfVxcdXtGRkZFfVxcdXtGRkZGfVxcdXsxRkZGRX1cXHV7MUZGRkZ9XFx1ezJGRkZFfVxcdXsyRkZGRn1cXHV7M0ZGRkV9XFx1ezNGRkZGfVxcdXs0RkZGRX1cXHV7NEZGRkZ9XFx1ezVGRkZFfVxcdXs1RkZGRn1cXHV7NkZGRkV9XFx1ezZGRkZGfVxcdXs3RkZGRX1cXHV7N0ZGRkZ9XFx1ezhGRkZFfVxcdXs4RkZGRn1cXHV7OUZGRkV9XFx1ezlGRkZGfVxcdXtBRkZGRX1cXHV7QUZGRkZ9XFx1e0JGRkZFfVxcdXtCRkZGRn1cXHV7Q0ZGRkV9XFx1e0NGRkZGfVxcdXtERkZGRX1cXHV7REZGRkZ9XFx1e0VGRkZFfVxcdXtFRkZGRn1cXHV7RkZGRkV9XFx1e0ZGRkZGfVxcdXsxMEZGRkV9XFx1ezEwRkZGRn1dL3U7XG4vLyBodHRwczovL2h0bWwuc3BlYy53aGF0d2cub3JnL211bHRpcGFnZS9zeW50YXguaHRtbCNhdHRyaWJ1dGVzLTJcbi8vIGh0dHBzOi8vaW5mcmEuc3BlYy53aGF0d2cub3JnLyNub25jaGFyYWN0ZXJcbmZ1bmN0aW9uIHNwcmVhZChhcmdzLCBjbGFzc2VzX3RvX2FkZCkge1xuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSBPYmplY3QuYXNzaWduKHt9LCAuLi5hcmdzKTtcbiAgICBpZiAoY2xhc3Nlc190b19hZGQpIHtcbiAgICAgICAgaWYgKGF0dHJpYnV0ZXMuY2xhc3MgPT0gbnVsbCkge1xuICAgICAgICAgICAgYXR0cmlidXRlcy5jbGFzcyA9IGNsYXNzZXNfdG9fYWRkO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgYXR0cmlidXRlcy5jbGFzcyArPSAnICcgKyBjbGFzc2VzX3RvX2FkZDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBsZXQgc3RyID0gJyc7XG4gICAgT2JqZWN0LmtleXMoYXR0cmlidXRlcykuZm9yRWFjaChuYW1lID0+IHtcbiAgICAgICAgaWYgKGludmFsaWRfYXR0cmlidXRlX25hbWVfY2hhcmFjdGVyLnRlc3QobmFtZSkpXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIGNvbnN0IHZhbHVlID0gYXR0cmlidXRlc1tuYW1lXTtcbiAgICAgICAgaWYgKHZhbHVlID09PSB0cnVlKVxuICAgICAgICAgICAgc3RyICs9IFwiIFwiICsgbmFtZTtcbiAgICAgICAgZWxzZSBpZiAoYm9vbGVhbl9hdHRyaWJ1dGVzLmhhcyhuYW1lLnRvTG93ZXJDYXNlKCkpKSB7XG4gICAgICAgICAgICBpZiAodmFsdWUpXG4gICAgICAgICAgICAgICAgc3RyICs9IFwiIFwiICsgbmFtZTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmICh2YWx1ZSAhPSBudWxsKSB7XG4gICAgICAgICAgICBzdHIgKz0gYCAke25hbWV9PVwiJHtTdHJpbmcodmFsdWUpLnJlcGxhY2UoL1wiL2csICcmIzM0OycpLnJlcGxhY2UoLycvZywgJyYjMzk7Jyl9XCJgO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIHN0cjtcbn1cbmNvbnN0IGVzY2FwZWQgPSB7XG4gICAgJ1wiJzogJyZxdW90OycsXG4gICAgXCInXCI6ICcmIzM5OycsXG4gICAgJyYnOiAnJmFtcDsnLFxuICAgICc8JzogJyZsdDsnLFxuICAgICc+JzogJyZndDsnXG59O1xuZnVuY3Rpb24gZXNjYXBlKGh0bWwpIHtcbiAgICByZXR1cm4gU3RyaW5nKGh0bWwpLnJlcGxhY2UoL1tcIicmPD5dL2csIG1hdGNoID0+IGVzY2FwZWRbbWF0Y2hdKTtcbn1cbmZ1bmN0aW9uIGVhY2goaXRlbXMsIGZuKSB7XG4gICAgbGV0IHN0ciA9ICcnO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgaXRlbXMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgc3RyICs9IGZuKGl0ZW1zW2ldLCBpKTtcbiAgICB9XG4gICAgcmV0dXJuIHN0cjtcbn1cbmNvbnN0IG1pc3NpbmdfY29tcG9uZW50ID0ge1xuICAgICQkcmVuZGVyOiAoKSA9PiAnJ1xufTtcbmZ1bmN0aW9uIHZhbGlkYXRlX2NvbXBvbmVudChjb21wb25lbnQsIG5hbWUpIHtcbiAgICBpZiAoIWNvbXBvbmVudCB8fCAhY29tcG9uZW50LiQkcmVuZGVyKSB7XG4gICAgICAgIGlmIChuYW1lID09PSAnc3ZlbHRlOmNvbXBvbmVudCcpXG4gICAgICAgICAgICBuYW1lICs9ICcgdGhpcz17Li4ufSc7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgPCR7bmFtZX0+IGlzIG5vdCBhIHZhbGlkIFNTUiBjb21wb25lbnQuIFlvdSBtYXkgbmVlZCB0byByZXZpZXcgeW91ciBidWlsZCBjb25maWcgdG8gZW5zdXJlIHRoYXQgZGVwZW5kZW5jaWVzIGFyZSBjb21waWxlZCwgcmF0aGVyIHRoYW4gaW1wb3J0ZWQgYXMgcHJlLWNvbXBpbGVkIG1vZHVsZXNgKTtcbiAgICB9XG4gICAgcmV0dXJuIGNvbXBvbmVudDtcbn1cbmZ1bmN0aW9uIGRlYnVnKGZpbGUsIGxpbmUsIGNvbHVtbiwgdmFsdWVzKSB7XG4gICAgY29uc29sZS5sb2coYHtAZGVidWd9ICR7ZmlsZSA/IGZpbGUgKyAnICcgOiAnJ30oJHtsaW5lfToke2NvbHVtbn0pYCk7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tY29uc29sZVxuICAgIGNvbnNvbGUubG9nKHZhbHVlcyk7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tY29uc29sZVxuICAgIHJldHVybiAnJztcbn1cbmxldCBvbl9kZXN0cm95O1xuZnVuY3Rpb24gY3JlYXRlX3Nzcl9jb21wb25lbnQoZm4pIHtcbiAgICBmdW5jdGlvbiAkJHJlbmRlcihyZXN1bHQsIHByb3BzLCBiaW5kaW5ncywgc2xvdHMpIHtcbiAgICAgICAgY29uc3QgcGFyZW50X2NvbXBvbmVudCA9IGN1cnJlbnRfY29tcG9uZW50O1xuICAgICAgICBjb25zdCAkJCA9IHtcbiAgICAgICAgICAgIG9uX2Rlc3Ryb3ksXG4gICAgICAgICAgICBjb250ZXh0OiBuZXcgTWFwKHBhcmVudF9jb21wb25lbnQgPyBwYXJlbnRfY29tcG9uZW50LiQkLmNvbnRleHQgOiBbXSksXG4gICAgICAgICAgICAvLyB0aGVzZSB3aWxsIGJlIGltbWVkaWF0ZWx5IGRpc2NhcmRlZFxuICAgICAgICAgICAgb25fbW91bnQ6IFtdLFxuICAgICAgICAgICAgYmVmb3JlX3VwZGF0ZTogW10sXG4gICAgICAgICAgICBhZnRlcl91cGRhdGU6IFtdLFxuICAgICAgICAgICAgY2FsbGJhY2tzOiBibGFua19vYmplY3QoKVxuICAgICAgICB9O1xuICAgICAgICBzZXRfY3VycmVudF9jb21wb25lbnQoeyAkJCB9KTtcbiAgICAgICAgY29uc3QgaHRtbCA9IGZuKHJlc3VsdCwgcHJvcHMsIGJpbmRpbmdzLCBzbG90cyk7XG4gICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChwYXJlbnRfY29tcG9uZW50KTtcbiAgICAgICAgcmV0dXJuIGh0bWw7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICAgIHJlbmRlcjogKHByb3BzID0ge30sIG9wdGlvbnMgPSB7fSkgPT4ge1xuICAgICAgICAgICAgb25fZGVzdHJveSA9IFtdO1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0geyB0aXRsZTogJycsIGhlYWQ6ICcnLCBjc3M6IG5ldyBTZXQoKSB9O1xuICAgICAgICAgICAgY29uc3QgaHRtbCA9ICQkcmVuZGVyKHJlc3VsdCwgcHJvcHMsIHt9LCBvcHRpb25zKTtcbiAgICAgICAgICAgIHJ1bl9hbGwob25fZGVzdHJveSk7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIGh0bWwsXG4gICAgICAgICAgICAgICAgY3NzOiB7XG4gICAgICAgICAgICAgICAgICAgIGNvZGU6IEFycmF5LmZyb20ocmVzdWx0LmNzcykubWFwKGNzcyA9PiBjc3MuY29kZSkuam9pbignXFxuJyksXG4gICAgICAgICAgICAgICAgICAgIG1hcDogbnVsbCAvLyBUT0RPXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBoZWFkOiByZXN1bHQudGl0bGUgKyByZXN1bHQuaGVhZFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfSxcbiAgICAgICAgJCRyZW5kZXJcbiAgICB9O1xufVxuZnVuY3Rpb24gYWRkX2F0dHJpYnV0ZShuYW1lLCB2YWx1ZSwgYm9vbGVhbikge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsIHx8IChib29sZWFuICYmICF2YWx1ZSkpXG4gICAgICAgIHJldHVybiAnJztcbiAgICByZXR1cm4gYCAke25hbWV9JHt2YWx1ZSA9PT0gdHJ1ZSA/ICcnIDogYD0ke3R5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycgPyBKU09OLnN0cmluZ2lmeShlc2NhcGUodmFsdWUpKSA6IGBcIiR7dmFsdWV9XCJgfWB9YDtcbn1cbmZ1bmN0aW9uIGFkZF9jbGFzc2VzKGNsYXNzZXMpIHtcbiAgICByZXR1cm4gY2xhc3NlcyA/IGAgY2xhc3M9XCIke2NsYXNzZXN9XCJgIDogYGA7XG59XG5cbmZ1bmN0aW9uIGJpbmQoY29tcG9uZW50LCBuYW1lLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IGluZGV4ID0gY29tcG9uZW50LiQkLnByb3BzW25hbWVdO1xuICAgIGlmIChpbmRleCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGNvbXBvbmVudC4kJC5ib3VuZFtpbmRleF0gPSBjYWxsYmFjaztcbiAgICAgICAgY2FsbGJhY2soY29tcG9uZW50LiQkLmN0eFtpbmRleF0pO1xuICAgIH1cbn1cbmZ1bmN0aW9uIGNyZWF0ZV9jb21wb25lbnQoYmxvY2spIHtcbiAgICBibG9jayAmJiBibG9jay5jKCk7XG59XG5mdW5jdGlvbiBjbGFpbV9jb21wb25lbnQoYmxvY2ssIHBhcmVudF9ub2Rlcykge1xuICAgIGJsb2NrICYmIGJsb2NrLmwocGFyZW50X25vZGVzKTtcbn1cbmZ1bmN0aW9uIG1vdW50X2NvbXBvbmVudChjb21wb25lbnQsIHRhcmdldCwgYW5jaG9yKSB7XG4gICAgY29uc3QgeyBmcmFnbWVudCwgb25fbW91bnQsIG9uX2Rlc3Ryb3ksIGFmdGVyX3VwZGF0ZSB9ID0gY29tcG9uZW50LiQkO1xuICAgIGZyYWdtZW50ICYmIGZyYWdtZW50Lm0odGFyZ2V0LCBhbmNob3IpO1xuICAgIC8vIG9uTW91bnQgaGFwcGVucyBiZWZvcmUgdGhlIGluaXRpYWwgYWZ0ZXJVcGRhdGVcbiAgICBhZGRfcmVuZGVyX2NhbGxiYWNrKCgpID0+IHtcbiAgICAgICAgY29uc3QgbmV3X29uX2Rlc3Ryb3kgPSBvbl9tb3VudC5tYXAocnVuKS5maWx0ZXIoaXNfZnVuY3Rpb24pO1xuICAgICAgICBpZiAob25fZGVzdHJveSkge1xuICAgICAgICAgICAgb25fZGVzdHJveS5wdXNoKC4uLm5ld19vbl9kZXN0cm95KTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIC8vIEVkZ2UgY2FzZSAtIGNvbXBvbmVudCB3YXMgZGVzdHJveWVkIGltbWVkaWF0ZWx5LFxuICAgICAgICAgICAgLy8gbW9zdCBsaWtlbHkgYXMgYSByZXN1bHQgb2YgYSBiaW5kaW5nIGluaXRpYWxpc2luZ1xuICAgICAgICAgICAgcnVuX2FsbChuZXdfb25fZGVzdHJveSk7XG4gICAgICAgIH1cbiAgICAgICAgY29tcG9uZW50LiQkLm9uX21vdW50ID0gW107XG4gICAgfSk7XG4gICAgYWZ0ZXJfdXBkYXRlLmZvckVhY2goYWRkX3JlbmRlcl9jYWxsYmFjayk7XG59XG5mdW5jdGlvbiBkZXN0cm95X2NvbXBvbmVudChjb21wb25lbnQsIGRldGFjaGluZykge1xuICAgIGNvbnN0ICQkID0gY29tcG9uZW50LiQkO1xuICAgIGlmICgkJC5mcmFnbWVudCAhPT0gbnVsbCkge1xuICAgICAgICBydW5fYWxsKCQkLm9uX2Rlc3Ryb3kpO1xuICAgICAgICAkJC5mcmFnbWVudCAmJiAkJC5mcmFnbWVudC5kKGRldGFjaGluZyk7XG4gICAgICAgIC8vIFRPRE8gbnVsbCBvdXQgb3RoZXIgcmVmcywgaW5jbHVkaW5nIGNvbXBvbmVudC4kJCAoYnV0IG5lZWQgdG9cbiAgICAgICAgLy8gcHJlc2VydmUgZmluYWwgc3RhdGU/KVxuICAgICAgICAkJC5vbl9kZXN0cm95ID0gJCQuZnJhZ21lbnQgPSBudWxsO1xuICAgICAgICAkJC5jdHggPSBbXTtcbiAgICB9XG59XG5mdW5jdGlvbiBtYWtlX2RpcnR5KGNvbXBvbmVudCwgaSkge1xuICAgIGlmIChjb21wb25lbnQuJCQuZGlydHlbMF0gPT09IC0xKSB7XG4gICAgICAgIGRpcnR5X2NvbXBvbmVudHMucHVzaChjb21wb25lbnQpO1xuICAgICAgICBzY2hlZHVsZV91cGRhdGUoKTtcbiAgICAgICAgY29tcG9uZW50LiQkLmRpcnR5LmZpbGwoMCk7XG4gICAgfVxuICAgIGNvbXBvbmVudC4kJC5kaXJ0eVsoaSAvIDMxKSB8IDBdIHw9ICgxIDw8IChpICUgMzEpKTtcbn1cbmZ1bmN0aW9uIGluaXQoY29tcG9uZW50LCBvcHRpb25zLCBpbnN0YW5jZSwgY3JlYXRlX2ZyYWdtZW50LCBub3RfZXF1YWwsIHByb3BzLCBkaXJ0eSA9IFstMV0pIHtcbiAgICBjb25zdCBwYXJlbnRfY29tcG9uZW50ID0gY3VycmVudF9jb21wb25lbnQ7XG4gICAgc2V0X2N1cnJlbnRfY29tcG9uZW50KGNvbXBvbmVudCk7XG4gICAgY29uc3QgcHJvcF92YWx1ZXMgPSBvcHRpb25zLnByb3BzIHx8IHt9O1xuICAgIGNvbnN0ICQkID0gY29tcG9uZW50LiQkID0ge1xuICAgICAgICBmcmFnbWVudDogbnVsbCxcbiAgICAgICAgY3R4OiBudWxsLFxuICAgICAgICAvLyBzdGF0ZVxuICAgICAgICBwcm9wcyxcbiAgICAgICAgdXBkYXRlOiBub29wLFxuICAgICAgICBub3RfZXF1YWwsXG4gICAgICAgIGJvdW5kOiBibGFua19vYmplY3QoKSxcbiAgICAgICAgLy8gbGlmZWN5Y2xlXG4gICAgICAgIG9uX21vdW50OiBbXSxcbiAgICAgICAgb25fZGVzdHJveTogW10sXG4gICAgICAgIGJlZm9yZV91cGRhdGU6IFtdLFxuICAgICAgICBhZnRlcl91cGRhdGU6IFtdLFxuICAgICAgICBjb250ZXh0OiBuZXcgTWFwKHBhcmVudF9jb21wb25lbnQgPyBwYXJlbnRfY29tcG9uZW50LiQkLmNvbnRleHQgOiBbXSksXG4gICAgICAgIC8vIGV2ZXJ5dGhpbmcgZWxzZVxuICAgICAgICBjYWxsYmFja3M6IGJsYW5rX29iamVjdCgpLFxuICAgICAgICBkaXJ0eVxuICAgIH07XG4gICAgbGV0IHJlYWR5ID0gZmFsc2U7XG4gICAgJCQuY3R4ID0gaW5zdGFuY2VcbiAgICAgICAgPyBpbnN0YW5jZShjb21wb25lbnQsIHByb3BfdmFsdWVzLCAoaSwgcmV0LCAuLi5yZXN0KSA9PiB7XG4gICAgICAgICAgICBjb25zdCB2YWx1ZSA9IHJlc3QubGVuZ3RoID8gcmVzdFswXSA6IHJldDtcbiAgICAgICAgICAgIGlmICgkJC5jdHggJiYgbm90X2VxdWFsKCQkLmN0eFtpXSwgJCQuY3R4W2ldID0gdmFsdWUpKSB7XG4gICAgICAgICAgICAgICAgaWYgKCQkLmJvdW5kW2ldKVxuICAgICAgICAgICAgICAgICAgICAkJC5ib3VuZFtpXSh2YWx1ZSk7XG4gICAgICAgICAgICAgICAgaWYgKHJlYWR5KVxuICAgICAgICAgICAgICAgICAgICBtYWtlX2RpcnR5KGNvbXBvbmVudCwgaSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gcmV0O1xuICAgICAgICB9KVxuICAgICAgICA6IFtdO1xuICAgICQkLnVwZGF0ZSgpO1xuICAgIHJlYWR5ID0gdHJ1ZTtcbiAgICBydW5fYWxsKCQkLmJlZm9yZV91cGRhdGUpO1xuICAgIC8vIGBmYWxzZWAgYXMgYSBzcGVjaWFsIGNhc2Ugb2Ygbm8gRE9NIGNvbXBvbmVudFxuICAgICQkLmZyYWdtZW50ID0gY3JlYXRlX2ZyYWdtZW50ID8gY3JlYXRlX2ZyYWdtZW50KCQkLmN0eCkgOiBmYWxzZTtcbiAgICBpZiAob3B0aW9ucy50YXJnZXQpIHtcbiAgICAgICAgaWYgKG9wdGlvbnMuaHlkcmF0ZSkge1xuICAgICAgICAgICAgY29uc3Qgbm9kZXMgPSBjaGlsZHJlbihvcHRpb25zLnRhcmdldCk7XG4gICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLW5vbi1udWxsLWFzc2VydGlvblxuICAgICAgICAgICAgJCQuZnJhZ21lbnQgJiYgJCQuZnJhZ21lbnQubChub2Rlcyk7XG4gICAgICAgICAgICBub2Rlcy5mb3JFYWNoKGRldGFjaCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLW5vbi1udWxsLWFzc2VydGlvblxuICAgICAgICAgICAgJCQuZnJhZ21lbnQgJiYgJCQuZnJhZ21lbnQuYygpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChvcHRpb25zLmludHJvKVxuICAgICAgICAgICAgdHJhbnNpdGlvbl9pbihjb21wb25lbnQuJCQuZnJhZ21lbnQpO1xuICAgICAgICBtb3VudF9jb21wb25lbnQoY29tcG9uZW50LCBvcHRpb25zLnRhcmdldCwgb3B0aW9ucy5hbmNob3IpO1xuICAgICAgICBmbHVzaCgpO1xuICAgIH1cbiAgICBzZXRfY3VycmVudF9jb21wb25lbnQocGFyZW50X2NvbXBvbmVudCk7XG59XG5sZXQgU3ZlbHRlRWxlbWVudDtcbmlmICh0eXBlb2YgSFRNTEVsZW1lbnQgPT09ICdmdW5jdGlvbicpIHtcbiAgICBTdmVsdGVFbGVtZW50ID0gY2xhc3MgZXh0ZW5kcyBIVE1MRWxlbWVudCB7XG4gICAgICAgIGNvbnN0cnVjdG9yKCkge1xuICAgICAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgICAgIHRoaXMuYXR0YWNoU2hhZG93KHsgbW9kZTogJ29wZW4nIH0pO1xuICAgICAgICB9XG4gICAgICAgIGNvbm5lY3RlZENhbGxiYWNrKCkge1xuICAgICAgICAgICAgLy8gQHRzLWlnbm9yZSB0b2RvOiBpbXByb3ZlIHR5cGluZ3NcbiAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIHRoaXMuJCQuc2xvdHRlZCkge1xuICAgICAgICAgICAgICAgIC8vIEB0cy1pZ25vcmUgdG9kbzogaW1wcm92ZSB0eXBpbmdzXG4gICAgICAgICAgICAgICAgdGhpcy5hcHBlbmRDaGlsZCh0aGlzLiQkLnNsb3R0ZWRba2V5XSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgYXR0cmlidXRlQ2hhbmdlZENhbGxiYWNrKGF0dHIsIF9vbGRWYWx1ZSwgbmV3VmFsdWUpIHtcbiAgICAgICAgICAgIHRoaXNbYXR0cl0gPSBuZXdWYWx1ZTtcbiAgICAgICAgfVxuICAgICAgICAkZGVzdHJveSgpIHtcbiAgICAgICAgICAgIGRlc3Ryb3lfY29tcG9uZW50KHRoaXMsIDEpO1xuICAgICAgICAgICAgdGhpcy4kZGVzdHJveSA9IG5vb3A7XG4gICAgICAgIH1cbiAgICAgICAgJG9uKHR5cGUsIGNhbGxiYWNrKSB7XG4gICAgICAgICAgICAvLyBUT0RPIHNob3VsZCB0aGlzIGRlbGVnYXRlIHRvIGFkZEV2ZW50TGlzdGVuZXI/XG4gICAgICAgICAgICBjb25zdCBjYWxsYmFja3MgPSAodGhpcy4kJC5jYWxsYmFja3NbdHlwZV0gfHwgKHRoaXMuJCQuY2FsbGJhY2tzW3R5cGVdID0gW10pKTtcbiAgICAgICAgICAgIGNhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKTtcbiAgICAgICAgICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgaW5kZXggPSBjYWxsYmFja3MuaW5kZXhPZihjYWxsYmFjayk7XG4gICAgICAgICAgICAgICAgaWYgKGluZGV4ICE9PSAtMSlcbiAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2tzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgICRzZXQoKSB7XG4gICAgICAgICAgICAvLyBvdmVycmlkZGVuIGJ5IGluc3RhbmNlLCBpZiBpdCBoYXMgcHJvcHNcbiAgICAgICAgfVxuICAgIH07XG59XG5jbGFzcyBTdmVsdGVDb21wb25lbnQge1xuICAgICRkZXN0cm95KCkge1xuICAgICAgICBkZXN0cm95X2NvbXBvbmVudCh0aGlzLCAxKTtcbiAgICAgICAgdGhpcy4kZGVzdHJveSA9IG5vb3A7XG4gICAgfVxuICAgICRvbih0eXBlLCBjYWxsYmFjaykge1xuICAgICAgICBjb25zdCBjYWxsYmFja3MgPSAodGhpcy4kJC5jYWxsYmFja3NbdHlwZV0gfHwgKHRoaXMuJCQuY2FsbGJhY2tzW3R5cGVdID0gW10pKTtcbiAgICAgICAgY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spO1xuICAgICAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgaW5kZXggPSBjYWxsYmFja3MuaW5kZXhPZihjYWxsYmFjayk7XG4gICAgICAgICAgICBpZiAoaW5kZXggIT09IC0xKVxuICAgICAgICAgICAgICAgIGNhbGxiYWNrcy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICB9O1xuICAgIH1cbiAgICAkc2V0KCkge1xuICAgICAgICAvLyBvdmVycmlkZGVuIGJ5IGluc3RhbmNlLCBpZiBpdCBoYXMgcHJvcHNcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGRpc3BhdGNoX2Rldih0eXBlLCBkZXRhaWwpIHtcbiAgICBkb2N1bWVudC5kaXNwYXRjaEV2ZW50KGN1c3RvbV9ldmVudCh0eXBlLCBPYmplY3QuYXNzaWduKHsgdmVyc2lvbjogJzMuMjMuMCcgfSwgZGV0YWlsKSkpO1xufVxuZnVuY3Rpb24gYXBwZW5kX2Rldih0YXJnZXQsIG5vZGUpIHtcbiAgICBkaXNwYXRjaF9kZXYoXCJTdmVsdGVET01JbnNlcnRcIiwgeyB0YXJnZXQsIG5vZGUgfSk7XG4gICAgYXBwZW5kKHRhcmdldCwgbm9kZSk7XG59XG5mdW5jdGlvbiBpbnNlcnRfZGV2KHRhcmdldCwgbm9kZSwgYW5jaG9yKSB7XG4gICAgZGlzcGF0Y2hfZGV2KFwiU3ZlbHRlRE9NSW5zZXJ0XCIsIHsgdGFyZ2V0LCBub2RlLCBhbmNob3IgfSk7XG4gICAgaW5zZXJ0KHRhcmdldCwgbm9kZSwgYW5jaG9yKTtcbn1cbmZ1bmN0aW9uIGRldGFjaF9kZXYobm9kZSkge1xuICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVJlbW92ZVwiLCB7IG5vZGUgfSk7XG4gICAgZGV0YWNoKG5vZGUpO1xufVxuZnVuY3Rpb24gZGV0YWNoX2JldHdlZW5fZGV2KGJlZm9yZSwgYWZ0ZXIpIHtcbiAgICB3aGlsZSAoYmVmb3JlLm5leHRTaWJsaW5nICYmIGJlZm9yZS5uZXh0U2libGluZyAhPT0gYWZ0ZXIpIHtcbiAgICAgICAgZGV0YWNoX2RldihiZWZvcmUubmV4dFNpYmxpbmcpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIGRldGFjaF9iZWZvcmVfZGV2KGFmdGVyKSB7XG4gICAgd2hpbGUgKGFmdGVyLnByZXZpb3VzU2libGluZykge1xuICAgICAgICBkZXRhY2hfZGV2KGFmdGVyLnByZXZpb3VzU2libGluZyk7XG4gICAgfVxufVxuZnVuY3Rpb24gZGV0YWNoX2FmdGVyX2RldihiZWZvcmUpIHtcbiAgICB3aGlsZSAoYmVmb3JlLm5leHRTaWJsaW5nKSB7XG4gICAgICAgIGRldGFjaF9kZXYoYmVmb3JlLm5leHRTaWJsaW5nKTtcbiAgICB9XG59XG5mdW5jdGlvbiBsaXN0ZW5fZGV2KG5vZGUsIGV2ZW50LCBoYW5kbGVyLCBvcHRpb25zLCBoYXNfcHJldmVudF9kZWZhdWx0LCBoYXNfc3RvcF9wcm9wYWdhdGlvbikge1xuICAgIGNvbnN0IG1vZGlmaWVycyA9IG9wdGlvbnMgPT09IHRydWUgPyBbXCJjYXB0dXJlXCJdIDogb3B0aW9ucyA/IEFycmF5LmZyb20oT2JqZWN0LmtleXMob3B0aW9ucykpIDogW107XG4gICAgaWYgKGhhc19wcmV2ZW50X2RlZmF1bHQpXG4gICAgICAgIG1vZGlmaWVycy5wdXNoKCdwcmV2ZW50RGVmYXVsdCcpO1xuICAgIGlmIChoYXNfc3RvcF9wcm9wYWdhdGlvbilcbiAgICAgICAgbW9kaWZpZXJzLnB1c2goJ3N0b3BQcm9wYWdhdGlvbicpO1xuICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTUFkZEV2ZW50TGlzdGVuZXJcIiwgeyBub2RlLCBldmVudCwgaGFuZGxlciwgbW9kaWZpZXJzIH0pO1xuICAgIGNvbnN0IGRpc3Bvc2UgPSBsaXN0ZW4obm9kZSwgZXZlbnQsIGhhbmRsZXIsIG9wdGlvbnMpO1xuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTVJlbW92ZUV2ZW50TGlzdGVuZXJcIiwgeyBub2RlLCBldmVudCwgaGFuZGxlciwgbW9kaWZpZXJzIH0pO1xuICAgICAgICBkaXNwb3NlKCk7XG4gICAgfTtcbn1cbmZ1bmN0aW9uIGF0dHJfZGV2KG5vZGUsIGF0dHJpYnV0ZSwgdmFsdWUpIHtcbiAgICBhdHRyKG5vZGUsIGF0dHJpYnV0ZSwgdmFsdWUpO1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKVxuICAgICAgICBkaXNwYXRjaF9kZXYoXCJTdmVsdGVET01SZW1vdmVBdHRyaWJ1dGVcIiwgeyBub2RlLCBhdHRyaWJ1dGUgfSk7XG4gICAgZWxzZVxuICAgICAgICBkaXNwYXRjaF9kZXYoXCJTdmVsdGVET01TZXRBdHRyaWJ1dGVcIiwgeyBub2RlLCBhdHRyaWJ1dGUsIHZhbHVlIH0pO1xufVxuZnVuY3Rpb24gcHJvcF9kZXYobm9kZSwgcHJvcGVydHksIHZhbHVlKSB7XG4gICAgbm9kZVtwcm9wZXJ0eV0gPSB2YWx1ZTtcbiAgICBkaXNwYXRjaF9kZXYoXCJTdmVsdGVET01TZXRQcm9wZXJ0eVwiLCB7IG5vZGUsIHByb3BlcnR5LCB2YWx1ZSB9KTtcbn1cbmZ1bmN0aW9uIGRhdGFzZXRfZGV2KG5vZGUsIHByb3BlcnR5LCB2YWx1ZSkge1xuICAgIG5vZGUuZGF0YXNldFtwcm9wZXJ0eV0gPSB2YWx1ZTtcbiAgICBkaXNwYXRjaF9kZXYoXCJTdmVsdGVET01TZXREYXRhc2V0XCIsIHsgbm9kZSwgcHJvcGVydHksIHZhbHVlIH0pO1xufVxuZnVuY3Rpb24gc2V0X2RhdGFfZGV2KHRleHQsIGRhdGEpIHtcbiAgICBkYXRhID0gJycgKyBkYXRhO1xuICAgIGlmICh0ZXh0LmRhdGEgPT09IGRhdGEpXG4gICAgICAgIHJldHVybjtcbiAgICBkaXNwYXRjaF9kZXYoXCJTdmVsdGVET01TZXREYXRhXCIsIHsgbm9kZTogdGV4dCwgZGF0YSB9KTtcbiAgICB0ZXh0LmRhdGEgPSBkYXRhO1xufVxuZnVuY3Rpb24gdmFsaWRhdGVfZWFjaF9hcmd1bWVudChhcmcpIHtcbiAgICBpZiAodHlwZW9mIGFyZyAhPT0gJ3N0cmluZycgJiYgIShhcmcgJiYgdHlwZW9mIGFyZyA9PT0gJ29iamVjdCcgJiYgJ2xlbmd0aCcgaW4gYXJnKSkge1xuICAgICAgICBsZXQgbXNnID0gJ3sjZWFjaH0gb25seSBpdGVyYXRlcyBvdmVyIGFycmF5LWxpa2Ugb2JqZWN0cy4nO1xuICAgICAgICBpZiAodHlwZW9mIFN5bWJvbCA9PT0gJ2Z1bmN0aW9uJyAmJiBhcmcgJiYgU3ltYm9sLml0ZXJhdG9yIGluIGFyZykge1xuICAgICAgICAgICAgbXNnICs9ICcgWW91IGNhbiB1c2UgYSBzcHJlYWQgdG8gY29udmVydCB0aGlzIGl0ZXJhYmxlIGludG8gYW4gYXJyYXkuJztcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICB9XG59XG5mdW5jdGlvbiB2YWxpZGF0ZV9zbG90cyhuYW1lLCBzbG90LCBrZXlzKSB7XG4gICAgZm9yIChjb25zdCBzbG90X2tleSBvZiBPYmplY3Qua2V5cyhzbG90KSkge1xuICAgICAgICBpZiAoIX5rZXlzLmluZGV4T2Yoc2xvdF9rZXkpKSB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYDwke25hbWV9PiByZWNlaXZlZCBhbiB1bmV4cGVjdGVkIHNsb3QgXCIke3Nsb3Rfa2V5fVwiLmApO1xuICAgICAgICB9XG4gICAgfVxufVxuY2xhc3MgU3ZlbHRlQ29tcG9uZW50RGV2IGV4dGVuZHMgU3ZlbHRlQ29tcG9uZW50IHtcbiAgICBjb25zdHJ1Y3RvcihvcHRpb25zKSB7XG4gICAgICAgIGlmICghb3B0aW9ucyB8fCAoIW9wdGlvbnMudGFyZ2V0ICYmICFvcHRpb25zLiQkaW5saW5lKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAndGFyZ2V0JyBpcyBhIHJlcXVpcmVkIG9wdGlvbmApO1xuICAgICAgICB9XG4gICAgICAgIHN1cGVyKCk7XG4gICAgfVxuICAgICRkZXN0cm95KCkge1xuICAgICAgICBzdXBlci4kZGVzdHJveSgpO1xuICAgICAgICB0aGlzLiRkZXN0cm95ID0gKCkgPT4ge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKGBDb21wb25lbnQgd2FzIGFscmVhZHkgZGVzdHJveWVkYCk7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tY29uc29sZVxuICAgICAgICB9O1xuICAgIH1cbiAgICAkY2FwdHVyZV9zdGF0ZSgpIHsgfVxuICAgICRpbmplY3Rfc3RhdGUoKSB7IH1cbn1cbmZ1bmN0aW9uIGxvb3BfZ3VhcmQodGltZW91dCkge1xuICAgIGNvbnN0IHN0YXJ0ID0gRGF0ZS5ub3coKTtcbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgICBpZiAoRGF0ZS5ub3coKSAtIHN0YXJ0ID4gdGltZW91dCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbmZpbml0ZSBsb29wIGRldGVjdGVkYCk7XG4gICAgICAgIH1cbiAgICB9O1xufVxuXG5leHBvcnQgeyBIdG1sVGFnLCBTdmVsdGVDb21wb25lbnQsIFN2ZWx0ZUNvbXBvbmVudERldiwgU3ZlbHRlRWxlbWVudCwgYWN0aW9uX2Rlc3Ryb3llciwgYWRkX2F0dHJpYnV0ZSwgYWRkX2NsYXNzZXMsIGFkZF9mbHVzaF9jYWxsYmFjaywgYWRkX2xvY2F0aW9uLCBhZGRfcmVuZGVyX2NhbGxiYWNrLCBhZGRfcmVzaXplX2xpc3RlbmVyLCBhZGRfdHJhbnNmb3JtLCBhZnRlclVwZGF0ZSwgYXBwZW5kLCBhcHBlbmRfZGV2LCBhc3NpZ24sIGF0dHIsIGF0dHJfZGV2LCBiZWZvcmVVcGRhdGUsIGJpbmQsIGJpbmRpbmdfY2FsbGJhY2tzLCBibGFua19vYmplY3QsIGJ1YmJsZSwgY2hlY2tfb3V0cm9zLCBjaGlsZHJlbiwgY2xhaW1fY29tcG9uZW50LCBjbGFpbV9lbGVtZW50LCBjbGFpbV9zcGFjZSwgY2xhaW1fdGV4dCwgY2xlYXJfbG9vcHMsIGNvbXBvbmVudF9zdWJzY3JpYmUsIGNvbXB1dGVfcmVzdF9wcm9wcywgY3JlYXRlRXZlbnREaXNwYXRjaGVyLCBjcmVhdGVfYW5pbWF0aW9uLCBjcmVhdGVfYmlkaXJlY3Rpb25hbF90cmFuc2l0aW9uLCBjcmVhdGVfY29tcG9uZW50LCBjcmVhdGVfaW5fdHJhbnNpdGlvbiwgY3JlYXRlX291dF90cmFuc2l0aW9uLCBjcmVhdGVfc2xvdCwgY3JlYXRlX3Nzcl9jb21wb25lbnQsIGN1cnJlbnRfY29tcG9uZW50LCBjdXN0b21fZXZlbnQsIGRhdGFzZXRfZGV2LCBkZWJ1ZywgZGVzdHJveV9ibG9jaywgZGVzdHJveV9jb21wb25lbnQsIGRlc3Ryb3lfZWFjaCwgZGV0YWNoLCBkZXRhY2hfYWZ0ZXJfZGV2LCBkZXRhY2hfYmVmb3JlX2RldiwgZGV0YWNoX2JldHdlZW5fZGV2LCBkZXRhY2hfZGV2LCBkaXJ0eV9jb21wb25lbnRzLCBkaXNwYXRjaF9kZXYsIGVhY2gsIGVsZW1lbnQsIGVsZW1lbnRfaXMsIGVtcHR5LCBlc2NhcGUsIGVzY2FwZWQsIGV4Y2x1ZGVfaW50ZXJuYWxfcHJvcHMsIGZpeF9hbmRfZGVzdHJveV9ibG9jaywgZml4X2FuZF9vdXRyb19hbmRfZGVzdHJveV9ibG9jaywgZml4X3Bvc2l0aW9uLCBmbHVzaCwgZ2V0Q29udGV4dCwgZ2V0X2JpbmRpbmdfZ3JvdXBfdmFsdWUsIGdldF9jdXJyZW50X2NvbXBvbmVudCwgZ2V0X3Nsb3RfY2hhbmdlcywgZ2V0X3Nsb3RfY29udGV4dCwgZ2V0X3NwcmVhZF9vYmplY3QsIGdldF9zcHJlYWRfdXBkYXRlLCBnZXRfc3RvcmVfdmFsdWUsIGdsb2JhbHMsIGdyb3VwX291dHJvcywgaGFuZGxlX3Byb21pc2UsIGhhc19wcm9wLCBpZGVudGl0eSwgaW5pdCwgaW5zZXJ0LCBpbnNlcnRfZGV2LCBpbnRyb3MsIGludmFsaWRfYXR0cmlidXRlX25hbWVfY2hhcmFjdGVyLCBpc19jbGllbnQsIGlzX2Nyb3Nzb3JpZ2luLCBpc19mdW5jdGlvbiwgaXNfcHJvbWlzZSwgbGlzdGVuLCBsaXN0ZW5fZGV2LCBsb29wLCBsb29wX2d1YXJkLCBtaXNzaW5nX2NvbXBvbmVudCwgbW91bnRfY29tcG9uZW50LCBub29wLCBub3RfZXF1YWwsIG5vdywgbnVsbF90b19lbXB0eSwgb2JqZWN0X3dpdGhvdXRfcHJvcGVydGllcywgb25EZXN0cm95LCBvbk1vdW50LCBvbmNlLCBvdXRyb19hbmRfZGVzdHJveV9ibG9jaywgcHJldmVudF9kZWZhdWx0LCBwcm9wX2RldiwgcXVlcnlfc2VsZWN0b3JfYWxsLCByYWYsIHJ1biwgcnVuX2FsbCwgc2FmZV9ub3RfZXF1YWwsIHNjaGVkdWxlX3VwZGF0ZSwgc2VsZWN0X211bHRpcGxlX3ZhbHVlLCBzZWxlY3Rfb3B0aW9uLCBzZWxlY3Rfb3B0aW9ucywgc2VsZWN0X3ZhbHVlLCBzZWxmLCBzZXRDb250ZXh0LCBzZXRfYXR0cmlidXRlcywgc2V0X2N1cnJlbnRfY29tcG9uZW50LCBzZXRfY3VzdG9tX2VsZW1lbnRfZGF0YSwgc2V0X2RhdGEsIHNldF9kYXRhX2Rldiwgc2V0X2lucHV0X3R5cGUsIHNldF9pbnB1dF92YWx1ZSwgc2V0X25vdywgc2V0X3JhZiwgc2V0X3N0b3JlX3ZhbHVlLCBzZXRfc3R5bGUsIHNldF9zdmdfYXR0cmlidXRlcywgc3BhY2UsIHNwcmVhZCwgc3RvcF9wcm9wYWdhdGlvbiwgc3Vic2NyaWJlLCBzdmdfZWxlbWVudCwgdGV4dCwgdGljaywgdGltZV9yYW5nZXNfdG9fYXJyYXksIHRvX251bWJlciwgdG9nZ2xlX2NsYXNzLCB0cmFuc2l0aW9uX2luLCB0cmFuc2l0aW9uX291dCwgdXBkYXRlX2tleWVkX2VhY2gsIHVwZGF0ZV9zbG90LCB2YWxpZGF0ZV9jb21wb25lbnQsIHZhbGlkYXRlX2VhY2hfYXJndW1lbnQsIHZhbGlkYXRlX2VhY2hfa2V5cywgdmFsaWRhdGVfc2xvdHMsIHZhbGlkYXRlX3N0b3JlLCB4bGlua19hdHRyIH07XG4iLCIvKipcclxuICogUGFyc2VzIGFuIFVSSVxyXG4gKlxyXG4gKiBAYXV0aG9yIFN0ZXZlbiBMZXZpdGhhbiA8c3RldmVubGV2aXRoYW4uY29tPiAoTUlUIGxpY2Vuc2UpXHJcbiAqIEBhcGkgcHJpdmF0ZVxyXG4gKi9cclxuXHJcbnZhciByZSA9IC9eKD86KD8hW146QF0rOlteOkBcXC9dKkApKGh0dHB8aHR0cHN8d3N8d3NzKTpcXC9cXC8pPygoPzooKFteOkBdKikoPzo6KFteOkBdKikpPyk/QCk/KCg/OlthLWYwLTldezAsNH06KXsyLDd9W2EtZjAtOV17MCw0fXxbXjpcXC8/I10qKSg/OjooXFxkKikpPykoKChcXC8oPzpbXj8jXSg/IVtePyNcXC9dKlxcLltePyNcXC8uXSsoPzpbPyNdfCQpKSkqXFwvPyk/KFtePyNcXC9dKikpKD86XFw/KFteI10qKSk/KD86IyguKikpPykvO1xyXG5cclxudmFyIHBhcnRzID0gW1xyXG4gICAgJ3NvdXJjZScsICdwcm90b2NvbCcsICdhdXRob3JpdHknLCAndXNlckluZm8nLCAndXNlcicsICdwYXNzd29yZCcsICdob3N0JywgJ3BvcnQnLCAncmVsYXRpdmUnLCAncGF0aCcsICdkaXJlY3RvcnknLCAnZmlsZScsICdxdWVyeScsICdhbmNob3InXHJcbl07XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIHBhcnNldXJpKHN0cikge1xyXG4gICAgdmFyIHNyYyA9IHN0cixcclxuICAgICAgICBiID0gc3RyLmluZGV4T2YoJ1snKSxcclxuICAgICAgICBlID0gc3RyLmluZGV4T2YoJ10nKTtcclxuXHJcbiAgICBpZiAoYiAhPSAtMSAmJiBlICE9IC0xKSB7XHJcbiAgICAgICAgc3RyID0gc3RyLnN1YnN0cmluZygwLCBiKSArIHN0ci5zdWJzdHJpbmcoYiwgZSkucmVwbGFjZSgvOi9nLCAnOycpICsgc3RyLnN1YnN0cmluZyhlLCBzdHIubGVuZ3RoKTtcclxuICAgIH1cclxuXHJcbiAgICB2YXIgbSA9IHJlLmV4ZWMoc3RyIHx8ICcnKSxcclxuICAgICAgICB1cmkgPSB7fSxcclxuICAgICAgICBpID0gMTQ7XHJcblxyXG4gICAgd2hpbGUgKGktLSkge1xyXG4gICAgICAgIHVyaVtwYXJ0c1tpXV0gPSBtW2ldIHx8ICcnO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChiICE9IC0xICYmIGUgIT0gLTEpIHtcclxuICAgICAgICB1cmkuc291cmNlID0gc3JjO1xyXG4gICAgICAgIHVyaS5ob3N0ID0gdXJpLmhvc3Quc3Vic3RyaW5nKDEsIHVyaS5ob3N0Lmxlbmd0aCAtIDEpLnJlcGxhY2UoLzsvZywgJzonKTtcclxuICAgICAgICB1cmkuYXV0aG9yaXR5ID0gdXJpLmF1dGhvcml0eS5yZXBsYWNlKCdbJywgJycpLnJlcGxhY2UoJ10nLCAnJykucmVwbGFjZSgvOy9nLCAnOicpO1xyXG4gICAgICAgIHVyaS5pcHY2dXJpID0gdHJ1ZTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gdXJpO1xyXG59O1xyXG4iLCJleHBvcnQgZGVmYXVsdCAodHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIiA/IGdsb2JhbCA6XG4gICAgICAgICAgICB0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOlxuICAgICAgICAgICAgdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9KTtcbiIsIi8vIHNoaW0gZm9yIHVzaW5nIHByb2Nlc3MgaW4gYnJvd3NlclxuLy8gYmFzZWQgb2ZmIGh0dHBzOi8vZ2l0aHViLmNvbS9kZWZ1bmN0em9tYmllL25vZGUtcHJvY2Vzcy9ibG9iL21hc3Rlci9icm93c2VyLmpzXG5cbmZ1bmN0aW9uIGRlZmF1bHRTZXRUaW1vdXQoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzZXRUaW1lb3V0IGhhcyBub3QgYmVlbiBkZWZpbmVkJyk7XG59XG5mdW5jdGlvbiBkZWZhdWx0Q2xlYXJUaW1lb3V0ICgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2NsZWFyVGltZW91dCBoYXMgbm90IGJlZW4gZGVmaW5lZCcpO1xufVxudmFyIGNhY2hlZFNldFRpbWVvdXQgPSBkZWZhdWx0U2V0VGltb3V0O1xudmFyIGNhY2hlZENsZWFyVGltZW91dCA9IGRlZmF1bHRDbGVhclRpbWVvdXQ7XG5pZiAodHlwZW9mIGdsb2JhbC5zZXRUaW1lb3V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgY2FjaGVkU2V0VGltZW91dCA9IHNldFRpbWVvdXQ7XG59XG5pZiAodHlwZW9mIGdsb2JhbC5jbGVhclRpbWVvdXQgPT09ICdmdW5jdGlvbicpIHtcbiAgICBjYWNoZWRDbGVhclRpbWVvdXQgPSBjbGVhclRpbWVvdXQ7XG59XG5cbmZ1bmN0aW9uIHJ1blRpbWVvdXQoZnVuKSB7XG4gICAgaWYgKGNhY2hlZFNldFRpbWVvdXQgPT09IHNldFRpbWVvdXQpIHtcbiAgICAgICAgLy9ub3JtYWwgZW52aXJvbWVudHMgaW4gc2FuZSBzaXR1YXRpb25zXG4gICAgICAgIHJldHVybiBzZXRUaW1lb3V0KGZ1biwgMCk7XG4gICAgfVxuICAgIC8vIGlmIHNldFRpbWVvdXQgd2Fzbid0IGF2YWlsYWJsZSBidXQgd2FzIGxhdHRlciBkZWZpbmVkXG4gICAgaWYgKChjYWNoZWRTZXRUaW1lb3V0ID09PSBkZWZhdWx0U2V0VGltb3V0IHx8ICFjYWNoZWRTZXRUaW1lb3V0KSAmJiBzZXRUaW1lb3V0KSB7XG4gICAgICAgIGNhY2hlZFNldFRpbWVvdXQgPSBzZXRUaW1lb3V0O1xuICAgICAgICByZXR1cm4gc2V0VGltZW91dChmdW4sIDApO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgICAvLyB3aGVuIHdoZW4gc29tZWJvZHkgaGFzIHNjcmV3ZWQgd2l0aCBzZXRUaW1lb3V0IGJ1dCBubyBJLkUuIG1hZGRuZXNzXG4gICAgICAgIHJldHVybiBjYWNoZWRTZXRUaW1lb3V0KGZ1biwgMCk7XG4gICAgfSBjYXRjaChlKXtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIFdoZW4gd2UgYXJlIGluIEkuRS4gYnV0IHRoZSBzY3JpcHQgaGFzIGJlZW4gZXZhbGVkIHNvIEkuRS4gZG9lc24ndCB0cnVzdCB0aGUgZ2xvYmFsIG9iamVjdCB3aGVuIGNhbGxlZCBub3JtYWxseVxuICAgICAgICAgICAgcmV0dXJuIGNhY2hlZFNldFRpbWVvdXQuY2FsbChudWxsLCBmdW4sIDApO1xuICAgICAgICB9IGNhdGNoKGUpe1xuICAgICAgICAgICAgLy8gc2FtZSBhcyBhYm92ZSBidXQgd2hlbiBpdCdzIGEgdmVyc2lvbiBvZiBJLkUuIHRoYXQgbXVzdCBoYXZlIHRoZSBnbG9iYWwgb2JqZWN0IGZvciAndGhpcycsIGhvcGZ1bGx5IG91ciBjb250ZXh0IGNvcnJlY3Qgb3RoZXJ3aXNlIGl0IHdpbGwgdGhyb3cgYSBnbG9iYWwgZXJyb3JcbiAgICAgICAgICAgIHJldHVybiBjYWNoZWRTZXRUaW1lb3V0LmNhbGwodGhpcywgZnVuLCAwKTtcbiAgICAgICAgfVxuICAgIH1cblxuXG59XG5mdW5jdGlvbiBydW5DbGVhclRpbWVvdXQobWFya2VyKSB7XG4gICAgaWYgKGNhY2hlZENsZWFyVGltZW91dCA9PT0gY2xlYXJUaW1lb3V0KSB7XG4gICAgICAgIC8vbm9ybWFsIGVudmlyb21lbnRzIGluIHNhbmUgc2l0dWF0aW9uc1xuICAgICAgICByZXR1cm4gY2xlYXJUaW1lb3V0KG1hcmtlcik7XG4gICAgfVxuICAgIC8vIGlmIGNsZWFyVGltZW91dCB3YXNuJ3QgYXZhaWxhYmxlIGJ1dCB3YXMgbGF0dGVyIGRlZmluZWRcbiAgICBpZiAoKGNhY2hlZENsZWFyVGltZW91dCA9PT0gZGVmYXVsdENsZWFyVGltZW91dCB8fCAhY2FjaGVkQ2xlYXJUaW1lb3V0KSAmJiBjbGVhclRpbWVvdXQpIHtcbiAgICAgICAgY2FjaGVkQ2xlYXJUaW1lb3V0ID0gY2xlYXJUaW1lb3V0O1xuICAgICAgICByZXR1cm4gY2xlYXJUaW1lb3V0KG1hcmtlcik7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICAgIC8vIHdoZW4gd2hlbiBzb21lYm9keSBoYXMgc2NyZXdlZCB3aXRoIHNldFRpbWVvdXQgYnV0IG5vIEkuRS4gbWFkZG5lc3NcbiAgICAgICAgcmV0dXJuIGNhY2hlZENsZWFyVGltZW91dChtYXJrZXIpO1xuICAgIH0gY2F0Y2ggKGUpe1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gV2hlbiB3ZSBhcmUgaW4gSS5FLiBidXQgdGhlIHNjcmlwdCBoYXMgYmVlbiBldmFsZWQgc28gSS5FLiBkb2Vzbid0ICB0cnVzdCB0aGUgZ2xvYmFsIG9iamVjdCB3aGVuIGNhbGxlZCBub3JtYWxseVxuICAgICAgICAgICAgcmV0dXJuIGNhY2hlZENsZWFyVGltZW91dC5jYWxsKG51bGwsIG1hcmtlcik7XG4gICAgICAgIH0gY2F0Y2ggKGUpe1xuICAgICAgICAgICAgLy8gc2FtZSBhcyBhYm92ZSBidXQgd2hlbiBpdCdzIGEgdmVyc2lvbiBvZiBJLkUuIHRoYXQgbXVzdCBoYXZlIHRoZSBnbG9iYWwgb2JqZWN0IGZvciAndGhpcycsIGhvcGZ1bGx5IG91ciBjb250ZXh0IGNvcnJlY3Qgb3RoZXJ3aXNlIGl0IHdpbGwgdGhyb3cgYSBnbG9iYWwgZXJyb3IuXG4gICAgICAgICAgICAvLyBTb21lIHZlcnNpb25zIG9mIEkuRS4gaGF2ZSBkaWZmZXJlbnQgcnVsZXMgZm9yIGNsZWFyVGltZW91dCB2cyBzZXRUaW1lb3V0XG4gICAgICAgICAgICByZXR1cm4gY2FjaGVkQ2xlYXJUaW1lb3V0LmNhbGwodGhpcywgbWFya2VyKTtcbiAgICAgICAgfVxuICAgIH1cblxuXG5cbn1cbnZhciBxdWV1ZSA9IFtdO1xudmFyIGRyYWluaW5nID0gZmFsc2U7XG52YXIgY3VycmVudFF1ZXVlO1xudmFyIHF1ZXVlSW5kZXggPSAtMTtcblxuZnVuY3Rpb24gY2xlYW5VcE5leHRUaWNrKCkge1xuICAgIGlmICghZHJhaW5pbmcgfHwgIWN1cnJlbnRRdWV1ZSkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgaWYgKGN1cnJlbnRRdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgcXVldWUgPSBjdXJyZW50UXVldWUuY29uY2F0KHF1ZXVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgfVxuICAgIGlmIChxdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgZHJhaW5RdWV1ZSgpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZHJhaW5RdWV1ZSgpIHtcbiAgICBpZiAoZHJhaW5pbmcpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgdGltZW91dCA9IHJ1blRpbWVvdXQoY2xlYW5VcE5leHRUaWNrKTtcbiAgICBkcmFpbmluZyA9IHRydWU7XG5cbiAgICB2YXIgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIHdoaWxlKGxlbikge1xuICAgICAgICBjdXJyZW50UXVldWUgPSBxdWV1ZTtcbiAgICAgICAgcXVldWUgPSBbXTtcbiAgICAgICAgd2hpbGUgKCsrcXVldWVJbmRleCA8IGxlbikge1xuICAgICAgICAgICAgaWYgKGN1cnJlbnRRdWV1ZSkge1xuICAgICAgICAgICAgICAgIGN1cnJlbnRRdWV1ZVtxdWV1ZUluZGV4XS5ydW4oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgICAgIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgICB9XG4gICAgY3VycmVudFF1ZXVlID0gbnVsbDtcbiAgICBkcmFpbmluZyA9IGZhbHNlO1xuICAgIHJ1bkNsZWFyVGltZW91dCh0aW1lb3V0KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBuZXh0VGljayhmdW4pIHtcbiAgICB2YXIgYXJncyA9IG5ldyBBcnJheShhcmd1bWVudHMubGVuZ3RoIC0gMSk7XG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAxOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBxdWV1ZS5wdXNoKG5ldyBJdGVtKGZ1biwgYXJncykpO1xuICAgIGlmIChxdWV1ZS5sZW5ndGggPT09IDEgJiYgIWRyYWluaW5nKSB7XG4gICAgICAgIHJ1blRpbWVvdXQoZHJhaW5RdWV1ZSk7XG4gICAgfVxufVxuLy8gdjggbGlrZXMgcHJlZGljdGlibGUgb2JqZWN0c1xuZnVuY3Rpb24gSXRlbShmdW4sIGFycmF5KSB7XG4gICAgdGhpcy5mdW4gPSBmdW47XG4gICAgdGhpcy5hcnJheSA9IGFycmF5O1xufVxuSXRlbS5wcm90b3R5cGUucnVuID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuZnVuLmFwcGx5KG51bGwsIHRoaXMuYXJyYXkpO1xufTtcbmV4cG9ydCB2YXIgdGl0bGUgPSAnYnJvd3Nlcic7XG5leHBvcnQgdmFyIHBsYXRmb3JtID0gJ2Jyb3dzZXInO1xuZXhwb3J0IHZhciBicm93c2VyID0gdHJ1ZTtcbmV4cG9ydCB2YXIgZW52ID0ge307XG5leHBvcnQgdmFyIGFyZ3YgPSBbXTtcbmV4cG9ydCB2YXIgdmVyc2lvbiA9ICcnOyAvLyBlbXB0eSBzdHJpbmcgdG8gYXZvaWQgcmVnZXhwIGlzc3Vlc1xuZXhwb3J0IHZhciB2ZXJzaW9ucyA9IHt9O1xuZXhwb3J0IHZhciByZWxlYXNlID0ge307XG5leHBvcnQgdmFyIGNvbmZpZyA9IHt9O1xuXG5mdW5jdGlvbiBub29wKCkge31cblxuZXhwb3J0IHZhciBvbiA9IG5vb3A7XG5leHBvcnQgdmFyIGFkZExpc3RlbmVyID0gbm9vcDtcbmV4cG9ydCB2YXIgb25jZSA9IG5vb3A7XG5leHBvcnQgdmFyIG9mZiA9IG5vb3A7XG5leHBvcnQgdmFyIHJlbW92ZUxpc3RlbmVyID0gbm9vcDtcbmV4cG9ydCB2YXIgcmVtb3ZlQWxsTGlzdGVuZXJzID0gbm9vcDtcbmV4cG9ydCB2YXIgZW1pdCA9IG5vb3A7XG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kaW5nKG5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuYmluZGluZyBpcyBub3Qgc3VwcG9ydGVkJyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjd2QgKCkgeyByZXR1cm4gJy8nIH1cbmV4cG9ydCBmdW5jdGlvbiBjaGRpciAoZGlyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmNoZGlyIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5leHBvcnQgZnVuY3Rpb24gdW1hc2soKSB7IHJldHVybiAwOyB9XG5cbi8vIGZyb20gaHR0cHM6Ly9naXRodWIuY29tL2t1bWF2aXMvYnJvd3Nlci1wcm9jZXNzLWhydGltZS9ibG9iL21hc3Rlci9pbmRleC5qc1xudmFyIHBlcmZvcm1hbmNlID0gZ2xvYmFsLnBlcmZvcm1hbmNlIHx8IHt9XG52YXIgcGVyZm9ybWFuY2VOb3cgPVxuICBwZXJmb3JtYW5jZS5ub3cgICAgICAgIHx8XG4gIHBlcmZvcm1hbmNlLm1vek5vdyAgICAgfHxcbiAgcGVyZm9ybWFuY2UubXNOb3cgICAgICB8fFxuICBwZXJmb3JtYW5jZS5vTm93ICAgICAgIHx8XG4gIHBlcmZvcm1hbmNlLndlYmtpdE5vdyAgfHxcbiAgZnVuY3Rpb24oKXsgcmV0dXJuIChuZXcgRGF0ZSgpKS5nZXRUaW1lKCkgfVxuXG4vLyBnZW5lcmF0ZSB0aW1lc3RhbXAgb3IgZGVsdGFcbi8vIHNlZSBodHRwOi8vbm9kZWpzLm9yZy9hcGkvcHJvY2Vzcy5odG1sI3Byb2Nlc3NfcHJvY2Vzc19ocnRpbWVcbmV4cG9ydCBmdW5jdGlvbiBocnRpbWUocHJldmlvdXNUaW1lc3RhbXApe1xuICB2YXIgY2xvY2t0aW1lID0gcGVyZm9ybWFuY2VOb3cuY2FsbChwZXJmb3JtYW5jZSkqMWUtM1xuICB2YXIgc2Vjb25kcyA9IE1hdGguZmxvb3IoY2xvY2t0aW1lKVxuICB2YXIgbmFub3NlY29uZHMgPSBNYXRoLmZsb29yKChjbG9ja3RpbWUlMSkqMWU5KVxuICBpZiAocHJldmlvdXNUaW1lc3RhbXApIHtcbiAgICBzZWNvbmRzID0gc2Vjb25kcyAtIHByZXZpb3VzVGltZXN0YW1wWzBdXG4gICAgbmFub3NlY29uZHMgPSBuYW5vc2Vjb25kcyAtIHByZXZpb3VzVGltZXN0YW1wWzFdXG4gICAgaWYgKG5hbm9zZWNvbmRzPDApIHtcbiAgICAgIHNlY29uZHMtLVxuICAgICAgbmFub3NlY29uZHMgKz0gMWU5XG4gICAgfVxuICB9XG4gIHJldHVybiBbc2Vjb25kcyxuYW5vc2Vjb25kc11cbn1cblxudmFyIHN0YXJ0VGltZSA9IG5ldyBEYXRlKCk7XG5leHBvcnQgZnVuY3Rpb24gdXB0aW1lKCkge1xuICB2YXIgY3VycmVudFRpbWUgPSBuZXcgRGF0ZSgpO1xuICB2YXIgZGlmID0gY3VycmVudFRpbWUgLSBzdGFydFRpbWU7XG4gIHJldHVybiBkaWYgLyAxMDAwO1xufVxuXG5leHBvcnQgZGVmYXVsdCB7XG4gIG5leHRUaWNrOiBuZXh0VGljayxcbiAgdGl0bGU6IHRpdGxlLFxuICBicm93c2VyOiBicm93c2VyLFxuICBlbnY6IGVudixcbiAgYXJndjogYXJndixcbiAgdmVyc2lvbjogdmVyc2lvbixcbiAgdmVyc2lvbnM6IHZlcnNpb25zLFxuICBvbjogb24sXG4gIGFkZExpc3RlbmVyOiBhZGRMaXN0ZW5lcixcbiAgb25jZTogb25jZSxcbiAgb2ZmOiBvZmYsXG4gIHJlbW92ZUxpc3RlbmVyOiByZW1vdmVMaXN0ZW5lcixcbiAgcmVtb3ZlQWxsTGlzdGVuZXJzOiByZW1vdmVBbGxMaXN0ZW5lcnMsXG4gIGVtaXQ6IGVtaXQsXG4gIGJpbmRpbmc6IGJpbmRpbmcsXG4gIGN3ZDogY3dkLFxuICBjaGRpcjogY2hkaXIsXG4gIHVtYXNrOiB1bWFzayxcbiAgaHJ0aW1lOiBocnRpbWUsXG4gIHBsYXRmb3JtOiBwbGF0Zm9ybSxcbiAgcmVsZWFzZTogcmVsZWFzZSxcbiAgY29uZmlnOiBjb25maWcsXG4gIHVwdGltZTogdXB0aW1lXG59O1xuIiwiLyoqXG4gKiBIZWxwZXJzLlxuICovXG5cbnZhciBzID0gMTAwMDtcbnZhciBtID0gcyAqIDYwO1xudmFyIGggPSBtICogNjA7XG52YXIgZCA9IGggKiAyNDtcbnZhciB3ID0gZCAqIDc7XG52YXIgeSA9IGQgKiAzNjUuMjU7XG5cbi8qKlxuICogUGFyc2Ugb3IgZm9ybWF0IHRoZSBnaXZlbiBgdmFsYC5cbiAqXG4gKiBPcHRpb25zOlxuICpcbiAqICAtIGBsb25nYCB2ZXJib3NlIGZvcm1hdHRpbmcgW2ZhbHNlXVxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfE51bWJlcn0gdmFsXG4gKiBAcGFyYW0ge09iamVjdH0gW29wdGlvbnNdXG4gKiBAdGhyb3dzIHtFcnJvcn0gdGhyb3cgYW4gZXJyb3IgaWYgdmFsIGlzIG5vdCBhIG5vbi1lbXB0eSBzdHJpbmcgb3IgYSBudW1iZXJcbiAqIEByZXR1cm4ge1N0cmluZ3xOdW1iZXJ9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24odmFsLCBvcHRpb25zKSB7XG4gIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuICB2YXIgdHlwZSA9IHR5cGVvZiB2YWw7XG4gIGlmICh0eXBlID09PSAnc3RyaW5nJyAmJiB2YWwubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiBwYXJzZSh2YWwpO1xuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdudW1iZXInICYmIGlzRmluaXRlKHZhbCkpIHtcbiAgICByZXR1cm4gb3B0aW9ucy5sb25nID8gZm10TG9uZyh2YWwpIDogZm10U2hvcnQodmFsKTtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgJ3ZhbCBpcyBub3QgYSBub24tZW1wdHkgc3RyaW5nIG9yIGEgdmFsaWQgbnVtYmVyLiB2YWw9JyArXG4gICAgICBKU09OLnN0cmluZ2lmeSh2YWwpXG4gICk7XG59O1xuXG4vKipcbiAqIFBhcnNlIHRoZSBnaXZlbiBgc3RyYCBhbmQgcmV0dXJuIG1pbGxpc2Vjb25kcy5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXG4gKiBAcmV0dXJuIHtOdW1iZXJ9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBwYXJzZShzdHIpIHtcbiAgc3RyID0gU3RyaW5nKHN0cik7XG4gIGlmIChzdHIubGVuZ3RoID4gMTAwKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIHZhciBtYXRjaCA9IC9eKC0/KD86XFxkKyk/XFwuP1xcZCspICoobWlsbGlzZWNvbmRzP3xtc2Vjcz98bXN8c2Vjb25kcz98c2Vjcz98c3xtaW51dGVzP3xtaW5zP3xtfGhvdXJzP3xocnM/fGh8ZGF5cz98ZHx3ZWVrcz98d3x5ZWFycz98eXJzP3x5KT8kL2kuZXhlYyhcbiAgICBzdHJcbiAgKTtcbiAgaWYgKCFtYXRjaCkge1xuICAgIHJldHVybjtcbiAgfVxuICB2YXIgbiA9IHBhcnNlRmxvYXQobWF0Y2hbMV0pO1xuICB2YXIgdHlwZSA9IChtYXRjaFsyXSB8fCAnbXMnKS50b0xvd2VyQ2FzZSgpO1xuICBzd2l0Y2ggKHR5cGUpIHtcbiAgICBjYXNlICd5ZWFycyc6XG4gICAgY2FzZSAneWVhcic6XG4gICAgY2FzZSAneXJzJzpcbiAgICBjYXNlICd5cic6XG4gICAgY2FzZSAneSc6XG4gICAgICByZXR1cm4gbiAqIHk7XG4gICAgY2FzZSAnd2Vla3MnOlxuICAgIGNhc2UgJ3dlZWsnOlxuICAgIGNhc2UgJ3cnOlxuICAgICAgcmV0dXJuIG4gKiB3O1xuICAgIGNhc2UgJ2RheXMnOlxuICAgIGNhc2UgJ2RheSc6XG4gICAgY2FzZSAnZCc6XG4gICAgICByZXR1cm4gbiAqIGQ7XG4gICAgY2FzZSAnaG91cnMnOlxuICAgIGNhc2UgJ2hvdXInOlxuICAgIGNhc2UgJ2hycyc6XG4gICAgY2FzZSAnaHInOlxuICAgIGNhc2UgJ2gnOlxuICAgICAgcmV0dXJuIG4gKiBoO1xuICAgIGNhc2UgJ21pbnV0ZXMnOlxuICAgIGNhc2UgJ21pbnV0ZSc6XG4gICAgY2FzZSAnbWlucyc6XG4gICAgY2FzZSAnbWluJzpcbiAgICBjYXNlICdtJzpcbiAgICAgIHJldHVybiBuICogbTtcbiAgICBjYXNlICdzZWNvbmRzJzpcbiAgICBjYXNlICdzZWNvbmQnOlxuICAgIGNhc2UgJ3NlY3MnOlxuICAgIGNhc2UgJ3NlYyc6XG4gICAgY2FzZSAncyc6XG4gICAgICByZXR1cm4gbiAqIHM7XG4gICAgY2FzZSAnbWlsbGlzZWNvbmRzJzpcbiAgICBjYXNlICdtaWxsaXNlY29uZCc6XG4gICAgY2FzZSAnbXNlY3MnOlxuICAgIGNhc2UgJ21zZWMnOlxuICAgIGNhc2UgJ21zJzpcbiAgICAgIHJldHVybiBuO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG59XG5cbi8qKlxuICogU2hvcnQgZm9ybWF0IGZvciBgbXNgLlxuICpcbiAqIEBwYXJhbSB7TnVtYmVyfSBtc1xuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gZm10U2hvcnQobXMpIHtcbiAgdmFyIG1zQWJzID0gTWF0aC5hYnMobXMpO1xuICBpZiAobXNBYnMgPj0gZCkge1xuICAgIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gZCkgKyAnZCc7XG4gIH1cbiAgaWYgKG1zQWJzID49IGgpIHtcbiAgICByZXR1cm4gTWF0aC5yb3VuZChtcyAvIGgpICsgJ2gnO1xuICB9XG4gIGlmIChtc0FicyA+PSBtKSB7XG4gICAgcmV0dXJuIE1hdGgucm91bmQobXMgLyBtKSArICdtJztcbiAgfVxuICBpZiAobXNBYnMgPj0gcykge1xuICAgIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gcykgKyAncyc7XG4gIH1cbiAgcmV0dXJuIG1zICsgJ21zJztcbn1cblxuLyoqXG4gKiBMb25nIGZvcm1hdCBmb3IgYG1zYC5cbiAqXG4gKiBAcGFyYW0ge051bWJlcn0gbXNcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGZtdExvbmcobXMpIHtcbiAgdmFyIG1zQWJzID0gTWF0aC5hYnMobXMpO1xuICBpZiAobXNBYnMgPj0gZCkge1xuICAgIHJldHVybiBwbHVyYWwobXMsIG1zQWJzLCBkLCAnZGF5Jyk7XG4gIH1cbiAgaWYgKG1zQWJzID49IGgpIHtcbiAgICByZXR1cm4gcGx1cmFsKG1zLCBtc0FicywgaCwgJ2hvdXInKTtcbiAgfVxuICBpZiAobXNBYnMgPj0gbSkge1xuICAgIHJldHVybiBwbHVyYWwobXMsIG1zQWJzLCBtLCAnbWludXRlJyk7XG4gIH1cbiAgaWYgKG1zQWJzID49IHMpIHtcbiAgICByZXR1cm4gcGx1cmFsKG1zLCBtc0FicywgcywgJ3NlY29uZCcpO1xuICB9XG4gIHJldHVybiBtcyArICcgbXMnO1xufVxuXG4vKipcbiAqIFBsdXJhbGl6YXRpb24gaGVscGVyLlxuICovXG5cbmZ1bmN0aW9uIHBsdXJhbChtcywgbXNBYnMsIG4sIG5hbWUpIHtcbiAgdmFyIGlzUGx1cmFsID0gbXNBYnMgPj0gbiAqIDEuNTtcbiAgcmV0dXJuIE1hdGgucm91bmQobXMgLyBuKSArICcgJyArIG5hbWUgKyAoaXNQbHVyYWwgPyAncycgOiAnJyk7XG59XG4iLCJcbi8qKlxuICogVGhpcyBpcyB0aGUgY29tbW9uIGxvZ2ljIGZvciBib3RoIHRoZSBOb2RlLmpzIGFuZCB3ZWIgYnJvd3NlclxuICogaW1wbGVtZW50YXRpb25zIG9mIGBkZWJ1ZygpYC5cbiAqL1xuXG5mdW5jdGlvbiBzZXR1cChlbnYpIHtcblx0Y3JlYXRlRGVidWcuZGVidWcgPSBjcmVhdGVEZWJ1Zztcblx0Y3JlYXRlRGVidWcuZGVmYXVsdCA9IGNyZWF0ZURlYnVnO1xuXHRjcmVhdGVEZWJ1Zy5jb2VyY2UgPSBjb2VyY2U7XG5cdGNyZWF0ZURlYnVnLmRpc2FibGUgPSBkaXNhYmxlO1xuXHRjcmVhdGVEZWJ1Zy5lbmFibGUgPSBlbmFibGU7XG5cdGNyZWF0ZURlYnVnLmVuYWJsZWQgPSBlbmFibGVkO1xuXHRjcmVhdGVEZWJ1Zy5odW1hbml6ZSA9IHJlcXVpcmUoJ21zJyk7XG5cblx0T2JqZWN0LmtleXMoZW52KS5mb3JFYWNoKGtleSA9PiB7XG5cdFx0Y3JlYXRlRGVidWdba2V5XSA9IGVudltrZXldO1xuXHR9KTtcblxuXHQvKipcblx0KiBBY3RpdmUgYGRlYnVnYCBpbnN0YW5jZXMuXG5cdCovXG5cdGNyZWF0ZURlYnVnLmluc3RhbmNlcyA9IFtdO1xuXG5cdC8qKlxuXHQqIFRoZSBjdXJyZW50bHkgYWN0aXZlIGRlYnVnIG1vZGUgbmFtZXMsIGFuZCBuYW1lcyB0byBza2lwLlxuXHQqL1xuXG5cdGNyZWF0ZURlYnVnLm5hbWVzID0gW107XG5cdGNyZWF0ZURlYnVnLnNraXBzID0gW107XG5cblx0LyoqXG5cdCogTWFwIG9mIHNwZWNpYWwgXCIlblwiIGhhbmRsaW5nIGZ1bmN0aW9ucywgZm9yIHRoZSBkZWJ1ZyBcImZvcm1hdFwiIGFyZ3VtZW50LlxuXHQqXG5cdCogVmFsaWQga2V5IG5hbWVzIGFyZSBhIHNpbmdsZSwgbG93ZXIgb3IgdXBwZXItY2FzZSBsZXR0ZXIsIGkuZS4gXCJuXCIgYW5kIFwiTlwiLlxuXHQqL1xuXHRjcmVhdGVEZWJ1Zy5mb3JtYXR0ZXJzID0ge307XG5cblx0LyoqXG5cdCogU2VsZWN0cyBhIGNvbG9yIGZvciBhIGRlYnVnIG5hbWVzcGFjZVxuXHQqIEBwYXJhbSB7U3RyaW5nfSBuYW1lc3BhY2UgVGhlIG5hbWVzcGFjZSBzdHJpbmcgZm9yIHRoZSBmb3IgdGhlIGRlYnVnIGluc3RhbmNlIHRvIGJlIGNvbG9yZWRcblx0KiBAcmV0dXJuIHtOdW1iZXJ8U3RyaW5nfSBBbiBBTlNJIGNvbG9yIGNvZGUgZm9yIHRoZSBnaXZlbiBuYW1lc3BhY2Vcblx0KiBAYXBpIHByaXZhdGVcblx0Ki9cblx0ZnVuY3Rpb24gc2VsZWN0Q29sb3IobmFtZXNwYWNlKSB7XG5cdFx0bGV0IGhhc2ggPSAwO1xuXG5cdFx0Zm9yIChsZXQgaSA9IDA7IGkgPCBuYW1lc3BhY2UubGVuZ3RoOyBpKyspIHtcblx0XHRcdGhhc2ggPSAoKGhhc2ggPDwgNSkgLSBoYXNoKSArIG5hbWVzcGFjZS5jaGFyQ29kZUF0KGkpO1xuXHRcdFx0aGFzaCB8PSAwOyAvLyBDb252ZXJ0IHRvIDMyYml0IGludGVnZXJcblx0XHR9XG5cblx0XHRyZXR1cm4gY3JlYXRlRGVidWcuY29sb3JzW01hdGguYWJzKGhhc2gpICUgY3JlYXRlRGVidWcuY29sb3JzLmxlbmd0aF07XG5cdH1cblx0Y3JlYXRlRGVidWcuc2VsZWN0Q29sb3IgPSBzZWxlY3RDb2xvcjtcblxuXHQvKipcblx0KiBDcmVhdGUgYSBkZWJ1Z2dlciB3aXRoIHRoZSBnaXZlbiBgbmFtZXNwYWNlYC5cblx0KlxuXHQqIEBwYXJhbSB7U3RyaW5nfSBuYW1lc3BhY2Vcblx0KiBAcmV0dXJuIHtGdW5jdGlvbn1cblx0KiBAYXBpIHB1YmxpY1xuXHQqL1xuXHRmdW5jdGlvbiBjcmVhdGVEZWJ1ZyhuYW1lc3BhY2UpIHtcblx0XHRsZXQgcHJldlRpbWU7XG5cblx0XHRmdW5jdGlvbiBkZWJ1ZyguLi5hcmdzKSB7XG5cdFx0XHQvLyBEaXNhYmxlZD9cblx0XHRcdGlmICghZGVidWcuZW5hYmxlZCkge1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGNvbnN0IHNlbGYgPSBkZWJ1ZztcblxuXHRcdFx0Ly8gU2V0IGBkaWZmYCB0aW1lc3RhbXBcblx0XHRcdGNvbnN0IGN1cnIgPSBOdW1iZXIobmV3IERhdGUoKSk7XG5cdFx0XHRjb25zdCBtcyA9IGN1cnIgLSAocHJldlRpbWUgfHwgY3Vycik7XG5cdFx0XHRzZWxmLmRpZmYgPSBtcztcblx0XHRcdHNlbGYucHJldiA9IHByZXZUaW1lO1xuXHRcdFx0c2VsZi5jdXJyID0gY3Vycjtcblx0XHRcdHByZXZUaW1lID0gY3VycjtcblxuXHRcdFx0YXJnc1swXSA9IGNyZWF0ZURlYnVnLmNvZXJjZShhcmdzWzBdKTtcblxuXHRcdFx0aWYgKHR5cGVvZiBhcmdzWzBdICE9PSAnc3RyaW5nJykge1xuXHRcdFx0XHQvLyBBbnl0aGluZyBlbHNlIGxldCdzIGluc3BlY3Qgd2l0aCAlT1xuXHRcdFx0XHRhcmdzLnVuc2hpZnQoJyVPJyk7XG5cdFx0XHR9XG5cblx0XHRcdC8vIEFwcGx5IGFueSBgZm9ybWF0dGVyc2AgdHJhbnNmb3JtYXRpb25zXG5cdFx0XHRsZXQgaW5kZXggPSAwO1xuXHRcdFx0YXJnc1swXSA9IGFyZ3NbMF0ucmVwbGFjZSgvJShbYS16QS1aJV0pL2csIChtYXRjaCwgZm9ybWF0KSA9PiB7XG5cdFx0XHRcdC8vIElmIHdlIGVuY291bnRlciBhbiBlc2NhcGVkICUgdGhlbiBkb24ndCBpbmNyZWFzZSB0aGUgYXJyYXkgaW5kZXhcblx0XHRcdFx0aWYgKG1hdGNoID09PSAnJSUnKSB7XG5cdFx0XHRcdFx0cmV0dXJuIG1hdGNoO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGluZGV4Kys7XG5cdFx0XHRcdGNvbnN0IGZvcm1hdHRlciA9IGNyZWF0ZURlYnVnLmZvcm1hdHRlcnNbZm9ybWF0XTtcblx0XHRcdFx0aWYgKHR5cGVvZiBmb3JtYXR0ZXIgPT09ICdmdW5jdGlvbicpIHtcblx0XHRcdFx0XHRjb25zdCB2YWwgPSBhcmdzW2luZGV4XTtcblx0XHRcdFx0XHRtYXRjaCA9IGZvcm1hdHRlci5jYWxsKHNlbGYsIHZhbCk7XG5cblx0XHRcdFx0XHQvLyBOb3cgd2UgbmVlZCB0byByZW1vdmUgYGFyZ3NbaW5kZXhdYCBzaW5jZSBpdCdzIGlubGluZWQgaW4gdGhlIGBmb3JtYXRgXG5cdFx0XHRcdFx0YXJncy5zcGxpY2UoaW5kZXgsIDEpO1xuXHRcdFx0XHRcdGluZGV4LS07XG5cdFx0XHRcdH1cblx0XHRcdFx0cmV0dXJuIG1hdGNoO1xuXHRcdFx0fSk7XG5cblx0XHRcdC8vIEFwcGx5IGVudi1zcGVjaWZpYyBmb3JtYXR0aW5nIChjb2xvcnMsIGV0Yy4pXG5cdFx0XHRjcmVhdGVEZWJ1Zy5mb3JtYXRBcmdzLmNhbGwoc2VsZiwgYXJncyk7XG5cblx0XHRcdGNvbnN0IGxvZ0ZuID0gc2VsZi5sb2cgfHwgY3JlYXRlRGVidWcubG9nO1xuXHRcdFx0bG9nRm4uYXBwbHkoc2VsZiwgYXJncyk7XG5cdFx0fVxuXG5cdFx0ZGVidWcubmFtZXNwYWNlID0gbmFtZXNwYWNlO1xuXHRcdGRlYnVnLmVuYWJsZWQgPSBjcmVhdGVEZWJ1Zy5lbmFibGVkKG5hbWVzcGFjZSk7XG5cdFx0ZGVidWcudXNlQ29sb3JzID0gY3JlYXRlRGVidWcudXNlQ29sb3JzKCk7XG5cdFx0ZGVidWcuY29sb3IgPSBzZWxlY3RDb2xvcihuYW1lc3BhY2UpO1xuXHRcdGRlYnVnLmRlc3Ryb3kgPSBkZXN0cm95O1xuXHRcdGRlYnVnLmV4dGVuZCA9IGV4dGVuZDtcblx0XHQvLyBEZWJ1Zy5mb3JtYXRBcmdzID0gZm9ybWF0QXJncztcblx0XHQvLyBkZWJ1Zy5yYXdMb2cgPSByYXdMb2c7XG5cblx0XHQvLyBlbnYtc3BlY2lmaWMgaW5pdGlhbGl6YXRpb24gbG9naWMgZm9yIGRlYnVnIGluc3RhbmNlc1xuXHRcdGlmICh0eXBlb2YgY3JlYXRlRGVidWcuaW5pdCA9PT0gJ2Z1bmN0aW9uJykge1xuXHRcdFx0Y3JlYXRlRGVidWcuaW5pdChkZWJ1Zyk7XG5cdFx0fVxuXG5cdFx0Y3JlYXRlRGVidWcuaW5zdGFuY2VzLnB1c2goZGVidWcpO1xuXG5cdFx0cmV0dXJuIGRlYnVnO1xuXHR9XG5cblx0ZnVuY3Rpb24gZGVzdHJveSgpIHtcblx0XHRjb25zdCBpbmRleCA9IGNyZWF0ZURlYnVnLmluc3RhbmNlcy5pbmRleE9mKHRoaXMpO1xuXHRcdGlmIChpbmRleCAhPT0gLTEpIHtcblx0XHRcdGNyZWF0ZURlYnVnLmluc3RhbmNlcy5zcGxpY2UoaW5kZXgsIDEpO1xuXHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0fVxuXHRcdHJldHVybiBmYWxzZTtcblx0fVxuXG5cdGZ1bmN0aW9uIGV4dGVuZChuYW1lc3BhY2UsIGRlbGltaXRlcikge1xuXHRcdGNvbnN0IG5ld0RlYnVnID0gY3JlYXRlRGVidWcodGhpcy5uYW1lc3BhY2UgKyAodHlwZW9mIGRlbGltaXRlciA9PT0gJ3VuZGVmaW5lZCcgPyAnOicgOiBkZWxpbWl0ZXIpICsgbmFtZXNwYWNlKTtcblx0XHRuZXdEZWJ1Zy5sb2cgPSB0aGlzLmxvZztcblx0XHRyZXR1cm4gbmV3RGVidWc7XG5cdH1cblxuXHQvKipcblx0KiBFbmFibGVzIGEgZGVidWcgbW9kZSBieSBuYW1lc3BhY2VzLiBUaGlzIGNhbiBpbmNsdWRlIG1vZGVzXG5cdCogc2VwYXJhdGVkIGJ5IGEgY29sb24gYW5kIHdpbGRjYXJkcy5cblx0KlxuXHQqIEBwYXJhbSB7U3RyaW5nfSBuYW1lc3BhY2VzXG5cdCogQGFwaSBwdWJsaWNcblx0Ki9cblx0ZnVuY3Rpb24gZW5hYmxlKG5hbWVzcGFjZXMpIHtcblx0XHRjcmVhdGVEZWJ1Zy5zYXZlKG5hbWVzcGFjZXMpO1xuXG5cdFx0Y3JlYXRlRGVidWcubmFtZXMgPSBbXTtcblx0XHRjcmVhdGVEZWJ1Zy5za2lwcyA9IFtdO1xuXG5cdFx0bGV0IGk7XG5cdFx0Y29uc3Qgc3BsaXQgPSAodHlwZW9mIG5hbWVzcGFjZXMgPT09ICdzdHJpbmcnID8gbmFtZXNwYWNlcyA6ICcnKS5zcGxpdCgvW1xccyxdKy8pO1xuXHRcdGNvbnN0IGxlbiA9IHNwbGl0Lmxlbmd0aDtcblxuXHRcdGZvciAoaSA9IDA7IGkgPCBsZW47IGkrKykge1xuXHRcdFx0aWYgKCFzcGxpdFtpXSkge1xuXHRcdFx0XHQvLyBpZ25vcmUgZW1wdHkgc3RyaW5nc1xuXHRcdFx0XHRjb250aW51ZTtcblx0XHRcdH1cblxuXHRcdFx0bmFtZXNwYWNlcyA9IHNwbGl0W2ldLnJlcGxhY2UoL1xcKi9nLCAnLio/Jyk7XG5cblx0XHRcdGlmIChuYW1lc3BhY2VzWzBdID09PSAnLScpIHtcblx0XHRcdFx0Y3JlYXRlRGVidWcuc2tpcHMucHVzaChuZXcgUmVnRXhwKCdeJyArIG5hbWVzcGFjZXMuc3Vic3RyKDEpICsgJyQnKSk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRjcmVhdGVEZWJ1Zy5uYW1lcy5wdXNoKG5ldyBSZWdFeHAoJ14nICsgbmFtZXNwYWNlcyArICckJykpO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdGZvciAoaSA9IDA7IGkgPCBjcmVhdGVEZWJ1Zy5pbnN0YW5jZXMubGVuZ3RoOyBpKyspIHtcblx0XHRcdGNvbnN0IGluc3RhbmNlID0gY3JlYXRlRGVidWcuaW5zdGFuY2VzW2ldO1xuXHRcdFx0aW5zdGFuY2UuZW5hYmxlZCA9IGNyZWF0ZURlYnVnLmVuYWJsZWQoaW5zdGFuY2UubmFtZXNwYWNlKTtcblx0XHR9XG5cdH1cblxuXHQvKipcblx0KiBEaXNhYmxlIGRlYnVnIG91dHB1dC5cblx0KlxuXHQqIEByZXR1cm4ge1N0cmluZ30gbmFtZXNwYWNlc1xuXHQqIEBhcGkgcHVibGljXG5cdCovXG5cdGZ1bmN0aW9uIGRpc2FibGUoKSB7XG5cdFx0Y29uc3QgbmFtZXNwYWNlcyA9IFtcblx0XHRcdC4uLmNyZWF0ZURlYnVnLm5hbWVzLm1hcCh0b05hbWVzcGFjZSksXG5cdFx0XHQuLi5jcmVhdGVEZWJ1Zy5za2lwcy5tYXAodG9OYW1lc3BhY2UpLm1hcChuYW1lc3BhY2UgPT4gJy0nICsgbmFtZXNwYWNlKVxuXHRcdF0uam9pbignLCcpO1xuXHRcdGNyZWF0ZURlYnVnLmVuYWJsZSgnJyk7XG5cdFx0cmV0dXJuIG5hbWVzcGFjZXM7XG5cdH1cblxuXHQvKipcblx0KiBSZXR1cm5zIHRydWUgaWYgdGhlIGdpdmVuIG1vZGUgbmFtZSBpcyBlbmFibGVkLCBmYWxzZSBvdGhlcndpc2UuXG5cdCpcblx0KiBAcGFyYW0ge1N0cmluZ30gbmFtZVxuXHQqIEByZXR1cm4ge0Jvb2xlYW59XG5cdCogQGFwaSBwdWJsaWNcblx0Ki9cblx0ZnVuY3Rpb24gZW5hYmxlZChuYW1lKSB7XG5cdFx0aWYgKG5hbWVbbmFtZS5sZW5ndGggLSAxXSA9PT0gJyonKSB7XG5cdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHR9XG5cblx0XHRsZXQgaTtcblx0XHRsZXQgbGVuO1xuXG5cdFx0Zm9yIChpID0gMCwgbGVuID0gY3JlYXRlRGVidWcuc2tpcHMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcblx0XHRcdGlmIChjcmVhdGVEZWJ1Zy5za2lwc1tpXS50ZXN0KG5hbWUpKSB7XG5cdFx0XHRcdHJldHVybiBmYWxzZTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRmb3IgKGkgPSAwLCBsZW4gPSBjcmVhdGVEZWJ1Zy5uYW1lcy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuXHRcdFx0aWYgKGNyZWF0ZURlYnVnLm5hbWVzW2ldLnRlc3QobmFtZSkpIHtcblx0XHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cblx0LyoqXG5cdCogQ29udmVydCByZWdleHAgdG8gbmFtZXNwYWNlXG5cdCpcblx0KiBAcGFyYW0ge1JlZ0V4cH0gcmVneGVwXG5cdCogQHJldHVybiB7U3RyaW5nfSBuYW1lc3BhY2Vcblx0KiBAYXBpIHByaXZhdGVcblx0Ki9cblx0ZnVuY3Rpb24gdG9OYW1lc3BhY2UocmVnZXhwKSB7XG5cdFx0cmV0dXJuIHJlZ2V4cC50b1N0cmluZygpXG5cdFx0XHQuc3Vic3RyaW5nKDIsIHJlZ2V4cC50b1N0cmluZygpLmxlbmd0aCAtIDIpXG5cdFx0XHQucmVwbGFjZSgvXFwuXFwqXFw/JC8sICcqJyk7XG5cdH1cblxuXHQvKipcblx0KiBDb2VyY2UgYHZhbGAuXG5cdCpcblx0KiBAcGFyYW0ge01peGVkfSB2YWxcblx0KiBAcmV0dXJuIHtNaXhlZH1cblx0KiBAYXBpIHByaXZhdGVcblx0Ki9cblx0ZnVuY3Rpb24gY29lcmNlKHZhbCkge1xuXHRcdGlmICh2YWwgaW5zdGFuY2VvZiBFcnJvcikge1xuXHRcdFx0cmV0dXJuIHZhbC5zdGFjayB8fCB2YWwubWVzc2FnZTtcblx0XHR9XG5cdFx0cmV0dXJuIHZhbDtcblx0fVxuXG5cdGNyZWF0ZURlYnVnLmVuYWJsZShjcmVhdGVEZWJ1Zy5sb2FkKCkpO1xuXG5cdHJldHVybiBjcmVhdGVEZWJ1Zztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBzZXR1cDtcbiIsIi8qIGVzbGludC1lbnYgYnJvd3NlciAqL1xuXG4vKipcbiAqIFRoaXMgaXMgdGhlIHdlYiBicm93c2VyIGltcGxlbWVudGF0aW9uIG9mIGBkZWJ1ZygpYC5cbiAqL1xuXG5leHBvcnRzLmxvZyA9IGxvZztcbmV4cG9ydHMuZm9ybWF0QXJncyA9IGZvcm1hdEFyZ3M7XG5leHBvcnRzLnNhdmUgPSBzYXZlO1xuZXhwb3J0cy5sb2FkID0gbG9hZDtcbmV4cG9ydHMudXNlQ29sb3JzID0gdXNlQ29sb3JzO1xuZXhwb3J0cy5zdG9yYWdlID0gbG9jYWxzdG9yYWdlKCk7XG5cbi8qKlxuICogQ29sb3JzLlxuICovXG5cbmV4cG9ydHMuY29sb3JzID0gW1xuXHQnIzAwMDBDQycsXG5cdCcjMDAwMEZGJyxcblx0JyMwMDMzQ0MnLFxuXHQnIzAwMzNGRicsXG5cdCcjMDA2NkNDJyxcblx0JyMwMDY2RkYnLFxuXHQnIzAwOTlDQycsXG5cdCcjMDA5OUZGJyxcblx0JyMwMENDMDAnLFxuXHQnIzAwQ0MzMycsXG5cdCcjMDBDQzY2Jyxcblx0JyMwMENDOTknLFxuXHQnIzAwQ0NDQycsXG5cdCcjMDBDQ0ZGJyxcblx0JyMzMzAwQ0MnLFxuXHQnIzMzMDBGRicsXG5cdCcjMzMzM0NDJyxcblx0JyMzMzMzRkYnLFxuXHQnIzMzNjZDQycsXG5cdCcjMzM2NkZGJyxcblx0JyMzMzk5Q0MnLFxuXHQnIzMzOTlGRicsXG5cdCcjMzNDQzAwJyxcblx0JyMzM0NDMzMnLFxuXHQnIzMzQ0M2NicsXG5cdCcjMzNDQzk5Jyxcblx0JyMzM0NDQ0MnLFxuXHQnIzMzQ0NGRicsXG5cdCcjNjYwMENDJyxcblx0JyM2NjAwRkYnLFxuXHQnIzY2MzNDQycsXG5cdCcjNjYzM0ZGJyxcblx0JyM2NkNDMDAnLFxuXHQnIzY2Q0MzMycsXG5cdCcjOTkwMENDJyxcblx0JyM5OTAwRkYnLFxuXHQnIzk5MzNDQycsXG5cdCcjOTkzM0ZGJyxcblx0JyM5OUNDMDAnLFxuXHQnIzk5Q0MzMycsXG5cdCcjQ0MwMDAwJyxcblx0JyNDQzAwMzMnLFxuXHQnI0NDMDA2NicsXG5cdCcjQ0MwMDk5Jyxcblx0JyNDQzAwQ0MnLFxuXHQnI0NDMDBGRicsXG5cdCcjQ0MzMzAwJyxcblx0JyNDQzMzMzMnLFxuXHQnI0NDMzM2NicsXG5cdCcjQ0MzMzk5Jyxcblx0JyNDQzMzQ0MnLFxuXHQnI0NDMzNGRicsXG5cdCcjQ0M2NjAwJyxcblx0JyNDQzY2MzMnLFxuXHQnI0NDOTkwMCcsXG5cdCcjQ0M5OTMzJyxcblx0JyNDQ0NDMDAnLFxuXHQnI0NDQ0MzMycsXG5cdCcjRkYwMDAwJyxcblx0JyNGRjAwMzMnLFxuXHQnI0ZGMDA2NicsXG5cdCcjRkYwMDk5Jyxcblx0JyNGRjAwQ0MnLFxuXHQnI0ZGMDBGRicsXG5cdCcjRkYzMzAwJyxcblx0JyNGRjMzMzMnLFxuXHQnI0ZGMzM2NicsXG5cdCcjRkYzMzk5Jyxcblx0JyNGRjMzQ0MnLFxuXHQnI0ZGMzNGRicsXG5cdCcjRkY2NjAwJyxcblx0JyNGRjY2MzMnLFxuXHQnI0ZGOTkwMCcsXG5cdCcjRkY5OTMzJyxcblx0JyNGRkNDMDAnLFxuXHQnI0ZGQ0MzMydcbl07XG5cbi8qKlxuICogQ3VycmVudGx5IG9ubHkgV2ViS2l0LWJhc2VkIFdlYiBJbnNwZWN0b3JzLCBGaXJlZm94ID49IHYzMSxcbiAqIGFuZCB0aGUgRmlyZWJ1ZyBleHRlbnNpb24gKGFueSBGaXJlZm94IHZlcnNpb24pIGFyZSBrbm93blxuICogdG8gc3VwcG9ydCBcIiVjXCIgQ1NTIGN1c3RvbWl6YXRpb25zLlxuICpcbiAqIFRPRE86IGFkZCBhIGBsb2NhbFN0b3JhZ2VgIHZhcmlhYmxlIHRvIGV4cGxpY2l0bHkgZW5hYmxlL2Rpc2FibGUgY29sb3JzXG4gKi9cblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIGNvbXBsZXhpdHlcbmZ1bmN0aW9uIHVzZUNvbG9ycygpIHtcblx0Ly8gTkI6IEluIGFuIEVsZWN0cm9uIHByZWxvYWQgc2NyaXB0LCBkb2N1bWVudCB3aWxsIGJlIGRlZmluZWQgYnV0IG5vdCBmdWxseVxuXHQvLyBpbml0aWFsaXplZC4gU2luY2Ugd2Uga25vdyB3ZSdyZSBpbiBDaHJvbWUsIHdlJ2xsIGp1c3QgZGV0ZWN0IHRoaXMgY2FzZVxuXHQvLyBleHBsaWNpdGx5XG5cdGlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB3aW5kb3cucHJvY2VzcyAmJiAod2luZG93LnByb2Nlc3MudHlwZSA9PT0gJ3JlbmRlcmVyJyB8fCB3aW5kb3cucHJvY2Vzcy5fX253anMpKSB7XG5cdFx0cmV0dXJuIHRydWU7XG5cdH1cblxuXHQvLyBJbnRlcm5ldCBFeHBsb3JlciBhbmQgRWRnZSBkbyBub3Qgc3VwcG9ydCBjb2xvcnMuXG5cdGlmICh0eXBlb2YgbmF2aWdhdG9yICE9PSAndW5kZWZpbmVkJyAmJiBuYXZpZ2F0b3IudXNlckFnZW50ICYmIG5hdmlnYXRvci51c2VyQWdlbnQudG9Mb3dlckNhc2UoKS5tYXRjaCgvKGVkZ2V8dHJpZGVudClcXC8oXFxkKykvKSkge1xuXHRcdHJldHVybiBmYWxzZTtcblx0fVxuXG5cdC8vIElzIHdlYmtpdD8gaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL2EvMTY0NTk2MDYvMzc2NzczXG5cdC8vIGRvY3VtZW50IGlzIHVuZGVmaW5lZCBpbiByZWFjdC1uYXRpdmU6IGh0dHBzOi8vZ2l0aHViLmNvbS9mYWNlYm9vay9yZWFjdC1uYXRpdmUvcHVsbC8xNjMyXG5cdHJldHVybiAodHlwZW9mIGRvY3VtZW50ICE9PSAndW5kZWZpbmVkJyAmJiBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQgJiYgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnN0eWxlICYmIGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5zdHlsZS5XZWJraXRBcHBlYXJhbmNlKSB8fFxuXHRcdC8vIElzIGZpcmVidWc/IGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9hLzM5ODEyMC8zNzY3NzNcblx0XHQodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgd2luZG93LmNvbnNvbGUgJiYgKHdpbmRvdy5jb25zb2xlLmZpcmVidWcgfHwgKHdpbmRvdy5jb25zb2xlLmV4Y2VwdGlvbiAmJiB3aW5kb3cuY29uc29sZS50YWJsZSkpKSB8fFxuXHRcdC8vIElzIGZpcmVmb3ggPj0gdjMxP1xuXHRcdC8vIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvVG9vbHMvV2ViX0NvbnNvbGUjU3R5bGluZ19tZXNzYWdlc1xuXHRcdCh0eXBlb2YgbmF2aWdhdG9yICE9PSAndW5kZWZpbmVkJyAmJiBuYXZpZ2F0b3IudXNlckFnZW50ICYmIG5hdmlnYXRvci51c2VyQWdlbnQudG9Mb3dlckNhc2UoKS5tYXRjaCgvZmlyZWZveFxcLyhcXGQrKS8pICYmIHBhcnNlSW50KFJlZ0V4cC4kMSwgMTApID49IDMxKSB8fFxuXHRcdC8vIERvdWJsZSBjaGVjayB3ZWJraXQgaW4gdXNlckFnZW50IGp1c3QgaW4gY2FzZSB3ZSBhcmUgaW4gYSB3b3JrZXJcblx0XHQodHlwZW9mIG5hdmlnYXRvciAhPT0gJ3VuZGVmaW5lZCcgJiYgbmF2aWdhdG9yLnVzZXJBZ2VudCAmJiBuYXZpZ2F0b3IudXNlckFnZW50LnRvTG93ZXJDYXNlKCkubWF0Y2goL2FwcGxld2Via2l0XFwvKFxcZCspLykpO1xufVxuXG4vKipcbiAqIENvbG9yaXplIGxvZyBhcmd1bWVudHMgaWYgZW5hYmxlZC5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGZvcm1hdEFyZ3MoYXJncykge1xuXHRhcmdzWzBdID0gKHRoaXMudXNlQ29sb3JzID8gJyVjJyA6ICcnKSArXG5cdFx0dGhpcy5uYW1lc3BhY2UgK1xuXHRcdCh0aGlzLnVzZUNvbG9ycyA/ICcgJWMnIDogJyAnKSArXG5cdFx0YXJnc1swXSArXG5cdFx0KHRoaXMudXNlQ29sb3JzID8gJyVjICcgOiAnICcpICtcblx0XHQnKycgKyBtb2R1bGUuZXhwb3J0cy5odW1hbml6ZSh0aGlzLmRpZmYpO1xuXG5cdGlmICghdGhpcy51c2VDb2xvcnMpIHtcblx0XHRyZXR1cm47XG5cdH1cblxuXHRjb25zdCBjID0gJ2NvbG9yOiAnICsgdGhpcy5jb2xvcjtcblx0YXJncy5zcGxpY2UoMSwgMCwgYywgJ2NvbG9yOiBpbmhlcml0Jyk7XG5cblx0Ly8gVGhlIGZpbmFsIFwiJWNcIiBpcyBzb21ld2hhdCB0cmlja3ksIGJlY2F1c2UgdGhlcmUgY291bGQgYmUgb3RoZXJcblx0Ly8gYXJndW1lbnRzIHBhc3NlZCBlaXRoZXIgYmVmb3JlIG9yIGFmdGVyIHRoZSAlYywgc28gd2UgbmVlZCB0b1xuXHQvLyBmaWd1cmUgb3V0IHRoZSBjb3JyZWN0IGluZGV4IHRvIGluc2VydCB0aGUgQ1NTIGludG9cblx0bGV0IGluZGV4ID0gMDtcblx0bGV0IGxhc3RDID0gMDtcblx0YXJnc1swXS5yZXBsYWNlKC8lW2EtekEtWiVdL2csIG1hdGNoID0+IHtcblx0XHRpZiAobWF0Y2ggPT09ICclJScpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0aW5kZXgrKztcblx0XHRpZiAobWF0Y2ggPT09ICclYycpIHtcblx0XHRcdC8vIFdlIG9ubHkgYXJlIGludGVyZXN0ZWQgaW4gdGhlICpsYXN0KiAlY1xuXHRcdFx0Ly8gKHRoZSB1c2VyIG1heSBoYXZlIHByb3ZpZGVkIHRoZWlyIG93bilcblx0XHRcdGxhc3RDID0gaW5kZXg7XG5cdFx0fVxuXHR9KTtcblxuXHRhcmdzLnNwbGljZShsYXN0QywgMCwgYyk7XG59XG5cbi8qKlxuICogSW52b2tlcyBgY29uc29sZS5sb2coKWAgd2hlbiBhdmFpbGFibGUuXG4gKiBOby1vcCB3aGVuIGBjb25zb2xlLmxvZ2AgaXMgbm90IGEgXCJmdW5jdGlvblwiLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cbmZ1bmN0aW9uIGxvZyguLi5hcmdzKSB7XG5cdC8vIFRoaXMgaGFja2VyeSBpcyByZXF1aXJlZCBmb3IgSUU4LzksIHdoZXJlXG5cdC8vIHRoZSBgY29uc29sZS5sb2dgIGZ1bmN0aW9uIGRvZXNuJ3QgaGF2ZSAnYXBwbHknXG5cdHJldHVybiB0eXBlb2YgY29uc29sZSA9PT0gJ29iamVjdCcgJiZcblx0XHRjb25zb2xlLmxvZyAmJlxuXHRcdGNvbnNvbGUubG9nKC4uLmFyZ3MpO1xufVxuXG4vKipcbiAqIFNhdmUgYG5hbWVzcGFjZXNgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lc3BhY2VzXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gc2F2ZShuYW1lc3BhY2VzKSB7XG5cdHRyeSB7XG5cdFx0aWYgKG5hbWVzcGFjZXMpIHtcblx0XHRcdGV4cG9ydHMuc3RvcmFnZS5zZXRJdGVtKCdkZWJ1ZycsIG5hbWVzcGFjZXMpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRleHBvcnRzLnN0b3JhZ2UucmVtb3ZlSXRlbSgnZGVidWcnKTtcblx0XHR9XG5cdH0gY2F0Y2ggKGVycm9yKSB7XG5cdFx0Ly8gU3dhbGxvd1xuXHRcdC8vIFhYWCAoQFFpeC0pIHNob3VsZCB3ZSBiZSBsb2dnaW5nIHRoZXNlP1xuXHR9XG59XG5cbi8qKlxuICogTG9hZCBgbmFtZXNwYWNlc2AuXG4gKlxuICogQHJldHVybiB7U3RyaW5nfSByZXR1cm5zIHRoZSBwcmV2aW91c2x5IHBlcnNpc3RlZCBkZWJ1ZyBtb2Rlc1xuICogQGFwaSBwcml2YXRlXG4gKi9cbmZ1bmN0aW9uIGxvYWQoKSB7XG5cdGxldCByO1xuXHR0cnkge1xuXHRcdHIgPSBleHBvcnRzLnN0b3JhZ2UuZ2V0SXRlbSgnZGVidWcnKTtcblx0fSBjYXRjaCAoZXJyb3IpIHtcblx0XHQvLyBTd2FsbG93XG5cdFx0Ly8gWFhYIChAUWl4LSkgc2hvdWxkIHdlIGJlIGxvZ2dpbmcgdGhlc2U/XG5cdH1cblxuXHQvLyBJZiBkZWJ1ZyBpc24ndCBzZXQgaW4gTFMsIGFuZCB3ZSdyZSBpbiBFbGVjdHJvbiwgdHJ5IHRvIGxvYWQgJERFQlVHXG5cdGlmICghciAmJiB0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgJ2VudicgaW4gcHJvY2Vzcykge1xuXHRcdHIgPSBwcm9jZXNzLmVudi5ERUJVRztcblx0fVxuXG5cdHJldHVybiByO1xufVxuXG4vKipcbiAqIExvY2Fsc3RvcmFnZSBhdHRlbXB0cyB0byByZXR1cm4gdGhlIGxvY2Fsc3RvcmFnZS5cbiAqXG4gKiBUaGlzIGlzIG5lY2Vzc2FyeSBiZWNhdXNlIHNhZmFyaSB0aHJvd3NcbiAqIHdoZW4gYSB1c2VyIGRpc2FibGVzIGNvb2tpZXMvbG9jYWxzdG9yYWdlXG4gKiBhbmQgeW91IGF0dGVtcHQgdG8gYWNjZXNzIGl0LlxuICpcbiAqIEByZXR1cm4ge0xvY2FsU3RvcmFnZX1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGxvY2Fsc3RvcmFnZSgpIHtcblx0dHJ5IHtcblx0XHQvLyBUVk1MS2l0IChBcHBsZSBUViBKUyBSdW50aW1lKSBkb2VzIG5vdCBoYXZlIGEgd2luZG93IG9iamVjdCwganVzdCBsb2NhbFN0b3JhZ2UgaW4gdGhlIGdsb2JhbCBjb250ZXh0XG5cdFx0Ly8gVGhlIEJyb3dzZXIgYWxzbyBoYXMgbG9jYWxTdG9yYWdlIGluIHRoZSBnbG9iYWwgY29udGV4dC5cblx0XHRyZXR1cm4gbG9jYWxTdG9yYWdlO1xuXHR9IGNhdGNoIChlcnJvcikge1xuXHRcdC8vIFN3YWxsb3dcblx0XHQvLyBYWFggKEBRaXgtKSBzaG91bGQgd2UgYmUgbG9nZ2luZyB0aGVzZT9cblx0fVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vY29tbW9uJykoZXhwb3J0cyk7XG5cbmNvbnN0IHtmb3JtYXR0ZXJzfSA9IG1vZHVsZS5leHBvcnRzO1xuXG4vKipcbiAqIE1hcCAlaiB0byBgSlNPTi5zdHJpbmdpZnkoKWAsIHNpbmNlIG5vIFdlYiBJbnNwZWN0b3JzIGRvIHRoYXQgYnkgZGVmYXVsdC5cbiAqL1xuXG5mb3JtYXR0ZXJzLmogPSBmdW5jdGlvbiAodikge1xuXHR0cnkge1xuXHRcdHJldHVybiBKU09OLnN0cmluZ2lmeSh2KTtcblx0fSBjYXRjaCAoZXJyb3IpIHtcblx0XHRyZXR1cm4gJ1tVbmV4cGVjdGVkSlNPTlBhcnNlRXJyb3JdOiAnICsgZXJyb3IubWVzc2FnZTtcblx0fVxufTtcbiIsIlxuLyoqXG4gKiBNb2R1bGUgZGVwZW5kZW5jaWVzLlxuICovXG5cbnZhciBwYXJzZXVyaSA9IHJlcXVpcmUoJ3BhcnNldXJpJyk7XG52YXIgZGVidWcgPSByZXF1aXJlKCdkZWJ1ZycpKCdzb2NrZXQuaW8tY2xpZW50OnVybCcpO1xuXG4vKipcbiAqIE1vZHVsZSBleHBvcnRzLlxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gdXJsO1xuXG4vKipcbiAqIFVSTCBwYXJzZXIuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHVybFxuICogQHBhcmFtIHtPYmplY3R9IEFuIG9iamVjdCBtZWFudCB0byBtaW1pYyB3aW5kb3cubG9jYXRpb24uXG4gKiAgICAgICAgICAgICAgICAgRGVmYXVsdHMgdG8gd2luZG93LmxvY2F0aW9uLlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiB1cmwgKHVyaSwgbG9jKSB7XG4gIHZhciBvYmogPSB1cmk7XG5cbiAgLy8gZGVmYXVsdCB0byB3aW5kb3cubG9jYXRpb25cbiAgbG9jID0gbG9jIHx8ICh0eXBlb2YgbG9jYXRpb24gIT09ICd1bmRlZmluZWQnICYmIGxvY2F0aW9uKTtcbiAgaWYgKG51bGwgPT0gdXJpKSB1cmkgPSBsb2MucHJvdG9jb2wgKyAnLy8nICsgbG9jLmhvc3Q7XG5cbiAgLy8gcmVsYXRpdmUgcGF0aCBzdXBwb3J0XG4gIGlmICgnc3RyaW5nJyA9PT0gdHlwZW9mIHVyaSkge1xuICAgIGlmICgnLycgPT09IHVyaS5jaGFyQXQoMCkpIHtcbiAgICAgIGlmICgnLycgPT09IHVyaS5jaGFyQXQoMSkpIHtcbiAgICAgICAgdXJpID0gbG9jLnByb3RvY29sICsgdXJpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdXJpID0gbG9jLmhvc3QgKyB1cmk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCEvXihodHRwcz98d3NzPyk6XFwvXFwvLy50ZXN0KHVyaSkpIHtcbiAgICAgIGRlYnVnKCdwcm90b2NvbC1sZXNzIHVybCAlcycsIHVyaSk7XG4gICAgICBpZiAoJ3VuZGVmaW5lZCcgIT09IHR5cGVvZiBsb2MpIHtcbiAgICAgICAgdXJpID0gbG9jLnByb3RvY29sICsgJy8vJyArIHVyaTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHVyaSA9ICdodHRwczovLycgKyB1cmk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gcGFyc2VcbiAgICBkZWJ1ZygncGFyc2UgJXMnLCB1cmkpO1xuICAgIG9iaiA9IHBhcnNldXJpKHVyaSk7XG4gIH1cblxuICAvLyBtYWtlIHN1cmUgd2UgdHJlYXQgYGxvY2FsaG9zdDo4MGAgYW5kIGBsb2NhbGhvc3RgIGVxdWFsbHlcbiAgaWYgKCFvYmoucG9ydCkge1xuICAgIGlmICgvXihodHRwfHdzKSQvLnRlc3Qob2JqLnByb3RvY29sKSkge1xuICAgICAgb2JqLnBvcnQgPSAnODAnO1xuICAgIH0gZWxzZSBpZiAoL14oaHR0cHx3cylzJC8udGVzdChvYmoucHJvdG9jb2wpKSB7XG4gICAgICBvYmoucG9ydCA9ICc0NDMnO1xuICAgIH1cbiAgfVxuXG4gIG9iai5wYXRoID0gb2JqLnBhdGggfHwgJy8nO1xuXG4gIHZhciBpcHY2ID0gb2JqLmhvc3QuaW5kZXhPZignOicpICE9PSAtMTtcbiAgdmFyIGhvc3QgPSBpcHY2ID8gJ1snICsgb2JqLmhvc3QgKyAnXScgOiBvYmouaG9zdDtcblxuICAvLyBkZWZpbmUgdW5pcXVlIGlkXG4gIG9iai5pZCA9IG9iai5wcm90b2NvbCArICc6Ly8nICsgaG9zdCArICc6JyArIG9iai5wb3J0O1xuICAvLyBkZWZpbmUgaHJlZlxuICBvYmouaHJlZiA9IG9iai5wcm90b2NvbCArICc6Ly8nICsgaG9zdCArIChsb2MgJiYgbG9jLnBvcnQgPT09IG9iai5wb3J0ID8gJycgOiAoJzonICsgb2JqLnBvcnQpKTtcblxuICByZXR1cm4gb2JqO1xufVxuIiwiLyoqXG4gKiBIZWxwZXJzLlxuICovXG5cbnZhciBzID0gMTAwMDtcbnZhciBtID0gcyAqIDYwO1xudmFyIGggPSBtICogNjA7XG52YXIgZCA9IGggKiAyNDtcbnZhciB5ID0gZCAqIDM2NS4yNTtcblxuLyoqXG4gKiBQYXJzZSBvciBmb3JtYXQgdGhlIGdpdmVuIGB2YWxgLlxuICpcbiAqIE9wdGlvbnM6XG4gKlxuICogIC0gYGxvbmdgIHZlcmJvc2UgZm9ybWF0dGluZyBbZmFsc2VdXG4gKlxuICogQHBhcmFtIHtTdHJpbmd8TnVtYmVyfSB2YWxcbiAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9uc11cbiAqIEB0aHJvd3Mge0Vycm9yfSB0aHJvdyBhbiBlcnJvciBpZiB2YWwgaXMgbm90IGEgbm9uLWVtcHR5IHN0cmluZyBvciBhIG51bWJlclxuICogQHJldHVybiB7U3RyaW5nfE51bWJlcn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih2YWwsIG9wdGlvbnMpIHtcbiAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG4gIHZhciB0eXBlID0gdHlwZW9mIHZhbDtcbiAgaWYgKHR5cGUgPT09ICdzdHJpbmcnICYmIHZhbC5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIHBhcnNlKHZhbCk7XG4gIH0gZWxzZSBpZiAodHlwZSA9PT0gJ251bWJlcicgJiYgaXNOYU4odmFsKSA9PT0gZmFsc2UpIHtcbiAgICByZXR1cm4gb3B0aW9ucy5sb25nID8gZm10TG9uZyh2YWwpIDogZm10U2hvcnQodmFsKTtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgJ3ZhbCBpcyBub3QgYSBub24tZW1wdHkgc3RyaW5nIG9yIGEgdmFsaWQgbnVtYmVyLiB2YWw9JyArXG4gICAgICBKU09OLnN0cmluZ2lmeSh2YWwpXG4gICk7XG59O1xuXG4vKipcbiAqIFBhcnNlIHRoZSBnaXZlbiBgc3RyYCBhbmQgcmV0dXJuIG1pbGxpc2Vjb25kcy5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXG4gKiBAcmV0dXJuIHtOdW1iZXJ9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBwYXJzZShzdHIpIHtcbiAgc3RyID0gU3RyaW5nKHN0cik7XG4gIGlmIChzdHIubGVuZ3RoID4gMTAwKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIHZhciBtYXRjaCA9IC9eKCg/OlxcZCspP1xcLj9cXGQrKSAqKG1pbGxpc2Vjb25kcz98bXNlY3M/fG1zfHNlY29uZHM/fHNlY3M/fHN8bWludXRlcz98bWlucz98bXxob3Vycz98aHJzP3xofGRheXM/fGR8eWVhcnM/fHlycz98eSk/JC9pLmV4ZWMoXG4gICAgc3RyXG4gICk7XG4gIGlmICghbWF0Y2gpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgdmFyIG4gPSBwYXJzZUZsb2F0KG1hdGNoWzFdKTtcbiAgdmFyIHR5cGUgPSAobWF0Y2hbMl0gfHwgJ21zJykudG9Mb3dlckNhc2UoKTtcbiAgc3dpdGNoICh0eXBlKSB7XG4gICAgY2FzZSAneWVhcnMnOlxuICAgIGNhc2UgJ3llYXInOlxuICAgIGNhc2UgJ3lycyc6XG4gICAgY2FzZSAneXInOlxuICAgIGNhc2UgJ3knOlxuICAgICAgcmV0dXJuIG4gKiB5O1xuICAgIGNhc2UgJ2RheXMnOlxuICAgIGNhc2UgJ2RheSc6XG4gICAgY2FzZSAnZCc6XG4gICAgICByZXR1cm4gbiAqIGQ7XG4gICAgY2FzZSAnaG91cnMnOlxuICAgIGNhc2UgJ2hvdXInOlxuICAgIGNhc2UgJ2hycyc6XG4gICAgY2FzZSAnaHInOlxuICAgIGNhc2UgJ2gnOlxuICAgICAgcmV0dXJuIG4gKiBoO1xuICAgIGNhc2UgJ21pbnV0ZXMnOlxuICAgIGNhc2UgJ21pbnV0ZSc6XG4gICAgY2FzZSAnbWlucyc6XG4gICAgY2FzZSAnbWluJzpcbiAgICBjYXNlICdtJzpcbiAgICAgIHJldHVybiBuICogbTtcbiAgICBjYXNlICdzZWNvbmRzJzpcbiAgICBjYXNlICdzZWNvbmQnOlxuICAgIGNhc2UgJ3NlY3MnOlxuICAgIGNhc2UgJ3NlYyc6XG4gICAgY2FzZSAncyc6XG4gICAgICByZXR1cm4gbiAqIHM7XG4gICAgY2FzZSAnbWlsbGlzZWNvbmRzJzpcbiAgICBjYXNlICdtaWxsaXNlY29uZCc6XG4gICAgY2FzZSAnbXNlY3MnOlxuICAgIGNhc2UgJ21zZWMnOlxuICAgIGNhc2UgJ21zJzpcbiAgICAgIHJldHVybiBuO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG59XG5cbi8qKlxuICogU2hvcnQgZm9ybWF0IGZvciBgbXNgLlxuICpcbiAqIEBwYXJhbSB7TnVtYmVyfSBtc1xuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gZm10U2hvcnQobXMpIHtcbiAgaWYgKG1zID49IGQpIHtcbiAgICByZXR1cm4gTWF0aC5yb3VuZChtcyAvIGQpICsgJ2QnO1xuICB9XG4gIGlmIChtcyA+PSBoKSB7XG4gICAgcmV0dXJuIE1hdGgucm91bmQobXMgLyBoKSArICdoJztcbiAgfVxuICBpZiAobXMgPj0gbSkge1xuICAgIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gbSkgKyAnbSc7XG4gIH1cbiAgaWYgKG1zID49IHMpIHtcbiAgICByZXR1cm4gTWF0aC5yb3VuZChtcyAvIHMpICsgJ3MnO1xuICB9XG4gIHJldHVybiBtcyArICdtcyc7XG59XG5cbi8qKlxuICogTG9uZyBmb3JtYXQgZm9yIGBtc2AuXG4gKlxuICogQHBhcmFtIHtOdW1iZXJ9IG1zXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBmbXRMb25nKG1zKSB7XG4gIHJldHVybiBwbHVyYWwobXMsIGQsICdkYXknKSB8fFxuICAgIHBsdXJhbChtcywgaCwgJ2hvdXInKSB8fFxuICAgIHBsdXJhbChtcywgbSwgJ21pbnV0ZScpIHx8XG4gICAgcGx1cmFsKG1zLCBzLCAnc2Vjb25kJykgfHxcbiAgICBtcyArICcgbXMnO1xufVxuXG4vKipcbiAqIFBsdXJhbGl6YXRpb24gaGVscGVyLlxuICovXG5cbmZ1bmN0aW9uIHBsdXJhbChtcywgbiwgbmFtZSkge1xuICBpZiAobXMgPCBuKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChtcyA8IG4gKiAxLjUpIHtcbiAgICByZXR1cm4gTWF0aC5mbG9vcihtcyAvIG4pICsgJyAnICsgbmFtZTtcbiAgfVxuICByZXR1cm4gTWF0aC5jZWlsKG1zIC8gbikgKyAnICcgKyBuYW1lICsgJ3MnO1xufVxuIiwiXG4vKipcbiAqIFRoaXMgaXMgdGhlIGNvbW1vbiBsb2dpYyBmb3IgYm90aCB0aGUgTm9kZS5qcyBhbmQgd2ViIGJyb3dzZXJcbiAqIGltcGxlbWVudGF0aW9ucyBvZiBgZGVidWcoKWAuXG4gKlxuICogRXhwb3NlIGBkZWJ1ZygpYCBhcyB0aGUgbW9kdWxlLlxuICovXG5cbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IGNyZWF0ZURlYnVnLmRlYnVnID0gY3JlYXRlRGVidWdbJ2RlZmF1bHQnXSA9IGNyZWF0ZURlYnVnO1xuZXhwb3J0cy5jb2VyY2UgPSBjb2VyY2U7XG5leHBvcnRzLmRpc2FibGUgPSBkaXNhYmxlO1xuZXhwb3J0cy5lbmFibGUgPSBlbmFibGU7XG5leHBvcnRzLmVuYWJsZWQgPSBlbmFibGVkO1xuZXhwb3J0cy5odW1hbml6ZSA9IHJlcXVpcmUoJ21zJyk7XG5cbi8qKlxuICogQWN0aXZlIGBkZWJ1Z2AgaW5zdGFuY2VzLlxuICovXG5leHBvcnRzLmluc3RhbmNlcyA9IFtdO1xuXG4vKipcbiAqIFRoZSBjdXJyZW50bHkgYWN0aXZlIGRlYnVnIG1vZGUgbmFtZXMsIGFuZCBuYW1lcyB0byBza2lwLlxuICovXG5cbmV4cG9ydHMubmFtZXMgPSBbXTtcbmV4cG9ydHMuc2tpcHMgPSBbXTtcblxuLyoqXG4gKiBNYXAgb2Ygc3BlY2lhbCBcIiVuXCIgaGFuZGxpbmcgZnVuY3Rpb25zLCBmb3IgdGhlIGRlYnVnIFwiZm9ybWF0XCIgYXJndW1lbnQuXG4gKlxuICogVmFsaWQga2V5IG5hbWVzIGFyZSBhIHNpbmdsZSwgbG93ZXIgb3IgdXBwZXItY2FzZSBsZXR0ZXIsIGkuZS4gXCJuXCIgYW5kIFwiTlwiLlxuICovXG5cbmV4cG9ydHMuZm9ybWF0dGVycyA9IHt9O1xuXG4vKipcbiAqIFNlbGVjdCBhIGNvbG9yLlxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWVzcGFjZVxuICogQHJldHVybiB7TnVtYmVyfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gc2VsZWN0Q29sb3IobmFtZXNwYWNlKSB7XG4gIHZhciBoYXNoID0gMCwgaTtcblxuICBmb3IgKGkgaW4gbmFtZXNwYWNlKSB7XG4gICAgaGFzaCAgPSAoKGhhc2ggPDwgNSkgLSBoYXNoKSArIG5hbWVzcGFjZS5jaGFyQ29kZUF0KGkpO1xuICAgIGhhc2ggfD0gMDsgLy8gQ29udmVydCB0byAzMmJpdCBpbnRlZ2VyXG4gIH1cblxuICByZXR1cm4gZXhwb3J0cy5jb2xvcnNbTWF0aC5hYnMoaGFzaCkgJSBleHBvcnRzLmNvbG9ycy5sZW5ndGhdO1xufVxuXG4vKipcbiAqIENyZWF0ZSBhIGRlYnVnZ2VyIHdpdGggdGhlIGdpdmVuIGBuYW1lc3BhY2VgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lc3BhY2VcbiAqIEByZXR1cm4ge0Z1bmN0aW9ufVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBjcmVhdGVEZWJ1ZyhuYW1lc3BhY2UpIHtcblxuICB2YXIgcHJldlRpbWU7XG5cbiAgZnVuY3Rpb24gZGVidWcoKSB7XG4gICAgLy8gZGlzYWJsZWQ/XG4gICAgaWYgKCFkZWJ1Zy5lbmFibGVkKSByZXR1cm47XG5cbiAgICB2YXIgc2VsZiA9IGRlYnVnO1xuXG4gICAgLy8gc2V0IGBkaWZmYCB0aW1lc3RhbXBcbiAgICB2YXIgY3VyciA9ICtuZXcgRGF0ZSgpO1xuICAgIHZhciBtcyA9IGN1cnIgLSAocHJldlRpbWUgfHwgY3Vycik7XG4gICAgc2VsZi5kaWZmID0gbXM7XG4gICAgc2VsZi5wcmV2ID0gcHJldlRpbWU7XG4gICAgc2VsZi5jdXJyID0gY3VycjtcbiAgICBwcmV2VGltZSA9IGN1cnI7XG5cbiAgICAvLyB0dXJuIHRoZSBgYXJndW1lbnRzYCBpbnRvIGEgcHJvcGVyIEFycmF5XG4gICAgdmFyIGFyZ3MgPSBuZXcgQXJyYXkoYXJndW1lbnRzLmxlbmd0aCk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcmdzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBhcmdzW2ldID0gYXJndW1lbnRzW2ldO1xuICAgIH1cblxuICAgIGFyZ3NbMF0gPSBleHBvcnRzLmNvZXJjZShhcmdzWzBdKTtcblxuICAgIGlmICgnc3RyaW5nJyAhPT0gdHlwZW9mIGFyZ3NbMF0pIHtcbiAgICAgIC8vIGFueXRoaW5nIGVsc2UgbGV0J3MgaW5zcGVjdCB3aXRoICVPXG4gICAgICBhcmdzLnVuc2hpZnQoJyVPJyk7XG4gICAgfVxuXG4gICAgLy8gYXBwbHkgYW55IGBmb3JtYXR0ZXJzYCB0cmFuc2Zvcm1hdGlvbnNcbiAgICB2YXIgaW5kZXggPSAwO1xuICAgIGFyZ3NbMF0gPSBhcmdzWzBdLnJlcGxhY2UoLyUoW2EtekEtWiVdKS9nLCBmdW5jdGlvbihtYXRjaCwgZm9ybWF0KSB7XG4gICAgICAvLyBpZiB3ZSBlbmNvdW50ZXIgYW4gZXNjYXBlZCAlIHRoZW4gZG9uJ3QgaW5jcmVhc2UgdGhlIGFycmF5IGluZGV4XG4gICAgICBpZiAobWF0Y2ggPT09ICclJScpIHJldHVybiBtYXRjaDtcbiAgICAgIGluZGV4Kys7XG4gICAgICB2YXIgZm9ybWF0dGVyID0gZXhwb3J0cy5mb3JtYXR0ZXJzW2Zvcm1hdF07XG4gICAgICBpZiAoJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGZvcm1hdHRlcikge1xuICAgICAgICB2YXIgdmFsID0gYXJnc1tpbmRleF07XG4gICAgICAgIG1hdGNoID0gZm9ybWF0dGVyLmNhbGwoc2VsZiwgdmFsKTtcblxuICAgICAgICAvLyBub3cgd2UgbmVlZCB0byByZW1vdmUgYGFyZ3NbaW5kZXhdYCBzaW5jZSBpdCdzIGlubGluZWQgaW4gdGhlIGBmb3JtYXRgXG4gICAgICAgIGFyZ3Muc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgaW5kZXgtLTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBtYXRjaDtcbiAgICB9KTtcblxuICAgIC8vIGFwcGx5IGVudi1zcGVjaWZpYyBmb3JtYXR0aW5nIChjb2xvcnMsIGV0Yy4pXG4gICAgZXhwb3J0cy5mb3JtYXRBcmdzLmNhbGwoc2VsZiwgYXJncyk7XG5cbiAgICB2YXIgbG9nRm4gPSBkZWJ1Zy5sb2cgfHwgZXhwb3J0cy5sb2cgfHwgY29uc29sZS5sb2cuYmluZChjb25zb2xlKTtcbiAgICBsb2dGbi5hcHBseShzZWxmLCBhcmdzKTtcbiAgfVxuXG4gIGRlYnVnLm5hbWVzcGFjZSA9IG5hbWVzcGFjZTtcbiAgZGVidWcuZW5hYmxlZCA9IGV4cG9ydHMuZW5hYmxlZChuYW1lc3BhY2UpO1xuICBkZWJ1Zy51c2VDb2xvcnMgPSBleHBvcnRzLnVzZUNvbG9ycygpO1xuICBkZWJ1Zy5jb2xvciA9IHNlbGVjdENvbG9yKG5hbWVzcGFjZSk7XG4gIGRlYnVnLmRlc3Ryb3kgPSBkZXN0cm95O1xuXG4gIC8vIGVudi1zcGVjaWZpYyBpbml0aWFsaXphdGlvbiBsb2dpYyBmb3IgZGVidWcgaW5zdGFuY2VzXG4gIGlmICgnZnVuY3Rpb24nID09PSB0eXBlb2YgZXhwb3J0cy5pbml0KSB7XG4gICAgZXhwb3J0cy5pbml0KGRlYnVnKTtcbiAgfVxuXG4gIGV4cG9ydHMuaW5zdGFuY2VzLnB1c2goZGVidWcpO1xuXG4gIHJldHVybiBkZWJ1Zztcbn1cblxuZnVuY3Rpb24gZGVzdHJveSAoKSB7XG4gIHZhciBpbmRleCA9IGV4cG9ydHMuaW5zdGFuY2VzLmluZGV4T2YodGhpcyk7XG4gIGlmIChpbmRleCAhPT0gLTEpIHtcbiAgICBleHBvcnRzLmluc3RhbmNlcy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIEVuYWJsZXMgYSBkZWJ1ZyBtb2RlIGJ5IG5hbWVzcGFjZXMuIFRoaXMgY2FuIGluY2x1ZGUgbW9kZXNcbiAqIHNlcGFyYXRlZCBieSBhIGNvbG9uIGFuZCB3aWxkY2FyZHMuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWVzcGFjZXNcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gZW5hYmxlKG5hbWVzcGFjZXMpIHtcbiAgZXhwb3J0cy5zYXZlKG5hbWVzcGFjZXMpO1xuXG4gIGV4cG9ydHMubmFtZXMgPSBbXTtcbiAgZXhwb3J0cy5za2lwcyA9IFtdO1xuXG4gIHZhciBpO1xuICB2YXIgc3BsaXQgPSAodHlwZW9mIG5hbWVzcGFjZXMgPT09ICdzdHJpbmcnID8gbmFtZXNwYWNlcyA6ICcnKS5zcGxpdCgvW1xccyxdKy8pO1xuICB2YXIgbGVuID0gc3BsaXQubGVuZ3RoO1xuXG4gIGZvciAoaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgIGlmICghc3BsaXRbaV0pIGNvbnRpbnVlOyAvLyBpZ25vcmUgZW1wdHkgc3RyaW5nc1xuICAgIG5hbWVzcGFjZXMgPSBzcGxpdFtpXS5yZXBsYWNlKC9cXCovZywgJy4qPycpO1xuICAgIGlmIChuYW1lc3BhY2VzWzBdID09PSAnLScpIHtcbiAgICAgIGV4cG9ydHMuc2tpcHMucHVzaChuZXcgUmVnRXhwKCdeJyArIG5hbWVzcGFjZXMuc3Vic3RyKDEpICsgJyQnKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGV4cG9ydHMubmFtZXMucHVzaChuZXcgUmVnRXhwKCdeJyArIG5hbWVzcGFjZXMgKyAnJCcpKTtcbiAgICB9XG4gIH1cblxuICBmb3IgKGkgPSAwOyBpIDwgZXhwb3J0cy5pbnN0YW5jZXMubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgaW5zdGFuY2UgPSBleHBvcnRzLmluc3RhbmNlc1tpXTtcbiAgICBpbnN0YW5jZS5lbmFibGVkID0gZXhwb3J0cy5lbmFibGVkKGluc3RhbmNlLm5hbWVzcGFjZSk7XG4gIH1cbn1cblxuLyoqXG4gKiBEaXNhYmxlIGRlYnVnIG91dHB1dC5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGRpc2FibGUoKSB7XG4gIGV4cG9ydHMuZW5hYmxlKCcnKTtcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRydWUgaWYgdGhlIGdpdmVuIG1vZGUgbmFtZSBpcyBlbmFibGVkLCBmYWxzZSBvdGhlcndpc2UuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWVcbiAqIEByZXR1cm4ge0Jvb2xlYW59XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGVuYWJsZWQobmFtZSkge1xuICBpZiAobmFtZVtuYW1lLmxlbmd0aCAtIDFdID09PSAnKicpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICB2YXIgaSwgbGVuO1xuICBmb3IgKGkgPSAwLCBsZW4gPSBleHBvcnRzLnNraXBzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgaWYgKGV4cG9ydHMuc2tpcHNbaV0udGVzdChuYW1lKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuICBmb3IgKGkgPSAwLCBsZW4gPSBleHBvcnRzLm5hbWVzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgaWYgKGV4cG9ydHMubmFtZXNbaV0udGVzdChuYW1lKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBDb2VyY2UgYHZhbGAuXG4gKlxuICogQHBhcmFtIHtNaXhlZH0gdmFsXG4gKiBAcmV0dXJuIHtNaXhlZH1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGNvZXJjZSh2YWwpIHtcbiAgaWYgKHZhbCBpbnN0YW5jZW9mIEVycm9yKSByZXR1cm4gdmFsLnN0YWNrIHx8IHZhbC5tZXNzYWdlO1xuICByZXR1cm4gdmFsO1xufVxuIiwiLyoqXG4gKiBUaGlzIGlzIHRoZSB3ZWIgYnJvd3NlciBpbXBsZW1lbnRhdGlvbiBvZiBgZGVidWcoKWAuXG4gKlxuICogRXhwb3NlIGBkZWJ1ZygpYCBhcyB0aGUgbW9kdWxlLlxuICovXG5cbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vZGVidWcnKTtcbmV4cG9ydHMubG9nID0gbG9nO1xuZXhwb3J0cy5mb3JtYXRBcmdzID0gZm9ybWF0QXJncztcbmV4cG9ydHMuc2F2ZSA9IHNhdmU7XG5leHBvcnRzLmxvYWQgPSBsb2FkO1xuZXhwb3J0cy51c2VDb2xvcnMgPSB1c2VDb2xvcnM7XG5leHBvcnRzLnN0b3JhZ2UgPSAndW5kZWZpbmVkJyAhPSB0eXBlb2YgY2hyb21lXG4gICAgICAgICAgICAgICAmJiAndW5kZWZpbmVkJyAhPSB0eXBlb2YgY2hyb21lLnN0b3JhZ2VcbiAgICAgICAgICAgICAgICAgID8gY2hyb21lLnN0b3JhZ2UubG9jYWxcbiAgICAgICAgICAgICAgICAgIDogbG9jYWxzdG9yYWdlKCk7XG5cbi8qKlxuICogQ29sb3JzLlxuICovXG5cbmV4cG9ydHMuY29sb3JzID0gW1xuICAnIzAwMDBDQycsICcjMDAwMEZGJywgJyMwMDMzQ0MnLCAnIzAwMzNGRicsICcjMDA2NkNDJywgJyMwMDY2RkYnLCAnIzAwOTlDQycsXG4gICcjMDA5OUZGJywgJyMwMENDMDAnLCAnIzAwQ0MzMycsICcjMDBDQzY2JywgJyMwMENDOTknLCAnIzAwQ0NDQycsICcjMDBDQ0ZGJyxcbiAgJyMzMzAwQ0MnLCAnIzMzMDBGRicsICcjMzMzM0NDJywgJyMzMzMzRkYnLCAnIzMzNjZDQycsICcjMzM2NkZGJywgJyMzMzk5Q0MnLFxuICAnIzMzOTlGRicsICcjMzNDQzAwJywgJyMzM0NDMzMnLCAnIzMzQ0M2NicsICcjMzNDQzk5JywgJyMzM0NDQ0MnLCAnIzMzQ0NGRicsXG4gICcjNjYwMENDJywgJyM2NjAwRkYnLCAnIzY2MzNDQycsICcjNjYzM0ZGJywgJyM2NkNDMDAnLCAnIzY2Q0MzMycsICcjOTkwMENDJyxcbiAgJyM5OTAwRkYnLCAnIzk5MzNDQycsICcjOTkzM0ZGJywgJyM5OUNDMDAnLCAnIzk5Q0MzMycsICcjQ0MwMDAwJywgJyNDQzAwMzMnLFxuICAnI0NDMDA2NicsICcjQ0MwMDk5JywgJyNDQzAwQ0MnLCAnI0NDMDBGRicsICcjQ0MzMzAwJywgJyNDQzMzMzMnLCAnI0NDMzM2NicsXG4gICcjQ0MzMzk5JywgJyNDQzMzQ0MnLCAnI0NDMzNGRicsICcjQ0M2NjAwJywgJyNDQzY2MzMnLCAnI0NDOTkwMCcsICcjQ0M5OTMzJyxcbiAgJyNDQ0NDMDAnLCAnI0NDQ0MzMycsICcjRkYwMDAwJywgJyNGRjAwMzMnLCAnI0ZGMDA2NicsICcjRkYwMDk5JywgJyNGRjAwQ0MnLFxuICAnI0ZGMDBGRicsICcjRkYzMzAwJywgJyNGRjMzMzMnLCAnI0ZGMzM2NicsICcjRkYzMzk5JywgJyNGRjMzQ0MnLCAnI0ZGMzNGRicsXG4gICcjRkY2NjAwJywgJyNGRjY2MzMnLCAnI0ZGOTkwMCcsICcjRkY5OTMzJywgJyNGRkNDMDAnLCAnI0ZGQ0MzMydcbl07XG5cbi8qKlxuICogQ3VycmVudGx5IG9ubHkgV2ViS2l0LWJhc2VkIFdlYiBJbnNwZWN0b3JzLCBGaXJlZm94ID49IHYzMSxcbiAqIGFuZCB0aGUgRmlyZWJ1ZyBleHRlbnNpb24gKGFueSBGaXJlZm94IHZlcnNpb24pIGFyZSBrbm93blxuICogdG8gc3VwcG9ydCBcIiVjXCIgQ1NTIGN1c3RvbWl6YXRpb25zLlxuICpcbiAqIFRPRE86IGFkZCBhIGBsb2NhbFN0b3JhZ2VgIHZhcmlhYmxlIHRvIGV4cGxpY2l0bHkgZW5hYmxlL2Rpc2FibGUgY29sb3JzXG4gKi9cblxuZnVuY3Rpb24gdXNlQ29sb3JzKCkge1xuICAvLyBOQjogSW4gYW4gRWxlY3Ryb24gcHJlbG9hZCBzY3JpcHQsIGRvY3VtZW50IHdpbGwgYmUgZGVmaW5lZCBidXQgbm90IGZ1bGx5XG4gIC8vIGluaXRpYWxpemVkLiBTaW5jZSB3ZSBrbm93IHdlJ3JlIGluIENocm9tZSwgd2UnbGwganVzdCBkZXRlY3QgdGhpcyBjYXNlXG4gIC8vIGV4cGxpY2l0bHlcbiAgaWYgKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHdpbmRvdy5wcm9jZXNzICYmIHdpbmRvdy5wcm9jZXNzLnR5cGUgPT09ICdyZW5kZXJlcicpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vIEludGVybmV0IEV4cGxvcmVyIGFuZCBFZGdlIGRvIG5vdCBzdXBwb3J0IGNvbG9ycy5cbiAgaWYgKHR5cGVvZiBuYXZpZ2F0b3IgIT09ICd1bmRlZmluZWQnICYmIG5hdmlnYXRvci51c2VyQWdlbnQgJiYgbmF2aWdhdG9yLnVzZXJBZ2VudC50b0xvd2VyQ2FzZSgpLm1hdGNoKC8oZWRnZXx0cmlkZW50KVxcLyhcXGQrKS8pKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gaXMgd2Via2l0PyBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vYS8xNjQ1OTYwNi8zNzY3NzNcbiAgLy8gZG9jdW1lbnQgaXMgdW5kZWZpbmVkIGluIHJlYWN0LW5hdGl2ZTogaHR0cHM6Ly9naXRodWIuY29tL2ZhY2Vib29rL3JlYWN0LW5hdGl2ZS9wdWxsLzE2MzJcbiAgcmV0dXJuICh0eXBlb2YgZG9jdW1lbnQgIT09ICd1bmRlZmluZWQnICYmIGRvY3VtZW50LmRvY3VtZW50RWxlbWVudCAmJiBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc3R5bGUgJiYgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnN0eWxlLldlYmtpdEFwcGVhcmFuY2UpIHx8XG4gICAgLy8gaXMgZmlyZWJ1Zz8gaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL2EvMzk4MTIwLzM3Njc3M1xuICAgICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJiB3aW5kb3cuY29uc29sZSAmJiAod2luZG93LmNvbnNvbGUuZmlyZWJ1ZyB8fCAod2luZG93LmNvbnNvbGUuZXhjZXB0aW9uICYmIHdpbmRvdy5jb25zb2xlLnRhYmxlKSkpIHx8XG4gICAgLy8gaXMgZmlyZWZveCA+PSB2MzE/XG4gICAgLy8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9Ub29scy9XZWJfQ29uc29sZSNTdHlsaW5nX21lc3NhZ2VzXG4gICAgKHR5cGVvZiBuYXZpZ2F0b3IgIT09ICd1bmRlZmluZWQnICYmIG5hdmlnYXRvci51c2VyQWdlbnQgJiYgbmF2aWdhdG9yLnVzZXJBZ2VudC50b0xvd2VyQ2FzZSgpLm1hdGNoKC9maXJlZm94XFwvKFxcZCspLykgJiYgcGFyc2VJbnQoUmVnRXhwLiQxLCAxMCkgPj0gMzEpIHx8XG4gICAgLy8gZG91YmxlIGNoZWNrIHdlYmtpdCBpbiB1c2VyQWdlbnQganVzdCBpbiBjYXNlIHdlIGFyZSBpbiBhIHdvcmtlclxuICAgICh0eXBlb2YgbmF2aWdhdG9yICE9PSAndW5kZWZpbmVkJyAmJiBuYXZpZ2F0b3IudXNlckFnZW50ICYmIG5hdmlnYXRvci51c2VyQWdlbnQudG9Mb3dlckNhc2UoKS5tYXRjaCgvYXBwbGV3ZWJraXRcXC8oXFxkKykvKSk7XG59XG5cbi8qKlxuICogTWFwICVqIHRvIGBKU09OLnN0cmluZ2lmeSgpYCwgc2luY2Ugbm8gV2ViIEluc3BlY3RvcnMgZG8gdGhhdCBieSBkZWZhdWx0LlxuICovXG5cbmV4cG9ydHMuZm9ybWF0dGVycy5qID0gZnVuY3Rpb24odikge1xuICB0cnkge1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgcmV0dXJuICdbVW5leHBlY3RlZEpTT05QYXJzZUVycm9yXTogJyArIGVyci5tZXNzYWdlO1xuICB9XG59O1xuXG5cbi8qKlxuICogQ29sb3JpemUgbG9nIGFyZ3VtZW50cyBpZiBlbmFibGVkLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gZm9ybWF0QXJncyhhcmdzKSB7XG4gIHZhciB1c2VDb2xvcnMgPSB0aGlzLnVzZUNvbG9ycztcblxuICBhcmdzWzBdID0gKHVzZUNvbG9ycyA/ICclYycgOiAnJylcbiAgICArIHRoaXMubmFtZXNwYWNlXG4gICAgKyAodXNlQ29sb3JzID8gJyAlYycgOiAnICcpXG4gICAgKyBhcmdzWzBdXG4gICAgKyAodXNlQ29sb3JzID8gJyVjICcgOiAnICcpXG4gICAgKyAnKycgKyBleHBvcnRzLmh1bWFuaXplKHRoaXMuZGlmZik7XG5cbiAgaWYgKCF1c2VDb2xvcnMpIHJldHVybjtcblxuICB2YXIgYyA9ICdjb2xvcjogJyArIHRoaXMuY29sb3I7XG4gIGFyZ3Muc3BsaWNlKDEsIDAsIGMsICdjb2xvcjogaW5oZXJpdCcpXG5cbiAgLy8gdGhlIGZpbmFsIFwiJWNcIiBpcyBzb21ld2hhdCB0cmlja3ksIGJlY2F1c2UgdGhlcmUgY291bGQgYmUgb3RoZXJcbiAgLy8gYXJndW1lbnRzIHBhc3NlZCBlaXRoZXIgYmVmb3JlIG9yIGFmdGVyIHRoZSAlYywgc28gd2UgbmVlZCB0b1xuICAvLyBmaWd1cmUgb3V0IHRoZSBjb3JyZWN0IGluZGV4IHRvIGluc2VydCB0aGUgQ1NTIGludG9cbiAgdmFyIGluZGV4ID0gMDtcbiAgdmFyIGxhc3RDID0gMDtcbiAgYXJnc1swXS5yZXBsYWNlKC8lW2EtekEtWiVdL2csIGZ1bmN0aW9uKG1hdGNoKSB7XG4gICAgaWYgKCclJScgPT09IG1hdGNoKSByZXR1cm47XG4gICAgaW5kZXgrKztcbiAgICBpZiAoJyVjJyA9PT0gbWF0Y2gpIHtcbiAgICAgIC8vIHdlIG9ubHkgYXJlIGludGVyZXN0ZWQgaW4gdGhlICpsYXN0KiAlY1xuICAgICAgLy8gKHRoZSB1c2VyIG1heSBoYXZlIHByb3ZpZGVkIHRoZWlyIG93bilcbiAgICAgIGxhc3RDID0gaW5kZXg7XG4gICAgfVxuICB9KTtcblxuICBhcmdzLnNwbGljZShsYXN0QywgMCwgYyk7XG59XG5cbi8qKlxuICogSW52b2tlcyBgY29uc29sZS5sb2coKWAgd2hlbiBhdmFpbGFibGUuXG4gKiBOby1vcCB3aGVuIGBjb25zb2xlLmxvZ2AgaXMgbm90IGEgXCJmdW5jdGlvblwiLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gbG9nKCkge1xuICAvLyB0aGlzIGhhY2tlcnkgaXMgcmVxdWlyZWQgZm9yIElFOC85LCB3aGVyZVxuICAvLyB0aGUgYGNvbnNvbGUubG9nYCBmdW5jdGlvbiBkb2Vzbid0IGhhdmUgJ2FwcGx5J1xuICByZXR1cm4gJ29iamVjdCcgPT09IHR5cGVvZiBjb25zb2xlXG4gICAgJiYgY29uc29sZS5sb2dcbiAgICAmJiBGdW5jdGlvbi5wcm90b3R5cGUuYXBwbHkuY2FsbChjb25zb2xlLmxvZywgY29uc29sZSwgYXJndW1lbnRzKTtcbn1cblxuLyoqXG4gKiBTYXZlIGBuYW1lc3BhY2VzYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZXNwYWNlc1xuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gc2F2ZShuYW1lc3BhY2VzKSB7XG4gIHRyeSB7XG4gICAgaWYgKG51bGwgPT0gbmFtZXNwYWNlcykge1xuICAgICAgZXhwb3J0cy5zdG9yYWdlLnJlbW92ZUl0ZW0oJ2RlYnVnJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGV4cG9ydHMuc3RvcmFnZS5kZWJ1ZyA9IG5hbWVzcGFjZXM7XG4gICAgfVxuICB9IGNhdGNoKGUpIHt9XG59XG5cbi8qKlxuICogTG9hZCBgbmFtZXNwYWNlc2AuXG4gKlxuICogQHJldHVybiB7U3RyaW5nfSByZXR1cm5zIHRoZSBwcmV2aW91c2x5IHBlcnNpc3RlZCBkZWJ1ZyBtb2Rlc1xuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gbG9hZCgpIHtcbiAgdmFyIHI7XG4gIHRyeSB7XG4gICAgciA9IGV4cG9ydHMuc3RvcmFnZS5kZWJ1ZztcbiAgfSBjYXRjaChlKSB7fVxuXG4gIC8vIElmIGRlYnVnIGlzbid0IHNldCBpbiBMUywgYW5kIHdlJ3JlIGluIEVsZWN0cm9uLCB0cnkgdG8gbG9hZCAkREVCVUdcbiAgaWYgKCFyICYmIHR5cGVvZiBwcm9jZXNzICE9PSAndW5kZWZpbmVkJyAmJiAnZW52JyBpbiBwcm9jZXNzKSB7XG4gICAgciA9IHByb2Nlc3MuZW52LkRFQlVHO1xuICB9XG5cbiAgcmV0dXJuIHI7XG59XG5cbi8qKlxuICogRW5hYmxlIG5hbWVzcGFjZXMgbGlzdGVkIGluIGBsb2NhbFN0b3JhZ2UuZGVidWdgIGluaXRpYWxseS5cbiAqL1xuXG5leHBvcnRzLmVuYWJsZShsb2FkKCkpO1xuXG4vKipcbiAqIExvY2Fsc3RvcmFnZSBhdHRlbXB0cyB0byByZXR1cm4gdGhlIGxvY2Fsc3RvcmFnZS5cbiAqXG4gKiBUaGlzIGlzIG5lY2Vzc2FyeSBiZWNhdXNlIHNhZmFyaSB0aHJvd3NcbiAqIHdoZW4gYSB1c2VyIGRpc2FibGVzIGNvb2tpZXMvbG9jYWxzdG9yYWdlXG4gKiBhbmQgeW91IGF0dGVtcHQgdG8gYWNjZXNzIGl0LlxuICpcbiAqIEByZXR1cm4ge0xvY2FsU3RvcmFnZX1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGxvY2Fsc3RvcmFnZSgpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gd2luZG93LmxvY2FsU3RvcmFnZTtcbiAgfSBjYXRjaCAoZSkge31cbn1cbiIsIlxyXG4vKipcclxuICogRXhwb3NlIGBFbWl0dGVyYC5cclxuICovXHJcblxyXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcpIHtcclxuICBtb2R1bGUuZXhwb3J0cyA9IEVtaXR0ZXI7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBJbml0aWFsaXplIGEgbmV3IGBFbWl0dGVyYC5cclxuICpcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5mdW5jdGlvbiBFbWl0dGVyKG9iaikge1xyXG4gIGlmIChvYmopIHJldHVybiBtaXhpbihvYmopO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIE1peGluIHRoZSBlbWl0dGVyIHByb3BlcnRpZXMuXHJcbiAqXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmpcclxuICogQHJldHVybiB7T2JqZWN0fVxyXG4gKiBAYXBpIHByaXZhdGVcclxuICovXHJcblxyXG5mdW5jdGlvbiBtaXhpbihvYmopIHtcclxuICBmb3IgKHZhciBrZXkgaW4gRW1pdHRlci5wcm90b3R5cGUpIHtcclxuICAgIG9ialtrZXldID0gRW1pdHRlci5wcm90b3R5cGVba2V5XTtcclxuICB9XHJcbiAgcmV0dXJuIG9iajtcclxufVxyXG5cclxuLyoqXHJcbiAqIExpc3RlbiBvbiB0aGUgZ2l2ZW4gYGV2ZW50YCB3aXRoIGBmbmAuXHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBldmVudFxyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxyXG4gKiBAcmV0dXJuIHtFbWl0dGVyfVxyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcbkVtaXR0ZXIucHJvdG90eXBlLm9uID1cclxuRW1pdHRlci5wcm90b3R5cGUuYWRkRXZlbnRMaXN0ZW5lciA9IGZ1bmN0aW9uKGV2ZW50LCBmbil7XHJcbiAgdGhpcy5fY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzIHx8IHt9O1xyXG4gICh0aGlzLl9jYWxsYmFja3NbJyQnICsgZXZlbnRdID0gdGhpcy5fY2FsbGJhY2tzWyckJyArIGV2ZW50XSB8fCBbXSlcclxuICAgIC5wdXNoKGZuKTtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBBZGRzIGFuIGBldmVudGAgbGlzdGVuZXIgdGhhdCB3aWxsIGJlIGludm9rZWQgYSBzaW5nbGVcclxuICogdGltZSB0aGVuIGF1dG9tYXRpY2FsbHkgcmVtb3ZlZC5cclxuICpcclxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XHJcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuXHJcbiAqIEByZXR1cm4ge0VtaXR0ZXJ9XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuRW1pdHRlci5wcm90b3R5cGUub25jZSA9IGZ1bmN0aW9uKGV2ZW50LCBmbil7XHJcbiAgZnVuY3Rpb24gb24oKSB7XHJcbiAgICB0aGlzLm9mZihldmVudCwgb24pO1xyXG4gICAgZm4uYXBwbHkodGhpcywgYXJndW1lbnRzKTtcclxuICB9XHJcblxyXG4gIG9uLmZuID0gZm47XHJcbiAgdGhpcy5vbihldmVudCwgb24pO1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJlbW92ZSB0aGUgZ2l2ZW4gY2FsbGJhY2sgZm9yIGBldmVudGAgb3IgYWxsXHJcbiAqIHJlZ2lzdGVyZWQgY2FsbGJhY2tzLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gZXZlbnRcclxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cclxuICogQHJldHVybiB7RW1pdHRlcn1cclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5FbWl0dGVyLnByb3RvdHlwZS5vZmYgPVxyXG5FbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVMaXN0ZW5lciA9XHJcbkVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUFsbExpc3RlbmVycyA9XHJcbkVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUV2ZW50TGlzdGVuZXIgPSBmdW5jdGlvbihldmVudCwgZm4pe1xyXG4gIHRoaXMuX2NhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrcyB8fCB7fTtcclxuXHJcbiAgLy8gYWxsXHJcbiAgaWYgKDAgPT0gYXJndW1lbnRzLmxlbmd0aCkge1xyXG4gICAgdGhpcy5fY2FsbGJhY2tzID0ge307XHJcbiAgICByZXR1cm4gdGhpcztcclxuICB9XHJcblxyXG4gIC8vIHNwZWNpZmljIGV2ZW50XHJcbiAgdmFyIGNhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrc1snJCcgKyBldmVudF07XHJcbiAgaWYgKCFjYWxsYmFja3MpIHJldHVybiB0aGlzO1xyXG5cclxuICAvLyByZW1vdmUgYWxsIGhhbmRsZXJzXHJcbiAgaWYgKDEgPT0gYXJndW1lbnRzLmxlbmd0aCkge1xyXG4gICAgZGVsZXRlIHRoaXMuX2NhbGxiYWNrc1snJCcgKyBldmVudF07XHJcbiAgICByZXR1cm4gdGhpcztcclxuICB9XHJcblxyXG4gIC8vIHJlbW92ZSBzcGVjaWZpYyBoYW5kbGVyXHJcbiAgdmFyIGNiO1xyXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgY2FsbGJhY2tzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICBjYiA9IGNhbGxiYWNrc1tpXTtcclxuICAgIGlmIChjYiA9PT0gZm4gfHwgY2IuZm4gPT09IGZuKSB7XHJcbiAgICAgIGNhbGxiYWNrcy5zcGxpY2UoaSwgMSk7XHJcbiAgICAgIGJyZWFrO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBFbWl0IGBldmVudGAgd2l0aCB0aGUgZ2l2ZW4gYXJncy5cclxuICpcclxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XHJcbiAqIEBwYXJhbSB7TWl4ZWR9IC4uLlxyXG4gKiBAcmV0dXJuIHtFbWl0dGVyfVxyXG4gKi9cclxuXHJcbkVtaXR0ZXIucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbihldmVudCl7XHJcbiAgdGhpcy5fY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzIHx8IHt9O1xyXG4gIHZhciBhcmdzID0gW10uc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpXHJcbiAgICAsIGNhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrc1snJCcgKyBldmVudF07XHJcblxyXG4gIGlmIChjYWxsYmFja3MpIHtcclxuICAgIGNhbGxiYWNrcyA9IGNhbGxiYWNrcy5zbGljZSgwKTtcclxuICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBjYWxsYmFja3MubGVuZ3RoOyBpIDwgbGVuOyArK2kpIHtcclxuICAgICAgY2FsbGJhY2tzW2ldLmFwcGx5KHRoaXMsIGFyZ3MpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHRoaXM7XHJcbn07XHJcblxyXG4vKipcclxuICogUmV0dXJuIGFycmF5IG9mIGNhbGxiYWNrcyBmb3IgYGV2ZW50YC5cclxuICpcclxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XHJcbiAqIEByZXR1cm4ge0FycmF5fVxyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcbkVtaXR0ZXIucHJvdG90eXBlLmxpc3RlbmVycyA9IGZ1bmN0aW9uKGV2ZW50KXtcclxuICB0aGlzLl9jYWxsYmFja3MgPSB0aGlzLl9jYWxsYmFja3MgfHwge307XHJcbiAgcmV0dXJuIHRoaXMuX2NhbGxiYWNrc1snJCcgKyBldmVudF0gfHwgW107XHJcbn07XHJcblxyXG4vKipcclxuICogQ2hlY2sgaWYgdGhpcyBlbWl0dGVyIGhhcyBgZXZlbnRgIGhhbmRsZXJzLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gZXZlbnRcclxuICogQHJldHVybiB7Qm9vbGVhbn1cclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5FbWl0dGVyLnByb3RvdHlwZS5oYXNMaXN0ZW5lcnMgPSBmdW5jdGlvbihldmVudCl7XHJcbiAgcmV0dXJuICEhIHRoaXMubGlzdGVuZXJzKGV2ZW50KS5sZW5ndGg7XHJcbn07XHJcbiIsInZhciB0b1N0cmluZyA9IHt9LnRvU3RyaW5nO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEFycmF5LmlzQXJyYXkgfHwgZnVuY3Rpb24gKGFycikge1xuICByZXR1cm4gdG9TdHJpbmcuY2FsbChhcnIpID09ICdbb2JqZWN0IEFycmF5XSc7XG59O1xuIiwiXG52YXIgbG9va3VwID0gW11cbnZhciByZXZMb29rdXAgPSBbXVxudmFyIEFyciA9IHR5cGVvZiBVaW50OEFycmF5ICE9PSAndW5kZWZpbmVkJyA/IFVpbnQ4QXJyYXkgOiBBcnJheVxudmFyIGluaXRlZCA9IGZhbHNlO1xuZnVuY3Rpb24gaW5pdCAoKSB7XG4gIGluaXRlZCA9IHRydWU7XG4gIHZhciBjb2RlID0gJ0FCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5Ky8nXG4gIGZvciAodmFyIGkgPSAwLCBsZW4gPSBjb2RlLmxlbmd0aDsgaSA8IGxlbjsgKytpKSB7XG4gICAgbG9va3VwW2ldID0gY29kZVtpXVxuICAgIHJldkxvb2t1cFtjb2RlLmNoYXJDb2RlQXQoaSldID0gaVxuICB9XG5cbiAgcmV2TG9va3VwWyctJy5jaGFyQ29kZUF0KDApXSA9IDYyXG4gIHJldkxvb2t1cFsnXycuY2hhckNvZGVBdCgwKV0gPSA2M1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdG9CeXRlQXJyYXkgKGI2NCkge1xuICBpZiAoIWluaXRlZCkge1xuICAgIGluaXQoKTtcbiAgfVxuICB2YXIgaSwgaiwgbCwgdG1wLCBwbGFjZUhvbGRlcnMsIGFyclxuICB2YXIgbGVuID0gYjY0Lmxlbmd0aFxuXG4gIGlmIChsZW4gJSA0ID4gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBzdHJpbmcuIExlbmd0aCBtdXN0IGJlIGEgbXVsdGlwbGUgb2YgNCcpXG4gIH1cblxuICAvLyB0aGUgbnVtYmVyIG9mIGVxdWFsIHNpZ25zIChwbGFjZSBob2xkZXJzKVxuICAvLyBpZiB0aGVyZSBhcmUgdHdvIHBsYWNlaG9sZGVycywgdGhhbiB0aGUgdHdvIGNoYXJhY3RlcnMgYmVmb3JlIGl0XG4gIC8vIHJlcHJlc2VudCBvbmUgYnl0ZVxuICAvLyBpZiB0aGVyZSBpcyBvbmx5IG9uZSwgdGhlbiB0aGUgdGhyZWUgY2hhcmFjdGVycyBiZWZvcmUgaXQgcmVwcmVzZW50IDIgYnl0ZXNcbiAgLy8gdGhpcyBpcyBqdXN0IGEgY2hlYXAgaGFjayB0byBub3QgZG8gaW5kZXhPZiB0d2ljZVxuICBwbGFjZUhvbGRlcnMgPSBiNjRbbGVuIC0gMl0gPT09ICc9JyA/IDIgOiBiNjRbbGVuIC0gMV0gPT09ICc9JyA/IDEgOiAwXG5cbiAgLy8gYmFzZTY0IGlzIDQvMyArIHVwIHRvIHR3byBjaGFyYWN0ZXJzIG9mIHRoZSBvcmlnaW5hbCBkYXRhXG4gIGFyciA9IG5ldyBBcnIobGVuICogMyAvIDQgLSBwbGFjZUhvbGRlcnMpXG5cbiAgLy8gaWYgdGhlcmUgYXJlIHBsYWNlaG9sZGVycywgb25seSBnZXQgdXAgdG8gdGhlIGxhc3QgY29tcGxldGUgNCBjaGFyc1xuICBsID0gcGxhY2VIb2xkZXJzID4gMCA/IGxlbiAtIDQgOiBsZW5cblxuICB2YXIgTCA9IDBcblxuICBmb3IgKGkgPSAwLCBqID0gMDsgaSA8IGw7IGkgKz0gNCwgaiArPSAzKSB7XG4gICAgdG1wID0gKHJldkxvb2t1cFtiNjQuY2hhckNvZGVBdChpKV0gPDwgMTgpIHwgKHJldkxvb2t1cFtiNjQuY2hhckNvZGVBdChpICsgMSldIDw8IDEyKSB8IChyZXZMb29rdXBbYjY0LmNoYXJDb2RlQXQoaSArIDIpXSA8PCA2KSB8IHJldkxvb2t1cFtiNjQuY2hhckNvZGVBdChpICsgMyldXG4gICAgYXJyW0wrK10gPSAodG1wID4+IDE2KSAmIDB4RkZcbiAgICBhcnJbTCsrXSA9ICh0bXAgPj4gOCkgJiAweEZGXG4gICAgYXJyW0wrK10gPSB0bXAgJiAweEZGXG4gIH1cblxuICBpZiAocGxhY2VIb2xkZXJzID09PSAyKSB7XG4gICAgdG1wID0gKHJldkxvb2t1cFtiNjQuY2hhckNvZGVBdChpKV0gPDwgMikgfCAocmV2TG9va3VwW2I2NC5jaGFyQ29kZUF0KGkgKyAxKV0gPj4gNClcbiAgICBhcnJbTCsrXSA9IHRtcCAmIDB4RkZcbiAgfSBlbHNlIGlmIChwbGFjZUhvbGRlcnMgPT09IDEpIHtcbiAgICB0bXAgPSAocmV2TG9va3VwW2I2NC5jaGFyQ29kZUF0KGkpXSA8PCAxMCkgfCAocmV2TG9va3VwW2I2NC5jaGFyQ29kZUF0KGkgKyAxKV0gPDwgNCkgfCAocmV2TG9va3VwW2I2NC5jaGFyQ29kZUF0KGkgKyAyKV0gPj4gMilcbiAgICBhcnJbTCsrXSA9ICh0bXAgPj4gOCkgJiAweEZGXG4gICAgYXJyW0wrK10gPSB0bXAgJiAweEZGXG4gIH1cblxuICByZXR1cm4gYXJyXG59XG5cbmZ1bmN0aW9uIHRyaXBsZXRUb0Jhc2U2NCAobnVtKSB7XG4gIHJldHVybiBsb29rdXBbbnVtID4+IDE4ICYgMHgzRl0gKyBsb29rdXBbbnVtID4+IDEyICYgMHgzRl0gKyBsb29rdXBbbnVtID4+IDYgJiAweDNGXSArIGxvb2t1cFtudW0gJiAweDNGXVxufVxuXG5mdW5jdGlvbiBlbmNvZGVDaHVuayAodWludDgsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHRtcFxuICB2YXIgb3V0cHV0ID0gW11cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpICs9IDMpIHtcbiAgICB0bXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pXG4gICAgb3V0cHV0LnB1c2godHJpcGxldFRvQmFzZTY0KHRtcCkpXG4gIH1cbiAgcmV0dXJuIG91dHB1dC5qb2luKCcnKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZnJvbUJ5dGVBcnJheSAodWludDgpIHtcbiAgaWYgKCFpbml0ZWQpIHtcbiAgICBpbml0KCk7XG4gIH1cbiAgdmFyIHRtcFxuICB2YXIgbGVuID0gdWludDgubGVuZ3RoXG4gIHZhciBleHRyYUJ5dGVzID0gbGVuICUgMyAvLyBpZiB3ZSBoYXZlIDEgYnl0ZSBsZWZ0LCBwYWQgMiBieXRlc1xuICB2YXIgb3V0cHV0ID0gJydcbiAgdmFyIHBhcnRzID0gW11cbiAgdmFyIG1heENodW5rTGVuZ3RoID0gMTYzODMgLy8gbXVzdCBiZSBtdWx0aXBsZSBvZiAzXG5cbiAgLy8gZ28gdGhyb3VnaCB0aGUgYXJyYXkgZXZlcnkgdGhyZWUgYnl0ZXMsIHdlJ2xsIGRlYWwgd2l0aCB0cmFpbGluZyBzdHVmZiBsYXRlclxuICBmb3IgKHZhciBpID0gMCwgbGVuMiA9IGxlbiAtIGV4dHJhQnl0ZXM7IGkgPCBsZW4yOyBpICs9IG1heENodW5rTGVuZ3RoKSB7XG4gICAgcGFydHMucHVzaChlbmNvZGVDaHVuayh1aW50OCwgaSwgKGkgKyBtYXhDaHVua0xlbmd0aCkgPiBsZW4yID8gbGVuMiA6IChpICsgbWF4Q2h1bmtMZW5ndGgpKSlcbiAgfVxuXG4gIC8vIHBhZCB0aGUgZW5kIHdpdGggemVyb3MsIGJ1dCBtYWtlIHN1cmUgdG8gbm90IGZvcmdldCB0aGUgZXh0cmEgYnl0ZXNcbiAgaWYgKGV4dHJhQnl0ZXMgPT09IDEpIHtcbiAgICB0bXAgPSB1aW50OFtsZW4gLSAxXVxuICAgIG91dHB1dCArPSBsb29rdXBbdG1wID4+IDJdXG4gICAgb3V0cHV0ICs9IGxvb2t1cFsodG1wIDw8IDQpICYgMHgzRl1cbiAgICBvdXRwdXQgKz0gJz09J1xuICB9IGVsc2UgaWYgKGV4dHJhQnl0ZXMgPT09IDIpIHtcbiAgICB0bXAgPSAodWludDhbbGVuIC0gMl0gPDwgOCkgKyAodWludDhbbGVuIC0gMV0pXG4gICAgb3V0cHV0ICs9IGxvb2t1cFt0bXAgPj4gMTBdXG4gICAgb3V0cHV0ICs9IGxvb2t1cFsodG1wID4+IDQpICYgMHgzRl1cbiAgICBvdXRwdXQgKz0gbG9va3VwWyh0bXAgPDwgMikgJiAweDNGXVxuICAgIG91dHB1dCArPSAnPSdcbiAgfVxuXG4gIHBhcnRzLnB1c2gob3V0cHV0KVxuXG4gIHJldHVybiBwYXJ0cy5qb2luKCcnKVxufVxuIiwiXG5leHBvcnQgZnVuY3Rpb24gcmVhZCAoYnVmZmVyLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbVxuICB2YXIgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMVxuICB2YXIgZU1heCA9ICgxIDw8IGVMZW4pIC0gMVxuICB2YXIgZUJpYXMgPSBlTWF4ID4+IDFcbiAgdmFyIG5CaXRzID0gLTdcbiAgdmFyIGkgPSBpc0xFID8gKG5CeXRlcyAtIDEpIDogMFxuICB2YXIgZCA9IGlzTEUgPyAtMSA6IDFcbiAgdmFyIHMgPSBidWZmZXJbb2Zmc2V0ICsgaV1cblxuICBpICs9IGRcblxuICBlID0gcyAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKVxuICBzID4+PSAoLW5CaXRzKVxuICBuQml0cyArPSBlTGVuXG4gIGZvciAoOyBuQml0cyA+IDA7IGUgPSBlICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpIHt9XG5cbiAgbSA9IGUgJiAoKDEgPDwgKC1uQml0cykpIC0gMSlcbiAgZSA+Pj0gKC1uQml0cylcbiAgbkJpdHMgKz0gbUxlblxuICBmb3IgKDsgbkJpdHMgPiAwOyBtID0gbSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KSB7fVxuXG4gIGlmIChlID09PSAwKSB7XG4gICAgZSA9IDEgLSBlQmlhc1xuICB9IGVsc2UgaWYgKGUgPT09IGVNYXgpIHtcbiAgICByZXR1cm4gbSA/IE5hTiA6ICgocyA/IC0xIDogMSkgKiBJbmZpbml0eSlcbiAgfSBlbHNlIHtcbiAgICBtID0gbSArIE1hdGgucG93KDIsIG1MZW4pXG4gICAgZSA9IGUgLSBlQmlhc1xuICB9XG4gIHJldHVybiAocyA/IC0xIDogMSkgKiBtICogTWF0aC5wb3coMiwgZSAtIG1MZW4pXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB3cml0ZSAoYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sIGNcbiAgdmFyIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDFcbiAgdmFyIGVNYXggPSAoMSA8PCBlTGVuKSAtIDFcbiAgdmFyIGVCaWFzID0gZU1heCA+PiAxXG4gIHZhciBydCA9IChtTGVuID09PSAyMyA/IE1hdGgucG93KDIsIC0yNCkgLSBNYXRoLnBvdygyLCAtNzcpIDogMClcbiAgdmFyIGkgPSBpc0xFID8gMCA6IChuQnl0ZXMgLSAxKVxuICB2YXIgZCA9IGlzTEUgPyAxIDogLTFcbiAgdmFyIHMgPSB2YWx1ZSA8IDAgfHwgKHZhbHVlID09PSAwICYmIDEgLyB2YWx1ZSA8IDApID8gMSA6IDBcblxuICB2YWx1ZSA9IE1hdGguYWJzKHZhbHVlKVxuXG4gIGlmIChpc05hTih2YWx1ZSkgfHwgdmFsdWUgPT09IEluZmluaXR5KSB7XG4gICAgbSA9IGlzTmFOKHZhbHVlKSA/IDEgOiAwXG4gICAgZSA9IGVNYXhcbiAgfSBlbHNlIHtcbiAgICBlID0gTWF0aC5mbG9vcihNYXRoLmxvZyh2YWx1ZSkgLyBNYXRoLkxOMilcbiAgICBpZiAodmFsdWUgKiAoYyA9IE1hdGgucG93KDIsIC1lKSkgPCAxKSB7XG4gICAgICBlLS1cbiAgICAgIGMgKj0gMlxuICAgIH1cbiAgICBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIHZhbHVlICs9IHJ0IC8gY1xuICAgIH0gZWxzZSB7XG4gICAgICB2YWx1ZSArPSBydCAqIE1hdGgucG93KDIsIDEgLSBlQmlhcylcbiAgICB9XG4gICAgaWYgKHZhbHVlICogYyA+PSAyKSB7XG4gICAgICBlKytcbiAgICAgIGMgLz0gMlxuICAgIH1cblxuICAgIGlmIChlICsgZUJpYXMgPj0gZU1heCkge1xuICAgICAgbSA9IDBcbiAgICAgIGUgPSBlTWF4XG4gICAgfSBlbHNlIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgbSA9ICh2YWx1ZSAqIGMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pXG4gICAgICBlID0gZSArIGVCaWFzXG4gICAgfSBlbHNlIHtcbiAgICAgIG0gPSB2YWx1ZSAqIE1hdGgucG93KDIsIGVCaWFzIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKVxuICAgICAgZSA9IDBcbiAgICB9XG4gIH1cblxuICBmb3IgKDsgbUxlbiA+PSA4OyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBtICYgMHhmZiwgaSArPSBkLCBtIC89IDI1NiwgbUxlbiAtPSA4KSB7fVxuXG4gIGUgPSAoZSA8PCBtTGVuKSB8IG1cbiAgZUxlbiArPSBtTGVuXG4gIGZvciAoOyBlTGVuID4gMDsgYnVmZmVyW29mZnNldCArIGldID0gZSAmIDB4ZmYsIGkgKz0gZCwgZSAvPSAyNTYsIGVMZW4gLT0gOCkge31cblxuICBidWZmZXJbb2Zmc2V0ICsgaSAtIGRdIHw9IHMgKiAxMjhcbn1cbiIsInZhciB0b1N0cmluZyA9IHt9LnRvU3RyaW5nO1xuXG5leHBvcnQgZGVmYXVsdCBBcnJheS5pc0FycmF5IHx8IGZ1bmN0aW9uIChhcnIpIHtcbiAgcmV0dXJuIHRvU3RyaW5nLmNhbGwoYXJyKSA9PSAnW29iamVjdCBBcnJheV0nO1xufTtcbiIsIi8qIVxuICogVGhlIGJ1ZmZlciBtb2R1bGUgZnJvbSBub2RlLmpzLCBmb3IgdGhlIGJyb3dzZXIuXG4gKlxuICogQGF1dGhvciAgIEZlcm9zcyBBYm91a2hhZGlqZWggPGZlcm9zc0BmZXJvc3Mub3JnPiA8aHR0cDovL2Zlcm9zcy5vcmc+XG4gKiBAbGljZW5zZSAgTUlUXG4gKi9cbi8qIGVzbGludC1kaXNhYmxlIG5vLXByb3RvICovXG5cblxuaW1wb3J0ICogYXMgYmFzZTY0IGZyb20gJy4vYmFzZTY0J1xuaW1wb3J0ICogYXMgaWVlZTc1NCBmcm9tICcuL2llZWU3NTQnXG5pbXBvcnQgaXNBcnJheSBmcm9tICcuL2lzQXJyYXknXG5cbmV4cG9ydCB2YXIgSU5TUEVDVF9NQVhfQllURVMgPSA1MFxuXG4vKipcbiAqIElmIGBCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVGA6XG4gKiAgID09PSB0cnVlICAgIFVzZSBVaW50OEFycmF5IGltcGxlbWVudGF0aW9uIChmYXN0ZXN0KVxuICogICA9PT0gZmFsc2UgICBVc2UgT2JqZWN0IGltcGxlbWVudGF0aW9uIChtb3N0IGNvbXBhdGlibGUsIGV2ZW4gSUU2KVxuICpcbiAqIEJyb3dzZXJzIHRoYXQgc3VwcG9ydCB0eXBlZCBhcnJheXMgYXJlIElFIDEwKywgRmlyZWZveCA0KywgQ2hyb21lIDcrLCBTYWZhcmkgNS4xKyxcbiAqIE9wZXJhIDExLjYrLCBpT1MgNC4yKy5cbiAqXG4gKiBEdWUgdG8gdmFyaW91cyBicm93c2VyIGJ1Z3MsIHNvbWV0aW1lcyB0aGUgT2JqZWN0IGltcGxlbWVudGF0aW9uIHdpbGwgYmUgdXNlZCBldmVuXG4gKiB3aGVuIHRoZSBicm93c2VyIHN1cHBvcnRzIHR5cGVkIGFycmF5cy5cbiAqXG4gKiBOb3RlOlxuICpcbiAqICAgLSBGaXJlZm94IDQtMjkgbGFja3Mgc3VwcG9ydCBmb3IgYWRkaW5nIG5ldyBwcm9wZXJ0aWVzIHRvIGBVaW50OEFycmF5YCBpbnN0YW5jZXMsXG4gKiAgICAgU2VlOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD02OTU0MzguXG4gKlxuICogICAtIENocm9tZSA5LTEwIGlzIG1pc3NpbmcgdGhlIGBUeXBlZEFycmF5LnByb3RvdHlwZS5zdWJhcnJheWAgZnVuY3Rpb24uXG4gKlxuICogICAtIElFMTAgaGFzIGEgYnJva2VuIGBUeXBlZEFycmF5LnByb3RvdHlwZS5zdWJhcnJheWAgZnVuY3Rpb24gd2hpY2ggcmV0dXJucyBhcnJheXMgb2ZcbiAqICAgICBpbmNvcnJlY3QgbGVuZ3RoIGluIHNvbWUgc2l0dWF0aW9ucy5cblxuICogV2UgZGV0ZWN0IHRoZXNlIGJ1Z2d5IGJyb3dzZXJzIGFuZCBzZXQgYEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUYCB0byBgZmFsc2VgIHNvIHRoZXlcbiAqIGdldCB0aGUgT2JqZWN0IGltcGxlbWVudGF0aW9uLCB3aGljaCBpcyBzbG93ZXIgYnV0IGJlaGF2ZXMgY29ycmVjdGx5LlxuICovXG5CdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCA9IGdsb2JhbC5UWVBFRF9BUlJBWV9TVVBQT1JUICE9PSB1bmRlZmluZWRcbiAgPyBnbG9iYWwuVFlQRURfQVJSQVlfU1VQUE9SVFxuICA6IHRydWVcblxuLypcbiAqIEV4cG9ydCBrTWF4TGVuZ3RoIGFmdGVyIHR5cGVkIGFycmF5IHN1cHBvcnQgaXMgZGV0ZXJtaW5lZC5cbiAqL1xudmFyIF9rTWF4TGVuZ3RoID0ga01heExlbmd0aCgpXG5leHBvcnQge19rTWF4TGVuZ3RoIGFzIGtNYXhMZW5ndGh9O1xuZnVuY3Rpb24gdHlwZWRBcnJheVN1cHBvcnQgKCkge1xuICByZXR1cm4gdHJ1ZTtcbiAgLy8gcm9sbHVwIGlzc3Vlc1xuICAvLyB0cnkge1xuICAvLyAgIHZhciBhcnIgPSBuZXcgVWludDhBcnJheSgxKVxuICAvLyAgIGFyci5fX3Byb3RvX18gPSB7XG4gIC8vICAgICBfX3Byb3RvX186IFVpbnQ4QXJyYXkucHJvdG90eXBlLFxuICAvLyAgICAgZm9vOiBmdW5jdGlvbiAoKSB7IHJldHVybiA0MiB9XG4gIC8vICAgfVxuICAvLyAgIHJldHVybiBhcnIuZm9vKCkgPT09IDQyICYmIC8vIHR5cGVkIGFycmF5IGluc3RhbmNlcyBjYW4gYmUgYXVnbWVudGVkXG4gIC8vICAgICAgIHR5cGVvZiBhcnIuc3ViYXJyYXkgPT09ICdmdW5jdGlvbicgJiYgLy8gY2hyb21lIDktMTAgbGFjayBgc3ViYXJyYXlgXG4gIC8vICAgICAgIGFyci5zdWJhcnJheSgxLCAxKS5ieXRlTGVuZ3RoID09PSAwIC8vIGllMTAgaGFzIGJyb2tlbiBgc3ViYXJyYXlgXG4gIC8vIH0gY2F0Y2ggKGUpIHtcbiAgLy8gICByZXR1cm4gZmFsc2VcbiAgLy8gfVxufVxuXG5mdW5jdGlvbiBrTWF4TGVuZ3RoICgpIHtcbiAgcmV0dXJuIEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUXG4gICAgPyAweDdmZmZmZmZmXG4gICAgOiAweDNmZmZmZmZmXG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUJ1ZmZlciAodGhhdCwgbGVuZ3RoKSB7XG4gIGlmIChrTWF4TGVuZ3RoKCkgPCBsZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignSW52YWxpZCB0eXBlZCBhcnJheSBsZW5ndGgnKVxuICB9XG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIC8vIFJldHVybiBhbiBhdWdtZW50ZWQgYFVpbnQ4QXJyYXlgIGluc3RhbmNlLCBmb3IgYmVzdCBwZXJmb3JtYW5jZVxuICAgIHRoYXQgPSBuZXcgVWludDhBcnJheShsZW5ndGgpXG4gICAgdGhhdC5fX3Byb3RvX18gPSBCdWZmZXIucHJvdG90eXBlXG4gIH0gZWxzZSB7XG4gICAgLy8gRmFsbGJhY2s6IFJldHVybiBhbiBvYmplY3QgaW5zdGFuY2Ugb2YgdGhlIEJ1ZmZlciBjbGFzc1xuICAgIGlmICh0aGF0ID09PSBudWxsKSB7XG4gICAgICB0aGF0ID0gbmV3IEJ1ZmZlcihsZW5ndGgpXG4gICAgfVxuICAgIHRoYXQubGVuZ3RoID0gbGVuZ3RoXG4gIH1cblxuICByZXR1cm4gdGhhdFxufVxuXG4vKipcbiAqIFRoZSBCdWZmZXIgY29uc3RydWN0b3IgcmV0dXJucyBpbnN0YW5jZXMgb2YgYFVpbnQ4QXJyYXlgIHRoYXQgaGF2ZSB0aGVpclxuICogcHJvdG90eXBlIGNoYW5nZWQgdG8gYEJ1ZmZlci5wcm90b3R5cGVgLiBGdXJ0aGVybW9yZSwgYEJ1ZmZlcmAgaXMgYSBzdWJjbGFzcyBvZlxuICogYFVpbnQ4QXJyYXlgLCBzbyB0aGUgcmV0dXJuZWQgaW5zdGFuY2VzIHdpbGwgaGF2ZSBhbGwgdGhlIG5vZGUgYEJ1ZmZlcmAgbWV0aG9kc1xuICogYW5kIHRoZSBgVWludDhBcnJheWAgbWV0aG9kcy4gU3F1YXJlIGJyYWNrZXQgbm90YXRpb24gd29ya3MgYXMgZXhwZWN0ZWQgLS0gaXRcbiAqIHJldHVybnMgYSBzaW5nbGUgb2N0ZXQuXG4gKlxuICogVGhlIGBVaW50OEFycmF5YCBwcm90b3R5cGUgcmVtYWlucyB1bm1vZGlmaWVkLlxuICovXG5cbmV4cG9ydCBmdW5jdGlvbiBCdWZmZXIgKGFyZywgZW5jb2RpbmdPck9mZnNldCwgbGVuZ3RoKSB7XG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgJiYgISh0aGlzIGluc3RhbmNlb2YgQnVmZmVyKSkge1xuICAgIHJldHVybiBuZXcgQnVmZmVyKGFyZywgZW5jb2RpbmdPck9mZnNldCwgbGVuZ3RoKVxuICB9XG5cbiAgLy8gQ29tbW9uIGNhc2UuXG4gIGlmICh0eXBlb2YgYXJnID09PSAnbnVtYmVyJykge1xuICAgIGlmICh0eXBlb2YgZW5jb2RpbmdPck9mZnNldCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgJ0lmIGVuY29kaW5nIGlzIHNwZWNpZmllZCB0aGVuIHRoZSBmaXJzdCBhcmd1bWVudCBtdXN0IGJlIGEgc3RyaW5nJ1xuICAgICAgKVxuICAgIH1cbiAgICByZXR1cm4gYWxsb2NVbnNhZmUodGhpcywgYXJnKVxuICB9XG4gIHJldHVybiBmcm9tKHRoaXMsIGFyZywgZW5jb2RpbmdPck9mZnNldCwgbGVuZ3RoKVxufVxuXG5CdWZmZXIucG9vbFNpemUgPSA4MTkyIC8vIG5vdCB1c2VkIGJ5IHRoaXMgaW1wbGVtZW50YXRpb25cblxuLy8gVE9ETzogTGVnYWN5LCBub3QgbmVlZGVkIGFueW1vcmUuIFJlbW92ZSBpbiBuZXh0IG1ham9yIHZlcnNpb24uXG5CdWZmZXIuX2F1Z21lbnQgPSBmdW5jdGlvbiAoYXJyKSB7XG4gIGFyci5fX3Byb3RvX18gPSBCdWZmZXIucHJvdG90eXBlXG4gIHJldHVybiBhcnJcbn1cblxuZnVuY3Rpb24gZnJvbSAodGhhdCwgdmFsdWUsIGVuY29kaW5nT3JPZmZzZXQsIGxlbmd0aCkge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1widmFsdWVcIiBhcmd1bWVudCBtdXN0IG5vdCBiZSBhIG51bWJlcicpXG4gIH1cblxuICBpZiAodHlwZW9mIEFycmF5QnVmZmVyICE9PSAndW5kZWZpbmVkJyAmJiB2YWx1ZSBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSB7XG4gICAgcmV0dXJuIGZyb21BcnJheUJ1ZmZlcih0aGF0LCB2YWx1ZSwgZW5jb2RpbmdPck9mZnNldCwgbGVuZ3RoKVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gZnJvbVN0cmluZyh0aGF0LCB2YWx1ZSwgZW5jb2RpbmdPck9mZnNldClcbiAgfVxuXG4gIHJldHVybiBmcm9tT2JqZWN0KHRoYXQsIHZhbHVlKVxufVxuXG4vKipcbiAqIEZ1bmN0aW9uYWxseSBlcXVpdmFsZW50IHRvIEJ1ZmZlcihhcmcsIGVuY29kaW5nKSBidXQgdGhyb3dzIGEgVHlwZUVycm9yXG4gKiBpZiB2YWx1ZSBpcyBhIG51bWJlci5cbiAqIEJ1ZmZlci5mcm9tKHN0clssIGVuY29kaW5nXSlcbiAqIEJ1ZmZlci5mcm9tKGFycmF5KVxuICogQnVmZmVyLmZyb20oYnVmZmVyKVxuICogQnVmZmVyLmZyb20oYXJyYXlCdWZmZXJbLCBieXRlT2Zmc2V0WywgbGVuZ3RoXV0pXG4gKiovXG5CdWZmZXIuZnJvbSA9IGZ1bmN0aW9uICh2YWx1ZSwgZW5jb2RpbmdPck9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBmcm9tKG51bGwsIHZhbHVlLCBlbmNvZGluZ09yT2Zmc2V0LCBsZW5ndGgpXG59XG5cbmlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICBCdWZmZXIucHJvdG90eXBlLl9fcHJvdG9fXyA9IFVpbnQ4QXJyYXkucHJvdG90eXBlXG4gIEJ1ZmZlci5fX3Byb3RvX18gPSBVaW50OEFycmF5XG4gIGlmICh0eXBlb2YgU3ltYm9sICE9PSAndW5kZWZpbmVkJyAmJiBTeW1ib2wuc3BlY2llcyAmJlxuICAgICAgQnVmZmVyW1N5bWJvbC5zcGVjaWVzXSA9PT0gQnVmZmVyKSB7XG4gICAgLy8gRml4IHN1YmFycmF5KCkgaW4gRVMyMDE2LiBTZWU6IGh0dHBzOi8vZ2l0aHViLmNvbS9mZXJvc3MvYnVmZmVyL3B1bGwvOTdcbiAgICAvLyBPYmplY3QuZGVmaW5lUHJvcGVydHkoQnVmZmVyLCBTeW1ib2wuc3BlY2llcywge1xuICAgIC8vICAgdmFsdWU6IG51bGwsXG4gICAgLy8gICBjb25maWd1cmFibGU6IHRydWVcbiAgICAvLyB9KVxuICB9XG59XG5cbmZ1bmN0aW9uIGFzc2VydFNpemUgKHNpemUpIHtcbiAgaWYgKHR5cGVvZiBzaXplICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1wic2l6ZVwiIGFyZ3VtZW50IG11c3QgYmUgYSBudW1iZXInKVxuICB9IGVsc2UgaWYgKHNpemUgPCAwKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ1wic2l6ZVwiIGFyZ3VtZW50IG11c3Qgbm90IGJlIG5lZ2F0aXZlJylcbiAgfVxufVxuXG5mdW5jdGlvbiBhbGxvYyAodGhhdCwgc2l6ZSwgZmlsbCwgZW5jb2RpbmcpIHtcbiAgYXNzZXJ0U2l6ZShzaXplKVxuICBpZiAoc2l6ZSA8PSAwKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUJ1ZmZlcih0aGF0LCBzaXplKVxuICB9XG4gIGlmIChmaWxsICE9PSB1bmRlZmluZWQpIHtcbiAgICAvLyBPbmx5IHBheSBhdHRlbnRpb24gdG8gZW5jb2RpbmcgaWYgaXQncyBhIHN0cmluZy4gVGhpc1xuICAgIC8vIHByZXZlbnRzIGFjY2lkZW50YWxseSBzZW5kaW5nIGluIGEgbnVtYmVyIHRoYXQgd291bGRcbiAgICAvLyBiZSBpbnRlcnByZXR0ZWQgYXMgYSBzdGFydCBvZmZzZXQuXG4gICAgcmV0dXJuIHR5cGVvZiBlbmNvZGluZyA9PT0gJ3N0cmluZydcbiAgICAgID8gY3JlYXRlQnVmZmVyKHRoYXQsIHNpemUpLmZpbGwoZmlsbCwgZW5jb2RpbmcpXG4gICAgICA6IGNyZWF0ZUJ1ZmZlcih0aGF0LCBzaXplKS5maWxsKGZpbGwpXG4gIH1cbiAgcmV0dXJuIGNyZWF0ZUJ1ZmZlcih0aGF0LCBzaXplKVxufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBuZXcgZmlsbGVkIEJ1ZmZlciBpbnN0YW5jZS5cbiAqIGFsbG9jKHNpemVbLCBmaWxsWywgZW5jb2RpbmddXSlcbiAqKi9cbkJ1ZmZlci5hbGxvYyA9IGZ1bmN0aW9uIChzaXplLCBmaWxsLCBlbmNvZGluZykge1xuICByZXR1cm4gYWxsb2MobnVsbCwgc2l6ZSwgZmlsbCwgZW5jb2RpbmcpXG59XG5cbmZ1bmN0aW9uIGFsbG9jVW5zYWZlICh0aGF0LCBzaXplKSB7XG4gIGFzc2VydFNpemUoc2l6ZSlcbiAgdGhhdCA9IGNyZWF0ZUJ1ZmZlcih0aGF0LCBzaXplIDwgMCA/IDAgOiBjaGVja2VkKHNpemUpIHwgMClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2l6ZTsgKytpKSB7XG4gICAgICB0aGF0W2ldID0gMFxuICAgIH1cbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG4vKipcbiAqIEVxdWl2YWxlbnQgdG8gQnVmZmVyKG51bSksIGJ5IGRlZmF1bHQgY3JlYXRlcyBhIG5vbi16ZXJvLWZpbGxlZCBCdWZmZXIgaW5zdGFuY2UuXG4gKiAqL1xuQnVmZmVyLmFsbG9jVW5zYWZlID0gZnVuY3Rpb24gKHNpemUpIHtcbiAgcmV0dXJuIGFsbG9jVW5zYWZlKG51bGwsIHNpemUpXG59XG4vKipcbiAqIEVxdWl2YWxlbnQgdG8gU2xvd0J1ZmZlcihudW0pLCBieSBkZWZhdWx0IGNyZWF0ZXMgYSBub24temVyby1maWxsZWQgQnVmZmVyIGluc3RhbmNlLlxuICovXG5CdWZmZXIuYWxsb2NVbnNhZmVTbG93ID0gZnVuY3Rpb24gKHNpemUpIHtcbiAgcmV0dXJuIGFsbG9jVW5zYWZlKG51bGwsIHNpemUpXG59XG5cbmZ1bmN0aW9uIGZyb21TdHJpbmcgKHRoYXQsIHN0cmluZywgZW5jb2RpbmcpIHtcbiAgaWYgKHR5cGVvZiBlbmNvZGluZyAhPT0gJ3N0cmluZycgfHwgZW5jb2RpbmcgPT09ICcnKSB7XG4gICAgZW5jb2RpbmcgPSAndXRmOCdcbiAgfVxuXG4gIGlmICghQnVmZmVyLmlzRW5jb2RpbmcoZW5jb2RpbmcpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignXCJlbmNvZGluZ1wiIG11c3QgYmUgYSB2YWxpZCBzdHJpbmcgZW5jb2RpbmcnKVxuICB9XG5cbiAgdmFyIGxlbmd0aCA9IGJ5dGVMZW5ndGgoc3RyaW5nLCBlbmNvZGluZykgfCAwXG4gIHRoYXQgPSBjcmVhdGVCdWZmZXIodGhhdCwgbGVuZ3RoKVxuXG4gIHZhciBhY3R1YWwgPSB0aGF0LndyaXRlKHN0cmluZywgZW5jb2RpbmcpXG5cbiAgaWYgKGFjdHVhbCAhPT0gbGVuZ3RoKSB7XG4gICAgLy8gV3JpdGluZyBhIGhleCBzdHJpbmcsIGZvciBleGFtcGxlLCB0aGF0IGNvbnRhaW5zIGludmFsaWQgY2hhcmFjdGVycyB3aWxsXG4gICAgLy8gY2F1c2UgZXZlcnl0aGluZyBhZnRlciB0aGUgZmlyc3QgaW52YWxpZCBjaGFyYWN0ZXIgdG8gYmUgaWdub3JlZC4gKGUuZy5cbiAgICAvLyAnYWJ4eGNkJyB3aWxsIGJlIHRyZWF0ZWQgYXMgJ2FiJylcbiAgICB0aGF0ID0gdGhhdC5zbGljZSgwLCBhY3R1YWwpXG4gIH1cblxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tQXJyYXlMaWtlICh0aGF0LCBhcnJheSkge1xuICB2YXIgbGVuZ3RoID0gYXJyYXkubGVuZ3RoIDwgMCA/IDAgOiBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBjcmVhdGVCdWZmZXIodGhhdCwgbGVuZ3RoKVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbUFycmF5QnVmZmVyICh0aGF0LCBhcnJheSwgYnl0ZU9mZnNldCwgbGVuZ3RoKSB7XG4gIGFycmF5LmJ5dGVMZW5ndGggLy8gdGhpcyB0aHJvd3MgaWYgYGFycmF5YCBpcyBub3QgYSB2YWxpZCBBcnJheUJ1ZmZlclxuXG4gIGlmIChieXRlT2Zmc2V0IDwgMCB8fCBhcnJheS5ieXRlTGVuZ3RoIDwgYnl0ZU9mZnNldCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdcXCdvZmZzZXRcXCcgaXMgb3V0IG9mIGJvdW5kcycpXG4gIH1cblxuICBpZiAoYXJyYXkuYnl0ZUxlbmd0aCA8IGJ5dGVPZmZzZXQgKyAobGVuZ3RoIHx8IDApKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ1xcJ2xlbmd0aFxcJyBpcyBvdXQgb2YgYm91bmRzJylcbiAgfVxuXG4gIGlmIChieXRlT2Zmc2V0ID09PSB1bmRlZmluZWQgJiYgbGVuZ3RoID09PSB1bmRlZmluZWQpIHtcbiAgICBhcnJheSA9IG5ldyBVaW50OEFycmF5KGFycmF5KVxuICB9IGVsc2UgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgYXJyYXkgPSBuZXcgVWludDhBcnJheShhcnJheSwgYnl0ZU9mZnNldClcbiAgfSBlbHNlIHtcbiAgICBhcnJheSA9IG5ldyBVaW50OEFycmF5KGFycmF5LCBieXRlT2Zmc2V0LCBsZW5ndGgpXG4gIH1cblxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICAvLyBSZXR1cm4gYW4gYXVnbWVudGVkIGBVaW50OEFycmF5YCBpbnN0YW5jZSwgZm9yIGJlc3QgcGVyZm9ybWFuY2VcbiAgICB0aGF0ID0gYXJyYXlcbiAgICB0aGF0Ll9fcHJvdG9fXyA9IEJ1ZmZlci5wcm90b3R5cGVcbiAgfSBlbHNlIHtcbiAgICAvLyBGYWxsYmFjazogUmV0dXJuIGFuIG9iamVjdCBpbnN0YW5jZSBvZiB0aGUgQnVmZmVyIGNsYXNzXG4gICAgdGhhdCA9IGZyb21BcnJheUxpa2UodGhhdCwgYXJyYXkpXG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbU9iamVjdCAodGhhdCwgb2JqKSB7XG4gIGlmIChpbnRlcm5hbElzQnVmZmVyKG9iaikpIHtcbiAgICB2YXIgbGVuID0gY2hlY2tlZChvYmoubGVuZ3RoKSB8IDBcbiAgICB0aGF0ID0gY3JlYXRlQnVmZmVyKHRoYXQsIGxlbilcblxuICAgIGlmICh0aGF0Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIHRoYXRcbiAgICB9XG5cbiAgICBvYmouY29weSh0aGF0LCAwLCAwLCBsZW4pXG4gICAgcmV0dXJuIHRoYXRcbiAgfVxuXG4gIGlmIChvYmopIHtcbiAgICBpZiAoKHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICAgICAgb2JqLmJ1ZmZlciBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSB8fCAnbGVuZ3RoJyBpbiBvYmopIHtcbiAgICAgIGlmICh0eXBlb2Ygb2JqLmxlbmd0aCAhPT0gJ251bWJlcicgfHwgaXNuYW4ob2JqLmxlbmd0aCkpIHtcbiAgICAgICAgcmV0dXJuIGNyZWF0ZUJ1ZmZlcih0aGF0LCAwKVxuICAgICAgfVxuICAgICAgcmV0dXJuIGZyb21BcnJheUxpa2UodGhhdCwgb2JqKVxuICAgIH1cblxuICAgIGlmIChvYmoudHlwZSA9PT0gJ0J1ZmZlcicgJiYgaXNBcnJheShvYmouZGF0YSkpIHtcbiAgICAgIHJldHVybiBmcm9tQXJyYXlMaWtlKHRoYXQsIG9iai5kYXRhKVxuICAgIH1cbiAgfVxuXG4gIHRocm93IG5ldyBUeXBlRXJyb3IoJ0ZpcnN0IGFyZ3VtZW50IG11c3QgYmUgYSBzdHJpbmcsIEJ1ZmZlciwgQXJyYXlCdWZmZXIsIEFycmF5LCBvciBhcnJheS1saWtlIG9iamVjdC4nKVxufVxuXG5mdW5jdGlvbiBjaGVja2VkIChsZW5ndGgpIHtcbiAgLy8gTm90ZTogY2Fubm90IHVzZSBgbGVuZ3RoIDwga01heExlbmd0aCgpYCBoZXJlIGJlY2F1c2UgdGhhdCBmYWlscyB3aGVuXG4gIC8vIGxlbmd0aCBpcyBOYU4gKHdoaWNoIGlzIG90aGVyd2lzZSBjb2VyY2VkIHRvIHplcm8uKVxuICBpZiAobGVuZ3RoID49IGtNYXhMZW5ndGgoKSkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdBdHRlbXB0IHRvIGFsbG9jYXRlIEJ1ZmZlciBsYXJnZXIgdGhhbiBtYXhpbXVtICcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICdzaXplOiAweCcgKyBrTWF4TGVuZ3RoKCkudG9TdHJpbmcoMTYpICsgJyBieXRlcycpXG4gIH1cbiAgcmV0dXJuIGxlbmd0aCB8IDBcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIFNsb3dCdWZmZXIgKGxlbmd0aCkge1xuICBpZiAoK2xlbmd0aCAhPSBsZW5ndGgpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBlcWVxZXFcbiAgICBsZW5ndGggPSAwXG4gIH1cbiAgcmV0dXJuIEJ1ZmZlci5hbGxvYygrbGVuZ3RoKVxufVxuQnVmZmVyLmlzQnVmZmVyID0gaXNCdWZmZXI7XG5mdW5jdGlvbiBpbnRlcm5hbElzQnVmZmVyIChiKSB7XG4gIHJldHVybiAhIShiICE9IG51bGwgJiYgYi5faXNCdWZmZXIpXG59XG5cbkJ1ZmZlci5jb21wYXJlID0gZnVuY3Rpb24gY29tcGFyZSAoYSwgYikge1xuICBpZiAoIWludGVybmFsSXNCdWZmZXIoYSkgfHwgIWludGVybmFsSXNCdWZmZXIoYikpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudHMgbXVzdCBiZSBCdWZmZXJzJylcbiAgfVxuXG4gIGlmIChhID09PSBiKSByZXR1cm4gMFxuXG4gIHZhciB4ID0gYS5sZW5ndGhcbiAgdmFyIHkgPSBiLmxlbmd0aFxuXG4gIGZvciAodmFyIGkgPSAwLCBsZW4gPSBNYXRoLm1pbih4LCB5KTsgaSA8IGxlbjsgKytpKSB7XG4gICAgaWYgKGFbaV0gIT09IGJbaV0pIHtcbiAgICAgIHggPSBhW2ldXG4gICAgICB5ID0gYltpXVxuICAgICAgYnJlYWtcbiAgICB9XG4gIH1cblxuICBpZiAoeCA8IHkpIHJldHVybiAtMVxuICBpZiAoeSA8IHgpIHJldHVybiAxXG4gIHJldHVybiAwXG59XG5cbkJ1ZmZlci5pc0VuY29kaW5nID0gZnVuY3Rpb24gaXNFbmNvZGluZyAoZW5jb2RpbmcpIHtcbiAgc3dpdGNoIChTdHJpbmcoZW5jb2RpbmcpLnRvTG93ZXJDYXNlKCkpIHtcbiAgICBjYXNlICdoZXgnOlxuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgY2FzZSAnbGF0aW4xJzpcbiAgICBjYXNlICdiaW5hcnknOlxuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldHVybiB0cnVlXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZVxuICB9XG59XG5cbkJ1ZmZlci5jb25jYXQgPSBmdW5jdGlvbiBjb25jYXQgKGxpc3QsIGxlbmd0aCkge1xuICBpZiAoIWlzQXJyYXkobGlzdCkpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdcImxpc3RcIiBhcmd1bWVudCBtdXN0IGJlIGFuIEFycmF5IG9mIEJ1ZmZlcnMnKVxuICB9XG5cbiAgaWYgKGxpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIEJ1ZmZlci5hbGxvYygwKVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgbGVuZ3RoID0gMFxuICAgIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgKytpKSB7XG4gICAgICBsZW5ndGggKz0gbGlzdFtpXS5sZW5ndGhcbiAgICB9XG4gIH1cblxuICB2YXIgYnVmZmVyID0gQnVmZmVyLmFsbG9jVW5zYWZlKGxlbmd0aClcbiAgdmFyIHBvcyA9IDBcbiAgZm9yIChpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyArK2kpIHtcbiAgICB2YXIgYnVmID0gbGlzdFtpXVxuICAgIGlmICghaW50ZXJuYWxJc0J1ZmZlcihidWYpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdcImxpc3RcIiBhcmd1bWVudCBtdXN0IGJlIGFuIEFycmF5IG9mIEJ1ZmZlcnMnKVxuICAgIH1cbiAgICBidWYuY29weShidWZmZXIsIHBvcylcbiAgICBwb3MgKz0gYnVmLmxlbmd0aFxuICB9XG4gIHJldHVybiBidWZmZXJcbn1cblxuZnVuY3Rpb24gYnl0ZUxlbmd0aCAoc3RyaW5nLCBlbmNvZGluZykge1xuICBpZiAoaW50ZXJuYWxJc0J1ZmZlcihzdHJpbmcpKSB7XG4gICAgcmV0dXJuIHN0cmluZy5sZW5ndGhcbiAgfVxuICBpZiAodHlwZW9mIEFycmF5QnVmZmVyICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2YgQXJyYXlCdWZmZXIuaXNWaWV3ID09PSAnZnVuY3Rpb24nICYmXG4gICAgICAoQXJyYXlCdWZmZXIuaXNWaWV3KHN0cmluZykgfHwgc3RyaW5nIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpKSB7XG4gICAgcmV0dXJuIHN0cmluZy5ieXRlTGVuZ3RoXG4gIH1cbiAgaWYgKHR5cGVvZiBzdHJpbmcgIT09ICdzdHJpbmcnKSB7XG4gICAgc3RyaW5nID0gJycgKyBzdHJpbmdcbiAgfVxuXG4gIHZhciBsZW4gPSBzdHJpbmcubGVuZ3RoXG4gIGlmIChsZW4gPT09IDApIHJldHVybiAwXG5cbiAgLy8gVXNlIGEgZm9yIGxvb3AgdG8gYXZvaWQgcmVjdXJzaW9uXG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG4gIGZvciAoOzspIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdhc2NpaSc6XG4gICAgICBjYXNlICdsYXRpbjEnOlxuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgICAgcmV0dXJuIGxlblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICBjYXNlIHVuZGVmaW5lZDpcbiAgICAgICAgcmV0dXJuIHV0ZjhUb0J5dGVzKHN0cmluZykubGVuZ3RoXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gbGVuICogMlxuICAgICAgY2FzZSAnaGV4JzpcbiAgICAgICAgcmV0dXJuIGxlbiA+Pj4gMVxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgcmV0dXJuIGJhc2U2NFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGhcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSkgcmV0dXJuIHV0ZjhUb0J5dGVzKHN0cmluZykubGVuZ3RoIC8vIGFzc3VtZSB1dGY4XG4gICAgICAgIGVuY29kaW5nID0gKCcnICsgZW5jb2RpbmcpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5CdWZmZXIuYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGhcblxuZnVuY3Rpb24gc2xvd1RvU3RyaW5nIChlbmNvZGluZywgc3RhcnQsIGVuZCkge1xuICB2YXIgbG93ZXJlZENhc2UgPSBmYWxzZVxuXG4gIC8vIE5vIG5lZWQgdG8gdmVyaWZ5IHRoYXQgXCJ0aGlzLmxlbmd0aCA8PSBNQVhfVUlOVDMyXCIgc2luY2UgaXQncyBhIHJlYWQtb25seVxuICAvLyBwcm9wZXJ0eSBvZiBhIHR5cGVkIGFycmF5LlxuXG4gIC8vIFRoaXMgYmVoYXZlcyBuZWl0aGVyIGxpa2UgU3RyaW5nIG5vciBVaW50OEFycmF5IGluIHRoYXQgd2Ugc2V0IHN0YXJ0L2VuZFxuICAvLyB0byB0aGVpciB1cHBlci9sb3dlciBib3VuZHMgaWYgdGhlIHZhbHVlIHBhc3NlZCBpcyBvdXQgb2YgcmFuZ2UuXG4gIC8vIHVuZGVmaW5lZCBpcyBoYW5kbGVkIHNwZWNpYWxseSBhcyBwZXIgRUNNQS0yNjIgNnRoIEVkaXRpb24sXG4gIC8vIFNlY3Rpb24gMTMuMy4zLjcgUnVudGltZSBTZW1hbnRpY3M6IEtleWVkQmluZGluZ0luaXRpYWxpemF0aW9uLlxuICBpZiAoc3RhcnQgPT09IHVuZGVmaW5lZCB8fCBzdGFydCA8IDApIHtcbiAgICBzdGFydCA9IDBcbiAgfVxuICAvLyBSZXR1cm4gZWFybHkgaWYgc3RhcnQgPiB0aGlzLmxlbmd0aC4gRG9uZSBoZXJlIHRvIHByZXZlbnQgcG90ZW50aWFsIHVpbnQzMlxuICAvLyBjb2VyY2lvbiBmYWlsIGJlbG93LlxuICBpZiAoc3RhcnQgPiB0aGlzLmxlbmd0aCkge1xuICAgIHJldHVybiAnJ1xuICB9XG5cbiAgaWYgKGVuZCA9PT0gdW5kZWZpbmVkIHx8IGVuZCA+IHRoaXMubGVuZ3RoKSB7XG4gICAgZW5kID0gdGhpcy5sZW5ndGhcbiAgfVxuXG4gIGlmIChlbmQgPD0gMCkge1xuICAgIHJldHVybiAnJ1xuICB9XG5cbiAgLy8gRm9yY2UgY29lcnNpb24gdG8gdWludDMyLiBUaGlzIHdpbGwgYWxzbyBjb2VyY2UgZmFsc2V5L05hTiB2YWx1ZXMgdG8gMC5cbiAgZW5kID4+Pj0gMFxuICBzdGFydCA+Pj49IDBcblxuICBpZiAoZW5kIDw9IHN0YXJ0KSB7XG4gICAgcmV0dXJuICcnXG4gIH1cblxuICBpZiAoIWVuY29kaW5nKSBlbmNvZGluZyA9ICd1dGY4J1xuXG4gIHdoaWxlICh0cnVlKSB7XG4gICAgc3dpdGNoIChlbmNvZGluZykge1xuICAgICAgY2FzZSAnaGV4JzpcbiAgICAgICAgcmV0dXJuIGhleFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgICAgcmV0dXJuIGFzY2lpU2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnbGF0aW4xJzpcbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAgIHJldHVybiBsYXRpbjFTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICByZXR1cm4gYmFzZTY0U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndWNzMic6XG4gICAgICBjYXNlICd1Y3MtMic6XG4gICAgICBjYXNlICd1dGYxNmxlJzpcbiAgICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgICAgcmV0dXJuIHV0ZjE2bGVTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBpZiAobG93ZXJlZENhc2UpIHRocm93IG5ldyBUeXBlRXJyb3IoJ1Vua25vd24gZW5jb2Rpbmc6ICcgKyBlbmNvZGluZylcbiAgICAgICAgZW5jb2RpbmcgPSAoZW5jb2RpbmcgKyAnJykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cblxuLy8gVGhlIHByb3BlcnR5IGlzIHVzZWQgYnkgYEJ1ZmZlci5pc0J1ZmZlcmAgYW5kIGBpcy1idWZmZXJgIChpbiBTYWZhcmkgNS03KSB0byBkZXRlY3Rcbi8vIEJ1ZmZlciBpbnN0YW5jZXMuXG5CdWZmZXIucHJvdG90eXBlLl9pc0J1ZmZlciA9IHRydWVcblxuZnVuY3Rpb24gc3dhcCAoYiwgbiwgbSkge1xuICB2YXIgaSA9IGJbbl1cbiAgYltuXSA9IGJbbV1cbiAgYlttXSA9IGlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5zd2FwMTYgPSBmdW5jdGlvbiBzd2FwMTYgKCkge1xuICB2YXIgbGVuID0gdGhpcy5sZW5ndGhcbiAgaWYgKGxlbiAlIDIgIT09IDApIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignQnVmZmVyIHNpemUgbXVzdCBiZSBhIG11bHRpcGxlIG9mIDE2LWJpdHMnKVxuICB9XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpICs9IDIpIHtcbiAgICBzd2FwKHRoaXMsIGksIGkgKyAxKVxuICB9XG4gIHJldHVybiB0aGlzXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuc3dhcDMyID0gZnVuY3Rpb24gc3dhcDMyICgpIHtcbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoXG4gIGlmIChsZW4gJSA0ICE9PSAwKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0J1ZmZlciBzaXplIG11c3QgYmUgYSBtdWx0aXBsZSBvZiAzMi1iaXRzJylcbiAgfVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSArPSA0KSB7XG4gICAgc3dhcCh0aGlzLCBpLCBpICsgMylcbiAgICBzd2FwKHRoaXMsIGkgKyAxLCBpICsgMilcbiAgfVxuICByZXR1cm4gdGhpc1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnN3YXA2NCA9IGZ1bmN0aW9uIHN3YXA2NCAoKSB7XG4gIHZhciBsZW4gPSB0aGlzLmxlbmd0aFxuICBpZiAobGVuICUgOCAhPT0gMCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdCdWZmZXIgc2l6ZSBtdXN0IGJlIGEgbXVsdGlwbGUgb2YgNjQtYml0cycpXG4gIH1cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkgKz0gOCkge1xuICAgIHN3YXAodGhpcywgaSwgaSArIDcpXG4gICAgc3dhcCh0aGlzLCBpICsgMSwgaSArIDYpXG4gICAgc3dhcCh0aGlzLCBpICsgMiwgaSArIDUpXG4gICAgc3dhcCh0aGlzLCBpICsgMywgaSArIDQpXG4gIH1cbiAgcmV0dXJuIHRoaXNcbn1cblxuQnVmZmVyLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uIHRvU3RyaW5nICgpIHtcbiAgdmFyIGxlbmd0aCA9IHRoaXMubGVuZ3RoIHwgMFxuICBpZiAobGVuZ3RoID09PSAwKSByZXR1cm4gJydcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApIHJldHVybiB1dGY4U2xpY2UodGhpcywgMCwgbGVuZ3RoKVxuICByZXR1cm4gc2xvd1RvU3RyaW5nLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5lcXVhbHMgPSBmdW5jdGlvbiBlcXVhbHMgKGIpIHtcbiAgaWYgKCFpbnRlcm5hbElzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiB0cnVlXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKSA9PT0gMFxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluc3BlY3QgPSBmdW5jdGlvbiBpbnNwZWN0ICgpIHtcbiAgdmFyIHN0ciA9ICcnXG4gIHZhciBtYXggPSBJTlNQRUNUX01BWF9CWVRFU1xuICBpZiAodGhpcy5sZW5ndGggPiAwKSB7XG4gICAgc3RyID0gdGhpcy50b1N0cmluZygnaGV4JywgMCwgbWF4KS5tYXRjaCgvLnsyfS9nKS5qb2luKCcgJylcbiAgICBpZiAodGhpcy5sZW5ndGggPiBtYXgpIHN0ciArPSAnIC4uLiAnXG4gIH1cbiAgcmV0dXJuICc8QnVmZmVyICcgKyBzdHIgKyAnPidcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5jb21wYXJlID0gZnVuY3Rpb24gY29tcGFyZSAodGFyZ2V0LCBzdGFydCwgZW5kLCB0aGlzU3RhcnQsIHRoaXNFbmQpIHtcbiAgaWYgKCFpbnRlcm5hbElzQnVmZmVyKHRhcmdldCkpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgfVxuXG4gIGlmIChzdGFydCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgc3RhcnQgPSAwXG4gIH1cbiAgaWYgKGVuZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgZW5kID0gdGFyZ2V0ID8gdGFyZ2V0Lmxlbmd0aCA6IDBcbiAgfVxuICBpZiAodGhpc1N0YXJ0ID09PSB1bmRlZmluZWQpIHtcbiAgICB0aGlzU3RhcnQgPSAwXG4gIH1cbiAgaWYgKHRoaXNFbmQgPT09IHVuZGVmaW5lZCkge1xuICAgIHRoaXNFbmQgPSB0aGlzLmxlbmd0aFxuICB9XG5cbiAgaWYgKHN0YXJ0IDwgMCB8fCBlbmQgPiB0YXJnZXQubGVuZ3RoIHx8IHRoaXNTdGFydCA8IDAgfHwgdGhpc0VuZCA+IHRoaXMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ291dCBvZiByYW5nZSBpbmRleCcpXG4gIH1cblxuICBpZiAodGhpc1N0YXJ0ID49IHRoaXNFbmQgJiYgc3RhcnQgPj0gZW5kKSB7XG4gICAgcmV0dXJuIDBcbiAgfVxuICBpZiAodGhpc1N0YXJ0ID49IHRoaXNFbmQpIHtcbiAgICByZXR1cm4gLTFcbiAgfVxuICBpZiAoc3RhcnQgPj0gZW5kKSB7XG4gICAgcmV0dXJuIDFcbiAgfVxuXG4gIHN0YXJ0ID4+Pj0gMFxuICBlbmQgPj4+PSAwXG4gIHRoaXNTdGFydCA+Pj49IDBcbiAgdGhpc0VuZCA+Pj49IDBcblxuICBpZiAodGhpcyA9PT0gdGFyZ2V0KSByZXR1cm4gMFxuXG4gIHZhciB4ID0gdGhpc0VuZCAtIHRoaXNTdGFydFxuICB2YXIgeSA9IGVuZCAtIHN0YXJ0XG4gIHZhciBsZW4gPSBNYXRoLm1pbih4LCB5KVxuXG4gIHZhciB0aGlzQ29weSA9IHRoaXMuc2xpY2UodGhpc1N0YXJ0LCB0aGlzRW5kKVxuICB2YXIgdGFyZ2V0Q29weSA9IHRhcmdldC5zbGljZShzdGFydCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyArK2kpIHtcbiAgICBpZiAodGhpc0NvcHlbaV0gIT09IHRhcmdldENvcHlbaV0pIHtcbiAgICAgIHggPSB0aGlzQ29weVtpXVxuICAgICAgeSA9IHRhcmdldENvcHlbaV1cbiAgICAgIGJyZWFrXG4gICAgfVxuICB9XG5cbiAgaWYgKHggPCB5KSByZXR1cm4gLTFcbiAgaWYgKHkgPCB4KSByZXR1cm4gMVxuICByZXR1cm4gMFxufVxuXG4vLyBGaW5kcyBlaXRoZXIgdGhlIGZpcnN0IGluZGV4IG9mIGB2YWxgIGluIGBidWZmZXJgIGF0IG9mZnNldCA+PSBgYnl0ZU9mZnNldGAsXG4vLyBPUiB0aGUgbGFzdCBpbmRleCBvZiBgdmFsYCBpbiBgYnVmZmVyYCBhdCBvZmZzZXQgPD0gYGJ5dGVPZmZzZXRgLlxuLy9cbi8vIEFyZ3VtZW50czpcbi8vIC0gYnVmZmVyIC0gYSBCdWZmZXIgdG8gc2VhcmNoXG4vLyAtIHZhbCAtIGEgc3RyaW5nLCBCdWZmZXIsIG9yIG51bWJlclxuLy8gLSBieXRlT2Zmc2V0IC0gYW4gaW5kZXggaW50byBgYnVmZmVyYDsgd2lsbCBiZSBjbGFtcGVkIHRvIGFuIGludDMyXG4vLyAtIGVuY29kaW5nIC0gYW4gb3B0aW9uYWwgZW5jb2RpbmcsIHJlbGV2YW50IGlzIHZhbCBpcyBhIHN0cmluZ1xuLy8gLSBkaXIgLSB0cnVlIGZvciBpbmRleE9mLCBmYWxzZSBmb3IgbGFzdEluZGV4T2ZcbmZ1bmN0aW9uIGJpZGlyZWN0aW9uYWxJbmRleE9mIChidWZmZXIsIHZhbCwgYnl0ZU9mZnNldCwgZW5jb2RpbmcsIGRpcikge1xuICAvLyBFbXB0eSBidWZmZXIgbWVhbnMgbm8gbWF0Y2hcbiAgaWYgKGJ1ZmZlci5sZW5ndGggPT09IDApIHJldHVybiAtMVxuXG4gIC8vIE5vcm1hbGl6ZSBieXRlT2Zmc2V0XG4gIGlmICh0eXBlb2YgYnl0ZU9mZnNldCA9PT0gJ3N0cmluZycpIHtcbiAgICBlbmNvZGluZyA9IGJ5dGVPZmZzZXRcbiAgICBieXRlT2Zmc2V0ID0gMFxuICB9IGVsc2UgaWYgKGJ5dGVPZmZzZXQgPiAweDdmZmZmZmZmKSB7XG4gICAgYnl0ZU9mZnNldCA9IDB4N2ZmZmZmZmZcbiAgfSBlbHNlIGlmIChieXRlT2Zmc2V0IDwgLTB4ODAwMDAwMDApIHtcbiAgICBieXRlT2Zmc2V0ID0gLTB4ODAwMDAwMDBcbiAgfVxuICBieXRlT2Zmc2V0ID0gK2J5dGVPZmZzZXQgIC8vIENvZXJjZSB0byBOdW1iZXIuXG4gIGlmIChpc05hTihieXRlT2Zmc2V0KSkge1xuICAgIC8vIGJ5dGVPZmZzZXQ6IGl0IGl0J3MgdW5kZWZpbmVkLCBudWxsLCBOYU4sIFwiZm9vXCIsIGV0Yywgc2VhcmNoIHdob2xlIGJ1ZmZlclxuICAgIGJ5dGVPZmZzZXQgPSBkaXIgPyAwIDogKGJ1ZmZlci5sZW5ndGggLSAxKVxuICB9XG5cbiAgLy8gTm9ybWFsaXplIGJ5dGVPZmZzZXQ6IG5lZ2F0aXZlIG9mZnNldHMgc3RhcnQgZnJvbSB0aGUgZW5kIG9mIHRoZSBidWZmZXJcbiAgaWYgKGJ5dGVPZmZzZXQgPCAwKSBieXRlT2Zmc2V0ID0gYnVmZmVyLmxlbmd0aCArIGJ5dGVPZmZzZXRcbiAgaWYgKGJ5dGVPZmZzZXQgPj0gYnVmZmVyLmxlbmd0aCkge1xuICAgIGlmIChkaXIpIHJldHVybiAtMVxuICAgIGVsc2UgYnl0ZU9mZnNldCA9IGJ1ZmZlci5sZW5ndGggLSAxXG4gIH0gZWxzZSBpZiAoYnl0ZU9mZnNldCA8IDApIHtcbiAgICBpZiAoZGlyKSBieXRlT2Zmc2V0ID0gMFxuICAgIGVsc2UgcmV0dXJuIC0xXG4gIH1cblxuICAvLyBOb3JtYWxpemUgdmFsXG4gIGlmICh0eXBlb2YgdmFsID09PSAnc3RyaW5nJykge1xuICAgIHZhbCA9IEJ1ZmZlci5mcm9tKHZhbCwgZW5jb2RpbmcpXG4gIH1cblxuICAvLyBGaW5hbGx5LCBzZWFyY2ggZWl0aGVyIGluZGV4T2YgKGlmIGRpciBpcyB0cnVlKSBvciBsYXN0SW5kZXhPZlxuICBpZiAoaW50ZXJuYWxJc0J1ZmZlcih2YWwpKSB7XG4gICAgLy8gU3BlY2lhbCBjYXNlOiBsb29raW5nIGZvciBlbXB0eSBzdHJpbmcvYnVmZmVyIGFsd2F5cyBmYWlsc1xuICAgIGlmICh2YWwubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gLTFcbiAgICB9XG4gICAgcmV0dXJuIGFycmF5SW5kZXhPZihidWZmZXIsIHZhbCwgYnl0ZU9mZnNldCwgZW5jb2RpbmcsIGRpcilcbiAgfSBlbHNlIGlmICh0eXBlb2YgdmFsID09PSAnbnVtYmVyJykge1xuICAgIHZhbCA9IHZhbCAmIDB4RkYgLy8gU2VhcmNoIGZvciBhIGJ5dGUgdmFsdWUgWzAtMjU1XVxuICAgIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCAmJlxuICAgICAgICB0eXBlb2YgVWludDhBcnJheS5wcm90b3R5cGUuaW5kZXhPZiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgaWYgKGRpcikge1xuICAgICAgICByZXR1cm4gVWludDhBcnJheS5wcm90b3R5cGUuaW5kZXhPZi5jYWxsKGJ1ZmZlciwgdmFsLCBieXRlT2Zmc2V0KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIFVpbnQ4QXJyYXkucHJvdG90eXBlLmxhc3RJbmRleE9mLmNhbGwoYnVmZmVyLCB2YWwsIGJ5dGVPZmZzZXQpXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBhcnJheUluZGV4T2YoYnVmZmVyLCBbIHZhbCBdLCBieXRlT2Zmc2V0LCBlbmNvZGluZywgZGlyKVxuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmFsIG11c3QgYmUgc3RyaW5nLCBudW1iZXIgb3IgQnVmZmVyJylcbn1cblxuZnVuY3Rpb24gYXJyYXlJbmRleE9mIChhcnIsIHZhbCwgYnl0ZU9mZnNldCwgZW5jb2RpbmcsIGRpcikge1xuICB2YXIgaW5kZXhTaXplID0gMVxuICB2YXIgYXJyTGVuZ3RoID0gYXJyLmxlbmd0aFxuICB2YXIgdmFsTGVuZ3RoID0gdmFsLmxlbmd0aFxuXG4gIGlmIChlbmNvZGluZyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgZW5jb2RpbmcgPSBTdHJpbmcoZW5jb2RpbmcpLnRvTG93ZXJDYXNlKClcbiAgICBpZiAoZW5jb2RpbmcgPT09ICd1Y3MyJyB8fCBlbmNvZGluZyA9PT0gJ3Vjcy0yJyB8fFxuICAgICAgICBlbmNvZGluZyA9PT0gJ3V0ZjE2bGUnIHx8IGVuY29kaW5nID09PSAndXRmLTE2bGUnKSB7XG4gICAgICBpZiAoYXJyLmxlbmd0aCA8IDIgfHwgdmFsLmxlbmd0aCA8IDIpIHtcbiAgICAgICAgcmV0dXJuIC0xXG4gICAgICB9XG4gICAgICBpbmRleFNpemUgPSAyXG4gICAgICBhcnJMZW5ndGggLz0gMlxuICAgICAgdmFsTGVuZ3RoIC89IDJcbiAgICAgIGJ5dGVPZmZzZXQgLz0gMlxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHJlYWQgKGJ1ZiwgaSkge1xuICAgIGlmIChpbmRleFNpemUgPT09IDEpIHtcbiAgICAgIHJldHVybiBidWZbaV1cbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGJ1Zi5yZWFkVUludDE2QkUoaSAqIGluZGV4U2l6ZSlcbiAgICB9XG4gIH1cblxuICB2YXIgaVxuICBpZiAoZGlyKSB7XG4gICAgdmFyIGZvdW5kSW5kZXggPSAtMVxuICAgIGZvciAoaSA9IGJ5dGVPZmZzZXQ7IGkgPCBhcnJMZW5ndGg7IGkrKykge1xuICAgICAgaWYgKHJlYWQoYXJyLCBpKSA9PT0gcmVhZCh2YWwsIGZvdW5kSW5kZXggPT09IC0xID8gMCA6IGkgLSBmb3VuZEluZGV4KSkge1xuICAgICAgICBpZiAoZm91bmRJbmRleCA9PT0gLTEpIGZvdW5kSW5kZXggPSBpXG4gICAgICAgIGlmIChpIC0gZm91bmRJbmRleCArIDEgPT09IHZhbExlbmd0aCkgcmV0dXJuIGZvdW5kSW5kZXggKiBpbmRleFNpemVcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChmb3VuZEluZGV4ICE9PSAtMSkgaSAtPSBpIC0gZm91bmRJbmRleFxuICAgICAgICBmb3VuZEluZGV4ID0gLTFcbiAgICAgIH1cbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgaWYgKGJ5dGVPZmZzZXQgKyB2YWxMZW5ndGggPiBhcnJMZW5ndGgpIGJ5dGVPZmZzZXQgPSBhcnJMZW5ndGggLSB2YWxMZW5ndGhcbiAgICBmb3IgKGkgPSBieXRlT2Zmc2V0OyBpID49IDA7IGktLSkge1xuICAgICAgdmFyIGZvdW5kID0gdHJ1ZVxuICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCB2YWxMZW5ndGg7IGorKykge1xuICAgICAgICBpZiAocmVhZChhcnIsIGkgKyBqKSAhPT0gcmVhZCh2YWwsIGopKSB7XG4gICAgICAgICAgZm91bmQgPSBmYWxzZVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChmb3VuZCkgcmV0dXJuIGlcbiAgICB9XG4gIH1cblxuICByZXR1cm4gLTFcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5pbmNsdWRlcyA9IGZ1bmN0aW9uIGluY2x1ZGVzICh2YWwsIGJ5dGVPZmZzZXQsIGVuY29kaW5nKSB7XG4gIHJldHVybiB0aGlzLmluZGV4T2YodmFsLCBieXRlT2Zmc2V0LCBlbmNvZGluZykgIT09IC0xXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuaW5kZXhPZiA9IGZ1bmN0aW9uIGluZGV4T2YgKHZhbCwgYnl0ZU9mZnNldCwgZW5jb2RpbmcpIHtcbiAgcmV0dXJuIGJpZGlyZWN0aW9uYWxJbmRleE9mKHRoaXMsIHZhbCwgYnl0ZU9mZnNldCwgZW5jb2RpbmcsIHRydWUpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUubGFzdEluZGV4T2YgPSBmdW5jdGlvbiBsYXN0SW5kZXhPZiAodmFsLCBieXRlT2Zmc2V0LCBlbmNvZGluZykge1xuICByZXR1cm4gYmlkaXJlY3Rpb25hbEluZGV4T2YodGhpcywgdmFsLCBieXRlT2Zmc2V0LCBlbmNvZGluZywgZmFsc2UpXG59XG5cbmZ1bmN0aW9uIGhleFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgb2Zmc2V0ID0gTnVtYmVyKG9mZnNldCkgfHwgMFxuICB2YXIgcmVtYWluaW5nID0gYnVmLmxlbmd0aCAtIG9mZnNldFxuICBpZiAoIWxlbmd0aCkge1xuICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9IE51bWJlcihsZW5ndGgpXG4gICAgaWYgKGxlbmd0aCA+IHJlbWFpbmluZykge1xuICAgICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gICAgfVxuICB9XG5cbiAgLy8gbXVzdCBiZSBhbiBldmVuIG51bWJlciBvZiBkaWdpdHNcbiAgdmFyIHN0ckxlbiA9IHN0cmluZy5sZW5ndGhcbiAgaWYgKHN0ckxlbiAlIDIgIT09IDApIHRocm93IG5ldyBUeXBlRXJyb3IoJ0ludmFsaWQgaGV4IHN0cmluZycpXG5cbiAgaWYgKGxlbmd0aCA+IHN0ckxlbiAvIDIpIHtcbiAgICBsZW5ndGggPSBzdHJMZW4gLyAyXG4gIH1cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7ICsraSkge1xuICAgIHZhciBwYXJzZWQgPSBwYXJzZUludChzdHJpbmcuc3Vic3RyKGkgKiAyLCAyKSwgMTYpXG4gICAgaWYgKGlzTmFOKHBhcnNlZCkpIHJldHVybiBpXG4gICAgYnVmW29mZnNldCArIGldID0gcGFyc2VkXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gdXRmOFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIodXRmOFRvQnl0ZXMoc3RyaW5nLCBidWYubGVuZ3RoIC0gb2Zmc2V0KSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYXNjaWlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKGFzY2lpVG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBsYXRpbjFXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBhc2NpaVdyaXRlKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYmFzZTY0V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcihiYXNlNjRUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIHVjczJXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKHV0ZjE2bGVUb0J5dGVzKHN0cmluZywgYnVmLmxlbmd0aCAtIG9mZnNldCksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbiB3cml0ZSAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpIHtcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZylcbiAgaWYgKG9mZnNldCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgZW5jb2RpbmcgPSAndXRmOCdcbiAgICBsZW5ndGggPSB0aGlzLmxlbmd0aFxuICAgIG9mZnNldCA9IDBcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZywgZW5jb2RpbmcpXG4gIH0gZWxzZSBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQgJiYgdHlwZW9mIG9mZnNldCA9PT0gJ3N0cmluZycpIHtcbiAgICBlbmNvZGluZyA9IG9mZnNldFxuICAgIGxlbmd0aCA9IHRoaXMubGVuZ3RoXG4gICAgb2Zmc2V0ID0gMFxuICAvLyBCdWZmZXIjd3JpdGUoc3RyaW5nLCBvZmZzZXRbLCBsZW5ndGhdWywgZW5jb2RpbmddKVxuICB9IGVsc2UgaWYgKGlzRmluaXRlKG9mZnNldCkpIHtcbiAgICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gICAgaWYgKGlzRmluaXRlKGxlbmd0aCkpIHtcbiAgICAgIGxlbmd0aCA9IGxlbmd0aCB8IDBcbiAgICAgIGlmIChlbmNvZGluZyA9PT0gdW5kZWZpbmVkKSBlbmNvZGluZyA9ICd1dGY4J1xuICAgIH0gZWxzZSB7XG4gICAgICBlbmNvZGluZyA9IGxlbmd0aFxuICAgICAgbGVuZ3RoID0gdW5kZWZpbmVkXG4gICAgfVxuICAvLyBsZWdhY3kgd3JpdGUoc3RyaW5nLCBlbmNvZGluZywgb2Zmc2V0LCBsZW5ndGgpIC0gcmVtb3ZlIGluIHYwLjEzXG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgJ0J1ZmZlci53cml0ZShzdHJpbmcsIGVuY29kaW5nLCBvZmZzZXRbLCBsZW5ndGhdKSBpcyBubyBsb25nZXIgc3VwcG9ydGVkJ1xuICAgIClcbiAgfVxuXG4gIHZhciByZW1haW5pbmcgPSB0aGlzLmxlbmd0aCAtIG9mZnNldFxuICBpZiAobGVuZ3RoID09PSB1bmRlZmluZWQgfHwgbGVuZ3RoID4gcmVtYWluaW5nKSBsZW5ndGggPSByZW1haW5pbmdcblxuICBpZiAoKHN0cmluZy5sZW5ndGggPiAwICYmIChsZW5ndGggPCAwIHx8IG9mZnNldCA8IDApKSB8fCBvZmZzZXQgPiB0aGlzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdBdHRlbXB0IHRvIHdyaXRlIG91dHNpZGUgYnVmZmVyIGJvdW5kcycpXG4gIH1cblxuICBpZiAoIWVuY29kaW5nKSBlbmNvZGluZyA9ICd1dGY4J1xuXG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG4gIGZvciAoOzspIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICdsYXRpbjEnOlxuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgICAgcmV0dXJuIGxhdGluMVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIC8vIFdhcm5pbmc6IG1heExlbmd0aCBub3QgdGFrZW4gaW50byBhY2NvdW50IGluIGJhc2U2NFdyaXRlXG4gICAgICAgIHJldHVybiBiYXNlNjRXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gdWNzMldyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSkgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5rbm93biBlbmNvZGluZzogJyArIGVuY29kaW5nKVxuICAgICAgICBlbmNvZGluZyA9ICgnJyArIGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpXG4gICAgICAgIGxvd2VyZWRDYXNlID0gdHJ1ZVxuICAgIH1cbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uIHRvSlNPTiAoKSB7XG4gIHJldHVybiB7XG4gICAgdHlwZTogJ0J1ZmZlcicsXG4gICAgZGF0YTogQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwodGhpcy5fYXJyIHx8IHRoaXMsIDApXG4gIH1cbn1cblxuZnVuY3Rpb24gYmFzZTY0U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICBpZiAoc3RhcnQgPT09IDAgJiYgZW5kID09PSBidWYubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGJhc2U2NC5mcm9tQnl0ZUFycmF5KGJ1ZilcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmLnNsaWNlKHN0YXJ0LCBlbmQpKVxuICB9XG59XG5cbmZ1bmN0aW9uIHV0ZjhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcbiAgdmFyIHJlcyA9IFtdXG5cbiAgdmFyIGkgPSBzdGFydFxuICB3aGlsZSAoaSA8IGVuZCkge1xuICAgIHZhciBmaXJzdEJ5dGUgPSBidWZbaV1cbiAgICB2YXIgY29kZVBvaW50ID0gbnVsbFxuICAgIHZhciBieXRlc1BlclNlcXVlbmNlID0gKGZpcnN0Qnl0ZSA+IDB4RUYpID8gNFxuICAgICAgOiAoZmlyc3RCeXRlID4gMHhERikgPyAzXG4gICAgICA6IChmaXJzdEJ5dGUgPiAweEJGKSA/IDJcbiAgICAgIDogMVxuXG4gICAgaWYgKGkgKyBieXRlc1BlclNlcXVlbmNlIDw9IGVuZCkge1xuICAgICAgdmFyIHNlY29uZEJ5dGUsIHRoaXJkQnl0ZSwgZm91cnRoQnl0ZSwgdGVtcENvZGVQb2ludFxuXG4gICAgICBzd2l0Y2ggKGJ5dGVzUGVyU2VxdWVuY2UpIHtcbiAgICAgICAgY2FzZSAxOlxuICAgICAgICAgIGlmIChmaXJzdEJ5dGUgPCAweDgwKSB7XG4gICAgICAgICAgICBjb2RlUG9pbnQgPSBmaXJzdEJ5dGVcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSAyOlxuICAgICAgICAgIHNlY29uZEJ5dGUgPSBidWZbaSArIDFdXG4gICAgICAgICAgaWYgKChzZWNvbmRCeXRlICYgMHhDMCkgPT09IDB4ODApIHtcbiAgICAgICAgICAgIHRlbXBDb2RlUG9pbnQgPSAoZmlyc3RCeXRlICYgMHgxRikgPDwgMHg2IHwgKHNlY29uZEJ5dGUgJiAweDNGKVxuICAgICAgICAgICAgaWYgKHRlbXBDb2RlUG9pbnQgPiAweDdGKSB7XG4gICAgICAgICAgICAgIGNvZGVQb2ludCA9IHRlbXBDb2RlUG9pbnRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSAzOlxuICAgICAgICAgIHNlY29uZEJ5dGUgPSBidWZbaSArIDFdXG4gICAgICAgICAgdGhpcmRCeXRlID0gYnVmW2kgKyAyXVxuICAgICAgICAgIGlmICgoc2Vjb25kQnl0ZSAmIDB4QzApID09PSAweDgwICYmICh0aGlyZEJ5dGUgJiAweEMwKSA9PT0gMHg4MCkge1xuICAgICAgICAgICAgdGVtcENvZGVQb2ludCA9IChmaXJzdEJ5dGUgJiAweEYpIDw8IDB4QyB8IChzZWNvbmRCeXRlICYgMHgzRikgPDwgMHg2IHwgKHRoaXJkQnl0ZSAmIDB4M0YpXG4gICAgICAgICAgICBpZiAodGVtcENvZGVQb2ludCA+IDB4N0ZGICYmICh0ZW1wQ29kZVBvaW50IDwgMHhEODAwIHx8IHRlbXBDb2RlUG9pbnQgPiAweERGRkYpKSB7XG4gICAgICAgICAgICAgIGNvZGVQb2ludCA9IHRlbXBDb2RlUG9pbnRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSA0OlxuICAgICAgICAgIHNlY29uZEJ5dGUgPSBidWZbaSArIDFdXG4gICAgICAgICAgdGhpcmRCeXRlID0gYnVmW2kgKyAyXVxuICAgICAgICAgIGZvdXJ0aEJ5dGUgPSBidWZbaSArIDNdXG4gICAgICAgICAgaWYgKChzZWNvbmRCeXRlICYgMHhDMCkgPT09IDB4ODAgJiYgKHRoaXJkQnl0ZSAmIDB4QzApID09PSAweDgwICYmIChmb3VydGhCeXRlICYgMHhDMCkgPT09IDB4ODApIHtcbiAgICAgICAgICAgIHRlbXBDb2RlUG9pbnQgPSAoZmlyc3RCeXRlICYgMHhGKSA8PCAweDEyIHwgKHNlY29uZEJ5dGUgJiAweDNGKSA8PCAweEMgfCAodGhpcmRCeXRlICYgMHgzRikgPDwgMHg2IHwgKGZvdXJ0aEJ5dGUgJiAweDNGKVxuICAgICAgICAgICAgaWYgKHRlbXBDb2RlUG9pbnQgPiAweEZGRkYgJiYgdGVtcENvZGVQb2ludCA8IDB4MTEwMDAwKSB7XG4gICAgICAgICAgICAgIGNvZGVQb2ludCA9IHRlbXBDb2RlUG9pbnRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGNvZGVQb2ludCA9PT0gbnVsbCkge1xuICAgICAgLy8gd2UgZGlkIG5vdCBnZW5lcmF0ZSBhIHZhbGlkIGNvZGVQb2ludCBzbyBpbnNlcnQgYVxuICAgICAgLy8gcmVwbGFjZW1lbnQgY2hhciAoVStGRkZEKSBhbmQgYWR2YW5jZSBvbmx5IDEgYnl0ZVxuICAgICAgY29kZVBvaW50ID0gMHhGRkZEXG4gICAgICBieXRlc1BlclNlcXVlbmNlID0gMVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50ID4gMHhGRkZGKSB7XG4gICAgICAvLyBlbmNvZGUgdG8gdXRmMTYgKHN1cnJvZ2F0ZSBwYWlyIGRhbmNlKVxuICAgICAgY29kZVBvaW50IC09IDB4MTAwMDBcbiAgICAgIHJlcy5wdXNoKGNvZGVQb2ludCA+Pj4gMTAgJiAweDNGRiB8IDB4RDgwMClcbiAgICAgIGNvZGVQb2ludCA9IDB4REMwMCB8IGNvZGVQb2ludCAmIDB4M0ZGXG4gICAgfVxuXG4gICAgcmVzLnB1c2goY29kZVBvaW50KVxuICAgIGkgKz0gYnl0ZXNQZXJTZXF1ZW5jZVxuICB9XG5cbiAgcmV0dXJuIGRlY29kZUNvZGVQb2ludHNBcnJheShyZXMpXG59XG5cbi8vIEJhc2VkIG9uIGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9hLzIyNzQ3MjcyLzY4MDc0MiwgdGhlIGJyb3dzZXIgd2l0aFxuLy8gdGhlIGxvd2VzdCBsaW1pdCBpcyBDaHJvbWUsIHdpdGggMHgxMDAwMCBhcmdzLlxuLy8gV2UgZ28gMSBtYWduaXR1ZGUgbGVzcywgZm9yIHNhZmV0eVxudmFyIE1BWF9BUkdVTUVOVFNfTEVOR1RIID0gMHgxMDAwXG5cbmZ1bmN0aW9uIGRlY29kZUNvZGVQb2ludHNBcnJheSAoY29kZVBvaW50cykge1xuICB2YXIgbGVuID0gY29kZVBvaW50cy5sZW5ndGhcbiAgaWYgKGxlbiA8PSBNQVhfQVJHVU1FTlRTX0xFTkdUSCkge1xuICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KFN0cmluZywgY29kZVBvaW50cykgLy8gYXZvaWQgZXh0cmEgc2xpY2UoKVxuICB9XG5cbiAgLy8gRGVjb2RlIGluIGNodW5rcyB0byBhdm9pZCBcImNhbGwgc3RhY2sgc2l6ZSBleGNlZWRlZFwiLlxuICB2YXIgcmVzID0gJydcbiAgdmFyIGkgPSAwXG4gIHdoaWxlIChpIDwgbGVuKSB7XG4gICAgcmVzICs9IFN0cmluZy5mcm9tQ2hhckNvZGUuYXBwbHkoXG4gICAgICBTdHJpbmcsXG4gICAgICBjb2RlUG9pbnRzLnNsaWNlKGksIGkgKz0gTUFYX0FSR1VNRU5UU19MRU5HVEgpXG4gICAgKVxuICB9XG4gIHJldHVybiByZXNcbn1cblxuZnVuY3Rpb24gYXNjaWlTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXQgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyArK2kpIHtcbiAgICByZXQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0gJiAweDdGKVxuICB9XG4gIHJldHVybiByZXRcbn1cblxuZnVuY3Rpb24gbGF0aW4xU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgKytpKSB7XG4gICAgcmV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldKVxuICB9XG4gIHJldHVybiByZXRcbn1cblxuZnVuY3Rpb24gaGV4U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuXG4gIGlmICghc3RhcnQgfHwgc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgfHwgZW5kIDwgMCB8fCBlbmQgPiBsZW4pIGVuZCA9IGxlblxuXG4gIHZhciBvdXQgPSAnJ1xuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7ICsraSkge1xuICAgIG91dCArPSB0b0hleChidWZbaV0pXG4gIH1cbiAgcmV0dXJuIG91dFxufVxuXG5mdW5jdGlvbiB1dGYxNmxlU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgYnl0ZXMgPSBidWYuc2xpY2Uoc3RhcnQsIGVuZClcbiAgdmFyIHJlcyA9ICcnXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICByZXMgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShieXRlc1tpXSArIGJ5dGVzW2kgKyAxXSAqIDI1NilcbiAgfVxuICByZXR1cm4gcmVzXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuc2xpY2UgPSBmdW5jdGlvbiBzbGljZSAoc3RhcnQsIGVuZCkge1xuICB2YXIgbGVuID0gdGhpcy5sZW5ndGhcbiAgc3RhcnQgPSB+fnN0YXJ0XG4gIGVuZCA9IGVuZCA9PT0gdW5kZWZpbmVkID8gbGVuIDogfn5lbmRcblxuICBpZiAoc3RhcnQgPCAwKSB7XG4gICAgc3RhcnQgKz0gbGVuXG4gICAgaWYgKHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIH0gZWxzZSBpZiAoc3RhcnQgPiBsZW4pIHtcbiAgICBzdGFydCA9IGxlblxuICB9XG5cbiAgaWYgKGVuZCA8IDApIHtcbiAgICBlbmQgKz0gbGVuXG4gICAgaWYgKGVuZCA8IDApIGVuZCA9IDBcbiAgfSBlbHNlIGlmIChlbmQgPiBsZW4pIHtcbiAgICBlbmQgPSBsZW5cbiAgfVxuXG4gIGlmIChlbmQgPCBzdGFydCkgZW5kID0gc3RhcnRcblxuICB2YXIgbmV3QnVmXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIG5ld0J1ZiA9IHRoaXMuc3ViYXJyYXkoc3RhcnQsIGVuZClcbiAgICBuZXdCdWYuX19wcm90b19fID0gQnVmZmVyLnByb3RvdHlwZVxuICB9IGVsc2Uge1xuICAgIHZhciBzbGljZUxlbiA9IGVuZCAtIHN0YXJ0XG4gICAgbmV3QnVmID0gbmV3IEJ1ZmZlcihzbGljZUxlbiwgdW5kZWZpbmVkKVxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2xpY2VMZW47ICsraSkge1xuICAgICAgbmV3QnVmW2ldID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ld0J1ZlxufVxuXG4vKlxuICogTmVlZCB0byBtYWtlIHN1cmUgdGhhdCBidWZmZXIgaXNuJ3QgdHJ5aW5nIHRvIHdyaXRlIG91dCBvZiBib3VuZHMuXG4gKi9cbmZ1bmN0aW9uIGNoZWNrT2Zmc2V0IChvZmZzZXQsIGV4dCwgbGVuZ3RoKSB7XG4gIGlmICgob2Zmc2V0ICUgMSkgIT09IDAgfHwgb2Zmc2V0IDwgMCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ29mZnNldCBpcyBub3QgdWludCcpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBsZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdUcnlpbmcgdG8gYWNjZXNzIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludExFID0gZnVuY3Rpb24gcmVhZFVJbnRMRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldF1cbiAgdmFyIG11bCA9IDFcbiAgdmFyIGkgPSAwXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgaV0gKiBtdWxcbiAgfVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludEJFID0gZnVuY3Rpb24gcmVhZFVJbnRCRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcbiAgfVxuXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIC0tYnl0ZUxlbmd0aF1cbiAgdmFyIG11bCA9IDFcbiAgd2hpbGUgKGJ5dGVMZW5ndGggPiAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgLS1ieXRlTGVuZ3RoXSAqIG11bFxuICB9XG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50OCA9IGZ1bmN0aW9uIHJlYWRVSW50OCAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDEsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkxFID0gZnVuY3Rpb24gcmVhZFVJbnQxNkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiB0aGlzW29mZnNldF0gfCAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZCRSA9IGZ1bmN0aW9uIHJlYWRVSW50MTZCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSA8PCA4KSB8IHRoaXNbb2Zmc2V0ICsgMV1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyTEUgPSBmdW5jdGlvbiByZWFkVUludDMyTEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKCh0aGlzW29mZnNldF0pIHxcbiAgICAgICh0aGlzW29mZnNldCArIDFdIDw8IDgpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDJdIDw8IDE2KSkgK1xuICAgICAgKHRoaXNbb2Zmc2V0ICsgM10gKiAweDEwMDAwMDApXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkJFID0gZnVuY3Rpb24gcmVhZFVJbnQzMkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0gKiAweDEwMDAwMDApICtcbiAgICAoKHRoaXNbb2Zmc2V0ICsgMV0gPDwgMTYpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCA4KSB8XG4gICAgdGhpc1tvZmZzZXQgKyAzXSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50TEUgPSBmdW5jdGlvbiByZWFkSW50TEUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIGldICogbXVsXG4gIH1cbiAgbXVsICo9IDB4ODBcblxuICBpZiAodmFsID49IG11bCkgdmFsIC09IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50QkUgPSBmdW5jdGlvbiByZWFkSW50QkUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgaSA9IGJ5dGVMZW5ndGhcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgLS1pXVxuICB3aGlsZSAoaSA+IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyAtLWldICogbXVsXG4gIH1cbiAgbXVsICo9IDB4ODBcblxuICBpZiAodmFsID49IG11bCkgdmFsIC09IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50OCA9IGZ1bmN0aW9uIHJlYWRJbnQ4IChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMSwgdGhpcy5sZW5ndGgpXG4gIGlmICghKHRoaXNbb2Zmc2V0XSAmIDB4ODApKSByZXR1cm4gKHRoaXNbb2Zmc2V0XSlcbiAgcmV0dXJuICgoMHhmZiAtIHRoaXNbb2Zmc2V0XSArIDEpICogLTEpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDE2TEUgPSBmdW5jdGlvbiByZWFkSW50MTZMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbiAgcmV0dXJuICh2YWwgJiAweDgwMDApID8gdmFsIHwgMHhGRkZGMDAwMCA6IHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkJFID0gZnVuY3Rpb24gcmVhZEludDE2QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgMV0gfCAodGhpc1tvZmZzZXRdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJMRSA9IGZ1bmN0aW9uIHJlYWRJbnQzMkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0pIHxcbiAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgMTYpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAzXSA8PCAyNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJCRSA9IGZ1bmN0aW9uIHJlYWRJbnQzMkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgMjQpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCAxNikgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDgpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAzXSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRMRSA9IGZ1bmN0aW9uIHJlYWRGbG9hdExFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCB0cnVlLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRCRSA9IGZ1bmN0aW9uIHJlYWRGbG9hdEJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUxFID0gZnVuY3Rpb24gcmVhZERvdWJsZUxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCB0cnVlLCA1MiwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlQkUgPSBmdW5jdGlvbiByZWFkRG91YmxlQkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA4LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIGZhbHNlLCA1MiwgOClcbn1cblxuZnVuY3Rpb24gY2hlY2tJbnQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgZXh0LCBtYXgsIG1pbikge1xuICBpZiAoIWludGVybmFsSXNCdWZmZXIoYnVmKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignXCJidWZmZXJcIiBhcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyIGluc3RhbmNlJylcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignXCJ2YWx1ZVwiIGFyZ3VtZW50IGlzIG91dCBvZiBib3VuZHMnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gYnVmLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0luZGV4IG91dCBvZiByYW5nZScpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50TEUgPSBmdW5jdGlvbiB3cml0ZVVJbnRMRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIHZhciBtYXhCeXRlcyA9IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSAtIDFcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBtYXhCeXRlcywgMClcbiAgfVxuXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB0aGlzW29mZnNldF0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKHZhbHVlIC8gbXVsKSAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50QkUgPSBmdW5jdGlvbiB3cml0ZVVJbnRCRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIHZhciBtYXhCeXRlcyA9IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSAtIDFcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBtYXhCeXRlcywgMClcbiAgfVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aCAtIDFcbiAgdmFyIG11bCA9IDFcbiAgdGhpc1tvZmZzZXQgKyBpXSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoLS1pID49IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKHZhbHVlIC8gbXVsKSAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50OCA9IGZ1bmN0aW9uIHdyaXRlVUludDggKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMSwgMHhmZiwgMClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICB0aGlzW29mZnNldF0gPSAodmFsdWUgJiAweGZmKVxuICByZXR1cm4gb2Zmc2V0ICsgMVxufVxuXG5mdW5jdGlvbiBvYmplY3RXcml0ZVVJbnQxNiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4pIHtcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmZmYgKyB2YWx1ZSArIDFcbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihidWYubGVuZ3RoIC0gb2Zmc2V0LCAyKTsgaSA8IGo7ICsraSkge1xuICAgIGJ1ZltvZmZzZXQgKyBpXSA9ICh2YWx1ZSAmICgweGZmIDw8ICg4ICogKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkpKSkgPj4+XG4gICAgICAobGl0dGxlRW5kaWFuID8gaSA6IDEgLSBpKSAqIDhcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2TEUgPSBmdW5jdGlvbiB3cml0ZVVJbnQxNkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4ZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlICYgMHhmZilcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkJFID0gZnVuY3Rpb24gd3JpdGVVSW50MTZCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweGZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlICYgMHhmZilcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5mdW5jdGlvbiBvYmplY3RXcml0ZVVJbnQzMiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4pIHtcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmZmZmZmZmICsgdmFsdWUgKyAxXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4oYnVmLmxlbmd0aCAtIG9mZnNldCwgNCk7IGkgPCBqOyArK2kpIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSAodmFsdWUgPj4+IChsaXR0bGVFbmRpYW4gPyBpIDogMyAtIGkpICogOCkgJiAweGZmXG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkxFID0gZnVuY3Rpb24gd3JpdGVVSW50MzJMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweGZmZmZmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldCArIDNdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSAmIDB4ZmYpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyQkUgPSBmdW5jdGlvbiB3cml0ZVVJbnQzMkJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4ZmZmZmZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDNdID0gKHZhbHVlICYgMHhmZilcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50TEUgPSBmdW5jdGlvbiB3cml0ZUludExFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICB2YXIgbGltaXQgPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCAtIDEpXG5cbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBsaW1pdCAtIDEsIC1saW1pdClcbiAgfVxuXG4gIHZhciBpID0gMFxuICB2YXIgbXVsID0gMVxuICB2YXIgc3ViID0gMFxuICB0aGlzW29mZnNldF0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICBpZiAodmFsdWUgPCAwICYmIHN1YiA9PT0gMCAmJiB0aGlzW29mZnNldCArIGkgLSAxXSAhPT0gMCkge1xuICAgICAgc3ViID0gMVxuICAgIH1cbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50QkUgPSBmdW5jdGlvbiB3cml0ZUludEJFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICB2YXIgbGltaXQgPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCAtIDEpXG5cbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBsaW1pdCAtIDEsIC1saW1pdClcbiAgfVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aCAtIDFcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHN1YiA9IDBcbiAgdGhpc1tvZmZzZXQgKyBpXSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoLS1pID49IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICBpZiAodmFsdWUgPCAwICYmIHN1YiA9PT0gMCAmJiB0aGlzW29mZnNldCArIGkgKyAxXSAhPT0gMCkge1xuICAgICAgc3ViID0gMVxuICAgIH1cbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50OCA9IGZ1bmN0aW9uIHdyaXRlSW50OCAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweDdmLCAtMHg4MClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmYgKyB2YWx1ZSArIDFcbiAgdGhpc1tvZmZzZXRdID0gKHZhbHVlICYgMHhmZilcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2TEUgPSBmdW5jdGlvbiB3cml0ZUludDE2TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgJiAweGZmKVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlSW50MTZCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweDdmZmYsIC0weDgwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlICYgMHhmZilcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJMRSA9IGZ1bmN0aW9uIHdyaXRlSW50MzJMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlICYgMHhmZilcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyQkUgPSBmdW5jdGlvbiB3cml0ZUludDMyQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSAmIDB4ZmYpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuZnVuY3Rpb24gY2hlY2tJRUVFNzU0IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKG9mZnNldCArIGV4dCA+IGJ1Zi5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdJbmRleCBvdXQgb2YgcmFuZ2UnKVxuICBpZiAob2Zmc2V0IDwgMCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0luZGV4IG91dCBvZiByYW5nZScpXG59XG5cbmZ1bmN0aW9uIHdyaXRlRmxvYXQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tJRUVFNzU0KGJ1ZiwgdmFsdWUsIG9mZnNldCwgNCwgMy40MDI4MjM0NjYzODUyODg2ZSszOCwgLTMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgpXG4gIH1cbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgMjMsIDQpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdExFID0gZnVuY3Rpb24gd3JpdGVGbG9hdExFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0QkUgPSBmdW5jdGlvbiB3cml0ZUZsb2F0QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gd3JpdGVEb3VibGUgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tJRUVFNzU0KGJ1ZiwgdmFsdWUsIG9mZnNldCwgOCwgMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgsIC0xLjc5NzY5MzEzNDg2MjMxNTdFKzMwOClcbiAgfVxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCA1MiwgOClcbiAgcmV0dXJuIG9mZnNldCArIDhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUxFID0gZnVuY3Rpb24gd3JpdGVEb3VibGVMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlQkUgPSBmdW5jdGlvbiB3cml0ZURvdWJsZUJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVEb3VibGUodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG4vLyBjb3B5KHRhcmdldEJ1ZmZlciwgdGFyZ2V0U3RhcnQ9MCwgc291cmNlU3RhcnQ9MCwgc291cmNlRW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbiBjb3B5ICh0YXJnZXQsIHRhcmdldFN0YXJ0LCBzdGFydCwgZW5kKSB7XG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCAmJiBlbmQgIT09IDApIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICh0YXJnZXRTdGFydCA+PSB0YXJnZXQubGVuZ3RoKSB0YXJnZXRTdGFydCA9IHRhcmdldC5sZW5ndGhcbiAgaWYgKCF0YXJnZXRTdGFydCkgdGFyZ2V0U3RhcnQgPSAwXG4gIGlmIChlbmQgPiAwICYmIGVuZCA8IHN0YXJ0KSBlbmQgPSBzdGFydFxuXG4gIC8vIENvcHkgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuIDBcbiAgaWYgKHRhcmdldC5sZW5ndGggPT09IDAgfHwgdGhpcy5sZW5ndGggPT09IDApIHJldHVybiAwXG5cbiAgLy8gRmF0YWwgZXJyb3IgY29uZGl0aW9uc1xuICBpZiAodGFyZ2V0U3RhcnQgPCAwKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3RhcmdldFN0YXJ0IG91dCBvZiBib3VuZHMnKVxuICB9XG4gIGlmIChzdGFydCA8IDAgfHwgc3RhcnQgPj0gdGhpcy5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdzb3VyY2VTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgaWYgKGVuZCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdzb3VyY2VFbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgLy8gQXJlIHdlIG9vYj9cbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0Lmxlbmd0aCAtIHRhcmdldFN0YXJ0IDwgZW5kIC0gc3RhcnQpIHtcbiAgICBlbmQgPSB0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0U3RhcnQgKyBzdGFydFxuICB9XG5cbiAgdmFyIGxlbiA9IGVuZCAtIHN0YXJ0XG4gIHZhciBpXG5cbiAgaWYgKHRoaXMgPT09IHRhcmdldCAmJiBzdGFydCA8IHRhcmdldFN0YXJ0ICYmIHRhcmdldFN0YXJ0IDwgZW5kKSB7XG4gICAgLy8gZGVzY2VuZGluZyBjb3B5IGZyb20gZW5kXG4gICAgZm9yIChpID0gbGVuIC0gMTsgaSA+PSAwOyAtLWkpIHtcbiAgICAgIHRhcmdldFtpICsgdGFyZ2V0U3RhcnRdID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9IGVsc2UgaWYgKGxlbiA8IDEwMDAgfHwgIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgLy8gYXNjZW5kaW5nIGNvcHkgZnJvbSBzdGFydFxuICAgIGZvciAoaSA9IDA7IGkgPCBsZW47ICsraSkge1xuICAgICAgdGFyZ2V0W2kgKyB0YXJnZXRTdGFydF0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgVWludDhBcnJheS5wcm90b3R5cGUuc2V0LmNhbGwoXG4gICAgICB0YXJnZXQsXG4gICAgICB0aGlzLnN1YmFycmF5KHN0YXJ0LCBzdGFydCArIGxlbiksXG4gICAgICB0YXJnZXRTdGFydFxuICAgIClcbiAgfVxuXG4gIHJldHVybiBsZW5cbn1cblxuLy8gVXNhZ2U6XG4vLyAgICBidWZmZXIuZmlsbChudW1iZXJbLCBvZmZzZXRbLCBlbmRdXSlcbi8vICAgIGJ1ZmZlci5maWxsKGJ1ZmZlclssIG9mZnNldFssIGVuZF1dKVxuLy8gICAgYnVmZmVyLmZpbGwoc3RyaW5nWywgb2Zmc2V0WywgZW5kXV1bLCBlbmNvZGluZ10pXG5CdWZmZXIucHJvdG90eXBlLmZpbGwgPSBmdW5jdGlvbiBmaWxsICh2YWwsIHN0YXJ0LCBlbmQsIGVuY29kaW5nKSB7XG4gIC8vIEhhbmRsZSBzdHJpbmcgY2FzZXM6XG4gIGlmICh0eXBlb2YgdmFsID09PSAnc3RyaW5nJykge1xuICAgIGlmICh0eXBlb2Ygc3RhcnQgPT09ICdzdHJpbmcnKSB7XG4gICAgICBlbmNvZGluZyA9IHN0YXJ0XG4gICAgICBzdGFydCA9IDBcbiAgICAgIGVuZCA9IHRoaXMubGVuZ3RoXG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZW5kID09PSAnc3RyaW5nJykge1xuICAgICAgZW5jb2RpbmcgPSBlbmRcbiAgICAgIGVuZCA9IHRoaXMubGVuZ3RoXG4gICAgfVxuICAgIGlmICh2YWwubGVuZ3RoID09PSAxKSB7XG4gICAgICB2YXIgY29kZSA9IHZhbC5jaGFyQ29kZUF0KDApXG4gICAgICBpZiAoY29kZSA8IDI1Nikge1xuICAgICAgICB2YWwgPSBjb2RlXG4gICAgICB9XG4gICAgfVxuICAgIGlmIChlbmNvZGluZyAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBlbmNvZGluZyAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2VuY29kaW5nIG11c3QgYmUgYSBzdHJpbmcnKVxuICAgIH1cbiAgICBpZiAodHlwZW9mIGVuY29kaW5nID09PSAnc3RyaW5nJyAmJiAhQnVmZmVyLmlzRW5jb2RpbmcoZW5jb2RpbmcpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgfVxuICB9IGVsc2UgaWYgKHR5cGVvZiB2YWwgPT09ICdudW1iZXInKSB7XG4gICAgdmFsID0gdmFsICYgMjU1XG4gIH1cblxuICAvLyBJbnZhbGlkIHJhbmdlcyBhcmUgbm90IHNldCB0byBhIGRlZmF1bHQsIHNvIGNhbiByYW5nZSBjaGVjayBlYXJseS5cbiAgaWYgKHN0YXJ0IDwgMCB8fCB0aGlzLmxlbmd0aCA8IHN0YXJ0IHx8IHRoaXMubGVuZ3RoIDwgZW5kKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ091dCBvZiByYW5nZSBpbmRleCcpXG4gIH1cblxuICBpZiAoZW5kIDw9IHN0YXJ0KSB7XG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIHN0YXJ0ID0gc3RhcnQgPj4+IDBcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgPyB0aGlzLmxlbmd0aCA6IGVuZCA+Pj4gMFxuXG4gIGlmICghdmFsKSB2YWwgPSAwXG5cbiAgdmFyIGlcbiAgaWYgKHR5cGVvZiB2YWwgPT09ICdudW1iZXInKSB7XG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7ICsraSkge1xuICAgICAgdGhpc1tpXSA9IHZhbFxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB2YXIgYnl0ZXMgPSBpbnRlcm5hbElzQnVmZmVyKHZhbClcbiAgICAgID8gdmFsXG4gICAgICA6IHV0ZjhUb0J5dGVzKG5ldyBCdWZmZXIodmFsLCBlbmNvZGluZykudG9TdHJpbmcoKSlcbiAgICB2YXIgbGVuID0gYnl0ZXMubGVuZ3RoXG4gICAgZm9yIChpID0gMDsgaSA8IGVuZCAtIHN0YXJ0OyArK2kpIHtcbiAgICAgIHRoaXNbaSArIHN0YXJ0XSA9IGJ5dGVzW2kgJSBsZW5dXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRoaXNcbn1cblxuLy8gSEVMUEVSIEZVTkNUSU9OU1xuLy8gPT09PT09PT09PT09PT09PVxuXG52YXIgSU5WQUxJRF9CQVNFNjRfUkUgPSAvW14rXFwvMC05QS1aYS16LV9dL2dcblxuZnVuY3Rpb24gYmFzZTY0Y2xlYW4gKHN0cikge1xuICAvLyBOb2RlIHN0cmlwcyBvdXQgaW52YWxpZCBjaGFyYWN0ZXJzIGxpa2UgXFxuIGFuZCBcXHQgZnJvbSB0aGUgc3RyaW5nLCBiYXNlNjQtanMgZG9lcyBub3RcbiAgc3RyID0gc3RyaW5ndHJpbShzdHIpLnJlcGxhY2UoSU5WQUxJRF9CQVNFNjRfUkUsICcnKVxuICAvLyBOb2RlIGNvbnZlcnRzIHN0cmluZ3Mgd2l0aCBsZW5ndGggPCAyIHRvICcnXG4gIGlmIChzdHIubGVuZ3RoIDwgMikgcmV0dXJuICcnXG4gIC8vIE5vZGUgYWxsb3dzIGZvciBub24tcGFkZGVkIGJhc2U2NCBzdHJpbmdzIChtaXNzaW5nIHRyYWlsaW5nID09PSksIGJhc2U2NC1qcyBkb2VzIG5vdFxuICB3aGlsZSAoc3RyLmxlbmd0aCAlIDQgIT09IDApIHtcbiAgICBzdHIgPSBzdHIgKyAnPSdcbiAgfVxuICByZXR1cm4gc3RyXG59XG5cbmZ1bmN0aW9uIHN0cmluZ3RyaW0gKHN0cikge1xuICBpZiAoc3RyLnRyaW0pIHJldHVybiBzdHIudHJpbSgpXG4gIHJldHVybiBzdHIucmVwbGFjZSgvXlxccyt8XFxzKyQvZywgJycpXG59XG5cbmZ1bmN0aW9uIHRvSGV4IChuKSB7XG4gIGlmIChuIDwgMTYpIHJldHVybiAnMCcgKyBuLnRvU3RyaW5nKDE2KVxuICByZXR1cm4gbi50b1N0cmluZygxNilcbn1cblxuZnVuY3Rpb24gdXRmOFRvQnl0ZXMgKHN0cmluZywgdW5pdHMpIHtcbiAgdW5pdHMgPSB1bml0cyB8fCBJbmZpbml0eVxuICB2YXIgY29kZVBvaW50XG4gIHZhciBsZW5ndGggPSBzdHJpbmcubGVuZ3RoXG4gIHZhciBsZWFkU3Vycm9nYXRlID0gbnVsbFxuICB2YXIgYnl0ZXMgPSBbXVxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyArK2kpIHtcbiAgICBjb2RlUG9pbnQgPSBzdHJpbmcuY2hhckNvZGVBdChpKVxuXG4gICAgLy8gaXMgc3Vycm9nYXRlIGNvbXBvbmVudFxuICAgIGlmIChjb2RlUG9pbnQgPiAweEQ3RkYgJiYgY29kZVBvaW50IDwgMHhFMDAwKSB7XG4gICAgICAvLyBsYXN0IGNoYXIgd2FzIGEgbGVhZFxuICAgICAgaWYgKCFsZWFkU3Vycm9nYXRlKSB7XG4gICAgICAgIC8vIG5vIGxlYWQgeWV0XG4gICAgICAgIGlmIChjb2RlUG9pbnQgPiAweERCRkYpIHtcbiAgICAgICAgICAvLyB1bmV4cGVjdGVkIHRyYWlsXG4gICAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfSBlbHNlIGlmIChpICsgMSA9PT0gbGVuZ3RoKSB7XG4gICAgICAgICAgLy8gdW5wYWlyZWQgbGVhZFxuICAgICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICAvLyB2YWxpZCBsZWFkXG4gICAgICAgIGxlYWRTdXJyb2dhdGUgPSBjb2RlUG9pbnRcblxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICAvLyAyIGxlYWRzIGluIGEgcm93XG4gICAgICBpZiAoY29kZVBvaW50IDwgMHhEQzAwKSB7XG4gICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICBsZWFkU3Vycm9nYXRlID0gY29kZVBvaW50XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIC8vIHZhbGlkIHN1cnJvZ2F0ZSBwYWlyXG4gICAgICBjb2RlUG9pbnQgPSAobGVhZFN1cnJvZ2F0ZSAtIDB4RDgwMCA8PCAxMCB8IGNvZGVQb2ludCAtIDB4REMwMCkgKyAweDEwMDAwXG4gICAgfSBlbHNlIGlmIChsZWFkU3Vycm9nYXRlKSB7XG4gICAgICAvLyB2YWxpZCBibXAgY2hhciwgYnV0IGxhc3QgY2hhciB3YXMgYSBsZWFkXG4gICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICB9XG5cbiAgICBsZWFkU3Vycm9nYXRlID0gbnVsbFxuXG4gICAgLy8gZW5jb2RlIHV0ZjhcbiAgICBpZiAoY29kZVBvaW50IDwgMHg4MCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAxKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKGNvZGVQb2ludClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4ODAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDIpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgfCAweEMwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50IDwgMHgxMDAwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAzKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHhDIHwgMHhFMCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50IDwgMHgxMTAwMDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gNCkgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4MTIgfCAweEYwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHhDICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGNvZGUgcG9pbnQnKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBieXRlc1xufVxuXG5mdW5jdGlvbiBhc2NpaVRvQnl0ZXMgKHN0cikge1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyArK2kpIHtcbiAgICAvLyBOb2RlJ3MgY29kZSBzZWVtcyB0byBiZSBkb2luZyB0aGlzIGFuZCBub3QgJiAweDdGLi5cbiAgICBieXRlQXJyYXkucHVzaChzdHIuY2hhckNvZGVBdChpKSAmIDB4RkYpXG4gIH1cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiB1dGYxNmxlVG9CeXRlcyAoc3RyLCB1bml0cykge1xuICB2YXIgYywgaGksIGxvXG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7ICsraSkge1xuICAgIGlmICgodW5pdHMgLT0gMikgPCAwKSBicmVha1xuXG4gICAgYyA9IHN0ci5jaGFyQ29kZUF0KGkpXG4gICAgaGkgPSBjID4+IDhcbiAgICBsbyA9IGMgJSAyNTZcbiAgICBieXRlQXJyYXkucHVzaChsbylcbiAgICBieXRlQXJyYXkucHVzaChoaSlcbiAgfVxuXG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuXG5mdW5jdGlvbiBiYXNlNjRUb0J5dGVzIChzdHIpIHtcbiAgcmV0dXJuIGJhc2U2NC50b0J5dGVBcnJheShiYXNlNjRjbGVhbihzdHIpKVxufVxuXG5mdW5jdGlvbiBibGl0QnVmZmVyIChzcmMsIGRzdCwgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7ICsraSkge1xuICAgIGlmICgoaSArIG9mZnNldCA+PSBkc3QubGVuZ3RoKSB8fCAoaSA+PSBzcmMubGVuZ3RoKSkgYnJlYWtcbiAgICBkc3RbaSArIG9mZnNldF0gPSBzcmNbaV1cbiAgfVxuICByZXR1cm4gaVxufVxuXG5mdW5jdGlvbiBpc25hbiAodmFsKSB7XG4gIHJldHVybiB2YWwgIT09IHZhbCAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXNlbGYtY29tcGFyZVxufVxuXG5cbi8vIHRoZSBmb2xsb3dpbmcgaXMgZnJvbSBpcy1idWZmZXIsIGFsc28gYnkgRmVyb3NzIEFib3VraGFkaWplaCBhbmQgd2l0aCBzYW1lIGxpc2VuY2Vcbi8vIFRoZSBfaXNCdWZmZXIgY2hlY2sgaXMgZm9yIFNhZmFyaSA1LTcgc3VwcG9ydCwgYmVjYXVzZSBpdCdzIG1pc3Npbmdcbi8vIE9iamVjdC5wcm90b3R5cGUuY29uc3RydWN0b3IuIFJlbW92ZSB0aGlzIGV2ZW50dWFsbHlcbmV4cG9ydCBmdW5jdGlvbiBpc0J1ZmZlcihvYmopIHtcbiAgcmV0dXJuIG9iaiAhPSBudWxsICYmICghIW9iai5faXNCdWZmZXIgfHwgaXNGYXN0QnVmZmVyKG9iaikgfHwgaXNTbG93QnVmZmVyKG9iaikpXG59XG5cbmZ1bmN0aW9uIGlzRmFzdEJ1ZmZlciAob2JqKSB7XG4gIHJldHVybiAhIW9iai5jb25zdHJ1Y3RvciAmJiB0eXBlb2Ygb2JqLmNvbnN0cnVjdG9yLmlzQnVmZmVyID09PSAnZnVuY3Rpb24nICYmIG9iai5jb25zdHJ1Y3Rvci5pc0J1ZmZlcihvYmopXG59XG5cbi8vIEZvciBOb2RlIHYwLjEwIHN1cHBvcnQuIFJlbW92ZSB0aGlzIGV2ZW50dWFsbHkuXG5mdW5jdGlvbiBpc1Nsb3dCdWZmZXIgKG9iaikge1xuICByZXR1cm4gdHlwZW9mIG9iai5yZWFkRmxvYXRMRSA9PT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2Ygb2JqLnNsaWNlID09PSAnZnVuY3Rpb24nICYmIGlzRmFzdEJ1ZmZlcihvYmouc2xpY2UoMCwgMCkpXG59XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gaXNCdWY7XG5cbnZhciB3aXRoTmF0aXZlQnVmZmVyID0gdHlwZW9mIEJ1ZmZlciA9PT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgQnVmZmVyLmlzQnVmZmVyID09PSAnZnVuY3Rpb24nO1xudmFyIHdpdGhOYXRpdmVBcnJheUJ1ZmZlciA9IHR5cGVvZiBBcnJheUJ1ZmZlciA9PT0gJ2Z1bmN0aW9uJztcblxudmFyIGlzVmlldyA9IGZ1bmN0aW9uIChvYmopIHtcbiAgcmV0dXJuIHR5cGVvZiBBcnJheUJ1ZmZlci5pc1ZpZXcgPT09ICdmdW5jdGlvbicgPyBBcnJheUJ1ZmZlci5pc1ZpZXcob2JqKSA6IChvYmouYnVmZmVyIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpO1xufTtcblxuLyoqXG4gKiBSZXR1cm5zIHRydWUgaWYgb2JqIGlzIGEgYnVmZmVyIG9yIGFuIGFycmF5YnVmZmVyLlxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGlzQnVmKG9iaikge1xuICByZXR1cm4gKHdpdGhOYXRpdmVCdWZmZXIgJiYgQnVmZmVyLmlzQnVmZmVyKG9iaikpIHx8XG4gICAgICAgICAgKHdpdGhOYXRpdmVBcnJheUJ1ZmZlciAmJiAob2JqIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIgfHwgaXNWaWV3KG9iaikpKTtcbn1cbiIsIi8qZ2xvYmFsIEJsb2IsRmlsZSovXG5cbi8qKlxuICogTW9kdWxlIHJlcXVpcmVtZW50c1xuICovXG5cbnZhciBpc0FycmF5ID0gcmVxdWlyZSgnaXNhcnJheScpO1xudmFyIGlzQnVmID0gcmVxdWlyZSgnLi9pcy1idWZmZXInKTtcbnZhciB0b1N0cmluZyA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7XG52YXIgd2l0aE5hdGl2ZUJsb2IgPSB0eXBlb2YgQmxvYiA9PT0gJ2Z1bmN0aW9uJyB8fCAodHlwZW9mIEJsb2IgIT09ICd1bmRlZmluZWQnICYmIHRvU3RyaW5nLmNhbGwoQmxvYikgPT09ICdbb2JqZWN0IEJsb2JDb25zdHJ1Y3Rvcl0nKTtcbnZhciB3aXRoTmF0aXZlRmlsZSA9IHR5cGVvZiBGaWxlID09PSAnZnVuY3Rpb24nIHx8ICh0eXBlb2YgRmlsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgdG9TdHJpbmcuY2FsbChGaWxlKSA9PT0gJ1tvYmplY3QgRmlsZUNvbnN0cnVjdG9yXScpO1xuXG4vKipcbiAqIFJlcGxhY2VzIGV2ZXJ5IEJ1ZmZlciB8IEFycmF5QnVmZmVyIGluIHBhY2tldCB3aXRoIGEgbnVtYmVyZWQgcGxhY2Vob2xkZXIuXG4gKiBBbnl0aGluZyB3aXRoIGJsb2JzIG9yIGZpbGVzIHNob3VsZCBiZSBmZWQgdGhyb3VnaCByZW1vdmVCbG9icyBiZWZvcmUgY29taW5nXG4gKiBoZXJlLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBwYWNrZXQgLSBzb2NrZXQuaW8gZXZlbnQgcGFja2V0XG4gKiBAcmV0dXJuIHtPYmplY3R9IHdpdGggZGVjb25zdHJ1Y3RlZCBwYWNrZXQgYW5kIGxpc3Qgb2YgYnVmZmVyc1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5leHBvcnRzLmRlY29uc3RydWN0UGFja2V0ID0gZnVuY3Rpb24ocGFja2V0KSB7XG4gIHZhciBidWZmZXJzID0gW107XG4gIHZhciBwYWNrZXREYXRhID0gcGFja2V0LmRhdGE7XG4gIHZhciBwYWNrID0gcGFja2V0O1xuICBwYWNrLmRhdGEgPSBfZGVjb25zdHJ1Y3RQYWNrZXQocGFja2V0RGF0YSwgYnVmZmVycyk7XG4gIHBhY2suYXR0YWNobWVudHMgPSBidWZmZXJzLmxlbmd0aDsgLy8gbnVtYmVyIG9mIGJpbmFyeSAnYXR0YWNobWVudHMnXG4gIHJldHVybiB7cGFja2V0OiBwYWNrLCBidWZmZXJzOiBidWZmZXJzfTtcbn07XG5cbmZ1bmN0aW9uIF9kZWNvbnN0cnVjdFBhY2tldChkYXRhLCBidWZmZXJzKSB7XG4gIGlmICghZGF0YSkgcmV0dXJuIGRhdGE7XG5cbiAgaWYgKGlzQnVmKGRhdGEpKSB7XG4gICAgdmFyIHBsYWNlaG9sZGVyID0geyBfcGxhY2Vob2xkZXI6IHRydWUsIG51bTogYnVmZmVycy5sZW5ndGggfTtcbiAgICBidWZmZXJzLnB1c2goZGF0YSk7XG4gICAgcmV0dXJuIHBsYWNlaG9sZGVyO1xuICB9IGVsc2UgaWYgKGlzQXJyYXkoZGF0YSkpIHtcbiAgICB2YXIgbmV3RGF0YSA9IG5ldyBBcnJheShkYXRhLmxlbmd0aCk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBkYXRhLmxlbmd0aDsgaSsrKSB7XG4gICAgICBuZXdEYXRhW2ldID0gX2RlY29uc3RydWN0UGFja2V0KGRhdGFbaV0sIGJ1ZmZlcnMpO1xuICAgIH1cbiAgICByZXR1cm4gbmV3RGF0YTtcbiAgfSBlbHNlIGlmICh0eXBlb2YgZGF0YSA9PT0gJ29iamVjdCcgJiYgIShkYXRhIGluc3RhbmNlb2YgRGF0ZSkpIHtcbiAgICB2YXIgbmV3RGF0YSA9IHt9O1xuICAgIGZvciAodmFyIGtleSBpbiBkYXRhKSB7XG4gICAgICBuZXdEYXRhW2tleV0gPSBfZGVjb25zdHJ1Y3RQYWNrZXQoZGF0YVtrZXldLCBidWZmZXJzKTtcbiAgICB9XG4gICAgcmV0dXJuIG5ld0RhdGE7XG4gIH1cbiAgcmV0dXJuIGRhdGE7XG59XG5cbi8qKlxuICogUmVjb25zdHJ1Y3RzIGEgYmluYXJ5IHBhY2tldCBmcm9tIGl0cyBwbGFjZWhvbGRlciBwYWNrZXQgYW5kIGJ1ZmZlcnNcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gcGFja2V0IC0gZXZlbnQgcGFja2V0IHdpdGggcGxhY2Vob2xkZXJzXG4gKiBAcGFyYW0ge0FycmF5fSBidWZmZXJzIC0gYmluYXJ5IGJ1ZmZlcnMgdG8gcHV0IGluIHBsYWNlaG9sZGVyIHBvc2l0aW9uc1xuICogQHJldHVybiB7T2JqZWN0fSByZWNvbnN0cnVjdGVkIHBhY2tldFxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5leHBvcnRzLnJlY29uc3RydWN0UGFja2V0ID0gZnVuY3Rpb24ocGFja2V0LCBidWZmZXJzKSB7XG4gIHBhY2tldC5kYXRhID0gX3JlY29uc3RydWN0UGFja2V0KHBhY2tldC5kYXRhLCBidWZmZXJzKTtcbiAgcGFja2V0LmF0dGFjaG1lbnRzID0gdW5kZWZpbmVkOyAvLyBubyBsb25nZXIgdXNlZnVsXG4gIHJldHVybiBwYWNrZXQ7XG59O1xuXG5mdW5jdGlvbiBfcmVjb25zdHJ1Y3RQYWNrZXQoZGF0YSwgYnVmZmVycykge1xuICBpZiAoIWRhdGEpIHJldHVybiBkYXRhO1xuXG4gIGlmIChkYXRhICYmIGRhdGEuX3BsYWNlaG9sZGVyKSB7XG4gICAgcmV0dXJuIGJ1ZmZlcnNbZGF0YS5udW1dOyAvLyBhcHByb3ByaWF0ZSBidWZmZXIgKHNob3VsZCBiZSBuYXR1cmFsIG9yZGVyIGFueXdheSlcbiAgfSBlbHNlIGlmIChpc0FycmF5KGRhdGEpKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBkYXRhLmxlbmd0aDsgaSsrKSB7XG4gICAgICBkYXRhW2ldID0gX3JlY29uc3RydWN0UGFja2V0KGRhdGFbaV0sIGJ1ZmZlcnMpO1xuICAgIH1cbiAgfSBlbHNlIGlmICh0eXBlb2YgZGF0YSA9PT0gJ29iamVjdCcpIHtcbiAgICBmb3IgKHZhciBrZXkgaW4gZGF0YSkge1xuICAgICAgZGF0YVtrZXldID0gX3JlY29uc3RydWN0UGFja2V0KGRhdGFba2V5XSwgYnVmZmVycyk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGRhdGE7XG59XG5cbi8qKlxuICogQXN5bmNocm9ub3VzbHkgcmVtb3ZlcyBCbG9icyBvciBGaWxlcyBmcm9tIGRhdGEgdmlhXG4gKiBGaWxlUmVhZGVyJ3MgcmVhZEFzQXJyYXlCdWZmZXIgbWV0aG9kLiBVc2VkIGJlZm9yZSBlbmNvZGluZ1xuICogZGF0YSBhcyBtc2dwYWNrLiBDYWxscyBjYWxsYmFjayB3aXRoIHRoZSBibG9ibGVzcyBkYXRhLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBkYXRhXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFja1xuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZXhwb3J0cy5yZW1vdmVCbG9icyA9IGZ1bmN0aW9uKGRhdGEsIGNhbGxiYWNrKSB7XG4gIGZ1bmN0aW9uIF9yZW1vdmVCbG9icyhvYmosIGN1cktleSwgY29udGFpbmluZ09iamVjdCkge1xuICAgIGlmICghb2JqKSByZXR1cm4gb2JqO1xuXG4gICAgLy8gY29udmVydCBhbnkgYmxvYlxuICAgIGlmICgod2l0aE5hdGl2ZUJsb2IgJiYgb2JqIGluc3RhbmNlb2YgQmxvYikgfHxcbiAgICAgICAgKHdpdGhOYXRpdmVGaWxlICYmIG9iaiBpbnN0YW5jZW9mIEZpbGUpKSB7XG4gICAgICBwZW5kaW5nQmxvYnMrKztcblxuICAgICAgLy8gYXN5bmMgZmlsZXJlYWRlclxuICAgICAgdmFyIGZpbGVSZWFkZXIgPSBuZXcgRmlsZVJlYWRlcigpO1xuICAgICAgZmlsZVJlYWRlci5vbmxvYWQgPSBmdW5jdGlvbigpIHsgLy8gdGhpcy5yZXN1bHQgPT0gYXJyYXlidWZmZXJcbiAgICAgICAgaWYgKGNvbnRhaW5pbmdPYmplY3QpIHtcbiAgICAgICAgICBjb250YWluaW5nT2JqZWN0W2N1cktleV0gPSB0aGlzLnJlc3VsdDtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICBibG9ibGVzc0RhdGEgPSB0aGlzLnJlc3VsdDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGlmIG5vdGhpbmcgcGVuZGluZyBpdHMgY2FsbGJhY2sgdGltZVxuICAgICAgICBpZighIC0tcGVuZGluZ0Jsb2JzKSB7XG4gICAgICAgICAgY2FsbGJhY2soYmxvYmxlc3NEYXRhKTtcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgZmlsZVJlYWRlci5yZWFkQXNBcnJheUJ1ZmZlcihvYmopOyAvLyBibG9iIC0+IGFycmF5YnVmZmVyXG4gICAgfSBlbHNlIGlmIChpc0FycmF5KG9iaikpIHsgLy8gaGFuZGxlIGFycmF5XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IG9iai5sZW5ndGg7IGkrKykge1xuICAgICAgICBfcmVtb3ZlQmxvYnMob2JqW2ldLCBpLCBvYmopO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodHlwZW9mIG9iaiA9PT0gJ29iamVjdCcgJiYgIWlzQnVmKG9iaikpIHsgLy8gYW5kIG9iamVjdFxuICAgICAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgICAgICBfcmVtb3ZlQmxvYnMob2JqW2tleV0sIGtleSwgb2JqKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICB2YXIgcGVuZGluZ0Jsb2JzID0gMDtcbiAgdmFyIGJsb2JsZXNzRGF0YSA9IGRhdGE7XG4gIF9yZW1vdmVCbG9icyhibG9ibGVzc0RhdGEpO1xuICBpZiAoIXBlbmRpbmdCbG9icykge1xuICAgIGNhbGxiYWNrKGJsb2JsZXNzRGF0YSk7XG4gIH1cbn07XG4iLCJcbi8qKlxuICogTW9kdWxlIGRlcGVuZGVuY2llcy5cbiAqL1xuXG52YXIgZGVidWcgPSByZXF1aXJlKCdkZWJ1ZycpKCdzb2NrZXQuaW8tcGFyc2VyJyk7XG52YXIgRW1pdHRlciA9IHJlcXVpcmUoJ2NvbXBvbmVudC1lbWl0dGVyJyk7XG52YXIgYmluYXJ5ID0gcmVxdWlyZSgnLi9iaW5hcnknKTtcbnZhciBpc0FycmF5ID0gcmVxdWlyZSgnaXNhcnJheScpO1xudmFyIGlzQnVmID0gcmVxdWlyZSgnLi9pcy1idWZmZXInKTtcblxuLyoqXG4gKiBQcm90b2NvbCB2ZXJzaW9uLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZXhwb3J0cy5wcm90b2NvbCA9IDQ7XG5cbi8qKlxuICogUGFja2V0IHR5cGVzLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZXhwb3J0cy50eXBlcyA9IFtcbiAgJ0NPTk5FQ1QnLFxuICAnRElTQ09OTkVDVCcsXG4gICdFVkVOVCcsXG4gICdBQ0snLFxuICAnRVJST1InLFxuICAnQklOQVJZX0VWRU5UJyxcbiAgJ0JJTkFSWV9BQ0snXG5dO1xuXG4vKipcbiAqIFBhY2tldCB0eXBlIGBjb25uZWN0YC5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmV4cG9ydHMuQ09OTkVDVCA9IDA7XG5cbi8qKlxuICogUGFja2V0IHR5cGUgYGRpc2Nvbm5lY3RgLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZXhwb3J0cy5ESVNDT05ORUNUID0gMTtcblxuLyoqXG4gKiBQYWNrZXQgdHlwZSBgZXZlbnRgLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZXhwb3J0cy5FVkVOVCA9IDI7XG5cbi8qKlxuICogUGFja2V0IHR5cGUgYGFja2AuXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5leHBvcnRzLkFDSyA9IDM7XG5cbi8qKlxuICogUGFja2V0IHR5cGUgYGVycm9yYC5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmV4cG9ydHMuRVJST1IgPSA0O1xuXG4vKipcbiAqIFBhY2tldCB0eXBlICdiaW5hcnkgZXZlbnQnXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5leHBvcnRzLkJJTkFSWV9FVkVOVCA9IDU7XG5cbi8qKlxuICogUGFja2V0IHR5cGUgYGJpbmFyeSBhY2tgLiBGb3IgYWNrcyB3aXRoIGJpbmFyeSBhcmd1bWVudHMuXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5leHBvcnRzLkJJTkFSWV9BQ0sgPSA2O1xuXG4vKipcbiAqIEVuY29kZXIgY29uc3RydWN0b3IuXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5leHBvcnRzLkVuY29kZXIgPSBFbmNvZGVyO1xuXG4vKipcbiAqIERlY29kZXIgY29uc3RydWN0b3IuXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5leHBvcnRzLkRlY29kZXIgPSBEZWNvZGVyO1xuXG4vKipcbiAqIEEgc29ja2V0LmlvIEVuY29kZXIgaW5zdGFuY2VcbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIEVuY29kZXIoKSB7fVxuXG52YXIgRVJST1JfUEFDS0VUID0gZXhwb3J0cy5FUlJPUiArICdcImVuY29kZSBlcnJvclwiJztcblxuLyoqXG4gKiBFbmNvZGUgYSBwYWNrZXQgYXMgYSBzaW5nbGUgc3RyaW5nIGlmIG5vbi1iaW5hcnksIG9yIGFzIGFcbiAqIGJ1ZmZlciBzZXF1ZW5jZSwgZGVwZW5kaW5nIG9uIHBhY2tldCB0eXBlLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmogLSBwYWNrZXQgb2JqZWN0XG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayAtIGZ1bmN0aW9uIHRvIGhhbmRsZSBlbmNvZGluZ3MgKGxpa2VseSBlbmdpbmUud3JpdGUpXG4gKiBAcmV0dXJuIENhbGxzIGNhbGxiYWNrIHdpdGggQXJyYXkgb2YgZW5jb2RpbmdzXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbkVuY29kZXIucHJvdG90eXBlLmVuY29kZSA9IGZ1bmN0aW9uKG9iaiwgY2FsbGJhY2spe1xuICBkZWJ1ZygnZW5jb2RpbmcgcGFja2V0ICVqJywgb2JqKTtcblxuICBpZiAoZXhwb3J0cy5CSU5BUllfRVZFTlQgPT09IG9iai50eXBlIHx8IGV4cG9ydHMuQklOQVJZX0FDSyA9PT0gb2JqLnR5cGUpIHtcbiAgICBlbmNvZGVBc0JpbmFyeShvYmosIGNhbGxiYWNrKTtcbiAgfSBlbHNlIHtcbiAgICB2YXIgZW5jb2RpbmcgPSBlbmNvZGVBc1N0cmluZyhvYmopO1xuICAgIGNhbGxiYWNrKFtlbmNvZGluZ10pO1xuICB9XG59O1xuXG4vKipcbiAqIEVuY29kZSBwYWNrZXQgYXMgc3RyaW5nLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBwYWNrZXRcbiAqIEByZXR1cm4ge1N0cmluZ30gZW5jb2RlZFxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gZW5jb2RlQXNTdHJpbmcob2JqKSB7XG5cbiAgLy8gZmlyc3QgaXMgdHlwZVxuICB2YXIgc3RyID0gJycgKyBvYmoudHlwZTtcblxuICAvLyBhdHRhY2htZW50cyBpZiB3ZSBoYXZlIHRoZW1cbiAgaWYgKGV4cG9ydHMuQklOQVJZX0VWRU5UID09PSBvYmoudHlwZSB8fCBleHBvcnRzLkJJTkFSWV9BQ0sgPT09IG9iai50eXBlKSB7XG4gICAgc3RyICs9IG9iai5hdHRhY2htZW50cyArICctJztcbiAgfVxuXG4gIC8vIGlmIHdlIGhhdmUgYSBuYW1lc3BhY2Ugb3RoZXIgdGhhbiBgL2BcbiAgLy8gd2UgYXBwZW5kIGl0IGZvbGxvd2VkIGJ5IGEgY29tbWEgYCxgXG4gIGlmIChvYmoubnNwICYmICcvJyAhPT0gb2JqLm5zcCkge1xuICAgIHN0ciArPSBvYmoubnNwICsgJywnO1xuICB9XG5cbiAgLy8gaW1tZWRpYXRlbHkgZm9sbG93ZWQgYnkgdGhlIGlkXG4gIGlmIChudWxsICE9IG9iai5pZCkge1xuICAgIHN0ciArPSBvYmouaWQ7XG4gIH1cblxuICAvLyBqc29uIGRhdGFcbiAgaWYgKG51bGwgIT0gb2JqLmRhdGEpIHtcbiAgICB2YXIgcGF5bG9hZCA9IHRyeVN0cmluZ2lmeShvYmouZGF0YSk7XG4gICAgaWYgKHBheWxvYWQgIT09IGZhbHNlKSB7XG4gICAgICBzdHIgKz0gcGF5bG9hZDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIEVSUk9SX1BBQ0tFVDtcbiAgICB9XG4gIH1cblxuICBkZWJ1ZygnZW5jb2RlZCAlaiBhcyAlcycsIG9iaiwgc3RyKTtcbiAgcmV0dXJuIHN0cjtcbn1cblxuZnVuY3Rpb24gdHJ5U3RyaW5naWZ5KHN0cikge1xuICB0cnkge1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShzdHIpO1xuICB9IGNhdGNoKGUpe1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIEVuY29kZSBwYWNrZXQgYXMgJ2J1ZmZlciBzZXF1ZW5jZScgYnkgcmVtb3ZpbmcgYmxvYnMsIGFuZFxuICogZGVjb25zdHJ1Y3RpbmcgcGFja2V0IGludG8gb2JqZWN0IHdpdGggcGxhY2Vob2xkZXJzIGFuZFxuICogYSBsaXN0IG9mIGJ1ZmZlcnMuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IHBhY2tldFxuICogQHJldHVybiB7QnVmZmVyfSBlbmNvZGVkXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBlbmNvZGVBc0JpbmFyeShvYmosIGNhbGxiYWNrKSB7XG5cbiAgZnVuY3Rpb24gd3JpdGVFbmNvZGluZyhibG9ibGVzc0RhdGEpIHtcbiAgICB2YXIgZGVjb25zdHJ1Y3Rpb24gPSBiaW5hcnkuZGVjb25zdHJ1Y3RQYWNrZXQoYmxvYmxlc3NEYXRhKTtcbiAgICB2YXIgcGFjayA9IGVuY29kZUFzU3RyaW5nKGRlY29uc3RydWN0aW9uLnBhY2tldCk7XG4gICAgdmFyIGJ1ZmZlcnMgPSBkZWNvbnN0cnVjdGlvbi5idWZmZXJzO1xuXG4gICAgYnVmZmVycy51bnNoaWZ0KHBhY2spOyAvLyBhZGQgcGFja2V0IGluZm8gdG8gYmVnaW5uaW5nIG9mIGRhdGEgbGlzdFxuICAgIGNhbGxiYWNrKGJ1ZmZlcnMpOyAvLyB3cml0ZSBhbGwgdGhlIGJ1ZmZlcnNcbiAgfVxuXG4gIGJpbmFyeS5yZW1vdmVCbG9icyhvYmosIHdyaXRlRW5jb2RpbmcpO1xufVxuXG4vKipcbiAqIEEgc29ja2V0LmlvIERlY29kZXIgaW5zdGFuY2VcbiAqXG4gKiBAcmV0dXJuIHtPYmplY3R9IGRlY29kZXJcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gRGVjb2RlcigpIHtcbiAgdGhpcy5yZWNvbnN0cnVjdG9yID0gbnVsbDtcbn1cblxuLyoqXG4gKiBNaXggaW4gYEVtaXR0ZXJgIHdpdGggRGVjb2Rlci5cbiAqL1xuXG5FbWl0dGVyKERlY29kZXIucHJvdG90eXBlKTtcblxuLyoqXG4gKiBEZWNvZGVzIGFuIGVuY29kZWQgcGFja2V0IHN0cmluZyBpbnRvIHBhY2tldCBKU09OLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBvYmogLSBlbmNvZGVkIHBhY2tldFxuICogQHJldHVybiB7T2JqZWN0fSBwYWNrZXRcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuRGVjb2Rlci5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24ob2JqKSB7XG4gIHZhciBwYWNrZXQ7XG4gIGlmICh0eXBlb2Ygb2JqID09PSAnc3RyaW5nJykge1xuICAgIHBhY2tldCA9IGRlY29kZVN0cmluZyhvYmopO1xuICAgIGlmIChleHBvcnRzLkJJTkFSWV9FVkVOVCA9PT0gcGFja2V0LnR5cGUgfHwgZXhwb3J0cy5CSU5BUllfQUNLID09PSBwYWNrZXQudHlwZSkgeyAvLyBiaW5hcnkgcGFja2V0J3MganNvblxuICAgICAgdGhpcy5yZWNvbnN0cnVjdG9yID0gbmV3IEJpbmFyeVJlY29uc3RydWN0b3IocGFja2V0KTtcblxuICAgICAgLy8gbm8gYXR0YWNobWVudHMsIGxhYmVsZWQgYmluYXJ5IGJ1dCBubyBiaW5hcnkgZGF0YSB0byBmb2xsb3dcbiAgICAgIGlmICh0aGlzLnJlY29uc3RydWN0b3IucmVjb25QYWNrLmF0dGFjaG1lbnRzID09PSAwKSB7XG4gICAgICAgIHRoaXMuZW1pdCgnZGVjb2RlZCcsIHBhY2tldCk7XG4gICAgICB9XG4gICAgfSBlbHNlIHsgLy8gbm9uLWJpbmFyeSBmdWxsIHBhY2tldFxuICAgICAgdGhpcy5lbWl0KCdkZWNvZGVkJywgcGFja2V0KTtcbiAgICB9XG4gIH0gZWxzZSBpZiAoaXNCdWYob2JqKSB8fCBvYmouYmFzZTY0KSB7IC8vIHJhdyBiaW5hcnkgZGF0YVxuICAgIGlmICghdGhpcy5yZWNvbnN0cnVjdG9yKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ2dvdCBiaW5hcnkgZGF0YSB3aGVuIG5vdCByZWNvbnN0cnVjdGluZyBhIHBhY2tldCcpO1xuICAgIH0gZWxzZSB7XG4gICAgICBwYWNrZXQgPSB0aGlzLnJlY29uc3RydWN0b3IudGFrZUJpbmFyeURhdGEob2JqKTtcbiAgICAgIGlmIChwYWNrZXQpIHsgLy8gcmVjZWl2ZWQgZmluYWwgYnVmZmVyXG4gICAgICAgIHRoaXMucmVjb25zdHJ1Y3RvciA9IG51bGw7XG4gICAgICAgIHRoaXMuZW1pdCgnZGVjb2RlZCcsIHBhY2tldCk7XG4gICAgICB9XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBFcnJvcignVW5rbm93biB0eXBlOiAnICsgb2JqKTtcbiAgfVxufTtcblxuLyoqXG4gKiBEZWNvZGUgYSBwYWNrZXQgU3RyaW5nIChKU09OIGRhdGEpXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHN0clxuICogQHJldHVybiB7T2JqZWN0fSBwYWNrZXRcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGRlY29kZVN0cmluZyhzdHIpIHtcbiAgdmFyIGkgPSAwO1xuICAvLyBsb29rIHVwIHR5cGVcbiAgdmFyIHAgPSB7XG4gICAgdHlwZTogTnVtYmVyKHN0ci5jaGFyQXQoMCkpXG4gIH07XG5cbiAgaWYgKG51bGwgPT0gZXhwb3J0cy50eXBlc1twLnR5cGVdKSB7XG4gICAgcmV0dXJuIGVycm9yKCd1bmtub3duIHBhY2tldCB0eXBlICcgKyBwLnR5cGUpO1xuICB9XG5cbiAgLy8gbG9vayB1cCBhdHRhY2htZW50cyBpZiB0eXBlIGJpbmFyeVxuICBpZiAoZXhwb3J0cy5CSU5BUllfRVZFTlQgPT09IHAudHlwZSB8fCBleHBvcnRzLkJJTkFSWV9BQ0sgPT09IHAudHlwZSkge1xuICAgIHZhciBidWYgPSAnJztcbiAgICB3aGlsZSAoc3RyLmNoYXJBdCgrK2kpICE9PSAnLScpIHtcbiAgICAgIGJ1ZiArPSBzdHIuY2hhckF0KGkpO1xuICAgICAgaWYgKGkgPT0gc3RyLmxlbmd0aCkgYnJlYWs7XG4gICAgfVxuICAgIGlmIChidWYgIT0gTnVtYmVyKGJ1ZikgfHwgc3RyLmNoYXJBdChpKSAhPT0gJy0nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0lsbGVnYWwgYXR0YWNobWVudHMnKTtcbiAgICB9XG4gICAgcC5hdHRhY2htZW50cyA9IE51bWJlcihidWYpO1xuICB9XG5cbiAgLy8gbG9vayB1cCBuYW1lc3BhY2UgKGlmIGFueSlcbiAgaWYgKCcvJyA9PT0gc3RyLmNoYXJBdChpICsgMSkpIHtcbiAgICBwLm5zcCA9ICcnO1xuICAgIHdoaWxlICgrK2kpIHtcbiAgICAgIHZhciBjID0gc3RyLmNoYXJBdChpKTtcbiAgICAgIGlmICgnLCcgPT09IGMpIGJyZWFrO1xuICAgICAgcC5uc3AgKz0gYztcbiAgICAgIGlmIChpID09PSBzdHIubGVuZ3RoKSBicmVhaztcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgcC5uc3AgPSAnLyc7XG4gIH1cblxuICAvLyBsb29rIHVwIGlkXG4gIHZhciBuZXh0ID0gc3RyLmNoYXJBdChpICsgMSk7XG4gIGlmICgnJyAhPT0gbmV4dCAmJiBOdW1iZXIobmV4dCkgPT0gbmV4dCkge1xuICAgIHAuaWQgPSAnJztcbiAgICB3aGlsZSAoKytpKSB7XG4gICAgICB2YXIgYyA9IHN0ci5jaGFyQXQoaSk7XG4gICAgICBpZiAobnVsbCA9PSBjIHx8IE51bWJlcihjKSAhPSBjKSB7XG4gICAgICAgIC0taTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBwLmlkICs9IHN0ci5jaGFyQXQoaSk7XG4gICAgICBpZiAoaSA9PT0gc3RyLmxlbmd0aCkgYnJlYWs7XG4gICAgfVxuICAgIHAuaWQgPSBOdW1iZXIocC5pZCk7XG4gIH1cblxuICAvLyBsb29rIHVwIGpzb24gZGF0YVxuICBpZiAoc3RyLmNoYXJBdCgrK2kpKSB7XG4gICAgdmFyIHBheWxvYWQgPSB0cnlQYXJzZShzdHIuc3Vic3RyKGkpKTtcbiAgICB2YXIgaXNQYXlsb2FkVmFsaWQgPSBwYXlsb2FkICE9PSBmYWxzZSAmJiAocC50eXBlID09PSBleHBvcnRzLkVSUk9SIHx8IGlzQXJyYXkocGF5bG9hZCkpO1xuICAgIGlmIChpc1BheWxvYWRWYWxpZCkge1xuICAgICAgcC5kYXRhID0gcGF5bG9hZDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGVycm9yKCdpbnZhbGlkIHBheWxvYWQnKTtcbiAgICB9XG4gIH1cblxuICBkZWJ1ZygnZGVjb2RlZCAlcyBhcyAlaicsIHN0ciwgcCk7XG4gIHJldHVybiBwO1xufVxuXG5mdW5jdGlvbiB0cnlQYXJzZShzdHIpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gSlNPTi5wYXJzZShzdHIpO1xuICB9IGNhdGNoKGUpe1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIERlYWxsb2NhdGVzIGEgcGFyc2VyJ3MgcmVzb3VyY2VzXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5EZWNvZGVyLnByb3RvdHlwZS5kZXN0cm95ID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLnJlY29uc3RydWN0b3IpIHtcbiAgICB0aGlzLnJlY29uc3RydWN0b3IuZmluaXNoZWRSZWNvbnN0cnVjdGlvbigpO1xuICB9XG59O1xuXG4vKipcbiAqIEEgbWFuYWdlciBvZiBhIGJpbmFyeSBldmVudCdzICdidWZmZXIgc2VxdWVuY2UnLiBTaG91bGRcbiAqIGJlIGNvbnN0cnVjdGVkIHdoZW5ldmVyIGEgcGFja2V0IG9mIHR5cGUgQklOQVJZX0VWRU5UIGlzXG4gKiBkZWNvZGVkLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBwYWNrZXRcbiAqIEByZXR1cm4ge0JpbmFyeVJlY29uc3RydWN0b3J9IGluaXRpYWxpemVkIHJlY29uc3RydWN0b3JcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIEJpbmFyeVJlY29uc3RydWN0b3IocGFja2V0KSB7XG4gIHRoaXMucmVjb25QYWNrID0gcGFja2V0O1xuICB0aGlzLmJ1ZmZlcnMgPSBbXTtcbn1cblxuLyoqXG4gKiBNZXRob2QgdG8gYmUgY2FsbGVkIHdoZW4gYmluYXJ5IGRhdGEgcmVjZWl2ZWQgZnJvbSBjb25uZWN0aW9uXG4gKiBhZnRlciBhIEJJTkFSWV9FVkVOVCBwYWNrZXQuXG4gKlxuICogQHBhcmFtIHtCdWZmZXIgfCBBcnJheUJ1ZmZlcn0gYmluRGF0YSAtIHRoZSByYXcgYmluYXJ5IGRhdGEgcmVjZWl2ZWRcbiAqIEByZXR1cm4ge251bGwgfCBPYmplY3R9IHJldHVybnMgbnVsbCBpZiBtb3JlIGJpbmFyeSBkYXRhIGlzIGV4cGVjdGVkIG9yXG4gKiAgIGEgcmVjb25zdHJ1Y3RlZCBwYWNrZXQgb2JqZWN0IGlmIGFsbCBidWZmZXJzIGhhdmUgYmVlbiByZWNlaXZlZC5cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbkJpbmFyeVJlY29uc3RydWN0b3IucHJvdG90eXBlLnRha2VCaW5hcnlEYXRhID0gZnVuY3Rpb24oYmluRGF0YSkge1xuICB0aGlzLmJ1ZmZlcnMucHVzaChiaW5EYXRhKTtcbiAgaWYgKHRoaXMuYnVmZmVycy5sZW5ndGggPT09IHRoaXMucmVjb25QYWNrLmF0dGFjaG1lbnRzKSB7IC8vIGRvbmUgd2l0aCBidWZmZXIgbGlzdFxuICAgIHZhciBwYWNrZXQgPSBiaW5hcnkucmVjb25zdHJ1Y3RQYWNrZXQodGhpcy5yZWNvblBhY2ssIHRoaXMuYnVmZmVycyk7XG4gICAgdGhpcy5maW5pc2hlZFJlY29uc3RydWN0aW9uKCk7XG4gICAgcmV0dXJuIHBhY2tldDtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn07XG5cbi8qKlxuICogQ2xlYW5zIHVwIGJpbmFyeSBwYWNrZXQgcmVjb25zdHJ1Y3Rpb24gdmFyaWFibGVzLlxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbkJpbmFyeVJlY29uc3RydWN0b3IucHJvdG90eXBlLmZpbmlzaGVkUmVjb25zdHJ1Y3Rpb24gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yZWNvblBhY2sgPSBudWxsO1xuICB0aGlzLmJ1ZmZlcnMgPSBbXTtcbn07XG5cbmZ1bmN0aW9uIGVycm9yKG1zZykge1xuICByZXR1cm4ge1xuICAgIHR5cGU6IGV4cG9ydHMuRVJST1IsXG4gICAgZGF0YTogJ3BhcnNlciBlcnJvcjogJyArIG1zZ1xuICB9O1xufVxuIiwiXG4vKipcbiAqIE1vZHVsZSBleHBvcnRzLlxuICpcbiAqIExvZ2ljIGJvcnJvd2VkIGZyb20gTW9kZXJuaXpyOlxuICpcbiAqICAgLSBodHRwczovL2dpdGh1Yi5jb20vTW9kZXJuaXpyL01vZGVybml6ci9ibG9iL21hc3Rlci9mZWF0dXJlLWRldGVjdHMvY29ycy5qc1xuICovXG5cbnRyeSB7XG4gIG1vZHVsZS5leHBvcnRzID0gdHlwZW9mIFhNTEh0dHBSZXF1ZXN0ICE9PSAndW5kZWZpbmVkJyAmJlxuICAgICd3aXRoQ3JlZGVudGlhbHMnIGluIG5ldyBYTUxIdHRwUmVxdWVzdCgpO1xufSBjYXRjaCAoZXJyKSB7XG4gIC8vIGlmIFhNTEh0dHAgc3VwcG9ydCBpcyBkaXNhYmxlZCBpbiBJRSB0aGVuIGl0IHdpbGwgdGhyb3dcbiAgLy8gd2hlbiB0cnlpbmcgdG8gY3JlYXRlXG4gIG1vZHVsZS5leHBvcnRzID0gZmFsc2U7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2Ygc2VsZiAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICByZXR1cm4gc2VsZjtcbiAgfSBlbHNlIGlmICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJykge1xuICAgIHJldHVybiB3aW5kb3c7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIEZ1bmN0aW9uKCdyZXR1cm4gdGhpcycpKCk7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tbmV3LWZ1bmNcbiAgfVxufSkoKTtcbiIsIi8vIGJyb3dzZXIgc2hpbSBmb3IgeG1saHR0cHJlcXVlc3QgbW9kdWxlXG5cbnZhciBoYXNDT1JTID0gcmVxdWlyZSgnaGFzLWNvcnMnKTtcbnZhciBnbG9iYWxUaGlzID0gcmVxdWlyZSgnLi9nbG9iYWxUaGlzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9wdHMpIHtcbiAgdmFyIHhkb21haW4gPSBvcHRzLnhkb21haW47XG5cbiAgLy8gc2NoZW1lIG11c3QgYmUgc2FtZSB3aGVuIHVzaWduIFhEb21haW5SZXF1ZXN0XG4gIC8vIGh0dHA6Ly9ibG9ncy5tc2RuLmNvbS9iL2llaW50ZXJuYWxzL2FyY2hpdmUvMjAxMC8wNS8xMy94ZG9tYWlucmVxdWVzdC1yZXN0cmljdGlvbnMtbGltaXRhdGlvbnMtYW5kLXdvcmthcm91bmRzLmFzcHhcbiAgdmFyIHhzY2hlbWUgPSBvcHRzLnhzY2hlbWU7XG5cbiAgLy8gWERvbWFpblJlcXVlc3QgaGFzIGEgZmxvdyBvZiBub3Qgc2VuZGluZyBjb29raWUsIHRoZXJlZm9yZSBpdCBzaG91bGQgYmUgZGlzYWJsZWQgYXMgYSBkZWZhdWx0LlxuICAvLyBodHRwczovL2dpdGh1Yi5jb20vQXV0b21hdHRpYy9lbmdpbmUuaW8tY2xpZW50L3B1bGwvMjE3XG4gIHZhciBlbmFibGVzWERSID0gb3B0cy5lbmFibGVzWERSO1xuXG4gIC8vIFhNTEh0dHBSZXF1ZXN0IGNhbiBiZSBkaXNhYmxlZCBvbiBJRVxuICB0cnkge1xuICAgIGlmICgndW5kZWZpbmVkJyAhPT0gdHlwZW9mIFhNTEh0dHBSZXF1ZXN0ICYmICgheGRvbWFpbiB8fCBoYXNDT1JTKSkge1xuICAgICAgcmV0dXJuIG5ldyBYTUxIdHRwUmVxdWVzdCgpO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkgeyB9XG5cbiAgLy8gVXNlIFhEb21haW5SZXF1ZXN0IGZvciBJRTggaWYgZW5hYmxlc1hEUiBpcyB0cnVlXG4gIC8vIGJlY2F1c2UgbG9hZGluZyBiYXIga2VlcHMgZmxhc2hpbmcgd2hlbiB1c2luZyBqc29ucC1wb2xsaW5nXG4gIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS95dWppb3Nha2Evc29ja2UuaW8taWU4LWxvYWRpbmctZXhhbXBsZVxuICB0cnkge1xuICAgIGlmICgndW5kZWZpbmVkJyAhPT0gdHlwZW9mIFhEb21haW5SZXF1ZXN0ICYmICF4c2NoZW1lICYmIGVuYWJsZXNYRFIpIHtcbiAgICAgIHJldHVybiBuZXcgWERvbWFpblJlcXVlc3QoKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHsgfVxuXG4gIGlmICgheGRvbWFpbikge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gbmV3IGdsb2JhbFRoaXNbWydBY3RpdmUnXS5jb25jYXQoJ09iamVjdCcpLmpvaW4oJ1gnKV0oJ01pY3Jvc29mdC5YTUxIVFRQJyk7XG4gICAgfSBjYXRjaCAoZSkgeyB9XG4gIH1cbn07XG4iLCJcbi8qKlxuICogR2V0cyB0aGUga2V5cyBmb3IgYW4gb2JqZWN0LlxuICpcbiAqIEByZXR1cm4ge0FycmF5fSBrZXlzXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IE9iamVjdC5rZXlzIHx8IGZ1bmN0aW9uIGtleXMgKG9iail7XG4gIHZhciBhcnIgPSBbXTtcbiAgdmFyIGhhcyA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHk7XG5cbiAgZm9yICh2YXIgaSBpbiBvYmopIHtcbiAgICBpZiAoaGFzLmNhbGwob2JqLCBpKSkge1xuICAgICAgYXJyLnB1c2goaSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBhcnI7XG59O1xuIiwiLyogZ2xvYmFsIEJsb2IgRmlsZSAqL1xuXG4vKlxuICogTW9kdWxlIHJlcXVpcmVtZW50cy5cbiAqL1xuXG52YXIgaXNBcnJheSA9IHJlcXVpcmUoJ2lzYXJyYXknKTtcblxudmFyIHRvU3RyaW5nID0gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZztcbnZhciB3aXRoTmF0aXZlQmxvYiA9IHR5cGVvZiBCbG9iID09PSAnZnVuY3Rpb24nIHx8XG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlb2YgQmxvYiAhPT0gJ3VuZGVmaW5lZCcgJiYgdG9TdHJpbmcuY2FsbChCbG9iKSA9PT0gJ1tvYmplY3QgQmxvYkNvbnN0cnVjdG9yXSc7XG52YXIgd2l0aE5hdGl2ZUZpbGUgPSB0eXBlb2YgRmlsZSA9PT0gJ2Z1bmN0aW9uJyB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZW9mIEZpbGUgIT09ICd1bmRlZmluZWQnICYmIHRvU3RyaW5nLmNhbGwoRmlsZSkgPT09ICdbb2JqZWN0IEZpbGVDb25zdHJ1Y3Rvcl0nO1xuXG4vKipcbiAqIE1vZHVsZSBleHBvcnRzLlxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gaGFzQmluYXJ5O1xuXG4vKipcbiAqIENoZWNrcyBmb3IgYmluYXJ5IGRhdGEuXG4gKlxuICogU3VwcG9ydHMgQnVmZmVyLCBBcnJheUJ1ZmZlciwgQmxvYiBhbmQgRmlsZS5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gYW55dGhpbmdcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gaGFzQmluYXJ5IChvYmopIHtcbiAgaWYgKCFvYmogfHwgdHlwZW9mIG9iaiAhPT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBpZiAoaXNBcnJheShvYmopKSB7XG4gICAgZm9yICh2YXIgaSA9IDAsIGwgPSBvYmoubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICBpZiAoaGFzQmluYXJ5KG9ialtpXSkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGlmICgodHlwZW9mIEJ1ZmZlciA9PT0gJ2Z1bmN0aW9uJyAmJiBCdWZmZXIuaXNCdWZmZXIgJiYgQnVmZmVyLmlzQnVmZmVyKG9iaikpIHx8XG4gICAgKHR5cGVvZiBBcnJheUJ1ZmZlciA9PT0gJ2Z1bmN0aW9uJyAmJiBvYmogaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikgfHxcbiAgICAod2l0aE5hdGl2ZUJsb2IgJiYgb2JqIGluc3RhbmNlb2YgQmxvYikgfHxcbiAgICAod2l0aE5hdGl2ZUZpbGUgJiYgb2JqIGluc3RhbmNlb2YgRmlsZSlcbiAgKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyBzZWU6IGh0dHBzOi8vZ2l0aHViLmNvbS9BdXRvbWF0dGljL2hhcy1iaW5hcnkvcHVsbC80XG4gIGlmIChvYmoudG9KU09OICYmIHR5cGVvZiBvYmoudG9KU09OID09PSAnZnVuY3Rpb24nICYmIGFyZ3VtZW50cy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gaGFzQmluYXJ5KG9iai50b0pTT04oKSwgdHJ1ZSk7XG4gIH1cblxuICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmosIGtleSkgJiYgaGFzQmluYXJ5KG9ialtrZXldKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGZhbHNlO1xufVxuIiwiLyoqXG4gKiBBbiBhYnN0cmFjdGlvbiBmb3Igc2xpY2luZyBhbiBhcnJheWJ1ZmZlciBldmVuIHdoZW5cbiAqIEFycmF5QnVmZmVyLnByb3RvdHlwZS5zbGljZSBpcyBub3Qgc3VwcG9ydGVkXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGFycmF5YnVmZmVyLCBzdGFydCwgZW5kKSB7XG4gIHZhciBieXRlcyA9IGFycmF5YnVmZmVyLmJ5dGVMZW5ndGg7XG4gIHN0YXJ0ID0gc3RhcnQgfHwgMDtcbiAgZW5kID0gZW5kIHx8IGJ5dGVzO1xuXG4gIGlmIChhcnJheWJ1ZmZlci5zbGljZSkgeyByZXR1cm4gYXJyYXlidWZmZXIuc2xpY2Uoc3RhcnQsIGVuZCk7IH1cblxuICBpZiAoc3RhcnQgPCAwKSB7IHN0YXJ0ICs9IGJ5dGVzOyB9XG4gIGlmIChlbmQgPCAwKSB7IGVuZCArPSBieXRlczsgfVxuICBpZiAoZW5kID4gYnl0ZXMpIHsgZW5kID0gYnl0ZXM7IH1cblxuICBpZiAoc3RhcnQgPj0gYnl0ZXMgfHwgc3RhcnQgPj0gZW5kIHx8IGJ5dGVzID09PSAwKSB7XG4gICAgcmV0dXJuIG5ldyBBcnJheUJ1ZmZlcigwKTtcbiAgfVxuXG4gIHZhciBhYnYgPSBuZXcgVWludDhBcnJheShhcnJheWJ1ZmZlcik7XG4gIHZhciByZXN1bHQgPSBuZXcgVWludDhBcnJheShlbmQgLSBzdGFydCk7XG4gIGZvciAodmFyIGkgPSBzdGFydCwgaWkgPSAwOyBpIDwgZW5kOyBpKyssIGlpKyspIHtcbiAgICByZXN1bHRbaWldID0gYWJ2W2ldO1xuICB9XG4gIHJldHVybiByZXN1bHQuYnVmZmVyO1xufTtcbiIsIm1vZHVsZS5leHBvcnRzID0gYWZ0ZXJcblxuZnVuY3Rpb24gYWZ0ZXIoY291bnQsIGNhbGxiYWNrLCBlcnJfY2IpIHtcbiAgICB2YXIgYmFpbCA9IGZhbHNlXG4gICAgZXJyX2NiID0gZXJyX2NiIHx8IG5vb3BcbiAgICBwcm94eS5jb3VudCA9IGNvdW50XG5cbiAgICByZXR1cm4gKGNvdW50ID09PSAwKSA/IGNhbGxiYWNrKCkgOiBwcm94eVxuXG4gICAgZnVuY3Rpb24gcHJveHkoZXJyLCByZXN1bHQpIHtcbiAgICAgICAgaWYgKHByb3h5LmNvdW50IDw9IDApIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignYWZ0ZXIgY2FsbGVkIHRvbyBtYW55IHRpbWVzJylcbiAgICAgICAgfVxuICAgICAgICAtLXByb3h5LmNvdW50XG5cbiAgICAgICAgLy8gYWZ0ZXIgZmlyc3QgZXJyb3IsIHJlc3QgYXJlIHBhc3NlZCB0byBlcnJfY2JcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgYmFpbCA9IHRydWVcbiAgICAgICAgICAgIGNhbGxiYWNrKGVycilcbiAgICAgICAgICAgIC8vIGZ1dHVyZSBlcnJvciBjYWxsYmFja3Mgd2lsbCBnbyB0byBlcnJvciBoYW5kbGVyXG4gICAgICAgICAgICBjYWxsYmFjayA9IGVycl9jYlxuICAgICAgICB9IGVsc2UgaWYgKHByb3h5LmNvdW50ID09PSAwICYmICFiYWlsKSB7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCByZXN1bHQpXG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIG5vb3AoKSB7fVxuIiwiLyohIGh0dHBzOi8vbXRocy5iZS91dGY4anMgdjIuMS4yIGJ5IEBtYXRoaWFzICovXG5cbnZhciBzdHJpbmdGcm9tQ2hhckNvZGUgPSBTdHJpbmcuZnJvbUNoYXJDb2RlO1xuXG4vLyBUYWtlbiBmcm9tIGh0dHBzOi8vbXRocy5iZS9wdW55Y29kZVxuZnVuY3Rpb24gdWNzMmRlY29kZShzdHJpbmcpIHtcblx0dmFyIG91dHB1dCA9IFtdO1xuXHR2YXIgY291bnRlciA9IDA7XG5cdHZhciBsZW5ndGggPSBzdHJpbmcubGVuZ3RoO1xuXHR2YXIgdmFsdWU7XG5cdHZhciBleHRyYTtcblx0d2hpbGUgKGNvdW50ZXIgPCBsZW5ndGgpIHtcblx0XHR2YWx1ZSA9IHN0cmluZy5jaGFyQ29kZUF0KGNvdW50ZXIrKyk7XG5cdFx0aWYgKHZhbHVlID49IDB4RDgwMCAmJiB2YWx1ZSA8PSAweERCRkYgJiYgY291bnRlciA8IGxlbmd0aCkge1xuXHRcdFx0Ly8gaGlnaCBzdXJyb2dhdGUsIGFuZCB0aGVyZSBpcyBhIG5leHQgY2hhcmFjdGVyXG5cdFx0XHRleHRyYSA9IHN0cmluZy5jaGFyQ29kZUF0KGNvdW50ZXIrKyk7XG5cdFx0XHRpZiAoKGV4dHJhICYgMHhGQzAwKSA9PSAweERDMDApIHsgLy8gbG93IHN1cnJvZ2F0ZVxuXHRcdFx0XHRvdXRwdXQucHVzaCgoKHZhbHVlICYgMHgzRkYpIDw8IDEwKSArIChleHRyYSAmIDB4M0ZGKSArIDB4MTAwMDApO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0Ly8gdW5tYXRjaGVkIHN1cnJvZ2F0ZTsgb25seSBhcHBlbmQgdGhpcyBjb2RlIHVuaXQsIGluIGNhc2UgdGhlIG5leHRcblx0XHRcdFx0Ly8gY29kZSB1bml0IGlzIHRoZSBoaWdoIHN1cnJvZ2F0ZSBvZiBhIHN1cnJvZ2F0ZSBwYWlyXG5cdFx0XHRcdG91dHB1dC5wdXNoKHZhbHVlKTtcblx0XHRcdFx0Y291bnRlci0tO1xuXHRcdFx0fVxuXHRcdH0gZWxzZSB7XG5cdFx0XHRvdXRwdXQucHVzaCh2YWx1ZSk7XG5cdFx0fVxuXHR9XG5cdHJldHVybiBvdXRwdXQ7XG59XG5cbi8vIFRha2VuIGZyb20gaHR0cHM6Ly9tdGhzLmJlL3B1bnljb2RlXG5mdW5jdGlvbiB1Y3MyZW5jb2RlKGFycmF5KSB7XG5cdHZhciBsZW5ndGggPSBhcnJheS5sZW5ndGg7XG5cdHZhciBpbmRleCA9IC0xO1xuXHR2YXIgdmFsdWU7XG5cdHZhciBvdXRwdXQgPSAnJztcblx0d2hpbGUgKCsraW5kZXggPCBsZW5ndGgpIHtcblx0XHR2YWx1ZSA9IGFycmF5W2luZGV4XTtcblx0XHRpZiAodmFsdWUgPiAweEZGRkYpIHtcblx0XHRcdHZhbHVlIC09IDB4MTAwMDA7XG5cdFx0XHRvdXRwdXQgKz0gc3RyaW5nRnJvbUNoYXJDb2RlKHZhbHVlID4+PiAxMCAmIDB4M0ZGIHwgMHhEODAwKTtcblx0XHRcdHZhbHVlID0gMHhEQzAwIHwgdmFsdWUgJiAweDNGRjtcblx0XHR9XG5cdFx0b3V0cHV0ICs9IHN0cmluZ0Zyb21DaGFyQ29kZSh2YWx1ZSk7XG5cdH1cblx0cmV0dXJuIG91dHB1dDtcbn1cblxuZnVuY3Rpb24gY2hlY2tTY2FsYXJWYWx1ZShjb2RlUG9pbnQsIHN0cmljdCkge1xuXHRpZiAoY29kZVBvaW50ID49IDB4RDgwMCAmJiBjb2RlUG9pbnQgPD0gMHhERkZGKSB7XG5cdFx0aWYgKHN0cmljdCkge1xuXHRcdFx0dGhyb3cgRXJyb3IoXG5cdFx0XHRcdCdMb25lIHN1cnJvZ2F0ZSBVKycgKyBjb2RlUG9pbnQudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCkgK1xuXHRcdFx0XHQnIGlzIG5vdCBhIHNjYWxhciB2YWx1ZSdcblx0XHRcdCk7XG5cdFx0fVxuXHRcdHJldHVybiBmYWxzZTtcblx0fVxuXHRyZXR1cm4gdHJ1ZTtcbn1cbi8qLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0qL1xuXG5mdW5jdGlvbiBjcmVhdGVCeXRlKGNvZGVQb2ludCwgc2hpZnQpIHtcblx0cmV0dXJuIHN0cmluZ0Zyb21DaGFyQ29kZSgoKGNvZGVQb2ludCA+PiBzaGlmdCkgJiAweDNGKSB8IDB4ODApO1xufVxuXG5mdW5jdGlvbiBlbmNvZGVDb2RlUG9pbnQoY29kZVBvaW50LCBzdHJpY3QpIHtcblx0aWYgKChjb2RlUG9pbnQgJiAweEZGRkZGRjgwKSA9PSAwKSB7IC8vIDEtYnl0ZSBzZXF1ZW5jZVxuXHRcdHJldHVybiBzdHJpbmdGcm9tQ2hhckNvZGUoY29kZVBvaW50KTtcblx0fVxuXHR2YXIgc3ltYm9sID0gJyc7XG5cdGlmICgoY29kZVBvaW50ICYgMHhGRkZGRjgwMCkgPT0gMCkgeyAvLyAyLWJ5dGUgc2VxdWVuY2Vcblx0XHRzeW1ib2wgPSBzdHJpbmdGcm9tQ2hhckNvZGUoKChjb2RlUG9pbnQgPj4gNikgJiAweDFGKSB8IDB4QzApO1xuXHR9XG5cdGVsc2UgaWYgKChjb2RlUG9pbnQgJiAweEZGRkYwMDAwKSA9PSAwKSB7IC8vIDMtYnl0ZSBzZXF1ZW5jZVxuXHRcdGlmICghY2hlY2tTY2FsYXJWYWx1ZShjb2RlUG9pbnQsIHN0cmljdCkpIHtcblx0XHRcdGNvZGVQb2ludCA9IDB4RkZGRDtcblx0XHR9XG5cdFx0c3ltYm9sID0gc3RyaW5nRnJvbUNoYXJDb2RlKCgoY29kZVBvaW50ID4+IDEyKSAmIDB4MEYpIHwgMHhFMCk7XG5cdFx0c3ltYm9sICs9IGNyZWF0ZUJ5dGUoY29kZVBvaW50LCA2KTtcblx0fVxuXHRlbHNlIGlmICgoY29kZVBvaW50ICYgMHhGRkUwMDAwMCkgPT0gMCkgeyAvLyA0LWJ5dGUgc2VxdWVuY2Vcblx0XHRzeW1ib2wgPSBzdHJpbmdGcm9tQ2hhckNvZGUoKChjb2RlUG9pbnQgPj4gMTgpICYgMHgwNykgfCAweEYwKTtcblx0XHRzeW1ib2wgKz0gY3JlYXRlQnl0ZShjb2RlUG9pbnQsIDEyKTtcblx0XHRzeW1ib2wgKz0gY3JlYXRlQnl0ZShjb2RlUG9pbnQsIDYpO1xuXHR9XG5cdHN5bWJvbCArPSBzdHJpbmdGcm9tQ2hhckNvZGUoKGNvZGVQb2ludCAmIDB4M0YpIHwgMHg4MCk7XG5cdHJldHVybiBzeW1ib2w7XG59XG5cbmZ1bmN0aW9uIHV0ZjhlbmNvZGUoc3RyaW5nLCBvcHRzKSB7XG5cdG9wdHMgPSBvcHRzIHx8IHt9O1xuXHR2YXIgc3RyaWN0ID0gZmFsc2UgIT09IG9wdHMuc3RyaWN0O1xuXG5cdHZhciBjb2RlUG9pbnRzID0gdWNzMmRlY29kZShzdHJpbmcpO1xuXHR2YXIgbGVuZ3RoID0gY29kZVBvaW50cy5sZW5ndGg7XG5cdHZhciBpbmRleCA9IC0xO1xuXHR2YXIgY29kZVBvaW50O1xuXHR2YXIgYnl0ZVN0cmluZyA9ICcnO1xuXHR3aGlsZSAoKytpbmRleCA8IGxlbmd0aCkge1xuXHRcdGNvZGVQb2ludCA9IGNvZGVQb2ludHNbaW5kZXhdO1xuXHRcdGJ5dGVTdHJpbmcgKz0gZW5jb2RlQ29kZVBvaW50KGNvZGVQb2ludCwgc3RyaWN0KTtcblx0fVxuXHRyZXR1cm4gYnl0ZVN0cmluZztcbn1cblxuLyotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSovXG5cbmZ1bmN0aW9uIHJlYWRDb250aW51YXRpb25CeXRlKCkge1xuXHRpZiAoYnl0ZUluZGV4ID49IGJ5dGVDb3VudCkge1xuXHRcdHRocm93IEVycm9yKCdJbnZhbGlkIGJ5dGUgaW5kZXgnKTtcblx0fVxuXG5cdHZhciBjb250aW51YXRpb25CeXRlID0gYnl0ZUFycmF5W2J5dGVJbmRleF0gJiAweEZGO1xuXHRieXRlSW5kZXgrKztcblxuXHRpZiAoKGNvbnRpbnVhdGlvbkJ5dGUgJiAweEMwKSA9PSAweDgwKSB7XG5cdFx0cmV0dXJuIGNvbnRpbnVhdGlvbkJ5dGUgJiAweDNGO1xuXHR9XG5cblx0Ly8gSWYgd2UgZW5kIHVwIGhlcmUsIGl04oCZcyBub3QgYSBjb250aW51YXRpb24gYnl0ZVxuXHR0aHJvdyBFcnJvcignSW52YWxpZCBjb250aW51YXRpb24gYnl0ZScpO1xufVxuXG5mdW5jdGlvbiBkZWNvZGVTeW1ib2woc3RyaWN0KSB7XG5cdHZhciBieXRlMTtcblx0dmFyIGJ5dGUyO1xuXHR2YXIgYnl0ZTM7XG5cdHZhciBieXRlNDtcblx0dmFyIGNvZGVQb2ludDtcblxuXHRpZiAoYnl0ZUluZGV4ID4gYnl0ZUNvdW50KSB7XG5cdFx0dGhyb3cgRXJyb3IoJ0ludmFsaWQgYnl0ZSBpbmRleCcpO1xuXHR9XG5cblx0aWYgKGJ5dGVJbmRleCA9PSBieXRlQ291bnQpIHtcblx0XHRyZXR1cm4gZmFsc2U7XG5cdH1cblxuXHQvLyBSZWFkIGZpcnN0IGJ5dGVcblx0Ynl0ZTEgPSBieXRlQXJyYXlbYnl0ZUluZGV4XSAmIDB4RkY7XG5cdGJ5dGVJbmRleCsrO1xuXG5cdC8vIDEtYnl0ZSBzZXF1ZW5jZSAobm8gY29udGludWF0aW9uIGJ5dGVzKVxuXHRpZiAoKGJ5dGUxICYgMHg4MCkgPT0gMCkge1xuXHRcdHJldHVybiBieXRlMTtcblx0fVxuXG5cdC8vIDItYnl0ZSBzZXF1ZW5jZVxuXHRpZiAoKGJ5dGUxICYgMHhFMCkgPT0gMHhDMCkge1xuXHRcdGJ5dGUyID0gcmVhZENvbnRpbnVhdGlvbkJ5dGUoKTtcblx0XHRjb2RlUG9pbnQgPSAoKGJ5dGUxICYgMHgxRikgPDwgNikgfCBieXRlMjtcblx0XHRpZiAoY29kZVBvaW50ID49IDB4ODApIHtcblx0XHRcdHJldHVybiBjb2RlUG9pbnQ7XG5cdFx0fSBlbHNlIHtcblx0XHRcdHRocm93IEVycm9yKCdJbnZhbGlkIGNvbnRpbnVhdGlvbiBieXRlJyk7XG5cdFx0fVxuXHR9XG5cblx0Ly8gMy1ieXRlIHNlcXVlbmNlIChtYXkgaW5jbHVkZSB1bnBhaXJlZCBzdXJyb2dhdGVzKVxuXHRpZiAoKGJ5dGUxICYgMHhGMCkgPT0gMHhFMCkge1xuXHRcdGJ5dGUyID0gcmVhZENvbnRpbnVhdGlvbkJ5dGUoKTtcblx0XHRieXRlMyA9IHJlYWRDb250aW51YXRpb25CeXRlKCk7XG5cdFx0Y29kZVBvaW50ID0gKChieXRlMSAmIDB4MEYpIDw8IDEyKSB8IChieXRlMiA8PCA2KSB8IGJ5dGUzO1xuXHRcdGlmIChjb2RlUG9pbnQgPj0gMHgwODAwKSB7XG5cdFx0XHRyZXR1cm4gY2hlY2tTY2FsYXJWYWx1ZShjb2RlUG9pbnQsIHN0cmljdCkgPyBjb2RlUG9pbnQgOiAweEZGRkQ7XG5cdFx0fSBlbHNlIHtcblx0XHRcdHRocm93IEVycm9yKCdJbnZhbGlkIGNvbnRpbnVhdGlvbiBieXRlJyk7XG5cdFx0fVxuXHR9XG5cblx0Ly8gNC1ieXRlIHNlcXVlbmNlXG5cdGlmICgoYnl0ZTEgJiAweEY4KSA9PSAweEYwKSB7XG5cdFx0Ynl0ZTIgPSByZWFkQ29udGludWF0aW9uQnl0ZSgpO1xuXHRcdGJ5dGUzID0gcmVhZENvbnRpbnVhdGlvbkJ5dGUoKTtcblx0XHRieXRlNCA9IHJlYWRDb250aW51YXRpb25CeXRlKCk7XG5cdFx0Y29kZVBvaW50ID0gKChieXRlMSAmIDB4MDcpIDw8IDB4MTIpIHwgKGJ5dGUyIDw8IDB4MEMpIHxcblx0XHRcdChieXRlMyA8PCAweDA2KSB8IGJ5dGU0O1xuXHRcdGlmIChjb2RlUG9pbnQgPj0gMHgwMTAwMDAgJiYgY29kZVBvaW50IDw9IDB4MTBGRkZGKSB7XG5cdFx0XHRyZXR1cm4gY29kZVBvaW50O1xuXHRcdH1cblx0fVxuXG5cdHRocm93IEVycm9yKCdJbnZhbGlkIFVURi04IGRldGVjdGVkJyk7XG59XG5cbnZhciBieXRlQXJyYXk7XG52YXIgYnl0ZUNvdW50O1xudmFyIGJ5dGVJbmRleDtcbmZ1bmN0aW9uIHV0ZjhkZWNvZGUoYnl0ZVN0cmluZywgb3B0cykge1xuXHRvcHRzID0gb3B0cyB8fCB7fTtcblx0dmFyIHN0cmljdCA9IGZhbHNlICE9PSBvcHRzLnN0cmljdDtcblxuXHRieXRlQXJyYXkgPSB1Y3MyZGVjb2RlKGJ5dGVTdHJpbmcpO1xuXHRieXRlQ291bnQgPSBieXRlQXJyYXkubGVuZ3RoO1xuXHRieXRlSW5kZXggPSAwO1xuXHR2YXIgY29kZVBvaW50cyA9IFtdO1xuXHR2YXIgdG1wO1xuXHR3aGlsZSAoKHRtcCA9IGRlY29kZVN5bWJvbChzdHJpY3QpKSAhPT0gZmFsc2UpIHtcblx0XHRjb2RlUG9pbnRzLnB1c2godG1wKTtcblx0fVxuXHRyZXR1cm4gdWNzMmVuY29kZShjb2RlUG9pbnRzKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG5cdHZlcnNpb246ICcyLjEuMicsXG5cdGVuY29kZTogdXRmOGVuY29kZSxcblx0ZGVjb2RlOiB1dGY4ZGVjb2RlXG59O1xuIiwiLypcbiAqIGJhc2U2NC1hcnJheWJ1ZmZlclxuICogaHR0cHM6Ly9naXRodWIuY29tL25pa2xhc3ZoL2Jhc2U2NC1hcnJheWJ1ZmZlclxuICpcbiAqIENvcHlyaWdodCAoYykgMjAxMiBOaWtsYXMgdm9uIEhlcnR6ZW5cbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBNSVQgbGljZW5zZS5cbiAqL1xuKGZ1bmN0aW9uKCl7XG4gIFwidXNlIHN0cmljdFwiO1xuXG4gIHZhciBjaGFycyA9IFwiQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrL1wiO1xuXG4gIC8vIFVzZSBhIGxvb2t1cCB0YWJsZSB0byBmaW5kIHRoZSBpbmRleC5cbiAgdmFyIGxvb2t1cCA9IG5ldyBVaW50OEFycmF5KDI1Nik7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgY2hhcnMubGVuZ3RoOyBpKyspIHtcbiAgICBsb29rdXBbY2hhcnMuY2hhckNvZGVBdChpKV0gPSBpO1xuICB9XG5cbiAgZXhwb3J0cy5lbmNvZGUgPSBmdW5jdGlvbihhcnJheWJ1ZmZlcikge1xuICAgIHZhciBieXRlcyA9IG5ldyBVaW50OEFycmF5KGFycmF5YnVmZmVyKSxcbiAgICBpLCBsZW4gPSBieXRlcy5sZW5ndGgsIGJhc2U2NCA9IFwiXCI7XG5cbiAgICBmb3IgKGkgPSAwOyBpIDwgbGVuOyBpKz0zKSB7XG4gICAgICBiYXNlNjQgKz0gY2hhcnNbYnl0ZXNbaV0gPj4gMl07XG4gICAgICBiYXNlNjQgKz0gY2hhcnNbKChieXRlc1tpXSAmIDMpIDw8IDQpIHwgKGJ5dGVzW2kgKyAxXSA+PiA0KV07XG4gICAgICBiYXNlNjQgKz0gY2hhcnNbKChieXRlc1tpICsgMV0gJiAxNSkgPDwgMikgfCAoYnl0ZXNbaSArIDJdID4+IDYpXTtcbiAgICAgIGJhc2U2NCArPSBjaGFyc1tieXRlc1tpICsgMl0gJiA2M107XG4gICAgfVxuXG4gICAgaWYgKChsZW4gJSAzKSA9PT0gMikge1xuICAgICAgYmFzZTY0ID0gYmFzZTY0LnN1YnN0cmluZygwLCBiYXNlNjQubGVuZ3RoIC0gMSkgKyBcIj1cIjtcbiAgICB9IGVsc2UgaWYgKGxlbiAlIDMgPT09IDEpIHtcbiAgICAgIGJhc2U2NCA9IGJhc2U2NC5zdWJzdHJpbmcoMCwgYmFzZTY0Lmxlbmd0aCAtIDIpICsgXCI9PVwiO1xuICAgIH1cblxuICAgIHJldHVybiBiYXNlNjQ7XG4gIH07XG5cbiAgZXhwb3J0cy5kZWNvZGUgPSAgZnVuY3Rpb24oYmFzZTY0KSB7XG4gICAgdmFyIGJ1ZmZlckxlbmd0aCA9IGJhc2U2NC5sZW5ndGggKiAwLjc1LFxuICAgIGxlbiA9IGJhc2U2NC5sZW5ndGgsIGksIHAgPSAwLFxuICAgIGVuY29kZWQxLCBlbmNvZGVkMiwgZW5jb2RlZDMsIGVuY29kZWQ0O1xuXG4gICAgaWYgKGJhc2U2NFtiYXNlNjQubGVuZ3RoIC0gMV0gPT09IFwiPVwiKSB7XG4gICAgICBidWZmZXJMZW5ndGgtLTtcbiAgICAgIGlmIChiYXNlNjRbYmFzZTY0Lmxlbmd0aCAtIDJdID09PSBcIj1cIikge1xuICAgICAgICBidWZmZXJMZW5ndGgtLTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgYXJyYXlidWZmZXIgPSBuZXcgQXJyYXlCdWZmZXIoYnVmZmVyTGVuZ3RoKSxcbiAgICBieXRlcyA9IG5ldyBVaW50OEFycmF5KGFycmF5YnVmZmVyKTtcblxuICAgIGZvciAoaSA9IDA7IGkgPCBsZW47IGkrPTQpIHtcbiAgICAgIGVuY29kZWQxID0gbG9va3VwW2Jhc2U2NC5jaGFyQ29kZUF0KGkpXTtcbiAgICAgIGVuY29kZWQyID0gbG9va3VwW2Jhc2U2NC5jaGFyQ29kZUF0KGkrMSldO1xuICAgICAgZW5jb2RlZDMgPSBsb29rdXBbYmFzZTY0LmNoYXJDb2RlQXQoaSsyKV07XG4gICAgICBlbmNvZGVkNCA9IGxvb2t1cFtiYXNlNjQuY2hhckNvZGVBdChpKzMpXTtcblxuICAgICAgYnl0ZXNbcCsrXSA9IChlbmNvZGVkMSA8PCAyKSB8IChlbmNvZGVkMiA+PiA0KTtcbiAgICAgIGJ5dGVzW3ArK10gPSAoKGVuY29kZWQyICYgMTUpIDw8IDQpIHwgKGVuY29kZWQzID4+IDIpO1xuICAgICAgYnl0ZXNbcCsrXSA9ICgoZW5jb2RlZDMgJiAzKSA8PCA2KSB8IChlbmNvZGVkNCAmIDYzKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXJyYXlidWZmZXI7XG4gIH07XG59KSgpO1xuIiwiLyoqXHJcbiAqIENyZWF0ZSBhIGJsb2IgYnVpbGRlciBldmVuIHdoZW4gdmVuZG9yIHByZWZpeGVzIGV4aXN0XHJcbiAqL1xyXG5cclxudmFyIEJsb2JCdWlsZGVyID0gdHlwZW9mIEJsb2JCdWlsZGVyICE9PSAndW5kZWZpbmVkJyA/IEJsb2JCdWlsZGVyIDpcclxuICB0eXBlb2YgV2ViS2l0QmxvYkJ1aWxkZXIgIT09ICd1bmRlZmluZWQnID8gV2ViS2l0QmxvYkJ1aWxkZXIgOlxyXG4gIHR5cGVvZiBNU0Jsb2JCdWlsZGVyICE9PSAndW5kZWZpbmVkJyA/IE1TQmxvYkJ1aWxkZXIgOlxyXG4gIHR5cGVvZiBNb3pCbG9iQnVpbGRlciAhPT0gJ3VuZGVmaW5lZCcgPyBNb3pCbG9iQnVpbGRlciA6IFxyXG4gIGZhbHNlO1xyXG5cclxuLyoqXHJcbiAqIENoZWNrIGlmIEJsb2IgY29uc3RydWN0b3IgaXMgc3VwcG9ydGVkXHJcbiAqL1xyXG5cclxudmFyIGJsb2JTdXBwb3J0ZWQgPSAoZnVuY3Rpb24oKSB7XHJcbiAgdHJ5IHtcclxuICAgIHZhciBhID0gbmV3IEJsb2IoWydoaSddKTtcclxuICAgIHJldHVybiBhLnNpemUgPT09IDI7XHJcbiAgfSBjYXRjaChlKSB7XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG59KSgpO1xyXG5cclxuLyoqXHJcbiAqIENoZWNrIGlmIEJsb2IgY29uc3RydWN0b3Igc3VwcG9ydHMgQXJyYXlCdWZmZXJWaWV3c1xyXG4gKiBGYWlscyBpbiBTYWZhcmkgNiwgc28gd2UgbmVlZCB0byBtYXAgdG8gQXJyYXlCdWZmZXJzIHRoZXJlLlxyXG4gKi9cclxuXHJcbnZhciBibG9iU3VwcG9ydHNBcnJheUJ1ZmZlclZpZXcgPSBibG9iU3VwcG9ydGVkICYmIChmdW5jdGlvbigpIHtcclxuICB0cnkge1xyXG4gICAgdmFyIGIgPSBuZXcgQmxvYihbbmV3IFVpbnQ4QXJyYXkoWzEsMl0pXSk7XHJcbiAgICByZXR1cm4gYi5zaXplID09PSAyO1xyXG4gIH0gY2F0Y2goZSkge1xyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxufSkoKTtcclxuXHJcbi8qKlxyXG4gKiBDaGVjayBpZiBCbG9iQnVpbGRlciBpcyBzdXBwb3J0ZWRcclxuICovXHJcblxyXG52YXIgYmxvYkJ1aWxkZXJTdXBwb3J0ZWQgPSBCbG9iQnVpbGRlclxyXG4gICYmIEJsb2JCdWlsZGVyLnByb3RvdHlwZS5hcHBlbmRcclxuICAmJiBCbG9iQnVpbGRlci5wcm90b3R5cGUuZ2V0QmxvYjtcclxuXHJcbi8qKlxyXG4gKiBIZWxwZXIgZnVuY3Rpb24gdGhhdCBtYXBzIEFycmF5QnVmZmVyVmlld3MgdG8gQXJyYXlCdWZmZXJzXHJcbiAqIFVzZWQgYnkgQmxvYkJ1aWxkZXIgY29uc3RydWN0b3IgYW5kIG9sZCBicm93c2VycyB0aGF0IGRpZG4ndFxyXG4gKiBzdXBwb3J0IGl0IGluIHRoZSBCbG9iIGNvbnN0cnVjdG9yLlxyXG4gKi9cclxuXHJcbmZ1bmN0aW9uIG1hcEFycmF5QnVmZmVyVmlld3MoYXJ5KSB7XHJcbiAgcmV0dXJuIGFyeS5tYXAoZnVuY3Rpb24oY2h1bmspIHtcclxuICAgIGlmIChjaHVuay5idWZmZXIgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikge1xyXG4gICAgICB2YXIgYnVmID0gY2h1bmsuYnVmZmVyO1xyXG5cclxuICAgICAgLy8gaWYgdGhpcyBpcyBhIHN1YmFycmF5LCBtYWtlIGEgY29weSBzbyB3ZSBvbmx5XHJcbiAgICAgIC8vIGluY2x1ZGUgdGhlIHN1YmFycmF5IHJlZ2lvbiBmcm9tIHRoZSB1bmRlcmx5aW5nIGJ1ZmZlclxyXG4gICAgICBpZiAoY2h1bmsuYnl0ZUxlbmd0aCAhPT0gYnVmLmJ5dGVMZW5ndGgpIHtcclxuICAgICAgICB2YXIgY29weSA9IG5ldyBVaW50OEFycmF5KGNodW5rLmJ5dGVMZW5ndGgpO1xyXG4gICAgICAgIGNvcHkuc2V0KG5ldyBVaW50OEFycmF5KGJ1ZiwgY2h1bmsuYnl0ZU9mZnNldCwgY2h1bmsuYnl0ZUxlbmd0aCkpO1xyXG4gICAgICAgIGJ1ZiA9IGNvcHkuYnVmZmVyO1xyXG4gICAgICB9XHJcblxyXG4gICAgICByZXR1cm4gYnVmO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBjaHVuaztcclxuICB9KTtcclxufVxyXG5cclxuZnVuY3Rpb24gQmxvYkJ1aWxkZXJDb25zdHJ1Y3RvcihhcnksIG9wdGlvbnMpIHtcclxuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuXHJcbiAgdmFyIGJiID0gbmV3IEJsb2JCdWlsZGVyKCk7XHJcbiAgbWFwQXJyYXlCdWZmZXJWaWV3cyhhcnkpLmZvckVhY2goZnVuY3Rpb24ocGFydCkge1xyXG4gICAgYmIuYXBwZW5kKHBhcnQpO1xyXG4gIH0pO1xyXG5cclxuICByZXR1cm4gKG9wdGlvbnMudHlwZSkgPyBiYi5nZXRCbG9iKG9wdGlvbnMudHlwZSkgOiBiYi5nZXRCbG9iKCk7XHJcbn07XHJcblxyXG5mdW5jdGlvbiBCbG9iQ29uc3RydWN0b3IoYXJ5LCBvcHRpb25zKSB7XHJcbiAgcmV0dXJuIG5ldyBCbG9iKG1hcEFycmF5QnVmZmVyVmlld3MoYXJ5KSwgb3B0aW9ucyB8fCB7fSk7XHJcbn07XHJcblxyXG5pZiAodHlwZW9mIEJsb2IgIT09ICd1bmRlZmluZWQnKSB7XHJcbiAgQmxvYkJ1aWxkZXJDb25zdHJ1Y3Rvci5wcm90b3R5cGUgPSBCbG9iLnByb3RvdHlwZTtcclxuICBCbG9iQ29uc3RydWN0b3IucHJvdG90eXBlID0gQmxvYi5wcm90b3R5cGU7XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uKCkge1xyXG4gIGlmIChibG9iU3VwcG9ydGVkKSB7XHJcbiAgICByZXR1cm4gYmxvYlN1cHBvcnRzQXJyYXlCdWZmZXJWaWV3ID8gQmxvYiA6IEJsb2JDb25zdHJ1Y3RvcjtcclxuICB9IGVsc2UgaWYgKGJsb2JCdWlsZGVyU3VwcG9ydGVkKSB7XHJcbiAgICByZXR1cm4gQmxvYkJ1aWxkZXJDb25zdHJ1Y3RvcjtcclxuICB9IGVsc2Uge1xyXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICB9XHJcbn0pKCk7XHJcbiIsIi8qKlxuICogTW9kdWxlIGRlcGVuZGVuY2llcy5cbiAqL1xuXG52YXIga2V5cyA9IHJlcXVpcmUoJy4va2V5cycpO1xudmFyIGhhc0JpbmFyeSA9IHJlcXVpcmUoJ2hhcy1iaW5hcnkyJyk7XG52YXIgc2xpY2VCdWZmZXIgPSByZXF1aXJlKCdhcnJheWJ1ZmZlci5zbGljZScpO1xudmFyIGFmdGVyID0gcmVxdWlyZSgnYWZ0ZXInKTtcbnZhciB1dGY4ID0gcmVxdWlyZSgnLi91dGY4Jyk7XG5cbnZhciBiYXNlNjRlbmNvZGVyO1xuaWYgKHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgYmFzZTY0ZW5jb2RlciA9IHJlcXVpcmUoJ2Jhc2U2NC1hcnJheWJ1ZmZlcicpO1xufVxuXG4vKipcbiAqIENoZWNrIGlmIHdlIGFyZSBydW5uaW5nIGFuIGFuZHJvaWQgYnJvd3Nlci4gVGhhdCByZXF1aXJlcyB1cyB0byB1c2VcbiAqIEFycmF5QnVmZmVyIHdpdGggcG9sbGluZyB0cmFuc3BvcnRzLi4uXG4gKlxuICogaHR0cDovL2doaW5kYS5uZXQvanBlZy1ibG9iLWFqYXgtYW5kcm9pZC9cbiAqL1xuXG52YXIgaXNBbmRyb2lkID0gdHlwZW9mIG5hdmlnYXRvciAhPT0gJ3VuZGVmaW5lZCcgJiYgL0FuZHJvaWQvaS50ZXN0KG5hdmlnYXRvci51c2VyQWdlbnQpO1xuXG4vKipcbiAqIENoZWNrIGlmIHdlIGFyZSBydW5uaW5nIGluIFBoYW50b21KUy5cbiAqIFVwbG9hZGluZyBhIEJsb2Igd2l0aCBQaGFudG9tSlMgZG9lcyBub3Qgd29yayBjb3JyZWN0bHksIGFzIHJlcG9ydGVkIGhlcmU6XG4gKiBodHRwczovL2dpdGh1Yi5jb20vYXJpeWEvcGhhbnRvbWpzL2lzc3Vlcy8xMTM5NVxuICogQHR5cGUgYm9vbGVhblxuICovXG52YXIgaXNQaGFudG9tSlMgPSB0eXBlb2YgbmF2aWdhdG9yICE9PSAndW5kZWZpbmVkJyAmJiAvUGhhbnRvbUpTL2kudGVzdChuYXZpZ2F0b3IudXNlckFnZW50KTtcblxuLyoqXG4gKiBXaGVuIHRydWUsIGF2b2lkcyB1c2luZyBCbG9icyB0byBlbmNvZGUgcGF5bG9hZHMuXG4gKiBAdHlwZSBib29sZWFuXG4gKi9cbnZhciBkb250U2VuZEJsb2JzID0gaXNBbmRyb2lkIHx8IGlzUGhhbnRvbUpTO1xuXG4vKipcbiAqIEN1cnJlbnQgcHJvdG9jb2wgdmVyc2lvbi5cbiAqL1xuXG5leHBvcnRzLnByb3RvY29sID0gMztcblxuLyoqXG4gKiBQYWNrZXQgdHlwZXMuXG4gKi9cblxudmFyIHBhY2tldHMgPSBleHBvcnRzLnBhY2tldHMgPSB7XG4gICAgb3BlbjogICAgIDAgICAgLy8gbm9uLXdzXG4gICwgY2xvc2U6ICAgIDEgICAgLy8gbm9uLXdzXG4gICwgcGluZzogICAgIDJcbiAgLCBwb25nOiAgICAgM1xuICAsIG1lc3NhZ2U6ICA0XG4gICwgdXBncmFkZTogIDVcbiAgLCBub29wOiAgICAgNlxufTtcblxudmFyIHBhY2tldHNsaXN0ID0ga2V5cyhwYWNrZXRzKTtcblxuLyoqXG4gKiBQcmVtYWRlIGVycm9yIHBhY2tldC5cbiAqL1xuXG52YXIgZXJyID0geyB0eXBlOiAnZXJyb3InLCBkYXRhOiAncGFyc2VyIGVycm9yJyB9O1xuXG4vKipcbiAqIENyZWF0ZSBhIGJsb2IgYXBpIGV2ZW4gZm9yIGJsb2IgYnVpbGRlciB3aGVuIHZlbmRvciBwcmVmaXhlcyBleGlzdFxuICovXG5cbnZhciBCbG9iID0gcmVxdWlyZSgnYmxvYicpO1xuXG4vKipcbiAqIEVuY29kZXMgYSBwYWNrZXQuXG4gKlxuICogICAgIDxwYWNrZXQgdHlwZSBpZD4gWyA8ZGF0YT4gXVxuICpcbiAqIEV4YW1wbGU6XG4gKlxuICogICAgIDVoZWxsbyB3b3JsZFxuICogICAgIDNcbiAqICAgICA0XG4gKlxuICogQmluYXJ5IGlzIGVuY29kZWQgaW4gYW4gaWRlbnRpY2FsIHByaW5jaXBsZVxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmV4cG9ydHMuZW5jb2RlUGFja2V0ID0gZnVuY3Rpb24gKHBhY2tldCwgc3VwcG9ydHNCaW5hcnksIHV0ZjhlbmNvZGUsIGNhbGxiYWNrKSB7XG4gIGlmICh0eXBlb2Ygc3VwcG9ydHNCaW5hcnkgPT09ICdmdW5jdGlvbicpIHtcbiAgICBjYWxsYmFjayA9IHN1cHBvcnRzQmluYXJ5O1xuICAgIHN1cHBvcnRzQmluYXJ5ID0gZmFsc2U7XG4gIH1cblxuICBpZiAodHlwZW9mIHV0ZjhlbmNvZGUgPT09ICdmdW5jdGlvbicpIHtcbiAgICBjYWxsYmFjayA9IHV0ZjhlbmNvZGU7XG4gICAgdXRmOGVuY29kZSA9IG51bGw7XG4gIH1cblxuICB2YXIgZGF0YSA9IChwYWNrZXQuZGF0YSA9PT0gdW5kZWZpbmVkKVxuICAgID8gdW5kZWZpbmVkXG4gICAgOiBwYWNrZXQuZGF0YS5idWZmZXIgfHwgcGFja2V0LmRhdGE7XG5cbiAgaWYgKHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gJ3VuZGVmaW5lZCcgJiYgZGF0YSBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSB7XG4gICAgcmV0dXJuIGVuY29kZUFycmF5QnVmZmVyKHBhY2tldCwgc3VwcG9ydHNCaW5hcnksIGNhbGxiYWNrKTtcbiAgfSBlbHNlIGlmICh0eXBlb2YgQmxvYiAhPT0gJ3VuZGVmaW5lZCcgJiYgZGF0YSBpbnN0YW5jZW9mIEJsb2IpIHtcbiAgICByZXR1cm4gZW5jb2RlQmxvYihwYWNrZXQsIHN1cHBvcnRzQmluYXJ5LCBjYWxsYmFjayk7XG4gIH1cblxuICAvLyBtaWdodCBiZSBhbiBvYmplY3Qgd2l0aCB7IGJhc2U2NDogdHJ1ZSwgZGF0YTogZGF0YUFzQmFzZTY0U3RyaW5nIH1cbiAgaWYgKGRhdGEgJiYgZGF0YS5iYXNlNjQpIHtcbiAgICByZXR1cm4gZW5jb2RlQmFzZTY0T2JqZWN0KHBhY2tldCwgY2FsbGJhY2spO1xuICB9XG5cbiAgLy8gU2VuZGluZyBkYXRhIGFzIGEgdXRmLTggc3RyaW5nXG4gIHZhciBlbmNvZGVkID0gcGFja2V0c1twYWNrZXQudHlwZV07XG5cbiAgLy8gZGF0YSBmcmFnbWVudCBpcyBvcHRpb25hbFxuICBpZiAodW5kZWZpbmVkICE9PSBwYWNrZXQuZGF0YSkge1xuICAgIGVuY29kZWQgKz0gdXRmOGVuY29kZSA/IHV0ZjguZW5jb2RlKFN0cmluZyhwYWNrZXQuZGF0YSksIHsgc3RyaWN0OiBmYWxzZSB9KSA6IFN0cmluZyhwYWNrZXQuZGF0YSk7XG4gIH1cblxuICByZXR1cm4gY2FsbGJhY2soJycgKyBlbmNvZGVkKTtcblxufTtcblxuZnVuY3Rpb24gZW5jb2RlQmFzZTY0T2JqZWN0KHBhY2tldCwgY2FsbGJhY2spIHtcbiAgLy8gcGFja2V0IGRhdGEgaXMgYW4gb2JqZWN0IHsgYmFzZTY0OiB0cnVlLCBkYXRhOiBkYXRhQXNCYXNlNjRTdHJpbmcgfVxuICB2YXIgbWVzc2FnZSA9ICdiJyArIGV4cG9ydHMucGFja2V0c1twYWNrZXQudHlwZV0gKyBwYWNrZXQuZGF0YS5kYXRhO1xuICByZXR1cm4gY2FsbGJhY2sobWVzc2FnZSk7XG59XG5cbi8qKlxuICogRW5jb2RlIHBhY2tldCBoZWxwZXJzIGZvciBiaW5hcnkgdHlwZXNcbiAqL1xuXG5mdW5jdGlvbiBlbmNvZGVBcnJheUJ1ZmZlcihwYWNrZXQsIHN1cHBvcnRzQmluYXJ5LCBjYWxsYmFjaykge1xuICBpZiAoIXN1cHBvcnRzQmluYXJ5KSB7XG4gICAgcmV0dXJuIGV4cG9ydHMuZW5jb2RlQmFzZTY0UGFja2V0KHBhY2tldCwgY2FsbGJhY2spO1xuICB9XG5cbiAgdmFyIGRhdGEgPSBwYWNrZXQuZGF0YTtcbiAgdmFyIGNvbnRlbnRBcnJheSA9IG5ldyBVaW50OEFycmF5KGRhdGEpO1xuICB2YXIgcmVzdWx0QnVmZmVyID0gbmV3IFVpbnQ4QXJyYXkoMSArIGRhdGEuYnl0ZUxlbmd0aCk7XG5cbiAgcmVzdWx0QnVmZmVyWzBdID0gcGFja2V0c1twYWNrZXQudHlwZV07XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgY29udGVudEFycmF5Lmxlbmd0aDsgaSsrKSB7XG4gICAgcmVzdWx0QnVmZmVyW2krMV0gPSBjb250ZW50QXJyYXlbaV07XG4gIH1cblxuICByZXR1cm4gY2FsbGJhY2socmVzdWx0QnVmZmVyLmJ1ZmZlcik7XG59XG5cbmZ1bmN0aW9uIGVuY29kZUJsb2JBc0FycmF5QnVmZmVyKHBhY2tldCwgc3VwcG9ydHNCaW5hcnksIGNhbGxiYWNrKSB7XG4gIGlmICghc3VwcG9ydHNCaW5hcnkpIHtcbiAgICByZXR1cm4gZXhwb3J0cy5lbmNvZGVCYXNlNjRQYWNrZXQocGFja2V0LCBjYWxsYmFjayk7XG4gIH1cblxuICB2YXIgZnIgPSBuZXcgRmlsZVJlYWRlcigpO1xuICBmci5vbmxvYWQgPSBmdW5jdGlvbigpIHtcbiAgICBleHBvcnRzLmVuY29kZVBhY2tldCh7IHR5cGU6IHBhY2tldC50eXBlLCBkYXRhOiBmci5yZXN1bHQgfSwgc3VwcG9ydHNCaW5hcnksIHRydWUsIGNhbGxiYWNrKTtcbiAgfTtcbiAgcmV0dXJuIGZyLnJlYWRBc0FycmF5QnVmZmVyKHBhY2tldC5kYXRhKTtcbn1cblxuZnVuY3Rpb24gZW5jb2RlQmxvYihwYWNrZXQsIHN1cHBvcnRzQmluYXJ5LCBjYWxsYmFjaykge1xuICBpZiAoIXN1cHBvcnRzQmluYXJ5KSB7XG4gICAgcmV0dXJuIGV4cG9ydHMuZW5jb2RlQmFzZTY0UGFja2V0KHBhY2tldCwgY2FsbGJhY2spO1xuICB9XG5cbiAgaWYgKGRvbnRTZW5kQmxvYnMpIHtcbiAgICByZXR1cm4gZW5jb2RlQmxvYkFzQXJyYXlCdWZmZXIocGFja2V0LCBzdXBwb3J0c0JpbmFyeSwgY2FsbGJhY2spO1xuICB9XG5cbiAgdmFyIGxlbmd0aCA9IG5ldyBVaW50OEFycmF5KDEpO1xuICBsZW5ndGhbMF0gPSBwYWNrZXRzW3BhY2tldC50eXBlXTtcbiAgdmFyIGJsb2IgPSBuZXcgQmxvYihbbGVuZ3RoLmJ1ZmZlciwgcGFja2V0LmRhdGFdKTtcblxuICByZXR1cm4gY2FsbGJhY2soYmxvYik7XG59XG5cbi8qKlxuICogRW5jb2RlcyBhIHBhY2tldCB3aXRoIGJpbmFyeSBkYXRhIGluIGEgYmFzZTY0IHN0cmluZ1xuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBwYWNrZXQsIGhhcyBgdHlwZWAgYW5kIGBkYXRhYFxuICogQHJldHVybiB7U3RyaW5nfSBiYXNlNjQgZW5jb2RlZCBtZXNzYWdlXG4gKi9cblxuZXhwb3J0cy5lbmNvZGVCYXNlNjRQYWNrZXQgPSBmdW5jdGlvbihwYWNrZXQsIGNhbGxiYWNrKSB7XG4gIHZhciBtZXNzYWdlID0gJ2InICsgZXhwb3J0cy5wYWNrZXRzW3BhY2tldC50eXBlXTtcbiAgaWYgKHR5cGVvZiBCbG9iICE9PSAndW5kZWZpbmVkJyAmJiBwYWNrZXQuZGF0YSBpbnN0YW5jZW9mIEJsb2IpIHtcbiAgICB2YXIgZnIgPSBuZXcgRmlsZVJlYWRlcigpO1xuICAgIGZyLm9ubG9hZCA9IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGI2NCA9IGZyLnJlc3VsdC5zcGxpdCgnLCcpWzFdO1xuICAgICAgY2FsbGJhY2sobWVzc2FnZSArIGI2NCk7XG4gICAgfTtcbiAgICByZXR1cm4gZnIucmVhZEFzRGF0YVVSTChwYWNrZXQuZGF0YSk7XG4gIH1cblxuICB2YXIgYjY0ZGF0YTtcbiAgdHJ5IHtcbiAgICBiNjRkYXRhID0gU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseShudWxsLCBuZXcgVWludDhBcnJheShwYWNrZXQuZGF0YSkpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgLy8gaVBob25lIFNhZmFyaSBkb2Vzbid0IGxldCB5b3UgYXBwbHkgd2l0aCB0eXBlZCBhcnJheXNcbiAgICB2YXIgdHlwZWQgPSBuZXcgVWludDhBcnJheShwYWNrZXQuZGF0YSk7XG4gICAgdmFyIGJhc2ljID0gbmV3IEFycmF5KHR5cGVkLmxlbmd0aCk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0eXBlZC5sZW5ndGg7IGkrKykge1xuICAgICAgYmFzaWNbaV0gPSB0eXBlZFtpXTtcbiAgICB9XG4gICAgYjY0ZGF0YSA9IFN0cmluZy5mcm9tQ2hhckNvZGUuYXBwbHkobnVsbCwgYmFzaWMpO1xuICB9XG4gIG1lc3NhZ2UgKz0gYnRvYShiNjRkYXRhKTtcbiAgcmV0dXJuIGNhbGxiYWNrKG1lc3NhZ2UpO1xufTtcblxuLyoqXG4gKiBEZWNvZGVzIGEgcGFja2V0LiBDaGFuZ2VzIGZvcm1hdCB0byBCbG9iIGlmIHJlcXVlc3RlZC5cbiAqXG4gKiBAcmV0dXJuIHtPYmplY3R9IHdpdGggYHR5cGVgIGFuZCBgZGF0YWAgKGlmIGFueSlcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmV4cG9ydHMuZGVjb2RlUGFja2V0ID0gZnVuY3Rpb24gKGRhdGEsIGJpbmFyeVR5cGUsIHV0ZjhkZWNvZGUpIHtcbiAgaWYgKGRhdGEgPT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiBlcnI7XG4gIH1cbiAgLy8gU3RyaW5nIGRhdGFcbiAgaWYgKHR5cGVvZiBkYXRhID09PSAnc3RyaW5nJykge1xuICAgIGlmIChkYXRhLmNoYXJBdCgwKSA9PT0gJ2InKSB7XG4gICAgICByZXR1cm4gZXhwb3J0cy5kZWNvZGVCYXNlNjRQYWNrZXQoZGF0YS5zdWJzdHIoMSksIGJpbmFyeVR5cGUpO1xuICAgIH1cblxuICAgIGlmICh1dGY4ZGVjb2RlKSB7XG4gICAgICBkYXRhID0gdHJ5RGVjb2RlKGRhdGEpO1xuICAgICAgaWYgKGRhdGEgPT09IGZhbHNlKSB7XG4gICAgICAgIHJldHVybiBlcnI7XG4gICAgICB9XG4gICAgfVxuICAgIHZhciB0eXBlID0gZGF0YS5jaGFyQXQoMCk7XG5cbiAgICBpZiAoTnVtYmVyKHR5cGUpICE9IHR5cGUgfHwgIXBhY2tldHNsaXN0W3R5cGVdKSB7XG4gICAgICByZXR1cm4gZXJyO1xuICAgIH1cblxuICAgIGlmIChkYXRhLmxlbmd0aCA+IDEpIHtcbiAgICAgIHJldHVybiB7IHR5cGU6IHBhY2tldHNsaXN0W3R5cGVdLCBkYXRhOiBkYXRhLnN1YnN0cmluZygxKSB9O1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4geyB0eXBlOiBwYWNrZXRzbGlzdFt0eXBlXSB9O1xuICAgIH1cbiAgfVxuXG4gIHZhciBhc0FycmF5ID0gbmV3IFVpbnQ4QXJyYXkoZGF0YSk7XG4gIHZhciB0eXBlID0gYXNBcnJheVswXTtcbiAgdmFyIHJlc3QgPSBzbGljZUJ1ZmZlcihkYXRhLCAxKTtcbiAgaWYgKEJsb2IgJiYgYmluYXJ5VHlwZSA9PT0gJ2Jsb2InKSB7XG4gICAgcmVzdCA9IG5ldyBCbG9iKFtyZXN0XSk7XG4gIH1cbiAgcmV0dXJuIHsgdHlwZTogcGFja2V0c2xpc3RbdHlwZV0sIGRhdGE6IHJlc3QgfTtcbn07XG5cbmZ1bmN0aW9uIHRyeURlY29kZShkYXRhKSB7XG4gIHRyeSB7XG4gICAgZGF0YSA9IHV0ZjguZGVjb2RlKGRhdGEsIHsgc3RyaWN0OiBmYWxzZSB9KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gZGF0YTtcbn1cblxuLyoqXG4gKiBEZWNvZGVzIGEgcGFja2V0IGVuY29kZWQgaW4gYSBiYXNlNjQgc3RyaW5nXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGJhc2U2NCBlbmNvZGVkIG1lc3NhZ2VcbiAqIEByZXR1cm4ge09iamVjdH0gd2l0aCBgdHlwZWAgYW5kIGBkYXRhYCAoaWYgYW55KVxuICovXG5cbmV4cG9ydHMuZGVjb2RlQmFzZTY0UGFja2V0ID0gZnVuY3Rpb24obXNnLCBiaW5hcnlUeXBlKSB7XG4gIHZhciB0eXBlID0gcGFja2V0c2xpc3RbbXNnLmNoYXJBdCgwKV07XG4gIGlmICghYmFzZTY0ZW5jb2Rlcikge1xuICAgIHJldHVybiB7IHR5cGU6IHR5cGUsIGRhdGE6IHsgYmFzZTY0OiB0cnVlLCBkYXRhOiBtc2cuc3Vic3RyKDEpIH0gfTtcbiAgfVxuXG4gIHZhciBkYXRhID0gYmFzZTY0ZW5jb2Rlci5kZWNvZGUobXNnLnN1YnN0cigxKSk7XG5cbiAgaWYgKGJpbmFyeVR5cGUgPT09ICdibG9iJyAmJiBCbG9iKSB7XG4gICAgZGF0YSA9IG5ldyBCbG9iKFtkYXRhXSk7XG4gIH1cblxuICByZXR1cm4geyB0eXBlOiB0eXBlLCBkYXRhOiBkYXRhIH07XG59O1xuXG4vKipcbiAqIEVuY29kZXMgbXVsdGlwbGUgbWVzc2FnZXMgKHBheWxvYWQpLlxuICpcbiAqICAgICA8bGVuZ3RoPjpkYXRhXG4gKlxuICogRXhhbXBsZTpcbiAqXG4gKiAgICAgMTE6aGVsbG8gd29ybGQyOmhpXG4gKlxuICogSWYgYW55IGNvbnRlbnRzIGFyZSBiaW5hcnksIHRoZXkgd2lsbCBiZSBlbmNvZGVkIGFzIGJhc2U2NCBzdHJpbmdzLiBCYXNlNjRcbiAqIGVuY29kZWQgc3RyaW5ncyBhcmUgbWFya2VkIHdpdGggYSBiIGJlZm9yZSB0aGUgbGVuZ3RoIHNwZWNpZmllclxuICpcbiAqIEBwYXJhbSB7QXJyYXl9IHBhY2tldHNcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmV4cG9ydHMuZW5jb2RlUGF5bG9hZCA9IGZ1bmN0aW9uIChwYWNrZXRzLCBzdXBwb3J0c0JpbmFyeSwgY2FsbGJhY2spIHtcbiAgaWYgKHR5cGVvZiBzdXBwb3J0c0JpbmFyeSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGNhbGxiYWNrID0gc3VwcG9ydHNCaW5hcnk7XG4gICAgc3VwcG9ydHNCaW5hcnkgPSBudWxsO1xuICB9XG5cbiAgdmFyIGlzQmluYXJ5ID0gaGFzQmluYXJ5KHBhY2tldHMpO1xuXG4gIGlmIChzdXBwb3J0c0JpbmFyeSAmJiBpc0JpbmFyeSkge1xuICAgIGlmIChCbG9iICYmICFkb250U2VuZEJsb2JzKSB7XG4gICAgICByZXR1cm4gZXhwb3J0cy5lbmNvZGVQYXlsb2FkQXNCbG9iKHBhY2tldHMsIGNhbGxiYWNrKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZXhwb3J0cy5lbmNvZGVQYXlsb2FkQXNBcnJheUJ1ZmZlcihwYWNrZXRzLCBjYWxsYmFjayk7XG4gIH1cblxuICBpZiAoIXBhY2tldHMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGNhbGxiYWNrKCcwOicpO1xuICB9XG5cbiAgZnVuY3Rpb24gc2V0TGVuZ3RoSGVhZGVyKG1lc3NhZ2UpIHtcbiAgICByZXR1cm4gbWVzc2FnZS5sZW5ndGggKyAnOicgKyBtZXNzYWdlO1xuICB9XG5cbiAgZnVuY3Rpb24gZW5jb2RlT25lKHBhY2tldCwgZG9uZUNhbGxiYWNrKSB7XG4gICAgZXhwb3J0cy5lbmNvZGVQYWNrZXQocGFja2V0LCAhaXNCaW5hcnkgPyBmYWxzZSA6IHN1cHBvcnRzQmluYXJ5LCBmYWxzZSwgZnVuY3Rpb24obWVzc2FnZSkge1xuICAgICAgZG9uZUNhbGxiYWNrKG51bGwsIHNldExlbmd0aEhlYWRlcihtZXNzYWdlKSk7XG4gICAgfSk7XG4gIH1cblxuICBtYXAocGFja2V0cywgZW5jb2RlT25lLCBmdW5jdGlvbihlcnIsIHJlc3VsdHMpIHtcbiAgICByZXR1cm4gY2FsbGJhY2socmVzdWx0cy5qb2luKCcnKSk7XG4gIH0pO1xufTtcblxuLyoqXG4gKiBBc3luYyBhcnJheSBtYXAgdXNpbmcgYWZ0ZXJcbiAqL1xuXG5mdW5jdGlvbiBtYXAoYXJ5LCBlYWNoLCBkb25lKSB7XG4gIHZhciByZXN1bHQgPSBuZXcgQXJyYXkoYXJ5Lmxlbmd0aCk7XG4gIHZhciBuZXh0ID0gYWZ0ZXIoYXJ5Lmxlbmd0aCwgZG9uZSk7XG5cbiAgdmFyIGVhY2hXaXRoSW5kZXggPSBmdW5jdGlvbihpLCBlbCwgY2IpIHtcbiAgICBlYWNoKGVsLCBmdW5jdGlvbihlcnJvciwgbXNnKSB7XG4gICAgICByZXN1bHRbaV0gPSBtc2c7XG4gICAgICBjYihlcnJvciwgcmVzdWx0KTtcbiAgICB9KTtcbiAgfTtcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IGFyeS5sZW5ndGg7IGkrKykge1xuICAgIGVhY2hXaXRoSW5kZXgoaSwgYXJ5W2ldLCBuZXh0KTtcbiAgfVxufVxuXG4vKlxuICogRGVjb2RlcyBkYXRhIHdoZW4gYSBwYXlsb2FkIGlzIG1heWJlIGV4cGVjdGVkLiBQb3NzaWJsZSBiaW5hcnkgY29udGVudHMgYXJlXG4gKiBkZWNvZGVkIGZyb20gdGhlaXIgYmFzZTY0IHJlcHJlc2VudGF0aW9uXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGRhdGEsIGNhbGxiYWNrIG1ldGhvZFxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5leHBvcnRzLmRlY29kZVBheWxvYWQgPSBmdW5jdGlvbiAoZGF0YSwgYmluYXJ5VHlwZSwgY2FsbGJhY2spIHtcbiAgaWYgKHR5cGVvZiBkYXRhICE9PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBleHBvcnRzLmRlY29kZVBheWxvYWRBc0JpbmFyeShkYXRhLCBiaW5hcnlUeXBlLCBjYWxsYmFjayk7XG4gIH1cblxuICBpZiAodHlwZW9mIGJpbmFyeVR5cGUgPT09ICdmdW5jdGlvbicpIHtcbiAgICBjYWxsYmFjayA9IGJpbmFyeVR5cGU7XG4gICAgYmluYXJ5VHlwZSA9IG51bGw7XG4gIH1cblxuICB2YXIgcGFja2V0O1xuICBpZiAoZGF0YSA9PT0gJycpIHtcbiAgICAvLyBwYXJzZXIgZXJyb3IgLSBpZ25vcmluZyBwYXlsb2FkXG4gICAgcmV0dXJuIGNhbGxiYWNrKGVyciwgMCwgMSk7XG4gIH1cblxuICB2YXIgbGVuZ3RoID0gJycsIG4sIG1zZztcblxuICBmb3IgKHZhciBpID0gMCwgbCA9IGRhdGEubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgdmFyIGNociA9IGRhdGEuY2hhckF0KGkpO1xuXG4gICAgaWYgKGNociAhPT0gJzonKSB7XG4gICAgICBsZW5ndGggKz0gY2hyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGxlbmd0aCA9PT0gJycgfHwgKGxlbmd0aCAhPSAobiA9IE51bWJlcihsZW5ndGgpKSkpIHtcbiAgICAgIC8vIHBhcnNlciBlcnJvciAtIGlnbm9yaW5nIHBheWxvYWRcbiAgICAgIHJldHVybiBjYWxsYmFjayhlcnIsIDAsIDEpO1xuICAgIH1cblxuICAgIG1zZyA9IGRhdGEuc3Vic3RyKGkgKyAxLCBuKTtcblxuICAgIGlmIChsZW5ndGggIT0gbXNnLmxlbmd0aCkge1xuICAgICAgLy8gcGFyc2VyIGVycm9yIC0gaWdub3JpbmcgcGF5bG9hZFxuICAgICAgcmV0dXJuIGNhbGxiYWNrKGVyciwgMCwgMSk7XG4gICAgfVxuXG4gICAgaWYgKG1zZy5sZW5ndGgpIHtcbiAgICAgIHBhY2tldCA9IGV4cG9ydHMuZGVjb2RlUGFja2V0KG1zZywgYmluYXJ5VHlwZSwgZmFsc2UpO1xuXG4gICAgICBpZiAoZXJyLnR5cGUgPT09IHBhY2tldC50eXBlICYmIGVyci5kYXRhID09PSBwYWNrZXQuZGF0YSkge1xuICAgICAgICAvLyBwYXJzZXIgZXJyb3IgaW4gaW5kaXZpZHVhbCBwYWNrZXQgLSBpZ25vcmluZyBwYXlsb2FkXG4gICAgICAgIHJldHVybiBjYWxsYmFjayhlcnIsIDAsIDEpO1xuICAgICAgfVxuXG4gICAgICB2YXIgcmV0ID0gY2FsbGJhY2socGFja2V0LCBpICsgbiwgbCk7XG4gICAgICBpZiAoZmFsc2UgPT09IHJldCkgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIGFkdmFuY2UgY3Vyc29yXG4gICAgaSArPSBuO1xuICAgIGxlbmd0aCA9ICcnO1xuICB9XG5cbiAgaWYgKGxlbmd0aCAhPT0gJycpIHtcbiAgICAvLyBwYXJzZXIgZXJyb3IgLSBpZ25vcmluZyBwYXlsb2FkXG4gICAgcmV0dXJuIGNhbGxiYWNrKGVyciwgMCwgMSk7XG4gIH1cblxufTtcblxuLyoqXG4gKiBFbmNvZGVzIG11bHRpcGxlIG1lc3NhZ2VzIChwYXlsb2FkKSBhcyBiaW5hcnkuXG4gKlxuICogPDEgPSBiaW5hcnksIDAgPSBzdHJpbmc+PG51bWJlciBmcm9tIDAtOT48bnVtYmVyIGZyb20gMC05PlsuLi5dPG51bWJlclxuICogMjU1PjxkYXRhPlxuICpcbiAqIEV4YW1wbGU6XG4gKiAxIDMgMjU1IDEgMiAzLCBpZiB0aGUgYmluYXJ5IGNvbnRlbnRzIGFyZSBpbnRlcnByZXRlZCBhcyA4IGJpdCBpbnRlZ2Vyc1xuICpcbiAqIEBwYXJhbSB7QXJyYXl9IHBhY2tldHNcbiAqIEByZXR1cm4ge0FycmF5QnVmZmVyfSBlbmNvZGVkIHBheWxvYWRcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmV4cG9ydHMuZW5jb2RlUGF5bG9hZEFzQXJyYXlCdWZmZXIgPSBmdW5jdGlvbihwYWNrZXRzLCBjYWxsYmFjaykge1xuICBpZiAoIXBhY2tldHMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGNhbGxiYWNrKG5ldyBBcnJheUJ1ZmZlcigwKSk7XG4gIH1cblxuICBmdW5jdGlvbiBlbmNvZGVPbmUocGFja2V0LCBkb25lQ2FsbGJhY2spIHtcbiAgICBleHBvcnRzLmVuY29kZVBhY2tldChwYWNrZXQsIHRydWUsIHRydWUsIGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgIHJldHVybiBkb25lQ2FsbGJhY2sobnVsbCwgZGF0YSk7XG4gICAgfSk7XG4gIH1cblxuICBtYXAocGFja2V0cywgZW5jb2RlT25lLCBmdW5jdGlvbihlcnIsIGVuY29kZWRQYWNrZXRzKSB7XG4gICAgdmFyIHRvdGFsTGVuZ3RoID0gZW5jb2RlZFBhY2tldHMucmVkdWNlKGZ1bmN0aW9uKGFjYywgcCkge1xuICAgICAgdmFyIGxlbjtcbiAgICAgIGlmICh0eXBlb2YgcCA9PT0gJ3N0cmluZycpe1xuICAgICAgICBsZW4gPSBwLmxlbmd0aDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxlbiA9IHAuYnl0ZUxlbmd0aDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBhY2MgKyBsZW4udG9TdHJpbmcoKS5sZW5ndGggKyBsZW4gKyAyOyAvLyBzdHJpbmcvYmluYXJ5IGlkZW50aWZpZXIgKyBzZXBhcmF0b3IgPSAyXG4gICAgfSwgMCk7XG5cbiAgICB2YXIgcmVzdWx0QXJyYXkgPSBuZXcgVWludDhBcnJheSh0b3RhbExlbmd0aCk7XG5cbiAgICB2YXIgYnVmZmVySW5kZXggPSAwO1xuICAgIGVuY29kZWRQYWNrZXRzLmZvckVhY2goZnVuY3Rpb24ocCkge1xuICAgICAgdmFyIGlzU3RyaW5nID0gdHlwZW9mIHAgPT09ICdzdHJpbmcnO1xuICAgICAgdmFyIGFiID0gcDtcbiAgICAgIGlmIChpc1N0cmluZykge1xuICAgICAgICB2YXIgdmlldyA9IG5ldyBVaW50OEFycmF5KHAubGVuZ3RoKTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgdmlld1tpXSA9IHAuY2hhckNvZGVBdChpKTtcbiAgICAgICAgfVxuICAgICAgICBhYiA9IHZpZXcuYnVmZmVyO1xuICAgICAgfVxuXG4gICAgICBpZiAoaXNTdHJpbmcpIHsgLy8gbm90IHRydWUgYmluYXJ5XG4gICAgICAgIHJlc3VsdEFycmF5W2J1ZmZlckluZGV4KytdID0gMDtcbiAgICAgIH0gZWxzZSB7IC8vIHRydWUgYmluYXJ5XG4gICAgICAgIHJlc3VsdEFycmF5W2J1ZmZlckluZGV4KytdID0gMTtcbiAgICAgIH1cblxuICAgICAgdmFyIGxlblN0ciA9IGFiLmJ5dGVMZW5ndGgudG9TdHJpbmcoKTtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuU3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHJlc3VsdEFycmF5W2J1ZmZlckluZGV4KytdID0gcGFyc2VJbnQobGVuU3RyW2ldKTtcbiAgICAgIH1cbiAgICAgIHJlc3VsdEFycmF5W2J1ZmZlckluZGV4KytdID0gMjU1O1xuXG4gICAgICB2YXIgdmlldyA9IG5ldyBVaW50OEFycmF5KGFiKTtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdmlldy5sZW5ndGg7IGkrKykge1xuICAgICAgICByZXN1bHRBcnJheVtidWZmZXJJbmRleCsrXSA9IHZpZXdbaV07XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gY2FsbGJhY2socmVzdWx0QXJyYXkuYnVmZmVyKTtcbiAgfSk7XG59O1xuXG4vKipcbiAqIEVuY29kZSBhcyBCbG9iXG4gKi9cblxuZXhwb3J0cy5lbmNvZGVQYXlsb2FkQXNCbG9iID0gZnVuY3Rpb24ocGFja2V0cywgY2FsbGJhY2spIHtcbiAgZnVuY3Rpb24gZW5jb2RlT25lKHBhY2tldCwgZG9uZUNhbGxiYWNrKSB7XG4gICAgZXhwb3J0cy5lbmNvZGVQYWNrZXQocGFja2V0LCB0cnVlLCB0cnVlLCBmdW5jdGlvbihlbmNvZGVkKSB7XG4gICAgICB2YXIgYmluYXJ5SWRlbnRpZmllciA9IG5ldyBVaW50OEFycmF5KDEpO1xuICAgICAgYmluYXJ5SWRlbnRpZmllclswXSA9IDE7XG4gICAgICBpZiAodHlwZW9mIGVuY29kZWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHZhciB2aWV3ID0gbmV3IFVpbnQ4QXJyYXkoZW5jb2RlZC5sZW5ndGgpO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGVuY29kZWQubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICB2aWV3W2ldID0gZW5jb2RlZC5jaGFyQ29kZUF0KGkpO1xuICAgICAgICB9XG4gICAgICAgIGVuY29kZWQgPSB2aWV3LmJ1ZmZlcjtcbiAgICAgICAgYmluYXJ5SWRlbnRpZmllclswXSA9IDA7XG4gICAgICB9XG5cbiAgICAgIHZhciBsZW4gPSAoZW5jb2RlZCBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKVxuICAgICAgICA/IGVuY29kZWQuYnl0ZUxlbmd0aFxuICAgICAgICA6IGVuY29kZWQuc2l6ZTtcblxuICAgICAgdmFyIGxlblN0ciA9IGxlbi50b1N0cmluZygpO1xuICAgICAgdmFyIGxlbmd0aEFyeSA9IG5ldyBVaW50OEFycmF5KGxlblN0ci5sZW5ndGggKyAxKTtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuU3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGxlbmd0aEFyeVtpXSA9IHBhcnNlSW50KGxlblN0cltpXSk7XG4gICAgICB9XG4gICAgICBsZW5ndGhBcnlbbGVuU3RyLmxlbmd0aF0gPSAyNTU7XG5cbiAgICAgIGlmIChCbG9iKSB7XG4gICAgICAgIHZhciBibG9iID0gbmV3IEJsb2IoW2JpbmFyeUlkZW50aWZpZXIuYnVmZmVyLCBsZW5ndGhBcnkuYnVmZmVyLCBlbmNvZGVkXSk7XG4gICAgICAgIGRvbmVDYWxsYmFjayhudWxsLCBibG9iKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIG1hcChwYWNrZXRzLCBlbmNvZGVPbmUsIGZ1bmN0aW9uKGVyciwgcmVzdWx0cykge1xuICAgIHJldHVybiBjYWxsYmFjayhuZXcgQmxvYihyZXN1bHRzKSk7XG4gIH0pO1xufTtcblxuLypcbiAqIERlY29kZXMgZGF0YSB3aGVuIGEgcGF5bG9hZCBpcyBtYXliZSBleHBlY3RlZC4gU3RyaW5ncyBhcmUgZGVjb2RlZCBieVxuICogaW50ZXJwcmV0aW5nIGVhY2ggYnl0ZSBhcyBhIGtleSBjb2RlIGZvciBlbnRyaWVzIG1hcmtlZCB0byBzdGFydCB3aXRoIDAuIFNlZVxuICogZGVzY3JpcHRpb24gb2YgZW5jb2RlUGF5bG9hZEFzQmluYXJ5XG4gKlxuICogQHBhcmFtIHtBcnJheUJ1ZmZlcn0gZGF0YSwgY2FsbGJhY2sgbWV0aG9kXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmV4cG9ydHMuZGVjb2RlUGF5bG9hZEFzQmluYXJ5ID0gZnVuY3Rpb24gKGRhdGEsIGJpbmFyeVR5cGUsIGNhbGxiYWNrKSB7XG4gIGlmICh0eXBlb2YgYmluYXJ5VHlwZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGNhbGxiYWNrID0gYmluYXJ5VHlwZTtcbiAgICBiaW5hcnlUeXBlID0gbnVsbDtcbiAgfVxuXG4gIHZhciBidWZmZXJUYWlsID0gZGF0YTtcbiAgdmFyIGJ1ZmZlcnMgPSBbXTtcblxuICB3aGlsZSAoYnVmZmVyVGFpbC5ieXRlTGVuZ3RoID4gMCkge1xuICAgIHZhciB0YWlsQXJyYXkgPSBuZXcgVWludDhBcnJheShidWZmZXJUYWlsKTtcbiAgICB2YXIgaXNTdHJpbmcgPSB0YWlsQXJyYXlbMF0gPT09IDA7XG4gICAgdmFyIG1zZ0xlbmd0aCA9ICcnO1xuXG4gICAgZm9yICh2YXIgaSA9IDE7IDsgaSsrKSB7XG4gICAgICBpZiAodGFpbEFycmF5W2ldID09PSAyNTUpIGJyZWFrO1xuXG4gICAgICAvLyAzMTAgPSBjaGFyIGxlbmd0aCBvZiBOdW1iZXIuTUFYX1ZBTFVFXG4gICAgICBpZiAobXNnTGVuZ3RoLmxlbmd0aCA+IDMxMCkge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyLCAwLCAxKTtcbiAgICAgIH1cblxuICAgICAgbXNnTGVuZ3RoICs9IHRhaWxBcnJheVtpXTtcbiAgICB9XG5cbiAgICBidWZmZXJUYWlsID0gc2xpY2VCdWZmZXIoYnVmZmVyVGFpbCwgMiArIG1zZ0xlbmd0aC5sZW5ndGgpO1xuICAgIG1zZ0xlbmd0aCA9IHBhcnNlSW50KG1zZ0xlbmd0aCk7XG5cbiAgICB2YXIgbXNnID0gc2xpY2VCdWZmZXIoYnVmZmVyVGFpbCwgMCwgbXNnTGVuZ3RoKTtcbiAgICBpZiAoaXNTdHJpbmcpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIG1zZyA9IFN0cmluZy5mcm9tQ2hhckNvZGUuYXBwbHkobnVsbCwgbmV3IFVpbnQ4QXJyYXkobXNnKSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIC8vIGlQaG9uZSBTYWZhcmkgZG9lc24ndCBsZXQgeW91IGFwcGx5IHRvIHR5cGVkIGFycmF5c1xuICAgICAgICB2YXIgdHlwZWQgPSBuZXcgVWludDhBcnJheShtc2cpO1xuICAgICAgICBtc2cgPSAnJztcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0eXBlZC5sZW5ndGg7IGkrKykge1xuICAgICAgICAgIG1zZyArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKHR5cGVkW2ldKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGJ1ZmZlcnMucHVzaChtc2cpO1xuICAgIGJ1ZmZlclRhaWwgPSBzbGljZUJ1ZmZlcihidWZmZXJUYWlsLCBtc2dMZW5ndGgpO1xuICB9XG5cbiAgdmFyIHRvdGFsID0gYnVmZmVycy5sZW5ndGg7XG4gIGJ1ZmZlcnMuZm9yRWFjaChmdW5jdGlvbihidWZmZXIsIGkpIHtcbiAgICBjYWxsYmFjayhleHBvcnRzLmRlY29kZVBhY2tldChidWZmZXIsIGJpbmFyeVR5cGUsIHRydWUpLCBpLCB0b3RhbCk7XG4gIH0pO1xufTtcbiIsIlxyXG4vKipcclxuICogRXhwb3NlIGBFbWl0dGVyYC5cclxuICovXHJcblxyXG5pZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcpIHtcclxuICBtb2R1bGUuZXhwb3J0cyA9IEVtaXR0ZXI7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBJbml0aWFsaXplIGEgbmV3IGBFbWl0dGVyYC5cclxuICpcclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5mdW5jdGlvbiBFbWl0dGVyKG9iaikge1xyXG4gIGlmIChvYmopIHJldHVybiBtaXhpbihvYmopO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIE1peGluIHRoZSBlbWl0dGVyIHByb3BlcnRpZXMuXHJcbiAqXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmpcclxuICogQHJldHVybiB7T2JqZWN0fVxyXG4gKiBAYXBpIHByaXZhdGVcclxuICovXHJcblxyXG5mdW5jdGlvbiBtaXhpbihvYmopIHtcclxuICBmb3IgKHZhciBrZXkgaW4gRW1pdHRlci5wcm90b3R5cGUpIHtcclxuICAgIG9ialtrZXldID0gRW1pdHRlci5wcm90b3R5cGVba2V5XTtcclxuICB9XHJcbiAgcmV0dXJuIG9iajtcclxufVxyXG5cclxuLyoqXHJcbiAqIExpc3RlbiBvbiB0aGUgZ2l2ZW4gYGV2ZW50YCB3aXRoIGBmbmAuXHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBldmVudFxyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxyXG4gKiBAcmV0dXJuIHtFbWl0dGVyfVxyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcbkVtaXR0ZXIucHJvdG90eXBlLm9uID1cclxuRW1pdHRlci5wcm90b3R5cGUuYWRkRXZlbnRMaXN0ZW5lciA9IGZ1bmN0aW9uKGV2ZW50LCBmbil7XHJcbiAgdGhpcy5fY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzIHx8IHt9O1xyXG4gICh0aGlzLl9jYWxsYmFja3NbJyQnICsgZXZlbnRdID0gdGhpcy5fY2FsbGJhY2tzWyckJyArIGV2ZW50XSB8fCBbXSlcclxuICAgIC5wdXNoKGZuKTtcclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBBZGRzIGFuIGBldmVudGAgbGlzdGVuZXIgdGhhdCB3aWxsIGJlIGludm9rZWQgYSBzaW5nbGVcclxuICogdGltZSB0aGVuIGF1dG9tYXRpY2FsbHkgcmVtb3ZlZC5cclxuICpcclxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XHJcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuXHJcbiAqIEByZXR1cm4ge0VtaXR0ZXJ9XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuRW1pdHRlci5wcm90b3R5cGUub25jZSA9IGZ1bmN0aW9uKGV2ZW50LCBmbil7XHJcbiAgZnVuY3Rpb24gb24oKSB7XHJcbiAgICB0aGlzLm9mZihldmVudCwgb24pO1xyXG4gICAgZm4uYXBwbHkodGhpcywgYXJndW1lbnRzKTtcclxuICB9XHJcblxyXG4gIG9uLmZuID0gZm47XHJcbiAgdGhpcy5vbihldmVudCwgb24pO1xyXG4gIHJldHVybiB0aGlzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJlbW92ZSB0aGUgZ2l2ZW4gY2FsbGJhY2sgZm9yIGBldmVudGAgb3IgYWxsXHJcbiAqIHJlZ2lzdGVyZWQgY2FsbGJhY2tzLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gZXZlbnRcclxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cclxuICogQHJldHVybiB7RW1pdHRlcn1cclxuICogQGFwaSBwdWJsaWNcclxuICovXHJcblxyXG5FbWl0dGVyLnByb3RvdHlwZS5vZmYgPVxyXG5FbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVMaXN0ZW5lciA9XHJcbkVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUFsbExpc3RlbmVycyA9XHJcbkVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUV2ZW50TGlzdGVuZXIgPSBmdW5jdGlvbihldmVudCwgZm4pe1xyXG4gIHRoaXMuX2NhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrcyB8fCB7fTtcclxuXHJcbiAgLy8gYWxsXHJcbiAgaWYgKDAgPT0gYXJndW1lbnRzLmxlbmd0aCkge1xyXG4gICAgdGhpcy5fY2FsbGJhY2tzID0ge307XHJcbiAgICByZXR1cm4gdGhpcztcclxuICB9XHJcblxyXG4gIC8vIHNwZWNpZmljIGV2ZW50XHJcbiAgdmFyIGNhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrc1snJCcgKyBldmVudF07XHJcbiAgaWYgKCFjYWxsYmFja3MpIHJldHVybiB0aGlzO1xyXG5cclxuICAvLyByZW1vdmUgYWxsIGhhbmRsZXJzXHJcbiAgaWYgKDEgPT0gYXJndW1lbnRzLmxlbmd0aCkge1xyXG4gICAgZGVsZXRlIHRoaXMuX2NhbGxiYWNrc1snJCcgKyBldmVudF07XHJcbiAgICByZXR1cm4gdGhpcztcclxuICB9XHJcblxyXG4gIC8vIHJlbW92ZSBzcGVjaWZpYyBoYW5kbGVyXHJcbiAgdmFyIGNiO1xyXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgY2FsbGJhY2tzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICBjYiA9IGNhbGxiYWNrc1tpXTtcclxuICAgIGlmIChjYiA9PT0gZm4gfHwgY2IuZm4gPT09IGZuKSB7XHJcbiAgICAgIGNhbGxiYWNrcy5zcGxpY2UoaSwgMSk7XHJcbiAgICAgIGJyZWFrO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gUmVtb3ZlIGV2ZW50IHNwZWNpZmljIGFycmF5cyBmb3IgZXZlbnQgdHlwZXMgdGhhdCBub1xyXG4gIC8vIG9uZSBpcyBzdWJzY3JpYmVkIGZvciB0byBhdm9pZCBtZW1vcnkgbGVhay5cclxuICBpZiAoY2FsbGJhY2tzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgZGVsZXRlIHRoaXMuX2NhbGxiYWNrc1snJCcgKyBldmVudF07XHJcbiAgfVxyXG5cclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBFbWl0IGBldmVudGAgd2l0aCB0aGUgZ2l2ZW4gYXJncy5cclxuICpcclxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XHJcbiAqIEBwYXJhbSB7TWl4ZWR9IC4uLlxyXG4gKiBAcmV0dXJuIHtFbWl0dGVyfVxyXG4gKi9cclxuXHJcbkVtaXR0ZXIucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbihldmVudCl7XHJcbiAgdGhpcy5fY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzIHx8IHt9O1xyXG5cclxuICB2YXIgYXJncyA9IG5ldyBBcnJheShhcmd1bWVudHMubGVuZ3RoIC0gMSlcclxuICAgICwgY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzWyckJyArIGV2ZW50XTtcclxuXHJcbiAgZm9yICh2YXIgaSA9IDE7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspIHtcclxuICAgIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xyXG4gIH1cclxuXHJcbiAgaWYgKGNhbGxiYWNrcykge1xyXG4gICAgY2FsbGJhY2tzID0gY2FsbGJhY2tzLnNsaWNlKDApO1xyXG4gICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGNhbGxiYWNrcy5sZW5ndGg7IGkgPCBsZW47ICsraSkge1xyXG4gICAgICBjYWxsYmFja3NbaV0uYXBwbHkodGhpcywgYXJncyk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICByZXR1cm4gdGhpcztcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZXR1cm4gYXJyYXkgb2YgY2FsbGJhY2tzIGZvciBgZXZlbnRgLlxyXG4gKlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gZXZlbnRcclxuICogQHJldHVybiB7QXJyYXl9XHJcbiAqIEBhcGkgcHVibGljXHJcbiAqL1xyXG5cclxuRW1pdHRlci5wcm90b3R5cGUubGlzdGVuZXJzID0gZnVuY3Rpb24oZXZlbnQpe1xyXG4gIHRoaXMuX2NhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrcyB8fCB7fTtcclxuICByZXR1cm4gdGhpcy5fY2FsbGJhY2tzWyckJyArIGV2ZW50XSB8fCBbXTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBDaGVjayBpZiB0aGlzIGVtaXR0ZXIgaGFzIGBldmVudGAgaGFuZGxlcnMuXHJcbiAqXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBldmVudFxyXG4gKiBAcmV0dXJuIHtCb29sZWFufVxyXG4gKiBAYXBpIHB1YmxpY1xyXG4gKi9cclxuXHJcbkVtaXR0ZXIucHJvdG90eXBlLmhhc0xpc3RlbmVycyA9IGZ1bmN0aW9uKGV2ZW50KXtcclxuICByZXR1cm4gISEgdGhpcy5saXN0ZW5lcnMoZXZlbnQpLmxlbmd0aDtcclxufTtcclxuIiwiLyoqXG4gKiBNb2R1bGUgZGVwZW5kZW5jaWVzLlxuICovXG5cbnZhciBwYXJzZXIgPSByZXF1aXJlKCdlbmdpbmUuaW8tcGFyc2VyJyk7XG52YXIgRW1pdHRlciA9IHJlcXVpcmUoJ2NvbXBvbmVudC1lbWl0dGVyJyk7XG5cbi8qKlxuICogTW9kdWxlIGV4cG9ydHMuXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBUcmFuc3BvcnQ7XG5cbi8qKlxuICogVHJhbnNwb3J0IGFic3RyYWN0IGNvbnN0cnVjdG9yLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zLlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gVHJhbnNwb3J0IChvcHRzKSB7XG4gIHRoaXMucGF0aCA9IG9wdHMucGF0aDtcbiAgdGhpcy5ob3N0bmFtZSA9IG9wdHMuaG9zdG5hbWU7XG4gIHRoaXMucG9ydCA9IG9wdHMucG9ydDtcbiAgdGhpcy5zZWN1cmUgPSBvcHRzLnNlY3VyZTtcbiAgdGhpcy5xdWVyeSA9IG9wdHMucXVlcnk7XG4gIHRoaXMudGltZXN0YW1wUGFyYW0gPSBvcHRzLnRpbWVzdGFtcFBhcmFtO1xuICB0aGlzLnRpbWVzdGFtcFJlcXVlc3RzID0gb3B0cy50aW1lc3RhbXBSZXF1ZXN0cztcbiAgdGhpcy5yZWFkeVN0YXRlID0gJyc7XG4gIHRoaXMuYWdlbnQgPSBvcHRzLmFnZW50IHx8IGZhbHNlO1xuICB0aGlzLnNvY2tldCA9IG9wdHMuc29ja2V0O1xuICB0aGlzLmVuYWJsZXNYRFIgPSBvcHRzLmVuYWJsZXNYRFI7XG4gIHRoaXMud2l0aENyZWRlbnRpYWxzID0gb3B0cy53aXRoQ3JlZGVudGlhbHM7XG5cbiAgLy8gU1NMIG9wdGlvbnMgZm9yIE5vZGUuanMgY2xpZW50XG4gIHRoaXMucGZ4ID0gb3B0cy5wZng7XG4gIHRoaXMua2V5ID0gb3B0cy5rZXk7XG4gIHRoaXMucGFzc3BocmFzZSA9IG9wdHMucGFzc3BocmFzZTtcbiAgdGhpcy5jZXJ0ID0gb3B0cy5jZXJ0O1xuICB0aGlzLmNhID0gb3B0cy5jYTtcbiAgdGhpcy5jaXBoZXJzID0gb3B0cy5jaXBoZXJzO1xuICB0aGlzLnJlamVjdFVuYXV0aG9yaXplZCA9IG9wdHMucmVqZWN0VW5hdXRob3JpemVkO1xuICB0aGlzLmZvcmNlTm9kZSA9IG9wdHMuZm9yY2VOb2RlO1xuXG4gIC8vIHJlc3VsdHMgb2YgUmVhY3ROYXRpdmUgZW52aXJvbm1lbnQgZGV0ZWN0aW9uXG4gIHRoaXMuaXNSZWFjdE5hdGl2ZSA9IG9wdHMuaXNSZWFjdE5hdGl2ZTtcblxuICAvLyBvdGhlciBvcHRpb25zIGZvciBOb2RlLmpzIGNsaWVudFxuICB0aGlzLmV4dHJhSGVhZGVycyA9IG9wdHMuZXh0cmFIZWFkZXJzO1xuICB0aGlzLmxvY2FsQWRkcmVzcyA9IG9wdHMubG9jYWxBZGRyZXNzO1xufVxuXG4vKipcbiAqIE1peCBpbiBgRW1pdHRlcmAuXG4gKi9cblxuRW1pdHRlcihUcmFuc3BvcnQucHJvdG90eXBlKTtcblxuLyoqXG4gKiBFbWl0cyBhbiBlcnJvci5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXG4gKiBAcmV0dXJuIHtUcmFuc3BvcnR9IGZvciBjaGFpbmluZ1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5UcmFuc3BvcnQucHJvdG90eXBlLm9uRXJyb3IgPSBmdW5jdGlvbiAobXNnLCBkZXNjKSB7XG4gIHZhciBlcnIgPSBuZXcgRXJyb3IobXNnKTtcbiAgZXJyLnR5cGUgPSAnVHJhbnNwb3J0RXJyb3InO1xuICBlcnIuZGVzY3JpcHRpb24gPSBkZXNjO1xuICB0aGlzLmVtaXQoJ2Vycm9yJywgZXJyKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIE9wZW5zIHRoZSB0cmFuc3BvcnQuXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5UcmFuc3BvcnQucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbiAoKSB7XG4gIGlmICgnY2xvc2VkJyA9PT0gdGhpcy5yZWFkeVN0YXRlIHx8ICcnID09PSB0aGlzLnJlYWR5U3RhdGUpIHtcbiAgICB0aGlzLnJlYWR5U3RhdGUgPSAnb3BlbmluZyc7XG4gICAgdGhpcy5kb09wZW4oKTtcbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBDbG9zZXMgdGhlIHRyYW5zcG9ydC5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5UcmFuc3BvcnQucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gKCkge1xuICBpZiAoJ29wZW5pbmcnID09PSB0aGlzLnJlYWR5U3RhdGUgfHwgJ29wZW4nID09PSB0aGlzLnJlYWR5U3RhdGUpIHtcbiAgICB0aGlzLmRvQ2xvc2UoKTtcbiAgICB0aGlzLm9uQ2xvc2UoKTtcbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBTZW5kcyBtdWx0aXBsZSBwYWNrZXRzLlxuICpcbiAqIEBwYXJhbSB7QXJyYXl9IHBhY2tldHNcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblRyYW5zcG9ydC5wcm90b3R5cGUuc2VuZCA9IGZ1bmN0aW9uIChwYWNrZXRzKSB7XG4gIGlmICgnb3BlbicgPT09IHRoaXMucmVhZHlTdGF0ZSkge1xuICAgIHRoaXMud3JpdGUocGFja2V0cyk7XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdUcmFuc3BvcnQgbm90IG9wZW4nKTtcbiAgfVxufTtcblxuLyoqXG4gKiBDYWxsZWQgdXBvbiBvcGVuXG4gKlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuVHJhbnNwb3J0LnByb3RvdHlwZS5vbk9wZW4gPSBmdW5jdGlvbiAoKSB7XG4gIHRoaXMucmVhZHlTdGF0ZSA9ICdvcGVuJztcbiAgdGhpcy53cml0YWJsZSA9IHRydWU7XG4gIHRoaXMuZW1pdCgnb3BlbicpO1xufTtcblxuLyoqXG4gKiBDYWxsZWQgd2l0aCBkYXRhLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBkYXRhXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5UcmFuc3BvcnQucHJvdG90eXBlLm9uRGF0YSA9IGZ1bmN0aW9uIChkYXRhKSB7XG4gIHZhciBwYWNrZXQgPSBwYXJzZXIuZGVjb2RlUGFja2V0KGRhdGEsIHRoaXMuc29ja2V0LmJpbmFyeVR5cGUpO1xuICB0aGlzLm9uUGFja2V0KHBhY2tldCk7XG59O1xuXG4vKipcbiAqIENhbGxlZCB3aXRoIGEgZGVjb2RlZCBwYWNrZXQuXG4gKi9cblxuVHJhbnNwb3J0LnByb3RvdHlwZS5vblBhY2tldCA9IGZ1bmN0aW9uIChwYWNrZXQpIHtcbiAgdGhpcy5lbWl0KCdwYWNrZXQnLCBwYWNrZXQpO1xufTtcblxuLyoqXG4gKiBDYWxsZWQgdXBvbiBjbG9zZS5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5UcmFuc3BvcnQucHJvdG90eXBlLm9uQ2xvc2UgPSBmdW5jdGlvbiAoKSB7XG4gIHRoaXMucmVhZHlTdGF0ZSA9ICdjbG9zZWQnO1xuICB0aGlzLmVtaXQoJ2Nsb3NlJyk7XG59O1xuIiwiLyoqXHJcbiAqIENvbXBpbGVzIGEgcXVlcnlzdHJpbmdcclxuICogUmV0dXJucyBzdHJpbmcgcmVwcmVzZW50YXRpb24gb2YgdGhlIG9iamVjdFxyXG4gKlxyXG4gKiBAcGFyYW0ge09iamVjdH1cclxuICogQGFwaSBwcml2YXRlXHJcbiAqL1xyXG5cclxuZXhwb3J0cy5lbmNvZGUgPSBmdW5jdGlvbiAob2JqKSB7XHJcbiAgdmFyIHN0ciA9ICcnO1xyXG5cclxuICBmb3IgKHZhciBpIGluIG9iaikge1xyXG4gICAgaWYgKG9iai5oYXNPd25Qcm9wZXJ0eShpKSkge1xyXG4gICAgICBpZiAoc3RyLmxlbmd0aCkgc3RyICs9ICcmJztcclxuICAgICAgc3RyICs9IGVuY29kZVVSSUNvbXBvbmVudChpKSArICc9JyArIGVuY29kZVVSSUNvbXBvbmVudChvYmpbaV0pO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHN0cjtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBQYXJzZXMgYSBzaW1wbGUgcXVlcnlzdHJpbmcgaW50byBhbiBvYmplY3RcclxuICpcclxuICogQHBhcmFtIHtTdHJpbmd9IHFzXHJcbiAqIEBhcGkgcHJpdmF0ZVxyXG4gKi9cclxuXHJcbmV4cG9ydHMuZGVjb2RlID0gZnVuY3Rpb24ocXMpe1xyXG4gIHZhciBxcnkgPSB7fTtcclxuICB2YXIgcGFpcnMgPSBxcy5zcGxpdCgnJicpO1xyXG4gIGZvciAodmFyIGkgPSAwLCBsID0gcGFpcnMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XHJcbiAgICB2YXIgcGFpciA9IHBhaXJzW2ldLnNwbGl0KCc9Jyk7XHJcbiAgICBxcnlbZGVjb2RlVVJJQ29tcG9uZW50KHBhaXJbMF0pXSA9IGRlY29kZVVSSUNvbXBvbmVudChwYWlyWzFdKTtcclxuICB9XHJcbiAgcmV0dXJuIHFyeTtcclxufTtcclxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGEsIGIpe1xuICB2YXIgZm4gPSBmdW5jdGlvbigpe307XG4gIGZuLnByb3RvdHlwZSA9IGIucHJvdG90eXBlO1xuICBhLnByb3RvdHlwZSA9IG5ldyBmbjtcbiAgYS5wcm90b3R5cGUuY29uc3RydWN0b3IgPSBhO1xufTsiLCIndXNlIHN0cmljdCc7XG5cbnZhciBhbHBoYWJldCA9ICcwMTIzNDU2Nzg5QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ei1fJy5zcGxpdCgnJylcbiAgLCBsZW5ndGggPSA2NFxuICAsIG1hcCA9IHt9XG4gICwgc2VlZCA9IDBcbiAgLCBpID0gMFxuICAsIHByZXY7XG5cbi8qKlxuICogUmV0dXJuIGEgc3RyaW5nIHJlcHJlc2VudGluZyB0aGUgc3BlY2lmaWVkIG51bWJlci5cbiAqXG4gKiBAcGFyYW0ge051bWJlcn0gbnVtIFRoZSBudW1iZXIgdG8gY29udmVydC5cbiAqIEByZXR1cm5zIHtTdHJpbmd9IFRoZSBzdHJpbmcgcmVwcmVzZW50YXRpb24gb2YgdGhlIG51bWJlci5cbiAqIEBhcGkgcHVibGljXG4gKi9cbmZ1bmN0aW9uIGVuY29kZShudW0pIHtcbiAgdmFyIGVuY29kZWQgPSAnJztcblxuICBkbyB7XG4gICAgZW5jb2RlZCA9IGFscGhhYmV0W251bSAlIGxlbmd0aF0gKyBlbmNvZGVkO1xuICAgIG51bSA9IE1hdGguZmxvb3IobnVtIC8gbGVuZ3RoKTtcbiAgfSB3aGlsZSAobnVtID4gMCk7XG5cbiAgcmV0dXJuIGVuY29kZWQ7XG59XG5cbi8qKlxuICogUmV0dXJuIHRoZSBpbnRlZ2VyIHZhbHVlIHNwZWNpZmllZCBieSB0aGUgZ2l2ZW4gc3RyaW5nLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBzdHIgVGhlIHN0cmluZyB0byBjb252ZXJ0LlxuICogQHJldHVybnMge051bWJlcn0gVGhlIGludGVnZXIgdmFsdWUgcmVwcmVzZW50ZWQgYnkgdGhlIHN0cmluZy5cbiAqIEBhcGkgcHVibGljXG4gKi9cbmZ1bmN0aW9uIGRlY29kZShzdHIpIHtcbiAgdmFyIGRlY29kZWQgPSAwO1xuXG4gIGZvciAoaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICBkZWNvZGVkID0gZGVjb2RlZCAqIGxlbmd0aCArIG1hcFtzdHIuY2hhckF0KGkpXTtcbiAgfVxuXG4gIHJldHVybiBkZWNvZGVkO1xufVxuXG4vKipcbiAqIFllYXN0OiBBIHRpbnkgZ3Jvd2luZyBpZCBnZW5lcmF0b3IuXG4gKlxuICogQHJldHVybnMge1N0cmluZ30gQSB1bmlxdWUgaWQuXG4gKiBAYXBpIHB1YmxpY1xuICovXG5mdW5jdGlvbiB5ZWFzdCgpIHtcbiAgdmFyIG5vdyA9IGVuY29kZSgrbmV3IERhdGUoKSk7XG5cbiAgaWYgKG5vdyAhPT0gcHJldikgcmV0dXJuIHNlZWQgPSAwLCBwcmV2ID0gbm93O1xuICByZXR1cm4gbm93ICsnLicrIGVuY29kZShzZWVkKyspO1xufVxuXG4vL1xuLy8gTWFwIGVhY2ggY2hhcmFjdGVyIHRvIGl0cyBpbmRleC5cbi8vXG5mb3IgKDsgaSA8IGxlbmd0aDsgaSsrKSBtYXBbYWxwaGFiZXRbaV1dID0gaTtcblxuLy9cbi8vIEV4cG9zZSB0aGUgYHllYXN0YCwgYGVuY29kZWAgYW5kIGBkZWNvZGVgIGZ1bmN0aW9ucy5cbi8vXG55ZWFzdC5lbmNvZGUgPSBlbmNvZGU7XG55ZWFzdC5kZWNvZGUgPSBkZWNvZGU7XG5tb2R1bGUuZXhwb3J0cyA9IHllYXN0O1xuIiwiLyoqXG4gKiBNb2R1bGUgZGVwZW5kZW5jaWVzLlxuICovXG5cbnZhciBUcmFuc3BvcnQgPSByZXF1aXJlKCcuLi90cmFuc3BvcnQnKTtcbnZhciBwYXJzZXFzID0gcmVxdWlyZSgncGFyc2VxcycpO1xudmFyIHBhcnNlciA9IHJlcXVpcmUoJ2VuZ2luZS5pby1wYXJzZXInKTtcbnZhciBpbmhlcml0ID0gcmVxdWlyZSgnY29tcG9uZW50LWluaGVyaXQnKTtcbnZhciB5ZWFzdCA9IHJlcXVpcmUoJ3llYXN0Jyk7XG52YXIgZGVidWcgPSByZXF1aXJlKCdkZWJ1ZycpKCdlbmdpbmUuaW8tY2xpZW50OnBvbGxpbmcnKTtcblxuLyoqXG4gKiBNb2R1bGUgZXhwb3J0cy5cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IFBvbGxpbmc7XG5cbi8qKlxuICogSXMgWEhSMiBzdXBwb3J0ZWQ/XG4gKi9cblxudmFyIGhhc1hIUjIgPSAoZnVuY3Rpb24gKCkge1xuICB2YXIgWE1MSHR0cFJlcXVlc3QgPSByZXF1aXJlKCd4bWxodHRwcmVxdWVzdC1zc2wnKTtcbiAgdmFyIHhociA9IG5ldyBYTUxIdHRwUmVxdWVzdCh7IHhkb21haW46IGZhbHNlIH0pO1xuICByZXR1cm4gbnVsbCAhPSB4aHIucmVzcG9uc2VUeXBlO1xufSkoKTtcblxuLyoqXG4gKiBQb2xsaW5nIGludGVyZmFjZS5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0c1xuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gUG9sbGluZyAob3B0cykge1xuICB2YXIgZm9yY2VCYXNlNjQgPSAob3B0cyAmJiBvcHRzLmZvcmNlQmFzZTY0KTtcbiAgaWYgKCFoYXNYSFIyIHx8IGZvcmNlQmFzZTY0KSB7XG4gICAgdGhpcy5zdXBwb3J0c0JpbmFyeSA9IGZhbHNlO1xuICB9XG4gIFRyYW5zcG9ydC5jYWxsKHRoaXMsIG9wdHMpO1xufVxuXG4vKipcbiAqIEluaGVyaXRzIGZyb20gVHJhbnNwb3J0LlxuICovXG5cbmluaGVyaXQoUG9sbGluZywgVHJhbnNwb3J0KTtcblxuLyoqXG4gKiBUcmFuc3BvcnQgbmFtZS5cbiAqL1xuXG5Qb2xsaW5nLnByb3RvdHlwZS5uYW1lID0gJ3BvbGxpbmcnO1xuXG4vKipcbiAqIE9wZW5zIHRoZSBzb2NrZXQgKHRyaWdnZXJzIHBvbGxpbmcpLiBXZSB3cml0ZSBhIFBJTkcgbWVzc2FnZSB0byBkZXRlcm1pbmVcbiAqIHdoZW4gdGhlIHRyYW5zcG9ydCBpcyBvcGVuLlxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblBvbGxpbmcucHJvdG90eXBlLmRvT3BlbiA9IGZ1bmN0aW9uICgpIHtcbiAgdGhpcy5wb2xsKCk7XG59O1xuXG4vKipcbiAqIFBhdXNlcyBwb2xsaW5nLlxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIHVwb24gYnVmZmVycyBhcmUgZmx1c2hlZCBhbmQgdHJhbnNwb3J0IGlzIHBhdXNlZFxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuUG9sbGluZy5wcm90b3R5cGUucGF1c2UgPSBmdW5jdGlvbiAob25QYXVzZSkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgdGhpcy5yZWFkeVN0YXRlID0gJ3BhdXNpbmcnO1xuXG4gIGZ1bmN0aW9uIHBhdXNlICgpIHtcbiAgICBkZWJ1ZygncGF1c2VkJyk7XG4gICAgc2VsZi5yZWFkeVN0YXRlID0gJ3BhdXNlZCc7XG4gICAgb25QYXVzZSgpO1xuICB9XG5cbiAgaWYgKHRoaXMucG9sbGluZyB8fCAhdGhpcy53cml0YWJsZSkge1xuICAgIHZhciB0b3RhbCA9IDA7XG5cbiAgICBpZiAodGhpcy5wb2xsaW5nKSB7XG4gICAgICBkZWJ1Zygnd2UgYXJlIGN1cnJlbnRseSBwb2xsaW5nIC0gd2FpdGluZyB0byBwYXVzZScpO1xuICAgICAgdG90YWwrKztcbiAgICAgIHRoaXMub25jZSgncG9sbENvbXBsZXRlJywgZnVuY3Rpb24gKCkge1xuICAgICAgICBkZWJ1ZygncHJlLXBhdXNlIHBvbGxpbmcgY29tcGxldGUnKTtcbiAgICAgICAgLS10b3RhbCB8fCBwYXVzZSgpO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLndyaXRhYmxlKSB7XG4gICAgICBkZWJ1Zygnd2UgYXJlIGN1cnJlbnRseSB3cml0aW5nIC0gd2FpdGluZyB0byBwYXVzZScpO1xuICAgICAgdG90YWwrKztcbiAgICAgIHRoaXMub25jZSgnZHJhaW4nLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGRlYnVnKCdwcmUtcGF1c2Ugd3JpdGluZyBjb21wbGV0ZScpO1xuICAgICAgICAtLXRvdGFsIHx8IHBhdXNlKCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgcGF1c2UoKTtcbiAgfVxufTtcblxuLyoqXG4gKiBTdGFydHMgcG9sbGluZyBjeWNsZS5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblBvbGxpbmcucHJvdG90eXBlLnBvbGwgPSBmdW5jdGlvbiAoKSB7XG4gIGRlYnVnKCdwb2xsaW5nJyk7XG4gIHRoaXMucG9sbGluZyA9IHRydWU7XG4gIHRoaXMuZG9Qb2xsKCk7XG4gIHRoaXMuZW1pdCgncG9sbCcpO1xufTtcblxuLyoqXG4gKiBPdmVybG9hZHMgb25EYXRhIHRvIGRldGVjdCBwYXlsb2Fkcy5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5Qb2xsaW5nLnByb3RvdHlwZS5vbkRhdGEgPSBmdW5jdGlvbiAoZGF0YSkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIGRlYnVnKCdwb2xsaW5nIGdvdCBkYXRhICVzJywgZGF0YSk7XG4gIHZhciBjYWxsYmFjayA9IGZ1bmN0aW9uIChwYWNrZXQsIGluZGV4LCB0b3RhbCkge1xuICAgIC8vIGlmIGl0cyB0aGUgZmlyc3QgbWVzc2FnZSB3ZSBjb25zaWRlciB0aGUgdHJhbnNwb3J0IG9wZW5cbiAgICBpZiAoJ29wZW5pbmcnID09PSBzZWxmLnJlYWR5U3RhdGUpIHtcbiAgICAgIHNlbGYub25PcGVuKCk7XG4gICAgfVxuXG4gICAgLy8gaWYgaXRzIGEgY2xvc2UgcGFja2V0LCB3ZSBjbG9zZSB0aGUgb25nb2luZyByZXF1ZXN0c1xuICAgIGlmICgnY2xvc2UnID09PSBwYWNrZXQudHlwZSkge1xuICAgICAgc2VsZi5vbkNsb3NlKCk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgLy8gb3RoZXJ3aXNlIGJ5cGFzcyBvbkRhdGEgYW5kIGhhbmRsZSB0aGUgbWVzc2FnZVxuICAgIHNlbGYub25QYWNrZXQocGFja2V0KTtcbiAgfTtcblxuICAvLyBkZWNvZGUgcGF5bG9hZFxuICBwYXJzZXIuZGVjb2RlUGF5bG9hZChkYXRhLCB0aGlzLnNvY2tldC5iaW5hcnlUeXBlLCBjYWxsYmFjayk7XG5cbiAgLy8gaWYgYW4gZXZlbnQgZGlkIG5vdCB0cmlnZ2VyIGNsb3NpbmdcbiAgaWYgKCdjbG9zZWQnICE9PSB0aGlzLnJlYWR5U3RhdGUpIHtcbiAgICAvLyBpZiB3ZSBnb3QgZGF0YSB3ZSdyZSBub3QgcG9sbGluZ1xuICAgIHRoaXMucG9sbGluZyA9IGZhbHNlO1xuICAgIHRoaXMuZW1pdCgncG9sbENvbXBsZXRlJyk7XG5cbiAgICBpZiAoJ29wZW4nID09PSB0aGlzLnJlYWR5U3RhdGUpIHtcbiAgICAgIHRoaXMucG9sbCgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBkZWJ1ZygnaWdub3JpbmcgcG9sbCAtIHRyYW5zcG9ydCBzdGF0ZSBcIiVzXCInLCB0aGlzLnJlYWR5U3RhdGUpO1xuICAgIH1cbiAgfVxufTtcblxuLyoqXG4gKiBGb3IgcG9sbGluZywgc2VuZCBhIGNsb3NlIHBhY2tldC5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5Qb2xsaW5nLnByb3RvdHlwZS5kb0Nsb3NlID0gZnVuY3Rpb24gKCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgZnVuY3Rpb24gY2xvc2UgKCkge1xuICAgIGRlYnVnKCd3cml0aW5nIGNsb3NlIHBhY2tldCcpO1xuICAgIHNlbGYud3JpdGUoW3sgdHlwZTogJ2Nsb3NlJyB9XSk7XG4gIH1cblxuICBpZiAoJ29wZW4nID09PSB0aGlzLnJlYWR5U3RhdGUpIHtcbiAgICBkZWJ1ZygndHJhbnNwb3J0IG9wZW4gLSBjbG9zaW5nJyk7XG4gICAgY2xvc2UoKTtcbiAgfSBlbHNlIHtcbiAgICAvLyBpbiBjYXNlIHdlJ3JlIHRyeWluZyB0byBjbG9zZSB3aGlsZVxuICAgIC8vIGhhbmRzaGFraW5nIGlzIGluIHByb2dyZXNzIChHSC0xNjQpXG4gICAgZGVidWcoJ3RyYW5zcG9ydCBub3Qgb3BlbiAtIGRlZmVycmluZyBjbG9zZScpO1xuICAgIHRoaXMub25jZSgnb3BlbicsIGNsb3NlKTtcbiAgfVxufTtcblxuLyoqXG4gKiBXcml0ZXMgYSBwYWNrZXRzIHBheWxvYWQuXG4gKlxuICogQHBhcmFtIHtBcnJheX0gZGF0YSBwYWNrZXRzXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBkcmFpbiBjYWxsYmFja1xuICogQGFwaSBwcml2YXRlXG4gKi9cblxuUG9sbGluZy5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbiAocGFja2V0cykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHRoaXMud3JpdGFibGUgPSBmYWxzZTtcbiAgdmFyIGNhbGxiYWNrZm4gPSBmdW5jdGlvbiAoKSB7XG4gICAgc2VsZi53cml0YWJsZSA9IHRydWU7XG4gICAgc2VsZi5lbWl0KCdkcmFpbicpO1xuICB9O1xuXG4gIHBhcnNlci5lbmNvZGVQYXlsb2FkKHBhY2tldHMsIHRoaXMuc3VwcG9ydHNCaW5hcnksIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgc2VsZi5kb1dyaXRlKGRhdGEsIGNhbGxiYWNrZm4pO1xuICB9KTtcbn07XG5cbi8qKlxuICogR2VuZXJhdGVzIHVyaSBmb3IgY29ubmVjdGlvbi5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5Qb2xsaW5nLnByb3RvdHlwZS51cmkgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBxdWVyeSA9IHRoaXMucXVlcnkgfHwge307XG4gIHZhciBzY2hlbWEgPSB0aGlzLnNlY3VyZSA/ICdodHRwcycgOiAnaHR0cCc7XG4gIHZhciBwb3J0ID0gJyc7XG5cbiAgLy8gY2FjaGUgYnVzdGluZyBpcyBmb3JjZWRcbiAgaWYgKGZhbHNlICE9PSB0aGlzLnRpbWVzdGFtcFJlcXVlc3RzKSB7XG4gICAgcXVlcnlbdGhpcy50aW1lc3RhbXBQYXJhbV0gPSB5ZWFzdCgpO1xuICB9XG5cbiAgaWYgKCF0aGlzLnN1cHBvcnRzQmluYXJ5ICYmICFxdWVyeS5zaWQpIHtcbiAgICBxdWVyeS5iNjQgPSAxO1xuICB9XG5cbiAgcXVlcnkgPSBwYXJzZXFzLmVuY29kZShxdWVyeSk7XG5cbiAgLy8gYXZvaWQgcG9ydCBpZiBkZWZhdWx0IGZvciBzY2hlbWFcbiAgaWYgKHRoaXMucG9ydCAmJiAoKCdodHRwcycgPT09IHNjaGVtYSAmJiBOdW1iZXIodGhpcy5wb3J0KSAhPT0gNDQzKSB8fFxuICAgICAoJ2h0dHAnID09PSBzY2hlbWEgJiYgTnVtYmVyKHRoaXMucG9ydCkgIT09IDgwKSkpIHtcbiAgICBwb3J0ID0gJzonICsgdGhpcy5wb3J0O1xuICB9XG5cbiAgLy8gcHJlcGVuZCA/IHRvIHF1ZXJ5XG4gIGlmIChxdWVyeS5sZW5ndGgpIHtcbiAgICBxdWVyeSA9ICc/JyArIHF1ZXJ5O1xuICB9XG5cbiAgdmFyIGlwdjYgPSB0aGlzLmhvc3RuYW1lLmluZGV4T2YoJzonKSAhPT0gLTE7XG4gIHJldHVybiBzY2hlbWEgKyAnOi8vJyArIChpcHY2ID8gJ1snICsgdGhpcy5ob3N0bmFtZSArICddJyA6IHRoaXMuaG9zdG5hbWUpICsgcG9ydCArIHRoaXMucGF0aCArIHF1ZXJ5O1xufTtcbiIsIi8qIGdsb2JhbCBhdHRhY2hFdmVudCAqL1xuXG4vKipcbiAqIE1vZHVsZSByZXF1aXJlbWVudHMuXG4gKi9cblxudmFyIFhNTEh0dHBSZXF1ZXN0ID0gcmVxdWlyZSgneG1saHR0cHJlcXVlc3Qtc3NsJyk7XG52YXIgUG9sbGluZyA9IHJlcXVpcmUoJy4vcG9sbGluZycpO1xudmFyIEVtaXR0ZXIgPSByZXF1aXJlKCdjb21wb25lbnQtZW1pdHRlcicpO1xudmFyIGluaGVyaXQgPSByZXF1aXJlKCdjb21wb25lbnQtaW5oZXJpdCcpO1xudmFyIGRlYnVnID0gcmVxdWlyZSgnZGVidWcnKSgnZW5naW5lLmlvLWNsaWVudDpwb2xsaW5nLXhocicpO1xudmFyIGdsb2JhbFRoaXMgPSByZXF1aXJlKCcuLi9nbG9iYWxUaGlzJyk7XG5cbi8qKlxuICogTW9kdWxlIGV4cG9ydHMuXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBYSFI7XG5tb2R1bGUuZXhwb3J0cy5SZXF1ZXN0ID0gUmVxdWVzdDtcblxuLyoqXG4gKiBFbXB0eSBmdW5jdGlvblxuICovXG5cbmZ1bmN0aW9uIGVtcHR5ICgpIHt9XG5cbi8qKlxuICogWEhSIFBvbGxpbmcgY29uc3RydWN0b3IuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9wdHNcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gWEhSIChvcHRzKSB7XG4gIFBvbGxpbmcuY2FsbCh0aGlzLCBvcHRzKTtcbiAgdGhpcy5yZXF1ZXN0VGltZW91dCA9IG9wdHMucmVxdWVzdFRpbWVvdXQ7XG4gIHRoaXMuZXh0cmFIZWFkZXJzID0gb3B0cy5leHRyYUhlYWRlcnM7XG5cbiAgaWYgKHR5cGVvZiBsb2NhdGlvbiAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICB2YXIgaXNTU0wgPSAnaHR0cHM6JyA9PT0gbG9jYXRpb24ucHJvdG9jb2w7XG4gICAgdmFyIHBvcnQgPSBsb2NhdGlvbi5wb3J0O1xuXG4gICAgLy8gc29tZSB1c2VyIGFnZW50cyBoYXZlIGVtcHR5IGBsb2NhdGlvbi5wb3J0YFxuICAgIGlmICghcG9ydCkge1xuICAgICAgcG9ydCA9IGlzU1NMID8gNDQzIDogODA7XG4gICAgfVxuXG4gICAgdGhpcy54ZCA9ICh0eXBlb2YgbG9jYXRpb24gIT09ICd1bmRlZmluZWQnICYmIG9wdHMuaG9zdG5hbWUgIT09IGxvY2F0aW9uLmhvc3RuYW1lKSB8fFxuICAgICAgcG9ydCAhPT0gb3B0cy5wb3J0O1xuICAgIHRoaXMueHMgPSBvcHRzLnNlY3VyZSAhPT0gaXNTU0w7XG4gIH1cbn1cblxuLyoqXG4gKiBJbmhlcml0cyBmcm9tIFBvbGxpbmcuXG4gKi9cblxuaW5oZXJpdChYSFIsIFBvbGxpbmcpO1xuXG4vKipcbiAqIFhIUiBzdXBwb3J0cyBiaW5hcnlcbiAqL1xuXG5YSFIucHJvdG90eXBlLnN1cHBvcnRzQmluYXJ5ID0gdHJ1ZTtcblxuLyoqXG4gKiBDcmVhdGVzIGEgcmVxdWVzdC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbWV0aG9kXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5YSFIucHJvdG90eXBlLnJlcXVlc3QgPSBmdW5jdGlvbiAob3B0cykge1xuICBvcHRzID0gb3B0cyB8fCB7fTtcbiAgb3B0cy51cmkgPSB0aGlzLnVyaSgpO1xuICBvcHRzLnhkID0gdGhpcy54ZDtcbiAgb3B0cy54cyA9IHRoaXMueHM7XG4gIG9wdHMuYWdlbnQgPSB0aGlzLmFnZW50IHx8IGZhbHNlO1xuICBvcHRzLnN1cHBvcnRzQmluYXJ5ID0gdGhpcy5zdXBwb3J0c0JpbmFyeTtcbiAgb3B0cy5lbmFibGVzWERSID0gdGhpcy5lbmFibGVzWERSO1xuICBvcHRzLndpdGhDcmVkZW50aWFscyA9IHRoaXMud2l0aENyZWRlbnRpYWxzO1xuXG4gIC8vIFNTTCBvcHRpb25zIGZvciBOb2RlLmpzIGNsaWVudFxuICBvcHRzLnBmeCA9IHRoaXMucGZ4O1xuICBvcHRzLmtleSA9IHRoaXMua2V5O1xuICBvcHRzLnBhc3NwaHJhc2UgPSB0aGlzLnBhc3NwaHJhc2U7XG4gIG9wdHMuY2VydCA9IHRoaXMuY2VydDtcbiAgb3B0cy5jYSA9IHRoaXMuY2E7XG4gIG9wdHMuY2lwaGVycyA9IHRoaXMuY2lwaGVycztcbiAgb3B0cy5yZWplY3RVbmF1dGhvcml6ZWQgPSB0aGlzLnJlamVjdFVuYXV0aG9yaXplZDtcbiAgb3B0cy5yZXF1ZXN0VGltZW91dCA9IHRoaXMucmVxdWVzdFRpbWVvdXQ7XG5cbiAgLy8gb3RoZXIgb3B0aW9ucyBmb3IgTm9kZS5qcyBjbGllbnRcbiAgb3B0cy5leHRyYUhlYWRlcnMgPSB0aGlzLmV4dHJhSGVhZGVycztcblxuICByZXR1cm4gbmV3IFJlcXVlc3Qob3B0cyk7XG59O1xuXG4vKipcbiAqIFNlbmRzIGRhdGEuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGRhdGEgdG8gc2VuZC5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxlZCB1cG9uIGZsdXNoLlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuWEhSLnByb3RvdHlwZS5kb1dyaXRlID0gZnVuY3Rpb24gKGRhdGEsIGZuKSB7XG4gIHZhciBpc0JpbmFyeSA9IHR5cGVvZiBkYXRhICE9PSAnc3RyaW5nJyAmJiBkYXRhICE9PSB1bmRlZmluZWQ7XG4gIHZhciByZXEgPSB0aGlzLnJlcXVlc3QoeyBtZXRob2Q6ICdQT1NUJywgZGF0YTogZGF0YSwgaXNCaW5hcnk6IGlzQmluYXJ5IH0pO1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHJlcS5vbignc3VjY2VzcycsIGZuKTtcbiAgcmVxLm9uKCdlcnJvcicsIGZ1bmN0aW9uIChlcnIpIHtcbiAgICBzZWxmLm9uRXJyb3IoJ3hociBwb3N0IGVycm9yJywgZXJyKTtcbiAgfSk7XG4gIHRoaXMuc2VuZFhociA9IHJlcTtcbn07XG5cbi8qKlxuICogU3RhcnRzIGEgcG9sbCBjeWNsZS5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5YSFIucHJvdG90eXBlLmRvUG9sbCA9IGZ1bmN0aW9uICgpIHtcbiAgZGVidWcoJ3hociBwb2xsJyk7XG4gIHZhciByZXEgPSB0aGlzLnJlcXVlc3QoKTtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICByZXEub24oJ2RhdGEnLCBmdW5jdGlvbiAoZGF0YSkge1xuICAgIHNlbGYub25EYXRhKGRhdGEpO1xuICB9KTtcbiAgcmVxLm9uKCdlcnJvcicsIGZ1bmN0aW9uIChlcnIpIHtcbiAgICBzZWxmLm9uRXJyb3IoJ3hociBwb2xsIGVycm9yJywgZXJyKTtcbiAgfSk7XG4gIHRoaXMucG9sbFhociA9IHJlcTtcbn07XG5cbi8qKlxuICogUmVxdWVzdCBjb25zdHJ1Y3RvclxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIFJlcXVlc3QgKG9wdHMpIHtcbiAgdGhpcy5tZXRob2QgPSBvcHRzLm1ldGhvZCB8fCAnR0VUJztcbiAgdGhpcy51cmkgPSBvcHRzLnVyaTtcbiAgdGhpcy54ZCA9ICEhb3B0cy54ZDtcbiAgdGhpcy54cyA9ICEhb3B0cy54cztcbiAgdGhpcy5hc3luYyA9IGZhbHNlICE9PSBvcHRzLmFzeW5jO1xuICB0aGlzLmRhdGEgPSB1bmRlZmluZWQgIT09IG9wdHMuZGF0YSA/IG9wdHMuZGF0YSA6IG51bGw7XG4gIHRoaXMuYWdlbnQgPSBvcHRzLmFnZW50O1xuICB0aGlzLmlzQmluYXJ5ID0gb3B0cy5pc0JpbmFyeTtcbiAgdGhpcy5zdXBwb3J0c0JpbmFyeSA9IG9wdHMuc3VwcG9ydHNCaW5hcnk7XG4gIHRoaXMuZW5hYmxlc1hEUiA9IG9wdHMuZW5hYmxlc1hEUjtcbiAgdGhpcy53aXRoQ3JlZGVudGlhbHMgPSBvcHRzLndpdGhDcmVkZW50aWFscztcbiAgdGhpcy5yZXF1ZXN0VGltZW91dCA9IG9wdHMucmVxdWVzdFRpbWVvdXQ7XG5cbiAgLy8gU1NMIG9wdGlvbnMgZm9yIE5vZGUuanMgY2xpZW50XG4gIHRoaXMucGZ4ID0gb3B0cy5wZng7XG4gIHRoaXMua2V5ID0gb3B0cy5rZXk7XG4gIHRoaXMucGFzc3BocmFzZSA9IG9wdHMucGFzc3BocmFzZTtcbiAgdGhpcy5jZXJ0ID0gb3B0cy5jZXJ0O1xuICB0aGlzLmNhID0gb3B0cy5jYTtcbiAgdGhpcy5jaXBoZXJzID0gb3B0cy5jaXBoZXJzO1xuICB0aGlzLnJlamVjdFVuYXV0aG9yaXplZCA9IG9wdHMucmVqZWN0VW5hdXRob3JpemVkO1xuXG4gIC8vIG90aGVyIG9wdGlvbnMgZm9yIE5vZGUuanMgY2xpZW50XG4gIHRoaXMuZXh0cmFIZWFkZXJzID0gb3B0cy5leHRyYUhlYWRlcnM7XG5cbiAgdGhpcy5jcmVhdGUoKTtcbn1cblxuLyoqXG4gKiBNaXggaW4gYEVtaXR0ZXJgLlxuICovXG5cbkVtaXR0ZXIoUmVxdWVzdC5wcm90b3R5cGUpO1xuXG4vKipcbiAqIENyZWF0ZXMgdGhlIFhIUiBvYmplY3QgYW5kIHNlbmRzIHRoZSByZXF1ZXN0LlxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblJlcXVlc3QucHJvdG90eXBlLmNyZWF0ZSA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIG9wdHMgPSB7IGFnZW50OiB0aGlzLmFnZW50LCB4ZG9tYWluOiB0aGlzLnhkLCB4c2NoZW1lOiB0aGlzLnhzLCBlbmFibGVzWERSOiB0aGlzLmVuYWJsZXNYRFIgfTtcblxuICAvLyBTU0wgb3B0aW9ucyBmb3IgTm9kZS5qcyBjbGllbnRcbiAgb3B0cy5wZnggPSB0aGlzLnBmeDtcbiAgb3B0cy5rZXkgPSB0aGlzLmtleTtcbiAgb3B0cy5wYXNzcGhyYXNlID0gdGhpcy5wYXNzcGhyYXNlO1xuICBvcHRzLmNlcnQgPSB0aGlzLmNlcnQ7XG4gIG9wdHMuY2EgPSB0aGlzLmNhO1xuICBvcHRzLmNpcGhlcnMgPSB0aGlzLmNpcGhlcnM7XG4gIG9wdHMucmVqZWN0VW5hdXRob3JpemVkID0gdGhpcy5yZWplY3RVbmF1dGhvcml6ZWQ7XG5cbiAgdmFyIHhociA9IHRoaXMueGhyID0gbmV3IFhNTEh0dHBSZXF1ZXN0KG9wdHMpO1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgdHJ5IHtcbiAgICBkZWJ1ZygneGhyIG9wZW4gJXM6ICVzJywgdGhpcy5tZXRob2QsIHRoaXMudXJpKTtcbiAgICB4aHIub3Blbih0aGlzLm1ldGhvZCwgdGhpcy51cmksIHRoaXMuYXN5bmMpO1xuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5leHRyYUhlYWRlcnMpIHtcbiAgICAgICAgeGhyLnNldERpc2FibGVIZWFkZXJDaGVjayAmJiB4aHIuc2V0RGlzYWJsZUhlYWRlckNoZWNrKHRydWUpO1xuICAgICAgICBmb3IgKHZhciBpIGluIHRoaXMuZXh0cmFIZWFkZXJzKSB7XG4gICAgICAgICAgaWYgKHRoaXMuZXh0cmFIZWFkZXJzLmhhc093blByb3BlcnR5KGkpKSB7XG4gICAgICAgICAgICB4aHIuc2V0UmVxdWVzdEhlYWRlcihpLCB0aGlzLmV4dHJhSGVhZGVyc1tpXSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZSkge31cblxuICAgIGlmICgnUE9TVCcgPT09IHRoaXMubWV0aG9kKSB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAodGhpcy5pc0JpbmFyeSkge1xuICAgICAgICAgIHhoci5zZXRSZXF1ZXN0SGVhZGVyKCdDb250ZW50LXR5cGUnLCAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgeGhyLnNldFJlcXVlc3RIZWFkZXIoJ0NvbnRlbnQtdHlwZScsICd0ZXh0L3BsYWluO2NoYXJzZXQ9VVRGLTgnKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZSkge31cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgeGhyLnNldFJlcXVlc3RIZWFkZXIoJ0FjY2VwdCcsICcqLyonKTtcbiAgICB9IGNhdGNoIChlKSB7fVxuXG4gICAgLy8gaWU2IGNoZWNrXG4gICAgaWYgKCd3aXRoQ3JlZGVudGlhbHMnIGluIHhocikge1xuICAgICAgeGhyLndpdGhDcmVkZW50aWFscyA9IHRoaXMud2l0aENyZWRlbnRpYWxzO1xuICAgIH1cblxuICAgIGlmICh0aGlzLnJlcXVlc3RUaW1lb3V0KSB7XG4gICAgICB4aHIudGltZW91dCA9IHRoaXMucmVxdWVzdFRpbWVvdXQ7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaGFzWERSKCkpIHtcbiAgICAgIHhoci5vbmxvYWQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHNlbGYub25Mb2FkKCk7XG4gICAgICB9O1xuICAgICAgeGhyLm9uZXJyb3IgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHNlbGYub25FcnJvcih4aHIucmVzcG9uc2VUZXh0KTtcbiAgICAgIH07XG4gICAgfSBlbHNlIHtcbiAgICAgIHhoci5vbnJlYWR5c3RhdGVjaGFuZ2UgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICh4aHIucmVhZHlTdGF0ZSA9PT0gMikge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICB2YXIgY29udGVudFR5cGUgPSB4aHIuZ2V0UmVzcG9uc2VIZWFkZXIoJ0NvbnRlbnQtVHlwZScpO1xuICAgICAgICAgICAgaWYgKHNlbGYuc3VwcG9ydHNCaW5hcnkgJiYgY29udGVudFR5cGUgPT09ICdhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0nIHx8IGNvbnRlbnRUeXBlID09PSAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtOyBjaGFyc2V0PVVURi04Jykge1xuICAgICAgICAgICAgICB4aHIucmVzcG9uc2VUeXBlID0gJ2FycmF5YnVmZmVyJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGNhdGNoIChlKSB7fVxuICAgICAgICB9XG4gICAgICAgIGlmICg0ICE9PSB4aHIucmVhZHlTdGF0ZSkgcmV0dXJuO1xuICAgICAgICBpZiAoMjAwID09PSB4aHIuc3RhdHVzIHx8IDEyMjMgPT09IHhoci5zdGF0dXMpIHtcbiAgICAgICAgICBzZWxmLm9uTG9hZCgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIG1ha2Ugc3VyZSB0aGUgYGVycm9yYCBldmVudCBoYW5kbGVyIHRoYXQncyB1c2VyLXNldFxuICAgICAgICAgIC8vIGRvZXMgbm90IHRocm93IGluIHRoZSBzYW1lIHRpY2sgYW5kIGdldHMgY2F1Z2h0IGhlcmVcbiAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHNlbGYub25FcnJvcih0eXBlb2YgeGhyLnN0YXR1cyA9PT0gJ251bWJlcicgPyB4aHIuc3RhdHVzIDogMCk7XG4gICAgICAgICAgfSwgMCk7XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgfVxuXG4gICAgZGVidWcoJ3hociBkYXRhICVzJywgdGhpcy5kYXRhKTtcbiAgICB4aHIuc2VuZCh0aGlzLmRhdGEpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgLy8gTmVlZCB0byBkZWZlciBzaW5jZSAuY3JlYXRlKCkgaXMgY2FsbGVkIGRpcmVjdGx5IGZocm9tIHRoZSBjb25zdHJ1Y3RvclxuICAgIC8vIGFuZCB0aHVzIHRoZSAnZXJyb3InIGV2ZW50IGNhbiBvbmx5IGJlIG9ubHkgYm91bmQgKmFmdGVyKiB0aGlzIGV4Y2VwdGlvblxuICAgIC8vIG9jY3Vycy4gIFRoZXJlZm9yZSwgYWxzbywgd2UgY2Fubm90IHRocm93IGhlcmUgYXQgYWxsLlxuICAgIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xuICAgICAgc2VsZi5vbkVycm9yKGUpO1xuICAgIH0sIDApO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICh0eXBlb2YgZG9jdW1lbnQgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgdGhpcy5pbmRleCA9IFJlcXVlc3QucmVxdWVzdHNDb3VudCsrO1xuICAgIFJlcXVlc3QucmVxdWVzdHNbdGhpcy5pbmRleF0gPSB0aGlzO1xuICB9XG59O1xuXG4vKipcbiAqIENhbGxlZCB1cG9uIHN1Y2Nlc3NmdWwgcmVzcG9uc2UuXG4gKlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUub25TdWNjZXNzID0gZnVuY3Rpb24gKCkge1xuICB0aGlzLmVtaXQoJ3N1Y2Nlc3MnKTtcbiAgdGhpcy5jbGVhbnVwKCk7XG59O1xuXG4vKipcbiAqIENhbGxlZCBpZiB3ZSBoYXZlIGRhdGEuXG4gKlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUub25EYXRhID0gZnVuY3Rpb24gKGRhdGEpIHtcbiAgdGhpcy5lbWl0KCdkYXRhJywgZGF0YSk7XG4gIHRoaXMub25TdWNjZXNzKCk7XG59O1xuXG4vKipcbiAqIENhbGxlZCB1cG9uIGVycm9yLlxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblJlcXVlc3QucHJvdG90eXBlLm9uRXJyb3IgPSBmdW5jdGlvbiAoZXJyKSB7XG4gIHRoaXMuZW1pdCgnZXJyb3InLCBlcnIpO1xuICB0aGlzLmNsZWFudXAodHJ1ZSk7XG59O1xuXG4vKipcbiAqIENsZWFucyB1cCBob3VzZS5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5jbGVhbnVwID0gZnVuY3Rpb24gKGZyb21FcnJvcikge1xuICBpZiAoJ3VuZGVmaW5lZCcgPT09IHR5cGVvZiB0aGlzLnhociB8fCBudWxsID09PSB0aGlzLnhocikge1xuICAgIHJldHVybjtcbiAgfVxuICAvLyB4bWxodHRwcmVxdWVzdFxuICBpZiAodGhpcy5oYXNYRFIoKSkge1xuICAgIHRoaXMueGhyLm9ubG9hZCA9IHRoaXMueGhyLm9uZXJyb3IgPSBlbXB0eTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnhoci5vbnJlYWR5c3RhdGVjaGFuZ2UgPSBlbXB0eTtcbiAgfVxuXG4gIGlmIChmcm9tRXJyb3IpIHtcbiAgICB0cnkge1xuICAgICAgdGhpcy54aHIuYWJvcnQoKTtcbiAgICB9IGNhdGNoIChlKSB7fVxuICB9XG5cbiAgaWYgKHR5cGVvZiBkb2N1bWVudCAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBkZWxldGUgUmVxdWVzdC5yZXF1ZXN0c1t0aGlzLmluZGV4XTtcbiAgfVxuXG4gIHRoaXMueGhyID0gbnVsbDtcbn07XG5cbi8qKlxuICogQ2FsbGVkIHVwb24gbG9hZC5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5vbkxvYWQgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBkYXRhO1xuICB0cnkge1xuICAgIHZhciBjb250ZW50VHlwZTtcbiAgICB0cnkge1xuICAgICAgY29udGVudFR5cGUgPSB0aGlzLnhoci5nZXRSZXNwb25zZUhlYWRlcignQ29udGVudC1UeXBlJyk7XG4gICAgfSBjYXRjaCAoZSkge31cbiAgICBpZiAoY29udGVudFR5cGUgPT09ICdhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0nIHx8IGNvbnRlbnRUeXBlID09PSAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtOyBjaGFyc2V0PVVURi04Jykge1xuICAgICAgZGF0YSA9IHRoaXMueGhyLnJlc3BvbnNlIHx8IHRoaXMueGhyLnJlc3BvbnNlVGV4dDtcbiAgICB9IGVsc2Uge1xuICAgICAgZGF0YSA9IHRoaXMueGhyLnJlc3BvbnNlVGV4dDtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aGlzLm9uRXJyb3IoZSk7XG4gIH1cbiAgaWYgKG51bGwgIT0gZGF0YSkge1xuICAgIHRoaXMub25EYXRhKGRhdGEpO1xuICB9XG59O1xuXG4vKipcbiAqIENoZWNrIGlmIGl0IGhhcyBYRG9tYWluUmVxdWVzdC5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5SZXF1ZXN0LnByb3RvdHlwZS5oYXNYRFIgPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiB0eXBlb2YgWERvbWFpblJlcXVlc3QgIT09ICd1bmRlZmluZWQnICYmICF0aGlzLnhzICYmIHRoaXMuZW5hYmxlc1hEUjtcbn07XG5cbi8qKlxuICogQWJvcnRzIHRoZSByZXF1ZXN0LlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuUmVxdWVzdC5wcm90b3R5cGUuYWJvcnQgPSBmdW5jdGlvbiAoKSB7XG4gIHRoaXMuY2xlYW51cCgpO1xufTtcblxuLyoqXG4gKiBBYm9ydHMgcGVuZGluZyByZXF1ZXN0cyB3aGVuIHVubG9hZGluZyB0aGUgd2luZG93LiBUaGlzIGlzIG5lZWRlZCB0byBwcmV2ZW50XG4gKiBtZW1vcnkgbGVha3MgKGUuZy4gd2hlbiB1c2luZyBJRSkgYW5kIHRvIGVuc3VyZSB0aGF0IG5vIHNwdXJpb3VzIGVycm9yIGlzXG4gKiBlbWl0dGVkLlxuICovXG5cblJlcXVlc3QucmVxdWVzdHNDb3VudCA9IDA7XG5SZXF1ZXN0LnJlcXVlc3RzID0ge307XG5cbmlmICh0eXBlb2YgZG9jdW1lbnQgIT09ICd1bmRlZmluZWQnKSB7XG4gIGlmICh0eXBlb2YgYXR0YWNoRXZlbnQgPT09ICdmdW5jdGlvbicpIHtcbiAgICBhdHRhY2hFdmVudCgnb251bmxvYWQnLCB1bmxvYWRIYW5kbGVyKTtcbiAgfSBlbHNlIGlmICh0eXBlb2YgYWRkRXZlbnRMaXN0ZW5lciA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHZhciB0ZXJtaW5hdGlvbkV2ZW50ID0gJ29ucGFnZWhpZGUnIGluIGdsb2JhbFRoaXMgPyAncGFnZWhpZGUnIDogJ3VubG9hZCc7XG4gICAgYWRkRXZlbnRMaXN0ZW5lcih0ZXJtaW5hdGlvbkV2ZW50LCB1bmxvYWRIYW5kbGVyLCBmYWxzZSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gdW5sb2FkSGFuZGxlciAoKSB7XG4gIGZvciAodmFyIGkgaW4gUmVxdWVzdC5yZXF1ZXN0cykge1xuICAgIGlmIChSZXF1ZXN0LnJlcXVlc3RzLmhhc093blByb3BlcnR5KGkpKSB7XG4gICAgICBSZXF1ZXN0LnJlcXVlc3RzW2ldLmFib3J0KCk7XG4gICAgfVxuICB9XG59XG4iLCIvKipcbiAqIE1vZHVsZSByZXF1aXJlbWVudHMuXG4gKi9cblxudmFyIFBvbGxpbmcgPSByZXF1aXJlKCcuL3BvbGxpbmcnKTtcbnZhciBpbmhlcml0ID0gcmVxdWlyZSgnY29tcG9uZW50LWluaGVyaXQnKTtcbnZhciBnbG9iYWxUaGlzID0gcmVxdWlyZSgnLi4vZ2xvYmFsVGhpcycpO1xuXG4vKipcbiAqIE1vZHVsZSBleHBvcnRzLlxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gSlNPTlBQb2xsaW5nO1xuXG4vKipcbiAqIENhY2hlZCByZWd1bGFyIGV4cHJlc3Npb25zLlxuICovXG5cbnZhciByTmV3bGluZSA9IC9cXG4vZztcbnZhciByRXNjYXBlZE5ld2xpbmUgPSAvXFxcXG4vZztcblxuLyoqXG4gKiBHbG9iYWwgSlNPTlAgY2FsbGJhY2tzLlxuICovXG5cbnZhciBjYWxsYmFja3M7XG5cbi8qKlxuICogTm9vcC5cbiAqL1xuXG5mdW5jdGlvbiBlbXB0eSAoKSB7IH1cblxuLyoqXG4gKiBKU09OUCBQb2xsaW5nIGNvbnN0cnVjdG9yLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRzLlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBKU09OUFBvbGxpbmcgKG9wdHMpIHtcbiAgUG9sbGluZy5jYWxsKHRoaXMsIG9wdHMpO1xuXG4gIHRoaXMucXVlcnkgPSB0aGlzLnF1ZXJ5IHx8IHt9O1xuXG4gIC8vIGRlZmluZSBnbG9iYWwgY2FsbGJhY2tzIGFycmF5IGlmIG5vdCBwcmVzZW50XG4gIC8vIHdlIGRvIHRoaXMgaGVyZSAobGF6aWx5KSB0byBhdm9pZCB1bm5lZWRlZCBnbG9iYWwgcG9sbHV0aW9uXG4gIGlmICghY2FsbGJhY2tzKSB7XG4gICAgLy8gd2UgbmVlZCB0byBjb25zaWRlciBtdWx0aXBsZSBlbmdpbmVzIGluIHRoZSBzYW1lIHBhZ2VcbiAgICBjYWxsYmFja3MgPSBnbG9iYWxUaGlzLl9fX2VpbyA9IChnbG9iYWxUaGlzLl9fX2VpbyB8fCBbXSk7XG4gIH1cblxuICAvLyBjYWxsYmFjayBpZGVudGlmaWVyXG4gIHRoaXMuaW5kZXggPSBjYWxsYmFja3MubGVuZ3RoO1xuXG4gIC8vIGFkZCBjYWxsYmFjayB0byBqc29ucCBnbG9iYWxcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBjYWxsYmFja3MucHVzaChmdW5jdGlvbiAobXNnKSB7XG4gICAgc2VsZi5vbkRhdGEobXNnKTtcbiAgfSk7XG5cbiAgLy8gYXBwZW5kIHRvIHF1ZXJ5IHN0cmluZ1xuICB0aGlzLnF1ZXJ5LmogPSB0aGlzLmluZGV4O1xuXG4gIC8vIHByZXZlbnQgc3B1cmlvdXMgZXJyb3JzIGZyb20gYmVpbmcgZW1pdHRlZCB3aGVuIHRoZSB3aW5kb3cgaXMgdW5sb2FkZWRcbiAgaWYgKHR5cGVvZiBhZGRFdmVudExpc3RlbmVyID09PSAnZnVuY3Rpb24nKSB7XG4gICAgYWRkRXZlbnRMaXN0ZW5lcignYmVmb3JldW5sb2FkJywgZnVuY3Rpb24gKCkge1xuICAgICAgaWYgKHNlbGYuc2NyaXB0KSBzZWxmLnNjcmlwdC5vbmVycm9yID0gZW1wdHk7XG4gICAgfSwgZmFsc2UpO1xuICB9XG59XG5cbi8qKlxuICogSW5oZXJpdHMgZnJvbSBQb2xsaW5nLlxuICovXG5cbmluaGVyaXQoSlNPTlBQb2xsaW5nLCBQb2xsaW5nKTtcblxuLypcbiAqIEpTT05QIG9ubHkgc3VwcG9ydHMgYmluYXJ5IGFzIGJhc2U2NCBlbmNvZGVkIHN0cmluZ3NcbiAqL1xuXG5KU09OUFBvbGxpbmcucHJvdG90eXBlLnN1cHBvcnRzQmluYXJ5ID0gZmFsc2U7XG5cbi8qKlxuICogQ2xvc2VzIHRoZSBzb2NrZXQuXG4gKlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuSlNPTlBQb2xsaW5nLnByb3RvdHlwZS5kb0Nsb3NlID0gZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5zY3JpcHQpIHtcbiAgICB0aGlzLnNjcmlwdC5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKHRoaXMuc2NyaXB0KTtcbiAgICB0aGlzLnNjcmlwdCA9IG51bGw7XG4gIH1cblxuICBpZiAodGhpcy5mb3JtKSB7XG4gICAgdGhpcy5mb3JtLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQodGhpcy5mb3JtKTtcbiAgICB0aGlzLmZvcm0gPSBudWxsO1xuICAgIHRoaXMuaWZyYW1lID0gbnVsbDtcbiAgfVxuXG4gIFBvbGxpbmcucHJvdG90eXBlLmRvQ2xvc2UuY2FsbCh0aGlzKTtcbn07XG5cbi8qKlxuICogU3RhcnRzIGEgcG9sbCBjeWNsZS5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5KU09OUFBvbGxpbmcucHJvdG90eXBlLmRvUG9sbCA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICB2YXIgc2NyaXB0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0Jyk7XG5cbiAgaWYgKHRoaXMuc2NyaXB0KSB7XG4gICAgdGhpcy5zY3JpcHQucGFyZW50Tm9kZS5yZW1vdmVDaGlsZCh0aGlzLnNjcmlwdCk7XG4gICAgdGhpcy5zY3JpcHQgPSBudWxsO1xuICB9XG5cbiAgc2NyaXB0LmFzeW5jID0gdHJ1ZTtcbiAgc2NyaXB0LnNyYyA9IHRoaXMudXJpKCk7XG4gIHNjcmlwdC5vbmVycm9yID0gZnVuY3Rpb24gKGUpIHtcbiAgICBzZWxmLm9uRXJyb3IoJ2pzb25wIHBvbGwgZXJyb3InLCBlKTtcbiAgfTtcblxuICB2YXIgaW5zZXJ0QXQgPSBkb2N1bWVudC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnc2NyaXB0JylbMF07XG4gIGlmIChpbnNlcnRBdCkge1xuICAgIGluc2VydEF0LnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKHNjcmlwdCwgaW5zZXJ0QXQpO1xuICB9IGVsc2Uge1xuICAgIChkb2N1bWVudC5oZWFkIHx8IGRvY3VtZW50LmJvZHkpLmFwcGVuZENoaWxkKHNjcmlwdCk7XG4gIH1cbiAgdGhpcy5zY3JpcHQgPSBzY3JpcHQ7XG5cbiAgdmFyIGlzVUFnZWNrbyA9ICd1bmRlZmluZWQnICE9PSB0eXBlb2YgbmF2aWdhdG9yICYmIC9nZWNrby9pLnRlc3QobmF2aWdhdG9yLnVzZXJBZ2VudCk7XG5cbiAgaWYgKGlzVUFnZWNrbykge1xuICAgIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xuICAgICAgdmFyIGlmcmFtZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2lmcmFtZScpO1xuICAgICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChpZnJhbWUpO1xuICAgICAgZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChpZnJhbWUpO1xuICAgIH0sIDEwMCk7XG4gIH1cbn07XG5cbi8qKlxuICogV3JpdGVzIHdpdGggYSBoaWRkZW4gaWZyYW1lLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBkYXRhIHRvIHNlbmRcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxlZCB1cG9uIGZsdXNoLlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuSlNPTlBQb2xsaW5nLnByb3RvdHlwZS5kb1dyaXRlID0gZnVuY3Rpb24gKGRhdGEsIGZuKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICBpZiAoIXRoaXMuZm9ybSkge1xuICAgIHZhciBmb3JtID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZm9ybScpO1xuICAgIHZhciBhcmVhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGV4dGFyZWEnKTtcbiAgICB2YXIgaWQgPSB0aGlzLmlmcmFtZUlkID0gJ2Vpb19pZnJhbWVfJyArIHRoaXMuaW5kZXg7XG4gICAgdmFyIGlmcmFtZTtcblxuICAgIGZvcm0uY2xhc3NOYW1lID0gJ3NvY2tldGlvJztcbiAgICBmb3JtLnN0eWxlLnBvc2l0aW9uID0gJ2Fic29sdXRlJztcbiAgICBmb3JtLnN0eWxlLnRvcCA9ICctMTAwMHB4JztcbiAgICBmb3JtLnN0eWxlLmxlZnQgPSAnLTEwMDBweCc7XG4gICAgZm9ybS50YXJnZXQgPSBpZDtcbiAgICBmb3JtLm1ldGhvZCA9ICdQT1NUJztcbiAgICBmb3JtLnNldEF0dHJpYnV0ZSgnYWNjZXB0LWNoYXJzZXQnLCAndXRmLTgnKTtcbiAgICBhcmVhLm5hbWUgPSAnZCc7XG4gICAgZm9ybS5hcHBlbmRDaGlsZChhcmVhKTtcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGZvcm0pO1xuXG4gICAgdGhpcy5mb3JtID0gZm9ybTtcbiAgICB0aGlzLmFyZWEgPSBhcmVhO1xuICB9XG5cbiAgdGhpcy5mb3JtLmFjdGlvbiA9IHRoaXMudXJpKCk7XG5cbiAgZnVuY3Rpb24gY29tcGxldGUgKCkge1xuICAgIGluaXRJZnJhbWUoKTtcbiAgICBmbigpO1xuICB9XG5cbiAgZnVuY3Rpb24gaW5pdElmcmFtZSAoKSB7XG4gICAgaWYgKHNlbGYuaWZyYW1lKSB7XG4gICAgICB0cnkge1xuICAgICAgICBzZWxmLmZvcm0ucmVtb3ZlQ2hpbGQoc2VsZi5pZnJhbWUpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBzZWxmLm9uRXJyb3IoJ2pzb25wIHBvbGxpbmcgaWZyYW1lIHJlbW92YWwgZXJyb3InLCBlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgLy8gaWU2IGR5bmFtaWMgaWZyYW1lcyB3aXRoIHRhcmdldD1cIlwiIHN1cHBvcnQgKHRoYW5rcyBDaHJpcyBMYW1iYWNoZXIpXG4gICAgICB2YXIgaHRtbCA9ICc8aWZyYW1lIHNyYz1cImphdmFzY3JpcHQ6MFwiIG5hbWU9XCInICsgc2VsZi5pZnJhbWVJZCArICdcIj4nO1xuICAgICAgaWZyYW1lID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChodG1sKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBpZnJhbWUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpZnJhbWUnKTtcbiAgICAgIGlmcmFtZS5uYW1lID0gc2VsZi5pZnJhbWVJZDtcbiAgICAgIGlmcmFtZS5zcmMgPSAnamF2YXNjcmlwdDowJztcbiAgICB9XG5cbiAgICBpZnJhbWUuaWQgPSBzZWxmLmlmcmFtZUlkO1xuXG4gICAgc2VsZi5mb3JtLmFwcGVuZENoaWxkKGlmcmFtZSk7XG4gICAgc2VsZi5pZnJhbWUgPSBpZnJhbWU7XG4gIH1cblxuICBpbml0SWZyYW1lKCk7XG5cbiAgLy8gZXNjYXBlIFxcbiB0byBwcmV2ZW50IGl0IGZyb20gYmVpbmcgY29udmVydGVkIGludG8gXFxyXFxuIGJ5IHNvbWUgVUFzXG4gIC8vIGRvdWJsZSBlc2NhcGluZyBpcyByZXF1aXJlZCBmb3IgZXNjYXBlZCBuZXcgbGluZXMgYmVjYXVzZSB1bmVzY2FwaW5nIG9mIG5ldyBsaW5lcyBjYW4gYmUgZG9uZSBzYWZlbHkgb24gc2VydmVyLXNpZGVcbiAgZGF0YSA9IGRhdGEucmVwbGFjZShyRXNjYXBlZE5ld2xpbmUsICdcXFxcXFxuJyk7XG4gIHRoaXMuYXJlYS52YWx1ZSA9IGRhdGEucmVwbGFjZShyTmV3bGluZSwgJ1xcXFxuJyk7XG5cbiAgdHJ5IHtcbiAgICB0aGlzLmZvcm0uc3VibWl0KCk7XG4gIH0gY2F0Y2ggKGUpIHt9XG5cbiAgaWYgKHRoaXMuaWZyYW1lLmF0dGFjaEV2ZW50KSB7XG4gICAgdGhpcy5pZnJhbWUub25yZWFkeXN0YXRlY2hhbmdlID0gZnVuY3Rpb24gKCkge1xuICAgICAgaWYgKHNlbGYuaWZyYW1lLnJlYWR5U3RhdGUgPT09ICdjb21wbGV0ZScpIHtcbiAgICAgICAgY29tcGxldGUoKTtcbiAgICAgIH1cbiAgICB9O1xuICB9IGVsc2Uge1xuICAgIHRoaXMuaWZyYW1lLm9ubG9hZCA9IGNvbXBsZXRlO1xuICB9XG59O1xuIiwiZXhwb3J0IGRlZmF1bHQge307XG4iLCIvKipcbiAqIE1vZHVsZSBkZXBlbmRlbmNpZXMuXG4gKi9cblxudmFyIFRyYW5zcG9ydCA9IHJlcXVpcmUoJy4uL3RyYW5zcG9ydCcpO1xudmFyIHBhcnNlciA9IHJlcXVpcmUoJ2VuZ2luZS5pby1wYXJzZXInKTtcbnZhciBwYXJzZXFzID0gcmVxdWlyZSgncGFyc2VxcycpO1xudmFyIGluaGVyaXQgPSByZXF1aXJlKCdjb21wb25lbnQtaW5oZXJpdCcpO1xudmFyIHllYXN0ID0gcmVxdWlyZSgneWVhc3QnKTtcbnZhciBkZWJ1ZyA9IHJlcXVpcmUoJ2RlYnVnJykoJ2VuZ2luZS5pby1jbGllbnQ6d2Vic29ja2V0Jyk7XG5cbnZhciBCcm93c2VyV2ViU29ja2V0LCBOb2RlV2ViU29ja2V0O1xuXG5pZiAodHlwZW9mIFdlYlNvY2tldCAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgQnJvd3NlcldlYlNvY2tldCA9IFdlYlNvY2tldDtcbn0gZWxzZSBpZiAodHlwZW9mIHNlbGYgIT09ICd1bmRlZmluZWQnKSB7XG4gIEJyb3dzZXJXZWJTb2NrZXQgPSBzZWxmLldlYlNvY2tldCB8fCBzZWxmLk1veldlYlNvY2tldDtcbn1cblxuaWYgKHR5cGVvZiB3aW5kb3cgPT09ICd1bmRlZmluZWQnKSB7XG4gIHRyeSB7XG4gICAgTm9kZVdlYlNvY2tldCA9IHJlcXVpcmUoJ3dzJyk7XG4gIH0gY2F0Y2ggKGUpIHsgfVxufVxuXG4vKipcbiAqIEdldCBlaXRoZXIgdGhlIGBXZWJTb2NrZXRgIG9yIGBNb3pXZWJTb2NrZXRgIGdsb2JhbHNcbiAqIGluIHRoZSBicm93c2VyIG9yIHRyeSB0byByZXNvbHZlIFdlYlNvY2tldC1jb21wYXRpYmxlXG4gKiBpbnRlcmZhY2UgZXhwb3NlZCBieSBgd3NgIGZvciBOb2RlLWxpa2UgZW52aXJvbm1lbnQuXG4gKi9cblxudmFyIFdlYlNvY2tldEltcGwgPSBCcm93c2VyV2ViU29ja2V0IHx8IE5vZGVXZWJTb2NrZXQ7XG5cbi8qKlxuICogTW9kdWxlIGV4cG9ydHMuXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBXUztcblxuLyoqXG4gKiBXZWJTb2NrZXQgdHJhbnNwb3J0IGNvbnN0cnVjdG9yLlxuICpcbiAqIEBhcGkge09iamVjdH0gY29ubmVjdGlvbiBvcHRpb25zXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIFdTIChvcHRzKSB7XG4gIHZhciBmb3JjZUJhc2U2NCA9IChvcHRzICYmIG9wdHMuZm9yY2VCYXNlNjQpO1xuICBpZiAoZm9yY2VCYXNlNjQpIHtcbiAgICB0aGlzLnN1cHBvcnRzQmluYXJ5ID0gZmFsc2U7XG4gIH1cbiAgdGhpcy5wZXJNZXNzYWdlRGVmbGF0ZSA9IG9wdHMucGVyTWVzc2FnZURlZmxhdGU7XG4gIHRoaXMudXNpbmdCcm93c2VyV2ViU29ja2V0ID0gQnJvd3NlcldlYlNvY2tldCAmJiAhb3B0cy5mb3JjZU5vZGU7XG4gIHRoaXMucHJvdG9jb2xzID0gb3B0cy5wcm90b2NvbHM7XG4gIGlmICghdGhpcy51c2luZ0Jyb3dzZXJXZWJTb2NrZXQpIHtcbiAgICBXZWJTb2NrZXRJbXBsID0gTm9kZVdlYlNvY2tldDtcbiAgfVxuICBUcmFuc3BvcnQuY2FsbCh0aGlzLCBvcHRzKTtcbn1cblxuLyoqXG4gKiBJbmhlcml0cyBmcm9tIFRyYW5zcG9ydC5cbiAqL1xuXG5pbmhlcml0KFdTLCBUcmFuc3BvcnQpO1xuXG4vKipcbiAqIFRyYW5zcG9ydCBuYW1lLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuV1MucHJvdG90eXBlLm5hbWUgPSAnd2Vic29ja2V0JztcblxuLypcbiAqIFdlYlNvY2tldHMgc3VwcG9ydCBiaW5hcnlcbiAqL1xuXG5XUy5wcm90b3R5cGUuc3VwcG9ydHNCaW5hcnkgPSB0cnVlO1xuXG4vKipcbiAqIE9wZW5zIHNvY2tldC5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5XUy5wcm90b3R5cGUuZG9PcGVuID0gZnVuY3Rpb24gKCkge1xuICBpZiAoIXRoaXMuY2hlY2soKSkge1xuICAgIC8vIGxldCBwcm9iZSB0aW1lb3V0XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdmFyIHVyaSA9IHRoaXMudXJpKCk7XG4gIHZhciBwcm90b2NvbHMgPSB0aGlzLnByb3RvY29scztcblxuICB2YXIgb3B0cyA9IHt9O1xuXG4gIGlmICghdGhpcy5pc1JlYWN0TmF0aXZlKSB7XG4gICAgb3B0cy5hZ2VudCA9IHRoaXMuYWdlbnQ7XG4gICAgb3B0cy5wZXJNZXNzYWdlRGVmbGF0ZSA9IHRoaXMucGVyTWVzc2FnZURlZmxhdGU7XG5cbiAgICAvLyBTU0wgb3B0aW9ucyBmb3IgTm9kZS5qcyBjbGllbnRcbiAgICBvcHRzLnBmeCA9IHRoaXMucGZ4O1xuICAgIG9wdHMua2V5ID0gdGhpcy5rZXk7XG4gICAgb3B0cy5wYXNzcGhyYXNlID0gdGhpcy5wYXNzcGhyYXNlO1xuICAgIG9wdHMuY2VydCA9IHRoaXMuY2VydDtcbiAgICBvcHRzLmNhID0gdGhpcy5jYTtcbiAgICBvcHRzLmNpcGhlcnMgPSB0aGlzLmNpcGhlcnM7XG4gICAgb3B0cy5yZWplY3RVbmF1dGhvcml6ZWQgPSB0aGlzLnJlamVjdFVuYXV0aG9yaXplZDtcbiAgfVxuXG4gIGlmICh0aGlzLmV4dHJhSGVhZGVycykge1xuICAgIG9wdHMuaGVhZGVycyA9IHRoaXMuZXh0cmFIZWFkZXJzO1xuICB9XG4gIGlmICh0aGlzLmxvY2FsQWRkcmVzcykge1xuICAgIG9wdHMubG9jYWxBZGRyZXNzID0gdGhpcy5sb2NhbEFkZHJlc3M7XG4gIH1cblxuICB0cnkge1xuICAgIHRoaXMud3MgPVxuICAgICAgdGhpcy51c2luZ0Jyb3dzZXJXZWJTb2NrZXQgJiYgIXRoaXMuaXNSZWFjdE5hdGl2ZVxuICAgICAgICA/IHByb3RvY29sc1xuICAgICAgICAgID8gbmV3IFdlYlNvY2tldEltcGwodXJpLCBwcm90b2NvbHMpXG4gICAgICAgICAgOiBuZXcgV2ViU29ja2V0SW1wbCh1cmkpXG4gICAgICAgIDogbmV3IFdlYlNvY2tldEltcGwodXJpLCBwcm90b2NvbHMsIG9wdHMpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICByZXR1cm4gdGhpcy5lbWl0KCdlcnJvcicsIGVycik7XG4gIH1cblxuICBpZiAodGhpcy53cy5iaW5hcnlUeXBlID09PSB1bmRlZmluZWQpIHtcbiAgICB0aGlzLnN1cHBvcnRzQmluYXJ5ID0gZmFsc2U7XG4gIH1cblxuICBpZiAodGhpcy53cy5zdXBwb3J0cyAmJiB0aGlzLndzLnN1cHBvcnRzLmJpbmFyeSkge1xuICAgIHRoaXMuc3VwcG9ydHNCaW5hcnkgPSB0cnVlO1xuICAgIHRoaXMud3MuYmluYXJ5VHlwZSA9ICdub2RlYnVmZmVyJztcbiAgfSBlbHNlIHtcbiAgICB0aGlzLndzLmJpbmFyeVR5cGUgPSAnYXJyYXlidWZmZXInO1xuICB9XG5cbiAgdGhpcy5hZGRFdmVudExpc3RlbmVycygpO1xufTtcblxuLyoqXG4gKiBBZGRzIGV2ZW50IGxpc3RlbmVycyB0byB0aGUgc29ja2V0XG4gKlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuV1MucHJvdG90eXBlLmFkZEV2ZW50TGlzdGVuZXJzID0gZnVuY3Rpb24gKCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgdGhpcy53cy5vbm9wZW4gPSBmdW5jdGlvbiAoKSB7XG4gICAgc2VsZi5vbk9wZW4oKTtcbiAgfTtcbiAgdGhpcy53cy5vbmNsb3NlID0gZnVuY3Rpb24gKCkge1xuICAgIHNlbGYub25DbG9zZSgpO1xuICB9O1xuICB0aGlzLndzLm9ubWVzc2FnZSA9IGZ1bmN0aW9uIChldikge1xuICAgIHNlbGYub25EYXRhKGV2LmRhdGEpO1xuICB9O1xuICB0aGlzLndzLm9uZXJyb3IgPSBmdW5jdGlvbiAoZSkge1xuICAgIHNlbGYub25FcnJvcignd2Vic29ja2V0IGVycm9yJywgZSk7XG4gIH07XG59O1xuXG4vKipcbiAqIFdyaXRlcyBkYXRhIHRvIHNvY2tldC5cbiAqXG4gKiBAcGFyYW0ge0FycmF5fSBhcnJheSBvZiBwYWNrZXRzLlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuV1MucHJvdG90eXBlLndyaXRlID0gZnVuY3Rpb24gKHBhY2tldHMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICB0aGlzLndyaXRhYmxlID0gZmFsc2U7XG5cbiAgLy8gZW5jb2RlUGFja2V0IGVmZmljaWVudCBhcyBpdCB1c2VzIFdTIGZyYW1pbmdcbiAgLy8gbm8gbmVlZCBmb3IgZW5jb2RlUGF5bG9hZFxuICB2YXIgdG90YWwgPSBwYWNrZXRzLmxlbmd0aDtcbiAgZm9yICh2YXIgaSA9IDAsIGwgPSB0b3RhbDsgaSA8IGw7IGkrKykge1xuICAgIChmdW5jdGlvbiAocGFja2V0KSB7XG4gICAgICBwYXJzZXIuZW5jb2RlUGFja2V0KHBhY2tldCwgc2VsZi5zdXBwb3J0c0JpbmFyeSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgaWYgKCFzZWxmLnVzaW5nQnJvd3NlcldlYlNvY2tldCkge1xuICAgICAgICAgIC8vIGFsd2F5cyBjcmVhdGUgYSBuZXcgb2JqZWN0IChHSC00MzcpXG4gICAgICAgICAgdmFyIG9wdHMgPSB7fTtcbiAgICAgICAgICBpZiAocGFja2V0Lm9wdGlvbnMpIHtcbiAgICAgICAgICAgIG9wdHMuY29tcHJlc3MgPSBwYWNrZXQub3B0aW9ucy5jb21wcmVzcztcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoc2VsZi5wZXJNZXNzYWdlRGVmbGF0ZSkge1xuICAgICAgICAgICAgdmFyIGxlbiA9ICdzdHJpbmcnID09PSB0eXBlb2YgZGF0YSA/IEJ1ZmZlci5ieXRlTGVuZ3RoKGRhdGEpIDogZGF0YS5sZW5ndGg7XG4gICAgICAgICAgICBpZiAobGVuIDwgc2VsZi5wZXJNZXNzYWdlRGVmbGF0ZS50aHJlc2hvbGQpIHtcbiAgICAgICAgICAgICAgb3B0cy5jb21wcmVzcyA9IGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNvbWV0aW1lcyB0aGUgd2Vic29ja2V0IGhhcyBhbHJlYWR5IGJlZW4gY2xvc2VkIGJ1dCB0aGUgYnJvd3NlciBkaWRuJ3RcbiAgICAgICAgLy8gaGF2ZSBhIGNoYW5jZSBvZiBpbmZvcm1pbmcgdXMgYWJvdXQgaXQgeWV0LCBpbiB0aGF0IGNhc2Ugc2VuZCB3aWxsXG4gICAgICAgIC8vIHRocm93IGFuIGVycm9yXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgaWYgKHNlbGYudXNpbmdCcm93c2VyV2ViU29ja2V0KSB7XG4gICAgICAgICAgICAvLyBUeXBlRXJyb3IgaXMgdGhyb3duIHdoZW4gcGFzc2luZyB0aGUgc2Vjb25kIGFyZ3VtZW50IG9uIFNhZmFyaVxuICAgICAgICAgICAgc2VsZi53cy5zZW5kKGRhdGEpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBzZWxmLndzLnNlbmQoZGF0YSwgb3B0cyk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgZGVidWcoJ3dlYnNvY2tldCBjbG9zZWQgYmVmb3JlIG9uY2xvc2UgZXZlbnQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC0tdG90YWwgfHwgZG9uZSgpO1xuICAgICAgfSk7XG4gICAgfSkocGFja2V0c1tpXSk7XG4gIH1cblxuICBmdW5jdGlvbiBkb25lICgpIHtcbiAgICBzZWxmLmVtaXQoJ2ZsdXNoJyk7XG5cbiAgICAvLyBmYWtlIGRyYWluXG4gICAgLy8gZGVmZXIgdG8gbmV4dCB0aWNrIHRvIGFsbG93IFNvY2tldCB0byBjbGVhciB3cml0ZUJ1ZmZlclxuICAgIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xuICAgICAgc2VsZi53cml0YWJsZSA9IHRydWU7XG4gICAgICBzZWxmLmVtaXQoJ2RyYWluJyk7XG4gICAgfSwgMCk7XG4gIH1cbn07XG5cbi8qKlxuICogQ2FsbGVkIHVwb24gY2xvc2VcbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5XUy5wcm90b3R5cGUub25DbG9zZSA9IGZ1bmN0aW9uICgpIHtcbiAgVHJhbnNwb3J0LnByb3RvdHlwZS5vbkNsb3NlLmNhbGwodGhpcyk7XG59O1xuXG4vKipcbiAqIENsb3NlcyBzb2NrZXQuXG4gKlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuV1MucHJvdG90eXBlLmRvQ2xvc2UgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgdGhpcy53cyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICB0aGlzLndzLmNsb3NlKCk7XG4gIH1cbn07XG5cbi8qKlxuICogR2VuZXJhdGVzIHVyaSBmb3IgY29ubmVjdGlvbi5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5XUy5wcm90b3R5cGUudXJpID0gZnVuY3Rpb24gKCkge1xuICB2YXIgcXVlcnkgPSB0aGlzLnF1ZXJ5IHx8IHt9O1xuICB2YXIgc2NoZW1hID0gdGhpcy5zZWN1cmUgPyAnd3NzJyA6ICd3cyc7XG4gIHZhciBwb3J0ID0gJyc7XG5cbiAgLy8gYXZvaWQgcG9ydCBpZiBkZWZhdWx0IGZvciBzY2hlbWFcbiAgaWYgKHRoaXMucG9ydCAmJiAoKCd3c3MnID09PSBzY2hlbWEgJiYgTnVtYmVyKHRoaXMucG9ydCkgIT09IDQ0MykgfHxcbiAgICAoJ3dzJyA9PT0gc2NoZW1hICYmIE51bWJlcih0aGlzLnBvcnQpICE9PSA4MCkpKSB7XG4gICAgcG9ydCA9ICc6JyArIHRoaXMucG9ydDtcbiAgfVxuXG4gIC8vIGFwcGVuZCB0aW1lc3RhbXAgdG8gVVJJXG4gIGlmICh0aGlzLnRpbWVzdGFtcFJlcXVlc3RzKSB7XG4gICAgcXVlcnlbdGhpcy50aW1lc3RhbXBQYXJhbV0gPSB5ZWFzdCgpO1xuICB9XG5cbiAgLy8gY29tbXVuaWNhdGUgYmluYXJ5IHN1cHBvcnQgY2FwYWJpbGl0aWVzXG4gIGlmICghdGhpcy5zdXBwb3J0c0JpbmFyeSkge1xuICAgIHF1ZXJ5LmI2NCA9IDE7XG4gIH1cblxuICBxdWVyeSA9IHBhcnNlcXMuZW5jb2RlKHF1ZXJ5KTtcblxuICAvLyBwcmVwZW5kID8gdG8gcXVlcnlcbiAgaWYgKHF1ZXJ5Lmxlbmd0aCkge1xuICAgIHF1ZXJ5ID0gJz8nICsgcXVlcnk7XG4gIH1cblxuICB2YXIgaXB2NiA9IHRoaXMuaG9zdG5hbWUuaW5kZXhPZignOicpICE9PSAtMTtcbiAgcmV0dXJuIHNjaGVtYSArICc6Ly8nICsgKGlwdjYgPyAnWycgKyB0aGlzLmhvc3RuYW1lICsgJ10nIDogdGhpcy5ob3N0bmFtZSkgKyBwb3J0ICsgdGhpcy5wYXRoICsgcXVlcnk7XG59O1xuXG4vKipcbiAqIEZlYXR1cmUgZGV0ZWN0aW9uIGZvciBXZWJTb2NrZXQuXG4gKlxuICogQHJldHVybiB7Qm9vbGVhbn0gd2hldGhlciB0aGlzIHRyYW5zcG9ydCBpcyBhdmFpbGFibGUuXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbldTLnByb3RvdHlwZS5jaGVjayA9IGZ1bmN0aW9uICgpIHtcbiAgcmV0dXJuICEhV2ViU29ja2V0SW1wbCAmJiAhKCdfX2luaXRpYWxpemUnIGluIFdlYlNvY2tldEltcGwgJiYgdGhpcy5uYW1lID09PSBXUy5wcm90b3R5cGUubmFtZSk7XG59O1xuIiwiLyoqXG4gKiBNb2R1bGUgZGVwZW5kZW5jaWVzXG4gKi9cblxudmFyIFhNTEh0dHBSZXF1ZXN0ID0gcmVxdWlyZSgneG1saHR0cHJlcXVlc3Qtc3NsJyk7XG52YXIgWEhSID0gcmVxdWlyZSgnLi9wb2xsaW5nLXhocicpO1xudmFyIEpTT05QID0gcmVxdWlyZSgnLi9wb2xsaW5nLWpzb25wJyk7XG52YXIgd2Vic29ja2V0ID0gcmVxdWlyZSgnLi93ZWJzb2NrZXQnKTtcblxuLyoqXG4gKiBFeHBvcnQgdHJhbnNwb3J0cy5cbiAqL1xuXG5leHBvcnRzLnBvbGxpbmcgPSBwb2xsaW5nO1xuZXhwb3J0cy53ZWJzb2NrZXQgPSB3ZWJzb2NrZXQ7XG5cbi8qKlxuICogUG9sbGluZyB0cmFuc3BvcnQgcG9seW1vcnBoaWMgY29uc3RydWN0b3IuXG4gKiBEZWNpZGVzIG9uIHhociB2cyBqc29ucCBiYXNlZCBvbiBmZWF0dXJlIGRldGVjdGlvbi5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBwb2xsaW5nIChvcHRzKSB7XG4gIHZhciB4aHI7XG4gIHZhciB4ZCA9IGZhbHNlO1xuICB2YXIgeHMgPSBmYWxzZTtcbiAgdmFyIGpzb25wID0gZmFsc2UgIT09IG9wdHMuanNvbnA7XG5cbiAgaWYgKHR5cGVvZiBsb2NhdGlvbiAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICB2YXIgaXNTU0wgPSAnaHR0cHM6JyA9PT0gbG9jYXRpb24ucHJvdG9jb2w7XG4gICAgdmFyIHBvcnQgPSBsb2NhdGlvbi5wb3J0O1xuXG4gICAgLy8gc29tZSB1c2VyIGFnZW50cyBoYXZlIGVtcHR5IGBsb2NhdGlvbi5wb3J0YFxuICAgIGlmICghcG9ydCkge1xuICAgICAgcG9ydCA9IGlzU1NMID8gNDQzIDogODA7XG4gICAgfVxuXG4gICAgeGQgPSBvcHRzLmhvc3RuYW1lICE9PSBsb2NhdGlvbi5ob3N0bmFtZSB8fCBwb3J0ICE9PSBvcHRzLnBvcnQ7XG4gICAgeHMgPSBvcHRzLnNlY3VyZSAhPT0gaXNTU0w7XG4gIH1cblxuICBvcHRzLnhkb21haW4gPSB4ZDtcbiAgb3B0cy54c2NoZW1lID0geHM7XG4gIHhociA9IG5ldyBYTUxIdHRwUmVxdWVzdChvcHRzKTtcblxuICBpZiAoJ29wZW4nIGluIHhociAmJiAhb3B0cy5mb3JjZUpTT05QKSB7XG4gICAgcmV0dXJuIG5ldyBYSFIob3B0cyk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKCFqc29ucCkgdGhyb3cgbmV3IEVycm9yKCdKU09OUCBkaXNhYmxlZCcpO1xuICAgIHJldHVybiBuZXcgSlNPTlAob3B0cyk7XG4gIH1cbn1cbiIsIlxudmFyIGluZGV4T2YgPSBbXS5pbmRleE9mO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGFyciwgb2JqKXtcbiAgaWYgKGluZGV4T2YpIHJldHVybiBhcnIuaW5kZXhPZihvYmopO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGFyci5sZW5ndGg7ICsraSkge1xuICAgIGlmIChhcnJbaV0gPT09IG9iaikgcmV0dXJuIGk7XG4gIH1cbiAgcmV0dXJuIC0xO1xufTsiLCIvKipcbiAqIE1vZHVsZSBkZXBlbmRlbmNpZXMuXG4gKi9cblxudmFyIHRyYW5zcG9ydHMgPSByZXF1aXJlKCcuL3RyYW5zcG9ydHMvaW5kZXgnKTtcbnZhciBFbWl0dGVyID0gcmVxdWlyZSgnY29tcG9uZW50LWVtaXR0ZXInKTtcbnZhciBkZWJ1ZyA9IHJlcXVpcmUoJ2RlYnVnJykoJ2VuZ2luZS5pby1jbGllbnQ6c29ja2V0Jyk7XG52YXIgaW5kZXggPSByZXF1aXJlKCdpbmRleG9mJyk7XG52YXIgcGFyc2VyID0gcmVxdWlyZSgnZW5naW5lLmlvLXBhcnNlcicpO1xudmFyIHBhcnNldXJpID0gcmVxdWlyZSgncGFyc2V1cmknKTtcbnZhciBwYXJzZXFzID0gcmVxdWlyZSgncGFyc2VxcycpO1xuXG4vKipcbiAqIE1vZHVsZSBleHBvcnRzLlxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gU29ja2V0O1xuXG4vKipcbiAqIFNvY2tldCBjb25zdHJ1Y3Rvci5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ3xPYmplY3R9IHVyaSBvciBvcHRpb25zXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9uc1xuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBTb2NrZXQgKHVyaSwgb3B0cykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgU29ja2V0KSkgcmV0dXJuIG5ldyBTb2NrZXQodXJpLCBvcHRzKTtcblxuICBvcHRzID0gb3B0cyB8fCB7fTtcblxuICBpZiAodXJpICYmICdvYmplY3QnID09PSB0eXBlb2YgdXJpKSB7XG4gICAgb3B0cyA9IHVyaTtcbiAgICB1cmkgPSBudWxsO1xuICB9XG5cbiAgaWYgKHVyaSkge1xuICAgIHVyaSA9IHBhcnNldXJpKHVyaSk7XG4gICAgb3B0cy5ob3N0bmFtZSA9IHVyaS5ob3N0O1xuICAgIG9wdHMuc2VjdXJlID0gdXJpLnByb3RvY29sID09PSAnaHR0cHMnIHx8IHVyaS5wcm90b2NvbCA9PT0gJ3dzcyc7XG4gICAgb3B0cy5wb3J0ID0gdXJpLnBvcnQ7XG4gICAgaWYgKHVyaS5xdWVyeSkgb3B0cy5xdWVyeSA9IHVyaS5xdWVyeTtcbiAgfSBlbHNlIGlmIChvcHRzLmhvc3QpIHtcbiAgICBvcHRzLmhvc3RuYW1lID0gcGFyc2V1cmkob3B0cy5ob3N0KS5ob3N0O1xuICB9XG5cbiAgdGhpcy5zZWN1cmUgPSBudWxsICE9IG9wdHMuc2VjdXJlID8gb3B0cy5zZWN1cmVcbiAgICA6ICh0eXBlb2YgbG9jYXRpb24gIT09ICd1bmRlZmluZWQnICYmICdodHRwczonID09PSBsb2NhdGlvbi5wcm90b2NvbCk7XG5cbiAgaWYgKG9wdHMuaG9zdG5hbWUgJiYgIW9wdHMucG9ydCkge1xuICAgIC8vIGlmIG5vIHBvcnQgaXMgc3BlY2lmaWVkIG1hbnVhbGx5LCB1c2UgdGhlIHByb3RvY29sIGRlZmF1bHRcbiAgICBvcHRzLnBvcnQgPSB0aGlzLnNlY3VyZSA/ICc0NDMnIDogJzgwJztcbiAgfVxuXG4gIHRoaXMuYWdlbnQgPSBvcHRzLmFnZW50IHx8IGZhbHNlO1xuICB0aGlzLmhvc3RuYW1lID0gb3B0cy5ob3N0bmFtZSB8fFxuICAgICh0eXBlb2YgbG9jYXRpb24gIT09ICd1bmRlZmluZWQnID8gbG9jYXRpb24uaG9zdG5hbWUgOiAnbG9jYWxob3N0Jyk7XG4gIHRoaXMucG9ydCA9IG9wdHMucG9ydCB8fCAodHlwZW9mIGxvY2F0aW9uICE9PSAndW5kZWZpbmVkJyAmJiBsb2NhdGlvbi5wb3J0XG4gICAgICA/IGxvY2F0aW9uLnBvcnRcbiAgICAgIDogKHRoaXMuc2VjdXJlID8gNDQzIDogODApKTtcbiAgdGhpcy5xdWVyeSA9IG9wdHMucXVlcnkgfHwge307XG4gIGlmICgnc3RyaW5nJyA9PT0gdHlwZW9mIHRoaXMucXVlcnkpIHRoaXMucXVlcnkgPSBwYXJzZXFzLmRlY29kZSh0aGlzLnF1ZXJ5KTtcbiAgdGhpcy51cGdyYWRlID0gZmFsc2UgIT09IG9wdHMudXBncmFkZTtcbiAgdGhpcy5wYXRoID0gKG9wdHMucGF0aCB8fCAnL2VuZ2luZS5pbycpLnJlcGxhY2UoL1xcLyQvLCAnJykgKyAnLyc7XG4gIHRoaXMuZm9yY2VKU09OUCA9ICEhb3B0cy5mb3JjZUpTT05QO1xuICB0aGlzLmpzb25wID0gZmFsc2UgIT09IG9wdHMuanNvbnA7XG4gIHRoaXMuZm9yY2VCYXNlNjQgPSAhIW9wdHMuZm9yY2VCYXNlNjQ7XG4gIHRoaXMuZW5hYmxlc1hEUiA9ICEhb3B0cy5lbmFibGVzWERSO1xuICB0aGlzLndpdGhDcmVkZW50aWFscyA9IGZhbHNlICE9PSBvcHRzLndpdGhDcmVkZW50aWFscztcbiAgdGhpcy50aW1lc3RhbXBQYXJhbSA9IG9wdHMudGltZXN0YW1wUGFyYW0gfHwgJ3QnO1xuICB0aGlzLnRpbWVzdGFtcFJlcXVlc3RzID0gb3B0cy50aW1lc3RhbXBSZXF1ZXN0cztcbiAgdGhpcy50cmFuc3BvcnRzID0gb3B0cy50cmFuc3BvcnRzIHx8IFsncG9sbGluZycsICd3ZWJzb2NrZXQnXTtcbiAgdGhpcy50cmFuc3BvcnRPcHRpb25zID0gb3B0cy50cmFuc3BvcnRPcHRpb25zIHx8IHt9O1xuICB0aGlzLnJlYWR5U3RhdGUgPSAnJztcbiAgdGhpcy53cml0ZUJ1ZmZlciA9IFtdO1xuICB0aGlzLnByZXZCdWZmZXJMZW4gPSAwO1xuICB0aGlzLnBvbGljeVBvcnQgPSBvcHRzLnBvbGljeVBvcnQgfHwgODQzO1xuICB0aGlzLnJlbWVtYmVyVXBncmFkZSA9IG9wdHMucmVtZW1iZXJVcGdyYWRlIHx8IGZhbHNlO1xuICB0aGlzLmJpbmFyeVR5cGUgPSBudWxsO1xuICB0aGlzLm9ubHlCaW5hcnlVcGdyYWRlcyA9IG9wdHMub25seUJpbmFyeVVwZ3JhZGVzO1xuICB0aGlzLnBlck1lc3NhZ2VEZWZsYXRlID0gZmFsc2UgIT09IG9wdHMucGVyTWVzc2FnZURlZmxhdGUgPyAob3B0cy5wZXJNZXNzYWdlRGVmbGF0ZSB8fCB7fSkgOiBmYWxzZTtcblxuICBpZiAodHJ1ZSA9PT0gdGhpcy5wZXJNZXNzYWdlRGVmbGF0ZSkgdGhpcy5wZXJNZXNzYWdlRGVmbGF0ZSA9IHt9O1xuICBpZiAodGhpcy5wZXJNZXNzYWdlRGVmbGF0ZSAmJiBudWxsID09IHRoaXMucGVyTWVzc2FnZURlZmxhdGUudGhyZXNob2xkKSB7XG4gICAgdGhpcy5wZXJNZXNzYWdlRGVmbGF0ZS50aHJlc2hvbGQgPSAxMDI0O1xuICB9XG5cbiAgLy8gU1NMIG9wdGlvbnMgZm9yIE5vZGUuanMgY2xpZW50XG4gIHRoaXMucGZ4ID0gb3B0cy5wZnggfHwgbnVsbDtcbiAgdGhpcy5rZXkgPSBvcHRzLmtleSB8fCBudWxsO1xuICB0aGlzLnBhc3NwaHJhc2UgPSBvcHRzLnBhc3NwaHJhc2UgfHwgbnVsbDtcbiAgdGhpcy5jZXJ0ID0gb3B0cy5jZXJ0IHx8IG51bGw7XG4gIHRoaXMuY2EgPSBvcHRzLmNhIHx8IG51bGw7XG4gIHRoaXMuY2lwaGVycyA9IG9wdHMuY2lwaGVycyB8fCBudWxsO1xuICB0aGlzLnJlamVjdFVuYXV0aG9yaXplZCA9IG9wdHMucmVqZWN0VW5hdXRob3JpemVkID09PSB1bmRlZmluZWQgPyB0cnVlIDogb3B0cy5yZWplY3RVbmF1dGhvcml6ZWQ7XG4gIHRoaXMuZm9yY2VOb2RlID0gISFvcHRzLmZvcmNlTm9kZTtcblxuICAvLyBkZXRlY3QgUmVhY3ROYXRpdmUgZW52aXJvbm1lbnRcbiAgdGhpcy5pc1JlYWN0TmF0aXZlID0gKHR5cGVvZiBuYXZpZ2F0b3IgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiBuYXZpZ2F0b3IucHJvZHVjdCA9PT0gJ3N0cmluZycgJiYgbmF2aWdhdG9yLnByb2R1Y3QudG9Mb3dlckNhc2UoKSA9PT0gJ3JlYWN0bmF0aXZlJyk7XG5cbiAgLy8gb3RoZXIgb3B0aW9ucyBmb3IgTm9kZS5qcyBvciBSZWFjdE5hdGl2ZSBjbGllbnRcbiAgaWYgKHR5cGVvZiBzZWxmID09PSAndW5kZWZpbmVkJyB8fCB0aGlzLmlzUmVhY3ROYXRpdmUpIHtcbiAgICBpZiAob3B0cy5leHRyYUhlYWRlcnMgJiYgT2JqZWN0LmtleXMob3B0cy5leHRyYUhlYWRlcnMpLmxlbmd0aCA+IDApIHtcbiAgICAgIHRoaXMuZXh0cmFIZWFkZXJzID0gb3B0cy5leHRyYUhlYWRlcnM7XG4gICAgfVxuXG4gICAgaWYgKG9wdHMubG9jYWxBZGRyZXNzKSB7XG4gICAgICB0aGlzLmxvY2FsQWRkcmVzcyA9IG9wdHMubG9jYWxBZGRyZXNzO1xuICAgIH1cbiAgfVxuXG4gIC8vIHNldCBvbiBoYW5kc2hha2VcbiAgdGhpcy5pZCA9IG51bGw7XG4gIHRoaXMudXBncmFkZXMgPSBudWxsO1xuICB0aGlzLnBpbmdJbnRlcnZhbCA9IG51bGw7XG4gIHRoaXMucGluZ1RpbWVvdXQgPSBudWxsO1xuXG4gIC8vIHNldCBvbiBoZWFydGJlYXRcbiAgdGhpcy5waW5nSW50ZXJ2YWxUaW1lciA9IG51bGw7XG4gIHRoaXMucGluZ1RpbWVvdXRUaW1lciA9IG51bGw7XG5cbiAgdGhpcy5vcGVuKCk7XG59XG5cblNvY2tldC5wcmlvcldlYnNvY2tldFN1Y2Nlc3MgPSBmYWxzZTtcblxuLyoqXG4gKiBNaXggaW4gYEVtaXR0ZXJgLlxuICovXG5cbkVtaXR0ZXIoU29ja2V0LnByb3RvdHlwZSk7XG5cbi8qKlxuICogUHJvdG9jb2wgdmVyc2lvbi5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblNvY2tldC5wcm90b2NvbCA9IHBhcnNlci5wcm90b2NvbDsgLy8gdGhpcyBpcyBhbiBpbnRcblxuLyoqXG4gKiBFeHBvc2UgZGVwcyBmb3IgbGVnYWN5IGNvbXBhdGliaWxpdHlcbiAqIGFuZCBzdGFuZGFsb25lIGJyb3dzZXIgYWNjZXNzLlxuICovXG5cblNvY2tldC5Tb2NrZXQgPSBTb2NrZXQ7XG5Tb2NrZXQuVHJhbnNwb3J0ID0gcmVxdWlyZSgnLi90cmFuc3BvcnQnKTtcblNvY2tldC50cmFuc3BvcnRzID0gcmVxdWlyZSgnLi90cmFuc3BvcnRzL2luZGV4Jyk7XG5Tb2NrZXQucGFyc2VyID0gcmVxdWlyZSgnZW5naW5lLmlvLXBhcnNlcicpO1xuXG4vKipcbiAqIENyZWF0ZXMgdHJhbnNwb3J0IG9mIHRoZSBnaXZlbiB0eXBlLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSB0cmFuc3BvcnQgbmFtZVxuICogQHJldHVybiB7VHJhbnNwb3J0fVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuU29ja2V0LnByb3RvdHlwZS5jcmVhdGVUcmFuc3BvcnQgPSBmdW5jdGlvbiAobmFtZSkge1xuICBkZWJ1ZygnY3JlYXRpbmcgdHJhbnNwb3J0IFwiJXNcIicsIG5hbWUpO1xuICB2YXIgcXVlcnkgPSBjbG9uZSh0aGlzLnF1ZXJ5KTtcblxuICAvLyBhcHBlbmQgZW5naW5lLmlvIHByb3RvY29sIGlkZW50aWZpZXJcbiAgcXVlcnkuRUlPID0gcGFyc2VyLnByb3RvY29sO1xuXG4gIC8vIHRyYW5zcG9ydCBuYW1lXG4gIHF1ZXJ5LnRyYW5zcG9ydCA9IG5hbWU7XG5cbiAgLy8gcGVyLXRyYW5zcG9ydCBvcHRpb25zXG4gIHZhciBvcHRpb25zID0gdGhpcy50cmFuc3BvcnRPcHRpb25zW25hbWVdIHx8IHt9O1xuXG4gIC8vIHNlc3Npb24gaWQgaWYgd2UgYWxyZWFkeSBoYXZlIG9uZVxuICBpZiAodGhpcy5pZCkgcXVlcnkuc2lkID0gdGhpcy5pZDtcblxuICB2YXIgdHJhbnNwb3J0ID0gbmV3IHRyYW5zcG9ydHNbbmFtZV0oe1xuICAgIHF1ZXJ5OiBxdWVyeSxcbiAgICBzb2NrZXQ6IHRoaXMsXG4gICAgYWdlbnQ6IG9wdGlvbnMuYWdlbnQgfHwgdGhpcy5hZ2VudCxcbiAgICBob3N0bmFtZTogb3B0aW9ucy5ob3N0bmFtZSB8fCB0aGlzLmhvc3RuYW1lLFxuICAgIHBvcnQ6IG9wdGlvbnMucG9ydCB8fCB0aGlzLnBvcnQsXG4gICAgc2VjdXJlOiBvcHRpb25zLnNlY3VyZSB8fCB0aGlzLnNlY3VyZSxcbiAgICBwYXRoOiBvcHRpb25zLnBhdGggfHwgdGhpcy5wYXRoLFxuICAgIGZvcmNlSlNPTlA6IG9wdGlvbnMuZm9yY2VKU09OUCB8fCB0aGlzLmZvcmNlSlNPTlAsXG4gICAganNvbnA6IG9wdGlvbnMuanNvbnAgfHwgdGhpcy5qc29ucCxcbiAgICBmb3JjZUJhc2U2NDogb3B0aW9ucy5mb3JjZUJhc2U2NCB8fCB0aGlzLmZvcmNlQmFzZTY0LFxuICAgIGVuYWJsZXNYRFI6IG9wdGlvbnMuZW5hYmxlc1hEUiB8fCB0aGlzLmVuYWJsZXNYRFIsXG4gICAgd2l0aENyZWRlbnRpYWxzOiBvcHRpb25zLndpdGhDcmVkZW50aWFscyB8fCB0aGlzLndpdGhDcmVkZW50aWFscyxcbiAgICB0aW1lc3RhbXBSZXF1ZXN0czogb3B0aW9ucy50aW1lc3RhbXBSZXF1ZXN0cyB8fCB0aGlzLnRpbWVzdGFtcFJlcXVlc3RzLFxuICAgIHRpbWVzdGFtcFBhcmFtOiBvcHRpb25zLnRpbWVzdGFtcFBhcmFtIHx8IHRoaXMudGltZXN0YW1wUGFyYW0sXG4gICAgcG9saWN5UG9ydDogb3B0aW9ucy5wb2xpY3lQb3J0IHx8IHRoaXMucG9saWN5UG9ydCxcbiAgICBwZng6IG9wdGlvbnMucGZ4IHx8IHRoaXMucGZ4LFxuICAgIGtleTogb3B0aW9ucy5rZXkgfHwgdGhpcy5rZXksXG4gICAgcGFzc3BocmFzZTogb3B0aW9ucy5wYXNzcGhyYXNlIHx8IHRoaXMucGFzc3BocmFzZSxcbiAgICBjZXJ0OiBvcHRpb25zLmNlcnQgfHwgdGhpcy5jZXJ0LFxuICAgIGNhOiBvcHRpb25zLmNhIHx8IHRoaXMuY2EsXG4gICAgY2lwaGVyczogb3B0aW9ucy5jaXBoZXJzIHx8IHRoaXMuY2lwaGVycyxcbiAgICByZWplY3RVbmF1dGhvcml6ZWQ6IG9wdGlvbnMucmVqZWN0VW5hdXRob3JpemVkIHx8IHRoaXMucmVqZWN0VW5hdXRob3JpemVkLFxuICAgIHBlck1lc3NhZ2VEZWZsYXRlOiBvcHRpb25zLnBlck1lc3NhZ2VEZWZsYXRlIHx8IHRoaXMucGVyTWVzc2FnZURlZmxhdGUsXG4gICAgZXh0cmFIZWFkZXJzOiBvcHRpb25zLmV4dHJhSGVhZGVycyB8fCB0aGlzLmV4dHJhSGVhZGVycyxcbiAgICBmb3JjZU5vZGU6IG9wdGlvbnMuZm9yY2VOb2RlIHx8IHRoaXMuZm9yY2VOb2RlLFxuICAgIGxvY2FsQWRkcmVzczogb3B0aW9ucy5sb2NhbEFkZHJlc3MgfHwgdGhpcy5sb2NhbEFkZHJlc3MsXG4gICAgcmVxdWVzdFRpbWVvdXQ6IG9wdGlvbnMucmVxdWVzdFRpbWVvdXQgfHwgdGhpcy5yZXF1ZXN0VGltZW91dCxcbiAgICBwcm90b2NvbHM6IG9wdGlvbnMucHJvdG9jb2xzIHx8IHZvaWQgKDApLFxuICAgIGlzUmVhY3ROYXRpdmU6IHRoaXMuaXNSZWFjdE5hdGl2ZVxuICB9KTtcblxuICByZXR1cm4gdHJhbnNwb3J0O1xufTtcblxuZnVuY3Rpb24gY2xvbmUgKG9iaikge1xuICB2YXIgbyA9IHt9O1xuICBmb3IgKHZhciBpIGluIG9iaikge1xuICAgIGlmIChvYmouaGFzT3duUHJvcGVydHkoaSkpIHtcbiAgICAgIG9baV0gPSBvYmpbaV07XG4gICAgfVxuICB9XG4gIHJldHVybiBvO1xufVxuXG4vKipcbiAqIEluaXRpYWxpemVzIHRyYW5zcG9ydCB0byB1c2UgYW5kIHN0YXJ0cyBwcm9iZS5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuU29ja2V0LnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gKCkge1xuICB2YXIgdHJhbnNwb3J0O1xuICBpZiAodGhpcy5yZW1lbWJlclVwZ3JhZGUgJiYgU29ja2V0LnByaW9yV2Vic29ja2V0U3VjY2VzcyAmJiB0aGlzLnRyYW5zcG9ydHMuaW5kZXhPZignd2Vic29ja2V0JykgIT09IC0xKSB7XG4gICAgdHJhbnNwb3J0ID0gJ3dlYnNvY2tldCc7XG4gIH0gZWxzZSBpZiAoMCA9PT0gdGhpcy50cmFuc3BvcnRzLmxlbmd0aCkge1xuICAgIC8vIEVtaXQgZXJyb3Igb24gbmV4dCB0aWNrIHNvIGl0IGNhbiBiZSBsaXN0ZW5lZCB0b1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgIHNlbGYuZW1pdCgnZXJyb3InLCAnTm8gdHJhbnNwb3J0cyBhdmFpbGFibGUnKTtcbiAgICB9LCAwKTtcbiAgICByZXR1cm47XG4gIH0gZWxzZSB7XG4gICAgdHJhbnNwb3J0ID0gdGhpcy50cmFuc3BvcnRzWzBdO1xuICB9XG4gIHRoaXMucmVhZHlTdGF0ZSA9ICdvcGVuaW5nJztcblxuICAvLyBSZXRyeSB3aXRoIHRoZSBuZXh0IHRyYW5zcG9ydCBpZiB0aGUgdHJhbnNwb3J0IGlzIGRpc2FibGVkIChqc29ucDogZmFsc2UpXG4gIHRyeSB7XG4gICAgdHJhbnNwb3J0ID0gdGhpcy5jcmVhdGVUcmFuc3BvcnQodHJhbnNwb3J0KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRoaXMudHJhbnNwb3J0cy5zaGlmdCgpO1xuICAgIHRoaXMub3BlbigpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRyYW5zcG9ydC5vcGVuKCk7XG4gIHRoaXMuc2V0VHJhbnNwb3J0KHRyYW5zcG9ydCk7XG59O1xuXG4vKipcbiAqIFNldHMgdGhlIGN1cnJlbnQgdHJhbnNwb3J0LiBEaXNhYmxlcyB0aGUgZXhpc3Rpbmcgb25lIChpZiBhbnkpLlxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblNvY2tldC5wcm90b3R5cGUuc2V0VHJhbnNwb3J0ID0gZnVuY3Rpb24gKHRyYW5zcG9ydCkge1xuICBkZWJ1Zygnc2V0dGluZyB0cmFuc3BvcnQgJXMnLCB0cmFuc3BvcnQubmFtZSk7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICBpZiAodGhpcy50cmFuc3BvcnQpIHtcbiAgICBkZWJ1ZygnY2xlYXJpbmcgZXhpc3RpbmcgdHJhbnNwb3J0ICVzJywgdGhpcy50cmFuc3BvcnQubmFtZSk7XG4gICAgdGhpcy50cmFuc3BvcnQucmVtb3ZlQWxsTGlzdGVuZXJzKCk7XG4gIH1cblxuICAvLyBzZXQgdXAgdHJhbnNwb3J0XG4gIHRoaXMudHJhbnNwb3J0ID0gdHJhbnNwb3J0O1xuXG4gIC8vIHNldCB1cCB0cmFuc3BvcnQgbGlzdGVuZXJzXG4gIHRyYW5zcG9ydFxuICAub24oJ2RyYWluJywgZnVuY3Rpb24gKCkge1xuICAgIHNlbGYub25EcmFpbigpO1xuICB9KVxuICAub24oJ3BhY2tldCcsIGZ1bmN0aW9uIChwYWNrZXQpIHtcbiAgICBzZWxmLm9uUGFja2V0KHBhY2tldCk7XG4gIH0pXG4gIC5vbignZXJyb3InLCBmdW5jdGlvbiAoZSkge1xuICAgIHNlbGYub25FcnJvcihlKTtcbiAgfSlcbiAgLm9uKCdjbG9zZScsIGZ1bmN0aW9uICgpIHtcbiAgICBzZWxmLm9uQ2xvc2UoJ3RyYW5zcG9ydCBjbG9zZScpO1xuICB9KTtcbn07XG5cbi8qKlxuICogUHJvYmVzIGEgdHJhbnNwb3J0LlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSB0cmFuc3BvcnQgbmFtZVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuU29ja2V0LnByb3RvdHlwZS5wcm9iZSA9IGZ1bmN0aW9uIChuYW1lKSB7XG4gIGRlYnVnKCdwcm9iaW5nIHRyYW5zcG9ydCBcIiVzXCInLCBuYW1lKTtcbiAgdmFyIHRyYW5zcG9ydCA9IHRoaXMuY3JlYXRlVHJhbnNwb3J0KG5hbWUsIHsgcHJvYmU6IDEgfSk7XG4gIHZhciBmYWlsZWQgPSBmYWxzZTtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIFNvY2tldC5wcmlvcldlYnNvY2tldFN1Y2Nlc3MgPSBmYWxzZTtcblxuICBmdW5jdGlvbiBvblRyYW5zcG9ydE9wZW4gKCkge1xuICAgIGlmIChzZWxmLm9ubHlCaW5hcnlVcGdyYWRlcykge1xuICAgICAgdmFyIHVwZ3JhZGVMb3Nlc0JpbmFyeSA9ICF0aGlzLnN1cHBvcnRzQmluYXJ5ICYmIHNlbGYudHJhbnNwb3J0LnN1cHBvcnRzQmluYXJ5O1xuICAgICAgZmFpbGVkID0gZmFpbGVkIHx8IHVwZ3JhZGVMb3Nlc0JpbmFyeTtcbiAgICB9XG4gICAgaWYgKGZhaWxlZCkgcmV0dXJuO1xuXG4gICAgZGVidWcoJ3Byb2JlIHRyYW5zcG9ydCBcIiVzXCIgb3BlbmVkJywgbmFtZSk7XG4gICAgdHJhbnNwb3J0LnNlbmQoW3sgdHlwZTogJ3BpbmcnLCBkYXRhOiAncHJvYmUnIH1dKTtcbiAgICB0cmFuc3BvcnQub25jZSgncGFja2V0JywgZnVuY3Rpb24gKG1zZykge1xuICAgICAgaWYgKGZhaWxlZCkgcmV0dXJuO1xuICAgICAgaWYgKCdwb25nJyA9PT0gbXNnLnR5cGUgJiYgJ3Byb2JlJyA9PT0gbXNnLmRhdGEpIHtcbiAgICAgICAgZGVidWcoJ3Byb2JlIHRyYW5zcG9ydCBcIiVzXCIgcG9uZycsIG5hbWUpO1xuICAgICAgICBzZWxmLnVwZ3JhZGluZyA9IHRydWU7XG4gICAgICAgIHNlbGYuZW1pdCgndXBncmFkaW5nJywgdHJhbnNwb3J0KTtcbiAgICAgICAgaWYgKCF0cmFuc3BvcnQpIHJldHVybjtcbiAgICAgICAgU29ja2V0LnByaW9yV2Vic29ja2V0U3VjY2VzcyA9ICd3ZWJzb2NrZXQnID09PSB0cmFuc3BvcnQubmFtZTtcblxuICAgICAgICBkZWJ1ZygncGF1c2luZyBjdXJyZW50IHRyYW5zcG9ydCBcIiVzXCInLCBzZWxmLnRyYW5zcG9ydC5uYW1lKTtcbiAgICAgICAgc2VsZi50cmFuc3BvcnQucGF1c2UoZnVuY3Rpb24gKCkge1xuICAgICAgICAgIGlmIChmYWlsZWQpIHJldHVybjtcbiAgICAgICAgICBpZiAoJ2Nsb3NlZCcgPT09IHNlbGYucmVhZHlTdGF0ZSkgcmV0dXJuO1xuICAgICAgICAgIGRlYnVnKCdjaGFuZ2luZyB0cmFuc3BvcnQgYW5kIHNlbmRpbmcgdXBncmFkZSBwYWNrZXQnKTtcblxuICAgICAgICAgIGNsZWFudXAoKTtcblxuICAgICAgICAgIHNlbGYuc2V0VHJhbnNwb3J0KHRyYW5zcG9ydCk7XG4gICAgICAgICAgdHJhbnNwb3J0LnNlbmQoW3sgdHlwZTogJ3VwZ3JhZGUnIH1dKTtcbiAgICAgICAgICBzZWxmLmVtaXQoJ3VwZ3JhZGUnLCB0cmFuc3BvcnQpO1xuICAgICAgICAgIHRyYW5zcG9ydCA9IG51bGw7XG4gICAgICAgICAgc2VsZi51cGdyYWRpbmcgPSBmYWxzZTtcbiAgICAgICAgICBzZWxmLmZsdXNoKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGVidWcoJ3Byb2JlIHRyYW5zcG9ydCBcIiVzXCIgZmFpbGVkJywgbmFtZSk7XG4gICAgICAgIHZhciBlcnIgPSBuZXcgRXJyb3IoJ3Byb2JlIGVycm9yJyk7XG4gICAgICAgIGVyci50cmFuc3BvcnQgPSB0cmFuc3BvcnQubmFtZTtcbiAgICAgICAgc2VsZi5lbWl0KCd1cGdyYWRlRXJyb3InLCBlcnIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gZnJlZXplVHJhbnNwb3J0ICgpIHtcbiAgICBpZiAoZmFpbGVkKSByZXR1cm47XG5cbiAgICAvLyBBbnkgY2FsbGJhY2sgY2FsbGVkIGJ5IHRyYW5zcG9ydCBzaG91bGQgYmUgaWdub3JlZCBzaW5jZSBub3dcbiAgICBmYWlsZWQgPSB0cnVlO1xuXG4gICAgY2xlYW51cCgpO1xuXG4gICAgdHJhbnNwb3J0LmNsb3NlKCk7XG4gICAgdHJhbnNwb3J0ID0gbnVsbDtcbiAgfVxuXG4gIC8vIEhhbmRsZSBhbnkgZXJyb3IgdGhhdCBoYXBwZW5zIHdoaWxlIHByb2JpbmdcbiAgZnVuY3Rpb24gb25lcnJvciAoZXJyKSB7XG4gICAgdmFyIGVycm9yID0gbmV3IEVycm9yKCdwcm9iZSBlcnJvcjogJyArIGVycik7XG4gICAgZXJyb3IudHJhbnNwb3J0ID0gdHJhbnNwb3J0Lm5hbWU7XG5cbiAgICBmcmVlemVUcmFuc3BvcnQoKTtcblxuICAgIGRlYnVnKCdwcm9iZSB0cmFuc3BvcnQgXCIlc1wiIGZhaWxlZCBiZWNhdXNlIG9mIGVycm9yOiAlcycsIG5hbWUsIGVycik7XG5cbiAgICBzZWxmLmVtaXQoJ3VwZ3JhZGVFcnJvcicsIGVycm9yKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIG9uVHJhbnNwb3J0Q2xvc2UgKCkge1xuICAgIG9uZXJyb3IoJ3RyYW5zcG9ydCBjbG9zZWQnKTtcbiAgfVxuXG4gIC8vIFdoZW4gdGhlIHNvY2tldCBpcyBjbG9zZWQgd2hpbGUgd2UncmUgcHJvYmluZ1xuICBmdW5jdGlvbiBvbmNsb3NlICgpIHtcbiAgICBvbmVycm9yKCdzb2NrZXQgY2xvc2VkJyk7XG4gIH1cblxuICAvLyBXaGVuIHRoZSBzb2NrZXQgaXMgdXBncmFkZWQgd2hpbGUgd2UncmUgcHJvYmluZ1xuICBmdW5jdGlvbiBvbnVwZ3JhZGUgKHRvKSB7XG4gICAgaWYgKHRyYW5zcG9ydCAmJiB0by5uYW1lICE9PSB0cmFuc3BvcnQubmFtZSkge1xuICAgICAgZGVidWcoJ1wiJXNcIiB3b3JrcyAtIGFib3J0aW5nIFwiJXNcIicsIHRvLm5hbWUsIHRyYW5zcG9ydC5uYW1lKTtcbiAgICAgIGZyZWV6ZVRyYW5zcG9ydCgpO1xuICAgIH1cbiAgfVxuXG4gIC8vIFJlbW92ZSBhbGwgbGlzdGVuZXJzIG9uIHRoZSB0cmFuc3BvcnQgYW5kIG9uIHNlbGZcbiAgZnVuY3Rpb24gY2xlYW51cCAoKSB7XG4gICAgdHJhbnNwb3J0LnJlbW92ZUxpc3RlbmVyKCdvcGVuJywgb25UcmFuc3BvcnRPcGVuKTtcbiAgICB0cmFuc3BvcnQucmVtb3ZlTGlzdGVuZXIoJ2Vycm9yJywgb25lcnJvcik7XG4gICAgdHJhbnNwb3J0LnJlbW92ZUxpc3RlbmVyKCdjbG9zZScsIG9uVHJhbnNwb3J0Q2xvc2UpO1xuICAgIHNlbGYucmVtb3ZlTGlzdGVuZXIoJ2Nsb3NlJywgb25jbG9zZSk7XG4gICAgc2VsZi5yZW1vdmVMaXN0ZW5lcigndXBncmFkaW5nJywgb251cGdyYWRlKTtcbiAgfVxuXG4gIHRyYW5zcG9ydC5vbmNlKCdvcGVuJywgb25UcmFuc3BvcnRPcGVuKTtcbiAgdHJhbnNwb3J0Lm9uY2UoJ2Vycm9yJywgb25lcnJvcik7XG4gIHRyYW5zcG9ydC5vbmNlKCdjbG9zZScsIG9uVHJhbnNwb3J0Q2xvc2UpO1xuXG4gIHRoaXMub25jZSgnY2xvc2UnLCBvbmNsb3NlKTtcbiAgdGhpcy5vbmNlKCd1cGdyYWRpbmcnLCBvbnVwZ3JhZGUpO1xuXG4gIHRyYW5zcG9ydC5vcGVuKCk7XG59O1xuXG4vKipcbiAqIENhbGxlZCB3aGVuIGNvbm5lY3Rpb24gaXMgZGVlbWVkIG9wZW4uXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5Tb2NrZXQucHJvdG90eXBlLm9uT3BlbiA9IGZ1bmN0aW9uICgpIHtcbiAgZGVidWcoJ3NvY2tldCBvcGVuJyk7XG4gIHRoaXMucmVhZHlTdGF0ZSA9ICdvcGVuJztcbiAgU29ja2V0LnByaW9yV2Vic29ja2V0U3VjY2VzcyA9ICd3ZWJzb2NrZXQnID09PSB0aGlzLnRyYW5zcG9ydC5uYW1lO1xuICB0aGlzLmVtaXQoJ29wZW4nKTtcbiAgdGhpcy5mbHVzaCgpO1xuXG4gIC8vIHdlIGNoZWNrIGZvciBgcmVhZHlTdGF0ZWAgaW4gY2FzZSBhbiBgb3BlbmBcbiAgLy8gbGlzdGVuZXIgYWxyZWFkeSBjbG9zZWQgdGhlIHNvY2tldFxuICBpZiAoJ29wZW4nID09PSB0aGlzLnJlYWR5U3RhdGUgJiYgdGhpcy51cGdyYWRlICYmIHRoaXMudHJhbnNwb3J0LnBhdXNlKSB7XG4gICAgZGVidWcoJ3N0YXJ0aW5nIHVwZ3JhZGUgcHJvYmVzJyk7XG4gICAgZm9yICh2YXIgaSA9IDAsIGwgPSB0aGlzLnVwZ3JhZGVzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgdGhpcy5wcm9iZSh0aGlzLnVwZ3JhZGVzW2ldKTtcbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogSGFuZGxlcyBhIHBhY2tldC5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5Tb2NrZXQucHJvdG90eXBlLm9uUGFja2V0ID0gZnVuY3Rpb24gKHBhY2tldCkge1xuICBpZiAoJ29wZW5pbmcnID09PSB0aGlzLnJlYWR5U3RhdGUgfHwgJ29wZW4nID09PSB0aGlzLnJlYWR5U3RhdGUgfHxcbiAgICAgICdjbG9zaW5nJyA9PT0gdGhpcy5yZWFkeVN0YXRlKSB7XG4gICAgZGVidWcoJ3NvY2tldCByZWNlaXZlOiB0eXBlIFwiJXNcIiwgZGF0YSBcIiVzXCInLCBwYWNrZXQudHlwZSwgcGFja2V0LmRhdGEpO1xuXG4gICAgdGhpcy5lbWl0KCdwYWNrZXQnLCBwYWNrZXQpO1xuXG4gICAgLy8gU29ja2V0IGlzIGxpdmUgLSBhbnkgcGFja2V0IGNvdW50c1xuICAgIHRoaXMuZW1pdCgnaGVhcnRiZWF0Jyk7XG5cbiAgICBzd2l0Y2ggKHBhY2tldC50eXBlKSB7XG4gICAgICBjYXNlICdvcGVuJzpcbiAgICAgICAgdGhpcy5vbkhhbmRzaGFrZShKU09OLnBhcnNlKHBhY2tldC5kYXRhKSk7XG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlICdwb25nJzpcbiAgICAgICAgdGhpcy5zZXRQaW5nKCk7XG4gICAgICAgIHRoaXMuZW1pdCgncG9uZycpO1xuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSAnZXJyb3InOlxuICAgICAgICB2YXIgZXJyID0gbmV3IEVycm9yKCdzZXJ2ZXIgZXJyb3InKTtcbiAgICAgICAgZXJyLmNvZGUgPSBwYWNrZXQuZGF0YTtcbiAgICAgICAgdGhpcy5vbkVycm9yKGVycik7XG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlICdtZXNzYWdlJzpcbiAgICAgICAgdGhpcy5lbWl0KCdkYXRhJywgcGFja2V0LmRhdGEpO1xuICAgICAgICB0aGlzLmVtaXQoJ21lc3NhZ2UnLCBwYWNrZXQuZGF0YSk7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBkZWJ1ZygncGFja2V0IHJlY2VpdmVkIHdpdGggc29ja2V0IHJlYWR5U3RhdGUgXCIlc1wiJywgdGhpcy5yZWFkeVN0YXRlKTtcbiAgfVxufTtcblxuLyoqXG4gKiBDYWxsZWQgdXBvbiBoYW5kc2hha2UgY29tcGxldGlvbi5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gaGFuZHNoYWtlIG9ialxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuU29ja2V0LnByb3RvdHlwZS5vbkhhbmRzaGFrZSA9IGZ1bmN0aW9uIChkYXRhKSB7XG4gIHRoaXMuZW1pdCgnaGFuZHNoYWtlJywgZGF0YSk7XG4gIHRoaXMuaWQgPSBkYXRhLnNpZDtcbiAgdGhpcy50cmFuc3BvcnQucXVlcnkuc2lkID0gZGF0YS5zaWQ7XG4gIHRoaXMudXBncmFkZXMgPSB0aGlzLmZpbHRlclVwZ3JhZGVzKGRhdGEudXBncmFkZXMpO1xuICB0aGlzLnBpbmdJbnRlcnZhbCA9IGRhdGEucGluZ0ludGVydmFsO1xuICB0aGlzLnBpbmdUaW1lb3V0ID0gZGF0YS5waW5nVGltZW91dDtcbiAgdGhpcy5vbk9wZW4oKTtcbiAgLy8gSW4gY2FzZSBvcGVuIGhhbmRsZXIgY2xvc2VzIHNvY2tldFxuICBpZiAoJ2Nsb3NlZCcgPT09IHRoaXMucmVhZHlTdGF0ZSkgcmV0dXJuO1xuICB0aGlzLnNldFBpbmcoKTtcblxuICAvLyBQcm9sb25nIGxpdmVuZXNzIG9mIHNvY2tldCBvbiBoZWFydGJlYXRcbiAgdGhpcy5yZW1vdmVMaXN0ZW5lcignaGVhcnRiZWF0JywgdGhpcy5vbkhlYXJ0YmVhdCk7XG4gIHRoaXMub24oJ2hlYXJ0YmVhdCcsIHRoaXMub25IZWFydGJlYXQpO1xufTtcblxuLyoqXG4gKiBSZXNldHMgcGluZyB0aW1lb3V0LlxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblNvY2tldC5wcm90b3R5cGUub25IZWFydGJlYXQgPSBmdW5jdGlvbiAodGltZW91dCkge1xuICBjbGVhclRpbWVvdXQodGhpcy5waW5nVGltZW91dFRpbWVyKTtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBzZWxmLnBpbmdUaW1lb3V0VGltZXIgPSBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoJ2Nsb3NlZCcgPT09IHNlbGYucmVhZHlTdGF0ZSkgcmV0dXJuO1xuICAgIHNlbGYub25DbG9zZSgncGluZyB0aW1lb3V0Jyk7XG4gIH0sIHRpbWVvdXQgfHwgKHNlbGYucGluZ0ludGVydmFsICsgc2VsZi5waW5nVGltZW91dCkpO1xufTtcblxuLyoqXG4gKiBQaW5ncyBzZXJ2ZXIgZXZlcnkgYHRoaXMucGluZ0ludGVydmFsYCBhbmQgZXhwZWN0cyByZXNwb25zZVxuICogd2l0aGluIGB0aGlzLnBpbmdUaW1lb3V0YCBvciBjbG9zZXMgY29ubmVjdGlvbi5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5Tb2NrZXQucHJvdG90eXBlLnNldFBpbmcgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgY2xlYXJUaW1lb3V0KHNlbGYucGluZ0ludGVydmFsVGltZXIpO1xuICBzZWxmLnBpbmdJbnRlcnZhbFRpbWVyID0gc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XG4gICAgZGVidWcoJ3dyaXRpbmcgcGluZyBwYWNrZXQgLSBleHBlY3RpbmcgcG9uZyB3aXRoaW4gJXNtcycsIHNlbGYucGluZ1RpbWVvdXQpO1xuICAgIHNlbGYucGluZygpO1xuICAgIHNlbGYub25IZWFydGJlYXQoc2VsZi5waW5nVGltZW91dCk7XG4gIH0sIHNlbGYucGluZ0ludGVydmFsKTtcbn07XG5cbi8qKlxuKiBTZW5kcyBhIHBpbmcgcGFja2V0LlxuKlxuKiBAYXBpIHByaXZhdGVcbiovXG5cblNvY2tldC5wcm90b3R5cGUucGluZyA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICB0aGlzLnNlbmRQYWNrZXQoJ3BpbmcnLCBmdW5jdGlvbiAoKSB7XG4gICAgc2VsZi5lbWl0KCdwaW5nJyk7XG4gIH0pO1xufTtcblxuLyoqXG4gKiBDYWxsZWQgb24gYGRyYWluYCBldmVudFxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblNvY2tldC5wcm90b3R5cGUub25EcmFpbiA9IGZ1bmN0aW9uICgpIHtcbiAgdGhpcy53cml0ZUJ1ZmZlci5zcGxpY2UoMCwgdGhpcy5wcmV2QnVmZmVyTGVuKTtcblxuICAvLyBzZXR0aW5nIHByZXZCdWZmZXJMZW4gPSAwIGlzIHZlcnkgaW1wb3J0YW50XG4gIC8vIGZvciBleGFtcGxlLCB3aGVuIHVwZ3JhZGluZywgdXBncmFkZSBwYWNrZXQgaXMgc2VudCBvdmVyLFxuICAvLyBhbmQgYSBub256ZXJvIHByZXZCdWZmZXJMZW4gY291bGQgY2F1c2UgcHJvYmxlbXMgb24gYGRyYWluYFxuICB0aGlzLnByZXZCdWZmZXJMZW4gPSAwO1xuXG4gIGlmICgwID09PSB0aGlzLndyaXRlQnVmZmVyLmxlbmd0aCkge1xuICAgIHRoaXMuZW1pdCgnZHJhaW4nKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmZsdXNoKCk7XG4gIH1cbn07XG5cbi8qKlxuICogRmx1c2ggd3JpdGUgYnVmZmVycy5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5Tb2NrZXQucHJvdG90eXBlLmZsdXNoID0gZnVuY3Rpb24gKCkge1xuICBpZiAoJ2Nsb3NlZCcgIT09IHRoaXMucmVhZHlTdGF0ZSAmJiB0aGlzLnRyYW5zcG9ydC53cml0YWJsZSAmJlxuICAgICF0aGlzLnVwZ3JhZGluZyAmJiB0aGlzLndyaXRlQnVmZmVyLmxlbmd0aCkge1xuICAgIGRlYnVnKCdmbHVzaGluZyAlZCBwYWNrZXRzIGluIHNvY2tldCcsIHRoaXMud3JpdGVCdWZmZXIubGVuZ3RoKTtcbiAgICB0aGlzLnRyYW5zcG9ydC5zZW5kKHRoaXMud3JpdGVCdWZmZXIpO1xuICAgIC8vIGtlZXAgdHJhY2sgb2YgY3VycmVudCBsZW5ndGggb2Ygd3JpdGVCdWZmZXJcbiAgICAvLyBzcGxpY2Ugd3JpdGVCdWZmZXIgYW5kIGNhbGxiYWNrQnVmZmVyIG9uIGBkcmFpbmBcbiAgICB0aGlzLnByZXZCdWZmZXJMZW4gPSB0aGlzLndyaXRlQnVmZmVyLmxlbmd0aDtcbiAgICB0aGlzLmVtaXQoJ2ZsdXNoJyk7XG4gIH1cbn07XG5cbi8qKlxuICogU2VuZHMgYSBtZXNzYWdlLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2sgZnVuY3Rpb24uXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucy5cbiAqIEByZXR1cm4ge1NvY2tldH0gZm9yIGNoYWluaW5nLlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5Tb2NrZXQucHJvdG90eXBlLndyaXRlID1cblNvY2tldC5wcm90b3R5cGUuc2VuZCA9IGZ1bmN0aW9uIChtc2csIG9wdGlvbnMsIGZuKSB7XG4gIHRoaXMuc2VuZFBhY2tldCgnbWVzc2FnZScsIG1zZywgb3B0aW9ucywgZm4pO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogU2VuZHMgYSBwYWNrZXQuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHBhY2tldCB0eXBlLlxuICogQHBhcmFtIHtTdHJpbmd9IGRhdGEuXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucy5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIGZ1bmN0aW9uLlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuU29ja2V0LnByb3RvdHlwZS5zZW5kUGFja2V0ID0gZnVuY3Rpb24gKHR5cGUsIGRhdGEsIG9wdGlvbnMsIGZuKSB7XG4gIGlmICgnZnVuY3Rpb24nID09PSB0eXBlb2YgZGF0YSkge1xuICAgIGZuID0gZGF0YTtcbiAgICBkYXRhID0gdW5kZWZpbmVkO1xuICB9XG5cbiAgaWYgKCdmdW5jdGlvbicgPT09IHR5cGVvZiBvcHRpb25zKSB7XG4gICAgZm4gPSBvcHRpb25zO1xuICAgIG9wdGlvbnMgPSBudWxsO1xuICB9XG5cbiAgaWYgKCdjbG9zaW5nJyA9PT0gdGhpcy5yZWFkeVN0YXRlIHx8ICdjbG9zZWQnID09PSB0aGlzLnJlYWR5U3RhdGUpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgb3B0aW9ucy5jb21wcmVzcyA9IGZhbHNlICE9PSBvcHRpb25zLmNvbXByZXNzO1xuXG4gIHZhciBwYWNrZXQgPSB7XG4gICAgdHlwZTogdHlwZSxcbiAgICBkYXRhOiBkYXRhLFxuICAgIG9wdGlvbnM6IG9wdGlvbnNcbiAgfTtcbiAgdGhpcy5lbWl0KCdwYWNrZXRDcmVhdGUnLCBwYWNrZXQpO1xuICB0aGlzLndyaXRlQnVmZmVyLnB1c2gocGFja2V0KTtcbiAgaWYgKGZuKSB0aGlzLm9uY2UoJ2ZsdXNoJywgZm4pO1xuICB0aGlzLmZsdXNoKCk7XG59O1xuXG4vKipcbiAqIENsb3NlcyB0aGUgY29ubmVjdGlvbi5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5Tb2NrZXQucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24gKCkge1xuICBpZiAoJ29wZW5pbmcnID09PSB0aGlzLnJlYWR5U3RhdGUgfHwgJ29wZW4nID09PSB0aGlzLnJlYWR5U3RhdGUpIHtcbiAgICB0aGlzLnJlYWR5U3RhdGUgPSAnY2xvc2luZyc7XG5cbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICBpZiAodGhpcy53cml0ZUJ1ZmZlci5sZW5ndGgpIHtcbiAgICAgIHRoaXMub25jZSgnZHJhaW4nLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICh0aGlzLnVwZ3JhZGluZykge1xuICAgICAgICAgIHdhaXRGb3JVcGdyYWRlKCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY2xvc2UoKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSBlbHNlIGlmICh0aGlzLnVwZ3JhZGluZykge1xuICAgICAgd2FpdEZvclVwZ3JhZGUoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY2xvc2UoKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBjbG9zZSAoKSB7XG4gICAgc2VsZi5vbkNsb3NlKCdmb3JjZWQgY2xvc2UnKTtcbiAgICBkZWJ1Zygnc29ja2V0IGNsb3NpbmcgLSB0ZWxsaW5nIHRyYW5zcG9ydCB0byBjbG9zZScpO1xuICAgIHNlbGYudHJhbnNwb3J0LmNsb3NlKCk7XG4gIH1cblxuICBmdW5jdGlvbiBjbGVhbnVwQW5kQ2xvc2UgKCkge1xuICAgIHNlbGYucmVtb3ZlTGlzdGVuZXIoJ3VwZ3JhZGUnLCBjbGVhbnVwQW5kQ2xvc2UpO1xuICAgIHNlbGYucmVtb3ZlTGlzdGVuZXIoJ3VwZ3JhZGVFcnJvcicsIGNsZWFudXBBbmRDbG9zZSk7XG4gICAgY2xvc2UoKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHdhaXRGb3JVcGdyYWRlICgpIHtcbiAgICAvLyB3YWl0IGZvciB1cGdyYWRlIHRvIGZpbmlzaCBzaW5jZSB3ZSBjYW4ndCBzZW5kIHBhY2tldHMgd2hpbGUgcGF1c2luZyBhIHRyYW5zcG9ydFxuICAgIHNlbGYub25jZSgndXBncmFkZScsIGNsZWFudXBBbmRDbG9zZSk7XG4gICAgc2VsZi5vbmNlKCd1cGdyYWRlRXJyb3InLCBjbGVhbnVwQW5kQ2xvc2UpO1xuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIENhbGxlZCB1cG9uIHRyYW5zcG9ydCBlcnJvclxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblNvY2tldC5wcm90b3R5cGUub25FcnJvciA9IGZ1bmN0aW9uIChlcnIpIHtcbiAgZGVidWcoJ3NvY2tldCBlcnJvciAlaicsIGVycik7XG4gIFNvY2tldC5wcmlvcldlYnNvY2tldFN1Y2Nlc3MgPSBmYWxzZTtcbiAgdGhpcy5lbWl0KCdlcnJvcicsIGVycik7XG4gIHRoaXMub25DbG9zZSgndHJhbnNwb3J0IGVycm9yJywgZXJyKTtcbn07XG5cbi8qKlxuICogQ2FsbGVkIHVwb24gdHJhbnNwb3J0IGNsb3NlLlxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblNvY2tldC5wcm90b3R5cGUub25DbG9zZSA9IGZ1bmN0aW9uIChyZWFzb24sIGRlc2MpIHtcbiAgaWYgKCdvcGVuaW5nJyA9PT0gdGhpcy5yZWFkeVN0YXRlIHx8ICdvcGVuJyA9PT0gdGhpcy5yZWFkeVN0YXRlIHx8ICdjbG9zaW5nJyA9PT0gdGhpcy5yZWFkeVN0YXRlKSB7XG4gICAgZGVidWcoJ3NvY2tldCBjbG9zZSB3aXRoIHJlYXNvbjogXCIlc1wiJywgcmVhc29uKTtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICAvLyBjbGVhciB0aW1lcnNcbiAgICBjbGVhclRpbWVvdXQodGhpcy5waW5nSW50ZXJ2YWxUaW1lcik7XG4gICAgY2xlYXJUaW1lb3V0KHRoaXMucGluZ1RpbWVvdXRUaW1lcik7XG5cbiAgICAvLyBzdG9wIGV2ZW50IGZyb20gZmlyaW5nIGFnYWluIGZvciB0cmFuc3BvcnRcbiAgICB0aGlzLnRyYW5zcG9ydC5yZW1vdmVBbGxMaXN0ZW5lcnMoJ2Nsb3NlJyk7XG5cbiAgICAvLyBlbnN1cmUgdHJhbnNwb3J0IHdvbid0IHN0YXkgb3BlblxuICAgIHRoaXMudHJhbnNwb3J0LmNsb3NlKCk7XG5cbiAgICAvLyBpZ25vcmUgZnVydGhlciB0cmFuc3BvcnQgY29tbXVuaWNhdGlvblxuICAgIHRoaXMudHJhbnNwb3J0LnJlbW92ZUFsbExpc3RlbmVycygpO1xuXG4gICAgLy8gc2V0IHJlYWR5IHN0YXRlXG4gICAgdGhpcy5yZWFkeVN0YXRlID0gJ2Nsb3NlZCc7XG5cbiAgICAvLyBjbGVhciBzZXNzaW9uIGlkXG4gICAgdGhpcy5pZCA9IG51bGw7XG5cbiAgICAvLyBlbWl0IGNsb3NlIGV2ZW50XG4gICAgdGhpcy5lbWl0KCdjbG9zZScsIHJlYXNvbiwgZGVzYyk7XG5cbiAgICAvLyBjbGVhbiBidWZmZXJzIGFmdGVyLCBzbyB1c2VycyBjYW4gc3RpbGxcbiAgICAvLyBncmFiIHRoZSBidWZmZXJzIG9uIGBjbG9zZWAgZXZlbnRcbiAgICBzZWxmLndyaXRlQnVmZmVyID0gW107XG4gICAgc2VsZi5wcmV2QnVmZmVyTGVuID0gMDtcbiAgfVxufTtcblxuLyoqXG4gKiBGaWx0ZXJzIHVwZ3JhZGVzLCByZXR1cm5pbmcgb25seSB0aG9zZSBtYXRjaGluZyBjbGllbnQgdHJhbnNwb3J0cy5cbiAqXG4gKiBAcGFyYW0ge0FycmF5fSBzZXJ2ZXIgdXBncmFkZXNcbiAqIEBhcGkgcHJpdmF0ZVxuICpcbiAqL1xuXG5Tb2NrZXQucHJvdG90eXBlLmZpbHRlclVwZ3JhZGVzID0gZnVuY3Rpb24gKHVwZ3JhZGVzKSB7XG4gIHZhciBmaWx0ZXJlZFVwZ3JhZGVzID0gW107XG4gIGZvciAodmFyIGkgPSAwLCBqID0gdXBncmFkZXMubGVuZ3RoOyBpIDwgajsgaSsrKSB7XG4gICAgaWYgKH5pbmRleCh0aGlzLnRyYW5zcG9ydHMsIHVwZ3JhZGVzW2ldKSkgZmlsdGVyZWRVcGdyYWRlcy5wdXNoKHVwZ3JhZGVzW2ldKTtcbiAgfVxuICByZXR1cm4gZmlsdGVyZWRVcGdyYWRlcztcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9zb2NrZXQnKTtcblxuLyoqXG4gKiBFeHBvcnRzIHBhcnNlclxuICpcbiAqIEBhcGkgcHVibGljXG4gKlxuICovXG5tb2R1bGUuZXhwb3J0cy5wYXJzZXIgPSByZXF1aXJlKCdlbmdpbmUuaW8tcGFyc2VyJyk7XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHRvQXJyYXlcblxuZnVuY3Rpb24gdG9BcnJheShsaXN0LCBpbmRleCkge1xuICAgIHZhciBhcnJheSA9IFtdXG5cbiAgICBpbmRleCA9IGluZGV4IHx8IDBcblxuICAgIGZvciAodmFyIGkgPSBpbmRleCB8fCAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgICAgICBhcnJheVtpIC0gaW5kZXhdID0gbGlzdFtpXVxuICAgIH1cblxuICAgIHJldHVybiBhcnJheVxufVxuIiwiXG4vKipcbiAqIE1vZHVsZSBleHBvcnRzLlxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gb247XG5cbi8qKlxuICogSGVscGVyIGZvciBzdWJzY3JpcHRpb25zLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fEV2ZW50RW1pdHRlcn0gb2JqIHdpdGggYEVtaXR0ZXJgIG1peGluIG9yIGBFdmVudEVtaXR0ZXJgXG4gKiBAcGFyYW0ge1N0cmluZ30gZXZlbnQgbmFtZVxuICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2tcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gb24gKG9iaiwgZXYsIGZuKSB7XG4gIG9iai5vbihldiwgZm4pO1xuICByZXR1cm4ge1xuICAgIGRlc3Ryb3k6IGZ1bmN0aW9uICgpIHtcbiAgICAgIG9iai5yZW1vdmVMaXN0ZW5lcihldiwgZm4pO1xuICAgIH1cbiAgfTtcbn1cbiIsIi8qKlxuICogU2xpY2UgcmVmZXJlbmNlLlxuICovXG5cbnZhciBzbGljZSA9IFtdLnNsaWNlO1xuXG4vKipcbiAqIEJpbmQgYG9iamAgdG8gYGZuYC5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufFN0cmluZ30gZm4gb3Igc3RyaW5nXG4gKiBAcmV0dXJuIHtGdW5jdGlvbn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihvYmosIGZuKXtcbiAgaWYgKCdzdHJpbmcnID09IHR5cGVvZiBmbikgZm4gPSBvYmpbZm5dO1xuICBpZiAoJ2Z1bmN0aW9uJyAhPSB0eXBlb2YgZm4pIHRocm93IG5ldyBFcnJvcignYmluZCgpIHJlcXVpcmVzIGEgZnVuY3Rpb24nKTtcbiAgdmFyIGFyZ3MgPSBzbGljZS5jYWxsKGFyZ3VtZW50cywgMik7XG4gIHJldHVybiBmdW5jdGlvbigpe1xuICAgIHJldHVybiBmbi5hcHBseShvYmosIGFyZ3MuY29uY2F0KHNsaWNlLmNhbGwoYXJndW1lbnRzKSkpO1xuICB9XG59O1xuIiwiXG4vKipcbiAqIE1vZHVsZSBkZXBlbmRlbmNpZXMuXG4gKi9cblxudmFyIHBhcnNlciA9IHJlcXVpcmUoJ3NvY2tldC5pby1wYXJzZXInKTtcbnZhciBFbWl0dGVyID0gcmVxdWlyZSgnY29tcG9uZW50LWVtaXR0ZXInKTtcbnZhciB0b0FycmF5ID0gcmVxdWlyZSgndG8tYXJyYXknKTtcbnZhciBvbiA9IHJlcXVpcmUoJy4vb24nKTtcbnZhciBiaW5kID0gcmVxdWlyZSgnY29tcG9uZW50LWJpbmQnKTtcbnZhciBkZWJ1ZyA9IHJlcXVpcmUoJ2RlYnVnJykoJ3NvY2tldC5pby1jbGllbnQ6c29ja2V0Jyk7XG52YXIgcGFyc2VxcyA9IHJlcXVpcmUoJ3BhcnNlcXMnKTtcbnZhciBoYXNCaW4gPSByZXF1aXJlKCdoYXMtYmluYXJ5MicpO1xuXG4vKipcbiAqIE1vZHVsZSBleHBvcnRzLlxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZXhwb3J0cyA9IFNvY2tldDtcblxuLyoqXG4gKiBJbnRlcm5hbCBldmVudHMgKGJsYWNrbGlzdGVkKS5cbiAqIFRoZXNlIGV2ZW50cyBjYW4ndCBiZSBlbWl0dGVkIGJ5IHRoZSB1c2VyLlxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbnZhciBldmVudHMgPSB7XG4gIGNvbm5lY3Q6IDEsXG4gIGNvbm5lY3RfZXJyb3I6IDEsXG4gIGNvbm5lY3RfdGltZW91dDogMSxcbiAgY29ubmVjdGluZzogMSxcbiAgZGlzY29ubmVjdDogMSxcbiAgZXJyb3I6IDEsXG4gIHJlY29ubmVjdDogMSxcbiAgcmVjb25uZWN0X2F0dGVtcHQ6IDEsXG4gIHJlY29ubmVjdF9mYWlsZWQ6IDEsXG4gIHJlY29ubmVjdF9lcnJvcjogMSxcbiAgcmVjb25uZWN0aW5nOiAxLFxuICBwaW5nOiAxLFxuICBwb25nOiAxXG59O1xuXG4vKipcbiAqIFNob3J0Y3V0IHRvIGBFbWl0dGVyI2VtaXRgLlxuICovXG5cbnZhciBlbWl0ID0gRW1pdHRlci5wcm90b3R5cGUuZW1pdDtcblxuLyoqXG4gKiBgU29ja2V0YCBjb25zdHJ1Y3Rvci5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIFNvY2tldCAoaW8sIG5zcCwgb3B0cykge1xuICB0aGlzLmlvID0gaW87XG4gIHRoaXMubnNwID0gbnNwO1xuICB0aGlzLmpzb24gPSB0aGlzOyAvLyBjb21wYXRcbiAgdGhpcy5pZHMgPSAwO1xuICB0aGlzLmFja3MgPSB7fTtcbiAgdGhpcy5yZWNlaXZlQnVmZmVyID0gW107XG4gIHRoaXMuc2VuZEJ1ZmZlciA9IFtdO1xuICB0aGlzLmNvbm5lY3RlZCA9IGZhbHNlO1xuICB0aGlzLmRpc2Nvbm5lY3RlZCA9IHRydWU7XG4gIHRoaXMuZmxhZ3MgPSB7fTtcbiAgaWYgKG9wdHMgJiYgb3B0cy5xdWVyeSkge1xuICAgIHRoaXMucXVlcnkgPSBvcHRzLnF1ZXJ5O1xuICB9XG4gIGlmICh0aGlzLmlvLmF1dG9Db25uZWN0KSB0aGlzLm9wZW4oKTtcbn1cblxuLyoqXG4gKiBNaXggaW4gYEVtaXR0ZXJgLlxuICovXG5cbkVtaXR0ZXIoU29ja2V0LnByb3RvdHlwZSk7XG5cbi8qKlxuICogU3Vic2NyaWJlIHRvIG9wZW4sIGNsb3NlIGFuZCBwYWNrZXQgZXZlbnRzXG4gKlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuU29ja2V0LnByb3RvdHlwZS5zdWJFdmVudHMgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0aGlzLnN1YnMpIHJldHVybjtcblxuICB2YXIgaW8gPSB0aGlzLmlvO1xuICB0aGlzLnN1YnMgPSBbXG4gICAgb24oaW8sICdvcGVuJywgYmluZCh0aGlzLCAnb25vcGVuJykpLFxuICAgIG9uKGlvLCAncGFja2V0JywgYmluZCh0aGlzLCAnb25wYWNrZXQnKSksXG4gICAgb24oaW8sICdjbG9zZScsIGJpbmQodGhpcywgJ29uY2xvc2UnKSlcbiAgXTtcbn07XG5cbi8qKlxuICogXCJPcGVuc1wiIHRoZSBzb2NrZXQuXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5Tb2NrZXQucHJvdG90eXBlLm9wZW4gPVxuU29ja2V0LnByb3RvdHlwZS5jb25uZWN0ID0gZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5jb25uZWN0ZWQpIHJldHVybiB0aGlzO1xuXG4gIHRoaXMuc3ViRXZlbnRzKCk7XG4gIHRoaXMuaW8ub3BlbigpOyAvLyBlbnN1cmUgb3BlblxuICBpZiAoJ29wZW4nID09PSB0aGlzLmlvLnJlYWR5U3RhdGUpIHRoaXMub25vcGVuKCk7XG4gIHRoaXMuZW1pdCgnY29ubmVjdGluZycpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogU2VuZHMgYSBgbWVzc2FnZWAgZXZlbnQuXG4gKlxuICogQHJldHVybiB7U29ja2V0fSBzZWxmXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblNvY2tldC5wcm90b3R5cGUuc2VuZCA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIGFyZ3MgPSB0b0FycmF5KGFyZ3VtZW50cyk7XG4gIGFyZ3MudW5zaGlmdCgnbWVzc2FnZScpO1xuICB0aGlzLmVtaXQuYXBwbHkodGhpcywgYXJncyk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBPdmVycmlkZSBgZW1pdGAuXG4gKiBJZiB0aGUgZXZlbnQgaXMgaW4gYGV2ZW50c2AsIGl0J3MgZW1pdHRlZCBub3JtYWxseS5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZXZlbnQgbmFtZVxuICogQHJldHVybiB7U29ja2V0fSBzZWxmXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblNvY2tldC5wcm90b3R5cGUuZW1pdCA9IGZ1bmN0aW9uIChldikge1xuICBpZiAoZXZlbnRzLmhhc093blByb3BlcnR5KGV2KSkge1xuICAgIGVtaXQuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIHZhciBhcmdzID0gdG9BcnJheShhcmd1bWVudHMpO1xuICB2YXIgcGFja2V0ID0ge1xuICAgIHR5cGU6ICh0aGlzLmZsYWdzLmJpbmFyeSAhPT0gdW5kZWZpbmVkID8gdGhpcy5mbGFncy5iaW5hcnkgOiBoYXNCaW4oYXJncykpID8gcGFyc2VyLkJJTkFSWV9FVkVOVCA6IHBhcnNlci5FVkVOVCxcbiAgICBkYXRhOiBhcmdzXG4gIH07XG5cbiAgcGFja2V0Lm9wdGlvbnMgPSB7fTtcbiAgcGFja2V0Lm9wdGlvbnMuY29tcHJlc3MgPSAhdGhpcy5mbGFncyB8fCBmYWxzZSAhPT0gdGhpcy5mbGFncy5jb21wcmVzcztcblxuICAvLyBldmVudCBhY2sgY2FsbGJhY2tcbiAgaWYgKCdmdW5jdGlvbicgPT09IHR5cGVvZiBhcmdzW2FyZ3MubGVuZ3RoIC0gMV0pIHtcbiAgICBkZWJ1ZygnZW1pdHRpbmcgcGFja2V0IHdpdGggYWNrIGlkICVkJywgdGhpcy5pZHMpO1xuICAgIHRoaXMuYWNrc1t0aGlzLmlkc10gPSBhcmdzLnBvcCgpO1xuICAgIHBhY2tldC5pZCA9IHRoaXMuaWRzKys7XG4gIH1cblxuICBpZiAodGhpcy5jb25uZWN0ZWQpIHtcbiAgICB0aGlzLnBhY2tldChwYWNrZXQpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuc2VuZEJ1ZmZlci5wdXNoKHBhY2tldCk7XG4gIH1cblxuICB0aGlzLmZsYWdzID0ge307XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIFNlbmRzIGEgcGFja2V0LlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBwYWNrZXRcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblNvY2tldC5wcm90b3R5cGUucGFja2V0ID0gZnVuY3Rpb24gKHBhY2tldCkge1xuICBwYWNrZXQubnNwID0gdGhpcy5uc3A7XG4gIHRoaXMuaW8ucGFja2V0KHBhY2tldCk7XG59O1xuXG4vKipcbiAqIENhbGxlZCB1cG9uIGVuZ2luZSBgb3BlbmAuXG4gKlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuU29ja2V0LnByb3RvdHlwZS5vbm9wZW4gPSBmdW5jdGlvbiAoKSB7XG4gIGRlYnVnKCd0cmFuc3BvcnQgaXMgb3BlbiAtIGNvbm5lY3RpbmcnKTtcblxuICAvLyB3cml0ZSBjb25uZWN0IHBhY2tldCBpZiBuZWNlc3NhcnlcbiAgaWYgKCcvJyAhPT0gdGhpcy5uc3ApIHtcbiAgICBpZiAodGhpcy5xdWVyeSkge1xuICAgICAgdmFyIHF1ZXJ5ID0gdHlwZW9mIHRoaXMucXVlcnkgPT09ICdvYmplY3QnID8gcGFyc2Vxcy5lbmNvZGUodGhpcy5xdWVyeSkgOiB0aGlzLnF1ZXJ5O1xuICAgICAgZGVidWcoJ3NlbmRpbmcgY29ubmVjdCBwYWNrZXQgd2l0aCBxdWVyeSAlcycsIHF1ZXJ5KTtcbiAgICAgIHRoaXMucGFja2V0KHt0eXBlOiBwYXJzZXIuQ09OTkVDVCwgcXVlcnk6IHF1ZXJ5fSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucGFja2V0KHt0eXBlOiBwYXJzZXIuQ09OTkVDVH0pO1xuICAgIH1cbiAgfVxufTtcblxuLyoqXG4gKiBDYWxsZWQgdXBvbiBlbmdpbmUgYGNsb3NlYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gcmVhc29uXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5Tb2NrZXQucHJvdG90eXBlLm9uY2xvc2UgPSBmdW5jdGlvbiAocmVhc29uKSB7XG4gIGRlYnVnKCdjbG9zZSAoJXMpJywgcmVhc29uKTtcbiAgdGhpcy5jb25uZWN0ZWQgPSBmYWxzZTtcbiAgdGhpcy5kaXNjb25uZWN0ZWQgPSB0cnVlO1xuICBkZWxldGUgdGhpcy5pZDtcbiAgdGhpcy5lbWl0KCdkaXNjb25uZWN0JywgcmVhc29uKTtcbn07XG5cbi8qKlxuICogQ2FsbGVkIHdpdGggc29ja2V0IHBhY2tldC5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gcGFja2V0XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5Tb2NrZXQucHJvdG90eXBlLm9ucGFja2V0ID0gZnVuY3Rpb24gKHBhY2tldCkge1xuICB2YXIgc2FtZU5hbWVzcGFjZSA9IHBhY2tldC5uc3AgPT09IHRoaXMubnNwO1xuICB2YXIgcm9vdE5hbWVzcGFjZUVycm9yID0gcGFja2V0LnR5cGUgPT09IHBhcnNlci5FUlJPUiAmJiBwYWNrZXQubnNwID09PSAnLyc7XG5cbiAgaWYgKCFzYW1lTmFtZXNwYWNlICYmICFyb290TmFtZXNwYWNlRXJyb3IpIHJldHVybjtcblxuICBzd2l0Y2ggKHBhY2tldC50eXBlKSB7XG4gICAgY2FzZSBwYXJzZXIuQ09OTkVDVDpcbiAgICAgIHRoaXMub25jb25uZWN0KCk7XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgcGFyc2VyLkVWRU5UOlxuICAgICAgdGhpcy5vbmV2ZW50KHBhY2tldCk7XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgcGFyc2VyLkJJTkFSWV9FVkVOVDpcbiAgICAgIHRoaXMub25ldmVudChwYWNrZXQpO1xuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlIHBhcnNlci5BQ0s6XG4gICAgICB0aGlzLm9uYWNrKHBhY2tldCk7XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgcGFyc2VyLkJJTkFSWV9BQ0s6XG4gICAgICB0aGlzLm9uYWNrKHBhY2tldCk7XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgcGFyc2VyLkRJU0NPTk5FQ1Q6XG4gICAgICB0aGlzLm9uZGlzY29ubmVjdCgpO1xuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlIHBhcnNlci5FUlJPUjpcbiAgICAgIHRoaXMuZW1pdCgnZXJyb3InLCBwYWNrZXQuZGF0YSk7XG4gICAgICBicmVhaztcbiAgfVxufTtcblxuLyoqXG4gKiBDYWxsZWQgdXBvbiBhIHNlcnZlciBldmVudC5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gcGFja2V0XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5Tb2NrZXQucHJvdG90eXBlLm9uZXZlbnQgPSBmdW5jdGlvbiAocGFja2V0KSB7XG4gIHZhciBhcmdzID0gcGFja2V0LmRhdGEgfHwgW107XG4gIGRlYnVnKCdlbWl0dGluZyBldmVudCAlaicsIGFyZ3MpO1xuXG4gIGlmIChudWxsICE9IHBhY2tldC5pZCkge1xuICAgIGRlYnVnKCdhdHRhY2hpbmcgYWNrIGNhbGxiYWNrIHRvIGV2ZW50Jyk7XG4gICAgYXJncy5wdXNoKHRoaXMuYWNrKHBhY2tldC5pZCkpO1xuICB9XG5cbiAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgZW1pdC5hcHBseSh0aGlzLCBhcmdzKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnJlY2VpdmVCdWZmZXIucHVzaChhcmdzKTtcbiAgfVxufTtcblxuLyoqXG4gKiBQcm9kdWNlcyBhbiBhY2sgY2FsbGJhY2sgdG8gZW1pdCB3aXRoIGFuIGV2ZW50LlxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cblNvY2tldC5wcm90b3R5cGUuYWNrID0gZnVuY3Rpb24gKGlkKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgdmFyIHNlbnQgPSBmYWxzZTtcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAvLyBwcmV2ZW50IGRvdWJsZSBjYWxsYmFja3NcbiAgICBpZiAoc2VudCkgcmV0dXJuO1xuICAgIHNlbnQgPSB0cnVlO1xuICAgIHZhciBhcmdzID0gdG9BcnJheShhcmd1bWVudHMpO1xuICAgIGRlYnVnKCdzZW5kaW5nIGFjayAlaicsIGFyZ3MpO1xuXG4gICAgc2VsZi5wYWNrZXQoe1xuICAgICAgdHlwZTogaGFzQmluKGFyZ3MpID8gcGFyc2VyLkJJTkFSWV9BQ0sgOiBwYXJzZXIuQUNLLFxuICAgICAgaWQ6IGlkLFxuICAgICAgZGF0YTogYXJnc1xuICAgIH0pO1xuICB9O1xufTtcblxuLyoqXG4gKiBDYWxsZWQgdXBvbiBhIHNlcnZlciBhY2tub3dsZWdlbWVudC5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gcGFja2V0XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5Tb2NrZXQucHJvdG90eXBlLm9uYWNrID0gZnVuY3Rpb24gKHBhY2tldCkge1xuICB2YXIgYWNrID0gdGhpcy5hY2tzW3BhY2tldC5pZF07XG4gIGlmICgnZnVuY3Rpb24nID09PSB0eXBlb2YgYWNrKSB7XG4gICAgZGVidWcoJ2NhbGxpbmcgYWNrICVzIHdpdGggJWonLCBwYWNrZXQuaWQsIHBhY2tldC5kYXRhKTtcbiAgICBhY2suYXBwbHkodGhpcywgcGFja2V0LmRhdGEpO1xuICAgIGRlbGV0ZSB0aGlzLmFja3NbcGFja2V0LmlkXTtcbiAgfSBlbHNlIHtcbiAgICBkZWJ1ZygnYmFkIGFjayAlcycsIHBhY2tldC5pZCk7XG4gIH1cbn07XG5cbi8qKlxuICogQ2FsbGVkIHVwb24gc2VydmVyIGNvbm5lY3QuXG4gKlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuU29ja2V0LnByb3RvdHlwZS5vbmNvbm5lY3QgPSBmdW5jdGlvbiAoKSB7XG4gIHRoaXMuY29ubmVjdGVkID0gdHJ1ZTtcbiAgdGhpcy5kaXNjb25uZWN0ZWQgPSBmYWxzZTtcbiAgdGhpcy5lbWl0KCdjb25uZWN0Jyk7XG4gIHRoaXMuZW1pdEJ1ZmZlcmVkKCk7XG59O1xuXG4vKipcbiAqIEVtaXQgYnVmZmVyZWQgZXZlbnRzIChyZWNlaXZlZCBhbmQgZW1pdHRlZCkuXG4gKlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuU29ja2V0LnByb3RvdHlwZS5lbWl0QnVmZmVyZWQgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBpO1xuICBmb3IgKGkgPSAwOyBpIDwgdGhpcy5yZWNlaXZlQnVmZmVyLmxlbmd0aDsgaSsrKSB7XG4gICAgZW1pdC5hcHBseSh0aGlzLCB0aGlzLnJlY2VpdmVCdWZmZXJbaV0pO1xuICB9XG4gIHRoaXMucmVjZWl2ZUJ1ZmZlciA9IFtdO1xuXG4gIGZvciAoaSA9IDA7IGkgPCB0aGlzLnNlbmRCdWZmZXIubGVuZ3RoOyBpKyspIHtcbiAgICB0aGlzLnBhY2tldCh0aGlzLnNlbmRCdWZmZXJbaV0pO1xuICB9XG4gIHRoaXMuc2VuZEJ1ZmZlciA9IFtdO1xufTtcblxuLyoqXG4gKiBDYWxsZWQgdXBvbiBzZXJ2ZXIgZGlzY29ubmVjdC5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5Tb2NrZXQucHJvdG90eXBlLm9uZGlzY29ubmVjdCA9IGZ1bmN0aW9uICgpIHtcbiAgZGVidWcoJ3NlcnZlciBkaXNjb25uZWN0ICglcyknLCB0aGlzLm5zcCk7XG4gIHRoaXMuZGVzdHJveSgpO1xuICB0aGlzLm9uY2xvc2UoJ2lvIHNlcnZlciBkaXNjb25uZWN0Jyk7XG59O1xuXG4vKipcbiAqIENhbGxlZCB1cG9uIGZvcmNlZCBjbGllbnQvc2VydmVyIHNpZGUgZGlzY29ubmVjdGlvbnMsXG4gKiB0aGlzIG1ldGhvZCBlbnN1cmVzIHRoZSBtYW5hZ2VyIHN0b3BzIHRyYWNraW5nIHVzIGFuZFxuICogdGhhdCByZWNvbm5lY3Rpb25zIGRvbid0IGdldCB0cmlnZ2VyZWQgZm9yIHRoaXMuXG4gKlxuICogQGFwaSBwcml2YXRlLlxuICovXG5cblNvY2tldC5wcm90b3R5cGUuZGVzdHJveSA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHRoaXMuc3Vicykge1xuICAgIC8vIGNsZWFuIHN1YnNjcmlwdGlvbnMgdG8gYXZvaWQgcmVjb25uZWN0aW9uc1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5zdWJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICB0aGlzLnN1YnNbaV0uZGVzdHJveSgpO1xuICAgIH1cbiAgICB0aGlzLnN1YnMgPSBudWxsO1xuICB9XG5cbiAgdGhpcy5pby5kZXN0cm95KHRoaXMpO1xufTtcblxuLyoqXG4gKiBEaXNjb25uZWN0cyB0aGUgc29ja2V0IG1hbnVhbGx5LlxuICpcbiAqIEByZXR1cm4ge1NvY2tldH0gc2VsZlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5Tb2NrZXQucHJvdG90eXBlLmNsb3NlID1cblNvY2tldC5wcm90b3R5cGUuZGlzY29ubmVjdCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgZGVidWcoJ3BlcmZvcm1pbmcgZGlzY29ubmVjdCAoJXMpJywgdGhpcy5uc3ApO1xuICAgIHRoaXMucGFja2V0KHsgdHlwZTogcGFyc2VyLkRJU0NPTk5FQ1QgfSk7XG4gIH1cblxuICAvLyByZW1vdmUgc29ja2V0IGZyb20gcG9vbFxuICB0aGlzLmRlc3Ryb3koKTtcblxuICBpZiAodGhpcy5jb25uZWN0ZWQpIHtcbiAgICAvLyBmaXJlIGV2ZW50c1xuICAgIHRoaXMub25jbG9zZSgnaW8gY2xpZW50IGRpc2Nvbm5lY3QnKTtcbiAgfVxuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogU2V0cyB0aGUgY29tcHJlc3MgZmxhZy5cbiAqXG4gKiBAcGFyYW0ge0Jvb2xlYW59IGlmIGB0cnVlYCwgY29tcHJlc3NlcyB0aGUgc2VuZGluZyBkYXRhXG4gKiBAcmV0dXJuIHtTb2NrZXR9IHNlbGZcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuU29ja2V0LnByb3RvdHlwZS5jb21wcmVzcyA9IGZ1bmN0aW9uIChjb21wcmVzcykge1xuICB0aGlzLmZsYWdzLmNvbXByZXNzID0gY29tcHJlc3M7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBTZXRzIHRoZSBiaW5hcnkgZmxhZ1xuICpcbiAqIEBwYXJhbSB7Qm9vbGVhbn0gd2hldGhlciB0aGUgZW1pdHRlZCBkYXRhIGNvbnRhaW5zIGJpbmFyeVxuICogQHJldHVybiB7U29ja2V0fSBzZWxmXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cblNvY2tldC5wcm90b3R5cGUuYmluYXJ5ID0gZnVuY3Rpb24gKGJpbmFyeSkge1xuICB0aGlzLmZsYWdzLmJpbmFyeSA9IGJpbmFyeTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuIiwiXG4vKipcbiAqIEV4cG9zZSBgQmFja29mZmAuXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBCYWNrb2ZmO1xuXG4vKipcbiAqIEluaXRpYWxpemUgYmFja29mZiB0aW1lciB3aXRoIGBvcHRzYC5cbiAqXG4gKiAtIGBtaW5gIGluaXRpYWwgdGltZW91dCBpbiBtaWxsaXNlY29uZHMgWzEwMF1cbiAqIC0gYG1heGAgbWF4IHRpbWVvdXQgWzEwMDAwXVxuICogLSBgaml0dGVyYCBbMF1cbiAqIC0gYGZhY3RvcmAgWzJdXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9wdHNcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gQmFja29mZihvcHRzKSB7XG4gIG9wdHMgPSBvcHRzIHx8IHt9O1xuICB0aGlzLm1zID0gb3B0cy5taW4gfHwgMTAwO1xuICB0aGlzLm1heCA9IG9wdHMubWF4IHx8IDEwMDAwO1xuICB0aGlzLmZhY3RvciA9IG9wdHMuZmFjdG9yIHx8IDI7XG4gIHRoaXMuaml0dGVyID0gb3B0cy5qaXR0ZXIgPiAwICYmIG9wdHMuaml0dGVyIDw9IDEgPyBvcHRzLmppdHRlciA6IDA7XG4gIHRoaXMuYXR0ZW1wdHMgPSAwO1xufVxuXG4vKipcbiAqIFJldHVybiB0aGUgYmFja29mZiBkdXJhdGlvbi5cbiAqXG4gKiBAcmV0dXJuIHtOdW1iZXJ9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbkJhY2tvZmYucHJvdG90eXBlLmR1cmF0aW9uID0gZnVuY3Rpb24oKXtcbiAgdmFyIG1zID0gdGhpcy5tcyAqIE1hdGgucG93KHRoaXMuZmFjdG9yLCB0aGlzLmF0dGVtcHRzKyspO1xuICBpZiAodGhpcy5qaXR0ZXIpIHtcbiAgICB2YXIgcmFuZCA9ICBNYXRoLnJhbmRvbSgpO1xuICAgIHZhciBkZXZpYXRpb24gPSBNYXRoLmZsb29yKHJhbmQgKiB0aGlzLmppdHRlciAqIG1zKTtcbiAgICBtcyA9IChNYXRoLmZsb29yKHJhbmQgKiAxMCkgJiAxKSA9PSAwICA/IG1zIC0gZGV2aWF0aW9uIDogbXMgKyBkZXZpYXRpb247XG4gIH1cbiAgcmV0dXJuIE1hdGgubWluKG1zLCB0aGlzLm1heCkgfCAwO1xufTtcblxuLyoqXG4gKiBSZXNldCB0aGUgbnVtYmVyIG9mIGF0dGVtcHRzLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuQmFja29mZi5wcm90b3R5cGUucmVzZXQgPSBmdW5jdGlvbigpe1xuICB0aGlzLmF0dGVtcHRzID0gMDtcbn07XG5cbi8qKlxuICogU2V0IHRoZSBtaW5pbXVtIGR1cmF0aW9uXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5CYWNrb2ZmLnByb3RvdHlwZS5zZXRNaW4gPSBmdW5jdGlvbihtaW4pe1xuICB0aGlzLm1zID0gbWluO1xufTtcblxuLyoqXG4gKiBTZXQgdGhlIG1heGltdW0gZHVyYXRpb25cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbkJhY2tvZmYucHJvdG90eXBlLnNldE1heCA9IGZ1bmN0aW9uKG1heCl7XG4gIHRoaXMubWF4ID0gbWF4O1xufTtcblxuLyoqXG4gKiBTZXQgdGhlIGppdHRlclxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuQmFja29mZi5wcm90b3R5cGUuc2V0Sml0dGVyID0gZnVuY3Rpb24oaml0dGVyKXtcbiAgdGhpcy5qaXR0ZXIgPSBqaXR0ZXI7XG59O1xuXG4iLCJcbi8qKlxuICogTW9kdWxlIGRlcGVuZGVuY2llcy5cbiAqL1xuXG52YXIgZWlvID0gcmVxdWlyZSgnZW5naW5lLmlvLWNsaWVudCcpO1xudmFyIFNvY2tldCA9IHJlcXVpcmUoJy4vc29ja2V0Jyk7XG52YXIgRW1pdHRlciA9IHJlcXVpcmUoJ2NvbXBvbmVudC1lbWl0dGVyJyk7XG52YXIgcGFyc2VyID0gcmVxdWlyZSgnc29ja2V0LmlvLXBhcnNlcicpO1xudmFyIG9uID0gcmVxdWlyZSgnLi9vbicpO1xudmFyIGJpbmQgPSByZXF1aXJlKCdjb21wb25lbnQtYmluZCcpO1xudmFyIGRlYnVnID0gcmVxdWlyZSgnZGVidWcnKSgnc29ja2V0LmlvLWNsaWVudDptYW5hZ2VyJyk7XG52YXIgaW5kZXhPZiA9IHJlcXVpcmUoJ2luZGV4b2YnKTtcbnZhciBCYWNrb2ZmID0gcmVxdWlyZSgnYmFja28yJyk7XG5cbi8qKlxuICogSUU2KyBoYXNPd25Qcm9wZXJ0eVxuICovXG5cbnZhciBoYXMgPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5O1xuXG4vKipcbiAqIE1vZHVsZSBleHBvcnRzXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBNYW5hZ2VyO1xuXG4vKipcbiAqIGBNYW5hZ2VyYCBjb25zdHJ1Y3Rvci5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZW5naW5lIGluc3RhbmNlIG9yIGVuZ2luZSB1cmkvb3B0c1xuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnNcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gTWFuYWdlciAodXJpLCBvcHRzKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBNYW5hZ2VyKSkgcmV0dXJuIG5ldyBNYW5hZ2VyKHVyaSwgb3B0cyk7XG4gIGlmICh1cmkgJiYgKCdvYmplY3QnID09PSB0eXBlb2YgdXJpKSkge1xuICAgIG9wdHMgPSB1cmk7XG4gICAgdXJpID0gdW5kZWZpbmVkO1xuICB9XG4gIG9wdHMgPSBvcHRzIHx8IHt9O1xuXG4gIG9wdHMucGF0aCA9IG9wdHMucGF0aCB8fCAnL3NvY2tldC5pbyc7XG4gIHRoaXMubnNwcyA9IHt9O1xuICB0aGlzLnN1YnMgPSBbXTtcbiAgdGhpcy5vcHRzID0gb3B0cztcbiAgdGhpcy5yZWNvbm5lY3Rpb24ob3B0cy5yZWNvbm5lY3Rpb24gIT09IGZhbHNlKTtcbiAgdGhpcy5yZWNvbm5lY3Rpb25BdHRlbXB0cyhvcHRzLnJlY29ubmVjdGlvbkF0dGVtcHRzIHx8IEluZmluaXR5KTtcbiAgdGhpcy5yZWNvbm5lY3Rpb25EZWxheShvcHRzLnJlY29ubmVjdGlvbkRlbGF5IHx8IDEwMDApO1xuICB0aGlzLnJlY29ubmVjdGlvbkRlbGF5TWF4KG9wdHMucmVjb25uZWN0aW9uRGVsYXlNYXggfHwgNTAwMCk7XG4gIHRoaXMucmFuZG9taXphdGlvbkZhY3RvcihvcHRzLnJhbmRvbWl6YXRpb25GYWN0b3IgfHwgMC41KTtcbiAgdGhpcy5iYWNrb2ZmID0gbmV3IEJhY2tvZmYoe1xuICAgIG1pbjogdGhpcy5yZWNvbm5lY3Rpb25EZWxheSgpLFxuICAgIG1heDogdGhpcy5yZWNvbm5lY3Rpb25EZWxheU1heCgpLFxuICAgIGppdHRlcjogdGhpcy5yYW5kb21pemF0aW9uRmFjdG9yKClcbiAgfSk7XG4gIHRoaXMudGltZW91dChudWxsID09IG9wdHMudGltZW91dCA/IDIwMDAwIDogb3B0cy50aW1lb3V0KTtcbiAgdGhpcy5yZWFkeVN0YXRlID0gJ2Nsb3NlZCc7XG4gIHRoaXMudXJpID0gdXJpO1xuICB0aGlzLmNvbm5lY3RpbmcgPSBbXTtcbiAgdGhpcy5sYXN0UGluZyA9IG51bGw7XG4gIHRoaXMuZW5jb2RpbmcgPSBmYWxzZTtcbiAgdGhpcy5wYWNrZXRCdWZmZXIgPSBbXTtcbiAgdmFyIF9wYXJzZXIgPSBvcHRzLnBhcnNlciB8fCBwYXJzZXI7XG4gIHRoaXMuZW5jb2RlciA9IG5ldyBfcGFyc2VyLkVuY29kZXIoKTtcbiAgdGhpcy5kZWNvZGVyID0gbmV3IF9wYXJzZXIuRGVjb2RlcigpO1xuICB0aGlzLmF1dG9Db25uZWN0ID0gb3B0cy5hdXRvQ29ubmVjdCAhPT0gZmFsc2U7XG4gIGlmICh0aGlzLmF1dG9Db25uZWN0KSB0aGlzLm9wZW4oKTtcbn1cblxuLyoqXG4gKiBQcm9wYWdhdGUgZ2l2ZW4gZXZlbnQgdG8gc29ja2V0cyBhbmQgZW1pdCBvbiBgdGhpc2BcbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5NYW5hZ2VyLnByb3RvdHlwZS5lbWl0QWxsID0gZnVuY3Rpb24gKCkge1xuICB0aGlzLmVtaXQuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgZm9yICh2YXIgbnNwIGluIHRoaXMubnNwcykge1xuICAgIGlmIChoYXMuY2FsbCh0aGlzLm5zcHMsIG5zcCkpIHtcbiAgICAgIHRoaXMubnNwc1tuc3BdLmVtaXQuYXBwbHkodGhpcy5uc3BzW25zcF0sIGFyZ3VtZW50cyk7XG4gICAgfVxuICB9XG59O1xuXG4vKipcbiAqIFVwZGF0ZSBgc29ja2V0LmlkYCBvZiBhbGwgc29ja2V0c1xuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbk1hbmFnZXIucHJvdG90eXBlLnVwZGF0ZVNvY2tldElkcyA9IGZ1bmN0aW9uICgpIHtcbiAgZm9yICh2YXIgbnNwIGluIHRoaXMubnNwcykge1xuICAgIGlmIChoYXMuY2FsbCh0aGlzLm5zcHMsIG5zcCkpIHtcbiAgICAgIHRoaXMubnNwc1tuc3BdLmlkID0gdGhpcy5nZW5lcmF0ZUlkKG5zcCk7XG4gICAgfVxuICB9XG59O1xuXG4vKipcbiAqIGdlbmVyYXRlIGBzb2NrZXQuaWRgIGZvciB0aGUgZ2l2ZW4gYG5zcGBcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbnNwXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5NYW5hZ2VyLnByb3RvdHlwZS5nZW5lcmF0ZUlkID0gZnVuY3Rpb24gKG5zcCkge1xuICByZXR1cm4gKG5zcCA9PT0gJy8nID8gJycgOiAobnNwICsgJyMnKSkgKyB0aGlzLmVuZ2luZS5pZDtcbn07XG5cbi8qKlxuICogTWl4IGluIGBFbWl0dGVyYC5cbiAqL1xuXG5FbWl0dGVyKE1hbmFnZXIucHJvdG90eXBlKTtcblxuLyoqXG4gKiBTZXRzIHRoZSBgcmVjb25uZWN0aW9uYCBjb25maWcuXG4gKlxuICogQHBhcmFtIHtCb29sZWFufSB0cnVlL2ZhbHNlIGlmIGl0IHNob3VsZCBhdXRvbWF0aWNhbGx5IHJlY29ubmVjdFxuICogQHJldHVybiB7TWFuYWdlcn0gc2VsZiBvciB2YWx1ZVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5NYW5hZ2VyLnByb3RvdHlwZS5yZWNvbm5lY3Rpb24gPSBmdW5jdGlvbiAodikge1xuICBpZiAoIWFyZ3VtZW50cy5sZW5ndGgpIHJldHVybiB0aGlzLl9yZWNvbm5lY3Rpb247XG4gIHRoaXMuX3JlY29ubmVjdGlvbiA9ICEhdjtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIFNldHMgdGhlIHJlY29ubmVjdGlvbiBhdHRlbXB0cyBjb25maWcuXG4gKlxuICogQHBhcmFtIHtOdW1iZXJ9IG1heCByZWNvbm5lY3Rpb24gYXR0ZW1wdHMgYmVmb3JlIGdpdmluZyB1cFxuICogQHJldHVybiB7TWFuYWdlcn0gc2VsZiBvciB2YWx1ZVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5NYW5hZ2VyLnByb3RvdHlwZS5yZWNvbm5lY3Rpb25BdHRlbXB0cyA9IGZ1bmN0aW9uICh2KSB7XG4gIGlmICghYXJndW1lbnRzLmxlbmd0aCkgcmV0dXJuIHRoaXMuX3JlY29ubmVjdGlvbkF0dGVtcHRzO1xuICB0aGlzLl9yZWNvbm5lY3Rpb25BdHRlbXB0cyA9IHY7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBTZXRzIHRoZSBkZWxheSBiZXR3ZWVuIHJlY29ubmVjdGlvbnMuXG4gKlxuICogQHBhcmFtIHtOdW1iZXJ9IGRlbGF5XG4gKiBAcmV0dXJuIHtNYW5hZ2VyfSBzZWxmIG9yIHZhbHVlXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbk1hbmFnZXIucHJvdG90eXBlLnJlY29ubmVjdGlvbkRlbGF5ID0gZnVuY3Rpb24gKHYpIHtcbiAgaWYgKCFhcmd1bWVudHMubGVuZ3RoKSByZXR1cm4gdGhpcy5fcmVjb25uZWN0aW9uRGVsYXk7XG4gIHRoaXMuX3JlY29ubmVjdGlvbkRlbGF5ID0gdjtcbiAgdGhpcy5iYWNrb2ZmICYmIHRoaXMuYmFja29mZi5zZXRNaW4odik7XG4gIHJldHVybiB0aGlzO1xufTtcblxuTWFuYWdlci5wcm90b3R5cGUucmFuZG9taXphdGlvbkZhY3RvciA9IGZ1bmN0aW9uICh2KSB7XG4gIGlmICghYXJndW1lbnRzLmxlbmd0aCkgcmV0dXJuIHRoaXMuX3JhbmRvbWl6YXRpb25GYWN0b3I7XG4gIHRoaXMuX3JhbmRvbWl6YXRpb25GYWN0b3IgPSB2O1xuICB0aGlzLmJhY2tvZmYgJiYgdGhpcy5iYWNrb2ZmLnNldEppdHRlcih2KTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIFNldHMgdGhlIG1heGltdW0gZGVsYXkgYmV0d2VlbiByZWNvbm5lY3Rpb25zLlxuICpcbiAqIEBwYXJhbSB7TnVtYmVyfSBkZWxheVxuICogQHJldHVybiB7TWFuYWdlcn0gc2VsZiBvciB2YWx1ZVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5NYW5hZ2VyLnByb3RvdHlwZS5yZWNvbm5lY3Rpb25EZWxheU1heCA9IGZ1bmN0aW9uICh2KSB7XG4gIGlmICghYXJndW1lbnRzLmxlbmd0aCkgcmV0dXJuIHRoaXMuX3JlY29ubmVjdGlvbkRlbGF5TWF4O1xuICB0aGlzLl9yZWNvbm5lY3Rpb25EZWxheU1heCA9IHY7XG4gIHRoaXMuYmFja29mZiAmJiB0aGlzLmJhY2tvZmYuc2V0TWF4KHYpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogU2V0cyB0aGUgY29ubmVjdGlvbiB0aW1lb3V0LiBgZmFsc2VgIHRvIGRpc2FibGVcbiAqXG4gKiBAcmV0dXJuIHtNYW5hZ2VyfSBzZWxmIG9yIHZhbHVlXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbk1hbmFnZXIucHJvdG90eXBlLnRpbWVvdXQgPSBmdW5jdGlvbiAodikge1xuICBpZiAoIWFyZ3VtZW50cy5sZW5ndGgpIHJldHVybiB0aGlzLl90aW1lb3V0O1xuICB0aGlzLl90aW1lb3V0ID0gdjtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIFN0YXJ0cyB0cnlpbmcgdG8gcmVjb25uZWN0IGlmIHJlY29ubmVjdGlvbiBpcyBlbmFibGVkIGFuZCB3ZSBoYXZlIG5vdFxuICogc3RhcnRlZCByZWNvbm5lY3RpbmcgeWV0XG4gKlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuTWFuYWdlci5wcm90b3R5cGUubWF5YmVSZWNvbm5lY3RPbk9wZW4gPSBmdW5jdGlvbiAoKSB7XG4gIC8vIE9ubHkgdHJ5IHRvIHJlY29ubmVjdCBpZiBpdCdzIHRoZSBmaXJzdCB0aW1lIHdlJ3JlIGNvbm5lY3RpbmdcbiAgaWYgKCF0aGlzLnJlY29ubmVjdGluZyAmJiB0aGlzLl9yZWNvbm5lY3Rpb24gJiYgdGhpcy5iYWNrb2ZmLmF0dGVtcHRzID09PSAwKSB7XG4gICAgLy8ga2VlcHMgcmVjb25uZWN0aW9uIGZyb20gZmlyaW5nIHR3aWNlIGZvciB0aGUgc2FtZSByZWNvbm5lY3Rpb24gbG9vcFxuICAgIHRoaXMucmVjb25uZWN0KCk7XG4gIH1cbn07XG5cbi8qKlxuICogU2V0cyB0aGUgY3VycmVudCB0cmFuc3BvcnQgYHNvY2tldGAuXG4gKlxuICogQHBhcmFtIHtGdW5jdGlvbn0gb3B0aW9uYWwsIGNhbGxiYWNrXG4gKiBAcmV0dXJuIHtNYW5hZ2VyfSBzZWxmXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbk1hbmFnZXIucHJvdG90eXBlLm9wZW4gPVxuTWFuYWdlci5wcm90b3R5cGUuY29ubmVjdCA9IGZ1bmN0aW9uIChmbiwgb3B0cykge1xuICBkZWJ1ZygncmVhZHlTdGF0ZSAlcycsIHRoaXMucmVhZHlTdGF0ZSk7XG4gIGlmICh+dGhpcy5yZWFkeVN0YXRlLmluZGV4T2YoJ29wZW4nKSkgcmV0dXJuIHRoaXM7XG5cbiAgZGVidWcoJ29wZW5pbmcgJXMnLCB0aGlzLnVyaSk7XG4gIHRoaXMuZW5naW5lID0gZWlvKHRoaXMudXJpLCB0aGlzLm9wdHMpO1xuICB2YXIgc29ja2V0ID0gdGhpcy5lbmdpbmU7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgdGhpcy5yZWFkeVN0YXRlID0gJ29wZW5pbmcnO1xuICB0aGlzLnNraXBSZWNvbm5lY3QgPSBmYWxzZTtcblxuICAvLyBlbWl0IGBvcGVuYFxuICB2YXIgb3BlblN1YiA9IG9uKHNvY2tldCwgJ29wZW4nLCBmdW5jdGlvbiAoKSB7XG4gICAgc2VsZi5vbm9wZW4oKTtcbiAgICBmbiAmJiBmbigpO1xuICB9KTtcblxuICAvLyBlbWl0IGBjb25uZWN0X2Vycm9yYFxuICB2YXIgZXJyb3JTdWIgPSBvbihzb2NrZXQsICdlcnJvcicsIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgZGVidWcoJ2Nvbm5lY3RfZXJyb3InKTtcbiAgICBzZWxmLmNsZWFudXAoKTtcbiAgICBzZWxmLnJlYWR5U3RhdGUgPSAnY2xvc2VkJztcbiAgICBzZWxmLmVtaXRBbGwoJ2Nvbm5lY3RfZXJyb3InLCBkYXRhKTtcbiAgICBpZiAoZm4pIHtcbiAgICAgIHZhciBlcnIgPSBuZXcgRXJyb3IoJ0Nvbm5lY3Rpb24gZXJyb3InKTtcbiAgICAgIGVyci5kYXRhID0gZGF0YTtcbiAgICAgIGZuKGVycik7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIE9ubHkgZG8gdGhpcyBpZiB0aGVyZSBpcyBubyBmbiB0byBoYW5kbGUgdGhlIGVycm9yXG4gICAgICBzZWxmLm1heWJlUmVjb25uZWN0T25PcGVuKCk7XG4gICAgfVxuICB9KTtcblxuICAvLyBlbWl0IGBjb25uZWN0X3RpbWVvdXRgXG4gIGlmIChmYWxzZSAhPT0gdGhpcy5fdGltZW91dCkge1xuICAgIHZhciB0aW1lb3V0ID0gdGhpcy5fdGltZW91dDtcbiAgICBkZWJ1ZygnY29ubmVjdCBhdHRlbXB0IHdpbGwgdGltZW91dCBhZnRlciAlZCcsIHRpbWVvdXQpO1xuXG4gICAgLy8gc2V0IHRpbWVyXG4gICAgdmFyIHRpbWVyID0gc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XG4gICAgICBkZWJ1ZygnY29ubmVjdCBhdHRlbXB0IHRpbWVkIG91dCBhZnRlciAlZCcsIHRpbWVvdXQpO1xuICAgICAgb3BlblN1Yi5kZXN0cm95KCk7XG4gICAgICBzb2NrZXQuY2xvc2UoKTtcbiAgICAgIHNvY2tldC5lbWl0KCdlcnJvcicsICd0aW1lb3V0Jyk7XG4gICAgICBzZWxmLmVtaXRBbGwoJ2Nvbm5lY3RfdGltZW91dCcsIHRpbWVvdXQpO1xuICAgIH0sIHRpbWVvdXQpO1xuXG4gICAgdGhpcy5zdWJzLnB1c2goe1xuICAgICAgZGVzdHJveTogZnVuY3Rpb24gKCkge1xuICAgICAgICBjbGVhclRpbWVvdXQodGltZXIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgdGhpcy5zdWJzLnB1c2gob3BlblN1Yik7XG4gIHRoaXMuc3Vicy5wdXNoKGVycm9yU3ViKTtcblxuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogQ2FsbGVkIHVwb24gdHJhbnNwb3J0IG9wZW4uXG4gKlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuTWFuYWdlci5wcm90b3R5cGUub25vcGVuID0gZnVuY3Rpb24gKCkge1xuICBkZWJ1Zygnb3BlbicpO1xuXG4gIC8vIGNsZWFyIG9sZCBzdWJzXG4gIHRoaXMuY2xlYW51cCgpO1xuXG4gIC8vIG1hcmsgYXMgb3BlblxuICB0aGlzLnJlYWR5U3RhdGUgPSAnb3Blbic7XG4gIHRoaXMuZW1pdCgnb3BlbicpO1xuXG4gIC8vIGFkZCBuZXcgc3Vic1xuICB2YXIgc29ja2V0ID0gdGhpcy5lbmdpbmU7XG4gIHRoaXMuc3Vicy5wdXNoKG9uKHNvY2tldCwgJ2RhdGEnLCBiaW5kKHRoaXMsICdvbmRhdGEnKSkpO1xuICB0aGlzLnN1YnMucHVzaChvbihzb2NrZXQsICdwaW5nJywgYmluZCh0aGlzLCAnb25waW5nJykpKTtcbiAgdGhpcy5zdWJzLnB1c2gob24oc29ja2V0LCAncG9uZycsIGJpbmQodGhpcywgJ29ucG9uZycpKSk7XG4gIHRoaXMuc3Vicy5wdXNoKG9uKHNvY2tldCwgJ2Vycm9yJywgYmluZCh0aGlzLCAnb25lcnJvcicpKSk7XG4gIHRoaXMuc3Vicy5wdXNoKG9uKHNvY2tldCwgJ2Nsb3NlJywgYmluZCh0aGlzLCAnb25jbG9zZScpKSk7XG4gIHRoaXMuc3Vicy5wdXNoKG9uKHRoaXMuZGVjb2RlciwgJ2RlY29kZWQnLCBiaW5kKHRoaXMsICdvbmRlY29kZWQnKSkpO1xufTtcblxuLyoqXG4gKiBDYWxsZWQgdXBvbiBhIHBpbmcuXG4gKlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuTWFuYWdlci5wcm90b3R5cGUub25waW5nID0gZnVuY3Rpb24gKCkge1xuICB0aGlzLmxhc3RQaW5nID0gbmV3IERhdGUoKTtcbiAgdGhpcy5lbWl0QWxsKCdwaW5nJyk7XG59O1xuXG4vKipcbiAqIENhbGxlZCB1cG9uIGEgcGFja2V0LlxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbk1hbmFnZXIucHJvdG90eXBlLm9ucG9uZyA9IGZ1bmN0aW9uICgpIHtcbiAgdGhpcy5lbWl0QWxsKCdwb25nJywgbmV3IERhdGUoKSAtIHRoaXMubGFzdFBpbmcpO1xufTtcblxuLyoqXG4gKiBDYWxsZWQgd2l0aCBkYXRhLlxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbk1hbmFnZXIucHJvdG90eXBlLm9uZGF0YSA9IGZ1bmN0aW9uIChkYXRhKSB7XG4gIHRoaXMuZGVjb2Rlci5hZGQoZGF0YSk7XG59O1xuXG4vKipcbiAqIENhbGxlZCB3aGVuIHBhcnNlciBmdWxseSBkZWNvZGVzIGEgcGFja2V0LlxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbk1hbmFnZXIucHJvdG90eXBlLm9uZGVjb2RlZCA9IGZ1bmN0aW9uIChwYWNrZXQpIHtcbiAgdGhpcy5lbWl0KCdwYWNrZXQnLCBwYWNrZXQpO1xufTtcblxuLyoqXG4gKiBDYWxsZWQgdXBvbiBzb2NrZXQgZXJyb3IuXG4gKlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuTWFuYWdlci5wcm90b3R5cGUub25lcnJvciA9IGZ1bmN0aW9uIChlcnIpIHtcbiAgZGVidWcoJ2Vycm9yJywgZXJyKTtcbiAgdGhpcy5lbWl0QWxsKCdlcnJvcicsIGVycik7XG59O1xuXG4vKipcbiAqIENyZWF0ZXMgYSBuZXcgc29ja2V0IGZvciB0aGUgZ2l2ZW4gYG5zcGAuXG4gKlxuICogQHJldHVybiB7U29ja2V0fVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5NYW5hZ2VyLnByb3RvdHlwZS5zb2NrZXQgPSBmdW5jdGlvbiAobnNwLCBvcHRzKSB7XG4gIHZhciBzb2NrZXQgPSB0aGlzLm5zcHNbbnNwXTtcbiAgaWYgKCFzb2NrZXQpIHtcbiAgICBzb2NrZXQgPSBuZXcgU29ja2V0KHRoaXMsIG5zcCwgb3B0cyk7XG4gICAgdGhpcy5uc3BzW25zcF0gPSBzb2NrZXQ7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNvY2tldC5vbignY29ubmVjdGluZycsIG9uQ29ubmVjdGluZyk7XG4gICAgc29ja2V0Lm9uKCdjb25uZWN0JywgZnVuY3Rpb24gKCkge1xuICAgICAgc29ja2V0LmlkID0gc2VsZi5nZW5lcmF0ZUlkKG5zcCk7XG4gICAgfSk7XG5cbiAgICBpZiAodGhpcy5hdXRvQ29ubmVjdCkge1xuICAgICAgLy8gbWFudWFsbHkgY2FsbCBoZXJlIHNpbmNlIGNvbm5lY3RpbmcgZXZlbnQgaXMgZmlyZWQgYmVmb3JlIGxpc3RlbmluZ1xuICAgICAgb25Db25uZWN0aW5nKCk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gb25Db25uZWN0aW5nICgpIHtcbiAgICBpZiAoIX5pbmRleE9mKHNlbGYuY29ubmVjdGluZywgc29ja2V0KSkge1xuICAgICAgc2VsZi5jb25uZWN0aW5nLnB1c2goc29ja2V0KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gc29ja2V0O1xufTtcblxuLyoqXG4gKiBDYWxsZWQgdXBvbiBhIHNvY2tldCBjbG9zZS5cbiAqXG4gKiBAcGFyYW0ge1NvY2tldH0gc29ja2V0XG4gKi9cblxuTWFuYWdlci5wcm90b3R5cGUuZGVzdHJveSA9IGZ1bmN0aW9uIChzb2NrZXQpIHtcbiAgdmFyIGluZGV4ID0gaW5kZXhPZih0aGlzLmNvbm5lY3RpbmcsIHNvY2tldCk7XG4gIGlmICh+aW5kZXgpIHRoaXMuY29ubmVjdGluZy5zcGxpY2UoaW5kZXgsIDEpO1xuICBpZiAodGhpcy5jb25uZWN0aW5nLmxlbmd0aCkgcmV0dXJuO1xuXG4gIHRoaXMuY2xvc2UoKTtcbn07XG5cbi8qKlxuICogV3JpdGVzIGEgcGFja2V0LlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBwYWNrZXRcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbk1hbmFnZXIucHJvdG90eXBlLnBhY2tldCA9IGZ1bmN0aW9uIChwYWNrZXQpIHtcbiAgZGVidWcoJ3dyaXRpbmcgcGFja2V0ICVqJywgcGFja2V0KTtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBpZiAocGFja2V0LnF1ZXJ5ICYmIHBhY2tldC50eXBlID09PSAwKSBwYWNrZXQubnNwICs9ICc/JyArIHBhY2tldC5xdWVyeTtcblxuICBpZiAoIXNlbGYuZW5jb2RpbmcpIHtcbiAgICAvLyBlbmNvZGUsIHRoZW4gd3JpdGUgdG8gZW5naW5lIHdpdGggcmVzdWx0XG4gICAgc2VsZi5lbmNvZGluZyA9IHRydWU7XG4gICAgdGhpcy5lbmNvZGVyLmVuY29kZShwYWNrZXQsIGZ1bmN0aW9uIChlbmNvZGVkUGFja2V0cykge1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBlbmNvZGVkUGFja2V0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBzZWxmLmVuZ2luZS53cml0ZShlbmNvZGVkUGFja2V0c1tpXSwgcGFja2V0Lm9wdGlvbnMpO1xuICAgICAgfVxuICAgICAgc2VsZi5lbmNvZGluZyA9IGZhbHNlO1xuICAgICAgc2VsZi5wcm9jZXNzUGFja2V0UXVldWUoKTtcbiAgICB9KTtcbiAgfSBlbHNlIHsgLy8gYWRkIHBhY2tldCB0byB0aGUgcXVldWVcbiAgICBzZWxmLnBhY2tldEJ1ZmZlci5wdXNoKHBhY2tldCk7XG4gIH1cbn07XG5cbi8qKlxuICogSWYgcGFja2V0IGJ1ZmZlciBpcyBub24tZW1wdHksIGJlZ2lucyBlbmNvZGluZyB0aGVcbiAqIG5leHQgcGFja2V0IGluIGxpbmUuXG4gKlxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuTWFuYWdlci5wcm90b3R5cGUucHJvY2Vzc1BhY2tldFF1ZXVlID0gZnVuY3Rpb24gKCkge1xuICBpZiAodGhpcy5wYWNrZXRCdWZmZXIubGVuZ3RoID4gMCAmJiAhdGhpcy5lbmNvZGluZykge1xuICAgIHZhciBwYWNrID0gdGhpcy5wYWNrZXRCdWZmZXIuc2hpZnQoKTtcbiAgICB0aGlzLnBhY2tldChwYWNrKTtcbiAgfVxufTtcblxuLyoqXG4gKiBDbGVhbiB1cCB0cmFuc3BvcnQgc3Vic2NyaXB0aW9ucyBhbmQgcGFja2V0IGJ1ZmZlci5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5NYW5hZ2VyLnByb3RvdHlwZS5jbGVhbnVwID0gZnVuY3Rpb24gKCkge1xuICBkZWJ1ZygnY2xlYW51cCcpO1xuXG4gIHZhciBzdWJzTGVuZ3RoID0gdGhpcy5zdWJzLmxlbmd0aDtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdWJzTGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgc3ViID0gdGhpcy5zdWJzLnNoaWZ0KCk7XG4gICAgc3ViLmRlc3Ryb3koKTtcbiAgfVxuXG4gIHRoaXMucGFja2V0QnVmZmVyID0gW107XG4gIHRoaXMuZW5jb2RpbmcgPSBmYWxzZTtcbiAgdGhpcy5sYXN0UGluZyA9IG51bGw7XG5cbiAgdGhpcy5kZWNvZGVyLmRlc3Ryb3koKTtcbn07XG5cbi8qKlxuICogQ2xvc2UgdGhlIGN1cnJlbnQgc29ja2V0LlxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbk1hbmFnZXIucHJvdG90eXBlLmNsb3NlID1cbk1hbmFnZXIucHJvdG90eXBlLmRpc2Nvbm5lY3QgPSBmdW5jdGlvbiAoKSB7XG4gIGRlYnVnKCdkaXNjb25uZWN0Jyk7XG4gIHRoaXMuc2tpcFJlY29ubmVjdCA9IHRydWU7XG4gIHRoaXMucmVjb25uZWN0aW5nID0gZmFsc2U7XG4gIGlmICgnb3BlbmluZycgPT09IHRoaXMucmVhZHlTdGF0ZSkge1xuICAgIC8vIGBvbmNsb3NlYCB3aWxsIG5vdCBmaXJlIGJlY2F1c2VcbiAgICAvLyBhbiBvcGVuIGV2ZW50IG5ldmVyIGhhcHBlbmVkXG4gICAgdGhpcy5jbGVhbnVwKCk7XG4gIH1cbiAgdGhpcy5iYWNrb2ZmLnJlc2V0KCk7XG4gIHRoaXMucmVhZHlTdGF0ZSA9ICdjbG9zZWQnO1xuICBpZiAodGhpcy5lbmdpbmUpIHRoaXMuZW5naW5lLmNsb3NlKCk7XG59O1xuXG4vKipcbiAqIENhbGxlZCB1cG9uIGVuZ2luZSBjbG9zZS5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5NYW5hZ2VyLnByb3RvdHlwZS5vbmNsb3NlID0gZnVuY3Rpb24gKHJlYXNvbikge1xuICBkZWJ1Zygnb25jbG9zZScpO1xuXG4gIHRoaXMuY2xlYW51cCgpO1xuICB0aGlzLmJhY2tvZmYucmVzZXQoKTtcbiAgdGhpcy5yZWFkeVN0YXRlID0gJ2Nsb3NlZCc7XG4gIHRoaXMuZW1pdCgnY2xvc2UnLCByZWFzb24pO1xuXG4gIGlmICh0aGlzLl9yZWNvbm5lY3Rpb24gJiYgIXRoaXMuc2tpcFJlY29ubmVjdCkge1xuICAgIHRoaXMucmVjb25uZWN0KCk7XG4gIH1cbn07XG5cbi8qKlxuICogQXR0ZW1wdCBhIHJlY29ubmVjdGlvbi5cbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5NYW5hZ2VyLnByb3RvdHlwZS5yZWNvbm5lY3QgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0aGlzLnJlY29ubmVjdGluZyB8fCB0aGlzLnNraXBSZWNvbm5lY3QpIHJldHVybiB0aGlzO1xuXG4gIHZhciBzZWxmID0gdGhpcztcblxuICBpZiAodGhpcy5iYWNrb2ZmLmF0dGVtcHRzID49IHRoaXMuX3JlY29ubmVjdGlvbkF0dGVtcHRzKSB7XG4gICAgZGVidWcoJ3JlY29ubmVjdCBmYWlsZWQnKTtcbiAgICB0aGlzLmJhY2tvZmYucmVzZXQoKTtcbiAgICB0aGlzLmVtaXRBbGwoJ3JlY29ubmVjdF9mYWlsZWQnKTtcbiAgICB0aGlzLnJlY29ubmVjdGluZyA9IGZhbHNlO1xuICB9IGVsc2Uge1xuICAgIHZhciBkZWxheSA9IHRoaXMuYmFja29mZi5kdXJhdGlvbigpO1xuICAgIGRlYnVnKCd3aWxsIHdhaXQgJWRtcyBiZWZvcmUgcmVjb25uZWN0IGF0dGVtcHQnLCBkZWxheSk7XG5cbiAgICB0aGlzLnJlY29ubmVjdGluZyA9IHRydWU7XG4gICAgdmFyIHRpbWVyID0gc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XG4gICAgICBpZiAoc2VsZi5za2lwUmVjb25uZWN0KSByZXR1cm47XG5cbiAgICAgIGRlYnVnKCdhdHRlbXB0aW5nIHJlY29ubmVjdCcpO1xuICAgICAgc2VsZi5lbWl0QWxsKCdyZWNvbm5lY3RfYXR0ZW1wdCcsIHNlbGYuYmFja29mZi5hdHRlbXB0cyk7XG4gICAgICBzZWxmLmVtaXRBbGwoJ3JlY29ubmVjdGluZycsIHNlbGYuYmFja29mZi5hdHRlbXB0cyk7XG5cbiAgICAgIC8vIGNoZWNrIGFnYWluIGZvciB0aGUgY2FzZSBzb2NrZXQgY2xvc2VkIGluIGFib3ZlIGV2ZW50c1xuICAgICAgaWYgKHNlbGYuc2tpcFJlY29ubmVjdCkgcmV0dXJuO1xuXG4gICAgICBzZWxmLm9wZW4oZnVuY3Rpb24gKGVycikge1xuICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgZGVidWcoJ3JlY29ubmVjdCBhdHRlbXB0IGVycm9yJyk7XG4gICAgICAgICAgc2VsZi5yZWNvbm5lY3RpbmcgPSBmYWxzZTtcbiAgICAgICAgICBzZWxmLnJlY29ubmVjdCgpO1xuICAgICAgICAgIHNlbGYuZW1pdEFsbCgncmVjb25uZWN0X2Vycm9yJywgZXJyLmRhdGEpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGRlYnVnKCdyZWNvbm5lY3Qgc3VjY2VzcycpO1xuICAgICAgICAgIHNlbGYub25yZWNvbm5lY3QoKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSwgZGVsYXkpO1xuXG4gICAgdGhpcy5zdWJzLnB1c2goe1xuICAgICAgZGVzdHJveTogZnVuY3Rpb24gKCkge1xuICAgICAgICBjbGVhclRpbWVvdXQodGltZXIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG59O1xuXG4vKipcbiAqIENhbGxlZCB1cG9uIHN1Y2Nlc3NmdWwgcmVjb25uZWN0LlxuICpcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbk1hbmFnZXIucHJvdG90eXBlLm9ucmVjb25uZWN0ID0gZnVuY3Rpb24gKCkge1xuICB2YXIgYXR0ZW1wdCA9IHRoaXMuYmFja29mZi5hdHRlbXB0cztcbiAgdGhpcy5yZWNvbm5lY3RpbmcgPSBmYWxzZTtcbiAgdGhpcy5iYWNrb2ZmLnJlc2V0KCk7XG4gIHRoaXMudXBkYXRlU29ja2V0SWRzKCk7XG4gIHRoaXMuZW1pdEFsbCgncmVjb25uZWN0JywgYXR0ZW1wdCk7XG59O1xuIiwiXG4vKipcbiAqIE1vZHVsZSBkZXBlbmRlbmNpZXMuXG4gKi9cblxudmFyIHVybCA9IHJlcXVpcmUoJy4vdXJsJyk7XG52YXIgcGFyc2VyID0gcmVxdWlyZSgnc29ja2V0LmlvLXBhcnNlcicpO1xudmFyIE1hbmFnZXIgPSByZXF1aXJlKCcuL21hbmFnZXInKTtcbnZhciBkZWJ1ZyA9IHJlcXVpcmUoJ2RlYnVnJykoJ3NvY2tldC5pby1jbGllbnQnKTtcblxuLyoqXG4gKiBNb2R1bGUgZXhwb3J0cy5cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV4cG9ydHMgPSBsb29rdXA7XG5cbi8qKlxuICogTWFuYWdlcnMgY2FjaGUuXG4gKi9cblxudmFyIGNhY2hlID0gZXhwb3J0cy5tYW5hZ2VycyA9IHt9O1xuXG4vKipcbiAqIExvb2tzIHVwIGFuIGV4aXN0aW5nIGBNYW5hZ2VyYCBmb3IgbXVsdGlwbGV4aW5nLlxuICogSWYgdGhlIHVzZXIgc3VtbW9uczpcbiAqXG4gKiAgIGBpbygnaHR0cDovL2xvY2FsaG9zdC9hJyk7YFxuICogICBgaW8oJ2h0dHA6Ly9sb2NhbGhvc3QvYicpO2BcbiAqXG4gKiBXZSByZXVzZSB0aGUgZXhpc3RpbmcgaW5zdGFuY2UgYmFzZWQgb24gc2FtZSBzY2hlbWUvcG9ydC9ob3N0LFxuICogYW5kIHdlIGluaXRpYWxpemUgc29ja2V0cyBmb3IgZWFjaCBuYW1lc3BhY2UuXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBsb29rdXAgKHVyaSwgb3B0cykge1xuICBpZiAodHlwZW9mIHVyaSA9PT0gJ29iamVjdCcpIHtcbiAgICBvcHRzID0gdXJpO1xuICAgIHVyaSA9IHVuZGVmaW5lZDtcbiAgfVxuXG4gIG9wdHMgPSBvcHRzIHx8IHt9O1xuXG4gIHZhciBwYXJzZWQgPSB1cmwodXJpKTtcbiAgdmFyIHNvdXJjZSA9IHBhcnNlZC5zb3VyY2U7XG4gIHZhciBpZCA9IHBhcnNlZC5pZDtcbiAgdmFyIHBhdGggPSBwYXJzZWQucGF0aDtcbiAgdmFyIHNhbWVOYW1lc3BhY2UgPSBjYWNoZVtpZF0gJiYgcGF0aCBpbiBjYWNoZVtpZF0ubnNwcztcbiAgdmFyIG5ld0Nvbm5lY3Rpb24gPSBvcHRzLmZvcmNlTmV3IHx8IG9wdHNbJ2ZvcmNlIG5ldyBjb25uZWN0aW9uJ10gfHxcbiAgICAgICAgICAgICAgICAgICAgICBmYWxzZSA9PT0gb3B0cy5tdWx0aXBsZXggfHwgc2FtZU5hbWVzcGFjZTtcblxuICB2YXIgaW87XG5cbiAgaWYgKG5ld0Nvbm5lY3Rpb24pIHtcbiAgICBkZWJ1ZygnaWdub3Jpbmcgc29ja2V0IGNhY2hlIGZvciAlcycsIHNvdXJjZSk7XG4gICAgaW8gPSBNYW5hZ2VyKHNvdXJjZSwgb3B0cyk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKCFjYWNoZVtpZF0pIHtcbiAgICAgIGRlYnVnKCduZXcgaW8gaW5zdGFuY2UgZm9yICVzJywgc291cmNlKTtcbiAgICAgIGNhY2hlW2lkXSA9IE1hbmFnZXIoc291cmNlLCBvcHRzKTtcbiAgICB9XG4gICAgaW8gPSBjYWNoZVtpZF07XG4gIH1cbiAgaWYgKHBhcnNlZC5xdWVyeSAmJiAhb3B0cy5xdWVyeSkge1xuICAgIG9wdHMucXVlcnkgPSBwYXJzZWQucXVlcnk7XG4gIH1cbiAgcmV0dXJuIGlvLnNvY2tldChwYXJzZWQucGF0aCwgb3B0cyk7XG59XG5cbi8qKlxuICogUHJvdG9jb2wgdmVyc2lvbi5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmV4cG9ydHMucHJvdG9jb2wgPSBwYXJzZXIucHJvdG9jb2w7XG5cbi8qKlxuICogYGNvbm5lY3RgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSB1cmlcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZXhwb3J0cy5jb25uZWN0ID0gbG9va3VwO1xuXG4vKipcbiAqIEV4cG9zZSBjb25zdHJ1Y3RvcnMgZm9yIHN0YW5kYWxvbmUgYnVpbGQuXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5leHBvcnRzLk1hbmFnZXIgPSByZXF1aXJlKCcuL21hbmFnZXInKTtcbmV4cG9ydHMuU29ja2V0ID0gcmVxdWlyZSgnLi9zb2NrZXQnKTtcbiIsIjxzY3JpcHQ+XHJcbiAgaW1wb3J0IHsgb25Nb3VudCB9IGZyb20gXCJzdmVsdGVcIjtcclxuICBpbXBvcnQgaW8gZnJvbSBcInNvY2tldC5pby1jbGllbnRcIjtcclxuXHJcbiAgbGV0IGNvbm5lY3Rpb24gPSBudWxsO1xyXG5cclxuICBsZXQgc3RhdGVzID0gW107XHJcblxyXG4gIG9uTW91bnQoKCkgPT4ge1xyXG4gICAgY29ubmVjdGlvbiA9IGlvKCk7XHJcblxyXG4gICAgY29ubmVjdGlvbi5vbihcInVwZGF0ZVwiLCBwYXlsb2FkID0+IHtcclxuICAgICAgc3RhdGVzID0gcGF5bG9hZC5zdGF0ZXM7XHJcbiAgICB9KTtcclxuICB9KTtcclxuXHJcbiAgZnVuY3Rpb24gYWN0aXZhdGUoc3RhdGUpIHtcclxuICAgIGNvbm5lY3Rpb24uZW1pdChcImFjdGl2YXRlXCIsIHsgaWQ6IHN0YXRlLmlkIH0pO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gdXBkYXRlTmFtZShldnQsIHN0YXRlKSB7XHJcbiAgICBjb25uZWN0aW9uLmVtaXQoXCJyZW5hbWVcIiwge1xyXG4gICAgICBpZDogc3RhdGUuaWQsXHJcbiAgICAgIG5hbWU6IGV2dC5zcmNFbGVtZW50LnZhbHVlXHJcbiAgICB9KTtcclxuICB9XHJcbjwvc2NyaXB0PlxyXG5cclxuPHN0eWxlPlxyXG4gIC5tYWluIHtcclxuICAgIHdpZHRoOiAxMDAlO1xyXG4gICAgaGVpZ2h0OiAxMDAlO1xyXG4gICAgZGlzcGxheTogZmxleDtcclxuICAgIGZsZXgtZGlyZWN0aW9uOiByb3c7XHJcbiAgICBmbGV4LXdyYXA6IHdyYXA7XHJcbiAgfVxyXG4gIC5pdGVtIHtcclxuICAgIGN1cnNvcjogcG9pbnRlcjtcclxuICAgIC8qIHdpZHRoOiAyMDBweDsgKi9cclxuICAgIC8qIGhlaWdodDogMTAwcHg7ICovXHJcbiAgICBiYWNrZ3JvdW5kOiBsaWdodGdyYXk7XHJcbiAgICBib3JkZXI6IDJweCBzb2xpZCBibGFjaztcclxuICAgIGZvbnQtc2l6ZTogMzBweDtcclxuICAgIC8qIG1heC1oZWlnaHQ6IDUwJTsgKi9cclxuICAgIC8qIGZsZXg6IDAgNTAlOyAqL1xyXG4gICAgLyogd2lkdGg6IDEwMCU7ICovXHJcbiAgICAvKiBoZWlnaHQ6IDEwMCU7ICovXHJcbiAgICBmbGV4OiAxIDAgNDklO1xyXG4gIH1cclxuXHJcbiAgLml0ZW0uYWN0aXZlIHtcclxuICAgIGJvcmRlcjogMnB4IHNvbGlkIHJlZDtcclxuICAgIGJhY2tncm91bmQ6IGdyYXk7XHJcbiAgfVxyXG5cclxuICAuaXRlbS5zdG9wIHtcclxuICAgIGZvbnQtc2l6ZTogMzBweDtcclxuICAgIGZvbnQtd2VpZ2h0OiBib2xkO1xyXG4gIH1cclxuPC9zdHlsZT5cclxuXHJcbjxkaXYgY2xhc3M9XCJtYWluXCI+XHJcbiAgeyNlYWNoIHN0YXRlcyBhcyBzdGF0ZX1cclxuICAgIDxkaXZcclxuICAgICAgY2xhc3M9XCJpdGVtXCJcclxuICAgICAgY2xhc3M6YWN0aXZlPXtzdGF0ZS5hY3RpdmF0ZWR9XHJcbiAgICAgIG9uOmNsaWNrPXsoKSA9PiBhY3RpdmF0ZShzdGF0ZSl9PlxyXG4gICAgICA8aW5wdXRcclxuICAgICAgICBvbjpjbGlja3xzdG9wUHJvcGFnYXRpb25cclxuICAgICAgICB2YWx1ZT17c3RhdGUubmFtZX1cclxuICAgICAgICBvbjpjaGFuZ2U9e2V2dCA9PiB1cGRhdGVOYW1lKGV2dCwgc3RhdGUpfSAvPlxyXG4gICAgICA8ZGl2PlxyXG4gICAgICAgIHtNYXRoLmZsb29yKHN0YXRlLnRpbWUgLyA2MCkucGFkKDIpfTp7TWF0aC5mbG9vcihzdGF0ZS50aW1lICUgNjApLnBhZCgyKX1cclxuICAgICAgPC9kaXY+XHJcbiAgICA8L2Rpdj5cclxuICB7L2VhY2h9XHJcblxyXG4gIDxkaXYgY2xhc3M9XCJpdGVtIHN0b3BcIiBvbjpjbGljaz17KCkgPT4gYWN0aXZhdGUoe30pfT5QQVVTRTwvZGl2PlxyXG48L2Rpdj5cclxuIiwiaW1wb3J0IE1haW5WaWV3IGZyb20gXCIuL3RpbWVyLnN2ZWx0ZVwiO1xyXG5OdW1iZXIucHJvdG90eXBlLnBhZCA9IGZ1bmN0aW9uKHNpemUpIHtcclxuICB2YXIgcyA9IFN0cmluZyh0aGlzKTtcclxuICB3aGlsZSAocy5sZW5ndGggPCAoc2l6ZSB8fCAyKSkgeyBzID0gXCIwXCIgKyBzOyB9XHJcbiAgcmV0dXJuIHM7XHJcbn1cclxuXHJcbmNvbnN0IHJlbmRlclRhcmdldCA9IG5ldyBNYWluVmlldyh7XHJcbiAgdGFyZ2V0OiBkb2N1bWVudC5ib2R5LFxyXG4gIHByb3BzOiB7XHJcbiAgICB0ZXN0OiBcInNkZmRzZlwiXHJcbiAgfVxyXG59KTsiXSwibmFtZXMiOlsiZ2xvYmFsIiwibm9vcCIsInJlcXVpcmUkJDAiLCJzIiwibSIsImgiLCJkIiwieSIsInBhcnNlIiwiZm10TG9uZyIsImZtdFNob3J0IiwicGx1cmFsIiwiaW5pdCIsInRvU3RyaW5nIiwiYmFzZTY0LmZyb21CeXRlQXJyYXkiLCJpZWVlNzU0LnJlYWQiLCJpZWVlNzU0LndyaXRlIiwiYmFzZTY0LnRvQnl0ZUFycmF5IiwiQnVmZmVyLmlzQnVmZmVyIiwiaXNCdWYiLCJpc0FycmF5IiwiRW1pdHRlciIsImhhc0NPUlMiLCJnbG9iYWxUaGlzIiwid2l0aE5hdGl2ZUJsb2IiLCJ3aXRoTmF0aXZlRmlsZSIsIkJsb2IiLCJibG9iIiwic2xpY2VCdWZmZXIiLCJoYXNCaW5hcnkiLCJhZnRlciIsInBhcnNlciIsImVuY29kZSIsImRlY29kZSIsImRlYnVnIiwicmVxdWlyZSQkMSIsIlRyYW5zcG9ydCIsImluaGVyaXQiLCJ5ZWFzdCIsIlBvbGxpbmciLCJYTUxIdHRwUmVxdWVzdCIsImVtcHR5IiwicG9sbGluZyIsIlhIUiIsIkpTT05QIiwiaW5kZXgiLCJvbiIsImJpbmQiLCJ0b0FycmF5IiwiaGFzQmluIiwiQmFja29mZiIsImVpbyIsIlNvY2tldCIsImluZGV4T2YiLCJ1cmwiLCJNYW5hZ2VyIiwiaW8iLCJNYWluVmlldyJdLCJtYXBwaW5ncyI6Ijs7O0lBQUEsU0FBUyxJQUFJLEdBQUcsR0FBRztBQUNuQixJQWVBLFNBQVMsR0FBRyxDQUFDLEVBQUUsRUFBRTtJQUNqQixJQUFJLE9BQU8sRUFBRSxFQUFFLENBQUM7SUFDaEIsQ0FBQztJQUNELFNBQVMsWUFBWSxHQUFHO0lBQ3hCLElBQUksT0FBTyxNQUFNLENBQUMsTUFB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T0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxHQUFHLENBQUM7SUFDcEMsR0FBRztJQUNILEVBQUUsSUFBSSxLQUFLLElBQUksQ0FBQyxFQUFFO0lBQ2xCLElBQUksT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxHQUFHLENBQUM7SUFDcEMsR0FBRztJQUNILEVBQUUsSUFBSSxLQUFLLElBQUksQ0FBQyxFQUFFO0lBQ2xCLElBQUksT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxHQUFHLENBQUM7SUFDcEMsR0FBRztJQUNILEVBQUUsSUFBSSxLQUFLLElBQUksQ0FBQyxFQUFFO0lBQ2xCLElBQUksT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxHQUFHLENBQUM7SUFDcEMsR0FBRztJQUNILEVBQUUsT0FBTyxFQUFFLEdBQUcsSUFBSSxDQUFDO0lBQ25CLENBQUM7O0lBRUQ7SUFDQTtJQUNBO0lBQ0E7SUFDQTtJQUNBO0lBQ0E7O0lBRUEsU0FBUyxPQUFPLENBQUMsRUFBRSxFQUFFO0lBQ3JCLEVBQUUsSUFBSSxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUMzQixFQUFFLElBQUksS0FBSyxJQUFJLENBQUMsRUFBRTtJQUNsQixJQUFJLE9BQU8sTUFBTSxDQUFDLEVBQUUsRUFBRSxLQUFLLEVBQUUsQ0FBQyxFQUFFLEtBQUssQ0FBQyxDQUFDO0lBQ3ZDLEdBQUc7SUFDSCxFQUFFLElBQUksS0FBSyxJQUFJLENBQUMsRUFBRTtJQUNsQixJQUFJLE9BQU8sTUFBTSxDQUFDLEVBQUUsRUFBRSxLQUFLLEVBQUUsQ0FBQyxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQ3hDLEdBQUc7SUFDSCxFQUFFLElBQUksS0FBSyxJQUFJLENBQUMsRUFBRTtJQUNsQixJQUFJLE9BQU8sTUFBTSxDQUFDLEVBQUUsRUFB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cEIsaUJBQWlCLEdBQUcsU0FBUyxDQUFDO0lBQzlCLGVBQWUsR0FBRyxZQUFZLEVBQUUsQ0FBQzs7Ozs7O0lBTWpDLGNBQWMsR0FBRztLQUNoQixTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsU0FBUztLQUNULFNBQVM7S0FDVCxTQUFTO0tBQ1QsQ0FBQzs7Ozs7Ozs7Ozs7SUFXRixTQUFTLFNBQVMsR0FBRzs7OztLQUlwQixJQUFJLE9BQU8sTUFB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Q0FBQztJQUNYLEdBQUc7SUFDSCxFQUFFLElBQUksQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsR0FBRyxFQUFFLFlBQVksRUFBRSxJQUFHO0lBQ3JDLEVBQUUsSUFBSSxHQUFHLEdBQUcsR0FBRyxDQUFDLE9BQU07O0lBRXRCLEVBQUUsSUFBSSxHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUMsRUFBRTtJQUNuQixJQUFJLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0RBQWdELENBQUM7SUFDckUsR0FBRzs7SUFFSDtJQUNBO0lBQ0E7SUFDQTtJQUNBO0lBQ0EsRUFBRSxZQUFZLEdBQUcsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsS0FBSyxHQUFHLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLEtBQUssR0FBRyxHQUFHLENBQUMsR0FBRyxFQUFDOztJQUV4RTtJQUNBLEVBQUUsR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLEdBQUcsQ0FBQyxHQUFHLFlBQVksRUFBQzs7SUFFM0M7SUFDQSxFQUFFLENBQUMsR0FBRyxZQUFZLEdBQUcsQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFDLEdBQUcsSUFBRzs7SUFFdEMsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFDOztJQUVYLEVBQUUsS0FBSyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUU7SUFDNUMsSUFBSSxHQUFHLEdBQUcsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUUsS0FBSyxTQUFTLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsSUFBSSxTQUFTLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFD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Q0FBQyxHQUFHLEdBQUcsR0FBRyxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUUsS0FBSyxJQUFJLENBQUMsRUFBRSxFQUFFOztJQUU1RSxFQUFFLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUM7SUFDL0IsRUFBRSxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUM7SUFDaEIsRUFBRSxLQUFLLElBQUksS0FBSTtJQUNmLEVBQUUsT0FBTyxLQUFLLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxHQUFHLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsRUFBRSxLQUFLLElBQUksQ0FBQyxFQUFFLEVBQUU7O0lBRTVFLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFO0lBQ2YsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLE1BQUs7SUFDakIsR0FBRyxNQUFNLElBQUksQ0FBQyxLQUFLLElBQUksRUFBRTtJQUN6QixJQUFJLE9BQU8sQ0FBQyxHQUFHLEdBQUcsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksUUFBUSxDQUFDO0lBQzlDLEdBQUcsTUFBTTtJQUNULElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxJQUFJLEVBQUM7SUFDN0IsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLE1BQUs7SUFDakIsR0FBRztJQUNILEVBQUUsT0FBTyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUM7SUFDakQsQ0FBQzs7QUFFRCxJQUFPLFNBQVMsS0FBSyxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFO0lBQ2xFLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUM7SUFDYixFQUFFLElBQUksSUFBSSxHQUFHLE1BQU0sR0FBRyxDQUFDLEdBQUcsSUFBSSxHQUFHLEVBQUM7SUFDbEMsRUFBRSxJQUFJLElBQUksR0FBRyxDQUFDLENBQUMsSUFBSSxJQUFJLElBQUksRUFBQztJQUM1QixFQUFFLElBQUksS0FBSyxHQUFHLElBQUksSUFBSSxFQUFDO0lBQ3ZCLEVBQUUsSUFBSSxFQUFFLElBQUksSUFBSSxLQUFLLEVBQUUsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxFQUFDO0lBQ2xFLEVBQUUsSUFBSSxDQUFDLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxNQUFNLEdBQUcsQ0FBQyxFQUFDO0lBQ2pDLEVBQUUsSUFBSSxDQUFDLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLEVBQUM7SUFDdkIsRUFBRSxJQUFJLENBQUMsR0FBRyxLQUFLLEdBQUcsQ0FBQyxLQUFLLEtBQUssS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLEtBQUssR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBQzs7SUFFN0QsRUFBRSxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUM7O0lBRXpCLEVBQUUsSUFBSSxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksS0FBSyxLQUFLLFFBQVEsRUFBRTtJQUMxQyxJQUFJLENBQUMsR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUM7SUFDNUIsSUFBSSxDQUFDLEdBQUcsS0FBSTtJQUNaLEdBQUcsTUFBTTtJQUNULElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFL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QUMsUUFBUSxFQUFFLFdBQVcsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUM7TUFDbEQsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDO01BQ3BCOztJQUVELE1BQU0sQ0FBQyxTQUFTLENBQUMsWUFBWSxHQUFHLFNBQVMsWUFBWSxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUU7TUFDdkUsSUFBSSxDQUFDLFFBQVEsRUFBRSxXQUFXLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFDO01BQ2xELE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO01BQzlDOztJQUVELE1BQU0sQ0FBQyxTQUFTLENBQUMsWUFBWSxHQUFHLFNBQVMsWUFBWSxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUU7TUFDdkUsSUFBSSxDQUFDLFFBQVEsRUFBRSxXQUFXLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFDO01BQ2xELE9BQU8sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO01BQzlDOztJQUVELE1BQU0sQ0FBQyxTQUFTLENBQUMsWUFBWSxHQUFHLFNBQVMsWUFBWSxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUU7TUFDdkUsSUFBSSxDQUFDLFFBQVEsRUFBRSxXQUFXLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFDOztNQUVsRCxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDO1dBQ2hCLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO1dBQ3RCLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO1dBQ3ZCLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLEdBQUcs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Q0FBQyxJQUFJLEVBQUUsQ0FBQztTQUN2QixJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztNQUMzQjs7SUFFRCxNQUFNLENBQUMsU0FBUyxDQUFDLFdBQVcsR0FBRyxTQUFTLFdBQVcsRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFO01BQ3JFLElBQUksQ0FBQyxRQUFRLEVBQUUsV0FBVyxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBQzs7TUFFbEQsT0FBTyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFO1NBQ3ZCLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO1NBQ3ZCLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO1NBQ3RCLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUM7TUFDckI7O0lBRUQsTUFBTSxDQUFDLFNBQVMsQ0FBQyxXQUFXLEdBQUcsU0FBUyxXQUFXLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRTtNQUNyRSxJQUFJLENBQUMsUUFBUSxFQUFFLFdBQVcsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUM7TUFDbEQsT0FBT0MsSUFBWSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUM7TUFDL0M7O0lBRUQsTUFBTSxDQUFDLFNBQVMsQ0FBQyxXQUFXLEdBQUcsU0FBUyxXQUFXLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRTtNQUNyRSxJQUFJLENBQUMsUUFBUSxFQUFFLFdBQVcsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUM7TUFDbEQsT0FBT0EsSUFBWSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUM7TUFDaEQ7O0lBRUQsTUFBTSxDQUFDLFNBQVMsQ0FBQyxZQUFZ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QVMsT0FBTyxDQUFDLElBQUksRUFBRTtJQUN2QixFQUFFLElBQUksR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDO0lBQ3BCLEVBQUUsSUFBSSxDQUFDLEVBQUUsR0FBRyxJQUFJLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQztJQUM1QixFQUFFLElBQUksQ0FBQyxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsSUFBSSxLQUFLLENBQUM7SUFDL0IsRUFBRSxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQyxNQUFNLElBQUksQ0FBQyxDQUFDO0lBQ2pDLEVBQUUsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsTUFBTSxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQztJQUN0RSxFQUFFLElBQUksQ0FBQyxRQUFRLEdBQUcsQ0FBQyxDQUFDO0lBQ3BCLENBQUM7O0lBRUQ7SUFDQTtJQUNBO0lBQ0E7SUFDQTtJQUNBOztJQUVBLE9BQU8sQ0FBQyxTQUFTLENBQUMsUUFBUSxHQUFHLFVBQVU7SUFDdkMsRUFBRSxJQUFJLEVBQUUsR0FBRyxJQUFJLENBQUMsRUFBRSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQztJQUM1RCxFQUFFLElBQUksSUFBSSxDQUFDLE1BQU0sRUFBRTtJQUNuQixJQUFJLElBQUksSUFBSSxJQUFJLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztJQUM5QixJQUFJLElBQUksU0FBUyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQyxNQUFNLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDeEQsSUFBSSxFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksR0FBRyxFQUFFLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsR0FBRyxTQUFTLEdBQUcsRUFB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
