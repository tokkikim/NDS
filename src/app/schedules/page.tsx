'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import {
    Clock, Plus, Trash2, ArrowLeft, RefreshCw,
    Film, Save, Layers, Search,
    CheckCircle2, AlertCircle, LayoutGrid, LayoutList,
    Building2, FolderOpen, Monitor, ChevronRight, ChevronLeft, PlayCircle,
    Star, Sparkles, Tag, Image as ImageIcon
} from 'lucide-react';
import Link from 'next/link';

// Design System Tokens
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

interface Media {
    id: string;
    title: string;
    duration: number;
    format: string;
    brands?: { id: string; name: string };
    brand_id?: string;
    product_name?: string;
    ad_type?: string;
    resolution?: string;
}

interface MediaGroup {
    id: string;
    name: string;
    total_slots: number;
    plays_per_slot: number;
    slot_duration: number;
    op_start_time: string;
    op_end_time: string;
    idle_time?: number;
}

interface DeviceCategory {
    id: string;
    media_group_id: string;
    name: string;
    total_slots: number | null;
    plays_per_slot: number | null;
    slot_duration: number | null;
    op_start_time: string | null;
    op_end_time: string | null;
    idle_time?: number;
}

interface Schedule {
    id: string;
    media_id: string;
    category_id: string;
    device_id?: string;
    slot_no: number;
    medias: Media;
}

interface Device {
    id: string;
    name: string;
    category_id: string;
    resolution?: string;
}

interface Toast {
    id: number;
    message: string;
    type: 'success' | 'error' | 'info';
}

