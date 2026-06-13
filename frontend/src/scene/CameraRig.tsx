import { useEffect, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { usePodStore } from '../state/podStore'
import { focusToCamera } from './layout'

// Camera behaviour:
//  - The user can ALWAYS orbit/pan/zoom freely with mouse + cursor keys (OrbitControls).
//  - When `focus` changes (via narration or Claude), we smoothly fly the camera to frame
//    that target, then hand control back to the user.
export default function CameraRig() {
  const controls = useRef<any>(null)
  const { camera } = useThree()
  const focus = usePodStore((s) => s.focus)
  const pod = usePodStore((s) => s.pod)

  const desired = useRef<{ target: THREE.Vector3; pos: THREE.Vector3 } | null>(null)
  const animating = useRef(false)

  useEffect(() => {
    if (!pod) return
    const { target, offset } = focusToCamera(focus, pod.scene.params)
    desired.current = { target: target.clone(), pos: target.clone().add(offset) }
    animating.current = true
  }, [focus, pod])

  useFrame(() => {
    const c = controls.current
    if (!c) return
    if (animating.current && desired.current) {
      const { target, pos } = desired.current
      camera.position.lerp(pos, 0.08)
      c.target.lerp(target, 0.08)
      c.update()
      if (camera.position.distanceTo(pos) < 0.25 && c.target.distanceTo(target) < 0.25) {
        animating.current = false
      }
    }
  })

  // Cursor keys nudge the target; OrbitControls also enables keyboard pan by default.
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      enablePan
      keyPanSpeed={14}
      minDistance={2}
      maxDistance={120}
      // start animations from user interaction without snapping back
      onStart={() => (animating.current = false)}
    />
  )
}
