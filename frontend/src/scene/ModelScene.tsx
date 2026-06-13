import { useMemo } from 'react'
import { Line, Text } from '@react-three/drei'
import * as THREE from 'three'
import Block from './Block'
import TokenStream from './TokenStream'
import AttentionHeads from './AttentionHeads'
import ActivationGrid from './ActivationGrid'
import { usePodStore } from '../state/podStore'
import { embeddingsX, unembedX, blockX } from './layout'
import type { SceneParams } from '../types'

// Assembles the full transformer architecture from the pod's scene params.
export default function ModelScene({ params }: { params: SceneParams }) {
  const focus = usePodStore((s) => s.focus)

  // The residual stream: a glowing line threading embeddings -> blocks -> unembed.
  const residualPoints = useMemo(() => {
    const pts: THREE.Vector3[] = [new THREE.Vector3(embeddingsX(), 0, 0)]
    for (let i = 0; i < params.n_layers; i++) pts.push(new THREE.Vector3(blockX(i), 0, 0))
    pts.push(new THREE.Vector3(unembedX(params), 0, 0))
    return pts
  }, [params])

  return (
    <group>
      <ambientLight intensity={0.55} />
      <directionalLight position={[10, 20, 15]} intensity={1.1} />
      <directionalLight position={[-10, 8, -12]} intensity={0.4} color="#88aaff" />
      <pointLight position={[unembedX(params) / 2, 6, 8]} intensity={40} distance={80} color="#cdd8ff" />

      {/* residual stream */}
      <Line points={residualPoints} color="#4a5a99" lineWidth={2} transparent opacity={0.7} />

      {/* embeddings node */}
      <group position={[embeddingsX(), 0, 0]}>
        <mesh>
          <icosahedronGeometry args={[1.1, 1]} />
          <meshStandardMaterial
            color={focus.target === 'embeddings' ? '#ffd36e' : '#3aa0c8'}
            emissive="#114"
            emissiveIntensity={0.5}
            flatShading
          />
        </mesh>
        <Text position={[0, 1.8, 0]} fontSize={0.4} color="#bfe0ff">
          Token + Pos Embeddings
        </Text>
      </group>

      {/* transformer blocks */}
      {Array.from({ length: params.n_layers }).map((_, i) => (
        <Block key={i} index={i} params={params} />
      ))}

      {/* unembedding node */}
      <group position={[unembedX(params), 0, 0]}>
        <mesh>
          <icosahedronGeometry args={[1.1, 1]} />
          <meshStandardMaterial
            color={focus.target === 'unembed' ? '#ffd36e' : '#c85ba0'}
            emissive="#311"
            emissiveIntensity={0.5}
            flatShading
          />
        </mesh>
        <Text position={[0, 1.8, 0]} fontSize={0.4} color="#ffc8ec">
          Unembedding → logits
        </Text>
      </group>

      <TokenStream params={params} />
      <AttentionHeads />
      <ActivationGrid />
    </group>
  )
}
