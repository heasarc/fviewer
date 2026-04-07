import React, { useState, useMemo } from 'react';

interface FitsHeaderModalProps {
    isOpen: boolean;
    onClose: () => void;
    rawHeader: string;
    onUpdateKeyword: (key: string, value: string, isNumeric: boolean) => Promise<void>;
}

interface HeaderCard {
    keyword: string;
    value: string;
    comment: string;
    isNumeric: boolean;
    isCommentOnly: boolean;
}

export const FitsHeaderModal: React.FC<FitsHeaderModalProps> = ({ isOpen, onClose, rawHeader, onUpdateKeyword }) => {
    const [search, setSearch] = useState('');
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');

    const cards = useMemo(() => {
        if (!rawHeader) return [];
        
        // FITS headers are exactly 80 characters per card, padded with spaces.
        // If your wrapper returns them separated by newlines, we split on \n.
        // If it returns a single continuous 2880-byte string, we match 80-char chunks.
        const lines = rawHeader.includes('\n') ? rawHeader.split('\n') : rawHeader.match(/.{1,80}/g) || [];
        const parsed: HeaderCard[] = [];

        for (const line of lines) {
            if (!line || line.trim() === 'END') continue;
            
            const keyword = line.substring(0, 8).trim();
            if (!keyword) continue;

            const valueIndicator = line.substring(8, 10);
            let value = '';
            let comment = '';
            let isNumeric = true;
            let isCommentOnly = false;

            if (valueIndicator === '= ') {
                const rest = line.substring(10).trim();
                
                if (rest.startsWith("'")) {
                    isNumeric = false;
                    const endQuoteIdx = rest.indexOf("'", 1);
                    if (endQuoteIdx !== -1) {
                        value = rest.substring(1, endQuoteIdx).trim();
                        const slashIdx = rest.indexOf('/', endQuoteIdx);
                        if (slashIdx !== -1) comment = rest.substring(slashIdx + 1).trim();
                    }
                } else {
                    const parts = rest.split('/');
                    value = parts[0].trim();
                    if (parts.length > 1) comment = parts[1].trim();
                    
                    if (value === 'T' || value === 'F') isNumeric = false;
                    if (isNaN(Number(value))) isNumeric = false;
                }
            } else {
                isCommentOnly = true;
                comment = line.substring(8).trim();
            }

            parsed.push({ keyword, value, comment, isNumeric, isCommentOnly });
        }
        return parsed;
    }, [rawHeader]);

    const filteredCards = useMemo(() => {
        const lowerSearch = search.toLowerCase();
        return cards.filter(c => 
            c.keyword.toLowerCase().includes(lowerSearch) || 
            c.comment.toLowerCase().includes(lowerSearch) ||
            c.value.toLowerCase().includes(lowerSearch)
        );
    }, [cards, search]);

    const handleSaveEdit = async (card: HeaderCard) => {
        if (editingKey === card.keyword && editValue !== card.value) {
            try {
                await onUpdateKeyword(card.keyword, editValue, card.isNumeric);
            } catch (err) {
                alert(`Failed to update ${card.keyword}. Ensure the value matches the FITS standard type.`);
            }
        }
        setEditingKey(null);
    };

    if (!isOpen) return null;

    return (
        <div className="modal d-flex align-items-center justify-content-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1050, position: 'fixed', inset: 0 }}>
            
            {/* Modal Container (Styled exactly like our .fv-panel-box!) */}
            <div className="d-flex flex-column rounded overflow-hidden shadow-lg w-100" style={{ maxWidth: '900px', maxHeight: '85vh', backgroundColor: 'var(--fv-bg)', border: '1px solid var(--fv-border)' }}>
                
                {/* Header / Search Bar */}
                <div className="d-flex align-items-center justify-content-between p-3 border-bottom" style={{ backgroundColor: 'var(--fv-panel)', borderColor: 'var(--fv-border)' }}>
                    <div className="d-flex align-items-center gap-3">
                        <h5 className="mb-0 fw-bold d-flex align-items-center gap-2" style={{ color: 'var(--fv-text-bright)' }}>
                            <i className="bi bi-card-list" style={{ color: 'var(--fv-accent)' }}></i> FITS Header
                        </h5>
                        
                        {/* Search Input (Styled like the main toolbar) */}
                        <div className="input-group input-group-sm shadow-sm ms-3" style={{ width: '250px' }}>
                            <span className="input-group-text border-0" style={{ backgroundColor: 'var(--fv-panel-hover)', color: 'var(--fv-text)' }}><i className="bi bi-search"></i></span>
                            <input 
                                type="text" 
                                className="form-control border-0" 
                                style={{ backgroundColor: 'var(--fv-bg)', color: 'var(--fv-text-bright)' }}
                                placeholder="Search keywords or values..." 
                                value={search} 
                                onChange={(e) => setSearch(e.target.value)}
                                autoFocus
                            />
                        </div>
                    </div>
                    
                    <button type="button" className="btn-close btn-close-white" onClick={onClose} title="Close (Esc)"></button>
                </div>
                
                {/* Scrollable Table Area */}
                <div className="flex-grow-1 overflow-auto position-relative" style={{ backgroundColor: 'var(--fv-bg)' }}>
                    
                    {/* Sticky Table Header */}
                    <div className="d-flex fw-bold position-sticky top-0 shadow-sm border-bottom" style={{ height: '36px', backgroundColor: 'var(--fv-panel-hover)', color: 'var(--fv-text-bright)', borderColor: 'var(--fv-border)', zIndex: 3 }}>
                        <div className="d-flex align-items-center px-3 border-end flex-shrink-0" style={{ width: '120px', borderColor: 'rgba(255,255,255,0.05)' }}>Keyword</div>
                        <div className="d-flex align-items-center px-3 border-end flex-shrink-0" style={{ width: '200px', borderColor: 'rgba(255,255,255,0.05)' }}>Value</div>
                        <div className="d-flex align-items-center px-3 flex-grow-1">Comment</div>
                    </div>

                    {/* Table Body */}
                    <div className="d-flex flex-column">
                        {filteredCards.length === 0 ? (
                            <div className="p-5 text-center text-muted fst-italic">No matching keywords found.</div>
                        ) : (
                            filteredCards.map((c, i) => (
                                <div 
                                    key={i} 
                                    className="d-flex border-bottom"
                                    style={{ 
                                        height: '28px', 
                                        backgroundColor: i % 2 === 0 ? 'var(--fv-bg)' : 'var(--fv-panel)', 
                                        borderColor: 'rgba(255,255,255,0.05)',
                                        fontSize: '0.75rem'
                                    }}
                                >
                                    {/* Keyword Cell */}
                                    <div className="d-flex align-items-center px-3 border-end flex-shrink-0 fw-bold font-monospace text-truncate" style={{ width: '120px', borderColor: 'rgba(255,255,255,0.05)', color: 'var(--fv-accent)' }} title={c.keyword}>
                                        {c.keyword}
                                    </div>
                                    
                                    {/* Value Cell (Editable) */}
                                    <div 
                                        className="d-flex align-items-center px-2 border-end flex-shrink-0 font-monospace position-relative" 
                                        style={{ width: '200px', borderColor: 'rgba(255,255,255,0.05)', cursor: c.isCommentOnly ? 'default' : 'cell' }}
                                        onDoubleClick={() => { if(!c.isCommentOnly) { setEditingKey(c.keyword); setEditValue(c.value); } }}
                                        title={c.isCommentOnly ? '' : "Double-click to edit"}
                                    >
                                        {editingKey === c.keyword ? (
                                            <input 
                                                type="text" 
                                                className="form-control form-control-sm border-0 rounded-0 w-100 h-100 fw-bold px-1"
                                                style={{ backgroundColor: 'var(--fv-accent)', color: '#000', position: 'absolute', top: 0, left: 0 }}
                                                value={editValue}
                                                onChange={(e) => setEditValue(e.target.value)}
                                                onBlur={() => handleSaveEdit(c)}
                                                onKeyDown={(e) => { 
                                                    if (e.key === 'Enter') handleSaveEdit(c); 
                                                    if (e.key === 'Escape') setEditingKey(null); 
                                                }}
                                                autoFocus
                                            />
                                        ) : (
                                            <span className="text-truncate w-100">{c.value}</span>
                                        )}
                                    </div>
                                    
                                    {/* Comment Cell */}
                                    <div className="d-flex align-items-center px-3 flex-grow-1 text-truncate text-muted fst-italic" title={c.comment}>
                                        {c.comment}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="d-flex align-items-center justify-content-between px-3 py-2 border-top" style={{ backgroundColor: 'var(--fv-panel)', borderColor: 'var(--fv-border)' }}>
                    <span className="text-muted" style={{ fontSize: '0.75rem' }}>{filteredCards.length} keywords found</span>
                    <button className="btn btn-sm btn-outline-secondary border-0" style={{ color: 'var(--fv-text)' }} onClick={onClose}>Close</button>
                </div>

            </div>
        </div>
    );
};