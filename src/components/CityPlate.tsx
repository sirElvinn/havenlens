import { memo, useMemo } from "react";
import type { BuildingRow } from "../lib/dossier";

// Each cell measures record density, independent of a property's height or use.
const scale = 26;
const project = (x: number, y: number) => [231 + (x - y) * 7.8, 79 + (x + y) * 3.65];
function plate(buildings: BuildingRow[]) {
  const entries = buildings.filter(b => Number.isFinite(b.lon) && Number.isFinite(b.lat));
  if (!entries.length) return [];
  const longitude = entries.map(b => b.lon), latitude = entries.map(b => b.lat);
  const west = Math.min(...longitude), east = Math.max(...longitude);
  const south = Math.min(...latitude), north = Math.max(...latitude);
  const cells = Array<number>(scale * scale).fill(0);
  const index = (fraction: number) => Math.min(scale - 1, Math.floor(fraction * scale));
  for (const b of entries) {
    const x = index((b.lon - west) / (east - west || 1));
    const y = index((north - b.lat) / (north - south || 1));
    cells[y * scale + x]++;
  }
  return cells.map((count, i) => ({ count, x: i % scale, y: Math.floor(i / scale) }))
    .filter(cell => cell.count > 0).sort((a,b) => a.x + a.y - b.x - b.y);
}
export default memo(function CityPlate({city,buildings}:{city:string;buildings:BuildingRow[]}) {
  const cells = useMemo(() => plate(buildings), [buildings]);
  return <figure className="surveyPlate">
    <div className="plateLine"><span>PROPERTY COVERAGE</span><span>{city === "Houston" ? "TX" : "CA"} / US</span></div>
    <svg className="coverageEntry" key={city} viewBox="0 0 462 278" role="img" aria-label={city+" property records grouped by geographic grid cell. Taller columns indicate more records."}>
      <g fill="none" stroke="var(--plate-grid)" strokeWidth=".65">{Array.from({length:scale+1},(_,i)=><path key={i} d={`M${project(i,0)}L${project(i,scale)}M${project(0,i)}L${project(scale,i)}`}/>)}</g>
      {cells.map(({x,y,count})=>{
        const [cx,cy] = project(x+.5,y+.5), h = 3 + Math.log2(count)*10;
        return <g key={x+":"+y} transform={`translate(${cx} ${cy})`}>
          <path d={`M-7 0v-${h}l7 3.3v${h}Z`} fill="var(--plate-west)"/>
          <path d={`M7 0v-${h}l-7 3.3v${h}Z`} fill="var(--plate-east)"/>
          <path d={`M0 ${-h-3.3}l7 3.3-7 3.3-7-3.3Z`} fill="var(--plate-top)" stroke="var(--plate-east)" strokeWidth=".35"/>
        </g>
      })}
    </svg>
    <figcaption><b>{city}</b><span>Column height = records per cell</span></figcaption>
  </figure>;
});
