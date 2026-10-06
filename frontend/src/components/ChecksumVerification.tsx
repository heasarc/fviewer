import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useCore } from '../core/FViewerContext';

interface ChecksumResult {
    dataOk: number;
    headerOk: number;
}

interface Verification {
    hduNum: number;
    result: ChecksumResult | null;
}

const checksumStatus = (status: number) => {
    if (status === 1) return 'Verified';
    if (status === 0) return 'Checksum keyword not present';
    if (status === -1) return 'Verification failed';
    return `Unexpected status (${status})`;
};

export const ChecksumVerification = () => {
    const { activeHdu, activeDataType, fitsWorker, isLoading } = useCore();
    const [isVerifying, setIsVerifying] = useState(false);
    const [verification, setVerification] = useState<Verification | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleVerifyChecksum = async () => {
        if (activeHdu === null) return;

        const hduNum = activeHdu;
        setIsVerifying(true);
        setVerification(null);
        setError(null);
        try {
            const result = await fitsWorker.verifyChecksum(hduNum);
            setVerification({ hduNum, result });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setIsVerifying(false);
        }
    };

    const canVerify = activeDataType === 'fits' && activeHdu !== null && !isLoading && !isVerifying;

    return (
        <>
            <li>
                <button
                    className="dropdown-item fv-dropdown-item"
                    onClick={handleVerifyChecksum}
                    disabled={!canVerify}
                >
                    <i className="bi bi-shield-check"></i>{' '}
                    {isVerifying ? 'Verifying Checksum...' : 'Verify HDU Checksum'}
                </button>
            </li>

            {(verification || error) && createPortal(
                <div
                    className="modal d-flex align-items-center justify-content-center p-4"
                    style={{ backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1050, position: 'fixed', inset: 0 }}
                    role="presentation"
                    onClick={() => { setVerification(null); setError(null); }}
                >
                    <div
                        className="rounded shadow-lg w-100 p-3"
                        style={{ maxWidth: '420px', backgroundColor: 'var(--fv-bg)', border: '1px solid var(--fv-border)', color: 'var(--fv-text)' }}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="checksum-dialog-title"
                        onClick={event => event.stopPropagation()}
                    >
                        <div className="d-flex justify-content-between align-items-center mb-3">
                            <h5 id="checksum-dialog-title" className="mb-0" style={{ color: 'var(--fv-text-bright)' }}>
                                FITS Checksum Verification
                            </h5>
                            <button
                                type="button"
                                className="btn-close btn-close-white"
                                aria-label="Close"
                                onClick={() => { setVerification(null); setError(null); }}
                            />
                        </div>
                        {error !== null ? (
                            <div className="alert alert-danger mb-0" role="alert">
                                Could not verify checksum: {error}
                            </div>
                        ) : verification?.result === null ? (
                            <p className="mb-0">Checksum verification is unavailable for this HDU.</p>
                        ) : verification ? (
                            <>
                                <p>HDU {verification.hduNum}</p>
                                <dl className="mb-0">
                                    <dt>Data checksum (DATASUM)</dt>
                                    <dd>{checksumStatus(verification.result.dataOk)}</dd>
                                    <dt>Header checksum (CHECKSUM)</dt>
                                    <dd className="mb-0">{checksumStatus(verification.result.headerOk)}</dd>
                                </dl>
                            </>
                        ) : null}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
};
