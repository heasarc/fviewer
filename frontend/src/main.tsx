// Copyright 2026, University of Maryland, All Rights Reserved
import React from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './theme.css';
import { FViewerProvider } from './core/FViewerContext';
import App from './App.tsx'

// Plugins
import { initPlotterPlugin } from './plugins/PlotterPlugin';
import { initHeaderEditorPlugin } from './plugins/HeaderEditorPlugin';
import { initServerFilePlugin } from './plugins/ServerFilePlugin';
import { initImageControlPlugin } from './plugins/ImageControlPlugin';

initPlotterPlugin();
initHeaderEditorPlugin();
initServerFilePlugin();
initImageControlPlugin();

createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <FViewerProvider>
            <App />
        </FViewerProvider>
    </React.StrictMode>
);