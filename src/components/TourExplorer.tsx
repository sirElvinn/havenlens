"use client";

import { useState, type FormEvent } from "react";

export type Tour = {title: string; id: string; floorLabels?: string[]};

export default function TourExplorer({tours}: {tours: Tour[]}) {
  const [custom, setCustom] = useState<Tour | null>(null);
  const [selected, setSelected] = useState(tours[0]?.id ?? "");
  const [error, setError] = useState("");
  const options = custom ? [...tours, custom] : tours;
  const current = options.find(t => t.id === selected);
  const url = current && "https://my.matterport.com/show/?m="+current.id;

  function openTour(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const link = new URL(String(new FormData(event.currentTarget).get("tour")));
      const id = link.searchParams.get("m") || "";
      if (link.origin !== "https://my.matterport.com" || link.pathname.replace(/\/$/, "") !== "/show" || !/^[A-Za-z0-9]{11}$/.test(id)) throw new Error();
      if (!options.some(t => t.id === id)) setCustom({id, title:"Shared tour"});
      setSelected(id);
      setError("");
    } catch {
      setError("Enter a Matterport share link beginning with https://my.matterport.com/show/?m=.");
    }
  }

  return <main>
    <header><strong><span className="logo" aria-hidden="true">◈</span> HavenLens</strong><a href="/training">Training demo</a></header>
    <section className="intro"><small>MATTERPORT TOURS</small><h1>Building explorer</h1></section>
    <section className="panel">
      <div className="bar tourbar">{current && <>
        <label>Captured space <select value={selected} onChange={e=>setSelected(e.target.value)}>
          {options.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}
        </select></label>
        <a href={url} target="_blank" rel="noreferrer">Open in Matterport ↗</a>
      </>}</div>
      {current && url ? <iframe key={current.id} className="scan" title={current.title+" · Matterport tour"} src={url+"&play=1"} allow="fullscreen; xr-spatial-tracking" allowFullScreen/> :
        <p className="inside">Open a shared Matterport tour to explore the captured space.</p>}
      {current?.floorLabels?.length ? <p className="hint">
        In the tour, open <strong>Floor Selector</strong> (stacked layers) to visit {current.floorLabels.join(" or ")}.
      </p> : null}
    </section>
    <details className="inside"><summary>Open another Matterport tour</summary>
      <form className="tourform" onSubmit={openTour}><label>Tour share link <input name="tour" type="url" required placeholder="https://my.matterport.com/show/?m=…"/></label> <button>Open tour</button></form>
      {error && <p role="alert">{error}</p>}
    </details>
  </main>;
}
