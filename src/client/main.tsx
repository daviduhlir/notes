import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

function App() {
  return (
    <main>
      <h1>NoriApp full-stack application</h1>
      <p>React client and TypeScript REST API are ready.</p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
