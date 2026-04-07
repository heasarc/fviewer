import React, { useState, useMemo, useEffect, useRef } from 'react';
import type {UIEvent} from 'react';

interface VirtualTableProps {
    numRows: number;
    columns: any[];
    dataMap: Record<string, any[]>;
    rowHeight?: number;
    onCellEdit?: (colName: string, colNum: number, rowIndex: number, newValue: string) => void;
}

export const VirtualTable: React.FC<VirtualTableProps> = ({
    numRows,
    columns,
    dataMap,
    rowHeight = 32,
    onCellEdit
}) => {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [containerHeight, setContainerHeight] = useState(400); 

    const [editingCell, setEditingCell] = useState<{ row: number, colName: string } | null>(null);
    const [editValue, setEditValue] = useState<string>('');

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

    const colWidth = 120; 
    const rowNumWidth = 60;
    const totalWidth = rowNumWidth + (columns.length * colWidth);

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

    // --- Render Visible Rows ---
    const visibleRows = useMemo(() => {
        const rows = [];
        for (let i = startIndex; i <= endIndex; i++) {
            rows.push(
                <div 
                    key={i} 
                    role="row"
                    // Bootstrap positioning, flex, and border utilities
                    className="d-flex position-absolute start-0 border-bottom"
                    style={{ 
                        top: i * rowHeight, width: totalWidth, height: rowHeight,
                        backgroundColor: i % 2 === 0 ? 'var(--fv-bg)' : 'var(--fv-panel)',
                        borderColor: 'rgba(255,255,255,0.05)', // Faint divider for rows
                        fontSize: '0.85rem'
                    }}
                >
                    {/* Sticky Row Number */}
                    <div 
                        role="cell" 
                        // Bootstrap flex alignment, padding, and borders
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
                        const isArray = val?.length !== undefined && typeof val !== 'string';
                        const displayVal = isArray ? `[Array ${val.length}]` : String(val ?? '...');
                        const isEditing = editingCell?.row === i && editingCell?.colName === col.name;

                        return (
                            <div 
                                key={colIdx} role="cell"
                                // Bootstrap flex, padding, and border utilities
                                className="d-flex align-items-center px-2 border-end flex-shrink-0"
                                style={{ 
                                    width: colWidth, 
                                    borderColor: 'rgba(255,255,255,0.05)', // Faint divider for cols
                                    cursor: isArray ? 'default' : 'cell',
                                    color: val === null ? '#666' : 'inherit'
                                }}
                                onDoubleClick={() => handleDoubleClick(i, col.name, val)}
                                title={isEditing ? '' : displayVal}
                            >
                                {isEditing ? (
                                    <input 
                                        type="text"
                                        // Bootstrap form classes to fill the cell entirely
                                        className="form-control form-control-sm w-100 h-100 border-0 rounded-0 fw-bold"
                                        style={{ backgroundColor: 'var(--fv-accent)', color: '#000' }}
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={(e) => handleKeyDown(e, colIdx + 1)}
                                        onBlur={() => setEditingCell(null)}
                                        autoFocus
                                    />
                                ) : (
                                    // Bootstrap typography utilities!
                                    <span className="text-truncate w-100 text-end font-monospace" style={{fontSize: '0.75rem'}}>{displayVal}</span>
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
                // Bootstrap full size and overflow utilities
                className="w-100 h-100 overflow-auto position-relative"
                onScroll={(e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop)} 
                style={{ backgroundColor: 'var(--fv-bg)' }}
            >
                {/* Sticky Header */}
                <div 
                    // Bootstrap flex, shadow, and sticky positioning
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
                            // Bootstrap vertical flex layout and truncation
                            className="d-flex flex-column justify-content-center px-2 text-truncate border-end flex-shrink-0" 
                            style={{ width: colWidth, borderColor: 'rgba(255,255,255,0.05)' }}
                        >
                            <span style={{ fontSize: '0.8rem', color: 'var(--fv-accent)' }}>{col.name}</span>
                            <span style={{ fontSize: '0.65rem', color: 'var(--bs-gray-600)' }}>{col.unit || col.form}</span>
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