import type { MemoryConfig, VisualCue } from './types'
import { packetRoutes } from './geometry'

export default function PacketFlow({
  cue,
  config,
}: {
  cue: VisualCue | null
  config: MemoryConfig
}) {
  if (!cue) return null
  const duration = cue.durationMs / 1000
  return (
    <g key={cue.serial} className="da-packets" aria-hidden="true">
      {packetRoutes(cue, config).flatMap((route, routeIndex) =>
        Array.from({ length: route.count }, (_, i) => (
          <rect
            key={`${routeIndex}-${i}`}
            x={-3}
            y={-3}
            width={6}
            height={6}
            rx={1}
            fill={route.color}
            style={{
              offsetPath: `path('M ${route.points.map((point) => point.join(' ')).join(' L ')}')`,
              offsetRotate: '0deg',
              animation: `da-packet-travel ${duration * 0.65}s linear ${(i * duration * 0.3) / route.count}s both`,
            }}
          />
        )),
      )}
    </g>
  )
}
