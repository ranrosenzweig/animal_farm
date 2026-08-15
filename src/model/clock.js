/**
 * What time it is on the farm.
 *
 * The farm counts steps and nothing else; this turns a step count into an hour
 * of a day and a day of a year, and says what that costs an animal. One step
 * is a quarter of an hour, so a day is 96 steps — long enough that a mind
 * deliberating every dozen steps still changes its mind a few times between
 * dawn and dusk.
 *
 * The sun is the real spherical formula at a temperate latitude, which is what
 * makes a winter day short and a summer one long without either being written
 * down separately.
 *
 * ponytail: a year is 35,040 steps, so at the UI's ordinary pace a day passes
 * in a minute and a year takes hours. Days are what you watch; seasons are for
 * long runs. Shorten DAYS_PER_YEAR if you want to see one turn.
 */
export const STEPS_PER_HOUR = 4;
export const STEPS_PER_DAY = 24 * STEPS_PER_HOUR;
export const DAYS_PER_YEAR = 365;
export const STEPS_PER_YEAR = STEPS_PER_DAY * DAYS_PER_YEAR;

/** ~50°N. Far enough from the equator that the seasons are worth having. */
const LATITUDE = 0.87;

/**
 * How much of the clock one round of the farm advances, in quarter hours: a
 * day takes 96 rounds unless the farmer says otherwise. Winding it up is how
 * you watch a season turn instead of a morning.
 *
 * It scales what happens next, not what has already happened, so moving it
 * mid-run does not shift the date under a farm that has been going a while.
 *
 * What it does *not* scale is the animals: a drive climbs by its own rate per
 * round, whatever the clock says a round was worth. Winding the day down is
 * therefore a knob on the sky, not on the farm — the sun tears round and the
 * herd goes on living at the pace it always did. Two things that are measured
 * in clock time rather than rounds, the milk in the pail and the rain in the
 * troughs, are multiplied by this so they keep meaning what they say.
 *
 * Below about 48 rounds to a day the whole night fits inside one turn of a
 * mind's cadence and a herd starts sleeping through days at random; below
 * about 16 a round is longer than dawn, so the sky jumps from night to day
 * without passing through either. Both are watchable — neither is a farm to
 * draw conclusions from.
 */
let perRound = 1;

/** Quarter hours per round — what the farm adds to its clock each step. */
export const clockStep = () => perRound;

export const roundsPerDay = () => STEPS_PER_DAY / perRound;

export const setRoundsPerDay = (rounds) => { perRound = STEPS_PER_DAY / rounds; };

/** A farm opens on a spring morning, not at midnight in January. */
export const OPENING = 100 * STEPS_PER_DAY + 8 * STEPS_PER_HOUR;

export const SEASONS = ["winter", "spring", "summer", "autumn"];

/** How often it comes on to rain, by season. Summer is the dry one. */
const WETNESS = { winter: 0.5, spring: 0.55, summer: 0.18, autumn: 0.6 };

/** Mean temperature over the year, and how far the sun swings it in a day. */
const MEAN_C = 11;
const YEARLY_SWING = 13;
const DAILY_SWING = 7;

/**
 * A number in 0–1 that is the same every time that day comes round. The
 * weather has to be settled from the step count alone — a Farm is rebuilt
 * every round and would forget anything it tried to remember.
 */
function noise(n) {
  let t = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  t ^= t >>> 13;
  return ((t >>> 0) % 1000) / 1000;
}

/** How far the sun is tilted north or south on a given day, in radians. */
const declination = (dayOfYear) => 0.409 * Math.sin((2 * Math.PI * (dayOfYear - 80)) / 365);

/** Meteorological seasons: winter starts in December, so the year is offset. */
const seasonOf = (dayOfYear) => SEASONS[Math.floor((((dayOfYear + 31) % 365) / 365) * 4)];

/** An hour of the day as a clock reads it. */
export const hhmm = (hour) =>
  `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")}`;

/**
 * The whole time of day and year, from a step count.
 *
 * `sun` is the sine of the sun's elevation: 1 straight overhead, 0 on the
 * horizon, negative below it. Everything else about the light — whether it is
 * day, when the sun came up, how dark to draw the field — falls out of it.
 *
 * @returns {{ day: number, dayOfYear: number, year: number, hour: number,
 *   time: string, sun: number, daylight: boolean, phase: "night"|"dawn"|"day"|"dusk",
 *   sunrise: number, sunset: number, season: string, weather: string }}
 */
