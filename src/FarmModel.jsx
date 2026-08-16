import { useEffect, useMemo, useRef, useState } from "react";
import Farm from "./model/Farm.js";
import { Human, SPECIES, speciesNamed } from "./model/species.js";
import { centroid, clampToPasture } from "./model/pasture.js";
import { PATCHES, RELIEF } from "./model/terrain.js";
import { STOPPED } from "./model/physics.js";
import { DRIVES, DRIVE_LABELS } from "./model/drives.js";
import {
  RESOURCE_KINDS, RESOURCE_NAMES, heldLevels, setHeldLevels, setStockFloor, stockFloor,
} from "./model/Resource.js";
import {
  DAYS_PER_YEAR, STEPS_PER_DAY, STEPS_PER_HOUR, clockAt, hhmm, roundsPerDay, setRoundsPerDay,
} from "./model/clock.js";
import ScriptedMind from "./model/minds/ScriptedMind.js";
import ClaudeMind from "./model/minds/ClaudeMind.js";
import { sourceOf } from "./sources.js";
import "./farm.css";

/**
 * How far up each glyph its own legs reach, in em of the sprite's type.
 *
 * Emoji animals come with legs already drawn, so a second set painted under
 * them is legs on top of legs however it is placed — that is not a positioning
 * problem, it is one pair too many. So the glyph is cut off at this line and
 * the walking legs are drawn in the gap: what moves is the animal's own legs,
 * in the place its own legs were.
 *
 * Calibrated by eye against the system emoji font, which is the only place
 * these glyphs exist. Another font draws them differently and these would want
 * re-checking — which is what a per-species number is for.
 */
const LEG_LINE = {
  Cow: 0.3, Horse: 0.3, Sheep: 0.24, Pig: 0.22, Chicken: 0.28, Duck: 0.2, Human: 0.32,
};

/** How each goal reads on screen. Presentation only — the model has no icons. */
const GOAL_ICONS = {
  graze: "🌿", drink: "💧", wallow: "🫧", flock: "👥", rest: "😴", roam: "🚶", mate: "❤️", tend: "🧰",
};

const SEX_MARKS = { female: "♀", male: "♂" };

/** How the hour and the weather read on screen. Presentation only. */
const PHASE_MARKS = { dawn: "🌅", day: "🌞", dusk: "🌇", night: "🌙" };
const SKY_MARKS = { rain: "🌧", snow: "❄️", clear: "☀️" };

const RESOURCE_ICONS = { water: "💧", grass: "🌿" };

/**
 * The field is drawn as ground tilting away from the viewer. Depth is the
 * model's own y: the far edge of the field is narrower than the near one, and
 * an animal standing back there is drawn smaller and hazier.
 *
 * This is presentation only — src/model still deals in a flat 100×100 field
 * and knows nothing about a camera. One projection is applied on the way to
 * the screen, and undone on the way back when the farmer clicks.
 *
 * Depth is linear rather than the reciprocal a real lens gives. A lens would
 * crowd the far rows together, but it would also make unproject() a division
 * by something that goes to zero at the horizon; linear stays honestly
 * invertible, and the width and size cues carry the depth on their own.
 */
const HORIZON = 12;
/** Width of the far edge of the field, as a fraction of the near edge. */
const FAR_WIDTH = 0.78;
/** Size of a sprite standing at the far edge, as a fraction of one at the near edge. */
const FAR_SCALE = 0.6;

/** 0 at the horizon, 1 at the near edge. */
const depthAt = (y) => (y - HORIZON) / (100 - HORIZON);

/** How much of the field's full width is left at depth `y`. */
const widthAt = (y) => FAR_WIDTH + (1 - FAR_WIDTH) * depthAt(y);

/** How big something standing or lying at depth `y` is drawn. */
const sizeAt = (y) => FAR_SCALE + (1 - FAR_SCALE) * depthAt(y);

/** A spot on the ground, as the screen has it. */
const project = ({ x, y }) => ({ x: 50 + (x - 50) * widthAt(y), y });

/** A spot on the screen, as the ground has it. The exact inverse of project. */
const unproject = ({ x, y }) => ({ x: 50 + (x - 50) / widthAt(y), y });

/**
 * Everything the screen needs to stand something on the ground at `spot`:
 * where it goes, how big it is there, how much the distance washes it out,
 * and who it is in front of.
 */
function standing(spot) {
  return {
    left: `${project(spot).x}%`,
    top: `${spot.y}%`,
    "--depth-scale": sizeAt(spot.y),
    "--haze": 0.7 + 0.3 * depthAt(spot.y),
    // Which way it is pointed, for anything that has a facing. Every animal
    // glyph is drawn looking left, so one heading east has to be turned about
    // or it walks backwards across the field — which is what it looked like.
    "--face": spot.facing !== undefined && Math.cos(spot.facing) > 0 ? -1 : 1,
    // Nearer animals occlude further ones. The fence sits above the lot.
    zIndex: Math.round(spot.y * 10),
  };
}

/** The trapezoid the ground fills, in the ground layer's own box. */
/**
 * Where the sun — or, once it is down, the moon — hangs in the strip of sky
 * above the horizon. It walks left to right across the hours it is up, and
 * rides highest halfway through them, so a short winter day is a low arc and
 * a long summer one climbs.
 */
function skyBody({ hour, sunrise, sunset, daylength, daylight }) {
  const through = daylight
    ? (hour - sunrise) / daylength
    : ((hour - sunset + 24) % 24) / (24 - daylength);
  return {
    left: `${8 + through * 84}%`,
    top: `${HORIZON - Math.sin(Math.PI * through) * (HORIZON - 1)}%`,
  };
}

const GROUND_CLIP = `polygon(${project({ x: 0, y: HORIZON }).x}% 0, ` +
  `${project({ x: 100, y: HORIZON }).x}% 0, 100% 100%, 0 100%)`;

/**
 * The barn and the trunks — read off the terrain rather than placed by eye, so
 * what stands on screen is what the animals bump into. Both are solid patches;
 * the woodland they stand on is not.
 */
const BARN = PATCHES.find((patch) => patch.ground === "barn");

const TREES = PATCHES.filter((patch) => patch.ground === "tree")
  .map((patch, t) => ({ key: `tree-${t}`, x: patch.x, y: patch.y }));

/**
 * The lie of the land, drawn from the very numbers the animals walk on.
 *
 * Every hill here is one of `RELIEF`'s bumps and every patch one of `PATCHES`,
 * at the same place and the same size — so this is not a picture of a field
 * that resembles the model, it is the model, shaded. A rock you can see is a
 * rock an animal bounces off, and the pale shoulder of a rise is the ground a
 * cow will labour up.
 *
 * Each piece is laid down as a `fa-feature`, the same way a pond is: projected
 * across, and foreshortened by the same 3:1 the ponds use. That matters more
 * than it sounds. If the terrain were drawn flat while the herd was drawn in
 * perspective, the rock on screen would not be where the rock in the model is,
 * and every claim this makes would be a lie.
 */
function PastureTerrain() {
  return (
    <>
      {RELIEF.map((bump, i) => (
        <div
          key={`relief-${i}`}
          className={`fa-feature fa-relief ${bump.height > 0 ? "rise" : "hollow"}`}
          aria-hidden="true"
          style={{
            left: `${project(bump).x}%`,
            top: `${bump.y}%`,
            width: `${bump.spread * 2.2 * sizeAt(bump.y)}%`,
            opacity: Math.min(0.8, Math.abs(bump.height) * 1.5),
          }}
        />
      ))}
      {PATCHES.map((patch, i) => (
        <div
          key={`patch-${i}`}
          className={`fa-feature fa-ground-${patch.ground}`}
          aria-hidden="true"
          style={{
            left: `${project(patch).x}%`,
            top: `${patch.y}%`,
            width: `${patch.radius * 2 * sizeAt(patch.y)}%`,
          }}
        />
      ))}
    </>
  );
}

