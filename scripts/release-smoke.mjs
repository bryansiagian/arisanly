import assert from "node:assert/strict";

assert.ok(process.env.ARISANLY_WEB_URL, "Set ARISANLY_WEB_URL to the deployment origin.");
const base = new URL(process.env.ARISANLY_WEB_URL);
assert.equal(base.protocol, "https:", "The deployment must use HTTPS.");
const get = (path) => fetch(new URL(path, base), {
  redirect: "manual", signal: AbortSignal.timeout(10000),
});

const landing = await get("/");
assert.equal(landing.status, 200);
assert.ok(landing.headers.get("strict-transport-security"), "Missing HSTS header.");
assert.match(await landing.text(), /Arisanly/);

const readiness = await get("/readyz");
assert.equal(readiness.status, 200);
assert.equal((await readiness.json()).status, "ok");

const dashboard = await get("/dasbor");
assert.ok([303, 307, 308].includes(dashboard.status), "Anonymous dashboard should redirect.");
assert.match(dashboard.headers.get("location") ?? "", /\/masuk(?:\?|$)/);
await dashboard.arrayBuffer();

const inbox = await get("/api/v1/reminders");
assert.equal(inbox.status, 401);
await inbox.arrayBuffer();
console.log("Public deployment smoke test passed.");
