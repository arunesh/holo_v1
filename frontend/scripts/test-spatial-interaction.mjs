// Browser interaction checks for the DA spatial view, with GPT-2 as the reference scene.
// Needs a running app and a local Google Chrome (playwright-core drives it; no browser download):
//   HOLO_URL=http://127.0.0.1:8350 npm run test:spatial
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const base = process.env.HOLO_URL || 'http://127.0.0.1:8350'
const output = path.resolve(process.env.SPATIAL_OUTPUT || 'spatial-interaction')
await mkdir(output, { recursive: true })

const source = new URL('../src/lessons/declarative-attention/', import.meta.url)
const load = (name) =>
  import(
    `data:text/javascript;base64,${Buffer.from(
      ts.transpileModule(readFileSync(new URL(name, source), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
      }).outputText,
    ).toString('base64')}`
  )
const camera = await load('camera.ts')
const geometry = await load('geometry.ts')

const results = []
const errors = []
async function check(group, name, run) {
  try {
    await run()
    results.push({ group, name, passed: true })
    console.log(`PASS [${group}] ${name}`)
  } catch (error) {
    results.push({ group, name, passed: false, detail: String(error.message || error) })
    console.log(`FAIL [${group}] ${name}: ${error.message || error}`)
  }
}
const expect = (condition, message) => {
  if (!condition) throw new Error(message)
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.setDefaultTimeout(15000)
page.on('pageerror', (error) => errors.push(error.message))
const button = (name) => page.getByRole('button', { name, exact: true })
const wait = (ms) => page.waitForTimeout(ms)

async function shot(locator, name) {
  const buffer = await locator.screenshot()
  await writeFile(path.join(output, `${name}.png`), buffer)
  return buffer.toString('base64')
}
/** Mean absolute RGB difference (0–255) between two PNG screenshots, decoded in the page. */
function difference(a, b) {
  return page.evaluate(
    async ([a, b]) => {
      const pixels = async (data) => {
        const image = new Image()
        image.src = `data:image/png;base64,${data}`
        await image.decode()
        const canvas = new OffscreenCanvas(image.width, image.height)
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        return context.getImageData(0, 0, image.width, image.height).data
      }
      const [x, y] = [await pixels(a), await pixels(b)]
      if (x.length !== y.length) return 255
      let total = 0
      for (let i = 0; i < x.length; i += 4)
        total += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2])
      return total / ((x.length / 4) * 3)
    },
    [a, b],
  )
}
function brightness(data) {
  return page.evaluate(async (data) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = new OffscreenCanvas(image.width, image.height)
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, image.width, image.height).data
    let total = 0
    for (let i = 0; i < pixels.length; i += 4) total += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
    return total / (pixels.length / 4)
  }, data)
}
function variance(data) {
  return page.evaluate(async (data) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = new OffscreenCanvas(image.width, image.height)
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, image.width, image.height).data
    const distinct = new Set()
    for (let i = 0; i < pixels.length; i += 4 * 97)
      distinct.add((pixels[i] >> 3) * 1024 + (pixels[i + 1] >> 3) * 32 + (pixels[i + 2] >> 3))
    return distinct.size
  }, data)
}
async function drag(box, from, delta, back = false) {
  await page.mouse.move(box.x + from[0], box.y + from[1])
  await page.mouse.down()
  for (let i = 1; i <= 8; i++)
    await page.mouse.move(box.x + from[0] + (delta[0] * i) / 8, box.y + from[1] + (delta[1] * i) / 8)
  if (back)
    for (let i = 7; i >= 0; i--)
      await page.mouse.move(box.x + from[0] + (delta[0] * i) / 8, box.y + from[1] + (delta[1] * i) / 8)
  await page.mouse.up()
}

