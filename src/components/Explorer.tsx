"use client";

import HavenMark from "./HavenMark";
import { useEffect, useMemo, useRef, useState } from "react";
import BuildingPicker from "./BuildingPicker";
import CityPlate from "./CityPlate";
import BuildingMap from "./BuildingMap";
import SiteHeader from "./SiteHeader";
import IncidentPanel from "./IncidentPanel";
import CommanderPanel from "./CommanderPanel";
import Call911 from "./Call911";
import { applyReport, useReports } from "../lib/reports";
import Num from "./Num";
import { parseIncident, type Incident } from "../lib/incident";
import { hourLabel, loadIndex, peopleAt, TIER_COLOR, type BuildingRow, type Tier } from "../lib/dossier";
import { populationTotals, EXPOSED_LABEL, parseScenario, scenarioScore, SCENARIOS, type Scenario } from "../lib/scenario";
import "./dossier.css";

const CITIES = {
  Houston: { lat: 29.76, lon: -95.42, zoom: 11 },
  "Los Angeles": { lat: 34.05, lon: -118.33, zoom: 11 },
};
type City = keyof typeof CITIES;

export default function Explorer({mode,onExit}:{mode?:"3am"|"call";onExit?:()=>void} = {}) {
  const [legacyDemo,setLegacyDemo]=useState(false);
  const [panel,setPanel]=useState<"incident"|"clock"|"commander"|null>("incident");
  const immersive=Boolean(mode)||legacyDemo;
  const exitDemo=()=>{if(onExit)onExit();else window.location.assign("/")};
  const [all, setAll] = useState<BuildingRow[]>([]);
  const [showMap,setShowMap]=useState(true);
  const [error, setError] = useState("");
  const [city, setCity] = useState<City>("Houston");
  const [hour, setHour] = useState(3);
  const [playing, setPlaying] = useState(false);
  const [query, setQuery] = useState("");
  const [tiers, setTiers] = useState<Tier[]>(["High", "Elevated", "Standard"]);
  const [type, setType] = useState("All");
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [onlyTours, setOnlyTours] = useState(false);
  const [sort, setSort] = useState<"score" | "now">("score");
  const [hover, setHover] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [placing, setPlacing] = useState(false);
  const [scenario, setScenario] = useState<Scenario>("fire");
  const [call, setCall] = useState<{ floor: number | null; buildingId: number | null; key: number } | null>(null);
  const reports = useReports();
  // Field reports (from /verify) adjust scores live; CoStar's own record is never overwritten.
  const rows = useMemo(() => all.map(b => applyReport(b, reports[b.id])), [all, reports]);
  // URL writes wait until the shared link has been read, or they would erase it.
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    loadIndex().then(d => setAll(d.buildings)).catch(e => setError(e.message));
    // Restore a shared incident link: ?incident=lat,lon,radius&h=hour
    const params = new URL(window.location.href).searchParams;
    if (["#directory","#population"].includes(location.hash) || params.has("incident")) setShowMap(true);
    const restoredIncident = parseIncident(params.get("incident"));
    setLegacyDemo(!mode && Boolean(restoredIncident || params.get("demo")==="3am" || location.hash==="#call"));
    setScenario(parseScenario(params.get("s")));
    const h = Number(params.get("h"));
    if (params.has("h") && Number.isInteger(h) && h >= 0 && h < 24) setHour(h);
    if (restoredIncident) { setIncident(restoredIncident); setCity(restoredIncident.lon < -105 ? "Los Angeles" : "Houston"); }
    if (!restoredIncident && (params.get("demo") === "3am" || mode==="3am")) { setScenario("fire"); demo(); }
    setRestored(true);
  }, []);

  // Keep the URL shareable while an incident is open.
  useEffect(() => {
    if (!restored) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("demo");
    if (incident) { url.searchParams.set("incident", `${incident.lat.toFixed(6)},${incident.lon.toFixed(6)},${incident.radius}`); url.searchParams.set("h", String(hour)); }
    else { url.searchParams.delete("incident"); url.searchParams.delete("h"); }
    if (scenario === "fire") url.searchParams.delete("s"); else url.searchParams.set("s", scenario);
    window.history.replaceState(window.history.state, "", url);
  }, [incident, hour, scenario, restored]);

  function place(lat: number, lon: number) { setIncident(i => ({ lat, lon, radius: i?.radius ?? 250 })); setPlacing(false); setCall(null); }
  function dispatch(d: { building: BuildingRow; hour: number; scenario: Scenario; floor: number }) {
    setCity(d.building.lon < -105 ? "Los Angeles" : "Houston"); setPlaying(false); setHour(d.hour); setScenario(d.scenario);
    setIncident({ lat: d.building.lat, lon: d.building.lon, radius: 250 }); setPlacing(false);
    setCall({ floor: d.floor, buildingId: d.building.id, key: Date.now() });
    if(immersive){setPanel("incident");return;}
    setTimeout(() => document.querySelector(".commander")?.scrollIntoView({ behavior: "smooth", block: "start" }), 900);
  }
  function demo() { setCity("Houston"); setPlaying(false); setHour(3); setIncident({ lat: 29.761614, lon: -95.364271, radius: 250 }); setPlacing(false); }
  const cityBuildings = useMemo(() => rows.filter(b => b.city === city), [rows, city]);
  const focus = useMemo(() => incident ? { lat: incident.lat, lon: incident.lon, zoom: incident.radius > 300 ? 15 : 16 } : CITIES[city], [incident, city]);
  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => setHour(h => (h + 1) % 24), 450);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing]);

  const types = useMemo(() => ["All", ...Array.from(new Set(all.map(b => b.type))).sort()], [all]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(b => b.city === city && tiers.includes(scenarioScore(b, scenario, hour).tier) && (type === "All" || b.type === type)
      && (!onlyGaps || b.sprinklers !== true) && (!onlyTours || b.tour)
      && (!q || (b.name + " " + b.street + " " + b.zip).toLowerCase().includes(q)));
  }, [rows, city, tiers, type, onlyGaps, onlyTours, query, scenario, hour]);

  const totals = useMemo(()=>populationTotals(shown,scenario,hour),[shown,scenario,hour]);

  const ranked = useMemo(() => [...shown].sort((a, b) => sort === "score" ? scenarioScore(b, scenario, hour).score - scenarioScore(a, scenario, hour).score || (b.people ?? 0) - (a.people ?? 0) : peopleAt(b, hour) - peopleAt(a, hour)).slice(0, 60), [shown, sort, hour, scenario]);
  const open = (b: BuildingRow) => { window.location.href = `/building?id=${b.id}&s=${scenario}`; };
  const meta = SCENARIOS[scenario];
  const night = hour >= 20 || hour < 6;

  return <main className={immersive?"hl immersiveDemo":"hl"} data-panel={panel??"none"}>
    {immersive && <><header className="demoTop"><strong><HavenMark/>HavenLens</strong><span>Training demo</span><button autoFocus onClick={exitDemo}>← Exit demo</button></header>
    <nav className="demoPanels" aria-label="Demo panels">{(["incident","clock","commander"] as const).filter(k=>k!=="commander"||incident).map(k=><button aria-pressed={panel===k} key={k} onClick={()=>setPanel(panel===k?null:k)}>{k==="incident"?"Map details":k==="clock"?"City clock":"Commander"}</button>)}</nav></>}
    <SiteHeader active="dossiers" />
    <section className="orbitHero">
      <div className="orbitIntro"><div className="orbitKicker">City atlas <i aria-hidden="true">/</i> {city === "Houston" ? "Texas" : "California"}</div>
      <h1>Pick a building.</h1>
      <div className="cityPick" role="group" aria-label="City">
        {(Object.keys(CITIES) as City[]).map(c => <button key={c} aria-pressed={city === c} onClick={() => { setCity(c); setIncident(null); setPlacing(false); }}>{c}</button>)}
      </div>
      <BuildingPicker key={city} buildings={cityBuildings} ready={!!all.length||!!error} scenario={scenario}/>
      {error && <p role="alert">We couldn’t load the buildings. Try refreshing.</p>}
      </div><CityPlate city={city} buildings={cityBuildings} />
    </section>

    <button className="mapDisclosure" aria-expanded={showMap} onClick={()=>setShowMap(!showMap)}>{showMap?"Hide city map":"Explore the city map"} {showMap?"↑":"↓"}</button>
    {showMap && <><nav className="sectionLinks" aria-label="Explore this city"><a href="#population">Population clock</a><a href="#directory">Map &amp; buildings</a><a href="/method">Sources &amp; coverage ↗</a></nav>
    <section id="population" className={`clock scn-${scenario}` + (night ? " night" : "")} aria-label="Population clock" style={{ ["--acc" as string]: `var(--signal-${scenario})` }}>
      <div className="scenarioBar">
        <div className="eyebrow">Hazard scenario</div>
        <div className="scenarioPick" role="radiogroup" aria-label="Hazard scenario">
          {(Object.keys(SCENARIOS) as Scenario[]).map(k => <button key={k} role="radio" aria-checked={scenario === k} className={scenario === k ? "on" : ""} style={{ ["--c" as string]: `var(--signal-${k})` }} onClick={() => setScenario(k)}><i />{SCENARIOS[k].label}</button>)}
        </div>
        <p className="muted scenarioBlurb">{meta.blurb}</p>
      </div>
      <div className="clockHead">
        <div>
          <div className="eyebrow">Who&apos;s inside · 24-hour clock</div>
          <div className="clockTime">{hourLabel(hour)} <span>{night ? "night" : "day"}</span></div>
        </div>
        <div className="stats">
          <Stat label="People inside (est.)" value={totals.now} />
          <Stat label={EXPOSED_LABEL[scenario].replace(/^./, c => c.toUpperCase())} value={totals.exposed || null} tone={totals.exposed ? "acc" : undefined} />
          <Stat label="May need help evacuating" value={totals.mobility} tone="acc" />
          <Stat label={`High ${meta.verb} priority`} value={totals.high} />
        </div>
      </div>
      <div className="clockRow">
        <button className="play" onClick={() => setPlaying(p => !p)} aria-label={playing ? "Pause the day" : "Play the day"}>{playing ? "❚❚" : "▶"}</button>
        <input type="range" min={0} max={23} step={1} value={hour} onChange={e => { setPlaying(false); setHour(Number(e.target.value)); }} aria-label="Hour of day" />
        <div className="ticks" aria-hidden="true"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span></div>
      </div>
      <p className="fine">Circles grow and shrink with estimated occupancy; color shows {meta.verb} priority. Estimates combine CoStar unit counts, hotel rooms, tenant headcounts and floor area with typical hourly profiles and national mobility rates. They are planning estimates, not live presence. <a href="/method">How we estimate</a>.</p>
    </section>

    {error ? <p className="errorBox">{error}</p> : <section id="directory" className="explore">
      <div className="mapCard">
        {all.length > 0 && <BuildingMap buildings={incident ? cityBuildings : shown} hour={hour} focus={focus} onSelect={open} highlight={hover}
          incident={incident} incidentMode={placing} onPlaceIncident={place} scenario={scenario} />}
        <div className="mapBar">
          <button className={placing ? "primary" : ""} aria-pressed={placing} onClick={() => setPlacing(p => !p)}>{placing ? "Click the map where it's happening…" : incident ? "Move incident pin" : "Report an incident"}</button>
          {!incident && <button onClick={demo}>Demo: 3 AM {meta.verb}, downtown Houston</button>}
          {all.length > 0 && <Call911 buildings={rows} onDispatch={dispatch} />}
        </div>
        <div className="legend">{(["High", "Elevated", "Standard"] as Tier[]).map(t => <span key={t}><i style={{ background: TIER_COLOR[t] }} />{t}</span>)}<span className="muted">size = people now</span></div>
      </div>
      <section className="side" aria-label="Buildings">
        {incident ? <IncidentPanel buildings={cityBuildings} incident={incident} hour={hour} scenario={scenario}
          onRadius={r => setIncident(i => i && { ...i, radius: r })} onMove={() => setPlacing(true)} onClear={() => { if(immersive){exitDemo();return;} setIncident(null); setPlacing(false); }} /> : <>
        <div className="filters">
          <input type="search" placeholder="Search name, street or ZIP" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search buildings" />
          <div className="chips" role="group" aria-label="Priority tiers">
            {(["High", "Elevated", "Standard"] as Tier[]).map(t => <button key={t} aria-pressed={tiers.includes(t)} onClick={() => setTiers(s => s.includes(t) ? s.filter(x => x !== t) : [...s, t])}><i style={{ background: TIER_COLOR[t] }} />{t}</button>)}
          </div>
          <div className="row">
            <select value={type} onChange={e => setType(e.target.value)} aria-label="Property type">{types.map(t => <option key={t}>{t}</option>)}</select>
            <select value={sort} onChange={e => setSort(e.target.value as "score" | "now")} aria-label="Sort"><option value="score">Sort: priority</option><option value="now">Sort: people now</option></select>
          </div>
          <label className="check"><input type="checkbox" checked={onlyGaps} onChange={e => setOnlyGaps(e.target.checked)} /> Sprinklers absent or unknown</label>
          <label className="check"><input type="checkbox" checked={onlyTours} onChange={e => setOnlyTours(e.target.checked)} /> Has Matterport 3D tour</label>
        </div>
        <div className="count">{shown.length.toLocaleString()} buildings · top {ranked.length}</div>
        <ol className="list">
          {ranked.map(b => { const sc = scenarioScore(b, scenario, hour); return <li key={b.id}>
            <a href={`/building?id=${b.id}&s=${scenario}`} onMouseEnter={() => setHover(b.id)} onMouseLeave={() => setHover(null)}>
              <span className="score" style={{ borderColor: `var(--signal-${scenario})`, color: "var(--text)" }}>{sc.score}</span>
              <span className="what"><b>{b.name}</b><small>{sc.tier} · {b.street} · {b.type}{b.stories ? ` · ${b.stories} fl` : ""}</small></span>
              <span className="now"><b>{peopleAt(b, hour).toLocaleString()}</b><small>now</small></span>
            </a>
          </li>; })}
        </ol>
        </>}
      </section>
    </section>}
    {incident && !error && <CommanderPanel incident={incident} hour={hour} scenario={scenario} buildings={cityBuildings} reports={reports} call={call} onSwitchHazard={setScenario} />}
    </>}
    <footer className="foot"><details><summary>Where the facts come from</summary><p>CoStar data kit (offline, licensed) · Vexcel imagery © Vexcel Imaging US, Inc. · Matterport tours © their owners. HavenLens is a pre-planning aid. It does not replace a site walk, the building&apos;s fire plan or a qualified inspection.</p></details></footer>
  </main>;
}

function Stat({ label, value, tone }: { label: string; value: number | null; tone?: "hot" | "acc" }) {
  return <div className={"stat" + (tone ? " " + tone : "")}><b>{value == null ? "—" : <Num value={value} />}</b><span>{label}</span></div>;
}
