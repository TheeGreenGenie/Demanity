# Demanity Scoring Methodology

> ## ⚠️ REVIEW: this entire document is a proposal
> The rules here come from the founder's design, plus a research-based proposal for the overall score and the other combined measures (§4). **Other contributors may disagree, and that is expected.** Every formula and parameter can change through the public process in [NONPARTISANSHIP.md §6](NONPARTISANSHIP.md#6-changes-to-scoring-taxonomy-and-sources): a 30-day comment period, cross-partisan sign-off and a public changelog.
>
> §4 is additionally marked **REVIEW BEFORE RELEASE**. It is not finalized and must not ship without validation.

All parameters live in versioned, published config (`scoring.v1.yaml`, to be created). The code that computes scores is open source, deterministic and reproducible from the raw data exports.

---

## 1. Categories (approved)
- **Tier 1:** the Congressional Research Service (CRS) **Policy Area** vocabulary used on Congress.gov ([Congress.gov field values](https://www.congress.gov/help/field-values/policy-area)). Analysts assign one Policy Area to every bill since 1973.
  - The 32 areas are: Agriculture & Food; Animals; Armed Forces & National Security; Arts, Culture, Religion; Civil Rights & Liberties, Minority Issues; Commerce; Congress; Crime & Law Enforcement; Economics & Public Finance; Education; Emergency Management; Energy; Environmental Protection; Families; Finance & Financial Sector; Foreign Trade & International Finance; Government Operations & Politics; Health; Housing & Community Development; Immigration; International Affairs; Labor & Employment; Law; Native Americans; Public Lands & Natural Resources; Science, Technology, Communications; Social Sciences & History; Social Welfare; Sports & Recreation; Taxation; Transportation & Public Works; Water Resources Development.
  - *Check this list against the live Congress.gov field-value page before seeding the database.* The page confirms there are 32 categories, from Agriculture and Food to Water Resources Development. The term-by-term match has not been checked yet.
- **Tier 2:** curated CRS Legislative Subject Terms, roughly 1,000 terms (e.g. Abortion → Health, Firearms → Crime & Law Enforcement).
- **Civic-health categories (Demanity-specific):** Community Division / Civility, Transparency & Ethics, Race Relations (linked to Civil Rights).
- **Versioning:** categories are database rows with `version`, `parent`, `merged_into` and `retired_at`. Scores are always recomputed from raw citations, so changes to the taxonomy never lose history.

## 2. Citation strength
Only the **"Accurate?"** button feeds scores. **"Approve?"** is shown but not scored.

```
s = direction × WilsonLB(accurate_yes, accurate_votes, z = 1.96)
direction = +1 (positive citation) or −1 (negative citation)
```

**Wilson score lower bound.** This is the lower edge of the 95% confidence interval for the share of "accurate" votes ([Wilson, 1927, JASA](https://doi.org/10.1080/01621459.1927.10502953); also explained in [Evan Miller, "How Not To Sort By Average Rating"](https://www.evanmiller.org/how-not-to-sort-by-average-rating.html)):

```
WilsonLB(k, n) = ( p + z²/(2n) − z·sqrt( p(1−p)/n + z²/(4n²) ) ) / (1 + z²/n),   p = k/n
```

| Votes | Ratio | WilsonLB |
|---|---|---|
| 9 of 10 | 90% | **0.596** |
| 900 of 1000 | 90% | **0.880** |

**Why Wilson:** a plain ratio treats 9/10 the same as 900/1000, which makes small-sample citations easy to manipulate. Wilson discounts small samples automatically.

## 3. Per-category score (approved v1)
Let `t` = the leader's category score **at the moment the citation was added**, divided by 100. For the first citations, `t` = 0.5 (neutral).

Using the score from that moment, and not today's score, prevents feedback loops and keeps results reproducible.

### 3.1 Trust-weighted fade
```
half_life_years = 4 × (0.5 + t)          → 2 yrs at t=0, 4 yrs at t=0.5, 6 yrs at t=1
decay(age)      = 0.5 ^ (age_years / half_life_years)
neg_multiplier  = 0.5 + t                → 0.5× at t=0 … 1.5× at t=1  (positives: 1×)
```

The founder's rule behind these numbers:
- A strong record "lasts longer".
- A failure in an area where a leader was trusted "should not be forgotten easily".
- A bad citation in an already low-trust area matters less, because "we already know what we're getting".

| Trust when cited | Negative multiplier | Half-life |
|---|---|---|
| 80 | 1.3× | 5.2 yrs |
| 20 | 0.7× | 2.8 yrs |

### 3.2 Streak gate (positives only)
The founder's rule: *one positive effort in a sea of bad must NOT seem valuable.*

```
N = ceil(1 + 4 × (1 − t))                → 5 at t=0, 3 at t=0.5, 1 at t=1
```

- Order the category's accepted citations by **action date**.
- The streak is the run of consecutive positives since the last negative.
- Positives in a streak shorter than N count **0**. When the streak reaches N, the whole streak counts at full weight.
- Any negative resets the streak.
- The UI shows streak progress, e.g. "Streak 2/5: not yet counted".

### 3.3 Score
```
x_i   = s_i × w_i × decay_i × gate_i × (neg_multiplier_i if negative else 1)
score = 50 + 50 × Σ x_i / ( Σ |x_i| + k ),    k = 5
```

- `w_i` = source-quality weight (primary source 1.0, wire or fact-checker 0.9, other approved outlet 0.8; draft values), multiplied by the bridging factor from [EXPERIMENTS.md](EXPERIMENTS.md) #2.
- `gate_i` = 1 if the positive citation counts under the streak gate, otherwise 0. Negatives always have `gate_i` = 1.
- `k` is a neutral cushion. With few citations, the score stays near 50.
- The score always lies strictly between 0 and 100.
- **Display:** `61 / 100 · 4 citations · 1,200 votes`, with a "low evidence" label below a minimum n (draft: 3 counted citations).

**Worked example.** Three positive citations with s = 0.8 and one negative with s = −0.6. All are fresh (decay = 1), have w = 1 and are past the gate, and the negative was added at t = 0.5 (multiplier 1.0).
- Σx = 2.4 − 0.6 = 1.8
- Σ|x| = 3.0
- score = 50 + 50 × 1.8 / (3.0 + 5) = **61.25**

> *Correction note:* an earlier plan draft wrote the denominator as `Σ|w·decay·gate|`, without `s`. That doesn't reproduce the 61/100 example. The denominator is `Σ|x_i|`, as above.

## 3a. Which categories apply, and conditions vs. trust (proposal, REVIEW BEFORE RELEASE)
- **Scored only where it applies.** Each policy area is mapped to the levels of government that act on it: federal, state, local or judicial. These mappings are kept as reference data (`category_levels`), so they can be changed later.
  - A subject is scored only in categories that apply at its level. Mayors are never scored on foreign policy or the armed forces, and cities are never scored on international affairs.
  - Those categories still appear in the list as "Not applicable", and the overall score ignores them.
  - Current draft mapping: federal covers all 32. State excludes Congress, International Affairs, and Foreign Trade & International Finance. Local additionally excludes Armed Forces & National Security, Immigration, and Finance & Financial Sector. Judicial covers Law, Crime & Law Enforcement, Civil Rights & Liberties, and Immigration.
- **Two different scores, labeled differently.**
  - **Leaders get a Trust score:** how well their record matches their stated positions, built from rated citations (§2–§3).
  - **Places get a Conditions score:** how life there compares with similar places, built from official statistics ([LOCATIONS.md §5](LOCATIONS.md)). A conditions score is *not* a grade of that place's government.
- **Peers.** Leaders are compared with holders of the same office. Places are compared with the same kind of place of similar size ([LOCATIONS.md §5](LOCATIONS.md)).

## 4. Overall score, alignment, help/hurt: ⚠️ REVIEW BEFORE RELEASE
**Status: NOT FINALIZED (R31).** This is a research-based proposal. It is not important for the MVP, but it matters in practice and must be validated before first release.

### 4.1 Overall score
This follows composite-indicator practice from the [OECD/JRC *Handbook on Constructing Composite Indicators: Methodology and User Guide* (2008), DOI 10.1787/9789264043466-en](https://doi.org/10.1787/9789264043466-en) ([JRC copy](https://publications.jrc.ec.europa.eu/repository/handle/JRC47008)): transparent weights, normalized inputs, published sensitivity analysis.

```
e_c     = 1 − exp(−n_c / 10)          evidence weight; n_c = counted citations in category c
Overall = Σ_c (e_c × score_c) / Σ_c e_c     over categories with n_c ≥ 3
```

- **Equal importance for every category by default.** Ranking issues by importance would be an editorial choice that could look partisan.
- **"Your overall":** a user may set personal category weights. This is shown *alongside* the public overall and never replaces it.
- Categories with n_c < 3 are excluded from the overall and listed as "insufficient evidence".
- **Sensitivity:** the page publishes how much the overall changes if any single category is dropped.

| n_c | e_c |
|---|---|
| 3 | 0.26 |
| 10 | 0.63 |
| 30 | 0.95 |

### 4.2 Most aligned with
Two signals, always shown separately and never blended:
1. **Voting agreement:** the share of roll-call votes both leaders cast in which they voted the same way. Agreement and scaling measures from roll-call data are standard in political science; see [Voteview](https://voteview.com/) and the NOMINATE work behind it.
2. **Stance similarity:** cosine similarity of the two leaders' declared stance vectors, over the categories both have declared.

The page shows the top 3 for each signal, each with n.

### 4.3 Projected to help / hurt most
- Contributors tag each citation with affected groups from a fixed, published list based on Census demographic and economic categories ([Census subject definitions](https://www.census.gov/programs-surveys/acs/technical-documentation/code-lists.html)).
- Net impact for group g = Σ x_i over citations tagged g.
- The page shows the top (helped) and bottom (hurt) groups, with n.
- Label: *"Community-assessed impact, not a forecast."*

### 4.4 Validation required before release
1. Run on seeded synthetic data and real MVP data.
2. Publish the sensitivity results.
3. Hold a 30-day public comment period.
4. Get cross-partisan sign-off ([NONPARTISANSHIP.md](NONPARTISANSHIP.md)).

## 5. Contribution score
```
CS = Σ_citations [0.8 × WilsonLB(accurate) + 0.2 × WilsonLB(approve)]
   + Σ_devils_advocate_entries WilsonLB(helpful_votes)
   − 3 × takedowns
   − 1 × citations that required a moderator context note
```

- A takedown is heavily negative. Needing a context note is slightly negative.
- Falling below the low-trust threshold (config) revokes contributor status. Status otherwise renews yearly.

## 6. Known limitations
- Scores reflect the judgment of **self-selected verified users**, not of the US population.
- Accuracy votes can still be shaped by partisanship. The bridging factor reduces this but does not eliminate it.
- Fade and streak parameters are value judgments, not empirically derived constants.
- No parameter has been tested on real data yet.
