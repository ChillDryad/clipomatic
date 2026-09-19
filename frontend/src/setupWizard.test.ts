// @ts-nocheck
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

test('setup wizard exposes first-run provider setup APIs', () => {
  const api = source('./api.ts')

  assert.match(api, /export type LlmProvider = 'ollama' \| 'openai'/)
  assert.match(api, /export async function getSetupStatus\(\)/)
  assert.match(api, /setupRequest\('\/api\/setup\/status'\)/)
  assert.match(api, /export async function setup\(payload: SetupPayload\)/)
  assert.match(api, /setupRequest\('\/api\/setup', \{[\s\S]*?method: 'POST'/)
  assert.match(api, /export async function testProvider\(settings: ProviderSettings\)/)
  assert.match(api, /setupRequest\('\/api\/setup\/test-provider', \{[\s\S]*?method: 'POST'/)
})

test('setup wizard is available before auth and gates initial routes', () => {
  const app = source('./App.tsx')
  const setup = source('./pages/SetupPage.tsx')

  assert.match(app, /import \{ SetupPage \} from '\.\/pages\/SetupPage'/)
  assert.match(app, /<Route path="\/setup" element=\{<SetupPage \/>\} \/>/)
  assert.match(app, /getSetupStatus\(\)/)
  assert.match(app, /<Navigate to="\/setup" replace \/>/)
  assert.match(setup, /http:\/\/ollama:11434\/v1/)
  assert.match(setup, /https:\/\/api\.openai\.com\/v1/)
  assert.match(setup, /Test connection/)
  assert.match(setup, /Owner account/)
})
