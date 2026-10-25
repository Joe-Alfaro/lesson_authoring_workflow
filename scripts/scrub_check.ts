// R35 scrub check: fails when any git-tracked file contains a banned term.
// Output names the file, line and the term's line number in the terms file, never the term itself,
// because CI logs are public.
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface ScrubMatch {
  file: string
  line: number
  /** 1-based line number of the matched term in the terms file. */
  termLine: number
}

export interface ScrubResult {
  ok: boolean
  matches: ScrubMatch[]
  error?: string
}

export interface ScrubOptions {
  cwd: string
  termsFile?: string
  env: NodeJS.ProcessEnv
}

interface Term {
  needle: string
  termLine: number
}

// Same heuristic as git: a NUL byte in the first 8000 bytes means binary.
const BINARY_SNIFF_BYTES = 8000

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function readTerms(path: string): Term[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((raw, index) => ({ needle: raw.trim().toLowerCase(), termLine: index + 1 }))
    .filter((term) => term.needle !== '' && !term.needle.startsWith('#'))
}

function isBinary(content: Buffer): boolean {
  return content.subarray(0, BINARY_SNIFF_BYTES).includes(0)
}

function scanFile(root: string, file: string, terms: Term[]): ScrubMatch[] {
  const path = join(root, file)
  // Skips tracked paths that are deleted in the work tree, symlinks and submodules.
  if (!existsSync(path) || !lstatSync(path).isFile()) return []
  const content = readFileSync(path)
  if (isBinary(content)) return []

  return content
    .toString('utf8')
    .toLowerCase()
    .split('\n')
    .flatMap((text, index) =>
      terms
        .filter((term) => text.includes(term.needle))
        .map((term) => ({ file, line: index + 1, termLine: term.termLine })),
    )
}

export function runScrubCheck({ cwd, termsFile, env }: ScrubOptions): ScrubResult {
  const root = git(cwd, ['rev-parse', '--show-toplevel']).trim()
  const termsPath = resolve(
    cwd,
    termsFile ?? env.SCRUB_TERMS_FILE ?? join(root, '_private', 'scrub_terms.txt'),
  )
  if (!existsSync(termsPath)) {
    return {
      ok: false,
      matches: [],
      error: `Scrub terms file not found: ${termsPath}. Set SCRUB_TERMS_FILE or create it.`,
    }
  }

  const terms = readTerms(termsPath)
  const files = git(root, ['ls-files', '-z']).split('\0').filter(Boolean)
  const matches = files.flatMap((file) => scanFile(root, file, terms))
  return { ok: matches.length === 0, matches }
}

function main(): void {
  const result = runScrubCheck({ cwd: process.cwd(), env: process.env })
  if (result.error) {
    console.error(`scrub: ${result.error}`)
    process.exitCode = 1
    return
  }
  if (result.ok) {
    console.log('scrub: no banned terms in tracked files')
    return
  }
  result.matches.forEach((match) => {
    console.error(`${match.file}:${match.line} matches banned term #${match.termLine}`)
  })
  console.error(`scrub: ${result.matches.length} match(es); terms are masked, see the terms file`)
  process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
}
