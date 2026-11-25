import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = new URL(process.env.ARISANLY_WEB_URL ?? "http://127.0.0.1:3000");
const email = `rate-${randomUUID()}@example.com`;
for (let attempt = 1; attempt <= 11; attempt++) {
  const response = await fetch(new URL("/api/v1/auth/login", base), {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base.origin },
    body: JSON.stringify({
      email: attempt % 2 === 0 ? email.toUpperCase() : email,
      password: "Incorrect test passphrase",
    }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, attempt <= 10 ? 401 : 429);
  if (attempt === 11) assert.ok(Number(response.headers.get("retry-after")) > 0);
  assert.ok(response.headers.get("x-request-id"));
  await response.arrayBuffer();
}
console.log("Authentication rate limit passed");
