// Field verification reports: an inspector or crew confirms a fact CoStar does not record (sprinklers).
// Stored as unverified field reports next to, never over, the CoStar record. Import-free so the Worker can use it.
const FIELDS = { sprinklers: "boolean" };

function reply(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

// GET /api/reports -> { [id]: { sprinklers: { value, yes, no, at } } }
// POST /api/reports { id, field, value }
export async function reports(request, { store, known }) {
  const all = (await store.read()) || {};
  if (request.method === "GET") return reply(all);
  // DELETE /api/reports?id=N clears one building's reports (the live demo resets before the field-verification scene).
  if (request.method === "DELETE") {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || !known(id)) return reply({ error: "Unknown building." }, 404);
    if (all[id]) { delete all[id]; await store.write(all); }
    return reply({ ok: true });
  }
  if (request.method !== "POST") return reply({ error: "Unsupported method." }, 405);
  const body = await request.text();
  if (body.length > 500) return reply({ error: "Request too large." }, 413);
  let input;
  try { input = JSON.parse(body); } catch { return reply({ error: "Invalid request." }, 400); }
  const id = Number(input?.id);
  if (!Number.isInteger(id) || !known(id)) return reply({ error: "Unknown building." }, 404);
  if (!(input.field in FIELDS) || typeof input.value !== FIELDS[input.field]) return reply({ error: "Unsupported field." }, 400);
  const entry = all[id] ||= {};
  const f = entry[input.field] ||= { yes: 0, no: 0 };
  if (input.value) f.yes++; else f.no++;
  f.value = input.value;            // the latest report wins, with the tally kept for review
  f.at = new Date().toISOString();
  await store.write(all);
  return reply({ ok: true, report: entry });
}
