import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Transpile this small dependency graph in memory, without DOM, server or network.
const base = new URL('../src/lessons/declarative-attention/', import.meta.url)
const cache = new Map()
function moduleUrl(url) {
  if (cache.has(url.href)) return cache.get(url.href)
  let code = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText
  code = code.replace(
    /from ['"](.\/.+?)['"]/g,
    (_, path) => `from '${moduleUrl(new URL(path + '.ts', url))}'`,
  )
  const result = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  cache.set(url.href, result)
  return result
}
const sim = await import(moduleUrl(new URL('simulation.ts', base)))
const { LessonPlayback } = await import(moduleUrl(new URL('playback.ts', base)))
const geometryModule = await import(moduleUrl(new URL('geometry.ts', base)))
const { packetRoutes, slotX, slotWidth, COLORS } = geometryModule
const camera = await import(moduleUrl(new URL('camera.ts', base)))
const { validateCommands } = await import(moduleUrl(new URL('tutor.ts', base)))
const { CHECKPOINTS } = await import(moduleUrl(new URL('checkpoints.ts', base)))
const voice = await import(moduleUrl(new URL('voicePlayback.ts', base)))
const pod = JSON.parse(
  readFileSync(
    new URL('../../backend/app/pods/declarative-attention.json', import.meta.url),
    'utf8',
  ),
)
const config = pod.scene.params
const instant = async () => {}
const make = (narration = pod.narration, sleep = instant, speak = async () => true) =>
  new LessonPlayback({ ...pod, narration }, speak, () => {}, sleep)
const tick = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

test('empty stage is a complete reset', () => {
  let state = sim.applyCommand(
    { ...sim.initialState(config), stage: 'prefill' },
    { op: 'daDecode', args: { text: 'a' } },
    config,
  )
  state = sim.applyCommand(state, { op: 'daStage', args: { stage: 'empty' } }, config)
  assert.equal(state.events.length, 0)
  assert.equal(state.responseTokens, 0)
})
test('valid non-default IDs choose an available default focus', () => {
  const other = { ...config, chunks: [{ ...config.chunks[0], id: 7 }] }
  assert.deepEqual(sim.initialState(other).focusedChunks, [7])
})
test('all accepted chunk counts fit inside HBM', () => {
  for (let count = 1; count <= 8; count++)
    assert.ok(slotX(count, count) + slotWidth(count) - 8 < 610)
})
test('narration: every chapter is short spoken phrases, each pointing at the scene', () => {
  for (const [i, beat] of pod.narration.entries()) {
    assert.ok(beat.cues?.length, `chapter ${i + 1} has no phrases`)
    assert.equal(beat.text, beat.cues.map((cue) => cue.text).join(' '), `chapter ${i + 1} text drifted`)
    assert.ok(beat.text.split(/\s+/).length <= 32, `chapter ${i + 1} is too long`)
    for (const cue of beat.cues) {
      const words = cue.text.split(/\s+/).length
      assert.ok(words <= 12, `chapter ${i + 1}: "${cue.text}" has ${words} words`)
      assert.doesNotMatch(cue.text, /[<>→—]|\bMiB\b/, `"${cue.text}" reads badly aloud`)
      for (const target of cue.spotlight)
        assert.ok(
          target === 'meter' || geometryModule.spotlightBounds(target, config),
          `"${cue.text}" points at unknown part ${target}`,
        )
    }
  }
})
test('the first chapter points at each part as it is named', () => {
  const targets = pod.narration[0].cues.map((cue) => cue.spotlight.join())
  assert.deepEqual(targets, ['gpu', 'compute', 'memory', 'host', 'pcie'])
})
test('spotlight on a part lights its children and dims everything else', () => {
  const { inSpotlight } = geometryModule
  assert.ok(inSpotlight('c3', ['docs']) && inSpotlight('c3', ['gpu']) && inSpotlight('pcie', null))
  assert.ok(!inSpotlight('c1', ['c3']) && !inSpotlight('host', ['pcie']) && !inSpotlight('sys', ['docs']))
})
test('playback speaks phrase by phrase and moves the spotlight with it', async () => {
  const seen = []
  const player = make([pod.narration[0]], instant, async (text) => {
    seen.push([text, player.getSnapshot().caption, player.getSnapshot().spotlight?.join()])
    return true
  })
  await player.play()
  assert.deepEqual(
    seen.map(([text, caption, spot]) => [text === caption, spot]),
    [[true, 'gpu'], [true, 'compute'], [true, 'memory'], [true, 'host'], [true, 'pcie']],
  )
  assert.equal(player.getSnapshot().spotlight, null)
})
test('narration: terms are explained before they are used', () => {
  // Line (1-based) that introduces each term in plain words.
  const introducedAt = { PCIe: 1, SYS: 3, 'KV cache': 4, global: 5, focus: 7, local: 11 }
  for (const [term, line] of Object.entries(introducedAt)) {
    const first = pod.narration.findIndex((beat) =>
      new RegExp(`\\b${term}\\b`, 'i').test(beat.text),
    )
    assert.equal(first + 1, line, `"${term}" first appears in line ${first + 1}, expected ${line}`)
  }
})
test('narration and lesson copy avoid unexplained jargon', () => {
  const jargon = /\b(scaffold|prefill|vanilla|read mask|resident|residency|eviction|host|engine|context chunks?)\b/i
  const copy = [
    ...pod.narration.map((beat) => beat.text),
    ...Object.values(CHECKPOINTS).flatMap((item) => [
      item.question,
      ...item.choices.flatMap((choice) => [choice.label, choice.feedback]),
    ]),
  ]
  for (const text of copy) assert.doesNotMatch(text, jargon, text)
})
test('overview frames the whole board at every canvas shape, within orbit limits', () => {
  const corners = [23, 978].flatMap((x) =>
    [37, 441].flatMap((y) => [0, 0.55].map((z) => camera.world(x, y, z))),
  )
  for (const aspect of [0.75, 1, 1.5, 2, 3, 4]) {
    const preset = camera.cameraPreset('overview', aspect)
    const distance = Math.hypot(...preset.position.map((v, i) => v - preset.target[i]))
    assert.ok(distance <= camera.MAX_DISTANCE, `aspect ${aspect}: ${distance} beyond max zoom`)
    for (const corner of corners) {
      const [x, y] = camera.project(corner, preset, aspect)
      assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 1, `aspect ${aspect}: corner clipped`)
    }
  }
})
test('overview looks at the board from an angle so block depth is visible', () => {
  const preset = camera.cameraPreset('overview', 3)
  const offset = preset.position.map((v, i) => v - preset.target[i])
  const angle = Math.acos(offset[2] / Math.hypot(...offset))
  assert.ok(angle > 0.2, `camera is ${((angle * 180) / Math.PI).toFixed(1)}° off straight-on`)
})
test('read cue contains no response write; write follows as a distinct cue', () => {
  const event = sim.nextRead({ ...sim.initialState(config), stage: 'prefill' }, config)
  const reads = packetRoutes({ kind: 'read', durationMs: 2400, event, serial: 1 }, config)
  assert.ok(reads.every((route) => route.points.at(-1)[1] === 170))
  const writes = packetRoutes({ kind: 'response', durationMs: 450, event, serial: 2 }, config)
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].points.at(-1), [580, 414])
})
test('prefill input and storage paths are separate phases', () => {
  const input = packetRoutes({ kind: 'input', slot: 3, durationMs: 650, serial: 1 }, config)
  const write = packetRoutes({ kind: 'write', slot: 3, durationMs: 500, serial: 2 }, config)
  assert.deepEqual(input[0].points.at(-1), [320, 170])
  assert.equal(write[0].points.at(-1)[1], 362)
})
test('packet routes cross both ends of the drawn PCIe channel', () => {
  for (const kind of ['weights', 'input']) {
    const points = packetRoutes({ kind, slot: 0, durationMs: 650, serial: 1 }, config)[0].points
    assert.ok(points.some((p) => p[0] === 713 && p[1] === 283))
    assert.ok(points.some((p) => p[0] === 634 && p[1] === 283))
  }
})
test('focused reads never include masked chunk routes', () => {
  const state = { ...sim.initialState(config), stage: 'prefill', mode: 'focus', focusedChunks: [3] }
  const routes = packetRoutes(
    { kind: 'read', event: sim.nextRead(state, config), durationMs: 1000, serial: 1 },
    config,
  )
  assert.deepEqual(
    routes.map((r) => r.color),
    [COLORS.scaffold, config.chunks[2].color],
  )
})
test('prefill visibly completes seats in order', async () => {
  const player = make([pod.narration[3]])
  const steps = []
  player.subscribe(() => {
    const s = player.getSnapshot()
    if (s.visual) steps.push(s.visual.kind + ':' + s.visual.slot)
  })
  await player.play()
  assert.deepEqual(
    [...new Set(steps)],
    Array.from({ length: 5 }, (_, i) => ['input:' + i, 'write:' + i]).flat(),
  )
  assert.equal(player.getSnapshot().prefilledSlots, 5)
})
test('declaration appears while the old mask is still active', async () => {
  let release
  const player = make(
    [{ ...pod.narration[6], checkpoint: undefined }],
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const playing = player.play()
  await tick()
  assert.equal(player.getSnapshot().state.mode, 'global')
  assert.ok(player.getSnapshot().declaration.includes('3'))
  player.stop()
  release()
  await playing
  assert.equal(player.getSnapshot().state.mode, 'global')
})
test('continue after experiment retains its mask and does not duplicate tokens', async () => {
  const beats = [
    pod.narration[3],
    { ...pod.narration[4], commands: [{ op: 'daDecode', args: { text: 'new' } }] },
  ]
  const player = make(beats)
  await player.step()
  await player.explore([{ op: 'daMode', args: { mode: 'focus', chunks: [1] } }])
  await player.play()
  assert.equal(player.getSnapshot().state.mode, 'focus')
  assert.deepEqual(player.getSnapshot().state.focusedChunks, [1])
  assert.equal(player.getSnapshot().state.responseTokens, 1)
})
test('manual interaction replaces stale authored captions', async () => {
  const player = make([pod.narration[3]])
  await player.step()
  await player.explore([{ op: 'daMode', args: { mode: 'local', chunks: [] } }])
  assert.ok(player.getSnapshot().caption.startsWith('Local reads'))
})
test('checkpoints hold guide until explicit continuation', async () => {
  const player = make([{ ...pod.narration[0], checkpoint: 'read-set' }, pod.narration[1]])
  await player.play()
  assert.equal(player.getSnapshot().checkpoint, 'read-set')
  await player.play()
  assert.equal(player.getSnapshot().beatIndex, 0)
  player.resolveCheckpoint()
  await player.play()
  assert.equal(player.getSnapshot().beatIndex, 1)
})
test('three misconception checks have specific feedback and one correct answer', () => {
  assert.equal(Object.keys(CHECKPOINTS).length, 3)
  for (const item of Object.values(CHECKPOINTS)) {
    assert.equal(item.choices.filter((c) => c.correct).length, 1)
    assert.ok(item.choices.every((c) => c.feedback.length > 40))
  }
})
test('runtime tutor validation rejects unknown operations and bad focus', () => {
  assert.throws(() => validateCommands([{ op: 'delete', args: {} }], config))
  assert.throws(() =>
    validateCommands([{ op: 'daMode', args: { mode: 'focus', chunks: [99] } }], config),
  )
  assert.throws(() =>
    validateCommands([{ op: 'daMode', args: { mode: 'focus', chunks: [] } }], config),
  )
  assert.equal(
    validateCommands([{ op: 'daMode', args: { mode: 'focus', chunks: [3] } }], config).length,
    1,
  )
})
test('speech recognition ending without a result resolves and clears recording', async () => {
  let recording = false
  class Recognition {
    start() {}
    stop() {}
  }
  globalThis.window = { SpeechRecognition: Recognition }
  const ref = { current: null }
  const promise = voice.browserListen(
    (value) => (recording = value),
    ref,
    new AbortController().signal,
  )
  ref.current.onend()
  assert.equal(await promise, '')
  assert.equal(recording, false)
  assert.equal(ref.current, null)
})
test('canceling audio stops playback and removes its source', async () => {
  const handlers = {}
  let pauses = 0,
    removed = false
  const element = {
    src: '',
    play: async () => {},
    pause: () => {
      pauses++
    },
    removeAttribute: () => {
      removed = true
    },
    addEventListener: (name, fn) => (handlers[name] = fn),
    removeEventListener: (name) => delete handlers[name],
  }
  const controller = new AbortController()
  const promise = voice.playAudio(element, 'blob:test', 'hello', controller.signal)
  controller.abort()
  assert.equal(await promise, false)
  assert.equal(pauses, 1)
  assert.equal(removed, true)
})
const fakeAudio = () => {
  const handlers = {}
  return {
    handlers,
    currentTime: 0,
    src: '',
    play: async () => {},
    pause: () => {},
    removeAttribute: () => {},
    addEventListener: (name, fn) => (handlers[name] = fn),
    removeEventListener: (name) => delete handlers[name],
  }
}
test('audio that plays to the end counts as spoken despite the pause before ended', async () => {
  const element = fakeAudio()
  const promise = voice.playAudio(element, 'blob:test', 'hello', new AbortController().signal)
  element.currentTime = 1.2
  element.handlers.pause()
  element.handlers.ended?.()
  assert.equal(await promise, true)
})
test('audio that fails before starting reports unspoken so browser speech can take over', async () => {
  const element = fakeAudio()
  const promise = voice.playAudio(element, 'blob:test', 'hello', new AbortController().signal)
  element.handlers.error()
  assert.equal(await promise, false)
})
