"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { fmt, type Dossier, type Factor, type Tier } from "../lib/dossier";
import { SCENARIOS, type Scenario } from "../lib/scenario";
import { useShareOrigin } from "../lib/reports";

type Props = { d: Dossier; scenario: Scenario; score: number; tier: Tier; factors: Factor[]; mobility: number; onClose: () => void };

/** A printable door placard: the building's key life-safety facts and a QR code to the live dossier. */
export default function Placard({ d, scenario, score, tier, factors, mobility, onClose }: Props) {
  const [qr, setQr] = useState("");
  const [link, setLink] = useState("");
  const origin = useShareOrigin();
  useEffect(() => {
    if (!origin) return;
    // The QR opens the field card: crews confirm facts CoStar lacks, and can open the full dossier from there.
    const url = `${origin}/verify?id=${d.id}${scenario === "fire" ? "" : "&s=" + scenario}`;
    setLink(url);
    QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0f1113", light: "#ffffff" } }).then(setQr).catch(() => setQr(""));
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.body.classList.add("placardOpen");
    window.addEventListener("keydown", onKey);
    return () => { document.body.classList.remove("placardOpen"); window.removeEventListener("keydown", onKey); };
  }, [d.id, scenario, onClose, origin]);

  const meta = SCENARIOS[scenario];
  const facts: [string, string | null][] = [
    ["Stories", fmt(d.stories)], ["Height", fmt(d.heightFeet, " ft")], ["Construction", d.material],
    ["Sprinklers", d.sprinklers === null ? null : d.sprinklers ? "Yes" : "None recorded"],
    ["Elevators", fmt(d.elevators)], ["Built", d.built ? String(d.built) : null],
  ];

  return <div className="placardBack" role="dialog" aria-modal="true" aria-label="Door placard" onClick={onClose}>
    <div className="placardWrap" onClick={e => e.stopPropagation()}>
      <article className="placard" style={{ ["--acc" as string]: meta.accent }}>
        <header>
          <div><small>HAVENLENS PRE-INCIDENT PLACARD · COSTAR #{d.id}</small><h2>{d.name}</h2><p>{d.street}, {d.city}, {d.state} {d.zip}</p></div>
          <div className="pScore"><b>{score}</b><span>{tier} {meta.verb} priority</span></div>
        </header>
        <dl>{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={v ? "" : "unk"}>{v ?? "Unknown"}</dd></div>)}</dl>
        <div className="pPeople">
          <div><b>{fmt(d.people) ?? "?"}</b><span>people at busiest hour (est.)</span></div>
          <div><b>~{mobility.toLocaleString()}</b><span>may need help evacuating</span></div>
          {d.apartment?.lifestyle === "Senior" && <div className="warn"><b>Senior</b><span>housing community</span></div>}
          {d.apartment?.walkup && <div className="warn"><b>Walk-up</b><span>no elevator</span></div>}
        </div>
        <ul>{factors.slice(0, 4).map(f => <li key={f.label}><strong>{f.label}.</strong> {f.detail}</li>)}</ul>
        <footer>
          <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} aria-label="QR code to the live dossier" />
          <p>Scan to confirm sprinklers and other facts on site, and to open the live dossier: aerial imagery, floor stack, tenants and 3D evacuation model.<br /><span className="link">{link}</span><br />Planning aid built from CoStar records. Verify on site.</p>
        </footer>
      </article>
      <div className="placardActions"><button className="primary" onClick={() => window.print()}>Print placard</button><button onClick={onClose}>Close</button></div>
    </div>
  </div>;
}
