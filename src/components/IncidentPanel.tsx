"use client";

import { useState } from "react";
import { hourLabel, TIER_COLOR, type BuildingRow } from "../lib/dossier";
import { analyze, FLAG_LABEL, type Incident } from "../lib/incident";
import Num from "./Num";
import { EXPOSED_LABEL, scenarioScore, SCENARIOS, type Scenario } from "../lib/scenario";

type Props = {
  buildings: BuildingRow[];
  incident: Incident;
  hour: number;
  scenario: Scenario;
  onRadius: (r: number) => void;
  onMove: () => void;
  onClear: () => void;
};

const RADII = [150, 250, 500];
const fmtDist = (m: number) => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function IncidentPanel({ buildings, incident, hour, scenario, onRadius, onMove, onClear }: Props) {
  const a = analyze(buildings, incident, hour, scenario);
  const [copied, setCopied] = useState(false);
  const meta = SCENARIOS[scenario];

  const alerts: string[] = [];
  if (a.mobility) alerts.push(`About ${a.mobility.toLocaleString()} people may need help to evacuate: wheelchair users and people who can't manage stairs.`);
  if (scenario === "fire" && a.exposed) alerts.push(`${a.exposed.toLocaleString()} people are likely asleep in residential buildings or hotels.`);
  if (scenario === "flood") {
    if (a.exposed) alerts.push(`About ${a.exposed.toLocaleString()} people are at ground or below-grade level.`);
    if (a.belowgrade) alerts.push(`${plural(a.belowgrade, "building has", "buildings have")} basements or lower levels on record.`);
  }
  if (scenario === "blackout") {
    if (a.highrise) alerts.push(`${plural(a.highrise, "high-rise loses", "high-rises lose")} elevator service: stairs only.`);
    if (a.exposed) alerts.push(`About ${a.exposed.toLocaleString()} people with limited mobility are on upper floors and may need carrying down.`);
  }
  if (a.senior) alerts.push(`${plural(a.senior, "senior housing community", "senior housing communities")}: expect assisted evacuations.`);
  if (a.healthcare) alerts.push(`${plural(a.healthcare, "healthcare building", "healthcare buildings")}: patients may be non-ambulatory.`);
  if (scenario === "fire" && a.highrise) alerts.push(`${plural(a.highrise, "high-rise", "high-rises")}: upper floors are beyond typical aerial-ladder reach.`);
  if (scenario === "fire" && a.sprinklersUnconfirmed) alerts.push(`${a.sprinklersUnconfirmed} of ${a.nearby.length} buildings have no sprinklers on record, or their status is unknown.`);

  async function copy() {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
  }

  return <div className="incident" style={{ ["--acc" as string]: meta.accent }}>
    <div className="incHead">
      <div className="eyebrow"><i className="dot" style={{ background: meta.accent }} /> {meta.label} incident · {hourLabel(hour)}</div>
      <h2>{a.closest ? `Near ${a.closest.b.name}` : "No buildings in range"}</h2>
      <p className="muted">{a.closest ? `${a.closest.b.street} · ` : ""}{incident.lat.toFixed(5)}, {incident.lon.toFixed(5)}</p>
      <div className="chips" role="group" aria-label="Search radius">
        {RADII.map(r => <button key={r} aria-pressed={incident.radius === r} onClick={() => onRadius(r)}>{r} m</button>)}
      </div>
    </div>

    <div className="incStats">
      <div className="acc"><b><Num value={a.people} /></b><span>people inside now (est.)</span></div>
      <div className={a.exposed ? "acc" : ""}><b>{a.exposed ? <Num value={a.exposed} /> : "—"}</b><span>{EXPOSED_LABEL[scenario]}</span></div>
      <div className={a.mobility ? "acc" : ""}><b><Num value={a.mobility} /></b><span>may need help evacuating</span></div>
      <div><b>{a.nearby.length}</b><span>buildings in {incident.radius} m</span></div>
    </div>

    {alerts.length > 0 && <ul className="incAlerts">{alerts.map(t => <li key={t}>{t}</li>)}</ul>}

    <div className="count">Check first · ranked by {meta.verb} priority, people now, mobility needs and distance</div>
    <ol className="incList">
      {a.nearby.slice(0, 10).map((n, i) => {
        const tier = scenarioScore(n.b, scenario, hour).tier;
        return <li key={n.b.id}>
          <a href={`/building?id=${n.b.id}&s=${scenario}`}>
            <span className="rank" style={{ borderColor: TIER_COLOR[tier], color: TIER_COLOR[tier] }}>{i + 1}</span>
            <span className="what">
              <b>{n.b.name}</b>
              <small>{fmtDist(n.dist)} {n.dir} · {n.b.type}{n.b.stories ? ` · ${n.b.stories} fl` : ""}{n.mobility ? ` · ~${n.mobility} need help` : ""}</small>
              {n.b.flags.length > 0 && <span className="pills">{n.b.flags.filter(f => f !== "old").slice(0, 3).map(f => <em key={f} className={f}>{FLAG_LABEL[f]}</em>)}</span>}
            </span>
            <span className="now"><b>{n.now.toLocaleString()}</b><small>inside</small></span>
          </a>
        </li>;
      })}
      {!a.nearby.length && <li className="muted empty">No buildings from the CoStar set fall inside this radius. Try a larger radius.</li>}
    </ol>

    <div className="incActions">
      <button onClick={onMove}>Move pin</button>
      <button onClick={copy}>{copied ? "Link copied" : "Copy incident link"}</button>
      <button className="ghost" onClick={onClear}>Clear</button>
    </div>
    <p className="fine">Estimates come from CoStar records, typical hourly profiles and national mobility rates, not live presence. <a href="/method">How we estimate</a>.</p>
  </div>;
}
