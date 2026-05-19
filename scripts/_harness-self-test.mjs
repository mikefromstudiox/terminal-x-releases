// scripts/_harness-self-test.mjs — sanity check for lib/audit-harness.js.
// Run: NODE_OPTIONS=--use-system-ca node scripts/_harness-self-test.mjs
import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

const { createHarness } = await import('../lib/audit-harness.js')

const argv = process.argv.slice(2)
const arg = (k) => { const m = argv.find(a => a.startsWith(`--${k}=`)); return m ? m.split('=')[1] : undefined }

const h = createHarness({
  name: 'harness-self-test',
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  anonKey: process.env.SUPABASE_ANON_KEY,
  accessToken: process.env.SUPABASE_ACCESS_TOKEN,
  jsonOutput: (process.env.JSON === 'true' || process.env.JSON === '1'),
  filter: arg('filter'),
  only: arg('only'),
  parallel: Number(arg('parallel') || 1),
  failFast: false,
})

h.scenario('mock.passing.one', async (ctx) => {
  ctx.cleanup(() => console.log('     [cleanup] mock.passing.one A (registered first, runs last)'))
  ctx.cleanup(() => console.log('     [cleanup] mock.passing.one B (registered last, runs first)'))
  ctx.assert(1 + 1 === 2, '1+1=2')
  ctx.assertEq(ctx.uuid().length, 36, 'uuid v4 length')
})

h.scenario('mock.passing.two', async (ctx) => {
  const t = ctx.timing()
  ctx.assert(typeof t.ms === 'number', 'timing returns ms')
  ctx.assertNotNull(ctx.env().supabaseUrl, 'env.supabaseUrl')
})

h.scenario('mock.passing.three', async (ctx) => {
  await ctx.expectError(async () => { throw new Error('boom-xyz') }, /boom-/, 'expectError works')
  ctx.assertSchema({ a: 1, b: 2 }, ['a', 'b'], 'schema ok')
})

h.scenario('mock.failing.one', async (ctx) => {
  ctx.cleanup(() => console.log('     [cleanup] mock.failing.one ran even after fail'))
  ctx.assertEq(2 + 2, 5, 'demonstrating a failure: 2+2 != 5')
})

h.scenario('mock.skipped.one', async (ctx) => {
  ctx.skip('intentional skip for self-test')
})

const result = await h.run()
process.exit(result.failed > 0 ? 1 : 0)
