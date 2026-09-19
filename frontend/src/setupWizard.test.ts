// @ts-nocheck
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

test('setup wizard exposes Ollama and Codex setup discovery', () => {
  const api = source('./api.ts')

  assert.match(api, /export type LlmProvider = 'ollama' \| 'codex'/)
  assert.match(api, /export interface CodexSetupStatus \{[\s\S]*?authenticated: boolean[\s\S]*?login_command: string[\s\S]*?models: string\[\]/)
  assert.match(api, /export async function getSetupOllamaModels\(\): Promise<\{ models: string\[\] \}>/)
  assert.match(api, /setupRequest\('\/api\/setup\/ollama-models'\)/)
  assert.match(api, /export async function getSetupCodexStatus\(\): Promise<CodexSetupStatus>/)
  assert.match(api, /setupRequest\('\/api\/setup\/codex\/status'\)/)
})

test('setup wizard selects providers and blocks unauthenticated Codex setup', () => {
  const app = source('./App.tsx')
  const setup = source('./pages/SetupPage.tsx')

  assert.match(app, /import \{ SetupPage \} from '\.\/pages\/SetupPage'/)
  assert.match(app, /<Route path="\/setup" element=\{<SetupPage \/>\} \/>/)
  assert.match(app, /getSetupStatus\(\)/)
  assert.match(app, /<Navigate to="\/setup" replace \/>/)
  assert.match(setup, /getSetupOllamaModels/)
  assert.match(setup, /getSetupCodexStatus/)
  assert.match(setup, /provider === 'ollama' \? await getSetupOllamaModels\(\) : await getSetupCodexStatus\(\)/)
  assert.match(setup, /value="ollama"/)
  assert.match(setup, /value="codex"/)
  assert.match(setup, /codexStatus\.login_command/)
  assert.match(setup, /navigator\.clipboard\.writeText/)
  assert.match(setup, /disabled=\{isSubmitting \|\| modelsUnavailable \|\| codexUnauthenticated\}/)
  assert.match(setup, /provider,/)
  assert.match(setup, /llm_model: llmModel/)
  assert.match(setup, /highlight_model: highlightModel/)
  assert.match(setup, /vision_model: visionModel/)
  assert.doesNotMatch(setup, /openai|OpenAI|API key|apiKey|Base URL|Test connection/)
  assert.match(setup, /Owner account/)
})
