import TourExplorer, { type Tour } from "../components/TourExplorer";

export default function Home() {
  const configured: unknown = JSON.parse(process.env.HAVENLENS_TOURS || "[]");
  if (!Array.isArray(configured)) throw new Error("HAVENLENS_TOURS must be a list.");
  const tours: Tour[] = configured.map(item => {
    if (typeof item?.title !== "string" || !item.title.trim() ||
        typeof item.id !== "string" || !/^[a-zA-Z0-9]{11}$/.test(item.id))
      throw new Error("Each configured tour needs a title and a Matterport model ID.");
    return { title: item.title, id: item.id };
  });
  return <TourExplorer tours={tours}/>;
}
