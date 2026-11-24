import { authAPI } from "../../../../../lib/auth-api";

type RouteContext = { params: Promise<{ action: string }> };
const postActions = new Set(["register", "login", "refresh", "logout"]);

function error(status: number, code: string) {
  return Response.json({ error: code }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function boundedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return undefined;

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      bytes += value.byteLength;
      if (bytes > 4096) {
        void reader.cancel().catch(() => {});
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

async function forward(request: Request, action: string, body?: string) {
  const headers = new Headers();
  for (const name of ["cookie", "authorization", "content-type"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const upstream = await authAPI(action, { method: request.method, headers, body });
    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    for (const name of ["content-type", "retry-after"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    for (const cookie of upstream.headers.getSetCookie()) {
      responseHeaders.append("Set-Cookie", cookie);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return error(502, "service_unavailable");
  }
}

export async function GET(request: Request, { params }: RouteContext) {
  const { action } = await params;
  if (action !== "me") return error(404, "not_found");
  return forward(request, action);
}

export async function POST(request: Request, { params }: RouteContext) {
  const { action } = await params;
  if (!postActions.has(action)) return error(404, "not_found");

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((fetchSite && fetchSite !== "same-origin") ||
      (origin && origin !== `https://${host}` && origin !== `http://${host}`)) {
    return error(403, "invalid_origin");
  }
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();
  if (contentType?.toLowerCase() !== "application/json") {
    return error(415, "invalid_content_type");
  }
  if (action === "login" || action === "register") {
    try {
      const body = await boundedBody(request);
      if (body === null) return error(413, "body_too_large");
      return forward(request, action, body);
    } catch {
      return error(400, "invalid_input");
    }
  }
  return forward(request, action);
}
