// @ts-nocheck
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

test('setup wizard exposes first-run Ollama model discovery', () => {
  const api = source('./api.ts')

  assert.match(api, /export type LlmProvider = 'ollama' \| 'openai'/)
  assert.match(api, /export async function getSetupStatus\(\)/)
  assert.match(api, /setupRequest\('\/api\/setup\/status'\)/)
  assert.match(api, /export async function getSetupOllamaModels\(\): Promise<\{ models: string\[\] \}>/)
  assert.match(api, /setupRequest\('\/api\/setup\/ollama-models'\)/)
  assert.match(api, /export async function setup\(payload: SetupPayload\)/)
  assert.match(api, /setupRequest\('\/api\/setup', \{[\s\S]*?method: 'POST'/)
})

test('setup wizard is available before auth and configures only local Ollama', () => {
  const app = source('./App.tsx')
  const setup = source('./pages/SetupPage.tsx')

  assert.match(app, /import \{ SetupPage \} from '\.\/pages\/SetupPage'/)
  assert.match(app, /<Route path="\/setup" element=\{<SetupPage \/>\} \/>/)
  assert.match(app, /getSetupStatus\(\)/)
  assert.match(app, /<Navigate to="\/setup" replace \/>/)
  assert.match(setup, /getSetupOllamaModels/)
  assert.match(setup, /http:\/\/ollama:11434\/v1/)
  assert.match(setup, /<select/)
  assert.match(setup, /Refresh models/)
  assert.match(setup, /ollama pull/)
  assert.match(setup, /provider: 'ollama'/)
  assert.match(setup, /base_url: 'http:\/\/ollama:11434\/v1'/)
  assert.match(setup, /llm_model: llmModel/)
  assert.match(setup, /highlight_model: highlightModel/)
  assert.match(setup, /vision_model: visionModel/)
  assert.doesNotMatch(setup, /openai|OpenAI|API key|apiKey|Base URL|Test connection/)
  assert.match(setup, /Owner account/)
})
