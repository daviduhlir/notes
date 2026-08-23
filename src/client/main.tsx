import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import DOMPurify from 'dompurify'
import { marked, type Tokens } from 'marked'
import './styles.css'

type User = { id: string; username: string }
type Note = { id: string; title: string; content: string; createdAt: string; updatedAt: string }

type SessionState = { status: 'loading' | 'authenticated' | 'unauthenticated'; user: User | null }
type ViewState = { mode: 'list' | 'detail' | 'edit'; noteId: string | null }
type ModalState = { type: 'none' } | { type: 'delete-note'; noteId: string } | { type: 'discard-changes' }
type EditorDraft = { title: string; content: string; dirty: boolean }

type ApiError = Error & { status?: number }

const taskLinePattern = /^([ \t]*)([-*+])[ \t]+\[( |x|X)\][ \t]+(.*)$/

function Icon({ name }: { name: 'add' | 'edit' | 'delete' | 'back' | 'checklist' | 'close' }) {
  const paths = {
    add: <><path d="M12 5v14M5 12h14" /></>,
    edit: <><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="m14.5 7.5 2 2" /></>,
    delete: <><path d="M4 7h16M10 11v5M14 11v5" /><path d="m6 7 1 13h10l1-13M9 7V4h6v3" /></>,
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></>,
    checklist: <><rect x="4" y="5" width="5" height="5" rx="1" /><path d="m5.5 7.5 1 1 1.5-2M12 7.5h8M12 16.5h8" /><path d="M4 14h5v5H4z" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  }
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

function IconButton({ label, icon, onClick, tone = 'quiet' }: { label: string; icon: 'add' | 'edit' | 'delete' | 'back' | 'checklist' | 'close'; onClick: () => void; tone?: 'quiet' | 'danger' }) {
  return <button className={`icon-button ${tone}`} type="button" aria-label={label} title={label} onClick={(event) => { event.stopPropagation(); onClick() }}><Icon name={icon} /></button>
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date)
}

function markdownHtml(content: string, interactive: boolean): string {
  const taskLines = content.split(/\r?\n/).map((line, index) => taskLinePattern.test(line) ? index + 1 : null).filter((line): line is number => line !== null)
  let taskIndex = 0
  const renderer = new marked.Renderer()
  renderer.listitem = function (token: Tokens.ListItem) {
    const text = this.parser.parseInline(token.tokens)
    if (!token.task) return `<li>${text}</li>`
    const line = taskLines[taskIndex++] ?? 1
    const checked = token.checked === true
    const checkbox = `<span class="markdown-checkbox${checked ? ' checked' : ''}" aria-hidden="true">${checked ? '✓' : ''}</span>`
    if (!interactive) return `<li class="task-list-item"><span class="markdown-task">${checkbox}<span>${text}</span></span></li>`
    return `<li class="task-list-item"><button type="button" class="markdown-task-button" data-task-line="${line}" data-task-checked="${checked ? 'true' : 'false'}">${checkbox}<span>${text}</span></button></li>`
  }
  const html = marked.parse(content, { gfm: true, renderer })
  return DOMPurify.sanitize(html, { ADD_ATTR: ['data-task-line', 'data-task-checked'] })
}

const api = {
  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      ...init,
    })
    if (!response.ok) {
      const error = new Error('Request failed') as ApiError
      error.status = response.status
      throw error
    }
    return response.json() as Promise<T>
  },
}

