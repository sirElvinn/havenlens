import { peopleAt, type Dossier } from "./dossier";
import { mobilityAt, type Scenario } from "./scenario";

// Engineering assumptions, all shown to the user. No stair or exit data exists in any supplied
// dataset, so the estimate assumes the building meets code minimums.
export const EGRESS = {
  stairWidthM: 1.118,      // IBC 1011.2 minimum stair width, 44 in
  boundaryLayerM: 0.15,    // SFPE effective-width boundary layer, each side
  doorWidthM: 0.914,       // 36 in exit door
  doorFlow: 1.32,          // SFPE maximum specific flow through doors, persons/s/m effective width
  walkSpeed: 1.2,          // m/s, typical adult walking speed
  assistedSpeed: 0.8,      // m/s, wheelchair users and assisted evacuees on level ground
  areaPerPerson: 1.0,      // m² per standing person at an assembly area (comfortable density)
  usableShare: 0.5,        // share of an open lot assumed usable (parked cars, islands, lanes)
};

/** IBC 1006.3.2: minimum exits per story by occupant load. */
export function exitsFor(perStory: number) {
  return perStory > 1000 ? 4 : perStory > 500 ? 3 : 2;
}

export type EvacEstimate = {
  people: number; upper: number; stories: number; exits: number; perStory: number;
  method: "stairs" | "doors" | "up";
  premove: [number, number];   // minutes
  movement: number;            // minutes
  total: [number, number];     // minutes
  assisted: number;            // people who may need help (not in the total)
  notes: string[];
};

/**
 * Total evacuation time, as a planning range.
 * Multi-story: Pauls' empirical formula for uncontrolled total evacuation down stairs
 *   T (min) = 0.68 + 0.081 · p^0.73, p = evacuees per metre of effective stair width (SFPE Handbook).
 * Single-story: hydraulic flow through code-minimum exit doors plus about a minute of travel.
 * Pre-movement (noticing, deciding, gathering) is added as a range: longer when occupants are asleep.
 */
export function estimateEvacuation(d: Dossier, hour: number, scenario: Scenario, opts: { closedStairs?: number } = {}): EvacEstimate | null {
  const people = peopleAt(d, hour);
  if (!d.people || people <= 0) return null;
  const stories = Math.max(1, d.stories ?? 1);
  const perStory = Math.ceil(people / stories);
  // Stairs lost to a complication (smoke, the fire department's attack stair) leave fewer for everyone else.
  const exits = Math.max(1, exitsFor(perStory) - (opts.closedStairs ?? 0));
  const asleep = (d.class === "residential" || d.class === "hotel") && (hour >= 23 || hour < 6);
  const premove: [number, number] = asleep ? [3, 8] : [1, 3];
  if (scenario === "flood" && stories >= 2) {
    // Flood: the ground floor moves up to Floor 2 (vertical refuge); upper floors stay put.
    const ground = Math.round(people / stories);
    const up = Math.max(1, exitsFor(ground) - (opts.closedStairs ?? 0));
    const movement = (ground / (up * 0.9) + 60) / 60;   // stair inflow 0.9 p/s per stair, plus about a minute to reach it
    const fp: [number, number] = [0.5, 2];
    const notes = ["Upper floors shelter in place: going outside into moving water is more dangerous than staying above it.",
      "Six inches of moving water can knock an adult down; a foot can float a car."];
    if (d.flags.includes("belowgrade")) notes.unshift("Below-grade levels (basement, garage, concourse) are cleared first.");
    return { people: ground, upper: ground, stories, exits: up, perStory, method: "up", premove: fp, movement, total: [fp[0] + movement * 0.85, fp[1] + movement * 1.25], assisted: Math.round(mobilityAt(d, hour) / stories), notes };
  }
  let movement: number, method: EvacEstimate["method"], upper = 0;
  if (stories >= 2) {
    upper = Math.round(people * (stories - 1) / stories);
    const effective = exits * (EGRESS.stairWidthM - 2 * EGRESS.boundaryLayerM);
    const p = upper / effective;
    movement = 0.68 + 0.081 * Math.pow(p, 0.73);
    method = "stairs";
  } else {
    const effective = exits * (EGRESS.doorWidthM - 2 * EGRESS.boundaryLayerM);
    movement = (people / (effective * EGRESS.doorFlow) + 60) / 60;
    method = "doors";
  }
  const notes: string[] = [];
  if (asleep) notes.push("Occupants are likely asleep, so noticing and reacting takes longer.");
  if (scenario === "blackout") notes.push("No elevators: everyone above the ground floor uses the stairs, in emergency lighting only.");
  if (scenario === "fire") notes.push("Elevators are normally recalled in a fire alarm, so the estimate assumes stairs only.");
  if (scenario === "flood") notes.push("Leaving into floodwater can be more dangerous than sheltering on upper floors. That call belongs to incident command.");
  if (d.flags.includes("senior") || d.flags.includes("healthcare")) notes.push("Many occupants may move slowly or need staff assistance, so expect the upper end of the range or longer.");
  const lo = premove[0] + movement * 0.85, hi = premove[1] + movement * 1.25;
  return { people, upper, stories, exits, perStory, method, premove, movement, total: [lo, hi], assisted: mobilityAt(d, hour), notes };
}

export function fmtMinutes(m: number) {
  const total = Math.round(m * 60);
  const mm = Math.floor(total / 60), ss = total % 60;
  return mm ? `${mm} min${ss >= 30 ? " 30 s" : ""}` : `${ss} s`;
}

/** Records-based accessibility readiness: what is known, missing or a concern. */
export function accessChecks(d: Dossier, scenario: Scenario): { state: "ok" | "warn" | "unknown"; label: string; detail: string }[] {
  const checks: { state: "ok" | "warn" | "unknown"; label: string; detail: string }[] = [];
  const stories = d.stories ?? null;
  if (stories === 1) checks.push({ state: "ok", label: "Single story", detail: "No stairs needed to reach an exit level." });
  else if (d.elevators) checks.push({ state: scenario === "blackout" || scenario === "fire" ? "warn" : "ok", label: `${d.elevators} elevator${d.elevators > 1 ? "s" : ""} on record`,
    detail: scenario === "blackout" ? "Out of service without power. Generator backup is not recorded." : scenario === "fire" ? "Normally recalled in a fire alarm. Occupant-evacuation elevators are not recorded." : "Step-free vertical travel exists in normal operation." });
  else if (d.apartment?.walkup) checks.push({ state: "warn", label: "Walk-up", detail: "No elevator: residents on upper floors depend on stairs." });
  else checks.push({ state: "unknown", label: "Elevators not on record", detail: "Can't tell whether there is step-free vertical travel." });
  if (stories && stories >= 2) checks.push({ state: "unknown", label: "Stair widths and areas of refuge", detail: "Not in any supplied dataset. ADA egress compliance needs a site survey." });
  checks.push({ state: "unknown", label: "Step-free exit doors and ramps", detail: "Not in any supplied dataset. Verify on site." });
  checks.push({ state: "unknown", label: "Step-free route to the assembly area", detail: "The walking route follows mapped streets and paths. Curb ramps and steps are not verified." });
  return checks;
}
