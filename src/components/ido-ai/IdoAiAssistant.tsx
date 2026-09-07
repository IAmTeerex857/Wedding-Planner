import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Trash2, X } from '../KoboyoIcon'
import { deleteIdoAiConversation, dismissIdoAiSuggestion, loadIdoAiState, reviewIdoAiBatch, sendIdoAiMessage } from '../../lib/ido-ai'
import { useWorkspace } from '../../lib/workspace-context'
import './ido-ai.css'

const PANEL_KEY = 'wedding-planner:ido-ai-panel:v2'
const ReactMarkdown = lazy(() => import('react-markdown'))

const onboardingQuestions = [
  { eyebrow: 'Wedding setup', prompt: 'Which ceremonies are you planning?', helper: 'Choose the closest option or list every ceremony in your own words.', options: ['Court, traditional and white', 'Traditional and white', 'One main ceremony'] },
  { eyebrow: 'Dates and places', prompt: 'What dates and locations have you decided?', helper: 'Tentative information is useful too.', options: ['Dates and venues confirmed', 'Dates only', 'Still deciding'] },
  { eyebrow: 'Budget', prompt: 'What total budget are you working with?', helper: 'Include the currency. I will not add anything until you approve it.', options: ['I know the total', 'We have a range', 'Not decided yet'] },
  { eyebrow: 'Vendors', prompt: 'Which vendors do you already have?', helper: 'Tell me who is booked, shortlisted, or still being researched.', options: ['Venue only', 'Several booked', 'None yet'] },
  { eyebrow: 'Payments', prompt: 'What has already been paid for?', helper: 'Mention deposits, full payments, and anything still outstanding.', options: ['Some deposits paid', 'Everything unpaid', 'I need to check'] },
  { eyebrow: 'Priorities', prompt: 'What should the plan protect above everything else?', helper: 'This helps me order recommendations and identify tradeoffs.', options: ['Guest experience', 'Budget discipline', 'Style and atmosphere'] },
] as const

