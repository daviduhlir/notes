import express from 'express'
import path from 'node:path'

const app = express()
const port = Number(process.env.PORT || 3000)
const clientPath = path.resolve(__dirname, '../client')

app.use(express.json())

app.get('/api/health', (request, response) => {
  response.json({ status: 'ok' })
})

app.use(express.static(clientPath))

app.get('/{*splat}', (request, response) => {
  response.sendFile(path.join(clientPath, 'index.html'))
})

app.listen(port, '0.0.0.0', () => {
  console.log(`Application listening on port ${port}`)
})
