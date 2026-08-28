const semanticTones: Record<string, string> = {
  active: 'green', approved: 'green', attending: 'green', complete: 'green', completed: 'green', confirmed: 'green', delivered: 'green', done: 'green', locked: 'green', paid: 'green', packed: 'green', ready: 'green', received: 'green', selected: 'green', sourced: 'green',
  cancelled: 'red', declined: 'red', invalid: 'red', overdue: 'red',
  considering: 'yellow', due: 'yellow', pending: 'yellow', planned: 'yellow', pledged: 'yellow', researching: 'yellow', tentative: 'yellow', todo: 'yellow',
  appointment: 'blue', court: 'blue', doing: 'blue', scheduled: 'blue', shortlisted: 'blue',
  personal: 'purple', traditional: 'purple',
  payment: 'pink', white: 'pink',
}

const tones = ['blue', 'green', 'yellow', 'purple', 'pink'] as const

export function pillTone(value: string) {
  const normalized = value.trim().toLocaleLowerCase()
  const semantic = semanticTones[normalized]
  if (semantic) return `pill-tone-${semantic}`
  let hash = 0
  for (const character of normalized) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  return `pill-tone-${tones[Math.abs(hash) % tones.length]}`
}
