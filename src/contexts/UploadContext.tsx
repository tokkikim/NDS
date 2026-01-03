'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// --- Types ---
export interface UploadItem {
    id: string; // Media ID in DB
    tempId: string; // Local UI tracking ID
    title: string;
    file: File | null;
    progress: number;
    status: 'uploading' | 'paused' | 'error' | 'processing' | 'completed';
    error?: string;
    sessionUri?: string; // GCS Resumable Session URI
}

interface UploadContextType {
    uploads: UploadItem[];
    startUpload: (params: { mediaId: string, file: File, title: string }) => Promise<void>;
    removeUpload: (id: string) => void;
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

// --- IndexedDB Utils ---
const DB_NAME = 'NDS_UPLOAD_DB';
const STORE_NAME = 'pending_files';

const initDB = () => {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const saveFileToDB = async (id: string, file: File, sessionUri?: string, title?: string) => {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ id, file, sessionUri, title, timestamp: Date.now() });
};

const getFileFromDB = async (id: string) => {
    const db = await initDB();
    return new Promise<{ id: string, file: File, sessionUri?: string, title?: string } | null>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
};

const deleteFileFromDB = async (id: string) => {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
};

const getAllFromDB = async () => {
    const db = await initDB();
    return new Promise<any[]>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result);
    });
};

