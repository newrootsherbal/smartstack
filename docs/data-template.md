# Product data template

This is how the product team hands real product and rule data to the app without touching
code. Fill in one row per product in a copy of `docs/data-template.csv` (Excel or Google
Sheets, export as CSV, UTF-8), then a developer runs the importer:

```bash
npx tsx packages/engine/scripts/import-csv.ts path/to/products.csv
```

The importer writes `packages/engine/data/import/products.json` and `rules.json`, checks
the result against the schemas and the existing catalogue, and prints every problem with the
row number. Nothing is changed in the live data until a developer merges the output.

## Ground rules

- **Nothing is invented.** Every value comes from the current label, the NPN licence or a
  source you can link. Leave a cell empty rather than guessing. An empty evidence source
  renders as "Source: to be added".
- **Timing rules are reviewed before they ship.** A rule with `review_status` other than
  `reviewed` may only use the severities `timing_conflict`, `consideration` or
  `informational`. `product_instruction` means "copied from the reviewed label" and
  `important` is reserved for medication interactions (not in Phase 1).
- **The app never says a dose is unsafe.** Rule explanations describe timing, not safety.
- **Ingredient-level rules** (for example "iron separates from calcium", which applies to
  every product containing iron) live in `packages/engine/data/rules.json` and are curated by
  hand. The CSV only creates **product-level** rules and can switch inherited rules off
  (`disable_rules`).
- Ingredient ids must already exist in `packages/engine/data/ingredients.json` (id, EN/FR
  name, canonical unit). Ask a developer to add missing ingredients first.

## Columns

| Column                  | Required | Format / allowed values                                                                                                                                                     |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | no       | Stable identifier, lowercase letters, digits and dashes. Defaults to a slug of the SKU. Never change it once shipped.                                                        |
| `sku`                   | yes      | Internal SKU as printed on the case.                                                                                                                                         |
| `upc`                   | yes      | 12-digit UPC-A or 13-digit EAN-13, digits only. Must scan from the retail package.                                                                                           |
| `npn`                   | yes      | 8-digit Natural Product Number from the licence. Sample data uses `SAMPLE-NPN-0001`.                                                                                        |
| `brand`                 | yes      | `New Roots Herbal` for real products. `Sample` for placeholders.                                                                                                             |
| `name_en`, `name_fr`    | EN yes   | Full product name as on the label.                                                                                                                                          |
| `short_name_en/_fr`     | no       | Short label for schedule rows and reminder titles ("Iron", "Fish oil"). Defaults to `name_en`.                                                                              |
| `form`                  | yes      | `capsule`, `tablet`, `softgel`, `powder`, `liquid`, `other`                                                                                                                 |
| `serving_size`          | yes      | As on the label, e.g. `1 capsule`, `2 tablets`, `5 mL`.                                                                                                                     |
| `doses_per_day_default` | yes      | 1–4. The number of times per day the label directs; the user can change it.                                                                                                 |
| `ingredients`           | yes      | Medicinal ingredients per dose, `id=amount unit`, separated by `;`. Example: `iron=20 mg; vitamin-c=60 mg`. Units must match `ingredients.json` (`mg`, `mcg`, `IU`, `CFU`). |
| `directions_en/_fr`     | EN yes   | Recommended use, copied from the label.                                                                                                                                     |
| `warnings_en/_fr`       | EN yes   | Cautions and warnings, copied from the label.                                                                                                                               |
| `timing_rules`          | no       | `ATTRIBUTE:severity[:anchor,anchor]` separated by `;`. See attributes below. Anchors (`breakfast`, `lunch`, `dinner`) express meal preference for `WITH_FOOD` / `WITH_FAT`. |
| `interaction_rules`     | no       | `ATTRIBUTE:severity:minutes` separated by `;`. Example: `SEPARATE_FROM_CALCIUM:timing_conflict:120`.                                                                        |
| `rule_explanations_en`  | if rules | `ATTRIBUTE=Plain-language explanation` separated by `;`. One per rule listed above. This is the text in "More info".                                                          |
| `rule_explanations_fr`  | no       | Same, in French.                                                                                                                                                            |
| `evidence_sources`      | no       | `ATTRIBUTE=https://…` separated by `;`. Only real, public URLs (Health Canada, NIH ODS, peer-reviewed article).                                                              |
| `disable_rules`         | no       | Ids of ingredient-level rules that must not apply to this product, separated by `;` (e.g. a multivitamin that should not be pushed to the evening by its calcium content).  |
| `label_version`         | yes      | Label revision identifier or date, e.g. `2026-03`.                                                                                                                          |
| `status`                | yes      | `sample`, `draft`, `reviewed`                                                                                                                                                |
| `review_status`         | yes      | `unreviewed`, `in_review`, `reviewed` (applies to the product and to its rules from this row)                                                                                |
| `last_reviewed`         | if reviewed | `YYYY-MM-DD`                                                                                                                                                             |
| `reviewed_by`           | if reviewed | Name or team.                                                                                                                                                            |

