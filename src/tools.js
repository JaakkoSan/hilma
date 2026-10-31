// MCP-työkalut: julkiset hankinnat Hilmasta (hankintailmoitukset.fi).

import { search, noticeXml, noticeWebUrl, HilmaError } from "./hilma.js";
import { parseLots } from "./eforms.js";

const MAX_OUTPUT = 50_000;
const PAGE = 10;

export const TOOLS = [
  {
    name: "hae_hankintoja",
    description:
      "Hakee julkisia hankintoja Hilmasta (hankintailmoitukset.fi): hankintailmoitukset (tarjouspyynnöt), jälki-ilmoitukset (hankintapäätökset ja voittajat), ennakkoilmoitukset ja hankintasuunnitelmat. Ehdot: hakusana, ilmoituksen tyyppi, hankintayksikkö, voittaja, CPV-koodi, maakunta, avoinna olevat ja julkaisupäivä. Palauttaa ilmoitusnumerot, otsikot, hankintayksiköt, määräajat, arvot ja voittajat.",
    inputSchema: {
      type: "object",
      properties: {
        hakusana: { type: "string", description: "Sanat otsikosta tai kuvauksesta, esim. \"kotihoito\" tai \"siivouspalvelut\". Kaikkien sanojen on löydyttävä." },
        tyyppi: {
          type: "string",
          enum: ["ilmoitus", "paatos", "ennakko", "suunnitelma", "muutos"],
          description: "ilmoitus = hankintailmoitus (tarjouspyyntö), paatos = jälki-ilmoitus (voittajat), ennakko = ennakkoilmoitus, suunnitelma = hankintasuunnitelma, muutos = sopimusmuutos. Oletus: kaikki.",
        },
        hankintayksikko: { type: "string", description: "Hankintayksikön nimi (esim. \"Kymenlaakson hyvinvointialue\") tai Y-tunnus (esim. \"3221331-8\")." },
        voittaja: { type: "string", description: "Voittaneen yrityksen nimi tai Y-tunnus (jälki-ilmoituksista)." },
        cpv: { type: "string", description: "CPV-koodi tai sen alku, esim. \"85000000\" (terveys- ja sosiaalipalvelut) tai \"853\"." },
        maakunta: { type: "string", description: "Maakunta, jossa hankinta toteutetaan tai jossa hankintayksikkö on, esim. \"Kymenlaakso\"." },
        vain_avoimet: { type: "boolean", description: "Vain ilmoitukset, joiden tarjousten tai osallistumishakemusten määräaika ei ole vielä mennyt." },
        alkaen: { type: "string", description: "Julkaistu aikaisintaan (VVVV-KK-PP)." },
        paattyen: { type: "string", description: "Julkaistu viimeistään (VVVV-KK-PP)." },
        jarjestys: { type: "string", enum: ["uusin", "maaraaika"], description: "uusin = julkaisupäivä, uusin ensin (oletus); maaraaika = lähin määräaika ensin." },
        sivu: { type: "integer", description: "Tulossivu, 1 = ensimmäinen. Sivulla 10 tulosta." },
      },
    },
  },
  {
    name: "hankinta",
    description:
      "Palauttaa yhden Hilma-ilmoituksen tiedot: hankintayksikkö, kuvaus, CPV-koodit, alue, menettely, arvo, määräaika, osat (osien kuvaukset, arviointiperusteet painoineen, sopimuskausi ja optiot), jälki-ilmoituksissa voittajat ja tarjousten määrä sekä linkit tarjousasiakirjoihin ja Hilmaan.",
    inputSchema: {
      type: "object",
      properties: {
        ilmoitus: { type: "string", description: "Ilmoitusnumero (esim. \"2026-060704\") tai ilmoituksen tunniste hakutuloksesta (esim. \"60704\")." },
      },
      required: ["ilmoitus"],
    },
  },
];

