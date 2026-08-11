/** Small shared helpers for the farm model. */

let idCounter = 0;

/** Monotonic id, unique for the lifetime of the page. */
export const nextId = () => ++idCounter;

/** Inclusive on both ends. */
export const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
