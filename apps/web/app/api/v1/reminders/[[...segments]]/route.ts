import { error, forward, validateMutation } from "../../../../../lib/api-proxy";

type RouteContext = { params: Promise<{ segments?: string[] }> };

export async function GET(request: Request, { params }: RouteContext) {
  if ((await params).segments?.length) return error(404, "not_found");
  return forward(request, "/api/v1/reminders");
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const [id, action, ...rest] = (await params).segments ?? [];
  if (rest.length || action !== "read" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    return error(404, "not_found");
  }
  return validateMutation(request, false) ?? forward(request, `/api/v1/reminders/${id}/read`);
}
