import { lazy, Suspense, useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clock3, FileImage, Plus, Trash2, X } from '../KoboyoIcon'
import { archiveIdoAiConversation, dismissIdoAiSuggestion, loadIdoAiState, reviewIdoAiBatch, saveIdoAiOnboarding, sendIdoAiMessage, uploadIdoAiImage, type IdoAiBatch, type IdoAiConversation } from '../../lib/ido-ai'
import { useWorkspace } from '../../lib/workspace-context'
import './ido-ai.css'

const PANEL_KEY = 'wedding-planner:ido-ai-panel:v2'
const ReactMarkdown = lazy(() => import('react-markdown'))

type TimelineItem =
  | { kind: 'message'; id: string; createdAt: string; order: number; message: Awaited<ReturnType<typeof loadIdoAiState>>['messages'][number] }
  | { kind: 'batch'; id: string; createdAt: string; order: number; batch: IdoAiBatch }

const onboardingQuestions = [
  { eyebrow: 'Wedding setup', prompt: 'Which ceremonies are you planning?', helper: 'Choose the closest option or list every ceremony in your own words.', options: ['Court, traditional and white', 'Traditional and white', 'One main ceremony'] },
  { eyebrow: 'Dates and places', prompt: 'What dates and locations have you decided?', helper: 'Tentative information is useful too.', options: ['Dates and venues confirmed', 'Dates only', 'Still deciding'] },
  { eyebrow: 'Budget', prompt: 'What total budget are you working with?', helper: 'Include the currency. I will not add anything until you approve it.', options: ['I know the total', 'We have a range', 'Not decided yet'] },
  { eyebrow: 'Vendors', prompt: 'Which vendors do you already have?', helper: 'Tell me who is booked, shortlisted, or still being researched.', options: ['Venue only', 'Several booked', 'None yet'] },
  { eyebrow: 'Payments', prompt: 'What has already been paid for?', helper: 'Mention deposits, full payments, and anything still outstanding.', options: ['Some deposits paid', 'Everything unpaid', 'I need to check'] },
  { eyebrow: 'Priorities', prompt: 'What should the plan protect above everything else?', helper: 'This helps me order recommendations and identify tradeoffs.', options: ['Guest experience', 'Budget discipline', 'Style and atmosphere'] },
] as const

