import { peopleAt, type BuildingRow, type Factor, type Tier } from "./dossier";

export type Scenario = "fire" | "flood" | "blackout";

export const SCENARIOS: Record<Scenario, { label: string; verb: string; accent: string; blurb: string }> = {
  fire: { label: "Fire", verb: "fire", accent: "#ff5a3c", blurb: "Structure fire: height, sprinklers, construction and sleeping occupants drive risk." },
  flood: { label: "Flood", verb: "flood", accent: "#4ea8ff", blurb: "Flash flood: below-grade levels, ground-floor residents and low buildings with no upper-floor refuge." },
  blackout: { label: "Blackout", verb: "blackout", accent: "#c9a6ff", blurb: "Grid blackout: elevators stop, so height and residents who can't use stairs drive risk." },
};

export function parseScenario(v: string | null): Scenario {
  return v === "flood" || v === "blackout" ? v : "fire";
}

// Planning assumptions, shown on the "How we estimate" page.
export const MOBILITY_RATE = { general: 0.12, senior: 0.25, healthcare: 0.5 };

export function mobilityRate(b: Pick<BuildingRow, "flags">) {
  if (b.flags.includes("healthcare")) return MOBILITY_RATE.healthcare;
  if (b.flags.includes("senior")) return MOBILITY_RATE.senior;
  return MOBILITY_RATE.general;
}

/** People who may need help to evacuate (wheelchair users, people who can't manage stairs). */
export function mobilityAt(b: BuildingRow, hour: number) {
  return Math.round(peopleAt(b, hour) * mobilityRate(b));
}

const lowResidential = (b: BuildingRow) =>
  b.class === "residential" && (["Garden", "Low rise", "Townhome", "Single family home"].includes(b.style ?? "") || (b.stories != null && b.stories <= 3));

/** The group each scenario cares most about, at a given hour. */
export function exposedAt(b: BuildingRow, s: Scenario, hour: number) {
  const now = peopleAt(b, hour);
  const night = hour >= 23 || hour < 6;
  if (s === "fire") return night && (b.class === "residential" || b.class === "hotel") ? now : 0;
  if (s === "flood") {
    if (b.flags.includes("belowgrade") || lowResidential(b) || (b.stories ?? 99) <= 2) return Math.round(now / Math.max(1, b.stories ?? 1));
    return 0;
  }
  // Blackout: people with limited mobility above the ground floor, once elevators stop.
  const stories = b.stories ?? 1;
  return stories >= 3 ? Math.round(mobilityAt(b, hour) * (stories - 1) / stories) : 0;
}

export const EXPOSED_LABEL: Record<Scenario, string> = {
  fire: "likely asleep",
  flood: "at ground or below-grade level",
  blackout: "on upper floors, may need carrying down",
};

function factorsFor(b: BuildingRow, s: Exclude<Scenario, "fire">): Factor[] {
  const f: Factor[] = [];
  const add = (points: number, label: string, detail: string, kind: Factor["kind"] = "risk") => f.push({ points, label, detail, kind });
  const people = b.people ?? 0;
  if (s === "flood") {
    if (b.flags.includes("belowgrade")) add(25, "Below-grade levels", "Basement, lower level or concourse on record: these flood first");
    if (b.flags.includes("parking")) add(10, "Structured parking", "Parking levels on record: confirm whether any are below grade");
    if (lowResidential(b)) add(20, "Ground-floor residents", `${b.style ?? "Low-rise"} housing: many units open directly at grade`);
    if (b.stories != null && b.stories <= 2) add(12, "No upper-floor refuge", `${b.stories} stor${b.stories > 1 ? "ies" : "y"}: little room to shelter above the water`);
    else if (b.stories == null) add(4, "Story count unknown", "Can't tell whether upper floors offer refuge", "gap");
  } else {
    if (b.flags.includes("highrise")) add(30, "High-rise without elevators", `${b.stories ?? "?"} stories${b.heightFt ? `, ${b.heightFt} ft` : ""}: stairs are the only way down`);
    else if (b.stories != null && b.stories >= 4) add(15, "Mid-rise without elevators", `${b.stories} stories: upper floors depend on stairs`);
    if (b.flags.includes("old")) add(5, "Pre-1975 building", "Emergency lighting and generators may predate current code: verify", "gap");
  }
  if (b.flags.includes("senior")) add(s === "flood" ? 20 : 25, "Senior housing", s === "flood" ? "Residents may need assisted evacuation" : "Residents may rely on powered medical devices, oxygen or elevators");
  if (b.flags.includes("healthcare")) add(s === "flood" ? 20 : 25, "Healthcare occupancy", "Patients may be non-ambulatory or on powered equipment");
  if (people >= 1000) add(12, "Large population", `About ${people.toLocaleString()} people at the busiest hour`);
  else if (people >= 250) add(6, "Sizable population", `About ${people.toLocaleString()} people at the busiest hour`);
  return f;
}

