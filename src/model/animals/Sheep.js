import Animal from "../Animal.js";
import { randomInt } from "../random.js";

export default class Sheep extends Animal {
  static species = "Sheep";
  static emoji = "🐑";
  static color = "#9B9481";
  static diet = ["grass", "oats", "alfalfa"];
  static breeds = ["Merino", "Suffolk", "Dorset", "Romney"];
  static names = ["Shirley", "Woolly", "Dolly", "Fleece", "Barbara"];
  static stepSize = 2.2;  // a shuffle
  static radius = 5;
  static turnRate = 0.3;

  // Feels being alone faster than it feels anything else.
  static affinities = { flock: 1.0, graze: 0.9, drink: 0.6, rest: 0.5, wallow: 0, roam: 0.3 };
  static driveRates = { hunger: 0.005, thirst: 0.005, fatigue: 0.003, loneliness: 0.010 };

  constructor(name, breed, age) {
    super(name, breed, age);
    this.woolPerYear = randomInt(3, 6);
  }

  makeSound() { return `${this.name} calls out a soft "Baaaa."`; }
  move() { return `${this.name} shuffles closer to the rest of the flock.`; }

  getAttributes() {
    return [...super.getAttributes(), { label: "Wool / year", value: `${this.woolPerYear} kg` }];
  }
}
