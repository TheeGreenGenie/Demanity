# Location Pages (R32)

> ## ⚠️ REVIEW BEFORE RELEASE
> Two parts of this document are proposals that need validation: the "Outlook on proposed legislation" method (§3) and the "Biggest problems" method (§4). This page also falls under the review rules for [SCORING.md](SCORING.md).

Demanity has one page for each **federal judicial district, county, city and state**. Each page gives a complete view of government in that place.

## 1. Geography
- **Boundaries.** Boundaries come from the [Census TIGER/Line files](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html), which cover:
  - states and counties
  - places (cities)
  - congressional districts
  - state legislative districts
- **Court districts.** Federal judicial districts come from [US Courts](https://www.uscourts.gov/about-federal-courts/court-role-and-structure). There are 94 of them.
- **User location.** Location is optional and volunteered. It is stored at county level or coarser and is used only for local feeds and location follows ([PRIVACY.md](PRIVACY.md)).

## 2. Page sections
1. **Leaders.** Every official whose district covers this place, with per-category scores, the overall score and VS links.
   - At the MVP stage, this means:
     - members of Congress
     - senators
     - state legislators
     - the governor and statewide officials
     - federal judges, on court-district pages
   - Slots for county and city officials are reserved for when local scope begins.
2. **New legislation.** Bills, executive orders, regulations and rulings introduced for or applying to this place ([LEGISLATION.md](LEGISLATION.md)). Court-district pages show rulings from that district.
3. **Outlook on proposed legislation** (§3).
4. **Biggest problems by category** (§4).
5. **Local voice.** Verified local users' polls ("What's the biggest issue here?") appear **next to** the official data and are never blended into it. They carry the self-selected-sample label.

## 3. Outlook on proposed legislation (proposal)
For each pending bill relevant to the place, in the bill's CRS policy area `c`:
- **Sponsor trust.** The trust score in `c` of each sponsor and cosponsor, plus an evidence-weighted mean ([SCORING.md §4.1](SCORING.md#41-overall-score)).
- **Local representatives.** For each official who represents this place: their trust score in `c` and their declared stance in `c`. The stance is one of support, oppose or no declared stance.
- **Label:** *"Outlook based on trust scores, not a prediction of passage."*
- **No probability of passage is computed.** No validated model has been chosen yet. Inventing one would break the no-fabrication rule.

## 4. Biggest problems by category (proposal)
**Step 1: map indicators to categories.** Official indicators are mapped to the CRS categories. Draft mapping:

| Category | Indicator | Source |
|---|---|---|
| Housing & Community Development | Share of renters spending 30% or more of income on housing | [Census American Community Survey (ACS) 5-year](https://www.census.gov/data/developers/data-sets/acs-5year.html) |
| Social Welfare | Poverty rate | ACS 5-year |
| Health | Uninsured rate (ACS); chronic-disease prevalence | ACS; [CDC PLACES](https://www.cdc.gov/places/) |
| Labor & Employment | Unemployment rate | [BLS Local Area Unemployment Statistics](https://www.bls.gov/lau/) |
| Crime & Law Enforcement | Violent and property crime rates | [FBI Crime Data Explorer](https://cde.ucr.cjis.gov/) |
| Education | Share of adults without a high-school diploma | ACS 5-year |

**Step 2: compute percentiles.** For each indicator, compute the place's percentile among its **peers**: all counties, all cities, or all states. Every indicator is oriented so that a higher percentile means a worse problem.

**Step 3: score each category.** A category's problem score is the mean percentile of its indicators.

**Step 4: display.** Show the **top 3–5 categories** with the worst problem scores. Each one shows:
- the indicator values
- the year of the data
- the source citation
- the peer group used

**Limitations:**
- Indicators are proxies.
- Data years differ between sources.
- Crime-reporting coverage varies by agency.
- Cities and court districts need aggregation from counties or tracts, and the method for that aggregation must be documented.

**Before release:** finish the indicator-to-category mapping for all categories that have usable data, and get cross-partisan review of the mapping ([NONPARTISANSHIP.md](NONPARTISANSHIP.md)).
