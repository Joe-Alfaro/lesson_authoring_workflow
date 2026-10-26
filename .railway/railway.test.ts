import { createRailwayContext, project, type ServiceNode, type VariableValue } from 'railway/iac'
import { describe, expect, it } from 'vitest'
import program from './railway'

async function compile() {
  const definition = await program(createRailwayContext({ environment: 'production' }), project)
  const resources = (definition.resources ?? []).flat()
  const services = new Map(
    resources
      .filter((resource): resource is ServiceNode => resource.type === 'service')
      .map((service) => [service.name, service]),
  )
  return { resources, services }
}

function variables(service: ServiceNode | undefined): Record<string, VariableValue> {
  return (service?.variables ?? {}) as Record<string, VariableValue>
}

describe('.railway/railway.ts (R31)', () => {
  it('defines web, worker, collab and one Postgres', async () => {
    const { resources, services } = await compile()
    expect([...services.keys()].sort()).toEqual(['collab', 'web', 'worker'])
    expect(resources.filter((r) => r.type === 'database')).toHaveLength(1)
  })

  it('builds every service from the one Dockerfile and starts each process', async () => {
    const { services } = await compile()
    for (const service of services.values()) {
      expect(service.build).toMatchObject({ builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' })
    }
    expect(services.get('web')?.deploy?.startCommand).toBe('node server.js')
    expect(services.get('worker')?.deploy?.startCommand).toBe('node dist/worker/main.mjs')
    expect(services.get('collab')?.deploy?.startCommand).toBe('node dist/collab/main.mjs')
  })

  it('migrates on deploy from web only, so migrations never run concurrently', async () => {
    const { services } = await compile()
    expect(services.get('web')?.deploy?.preDeployCommand).toEqual(['node dist/db/migrate_cli.mjs'])
    expect(services.get('worker')?.deploy?.preDeployCommand).toBeUndefined()
    expect(services.get('collab')?.deploy?.preDeployCommand).toBeUndefined()
  })

  it('health-checks /health and restarts on failure', async () => {
    const { services } = await compile()
    for (const service of services.values()) {
      expect(service.deploy).toMatchObject({
        healthcheckPath: '/health',
        restartPolicyType: 'ON_FAILURE',
      })
    }
  })

  it('wires DATABASE_URL to Postgres and PORT on every service', async () => {
    const { services } = await compile()
    for (const service of services.values()) {
      expect(variables(service).DATABASE_URL).toEqual({
        type: 'reference',
        resource: 'database.Postgres',
        output: 'DATABASE_URL',
      })
      expect(variables(service).PORT).toMatchObject({ type: 'literal' })
    }
  })

  it('keeps secrets out of the file and shares AUTH_SECRET between web and collab', async () => {
    const { services } = await compile()
    const web = variables(services.get('web'))
    expect(web.AUTH_SECRET).toEqual({ type: 'preserve' })
    expect(web.SEED_PASSWORD).toEqual({ type: 'preserve' })
    // AI assist runs in web; the worker reads the same key from web, so it is set once.
    expect(web.ANTHROPIC_API_KEY).toEqual({ type: 'preserve' })
    expect(variables(services.get('worker')).ANTHROPIC_API_KEY).toEqual({
      type: 'reference',
      resource: 'service.web',
      output: 'ANTHROPIC_API_KEY',
    })
    expect(variables(services.get('collab')).ANTHROPIC_API_KEY).toBeUndefined()
    expect(variables(services.get('collab')).AUTH_SECRET).toEqual({
      type: 'reference',
      resource: 'service.web',
      output: 'AUTH_SECRET',
    })
    expect(web.COLLAB_URL).toEqual({
      type: 'literal',
      value: 'wss://${{collab.RAILWAY_PUBLIC_DOMAIN}}',
    })
  })

  it('gives web and worker the same spend cap (R12) and generation queue settings', async () => {
    const { services } = await compile()
    const web = variables(services.get('web'))
    const worker = variables(services.get('worker'))
    // Both create the generation queue, so its heartbeat must match or they keep changing it.
    for (const name of [
      'SPEND_CAP_USD',
      'GENERATION_SPEND_CAP_USD',
      'GENERATION_MODEL',
      'GENERATION_HEARTBEAT_SECONDS',
    ]) {
      expect(web[name]).toMatchObject({ type: 'literal' })
      expect(worker[name]).toEqual(web[name])
    }
    expect(web.ASSIST_MODEL).toMatchObject({ type: 'literal' })
    // Only the worker's Anthropic client reads the generation effort.
    expect(worker.GENERATION_EFFORT).toMatchObject({ type: 'literal' })
    expect(web.GENERATION_EFFORT).toBeUndefined()
    expect(variables(services.get('collab')).SPEND_CAP_USD).toBeUndefined()
  })

  it('sizes every pool so the services fit well inside Postgres max_connections', async () => {
    const { services } = await compile()
    const size = (service: string, name: string): number => {
      const value = variables(services.get(service))[name]
      return value?.type === 'literal' ? Number(value.value) : NaN
    }
    // web: app pool + 1 LISTEN + pg-boss; worker: app pool + pg-boss; collab: app pool (its LISTEN
    // connection is one of the pool's clients).
    const total =
      size('web', 'DB_POOL_MAX') +
      1 +
      size('web', 'PGBOSS_POOL_MAX') +
      size('worker', 'DB_POOL_MAX') +
      size('worker', 'PGBOSS_POOL_MAX') +
      size('collab', 'DB_POOL_MAX')
    // Plus a migrate or seed run (web's pool) beside them, under Railway Postgres's default 100.
    expect(total).toBe(30)
    expect(total + size('web', 'DB_POOL_MAX')).toBeLessThanOrEqual(60)
    expect(variables(services.get('collab')).PGBOSS_POOL_MAX).toBeUndefined()
  })
})
