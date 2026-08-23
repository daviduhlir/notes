import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { ArrowLeftIcon, ChecklistIcon, CheckIcon, PencilIcon, PlusIcon, TrashIcon } from './assets/appIcons'

type User = { id: string; username: string }
type Note = { id: string; title: string; content: string; createdAt: string; updatedAt: string }
type SessionState = { status: 'loading' | 'authenticated' | 'unauthenticated'; user: User | null }
type ViewState = { mode: 'list' | 'detail' | 'edit'; noteId: string | null }
type ModalState = { type: 'none' } | { type: 'delete-note'; noteId: string } | { type: 'discard-changes' }
type EditorDraft = { title: string; content: string; dirty: boolean }

const api = {
  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, ...init })
    if (!response.ok) throw Object.assign(new Error('Request failed'), { status: response.status })
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

  useEffect(() => { api.request<{ user: User }>('/api/auth/me').then((payload) => setSession({ status: 'authenticated', user: payload.user })).catch(() => setSession({ status: 'unauthenticated', user: null })).finally(() => setLoading(false)) }, [])
  useEffect(() => { if (session.status !== 'authenticated') return; api.request<{ notes: Note[] }>('/api/notes').then((payload) => setNotes(payload.notes)).catch(() => setError('Failed to load notes')) }, [session.status])
  useEffect(() => { if (view.mode === 'edit' && currentNote) setDraft((current) => current && current.dirty ? current : { title: currentNote.title, content: currentNote.content, dirty: false }) }, [view.mode, currentNote])

  async function refreshNotes() { setNotes((await api.request<{ notes: Note[] }>('/api/notes')).notes) }
  async function handleAuth(action: 'login' | 'register', username: string, password: string) { await api.request<{ user: User }>(`/api/auth/${action}`, { method: 'POST', body: JSON.stringify({ username, password }) }); setSession({ status: 'authenticated', user: (await api.request<{ user: User }>('/api/auth/me')).user }); await refreshNotes() }
  async function handleLogout() { await api.request('/api/auth/logout', { method: 'POST' }); setSession({ status: 'unauthenticated', user: null }); setNotes([]); setView({ mode: 'list', noteId: null }) }
  async function createNote() { const payload = await api.request<{ note: Note }>('/api/notes', { method: 'POST', body: JSON.stringify({ title: 'Nová poznámka', content: '' }) }); setNotes((list) => [payload.note, ...list]); setView({ mode: 'edit', noteId: payload.note.id }); setDraft({ title: payload.note.title, content: payload.note.content, dirty: false }) }
  async function saveNote(noteId: string, title: string, content: string) { const payload = await api.request<{ note: Note }>(`/api/notes/${noteId}`, { method: 'PUT', body: JSON.stringify({ title, content }) }); setNotes((list) => list.map((note) => (note.id === noteId ? payload.note : note))); setView({ mode: 'detail', noteId }); setDraft(null) }
  async function deleteNote(noteId: string) { await api.request(`/api/notes/${noteId}`, { method: 'DELETE' }); setNotes((list) => list.filter((note) => note.id !== noteId)); setView({ mode: 'list', noteId: null }); setModal({ type: 'none' }) }
  async function toggleCheckbox(noteId: string, line: number, expected: string, checked: boolean) { const key = `${noteId}:${line}`; setPendingCheckboxes((state) => ({ ...state, [key]: checked })); setNotes((list) => list.map((note) => note.id === noteId ? { ...note, content: applyCheckboxChange(note.content, line, checked) } : note)); try { const payload = await api.request<{ note: Note }>(`/api/notes/${noteId}/checkbox`, { method: 'PATCH', body: JSON.stringify({ line, expected, checked }) }); setNotes((list) => list.map((note) => (note.id === noteId ? payload.note : note))) } catch (error: any) { if (error?.status === 409) await refreshNotes(); else setError('Checkbox update failed') } finally { setPendingCheckboxes((state) => { const next = { ...state }; delete next[key]; return next }) } }

  if (loading) return <div className="shell"><p className="muted">Loading…</p></div>
  if (session.status !== 'authenticated') return <AuthScreen onAuth={handleAuth} />

  return <div className="shell"><header className="topbar"><div><div className="eyebrow">Personal notes</div><h1>Notes</h1></div><div className="topbar-actions"><button className="primary" onClick={createNote}><PlusIcon width={18} height={18} />New note</button><button className="ghost" onClick={handleLogout}>Logout</button></div></header>{error ? <p className="error">{error}</p> : null}{view.mode === 'list' && <NotesGrid notes={notes} onOpen={(id) => setView({ mode: 'detail', noteId: id })} onEdit={(id) => setView({ mode: 'edit', noteId: id })} onDelete={(id) => setModal({ type: 'delete-note', noteId: id })} />}{view.mode === 'detail' && currentNote ? <NoteDetail note={currentNote} onBack={() => setView({ mode: 'list', noteId: null })} onEdit={() => setView({ mode: 'edit', noteId: currentNote.id })} onDelete={() => setModal({ type: 'delete-note', noteId: currentNote.id })} onToggleCheckbox={toggleCheckbox} pendingCheckboxes={pendingCheckboxes} /> : null}{view.mode === 'edit' && currentNote ? <NoteEditor note={currentNote} draft={draft} setDraft={setDraft} onBack={() => setModal({ type: 'discard-changes' })} onSave={saveNote} onDiscard={() => setModal({ type: 'discard-changes' })} /> : null}{modal.type === 'delete-note' ? <ConfirmDialog title="Delete note?" confirmLabel="Delete" tone="danger" onCancel={() => setModal({ type: 'none' })} onConfirm={() => deleteNote(modal.noteId)} /> : null}{modal.type === 'discard-changes' ? <ConfirmDialog title="Discard changes?" confirmLabel="Discard" tone="neutral" onCancel={() => setModal({ type: 'none' })} onConfirm={() => { setDraft(null); setView((current) => current.noteId ? { mode: 'detail', noteId: current.noteId } : current) }} /> : null}</div>
}

