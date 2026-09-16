// @ts-nocheck
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (relativePath: string) => {
  try {
    return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  } catch {
    return ''
  }
}

test('user settings exposes Agent Access and is reachable', () => {
  const app = source('./App.tsx')
  const settings = source('./pages/UserSettingsPage.tsx')
  const navbarSettings = source('./components/layout/SettingsModal.tsx')

  assert.match(app, /path="\/settings"[\s\S]*?<UserSettingsPage/)
  assert.match(settings, /id: 'agent'/)
  assert.match(settings, /<AgentAccessSection/)
  assert.match(navbarSettings, /to="\/settings"[\s\S]*?Agent Access/)
})

test('Agent Access supports device approval and key lifecycle with one-time token warning', () => {
  const component = source('./components/settings/AgentAccessSection.tsx')

  assert.match(component, /approveAgentPairing/)
  assert.match(component, /listApiKeys/)
  assert.match(component, /revokeApiKey/)
  assert.match(component, /rotateApiKey/)
  assert.match(component, /Approve device/)
  assert.match(component, /shown only once/i)
  assert.match(component, /Copy token/)
})
