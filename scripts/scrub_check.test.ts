// R35 scrub check. Contract for scripts/scrub_check.ts:
//   runScrubCheck({ cwd, termsFile?, env }) => { ok, matches: [{ file, line, termLine }], error? }
//   - terms come from termsFile, else env.SCRUB_TERMS_FILE, else <repo root>/_private/scrub_terms.txt
//   - termLine is the 1-based line number of the matched term in the terms file
//   - the CLI (npm run scrub) prints one "<file>:<line> ... #<termLine>" row per match and never
//     prints the term itself, because CI logs are public
// All tests use temp git repos and temp terms files with made-up terms, never the real terms file.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { runScrubCheck } from './scrub_check'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scriptPath = join(projectRoot, 'scripts', 'scrub_check.ts')
const tsxBin = join(projectRoot, 'node_modules', '.bin', 'tsx')

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function writeFile(root: string, relPath: string, content: string): string {
  const path = join(root, relPath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return path
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

// Creates a git repo, commits `tracked`, then writes `untracked` without adding it.
function makeRepo(tracked: Record<string, string>, untracked: Record<string, string> = {}): string {
  const repo = makeTempDir('scrub-repo-')
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  git(repo, 'config', 'commit.gpgsign', 'false')
  for (const [path, content] of Object.entries(tracked)) writeFile(repo, path, content)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'init')
  for (const [path, content] of Object.entries(untracked)) writeFile(repo, path, content)
  return repo
}

function makeTermsFile(content: string): string {
  return writeFile(makeTempDir('scrub-terms-'), 'terms.txt', content)
}

// Env with no SCRUB_TERMS_FILE unless given, so the developer's shell can't leak in.
function envWith(vars: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.SCRUB_TERMS_FILE
  return { ...env, ...vars }
}

function runCli(cwd: string, env: NodeJS.ProcessEnv) {
  const result = spawnSync(tsxBin, [scriptPath], { cwd, env, encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('runScrubCheck', () => {
  it('passes with no matches when tracked files are clean', () => {
    const repo = makeRepo({ 'README.md': 'nothing to see here\n' })
    const termsFile = makeTermsFile('zebracorp\n')

    const result = runScrubCheck({ cwd: repo, env: envWith({ SCRUB_TERMS_FILE: termsFile }) })

    expect(result.ok).toBe(true)
    expect(result.matches).toEqual([])
    expect(result.error).toBeUndefined()
  })

  it('reads terms from SCRUB_TERMS_FILE and reports file and line for each match', () => {
    const repo = makeRepo({
      'README.md': 'intro\nbuilt for zebracorp\n',
      'src/deep/notes.ts': '// one\n// two\nconst site = "quokka labs"\n',
    })
    const termsFile = makeTermsFile('zebracorp\nquokka labs\n')

    const result = runScrubCheck({ cwd: repo, env: envWith({ SCRUB_TERMS_FILE: termsFile }) })

    expect(result.ok).toBe(false)
    expect(result.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'README.md', line: 2, termLine: 1 }),
        expect.objectContaining({ file: 'src/deep/notes.ts', line: 3, termLine: 2 }),
      ]),
    )
    expect(result.matches).toHaveLength(2)
  })

  it('accepts an explicit termsFile option', () => {
    const repo = makeRepo({ 'a.txt': 'zebracorp\n' })
    const termsFile = makeTermsFile('zebracorp\n')

    const result = runScrubCheck({ cwd: repo, termsFile, env: envWith() })

    expect(result.ok).toBe(false)
    expect(result.matches).toEqual([expect.objectContaining({ file: 'a.txt', line: 1 })])
  })

  it('matches case-insensitively in both directions', () => {
    const repo = makeRepo({ 'a.md': 'Made by ZEBRACORP\n', 'b.md': 'see Quokka Labs\n' })
    const termsFile = makeTermsFile('ZebraCorp\nQUOKKA labs\n')

    const result = runScrubCheck({ cwd: repo, env: envWith({ SCRUB_TERMS_FILE: termsFile }) })

    expect(result.ok).toBe(false)
    expect(result.matches.map((m) => m.file).sort()).toEqual(['a.md', 'b.md'])
  })

  it('treats terms as fixed strings, not patterns', () => {
    const repo = makeRepo({ 'a.md': 'zebraXcorp\n' })
    const termsFile = makeTermsFile('zebra.corp\n')

    const result = runScrubCheck({ cwd: repo, env: envWith({ SCRUB_TERMS_FILE: termsFile }) })

    expect(result.ok).toBe(true)
    expect(result.matches).toEqual([])
  })

  it('searches only git-tracked files, so untracked and ignored files with a term pass', () => {
    const repo = makeRepo(
      { '.gitignore': 'ignored/\n', 'README.md': 'clean\n' },
      { 'scratch.md': 'zebracorp\n', 'ignored/secret.md': 'zebracorp\n' },
    )
    const termsFile = makeTermsFile('zebracorp\n')

    const result = runScrubCheck({ cwd: repo, env: envWith({ SCRUB_TERMS_FILE: termsFile }) })

    expect(result.ok).toBe(true)
    expect(result.matches).toEqual([])
  })

  it('ignores blank lines, whitespace-only lines and # comments in the terms file', () => {
    // "clean" and "fine" appear in tracked files but only inside comments in the terms file.
    const repo = makeRepo({ 'README.md': 'clean and fine\n', 'b.md': 'zebracorp\n' })
    const termsFile = makeTermsFile('# clean\n\n   \n  # fine\nzebracorp\n\n')

    const result = runScrubCheck({ cwd: repo, env: envWith({ SCRUB_TERMS_FILE: termsFile }) })

    expect(result.ok).toBe(false)
    expect(result.matches).toEqual([
      expect.objectContaining({ file: 'b.md', line: 1, termLine: 5 }),
    ])
  })

  it('falls back to <repo root>/_private/scrub_terms.txt when SCRUB_TERMS_FILE is unset', () => {
    const repo = makeRepo({ 'README.md': 'built for zebracorp\n' })
    // The private terms file stays untracked, as in the real project.
    writeFile(repo, '_private/scrub_terms.txt', 'zebracorp\n')

    const result = runScrubCheck({ cwd: repo, env: envWith() })

    expect(result.ok).toBe(false)
    expect(result.matches).toEqual([expect.objectContaining({ file: 'README.md', line: 1 })])
  })

  it('resolves the fallback from the repo root when run from a subdirectory', () => {
    const repo = makeRepo({ 'README.md': 'zebracorp\n', 'src/index.ts': 'export {}\n' })
    writeFile(repo, '_private/scrub_terms.txt', 'zebracorp\n')

    const result = runScrubCheck({ cwd: join(repo, 'src'), env: envWith() })

    expect(result.ok).toBe(false)
    expect(result.matches).toEqual([expect.objectContaining({ file: 'README.md', line: 1 })])
  })

  it('fails with a clear message when SCRUB_TERMS_FILE points to a missing file', () => {
    const repo = makeRepo({ 'README.md': 'clean\n' })
    const missing = join(makeTempDir('scrub-terms-'), 'nope.txt')

    const result = runScrubCheck({ cwd: repo, env: envWith({ SCRUB_TERMS_FILE: missing }) })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/terms file/i)
    expect(result.error).toContain(missing)
  })

  it('fails with a clear message when unset and the private terms file is missing', () => {
    const repo = makeRepo({ 'README.md': 'clean\n' })

    const result = runScrubCheck({ cwd: repo, env: envWith() })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/terms file/i)
    expect(result.error).toContain('scrub_terms.txt')
  })
})

