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

/**
 * Which way the ground rises, and how steeply: the gradient of the relief,
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
  barn: { kind: "barn", label: "Barn", drag: 1, passable: false },
  tree: { kind: "tree", label: "Tree", drag: 1.6, passable: false },
};

/**
 * The trunks standing in the woods. Small circles, because a trunk is small —
 * but solid ones: woodland is ground you can cross, and a tree is a thing you
 * go round.
 *
 * They sit on the inland side of each wood rather than spread evenly through
 * it, and that is not an aesthetic choice. Every wood here runs up against a
 * fence, and a trunk in the strip between wood and rail would leave a pocket
 * of ground too narrow for an animal to stand in — the same fault the rocks
 * are placed to avoid. So the fence side of each wood is clear, the way the
 * edge of a real wood is the part that gets cleared.
 */
const TRUNK = 1.2;
const TRUNKS = [
  [14.5, 27.5],   // the big west wood
  [28, 23.5],     // the north-west copse
  [82.5, 68],     // the east wood
].map(([x, y]) => ({ ground: "tree", x, y, radius: TRUNK }));

/**
 * The patches of ground that are not meadow, as circles in pasture units.
 * Order matters only where two overlap: the first one wins.
 *
 * The solid ones carry a placement rule the soft patches do not: **the gap
 * between a solid patch and the fence must be either wide enough for the
 * biggest animal, or no gap at all**. A pocket narrower than an animal has no
 * legal ground in it, and a cow that wanders in gets shoved off the rail by one
 * rule and out of the stone by the other, for as many passes as the solver will
 * give it. A building standing *across* the rail is fine, because there is
 * nothing behind it to be trapped in — which is what lets the barn sit in the
 * corner of the field, where a barn belongs. `npm run check` asserts this; it
 * is invisible until a large animal walks into exactly that gap.
 */
export const PATCHES = [
  { ground: "mud", x: MUD.x, y: MUD.y, radius: 9 },
  { ground: "wood", x: 13, y: 32, radius: 8.5 },
  { ground: "wood", x: 28, y: 21, radius: 6 },
  { ground: "wood", x: 86, y: 70, radius: 7 },
  { ground: "rock", x: 55, y: 29, radius: 4 },
  { ground: "rock", x: 40, y: 62, radius: 3.5 },
  // Across the north-east corner, so its walls cross both rails and no animal
  // can end up behind it. The UI draws the building on this very spot.
  { ground: "barn", x: 88, y: 18, radius: 5.5 },
  // Last, so the woodland underneath still answers for the going: a tree is
  // something in the way, not a different kind of ground.
  ...TRUNKS,
];

/** The patches nothing can walk through — static bodies, for the physics. */
export const OBSTACLES = PATCHES.filter((patch) => !GROUND[patch.ground].passable);

const covers = (patch, { x, y }) =>
  Math.hypot(x - patch.x, y - patch.y) < patch.radius;

/** What an animal standing here is standing on. Meadow unless told otherwise. */
export function groundAt(point) {
  const patch = PATCHES.find((p) => covers(p, point));
  return patch ? GROUND[patch.ground] : GROUND.meadow;
}

/**
 * How far a body of `radius` standing at `point` reaches inside a rock or a
 * wall, in pasture units. 0 when it is clear of them all, which is what a body
 * leaning on one reads as give or take a rounding error.
 */
export function obstaclePenetration(point, radius = 0) {
  let deepest = 0;
  for (const solid of OBSTACLES) {
    deepest = Math.max(deepest, solid.radius + radius - Math.hypot(point.x - solid.x, point.y - solid.y));
  }
  return deepest;
}

/**
 * Is there room here for a body of `radius` — that is, does it clear the rocks
 * and the barn? Says nothing about the fence or about other animals; the Farm
 * asks about those separately. Strict, because it is asked when *placing* an
 * animal, and there is no reason to set one down touching a wall.
 */
export function standable(point, radius = 0) {
  return obstaclePenetration(point, radius) <= 0;
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
