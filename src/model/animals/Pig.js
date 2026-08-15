import Animal from "../Animal.js";
import { randomInt } from "../random.js";

export default class Pig extends Animal {
  static species = "Pig";
  static emoji = "🐖";   // the whole pig, not the head — it has legs to walk on
  static color = "#D08B93";
  static diet = ["slops", "acorns", "sweet potatoes"];
  static breeds = ["Yorkshire", "Duroc", "Hampshire", "Berkshire"];
  static names = ["Wilbur", "Babe", "Hamlet", "Peppa", "Truffle"];
  static stepSize = 3.2;   // a purposeful trot
  static mass = 120;
  static radius = 5;
  static turnRate = 0.35;

  // The one animal here that keeps its own hours: a pig forages in the cool of
  // the night and sleeps off the heat of the day, in the mud for preference.
  static nocturnal = true;

  // The only animal here that would rather wallow than rest.
  static affinities = { wallow: 1.0, graze: 0.8, drink: 0.6, rest: 0.2, flock: 0.3, roam: 0.4, mate: 0.7 };
  static driveRates = { hunger: 0.006, thirst: 0.005, fatigue: 0.005, loneliness: 0.003, urge: 0.004 };
  static intake = 0.8;

  constructor(name, breed, age) {
    super(name, breed, age);
    this.mudBathsPerDay = randomInt(1, 3);
  }

  makeSound() { return `${this.name} grunts an enthusiastic "Oink oink!"`; }
  move() { return `${this.name} trots straight for the mud patch.`; }

  getAttributes() {
    return [...super.getAttributes(), { label: "Mud baths / day", value: this.mudBathsPerDay }];
  }
}
