import { nextId, pick, randomAngle, randomInt } from "./random.js";
import { PASTURE, distance } from "./pasture.js";

/**
 * Abstract base for every animal on the farm.
 *
 * A species is defined by three things:
 *   1. Static metadata — `species`, `emoji`, `color`, `diet`, `breeds`,
 *      `names`, plus its `stepSize` and `radius` in the pasture. This is
 *      what the *kind* is.
 *   2. Overridden behavior — `makeSound()`, `move()`, `dailyProduce()`.
 *      This is what an individual *does*.
 *   3. A `heading()` — the direction it wants to walk next, which is where
 *      "the pig makes for the mud, the sheep for the flock" actually lives.
 *
 * An animal chooses a direction but never places itself: only the Farm can
 * see the other animals, so the Farm decides whether a step is allowed.
 */
export default class Animal {
  /** @type {string} Display name of the kind. Subclasses must override. */
  static species = "Animal";
  /** @type {string} */
  static emoji = "🐾";
  /** @type {string} Accent color used by the UI. */
  static color = "#6b5f42";
  /** @type {string[]} Foods this kind will accept; one is picked per animal. */
  static diet = ["grass"];
  /** @type {string[]} */
  static breeds = ["Mixed"];
  /** @type {string[]} Candidate names for randomly generated members. */
  static names = ["Nameless"];
  /** @type {number} How far one step carries it, in pasture units. */
  static stepSize = 8;
  /** @type {number} Personal space; two animals may not come closer than the sum of their radii. */
  static radius = 5;

  /**
   * @param {string} name
   * @param {string} breed
   * @param {number} age  in years
   * @param {string} [favoriteFood]  defaults to a random pick from the kind's diet
   */
  constructor(name, breed, age, favoriteFood) {
    if (new.target === Animal) {
      throw new TypeError("Animal is abstract — instantiate a species subclass instead.");
    }
    this.id = nextId();
    this.name = name;
    this.breed = breed;
    this.age = age;
    this.favoriteFood = favoriteFood ?? pick(new.target.diet);
    // A provisional spot; Farm.add() relocates it if something is already there.
    this.x = randomInt(PASTURE.minX, PASTURE.maxX);
    this.y = randomInt(PASTURE.minY, PASTURE.maxY);
  }

  /** Read the kind off the constructor so subclasses never have to reassign it. */
  get species() { return this.constructor.species; }
  get emoji() { return this.constructor.emoji; }
  get color() { return this.constructor.color; }
  get radius() { return this.constructor.radius; }
  get stepSize() { return this.constructor.stepSize; }

  makeSound() { return `${this.name} stays quiet.`; }
  move() { return `${this.name} wanders in place.`; }
  eat() { return `${this.name} nibbles on some ${this.favoriteFood}.`; }

  /**
   * The direction, in radians, this animal would like to walk next.
   * The base animal has no particular ambition and drifts at random.
   * @param {{ neighbors: Animal[] }} _context  the other animals on the farm
   * @returns {number}
   */
  heading(_context) { return randomAngle(); }

  /**
   * Aim at a fixed point — but once we've arrived, mill about instead of
   * pressing forever into the same spot.
   * @protected
   */
  headingToward(point) {
    const dx = point.x - this.x;
    const dy = point.y - this.y;
    if (Math.hypot(dx, dy) < this.stepSize) return randomAngle();
    return Math.atan2(dy, dx);
  }

  /** Where this animal lands if it walks `angle` for `distance`. */
  positionAfter(angle, dist = this.stepSize) {
    return { x: this.x + Math.cos(angle) * dist, y: this.y + Math.sin(angle) * dist };
  }

  /** True if standing at `point` would put this animal inside `other`'s space. */
  wouldCrowd(point, other) {
    return distance(point, other) < this.radius + other.radius;
  }

  /** Actually stand somewhere. Only the Farm should call this. */
  moveTo({ x, y }) {
    this.x = x;
    this.y = y;
    return this;
  }

  /**
   * What this animal yields in a day, or null if it yields nothing.
   * @returns {{ label: string, amount: number, unit: string } | null}
   */
  dailyProduce() { return null; }

  /** Label/value pairs for display. Subclasses append their own. */
  getAttributes() {
    return [
      { label: "Species", value: this.species },
      { label: "Breed", value: this.breed },
      { label: "Age", value: `${this.age} yr` },
      { label: "Favorite food", value: this.favoriteFood },
    ];
  }

  describe() {
    return `${this.name} — a ${this.age}-year-old ${this.breed} ${this.species.toLowerCase()}.`;
  }

  /** Build a member of this kind with a random name, breed and age. */
  static random() {
    return new this(pick(this.names), pick(this.breeds), randomInt(1, 6));
  }
}
