import Animal from "../Animal.js";
import { randomInt } from "../random.js";

export default class Duck extends Animal {
  static species = "Duck";
  static emoji = "🦆";
  static color = "#3E7CA6";
  static diet = ["pond weed", "cracked corn", "duckweed"];
  static breeds = ["Mallard", "Pekin", "Rouen", "Khaki Campbell"];
  static names = ["Quackers", "Puddles", "Donald", "Waddle", "Mallory"];
  static stepSize = 2.8;   // an unhurried waddle
  static radius = 4.5;
  static turnRate = 0.45;  // waddles round quickly enough

  // Never far from water, and thirsty long before it is hungry.
  static affinities = { drink: 1.0, graze: 0.6, flock: 0.5, rest: 0.4, wallow: 0, roam: 0.5 };
  static driveRates = { hunger: 0.004, thirst: 0.009, fatigue: 0.003, loneliness: 0.005 };
  static intake = 0.4;

  constructor(name, breed, age) {
    super(name, breed, age);
    this.pondLapsPerDay = randomInt(5, 15);
  }

  makeSound() { return `${this.name} lets out a bright "Quack!"`; }
  move() { return `${this.name} waddles off toward the pond.`; }

  getAttributes() {
    return [...super.getAttributes(), { label: "Pond laps / day", value: this.pondLapsPerDay }];
  }
}
