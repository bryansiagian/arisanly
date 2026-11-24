import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = new URL(process.env.ARISANLY_WEB_URL ?? "http://127.0.0.1:3000");
const password = "A valid test passphrase";

function request(path, { method = "GET", body, cookie = "", origin = base.origin } = {}) {
  const headers = { Cookie: cookie, Origin: origin };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(new URL(`/api/v1/${path}`, base), {
    method, headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
}

async function account(name) {
  const email = `smoke-${randomUUID()}@example.com`;
  const post = (action, body) => request(`auth/${action}`, { method: "POST", body });
  const registration = await post("register", { email, name, password });
  assert.equal(registration.status, 201);
  const { id } = await registration.json();
  const login = await post("login", { email, password });
  assert.equal(login.status, 204);
  const cookie = login.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  return { id, cookie };
}

const owner = await account("Pemilik");
const first = await account("Anggota satu");
const second = await account("Anggota dua");
const groups = (suffix, actor, method = "GET", body) =>
  request(`groups${suffix}`, { cookie: actor.cookie, method, body });

assert.equal((await request("groups")).status, 401);
const create = await groups("", owner, "POST", { name: "Arisan kelas", type: "ARISAN" });
assert.equal(create.status, 201);
const group = await create.json();
const path = `/${group.id}`;
assert.equal(group.role, "OWNER");
assert.equal((await groups(path, first)).status, 404);
assert.equal((await groups(path + "/members", first)).status, 404);
assert.equal((await groups(path, owner, "PATCH", { name: "Arisan kelas baru" })).status, 204);
assert.equal((await (await groups(path, owner)).json()).name, "Arisan kelas baru");
assert.equal((await request(`groups${path}`, {
  method: "PATCH", cookie: owner.cookie, origin: "https://example.com", body: { name: "Lain" },
})).status, 403);

const issued = await groups(path + "/invites", owner, "POST", { maxUses: 1 });
assert.equal(issued.status, 201);
const invite = await issued.json();
const join = (actor) => groups("/join", actor, "POST", { code: invite.code });
const attempts = await Promise.all([join(first), join(second)]);
assert.deepEqual(attempts.map(({ status }) => status).sort(), [200, 410]);
const winner = attempts[0].ok ? first : second;
const loser = attempts[0].ok ? second : first;

assert.equal((await join(winner)).status, 200);
const invitations = await (await groups(path + "/invites", owner)).json();
assert.equal(invitations[0].usedCount, 1);
assert.equal(invitations[0].code, undefined);
assert.equal((await groups(path, loser)).status, 404);
assert.equal((await groups(path + "/invites", winner)).status, 403);
assert.equal((await groups(path + "/invites", winner, "POST", { maxUses: 1 })).ok, false);
const memberPath = `${path}/members/${winner.id}`;
assert.equal((await groups(memberPath, winner, "PATCH", { role: "TREASURER" })).status, 403);
assert.equal((await groups(memberPath, owner, "PATCH", { role: "TREASURER" })).status, 204);
const members = await (await groups(path + "/members", winner)).json();
assert.equal(members.find(({ id }) => id === winner.id)?.role, "TREASURER");
assert.equal((await groups(`${path}/members/${owner.id}`, owner, "DELETE")).ok, false);
assert.equal((await groups(memberPath, winner, "DELETE")).status, 204);
assert.equal((await groups(path, winner)).status, 404);

console.log("Groups smoke test passed");
