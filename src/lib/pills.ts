/**
 * Pills carry state, never identity.
 *
 * Every known workflow value maps to exactly one of five semantic tones, and
 * anything unrecognised is neutral. Category names, ceremony names and free-form
 * tags are labels rather than statuses, so they stay grey: colouring them taught
 * the eye to look for meaning that was not there, which made the genuine status
 * colours harder to read.
 */
const semanticTones: Record<string, string> = {
  active: 'success', approved: 'success', attending: 'success', complete: 'success', completed: 'success', confirmed: 'success', delivered: 'success', done: 'success', locked: 'success', paid: 'success', packed: 'success', ready: 'success', received: 'success', selected: 'success', sourced: 'success',
  cancelled: 'error', declined: 'error', invalid: 'error', overdue: 'error',
  considering: 'warning', due: 'warning', pending: 'warning', planned: 'warning', pledged: 'warning', researching: 'warning', tentative: 'warning', todo: 'warning',
  appointment: 'info', doing: 'info', partial: 'info', scheduled: 'info', shortlisted: 'info',
}

export function pillTone(value: string) {
  return `pill-tone-${semanticTones[value.trim().toLocaleLowerCase()] ?? 'neutral'}`
}
