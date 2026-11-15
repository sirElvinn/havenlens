"use client";

// Live demo: a guided, timed walk through the real app (map, Incident Commander, 3D model, Vexcel scan, placard).
// Nothing here is a mock-up: every scene mounts the same components the app uses and drives them like a presenter would.
// Keys: Space pause/play · → next · ← back · R send the field report from this laptop · C hide captions · F full screen · Esc exit.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BuildingMap from "./BuildingMap";
import CommanderPanel from "./CommanderPanel";
import EvacuationTwin from "./EvacuationTwin";
import ExteriorPanel from "./ExteriorPanel";
import Placard from "./Placard";
import Num from "./Num";
import { CALLS } from "./Call911";
import { hourLabel, loadDossier, loadIndex, peopleAt, type BuildingRow, type Dossier } from "../lib/dossier";
import { exposedAt, mobilityRate, scenarioScore, SCENARIOS, type Scenario } from "../lib/scenario";
import { applyReport, postReport, useReports, type FieldReport } from "../lib/reports";
import { estimateEvacuation } from "../lib/evacuation";
import "./dossier.css";
import "./demo.css";

const CATANIA = 7556398, TOWER = 233905;
const HOUSTON = { lat: 29.76, lon: -95.42, zoom: 11 };
const CALL = CALLS[0];
const TRAPPED = "3 people trapped on floor 3 of The Catania";

type SceneId = "call" | "blind" | "clock" | "hazards" | "plan" | "fire" | "flood" | "tower" | "aerial" | "field" | "close";
// Scene lengths add up to exactly 1:55 (115 s). The script in the project doc is timed to these.
const SCENES: { id: SceneId; label: string; dur: number }[] = [
  { id: "call", label: "3:04 AM", dur: 14 },
  { id: "blind", label: "The problem", dur: 8 },
  { id: "clock", label: "The clock", dur: 12 },
  { id: "hazards", label: "Every hazard", dur: 8 },
  { id: "plan", label: "Call to plan", dur: 19 },
  { id: "fire", label: "Inside the building", dur: 10 },
  { id: "flood", label: "Flood", dur: 8 },
  { id: "tower", label: "At scale", dur: 11 },
  { id: "aerial", label: "Eyes from above", dur: 8 },
  { id: "field", label: "Close the loop", dur: 11 },
  { id: "close", label: "HavenLens", dur: 6 },
];
const TOTAL = SCENES.reduce((t, s) => t + s.dur, 0);
const START = SCENES.map((_, k) => SCENES.slice(0, k).reduce((t, s) => t + s.dur, 0));
const clockText = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
// A shorter cut of the Houston call for the timed demo (same address, so it resolves to the same CoStar record).
const LINES = [
  ["Dispatcher", "911, what's the address of your emergency?", 0.4],
  ["Caller", "5105 Airline Drive, the Catania apartments. There's smoke on the second floor!", 3.0],
  ["Caller", "My neighbor's in a wheelchair, and the elevator's out.", 6.9],
] as const;

const highCount = (rows: BuildingRow[], s: Scenario, h: number) => rows.reduce((n, b) => n + (scenarioScore(b, s, h).tier === "High" ? 1 : 0), 0);

