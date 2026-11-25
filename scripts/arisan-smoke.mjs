import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = new URL(process.env.ARISANLY_WEB_URL ?? "http://127.0.0.1:3000");
const password = "Arisan test passphrase";

async function request(path, actor, payload, key) {
  return fetch(new URL(`/api/v1${path}`, base), {
    method: payload === undefined ? "GET" : "POST",
    headers: {
      Cookie: actor?.cookie ?? "", Origin: base.origin,
      ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
}

async function expect(code, result, label) {
  const response = await result;
  if (response.status !== code) assert.fail(`${label}: expected ${code}, got ${response.status}: ${await response.text()}`);
  return response;
}

async function account(name) {
  const email = `arisan-${randomUUID()}@example.com`;
  const created = await expect(201, request("/auth/register", null, { name, email, password }), "register");
  const { id } = await created.json();
  const loggedIn = await expect(204, request("/auth/login", null, { email, password }), "login");
  return { id, cookie: loggedIn.headers.getSetCookie().map((v) => v.split(";", 1)[0]).join("; ") };
}

const owner = await account("Pemilik");
const payer = await account("Anggota");
const outsider = await account("Di luar kelompok");
const created = await expect(201, request("/groups", owner, { name: "Arisan uji", type: "ARISAN" }), "create group");
const { id } = await created.json();
const group = `/groups/${id}`;
const issue = await expect(201, request(group + "/invites", owner, { maxUses: 1 }), "invite");
await expect(200, request("/groups/join", payer, { code: (await issue.json()).code }), "join");
await expect(404, request(group + "/audit", outsider), "private audit");
const start = { amount: 12500, startDate: "2027-01-31", frequency: "MONTHLY", orderMethod: "DRAW" };
await expect(403, request(group + "/start", payer, start), "member cannot start");
await expect(204, request(group + "/start", owner, start), "start cycle");
await expect(409, request(group + "/start", owner, start), "active cycle uniqueness");
await expect(409, fetch(new URL(`/api/v1${group}/members/${payer.id}`, base), {
  method: "DELETE", headers: { Cookie: payer.cookie, Origin: base.origin },
}), "active participant cannot leave");

async function rounds() {
  return (await expect(200, request(group + "/rounds", payer), "read rounds")).json();
}

async function playRound(expectedDate, rejectFirst) {
  const { rounds: [round] } = await rounds();
  assert.equal(round.status, "OPEN");
  assert.equal(round.dueDate, expectedDate);
  assert.equal(round.obligations.length, 2);
  assert.ok(round.obligations.every((item) => item.amount === "12500"));
  const roundPath = group + `/rounds/${round.id}`;
  await expect(403, request(roundPath + "/draw", payer, {}), "member cannot draw");
  await expect(204, request(roundPath + "/draw", owner, {}), "draw");
  await expect(409, request(roundPath + "/draw", owner, {}), "draw once");
  await expect(409, request(roundPath + "/payout", owner, {}, randomUUID()), "uncollected payout");

  for (const actor of [owner, payer]) {
    let { rounds: [current] } = await rounds();
    let due = current.obligations.find(({ memberId }) => memberId === actor.id);
    const claimPath = group + `/obligations/${due.id}/claims`;
    const other = actor === owner ? payer : owner;
    await expect(403, request(claimPath, other, {}), "cannot claim another person's obligation");
    await expect(204, request(claimPath, actor, { note: "Sudah dibayar di luar aplikasi" }), "claim");
    await expect(409, request(claimPath, actor, {}), "duplicate claim");
    ({ rounds: [current] } = await rounds());
    due = current.obligations.find(({ memberId }) => memberId === actor.id);
    if (rejectFirst && actor === payer) {
      await expect(204, request(group + `/claims/${due.claimId}/reject`, owner, {}), "reject");
      await expect(204, request(claimPath, actor, {}), "resubmit");
      ({ rounds: [current] } = await rounds());
      due = current.obligations.find(({ memberId }) => memberId === actor.id);
    }
    const confirmPath = group + `/claims/${due.claimId}/confirm`;
    const key = randomUUID();
    await expect(403, request(confirmPath, payer, {}, key), "member cannot confirm");
    await Promise.all([
      expect(204, request(confirmPath, owner, {}, key), "confirm"),
      expect(204, request(confirmPath, owner, {}, key), "idempotent confirmation"),
    ]);
    await expect(409, request(confirmPath, owner, {}, randomUUID()), "duplicate payment with different key");
  }
  assert.equal((await rounds()).rounds[0].status, "COLLECTED");
  assert.equal((await rounds()).fundBalance, "25000");
  const key = randomUUID();
  await expect(204, request(roundPath + "/payout", owner, {}, key), "payout");
  await expect(204, request(roundPath + "/payout", owner, {}, key), "idempotent payout");
  await expect(409, request(roundPath + "/payout", owner, {}, randomUUID()), "second payout");
  await expect(204, request(roundPath + "/close", owner, {}), "close round");
}

await playRound("2027-01-31", true);
await playRound("2027-02-28", false);
const completed = await rounds();
assert.equal(completed.cycle.closed, true);
assert.equal(completed.fundBalance, "0");
assert.equal(new Set(completed.rounds.map(({ recipientId }) => recipientId)).size, 2);
const audit = await (await expect(200, request(group + "/audit", payer), "member can read audit")).json();
assert.deepEqual(audit.filter(({ action }) => action === "ROUND_DRAWN").map(({ details }) => details.candidates.length), [1, 2]);
assert.equal(audit.filter(({ action }) => action === "CLAIM_CONFIRMED").length, 4);
assert.equal(audit.filter(({ action }) => action === "ROUND_PAID_OUT").length, 2);
await expect(204, request(group + "/start", owner, {
  ...start, orderMethod: "FIXED", order: [payer.id, owner.id],
}), "start fixed order cycle");
assert.equal((await rounds()).rounds[0].recipientId, payer.id);
console.log("Arisan smoke test passed");
