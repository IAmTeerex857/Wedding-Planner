import type { IdoAiBatch } from './ido-ai'

/**
 * Canned proposals for preview mode.
 *
 * Preview has no Supabase and no agent, so the approval dock could never be
 * exercised. This stands in for the agent's reply: the shapes are the real
 * IdoAiBatch types, so the dock renders exactly what it will render in
 * production. Nothing here runs when Supabase is configured.
 */

const now = () => new Date().toISOString()
const id = () => crypto.randomUUID()

type Draft = { summary: string; actions: Array<{ title: string; description: string; destination: string }> }

const RESEARCH: Draft = {
  summary: 'Search public listings for wedding photographers in Lagos',
  actions: [{
    title: 'Research photographers',
    description: 'Search public vendor profiles and bring back a shortlist for you to review.',
    destination: 'vendor research',
  }],
}

const DRAFTS: Draft[] = [
  {
    summary: 'Add three shortlisted photographers to Vendors',
    actions: [
      { title: 'Bella Bridal Studio', description: 'Add as a vendor under Photography, status Shortlisted.', destination: 'Vendors' },
      { title: 'Lagos Light Photography', description: 'Add as a vendor under Photography, status Shortlisted.', destination: 'Vendors' },
      { title: 'Allocate NGN 850,000 to Photography', description: 'Create a spending allocation against the White ceremony.', destination: 'Budget' },
    ],
  },
  {
    summary: 'Set up the traditional ceremony run of show',
    actions: [
      { title: 'Arrival and greetings', description: 'Add a segment at 11:00 to the Traditional ceremony.', destination: 'Ceremonies' },
      { title: 'Confirm the caterer by 12 October', description: 'Create a task assigned to the planner, priority high.', destination: 'Tasks' },
    ],
  },
  {
    summary: 'Record the deposit paid to the hall',
    actions: [
      { title: 'Eko Convention Centre deposit', description: 'Add an expense of NGN 1,200,000 against Venue, marked Paid.', destination: 'Budget' },
    ],
  },
]

/** Anything that reads like a request to look something up starts a research batch. */
const RESEARCH_HINTS = ['find', 'search', 'look up', 'research', 'shortlist', 'recommend', 'suggest']

export function draftPreviewBatch(message: string): IdoAiBatch {
  const lower = message.toLocaleLowerCase()
  const wantsResearch = RESEARCH_HINTS.some((hint) => lower.includes(hint))
  const draft = wantsResearch ? RESEARCH : DRAFTS[Math.floor(Math.random() * DRAFTS.length)]

  return {
    id: id(),
    summary: draft.summary,
    status: 'proposed',
    runId: null,
    createdAt: now(),
    actions: draft.actions.map((action) => ({
      id: id(),
      title: action.title,
      description: action.description,
      destination: action.destination,
      status: 'proposed',
      sources: action.destination === 'vendor research' ? ['google', 'instagram'] : [],
      progress: null,
      error: null,
    })),
  }
}

export function previewReply(batch: IdoAiBatch, decision: 'approve' | 'reject') {
  if (decision === 'reject') return 'Left as it was. Tell me what to change and I will draft it again.'
  const count = batch.actions.length
  return batch.actions[0].destination === 'vendor research'
    ? 'Preview complete. In a live workspace, this would start the search and return results for review.'
    : `Preview complete. In a live workspace, ${count === 1 ? 'this change would' : `these ${count} changes would`} now be applied.`
}
