import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { UpdateNotification } from './components/UpdateNotification'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <UpdateNotification />
  </StrictMode>,
)
