// Incident Commander agent: a thin server-side step for a Claude tool-use loop.
// The browser runs the tools (it holds the building data and the simulation) and sends the
// conversation back here; this module adds the fixed system prompt and tool definitions and calls Claude.
// The API key never leaves the server, and the client cannot change the prompt or the tools.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5-5";
const MAX_MESSAGES = 60;
const MAX_BODY = 600_000;

const SYSTEM = `You are HavenLens Incident Commander, a decision-support agent for fire and emergency dispatchers in Houston and Los Angeles.
A human incident commander makes every decision; you prepare the plan they review.

Data you can reach through tools:
- CoStar building records (stories, height, construction, sprinklers, year built, units, tenants) for 3,339 buildings.
- HavenLens estimates: people inside at a given hour, people likely asleep, people who may need help to evacuate, hazard priority scores.
- A per-floor evacuation estimate (Pauls' SFPE high-rise formula, code-minimum stairs) with hazard-specific floor roles.
- Vexcel aerial AI: exterior detections (hazards, resources, obstacles) and candidate staging lots, which you can cross-check for parked cars and scaffolding.

How to work:
1. Start with find_buildings_near for the reported location, hazard and hour.
2. Look closer at the buildings that matter most: many people inside, many asleep, many who may need help, senior housing or healthcare, high-rise, unknown or missing sprinklers. Use get_building and estimate_evacuation on the top 2-4.
3. Run scan_exterior on the most critical building. Run find_staging for it and reject any staging lot whose cross-check shows it is blocked; say why.
4. Issue door placards (issue_placard) for the buildings you rank first.
5. Finish every planning round by calling submit_plan exactly once. Keep any text between tool calls to one short sentence.

When a complication arrives (a stair compromised, the hazard switched, a staging lot blocked), re-run only the tools the change affects, compare with the previous plan, and submit a revised plan that says what changed.

In a flood, multi-story buildings shelter vertically: never send evacuees to an outdoor lot; a staging lot is for apparatus only and its elevation is unknown.

Rules: use only facts returned by tools; give numbers as the tools give them and call estimates estimates. Never invent stair locations, hydrants or water depths. If something is unknown, list it under open questions for crews to verify.`;

const s = (props, required) => ({ type: "object", properties: props, required, additionalProperties: false });
const HAZARD = { type: "string", enum: ["fire", "flood", "blackout"] };