export function clockAt(steps = 0) {
  const days = Math.floor(steps / STEPS_PER_DAY);
  const dayOfYear = days % DAYS_PER_YEAR;
  const hour = (steps % STEPS_PER_DAY) / STEPS_PER_HOUR;

  const tilt = declination(dayOfYear);
  /** The sine of the sun's elevation at a given hour of this day. */
  const elevation = (at) =>
    Math.sin(LATITUDE) * Math.sin(tilt) +
    Math.cos(LATITUDE) * Math.cos(tilt) * Math.cos((Math.PI * (at - 12)) / 12);
  const sun = elevation(hour);

  // Half the length of the day, from where the sun's track crosses the
  // horizon. Clamped, so a latitude that never sees the sun rise (or set)
  // gives a day of no hours (or every hour) instead of NaN.
  const half =
    (12 / Math.PI) * Math.acos(Math.min(1, Math.max(-1, -Math.tan(LATITUDE) * Math.tan(tilt))));

  const season = seasonOf(dayOfYear);

  // Cold in January, warm in July, and a good few degrees colder at night
  // than at noon — the sun's own elevation carries that swing. The ground
  // takes a couple of hours to catch up with the sun, which is why the warmest
  // part of the day is mid-afternoon and not noon; without the lag a morning
  // and an evening of the same height come out at exactly the same reading.
  const tempC =
    MEAN_C +
    YEARLY_SWING * Math.sin((2 * Math.PI * (dayOfYear - 110)) / 365) +
    DAILY_SWING * elevation(hour - 2.5);

  // Whether this is a wet day is settled for the whole day; when the shower
  // comes through, and how hard, is settled with it. Falls to nothing either
  // side of its peak, so a wet day is a few wet hours rather than a flat grey.
  const wet = noise(dayOfYear) < WETNESS[season];
  const peak = 2 + noise(dayOfYear + 977) * 20;
  const strength = 0.35 + noise(dayOfYear + 313) * 0.65;
  const precipitation = wet ? strength * Math.max(0, 1 - Math.abs(hour - peak) / 3.5) : 0;

  return {
    steps,
    day: days + 1,
    dayOfYear,
    year: Math.floor(days / DAYS_PER_YEAR) + 1,
    hour,
    time: hhmm(hour),
    sun,
    daylight: sun > 0,
    phase: sun > 0.12 ? "day" : sun < -0.12 ? "night" : hour < 12 ? "dawn" : "dusk",
    sunrise: 12 - half,
    sunset: 12 + half,
    daylength: 2 * half,
    season,
    tempC,
    precipitation,
    /** What is coming out of the sky: below freezing it comes down as snow. */
    sky: precipitation < 0.05 ? "clear" : tempC <= 0 ? "snow" : "rain",
  };
}

/** Is it this animal's half of the day? Most of the farm keeps to the light. */
export const awake = (clock, nocturnal = false) =>
  !clock || (nocturnal ? !clock.daylight : clock.daylight);

/** What a sleeping animal's rest is worth, however rested it already is. */
const DOZE = 0.85;

/**
 * What a want is worth to an animal at this hour, 0–1.
 *
 * Awake, a want is worth exactly what it is. Asleep, resting is worth more
 * than whatever the animal happens to feel — that is what keeps a herd down
 * through the night — and every other want is cubed, so only one near its
 * limit gets an animal back on its feet. A parched cow still gets up; a
 * peckish one waits for morning.
 */
export const urgency = (pressure, relieves, clock, nocturnal = false) => {
  if (awake(clock, nocturnal)) return pressure;
  return relieves === "fatigue" ? Math.max(pressure, DOZE) : pressure ** 3;
};

/** Everything ticks over slower in an animal's own night. */
const ASLEEP = 0.5;

const between = (low, high, n) => Math.min(high, Math.max(low, n));

/**
 * What the time of year is worth to whatever an animal makes.
 *
 * Milk and eggs follow the light — a hen in a dark December lays a fraction of
 * what she lays in June — so the length of the day is the whole of it. A bit
 * over two to one across the year, which is about what a farm sees.
 */
export const productivity = (clock) => (clock ? between(0.55, 1.25, clock.daylength / 12) : 1);

/**
 * What the weather and the hour do to how fast a drive climbs.
 *
 * All three come off the same two numbers the farmer can read on the clock:
 * cold makes an animal hungry, heat makes it thirsty, and lengthening days
 * are what put it in mind of breeding. Everything slows while it sleeps,
 * which is what lets a herd sleep through a night without waking starved.
 */
export function metabolism(drive, clock, nocturnal = false) {
  if (!clock) return 1;
  const pace =
    drive === "hunger" ? between(0.7, 1.5, 1 + (MEAN_C - clock.tempC) / 24)
    : drive === "thirst" ? between(0.6, 1.6, 1 + (clock.tempC - MEAN_C) / 24)
    : drive === "urge" ? between(0.5, 1.5, clock.daylength / 12)
    : 1;
  return awake(clock, nocturnal) ? pace : pace * ASLEEP;
}