const TITLES = { hae_hankintoja: "Hae hankintoja", hankinta: "Hankintailmoitus" };
for (const t of TOOLS) {
  t.annotations = { title: TITLES[t.name], readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
}

class UserError extends Error {}

// ---------- Koodit ja muotoilu ----------

const MAIN_TYPES = {
  ilmoitus: "ContractNotices",
  paatos: "ContractAwardNotices",
  ennakko: "PriorInformationNotices",
  suunnitelma: "ProcurementPlan",
  muutos: "Modification",
};
const MAIN_TYPE_NAMES = {
  ContractNotices: "Hankintailmoitus",
  ContractAwardNotices: "Jälki-ilmoitus",
  PriorInformationNotices: "Ennakkoilmoitus",
  ProcurementPlan: "Hankintasuunnitelma",
  Modification: "Sopimusmuutos",
  NationalNotices: "Kansallinen ilmoitus",
};
const PROCEDURES = {
  open: "avoin menettely",
  restricted: "rajoitettu menettely",
  "neg-w-call": "neuvottelumenettely",
  "neg-wo-call": "suorahankinta (neuvottelumenettely ilman ilmoitusta)",
  "comp-dial": "kilpailullinen neuvottelumenettely",
  innovation: "innovaatiokumppanuus",
  "oth-single": "muu yksivaiheinen menettely",
  "oth-mult": "muu monivaiheinen menettely",
  "comp-tend": "kilpailullinen menettely",
};
const PROC_TYPES = { services: "palvelut", supplies: "tavarat", works: "rakennusurakka" };

// Maakunnat ja NUTS 3 -koodit (Tilastokeskus, NUTS 2021 ja NUTS 2024/2026, luettu 31.10.2026).
// Hilman ilmoituksissa esiintyy molempien versioiden koodeja.
const REGIONS = {
  "helsinki-uusimaa": ["FI1B1"],
  uusimaa: ["FI1B1"],
  "varsinais-suomi": ["FI1C1"],
  satakunta: ["FI196"],
  "kanta-häme": ["FI1C2"],
  pirkanmaa: ["FI197", "FI19B"],
  "päijät-häme": ["FI1C3", "FI1C6"],
  kymenlaakso: ["FI1C4", "FI1C7"],
  "etelä-karjala": ["FI1C5"],
  "etelä-savo": ["FI1D1", "FI1DA"],
  "pohjois-savo": ["FI1D2", "FI1DB"],
  "pohjois-karjala": ["FI1D3", "FI1DC"],
  "keski-suomi": ["FI193", "FI198"],
  "etelä-pohjanmaa": ["FI194", "FI199"],
  pohjanmaa: ["FI195", "FI19A"],
  "keski-pohjanmaa": ["FI1D5"],
  "pohjois-pohjanmaa": ["FI1D9"],
  kainuu: ["FI1D8"],
  lappi: ["FI1D7"],
  ahvenanmaa: ["FI200"],
  åland: ["FI200"],
};
const NUTS_NAMES = {};
for (const [name, codes] of Object.entries(REGIONS)) {
  if (name === "uusimaa" || name === "åland") continue;
  for (const c of codes) NUTS_NAMES[c] = name[0].toUpperCase() + name.slice(1).replace(/-([a-zåäö])/g, (m, c2) => "-" + c2.toUpperCase());
}
NUTS_NAMES.FI1B1 = "Helsinki-Uusimaa";
NUTS_NAMES.FI = "koko Suomi";
NUTS_NAMES.FI1 = "Manner-Suomi";

const regionName = (codes) => {
  const names = [...new Set(String(codes ?? "").split(/\s+/).filter(Boolean).map((c) => NUTS_NAMES[c] ?? c))];
  return names.join(", ");
};

// Tuhaterotin ilman Intl.NumberFormatia (ICU:n alustus on kylmänä hidas).
const fmtNum = (n) => {
  const [i, d] = String(Math.round(n * 100) / 100).split(".");
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0") + (d ? "," + d.padEnd(2, "0") : "");
};
const money = (amount, cur) => (amount ? `${fmtNum(amount)} ${cur || "EUR"}` : null);

// Päivämäärät Suomen aikaan (UTC+2/UTC+3; kesäaika EU:n sääntöjen mukaan).
function fiTime(iso, withTime = true) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const y = d.getUTCFullYear();
  const lastSunday = (m) => {
    const t = new Date(Date.UTC(y, m + 1, 0, 1));
    t.setUTCDate(t.getUTCDate() - t.getUTCDay());
    return t;
  };
  const dst = d >= lastSunday(2) && d < lastSunday(9);
  const l = new Date(d.getTime() + (dst ? 3 : 2) * 3600_000);
  const date = `${l.getUTCDate()}.${l.getUTCMonth() + 1}.${l.getUTCFullYear()}`;
  if (!withTime) return date;
  const hh = String(l.getUTCHours()).padStart(2, "0");
  const mm = String(l.getUTCMinutes()).padStart(2, "0");
  return `${date} klo ${hh}.${mm}`;
}