/** Share of a residential building's occupants likely asleep at a given hour (planning assumption). */
export function asleepShare(hour: number) {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  return h >= 23 || h <= 5 ? 0.9 : h === 22 || h === 6 ? 0.6 : h === 7 ? 0.3 : 0.08;
}

export const SLEEP_POINTS: Record<Scenario, number> = { fire: 15, flood: 10, blackout: 8 };

/**
 * Sleeping occupancy, scaled by how many are likely asleep at this hour and by building size:
 * full points for 1,000+ people at 3 AM, a sliver for a small building at midday.
 */
export function sleepingFactor(b: BuildingRow, s: Scenario, hour: number): Factor | null {
  if (b.class !== "residential" && b.class !== "hotel") return null;
  const share = asleepShare(hour);
  const size = Math.min(1, Math.max(0.35, Math.log10(Math.max(10, b.people ?? 10)) / 3));
  const points = Math.round(SLEEP_POINTS[s] * (share / 0.9) * size);
  if (points < 1) return null;
  const why = s === "fire" ? "asleep and slow to notice an alarm" : s === "flood" ? "asleep when water rises" : "waking to dark corridors and dead elevators";
  return { points, label: "Sleeping occupancy", detail: `About ${Math.round(share * 100)}% of residents likely ${why} at this hour (${points} of ${SLEEP_POINTS[s]} points, scaled by building size)`, kind: "risk" };
}

const tierOf = (score: number): Tier => score >= 55 ? "High" : score >= 35 ? "Elevated" : "Standard";

type Scored = { score: number; tier: Tier; factors: Factor[] | null };
const cache = new WeakMap<BuildingRow, Map<string, Scored>>();

/**
 * Priority for a scenario at an hour. Fire starts from the pipeline's static score; flood and blackout are
 * computed here. Sleeping occupancy is added for all three and depends on the hour.
 */
export function scenarioScore(b: BuildingRow & { factors?: Factor[] }, s: Scenario, hour = 3): Scored {
  let entry = cache.get(b);
  if (!entry) { entry = new Map(); cache.set(b, entry); }
  const key = `${s}:${Math.floor(hour)}`;
  const hit = entry.get(key);
  if (hit) return hit;
  const sleep = sleepingFactor(b, s, hour);
  let base: number, factors: Factor[] | null;
  if (s === "fire") { base = b.score; factors = b.factors ? [...b.factors] : null; }
  else { factors = factorsFor(b, s); base = factors.reduce((t, x) => t + x.points, 0); }
  if (sleep && factors) factors.push(sleep);
  if (factors) factors.sort((x, y) => y.points - x.points);
  const score = Math.min(100, base + (sleep?.points ?? 0));
  const result = { score, tier: tierOf(score), factors };
  entry.set(key, result);
  return result;
}

export function populationTotals(buildings: BuildingRow[], scenario: Scenario, hour: number) {
  let now = 0, exposed = 0, high = 0, mobility = 0;
  for (const building of buildings) {
    now += peopleAt(building, hour);
    exposed += exposedAt(building, scenario, hour);
    mobility += mobilityAt(building, hour);
    if (scenarioScore(building, scenario, hour).tier === "High") high++;
  }
  return { now, exposed, high, mobility };
}
