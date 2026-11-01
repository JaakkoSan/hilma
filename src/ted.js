// TED (Tenders Electronic Daily), EU:n julkaisutoimisto: EU-kynnysarvot ylittävät hankintailmoitukset
// kaikista EU/ETA-maista. Hakurajapinta https://api.ted.europa.eu/v3/notices/search ei vaadi avainta
// (docs.ted.europa.eu/api). Ilmoitusten uudelleenkäyttö on vapaata myös kaupallisesti
// (TED legal notice, komission päätös 2011/833/EU); TED:n logoa ei käytetä.

import { HilmaError } from "./hilma.js";

const SEARCH = "https://api.ted.europa.eu/v3/notices/search";
const USER_AGENT = "hilma-mcp/1.1 (Claude-liitin; Cloudflare Worker)";

export class TedError extends HilmaError {}

function cacheApi() {
  try {
    return typeof caches !== "undefined" && caches.default ? caches.default : null;
  } catch {
    return null;
  }
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Expert query -haku. Palauttaa { total, notices }. */
export async function tedSearch(query, fields, { limit = 10, page = 1, ttl = 1800 } = {}) {
  const body = JSON.stringify({ query, fields, limit, page, paginationMode: "PAGE_NUMBER" });
  const cache = cacheApi();
  const key = new Request(`${SEARCH}?_q=${hash(body)}`);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit.json();
  }
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(SEARCH, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": USER_AGENT }, body });
    } catch (e) {
      last = new TedError(`TED-rajapintaan ei saatu yhteyttä: ${e?.message ?? e}`, 0);
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    if (res.ok) {
      const d = await res.json();
      const out = { total: d.totalNoticeCount ?? 0, notices: d.notices ?? [] };
      if (cache) await cache.put(key, new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${ttl}` } }));
      return out;
    }
    const text = await res.text().catch(() => "");
    if (res.status === 400) throw new TedError(`TED hylkäsi haun: ${text.slice(0, 300)}`, 400);
    last = new TedError(`TED vastasi ${res.status}`, res.status);
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
  }
  throw last;
}

/** Monikielisestä kentästä suomi, ruotsi, englanti tai ensimmäinen. */
export function ml(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.length ? ml(v[0]) : null;
  for (const l of ["fin", "swe", "eng", "mul"]) if (v[l] !== undefined) return Array.isArray(v[l]) ? v[l].join("; ") : v[l];
  const first = Object.values(v)[0];
  return Array.isArray(first) ? first.join("; ") : first ?? null;
}

export function mlList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  for (const l of ["fin", "swe", "eng", "mul"]) if (v[l] !== undefined) return Array.isArray(v[l]) ? v[l] : [v[l]];
  const first = Object.values(v)[0];
  return Array.isArray(first) ? first : [first];
}

export const tedWebUrl = (pub) => `https://ted.europa.eu/fi/notice/-/detail/${encodeURIComponent(pub)}`;

export const TYPE_GROUPS = {
  ilmoitus: ["cn-standard", "cn-social", "cn-desg", "pin-cfc-standard", "pin-cfc-social", "qu-sy"],
  paatos: ["can-standard", "can-social", "can-desg", "can-tran", "veat"],
  ennakko: ["pin-only", "pin-buyer", "pin-rtl", "pin-tran"],
  muutos: ["can-modif"],
};

export const TYPE_NAMES = {
  "cn-standard": "hankintailmoitus",
  "cn-social": "hankintailmoitus (sosiaali- ja muut erityiset palvelut)",
  "cn-desg": "suunnittelukilpailu",
  "pin-cfc-standard": "ennakkoilmoitus tarjouskilpailukutsuna",
  "pin-cfc-social": "ennakkoilmoitus tarjouskilpailukutsuna (sosiaalipalvelut)",
  "qu-sy": "kelpuuttamisjärjestelmä",
  "can-standard": "jälki-ilmoitus",
  "can-social": "jälki-ilmoitus (sosiaali- ja muut erityiset palvelut)",
  "can-desg": "suunnittelukilpailun tulokset",
  "can-tran": "jälki-ilmoitus (julkinen liikenne)",
  veat: "suorahankintaa koskeva avoimuusilmoitus",
  "pin-only": "ennakkoilmoitus",
  "pin-buyer": "ennakkoilmoitus (hankkijaprofiili)",
  "pin-rtl": "ennakkoilmoitus (määräajan lyhentäminen)",
  "pin-tran": "ennakkoilmoitus (julkinen liikenne)",
  "can-modif": "sopimusmuutos",
  corr: "korjausilmoitus",
  compl: "sopimuksen päättymisilmoitus",
  subco: "alihankintailmoitus",
};

export const COUNTRIES = {
  suomi: "FIN", ruotsi: "SWE", viro: "EST", norja: "NOR", tanska: "DNK", saksa: "DEU", latvia: "LVA", liettua: "LTU",
  puola: "POL", ranska: "FRA", alankomaat: "NLD", hollanti: "NLD", belgia: "BEL", itävalta: "AUT", espanja: "ESP",
  italia: "ITA", irlanti: "IRL", portugali: "PRT", tšekki: "CZE", tsekki: "CZE", slovakia: "SVK", unkari: "HUN",
  islanti: "ISL", luxemburg: "LUX", kreikka: "GRC", romania: "ROU", bulgaria: "BGR", kroatia: "HRV", slovenia: "SVN",
  kypros: "CYP", malta: "MLT",
};
