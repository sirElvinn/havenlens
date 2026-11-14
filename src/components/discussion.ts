import type { Brief } from "./Briefing";

export function scenario(title:string, brief?:Brief, coverage?:string) {
  return [
    {title:"The initial report", report:`In this fictional exercise, a caller reports a smell of smoke at ${title}. Timing and location are uncertain.`, prompt:`Look around ${title}. Record one visible feature and one claim that comes only from the caller.`},
    {title:"Compare the accounts", report:"A second caller remembers haze earlier in the day. The reports may describe different times or places.", prompt:coverage ? `Capture note: ${coverage} Which part of the second account falls outside that evidence?` : "Which parts of these accounts could you compare with the capture? What remains unknown?"},
    {title:"The handoff", report:"A colleague joins the discussion and asks for a short briefing.", prompt:(brief?.question ?? "Which part of the captured space did your team review?")+" Include one reported detail and one unresolved question."}
  ];
}
