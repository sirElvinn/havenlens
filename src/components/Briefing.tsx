export type Brief = {
  facts: Record<string, string>;
  records: Record<string, number>;
  question: string;
  parcel?: {collection:string | null; structureCount:number | null; checked:string} | null;
};

export default function Briefing({brief}: {brief?:Brief}) {
  if (!brief) return <p className="captureFoot">Organizer records have not been matched to this shared tour.</p>;
  return <section className="dossier" aria-label="Property briefing">
    <div className="dossierTitle"><h3>Property briefing</h3><span>CoStar kit</span></div>
    <dl>{Object.entries(brief.facts).map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
    <details><summary>Exterior parcel · Vexcel</summary>
      {brief.parcel ? <p>Collection {brief.parcel.collection ?? "unreported"} · Structures {brief.parcel.structureCount ?? "unreported"} · Retrieved {brief.parcel.checked}</p> : <p>{brief.parcel === null ? "The lookup returned no parcel for this location." : "No parcel lookup has been published for this capture."}</p>}
    </details>
    <details><summary>Related organizer records</summary>
      <ul>{Object.entries(brief.records).map(([name,count])=><li key={name}>{name}<b>{count}</b></li>)}</ul>
      <p>Counts describe records in the supplied kit. Tenancy history cannot establish who is present today.</p>
    </details>
  </section>;
}
