import { nextId } from "./random.js";

/**
 * Something in the pasture that runs out.
 *
 * A resource is a place with a quantity: a pond an animal drinks from, a
 * patch of grass it eats. Drawing from one lowers its volume, and nothing
 * refills it on its own — the farmer has to put more down.
 */

/**
 * The farmer's standing order: never let a source fall below this share of
 * its capacity, whatever the animals take out of it. Zero is off, and off is
 * how the farm has always run — sources drain, and refilling them is a chore.
 */
let floor = 0;

export const stockFloor = () => floor;

export const setStockFloor = (share) => { floor = Math.min(1, Math.max(0, share)); };

/**
 * Whether the levels are held exactly where they stand. Animals still drink
 * and still graze — a held pond gives a full mouthful — and nothing raises a
 * held source either: rain runs off it and topping it up does nothing. The
 * reading simply stops moving in both directions, because a level that creeps
 * up while it is meant to be frozen is no more frozen than one that drains.
 *
 * Not the same as a floor of 100%, which lets a source drain through the round
 * and tops it back up at the end: this holds a half-empty pond half-empty.
 */
let held = false;

export const heldLevels = () => held;

export const setHeldLevels = (on) => { held = Boolean(on); };
/**
 * The level below which a source counts as needing the farmer. A trough two
 * fifths gone is a chore; one barely touched is not.
 *
 * One number rather than two, because the errand and the line in the log that
 * says he finished it have to agree about what finished means — otherwise he
 * walks away from a source the log still thinks he is filling.
 */
export const ENOUGH = 0.6;

export const RESOURCE_KINDS = {
  water: {
    kind: "water",
    label: "Water",
    name: "Pond",
    capacity: 100,
    spread: 11,     // radius at full, in pasture units
    unit: "L",
  },
  grass: {
    kind: "grass",
    label: "Grass",
    name: "Meadow",
    capacity: 60,
    spread: 9,
    unit: "kg",
  },
};

export const RESOURCE_NAMES = Object.keys(RESOURCE_KINDS);

/**
 * How much of a pool is over an animal's head, as a fraction of its radius.
 * The rim is shallow — anything can wade in that far to drink — and the middle
 * is water it would have to swim. Under 1 for a reason: a body held off at the
 * deep edge is still well inside the reach the `drink` goal measures, so
 * making water solid did not put drinking out of anyone's range.
 */
export const DEEP = 0.7;

/**
 * How much harder water is to move through than meadow, for anything with any
 * part of itself in it. On the same scale as the ground in `terrain.js`, and
 * heavier than mud — a duck paddles slower than it waddles, and a cow at the
 * rim is wading, not walking.
 */
export const WATER_DRAG = 2.6;

export default class Resource {
  /**
   * @param {"water"|"grass"} kind
   * @param {{x: number, y: number}} at
   * @param {{ volume?: number, name?: string }} [options]
   */
  constructor(kind, at, { volume, name } = {}) {
    const spec = RESOURCE_KINDS[kind];
    if (!spec) throw new TypeError(`No such resource kind: ${kind}`);
    this.id = nextId();
    this.kind = kind;
    this.x = at.x;
    this.y = at.y;
    this.capacity = spec.capacity;
    this.volume = volume ?? spec.capacity;
    this.name = name ?? spec.name;
  }

  get spec() { return RESOURCE_KINDS[this.kind]; }
  get unit() { return this.spec.unit; }

  /** 0 when drained, 1 when brim-full. */
  get fullness() { return this.capacity === 0 ? 0 : this.volume / this.capacity; }

  // Never while held: `Farm.nearestResource` skips a depleted source, so a
  // held-at-empty pond would be invisible to the drink goal for good — the
  // animals would have nowhere to go and would die of thirst beside it.
  get depleted() { return !held && this.volume <= 0; }

  /**
   * How far it spreads. Area scales with what's left, so a drained pond is a
   * puddle — but never quite nothing, so the last drop is still reachable.
   *
   * A held source spreads as a full one, for the same reason it serves a full
   * mouthful: what is held is the reading, not the supply. This is not
   * decoration. Standing in it is how an animal drinks, so the width of a
   * source is the width of the queue at it — and a puddle with a duck and a
   * chicken in it has no room left for a cow's body. Held low without this,
   * the big animals never get a drink again as long as the farm stands.
   */
  get radius() {
    return this.spec.spread * Math.max(0.35, Math.sqrt(held ? 1 : this.fullness));
  }

  /**
   * Take up to `amount`. A resource can only give what it has.
   *
   * Held sources are the exception: the animal gets its whole mouthful and the
   * level does not move — whatever the level happens to say, including empty.
   * What is held is the reading, not the supply, so a pond held low waters the
   * herd exactly as well as a full one. Every drink and every mouthful in the
   * model comes through here, so this one line is the whole of it.
   * @returns {number} how much was actually drawn — 0 when it's dry
   */
  draw(amount) {
    if (held) return amount;
    const taken = Math.min(amount, this.volume);
    this.volume -= taken;
    return taken;
  }

  /** Put more in, up to capacity — nothing at all while held. @returns {number} how much fit */
  refill(amount) {
    if (held) return 0;
    const added = Math.min(amount, this.capacity - this.volume);
    this.volume += added;
    return added;
  }

  describe() {
    return `${this.name} — ${Math.round(this.volume)} ${this.unit} of ${this.kind}`;
  }
}
