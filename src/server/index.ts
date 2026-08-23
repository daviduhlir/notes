import crypto from 'node:crypto'
import express from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'

type UserRecord = { id: string; username: string; passwordHash: string; salt: string; createdAt: string }
type NoteRecord = { id: string; title: string; content: string; createdAt: string; updatedAt: string }
type UserNotesFile = { notes: NoteRecord[] }
type SessionRecord = { userId: string; createdAt: string }
type AuthBody = { username?: string; password?: string }
type NoteBody = { title?: string; content?: string }
type CheckboxPatchBody = { line?: number; expected?: string; checked?: boolean }

const app = express()
const port = Number(process.env.PORT || 3000)
const dataDir = '/data'
const usersFile = path.join(dataDir, 'users.json')
const usersNotesDir = path.join(dataDir, 'users')
const sessionsFile = path.join(dataDir, 'sessions.json')
const clientPath = path.resolve(__dirname, '../client')
const isProduction = process.env.NODE_ENV === 'production'
const cookieName = 'nori_session'
const sessionTtlMs = 1000 * 60 * 60 * 24 * 30
const maxTitleLength = 120
const maxContentLength = 50_000

let users: UserRecord[] = []
let sessions: Record<string, SessionRecord> = {}
let bootstrapPromise: Promise<void> | null = null
const writeQueues = new Map<string, Promise<void>>()

app.use(express.json({ limit: '1mb' }))

function safeId(): string { return crypto.randomUUID() }
function hashPassword(password: string, salt: string): string { return crypto.scryptSync(password, salt, 64).toString('hex') }
function parseCookies(cookieHeader: string | undefined): Record<string, string> { if (!cookieHeader) return {}; return cookieHeader.split(';').reduce<Record<string, string>>((acc, part) => { const index = part.indexOf('='); if (index === -1) return acc; acc[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); return acc }, {}) }
function serializeCookie(name: string, value: string, options: { httpOnly?: boolean; maxAge?: number; path?: string; sameSite?: 'lax' | 'strict'; secure?: boolean }) { const parts = [`${name}=${encodeURIComponent(value)}`]; if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`); parts.push(`Path=${options.path ?? '/'}`); if (options.httpOnly) parts.push('HttpOnly'); if (options.sameSite) parts.push(`SameSite=${options.sameSite}`); if (options.secure) parts.push('Secure'); return parts.join('; ') }
function jsonError(response: express.Response, status: number, message: string) { return response.status(status).json({ error: message }) }
function normalizeUsername(value: string): string { return value.trim().toLowerCase() }
function isValidUsername(value: string): boolean { return /^[a-z0-9._-]{3,32}$/i.test(value) }
function isValidPassword(value: string): boolean { return value.length >= 8 && value.length <= 128 }
async function ensureDataDir() { await fs.mkdir(usersNotesDir, { recursive: true }) }
async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> { try { return JSON.parse(await fs.readFile(filePath, 'utf8')) as T } catch { return fallback } }
async function atomicWriteJson(filePath: string, value: unknown): Promise<void> { const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`; const content = `${JSON.stringify(value, null, 2)}\n`; await fs.writeFile(tempPath, content, 'utf8'); const handle = await fs.open(tempPath, 'r'); try { await handle.sync() } finally { await handle.close() } await fs.rename(tempPath, filePath) }
function enqueueWrite(filePath: string, writer: () => Promise<void>): Promise<void> { const previous = writeQueues.get(filePath) ?? Promise.resolve(); const next = previous.then(writer, writer); writeQueues.set(filePath, next.finally(() => { if (writeQueues.get(filePath) === next) writeQueues.delete(filePath) })); return next }
async function loadUserNotes(userId: string): Promise<UserNotesFile> { return readJsonFile<UserNotesFile>(path.join(usersNotesDir, `${userId}.json`), { notes: [] }) }
async function saveUserNotes(userId: string, payload: UserNotesFile): Promise<void> { const filePath = path.join(usersNotesDir, `${userId}.json`); await enqueueWrite(filePath, () => atomicWriteJson(filePath, payload)) }
async function saveUsers(): Promise<void> { await enqueueWrite(usersFile, () => atomicWriteJson(usersFile, { users })) }
async function saveSessions(): Promise<void> { await enqueueWrite(sessionsFile, () => atomicWriteJson(sessionsFile, sessions)) }
function validateNoteInput(body: NoteBody): { title: string; content: string } | null { const title = String(body.title ?? '').trim(); const content = String(body.content ?? ''); if (!title || title.length > maxTitleLength) return null; if (content.length > maxContentLength) return null; return { title, content } }
function toggleCheckboxLine(content: string, lineNumber: number, expected: string, checked: boolean): { content: string } | null { const lines = content.split(/\r?\n/); const index = lineNumber - 1; if (!Number.isInteger(lineNumber) || index < 0 || index >= lines.length) return null; const current = lines[index]; if (current !== expected) return null; if (!/^([ \t]*[-*+]\s+)\[(?: |x|X)\]/.test(current)) return null; lines[index] = current.replace(/^([ \t]*[-*+]\s+)\[(?: |x|X)\]/, `$1[${checked ? 'x' : ' '}]`); return { content: lines.join('\n') } }
function getCurrentSession(request: express.Request): SessionRecord | null { const sessionId = parseCookies(request.headers.cookie)[cookieName]; if (!sessionId) return null; const session = sessions[sessionId]; if (!session) return null; if (Date.now() - new Date(session.createdAt).getTime() > sessionTtlMs) return null; return session }
function requireSession(request: express.Request, response: express.Response): SessionRecord | null { const session = getCurrentSession(request); if (!session) { jsonError(response, 401, 'Unauthorized'); return null } return session }
async function bootstrap() { if (!bootstrapPromise) bootstrapPromise = (async () => { await ensureDataDir(); users = await readJsonFile<UserRecord[]>(usersFile, []); sessions = await readJsonFile<Record<string, SessionRecord>>(sessionsFile, {}) })(); await bootstrapPromise }

