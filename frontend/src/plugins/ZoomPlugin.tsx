import { useCore } from '../core/FViewerContext';
import { pluginManager } from '../core/PluginManager';

const ZoomPluginComponent = () => {
    const { zoom, setZoom, setPan, setFlipX, setFlipY, setRotation } = useCore();

    const resetView = () => {
        setZoom(1); setPan({ x: 0, y: 0 });
        setFlipX(false); setFlipY(false); setRotation(0);
    };

    return (
        <div className="dropdown">
            <button className="fv-btn dropdown-toggle" data-bs-toggle="dropdown" title="Zoom Menu">
                <i className="bi bi-zoom-in"></i> <span className="ms-1">Zoom ({zoom !== null ? Math.round(zoom * 100) : 0}%)</span>
            </button>
            <ul className="dropdown-menu dropdown-menu-end fv-dropdown-menu shadow">
                <li><button className="dropdown-item fv-dropdown-item" onClick={() => setZoom(z => Math.min(50, (z ?? 1) * 1.2))}><span style={{ width: '16px' }}></span><i className="bi bi-zoom-in"></i> Zoom In</button></li>
                <li><button className="dropdown-item fv-dropdown-item" onClick={() => setZoom(z => Math.max(0.1, (z ?? 1) * 0.8))}><span style={{ width: '16px' }}></span><i className="bi bi-zoom-out"></i> Zoom Out</button></li>
                <li><hr className="dropdown-divider border-secondary my-1" /></li>
                <li><button className="dropdown-item fv-dropdown-item" onClick={resetView}><span style={{ width: '16px' }}></span><i className="bi bi-arrow-repeat"></i> Reset View</button></li>
            </ul>
        </div>
    );
};

export function initZoomPlugin() {
    // Notice we assign this to a new slot aligned to the right side of the toolbar!
    pluginManager.registerUI('fitsimage:toolbar:right', <ZoomPluginComponent />);
}