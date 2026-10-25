// Shared helpers for extracting standards text from the official CDE PDFs.
// Requires poppler's `pdftotext` on PATH (brew install poppler / apt install poppler-utils).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/** Returns the words on one PDF page (1-based) with their bounding boxes. */
export function pageWords(pdfPath, page) {
  const html = execFileSync(
    "pdftotext",
    ["-bbox", "-f", String(page), "-l", String(page), pdfPath, "-"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 },
  );
  const words = [];
  const re = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;
  for (const m of html.matchAll(re)) {
    const [xMin, yMin, xMax, yMax] = m.slice(1, 5).map(Number);
    const text = decodeEntities(m[5]);
    words.push({ xMin, yMin, xMax, yMax, text });
  }
  return words;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Groups words into lines (top to bottom), each line's words sorted left to right. */
export function toLines(words, tolerance = 3) {
  const sorted = [...words].sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin);
  const lines = [];
  for (const w of sorted) {
    const line = lines.find((l) => Math.abs(l.y - w.yMin) <= tolerance);
    if (line) line.words.push(w);
    else lines.push({ y: w.yMin, words: [w] });
  }
  for (const l of lines) l.words.sort((a, b) => a.xMin - b.xMin);
  return lines.sort((a, b) => a.y - b.y);
}

/** Finds the first word sequence matching `phrase` and returns its words. */
export function findPhrase(words, phrase) {
  const parts = phrase.split(" ");
  for (const line of toLines(words)) {
    const ws = line.words;
    for (let i = 0; i + parts.length <= ws.length; i++) {
      if (parts.every((p, j) => ws[i + j].text === p)) return ws.slice(i, i + parts.length);
    }
  }
  return null;
}

let dictionary;
/** Lowercase English word list used to repair hyphenation and dropped ligatures. */
export function dict() {
  if (!dictionary) {
    const path = "/usr/share/dict/words";
    if (!existsSync(path)) throw new Error(`${path} is required for text repair`);
    dictionary = new Set(readFileSync(path, "utf8").toLowerCase().split("\n"));
  }
  return dictionary;
}

function isWord(w) {
  const d = dict();
  const lw = w.toLowerCase();
  // Accept simple inflections the word list does not carry.
  return (
    d.has(lw) ||
    (lw.endsWith("s") && d.has(lw.slice(0, -1))) ||
    (lw.endsWith("es") && d.has(lw.slice(0, -2))) ||
    (lw.endsWith("ed") && (d.has(lw.slice(0, -2)) || d.has(lw.slice(0, -1)))) ||
    (lw.endsWith("ing") && (d.has(lw.slice(0, -3)) || d.has(lw.slice(0, -3) + "e"))) ||
    (lw.endsWith("ly") && d.has(lw.slice(0, -2))) ||
    (/(.)\1ed$/.test(lw) && d.has(lw.slice(0, -3))) ||
    (/(.)\1ing$/.test(lw) && d.has(lw.slice(0, -4)))
  );
}

/** Joins wrapped lines into one paragraph, removing line-break hyphens inside words. */
export function joinLines(lines) {
  let out = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = out.match(/([A-Za-z]+)-$/);
    const next = line.match(/^([a-z]+)/);
    // "multi-/media" and "embed-/ded" are line-break hyphens; "grade-/level" (two words) is not.
    const joined = m && next ? repairLigatures(m[1] + next[1]) : "";
    if (m && next && (isWord(joined) || !(isWord(repairLigatures(m[1])) && isWord(repairLigatures(next[1]))))) {
      out = out.slice(0, -1) + line;
    } else if (out.endsWith("-") || out.endsWith("/") || out === "") {
      out += line;
    } else {
      out += " " + line;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * The ELD PDF's fonts drop the "ff", "fi", "fl", "ffi" ligatures (e.g. "diferent",
 * "profciency", "refect"). Restore them where the repaired word is in the dictionary.
 */
export function repairLigatures(text) {
  return text.replace(/[A-Za-z]*f[A-Za-z]*/g, (word) => {
    // Real but rare words that the dictionary would otherwise accept unrepaired.
    if (word.toLowerCase() === "refect") return word[0] + "eflect";
    if (isWord(word)) return word;
    for (let i = 0; i < word.length; i++) {
      if (word[i] !== "f" && word[i] !== "F") continue;
      for (const insert of ["f", "i", "l", "fi"]) {
        const candidate = word.slice(0, i + 1) + insert + word.slice(i + 1);
        if (isWord(candidate)) return candidate;
      }
    }
    return word;
  });
}