function AuthScreen({ onAuth }: { onAuth: (mode: 'login' | 'register', username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  return <main className="auth-shell"><form className="auth-card" onSubmit={(event) => { event.preventDefault(); onAuth('login', username, password) }}><h1>Notes</h1><p className="muted">Fast Markdown notes and checklists.</p><input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" autoComplete="username" /><input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" autoComplete="current-password" /><div className="row"><button className="primary" type="submit">Login</button><button type="button" className="ghost" onClick={() => onAuth('register', username, password)}>Register</button></div></form></main>
}

function NotesGrid({ notes, onOpen, onEdit, onDelete }: { notes: Note[]; onOpen: (id: string) => void; onEdit: (id: string) => void; onDelete: (id: string) => void }) {
  if (!notes.length) return <p className="empty">No notes yet. Create your first one.</p>
  return <section className="notes-grid">{notes.map((note) => <article key={note.id} className="note-card" onClick={() => onOpen(note.id)}><h2>{note.title}</h2><p>{note.content.slice(0, 160) || 'Empty note'}</p><div className="card-actions"><button onClick={(event) => { event.stopPropagation(); onEdit(note.id) }} aria-label="Edit note"><PencilIcon width={18} height={18} /></button><button onClick={(event) => { event.stopPropagation(); onDelete(note.id) }} aria-label="Delete note"><TrashIcon width={18} height={18} /></button></div></article>)}</section>
}

function NoteDetail({ note, onBack, onEdit, onDelete, onToggleCheckbox, pendingCheckboxes }: { note: Note; onBack: () => void; onEdit: () => void; onDelete: () => void; onToggleCheckbox: (noteId: string, line: number, expected: string, checked: boolean) => Promise<void>; pendingCheckboxes: Record<string, boolean> }) {
  const lines = note.content.split(/\r?\n/)
  return <section className="detail"><button className="ghost back" onClick={onBack} aria-label="Back"><ArrowLeftIcon width={18} height={18} /></button><div className="detail-head"><h2>{note.title}</h2><div><button className="ghost" onClick={onEdit} aria-label="Edit note"><PencilIcon width={18} height={18} /></button><button className="ghost" onClick={onDelete} aria-label="Delete note"><TrashIcon width={18} height={18} /></button></div></div><MarkdownRenderer lines={lines} noteId={note.id} onToggleCheckbox={onToggleCheckbox} pendingCheckboxes={pendingCheckboxes} /></section>
}

function MarkdownRenderer({ lines, noteId, onToggleCheckbox, pendingCheckboxes }: { lines: string[]; noteId: string; onToggleCheckbox: (noteId: string, line: number, expected: string, checked: boolean) => Promise<void>; pendingCheckboxes: Record<string, boolean> }) {
  return <div className="markdown">{lines.map((line, index) => { const task = line.match(/^([ \t]*[-*+]\s+)\[( |x|X)\]\s+(.*)$/); if (task) { const checked = task[2].toLowerCase() === 'x'; const key = `${noteId}:${index + 1}`; return <button key={index} className={`task ${pendingCheckboxes[key] !== undefined ? 'pending' : ''}`} onClick={() => onToggleCheckbox(noteId, index + 1, line, !checked)}><span className={`box ${checked ? 'checked' : ''}`} aria-hidden="true">{checked ? <CheckIcon width={14} height={14} /> : null}</span><span>{task[3]}</span></button> } return <p key={index}>{line || '\u00A0'}</p> })}</div>
}

function NoteEditor({ note, draft, setDraft, onBack, onSave, onDiscard }: { note: Note; draft: EditorDraft | null; setDraft: (draft: EditorDraft) => void; onBack: () => void; onSave: (noteId: string, title: string, content: string) => Promise<void>; onDiscard: () => void }) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const activeDraft = draft ?? { title: note.title, content: note.content, dirty: false }
  useEffect(() => { textareaRef.current?.focus() }, [])
  return <section className="editor"><div className="detail-head"><button className="ghost back" onClick={onBack} aria-label="Back"><ArrowLeftIcon width={18} height={18} /></button><input value={activeDraft.title} onChange={(event) => setDraft({ ...activeDraft, title: event.target.value, dirty: true })} /></div><div className="editor-toolbar"><button className="ghost" aria-label="Convert selected lines to checklist"><ChecklistIcon width={18} height={18} /></button></div><textarea ref={textareaRef} value={activeDraft.content} onChange={(event) => setDraft({ ...activeDraft, content: event.target.value, dirty: true })} /><div className="editor-bar"><button className="primary" onClick={() => onSave(note.id, activeDraft.title, activeDraft.content)} disabled={!activeDraft.dirty}>Save</button><button className="ghost" onClick={onDiscard}>Discard</button></div></section>
}

function ConfirmDialog({ title, confirmLabel, tone, onCancel, onConfirm }: { title: string; confirmLabel: string; tone: 'danger' | 'neutral'; onCancel: () => void; onConfirm: () => void }) {
  return <div className="dialog-backdrop" role="dialog" aria-modal="true"><div className="dialog"><h3>{title}</h3><div className="row"><button className="ghost" onClick={onCancel}>Cancel</button><button className={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</button></div></div></div>
}

function applyCheckboxChange(content: string, lineNumber: number, checked: boolean): string {
  const lines = content.split(/\r?\n/)
  const index = lineNumber - 1
  if (lines[index]) lines[index] = lines[index].replace(/^([ \t]*[-*+]\s+)\[( |x|X)\]/, `$1[${checked ? 'x' : ' '}]`)
  return lines.join('\n')
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
