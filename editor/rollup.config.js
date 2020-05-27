import svelte from 'rollup-plugin-svelte';
import babel from 'rollup-plugin-babel';
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import json from 'rollup-plugin-json';
import builtins from 'rollup-plugin-node-builtins';
import globals from 'rollup-plugin-node-globals';

console.log(resolve);
export default {
  input: './editor-main.js',
  output: {
    file: './editor-bundle.js',
    format: 'iife',
    sourcemap: "inline",
    name: "DeckBuilder"
  },
  globals: {
    DEBUG: true
  },
  "presets": [
    "@babel/preset-env",
    "@babel/preset-react",
    "@babel/preset-flow"
  ],
  plugins: [
    json(),
    resolve({
      browser: true, // Default: false
    }),
    commonjs(),
    globals(),
    builtins(),
    svelte() //,
    /* babel({
       babelrc: false,
       presets: [
         [
           '@babel/preset-env',
           {
             corejs: 3,
             modules: false,
             useBuiltIns: 'usage',
             forceAllTransforms: true,
             targets: {
               node: 'current',
               ie: '11',
             },
           },
         ],
       ],
     })*/
  ],
  watch: {
    // chokidar: {
    // if the chokidar option is given, rollup-watch will
    // use it instead of fs.watch. You will need to install
    // chokidar separately.
    //
    // this options object is passed to chokidar. if you
    // don't have any options, just pass `chokidar: true`
    //},

    // include and exclude govern which files to watch. by
    // default, all dependencies will be watched
    exclude: ['node_modules/**']
  }
}