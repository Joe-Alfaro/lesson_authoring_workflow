/**
 * R29 throughput run: imports a fresh copy of the sample unit, starts a full run as author01
 * through the web app (POST /api/units/:id/generation/runs, default model and concurrency) and
 * watches it to the end. Run the production worker against the fake model (fake_model.ts) via
 * ANTHROPIC_BASE_URL and a placeholder ANTHROPIC_API_KEY, so nothing reaches a real model.
 * Method and results: docs/performance.md.
 *
 * Env: DATABASE_URL (required), LOAD_BASE_URL (http://localhost:3761), LOAD_PASSWORD
 * (demo-password), LOAD_RESULTS_FILE, LOAD_TIMEOUT_S (3600).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createPool } from '../../src/db/client'
import { importSampleUnit } from './setup'
import { env, envNumber, machine, sleep, summarize, WebSession } from './support'

const baseUrl = env('LOAD_BASE_URL', 'http://localhost:3761')
const databaseUrl = env('DATABASE_URL')
const password = env('LOAD_PASSWORD', 'demo-password')
const timeoutS = envNumber('LOAD_TIMEOUT_S', 3600)
const resultsFile = env('LOAD_RESULTS_FILE', `test-results/load/generation-${Date.now()}.json`)
const POLL_MS = 1_000

interface JobRow {
  lesson_id: string
  status: string
  attempts: number
}

async function main(): Promise<void> {
  const pool = createPool(databaseUrl)
  try {
    const unit = await importSampleUnit(pool)
    const session = new WebSession(baseUrl)
    await session.signIn('author01@example.com', password)
    const startedAt = Date.now()
    const { runId, jobCount } = await session.json<{ runId: string; jobCount: number }>(
      `/api/units/${unit.unitId}/generation/runs`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    )
    console.log(`[generation] run ${runId}: ${jobCount} lessons queued for unit ${unit.unitId}`)

    const generatingSince = new Map<string, number>()
    const durations: number[] = []
    let maxGenerating = 0
    let lastLine = ''
    let run: { status: string; model: string; cost_usd: string } | undefined
    for (;;) {
      const runResult = await pool.query<{ status: string; model: string; cost_usd: string }>(
        'SELECT status, model, cost_usd FROM generation_runs WHERE id = $1',
        [runId],
      )
      run = runResult.rows[0]
      const jobs = (
        await pool.query<JobRow>(
          'SELECT lesson_id, status, attempts FROM generation_jobs WHERE run_id = $1',
          [runId],
        )
      ).rows
      const now = Date.now()
      let generating = 0
      jobs.forEach((job) => {
        if (job.status === 'generating') {
          generating += 1
          if (!generatingSince.has(job.lesson_id)) generatingSince.set(job.lesson_id, now)
        } else if (job.status === 'generated' && generatingSince.has(job.lesson_id)) {
          durations.push(now - generatingSince.get(job.lesson_id)!)
          generatingSince.delete(job.lesson_id)
        }
      })
      maxGenerating = Math.max(maxGenerating, generating)
      const counts = jobs.reduce<Record<string, number>>((acc, job) => {
        acc[job.status] = (acc[job.status] ?? 0) + 1
        return acc
      }, {})
      const line = `${run?.status} ${JSON.stringify(counts)}`
      if (line !== lastLine) {
        console.log(`[generation] ${Math.round((now - startedAt) / 1000)}s ${line}`)
        lastLine = line
      }
      if (run && !['queued', 'running'].includes(run.status)) break
      if (now - startedAt > timeoutS * 1000) throw new Error(`run not finished after ${timeoutS} s`)
      await sleep(POLL_MS)
    }
    const wallMs = Date.now() - startedAt
    const final = await pool.query<{
      status: string
      attempts: number
      count: string
    }>(
      `SELECT status, attempts, count(*) FROM generation_jobs WHERE run_id = $1
       GROUP BY status, attempts ORDER BY status, attempts`,
      [runId],
    )
    const dbWall = await pool.query<{ seconds: number }>(
      `SELECT extract(epoch FROM finished_at - created_at)::float AS seconds
       FROM generation_runs WHERE id = $1`,
      [runId],
    )

    const results = {
      requirement: 'R29',
      machine: machine(),
      runId,
      model: run?.model,
      runStatus: run?.status,
      lessons: jobCount,
      jobs: final.rows.map((row) => ({ ...row, count: Number(row.count) })),
      maxGeneratingSeen: maxGenerating,
      wallSeconds: Math.round(wallMs / 1000),
      dbWallSeconds: Math.round(dbWall.rows[0]?.seconds ?? Number.NaN),
      perLessonMs: summarize(durations),
      meanPerLessonSeconds: durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 1000)
        : Number.NaN,
      fakeCostUsd: Number(run?.cost_usd),
    }
    mkdirSync(dirname(resultsFile), { recursive: true })
    writeFileSync(resultsFile, `${JSON.stringify(results, null, 2)}\n`)
    console.log('\n[generation] R29 results')
    console.log(JSON.stringify(results, null, 2))
    console.log(`[generation] written to ${resultsFile}`)
    const ok = run?.status === 'completed' && wallMs < 30 * 60 * 1000
    console.log(ok ? '[generation] PASS (under 30 min)' : '[generation] FAIL')
    process.exitCode = ok ? 0 : 1
  } finally {
    await pool.end()
  }
}

await main()
