import Animal from "../Animal.js";
import { distance } from "../pasture.js";
import { RESOURCE_KINDS } from "../Resource.js";

/**
 * The farmer. He stands in the field on the same terms as everything else in
 * it — a body with drives and a mind, which is why he is an Animal — but he is
 * the only one here who looks after anyone but himself.
 *
 * That is the whole of what makes him the owner: the `tend` goal, which he is
 * the only kind with any affinity for. It sends him to whichever trough or
 * patch is emptiest, and what he does when he gets there is the opposite of
 * what everything else on this farm does to a source — he fills it. When a
 * kind has run out of the field altogether he sows a fresh one where he
 * stands, because a source that empties is off the field for good and no
 * amount of walking to it would bring it back.
 *
 * All of it comes out of the barn behind his house, and the barn is finite.
 * He lives in the yard below it: with nothing that needs doing he walks home,
 * which is also where his day ends.
 */
export default class Human extends Animal {
  static species = "Human";
  // The man farmer rather than the person farmer, and not a matter of taste:
  // the system emoji font draws 🧑‍🌾 as two glyphs — a face with a plant beside
  // it — where it draws this one as a farmer in overalls, legs and all.
  static emoji = "👨‍🌾";
  static color = "#3F5A7D";
  static diet = ["bread", "cheese", "apples"];
  static breeds = ["Farmer"];
  static names = ["Old MacDonald"];
  static stepSize = 3.4;   // brisk; he has rounds to make
  static mass = 80;
  static radius = 4.5;
  static legs = 2;
  static turnRate = 0.5;

  // The chores come first, and nothing else here does them. He does not breed
  // — that is not what he is on the field for — and he is far too dignified to
  // wallow.
  static affinities = { tend: 1.0, drink: 0.8, graze: 0.7, rest: 0.5, flock: 0.3, roam: 0.3, wallow: 0, mate: 0 };
  static driveRates = { hunger: 0.003, thirst: 0.005, fatigue: 0.003, loneliness: 0.002, urge: 0 };
  static intake = 0.7;

  /** How much he pours in per step spent at a source, in that source's units. */
  static pours = 2.5;

  /**
   * What the farmhouse and the barn behind it hold, in resource units — hay in
   * the loft, water in the well. Everything he puts on the field comes out of
   * here, and nothing puts it back, which is what keeps him a farmer rather
   * than a miracle: an empty field still kills, it just takes him this much
   * longer to lose it.
   * ponytail: a plain number, spent and never earned. Give the barn a harvest
   * if the farm should be able to keep itself.
   */
  static stores = 1400;

  /** The yard below the barn, which is where he lives and where he ends his day. */
  static home = { x: 85, y: 34 };

  constructor(name, breed, age) {
    super(name, breed, age);
    // Old MacDonald is a he. Nothing here tosses a coin over that.
    this.sex = "male";
    // Nothing raises it and nothing relieves it, so left as it starts it would
    // sit on his card forever as a bar that means nothing.
    this.drives.urge = 0;
    /** What is left of the barn's stores. His own, not the farm's. */
    this.stores = new.target.stores;
  }

  /**
   * Being alive, and then the chores.
   *
   * Two of them. A kind that has run out altogether is the one thing a bucket
   * cannot fix — a source that empties leaves the field for good — so he
   * scatters a fresh one where he stands and tends it up from there. And
   * whatever he walked out to fill, he fills, from the bank rather than from
   * the middle: at a crowded trough the bank is the only room the herd leaves
   * him. Both come out of the barn, and a held source takes nothing at all.
   */
  feel(context = {}) {
    super.feel(context);
    const { farm } = context;
    if (!farm || this.stores <= 0) return;

    for (const { kind, sources } of farm.stock()) {
      if (sources > 0) continue;
      const volume = Math.min(this.stores, RESOURCE_KINDS[kind].capacity * 0.3);
      farm.sow(kind, this, volume);
      this.stores -= volume;
    }

    if (this.goal !== "tend") return;
    const source = this.goalPlace(context);
    if (source && distance(this, source) < source.radius + this.radius) {
      this.stores -= source.refill(Math.min(this.stores, this.constructor.pours));
    }
  }

  /** With nothing that needs doing, he heads back to the house. */
  roamHeading() { return this.headingToward(this.constructor.home); }

  makeSound() { return `${this.name} whistles a tune — E-I-E-I-O.`; }
  move() { return `${this.name} walks the fence line, counting heads.`; }

  /** He eats from the same fields he keeps; "crops at the grass" he does not. */
  narrate() {
    if (this.goal === "graze") return `${this.name} takes his own dinner from the field.`;
    return super.narrate();
  }

  /** One farmer, one name, one age. There is only ever the one of him. */
  static random() { return new Human("Old MacDonald", "Farmer", 67); }

  getAttributes() {
    return [
      ...super.getAttributes(),
      { label: "In the barn", value: `${Math.round(this.stores)} left to put down` },
    ];
  }
}
