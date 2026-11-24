import "server-only";

export function internalAPI(path: string, init: RequestInit) {
  const baseURL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8080";
  return fetch(new URL(path, baseURL), {
    ...init,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
}

export function authAPI(action: string, init: RequestInit) {
  return internalAPI(`/api/v1/auth/${action}`, init);
}
