const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

const dataDir = path.join(os.tmpdir(), `notes-api-${crypto.randomUUID()}`)
const usersFile = path.join(dataDir, 'users.json')
const usersNotesDir = path.join(dataDir, 'users')
const sessionsFile = path.join(dataDir, 'sessions.json')

async function setupData() {
  await fs.mkdir(usersNotesDir, { recursive: true })
  await fs.writeFile(usersFile, JSON.stringify({ users: [] }, null, 2))
  await fs.writeFile(sessionsFile, JSON.stringify({}, null, 2))
}

function loadApp() {
  process.env.DATA_DIR = dataDir
  process.env.NODE_ENV = 'test'
  delete require.cache[require.resolve('../dist/server/index.js')]
  return require('../dist/server/index.js')
}

async function startServer(app) {
  await app.locals.bootstrapReady
  return app.listen(0)
}

async function request(baseUrl, method, url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await response.text()
  let json = null
  if (text) json = JSON.parse(text)
  return { response, json, setCookie: response.headers.get('set-cookie') }
}

function extractCookie(setCookie) {
  return setCookie ? setCookie.split(';')[0] : ''
}

test('auth and notes API flow', async (t) => {
  await setupData()
  const { app } = loadApp()
  const server = await startServer(app)
  t.after(() => server.close())
  const baseUrl = `http://127.0.0.1:${server.address().port}`

  const meUnauthorized = await request(baseUrl, 'GET', '/api/auth/me')
  assert.equal(meUnauthorized.response.status, 401)

  const register = await request(baseUrl, 'POST', '/api/auth/register', { body: { username: 'tester', password: 'Password123!' } })
  assert.equal(register.response.status, 200)
  assert.equal(register.json.user.username, 'tester')
  const cookie = extractCookie(register.setCookie)
  assert.ok(cookie.includes('nori_session='))

  const me = await request(baseUrl, 'GET', '/api/auth/me', { headers: { cookie } })
  assert.equal(me.response.status, 200)
  assert.equal(me.json.user.username, 'tester')

  const create = await request(baseUrl, 'POST', '/api/notes', { headers: { cookie }, body: { title: 'Shopping', content: '- [ ] Milk\n- [x] Coffee' } })
  assert.equal(create.response.status, 201)
  const noteId = create.json.note.id
  assert.equal(create.json.note.title, 'Shopping')

  const invalidCreate = await request(baseUrl, 'POST', '/api/notes', { headers: { cookie }, body: { title: '', content: 'Invalid' } })
  assert.equal(invalidCreate.response.status, 400)

  const unauthorizedCreate = await request(baseUrl, 'POST', '/api/notes', { body: { title: 'X', content: 'Y' } })
  assert.equal(unauthorizedCreate.response.status, 401)

  const list = await request(baseUrl, 'GET', '/api/notes', { headers: { cookie } })
  assert.equal(list.response.status, 200)
  assert.equal(list.json.notes.length, 1)

  const detail = await request(baseUrl, 'GET', `/api/notes/${noteId}`, { headers: { cookie } })
  assert.equal(detail.response.status, 200)
  assert.equal(detail.json.note.content, '- [ ] Milk\n- [x] Coffee')

  const unauthorizedDetail = await request(baseUrl, 'GET', `/api/notes/${noteId}`)
  assert.equal(unauthorizedDetail.response.status, 401)

  const missingDetail = await request(baseUrl, 'GET', '/api/notes/does-not-exist', { headers: { cookie } })
  assert.equal(missingDetail.response.status, 404)

  const update = await request(baseUrl, 'PUT', `/api/notes/${noteId}`, { headers: { cookie }, body: { title: 'Shopping list', content: '- [ ] Milk\n- [x] Coffee\n- [ ] Bread' } })
  assert.equal(update.response.status, 200)
  assert.equal(update.json.note.title, 'Shopping list')
  assert.match(update.json.note.updatedAt, /T/)

  const invalidUpdate = await request(baseUrl, 'PUT', `/api/notes/${noteId}`, { headers: { cookie }, body: { title: '', content: 'x' } })
  assert.equal(invalidUpdate.response.status, 400)

  const foreignUserRegister = await request(baseUrl, 'POST', '/api/auth/register', { body: { username: 'tester2', password: 'Password123!' } })
  const foreignCookie = extractCookie(foreignUserRegister.setCookie)
  const foreignUpdate = await request(baseUrl, 'PUT', `/api/notes/${noteId}`, { headers: { cookie: foreignCookie }, body: { title: 'Hack', content: 'Hack' } })
  assert.equal(foreignUpdate.response.status, 404)

  const checkboxOk = await request(baseUrl, 'PATCH', `/api/notes/${noteId}/checkbox`, { headers: { cookie }, body: { line: 1, expected: '- [ ] Milk', checked: true } })
  assert.equal(checkboxOk.response.status, 200)
  assert.equal(checkboxOk.json.note.content.split('\n')[0], '- [x] Milk')

  const checkboxConflict = await request(baseUrl, 'PATCH', `/api/notes/${noteId}/checkbox`, { headers: { cookie }, body: { line: 1, expected: '- [ ] Milk', checked: false } })
  assert.equal(checkboxConflict.response.status, 409)

  const checkboxBadRequest = await request(baseUrl, 'PATCH', `/api/notes/${noteId}/checkbox`, { headers: { cookie }, body: { line: 0, expected: 'nope', checked: true } })
  assert.equal(checkboxBadRequest.response.status, 400)

  const deleteRes = await request(baseUrl, 'DELETE', `/api/notes/${noteId}`, { headers: { cookie } })
  assert.equal(deleteRes.response.status, 200)

  const missingDelete = await request(baseUrl, 'DELETE', `/api/notes/${noteId}`, { headers: { cookie } })
  assert.equal(missingDelete.response.status, 404)

  const logout = await request(baseUrl, 'POST', '/api/auth/logout', { headers: { cookie } })
  assert.equal(logout.response.status, 200)

  const meAfterLogout = await request(baseUrl, 'GET', '/api/auth/me', { headers: { cookie } })
  assert.equal(meAfterLogout.response.status, 401)
})

test('register returns conflict for existing user', async (t) => {
  await setupData()
  const { app } = loadApp()
  const server = await startServer(app)
  t.after(() => server.close())
  const baseUrl = `http://127.0.0.1:${server.address().port}`

  const first = await request(baseUrl, 'POST', '/api/auth/register', { body: { username: 'tester', password: 'Password123!' } })
  assert.equal(first.response.status, 200)
  const second = await request(baseUrl, 'POST', '/api/auth/register', { body: { username: 'tester', password: 'Password123!' } })
  assert.equal(second.response.status, 409)
})