export function IdoAiWorkspace({ children }: { children: ReactNode }) {
  const { workspace, isPreview } = useWorkspace()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(() => window.localStorage.getItem(PANEL_KEY) === 'open')
  const [answer, setAnswer] = useState('')
  const [composer, setComposer] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [optimisticMessage, setOptimisticMessage] = useState<{ id: string; body: string; failed: boolean } | null>(null)
  const [onboardingStep, setOnboardingStep] = useState(() => Number(window.localStorage.getItem(`${PANEL_KEY}:${workspace.id}:step`) ?? 0))
  const panelRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stateQuery = useQuery({
    queryKey: ['ido-ai', workspace.id],
    enabled: !isPreview,
    queryFn: () => loadIdoAiState(workspace.id),
    refetchInterval: (query) => ['queued', 'running'].includes(query.state.data?.job?.status ?? '') || query.state.data?.batches.some((batch) => batch.status === 'approved' || batch.status === 'executing') ? 1500 : false,
  })
  const state = stateQuery.data ?? { conversationId: null, messages: [], batches: [], job: null, suggestionCount: 0, suggestions: [] }
  const question = onboardingStep < onboardingQuestions.length ? onboardingQuestions[onboardingStep] : null

  useEffect(() => { window.localStorage.setItem(PANEL_KEY, open ? 'open' : 'closed') }, [open])
  useEffect(() => { window.localStorage.setItem(`${PANEL_KEY}:${workspace.id}:step`, String(onboardingStep)) }, [onboardingStep, workspace.id])
  useEffect(() => { if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }) }, [open, state.messages.length, state.batches.length])
  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  const sendMutation = useMutation({
    mutationFn: ({ content, requestId }: { content: string; requestId: string }) => sendIdoAiMessage(workspace.id, state.conversationId, content, requestId),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['ido-ai', workspace.id] }); setOptimisticMessage(null) },
    onError: () => setOptimisticMessage((message) => message ? { ...message, failed: true } : null),
  })
  const reviewMutation = useMutation({
    mutationFn: ({ batchId, decision }: { batchId: string; decision: 'approve' | 'reject' }) => reviewIdoAiBatch(workspace.id, batchId, decision),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ido-ai', workspace.id] }),
  })
  const deleteMutation = useMutation({
    mutationFn: () => state.conversationId ? deleteIdoAiConversation(workspace.id, state.conversationId) : Promise.resolve(),
    onSuccess: async () => { setConfirmDelete(false); setOnboardingStep(0); await queryClient.invalidateQueries({ queryKey: ['ido-ai', workspace.id] }) },
  })
  const suggestionMutation = useMutation({
    mutationFn: (suggestionId: string) => dismissIdoAiSuggestion(workspace.id, suggestionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ido-ai', workspace.id] }),
  })

  function submitMessage(input: string, onboarding = false) {
    const value = input.trim()
    if (!value || sendMutation.isPending) return
    const content = onboarding && question ? `Onboarding answer for “${question.prompt}”: ${value}` : value
    if (isPreview) { setComposer(''); setAnswer(''); if (onboarding) setOnboardingStep((step) => step + 1); return }
    const requestId = crypto.randomUUID()
    setOptimisticMessage({ id: requestId, body: content, failed: false })
    setComposer('')
    setAnswer('')
    sendMutation.mutate({ content, requestId })
    if (onboarding) setOnboardingStep((step) => step + 1)
  }

  const activeBatch = state.batches.find((batch) => batch.status === 'proposed' || batch.status === 'approved' || batch.status === 'executing' || batch.status === 'failed')
  const hasActivity = state.messages.length > 0
  const isThinking = Boolean(optimisticMessage && !optimisticMessage.failed) || (state.job?.kind === 'agent_turn' && ['queued', 'running'].includes(state.job.status))
  const isResearchBatch = Boolean(activeBatch?.actions.length && activeBatch.actions.every((action) => action.destination === 'vendor research'))

  function sendOnEnter(event: ReactKeyboardEvent<HTMLTextAreaElement>, value: string, onboarding = false) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    submitMessage(value, onboarding)
  }

  return <div className={`ido-ai-workspace${open ? ' is-agent-open' : ''}`}>
    <div className="ido-ai-page-slot">{children}</div>
    {!open && <button className="ido-ai-launcher" type="button" onClick={() => setOpen(true)} aria-label="Open I Do AI"><SparkleMark /><span>I Do AI</span>{state.suggestionCount > 0 && <b>{state.suggestionCount}</b>}</button>}
    {open && <button className="ido-ai-backdrop" type="button" aria-label="Close I Do AI" onClick={() => setOpen(false)} />}
    <aside className="ido-ai-panel" ref={panelRef} aria-label="I Do AI assistant" aria-hidden={!open} tabIndex={-1}>
      <header className="ido-ai-header"><div className="ido-ai-identity"><span className="ido-ai-mark"><SparkleMark /></span><span><strong>I Do AI</strong><small><i /> Wedding planning agent</small></span></div><div className="ido-ai-header-actions"><button type="button" onClick={() => setConfirmDelete(true)} aria-label="Delete conversation"><Trash2 size={17} /></button><button type="button" onClick={() => setOpen(false)} aria-label="Close I Do AI"><X size={18} /></button></div></header>
      {confirmDelete && <div className="ido-ai-delete-confirm" role="alert"><div><strong>Start a new conversation?</strong><span>This clears the current chat and proposals.</span></div><button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button><button type="button" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>Delete</button></div>}
      <div className="ido-ai-scroll" ref={scrollRef} aria-live="polite">
        <div className="ido-ai-date"><span>Today</span></div>
        {!hasActivity && <article className="ido-ai-message is-assistant"><span className="ido-ai-message-mark"><SparkleMark /></span><div><strong>I Do AI</strong><p>I can set up your wedding plan, research public vendor profiles, and prepare changes across your workspace. I will always ask before changing anything.</p></div></article>}
        {state.messages.map((message) => <article className={`ido-ai-message is-${message.role}`} key={message.id}>{message.role === 'assistant' && <span className="ido-ai-message-mark"><SparkleMark /></span>}<div><strong>{message.role === 'assistant' ? 'I Do AI' : 'You'}</strong>{message.role === 'assistant' ? <div className="ido-ai-message-body"><Suspense fallback={<span>{message.body}</span>}><ReactMarkdown>{message.body}</ReactMarkdown></Suspense></div> : <p>{message.body}</p>}</div></article>)}
        {optimisticMessage && !state.messages.some((message) => message.id === optimisticMessage.id) && <article className={`ido-ai-message is-user${optimisticMessage.failed ? ' is-failed' : ''}`}><div><strong>You</strong><p>{optimisticMessage.body}</p>{optimisticMessage.failed && <button className="ido-ai-retry" type="button" onClick={() => { setComposer(optimisticMessage.body); setOptimisticMessage(null); sendMutation.reset() }}>Retry</button>}</div></article>}
        {isThinking && <article className="ido-ai-message is-assistant ido-ai-thinking" aria-label="I Do AI is thinking"><span className="ido-ai-message-mark"><SparkleMark /></span><div><strong>I Do AI</strong><div className="ido-ai-thinking-bubble"><span /><span /><span /></div></div></article>}
        {stateQuery.isError && <p className="ido-ai-error">{stateQuery.error.message}</p>}
        {sendMutation.error && <p className="ido-ai-error">{sendMutation.error.message}</p>}
        {state.job && (state.job.kind !== 'agent_turn' || state.job.status === 'failed') && ['queued', 'running', 'failed'].includes(state.job.status) && <div className={`ido-ai-job is-${state.job.status}`}><span className="ido-ai-job-icon">{state.job.status === 'failed' ? '!' : <span className="ido-ai-spinner" />}</span><span><strong>{state.job.label}</strong><small>{state.job.detail}</small></span></div>}
        {state.suggestions.length > 0 && <section className="ido-ai-suggestions"><header><span>Needs attention</span><strong>{state.suggestions.length} planning suggestion{state.suggestions.length === 1 ? '' : 's'}</strong></header>{state.suggestions.map((suggestion) => <article key={suggestion.id}><div><strong>{suggestion.title}</strong><p>{suggestion.body}</p></div><div><button type="button" onClick={() => suggestionMutation.mutate(suggestion.id)}>Dismiss</button><button type="button" onClick={() => submitMessage(`Help me with this suggestion: ${suggestion.title}. ${suggestion.body}`)}>Discuss</button></div></article>)}</section>}
        {question && <section className="ido-ai-question" aria-labelledby="ido-ai-question-title"><div className="ido-ai-question-progress"><span>{question.eyebrow}</span><strong>{onboardingStep + 1} of {onboardingQuestions.length}</strong></div><div className="ido-ai-progress-track" aria-hidden="true"><span style={{ width: `${((onboardingStep + 1) / onboardingQuestions.length) * 100}%` }} /></div><h2 id="ido-ai-question-title">{question.prompt}</h2><p>{question.helper}</p><div className="ido-ai-choices">{question.options.map((option) => <button type="button" disabled={sendMutation.isPending} key={option} onClick={() => submitMessage(option, true)}>{option}<span aria-hidden="true">→</span></button>)}</div><form className="ido-ai-answer" onSubmit={(event) => { event.preventDefault(); submitMessage(answer, true) }}><label htmlFor="ido-ai-answer">Something else</label><textarea id="ido-ai-answer" value={answer} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => sendOnEnter(event, answer, true)} placeholder="Describe what you have in mind..." rows={3} /><div><button type="button" onClick={() => setOnboardingStep((step) => step + 1)}>Skip for now</button><button type="submit" disabled={!answer.trim() || sendMutation.isPending}>Continue</button></div></form></section>}
        {activeBatch && <section className="ido-ai-batch" aria-labelledby="ido-ai-batch-title"><div className="ido-ai-batch-heading"><span>{isResearchBatch ? 'Research request' : 'Proposed actions'}</span><strong id="ido-ai-batch-title">{activeBatch.summary}</strong>{isResearchBatch && <p>Approving starts the search only. You will review the results separately before anything is added to Vendors or Venues.</p>}</div>{activeBatch.actions.map((action) => <article className={`ido-ai-action is-${action.status}`} key={action.id}><div className="ido-ai-action-top"><strong>{action.title}</strong><span>{action.destination}</span></div><p>{action.description}</p>{action.status !== 'proposed' && <div className="ido-ai-decision"><Check size={13} /> {action.status}</div>}</article>)}{activeBatch.status === 'proposed' && <div className="ido-ai-batch-actions"><button type="button" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate({ batchId: activeBatch.id, decision: 'reject' })}>Not now</button><button type="button" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate({ batchId: activeBatch.id, decision: 'approve' })}>{isResearchBatch ? 'Start research' : 'Apply changes'}</button></div>}{reviewMutation.error && <p className="ido-ai-error">{reviewMutation.error.message}</p>}</section>}
      </div>
      <form className="ido-ai-composer" onSubmit={(event: FormEvent) => { event.preventDefault(); submitMessage(composer) }}><label className="sr-only" htmlFor="ido-ai-message">Message I Do AI</label><textarea id="ido-ai-message" rows={2} value={composer} onChange={(event) => setComposer(event.target.value)} onKeyDown={(event) => sendOnEnter(event, composer)} placeholder="Ask I Do AI anything..." /><div><span>Enter to send · Shift + Enter for a new line</span><button type="submit" disabled={!composer.trim() || sendMutation.isPending || isPreview} aria-label="Send message">↑</button></div></form>
    </aside>
  </div>
}

function SparkleMark() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.75c.3 5.35 3.9 8.95 9.25 9.25-5.35.3-8.95 3.9-9.25 9.25C11.7 15.9 8.1 12.3 2.75 12 8.1 11.7 11.7 8.1 12 2.75Z" fill="currentColor" /><path d="M19 2.5c.08 1.45 1.05 2.42 2.5 2.5-1.45.08-2.42 1.05-2.5 2.5-.08-1.45-1.05-2.42-2.5-2.5 1.45-.08 2.42-1.05 2.5-2.5Z" fill="currentColor" opacity=".65" /></svg>
}