### Timing attributes

| Attribute                  | Meaning in the engine                                                 |
| -------------------------- | --------------------------------------------------------------------- |
| `WITH_FOOD`                | Attach to a meal (breakfast unless anchors are given).                |
| `WITHOUT_FOOD`             | Recorded and shown; no placement effect in Phase 1.                   |
| `WITH_FAT`                 | Like `WITH_FOOD`; explanation should mention a meal containing fat.   |
| `MORNING`                  | Attach to breakfast.                                                  |
| `EVENING`                  | Attach to dinner.                                                     |
| `BEDTIME`                  | Attach to bedtime.                                                    |
| `SEPARATE_FROM_CALCIUM`    | Keep N minutes away from any product containing calcium.              |
| `SEPARATE_FROM_IRON`       | Keep N minutes away from any product containing iron.                 |
| `SEPARATE_FROM_COFFEE_TEA` | Keep N minutes away from the user's coffee time (silent if no coffee). |
| `TAKE_WITH_WATER`          | Shown as a line under the dose.                                       |
| `REFRIGERATE`              | Shown as a line under the dose.                                       |
| `SUGGEST_BEDTIME`          | Never moves the dose. Offers "Move to bedtime" on Today and in More info (`informational` only). |

When several fixed-anchor rules apply to one product the engine uses this priority:
`BEDTIME` > `EVENING` > `MORNING` > meal preference (`WITH_FAT` / `WITH_FOOD` with anchors) >
plain `WITH_FOOD`. Product-level rules override ingredient-level rules with the same attribute.
A time the person picks for a dose (a pin: wake-up, breakfast, lunch, dinner or bedtime) beats
every rule, and a pinned dose never moves for a separation rule: the other product moves instead.
A medication the person adds is never moved and no rule applies to it, but the ingredient-level
separation rules of its ingredients still move the other products (an iron medication moves a
calcium supplement), so ingredient-level `SEPARATE_FROM_*` rules also matter for medications.

Products people add themselves (other brands, medications, foods) are built on their device:
ids starting with `u_`, `status` `user`, `kind` `medication` and rule ids starting with `user:`
are reserved for them and refused in this data. Their label checkboxes become product-level
rules with the severity `product_instruction` and the explanation "From your label: …".

### Severities

| Value                 | Label in the app    | Sub-label          |
| --------------------- | ------------------- | ------------------ |
| `important`           | Important           | Action required    |
| `timing_conflict`     | Timing conflict     | Action recommended |
| `consideration`       | Consideration       |                    |
| `product_instruction` | Product instruction |                    |
| `informational`       | Informational       |                    |

## New Roots Herbal alternatives (`packages/engine/data/alternatives.json`)

When a person's other-brand product is running low, the app may ask "Have you considered New
Roots Herbal's {name}?". Curated pairs come first; without one, the app computes a match from
shared ingredients. The product team hands the pairs (from the monthly other-brand report,
`docs/smartstack-phase2-setup.md` part H) to a developer, who adds one entry per pair:

```json
{
  "match": { "brand": "Other Brand", "name": "Magnesium Bisglycinate" },
  "productId": "magnesium-bisglycinate-capsules",
  "reviewStatus": "reviewed",
  "lastReviewed": "2026-11-02",
  "reviewedBy": "Product team"
}
```

- `match` is either `{ "upc": "…" }` (the other product's barcode, 8, 12 or 13 digits with a
  valid check digit) or `{ "brand", "name" }`: case and accents are ignored, and the name matches
  when the person's product name contains it ("Magnesium Bisglycinate" matches "Magnesium
  Bisglycinate 200 mg").
- `productId` is a catalogue product id; topical products are refused.
- Review fields as for rules. At most two suggestions are shown, curated ones first, never for
  medications and never a product the person already takes.
- `npm run data:validate` checks the file.

## Review workflow

1. Product team fills the sheet from the current label and licence.
2. Developer runs the importer; fixes format problems it reports.
3. Qualified reviewer checks every rule row: explanation, severity, evidence. Sets
   `review_status = reviewed`, `last_reviewed`, `reviewed_by`.
4. Developer merges the output into `packages/engine/data/`, runs `npm run data:validate`
   and `npm test`, and ships. The "More info" sheet then shows the reviewer and date instead of
   "Not yet reviewed".
