/** Small shared helpers for the farm model. */

// Ids are prefixed with a token minted when this module loads. A bare counter
// would restart at 1 whenever the module is re-evaluated — which a hot reload
// does while React still holds the animals created before it — handing two
// live animals the same id.
const RUN = Math.random().toString(36).slice(2, 8);
let idCounter = 0;

/** An id no other animal shares, even across a hot reload. */
export const nextId = () => `${RUN}-${++idCounter}`;

/** Inclusive on both ends. */
export const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** A direction in radians, uniformly random. */
export const randomAngle = () => Math.random() * Math.PI * 2;
