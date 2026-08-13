/**
 * The proxy a Claude-backed Mind talks to.
 *
 * It exists for exactly one reason: the API key must not reach the page. Vite
 * inlines every VITE_* variable into the bundle at build time, so a key in the
 * client is a key in devtools. It lives here instead, in a process the browser
 * can talk to but cannot read.
 *
 *   POST /decide   <- a percept, as JSON
 *                  -> { goal, reason }
 *
 * Run it with the key in .env:
 *
 *   npm run proxy
 */
import { config } from "dotenv";
import { createServer } from "node:http";
import Anthropic from "@anthropic-ai/sdk";

const env = config().parsed ?? {};
Object.assign(process.env, env);

const PORT = Number(process.env.PORT ?? 8787);
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

/**
 * The client talks to either Anthropic directly (ANTHROPIC_API_KEY) or through
 * OpenRouter (ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN). If both are set, the
 * gateway wins — it's cheaper and has free models.
 */
const useGateway = process.env.ANTHROPIC_BASE_URL && process.env.ANTHROPIC_AUTH_TOKEN;
const client = new Anthropic({
  apiKey: useGateway ? process.env.ANTHROPIC_AUTH_TOKEN : process.env.ANTHROPIC_API_KEY,
  baseURL: useGateway ? process.env.ANTHROPIC_BASE_URL : undefined,
});

/**
 * What Claude is told once, and never again — byte-identical on every request,
 * so it sits in front of the cache breakpoint while the percept sits behind it.
 */
const SYSTEM = `You are the mind of one animal on a small farm. Each time you are
asked, you get everything that animal can currently sense, and you choose the
single thing it should be trying to do next.

The percept you are given:

  self.drives   how badly the body needs things, 0 to 1. hunger, thirst and
                fatigue climb every moment and fall only while the animal is
                doing something about them. loneliness falls in company. urge
                is the pull to breed. A drive pinned at 1 is costing the
                animal health — that is how animals here die.
  self.health   1 is well, 0 is dead. It only falls while a drive is pinned.
  options       the goals this animal can choose between, each with:
                  affinity — how much this kind of animal likes doing it.
                             Temperament, not obligation: a pig loves the mud,
                             but a starving pig should still eat.
                  pressure — how much the animal would get out of it now. A
                             goal with nowhere to go is discounted, so low
                             pressure can mean "not needed" or "not possible".
  sources       water and grass. distance is in pasture units — the field is
                about 84 across — and null means there is none left anywhere.
                volume is what remains in the nearest one; nothing grows back.
  nearby        the five closest other animals.

The goals:

  graze   eat at the nearest grass that isn't empty. Relieves hunger.
  drink   drink at the nearest water that isn't empty. Relieves thirst.
  wallow  lie in the mud patch. Relieves fatigue, and some animals love it.
  flock   move in close to the others. Relieves loneliness.
  mate    look for a willing partner of the same species. Relieves urge, and
          takes two — the other animal has to be looking as well.
  rest    stop where you stand. Relieves fatigue, needs no journey.
  roam    wander. Relieves nothing, so it is the answer only when nothing else
          is worth doing.

How to choose:

- Nothing is wrong with continuing. Walking somewhere here takes dozens of
  moments, and an animal that changes its mind every time it is asked never
  arrives anywhere. Stay with self.goal unless something else is clearly more
  worth doing, not merely tied with it.
- Weigh what the animal needs against what it is like. Both matter.
- A drive near 1 is urgent in a way a drive at 0.5 is not.
- Don't send the animal somewhere there is nothing to reach.

Answer with the goal and a short reason. The reason is read by a person
watching the farm: at most eight words, plain, present tense, in the animal's
own terms. "the pond is close and I'm parched", not "thirst 0.82".`;

/** The goal names this animal actually has, so no other answer is possible. */
function schemaFor(options) {
  return {
    type: "object",
    properties: {
      goal: { type: "string", enum: options.map((o) => o.goal) },
      reason: { type: "string" },
    },
    required: ["goal", "reason"],
    additionalProperties: false,
  };
}

async function decide(percept) {
  // Same guard ScriptedMind has: with nothing on offer there is nothing to ask.
  if (percept.options?.length === 0) return { goal: "roam", reason: "nothing else to want" };

  const message = await client.messages.create({
    model: MODEL,
    // Thinking shares this budget with the answer on Opus 5, and the answer
    // itself is two short fields — the headroom is all for the thinking.
    max_tokens: 2048,
    // The breakpoint is placed by hand rather than with top-level cache_control,
    // which caches the *last* cacheable block — here that would be the percept,
    // which is different every time and would never be read back.
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    output_config: {
      effort: "low", // choosing between seven goals is not hard reasoning
      format: { type: "json_schema", schema: schemaFor(percept.options ?? []) },
    },
    messages: [{ role: "user", content: JSON.stringify(percept) }],
  });

  // output_config.format guarantees the first text block is valid JSON.
  const text = message.content.find((block) => block.type === "text")?.text;
  return JSON.parse(text);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || !request.url.startsWith("/decide")) {
    response.writeHead(404).end("POST /decide\n");
    return;
  }
  try {
    const intention = await decide(JSON.parse(await readBody(request)));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(intention));
  } catch (cause) {
    // The mind on the other end keeps the animal's last intention, so the farm
    // carries on either way — but say what went wrong, or nobody will know.
    console.error(`/decide failed: ${cause.message}`);
    response.writeHead(502, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: cause.message }));
  }
});

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("No ANTHROPIC_API_KEY. Copy .env.example to .env and put a key in it.");
  process.exit(1);
}

server.listen(PORT, () => console.log(`/decide is up on http://localhost:${PORT} (${MODEL})`));
