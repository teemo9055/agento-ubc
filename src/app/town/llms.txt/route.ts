import { llmsTxt, originOf } from "@/server/town/format";

export const dynamic = "force-dynamic";

/** The town for language models: every building, its URLs and MCP tools, and every Library article (llms.txt style). */
export async function GET(req: Request) {
  return new Response(llmsTxt(originOf(req)), { headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" } });
}
