import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Transpile the lesson's small dependency graph in memory, without DOM, server or network.
const base = new URL('../src/lessons/flash-attention/', import.meta.url)
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
const { CHECKPOINTS } = await import(moduleUrl(new URL('checkpoints.ts', base)))
// tutor.ts imports the browser socket helper; test its pure parts through a stub.
const tutorSource = readFileSync(new URL('tutor.ts', base), 'utf8').replace(
  /import \{ openSocket \} from '\.\.\/\.\.\/api'/,
  'const openSocket = () => { throw new Error("no sockets in tests") }',
)
const tutorUrl = new URL('tutor.ts', base)
const tutorCode = ts
  .transpileModule(tutorSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  })
  .outputText.replace(/from ['"](\.\.?\/.+?)['"]/g, (_, path) => `from '${moduleUrl(new URL(path + '.ts', tutorUrl))}'`)
const { validateCommands, tutorScene } = await import(
  `data:text/javascript;base64,${Buffer.from(tutorCode).toString('base64')}`
)
const pod = JSON.parse(
  readFileSync(new URL('../../backend/app/pods/flash-attention.json', import.meta.url), 'utf8'),
)
const config = pod.scene.params
const N = config.seq_len
const d = config.head_dim
const fresh = (mode) => ({ stage: 'inputs', mode, pc: 0 })
const finished = (mode) => ({ stage: 'inputs', mode, pc: sim.programOf(config, mode).length })
const run = (state) => sim.runOf(state, config)
const beatIndex = (id) => pod.narration.findIndex((beat) => beat.id === id)
const atBeat = (id) => sim.replayThrough(pod.narration, beatIndex(id), config)
const instant = async () => {}

test('block sizes follow Algorithm 1 line 1', () => {
  assert.deepEqual(sim.blockSizes(config), { Bc: 8, Br: 4, Tr: 8, Tc: 4 })
})
test('FlashAttention returns exactly the standard attention output', () => {
  const standard = run(finished('standard'))
  const flash = run(finished('flash'))
  assert.ok(flash.check.maxError < 1e-12, `max error ${flash.check.maxError}`)
  for (let r = 0; r < N; r++)
    for (let c = 0; c < d; c++) assert.ok(Math.abs(flash.hbm.O[r][c] - standard.hbm.O[r][c]) < 1e-12)
})
test('block-sparse is exact for the masked attention and differs from dense', () => {
  const sparse = run(finished('block-sparse'))
  assert.equal(sparse.check.reference, 'masked')
  assert.ok(sparse.check.maxError < 1e-12)
  assert.ok(sparse.check.denseGap > 0.1, 'skipping tiles really changes the answer')
})
test('counted HBM traffic equals the closed-form formula for every algorithm', () => {
  const density = sim.maskDensity(config)
  for (const mode of sim.ALGORITHMS) {
    const { counters } = run(finished(mode))
    assert.equal(counters.reads + counters.writes, sim.hbmAccesses(mode, N, d, config.sram_size, density), mode)
  }
  assert.equal(sim.hbmAccesses('standard', N, d, config.sram_size), 4608)
  assert.equal(sim.hbmAccesses('flash', N, d, config.sram_size), 2304)
  assert.equal(sim.hbmAccesses('block-sparse', N, d, config.sram_size, density), 1280)
})
test('only standard attention moves S or P through HBM, four N² passes of it', () => {
  assert.equal(run(finished('standard')).counters.quadratic, 4 * N * N)
  assert.equal(run(finished('flash')).counters.quadratic, 0)
  assert.equal(run(finished('block-sparse')).counters.quadratic, 0)
  // Flash never writes S or P at all.
  assert.ok(run(finished('flash')).hbm.S.flat().every(Number.isNaN))
})
test('the matmuls do the same work; block-sparse does it for nonzero tiles only', () => {
  const flops = (mode) => run(finished(mode)).counters.flops
  assert.equal(flops('flash'), flops('standard'))
  assert.equal(flops('standard'), 4 * N * N * d)
  assert.equal(flops('block-sparse'), flops('flash') * sim.maskDensity(config))
})
test('Algorithm 1 loops K, V blocks outside and Q blocks inside, loading each K, V once', () => {
  const program = sim.programOf(config, 'flash')
  const kv = program.filter((op) => op.phase === 'load-kv').map((op) => op.j)
  assert.deepEqual(kv, [0, 1, 2, 3])
  const firstColumn = program.slice(1, 41)
  assert.ok(firstColumn.every((op) => op.j === 0))
  assert.deepEqual(
    firstColumn.filter((op) => op.phase === 'load-q').map((op) => op.i),
    [0, 1, 2, 3, 4, 5, 6, 7],
  )
  assert.deepEqual(
    program.slice(1, 6).map((op) => [op.phase, op.line]),
    [['load-q', '8'], ['qk', '9'], ['softmax', '10–11'], ['pv', '12'], ['store', '12–13']],
  )
})
test('block-sparse loads every K, V block but skips Q traffic for zero tiles', () => {
  const program = sim.programOf(config, 'block-sparse')
  assert.equal(program.filter((op) => op.phase === 'load-kv').length, 4)
  const skips = program.filter((op) => op.phase === 'skip')
  assert.equal(skips.length, 16)
  for (const op of skips) {
    assert.equal(config.block_mask[op.i][op.j], 0)
    assert.equal(op.reads.length + op.writes.length, 0)
  }
  assert.equal(skips[0].algorithm, 5)
})
test('the rescale chapter shows one row whose max rises, as narrated', () => {
  const view = run(atBeat('rescale'))
  assert.equal(view.op.phase, 'softmax')
  assert.deepEqual([view.op.i, view.op.j], [0, 1])
  const rows = sim.rescaledRows(view)
  assert.equal(rows.length, 1, 'only one row of the first Q block changes its max')
  const [{ row, mOld, mNew, factor }] = rows
  assert.equal(row, 0)
  assert.equal(mOld.toFixed(1), '1.2')
  assert.equal(mNew.toFixed(1), '3.5')
  assert.equal(factor.toFixed(2), '0.09')
  assert.ok(Math.abs(factor - Math.exp(mOld - mNew)) < 1e-12)
})
test('running statistics after the first tile are the tile’s own', () => {
  const view = run(atBeat('write-back'))
  assert.equal(view.op.phase, 'store')
  const writes = sim.opTraffic(view.op)
  assert.deepEqual(writes, { reads: 0, writes: 24 })
  // After one K block, ℓ is that block's row sum relative to its row max.
  const { Q, K } = sim.inputs(config)
  const scores = K.slice(0, 8).map((k) => Q[0].reduce((s, q, c) => s + q * k[c], 0))
  const max = Math.max(...scores)
  assert.ok(Math.abs(view.hbm.m[0] - max) < 1e-12)
  assert.ok(Math.abs(view.hbm.l[0] - scores.reduce((s, x) => s + Math.exp(x - max), 0)) < 1e-12)
})
test('chapters land where the narration says', () => {
  assert.equal(run(atBeat('standard-qk')).op.phase, 'std-qk')
  assert.equal(run(atBeat('standard-softmax')).op.phase, 'std-softmax')
  assert.ok(run(atBeat('standard-pv')).done)
  assert.equal(run(atBeat('standard-pv')).counters.quadratic, 4096)
  assert.equal(atBeat('first-pass').pc, 41)
  assert.equal(run(atBeat('first-pass')).next.phase, 'load-kv')
  assert.ok(run(atBeat('flash-done')).done)
  const pass = run(atBeat('sparse-pass'))
  assert.equal(pass.next.phase, 'load-kv')
  assert.equal(pass.tiles.flat().filter((tile) => tile === 'skipped').length, 4)
  assert.ok(run(atBeat('sparse-done')).done)
})
test('runs stop at tile, pass and end boundaries', () => {
  const flash = fresh('flash')
  assert.equal(sim.runTarget(flash, 'tile', config), 6, 'load K, V then one whole tile')
  assert.equal(sim.runTarget(flash, 'pass', config), 41)
  assert.equal(sim.runTarget(flash, 'end', config), 164)
  const standard = fresh('standard')
  assert.equal(sim.runTarget(standard, 'tile', config), 1)
  assert.equal(sim.runTarget(standard, 'pass', config), 8)
  assert.equal(sim.runTarget({ ...standard, pc: 8 }, 'pass', config), 16)
})
test('commands are ignored when they cannot apply', () => {
  const hardware = sim.initialState()
  assert.equal(sim.applyCommand(hardware, { op: 'faStep', args: {} }, config), hardware, 'no inputs yet')
  const done = finished('flash')
  assert.equal(sim.applyCommand(done, { op: 'faStep', args: {} }, config), done, 'already finished')
  assert.equal(sim.applyCommand(done, { op: 'faRun', args: { until: 'end' } }, config), done)
  assert.equal(sim.applyCommand(done, { op: 'faMode', args: { mode: 'flash' } }, config), done)
  assert.equal(sim.applyCommand(done, { op: 'faMode', args: { mode: 'dense' } }, config), done)
})
test('switching algorithm or reloading inputs restarts the run', () => {
  const midway = { ...fresh('flash'), pc: 20 }
  assert.equal(sim.applyCommand(midway, { op: 'faMode', args: { mode: 'standard' } }, config).pc, 0)
  assert.equal(sim.applyCommand(midway, { op: 'faStage', args: { stage: 'inputs' } }, config).pc, 0)
  assert.deepEqual(sim.applyCommand(midway, { op: 'faStage', args: { stage: 'hardware' } }, config), sim.initialState())
})
test('every authored step changes the scene', () => {
  let state = sim.initialState()
  for (const beat of pod.narration)
    for (const command of beat.commands) {
      const next = sim.applyCommand(state, command, config)
      if (command.op === 'faStep' || command.op === 'faRun')
        assert.notEqual(next, state, `${beat.id}: ${JSON.stringify(command)} was a no-op`)
      state = next
    }
})
test('Q, K and V are deterministic and printable', () => {
  const again = { ...config }
  assert.deepEqual(sim.inputs(config), sim.inputs(again))
  for (const value of Object.values(sim.inputs(config)).flat(2)) {
    assert.ok(Math.abs(value) <= 1.5)
    assert.equal(Math.round(value * 10) / 10, value)
  }
})
test('the board fits: HBM and SRAM matrices stay inside their panels', () => {
  const { hbm, sram } = geometry.layoutOf(config)
  const inside = (box, panel) =>
    box[0] >= panel[0] && box[1] >= panel[1] && box[2] <= panel[2] && box[3] <= panel[3]
  for (const [name, box] of Object.entries(hbm)) assert.ok(inside(box, geometry.HBM_BOX), `HBM ${name}`)
  for (const [name, box] of Object.entries(sram)) assert.ok(inside(box, geometry.SRAM_BOX), `SRAM ${name}`)
})
test('loads travel from HBM to SRAM over the bus, stores travel back', () => {
  const program = sim.programOf(config, 'flash')
  const load = geometry.packetRoutes({ kind: 'load', durationMs: 1000, op: program[1], serial: 1 }, config, 'flash')
  // Q, O, ℓ, m for a 4-row block: one packet per row each.
  assert.equal(load.length, 16)
  for (const route of load) {
    assert.ok(route.points[0][0] < geometry.BUS_BOX[0], 'starts in HBM')
    assert.ok(route.points.at(-1)[0] > geometry.BUS_BOX[2], 'ends in SRAM')
  }
  const store = geometry.packetRoutes({ kind: 'store', durationMs: 1000, op: program[5], serial: 2 }, config, 'flash')
  assert.ok(store.every((route) => route.points[0][0] > geometry.BUS_BOX[2]))
  const compute = geometry.packetRoutes({ kind: 'compute', durationMs: 1000, op: program[2], serial: 3 }, config, 'flash')
  assert.equal(compute.length, 0, 'matmuls stay on chip')
})
test('spotlights frame matrices in both HBM and SRAM', () => {
  assert.equal(geometry.spotlightBoxes('q', config, 'flash').boxes.length, 2)
  assert.equal(geometry.spotlightBoxes('k', config, 'standard').boxes.length, 1)
  assert.ok(geometry.inSpotlight(['hbm', 'q'], ['gpu']))
  assert.ok(geometry.inSpotlight(['sram', 'q'], ['q']))
  assert.ok(!geometry.inSpotlight(['sram', 'q'], ['hbm']))
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
  assert.equal(player.getSnapshot().checkpoint, 'materialize')
  await player.play()
  assert.equal(player.getSnapshot().beatIndex, beatIndex('standard-pv'))
})
test('stopping mid-run commits the run, and a seek is not overwritten', async () => {
  let release
  const gate = () => new Promise((resolve) => (release = resolve))
  const sleep = (ms, signal) =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve()
      signal.addEventListener('abort', () => resolve(), { once: true })
      gate().then(resolve)
    })
  const player = new LessonPlayback(pod, async () => true, () => {}, sleep)
  const start = player.goTo(beatIndex('first-pass'))
  for (let i = 0; i < 50 && !player.getSnapshot().visual; i++) {
    release?.()
    await Promise.resolve()
  }
  assert.ok(player.getSnapshot().visual, 'a run is animating')
  player.stop()
  assert.equal(player.getSnapshot().state.pc, 41, 'the interrupted run still finished its pass')
  const seek = player.goTo(0)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(player.getSnapshot().state.stage, 'hardware', 'the old run did not clobber the seek')
  player.stop()
  release?.()
  await Promise.all([start, seek])
})
test('runtime tutor validation rejects unknown operations and arguments', () => {
  assert.throws(() => validateCommands([{ op: 'delete', args: {} }]))
  assert.throws(() => validateCommands([{ op: 'faMode', args: { mode: 'sparse' } }]))
  assert.throws(() => validateCommands([{ op: 'faRun', args: { until: 'forever' } }]))
  assert.throws(() => validateCommands([{ op: 'faStep', args: { count: 9 } }]))
  assert.throws(() => validateCommands(Array(7).fill({ op: 'faStep', args: {} })))
  assert.equal(validateCommands([{ op: 'faRun', args: { until: 'end' } }]).length, 1)
})
test('the tutor sees the computed numbers, not just raw state', () => {
  const scene = tutorScene(atBeat('rescale'), config)
  assert.equal(scene.computed.fullRun.flash, 2304)
  assert.deepEqual(scene.blocks, { Bc: 8, Br: 4, Tr: 8, Tc: 4 })
  assert.equal(scene.computed.rescaledRows.length, 1)
  assert.equal(scene.computed.rescaledRows[0].row, 0)
  assert.match(scene.lastOp, /rowmax/)
})
test('each checkpoint has one correct answer with specific feedback', () => {
  assert.deepEqual(Object.keys(CHECKPOINTS).sort(), ['materialize', 'rescale', 'sparse'])
  for (const item of Object.values(CHECKPOINTS)) {
    assert.equal(item.choices.filter((choice) => choice.correct).length, 1)
    assert.ok(item.choices.every((choice) => choice.feedback.length > 40))
  }
})
test('narrated numbers match the simulation', () => {
  const text = (id) => pod.narration[beatIndex(id)].text
  assert.match(text('standard-pv'), /4,608/)
  assert.match(text('standard-pv'), /4,096/)
  assert.match(text('flash-done'), /2,304/)
  assert.match(text('sparse-done'), /1,280/)
  assert.match(text('tiling'), /128 numbers/)
})