const TOOLS = [
  { name: "find_buildings_near", strict: true,
    description: "List CoStar buildings within a radius of the incident location, ranked by triage priority, with people inside at the hour, people likely asleep or most exposed for the hazard, people who may need help, priority score and hazard flags.",
    input_schema: s({ radius_m: { type: "integer", description: "Search radius in metres (100-1000)." }, hour: { type: "integer", description: "Hour of day, 0-23." }, hazard: HAZARD }, ["radius_m", "hour", "hazard"]) },
  { name: "get_building", strict: true,
    description: "Key CoStar facts and the hazard priority score breakdown for one building at an hour.",
    input_schema: s({ building_id: { type: "integer" }, hazard: HAZARD, hour: { type: "integer" } }, ["building_id", "hazard", "hour"]) },
  { name: "estimate_evacuation", strict: true,
    description: "Evacuation estimate for one building: total time range (SFPE/Pauls), people moving, code-minimum stair count, and the role and instructions for each floor given the hazard. closed_stairs lists stairs that cannot be used (for example ['A']); the estimate is recalculated with the remaining stairs.",
    input_schema: s({ building_id: { type: "integer" }, hazard: HAZARD, hour: { type: "integer" }, fire_floor: { type: "integer", description: "1-based floor where the fire is, or 0 if unknown." }, closed_stairs: { type: "array", items: { type: "string" } } }, ["building_id", "hazard", "hour", "fire_floor", "closed_stairs"]) },
  { name: "scan_exterior", strict: true,
    description: "Vexcel aerial AI scan of a building's parcel: roof data plus detected hazards (solar panels, scaffolding, rooftop equipment), resources (hydrants, pools as water sources) and obstacles (parked cars).",
    input_schema: s({ building_id: { type: "integer" } }, ["building_id"]) },
  { name: "find_staging", strict: true,
    description: "Candidate staging lots near a building found by Vexcel semantic image search, each cross-checked with Vexcel object detection for parked cars and scaffolding, with distance, direction, area and an estimate of usable space. Pass exclude to skip lots already ruled out.",
    input_schema: s({ building_id: { type: "integer" }, exclude: { type: "array", items: { type: "integer" } } }, ["building_id", "exclude"]) },
  { name: "issue_placard", strict: true,
    description: "Generate the printable door placard (key facts, people estimates, top risks, QR code to the live dossier and field verification) for a building.",
    input_schema: s({ building_id: { type: "integer" } }, ["building_id"]) },
  { name: "submit_plan", strict: true,
    description: "Submit the First-Due Triage Plan for the incident commander. Call exactly once at the end of each planning round.",
    input_schema: s({
      headline: { type: "string", description: "One sentence: the situation and the main call." },
      priorities: { type: "array", items: s({ building_id: { type: "integer" }, rank: { type: "integer" }, action: { type: "string" }, reason: { type: "string" }, evacuation: { type: "string" } }, ["building_id", "rank", "action", "reason", "evacuation"]) },
      staging: s({ candidate: { type: "integer", description: "Index of the chosen staging candidate, or -1 if none is usable." }, building_id: { type: "integer" }, reason: { type: "string" } }, ["candidate", "building_id", "reason"]),
      hazards: { type: "array", items: { type: "string" } },
      placards: { type: "array", items: { type: "integer" } },
      changes: { type: "string", description: "What changed since the previous plan, or empty for the first plan." },
      open_questions: { type: "array", items: { type: "string" } },
    }, ["headline", "priorities", "staging", "hazards", "placards", "changes", "open_questions"]) },
];

let client = null;
const recent = [];
function getClient() {
  if (client) return client;
  try { client = new Anthropic(); } catch { client = null; }
  return client;
}

export function agentConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) && Boolean(getClient());
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

// POST /api/agent  { messages }  ->  { content, stop_reason }
export async function agent(request) {
  const url = new URL(request.url);
  if (url.pathname === "/api/agent/status") return json({ configured: agentConfigured(), model: MODEL });
  if (request.method !== "POST") return json({ error: "Unsupported method." }, 405);
  if (!agentConfigured()) return json({ error: "No Claude API key on the server. Set ANTHROPIC_API_KEY in .env.local." }, 503);
  // The dev server is reachable on the local network; cap usage so others can't run up the bill.
  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= 40) return json({ error: "Too many agent steps this minute. Wait a moment." }, 429);
  recent.push(now);
  const body = await request.text();
  if (body.length > MAX_BODY) return json({ error: "Conversation too long." }, 413);
  let messages;
  try { messages = JSON.parse(body).messages; } catch { return json({ error: "Invalid request." }, 400); }
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES || messages[0].role !== "user"
      || !messages.every(m => (m.role === "user" || m.role === "assistant") && (typeof m.content === "string" || Array.isArray(m.content))))
    return json({ error: "Invalid conversation." }, 400);
  try {
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "medium" },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      tool_choice: { type: "auto" },
      messages,
    });
    return json({ content: response.content, stop_reason: response.stop_reason, model: response.model });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return json({ error: "The Claude API key was rejected." }, 503);
    if (error instanceof Anthropic.RateLimitError) return json({ error: "Claude is rate limited. Try again in a moment." }, 429);
    if (error instanceof Anthropic.BadRequestError) return json({ error: "Claude rejected the request: " + error.message.slice(0, 300) }, 400);
    if (error instanceof Anthropic.APIError) return json({ error: `Claude API error ${error.status}.` }, 502);
    return json({ error: "Could not reach Claude." }, 502);
  }
}