export default function ManagementPage() {
    const [mediaGroups, setMediaGroups] = useState<MediaGroup[]>([]);
    const [categories, setCategories] = useState<DeviceCategory[]>([]);
    const [devices, setDevices] = useState<Device[]>([]);
    const [medias, setMedias] = useState<Media[]>([]);
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [loading, setLoading] = useState(false);

    // UI State
    const [isAssigning, setIsAssigning] = useState<{ slotNo: number; categoryId: string; deviceId?: string } | null>(null);
    const [assignmentCount, setAssignmentCount] = useState(1);
    const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
    const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]); // device ids
    const [selectedCellKeys, setSelectedCellKeys] = useState<string[]>([]); // "deviceId:slotNo"
    const [toasts, setToasts] = useState<Toast[]>([]);

    const tableContainerRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3000);
    };

    const fetchData = async () => {
        setLoading(true);
        const { data: mg } = await supabase.from('media_groups').select('*').order('name');
        if (mg) setMediaGroups(mg);

        const { data: ct } = await supabase.from('device_categories').select('*').order('name');
        if (ct) setCategories(ct);

        const { data: md } = await supabase.from('medias').select('*, brands(id, name)');
        if (md) setMedias(md as any);

        const { data: sc } = await supabase
            .from('schedules')
            .select('*, medias(*, brands(id, name))');
        if (sc) setSchedules(sc as any);

        const { data: dv } = await supabase.from('devices').select('id, name, category_id, resolution');
        if (dv) setDevices(dv);

        setLoading(false);
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleAssignMedia = async (overrideTargets?: { deviceId: string; slotNo: number }[]) => {
        if (selectedMediaIds.length === 0) {
            showToast('먼저 편성할 소재를 선택해주세요.', 'error');
            return;
        }

        setLoading(true);
        const newAssignments: any[] = [];

        // 1. Direct cell selection or override
        if (overrideTargets || selectedCellKeys.length > 0) {
            const targets = overrideTargets || selectedCellKeys.map(key => {
                const [dId, sNo] = key.split(':');
                return { deviceId: dId, slotNo: parseInt(sNo) };
            });

            for (const { deviceId, slotNo } of targets) {
                const device = devices.find(d => d.id === deviceId);
                if (!device) continue;

                const cat = categories.find(c => c.id === device.category_id);
                const mediaGroup = mediaGroups.find(g => g.id === cat?.media_group_id);

                // 해상도 정합성 검증 (기기 기준)
                for (const mId of selectedMediaIds) {
                    const media = medias.find(m => m.id === mId);
                    if (media && device && media.resolution && device.resolution && media.resolution !== device.resolution) {
                        showToast(`해상도 불일치: '${media.product_name || media.title}'(${media.resolution})는 기기 '${device.name}'(${device.resolution})에 편성할 수 없습니다.`, 'error');
                        setLoading(false);
                        return;
                    }
                    newAssignments.push({
                        media_id: mId,
                        category_id: device.category_id,
                        device_id: deviceId,
                        slot_no: slotNo
                    });
                }
            }
        }
        // 2. Individual cell "Assign" button
        else if (isAssigning) {
            const device = devices.find(d => d.id === isAssigning.deviceId);
            if (device) {
                // 해상도 정합성 검증 (개별 할당 시)
                for (const mId of selectedMediaIds) {
                    const media = medias.find(m => m.id === mId);
                    if (media && media.resolution && device.resolution && media.resolution !== device.resolution) {
                        showToast(`해상도 불일치: '${media.product_name || media.title}'(${media.resolution})는 기기 '${device.name}'(${device.resolution})에 편성할 수 없습니다.`, 'error');
                        setLoading(false);
                        return;
                    }
                }

                const existingInSlot = schedules.filter(s => s.device_id === device.id && s.slot_no === isAssigning.slotNo);
                const existingMediaIds = new Set(existingInSlot.map(s => s.media_id));

                for (const mediaId of selectedMediaIds) {
                    if (existingMediaIds.has(mediaId)) continue;
                    newAssignments.push({
                        media_id: mediaId,
                        category_id: isAssigning.categoryId,
                        device_id: device.id,
                        slot_no: isAssigning.slotNo
                    });
                }
            }
        }
        // 3. Bulk device selection (Auto-fill)
        else if (selectedTargetIds.length > 0) {
            for (const deviceId of selectedTargetIds) {
                const device = devices.find(d => d.id === deviceId);
                if (!device) continue;

                const catId = device.category_id;
                const category = categories.find(c => c.id === catId);
                const mediaGroup = mediaGroups.find(g => g.id === category?.media_group_id);
                const totalSlots = category?.total_slots ?? mediaGroup?.total_slots ?? 10;

                // 해상도 정합성 검증 (기기 기준)
                for (const mId of selectedMediaIds) {
                    const media = medias.find(m => m.id === mId);
                    if (media && device && media.resolution && device.resolution && media.resolution !== device.resolution) {
                        showToast(`해상도 불일치: '${media.product_name || media.title}'(${media.resolution})는 기기 '${device.name}'(${device.resolution})에 편성할 수 없습니다.`, 'error');
                        setLoading(false);
                        return;
                    }
                }

                const deviceSchedules = schedules.filter(s => s.device_id === deviceId);
                const usedSlotNos = new Set(deviceSchedules.map(s => s.slot_no));

                const availableSlots = [];
                for (let i = 1; i <= totalSlots; i++) {
                    if (!usedSlotNos.has(i)) availableSlots.push(i);
                }

                const slotsToFill = Math.min(assignmentCount, availableSlots.length);
                for (let i = 0; i < slotsToFill; i++) {
                    const mediaId = selectedMediaIds[i % selectedMediaIds.length];
                    newAssignments.push({
                        media_id: mediaId,
                        category_id: catId,
                        device_id: deviceId,
                        slot_no: availableSlots[i]
                    });
                }
            }
        }

        if (newAssignments.length > 0) {
            const { error } = await supabase.from('schedules').insert(newAssignments);
            if (error) showToast(error.message, 'error');
            else showToast(`${newAssignments.length}개의 편성이 완료되었습니다.`, 'success');
        } else {
            showToast('편성할 수 있는 잔여 구좌가 없거나 이미 모든 소재가 편성되어 있습니다.', 'info');
        }

        setIsAssigning(null);
        setSelectedMediaIds([]);
        setSelectedTargetIds([]);
        setSelectedCellKeys([]);
        setAssignmentCount(1);
        fetchData();
    };

    const handleRemoveAssignment = async (id: string) => {
        if (!confirm('편성을 취소하시겠습니까?')) return;
        const { error } = await supabase.from('schedules').delete().eq('id', id);
        if (!error) fetchData();
    };

    const handleBulkRemoveAssignments = async () => {
        if (selectedMediaIds.length === 0) {
            showToast('먼저 제외할 소재를 도구함에서 선택해주세요.', 'error');
            return;
        }

        if (selectedCellKeys.length === 0 && selectedTargetIds.length === 0) {
            showToast('편성을 제외할 대상 구좌나 기기를 선택해주세요.', 'error');
            return;
        }

        if (!confirm(`선택한 ${selectedMediaIds.length}개의 소재를 지정된 구좌에서 제외하시겠습니까?`)) return;

        setLoading(true);
        try {
            if (selectedCellKeys.length > 0) {
                // Loop through selected cells and remove selected media
                for (const key of selectedCellKeys) {
                    const [deviceId, slotNo] = key.split(':');
                    await supabase
                        .from('schedules')
                        .delete()
                        .eq('device_id', deviceId)
                        .eq('slot_no', parseInt(slotNo))
                        .in('media_id', selectedMediaIds);
                }
            } else if (selectedTargetIds.length > 0) {
                // Remove selected media from selected devices
                await supabase
                    .from('schedules')
                    .delete()
                    .in('device_id', selectedTargetIds)
                    .in('media_id', selectedMediaIds);
            }

            showToast('선택한 소재들이 일괄 제외되었습니다.', 'success');
            fetchData();
        } catch (error: any) {
            console.error('Bulk removal error:', error);
            showToast('일괄 제외 중 오류가 발생했습니다.', 'error');
        } finally {
            setLoading(false);
            setSelectedCellKeys([]);
            setSelectedTargetIds([]);
            setSelectedMediaIds([]);
        }
    };

    const getDeviceSlots = (deviceId: string, categoryId: string) => {
        const category = categories.find(c => c.id === categoryId);
        const mediaGroup = mediaGroups.find(g => g.id === category?.media_group_id);
        const total = category?.total_slots ?? mediaGroup?.total_slots ?? 10;
        const assigned = schedules.filter(s => s.device_id === deviceId);

        const slots = [];
        for (let i = 1; i <= total; i++) {
            slots.push({
                no: i,
                medias: assigned.filter(as => as.slot_no === i)
            });
        }
        return slots;
    };

    const getUnifiedBrandInSlot = (slotNo: number, deviceIds: string[]) => {
        if (deviceIds.length === 0) return null;

        let commonBrandId: string | null = null;
        let commonBrandName: string | null = null;

        for (const deviceId of deviceIds) {
            const deviceSchedules = schedules.filter(s => s.device_id === deviceId && s.slot_no === slotNo);

            // 모든 기기가 하나 이상의 소재를 가지고 있어야 함
            if (deviceSchedules.length === 0) return null;

            // 해당 구좌의 모든 소재가 같은 브랜드여야 함
            const brandsInSlot = new Set(deviceSchedules.map(s => s.medias?.brands?.id).filter(id => !!id));
            if (brandsInSlot.size !== 1) return null;

            const brandId = Array.from(brandsInSlot)[0] as string;
            const brandName = deviceSchedules[0].medias?.brands?.name;

            if (commonBrandId === null) {
                commonBrandId = brandId;
                commonBrandName = brandName || 'Unknown';
            } else if (commonBrandId !== brandId) {
                return null;
            }
        }

        return commonBrandName;
    };

    const isDeviceIncompatible = (device: Device) => {
        if (selectedMediaIds.length === 0) return false;
        const selectedRes = medias
            .filter(m => selectedMediaIds.includes(m.id))
            .map(m => m.resolution)
            .filter(r => !!r);
        if (selectedRes.length === 0) return false;
        return selectedRes.some(res => res !== device.resolution);
    };

    const scrollTable = (categoryId: string, direction: 'left' | 'right') => {
        const container = tableContainerRefs.current[categoryId];
        if (container) {
            const scrollAmount = window.innerWidth * 0.5;
            container.scrollBy({ left: direction === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' });
        }
    };

    return (
        <main className="min-h-screen" style={{ backgroundColor: theme.colors.background, padding: '40px 20px' }}>
            <div className="container mx-auto" style={{ maxWidth: '1600px' }}>
                <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                        <Link href="/" className="flex items-center justify-center" style={{
                            width: '40px', height: '40px',
                            borderRadius: theme.radius.md,
                            backgroundColor: theme.colors.surface,
                            border: `1px solid ${theme.colors.border}`,
                            color: theme.colors.text.body,
                            boxShadow: theme.shadows.sm
                        }}>
                            <ArrowLeft size={20} />
                        </Link>
                        <div>
                            <h1 style={{ fontSize: '1.875rem', fontWeight: '800', color: theme.colors.text.title, letterSpacing: '-0.025em' }}>편성 Matrix 관리</h1>
                            <p style={{ color: theme.colors.text.muted, fontSize: '0.875rem', marginTop: '2px' }}>멀티 구좌 선택 및 브랜드 동기화 모니터링</p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <Link href="/schedules/timetable" style={{
                            padding: '10px 16px', borderRadius: theme.radius.md,
                            backgroundColor: theme.colors.surface,
                            border: `1px solid ${theme.colors.border}`,
                            color: theme.colors.primary.main,
                            cursor: 'pointer', transition: 'all 0.2s',
                            display: 'flex', alignItems: 'center', gap: '8px',
                            fontWeight: '700', textDecoration: 'none',
                            fontSize: '0.875rem'
                        }}>
                            <LayoutList size={18} />
                            편성표 보기
                        </Link>
                        <button
                            onClick={fetchData}
                            disabled={loading}
                            style={{
                                padding: '10px', borderRadius: theme.radius.md,
                                backgroundColor: theme.colors.surface,
                                border: `1px solid ${theme.colors.border}`,
                                color: theme.colors.text.body,
                                cursor: 'pointer', transition: 'all 0.2s'
                            }}
                        >
                            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </header>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 320px) 1fr', gap: '32px', alignItems: 'start' }}>
                    {/* 왼쪽: 소재 목록 */}
                    <aside>
                        <div style={{
                            backgroundColor: theme.colors.surface,
                            padding: '24px', borderRadius: theme.radius.lg,
                            border: `1px solid ${theme.colors.border}`,
                            boxShadow: theme.shadows.sm,
                            position: 'sticky', top: '24px'
                        }}>
                            <h2 style={{ fontSize: '1.125rem', fontWeight: '700', color: theme.colors.text.title, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <Film size={20} color={theme.colors.primary.main} /> 소재 도구함
                            </h2>
                            <div style={{ display: 'grid', gap: '10px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto', paddingRight: '4px' }}>
                                {medias.map(media => {
                                    const isSelected = selectedMediaIds.includes(media.id);
                                    return (
                                        <div
                                            key={media.id}
                                            onClick={() => {
                                                setSelectedMediaIds(prev =>
                                                    isSelected ? prev.filter(id => id !== media.id) : [...prev, media.id]
                                                );
                                            }}
                                            style={{
                                                padding: '16px', borderRadius: theme.radius.md,
                                                cursor: 'pointer', display: 'flex', gap: '14px', alignItems: 'flex-start',
                                                border: `1px solid ${isSelected ? theme.colors.primary.border : theme.colors.divider}`,
                                                backgroundColor: isSelected ? theme.colors.primary.light : theme.colors.surface,
                                                boxShadow: isSelected ? `0 0 0 1px ${theme.colors.primary.main}` : 'none',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            <div style={{
                                                marginTop: '4px',
                                                width: '20px', height: '20px', borderRadius: '6px',
                                                border: `2px solid ${isSelected ? theme.colors.primary.main : theme.colors.text.muted}`,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                backgroundColor: isSelected ? theme.colors.primary.main : 'transparent',
                                                flexShrink: 0
                                            }}>
                                                {isSelected && <CheckCircle2 size={14} color="white" />}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                                    <span style={{ fontSize: '0.625rem', fontWeight: '900', color: theme.colors.accent.indigo, backgroundColor: theme.colors.accent.indigo + '10', padding: '2px 6px', borderRadius: '4px' }}>
                                                        {media.brands?.name || '공용'}
                                                    </span>
                                                    <span style={{ fontSize: '0.625rem', color: theme.colors.text.muted, fontWeight: '700' }}>
                                                        {media.duration}초
                                                    </span>
                                                </div>
                                                <div style={{ fontSize: '0.9375rem', fontWeight: '800', color: theme.colors.text.title, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {media.product_name || media.title}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <div style={{ fontSize: '0.75rem', color: theme.colors.text.muted, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <ImageIcon size={12} />
                                                        {media.resolution || '해상도 정보 없음'}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </aside>

                    {/* 오른쪽: 매체 현황 및 편성 */}
                    <section style={{ display: 'grid', gap: '40px', minWidth: 0 }}>
                        {(selectedMediaIds.length > 0 && (selectedTargetIds.length > 0 || selectedCellKeys.length > 0)) && (
                            <div style={{
                                position: 'sticky', top: '24px', zIndex: 100,
                                padding: '16px 24px', borderRadius: theme.radius.lg,
                                backgroundColor: theme.colors.primary.main,
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                boxShadow: theme.shadows.lg, color: 'white'
                            }}>
                                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                                    <Layers size={24} />
                                    <div>
                                        <div style={{ fontWeight: '800', fontSize: '1.0625rem' }}>일괄 편성 액션 (Matrix)</div>
                                        <div style={{ fontSize: '0.8125rem', opacity: 0.9 }}>
                                            {selectedMediaIds.length}개 소재 선택됨 |
                                            {selectedCellKeys.length > 0 ? ` ${selectedCellKeys.length}개 구좌 직접 지정` : ` ${selectedTargetIds.length}개 기기 대상`}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                    {selectedCellKeys.length === 0 && (
                                        <div style={{ backgroundColor: 'rgba(255,255,255,0.15)', padding: '6px 14px', borderRadius: theme.radius.md, display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <span style={{ fontSize: '0.8125rem', fontWeight: '600' }}>구좌수</span>
                                            <input
                                                type="number"
                                                value={assignmentCount}
                                                onChange={(e) => setAssignmentCount(Math.max(1, parseInt(e.target.value) || 1))}
                                                style={{ width: '36px', background: 'none', border: 'none', color: 'white', fontWeight: '800', outline: 'none' }}
                                            />
                                        </div>
                                    )}
                                    <button
                                        onClick={() => handleAssignMedia()}
                                        disabled={selectedTargetIds.some(id => isDeviceIncompatible(devices.find(d => d.id === id)!))}
                                        style={{
                                            backgroundColor: selectedTargetIds.some(id => isDeviceIncompatible(devices.find(d => d.id === id)!)) ? '#94a3b8' : 'white',
                                            color: theme.colors.primary.main, padding: '10px 24px', borderRadius: theme.radius.md, fontWeight: '800', border: 'none',
                                            cursor: selectedTargetIds.some(id => isDeviceIncompatible(devices.find(d => d.id === id)!)) ? 'not-allowed' : 'pointer'
                                        }}
                                    >
                                        편성 실행
                                    </button>
                                    <button
                                        onClick={handleBulkRemoveAssignments}
                                        style={{
                                            backgroundColor: 'rgba(239, 68, 68, 0.9)',
                                            color: 'white', padding: '10px 20px', borderRadius: theme.radius.md, fontWeight: '800', border: 'none',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        편성 제외
                                    </button>
                                    <button
                                        onClick={() => { setSelectedTargetIds([]); setSelectedCellKeys([]); }}
                                        style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: 'white', padding: '10px 16px', borderRadius: theme.radius.md, fontWeight: '700', border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer' }}
                                    >
                                        취소
                                    </button>
                                </div>
                            </div>
                        )}

                        {mediaGroups.map(group => {
                            const groupCategories = categories.filter(c => c.media_group_id === group.id);
                            const groupDeviceIds = devices.filter(d => {
                                const catIds = groupCategories.map(c => c.id);
                                return catIds.includes(d.category_id);
                            }).map(d => d.id);
                            const isAllInGroupSelected = groupDeviceIds.length > 0 && groupDeviceIds.every(id => selectedTargetIds.includes(id));

                            return (
                                <div key={group.id} style={{
                                    backgroundColor: theme.colors.surface,
                                    borderRadius: theme.radius.lg,
                                    border: `1px solid ${theme.colors.border}`,
                                    overflow: 'hidden',
                                    boxShadow: theme.shadows.sm
                                }}>
                                    <div style={{
                                        padding: '24px 32px',
                                        backgroundColor: theme.colors.primary.light,
                                        borderBottom: `1px solid ${theme.colors.border}`,
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                            <div style={{
                                                width: '40px', height: '40px', borderRadius: '12px',
                                                backgroundColor: 'white', border: `1px solid ${theme.colors.primary.border}`,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                                            }}>
                                                <Building2 size={24} color={theme.colors.primary.main} />
                                            </div>
                                            <div>
                                                <h2 style={{ fontSize: '1.25rem', fontWeight: '900', color: theme.colors.text.title }}>{group.name}</h2>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <p style={{ fontSize: '0.75rem', color: theme.colors.text.body, fontWeight: '700' }}>매체(전체) 편성 도구</p>
                                                    <span style={{ fontSize: '0.7rem', color: (group.idle_time || 0) > 0 ? theme.colors.accent.amber : theme.colors.status.success, backgroundColor: 'white', padding: '1px 6px', borderRadius: '4px', border: `1px solid ${theme.colors.divider}`, fontWeight: '900' }}>
                                                        유휴: {(group.idle_time || 0) >= 60
                                                            ? `${Math.floor(Math.abs(group.idle_time || 0) / 60)}분${Math.abs(group.idle_time || 0) % 60 > 0 ? ` ${Math.abs(group.idle_time || 0) % 60}초` : ''} (${group.idle_time || 0}초)`
                                                            : `${group.idle_time || 0}초`}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => {
                                                if (isAllInGroupSelected) setSelectedTargetIds(prev => prev.filter(id => !groupDeviceIds.includes(id)));
                                                else setSelectedTargetIds(prev => Array.from(new Set([...prev, ...groupDeviceIds])));
                                            }}
                                            style={{
                                                padding: '8px 16px', borderRadius: theme.radius.md,
                                                backgroundColor: isAllInGroupSelected ? theme.colors.primary.main : 'white',
                                                color: isAllInGroupSelected ? 'white' : theme.colors.primary.main,
                                                border: `1px solid ${theme.colors.primary.border}`,
                                                fontSize: '0.8125rem', fontWeight: '800', cursor: 'pointer', transition: 'all 0.2s'
                                            }}
                                        >
                                            {isAllInGroupSelected ? '매체 전체 해제' : '매체 전체 선택 (일괄편성 대상)'}
                                        </button>
                                    </div>

                                    <div style={{ display: 'grid', gap: '32px', padding: '32px' }}>
                                        {groupCategories.map(category => {
                                            const categoryDevices = devices.filter(d => d.category_id === category.id);
                                            const categoryDeviceIds = categoryDevices.map(d => d.id);
                                            const isAllInCatSelected = categoryDeviceIds.length > 0 && categoryDeviceIds.every(id => selectedTargetIds.includes(id));
                                            const total = category.total_slots ?? group.total_slots;

                                            return (
                                                <div key={category.id} style={{ minWidth: 0 }}>
                                                    <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                            <FolderOpen size={20} color={theme.colors.primary.main} />
                                                            <h3 style={{ fontSize: '1.125rem', fontWeight: '800', color: theme.colors.text.title }}>{category.name}</h3>
                                                            <button
                                                                onClick={() => {
                                                                    if (isAllInCatSelected) setSelectedTargetIds(prev => prev.filter(id => !categoryDeviceIds.includes(id)));
                                                                    else setSelectedTargetIds(prev => Array.from(new Set([...prev, ...categoryDeviceIds])));
                                                                }}
                                                                style={{
                                                                    marginLeft: '8px', padding: '4px 12px', borderRadius: theme.radius.sm,
                                                                    backgroundColor: 'white', color: theme.colors.text.body,
                                                                    border: `1px solid ${theme.colors.border}`,
                                                                    fontSize: '0.75rem', fontWeight: '800', cursor: 'pointer'
                                                                }}
                                                            >
                                                                {isAllInCatSelected ? '구분 해제' : '구분 전체 선택'}
                                                            </button>
                                                            <span style={{ fontSize: '0.75rem', fontWeight: '700', color: (category.idle_time || 0) > 0 ? theme.colors.accent.amber : theme.colors.status.success, marginLeft: '8px' }}>
                                                                (유휴: {(category.idle_time || 0) >= 60
                                                                    ? `${Math.floor(Math.abs(category.idle_time || 0) / 60)}분${Math.abs(category.idle_time || 0) % 60 > 0 ? ` ${Math.abs(category.idle_time || 0) % 60}초` : ''} (${category.idle_time || 0}초)`
                                                                    : `${category.idle_time || 0}초`})
                                                            </span>
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: '700', color: theme.colors.accent.amber }}>
                                                                <Star size={14} fill={theme.colors.accent.amber} /> 브랜드 동기화 자동 감지 중
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '4px' }}>
                                                                <button onClick={() => scrollTable(category.id, 'left')} style={{ padding: '8px', borderRadius: '50%', border: `1px solid ${theme.colors.border}`, background: 'white', cursor: 'pointer', color: theme.colors.text.body, boxShadow: theme.shadows.sm }}><ChevronLeft size={18} /></button>
                                                                <button onClick={() => scrollTable(category.id, 'right')} style={{ padding: '8px', borderRadius: '50%', border: `1px solid ${theme.colors.border}`, background: 'white', cursor: 'pointer', color: theme.colors.text.body, boxShadow: theme.shadows.sm }}><ChevronRight size={18} /></button>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div
                                                        ref={el => { tableContainerRefs.current[category.id] = el; }}
                                                        style={{
                                                            overflowX: 'auto', backgroundColor: '#fff',
                                                            borderRadius: theme.radius.lg, border: `1px solid ${theme.colors.border}`,
                                                            scrollbarWidth: 'thin', maxWidth: '100%'
                                                        }}
                                                    >
                                                        <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: '100%' }}>
                                                            <thead>
                                                                <tr style={{ backgroundColor: theme.colors.background }}>
                                                                    <th style={{
                                                                        padding: '16px 24px', textAlign: 'left', fontSize: '0.75rem', color: theme.colors.text.body, fontWeight: '800',
                                                                        position: 'sticky', left: 0, backgroundColor: theme.colors.background, zIndex: 10,
                                                                        borderBottom: `2px solid ${theme.colors.divider}`, width: '180px'
                                                                    }}>구좌 정보 / 상태</th>
                                                                    {categoryDevices.map(device => {
                                                                        const isDeviceSelected = selectedTargetIds.includes(device.id);
                                                                        const isIncompatible = isDeviceIncompatible(device);
                                                                        return (
                                                                            <th key={device.id} style={{
                                                                                padding: '12px 24px', textAlign: 'center',
                                                                                borderBottom: `2px solid ${isDeviceSelected ? theme.colors.primary.main : theme.colors.divider}`,
                                                                                minWidth: '220px',
                                                                                backgroundColor: isIncompatible ? 'rgba(239, 68, 68, 0.05)' : (isDeviceSelected ? theme.colors.primary.light : 'transparent')
                                                                            }}>
                                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                                                                        <input type="checkbox"
                                                                                            disabled={isIncompatible}
                                                                                            checked={isDeviceSelected}
                                                                                            onChange={(e) => {
                                                                                                if (e.target.checked) setSelectedTargetIds(prev => [...prev, device.id]);
                                                                                                else setSelectedTargetIds(prev => prev.filter(id => id !== device.id));
                                                                                            }}
                                                                                            style={{ width: '16px', height: '16px', cursor: isIncompatible ? 'not-allowed' : 'pointer' }}
                                                                                        />
                                                                                        <span style={{ fontWeight: '900', fontSize: '0.85rem', color: isIncompatible ? theme.colors.status.danger : theme.colors.text.title }}>
                                                                                            {device.name}
                                                                                        </span>
                                                                                    </div>
                                                                                    <div style={{ fontSize: '0.625rem', color: theme.colors.text.muted, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                                        <Monitor size={10} /> {device.resolution || 'N/A'}
                                                                                    </div>
                                                                                </div>
                                                                            </th>
                                                                        );
                                                                    })}
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {Array.from({ length: total }).map((_, i) => {
                                                                    const slotNo = i + 1;
                                                                    const unifiedBrand = getUnifiedBrandInSlot(slotNo, categoryDeviceIds);

                                                                    return (
                                                                        <tr key={slotNo} style={{
                                                                            borderBottom: `1px solid ${theme.colors.divider}`,
                                                                            backgroundColor: unifiedBrand ? 'rgba(245, 158, 11, 0.01)' : 'transparent'
                                                                        }}>
                                                                            <td style={{
                                                                                padding: '16px 24px', position: 'sticky', left: 0,
                                                                                backgroundColor: unifiedBrand ? 'rgba(255, 251, 235, 0.95)' : 'white',
                                                                                zIndex: 5, borderRight: `1px solid ${theme.colors.divider}`,
                                                                                boxShadow: '4px 0 8px -4px rgba(0,0,0,0.05)'
                                                                            }}>
                                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                                    {unifiedBrand && (
                                                                                        <div style={{
                                                                                            fontSize: '0.55rem', fontWeight: '900',
                                                                                            color: theme.colors.accent.amber, backgroundColor: 'white',
                                                                                            padding: '1px 6px', borderRadius: '8px', border: `1px solid ${theme.colors.accent.amber}`,
                                                                                            width: 'fit-content', marginBottom: '2px'
                                                                                        }}>
                                                                                            {unifiedBrand} 브랜드 전용
                                                                                        </div>
                                                                                    )}
                                                                                    <span style={{ fontWeight: '800', fontSize: '0.9rem', color: theme.colors.text.title }}>{slotNo}번 구좌</span>
                                                                                    <button
                                                                                        onClick={() => {
                                                                                            const rowKeys = categoryDevices.map(d => `${d.id}:${slotNo}`);
                                                                                            const allInRowSelected = rowKeys.every(k => selectedCellKeys.includes(k));
                                                                                            if (allInRowSelected) setSelectedCellKeys(prev => prev.filter(k => !rowKeys.includes(k)));
                                                                                            else setSelectedCellKeys(prev => Array.from(new Set([...prev, ...rowKeys])));
                                                                                        }}
                                                                                        style={{ fontSize: '0.625rem', color: theme.colors.primary.main, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, fontWeight: '800' }}
                                                                                    >
                                                                                        행 전체선택
                                                                                    </button>
                                                                                </div>
                                                                            </td>
                                                                            {categoryDevices.map(device => {
                                                                                const cellKey = `${device.id}:${slotNo}`;
                                                                                const isCellSelected = selectedCellKeys.includes(cellKey);
                                                                                const isDeviceSelected = selectedTargetIds.includes(device.id);
                                                                                const isIncompatible = isDeviceIncompatible(device);
                                                                                const deviceSchedules = schedules.filter(s => s.device_id === device.id && s.slot_no === slotNo);

                                                                                return (
                                                                                    <td key={device.id} style={{
                                                                                        padding: '12px', borderRight: `1px solid ${theme.colors.divider}`,
                                                                                        backgroundColor: isCellSelected ? 'rgba(2, 132, 199, 0.08)' : (isDeviceSelected ? 'rgba(2, 132, 199, 0.02)' : 'transparent'),
                                                                                        minWidth: '220px', verticalAlign: 'top'
                                                                                    }}>
                                                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                                                <input type="checkbox"
                                                                                                    disabled={isIncompatible}
                                                                                                    checked={isCellSelected}
                                                                                                    onChange={(e) => {
                                                                                                        if (e.target.checked) setSelectedCellKeys(prev => [...prev, cellKey]);
                                                                                                        else setSelectedCellKeys(prev => prev.filter(k => k !== cellKey));
                                                                                                    }}
                                                                                                    style={{ width: '15px', height: '15px', cursor: isIncompatible ? 'not-allowed' : 'pointer' }}
                                                                                                />
                                                                                                <button
                                                                                                    disabled={isIncompatible}
                                                                                                    onClick={() => setIsAssigning({ slotNo, categoryId: category.id, device_id: device.id } as any)}
                                                                                                    style={{
                                                                                                        fontSize: '0.625rem',
                                                                                                        color: isIncompatible ? theme.colors.text.muted : theme.colors.primary.main,
                                                                                                        background: 'none', border: 'none',
                                                                                                        cursor: isIncompatible ? 'not-allowed' : 'pointer',
                                                                                                        fontWeight: '800'
                                                                                                    }}
                                                                                                >
                                                                                                    할당
                                                                                                </button>
                                                                                            </div>
                                                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', minHeight: '32px' }}>
                                                                                                {deviceSchedules.map(as => (
                                                                                                    <div key={as.id} style={{
                                                                                                        fontSize: '0.6875rem', fontWeight: '700', padding: '2px 6px', borderRadius: '4px',
                                                                                                        backgroundColor: '#fff', border: `1px solid ${unifiedBrand ? theme.colors.accent.amber : theme.colors.border}`,
                                                                                                        color: theme.colors.text.body, display: 'flex', alignItems: 'center', gap: '4px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                                                                                    }}>
                                                                                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                                                                <span style={{ fontSize: '0.625rem', color: theme.colors.accent.indigo, fontWeight: '900' }}>{as.medias?.brands?.name}</span>
                                                                                                            </div>
                                                                                                            <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.75rem', fontWeight: '800' }}>{as.medias?.product_name || as.medias?.title}</span>
                                                                                                        </div>
                                                                                                        <button onClick={() => handleRemoveAssignment(as.id)} style={{ color: theme.colors.status.danger, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}><Trash2 size={10} /></button>
                                                                                                    </div>
                                                                                                ))}
                                                                                            </div>
                                                                                        </div>
                                                                                    </td>
                                                                                );
                                                                            })}
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </section>
                </div>
            </div>
            <style jsx global>{`
                ::-webkit-scrollbar { height: 10px; width: 8px; }
                ::-webkit-scrollbar-track { background: #f1f5f9; }
                ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 5px; border: 2px solid #f1f5f9; }
                ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
                
                @keyframes toast-in {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
            `}</style>

            {/* Toast Container */}
            <div style={{
                position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
                zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '8px', pointerEvents: 'none'
            }}>
                {toasts.map(toast => (
                    <div key={toast.id} style={{
                        padding: '12px 24px', borderRadius: theme.radius.md,
                        backgroundColor: toast.type === 'success' ? theme.colors.status.success :
                            toast.type === 'error' ? theme.colors.status.danger : theme.colors.primary.main,
                        color: 'white', fontWeight: '700', fontSize: '0.875rem',
                        boxShadow: theme.shadows.lg, display: 'flex', alignItems: 'center', gap: '10px',
                        animation: 'toast-in 0.3s ease-out', pointerEvents: 'auto'
                    }}>
                        {toast.type === 'success' ? <CheckCircle2 size={18} /> :
                            toast.type === 'error' ? <AlertCircle size={18} /> : <ImageIcon size={18} />}
                        {toast.message}
                    </div>
                ))}
            </div>
        </main>
    );
}
