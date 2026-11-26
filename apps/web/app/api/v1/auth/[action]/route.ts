import { error, forward, forwardJSON, validateMutation } from "../../../../../lib/api-proxy";

type RouteContext = { params: Promise<{ action: string }> };
const postActions = new Set(["register", "login", "refresh", "logout"]);

export async function GET(request: Request, { params }: RouteContext) {
  const { action } = await params;
  if (action !== "me") return error(404, "not_found");
  return forward(request, "/api/v1/auth/me");
}

export async function POST(request: Request, { params }: RouteContext) {
  const { action } = await params;
  if (!postActions.has(action)) return error(404, "not_found");
  const invalid = validateMutation(request, true);
  if (invalid) return invalid;
  const path = `/api/v1/auth/${action}`;
  if (action === "login" || action === "register") return forwardJSON(request, path);
  return forward(request, path);
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { action } = await params;
  if (action !== "me") return error(404, "not_found");
  return validateMutation(request, true) ?? forwardJSON(request, "/api/v1/auth/me");
}
