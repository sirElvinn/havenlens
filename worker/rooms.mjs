const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function reply(data,status=200) {
  return Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
}

export async function rooms(request, bucket) {
  const url = new URL(request.url);
  if (!bucket) return reply({error:"Team storage is unavailable."},503);
  const id = url.pathname.split("/")[3];
  let input = {};
  if (request.method === "POST") {
    if (request.headers.get("origin") !== url.origin) return reply({error:"Invalid origin."},403);
    const body = await request.text();
    if (body.length > 5000) return reply({error:"Request too large."},413);
    try { input = JSON.parse(body); } catch { return reply({error:"Invalid request."},400); }
    if (!input || typeof input !== "object") return reply({error:"Invalid request."},400);
  }
  if (!id && request.method==="POST" && /^[A-Za-z0-9]{11}$/.test(input.tour)) {
    const room=crypto.randomUUID(), host=crypto.randomUUID();
    await bucket.put("room/"+room,JSON.stringify({tour:input.tour,host,step:0,notes:[],revision:0}));
    return reply({room,host},201);
  }
  if (!uuid.test(id || "")) return reply({error:"Unknown session."},404);
  const key="room/"+id;
  for (let attempt=0;attempt<4;attempt++) {
    const item=await bucket.get(key);
    if (!item) return reply({error:"Unknown session."},404);
    const {host,...state}=await item.json();
    if(request.method==="GET") return reply(state);
    if(request.method!=="POST") return reply({error:"Unsupported method."},405);
    if(input.action==="note" && state.notes.some(n=>n.id===input.id)) return reply(state);
    if(input.step!==state.step) return reply({error:"The facilitator changed events. Review the current prompt."},409);
    if(input.action==="advance") {
      if(request.headers.get("Authorization")!=="Bearer "+host) return reply({error:"Only the facilitator can advance."},403);
      if(state.step>=3) return reply({error:"Exercise completed."},409);
      state.step++;
    } else if(input.action==="note" && state.step<3 && uuid.test(input.id) && typeof input.text==="string" && input.text.trim() && input.text.length<=2000 && state.notes.length<150) {
      state.notes.push({id:input.id,step:state.step,text:input.text.trim()});
    } else return reply({error:"This observation could not be added."},400);
    state.revision++;
    const written=await bucket.put(key,JSON.stringify({...state,host}),{onlyIf:{etagMatches:item.etag}});
    if(written) return reply(state);
  }
  return reply({error:"Session busy. Try again."},409);
}
