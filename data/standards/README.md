# Standards reference data (grade 6)

Reference data for R15 (and R3's "unknown code" warning). Each file is a JSON array of objects
with at least `{ code, framework, grade, strand, text }`; extra fields are listed below.

| File                            | Framework           | Entries | Contents                                                                                                                        |
| ------------------------------- | ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ccss_ela_grade6.json`          | `CCSS_ELA`          | 101     | CA CCSS for ELA/Literacy, grade 6: RL, RI, W, SL, L (incl. lettered sub-standards and CA additions), plus grades 6–8 RH and RST |
| `ca_eld_grade6.json`            | `CA_ELD`            | 30      | CA ELD Standards, grade 6: Part I (PI.6.1–12) and Part II (PII.6.1–7), plus lettered sub-parts                                  |
| `ca_school_library_grade6.json` | `CA_SCHOOL_LIBRARY` | 59      | Model School Library Standards, grade 6 (the outline's "CA Media Literacy Standards" column)                                    |

## Codes and fields

- **CCSS:** `RL.6.1`, `W.6.2.a`, `L.6.4.b`. Literacy in history/social studies and science is
  written for grades 6–8, so those codes are `RH.6-8.1` and `RST.6-8.1` with `grade_band: "6-8"`.
  `RL.6.8` is omitted (the document marks it "Not applicable to literature"). Extra fields:
  `strand_name`, `parent_code` (on lettered sub-standards), `ca_addition: true` where the document
  marks California additions ("CA"), `language_progressive_skill: true` where it marks Language
  Progressive Skills ("*"; the marker is removed from `text`).
- **ELD:** `ELD.PI.6.6`, `ELD.PII.6.4`; lettered sub-parts as `ELD.PI.6.6.a`. `strand` is `PI`
  or `PII`; `substrand` is e.g. `B. Interpretive`; `title` is the short heading (e.g. "Reading/
  viewing closely"). `text` is the general description from the grade 6 overview (for Part II
  this is only the heading, e.g. "Using nouns and noun phrases"; the detail is in the levels).
  `emerging`, `expanding`, `bridging` hold the proficiency-level text. On sub-parts, `text` is the
  parent description followed by the Expanding text for that letter.
- **School library:** the outline writes these as bare numbers (`2.1.a`). The data uses the
  CDE content-standards code form `LIB.6.2.1.a` and keeps the bare form in `outline_code`. The
  importer should map a bare `N.N.x` in the "CA Media Literacy Standards" column to `LIB.6.N.N.x`.

## Sources

All three are official California Department of Education (CDE) publications:

| Data           | Document                                                                                                                                                | URL                                                                 | SHA-256 of the PDF used                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| CCSS           | California Common Core State Standards: English Language Arts & Literacy in History/Social Studies, Science, and Technical Subjects (CDE, updated 2013) | https://www.cde.ca.gov/be/st/ss/documents/finalelaccssstandards.pdf | `ea32971229c9a6a40371c48fd6069efb40c71822904475ea11791ec641e5d256` |
| ELD            | California English Language Development Standards: Kindergarten Through Grade 12 (CDE, 2014)                                                            | https://www.cde.ca.gov/sp/el/er/documents/eldstndspublication14.pdf | `8d9e57db0935a3e81339fa3031b4ff07c77bcab26ad526b5f39f0f561064db52` |
| School library | Model School Library Standards for California Public Schools, Kindergarten Through Grade Twelve (CDE, adopted 2010)                                     | https://www.cde.ca.gov/be/st/ss/documents/librarystandards.pdf      | `833c69d66b87599bab672f72e0ad1786e5b58312e1df397964831546e3e945ad` |

Fetched 2026-10-25. The CCSS were checked against the CDE edition (which carries the CA
additions such as `SL.6.4.a` and `RI.6.5.a`), not the national corestandards.org text.

### License and attribution

- **CCSS:** © Copyright 2010. National Governors Association Center for Best Practices and
  Council of Chief State School Officers. All rights reserved. The Common Core State Standards
  are licensed under a public license that permits use, reproduction and distribution with this
  attribution notice (https://www.thecorestandards.org/public-license/). California additions
  are from the CDE edition above.
- **CA ELD and Model School Library Standards:** published by the California Department of
  Education, Sacramento. CDE publications may be reproduced for educational purposes with credit
  to the CDE. Reproduced here as reference data with that credit.

## Rebuilding

```sh
scripts/standards/build.sh   # needs curl, node and pdftotext (brew install poppler)
```

It downloads the three PDFs into a temporary directory, prints their SHA-256, regenerates the
JSON files and runs the verifier. The extractors read word positions from `pdftotext -bbox`
and keep only the grade 6 (or 6–8) column of the three-column layouts. Text repairs they apply:

- Line-break hyphens are removed when the halves are not both words ("dis-tinct" →
  "distinct"; "grade-level" stays).
- The ELD PDF's fonts drop the ff/fi/fl ligatures ("diferent", "profciency"); words are
  restored against `/usr/share/dict/words`.
- The ELD PDF draws "→" as a glyph that does not extract (e.g. "observe → observation");
  arrows are restored from the gap they leave, plus one fixed-text fix-up at a line end.

The sources' own wording is kept, e.g. "domain specific vocabulary" (no hyphen) in SL.6.4.a.

## Verification

```sh
node scripts/standards/verify.mjs   # exits 1 on an unexpected unresolved code
```

It parses `data/sample_unit/lesson_outline.csv`, takes every code in "Focus Standards
(assessed)", "Additional Supported CA ELA Standards", "CA Media Literacy Standards" and
"Designated ELD Standards", normalizes them like R3 (expands "RL.6.1, 6.2" to RL.6.2 and
"W.6.2.a–f" to W.6.2.a … W.6.2.f, strips " – description" from ELD entries, maps `2.1.a` to
`LIB.6.2.1.a`) and checks each against these files.

Result: 85 distinct codes, 84 resolve.

### Known unresolved codes

| Code       | Where                                | Why                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RL.6.9.a` | Focus and Additional columns, 4 rows | Not a grade 6 standard: RL.6.9 has no lettered parts in the CA CCSS. Probably meant `W.6.9.a` ("Apply grade 6 Reading standards to literature"), which the same rows also list, or plain `RL.6.9`. Kept by R3 and shown as a warning. |
