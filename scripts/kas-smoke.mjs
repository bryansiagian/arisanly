import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = new URL(process.env.ARISANLY_WEB_URL ?? "http://127.0.0.1:3000");
async function request(path, status, { cookie, body, key, method = body === undefined ? "GET" : "POST" } = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      Origin: base.origin,
      ...(body !== undefined && { "Content-Type": "application/json" }),
      ...(cookie && { Cookie: cookie }),
      ...(key && { "Idempotency-Key": key }),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (response.status !== status) assert.fail(`${path}: expected ${status}, got ${response.status}: ${await response.text()}`);
  return response;
}
async function account(name) {
  const email = `kas-${randomUUID()}@example.com`;
  const password = "Long Kas smoke test passphrase";
  await request("/api/v1/auth/register", 201, { body: { email, name, password } });
  const login = await request("/api/v1/auth/login", 204, { body: { email, password } });
  return login.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
}
const owner = await account("Pemilik privat");
const member = await account("Anggota privat");
const outsider = await account("Pihak luar");
const { id } = await (await request("/api/v1/groups", 201, {
  cookie: owner, body: { name: "Nama kelompok privat", type: "KAS" },
})).json();
const root = `/api/v1/groups/${id}`;
const { code } = await (await request(root + "/invites", 201, { cookie: owner, body: { maxUses: 1 } })).json();
await request("/api/v1/groups/join", 200, { cookie: member, body: { code } });
await request(root + "/summary", 404, { cookie: outsider });
const body = { amount: 15000, category: "=1+1", note: "Catatan privat" };
await request(root + "/income", 403, { cookie: member, body, key: randomUUID() });
await request(root + "/income", 400, { cookie: owner, body });
const key = randomUUID();
await Promise.all([1, 2].map(() => request(root + "/income", 204, { cookie: owner, body, key })));
await request(root + "/income", 409, { cookie: owner, body: { ...body, note: "Berbeda" }, key });
await request(root + "/expenses", 409, { cookie: owner, body: { ...body, amount: 17000 }, key: randomUUID() });
await request(root + "/expenses", 204, { cookie: owner, body: { ...body, amount: 2000 }, key: randomUUID() });

const schedule = { amount: 5000, frequency: "MONTHLY", firstDue: "2000-01-31" };
await request(root + "/kas/schedule", 204, { cookie: owner, body: schedule });
await Promise.all([1, 2].map(() => request(root + "/kas/periods", 204, { cookie: owner, body: { number: 0 } })));
const first = await (await request(root + "/summary", 200, { cookie: member })).json();
assert.equal(first.summary.schedule.nextDue, "2000-02-29");
assert.equal(first.summary.dues.length, 2);
assert.ok(first.summary.dues.every(({ status }) => status === "LATE"));
const due = first.summary.dues[0];
const payKey = randomUUID();
await request(root + `/kas/dues/${due.id}/pay`, 204, { cookie: owner, body: {}, key: payKey });
await request(root + `/kas/dues/${due.id}/pay`, 204, { cookie: owner, body: {}, key: payKey });
const { summary, rows } = await (await request(root + "/summary", 200, { cookie: member })).json();
assert.equal(summary.balance, "18000");
assert.equal(summary.income, "20000");
assert.equal(summary.expenses, "2000");
assert.equal(rows.filter(({ type }) => type === "INCOME").length, 1);
assert.ok(rows.some(({ type, amount, delta }) => type === "CHARGE" && amount === "5000" && delta === "0"));
const historic = await (await request(root + "/summary?month=2000-01", 200, { cookie: member })).json();
assert.equal(historic.rows.length, 0);
assert.ok(historic.summary.dues.some(({ status }) => status === "PAID"));
const csv = await request(root + "/export.csv", 200, { cookie: member });
assert.match(csv.headers.get("content-disposition"), /attachment/);
assert.match(await csv.text(), /'=1\+1/);
await request(root + "/export.csv", 404, { cookie: outsider });

const issue = () => request(root + "/share", 201, { cookie: owner, body: {} }).then((response) => response.json());
const share = await issue();
const report = "/ringkasan/" + share.code;
const publicPage = await (await request(report, 200)).text();
assert.match(publicPage.replaceAll("<!-- -->", ""), /Ringkasan kas/);
assert.doesNotMatch(publicPage, /Nama kelompok privat|Anggota privat|Catatan privat/);
const rotated = await issue();
await request(report, 404);
await request(root + "/share", 204, { cookie: owner, method: "DELETE" });
await request("/ringkasan/" + rotated.code, 404);
console.log("Kas and reporting smoke test passed");