function App() {
  const [session, setSession] = useState<SessionState>({ status: 'loading', user: null })
  const [notes, setNotes] = useState<Note[]>([])
  const [view, setView] = useState<ViewState>({ mode: 'list', noteId: null })
  const [modal, setModal] = useState<ModalState>({ type: 'none' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingCheckboxes, setPendingCheckboxes] = useState<Record<string, boolean>>({})
  const [draft, setDraft] = useState<EditorDraft | null>(null)

  const currentNote = useMemo(() => notes.find((note) => note.id === view.noteId) ?? null, [notes, view.noteId])
  const currentDraft = draft ?? (currentNote ? { title: currentNote.title, content: currentNote.content, dirty: false } : null)

  useEffect(() => {
    api.request<{ user: User }>('/api/auth/me')
      .then((payload) => setSession({ status: 'authenticated', user: payload.user }))
      .catch(() => setSession({ status: 'unauthenticated', user: null }))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (session.status !== 'authenticated') return
    api.request<{ notes: Note[] }>('/api/notes').then((payload) => setNotes(payload.notes)).catch(() => setError('Failed to load notes'))
  }, [session.status])

  useEffect(() => {
    if (view.mode === 'edit' && currentNote) {
      setDraft((existing) => existing?.dirty ? existing : { title: currentNote.title, content: currentNote.content, dirty: false })
    }
  }, [view.mode, currentNote])

  async function refreshNotes() {
    const payload = await api.request<{ notes: Note[] }>('/api/notes')
    setNotes(payload.notes)
  }

  async function handleAuth(action: 'login' | 'register', username: string, password: string) {
    await api.request<{ user: User }>(`/api/auth/${action}`, { method: 'POST', body: JSON.stringify({ username, password }) })
    const me = await api.request<{ user: User }>('/api/auth/me')
    setSession({ status: 'authenticated', user: me.user })
    await refreshNotes()
  }

  async function handleLogout() {
    await api.request('/api/auth/logout', { method: 'POST' })
    setSession({ status: 'unauthenticated', user: null })
    setNotes([])
    setView({ mode: 'list', noteId: null })
  }

  async function createNote() {
    const payload = await api.request<{ note: Note }>('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ title: 'Nová poznámka', content: '' }),
    })
    setNotes((list) => [payload.note, ...list])
    setView({ mode: 'edit', noteId: payload.note.id })
    setDraft({ title: payload.note.title, content: payload.note.content, dirty: false })
  }

  async function saveNote(noteId: string, title: string, content: string) {
    const payload = await api.request<{ note: Note }>(`/api/notes/${noteId}`, {
      method: 'PUT',
      body: JSON.stringify({ title, content }),
    })
    setNotes((list) => list.map((note) => (note.id === noteId ? payload.note : note)))
    setDraft(null)
    setView({ mode: 'detail', noteId })
  }

  async function deleteNote(noteId: string) {
    await api.request(`/api/notes/${noteId}`, { method: 'DELETE' })
    setNotes((list) => list.filter((note) => note.id !== noteId))
    setView({ mode: 'list', noteId: null })
    setModal({ type: 'none' })
  }

  async function toggleCheckbox(noteId: string, line: number, expected: string, checked: boolean) {
    const key = `${noteId}:${line}`
    setPendingCheckboxes((state) => ({ ...state, [key]: checked }))
    setNotes((list) => list.map((note) => note.id === noteId ? { ...note, content: applyCheckboxChange(note.content, line, checked) } : note))
    try {
      const payload = await api.request<{ note: Note }>(`/api/notes/${noteId}/checkbox`, {
        method: 'PATCH',
        body: JSON.stringify({ line, expected, checked }),
      })
      setNotes((list) => list.map((note) => (note.id === noteId ? payload.note : note)))
    } catch (error) {
      const apiError = error as ApiError
      if (apiError.status === 409) {
        await refreshNotes()
      } else {
        setError('Checkbox update failed')
      }
    } finally {
      setPendingCheckboxes((state) => {
        const next = { ...state }
        delete next[key]
        return next
      })
    }
  }

  if (loading) return <div className="shell"><p className="muted">Loading…</p></div>
  if (session.status !== 'authenticated') return <AuthScreen onAuth={handleAuth} />

  return (
    <div className="shell">
      {view.mode === 'list' ? <header className="topbar">
          <div>
            <div className="eyebrow">A quiet place for thoughts</div>
            <h1>Notes<span className="brand-dot">.</span></h1>
          </div>
          <div className="topbar-actions">
            <button className="primary add-button" onClick={createNote}><Icon name="add" /> <span>New note</span></button>
            <button className="user-button" onClick={handleLogout} title="Log out"><span className="user-avatar">{session.user?.username?.slice(0, 1).toUpperCase()}</span><span className="user-name">{session.user?.username}</span></button>
          </div>
        </header> : null}
      {error ? <p className="error">{error}</p> : null}
      {view.mode === 'list' && <NotesGrid notes={notes} onOpen={(id) => setView({ mode: 'detail', noteId: id })} onEdit={(id) => { const note = notes.find((item) => item.id === id); if (note) setDraft({ title: note.title, content: note.content, dirty: false }); setView({ mode: 'edit', noteId: id }) }} onDelete={(id) => setModal({ type: 'delete-note', noteId: id })} />}
      {view.mode === 'detail' && currentNote ? <NoteDetail note={currentNote} onBack={() => setView({ mode: 'list', noteId: null })} onEdit={() => { setView({ mode: 'edit', noteId: currentNote.id }); setDraft({ title: currentNote.title, content: currentNote.content, dirty: false }) }} onDelete={() => setModal({ type: 'delete-note', noteId: currentNote.id })} onToggleCheckbox={toggleCheckbox} pendingCheckboxes={pendingCheckboxes} /> : null}
      {view.mode === 'edit' && currentNote && currentDraft ? <NoteEditor note={currentNote} draft={currentDraft} setDraft={setDraft} onBack={() => { if (currentDraft.dirty) setModal({ type: 'discard-changes' }); else setView({ mode: 'detail', noteId: currentNote.id }) }} onSave={saveNote} onDiscard={() => { if (currentDraft.dirty) setModal({ type: 'discard-changes' }); else setView({ mode: 'detail', noteId: currentNote.id }) }} /> : null}
      {modal.type === 'delete-note' ? <ConfirmDialog title="Delete note?" description="This note will be removed permanently." confirmLabel="Delete" tone="danger" onCancel={() => setModal({ type: 'none' })} onConfirm={() => deleteNote(modal.noteId)} /> : null}
      {modal.type === 'discard-changes' ? <ConfirmDialog title="Discard changes?" description="Unsaved changes will be lost." confirmLabel="Discard" tone="neutral" onCancel={() => setModal({ type: 'none' })} onConfirm={() => { setDraft(null); if (currentNote) setView({ mode: 'detail', noteId: currentNote.id }); setModal({ type: 'none' }) }} /> : null}
    </div>
  )
}

