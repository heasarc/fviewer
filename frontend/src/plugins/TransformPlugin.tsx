import { useCore } from '../core/FViewerContext';
import { pluginManager } from '../core/PluginManager';

const TransformPluginComponent = () => {
    const { flipX, setFlipX, flipY, setFlipY, rotation, setRotation } = useCore();

    return (
        <div className="dropdown">
            <button className="fv-btn dropdown-toggle" data-bs-toggle="dropdown">
                <i className="bi bi-arrows-collapse"></i> <span className="ms-1">Transform</span>
            </button>
            <ul className="dropdown-menu fv-dropdown-menu shadow">
                <li><button className="dropdown-item fv-dropdown-item" onClick={() => setFlipX(!flipX)}><i className="bi bi-symmetry-vertical"></i> Flip X</button></li>
                <li><button className="dropdown-item fv-dropdown-item" onClick={() => setFlipY(!flipY)}><i className="bi bi-symmetry-horizontal"></i> Flip Y</button></li>
                <li><hr className="dropdown-divider border-secondary my-1" /></li>
                <li><button className="dropdown-item fv-dropdown-item" onClick={() => setRotation(r => r - 90)}><i className="bi bi-arrow-counterclockwise"></i> Rotate CCW (90°)</button></li>
                <li><button className="dropdown-item fv-dropdown-item" onClick={() => setRotation(r => r + 90)}><i className="bi bi-arrow-clockwise"></i> Rotate CW (90°)</button></li>
                <li><hr className="dropdown-divider border-secondary my-1" /></li>
                <li className="px-3 py-1">
                    <label className="fv-text-muted mb-1" style={{ fontSize: '0.75rem' }}>Custom Angle (°)</label>
                    <input type="number" className="form-control form-control-sm border-secondary bg-dark text-white" style={{ appearance: 'textfield' }} value={rotation} onChange={(e) => setRotation(Number(e.target.value) || 0)} step="1"/>
                </li>
            </ul>
        </div>
    );
};

export function initTransformPlugin() {
    pluginManager.registerUI('fitsimage:toolbar', <TransformPluginComponent />);
}