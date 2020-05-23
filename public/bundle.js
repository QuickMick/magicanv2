(function () {
  'use strict';

  var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) {
    return typeof obj;
  } : function (obj) {
    return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj;
  };

  var jsx = function () {
    var REACT_ELEMENT_TYPE = typeof Symbol === "function" && Symbol.for && Symbol.for("react.element") || 0xeac7;
    return function createRawReactElement(type, props, key, children) {
      var defaultProps = type && type.defaultProps;
      var childrenLength = arguments.length - 3;

      if (!props && childrenLength !== 0) {
        props = {};
      }

      if (props && defaultProps) {
        for (var propName in defaultProps) {
          if (props[propName] === void 0) {
            props[propName] = defaultProps[propName];
          }
        }
      } else if (!props) {
        props = defaultProps || {};
      }

      if (childrenLength === 1) {
        props.children = children;
      } else if (childrenLength > 1) {
        var childArray = Array(childrenLength);

        for (var i = 0; i < childrenLength; i++) {
          childArray[i] = arguments[i + 3];
        }

        props.children = childArray;
      }

      return {
        $$typeof: REACT_ELEMENT_TYPE,
        type: type,
        key: key === undefined ? null : '' + key,
        ref: null,
        props: props,
        _owner: null
      };
    };
  }();

  var asyncIterator = function (iterable) {
    if (typeof Symbol === "function") {
      if (Symbol.asyncIterator) {
        var method = iterable[Symbol.asyncIterator];
        if (method != null) return method.call(iterable);
      }

      if (Symbol.iterator) {
        return iterable[Symbol.iterator]();
      }
    }

    throw new TypeError("Object is not async iterable");
  };

  var asyncGenerator = function () {
    function AwaitValue(value) {
      this.value = value;
    }

    function AsyncGenerator(gen) {
      var front, back;

      function send(key, arg) {
        return new Promise(function (resolve, reject) {
          var request = {
            key: key,
            arg: arg,
            resolve: resolve,
            reject: reject,
            next: null
          };

          if (back) {
            back = back.next = request;
          } else {
            front = back = request;
            resume(key, arg);
          }
        });
      }

      function resume(key, arg) {
        try {
          var result = gen[key](arg);
          var value = result.value;

          if (value instanceof AwaitValue) {
            Promise.resolve(value.value).then(function (arg) {
              resume("next", arg);
            }, function (arg) {
              resume("throw", arg);
            });
          } else {
            settle(result.done ? "return" : "normal", result.value);
          }
        } catch (err) {
          settle("throw", err);
        }
      }

      function settle(type, value) {
        switch (type) {
          case "return":
            front.resolve({
              value: value,
              done: true
            });
            break;

          case "throw":
            front.reject(value);
            break;

          default:
            front.resolve({
              value: value,
              done: false
            });
            break;
        }

        front = front.next;

        if (front) {
          resume(front.key, front.arg);
        } else {
          back = null;
        }
      }

      this._invoke = send;

      if (typeof gen.return !== "function") {
        this.return = undefined;
      }
    }

    if (typeof Symbol === "function" && Symbol.asyncIterator) {
      AsyncGenerator.prototype[Symbol.asyncIterator] = function () {
        return this;
      };
    }

    AsyncGenerator.prototype.next = function (arg) {
      return this._invoke("next", arg);
    };

    AsyncGenerator.prototype.throw = function (arg) {
      return this._invoke("throw", arg);
    };

    AsyncGenerator.prototype.return = function (arg) {
      return this._invoke("return", arg);
    };

    return {
      wrap: function (fn) {
        return function () {
          return new AsyncGenerator(fn.apply(this, arguments));
        };
      },
      await: function (value) {
        return new AwaitValue(value);
      }
    };
  }();

  var asyncGeneratorDelegate = function (inner, awaitWrap) {
    var iter = {},
        waiting = false;

    function pump(key, value) {
      waiting = true;
      value = new Promise(function (resolve) {
        resolve(inner[key](value));
      });
      return {
        done: false,
        value: awaitWrap(value)
      };
    }

    if (typeof Symbol === "function" && Symbol.iterator) {
      iter[Symbol.iterator] = function () {
        return this;
      };
    }

    iter.next = function (value) {
      if (waiting) {
        waiting = false;
        return value;
      }

      return pump("next", value);
    };

    if (typeof inner.throw === "function") {
      iter.throw = function (value) {
        if (waiting) {
          waiting = false;
          throw value;
        }

        return pump("throw", value);
      };
    }

    if (typeof inner.return === "function") {
      iter.return = function (value) {
        return pump("return", value);
      };
    }

    return iter;
  };

  var asyncToGenerator = function (fn) {
    return function () {
      var gen = fn.apply(this, arguments);
      return new Promise(function (resolve, reject) {
        function step(key, arg) {
          try {
            var info = gen[key](arg);
            var value = info.value;
          } catch (error) {
            reject(error);
            return;
          }

          if (info.done) {
            resolve(value);
          } else {
            return Promise.resolve(value).then(function (value) {
              step("next", value);
            }, function (err) {
              step("throw", err);
            });
          }
        }

        return step("next");
      });
    };
  };

  var classCallCheck = function (instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  };

  var createClass = function () {
    function defineProperties(target, props) {
      for (var i = 0; i < props.length; i++) {
        var descriptor = props[i];
        descriptor.enumerable = descriptor.enumerable || false;
        descriptor.configurable = true;
        if ("value" in descriptor) descriptor.writable = true;
        Object.defineProperty(target, descriptor.key, descriptor);
      }
    }

    return function (Constructor, protoProps, staticProps) {
      if (protoProps) defineProperties(Constructor.prototype, protoProps);
      if (staticProps) defineProperties(Constructor, staticProps);
      return Constructor;
    };
  }();

  var defineEnumerableProperties = function (obj, descs) {
    for (var key in descs) {
      var desc = descs[key];
      desc.configurable = desc.enumerable = true;
      if ("value" in desc) desc.writable = true;
      Object.defineProperty(obj, key, desc);
    }

    return obj;
  };

  var defaults = function (obj, defaults) {
    var keys = Object.getOwnPropertyNames(defaults);

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var value = Object.getOwnPropertyDescriptor(defaults, key);

      if (value && value.configurable && obj[key] === undefined) {
        Object.defineProperty(obj, key, value);
      }
    }

    return obj;
  };

  var defineProperty = function (obj, key, value) {
    if (key in obj) {
      Object.defineProperty(obj, key, {
        value: value,
        enumerable: true,
        configurable: true,
        writable: true
      });
    } else {
      obj[key] = value;
    }

    return obj;
  };

  var _extends = Object.assign || function (target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];

      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          target[key] = source[key];
        }
      }
    }

    return target;
  };

  var get = function get(object, property, receiver) {
    if (object === null) object = Function.prototype;
    var desc = Object.getOwnPropertyDescriptor(object, property);

    if (desc === undefined) {
      var parent = Object.getPrototypeOf(object);

      if (parent === null) {
        return undefined;
      } else {
        return get(parent, property, receiver);
      }
    } else if ("value" in desc) {
      return desc.value;
    } else {
      var getter = desc.get;

      if (getter === undefined) {
        return undefined;
      }

      return getter.call(receiver);
    }
  };

  var inherits = function (subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
      throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
    }

    subClass.prototype = Object.create(superClass && superClass.prototype, {
      constructor: {
        value: subClass,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
    if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
  };

  var _instanceof = function (left, right) {
    if (right != null && typeof Symbol !== "undefined" && right[Symbol.hasInstance]) {
      return right[Symbol.hasInstance](left);
    } else {
      return left instanceof right;
    }
  };

  var interopRequireDefault = function (obj) {
    return obj && obj.__esModule ? obj : {
      default: obj
    };
  };

  var interopRequireWildcard = function (obj) {
    if (obj && obj.__esModule) {
      return obj;
    } else {
      var newObj = {};

      if (obj != null) {
        for (var key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key];
        }
      }

      newObj.default = obj;
      return newObj;
    }
  };

  var newArrowCheck = function (innerThis, boundThis) {
    if (innerThis !== boundThis) {
      throw new TypeError("Cannot instantiate an arrow function");
    }
  };

  var objectDestructuringEmpty = function (obj) {
    if (obj == null) throw new TypeError("Cannot destructure undefined");
  };

  var objectWithoutProperties = function (obj, keys) {
    var target = {};

    for (var i in obj) {
      if (keys.indexOf(i) >= 0) continue;
      if (!Object.prototype.hasOwnProperty.call(obj, i)) continue;
      target[i] = obj[i];
    }

    return target;
  };

  var possibleConstructorReturn = function (self, call) {
    if (!self) {
      throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }

    return call && (typeof call === "object" || typeof call === "function") ? call : self;
  };

  var selfGlobal = typeof global === "undefined" ? self : global;

  var set = function set(object, property, value, receiver) {
    var desc = Object.getOwnPropertyDescriptor(object, property);

    if (desc === undefined) {
      var parent = Object.getPrototypeOf(object);

      if (parent !== null) {
        set(parent, property, value, receiver);
      }
    } else if ("value" in desc && desc.writable) {
      desc.value = value;
    } else {
      var setter = desc.set;

      if (setter !== undefined) {
        setter.call(receiver, value);
      }
    }

    return value;
  };

  var slicedToArray = function () {
    function sliceIterator(arr, i) {
      var _arr = [];
      var _n = true;
      var _d = false;
      var _e = undefined;

      try {
        for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) {
          _arr.push(_s.value);

          if (i && _arr.length === i) break;
        }
      } catch (err) {
        _d = true;
        _e = err;
      } finally {
        try {
          if (!_n && _i["return"]) _i["return"]();
        } finally {
          if (_d) throw _e;
        }
      }

      return _arr;
    }

    return function (arr, i) {
      if (Array.isArray(arr)) {
        return arr;
      } else if (Symbol.iterator in Object(arr)) {
        return sliceIterator(arr, i);
      } else {
        throw new TypeError("Invalid attempt to destructure non-iterable instance");
      }
    };
  }();

  var slicedToArrayLoose = function (arr, i) {
    if (Array.isArray(arr)) {
      return arr;
    } else if (Symbol.iterator in Object(arr)) {
      var _arr = [];

      for (var _iterator = arr[Symbol.iterator](), _step; !(_step = _iterator.next()).done;) {
        _arr.push(_step.value);

        if (i && _arr.length === i) break;
      }

      return _arr;
    } else {
      throw new TypeError("Invalid attempt to destructure non-iterable instance");
    }
  };

  var taggedTemplateLiteral = function (strings, raw) {
    return Object.freeze(Object.defineProperties(strings, {
      raw: {
        value: Object.freeze(raw)
      }
    }));
  };

  var taggedTemplateLiteralLoose = function (strings, raw) {
    strings.raw = raw;
    return strings;
  };

  var temporalRef = function (val, name, undef) {
    if (val === undef) {
      throw new ReferenceError(name + " is not defined - temporal dead zone");
    } else {
      return val;
    }
  };

  var temporalUndefined = {};

  var toArray = function (arr) {
    return Array.isArray(arr) ? arr : Array.from(arr);
  };

  var toConsumableArray = function (arr) {
    if (Array.isArray(arr)) {
      for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) arr2[i] = arr[i];

      return arr2;
    } else {
      return Array.from(arr);
    }
  };

  var babelHelpers = /*#__PURE__*/Object.freeze({
    jsx: jsx,
    asyncIterator: asyncIterator,
    asyncGenerator: asyncGenerator,
    asyncGeneratorDelegate: asyncGeneratorDelegate,
    asyncToGenerator: asyncToGenerator,
    classCallCheck: classCallCheck,
    createClass: createClass,
    defineEnumerableProperties: defineEnumerableProperties,
    defaults: defaults,
    defineProperty: defineProperty,
    get: get,
    inherits: inherits,
    interopRequireDefault: interopRequireDefault,
    interopRequireWildcard: interopRequireWildcard,
    newArrowCheck: newArrowCheck,
    objectDestructuringEmpty: objectDestructuringEmpty,
    objectWithoutProperties: objectWithoutProperties,
    possibleConstructorReturn: possibleConstructorReturn,
    selfGlobal: selfGlobal,
    set: set,
    slicedToArray: slicedToArray,
    slicedToArrayLoose: slicedToArrayLoose,
    taggedTemplateLiteral: taggedTemplateLiteral,
    taggedTemplateLiteralLoose: taggedTemplateLiteralLoose,
    temporalRef: temporalRef,
    temporalUndefined: temporalUndefined,
    toArray: toArray,
    toConsumableArray: toConsumableArray,
    typeof: _typeof,
    extends: _extends,
    instanceof: _instanceof
  });

  function noop() {}
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
      return a != a ? b == b : a !== b || a && (typeof a === 'undefined' ? 'undefined' : _typeof(a)) === 'object' || typeof a === 'function';
  }
  function subscribe(store) {
      if (store == null) {
          return noop;
      }

      for (var _len = arguments.length, callbacks = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
          callbacks[_key - 1] = arguments[_key];
      }

      var unsub = store.subscribe.apply(store, callbacks);
      return unsub.unsubscribe ? function () {
          return unsub.unsubscribe();
      } : unsub;
  }
  function component_subscribe(component, store, callback) {
      component.$$.on_destroy.push(subscribe(store, callback));
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
  function element(name) {
      return document.createElement(name);
  }
  function svg_element(name) {
      return document.createElementNS('http://www.w3.org/2000/svg', name);
  }
  function text(data) {
      return document.createTextNode(data);
  }
  function empty() {
      return text('');
  }
  function listen(node, event, handler, options) {
      node.addEventListener(event, handler, options);
      return function () {
          return node.removeEventListener(event, handler, options);
      };
  }
  function prevent_default(fn) {
      return function (event) {
          event.preventDefault();
          // @ts-ignore
          return fn.call(this, event);
      };
  }
  function stop_propagation(fn) {
      return function (event) {
          event.stopPropagation();
          // @ts-ignore
          return fn.call(this, event);
      };
  }
  function attr(node, attribute, value) {
      if (value == null) node.removeAttribute(attribute);else if (node.getAttribute(attribute) !== value) node.setAttribute(attribute, value);
  }
  function children(element) {
      return Array.from(element.childNodes);
  }
  function toggle_class(element, name, toggle) {
      element.classList[toggle ? 'add' : 'remove'](name);
  }

  var HtmlTag = function () {
      function HtmlTag(html) {
          var anchor = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;
          classCallCheck(this, HtmlTag);

          this.e = element('div');
          this.a = anchor;
          this.u(html);
      }

      createClass(HtmlTag, [{
          key: 'm',
          value: function m(target) {
              var anchor = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;

              for (var i = 0; i < this.n.length; i += 1) {
                  insert(target, this.n[i], anchor);
              }
              this.t = target;
          }
      }, {
          key: 'u',
          value: function u(html) {
              this.e.innerHTML = html;
              this.n = Array.from(this.e.childNodes);
          }
      }, {
          key: 'p',
          value: function p(html) {
              this.d();
              this.u(html);
              this.m(this.t, this.a);
          }
      }, {
          key: 'd',
          value: function d() {
              this.n.forEach(detach);
          }
      }]);
      return HtmlTag;
  }();

  var current_component = void 0;
  function set_current_component(component) {
      current_component = component;
  }

  var dirty_components = [];
  var binding_callbacks = [];
  var render_callbacks = [];
  var flush_callbacks = [];
  var resolved_promise = Promise.resolve();
  var update_scheduled = false;
  function schedule_update() {
      if (!update_scheduled) {
          update_scheduled = true;
          resolved_promise.then(flush);
      }
  }
  function add_render_callback(fn) {
      render_callbacks.push(fn);
  }
  var flushing = false;
  var seen_callbacks = new Set();
  function flush() {
      if (flushing) return;
      flushing = true;
      do {
          // first, call beforeUpdate functions
          // and update components
          for (var i = 0; i < dirty_components.length; i += 1) {
              var component = dirty_components[i];
              set_current_component(component);
              update(component.$$);
          }
          dirty_components.length = 0;
          while (binding_callbacks.length) {
              binding_callbacks.pop()();
          } // then, once components are updated, call
          // afterUpdate functions. This may cause
          // subsequent updates...
          for (var _i = 0; _i < render_callbacks.length; _i += 1) {
              var callback = render_callbacks[_i];
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
          var dirty = $$.dirty;
          $$.dirty = [-1];
          $$.fragment && $$.fragment.p($$.ctx, dirty);
          $$.after_update.forEach(add_render_callback);
      }
  }
  var outroing = new Set();
  var outros = void 0;
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
          if (outroing.has(block)) return;
          outroing.add(block);
          outros.c.push(function () {
              outroing.delete(block);
              if (callback) {
                  if (detach) block.d(1);
                  callback();
              }
          });
          block.o(local);
      }
  }
  function outro_and_destroy_block(block, lookup) {
      transition_out(block, 1, 1, function () {
          lookup.delete(block.key);
      });
  }
  function update_keyed_each(old_blocks, dirty, get_key, dynamic, ctx, list, lookup, node, destroy, create_each_block, next, get_context) {
      var o = old_blocks.length;
      var n = list.length;
      var i = o;
      var old_indexes = {};
      while (i--) {
          old_indexes[old_blocks[i].key] = i;
      }var new_blocks = [];
      var new_lookup = new Map();
      var deltas = new Map();
      i = n;
      while (i--) {
          var child_ctx = get_context(ctx, list, i);
          var key = get_key(child_ctx);
          var block = lookup.get(key);
          if (!block) {
              block = create_each_block(key, child_ctx);
              block.c();
          } else if (dynamic) {
              block.p(child_ctx, dirty);
          }
          new_lookup.set(key, new_blocks[i] = block);
          if (key in old_indexes) deltas.set(key, Math.abs(i - old_indexes[key]));
      }
      var will_move = new Set();
      var did_move = new Set();
      function insert(block) {
          transition_in(block, 1);
          block.m(node, next, lookup.has(block.key));
          lookup.set(block.key, block);
          next = block.first;
          n--;
      }
      while (o && n) {
          var new_block = new_blocks[n - 1];
          var old_block = old_blocks[o - 1];
          var new_key = new_block.key;
          var old_key = old_block.key;
          if (new_block === old_block) {
              // do nothing
              next = new_block.first;
              o--;
              n--;
          } else if (!new_lookup.has(old_key)) {
              // remove old block
              destroy(old_block, lookup);
              o--;
          } else if (!lookup.has(new_key) || will_move.has(new_key)) {
              insert(new_block);
          } else if (did_move.has(old_key)) {
              o--;
          } else if (deltas.get(new_key) > deltas.get(old_key)) {
              did_move.add(new_key);
              insert(new_block);
          } else {
              will_move.add(old_key);
              o--;
          }
      }
      while (o--) {
          var _old_block = old_blocks[o];
          if (!new_lookup.has(_old_block.key)) destroy(_old_block, lookup);
      }
      while (n) {
          insert(new_blocks[n - 1]);
      }return new_blocks;
  }
  function create_component(block) {
      block && block.c();
  }
  function mount_component(component, target, anchor) {
      var _component$$$ = component.$$,
          fragment = _component$$$.fragment,
          on_mount = _component$$$.on_mount,
          on_destroy = _component$$$.on_destroy,
          after_update = _component$$$.after_update;

      fragment && fragment.m(target, anchor);
      // onMount happens before the initial afterUpdate
      add_render_callback(function () {
          var new_on_destroy = on_mount.map(run).filter(is_function);
          if (on_destroy) {
              on_destroy.push.apply(on_destroy, toConsumableArray(new_on_destroy));
          } else {
              // Edge case - component was destroyed immediately,
              // most likely as a result of a binding initialising
              run_all(new_on_destroy);
          }
          component.$$.on_mount = [];
      });
      after_update.forEach(add_render_callback);
  }
  function destroy_component(component, detaching) {
      var $$ = component.$$;
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
      component.$$.dirty[i / 31 | 0] |= 1 << i % 31;
  }
  function init(component, options, instance, create_fragment, not_equal, props) {
      var dirty = arguments.length > 6 && arguments[6] !== undefined ? arguments[6] : [-1];

      var parent_component = current_component;
      set_current_component(component);
      var prop_values = options.props || {};
      var $$ = component.$$ = {
          fragment: null,
          ctx: null,
          // state
          props: props,
          update: noop,
          not_equal: not_equal,
          bound: blank_object(),
          // lifecycle
          on_mount: [],
          on_destroy: [],
          before_update: [],
          after_update: [],
          context: new Map(parent_component ? parent_component.$$.context : []),
          // everything else
          callbacks: blank_object(),
          dirty: dirty
      };
      var ready = false;
      $$.ctx = instance ? instance(component, prop_values, function (i, ret) {
          var value = (arguments.length <= 2 ? 0 : arguments.length - 2) ? arguments.length <= 2 ? undefined : arguments[2] : ret;
          if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
              if ($$.bound[i]) $$.bound[i](value);
              if (ready) make_dirty(component, i);
          }
          return ret;
      }) : [];
      $$.update();
      ready = true;
      run_all($$.before_update);
      // `false` as a special case of no DOM component
      $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
      if (options.target) {
          if (options.hydrate) {
              var nodes = children(options.target);
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              $$.fragment && $$.fragment.l(nodes);
              nodes.forEach(detach);
          } else {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              $$.fragment && $$.fragment.c();
          }
          if (options.intro) transition_in(component.$$.fragment);
          mount_component(component, options.target, options.anchor);
          flush();
      }
      set_current_component(parent_component);
  }
  var SvelteElement = void 0;
  if (typeof HTMLElement === 'function') {
      SvelteElement = function (_HTMLElement) {
          inherits(SvelteElement, _HTMLElement);

          function SvelteElement() {
              classCallCheck(this, SvelteElement);

              var _this = possibleConstructorReturn(this, (SvelteElement.__proto__ || Object.getPrototypeOf(SvelteElement)).call(this));

              _this.attachShadow({ mode: 'open' });
              return _this;
          }

          createClass(SvelteElement, [{
              key: 'connectedCallback',
              value: function connectedCallback() {
                  // @ts-ignore todo: improve typings
                  for (var key in this.$$.slotted) {
                      // @ts-ignore todo: improve typings
                      this.appendChild(this.$$.slotted[key]);
                  }
              }
          }, {
              key: 'attributeChangedCallback',
              value: function attributeChangedCallback(attr, _oldValue, newValue) {
                  this[attr] = newValue;
              }
          }, {
              key: '$destroy',
              value: function $destroy() {
                  destroy_component(this, 1);
                  this.$destroy = noop;
              }
          }, {
              key: '$on',
              value: function $on(type, callback) {
                  // TODO should this delegate to addEventListener?
                  var callbacks = this.$$.callbacks[type] || (this.$$.callbacks[type] = []);
                  callbacks.push(callback);
                  return function () {
                      var index = callbacks.indexOf(callback);
                      if (index !== -1) callbacks.splice(index, 1);
                  };
              }
          }, {
              key: '$set',
              value: function $set() {
                  // overridden by instance, if it has props
              }
          }]);
          return SvelteElement;
      }(HTMLElement);
  }

  var SvelteComponent = function () {
      function SvelteComponent() {
          classCallCheck(this, SvelteComponent);
      }

      createClass(SvelteComponent, [{
          key: '$destroy',
          value: function $destroy() {
              destroy_component(this, 1);
              this.$destroy = noop;
          }
      }, {
          key: '$on',
          value: function $on(type, callback) {
              var callbacks = this.$$.callbacks[type] || (this.$$.callbacks[type] = []);
              callbacks.push(callback);
              return function () {
                  var index = callbacks.indexOf(callback);
                  if (index !== -1) callbacks.splice(index, 1);
              };
          }
      }, {
          key: '$set',
          value: function $set() {
              // overridden by instance, if it has props
          }
      }]);
      return SvelteComponent;
  }();

  var SvelteComponentDev = function (_SvelteComponent) {
      inherits(SvelteComponentDev, _SvelteComponent);

      function SvelteComponentDev(options) {
          classCallCheck(this, SvelteComponentDev);

          if (!options || !options.target && !options.$$inline) {
              throw new Error('\'target\' is a required option');
          }
          return possibleConstructorReturn(this, (SvelteComponentDev.__proto__ || Object.getPrototypeOf(SvelteComponentDev)).call(this));
      }

      createClass(SvelteComponentDev, [{
          key: '$destroy',
          value: function $destroy() {
              get(SvelteComponentDev.prototype.__proto__ || Object.getPrototypeOf(SvelteComponentDev.prototype), '$destroy', this).call(this);
              this.$destroy = function () {
                  console.warn('Component was already destroyed'); // eslint-disable-line no-console
              };
          }
      }, {
          key: '$capture_state',
          value: function $capture_state() {}
      }, {
          key: '$inject_state',
          value: function $inject_state() {}
      }]);
      return SvelteComponentDev;
  }(SvelteComponent);

  var subscriber_queue = [];
  /**
   * Create a `Writable` store that allows both updating and reading by subscription.
   * @param {*=}value initial value
   * @param {StartStopNotifier=}start start and stop notifications for subscriptions
   */
  function writable(value) {
      var start = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : noop;

      var stop = void 0;
      var subscribers = [];
      function set(new_value) {
          if (safe_not_equal(value, new_value)) {
              value = new_value;
              if (stop) {
                  // store is ready
                  var run_queue = !subscriber_queue.length;
                  for (var i = 0; i < subscribers.length; i += 1) {
                      var s = subscribers[i];
                      s[1]();
                      subscriber_queue.push(s, value);
                  }
                  if (run_queue) {
                      for (var _i = 0; _i < subscriber_queue.length; _i += 2) {
                          subscriber_queue[_i][0](subscriber_queue[_i + 1]);
                      }
                      subscriber_queue.length = 0;
                  }
              }
          }
      }
      function update(fn) {
          set(fn(value));
      }
      function subscribe(run) {
          var invalidate = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : noop;

          var subscriber = [run, invalidate];
          subscribers.push(subscriber);
          if (subscribers.length === 1) {
              stop = start(set) || noop;
          }
          run(value);
          return function () {
              var index = subscribers.indexOf(subscriber);
              if (index !== -1) {
                  subscribers.splice(index, 1);
              }
              if (subscribers.length === 0) {
                  stop();
                  stop = null;
              }
          };
      }
      return { set: set, update: update, subscribe: subscribe };
  }

  var activeElement = writable(null);

  /* client\views\entity.svelte generated by Svelte v3.22.3 */

  function add_css() {
  	var style = element("style");
  	style.id = "svelte-sah2ou-style";
  	style.textContent = ".active.svelte-sah2ou{border:2px solid blue}rect.svelte-sah2ou{fill:green}";
  	append(document.head, style);
  }

  function create_fragment(ctx) {
  	var svg = void 0;
  	var rect = void 0;
  	var foreignObject = void 0;
  	var div = void 0;
  	var img = void 0;
  	var img_src_value = void 0;
  	var svg_x_value = void 0;
  	var svg_y_value = void 0;
  	var dispose = void 0;

  	return {
  		c: function c() {
  			svg = svg_element("svg");
  			rect = svg_element("rect");
  			foreignObject = svg_element("foreignObject");
  			div = element("div");
  			img = element("img");
  			attr(rect, "width", /*width*/ctx[2]);
  			attr(rect, "height", /*height*/ctx[1]);
  			attr(rect, "class", "svelte-sah2ou");
  			attr(img, "width", /*width*/ctx[2]);
  			attr(img, "height", /*height*/ctx[1]);
  			if (img.src !== (img_src_value = "imgs/swamp.jpg")) attr(img, "src", img_src_value);
  			attr(img, "alt", "sfsdf");
  			attr(div, "class", "svelte-sah2ou");
  			toggle_class(div, "active", /*$activeElement*/ctx[3]);
  			attr(foreignObject, "class", "ignore no-select");
  			attr(foreignObject, "width", /*width*/ctx[2]);
  			attr(foreignObject, "height", /*height*/ctx[1]);
  			attr(svg, "x", svg_x_value = /*data*/ctx[0].x);
  			attr(svg, "y", svg_y_value = /*data*/ctx[0].y);
  		},
  		m: function m(target, anchor, remount) {
  			insert(target, svg, anchor);
  			append(svg, rect);
  			append(svg, foreignObject);
  			append(foreignObject, div);
  			append(div, img);
  			if (remount) dispose();
  			dispose = listen(rect, "mousedown", stop_propagation(prevent_default( /*setActive*/ctx[4])));
  		},
  		p: function p(ctx, _ref) {
  			var _ref2 = slicedToArray(_ref, 1),
  			    dirty = _ref2[0];

  			if (dirty & /*width*/4) {
  				attr(rect, "width", /*width*/ctx[2]);
  			}

  			if (dirty & /*height*/2) {
  				attr(rect, "height", /*height*/ctx[1]);
  			}

  			if (dirty & /*width*/4) {
  				attr(img, "width", /*width*/ctx[2]);
  			}

  			if (dirty & /*height*/2) {
  				attr(img, "height", /*height*/ctx[1]);
  			}

  			if (dirty & /*$activeElement*/8) {
  				toggle_class(div, "active", /*$activeElement*/ctx[3]);
  			}

  			if (dirty & /*width*/4) {
  				attr(foreignObject, "width", /*width*/ctx[2]);
  			}

  			if (dirty & /*height*/2) {
  				attr(foreignObject, "height", /*height*/ctx[1]);
  			}

  			if (dirty & /*data*/1 && svg_x_value !== (svg_x_value = /*data*/ctx[0].x)) {
  				attr(svg, "x", svg_x_value);
  			}

  			if (dirty & /*data*/1 && svg_y_value !== (svg_y_value = /*data*/ctx[0].y)) {
  				attr(svg, "y", svg_y_value);
  			}
  		},

  		i: noop,
  		o: noop,
  		d: function d(detaching) {
  			if (detaching) detach(svg);
  			dispose();
  		}
  	};
  }

  var CARD_RATIO = 0.71764705882;

  function instance($$self, $$props, $$invalidate) {
  	var $activeElement = void 0;
  	component_subscribe($$self, activeElement, function ($$value) {
  		return $$invalidate(3, $activeElement = $$value);
  	});
  	var _$$props$cam = $$props.cam,
  	    cam = _$$props$cam === undefined ? { x: 0, y: 0 } : _$$props$cam;
  	var _$$props$data = $$props.data,
  	    data = _$$props$data === undefined ? { x: 0, y: 0, _id: "" } : _$$props$data;
  	var _$$props$height = $$props.height,
  	    height = _$$props$height === undefined ? 300 : _$$props$height;
  	var _$$props$width = $$props.width,
  	    width = _$$props$width === undefined ? height * CARD_RATIO : _$$props$width;


  	function setActive(evt) {
  		console.log("sdsdfdsf");
  		activeElement.set(data._id);
  	}

  	$$self.$set = function ($$props) {
  		if ("cam" in $$props) $$invalidate(5, cam = $$props.cam);
  		if ("data" in $$props) $$invalidate(0, data = $$props.data);
  		if ("height" in $$props) $$invalidate(1, height = $$props.height);
  		if ("width" in $$props) $$invalidate(2, width = $$props.width);
  	};

  	return [data, height, width, $activeElement, setActive, cam];
  }

  var Entity = function (_SvelteComponent) {
  	inherits(Entity, _SvelteComponent);

  	function Entity(options) {
  		classCallCheck(this, Entity);

  		var _this = possibleConstructorReturn(this, (Entity.__proto__ || Object.getPrototypeOf(Entity)).call(this));

  		if (!document.getElementById("svelte-sah2ou-style")) add_css();
  		init(_this, options, instance, create_fragment, safe_not_equal, { cam: 5, data: 0, height: 1, width: 2 });
  		return _this;
  	}

  	return Entity;
  }(SvelteComponent);

  /* client\views\table.svelte generated by Svelte v3.22.3 */

  function add_css$1() {
  	var style = element("style");
  	style.id = "svelte-1gjyzz6-style";
  	style.textContent = ".main.svelte-1gjyzz6{width:100%;height:100%}svg.svelte-1gjyzz6{width:100%;height:100%}";
  	append(document.head, style);
  }

  function get_each_context(ctx, list, i) {
  	var child_ctx = ctx.slice();
  	child_ctx[5] = list[i];
  	child_ctx[7] = i;
  	return child_ctx;
  }

  // (46:4) {#each Object.values(entities) as entity, index (entity._id)}
  function create_each_block(key_1, ctx) {
  	var first = void 0;
  	var current = void 0;

  	var entity = new Entity({
  		props: {
  			cam: /*cam*/ctx[0],
  			data: /*entity*/ctx[5]
  		}
  	});

  	return {
  		key: key_1,
  		first: null,
  		c: function c() {
  			first = empty();
  			create_component(entity.$$.fragment);
  			this.first = first;
  		},
  		m: function m(target, anchor) {
  			insert(target, first, anchor);
  			mount_component(entity, target, anchor);
  			current = true;
  		},
  		p: function p(ctx, dirty) {
  			var entity_changes = {};
  			if (dirty & /*cam*/1) entity_changes.cam = /*cam*/ctx[0];
  			if (dirty & /*entities*/2) entity_changes.data = /*entity*/ctx[5];
  			entity.$set(entity_changes);
  		},
  		i: function i(local) {
  			if (current) return;
  			transition_in(entity.$$.fragment, local);
  			current = true;
  		},
  		o: function o(local) {
  			transition_out(entity.$$.fragment, local);
  			current = false;
  		},
  		d: function d(detaching) {
  			if (detaching) detach(first);
  			destroy_component(entity, detaching);
  		}
  	};
  }

  function create_fragment$1(ctx) {
  	var div = void 0;
  	var svg_1 = void 0;
  	var each_blocks = [];
  	var each_1_lookup = new Map();
  	var current = void 0;
  	var dispose = void 0;
  	var each_value = Object.values( /*entities*/ctx[1]);
  	var get_key = function get_key(ctx) {
  		return (/*entity*/ctx[5]._id
  		);
  	};

  	for (var i = 0; i < each_value.length; i += 1) {
  		var child_ctx = get_each_context(ctx, each_value, i);
  		var key = get_key(child_ctx);
  		each_1_lookup.set(key, each_blocks[i] = create_each_block(key, child_ctx));
  	}

  	return {
  		c: function c() {
  			div = element("div");
  			svg_1 = svg_element("svg");

  			for (var _i = 0; _i < each_blocks.length; _i += 1) {
  				each_blocks[_i].c();
  			}

  			attr(svg_1, "bin:this", /*svg*/ctx[2]);
  			attr(svg_1, "class", "svelte-1gjyzz6");
  			attr(div, "class", "main svelte-1gjyzz6");
  		},
  		m: function m(target, anchor, remount) {
  			insert(target, div, anchor);
  			append(div, svg_1);

  			for (var _i2 = 0; _i2 < each_blocks.length; _i2 += 1) {
  				each_blocks[_i2].m(svg_1, null);
  			}

  			current = true;
  			if (remount) dispose();
  			dispose = listen(div, "mousemove", /*mouseMove*/ctx[3]);
  		},
  		p: function p(ctx, _ref) {
  			var _ref2 = slicedToArray(_ref, 1),
  			    dirty = _ref2[0];

  			if (dirty & /*cam, Object, entities*/3) {
  				var _each_value = Object.values( /*entities*/ctx[1]);
  				group_outros();
  				each_blocks = update_keyed_each(each_blocks, dirty, get_key, 1, ctx, _each_value, each_1_lookup, svg_1, outro_and_destroy_block, create_each_block, null, get_each_context);
  				check_outros();
  			}
  		},
  		i: function i(local) {
  			if (current) return;

  			for (var _i3 = 0; _i3 < each_value.length; _i3 += 1) {
  				transition_in(each_blocks[_i3]);
  			}

  			current = true;
  		},
  		o: function o(local) {
  			for (var _i4 = 0; _i4 < each_blocks.length; _i4 += 1) {
  				transition_out(each_blocks[_i4]);
  			}

  			current = false;
  		},
  		d: function d(detaching) {
  			if (detaching) detach(div);

  			for (var _i5 = 0; _i5 < each_blocks.length; _i5 += 1) {
  				each_blocks[_i5].d();
  			}

  			dispose();
  		}
  	};
  }

  function instance$1($$self, $$props, $$invalidate) {
  	var $activeElement = void 0;
  	component_subscribe($$self, activeElement, function ($$value) {
  		return $$invalidate(4, $activeElement = $$value);
  	});
  	var svg = void 0;
  	var cam = { x: 0, y: 0 };
  	var entities = { abcd: { x: 0, y: 0, _id: "abcd" } };

  	function mouseMove(evt) {
  		$$invalidate(0, cam.x = evt.clientX, cam);
  		$$invalidate(0, cam.y = evt.clientY, cam);

  		if ($activeElement) {
  			console.log(cam);
  			var cur = entities[$activeElement];
  			cur.x = cam.x;
  			cur.y = cam.y;
  			$$invalidate(1, entities[$activeElement] = cur, entities);
  		}
  	}

  	return [cam, entities, svg, mouseMove];
  }

  var Table = function (_SvelteComponent) {
  	inherits(Table, _SvelteComponent);

  	function Table(options) {
  		classCallCheck(this, Table);

  		var _this = possibleConstructorReturn(this, (Table.__proto__ || Object.getPrototypeOf(Table)).call(this));

  		if (!document.getElementById("svelte-1gjyzz6-style")) add_css$1();
  		init(_this, options, instance$1, create_fragment$1, safe_not_equal, {});
  		return _this;
  	}

  	return Table;
  }(SvelteComponent);

  /* client\views\main-view.svelte generated by Svelte v3.22.3 */

  function add_css$2() {
  	var style = element("style");
  	style.id = "svelte-78nepw-style";
  	style.textContent = ".page.svelte-78nepw{width:100%;height:100%}";
  	append(document.head, style);
  }

  // (18:2) <Table>
  function create_default_slot(ctx) {
  	var t = void 0;

  	return {
  		c: function c() {
  			t = text("ttetsd");
  		},
  		m: function m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d: function d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  function create_fragment$2(ctx) {
  	var div = void 0;
  	var current = void 0;
  	var dispose = void 0;

  	var table = new Table({
  		props: {
  			$$slots: { default: [create_default_slot] },
  			$$scope: { ctx: ctx }
  		}
  	});

  	return {
  		c: function c() {
  			div = element("div");
  			create_component(table.$$.fragment);
  			attr(div, "class", "page svelte-78nepw");
  		},
  		m: function m(target, anchor, remount) {
  			insert(target, div, anchor);
  			mount_component(table, div, null);
  			current = true;
  			if (remount) dispose();
  			dispose = listen(div, "mouseup", /*onMouseUp*/ctx[0]);
  		},
  		p: function p(ctx, _ref) {
  			var _ref2 = slicedToArray(_ref, 1),
  			    dirty = _ref2[0];

  			var table_changes = {};

  			if (dirty & /*$$scope*/2) {
  				table_changes.$$scope = { dirty: dirty, ctx: ctx };
  			}

  			table.$set(table_changes);
  		},
  		i: function i(local) {
  			if (current) return;
  			transition_in(table.$$.fragment, local);
  			current = true;
  		},
  		o: function o(local) {
  			transition_out(table.$$.fragment, local);
  			current = false;
  		},
  		d: function d(detaching) {
  			if (detaching) detach(div);
  			destroy_component(table);
  			dispose();
  		}
  	};
  }

  function instance$2($$self) {
  	function onMouseUp() {
  		activeElement.set(null);
  	}

  	return [onMouseUp];
  }

  var Main_view = function (_SvelteComponent) {
  	inherits(Main_view, _SvelteComponent);

  	function Main_view(options) {
  		classCallCheck(this, Main_view);

  		var _this = possibleConstructorReturn(this, (Main_view.__proto__ || Object.getPrototypeOf(Main_view)).call(this));

  		if (!document.getElementById("svelte-78nepw-style")) add_css$2();
  		init(_this, options, instance$2, create_fragment$2, safe_not_equal, {});
  		return _this;
  	}

  	return Main_view;
  }(SvelteComponent);

  var Connector = function () {
      function Connector() {
          classCallCheck(this, Connector);
      }

      createClass(Connector, [{
          key: "init",
          value: function init() {}
      }]);
      return Connector;
  }();

  var connector = new Connector();

  connector.init();

  var renderTarget = new Main_view({
    target: document.body,
    props: {
      connector: connector,
      test: "sdfdsf"
    }
  });

}());
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVuZGxlLmpzIiwic291cmNlcyI6WyIuLi9ub2RlX21vZHVsZXMvc3ZlbHRlL2ludGVybmFsL2luZGV4Lm1qcyIsIi4uL25vZGVfbW9kdWxlcy9zdmVsdGUvc3RvcmUvaW5kZXgubWpzIiwiLi4vY2xpZW50L3ZpZXdzL3N0b3JlLmpzIiwiLi4vY2xpZW50L3ZpZXdzL2VudGl0eS5zdmVsdGUiLCIuLi9jbGllbnQvdmlld3MvdGFibGUuc3ZlbHRlIiwiLi4vY2xpZW50L3ZpZXdzL21haW4tdmlldy5zdmVsdGUiLCIuLi9jbGllbnQvY29ubmVjdG9yLmpzIiwiLi4vY2xpZW50L2luZGV4LmpzIl0sInNvdXJjZXNDb250ZW50IjpbImZ1bmN0aW9uIG5vb3AoKSB7IH1cbmNvbnN0IGlkZW50aXR5ID0geCA9PiB4O1xuZnVuY3Rpb24gYXNzaWduKHRhciwgc3JjKSB7XG4gICAgLy8gQHRzLWlnbm9yZVxuICAgIGZvciAoY29uc3QgayBpbiBzcmMpXG4gICAgICAgIHRhcltrXSA9IHNyY1trXTtcbiAgICByZXR1cm4gdGFyO1xufVxuZnVuY3Rpb24gaXNfcHJvbWlzZSh2YWx1ZSkge1xuICAgIHJldHVybiB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHR5cGVvZiB2YWx1ZS50aGVuID09PSAnZnVuY3Rpb24nO1xufVxuZnVuY3Rpb24gYWRkX2xvY2F0aW9uKGVsZW1lbnQsIGZpbGUsIGxpbmUsIGNvbHVtbiwgY2hhcikge1xuICAgIGVsZW1lbnQuX19zdmVsdGVfbWV0YSA9IHtcbiAgICAgICAgbG9jOiB7IGZpbGUsIGxpbmUsIGNvbHVtbiwgY2hhciB9XG4gICAgfTtcbn1cbmZ1bmN0aW9uIHJ1bihmbikge1xuICAgIHJldHVybiBmbigpO1xufVxuZnVuY3Rpb24gYmxhbmtfb2JqZWN0KCkge1xuICAgIHJldHVybiBPYmplY3QuY3JlYXRlKG51bGwpO1xufVxuZnVuY3Rpb24gcnVuX2FsbChmbnMpIHtcbiAgICBmbnMuZm9yRWFjaChydW4pO1xufVxuZnVuY3Rpb24gaXNfZnVuY3Rpb24odGhpbmcpIHtcbiAgICByZXR1cm4gdHlwZW9mIHRoaW5nID09PSAnZnVuY3Rpb24nO1xufVxuZnVuY3Rpb24gc2FmZV9ub3RfZXF1YWwoYSwgYikge1xuICAgIHJldHVybiBhICE9IGEgPyBiID09IGIgOiBhICE9PSBiIHx8ICgoYSAmJiB0eXBlb2YgYSA9PT0gJ29iamVjdCcpIHx8IHR5cGVvZiBhID09PSAnZnVuY3Rpb24nKTtcbn1cbmZ1bmN0aW9uIG5vdF9lcXVhbChhLCBiKSB7XG4gICAgcmV0dXJuIGEgIT0gYSA/IGIgPT0gYiA6IGEgIT09IGI7XG59XG5mdW5jdGlvbiB2YWxpZGF0ZV9zdG9yZShzdG9yZSwgbmFtZSkge1xuICAgIGlmIChzdG9yZSAhPSBudWxsICYmIHR5cGVvZiBzdG9yZS5zdWJzY3JpYmUgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAnJHtuYW1lfScgaXMgbm90IGEgc3RvcmUgd2l0aCBhICdzdWJzY3JpYmUnIG1ldGhvZGApO1xuICAgIH1cbn1cbmZ1bmN0aW9uIHN1YnNjcmliZShzdG9yZSwgLi4uY2FsbGJhY2tzKSB7XG4gICAgaWYgKHN0b3JlID09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIG5vb3A7XG4gICAgfVxuICAgIGNvbnN0IHVuc3ViID0gc3RvcmUuc3Vic2NyaWJlKC4uLmNhbGxiYWNrcyk7XG4gICAgcmV0dXJuIHVuc3ViLnVuc3Vic2NyaWJlID8gKCkgPT4gdW5zdWIudW5zdWJzY3JpYmUoKSA6IHVuc3ViO1xufVxuZnVuY3Rpb24gZ2V0X3N0b3JlX3ZhbHVlKHN0b3JlKSB7XG4gICAgbGV0IHZhbHVlO1xuICAgIHN1YnNjcmliZShzdG9yZSwgXyA9PiB2YWx1ZSA9IF8pKCk7XG4gICAgcmV0dXJuIHZhbHVlO1xufVxuZnVuY3Rpb24gY29tcG9uZW50X3N1YnNjcmliZShjb21wb25lbnQsIHN0b3JlLCBjYWxsYmFjaykge1xuICAgIGNvbXBvbmVudC4kJC5vbl9kZXN0cm95LnB1c2goc3Vic2NyaWJlKHN0b3JlLCBjYWxsYmFjaykpO1xufVxuZnVuY3Rpb24gY3JlYXRlX3Nsb3QoZGVmaW5pdGlvbiwgY3R4LCAkJHNjb3BlLCBmbikge1xuICAgIGlmIChkZWZpbml0aW9uKSB7XG4gICAgICAgIGNvbnN0IHNsb3RfY3R4ID0gZ2V0X3Nsb3RfY29udGV4dChkZWZpbml0aW9uLCBjdHgsICQkc2NvcGUsIGZuKTtcbiAgICAgICAgcmV0dXJuIGRlZmluaXRpb25bMF0oc2xvdF9jdHgpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIGdldF9zbG90X2NvbnRleHQoZGVmaW5pdGlvbiwgY3R4LCAkJHNjb3BlLCBmbikge1xuICAgIHJldHVybiBkZWZpbml0aW9uWzFdICYmIGZuXG4gICAgICAgID8gYXNzaWduKCQkc2NvcGUuY3R4LnNsaWNlKCksIGRlZmluaXRpb25bMV0oZm4oY3R4KSkpXG4gICAgICAgIDogJCRzY29wZS5jdHg7XG59XG5mdW5jdGlvbiBnZXRfc2xvdF9jaGFuZ2VzKGRlZmluaXRpb24sICQkc2NvcGUsIGRpcnR5LCBmbikge1xuICAgIGlmIChkZWZpbml0aW9uWzJdICYmIGZuKSB7XG4gICAgICAgIGNvbnN0IGxldHMgPSBkZWZpbml0aW9uWzJdKGZuKGRpcnR5KSk7XG4gICAgICAgIGlmICgkJHNjb3BlLmRpcnR5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHJldHVybiBsZXRzO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0eXBlb2YgbGV0cyA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIGNvbnN0IG1lcmdlZCA9IFtdO1xuICAgICAgICAgICAgY29uc3QgbGVuID0gTWF0aC5tYXgoJCRzY29wZS5kaXJ0eS5sZW5ndGgsIGxldHMubGVuZ3RoKTtcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbGVuOyBpICs9IDEpIHtcbiAgICAgICAgICAgICAgICBtZXJnZWRbaV0gPSAkJHNjb3BlLmRpcnR5W2ldIHwgbGV0c1tpXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBtZXJnZWQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICQkc2NvcGUuZGlydHkgfCBsZXRzO1xuICAgIH1cbiAgICByZXR1cm4gJCRzY29wZS5kaXJ0eTtcbn1cbmZ1bmN0aW9uIGV4Y2x1ZGVfaW50ZXJuYWxfcHJvcHMocHJvcHMpIHtcbiAgICBjb25zdCByZXN1bHQgPSB7fTtcbiAgICBmb3IgKGNvbnN0IGsgaW4gcHJvcHMpXG4gICAgICAgIGlmIChrWzBdICE9PSAnJCcpXG4gICAgICAgICAgICByZXN1bHRba10gPSBwcm9wc1trXTtcbiAgICByZXR1cm4gcmVzdWx0O1xufVxuZnVuY3Rpb24gY29tcHV0ZV9yZXN0X3Byb3BzKHByb3BzLCBrZXlzKSB7XG4gICAgY29uc3QgcmVzdCA9IHt9O1xuICAgIGtleXMgPSBuZXcgU2V0KGtleXMpO1xuICAgIGZvciAoY29uc3QgayBpbiBwcm9wcylcbiAgICAgICAgaWYgKCFrZXlzLmhhcyhrKSAmJiBrWzBdICE9PSAnJCcpXG4gICAgICAgICAgICByZXN0W2tdID0gcHJvcHNba107XG4gICAgcmV0dXJuIHJlc3Q7XG59XG5mdW5jdGlvbiBvbmNlKGZuKSB7XG4gICAgbGV0IHJhbiA9IGZhbHNlO1xuICAgIHJldHVybiBmdW5jdGlvbiAoLi4uYXJncykge1xuICAgICAgICBpZiAocmFuKVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICByYW4gPSB0cnVlO1xuICAgICAgICBmbi5jYWxsKHRoaXMsIC4uLmFyZ3MpO1xuICAgIH07XG59XG5mdW5jdGlvbiBudWxsX3RvX2VtcHR5KHZhbHVlKSB7XG4gICAgcmV0dXJuIHZhbHVlID09IG51bGwgPyAnJyA6IHZhbHVlO1xufVxuZnVuY3Rpb24gc2V0X3N0b3JlX3ZhbHVlKHN0b3JlLCByZXQsIHZhbHVlID0gcmV0KSB7XG4gICAgc3RvcmUuc2V0KHZhbHVlKTtcbiAgICByZXR1cm4gcmV0O1xufVxuY29uc3QgaGFzX3Byb3AgPSAob2JqLCBwcm9wKSA9PiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqLCBwcm9wKTtcbmZ1bmN0aW9uIGFjdGlvbl9kZXN0cm95ZXIoYWN0aW9uX3Jlc3VsdCkge1xuICAgIHJldHVybiBhY3Rpb25fcmVzdWx0ICYmIGlzX2Z1bmN0aW9uKGFjdGlvbl9yZXN1bHQuZGVzdHJveSkgPyBhY3Rpb25fcmVzdWx0LmRlc3Ryb3kgOiBub29wO1xufVxuXG5jb25zdCBpc19jbGllbnQgPSB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJztcbmxldCBub3cgPSBpc19jbGllbnRcbiAgICA/ICgpID0+IHdpbmRvdy5wZXJmb3JtYW5jZS5ub3coKVxuICAgIDogKCkgPT4gRGF0ZS5ub3coKTtcbmxldCByYWYgPSBpc19jbGllbnQgPyBjYiA9PiByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoY2IpIDogbm9vcDtcbi8vIHVzZWQgaW50ZXJuYWxseSBmb3IgdGVzdGluZ1xuZnVuY3Rpb24gc2V0X25vdyhmbikge1xuICAgIG5vdyA9IGZuO1xufVxuZnVuY3Rpb24gc2V0X3JhZihmbikge1xuICAgIHJhZiA9IGZuO1xufVxuXG5jb25zdCB0YXNrcyA9IG5ldyBTZXQoKTtcbmZ1bmN0aW9uIHJ1bl90YXNrcyhub3cpIHtcbiAgICB0YXNrcy5mb3JFYWNoKHRhc2sgPT4ge1xuICAgICAgICBpZiAoIXRhc2suYyhub3cpKSB7XG4gICAgICAgICAgICB0YXNrcy5kZWxldGUodGFzayk7XG4gICAgICAgICAgICB0YXNrLmYoKTtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIGlmICh0YXNrcy5zaXplICE9PSAwKVxuICAgICAgICByYWYocnVuX3Rhc2tzKTtcbn1cbi8qKlxuICogRm9yIHRlc3RpbmcgcHVycG9zZXMgb25seSFcbiAqL1xuZnVuY3Rpb24gY2xlYXJfbG9vcHMoKSB7XG4gICAgdGFza3MuY2xlYXIoKTtcbn1cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyB0YXNrIHRoYXQgcnVucyBvbiBlYWNoIHJhZiBmcmFtZVxuICogdW50aWwgaXQgcmV0dXJucyBhIGZhbHN5IHZhbHVlIG9yIGlzIGFib3J0ZWRcbiAqL1xuZnVuY3Rpb24gbG9vcChjYWxsYmFjaykge1xuICAgIGxldCB0YXNrO1xuICAgIGlmICh0YXNrcy5zaXplID09PSAwKVxuICAgICAgICByYWYocnVuX3Rhc2tzKTtcbiAgICByZXR1cm4ge1xuICAgICAgICBwcm9taXNlOiBuZXcgUHJvbWlzZShmdWxmaWxsID0+IHtcbiAgICAgICAgICAgIHRhc2tzLmFkZCh0YXNrID0geyBjOiBjYWxsYmFjaywgZjogZnVsZmlsbCB9KTtcbiAgICAgICAgfSksXG4gICAgICAgIGFib3J0KCkge1xuICAgICAgICAgICAgdGFza3MuZGVsZXRlKHRhc2spO1xuICAgICAgICB9XG4gICAgfTtcbn1cblxuZnVuY3Rpb24gYXBwZW5kKHRhcmdldCwgbm9kZSkge1xuICAgIHRhcmdldC5hcHBlbmRDaGlsZChub2RlKTtcbn1cbmZ1bmN0aW9uIGluc2VydCh0YXJnZXQsIG5vZGUsIGFuY2hvcikge1xuICAgIHRhcmdldC5pbnNlcnRCZWZvcmUobm9kZSwgYW5jaG9yIHx8IG51bGwpO1xufVxuZnVuY3Rpb24gZGV0YWNoKG5vZGUpIHtcbiAgICBub2RlLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQobm9kZSk7XG59XG5mdW5jdGlvbiBkZXN0cm95X2VhY2goaXRlcmF0aW9ucywgZGV0YWNoaW5nKSB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBpdGVyYXRpb25zLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgIGlmIChpdGVyYXRpb25zW2ldKVxuICAgICAgICAgICAgaXRlcmF0aW9uc1tpXS5kKGRldGFjaGluZyk7XG4gICAgfVxufVxuZnVuY3Rpb24gZWxlbWVudChuYW1lKSB7XG4gICAgcmV0dXJuIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQobmFtZSk7XG59XG5mdW5jdGlvbiBlbGVtZW50X2lzKG5hbWUsIGlzKSB7XG4gICAgcmV0dXJuIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQobmFtZSwgeyBpcyB9KTtcbn1cbmZ1bmN0aW9uIG9iamVjdF93aXRob3V0X3Byb3BlcnRpZXMob2JqLCBleGNsdWRlKSB7XG4gICAgY29uc3QgdGFyZ2V0ID0ge307XG4gICAgZm9yIChjb25zdCBrIGluIG9iaikge1xuICAgICAgICBpZiAoaGFzX3Byb3Aob2JqLCBrKVxuICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgJiYgZXhjbHVkZS5pbmRleE9mKGspID09PSAtMSkge1xuICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgdGFyZ2V0W2tdID0gb2JqW2tdO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0YXJnZXQ7XG59XG5mdW5jdGlvbiBzdmdfZWxlbWVudChuYW1lKSB7XG4gICAgcmV0dXJuIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUygnaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnLCBuYW1lKTtcbn1cbmZ1bmN0aW9uIHRleHQoZGF0YSkge1xuICAgIHJldHVybiBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZShkYXRhKTtcbn1cbmZ1bmN0aW9uIHNwYWNlKCkge1xuICAgIHJldHVybiB0ZXh0KCcgJyk7XG59XG5mdW5jdGlvbiBlbXB0eSgpIHtcbiAgICByZXR1cm4gdGV4dCgnJyk7XG59XG5mdW5jdGlvbiBsaXN0ZW4obm9kZSwgZXZlbnQsIGhhbmRsZXIsIG9wdGlvbnMpIHtcbiAgICBub2RlLmFkZEV2ZW50TGlzdGVuZXIoZXZlbnQsIGhhbmRsZXIsIG9wdGlvbnMpO1xuICAgIHJldHVybiAoKSA9PiBub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoZXZlbnQsIGhhbmRsZXIsIG9wdGlvbnMpO1xufVxuZnVuY3Rpb24gcHJldmVudF9kZWZhdWx0KGZuKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgIHJldHVybiBmbi5jYWxsKHRoaXMsIGV2ZW50KTtcbiAgICB9O1xufVxuZnVuY3Rpb24gc3RvcF9wcm9wYWdhdGlvbihmbikge1xuICAgIHJldHVybiBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgcmV0dXJuIGZuLmNhbGwodGhpcywgZXZlbnQpO1xuICAgIH07XG59XG5mdW5jdGlvbiBzZWxmKGZuKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgIGlmIChldmVudC50YXJnZXQgPT09IHRoaXMpXG4gICAgICAgICAgICBmbi5jYWxsKHRoaXMsIGV2ZW50KTtcbiAgICB9O1xufVxuZnVuY3Rpb24gYXR0cihub2RlLCBhdHRyaWJ1dGUsIHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpXG4gICAgICAgIG5vZGUucmVtb3ZlQXR0cmlidXRlKGF0dHJpYnV0ZSk7XG4gICAgZWxzZSBpZiAobm9kZS5nZXRBdHRyaWJ1dGUoYXR0cmlidXRlKSAhPT0gdmFsdWUpXG4gICAgICAgIG5vZGUuc2V0QXR0cmlidXRlKGF0dHJpYnV0ZSwgdmFsdWUpO1xufVxuZnVuY3Rpb24gc2V0X2F0dHJpYnV0ZXMobm9kZSwgYXR0cmlidXRlcykge1xuICAgIC8vIEB0cy1pZ25vcmVcbiAgICBjb25zdCBkZXNjcmlwdG9ycyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3JzKG5vZGUuX19wcm90b19fKTtcbiAgICBmb3IgKGNvbnN0IGtleSBpbiBhdHRyaWJ1dGVzKSB7XG4gICAgICAgIGlmIChhdHRyaWJ1dGVzW2tleV0gPT0gbnVsbCkge1xuICAgICAgICAgICAgbm9kZS5yZW1vdmVBdHRyaWJ1dGUoa2V5KTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChrZXkgPT09ICdzdHlsZScpIHtcbiAgICAgICAgICAgIG5vZGUuc3R5bGUuY3NzVGV4dCA9IGF0dHJpYnV0ZXNba2V5XTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChrZXkgPT09ICdfX3ZhbHVlJykge1xuICAgICAgICAgICAgbm9kZS52YWx1ZSA9IG5vZGVba2V5XSA9IGF0dHJpYnV0ZXNba2V5XTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChkZXNjcmlwdG9yc1trZXldICYmIGRlc2NyaXB0b3JzW2tleV0uc2V0KSB7XG4gICAgICAgICAgICBub2RlW2tleV0gPSBhdHRyaWJ1dGVzW2tleV07XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBhdHRyKG5vZGUsIGtleSwgYXR0cmlidXRlc1trZXldKTtcbiAgICAgICAgfVxuICAgIH1cbn1cbmZ1bmN0aW9uIHNldF9zdmdfYXR0cmlidXRlcyhub2RlLCBhdHRyaWJ1dGVzKSB7XG4gICAgZm9yIChjb25zdCBrZXkgaW4gYXR0cmlidXRlcykge1xuICAgICAgICBhdHRyKG5vZGUsIGtleSwgYXR0cmlidXRlc1trZXldKTtcbiAgICB9XG59XG5mdW5jdGlvbiBzZXRfY3VzdG9tX2VsZW1lbnRfZGF0YShub2RlLCBwcm9wLCB2YWx1ZSkge1xuICAgIGlmIChwcm9wIGluIG5vZGUpIHtcbiAgICAgICAgbm9kZVtwcm9wXSA9IHZhbHVlO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgYXR0cihub2RlLCBwcm9wLCB2YWx1ZSk7XG4gICAgfVxufVxuZnVuY3Rpb24geGxpbmtfYXR0cihub2RlLCBhdHRyaWJ1dGUsIHZhbHVlKSB7XG4gICAgbm9kZS5zZXRBdHRyaWJ1dGVOUygnaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluaycsIGF0dHJpYnV0ZSwgdmFsdWUpO1xufVxuZnVuY3Rpb24gZ2V0X2JpbmRpbmdfZ3JvdXBfdmFsdWUoZ3JvdXApIHtcbiAgICBjb25zdCB2YWx1ZSA9IFtdO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZ3JvdXAubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgaWYgKGdyb3VwW2ldLmNoZWNrZWQpXG4gICAgICAgICAgICB2YWx1ZS5wdXNoKGdyb3VwW2ldLl9fdmFsdWUpO1xuICAgIH1cbiAgICByZXR1cm4gdmFsdWU7XG59XG5mdW5jdGlvbiB0b19udW1iZXIodmFsdWUpIHtcbiAgICByZXR1cm4gdmFsdWUgPT09ICcnID8gdW5kZWZpbmVkIDogK3ZhbHVlO1xufVxuZnVuY3Rpb24gdGltZV9yYW5nZXNfdG9fYXJyYXkocmFuZ2VzKSB7XG4gICAgY29uc3QgYXJyYXkgPSBbXTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJhbmdlcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBhcnJheS5wdXNoKHsgc3RhcnQ6IHJhbmdlcy5zdGFydChpKSwgZW5kOiByYW5nZXMuZW5kKGkpIH0pO1xuICAgIH1cbiAgICByZXR1cm4gYXJyYXk7XG59XG5mdW5jdGlvbiBjaGlsZHJlbihlbGVtZW50KSB7XG4gICAgcmV0dXJuIEFycmF5LmZyb20oZWxlbWVudC5jaGlsZE5vZGVzKTtcbn1cbmZ1bmN0aW9uIGNsYWltX2VsZW1lbnQobm9kZXMsIG5hbWUsIGF0dHJpYnV0ZXMsIHN2Zykge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbm9kZXMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgY29uc3Qgbm9kZSA9IG5vZGVzW2ldO1xuICAgICAgICBpZiAobm9kZS5ub2RlTmFtZSA9PT0gbmFtZSkge1xuICAgICAgICAgICAgbGV0IGogPSAwO1xuICAgICAgICAgICAgd2hpbGUgKGogPCBub2RlLmF0dHJpYnV0ZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYXR0cmlidXRlID0gbm9kZS5hdHRyaWJ1dGVzW2pdO1xuICAgICAgICAgICAgICAgIGlmIChhdHRyaWJ1dGVzW2F0dHJpYnV0ZS5uYW1lXSkge1xuICAgICAgICAgICAgICAgICAgICBqKys7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBub2RlLnJlbW92ZUF0dHJpYnV0ZShhdHRyaWJ1dGUubmFtZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIG5vZGVzLnNwbGljZShpLCAxKVswXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gc3ZnID8gc3ZnX2VsZW1lbnQobmFtZSkgOiBlbGVtZW50KG5hbWUpO1xufVxuZnVuY3Rpb24gY2xhaW1fdGV4dChub2RlcywgZGF0YSkge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbm9kZXMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgY29uc3Qgbm9kZSA9IG5vZGVzW2ldO1xuICAgICAgICBpZiAobm9kZS5ub2RlVHlwZSA9PT0gMykge1xuICAgICAgICAgICAgbm9kZS5kYXRhID0gJycgKyBkYXRhO1xuICAgICAgICAgICAgcmV0dXJuIG5vZGVzLnNwbGljZShpLCAxKVswXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdGV4dChkYXRhKTtcbn1cbmZ1bmN0aW9uIGNsYWltX3NwYWNlKG5vZGVzKSB7XG4gICAgcmV0dXJuIGNsYWltX3RleHQobm9kZXMsICcgJyk7XG59XG5mdW5jdGlvbiBzZXRfZGF0YSh0ZXh0LCBkYXRhKSB7XG4gICAgZGF0YSA9ICcnICsgZGF0YTtcbiAgICBpZiAodGV4dC5kYXRhICE9PSBkYXRhKVxuICAgICAgICB0ZXh0LmRhdGEgPSBkYXRhO1xufVxuZnVuY3Rpb24gc2V0X2lucHV0X3ZhbHVlKGlucHV0LCB2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSAhPSBudWxsIHx8IGlucHV0LnZhbHVlKSB7XG4gICAgICAgIGlucHV0LnZhbHVlID0gdmFsdWU7XG4gICAgfVxufVxuZnVuY3Rpb24gc2V0X2lucHV0X3R5cGUoaW5wdXQsIHR5cGUpIHtcbiAgICB0cnkge1xuICAgICAgICBpbnB1dC50eXBlID0gdHlwZTtcbiAgICB9XG4gICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgLy8gZG8gbm90aGluZ1xuICAgIH1cbn1cbmZ1bmN0aW9uIHNldF9zdHlsZShub2RlLCBrZXksIHZhbHVlLCBpbXBvcnRhbnQpIHtcbiAgICBub2RlLnN0eWxlLnNldFByb3BlcnR5KGtleSwgdmFsdWUsIGltcG9ydGFudCA/ICdpbXBvcnRhbnQnIDogJycpO1xufVxuZnVuY3Rpb24gc2VsZWN0X29wdGlvbihzZWxlY3QsIHZhbHVlKSB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWxlY3Qub3B0aW9ucy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBvcHRpb24gPSBzZWxlY3Qub3B0aW9uc1tpXTtcbiAgICAgICAgaWYgKG9wdGlvbi5fX3ZhbHVlID09PSB2YWx1ZSkge1xuICAgICAgICAgICAgb3B0aW9uLnNlbGVjdGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgIH1cbn1cbmZ1bmN0aW9uIHNlbGVjdF9vcHRpb25zKHNlbGVjdCwgdmFsdWUpIHtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHNlbGVjdC5vcHRpb25zLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgIGNvbnN0IG9wdGlvbiA9IHNlbGVjdC5vcHRpb25zW2ldO1xuICAgICAgICBvcHRpb24uc2VsZWN0ZWQgPSB+dmFsdWUuaW5kZXhPZihvcHRpb24uX192YWx1ZSk7XG4gICAgfVxufVxuZnVuY3Rpb24gc2VsZWN0X3ZhbHVlKHNlbGVjdCkge1xuICAgIGNvbnN0IHNlbGVjdGVkX29wdGlvbiA9IHNlbGVjdC5xdWVyeVNlbGVjdG9yKCc6Y2hlY2tlZCcpIHx8IHNlbGVjdC5vcHRpb25zWzBdO1xuICAgIHJldHVybiBzZWxlY3RlZF9vcHRpb24gJiYgc2VsZWN0ZWRfb3B0aW9uLl9fdmFsdWU7XG59XG5mdW5jdGlvbiBzZWxlY3RfbXVsdGlwbGVfdmFsdWUoc2VsZWN0KSB7XG4gICAgcmV0dXJuIFtdLm1hcC5jYWxsKHNlbGVjdC5xdWVyeVNlbGVjdG9yQWxsKCc6Y2hlY2tlZCcpLCBvcHRpb24gPT4gb3B0aW9uLl9fdmFsdWUpO1xufVxuLy8gdW5mb3J0dW5hdGVseSB0aGlzIGNhbid0IGJlIGEgY29uc3RhbnQgYXMgdGhhdCB3b3VsZG4ndCBiZSB0cmVlLXNoYWtlYWJsZVxuLy8gc28gd2UgY2FjaGUgdGhlIHJlc3VsdCBpbnN0ZWFkXG5sZXQgY3Jvc3NvcmlnaW47XG5mdW5jdGlvbiBpc19jcm9zc29yaWdpbigpIHtcbiAgICBpZiAoY3Jvc3NvcmlnaW4gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBjcm9zc29yaWdpbiA9IGZhbHNlO1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHdpbmRvdy5wYXJlbnQpIHtcbiAgICAgICAgICAgICAgICB2b2lkIHdpbmRvdy5wYXJlbnQuZG9jdW1lbnQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjcm9zc29yaWdpbiA9IHRydWU7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGNyb3Nzb3JpZ2luO1xufVxuZnVuY3Rpb24gYWRkX3Jlc2l6ZV9saXN0ZW5lcihub2RlLCBmbikge1xuICAgIGNvbnN0IGNvbXB1dGVkX3N0eWxlID0gZ2V0Q29tcHV0ZWRTdHlsZShub2RlKTtcbiAgICBjb25zdCB6X2luZGV4ID0gKHBhcnNlSW50KGNvbXB1dGVkX3N0eWxlLnpJbmRleCkgfHwgMCkgLSAxO1xuICAgIGlmIChjb21wdXRlZF9zdHlsZS5wb3NpdGlvbiA9PT0gJ3N0YXRpYycpIHtcbiAgICAgICAgbm9kZS5zdHlsZS5wb3NpdGlvbiA9ICdyZWxhdGl2ZSc7XG4gICAgfVxuICAgIGNvbnN0IGlmcmFtZSA9IGVsZW1lbnQoJ2lmcmFtZScpO1xuICAgIGlmcmFtZS5zZXRBdHRyaWJ1dGUoJ3N0eWxlJywgYGRpc3BsYXk6IGJsb2NrOyBwb3NpdGlvbjogYWJzb2x1dGU7IHRvcDogMDsgbGVmdDogMDsgd2lkdGg6IDEwMCU7IGhlaWdodDogMTAwJTsgYCArXG4gICAgICAgIGBvdmVyZmxvdzogaGlkZGVuOyBib3JkZXI6IDA7IG9wYWNpdHk6IDA7IHBvaW50ZXItZXZlbnRzOiBub25lOyB6LWluZGV4OiAke3pfaW5kZXh9O2ApO1xuICAgIGlmcmFtZS5zZXRBdHRyaWJ1dGUoJ2FyaWEtaGlkZGVuJywgJ3RydWUnKTtcbiAgICBpZnJhbWUudGFiSW5kZXggPSAtMTtcbiAgICBsZXQgdW5zdWJzY3JpYmU7XG4gICAgaWYgKGlzX2Nyb3Nzb3JpZ2luKCkpIHtcbiAgICAgICAgaWZyYW1lLnNyYyA9IGBkYXRhOnRleHQvaHRtbCw8c2NyaXB0Pm9ucmVzaXplPWZ1bmN0aW9uKCl7cGFyZW50LnBvc3RNZXNzYWdlKDAsJyonKX08L3NjcmlwdD5gO1xuICAgICAgICB1bnN1YnNjcmliZSA9IGxpc3Rlbih3aW5kb3csICdtZXNzYWdlJywgKGV2ZW50KSA9PiB7XG4gICAgICAgICAgICBpZiAoZXZlbnQuc291cmNlID09PSBpZnJhbWUuY29udGVudFdpbmRvdylcbiAgICAgICAgICAgICAgICBmbigpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIGlmcmFtZS5zcmMgPSAnYWJvdXQ6YmxhbmsnO1xuICAgICAgICBpZnJhbWUub25sb2FkID0gKCkgPT4ge1xuICAgICAgICAgICAgdW5zdWJzY3JpYmUgPSBsaXN0ZW4oaWZyYW1lLmNvbnRlbnRXaW5kb3csICdyZXNpemUnLCBmbik7XG4gICAgICAgIH07XG4gICAgfVxuICAgIGFwcGVuZChub2RlLCBpZnJhbWUpO1xuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgIGRldGFjaChpZnJhbWUpO1xuICAgICAgICBpZiAodW5zdWJzY3JpYmUpXG4gICAgICAgICAgICB1bnN1YnNjcmliZSgpO1xuICAgIH07XG59XG5mdW5jdGlvbiB0b2dnbGVfY2xhc3MoZWxlbWVudCwgbmFtZSwgdG9nZ2xlKSB7XG4gICAgZWxlbWVudC5jbGFzc0xpc3RbdG9nZ2xlID8gJ2FkZCcgOiAncmVtb3ZlJ10obmFtZSk7XG59XG5mdW5jdGlvbiBjdXN0b21fZXZlbnQodHlwZSwgZGV0YWlsKSB7XG4gICAgY29uc3QgZSA9IGRvY3VtZW50LmNyZWF0ZUV2ZW50KCdDdXN0b21FdmVudCcpO1xuICAgIGUuaW5pdEN1c3RvbUV2ZW50KHR5cGUsIGZhbHNlLCBmYWxzZSwgZGV0YWlsKTtcbiAgICByZXR1cm4gZTtcbn1cbmZ1bmN0aW9uIHF1ZXJ5X3NlbGVjdG9yX2FsbChzZWxlY3RvciwgcGFyZW50ID0gZG9jdW1lbnQuYm9keSkge1xuICAgIHJldHVybiBBcnJheS5mcm9tKHBhcmVudC5xdWVyeVNlbGVjdG9yQWxsKHNlbGVjdG9yKSk7XG59XG5jbGFzcyBIdG1sVGFnIHtcbiAgICBjb25zdHJ1Y3RvcihodG1sLCBhbmNob3IgPSBudWxsKSB7XG4gICAgICAgIHRoaXMuZSA9IGVsZW1lbnQoJ2RpdicpO1xuICAgICAgICB0aGlzLmEgPSBhbmNob3I7XG4gICAgICAgIHRoaXMudShodG1sKTtcbiAgICB9XG4gICAgbSh0YXJnZXQsIGFuY2hvciA9IG51bGwpIHtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLm4ubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgICAgIGluc2VydCh0YXJnZXQsIHRoaXMubltpXSwgYW5jaG9yKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnQgPSB0YXJnZXQ7XG4gICAgfVxuICAgIHUoaHRtbCkge1xuICAgICAgICB0aGlzLmUuaW5uZXJIVE1MID0gaHRtbDtcbiAgICAgICAgdGhpcy5uID0gQXJyYXkuZnJvbSh0aGlzLmUuY2hpbGROb2Rlcyk7XG4gICAgfVxuICAgIHAoaHRtbCkge1xuICAgICAgICB0aGlzLmQoKTtcbiAgICAgICAgdGhpcy51KGh0bWwpO1xuICAgICAgICB0aGlzLm0odGhpcy50LCB0aGlzLmEpO1xuICAgIH1cbiAgICBkKCkge1xuICAgICAgICB0aGlzLm4uZm9yRWFjaChkZXRhY2gpO1xuICAgIH1cbn1cblxuY29uc3QgYWN0aXZlX2RvY3MgPSBuZXcgU2V0KCk7XG5sZXQgYWN0aXZlID0gMDtcbi8vIGh0dHBzOi8vZ2l0aHViLmNvbS9kYXJrc2t5YXBwL3N0cmluZy1oYXNoL2Jsb2IvbWFzdGVyL2luZGV4LmpzXG5mdW5jdGlvbiBoYXNoKHN0cikge1xuICAgIGxldCBoYXNoID0gNTM4MTtcbiAgICBsZXQgaSA9IHN0ci5sZW5ndGg7XG4gICAgd2hpbGUgKGktLSlcbiAgICAgICAgaGFzaCA9ICgoaGFzaCA8PCA1KSAtIGhhc2gpIF4gc3RyLmNoYXJDb2RlQXQoaSk7XG4gICAgcmV0dXJuIGhhc2ggPj4+IDA7XG59XG5mdW5jdGlvbiBjcmVhdGVfcnVsZShub2RlLCBhLCBiLCBkdXJhdGlvbiwgZGVsYXksIGVhc2UsIGZuLCB1aWQgPSAwKSB7XG4gICAgY29uc3Qgc3RlcCA9IDE2LjY2NiAvIGR1cmF0aW9uO1xuICAgIGxldCBrZXlmcmFtZXMgPSAne1xcbic7XG4gICAgZm9yIChsZXQgcCA9IDA7IHAgPD0gMTsgcCArPSBzdGVwKSB7XG4gICAgICAgIGNvbnN0IHQgPSBhICsgKGIgLSBhKSAqIGVhc2UocCk7XG4gICAgICAgIGtleWZyYW1lcyArPSBwICogMTAwICsgYCV7JHtmbih0LCAxIC0gdCl9fVxcbmA7XG4gICAgfVxuICAgIGNvbnN0IHJ1bGUgPSBrZXlmcmFtZXMgKyBgMTAwJSB7JHtmbihiLCAxIC0gYil9fVxcbn1gO1xuICAgIGNvbnN0IG5hbWUgPSBgX19zdmVsdGVfJHtoYXNoKHJ1bGUpfV8ke3VpZH1gO1xuICAgIGNvbnN0IGRvYyA9IG5vZGUub3duZXJEb2N1bWVudDtcbiAgICBhY3RpdmVfZG9jcy5hZGQoZG9jKTtcbiAgICBjb25zdCBzdHlsZXNoZWV0ID0gZG9jLl9fc3ZlbHRlX3N0eWxlc2hlZXQgfHwgKGRvYy5fX3N2ZWx0ZV9zdHlsZXNoZWV0ID0gZG9jLmhlYWQuYXBwZW5kQ2hpbGQoZWxlbWVudCgnc3R5bGUnKSkuc2hlZXQpO1xuICAgIGNvbnN0IGN1cnJlbnRfcnVsZXMgPSBkb2MuX19zdmVsdGVfcnVsZXMgfHwgKGRvYy5fX3N2ZWx0ZV9ydWxlcyA9IHt9KTtcbiAgICBpZiAoIWN1cnJlbnRfcnVsZXNbbmFtZV0pIHtcbiAgICAgICAgY3VycmVudF9ydWxlc1tuYW1lXSA9IHRydWU7XG4gICAgICAgIHN0eWxlc2hlZXQuaW5zZXJ0UnVsZShgQGtleWZyYW1lcyAke25hbWV9ICR7cnVsZX1gLCBzdHlsZXNoZWV0LmNzc1J1bGVzLmxlbmd0aCk7XG4gICAgfVxuICAgIGNvbnN0IGFuaW1hdGlvbiA9IG5vZGUuc3R5bGUuYW5pbWF0aW9uIHx8ICcnO1xuICAgIG5vZGUuc3R5bGUuYW5pbWF0aW9uID0gYCR7YW5pbWF0aW9uID8gYCR7YW5pbWF0aW9ufSwgYCA6IGBgfSR7bmFtZX0gJHtkdXJhdGlvbn1tcyBsaW5lYXIgJHtkZWxheX1tcyAxIGJvdGhgO1xuICAgIGFjdGl2ZSArPSAxO1xuICAgIHJldHVybiBuYW1lO1xufVxuZnVuY3Rpb24gZGVsZXRlX3J1bGUobm9kZSwgbmFtZSkge1xuICAgIGNvbnN0IHByZXZpb3VzID0gKG5vZGUuc3R5bGUuYW5pbWF0aW9uIHx8ICcnKS5zcGxpdCgnLCAnKTtcbiAgICBjb25zdCBuZXh0ID0gcHJldmlvdXMuZmlsdGVyKG5hbWVcbiAgICAgICAgPyBhbmltID0+IGFuaW0uaW5kZXhPZihuYW1lKSA8IDAgLy8gcmVtb3ZlIHNwZWNpZmljIGFuaW1hdGlvblxuICAgICAgICA6IGFuaW0gPT4gYW5pbS5pbmRleE9mKCdfX3N2ZWx0ZScpID09PSAtMSAvLyByZW1vdmUgYWxsIFN2ZWx0ZSBhbmltYXRpb25zXG4gICAgKTtcbiAgICBjb25zdCBkZWxldGVkID0gcHJldmlvdXMubGVuZ3RoIC0gbmV4dC5sZW5ndGg7XG4gICAgaWYgKGRlbGV0ZWQpIHtcbiAgICAgICAgbm9kZS5zdHlsZS5hbmltYXRpb24gPSBuZXh0LmpvaW4oJywgJyk7XG4gICAgICAgIGFjdGl2ZSAtPSBkZWxldGVkO1xuICAgICAgICBpZiAoIWFjdGl2ZSlcbiAgICAgICAgICAgIGNsZWFyX3J1bGVzKCk7XG4gICAgfVxufVxuZnVuY3Rpb24gY2xlYXJfcnVsZXMoKSB7XG4gICAgcmFmKCgpID0+IHtcbiAgICAgICAgaWYgKGFjdGl2ZSlcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgYWN0aXZlX2RvY3MuZm9yRWFjaChkb2MgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc3R5bGVzaGVldCA9IGRvYy5fX3N2ZWx0ZV9zdHlsZXNoZWV0O1xuICAgICAgICAgICAgbGV0IGkgPSBzdHlsZXNoZWV0LmNzc1J1bGVzLmxlbmd0aDtcbiAgICAgICAgICAgIHdoaWxlIChpLS0pXG4gICAgICAgICAgICAgICAgc3R5bGVzaGVldC5kZWxldGVSdWxlKGkpO1xuICAgICAgICAgICAgZG9jLl9fc3ZlbHRlX3J1bGVzID0ge307XG4gICAgICAgIH0pO1xuICAgICAgICBhY3RpdmVfZG9jcy5jbGVhcigpO1xuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVfYW5pbWF0aW9uKG5vZGUsIGZyb20sIGZuLCBwYXJhbXMpIHtcbiAgICBpZiAoIWZyb20pXG4gICAgICAgIHJldHVybiBub29wO1xuICAgIGNvbnN0IHRvID0gbm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBpZiAoZnJvbS5sZWZ0ID09PSB0by5sZWZ0ICYmIGZyb20ucmlnaHQgPT09IHRvLnJpZ2h0ICYmIGZyb20udG9wID09PSB0by50b3AgJiYgZnJvbS5ib3R0b20gPT09IHRvLmJvdHRvbSlcbiAgICAgICAgcmV0dXJuIG5vb3A7XG4gICAgY29uc3QgeyBkZWxheSA9IDAsIGR1cmF0aW9uID0gMzAwLCBlYXNpbmcgPSBpZGVudGl0eSwgXG4gICAgLy8gQHRzLWlnbm9yZSB0b2RvOiBzaG91bGQgdGhpcyBiZSBzZXBhcmF0ZWQgZnJvbSBkZXN0cnVjdHVyaW5nPyBPciBzdGFydC9lbmQgYWRkZWQgdG8gcHVibGljIGFwaSBhbmQgZG9jdW1lbnRhdGlvbj9cbiAgICBzdGFydDogc3RhcnRfdGltZSA9IG5vdygpICsgZGVsYXksIFxuICAgIC8vIEB0cy1pZ25vcmUgdG9kbzpcbiAgICBlbmQgPSBzdGFydF90aW1lICsgZHVyYXRpb24sIHRpY2sgPSBub29wLCBjc3MgfSA9IGZuKG5vZGUsIHsgZnJvbSwgdG8gfSwgcGFyYW1zKTtcbiAgICBsZXQgcnVubmluZyA9IHRydWU7XG4gICAgbGV0IHN0YXJ0ZWQgPSBmYWxzZTtcbiAgICBsZXQgbmFtZTtcbiAgICBmdW5jdGlvbiBzdGFydCgpIHtcbiAgICAgICAgaWYgKGNzcykge1xuICAgICAgICAgICAgbmFtZSA9IGNyZWF0ZV9ydWxlKG5vZGUsIDAsIDEsIGR1cmF0aW9uLCBkZWxheSwgZWFzaW5nLCBjc3MpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghZGVsYXkpIHtcbiAgICAgICAgICAgIHN0YXJ0ZWQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgfVxuICAgIGZ1bmN0aW9uIHN0b3AoKSB7XG4gICAgICAgIGlmIChjc3MpXG4gICAgICAgICAgICBkZWxldGVfcnVsZShub2RlLCBuYW1lKTtcbiAgICAgICAgcnVubmluZyA9IGZhbHNlO1xuICAgIH1cbiAgICBsb29wKG5vdyA9PiB7XG4gICAgICAgIGlmICghc3RhcnRlZCAmJiBub3cgPj0gc3RhcnRfdGltZSkge1xuICAgICAgICAgICAgc3RhcnRlZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHN0YXJ0ZWQgJiYgbm93ID49IGVuZCkge1xuICAgICAgICAgICAgdGljaygxLCAwKTtcbiAgICAgICAgICAgIHN0b3AoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXJ1bm5pbmcpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc3RhcnRlZCkge1xuICAgICAgICAgICAgY29uc3QgcCA9IG5vdyAtIHN0YXJ0X3RpbWU7XG4gICAgICAgICAgICBjb25zdCB0ID0gMCArIDEgKiBlYXNpbmcocCAvIGR1cmF0aW9uKTtcbiAgICAgICAgICAgIHRpY2sodCwgMSAtIHQpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH0pO1xuICAgIHN0YXJ0KCk7XG4gICAgdGljaygwLCAxKTtcbiAgICByZXR1cm4gc3RvcDtcbn1cbmZ1bmN0aW9uIGZpeF9wb3NpdGlvbihub2RlKSB7XG4gICAgY29uc3Qgc3R5bGUgPSBnZXRDb21wdXRlZFN0eWxlKG5vZGUpO1xuICAgIGlmIChzdHlsZS5wb3NpdGlvbiAhPT0gJ2Fic29sdXRlJyAmJiBzdHlsZS5wb3NpdGlvbiAhPT0gJ2ZpeGVkJykge1xuICAgICAgICBjb25zdCB7IHdpZHRoLCBoZWlnaHQgfSA9IHN0eWxlO1xuICAgICAgICBjb25zdCBhID0gbm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgbm9kZS5zdHlsZS5wb3NpdGlvbiA9ICdhYnNvbHV0ZSc7XG4gICAgICAgIG5vZGUuc3R5bGUud2lkdGggPSB3aWR0aDtcbiAgICAgICAgbm9kZS5zdHlsZS5oZWlnaHQgPSBoZWlnaHQ7XG4gICAgICAgIGFkZF90cmFuc2Zvcm0obm9kZSwgYSk7XG4gICAgfVxufVxuZnVuY3Rpb24gYWRkX3RyYW5zZm9ybShub2RlLCBhKSB7XG4gICAgY29uc3QgYiA9IG5vZGUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgaWYgKGEubGVmdCAhPT0gYi5sZWZ0IHx8IGEudG9wICE9PSBiLnRvcCkge1xuICAgICAgICBjb25zdCBzdHlsZSA9IGdldENvbXB1dGVkU3R5bGUobm9kZSk7XG4gICAgICAgIGNvbnN0IHRyYW5zZm9ybSA9IHN0eWxlLnRyYW5zZm9ybSA9PT0gJ25vbmUnID8gJycgOiBzdHlsZS50cmFuc2Zvcm07XG4gICAgICAgIG5vZGUuc3R5bGUudHJhbnNmb3JtID0gYCR7dHJhbnNmb3JtfSB0cmFuc2xhdGUoJHthLmxlZnQgLSBiLmxlZnR9cHgsICR7YS50b3AgLSBiLnRvcH1weClgO1xuICAgIH1cbn1cblxubGV0IGN1cnJlbnRfY29tcG9uZW50O1xuZnVuY3Rpb24gc2V0X2N1cnJlbnRfY29tcG9uZW50KGNvbXBvbmVudCkge1xuICAgIGN1cnJlbnRfY29tcG9uZW50ID0gY29tcG9uZW50O1xufVxuZnVuY3Rpb24gZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkge1xuICAgIGlmICghY3VycmVudF9jb21wb25lbnQpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRnVuY3Rpb24gY2FsbGVkIG91dHNpZGUgY29tcG9uZW50IGluaXRpYWxpemF0aW9uYCk7XG4gICAgcmV0dXJuIGN1cnJlbnRfY29tcG9uZW50O1xufVxuZnVuY3Rpb24gYmVmb3JlVXBkYXRlKGZuKSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuYmVmb3JlX3VwZGF0ZS5wdXNoKGZuKTtcbn1cbmZ1bmN0aW9uIG9uTW91bnQoZm4pIHtcbiAgICBnZXRfY3VycmVudF9jb21wb25lbnQoKS4kJC5vbl9tb3VudC5wdXNoKGZuKTtcbn1cbmZ1bmN0aW9uIGFmdGVyVXBkYXRlKGZuKSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuYWZ0ZXJfdXBkYXRlLnB1c2goZm4pO1xufVxuZnVuY3Rpb24gb25EZXN0cm95KGZuKSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQub25fZGVzdHJveS5wdXNoKGZuKTtcbn1cbmZ1bmN0aW9uIGNyZWF0ZUV2ZW50RGlzcGF0Y2hlcigpIHtcbiAgICBjb25zdCBjb21wb25lbnQgPSBnZXRfY3VycmVudF9jb21wb25lbnQoKTtcbiAgICByZXR1cm4gKHR5cGUsIGRldGFpbCkgPT4ge1xuICAgICAgICBjb25zdCBjYWxsYmFja3MgPSBjb21wb25lbnQuJCQuY2FsbGJhY2tzW3R5cGVdO1xuICAgICAgICBpZiAoY2FsbGJhY2tzKSB7XG4gICAgICAgICAgICAvLyBUT0RPIGFyZSB0aGVyZSBzaXR1YXRpb25zIHdoZXJlIGV2ZW50cyBjb3VsZCBiZSBkaXNwYXRjaGVkXG4gICAgICAgICAgICAvLyBpbiBhIHNlcnZlciAobm9uLURPTSkgZW52aXJvbm1lbnQ/XG4gICAgICAgICAgICBjb25zdCBldmVudCA9IGN1c3RvbV9ldmVudCh0eXBlLCBkZXRhaWwpO1xuICAgICAgICAgICAgY2FsbGJhY2tzLnNsaWNlKCkuZm9yRWFjaChmbiA9PiB7XG4gICAgICAgICAgICAgICAgZm4uY2FsbChjb21wb25lbnQsIGV2ZW50KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfTtcbn1cbmZ1bmN0aW9uIHNldENvbnRleHQoa2V5LCBjb250ZXh0KSB7XG4gICAgZ2V0X2N1cnJlbnRfY29tcG9uZW50KCkuJCQuY29udGV4dC5zZXQoa2V5LCBjb250ZXh0KTtcbn1cbmZ1bmN0aW9uIGdldENvbnRleHQoa2V5KSB7XG4gICAgcmV0dXJuIGdldF9jdXJyZW50X2NvbXBvbmVudCgpLiQkLmNvbnRleHQuZ2V0KGtleSk7XG59XG4vLyBUT0RPIGZpZ3VyZSBvdXQgaWYgd2Ugc3RpbGwgd2FudCB0byBzdXBwb3J0XG4vLyBzaG9ydGhhbmQgZXZlbnRzLCBvciBpZiB3ZSB3YW50IHRvIGltcGxlbWVudFxuLy8gYSByZWFsIGJ1YmJsaW5nIG1lY2hhbmlzbVxuZnVuY3Rpb24gYnViYmxlKGNvbXBvbmVudCwgZXZlbnQpIHtcbiAgICBjb25zdCBjYWxsYmFja3MgPSBjb21wb25lbnQuJCQuY2FsbGJhY2tzW2V2ZW50LnR5cGVdO1xuICAgIGlmIChjYWxsYmFja3MpIHtcbiAgICAgICAgY2FsbGJhY2tzLnNsaWNlKCkuZm9yRWFjaChmbiA9PiBmbihldmVudCkpO1xuICAgIH1cbn1cblxuY29uc3QgZGlydHlfY29tcG9uZW50cyA9IFtdO1xuY29uc3QgaW50cm9zID0geyBlbmFibGVkOiBmYWxzZSB9O1xuY29uc3QgYmluZGluZ19jYWxsYmFja3MgPSBbXTtcbmNvbnN0IHJlbmRlcl9jYWxsYmFja3MgPSBbXTtcbmNvbnN0IGZsdXNoX2NhbGxiYWNrcyA9IFtdO1xuY29uc3QgcmVzb2x2ZWRfcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xubGV0IHVwZGF0ZV9zY2hlZHVsZWQgPSBmYWxzZTtcbmZ1bmN0aW9uIHNjaGVkdWxlX3VwZGF0ZSgpIHtcbiAgICBpZiAoIXVwZGF0ZV9zY2hlZHVsZWQpIHtcbiAgICAgICAgdXBkYXRlX3NjaGVkdWxlZCA9IHRydWU7XG4gICAgICAgIHJlc29sdmVkX3Byb21pc2UudGhlbihmbHVzaCk7XG4gICAgfVxufVxuZnVuY3Rpb24gdGljaygpIHtcbiAgICBzY2hlZHVsZV91cGRhdGUoKTtcbiAgICByZXR1cm4gcmVzb2x2ZWRfcHJvbWlzZTtcbn1cbmZ1bmN0aW9uIGFkZF9yZW5kZXJfY2FsbGJhY2soZm4pIHtcbiAgICByZW5kZXJfY2FsbGJhY2tzLnB1c2goZm4pO1xufVxuZnVuY3Rpb24gYWRkX2ZsdXNoX2NhbGxiYWNrKGZuKSB7XG4gICAgZmx1c2hfY2FsbGJhY2tzLnB1c2goZm4pO1xufVxubGV0IGZsdXNoaW5nID0gZmFsc2U7XG5jb25zdCBzZWVuX2NhbGxiYWNrcyA9IG5ldyBTZXQoKTtcbmZ1bmN0aW9uIGZsdXNoKCkge1xuICAgIGlmIChmbHVzaGluZylcbiAgICAgICAgcmV0dXJuO1xuICAgIGZsdXNoaW5nID0gdHJ1ZTtcbiAgICBkbyB7XG4gICAgICAgIC8vIGZpcnN0LCBjYWxsIGJlZm9yZVVwZGF0ZSBmdW5jdGlvbnNcbiAgICAgICAgLy8gYW5kIHVwZGF0ZSBjb21wb25lbnRzXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGlydHlfY29tcG9uZW50cy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICAgICAgY29uc3QgY29tcG9uZW50ID0gZGlydHlfY29tcG9uZW50c1tpXTtcbiAgICAgICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChjb21wb25lbnQpO1xuICAgICAgICAgICAgdXBkYXRlKGNvbXBvbmVudC4kJCk7XG4gICAgICAgIH1cbiAgICAgICAgZGlydHlfY29tcG9uZW50cy5sZW5ndGggPSAwO1xuICAgICAgICB3aGlsZSAoYmluZGluZ19jYWxsYmFja3MubGVuZ3RoKVxuICAgICAgICAgICAgYmluZGluZ19jYWxsYmFja3MucG9wKCkoKTtcbiAgICAgICAgLy8gdGhlbiwgb25jZSBjb21wb25lbnRzIGFyZSB1cGRhdGVkLCBjYWxsXG4gICAgICAgIC8vIGFmdGVyVXBkYXRlIGZ1bmN0aW9ucy4gVGhpcyBtYXkgY2F1c2VcbiAgICAgICAgLy8gc3Vic2VxdWVudCB1cGRhdGVzLi4uXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmVuZGVyX2NhbGxiYWNrcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICAgICAgY29uc3QgY2FsbGJhY2sgPSByZW5kZXJfY2FsbGJhY2tzW2ldO1xuICAgICAgICAgICAgaWYgKCFzZWVuX2NhbGxiYWNrcy5oYXMoY2FsbGJhY2spKSB7XG4gICAgICAgICAgICAgICAgLy8gLi4uc28gZ3VhcmQgYWdhaW5zdCBpbmZpbml0ZSBsb29wc1xuICAgICAgICAgICAgICAgIHNlZW5fY2FsbGJhY2tzLmFkZChjYWxsYmFjayk7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZW5kZXJfY2FsbGJhY2tzLmxlbmd0aCA9IDA7XG4gICAgfSB3aGlsZSAoZGlydHlfY29tcG9uZW50cy5sZW5ndGgpO1xuICAgIHdoaWxlIChmbHVzaF9jYWxsYmFja3MubGVuZ3RoKSB7XG4gICAgICAgIGZsdXNoX2NhbGxiYWNrcy5wb3AoKSgpO1xuICAgIH1cbiAgICB1cGRhdGVfc2NoZWR1bGVkID0gZmFsc2U7XG4gICAgZmx1c2hpbmcgPSBmYWxzZTtcbiAgICBzZWVuX2NhbGxiYWNrcy5jbGVhcigpO1xufVxuZnVuY3Rpb24gdXBkYXRlKCQkKSB7XG4gICAgaWYgKCQkLmZyYWdtZW50ICE9PSBudWxsKSB7XG4gICAgICAgICQkLnVwZGF0ZSgpO1xuICAgICAgICBydW5fYWxsKCQkLmJlZm9yZV91cGRhdGUpO1xuICAgICAgICBjb25zdCBkaXJ0eSA9ICQkLmRpcnR5O1xuICAgICAgICAkJC5kaXJ0eSA9IFstMV07XG4gICAgICAgICQkLmZyYWdtZW50ICYmICQkLmZyYWdtZW50LnAoJCQuY3R4LCBkaXJ0eSk7XG4gICAgICAgICQkLmFmdGVyX3VwZGF0ZS5mb3JFYWNoKGFkZF9yZW5kZXJfY2FsbGJhY2spO1xuICAgIH1cbn1cblxubGV0IHByb21pc2U7XG5mdW5jdGlvbiB3YWl0KCkge1xuICAgIGlmICghcHJvbWlzZSkge1xuICAgICAgICBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIHByb21pc2UudGhlbigoKSA9PiB7XG4gICAgICAgICAgICBwcm9taXNlID0gbnVsbDtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBwcm9taXNlO1xufVxuZnVuY3Rpb24gZGlzcGF0Y2gobm9kZSwgZGlyZWN0aW9uLCBraW5kKSB7XG4gICAgbm9kZS5kaXNwYXRjaEV2ZW50KGN1c3RvbV9ldmVudChgJHtkaXJlY3Rpb24gPyAnaW50cm8nIDogJ291dHJvJ30ke2tpbmR9YCkpO1xufVxuY29uc3Qgb3V0cm9pbmcgPSBuZXcgU2V0KCk7XG5sZXQgb3V0cm9zO1xuZnVuY3Rpb24gZ3JvdXBfb3V0cm9zKCkge1xuICAgIG91dHJvcyA9IHtcbiAgICAgICAgcjogMCxcbiAgICAgICAgYzogW10sXG4gICAgICAgIHA6IG91dHJvcyAvLyBwYXJlbnQgZ3JvdXBcbiAgICB9O1xufVxuZnVuY3Rpb24gY2hlY2tfb3V0cm9zKCkge1xuICAgIGlmICghb3V0cm9zLnIpIHtcbiAgICAgICAgcnVuX2FsbChvdXRyb3MuYyk7XG4gICAgfVxuICAgIG91dHJvcyA9IG91dHJvcy5wO1xufVxuZnVuY3Rpb24gdHJhbnNpdGlvbl9pbihibG9jaywgbG9jYWwpIHtcbiAgICBpZiAoYmxvY2sgJiYgYmxvY2suaSkge1xuICAgICAgICBvdXRyb2luZy5kZWxldGUoYmxvY2spO1xuICAgICAgICBibG9jay5pKGxvY2FsKTtcbiAgICB9XG59XG5mdW5jdGlvbiB0cmFuc2l0aW9uX291dChibG9jaywgbG9jYWwsIGRldGFjaCwgY2FsbGJhY2spIHtcbiAgICBpZiAoYmxvY2sgJiYgYmxvY2subykge1xuICAgICAgICBpZiAob3V0cm9pbmcuaGFzKGJsb2NrKSlcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgb3V0cm9pbmcuYWRkKGJsb2NrKTtcbiAgICAgICAgb3V0cm9zLmMucHVzaCgoKSA9PiB7XG4gICAgICAgICAgICBvdXRyb2luZy5kZWxldGUoYmxvY2spO1xuICAgICAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICAgICAgaWYgKGRldGFjaClcbiAgICAgICAgICAgICAgICAgICAgYmxvY2suZCgxKTtcbiAgICAgICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgYmxvY2subyhsb2NhbCk7XG4gICAgfVxufVxuY29uc3QgbnVsbF90cmFuc2l0aW9uID0geyBkdXJhdGlvbjogMCB9O1xuZnVuY3Rpb24gY3JlYXRlX2luX3RyYW5zaXRpb24obm9kZSwgZm4sIHBhcmFtcykge1xuICAgIGxldCBjb25maWcgPSBmbihub2RlLCBwYXJhbXMpO1xuICAgIGxldCBydW5uaW5nID0gZmFsc2U7XG4gICAgbGV0IGFuaW1hdGlvbl9uYW1lO1xuICAgIGxldCB0YXNrO1xuICAgIGxldCB1aWQgPSAwO1xuICAgIGZ1bmN0aW9uIGNsZWFudXAoKSB7XG4gICAgICAgIGlmIChhbmltYXRpb25fbmFtZSlcbiAgICAgICAgICAgIGRlbGV0ZV9ydWxlKG5vZGUsIGFuaW1hdGlvbl9uYW1lKTtcbiAgICB9XG4gICAgZnVuY3Rpb24gZ28oKSB7XG4gICAgICAgIGNvbnN0IHsgZGVsYXkgPSAwLCBkdXJhdGlvbiA9IDMwMCwgZWFzaW5nID0gaWRlbnRpdHksIHRpY2sgPSBub29wLCBjc3MgfSA9IGNvbmZpZyB8fCBudWxsX3RyYW5zaXRpb247XG4gICAgICAgIGlmIChjc3MpXG4gICAgICAgICAgICBhbmltYXRpb25fbmFtZSA9IGNyZWF0ZV9ydWxlKG5vZGUsIDAsIDEsIGR1cmF0aW9uLCBkZWxheSwgZWFzaW5nLCBjc3MsIHVpZCsrKTtcbiAgICAgICAgdGljaygwLCAxKTtcbiAgICAgICAgY29uc3Qgc3RhcnRfdGltZSA9IG5vdygpICsgZGVsYXk7XG4gICAgICAgIGNvbnN0IGVuZF90aW1lID0gc3RhcnRfdGltZSArIGR1cmF0aW9uO1xuICAgICAgICBpZiAodGFzaylcbiAgICAgICAgICAgIHRhc2suYWJvcnQoKTtcbiAgICAgICAgcnVubmluZyA9IHRydWU7XG4gICAgICAgIGFkZF9yZW5kZXJfY2FsbGJhY2soKCkgPT4gZGlzcGF0Y2gobm9kZSwgdHJ1ZSwgJ3N0YXJ0JykpO1xuICAgICAgICB0YXNrID0gbG9vcChub3cgPT4ge1xuICAgICAgICAgICAgaWYgKHJ1bm5pbmcpIHtcbiAgICAgICAgICAgICAgICBpZiAobm93ID49IGVuZF90aW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHRpY2soMSwgMCk7XG4gICAgICAgICAgICAgICAgICAgIGRpc3BhdGNoKG5vZGUsIHRydWUsICdlbmQnKTtcbiAgICAgICAgICAgICAgICAgICAgY2xlYW51cCgpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gcnVubmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAobm93ID49IHN0YXJ0X3RpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdCA9IGVhc2luZygobm93IC0gc3RhcnRfdGltZSkgLyBkdXJhdGlvbik7XG4gICAgICAgICAgICAgICAgICAgIHRpY2sodCwgMSAtIHQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBydW5uaW5nO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgbGV0IHN0YXJ0ZWQgPSBmYWxzZTtcbiAgICByZXR1cm4ge1xuICAgICAgICBzdGFydCgpIHtcbiAgICAgICAgICAgIGlmIChzdGFydGVkKVxuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIGRlbGV0ZV9ydWxlKG5vZGUpO1xuICAgICAgICAgICAgaWYgKGlzX2Z1bmN0aW9uKGNvbmZpZykpIHtcbiAgICAgICAgICAgICAgICBjb25maWcgPSBjb25maWcoKTtcbiAgICAgICAgICAgICAgICB3YWl0KCkudGhlbihnbyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBnbygpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBpbnZhbGlkYXRlKCkge1xuICAgICAgICAgICAgc3RhcnRlZCA9IGZhbHNlO1xuICAgICAgICB9LFxuICAgICAgICBlbmQoKSB7XG4gICAgICAgICAgICBpZiAocnVubmluZykge1xuICAgICAgICAgICAgICAgIGNsZWFudXAoKTtcbiAgICAgICAgICAgICAgICBydW5uaW5nID0gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9O1xufVxuZnVuY3Rpb24gY3JlYXRlX291dF90cmFuc2l0aW9uKG5vZGUsIGZuLCBwYXJhbXMpIHtcbiAgICBsZXQgY29uZmlnID0gZm4obm9kZSwgcGFyYW1zKTtcbiAgICBsZXQgcnVubmluZyA9IHRydWU7XG4gICAgbGV0IGFuaW1hdGlvbl9uYW1lO1xuICAgIGNvbnN0IGdyb3VwID0gb3V0cm9zO1xuICAgIGdyb3VwLnIgKz0gMTtcbiAgICBmdW5jdGlvbiBnbygpIHtcbiAgICAgICAgY29uc3QgeyBkZWxheSA9IDAsIGR1cmF0aW9uID0gMzAwLCBlYXNpbmcgPSBpZGVudGl0eSwgdGljayA9IG5vb3AsIGNzcyB9ID0gY29uZmlnIHx8IG51bGxfdHJhbnNpdGlvbjtcbiAgICAgICAgaWYgKGNzcylcbiAgICAgICAgICAgIGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgMSwgMCwgZHVyYXRpb24sIGRlbGF5LCBlYXNpbmcsIGNzcyk7XG4gICAgICAgIGNvbnN0IHN0YXJ0X3RpbWUgPSBub3coKSArIGRlbGF5O1xuICAgICAgICBjb25zdCBlbmRfdGltZSA9IHN0YXJ0X3RpbWUgKyBkdXJhdGlvbjtcbiAgICAgICAgYWRkX3JlbmRlcl9jYWxsYmFjaygoKSA9PiBkaXNwYXRjaChub2RlLCBmYWxzZSwgJ3N0YXJ0JykpO1xuICAgICAgICBsb29wKG5vdyA9PiB7XG4gICAgICAgICAgICBpZiAocnVubmluZykge1xuICAgICAgICAgICAgICAgIGlmIChub3cgPj0gZW5kX3RpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGljaygwLCAxKTtcbiAgICAgICAgICAgICAgICAgICAgZGlzcGF0Y2gobm9kZSwgZmFsc2UsICdlbmQnKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCEtLWdyb3VwLnIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoaXMgd2lsbCByZXN1bHQgaW4gYGVuZCgpYCBiZWluZyBjYWxsZWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBzbyB3ZSBkb24ndCBuZWVkIHRvIGNsZWFuIHVwIGhlcmVcbiAgICAgICAgICAgICAgICAgICAgICAgIHJ1bl9hbGwoZ3JvdXAuYyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAobm93ID49IHN0YXJ0X3RpbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdCA9IGVhc2luZygobm93IC0gc3RhcnRfdGltZSkgLyBkdXJhdGlvbik7XG4gICAgICAgICAgICAgICAgICAgIHRpY2soMSAtIHQsIHQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBydW5uaW5nO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgaWYgKGlzX2Z1bmN0aW9uKGNvbmZpZykpIHtcbiAgICAgICAgd2FpdCgpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgY29uZmlnID0gY29uZmlnKCk7XG4gICAgICAgICAgICBnbygpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIGdvKCk7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICAgIGVuZChyZXNldCkge1xuICAgICAgICAgICAgaWYgKHJlc2V0ICYmIGNvbmZpZy50aWNrKSB7XG4gICAgICAgICAgICAgICAgY29uZmlnLnRpY2soMSwgMCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocnVubmluZykge1xuICAgICAgICAgICAgICAgIGlmIChhbmltYXRpb25fbmFtZSlcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlX3J1bGUobm9kZSwgYW5pbWF0aW9uX25hbWUpO1xuICAgICAgICAgICAgICAgIHJ1bm5pbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH07XG59XG5mdW5jdGlvbiBjcmVhdGVfYmlkaXJlY3Rpb25hbF90cmFuc2l0aW9uKG5vZGUsIGZuLCBwYXJhbXMsIGludHJvKSB7XG4gICAgbGV0IGNvbmZpZyA9IGZuKG5vZGUsIHBhcmFtcyk7XG4gICAgbGV0IHQgPSBpbnRybyA/IDAgOiAxO1xuICAgIGxldCBydW5uaW5nX3Byb2dyYW0gPSBudWxsO1xuICAgIGxldCBwZW5kaW5nX3Byb2dyYW0gPSBudWxsO1xuICAgIGxldCBhbmltYXRpb25fbmFtZSA9IG51bGw7XG4gICAgZnVuY3Rpb24gY2xlYXJfYW5pbWF0aW9uKCkge1xuICAgICAgICBpZiAoYW5pbWF0aW9uX25hbWUpXG4gICAgICAgICAgICBkZWxldGVfcnVsZShub2RlLCBhbmltYXRpb25fbmFtZSk7XG4gICAgfVxuICAgIGZ1bmN0aW9uIGluaXQocHJvZ3JhbSwgZHVyYXRpb24pIHtcbiAgICAgICAgY29uc3QgZCA9IHByb2dyYW0uYiAtIHQ7XG4gICAgICAgIGR1cmF0aW9uICo9IE1hdGguYWJzKGQpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgYTogdCxcbiAgICAgICAgICAgIGI6IHByb2dyYW0uYixcbiAgICAgICAgICAgIGQsXG4gICAgICAgICAgICBkdXJhdGlvbixcbiAgICAgICAgICAgIHN0YXJ0OiBwcm9ncmFtLnN0YXJ0LFxuICAgICAgICAgICAgZW5kOiBwcm9ncmFtLnN0YXJ0ICsgZHVyYXRpb24sXG4gICAgICAgICAgICBncm91cDogcHJvZ3JhbS5ncm91cFxuICAgICAgICB9O1xuICAgIH1cbiAgICBmdW5jdGlvbiBnbyhiKSB7XG4gICAgICAgIGNvbnN0IHsgZGVsYXkgPSAwLCBkdXJhdGlvbiA9IDMwMCwgZWFzaW5nID0gaWRlbnRpdHksIHRpY2sgPSBub29wLCBjc3MgfSA9IGNvbmZpZyB8fCBudWxsX3RyYW5zaXRpb247XG4gICAgICAgIGNvbnN0IHByb2dyYW0gPSB7XG4gICAgICAgICAgICBzdGFydDogbm93KCkgKyBkZWxheSxcbiAgICAgICAgICAgIGJcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKCFiKSB7XG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlIHRvZG86IGltcHJvdmUgdHlwaW5nc1xuICAgICAgICAgICAgcHJvZ3JhbS5ncm91cCA9IG91dHJvcztcbiAgICAgICAgICAgIG91dHJvcy5yICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJ1bm5pbmdfcHJvZ3JhbSkge1xuICAgICAgICAgICAgcGVuZGluZ19wcm9ncmFtID0gcHJvZ3JhbTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIC8vIGlmIHRoaXMgaXMgYW4gaW50cm8sIGFuZCB0aGVyZSdzIGEgZGVsYXksIHdlIG5lZWQgdG8gZG9cbiAgICAgICAgICAgIC8vIGFuIGluaXRpYWwgdGljayBhbmQvb3IgYXBwbHkgQ1NTIGFuaW1hdGlvbiBpbW1lZGlhdGVseVxuICAgICAgICAgICAgaWYgKGNzcykge1xuICAgICAgICAgICAgICAgIGNsZWFyX2FuaW1hdGlvbigpO1xuICAgICAgICAgICAgICAgIGFuaW1hdGlvbl9uYW1lID0gY3JlYXRlX3J1bGUobm9kZSwgdCwgYiwgZHVyYXRpb24sIGRlbGF5LCBlYXNpbmcsIGNzcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoYilcbiAgICAgICAgICAgICAgICB0aWNrKDAsIDEpO1xuICAgICAgICAgICAgcnVubmluZ19wcm9ncmFtID0gaW5pdChwcm9ncmFtLCBkdXJhdGlvbik7XG4gICAgICAgICAgICBhZGRfcmVuZGVyX2NhbGxiYWNrKCgpID0+IGRpc3BhdGNoKG5vZGUsIGIsICdzdGFydCcpKTtcbiAgICAgICAgICAgIGxvb3Aobm93ID0+IHtcbiAgICAgICAgICAgICAgICBpZiAocGVuZGluZ19wcm9ncmFtICYmIG5vdyA+IHBlbmRpbmdfcHJvZ3JhbS5zdGFydCkge1xuICAgICAgICAgICAgICAgICAgICBydW5uaW5nX3Byb2dyYW0gPSBpbml0KHBlbmRpbmdfcHJvZ3JhbSwgZHVyYXRpb24pO1xuICAgICAgICAgICAgICAgICAgICBwZW5kaW5nX3Byb2dyYW0gPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICBkaXNwYXRjaChub2RlLCBydW5uaW5nX3Byb2dyYW0uYiwgJ3N0YXJ0Jyk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsZWFyX2FuaW1hdGlvbigpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYW5pbWF0aW9uX25hbWUgPSBjcmVhdGVfcnVsZShub2RlLCB0LCBydW5uaW5nX3Byb2dyYW0uYiwgcnVubmluZ19wcm9ncmFtLmR1cmF0aW9uLCAwLCBlYXNpbmcsIGNvbmZpZy5jc3MpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChydW5uaW5nX3Byb2dyYW0pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG5vdyA+PSBydW5uaW5nX3Byb2dyYW0uZW5kKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aWNrKHQgPSBydW5uaW5nX3Byb2dyYW0uYiwgMSAtIHQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGlzcGF0Y2gobm9kZSwgcnVubmluZ19wcm9ncmFtLmIsICdlbmQnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghcGVuZGluZ19wcm9ncmFtKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gd2UncmUgZG9uZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChydW5uaW5nX3Byb2dyYW0uYikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBpbnRybyDigJQgd2UgY2FuIHRpZHkgdXAgaW1tZWRpYXRlbHlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xlYXJfYW5pbWF0aW9uKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBvdXRybyDigJQgbmVlZHMgdG8gYmUgY29vcmRpbmF0ZWRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCEtLXJ1bm5pbmdfcHJvZ3JhbS5ncm91cC5yKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcnVuX2FsbChydW5uaW5nX3Byb2dyYW0uZ3JvdXAuYyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgcnVubmluZ19wcm9ncmFtID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBlbHNlIGlmIChub3cgPj0gcnVubmluZ19wcm9ncmFtLnN0YXJ0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwID0gbm93IC0gcnVubmluZ19wcm9ncmFtLnN0YXJ0O1xuICAgICAgICAgICAgICAgICAgICAgICAgdCA9IHJ1bm5pbmdfcHJvZ3JhbS5hICsgcnVubmluZ19wcm9ncmFtLmQgKiBlYXNpbmcocCAvIHJ1bm5pbmdfcHJvZ3JhbS5kdXJhdGlvbik7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aWNrKHQsIDEgLSB0KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gISEocnVubmluZ19wcm9ncmFtIHx8IHBlbmRpbmdfcHJvZ3JhbSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgICBydW4oYikge1xuICAgICAgICAgICAgaWYgKGlzX2Z1bmN0aW9uKGNvbmZpZykpIHtcbiAgICAgICAgICAgICAgICB3YWl0KCkudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICAgICAgICAgICAgY29uZmlnID0gY29uZmlnKCk7XG4gICAgICAgICAgICAgICAgICAgIGdvKGIpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgZ28oYik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIGVuZCgpIHtcbiAgICAgICAgICAgIGNsZWFyX2FuaW1hdGlvbigpO1xuICAgICAgICAgICAgcnVubmluZ19wcm9ncmFtID0gcGVuZGluZ19wcm9ncmFtID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGhhbmRsZV9wcm9taXNlKHByb21pc2UsIGluZm8pIHtcbiAgICBjb25zdCB0b2tlbiA9IGluZm8udG9rZW4gPSB7fTtcbiAgICBmdW5jdGlvbiB1cGRhdGUodHlwZSwgaW5kZXgsIGtleSwgdmFsdWUpIHtcbiAgICAgICAgaWYgKGluZm8udG9rZW4gIT09IHRva2VuKVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICBpbmZvLnJlc29sdmVkID0gdmFsdWU7XG4gICAgICAgIGxldCBjaGlsZF9jdHggPSBpbmZvLmN0eDtcbiAgICAgICAgaWYgKGtleSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjaGlsZF9jdHggPSBjaGlsZF9jdHguc2xpY2UoKTtcbiAgICAgICAgICAgIGNoaWxkX2N0eFtrZXldID0gdmFsdWU7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYmxvY2sgPSB0eXBlICYmIChpbmZvLmN1cnJlbnQgPSB0eXBlKShjaGlsZF9jdHgpO1xuICAgICAgICBsZXQgbmVlZHNfZmx1c2ggPSBmYWxzZTtcbiAgICAgICAgaWYgKGluZm8uYmxvY2spIHtcbiAgICAgICAgICAgIGlmIChpbmZvLmJsb2Nrcykge1xuICAgICAgICAgICAgICAgIGluZm8uYmxvY2tzLmZvckVhY2goKGJsb2NrLCBpKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChpICE9PSBpbmRleCAmJiBibG9jaykge1xuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXBfb3V0cm9zKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cmFuc2l0aW9uX291dChibG9jaywgMSwgMSwgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZm8uYmxvY2tzW2ldID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgY2hlY2tfb3V0cm9zKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIGluZm8uYmxvY2suZCgxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJsb2NrLmMoKTtcbiAgICAgICAgICAgIHRyYW5zaXRpb25faW4oYmxvY2ssIDEpO1xuICAgICAgICAgICAgYmxvY2subShpbmZvLm1vdW50KCksIGluZm8uYW5jaG9yKTtcbiAgICAgICAgICAgIG5lZWRzX2ZsdXNoID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpbmZvLmJsb2NrID0gYmxvY2s7XG4gICAgICAgIGlmIChpbmZvLmJsb2NrcylcbiAgICAgICAgICAgIGluZm8uYmxvY2tzW2luZGV4XSA9IGJsb2NrO1xuICAgICAgICBpZiAobmVlZHNfZmx1c2gpIHtcbiAgICAgICAgICAgIGZsdXNoKCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKGlzX3Byb21pc2UocHJvbWlzZSkpIHtcbiAgICAgICAgY29uc3QgY3VycmVudF9jb21wb25lbnQgPSBnZXRfY3VycmVudF9jb21wb25lbnQoKTtcbiAgICAgICAgcHJvbWlzZS50aGVuKHZhbHVlID0+IHtcbiAgICAgICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChjdXJyZW50X2NvbXBvbmVudCk7XG4gICAgICAgICAgICB1cGRhdGUoaW5mby50aGVuLCAxLCBpbmZvLnZhbHVlLCB2YWx1ZSk7XG4gICAgICAgICAgICBzZXRfY3VycmVudF9jb21wb25lbnQobnVsbCk7XG4gICAgICAgIH0sIGVycm9yID0+IHtcbiAgICAgICAgICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChjdXJyZW50X2NvbXBvbmVudCk7XG4gICAgICAgICAgICB1cGRhdGUoaW5mby5jYXRjaCwgMiwgaW5mby5lcnJvciwgZXJyb3IpO1xuICAgICAgICAgICAgc2V0X2N1cnJlbnRfY29tcG9uZW50KG51bGwpO1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gaWYgd2UgcHJldmlvdXNseSBoYWQgYSB0aGVuL2NhdGNoIGJsb2NrLCBkZXN0cm95IGl0XG4gICAgICAgIGlmIChpbmZvLmN1cnJlbnQgIT09IGluZm8ucGVuZGluZykge1xuICAgICAgICAgICAgdXBkYXRlKGluZm8ucGVuZGluZywgMCk7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgaWYgKGluZm8uY3VycmVudCAhPT0gaW5mby50aGVuKSB7XG4gICAgICAgICAgICB1cGRhdGUoaW5mby50aGVuLCAxLCBpbmZvLnZhbHVlLCBwcm9taXNlKTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGluZm8ucmVzb2x2ZWQgPSBwcm9taXNlO1xuICAgIH1cbn1cblxuY29uc3QgZ2xvYmFscyA9ICh0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJ1xuICAgID8gd2luZG93XG4gICAgOiB0eXBlb2YgZ2xvYmFsVGhpcyAhPT0gJ3VuZGVmaW5lZCdcbiAgICAgICAgPyBnbG9iYWxUaGlzXG4gICAgICAgIDogZ2xvYmFsKTtcblxuZnVuY3Rpb24gZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKSB7XG4gICAgYmxvY2suZCgxKTtcbiAgICBsb29rdXAuZGVsZXRlKGJsb2NrLmtleSk7XG59XG5mdW5jdGlvbiBvdXRyb19hbmRfZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKSB7XG4gICAgdHJhbnNpdGlvbl9vdXQoYmxvY2ssIDEsIDEsICgpID0+IHtcbiAgICAgICAgbG9va3VwLmRlbGV0ZShibG9jay5rZXkpO1xuICAgIH0pO1xufVxuZnVuY3Rpb24gZml4X2FuZF9kZXN0cm95X2Jsb2NrKGJsb2NrLCBsb29rdXApIHtcbiAgICBibG9jay5mKCk7XG4gICAgZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKTtcbn1cbmZ1bmN0aW9uIGZpeF9hbmRfb3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2soYmxvY2ssIGxvb2t1cCkge1xuICAgIGJsb2NrLmYoKTtcbiAgICBvdXRyb19hbmRfZGVzdHJveV9ibG9jayhibG9jaywgbG9va3VwKTtcbn1cbmZ1bmN0aW9uIHVwZGF0ZV9rZXllZF9lYWNoKG9sZF9ibG9ja3MsIGRpcnR5LCBnZXRfa2V5LCBkeW5hbWljLCBjdHgsIGxpc3QsIGxvb2t1cCwgbm9kZSwgZGVzdHJveSwgY3JlYXRlX2VhY2hfYmxvY2ssIG5leHQsIGdldF9jb250ZXh0KSB7XG4gICAgbGV0IG8gPSBvbGRfYmxvY2tzLmxlbmd0aDtcbiAgICBsZXQgbiA9IGxpc3QubGVuZ3RoO1xuICAgIGxldCBpID0gbztcbiAgICBjb25zdCBvbGRfaW5kZXhlcyA9IHt9O1xuICAgIHdoaWxlIChpLS0pXG4gICAgICAgIG9sZF9pbmRleGVzW29sZF9ibG9ja3NbaV0ua2V5XSA9IGk7XG4gICAgY29uc3QgbmV3X2Jsb2NrcyA9IFtdO1xuICAgIGNvbnN0IG5ld19sb29rdXAgPSBuZXcgTWFwKCk7XG4gICAgY29uc3QgZGVsdGFzID0gbmV3IE1hcCgpO1xuICAgIGkgPSBuO1xuICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgY29uc3QgY2hpbGRfY3R4ID0gZ2V0X2NvbnRleHQoY3R4LCBsaXN0LCBpKTtcbiAgICAgICAgY29uc3Qga2V5ID0gZ2V0X2tleShjaGlsZF9jdHgpO1xuICAgICAgICBsZXQgYmxvY2sgPSBsb29rdXAuZ2V0KGtleSk7XG4gICAgICAgIGlmICghYmxvY2spIHtcbiAgICAgICAgICAgIGJsb2NrID0gY3JlYXRlX2VhY2hfYmxvY2soa2V5LCBjaGlsZF9jdHgpO1xuICAgICAgICAgICAgYmxvY2suYygpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGR5bmFtaWMpIHtcbiAgICAgICAgICAgIGJsb2NrLnAoY2hpbGRfY3R4LCBkaXJ0eSk7XG4gICAgICAgIH1cbiAgICAgICAgbmV3X2xvb2t1cC5zZXQoa2V5LCBuZXdfYmxvY2tzW2ldID0gYmxvY2spO1xuICAgICAgICBpZiAoa2V5IGluIG9sZF9pbmRleGVzKVxuICAgICAgICAgICAgZGVsdGFzLnNldChrZXksIE1hdGguYWJzKGkgLSBvbGRfaW5kZXhlc1trZXldKSk7XG4gICAgfVxuICAgIGNvbnN0IHdpbGxfbW92ZSA9IG5ldyBTZXQoKTtcbiAgICBjb25zdCBkaWRfbW92ZSA9IG5ldyBTZXQoKTtcbiAgICBmdW5jdGlvbiBpbnNlcnQoYmxvY2spIHtcbiAgICAgICAgdHJhbnNpdGlvbl9pbihibG9jaywgMSk7XG4gICAgICAgIGJsb2NrLm0obm9kZSwgbmV4dCwgbG9va3VwLmhhcyhibG9jay5rZXkpKTtcbiAgICAgICAgbG9va3VwLnNldChibG9jay5rZXksIGJsb2NrKTtcbiAgICAgICAgbmV4dCA9IGJsb2NrLmZpcnN0O1xuICAgICAgICBuLS07XG4gICAgfVxuICAgIHdoaWxlIChvICYmIG4pIHtcbiAgICAgICAgY29uc3QgbmV3X2Jsb2NrID0gbmV3X2Jsb2Nrc1tuIC0gMV07XG4gICAgICAgIGNvbnN0IG9sZF9ibG9jayA9IG9sZF9ibG9ja3NbbyAtIDFdO1xuICAgICAgICBjb25zdCBuZXdfa2V5ID0gbmV3X2Jsb2NrLmtleTtcbiAgICAgICAgY29uc3Qgb2xkX2tleSA9IG9sZF9ibG9jay5rZXk7XG4gICAgICAgIGlmIChuZXdfYmxvY2sgPT09IG9sZF9ibG9jaykge1xuICAgICAgICAgICAgLy8gZG8gbm90aGluZ1xuICAgICAgICAgICAgbmV4dCA9IG5ld19ibG9jay5maXJzdDtcbiAgICAgICAgICAgIG8tLTtcbiAgICAgICAgICAgIG4tLTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmICghbmV3X2xvb2t1cC5oYXMob2xkX2tleSkpIHtcbiAgICAgICAgICAgIC8vIHJlbW92ZSBvbGQgYmxvY2tcbiAgICAgICAgICAgIGRlc3Ryb3kob2xkX2Jsb2NrLCBsb29rdXApO1xuICAgICAgICAgICAgby0tO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKCFsb29rdXAuaGFzKG5ld19rZXkpIHx8IHdpbGxfbW92ZS5oYXMobmV3X2tleSkpIHtcbiAgICAgICAgICAgIGluc2VydChuZXdfYmxvY2spO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGRpZF9tb3ZlLmhhcyhvbGRfa2V5KSkge1xuICAgICAgICAgICAgby0tO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGRlbHRhcy5nZXQobmV3X2tleSkgPiBkZWx0YXMuZ2V0KG9sZF9rZXkpKSB7XG4gICAgICAgICAgICBkaWRfbW92ZS5hZGQobmV3X2tleSk7XG4gICAgICAgICAgICBpbnNlcnQobmV3X2Jsb2NrKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHdpbGxfbW92ZS5hZGQob2xkX2tleSk7XG4gICAgICAgICAgICBvLS07XG4gICAgICAgIH1cbiAgICB9XG4gICAgd2hpbGUgKG8tLSkge1xuICAgICAgICBjb25zdCBvbGRfYmxvY2sgPSBvbGRfYmxvY2tzW29dO1xuICAgICAgICBpZiAoIW5ld19sb29rdXAuaGFzKG9sZF9ibG9jay5rZXkpKVxuICAgICAgICAgICAgZGVzdHJveShvbGRfYmxvY2ssIGxvb2t1cCk7XG4gICAgfVxuICAgIHdoaWxlIChuKVxuICAgICAgICBpbnNlcnQobmV3X2Jsb2Nrc1tuIC0gMV0pO1xuICAgIHJldHVybiBuZXdfYmxvY2tzO1xufVxuZnVuY3Rpb24gdmFsaWRhdGVfZWFjaF9rZXlzKGN0eCwgbGlzdCwgZ2V0X2NvbnRleHQsIGdldF9rZXkpIHtcbiAgICBjb25zdCBrZXlzID0gbmV3IFNldCgpO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCBrZXkgPSBnZXRfa2V5KGdldF9jb250ZXh0KGN0eCwgbGlzdCwgaSkpO1xuICAgICAgICBpZiAoa2V5cy5oYXMoa2V5KSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgaGF2ZSBkdXBsaWNhdGUga2V5cyBpbiBhIGtleWVkIGVhY2hgKTtcbiAgICAgICAgfVxuICAgICAgICBrZXlzLmFkZChrZXkpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2V0X3NwcmVhZF91cGRhdGUobGV2ZWxzLCB1cGRhdGVzKSB7XG4gICAgY29uc3QgdXBkYXRlID0ge307XG4gICAgY29uc3QgdG9fbnVsbF9vdXQgPSB7fTtcbiAgICBjb25zdCBhY2NvdW50ZWRfZm9yID0geyAkJHNjb3BlOiAxIH07XG4gICAgbGV0IGkgPSBsZXZlbHMubGVuZ3RoO1xuICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgY29uc3QgbyA9IGxldmVsc1tpXTtcbiAgICAgICAgY29uc3QgbiA9IHVwZGF0ZXNbaV07XG4gICAgICAgIGlmIChuKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBvKSB7XG4gICAgICAgICAgICAgICAgaWYgKCEoa2V5IGluIG4pKVxuICAgICAgICAgICAgICAgICAgICB0b19udWxsX291dFtrZXldID0gMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIG4pIHtcbiAgICAgICAgICAgICAgICBpZiAoIWFjY291bnRlZF9mb3Jba2V5XSkge1xuICAgICAgICAgICAgICAgICAgICB1cGRhdGVba2V5XSA9IG5ba2V5XTtcbiAgICAgICAgICAgICAgICAgICAgYWNjb3VudGVkX2ZvcltrZXldID0gMTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBsZXZlbHNbaV0gPSBuO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gbykge1xuICAgICAgICAgICAgICAgIGFjY291bnRlZF9mb3Jba2V5XSA9IDE7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgZm9yIChjb25zdCBrZXkgaW4gdG9fbnVsbF9vdXQpIHtcbiAgICAgICAgaWYgKCEoa2V5IGluIHVwZGF0ZSkpXG4gICAgICAgICAgICB1cGRhdGVba2V5XSA9IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgcmV0dXJuIHVwZGF0ZTtcbn1cbmZ1bmN0aW9uIGdldF9zcHJlYWRfb2JqZWN0KHNwcmVhZF9wcm9wcykge1xuICAgIHJldHVybiB0eXBlb2Ygc3ByZWFkX3Byb3BzID09PSAnb2JqZWN0JyAmJiBzcHJlYWRfcHJvcHMgIT09IG51bGwgPyBzcHJlYWRfcHJvcHMgOiB7fTtcbn1cblxuLy8gc291cmNlOiBodHRwczovL2h0bWwuc3BlYy53aGF0d2cub3JnL211bHRpcGFnZS9pbmRpY2VzLmh0bWxcbmNvbnN0IGJvb2xlYW5fYXR0cmlidXRlcyA9IG5ldyBTZXQoW1xuICAgICdhbGxvd2Z1bGxzY3JlZW4nLFxuICAgICdhbGxvd3BheW1lbnRyZXF1ZXN0JyxcbiAgICAnYXN5bmMnLFxuICAgICdhdXRvZm9jdXMnLFxuICAgICdhdXRvcGxheScsXG4gICAgJ2NoZWNrZWQnLFxuICAgICdjb250cm9scycsXG4gICAgJ2RlZmF1bHQnLFxuICAgICdkZWZlcicsXG4gICAgJ2Rpc2FibGVkJyxcbiAgICAnZm9ybW5vdmFsaWRhdGUnLFxuICAgICdoaWRkZW4nLFxuICAgICdpc21hcCcsXG4gICAgJ2xvb3AnLFxuICAgICdtdWx0aXBsZScsXG4gICAgJ211dGVkJyxcbiAgICAnbm9tb2R1bGUnLFxuICAgICdub3ZhbGlkYXRlJyxcbiAgICAnb3BlbicsXG4gICAgJ3BsYXlzaW5saW5lJyxcbiAgICAncmVhZG9ubHknLFxuICAgICdyZXF1aXJlZCcsXG4gICAgJ3JldmVyc2VkJyxcbiAgICAnc2VsZWN0ZWQnXG5dKTtcblxuY29uc3QgaW52YWxpZF9hdHRyaWJ1dGVfbmFtZV9jaGFyYWN0ZXIgPSAvW1xccydcIj4vPVxcdXtGREQwfS1cXHV7RkRFRn1cXHV7RkZGRX1cXHV7RkZGRn1cXHV7MUZGRkV9XFx1ezFGRkZGfVxcdXsyRkZGRX1cXHV7MkZGRkZ9XFx1ezNGRkZFfVxcdXszRkZGRn1cXHV7NEZGRkV9XFx1ezRGRkZGfVxcdXs1RkZGRX1cXHV7NUZGRkZ9XFx1ezZGRkZFfVxcdXs2RkZGRn1cXHV7N0ZGRkV9XFx1ezdGRkZGfVxcdXs4RkZGRX1cXHV7OEZGRkZ9XFx1ezlGRkZFfVxcdXs5RkZGRn1cXHV7QUZGRkV9XFx1e0FGRkZGfVxcdXtCRkZGRX1cXHV7QkZGRkZ9XFx1e0NGRkZFfVxcdXtDRkZGRn1cXHV7REZGRkV9XFx1e0RGRkZGfVxcdXtFRkZGRX1cXHV7RUZGRkZ9XFx1e0ZGRkZFfVxcdXtGRkZGRn1cXHV7MTBGRkZFfVxcdXsxMEZGRkZ9XS91O1xuLy8gaHR0cHM6Ly9odG1sLnNwZWMud2hhdHdnLm9yZy9tdWx0aXBhZ2Uvc3ludGF4Lmh0bWwjYXR0cmlidXRlcy0yXG4vLyBodHRwczovL2luZnJhLnNwZWMud2hhdHdnLm9yZy8jbm9uY2hhcmFjdGVyXG5mdW5jdGlvbiBzcHJlYWQoYXJncywgY2xhc3Nlc190b19hZGQpIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gT2JqZWN0LmFzc2lnbih7fSwgLi4uYXJncyk7XG4gICAgaWYgKGNsYXNzZXNfdG9fYWRkKSB7XG4gICAgICAgIGlmIChhdHRyaWJ1dGVzLmNsYXNzID09IG51bGwpIHtcbiAgICAgICAgICAgIGF0dHJpYnV0ZXMuY2xhc3MgPSBjbGFzc2VzX3RvX2FkZDtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGF0dHJpYnV0ZXMuY2xhc3MgKz0gJyAnICsgY2xhc3Nlc190b19hZGQ7XG4gICAgICAgIH1cbiAgICB9XG4gICAgbGV0IHN0ciA9ICcnO1xuICAgIE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpLmZvckVhY2gobmFtZSA9PiB7XG4gICAgICAgIGlmIChpbnZhbGlkX2F0dHJpYnV0ZV9uYW1lX2NoYXJhY3Rlci50ZXN0KG5hbWUpKVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICBjb25zdCB2YWx1ZSA9IGF0dHJpYnV0ZXNbbmFtZV07XG4gICAgICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSlcbiAgICAgICAgICAgIHN0ciArPSBcIiBcIiArIG5hbWU7XG4gICAgICAgIGVsc2UgaWYgKGJvb2xlYW5fYXR0cmlidXRlcy5oYXMobmFtZS50b0xvd2VyQ2FzZSgpKSkge1xuICAgICAgICAgICAgaWYgKHZhbHVlKVxuICAgICAgICAgICAgICAgIHN0ciArPSBcIiBcIiArIG5hbWU7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAodmFsdWUgIT0gbnVsbCkge1xuICAgICAgICAgICAgc3RyICs9IGAgJHtuYW1lfT1cIiR7U3RyaW5nKHZhbHVlKS5yZXBsYWNlKC9cIi9nLCAnJiMzNDsnKS5yZXBsYWNlKC8nL2csICcmIzM5OycpfVwiYDtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiBzdHI7XG59XG5jb25zdCBlc2NhcGVkID0ge1xuICAgICdcIic6ICcmcXVvdDsnLFxuICAgIFwiJ1wiOiAnJiMzOTsnLFxuICAgICcmJzogJyZhbXA7JyxcbiAgICAnPCc6ICcmbHQ7JyxcbiAgICAnPic6ICcmZ3Q7J1xufTtcbmZ1bmN0aW9uIGVzY2FwZShodG1sKSB7XG4gICAgcmV0dXJuIFN0cmluZyhodG1sKS5yZXBsYWNlKC9bXCInJjw+XS9nLCBtYXRjaCA9PiBlc2NhcGVkW21hdGNoXSk7XG59XG5mdW5jdGlvbiBlYWNoKGl0ZW1zLCBmbikge1xuICAgIGxldCBzdHIgPSAnJztcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGl0ZW1zLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgIHN0ciArPSBmbihpdGVtc1tpXSwgaSk7XG4gICAgfVxuICAgIHJldHVybiBzdHI7XG59XG5jb25zdCBtaXNzaW5nX2NvbXBvbmVudCA9IHtcbiAgICAkJHJlbmRlcjogKCkgPT4gJydcbn07XG5mdW5jdGlvbiB2YWxpZGF0ZV9jb21wb25lbnQoY29tcG9uZW50LCBuYW1lKSB7XG4gICAgaWYgKCFjb21wb25lbnQgfHwgIWNvbXBvbmVudC4kJHJlbmRlcikge1xuICAgICAgICBpZiAobmFtZSA9PT0gJ3N2ZWx0ZTpjb21wb25lbnQnKVxuICAgICAgICAgICAgbmFtZSArPSAnIHRoaXM9ey4uLn0nO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYDwke25hbWV9PiBpcyBub3QgYSB2YWxpZCBTU1IgY29tcG9uZW50LiBZb3UgbWF5IG5lZWQgdG8gcmV2aWV3IHlvdXIgYnVpbGQgY29uZmlnIHRvIGVuc3VyZSB0aGF0IGRlcGVuZGVuY2llcyBhcmUgY29tcGlsZWQsIHJhdGhlciB0aGFuIGltcG9ydGVkIGFzIHByZS1jb21waWxlZCBtb2R1bGVzYCk7XG4gICAgfVxuICAgIHJldHVybiBjb21wb25lbnQ7XG59XG5mdW5jdGlvbiBkZWJ1ZyhmaWxlLCBsaW5lLCBjb2x1bW4sIHZhbHVlcykge1xuICAgIGNvbnNvbGUubG9nKGB7QGRlYnVnfSAke2ZpbGUgPyBmaWxlICsgJyAnIDogJyd9KCR7bGluZX06JHtjb2x1bW59KWApOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLWNvbnNvbGVcbiAgICBjb25zb2xlLmxvZyh2YWx1ZXMpOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLWNvbnNvbGVcbiAgICByZXR1cm4gJyc7XG59XG5sZXQgb25fZGVzdHJveTtcbmZ1bmN0aW9uIGNyZWF0ZV9zc3JfY29tcG9uZW50KGZuKSB7XG4gICAgZnVuY3Rpb24gJCRyZW5kZXIocmVzdWx0LCBwcm9wcywgYmluZGluZ3MsIHNsb3RzKSB7XG4gICAgICAgIGNvbnN0IHBhcmVudF9jb21wb25lbnQgPSBjdXJyZW50X2NvbXBvbmVudDtcbiAgICAgICAgY29uc3QgJCQgPSB7XG4gICAgICAgICAgICBvbl9kZXN0cm95LFxuICAgICAgICAgICAgY29udGV4dDogbmV3IE1hcChwYXJlbnRfY29tcG9uZW50ID8gcGFyZW50X2NvbXBvbmVudC4kJC5jb250ZXh0IDogW10pLFxuICAgICAgICAgICAgLy8gdGhlc2Ugd2lsbCBiZSBpbW1lZGlhdGVseSBkaXNjYXJkZWRcbiAgICAgICAgICAgIG9uX21vdW50OiBbXSxcbiAgICAgICAgICAgIGJlZm9yZV91cGRhdGU6IFtdLFxuICAgICAgICAgICAgYWZ0ZXJfdXBkYXRlOiBbXSxcbiAgICAgICAgICAgIGNhbGxiYWNrczogYmxhbmtfb2JqZWN0KClcbiAgICAgICAgfTtcbiAgICAgICAgc2V0X2N1cnJlbnRfY29tcG9uZW50KHsgJCQgfSk7XG4gICAgICAgIGNvbnN0IGh0bWwgPSBmbihyZXN1bHQsIHByb3BzLCBiaW5kaW5ncywgc2xvdHMpO1xuICAgICAgICBzZXRfY3VycmVudF9jb21wb25lbnQocGFyZW50X2NvbXBvbmVudCk7XG4gICAgICAgIHJldHVybiBodG1sO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgICByZW5kZXI6IChwcm9wcyA9IHt9LCBvcHRpb25zID0ge30pID0+IHtcbiAgICAgICAgICAgIG9uX2Rlc3Ryb3kgPSBbXTtcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IHsgdGl0bGU6ICcnLCBoZWFkOiAnJywgY3NzOiBuZXcgU2V0KCkgfTtcbiAgICAgICAgICAgIGNvbnN0IGh0bWwgPSAkJHJlbmRlcihyZXN1bHQsIHByb3BzLCB7fSwgb3B0aW9ucyk7XG4gICAgICAgICAgICBydW5fYWxsKG9uX2Rlc3Ryb3kpO1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBodG1sLFxuICAgICAgICAgICAgICAgIGNzczoge1xuICAgICAgICAgICAgICAgICAgICBjb2RlOiBBcnJheS5mcm9tKHJlc3VsdC5jc3MpLm1hcChjc3MgPT4gY3NzLmNvZGUpLmpvaW4oJ1xcbicpLFxuICAgICAgICAgICAgICAgICAgICBtYXA6IG51bGwgLy8gVE9ET1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgaGVhZDogcmVzdWx0LnRpdGxlICsgcmVzdWx0LmhlYWRcbiAgICAgICAgICAgIH07XG4gICAgICAgIH0sXG4gICAgICAgICQkcmVuZGVyXG4gICAgfTtcbn1cbmZ1bmN0aW9uIGFkZF9hdHRyaWJ1dGUobmFtZSwgdmFsdWUsIGJvb2xlYW4pIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCB8fCAoYm9vbGVhbiAmJiAhdmFsdWUpKVxuICAgICAgICByZXR1cm4gJyc7XG4gICAgcmV0dXJuIGAgJHtuYW1lfSR7dmFsdWUgPT09IHRydWUgPyAnJyA6IGA9JHt0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnID8gSlNPTi5zdHJpbmdpZnkoZXNjYXBlKHZhbHVlKSkgOiBgXCIke3ZhbHVlfVwiYH1gfWA7XG59XG5mdW5jdGlvbiBhZGRfY2xhc3NlcyhjbGFzc2VzKSB7XG4gICAgcmV0dXJuIGNsYXNzZXMgPyBgIGNsYXNzPVwiJHtjbGFzc2VzfVwiYCA6IGBgO1xufVxuXG5mdW5jdGlvbiBiaW5kKGNvbXBvbmVudCwgbmFtZSwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBpbmRleCA9IGNvbXBvbmVudC4kJC5wcm9wc1tuYW1lXTtcbiAgICBpZiAoaW5kZXggIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBjb21wb25lbnQuJCQuYm91bmRbaW5kZXhdID0gY2FsbGJhY2s7XG4gICAgICAgIGNhbGxiYWNrKGNvbXBvbmVudC4kJC5jdHhbaW5kZXhdKTtcbiAgICB9XG59XG5mdW5jdGlvbiBjcmVhdGVfY29tcG9uZW50KGJsb2NrKSB7XG4gICAgYmxvY2sgJiYgYmxvY2suYygpO1xufVxuZnVuY3Rpb24gY2xhaW1fY29tcG9uZW50KGJsb2NrLCBwYXJlbnRfbm9kZXMpIHtcbiAgICBibG9jayAmJiBibG9jay5sKHBhcmVudF9ub2Rlcyk7XG59XG5mdW5jdGlvbiBtb3VudF9jb21wb25lbnQoY29tcG9uZW50LCB0YXJnZXQsIGFuY2hvcikge1xuICAgIGNvbnN0IHsgZnJhZ21lbnQsIG9uX21vdW50LCBvbl9kZXN0cm95LCBhZnRlcl91cGRhdGUgfSA9IGNvbXBvbmVudC4kJDtcbiAgICBmcmFnbWVudCAmJiBmcmFnbWVudC5tKHRhcmdldCwgYW5jaG9yKTtcbiAgICAvLyBvbk1vdW50IGhhcHBlbnMgYmVmb3JlIHRoZSBpbml0aWFsIGFmdGVyVXBkYXRlXG4gICAgYWRkX3JlbmRlcl9jYWxsYmFjaygoKSA9PiB7XG4gICAgICAgIGNvbnN0IG5ld19vbl9kZXN0cm95ID0gb25fbW91bnQubWFwKHJ1bikuZmlsdGVyKGlzX2Z1bmN0aW9uKTtcbiAgICAgICAgaWYgKG9uX2Rlc3Ryb3kpIHtcbiAgICAgICAgICAgIG9uX2Rlc3Ryb3kucHVzaCguLi5uZXdfb25fZGVzdHJveSk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAvLyBFZGdlIGNhc2UgLSBjb21wb25lbnQgd2FzIGRlc3Ryb3llZCBpbW1lZGlhdGVseSxcbiAgICAgICAgICAgIC8vIG1vc3QgbGlrZWx5IGFzIGEgcmVzdWx0IG9mIGEgYmluZGluZyBpbml0aWFsaXNpbmdcbiAgICAgICAgICAgIHJ1bl9hbGwobmV3X29uX2Rlc3Ryb3kpO1xuICAgICAgICB9XG4gICAgICAgIGNvbXBvbmVudC4kJC5vbl9tb3VudCA9IFtdO1xuICAgIH0pO1xuICAgIGFmdGVyX3VwZGF0ZS5mb3JFYWNoKGFkZF9yZW5kZXJfY2FsbGJhY2spO1xufVxuZnVuY3Rpb24gZGVzdHJveV9jb21wb25lbnQoY29tcG9uZW50LCBkZXRhY2hpbmcpIHtcbiAgICBjb25zdCAkJCA9IGNvbXBvbmVudC4kJDtcbiAgICBpZiAoJCQuZnJhZ21lbnQgIT09IG51bGwpIHtcbiAgICAgICAgcnVuX2FsbCgkJC5vbl9kZXN0cm95KTtcbiAgICAgICAgJCQuZnJhZ21lbnQgJiYgJCQuZnJhZ21lbnQuZChkZXRhY2hpbmcpO1xuICAgICAgICAvLyBUT0RPIG51bGwgb3V0IG90aGVyIHJlZnMsIGluY2x1ZGluZyBjb21wb25lbnQuJCQgKGJ1dCBuZWVkIHRvXG4gICAgICAgIC8vIHByZXNlcnZlIGZpbmFsIHN0YXRlPylcbiAgICAgICAgJCQub25fZGVzdHJveSA9ICQkLmZyYWdtZW50ID0gbnVsbDtcbiAgICAgICAgJCQuY3R4ID0gW107XG4gICAgfVxufVxuZnVuY3Rpb24gbWFrZV9kaXJ0eShjb21wb25lbnQsIGkpIHtcbiAgICBpZiAoY29tcG9uZW50LiQkLmRpcnR5WzBdID09PSAtMSkge1xuICAgICAgICBkaXJ0eV9jb21wb25lbnRzLnB1c2goY29tcG9uZW50KTtcbiAgICAgICAgc2NoZWR1bGVfdXBkYXRlKCk7XG4gICAgICAgIGNvbXBvbmVudC4kJC5kaXJ0eS5maWxsKDApO1xuICAgIH1cbiAgICBjb21wb25lbnQuJCQuZGlydHlbKGkgLyAzMSkgfCAwXSB8PSAoMSA8PCAoaSAlIDMxKSk7XG59XG5mdW5jdGlvbiBpbml0KGNvbXBvbmVudCwgb3B0aW9ucywgaW5zdGFuY2UsIGNyZWF0ZV9mcmFnbWVudCwgbm90X2VxdWFsLCBwcm9wcywgZGlydHkgPSBbLTFdKSB7XG4gICAgY29uc3QgcGFyZW50X2NvbXBvbmVudCA9IGN1cnJlbnRfY29tcG9uZW50O1xuICAgIHNldF9jdXJyZW50X2NvbXBvbmVudChjb21wb25lbnQpO1xuICAgIGNvbnN0IHByb3BfdmFsdWVzID0gb3B0aW9ucy5wcm9wcyB8fCB7fTtcbiAgICBjb25zdCAkJCA9IGNvbXBvbmVudC4kJCA9IHtcbiAgICAgICAgZnJhZ21lbnQ6IG51bGwsXG4gICAgICAgIGN0eDogbnVsbCxcbiAgICAgICAgLy8gc3RhdGVcbiAgICAgICAgcHJvcHMsXG4gICAgICAgIHVwZGF0ZTogbm9vcCxcbiAgICAgICAgbm90X2VxdWFsLFxuICAgICAgICBib3VuZDogYmxhbmtfb2JqZWN0KCksXG4gICAgICAgIC8vIGxpZmVjeWNsZVxuICAgICAgICBvbl9tb3VudDogW10sXG4gICAgICAgIG9uX2Rlc3Ryb3k6IFtdLFxuICAgICAgICBiZWZvcmVfdXBkYXRlOiBbXSxcbiAgICAgICAgYWZ0ZXJfdXBkYXRlOiBbXSxcbiAgICAgICAgY29udGV4dDogbmV3IE1hcChwYXJlbnRfY29tcG9uZW50ID8gcGFyZW50X2NvbXBvbmVudC4kJC5jb250ZXh0IDogW10pLFxuICAgICAgICAvLyBldmVyeXRoaW5nIGVsc2VcbiAgICAgICAgY2FsbGJhY2tzOiBibGFua19vYmplY3QoKSxcbiAgICAgICAgZGlydHlcbiAgICB9O1xuICAgIGxldCByZWFkeSA9IGZhbHNlO1xuICAgICQkLmN0eCA9IGluc3RhbmNlXG4gICAgICAgID8gaW5zdGFuY2UoY29tcG9uZW50LCBwcm9wX3ZhbHVlcywgKGksIHJldCwgLi4ucmVzdCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgdmFsdWUgPSByZXN0Lmxlbmd0aCA/IHJlc3RbMF0gOiByZXQ7XG4gICAgICAgICAgICBpZiAoJCQuY3R4ICYmIG5vdF9lcXVhbCgkJC5jdHhbaV0sICQkLmN0eFtpXSA9IHZhbHVlKSkge1xuICAgICAgICAgICAgICAgIGlmICgkJC5ib3VuZFtpXSlcbiAgICAgICAgICAgICAgICAgICAgJCQuYm91bmRbaV0odmFsdWUpO1xuICAgICAgICAgICAgICAgIGlmIChyZWFkeSlcbiAgICAgICAgICAgICAgICAgICAgbWFrZV9kaXJ0eShjb21wb25lbnQsIGkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHJldDtcbiAgICAgICAgfSlcbiAgICAgICAgOiBbXTtcbiAgICAkJC51cGRhdGUoKTtcbiAgICByZWFkeSA9IHRydWU7XG4gICAgcnVuX2FsbCgkJC5iZWZvcmVfdXBkYXRlKTtcbiAgICAvLyBgZmFsc2VgIGFzIGEgc3BlY2lhbCBjYXNlIG9mIG5vIERPTSBjb21wb25lbnRcbiAgICAkJC5mcmFnbWVudCA9IGNyZWF0ZV9mcmFnbWVudCA/IGNyZWF0ZV9mcmFnbWVudCgkJC5jdHgpIDogZmFsc2U7XG4gICAgaWYgKG9wdGlvbnMudGFyZ2V0KSB7XG4gICAgICAgIGlmIChvcHRpb25zLmh5ZHJhdGUpIHtcbiAgICAgICAgICAgIGNvbnN0IG5vZGVzID0gY2hpbGRyZW4ob3B0aW9ucy50YXJnZXQpO1xuICAgICAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1ub24tbnVsbC1hc3NlcnRpb25cbiAgICAgICAgICAgICQkLmZyYWdtZW50ICYmICQkLmZyYWdtZW50Lmwobm9kZXMpO1xuICAgICAgICAgICAgbm9kZXMuZm9yRWFjaChkZXRhY2gpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1ub24tbnVsbC1hc3NlcnRpb25cbiAgICAgICAgICAgICQkLmZyYWdtZW50ICYmICQkLmZyYWdtZW50LmMoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAob3B0aW9ucy5pbnRybylcbiAgICAgICAgICAgIHRyYW5zaXRpb25faW4oY29tcG9uZW50LiQkLmZyYWdtZW50KTtcbiAgICAgICAgbW91bnRfY29tcG9uZW50KGNvbXBvbmVudCwgb3B0aW9ucy50YXJnZXQsIG9wdGlvbnMuYW5jaG9yKTtcbiAgICAgICAgZmx1c2goKTtcbiAgICB9XG4gICAgc2V0X2N1cnJlbnRfY29tcG9uZW50KHBhcmVudF9jb21wb25lbnQpO1xufVxubGV0IFN2ZWx0ZUVsZW1lbnQ7XG5pZiAodHlwZW9mIEhUTUxFbGVtZW50ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgU3ZlbHRlRWxlbWVudCA9IGNsYXNzIGV4dGVuZHMgSFRNTEVsZW1lbnQge1xuICAgICAgICBjb25zdHJ1Y3RvcigpIHtcbiAgICAgICAgICAgIHN1cGVyKCk7XG4gICAgICAgICAgICB0aGlzLmF0dGFjaFNoYWRvdyh7IG1vZGU6ICdvcGVuJyB9KTtcbiAgICAgICAgfVxuICAgICAgICBjb25uZWN0ZWRDYWxsYmFjaygpIHtcbiAgICAgICAgICAgIC8vIEB0cy1pZ25vcmUgdG9kbzogaW1wcm92ZSB0eXBpbmdzXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiB0aGlzLiQkLnNsb3R0ZWQpIHtcbiAgICAgICAgICAgICAgICAvLyBAdHMtaWdub3JlIHRvZG86IGltcHJvdmUgdHlwaW5nc1xuICAgICAgICAgICAgICAgIHRoaXMuYXBwZW5kQ2hpbGQodGhpcy4kJC5zbG90dGVkW2tleV0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGF0dHJpYnV0ZUNoYW5nZWRDYWxsYmFjayhhdHRyLCBfb2xkVmFsdWUsIG5ld1ZhbHVlKSB7XG4gICAgICAgICAgICB0aGlzW2F0dHJdID0gbmV3VmFsdWU7XG4gICAgICAgIH1cbiAgICAgICAgJGRlc3Ryb3koKSB7XG4gICAgICAgICAgICBkZXN0cm95X2NvbXBvbmVudCh0aGlzLCAxKTtcbiAgICAgICAgICAgIHRoaXMuJGRlc3Ryb3kgPSBub29wO1xuICAgICAgICB9XG4gICAgICAgICRvbih0eXBlLCBjYWxsYmFjaykge1xuICAgICAgICAgICAgLy8gVE9ETyBzaG91bGQgdGhpcyBkZWxlZ2F0ZSB0byBhZGRFdmVudExpc3RlbmVyP1xuICAgICAgICAgICAgY29uc3QgY2FsbGJhY2tzID0gKHRoaXMuJCQuY2FsbGJhY2tzW3R5cGVdIHx8ICh0aGlzLiQkLmNhbGxiYWNrc1t0eXBlXSA9IFtdKSk7XG4gICAgICAgICAgICBjYWxsYmFja3MucHVzaChjYWxsYmFjayk7XG4gICAgICAgICAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGluZGV4ID0gY2FsbGJhY2tzLmluZGV4T2YoY2FsbGJhY2spO1xuICAgICAgICAgICAgICAgIGlmIChpbmRleCAhPT0gLTEpXG4gICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrcy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICAkc2V0KCkge1xuICAgICAgICAgICAgLy8gb3ZlcnJpZGRlbiBieSBpbnN0YW5jZSwgaWYgaXQgaGFzIHByb3BzXG4gICAgICAgIH1cbiAgICB9O1xufVxuY2xhc3MgU3ZlbHRlQ29tcG9uZW50IHtcbiAgICAkZGVzdHJveSgpIHtcbiAgICAgICAgZGVzdHJveV9jb21wb25lbnQodGhpcywgMSk7XG4gICAgICAgIHRoaXMuJGRlc3Ryb3kgPSBub29wO1xuICAgIH1cbiAgICAkb24odHlwZSwgY2FsbGJhY2spIHtcbiAgICAgICAgY29uc3QgY2FsbGJhY2tzID0gKHRoaXMuJCQuY2FsbGJhY2tzW3R5cGVdIHx8ICh0aGlzLiQkLmNhbGxiYWNrc1t0eXBlXSA9IFtdKSk7XG4gICAgICAgIGNhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKTtcbiAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGluZGV4ID0gY2FsbGJhY2tzLmluZGV4T2YoY2FsbGJhY2spO1xuICAgICAgICAgICAgaWYgKGluZGV4ICE9PSAtMSlcbiAgICAgICAgICAgICAgICBjYWxsYmFja3Muc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgfTtcbiAgICB9XG4gICAgJHNldCgpIHtcbiAgICAgICAgLy8gb3ZlcnJpZGRlbiBieSBpbnN0YW5jZSwgaWYgaXQgaGFzIHByb3BzXG4gICAgfVxufVxuXG5mdW5jdGlvbiBkaXNwYXRjaF9kZXYodHlwZSwgZGV0YWlsKSB7XG4gICAgZG9jdW1lbnQuZGlzcGF0Y2hFdmVudChjdXN0b21fZXZlbnQodHlwZSwgT2JqZWN0LmFzc2lnbih7IHZlcnNpb246ICczLjIyLjMnIH0sIGRldGFpbCkpKTtcbn1cbmZ1bmN0aW9uIGFwcGVuZF9kZXYodGFyZ2V0LCBub2RlKSB7XG4gICAgZGlzcGF0Y2hfZGV2KFwiU3ZlbHRlRE9NSW5zZXJ0XCIsIHsgdGFyZ2V0LCBub2RlIH0pO1xuICAgIGFwcGVuZCh0YXJnZXQsIG5vZGUpO1xufVxuZnVuY3Rpb24gaW5zZXJ0X2Rldih0YXJnZXQsIG5vZGUsIGFuY2hvcikge1xuICAgIGRpc3BhdGNoX2RldihcIlN2ZWx0ZURPTUluc2VydFwiLCB7IHRhcmdldCwgbm9kZSwgYW5jaG9yIH0pO1xuICAgIGluc2VydCh0YXJnZXQsIG5vZGUsIGFuY2hvcik7XG59XG5mdW5jdGlvbiBkZXRhY2hfZGV2KG5vZGUpIHtcbiAgICBkaXNwYXRjaF9kZXYoXCJTdmVsdGVET01SZW1vdmVcIiwgeyBub2RlIH0pO1xuICAgIGRldGFjaChub2RlKTtcbn1cbmZ1bmN0aW9uIGRldGFjaF9iZXR3ZWVuX2RldihiZWZvcmUsIGFmdGVyKSB7XG4gICAgd2hpbGUgKGJlZm9yZS5uZXh0U2libGluZyAmJiBiZWZvcmUubmV4dFNpYmxpbmcgIT09IGFmdGVyKSB7XG4gICAgICAgIGRldGFjaF9kZXYoYmVmb3JlLm5leHRTaWJsaW5nKTtcbiAgICB9XG59XG5mdW5jdGlvbiBkZXRhY2hfYmVmb3JlX2RldihhZnRlcikge1xuICAgIHdoaWxlIChhZnRlci5wcmV2aW91c1NpYmxpbmcpIHtcbiAgICAgICAgZGV0YWNoX2RldihhZnRlci5wcmV2aW91c1NpYmxpbmcpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIGRldGFjaF9hZnRlcl9kZXYoYmVmb3JlKSB7XG4gICAgd2hpbGUgKGJlZm9yZS5uZXh0U2libGluZykge1xuICAgICAgICBkZXRhY2hfZGV2KGJlZm9yZS5uZXh0U2libGluZyk7XG4gICAgfVxufVxuZnVuY3Rpb24gbGlzdGVuX2Rldihub2RlLCBldmVudCwgaGFuZGxlciwgb3B0aW9ucywgaGFzX3ByZXZlbnRfZGVmYXVsdCwgaGFzX3N0b3BfcHJvcGFnYXRpb24pIHtcbiAgICBjb25zdCBtb2RpZmllcnMgPSBvcHRpb25zID09PSB0cnVlID8gW1wiY2FwdHVyZVwiXSA6IG9wdGlvbnMgPyBBcnJheS5mcm9tKE9iamVjdC5rZXlzKG9wdGlvbnMpKSA6IFtdO1xuICAgIGlmIChoYXNfcHJldmVudF9kZWZhdWx0KVxuICAgICAgICBtb2RpZmllcnMucHVzaCgncHJldmVudERlZmF1bHQnKTtcbiAgICBpZiAoaGFzX3N0b3BfcHJvcGFnYXRpb24pXG4gICAgICAgIG1vZGlmaWVycy5wdXNoKCdzdG9wUHJvcGFnYXRpb24nKTtcbiAgICBkaXNwYXRjaF9kZXYoXCJTdmVsdGVET01BZGRFdmVudExpc3RlbmVyXCIsIHsgbm9kZSwgZXZlbnQsIGhhbmRsZXIsIG1vZGlmaWVycyB9KTtcbiAgICBjb25zdCBkaXNwb3NlID0gbGlzdGVuKG5vZGUsIGV2ZW50LCBoYW5kbGVyLCBvcHRpb25zKTtcbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgICBkaXNwYXRjaF9kZXYoXCJTdmVsdGVET01SZW1vdmVFdmVudExpc3RlbmVyXCIsIHsgbm9kZSwgZXZlbnQsIGhhbmRsZXIsIG1vZGlmaWVycyB9KTtcbiAgICAgICAgZGlzcG9zZSgpO1xuICAgIH07XG59XG5mdW5jdGlvbiBhdHRyX2Rldihub2RlLCBhdHRyaWJ1dGUsIHZhbHVlKSB7XG4gICAgYXR0cihub2RlLCBhdHRyaWJ1dGUsIHZhbHVlKTtcbiAgICBpZiAodmFsdWUgPT0gbnVsbClcbiAgICAgICAgZGlzcGF0Y2hfZGV2KFwiU3ZlbHRlRE9NUmVtb3ZlQXR0cmlidXRlXCIsIHsgbm9kZSwgYXR0cmlidXRlIH0pO1xuICAgIGVsc2VcbiAgICAgICAgZGlzcGF0Y2hfZGV2KFwiU3ZlbHRlRE9NU2V0QXR0cmlidXRlXCIsIHsgbm9kZSwgYXR0cmlidXRlLCB2YWx1ZSB9KTtcbn1cbmZ1bmN0aW9uIHByb3BfZGV2KG5vZGUsIHByb3BlcnR5LCB2YWx1ZSkge1xuICAgIG5vZGVbcHJvcGVydHldID0gdmFsdWU7XG4gICAgZGlzcGF0Y2hfZGV2KFwiU3ZlbHRlRE9NU2V0UHJvcGVydHlcIiwgeyBub2RlLCBwcm9wZXJ0eSwgdmFsdWUgfSk7XG59XG5mdW5jdGlvbiBkYXRhc2V0X2Rldihub2RlLCBwcm9wZXJ0eSwgdmFsdWUpIHtcbiAgICBub2RlLmRhdGFzZXRbcHJvcGVydHldID0gdmFsdWU7XG4gICAgZGlzcGF0Y2hfZGV2KFwiU3ZlbHRlRE9NU2V0RGF0YXNldFwiLCB7IG5vZGUsIHByb3BlcnR5LCB2YWx1ZSB9KTtcbn1cbmZ1bmN0aW9uIHNldF9kYXRhX2Rldih0ZXh0LCBkYXRhKSB7XG4gICAgZGF0YSA9ICcnICsgZGF0YTtcbiAgICBpZiAodGV4dC5kYXRhID09PSBkYXRhKVxuICAgICAgICByZXR1cm47XG4gICAgZGlzcGF0Y2hfZGV2KFwiU3ZlbHRlRE9NU2V0RGF0YVwiLCB7IG5vZGU6IHRleHQsIGRhdGEgfSk7XG4gICAgdGV4dC5kYXRhID0gZGF0YTtcbn1cbmZ1bmN0aW9uIHZhbGlkYXRlX2VhY2hfYXJndW1lbnQoYXJnKSB7XG4gICAgaWYgKHR5cGVvZiBhcmcgIT09ICdzdHJpbmcnICYmICEoYXJnICYmIHR5cGVvZiBhcmcgPT09ICdvYmplY3QnICYmICdsZW5ndGgnIGluIGFyZykpIHtcbiAgICAgICAgbGV0IG1zZyA9ICd7I2VhY2h9IG9ubHkgaXRlcmF0ZXMgb3ZlciBhcnJheS1saWtlIG9iamVjdHMuJztcbiAgICAgICAgaWYgKHR5cGVvZiBTeW1ib2wgPT09ICdmdW5jdGlvbicgJiYgYXJnICYmIFN5bWJvbC5pdGVyYXRvciBpbiBhcmcpIHtcbiAgICAgICAgICAgIG1zZyArPSAnIFlvdSBjYW4gdXNlIGEgc3ByZWFkIHRvIGNvbnZlcnQgdGhpcyBpdGVyYWJsZSBpbnRvIGFuIGFycmF5Lic7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgfVxufVxuZnVuY3Rpb24gdmFsaWRhdGVfc2xvdHMobmFtZSwgc2xvdCwga2V5cykge1xuICAgIGZvciAoY29uc3Qgc2xvdF9rZXkgb2YgT2JqZWN0LmtleXMoc2xvdCkpIHtcbiAgICAgICAgaWYgKCF+a2V5cy5pbmRleE9mKHNsb3Rfa2V5KSkge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKGA8JHtuYW1lfT4gcmVjZWl2ZWQgYW4gdW5leHBlY3RlZCBzbG90IFwiJHtzbG90X2tleX1cIi5gKTtcbiAgICAgICAgfVxuICAgIH1cbn1cbmNsYXNzIFN2ZWx0ZUNvbXBvbmVudERldiBleHRlbmRzIFN2ZWx0ZUNvbXBvbmVudCB7XG4gICAgY29uc3RydWN0b3Iob3B0aW9ucykge1xuICAgICAgICBpZiAoIW9wdGlvbnMgfHwgKCFvcHRpb25zLnRhcmdldCAmJiAhb3B0aW9ucy4kJGlubGluZSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgJ3RhcmdldCcgaXMgYSByZXF1aXJlZCBvcHRpb25gKTtcbiAgICAgICAgfVxuICAgICAgICBzdXBlcigpO1xuICAgIH1cbiAgICAkZGVzdHJveSgpIHtcbiAgICAgICAgc3VwZXIuJGRlc3Ryb3koKTtcbiAgICAgICAgdGhpcy4kZGVzdHJveSA9ICgpID0+IHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgQ29tcG9uZW50IHdhcyBhbHJlYWR5IGRlc3Ryb3llZGApOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLWNvbnNvbGVcbiAgICAgICAgfTtcbiAgICB9XG4gICAgJGNhcHR1cmVfc3RhdGUoKSB7IH1cbiAgICAkaW5qZWN0X3N0YXRlKCkgeyB9XG59XG5mdW5jdGlvbiBsb29wX2d1YXJkKHRpbWVvdXQpIHtcbiAgICBjb25zdCBzdGFydCA9IERhdGUubm93KCk7XG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgaWYgKERhdGUubm93KCkgLSBzdGFydCA+IHRpbWVvdXQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW5maW5pdGUgbG9vcCBkZXRlY3RlZGApO1xuICAgICAgICB9XG4gICAgfTtcbn1cblxuZXhwb3J0IHsgSHRtbFRhZywgU3ZlbHRlQ29tcG9uZW50LCBTdmVsdGVDb21wb25lbnREZXYsIFN2ZWx0ZUVsZW1lbnQsIGFjdGlvbl9kZXN0cm95ZXIsIGFkZF9hdHRyaWJ1dGUsIGFkZF9jbGFzc2VzLCBhZGRfZmx1c2hfY2FsbGJhY2ssIGFkZF9sb2NhdGlvbiwgYWRkX3JlbmRlcl9jYWxsYmFjaywgYWRkX3Jlc2l6ZV9saXN0ZW5lciwgYWRkX3RyYW5zZm9ybSwgYWZ0ZXJVcGRhdGUsIGFwcGVuZCwgYXBwZW5kX2RldiwgYXNzaWduLCBhdHRyLCBhdHRyX2RldiwgYmVmb3JlVXBkYXRlLCBiaW5kLCBiaW5kaW5nX2NhbGxiYWNrcywgYmxhbmtfb2JqZWN0LCBidWJibGUsIGNoZWNrX291dHJvcywgY2hpbGRyZW4sIGNsYWltX2NvbXBvbmVudCwgY2xhaW1fZWxlbWVudCwgY2xhaW1fc3BhY2UsIGNsYWltX3RleHQsIGNsZWFyX2xvb3BzLCBjb21wb25lbnRfc3Vic2NyaWJlLCBjb21wdXRlX3Jlc3RfcHJvcHMsIGNyZWF0ZUV2ZW50RGlzcGF0Y2hlciwgY3JlYXRlX2FuaW1hdGlvbiwgY3JlYXRlX2JpZGlyZWN0aW9uYWxfdHJhbnNpdGlvbiwgY3JlYXRlX2NvbXBvbmVudCwgY3JlYXRlX2luX3RyYW5zaXRpb24sIGNyZWF0ZV9vdXRfdHJhbnNpdGlvbiwgY3JlYXRlX3Nsb3QsIGNyZWF0ZV9zc3JfY29tcG9uZW50LCBjdXJyZW50X2NvbXBvbmVudCwgY3VzdG9tX2V2ZW50LCBkYXRhc2V0X2RldiwgZGVidWcsIGRlc3Ryb3lfYmxvY2ssIGRlc3Ryb3lfY29tcG9uZW50LCBkZXN0cm95X2VhY2gsIGRldGFjaCwgZGV0YWNoX2FmdGVyX2RldiwgZGV0YWNoX2JlZm9yZV9kZXYsIGRldGFjaF9iZXR3ZWVuX2RldiwgZGV0YWNoX2RldiwgZGlydHlfY29tcG9uZW50cywgZGlzcGF0Y2hfZGV2LCBlYWNoLCBlbGVtZW50LCBlbGVtZW50X2lzLCBlbXB0eSwgZXNjYXBlLCBlc2NhcGVkLCBleGNsdWRlX2ludGVybmFsX3Byb3BzLCBmaXhfYW5kX2Rlc3Ryb3lfYmxvY2ssIGZpeF9hbmRfb3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2ssIGZpeF9wb3NpdGlvbiwgZmx1c2gsIGdldENvbnRleHQsIGdldF9iaW5kaW5nX2dyb3VwX3ZhbHVlLCBnZXRfY3VycmVudF9jb21wb25lbnQsIGdldF9zbG90X2NoYW5nZXMsIGdldF9zbG90X2NvbnRleHQsIGdldF9zcHJlYWRfb2JqZWN0LCBnZXRfc3ByZWFkX3VwZGF0ZSwgZ2V0X3N0b3JlX3ZhbHVlLCBnbG9iYWxzLCBncm91cF9vdXRyb3MsIGhhbmRsZV9wcm9taXNlLCBoYXNfcHJvcCwgaWRlbnRpdHksIGluaXQsIGluc2VydCwgaW5zZXJ0X2RldiwgaW50cm9zLCBpbnZhbGlkX2F0dHJpYnV0ZV9uYW1lX2NoYXJhY3RlciwgaXNfY2xpZW50LCBpc19jcm9zc29yaWdpbiwgaXNfZnVuY3Rpb24sIGlzX3Byb21pc2UsIGxpc3RlbiwgbGlzdGVuX2RldiwgbG9vcCwgbG9vcF9ndWFyZCwgbWlzc2luZ19jb21wb25lbnQsIG1vdW50X2NvbXBvbmVudCwgbm9vcCwgbm90X2VxdWFsLCBub3csIG51bGxfdG9fZW1wdHksIG9iamVjdF93aXRob3V0X3Byb3BlcnRpZXMsIG9uRGVzdHJveSwgb25Nb3VudCwgb25jZSwgb3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2ssIHByZXZlbnRfZGVmYXVsdCwgcHJvcF9kZXYsIHF1ZXJ5X3NlbGVjdG9yX2FsbCwgcmFmLCBydW4sIHJ1bl9hbGwsIHNhZmVfbm90X2VxdWFsLCBzY2hlZHVsZV91cGRhdGUsIHNlbGVjdF9tdWx0aXBsZV92YWx1ZSwgc2VsZWN0X29wdGlvbiwgc2VsZWN0X29wdGlvbnMsIHNlbGVjdF92YWx1ZSwgc2VsZiwgc2V0Q29udGV4dCwgc2V0X2F0dHJpYnV0ZXMsIHNldF9jdXJyZW50X2NvbXBvbmVudCwgc2V0X2N1c3RvbV9lbGVtZW50X2RhdGEsIHNldF9kYXRhLCBzZXRfZGF0YV9kZXYsIHNldF9pbnB1dF90eXBlLCBzZXRfaW5wdXRfdmFsdWUsIHNldF9ub3csIHNldF9yYWYsIHNldF9zdG9yZV92YWx1ZSwgc2V0X3N0eWxlLCBzZXRfc3ZnX2F0dHJpYnV0ZXMsIHNwYWNlLCBzcHJlYWQsIHN0b3BfcHJvcGFnYXRpb24sIHN1YnNjcmliZSwgc3ZnX2VsZW1lbnQsIHRleHQsIHRpY2ssIHRpbWVfcmFuZ2VzX3RvX2FycmF5LCB0b19udW1iZXIsIHRvZ2dsZV9jbGFzcywgdHJhbnNpdGlvbl9pbiwgdHJhbnNpdGlvbl9vdXQsIHVwZGF0ZV9rZXllZF9lYWNoLCB2YWxpZGF0ZV9jb21wb25lbnQsIHZhbGlkYXRlX2VhY2hfYXJndW1lbnQsIHZhbGlkYXRlX2VhY2hfa2V5cywgdmFsaWRhdGVfc2xvdHMsIHZhbGlkYXRlX3N0b3JlLCB4bGlua19hdHRyIH07XG4iLCJpbXBvcnQgeyBub29wLCBzYWZlX25vdF9lcXVhbCwgc3Vic2NyaWJlLCBydW5fYWxsLCBpc19mdW5jdGlvbiB9IGZyb20gJy4uL2ludGVybmFsJztcbmV4cG9ydCB7IGdldF9zdG9yZV92YWx1ZSBhcyBnZXQgfSBmcm9tICcuLi9pbnRlcm5hbCc7XG5cbmNvbnN0IHN1YnNjcmliZXJfcXVldWUgPSBbXTtcbi8qKlxuICogQ3JlYXRlcyBhIGBSZWFkYWJsZWAgc3RvcmUgdGhhdCBhbGxvd3MgcmVhZGluZyBieSBzdWJzY3JpcHRpb24uXG4gKiBAcGFyYW0gdmFsdWUgaW5pdGlhbCB2YWx1ZVxuICogQHBhcmFtIHtTdGFydFN0b3BOb3RpZmllcn1zdGFydCBzdGFydCBhbmQgc3RvcCBub3RpZmljYXRpb25zIGZvciBzdWJzY3JpcHRpb25zXG4gKi9cbmZ1bmN0aW9uIHJlYWRhYmxlKHZhbHVlLCBzdGFydCkge1xuICAgIHJldHVybiB7XG4gICAgICAgIHN1YnNjcmliZTogd3JpdGFibGUodmFsdWUsIHN0YXJ0KS5zdWJzY3JpYmUsXG4gICAgfTtcbn1cbi8qKlxuICogQ3JlYXRlIGEgYFdyaXRhYmxlYCBzdG9yZSB0aGF0IGFsbG93cyBib3RoIHVwZGF0aW5nIGFuZCByZWFkaW5nIGJ5IHN1YnNjcmlwdGlvbi5cbiAqIEBwYXJhbSB7Kj19dmFsdWUgaW5pdGlhbCB2YWx1ZVxuICogQHBhcmFtIHtTdGFydFN0b3BOb3RpZmllcj19c3RhcnQgc3RhcnQgYW5kIHN0b3Agbm90aWZpY2F0aW9ucyBmb3Igc3Vic2NyaXB0aW9uc1xuICovXG5mdW5jdGlvbiB3cml0YWJsZSh2YWx1ZSwgc3RhcnQgPSBub29wKSB7XG4gICAgbGV0IHN0b3A7XG4gICAgY29uc3Qgc3Vic2NyaWJlcnMgPSBbXTtcbiAgICBmdW5jdGlvbiBzZXQobmV3X3ZhbHVlKSB7XG4gICAgICAgIGlmIChzYWZlX25vdF9lcXVhbCh2YWx1ZSwgbmV3X3ZhbHVlKSkge1xuICAgICAgICAgICAgdmFsdWUgPSBuZXdfdmFsdWU7XG4gICAgICAgICAgICBpZiAoc3RvcCkgeyAvLyBzdG9yZSBpcyByZWFkeVxuICAgICAgICAgICAgICAgIGNvbnN0IHJ1bl9xdWV1ZSA9ICFzdWJzY3JpYmVyX3F1ZXVlLmxlbmd0aDtcbiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHN1YnNjcmliZXJzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHMgPSBzdWJzY3JpYmVyc1tpXTtcbiAgICAgICAgICAgICAgICAgICAgc1sxXSgpO1xuICAgICAgICAgICAgICAgICAgICBzdWJzY3JpYmVyX3F1ZXVlLnB1c2gocywgdmFsdWUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAocnVuX3F1ZXVlKSB7XG4gICAgICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgc3Vic2NyaWJlcl9xdWV1ZS5sZW5ndGg7IGkgKz0gMikge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3Vic2NyaWJlcl9xdWV1ZVtpXVswXShzdWJzY3JpYmVyX3F1ZXVlW2kgKyAxXSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgc3Vic2NyaWJlcl9xdWV1ZS5sZW5ndGggPSAwO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICBmdW5jdGlvbiB1cGRhdGUoZm4pIHtcbiAgICAgICAgc2V0KGZuKHZhbHVlKSk7XG4gICAgfVxuICAgIGZ1bmN0aW9uIHN1YnNjcmliZShydW4sIGludmFsaWRhdGUgPSBub29wKSB7XG4gICAgICAgIGNvbnN0IHN1YnNjcmliZXIgPSBbcnVuLCBpbnZhbGlkYXRlXTtcbiAgICAgICAgc3Vic2NyaWJlcnMucHVzaChzdWJzY3JpYmVyKTtcbiAgICAgICAgaWYgKHN1YnNjcmliZXJzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgICAgc3RvcCA9IHN0YXJ0KHNldCkgfHwgbm9vcDtcbiAgICAgICAgfVxuICAgICAgICBydW4odmFsdWUpO1xuICAgICAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgaW5kZXggPSBzdWJzY3JpYmVycy5pbmRleE9mKHN1YnNjcmliZXIpO1xuICAgICAgICAgICAgaWYgKGluZGV4ICE9PSAtMSkge1xuICAgICAgICAgICAgICAgIHN1YnNjcmliZXJzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoc3Vic2NyaWJlcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgc3RvcCgpO1xuICAgICAgICAgICAgICAgIHN0b3AgPSBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4geyBzZXQsIHVwZGF0ZSwgc3Vic2NyaWJlIH07XG59XG5mdW5jdGlvbiBkZXJpdmVkKHN0b3JlcywgZm4sIGluaXRpYWxfdmFsdWUpIHtcbiAgICBjb25zdCBzaW5nbGUgPSAhQXJyYXkuaXNBcnJheShzdG9yZXMpO1xuICAgIGNvbnN0IHN0b3Jlc19hcnJheSA9IHNpbmdsZVxuICAgICAgICA/IFtzdG9yZXNdXG4gICAgICAgIDogc3RvcmVzO1xuICAgIGNvbnN0IGF1dG8gPSBmbi5sZW5ndGggPCAyO1xuICAgIHJldHVybiByZWFkYWJsZShpbml0aWFsX3ZhbHVlLCAoc2V0KSA9PiB7XG4gICAgICAgIGxldCBpbml0ZWQgPSBmYWxzZTtcbiAgICAgICAgY29uc3QgdmFsdWVzID0gW107XG4gICAgICAgIGxldCBwZW5kaW5nID0gMDtcbiAgICAgICAgbGV0IGNsZWFudXAgPSBub29wO1xuICAgICAgICBjb25zdCBzeW5jID0gKCkgPT4ge1xuICAgICAgICAgICAgaWYgKHBlbmRpbmcpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjbGVhbnVwKCk7XG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBmbihzaW5nbGUgPyB2YWx1ZXNbMF0gOiB2YWx1ZXMsIHNldCk7XG4gICAgICAgICAgICBpZiAoYXV0bykge1xuICAgICAgICAgICAgICAgIHNldChyZXN1bHQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgY2xlYW51cCA9IGlzX2Z1bmN0aW9uKHJlc3VsdCkgPyByZXN1bHQgOiBub29wO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICBjb25zdCB1bnN1YnNjcmliZXJzID0gc3RvcmVzX2FycmF5Lm1hcCgoc3RvcmUsIGkpID0+IHN1YnNjcmliZShzdG9yZSwgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB2YWx1ZXNbaV0gPSB2YWx1ZTtcbiAgICAgICAgICAgIHBlbmRpbmcgJj0gfigxIDw8IGkpO1xuICAgICAgICAgICAgaWYgKGluaXRlZCkge1xuICAgICAgICAgICAgICAgIHN5bmMoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSwgKCkgPT4ge1xuICAgICAgICAgICAgcGVuZGluZyB8PSAoMSA8PCBpKTtcbiAgICAgICAgfSkpO1xuICAgICAgICBpbml0ZWQgPSB0cnVlO1xuICAgICAgICBzeW5jKCk7XG4gICAgICAgIHJldHVybiBmdW5jdGlvbiBzdG9wKCkge1xuICAgICAgICAgICAgcnVuX2FsbCh1bnN1YnNjcmliZXJzKTtcbiAgICAgICAgICAgIGNsZWFudXAoKTtcbiAgICAgICAgfTtcbiAgICB9KTtcbn1cblxuZXhwb3J0IHsgZGVyaXZlZCwgcmVhZGFibGUsIHdyaXRhYmxlIH07XG4iLCJpbXBvcnQgeyB3cml0YWJsZSB9IGZyb20gJ3N2ZWx0ZS9zdG9yZSc7XHJcblxyXG5leHBvcnQgY29uc3QgYWN0aXZlRWxlbWVudCA9IHdyaXRhYmxlKG51bGwpOyIsIjxzY3JpcHQ+XHJcbiAgaW1wb3J0IHsgYWN0aXZlRWxlbWVudCB9IGZyb20gXCIuL3N0b3JlLmpzXCI7XHJcbiAgZXhwb3J0IGxldCBjYW0gPSB7XHJcbiAgICB4OiAwLFxyXG4gICAgeTogMFxyXG4gIH07XHJcbiAgZXhwb3J0IGxldCBkYXRhID0ge1xyXG4gICAgeDogMCxcclxuICAgIHk6IDAsXHJcbiAgICBfaWQ6IFwiXCJcclxuICB9O1xyXG5cclxuICBjb25zdCBDQVJEX1JBVElPID0gMC43MTc2NDcwNTg4MjtcclxuXHJcbiAgZXhwb3J0IGxldCBoZWlnaHQgPSAzMDA7XHJcbiAgZXhwb3J0IGxldCB3aWR0aCA9IGhlaWdodCAqIENBUkRfUkFUSU87XHJcblxyXG4gIGZ1bmN0aW9uIHNldEFjdGl2ZShldnQpIHtcclxuICAgIGNvbnNvbGUubG9nKFwic2RzZGZkc2ZcIik7XHJcbiAgICBhY3RpdmVFbGVtZW50LnNldChkYXRhLl9pZCk7XHJcbiAgfVxyXG48L3NjcmlwdD5cclxuXHJcbjxzdHlsZT5cclxuICAuYWN0aXZlIHtcclxuICAgIGJvcmRlcjogMnB4IHNvbGlkIGJsdWU7XHJcbiAgfVxyXG5cclxuICByZWN0IHtcclxuICAgIGZpbGw6IGdyZWVuO1xyXG4gIH1cclxuPC9zdHlsZT5cclxuXHJcbjxzdmcgeD17ZGF0YS54fSB5PXtkYXRhLnl9PlxyXG4gIDxyZWN0XHJcbiAgICBvbjptb3VzZWRvd258c3RvcFByb3BhZ2F0aW9ufHByZXZlbnREZWZhdWx0PXtzZXRBY3RpdmV9XHJcbiAgICB7d2lkdGh9XHJcbiAgICB7aGVpZ2h0fSAvPlxyXG4gIDxmb3JlaWduT2JqZWN0IGNsYXNzPVwiaWdub3JlIG5vLXNlbGVjdFwiIHt3aWR0aH0ge2hlaWdodH0+XHJcbiAgICA8ZGl2IGNsYXNzOmFjdGl2ZT17JGFjdGl2ZUVsZW1lbnR9PlxyXG4gICAgICA8aW1nIHt3aWR0aH0ge2hlaWdodH0gc3JjPVwiaW1ncy9zd2FtcC5qcGdcIiBhbHQ9XCJzZnNkZlwiIC8+XHJcbiAgICA8L2Rpdj5cclxuICA8L2ZvcmVpZ25PYmplY3Q+XHJcbjwvc3ZnPlxyXG4iLCI8c2NyaXB0PlxyXG4gIGltcG9ydCBFbnRpdHkgZnJvbSBcIi4vZW50aXR5LnN2ZWx0ZVwiO1xyXG4gIGltcG9ydCB7IGFjdGl2ZUVsZW1lbnQgfSBmcm9tIFwiLi9zdG9yZS5qc1wiO1xyXG4gIGxldCBzdmc7XHJcblxyXG4gIGxldCBjYW0gPSB7XHJcbiAgICB4OiAwLFxyXG4gICAgeTogMFxyXG4gIH07XHJcblxyXG4gIGxldCBlbnRpdGllcyA9IHtcclxuICAgIGFiY2Q6IHtcclxuICAgICAgeDogMCxcclxuICAgICAgeTogMCxcclxuICAgICAgX2lkOiBcImFiY2RcIlxyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGZ1bmN0aW9uIG1vdXNlTW92ZShldnQpIHtcclxuICAgIGNhbS54ID0gZXZ0LmNsaWVudFg7XHJcbiAgICBjYW0ueSA9IGV2dC5jbGllbnRZO1xyXG4gICAgaWYgKCRhY3RpdmVFbGVtZW50KSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGNhbSk7XHJcbiAgICAgIGNvbnN0IGN1ciA9IGVudGl0aWVzWyRhY3RpdmVFbGVtZW50XTtcclxuICAgICAgY3VyLnggPSBjYW0ueDtcclxuICAgICAgY3VyLnkgPSBjYW0ueTtcclxuICAgICAgZW50aXRpZXNbJGFjdGl2ZUVsZW1lbnRdID0gY3VyO1xyXG4gICAgfVxyXG4gIH1cclxuPC9zY3JpcHQ+XHJcblxyXG48c3R5bGU+XHJcbiAgLm1haW4ge1xyXG4gICAgd2lkdGg6IDEwMCU7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgfVxyXG5cclxuICBzdmcge1xyXG4gICAgd2lkdGg6IDEwMCU7XHJcbiAgICBoZWlnaHQ6IDEwMCU7XHJcbiAgfVxyXG48L3N0eWxlPlxyXG5cclxuPGRpdiBjbGFzcz1cIm1haW5cIiBvbjptb3VzZW1vdmU9e21vdXNlTW92ZX0+XHJcbiAgPHN2ZyBiaW46dGhpcz17c3ZnfT5cclxuICAgIHsjZWFjaCBPYmplY3QudmFsdWVzKGVudGl0aWVzKSBhcyBlbnRpdHksIGluZGV4IChlbnRpdHkuX2lkKX1cclxuICAgICAgPEVudGl0eSB7Y2FtfSBkYXRhPXtlbnRpdHl9IC8+XHJcbiAgICB7L2VhY2h9XHJcbiAgPC9zdmc+XHJcbjwvZGl2PlxyXG4iLCI8c2NyaXB0PlxyXG4gIGltcG9ydCBUYWJsZSBmcm9tIFwiLi90YWJsZS5zdmVsdGVcIjtcclxuICBpbXBvcnQgeyBhY3RpdmVFbGVtZW50IH0gZnJvbSBcIi4vc3RvcmUuanNcIjtcclxuXHJcbiAgZnVuY3Rpb24gb25Nb3VzZVVwKCkge1xyXG4gICAgYWN0aXZlRWxlbWVudC5zZXQobnVsbCk7XHJcbiAgfVxyXG48L3NjcmlwdD5cclxuXHJcbjxzdHlsZT5cclxuICAucGFnZSB7XHJcbiAgICB3aWR0aDogMTAwJTtcclxuICAgIGhlaWdodDogMTAwJTtcclxuICB9XHJcbjwvc3R5bGU+XHJcblxyXG48ZGl2IGNsYXNzPVwicGFnZVwiIG9uOm1vdXNldXA9e29uTW91c2VVcH0+XHJcbiAgPFRhYmxlPnR0ZXRzZDwvVGFibGU+XHJcbjwvZGl2PlxyXG4iLCJcclxuY2xhc3MgQ29ubmVjdG9ye1xyXG4gICAgY29uc3RydWN0b3IoKXt9XHJcbiAgICBpbml0KCl7fVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IG5ldyBDb25uZWN0b3IoKTsiLCJpbXBvcnQgTWFpblZpZXcgZnJvbSBcIi4vdmlld3MvbWFpbi12aWV3LnN2ZWx0ZVwiO1xyXG5pbXBvcnQgQ29ubmVjdG9yIGZyb20gXCIuL2Nvbm5lY3RvclwiO1xyXG5cclxuQ29ubmVjdG9yLmluaXQoKTtcclxuXHJcblxyXG5jb25zdCByZW5kZXJUYXJnZXQgPSBuZXcgTWFpblZpZXcoe1xyXG4gIHRhcmdldDogZG9jdW1lbnQuYm9keSxcclxuICBwcm9wczoge1xyXG4gICAgY29ubmVjdG9yOiBDb25uZWN0b3IsXHJcbiAgICB0ZXN0OiBcInNkZmRzZlwiXHJcbiAgfVxyXG59KTsiXSwibmFtZXMiOlsibm9vcCIsInJ1biIsImZuIiwiYmxhbmtfb2JqZWN0IiwiT2JqZWN0IiwiY3JlYXRlIiwicnVuX2FsbCIsImZucyIsImZvckVhY2giLCJpc19mdW5jdGlvbiIsInRoaW5nIiwic2FmZV9ub3RfZXF1YWwiLCJhIiwiYiIsInN1YnNjcmliZSIsInN0b3JlIiwiY2FsbGJhY2tzIiwidW5zdWIiLCJ1bnN1YnNjcmliZSIsImNvbXBvbmVudF9zdWJzY3JpYmUiLCJjb21wb25lbnQiLCJjYWxsYmFjayIsIiQkIiwib25fZGVzdHJveSIsInB1c2giLCJhcHBlbmQiLCJ0YXJnZXQiLCJub2RlIiwiYXBwZW5kQ2hpbGQiLCJpbnNlcnQiLCJhbmNob3IiLCJpbnNlcnRCZWZvcmUiLCJkZXRhY2giLCJwYXJlbnROb2RlIiwicmVtb3ZlQ2hpbGQiLCJlbGVtZW50IiwibmFtZSIsImRvY3VtZW50IiwiY3JlYXRlRWxlbWVudCIsInN2Z19lbGVtZW50IiwiY3JlYXRlRWxlbWVudE5TIiwidGV4dCIsImRhdGEiLCJjcmVhdGVUZXh0Tm9kZSIsImVtcHR5IiwibGlzdGVuIiwiZXZlbnQiLCJoYW5kbGVyIiwib3B0aW9ucyIsImFkZEV2ZW50TGlzdGVuZXIiLCJyZW1vdmVFdmVudExpc3RlbmVyIiwicHJldmVudF9kZWZhdWx0IiwicHJldmVudERlZmF1bHQiLCJjYWxsIiwic3RvcF9wcm9wYWdhdGlvbiIsInN0b3BQcm9wYWdhdGlvbiIsImF0dHIiLCJhdHRyaWJ1dGUiLCJ2YWx1ZSIsInJlbW92ZUF0dHJpYnV0ZSIsImdldEF0dHJpYnV0ZSIsInNldEF0dHJpYnV0ZSIsImNoaWxkcmVuIiwiQXJyYXkiLCJmcm9tIiwiY2hpbGROb2RlcyIsInRvZ2dsZV9jbGFzcyIsInRvZ2dsZSIsImNsYXNzTGlzdCIsIkh0bWxUYWciLCJodG1sIiwiZSIsInUiLCJpIiwibiIsImxlbmd0aCIsInQiLCJpbm5lckhUTUwiLCJkIiwibSIsImN1cnJlbnRfY29tcG9uZW50Iiwic2V0X2N1cnJlbnRfY29tcG9uZW50IiwiZGlydHlfY29tcG9uZW50cyIsImJpbmRpbmdfY2FsbGJhY2tzIiwicmVuZGVyX2NhbGxiYWNrcyIsImZsdXNoX2NhbGxiYWNrcyIsInJlc29sdmVkX3Byb21pc2UiLCJQcm9taXNlIiwicmVzb2x2ZSIsInVwZGF0ZV9zY2hlZHVsZWQiLCJzY2hlZHVsZV91cGRhdGUiLCJ0aGVuIiwiZmx1c2giLCJhZGRfcmVuZGVyX2NhbGxiYWNrIiwiZmx1c2hpbmciLCJzZWVuX2NhbGxiYWNrcyIsIlNldCIsInVwZGF0ZSIsInBvcCIsImhhcyIsImFkZCIsImNsZWFyIiwiZnJhZ21lbnQiLCJiZWZvcmVfdXBkYXRlIiwiZGlydHkiLCJwIiwiY3R4IiwiYWZ0ZXJfdXBkYXRlIiwib3V0cm9pbmciLCJvdXRyb3MiLCJncm91cF9vdXRyb3MiLCJyIiwiYyIsImNoZWNrX291dHJvcyIsInRyYW5zaXRpb25faW4iLCJibG9jayIsImxvY2FsIiwiZGVsZXRlIiwidHJhbnNpdGlvbl9vdXQiLCJvIiwib3V0cm9fYW5kX2Rlc3Ryb3lfYmxvY2siLCJsb29rdXAiLCJrZXkiLCJ1cGRhdGVfa2V5ZWRfZWFjaCIsIm9sZF9ibG9ja3MiLCJnZXRfa2V5IiwiZHluYW1pYyIsImxpc3QiLCJkZXN0cm95IiwiY3JlYXRlX2VhY2hfYmxvY2siLCJuZXh0IiwiZ2V0X2NvbnRleHQiLCJvbGRfaW5kZXhlcyIsIm5ld19ibG9ja3MiLCJuZXdfbG9va3VwIiwiTWFwIiwiZGVsdGFzIiwiY2hpbGRfY3R4IiwiZ2V0Iiwic2V0IiwiTWF0aCIsImFicyIsIndpbGxfbW92ZSIsImRpZF9tb3ZlIiwiZmlyc3QiLCJuZXdfYmxvY2siLCJvbGRfYmxvY2siLCJuZXdfa2V5Iiwib2xkX2tleSIsImNyZWF0ZV9jb21wb25lbnQiLCJtb3VudF9jb21wb25lbnQiLCJvbl9tb3VudCIsIm5ld19vbl9kZXN0cm95IiwibWFwIiwiZmlsdGVyIiwiZGVzdHJveV9jb21wb25lbnQiLCJkZXRhY2hpbmciLCJtYWtlX2RpcnR5IiwiZmlsbCIsImluaXQiLCJpbnN0YW5jZSIsImNyZWF0ZV9mcmFnbWVudCIsIm5vdF9lcXVhbCIsInByb3BzIiwicGFyZW50X2NvbXBvbmVudCIsInByb3BfdmFsdWVzIiwiYm91bmQiLCJjb250ZXh0IiwicmVhZHkiLCJyZXQiLCJoeWRyYXRlIiwibm9kZXMiLCJsIiwiaW50cm8iLCJTdmVsdGVFbGVtZW50IiwiSFRNTEVsZW1lbnQiLCJhdHRhY2hTaGFkb3ciLCJtb2RlIiwic2xvdHRlZCIsIl9vbGRWYWx1ZSIsIm5ld1ZhbHVlIiwiJGRlc3Ryb3kiLCJ0eXBlIiwiaW5kZXgiLCJpbmRleE9mIiwic3BsaWNlIiwiU3ZlbHRlQ29tcG9uZW50IiwiU3ZlbHRlQ29tcG9uZW50RGV2IiwiJCRpbmxpbmUiLCJFcnJvciIsImNvbnNvbGUiLCJ3YXJuIiwic3Vic2NyaWJlcl9xdWV1ZSIsIndyaXRhYmxlIiwic3RhcnQiLCJzdG9wIiwic3Vic2NyaWJlcnMiLCJuZXdfdmFsdWUiLCJydW5fcXVldWUiLCJzIiwiaW52YWxpZGF0ZSIsInN1YnNjcmliZXIiLCJhY3RpdmVFbGVtZW50IiwieCIsInkiLCJDQVJEX1JBVElPIiwiY2FtIiwiX2lkIiwiaGVpZ2h0Iiwid2lkdGgiLCJzZXRBY3RpdmUiLCJldnQiLCJsb2ciLCJ2YWx1ZXMiLCJzdmciLCJlbnRpdGllcyIsImFiY2QiLCJtb3VzZU1vdmUiLCJjbGllbnRYIiwiY2xpZW50WSIsIiRhY3RpdmVFbGVtZW50IiwiY3VyIiwib25Nb3VzZVVwIiwiQ29ubmVjdG9yIiwicmVuZGVyVGFyZ2V0IiwiTWFpblZpZXciLCJib2R5IiwiY29ubmVjdG9yIiwidGVzdCJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7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
