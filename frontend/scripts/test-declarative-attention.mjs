/** Uses our existing TypeScript dependency; no browser or model is required. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lessons/declarative-attention/simulation.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText
const sim = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const pod = JSON.parse(readFileSync(new URL('../../backend/app/pods/declarative-attention.json', import.meta.url), 'utf8'))
const config = pod.scene.params
const frozenConfig = JSON.stringify(config)
let count = 0
function test(name, run) { run(); count++; console.log(`PASS ${name}`) }
const prefilled = { ...sim.initialState(), stage: 'prefill' }
const mode = (state, value, chunks = []) => sim.applyCommand(state, { op: 'daMode', args: { mode: value, chunks } }, config)
const decode = state => sim.applyCommand(state, { op: 'daDecode', args: { text: 'test' } }, config)

test('empty GPU has no resident KV and cannot decode', () => {
  const state = sim.initialState(); assert.equal(sim.residentBytes(state, config), 0); assert.equal(decode(state).events.length, 0)
})
test('byte formula includes both K and V', () => assert.equal(sim.bytesPerToken(config), 4096))
test('global reads full context', () => assert.equal(sim.nextRead(prefilled, config).fraction, 1))
test('focus reads scaffold + selected chunk', () => {
  const read = sim.nextRead(mode(prefilled, 'focus', [3]), config)
  assert.equal(read.readTokens, 256 + 2048); assert.deepEqual(read.chunkIds, [3])
})
test('local retains scaffold and prior response', () => {
  const state = mode({ ...prefilled, responseTokens: 12 }, 'local')
  assert.equal(sim.nextRead(state, config).readTokens, 268)
})
test('global and local with no chunks keep the focus selection', () => {
  const focused = mode(prefilled, 'focus', [2, 3])
  for (const value of ['global', 'local']) {
    const state = mode(focused, value)
    assert.deepEqual(state.focusedChunks, [2, 3])
    assert.deepEqual(mode(state, 'focus', state.focusedChunks).focusedChunks, [2, 3])
  }
})
test('masking never changes resident bytes', () => {
  const size = sim.residentBytes(prefilled, config)
  for (const state of [mode(prefilled, 'focus', [3]), mode(prefilled, 'local'), mode(prefilled, 'global')]) assert.equal(sim.residentBytes(state, config), size)
})
test('decode appends one token after computing read event', () => {
  const next = decode(prefilled)
  assert.equal(next.responseTokens, 1); assert.equal(next.events[0].responseTokens, 0)
  assert.equal(sim.residentBytes(next, config) - sim.residentBytes(prefilled, config), 4096)
})
test('multiple selected chunks, no duplicates', () => {
  const read = sim.nextRead(mode(prefilled, 'focus', [1, 3, 3]), config)
  assert.equal(read.readTokens, 4352); assert.deepEqual(read.chunkIds, [1, 3])
})
test('unknown-only focus selection is rejected', () => assert.deepEqual(mode(prefilled, 'focus', [99]), prefilled))
test('baseline includes growing response at same position', () => {
  const before = sim.nextRead(prefilled, config); const after = sim.nextRead(decode(prefilled), config)
  assert.equal(after.fullTokens - before.fullTokens, 1)
})
test('illustrative duration decreases with reads', () => {
  assert.ok(sim.nextRead(mode(prefilled, 'local'), config).durationMs < sim.nextRead(mode(prefilled, 'focus', [3]), config).durationMs)
  assert.ok(sim.nextRead(mode(prefilled, 'focus', [3]), config).durationMs < sim.nextRead(prefilled, config).durationMs)
})
test('all authored beats replay deterministically', () => {
  const a = sim.replayThrough(pod.narration, 10, config); const b = sim.replayThrough(pod.narration, 10, config)
  assert.deepEqual(a, b); assert.equal(a.events.length, 5); assert.equal(a.mode, 'local')
})
test('backtracking to prefill clears generated response', () => assert.equal(sim.replayThrough(pod.narration, 3, config).responseTokens, 0))
test('reducer does not mutate prior state or chunk definitions', () => {
  const before = JSON.stringify(prefilled); decode(mode(prefilled, 'focus', [2]))
  assert.equal(JSON.stringify(prefilled), before); assert.equal(JSON.stringify(config), frozenConfig)
})
test('exploration is bounded', () => {
  let state = prefilled; for (let i = 0; i < 140; i++) state = decode(state)
  assert.equal(state.events.length, 128)
})
console.log(`${count} simulation checks passed`)
