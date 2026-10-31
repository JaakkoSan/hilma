// Savutesti: kutsuu Workerin fetch-käsittelijää suoraan Nodessa oikeaa Hilmaa vasten.
// Ajo: HILMA_API_KEY=... node test/smoke.mjs   (Node 20+; avain avp-read-tilauksesta)

import worker from "../src/index.js";

const key = process.env.HILMA_API_KEY;
if (!key) {
  console.log("HILMA_API_KEY puuttuu: savutesti ohitetaan.");
  process.exit(0);
}
const SECRET = "smoke-test-path-0123456789";
const env = { HILMA_API_KEY: key, MCP_PATH_SECRET: SECRET };
let id = 0;

async function rpc(method, params, path = `/mcp/${SECRET}`) {
  const req = new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const res = await worker.fetch(req, env);
  return res.status === 200 ? res.json() : { status: res.status };
}

function check(cond, label) {
  console.log(`${cond ? "OK  " : "FAIL"} ${label}`);
  if (!cond) process.exitCode = 1;
}

check((await rpc("initialize", {}, "/mcp")).status === 404, "ilman salaista polkua ei vastata");
const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
check(init.result?.serverInfo?.name === "hilma", "initialize");
const list = await rpc("tools/list", {});
check(list.result?.tools?.length === 2, "tools/list (2 työkalua)");

const cases = [
  ["hae_hankintoja", { hakusana: "kotihoito", tyyppi: "paatos" }, (t) => t.includes("Jälki-ilmoitus") && t.includes("hankintailmoitukset.fi/fi/public")],
  ["hae_hankintoja", { maakunta: "Kymenlaakso", vain_avoimet: true, jarjestys: "maaraaika" }, (t) => t.includes("määräaika")],
  ["hae_hankintoja", { voittaja: "1926203-5", tyyppi: "paatos" }, (t) => t.includes("1926203-5")],
  ["hae_hankintoja", { cpv: "85000000", hankintayksikko: "3221311-5" }, (t) => t.includes("Kymenlaakson hyvinvointialue")],
  ["hae_hankintoja", { maakunta: "Atlantis" }, (t) => t.includes("Tuntematon maakunta")],
  ["hankinta", { ilmoitus: "2026-055216" }, (t) => t.includes("OSAT (4)") && t.includes("Arviointiperusteet") && t.includes("Voittajat")],
];
for (const [name, args, pred] of cases) {
  const t0 = Date.now();
  const r = await rpc("tools/call", { name, arguments: args });
  const text = r.result?.content?.map((c) => c.text).join("\n") ?? JSON.stringify(r);
  check(pred(text), `${name} ${JSON.stringify(args)} (${Date.now() - t0} ms)`);
  if (!pred(text)) console.log(text.slice(0, 1500), "\n------");
  await new Promise((res) => setTimeout(res, 1000));
}
