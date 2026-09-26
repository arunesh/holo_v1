import { lazy, Suspense, useEffect, useState } from 'react'
import { fetchPods, fetchPod } from './api'
import type { SessionUser } from './auth/session'
import type { Pod, PodSummary, TransformerPod } from './types'
import type { DeclarativeAttentionPod } from './lessons/declarative-attention/types'
import type { PagedAttentionPod } from './lessons/paged-attention/types'
import DeclarativeAttentionLesson from './lessons/declarative-attention/DeclarativeAttentionLesson'

const TransformerApp = lazy(() => import('./TransformerApp'))
const PagedAttentionLesson = lazy(() => import('./lessons/paged-attention/PagedAttentionLesson'))
interface AppProps { user: SessionUser; onSignOut: () => void }

export default function App(props: AppProps) {
  const [catalogue, setCatalogue] = useState<PodSummary[]>([])
  const [selected, setSelected] = useState(new URLSearchParams(location.search).get('lesson') || 'gpt2')
  const [lesson, setLesson] = useState<Pod | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { fetchPods().then(setCatalogue).catch(() => setError('Could not load lessons. Refresh to retry.')) }, [])
  useEffect(() => {
    const changed = () => setSelected(new URLSearchParams(location.search).get('lesson') || 'gpt2')
    window.addEventListener('popstate', changed)
    return () => window.removeEventListener('popstate', changed)
  }, [])
  useEffect(() => {
    let active = true
    setLesson(null)
    setError('')
    fetchPod(selected).then(pod => { if (active) setLesson(pod) })
      .catch(() => { if (active) setError('This lesson could not be loaded. Choose another lesson.') })
    return () => { active = false }
  }, [selected])
  const selectLesson = (id: string) => {
    if (id === selected || !catalogue.some(pod => pod.id === id)) return
    const url = new URL(location.href)
    if (id === 'gpt2') url.searchParams.delete('lesson')
    else url.searchParams.set('lesson', id)
    history.pushState(null, '', url)
    setSelected(id)
  }
  if (!lesson) return <div style={{padding:40}} role="status">{error || 'Opening the lesson…'}
    {error && catalogue.map(item => <button key={item.id} onClick={() => selectLesson(item.id)}>{item.title}</button>)}
  </div>
  if (lesson.scene.type === 'gpu-memory') return <DeclarativeAttentionLesson key={lesson.id} pod={lesson as DeclarativeAttentionPod}
    catalogue={catalogue} onSelect={selectLesson} onSignOut={props.onSignOut} />
  if (lesson.scene.type === 'paged-kv') return <Suspense fallback={<p role="status">Opening the lesson…</p>}>
    <PagedAttentionLesson key={lesson.id} pod={lesson as PagedAttentionPod}
      catalogue={catalogue} onSelect={selectLesson} onSignOut={props.onSignOut} /></Suspense>
  return <Suspense fallback={<p role="status">Opening the transformer…</p>}><TransformerApp key={lesson.id} {...props}
    lesson={lesson as TransformerPod} catalogue={catalogue} onSelect={selectLesson} /></Suspense>
}
