// src/plugins/ImageDisplayPlugin.tsx
import { useEffect } from 'react';
import { useCore } from '../core/FViewerContext';
import { pluginManager } from '../core/PluginManager';
import { commandRegistry } from '../core/CommandRegistry';

const ImageControlPluginComponent = () => {
        const { colormap, setColormap, stretch, setStretch } = useCore();

    // 1. Register API Commands
    useEffect(() => {
        const ack = (cmd: any, sendReply: any) => sendReply({ message_id: cmd.message_id, status: 'ok' });
        const replyData = (cmd: any, sendReply: any, data: any) => sendReply({ message_id: cmd.message_id, ...data });

        commandRegistry.register('set_colormap', async (command, sendReply) => {
            if (command.cmap) setColormap(command.cmap);
            ack(command, sendReply);
        });
        commandRegistry.register('get_colormap', async (command, sendReply) => replyData(command, sendReply, { colormap }));
        commandRegistry.register('set_stretch', async (command, sendReply) => {
            if (command.stretch) setStretch(command.stretch);
            ack(command, sendReply);
        });
        commandRegistry.register('get_stretch', async (command, sendReply) => replyData(command, sendReply, { stretch }));

        return () => {
            commandRegistry.unregister('set_colormap');
            commandRegistry.unregister('get_colormap');
            commandRegistry.unregister('set_stretch');
            commandRegistry.unregister('get_stretch');
        };
    }, [colormap, setColormap, stretch, setStretch]);

    // 2. Return the UI for the FitsImage Toolbar!
    return (
        <>
            {/* Color Menu */}
            <div className="dropdown">
                <button className="fv-btn dropdown-toggle" data-bs-toggle="dropdown" title="Colormap">
                    <i className="bi bi-palette"></i> <span className="ms-1">Color</span>
                </button>
                <ul className="dropdown-menu fv-dropdown-menu shadow">
                    <li><button className="dropdown-item fv-dropdown-item" onClick={() => setColormap('gray')}><span style={{ width: '16px' }}>{colormap === 'gray' && <i className="bi bi-check2"></i>}</span> Grayscale</button></li>
                    <li><button className="dropdown-item fv-dropdown-item" onClick={() => setColormap('heat')}><span style={{ width: '16px' }}>{colormap === 'heat' && <i className="bi bi-check2"></i>}</span> Heat</button></li>
                    <li><button className="dropdown-item fv-dropdown-item" onClick={() => setColormap('cool')}><span style={{ width: '16px' }}>{colormap === 'cool' && <i className="bi bi-check2"></i>}</span> Cool</button></li>
                    <li><button className="dropdown-item fv-dropdown-item" onClick={() => setColormap('plasma')}><span style={{ width: '16px' }}>{colormap === 'plasma' && <i className="bi bi-check2"></i>}</span> Plasma</button></li>
                </ul>
            </div>

            {/* Scale Menu */}
            <div className="dropdown">
                <button className="fv-btn dropdown-toggle" data-bs-toggle="dropdown" title="Scale / Stretch">
                    <i className="bi bi-graph-up"></i> <span className="ms-1">Scale</span>
                </button>
                <ul className="dropdown-menu fv-dropdown-menu shadow">
                    <li><button className="dropdown-item fv-dropdown-item" onClick={() => setStretch('linear')}><span style={{ width: '16px' }}>{stretch === 'linear' && <i className="bi bi-check2"></i>}</span> Linear</button></li>
                    <li><button className="dropdown-item fv-dropdown-item" onClick={() => setStretch('log')}><span style={{ width: '16px' }}>{stretch === 'log' && <i className="bi bi-check2"></i>}</span> Log</button></li>
                    <li><button className="dropdown-item fv-dropdown-item" onClick={() => setStretch('sqrt')}><span style={{ width: '16px' }}>{stretch === 'sqrt' && <i className="bi bi-check2"></i>}</span> Square Root</button></li>
                    <li><button className="dropdown-item fv-dropdown-item" onClick={() => setStretch('asinh')}><span style={{ width: '16px' }}>{stretch === 'asinh' && <i className="bi bi-check2"></i>}</span> ASINH</button></li>
                </ul>
            </div>
        </>
    );
};

export function initImageControlPlugin() {
    // We register this UI specifically to the FitsImage toolbar!
    pluginManager.registerUI('fitsimage:toolbar', <ImageControlPluginComponent />);
}