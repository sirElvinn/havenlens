import TourExplorer, { type Tour } from "../components/TourExplorer";

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Brief } from "../components/Briefing";

export default function Home() {
  const configured: unknown = JSON.parse(process.env.HAVENLENS_TOURS || "[]");
  if (!Array.isArray(configured)) throw new Error("HAVENLENS_TOURS must be a list.");
  const file = join(process.cwd(), "private-data", "briefings.json");
  const briefs: Record<string, Brief> = existsSync(file) ? JSON.parse(readFileSync(file,"utf8")) : {};
  const parcelFile = join(process.cwd(), "private-data", "parcel-context.json");
  const parcels = existsSync(parcelFile) ? JSON.parse(readFileSync(parcelFile,"utf8")) : {};
  const tours: Tour[] = configured.map(item => {
    if (typeof item?.title !== "string" || !item.title.trim() ||
        typeof item.id !== "string" || !/^[a-zA-Z0-9]{11}$/.test(item.id))
      throw new Error("Each configured tour needs a title and a Matterport model ID.");
    const labels: unknown = item.floorLabels;
    if (labels !== undefined && (!Array.isArray(labels) ||
        !labels.every(label => typeof label === "string" && label.trim())))
      throw new Error("Supply verified Matterport floor names as a list of strings.");
    if (item.coverage !== undefined && typeof item.coverage !== "string")
      throw new Error("Supply capture coverage as text.");
    return { brief:briefs[item.id] && {...briefs[item.id], parcel:parcels[item.id]}, title: item.title, id: item.id, coverage: item.coverage, floorLabels: labels as string[] | undefined };
  });
  return <TourExplorer tours={tours}/>;
}
