import { Text } from '@react-three/drei'
import { usePodStore } from '../state/podStore'
import { TOKEN_SPACING, TOKEN_Y, unembedX, activationColor } from './layout'
import type { SceneParams } from '../types'

// The input tokens laid out as a row of cells beneath the pipeline, and the
// model's top next-token predictions floating past the unembedding.
export default function TokenStream({ params }: { params: SceneParams }) {
  const inference = usePodStore((s) => s.inference)
  const inputText = usePodStore((s) => s.inputText)
  const focus = usePodStore((s) => s.focus)

  const tokens = inference?.tokens ?? fallbackTokens(inputText)
  const preds = inference?.predictions ?? []

  return (
    <group>
      {tokens.map((tok, t) => {
        const active = focus.target === 'token' && focus.tokenIndex === t
        return (
          <group key={t} position={[t * TOKEN_SPACING, TOKEN_Y, 0]}>
            <mesh>
              <boxGeometry args={[1.3, 0.7, 0.3]} />
              <meshStandardMaterial
                color={active ? '#ffd36e' : '#1b2440'}
                emissive={active ? '#7a5a10' : '#0a1124'}
                emissiveIntensity={0.4}
              />
            </mesh>
            <Text position={[0, 0, 0.2]} fontSize={0.26} color="#e7ecff" maxWidth={1.2}>
              {tok.replace(/\s/g, '·')}
            </Text>
          </group>
        )
      })}

      <Text position={[-1.6, TOKEN_Y, 0]} fontSize={0.3} color="#7f8cc0" anchorX="right">
        input ▸
      </Text>

      {/* predictions at the output end */}
      {preds.length > 0 && (
        <group position={[unembedX(params) + 2.4, 0.5, 0]}>
          <Text position={[0, preds.length * 0.5 + 0.4, 0]} fontSize={0.34} color="#9fe6cf" anchorX="left">
            next token ▸
          </Text>
          {preds.slice(0, 6).map((p, i) => (
            <group key={i} position={[0, preds.length * 0.5 - i * 0.55, 0]}>
              <mesh position={[p.prob * 1.5, 0, 0]}>
                <boxGeometry args={[Math.max(0.05, p.prob * 3), 0.32, 0.2]} />
                <meshStandardMaterial color={activationColor(p.prob)} emissive="#113" emissiveIntensity={0.3} />
              </mesh>
              <Text position={[0, 0, 0.2]} fontSize={0.24} color="#e7ecff" anchorX="left">
                {p.token.replace(/\s/g, '·')} {(p.prob * 100).toFixed(1)}%
              </Text>
            </group>
          ))}
        </group>
      )}
    </group>
  )
}

function fallbackTokens(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean).slice(0, 16)
}
