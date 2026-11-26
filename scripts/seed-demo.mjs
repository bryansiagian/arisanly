import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

const base = new URL(process.env.ARISANLY_WEB_URL ?? "http://127.0.0.1:3000");
assert.ok(base.protocol === "https:" ||
  (base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)),
"Use HTTPS outside localhost.");

async function api(path, status, { actor, body, key } = {}) {
  const response = await fetch(new URL(`/api/v1${path}`, base), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: base.origin,
      ...(actor && { Cookie: actor.cookie }),
      ...(body !== undefined && { "Content-Type": "application/json" }),
      ...(key && { "Idempotency-Key": key }),
    },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, status, `${path} returned HTTP ${response.status}, expected ${status}`);
  return response;
}

const demoPassword = process.env.ARISANLY_DEMO_PASSWORD;
assert.ok(!demoPassword || Buffer.byteLength(demoPassword) >= 20, "Use a private demo password of at least 20 bytes.");
async function account(name) {
  const email = `demo-${randomUUID()}@example.com`;
  const password = demoPassword || randomBytes(32).toString("base64url");
  const { id } = await (await api("/auth/register", 201, { body: { name, email, password } })).json();
  const login = await api("/auth/login", 204, { body: { email, password } });
  if (base.protocol === "https:") {
    const cookies = login.headers.getSetCookie();
    assert.ok(cookies.length >= 2 && cookies.every((cookie) => /;\s*Secure(?:;|$)/i.test(cookie)), "HTTPS auth cookies must be Secure");
  }
  return { id, email, cookie: login.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]).join("; ") };
}

const owner = await account("Rani (Demo)");
const member = await account("Dimas (Demo)");

async function group(name, type) {
  const { id } = await (await api("/groups", 201, { actor: owner, body: { name, type } })).json();
  const path = `/groups/${id}`;
  const { code } = await (await api(path + "/invites", 201, { actor: owner, body: { maxUses: 1 } })).json();
  await api("/groups/join", 200, { actor: member, body: { code } });
  return path;
}

function post(path, body, actor = owner, money = false) {
  return api(path, 204, { actor, body, key: money ? randomUUID() : undefined });
}

const arisan = await group("Arisan Kelas (Data Demo)", "ARISAN");
const today = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date());
await post(arisan + "/start", { amount: 25000, startDate: today, frequency: "WEEKLY", orderMethod: "DRAW" });

async function latestRound() {
  const { rounds } = await (await api(arisan + "/rounds", 200, { actor: owner })).json();
  return rounds[0];
}

for (let number = 1; number <= 2; number++) {
  const round = await latestRound();
  assert.equal(round.number, number);
  const roundPath = arisan + `/rounds/${round.id}`;
  await post(roundPath + "/draw", {});
  for (const participant of [owner, member]) {
    const due = round.obligations.find((item) => item.memberId === participant.id);
    await post(arisan + `/obligations/${due.id}/claims`, { note: "Pembayaran simulasi" }, participant);
    const claimed = (await latestRound()).obligations.find((item) => item.id === due.id);
    await post(arisan + `/claims/${claimed.claimId}/confirm`, {}, owner, true);
  }
  await post(roundPath + "/payout", {}, owner, true);
  await post(roundPath + "/close", {});
}
const finalArisan = await (await api(arisan + "/rounds", 200, { actor: owner })).json();
assert.ok(finalArisan.cycle.closed);
assert.equal(finalArisan.fundBalance, "0");

const kas = await group("Kas Kelas (Data Demo)", "KAS");
await post(kas + "/income", { amount: 200000, category: "Saldo awal", note: "Pemasukan simulasi" }, owner, true);
await post(kas + "/expenses", { amount: 45000, category: "Perlengkapan", note: "Pengeluaran simulasi" }, owner, true);
await post(kas + "/kas/schedule", { amount: 15000, frequency: "MONTHLY", firstDue: today });
await post(kas + "/kas/periods", { number: 0 });
const { summary } = await (await api(kas + "/summary", 200, { actor: owner })).json();
assert.equal(summary.balance, "155000");
assert.equal(summary.dues.length, 2);
const { code } = await (await api(kas + "/share", 201, { actor: owner, body: {} })).json();
const publicURL = new URL(`/ringkasan/${code}`, base);
const page = await fetch(publicURL, { signal: AbortSignal.timeout(10000) });
assert.equal(page.status, 200);
assert.match(await page.text(), /155\.000/);

console.log("Synthetic demo created with two completed arisan rounds and one Kas group.");
console.log(`Public Kas summary (valid for seven days): ${publicURL}`);
if (demoPassword) console.log(`Private dashboard logins with your supplied password: ${owner.email}, ${member.email}`);
