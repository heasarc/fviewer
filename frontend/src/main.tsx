// Copyright 2026, University of Maryland, All Rights Reserved
import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './theme.css';
import { FViewerProvider } from './core/FViewerContext';
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <FViewerProvider>
            <App />
        </FViewerProvider>
    </React.StrictMode>
);