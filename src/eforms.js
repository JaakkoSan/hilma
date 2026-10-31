// eForms-ilmoituksen (UBL-XML) osakohtaiset lisätiedot, joita hakuindeksissä ei ole:
// arviointiperusteet painoineen, sopimuskausi ja optiot. Jäsennys on kevyt ja
// perustuu elementtien nimiin (cac:ProcurementProjectLot, cac:AwardingCriterion …).

const UNITS = { DAY: "päivää", WEEK: "viikkoa", MONTH: "kuukautta", YEAR: "vuotta" };
const CRITERION_TYPES = { price: "hinta", quality: "laatu", cost: "kustannus" };

const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
    .replace(/&amp;/g, "&");

const text = (s) => decode(String(s ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Ensimmäinen elementti tagilla; suomenkielinen versio, jos languageID-attribuutteja on useita. */
function first(block, tag) {
  const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  let fallback = null;
  let m;
  while ((m = re.exec(block))) {
    const attrs = m[1] ?? "";
    if (/languageID="FIN"/.test(attrs)) return text(m[2]);
    if (fallback === null) fallback = text(m[2]);
  }
  return fallback;
}

function blocks(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, "g");
  let m;
  while ((m = re.exec(xml))) out.push(m[0]);
  return out;
}

const fmtDate = (s) => {
  const m = String(s ?? "").match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${+m[3]}.${+m[2]}.${m[1]}` : null;
};

/** Map osan tunnus → { criteria: [..], period, options }. */
export function parseLots(xml) {
  const out = new Map();
  for (const lot of blocks(xml, "cac:ProcurementProjectLot")) {
    const id = (lot.match(/<cbc:ID[^>]*schemeName="Lot"[^>]*>([^<]+)</) ?? [])[1]?.trim();
    if (!id) continue;
    const info = { criteria: [], period: null, options: null };

    for (const c of blocks(lot, "cac:SubordinateAwardingCriterion")) {
      const name = first(c, "cbc:Name");
      const type = first(c, "cbc:AwardingCriterionTypeCode");
      const weightCode = first(c, "efbc:ParameterCode");
      const weight = first(c, "efbc:ParameterNumeric");
      const parts = [name || CRITERION_TYPES[type] || type || "peruste"];
      if (name && CRITERION_TYPES[type] && name.toLowerCase() !== CRITERION_TYPES[type]) parts.push(`(${CRITERION_TYPES[type]})`);
      // Painotuksen laji (eForms number-weight): per-* = prosentti, poi-* = pisteet, ord-* = tärkeysjärjestys.
      if (weight) {
        const wc = weightCode ?? "";
        parts.push(/^per-/.test(wc) ? `${weight} %` : /^ord-/.test(wc) ? `tärkeysjärjestyksessä ${weight}.` : `${weight} p`);
      }
      info.criteria.push(parts.join(" "));
    }

    const pp = blocks(lot, "cac:PlannedPeriod")[0];
    if (pp) {
      const start = fmtDate(first(pp, "cbc:StartDate"));
      const end = fmtDate(first(pp, "cbc:EndDate"));
      const dur = pp.match(/<cbc:DurationMeasure[^>]*unitCode="([A-Z]+)"[^>]*>([^<]+)</);
      if (start || end) info.period = `${start ?? "?"}–${end ?? "?"}`;
      else if (dur) info.period = `${dur[2].trim()} ${UNITS[dur[1]] ?? dur[1].toLowerCase()}`;
    }
    const ext = blocks(lot, "cac:ContractExtension")[0];
    if (ext) {
      const parts = [first(ext, "cbc:OptionsDescription")];
      const max = first(ext, "cbc:MaximumNumberNumeric");
      if (max) parts.push(`uusimisia enintään ${max}`);
      info.options = parts.filter(Boolean).join("; ") || null;
    }
    out.set(id, info);
  }
  return out;
}
