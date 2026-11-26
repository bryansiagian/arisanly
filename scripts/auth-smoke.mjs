import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.ARISANLY_WEB_URL ?? "http://127.0.0.1:3000";
const email = `test-${randomUUID()}@example.com`;
const password = "A valid test passphrase";
const name = "Auth Smoke Test";

function request(path, init) {
  return fetch(new URL(path, base), {
    ...init, redirect: "manual", signal: AbortSignal.timeout(10000),
  });
}

function post(action, body = {}, cookie = "", origin = new URL(base).origin) {
  return request(`/api/v1/auth/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin },
    body: JSON.stringify(body),
  });
}

function authCookies(response) {
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  for (const cookie of cookies) {
    assert.match(cookie, /; HttpOnly/i);
    assert.match(cookie, /; SameSite=Strict/i);
  }
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

const anonymous = await request("/dasbor");
assert.equal(anonymous.status, 307);
assert.equal(anonymous.headers.get("location"), "/masuk?sesi=1");

assert.equal((await post("register", { name, email, password }, "", "https://example.com")).status, 403);
assert.equal((await post("register", { name, email, password })).status, 201);
assert.equal((await post("register", { name, email: email.toUpperCase(), password })).status, 409);
assert.equal((await post("login", { email, password: "An incorrect password" })).status, 401);

const login = await post("login", { email, password });
assert.equal(login.status, 204);
const initialCookies = authCookies(login);

const profile = await request("/api/v1/auth/me", { headers: { Cookie: initialCookies } });
assert.equal(profile.status, 200);
assert.equal((await profile.json()).email, email);

const dashboard = await request("/dasbor", { headers: { Cookie: initialCookies } });
assert.equal(dashboard.status, 200);
assert.match(await dashboard.text(), /Auth Smoke Test/);

function updateProfile(body, cookie = initialCookies, origin = new URL(base).origin) {
  return request("/api/v1/auth/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin },
    body: JSON.stringify(body),
  });
}

const newName = "Updated account";
const newEmail = `updated-${randomUUID()}@example.com`;
const occupiedEmail = `occupied-${randomUUID()}@example.com`;
assert.equal((await post("register", { email: occupiedEmail, name, password })).status, 201);
assert.equal((await updateProfile({ name: newName, email }, "")).status, 401);
assert.equal((await updateProfile({ name: newName, email }, initialCookies, "https://example.com")).status, 403);
assert.equal((await updateProfile({ name: newName, email })).status, 200);
assert.equal((await updateProfile({ name: newName, email: newEmail })).status, 400);
assert.equal((await updateProfile({ name: newName, email: newEmail, currentPassword: "An incorrect password" })).status, 403);
assert.equal((await updateProfile({ name: newName, email: occupiedEmail, currentPassword: password })).status, 409);
const updated = await updateProfile({ name: newName, email: newEmail, currentPassword: password });
assert.equal(updated.status, 200);
assert.equal((await updated.json()).email, newEmail);
assert.equal((await post("login", { email, password })).status, 401);
assert.equal((await post("login", { email: newEmail, password })).status, 204);
const profilePage = await request("/profil", { headers: { Cookie: initialCookies } });
assert.equal(profilePage.status, 200);
assert.match(await profilePage.text(), /Profil saya/);
assert.equal((await request("/profil")).status, 307);

const attempts = await Promise.all([
  post("refresh", {}, initialCookies), post("refresh", {}, initialCookies),
]);
assert.deepEqual(attempts.map((response) => response.status).sort(), [204, 401]);
const rotatedCookies = authCookies(attempts.find((response) => response.status === 204));
assert.notEqual(rotatedCookies, initialCookies);

assert.equal((await post("logout", {}, rotatedCookies)).status, 204);
assert.equal((await post("refresh", {}, rotatedCookies)).status, 401);
assert.equal((await request("/api/v1/auth/me", { headers: { Cookie: rotatedCookies } })).status, 401);
console.log("Auth smoke test passed");
