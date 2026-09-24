export interface Checkpoint {
  title: string
  question: string
  choices: { label: string; feedback: string; correct: boolean }[]
}

export const CHECKPOINTS: Record<string, Checkpoint> = {
  'read-set': {
    title: 'Predict the next read',
    question: 'The model declared focus on C3. What must the next word read?',
    choices: [
      {
        label: 'Only C3',
        correct: false,
        feedback: 'C3 is selected, but SYS (the instructions and question) and the reply so far are still needed.',
      },
      {
        label: 'SYS + C3 + the reply so far',
        correct: true,
        feedback:
          'Exactly. Focus only filters the documents, never SYS or the reply so far. Watch those three sources next.',
      },
      {
        label: 'Every document, just more slowly',
        correct: false,
        feedback:
          'Focus really skips the other documents for this word. They stay in their seats, but their bytes are not read in this simulated step.',
      },
    ],
  },
  residency: {
    title: 'Did we free any VRAM?',
    question: 'When a document dims because focus skips it, what happens to its KV cache?',
    choices: [
      {
        label: 'They moved to CPU RAM',
        correct: false,
        feedback:
          'No offload occurs. Dim means excluded from the current read, not moved across PCIe.',
      },
      {
        label: 'They were deleted to save memory',
        correct: false,
        feedback:
          'Nothing is deleted. Global can read them again right away because their KV never left GPU memory.',
      },
      {
        label: 'They stayed in their original seats',
        correct: true,
        feedback:
          'Yes. Read traffic fell; memory use did not. Global can read every document again without fetching anything back.',
      },
    ],
  },
  local: {
    title: 'Does local read nothing?',
    question: 'Local skips all four documents. Why is the read bar still above zero?',
    choices: [
      {
        label: 'SYS and the reply so far are still read',
        correct: true,
        feedback:
          'Right. Local is not zero attention. It keeps reading the instructions and question (SYS) and the reply written so far.',
      },
      {
        label: 'The display has not refreshed',
        correct: false,
        feedback:
          'The bar is up to date. SYS and the reply so far are read in every mode, so it never reaches zero.',
      },
      {
        label: 'All documents secretly remain selected',
        correct: false,
        feedback:
          'The documents really are skipped. Being stored in GPU memory is not the same as being read.',
      },
    ],
  },
}
