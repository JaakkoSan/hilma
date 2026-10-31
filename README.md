# hilma-mcp

Claude-liitin (MCP-palvelin), joka hakee julkisia hankintoja Hilmasta (hankintailmoitukset.fi): hankintailmoitukset, jälki-ilmoitukset voittajineen, ennakkoilmoitukset ja hankintasuunnitelmat. Toimii Cloudflare Workerina eikä tallenna mitään.

**Vain omaan käyttöön.** Hilman lukurajapinnan käyttöehtojen mukaan rajapinnan käyttö on tarkoitettu vain rekisteröityneen käyttäjän käyttöön, käyttöoikeutta ei saa siirtää kolmannelle osapuolelle eikä API-avainta saa luovuttaa kolmannelle. Siksi Worker vastaa vain salaisella polulla, ja jokainen käyttäjä tarvitsee oman avaimensa ja oman Workerinsa.

## Työkalut

| Työkalu | Mitä tekee |
|---|---|
| `hae_hankintoja` | Haku hakusanalla, ilmoituksen tyypillä, hankintayksiköllä (nimi tai Y-tunnus), voittajalla (nimi tai Y-tunnus), CPV-koodilla, maakunnalla, avoinna olevilla ja julkaisupäivällä |
| `hankinta` | Yhden ilmoituksen tiedot: hankintayksikkö, kuvaus, menettely, arvo, määräaika, osat (arviointiperusteet painoineen, sopimuskausi ja optiot), voittajat, tarjousasiakirjojen ja Hilman linkit |

Ilmoituksen tyypit: `ilmoitus` (hankintailmoitus), `paatos` (jälki-ilmoitus), `ennakko` (ennakkoilmoitus), `suunnitelma` (hankintasuunnitelma), `muutos` (sopimusmuutos).

## Rajapinta

- Haku: `POST https://api.hankintailmoitukset.fi/avp/eformnotices/docs/search` (Azure AI Search -indeksi `eformnotices-v2`)
- Ilmoitus: `GET https://api.hankintailmoitukset.fi/avp-eforms/external-read/v1/notice/{noticeId}` (eForms-XML Base64-koodattuna)
- Avain: `avp-read`-tilaus kehittäjäportaalissa https://hns-hilma-prod-apim.developer.azure-api.net/ (Products → avp-read → Subscribe)
- Välimuisti: haut 30 min, yksittäinen ilmoitus 1 h, eForms-XML 6 h (Cloudflaren Cache API). Rajapinnalla on nopeusrajoitus (429), joten toistuvat haut palvellaan välimuistista.
- Maakunnat muunnetaan NUTS 3 -koodeiksi (Tilastokeskus: NUTS 2021 ja NUTS 2024/2026, koska Hilman ilmoituksissa on molempia). Maakuntaehto osuu, jos hankinnan suorituspaikka tai hankintayksikön sijainti on maakunnassa.

## Käyttöönotto

1. Hanki avain kehittäjäportaalista.
2. Luo Worker `hilma-mcp` ja lisää salaisuudet (Settings → Variables and Secrets, tyyppi Secret):
   - `HILMA_API_KEY`: avp-read-tilauksen Primary key
   - `MCP_PATH_SECRET`: vähintään 12 merkkiä satunnaista tekstiä
3. Julkaise (Workers Builds pushista main-haaraan tai `npx wrangler deploy`).
4. Lisää Claudeen liitin osoitteella `https://hilma-mcp.<alitunnus>.workers.dev/mcp/<MCP_PATH_SECRET>`.

Ilman `MCP_PATH_SECRET`-salaisuutta Worker ei vastaa lainkaan.

## Kehitys

```
npm install
HILMA_API_KEY=... node test/smoke.mjs   # savutesti oikeaa Hilmaa vasten
```

## Käyttörajoitus ja merkinnät

- Työkalukutsuja rajoitetaan Cloudflaren Rate Limiting -sidonnoilla: 30 kutsua minuutissa per MCP-istunto ja 120 per IP-osoite.
- Kaikilla työkaluilla on MCP-merkinnät `readOnlyHint: true` ja `destructiveHint: false`.
- Yhden vastauksen enimmäispituus on 50 000 merkkiä.

## Rajoitukset

- Hakusana haetaan indeksin tekstikentistä (otsikko, kuvaus); osumajärjestys on julkaisupäivän tai määräajan mukainen, ei osuvuuden.
- Arvo julkaistaan vain osassa ilmoituksia. Voittajat ovat jälki-ilmoituksista.
- Arviointiperusteet ja sopimuskausi luetaan eForms-ilmoituksista; vanhemmista (ennen eFormsia julkaistuista) ilmoituksista niitä ei näytetä.

## Lisenssi ja lähde

Koodi: MIT, ks. [LICENSE](LICENSE). Data: Hilma, hankintailmoitukset.fi (Hansel Oy, valtiovarainministeriö). Kaikki immateriaalioikeudet palveluun ja lukurajapintaan kuuluvat Hansel Oy:lle; käyttöehdot: https://hnshilmaprodsa.blob.core.windows.net/files/hilma-lukurajapinta-kayttoehdot.pdf. Tämä ei ole Hanselin tai valtiovarainministeriön palvelu.