/**
 * How long one step takes, until the farmer says otherwise. The sprite's CSS
 * transition is driven from this same number, so an animal is still gliding
 * into its last spot exactly as the next step is decided — the walk looks
 * continuous instead of a dart followed by a wait.
 */
const STEP_MS = 600;

/** The range the settings slider offers, either side of STEP_MS. */
const STEP_MIN = 150;
const STEP_MAX = 1500;

/**
 * The minds the farmer can put behind an animal. Both take a cadence, so the
 * settings section can hand one straight to whichever is picked.
 */
const MINDS = {
  scripted: { label: "Scripted", Mind: ScriptedMind },
  claude: { label: "Claude", Mind: ClaudeMind },
};

/**
 * The two views of the farm. The field is the point of the page, so it opens
 * on that; the dials and the day's record are a step away rather than a column
 * stealing half the width from the pasture.
 */
const TABS = [
  { id: "pasture", label: "Pasture" },
  { id: "stats", label: "Statistics" },
  { id: "desk", label: "Settings & log" },
];

/**
 * The chart palette: six categorical slots, handed to species in registry
 * order and never by rank, so a species keeps its colour whatever the herd
 * does to its share of the bar.
 *
 * These are deliberately *not* the species' own accent colours. Those are two
 * browns, a grey and a pink — as a set they fail colour-blind separation
 * outright (worst adjacent pair ΔE 9.3 against a floor of 15, and half of them
 * read as grey), which is fine for a dot beside a name and useless for
 * segments stacked against each other. The emoji in the legend is what ties a
 * band of colour back to its pen.
 */
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
const COLOR_OF = new Map(SPECIES.map((Species, i) => [Species.species, SERIES[i % SERIES.length]]));

/** Chart chrome. Recessive by design: the data is the only loud thing. */
const INK = { grid: "#e6e2d4", axis: "#c9c2ac", muted: "#8a8271" };

/** How many days of the farm's own history the statistics keep. */
const RECORDED = 60;

/**
 * A duration in milliseconds, read as seconds. Rounded to a whole second once
 * there are several of them, and to a tenth below that — "1s" would be the
 * same reading across a fourfold change at the fast end of the day slider.
 */
const seconds = (ms) => (ms >= 10000 ? Math.round(ms / 1000) : Math.round(ms / 100) / 10);

/** How many log lines are kept, whatever the settings choose to show. */
const LOG_KEPT = 50;
const LOG_SHOWN = [8, 20, 50];

/**
 * How empty a source has to get before the farmer is told about it. A quarter
 * left is far enough ahead to walk over and top it up before anyone goes
 * thirsty; the settings slider moves it either way.
 */
const LOW_AT = 0.25;

/**
 * How far one arrow key slides the drop point, in pasture percent. Big enough
 * to cross the field in a dozen presses, small enough to drop a trough beside
 * one animal rather than on top of the herd.
 */
const NUDGE = 5;

const NUDGE_KEYS = {
  ArrowUp: { x: 0, y: -NUDGE },
  ArrowDown: { x: 0, y: NUDGE },
  ArrowLeft: { x: -NUDGE, y: 0 },
  ArrowRight: { x: NUDGE, y: 0 },
};

/**
 * How a settled dispute reads in the log. Whether the two of them already
 * knew each other is the whole point of the encounter, so the line says so:
 * familiar animals stand aside, strangers have to back down.
 */
function contestNotice({ winner, loser, source }) {
  const verb = loser.familiarity(winner) > 0.5 ? "stands aside for" : "backs down from";
  return `${loser.name} ${verb} ${winner.name} at the ${source.name.toLowerCase()}.`;
}

/** Calm when a drive is low, urgent when it is high. Condition passes 1 - health. */
function driveColor(level) {
  if (level < 0.4) return "#6f9451";
  if (level < 0.75) return "#C9922F";
  return "#a13c2c";
}

/**
 * A live view of the farm model. Every piece of information on screen is
 * read off the model — the head counts, the attribute card, the daily
 * yield and the source panel all come from the classes in src/model.
 */
/**
 * A column chart, one column per record, each column a stack of segments.
 *
 * Plain elements rather than SVG: a flex row gets the 2px gap between columns
 * and between stacked segments exactly right at any width, which is the one
 * piece of chart anatomy that has to be pixels rather than a share of the box.
 *
 * The gap comes off at hairline density — a year of days is 365 columns, and
 * 2px between each of them is wider than the chart. Bars that thin read as a
 * dense histogram, where the separation the gap buys is not on offer anyway.
 *
 * @param {{ rows: { key: string, title: string, parts: { key: string, value: number, color: string }[] }[] }} props
 */
