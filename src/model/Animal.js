import { nextId, pick, randomAngle, randomInt } from "./random.js";
import { PASTURE, angleDifference, distance, normalizeAngle } from "./pasture.js";
import { DRIVES, clamp01, startingDrives } from "./drives.js";
import { GOALS, atGoal, companyFor } from "./goals.js";
import { RESOURCE_NAMES } from "./Resource.js";
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
    graze: 0.8, drink: 0.6, wallow: 0, flock: 0.4, rest: 0.5, roam: 0.4, mate: 0.7,
  };

  /** @type {Record<string, number>} How fast each drive climbs, per step. */
  static driveRates = {
    hunger: 0.004, thirst: 0.006, fatigue: 0.003, loneliness: 0.005, urge: 0.003,
  };

  /**
   * @type {number} Fatigue the loser of a contest pays for having had it out
   * with a total stranger. Knowing the other animal makes it cheaper.
   */
  static strain = 0.05;

  /**
   * @type {number} Steps before it will square up to anyone again. A contest
   * is an event, not a condition: without this, an animal queueing at a
   * trough is blocked on every single step and so contests on every single
   * step, which buries the herd in fatigue.
   */
  static contestRest = 40;

  /** @type {number} How much a tie strengthens per step spent in someone's company. */
  static bonding = 0.02;

  /**
   * @type {number} How much a tie fades per step apart. An order of magnitude
   * slower than it forms: company is quicker to make than to forget.
   */
  static forgetting = 0.002;

  /** @type {number} Steps a female carries young before giving birth. */
  static gestation = 300;

  /** @type {number} Steps a newborn takes to grow up and be able to breed. */
  static maturesAt = 400;

  /** @type {number} How fast the relevant drive falls while at a goal. */
  static relief = 0.06;

  /** @type {number} A full mouthful, in resource units per step. Bigger animals take more. */
  static intake = 0.6;

  /** @type {number} Condition lost per step while starving or parched. */
  static frailty = 0.004;

  /** @type {number} Condition regained per step when neither is at its limit. */
  static recovery = 0.002;

  /** @type {number} Standing pressure behind goals that relieve nothing (roam). */
  static baselinePressure = 0.35;

  /**
   * @type {number} What a goal's pressure is worth when there is nowhere to
   * go for it — no water in the field, no possible mate. Near zero, because
   * an animal that cannot act on a want should not let it crowd out one it
   * can act on. The drive itself keeps climbing; that is what kills.
   */
  static unreachable = 0.2;

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

    this.sex = pick(["male", "female"]);
    /** What this one, rather than its kind, brings to a contest. */
    this.vigour = 0.85 + Math.random() * 0.3;
    /** Steps left before it will square up to anyone again. */
    this.contestCooldown = 0;
    this.drives = startingDrives();
    /** Condition, 0–1. Falls only while a drive is pinned at its limit. At 0 it dies. */
    this.health = 1;
    /** Which drive finished it off, once it has. */
    this.endedBy = null;
    /** `{ by, left }` while carrying young, else null. Females only. */
    this.pregnancy = null;
    /** Steps lived, which is how a newborn grows up. */
    this.stepsAlive = 0;
    /** `{ mother, father, species }` for animals that were born here, else null. */
    this.parents = null;
    /**
     * Who it knows, by id, 0 (a stranger) to 1. Ties form by standing
     * together and fade apart — see `keepCompany`.
     */
    this.bonds = new Map();
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
  perceive({ neighbors = [], farm } = {}) {
    return {
      self: {
        name: this.name,
        species: this.species,
        sex: this.sex,
        goal: this.goal,
        health: this.health,
        adult: this.isAdult,
        pregnant: this.isPregnant,
        drives: { ...this.drives },
      },
      // The nearest source of each kind that still has something in it.
      // `distance: null` means there is none left anywhere in the field.
      sources: RESOURCE_NAMES.map((kind) => {
        const source = farm?.nearestResource(this, kind);
        return source
          ? { kind, distance: Math.round(distance(this, source)), volume: Math.round(source.volume) }
          : { kind, distance: null, volume: 0 };
      }),
      options: Object.entries(this.affinities)
        // Breeding is simply not on the table for the young or the expecting.
        .filter(([goal, affinity]) => affinity > 0 && (goal !== "mate" || this.canMate()))
        .map(([goal, affinity]) => ({
          goal,
          affinity,
          pressure: this.pressureFor(goal, { neighbors, farm }),
        })),
      nearby: neighbors
        .map((n) => ({
          name: n.name,
          species: n.species,
          distance: Math.round(distance(this, n)),
          // 0 for one it has never stood with, 1 for one it knows well.
          familiarity: Math.round(this.familiarity(n) * 100) / 100,
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 5),
    };
  }

  /**
   * How badly it wants a given goal right now, before species affinity.
   *
   * A goal with nowhere to go — no water left, no possible mate — is worth
   * only a fraction of its drive, so it stops crowding out goals the animal
   * can actually act on. It still wanders and the drive still climbs; this
   * changes what it chooses, not what it suffers.
   */
  pressureFor(goalName, context = {}) {
    const goal = GOALS[goalName];
    if (!goal?.relieves) return this.constructor.baselinePressure;
    const pressure = this.drives[goal.relieves];
    if (goal.anywhere || goal.place(this, context) != null) return pressure;
    return pressure * this.constructor.unreachable;
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

  /** Drives climb; the one being served falls only if there was anything to take. */
  feel(context = {}) {
    const rates = this.constructor.driveRates;
    for (const drive of DRIVES) {
      this.drives[drive] = clamp01(this.drives[drive] + (rates[drive] ?? 0));
    }

    const relief = this.constructor.relief;
    const current = GOALS[this.goal];
    if (current?.relieves && atGoal(this, this.goal, context)) {
      // Standing at a dry pond is not drinking, and a stranger is not a
      // friend. Either way a goal pays off only in proportion to what being
      // there was actually worth.
      const share = this.shareOf(current, context);
      if (share > 0) {
        this.drives[current.relieves] = clamp01(this.drives[current.relieves] - relief * share);
      }
    }

    // A few goals pay off whether or not the animal set out to pursue them —
    // standing among the others is company even if it never chose to flock.
    // Quarter relief: incidental, not sought.
    for (const [name, goal] of Object.entries(GOALS)) {
      if (!goal.passive || name === this.goal || !goal.relieves) continue;
      if (!atGoal(this, name, context)) continue;
      const share = this.shareOf(goal, context);
      this.drives[goal.relieves] = clamp01(this.drives[goal.relieves] - (relief / 4) * share);
    }

    this.grow();
    this.wear();
  }

  /**
   * Time passing: a newborn fills out into an adult, and a female carrying
   * young gets one step closer to delivering.
   * @private
   */
  grow() {
    this.stepsAlive += 1;
    if (this.age === 0 && this.stepsAlive >= this.constructor.maturesAt) this.age = 1;
    if (this.pregnancy) this.pregnancy.left -= 1;
    if (this.contestCooldown > 0) this.contestCooldown -= 1;
  }

  /**
   * How much of a goal's full relief being here has earned, 0–1. A goal that
   * consumes is limited by what its source could give; one that sets its own
   * `worth` is limited by that; anything else pays in full.
   * @returns {number}
   * @private
   */
  shareOf(goal, context) {
    if (goal.consumes) return this.consume(goal, context);
    return goal.worth ? goal.worth(this, context) : 1;
  }

  /**
   * Take a mouthful from whatever source serves the current goal.
   * @returns {number} 0–1, how much of a full mouthful it actually got
   * @private
   */
  consume(goal, context) {
    const source = goal.place(this, context);
    if (typeof source?.draw !== "function") return 0;
    const wanted = this.constructor.intake;
    return wanted > 0 ? source.draw(wanted) / wanted : 0;
  }

  /**
   * Going without tells. An animal wears down only while a drive is pinned at
   * its limit — being merely hungry costs it nothing — and it mends whenever
   * neither is. Reaching zero is the end of it.
   *
   * Solitude is the exception: it never kills, but an animal left entirely
   * alone holds its condition where it stands instead of mending. Only hunger
   * and thirst can be written on a headstone.
   * @private
   */
  wear() {
    const parched = this.drives.thirst >= 1;
    const starving = this.drives.hunger >= 1;
    const alone = this.drives.loneliness >= 1;
    const { frailty, recovery } = this.constructor;

    if (parched || starving) this.health = clamp01(this.health - frailty);
    else if (!alone) this.health = clamp01(this.health + recovery);

    if (this.health <= 0 && !this.endedBy) {
      this.endedBy = parched ? "thirst" : "hunger";
    }
  }

  /** False once its condition has run out. The Farm clears it from the field. */
  isAlive() { return this.health > 0; }

  /** Why it died, in words. */
  epitaph() {
    return `${this.name} the ${this.species.toLowerCase()} died of ${this.endedBy ?? "unknown causes"}.`;
  }

  /* ---------------------------------------------------------------- */
  /* Company                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * How well it knows `other`: 0 for a stranger, 1 for one it has spent a
   * long time standing beside.
   */
  familiarity(other) {
    return this.bonds.get(other.id) ?? 0;
  }

  /**
   * Take note of who it has been standing with. Ties to present company
   * strengthen, everyone else fades, and one worn through to nothing is
   * dropped rather than kept at zero — which is also how the dead and the
   * long departed leave an animal's acquaintance.
   *
   * This only ever writes to `this`. Two animals near each other each keep
   * their own side of the tie, and a round in which both are stepped leaves
   * the pair agreeing.
   */
  keepCompany(neighbors = []) {
    const { bonding, forgetting } = this.constructor;
    const present = new Set(companyFor(this, neighbors).map((n) => n.id));

    for (const [id, tie] of this.bonds) {
      if (present.has(id)) continue;
      if (tie <= forgetting) this.bonds.delete(id);
      else this.bonds.set(id, tie - forgetting);
    }
    for (const id of present) {
      this.bonds.set(id, clamp01((this.bonds.get(id) ?? 0) + bonding));
    }
  }

  /** Set a tie outright, rather than waiting for it to form. */
  bondTo(other, tie = 1) {
    this.bonds.set(other.id, clamp01(tie));
  }

  /**
   * What it brings to a contest over a trough — size and maturity do most of
   * the work, with a little that is simply this animal's own. It is never
   * compared across anything but a blocked step, so the units don't matter;
   * only which of two numbers is larger.
   */
  get strength() {
    return this.radius * (this.isAdult ? 1 : 0.5) * this.vigour;
  }

  /**
   * Give ground. It keeps wanting whatever it wanted — losing does not change
   * an animal's mind — but it turns well off the line it was walking and pays
   * for the encounter in fatigue. It will be back at the trough later, and
   * further down the queue than it was.
   */
  giveWay(cost) {
    this.veer = normalizeAngle(this.veer + this.spin * Math.PI * 0.5);
    this.drives.fatigue = clamp01(this.drives.fatigue + cost);
  }

  /** True while it is willing to square up to anyone at all. */
  get squaresUp() { return this.contestCooldown === 0; }

  /** Had it out with someone; it will let the next one pass for a while. */
  afterContest() {
    this.contestCooldown = this.constructor.contestRest;
  }

  /* ---------------------------------------------------------------- */
  /* Breeding                                                          */
  /* ---------------------------------------------------------------- */

  /** Newborns are age 0 and grow into adults after `maturesAt` steps. */
  get isAdult() { return this.age >= 1; }

  get isPregnant() { return this.pregnancy != null; }

  /** Grown, alive, and not already carrying. Says nothing about a partner. */
  canMate() {
    return this.isAdult && this.isAlive() && !this.isPregnant;
  }

  /**
   * Take. Only the Farm calls this, and only once it has checked that the two
   * are the same species and opposite sexes — an animal cannot verify that
   * about another on its own.
   */
  conceive(sire) {
    this.pregnancy = { by: sire.name, left: this.constructor.gestation };
    this.drives.urge = 0;
    sire.drives.urge = 0;
  }

  readyToBirth() {
    return this.isPregnant && this.pregnancy.left <= 0;
  }

  /**
   * A newborn of this animal's own species, carrying its mother's breed. It
   * is not on the field yet — the Farm has to find it somewhere to stand.
   */
  newborn() {
    const baby = new this.constructor(pick(this.constructor.names), this.breed, 0);
    baby.parents = { mother: this.name, father: this.pregnancy?.by ?? null, species: this.species };
    return baby;
  }

  /** The birth is done and the Farm has placed the young one. */
  delivered() {
    this.pregnancy = null;
  }

  /** How a birth reads in the log. */
  birthNotice() {
    const to = this.parents
      ? ` to ${this.parents.mother}${this.parents.father ? ` and ${this.parents.father}` : ""}`
      : "";
    return `${this.name}, a ${this.sex} ${this.species.toLowerCase()}, is born${to}.`;
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
      { label: "Sex", value: this.sex === "female" ? "♀ female" : "♂ male" },
      { label: "Breed", value: this.breed },
      { label: "Age", value: this.isAdult ? `${this.age} yr` : "newborn" },
      { label: "Favorite food", value: this.favoriteFood },
    ];
  }

  describe() {
    const age = this.isAdult ? `${this.age}-year-old` : "newborn";
    return `${this.name} — a ${age} ${this.sex} ${this.breed} ${this.species.toLowerCase()}.`;
  }

  /** Build a member of this kind with a random name, breed and age. */
  static random() {
    return new this(pick(this.names), pick(this.breeds), randomInt(1, 6));
  }
}
