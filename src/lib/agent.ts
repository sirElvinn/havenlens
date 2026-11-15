// Incident Commander: tools the agent can call, the Claude tool-use loop (through /api/agent, which holds the key),
// and a rule-based planner that runs the same tools in a fixed order when no key is configured.
import { loadDossier, peopleAt, type BuildingRow, type Dossier } from "./dossier";
import { estimateEvacuation } from "./evacuation";
import { analyze, FLAG_LABEL, type Incident } from "./incident";
import { applyReport, type Reports } from "./reports";
import { EXPOSED_LABEL, scenarioScore, type Scenario } from "./scenario";
import { planHazard, planNeighbor, type V2 } from "./twin";

/** Building names seen so far, so the log can say "Brava" instead of an ID. */
export const nameCache = new Map<number, string>();
const nm = (id: unknown) => nameCache.get(Number(id)) ?? `building ${id}`;

export type LogEntry = { id: number; kind: "user" | "think" | "note" | "tool" | "result" | "plan" | "error"; title: string; detail?: string; raw?: string };

export type Plan = {
  headline: string;
  priorities: { building_id: number; rank: number; action: string; reason: string; evacuation: string;
    attack_stair?: string | null; stairs_open?: string[]; closed_stairs?: string[] }[];
  staging: { candidate: number; building_id: number; reason: string };
  hazards: string[];
  placards: number[];
  changes: string;
  open_questions: string[];
  version?: number;
};

export type Context = {
  incident: Incident; hour: number; scenario: Scenario; buildings: BuildingRow[]; reports: Reports;
  reportedFloor?: number | null;   // 1-based, from the call
  focusBuilding?: number | null;   // building named in the call
};

export type Staging = { candidates: { lat: number; lon: number; dist: number; dir: string; areaM2: number | null; image: string | null }[] };
export type StagingCheck = { index: number; cars: number; scaffolding: number; areaM2: number; freeM2: number; status: "clear" | "partly blocked" | "blocked" };

export type Hooks = {
  log: (e: Omit<LogEntry, "id">) => void;
  plan: (p: Plan) => void;
  placard: (id: number) => void;
  staging: (buildingId: number, staging: Staging, checks: Record<number, StagingCheck>) => void;
  names: (id: number, name: string) => void;
  cancelled: () => boolean;
};

const dossierCache = new Map<number, Dossier>();
async function dossier(id: number, reports: Reports) {
  let d = dossierCache.get(id);
  if (!d) { const x = await loadDossier(id); if (!x) throw new Error(`Building ${id} not found`); d = x; dossierCache.set(id, d); }
  return applyReport(d, reports[id]) as Dossier;
}

async function getJson(url: string) {
  const r = await fetch(url);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `${url} failed (${r.status})`);
  return body;
}

const stairName = (i: number) => String.fromCharCode(65 + i);

