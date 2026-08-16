import Animal from "../Animal.js";
import { distance } from "../pasture.js";
import { ENOUGH, RESOURCE_KINDS, SAFE } from "../Resource.js";
import { clamp01 } from "../drives.js";
import { pick, randomInt } from "../random.js";

/**
 * What each kind of work takes, and what it looks like from the fence.
 *
 * Grass is cut and carted, water is piped: a man on foot with a bucket is not
 * how either job is actually done. Both live at the house and he can only have
 * one of them with him, which is the whole weight this carries — switching
 * from the troughs to the meadows means a trip home first, and that trip is
 * time the herd spends drinking whatever is left.
 */
const TOOLS = {
  grass: { name: "tractor", emoji: "🚜", takes: "hitches up the tractor", drives: "takes the tractor out to" },
  water: { name: "hose", emoji: "🚿", takes: "uncoils the hose", drives: "runs the hose out to" },
};

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
 * All of it comes out of the barn behind his house, which fills again slower
 * than he empties it — so he is a man with a store and a well, not a tap. He
 * lives in the yard below it: with nothing that needs doing he walks home,
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
  // Old MacDonald owns the place and `Farm.starter` names him directly. These
  // are the hands: one pair of them keeps a herd this size alive where one man
  // alone watches it dwindle, which is the whole argument for hiring. Kept by
  // sex, so a farm does not end up with a Maud who is drawn as a man.
  static hands = {
    female: ["Maud", "Etta", "Ruthie", "Nell", "Vera"],
    male: ["Hollis", "Jeb", "Cal", "Silas", "Amos"],
  };

  static names = [...Human.hands.female, ...Human.hands.male];
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

  /**
   * How far he will go out of his way for a dying animal. Not far, and that is
   * the point: a bucket saves the one beast in front of him, a filled trough
   * saves whoever comes to it all day, so the field work only loses to a
   * rescue he can make cheaply. With no limit he never fills anything again.
   */
  static reaches = 20;

  /** How much he pours in per step spent at a source, in that source's units. */
  static pours = 2.5;

  /**
   * How much of an animal's hunger or thirst one step of his attention takes
   * off it, 0–1. Half again what the animal would get for itself at a full
   * trough, because it is being handed to it and it is not queueing for it —
   * which is the whole reason he is standing there.
   */
  static eases = 0.09;

  /**
   * What the farmhouse and the barn behind it hold, in resource units — hay in
   * the loft, water in the well. Everything he puts on the field comes out of
   * here, and it is what he can carry rather than what he can wish for.
   */
  static stores = 1400;

  /**
   * What comes back into the barn each step: the well drawing, the hay coming
   * on. Well under what he pours out standing at a trough, so a big herd still
   * outdrinks him and a small one he can keep going indefinitely — which is
   * the whole difference between a farmer and a tap.
   */
  static yields = 0.25;

  /**
   * What he takes for himself each step — out of the same stores as the
   * buckets, because a farmhouse has a kitchen and a well. It is why he does
   * not queue at the trough behind six animals for the water he is carrying
   * them: a farmer who dies of thirst on the third dry day is a farm that
   * dies with him. An empty barn still starves him along with everyone else.
   */
  static provisions = 0.02;

  /**
   * How much stock one pair of hands can keep. Straight off the measurement:
   * over four farms of a dozen head, one man leaves seven, five, five and two
   * alive, two men leave nine to fifteen, and three leave eleven to twenty. A
   * hand to every four head is the far side of that curve, where the herd
   * grows instead of dwindling.
   */
  static perHand = 4;

  /**
   * Steps before the owner will change his mind about the payroll again. A
   * herd sitting on the boundary would otherwise have him taking a man on and
   * paying him off on alternate steps.
   */
  static settles = 400;

  /** The yard below the barn, which is where he lives and where he ends his day. */
  static home = { x: 85, y: 34 };

  constructor(name, breed, age) {
    super(name, breed, age);
    // Nothing raises it and nothing relieves it, so left as it starts it would
    // sit on his card forever as a bar that means nothing.
    this.drives.urge = 0;
    /** What is left of the barn's stores. His own, not the farm's. */
    this.stores = new.target.stores;
    /** How much he has put on the field since he started, by kind. */
    this.carried = { water: 0, grass: 0 };
    /** How many sources he has started from nothing. */
    this.sown = 0;
    /** How many animals he has gone out to with a bucket. */
    this.nursed = 0;
    /** Which one he is seeing to, so a rescue reads as one line. */
    this.nursing = null;
    /** Which source he is currently filling, so a new errand reads as one. */
    this.filling = null;
    /** The implement in his hands: "tractor", "hose", or nothing yet. */
    this.tool = null;
    /** True for the one whose farm it is. He hires, and he never leaves. */
    this.owns = false;
    /** Steps before he will change the payroll again. */
    this.settling = 0;
    /**
     * What he finished doing this step, for whoever is keeping the log — a
     * chore worth a line, not the pouring itself. Null on every step where he
     * only carried on with what he was already doing.
     * @type {{ act: string, source: Resource, notice: string } | null}
     */
    this.chore = null;
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
    this.chore = null;
    if (this.settling > 0) this.settling -= 1;
    const { yields, stores } = this.constructor;
    // Before the guard below, or a barn that ever reached empty would stay
    // empty however long the well ran.
    this.stores = Math.min(stores, this.stores + yields);

    const { provisions } = this.constructor;
    if (this.stores > 0) {
      this.stores -= provisions;
      this.drives.hunger = clamp01(this.drives.hunger - provisions);
      this.drives.thirst = clamp01(this.drives.thirst - provisions);
    }

    const { farm } = context;
    if (!farm || this.stores <= 0) return;

    // The implements live at the house and he can carry one. Swapping is the
    // only thing he can do about the wrong one being in his hands, and the
    // house is the only place he can do it.
    const wanted = TOOLS[this.wants(farm)]?.name ?? null;
    if (wanted && wanted !== this.tool && this.atHome()) {
      this.tool = wanted;
      const took = Object.values(TOOLS).find((t) => t.name === wanted);
      this.chore = { act: "took", source: null, notice: `${this.name} ${took.takes}.` };
    }

    // A kind gone from the field altogether, which is the one thing a bucket
    // cannot fix: he sows a fresh one where he stands. Where he stands, and not
    // some better-chosen ground across the field — every step of that walk is a
    // step the herd spends with nothing of that kind at all, and the field
    // opens with its sources already spread.
    const short = farm.stock().find((s) => s.sources === 0)?.kind;
    if (short && this.tool === TOOLS[short]?.name) {
      const volume = Math.min(this.stores, RESOURCE_KINDS[short].capacity * 0.3);
      const started = farm.sow(short, this, volume);
      if (started) {
        this.stores -= volume;
        this.carried[short] += volume;
        this.sown += 1;
        this.chore = {
          act: "sowed",
          source: started,
          notice: `${this.name} sows a fresh ${started.name.toLowerCase()} — ` +
            `the field had no ${short} left at all.`,
        };
      }
    }

    if (this.goal !== "tend") {
      // The errand is over when he stops tending — not when he drifts a step
      // out of reach, which he does constantly while milling about a trough,
      // and which used to have him announce the same job twice.
      this.filling = null;
      return;
    }
    // Who he is seeing to is settled before anything else, because it decides
    // where he is walking as well as what he does when he gets there.
    const patient = this.patientFor(farm);
    if (patient && patient.id !== this.nursing) {
      this.nursed += 1;
      this.chore = {
        act: "nursed",
        source: null,
        notice: `${this.name} drops everything for ${patient.name} the ` +
          `${patient.species.toLowerCase()}, down at ${Math.round(patient.health * 100)}% and going.`,
      };
    }
    this.nursing = patient?.id ?? null;

    // An animal, and close enough to hold a bucket under its nose. The farm
    // does the giving: what one animal owes another is not the giver's to
    // settle, and the farmer cannot read a cow's thirst in the first place.
    if (patient) {
      if (distance(this, patient) >= this.radius + patient.radius + 1) return;
      const helped = farm.nurse(patient, this.constructor.eases);
      if (helped) this.stores -= helped.given;
      return;
    }

    const source = this.goalPlace(context);
    if (!source?.refill || this.tool !== TOOLS[source.kind].name) return;
    if (distance(this, source) >= source.radius + this.radius) return;

    // An errand reads as two lines however many steps it takes: setting to work
    // on a source he was not filling a moment ago, and having it back above the
    // level that made it a chore. The dozen steps of pouring in between are the
    // same errand and say nothing new.
    const wanting = source.fullness < ENOUGH;
    if (this.filling !== source.id) {
      this.filling = source.id;
      this.chore = {
        act: "started",
        source,
        notice: `${this.name} ${TOOLS[source.kind].drives} ${source.name}, down to ` +
          `${Math.round(source.volume)} ${source.unit}.`,
      };
    }

    const got = source.refill(Math.min(this.stores, this.constructor.pours));
    this.stores -= got;
    this.carried[source.kind] += got;
    if (wanting && source.fullness >= ENOUGH) {
      this.filling = null;
      this.chore = {
        act: "topped",
        source,
        notice: `${this.name} has ${source.name} back up to ` +
          `${Math.round(source.volume)} ${source.unit}.`,
      };
    }
  }

  /**
   * The work in front of him, as a resource kind: whatever has run out of the
   * field altogether, and failing that the emptiest source left. Null when
   * everything is comfortable and there is nothing to fetch a tool for.
   */
  /**
   * The animal he is seeing to, and he sees one through before he looks up.
   *
   * Whoever he is already with keeps him until they are well clear of the
   * limit — not merely off it, or the moment a mouthful takes the edge off one
   * beast he would set out after the next and neither would get enough. He
   * only casts about for a new one when the one in front of him is safe.
   */
  patientFor(farm) {
    const { reaches } = this.constructor;
    // Same order as the steering: with a kind gone from the field he has
    // something to do that helps everyone, and no way to do it from out here.
    if (farm.stock().some((s) => s.sources === 0)) return null;
    const his = this.nursing && farm.find(this.nursing);
    const trouble = his && Math.max(his.drives.hunger, his.drives.thirst);
    if (his?.isAlive() && trouble > SAFE && distance(this, his) < reaches * 2) return his;
    return farm.neediestAnimal(this, reaches);
  }

  wants(farm) {
    const gone = farm.stock().find((s) => s.sources === 0)?.kind;
    if (gone) return gone;
    // He finishes the round he is equipped for before changing implements.
    // Without this he re-decides every step, and since one pour is enough to
    // make the *other* kind the emptiest, he spends his day walking between
    // the shed and nothing — thirteen swaps and five litres, when it was
    // measured. What he carries is what he works on until that work is done.
    const his = this.works;
    if (his && farm.neediestResource(ENOUGH, his)) return his;
    return farm.neediestResource()?.kind ?? null;
  }

  /**
   * Where the chore actually sends him. The goal names the emptiest source,
   * but a man holding a hose can do nothing at a meadow — so with the wrong
   * implement in his hands the first leg of the errand is the house, and only
   * then the field. Everything else steers as it does for any animal.
   */
  goalPlace(context = {}) {
    const { farm } = context;
    if (this.goal !== "tend" || !farm) return super.goalPlace(context);

    // A kind gone from the field outranks even a dying animal, and that is not
    // callousness — it is the only order that works. A rescue takes him away
    // from the house, he can only swap implements at the house, and he cannot
    // sow grass without the tractor: with the bucket first, a bare field kept
    // him permanently on rescues and the grass never came back at all, so the
    // dying never stopped. Grass for everyone beats a bucket for one.
    const kind = this.wants(farm);
    const bare = farm.stock().some((s) => s.sources === 0);

    // Otherwise, whoever he has taken on. A full trough is no use to an animal
    // dying beside it, and that is measurably how they die here — fifteen
    // deaths in a row with water in the field, some of them within a body's
    // length of it. No tractor needed to hold a bucket.
    const patient = !bare && this.nursing && farm.find(this.nursing);
    if (patient) return patient;
    if (!kind) return null;
    if (TOOLS[kind].name !== this.tool) return this.constructor.home;
    // Otherwise the emptiest of the sort he is carrying the implement for.
    // Not the emptiest on the farm — the other sort is a different errand.
    return farm.neediestResource(ENOUGH, kind);
  }

  /**
   * A farmer gets out of bed for a dying animal.
   *
   * Everything on this farm wants to sleep at night — the hour cubes every
   * want but resting, which is what keeps the herd down through the dark. It
   * is also what had him asleep through half of every emergency: measured, an
   * animal was pinned at a fatal drive on 891 steps of a run and he was in his
   * bed for 430 of them. So the chores answer at full pressure while somebody
   * is actually going, and at the ordinary standing pressure otherwise.
   *
   * Narrow on purpose. It reads the farm's own list of the dying rather than
   * amplifying a drive of his own, and it moves nothing for any other animal:
   * the herd sleeps through the night exactly as it did.
   */
  pressureFor(goalName, context = {}) {
    if (goalName === "tend" && context.farm?.neediestAnimal(this, this.constructor.reaches)) return 1;
    return super.pressureFor(goalName, context);
  }

  /**
   * How many men this herd wants, the owner's own arithmetic. He counts stock
   * rather than chores because that is what he can see from the gate, and a
   * hand is hired for a season rather than for an afternoon.
   */
  wantedHands(farm) {
    const head = farm.animals.filter((a) => !(a instanceof Human) && a.isAlive()).length;
    return Math.max(1, Math.ceil(head / this.constructor.perHand));
  }

  /** With nothing that needs doing, he heads back to the house. */
  roamHeading() { return this.headingToward(this.constructor.home); }

  /** Standing in his own yard, near enough to call it home. */
  atHome() { return distance(this, this.constructor.home) < this.radius * 2; }

  /**
   * Resting is somewhere, for him. Every animal here rests where it happens to
   * be standing — `rest` names no place, so a tired cow folds up in the mud —
   * but a farmer goes indoors. He is only still once he is home, and until then
   * `rest` steers him there the same way having nothing to do does: the goal
   * names no place, so it falls through to `roamHeading`, which is the path to
   * his door. Then he is in for the night, because the hour keeps rest winning
   * until morning.
   */
  isStill() { return super.isStill() && this.atHome(); }

  makeSound() { return `${this.name} whistles a tune — E-I-E-I-O.`; }
  move() { return `${this.name} walks the fence line, counting heads.`; }

  /**
   * What is drawn on the field: whatever he is driving if he is driving
   * something, and otherwise the farmer himself. Both farmer glyphs are ZWJ
   * sequences and both were checked against the system font — unlike the
   * person farmer, which comes apart into a face and a plant.
   */
  get emoji() {
    if (this.tool) return TOOLS[this.works].emoji;
    return this.sex === "female" ? "👩‍🌾" : super.emoji;
  }

  /** No legs on a tractor. The UI draws none and stops cropping the glyph. */
  get legs() { return this.tool ? 0 : super.legs; }

  /** The kind of work the implement in his hands is for. */
  get works() { return Object.keys(TOOLS).find((kind) => TOOLS[kind].name === this.tool); }

  /** He eats from the same fields he keeps; "crops at the grass" he does not. */
  narrate() {
    if (this.goal === "graze") return `${this.name} takes his own dinner from the field.`;
    if (this.goal === "tend" && this.tool) {
      return `${this.name} is out with the ${this.tool}.`;
    }
    return super.narrate();
  }

  /** A hired hand. The owner is built by name in `Farm.starter`, not here. */
  static random() {
    const sex = pick(["female", "male"]);
    const hand = new this(pick(this.hands[sex]), "Farmhand", randomInt(19, 60));
    hand.sex = sex;
    return hand;
  }

  getAttributes() {
    return [
      ...super.getAttributes(),
      { label: "In the barn", value: `${Math.round(this.stores)} left to put down` },
      {
        label: "In his hands",
        value: this.tool ? `${TOOLS[this.works].emoji} ${this.tool}` : "nothing — both are at the house",
      },
    ];
  }
}