function Columns({ rows, max, height = 88, gap = 2, label, empty = "nothing recorded yet" }) {
  if (rows.length === 0) return <div className="fa-chart-empty" style={{ height }}>{empty}</div>;
  const ceiling = max > 0 ? max : 1;
  return (
    // One label for the whole chart rather than 365 tab stops: the numbers a
    // reader actually needs are beside it in text either way.
    <div className="fa-cols" style={{ height, gap }} role="img" aria-label={label}>
      {rows.map((row) => (
        <div className="col" key={row.key} title={row.title}>
          {row.parts.map((part) => (
            <span
              key={part.key}
              style={{
                height: `${Math.max(part.value > 0 ? 1.5 : 0, (part.value / ceiling) * 100)}%`,
                background: part.color,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * One line over a stretch of days, with the area under it washed in. Drawn in
 * day units and stretched to the box, so the stroke is pinned to real pixels
 * with `non-scaling-stroke` rather than being squashed with the geometry.
 */
function Trace({ points, low, high, color, height = 88, zero = null }) {
  const span = high - low || 1;
  const at = (value) => ((high - value) / span) * 100;
  const line = points.map((p, i) => `${i},${at(p)}`).join(" ");
  return (
    <svg
      className="fa-trace"
      style={{ height }}
      viewBox={`0 0 ${points.length - 1} 100`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon fill={color} fillOpacity="0.13" points={`0,100 ${line} ${points.length - 1},100`} />
      {zero != null && zero > low && zero < high && (
        <line
          x1="0" x2={points.length - 1} y1={at(zero)} y2={at(zero)}
          stroke={INK.axis} strokeWidth="1" vectorEffect="non-scaling-stroke"
        />
      )}
      <polyline
        fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round"
        vectorEffect="non-scaling-stroke" points={line}
      />
    </svg>
  );
}

/**
 * A row of season labels under a chart that spans the whole year, each as wide
 * as its season is long. Built by walking the year rather than from a list of
 * four, because the year opens in January and so begins and ends in the same
 * winter — five bands, not four.
 */
function SeasonAxis({ year }) {
  const bands = [];
  for (const day of year) {
    const last = bands[bands.length - 1];
    if (last && last.season === day.season) last.days += 1;
    else bands.push({ season: day.season, days: 1 });
  }
  return (
    <div className="fa-seasons">
      {bands.map((band, i) => (
        <span key={i} style={{ flex: band.days }}>{band.days > 40 ? band.season : ""}</span>
      ))}
    </div>
  );
}

export default function FarmModel() {
  const [farm, setFarm] = useState(() => Farm.starter("The Farm Registry"));
  const [selectedId, setSelectedId] = useState(() => null);
  const [log, setLog] = useState([{ id: "start", text: "The farm registry opens for the day.", kind: "info" }]);
  const [speakingId, setSpeakingId] = useState(null);
  const [showSource, setShowSource] = useState(false);
  const [roaming, setRoaming] = useState(false);
  const [tab, setTab] = useState(TABS[0].id);
  /** Whether the drawer of chores above the field is open. Shut on arrival. */
  const [chores, setChores] = useState(false);
  /** Which kind of resource the next pasture click puts down, if any. */
  const [placing, setPlacing] = useState(null);
  /** Where the keys would drop it, in pasture percent. Null when nothing is armed. */
  const [dropAt, setDropAt] = useState(null);

  /* Settings. Every one of these is a live knob: nothing here is read once. */
  const [stepMs, setStepMs] = useState(STEP_MS);
  /** How many rounds a day takes. Lives in the clock; held here to render it. */
  const [dayRounds, setDayRounds] = useState(roundsPerDay);
  const [mindKind, setMindKind] = useState("scripted");
  const [cadence, setCadence] = useState(ScriptedMind.cadence);
  const [showTags, setShowTags] = useState(true);
  const [calm, setCalm] = useState(false);
  const [logLines, setLogLines] = useState(LOG_SHOWN[0]);
  const [logSpecies, setLogSpecies] = useState("all");
  const [logKind, setLogKind] = useState("all");
  const [lowAt, setLowAt] = useState(LOW_AT);
  /** Never let a source fall below this share of capacity. 0 is off. */
  const [keepAt, setKeepAt] = useState(() => Math.round(stockFloor() * 100));
  /** Whether the levels are pinned where they stand. Lives in the model. */
  const [held, setHeld] = useState(heldLevels);

  const selected = farm.find(selectedId) ?? farm.animals[0];
  const companions = selected ? farm.companionsOf(selected) : [];
  const census = farm.census();
  const produce = farm.dailyProduce();
  const activity = farm.activity();
  const stock = farm.stock();
  const clock = farm.clock;
  /** How much night to wash over the field, and how much horizon glow. */
  const nightfall = Math.min(0.72, Math.max(0, (0.12 - clock.sun) * 1.4));
  const afterglow = Math.max(0, 1 - Math.abs(clock.sun) / 0.25) * 0.55;
  /** Sources far enough down to be worth mentioning, and which kinds they are. */
  const lowSources = farm.resources.filter((r) => !r.depleted && r.fullness < lowAt);
  const lowKinds = new Set(lowSources.map((r) => r.kind));
  /** Red when a kind has run out, amber while any source of it is low. */
  const stockColor = (s) => (s.volume === 0
    ? "#a13c2c"
    : lowKinds.has(s.kind) ? "#8a5a12" : undefined);
  const expecting = farm.animals.filter((a) => a.isPregnant).length;

  /**
   * The weather of a whole year, a day at a time. It is worked out rather than
   * remembered — the clock answers for any day without the farm having lived
   * it — so this runs once and never again.
   */
  const year = useMemo(() => {
    const days = [];
    for (let day = 0; day < DAYS_PER_YEAR; day++) {
      let warmth = 0;
      let wettest = 0;
      let wetHours = 0;
      let sky = "clear";
      for (let hour = 0; hour < 24; hour++) {
        const at = clockAt(day * STEPS_PER_DAY + hour * STEPS_PER_HOUR);
        warmth += at.tempC;
        if (at.precipitation >= 0.05) {
          wetHours += 1;
          if (at.precipitation > wettest) {
            wettest = at.precipitation;
            sky = at.sky;
          }
        }
        if (hour === 12) days.push({ day, season: at.season, daylength: at.daylength });
      }
      Object.assign(days[days.length - 1], {
        tempC: warmth / 24, wetHours, wettest, sky,
      });
    }
    return days;
  }, []);

  /**
   * What the farm looked like at the turn of each day. The weather can be
   * recomputed from the clock at any time; a head count cannot — it only
   * exists because this farm lived that day, so it has to be written down as
   * it happens.
   */
  const history = useRef([]);
  useEffect(() => {
    const day = farm.clock.day;
    const last = history.current[history.current.length - 1];
    if (last && last.day === day) return;
    history.current = [
      ...history.current.slice(1 - RECORDED),
      {
        day,
        season: farm.clock.season,
        counts: Object.fromEntries(farm.census().map((pen) => [pen.species, pen.count])),
        head: farm.size,
        stock: Object.fromEntries(farm.stock().map((s) => [s.kind, s.volume])),
        // A running total rather than the day's own figure: what he put down on
        // any one day is the step up from the day before, and a total survives
        // a farmer who dies and a day nobody watched.
        carried: { ...(farm.animals.find((a) => a instanceof Human)?.carried ?? {}) },
      },
    ];
  }, [farm]);

  /* What the statistics draw. Everything here is worked out on the way past —
     the only thing kept is the day-by-day record above. */
  const recorded = history.current;
  const herdMax = Math.max(1, ...recorded.map((r) => r.head));
  const herdRows = recorded.map((r) => ({
    key: r.day,
    title: `Day ${r.day}: ${r.head} head — ${Object.entries(r.counts)
      .filter(([, n]) => n > 0)
      .map(([species, n]) => `${n} ${species.toLowerCase()}`)
      .join(", ") || "nobody left"}`,
    parts: SPECIES
      .map((Species) => ({
        key: Species.species,
        value: r.counts[Species.species] ?? 0,
        color: COLOR_OF.get(Species.species),
      }))
      .filter((part) => part.value > 0),
  }));
  const stockMax = Object.fromEntries(stock.map((s) => [
    s.kind, Math.max(1, ...recorded.map((r) => r.stock[s.kind] ?? 0)),
  ]));

  /* The farmer, and the day-by-day of what he carried out to the field. The
     record keeps running totals, so a day's work is the step up from the day
     before — and the first recorded day has nothing before it to subtract. */
  const farmer = farm.animals.find((a) => a instanceof Human);
  const carriedRows = recorded.slice(1).map((r, i) => {
    const before = recorded[i];
    const day = RESOURCE_NAMES.map((kind) => ({
      kind,
      value: Math.max(0, (r.carried[kind] ?? 0) - (before.carried[kind] ?? 0)),
    }));
    const put = day.filter((d) => d.value >= 1);
    return {
      key: r.day,
      title: `Day ${r.day}: ${put.length
        ? put.map((d) => `${Math.round(d.value)} ${RESOURCE_KINDS[d.kind].unit} of ${d.kind}`).join(" and ")
        : "nothing needed carrying"}`,
      parts: day
        .map((d) => ({ key: d.kind, value: d.value, color: SERIES[d.kind === "water" ? 0 : 5] }))
        .filter((part) => part.value > 0),
    };
  });
  const carriedMax = Math.max(1, ...carriedRows.map((r) => r.parts.reduce((t, p) => t + p.value, 0)));
  const warmest = Math.max(...year.map((d) => d.tempC));
  const coldest = Math.min(...year.map((d) => d.tempC));
  const wettest = Math.max(1, ...year.map((d) => d.wetHours));
  const seasonSummary = ["winter", "spring", "summer", "autumn"].map((season) => {
    const days = year.filter((d) => d.season === season);
    return {
      season,
      tempC: days.reduce((t, d) => t + d.tempC, 0) / days.length,
      wetDays: days.filter((d) => d.wetHours > 0).length,
      daylength: days.reduce((t, d) => t + d.daylength, 0) / days.length,
    };
  });

  // Farm.stepAll() walks the animals as a side effect, so the roam timer reads
  // the current farm through a ref rather than a state updater — React invokes
  // updaters twice under StrictMode, which would step everyone twice a tick.
  const farmRef = useRef(farm);
  farmRef.current = farm;

  // The pasture is only a tab stop while something is armed, so there is no
  // dead stop in the ordinary tab order; focus is handed to it the moment the
  // farmer picks up a bucket, and handed back when they put it down.
  const pastureRef = useRef(null);
  const armedFrom = useRef(null);

  // Arrow keys move between tabs, which means the tab that is not selected must
  // not be a tab stop of its own — so the row needs to hand focus over itself.
  const tabRefs = useRef({});

  useEffect(() => {
    if (placing) pastureRef.current?.focus();
  }, [placing]);

  // A source is drawn down in place, so there is no earlier volume to compare
  // against — what a warning needs is memory of which ones have already been
  // called out. Topping one up drops it off the list, so the same trough can
  // warn again the next time it runs down.
  const warnedLow = useRef(new Set());

  useEffect(() => {
    for (const source of farm.resources) {
      if (source.fullness >= lowAt) {
        warnedLow.current.delete(source.id);
      } else if (!source.depleted && !warnedLow.current.has(source.id)) {
        warnedLow.current.add(source.id);
        pushLog(
          `${source.name} is running low — ${Math.round(source.volume)} ${source.unit} left.`,
          "low",
        );
      }
    }
  }, [farm, lowAt]);

  // An animal is born with a ScriptedMind of its own, so this runs against the
  // whole herd on every farm change rather than only when the setting moves —
  // otherwise a lamb born under the Claude setting would quietly think for
  // itself. Re-seating a mind costs it whatever it had latched, so a mind that
  // is already the right kind at the right cadence is left where it is.
  useEffect(() => {
    const { Mind } = MINDS[mindKind];
    for (const animal of farm.animals) {
      if (animal.mind.constructor === Mind && animal.mind.cadence === cadence) continue;
      animal.mind = new Mind({ cadence });
    }
  }, [farm, mindKind, cadence]);

  useEffect(() => {
    if (!roaming) return undefined;
    const timer = window.setInterval(() => {
      const { farm: next, died, dried, born, contests, chores, hired, left } = farmRef.current.stepAll();
      setFarm(next);
      for (const hand of hired) {
        pushLog(`${hand.name} is taken on as a farmhand.`, "info", hand.species);
      }
      for (const hand of left) {
        pushLog(`${hand.name} is paid off; there is not the work for them.`, "info", hand.species);
      }
      for (const source of dried) pushLog(`${source.name} has run dry.`, "empty");
      for (const c of chores) pushLog(c.notice, "tend", c.by.species);
      for (const s of contests) pushLog(contestNotice(s), "contest", s.loser.species);
      for (const baby of born) pushLog(baby.birthNotice(), "born", baby.species);
      for (const animal of died) pushLog(animal.epitaph(), "died", animal.species);
    }, stepMs);
    return () => window.clearInterval(timer);
  }, [roaming, stepMs]);

  const shownLog = log
    .filter((e) => (logSpecies === "all" || e.species === logSpecies)
      && (logKind === "all" || e.kind === logKind))
    .slice(0, logLines);

  /**
   * What a filter offers: whatever the log actually holds, plus the current
   * choice — so a filter never falls out of its own dropdown as the lines it
   * was matching roll off the end.
   */
  function logOptions(key, chosen) {
    const seen = new Set(log.map((e) => e[key]).filter(Boolean));
    if (chosen !== "all") seen.add(chosen);
    return [...seen].sort();
  }

  function pushLog(text, kind, species) {
    setLog((l) => [
      { id: `${Date.now()}-${Math.random()}`, text, kind, species },
      ...l,
    ].slice(0, LOG_KEPT));
  }

  function runAction(kind) {
    if (!selected) return;
    if (kind === "move") return walk(selected);
    pushLog(selected[kind](), kind, selected.species);
    if (kind === "makeSound") {
      setSpeakingId(selected.id);
      window.clearTimeout(runAction._t);
      runAction._t = window.setTimeout(() => setSpeakingId(null), 1800);
    }
  }

  /**
   * One step of being alive: the animal feels, may reconsider, and acts. The
   * farm decides where — or whether — it can go.
   */
  function walk(animal) {
    const { farm: next, outcome, died, born, contests, chores, hired, left } = farm.step(animal.id);
    setFarm(next);
    if (outcome === "blocked") {
      pushLog(`${animal.name} is hemmed in and stays put.`, "move", animal.species);
    } else {
      pushLog(animal.narrate(), animal.goal, animal.species);
    }
    for (const hand of hired) pushLog(`${hand.name} is taken on as a farmhand.`, "info", hand.species);
    for (const hand of left) pushLog(`${hand.name} is paid off.`, "info", hand.species);
    for (const c of chores) pushLog(c.notice, "tend", c.by.species);
    for (const s of contests) pushLog(contestNotice(s), "contest", s.loser.species);
    for (const baby of born) pushLog(baby.birthNotice(), "born", baby.species);
    for (const lost of died) pushLog(lost.epitaph(), "died", lost.species);
  }

  /**
   * Pick up a bucket. The drop point starts in the middle of the herd, because
   * that is where feed and water are wanted and it costs no keypresses to get
   * there; the arrows are for the last few percent.
   */
  function arm(kind, button) {
    if (placing === kind) return cancelPlacing();
    armedFrom.current = button;
    setDropAt(clampToPasture(centroid(farm.animals) ?? { x: 50, y: 50 }));
    setPlacing(kind);
  }

  function cancelPlacing() {
    setPlacing(null);
    armedFrom.current?.focus();
  }

  /** Put water or grass down at a spot in pasture percent. */
  function place(at) {
    const { farm: next, resource } = farm.addResource(placing, at);
    setFarm(next);
    setPlacing(null);
    pushLog(`${resource.name} put down — ${Math.round(resource.volume)} ${resource.unit}.`, placing);
    // The pasture stops being a tab stop the instant this lands, so send focus
    // back to the button that armed it rather than dropping it on the body.
    armedFrom.current?.focus();
  }

  /** Fill every trough or patch of one kind back up to the brim. */
  /** Take everything the animals have made since the last time round. */
  function collect() {
    const { farm: next, got } = farm.collect();
    setFarm(next);
    // "5.6 L of milk" but "3 eggs": a count of a thing needs no "of".
    const said = got.map((g) => (g.unit
      ? `${g.amount} ${g.unit} of ${g.label.toLowerCase()}`
      : `${g.amount} ${g.label.toLowerCase()}`));
    pushLog(`Collected ${said.join(", ")}.`, "collect");
  }

  function topUp(kind) {
    const { farm: next, added, filled } = farm.topUp(kind);
    if (filled === 0) return;
    setFarm(next);
    const unit = RESOURCE_KINDS[kind].unit;
    pushLog(
      `Topped up ${filled} ${kind} ${filled === 1 ? "source" : "sources"}` +
      ` — ${Math.round(added)} ${unit} added.`,
      kind,
    );
  }

  /** Put water or grass wherever the farmer clicked. */
  function placeAt(event) {
    if (!placing) return;
    // Enter on a sprite raises a click with no coordinates, which used to land
    // the resource in the corner of the fence. The keys have their own path.
    if (event.detail === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    // The click lands on the tilted ground, so read it back off the projection
    // — otherwise a trough dropped at the far edge would slide toward the
    // middle of the field on its way to being drawn.
    place(unproject({
      x: ((event.clientX - box.left) / box.width) * 100,
      y: ((event.clientY - box.top) / box.height) * 100,
    }));
  }

  /** The same capability without a pointer: arrows steer, Enter drops, Esc puts it back. */
  function steer(event) {
    if (!placing) return;
    if (event.key === "Escape") return cancelPlacing();
    const nudge = NUDGE_KEYS[event.key];
    if (nudge) {
      event.preventDefault();
      setDropAt((at) => clampToPasture({ x: at.x + nudge.x, y: at.y + nudge.y }));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      place(dropAt);
    }
  }

  /**
   * Show one of the two views. A bucket in hand is aimed at a field that is
   * about to leave the screen, so it goes back on the shelf — quietly, since
   * the button that armed it is going with it.
   */
  function showTab(id) {
    if (id !== "pasture") setPlacing(null);
    setTab(id);
  }

  /** Left and right along the tab row, as a tablist is expected to behave. */
  function steerTabs(event) {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const at = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(at + step + TABS.length) % TABS.length];
    showTab(next.id);
    tabRefs.current[next.id]?.focus();
  }

  /** One more of a species, from the + on that species' pen chip. */
  function addAnimal(species) {
    const fresh = speciesNamed(species).random();
    const { farm: next, added } = farm.add(fresh);
    if (!added) {
      pushLog(`No room in the pasture for another ${fresh.species.toLowerCase()}.`, "info", fresh.species);
      return;
    }
    setFarm(next);
    setSelectedId(fresh.id);
    setShowSource(false);
    // The newcomer's card is under the field, so go and look at it.
    showTab("pasture");
    pushLog(`${fresh.name} the ${fresh.species.toLowerCase()} joins the farm.`, "info", fresh.species);
  }

  function removeSelected() {
    if (!selected) return;
    const { id, name, species } = selected;
    setFarm(farm.remove(id));
    setSelectedId(null);
    setShowSource(false);
    pushLog(`${name} the ${species.toLowerCase()} leaves the pasture.`, "info", species);
  }

  return (
    <div
      className={"farm-app" + (calm ? " calm" : "")}
      style={{
        "--step-duration": `${stepMs}ms`,
        // farm.css draws the same field the model does, so the constants it
        // needs come from here rather than being written down twice.
        "--horizon": `${HORIZON}%`,
        "--ground-clip": GROUND_CLIP,
        "--ink-grid": INK.grid,
        "--ink-axis": INK.axis,
        "--ink-muted": INK.muted,
      }}
    >
      <div className="fa-header">
        <div className="fa-title">{farm.name.toUpperCase()}</div>
        <div className="fa-subtitle">
          an object model, out to pasture — {farm.size} {farm.size === 1 ? "animal" : "animals"} on the books
        </div>
        <div className="fa-chips">
          <div className="fa-chip base" style={{ opacity: 0.75 }}>
            <span className="dot" style={{ background: "#cfe8d8" }} />
            Animal (base class)
          </div>
          {census.map((pen) => (
            <div className="fa-chip" key={pen.species}>
              <button
                className="pen"
                disabled={pen.count === 0}
                // The count is in the name as words, not as "×1": the chip is
                // read aloud as a pen with animals in it, not as a sum.
                aria-label={`${pen.species} pen, ${pen.count} ${pen.count === 1 ? "animal" : "animals"}`}
                onClick={() => {
                  const first = farm.bySpecies(pen.species)[0];
                  // The chips stay above both views, but the card they open is
                  // under the field — so picking a pen goes back to the field.
                  if (first) { setSelectedId(first.id); setShowSource(false); showTab("pasture"); }
                }}
              >
                <span className="dot" style={{ background: pen.color }} />
                {pen.emoji} {pen.species}
                <span className="n">×{pen.count}</span>
              </button>
              <button
                className="add"
                aria-label={`Add a ${pen.species.toLowerCase()}`}
                onClick={() => addAnimal(pen.species)}
              >
                +
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="fa-tabs" role="tablist" aria-label="Farm views">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`fa-tab-${t.id}`}
            className="fa-tab"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`fa-view-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            ref={(el) => { tabRefs.current[t.id] = el; }}
            onClick={() => showTab(t.id)}
            onKeyDown={steerTabs}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "pasture" && (
      <div
        className="fa-body"
        id="fa-view-pasture"
        role="tabpanel"
        aria-labelledby="fa-tab-pasture"
      >
        <div className="fa-chores">
          <div className="fa-drawer-bar">
            <button
              className="fa-drawer-toggle"
              aria-expanded={chores}
              aria-controls="fa-chores-drawer"
              onClick={() => setChores((v) => !v)}
            >
              <span className="caret" aria-hidden="true">{chores ? "▾" : "▸"}</span>
              Farm controls
            </button>
            {/* What the drawer hides is detail, not the state of the farm: the
                head count and what is left in the troughs stay out here, and
                the numbers go straw then barn red as the troughs run down.
                The stock stands down once the drawer is open, rather than say
                the same thing twice a line apart. */}
            <span className="fa-glance">
              {/* The farm's own clock. Not aria-live: it changes every step,
                  and a reader has no use for being told the time four times a
                  minute. */}
              <span className="item" title={`Sun up ${hhmm(clock.sunrise)}, down ${hhmm(clock.sunset)}`}>
                {PHASE_MARKS[clock.phase]} {clock.time} · day {clock.day}
              </span>
              <span
                className="item"
                title={clock.sky === "clear"
                  ? "Nothing falling"
                  : `${clock.sky} — ${Math.round(clock.precipitation * 100)}% of a downpour`}
              >
                {SKY_MARKS[clock.sky]} {clock.season} {Math.round(clock.tempC)}°C
              </span>
              <span className="item">{farm.size} head</span>
              {!chores && stock.map((s) => (
                <span
                  className="item"
                  key={s.kind}
                  style={{ color: stockColor(s) }}
                >
                  {RESOURCE_ICONS[s.kind]} {s.volume} {s.unit}
                </span>
              ))}
            </span>
            {/* Solid, where it used to be an outline among five others: with
                the drawer shut this is the only thing on the bar to press. */}
            <button
              className="fa-btn"
              onClick={() => setRoaming((v) => !v)}
              disabled={farm.size === 0}
            >
              {roaming ? "⏸ Stop roaming" : "▶ Let them roam"}
            </button>
          </div>

          <div className="fa-drawer" id="fa-chores-drawer" hidden={!chores}>
            <div className="fa-yield fa-stock">
              <span className="lbl">In the field</span>
              {stock.map((s) => (
                <span
                  className="item"
                  key={s.kind}
                  style={{ color: stockColor(s) }}
                >
                  {RESOURCE_ICONS[s.kind]} {s.volume} {s.unit}
                  {s.sources > 1 && <span className="none"> ×{s.sources}</span>}
                </span>
              ))}
              <span className="lbl" style={{ marginLeft: "auto" }}>Put down</span>
              {RESOURCE_NAMES.map((kind) => (
                <button
                  key={kind}
                  className="fa-btn alt"
                  style={placing === kind
                    ? { background: "var(--wood)", color: "var(--cream)" }
                    : undefined}
                  onClick={(event) => arm(kind, event.currentTarget)}
                >
                  {RESOURCE_ICONS[kind]} {kind}
                </button>
              ))}
              <span className="lbl">Top up</span>
              {RESOURCE_NAMES.map((kind) => {
                // Nothing of that kind in the field, or all of it already full.
                const spare = farm.resources.some(
                  (r) => r.kind === kind && r.volume < r.capacity,
                );
                return (
                  <button
                    key={kind}
                    className="fa-btn alt"
                    // Its own name, sharing none of "💧 water" above: the two
                    // buttons per kind have to stay tellable apart by anything
                    // that finds them by their accessible name.
                    aria-label={`Top up ${kind}`}
                    // Held levels do not take a top-up, so the button says so
                    // rather than looking broken.
                    disabled={!spare || held}
                    title={held ? "Levels are held — nothing goes in or out" : undefined}
                    onClick={() => topUp(kind)}
                  >
                    {RESOURCE_ICONS[kind]} +
                  </button>
                );
              })}
            </div>

            <div className="fa-yield">
              <span className="lbl">Doing now</span>
              {activity.length === 0
                ? <span className="none">nobody about</span>
                : activity.map((a) => (
                    <span className="item" key={a.goal}>
                      {GOAL_ICONS[a.goal] ?? "•"} {a.count} {a.goal}
                    </span>
                  ))}
              {expecting > 0 && (
                <span className="item" style={{ color: "#7d2a1e" }}>
                  🤰 {expecting} expecting
                </span>
              )}
            </div>

            {/* Two numbers per line, and they mean different things: what the
                farm makes in a day, and what is standing in the pails waiting
                to be taken. The second is the one that grows while you watch. */}
            <div className="fa-yield">
              <span className="lbl">Yield</span>
              {produce.length === 0
                ? <span className="none">nothing to collect today</span>
                : produce.map((p) => (
                    <span className="item" key={p.label}>
                      {p.label} {p.amount}{p.unit && ` ${p.unit}`}/day
                      <span className="none"> · {p.waiting}{p.unit && ` ${p.unit}`} waiting</span>
                    </span>
                  ))}
              {produce.length > 0 && (
                <button
                  className="fa-btn alt"
                  style={{ marginLeft: "auto" }}
                  disabled={!produce.some((p) => p.waiting > 0)}
                  onClick={collect}
                >
                  Collect
                </button>
              )}
            </div>

          </div>
        </div>

        {/* Outside the drawer on purpose. A trough running down is the one
            thing the farm says without being asked, and a warning nobody can
            hear until they open a panel is not a warning. */}
        {lowSources.length > 0 && (
          <div className="fa-yield fa-low" role="status" aria-live="polite">
            <span className="lbl">Running low</span>
            {lowSources.map((s) => (
              <span className="item" key={s.id}>
                {RESOURCE_ICONS[s.kind]} {s.name} — {Math.round(s.volume)} {s.unit}
                <span className="none"> ({Math.round(s.fullness * 100)}%)</span>
              </span>
            ))}
          </div>
        )}

        {/* Likewise: while a bucket is in hand this is the only instruction for
            it, and it sits against the field it is talking about. */}
        {placing && dropAt && (
          <div className="fa-yield">
            <span className="none">
              Click anywhere in the pasture to put down {placing} — or arrow keys
              to aim, Enter to drop, Esc to cancel.
            </span>
            {/* The only account of where the drop point is for anyone who
                cannot see the marker on the field. */}
            <span className="item" style={{ marginLeft: "auto" }} aria-live="polite">
              {RESOURCE_ICONS[placing]} {Math.round(dropAt.x)}%, {Math.round(dropAt.y)}%
            </span>
          </div>
        )}

        <div
          ref={pastureRef}
          className={"fa-pasture" + (placing ? " placing" : "")}
          onClick={placeAt}
          onKeyDown={steer}
          // Only reachable, and only an application, while a bucket is in hand:
          // otherwise the arrow keys belong to the reader, not to us.
          tabIndex={placing ? 0 : undefined}
          role={placing ? "application" : undefined}
          aria-label={placing
            ? `Pasture — arrow keys to aim the ${placing}, Enter to put it down, Escape to cancel`
            : undefined}
        >
          <div className="fa-hills" aria-hidden="true" />
          {/* The sun climbs from where it rose to where it will set, and the
              moon takes the same road once it is down. Both ride in the strip
              of sky above the horizon, so noon is high and dusk is on the
              rail. */}
          <div className="fa-sun" style={skyBody(clock)} aria-hidden="true">
            {clock.daylight ? "☀️" : "🌙"}
          </div>
          <div className="fa-ground" aria-hidden="true" />
          {/* The mud is no longer a landmark laid on the field — it is one of
              the terrain's patches now, and gets drawn with the rest of them. */}
          <PastureTerrain />
          <div className="fa-barn" style={standing(BARN)}>🏚️</div>
          {TREES.map((tree) => (
            <div key={tree.key} className="fa-tree" style={standing(tree)} aria-hidden="true">🌳</div>
          ))}
          {farm.resources.map((source) => (
            <div
              key={source.id}
              className={`fa-feature fa-source fa-${source.kind}` +
                (source.fullness < lowAt ? " low" : "")}
              title={source.describe()}
              style={{
                left: `${project(source).x}%`,
                top: `${source.y}%`,
                width: `${source.radius * 2 * sizeAt(source.y)}%`,
                opacity: 0.45 + source.fullness * 0.45,
              }}
            />
          ))}
          {farm.animals.map((a) => (
            <button
              key={a.id}
              className={"fa-sprite" + (a.id === selected?.id ? " selected" : "")
                + (a.speed > STOPPED ? " walking" : "")}
              style={{
                ...standing(a),
                // A stride takes as long as it takes: an animal at its cruising
                // speed swings its legs once a step, and one labouring uphill
                // or through mud swings them slower, because it is the same
                // legs covering less ground.
                "--stride": `${Math.round(Math.min(1400, (stepMs * 1.6 * a.stepSize) / Math.max(a.speed, 0.2)))}ms`,
                // Nothing to crop off something that has no legs to redraw:
                // the farmer on his tractor is a tractor, and a tractor's
                // wheels are the ones it came with.
                "--legline": `${a.legs === 0 ? 0 : LEG_LINE[a.species] ?? 0.24}em`,
              }}
              onClick={(event) => {
                // While placing, let the click through to the pasture beneath.
                if (placing) return;
                event.stopPropagation();
                setSelectedId(a.id);
                setShowSource(false);
              }}
              title={a.isPregnant
                ? `${a.describe()} Expecting by ${a.pregnancy.by}, ${a.pregnancy.left} steps to go.`
                : a.describe()}
            >
              {speakingId === a.id && (
                <div className="fa-bubble">{a.makeSound().split('"')[1] ? `"${a.makeSound().split('"')[1]}"` : "…"}</div>
              )}
              {/* Newborns are visibly smaller until they grow up. */}
              <span className="emoji" style={a.isAdult ? undefined : { fontSize: "18px" }}>
                <span className="shade" aria-hidden="true" />
                <span className="legs" aria-hidden="true">
                  {Array.from({ length: a.legs }, (_, i) => <i key={i} />)}
                </span>
                <span className="glyph">{a.emoji}</span>
                {a.isPregnant && <span className="expecting">🤰</span>}
              </span>
              {showTags && (
                <span className={"tag" + (a.isPregnant ? " expecting" : "")}>
                  {a.name} {SEX_MARKS[a.sex]}
                </span>
              )}
            </button>
          ))}
          {placing && dropAt && (
            <div
              className="fa-aim"
              style={{ left: `${project(dropAt).x}%`, top: `${dropAt.y}%` }}
              aria-hidden="true"
            >
              {RESOURCE_ICONS[placing]}
            </div>
          )}
          {farm.size === 0 && (
            <div className="fa-empty">The pasture is empty. Press + on a pen at the top to add one.</div>
          )}
          <div className="fa-fence" />
          {/* The light, laid over everything including the animals — a field at
              dusk is dim all the way to the fence. Both are driven by the sun's
              elevation out of the model, so the glow really is on the side the
              sun is, and midsummer stays light hours longer than midwinter. */}
          {clock.sky !== "clear" && (
            <div
              className={`fa-weather ${clock.sky}`}
              style={{ opacity: 0.3 + clock.precipitation * 0.55 }}
              aria-hidden="true"
            />
          )}
          <div className="fa-night" style={{ opacity: nightfall }} aria-hidden="true" />
          <div
            className="fa-glow"
            style={{ opacity: afterglow, "--sun-x": clock.hour < 12 ? "20%" : "80%" }}
            aria-hidden="true"
          />
        </div>

        {selected && (
          <div className="fa-card">
            <div className="fa-card-head">
              <div>
                <div className="fa-card-species">class {selected.species} extends Animal</div>
                <div className="fa-card-name">
                  {selected.emoji} {selected.name} <span className="sex">{SEX_MARKS[selected.sex]}</span>
                </div>
              </div>
              <div className="fa-intent">
                <span>{GOAL_ICONS[selected.goal] ?? "•"} {selected.goal}</span>
                <span className="why">{selected.intention.reason}</span>
              </div>
              {selected.isPregnant && (
                <div className="fa-intent">
                  <span>🤰 expecting</span>
                  <span className="why">
                    by {selected.pregnancy.by} · {selected.pregnancy.left} steps to go
                  </span>
                </div>
              )}
              {!selected.isAdult && (
                <div className="fa-intent">
                  <span>🍼 young</span>
                  <span className="why">
                    grown in {Math.max(0, selected.constructor.maturesAt - selected.stepsAlive)} steps
                  </span>
                </div>
              )}
            </div>
            <div className="fa-card-cols">
              <div className="fa-drives">
                <div className="fa-drive">
                  <span className="n">Condition</span>
                  <span className="bar">
                    <span
                      className="fill"
                      style={{
                        width: `${selected.health * 100}%`,
                        background: driveColor(1 - selected.health),
                      }}
                    />
                  </span>
                  <span className="pct">{Math.round(selected.health * 100)}%</span>
                </div>
                {DRIVES.map((drive) => {
                  const level = selected.drives[drive];
                  return (
                    <div className="fa-drive" key={drive}>
                      <span className="n">{DRIVE_LABELS[drive]}</span>
                      <span className="bar">
                        <span
                          className="fill"
                          style={{ width: `${level * 100}%`, background: driveColor(level) }}
                        />
                      </span>
                      <span className="pct">{Math.round(level * 100)}%</span>
                    </div>
                  );
                })}
              </div>
              <div className="fa-attrs">
                {selected.getAttributes().map((attr) => (
                  <div className="fa-attr-row" key={attr.label}>
                    <span className="l">{attr.label}</span>
                    <span className="v">{attr.value}</span>
                  </div>
                ))}
              </div>
              <div className="fa-bonds">
                <span className="lbl">Keeps company with</span>
                {companions.length === 0 ? (
                  <span className="none">nobody yet</span>
                ) : (
                  companions.map(({ animal, tie }) => (
                    <button
                      className="tie"
                      key={animal.id}
                      onClick={() => setSelectedId(animal.id)}
                      title={`${Math.round(tie * 100)}% familiar`}
                    >
                      <span className="who">{animal.emoji} {animal.name}</span>
                      <span className="bar">
                        <span className="fill" style={{ width: `${tie * 100}%` }} />
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
            <div className="fa-actions">
              <button className="fa-btn" onClick={() => runAction("makeSound")}>🔊 Make sound</button>
              <button className="fa-btn" onClick={() => runAction("move")}>🚶 Move</button>
              <button className="fa-btn" onClick={() => runAction("eat")}>🌾 Feed</button>
              <button className="fa-btn alt" onClick={() => setShowSource((v) => !v)}>
                {showSource ? "Hide source" : "View source"}
              </button>
              <button className="fa-btn alt" onClick={removeSelected}>Remove</button>
            </div>
            {showSource && <div className="fa-code">{sourceOf(selected.species)}</div>}
          </div>
        )}
      </div>
      )}

      {tab === "stats" && (
      <div
        className="fa-body fa-desk"
        id="fa-view-stats"
        role="tabpanel"
        aria-labelledby="fa-tab-stats"
      >
        <div className="fa-card">
          <div className="fa-card-title">
            The herd, at the turn of each day
            <span className="note">{recorded.length ? `days ${recorded[0].day}–${recorded[recorded.length - 1].day}` : ""}</span>
          </div>
          <Columns
            rows={herdRows}
            max={herdMax}
            label={`Head count at the turn of each of the last ${recorded.length} days, stacked by species. ${herdMax} head at the fullest.`}
            empty="nothing counted yet — let them roam through a night"
          />
          <div className="fa-axis">
            <span>{recorded.length ? `day ${recorded[0].day}` : ""}</span>
            <span>{herdMax} head at the fullest</span>
          </div>
          {/* Not colour alone: every band is named, with its own count beside
              it, and the emoji is the same one on the pen above. */}
          <div className="fa-legend">
            {census.map((pen) => (
              <span className="key" key={pen.species}>
                <i style={{ background: COLOR_OF.get(pen.species) }} />
                {pen.emoji} {pen.species} <b>{pen.count}</b>
              </span>
            ))}
          </div>
        </div>

        {/* Two charts, not one with two scales: litres and kilogrammes share
            no axis, and laying them over each other would invent a comparison
            the field never made. */}
        <div className="fa-card">
          <div className="fa-card-title">In the field, at the turn of each day</div>
          {stock.map((s) => (
            <div className="fa-pair" key={s.kind}>
              <span className="side">{RESOURCE_ICONS[s.kind]} {s.label}<b>{stockMax[s.kind]} {s.unit}</b></span>
              <Columns
                rows={recorded.map((r) => ({
                  key: r.day,
                  title: `Day ${r.day}: ${r.stock[s.kind]} ${s.unit} of ${s.kind}`,
                  parts: [{ key: s.kind, value: r.stock[s.kind], color: SERIES[s.kind === "water" ? 0 : 5] }],
                }))}
                max={stockMax[s.kind]}
                height={54}
                label={`${s.label} in the field at the turn of each of the last ${recorded.length} days, ${stockMax[s.kind]} ${s.unit} at the fullest.`}
                empty="nothing recorded yet"
              />
            </div>
          ))}
        </div>

        {/* What the farm has of its farmer. Every figure here is his own
            running tally, so it reads the same whether you have watched him
            all year or just walked in. */}
        {farmer && (
        <div className="fa-card">
          <div className="fa-card-title">
            {/* The man, not whatever he is driving: his sprite out in the
                field is the tractor, and a card headed by one reads as a
                machine's page rather than his. */}
            {Human.emoji} {farmer.name}
            <span className="note">
              {farmer.goal === "tend" && farmer.tool ? `out with the ${farmer.tool}`
                : `${GOAL_ICONS[farmer.goal] ?? ""} ${farmer.goal}`}
            </span>
          </div>
          <div className="fa-tiles">
            <div className="tile">
              <span className="lbl">In the barn</span>
              <span className="big">{Math.round(farmer.stores)}</span>
              <span className="sub">of {Human.stores} · the well draws it back at {Human.yields}/step</span>
            </div>
            {stock.map((s) => (
              <div className="tile" key={s.kind}>
                <span className="lbl">{RESOURCE_ICONS[s.kind]} {s.label} carried</span>
                <span className="big">{Math.round(farmer.carried[s.kind] ?? 0)} {s.unit}</span>
                <span className="sub">out of the barn and into the field</span>
              </div>
            ))}
            <div className="tile">
              <span className="lbl">Sown</span>
              <span className="big">{farmer.sown}</span>
              <span className="sub">troughs and patches opened, as the herd outgrew the last</span>
            </div>
            <div className="tile">
              <span className="lbl">🧰 Seen to</span>
              <span className="big">{farmer.nursed}</span>
              <span className="sub">animals he dropped everything for, down at their last</span>
            </div>
          </div>
          <div className="fa-pair">
            <span className="side">🧰 Carried out<b>{carriedMax} a day</b></span>
            <Columns
              rows={carriedRows}
              max={carriedMax}
              height={54}
              label={`What ${farmer.name} carried out to the field on each of the last ${carriedRows.length} days, water and grass stacked, up to ${carriedMax} in a day.`}
              empty="nothing carried yet — let them roam through a night"
            />
          </div>
        </div>
        )}

        <div className="fa-card">
          <div className="fa-card-title">
            The year <span className="note">day {clock.dayOfYear + 1} of {DAYS_PER_YEAR} · {clock.season}</span>
          </div>
          <div className="fa-pair">
            <span className="side">🌡 Temperature<b>{Math.round(coldest)}–{Math.round(warmest)}°C</b></span>
            <div className="fa-plot">
              <Trace points={year.map((d) => d.tempC)} low={coldest} high={warmest} zero={0} color={SERIES[1]} />
              <span className="today" style={{ left: `${(clock.dayOfYear / DAYS_PER_YEAR) * 100}%` }} />
            </div>
          </div>
          <div className="fa-pair">
            <span className="side">🌧 Rain<b>{wettest} h/day</b></span>
            <div className="fa-plot">
              <Columns
                rows={year.map((d) => ({
                  key: d.day,
                  title: `Day ${d.day + 1} (${d.season}): ${d.wetHours
                    ? `${d.wetHours} h of ${d.sky}, ${Math.round(d.wettest * 100)}% at its heaviest`
                    : "dry"}`,
                  parts: [{ key: "wet", value: d.wetHours, color: SERIES[0] }],
                }))}
                max={wettest}
                height={54}
                gap={0}
                label={`Hours of rain or snow on each day of the year, up to ${wettest} in a day. Wettest in autumn, driest in summer.`}
              />
              <span className="today" style={{ left: `${(clock.dayOfYear / DAYS_PER_YEAR) * 100}%` }} />
            </div>
          </div>
          <SeasonAxis year={year} />
          <div className="fa-tiles">
            {seasonSummary.map((s) => (
              <div className="tile" key={s.season}>
                <span className="lbl">{s.season}</span>
                <span className="big">{Math.round(s.tempC)}°C</span>
                <span className="sub">{s.wetDays} wet days · {s.daylength.toFixed(1)} h light</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}

      {tab === "desk" && (
      <div
        className="fa-body fa-desk"
        id="fa-view-desk"
        role="tabpanel"
        aria-labelledby="fa-tab-desk"
      >
        <div className="fa-settings">
          <div className="fa-settings-title">Settings</div>

          <div className="fa-set-row">
            <span className="l" id="set-step">Step length</span>
            <input
              type="range"
              min={STEP_MIN}
              max={STEP_MAX}
              step={50}
              value={stepMs}
              aria-labelledby="set-step"
              onChange={(e) => setStepMs(Number(e.target.value))}
            />
            <span className="v">{stepMs} ms</span>
          </div>

          {/* Two different clocks: the step length is how fast the farm runs,
              this is how much of a day each step is worth. The readout gives
              both, since what a farmer wants to know is how long a day lasts
              in front of them. */}
          <div className="fa-set-row">
            <span className="l" id="set-day">A day takes</span>
            <input
              type="range"
              min={8}
              max={384}
              step={8}
              value={dayRounds}
              aria-labelledby="set-day"
              aria-valuetext={`${dayRounds} steps, about ${seconds(dayRounds * stepMs)} seconds`}
              onChange={(e) => {
                const rounds = Number(e.target.value);
                setRoundsPerDay(rounds);
                setDayRounds(rounds);
              }}
            />
            {/* Seconds, not steps: how long a day lasts in front of the farmer
                is what the knob is for, and it moves with the step length too.
                The step count is in the label for anyone who wants it. */}
            <span className="v" title={`${dayRounds} steps to a day`}>
              {seconds(dayRounds * stepMs)}s
            </span>
          </div>

          {/* The standing order that turns the troughs from a chore into
              scenery: at anything above off, no source falls below this share
              of full, however much the herd drinks. */}
          <div className="fa-set-row">
            <span className="l" id="set-keep">Keep stocked</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={keepAt}
              aria-labelledby="set-keep"
              aria-valuetext={keepAt === 0 ? "off" : `never below ${keepAt}% of capacity`}
              onChange={(e) => {
                const share = Number(e.target.value);
                setStockFloor(share / 100);
                setKeepAt(share);
              }}
            />
            <span className="v">{keepAt === 0 ? "off" : `≥ ${keepAt}%`}</span>
          </div>

          <div className="fa-set-row">
            <span className="l" id="set-mind">Animal mind</span>
            <select
              value={mindKind}
              aria-labelledby="set-mind"
              onChange={(e) => setMindKind(e.target.value)}
            >
              {Object.entries(MINDS).map(([key, { label }]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div className="fa-set-row">
            <span className="l" id="set-cadence">Rethink every</span>
            <input
              type="range"
              min={1}
              max={30}
              value={cadence}
              aria-labelledby="set-cadence"
              onChange={(e) => setCadence(Number(e.target.value))}
            />
            <span className="v">{cadence} {cadence === 1 ? "step" : "steps"}</span>
          </div>

          <div className="fa-set-row">
            <span className="l" id="set-low">Warn below</span>
            <input
              type="range"
              min={5}
              max={75}
              step={5}
              value={Math.round(lowAt * 100)}
              aria-labelledby="set-low"
              onChange={(e) => setLowAt(Number(e.target.value) / 100)}
            />
            <span className="v">{Math.round(lowAt * 100)}%</span>
          </div>

          <div className="fa-set-row">
            <span className="l" id="set-log">Log lines</span>
            <select
              value={logLines}
              aria-labelledby="set-log"
              onChange={(e) => setLogLines(Number(e.target.value))}
            >
              {LOG_SHOWN.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <div className="fa-set-checks">
            <label>
              <input type="checkbox" checked={showTags} onChange={(e) => setShowTags(e.target.checked)} />
              Name tags
            </label>
            <label>
              <input type="checkbox" checked={calm} onChange={(e) => setCalm(e.target.checked)} />
              Calm motion
            </label>
            {/* Not the same as keeping them stocked: that one refills at the end
                of every round, this one holds the levels exactly where they
                stand — a half-empty pond stays half-empty for good. */}
            <label title="Animals drink and graze as usual; the levels stop moving">
              <input
                type="checkbox"
                checked={held}
                onChange={(e) => {
                  setHeldLevels(e.target.checked);
                  setHeld(e.target.checked);
                }}
              />
              Hold water and grass levels
            </label>
          </div>

          {mindKind === "claude" && (
            <div className="fa-set-note">
              Every animal now asks the /decide proxy what to want — run
              <code> npm run proxy</code>, or they keep the goal they had.
            </div>
          )}
        </div>

        <div className="fa-log">
          <div className="fa-log-head">
            <div className="fa-log-title">Activity log</div>
            <select
              value={logSpecies}
              aria-label="Filter log by animal"
              onChange={(e) => setLogSpecies(e.target.value)}
            >
              <option value="all">All animals</option>
              {logOptions("species", logSpecies).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={logKind}
              aria-label="Filter log by activity"
              onChange={(e) => setLogKind(e.target.value)}
            >
              <option value="all">All activity</option>
              {logOptions("kind", logKind).map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          {shownLog.length === 0 && (
            <div className="fa-log-row"><span>Nothing in the log matches that filter.</span></div>
          )}
          {shownLog.map((entry) => (
            <div className="fa-log-row" key={entry.id}>
              <span className="k">{entry.kind === "info" ? "•" : entry.kind}</span>
              <span>{entry.text}</span>
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  );
}
