/** Small shared helpers for the farm model. */

// Ids are prefixed with a token minted when this module loads. A bare counter
// would restart at 1 whenever the module is re-evaluated — which a hot reload
// does while React still holds the animals created before it — handing two
// live animals the same id.
const RUN = Math.random().toString(36).slice(2, 8);
let idCounter = 0;

/** An id no other animal shares, even across a hot reload. */
export const nextId = () => `${RUN}-${++idCounter}`;

/**
 * Every unpredictable thing the farm does draws from here, so that a run can
 * be replayed exactly by seeding it. Unseeded it is Math.random and the farm
 * behaves as it always did; `seed(n)` swaps in a generator that starts from
 * the same place every time, which is what turns an intermittent failure in
 * scripts/check.js into one you can reproduce and fix.
 *
 * mulberry32: 32 bits of state, good enough for a pasture and short enough
 * that no dependency is worth adding for it.
 */
let draw = Math.random;

export const seed = (n) => {
  let state = n >>> 0;
  draw = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** A number in [0, 1). The farm's only source of chance. */
export const random = () => draw();

/** Inclusive on both ends. */
export const randomInt = (min, max) => Math.floor(random() * (max - min + 1)) + min;

export const pick = (arr) => arr[Math.floor(random() * arr.length)];

/** A direction in radians, uniformly random. */
export const randomAngle = () => random() * Math.PI * 2;
