import React, { useEffect, useMemo, useRef, useState } from "react";
import Farm from "./model/Farm.js";
import { SPECIES, speciesNamed } from "./model/species.js";
import { centroid, clampToPasture } from "./model/pasture.js";
import { PATCHES, RELIEF } from "./model/terrain.js";
import { DRIVES, DRIVE_LABELS } from "./model/drives.js";
import {
  RESOURCE_KINDS, heldLevels, setHeldLevels, setStockFloor, stockFloor,
} from "./model/Resource.js";
import {
  DAYS_PER_YEAR, STEPS_PER_DAY, STEPS_PER_HOUR, clockAt, hhmm, roundsPerDay, setRoundsPerDay,
} from "./model/clock.js";
import ScriptedMind from "./model/minds/ScriptedMind.js";
import ClaudeMind from "./model/minds/ClaudeMind.js";
import { sourceOf } from "./sources.js";

/** How each goal reads on screen. Presentation only — the model has no icons. */
const GOAL_ICONS = {
  graze: "🌿", drink: "💧", wallow: "🫧", flock: "👥", rest: "😴", roam: "🚶", mate: "❤️",
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
      const { farm: next, died, dried, born, contests } = farmRef.current.stepAll();
      setFarm(next);
      for (const source of dried) pushLog(`${source.name} has run dry.`, "empty");
      for (const settled of contests) pushLog(contestNotice(settled), "contest");
      for (const baby of born) pushLog(baby.birthNotice(), "born");
      for (const animal of died) pushLog(animal.epitaph(), "died");
    }, stepMs);
    return () => window.clearInterval(timer);
  }, [roaming, stepMs]);

  function pushLog(text, kind) {
    setLog((l) => [{ id: `${Date.now()}-${Math.random()}`, text, kind }, ...l].slice(0, LOG_KEPT));
  }

  function runAction(kind) {
    if (!selected) return;
    if (kind === "move") return walk(selected);
    pushLog(selected[kind](), kind);
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
    const { farm: next, outcome, died, born, contests } = farm.step(animal.id);
    setFarm(next);
    if (outcome === "blocked") {
      pushLog(`${animal.name} is hemmed in and stays put.`, "move");
    } else {
      pushLog(animal.narrate(), animal.goal);
    }
    for (const settled of contests) pushLog(contestNotice(settled), "contest");
    for (const baby of born) pushLog(baby.birthNotice(), "born");
    for (const lost of died) pushLog(lost.epitaph(), "died");
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
      pushLog(`No room in the pasture for another ${fresh.species.toLowerCase()}.`, "info");
      return;
    }
    setFarm(next);
    setSelectedId(fresh.id);
    setShowSource(false);
    // The newcomer's card is under the field, so go and look at it.
    showTab("pasture");
    pushLog(`${fresh.name} the ${fresh.species.toLowerCase()} joins the farm.`, "info");
  }

  function removeSelected() {
    if (!selected) return;
    const { id, name, species } = selected;
    setFarm(farm.remove(id));
    setSelectedId(null);
    setShowSource(false);
    pushLog(`${name} the ${species.toLowerCase()} leaves the pasture.`, "info");
  }

  return (
    <div
      className={"farm-app" + (calm ? " calm" : "")}
      style={{ "--step-duration": `${stepMs}ms` }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;600&display=swap');

        .farm-app {
          --sky: #dfe9da;
          --sky-2: #c9dcc4;
          --field-1: #6f9451;
          --field-2: #47632f;
          --wood: #7a5230;
          --wood-dark: #573a20;
          --barn-red: #a13c2c;
          --cream: #f6efdd;
          --ink: #2e2a1f;
          --straw: #c98a3a;
          font-family: 'Inter', sans-serif;
          color: var(--ink);
          background: var(--sky);
          border-radius: 14px;
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(0,0,0,0.15);
        }
        .farm-app * { box-sizing: border-box; }

        .fa-header {
          background: linear-gradient(180deg, var(--wood), var(--wood-dark));
          padding: 18px 20px 14px;
          border-bottom: 4px solid var(--wood-dark);
        }
        .fa-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 34px;
          letter-spacing: 1.5px;
          color: var(--cream);
          line-height: 1;
        }
        .fa-subtitle {
          font-style: italic;
          font-size: 13px;
          color: #e8dcc2;
          margin-top: 4px;
        }
        .fa-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 12px;
        }
        /* The pill is no longer the button: a pen holds two controls now, and
           one button cannot sit inside another. The chip is the frame, and the
           two halves of it fill it edge to edge. */
        .fa-chip {
          display: flex;
          align-items: center;
          background: rgba(246,239,221,0.12);
          border: 1px solid rgba(246,239,221,0.35);
          color: var(--cream);
          padding: 4px 10px 4px 6px;
          border-radius: 999px;
          font-size: 12px;
        }
        /* The legend chip is a label, not a pen: nothing in it to press. */
        .fa-chip.base { gap: 6px; }
        .fa-chip .pen,
        .fa-chip .add {
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          color: var(--cream);
          background: none;
          border: none;
          cursor: pointer;
          /* Both reach out into the pill's own padding, so the target is the
             whole end of the chip rather than the glyph in the middle of it. */
          margin-top: -4px;
          margin-bottom: -4px;
          padding-top: 4px;
          padding-bottom: 4px;
        }
        .fa-chip .pen {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-left: -6px;
          padding-left: 6px;
          padding-right: 7px;
          border-radius: 999px 0 0 999px;
        }
        .fa-chip .add {
          margin-right: -10px;
          padding-left: 10px;
          padding-right: 10px;
          /* The seam between the two, in the chip's own border colour. */
          border-left: 1px solid rgba(246,239,221,0.35);
          border-radius: 0 999px 999px 0;
          font-size: 15px;
          line-height: 12px;
        }
        /* Darkens under the pointer rather than lightening, the way .fa-btn
           does. The old chip lit up instead, which put cream text on a paler
           chip: measured on the rendered header that was 3.8:1, and the + is
           small enough that it needed the room. Pressed into the wood, it is
           8.6:1 and the hover still reads. */
        .fa-chip .pen:hover,
        .fa-chip .add:hover { background: rgba(46,42,31,0.45); }
        /* An empty pen has nobody to select, but it is exactly where a farmer
           wants to add one — so the body dims and the + stays lit. */
        .fa-chip .pen:disabled { opacity: 0.4; cursor: default; }
        .fa-chip .pen:disabled:hover { background: none; }
        .fa-chip .pen:focus-visible,
        .fa-chip .add:focus-visible {
          outline: 2px solid var(--cream);
          /* Inside its own edge: an outline outside it would be cropped by the
             pill, and the two halves would both look like the same control. */
          outline-offset: -2px;
        }
        .fa-chip .dot {
          width: 9px; height: 9px; border-radius: 50%;
        }
        .fa-chip .n { font-family: 'JetBrains Mono', monospace; opacity: 0.85; }

        /* Two views of one farm: the field, and the desk where the dials and
           the day's record are kept. Underlined rather than boxed, so the row
           reads as a divider on the sky and not as another panel. */
        .fa-tabs {
          display: flex;
          gap: 6px;
          padding: 10px 16px 0;
          border-bottom: 1px solid rgba(87,58,32,0.22);
        }
        .fa-tab {
          font-family: 'Inter', sans-serif;
          font-size: 12.5px;
          font-weight: 600;
          color: #6b5f42;
          background: transparent;
          border: none;
          border-bottom: 3px solid transparent;
          border-radius: 6px 6px 0 0;
          /* Sits on the row's own rule, so the selected tab's underline
             replaces it rather than doubling it. */
          margin-bottom: -1px;
          padding: 8px 14px;
          cursor: pointer;
        }
        .fa-tab:hover { color: var(--ink); }
        .fa-tab[aria-selected="true"] {
          color: var(--ink);
          background: rgba(255,255,255,0.55);
          border-bottom-color: var(--barn-red);
        }
        .fa-tab:focus-visible { outline: 2px solid var(--wood); outline-offset: 2px; }

        /* One column now: the field is the page, and everything else is above
           or below it rather than beside it. */
        .fa-body {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 16px;
        }
        /* The desk is read, not watched. Left the full width of the page its
           sliders would be a metre long and its log lines too wide to track
           back to the left margin. */
        .fa-desk { max-width: 760px; }

        .fa-pasture {
          position: relative;
          /* The field has the whole width now that no panel shares its row, so
             its height is stated rather than inherited from a neighbour: a
             share of the window, capped so a tall one cannot stretch the
             ground into a corridor.

             The 82vw is what keeps it a field. Below 620px of window the old
             floor made the pasture taller than it was wide — 316×558 on a
             380px screen — and a receding plane drawn portrait reads as a
             hallway, not a pasture. The floor is low for the same reason: at
             700×500 a 460px minimum ate 92% of the window. */
          height: clamp(300px, min(62vh, 82vw), 680px);
          border-radius: 10px;
          overflow: hidden;
          /* Sky only. The field is a separate, tapered plane laid over it. */
          background: linear-gradient(180deg, var(--sky) 0%, var(--sky-2) 100%);
          border: 3px solid var(--wood-dark);
        }
        /* The sun itself, small and high. Drawn in the sky strip above the
           horizon, so it is behind everything standing on the ground. */
        .fa-sun {
          position: absolute;
          transform: translate(-50%, -50%);
          font-size: 20px;
          pointer-events: none;
          filter: drop-shadow(0 0 10px rgba(255,214,140,0.9));
          transition: left 700ms linear, top 700ms linear;
        }
        /* What is coming down. Both are one tiled layer scrolling past: rain
           as slanted threads, snow as two sizes of fleck drifting at their own
           speeds. Calm mode stops them with everything else. */
        .fa-weather {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .fa-weather.rain {
          background-image: repeating-linear-gradient(
            105deg, rgba(214,232,255,0.75) 0 1px, transparent 1px 9px);
          animation: fa-rain 420ms linear infinite;
        }
        @keyframes fa-rain { to { background-position: -34px 132px; } }
        .fa-weather.snow {
          background-image:
            radial-gradient(2.2px 2.2px at 22% 24%, #fff 55%, transparent 57%),
            radial-gradient(1.6px 1.6px at 68% 61%, rgba(255,255,255,0.85) 55%, transparent 57%);
          background-size: 110px 110px, 76px 76px;
          animation: fa-snow 5.5s linear infinite;
        }
        @keyframes fa-snow { to { background-position: 18px 110px, -22px 76px; } }
        .farm-app.calm .fa-weather, .farm-app.calm .fa-sun { animation: none; transition: none; }

        /* Night over the whole field, and the low warm band the sun leaves on
           the horizon as it comes up or goes down. Multiply rather than a
           plain veil, so the greens go deep instead of grey. */
        .fa-night, .fa-glow {
          position: absolute;
          inset: 0;
          pointer-events: none;
          transition: opacity 700ms linear;
        }
        .fa-night {
          background: linear-gradient(180deg, #0a1430 0%, #12203c 55%, #16223a 100%);
          mix-blend-mode: multiply;
        }
        /* Plain alpha, not a blend: screening an orange over a green field
           bleaches it grey, where laying it on top warms it. */
        .fa-glow {
          background: radial-gradient(
            46% 34% at var(--sun-x, 50%) ${HORIZON}%,
            rgba(255,158,58,0.9) 0%, rgba(226,92,48,0.34) 42%, transparent 70%);
        }
        /* Low hills, so the field ends against something instead of stopping. */
        .fa-hills {
          position: absolute;
          left: 0; right: 0; top: 0;
          height: ${HORIZON}%;
          background:
            radial-gradient(30% 62% at 20% 108%, #a9bda0 0 72%, transparent 74%),
            radial-gradient(22% 44% at 44% 108%, #b6c7ac 0 72%, transparent 74%),
            radial-gradient(34% 70% at 74% 108%, #9fb597 0 72%, transparent 74%);
        }
        /* The ground, seen from a standing farmer's height. Its furrows are
           evenly spaced because the projection is linear in depth; the taper
           and the haze at the far edge are what read as distance. */
        .fa-ground {
          position: absolute;
          left: 0; right: 0; bottom: 0;
          top: ${HORIZON}%;
          clip-path: ${GROUND_CLIP};
          background:
            linear-gradient(180deg, rgba(223,233,218,0.55) 0%, transparent 18%),
            repeating-linear-gradient(180deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 6.5%),
            linear-gradient(180deg, #7d9c5c 0%, var(--field-1) 30%, var(--field-2) 100%);
        }
        /* The lie of the land. Every one of these is a bump or a patch out of
           terrain.js, drawn where the model keeps it — the sun is up and to
           the left throughout, so a rise catches light on its near shoulder
           and a hollow catches it on its far one, which is the whole of what
           makes a dip read as a dip rather than a mound. */
        .fa-relief.rise {
          background: radial-gradient(ellipse at 38% 28%, #c8da91 0%, rgba(200,218,145,0) 68%);
        }
        .fa-relief.hollow {
          background: radial-gradient(ellipse at 62% 72%, #294016 0%, rgba(41,64,22,0) 68%);
        }
        .fa-ground-mud {
          background: radial-gradient(ellipse at 50% 40%, #7d5c3d 0%, #5c4229 60%, #46311d 100%);
          box-shadow: inset 0 3px 6px rgba(0,0,0,0.4);
          opacity: 0.85;
        }
        .fa-ground-wood {
          background: radial-gradient(ellipse at 50% 45%, #35551f 0%, #24401a 100%);
          opacity: 0.5;
        }
        /* Rock is drawn at exactly the radius animals bounce off, so what you
           see is what they hit. Cool grey against all this green. */
        .fa-ground-rock {
          background: radial-gradient(ellipse at 42% 30%, #bcbbb4 0%, #8b8b86 45%, #4a4a47 100%);
          box-shadow: 0 3px 5px rgba(0,0,0,0.4), inset 0 -2px 4px rgba(0,0,0,0.35);
        }
        /* The yard the barn stands on, drawn at exactly the radius animals
           bounce off — the building is a wall, not scenery, and the footprint
           is what says so. Bare earth: nothing grows where the herd mills. */
        .fa-ground-barn {
          background: radial-gradient(ellipse at 50% 45%, #a08a63 0%, #7d6a48 65%, #5e4f36 100%);
          box-shadow: inset 0 2px 5px rgba(0,0,0,0.3);
          opacity: 0.75;
        }
        /* The foot of each trunk, drawn at exactly the radius animals bounce
           off — same rule as the rock and the barn. Woodland underneath is
           still walkable; the trunk standing on it is not. */
        .fa-ground-tree {
          background: radial-gradient(ellipse at 50% 45%, #4a3a24 0%, #2f2415 100%);
          opacity: 0.7;
        }
        /* Trees stand on the woodland patches, one emoji per trunk in the
           model, so what you see is what they walk around. */
        .fa-tree {
          position: absolute;
          transform: translate(-50%, -62%) scale(var(--depth-scale, 1));
          font-size: 19px;
          pointer-events: none;
          opacity: var(--haze, 1);
          filter: drop-shadow(0 2px 2px rgba(0,0,0,0.3));
        }
        /* Two rails and a run of posts, drawn at foreground size. It sits above
           every sprite, so an animal at the front of the field passes behind
           it — which is most of what tells you the field has a front. */
        .fa-fence {
          position: absolute;
          left: 0; right: 0; bottom: 0;
          height: 42px;
          z-index: 1200;
          background:
            repeating-linear-gradient(90deg, var(--wood) 0 7px, transparent 7px 36px),
            linear-gradient(180deg,
              transparent 0 9px, var(--wood) 9px 14px,
              transparent 14px 26px, var(--wood) 26px 31px, transparent 31px);
          opacity: 0.8;
        }
        .fa-barn {
          position: absolute;
          /* Stands on its own ground spot: the origin is its base, not middle. */
          transform: translate(-50%, -100%) scale(var(--depth-scale, 1));
          transform-origin: 50% 100%;
          font-size: 46px;
          filter: drop-shadow(0 3px 3px rgba(0,0,0,0.25)) saturate(var(--haze, 1));
        }

        .fa-sprite {
          position: absolute;
          transform: translate(-50%, -50%);
          background: none;
          border: none;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 0;
          animation: bob 2.6s ease-in-out infinite;
          /* The model relocates the animal; the walk between spots is ours.
             Linear, and exactly as long as a step, so an animal that keeps
             walking never visibly stops between steps. */
          transition:
            left var(--step-duration, 600ms) linear,
            top var(--step-duration, 600ms) linear;
        }
        @media (prefers-reduced-motion: reduce) {
          .fa-sprite, .fa-sprite .emoji { transition: none; animation: none; }
        }
        /* The same stillness, asked for by hand rather than by the system —
           for a farmer whose OS says nothing but who wants the field to hold
           still while they read it. Animals still move; they just cut. */
        .farm-app.calm .fa-sprite,
        .farm-app.calm .fa-sprite .emoji,
        .farm-app.calm .fa-bubble,
        .farm-app.calm .fa-aim { transition: none; animation: none; }
        /* Only the animal takes the depth, not its name tag: a tag scaled down
           to the far edge would be 6px of text nobody could read. */
        .fa-sprite .emoji {
          position: relative;
          font-size: 30px;
          filter: drop-shadow(0 2px 1px rgba(0,0,0,0.22)) saturate(var(--haze, 1));
          /* Turned about when it is heading east, and only the glyph — a name
             tag read backwards is worse than a cow read backwards. The step
             transition below carries the flip, so an animal turning round
             narrows and swings rather than snapping. */
          transform: scale(var(--depth-scale, 1)) scaleX(var(--face, 1));
          /* Its feet are what stand on the ground, so scale from there. */
          transform-origin: 50% 100%;
          transition: transform var(--step-duration, 600ms) linear;
        }
        /* The patch of shade an animal stands in. Painted behind the emoji
           itself — a negative z-index child draws under its parent's text. */
        .fa-sprite .shade {
          position: absolute;
          left: 50%;
          bottom: 2px;
          transform: translateX(-50%);
          width: 30px;
          height: 9px;
          border-radius: 50%;
          background: radial-gradient(closest-side, rgba(30,42,18,0.55), rgba(30,42,18,0.05));
          filter: blur(1.5px);
          z-index: -1;
        }
        /* An expecting female is marked twice: a badge on the animal itself,
           and a coloured name tag, so she is findable without hunting. */
        .fa-sprite .expecting {
          position: absolute;
          right: -7px;
          bottom: -3px;
          font-size: 14px;
          line-height: 1;
          text-shadow: 0 0 4px #fff, 0 0 4px #fff, 0 0 4px #fff;
        }
        .fa-sprite .tag.expecting {
          background: #f7dbe4;
          border-color: var(--barn-red);
          color: #7d2a1e;
          font-weight: 600;
        }
        .fa-sprite.selected .emoji {
          transform: scale(calc(var(--depth-scale, 1) * 1.18));
        }
        .fa-sprite .tag {
          margin-top: 2px;
          font-size: 10px;
          background: var(--cream);
          border: 1px solid var(--wood);
          border-radius: 5px;
          padding: 1px 5px;
          font-family: 'JetBrains Mono', monospace;
          white-space: nowrap;
        }
        @keyframes bob {
          0%, 100% { margin-top: 0px; }
          50% { margin-top: -4px; }
        }
        .fa-bubble {
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          background: white;
          border: 1px solid var(--wood);
          border-radius: 8px;
          padding: 3px 8px;
          font-size: 11px;
          white-space: nowrap;
          margin-bottom: 6px;
          animation: pop 0.2s ease-out;
        }
        @keyframes pop {
          from { opacity: 0; transform: translateX(-50%) scale(0.7); }
          to { opacity: 1; transform: translateX(-50%) scale(1); }
        }
        .fa-feature {
          position: absolute;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          pointer-events: none;
          /* A pond is round where it lies; from here it is an ellipse. The
             ratio is taken off the rendered width rather than set in percent,
             because a percentage height is measured against the pasture's
             height — which is how these came out as beach balls. */
          aspect-ratio: 3 / 1;
        }
        .fa-source {
          /* size and opacity come from how much is left, so a drained source
             visibly shrinks and fades before it disappears */
          transition: width 0.4s linear, opacity 0.4s linear;
        }
        /* All three lie flat on the ground, so they get the same squash as the
           field and a lip of shadow where they meet it. */
        /* Lit from above and behind, so the near lip catches the light and the
           far one sits in the bank's shadow. */
        .fa-water {
          background: radial-gradient(ellipse at 50% 78%, #8fc3e2 0%, #5896c2 55%, #3E7CA6 100%);
          box-shadow: inset 0 3px 5px rgba(20,45,65,0.45), 0 2px 3px rgba(38,48,26,0.3);
        }
        .fa-grass {
          background: radial-gradient(ellipse at 50% 75%, #9ccb6c 0%, #6b9b41 55%, #4d7a2e 100%);
          box-shadow: inset 0 3px 5px rgba(30,50,20,0.35), 0 2px 3px rgba(38,48,26,0.28);
        }
        .fa-pasture.placing { cursor: crosshair; }
        .fa-pasture.placing .fa-sprite { cursor: crosshair; }
        /* Barn red, not cream: the ring sits against the pale sky at the top of
           the field, where cream would vanish. */
        .fa-pasture:focus-visible {
          outline: 3px solid var(--barn-red);
          outline-offset: 2px;
        }
        /* Where the keys would drop it. A pointer already says where it is
           aiming, so the marker only appears for a keyboard-driven focus. */
        .fa-aim {
          position: absolute;
          transform: translate(-50%, -50%);
          width: 34px;
          height: 34px;
          border-radius: 50%;
          border: 2px dashed var(--cream);
          background: rgba(246,239,221,0.25);
          /* Over every animal, under the fence: it has to stay findable even
             when the drop point is behind the herd. */
          z-index: 1100;
          box-shadow: 0 0 0 2px rgba(46,42,31,0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 15px;
          pointer-events: none;
          opacity: 0;
          transition: left 120ms ease-out, top 120ms ease-out;
        }
        .fa-pasture:focus-visible .fa-aim { opacity: 1; }
        /* Its own block, not the one up by .fa-sprite: an override that came
           earlier in the sheet would lose the tie to the rule above. */
        @media (prefers-reduced-motion: reduce) {
          .fa-aim { transition: none; }
        }
        .fa-empty {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--cream);
          font-style: italic;
          font-size: 13px;
          text-shadow: 0 1px 2px rgba(0,0,0,0.35);
        }

        /* The day's chores, folded away above the field. What stays out is
           what the farmer needs without opening anything: how many head, what
           is left in the troughs, and the one switch that starts the day. */
        .fa-chores {
          background: var(--cream);
          border: 1px solid #e3d6b3;
          border-radius: 8px;
          padding: 8px 12px;
        }
        .fa-drawer-bar {
          display: flex;
          align-items: center;
          gap: 8px 14px;
          flex-wrap: wrap;
        }
        .fa-drawer-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          font-family: 'Inter', sans-serif;
          font-size: 12.5px;
          font-weight: 600;
          color: var(--ink);
          background: none;
          border: none;
          padding: 4px 2px;
          cursor: pointer;
        }
        /* Sized to the label beside it, not to the 10px caps it used to sit
           against on the old summary: at 9px against 12.5px text the arrow
           lost its point and read as a bullet. */
        .fa-drawer-toggle .caret { font-size: 12.5px; color: var(--wood); }
        .fa-drawer-toggle:focus-visible {
          outline: 2px solid var(--wood);
          outline-offset: 2px;
          border-radius: 4px;
        }
        .fa-glance {
          display: flex;
          align-items: baseline;
          gap: 10px;
          flex-wrap: wrap;
          font-size: 12.5px;
        }
        .fa-glance .item { font-family: 'JetBrains Mono', monospace; font-weight: 600; }
        /* Roaming is the whole simulation, so it never goes in the drawer. */
        .fa-drawer-bar .fa-btn { margin-left: auto; }
        .fa-drawer {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px dashed #d9caa0;
        }
        /* The hidden attribute alone would lose to the display above. The rows
           are left in the page rather than unmounted, so shutting the drawer
           never costs a select its value. */
        .fa-drawer[hidden] { display: none; }

        .fa-card {
          position: relative;
          background: var(--cream);
          border: 1px solid #e3d6b3;
          border-radius: 6px;
          padding: 16px 16px 14px;
          /* Still pinned askew, but barely: the card is as wide as the field
             now, and a degree of tilt across that span lifts one corner far
             enough to collide with the fence above it. */
          transform: rotate(-0.35deg);
          box-shadow: 2px 3px 0 rgba(0,0,0,0.08);
        }
        .fa-card-head {
          display: flex;
          align-items: flex-end;
          flex-wrap: wrap;
          gap: 2px 20px;
        }
        /* Under the field the card has width instead of depth, so what used to
           be one long strip is read side by side. auto-fit rather than three
           fixed columns: on a narrow window they fall back into one. */
        .fa-card-cols {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
          gap: 2px 26px;
          align-items: start;
        }
        .fa-card::before {
          content: "";
          position: absolute;
          top: -10px; left: 18px;
          width: 12px; height: 12px;
          border-radius: 50%;
          background: var(--sky);
          border: 2px solid var(--wood);
        }
        .fa-card-species {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--barn-red);
          margin-bottom: 2px;
        }
        .fa-card-name {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 26px;
          letter-spacing: 0.5px;
          line-height: 1.05;
        }
        .fa-card-name .sex { color: var(--barn-red); }
        .fa-intent {
          display: flex;
          align-items: baseline;
          gap: 6px;
          margin-top: 6px;
          font-size: 12.5px;
          font-weight: 600;
        }
        .fa-intent .why {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 400;
          color: #6b5f42;
        }
        .fa-drives { margin-top: 10px; display: grid; gap: 4px; }
        .fa-drive {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 11px;
          color: #6b5f42;
        }
        .fa-drive .n { width: 66px; flex-shrink: 0; }
        .fa-drive .bar {
          flex: 1;
          height: 5px;
          background: #e3d6b3;
          border-radius: 3px;
          overflow: hidden;
        }
        /* A span is inline, and width does nothing to an inline box — without
           the display, every bar draws as an empty track at every value. */
        .fa-drive .fill {
          display: block;
          height: 100%;
          transition: width var(--step-duration, 600ms) linear;
        }
        .fa-drive .pct {
          width: 30px;
          text-align: right;
          font-family: 'JetBrains Mono', monospace;
          font-size: 9.5px;
        }

        .fa-attrs { margin-top: 10px; }
        .fa-attr-row {
          display: flex;
          justify-content: space-between;
          font-size: 12.5px;
          padding: 3px 0;
          border-bottom: 1px dashed #d9caa0;
        }
        .fa-attr-row .l { color: #6b5f42; }
        .fa-attr-row .v { font-family: 'JetBrains Mono', monospace; font-weight: 600; }

        .fa-bonds { margin-top: 10px; display: grid; gap: 4px; }
        .fa-bonds .lbl {
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.6px;
          color: #6b5f42;
        }
        .fa-bonds .none { font-size: 11px; color: #6b5f42; font-style: italic; }
        .fa-bonds .tie {
          font-family: 'Inter', sans-serif;
          display: flex;
          align-items: center;
          gap: 7px;
          width: 100%;
          padding: 1px 0;
          border: none;
          background: none;
          cursor: pointer;
          font-size: 11px;
          color: #6b5f42;
          text-align: left;
        }
        .fa-bonds .tie:hover .who { color: var(--wood); }
        .fa-bonds .who {
          width: 96px;
          flex-shrink: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fa-bonds .bar {
          flex: 1;
          height: 5px;
          background: #e3d6b3;
          border-radius: 3px;
          overflow: hidden;
        }
        .fa-bonds .fill {
          /* A span is inline, and width does nothing to an inline box —
             without this the bar is an empty track at every tie strength. */
          display: block;
          height: 100%;
          background: var(--wood);
          transition: width var(--step-duration, 600ms) linear;
        }

        .fa-actions { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; }
        .fa-btn {
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 600;
          border: none;
          border-radius: 6px;
          padding: 7px 10px;
          cursor: pointer;
          background: var(--wood);
          color: var(--cream);
        }
        .fa-btn:hover { background: var(--wood-dark); }
        .fa-btn.alt {
          background: transparent;
          color: var(--wood-dark);
          border: 1px solid var(--wood);
        }

        .fa-code {
          margin-top: 10px;
          background: #241f16;
          color: #e9dfc4;
          border-radius: 6px;
          padding: 10px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10.5px;
          line-height: 1.5;
          white-space: pre-wrap;
          max-height: 180px;
          overflow-y: auto;
        }

        .fa-yield {
          background: white;
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          align-items: baseline;
          gap: 10px;
          flex-wrap: wrap;
          font-size: 12.5px;
        }
        .fa-yield .lbl {
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.6px;
          color: #6b5f42;
        }
        .fa-yield .item { font-family: 'JetBrains Mono', monospace; font-weight: 600; }
        .fa-yield .none { color: #6b5f42; font-style: italic; }
        .fa-btn:disabled { opacity: 0.4; cursor: default; }
        .fa-btn.alt:disabled:hover { background: transparent; }
        /* Straw, not barn red: a trough getting low is a job to do, not a
           death in the herd, and the log already keeps red for those. */
        .fa-low {
          border-color: #d8b25e;
          background: #fdf6e4;
        }
        .fa-low .lbl { color: #8a5a12; }
        .fa-low .item { color: #8a5a12; }
        /* The same warning on the field itself, so the farmer can see which
           trough it is without reading the panel. */
        .fa-source.low {
          box-shadow: 0 0 0 2px rgba(201,138,58,0.9), 0 2px 3px rgba(38,48,26,0.3);
          animation: lowpulse 1.8s ease-in-out infinite;
        }
        @keyframes lowpulse {
          0%, 100% { box-shadow: 0 0 0 2px rgba(201,138,58,0.9), 0 2px 3px rgba(38,48,26,0.3); }
          50% { box-shadow: 0 0 0 5px rgba(201,138,58,0.35), 0 2px 3px rgba(38,48,26,0.3); }
        }
        @media (prefers-reduced-motion: reduce) {
          .fa-source.low { animation: none; }
        }

        /* No longer a disclosure: the tab it sits behind is the disclosure, and
           a shut panel inside a tab the farmer chose is a second door for
           nothing. */
        /* ---- Statistics ------------------------------------------------
           Charts are thin marks on a quiet card: hairline axes, no gridlines
           to speak of, and every gap between marks is 2px of surface rather
           than a drawn border. */
        .fa-card {
          background: white;
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 12px 14px 10px;
        }
        .fa-card-title {
          font-size: 11px;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: #6b5f42;
          display: flex;
          gap: 10px;
          align-items: baseline;
          margin-bottom: 10px;
        }
        .fa-card-title .note {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0;
          text-transform: none;
          color: ${INK.muted};
          margin-left: auto;
        }
        /* One column per day, each a stack of species. The gaps are the
           separation — nothing is outlined. */
        .fa-cols { display: flex; align-items: flex-end; gap: 2px; }
        .fa-cols .col {
          flex: 1 1 0;
          min-width: 0;
          height: 100%;
          display: flex;
          flex-direction: column-reverse;
          gap: 2px;
          justify-content: flex-start;
        }
        .fa-cols .col span { display: block; border-radius: 1px; }
        .fa-cols .col span:last-child { border-radius: 3px 3px 1px 1px; }
        .fa-chart-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11.5px;
          font-style: italic;
          color: ${INK.muted};
        }
        .fa-trace { display: block; width: 100%; }
        .fa-axis {
          display: flex;
          justify-content: space-between;
          border-top: 1px solid ${INK.axis};
          margin-top: 4px;
          padding-top: 3px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 9.5px;
          color: ${INK.muted};
        }
        .fa-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 8px; }
        .fa-legend .key {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11.5px;
          color: #52514e;
        }
        .fa-legend .key i { width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0; }
        .fa-legend .key b { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; }
        /* A chart with its name and its ceiling down the left, so the number
           is readable without hunting for a tooltip. */
        .fa-pair { display: flex; align-items: stretch; gap: 10px; margin-bottom: 8px; }
        .fa-pair .side {
          width: 104px;
          flex-shrink: 0;
          font-size: 11.5px;
          color: #52514e;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 2px;
        }
        .fa-pair .side b {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10.5px;
          color: ${INK.muted};
          font-weight: 600;
        }
        .fa-pair .fa-cols, .fa-pair .fa-plot { flex: 1; min-width: 0; }
        .fa-plot { position: relative; }
        /* Where the farm is standing in its own year. */
        .fa-plot .today {
          position: absolute;
          top: 0; bottom: 0;
          width: 1px;
          background: var(--barn-red);
          opacity: 0.75;
        }
        .fa-seasons {
          display: flex;
          gap: 2px;
          margin: 2px 0 10px 114px;
          font-size: 10px;
          color: ${INK.muted};
          text-transform: capitalize;
        }
        .fa-seasons span {
          text-align: center;
          border-top: 1px solid ${INK.grid};
          padding-top: 3px;
          min-width: 0;
          overflow: hidden;
        }
        .fa-tiles { display: flex; gap: 8px; flex-wrap: wrap; }
        .fa-tiles .tile {
          flex: 1 1 120px;
          border: 1px solid ${INK.grid};
          border-radius: 6px;
          padding: 7px 9px;
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .fa-tiles .lbl {
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: ${INK.muted};
        }
        .fa-tiles .big { font-size: 19px; color: #3a2f1c; }
        .fa-tiles .sub { font-size: 10.5px; color: #6b5f42; }

        .fa-settings {
          background: white;
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 10px 12px;
        }
        .fa-settings-title {
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.6px;
          color: #6b5f42;
          margin-bottom: 4px;
        }
        .fa-set-row {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 12.5px;
          padding: 6px 0;
          border-bottom: 1px dashed #ececec;
        }
        .fa-set-row .l { color: #6b5f42; width: 92px; flex-shrink: 0; }
        /* Fixed width, monospace: the readout must not shove the slider
           sideways as the number under it gets longer. */
        .fa-set-row .v {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10.5px;
          font-weight: 600;
          width: 58px;
          text-align: right;
          flex-shrink: 0;
        }
        .fa-set-row input[type="range"] { flex: 1; min-width: 0; accent-color: var(--wood); }
        .fa-set-row select {
          flex: 1;
          min-width: 0;
          font-family: 'Inter', sans-serif;
          font-size: 12.5px;
          padding: 5px 7px;
          border-radius: 5px;
          border: 1px solid #ccc;
          background: white;
        }
        .fa-set-checks {
          display: flex;
          gap: 14px;
          flex-wrap: wrap;
          padding-top: 9px;
        }
        .fa-set-checks label {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 12px;
          color: #6b5f42;
          cursor: pointer;
        }
        .fa-set-checks input { accent-color: var(--wood); }
        .fa-set-note {
          font-size: 11px;
          font-style: italic;
          color: #6b5f42;
          padding-top: 8px;
        }

        .fa-log {
          background: #fffdf7;
          border: 1px solid #e6ddc4;
          border-radius: 8px;
          padding: 10px 12px;
          min-height: 90px;
          /* Room to actually read the day back, now that it is not competing
             with the field for the same column. */
          max-height: 420px;
          overflow-y: auto;
        }
        .fa-log-title {
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.6px;
          color: #6b5f42;
          margin-bottom: 6px;
        }
        .fa-log-row {
          font-size: 12px;
          padding: 3px 0;
          border-bottom: 1px solid #f0e9d3;
          display: flex;
          gap: 6px;
        }
        .fa-log-row:last-child { border-bottom: none; }
        .fa-log-row .k {
          font-family: 'JetBrains Mono', monospace;
          font-size: 9.5px;
          color: var(--barn-red);
          flex-shrink: 0;
          padding-top: 2px;
        }
      `}</style>

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
                  style={{
                    color: s.volume === 0
                      ? "#a13c2c"
                      : lowKinds.has(s.kind) ? "#8a5a12" : undefined,
                  }}
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
                  style={{
                    color: s.volume === 0
                      ? "#a13c2c"
                      : lowKinds.has(s.kind) ? "#8a5a12" : undefined,
                  }}
                >
                  {RESOURCE_ICONS[s.kind]} {s.volume} {s.unit}
                  {s.sources > 1 && <span className="none"> ×{s.sources}</span>}
                </span>
              ))}
              <span className="lbl" style={{ marginLeft: "auto" }}>Put down</span>
              {["water", "grass"].map((kind) => (
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
              {["water", "grass"].map((kind) => {
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
              className={"fa-sprite" + (a.id === selected?.id ? " selected" : "")}
              style={standing(a)}
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
                {a.emoji}
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
          <div className="fa-log-title">Activity log</div>
          {log.slice(0, logLines).map((entry) => (
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
