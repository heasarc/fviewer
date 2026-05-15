// src/plugins/HeaderEditorPlugin.tsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useCore } from '../core/FViewerContext';
import { pluginManager } from '../core/PluginManager';
import { FitsHeaderModal } from '../components/FitsHeaderModal';

const HeaderEditorPluginComponent = () => {
    const { activeHdu, fitsWorker } = useCore();
    
    // Plugin manages its own state!
    const [isOpen, setIsOpen] = useState(false);
    const [rawHeaderString, setRawHeaderString] = useState('');

    // Fetch the header whenever the active HDU changes
    useEffect(() => {
        if (!activeHdu) {
            setRawHeaderString('');
            return;
        }

        const fetchHeader = async () => {
            try {
                const headerStr = await fitsWorker.readHeader();
                setRawHeaderString(headerStr);
            } catch (error) {
                console.error("Failed to read header:", error);
            }
        };
        fetchHeader();
    }, [activeHdu, fitsWorker]);

    // Handle saving keyword edits
    const handleUpdateKeyword = async (key: string, value: string, isNum: boolean, comment?: string) => {
        await fitsWorker.updateKeyword(key, value, isNum, comment);
        // Refresh the header display instantly!
        const newHeader = await fitsWorker.readHeader();
        setRawHeaderString(newHeader);
    };

    return (
        <>
            {/* 1. The Menu Button */}
            <li>
                <button 
                    className="dropdown-item fv-dropdown-item" 
                    onClick={() => setIsOpen(true)} 
                    disabled={!activeHdu}
                >
                    <i className="bi bi-card-heading"></i> Edit Header
                </button>
            </li>

            {/* 2. The Modal gets "teleported" directly to the document body! */}
            {createPortal(
                <FitsHeaderModal 
                    isOpen={isOpen} 
                    onClose={() => setIsOpen(false)} 
                    rawHeader={rawHeaderString} 
                    onUpdateKeyword={handleUpdateKeyword}
                />,
                document.body // <-- This attaches it outside the <ul> dropdown
            )}
        </>
    );
};

export function initHeaderEditorPlugin() {
    // Inject the plugin into the Edit Menu
    pluginManager.registerUI('menubar:edit', <HeaderEditorPluginComponent />);
    
    // (Optional) If we ever wanted to add a Python command like viewer.get_header(), 
    // we would register it to the commandRegistry right here!
}