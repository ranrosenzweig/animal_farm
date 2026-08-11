import Animal from "../Animal.js";
import { pick, randomInt } from "../random.js";
import { PASTURE } from "../pasture.js";

export default class Horse extends Animal {
  static species = "Horse";
  static emoji = "🐴";
  static color = "#5C3A22";
  static diet = ["oats", "apples", "carrots"];
  static breeds = ["Appaloosa", "Clydesdale", "Mustang", "Arabian"];
  static names = ["Comet", "Thunder", "Bella", "Apollo", "Storm"];
  static stepSize = 6;    // covers ground at a gallop — still the fastest thing here
  static radius = 5.5;
  static turnRate = 0.3;  // committed to its line; comes about in a wide arc

  // Would rather be running than doing anything else.
  static affinities = { roam: 1.0, graze: 0.7, drink: 0.6, rest: 0.4, flock: 0.3, wallow: 0, mate: 0.6 };
  static driveRates = { hunger: 0.005, thirst: 0.006, fatigue: 0.006, loneliness: 0.004, urge: 0.003 };
  static intake = 0.9;

  constructor(name, breed, age) {
    super(name, breed, age);
    this.topSpeedKmh = randomInt(40, 70);
    this.direction = pick([1, -1]);
  }

  makeSound() { return `${this.name} gives a proud "Neigh!"`; }
  move() { return `${this.name} gallops the length of the fence line.`; }

  /**
   * With nowhere it needs to be, it runs the length of the field. It cannot
   * spin on the spot, so it begins to come about a full turning circle before
   * the end — otherwise it would arrive at the fence still pointed at it.
   */
  roamHeading() {
    if (this.x >= PASTURE.maxX - this.turningCircle) this.direction = -1;
    else if (this.x <= PASTURE.minX + this.turningCircle) this.direction = 1;
    return this.direction === 1 ? 0 : Math.PI;
  }

  getAttributes() {
    return [...super.getAttributes(), { label: "Top speed", value: `${this.topSpeedKmh} km/h` }];
  }
}
