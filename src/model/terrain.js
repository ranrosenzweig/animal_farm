import { PASTURE, MUD } from "./pasture.js";

/**
 * The lie of the land.
 *
 * The pasture is no longer a flat tray. It has relief — rises, a swell
 * through the middle, and two hollows — and it has ground that is not all the
 * same to walk on: meadow, mud, woodland, and rock you cannot walk on at all.
 *
 * Height is a sum of smooth bumps rather than a stored grid, for one reason
 * that matters: a sum of Gaussians can be differentiated on paper, so the
 * slope an animal feels underfoot is *exact*, not a difference between two
 * samples. Gravity gets an honest direction to pull in, and the UI can paint
 * the same bumps and be showing the very thing the animals are walking on.
 */

/**
 * The bumps that make the ground. `height` is signed — positive is a rise,
 * negative a hollow — and `spread` is how far it reaches, in pasture units.
 *
 * The two hollows are not decoration: water and mud collect in low ground, so
 * the pond and the mud patch sit in them.
 */
export const RELIEF = [
  { x: 22, y: 30, height: 0.50, spread: 26 },         // the long rise behind the meadow
  { x: 76, y: 30, height: 0.34, spread: 20 },         // the east knoll
  { x: 48, y: 54, height: 0.16, spread: 30 },         // a gentle swell through the middle
  { x: MUD.x, y: MUD.y, height: -0.30, spread: 16 },  // the hollow the mud sits in
  { x: 18, y: 70, height: -0.24, spread: 22 },        // low ground, where the pond lies
];

/** Height of the ground with no bump under it. Puts the field mid-range. */
const SEA_LEVEL = 0.36;

/**
 * How high the ground stands, roughly 0 (lowest hollow) to 1 (highest rise).
 * The scale is arbitrary; only differences matter, because only the slope is
 * ever used for anything.
 */
export function elevationAt({ x, y }) {
  let height = SEA_LEVEL;
  for (const bump of RELIEF) {
    const dx = x - bump.x;
    const dy = y - bump.y;
    height += bump.height * Math.exp(-(dx * dx + dy * dy) / (bump.spread * bump.spread));
  }
  return height;
}

/**
 * Which way the ground rises, and how steeply: the gradient of `elevationAt`,
 * worked out exactly rather than sampled. Gravity pulls the other way.
 *
 * @returns {{x: number, y: number}} rise per pasture unit, along each axis
 */
export function slopeAt({ x, y }) {
  let gx = 0;
  let gy = 0;
  for (const bump of RELIEF) {
    const dx = x - bump.x;
    const dy = y - bump.y;
    const spread2 = bump.spread * bump.spread;
    // d/dx of h·exp(-(dx²+dy²)/s²) is that same term times -2·dx/s².
    const falloff = bump.height * Math.exp(-(dx * dx + dy * dy) / spread2);
    gx += falloff * (-2 * dx / spread2);
    gy += falloff * (-2 * dy / spread2);
  }
  return { x: gx, y: gy };
}

/**
 * What the ground is made of, where it differs from open meadow.
 *
 *   drag      how much harder it is to move through than meadow. An animal's
 *             cruising speed is divided by this, because drag is what its
 *             thrust settles against.
 *   passable  false for ground no animal can stand on. Rock is a body, not a
 *             preference — the physics bounces animals off it.
 */
export const GROUND = {
  meadow: { kind: "meadow", label: "Meadow", drag: 1, passable: true },
  mud: { kind: "mud", label: "Mud", drag: 2.2, passable: true },
  wood: { kind: "wood", label: "Woodland", drag: 1.6, passable: true },
  rock: { kind: "rock", label: "Rock", drag: 1, passable: false },
};

/**
 * The patches of ground that are not meadow, as circles in pasture units.
 * Order matters only where two overlap: the first one wins.
 */
export const PATCHES = [
  { ground: "mud", x: MUD.x, y: MUD.y, radius: 9 },
  { ground: "wood", x: 13, y: 32, radius: 8.5 },
  { ground: "wood", x: 28, y: 21, radius: 6 },
  { ground: "wood", x: 86, y: 70, radius: 7 },
  { ground: "rock", x: 55, y: 25, radius: 4 },
  { ground: "rock", x: 40, y: 66, radius: 3.5 },
];

/** The patches nothing can walk through — static bodies, for the physics. */
export const ROCKS = PATCHES.filter((patch) => !GROUND[patch.ground].passable);

const covers = (patch, { x, y }) =>
  Math.hypot(x - patch.x, y - patch.y) < patch.radius;

/** What an animal standing here is standing on. Meadow unless told otherwise. */
export function groundAt(point) {
  const patch = PATCHES.find((p) => covers(p, point));
  return patch ? GROUND[patch.ground] : GROUND.meadow;
}

/**
 * How far a body of `radius` standing at `point` reaches inside a rock, in
 * pasture units. 0 when it is clear of them, which is what a body leaning on
 * one reads as give or take a rounding error.
 */
export function rockPenetration(point, radius = 0) {
  let deepest = 0;
  for (const rock of ROCKS) {
    deepest = Math.max(deepest, rock.radius + radius - Math.hypot(point.x - rock.x, point.y - rock.y));
  }
  return deepest;
}

/**
 * Is there room here for a body of `radius` — that is, does it clear the
 * rocks? Says nothing about the fence or about other animals; the Farm asks
 * about those separately. Strict, because it is asked when *placing* an
 * animal, and there is no reason to set one down touching a rock.
 */
export function standable(point, radius = 0) {
  return rockPenetration(point, radius) <= 0;
}

/**
 * The steepest ground anywhere in the pasture, found once by sampling. It is
 * what bounds how fast gravity can drag a body, so the physics and the checks
 * both have a real number to reason with instead of a guess.
 */
export const STEEPEST = (() => {
  let worst = 0;
  for (let x = PASTURE.minX; x <= PASTURE.maxX; x += 1) {
    for (let y = PASTURE.minY; y <= PASTURE.maxY; y += 1) {
      const slope = slopeAt({ x, y });
      worst = Math.max(worst, Math.hypot(slope.x, slope.y));
    }
  }
  return worst;
})();
