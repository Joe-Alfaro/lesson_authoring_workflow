// Railway Infrastructure as Code for the hosted demo (R31, D-042). The owner applies it with
// `railway config plan` / `railway config apply`; agents never do. Secrets are never in this
// file: `preserve()` keeps the value the owner sets in Railway. Setup steps: docs/deploy.md.
import { defineRailway, postgres, preserve, service } from 'railway/iac'

const DOCKERFILE = { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' } as const

/** Every service: health check on /health (200 only when Postgres answers), restart on crash. */
const DEPLOY = {
  healthcheckPath: '/health',
  healthcheckTimeout: 120,
  restartPolicyType: 'ON_FAILURE',
  restartPolicyMaxRetries: 10,
} as const

// R12 spend guard for a public URL. The web app checks it when a run starts, the worker before
// every job. SPEND_CAP_USD is the total for this database across all runs; raise it on purpose.
const GENERATION_ENV = {
  SPEND_CAP_USD: '3',
  GENERATION_SPEND_CAP_USD: '1',
  GENERATION_MODEL: 'claude-haiku-5-5',
  GENERATION_CONCURRENCY: '2',
  GENERATION_MAX_ATTEMPTS: '2',
  GENERATION_EFFORT: 'medium',
}

export default defineRailway((_ctx, project) => {
  const db = postgres('Postgres')

  const web = service('web', {
    build: DOCKERFILE,
    deploy: { ...DEPLOY, startCommand: 'node server.js' },
    // The only service that migrates, so two deploys never migrate at once.
    preDeploy: 'node dist/db/migrate_cli.mjs',
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      PORT: '3000',
      AUTH_SECRET: preserve(),
      SEED_PASSWORD: preserve(),
      // The browser's WebSocket URL for the editor; resolved by Railway at deploy time.
      COLLAB_URL: 'wss://${{collab.RAILWAY_PUBLIC_DOMAIN}}',
      ...GENERATION_ENV,
    },
  })

  const worker = service('worker', {
    build: DOCKERFILE,
    // Lets pg-boss finish or release in-flight jobs on redeploy.
    deploy: { ...DEPLOY, startCommand: 'node dist/worker/main.mjs', drainingSeconds: 30 },
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      PORT: '4100',
      ANTHROPIC_API_KEY: preserve(),
      ...GENERATION_ENV,
    },
  })

  const collab = service('collab', {
    build: DOCKERFILE,
    // Lets Hocuspocus store open documents before the container stops.
    deploy: { ...DEPLOY, startCommand: 'node dist/collab/main.mjs', drainingSeconds: 30 },
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      PORT: '4200',
      // Collab tokens are signed by web, so collab must verify with the same secret.
      AUTH_SECRET: web.env.AUTH_SECRET,
    },
  })

  return project('lesson-authoring-workflow', { resources: [db, web, worker, collab] })
})
