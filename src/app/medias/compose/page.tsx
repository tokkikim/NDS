'use client';

import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { supabase } from '@/lib/supabase';
import {
    ArrowLeft, Play, Pause, SkipBack, SkipForward,
    Trash2, Plus, Move, Scaling, Info, CheckCircle2,
    Settings, Video, Square, Layout, Upload, Loader2, Monitor,
    Clock, Scissors, ChevronRight, ChevronDown, MousePointer2,
    Hand, Type, Eraser, Search, ZoomIn, Eye, EyeOff, Lock, Unlock,
    X, Check, Download, Layers as LayersIcon
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useUpload } from '@/contexts/UploadContext';

const adobeTheme = {
    bgDark: '#0a0a0a', bgPanel: '#1a1a1a', bgHeader: '#2a2a2a',
    bgTrack: '#232323', accent: '#1473e6', textTitle: '#e0e0e0',
    textMain: '#b0b0b0', border: '#323232', playhead: '#628cff',
};

// --- Types ---
interface Layer {
    id: string;
    media_id?: string;
    localFile?: File;
    localPreviewUrl?: string;
    title: string;
    format: string;
    x: number;
    y: number;
    width: number;
    height: number;
    originalWidth: number;
    originalHeight: number;
    aspectRatio: number;
    z_index: number;
    startTime: number;
    duration: number;
    isVisible: boolean;
    isLocked: boolean;
}

interface ExportSettings {
    resolution: '1080p' | '4K' | '720p' | 'Custom';
    customWidth: number;
    customHeight: number;
    codec: 'libx264' | 'libx265' | 'libvpx-vp9';
    bitrate: string;
    fps: number;
}

interface CanvasSettings {
    width: number;
    height: number;
    zoom: number;
    totalDuration: number;
}

// --- Snapping Helper ---
const SNAP_THRESHOLD = 10; // Pixels or seconds-equivalent