const pick = (n, base) => n[`${base}Fi`] || n[`${base}En`] || n[`${base}Sv`] || n[`${base}Other`] || "";
// Otsikko ilman toistuvaa tyyppimerkintää ("Jälki-ilmoitus: Jälki-ilmoitus: …").
const titleOf = (n) => pick(n, "title").replace(/^(Jälki-ilmoitus|Efterhandsannons)\s*:\s*/i, "").trim();
const winners = (s) =>
  String(s ?? "")
    .split("//")
    .map((x) => x.replace(/\/+$/, "").trim())
    .filter(Boolean);

function clip(text) {
  if (text.length <= MAX_OUTPUT) return text;
  return text.slice(0, MAX_OUTPUT) + "\n\n[Vastaus katkaistu 50 000 merkkiin.]";
}

const esc = (s) => String(s).replace(/'/g, "''");
// Azure AI Search -kyselykielen erikoismerkit lainataan, jotta käyttäjän teksti ei muutu operaattoriksi.
const quoteTerm = (s) => `"${String(s).replace(/["\\]/g, " ").trim()}"`;

function asDate(v, what) {
  const m = String(v ?? "").trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) || String(v ?? "").trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) throw new UserError(`Anna ${what} muodossa VVVV-KK-PP, esim. 2026-01-31.`);
  const [y, mo, d] = m[1].length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// ---------- Haku ----------

const LIST_FIELDS =
  "id,noticeId,noticeNumber,procedureId,oldProcurementProjectId,isEForms,mainType,titleFi,titleSv,titleEn,titleOther,organisationNameFi,organisationNameSv,organisationNameEn,organisationNameOther,organisationNationalRegistrationNumber,datePublished,deadline,expirationDate,estimatedValue,currency,noticeResultTotalAmount,noticeResultTotalAmountCurrency,overallMaximumFrameworkContractsAmount,overallMaximumFrameworkContractsCurrency,cpvCodes,nutsCodes,procurementTypeCode,procedureType,winnerOrganisations,isCancelled,isCorrigendum,includesFrameworkAgreement,isNationalProcurement";

