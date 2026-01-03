'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import {
    PlayCircle, Plus, Trash2, ArrowLeft, RefreshCw, Upload, Film,
    Image as ImageIcon, X, Edit2, Search, Tag, Filter, Package,
    Megaphone, ChevronLeft, ChevronRight, Building2, Calendar, CheckCircle2,
    AlertCircle, Clock, Loader2, Info, AlertTriangle, Layout
} from 'lucide-react';
import Link from 'next/link';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { useUpload } from '@/contexts/UploadContext';

// Design System Tokens (기기/편성 관리와 동일하게 적용)
const theme = {
    colors: {
        background: '#f8fafc',
        surface: '#ffffff',
        border: '#e2e8f0',
        divider: '#f1f5f9',
        primary: {
            main: '#0284c7',
            light: '#f0f9ff',
            border: '#38bdf8',
            hover: '#0369a1',
        },
        accent: {
            purple: '#8b5cf6',
            indigo: '#6366f1',
            amber: '#f59e0b',
            rose: '#f43f5e',
        },
        text: {
            title: '#0f172a',
            body: '#475569',
            muted: '#94a3b8',
            white: '#ffffff',
        },
        status: {
            danger: '#ef4444',
            success: '#10b981',
            warning: '#f59e0b',
        }
    },
    shadows: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    },
    radius: {
        sm: '6px',
        md: '10px',
        lg: '16px',
        xl: '24px',
    }
};

interface Brand {
    id: string;
    name: string;
    created_at: string;
}

interface Media {
    id: string;
    title: string;
    file_url: string;
    duration: number;
    format: string;
    brand_id: string;
    product_name?: string;
    ad_type?: string;
    resolution?: string;
    created_at: string;
    is_verified: boolean;
    verification_notes?: string;
    brands?: Brand;
    // Local state for UI only
    isUploading?: boolean;
    isCompressing?: boolean;
    uploadProgress?: number;
    compressionProgress?: number;
    uploadError?: string;
    isAnalyzing?: boolean;
}

interface Toast {
    id: number;
    message: string;
    type: 'success' | 'error' | 'info' | 'warning';
}

const AD_TYPES = ['브랜드광고', '제품광고', '프로모션', '기업홍보', '기타'];
const UPLOAD_TARGET: 'SUPABASE' | 'GCP' = 'GCP'; // 50MB 제한 우회를 위해 GCP로 기본 전환

