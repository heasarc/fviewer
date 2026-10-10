// # Copyright 2026, University of Maryland, All Rights Reserved

import React, { useState, useMemo } from 'react';

interface FitsHeaderModalProps {
    isOpen: boolean;
    onClose: () => void;
    rawHeader: string;
    onUpdateKeyword: (key: string, value: string, isNumeric: boolean, comment?: string) => Promise<void>;
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
    const [editingCommentKey, setEditingCommentKey] = useState<string | null>(null);
    const [editCommentValue, setEditCommentValue] = useState('');

    // State for the new keyword form
    const [newKey, setNewKey] = useState('');
    const [newValue, setNewValue] = useState('');
    const [newComment, setNewComment] = useState('');
    const [isNumeric, setIsNumeric] = useState(false);
    const [showAddForm, setShowAddForm] = useState(false);
    const [feedback, setFeedback] = useState<{ type: 'error' | 'success' | 'info'; message: string; retry?: () => void } | null>(null);

    React.useEffect(() => {
        if (!feedback) return;
        const timer = window.setTimeout(() => setFeedback(null), 4000);
        return () => window.clearTimeout(timer);
    }, [feedback]);

    const cards = useMemo(() => {
        if (!rawHeader) return [];

        const lines = rawHeader.includes('\n') ? rawHeader.split('\n') : rawHeader.match(/.{1,80}/g) || [];
        const parsed: HeaderCard[] = [];

        const parseValueComment = (rest: string) => {
            let value = '';
            let comment = '';
            let isNumeric = true;
            const trimmed = rest.trim();

            if (trimmed.startsWith("'")) {
                isNumeric = false;
                const endQuoteIdx = trimmed.indexOf("'", 1);
                if (endQuoteIdx !== -1) {
                    value = trimmed.substring(1, endQuoteIdx).trim();
                    const slashIdx = trimmed.indexOf('/', endQuoteIdx);
                    if (slashIdx !== -1) comment = trimmed.substring(slashIdx + 1).trim();
                }
            } else {
                const parts = trimmed.split('/');
                value = parts[0].trim();
                if (parts.length > 1) comment = parts[1].trim();
                if (value === 'T' || value === 'F') isNumeric = false;
                if (isNaN(Number(value))) isNumeric = false;
            }
            return { value, comment, isNumeric };
        };

        for (const line of lines) {
            if (!line || line.trim() === 'END') continue;

            // HIERARCH convention: keyword extends beyond column 8
            if (line.startsWith('HIERARCH ')) {
                const eqPos = line.indexOf('= ');
                if (eqPos !== -1) {
                    const keyword = line.substring(9, eqPos).trim();
                    const { value, comment, isNumeric } = parseValueComment(line.substring(eqPos + 2));
                    parsed.push({ keyword: `HIERARCH ${keyword}`, value, comment, isNumeric, isCommentOnly: false });
                } else {
                    parsed.push({ keyword: line.substring(0, 8).trim(), value: '', comment: line.substring(9).trim(), isNumeric: false, isCommentOnly: true });
                }
                continue;
            }

            const keyword = line.substring(0, 8).trim();
            if (!keyword) continue;

            // CONTINUE cards are handled in the merge pass below
            const valueIndicator = line.substring(8, 10);

            if (valueIndicator === '= ') {
                const { value, comment, isNumeric } = parseValueComment(line.substring(10));
                parsed.push({ keyword, value, comment, isNumeric, isCommentOnly: false });
            } else {
                parsed.push({ keyword, value: '', comment: line.substring(8).trim(), isNumeric: false, isCommentOnly: true });
            }
        }

        // Merge CONTINUE cards into the preceding keyword (FITS long string convention)
        const merged: HeaderCard[] = [];
        for (const card of parsed) {
            if (card.keyword === 'CONTINUE' && merged.length > 0) {
                const prev = merged[merged.length - 1];
                prev.value = prev.value.replace(/&$/, '') + card.comment.replace(/^'/, '').replace(/'.*/, '').trim();
            } else {
                merged.push(card);
            }
        }
        return merged;
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
                await onUpdateKeyword(card.keyword, editValue, card.isNumeric, card.comment);
                setFeedback({ type: 'success', message: `Updated ${card.keyword}.` });
            } catch (err) {
                setFeedback({
                    type: 'error',
                    message: `Failed to update ${card.keyword}. Ensure the value matches the FITS standard type.`,
                    retry: () => handleSaveEdit(card)
                });
            }
        }
        setEditingKey(null);
    };

    const handleSaveCommentEdit = async (c: any) => {
        if (editingCommentKey) {
            if (editCommentValue !== c.comment) {
                // Determine if the existing value was numeric (adjust this logic if you have a c.isNumeric flag)
                const isNum = !isNaN(Number(c.value)) && c.value.trim() !== ''; 
                await onUpdateKeyword(c.keyword, c.value, isNum, editCommentValue);
            }
            setEditingCommentKey(null);
        }
    };

    const handleAddKeyword = async () => {
        if (!newKey.trim()) {
            setFeedback({ type: 'error', message: 'Keyword name is required.' });
            return;
        }
        
        const trimmed = newKey.trim().toUpperCase();
        // FITS standard keywords are max 8 chars; longer names use the HIERARCH convention
        const formattedKey = trimmed.length > 8 ? `HIERARCH ${trimmed}` : trimmed;
        
        try {
            await onUpdateKeyword(formattedKey, newValue, isNumeric, newComment);
            setFeedback({ type: 'success', message: `Added ${formattedKey}.` });
            // Clear form on success
            setNewKey('');
            setNewValue('');
            setNewComment('');
            setIsNumeric(false);
        } catch (error) {
            console.error("Failed to add keyword:", error);
            setFeedback({
                type: 'error',
                message: 'Failed to add keyword.',
                retry: handleAddKeyword
            });
        }
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
                        
                        {feedback && (
                            <div className={`small rounded px-2 py-1 border ${feedback.type === 'error' ? 'border-danger text-danger bg-danger-subtle' : 'border-success text-success bg-success-subtle'}`}>
                                <span>{feedback.message}</span>
                                {feedback.retry && (
                                    <button type="button" className="btn btn-link btn-sm p-0 ms-2" onClick={feedback.retry}>Retry</button>
                                )}
                            </div>
                        )}
                        
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

                        {/* Add keywords button*/}
                        <button 
                            className="btn btn-sm ms-2 d-flex align-items-center gap-1"
                            style={{ 
                                backgroundColor: showAddForm ? 'var(--fv-panel-hover)' : 'transparent', 
                                color: showAddForm ? 'var(--fv-text-bright)' : 'var(--fv-text)',
                                border: '1px solid var(--fv-border)'
                            }}
                            onClick={() => setShowAddForm(!showAddForm)}
                        >
                            <i className={`bi bi-${showAddForm ? 'dash' : 'plus'}-circle`}></i>
                            {showAddForm ? 'Cancel' : 'New Keyword'}
                        </button>
                    </div>
                    
                    <button type="button" className="btn-close btn-close-white" onClick={onClose} title="Close (Esc)"></button>
                </div>

                {/* 2. Conditionally Rendered Add Keyword Toolbar */}
                {showAddForm && (
                    <div className="d-flex align-items-center gap-2 p-2 border-bottom" style={{ backgroundColor: 'var(--fv-panel)', borderColor: 'var(--fv-border)' }}>
                        <input 
                            type="text" 
                            className="form-control form-control-sm border-0 ms-2" 
                            placeholder="KEYWORD" 
                            value={newKey}
                            onChange={(e) => setNewKey(e.target.value.toUpperCase())}
                            style={{ width: '180px', backgroundColor: 'var(--fv-bg)', color: 'var(--fv-text-bright)' }}
                            autoFocus
                        />
                        
                        <input 
                            type="text" 
                            className="form-control form-control-sm border-0" 
                            placeholder="Value" 
                            value={newValue} 
                            onChange={(e) => setNewValue(e.target.value)} 
                            style={{ width: '150px', backgroundColor: 'var(--fv-bg)', color: 'var(--fv-text-bright)' }}
                        />
                        
                        <input 
                            type="text" 
                            className="form-control form-control-sm border-0" 
                            placeholder="Comment (optional)" 
                            value={newComment} 
                            onChange={(e) => setNewComment(e.target.value)} 
                            style={{ flex: 1, backgroundColor: 'var(--fv-bg)', color: 'var(--fv-text-bright)' }}
                        />
                        
                        <div className="form-check form-switch mb-0 ms-2" style={{ color: 'var(--fv-text)' }}>
                            <input 
                                className="form-check-input" 
                                type="checkbox" 
                                role="switch" 
                                id="numericSwitch" 
                                checked={isNumeric} 
                                onChange={(e) => setIsNumeric(e.target.checked)} 
                                style={{ cursor: 'pointer' }}
                            />
                            <label className="form-check-label" htmlFor="numericSwitch" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>Numeric</label>
                        </div>
                        
                        <button 
                            className="btn btn-sm ms-3" 
                            onClick={handleAddKeyword}
                            style={{ backgroundColor: 'var(--fv-bg)', color: '#fff', fontWeight: 'bold' }}
                            disabled={!newKey.trim()}
                        >
                            Add
                        </button>
                    </div>
                )}
                {/* --- END NEW KEYWORD FORM --- */}
                
                {/* Scrollable Table Area */}
                <div className="flex-grow-1 overflow-auto position-relative" style={{ backgroundColor: 'var(--fv-bg)' }}>
                    
                    {/* Sticky Table Header */}
                    <div className="d-flex fw-bold position-sticky top-0 shadow-sm border-bottom" style={{ height: '36px', backgroundColor: 'var(--fv-panel-hover)', color: 'var(--fv-text-bright)', borderColor: 'var(--fv-border)', zIndex: 3 }}>
                        <div className="d-flex align-items-center px-3 border-end flex-shrink-0" style={{ width: '180px', borderColor: 'rgba(255,255,255,0.05)' }}>Keyword</div>
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
                                    <div className="d-flex align-items-center px-3 border-end flex-shrink-0 fw-bold font-monospace text-truncate" style={{ width: '180px', borderColor: 'rgba(255,255,255,0.05)', color: 'var(--fv-accent)' }} title={c.keyword}>
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

                                    {/* Comment Cell (Editable) */}
                                    <div 
                                        className="d-flex align-items-center px-3 flex-grow-1 text-truncate fst-italic position-relative" 
                                        style={{ cursor: c.isCommentOnly ? 'default' : 'cell' }}
                                        onDoubleClick={() => { 
                                            if(!c.isCommentOnly) { 
                                                setEditingCommentKey(c.keyword); 
                                                setEditCommentValue(c.comment || ''); 
                                            } 
                                        }}
                                        title={c.isCommentOnly ? '' : "Double-click to edit comment"}
                                    >
                                        {editingCommentKey === c.keyword ? (
                                            <input 
                                                type="text" 
                                                className="form-control form-control-sm border-0 rounded-0 w-100 h-100 px-2"
                                                style={{ backgroundColor: 'var(--fv-accent)', color: '#000', position: 'absolute', top: 0, left: 0, fontStyle: 'normal' }}
                                                value={editCommentValue}
                                                onChange={(e) => setEditCommentValue(e.target.value)}
                                                onBlur={() => handleSaveCommentEdit(c)}
                                                onKeyDown={(e) => { 
                                                    if (e.key === 'Enter') handleSaveCommentEdit(c); 
                                                    if (e.key === 'Escape') setEditingCommentKey(null); 
                                                }}
                                                autoFocus
                                            />
                                        ) : (
                                            <span className="text-truncate w-100">{c.comment}</span>
                                        )}
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