app.use(async (_request, _response, next) => { await bootstrap(); next() })
app.get('/api/health', (_request, response) => response.json({ status: 'ok' }))
app.post('/api/auth/register', async (request, response) => { const { username, password } = request.body as AuthBody; const cleanUsername = normalizeUsername(String(username ?? '')); const cleanPassword = String(password ?? ''); if (!isValidUsername(cleanUsername) || !isValidPassword(cleanPassword)) return jsonError(response, 400, 'Invalid credentials'); if (users.some((user) => user.username === cleanUsername)) return jsonError(response, 409, 'Username already exists'); const userId = safeId(); const salt = crypto.randomBytes(16).toString('hex'); users.push({ id: userId, username: cleanUsername, passwordHash: hashPassword(cleanPassword, salt), salt, createdAt: new Date().toISOString() }); await saveUsers(); await saveUserNotes(userId, { notes: [] }); const sessionId = safeId(); sessions[sessionId] = { userId, createdAt: new Date().toISOString() }; await saveSessions(); response.setHeader('Set-Cookie', serializeCookie(cookieName, sessionId, { httpOnly: true, sameSite: 'lax', secure: isProduction, path: '/', maxAge: sessionTtlMs / 1000 })); response.json({ user: { id: userId, username: cleanUsername } }) })
app.post('/api/auth/login', async (request, response) => { const { username, password } = request.body as AuthBody; const cleanUsername = normalizeUsername(String(username ?? '')); const cleanPassword = String(password ?? ''); const user = users.find((candidate) => candidate.username === cleanUsername); if (!user) return jsonError(response, 401, 'Invalid credentials'); const computed = hashPassword(cleanPassword, user.salt); if (computed !== user.passwordHash) return jsonError(response, 401, 'Invalid credentials'); const sessionId = safeId(); sessions[sessionId] = { userId: user.id, createdAt: new Date().toISOString() }; await saveSessions(); response.setHeader('Set-Cookie', serializeCookie(cookieName, sessionId, { httpOnly: true, sameSite: 'lax', secure: isProduction, path: '/', maxAge: sessionTtlMs / 1000 })); response.json({ user: { id: user.id, username: user.username } }) })
app.post('/api/auth/logout', async (request, response) => { const sessionId = parseCookies(request.headers.cookie)[cookieName]; if (sessionId && sessions[sessionId]) { delete sessions[sessionId]; await saveSessions() } response.setHeader('Set-Cookie', serializeCookie(cookieName, '', { httpOnly: true, sameSite: 'lax', secure: isProduction, path: '/', maxAge: 0 })); response.json({ ok: true }) })
app.get('/api/auth/me', (request, response) => { const session = requireSession(request, response); if (!session) return; const user = users.find((candidate) => candidate.id === session.userId); if (!user) return jsonError(response, 401, 'Unauthorized'); response.json({ user: { id: user.id, username: user.username } }) })
app.get('/api/notes', async (request, response) => { const session = requireSession(request, response); if (!session) return; const notesFile = await loadUserNotes(session.userId); response.json({ notes: notesFile.notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }) })
app.post('/api/notes', async (request, response) => { const session = requireSession(request, response); if (!session) return; const payload = validateNoteInput(request.body as NoteBody); if (!payload) return jsonError(response, 400, 'Invalid note'); const notesFile = await loadUserNotes(session.userId); const now = new Date().toISOString(); const note: NoteRecord = { id: safeId(), title: payload.title, content: payload.content, createdAt: now, updatedAt: now }; notesFile.notes.unshift(note); await saveUserNotes(session.userId, notesFile); response.status(201).json({ note }) })
app.get('/api/notes/:id', async (request, response) => { const session = requireSession(request, response); if (!session) return; const notesFile = await loadUserNotes(session.userId); const note = notesFile.notes.find((candidate) => candidate.id === request.params.id); if (!note) return jsonError(response, 404, 'Note not found'); response.json({ note }) })
app.put('/api/notes/:id', async (request, response) => { const session = requireSession(request, response); if (!session) return; const payload = validateNoteInput(request.body as NoteBody); if (!payload) return jsonError(response, 400, 'Invalid note'); const notesFile = await loadUserNotes(session.userId); const index = notesFile.notes.findIndex((candidate) => candidate.id === request.params.id); if (index === -1) return jsonError(response, 404, 'Note not found'); const updated = { ...notesFile.notes[index], title: payload.title, content: payload.content, updatedAt: new Date().toISOString() }; notesFile.notes[index] = updated; await saveUserNotes(session.userId, notesFile); response.json({ note: updated }) })
app.delete('/api/notes/:id', async (request, response) => { const session = requireSession(request, response); if (!session) return; const notesFile = await loadUserNotes(session.userId); const filtered = notesFile.notes.filter((candidate) => candidate.id !== request.params.id); if (filtered.length === notesFile.notes.length) return jsonError(response, 404, 'Note not found'); notesFile.notes = filtered; await saveUserNotes(session.userId, notesFile); response.json({ ok: true }) })
app.patch('/api/notes/:id/checkbox', async (request, response) => { const session = requireSession(request, response); if (!session) return; const body = request.body as CheckboxPatchBody; const line = typeof body.line === 'number' ? body.line : NaN; const expected = body.expected; const checked = body.checked; if (!Number.isInteger(line) || line < 1 || typeof expected !== 'string' || typeof checked !== 'boolean') return jsonError(response, 400, 'Invalid checkbox update'); const notesFile = await loadUserNotes(session.userId); const index = notesFile.notes.findIndex((candidate) => candidate.id === request.params.id); if (index === -1) return jsonError(response, 404, 'Note not found'); const current = notesFile.notes[index]; const result = toggleCheckboxLine(current.content, line, expected, checked); if (!result) return jsonError(response, 409, 'Conflict'); const updated = { ...current, content: result.content, updatedAt: new Date().toISOString() }; notesFile.notes[index] = updated; await saveUserNotes(session.userId, notesFile); response.json({ note: updated }) })
app.use(express.static(clientPath))
app.get('/{*splat}', (_request, response) => { response.sendFile(path.join(clientPath, 'index.html')) })
bootstrap().then(() => { app.listen(port, '0.0.0.0', () => console.log(`Application listening on port ${port}`)) }).catch((error) => { console.error(error); process.exit(1) })
