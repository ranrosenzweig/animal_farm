import Animal from "../Animal.js";
import { randomInt } from "../random.js";

export default class Chicken extends Animal {
  static species = "Chicken";
  static emoji = "🐔";
  static color = "#C9922F";
  static diet = ["corn", "seeds", "mealworms"];
  static breeds = ["Rhode Island Red", "Leghorn", "Plymouth Rock", "Silkie"];
  static names = ["Henrietta", "Clucky", "Nugget", "Pecky", "Goldie"];

  constructor(name, breed, age) {
    super(name, breed, age);
    this.eggsPerWeek = randomInt(4, 7);
  }

  makeSound() { return `${this.name} lets out a sharp "Bawk bawk!"`; }
  move() { return `${this.name} scurries in a tight little circle.`; }

  dailyProduce() {
    return { label: "Eggs", amount: Math.round((this.eggsPerWeek / 7) * 10) / 10, unit: "" };
  }

  getAttributes() {
    return [...super.getAttributes(), { label: "Eggs / week", value: this.eggsPerWeek }];
  }
}
