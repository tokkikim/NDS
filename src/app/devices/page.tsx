'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
    Monitor, Plus, Clock, Save, Trash2, ArrowLeft, RefreshCw, AlertCircle,
    ArrowUpDown, ChevronUp, ChevronDown, Building2, FolderOpen, LayoutGrid,
    ChevronRight, ChevronLeft, Settings, Database, Activity, CheckCircle2,
    Image as ImageIcon
} from 'lucide-react';
import Link from 'next/link';

// Design System Tokens (편성 관리와 통일)
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

interface MediaGroup {
    id: string;
    name: string;
    op_start_time: string;
    op_end_time: string;
    total_slots: number;
    plays_per_slot: number;
    slot_duration: number;
    idle_time?: number;
}

interface DeviceCategory {
    id: string;
    media_group_id: string;
    name: string;
    total_slots: number | null;
    plays_per_slot: number | null;
    slot_duration: number | null;
    op_start_time: string;
    op_end_time: string;
    idle_time?: number;
}

interface Device {
    id: string;
    name: string;
    os_type: 'Windows' | 'Android';
    resolution: string;
    op_start_time: string;
    op_end_time: string;
    status: string;
    category_id: string | null;
    hardware_id?: string | null;
}

interface Toast {
    id: number;
    message: string;
    type: 'success' | 'error' | 'info';
}