/** The tools. Each returns plain JSON for the model and a one-line summary for the log. */
export async function runTool(name: string, input: Record<string, unknown>, ctx: Context, hooks: Hooks): Promise<{ result: unknown; summary: string }> {
  switch (name) {
    case "find_buildings_near": {
      const radius = Math.min(1000, Math.max(100, Number(input.radius_m) || ctx.incident.radius));
      const hour = Number.isInteger(input.hour) ? Number(input.hour) : ctx.hour;
      const hazard = (input.hazard as Scenario) ?? ctx.scenario;
      const rows = ctx.buildings.map(b => applyReport(b, ctx.reports[b.id]));
      const a = analyze(rows, { ...ctx.incident, radius }, hour, hazard);
      const top = a.nearby.slice(0, 12).map(n => {
        const sc = scenarioScore(n.b, hazard, hour);
        hooks.names(n.b.id, n.b.name); nameCache.set(n.b.id, n.b.name);
        return { building_id: n.b.id, name: n.b.name, address: n.b.street, type: n.b.type, stories: n.b.stories, distance_m: Math.round(n.dist), direction: n.dir,
          people_now: n.now, [EXPOSED_LABEL[hazard].replace(/[^a-z]+/gi, "_")]: n.exposed, may_need_help: n.mobility,
          priority_score: sc.score, tier: sc.tier, flags: n.b.flags.map(f => FLAG_LABEL[f]), sprinklers: n.b.sprinklers === null ? "unknown" : n.b.sprinklers ? "yes" : "no" };
      });
      return { result: { radius_m: radius, hour, hazard, buildings_in_radius: a.nearby.length, people_now: a.people, may_need_help: a.mobility, exposed: a.exposed, exposed_meaning: EXPOSED_LABEL[hazard], ranked: top },
        summary: `${a.nearby.length} buildings within ${radius} m · ${a.people.toLocaleString()} people inside · ${a.mobility.toLocaleString()} may need help` };
    }
    case "get_building": {
      const id = Number(input.building_id), hazard = (input.hazard as Scenario) ?? ctx.scenario, hour = Number(input.hour ?? ctx.hour);
      const d = await dossier(id, ctx.reports);
      hooks.names(id, d.name); nameCache.set(id, d.name);
      const sc = scenarioScore(d, hazard, hour);
      return { result: {
        building_id: id, name: d.name, address: `${d.street}, ${d.city}`, type: d.type, stories: d.stories, height_ft: d.heightFeet, construction: d.material,
        sprinklers: d.sprinklers === null ? "unknown" : d.sprinklers ? "yes" : "no", sprinklers_source: ctx.reports[id]?.sprinklers ? "field report (unverified)" : "CoStar",
        built: d.built, elevators: d.elevators, units: d.apartment?.units ?? null, buildings_on_property: d.apartment?.buildings ?? 1, community: d.apartment?.lifestyle ?? null,
        walkup: d.apartment?.walkup ?? null, people_now: peopleAt(d, hour), priority: { score: sc.score, tier: sc.tier, factors: (sc.factors ?? []).map(f => `+${f.points} ${f.label}: ${f.detail}`) },
        data_confidence_percent: d.confidence,
      }, summary: `${d.name}: ${sc.tier} ${hazard} priority (${sc.score}), ${peopleAt(d, hour).toLocaleString()} inside` };
    }
    case "estimate_evacuation": {
      const id = Number(input.building_id), hazard = (input.hazard as Scenario) ?? ctx.scenario, hour = Number(input.hour ?? ctx.hour);
      const d = await dossier(id, ctx.reports);
      const closed = (Array.isArray(input.closed_stairs) ? input.closed_stairs : []).map(x => String(x).toUpperCase().slice(0, 1)).filter(Boolean);
      const est = estimateEvacuation(d, hour, hazard, { closedStairs: 0 });
      if (!est) return { result: { building_id: id, error: "No occupancy estimate for this building." }, summary: `${d.name}: no occupancy estimate` };
      const totalStairs = est.exits;
      const closedIdx = closed.map(c => c.charCodeAt(0) - 65).filter(i => i >= 0 && i < totalStairs);
      const after = estimateEvacuation(d, hour, hazard, { closedStairs: closedIdx.length })!;
      // Synthetic stair layout (no floor plans exist): stairs spread along the plate, fire near Stair A.
      const stories = Math.max(1, d.stories ?? 1);
      const stairs: V2[] = Array.from({ length: totalStairs }, (_, i) => [i * 40, 0]);
      // fire_floor 0 in a fire: the fire is in another building, so this one is an exposure: leave on instruction.
      const exposure = hazard === "fire" && !(Number(input.fire_floor) > 0);
      const fireFloor = Math.min(stories, Math.max(1, Number(input.fire_floor) || Math.ceil(stories / 2))) - 1;
      const plan = exposure ? planNeighbor(stories, stairs, est.premove, "a nearby building")
        : planHazard({ scenario: hazard, stories, stairs, fireFloor, fire: [5, 0], premove: est.premove, highrise: d.flags.includes("highrise"), belowGrade: d.flags.includes("belowgrade") });
      if (exposure) { est.total = [est.total[0] + 3, est.total[1] + 6]; after.total = [after.total[0] + 3, after.total[1] + 6]; }
      for (const f of plan.floors) closedIdx.forEach(i => { f.open[i] = false; });
      const fmt = (r: [number, number]) => `${Math.max(1, Math.round(r[0]))}-${Math.ceil(r[1])} min`;
      // Summarise long buildings around the hazard so the model gets the floors that matter.
      const keep = (i: number) => stories <= 10 || Math.abs(i - fireFloor) <= 2 || i === 0 || i === stories - 1;
      const floors = plan.floors.map((f, i) => ({ floor: i + 1, role: f.label.split(" · ")[1], priority: f.priority, action: f.action,
        starts_after_min: f.premove, stairs: f.open.map((o, si) => o ? stairName(si) : null).filter(Boolean), first_instruction: f.advice[0] })).filter((_, i) => keep(i));
      return { result: {
        building_id: id, hazard, role: exposure ? "exposure building (fire is elsewhere)" : hazard === "fire" ? `fire building, fire on floor ${fireFloor + 1}` : hazard, method: after.method === "up" ? "ground floor moves up to Floor 2 (vertical refuge)" : after.method === "stairs" ? "down the stairs (Pauls SFPE formula)" : "out through exit doors",
        people_moving: after.people, code_minimum_stairs: totalStairs, closed_stairs: closedIdx.map(stairName),
        attack_stair_for_firefighters: plan.attack != null ? stairName(plan.attack) : null,
        time_range: fmt(after.total), time_range_before_closures: closedIdx.length ? fmt(est.total) : null,
        may_need_help: after.assisted, notes: after.notes, floors,
        caveat: "No floor plans exist in the data: stair count is the code minimum and positions are inferred.",
        stairs_open: Array.from({ length: totalStairs }, (_, i) => i).filter(i => !closedIdx.includes(i) && i !== plan.attack).map(stairName),
      }, summary: `${d.name}: ${fmt(after.total)} to evacuate${closedIdx.length ? ` (was ${fmt(est.total)} before ${closedIdx.map(stairName).join(", ")} closed)` : ""} · ${totalStairs - closedIdx.length - (plan.attack != null && !closedIdx.includes(plan.attack) ? 1 : 0)} of ${totalStairs} stairs usable by occupants` };
    }
    case "scan_exterior": {
      const id = Number(input.building_id);
      const [p, det] = await Promise.all([getJson(`/api/vexcel/${id}/parcel?v=3`), getJson(`/api/vexcel/${id}/detect`)]);
      const group = (label: string) => ({ "solar panel": "hazard", "construction scaffolding": "hazard", "rooftop hvac unit": "hazard", "fire hydrant": "resource", "swimming pool": "resource", "parked car": "obstacle" } as Record<string, string>)[label] ?? "hazard";
      const found = (det.found ?? []).map((f: { label: string; count: number; best: number }) => ({ object: f.label, count: f.count, group: group(f.label), best_confidence: f.best }));
      return { result: { building_id: id, roof: { material: p.roofMaterial, shape: p.roofShape, condition_of_5: p.roofCondition }, structures_on_parcel: p.structureCount, imagery: p.collection, detections: found,
        searched_for: det.labels, note: "Model detections on past imagery, not live conditions." },
        summary: found.length ? found.map((f: { count: number; object: string; group: string }) => `${f.count} ${f.object} (${f.group})`).join(", ") : "No listed objects found" };
    }
    case "find_staging": {
      const id = Number(input.building_id);
      const exclude = new Set((Array.isArray(input.exclude) ? input.exclude : []).map(Number));
      const st: Staging = await getJson(`/api/vexcel/${id}/staging`);
      const lead = await dossier(id, ctx.reports);
      const heightM = lead.heightFeet ? lead.heightFeet * 0.3048 : (lead.stories ?? 1) * (lead.class === "residential" ? 3.1 : 3.8);
      const collapse = Math.max(30, Math.round(heightM * 1.5));
      const checks: Record<number, StagingCheck> = {};
      await Promise.all(st.candidates.map(async (_, i) => { if (!exclude.has(i)) { try { checks[i] = await getJson(`/api/vexcel/${id}/staging-check-${i}`); } catch {} } }));
      hooks.staging(id, st, checks);
      const list = st.candidates.map((c, i) => ({ candidate: i, excluded: exclude.has(i), distance_m: c.dist, direction: c.dir, area_m2: c.areaM2,
        inside_collapse_zone: c.dist < collapse,
        cross_check: checks[i] ? { parked_cars: checks[i].cars, scaffolding: checks[i].scaffolding, free_m2: checks[i].freeM2, percent_full: Math.round(100 * checks[i].cars * 25 / Math.max(1, checks[i].areaM2)), status: checks[i].status } : null }));
      return { result: { building_id: id, collapse_zone_m: collapse, candidates: list, method: "Vexcel embedding search for 'large empty paved parking lot', then Vexcel object detection on each lot",
        note: "Imagery is not live; confirm on arrival." },
        summary: list.map(c => `Lot #${c.candidate} (${c.distance_m} m ${c.direction}): ${c.excluded ? "ruled out" : c.cross_check ? `${c.cross_check.parked_cars} cars, about ${c.cross_check.percent_full}% full` : "not checked"}`).join(" · ") };
    }
    case "issue_placard": {
      const id = Number(input.building_id);
      hooks.placard(id);
      return { result: { building_id: id, placard: `/building?id=${id}&s=${ctx.scenario}&placard=1`, field_verification: `/verify?id=${id}` }, summary: `Placard and field QR ready for ${nm(id)}` };
    }
    case "submit_plan": {
      hooks.plan(input as unknown as Plan);
      const p = input as unknown as Plan;
      return { result: { ok: true }, summary: `Plan submitted: ${p.priorities?.length ?? 0} buildings ranked${p.staging?.candidate >= 0 ? `, staging at lot #${p.staging.candidate}` : ""}` };
    }
  }
  throw new Error(`Unknown tool ${name}`);
}

/** A plain sentence for a tool call, so the log reads like a briefing, not JSON. */
export function describeCall(name: string, input: Record<string, unknown>) {
  const h = Number(input.hour), hz = String(input.hazard ?? "");
  const hr = Number.isInteger(h) ? `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}` : "";
  switch (name) {
    case "find_buildings_near": return `Every building within ${input.radius_m} m of the pin, ${hz} at ${hr}`;
    case "get_building": return `${nm(input.building_id)}: facts and ${hz} priority`;
    case "estimate_evacuation": {
      const closed = (input.closed_stairs as string[] | undefined) ?? [];
      return `${nm(input.building_id)}: ${hz === "fire" ? (Number(input.fire_floor) > 0 ? `fire on floor ${input.fire_floor}` : "fire in a neighbouring building") : hz}${closed.length ? `, stair ${closed.join(", ")} out of use` : ""}`;
    }
    case "scan_exterior": return `${nm(input.building_id)}: roof and surroundings from aerial imagery`;
    case "find_staging": { const ex = (input.exclude as number[] | undefined) ?? []; return `Open lots near ${nm(input.building_id)}${ex.length ? `, excluding lot ${ex.map(x => "#" + x).join(", ")}` : ""}`; }
    case "issue_placard": return nm(input.building_id);
    case "submit_plan": return `${(input.priorities as unknown[] | undefined)?.length ?? 0} buildings, in priority order`;
  }
  return "";
}

const TOOL_TITLES: Record<string, string> = {
  find_buildings_near: "Finding buildings near the incident", get_building: "Reading the building record", estimate_evacuation: "Estimating evacuation (SFPE)",
  scan_exterior: "Scanning the exterior (Vexcel AI)", find_staging: "Finding and cross-checking staging lots", issue_placard: "Issuing door placard", submit_plan: "Submitting triage plan",
};

type Block = { type: string; [k: string]: unknown };
type Msg = { role: "user" | "assistant"; content: string | Block[] };

/** Claude loop. Returns the conversation so a complication can continue it. */
export async function runClaude(messages: Msg[], ctx: Context, hooks: Hooks, maxSteps = 16): Promise<Msg[]> {
  for (let step = 0; step < maxSteps; step++) {
    if (hooks.cancelled()) return messages;
    const r = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages }) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `Agent request failed (${r.status})`);
    const content = body.content as Block[];
    messages = [...messages, { role: "assistant", content }];   // keep every block (thinking included) unchanged
    for (const b of content) {
      if (b.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim()) hooks.log({ kind: "think", title: "Reasoning", detail: b.thinking.trim() });
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) hooks.log({ kind: "note", title: b.text.trim() });
    }
    if (body.stop_reason === "refusal") { hooks.log({ kind: "error", title: "Claude declined this request." }); return messages; }
    if (body.stop_reason !== "tool_use") return messages;
    const uses = content.filter(b => b.type === "tool_use") as { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }[];
    const results = await Promise.all(uses.map(async u => {
      hooks.log({ kind: "tool", title: TOOL_TITLES[u.name] ?? u.name, detail: describeCall(u.name, u.input ?? {}), raw: JSON.stringify(u.input, null, 1) });
      try {
        const { result, summary } = await runTool(u.name, u.input ?? {}, ctx, hooks);
        hooks.log({ kind: "result", title: summary });
        return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(result) };
      } catch (e) {
        hooks.log({ kind: "error", title: `${u.name} failed: ${(e as Error).message}` });
        return { type: "tool_result", tool_use_id: u.id, content: (e as Error).message, is_error: true };
      }
    }));
    messages = [...messages, { role: "user", content: results }];   // all results in one user message
  }
  hooks.log({ kind: "error", title: "Stopped after the step limit." });
  return messages;
}

