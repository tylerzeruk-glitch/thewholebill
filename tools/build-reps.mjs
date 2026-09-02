/* Regenerates src/reps.js — the nationwide ZIP→district→member snapshot.
 * Run BY HAND when membership or cosponsorship moves:
 *
 *     node tools/build-reps.mjs
 *
 * Deliberately not part of build.sh: deploys must not depend on the network,
 * and this data changes on a political calendar, not a code one. The output
 * is checked in, carries its retrieval date, and the UI shows that date.
 *
 * Sources (all keyless):
 *   unitedstates/congress-legislators  legislators-current.json  (members)
 *   OpenSourceActivismTech/us-zipcodes-congress  zccd.csv        (ZIP→CD)
 *   govinfo bulk BILLSTATUS  119 H.R. 3069 + S. 1506             (cosponsors)
 *
 * Coverage: the 50 states plus DC (whose delegate is district 0, like every
 * at-large seat). Territories are left out: the site prices no marketplace
 * there, so their ZIPs never reach the rep card.
 *
 * A ZIP mapped to more than one district is a REAL split (about a quarter of
 * ZIPs) — the UI must ask the reader which district is theirs, never guess.
 * That rule is the reason this file exists in this shape.
 *
 * The ZIP table is grouped by 3-digit prefix with a bare string for the
 * common one-district case, or it would dwarf the rest of the page:
 *   zip["064"]["68"] === "CT-4"        one district
 *   zip["100"]["01"] === ["NY-10","NY-12"]   a split: ask the reader
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const STATES = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"]);

const LEGIS = "https://unitedstates.github.io/congress-legislators/legislators-current.json";
const ZCCD  = "https://raw.githubusercontent.com/OpenSourceActivismTech/us-zipcodes-congress/master/zccd.csv";
const HOUSE_BILL  = "https://www.govinfo.gov/bulkdata/BILLSTATUS/119/hr/BILLSTATUS-119hr3069.xml";
const SENATE_BILL = "https://www.govinfo.gov/bulkdata/BILLSTATUS/119/s/BILLSTATUS-119s1506.xml";

const get = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.text();
};

const [legisRaw, zccdRaw, houseXml, senateXml] = await Promise.all(
  [LEGIS, ZCCD, HOUSE_BILL, SENATE_BILL].map(get));

// --- ZIP → districts, every state -------------------------------------------
const flat = {};
for (const line of zccdRaw.split("\n").slice(1)) {
  const [, st, zcta, cd] = line.trim().split(",");
  if (!zcta || !STATES.has(st)) continue;
  (flat[zcta] ||= []).push(`${st}-${+cd}`);
}
let zipCount = 0, splitCount = 0;
const zip = {};
for (const z of Object.keys(flat).sort()) {
  const ds = [...new Set(flat[z])].sort();
  (zip[z.slice(0, 3)] ||= {})[z.slice(3)] = ds.length === 1 ? ds[0] : ds;
  zipCount++;
  if (ds.length > 1) splitCount++;
}

// --- cosponsors + sponsors, by bioguide -------------------------------------
// A cosponsor who has withdrawn (sponsorshipWithdrawnDate set) is not current.
// None today; the guard is here so the day one withdraws the card is right.
const bioguides = (xml) => new Set([...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
  .map(m => m[1])
  .filter(item => !/<sponsorshipWithdrawnDate>\s*\S/.test(item))
  .flatMap(item => [...item.matchAll(/<bioguideId>([A-Z0-9]+)<\/bioguideId>/g)].map(x => x[1])));
const houseCo = bioguides(houseXml), senateCo = bioguides(senateXml);

// --- every current member ---------------------------------------------------
const legis = JSON.parse(legisRaw);
const needed = new Set(Object.values(zip).flatMap(m => Object.values(m)).flat());
const house = {}, senate = {};
for (const m of legis) {
  const t = m.terms[m.terms.length - 1];
  if (!STATES.has(t.state)) continue;
  const entry = {
    n: m.name.official_full,
    p: t.party[0],
    // a member with no URL in the dataset gets the house.gov convention, so the
    // dark button is never greyed out for want of a link (CA-1 shipped that way)
    u: t.url || (t.type === "rep" ? `https://${m.name.last.toLowerCase().replace(/[^a-z]/g, "")}.house.gov/` : ""),
    b: m.id.bioguide,   // keys the official portrait in the @unitedstates images collection
    co: false,
  };
  if (t.type === "rep") {
    entry.co = houseCo.has(m.id.bioguide);
    house[`${t.state}-${t.district}`] = entry;
  } else if (t.type === "sen") {
    entry.co = senateCo.has(m.id.bioguide);
    (senate[t.state] ||= []).push(entry);
  }
}

// Names and URLs go into innerHTML on the card. Every one is plain text and a
// house.gov / senate.gov address today; refuse to write a table where that stops
// being true rather than trust it silently.
for (const m of [...Object.values(house), ...Object.values(senate).flat()]) {
  if (/[<>&]/.test(m.n)) throw new Error(`build-reps: name needs escaping: ${m.n}`);   // nicknames carry quotes; names are set as text
  if (m.u && !/^https:\/\/[a-z0-9.-]+\.(house|senate)\.gov\/?[a-z0-9\/._-]*$/i.test(m.u)) throw new Error(`build-reps: unexpected URL ${m.u} for ${m.n}`);
}
const missing = [...needed].filter(k => !house[k]);
if (missing.length) console.warn("WARN: districts with no current member (vacancy?):", missing.join(", "));

const asOf = new Date().toISOString().slice(0, 10);
const out = `/* Generated by tools/build-reps.mjs — DO NOT EDIT BY HAND. Regenerate with:
 *     node tools/build-reps.mjs
 * Retrieved ${asOf} from unitedstates/congress-legislators (members),
 * OpenSourceActivismTech/us-zipcodes-congress (ZIP→district, Geocorr-derived),
 * and govinfo BILLSTATUS 119 H.R. 3069 / S. 1506 (cosponsors). Nationwide:
 * every ZIP in the 50 states and DC, grouped by 3-digit prefix; a bare string
 * is a one-district ZIP, an array is a real split — ask the reader which is
 * theirs, never guess. District 0 is an at-large seat (or DC's delegate). */
var REPS = {"asOf":${JSON.stringify(asOf)},
"zip":${JSON.stringify(zip)},
"house":${JSON.stringify(house, null, 1)},
"senate":${JSON.stringify(senate, null, 1)}};
`;
const path = resolve(dirname(fileURLToPath(import.meta.url)), "../src/reps.js");
writeFileSync(path, out);
console.log(`wrote src/reps.js — ${zipCount} ZIPs (${splitCount} splits), ${Object.keys(house).length} house members, ${Object.values(senate).flat().length} senators, as of ${asOf}`);
if (missing.length) console.log(`vacant districts carried as vacancies: ${missing.join(", ")}`);
