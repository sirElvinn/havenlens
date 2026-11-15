"use client";

import { useEffect, useRef, useState } from "react";
import type { BuildingRow } from "../lib/dossier";
import type { Scenario } from "../lib/scenario";

// Scripted, clearly simulated calls for the demo. The address is resolved against the CoStar index at run time.
export const CALLS = [
  {
    id: "houston", label: "Houston · 3 AM · senior apartments",
    hour: 3, scenario: "fire" as Scenario, floor: 2,
    lines: [
      ["Dispatcher", "911, what is the address of your emergency?"],
      ["Caller", "5105 Airline Drive, the Catania apartments in Houston. There's smoke in the hallway on the second floor!"],
      ["Dispatcher", "Is anyone trapped?"],
      ["Caller", "My neighbor uses a wheelchair and the elevator's not working. A lot of older people live here."],
    ],
  },
  {
    id: "la", label: "Los Angeles · 2 PM · medical mid-rise",
    hour: 14, scenario: "fire" as Scenario, floor: 6,
    lines: [
      ["Dispatcher", "911, what is the address of your emergency?"],
      ["Caller", "11980 San Vicente Boulevard, Brentwood Medical Plaza. The fire alarm is going and there's smoke on the sixth floor."],
      ["Dispatcher", "How many people are in the building?"],
      ["Caller", "It's a medical building, there are patients up here. Some can't walk."],
    ],
  },
] as const;

const SUFFIX: Record<string, string> = { drive: "dr", dr: "dr", boulevard: "blvd", blvd: "blvd", street: "st", st: "st", avenue: "ave", ave: "ave", road: "rd", rd: "rd", way: "way", lane: "ln", ln: "ln" };

/** Pull "number street suffix" out of a transcript line and find it in the CoStar index. */
export function resolveAddress(text: string, buildings: BuildingRow[]) {
  const m = text.match(/(\d{2,6})\s+([A-Za-z][A-Za-z ]*?)\s+(Drive|Dr|Boulevard|Blvd|Street|St|Avenue|Ave|Road|Rd|Way|Lane|Ln)\b/i);
  if (!m) return null;
  const num = m[1], name = m[2].toLowerCase().trim(), suffix = SUFFIX[m[3].toLowerCase()];
  const hit = buildings.find(b => {
    const s = b.street.toLowerCase();
    return s.startsWith(num + " ") && s.includes(name) && (!suffix || s.endsWith(" " + suffix) || s.includes(" " + suffix + " "));
  }) ?? buildings.find(b => b.street.toLowerCase().startsWith(num + " ") && b.street.toLowerCase().includes(name.split(" ")[0]));
  return hit ? { building: hit, parsed: `${num} ${m[2]} ${m[3]}` } : null;
}

type Dispatch = { building: BuildingRow; hour: number; scenario: Scenario; floor: number };

export default function Call911({ buildings, onDispatch }: { buildings: BuildingRow[]; onDispatch: (d: Dispatch) => void }) {
  const [open, setOpen] = useState(() => typeof window !== "undefined" && window.location.hash === "#call");
  const [active, setActive] = useState<(typeof CALLS)[number] | null>(null);
  const [shown, setShown] = useState(0);
  const [steps, setSteps] = useState<string[]>([]);
  const [muted, setMuted] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => () => { cancelled.current = true; window.speechSynthesis?.cancel(); }, []);

  function speak(text: string, who: string) {
    return new Promise<void>(resolve => {
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      if (muted || !synth) { setTimeout(resolve, Math.min(2600, 600 + text.length * 28)); return; }
      const u = new SpeechSynthesisUtterance(text);
      const voices = synth.getVoices().filter(v => v.lang.startsWith("en"));
      u.voice = voices[who === "Caller" ? Math.min(1, voices.length - 1) : 0] ?? null;
      u.rate = who === "Caller" ? 1.12 : 1.02;
      u.pitch = who === "Caller" ? 1.15 : 0.9;
      const done = () => resolve();
      u.onend = done; u.onerror = done;
      setTimeout(done, 12000);   // never hang the demo on speech
      synth.speak(u);
    });
  }

  async function play(call: (typeof CALLS)[number]) {
    cancelled.current = false;
    setActive(call); setShown(0); setSteps([]);
    let resolved: ReturnType<typeof resolveAddress> = null;
    for (let i = 0; i < call.lines.length; i++) {
      if (cancelled.current) return;
      setShown(i + 1);
      const [who, text] = call.lines[i];
      if (who === "Caller" && !resolved) {
        resolved = resolveAddress(text, buildings);
        // Resolve while the caller is still talking.
        setTimeout(() => {
          if (!resolved) { setSteps(s => [...s, "Address not found in the CoStar index"]); return; }
          setSteps(s => [...s, `Heard address: ${resolved!.parsed}`, `Matched CoStar #${resolved!.building.id}: ${resolved!.building.name}, ${resolved!.building.city}`,
            `Clock set to ${call.hour % 12 || 12}:00 ${call.hour < 12 ? "AM" : "PM"} · hazard ${call.scenario} · reported floor ${call.floor}`]);
        }, 700);
      }
      await speak(text, who);
    }
    if (cancelled.current || !resolved) return;
    setSteps(s => [...s, "Pin placed · Incident Commander starting"]);
    await new Promise(r => setTimeout(r, 700));
    setOpen(false);
    onDispatch({ building: resolved.building, hour: call.hour, scenario: call.scenario, floor: call.floor });
  }

  function close() { cancelled.current = true; window.speechSynthesis?.cancel(); setOpen(false); setActive(null); }

  return <>
    <button className="call911" onClick={() => setOpen(true)}><i aria-hidden="true" />Play incoming 911 call</button>
    {open && <div className="callBack" role="dialog" aria-modal="true" aria-label="Simulated 911 call" onClick={close}>
      <div className="callCard" onClick={e => e.stopPropagation()}>
        <div className="callTop"><span className="eyebrow"><i className="dot" /> Simulated 911 call</span><button className="ghost" onClick={close}>Close ✕</button></div>
        {!active ? <>
          <h2>Choose a call</h2>
          <p className="muted">A scripted call is read aloud. HavenLens finds the address in CoStar&apos;s index, sets the clock and hazard, drops the pin and starts the Incident Commander.</p>
          <div className="callChoices">{CALLS.map(c => <button key={c.id} onClick={() => play(c)}>{c.label}</button>)}</div>
          <label className="check"><input type="checkbox" checked={muted} onChange={e => setMuted(e.target.checked)} /> Text only (no audio)</label>
        </> : <div className="callGrid">
          <ol className="transcript">{active.lines.slice(0, shown).map(([who, text], i) => <li key={i} className={who === "Caller" ? "caller" : ""}><b>{who}</b><p>{text}</p></li>)}</ol>
          <ol className="callSteps">{steps.map((s, i) => <li key={i}>{s}</li>)}{steps.length === 0 && <li className="muted">Listening for an address…</li>}</ol>
        </div>}
      </div>
    </div>}
  </>;
}
