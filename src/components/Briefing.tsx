export type Brief = {
  facts: Record<string, string>;
  records: Record<string, number>;
  question: string;
};

export default function Briefing({brief}: {brief?:Brief}) {
  if (!brief) return <p className="captureFoot">Organizer records have not been matched to this shared tour.</p>;
  return <section className="dossier" aria-label="Property briefing">
    <div className="dossierTitle"><h3>Property briefing</h3><span>CoStar kit</span></div>
    <dl>{Object.entries(brief.facts).map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
    <details><summary>Related organizer records</summary>
      <ul>{Object.entries(brief.records).map(([name,count])=><li key={name}>{name}<b>{count}</b></li>)}</ul>
      <p>Counts describe records in the supplied kit. Tenancy history cannot establish who is present today.</p>
    </details>
  </section>;
}
