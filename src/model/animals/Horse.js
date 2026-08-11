import Animal from "../Animal.js";
import { randomInt } from "../random.js";

export default class Horse extends Animal {
  static species = "Horse";
  static emoji = "🐴";
  static color = "#5C3A22";
  static diet = ["oats", "apples", "carrots"];
  static breeds = ["Appaloosa", "Clydesdale", "Mustang", "Arabian"];
  static names = ["Comet", "Thunder", "Bella", "Apollo", "Storm"];

  constructor(name, breed, age) {
    super(name, breed, age);
    this.topSpeedKmh = randomInt(40, 70);
  }

  makeSound() { return `${this.name} gives a proud "Neigh!"`; }
  move() { return `${this.name} gallops the length of the fence line.`; }

  getAttributes() {
    return [...super.getAttributes(), { label: "Top speed", value: `${this.topSpeedKmh} km/h` }];
  }
}
