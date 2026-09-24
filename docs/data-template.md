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
| `rule_explanations_en`  | if rules | `ATTRIBUTE=Plain-language explanation` separated by `;`. One per rule listed above. This is the text under "Why?".                                                          |
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

When several fixed-anchor rules apply to one product the engine uses this priority:
`BEDTIME` > `EVENING` > `MORNING` > meal preference (`WITH_FAT` / `WITH_FOOD` with anchors) >
plain `WITH_FOOD`. Product-level rules override ingredient-level rules with the same attribute.

### Severities

| Value                 | Label in the app    | Sub-label          |
| --------------------- | ------------------- | ------------------ |
| `important`           | Important           | Action required    |
| `timing_conflict`     | Timing conflict     | Action recommended |
| `consideration`       | Consideration       |                    |
| `product_instruction` | Product instruction |                    |
| `informational`       | Informational       |                    |

## Review workflow

1. Product team fills the sheet from the current label and licence.
2. Developer runs the importer; fixes format problems it reports.
3. Qualified reviewer checks every rule row: explanation, severity, evidence. Sets
   `review_status = reviewed`, `last_reviewed`, `reviewed_by`.
4. Developer merges the output into `packages/engine/data/`, runs `npm run data:validate`
   and `npm test`, and ships. The "Why?" sheet then shows the reviewer and date instead of
   "Not yet reviewed".
