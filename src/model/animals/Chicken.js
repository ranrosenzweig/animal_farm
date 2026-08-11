import Animal from "../Animal.js";
import { randomAngle, randomInt } from "../random.js";

export default class Chicken extends Animal {
  static species = "Chicken";
  static emoji = "🐔";
  static color = "#C9922F";
  static diet = ["corn", "seeds", "mealworms"];
  static breeds = ["Rhode Island Red", "Leghorn", "Plymouth Rock", "Silkie"];
  static names = ["Henrietta", "Clucky", "Nugget", "Pecky", "Goldie"];
  static stepSize = 5;   // short, quick scurries
  static radius = 4.5;

  constructor(name, breed, age) {
    super(name, breed, age);
    this.eggsPerWeek = randomInt(4, 7);
    this.turn = randomAngle();
  }

  makeSound() { return `${this.name} lets out a sharp "Bawk bawk!"`; }
  move() { return `${this.name} scurries in a tight little circle.`; }

  /** Turns hard on every step, so short hops trace a tight circle. */
  heading() {
    this.turn += 1.25;
    return this.turn;
  }

  dailyProduce() {
    return { label: "Eggs", amount: Math.round((this.eggsPerWeek / 7) * 10) / 10, unit: "" };
  }

  getAttributes() {
    return [...super.getAttributes(), { label: "Eggs / week", value: this.eggsPerWeek }];
  }
}
