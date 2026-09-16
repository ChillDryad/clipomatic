// @ts-nocheck
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

test('Clip Studio is the primary route and new-project destination', () => {
  const app = source('./App.tsx')
  const navbar = source('./components/layout/Navbar.tsx')
  const dashboard = source('./pages/DashboardPage.tsx')
  const home = source('./pages/HomePage.tsx')

  assert.match(app, /path="\/"[\s\S]*?<Navigate to="\/clip-studio" replace/)
  assert.match(navbar, /to="\/clip-studio"[\s\S]*?New Project/)
  assert.match(dashboard, /to="\/clip-studio"[\s\S]*?New Project/)
  assert.match(home, /: "\/clip-studio"/)
  assert.match(home, /Import source for Clip Studio/)
})

test('legacy vertical subtitle rendering is clearly opt-in', () => {
  const pipeline = source('./pages/PipelinePage.tsx')
  const clipStudio = source('./pages/ClipStudioPage.tsx')

  assert.match(pipeline, /Legacy vertical renderer \(opt-in\)/)
  assert.match(clipStudio, /source-quality default/i)
  assert.match(clipStudio, /Legacy vertical.*opt-in/i)
  assert.match(clipStudio, /to="\/pipeline"[\s\S]*?Import a source/)
})
