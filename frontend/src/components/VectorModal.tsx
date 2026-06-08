// # Copyright 2026, University of Maryland, All Rights Reserved

import React, { useState, useMemo } from 'react';
import type { UIEvent } from 'react';

interface VectorModalProps {
    colName: string;
    rowIndex: number; 
    data: any; 
    onClose: () => void;
    // NEW: Callback when a specific element in the array is edited
    onEditElement?: (arrayIndex: number, newValue: string) => void;
}

export const VectorModal: React.FC<VectorModalProps> = ({ colName, rowIndex, data, onClose, onEditElement }) => {
    const [scrollTop, setScrollTop] = useState(0);
    
    // NEW: Editing state
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editValue, setEditValue] = useState<string>('');

    const rowHeight = 24; 
    const containerHeight = 350; 
    const totalHeight = data.length * rowHeight;
    const visibleRowCount = Math.ceil(containerHeight / rowHeight) + 4; 

    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
    const endIndex = Math.min(data.length - 1, startIndex + visibleRowCount);

    // NEW: Handlers for editing
    const handleDoubleClick = (index: number, val: any) => {
        if (!onEditElement) return; // Only allow edit if callback is provided
        setEditingIndex(index);
        setEditValue(String(val));
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
        if (e.key === 'Enter') {
            if (onEditElement) onEditElement(index, editValue);
            setEditingIndex(null);
            
            // Optimistically update the local view so it feels instant
            data[index] = Number(editValue); 
        } else if (e.key === 'Escape') {
            setEditingIndex(null);
        }
    };

    const visibleRows = useMemo(() => {
        const rows = [];
        for (let i = startIndex; i <= endIndex; i++) {
            const isEditing = editingIndex === i;
            
            rows.push(
                <div 
                    key={i} 
                    className="d-flex w-100 position-absolute start-0 align-items-center"
                    style={{ 
                        top: i * rowHeight, 
                        height: rowHeight,
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        backgroundColor: i % 2 === 0 ? 'var(--fv-bg)' : 'var(--fv-panel)'
                    }}
                    onDoubleClick={() => handleDoubleClick(i, data[i])}
                >
                    <div className="text-start text-muted px-3 border-end" style={{ width: '40%', borderColor: 'rgba(255,255,255,0.05)' }}>
                        {i}
                    </div>
                    <div className="text-end px-3 flex-grow-1" style={{ cursor: onEditElement ? 'cell' : 'default' }}>
                        {isEditing ? (
                            <input 
                                type="text"
                                className="form-control form-control-sm w-100 h-100 border-0 rounded-0 text-end font-monospace"
                                style={{ backgroundColor: 'var(--fv-accent)', color: '#000', padding: 0, margin: 0, height: '20px', fontSize: '0.8rem' }}
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => handleKeyDown(e, i)}
                                onBlur={() => setEditingIndex(null)}
                                autoFocus
                            />
                        ) : (
                            <span className="text-white text-truncate font-monospace">{String(data[i])}</span>
                        )}
                    </div>
                </div>
            );
        }
        return rows;
    }, [startIndex, endIndex, data, editingIndex, editValue, onEditElement]);

    return (
        <div 
            className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
            style={{ 
                backgroundColor: 'rgba(0, 0, 0, 0.6)', 
                zIndex: 9999,
                backdropFilter: 'blur(2px)'
            }}
            onClick={onClose}
        >
            <div 
                className="d-flex flex-column shadow-lg"
                style={{ 
                    width: '450px', 
                    backgroundColor: 'var(--fv-panel)', 
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px',
                    overflow: 'hidden'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div 
                    className="d-flex justify-content-between align-items-center px-3 py-2 border-bottom"
                    style={{ backgroundColor: 'var(--fv-panel-hover)', borderColor: 'rgba(255,255,255,0.05)' }}
                >
                    <h6 className="m-0 text-truncate" style={{ color: 'var(--fv-accent)' }}>
                        <i className="bi bi-braces me-2"></i>
                        Array Viewer
                    </h6>
                    <button className="btn-close btn-close-white" style={{ fontSize: '0.75rem' }} onClick={onClose} />
                </div>

                {/* Info Bar */}
                <div className="px-3 py-2 border-bottom shadow-sm" style={{ fontSize: '0.8rem', backgroundColor: 'var(--fv-bg)', zIndex: 2 }}>
                    <div className="d-flex justify-content-between text-muted mb-1">
                        <span>Column: <strong className="text-white">{colName}</strong></span>
                        <span>Row: <strong className="text-white">{rowIndex + 1}</strong></span>
                    </div>
                    <div className="d-flex justify-content-between text-muted">
                        <span>Type: <strong className="text-white">{data.constructor.name}</strong></span>
                        <span>Length: <strong className="text-white">{data.length}</strong></span>
                    </div>
                </div>

                {/* Table Header Row */}
                <div className="d-flex w-100 py-1 border-bottom" style={{ backgroundColor: 'var(--fv-panel-hover)', fontSize: '0.8rem', zIndex: 2 }}>
                    <div className="text-start text-muted px-3" style={{ width: '40%' }}>Index</div>
                    <div className="text-end text-muted px-3 flex-grow-1">Value</div>
                </div>

                {/* Virtualized Scroll Area */}
                <div 
                    className="w-100 overflow-auto position-relative font-monospace" 
                    style={{ height: containerHeight, backgroundColor: 'var(--fv-bg)', fontSize: '0.8rem' }}
                    onScroll={(e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop)}
                >
                    {/* Invisible spacer to set the exact scroll height */}
                    <div className="position-absolute top-0 start-0 w-100" style={{ height: totalHeight }} />
                    
                    {/* Only the visible rows are rendered into the DOM */}
                    {visibleRows}
                </div>
            </div>
        </div>
    );
};