async function haeHankintoja(args, env) {
  const filters = [];
  const words = String(args.hakusana ?? "").trim();
  if (args.tyyppi) {
    const t = MAIN_TYPES[args.tyyppi];
    if (!t) throw new UserError("tyyppi: ilmoitus, paatos, ennakko, suunnitelma tai muutos.");
    filters.push(`mainType eq '${t}'`);
  }
  const buyer = String(args.hankintayksikko ?? "").trim();
  if (buyer) {
    if (/^\d{7}-\d$/.test(buyer)) filters.push(`organisationNationalRegistrationNumber eq '${buyer}'`);
    else filters.push(`search.ismatch('${esc(quoteTerm(buyer))}', 'organisationNameFi,organisationNameSv,organisationNameEn', 'simple', 'all')`);
  }
  const winner = String(args.voittaja ?? "").trim();
  if (winner) filters.push(`search.ismatch('${esc(quoteTerm(winner))}', 'winnerOrganisations', 'simple', 'all')`);
  const cpv = String(args.cpv ?? "").replace(/-\d$/, "").trim();
  if (cpv) {
    if (!/^\d{2,8}$/.test(cpv)) throw new UserError('Anna CPV-koodi numeroina, esim. "85000000" tai "853".');
    const prefix = cpv.replace(/0+$/, "") || cpv.slice(0, 2);
    filters.push(`search.ismatch('${prefix.length >= 8 ? prefix : prefix + "*"}', 'cpvCodes', 'simple', 'any')`);
  }
  const region = String(args.maakunta ?? "").trim().toLowerCase().replace(/n maakunta$/, "").replace(/\s+/g, "-");
  if (region) {
    const codes = REGIONS[region] ?? (/^fi[0-9a-z]{3}$/i.test(region) ? [region.toUpperCase()] : null);
    if (!codes) throw new UserError(`Tuntematon maakunta "${args.maakunta}". Esim. Kymenlaakso, Uusimaa, Pirkanmaa, Pohjois-Pohjanmaa.`);
    filters.push(`search.ismatch('${codes.join("|")}', 'nutsCodes,organisationNutsCode', 'simple', 'any')`);
  }
  if (args.vain_avoimet) filters.push(`deadline ge ${new Date().toISOString()} and isCancelled eq false`);
  if (args.alkaen) filters.push(`datePublished ge ${asDate(args.alkaen, "alkaen")}T00:00:00Z`);
  if (args.paattyen) {
    const d = new Date(`${asDate(args.paattyen, "paattyen")}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    filters.push(`datePublished lt ${d.toISOString()}`);
  }
  if (!words && !filters.length) throw new UserError("Anna hakusana tai jokin rajaus (tyyppi, hankintayksikkö, voittaja, CPV, maakunta, vain_avoimet tai päivämäärä).");

  const page = Math.max(1, Number(args.sivu) || 1);
  const byDeadline = args.jarjestys === "maaraaika";
  const body = {
    search: words || "*",
    searchMode: "all",
    queryType: "simple",
    count: true,
    top: PAGE,
    skip: (page - 1) * PAGE,
    select: LIST_FIELDS,
    orderby: byDeadline ? "deadline asc" : "datePublished desc",
  };
  if (byDeadline) filters.push("deadline ne null");
  if (filters.length) body.filter = filters.join(" and ");
  const r = await search(body, env.HILMA_API_KEY);
  if (!r.value.length) return page > 1 ? "Ei enempää tuloksia." : "Ei osumia. Kokeile väljempää hakusanaa (esim. sanan perusmuotoa) tai poista rajauksia.";
  const out = [`Hilma: ${r.count} ilmoitusta (sivu ${page}, ${byDeadline ? "lähin määräaika ensin" : "uusin ensin"}).`];
  for (const n of r.value) out.push("", ...listEntry(n));
  if (r.count > page * PAGE) out.push("", `Lisää tuloksia: sivu ${page + 1}.`);
  out.push("", "Koko ilmoitus hankinta-työkalulla (ilmoitusnumero). Lähde: Hilma, hankintailmoitukset.fi.");
  return clip(out.join("\n"));
}

function listEntry(n) {
  const title = titleOf(n) || "(ei otsikkoa)";
  const buyer = pick(n, "organisationName");
  const head = `${n.noticeNumber ?? n.noticeId} ${MAIN_TYPE_NAMES[n.mainType] ?? n.mainType ?? ""}${n.isCancelled ? " (PERUTTU)" : ""}${n.isCorrigendum ? " (oikaisu)" : ""}: ${title}`;
  const lines = [head];
  const who = [buyer, n.organisationNationalRegistrationNumber ? `Y-tunnus ${n.organisationNationalRegistrationNumber}` : null].filter(Boolean).join(", ");
  if (who) lines.push(`  Hankintayksikkö: ${who}`);
  const facts = [];
  if (n.datePublished) facts.push(`julkaistu ${fiTime(n.datePublished, false)}`);
  if (n.deadline && n.mainType !== "ContractAwardNotices") facts.push(`määräaika ${fiTime(n.deadline)}`);
  const value =
    money(n.noticeResultTotalAmount, n.noticeResultTotalAmountCurrency) ??
    money(n.estimatedValue, n.currency) ??
    money(n.overallMaximumFrameworkContractsAmount, n.overallMaximumFrameworkContractsCurrency);
  if (value) facts.push(`arvo ${value}`);
  if (n.procurementTypeCode) facts.push(n.procurementTypeCode.split(" ").map((t) => PROC_TYPES[t] ?? t).join(" ja "));
  if (n.nutsCodes) facts.push(regionName(n.nutsCodes));
  if (facts.length) lines.push(`  ${facts.join(", ")}`);
  if (n.cpvCodes) lines.push(`  CPV: ${n.cpvCodes}`);
  const w = winners(n.winnerOrganisations);
  if (w.length) lines.push(`  Voittajat: ${w.length > 8 ? w.slice(0, 8).join("; ") + ` ja ${w.length - 8} muuta` : w.join("; ")}`);
  lines.push(`  ${noticeWebUrl(n)}`);
  return lines;
}

// ---------- Yksittäinen ilmoitus ----------

async function hankinta(args, env) {
  const id = String(args.ilmoitus ?? "").trim();
  let filter;
  if (/^\d{4}-\d{6}$/.test(id)) filter = `noticeNumber eq '${id}'`;
  else if (/^\d{1,9}$/.test(id)) filter = `noticeId eq ${+id}`;
  else if (/^EF-\d+$/i.test(id)) filter = `id eq '${id.toUpperCase()}'`;
  else throw new UserError('Anna ilmoitusnumero, esim. "2026-060704", tai hakutuloksen tunniste, esim. "60704".');
  const r = await search({ search: "*", filter, top: 2, count: true }, env.HILMA_API_KEY, 3600);
  const n = r.value[0];
  if (!n) throw new UserError(`Ilmoitusta ${id} ei löytynyt Hilmasta.`);

  const out = [];
  out.push(`${n.noticeNumber ?? n.noticeId} ${MAIN_TYPE_NAMES[n.mainType] ?? n.mainType ?? ""}${n.isCancelled ? " (PERUTTU)" : ""}${n.isCorrigendum ? " (oikaisu)" : ""}`);
  out.push(titleOf(n) || "(ei otsikkoa)");
  const buyer = [pick(n, "organisationName"), n.organisationDepartment, n.organisationNationalRegistrationNumber ? `Y-tunnus ${n.organisationNationalRegistrationNumber}` : null].filter(Boolean).join(", ");
  if (buyer) out.push(`Hankintayksikkö: ${buyer}${n.organisationAddress ? ` (${n.organisationAddress})` : ""}`);
  const facts = [];
  if (n.datePublished) facts.push(`Julkaistu ${fiTime(n.datePublished, false)}`);
  if (n.deadline && n.mainType !== "ContractAwardNotices") facts.push(`määräaika ${fiTime(n.deadline)}`);
  if (facts.length) out.push(facts.join(", ") + ".");
  const kind = [];
  if (n.procurementTypeCode) kind.push(n.procurementTypeCode.split(" ").map((t) => PROC_TYPES[t] ?? t).join(" ja "));
  if (n.procedureType) kind.push(PROCEDURES[n.procedureType] ?? n.procedureType);
  if (n.isEuProcurement) kind.push("EU-kynnysarvon ylittävä");
  else if (n.isNationalProcurement) kind.push("kansallinen hankinta");
  if (n.includesFrameworkAgreement) kind.push("puitejärjestely");
  if (n.includesDynamicPurcharingSystem) kind.push("dynaaminen hankintajärjestelmä");
  if (kind.length) out.push(`Hankinta: ${kind.join(", ")}.`);
  const values = [];
  if (n.estimatedValue) values.push(`ennakoitu arvo ${money(n.estimatedValue, n.currency)}`);
  if (n.overallMaximumFrameworkContractsAmount) values.push(`puitejärjestelyn enimmäisarvo ${money(n.overallMaximumFrameworkContractsAmount, n.overallMaximumFrameworkContractsCurrency)}`);
  if (n.noticeResultTotalAmount) values.push(`hankinnan kokonaisarvo ${money(n.noticeResultTotalAmount, n.noticeResultTotalAmountCurrency)}`);
  if (values.length) out.push(`Arvo: ${values.join(", ")}.`);
  if (n.cpvCodes) out.push(`CPV: ${n.cpvCodes}`);
  if (n.nutsCodes) out.push(`Alue: ${regionName(n.nutsCodes)}`);
  const w = winners(n.winnerOrganisations);
  if (w.length) out.push(`Voittajat: ${w.join("; ")}`);
  if (n.procurementDocumentsUrl) out.push(`Tarjousasiakirjat: ${n.procurementDocumentsUrl}`);
  out.push(`Hilma: ${noticeWebUrl(n)}`);
  if (n.tedPublicationId) out.push(`TED: https://ted.europa.eu/fi/notice/-/detail/${n.tedPublicationId}`);

  // Monen osan ilmoituksissa indeksin kuvaukseen on liitetty osien kuvaukset (", <osan nimi> <kuvaus>");
  // pääkuvaus katkaistaan ensimmäisen osan kohdalta, koska osat näytetään erikseen.
  let desc = pick(n, "description").trim();
  const lotList = Array.isArray(n.lots) ? n.lots : [];
  if (lotList.length > 1) {
    const t0 = pick(lotList[0], "title");
    const cut = t0 ? desc.indexOf(`, ${t0} `) : -1;
    if (cut > 0) desc = desc.slice(0, cut).trim();
  }
  if (desc) out.push("", "KUVAUS", desc);

  // Osat: indeksistä kuvaukset, arvot ja voittajat; eForms-XML:stä arviointiperusteet ja sopimuskausi.
  let extra = new Map();
  if (n.isEForms) {
    try {
      const xml = await noticeXml(n.noticeId, env.HILMA_API_KEY);
      if (xml) extra = parseLots(xml);
    } catch (e) {
      if (!(e instanceof HilmaError)) throw e;
    }
  }
  const lots = Array.isArray(n.lots) ? n.lots : [];
  if (lots.length) {
    out.push("", lots.length > 1 ? `OSAT (${lots.length})` : "HANKINNAN TIEDOT");
    lots.forEach((l, i) => {
      const x = (l.id && extra.get(l.id)) || (lots.length === 1 ? [...extra.values()][0] : null);
      const lines = [];
      if (lots.length > 1) lines.push(`${l.id ?? `Osa ${i + 1}`}: ${pick(l, "title") || "(ei otsikkoa)"}`);
      const lf = [];
      if (l.cpvCodes && l.cpvCodes !== n.cpvCodes) lf.push(`CPV ${l.cpvCodes}`);
      if (l.nutsCodes && l.nutsCodes !== n.nutsCodes) lf.push(regionName(l.nutsCodes));
      if (l.estimatedValue && l.estimatedValue !== l.lotResultTotalAmount) lf.push(`ennakoitu arvo ${money(l.estimatedValue, l.currency)}`);
      if (l.lotResultTotalAmount) lf.push(`arvo ${money(l.lotResultTotalAmount, l.lotResultTotalAmountCurrency)}`);
      if (l.deadline && l.deadline !== n.deadline && n.mainType !== "ContractAwardNotices") lf.push(`määräaika ${fiTime(l.deadline)}`);
      if (l.receivedTenderCount) lf.push(`tarjouksia ${l.receivedTenderCount}`);
      if (lf.length) lines.push(`  ${lf.join(", ")}`);
      const lw = winners(l.winnerOrganisations);
      if (lw.length && lots.length > 1) lines.push(`  Voittajat: ${lw.join("; ")}`);
      if (x?.period) lines.push(`  Sopimuskausi: ${x.period}`);
      if (x?.options) lines.push(`  Optiot ja jatko: ${x.options}`);
      if (x?.criteria?.length) lines.push(`  Arviointiperusteet: ${x.criteria.join("; ")}`);
      if (x?.values?.length && !l.lotResultTotalAmount) lines.push(`  ${x.values.join(", ")}`);
      const ld = pick(l, "description").trim();
      if (ld && ld !== desc && !desc.endsWith(ld)) lines.push(`  Kuvaus: ${ld}`);
      out.push(...(lines.length ? lines : ["  (ei lisätietoja)"]));
      if (lots.length > 1) out.push("");
    });
  }
  out.push("", "Lähde: Hilma, hankintailmoitukset.fi. Tarkista määräajat ja ehdot tarjousasiakirjoista.");
  return clip(out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd());
}

const HANDLERS = { hae_hankintoja: haeHankintoja, hankinta };

export async function callTool(name, args = {}, env = {}) {
  const fn = HANDLERS[name];
  if (!fn) return { isError: true, content: [{ type: "text", text: `Tuntematon työkalu: ${name}` }] };
  try {
    return { content: [{ type: "text", text: await fn(args ?? {}, env) }] };
  } catch (e) {
    const msg =
      e instanceof UserError
        ? e.message
        : e instanceof HilmaError
          ? `Hilma-haku epäonnistui: ${e.message}. Yritä hetken päästä uudelleen.`
          : `Odottamaton virhe: ${e?.message ?? e}`;
    return { isError: true, content: [{ type: "text", text: msg }] };
  }
}
