import React, { useState, useMemo } from 'react';
import type { UIEvent } from 'react';

interface VirtualTableProps {
    numRows: number;
    columns: any[];
    dataMap: Record<string, any[]>;
    rowHeight?: number;
    containerHeight?: number;
    onCellEdit?: (colName: string, colNum: number, rowIndex: number, newValue: string) => void;
}

export const VirtualTable: React.FC<VirtualTableProps> = ({
    numRows,
    columns,
    dataMap,
    rowHeight = 35,
    containerHeight = 600,
    onCellEdit
}) => {
    const [scrollTop, setScrollTop] = useState(0);
    // Tracks the cell currently being edited: { row: 5, colName: 'FLUX' }
    const [editingCell, setEditingCell] = useState<{ row: number, colName: string } | null>(null);
    const [editValue, setEditValue] = useState<string>('');

    const visibleRowCount = Math.ceil(containerHeight / rowHeight) + 4;
    const totalHeight = numRows * rowHeight;
    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
    const endIndex = Math.min(numRows - 1, startIndex + visibleRowCount);

    const colWidth = 150; 
    const rowNumWidth = 60;
    const totalWidth = rowNumWidth + (columns.length * colWidth);

    const handleDoubleClick = (row: number, colName: string, currentValue: any) => {
        // Prevent editing arrays for now
        if (currentValue?.length !== undefined && typeof currentValue !== 'string') return;
        
        setEditingCell({ row, colName });
        setEditValue(String(currentValue ?? ''));
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, colNum: number) => {
        if (e.key === 'Enter') {
            if (editingCell && onCellEdit) {
                onCellEdit(editingCell.colName, colNum, editingCell.row, editValue);
            }
            setEditingCell(null);
        } else if (e.key === 'Escape') {
            setEditingCell(null);
        }
    };

    const visibleRows = useMemo(() => {
        const rows = [];
        for (let i = startIndex; i <= endIndex; i++) {
            rows.push(
                <div 
                    key={i} 
                    role="row"
                    className="d-flex border-bottom"
                    style={{ 
                        position: 'absolute', 
                        top: i * rowHeight, 
                        left: 0,
                        width: totalWidth,
                        height: rowHeight,
                        backgroundColor: i % 2 === 0 ? 'var(--fv-panel)' : 'var(--fv-bg)',
                        color: 'var(--fv-text)'
                    }}
                >
                    <div 
                        role="cell" 
                        className="d-flex align-items-center px-2 border-end text-muted fw-bold shadow-sm" 
                        style={{ 
                            width: rowNumWidth, flexShrink: 0, position: 'sticky', 
                            left: 0, zIndex: 2,
                            backgroundColor: 'var(--fv-panel-hover)',
                            color: 'var(--fv-accent)'
                        }}
                    >
                        {i + 1}
                    </div>
                    
                    {columns.map((col, colIdx) => {
                        let val = dataMap[col.name]?.[i];
                        const isArray = val?.length !== undefined && typeof val !== 'string';
                        const displayVal = isArray ? `[Array ${val.length}]` : String(val ?? '...');
                        
                        const isEditing = editingCell?.row === i && editingCell?.colName === col.name;

                        return (
                            <div 
                                key={colIdx} 
                                role="cell"
                                className="d-flex align-items-center px-2 border-end"
                                style={{ width: colWidth, flexShrink: 0, cursor: isArray ? 'default' : 'cell' }}
                                onDoubleClick={() => handleDoubleClick(i, col.name, val)}
                                title={isEditing ? '' : displayVal}
                            >
                                {isEditing ? (
                                    <input 
                                        type="text"
                                        className="form-control form-control-sm"
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={(e) => handleKeyDown(e, colIdx + 1)} // colNum is 1-indexed
                                        onBlur={() => setEditingCell(null)} // Cancel edit on click away
                                        autoFocus
                                    />
                                ) : (
                                    <span className="text-truncate w-100">{displayVal}</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            );
        }
        return rows;
    }, [startIndex, endIndex, columns, dataMap, rowHeight, totalWidth, editingCell, editValue]);

    const handleScroll = (e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop);

    return (
        <div className="w-100 border">
            <div onScroll={handleScroll} style={{ height: containerHeight, width: '100%', overflow: 'auto', position: 'relative' }}>
                <div className="d-flex bg-dark text-white fw-bold shadow-sm" style={{ width: totalWidth, height: '45px', position: 'sticky', top: 0, zIndex: 3 }}>
                    <div className="d-flex align-items-center px-2 border-end border-secondary bg-dark" style={{ width: rowNumWidth, flexShrink: 0, position: 'sticky', left: 0, zIndex: 4 }}>
                        Row
                    </div>
                    {columns.map((col, idx) => (
                        <div key={idx} className="d-flex flex-column justify-content-center px-2 border-end border-secondary text-truncate" style={{ width: colWidth, flexShrink: 0 }}>
                            <span style={{ fontSize: '0.85rem' }}>{col.name}</span>
                            <span className="text-secondary" style={{ fontSize: '0.7rem' }}>{col.unit || col.form}</span>
                        </div>
                    ))}
                </div>
                <div style={{ height: totalHeight, width: totalWidth, position: 'absolute', top: 45, left: 0 }} />
                <div style={{ width: totalWidth, position: 'absolute', top: 45, left: 0 }}>
                    {visibleRows}
                </div>
            </div>
        </div>
    );
};