import { usePodStore } from '../state/podStore'

// Top-right HUD: shows what the camera is focused on and exact numeric values
// (the "0.2f" drill-down) for the current selection.
export default function ValueInspector() {
  const focus = usePodStore((s) => s.focus)
  const inference = usePodStore((s) => s.inference)
  const activations = usePodStore((s) => s.activations)
  const precision = usePodStore((s) => s.precision)
  const inferenceLoading = usePodStore((s) => s.inferenceLoading)
  const pod = usePodStore((s) => s.pod)

  const layer = activations.index
  const sample = inference?.sample_values?.[layer] ?? []
  const norms = inference?.residual_norms?.[layer] ?? []

  return (
    <div className="inspector">
      <h3>Inspector</h3>
      <div className="row">
        <span>focus</span>
        <span>
          {focus.target}
          {focus.index !== undefined ? ` #${focus.index}` : ''}
          {focus.head !== undefined ? ` · head ${focus.head}` : ''}
        </span>
      </div>
      <div className="row">
        <span>precision</span>
        <span>{precision} dp</span>
      </div>
      {pod && (
        <div className="row">
          <span>model</span>
          <span>{pod.scene.params.model_name}</span>
        </div>
      )}
      {inferenceLoading && <div className="muted">running forward pass…</div>}

      {inference && (
        <>
          <div className="row">
            <span>tokens</span>
            <span>{inference.tokens.length}</span>
          </div>
          {activations.visible && norms.length > 0 && (
            <>
              <div className="muted" style={{ marginTop: 8 }}>
                residual ‖·‖ · block {layer}
              </div>
              {norms.map((v, t) => (
                <div className="row" key={t}>
                  <span>{inference.tokens[t]}</span>
                  <span>{v.toFixed(precision)}</span>
                </div>
              ))}
            </>
          )}
          {activations.visible && activations.mode === 'values' && sample.length > 0 && (
            <>
              <div className="muted" style={{ marginTop: 8 }}>
                hidden dims · token 0
              </div>
              <div className="values-grid">
                {sample.slice(0, 16).map((v, i) => (
                  <span key={i}>{v.toFixed(precision)}</span>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {!inference && !inferenceLoading && (
        <div className="muted" style={{ marginTop: 8 }}>
          Ask a question or press play to run the model.
        </div>
      )}
    </div>
  )
}
