// @ts-nocheck
import assert from 'node:assert/strict'
import test from 'node:test'
import * as api from './api.ts'

const calls: Array<{ url: string; init?: RequestInit }> = []

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  calls.push({ url: String(input), init })
  return new Response(JSON.stringify({ ok: true, key: 'mc_live_once' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('agent pairing API uses the device-flow endpoints and payloads', async () => {
  calls.length = 0
  await api.startAgentPairing('Hermes CLI')
  await api.approveAgentPairing('ABCD-EFGH')
  await api.exchangeAgentPairing('device-secret')

  assert.deepEqual(calls.map(call => [call.url, call.init?.method, call.init?.body]), [
    ['/api/api-keys/pair/start', 'POST', JSON.stringify({ client_name: 'Hermes CLI' })],
    ['/api/api-keys/pair/approve', 'POST', JSON.stringify({ user_code: 'ABCD-EFGH' })],
    ['/api/api-keys/pair/exchange', 'POST', JSON.stringify({ device_code: 'device-secret' })],
  ])
})

test('agent info and key rotation use their dedicated endpoints', async () => {
  calls.length = 0
  await api.getAgentInfo()
  await api.rotateApiKey('key-123')

  assert.equal(calls[0].url, '/api/agent/info')
  assert.equal(calls[0].init?.credentials, 'include')
  assert.deepEqual(calls[1], {
    url: '/api/api-keys/key-123/rotate',
    init: { method: 'POST', credentials: 'include' },
  })
})
