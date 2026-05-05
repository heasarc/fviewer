// # Copyright 2026, University of Maryland, All Rights Reserved

import React, { useState, useMemo, useEffect, useRef } from 'react';
import type {UIEvent} from 'react';

interface VirtualTableProps {
    numRows: number;
    columns: any[];
    dataMap: Record<string, any[]>;
    rowHeight?: number;
    onCellEdit?: (colName: string, colNum: number, rowIndex: number, newValue: string) => void;
    // NEW: Callback to request missing rows from the Worker
    onFetchData?: (startRow: number, endRow: number) => void;
}

export const VirtualTable: React.FC<VirtualTableProps> = ({
    numRows,
    columns,
    dataMap,
    rowHeight = 32,
    onCellEdit,
    onFetchData
}) => {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [containerHeight, setContainerHeight] = useState(400); 

    const [editingCell, setEditingCell] = useState<{ row: number, colName: string } | null>(null);
    const [editValue, setEditValue] = useState<string>('');

    // for tracking chuck requests and preventing spamming the worker
    const requestedChunks = useRef<Set<string>>(new Set());

    // --- Column Resizing State ---
    const [colWidths, setColWidths] = useState<Record<number, number>>({});
    const [resizingCol, setResizingCol] = useState<{ idx: number, startX: number, startWidth: number } | null>(null);
    const defaultColWidth = 120;
    const getColWidth = (idx: number) => colWidths[idx] || defaultColWidth;

    // --- Dynamic Height Measurement ---
    useEffect(() => {
        if (!scrollContainerRef.current) return;
        const observer = new ResizeObserver(entries => {
            for (let entry of entries) setContainerHeight(entry.contentRect.height);
        });
        observer.observe(scrollContainerRef.current);
        return () => observer.disconnect();
    }, []);

    // --- Virtualization Math ---
    const visibleRowCount = Math.ceil(containerHeight / rowHeight) + 10;
    const totalHeight = numRows * rowHeight;
    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
    const endIndex = Math.min(numRows - 1, startIndex + visibleRowCount);

    const rowNumWidth = 60;
    const totalWidth = rowNumWidth + columns.reduce((sum, _, idx) => sum + getColWidth(idx), 0);

    // --- Lazy Load Trigger ---
    useEffect(() => {
        if (!onFetchData || columns.length === 0) return;

        const fetchStart = Math.max(0, startIndex - 50);
        const fetchEnd = Math.min(numRows - 1, endIndex + 50);

        const testCol = columns[0].name; 
        let needsFetch = false;
        
        for (let i = fetchStart; i <= fetchEnd; i++) {
            if (dataMap[testCol]?.[i] === undefined) {
                needsFetch = true;
                break;
            }
        }

        // Create a unique key for this chunk
        const chunkKey = `${fetchStart}-${fetchEnd}`;

        // Only fetch if we need to AND we haven't already asked for this exact chunk
        if (needsFetch && !requestedChunks.current.has(chunkKey)) {
            requestedChunks.current.add(chunkKey); // Mark as requested

            const timer = setTimeout(() => {
                onFetchData(fetchStart, fetchEnd);
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [startIndex, endIndex, columns, dataMap, numRows, onFetchData]);

    // --- Handlers ---
    const handleDoubleClick = (row: number, colName: string, currentValue: any) => {
        if (currentValue?.length !== undefined && typeof currentValue !== 'string') return;
        setEditingCell({ row, colName });
        setEditValue(String(currentValue ?? ''));
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, colNum: number) => {
        if (e.key === 'Enter') {
            if (editingCell && onCellEdit) onCellEdit(editingCell.colName, colNum, editingCell.row, editValue);
            setEditingCell(null);
        } else if (e.key === 'Escape') {
            setEditingCell(null);
        }
    };

    // --- Resizer Event Listeners ---
    useEffect(() => {
        if (!resizingCol) return;

        const handlePointerMove = (e: PointerEvent) => {
            const diff = e.clientX - resizingCol.startX;
            // Constrain minimum column width to 50px
            const newWidth = Math.max(50, resizingCol.startWidth + diff);
            
            setColWidths(prev => ({
                ...prev,
                [resizingCol.idx]: newWidth
            }));
        };

        const handlePointerUp = () => setResizingCol(null);

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);

        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [resizingCol]);

    // --- Render Visible Rows ---
    const visibleRows = useMemo(() => {
        const rows = [];
        for (let i = startIndex; i <= endIndex; i++) {
            rows.push(
                <div 
                    key={i} 
                    role="row"
                    className="d-flex position-absolute start-0 border-bottom"
                    style={{ 
                        top: i * rowHeight, width: totalWidth, height: rowHeight,
                        backgroundColor: i % 2 === 0 ? 'var(--fv-bg)' : 'var(--fv-panel)',
                        borderColor: 'rgba(255,255,255,0.05)',
                        fontSize: '0.85rem'
                    }}
                >
                    {/* Sticky Row Number */}
                    <div 
                        role="cell" 
                        className="d-flex align-items-center justify-content-end px-2 fw-bold border-end flex-shrink-0" 
                        style={{ 
                            width: rowNumWidth, position: 'sticky', left: 0, zIndex: 2, 
                            backgroundColor: 'var(--fv-panel-hover)', color: 'var(--fv-text)'
                        }}
                    >
                        {i + 1}
                    </div>
                    
                    {/* Data Cells */}
                    {columns.map((col, colIdx) => {
                        let val = dataMap[col.name]?.[i];
                        
                        // NEW: Handle loading state gracefully
                        const isMissing = val === undefined;
                        const isArray = !isMissing && val?.length !== undefined && typeof val !== 'string';
                        
                        let displayVal = '...'; // Default loading string
                        if (!isMissing) {
                            displayVal = isArray ? `[Array ${val.length}]` : String(val ?? '');
                        }

                        const isEditing = editingCell?.row === i && editingCell?.colName === col.name;

                        return (
                            <div 
                                key={colIdx} role="cell"
                                className="d-flex align-items-center px-2 border-end flex-shrink-0"
                                style={{ 
                                    width: getColWidth(colIdx),
                                    borderColor: 'rgba(255,255,255,0.05)', 
                                    cursor: (isArray || isMissing) ? 'default' : 'cell',
                                    color: (val === null || isMissing) ? '#666' : 'inherit'
                                }}
                                onDoubleClick={() => !isMissing && handleDoubleClick(i, col.name, val)}
                                title={isEditing ? '' : displayVal}
                            >
                                {isEditing ? (
                                    <input 
                                        type="text"
                                        className="form-control form-control-sm w-100 h-100 border-0 rounded-0 fw-bold"
                                        style={{ backgroundColor: 'var(--fv-accent)', color: '#000' }}
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={(e) => handleKeyDown(e, colIdx + 1)}
                                        onBlur={() => setEditingCell(null)}
                                        autoFocus
                                    />
                                ) : (
                                    <span className="text-truncate w-100 text-end font-monospace" style={{fontSize: '0.75rem'}}>
                                        {displayVal}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            );
        }
        return rows;
    }, [startIndex, endIndex, columns, dataMap, rowHeight, totalWidth, editingCell, editValue]);

    return (
        <div className="w-100 h-100">
            <div 
                ref={scrollContainerRef}
                className="w-100 h-100 overflow-auto position-relative"
                onScroll={(e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop)} 
                style={{ backgroundColor: 'var(--fv-bg)' }}
            >
                {/* Sticky Header */}
                <div 
                    className="d-flex fw-bold shadow-sm position-sticky top-0 border-bottom" 
                    style={{ 
                        width: totalWidth, height: '40px', zIndex: 3, 
                        backgroundColor: 'var(--fv-panel-hover)', color: 'var(--fv-accent)'
                    }}
                >
                    <div 
                        className="d-flex align-items-center justify-content-end px-2 border-end flex-shrink-0" 
                        style={{ width: rowNumWidth, position: 'sticky', left: 0, zIndex: 4, backgroundColor: 'var(--fv-panel-hover)' }}
                    >
                        Row
                    </div>
                    {columns.map((col, idx) => (
                        <div 
                            key={idx} 
                            // Added 'position-relative' so the resizer handle can lock to the right edge
                            className="position-relative d-flex flex-column justify-content-center px-2 text-truncate border-end flex-shrink-0" 
                            style={{ width: getColWidth(idx), borderColor: 'rgba(255,255,255,0.05)' }}
                        >
                            <span style={{ fontSize: '0.8rem', color: 'var(--fv-accent)' }}>{col.name}</span>
                            <span style={{ fontSize: '0.65rem', color: 'var(--bs-gray-600)' }}>{col.unit || col.form}</span>
                            
                            {/* NEW: Invisible Drag Handle */}
                            <div 
                                style={{
                                    position: 'absolute',
                                    right: -2, // Pull slightly over the border line
                                    top: 0,
                                    bottom: 0,
                                    width: '5px',
                                    cursor: 'col-resize',
                                    zIndex: 10,
                                    // Highlight if THIS specific column is currently being dragged
                                    backgroundColor: resizingCol?.idx === idx ? 'var(--fv-accent)' : 'transparent',
                                    transition: 'background-color 0.2s'
                                }}
                                onPointerDown={(e) => {
                                    e.preventDefault(); // Prevent text highlighting while dragging
                                    e.stopPropagation();
                                    setResizingCol({ idx, startX: e.clientX, startWidth: getColWidth(idx) });
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--fv-panel-hover)'}
                                onMouseLeave={(e) => {
                                    if (resizingCol?.idx !== idx) {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                    }
                                }}
                            />
                        </div>
                    ))}
                </div>

                {/* Invisible Spacer */}
                <div className="position-absolute top-0 start-0" style={{ height: totalHeight, width: totalWidth, marginTop: '40px' }} />
                
                {/* Visible Rows Container */}
                <div className="position-absolute top-0 start-0" style={{ width: totalWidth, marginTop: '40px' }}>
                    {visibleRows}
                </div>
            </div>
        </div>
    );
};