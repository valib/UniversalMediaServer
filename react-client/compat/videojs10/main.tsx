import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import CompatibilityCheck from './CompatibilityCheck'
import './style.css'

createRoot(document.getElementById('root')!).render(<StrictMode><CompatibilityCheck /></StrictMode>)
