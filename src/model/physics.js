import { PASTURE } from "./pasture.js";

/**
 * The laws the pasture obeys.
 *
 * Animals are rigid circular bodies with mass and velocity. Nothing moves by
 * being placed somewhere; it moves because something pushed it — its own legs,
 * gravity down a slope, drag from the ground, or another body hitting it. A
 * step is one unit of time, so a velocity in pasture units per step is also
 * the distance that step carries the body.
 *
 * A body, as far as anything here is concerned, is `{ x, y, mass, radius,
 * velocity }`. Animal satisfies that; so does anything else that wants to.
 */

/**
 * Pull down a slope, in pasture units per step squared, per unit of rise.
 *
 * Sized against the steepest ground the field actually has (`STEEPEST`), so
 * that the animal with the least to spare — the cow, heaviest and slowest off
 * the mark — still climbs the worst hill at about half its usual pace instead
 * of being stranded on the side of it. Everything lighter barely notices,
 * which is the whole point: a horse takes a hill in its stride and a cow
 * labours up it, and nothing had to be said about hills to make that happen.
 */
export const GRAVITY = 5;

/**
 * How much of a collision comes back as bounce rather than being lost to the
 * thud. 0 would be two sacks of grain meeting; 1 would be billiard balls.
 */
export const RESTITUTION = 0.35;

/**
 * How deep two bodies may be inside one another and still count as merely
 * touching, in pasture units — around half a percent of an animal's radius,
 * which on a rendered field is a fifth of a pixel.
 *
 * Every solver of this kind needs one. Prising a jammed crowd apart is an
 * iterative business that approaches contact without ever landing exactly on
 * it, so demanding zero penetration would mean iterating forever. This is the
 * line between "settled" and "still overlapping", and `Farm.overlaps` reads
 * the same number, so the model and its checks agree on what an overlap is.
 *
 * It is not a free dial. Tightening it towards zero does not make the field
 * tidier, it makes a packed one fail to settle at all — the passes run out
 * mid-crowd and leave a *visible* overlap instead of an invisible one.
 */
export const CONTACT_SLOP = 0.03;

/**
 * The most passes to spend prising bodies apart in one step.
 *
 * Separating one pair can drive one of them into a third — exactly what a
 * horse coming through a knot of sheep does — so it takes repeated passes, and
 * a packed field takes a great many. The passes stop as soon as everything is
 * settled to within `CONTACT_SLOP`, which on an ordinary field is after about
 * a dozen; this is only the ceiling for the worst jams, where a field stocked
 * far past comfort has to shuffle a whole crowd to make room. It is worth
 * being generous with, because the alternative to spending the passes is
 * leaving animals standing in one another.
 */
export const RELAXATIONS = 2000;

/**
 * Below this speed a body is standing still. Real ground grips: without a
 * floor like this, drag only ever halves a velocity and an animal that has
 * stopped keeps creeping forever.
 */
export const STOPPED = 0.02;

/**
 * How long a body takes to work up to speed, or to shed it, in steps. Heavier
 * is slower on both counts — a cow leans into a walk and a chicken is simply
 * off. This is the one place mass decides how something moves, because in the
 * drag balance below mass otherwise cancels out.
 */
export const responseTime = (mass) => 2.5 + mass / 160;

/** Length of a vector, for bodies and forces alike. */
const magnitude = ({ x, y }) => Math.hypot(x, y);

/**
 * Carry a body forward one step under a steady applied force.
 *
 * Drag is not integrated a slice at a time — it is solved. A body under a
 * constant force against drag proportional to speed has a known velocity at
 * every moment, `terminal + (v - terminal)·e^(-k/m·t)`, so that is what gets
 * used. It is both the exact answer and unconditionally stable, which matters
 * here because thick mud makes the drag strong enough that stepping through it
 * naively would oscillate instead of settling.
 *
 * @param {{velocity: {x: number, y: number}, mass: number}} body
 * @param {{x: number, y: number}} force  thrust and gravity; not drag
 * @param {number} drag  force resisting motion, per unit of speed
 * @param {number} topSpeed  the fastest this body may ever travel
 */
export function integrate(body, force, drag, topSpeed) {
  // Where this force would eventually settle: the speed at which drag matches it.
  const terminal = { x: force.x / drag, y: force.y / drag };
  const decay = Math.exp(-drag / body.mass);

  body.velocity.x = terminal.x + (body.velocity.x - terminal.x) * decay;
  body.velocity.y = terminal.y + (body.velocity.y - terminal.y) * decay;
  capSpeed(body, topSpeed);

  if (magnitude(body.velocity) < STOPPED) {
    body.velocity.x = 0;
    body.velocity.y = 0;
  }
}

/**
 * Hold a body to its top speed, whatever just happened to it.
 *
 * A body shoved by something far heavier than itself would otherwise be sent
 * off faster than anything on this farm has any business travelling — a
 * chicken caught by a galloping horse takes an enormous impulse for its size.
 * So the limit is applied wherever velocity changes, not only where thrust
 * and drag settle, and "nothing outruns its top speed" holds as a flat law of
 * the field rather than a tendency.
 */
export function capSpeed(body, topSpeed) {
  const speed = magnitude(body.velocity);
  if (speed <= topSpeed) return false;
  body.velocity.x *= topSpeed / speed;
  body.velocity.y *= topSpeed / speed;
  return true;
}

