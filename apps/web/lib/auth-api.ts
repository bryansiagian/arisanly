import "server-only";

export function authAPI(action: string, init: RequestInit) {
  const baseURL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8080";
  return fetch(new URL(`/api/v1/auth/${action}`, baseURL), {
    ...init,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
}
