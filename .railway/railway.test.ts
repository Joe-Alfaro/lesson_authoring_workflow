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
    expect(variables(services.get('worker')).ANTHROPIC_API_KEY).toEqual({ type: 'preserve' })
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

  it('gives web and worker the same spend cap (R12) and no model key to web', async () => {
    const { services } = await compile()
    const web = variables(services.get('web'))
    const worker = variables(services.get('worker'))
    for (const name of ['SPEND_CAP_USD', 'GENERATION_SPEND_CAP_USD', 'GENERATION_MODEL']) {
      expect(web[name]).toMatchObject({ type: 'literal' })
      expect(worker[name]).toEqual(web[name])
    }
    expect(web.ANTHROPIC_API_KEY).toBeUndefined()
  })
})
