import { internalAPI } from "./auth-api";

export function error(status: number, code: string) {
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

export async function forward(request: Request, path: string, body?: string) {
  const headers = new Headers();
  for (const name of ["cookie", "authorization", "content-type", "idempotency-key"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const upstream = await internalAPI(path, { method: request.method, headers, body });
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

export function validateMutation(request: Request, json: boolean) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((fetchSite && fetchSite !== "same-origin") ||
      (origin && origin !== `https://${host}` && origin !== `http://${host}`)) {
    return error(403, "invalid_origin");
  }
  if (!json) return;
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();
  if (contentType?.toLowerCase() !== "application/json") {
    return error(415, "invalid_content_type");
  }
}

export async function forwardJSON(request: Request, path: string) {
  try {
    const body = await boundedBody(request);
    if (body === null) return error(413, "body_too_large");
    return forward(request, path, body);
  } catch {
    return error(400, "invalid_input");
  }
}