function AuthScreen({ onAuth }: { onAuth: (mode: 'login' | 'register', username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  return <main className="auth-shell"><form className="auth-card" onSubmit={async (event) => { event.preventDefault(); setError(null); try { await onAuth('login', username, password) } catch { setError('Login failed') } }}><h1>Notes</h1><p className="muted">Fast Markdown notes and checklists.</p><input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" autoComplete="username" /><input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" autoComplete="current-password" />{error ? <p className="error">{error}</p> : null}<div className="row"><button className="primary" type="submit">Login</button><button type="button" className="ghost" onClick={async () => { setError(null); try { await onAuth('register', username, password) } catch { setError('Registration failed') } }}>Register</button></div></form></main>
}

function NotesGrid({ notes, onOpen, onEdit, onDelete }: { notes: Note[]; onOpen: (id: string) => void; onEdit: (id: string) => void; onDelete: (id: string) => void }) {
  if (!notes.length) return <section className="empty-state"><div className="empty-mark"><Icon name="checklist" /></div><h2>Your notes start here</h2><p>Capture an idea, make a list, or clear your head.</p></section>
  return <section className="notes-grid">{notes.map((note) => <article key={note.id} className="note-card" onClick={() => onOpen(note.id)}><div className="card-topline"><h2>{note.title || 'Untitled note'}</h2><span className="card-date">{formatDate(note.updatedAt)}</span></div><MarkdownContent content={note.content || 'Empty note'} compact /><div className="card-actions"><IconButton label="Edit note" icon="edit" onClick={() => onEdit(note.id)} /><IconButton label="Delete note" icon="delete" tone="danger" onClick={() => onDelete(note.id)} /></div></article>)}</section>
}

function NoteDetail({ note, onBack, onEdit, onDelete, onToggleCheckbox, pendingCheckboxes }: { note: Note; onBack: () => void; onEdit: () => void; onDelete: () => void; onToggleCheckbox: (noteId: string, line: number, expected: string, checked: boolean) => Promise<void>; pendingCheckboxes: Record<string, boolean> }) {
  return <section className="detail"><div className="detail-toolbar"><button className="back-link" onClick={onBack}><Icon name="back" /> Notes</button><div className="detail-actions"><IconButton label="Edit note" icon="edit" onClick={onEdit} /><IconButton label="Delete note" icon="delete" tone="danger" onClick={onDelete} /></div></div><div className="document"><h2>{note.title || 'Untitled note'}</h2><MarkdownContent content={note.content} interactive noteId={note.id} onToggleCheckbox={onToggleCheckbox} pendingCheckboxes={pendingCheckboxes} /></div></section>
}

function MarkdownContent({ content, compact = false, interactive = false, noteId, onToggleCheckbox, pendingCheckboxes }: { content: string; compact?: boolean; interactive?: boolean; noteId?: string; onToggleCheckbox?: (noteId: string, line: number, expected: string, checked: boolean) => Promise<void>; pendingCheckboxes?: Record<string, boolean> }) {
  const html = useMemo(() => markdownHtml(content, interactive), [content, interactive])
  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!interactive || !noteId || !onToggleCheckbox || !pendingCheckboxes) return
    if (!(event.target instanceof HTMLElement)) return
    const button = event.target.closest('[data-task-line]')
    if (!button) return
    const line = Number(button.getAttribute('data-task-line'))
    const checked = button.getAttribute('data-task-checked') === 'true'
    const lines = content.split(/\r?\n/)
    const expected = lines[line - 1]
    const key = `${noteId}:${line}`
    if (!expected || pendingCheckboxes[key] !== undefined) return
    void onToggleCheckbox(noteId, line, expected, !checked)
  }
  return <div className={`markdown${compact ? ' markdown-compact' : ''}`} dangerouslySetInnerHTML={{ __html: html }} onClick={handleClick} />
}

