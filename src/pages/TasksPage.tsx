import { AlignJustify, Columns3, Pencil, Plus, Trash2, UserRound, X } from '../components/KoboyoIcon'
import { useEffect, useEffectEvent, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { pillTone } from '../lib/pills'
import { relationOne, useWorkspace } from '../lib/workspace-context'
import './planning.css'

export type TaskStatus = 'todo' | 'doing' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'
export type TaskEvent = 'Court' | 'Traditional' | 'White' | 'General'

export interface PlanningTask {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assignee: string
  event: TaskEvent
  dueAt: string
  reminderAt: string
}

type TaskDraft = Omit<PlanningTask, 'id'>
type TaskView = 'list' | 'kanban'

const columns: Array<{ id: TaskStatus; label: string; hint: string }> = [
  { id: 'todo', label: 'To Do', hint: 'Tasks ready to begin will appear here.' },
  { id: 'doing', label: 'Doing', hint: 'Move active work here to keep it visible.' },
  { id: 'done', label: 'Done', hint: 'Completed tasks will collect here.' },
]

const emptyDraft: TaskDraft = {
  title: '',
  description: '',
  status: 'todo',
  priority: 'medium',
  assignee: '',
  event: 'General',
  dueAt: '',
  reminderAt: '',
}

export function TasksPage() {
  const [searchParams] = useSearchParams()
  const { workspace, userId, isPreview } = useWorkspace()
  const queryClient = useQueryClient()
  const [tasks, setTasks] = useState<PlanningTask[]>([])
  const [view, setView] = useState<TaskView>('list')
  const [isAdding, setIsAdding] = useState(() => searchParams.get('new') === '1')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<TaskDraft>(emptyDraft)
  const ceremonyQuery = useQuery({
    queryKey: ['ceremony-options', workspace.id],
    enabled: !isPreview,
    queryFn: async () => {
      const { data, error } = await supabase!.from('ceremonies').select('id,kind').eq('workspace_id', workspace.id).is('deleted_at', null)
      if (error) throw error
      return data
    },
  })
  const tasksQuery = useQuery({
    queryKey: ['tasks', workspace.id],
    enabled: !isPreview,
    queryFn: async () => {
      const { data, error } = await supabase!.from('tasks').select('id,title,description,status,priority,assignee_name,due_at,reminder_at,task_ceremonies(ceremonies(kind))').eq('workspace_id', workspace.id).is('deleted_at', null).order('created_at')
      if (error) throw error
      return data
    },
  })
  const addMutation = useMutation({
    mutationFn: async (task: TaskDraft) => {
      const ceremony = task.event === 'General' ? null : ceremonyQuery.data?.find((item) => item.kind === task.event.toLocaleLowerCase())
      if (task.event !== 'General' && !ceremony) throw new Error(`${task.event} ceremony is unavailable`)
      const { data, error } = await supabase!.from('tasks').insert({ workspace_id: workspace.id, title: task.title, description: task.description || null, status: task.status, priority: task.priority, assignee_name: task.assignee || null, due_at: lagosDateTime(task.dueAt), reminder_at: lagosDateTime(task.reminderAt), created_by: userId, updated_by: userId }).select('id').single()
      if (error) throw error
      if (ceremony) {
        const { error: linkError } = await supabase!.from('task_ceremonies').insert({ task_id: data.id, ceremony_id: ceremony.id })
        if (linkError) {
          await supabase!.from('tasks').update({ deleted_at: new Date().toISOString(), updated_by: userId }).eq('id', data.id)
          throw linkError
        }
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks', workspace.id] }),
  })
  const updateMutation = useMutation({
    mutationFn: async ({ id, task }: { id: string; task: TaskDraft }) => {
      const ceremony = task.event === 'General' ? null : ceremonyQuery.data?.find((item) => item.kind === task.event.toLocaleLowerCase())
      if (task.event !== 'General' && !ceremony) throw new Error(`${task.event} ceremony is unavailable`)
      const { error } = await supabase!.from('tasks').update({ title: task.title, description: task.description || null, status: task.status, priority: task.priority, assignee_name: task.assignee || null, due_at: lagosDateTime(task.dueAt), reminder_at: lagosDateTime(task.reminderAt), completed_at: task.status === 'done' ? new Date().toISOString() : null, updated_by: userId }).eq('id', id).eq('workspace_id', workspace.id)
      if (error) throw error
      if (ceremony) {
        const { error: linkError } = await supabase!.from('task_ceremonies').upsert({ task_id: id, ceremony_id: ceremony.id }, { onConflict: 'task_id,ceremony_id', ignoreDuplicates: true })
        if (linkError) throw linkError
        const { error: cleanupError } = await supabase!.from('task_ceremonies').delete().eq('task_id', id).neq('ceremony_id', ceremony.id)
        if (cleanupError) throw cleanupError
      } else {
        const { error: linkError } = await supabase!.from('task_ceremonies').delete().eq('task_id', id)
        if (linkError) throw linkError
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks', workspace.id] })
      closeModal()
    },
  })
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase!.from('tasks').update({ deleted_at: new Date().toISOString(), updated_by: userId }).eq('id', id).eq('workspace_id', workspace.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks', workspace.id] }),
    onError: () => queryClient.invalidateQueries({ queryKey: ['tasks', workspace.id] }),
  })
  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TaskStatus }) => {
      const { error } = await supabase!.from('tasks').update({ status, completed_at: status === 'done' ? new Date().toISOString() : null, updated_by: userId }).eq('id', id).eq('workspace_id', workspace.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks', workspace.id] }),
    onError: () => queryClient.invalidateQueries({ queryKey: ['tasks', workspace.id] }),
  })

  useEffect(() => {
    if (!tasksQuery.data) return
    // Keep the editable list aligned with successful remote fetches and mutations.
    // oxlint-disable-next-line react/set-state-in-effect
    setTasks(tasksQuery.data.map((task) => {
      const links = Array.isArray(task.task_ceremonies) ? task.task_ceremonies : []
      const kind = relationOne(links[0]?.ceremonies)?.kind as string | undefined
      const event = kind ? `${kind[0].toUpperCase()}${kind.slice(1)}` as TaskEvent : 'General'
      return { id: task.id, title: task.title, description: task.description ?? '', status: task.status as TaskStatus, priority: ['low', 'medium', 'high'].includes(task.priority) ? task.priority as TaskPriority : 'medium', assignee: task.assignee_name ?? '', event, dueAt: localDateTime(task.due_at), reminderAt: localDateTime(task.reminder_at) }
    }))
  }, [tasksQuery.data])

  function closeModal() {
    setIsAdding(false)
    setEditingId(null)
    setDraft(emptyDraft)
    addMutation.reset()
    updateMutation.reset()
  }
  const closeModalEvent = useEffectEvent(closeModal)

  useEffect(() => {
    if (!isAdding && !editingId) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeModalEvent()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isAdding, editingId])

  function editTask(task: PlanningTask) {
    setDraft({ title: task.title, description: task.description, status: task.status, priority: task.priority, assignee: task.assignee, event: task.event, dueAt: task.dueAt, reminderAt: task.reminderAt })
    setEditingId(task.id)
  }

  function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = draft.title.trim()
    if (!title) return
    const cleanDraft = { ...draft, title, description: draft.description.trim(), assignee: draft.assignee.trim() }
    if (isPreview) {
      setTasks((current) => editingId ? current.map((task) => task.id === editingId ? { ...cleanDraft, id: editingId } : task) : [...current, { ...cleanDraft, id: crypto.randomUUID() }])
      closeModal()
    } else if (editingId) updateMutation.mutate({ id: editingId, task: cleanDraft })
    else addMutation.mutate(cleanDraft, { onSuccess: closeModal })
  }

  function moveTask(id: string, status: TaskStatus) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, status } : task))
    if (!isPreview) statusMutation.mutate({ id, status })
  }

  function removeTask(id: string) {
    setTasks((current) => current.filter((task) => task.id !== id))
    if (!isPreview) deleteMutation.mutate(id)
  }

  return (
    <div className="page planning-page tasks-page">
      <header className="page-header tasks-header">
        <div>
          <p className="eyebrow">Planning desk / {tasks.filter(({ status }) => status !== 'done').length} open</p>
          <h1>Tasks</h1>
          <p className="page-lead">Assign the next action, connect it to a celebration, and keep work moving.</p>
        </div>
        <button className="button primary" type="button" onClick={() => setIsAdding(true)}><Plus size={16} /> Add task</button>
      </header>

      <div className="task-toolbar">
        <div className="view-switch" aria-label="Task view">
          <button className={view === 'list' ? 'active' : ''} type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
            <AlignJustify size={14} /> List
          </button>
          <button className={view === 'kanban' ? 'active' : ''} type="button" aria-pressed={view === 'kanban'} onClick={() => setView('kanban')}>
            <Columns3 size={14} /> Board
          </button>
        </div>
        <span className="task-count">{tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}</span>
      </div>
      {(tasksQuery.error || addMutation.error || updateMutation.error || deleteMutation.error || statusMutation.error) && <p className="data-error">{tasksQuery.error?.message ?? addMutation.error?.message ?? updateMutation.error?.message ?? deleteMutation.error?.message ?? statusMutation.error?.message}</p>}

      {view === 'list' ? (
        <section className="task-list" aria-label="Task list">
          <div className="task-list-head"><span>Task</span><span>Event</span><span>Owner</span><span>Status</span></div>
          {tasks.length === 0 ? (
            <TaskEmpty title="Your task list is clear" detail="Add a task when there is something to decide, book, buy, or follow up." onAdd={() => setIsAdding(true)} />
          ) : tasks.map((task) => (
             <TaskListRow task={task} onMove={moveTask} onEdit={editTask} onRemove={removeTask} key={task.id} />
          ))}
        </section>
      ) : (
        <section className="kanban-board" aria-label="Task board">
          {columns.map((column) => {
            const columnTasks = tasks.filter(({ status }) => status === column.id)
            return (
              <div className="kanban-column" key={column.id}>
                <div className="kanban-heading"><h2>{column.label}</h2><span>{columnTasks.length}</span></div>
                <div className="kanban-stack">
                  {columnTasks.length === 0 ? (
                    <div className="column-empty"><span>Empty</span><p>{column.hint}</p></div>
                  ) : columnTasks.map((task) => <TaskCard task={task} onMove={moveTask} onEdit={editTask} onRemove={removeTask} key={task.id} />)}
                </div>
                {column.id === 'todo' && <button className="add-inline" type="button" onClick={() => setIsAdding(true)}><Plus size={14} /> Add task</button>}
              </div>
            )
          })}
        </section>
      )}

      {(isAdding || editingId) && (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeModal()}>
          <section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="task-form-title">
            <div className="modal-header">
              <div><p className="eyebrow">{editingId ? 'Update action' : 'New action'}</p><h2 id="task-form-title">{editingId ? 'Edit task' : 'Add a task'}</h2></div>
              <button className="plain-icon-button" type="button" aria-label="Close" onClick={closeModal}><X size={18} /></button>
            </div>
            <form onSubmit={addTask}>
              <label className="planning-field field-full">
                <span>Task name</span>
                <input autoFocus required value={draft.title} placeholder="What needs to happen?" onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
              </label>
              <label className="planning-field field-full">
                <span>Notes <small>Optional</small></span>
                <textarea value={draft.description} placeholder="Add context or a useful next step" onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
              </label>
              <div className="task-form-grid">
                <label className="planning-field">
                  <span>Status</span>
                  <select className={pillTone(draft.status)} value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as TaskStatus })}>
                    {columns.map((column) => <option value={column.id} key={column.id}>{column.label}</option>)}
                  </select>
                </label>
                <label className="planning-field">
                  <span>Priority</span>
                  <select className={pillTone(draft.priority)} value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as TaskPriority })}>
                    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                  </select>
                </label>
                <label className="planning-field">
                  <span>Event</span>
                  <select className={pillTone(draft.event)} value={draft.event} onChange={(event) => setDraft({ ...draft, event: event.target.value as TaskEvent })}>
                    <option>General</option><option>Court</option><option>Traditional</option><option>White</option>
                  </select>
                </label>
                <label className="planning-field">
                  <span>Assignee <small>Optional</small></span>
                  <input value={draft.assignee} placeholder="Enter a name" onChange={(event) => setDraft({ ...draft, assignee: event.target.value })} />
                </label>
                <label className="planning-field">
                  <span>Deadline <small>Optional</small></span>
                  <input type="datetime-local" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} />
                </label>
                <label className="planning-field">
                  <span>Email reminder <small>Optional</small></span>
                  <input type="datetime-local" value={draft.reminderAt} onChange={(event) => setDraft({ ...draft, reminderAt: event.target.value })} />
                </label>
              </div>
              <div className="modal-actions">
                {editingId && <button className="button danger" type="button" disabled={deleteMutation.isPending} onClick={() => { removeTask(editingId); closeModal() }}><Trash2 size={14} /> Delete</button>}
                <button className="button secondary" type="button" onClick={closeModal}>Cancel</button>
                <button className="button primary" type="submit" disabled={addMutation.isPending || updateMutation.isPending}>{addMutation.isPending || updateMutation.isPending ? 'Saving...' : editingId ? 'Save changes' : 'Add task'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

function TaskListRow({ task, onMove, onEdit, onRemove }: { task: PlanningTask; onMove: (id: string, status: TaskStatus) => void; onEdit: (task: PlanningTask) => void; onRemove: (id: string) => void }) {
  return (
    <article className="task-list-row">
      <div className="task-title-cell">
        <span className={`priority-mark priority-${task.priority}`} />
        <div><strong>{task.title}</strong><p>{[task.description, task.dueAt ? `Due ${new Date(task.dueAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}` : ''].filter(Boolean).join(' / ')}</p></div>
      </div>
      <EventTag event={task.event} />
      <span className="assignee"><UserRound size={13} /> {task.assignee || 'Unassigned'}</span>
      <StatusControl task={task} onMove={onMove} />
      <TaskActions task={task} onEdit={onEdit} onRemove={onRemove} />
    </article>
  )
}

function lagosDateTime(value: string) { return value ? new Date(`${value}:00+01:00`).toISOString() : null }
function localDateTime(value: string | null) { if (!value) return ''; const date = new Date(value); const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date); const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''; return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}` }

function TaskCard({ task, onMove, onEdit, onRemove }: { task: PlanningTask; onMove: (id: string, status: TaskStatus) => void; onEdit: (task: PlanningTask) => void; onRemove: (id: string) => void }) {
  return (
    <article className="task-card">
      <div className="task-card-top"><EventTag event={task.event} /><div className="task-card-actions"><span className={`priority-label priority-${task.priority}`}>{task.priority}</span><TaskActions task={task} onEdit={onEdit} onRemove={onRemove} /></div></div>
      <h3>{task.title}</h3>
      {task.description && <p>{task.description}</p>}
      <div className="task-card-foot"><span className="assignee"><UserRound size={13} /> {task.assignee || 'Unassigned'}</span><StatusControl task={task} onMove={onMove} /></div>
    </article>
  )
}

function TaskActions({ task, onEdit, onRemove }: { task: PlanningTask; onEdit: (task: PlanningTask) => void; onRemove: (id: string) => void }) {
  return <span className="task-actions"><button type="button" aria-label={`Edit ${task.title}`} onClick={() => onEdit(task)}><Pencil size={13} /></button><button type="button" aria-label={`Delete ${task.title}`} onClick={() => onRemove(task.id)}><Trash2 size={13} /></button></span>
}

function EventTag({ event }: { event: TaskEvent }) {
  return <span className={`event-tag event-${event.toLowerCase()}`}>{event}</span>
}

function StatusControl({ task, onMove }: { task: PlanningTask; onMove: (id: string, status: TaskStatus) => void }) {
  return (
    <select className={`task-status-control ${pillTone(task.status)}`} aria-label={`Status for ${task.title}`} value={task.status} onChange={(event) => onMove(task.id, event.target.value as TaskStatus)}>
      {columns.map((column) => <option value={column.id} key={column.id}>{column.label}</option>)}
    </select>
  )
}

function TaskEmpty({ title, detail, onAdd }: { title: string; detail: string; onAdd: () => void }) {
  return (
    <div className="task-empty">
      <span className="empty-plus"><Plus size={19} /></span>
      <h2>{title}</h2><p>{detail}</p>
      <button className="text-action" type="button" onClick={onAdd}>Create the first task</button>
    </div>
  )
}
