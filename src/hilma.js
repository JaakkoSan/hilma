// Hilman (hankintailmoitukset.fi) lukurajapinnan asiakas.
//
// Haku: POST https://api.hankintailmoitukset.fi/avp/eformnotices/docs/search
//   (Azure AI Search -indeksi eformnotices-v2: search, filter, orderby, select, top, skip, count)
// Ilmoitus: GET https://api.hankintailmoitukset.fi/avp-eforms/external-read/v1/notice/{noticeId}
//   (JSON, jossa eForm-kentässä Base64-koodattu eForms-XML)
// Molemmat vaativat avp-read-tilauksen avaimen (Ocp-Apim-Subscription-Key).
//
// Käyttöehdot (hilma-lukurajapinta-kayttoehdot.pdf): rajapinta on tarkoitettu vain
// rekisteröityneen käyttäjän käyttöön, eikä käyttöoikeutta tai avainta saa luovuttaa
// kolmannelle. Siksi liitin toimii vain salaisella polulla (ks. index.js).

const SEARCH_URL = "https://api.hankintailmoitukset.fi/avp/eformnotices/docs/search";
const NOTICE_URL = "https://api.hankintailmoitukset.fi/avp-eforms/external-read/v1/notice/";
const USER_AGENT = "hilma-mcp/1.0 (Claude-liitin; Cloudflare Worker)";
const MAX_ATTEMPTS = 3;

export class HilmaError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function cacheApi() {
  try {
    return typeof caches !== "undefined" && caches.default ? caches.default : null;
  } catch {
    return null;
  }
}

// djb2: välimuistiavain hakupyynnön rungosta.
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, init, cacheKey, ttl, key) {
  if (!key) throw new HilmaError("Hilman API-avain puuttuu (salaisuus HILMA_API_KEY).", 0);
  const cache = cacheApi();
  const ck = new Request(cacheKey);
  if (cache) {
    const hit = await cache.match(ck);
    if (hit) return hit.status === 404 ? null : await hit.text();
  }
  let last;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(url, { ...init, headers: { ...init.headers, "Ocp-Apim-Subscription-Key": key, "User-Agent": USER_AGENT } });
    } catch (e) {
      last = new HilmaError(`Hilmaan ei saatu yhteyttä: ${e?.message ?? e}`, 0);
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (res.status === 404) {
      if (cache) await cache.put(ck, new Response("", { status: 404, headers: { "Cache-Control": "max-age=600" } }));
      return null;
    }
    if (res.ok) {
      const text = await res.text();
      if (cache && ttl > 0) await cache.put(ck, new Response(text, { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${ttl}` } }));
      return text;
    }
    if (res.status === 401 || res.status === 403) throw new HilmaError("Hilma hylkäsi API-avaimen (401/403). Tarkista salaisuus HILMA_API_KEY ja avp-read-tilaus.", res.status);
    // 429: rajapinnan nopeusrajoitus; odotetaan sen pyytämä aika (enintään 5 s).
    const wait = res.status === 429 ? Math.min(5000, 1000 * (Number(res.headers.get("Retry-After")) || 1)) : 500 * 2 ** attempt;
    last = new HilmaError(res.status === 429 ? "Hilman rajapinnan nopeusrajoitus ylittyi" : `Hilma vastasi ${res.status}`, res.status);
    if (res.status !== 429 && res.status < 500) break;
    await sleep(wait);
  }
  throw last;
}

/** Haku indeksistä. Palauttaa { count, value }. */
export async function search(body, key, ttl = 1800) {
  const payload = JSON.stringify(body);
  const text = await request(
    SEARCH_URL,
    { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: payload },
    `${SEARCH_URL}?_body=${hash(payload)}&_n=${payload.length}`,
    ttl,
    key,
  );
  const d = text ? JSON.parse(text) : { value: [] };
  return { count: d["@odata.count"] ?? d.value?.length ?? 0, value: d.value ?? [] };
}

/** eForms-XML ilmoitukselle (noticeId). null, jos ei löydy tai ilmoitus ei ole eForms-muotoinen. */
export async function noticeXml(noticeId, key, ttl = 6 * 3600) {
  const url = NOTICE_URL + encodeURIComponent(noticeId);
  const text = await request(url, { method: "GET", headers: { Accept: "application/json" } }, url, ttl, key);
  if (!text) return null;
  const d = JSON.parse(text);
  if (!d.eForm) return null;
  const bin = atob(d.eForm);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Ilmoituksen sivu Hilmassa (sama muoto kuin Hilman oma käyttöliittymä käyttää). */
export function noticeWebUrl(n) {
  return n.isEForms
    ? `https://www.hankintailmoitukset.fi/fi/public/procedure/${n.procedureId}/enotice/${n.noticeId}`
    : `https://www.hankintailmoitukset.fi/fi/public/procurement/${n.oldProcurementProjectId}/notice/${n.noticeId}/overview`;
}