function ComposerContent() {
    const searchParams = useSearchParams();
    const mediaId = searchParams.get('mediaId');
    const { startUpload } = useUpload();

    // States
    const [projectMedias, setProjectMedias] = useState<any[]>([]); // Project Project Library (Session only)
    const [layers, setLayers] = useState<Layer[]>([]);
    const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
    const [canvas, setCanvas] = useState<CanvasSettings>({ width: 1920, height: 1080, zoom: 0.35, totalDuration: 30 });
    const [isRendering, setIsRendering] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);
    const [compositionTitle, setCompositionTitle] = useState('무제 프로젝트_01');
    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [activeTool, setActiveTool] = useState<'selection' | 'razor' | 'hand'>('selection');

    const [exportSettings, setExportSettings] = useState<ExportSettings>({
        resolution: '1080p', customWidth: 1920, customHeight: 1080,
        codec: 'libx264', bitrate: '8000k', fps: 30
    });

    // Interaction States
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dragType, setDragType] = useState<'move' | 'trim-start' | 'trim-end' | 'canvas-move' | 'canvas-resize' | 'scrub-x' | 'scrub-y' | 'scrub-w' | 'scrub-h' | null>(null);
    const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0, startTime: 0, duration: 0, layerX: 0, layerY: 0, layerW: 0, layerH: 0 });

    const fileInputRef = useRef<HTMLInputElement>(null);
    const requestRef = useRef<number | null>(null);
    const timelineRef = useRef<HTMLDivElement>(null);
    const canvasContainerRef = useRef<HTMLDivElement>(null);
    const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
    const lastTickRef = useRef<number>(0);

    const pxPerSec = 20;

    // --- Helper Logic ---
    const getClampedTime = (time: number) => Math.max(0, Math.min(canvas.totalDuration, time));

    const removeLayer = (id: string) => {
        setLayers(prev => prev.filter(l => l.id !== id));
        if (selectedLayerId === id) setSelectedLayerId(null);
        if (videoRefs.current[id]) delete videoRefs.current[id];
    };

    const addLocalFile = (file: File) => {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.onloadedmetadata = () => {
            const aspect = video.videoWidth / video.videoHeight;
            const newMedia = {
                id: `media-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                localFile: file,
                localPreviewUrl: url,
                title: file.name,
                format: file.name.split('.').pop() || 'mp4',
                width: video.videoWidth,
                height: video.videoHeight,
                aspectRatio: aspect,
                duration: video.duration
            };
            setProjectMedias(prev => [...prev, newMedia]);
            // Automatically add to canvas
            addMediaAsLayer(newMedia);
        };
        video.src = url;
    };

    const addMediaAsLayer = (media: any) => {
        const newLayer: Layer = {
            id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            media_id: media.id,
            localFile: media.localFile,
            localPreviewUrl: media.localPreviewUrl,
            title: media.title,
            format: media.format,
            originalWidth: media.width,
            originalHeight: media.height,
            aspectRatio: media.aspectRatio,
            // default to fit height or width maintaining aspect
            width: media.width > 960 ? 960 : media.width,
            height: (media.width > 960 ? 960 : media.width) / media.aspectRatio,
            x: 0, y: 0,
            z_index: layers.length,
            startTime: currentTime,
            duration: media.duration || 10,
            isVisible: true,
            isLocked: false
        };
        setLayers(prev => [...prev, newLayer]);
        setSelectedLayerId(newLayer.id);
    };

    // --- Core Sync Engine ---
    const tick = useCallback((timestamp: number) => {
        if (!lastTickRef.current) lastTickRef.current = timestamp;
        const delta = (timestamp - lastTickRef.current) / 1000;
        lastTickRef.current = timestamp;

        if (isPlaying) {
            setCurrentTime(prev => {
                const nextTime = prev + delta;
                if (nextTime >= canvas.totalDuration) {
                    setIsPlaying(false);
                    return canvas.totalDuration;
                }
                return nextTime;
            });
            requestRef.current = requestAnimationFrame(tick);
        }
    }, [isPlaying, canvas.totalDuration]);

    useEffect(() => {
        if (isPlaying) {
            lastTickRef.current = 0;
            requestRef.current = requestAnimationFrame(tick);
        } else {
            if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
        }
        return () => { if (requestRef.current !== null) cancelAnimationFrame(requestRef.current); };
    }, [isPlaying, tick]);

    useEffect(() => {
        layers.forEach(layer => {
            const video = videoRefs.current[layer.id];
            if (video) {
                const relativeTime = currentTime - layer.startTime;
                if (relativeTime >= 0 && relativeTime <= layer.duration) {
                    if (Math.abs(video.currentTime - relativeTime) > 0.15) video.currentTime = relativeTime;
                    if (isPlaying && video.paused) video.play().catch(() => { });
                    else if (!isPlaying && !video.paused) video.pause();
                } else {
                    if (!video.paused) video.pause();
                }
            }
        });
    }, [currentTime, isPlaying, layers]);

    // --- Magnet & Snapping Logic ---
    const getSnappedTime = (time: number, excludeId?: string) => {
        const snapPoints = [0, canvas.totalDuration];
        layers.forEach(l => {
            if (l.id !== excludeId) {
                snapPoints.push(l.startTime);
                snapPoints.push(l.startTime + l.duration);
            }
        });

        for (const pt of snapPoints) {
            if (Math.abs(time - pt) < (SNAP_THRESHOLD / pxPerSec)) return pt;
        }
        return time;
    };

    const getSnappedPos = (x: number, y: number, w: number, h: number, excludeId: string) => {
        const snapX = [0, canvas.width, canvas.width / 2];
        const snapY = [0, canvas.height, canvas.height / 2];

        layers.forEach(l => {
            if (l.id !== excludeId) {
                snapX.push(l.x, l.x + l.width);
                snapY.push(l.y, l.y + l.height);
            }
        });

        let finalX = x;
        let finalY = y;

        for (const sx of snapX) {
            if (Math.abs(x - sx) < SNAP_THRESHOLD / canvas.zoom) { finalX = sx; break; }
            if (Math.abs((x + w) - sx) < SNAP_THRESHOLD / canvas.zoom) { finalX = sx - w; break; }
        }
        for (const sy of snapY) {
            if (Math.abs(y - sy) < SNAP_THRESHOLD / canvas.zoom) { finalY = sy; break; }
            if (Math.abs((y + h) - sy) < SNAP_THRESHOLD / canvas.zoom) { finalY = sy - h; break; }
        }

        return { x: finalX, y: finalY };
    };

    // --- Drag Interaction Handlers ---
    const startDraggingTimeline = (e: React.MouseEvent, id: string, type: 'move' | 'trim-start' | 'trim-end') => {
        e.stopPropagation();
        const layer = layers.find(l => l.id === id);
        if (!layer) return;
        setDraggingId(id);
        setDragType(type);
        setDragStartPos({ x: e.clientX, y: e.clientY, startTime: layer.startTime, duration: layer.duration, layerX: 0, layerY: 0 });
        setSelectedLayerId(id);
    };

    const startDraggingCanvas = (e: React.MouseEvent, id: string, type: 'canvas-move' | 'canvas-resize' = 'canvas-move') => {
        e.stopPropagation();
        const layer = layers.find(l => l.id === id);
        if (!layer) return;
        setDraggingId(id);
        setDragType(type);
        setDragStartPos({
            x: e.clientX, y: e.clientY, startTime: 0, duration: 0,
            layerX: layer.x, layerY: layer.y, layerW: layer.width, layerH: layer.height
        });
        setSelectedLayerId(id);
    };

    const startScrubbing = (e: React.MouseEvent, id: string, type: 'scrub-x' | 'scrub-y' | 'scrub-w' | 'scrub-h') => {
        e.stopPropagation();
        const layer = layers.find(l => l.id === id);
        if (!layer) return;
        setDraggingId(id);
        setDragType(type);
        setDragStartPos({
            x: e.clientX, y: e.clientY, startTime: 0, duration: 0,
            layerX: layer.x, layerY: layer.y, layerW: layer.width, layerH: layer.height
        });
        setSelectedLayerId(id);
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!draggingId || !dragType) return;

            const dx = (e.clientX - dragStartPos.x);
            const dy = (e.clientY - dragStartPos.y);

            setLayers(prev => prev.map(l => {
                if (l.id !== draggingId) return l;

                if (dragType === 'move') {
                    const newTime = getSnappedTime(dragStartPos.startTime + (dx / pxPerSec), draggingId);
                    return { ...l, startTime: Math.max(0, newTime) };
                } else if (dragType === 'trim-start') {
                    const newStart = Math.max(0, dragStartPos.startTime + (dx / pxPerSec));
                    const newDuration = Math.max(0.1, dragStartPos.duration - (newStart - dragStartPos.startTime));
                    return { ...l, startTime: newStart, duration: newDuration };
                } else if (dragType === 'trim-end') {
                    return { ...l, duration: Math.max(0.1, dragStartPos.duration + (dx / pxPerSec)) };
                } else if (dragType === 'canvas-move') {
                    const rawX = dragStartPos.layerX + (dx / canvas.zoom);
                    const rawY = dragStartPos.layerY + (dy / canvas.zoom);
                    const snapped = getSnappedPos(rawX, rawY, l.width, l.height, draggingId);
                    return { ...l, x: snapped.x, y: snapped.y };
                } else if (dragType === 'canvas-resize') {
                    const newW = Math.max(10, dragStartPos.layerW + (dx / canvas.zoom));
                    const newH = newW / l.aspectRatio; // Keep aspect ratio during resize
                    return { ...l, width: newW, height: newH };
                } else if (dragType === 'scrub-x') {
                    return { ...l, x: dragStartPos.layerX + dx };
                } else if (dragType === 'scrub-y') {
                    return { ...l, y: dragStartPos.layerY + dx };
                } else if (dragType === 'scrub-w') {
                    const newW = Math.max(10, dragStartPos.layerW + dx);
                    return { ...l, width: newW, height: newW / l.aspectRatio };
                } else if (dragType === 'scrub-h') {
                    const newH = Math.max(10, dragStartPos.layerH + dx);
                    return { ...l, height: newH, width: newH * l.aspectRatio };
                }
                return l;
            }));
        };

        const handleMouseUp = () => {
            setDraggingId(null);
            setDragType(null);
        };

        if (draggingId) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [draggingId, dragType, dragStartPos, canvas.zoom, canvas.width, canvas.height]);

    // --- Export Logic ---
    const handleExport = async () => {
        setShowExportModal(false);
        setIsRendering(true);
        try {
            // 1. Upload local files first
            const finalCompoLayers = [];
            for (const layer of layers) {
                let mediaId = layer.media_id;
                if (layer.localFile) {
                    const { data } = await supabase.from('medias').insert({
                        title: layer.title, file_url: 'PENDING_UPLOAD', format: layer.format, is_verified: false
                    }).select().single();
                    if (data) {
                        mediaId = data.id;
                        await startUpload({ mediaId: data.id, file: layer.localFile, title: layer.title });
                    }
                }
                finalCompoLayers.push({
                    media_id: mediaId,
                    x: Math.round(layer.x), y: Math.round(layer.y),
                    width: Math.round(layer.width), height: Math.round(layer.height),
                    start_time: layer.startTime, duration: layer.duration, z_index: layer.z_index
                });
            }

            // 2. Submit composition to Cloud Run via Supabase or Edge Function
            // (Placeholder for production)
            console.log('Exporting with settings:', exportSettings, 'Layers:', finalCompoLayers);

            setTimeout(() => {
                alert('인코딩 서버에 작업이 성공적으로 등록되었습니다.');
                window.location.href = '/medias';
            }, 2000);
        } catch (e) {
            console.error(e);
            alert('내보내기 중 오류가 발생했습니다.');
        } finally {
            setIsRendering(false);
        }
    };

    // --- UI Handlers ---
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (document.activeElement instanceof HTMLInputElement) return;
        switch (e.key.toLowerCase()) {
            case ' ': e.preventDefault(); setIsPlaying(p => !p); break;
            case 'v': setActiveTool('selection'); break;
            case 'c': setActiveTool('razor'); break;
            case 'arrowleft': setCurrentTime(p => getClampedTime(p - 1 / 30)); break;
            case 'arrowright': setCurrentTime(p => getClampedTime(p + 1 / 30)); break;
            case 'delete': case 'backspace': if (selectedLayerId) removeLayer(selectedLayerId); break;
        }
    }, [selectedLayerId, canvas.totalDuration]);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    const handleTimelineClick = (e: React.MouseEvent) => {
        if (!timelineRef.current || draggingId) return;
        const rect = timelineRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
        setCurrentTime(Math.max(0, Math.min(canvas.totalDuration, x / pxPerSec)));
    };

    const selectedLayer = layers.find(l => l.id === selectedLayerId);
    const activeLayers = layers.filter(l => l.isVisible && currentTime >= l.startTime && currentTime <= l.startTime + l.duration);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: adobeTheme.bgDark, color: adobeTheme.textMain, overflow: 'hidden', userSelect: 'none' }}>
            {/* Premiere Top Bar */}
            <header style={{ height: '32px', background: adobeTheme.bgHeader, borderBottom: `1px solid ${adobeTheme.border}`, display: 'flex', alignItems: 'center', padding: '0 12px', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <div style={{ color: '#00ccff', fontWeight: '900', fontSize: '0.9rem' }}>Pr</div>
                    <div style={{ display: 'flex', gap: '15px', color: '#ccc' }}>
                        <span>파일</span><span>편집</span><span>클립</span><span>시퀀스</span><span>윈도우</span><span>도움말</span>
                    </div>
                </div>
                <div style={{ color: '#888' }}>{compositionTitle} - Adobe Premiere Pro Pro</div>
            </header>

            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* Tools */}
                <aside style={{ width: '36px', background: adobeTheme.bgPanel, borderRight: `1px solid ${adobeTheme.border}`, display: 'flex', flexDirection: 'column', padding: '10px 0', gap: '4px', alignItems: 'center' }}>
                    <button onClick={() => setActiveTool('selection')} title="선택 도구 (V)" style={{ background: activeTool === 'selection' ? '#444' : 'transparent', border: 'none', color: activeTool === 'selection' ? '#00ccff' : '#ccc', padding: '8px', cursor: 'pointer' }}><MousePointer2 size={16} /></button>
                    <button onClick={() => setActiveTool('razor')} title="자르기 도구 (C)" style={{ background: activeTool === 'razor' ? '#444' : 'transparent', border: 'none', color: activeTool === 'razor' ? '#00ccff' : '#ccc', padding: '8px', cursor: 'pointer' }}><Scissors size={16} /></button>
                </aside>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', height: '60%', borderBottom: `2px solid #000` }}>

                        {/* Project History / Media Bin */}
                        <section
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                                e.preventDefault();
                                if (e.dataTransfer.files) Array.from(e.dataTransfer.files).forEach(addLocalFile);
                            }}
                            style={{ width: '300px', background: adobeTheme.bgPanel, borderRight: `1px solid ${adobeTheme.border}`, display: 'flex', flexDirection: 'column' }}
                        >
                            <div style={{ padding: '8px 12px', background: '#252525', fontSize: '0.65rem', fontWeight: 'bold', color: '#aaa', borderBottom: `1px solid ${adobeTheme.border}`, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <LayersIcon size={12} /> 프로젝트 미디어 ({projectMedias.length})
                            </div>
                            <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                                <div onClick={() => fileInputRef.current?.click()} style={{ border: `1px dashed #444`, padding: '20px', borderRadius: '4px', textAlign: 'center', marginBottom: '15px', cursor: 'pointer', fontSize: '0.7rem', color: '#666' }}>
                                    <Plus size={16} /><br />여기에 파일 드래그 또는 클릭
                                    <input type="file" ref={fileInputRef} onChange={(e) => { if (e.target.files) Array.from(e.target.files).forEach(addLocalFile); }} multiple hidden />
                                </div>
                                {projectMedias.map(m => (
                                    <div key={m.id} onDoubleClick={() => addMediaAsLayer(m)} style={{ display: 'flex', gap: '10px', padding: '8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem' }} className="media-item">
                                        <div style={{ width: '50px', height: '30px', background: '#333', borderRadius: '2px', position: 'relative', overflow: 'hidden' }}>
                                            {m.localPreviewUrl && <video src={m.localPreviewUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                                        </div>
                                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            <div style={{ color: '#eee' }}>{m.title}</div>
                                            <div style={{ color: '#555', fontSize: '0.6rem' }}>{m.width}x{m.height} | {m.duration.toFixed(1)}s</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        {/* Monitor */}
                        <section style={{ flex: 1, background: '#000', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                            <div style={{ padding: '6px 16px', background: '#1a1a1a', fontSize: '0.65rem', borderBottom: `1px solid ${adobeTheme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>프로그램: Sequence 01 ({canvas.width} x {canvas.height})</span>
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.7rem' }}>줌: </span>
                                    <select value={canvas.zoom} onChange={e => setCanvas({ ...canvas, zoom: parseFloat(e.target.value) })} style={{ background: 'transparent', border: 'none', color: '#00ccff', outline: 'none' }}>
                                        <option value="0.1">10%</option>
                                        <option value="0.25">25%</option>
                                        <option value="0.35">35%</option>
                                        <option value="0.5">50%</option>
                                        <option value="0.75">75%</option>
                                        <option value="1">100%</option>
                                    </select>
                                    <div style={{ width: '1px', height: '12px', background: '#333' }} />
                                    <span style={{ color: '#00ccff', fontSize: '0.9rem', fontWeight: 'bold', fontFamily: 'monospace' }}>
                                        {Math.floor(currentTime / 60).toString().padStart(2, '0')}:{(Math.floor(currentTime % 60)).toString().padStart(2, '0')}:{Math.floor((currentTime % 1) * 30).toString().padStart(2, '0')}
                                    </span>
                                </div>
                            </div>
                            <div ref={canvasContainerRef} style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                {/* Canvas Viewport */}
                                <div style={{
                                    width: canvas.width * canvas.zoom, height: canvas.height * canvas.zoom,
                                    background: '#000', position: 'relative', boxShadow: '0 0 100px rgba(0,0,0,0.5)',
                                }}>
                                    {activeLayers.map(layer => (
                                        <div
                                            key={layer.id}
                                            onMouseDown={(e) => startDraggingCanvas(e, layer.id)}
                                            style={{
                                                position: 'absolute',
                                                left: layer.x * canvas.zoom, top: layer.y * canvas.zoom,
                                                width: layer.width * canvas.zoom, height: layer.height * canvas.zoom,
                                                border: selectedLayerId === layer.id ? `1px solid #00ccff` : 'none',
                                                zIndex: layer.z_index,
                                                cursor: activeTool === 'selection' ? 'move' : 'default'
                                            }}
                                        >
                                            {layer.localPreviewUrl && (
                                                <video
                                                    ref={el => { videoRefs.current[layer.id] = el; }}
                                                    src={layer.localPreviewUrl}
                                                    style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                                                    muted playsInline
                                                />
                                            )}
                                            {/* Resize Handle */}
                                            {selectedLayerId === layer.id && (
                                                <div
                                                    onMouseDown={(e) => startDraggingCanvas(e, layer.id, 'canvas-resize')}
                                                    style={{ position: 'absolute', right: -4, bottom: -4, width: 10, height: 10, background: '#00ccff', cursor: 'nwse-resize', borderRadius: '2px', zIndex: 100 }}
                                                />
                                            )}
                                        </div>
                                    ))}
                                    {/* Snap Guides (WIP Visualization) */}
                                </div>
                            </div>
                            {/* Controls */}
                            <div style={{ height: '40px', background: '#1a1a1a', borderTop: `1px solid ${adobeTheme.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '24px' }}>
                                <SkipBack size={16} onClick={() => setCurrentTime(0)} style={{ cursor: 'pointer' }} />
                                {isPlaying ? <Pause size={22} fill="white" onClick={() => setIsPlaying(false)} /> : <Play size={22} fill="white" onClick={() => setIsPlaying(true)} />}
                                <SkipForward size={16} onClick={() => setCurrentTime(canvas.totalDuration)} />
                            </div>
                        </section>

                        {/* Inspector */}
                        <section style={{ width: '320px', background: adobeTheme.bgPanel, borderLeft: `1px solid ${adobeTheme.border}`, display: 'flex', flexDirection: 'column' }}>
                            <div style={{ padding: '8px 16px', background: '#252525', fontSize: '0.65rem', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>
                                <span>효과 컨트롤</span>
                                <Settings size={12} />
                            </div>
                            <div style={{ flex: 1, padding: '20px', fontSize: '0.75rem', overflowY: 'auto' }}>
                                {selectedLayer ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                        <div style={{ fontWeight: 'bold', color: 'white', marginBottom: '5px' }}>{selectedLayer.title}</div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div style={{ color: '#888' }}>비디오 변형</div>
                                                <button onClick={() => removeLayer(selectedLayer.id)} style={{ background: 'transparent', border: 'none', color: '#ff4d4d', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.65rem' }}>
                                                    <Trash2 size={12} /> 삭제
                                                </button>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginLeft: '10px' }}>
                                                <span>위치 (X, Y)</span>
                                                <div style={{ display: 'flex', gap: '12px', color: '#00ccff' }}>
                                                    <span onMouseDown={(e) => startScrubbing(e, selectedLayer.id, 'scrub-x')} style={{ cursor: 'ew-resize', borderBottom: '1px dotted #00ccff' }}>{Math.round(selectedLayer.x)}</span>
                                                    <span onMouseDown={(e) => startScrubbing(e, selectedLayer.id, 'scrub-y')} style={{ cursor: 'ew-resize', borderBottom: '1px dotted #00ccff' }}>{Math.round(selectedLayer.y)}</span>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginLeft: '10px' }}>
                                                <span>비율 (W, H)</span>
                                                <div style={{ display: 'flex', gap: '12px', color: '#00ccff' }}>
                                                    <span onMouseDown={(e) => startScrubbing(e, selectedLayer.id, 'scrub-w')} style={{ cursor: 'ew-resize', borderBottom: '1px dotted #00ccff' }}>{Math.round(selectedLayer.width)}</span>
                                                    <span onMouseDown={(e) => startScrubbing(e, selectedLayer.id, 'scrub-h')} style={{ cursor: 'ew-resize', borderBottom: '1px dotted #00ccff' }}>{Math.round(selectedLayer.height)}</span>
                                                </div>
                                            </div>
                                            <div style={{ fontSize: '0.65rem', color: '#555', marginLeft: '10px' }}>원본: {selectedLayer.originalWidth}x{selectedLayer.originalHeight}</div>
                                        </div>

                                        <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            <div style={{ color: '#888' }}>시간 설정</div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginLeft: '10px' }}>
                                                <span>시작점</span>
                                                <span style={{ color: '#00ccff' }}>{selectedLayer.startTime.toFixed(2)}s</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginLeft: '10px' }}>
                                                <span>지속 시간</span>
                                                <span style={{ color: '#00ccff' }}>{selectedLayer.duration.toFixed(2)}s</span>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444' }}>클립을 선택하여 속성을 편집하세요.</div>
                                )}
                            </div>
                            <button
                                onClick={() => setShowExportModal(true)}
                                style={{ margin: '16px', padding: '12px', background: adobeTheme.accent, border: 'none', color: 'white', fontWeight: 'bold', cursor: 'pointer', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                            >
                                <Download size={16} /> 내보내기 설정
                            </button>
                        </section>
                    </div>

                    {/* Timeline */}
                    <div style={{ flex: 1, background: adobeTheme.bgDark, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ height: '28px', background: '#1e1e1e', borderBottom: `1px solid ${adobeTheme.border}`, display: 'flex', alignItems: 'center', padding: '0 16px', fontSize: '0.65rem', gap: '20px' }}>
                            <div style={{ color: '#eee', fontWeight: 'bold' }}>Sequence 01</div>
                            <div style={{ display: 'flex', gap: '10px', color: '#666' }}>
                                <Clock size={12} /> 전체: {canvas.totalDuration}s
                            </div>
                        </div>
                        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                            <div style={{ width: '100px', background: '#1a1a1a', borderRight: '1px solid #333', paddingTop: '32px' }}>
                                {layers.map((_, i) => (
                                    <div key={i} style={{ height: '36px', borderBottom: '1px solid #252525', padding: '0 10px', fontSize: '0.6rem', color: '#555', display: 'flex', alignItems: 'center' }}>
                                        V{layers.length - i}
                                    </div>
                                ))}
                            </div>
                            <div ref={timelineRef} onClick={handleTimelineClick} style={{ flex: 1, position: 'relative', background: '#141414', overflowX: 'auto' }}>
                                {/* Time Ruler */}
                                <div style={{ height: '32px', background: '#1a1a1a', borderBottom: '1px solid #333', position: 'sticky', top: 0, zIndex: 10 }}>
                                    {Array.from({ length: Math.ceil(canvas.totalDuration / 5) + 1 }).map((_, i) => (
                                        <div key={i} style={{ position: 'absolute', left: i * 5 * pxPerSec, height: '100%', borderLeft: '1px solid #333', padding: '4px', fontSize: '9px', color: '#555' }}>
                                            00:{(i * 5).toString().padStart(2, '0')}:00
                                        </div>
                                    ))}
                                </div>
                                <div style={{ position: 'relative' }}>
                                    {[...layers].reverse().map((layer, i) => (
                                        <div
                                            key={layer.id}
                                            onMouseDown={(e) => startDraggingTimeline(e, layer.id, 'move')}
                                            style={{
                                                position: 'absolute', top: i * 36 + 6, left: layer.startTime * pxPerSec, width: layer.duration * pxPerSec, height: '30px',
                                                background: selectedLayerId === layer.id ? '#555' : '#4a5b7d', border: selectedLayerId === layer.id ? `1px solid ${adobeTheme.accent}` : '1px solid #2a3a5a',
                                                borderRadius: '2px', padding: '0 8px', fontSize: '0.65rem', color: 'white', display: 'flex', alignItems: 'center', zIndex: draggingId === layer.id ? 100 : 1
                                            }}
                                        >
                                            <div onMouseDown={(e) => startDraggingTimeline(e, layer.id, 'trim-start')} style={{ position: 'absolute', left: 0, width: '8px', height: '100%', cursor: 'ew-resize' }} />
                                            <div onMouseDown={(e) => startDraggingTimeline(e, layer.id, 'trim-end')} style={{ position: 'absolute', right: 0, width: '8px', height: '100%', cursor: 'ew-resize' }} />
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{layer.title}</span>
                                        </div>
                                    ))}
                                </div>
                                {/* Playhead */}
                                <div style={{ position: 'absolute', top: 0, bottom: 0, left: currentTime * pxPerSec, width: '1px', background: adobeTheme.playhead, zIndex: 30, pointerEvents: 'none' }}>
                                    <div style={{ position: 'absolute', top: 0, left: -5, width: 11, height: 11, background: adobeTheme.playhead, borderRadius: '2px 2px 0 0' }} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Export Settings Modal */}
            {
                showExportModal && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ width: '450px', background: adobeTheme.bgPanel, padding: '32px', borderRadius: '12px', border: `1px solid ${adobeTheme.border}`, boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
                                <h2 style={{ fontSize: '1.2rem', color: 'white', fontWeight: 'bold' }}>내보내기 설정(Export)</h2>
                                <X size={20} style={{ cursor: 'pointer' }} onClick={() => setShowExportModal(false)} />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', fontSize: '0.85rem' }}>
                                <div>
                                    <label style={{ color: '#888', display: 'block', marginBottom: '8px' }}>해상도</label>
                                    <select
                                        value={exportSettings.resolution}
                                        onChange={(e) => {
                                            const res = e.target.value as any;
                                            let w = 1920, h = 1080;
                                            if (res === '4K') { w = 3840; h = 2160; }
                                            else if (res === '720p') { w = 1280; h = 720; }
                                            setExportSettings({ ...exportSettings, resolution: res, customWidth: w, customHeight: h });
                                            setCanvas({ ...canvas, width: w, height: h });
                                        }}
                                        style={{ width: '100%', background: '#0a0a0a', border: '1px solid #444', color: 'white', padding: '10px', borderRadius: '4px' }}
                                    >
                                        <option value="1080p">1080p Full HD (1920x1080)</option>
                                        <option value="4K">4K Ultra HD (3840x2160)</option>
                                        <option value="720p">720p HD (1280x720)</option>
                                        <option value="Custom">사용자 지정</option>
                                    </select>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                    <div>
                                        <label style={{ color: '#888', display: 'block', marginBottom: '8px' }}>비디오 코덱</label>
                                        <select value={exportSettings.codec} onChange={e => setExportSettings({ ...exportSettings, codec: e.target.value as any })} style={{ width: '100%', background: '#0a0a0a', border: '1px solid #444', color: 'white', padding: '10px', borderRadius: '4px' }}>
                                            <option value="libx264">H.264 (AVC)</option>
                                            <option value="libx265">H.265 (HEVC)</option>
                                            <option value="libvpx-vp9">VP9 (Google)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ color: '#888', display: 'block', marginBottom: '8px' }}>프레임 레이트</label>
                                        <select value={exportSettings.fps} onChange={e => setExportSettings({ ...exportSettings, fps: parseInt(e.target.value) })} style={{ width: '100%', background: '#0a0a0a', border: '1px solid #444', color: 'white', padding: '10px', borderRadius: '4px' }}>
                                            <option value="24">24 fps (Cinema)</option>
                                            <option value="30">30 fps (Standard)</option>
                                            <option value="60">60 fps (Smooth)</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label style={{ color: '#888', display: 'block', marginBottom: '8px' }}>타겟 비트레이트 (kbps)</label>
                                    <input type="text" value={exportSettings.bitrate} onChange={e => setExportSettings({ ...exportSettings, bitrate: e.target.value })} style={{ width: '100%', background: '#0a0a0a', border: '1px solid #444', color: 'white', padding: '10px', borderRadius: '4px' }} placeholder="e.g. 8000k" />
                                </div>

                                <div style={{ marginTop: '10px', display: 'flex', gap: '12px' }}>
                                    <button onClick={handleExport} style={{ flex: 1, padding: '14px', background: '#00ccff', color: 'black', fontWeight: 'bold', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>내보내기 시작</button>
                                    <button onClick={() => setShowExportModal(false)} style={{ flex: 1, padding: '14px', background: '#333', color: 'white', fontWeight: 'bold', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>취소</button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Rendering Overlay */}
            {
                isRendering && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 11000, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '20px' }}>
                        <Loader2 className="animate-spin" size={48} color="#00ccff" />
                        <div style={{ textAlign: 'center' }}>
                            <h2 style={{ color: 'white', fontSize: '1.4rem', fontWeight: 'bold' }}>미디어 인코딩 중...</h2>
                            <p style={{ color: '#666', marginTop: '10px' }}>GCP 클라우드 서버에서 파이프라인이 작동 중입니다.<br />소재 업로드와 합성이 동시에 진행됩니다.</p>
                        </div>
                    </div>
                )
            }
        </div >
    );
}

export default function VideoComposerPage() {
    return (
        <Suspense fallback={<div style={{ background: '#0a0a0a', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>Workspace Loading...</div>}>
            <ComposerContent />
        </Suspense>
    );
}
