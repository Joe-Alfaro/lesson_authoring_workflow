#!/usr/bin/env bash
# Rebuilds data/standards/*.json from the official California Department of Education PDFs.
# Needs curl, node and poppler's pdftotext. Downloads go to a fresh temp dir outside the repo.
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
out="$repo/data/standards"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

fetch() { curl -fsSL --retry 3 -m 300 -o "$scratch/$1" "$2"; }
fetch ccss.pdf https://www.cde.ca.gov/be/st/ss/documents/finalelaccssstandards.pdf
fetch eld.pdf https://www.cde.ca.gov/sp/el/er/documents/eldstndspublication14.pdf
fetch library.pdf https://www.cde.ca.gov/be/st/ss/documents/librarystandards.pdf
(cd "$scratch" && shasum -a 256 ccss.pdf eld.pdf library.pdf)

node "$repo/scripts/standards/extract_ccss.mjs" "$scratch/ccss.pdf" "$out/ccss_ela_grade6.json"
node "$repo/scripts/standards/extract_eld.mjs" "$scratch/eld.pdf" "$out/ca_eld_grade6.json"
node "$repo/scripts/standards/extract_library.mjs" "$scratch/library.pdf" "$out/ca_school_library_grade6.json"
node "$repo/scripts/standards/verify.mjs"
