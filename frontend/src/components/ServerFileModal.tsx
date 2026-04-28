import { useState, useEffect } from 'react';

interface ServerFileModalProps {
    isOpen: boolean;
    onClose: () => void;
    onFileSelect: (serverPath: string) => void;
}

export function ServerFileModal({ isOpen, onClose, onFileSelect }: ServerFileModalProps) {
    const [currentPath, setCurrentPath] = useState<string>('.');
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        
        setLoading(true);
        fetch(`/api/fs/list?path=${encodeURIComponent(currentPath)}`)
            .then(res => res.json())
            .then(data => {
                if (data.items) {
                    setItems(data.items);
                    setCurrentPath(data.current_path);
                }
            })
            .catch(err => console.error("Failed to list directory", err))
            .finally(() => setLoading(false));
    }, [isOpen, currentPath]);

    if (!isOpen) return null;

    return (
        <div className="modal show d-block" style={{ backgroundColor: 'var(--fv-panel)' }}>
            <div className="modal-dialog modal-lg modal-dialog-scrollable">
                <div className="modal-content fv-bg fv-text">
                    <div className="modal-header border-secondary">
                        <h5 className="modal-title">Open from Server</h5>
                        <button type="button" className="btn-close btn-close-white" onClick={onClose}></button>
                    </div>
                    <div className="modal-body p-0">
                        <div className="bg-dark p-2 border-bottom border-secondary text-truncate">
                            <small className="text-muted">{currentPath}</small>
                        </div>
                        
                        {loading ? (
                            <div className="p-4 text-center"><div className="spinner-border text-primary"></div></div>
                        ) : (
                            <div className="list-group list-group-flush rounded-0">
                                {items.map((item, i) => (
                                    <button 
                                        key={i}
                                        className="list-group-item list-group-item-action bg-transparent text-white border-secondary d-flex align-items-center"
                                        onClick={() => {
                                            if (item.is_dir) {
                                                setCurrentPath(item.path);
                                            } else {
                                                onFileSelect(item.path);
                                                onClose();
                                            }
                                        }}
                                    >
                                        <i className={`bi ${item.is_dir ? 'bi-folder' : 'bi-file-earmark-image text-info'} me-3`}></i>
                                        {item.name}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}