export default function MediasPage() {
    const [medias, setMedias] = useState<Media[]>([]);
    const [brands, setBrands] = useState<Brand[]>([]);
    const [loading, setLoading] = useState(true);

    // UI Local State
    const [isAdding, setIsAdding] = useState(false);
    const [isManagingBrands, setIsManagingBrands] = useState(false);
    const [editingMedia, setEditingMedia] = useState<Media | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedBrandFilter, setSelectedBrandFilter] = useState('');
    const [toasts, setToasts] = useState<Toast[]>([]);

    // Form State
    const [newMedia, setNewMedia] = useState({
        title: '',
        duration: 15,
        brand_id: '',
        product_name: '',
        ad_type: '브랜드광고',
        resolution: '1920x1080',
    });
    const [viewingMedia, setViewingMedia] = useState<Media | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [selectedFileForEdit, setSelectedFileForEdit] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const fileInputEditRef = useRef<HTMLInputElement>(null);
    const ffmpegRef = useRef<FFmpeg | null>(null);
    const [isFFmpegLoaded, setIsFFmpegLoaded] = useState(false);
    const { startUpload, uploads } = useUpload();

    // 전역 업로드 상태를 미디어 리스트에 동기화
    useEffect(() => {
        setMedias(prev => prev.map(m => {
            const ongoing = uploads.find(u => u.id === m.id);
            if (ongoing) {
                return {
                    ...m,
                    isUploading: ongoing.status === 'uploading',
                    isAnalyzing: ongoing.status === 'processing',
                    uploadProgress: ongoing.progress,
                    uploadError: ongoing.error
                };
            }
            // 큐에 없는 경우 기존 업로드 관련 상태 초기화 (DB 상태인 PENDING_UPLOAD가 우선하도록)
            return {
                ...m,
                isUploading: false,
                isAnalyzing: false,
                uploadError: undefined
            };
        }));
    }, [uploads]);

    const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
    };

    // 업로드 중 새로고침 방지
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (medias.some(m => m.isUploading)) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [medias]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const { data: mediaData } = await supabase
                .from('medias')
                .select('*, brands(id, name, created_at)')
                .order('created_at', { ascending: false });
            if (mediaData) setMedias(mediaData as any);

            const { data: brandData } = await supabase.from('brands').select('*').order('name');
            if (brandData) setBrands(brandData as Brand[]);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const loadFFmpeg = async () => {
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
        const ffmpeg = new FFmpeg();
        ffmpeg.on('log', ({ message }) => {
            console.log(message);
        });
        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        ffmpegRef.current = ffmpeg;
        setIsFFmpegLoaded(true);
    };

    useEffect(() => {
        fetchData();
        loadFFmpeg();
    }, []);

    // 압축/업로드 중 페이지 이탈 방지 경고
    useEffect(() => {
        const isProcessing = medias.some(m => m.isUploading || m.isCompressing);
        if (!isProcessing) return;

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '소재 업로드 또는 압축이 진행 중입니다. 페이지를 벗어나면 작업이 중단될 수 있습니다.';
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [medias]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setSelectedFile(file);
            if (!newMedia.title) {
                setNewMedia(prev => ({ ...prev, title: file.name.replace(/\.[^/.]+$/, "") }));
            }
            // 해상도/초수 감지 로직
            if (file.type.startsWith('video/')) {
                const video = document.createElement('video');
                video.preload = 'metadata';
                video.onloadedmetadata = () => {
                    window.URL.revokeObjectURL(video.src);
                    setNewMedia(prev => ({
                        ...prev,
                        duration: Math.floor(video.duration),
                        resolution: `${video.videoWidth}x${video.videoHeight}`
                    }));
                };
                video.src = URL.createObjectURL(file);
            }
        }
    };

    const handleEditFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setSelectedFileForEdit(file);
            if (editingMedia) {
                if (file.type.startsWith('video/')) {
                    const video = document.createElement('video');
                    video.preload = 'metadata';
                    video.onloadedmetadata = () => {
                        window.URL.revokeObjectURL(video.src);
                        setEditingMedia(prev => prev ? ({
                            ...prev,
                            duration: Math.floor(video.duration),
                            resolution: `${video.videoWidth}x${video.videoHeight}`
                        }) : null);
                    };
                    video.src = URL.createObjectURL(file);
                }
            }
        }
    };

    const compressVideo = async (file: File, onProgress: (p: number) => void): Promise<File> => {
        const ffmpeg = ffmpegRef.current;
        if (!ffmpeg || !isFFmpegLoaded) {
            throw new Error('FFmpeg가 아직 로드되지 않았습니다.');
        }

        const inputName = `input_${Date.now()}.mp4`;
        const outputName = `output_${Date.now()}.mp4`;

        try {
            await ffmpeg.writeFile(inputName, await fetchFile(file));

            ffmpeg.on('progress', ({ progress }) => {
                onProgress(Math.round(progress * 100));
            });

            // 플레이어 호환성을 극대화하고 메모리 오류(malloc failed)를 방지하기 위한 설정
            // 5K/8K 등 초고해상도 영상은 1920px 너비로 리사이징하여 브라우저 메모리 한계 극복
            // -vf "scale=...": 너비 1920 초과 시 축소, 높이는 비율에 맞게 짝수로 자동 조절
            const result = await ffmpeg.exec([
                '-i', inputName,
                '-vf', "scale='if(gt(iw,1920),1920,iw)':-2",
                '-vcodec', 'libx264',
                '-crf', '26', // 용량과 화질의 균형 (24 -> 26)
                '-preset', 'ultrafast', // 브라우저 환경에서는 속도가 최우선
                '-pix_fmt', 'yuv420p',
                '-acodec', 'aac',
                '-b:a', '128k',
                '-movflags', '+faststart',
                '-y',
                outputName
            ]);

            if (result !== 0) {
                throw new Error('FFmpeg 압축 프로세스가 비정상 종료되었습니다.');
            }

            const data = (await ffmpeg.readFile(outputName)) as any;
            if (!data || data.buffer.byteLength === 0) {
                throw new Error('압축 결과물이 생성되지 않았거나 손상되었습니다.');
            }

            // 임시 파일 삭제
            await ffmpeg.deleteFile(inputName);
            await ffmpeg.deleteFile(outputName);

            return new File([data.buffer], file.name, { type: 'video/mp4' });
        } catch (e: any) {
            console.error('FFmpeg Compression Trace:', e);
            throw e;
        }
    };

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedFile) return;

        let fileToUpload = selectedFile;
        const mediaParams = { ...newMedia };
        const tempId = `temp-${Date.now()}`;

        // 1. 용량 체크 및 모달 닫기
        const needsCompression = fileToUpload.type.startsWith('video/') && fileToUpload.size > 40 * 1024 * 1024;
        setIsAdding(false);
        setSelectedFile(null);
        setNewMedia({ title: '', duration: 15, brand_id: '', product_name: '', ad_type: '브랜드광고', resolution: '1920x1080' });

        // 2. 가상 데이터 추가
        const placeholder: Media = {
            id: tempId,
            title: mediaParams.title,
            file_url: '',
            duration: mediaParams.duration,
            format: fileToUpload.name.split('.').pop() || 'unknown',
            brand_id: mediaParams.brand_id,
            product_name: mediaParams.product_name,
            ad_type: mediaParams.ad_type,
            resolution: mediaParams.resolution,
            created_at: new Date().toISOString(),
            isUploading: true,
            isCompressing: UPLOAD_TARGET === 'SUPABASE' && needsCompression,
            uploadProgress: 0,
            compressionProgress: 0,
            is_verified: false,
            brands: brands.find(b => b.id === mediaParams.brand_id)
        };
        setMedias(prev => [placeholder, ...prev]);

        try {
            if (UPLOAD_TARGET === 'GCP') {
                // --- GCP (Cloud Storage + Cloud Run) 경로 ---

                // A. DB에 먼저 레코드 생성 (ID 획득)
                const { data: dbData, error: dbError } = await supabase.from('medias').insert([{
                    title: mediaParams.title,
                    file_url: 'PENDING_UPLOAD', // 업로드 완료 전 임시값
                    duration: mediaParams.duration,
                    format: fileToUpload.name.split('.').pop(),
                    brand_id: mediaParams.brand_id || null,
                    product_name: mediaParams.product_name,
                    ad_type: mediaParams.ad_type,
                    resolution: mediaParams.resolution,
                    is_verified: false,
                    verification_notes: 'GCP 서버에서 인코딩 대기 중...'
                }]).select('*, brands(id, name, created_at)').single();

                if (dbError) throw dbError;
                const mediaId = dbData.id;

                // 전역 업로드 매니저에게 정권 이양 (세션/IndexedDB/전송 모두 담당)
                await startUpload({
                    mediaId: mediaId,
                    file: fileToUpload,
                    title: mediaParams.title
                });

                setMedias(prev => [dbData, ...prev.filter(m => m.id !== tempId)]);
                showToast('백그라운드 업로드가 시작되었습니다.', 'success');

            } else {
                // --- 레거시 (Supabase WASM) 경로 ---
                if (needsCompression) {
                    fileToUpload = await compressVideo(fileToUpload, (p) => {
                        setMedias(prev => prev.map(m => m.id === tempId ? { ...m, compressionProgress: p } : m));
                    });
                    setMedias(prev => prev.map(m => m.id === tempId ? { ...m, isCompressing: false } : m));
                }

                const fileExt = fileToUpload.name.split('.').pop();
                const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
                const filePath = `uploads/${fileName}`;

                const { error: uploadError } = await (supabase.storage.from('ads') as any).upload(
                    filePath, fileToUpload, {
                    resumable: true,
                    onProgress: (progress: any) => {
                        const p = Math.round((progress.loaded / progress.total) * 100);
                        setMedias(prev => prev.map(m => m.id === tempId ? { ...m, uploadProgress: p } : m));
                    }
                }
                );

                if (uploadError) throw uploadError;

                const { data: { publicUrl } } = supabase.storage.from('ads').getPublicUrl(filePath);

                const { data: dbData, error: dbError } = await supabase.from('medias').insert([{
                    title: mediaParams.title,
                    file_url: publicUrl,
                    duration: mediaParams.duration,
                    format: fileExt,
                    brand_id: mediaParams.brand_id || null,
                    product_name: mediaParams.product_name,
                    ad_type: mediaParams.ad_type,
                    resolution: mediaParams.resolution
                }]).select('*, brands(id, name, created_at)').single();

                if (dbError) throw dbError;

                setMedias(prev => prev.map(m => m.id === tempId ? { ...dbData, isUploading: false } : m));
                showToast('소재 등록이 완료되었습니다.', 'success');
            }
        } catch (error: any) {
            console.error('Upload Error:', error);
            const msg = error.message || '업로드 중 오류가 발생했습니다.';
            setMedias(prev => prev.map(m => m.id === tempId ? { ...m, isUploading: false, uploadError: msg } : m));
            showToast(`등록 실패: ${msg}`, 'error');
        }
    };

    const handleUpdateMedia = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingMedia) return;

        const mediaId = editingMedia.id;
        const fileToProcess = selectedFileForEdit;
        const mediaData = { ...editingMedia };

        try {
            // 파일이 변경된 경우: 백그라운드 프로세스를 우선 실행하고 정보 업데이트를 성공 이후로 미룸
            if (fileToProcess) {
                const needsCompression = fileToProcess.type.startsWith('video/') && fileToProcess.size > 40 * 1024 * 1024;

                // 가상 상태 업데이트 (리스트 UI 반영용)
                setMedias(prev => prev.map(m => m.id === mediaId ? ({
                    ...m,
                    ...mediaData,
                    is_verified: false,
                    isUploading: true,
                    isCompressing: needsCompression,
                    uploadProgress: 0,
                    compressionProgress: 0
                } as Media) : m));

                // 백그라운드 비공개 루틴
                (async () => {
                    try {
                        if (UPLOAD_TARGET === 'GCP') {
                            // A. DB 업데이트 (파일 상태 PENDING으로 전환)
                            await supabase.from('medias').update({
                                file_url: 'PENDING_UPLOAD',
                                is_verified: false,
                                format: fileToProcess.name.split('.').pop()
                            }).eq('id', mediaId);

                            // 전역 매니저에게 이양
                            await startUpload({
                                mediaId: mediaId,
                                file: fileToProcess,
                                title: mediaData.title
                            });

                            showToast('새 파일 전송을 시작합니다 (백그라운드).', 'success');

                        } else {
                            // --- 레거시 경로 ---
                            let finalFile = fileToProcess;
                            if (needsCompression) {
                                finalFile = await compressVideo(fileToProcess, (p) => {
                                    setMedias(prev => prev.map(m => m.id === mediaId ? { ...m, compressionProgress: p } : m));
                                });
                                setMedias(prev => prev.map(m => m.id === mediaId ? { ...m, isCompressing: false } : m));
                            }

                            const fileExt = finalFile.name.split('.').pop() || '';
                            const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
                            const filePath = `uploads/${fileName}`;

                            const { error: uploadError } = await (supabase.storage.from('ads') as any).upload(
                                filePath, finalFile, {
                                resumable: true,
                                onProgress: (progress: any) => {
                                    const p = Math.round((progress.loaded / progress.total) * 100);
                                    setMedias(prev => prev.map(m => m.id === mediaId ? { ...m, uploadProgress: p } : m));
                                }
                            }
                            );

                            if (uploadError) throw uploadError;

                            const { data: { publicUrl } } = supabase.storage.from('ads').getPublicUrl(filePath);

                            // 파일 업로드 및 압축 완료 후에만 정보 DB 업데이트 진행
                            const { data: dbData, error: dbError } = await supabase
                                .from('medias')
                                .update({
                                    title: mediaData.title,
                                    brand_id: mediaData.brand_id || null,
                                    product_name: mediaData.product_name,
                                    ad_type: mediaData.ad_type,
                                    duration: mediaData.duration,
                                    resolution: mediaData.resolution,
                                    file_url: publicUrl,
                                    format: fileExt,
                                    is_verified: false
                                })
                                .eq('id', mediaId)
                                .select('*, brands(id, name, created_at)')
                                .single();

                            if (dbError) throw dbError;

                            setMedias(prev => prev.map(m => m.id === mediaId ? { ...(dbData as Media), isUploading: false } : m));
                            showToast('소재 파일 및 정보 변경이 완료되었습니다.', 'success');
                        }
                    } catch (err: any) {
                        console.error('File update failed:', err);
                        setMedias(prev => prev.map(m => m.id === mediaId ? { ...m, isUploading: false, uploadError: err.message } : m));
                        showToast('파일 업로드 중 오류가 발생했습니다.', 'error');
                    }
                })();
            } else {
                // 파일 변경이 없는 단순 정보 수정
                const { data: dbData, error: dbError } = await supabase
                    .from('medias')
                    .update({
                        title: mediaData.title,
                        brand_id: mediaData.brand_id || null,
                        product_name: mediaData.product_name,
                        ad_type: mediaData.ad_type,
                        duration: mediaData.duration,
                        resolution: mediaData.resolution,
                        is_verified: false
                    })
                    .eq('id', mediaId)
                    .select('*, brands(id, name, created_at)')
                    .single();

                if (dbError) throw dbError;
                setMedias(prev => prev.map(m => m.id === mediaId ? (dbData as Media) : m));
                showToast('소재 정보가 성공적으로 수정되었습니다.', 'success');
            }

            setEditingMedia(null);
            setSelectedFileForEdit(null);
        } catch (error: any) {
            console.error('Update Error:', error);
            showToast(`수정 실패: ${error.message}`, 'error');
        }
    };

    const handleAddBrand = async (name: string) => {
        if (!name.trim()) return;
        const { data, error } = await supabase.from('brands').insert([{ name }]).select().single();
        if (!error && data) {
            setBrands(prev => [...prev, data as Brand]);
            showToast('브랜드가 추가되었습니다.', 'success');
        } else {
            showToast('브랜드 추가 실패', 'error');
        }
    };

    const handleDeleteBrand = async (id: string) => {
        if (!confirm('브랜드를 삭제하시겠습니까? 관련 소재의 브랜드 정보가 미지정으로 변경될 수 있습니다.')) return;
        const { error } = await supabase.from('brands').delete().eq('id', id);
        if (!error) {
            setBrands(prev => prev.filter(b => b.id !== id));
            showToast('브랜드가 삭제되었습니다.', 'info');
        } else {
            showToast('삭제 실패 (활성 소재가 있을 수 있음)', 'error');
        }
    };

    const handleToggleVerify = async (media: Media) => {
        const newStatus = !media.is_verified;
        const { error } = await supabase
            .from('medias')
            .update({ is_verified: newStatus })
            .eq('id', media.id);

        if (!error) {
            setMedias(prev => prev.map(m => m.id === media.id ? { ...m, is_verified: newStatus } : m));
            if (viewingMedia?.id === media.id) {
                setViewingMedia(prev => prev ? { ...prev, is_verified: newStatus } : null);
            }
            showToast(newStatus ? '소재 검증이 완료되었습니다.' : '소재 검증이 취소되었습니다.', 'success');
        } else {
            showToast('검증 상태 변경 실패', 'error');
        }
    };

    const handleAnalyzeMedia = async (media: Media) => {
        if (!ffmpegRef.current || !isFFmpegLoaded) {
            showToast('분석 엔진이 로드되지 않았습니다.', 'warning');
            return;
        }

        setMedias(prev => prev.map(m => m.id === media.id ? { ...m, isAnalyzing: true } : m));
        try {
            const ffmpeg = ffmpegRef.current;
            const fileName = `temp_${media.id}.${media.format || 'mp4'}`;

            // 1. 파일 다운로드 (CORS 확인)
            const response = await fetch(media.file_url, { mode: 'cors' });
            if (!response.ok) throw new Error('파일 다운로드 실패 (네트워크 또는 CORS 문제)');

            const blob = await response.blob();
            await ffmpeg.writeFile(fileName, await fetchFile(blob));

            // 2. FFmpeg 실행 정보 수집
            let logs = '';
            const logHandler = ({ message }: { message: string }) => { logs += message + '\n'; };
            ffmpeg.on('log', logHandler);

            await ffmpeg.exec(['-i', fileName]);

            ffmpeg.off('log', logHandler);

            // 3. 코덱 및 해상도 파싱
            const isH264 = logs.toLowerCase().includes('h264') || logs.toLowerCase().includes('avc');
            const resMatch = logs.toLowerCase().match(/(\d{3,4})x(\d{3,4})/);

            const diagResult = {
                codec: isH264 ? 'H.264 (Recommended)' : 'Non-H.264 / Unknown',
                res: resMatch ? resMatch[0] : 'Unknown',
                isSafe: isH264
            };

            await ffmpeg.deleteFile(fileName);

            setMedias(prev => prev.map(m => m.id === media.id ? { ...m, isAnalyzing: false, verification_notes: JSON.stringify(diagResult) } : m));

            if (isH264) {
                showToast(`무결성 검사 완료: ${diagResult.codec}`, 'success');
            } else {
                showToast(`호환성 경고: 권장 코덱(H.264)이 아닙니다.`, 'warning');
            }
        } catch (e: any) {
            console.error(e);
            setMedias(prev => prev.map(m => m.id === media.id ? { ...m, isAnalyzing: false } : m));
            showToast(`분석 중 오류: ${e.message}`, 'error');
        }
    };

    const handleDelete = async (id: string, fileUrl: string) => {
        if (!confirm('소재를 삭제하시겠습니까?')) return;
        const { error } = await supabase.from('medias').delete().eq('id', id);
        if (!error) {
            setMedias(prev => prev.filter(m => m.id !== id));
            showToast('소재가 삭제되었습니다.', 'info');
        } else {
            showToast('삭제 중 오류가 발생했습니다.', 'error');
        }
    };

    const filteredMedias = medias.filter(m => {
        const matchesSearch = m.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            m.product_name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesBrand = !selectedBrandFilter || m.brand_id === selectedBrandFilter;
        return matchesSearch && matchesBrand;
    });

    return (
        <main style={{ padding: '40px 20px', minHeight: '100vh', backgroundColor: theme.colors.background }}>
            <div style={{ maxWidth: '1400px', margin: '0 auto' }}>

                {/* Header Section */}
                <header style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: '32px', background: theme.colors.surface,
                    padding: '24px 32px', borderRadius: theme.radius.xl,
                    boxShadow: theme.shadows.md, border: `1px solid ${theme.colors.border}`
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                        <Link href="/" style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: '44px', height: '44px', borderRadius: '12px',
                            background: theme.colors.divider, color: theme.colors.text.body,
                            textDecoration: 'none'
                        }}>
                            <ArrowLeft size={20} />
                        </Link>
                        <div>
                            <h1 style={{ fontSize: '1.75rem', fontWeight: '900', color: theme.colors.text.title, letterSpacing: '-0.025em' }}>소재 관리</h1>
                            <p style={{ color: theme.colors.text.muted, fontSize: '0.95rem' }}>광고 리소스 보관 및 데이터 통합 모니터링</p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button onClick={fetchData} className="btn-secondary" style={{ padding: '12px' }}>
                            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                        </button>
                        <Link href="/medias/compose" className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 20px', textDecoration: 'none', background: theme.colors.accent.purple, color: 'white', border: 'none' }}>
                            <Layout size={18} /> 합성 편집기
                        </Link>
                        <button onClick={() => setIsAdding(true)} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 24px' }}>
                            <Plus size={20} strokeWidth={3} /> 소재 추가
                        </button>
                    </div>
                </header>

                {/* Filter & Search Bar */}
                <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '300px', position: 'relative' }}>
                        <Search size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: theme.colors.text.muted }} />
                        <input
                            type="text"
                            placeholder="소재명 또는 제품명 검색..."
                            style={{
                                width: '100%', padding: '14px 14px 14px 48px',
                                borderRadius: '14px', border: `1px solid ${theme.colors.border}`,
                                background: 'white', outline: 'none', fontSize: '1rem',
                                boxShadow: theme.shadows.sm
                            }}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <select
                            style={{
                                padding: '0 20px', borderRadius: '14px', border: `1px solid ${theme.colors.border}`,
                                background: 'white', outline: 'none', fontWeight: '600', color: theme.colors.text.body,
                                minWidth: '160px', cursor: 'pointer'
                            }}
                            value={selectedBrandFilter}
                            onChange={(e) => setSelectedBrandFilter(e.target.value)}
                        >
                            <option value="">모든 브랜드</option>
                            {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    </div>
                </div>

                {/* Content Table - 기기관리 스타일 */}
                <div style={{
                    background: theme.colors.surface, borderRadius: theme.radius.xl,
                    border: `1px solid ${theme.colors.border}`, overflow: 'hidden',
                    boxShadow: theme.shadows.lg
                }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ background: theme.colors.divider, borderBottom: `1px solid ${theme.colors.border}` }}>
                                <th style={{ padding: '20px 24px', color: theme.colors.text.muted, fontSize: '0.8rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em' }}>소재 정보</th>
                                <th style={{ padding: '20px 24px', color: theme.colors.text.muted, fontSize: '0.8rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em' }}>제품 / 브랜드</th>
                                <th style={{ padding: '20px 24px', color: theme.colors.text.muted, fontSize: '0.8rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em' }}>규격 / 초수</th>
                                <th style={{ padding: '20px 24px', color: theme.colors.text.muted, fontSize: '0.8rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em' }}>업로드 상태</th>
                                <th style={{ padding: '20px 24px', color: theme.colors.text.muted, fontSize: '0.8rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>관리</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredMedias.map((media) => (
                                <tr key={media.id} style={{ borderBottom: `1px solid ${theme.colors.divider}`, transition: 'all 0.2s' }} className="table-row">
                                    <td style={{ padding: '20px 24px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                            <div
                                                onClick={() => setViewingMedia(media)}
                                                style={{
                                                    width: '56px', height: '56px', background: theme.colors.divider,
                                                    borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    color: theme.colors.text.muted, cursor: 'pointer', transition: 'transform 0.2s',
                                                    position: 'relative', overflow: 'hidden', border: `1px solid ${theme.colors.border}`
                                                }}
                                                className="media-thumb"
                                            >
                                                {media.format?.toLowerCase() === 'mp4' ? <Film size={26} /> : <ImageIcon size={26} />}
                                                <div className="thumb-overlay">
                                                    <PlayCircle size={20} color="white" />
                                                </div>
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: '800', color: theme.colors.text.title, fontSize: '1.05rem' }}>{media.title}</div>
                                                <div style={{ fontSize: '0.8rem', color: theme.colors.text.muted, marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    #{media.id.slice(0, 8)} | {media.format?.toUpperCase()}
                                                    {media.is_verified && <CheckCircle2 size={12} color={theme.colors.status.success} />}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td style={{ padding: '20px 24px' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <div style={{
                                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                                color: theme.colors.primary.main, background: theme.colors.primary.light,
                                                padding: '4px 12px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: '900',
                                                width: 'fit-content', border: `1px solid ${theme.colors.primary.border}33`
                                            }}>
                                                <Building2 size={12} /> {media.brands?.name || '미지정'}
                                            </div>
                                            <div style={{ fontSize: '0.9rem', color: theme.colors.text.body, fontWeight: '500', paddingLeft: '4px' }}>
                                                {media.product_name || <span style={{ color: theme.colors.text.muted }}>품명 없음</span>}
                                            </div>
                                        </div>
                                    </td>
                                    <td style={{ padding: '20px 24px' }}>
                                        <div style={{ fontSize: '0.95rem', color: theme.colors.text.title, fontWeight: '700' }}>{media.resolution || 'N/A'}</div>
                                        <div style={{ fontSize: '0.85rem', color: theme.colors.text.muted, marginTop: '4px' }}>재생 시간: {media.duration}s</div>
                                    </td>
                                    <td style={{ padding: '20px 24px' }}>
                                        {media.isUploading ? (
                                            // ... existing uploading UI ...
                                            <div style={{ width: '180px' }}>
                                                {media.isCompressing ? (
                                                    <>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.75rem', fontWeight: '900', color: theme.colors.accent.purple }}>
                                                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                <Loader2 size={12} className="animate-spin" /> 용량 압축 중...
                                                            </span>
                                                            <span>{media.compressionProgress}%</span>
                                                        </div>
                                                        <div style={{ height: '8px', background: theme.colors.divider, borderRadius: '4px', overflow: 'hidden' }}>
                                                            <div style={{ width: `${media.compressionProgress}%`, height: '100%', background: theme.colors.accent.purple, transition: 'width 0.3s' }} />
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.75rem', fontWeight: '900', color: theme.colors.primary.main }}>
                                                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                <Loader2 size={12} className="animate-spin" /> 서버 전송 중...
                                                            </span>
                                                            <span>{media.uploadProgress}%</span>
                                                        </div>
                                                        <div style={{ height: '8px', background: theme.colors.divider, borderRadius: '4px', overflow: 'hidden' }}>
                                                            <div style={{ width: `${media.uploadProgress}%`, height: '100%', background: theme.colors.primary.main, transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)' }} />
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        ) : media.uploadError ? (
                                            <div style={{ color: theme.colors.status.danger, display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: '800' }}>
                                                <AlertCircle size={16} /> 오류 발생
                                            </div>
                                        ) : (media.isAnalyzing || (UPLOAD_TARGET === 'GCP' && media.file_url === 'PENDING_UPLOAD')) ? (
                                            <div style={{ width: '180px' }}>
                                                {(() => {
                                                    const ongoing = uploads.find(u => u.id === media.id);
                                                    // 큐에 아예 없거나(전송완료 예상), 상태가 processing인 경우 -> 클라우드 처리 중
                                                    const isProcessing = media.isAnalyzing || !ongoing || ongoing.status === 'processing';
                                                    const isUploading = media.isUploading && ongoing?.status === 'uploading';

                                                    return (
                                                        <>
                                                            <div style={{
                                                                color: isUploading ? theme.colors.primary.main :
                                                                    isProcessing ? theme.colors.accent.purple :
                                                                        theme.colors.status.warning,
                                                                display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: '800', marginBottom: '4px'
                                                            }}>
                                                                {isUploading || isProcessing ? (
                                                                    <Loader2 size={16} className="animate-spin" />
                                                                ) : (
                                                                    <AlertTriangle size={16} />
                                                                )}
                                                                {isUploading ? '업로드 진행 중' :
                                                                    isProcessing ? '클라우드 처리 중' :
                                                                        '업로드 중단됨'}
                                                            </div>
                                                            {!isUploading && !isProcessing && (
                                                                <div style={{ fontSize: '0.75rem', color: theme.colors.text.muted }}>재시작이 필요합니다</div>
                                                            )}
                                                        </>
                                                    );
                                                })()}
                                            </div>
                                        ) : media.is_verified ? (
                                            <div style={{ color: theme.colors.status.success, display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: '800' }}>
                                                <CheckCircle2 size={16} /> 검증 완료
                                            </div>
                                        ) : (
                                            <div style={{ color: theme.colors.status.warning, display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: '800' }}>
                                                <Info size={16} /> 검증 대기
                                            </div>
                                        )}
                                    </td>
                                    <td style={{ padding: '20px 24px', textAlign: 'right' }}>
                                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
                                            <Link
                                                href={`/medias/compose?mediaId=${media.id}`}
                                                style={{
                                                    background: media.file_url === 'PENDING_UPLOAD' ? theme.colors.divider : theme.colors.accent.purple,
                                                    color: 'white',
                                                    padding: '6px 12px',
                                                    borderRadius: '8px',
                                                    fontSize: '0.75rem',
                                                    fontWeight: '900',
                                                    textDecoration: 'none',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    opacity: media.file_url === 'PENDING_UPLOAD' ? 0.5 : 1,
                                                    pointerEvents: media.file_url === 'PENDING_UPLOAD' ? 'none' : 'auto',
                                                    transition: 'all 0.2s'
                                                }}
                                                title="레이아웃 구성 및 인코딩 시작"
                                            >
                                                <Film size={14} /> 인코딩
                                            </Link>
                                            <button onClick={() => setViewingMedia(media)} className="btn-icon-s" style={{ background: theme.colors.primary.light, color: theme.colors.primary.main }} title="미리보기 및 검증"><Search size={16} /></button>
                                            <button onClick={() => setEditingMedia(media)} className="btn-icon-s" style={{ background: theme.colors.divider, color: theme.colors.text.body }}><Edit2 size={16} /></button>
                                            <button onClick={() => handleDelete(media.id, media.file_url)} className="btn-icon-s" style={{ background: '#fee2e2', color: theme.colors.status.danger }}><Trash2 size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!loading && filteredMedias.length === 0 && (
                        <div style={{ padding: '120px 20px', textAlign: 'center' }}>
                            <div style={{ background: theme.colors.divider, width: '80px', height: '80px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', color: theme.colors.text.muted }}>
                                <ImageIcon size={40} style={{ opacity: 0.3 }} />
                            </div>
                            <h3 style={{ fontSize: '1.25rem', fontWeight: '800', color: theme.colors.text.title }}>검색 결과가 없습니다</h3>
                            <p style={{ color: theme.colors.text.muted, marginTop: '8px' }}>필터 조건을 변경하거나 새로운 소재를 등록해 보세요.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Upload Modal */}
            {isAdding && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ maxWidth: '640px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                            <div>
                                <h2 style={{ fontSize: '1.5rem', fontWeight: '900', color: theme.colors.text.title }}>새 소재 등록</h2>
                                <p style={{ color: theme.colors.text.muted, fontSize: '0.85rem', marginTop: '4px' }}>파일 업로드는 백그라운드에서 진행됩니다.</p>
                            </div>
                            <button onClick={() => setIsAdding(false)} className="btn-icon" style={{ background: theme.colors.divider, color: theme.colors.text.muted }}><X size={24} /></button>
                        </div>

                        <form onSubmit={handleUpload} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            <div onClick={() => fileInputRef.current?.click()} style={{
                                border: `2px dashed ${theme.colors.border}`, borderRadius: '20px',
                                padding: '48px 24px', textAlign: 'center', cursor: 'pointer',
                                background: selectedFile ? theme.colors.primary.light : '#fcfcfc',
                                transition: 'all 0.2s'
                            }} className="upload-dropzone">
                                <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} accept="video/*,image/*" />
                                {selectedFile ? (
                                    <div style={{ color: theme.colors.primary.main }}>
                                        <div style={{ background: 'white', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', boxShadow: theme.shadows.md }}>
                                            <CheckCircle2 size={32} />
                                        </div>
                                        <div style={{ fontWeight: '900', color: theme.colors.text.title, fontSize: '1.1rem' }}>{selectedFile.name}</div>
                                        <div style={{ fontSize: '0.85rem', color: theme.colors.text.muted, marginTop: '6px' }}>용량: {(selectedFile.size / 1024 / 1024).toFixed(1)}MB</div>
                                    </div>
                                ) : (
                                    <>
                                        <div style={{ background: 'white', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: theme.colors.text.muted, boxShadow: theme.shadows.sm }}>
                                            <Upload size={32} />
                                        </div>
                                        <p style={{ fontWeight: '800', color: theme.colors.text.body, fontSize: '1.05rem' }}>클래식 업로드 또는 드래그</p>
                                        <p style={{ fontSize: '0.85rem', color: theme.colors.text.muted, marginTop: '8px' }}>50MB 이내의 MP4, JPG, PNG 파일</p>
                                    </>
                                )}
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                <div className="input-group">
                                    <label>소재 명칭</label>
                                    <input type="text" required value={newMedia.title} onChange={e => setNewMedia({ ...newMedia, title: e.target.value })} placeholder="리스트에 표시될 관리용 이름" />
                                </div>
                                <div className="input-group">
                                    <label>브랜드 설정</label>
                                    <select value={newMedia.brand_id} onChange={e => setNewMedia({ ...newMedia, brand_id: e.target.value })}>
                                        <option value="">소속 브랜드 없음</option>
                                        {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                    </select>
                                </div>
                                <div className="input-group">
                                    <label>세부 제품명 (선택)</label>
                                    <input type="text" value={newMedia.product_name} onChange={e => setNewMedia({ ...newMedia, product_name: e.target.value })} placeholder="광고 홍보 대상 제품" />
                                </div>
                                <div className="input-group">
                                    <label>광고 구분</label>
                                    <select value={newMedia.ad_type} onChange={e => setNewMedia({ ...newMedia, ad_type: e.target.value })}>
                                        {AD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                                <button type="button" onClick={() => setIsAdding(false)} className="btn-secondary" style={{ flex: 1, padding: '16px' }}>취소</button>
                                <button type="submit" className="btn-primary" disabled={!selectedFile || !isFFmpegLoaded} style={{ flex: 2, padding: '16px' }}>
                                    {!isFFmpegLoaded ? '엔진 준비 중...' : '업로드 시작'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            {editingMedia && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ maxWidth: '640px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                            <div>
                                <h2 style={{ fontSize: '1.5rem', fontWeight: '900', color: theme.colors.text.title }}>소재 정보 수정</h2>
                                <p style={{ color: theme.colors.text.muted, fontSize: '0.85rem' }}>#{editingMedia.id.slice(0, 8)} 데이터 업데이트</p>
                            </div>
                            <button onClick={() => setEditingMedia(null)} className="btn-icon" style={{ background: theme.colors.divider, color: theme.colors.text.muted }}><X size={24} /></button>
                        </div>

                        <form onSubmit={handleUpdateMedia} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            {/* File Change Row */}
                            <div style={{ display: 'flex', gap: '20px', alignItems: 'center', padding: '16px', background: theme.colors.divider, borderRadius: '16px' }}>
                                <div style={{ width: '80px', height: '80px', background: '#000', borderRadius: '12px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {editingMedia.format?.toLowerCase() === 'mp4' ? (
                                        <div style={{ color: 'white' }}><PlayCircle size={32} /></div>
                                    ) : (
                                        <img src={editingMedia.file_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    )}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '0.8rem', color: theme.colors.text.muted, marginBottom: '4px' }}>현재 파일: {editingMedia.format?.toUpperCase()}</div>
                                    <button
                                        type="button"
                                        onClick={() => fileInputEditRef.current?.click()}
                                        className="btn-secondary"
                                        style={{ padding: '8px 16px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                                    >
                                        <Upload size={14} /> 소재 파일 교체
                                    </button>
                                    <input type="file" ref={fileInputEditRef} onChange={handleEditFileChange} style={{ display: 'none' }} accept="video/*,image/*" />
                                    {selectedFileForEdit && (
                                        <div style={{ marginTop: '8px', fontSize: '0.8rem', color: theme.colors.primary.main, fontWeight: '800' }}>
                                            신규 선택됨: {selectedFileForEdit.name}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                <div className="input-group">
                                    <label>소재 명칭</label>
                                    <input type="text" required value={editingMedia.title} onChange={e => setEditingMedia({ ...editingMedia, title: e.target.value })} />
                                </div>
                                <div className="input-group">
                                    <label>브랜드 설정</label>
                                    <select value={editingMedia.brand_id || ''} onChange={e => setEditingMedia({ ...editingMedia, brand_id: e.target.value })}>
                                        <option value="">미지정</option>
                                        {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                    </select>
                                </div>
                                <div className="input-group">
                                    <label>세부 제품명</label>
                                    <input type="text" value={editingMedia.product_name || ''} onChange={e => setEditingMedia({ ...editingMedia, product_name: e.target.value })} />
                                </div>
                                <div className="input-group">
                                    <label>광고 구분</label>
                                    <select value={editingMedia.ad_type} onChange={e => setEditingMedia({ ...editingMedia, ad_type: e.target.value })}>
                                        {AD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div className="input-group">
                                    <label>재생 시간(초)</label>
                                    <input type="number" value={editingMedia.duration} onChange={e => setEditingMedia({ ...editingMedia, duration: parseInt(e.target.value) })} />
                                </div>
                                <div className="input-group">
                                    <label>해상도</label>
                                    <input type="text" value={editingMedia.resolution || ''} onChange={e => setEditingMedia({ ...editingMedia, resolution: e.target.value })} />
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                                <button type="button" onClick={() => setEditingMedia(null)} className="btn-secondary" style={{ flex: 1, padding: '16px' }}>취소</button>
                                <button type="submit" className="btn-primary" style={{ flex: 2, padding: '16px' }}>변경사항 저장</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Brand Management Modal */}
            {isManagingBrands && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ maxWidth: '480px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                            <h2 style={{ fontSize: '1.5rem', fontWeight: '900', color: theme.colors.text.title }}>브랜드 관리</h2>
                            <button onClick={() => setIsManagingBrands(false)} className="btn-icon" style={{ background: theme.colors.divider }}><X size={24} /></button>
                        </div>

                        <div style={{ marginBottom: '24px' }}>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input id="new-brand-name" type="text" placeholder="새 브랜드 이름" style={{ flex: 1, padding: '12px', borderRadius: '10px', border: `1px solid ${theme.colors.border}` }} />
                                <button onClick={() => {
                                    const input = document.getElementById('new-brand-name') as HTMLInputElement;
                                    handleAddBrand(input.value);
                                    input.value = '';
                                }} className="btn-primary" style={{ padding: '0 20px' }}>추가</button>
                            </div>
                        </div>

                        <div style={{ maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {brands.map(brand => (
                                <div key={brand.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: theme.colors.divider, borderRadius: '12px' }}>
                                    <span style={{ fontWeight: '700', color: theme.colors.text.body }}>{brand.name}</span>
                                    <button onClick={() => handleDeleteBrand(brand.id)} style={{ border: 'none', background: 'none', color: theme.colors.status.danger, cursor: 'pointer' }}><Trash2 size={18} /></button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Preview & Inspection Modal */}
            {viewingMedia && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ maxWidth: '900px', display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '32px', padding: '0', overflow: 'hidden' }}>
                        <div style={{ background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '500px', position: 'relative' }}>
                            {['mp4', 'mov', 'webm', 'm4v'].includes(viewingMedia.format?.toLowerCase() || '') ? (
                                <video
                                    src={viewingMedia.file_url}
                                    controls
                                    autoPlay
                                    muted
                                    playsInline
                                    crossOrigin="anonymous"
                                    style={{ maxWidth: '100%', maxHeight: '600px' }}
                                    onError={(e) => {
                                        console.error('Preview Playback Error:', e);
                                        showToast('브라우저에서 재생할 수 없는 코덱이거나 파일에 문제가 있습니다.', 'error');
                                    }}
                                />
                            ) : (
                                <img
                                    src={viewingMedia.file_url}
                                    alt={viewingMedia.title}
                                    crossOrigin="anonymous"
                                    style={{ maxWidth: '100%', maxHeight: '600px', objectFit: 'contain' }}
                                />
                            )}
                        </div>
                        <div style={{ padding: '40px', display: 'flex', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
                                <div>
                                    <h2 style={{ fontSize: '1.5rem', fontWeight: '900', color: theme.colors.text.title }}>소재 상세 검증</h2>
                                    <p style={{ color: theme.colors.text.muted, fontSize: '0.85rem' }}>ID: {viewingMedia.id}</p>
                                </div>
                                <button onClick={() => setViewingMedia(null)} className="btn-icon" style={{ background: theme.colors.divider }}><X size={24} /></button>
                            </div>

                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                <div style={{ padding: '16px', background: theme.colors.divider, borderRadius: '12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: theme.colors.text.title, fontWeight: '800', marginBottom: '12px' }}>
                                        <Tag size={18} /> 소재 메타데이터
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.85rem' }}>
                                        <div><span style={{ color: theme.colors.text.muted }}>명칭:</span> {viewingMedia.title}</div>
                                        <div><span style={{ color: theme.colors.text.muted }}>규격:</span> {viewingMedia.resolution || 'N/A'}</div>
                                        <div><span style={{ color: theme.colors.text.muted }}>초수:</span> {viewingMedia.duration}s</div>
                                        <div><span style={{ color: theme.colors.text.muted }}>형식:</span> {viewingMedia.format?.toUpperCase()}</div>
                                    </div>
                                </div>

                                <div style={{ padding: '16px', border: `1px solid ${theme.colors.border}`, borderRadius: '12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: theme.colors.text.title, fontWeight: '800', marginBottom: '12px' }}>
                                        <CheckCircle2 size={18} /> 기술 무결성 진단 (플레이어 호환성)
                                    </div>
                                    {viewingMedia.verification_notes ? (
                                        (() => {
                                            try {
                                                const diag = JSON.parse(viewingMedia.verification_notes);
                                                return (
                                                    <div style={{ fontSize: '0.8rem', color: theme.colors.text.body, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                            <span>코덱:</span>
                                                            <span style={{ fontWeight: '800', color: diag.isSafe ? theme.colors.status.success : theme.colors.status.danger }}>{diag.codec}</span>
                                                        </div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                            <span>감지 해상도:</span>
                                                            <span style={{ fontWeight: '800' }}>{diag.res}</span>
                                                        </div>
                                                        <div style={{ marginTop: '8px', padding: '8px', background: diag.isSafe ? theme.colors.primary.light + '44' : '#fee2e2', borderRadius: '6px', fontSize: '0.75rem', lineHeight: '1.4' }}>
                                                            {diag.isSafe
                                                                ? '이 비디오는 윈도우 플레이어 및 브라우저에서 모두 안정적으로 재생 가능한 표준 형식입니다.'
                                                                : '주의: 비표준 코덱은 장비에 따라 재생 오류를 일으킬 수 있습니다. H.264 MP4 변환 후 재업로드를 권장합니다.'}
                                                        </div>
                                                        <button
                                                            onClick={() => handleAnalyzeMedia(viewingMedia)}
                                                            disabled={viewingMedia.isAnalyzing}
                                                            style={{ marginTop: '12px', width: '100%', padding: '4px', background: 'none', border: 'none', color: theme.colors.primary.main, fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline' }}
                                                        >
                                                            {viewingMedia.isAnalyzing ? '분석 중...' : '재분석 실행'}
                                                        </button>
                                                    </div>
                                                );
                                            } catch (e) {
                                                return <p style={{ fontSize: '0.8rem' }}>{viewingMedia.verification_notes}</p>;
                                            }
                                        })()
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            <button
                                                onClick={() => handleAnalyzeMedia(viewingMedia)}
                                                disabled={viewingMedia.isAnalyzing}
                                                className="btn-secondary"
                                                style={{ width: '100%', padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                            >
                                                {viewingMedia.isAnalyzing ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
                                                플레이어 정밀 호환성 진단 실행
                                            </button>
                                            <p style={{ fontSize: '0.75rem', color: theme.colors.text.muted }}>실제 미디어 엔진을 사용하여 윈도우 플레이어 송출 가능 여부를 확인합니다.</p>
                                        </div>
                                    )}
                                </div>

                                <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', background: viewingMedia.is_verified ? theme.colors.primary.light : '#fff7ed', borderRadius: '12px', border: `1px solid ${viewingMedia.is_verified ? theme.colors.primary.border : theme.colors.status.warning}44` }}>
                                        {viewingMedia.is_verified ? <CheckCircle2 size={24} color={theme.colors.status.success} /> : <AlertCircle size={24} color={theme.colors.status.warning} />}
                                        <div>
                                            <div style={{ fontSize: '0.9rem', fontWeight: '800', color: theme.colors.text.title }}>{viewingMedia.is_verified ? '검증 통과' : '검증 대기 중'}</div>
                                            <div style={{ fontSize: '0.75rem', color: theme.colors.text.muted }}>{viewingMedia.is_verified ? '플레이어 송출이 가능한 소재입니다.' : '운영진의 최종 승인이 필요합니다.'}</div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleToggleVerify(viewingMedia)}
                                        className={viewingMedia.is_verified ? 'btn-secondary' : 'btn-primary'}
                                        style={{ padding: '16px', width: '100%' }}
                                    >
                                        {viewingMedia.is_verified ? '검증 취소' : '최종 검증 완료'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast System */}
            <div style={{
                position: 'fixed', bottom: '32px', right: '32px', zIndex: 9999,
                display: 'flex', flexDirection: 'column', gap: '12px', width: '360px'
            }}>
                {toasts.map(t => (
                    <div key={t.id} style={{
                        background: 'white', padding: '16px 20px', borderRadius: '16px',
                        boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
                        display: 'flex', alignItems: 'center', gap: '14px', borderLeft: `6px solid ${t.type === 'success' ? theme.colors.status.success :
                            t.type === 'error' ? theme.colors.status.danger :
                                t.type === 'warning' ? theme.colors.status.warning : theme.colors.primary.main
                            }`,
                        animation: 'slideIn 0.3s ease-out'
                    }}>
                        <div style={{
                            color:
                                t.type === 'success' ? theme.colors.status.success :
                                    t.type === 'error' ? theme.colors.status.danger :
                                        t.type === 'warning' ? theme.colors.status.warning : theme.colors.primary.main
                        }}>
                            {t.type === 'success' ? <CheckCircle2 size={24} /> :
                                t.type === 'error' ? <AlertCircle size={24} /> :
                                    t.type === 'warning' ? <Info size={24} /> : <ImageIcon size={24} />}
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.9rem', fontWeight: '800', color: theme.colors.text.title }}>
                                {t.type === 'success' ? '성공' : t.type === 'error' ? '오류' : t.type === 'warning' ? '주의' : '안내'}
                            </div>
                            <div style={{ fontSize: '0.85rem', color: theme.colors.text.body, marginTop: '2px', lineHeight: 1.4 }}>{t.message}</div>
                        </div>
                    </div>
                ))}
            </div>

            <style jsx>{`
                .modal-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(8px);
                    display: flex; align-items: center; justify-content: center; z-index: 1000;
                    animation: fadeIn 0.2s ease-out;
                }
                .modal-content {
                    background: white; width: 90%; border-radius: 24px;
                    padding: 40px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                    position: relative; animation: slideUp 0.3s ease-out;
                }
                .btn-icon {
                    width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
                    border: none; border-radius: 12px; cursor: pointer; transition: all 0.2s;
                }
                .btn-primary { background: ${theme.colors.primary.main}; color: white; border: none; borderRadius: 12px; fontWeight: 900; cursor: pointer; transition: all 0.2s; }
                .btn-primary:hover { background: ${theme.colors.primary.hover}; transform: translateY(-1px); }
                .btn-primary:disabled { background: ${theme.colors.text.muted}; cursor: not-allowed; transform: none; }
                
                .btn-secondary { background: white; color: ${theme.colors.text.body}; border: 1px solid ${theme.colors.border}; borderRadius: 12px; fontWeight: 700; cursor: pointer; transition: all 0.2s; }
                .btn-secondary:hover { background: ${theme.colors.divider}; border-color: ${theme.colors.divider}; }
                
                .btn-icon-s { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 10px; border: none; cursor: pointer; transition: all 0.2s; }
                .btn-icon-s:hover { opacity: 0.8; transform: scale(1.05); }

                .input-group { display: flex; flex-direction: column; gap: 8px; }
                .input-group label { font-size: 0.85rem; font-weight: 800; color: ${theme.colors.text.body}; }
                .input-group input, .input-group select { padding: 12px; borderRadius: 10px; border: 1px solid ${theme.colors.border}; outline: none; transition: border-color 0.2s; }
                .input-group input:focus { border-color: ${theme.colors.primary.main}; }
                
                .upload-dropzone:hover { border-color: ${theme.colors.primary.main} !important; background: ${theme.colors.primary.light} !important; }
                
                .table-row:hover { background-color: ${theme.colors.background} !important; }
                
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                .animate-spin { animation: spin 1s linear infinite; }
                
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }

                .media-thumb:hover .thumb-overlay {
                    opacity: 1;
                }
                .thumb-overlay {
                    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0, 0, 0, 0.4); display: flex; align-items: center;
                    justify-content: center; opacity: 0; transition: opacity 0.2s;
                }
                .media-thumb:hover {
                    transform: scale(1.05);
                }
            `}</style>
        </main>
    );
}
