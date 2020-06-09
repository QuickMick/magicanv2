import svelte from 'rollup-plugin-svelte-hot';
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import json from 'rollup-plugin-json';
import builtins from 'rollup-plugin-node-builtins';
import globals from 'rollup-plugin-node-globals';
export default {
  input: './editor-main.js',
  output: {
    file: './editor-bundle.js',
    format: 'iife',
    sourcemap: "inline",
    name: "dadsdf"
  },
  plugins: [
    json(),
    resolve({
      browser: true, // Default: false
    }),
    commonjs(),
    globals(),
    builtins(),
    svelte({
      dev: true
    }),
  ],
  watch: {
    exclude: ['node_modules/**']
  }
}