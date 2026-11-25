import { error, forward, forwardJSON, validateMutation } from "../../../../../lib/api-proxy";

const groupID = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const routes: Record<string, RegExp> = {
  GET: new RegExp(`^(?:|${groupID}(?:/(?:members|invites|rounds|audit|summary|ledger|export\\.csv))?)$`, "i"),
  POST: new RegExp(`^(?:|join|${groupID}/(?:invites|start|income|expenses|share|kas/(?:periods|schedule|dues/${groupID}/pay)|rounds/${groupID}/(?:draw|payout|close)|obligations/${groupID}/claims|claims/${groupID}/(?:confirm|reject)))$`, "i"),
  PATCH: new RegExp(`^${groupID}(?:/members/${groupID})?$`, "i"),
  DELETE: new RegExp(`^${groupID}/(?:members/${groupID}|share)$`, "i"),
};

async function handle(request: Request, { params }: {
  params: Promise<{ segments?: string[] }>;
}) {
  const segments = (await params).segments ?? [];
  if (segments.some((segment) => segment.includes("/"))) return error(404, "not_found");
  const suffix = segments.join("/");
  if (!routes[request.method].test(suffix)) return error(404, "not_found");
  const path = suffix ? `/api/v1/groups/${suffix}` : "/api/v1/groups";
  if (request.method === "GET") return forward(request, path + new URL(request.url).search);
  const json = request.method !== "DELETE";
  const invalid = validateMutation(request, json);
  if (invalid) return invalid;
  return json ? forwardJSON(request, path) : forward(request, path);
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