export function briefing(ctx: Context) {
  const h = ctx.hour;
  return `Incident: ${ctx.scenario.toUpperCase()} reported at ${ctx.incident.lat.toFixed(6)}, ${ctx.incident.lon.toFixed(6)} at ${h % 12 || 12}:00 ${h < 12 ? "AM" : "PM"} (hour ${h}).`
    + ` Search radius ${ctx.incident.radius} m.`
    + (ctx.focusBuilding ? ` The caller named building ${ctx.focusBuilding}.` : "")
    + (ctx.reportedFloor ? ` Reported floor: ${ctx.reportedFloor}.` : "")
    + " Prepare the First-Due Engine Triage Plan.";
}

export type PlannerState = {
  excluded: number[];                      // staging lots ruled out
  closed: Record<number, string[]>;        // stairs out of use, by building
  fireFloor: number | null;                // 1-based, as reported or updated
  trapped: { id: number; floor: number | null; count: number | null; elevator?: boolean }[];
  fireBuilding: number | null;             // the building the incident is in; fixed once chosen
  lastFireFloor?: number | null;
  version: number;
};

export function newPlannerState(): PlannerState { return { excluded: [], closed: {}, fireFloor: null, trapped: [], fireBuilding: null, version: 0 }; }

export type Complication =
  | { kind: "stair"; letter: string; building: number | null }
  | { kind: "floor"; floor: number }
  | { kind: "trapped"; building: number | null; floor: number | null; count: number | null; elevator?: boolean }
  | { kind: "staging"; lot: number | null }
  | { kind: "hazard"; to: Scenario }
  | { kind: "note"; text: string }
  | { kind: "unknown" };

