import { SPECIES } from "./species.js";
import { PASTURE, clampToPasture, distance, inBounds } from "./pasture.js";
import { randomInt } from "./random.js";
import Resource, { RESOURCE_KINDS, RESOURCE_NAMES } from "./Resource.js";

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
   * Lines tried when the way ahead is blocked, as fractions of the animal's
   * own turn rate: dead ahead first, then the slightest lean to either side.
   * Nothing here exceeds ±1 turn rate, so an animal can never sidestep or
   * back up — the most it can do is shade the line it was already walking.
   */
  static NUDGES = [0, 0.5, -0.5, 1, -1];

  /** Step lengths tried on each line: full stride, then shorter ones. */
  static STRIDES = [1, 0.6, 0.35];

  /**
   * @param {string} name
   * @param {import("./Animal.js").default[]} animals
   * @param {Resource[]} resources  water and grass, which run out
   */
  constructor(name = "The Farm", animals = [], resources = []) {
    this.name = name;
    this.animals = animals;
    this.resources = resources;
  }

  /** A farm stocked with one of every species, a pond and two patches of grass. */
  static starter(name = "The Farm") {
    // Enough to start with, not enough to forget about: nothing here grows
    // back, so a farm left alone drinks itself dry and dies.
    const land = new Farm(name, [], [
      new Resource("water", { x: 17, y: 68 }, { name: "Pond" }),
      new Resource("water", { x: 80, y: 24 }, { name: "Trough" }),
      new Resource("grass", { x: 34, y: 30 }, { name: "Meadow" }),
      new Resource("grass", { x: 74, y: 60 }, { name: "Clover patch" }),
    ]);
    return SPECIES.reduce((farm, Species) => farm.add(Species.random()).farm, land);
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
    return { farm: new Farm(this.name, [...this.animals, animal], this.resources), added: true };
  }

  /** @returns {Farm} a new farm without the animal carrying `id`. */
  remove(id) {
    return new Farm(this.name, this.animals.filter((a) => a.id !== id), this.resources);
  }

  find(id) {
    return this.animals.find((a) => a.id === id);
  }

  bySpecies(species) {
    return this.animals.filter((a) => a.species === species);
  }

  /* ---------------------------------------------------------------- */
  /* Water and grass                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Put down water or grass. Animals aren't blocked by it and can stand in
   * it — a trough is somewhere to be, not something to walk around.
   * @param {"water"|"grass"} kind
   * @param {{x: number, y: number}} at  clamped inside the fence
   * @returns {{ farm: Farm, resource: Resource }}
   */
  addResource(kind, at, options) {
    const resource = new Resource(kind, clampToPasture(at), options);
    return {
      farm: new Farm(this.name, this.animals, [...this.resources, resource]),
      resource,
    };
  }

  /**
   * The closest source of `kind` that still has something in it. A drained
   * one stops attracting animals; null means there is none left at all.
   * @returns {Resource | null}
   */
  nearestResource(point, kind) {
    let nearest = null;
    let shortest = Infinity;
    for (const resource of this.resources) {
      if (resource.kind !== kind || resource.depleted) continue;
      const away = distance(point, resource);
      if (away < shortest) {
        shortest = away;
        nearest = resource;
      }
    }
    return nearest;
  }

  /** What's left in the field, per kind. */
  stock() {
    return RESOURCE_NAMES.map((kind) => {
      const of = this.resources.filter((r) => r.kind === kind && !r.depleted);
      return {
        kind,
        label: RESOURCE_KINDS[kind].label,
        unit: RESOURCE_KINDS[kind].unit,
        sources: of.length,
        volume: Math.round(of.reduce((total, r) => total + r.volume, 0)),
      };
    });
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
   * Live one animal for one step: it feels, it may reconsider, and then it
   * acts on whatever it decided.
   *
   * Acting means turning as far toward its goal as its neck allows and then
   * walking *forward* along the facing it ends up with. If the ground ahead
   * is taken it may shade the line very slightly or shorten the stride, but
   * it cannot step around the obstacle — so a blocked animal stays where it
   * is, having turned a little, and tries a fresh line next step.
   *
   * @returns {"moved" | "resting" | "blocked"}
   * @private
   */
  stepOne(mover) {
    const context = { neighbors: this.animals.filter((a) => a !== mover), farm: this };
    mover.think(context);

    // Some goals are pursued by staying put; that isn't being stuck.
    if (mover.isStill()) return "resting";

    const facing = mover.turnToward(mover.heading(context));

    for (const stride of Farm.STRIDES) {
      for (const nudge of Farm.NUDGES) {
        const angle = facing + nudge * mover.turnRate;
        const spot = mover.positionAfter(angle, mover.stepSize * stride);
        if (!this.isClear(spot, mover)) continue;
        mover.advanceTo(spot, angle);
        mover.settle();
        return "moved";
      }
    }
    mover.balk();
    return "blocked";
  }

  /**
   * Live one animal for one step.
   * @returns {{ farm: Farm, moved: boolean, outcome: string, intention: object|null }}
   *   `outcome` separates the two reasons an animal doesn't move: it chose to
   *   stay ("resting") or it had nowhere to go ("blocked").
   */
  step(id) {
    const mover = this.find(id);
    if (!mover) return { farm: this, moved: false, outcome: "missing", intention: null, died: [] };
    const outcome = this.stepOne(mover);
    return {
      farm: this.settled(),
      moved: outcome === "moved",
      outcome,
      intention: { ...mover.intention },
      died: mover.isAlive() ? [] : [mover],
    };
  }

  /**
   * Live every animal for one step, in turn — each one sees where the others
   * have already gone this round. Always returns a new Farm: even an animal
   * that didn't move has felt something change.
   * @returns {{ farm: Farm, moved: number }} how many actually found room
   */
  stepAll() {
    let moved = 0;
    for (const animal of this.animals) {
      if (this.stepOne(animal) === "moved") moved += 1;
    }
    return {
      farm: this.settled(),
      moved,
      died: this.animals.filter((a) => !a.isAlive()),
      dried: this.resources.filter((r) => r.depleted),
    };
  }

  /**
   * The farm as it stands after a round: the dead are off the field and the
   * drained sources are gone.
   * @private
   */
  settled() {
    return new Farm(
      this.name,
      this.animals.filter((a) => a.isAlive()),
      this.resources.filter((r) => !r.depleted),
    );
  }

  /**
   * What the farm is up to: how many animals are pursuing each goal, busiest
   * first. Empty goals are left out.
   * @returns {{ goal: string, count: number }[]}
   */
  activity() {
    const tally = new Map();
    for (const animal of this.animals) {
      tally.set(animal.goal, (tally.get(animal.goal) ?? 0) + 1);
    }
    return [...tally.entries()]
      .map(([goal, count]) => ({ goal, count }))
      .sort((a, b) => b.count - a.count);
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
