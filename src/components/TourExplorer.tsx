"use client";

import { useEffect, useState, type FormEvent } from "react";

import Exercise from "./Exercise";
import "./studio.css";

export type Tour = {title: string; id: string; coverage?: string; floorLabels?: string[]};

export default function TourExplorer({tours}: {tours: Tour[]}) {
  const featured = tours.find(t => t.coverage)?.id ?? tours[0]?.id ?? "";
  const [restored, setRestored] = useState(false);
  const [custom, setCustom] = useState<Tour | null>(null);
  const [selected, setSelected] = useState(featured);
  const [error, setError] = useState("");
  const options = custom ? [...tours, custom] : tours;
  const current = options.find(t => t.id === selected);
  const url = current && "https://my.matterport.com/show/?m="+current.id;

  useEffect(() => {
    const restore = () => {
      const requested = new URL(window.location.href).searchParams.get("tour");
      if (requested && /^[A-Za-z0-9]{11}$/.test(requested)) {
        if (!tours.some(t=>t.id===requested)) setCustom({id:requested,title:"Shared tour"});
        setSelected(requested);
      } else setSelected(featured);
      setRestored(true);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [tours, featured]);

  function selectTour(id: string) {
    const address = new URL(window.location.href);
    address.searchParams.set("tour", id);
    address.hash = "";
    window.history.replaceState(window.history.state, "", address);
    setSelected(id);
  }

  function openTour(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const link = new URL(String(new FormData(event.currentTarget).get("tour")));
      const id = link.searchParams.get("m") || "";
      if (link.origin !== "https://my.matterport.com" || link.pathname.replace(/\/$/, "") !== "/show" || !/^[A-Za-z0-9]{11}$/.test(id)) throw new Error();
      if (!options.some(t => t.id === id)) setCustom({id, title:"Shared tour"});
      selectTour(id);
      setError("");
    } catch {
      setError("Enter a Matterport share link beginning with https://my.matterport.com/show/?m=.");
    }
  }

  return <main className="studio">
    <header className="mast"><div className="brand"><i aria-hidden="true" className="lens"/>HavenLens</div><a href="/training">Simulation lab ↗</a></header>
    <section className="studioTitle"><div><div className="mono"><i className="square"/> PRE-INCIDENT TRAINING</div><h1>Exercise room<span>.</span></h1></div>
      <div className="tourPick"><label htmlFor="capture">CAPTURED SPACE</label><select id="capture" value={selected} onChange={e=>selectTour(e.target.value)}>
        {options.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}
      </select></div>
    </section>
    <div className="room"><section className="capture" aria-label="Real building scan">
      <div className="captureTop"><div><span className="mono">SPATIAL VIEW</span><h2>{current?.title ?? "Choose a tour"}</h2></div>
      {url && <a href={url} target="_blank" rel="noreferrer">Matterport ↗</a>}</div>
      {current && url ? <iframe key={current.id} className="scan" title={current.title+" · Matterport tour"} src={url+"&play=1"} allow="fullscreen; xr-spatial-tracking" allowFullScreen/> :
        <p className="inside">Open a Matterport share link below to get started.</p>}
      <div className="captureFoot"><div className="mono">CAPTURE NOTES</div>
        <p>{current?.coverage || (current?.floorLabels?.length ? "Use the stacked-layers control to explore "+current.floorLabels.join(" and ")+".":"Explore the areas included in this Matterport capture.")}</p>
      </div></section>
      {current && restored && <Exercise key={current.id} id={current.id} title={current.title}/>}
    </div>
    <details className="addTour"><summary>Open another Matterport tour</summary>
      <form className="tourform" onSubmit={openTour}><label>Tour share link <input name="tour" type="url" required placeholder="https://my.matterport.com/show/?m=…"/></label> <button>Open tour</button></form>
      {error && <p role="alert">{error}</p>}
    </details>
  </main>;
}