/**
 * Two bodies that have ended the step inside one another: trade momentum
 * along the line between their centres.
 *
 * The heavier one barely notices. That is the whole point of giving them mass
 * — a horse walking through a chicken sends the chicken skidding, and a
 * chicken walking into a horse does not move the horse. Momentum is traded
 * once per collision; prising them apart is `separate`'s job, and happens as
 * many times as it takes.
 *
 * @returns {boolean} whether they were touching at all
 */
export function collide(a, b) {
  const { x: nx, y: ny, distance } = separation(a, b);
  if (a.radius + b.radius - distance <= 0) return false;

  // Closing speed along that line. Already parting? Then there is nothing to
  // resolve — bouncing them again would pump energy into the field.
  const closing = (b.velocity.x - a.velocity.x) * nx + (b.velocity.y - a.velocity.y) * ny;
  if (closing >= 0) return true;

  const total = 1 / a.mass + 1 / b.mass;
  const impulse = (-(1 + RESTITUTION) * closing) / total;
  a.velocity.x -= (impulse * nx) / a.mass;
  a.velocity.y -= (impulse * ny) / a.mass;
  b.velocity.x += (impulse * nx) / b.mass;
  b.velocity.y += (impulse * ny) / b.mass;
  return true;
}

/**
 * A body against something immovable — a rock. The same impulse worked out in
 * the limit where the other mass is infinite, so all of it lands on the body.
 *
 * @param {{x: number, y: number, radius: number}} obstacle
 * @returns {boolean} whether it was touching
 */
export function collideStatic(body, obstacle) {
  const { x: nx, y: ny, distance } = separation(obstacle, body);
  if (obstacle.radius + body.radius - distance <= 0) return false;

  const closing = -(body.velocity.x * nx + body.velocity.y * ny);
  if (closing <= 0) return true;

  const impulse = (1 + RESTITUTION) * closing;
  body.velocity.x += impulse * nx;
  body.velocity.y += impulse * ny;
  return true;
}

/**
 * Prise two overlapping bodies apart, moving position and nothing else.
 *
 * The split is even, not by mass — deliberately. Which body gives way when
 * two meet is a question about momentum, and `collide` has already answered
 * it. This is only the numerical repair afterwards, and weighting *it* by
 * mass is what jams a light animal against a heavy one with nowhere to go:
 * a chicken between two cows gets thrown the full overlap by each in turn
 * and never settles.
 *
 * @returns {number} how deep they were inside one another, 0 if clear
 */
export function separate(a, b) {
  const { x: nx, y: ny, distance } = separation(a, b);
  const overlap = a.radius + b.radius - distance;
  if (overlap <= 0) return 0;

  const give = overlap / 2;
  a.x -= nx * give;
  a.y -= ny * give;
  b.x += nx * give;
  b.y += ny * give;
  return overlap;
}

/**
 * Push a body off an obstacle it has ended up inside. Position only; the
 * obstacle does not move, because it is a rock.
 * @returns {number} how deep it was, 0 if clear
 */
export function separateStatic(body, obstacle) {
  const { x: nx, y: ny, distance } = separation(obstacle, body);
  const overlap = obstacle.radius + body.radius - distance;
  if (overlap <= 0) return 0;

  body.x += nx * overlap;
  body.y += ny * overlap;
  return overlap;
}

/**
 * Put a body back inside the fence, position only. Used on every separating
 * pass, so what it reports is *how far* it had to move the body and not merely
 * whether it did: a body dozing against a rail gets clamped by a rounding
 * error every pass, and treating that as unfinished work would keep the passes
 * running to the cap for the whole life of the farm.
 * @returns {number} how far it had to be moved, 0 if it was already inside
 */
export function confine(body) {
  const x = Math.min(PASTURE.maxX, Math.max(PASTURE.minX, body.x));
  const y = Math.min(PASTURE.maxY, Math.max(PASTURE.minY, body.y));
  const moved = Math.hypot(x - body.x, y - body.y);
  body.x = x;
  body.y = y;
  return moved;
}

/**
 * Keep a body inside the fence. The fence is solid, so a body meeting it
 * stops going that way and keeps whatever bounce it has left.
 * @returns {boolean} whether it hit anything
 */
export function containWithin(body) {
  let hit = false;
  if (body.x < PASTURE.minX) { body.x = PASTURE.minX; body.velocity.x = Math.abs(body.velocity.x) * RESTITUTION; hit = true; }
  if (body.x > PASTURE.maxX) { body.x = PASTURE.maxX; body.velocity.x = -Math.abs(body.velocity.x) * RESTITUTION; hit = true; }
  if (body.y < PASTURE.minY) { body.y = PASTURE.minY; body.velocity.y = Math.abs(body.velocity.y) * RESTITUTION; hit = true; }
  if (body.y > PASTURE.maxY) { body.y = PASTURE.maxY; body.velocity.y = -Math.abs(body.velocity.y) * RESTITUTION; hit = true; }
  return hit;
}

/**
 * The unit vector from `a` to `b`, and how far apart they are. Two bodies
 * exactly on top of each other have no line between them, so one is invented
 * — any direction will do, so long as they end up apart.
 * @private
 */
function separation(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-9) return { x: 1, y: 0, distance: 0 };
  return { x: dx / distance, y: dy / distance, distance };
}
