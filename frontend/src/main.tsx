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
import { initTransformPlugin } from './plugins/TransformPlugin';
import { initZoomPlugin } from './plugins/ZoomPlugin';
import { initRegionToolbarPlugin } from './plugins/RegionToolbarPlugin';
import { initHDUExplorerPlugin } from './plugins/HDUExplorerPlugin';
import { initDataCubePlugin } from './plugins/DataCubePlugin';
import { initTAPQueryPlugin } from './plugins/TAPQueryPlugin';

initPlotterPlugin();
initHeaderEditorPlugin();
initServerFilePlugin();
initImageControlPlugin();
initTransformPlugin();
initZoomPlugin();
initRegionToolbarPlugin();
initHDUExplorerPlugin();
initDataCubePlugin();
initTAPQueryPlugin();

createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <FViewerProvider>
            <App />
        </FViewerProvider>
    </React.StrictMode>
);