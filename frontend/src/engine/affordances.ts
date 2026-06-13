import { usePodStore } from '../state/podStore'
import type { Command, Focus } from '../types'
import { runInference } from '../api'

// The client-side executor: turns an affordance command into scene-state mutations.
// This is the ONE place commands are interpreted — used by authored narration beats
// AND by the live AI session, so "video mode" and "interactive mode" behave identically.
export async function applyCommand(cmd: Command): Promise<void> {
  const store = usePodStore.getState()
  const a = cmd.args ?? {}

  switch (cmd.op) {
    case 'focusOn': {
      const focus: Focus = {
        target: a.target ?? 'overview',
        index: numOr(a.index, a.block),
        head: numOr(a.head),
        tokenIndex: numOr(a.tokenIndex, a.token),
      }
      store.setFocus(focus)
      // Focusing on a block/attention/mlp implicitly highlights that block.
      if (focus.index !== undefined && focus.target !== 'overview') {
        store.patch({ highlightedBlock: focus.index })
      }
      if (focus.target === 'overview') store.patch({ highlightedBlock: null })
      break
    }

    case 'highlightBlock':
      store.patch({ highlightedBlock: numOr(a.index, a.block) ?? null })
      break

    case 'highlightHead':
      store.patch({
        highlightedBlock: numOr(a.block) ?? store.highlightedBlock,
        attention: {
          visible: true,
          block: numOr(a.block) ?? store.attention.block,
          head: numOr(a.head) ?? 0,
        },
        focus: { target: 'head', index: numOr(a.block), head: numOr(a.head) },
      })
      break

    case 'showAttention':
      store.patch({
        attention: {
          visible: true,
          block: numOr(a.block, a.index) ?? store.attention.block,
          head: a.head === undefined || a.head === null ? null : numOr(a.head)!,
        },
      })
      break

    case 'hideAttention':
      store.patch({ attention: { ...store.attention, visible: false } })
      break

    case 'showActivations':
      store.patch({
        activations: {
          visible: true,
          target: (a.target ?? 'block') as any,
          index: numOr(a.index, a.block) ?? 0,
          mode: (a.mode ?? 'color') as any,
        },
      })
      if (a.mode === 'values') store.patch({ precision: numOr(a.decimals) ?? store.precision })
      break

    case 'hideActivations':
      store.patch({ activations: { ...store.activations, visible: false } })
      break

    case 'setPrecision':
      store.patch({ precision: clamp(numOr(a.decimals, a.value) ?? 2, 0, 6) })
      break

    case 'annotate':
      store.patch({ annotation: String(a.text ?? ''), captions: String(a.text ?? store.captions) })
      break

    case 'runInference': {
      const text = String(a.text ?? store.inputText)
      store.patch({ inputText: text, inferenceLoading: true })
      try {
        const data = await runInference(text)
        store.setInference(data)
      } finally {
        store.patch({ inferenceLoading: false })
      }
      break
    }

    case 'reset':
      store.reset()
      break

    default:
      console.warn('Unknown affordance op:', cmd.op)
  }
}

// Run a sequence of commands, pausing between them so motion reads as deliberate.
export async function runCommands(commands: Command[], gapMs = 350): Promise<void> {
  for (const cmd of commands) {
    await applyCommand(cmd)
    if (gapMs) await sleep(gapMs)
  }
}

const numOr = (...vals: any[]): number | undefined => {
  for (const v of vals) {
    if (v === undefined || v === null) continue
    const n = typeof v === 'number' ? v : parseInt(v, 10)
    if (!Number.isNaN(n)) return n
  }
  return undefined
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
