import { nextId, pick, randomAngle, randomInt } from "./random.js";
import { PASTURE, angleDifference, distance, normalizeAngle } from "./pasture.js";
import { DRIVES, clamp01, startingDrives } from "./drives.js";
import { GOALS, atGoal } from "./goals.js";
import ScriptedMind from "./minds/ScriptedMind.js";

/**
 * Abstract base for every animal on the farm.
 *
 * An animal is an agent with three layers, and each one only talks to its
 * neighbour:
 *
 *   1. **Body** — where it stands, which way it faces, how fast it walks and
 *      how sharply it can turn. Static metadata plus `facing`/`x`/`y`.
 *   2. **Drives** — hunger, thirst, fatigue, loneliness. They rise on their
 *      own and fall only while the animal is doing something about them.
 *   3. **Mind** — reads a percept, returns an intention. Swappable: a
 *      `ScriptedMind` scores the options arithmetically, and anything else
 *      implementing `decide(percept)` can take its place.
 *
 * The mind chooses a *goal*; the goal names a *place*; the body walks toward
 * it, forward only, and the Farm decides whether that step is allowed. No
 * layer reaches past the next one down.
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
  /**
   * @type {number} How far one step carries it, in pasture units (the field
   * is ~84 wide). A step is a small movement — crossing the pasture should
   * take many of them.
   */
  static stepSize = 2.5;
  /** @type {number} Personal space; two animals may not come closer than the sum of their radii. */
  static radius = 5;
  /**
   * @type {number} The most it can swing its facing in one step, in radians.
   * Small means wide, committed arcs; large means it can pivot on the spot.
   */
  static turnRate = 0.35;

  /**
   * @type {Record<string, number>} How much this kind cares about each goal,
   * 0–1. Multiplied by the pressure behind a goal to score it, so this is
   * what makes a duck make for the pond and a pig for the mud.
   */
  static affinities = {
    graze: 0.8, drink: 0.6, wallow: 0, flock: 0.4, rest: 0.5, roam: 0.4,
  };

  /** @type {Record<string, number>} How fast each drive climbs, per step. */
  static driveRates = { hunger: 0.004, thirst: 0.006, fatigue: 0.003, loneliness: 0.005 };

  /** @type {number} How fast the relevant drive falls while at a goal. */
  static relief = 0.06;

  /** @type {number} Standing pressure behind goals that relieve nothing (roam). */
  static baselinePressure = 0.35;

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
    /** Which way it is pointed. It only ever walks this way. */
    this.facing = randomAngle();
    /** Which way it prefers to peel off when something blocks its path. */
    this.spin = pick([1, -1]);
    /** How far it has swung away from where it wants to go, to get around something. */
    this.veer = 0;

    this.drives = startingDrives();
    /** What it is currently trying to do, and why. */
    this.intention = { goal: "roam", reason: "newly arrived" };
    /** Whatever decides that. Replaceable per animal. */
    this.mind = new ScriptedMind();
    this.sinceDecision = Infinity; // deliberate on the very first step
  }

  /** Read the kind off the constructor so subclasses never have to reassign it. */
  get species() { return this.constructor.species; }
  get emoji() { return this.constructor.emoji; }
  get color() { return this.constructor.color; }
  get radius() { return this.constructor.radius; }
  get stepSize() { return this.constructor.stepSize; }
  get turnRate() { return this.constructor.turnRate; }
  get affinities() { return this.constructor.affinities; }

  /**
   * Roughly how much room it needs to come about, in pasture units: a long
   * stride and a stiff neck make for a wide turn.
   */
  get turningCircle() { return this.stepSize / this.turnRate; }

  /** The goal it is currently pursuing. */
  get goal() { return this.intention.goal; }

  makeSound() { return `${this.name} stays quiet.`; }
  move() { return `${this.name} wanders in place.`; }
  eat() { return `${this.name} nibbles on some ${this.favoriteFood}.`; }

  /* ---------------------------------------------------------------- */
  /* Agency: perceive → decide → pursue                                */
  /* ---------------------------------------------------------------- */

  /**
   * Everything the animal can currently sense, as plain data — no live
   * objects, nothing that couldn't be written to JSON and handed to a
   * process that has never heard of this farm.
   * @param {{ neighbors?: Animal[] }} context
   * @returns {import("./minds/Mind.js").Percept}
   */
  perceive({ neighbors = [] } = {}) {
    return {
      self: {
        name: this.name,
        species: this.species,
        goal: this.goal,
        drives: { ...this.drives },
      },
      options: Object.entries(this.affinities)
        .filter(([, affinity]) => affinity > 0)
        .map(([goal, affinity]) => ({
          goal,
          affinity,
          pressure: this.pressureFor(goal),
        })),
      nearby: neighbors
        .map((n) => ({
          name: n.name,
          species: n.species,
          distance: Math.round(distance(this, n)),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 5),
    };
  }

  /** How badly it wants a given goal right now, before species affinity. */
  pressureFor(goalName) {
    const relieves = GOALS[goalName]?.relieves;
    return relieves ? this.drives[relieves] : this.constructor.baselinePressure;
  }

  /**
   * One step of being alive: drives shift, and — on the mind's own slower
   * cadence — the animal reconsiders what it is doing.
   * @returns {boolean} whether it settled on something new this step
   */
  think(context = {}) {
    this.feel(context);
    this.sinceDecision += 1;
    if (this.sinceDecision < this.mind.cadence) return false;

    this.sinceDecision = 0;
    const previous = this.goal;
    this.intention = this.mind.decide(this.perceive(context));
    return this.goal !== previous;
  }

  /** Drives climb; the one being served falls faster than it climbs. */
  feel(context = {}) {
    const rates = this.constructor.driveRates;
    for (const drive of DRIVES) {
      this.drives[drive] = clamp01(this.drives[drive] + (rates[drive] ?? 0));
    }

    const relief = this.constructor.relief;
    const current = GOALS[this.goal];
    if (current?.relieves && atGoal(this, this.goal, context)) {
      this.drives[current.relieves] = clamp01(this.drives[current.relieves] - relief);
    }

    // A few goals pay off whether or not the animal set out to pursue them —
    // standing among the others is company even if it never chose to flock.
    // Quarter relief: incidental, not sought.
    for (const [name, goal] of Object.entries(GOALS)) {
      if (!goal.passive || name === this.goal || !goal.relieves) continue;
      if (!atGoal(this, name, context)) continue;
      this.drives[goal.relieves] = clamp01(this.drives[goal.relieves] - relief / 4);
    }
  }

  /** True while its goal is one it pursues by standing still. */
  isStill() { return GOALS[this.goal]?.still === true; }

  /** Where its current goal is asking it to be, or null for nowhere in particular. */
  goalPlace(context = {}) {
    return GOALS[this.goal]?.place(this, context) ?? null;
  }

  /** What it's doing, in words — the goal's line, or the species' own for roaming. */
  narrate() {
    return (GOALS[this.goal] ?? GOALS.roam).narrate(this);
  }

  /**
   * The direction, in radians, this animal would like to be pointed next.
   * A wish, not a move — `turnToward` decides how much of it the animal can
   * act on. It steers toward whatever its goal named; with no destination it
   * falls through to the species' own way of wandering.
   * @param {{ neighbors: Animal[] }} [context]
   * @returns {number}
   */
  heading(context = {}) {
    if (this.isStill()) return this.facing;
    const place = this.goalPlace(context);
    return place ? this.headingToward(place) : this.roamHeading(context);
  }

  /**
   * How this kind moves when it has nowhere in particular to be. Overriding
   * this is how a species keeps its character without owning its motives.
   * @protected
   */
  roamHeading() { return this.amble(); }

  /** Carry on roughly forward. @protected */
  amble() { return this.facing + (Math.random() - 0.5) * 0.6; }

  /* ---------------------------------------------------------------- */
  /* Body: turning and stepping                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Aim at a fixed point — but once we've arrived, mill about instead of
   * pressing forever into the same spot. "Arrived" means close enough to
   * touch it, since a step is small.
   * @protected
   */
  headingToward(point) {
    const dx = point.x - this.x;
    const dy = point.y - this.y;
    if (Math.hypot(dx, dy) < this.radius) return this.amble();
    return Math.atan2(dy, dx);
  }

  /**
   * Swing the facing toward `desired`, by no more than `turnRate`, offset by
   * however far it is currently veering to get around something.
   * @returns {number} the facing it ends up with — the only way it can walk
   */
  turnToward(desired) {
    const wanted = angleDifference(desired + this.veer, this.facing);
    const turn = Math.max(-this.turnRate, Math.min(this.turnRate, wanted));
    this.facing = normalizeAngle(this.facing + turn);
    return this.facing;
  }

  /** Blocked ahead: peel further off course so the next step tries a new line. */
  balk() {
    this.veer = normalizeAngle(this.veer + this.spin * this.turnRate);
  }

  /** Got through: bleed off the detour and get back to where it was headed. */
  settle() {
    this.veer = Math.abs(this.veer) < 0.05 ? 0 : this.veer * 0.5;
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

  /** Step forward to `spot`, which lies along `angle` — now the way it faces. */
  advanceTo(spot, angle) {
    this.facing = normalizeAngle(angle);
    return this.moveTo(spot);
  }

  /* ---------------------------------------------------------------- */
  /* Display                                                           */
  /* ---------------------------------------------------------------- */

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
