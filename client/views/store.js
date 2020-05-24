import { writable } from 'svelte/store';

export const activeElement = writable(null);
export const connected = writable(false);
export const initialized = writable(false);