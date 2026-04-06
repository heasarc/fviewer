import React, { useState, useMemo } from 'react';
import type { UIEvent } from 'react';

interface VirtualTableProps {
    numRows: number;
    columns: any[];
    dataMap: Record<string, any[]>;
    rowHeight?: number;
    containerHeight?: number;
}

export const VirtualTable: React.FC<VirtualTableProps> = ({
    numRows,
    columns,
    dataMap,
    rowHeight = 35,
    containerHeight = 600
}) => {
    const [scrollTop, setScrollTop] = useState(0);

    const visibleRowCount = Math.ceil(containerHeight / rowHeight) + 4;
    const totalHeight = numRows * rowHeight;
    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
    const endIndex = Math.min(numRows - 1, startIndex + visibleRowCount);

    // Give every column a fixed width (adjust as needed, e.g., 150px)
    const colWidth = 150; 
    const rowNumWidth = 60;
    // Total width is the row number column + all data columns
    const totalWidth = rowNumWidth + (columns.length * colWidth);

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
                        width: totalWidth, // Set exact width instead of 100%
                        height: rowHeight,
                        backgroundColor: i % 2 === 0 ? '#fff' : '#f8f9fa'
                    }}
                >
                    {/* Row Number (Sticky Left) */}
                    <div 
                        role="cell" 
                        className="d-flex align-items-center px-2 border-end text-muted fw-bold shadow-sm" 
                        style={{ 
                            width: rowNumWidth, 
                            flexShrink: 0,
                            position: 'sticky', 
                            left: 0, 
                            zIndex: 2,           // Keeps it above the scrolling columns
                            backgroundColor: '#e9ecef' // Slightly darker grey to separate it
                        }}
                    >
                        {i + 1}
                    </div>
                    
                    {/* Data Cells */}
                    {columns.map((col, colIdx) => {
                        let val = dataMap[col.name]?.[i];
                        if (val !== undefined && val !== null && val.length !== undefined && typeof val !== 'string') {
                            val = `[Array ${val.length}]`;
                        }

                        return (
                            <div 
                                key={colIdx} 
                                role="cell"
                                className="d-flex align-items-center px-2 text-truncate border-end"
                                style={{ width: colWidth, flexShrink: 0 }} // Fixed width
                                title={String(val ?? '')}
                            >
                                {String(val ?? '...')}
                            </div>
                        );
                    })}
                </div>
            );
        }
        return rows;
    }, [startIndex, endIndex, columns, dataMap, rowHeight, totalWidth]);

    const handleScroll = (e: UIEvent<HTMLDivElement>) => {
        setScrollTop(e.currentTarget.scrollTop);
    };

    return (
        // Remove overflow-hidden from the wrapper so the child can dictate horizontal scroll
        <div className="w-100 border">
            {/* Scrollable Container (handles both X and Y axes) */}
            <div 
                onScroll={handleScroll} 
                style={{ 
                    height: containerHeight, 
                    width: '100%',
                    overflow: 'auto', // Enables horizontal and vertical scrolling
                    position: 'relative' 
                }}
            >
                {/* 
                    Header 
                    Note: It is now inside the scrollable area, so it scrolls horizontally with the data.
                    It uses position: sticky, top: 0 to stay pinned vertically.
                */}
                <div 
                    className="d-flex bg-dark text-white fw-bold shadow-sm" 
                    style={{ 
                        width: totalWidth, 
                        height: '45px', 
                        position: 'sticky', 
                        top: 0, 
                        zIndex: 3 // Needs to be above the sticky row numbers
                    }}
                >
                    {/* Row Header (Sticky Left AND Top) */}
                    <div 
                        className="d-flex align-items-center px-2 border-end border-secondary bg-dark" 
                        style={{ 
                            width: rowNumWidth, 
                            flexShrink: 0,
                            position: 'sticky',
                            left: 0,
                            zIndex: 4
                        }}
                    >
                        Row
                    </div>
                    
                    {columns.map((col, idx) => (
                        <div 
                            key={idx} 
                            className="d-flex flex-column justify-content-center px-2 border-end border-secondary text-truncate" 
                            style={{ width: colWidth, flexShrink: 0 }}
                        >
                            <span style={{ fontSize: '0.85rem' }}>{col.name}</span>
                            <span className="text-secondary" style={{ fontSize: '0.7rem' }}>{col.unit || col.form}</span>
                        </div>
                    ))}
                </div>

                {/* Invisible div to force the vertical scrollbar height */}
                {/* Note: We subtract the header height (45) from top so rows start immediately after header */}
                <div style={{ height: totalHeight, width: totalWidth, position: 'absolute', top: 45, left: 0 }} />
                
                {/* The visible row nodes */}
                <div style={{ width: totalWidth, position: 'absolute', top: 45, left: 0 }}>
                    {visibleRows}
                </div>
            </div>
        </div>
    );
};