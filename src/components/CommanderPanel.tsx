"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { briefing, newPlannerState, parseComplication, runClaude, runRules, type Context, type LogEntry, type Plan, type PlannerState, type Staging, type StagingCheck } from "../lib/agent";
import { hourLabel, type BuildingRow } from "../lib/dossier";
import type { Incident } from "../lib/incident";
import { useShareOrigin, type Reports } from "../lib/reports";
import { SCENARIOS, type Scenario } from "../lib/scenario";

type Props = {
  incident: Incident; hour: number; scenario: Scenario; buildings: BuildingRow[]; reports: Reports;
  call: { floor: number | null; buildingId: number | null; key: number } | null;
  onSwitchHazard: (s: Scenario) => void;
};

type Msg = Parameters<typeof runClaude>[0][number];

const KIND_LABEL: Record<LogEntry["kind"], string> = { user: "Input", think: "Reasoning", note: "Note", tool: "Action", result: "Result", plan: "Plan", error: "Problem" };

export default function CommanderPanel({ incident, hour, scenario, buildings, reports, call, onSwitchHazard }: Props) {
  const [mode, setMode] = useState<"claude" | "rules" | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [running, setRunning] = useState(false);
  const [names, setNames] = useState<Record<number, string>>({});
  const [staging, setStaging] = useState<{ id: number; st: Staging; checks: Record<number, StagingCheck> } | null>(null);
  const [placards, setPlacards] = useState<number[]>([]);
  const [auto, setAuto] = useState(true);
  const [text, setText] = useState("");
  const [hint, setHint] = useState("");
  const runId = useRef(0);
  const convo = useRef<Msg[]>([]);
  const planner = useRef<PlannerState>(newPlannerState());
  const planRef = useRef<Plan | null>(null);
  const pendingHazard = useRef<string | null>(null);
  const seq = useRef(0);
  const logBox = useRef<HTMLOListElement>(null);

  useEffect(() => { fetch("/api/agent/status").then(r => r.ok ? r.json() : { configured: false }).then(s => setMode(s.configured ? "claude" : "rules")).catch(() => setMode("rules")); }, []);
  useEffect(() => { const el = logBox.current; if (el) el.scrollTop = el.scrollHeight; }, [log.length]);

  const ctx = useCallback((): Context => ({ incident, hour, scenario, buildings, reports, reportedFloor: call?.floor ?? null, focusBuilding: call?.buildingId ?? null }),
    [incident, hour, scenario, buildings, reports, call]);

  const run = useCallback(async (complication: string | null) => {
    if (!mode) return;
    const id = ++runId.current;
    const hooks = {
      log: (e: Omit<LogEntry, "id">) => { if (runId.current === id) setLog(l => [...l, { ...e, id: ++seq.current }]); },
      plan: (p: Plan) => { if (runId.current === id) { planRef.current = p; setPlan(p); } },
      placard: (b: number) => setPlacards(p => p.includes(b) ? p : [...p, b]),
      staging: (b: number, st: Staging, checks: Record<number, StagingCheck>) => setStaging({ id: b, st, checks }),
      names: (b: number, n: string) => setNames(m => m[b] ? m : { ...m, [b]: n }),
      cancelled: () => runId.current !== id,
    };
    setRunning(true);
    if (!complication) { setLog([]); setPlan(null); setPlacards([]); setStaging(null); convo.current = []; planner.current = newPlannerState(); planRef.current = null; }
    hooks.log({ kind: "user", title: complication ? `Complication: ${complication}` : briefing(ctx()) });
    try {
      if (mode === "claude") {
        const msg = complication ? `COMPLICATION: ${complication} Re-plan: re-run only the tools this affects and submit a revised plan that says what changed.` : briefing(ctx());
        convo.current = await runClaude([...convo.current, { role: "user", content: msg }], ctx(), hooks);
      } else {
        await runRules(ctx(), hooks, planRef.current, complication, planner.current);
      }
    } catch (e) {
      if ((e as Error).message !== "cancelled") hooks.log({ kind: "error", title: (e as Error).message });
    } finally { if (runId.current === id) setRunning(false); }
  }, [mode, ctx]);

  // Trigger: a new pin (or a 911 call) starts the commander automatically.
  const key = `${incident.lat.toFixed(6)},${incident.lon.toFixed(6)},${incident.radius}:${call?.key ?? 0}`;
  const ready = buildings.length > 0;   // wait for the building index (a shared link can open before it loads)
  useEffect(() => {
    if (!auto || !mode || !ready) return;
    const t = setTimeout(() => run(null), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mode, auto, ready]);

  // A hazard switch re-plans once the new hazard has reached the context.
  useEffect(() => {
    if (pendingHazard.current) { const c = pendingHazard.current; pendingHazard.current = null; run(c); }
  }, [scenario, run]);

  const lead = plan?.priorities[0]?.building_id ?? null;
  const nameOf = (id: number) => names[id] ?? `Building ${id}`;

  /** Apply a complication, typed or from a button. In AI mode Claude reads the words itself. */
  function complicate(words: string) {
    const said = words.trim();
    if (!said || running) return;
    setHint("");
    if (mode === "claude") {
      const c = parseComplication(said, (plan?.priorities ?? []).map(p => ({ id: p.building_id, name: nameOf(p.building_id) })), scenario);
      if (c.kind === "hazard") { pendingHazard.current = said; onSwitchHazard(c.to); return; }
      run(said); return;
    }
    const c = parseComplication(said, (plan?.priorities ?? []).map(p => ({ id: p.building_id, name: nameOf(p.building_id) })), scenario);
    const st = planner.current;
    switch (c.kind) {
      case "stair": { const b = c.building ?? lead; if (b == null) return; st.closed[b] = Array.from(new Set([...(st.closed[b] ?? []), c.letter])); break; }
      case "floor": st.fireFloor = c.floor; break;
      case "trapped": { const b = c.building ?? lead; if (b == null) return; st.trapped = [...st.trapped.filter(t => t.id !== b), { id: b, floor: c.floor, count: c.count }]; break; }
      case "staging": { const lot = c.lot ?? plan?.staging.candidate ?? -1; if (lot < 0) { setHint("There is no staging lot to rule out."); return; } st.excluded = Array.from(new Set([...st.excluded, lot])); break; }
      case "hazard": pendingHazard.current = said; onSwitchHazard(c.to); return;
      case "note": setHint(c.text); return;
      case "unknown": setHint("The offline planner couldn't match that to a stair, floor, trapped people, staging or a hazard change. Try “Stair C in Brava is full of smoke”, “fire spread to floor 6” or “3 people trapped on floor 5”."); return;
    }
    run(said);
  }

  function submit(e: FormEvent) { e.preventDefault(); complicate(text); setText(""); }

  const leadName = lead != null ? nameOf(lead) : "the lead building";
  const floorNow = planner.current.lastFireFloor ?? call?.floor ?? 3;
  // Suggestions that make sense for the hazard in play.
  const presets = scenario === "fire" ? [
    `Stair B in ${leadName} is full of smoke`,
    `Fire spread to floor ${floorNow + 1} in ${leadName}`,
    `3 people trapped on floor ${floorNow + 2} of ${leadName}`,
    "Staging lot blocked by a road closure",
    "Switch hazard to flood",
  ] : scenario === "flood" ? [
    `Stair A entrance in ${leadName} is flooded`,
    `4 people trapped on the ground floor of ${leadName}`,
    "Staging lot is flooded",
    "Switch hazard to fire",
  ] : [
    `Stair A in ${leadName} has no emergency lighting`,
    `4 people stuck in an elevator in ${leadName}`,
    "Staging lot blocked by downed power lines",
    "Switch hazard to fire",
  ];

  return <section className="card commander" aria-label="Incident Commander">
    <div className="cmdHead">
      <div>
        <div className="eyebrow"><i className="dot" /> Incident Commander</div>
        <h2>First-Due Triage Plan</h2>
        <p className="muted">{mode === "claude"
          ? "Claude Opus 5.5 plans with HavenLens tools: it decides what to check, cross-checks results and re-plans when something changes. A human commander makes every decision."
          : mode === "rules"
          ? "HavenLens Planner, running offline on this laptop: it assesses the scene, decides which buildings to investigate, checks its own staging choice and re-plans when you report a change. Every decision is explained in the log. A human commander makes every decision."
          : "Starting…"}</p>
      </div>
      <div className="cmdCtl">
        <span className={"tag " + (mode === "claude" ? "ai" : "")} title={mode === "rules" ? "Add ANTHROPIC_API_KEY to .env.local to let Claude plan instead." : ""}>{mode === "claude" ? "Claude agent" : "Offline planner"}</span>
        <label className="check"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Start on new pin</label>
        <button className="primary" onClick={() => run(null)} disabled={running || !mode}>{running ? "Planning…" : plan ? "Plan again" : "Start planning"}</button>
      </div>
    </div>

    <div className="cmdGrid">
      <div className="cmdLog" aria-live="polite">
        <div className="cmdLogHead"><span className="eyebrow">How the plan was made</span>{running && <span className="cmdWorking"><i />Working</span>}</div>
        {log.length === 0 && <p className="muted">Drop a pin or play a 911 call. The commander finds the buildings in range, works out who is inside and who needs help, estimates evacuation, scans the exterior, checks staging lots and issues placards.</p>}
        <ol ref={logBox}>{log.map(e => <li key={e.id} className={e.kind}>
          <span className="k">{KIND_LABEL[e.kind]}</span>
          <div>
            <b>{e.title}</b>
            {e.detail && <p>{e.detail}</p>}
            {e.raw && <details><summary>Data sent</summary><pre>{e.raw}</pre></details>}
          </div>
        </li>)}</ol>
        <form className="cmdAsk" onSubmit={submit}>
          <label className="eyebrow" htmlFor="complication">Report a change on scene</label>
          <div className="cmdAskRow">
            <input id="complication" value={text} onChange={e => setText(e.target.value)} placeholder={scenario === "fire" ? "e.g. Stair C is full of smoke" : scenario === "flood" ? "e.g. Stair A entrance is flooded" : "e.g. 4 people stuck in an elevator"} disabled={!plan || running} autoComplete="off" />
            <button className="primary" disabled={!plan || running || !text.trim()}>Re-plan</button>
          </div>
          <div className="chips cmdPresets">{presets.map(p => <button type="button" key={p} onClick={() => complicate(p)} disabled={!plan || running}>{p}</button>)}</div>
          {hint && <p className="cmdHint">{hint}</p>}
        </form>
      </div>

      <div className="cmdPlan">
        {!plan ? <p className="muted">The plan appears here as soon as it is ready.</p> : <>
          <div className="cmdPlanTop">
            <span className="tag">Plan v{plan.version ?? 1} · {hourLabel(hour)} · {SCENARIOS[scenario].label}</span>
            <span className="cmdLegend" title="First-due: the first engine company to reach the scene. Second-due and later companies support it.">First-due = first engine on scene</span>
          </div>
          {plan.changes && <div className="cmdChange"><b>What changed</b><ul>{plan.changes.split("\n").map(l => <li key={l}>{l}</li>)}</ul></div>}
          <p className="cmdHeadline" style={{ ["--acc" as string]: SCENARIOS[scenario].accent }}>{plan.headline}</p>
          {scenario === "fire" && <p className="cmdStairNote">Stairs are lettered A, B, C… per building. Stair A* is the one nearest the fire and is kept for firefighters; occupants use the others. *Positions are inferred from building code, not floor plans.</p>}
          <ol className="cmdPri">{plan.priorities.map(p => <li key={p.building_id}>
            <span className="rank">{p.rank}</span>
            <div>
              <b>{nameOf(p.building_id)}</b>
              <p>{p.action}</p>
              <small>{p.reason}</small>
              <div className="cmdStairs">
                <span className="evac">Evacuation {p.evacuation}</span>
                {p.attack_stair && <span className="pill fire">Firefighters: Stair {p.attack_stair}*</span>}
                {p.stairs_open && p.stairs_open.length > 0 && <span className="pill">Occupants: {p.stairs_open.join(", ")}</span>}
                {p.closed_stairs && p.closed_stairs.length > 0 && <span className="pill closed">Closed: {p.closed_stairs.join(", ")}</span>}
              </div>
              <div className="cmdLinks">
                <a href={`/building?id=${p.building_id}&s=${scenario}`}>Dossier</a>
                <a href={`/building?id=${p.building_id}&s=${scenario}&twin=1${planner.current.fireFloor ?? call?.floor ? `&ff=${planner.current.fireFloor ?? call?.floor}` : ""}`}>3D model</a>
                {placards.includes(p.building_id) && <a href={`/building?id=${p.building_id}&s=${scenario}&placard=1`}>Door placard</a>}
              </div>
            </div>
            {placards.includes(p.building_id) && <MiniQR id={p.building_id} />}
          </li>)}</ol>
          <div className="cmdStaging">
            <h3 className="subhead">Staging for apparatus</h3>
            <div className="cmdStagingRow">
              {plan.staging.candidate >= 0 && staging?.st.candidates[plan.staging.candidate]?.image && <img src={staging.st.candidates[plan.staging.candidate].image!} alt="Chosen staging lot, Vexcel aerial imagery" />}
              <div>
                <p>{plan.staging.candidate >= 0 ? <b>Lot #{plan.staging.candidate}: </b> : null}{plan.staging.reason}</p>
                {staging && <ul className="cmdChecks">{staging.st.candidates.map((c, i) => { const ch = staging.checks[i]; const pct = ch ? Math.round(100 * ch.cars * 25 / Math.max(1, ch.areaM2)) : null; const out = planner.current.excluded.includes(i); return <li key={i} className={out ? "blocked" : i === plan.staging.candidate ? "chosen" : ch?.status?.replace(" ", "-") ?? "unchecked"}>
                  Lot #{i} · {c.dist} m {c.dir} · {out ? "ruled out" : ch ? `${ch.cars} cars, about ${pct}% full` : "not checked"}{i === plan.staging.candidate ? " · chosen" : ""}
                </li>; })}</ul>}
              </div>
            </div>
          </div>
          {plan.hazards.length > 0 && <><h3 className="subhead">Exterior hazards</h3><ul className="cmdList">{plan.hazards.map(h => <li key={h}>{h}</li>)}</ul></>}
          {plan.open_questions.length > 0 && <><h3 className="subhead">Check on arrival</h3><ul className="cmdList">{plan.open_questions.map(q => <li key={q}>{q}</li>)}</ul></>}
        </>}
      </div>
    </div>
  </section>;
}

function MiniQR({ id }: { id: number }) {
  const origin = useShareOrigin();
  const [svg, setSvg] = useState("");
  useEffect(() => {
    if (!origin) return;
    QRCode.toString(`${origin}/verify?id=${id}`, { type: "svg", margin: 0, color: { dark: "#0f1113", light: "#ffffff" } }).then(setSvg).catch(() => {});
  }, [origin, id]);
  return <a className="miniQr" href={`/verify?id=${id}`} title="Crews scan this on scene to confirm sprinklers and open the dossier">
    <span dangerouslySetInnerHTML={{ __html: svg }} />
    <small>Scan on scene: confirm sprinklers</small>
  </a>;
}
