import { useMemo } from 'react'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import {
  blockX,
  headZ,
  BLOCK_WIDTH,
  BLOCK_HEIGHT,
  HEAD_SIZE,
  ATTN_Y,
  MLP_Y,
} from './layout'
import type { SceneParams } from '../types'
import { usePodStore } from '../state/podStore'

interface Props {
  index: number
  params: SceneParams
}

// One transformer block: a translucent shell containing an attention sub-layer
// (a row of per-head cubes) and an MLP sub-layer (a slab).
export default function Block({ index, params }: Props) {
  const highlighted = usePodStore((s) => s.highlightedBlock)
  const attention = usePodStore((s) => s.attention)
  const inference = usePodStore((s) => s.inference)
  const x = blockX(index)
  const isHot = highlighted === index

  // Per-head average attention weight (off-diagonal mass) drives head glow when we have real data.
  const headEnergy = useMemo(() => {
    const att = inference?.attention?.[index]
    if (!att) return null
    return att.map((head) => {
      let s = 0
      let n = 0
      for (const row of head) for (const w of row) (s += w), n++
      return n ? s / n : 0
    })
  }, [inference, index])

  return (
    <group position={[x, 0, 0]}>
      {/* block shell */}
      <mesh>
        <boxGeometry args={[BLOCK_WIDTH, BLOCK_HEIGHT, BLOCK_WIDTH]} />
        <meshStandardMaterial
          color={isHot ? '#5b7cff' : '#243056'}
          transparent
          opacity={isHot ? 0.28 : 0.14}
          emissive={isHot ? '#3550c0' : '#101830'}
          emissiveIntensity={isHot ? 0.6 : 0.2}
        />
      </mesh>

      {/* MLP slab */}
      <mesh position={[0, MLP_Y, 0]}>
        <boxGeometry args={[BLOCK_WIDTH * 0.72, 0.7, BLOCK_WIDTH * 0.72]} />
        <meshStandardMaterial color="#7a5bd0" emissive="#2a1a55" emissiveIntensity={0.4} />
      </mesh>
      <Text position={[0, MLP_Y + 0.7, 0]} fontSize={0.3} color="#cbb8ff" anchorY="bottom">
        MLP
      </Text>

      {/* attention heads */}
      {Array.from({ length: params.n_heads }).map((_, h) => {
        const z = headZ(h, params.n_heads)
        const active = attention.visible && attention.block === index && (attention.head === null || attention.head === h)
        const energy = headEnergy ? Math.min(1, headEnergy[h] * 3) : 0.3
        return (
          <mesh key={h} position={[0, ATTN_Y, z]}>
            <boxGeometry args={[BLOCK_WIDTH * 0.5, HEAD_SIZE, HEAD_SIZE]} />
            <meshStandardMaterial
              color={active ? '#46d6a0' : '#2f8fb8'}
              emissive={active ? '#27c08a' : '#155'}
              emissiveIntensity={active ? 0.9 : 0.25 + energy * 0.6}
            />
          </mesh>
        )
      })}
      <Text position={[0, ATTN_Y - 0.6, 0]} fontSize={0.26} color="#9fe6cf" anchorY="top">
        {params.n_heads}-head attn
      </Text>

      {/* block label */}
      <Text position={[0, BLOCK_HEIGHT / 2 + 0.4, 0]} fontSize={0.42} color="#aab6e0" anchorY="bottom">
        Block {index}
      </Text>
    </group>
  )
}