function NoteEditor({ note, draft, setDraft, onBack, onSave, onDiscard }: { note: Note; draft: EditorDraft; setDraft: React.Dispatch<React.SetStateAction<EditorDraft | null>>; onBack: () => void; onSave: (noteId: string, title: string, content: string) => Promise<void>; onDiscard: () => void }) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => { textareaRef.current?.focus() }, [])
  function convertSelectionToChecklist() {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const lineStart = draft.content.lastIndexOf('\n', Math.max(0, start - 1)) + 1
    const lineEnd = draft.content.indexOf('\n', end) === -1 ? draft.content.length : draft.content.indexOf('\n', end)
    const selected = draft.content.slice(lineStart, lineEnd)
    const converted = selected.split('\n').map((line) => {
      if (!line.trim() || taskLinePattern.test(line)) return line
      const indent = line.match(/^[ \t]*/)?.[0] ?? ''
      return `${indent}- [ ] ${line.slice(indent.length)}`
    }).join('\n')
    const nextContent = `${draft.content.slice(0, lineStart)}${converted}${draft.content.slice(lineEnd)}`
    setDraft({ ...draft, content: nextContent, dirty: true })
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(lineStart, lineStart + converted.length)
    })
  }

  function handleEditorKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || textareaRef.current?.selectionStart !== textareaRef.current?.selectionEnd) return
    const textarea = textareaRef.current
    if (!textarea) return
    const cursor = textarea.selectionStart
    const lineStart = draft.content.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1
    const lineEnd = draft.content.indexOf('\n', cursor) === -1 ? draft.content.length : draft.content.indexOf('\n', cursor)
    const line = draft.content.slice(lineStart, lineEnd)
    const task = line.match(taskLinePattern)
    if (!task) return
    event.preventDefault()
    const hasText = task[4].trim().length > 0
    const insertion = hasText ? `\n${task[1]}${task[2]} [ ] ` : '\n'
    const nextContent = `${draft.content.slice(0, cursor)}${insertion}${draft.content.slice(cursor)}`
    setDraft({ ...draft, content: nextContent, dirty: true })
    requestAnimationFrame(() => {
      textarea.focus()
      const nextCursor = cursor + insertion.length
      textarea.setSelectionRange(nextCursor, nextCursor)
    })
  }

  return <section className="editor"><div className="editor-toolbar"><button className="back-link" onClick={onBack}><Icon name="back" /> Notes</button><button className="toolbar-button" type="button" onMouseDown={(event) => { event.preventDefault(); convertSelectionToChecklist() }} title="Convert selected lines to checklist"><Icon name="checklist" /><span>Checklist</span></button></div><input className="editor-title" aria-label="Title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value, dirty: true })} placeholder="Title" /><textarea ref={textareaRef} aria-label="Content" value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value, dirty: true })} onKeyDown={handleEditorKeyDown} placeholder="Write in Markdown…" /><div className="editor-bar"><button className="primary" onClick={() => onSave(note.id, draft.title, draft.content)} disabled={!draft.dirty}>Save note</button><button className="ghost" onClick={onDiscard}>Discard</button></div></section>
}

function ConfirmDialog({ title, description, confirmLabel, tone, onCancel, onConfirm }: { title: string; description: string; confirmLabel: string; tone: 'danger' | 'neutral'; onCancel: () => void; onConfirm: () => void }) {
  return <div className="dialog-backdrop"><div className="dialog" role="dialog" aria-modal="true"><h3>{title}</h3><p className="muted">{description}</p><div className="row"><button className="ghost" onClick={onCancel}>Cancel</button><button className={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</button></div></div></div>
}

function applyCheckboxChange(content: string, lineNumber: number, checked: boolean): string {
  const lines = content.split(/\r?\n/)
  const index = lineNumber - 1
  const currentLine = lines[index]
  if (currentLine === undefined) return content
  lines[index] = currentLine.replace(/^([ \t]*[-*+]\s+)\[( |x|X)\]/, `$1[${checked ? 'x' : ' '}]`)
  return lines.join('\n')
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
