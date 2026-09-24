import { useState } from 'react'
import { CHECKPOINTS } from './checkpoints'

export default function CheckpointCard({ id, onContinue }: { id: string; onContinue: () => void }) {
  const checkpoint = CHECKPOINTS[id]
  const [selected, setSelected] = useState<number | null>(null)
  if (!checkpoint) return null
  return (
    <section className="da-checkpoint" aria-label={checkpoint.title}>
      <div>
        <span className="da-kicker">YOUR TURN · OPTIONAL CHECKPOINT</span>
        <h2>{checkpoint.title}</h2>
        <p>{checkpoint.question}</p>
      </div>
      <div className="da-checkpoint-choices">
        {checkpoint.choices.map((choice, index) => (
          <button
            key={choice.label}
            aria-pressed={selected === index}
            onClick={() => setSelected(index)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {selected !== null && (
        <p className="da-feedback" role="status">
          <strong>
            {checkpoint.choices[selected].correct ? 'That’s it. ' : 'Try that idea again. '}
          </strong>
          {checkpoint.choices[selected].feedback}
        </p>
      )}
      <button className="da-primary" onClick={onContinue}>
        {selected === null ? 'Skip and keep exploring' : 'Continue the lesson'}
      </button>
    </section>
  )
}
