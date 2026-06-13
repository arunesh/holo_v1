import { useMemo } from 'react'
import { Text } from '@react-three/drei'
import { usePodStore } from '../state/podStore'
import { blockX, BLOCK_WIDTH, activationColor } from './layout'

// Floating heatmap of residual-stream activations at the focused block:
// rows = tokens, columns = (sampled) hidden dimensions. Cell color == value.
export default function ActivationGrid() {
  const activations = usePodStore((s) => s.activations)
  const inference = usePodStore((s) => s.inference)
  const precision = usePodStore((s) => s.precision)

  const grid = useMemo(() => {
    if (!activations.visible || !inference) return null
    const layer = activations.index
    const norms = inference.residual_norms[layer]
    const sample = inference.sample_values[layer] // first dims of token 0
    if (!norms || !sample) return null
    return { norms, sample }
  }, [activations, inference])

  if (!activations.visible) return null

  const x = blockX(activations.index) + BLOCK_WIDTH * 0.5 + 2.4
  const cols = 8
  const cell = 0.46

  return (
    <group position={[x, 1.5, 0]}>
      <Text position={[0, 3.2, 0]} fontSize={0.32} color="#cbd6ff" anchorX="left">
        Residual activations · block {activations.index}
      </Text>

      {!grid && (
        <Text position={[0, 2.2, 0]} fontSize={0.26} color="#8893b8" anchorX="left">
          Run inference to populate values
        </Text>
      )}

      {/* per-token activation magnitude column */}
      {grid &&
        grid.norms.map((val, t) => {
          const norm = clamp01(val / (Math.max(...grid.norms) || 1))
          return (
            <group key={t} position={[0, 2 - t * (cell + 0.12), 0]}>
              <mesh>
                <boxGeometry args={[cell, cell, 0.15]} />
                <meshStandardMaterial
                  color={activationColor(norm)}
                  emissive={activationColor(norm)}
                  emissiveIntensity={0.4}
                />
              </mesh>
              {activations.mode === 'values' && (
                <Text position={[cell, 0, 0.1]} fontSize={0.2} color="#dfe6ff" anchorX="left">
                  {inference!.tokens[t]} · {val.toFixed(precision)}
                </Text>
              )}
            </group>
          )
        })}

      {/* sampled hidden-dimension values for token 0 (the 0.2f drill-down) */}
      {grid && activations.mode === 'values' && (
        <group position={[2.6, 2, 0]}>
          <Text position={[0, 0.7, 0]} fontSize={0.24} color="#9fb4ff" anchorX="left">
            dims[0..{grid.sample.length}] of "{inference!.tokens[0]}"
          </Text>
          {grid.sample.slice(0, 24).map((v, i) => {
            const col = i % cols
            const row = Math.floor(i / cols)
            return (
              <Text
                key={i}
                position={[col * 0.95, -row * 0.34, 0]}
                fontSize={0.18}
                color="#cfd8ff"
                anchorX="left"
              >
                {v.toFixed(precision)}
              </Text>
            )
          })}
        </group>
      )}
    </group>
  )
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
