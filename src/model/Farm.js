import { SPECIES } from "./species.js";
import { PASTURE, clampToPasture, distance, inBounds } from "./pasture.js";
import { randomAngle, randomInt } from "./random.js";
import { ROCKS, standable } from "./terrain.js";
import {
  CONTACT_SLOP, RELAXATIONS, STOPPED,
  capSpeed, collide, collideStatic, confine, containWithin, separate, separateStatic,
} from "./physics.js";
import Resource, { RESOURCE_KINDS, RESOURCE_NAMES } from "./Resource.js";

/**
 * The farm itself: a named place that holds animals and can answer
 * questions about them as a whole.
 *
 * The farm is also the only thing that knows where everyone is standing, so
 * it — not the animal — settles what happens when they meet. An animal pushes
 * itself along; the farm runs the collisions.
 *
 * `add`, `remove` and `step` return a *new* Farm rather than mutating this
 * one, so a Farm can sit directly in React state and comparisons stay
 * honest. The animals inside are shared by reference — an animal keeps its
 * identity (and its position) as the farm moves from version to version.
 */
export default class Farm {
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

  /**
   * Who `animal` knows best, closest tie first. An animal holds nothing but
   * ids; only the farm can say whose they are — and only the farm can leave
   * out the ones who have since died or been taken away.
   * @returns {{ animal: import("./Animal.js").default, tie: number }[]}
   */
  companionsOf(animal, limit = 3) {
    return this.animals
      .filter((other) => other !== animal && animal.familiarity(other) > 0)
      .map((other) => ({ animal: other, tie: animal.familiarity(other) }))
      .sort((a, b) => b.tie - a.tie)
      .slice(0, limit);
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

  /* ---------------------------------------------------------------- */
  /* Breeding                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * The nearest animal `seeker` could breed with: **its own species**, the
   * opposite sex, grown, and not already carrying. Says nothing about what
   * either of them is currently doing.
   *
   * Cross-species pairing is impossible by construction — the species test is
   * here, and every pairing in the model goes through this scan.
   * @returns {import("./Animal.js").default | null}
   */
  eligibleMate(seeker) {
    return this.nearestMateWhere(seeker);
  }

  /**
   * The nearest eligible partner who is *also* looking for one. Mating takes
   * two, so this is the test for the act itself — but not for whether wanting
   * a mate is worth anything, which is `eligibleMate`. Conflating the two
   * deadlocks the whole thing: if only a willing partner counts, nobody can
   * be the first to want one.
   * @returns {import("./Animal.js").default | null}
   */
  willingMate(seeker) {
    return this.nearestMateWhere(seeker, (other) => other.goal === "mate");
  }

  /** @private */
  nearestMateWhere(seeker, alsoWanted = () => true) {
    if (!seeker.canMate()) return null;

    let nearest = null;
    let shortest = Infinity;
    for (const other of this.animals) {
      if (other === seeker) continue;
      if (other.species !== seeker.species) continue;
      if (other.sex === seeker.sex) continue;
      if (!other.canMate() || !alsoWanted(other)) continue;
      const away = distance(seeker, other);
      if (away < shortest) {
        shortest = away;
        nearest = other;
      }
    }
    return nearest;
  }

  /**
   * If `mover` is courting and has reached a willing partner, they mate and
   * the female takes. Called after the step, so animals pair where they
   * actually ended up.
   * @returns {{ mother, father } | null}
   * @private
   */
  courtship(mover) {
    if (mover.goal !== "mate") return null;
    const partner = this.willingMate(mover);
    if (!partner) return null;
    if (distance(mover, partner) > mover.radius + partner.radius + 1) return null;

    const mother = mover.sex === "female" ? mover : partner;
    const father = mover.sex === "female" ? partner : mover;
    mother.conceive(father);
    return { mother, father };
  }

  /**
   * Any young due are born, each of its mother's own species. A birth needs
   * somewhere to stand: on a full pasture it simply waits for room.
   * @returns {import("./Animal.js").default[]}
   * @private
   */
  deliver() {
    const born = [];
    for (const mother of this.animals) {
      if (!mother.isAlive() || !mother.readyToBirth()) continue;
      const baby = mother.newborn();
      // Beside its mother if there is room there, and only failing that
      // wherever the field has a gap.
      const spot = this.freeSpotNear(mother, baby) ?? this.freeSpotFor(baby);
      if (!spot) continue; // no room in the field; the birth waits
      baby.name = this.unusedName(baby.name);
      baby.moveTo(spot);
      // The two of them know each other from the first step, without having
      // had to stand together to learn it.
      baby.bondTo(mother);
      mother.bondTo(baby);
      mother.delivered();
      born.push(baby);
    }
    return born;
  }

  /**
   * `name`, or the next free variation of it. Species name lists are short,
   * so without this a farm ends up with two Babes and an ambiguous log.
   * @private
   */
  unusedName(name) {
    const taken = new Set(this.animals.map((a) => a.name));
    if (!taken.has(name)) return name;
    let n = 2;
    while (taken.has(`${name} ${n}`)) n += 1;
    return `${name} ${n}`;
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
   * May `mover` stand at `point`? Only if it is inside the fence, clear of the
   * rocks, and no other animal's personal space reaches it.
   */
  isClear(point, mover) {
    return inBounds(point)
      && standable(point, mover.radius)
      && this.animals.every((a) => a === mover || !mover.wouldCrowd(point, a));
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
   * A spot with room for `animal` as near to `beside` as the two of them are
   * allowed to stand, trying further out only as the closer ground turns out
   * to be taken. A newborn ends up at its mother's flank, not merely in her
   * quarter of the field — which matters, because two animals at their
   * minimum separation are exactly close enough to count as company.
   * @returns {{ x: number, y: number } | null} null when the ground around
   *   `beside` is all taken; the caller falls back to the whole field.
   */
  freeSpotNear(beside, animal, attempts = 60) {
    const closest = animal.radius + beside.radius;
    const reach = animal.radius * 3;
    for (let i = 0; i < attempts; i++) {
      const angle = randomAngle();
      const away = closest + (i / attempts) * reach;
      const spot = clampToPasture({
        x: beside.x + Math.cos(angle) * away,
        y: beside.y + Math.sin(angle) * away,
      });
      if (this.isClear(spot, animal)) return spot;
    }
    return null;
  }

  /**
   * Think, steer, and carry one animal forward under the forces on it.
   *
   * It may well end the step standing inside another animal or halfway into a
   * rock. `resolve` sorts that out once everyone has moved, because a
   * collision is about two bodies and neither of them gets to settle it alone.
   * @private
   */
  drive(mover) {
    const context = { neighbors: this.animals.filter((a) => a !== mover), farm: this };
    mover.think(context);
    // Ties form and fade by who is standing about, which has nothing to do
    // with what the animal decided to do or whether it manages to move — so
    // this happens every step, before any of that.
    mover.keepCompany(context.neighbors);
    // A goal pursued by standing still is pursued facing wherever it already was.
    if (!mover.isStill()) mover.turnToward(mover.heading(context));
    mover.push();
  }

  /**
   * Sort out everything that ended the step overlapping: animal against
   * animal, animal against rock, animal against fence.
   *
   * Momentum is traded first, once per touching pair — a collision happens
   * once, and bouncing the same pair again on a later pass would invent energy
   * the field never had. Then the bodies are prised apart, over and over,
   * because separating one pair can drive one of them into a third; that is
   * exactly what a horse coming through a knot of sheep does. The passes stop
   * as soon as everything is settled to within `CONTACT_SLOP`, which on an
   * ordinary field is after one or two.
   * @returns {number} passes spent, which is how jammed the field was
   * @private
   */
  resolve() {
    for (let i = 0; i < this.animals.length; i++) {
      for (let j = i + 1; j < this.animals.length; j++) {
        collide(this.animals[i], this.animals[j]);
      }
    }
    for (const animal of this.animals) {
      for (const rock of ROCKS) collideStatic(animal, rock);
      containWithin(animal);
      // Every impulse of this round has now landed on it, so this is where the
      // speed limit belongs — after the shoving, not only after the striding.
      capSpeed(animal, animal.topSpeed);
    }

    for (let pass = 0; pass < RELAXATIONS; pass++) {
      let deepest = 0;
      for (let i = 0; i < this.animals.length; i++) {
        for (let j = i + 1; j < this.animals.length; j++) {
          deepest = Math.max(deepest, separate(this.animals[i], this.animals[j]));
        }
      }
      // The ground has the last word: whatever the bodies did to each other,
      // nobody ends up inside a rock or outside the fence.
      for (const animal of this.animals) {
        for (const rock of ROCKS) deepest = Math.max(deepest, separateStatic(animal, rock));
        deepest = Math.max(deepest, confine(animal));
      }
      // One test for all three, and it is "did anything have to move much?".
      // Shoving a body off the fence can drive it into a neighbour nothing has
      // looked at since, so the fence counts towards the same figure as the
      // bodies and the rocks — but by *how far* it moved, not merely whether
      // it moved, or an animal dozing against a rail would keep this running
      // to the cap forever. Settling to well inside the slop rather than
      // merely to it is the margin that keeps `overlaps` honestly empty.
      if (deepest <= CONTACT_SLOP / 4) return pass + 1;
    }
    return RELAXATIONS;
  }

  /**
   * What became of an animal this round, given where it stood before it, and
   * the nudge to its steering that follows from that.
   *
   * "Blocked" now means it pushed and got nowhere — pressed into a rock, or
   * into a neighbour heavy enough to ignore it — which is its cue to lean off
   * its line and try a different one next step.
   * @returns {"moved" | "resting" | "blocked"}
   * @private
   */
  outcomeFor(animal, from) {
    if (animal.isStill()) return "resting";
    if (Math.hypot(animal.x - from.x, animal.y - from.y) <= STOPPED) {
      animal.balk();
      return "blocked";
    }
    animal.settle();
    return "moved";
  }

  /**
   * Live one animal for one step. Only it thinks and pushes, but the whole
   * field still settles afterwards — so a duck shouldered aside by the one
   * animal that moved really does get shouldered aside.
   * @returns {{ farm: Farm, moved: boolean, outcome: string, intention: object|null }}
   *   `outcome` separates the two reasons an animal doesn't move: it chose to
   *   stay ("resting") or it pushed and got nowhere ("blocked").
   */
  step(id) {
    const mover = this.find(id);
    if (!mover) return { farm: this, moved: false, outcome: "missing", intention: null, died: [] };

    const from = { x: mover.x, y: mover.y };
    this.drive(mover);
    this.resolve();
    const outcome = this.outcomeFor(mover, from);
    this.courtship(mover);

    const born = this.deliver();
    return {
      farm: this.settled(born),
      moved: outcome === "moved",
      outcome,
      intention: { ...mover.intention },
      died: mover.isAlive() ? [] : [mover],
      born,
    };
  }

  /**
   * Live every animal for one step: each thinks and pushes in turn, and then
   * the whole field resolves at once. Always returns a new Farm — even an
   * animal that didn't move has felt something change.
   * @returns {{ farm: Farm, moved: number }} how many actually got anywhere
   */
  stepAll() {
    const before = this.animals.map((animal) => ({ animal, x: animal.x, y: animal.y }));
    for (const animal of this.animals) this.drive(animal);
    this.resolve();

    let moved = 0;
    for (const was of before) {
      if (this.outcomeFor(was.animal, was) === "moved") moved += 1;
      this.courtship(was.animal); // a pair that met and stopped is still a pair
    }

    const born = this.deliver();
    return {
      farm: this.settled(born),
      moved,
      born,
      died: this.animals.filter((a) => !a.isAlive()),
      dried: this.resources.filter((r) => r.depleted),
    };
  }

  /**
   * The farm as it stands after a round: the young are on the field, the dead
   * are off it, and the drained sources are gone.
   * @private
   */
  settled(born = []) {
    return new Farm(
      this.name,
      [...this.animals.filter((a) => a.isAlive()), ...born],
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

  /**
   * Any pair standing closer than their radii allow. Should always be empty.
   *
   * "Closer than allowed" means deeper than `CONTACT_SLOP`, the same hair's
   * breadth `resolve` settles for. Two animals leaning on one another rest
   * exactly at arm's length give or take a rounding error, and calling that
   * an overlap would mean nothing in a crowd ever counted as separated.
   */
  overlaps() {
    const pairs = [];
    for (let i = 0; i < this.animals.length; i++) {
      for (let j = i + 1; j < this.animals.length; j++) {
        const [a, b] = [this.animals[i], this.animals[j]];
        if (a.radius + b.radius - distance(a, b) > CONTACT_SLOP) pairs.push([a, b]);
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
