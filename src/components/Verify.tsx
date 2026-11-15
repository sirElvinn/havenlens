"use client";

import { useEffect, useState } from "react";
import { loadDossier, type Dossier } from "../lib/dossier";
import { applyReport, postReport, useReports } from "../lib/reports";
import { scenarioScore } from "../lib/scenario";
import SiteHeader from "./SiteHeader";
import "./dossier.css";

/**
 * Field verification card, opened from the door placard's QR code. A crew member or inspector confirms
 * what CoStar does not record; the report is stored as unverified and the building's score updates live.
 */
export default function Verify() {
  const [d, setD] = useState<Dossier | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const reports = useReports(4000);

  useEffect(() => {
    const id = Number(new URL(window.location.href).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) { setD(null); return; }
    loadDossier(id).then(x => setD(x)).catch(() => setD(null));
  }, []);

  if (d === undefined) return <main className="hl verify"><p className="loading">Loading…</p></main>;
  if (d === null) return <main className="hl verify"><p className="errorBox">Unknown building. Scan the placard again.</p></main>;

  const report = reports[d.id]?.sprinklers;
  const before = scenarioScore(d, "fire", 3).score;
  const now = scenarioScore(applyReport(d, reports[d.id]), "fire", 3).score;
  const costar = d.sprinklers === null ? "Not recorded" : d.sprinklers ? "Yes" : "No";

  async function send(value: boolean) {
    setBusy(true); setError("");
    try { await postReport(d!.id, "sprinklers", value); setDone(value); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return <main className="hl verify">
    <SiteHeader active="field" />
    <section className="vCard">
      <div className="eyebrow">Field verification · CoStar #{d.id} · {d.type}</div>
      <h1>{d.name}</h1>
      <p className="muted">{d.street}, {d.city}</p>
      <dl className="vFacts">
        <div><dt>Sprinklers in CoStar</dt><dd className={d.sprinklers === null ? "unk" : ""}>{costar}</dd></div>
        <div><dt>Field reports</dt><dd>{report ? `${report.yes} yes · ${report.no} no` : "None yet"}</dd></div>
      </dl>
      <h2>Is this building sprinklered?</h2>
      <p className="muted">Check for sprinkler heads in the ceiling, a riser room or a fire department connection outside.</p>
      <div className="vButtons">
        <button className="vYes" onClick={() => send(true)} disabled={busy}>Sprinklers confirmed: YES</button>
        <button className="vNo" onClick={() => send(false)} disabled={busy}>No sprinklers: NO</button>
      </div>
      {error && <p className="errorBox">{error}</p>}
      {done !== null && <p className="vDone">Thanks. Recorded as an unverified field report: <b>{done ? "sprinklered" : "not sprinklered"}</b>. Fire priority at 3 AM: {before} → <b>{now}</b>. It updates on every HavenLens screen within seconds.</p>}
      <a className="btnLink vOpen" href={`/building?id=${d.id}`}>Open the full dossier</a>
      <p className="fine">Reports sit next to the CoStar record and never overwrite it. They are queued for verification, the gap CoStar could fill for about 78% of buildings in this dataset.</p>
    </section>
  </main>;
}