export default function DevicesPage() {
    const [mediaGroups, setMediaGroups] = useState<MediaGroup[]>([]);
    const [categories, setCategories] = useState<DeviceCategory[]>([]);
    const [devices, setDevices] = useState<Device[]>([]);
    const [loading, setLoading] = useState(true);
    const [isAdding, setIsAdding] = useState<{ type: 'DEVICE' | 'GROUP' | 'CATEGORY' | null; parentId: string | null }>({ type: null, parentId: null });
    const [isEditing, setIsEditing] = useState<{ type: 'DEVICE' | 'GROUP' | 'CATEGORY' | null; id: string | null }>({ type: null, id: null });

    const [newGroup, setNewGroup] = useState({ name: '', op_start_time: '08:00:00', op_end_time: '22:00:00', total_slots: 10, plays_per_slot: 100, slot_duration: 15 });
    const [newCategory, setNewCategory] = useState({ media_group_id: '', name: '', total_slots: null as number | null, plays_per_slot: null as number | null, slot_duration: null as number | null, op_start_time: '', op_end_time: '' });
    const [newDevice, setNewDevice] = useState<Partial<Device>>({
        name: '',
        os_type: 'Windows',
        resolution: '1920x1080',
        op_start_time: '',
        op_end_time: '',
        category_id: '',
        hardware_id: ''
    });
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [showPendingSelector, setShowPendingSelector] = useState(false);

    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3000);
    };

    const [isBulkMode, setIsBulkMode] = useState(false);
    const [bulkConfig, setBulkConfig] = useState<{
        mode: 'range' | 'custom';
        start: number;
        count: number;
        customValues: string;
    }>({
        mode: 'range',
        start: 1,
        count: 5,
        customValues: ''
    });

    const [deviceSort, setDeviceSort] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' });

    const sortedDevices = (categoryDevices: Device[]) => {
        return [...categoryDevices].sort((a, b) => {
            let aVal: any = a[deviceSort.key as keyof Device];
            let bVal: any = b[deviceSort.key as keyof Device];

            // 운영시간 정렬 예외 처리 (상속 고려)
            if (deviceSort.key === 'op_time') {
                const cat = categories.find(c => c.id === a.category_id);
                const group = mediaGroups.find(g => g.id === cat?.media_group_id);
                aVal = a.op_start_time || cat?.op_start_time || group?.op_start_time || '00:00:00';
                bVal = b.op_start_time || categories.find(c => c.id === b.category_id)?.op_start_time || mediaGroups.find(g => g.id === categories.find(c => c.id === b.category_id)?.media_group_id)?.op_start_time || '00:00:00';
            }

            if (aVal < bVal) return deviceSort.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return deviceSort.direction === 'asc' ? 1 : -1;
            return 0;
        });
    };

    const handleSort = (key: string) => {
        setDeviceSort(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    const SortIcon = ({ sortKey }: { sortKey: string }) => {
        if (deviceSort.key !== sortKey) return <ArrowUpDown size={12} style={{ marginLeft: '4px', opacity: 0.5 }} />;
        return deviceSort.direction === 'asc' ? <ChevronUp size={12} style={{ marginLeft: '4px' }} /> : <ChevronDown size={12} style={{ marginLeft: '4px' }} />;
    };

    const fetchData = async () => {
        setLoading(true);
        const { data: mData } = await supabase.from('media_groups').select('*').order('name');
        if (mData) setMediaGroups(mData);

        const { data: cData } = await supabase.from('device_categories').select('*').order('name');
        if (cData) setCategories(cData);

        const { data: dData } = await supabase.from('devices').select('*').order('created_at', { ascending: false });
        if (dData) setDevices(dData);
        setLoading(false);
    };

    useEffect(() => {
        fetchData();
    }, []);

    const calculateTime = (start: string, end: string) => {
        if (!start || !end) return 0;
        const [h1, m1, s1] = start.split(':').map(Number);
        let [h2, m2, s2] = end.split(':').map(Number);

        const t1 = h1 * 3600 + (m1 || 0) * 60 + (s1 || 0);
        let t2 = h2 * 3600 + (m2 || 0) * 60 + (s2 || 0);

        if (t2 <= t1) t2 += 24 * 3600; // 익일 종료 대응
        return t2 - t1;
    };

    const getGroupAnalysis = (group: typeof newGroup) => {
        const opSeconds = calculateTime(group.op_start_time, group.op_end_time);
        const capacity = group.total_slots * group.plays_per_slot * group.slot_duration;
        const idle = opSeconds - capacity;
        return { opSeconds, capacity, idle };
    };

    const getCategoryAnalysis = (cat: typeof newCategory) => {
        const parent = mediaGroups.find(g => g.id === (isAdding.parentId || cat.media_group_id));
        const start = cat.op_start_time || parent?.op_start_time || '00:00:00';
        const end = cat.op_end_time || parent?.op_end_time || '00:00:00';
        const slots = cat.total_slots ?? parent?.total_slots ?? 0;
        const plays = cat.plays_per_slot ?? parent?.plays_per_slot ?? 0;
        const dur = cat.slot_duration ?? parent?.slot_duration ?? 0;

        const opSeconds = calculateTime(start, end);
        const capacity = slots * plays * dur;
        const idle = opSeconds - capacity;
        return { opSeconds, capacity, idle };
    };

    const handleAddGroup = async (e: React.FormEvent) => {
        e.preventDefault();
        const analysis = getGroupAnalysis(newGroup);
        if (analysis.idle < 0) {
            showToast(`구좌 설정이 운영 시간(초)을 초과했습니다.\n(초과: ${Math.abs(analysis.idle)}초)\n운영 시간을 늘리거나 구좌/횟수/초수를 줄여주세요.`, 'error');
            return;
        }
        if (analysis.idle > 0) {
            if (!confirm(`운영 시간 대비 구좌 설정이 부족하여 약 ${(analysis.idle / 60).toFixed(0)}분의 유휴 시간이 발생합니다. 이대로 저장하시겠습니까?`)) return;
        }

        const dataToSave = { ...newGroup, idle_time: analysis.idle };
        const { error } = await supabase.from('media_groups').insert([dataToSave]);
        if (!error) {
            setIsAdding({ type: null, parentId: null });
            setNewGroup({ name: '', op_start_time: '08:00:00', op_end_time: '22:00:00', total_slots: 10, plays_per_slot: 100, slot_duration: 15 });
            fetchData();
            showToast('매체가 성공적으로 추가되었습니다.', 'success');
        }
    };

    const handleAddCategory = async (e: React.FormEvent) => {
        e.preventDefault();
        const analysis = getCategoryAnalysis(newCategory);
        if (analysis.idle < 0) {
            showToast(`구좌 설정이 운영 시간(초)을 초과했습니다.\n(초과: ${Math.abs(analysis.idle)}초)\n운영 시간을 늘리거나 구좌/횟수/초수를 줄여주세요.`, 'error');
            return;
        }
        if (analysis.idle > 0) {
            if (!confirm(`운영 시간 대비 구좌 설정이 부족하여 약 ${(analysis.idle / 60).toFixed(0)}분의 유휴 시간이 발생합니다. 이대로 저장하시겠습니까?`)) return;
        }

        const dataToSave: any = { ...newCategory, idle_time: analysis.idle };
        if (dataToSave.op_start_time === '') dataToSave.op_start_time = null;
        if (dataToSave.op_end_time === '') dataToSave.op_end_time = null;
        const { error } = await supabase.from('device_categories').insert([dataToSave]);
        if (!error) {
            setIsAdding({ type: null, parentId: null });
            setNewCategory({ media_group_id: '', name: '', total_slots: null, plays_per_slot: null, slot_duration: null, op_start_time: '', op_end_time: '' });
            fetchData();
            showToast('구분이 성공적으로 추가되었습니다.', 'success');
        }
    };

    const handleAddDevice = async (e: React.FormEvent) => {
        e.preventDefault();

        const devicesToInsert = [];
        const deviceName = newDevice.name || '';

        const processDeviceData = (data: Partial<Device>) => {
            const processed = { ...data };
            if (!processed.op_start_time || processed.op_start_time === '') delete processed.op_start_time;
            if (!processed.op_end_time || processed.op_end_time === '') delete processed.op_end_time;
            return processed;
        };

        if (isBulkMode && deviceName.includes('{}')) {
            if (bulkConfig.mode === 'range') {
                for (let i = 0; i < bulkConfig.count; i++) {
                    const currentNum = bulkConfig.start + i;
                    devicesToInsert.push({
                        ...processDeviceData(newDevice),
                        name: deviceName.replace('{}', currentNum.toString()),
                        status: 'offline'
                    });
                }
            } else {
                const values = bulkConfig.customValues.split(',').map(v => v.trim()).filter(v => v !== '');
                if (values.length === 0) {
                    showToast('커스텀 리스트 값을 입력해주세요.', 'error');
                    return;
                }
                for (const val of values) {
                    devicesToInsert.push({
                        ...processDeviceData(newDevice),
                        name: deviceName.replace('{}', val),
                        status: 'offline'
                    });
                }
            }
        } else {
            devicesToInsert.push({
                ...processDeviceData(newDevice),
                status: 'offline'
            });
        }

        const { error } = await supabase.from('devices').insert(devicesToInsert);
        if (!error) {
            setIsAdding({ type: null, parentId: null });
            setIsBulkMode(false);
            setNewDevice({
                name: '',
                os_type: 'Windows',
                resolution: '1920x1080',
                op_start_time: '',
                op_end_time: '',
                category_id: '',
                hardware_id: ''
            });
            fetchData();
            showToast(`${devicesToInsert.length}개의 기기가 성공적으로 등록되었습니다.`, 'success');
        } else {
            showToast('기기 등록 중 오류가 발생했습니다: ' + error.message, 'error');
        }
    };

    const handleDeleteDevice = async (id: string) => {
        if (confirm('정말 이 기기를 삭제하시겠습니까?')) {
            const { error } = await supabase.from('devices').delete().eq('id', id);
            if (!error) fetchData();
        }
    };

    const handleDeleteGroup = async (id: string) => {
        if (confirm('매체를 삭제하시겠습니까?\n모든 하위 구분과 기기도 함께 삭제됩니다.')) {
            const { error } = await supabase.from('media_groups').delete().eq('id', id);
            if (!error) {
                setIsEditing({ type: null, id: null });
                fetchData();
                showToast('매체가 삭제되었습니다.', 'info');
            } else {
                showToast('매체 삭제 중 오류가 발생했습니다: ' + error.message, 'error');
            }
        }
    };

    const handleDeleteCategory = async (id: string) => {
        if (confirm('구분을 삭제하시겠습니까?\n소속된 모든 기기도 함께 삭제됩니다.')) {
            const { error } = await supabase.from('device_categories').delete().eq('id', id);
            if (!error) {
                setIsEditing({ type: null, id: null });
                fetchData();
                showToast('구분이 삭제되었습니다.', 'info');
            } else {
                showToast('구분 삭제 중 오류가 발생했습니다: ' + error.message, 'error');
            }
        }
    };

    const handleUpdateGroup = async (e: React.FormEvent) => {
        e.preventDefault();
        const analysis = getGroupAnalysis(newGroup);
        if (analysis.idle < 0) {
            showToast(`구좌 설정이 운영 시간(초)을 초과했습니다.\n(초과: ${Math.abs(analysis.idle)}초)\n운영 시간을 늘리거나 구좌/횟수/초수를 줄여주세요.`, 'error');
            return;
        }
        if (analysis.idle > 0) {
            if (!confirm(`운영 시간 대비 구좌 설정이 부족하여 약 ${(analysis.idle / 60).toFixed(0)}분의 유휴 시간이 발생합니다. 이대로 저장하시겠습니까?`)) return;
        }
        if (!isEditing.id) return;

        const dataToSave = { ...newGroup, idle_time: analysis.idle };
        const { error } = await supabase.from('media_groups').update(dataToSave).eq('id', isEditing.id);
        if (!error) {
            setIsEditing({ type: null, id: null });
            setNewGroup({ name: '', op_start_time: '08:00:00', op_end_time: '22:00:00', total_slots: 10, plays_per_slot: 100, slot_duration: 15 });
            fetchData();
            showToast('매체 정보가 수정되었습니다.', 'success');
        }
    };

    const handleUpdateCategory = async (e: React.FormEvent) => {
        e.preventDefault();
        const analysis = getCategoryAnalysis(newCategory);
        if (analysis.idle < 0) {
            showToast(`구좌 설정이 운영 시간(초)을 초과했습니다.\n(초과: ${Math.abs(analysis.idle)}초)\n운영 시간을 늘리거나 구좌/횟수/초수를 줄여주세요.`, 'error');
            return;
        }
        if (analysis.idle > 0) {
            if (!confirm(`운영 시간 대비 구좌 설정이 부족하여 약 ${(analysis.idle / 60).toFixed(0)}분의 유휴 시간이 발생합니다. 이대로 저장하시겠습니까?`)) return;
        }
        if (!isEditing.id) return;

        const dataToSave: any = { ...newCategory, idle_time: analysis.idle };
        if (dataToSave.op_start_time === '') dataToSave.op_start_time = null;
        if (dataToSave.op_end_time === '') dataToSave.op_end_time = null;
        const { error } = await supabase.from('device_categories').update(dataToSave).eq('id', isEditing.id);
        if (!error) {
            setIsEditing({ type: null, id: null });
            setNewCategory({ media_group_id: '', name: '', total_slots: null, plays_per_slot: null, slot_duration: null, op_start_time: '', op_end_time: '' });
            fetchData();
            showToast('구분 정보가 수정되었습니다.', 'success');
        }
    };

    const handleUpdateDevice = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isEditing.id) return;
        const dataToSave: any = { ...newDevice };
        if (dataToSave.op_start_time === '') dataToSave.op_start_time = null;
        if (dataToSave.op_end_time === '') dataToSave.op_end_time = null;
        const { error } = await supabase.from('devices').update(dataToSave).eq('id', isEditing.id);

        if (error) {
            // Hardware ID 중복 처리 (중복된 ID가 대기 중인 기기인 경우 교체 제안)
            if (error.code === '23505' && dataToSave.hardware_id) {
                const { data: existing } = await supabase.from('devices')
                    .select('id, category_id, name')
                    .eq('hardware_id', dataToSave.hardware_id)
                    .maybeSingle();

                if (existing && !existing.category_id) {
                    if (confirm(`'${existing.name}' 기기가 이미 이 Hardware ID로 대기 중입니다. 기존 대기 기록을 삭제하고 이 설정(틀)에 연결하시겠습니까?`)) {
                        const { error: delError } = await supabase.from('devices').delete().eq('id', existing.id);
                        if (!delError) {
                            const { error: retryError } = await supabase.from('devices').update(dataToSave).eq('id', isEditing.id);
                            if (!retryError) {
                                completeUpdate();
                                return;
                            }
                        }
                    } else {
                        return;
                    }
                }
            }
            showToast('기기 정보 수정 중 오류가 발생했습니다: ' + error.message, 'error');
            return;
        }

        completeUpdate();
    };

    const completeUpdate = () => {
        setIsEditing({ type: null, id: null });
        setNewDevice({
            name: '',
            os_type: 'Windows',
            resolution: '1920x1080',
            op_start_time: '',
            op_end_time: '',
            category_id: '',
            hardware_id: ''
        });
        fetchData();
        showToast('기기 정보가 수정되었습니다.', 'success');
    };

    const startEditGroup = (group: MediaGroup) => {
        setNewGroup({
            name: group.name,
            op_start_time: group.op_start_time,
            op_end_time: group.op_end_time,
            total_slots: group.total_slots,
            plays_per_slot: group.plays_per_slot,
            slot_duration: group.slot_duration
        });
        setIsEditing({ type: 'GROUP', id: group.id });
        setIsAdding({ type: null, parentId: null });
    };

    const startEditCategory = (cat: DeviceCategory) => {
        setNewCategory({ ...cat });
        setIsEditing({ type: 'CATEGORY', id: cat.id });
        setIsAdding({ type: null, parentId: null });
    };

    const startEditDevice = (device: Device) => {
        setNewDevice({ ...device });
        setIsEditing({ type: 'DEVICE', id: device.id });
        setIsAdding({ type: null, parentId: null });
    };

    return (
        <main style={{ minHeight: '100vh', backgroundColor: theme.colors.background }}>
            <style>{`
                .hover-row:hover { background-color: ${theme.colors.divider} !important; transition: all 0.2s; }
                .animate-spin { animation: spin 1s linear infinite; }
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            `}</style>
            {/* Header section (schedules 스타일 계승) */}
            <div style={{
                position: 'sticky', top: 0, zIndex: 100,
                backgroundColor: 'rgba(255, 255, 255, 0.8)', backdropFilter: 'blur(12px)',
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '16px 32px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '1600px', margin: '0 auto' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                        <Link href="/" className="btn" style={{ padding: '8px', color: theme.colors.text.body, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, border: `1px solid ${theme.colors.border}`, boxShadow: theme.shadows.sm }}>
                            <ArrowLeft size={20} />
                        </Link>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: theme.colors.text.muted, marginBottom: '2px' }}>
                                <Database size={12} /> 시스템 설정 <ChevronRight size={12} /> <span>플레이어 관리</span>
                            </div>
                            <h1 style={{ fontSize: '1.25rem', fontWeight: '800', color: theme.colors.text.title, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Monitor size={22} style={{ color: theme.colors.primary.main }} /> 기기 및 운영 관리
                            </h1>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button className="btn" onClick={fetchData} disabled={loading} style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: theme.colors.surface, border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius.md }}>
                            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} style={{ color: theme.colors.text.body }} />
                            <span style={{ fontSize: '0.875rem', fontWeight: '600', color: theme.colors.text.body }}>새로고침</span>
                        </button>
                        <button className="btn" onClick={() => {
                            setNewGroup({ name: '', op_start_time: '08:00:00', op_end_time: '22:00:00', total_slots: 10, plays_per_slot: 100, slot_duration: 15 });
                            setIsAdding({ type: 'GROUP', parentId: null });
                        }} style={{ padding: '8px 20px', backgroundColor: theme.colors.primary.main, color: 'white', borderRadius: theme.radius.md, fontWeight: '700', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: theme.shadows.md }}>
                            <Plus size={18} /> 새 매체 등록
                        </button>
                    </div>
                </div>
            </div>

            <div style={{ padding: '32px', maxWidth: '1600px', margin: '0 auto' }}>

                {/* Form Overlay (Modal) */}
                {(isAdding.type || isEditing.type) && (
                    <div
                        style={{
                            position: 'fixed', inset: 0, zIndex: 1000,
                            backgroundColor: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px'
                        }}
                        onClick={() => { setIsAdding({ type: null, parentId: null }); setIsEditing({ type: null, id: null }); }}
                    >
                        <div
                            style={{
                                width: '100%',
                                maxWidth: (isAdding.type === 'GROUP' || isEditing.type === 'GROUP') ? '500px' : '650px',
                                maxHeight: '90vh', overflowY: 'auto',
                                backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg,
                                boxShadow: theme.shadows.lg, border: `1px solid ${theme.colors.border}`
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Media Group Form */}
                            {(isAdding.type === 'GROUP' || isEditing.type === 'GROUP') && (
                                <section style={{ padding: '32px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                                        <div style={{ padding: '8px', borderRadius: theme.radius.md, backgroundColor: theme.colors.primary.light }}>
                                            <Building2 size={24} style={{ color: theme.colors.primary.main }} />
                                        </div>
                                        <div>
                                            <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: theme.colors.text.title }}>
                                                {isEditing.id ? '매체 정보 수정' : '새 매체 등록'}
                                            </h2>
                                            <p style={{ fontSize: '0.875rem', color: theme.colors.text.muted }}>광고 구좌의 기본 정책을 설정합니다.</p>
                                        </div>
                                    </div>
                                    <form onSubmit={isEditing.id ? handleUpdateGroup : handleAddGroup} style={{ display: 'grid', gap: '24px' }}>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: '600', color: theme.colors.text.body }}>매체 명칭</label>
                                            <input type="text" required style={{ width: '100%', padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${theme.colors.border}`, fontSize: '0.9375rem', outline: 'none' }} placeholder="예: KIMTOKKI" value={newGroup.name} onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })} />
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.8rem', fontWeight: '600', color: theme.colors.text.muted }}>기본 구좌수</label>
                                                <input type="number" style={{ width: '100%', padding: '10px', borderRadius: theme.radius.md, border: `1px solid ${theme.colors.border}`, outline: 'none' }} value={newGroup.total_slots} onChange={(e) => setNewGroup({ ...newGroup, total_slots: parseInt(e.target.value) || 0 })} />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.8rem', fontWeight: '600', color: theme.colors.text.muted }}>기본 송출횟수</label>
                                                <input type="number" style={{ width: '100%', padding: '10px', borderRadius: theme.radius.md, border: `1px solid ${theme.colors.border}`, outline: 'none' }} value={newGroup.plays_per_slot} onChange={(e) => setNewGroup({ ...newGroup, plays_per_slot: parseInt(e.target.value) || 0 })} />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.8rem', fontWeight: '600', color: theme.colors.text.muted }}>기본 초수(초)</label>
                                                <input type="number" style={{ width: '100%', padding: '10px', borderRadius: theme.radius.md, border: `1px solid ${theme.colors.border}`, outline: 'none' }} value={newGroup.slot_duration} onChange={(e) => setNewGroup({ ...newGroup, slot_duration: parseInt(e.target.value) || 0 })} />
                                            </div>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.8rem', fontWeight: '600', color: theme.colors.text.muted }}>운영 시작</label>
                                                <input type="time" style={{ width: '100%', padding: '10px', borderRadius: theme.radius.md, border: `1px solid ${theme.colors.border}`, outline: 'none' }} value={newGroup.op_start_time} onChange={(e) => setNewGroup({ ...newGroup, op_start_time: e.target.value })} />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.8rem', fontWeight: '600', color: theme.colors.text.muted }}>운영 종료</label>
                                                <input type="time" style={{ width: '100%', padding: '10px', borderRadius: theme.radius.md, border: `1px solid ${theme.colors.border}`, outline: 'none' }} value={newGroup.op_end_time} onChange={(e) => setNewGroup({ ...newGroup, op_end_time: e.target.value })} />
                                            </div>
                                        </div>

                                        {(() => {
                                            const analysis = getGroupAnalysis(newGroup);
                                            return (
                                                <div style={{ padding: '16px', borderRadius: theme.radius.md, backgroundColor: analysis.idle > 0 ? '#fffbeb' : '#f0fdf4', border: `1px solid ${analysis.idle > 0 ? '#fde68a' : '#bbf7d0'}` }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
                                                        <span style={{ color: theme.colors.text.muted }}>총 운영 시간:</span>
                                                        <span style={{ fontWeight: '700', color: theme.colors.text.body }}>{(analysis.opSeconds / 3600).toFixed(1)}시간 ({analysis.opSeconds}초)</span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', fontWeight: '800', borderTop: `1px solid ${analysis.idle > 0 ? '#fef3c7' : '#dcfce7'}`, paddingTop: '8px', marginTop: '4px' }}>
                                                        <span style={{ color: theme.colors.text.body }}>잔여/유휴:</span>
                                                        <span style={{ color: analysis.idle > 0 ? theme.colors.accent.amber : theme.colors.status.success }}>
                                                            {analysis.idle >= 60
                                                                ? `${Math.floor(Math.abs(analysis.idle) / 60)}분 ${Math.abs(analysis.idle) % 60}초 (${analysis.idle}초)`
                                                                : `${analysis.idle}초`}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                                            <button type="submit" className="btn" style={{ flex: 2, padding: '12px', backgroundColor: theme.colors.primary.main, color: 'white', borderRadius: theme.radius.md, fontWeight: '700', border: 'none', cursor: 'pointer' }}>{isEditing.id ? '설정 저장' : '등록 하기'}</button>
                                            {isEditing.id && (
                                                <button type="button" className="btn" style={{ flex: 1, backgroundColor: 'rgba(239, 68, 68, 0.05)', color: theme.colors.status.danger, border: `1px solid ${theme.colors.status.danger}44`, borderRadius: theme.radius.md, fontWeight: '700', cursor: 'pointer' }} onClick={() => handleDeleteGroup(isEditing.id!)}>삭제</button>
                                            )}
                                            <button type="button" className="btn" style={{ flex: 1, padding: '12px', backgroundColor: theme.colors.divider, color: theme.colors.text.body, borderRadius: theme.radius.md, fontWeight: '700', border: 'none', cursor: 'pointer' }} onClick={() => { setIsAdding({ type: null, parentId: null }); setIsEditing({ type: null, id: null }); }}>취소</button>
                                        </div>
                                    </form>
                                </section>
                            )}

                            {/* Category Form */}
                            {(isAdding.type === 'CATEGORY' || isEditing.type === 'CATEGORY') && (
                                <section style={{ padding: '32px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                                        <div style={{ padding: '8px', borderRadius: theme.radius.md, backgroundColor: theme.colors.accent.indigo + '11' }}>
                                            <FolderOpen size={24} style={{ color: theme.colors.accent.indigo }} />
                                        </div>
                                        <div>
                                            <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: theme.colors.text.title }}>
                                                {isEditing.id ? '기기 구분 수정' : '새 구분 등록'}
                                            </h2>
                                            <p style={{ fontSize: '0.875rem', color: theme.colors.text.muted }}>플레이어를 그룹화할 하위 카테고리를 설정합니다.</p>
                                        </div>
                                    </div>
                                    <form onSubmit={isEditing.id ? handleUpdateCategory : handleAddCategory} style={{ display: 'grid', gap: '20px' }}>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: '600', color: theme.colors.text.body }}>구분 명칭</label>
                                            <input type="text" required style={{ width: '100%', padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${theme.colors.border}`, outline: 'none' }} placeholder="예: 가좌점, 1층 로비" value={newCategory.name} onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })} />
                                        </div>
                                        <div style={{ backgroundColor: theme.colors.divider, padding: '12px', borderRadius: theme.radius.md }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                                                <label style={{ fontSize: '0.8rem', fontWeight: '700', color: theme.colors.text.body }}>송출 정책 상속</label>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: theme.colors.accent.indigo, cursor: 'pointer', fontWeight: '600' }}>
                                                    <input type="checkbox" checked={newCategory.total_slots === null} onChange={(e) => {
                                                        if (e.target.checked) setNewCategory({ ...newCategory, total_slots: null, plays_per_slot: null, slot_duration: null });
                                                        else {
                                                            const parent = mediaGroups.find(g => g.id === (isAdding.parentId || newCategory.media_group_id));
                                                            setNewCategory({ ...newCategory, total_slots: parent?.total_slots || 10, plays_per_slot: parent?.plays_per_slot || 100, slot_duration: parent?.slot_duration || 15 });
                                                        }
                                                    }} /> 상위 설정 사용
                                                </label>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                                                <div>
                                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.75rem', color: theme.colors.text.muted, fontWeight: '600' }}>송출 구좌</label>
                                                    <input type="number" disabled={newCategory.total_slots === null} style={{ width: '100%', padding: '10px', borderRadius: theme.radius.sm, border: `1px solid ${theme.colors.border}`, outline: 'none', opacity: newCategory.total_slots === null ? 0.6 : 1, backgroundColor: newCategory.total_slots === null ? 'transparent' : 'white' }}
                                                        placeholder={newCategory.total_slots === null ? (mediaGroups.find(g => g.id === (isAdding.parentId || newCategory.media_group_id))?.total_slots.toString() || '상속') : ''}
                                                        value={newCategory.total_slots ?? ''} onChange={(e) => setNewCategory({ ...newCategory, total_slots: e.target.value ? parseInt(e.target.value) : null })} />
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.75rem', color: theme.colors.text.muted, fontWeight: '600' }}>송출 횟수</label>
                                                    <input type="number" disabled={newCategory.total_slots === null} style={{ width: '100%', padding: '10px', borderRadius: theme.radius.sm, border: `1px solid ${theme.colors.border}`, outline: 'none', opacity: newCategory.total_slots === null ? 0.6 : 1, backgroundColor: newCategory.total_slots === null ? 'transparent' : 'white' }}
                                                        placeholder={newCategory.total_slots === null ? (mediaGroups.find(g => g.id === (isAdding.parentId || newCategory.media_group_id))?.plays_per_slot.toString() || '상속') : ''}
                                                        value={newCategory.plays_per_slot ?? ''} onChange={(e) => setNewCategory({ ...newCategory, plays_per_slot: e.target.value ? parseInt(e.target.value) : null })} />
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.75rem', color: theme.colors.text.muted, fontWeight: '600' }}>슬롯 초수</label>
                                                    <input type="number" disabled={newCategory.total_slots === null} style={{ width: '100%', padding: '10px', borderRadius: theme.radius.sm, border: `1px solid ${theme.colors.border}`, outline: 'none', opacity: newCategory.total_slots === null ? 0.6 : 1, backgroundColor: newCategory.total_slots === null ? 'transparent' : 'white' }}
                                                        placeholder={newCategory.total_slots === null ? (mediaGroups.find(g => g.id === (isAdding.parentId || newCategory.media_group_id))?.slot_duration.toString() || '상속') : ''}
                                                        value={newCategory.slot_duration ?? ''} onChange={(e) => setNewCategory({ ...newCategory, slot_duration: e.target.value ? parseInt(e.target.value) : null })} />
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{ backgroundColor: theme.colors.divider, padding: '12px', borderRadius: theme.radius.md }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                                <label style={{ fontSize: '0.8rem', fontWeight: '700', color: theme.colors.text.body }}>운영 시간 상속</label>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: theme.colors.accent.indigo, cursor: 'pointer', fontWeight: '600' }}>
                                                    <input type="checkbox" checked={!newCategory.op_start_time} onChange={(e) => {
                                                        if (e.target.checked) setNewCategory({ ...newCategory, op_start_time: '', op_end_time: '' });
                                                        else {
                                                            const parent = mediaGroups.find(g => g.id === (isAdding.parentId || newCategory.media_group_id));
                                                            setNewCategory({ ...newCategory, op_start_time: parent?.op_start_time || '08:00:00', op_end_time: parent?.op_end_time || '22:00:00' });
                                                        }
                                                    }} /> 상위 설정 사용
                                                </label>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                                <input type="time" disabled={!newCategory.op_start_time} style={{ width: '100%', padding: '10px', borderRadius: theme.radius.sm, border: `1px solid ${theme.colors.border}`, opacity: !newCategory.op_start_time ? 0.5 : 1, outline: 'none' }} value={newCategory.op_start_time || mediaGroups.find(g => g.id === (isAdding.parentId || newCategory.media_group_id))?.op_start_time || ''} onChange={(e) => setNewCategory({ ...newCategory, op_start_time: e.target.value })} />
                                                <input type="time" disabled={!newCategory.op_end_time} style={{ width: '100%', padding: '10px', borderRadius: theme.radius.sm, border: `1px solid ${theme.colors.border}`, opacity: !newCategory.op_end_time ? 0.5 : 1, outline: 'none' }} value={newCategory.op_end_time || mediaGroups.find(g => g.id === (isAdding.parentId || newCategory.media_group_id))?.op_end_time || ''} onChange={(e) => setNewCategory({ ...newCategory, op_end_time: e.target.value })} />
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                                            <button type="submit" className="btn" style={{ flex: 2, padding: '12px', backgroundColor: theme.colors.accent.indigo, color: 'white', borderRadius: theme.radius.md, fontWeight: '700', border: 'none', cursor: 'pointer' }}>구분 저장</button>
                                            {isEditing.id && (
                                                <button type="button" className="btn" style={{ flex: 1, backgroundColor: 'rgba(239, 68, 68, 0.05)', color: theme.colors.status.danger, border: `1px solid ${theme.colors.status.danger}44`, borderRadius: theme.radius.md, fontWeight: '700', cursor: 'pointer' }} onClick={() => handleDeleteCategory(isEditing.id!)}>삭제</button>
                                            )}
                                            <button type="button" className="btn" style={{ flex: 1, padding: '12px', backgroundColor: theme.colors.divider, color: theme.colors.text.body, borderRadius: theme.radius.md, fontWeight: '700', border: 'none', cursor: 'pointer' }} onClick={() => { setIsAdding({ type: null, parentId: null }); setIsEditing({ type: null, id: null }); }}>취소</button>
                                        </div>
                                    </form>
                                </section>
                            )}

                            {/* Device Form */}
                            {(isAdding.type === 'DEVICE' || isEditing.type === 'DEVICE') && (
                                <section style={{ padding: '32px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                                        <div style={{ padding: '8px', borderRadius: theme.radius.md, backgroundColor: theme.colors.status.success + '11' }}>
                                            <Activity size={24} style={{ color: theme.colors.status.success }} />
                                        </div>
                                        <div>
                                            <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: theme.colors.text.title }}>
                                                {isEditing.id ? '플레이어 정보 수정' : '새 플레이어 등록'}
                                            </h2>
                                            <p style={{ fontSize: '0.875rem', color: theme.colors.text.muted }}>실제 송출 기기를 네트워크에 등록합니다.</p>
                                        </div>
                                    </div>
                                    <form onSubmit={isEditing.id ? handleUpdateDevice : handleAddDevice} style={{ display: 'grid', gap: '16px' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: '600', color: theme.colors.text.body }}>플레이어 명칭</label>
                                                <input type="text" style={{ width: '100%', padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${theme.colors.border}`, outline: 'none' }} placeholder="기기 이름 (예: LOBBY_01)" value={newDevice.name} onChange={(e) => setNewDevice({ ...newDevice, name: e.target.value })} />
                                                {!isEditing.id && <p style={{ fontSize: '0.7rem', color: theme.colors.text.muted, marginTop: '4px' }}>* 대량 등록 시 이름에 &#123;&#125;를 포함하세요 (예: DEVICE_&#123;&#125;)</p>}
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: '600', color: theme.colors.text.body }}>운영체제</label>
                                                <select style={{ width: '100%', padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${theme.colors.border}`, backgroundColor: 'white', outline: 'none' }} value={newDevice.os_type} onChange={(e) => setNewDevice({ ...newDevice, os_type: e.target.value as any })}>
                                                    <option value="Windows">Windows</option>
                                                    <option value="Android">Android</option>
                                                </select>
                                            </div>
                                        </div>

                                        {!isEditing.id && (
                                            <div style={{ padding: '12px', borderRadius: theme.radius.md, backgroundColor: theme.colors.divider, border: `1px solid ${theme.colors.border}` }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', fontWeight: '700', cursor: 'pointer' }}>
                                                        <input type="checkbox" checked={isBulkMode} onChange={(e) => setIsBulkMode(e.target.checked)} /> 대량 등록 설정
                                                    </label>
                                                </div>
                                                {isBulkMode && (
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px' }}>
                                                        <select style={{ padding: '8px', borderRadius: theme.radius.sm, border: `1px solid ${theme.colors.border}`, outline: 'none' }} value={bulkConfig.mode} onChange={(e) => setBulkConfig({ ...bulkConfig, mode: e.target.value as any })}>
                                                            <option value="range">숫자 범위</option>
                                                            <option value="custom">커스텀 리스트</option>
                                                        </select>
                                                        {bulkConfig.mode === 'range' ? (
                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                <input type="number" placeholder="시작" style={{ width: '50%', padding: '8px', borderRadius: theme.radius.sm, border: `1px solid ${theme.colors.border}`, outline: 'none' }} value={bulkConfig.start} onChange={(e) => setBulkConfig({ ...bulkConfig, start: parseInt(e.target.value) || 1 })} />
                                                                <input type="number" placeholder="개수" style={{ width: '50%', padding: '8px', borderRadius: theme.radius.sm, border: `1px solid ${theme.colors.border}`, outline: 'none' }} value={bulkConfig.count} onChange={(e) => setBulkConfig({ ...bulkConfig, count: parseInt(e.target.value) || 1 })} />
                                                            </div>
                                                        ) : (
                                                            <input type="text" placeholder="값 (콤마 구분: 101, 102)" style={{ width: '100%', padding: '8px', borderRadius: theme.radius.sm, border: `1px solid ${theme.colors.border}`, outline: 'none' }} value={bulkConfig.customValues} onChange={(e) => setBulkConfig({ ...bulkConfig, customValues: e.target.value })} />
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div style={{ padding: '16px', borderRadius: theme.radius.md, backgroundColor: theme.colors.primary.light, border: `1px dashed ${theme.colors.primary.border}`, marginBottom: '16px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showPendingSelector ? '16px' : '0' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <Activity size={18} style={{ color: theme.colors.primary.main }} />
                                                    <span style={{ fontSize: '0.875rem', fontWeight: '700', color: theme.colors.text.title }}>Hardware ID 연결</span>
                                                    {newDevice.hardware_id && <span style={{ fontSize: '0.75rem', padding: '2px 6px', backgroundColor: theme.colors.status.success, color: 'white', borderRadius: '4px' }}>연결됨: {newDevice.hardware_id}</span>}
                                                </div>
                                                <button type="button" className="btn" style={{ padding: '6px 12px', backgroundColor: theme.colors.primary.main, color: 'white', borderRadius: theme.radius.sm, fontSize: '0.75rem', fontWeight: '700' }} onClick={() => setShowPendingSelector(!showPendingSelector)}>
                                                    {showPendingSelector ? '닫기' : '대기 플레이어 목록 보기'}
                                                </button>
                                            </div>

                                            {showPendingSelector && (
                                                <div style={{ marginTop: '12px', borderTop: `1px solid ${theme.colors.border}`, paddingTop: '12px' }}>
                                                    {devices.filter(d => !d.category_id).length === 0 ? (
                                                        <p style={{ textAlign: 'center', fontSize: '0.875rem', color: theme.colors.text.muted, padding: '10px' }}>대기 중인 신규 플레이어가 없습니다.</p>
                                                    ) : (
                                                        <div style={{ display: 'grid', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                                                            {devices.filter(d => !d.category_id).map(d => (
                                                                <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', backgroundColor: 'white', borderRadius: theme.radius.sm, border: `1px solid ${theme.colors.border}` }}>
                                                                    <div>
                                                                        <div style={{ fontSize: '0.8125rem', fontWeight: '700' }}>{d.name}</div>
                                                                        <div style={{ fontSize: '0.75rem', color: theme.colors.primary.main, fontFamily: 'monospace' }}>{d.hardware_id}</div>
                                                                    </div>
                                                                    <button type="button" className="btn" style={{ padding: '4px 8px', backgroundColor: theme.colors.status.success, color: 'white', borderRadius: theme.radius.sm, fontSize: '0.7rem' }} onClick={() => {
                                                                        setNewDevice({ ...newDevice, hardware_id: d.hardware_id });
                                                                        setShowPendingSelector(false);
                                                                    }}>이 기기에 연결</button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: '600', color: theme.colors.text.body }}>해상도</label>
                                                <input type="text" style={{ width: '100%', padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${theme.colors.border}`, outline: 'none' }} placeholder="예: 1920x1080" value={newDevice.resolution} onChange={(e) => setNewDevice({ ...newDevice, resolution: e.target.value })} />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: '600', color: theme.colors.text.body }}>Hardware ID (수동 입력)</label>
                                                <input type="text" style={{ width: '100%', padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${theme.colors.border}`, outline: 'none', fontFamily: 'monospace' }} placeholder="기기 식별자 (예: WIN-XXXX)" value={newDevice.hardware_id || ''} onChange={(e) => setNewDevice({ ...newDevice, hardware_id: e.target.value })} />
                                            </div>
                                        </div>

                                        <div style={{ backgroundColor: theme.colors.divider, padding: '12px', borderRadius: theme.radius.md }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                                <label style={{ fontSize: '0.8rem', fontWeight: '700', color: theme.colors.text.body }}>운영 시간 상속</label>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: theme.colors.status.success, cursor: 'pointer', fontWeight: '600' }}>
                                                    <input type="checkbox" checked={!newDevice.op_start_time} onChange={(e) => {
                                                        if (e.target.checked) setNewDevice({ ...newDevice, op_start_time: '', op_end_time: '' });
                                                        else {
                                                            const cat = categories.find(c => c.id === (isAdding.parentId || newDevice.category_id));
                                                            const group = mediaGroups.find(g => g.id === cat?.media_group_id);
                                                            setNewDevice({ ...newDevice, op_start_time: cat?.op_start_time || group?.op_start_time || '08:00:00', op_end_time: cat?.op_end_time || group?.op_end_time || '22:00:00' });
                                                        }
                                                    }} /> 상위 설정 사용
                                                </label>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                                <input type="time" disabled={!newDevice.op_start_time} style={{ width: '100%', padding: '10px', borderRadius: theme.radius.sm, border: `1px solid ${theme.colors.border}`, opacity: !newDevice.op_start_time ? 0.5 : 1, outline: 'none' }} value={newDevice.op_start_time || categories.find(c => c.id === (isAdding.parentId || newDevice.category_id))?.op_start_time || mediaGroups.find(g => g.id === categories.find(c => c.id === (isAdding.parentId || newDevice.category_id))?.media_group_id)?.op_start_time || ''} onChange={(e) => setNewDevice({ ...newDevice, op_start_time: e.target.value })} />
                                                <input type="time" disabled={!newDevice.op_end_time} style={{ width: '100%', padding: '10px', borderRadius: theme.radius.sm, border: `1px solid ${theme.colors.border}`, opacity: !newDevice.op_end_time ? 0.5 : 1, outline: 'none' }} value={newDevice.op_end_time || categories.find(c => c.id === (isAdding.parentId || newDevice.category_id))?.op_end_time || mediaGroups.find(g => g.id === categories.find(c => c.id === (isAdding.parentId || newDevice.category_id))?.media_group_id)?.op_end_time || ''} onChange={(e) => setNewDevice({ ...newDevice, op_end_time: e.target.value })} />
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                                            <button type="submit" className="btn" style={{ flex: 1, padding: '12px', backgroundColor: theme.colors.primary.main, color: 'white', borderRadius: theme.radius.md, fontWeight: '700', border: 'none', cursor: 'pointer' }}>{isEditing.id ? '수정 완료' : '플레이어 등록'}</button>
                                            <button type="button" className="btn" style={{ flex: 1, padding: '12px', backgroundColor: theme.colors.divider, color: theme.colors.text.body, borderRadius: theme.radius.md, fontWeight: '700', border: 'none', cursor: 'pointer' }} onClick={() => { setIsAdding({ type: null, parentId: null }); setIsEditing({ type: null, id: null }); }}>취소</button>
                                        </div>
                                    </form>
                                </section>
                            )}
                        </div>
                    </div>
                )}

                <div style={{ display: 'grid', gap: '48px', paddingBottom: '40px' }}>
                    {loading ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '100px 0', gap: '16px' }}>
                            <RefreshCw size={32} className="animate-spin" style={{ color: theme.colors.primary.main }} />
                            <p style={{ color: theme.colors.text.muted, fontSize: '1rem', fontWeight: '600' }}>데이터를 불러오는 중입니다...</p>
                        </div>
                    ) : (
                        <>
                            {mediaGroups.length === 0 ? (
                                <div style={{ padding: '80px', textAlign: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, border: `1px dashed ${theme.colors.border}` }}>
                                    <Monitor size={48} style={{ color: theme.colors.text.muted, marginBottom: '16px', opacity: 0.5 }} />
                                    <p style={{ color: theme.colors.text.muted, fontSize: '1.125rem' }}>등록된 매체가 없습니다. 상단 버튼을 통해 매체를 먼저 등록해 주세요.</p>
                                </div>
                            ) : (
                                mediaGroups.map(group => (
                                    <div key={group.id} style={{ display: 'grid', gap: '24px' }}>
                                        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', paddingBottom: '16px', borderBottom: `2px solid ${theme.colors.divider}` }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                                <div style={{ backgroundColor: theme.colors.primary.main, width: '6px', height: '32px', borderRadius: '3px' }} />
                                                <div>
                                                    <h2 style={{ fontSize: '1.75rem', fontWeight: '900', color: theme.colors.text.title, lineHeight: 1.2 }}>{group.name}</h2>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
                                                        <span style={{ fontSize: '0.875rem', color: theme.colors.text.muted, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <Settings size={14} /> 기본 정책: {group.total_slots}구좌 / {group.plays_per_slot}회 / {group.slot_duration}초
                                                        </span>
                                                        <span style={{ fontSize: '0.875rem', fontWeight: '700', color: (group.idle_time || 0) > 0 ? theme.colors.accent.amber : theme.colors.status.success, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <Activity size={14} /> 유휴: {(group.idle_time || 0) >= 60 ? `${Math.floor(Math.abs(group.idle_time || 0) / 60)}분 ${Math.abs(group.idle_time || 0) % 60}초` : `${group.idle_time || 0}초`}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button className="btn" style={{ padding: '8px 16px', backgroundColor: theme.colors.divider, color: theme.colors.text.body, borderRadius: theme.radius.md, fontSize: '0.875rem', fontWeight: '700' }} onClick={() => startEditGroup(group)}>매체 수정</button>
                                                <button className="btn" style={{ padding: '8px 16px', backgroundColor: theme.colors.primary.light, color: theme.colors.primary.hover, borderRadius: theme.radius.md, fontSize: '0.875rem', fontWeight: '700', border: `1px solid ${theme.colors.primary.main}44` }} onClick={() => setIsAdding({ type: 'CATEGORY', parentId: group.id })}>
                                                    <Plus size={16} /> 구분 추가
                                                </button>
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gap: '24px' }}>
                                            {categories.filter(c => c.media_group_id === group.id).map(category => (
                                                <div key={category.id} style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, border: `1px solid ${theme.colors.border}`, boxShadow: theme.shadows.sm, overflow: 'hidden' }}>
                                                    <div style={{ padding: '20px 24px', backgroundColor: '#fcfdfe', borderBottom: `1px solid ${theme.colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                            <FolderOpen size={20} style={{ color: theme.colors.accent.indigo }} />
                                                            <h3 style={{ fontSize: '1.125rem', fontWeight: '800', color: theme.colors.text.title }}>{category.name}</h3>
                                                            <div style={{ display: 'flex', gap: '8px', marginLeft: '8px' }}>
                                                                <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px', backgroundColor: theme.colors.divider, color: theme.colors.text.muted, fontWeight: '600' }}>
                                                                    {category.total_slots ?? group.total_slots}구좌 / {category.plays_per_slot ?? group.plays_per_slot}회
                                                                </span>
                                                                <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px', backgroundColor: (category.idle_time || 0) > 0 ? '#fffbeb' : '#f0fdf4', color: (category.idle_time || 0) > 0 ? theme.colors.accent.amber : theme.colors.status.success, fontWeight: '700', border: `1px solid ${(category.idle_time || 0) > 0 ? '#fde68a' : '#bbf7d0'}` }}>
                                                                    유휴: {(category.idle_time || 0) >= 60 ? `${Math.floor(Math.abs(category.idle_time || 0) / 60)}분 ${Math.abs(category.idle_time || 0) % 60}초` : `${category.idle_time || 0}초`}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '8px' }}>
                                                            <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8125rem', fontWeight: '600', color: theme.colors.text.muted }} onClick={() => startEditCategory(category)}>구분 수정</button>
                                                            <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8125rem', fontWeight: '700', backgroundColor: theme.colors.status.success, color: 'white', borderRadius: theme.radius.md }} onClick={() => setIsAdding({ type: 'DEVICE', parentId: category.id })}>기기 등록</button>
                                                        </div>
                                                    </div>

                                                    <div style={{ width: '100%', overflowX: 'auto' }}>
                                                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                            <thead>
                                                                <tr style={{ backgroundColor: theme.colors.background, borderBottom: `1px solid ${theme.colors.border}` }}>
                                                                    <th style={{ padding: '12px 24px', textAlign: 'left', fontSize: '0.8125rem', color: theme.colors.text.muted, fontWeight: '700', cursor: 'pointer' }} onClick={() => handleSort('name')}>
                                                                        플레이어 <SortIcon sortKey="name" />
                                                                    </th>
                                                                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '0.8125rem', color: theme.colors.text.muted, fontWeight: '700' }}>
                                                                        Hardware ID
                                                                    </th>
                                                                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '0.8125rem', color: theme.colors.text.muted, fontWeight: '700', cursor: 'pointer' }} onClick={() => handleSort('status')}>
                                                                        상태 <SortIcon sortKey="status" />
                                                                    </th>
                                                                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '0.8125rem', color: theme.colors.text.muted, fontWeight: '700', cursor: 'pointer' }} onClick={() => handleSort('os_type')}>
                                                                        OS <SortIcon sortKey="os_type" />
                                                                    </th>
                                                                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '0.8125rem', color: theme.colors.text.muted, fontWeight: '700', cursor: 'pointer' }} onClick={() => handleSort('op_time')}>
                                                                        운영시간 <SortIcon sortKey="op_time" />
                                                                    </th>
                                                                    <th style={{ padding: '12px 24px', textAlign: 'right', fontSize: '0.8125rem', color: theme.colors.text.muted, fontWeight: '700' }}>
                                                                        관리
                                                                    </th>
                                                                </tr>
                                                            </thead>
                                                            <tbody style={{ fontSize: '0.875rem' }}>
                                                                {sortedDevices(devices.filter(d => d.category_id === category.id)).length === 0 ? (
                                                                    <tr>
                                                                        <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: theme.colors.text.muted }}>등록된 플레이어가 없습니다.</td>
                                                                    </tr>
                                                                ) : (
                                                                    sortedDevices(devices.filter(d => d.category_id === category.id)).map(device => (
                                                                        <tr key={device.id} style={{ borderBottom: `1px solid ${theme.colors.divider}`, transition: 'background 0.2s' }} className="hover-row">
                                                                            <td style={{ padding: '14px 24px' }}>
                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                                                    <div style={{ padding: '6px', borderRadius: '6px', backgroundColor: theme.colors.background }}>
                                                                                        <Monitor size={14} style={{ color: theme.colors.text.body }} />
                                                                                    </div>
                                                                                    <span style={{ fontWeight: '700', color: theme.colors.text.title }}>{device.name}</span>
                                                                                </div>
                                                                            </td>
                                                                            <td style={{ padding: '14px 16px', fontFamily: 'monospace', fontSize: '0.8rem', color: '#64748b' }}>
                                                                                {device.hardware_id || '-'}
                                                                            </td>
                                                                            <td style={{ padding: '14px 16px' }}>
                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: device.status === 'online' ? theme.colors.status.success : theme.colors.status.danger }} />
                                                                                    <span style={{ fontSize: '0.75rem', fontWeight: '800', color: device.status === 'online' ? theme.colors.status.success : theme.colors.status.danger, textTransform: 'uppercase' }}>{device.status}</span>
                                                                                </div>
                                                                            </td>
                                                                            <td style={{ padding: '14px 16px' }}>
                                                                                <span style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px', backgroundColor: device.os_type === 'Windows' ? '#e0f2fe' : '#f0fdf4', color: device.os_type === 'Windows' ? '#0369a1' : '#15803d', fontWeight: '700' }}>{device.os_type}</span>
                                                                            </td>
                                                                            <td style={{ padding: '14px 16px', color: theme.colors.text.body, fontWeight: '600', fontSize: '0.8125rem' }}>
                                                                                {(device.op_start_time || category.op_start_time || group.op_start_time || '00:00:00').substring(0, 5)} ~ {(device.op_end_time || category.op_end_time || group.op_end_time || '00:00:00').substring(0, 5)}
                                                                                {!device.op_start_time && <span style={{ marginLeft: '4px', fontSize: '0.7rem', color: theme.colors.text.muted }}>(상속)</span>}
                                                                            </td>
                                                                            <td style={{ padding: '14px 24px', textAlign: 'right' }}>
                                                                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                                                    <button className="btn" style={{ padding: '6px', backgroundColor: theme.colors.divider, borderRadius: '6px' }} title="정보 수정" onClick={() => startEditDevice(device)}>
                                                                                        <Settings size={14} style={{ color: theme.colors.text.body }} />
                                                                                    </button>
                                                                                    <button className="btn" style={{ padding: '6px', backgroundColor: 'rgba(239, 68, 68, 0.05)', borderRadius: '6px', border: `1px solid ${theme.colors.status.danger}22` }} title="기기 삭제" onClick={() => handleDeleteDevice(device.id)}>
                                                                                        <Trash2 size={14} style={{ color: theme.colors.status.danger }} />
                                                                                    </button>
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    ))
                                                                )}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))
                            )}
                        </>
                    )}
                </div>
            </div>

            <style jsx global>{`
                .btn:hover { transform: translateY(-1px); box-shadow: ${theme.shadows.md}; }
                .btn:active { transform: translateY(0); }
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                .animate-spin { animation: spin 2s linear infinite; }
                
                @keyframes toast-in {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
            `}</style>

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
                            toast.type === 'error' ? <AlertCircle size={18} /> : <Activity size={18} />}
                        {toast.message}
                    </div>
                ))}
            </div>
        </main>
    );
}
