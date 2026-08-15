import { nextId } from "./random.js";

/**
 * Something in the pasture that runs out.
 *
 * A resource is a place with a quantity: a pond an animal drinks from, a
 * patch of grass it eats. Drawing from one lowers its volume, and nothing
 * refills it on its own — the farmer has to put more down.
 */
export const RESOURCE_KINDS = {
  water: {
    kind: "water",
    label: "Water",
    names: ["Pond", "Lake", "Trough", "Stream"],
    capacity: 100,
    spread: 11,     // radius at full, in pasture units
    color: "#3E7CA6",
    unit: "L",
  },
  grass: {
    kind: "grass",
    label: "Grass",
    names: ["Meadow", "Pasture", "Clover patch", "Hay"],
    capacity: 60,
    spread: 9,
    color: "#5c8a3c",
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
    this.name = name ?? spec.names[0];
  }

  get spec() { return RESOURCE_KINDS[this.kind]; }
  get label() { return this.spec.label; }
  get unit() { return this.spec.unit; }
  get color() { return this.spec.color; }

  /** 0 when drained, 1 when brim-full. */
  get fullness() { return this.capacity === 0 ? 0 : this.volume / this.capacity; }

  get depleted() { return this.volume <= 0; }

  /**
   * How far it spreads. Area scales with what's left, so a drained pond is a
   * puddle — but never quite nothing, so the last drop is still reachable.
   */
  get radius() {
    return this.spec.spread * Math.max(0.35, Math.sqrt(this.fullness));
  }

  /**
   * Take up to `amount`. A resource can only give what it has.
   * @returns {number} how much was actually drawn — 0 when it's dry
   */
  draw(amount) {
    const taken = Math.min(amount, this.volume);
    this.volume -= taken;
    return taken;
  }

  /** Put more in, up to capacity. @returns {number} how much fit */
  refill(amount) {
    const added = Math.min(amount, this.capacity - this.volume);
    this.volume += added;
    return added;
  }

  describe() {
    return `${this.name} — ${Math.round(this.volume)} ${this.unit} of ${this.kind}`;
  }
}
