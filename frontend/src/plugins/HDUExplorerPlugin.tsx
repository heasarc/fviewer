// src/plugins/HDUExplorerPlugin.tsx
import { useCore } from '../core/FViewerContext';
import { pluginManager } from '../core/PluginManager';

// 1. The Toggle Button (Desktop)
const SidebarToggleButton = () => {
    const { isSidebarOpen, setIsSidebarOpen } = useCore();
    return (
        <li className="nav-item">
            <button 
                className={`btn menubar-btn px-3 h-100 ${isSidebarOpen ? 'fv-text-primary' : 'fv-text-muted'}`}
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                title="Toggle HDU Sidebar"
            >
                <i className="bi bi-layout-sidebar"></i>
            </button>
        </li>
    );
};

// 2. The Mobile Dropdown (Visible only on small screens)
const MobileHDUMenu = () => {
    const { hduList, activeHdu, setActiveHdu } = useCore();
    
    if (hduList.length === 0) return null;

    return (
        <li className="nav-item dropdown d-md-none">
            <button className="btn menubar-btn text-start w-100 px-3 py-2 text-info fw-bold" style={{ fontSize: '0.85rem' }} data-bs-toggle="dropdown">
                <i className="bi bi-layers"></i> HDUs
            </button>
            <ul className="dropdown-menu fv-dropdown-menu shadow position-absolute overflow-auto w-100" style={{ maxHeight: '50vh' }}>
                {hduList.map((hdu) => (
                    <li key={hdu.index}>
                        <button 
                            className={`dropdown-item fv-dropdown-item d-flex justify-content-between align-items-center ${activeHdu === hdu.index ? 'fw-bold text-info' : ''} ${hdu.type === 'empty' ? 'text-muted' : ''}`}
                            onClick={() => { 
                                setActiveHdu(hdu.index); 
                                document.getElementById('topMenubar')?.classList.remove('show'); 
                            }}
                        >
                            <span className="text-truncate" style={{ maxWidth: '150px' }}>
                                {hdu.extname}
                                {hdu.type === 'image' && hdu.naxes?.length > 0 && (
                                    <span className="ms-1 fv-text-muted" style={{ fontSize: '0.75rem' }}>
                                        ({hdu.naxes.join('x')})
                                    </span>
                                )}    
                            </span>
                            <span className="badge border border-secondary text-secondary bg-dark ms-2" style={{ fontSize: '0.6rem' }}>{hdu.type.toUpperCase()}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </li>
    );
};

// 3. The Main Sidebar Panel
const HDUSidebarPanel = () => {
    const { isSidebarOpen, hduList, activeHdu, setActiveHdu } = useCore();

    return (
        <div 
            className="d-none d-md-flex flex-column flex-shrink-0 border-end z-1 shadow-sm" 
            style={{ 
                width: isSidebarOpen ? '240px' : '0px', 
                backgroundColor: 'var(--fv-panel)', 
                borderColor: 'var(--fv-border)',
                transition: 'width 0.3s ease-in-out',
                overflow: 'hidden' 
            }}
        >
            {/* Inner container fixed at 240px to prevent text crushing during slide animation */}
            <div style={{ width: '240px', minWidth: '240px' }} className="d-flex flex-column h-100 overflow-auto">
                <div className="p-2 fw-bold text-uppercase border-bottom d-flex align-items-center" style={{ fontSize: '0.75rem', color: 'var(--fv-text-bright)', backgroundColor: 'var(--fv-bg)', borderColor: 'var(--fv-border)', letterSpacing: '0.5px' }}>
                    <i className="bi bi-layers me-2"></i> HDU Explorer
                </div>
                
                {hduList.length === 0 ? (
                    <div className="p-3 fv-text-muted fst-italic" style={{ fontSize: '0.8rem' }}>No file loaded</div>
                ) : (
                    hduList.map((hdu) => (
                        <button 
                            key={hdu.index}
                            className={`w-100 text-start px-3 py-2 d-flex justify-content-between align-items-center border-0 fv-sidebar-item ${activeHdu === hdu.index ? 'active' : ''}`}
                            onClick={() => setActiveHdu(hdu.index)}
                        >
                            <span className="text-truncate" style={{ maxWidth: '140px', fontSize: '0.85rem' }} title={hdu.extname}>
                                {hdu.extname}
                                {hdu.type === 'image' && hdu.naxes?.length > 0 && (
                                    <span className="ms-1 fv-text-muted" style={{ fontSize: '0.75rem' }}>
                                        ({hdu.naxes.join('x')})
                                    </span>
                                )}
                            </span>
                            <span className="badge border border-secondary text-secondary bg-dark" style={{ fontSize: '0.65rem', fontWeight: 'normal' }}>
                                {hdu.type.toUpperCase()}
                            </span>
                        </button>
                    ))
                )}
            </div>
        </div>
    );
};

export function initHDUExplorerPlugin() {
    pluginManager.registerUI('menubar:left', <SidebarToggleButton />);
    pluginManager.registerUI('menubar:mobile', <MobileHDUMenu />);
    pluginManager.registerUI('workspace:left', <HDUSidebarPanel />);
}