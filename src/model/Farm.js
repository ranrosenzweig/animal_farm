import { SPECIES } from "./species.js";
import { PASTURE, distance, inBounds } from "./pasture.js";
import { randomInt } from "./random.js";

/**
 * The farm itself: a named place that holds animals and can answer
 * questions about them as a whole.
 *
 * The farm is also the only thing that knows where everyone is standing, so
 * it — not the animal — decides whether a step is allowed. An animal asks
 * for a direction; the farm grants the ground.
 *
 * `add`, `remove` and `step` return a *new* Farm rather than mutating this
 * one, so a Farm can sit directly in React state and comparisons stay
 * honest. The animals inside are shared by reference — an animal keeps its
 * identity (and its position) as the farm moves from version to version.
 */
export default class Farm {
  /**
   * Detours tried, in order, when the direction an animal wants is blocked:
   * straight ahead first, then wider and wider swerves to either side, and
   * finally straight back the way it came.
   */
  static DETOURS = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.2, -2.2, Math.PI];

  /** Step lengths tried at each detour: full stride, then shorter shuffles. */
  static STRIDES = [1, 0.6, 0.35];

  /**
   * @param {string} name
   * @param {import("./Animal.js").default[]} animals
   */
  constructor(name = "The Farm", animals = []) {
    this.name = name;
    this.animals = animals;
  }

  /** A farm stocked with one of every known species, none on top of another. */
  static starter(name = "The Farm") {
    return SPECIES.reduce((farm, Species) => farm.add(Species.random()).farm, new Farm(name));
  }

  get size() { return this.animals.length; }

  /**
   * Put an animal in the pasture, standing somewhere free.
   * @returns {{ farm: Farm, added: boolean }} `added` is false when there is
   *   nowhere left to stand — a full pasture turns the animal away rather
   *   than stacking it on top of one already there.
   */
  add(animal) {
    const spot = this.freeSpotFor(animal);
    if (!spot) return { farm: this, added: false };
    animal.moveTo(spot);
    return { farm: new Farm(this.name, [...this.animals, animal]), added: true };
  }

  /** @returns {Farm} a new farm without the animal carrying `id`. */
  remove(id) {
    return new Farm(this.name, this.animals.filter((a) => a.id !== id));
  }

  find(id) {
    return this.animals.find((a) => a.id === id);
  }

  bySpecies(species) {
    return this.animals.filter((a) => a.species === species);
  }

  /* ---------------------------------------------------------------- */
  /* Ground rules                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * May `mover` stand at `point`? Only if it is inside the fence and no
   * other animal's personal space reaches it.
   */
  isClear(point, mover) {
    return inBounds(point) && this.animals.every((a) => a === mover || !mover.wouldCrowd(point, a));
  }

  /**
   * A spot with room for `animal`, found by sampling the pasture.
   * @returns {{ x: number, y: number } | null} null when the field is too
   *   crowded to fit another animal — never a spot that would overlap.
   */
  freeSpotFor(animal, attempts = 400) {
    for (let i = 0; i < attempts; i++) {
      const spot = {
        x: randomInt(PASTURE.minX, PASTURE.maxX),
        y: randomInt(PASTURE.minY, PASTURE.maxY),
      };
      if (this.isClear(spot, animal)) return spot;
    }
    return null;
  }

  /**
   * Walk one animal one step, in place. It heads where it wants to go; if
   * another animal is already there it swerves, and if every way out is
   * blocked it stays put.
   * @returns {boolean} whether it found anywhere to go
   * @private
   */
  stepOne(mover) {
    const neighbors = this.animals.filter((a) => a !== mover);
    const desired = mover.heading({ neighbors, farm: this });

    for (const stride of Farm.STRIDES) {
      for (const detour of Farm.DETOURS) {
        const spot = mover.positionAfter(desired + detour, mover.stepSize * stride);
        if (!this.isClear(spot, mover)) continue;
        mover.moveTo(spot);
        return true;
      }
    }
    return false;
  }

  /**
   * Move one animal.
   * @returns {{ farm: Farm, moved: boolean }} `moved` is false when the
   *   animal is hemmed in on every side and could not step anywhere.
   */
  step(id) {
    const mover = this.find(id);
    if (!mover) return { farm: this, moved: false };
    const moved = this.stepOne(mover);
    return { farm: moved ? new Farm(this.name, this.animals) : this, moved };
  }

  /**
   * Move every animal once, in turn — each one sees where the others have
   * already gone this round.
   * @returns {{ farm: Farm, moved: number }} how many actually found room
   */
  stepAll() {
    const moved = this.animals.reduce((n, a) => n + (this.stepOne(a) ? 1 : 0), 0);
    return { farm: moved > 0 ? new Farm(this.name, this.animals) : this, moved };
  }

  /** Any pair standing closer than their radii allow. Should always be empty. */
  overlaps() {
    const pairs = [];
    for (let i = 0; i < this.animals.length; i++) {
      for (let j = i + 1; j < this.animals.length; j++) {
        const [a, b] = [this.animals[i], this.animals[j]];
        if (distance(a, b) < a.radius + b.radius) pairs.push([a, b]);
      }
    }
    return pairs;
  }

  /* ---------------------------------------------------------------- */
  /* Bookkeeping                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Head count per species, in registry order, including empty pens.
   * @returns {{ Species: Function, species: string, emoji: string, color: string, count: number }[]}
   */
  census() {
    return SPECIES.map((Species) => ({
      Species,
      species: Species.species,
      emoji: Species.emoji,
      color: Species.color,
      count: this.bySpecies(Species.species).length,
    }));
  }

  /**
   * Everything the farm yields in a day, summed across animals.
   * @returns {{ label: string, amount: number, unit: string }[]}
   */
  dailyProduce() {
    const totals = new Map();
    for (const animal of this.animals) {
      const yieldOf = animal.dailyProduce();
      if (!yieldOf) continue;
      const running = totals.get(yieldOf.label);
      if (running) running.amount += yieldOf.amount;
      else totals.set(yieldOf.label, { ...yieldOf });
    }
    return [...totals.values()].map((t) => ({ ...t, amount: Math.round(t.amount * 10) / 10 }));
  }

  /** Feed every animal; returns what happened, one line per animal. */
  feedAll() {
    return this.animals.map((a) => a.eat());
  }
}
