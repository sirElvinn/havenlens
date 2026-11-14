import {commercialProperty, parcelSummary} from "./providers.mjs";

const [provider, first, second] = process.argv.slice(2);
try {
  let result;
  if (provider === "costar" && first && second) {
    result = await commercialProperty(first, second);
  } else if (provider === "vexcel" && first?.trim() && second?.trim()) {
    result = await parcelSummary(Number(first), Number(second), process.env.VEXCEL_API_KEY);
  } else {
    throw new Error("Use costar <commercial-property.jsonl> <id> or vexcel <longitude> <latitude>.");
  }
  console.log(JSON.stringify(result ?? {status:"no matching record"},null,2));
} catch (error) {
  // Parser errors may quote licensed source text.
  console.error(error instanceof SyntaxError ? "Invalid source JSON." : error.message);
  process.exitCode = 1;
}
