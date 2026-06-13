import { useMemo } from 'react'
import { Line, Text } from '@react-three/drei'
import * as THREE from 'three'
import { usePodStore } from '../state/podStore'
import { TOKEN_SPACING, TOKEN_Y, activationColor } from './layout'

// Draws the attention pattern for the active block/head as arcs between token nodes,
// the way 3Blue1Brown shows tokens "attending" to one another. Arc opacity == weight.
export default function AttentionHeads() {
  const attention = usePodStore((s) => s.attention)
  const inference = usePodStore((s) => s.inference)

  const arcs = useMemo(() => {
    if (!attention.visible || !inference) return []
    const blockAtt = inference.attention[attention.block]
    if (!blockAtt) return []
    const n = inference.tokens.length

    // weight[q][k] — averaged across heads if head === null.
    const weight: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
    const heads = attention.head === null ? blockAtt : [blockAtt[attention.head]]
    for (const head of heads) {
      for (let q = 0; q < n; q++)
        for (let k = 0; k < n; k++) weight[q][k] += (head?.[q]?.[k] ?? 0) / heads.length
    }

    const out: { points: THREE.Vector3[]; w: number }[] = []
    for (let q = 0; q < n; q++) {
      for (let k = 0; k <= q; k++) {
        const w = weight[q][k]
        if (w < 0.06) continue
        const x0 = k * TOKEN_SPACING
        const x1 = q * TOKEN_SPACING
        const lift = 1.2 + Math.abs(q - k) * 0.5
        const mid = new THREE.Vector3((x0 + x1) / 2, TOKEN_Y + lift, 0)
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(x0, TOKEN_Y + 0.4, 0),
          mid,
          new THREE.Vector3(x1, TOKEN_Y + 0.4, 0),
        )
        out.push({ points: curve.getPoints(20), w })
      }
    }
    return out
  }, [attention, inference])

  if (!attention.visible) return null

  return (
    <group>
      <Text position={[0, TOKEN_Y + 4.2, 0]} fontSize={0.34} color="#9fe6cf">
        {attention.head === null
          ? `Attention · block ${attention.block} (all heads)`
          : `Attention · block ${attention.block} · head ${attention.head}`}
      </Text>
      {arcs.map((a, i) => (
        <Line
          key={i}
          points={a.points}
          color={activationColor(a.w)}
          transparent
          opacity={Math.min(1, 0.25 + a.w)}
          lineWidth={1 + a.w * 3}
        />
      ))}
      {arcs.length === 0 && (
        <Text position={[0, TOKEN_Y + 2, 0]} fontSize={0.28} color="#8893b8">
          Run inference to see real attention weights
        </Text>
      )}
    </group>
  )
}