try {
  // Sign-in is checked in the browser only, so a stored session stands in for Google.
  await page.addInitScript(() =>
    localStorage.setItem('holodeck.session', JSON.stringify({ name: 'Test', provider: 'google' })),
  )
  await page.goto(`${base}/?lesson=declarative-attention`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Read less KV. Move no KV.' }).waitFor()
  await button('Voice on').click()
  const canvas = page.locator('.da-canvas canvas')
  await canvas.waitFor()
  await wait(1500)
  let box = await canvas.boundingBox()
  const aspect = box.width / box.height
  const count = 4
  /** Screen position of a KV seat's front face in the overview camera. */
  const seat = (slot) => {
    const preset = camera.cameraPreset('overview', aspect)
    const point = camera.world(geometry.slotCenter(slot, count) + 28, 372, 0.48)
    const [x, y] = camera.project(point, preset, aspect)
    return [((x + 1) / 2) * box.width, ((1 - y) / 2) * box.height]
  }
  const emptySpot = [box.width * 0.5, box.height * 0.08]
  const pressed = () => button('Toggle C3').getAttribute('aria-pressed')
  const cursorAt = async (point) => {
    await page.mouse.move(box.x + point[0], box.y + point[1])
    await wait(250)
    return canvas.evaluate((element) =>
      [element, element.parentElement, document.body].map((e) => getComputedStyle(e).cursor),
    )
  }

  await check('render', 'spatial GPU canvas draws a scene', async () => {
    const colors = await variance(await shot(canvas, 'da-01-initial'))
    expect(colors > 20, `only ${colors} distinct colours`)
  })
  await check('interaction', 'empty KV seats ignore clicks', async () => {
    const status = await page.locator('.da-stage-status').innerText()
    await page.mouse.click(box.x + seat(3)[0], box.y + seat(3)[1])
    await wait(300)
    expect((await page.locator('.da-stage-status').innerText()) === status, 'state changed')
  })

  await page.getByRole('button', { name: /04 Build the KV cache/ }).click()
  await page.waitForFunction(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Decode one token'))
    return el && !el.disabled
  }, null, { timeout: 60000 })
  await button('global').click()
  await wait(800)
  box = await canvas.boundingBox()

  await check('interaction', 'hovering a clickable KV seat shows a pointer cursor', async () => {
    const cursors = await cursorAt(seat(3))
    expect(cursors.includes('pointer'), `cursor was ${cursors.join(', ')}`)
    const away = await cursorAt(emptySpot)
    expect(!away.includes('pointer'), `pointer stayed on empty space`)
  })
  const mode = () => page.locator('.da-stage-status').innerText()
  // Mode changes show the output's declaration (~1 s) before the mask is applied.
  const reach = async (name, ms = 4000) => {
    const start = Date.now()
    while (Date.now() - start < ms) {
      if ((await mode()).includes(name)) return true
      await wait(150)
    }
    return false
  }
  await check('interaction', 'clicking seat C3 in 3D focuses only C3', async () => {
    await page.mouse.click(box.x + seat(3)[0], box.y + seat(3)[1])
    expect(await reach('FOCUS'), `mode is ${await mode()}`)
    expect((await pressed()) === 'true', 'C3 not selected')
    expect((await button('Toggle C1').getAttribute('aria-pressed')) === 'false', 'C1 also selected')
  })
  await check('interaction', 'clicking seat C3 again releases it', async () => {
    await wait(600)
    await page.mouse.click(box.x + seat(3)[0], box.y + seat(3)[1])
    expect(await reach('LOCAL'), `mode is ${await mode()}`)
    expect((await pressed()) === 'false', 'C3 still selected')
  })
  await button('global').click()
  await reach('GLOBAL')
  await wait(600)
  await check('interaction', 'an orbit drag that starts and ends on a seat does not toggle it', async () => {
    await drag(box, seat(3), [90, 0], true)
    expect(!(await reach('FOCUS', 3000)), `drag switched mode to ${await mode()}`)
  })

  await button('host').click()
  await wait(1500)
  await button('overview').click()
  await wait(1500)
  const overview = await shot(canvas, 'da-02-overview')
  await check('camera', 'dragging orbits the view', async () => {
    await drag(box, emptySpot, [160, 40])
    await wait(1500)
    const moved = await difference(overview, await shot(canvas, 'da-03-orbited'))
    expect(moved > 3, `view barely changed (${moved.toFixed(2)})`)
  })
  await check('camera', 'pressing the active preset button resets the camera', async () => {
    await button('overview').click()
    await wait(1800)
    const offset = await difference(overview, await shot(canvas, 'da-04-reset'))
    expect(offset < 1.5, `view did not return (difference ${offset.toFixed(2)})`)
  })
  await check('camera', 'preset changes fly smoothly like the GPT-2 camera', async () => {
    await button('memory').click()
    await wait(90)
    const early = await shot(canvas, 'da-05-memory-early')
    await wait(1800)
    const settled = await shot(canvas, 'da-06-memory')
    const fromEnd = await difference(early, settled)
    const fromStart = await difference(early, overview)
    expect(fromEnd > 2 && fromStart > 2, `no in-between frame (start ${fromStart.toFixed(2)}, end ${fromEnd.toFixed(2)})`)
  })
  await button('overview').click()
  await wait(1800)
  await check('camera', 'orbit keeps gliding briefly after release (damping, as in GPT-2)', async () => {
    // Short enough to stay inside the azimuth limit; a clamped orbit has nothing left to glide.
    await drag(box, emptySpot, [40, 0])
    const released = await shot(canvas, 'da-07-release')
    await wait(500)
    const glide = await difference(released, await shot(canvas, 'da-08-glide'))
    expect(glide > 1, `no glide (difference ${glide.toFixed(2)})`)
  })
  await check('camera', 'a long drag stops before the board turns edge-on or backwards', async () => {
    await button('overview').click()
    await wait(1800)
    await drag(box, emptySpot, [box.width * 1.2, 0])
    await wait(1500)
    const [lit, front] = [await brightness(await shot(canvas, 'da-09-far-orbit')), await brightness(overview)]
    expect(lit > front * 0.6, `board went dark (${lit.toFixed(1)} vs ${front.toFixed(1)} brightness)`)
  })
  await button('overview').click()
  await wait(1500)

  await page.getByLabel('Choose lesson').selectOption('gpt2')
  const gpt2 = page.locator('.canvas-wrap canvas')
  await gpt2.waitFor()
  await wait(2500)
  const gbox = await gpt2.boundingBox()
  const start = await shot(gpt2, 'gpt2-01')
  await check('gpt2 reference', 'GPT-2 scene draws', async () => {
    expect((await variance(start)) > 20, 'blank')
  })
  await check('gpt2 reference', 'GPT-2 drag orbits and glides after release', async () => {
    await drag(gbox, [gbox.width * 0.5, gbox.height * 0.3], [160, 0])
    const released = await shot(gpt2, 'gpt2-02-release')
    await wait(500)
    const glide = await difference(released, await shot(gpt2, 'gpt2-03-glide'))
    expect((await difference(start, released)) > 3, 'did not orbit')
    expect(glide > 1, `no glide (${glide.toFixed(2)})`)
  })
  await check('page', 'no uncaught page errors', async () => {
    expect(errors.length === 0, errors.join(' | '))
  })
} finally {
  await browser.close()
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ base, results, errors }, null, 2))
  const failed = results.filter((r) => !r.passed)
  console.log(`${results.length - failed.length}/${results.length} passed · screenshots in ${output}`)
  if (failed.length) process.exitCode = 1
}