/** Act on a real control once it exists and is enabled (components load data first). */
function when<T extends HTMLElement>(find: () => T | null | undefined, act: (el: T) => void, tries = 60) {
  const go = (n: number) => {
    const el = find();
    if (el && !(el as unknown as HTMLButtonElement).disabled) { act(el); return; }
    if (n > 0) setTimeout(() => go(n - 1), 250);
  };
  go(tries);
}
const clickWhen = (find: () => HTMLElement | null | undefined) => when(find, el => el.click());
/** Type into a React-controlled input the way a person would, so the component's own handlers run. */
function typeInto(el: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
const byText = (selector: string, re: RegExp) => () => Array.from(document.querySelectorAll<HTMLElement>(selector)).find(e => re.test(e.textContent ?? ""));
const scrollTo = (selector: string) => document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" });

export default function Demo() {
  const [all, setAll] = useState<BuildingRow[]>([]);
  const [cat, setCat] = useState<Dossier | null>(null);
  const [tower, setTower] = useState<Dossier | null>(null);
  const [warm, setWarm] = useState<Record<string, "wait" | "ok" | "fail">>({ index: "wait", catania: "wait", tower: "wait", imagery: "wait", reports: "wait" });
  const [started, setStarted] = useState(false);
  const [i, setI] = useState(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [voice, setVoice] = useState(true);
  const [autoReport, setAutoReport] = useState(true);   // send the report from this laptop if no phone has scanned in time
  const [entry, setEntry] = useState(0);              // bumps on every scene entry, so components restart cleanly
  const fired = useRef(new Set<string>());
  const reports = useReports(1500);
  const rows = useMemo(() => all.map(b => applyReport(b, reports[b.id])), [all, reports]);
  const houston = useMemo(() => rows.filter(b => b.city === "Houston"), [rows]);
  const scene = SCENES[i];

  // Pre-flight: load the data and warm every Vexcel response the demo uses, so nothing waits on the network on stage.
  useEffect(() => {
    const mark = (k: string, v: "ok" | "fail") => setWarm(w => ({ ...w, [k]: v }));
    loadIndex().then(d => { setAll(d.buildings); mark("index", "ok"); }).catch(() => mark("index", "fail"));
    loadDossier(CATANIA).then(d => { setCat(d); mark("catania", d ? "ok" : "fail"); }).catch(() => mark("catania", "fail"));
    loadDossier(TOWER).then(d => { setTower(d); mark("tower", d ? "ok" : "fail"); }).catch(() => mark("tower", "fail"));
    const urls = [CATANIA, TOWER].flatMap(id => [`/api/vexcel/${id}/parcel?v=3`, `/api/vexcel/${id}/parcel`, `/api/vexcel/${id}/staging`,
      `/api/vexcel/${id}/staging-check-0`, `/api/vexcel/${id}/staging-check-1`, `/api/vexcel/${id}/staging-check-2`, `/api/vexcel/${id}/detect`, `/api/vexcel/${id}/ortho.jpg`]);
    Promise.all(urls.map(u => fetch(u).then(r => r.ok))).then(ok => mark("imagery", ok.every(Boolean) ? "ok" : "fail")).catch(() => mark("imagery", "fail"));
    fetch(`/api/reports?id=${CATANIA}`, { method: "DELETE" }).then(r => mark("reports", r.ok ? "ok" : "fail")).catch(() => mark("reports", "fail"));
  }, []);

  const ready = warm.index === "ok" && warm.catania === "ok" && warm.tower === "ok";

  // One clock for the whole run: elapsed time since the run started, minus pauses. Scenes follow from it,
  // so there is no drift at scene changes and the run is exactly 1:55.
  const runStart = useRef(0);
  const goTo = useCallback((n: number) => {
    window.speechSynthesis?.cancel();
    const k = Math.max(0, Math.min(SCENES.length - 1, n));
    runStart.current = performance.now() - START[k] * 1000;
    setI(k); setT(0); setEntry(e => e + 1); fired.current.clear();
  }, []);
  const start = () => { setStarted(true); setPlaying(true); goTo(0); };

  const at = useRef({ i: 0, t: 0 });
  at.current = { i, t };
  useEffect(() => {
    if (!started || !playing) return;
    runStart.current = performance.now() - (START[at.current.i] + at.current.t) * 1000;   // resume where we paused
    const id = setInterval(() => {
      const el = Math.min(TOTAL, (performance.now() - runStart.current) / 1000);
      let k = SCENES.length - 1;
      while (k > 0 && START[k] > el) k--;
      if (k !== at.current.i) { window.speechSynthesis?.cancel(); fired.current.clear(); setI(k); setEntry(e => e + 1); }
      setT(el - START[k]);
      if (el >= TOTAL) setPlaying(false);   // the run ends on the closing card at exactly 1:55
    }, 50);
    return () => clearInterval(id);
  }, [started, playing]);
  const elapsed = Math.min(TOTAL, START[i] + t);

  // Field verification: reset before the scene; the phone's report (or the laptop fallback) lands within it.
  const fieldReport = reports[CATANIA]?.sprinklers;
  useEffect(() => { if (scene.id === "field") fetch(`/api/reports?id=${CATANIA}`, { method: "DELETE" }).catch(() => {}); }, [scene.id, entry]);

  // Timed actions on the real controls.
  const speak = useCallback((text: string, caller: boolean) => {
    const synth = window.speechSynthesis;
    if (!voice || !synth) return;
    const u = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices().filter(v => v.lang.startsWith("en"));
    u.voice = voices[caller ? Math.min(1, voices.length - 1) : 0] ?? null;
    u.rate = caller ? 1.12 : 1.02; u.pitch = caller ? 1.15 : 0.9;
    synth.speak(u);
  }, [voice]);
  const ACTIONS: Partial<Record<SceneId, [number, () => void][]>> = {
    call: LINES.map(([who, text, at]) => [at, () => speak(text, who === "Caller")] as [number, () => void]),
    plan: [
      [7, () => scrollTo(".demoStage .cmdPlan")],
      [11, () => when(() => document.querySelector<HTMLInputElement>(".demoStage #complication"), el => {
        typeInto(el, TRAPPED);
        setTimeout(() => clickWhen(byText(".demoStage .cmdAsk button", /^Re-plan$/)), 400);
      })],
      [12.5, () => scrollTo(".demoStage .cmdPlan")],
    ],
    fire: [
      [2.5, () => clickWhen(byText(".twin .twinFireCtl button", /Go to fire floor/))],
      [7, () => clickWhen(byText(".twin .twinTop button", /Whole building/))],
    ],
    // Stairs are the bottleneck in a full tower at 2 PM, so this is where losing one shows its cost.
    tower: [
      [3.4, () => clickWhen(byText(".twin .twinCtl button", /^Restart$/))],
      [4, () => clickWhen(byText(".twin .twinCompl button", /^Smoke in Stair/))],
    ],
    flood: [[4, () => clickWhen(byText(".twin .twinCompl button", /^Water rising/))]],
    aerial: [
      [0.3, () => clickWhen(byText(".demoStage button", /Scan exterior/))],
      [3.6, () => clickWhen(byText(".demoStage button", /Find staging areas/))],
      [4.8, () => document.querySelector(".demoAerial")?.scrollTo({ top: 1e5, behavior: "smooth" })],
    ],
    field: [[4.5, () => { if (autoReport && !fieldReport) sendReport(); }]],
  };
  useEffect(() => {
    if (!started) return;
    (ACTIONS[scene.id] ?? []).forEach(([at, run], k) => {
      const key = `${entry}:${k}`;
      if (t >= at && !fired.current.has(key)) { fired.current.add(key); run(); }
    });
  });

  // Presenter keys.
  const sendReport = useCallback(() => { postReport(CATANIA, "sprinklers", false).catch(() => {}); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!started || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === " ") { e.preventDefault(); setPlaying(p => !p); }
      else if (e.key === "ArrowRight") { e.preventDefault(); goTo(i + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); goTo(i - 1); }
      else if (e.key.toLowerCase() === "c") setCaptions(c => !c);
      else if (e.key.toLowerCase() === "r" && scene.id === "field") sendReport();
      else if (e.key.toLowerCase() === "f") { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); }
      else if (e.key === "Escape" && !document.fullscreenElement) window.location.href = "/";
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [started, i, goTo, scene.id, sendReport]);

  // ----- Live numbers (computed from the data, never typed in) -----
  const stats = useMemo(() => {
    if (!rows.length) return null;
    const unknown = rows.filter(b => b.sprinklers == null).length;
    return {
      buildings: rows.length,
      unknownPct: Math.round(100 * unknown / rows.length),
      peak: rows.reduce((t, b) => t + (b.people ?? 0), 0),
      asleep: rows.reduce((t, b) => t + exposedAt(b, "fire", 3), 0),
      high14: highCount(rows, "fire", 14), high3: highCount(rows, "fire", 3),
    };
  }, [rows]);

  // Map scenes: hour and hazard follow the scene clock, so stepping back and forth replays exactly.
  // The clock scene runs 2 PM to 3 AM in 13 steps, starting 2 s in.
  const mapHour = scene.id === "clock" ? (t < 1.5 ? 14 : (14 + Math.min(13, Math.floor((t - 1.5) / 0.4) + 1)) % 24) : 3;
  const mapHazard: Scenario = scene.id === "hazards" ? (t < 2.7 ? "fire" : t < 5.4 ? "flood" : "blackout") : "fire";
  const onMap = ["blind", "clock", "hazards", "plan"].includes(scene.id);
  const focus = useMemo(() => scene.id === "plan" && cat ? { lat: cat.lat, lon: cat.lon, zoom: 16 } : HOUSTON, [scene.id, cat]);
  const incident = useMemo(() => scene.id === "plan" && cat ? { lat: cat.lat, lon: cat.lon, radius: 250 } : null, [scene.id, cat]);
  const call = useMemo(() => ({ floor: CALL.floor, buildingId: CATANIA, key: entry }), [entry]);
  const top = (s: Scenario) => houston.reduce<BuildingRow | null>((best, b) => !best || scenarioScore(b, s, 3).score > scenarioScore(best, s, 3).score ? b : best, null);

  const caption = captionFor(scene.id, t, { stats, cat, tower, mapHazard, top, fieldReport: !!fieldReport, hour: mapHour });

  if (!started) return <main className="hl demoStart">
    <div>
      <div className="eyebrow"><i className="dot" /> HavenLens · live demo</div>
      <h1>Know the building <em>before</em> the truck arrives.</h1>
      <p className="lede">A 1:55 guided run through the real app: a 3 AM 911 call to a senior apartment building in Houston, followed from the first ring to a plan verified on site.</p>
      <ul className="demoCheck">
        {([["index", "CoStar building index"], ["catania", "The Catania dossier"], ["tower", "TC Energy Center dossier"], ["imagery", "Vexcel imagery and scans (cached)"], ["reports", "Field reports reset"]] as const).map(([k, label]) =>
          <li key={k} className={warm[k]}><i />{label}<span>{warm[k] === "ok" ? "ready" : warm[k] === "fail" ? "check" : "loading…"}</span></li>)}
      </ul>
      <div className="demoGo">
        <button className="primary" onClick={start} disabled={!ready}>{ready ? "Start the demo" : "Getting ready…"}</button>
        <label className="check"><input type="checkbox" checked={voice} onChange={e => setVoice(e.target.checked)} /> Read the 911 call aloud</label>
        <label className="check"><input type="checkbox" checked={autoReport} onChange={e => setAutoReport(e.target.checked)} /> If no phone has scanned by {clockText(START[SCENES.findIndex(x => x.id === "field")] + 4.5)}, send the field report from this laptop</label>
      </div>
      <p className="fine">Space pause · → next scene · ← previous · R send the field report from this laptop · C hide captions · F full screen · Esc exit. For the phone scan, put the phone on the same Wi-Fi as this laptop.</p>
    </div>
  </main>;

  return <main className={`hl demo scn-${scene.id}`} style={{ ["--acc" as string]: SCENARIOS[scene.id === "hazards" ? mapHazard : scene.id === "flood" ? "flood" : "fire"].accent }}>
    {/* Persistent map for the city scenes, so it never reloads between them. */}
    <div className={"demoMap" + (onMap && !(scene.id === "plan" && t >= 3) ? " on" : "")} aria-hidden={!onMap}>
      {houston.length > 0 && <BuildingMap buildings={houston} hour={mapHour} focus={focus} onSelect={() => {}} incident={incident} scenario={mapHazard} />}
    </div>

    <div className="demoStage" key={`${scene.id}:${entry}`}>
      {scene.id === "call" && <div className="demoCall">
        <div className="demoTime">3:04 AM <span>Houston</span></div>
        <ol>{LINES.map(([who, text, at], k) => t >= at && <li key={k} className={who === "Caller" ? "caller" : ""}><b>{who}</b><p>{text}</p></li>)}</ol>
      </div>}

      {scene.id === "blind" && stats && <div className="demoTiles">
        {t >= 0.6 && <Tile n={stats.buildings} label="buildings in CoStar's Houston and LA kit" />}
        {t >= 1.8 && <Tile n={stats.unknownPct} suffix="%" label="have no sprinkler status on record" hot />}
        {t >= 3 && <Tile n={stats.peak} label="people inside at the busiest hour (est.)" />}
      </div>}

      {(scene.id === "clock" || scene.id === "hazards") && <div className="demoCounter">
        <div className="demoClock">{hourLabel(mapHour)}</div>
        <div className="demoBig"><Num value={highCount(rows, mapHazard, mapHour)} duration={300} /></div>
        <div className="demoBigLabel">buildings at <b>High {SCENARIOS[mapHazard].verb}</b> priority · Houston + Los Angeles</div>
      </div>}

      {scene.id === "plan" && <>
        {t < 3 && <ol className="demoDispatch">
          {[`Heard: 5105 Airline Drive`, `Matched CoStar #${CATANIA} · The Catania`, `Clock 3:00 AM · fire · floor ${CALL.floor}`, "Pin placed · Incident Commander starting"].map((s, k) => t >= 0.3 + k * 0.6 && <li key={k}>{s}</li>)}
        </ol>}
        {cat && <div className={"demoCommander" + (t >= 3 ? " on" : "")}>
          <CommanderPanel incident={{ lat: cat.lat, lon: cat.lon, radius: 250 }} hour={3} scenario="fire" buildings={houston} reports={reports} call={call} onSwitchHazard={() => {}} />
        </div>}
      </>}

      {scene.id === "fire" && cat && <EvacuationTwin d={cat} scenario="fire" hour={3} initialFireFloor={CALL.floor} onClose={() => goTo(i + 1)} />}
      {scene.id === "flood" && cat && <EvacuationTwin d={cat} scenario="flood" hour={3} onClose={() => goTo(i + 1)} />}
      {scene.id === "tower" && tower && <EvacuationTwin d={tower} scenario="fire" hour={14} initialFireFloor={30} onClose={() => goTo(i + 1)} />}

      {scene.id === "aerial" && <div className="demoAerial"><ExteriorPanel id={CATANIA} /></div>}

      {scene.id === "field" && cat && <FieldLoop d={cat} report={reports[CATANIA]} onSend={sendReport} />}

      {scene.id === "close" && stats && <div className="demoClose">
        <div className="eyebrow"><i className="dot" /> HavenLens</div>
        <h1>CoStar knows every building.<br /><em>Now responders know who&apos;s inside.</em></h1>
        <div className="demoTiles closeTiles">
          <Tile n={stats.high3} label={`High fire priority at 3 AM (vs ${stats.high14} at 2 PM)`} hot />
          <Tile n={stats.asleep} label="people in homes and hotels at 3 AM, most of them asleep (est.)" />
          <Tile n={stats.unknownPct} suffix="%" label="sprinkler status unknown, now checkable on site" />
          <Tile n={stats.buildings} label="CoStar buildings, each with a dossier" />
        </div>
        <p className="muted">Every number is a CoStar record, a Vexcel measurement, or a published standard (SFPE, the building code, CDC). Unknowns stay unknown.</p>
        <div className="chips"><button className="primary" onClick={() => { setPlaying(true); goTo(0); }}>Replay</button><a className="btnLink" href="/">Explore the app</a><a className="btnLink" href="/method">How we estimate</a></div>
      </div>}
    </div>

    {captions && caption && scene.id !== "close" && <div className={"demoCaption" + (["fire", "flood", "tower"].includes(scene.id) ? " left" : "")} key={caption.head}>
      <span className="eyebrow">{String(i + 1).padStart(2, "0")} · {scene.label}</span>
      <h2>{caption.head}</h2>
      {caption.sub && <p>{caption.sub}</p>}
    </div>}

    <div className="demoHud">
      <ol className="demoProgress" aria-label="Scenes">{SCENES.map((s, k) => <li key={s.id} className={k < i ? "done" : k === i ? "now" : ""} onClick={() => goTo(k)} title={s.label}>
        <i style={k === i ? { width: `${Math.min(100, 100 * t / s.dur)}%` } : undefined} /></li>)}</ol>
      <span className="demoTimer" aria-label="Demo time">{clockText(elapsed)} / {clockText(TOTAL)}</span>
      <div className="demoKeys">
        <button onClick={() => goTo(i - 1)} aria-label="Previous scene">←</button>
        <button onClick={() => setPlaying(p => !p)}>{playing ? "Pause" : "Play"}</button>
        <button onClick={() => goTo(i + 1)} aria-label="Next scene">→</button>
        <a href="/" aria-label="Exit the demo">Exit</a>
      </div>
    </div>
  </main>;
}

function Tile({ n, label, suffix = "", hot = false }: { n: number; label: string; suffix?: string; hot?: boolean }) {
  return <div className={"demoTile" + (hot ? " hot" : "")}><b><Num value={n} duration={900} />{suffix}</b><span>{label}</span></div>;
}

/** The placard and a live score card that changes when the phone's report arrives. */
function FieldLoop({ d, report, onSend }: { d: Dossier; report?: FieldReport; onSend: () => void }) {
  const before = scenarioScore(d, "fire", 3);
  const live = applyReport(d, report);
  const after = scenarioScore(live, "fire", 3);
  const s = report?.sprinklers;
  return <>
    <Placard d={live} scenario="fire" score={after.score} tier={after.tier} factors={after.factors ?? []} mobility={Math.round((d.people ?? 0) * mobilityRate(d))} onClose={() => {}} />
    <aside className={"demoLive" + (s ? " got" : "")} aria-live="polite">
      <span className="eyebrow"><i className="dot" /> Live · {d.name}</span>
      <dl>
        <div><dt>Sprinklers</dt><dd>{s ? (s.value ? "Yes" : "No") : "Unknown"}{s && <small>field report · not yet verified</small>}</dd></div>
        <div><dt>Fire priority at 3 AM</dt><dd><Num value={after.score} duration={700} />{s && after.score !== before.score && <small>{after.score > before.score ? "▲" : "▼"} from {before.score} · {after.tier}</small>}</dd></div>
      </dl>
      {!s ? <p className="muted">Waiting for a scan of the placard… <button className="ghost" onClick={onSend}>Send from this laptop (R)</button></p>
        : <p className="ok">Report received {new Date(s.at).toLocaleTimeString()}. Every screen updated.</p>}
    </aside>
  </>;
}

type CaptionData = { stats: { high14: number; high3: number; unknownPct: number } | null; cat: Dossier | null; tower: Dossier | null; mapHazard: Scenario; top: (s: Scenario) => BuildingRow | null; fieldReport: boolean; hour: number };

function captionFor(id: SceneId, t: number, x: CaptionData): { head: string; sub?: string } | null {
  switch (id) {
    case "call": return t < 10 ? { head: "A 911 call. Smoke on the second floor of a senior apartment building.", sub: "Simulated call, real address: The Catania, 5105 Airline Drive, Houston." }
      : { head: "In four minutes an engine arrives. The crew knows almost nothing about this building." };
    case "blind": return { head: "CoStar already knows these buildings.", sub: "Stories, construction, sprinklers, units, tenants: collected for real-estate deals, never used for the people inside." };
    case "clock": return t < 6.8 || !x.stats ? { head: "Same buildings. Same data. Only the hour changes.", sub: "Watch the clock run from 2 PM to 3 AM." }
      : { head: `At 2 PM, ${x.stats.high14} buildings are high fire priority. At 3 AM, ${x.stats.high3}.`, sub: "At night apartments fill up and fall asleep, while offices empty. HavenLens re-ranks every building, every hour." };
    case "hazards": {
      const b = x.top(x.mapHazard);
      const lead = x.mapHazard === "fire" ? "Fire: sleeping residents, missing sprinklers, height." : x.mapHazard === "flood" ? "Flood: basements and ground-floor homes come first." : "Blackout: elevators stop. High-rises become stairs only.";
      return { head: lead, sub: b ? `Top in Houston right now: ${b.name}.` : undefined };
    }
    case "plan": return t < 3 ? { head: "The call becomes a pin in two seconds.", sub: "HavenLens hears the address, matches the CoStar record, sets the clock and the hazard." }
      : t < 11 ? { head: "The Incident Commander writes the first-due plan.", sub: "It ranks every building in range, estimates evacuations, scans the exterior, checks staging lots for parked cars and issues placards. Every line has a reason." }
      : { head: "Something changes on scene. It re-plans and says exactly what changed.", sub: "3 people reported trapped on Floor 3: the plan now assigns a dedicated rescue company." };
    case "fire": {
      const n = x.cat ? peopleAt(x.cat, 3) : null;
      return t < 4.5 ? { head: "The Catania, built from its Vexcel footprint and CoStar floor count.", sub: n ? `Fire on Floor 2 at 3 AM. About ${n.toLocaleString()} residents, most of them asleep.` : undefined }
        : { head: "Every floor gets its own orders.", sub: "The fire floor leaves first. The floor above goes next. The stair nearest the fire is kept clear for firefighters." };
    }
    case "flood": return t < 4 ? { head: "Flood: nobody goes outside. They go up.", sub: "The ground floor moves to Floor 2; upper floors shelter in place." }
      : { head: "Water still rising: the refuge moves up a floor.", sub: "Floors below it now move up, and the plan updates." };
    case "tower": {
      const n = x.tower ? peopleAt(x.tower, 14) : null;
      const e0 = x.tower ? estimateEvacuation(x.tower, 14, "fire") : null, e1 = x.tower ? estimateEvacuation(x.tower, 14, "fire", { closedStairs: 1 }) : null;
      const mm = (r: [number, number]) => `${Math.round(r[0])}–${Math.ceil(r[1])} min`;
      return t < 4.5 || !e0 || !e1 ? { head: `It scales: TC Energy Center, 56 floors${n ? `, about ${n.toLocaleString()} people at 2 PM` : ""}.`, sub: "Phased evacuation: the fire floor and the floors above go first; the rest wait their turn." }
        : { head: `Smoke takes one of its two stairs: ${mm(e0.total)} becomes ${mm(e1.total)}.`, sub: "Everyone left must share the firefighters' stair. HavenLens shows the cost before it happens (SFPE estimate)." };
    }
    case "aerial": return t < 4 ? { head: "Vexcel's aerial AI scans the parcel.", sub: "Hydrants and pools as water sources. Solar panels and rooftop equipment as hazards. Parked cars as obstacles." }
      : { head: "Then it searches the imagery for open lots to stage the engines.", sub: "Each lot is checked for parked cars and kept outside the collapse zone." };
    case "field": return x.fieldReport ? { head: "Report received. The plan updated for everyone, in seconds.", sub: "Marked as a field report until an inspector verifies it." }
      : { head: "When CoStar doesn't know, the crew can tell us.", sub: "Scan the placard's QR code and answer one question: sprinklers, yes or no." };
    default: return null;
  }
}