/** Understands a complication typed in plain words, without an AI model. */
export function parseComplication(text: string, candidates: { id: number; name: string }[], scenario: Scenario): Complication {
  const t = text.toLowerCase();
  const building = candidates.find(c => t.includes(c.name.toLowerCase()) || c.name.toLowerCase().split(/\s+/).filter(w => w.length > 3).some(w => t.includes(w)))?.id ?? null;
  const num = (re: RegExp) => { const m = t.match(re); return m ? Number(m[1]) : null; };
  const floor = num(/(?:floor|level)\s*(\d{1,3})/) ?? num(/(\d{1,3})(?:st|nd|rd|th)\s*(?:floor|level)/);
  const hz = t.match(/\b(flood|flooding|blackout|power (?:outage|cut|failure)|fire)\b/);
  if (hz && /(switch|now|turn|becom|instead|actually|hazard|it'?s a|is a)/.test(t)) {
    const to: Scenario = hz[1].startsWith("flood") ? "flood" : hz[1] === "fire" ? "fire" : "blackout";
    if (to !== scenario) return { kind: "hazard", to };
  }
  const count = num(/(\d{1,4})\s*(?:people|persons|residents|occupants|patients|kids|children|adults)/);
  if (/elevator|lift/.test(t)) {
    // People in a stalled elevator are a rescue; an empty stalled elevator is just a note.
    if (count != null || /(people|someone|person|resident|trapped|inside)/.test(t)) return { kind: "trapped", building, floor, count, elevator: true };
    return { kind: "note", text: "Elevators are already excluded from evacuation routes; noted for crews." };
  }
  const groundFloor = /ground floor|first floor|lobby/.test(t) ? 1 : null;
  if (/trapped|stuck|can'?t get out|cannot get out|need(?:s)? rescue/.test(t)) return { kind: "trapped", building, floor: floor ?? groundFloor, count };
  const stair = t.match(/stair(?:well|way|case)?\s*([a-h])\b/);
  if (stair) return { kind: "stair", letter: stair[1].toUpperCase(), building };
  if (/(stair|stairwell)/.test(t) && /(smoke|blocked|collapsed|unusable|compromised|fire|locked|flood|water|dark|light)/.test(t)) return { kind: "stair", letter: scenario === "fire" ? "B" : "A", building };
  if (/(staging|lot|parking)/.test(t) && /(block|closed|unusable|full|occupied|flooded|not available|taken)/.test(t)) return { kind: "staging", lot: num(/#\s*(\d)/) ?? num(/lot\s*(\d)/) };
  if (floor != null && /(spread|now on|moved|reached|extend|jumped|going up|on floor|on the)/.test(t)) return { kind: "floor", floor };
  return { kind: "unknown" };
}

type Ranked = { building_id: number; name: string; people_now: number; may_need_help: number; flags: string[]; sprinklers: string; distance_m: number; direction: string; priority_score: number; stories: number | null };
type Evac = { time_range: string; time_range_before_closures: string | null; attack_stair_for_firefighters: string | null; stairs_open: string[]; role: string; may_need_help: number };

const hazardWord = (s: Scenario) => s === "fire" ? "Fire" : s === "flood" ? "Flood" : "Blackout";

/** What changed between two plan versions, in plain words. */
function diff(prev: Plan, next: Plan): string[] {
  const out: string[] = [];
  const floorOf = (p: Plan) => p.headline.match(/on floor (\d+)/)?.[1];
  if (floorOf(prev) && floorOf(next) && floorOf(prev) !== floorOf(next)) out.push(`Fire floor moved from ${floorOf(prev)} to ${floorOf(next)}.`);
  const rankOf = (p: Plan) => new Map(p.priorities.map(x => [x.building_id, x]));
  const a = rankOf(prev), b = rankOf(next);
  for (const [id, x] of b) {
    const before = a.get(id);
    if (!before) out.push(`${nm(id)} added at priority ${x.rank}.`);
    else if (before.rank !== x.rank) out.push(`${nm(id)} moved from priority ${before.rank} to ${x.rank}.`);
    if (before && before.evacuation !== x.evacuation) out.push(`${nm(id)}: evacuation ${before.evacuation.split(";")[0]} → ${x.evacuation.split(";")[0]}.`);
    if (before && before.action !== x.action) out.push(`${nm(id)}: new task: ${x.action}.`);
  }
  for (const id of a.keys()) if (!b.has(id)) out.push(`${nm(id)} dropped from the top priorities.`);
  if (prev.staging.candidate !== next.staging.candidate) out.push(next.staging.candidate >= 0 ? `Staging moved from lot #${prev.staging.candidate} to lot #${next.staging.candidate}.` : "No usable staging lot left in imagery.");
  return out;
}

/**
 * HavenLens Planner: an offline planning agent (no AI model). It assesses the scene, decides which buildings
 * are worth investigating, runs the tools, checks its own staging choice, and explains every decision.
 */
export async function runRules(ctx: Context, hooks: Hooks, previous: Plan | null, complication: string | null, state: PlannerState): Promise<Plan | null> {
  const think = (title: string, detail?: string) => hooks.log({ kind: "think", title, detail });
  const call = async (name: string, input: Record<string, unknown>) => {
    if (hooks.cancelled()) throw new Error("cancelled");
    hooks.log({ kind: "tool", title: TOOL_TITLES[name], detail: describeCall(name, input), raw: JSON.stringify(input, null, 1) });
    const out = await runTool(name, input, ctx, hooks);
    hooks.log({ kind: "result", title: out.summary });
    return out.result as Record<string, never>;
  };
  const hourText = `${ctx.hour % 12 || 12} ${ctx.hour < 12 ? "AM" : "PM"}`;

  // 1. Assess the scene.
  const near = await call("find_buildings_near", { radius_m: ctx.incident.radius, hour: ctx.hour, hazard: ctx.scenario }) as unknown as { ranked: Ranked[]; people_now: number; may_need_help: number; exposed: number; exposed_meaning: string };
  if (!near.ranked.length) { think("No CoStar buildings in range.", "Widen the radius or move the pin."); return null; }
  think(`Scene: ${near.ranked.length} buildings in range, ${near.people_now.toLocaleString()} people inside at ${hourText}.`,
    `${near.exposed ? `${near.exposed.toLocaleString()} ${near.exposed_meaning}; ` : ""}${near.may_need_help.toLocaleString()} may need help to evacuate.`);

  // 2. Decide which buildings to investigate: named or trapped first, then by triage until most people who need help are covered.
  // The building the incident is in stays fixed across re-plans: the caller's building, or the top-ranked one.
  if (state.fireBuilding == null || !near.ranked.some(r => r.building_id === state.fireBuilding)) state.fireBuilding = ctx.focusBuilding ?? near.ranked[0].building_id;
  const forced = [state.fireBuilding, ...state.trapped.map(t => t.id)].filter((x, i, a): x is number => x != null && a.indexOf(x) === i);
  let ranked = [...near.ranked];
  for (const id of [...forced].reverse()) { const i = ranked.findIndex(r => r.building_id === id); if (i > 0) ranked = [ranked[i], ...ranked.slice(0, i), ...ranked.slice(i + 1)]; }
  const totalHelp = ranked.reduce((t, r) => t + r.may_need_help, 0) || 1;
  const picked: Ranked[] = [];
  let covered = 0;
  for (const r of ranked) {
    if (picked.length >= 4) break;
    if (picked.length >= 2 && covered / totalHelp >= 0.8 && !forced.includes(r.building_id)) break;
    picked.push(r); covered += r.may_need_help;
  }
  for (const r of picked) {
    const why = [`${r.people_now.toLocaleString()} inside`, `${r.may_need_help} may need help`, ...r.flags.filter(f => f !== "Pre-1975").slice(0, 2).map(f => f.toLowerCase()), r.sprinklers === "unknown" ? "sprinklers unknown" : r.sprinklers === "no" ? "no sprinklers" : ""].filter(Boolean).join(", ");
    think(`Investigate ${r.name}${r.building_id === state.fireBuilding ? (ctx.scenario === "fire" ? " (the fire building)" : " (the incident building)") : ""}${state.trapped.some(t => t.id === r.building_id) ? " (people reported trapped)" : ""}.`, why + `, ${r.distance_m} m ${r.direction}.`);
  }
  const skipped = ranked.slice(picked.length, picked.length + 2);
  if (skipped.length) think(`Not investigating ${skipped.map(r => r.name).join(" or ")} yet.`, `The ${picked.length} buildings above cover ${Math.round(100 * covered / totalHelp)}% of the people who may need help.`);

  // 3. The fire floor.
  const lead = picked[0];
  let ff = state.fireFloor ?? ctx.reportedFloor ?? null;
  if (ctx.scenario === "fire" && ff == null) { ff = Math.max(1, Math.ceil((lead.stories ?? 2) / 2)); think(`Fire floor not reported: assuming floor ${ff} of ${lead.stories ?? "?"} in ${lead.name}.`, "Update it as soon as crews report the real floor."); }
  if (ctx.scenario === "fire" && state.lastFireFloor != null && ff !== state.lastFireFloor)
    think(`Fire is now on floor ${ff}, not ${state.lastFireFloor}, in ${lead.name}.`, `Floor ${ff} leaves first; floors ${ff! + 1}${(lead.stories ?? 0) > ff! + 1 ? ` and ${ff! + 2}` : ""} are now directly above the fire and go next.`);
  state.lastFireFloor = ff;

  // 4. Records and evacuation for each building.
  const evac: Record<number, Evac> = {};
  for (const [i, r] of picked.entries()) {
    await call("get_building", { building_id: r.building_id, hazard: ctx.scenario, hour: ctx.hour });
    evac[r.building_id] = await call("estimate_evacuation", { building_id: r.building_id, hazard: ctx.scenario, hour: ctx.hour, fire_floor: i === 0 && ctx.scenario === "fire" ? ff ?? 0 : 0, closed_stairs: state.closed[r.building_id] ?? [] }) as never;
  }
  const le = evac[lead.building_id];
  if (le?.attack_stair_for_firefighters) think(`In ${lead.name}, Stair ${le.attack_stair_for_firefighters} is nearest the fire: keep it for firefighters.`, `Occupants use ${le.stairs_open.join(", ") || "no other stair"}. Stair positions are inferred from building code.`);
  for (const r of picked) { const e = evac[r.building_id]; if (e?.time_range_before_closures) think(`Lost stairs slow ${r.name}: ${e.time_range_before_closures} → ${e.time_range}.`); }
  // No free stair left: occupants must share the firefighters' stair, and floors far from the fire may be safer staying put.
  const noStair = new Set<number>();
  for (const r of picked) {
    const e = evac[r.building_id];
    if (e && e.stairs_open.length === 0) {
      noStair.add(r.building_id);
      think(`${r.name} has no free stair left${e.attack_stair_for_firefighters ? `: occupants must share Stair ${e.attack_stair_for_firefighters} with firefighters` : ""}.`,
        "Evacuate the fire floor and the floors just above it first; consider telling floors far from the fire to stay in their units with doors closed until called.");
    }
  }

  // 5. Exterior.
  const scan = await call("scan_exterior", { building_id: lead.building_id }).catch(() => null) as { detections?: { object: string; count: number; group: string }[] } | null;
  const det = scan?.detections ?? [];
  for (const dd of det) {
    if (dd.object === "solar panel") think(`Solar panels on ${lead.name}: live even with grid power cut.`, "Warn roof and ventilation crews.");
    if (dd.object === "construction scaffolding") think(`Scaffolding at ${lead.name}: collapse and access hazard.`);
    if (dd.object === "fire hydrant" || dd.object === "swimming pool") think(`${dd.count} ${dd.object}${dd.count > 1 ? "s" : ""} near ${lead.name}: possible water supply.`);
  }

  // 6. Staging, cross-checked: reject lots that are excluded, inside the collapse zone, or blocked.
  const st = await call("find_staging", { building_id: lead.building_id, exclude: state.excluded }).catch(() => null) as { collapse_zone_m?: number; candidates?: { candidate: number; excluded: boolean; distance_m: number; direction: string; inside_collapse_zone: boolean; cross_check: { parked_cars: number; percent_full: number; status: string } | null }[] } | null;
  const usable: NonNullable<typeof st>["candidates"] = [];
  for (const c of st?.candidates ?? []) {
    if (c.excluded) { think(`Lot #${c.candidate} ruled out earlier.`); continue; }
    if (c.inside_collapse_zone) { think(`Reject lot #${c.candidate}: ${c.distance_m} m away, inside ${lead.name}'s ${st!.collapse_zone_m} m collapse zone.`); continue; }
    if (c.cross_check?.status === "blocked") { think(`Reject lot #${c.candidate}: imagery shows it about ${c.cross_check.percent_full}% full (${c.cross_check.parked_cars} parked cars).`); continue; }
    usable!.push(c);
  }
  usable!.sort((a, b) => (a.cross_check?.status === "clear" ? 0 : 1) - (b.cross_check?.status === "clear" ? 0 : 1) || a.distance_m - b.distance_m);
  const pick = usable![0] ?? null;
  if (pick) think(`Stage at lot #${pick.candidate}: ${pick.distance_m} m ${pick.direction}, about ${pick.cross_check?.percent_full ?? "?"}% full in imagery.`, ctx.scenario === "flood" ? "Flood: for apparatus only, never an evacuee assembly point; its elevation is not verified." : "Outside the collapse zone; confirm access on arrival.");
  else think("No safe staging lot found in imagery.", "The commander chooses staging on arrival.");

  // 7. Placards.
  for (const r of picked) await call("issue_placard", { building_id: r.building_id });

  // 8. The plan.
  const task = (r: Ranked, i: number) => {
    const t = state.trapped.find(x => x.id === r.building_id);
    const rescue = t ? `Rescue: ${t.count ? `${t.count} people` : "people"} reported trapped${t.elevator ? " in an elevator" : ""}${t.floor ? ` on floor ${t.floor}` : ""}; assign a dedicated rescue company` : "";
    if (t && i !== 0) return rescue;
    const e = evac[r.building_id];
    const also = rescue ? `. ${rescue}` : "";
    if (ctx.scenario === "flood") return ((r.stories ?? 1) >= 2 ? "Move the ground floor up to Floor 2 and clear any below-grade levels; upper floors shelter in place" : "Evacuate early toward higher ground") + also;
    if (ctx.scenario === "blackout") return `Stairs-only evacuation with lights; carry-down help for ${r.may_need_help} people who may need it` + also;
    if (i === 0 && noStair.has(r.building_id)) return `First engine on scene: attack the fire on floor ${ff} via Stair ${e?.attack_stair_for_firefighters ?? "A"}, shared with evacuees; evacuate the fire floor and floors above first, others stay in place until called${also}`;
    if (i === 0) return `First engine on scene: attack the fire on floor ${ff}${e?.attack_stair_for_firefighters ? ` via Stair ${e.attack_stair_for_firefighters}` : ""}; search the fire floor and the floor above${also}`;
    return "Exposure building: check for fire spread and smoke, evacuate on order, search for people who need help";
  };
  const plan: Plan = {
    headline: `${hazardWord(ctx.scenario)}${ctx.scenario === "fire" ? ` on floor ${ff} of` : " at"} ${lead.name}, ${hourText}: ${picked.reduce((t, r) => t + r.people_now, 0).toLocaleString()} people in the ${picked.length} priority buildings, ${picked.reduce((t, r) => t + r.may_need_help, 0).toLocaleString()} may need help.`,
    priorities: picked.map((r, i) => ({
      building_id: r.building_id, rank: i + 1, action: task(r, i),
      reason: `${r.people_now.toLocaleString()} inside, ${r.may_need_help} may need help${r.flags.length ? `; ${r.flags.slice(0, 3).join(", ").toLowerCase()}` : ""}; sprinklers ${r.sprinklers}`,
      evacuation: evac[r.building_id]?.time_range ?? "unknown",
      attack_stair: evac[r.building_id]?.attack_stair_for_firefighters ?? null,
      stairs_open: evac[r.building_id]?.stairs_open ?? [],
      closed_stairs: state.closed[r.building_id] ?? [],
    })),
    staging: pick ? { candidate: pick.candidate, building_id: lead.building_id, reason: `${pick.distance_m} m ${pick.direction} of ${lead.name}, about ${pick.cross_check?.percent_full ?? "?"}% full in imagery${ctx.scenario === "flood" ? ". Apparatus only; elevation not verified" : ""}.` }
      : { candidate: -1, building_id: lead.building_id, reason: "No safe lot found in imagery: choose staging on arrival." },
    hazards: det.filter(d => d.group === "hazard").map(d => `${d.count} × ${d.object} at ${lead.name}`),
    placards: picked.map(r => r.building_id),
    changes: "",
    open_questions: [
      ...picked.filter(r => r.sprinklers === "unknown").map(r => `Sprinklers at ${r.name} are not recorded: confirm on arrival (scan its QR).`),
      ...(ctx.scenario === "fire" && !ctx.reportedFloor && !state.fireFloor ? [`Confirm the fire floor in ${lead.name}.`] : []),
      ...(near.may_need_help >= 100 ? [`${near.may_need_help.toLocaleString()} people may need help: consider extra rescue and EMS resources.`] : []),
      "Stair positions are inferred from building code: confirm with each building's fire plan.",
    ],
    version: ++state.version,
  };
  if (previous) plan.changes = [complication ? `Because: ${complication}` : "", ...diff(previous, plan)].filter(Boolean).join("\n") || "No change to the plan.";
  await call("submit_plan", plan as unknown as Record<string, unknown>);
  return plan;
}