describe('scrub check CLI', () => {
  it('exits zero when tracked files are clean', () => {
    const repo = makeRepo({ 'README.md': 'clean\n' })
    const termsFile = makeTermsFile('zebracorp\n')

    const { status } = runCli(repo, envWith({ SCRUB_TERMS_FILE: termsFile }))

    expect(status).toBe(0)
  })

  it('exits non-zero and lists file:line with the term line number (#n) for each match', () => {
    const repo = makeRepo({
      'README.md': 'intro\nbuilt for zebracorp\n',
      'src/notes.ts': '// one\n// two\nconst site = "quokka labs"\n',
    })
    const termsFile = makeTermsFile('# header\nzebracorp\nquokka labs\n')

    const { status, output } = runCli(repo, envWith({ SCRUB_TERMS_FILE: termsFile }))

    expect(status).not.toBe(0)
    expect(output).toMatch(/README\.md:2\b.*#2\b/)
    expect(output).toMatch(/src\/notes\.ts:3\b.*#3\b/)
  })

  it('masks terms: never prints a banned term or the matched line, since CI logs are public', () => {
    const repo = makeRepo({ 'README.md': 'built for ZebraCorp today\n' })
    const termsFile = makeTermsFile('zebracorp\nquokka labs\n')

    const { status, output } = runCli(repo, envWith({ SCRUB_TERMS_FILE: termsFile }))

    expect(status).not.toBe(0)
    expect(output.toLowerCase()).not.toContain('zebracorp')
    expect(output.toLowerCase()).not.toContain('quokka labs')
  })

  it('exits non-zero with a clear message when the terms file is missing', () => {
    const repo = makeRepo({ 'README.md': 'clean\n' })

    const { status, output } = runCli(repo, envWith())

    expect(status).not.toBe(0)
    expect(output).toMatch(/terms file/i)
  })
})

describe('quality gate wiring (R32)', () => {
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }

  it('defines npm run scrub to run scripts/scrub_check.ts', () => {
    expect(pkg.scripts.scrub).toMatch(/scripts\/scrub_check\.ts/)
  })

  it('includes the scrub step in npm run check', () => {
    expect(pkg.scripts.check).toMatch(/npm run scrub\b/)
  })
})
