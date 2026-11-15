import { useMemo, useState } from "react";
import type { BuildingRow } from "../lib/dossier";

export default function BuildingPicker({buildings, scenario, ready}: {
  buildings: BuildingRow[]; scenario: string; ready: boolean;
}) {
  const [query,setQuery]=useState("");
  const [page,setPage]=useState(0);
  const size=4;
  const matches=useMemo(()=>{
    const term=query.trim().toLowerCase();
    return buildings.filter(b=>[b.name,b.street,b.zip].join(" ").toLowerCase().includes(term))
      .sort((a,b)=>a.name.localeCompare(b.name,"en",{numeric:true}) || a.id-b.id);
  },[buildings,query]);
  const start=page*size;
  return <section className="pickRecords" aria-label="Choose a building">
    <label>Find a name or street<input type="search" placeholder="Name, street or ZIP code" value={query} onChange={e=>{setQuery(e.target.value);setPage(0)}}/></label>
    {matches.slice(start,start+size).map(b=><a className="pickRecord" href={`/building?id=${b.id}&s=${scenario}`} key={b.id}>
      <span><b>{b.name}</b><small>{b.street}</small></span><span aria-hidden="true">→</span></a>)}
    <div className="pickPages"><small aria-live="polite">{matches.length ? `${start+1}–${Math.min(start+size,matches.length)} of ${matches.length.toLocaleString()}` : ready ? "No matches. Try another name." : "Loading buildings…"}</small>
      {matches.length>size && <span><button disabled={!page} aria-label="Previous buildings" onClick={()=>setPage(page-1)}>←</button><button disabled={start+size>=matches.length} aria-label="More buildings" onClick={()=>setPage(page+1)}>→</button></span>}
    </div>
  </section>;
}
