# PROJECT.md: hilma-mcp

Oma Claude-liitin julkisille hankinnoille Hilmasta. Tehty 31.10.2026 Finlex- ja EUR-Lex-liittimien mallilla.

## Päätökset

- Oma Worker eikä osa Finlex- tai Aluetieto-liitintä: Hilman lukurajapinnan käyttöehdot (luettu 31.10.2026) rajaavat käytön rekisteröityneeseen käyttäjään ("tarkoitettu vain rekisteröityneen Käyttäjän käyttöön", käyttöoikeutta ei saa siirtää kolmannelle, API-avaimen luovuttaminen kolmannelle on kielletty). Muut liittimet ovat avoimia.
- Salainen polku on pakollinen (`MCP_PATH_SECRET`, vähintään 12 merkkiä). Ilman sitä Worker ei vastaa.
- Ei tarkoitettu Anthropicin connector-hakemistoon.
- Tiedot hakuindeksistä (`eformnotices-v2`), jossa ovat myös osat, voittajat ja arvot. Arviointiperusteet ja sopimuskausi eForms-XML:stä.
- Muiden julkaisemien liitinten väite CC BY 4.0 -lisenssistä ei pidä paikkaansa lukurajapinnan osalta: immateriaalioikeudet kuuluvat Hansel Oy:lle, ja tietoja saa käyttää omassa toiminnassa.
- Workers Paid -tilaus (CPU-raja 30 s).

## Rakenne

- `src/index.js`: MCP-protokolla, salainen polku ja käyttörajoitus
- `src/tools.js`: työkalujen määrittelyt ja toteutus, maakuntien NUTS-koodit
- `src/hilma.js`: Hilman rajapinnan asiakas ja välimuisti
- `src/ted.js`: TED-hakurajapinnan asiakas (EU:n hankintailmoitukset), ilmoitustyypit ja maakoodit
- `src/eforms.js`: eForms-XML:n osakohtaiset tiedot (arviointiperusteet, sopimuskausi, optiot)
- `test/smoke.mjs`: savutesti (tarvitsee HILMA_API_KEY-ympäristömuuttujan)

## Muutokset

- 31.10.2026 v1.0: hae_hankintoja, hankinta.
- 31.10.2026 v1.0.1: salaisen polun vähimmäispituus 12 merkkiä (oli 16).
- 1.11.2026 v1.1: EU-hankinnat TEDistä (hae_eu_hankintoja, eu_hankinta). TED-rajapinta ei vaadi avainta, ja ilmoitusten uudelleenkäyttö on vapaata (TED legal notice, luettu 1.11.2026). Lisätty tähän liittimeen, koska aihe on sama; TED ei itse vaadi yksityistä liitintä.
