import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Transpile the lesson's small dependency graph in memory, without DOM, server or network.
const base = new URL('../src/lessons/paged-attention/', import.meta.url)
const cache = new Map()
function moduleUrl(url) {
  if (cache.has(url.href)) return cache.get(url.href)
  let code = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  code = code.replace(
    /from ['"](\.\.?\/.+?)['"]/g,
    (_, path) => `from '${moduleUrl(new URL(path + '.ts', url))}'`,
  )
  const result = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  cache.set(url.href, result)
  return result
}
const sim = await import(moduleUrl(new URL('simulation.ts', base)))
const { LessonPlayback } = await import(moduleUrl(new URL('playback.ts', base)))
const geometry = await import(moduleUrl(new URL('geometry.ts', base)))
const { validateCommands, tutorScene } = await import(moduleUrl(new URL('tutor.ts', base)))
const { CHECKPOINTS } = await import(moduleUrl(new URL('checkpoints.ts', base)))
const pod = JSON.parse(
  readFileSync(new URL('../../backend/app/pods/paged-attention.json', import.meta.url), 'utf8'),
)
const config = pod.scene.params
const pool = (mode = 'contiguous') => ({ stage: 'pool', mode, log: [] })
const run = (state, ...commands) =>
  commands.reduce((current, command) => sim.applyCommand(current, command, config), state)
const admit = (request) => ({ op: 'paAdmit', args: { request } })
const finish = (request) => ({ op: 'paFinish', args: { request } })
const decode = { op: 'paDecode', args: {} }
const layout = (state) => sim.layoutOf(state, config)
const beatIndex = (id) => pod.narration.findIndex((beat) => beat.id === id)
const atBeat = (id) => sim.replayThrough(pod.narration, beatIndex(id), config)
const seq = (state, id) => layout(state).sequences.find((s) => s.id === id)
const instant = async () => {}

test('one OPT-13B token of KV is 800 KB, as in the paper', () => {
  assert.equal(sim.kvBytesPerToken(config), 800 * 1024)
})
test('contiguous chunks reserve the maximum length up front', () => {
  const state = run(pool(), admit('A'))
  const { stats } = layout(state)
  assert.equal(stats.tokens, 7)
  // A will write 5 more tokens (reserved); the rest of its 20 slots never fill.
  assert.equal(stats.reserved, 5)
  assert.equal(stats.internal, 8)
})
test('the waste chapter shows all three kinds of waste and a waiting request', () => {
  const state = atBeat('waste')
  const { stats, status } = layout(state)
  assert.equal(status.D, 'waiting')
  assert.equal(stats.external, 24, '24 free slots, but no 16 in a row')
  assert.equal(stats.free, 0)
  assert.ok(stats.reserved > 0 && stats.internal > 0)
  assert.ok(stats.utilization > 0.15 && stats.utilization < 0.4)
})
test('paging the same workload fits the request contiguous allocation left waiting', () => {
  const contiguous = atBeat('waste')
  const paged = sim.applyCommand(contiguous, { op: 'paMode', args: { mode: 'paged' } }, config)
  assert.deepEqual(paged.log, contiguous.log)
  assert.equal(layout(paged).status.D, 'running')
  assert.equal(layout(paged).stats.external, 0)
  assert.ok(layout(paged).stats.utilization > layout(contiguous).stats.utilization)
})
test('block tables follow the paper: A maps to 7 and 1, then gets 3 on demand', () => {
  assert.deepEqual(seq(atBeat('paged'), 'A').blocks, [7, 1])
  assert.deepEqual(seq(atBeat('table'), 'A').blocks, [7, 1])
  assert.deepEqual(seq(atBeat('allocate'), 'A').blocks, [7, 1, 3])
})
test('paged waste stays inside each sequence’s last block', () => {
  const state = atBeat('batch')
  const { stats, sequences } = layout(state)
  assert.equal(stats.external, 0)
  assert.ok(stats.reserved + stats.internal < sequences.length * config.block_size)
})
test('parallel samples share prompt blocks with a reference count', () => {
  const state = atBeat('share')
  const e1 = seq(state, 'E1')
  const e2 = seq(state, 'E2')
  assert.deepEqual(e1.blocks, e2.blocks)
  for (const id of e1.blocks) assert.equal(layout(state).blocks[id].refs, 2)
})
test('copy-on-write copies only the shared last block', () => {
  const before = atBeat('share')
  const after = atBeat('cow')
  const { effects } = layout(after)
  assert.equal(effects.copies.length, 1)
  const [prompt, shared] = seq(before, 'E1').blocks
  assert.deepEqual(effects.copies[0].from, shared)
  assert.equal(seq(after, 'E1').blocks[0], prompt, 'the full prompt block stays shared')
  assert.equal(seq(after, 'E2').blocks[1], shared, 'E2 writes in place once unshared')
  assert.equal(layout(after).blocks[prompt].refs, 2)
  assert.equal(layout(after).blocks[shared].refs, 1)
})
test('an exhausted pool preempts the latest arrival and swaps it to CPU', () => {
  const state = atBeat('preempt')
  const view = layout(state)
  assert.equal(view.status.F, 'swapped')
  assert.deepEqual(view.effects.swapOut.map((s) => s.request), ['F'])
  assert.equal(view.swappedBlocks.F, 5)
  assert.equal(seq(state, 'D').blocks.length, 3, 'D got the block it needed')
})
test('freeing memory swaps the preempted request back in', () => {
  const view = layout(atBeat('resume'))
  assert.equal(view.status.F, 'running')
  assert.equal(view.effects.swapIn[0].request, 'F')
  assert.equal(seq(atBeat('resume'), 'F').tokens.length, 20)
})
test('first come, first served: nobody jumps a preempted request', () => {
  const small = { id: 'G', prompt: ['hi'], outputs: [['there']], max_tokens: 4, color: '#ffffff' }
  const withG = { ...config, requests: [...config.requests, small] }
  const step = (state, command) => sim.applyCommand(state, command, withG)
  let state = atBeat('preempt')
  // G would fit in the free blocks, but F was preempted first.
  state = step(state, admit('G'))
  assert.equal(sim.layoutOf(state, withG).status.G, 'waiting')
  state = step(state, finish('A'))
  const view = sim.layoutOf(state, withG)
  assert.deepEqual(view.effects.swapIn.map((s) => s.request), ['F'])
  assert.equal(view.status.G, 'running', 'G starts once F is back')
})
test('workload commands are ignored when they cannot apply', () => {
  const empty = sim.initialState()
  assert.equal(sim.applyCommand(empty, admit('A'), config), empty, 'no pool yet')
  const state = run(pool(), admit('A'))
  assert.equal(sim.applyCommand(state, admit('A'), config), state, 'already admitted')
  assert.equal(sim.applyCommand(state, finish('B'), config), state, 'never arrived')
  assert.equal(sim.applyCommand(state, admit('Z'), config), state, 'unknown request')
  const done = run(pool(), admit('C'), decode)
  assert.equal(sim.canDecode(done, config), false)
  assert.equal(sim.applyCommand(done, decode, config), done, 'nothing left to write')
})
test('opening the pool empties the workload; switching allocator keeps it', () => {
  const state = run(pool(), admit('A'), decode)
  assert.equal(run(state, { op: 'paStage', args: { stage: 'pool' } }).log.length, 0)
  assert.equal(run(state, { op: 'paMode', args: { mode: 'paged' } }).log.length, 2)
  assert.deepEqual(run(state, { op: 'paStage', args: { stage: 'empty' } }), sim.initialState())
})
test('every slot is accounted for exactly once', () => {
  for (let i = 0; i < pod.narration.length; i++) {
    const { stats, slots } = layout(sim.replayThrough(pod.narration, i, config))
    const sum = stats.tokens + stats.reserved + stats.internal + stats.external + stats.free
    assert.equal(sum, config.num_blocks * config.block_size)
    assert.equal(slots.length, sum)
  }
})
test('every authored command changes the scene', () => {
  let state = sim.initialState()
  for (const beat of pod.narration)
    for (const command of beat.commands) {
      const next = sim.applyCommand(state, command, config)
      if (command.op !== 'paMode' && command.op !== 'paStage')
        assert.notEqual(next, state, `${beat.id}: ${JSON.stringify(command)} was a no-op`)
      state = next
    }
})
test('narration only spotlights requests that exist', () => {
  const ids = new Set(config.requests.map((spec) => spec.id))
  for (const beat of pod.narration)
    for (const cue of beat.cues ?? [])
      for (const target of cue.spotlight)
        if (target.startsWith('r-')) assert.ok(ids.has(target.slice(2)), target)
})
test('the pool fits inside HBM and cells never overlap', () => {
  const boxes = Array.from({ length: config.num_blocks * config.block_size }, (_, i) =>
    geometry.cellBox(i, config),
  )
  for (const [left, top, right, bottom] of boxes)
    assert.ok(left > 48 && right < 610 && top > 250 && bottom < 438)
  for (let i = 1; i < boxes.length; i++)
    if (boxes[i][1] === boxes[i - 1][1]) assert.ok(boxes[i][0] > boxes[i - 1][2])
})
test('spotlights on a request frame each of its blocks', () => {
  const state = atBeat('allocate')
  const { boxes } = geometry.spotlightBoxes('r-A', config, layout(state))
  assert.equal(boxes.length, 3)
  assert.equal(geometry.spotlightBoxes('r-Z', config, layout(state)).boxes.length, 0)
})
test('decode packets read every earlier token and write one per sequence', () => {
  const view = layout(atBeat('cow'))
  const cue = { kind: 'read', durationMs: 1000, effects: view.effects, serial: 1 }
  assert.equal(geometry.packetRoutes(cue, config).length, view.effects.reads.length)
  const writes = geometry.packetRoutes({ ...cue, kind: 'write' }, config)
  assert.equal(writes.length, 6)
})
test('the guided lesson replays to the same state as the reducer', async () => {
  const player = new LessonPlayback(pod, async () => true, () => {}, instant)
  for (let guard = 0; guard < 40 && !player.getSnapshot().completed; guard++) {
    await player.play()
    player.resolveCheckpoint()
  }
  assert.equal(player.getSnapshot().completed, true)
  assert.deepEqual(
    player.getSnapshot().state,
    sim.replayThrough(pod.narration, pod.narration.length - 1, config),
  )
})
test('checkpoints hold the guide until resolved', async () => {
  const player = new LessonPlayback(pod, async () => true, () => {}, instant)
  await player.play()
  assert.equal(player.getSnapshot().checkpoint, 'waste')
  await player.play()
  assert.equal(player.getSnapshot().beatIndex, beatIndex('waste'))
})
test('stopping mid-animation commits the step, and a seek is not overwritten', async () => {
  let release
  const gate = () => new Promise((resolve) => (release = resolve))
  const sleep = (ms, signal) =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve()
      signal.addEventListener('abort', () => resolve(), { once: true })
      gate().then(resolve)
    })
  const player = new LessonPlayback(pod, async () => true, () => {}, sleep)
  const start = player.goTo(beatIndex('contiguous'))
  for (let i = 0; i < 50 && !player.getSnapshot().visual; i++) {
    release?.()
    await Promise.resolve()
  }
  assert.equal(player.getSnapshot().visual?.kind, 'prompt')
  player.stop()
  assert.equal(layout(player.getSnapshot().state).status.A, 'running', 'interrupted admit still happened')
  const seek = player.goTo(0)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(player.getSnapshot().state.stage, 'empty', 'the old step did not clobber the seek')
  player.stop()
  release?.()
  await Promise.all([start, seek])
})
test('runtime tutor validation rejects unknown requests and operations', () => {
  assert.throws(() => validateCommands([{ op: 'delete', args: {} }], config))
  assert.throws(() => validateCommands([{ op: 'paAdmit', args: { request: 'Z' } }], config))
  assert.throws(() => validateCommands([{ op: 'paMode', args: { mode: 'compact' } }], config))
  assert.throws(() => validateCommands(Array(7).fill({ op: 'paDecode', args: {} }), config))
  assert.equal(validateCommands([{ op: 'paFinish', args: { request: 'F' } }], config).length, 1)
})
test('the tutor sees the computed numbers, not just raw state', () => {
  const scene = tutorScene(atBeat('waste'), config)
  assert.equal(scene.computed.external, 24)
  assert.equal(scene.requests.D, 'waiting')
  assert.equal(scene.computed.kvBytesPerToken, 800 * 1024)
})
test('each checkpoint has one correct answer with specific feedback', () => {
  assert.deepEqual(Object.keys(CHECKPOINTS).sort(), ['cow', 'next-block', 'waste'])
  for (const item of Object.values(CHECKPOINTS)) {
    assert.equal(item.choices.filter((choice) => choice.correct).length, 1)
    assert.ok(item.choices.every((choice) => choice.feedback.length > 40))
  }
})