export function IdoAiWorkspace({ children }: { children: ReactNode }) {
  const { workspace, userId, isPreview } = useWorkspace()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(() => window.localStorage.getItem(PANEL_KEY) === 'open')
  const [answer, setAnswer] = useState('')
  const [composer, setComposer] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null | undefined>(undefined)
  const [optimisticMessage, setOptimisticMessage] = useState<{ id: string; body: string; attachmentName: string | null; failed: boolean } | null>(null)
  const [attachment, setAttachment] = useState<{ file: File; previewUrl: string } | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [onboardingSteps, setOnboardingSteps] = useState<Record<string, number>>(() => ({ [workspace.id]: Number(window.localStorage.getItem(`${PANEL_KEY}:${workspace.id}:step`) ?? 0) }))
  const panelRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const stateQuery = useQuery({
    queryKey: ['ido-ai', workspace.id, selectedConversationId === undefined ? 'latest' : selectedConversationId ?? 'new'],
    enabled: !isPreview,
    queryFn: () => loadIdoAiState(workspace.id, selectedConversationId),
    refetchInterval: (query) => ['queued', 'running'].includes(query.state.data?.job?.status ?? '') || query.state.data?.batches.some((batch) => batch.status === 'approved' || batch.status === 'executing') ? 1500 : false,
  })
  const state = stateQuery.data ?? { conversationId: null, conversations: [], messages: [], batches: [], job: null, onboardingStatus: 'not_started' as const, onboardingStep: 0, suggestionCount: 0, suggestions: [] }
  const onboardingStep = Math.max(onboardingSteps[workspace.id] ?? Number(window.localStorage.getItem(`${PANEL_KEY}:${workspace.id}:step`) ?? 0), state.onboardingStep)
  const shouldOnboard = stateQuery.isSuccess && (state.onboardingStatus === 'in_progress' || (state.onboardingStatus === 'not_started' && state.conversations.length === 0))
  const question = shouldOnboard && onboardingStep < onboardingQuestions.length ? onboardingQuestions[onboardingStep] : null

  useEffect(() => { window.localStorage.setItem(PANEL_KEY, open ? 'open' : 'closed') }, [open])
  useEffect(() => { window.localStorage.setItem(`${PANEL_KEY}:${workspace.id}:step`, String(onboardingStep)) }, [onboardingStep, workspace.id])
  const activitySignature = state.batches.flatMap((batch) => batch.actions.map((action) => `${action.id}:${action.status}:${action.progress}`)).join('|')
  useEffect(() => { if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }) }, [open, state.messages.length, state.batches.length, activitySignature])
  useEffect(() => {
    const textarea = composerRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`
  }, [composer])
  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  const sendMutation = useMutation({
    mutationFn: async ({ content, requestId, conversationId, file }: { content: string; requestId: string; conversationId: string; file: File | null }) => {
      const fileId = file ? await uploadIdoAiImage(workspace.id, userId, file) : undefined
      return sendIdoAiMessage(workspace.id, conversationId, content, requestId, fileId)
    },
    onSuccess: async (result) => { setSelectedConversationId(result.conversationId); clearAttachment(); await queryClient.invalidateQueries({ queryKey: ['ido-ai', workspace.id] }); setOptimisticMessage(null) },
    onError: () => setOptimisticMessage((message) => message ? { ...message, failed: true } : null),
  })
  const reviewMutation = useMutation({
    mutationFn: ({ batchId, decision }: { batchId: string; decision: 'approve' | 'reject' }) => reviewIdoAiBatch(workspace.id, batchId, decision),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ido-ai', workspace.id] }),
  })
  const archiveMutation = useMutation({
    mutationFn: () => state.conversationId ? archiveIdoAiConversation(workspace.id, state.conversationId) : Promise.resolve(),
    onSuccess: async () => { setConfirmDelete(false); setSelectedConversationId(null); await queryClient.invalidateQueries({ queryKey: ['ido-ai', workspace.id] }) },
  })
  const onboardingMutation = useMutation({
    mutationFn: ({ step, prompt, answer, completed }: { step: number; prompt: string; answer: string | null; completed: boolean }) => saveIdoAiOnboarding(workspace.id, step, prompt, answer, completed),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ido-ai', workspace.id] }),
  })
  const suggestionMutation = useMutation({
    mutationFn: (suggestionId: string) => dismissIdoAiSuggestion(workspace.id, suggestionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ido-ai', workspace.id] }),
  })

  function submitMessage(input: string, onboarding = false) {
    const value = input.trim()
    if ((!value && !attachment) || sendMutation.isPending) return
    const content = onboarding && question ? `Onboarding answer for “${question.prompt}”: ${value}` : value || 'Analyse the attached image and propose relevant planning updates.'
    if (isPreview) { setComposer(''); setAnswer(''); clearAttachment(); if (onboarding) setOnboardingSteps((steps) => ({ ...steps, [workspace.id]: onboardingStep + 1 })); return }
    const requestId = crypto.randomUUID()
    const conversationId = state.conversationId ?? crypto.randomUUID()
    setSelectedConversationId(conversationId)
    setOptimisticMessage({ id: requestId, body: content, attachmentName: attachment?.file.name ?? null, failed: false })
    setComposer('')
    setAnswer('')
    sendMutation.mutate({ content, requestId, conversationId, file: attachment?.file ?? null })
    if (onboarding && question) advanceOnboarding(value)
  }

  function advanceOnboarding(value: string | null) {
    if (!question) return
    const nextStep = onboardingStep + 1
    onboardingMutation.mutate({ step: onboardingStep, prompt: question.prompt, answer: value, completed: nextStep >= onboardingQuestions.length })
    setOnboardingSteps((steps) => ({ ...steps, [workspace.id]: nextStep }))
  }

  function startNewConversation() {
    setSelectedConversationId(null)
    setOptimisticMessage(null)
    setComposer('')
    clearAttachment()
    setHistoryOpen(false)
  }

  function selectAttachment(file: File | null) {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setAttachmentError('Choose a JPEG, PNG, or WebP image.'); return }
    if (file.size > 10 * 1024 * 1024) { setAttachmentError('Choose an image smaller than 10 MB.'); return }
    setAttachmentError(null)
    setAttachment((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl)
      return { file, previewUrl: URL.createObjectURL(file) }
    })
  }

  function clearAttachment() {
    setAttachment((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl)
      return null
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
    setAttachmentError(null)
  }

  function pasteImage(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const image = Array.from(event.clipboardData.items).find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
    if (!image) return
    event.preventDefault()
    selectAttachment(image)
  }

  const isThinking = Boolean(optimisticMessage && !optimisticMessage.failed) || (state.job?.kind === 'agent_turn' && ['queued', 'running'].includes(state.job.status))
  const timeline: TimelineItem[] = [
    ...state.messages.map((message) => ({ kind: 'message' as const, id: message.id, createdAt: message.createdAt, order: 0, message })),
    ...state.batches.filter((batch) => batch.actions.length > 0).map((batch) => {
      const reply = state.messages.find((message) => message.role === 'assistant' && ((message.runId && message.runId === batch.runId) || message.metadata.vendor_research_batch_id === batch.id))
      return { kind: 'batch' as const, id: batch.id, createdAt: reply?.createdAt ?? batch.createdAt, order: reply ? 1 : 0, batch }
    }),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.order - right.order)

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
      <header className="ido-ai-header"><div className="ido-ai-identity"><span className="ido-ai-mark"><SparkleMark /></span><span><strong>I Do AI</strong><small><i /> Wedding planning agent</small></span></div><div className="ido-ai-header-actions"><button type="button" onClick={startNewConversation} aria-label="Start new conversation"><Plus size={18} /></button><button type="button" onClick={() => setHistoryOpen((value) => !value)} aria-label="Conversation history"><Clock3 size={17} /></button>{state.conversationId && <button type="button" onClick={() => setConfirmDelete(true)} aria-label="Archive conversation"><Trash2 size={17} /></button>}<button type="button" onClick={() => setOpen(false)} aria-label="Close I Do AI"><X size={18} /></button></div></header>
      {confirmDelete && <div className="ido-ai-delete-confirm" role="alert"><div><strong>Archive this conversation?</strong><span>You can reopen it from chat history.</span></div><button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button><button type="button" disabled={archiveMutation.isPending} onClick={() => archiveMutation.mutate()}>Archive</button></div>}
      {historyOpen && <ConversationHistory conversations={state.conversations} selectedId={state.conversationId} onNew={startNewConversation} onSelect={(id) => { setSelectedConversationId(id); setHistoryOpen(false); setOptimisticMessage(null) }} onClose={() => setHistoryOpen(false)} />}
      <div className="ido-ai-scroll" ref={scrollRef} aria-live="polite">
        <div className="ido-ai-date"><span>Today</span></div>
        <article className="ido-ai-message is-assistant"><span className="ido-ai-message-mark"><SparkleMark /></span><div><strong>I Do AI</strong><p>I can set up your wedding plan, research public vendor profiles, and prepare changes across your workspace. I will always ask before changing anything.</p></div></article>
        {timeline.map((item) => item.kind === 'message'
          ? <article className={`ido-ai-message is-${item.message.role}`} key={`message:${item.id}`}>{item.message.role === 'assistant' && <span className="ido-ai-message-mark"><SparkleMark /></span>}<div><strong>{item.message.role === 'assistant' ? 'I Do AI' : 'You'}</strong>{item.message.role === 'assistant' ? <div className="ido-ai-message-body"><Suspense fallback={<span>{item.message.body}</span>}><ReactMarkdown>{item.message.body}</ReactMarkdown></Suspense></div> : <><p>{item.message.body}</p>{attachmentName(item.message.metadata) && <span className="ido-ai-message-attachment"><FileImage size={13} />{attachmentName(item.message.metadata)}</span>}</>}</div></article>
          : <BatchCard key={`batch:${item.id}`} batch={item.batch} pending={reviewMutation.isPending} approving={reviewMutation.isPending && reviewMutation.variables?.batchId === item.batch.id && reviewMutation.variables.decision === 'approve'} error={reviewMutation.variables?.batchId === item.batch.id ? reviewMutation.error?.message : undefined} onReview={(decision) => reviewMutation.mutate({ batchId: item.batch.id, decision })} />)}
        {optimisticMessage && !state.messages.some((message) => message.id === optimisticMessage.id) && <article className={`ido-ai-message is-user${optimisticMessage.failed ? ' is-failed' : ''}`}><div><strong>You</strong><p>{optimisticMessage.body}</p>{optimisticMessage.attachmentName && <span className="ido-ai-message-attachment"><FileImage size={13} />{optimisticMessage.attachmentName}</span>}{optimisticMessage.failed && <button className="ido-ai-retry" type="button" onClick={() => { setComposer(optimisticMessage.body); setOptimisticMessage(null); sendMutation.reset() }}>Retry</button>}</div></article>}
        {isThinking && <article className="ido-ai-message is-assistant ido-ai-thinking" aria-label="I Do AI is thinking"><span className="ido-ai-message-mark"><SparkleMark /></span><div><strong>I Do AI</strong><div className="ido-ai-thinking-bubble"><span /><span /><span /></div></div></article>}
        {stateQuery.isError && <p className="ido-ai-error">{stateQuery.error.message}</p>}
        {sendMutation.error && <p className="ido-ai-error">{sendMutation.error.message}</p>}
        {state.job && (state.job.kind !== 'agent_turn' || state.job.status === 'failed') && ['queued', 'running', 'failed'].includes(state.job.status) && <div className={`ido-ai-job is-${state.job.status}`}><span className="ido-ai-job-icon">{state.job.status === 'failed' ? '!' : <span className="ido-ai-spinner" />}</span><span><strong>{state.job.label}</strong><small>{state.job.detail}</small></span></div>}
        {state.suggestions.length > 0 && <section className="ido-ai-suggestions"><header><span>Needs attention</span><strong>{state.suggestions.length} planning suggestion{state.suggestions.length === 1 ? '' : 's'}</strong></header>{state.suggestions.map((suggestion) => <article key={suggestion.id}><div><strong>{suggestion.title}</strong><p>{suggestion.body}</p></div><div><button type="button" onClick={() => suggestionMutation.mutate(suggestion.id)}>Dismiss</button><button type="button" onClick={() => submitMessage(`Help me with this suggestion: ${suggestion.title}. ${suggestion.body}`)}>Discuss</button></div></article>)}</section>}
        {question && <section className="ido-ai-question" aria-labelledby="ido-ai-question-title"><div className="ido-ai-question-progress"><span>{question.eyebrow}</span><strong>{onboardingStep + 1} of {onboardingQuestions.length}</strong></div><div className="ido-ai-progress-track" aria-hidden="true"><span style={{ width: `${((onboardingStep + 1) / onboardingQuestions.length) * 100}%` }} /></div><h2 id="ido-ai-question-title">{question.prompt}</h2><p>{question.helper}</p><div className="ido-ai-choices">{question.options.map((option) => <button type="button" disabled={sendMutation.isPending} key={option} onClick={() => submitMessage(option, true)}>{option}<span aria-hidden="true">→</span></button>)}</div><form className="ido-ai-answer" onSubmit={(event) => { event.preventDefault(); submitMessage(answer, true) }}><label htmlFor="ido-ai-answer">Something else</label><textarea id="ido-ai-answer" value={answer} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => sendOnEnter(event, answer, true)} placeholder="Describe what you have in mind..." rows={3} /><div><button type="button" disabled={onboardingMutation.isPending} onClick={() => advanceOnboarding(null)}>Skip for now</button><button type="submit" disabled={!answer.trim() || sendMutation.isPending}>Continue</button></div></form>{onboardingMutation.error && <p className="ido-ai-error">{onboardingMutation.error.message}</p>}</section>}
      </div>
      <form className="ido-ai-composer" onSubmit={(event: FormEvent) => { event.preventDefault(); submitMessage(composer) }}>{attachment && <div className="ido-ai-composer-attachment"><img src={attachment.previewUrl} alt="Selected attachment preview" /><span><strong>{attachment.file.name}</strong><small>{formatFileSize(attachment.file.size)}</small></span><button type="button" onClick={clearAttachment} aria-label="Remove attached image"><X size={14} /></button></div>}{attachmentError && <p className="ido-ai-attachment-error">{attachmentError}</p>}<label className="sr-only" htmlFor="ido-ai-message">Message I Do AI</label><textarea ref={composerRef} id="ido-ai-message" rows={1} value={composer} onChange={(event) => setComposer(event.target.value)} onPaste={pasteImage} onKeyDown={(event) => sendOnEnter(event, composer)} placeholder="Ask I Do AI anything..." /><div className="ido-ai-composer-actions"><label className={`ido-ai-attach${isPreview || sendMutation.isPending ? ' is-disabled' : ''}`} title="Attach an image"><FileImage size={16} /><span className="sr-only">Attach an image</span><input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" disabled={isPreview || sendMutation.isPending} onChange={(event) => selectAttachment(event.target.files?.[0] ?? null)} /></label><span>Paste or attach an image</span><button type="submit" disabled={(!composer.trim() && !attachment) || sendMutation.isPending || isPreview} aria-label="Send message">↑</button></div></form>
    </aside>
  </div>
}

function ConversationHistory({ conversations, selectedId, onNew, onSelect, onClose }: { conversations: IdoAiConversation[]; selectedId: string | null; onNew: () => void; onSelect: (id: string) => void; onClose: () => void }) {
  return <section className="ido-ai-history" aria-label="Conversation history">
    <header><div><strong>Chat history</strong><span>Return to an earlier planning conversation.</span></div><button type="button" onClick={onClose} aria-label="Close history"><X size={18} /></button></header>
    <button className="ido-ai-new-chat" type="button" onClick={onNew}><Plus size={16} /> New chat</button>
    <div className="ido-ai-history-list">{conversations.length ? conversations.map((conversation) => <button className={conversation.id === selectedId ? 'is-selected' : ''} type="button" key={conversation.id} onClick={() => onSelect(conversation.id)}><span><strong>{conversation.title}</strong><small>{formatConversationDate(conversation.updatedAt)}</small></span><span>{conversation.status}</span></button>) : <p>No previous conversations yet.</p>}</div>
  </section>
}

function formatConversationDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function attachmentName(metadata: Record<string, unknown>) {
  return typeof metadata.file_name === 'string' && metadata.file_name.trim() ? metadata.file_name : null
}

function formatFileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function BatchCard({ batch, pending, approving, error, onReview }: { batch: IdoAiBatch; pending: boolean; approving: boolean; error?: string; onReview: (decision: 'approve' | 'reject') => void }) {
  const isResearch = batch.actions.every((action) => action.destination === 'vendor research')
  const researchAction = isResearch ? batch.actions[0] : null
  const progress = researchAction?.progress ?? (approving ? 'queued' : null)
  const sourceLabel = researchAction?.sources.map(formatResearchSource).join(', ')
  const progressCopy = progress === 'searching' ? `Searching${sourceLabel ? ` ${sourceLabel} through Google` : ' public sources'}…`
    : progress === 'processing' ? 'Processing and verifying the search results…'
    : progress === 'completed' ? 'Research complete'
    : progress === 'failed' ? 'Research failed'
    : 'Research queued…'

  return <section className="ido-ai-batch" aria-labelledby={`ido-ai-batch-title-${batch.id}`}>
    <div className="ido-ai-batch-heading"><span>{isResearch ? 'Research request' : 'Proposed actions'}</span><strong id={`ido-ai-batch-title-${batch.id}`}>{batch.summary}</strong>{isResearch && batch.status === 'proposed' && <p>Approving starts the search only. You will review the results separately before anything is added to Vendors or Venues.</p>}</div>
    {batch.actions.map((action) => <article className={`ido-ai-action is-${action.status}`} key={action.id}><div className="ido-ai-action-top"><strong>{action.title}</strong><span>{action.destination}</span></div><p>{action.description}</p>{action.status !== 'proposed' && !isResearch && <div className="ido-ai-decision"><Check size={13} /> {action.status}</div>}{action.error && <p className="ido-ai-action-error">{action.error}</p>}</article>)}
    {isResearch && progress && <div className={`ido-ai-research-progress is-${progress}`} role="status"><span className="ido-ai-job-icon">{progress === 'completed' ? <Check size={14} /> : progress === 'failed' ? '!' : <span className="ido-ai-spinner" />}</span><span><strong>{progressCopy}</strong>{sourceLabel && <small>Sources requested: {sourceLabel}</small>}</span></div>}
    {batch.status === 'proposed' && <div className="ido-ai-batch-actions"><button type="button" disabled={pending} onClick={() => onReview('reject')}>Not now</button><button type="button" disabled={pending} onClick={() => onReview('approve')}>{isResearch ? 'Start research' : 'Apply changes'}</button></div>}
    {error && <p className="ido-ai-error">{error}</p>}
  </section>
}

function formatResearchSource(source: string) {
  return source === 'google' ? 'the web' : source === 'instagram' ? 'Instagram pages' : source === 'tiktok' ? 'TikTok pages' : source
}

function SparkleMark() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.75c.3 5.35 3.9 8.95 9.25 9.25-5.35.3-8.95 3.9-9.25 9.25C11.7 15.9 8.1 12.3 2.75 12 8.1 11.7 11.7 8.1 12 2.75Z" fill="currentColor" /><path d="M19 2.5c.08 1.45 1.05 2.42 2.5 2.5-1.45.08-2.42 1.05-2.5 2.5-.08-1.45-1.05-2.42-2.5-2.5 1.45-.08 2.42-1.05 2.5-2.5Z" fill="currentColor" opacity=".65" /></svg>
}
