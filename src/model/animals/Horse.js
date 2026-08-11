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
  static stepSize = 20;  // covers ground at a gallop
  static radius = 5.5;

  constructor(name, breed, age) {
    super(name, breed, age);
    this.topSpeedKmh = randomInt(40, 70);
    this.direction = pick([1, -1]);
  }

  makeSound() { return `${this.name} gives a proud "Neigh!"`; }
  move() { return `${this.name} gallops the length of the fence line.`; }

  /** Runs the length of the field and turns around at either end. */
  heading() {
    if (this.x >= PASTURE.maxX - this.stepSize) this.direction = -1;
    else if (this.x <= PASTURE.minX + this.stepSize) this.direction = 1;
    return this.direction === 1 ? 0 : Math.PI;
  }

  getAttributes() {
    return [...super.getAttributes(), { label: "Top speed", value: `${this.topSpeedKmh} km/h` }];
  }
}