// --- Provider Component ---
export const UploadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [uploads, setUploads] = useState<UploadItem[]>([]);

    // 1. 복구: 새로고침 시 IndexedDB에서 작업 복구
    useEffect(() => {
        const recoverUploads = async () => {
            const saved = await getAllFromDB();
            const items = saved.map(s => ({
                id: s.id,
                tempId: s.id,
                title: s.title || '재시작 중...',
                file: s.file,
                progress: 0,
                status: 'paused' as any,
                sessionUri: s.sessionUri
            }));
            if (items.length > 0) {
                setUploads(items);
                // 자동으로 이어올리기 실행
                items.forEach(item => performUpload(item.id, item.file, item.sessionUri));
            }
        };
        recoverUploads();
    }, []);

    // 2. 실제 업로더 로직
    const performUpload = useCallback(async (mediaId: string, file: File, existingSessionUri?: string) => {
        let sessionUri = existingSessionUri;

        try {
            // A. 세션이 없으면 새로 획득
            if (!sessionUri) {
                const { data, error } = await supabase.functions.invoke('get-gcs-signed-url', {
                    body: {
                        action: 'upload',
                        mediaId: mediaId,
                        fileExt: file.name.split('.').pop(),
                        contentType: file.type
                    }
                });

                if (error) throw error;

                // GCS에 세션 시작 요청 (Signed URL로 POST)
                const res = await fetch(data.signedUrl, {
                    method: 'POST',
                    headers: {
                        'x-goog-resumable': 'start',
                        'content-type': file.type
                    }
                });

                sessionUri = res.headers.get('Location') || undefined;
                if (!sessionUri) throw new Error('Resumable Session URI 획득 실패');

                // 세션 정보 DB 저장 (새로고침 대비)
                await saveFileToDB(mediaId, file, sessionUri, file.name);
            }

            // B. 현재 업로드 상태 확인 (얼마나 보냈는지)
            const checkRes = await fetch(sessionUri, {
                method: 'PUT',
                headers: { 'Content-Range': `bytes */${file.size}` }
            });

            let startByte = 0;
            if (checkRes.status === 308) {
                const range = checkRes.headers.get('Range');
                if (range) {
                    startByte = parseInt(range.split('-')[1]) + 1;
                }
            } else if (checkRes.status === 200 || checkRes.status === 201) {
                // 이미 완료된 경우
                handleFinish(mediaId);
                return;
            }

            // C. 중단 지점부터 스트리밍 업로드
            const chunk = file.slice(startByte);
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', sessionUri, true);
            xhr.setRequestHeader('Content-Range', `bytes ${startByte}-${file.size - 1}/${file.size}`);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const totalLoaded = startByte + e.loaded;
                    const p = Math.round((totalLoaded / file.size) * 100);
                    setUploads(prev => prev.map(u => u.id === mediaId ? { ...u, progress: p, status: 'uploading' } : u));
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200 || xhr.status === 201) {
                    handleFinish(mediaId);
                } else {
                    handleError(mediaId, `서버 응답 오류: ${xhr.status}`);
                }
            };

            xhr.onerror = () => handleError(mediaId, '네트워크 연결 오류');
            xhr.send(chunk);

        } catch (err: any) {
            handleError(mediaId, err.message);
        }
    }, []);

    const handleFinish = async (id: string) => {
        await deleteFileFromDB(id);
        setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'processing', progress: 100 } : u));
        // Cloud Run이 처리 완료할 때까지 잠시 대기 후 목록에서 제거 (UI는 Medias 페이지에서 갱신됨)
        setTimeout(() => removeUpload(id), 5000);
    };

    const handleError = (id: string, msg: string) => {
        console.error(`Upload [${id}] Error:`, msg);
        setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'error', error: msg } : u));
    };

    const startUpload = async (params: { mediaId: string, file: File, title: string }) => {
        const newItem: UploadItem = {
            id: params.mediaId,
            tempId: params.mediaId,
            title: params.title,
            file: params.file,
            progress: 0,
            status: 'uploading'
        };
        setUploads(prev => [...prev, newItem]);
        await saveFileToDB(params.mediaId, params.file, undefined, params.title);
        performUpload(params.mediaId, params.file);
    };

    const removeUpload = (id: string) => {
        setUploads(prev => prev.filter(u => u.id !== id));
        deleteFileFromDB(id);
    };

    const [isMinimized, setIsMinimized] = useState(false);

    return (
        <UploadContext.Provider value={{ uploads, startUpload, removeUpload }}>
            {children}
            {/* 전역 프로그레스 UI */}
            {uploads.length > 0 && (
                <div style={{
                    position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999,
                    background: 'rgba(255, 255, 255, 0.95)', backdropFilter: 'blur(10px)',
                    borderRadius: '20px', boxShadow: '0 20px 50px rgba(0,0,0,0.15)',
                    padding: isMinimized ? '12px 20px' : '20px',
                    width: isMinimized ? '260px' : '320px',
                    border: '1px solid rgba(0,0,0,0.05)',
                    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                    cursor: isMinimized ? 'pointer' : 'default'
                }} onClick={() => isMinimized && setIsMinimized(false)}>
                    <div style={{
                        fontWeight: '900', fontSize: '0.9rem', color: '#0f172a',
                        marginBottom: isMinimized ? '0' : '16px',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '8px', height: '8px', background: '#0284c7', borderRadius: '50%' }} />
                            <span>업로드 {isMinimized ? `(${uploads.length})` : '진행 정보'}</span>
                        </div>
                        <button
                            onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }}
                            style={{
                                border: 'none', background: 'rgba(0,0,0,0.05)', borderRadius: '6px',
                                width: '24px', height: '24px', display: 'flex', alignItems: 'center',
                                justifyContent: 'center', cursor: 'pointer', color: '#64748b'
                            }}
                        >
                            {isMinimized ? '＋' : '－'}
                        </button>
                    </div>

                    {!isMinimized && (
                        <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {uploads.map(u => (
                                <div key={u.id}>
                                    <div style={{ fontSize: '0.8rem', fontWeight: '800', color: '#334155', marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
                                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }}>{u.title}</span>
                                        <span style={{ color: '#0284c7' }}>{u.progress}%</span>
                                    </div>
                                    <div style={{ height: '6px', background: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                                        <div style={{
                                            width: `${u.progress}%`, height: '100%',
                                            background: u.status === 'error' ? '#ef4444' : u.status === 'processing' ? '#8b5cf6' : 'linear-gradient(90deg, #38bdf8, #0284c7)',
                                            transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
                                        }} />
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '0.72rem', fontWeight: '800' }}>
                                        <span style={{ color: u.status === 'error' ? '#ef4444' : u.status === 'processing' ? '#8b5cf6' : '#64748b' }}>
                                            {u.status === 'error' ? '전송 실패' : u.status === 'processing' ? '클라우드 인코딩 중' : '전송 중'}
                                        </span>
                                        {u.status === 'error' && (
                                            <button onClick={() => performUpload(u.id, u.file!)} style={{ color: '#ef4444', border: '1px solid #ef4444', background: 'none', padding: '1px 6px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.65rem' }}>재시도</button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </UploadContext.Provider>
    );
};

export const useUpload = () => {
    const context = useContext(UploadContext);
    if (!context) throw new Error('useUpload must be used within UploadProvider');
    return context;
};
