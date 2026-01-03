'use client';

import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import {
    LayoutList, ArrowLeft, RefreshCw, Printer, Download,
    Search, Filter, Monitor, Tag, Film, CheckCircle2,
    Calendar, Clock, Building2, FolderOpen, ChevronRight,
    AlertCircle
} from 'lucide-react';
import Link from 'next/link';

// Design System Tokens (통일된 디자인)
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
    }
};

interface Brand {
    id: string;
    name: string;
}

interface Media {
    id: string;
    title: string;
    brand_id: string;
    product_name?: string;
    duration: number;
    brands?: Brand;
}

interface Schedule {
    id: string;
    device_id: string;
    slot_no: number;
    media_id: string;
    medias: Media;
}

interface Device {
    id: string;
    name: string;
    category_id: string;
    resolution?: string;
}

interface DeviceCategory {
    id: string;
    name: string;
    media_group_id: string;
    total_slots: number | null;
    plays_per_slot: number | null;
    slot_duration: number | null;
    op_start_time: string | null;
    op_end_time: string | null;
}

interface MediaGroup {
    id: string;
    name: string;
    total_slots: number;
    plays_per_slot: number;
    slot_duration: number;
    op_start_time: string;
    op_end_time: string;
}

export default function TimetablePage() {
    const [mediaGroups, setMediaGroups] = useState<MediaGroup[]>([]);
    const [categories, setCategories] = useState<DeviceCategory[]>([]);
    const [devices, setDevices] = useState<Device[]>([]);
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState<'matrix' | 'timeline'>('matrix');
    const [selectedDeviceIdForTimeline, setSelectedDeviceIdForTimeline] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedGroupId, setSelectedGroupId] = useState('');
    const [selectedCategoryId, setSelectedCategoryId] = useState('');
    const [timeRange, setTimeRange] = useState<'00-24' | '00-06' | '06-12' | '12-18' | '18-24'>('00-24');

    const fetchData = async () => {
        setLoading(true);
        const { data: mg } = await supabase.from('media_groups').select('*').order('name');
        if (mg) setMediaGroups(mg);

        const { data: ct } = await supabase.from('device_categories').select('*').order('name');
        if (ct) setCategories(ct);

        const { data: dv } = await supabase.from('devices').select('*').order('name');
        if (dv) setDevices(dv);

        const { data: sc } = await supabase
            .from('schedules')
            .select('*, medias(*, brands(id, name))');
        if (sc) setSchedules(sc as any);

        setLoading(false);
    };

    useEffect(() => {
        fetchData();
    }, []);

    const filteredDevices = useMemo(() => {
        return devices.filter(d => {
            const matchesSearch = d.name.toLowerCase().includes(searchTerm.toLowerCase());
            const category = categories.find(c => c.id === d.category_id);
            const matchesGroup = !selectedGroupId || category?.media_group_id === selectedGroupId;
            const matchesCategory = !selectedCategoryId || d.category_id === selectedCategoryId;
            return matchesSearch && matchesGroup && matchesCategory;
        });
    }, [devices, searchTerm, selectedGroupId, selectedCategoryId, categories]);

    // 스케줄 데이터를 [device_id][slot_no] 형태로 인덱싱하여 조회 성능 최적화
    const indexedSchedules = useMemo(() => {
        const map = new Map<string, Map<number, Schedule[]>>();
        schedules.forEach(s => {
            if (!map.has(s.device_id)) map.set(s.device_id, new Map());
            const deviceMap = map.get(s.device_id)!;
            if (!deviceMap.has(s.slot_no)) deviceMap.set(s.slot_no, []);
            deviceMap.get(s.slot_no)!.push(s);
        });
        return map;
    }, [schedules]);

    const calculateTimeSeconds = (start: string, end: string) => {
        if (!start || !end) return 0;
        const [h1, m1, s1] = start.split(':').map(Number);
        let [h2, m2, s2] = end.split(':').map(Number);
        const t1 = h1 * 3600 + (m1 || 0) * 60 + (s1 || 0);
        let t2 = h2 * 3600 + (m2 || 0) * 60 + (s2 || 0);
        if (t2 <= t1) t2 += 24 * 3600;
        return t2 - t1;
    };

    const formatSecondsToTime = (totalSeconds: number) => {
        const hrs = Math.floor((totalSeconds % 86400) / 3600);
        const mins = Math.floor((totalSeconds % 3600) / 60);
        const secs = totalSeconds % 60;
        return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    };

    const getDeviceParams = (device: Device) => {
        const cat = categories.find(c => c.id === device.category_id);
        const grp = mediaGroups.find(g => g.id === cat?.media_group_id);

        const start = cat?.op_start_time || grp?.op_start_time || '08:00:00';
        const end = cat?.op_end_time || grp?.op_end_time || '22:00:00';
        const totalSlots = cat?.total_slots ?? grp?.total_slots ?? 10;
        const policyPlays = cat?.plays_per_slot ?? grp?.plays_per_slot ?? 100;
        const defaultSlotDuration = cat?.slot_duration ?? grp?.slot_duration ?? 15;

        const opSeconds = calculateTimeSeconds(start, end);

        const slotData = [];
        let totalCycleSeconds = 0;
        const deviceSchedMap = indexedSchedules.get(device.id);

        for (let i = 1; i <= totalSlots; i++) {
            const scheds = deviceSchedMap?.get(i) || [];

            // 구좌 구매/할당 시간 결정
            const totalMediasDuration = scheds.reduce((sum, s) => sum + (s.medias?.duration || 0), 0);
            const slotEffectiveDuration = Math.max(defaultSlotDuration, totalMediasDuration);

            const analyzedScheds = scheds.map(s => {
                const mediaCount = scheds.length;
                // 구좌 자유 시간(Budget)을 소재 수로 분할하여 목표 횟수 산출
                const mBudgetTotal = (slotEffectiveDuration * policyPlays);
                const mBudgetPerMedia = mBudgetTotal / mediaCount;
                const targetPlays = Math.floor(mBudgetPerMedia / (s.medias?.duration || defaultSlotDuration));

                // 1개 사이클(한 바퀴)에 송출되어야 할 이상적인 횟수 (예: 15s소재가 30s구좌에 있으면 2.0회)
                const playsPerCycle = (slotEffectiveDuration / mediaCount) / (s.medias?.duration || defaultSlotDuration);

                return { ...s, targetPlays, mBudget: mBudgetPerMedia, playsPerCycle };
            });

            totalCycleSeconds += slotEffectiveDuration;
            slotData.push({
                no: i,
                scheds: analyzedScheds,
                avgDuration: slotEffectiveDuration,
                totalSlotDuration: totalMediasDuration,
                budgetPerCycle: slotEffectiveDuration
            });
        }

        const expectedCycles = totalCycleSeconds > 0 ? Math.floor(opSeconds / totalCycleSeconds) : 0;
        const isPolicyMet = expectedCycles >= policyPlays;

        let deficitReason = '';
        if (!isPolicyMet) {
            const requiredOpTime = totalCycleSeconds * policyPlays;
            if (opSeconds < requiredOpTime) {
                deficitReason = `운영 시간 부족 (필요: ${Math.ceil(requiredOpTime / 3600)}시간)`;
            } else {
                deficitReason = '평균 슬롯 시간 초과';
            }
        }

        return {
            start, end, opSeconds, totalSlots, policyPlays,
            defaultSlotDuration, totalCycleSeconds, expectedCycles,
            isPolicyMet, deficitReason, slotData,
            filledSlots: slotData.filter(s => s.scheds.length > 0).length
        };
    };

    // 모든 필터링된 기기의 파라미터를 메모이제이션 (성능 최적화의 핵심)
    const allDeviceParams = useMemo(() => {
        const map = new Map();
        filteredDevices.forEach(d => {
            map.set(d.id, getDeviceParams(d));
        });
        return map;
    }, [filteredDevices, categories, mediaGroups, indexedSchedules]);

    // 구좌 수 결정 (필터링된 기기 중 최대 구좌 수 또는 첫 번째 기기 기준)
    const maxSlots = useMemo(() => {
        if (filteredDevices.length === 0) return 0;
        let max = 0;
        filteredDevices.forEach(d => {
            const params = allDeviceParams.get(d.id);
            if (params && params.totalSlots > max) max = params.totalSlots;
        });
        return max;
    }, [filteredDevices, allDeviceParams]);

    // 특정 구좌에 대한 브랜드 일관성 체크 (이종 소재 혼입)
    const checkBrandInconsistency = (slotNo: number) => {
        if (filteredDevices.length <= 1) return false;

        const deviceBrandSets = filteredDevices.map(d => {
            const params = allDeviceParams.get(d.id);
            const slot = params?.slotData.find((s: any) => s.no === slotNo);
            const brands = (slot?.scheds || [])
                .map((s: any) => s.medias?.brand_id || 'no-brand')
                .sort();
            return JSON.stringify(brands);
        });

        const firstSet = deviceBrandSets[0];
        return !deviceBrandSets.every(set => set === firstSet);
    };

    // 매트릭스 로우별 브랜드 불일치 체크
    const isRowInconsistent = (rowIndex: number) => {
        const deviceBrandSets = filteredDevices.map(d => matrixCycleData.get(d.id)?.[rowIndex]?.sched?.medias?.brand_id).filter(Boolean);
        if (deviceBrandSets.length <= 1) return false;
        const firstSet = deviceBrandSets[0];
        return !deviceBrandSets.every(set => set === firstSet);
    };

    // 매트릭스 뷰 전용: 순차 교차(Interleaved) 및 다중 스윕(Multiple Sweeps) 방식의 시뮬레이션
    const matrixCycleData = useMemo(() => {
        const map = new Map<string, any[]>();

        filteredDevices.forEach(d => {
            const params = allDeviceParams.get(d.id);
            if (!params) return;

            const sequence: any[] = [];
            const pointers = params.slotData.map((slot: any) => ({
                counts: slot.scheds.map(() => 0)
            }));

            const basePolicy = params.policyPlays || 1;
            const activeSlots = params.slotData.filter((s: any) => s.scheds.length > 0);
            const idleSlots = params.slotData.filter((s: any) => s.scheds.length === 0);

            // 1. 활성 구좌(소재 있음) 시뮬레이션: 목표 달성 시까지 순차 교차
            for (let cycle = 0; cycle < basePolicy; cycle++) {
                let sweepCount = 0;
                let anyPlayedInThisSweep = true;

                while (anyPlayedInThisSweep && sweepCount < 10) {
                    anyPlayedInThisSweep = false;
                    activeSlots.forEach((slot: any) => {
                        const sIdx = params.slotData.indexOf(slot);
                        const pointer = pointers[sIdx];

                        let bestIdx = -1;
                        let minRatio = Infinity;

                        for (let mIdx = 0; mIdx < slot.scheds.length; mIdx++) {
                            const targetPerCycle = (slot.scheds[mIdx] as any).playsPerCycle || 1;
                            const currentCount = pointer.counts[mIdx];

                            if (currentCount < (cycle + 1) * targetPerCycle) {
                                const ratio = currentCount / ((cycle + 1) * targetPerCycle);
                                if (ratio < minRatio) {
                                    minRatio = ratio;
                                    bestIdx = mIdx;
                                }
                            }
                        }

                        if (bestIdx !== -1) {
                            anyPlayedInThisSweep = true;
                            const sched = slot.scheds[bestIdx];
                            const dur = Math.max(sched.medias?.duration || 0, 1);
                            sequence.push({
                                slotNo: slot.no,
                                sched,
                                duration: dur,
                                cycleNo: cycle + 1
                            });
                            pointer.counts[bestIdx]++;
                        }
                    });
                    sweepCount++;
                    if (sequence.length > 3000) break;
                }
                if (sequence.length > 3000) break;
            }

            // 2. 빈 구좌(Idle)는 마지막에 한 번씩만 추가 (사용자 요청: 마지막 송출 뒤로 미룸)
            idleSlots.forEach((slot: any) => {
                sequence.push({
                    slotNo: slot.no,
                    sched: null,
                    duration: params.defaultSlotDuration,
                    cycleNo: 1
                });
            });
            map.set(d.id, sequence);
        });
        return map;
    }, [filteredDevices, allDeviceParams]);

    const maxCycleRows = useMemo(() => {
        let max = 0;
        matrixCycleData.forEach(seq => {
            if (seq.length > max) max = seq.length;
        });
        // 성능 및 인지 한계를 고려하여 매트릭스 뷰 최대 300줄 정도로 제한
        return Math.min(max, 300);
    }, [matrixCycleData]);

    // 타임라인 생성 데이터 (매트릭스와 동일한 다중 스윕 로직 적용)
    const timelineData = useMemo(() => {
        if (viewMode !== 'timeline' || !selectedDeviceIdForTimeline) return [];
        const device = devices.find(d => d.id === selectedDeviceIdForTimeline);
        if (!device) return [];

        const params = allDeviceParams.get(device.id);
        if (!params) return [];

        const [h, m, s] = params.start.split(':').map(Number);
        let currentTime = h * 3600 + m * 60 + s;
        const endTimeSeconds = currentTime + params.opSeconds;

        const list = [];
        let safeguard = 0;

        const slotPointers = params.slotData.map((slot: any) => ({
            counts: slot.scheds.map(() => 0)
        }));

        const activeSlots = params.slotData.filter((s: any) => s.scheds.length > 0);
        const idleSlots = params.slotData.filter((s: any) => s.scheds.length === 0);
        let cycleIdx = 0;

        while (currentTime < endTimeSeconds && safeguard < 100000) {
            // 시간대 필터링 적용
            const [rangeStartH, rangeEndH] = timeRange === '00-24' ? [0, 24] : timeRange.split('-').map(Number);
            const currentHour = Math.floor((currentTime % 86400) / 3600);
            const isInRange = currentHour >= rangeStartH && currentHour < rangeEndH;

            // 모든 활성 구좌의 목표 송출 횟수가 달성되었는지 확인
            const allTargetsMet = activeSlots.every((slot: any) => {
                const sIdx = params.slotData.indexOf(slot);
                const pointer = slotPointers[sIdx];
                return slot.scheds.every((s: any, mIdx: number) => pointer.counts[mIdx] >= (s.targetPlays || 0));
            });

            if (allTargetsMet) break; // 사용자 요청: 보장횟수 달성 시 송출 중단

            let anyPlayedInCycle = false;
            let sweepCount = 0;

            while (sweepCount < 10 && currentTime < endTimeSeconds) {
                let playedInSweep = false;

                for (let i = 0; i < activeSlots.length; i++) {
                    if (currentTime >= endTimeSeconds) break;

                    const slot = activeSlots[i];
                    const sIdx = params.slotData.indexOf(slot);
                    const pointer = slotPointers[sIdx];

                    let bestSchedIndex = -1;
                    let minRatio = Infinity;

                    for (let mIdx = 0; mIdx < slot.scheds.length; mIdx++) {
                        const targetPerCycle = (slot.scheds[mIdx] as any).playsPerCycle || 1;
                        const currentCount = pointer.counts[mIdx];

                        if (currentCount < (cycleIdx + 1) * targetPerCycle) {
                            const ratio = currentCount / ((cycleIdx + 1) * targetPerCycle);
                            if (ratio < minRatio) {
                                minRatio = ratio;
                                bestSchedIndex = mIdx;
                            }
                        }
                    }

                    if (bestSchedIndex !== -1) {
                        const sched = slot.scheds[bestSchedIndex];
                        const duration = Math.max(sched.medias?.duration || 0, 1);

                        if (isInRange) {
                            list.push({
                                time: formatSecondsToTime(currentTime),
                                slotNo: slot.no,
                                title: sched.medias?.product_name || sched.medias?.title,
                                brand: sched.medias?.brands?.name || '공용',
                                duration: duration,
                                type: 'content',
                                currentCount: pointer.counts[bestSchedIndex] + 1,
                                targetCount: (sched as any).targetPlays || 0
                            });
                        }

                        currentTime += duration;
                        pointer.counts[bestSchedIndex]++;
                        playedInSweep = true;
                        anyPlayedInCycle = true;
                    }
                }
                if (!playedInSweep) break;
                sweepCount++;
            }

            if (!anyPlayedInCycle) break;
            cycleIdx++;
            safeguard++;
        }

        // 마지막 재생 종료 후 빈 구좌들을 목록 끝에 한 번만 표시 (사용자 요청: 마지막 송출 뒤로 미룸)
        if (currentTime < endTimeSeconds && list.length > 0) {
            const [rangeStartH, rangeEndH] = timeRange === '00-24' ? [0, 24] : timeRange.split('-').map(Number);
            const currentHour = Math.floor((currentTime % 86400) / 3600);
            const isInRange = currentHour >= rangeStartH && currentHour < rangeEndH;

            if (isInRange) {
                idleSlots.forEach((slot: any) => {
                    list.push({
                        time: formatSecondsToTime(currentTime),
                        slotNo: slot.no,
                        title: '- 빈 구좌 (Idle) -',
                        brand: '-',
                        duration: params.defaultSlotDuration,
                        type: 'idle'
                    });
                });
            }
        }
        return list;
    }, [viewMode, selectedDeviceIdForTimeline, devices, schedules, categories, mediaGroups, allDeviceParams, timeRange]);

    return (
        <main style={{ backgroundColor: theme.colors.background, minHeight: '100vh', padding: '40px 20px' }}>
            <div style={{ maxWidth: '100%', margin: '0 auto' }}>
                <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                        <Link href="/schedules" style={{
                            width: '40px', height: '40px', borderRadius: theme.radius.md,
                            backgroundColor: theme.colors.surface, border: `1px solid ${theme.colors.border}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.colors.text.body,
                            boxShadow: theme.shadows.sm, textDecoration: 'none'
                        }}>
                            <ArrowLeft size={20} />
                        </Link>
                        <div>
                            <h1 style={{ fontSize: '1.875rem', fontWeight: '800', color: theme.colors.text.title, letterSpacing: '-0.025em' }}>편성 보고서 (Report)</h1>
                            <p style={{ color: theme.colors.text.muted, fontSize: '0.875rem', marginTop: '2px' }}>롤링 상태 분석 및 시간별 타임라인 상세 조회</p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button onClick={fetchData} style={{
                            padding: '10px 16px', borderRadius: theme.radius.md,
                            backgroundColor: theme.colors.surface, border: `1px solid ${theme.colors.border}`,
                            color: theme.colors.text.body, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px'
                        }}>
                            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                            새로고침
                        </button>
                        <button onClick={() => window.print()} style={{
                            padding: '10px 16px', borderRadius: theme.radius.md,
                            backgroundColor: theme.colors.primary.main, border: 'none',
                            color: 'white', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px'
                        }}>
                            <Printer size={18} />
                            인쇄하기
                        </button>
                    </div>
                </header>

                <div style={{ marginBottom: '24px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: '16px', flex: '1' }}>
                        <div style={{ position: 'relative', flex: '1', maxWidth: '400px' }}>
                            <Search size={18} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: theme.colors.text.muted }} />
                            <input
                                type="text"
                                placeholder="기기 명칭 검색.."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                style={{
                                    width: '100%', padding: '12px 12px 12px 48px', borderRadius: theme.radius.md,
                                    border: `1px solid ${theme.colors.border}`, outline: 'none', backgroundColor: theme.colors.surface,
                                    fontSize: '0.9rem', boxShadow: theme.shadows.sm
                                }}
                            />
                        </div>

                        <div style={{ display: 'flex', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: theme.colors.surface, padding: '0 12px', borderRadius: theme.radius.md, border: `1px solid ${theme.colors.border}`, boxShadow: theme.shadows.sm }}>
                                <FolderOpen size={16} color={theme.colors.text.muted} />
                                <select
                                    value={selectedGroupId}
                                    onChange={(e) => {
                                        setSelectedGroupId(e.target.value);
                                        setSelectedCategoryId('');
                                    }}
                                    style={{ border: 'none', padding: '10px 0', outline: 'none', background: 'transparent', fontSize: '0.85rem', fontWeight: '700', color: theme.colors.text.title }}
                                >
                                    <option value="">모든 매체</option>
                                    {mediaGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                                </select>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: theme.colors.surface, padding: '0 12px', borderRadius: theme.radius.md, border: `1px solid ${theme.colors.border}`, boxShadow: theme.shadows.sm }}>
                                <Tag size={16} color={theme.colors.text.muted} />
                                <select
                                    value={selectedCategoryId}
                                    onChange={(e) => setSelectedCategoryId(e.target.value)}
                                    style={{ border: 'none', padding: '10px 0', outline: 'none', background: 'transparent', fontSize: '0.85rem', fontWeight: '700', color: theme.colors.text.title }}
                                >
                                    <option value="">모든 구분</option>
                                    {categories
                                        .filter(c => !selectedGroupId || c.media_group_id === selectedGroupId)
                                        .map(c => <option key={c.id} value={c.id}>{c.name}</option>)
                                    }
                                </select>
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', background: '#f1f5f9', padding: '4px', borderRadius: theme.radius.md }}>
                        <button
                            onClick={() => setViewMode('matrix')}
                            style={{
                                padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                                fontSize: '0.85rem', fontWeight: '700',
                                backgroundColor: viewMode === 'matrix' ? 'white' : 'transparent',
                                color: viewMode === 'matrix' ? theme.colors.primary.main : theme.colors.text.muted,
                                boxShadow: viewMode === 'matrix' ? theme.shadows.sm : 'none'
                            }}
                        >
                            매트릭스 편성표
                        </button>
                        <button
                            onClick={() => {
                                setViewMode('timeline');
                                if (!selectedDeviceIdForTimeline && filteredDevices.length > 0) {
                                    setSelectedDeviceIdForTimeline(filteredDevices[0].id);
                                }
                            }}
                            style={{
                                padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                                fontSize: '0.85rem', fontWeight: '700',
                                backgroundColor: viewMode === 'timeline' ? 'white' : 'transparent',
                                color: viewMode === 'timeline' ? theme.colors.primary.main : theme.colors.text.muted,
                                boxShadow: viewMode === 'timeline' ? theme.shadows.sm : 'none'
                            }}
                        >
                            시간별 타임라인
                        </button>
                    </div>
                </div>

                {loading ? (
                    <div style={{ padding: '60px', textAlign: 'center', color: theme.colors.text.muted }}>
                        <RefreshCw size={48} className="animate-spin" style={{ marginBottom: '16px', opacity: 0.3 }} />
                        <p>편성 데이터를 분석 중입니다...</p>
                    </div>
                ) : filteredDevices.length === 0 ? (
                    <div style={{ padding: '80px', textAlign: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, border: `1px solid ${theme.colors.border}` }}>
                        <Search size={48} style={{ color: theme.colors.divider, marginBottom: '16px' }} />
                        <p style={{ color: theme.colors.text.muted }}>검색 결과가 없습니다.</p>
                    </div>
                ) : (
                    <>
                        {/* 롤링 분석 요약 대시보드 */}
                        <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', marginBottom: '24px', paddingBottom: '8px' }}>
                            {filteredDevices.map(device => {
                                const params = allDeviceParams.get(device.id);
                                if (!params) return null;
                                return (
                                    <div key={device.id} style={{
                                        flex: '0 0 280px', padding: '16px', backgroundColor: theme.colors.surface,
                                        borderRadius: theme.radius.md, border: `1px solid ${params.isPolicyMet ? theme.colors.border : theme.colors.status.danger + '40'}`,
                                        boxShadow: theme.shadows.sm,
                                        position: 'relative'
                                    }}>
                                        <div style={{ fontSize: '0.7rem', color: theme.colors.text.muted, marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontWeight: '700' }}>{device.name}</span>
                                            <span style={{
                                                fontSize: '0.65rem',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                backgroundColor: params.isPolicyMet ? theme.colors.status.success + '15' : theme.colors.status.danger + '15',
                                                color: params.isPolicyMet ? theme.colors.status.success : theme.colors.status.danger,
                                                fontWeight: '900'
                                            }}>
                                                {params.isPolicyMet ? '정책 충족' : '보장 미달'}
                                            </span>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                            <div>
                                                <div style={{ fontSize: '0.6rem', color: theme.colors.text.muted }}>운영 시간</div>
                                                <div style={{ fontSize: '0.8rem', fontWeight: '800' }}>{params.start}~{params.end}</div>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: '0.6rem', color: theme.colors.text.muted }}>구좌 정보</div>
                                                <div style={{ fontSize: '0.8rem', fontWeight: '800' }}>{params.filledSlots} / {params.totalSlots}구좌</div>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: '0.6rem', color: theme.colors.text.muted }}>사이클 시간(avg)</div>
                                                <div style={{ fontSize: '0.8rem', fontWeight: '800' }}>{params.totalCycleSeconds.toFixed(1)}s</div>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: '0.6rem', color: theme.colors.text.muted }}>실제 송출수(보장)</div>
                                                <div style={{ fontSize: '0.8rem', fontWeight: '800', color: theme.colors.primary.main }}>{params.expectedCycles}회</div>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: '0.6rem', color: theme.colors.text.muted }}>정책 목표</div>
                                                <div style={{ fontSize: '0.8rem', fontWeight: '800' }}>{params.policyPlays}회</div>
                                            </div>
                                        </div>
                                        {!params.isPolicyMet && (
                                            <div style={{
                                                marginTop: '8px', padding: '4px 8px', borderRadius: '4px',
                                                backgroundColor: '#fff1f2', color: theme.colors.status.danger,
                                                fontSize: '0.65rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '4px'
                                            }}>
                                                <AlertCircle size={10} /> {params.deficitReason}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {viewMode === 'matrix' ? (
                            <div style={{
                                backgroundColor: theme.colors.surface,
                                borderRadius: theme.radius.lg,
                                border: `1px solid ${theme.colors.border}`,
                                boxShadow: theme.shadows.md,
                                overflowX: 'auto',
                                width: '100%'
                            }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: `${120 + (filteredDevices.length * 200)}px` }}>
                                    <thead>
                                        <tr style={{ backgroundColor: '#fafafa', borderBottom: `2px solid ${theme.colors.divider}` }}>
                                            <th style={{
                                                width: '60px', padding: '16px', textAlign: 'center', fontSize: '0.75rem',
                                                color: theme.colors.text.muted, fontWeight: '800', borderRight: `1px solid ${theme.colors.divider}`,
                                                position: 'sticky', left: 0, backgroundColor: '#fafafa', zIndex: 10
                                            }}>
                                                순서
                                            </th>
                                            {filteredDevices.map(device => (
                                                <th key={device.id} style={{
                                                    padding: '16px', textAlign: 'center', minWidth: '200px',
                                                    borderRight: `1px solid ${theme.colors.divider}`
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', color: theme.colors.primary.main, marginBottom: '4px' }}>
                                                        <Monitor size={14} />
                                                        <span style={{ fontSize: '0.65rem', fontWeight: '800' }}>{categories.find(c => c.id === device.category_id)?.name || '기기'}</span>
                                                    </div>
                                                    <div style={{ fontSize: '0.9375rem', fontWeight: '800', color: theme.colors.text.title }}>{device.name}</div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Array.from({ length: maxCycleRows }).map((_, rowIndex) => {
                                            const seqNo = rowIndex + 1;

                                            // 브랜드 불일치 체크: 현재 행(Row)의 브랜드 구성을 비교하여 강조 표시
                                            const rowBrands = filteredDevices.map(d => {
                                                const seq = matrixCycleData.get(d.id) || [];
                                                const item = seq[rowIndex];
                                                return item?.sched?.medias?.brand_id || 'idle';
                                            });
                                            const activeBrands = rowBrands.filter(b => b !== 'idle');
                                            const rowInconsistent = activeBrands.length > 1 && !activeBrands.every(b => b === activeBrands[0]);

                                            return (
                                                <tr key={seqNo} style={{
                                                    borderBottom: `1px solid ${theme.colors.divider}`,
                                                    backgroundColor: rowInconsistent ? '#fff1f2' : 'transparent'
                                                }}>
                                                    <td style={{
                                                        padding: '12px', textAlign: 'center', fontWeight: '800',
                                                        borderRight: `1px solid ${theme.colors.divider}`,
                                                        color: theme.colors.text.muted,
                                                        position: 'sticky', left: 0,
                                                        backgroundColor: rowInconsistent ? '#fff1f2' : '#fafafa',
                                                        zIndex: 9
                                                    }}>
                                                        <div style={{ fontSize: '0.7rem', opacity: 0.5 }}>{seqNo}</div>
                                                    </td>
                                                    {filteredDevices.map(device => {
                                                        const sequence = matrixCycleData.get(device.id) || [];
                                                        const item = sequence[rowIndex];
                                                        if (!item) return <td key={device.id} style={{ borderRight: `1px solid ${theme.colors.divider}`, backgroundColor: rowInconsistent ? '#fff1f2' : 'transparent' }}></td>;

                                                        const { slotNo, sched, duration, cycleNo } = item;

                                                        return (
                                                            <td key={device.id} style={{
                                                                padding: '10px 16px',
                                                                borderRight: `1px solid ${theme.colors.divider}`,
                                                                verticalAlign: 'top',
                                                            }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                                    <span style={{
                                                                        fontSize: '0.55rem', color: theme.colors.text.muted,
                                                                        fontWeight: '900', backgroundColor: '#f1f5f9',
                                                                        padding: '1px 4px', borderRadius: '3px'
                                                                    }}>
                                                                        {slotNo}구좌 / {cycleNo}회차
                                                                    </span>
                                                                </div>

                                                                {sched ? (
                                                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                        <div style={{ marginBottom: '2px' }}>
                                                                            <span style={{
                                                                                fontSize: '0.6rem', fontWeight: '900',
                                                                                color: theme.colors.accent.indigo,
                                                                                backgroundColor: theme.colors.accent.indigo + '15',
                                                                                padding: '1px 4px', borderRadius: '3px'
                                                                            }}>
                                                                                {sched.medias?.brands?.name || '공용'}
                                                                            </span>
                                                                        </div>
                                                                        <div style={{ fontSize: '0.75rem', fontWeight: '800', color: theme.colors.text.title, lineHeight: '1.2' }}>
                                                                            {sched.medias?.product_name || sched.medias?.title}
                                                                        </div>
                                                                        <div style={{ fontSize: '0.6rem', color: theme.colors.text.muted, marginTop: '2px' }}>
                                                                            <Clock size={10} /> {duration}s
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div style={{ color: '#cbd5e1', fontSize: '0.7rem', fontStyle: 'italic', textAlign: 'center' }}>
                                                                        - {duration}s 공백 -
                                                                    </div>
                                                                )}
                                                            </td>
                                                        );
                                                    })}
                                                </tr>
                                            );
                                        })}
                                        {maxCycleRows >= 300 && (
                                            <tr>
                                                <td colSpan={filteredDevices.length + 1} style={{ padding: '20px', textAlign: 'center', color: theme.colors.text.muted, fontSize: '0.8rem', backgroundColor: '#f8fafc' }}>
                                                    상세한 전체 송출 내역은 [시간별 타임라인] 탭에서 확인하실 수 있습니다.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: theme.colors.surface,
                                    padding: '16px', borderRadius: theme.radius.md, border: `1px solid ${theme.colors.border}`,
                                    boxShadow: theme.shadows.sm
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', overflowX: 'auto' }}>
                                        <span style={{ fontWeight: '800', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>조회 기기:</span>
                                        {filteredDevices.map(d => (
                                            <button
                                                key={d.id}
                                                onClick={() => setSelectedDeviceIdForTimeline(d.id)}
                                                style={{
                                                    padding: '8px 16px', borderRadius: '20px', border: `1px solid ${selectedDeviceIdForTimeline === d.id ? theme.colors.primary.main : theme.colors.divider}`,
                                                    backgroundColor: selectedDeviceIdForTimeline === d.id ? theme.colors.primary.light : 'white',
                                                    color: selectedDeviceIdForTimeline === d.id ? theme.colors.primary.main : theme.colors.text.body,
                                                    fontSize: '0.8rem', fontWeight: '800', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.2s'
                                                }}
                                            >
                                                {d.name}
                                            </button>
                                        ))}
                                    </div>

                                    <div style={{ display: 'flex', background: '#f1f5f9', padding: '4px', borderRadius: theme.radius.md, marginLeft: '20px' }}>
                                        {[
                                            { label: '전체', value: '00-24' },
                                            { label: '00-06시', value: '00-06' },
                                            { label: '06-12시', value: '06-12' },
                                            { label: '12-18시', value: '12-18' },
                                            { label: '18-24시', value: '18-24' }
                                        ].map(range => (
                                            <button
                                                key={range.value}
                                                onClick={() => setTimeRange(range.value as any)}
                                                style={{
                                                    padding: '6px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                                                    fontSize: '0.75rem', fontWeight: '700',
                                                    backgroundColor: timeRange === range.value ? 'white' : 'transparent',
                                                    color: timeRange === range.value ? theme.colors.primary.main : theme.colors.text.muted,
                                                    boxShadow: timeRange === range.value ? theme.shadows.sm : 'none',
                                                    whiteSpace: 'nowrap'
                                                }}
                                            >
                                                {range.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div style={{
                                    backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg,
                                    border: `1px solid ${theme.colors.border}`, boxShadow: theme.shadows.md, overflow: 'hidden'
                                }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ backgroundColor: '#fafafa', borderBottom: `2px solid ${theme.colors.divider}` }}>
                                                <th style={{ padding: '16px', textAlign: 'left', width: '120px', fontSize: '0.8rem', fontWeight: '800' }}>재생 시각</th>
                                                <th style={{ padding: '16px', textAlign: 'center', width: '70px', fontSize: '0.8rem', fontWeight: '800' }}>구좌</th>
                                                <th style={{ padding: '16px', textAlign: 'left', width: '90px', fontSize: '0.8rem', fontWeight: '800' }}>브랜드</th>
                                                <th style={{ padding: '16px', textAlign: 'left', fontSize: '0.8rem', fontWeight: '800' }}>소재 TITLE / 상품명</th>
                                                <th style={{ padding: '16px', textAlign: 'center', width: '100px', fontSize: '0.8rem', fontWeight: '800' }}>송출 현황</th>
                                                <th style={{ padding: '16px', textAlign: 'right', width: '80px', fontSize: '0.8rem', fontWeight: '800' }}>길이(s)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {timelineData.map((item, idx) => (
                                                <tr key={idx} style={{
                                                    borderBottom: `1px solid ${theme.colors.divider}`,
                                                    backgroundColor: item.type === 'idle' ? '#f8fafc' : 'white'
                                                }}>
                                                    <td style={{ padding: '12px 16px', fontSize: '0.85rem', fontWeight: '800', color: theme.colors.text.title }}>{item.time}</td>
                                                    <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: '0.8rem', color: theme.colors.text.muted }}>{item.slotNo}번</td>
                                                    <td style={{ padding: '12px 16px' }}>
                                                        <span style={{
                                                            fontSize: '0.65rem', fontWeight: '900', color: theme.colors.accent.indigo,
                                                            backgroundColor: theme.colors.accent.indigo + '15', padding: '2px 6px', borderRadius: '4px'
                                                        }}>
                                                            {item.brand}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '12px 16px', fontSize: '0.85rem', fontWeight: '700', color: item.type === 'idle' ? theme.colors.text.muted : theme.colors.text.title }}>
                                                        {item.title}
                                                    </td>
                                                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                                                        {item.type === 'content' && (
                                                            <span style={{
                                                                fontSize: '0.75rem', fontWeight: '800',
                                                                color: theme.colors.primary.main, backgroundColor: theme.colors.primary.light,
                                                                padding: '2px 8px', borderRadius: '12px'
                                                            }}>
                                                                {item.currentCount} / {item.targetCount}회
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: '0.85rem', color: theme.colors.text.muted }}>
                                                        {item.duration}s
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* 구좌별 슬롯 보장 횟수 요약 정보 */}
                                {selectedDeviceIdForTimeline && (
                                    <div style={{
                                        marginTop: '12px', padding: '24px', backgroundColor: theme.colors.surface,
                                        borderRadius: theme.radius.lg, border: `1px solid ${theme.colors.border}`,
                                        boxShadow: theme.shadows.sm
                                    }}>
                                        <h3 style={{ fontSize: '1rem', fontWeight: '800', color: theme.colors.text.title, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <CheckCircle2 size={18} color={theme.colors.status.success} />
                                            구좌별 송출 보장 및 목표 현황 요약
                                        </h3>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                                            {allDeviceParams.get(selectedDeviceIdForTimeline)?.slotData.map((slot: any) => (
                                                <div key={slot.no} style={{
                                                    padding: '12px', borderRadius: theme.radius.md,
                                                    backgroundColor: theme.colors.background, border: `1px solid ${theme.colors.border}`,
                                                    display: 'flex', flexDirection: 'column', gap: '4px'
                                                }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <span style={{ fontSize: '0.75rem', fontWeight: '800', color: theme.colors.text.body }}>{slot.no}번 구좌</span>
                                                        <span style={{ fontSize: '0.65rem', color: theme.colors.text.muted }}>{slot.avgDuration}s</span>
                                                    </div>
                                                    <div style={{ fontSize: '0.85rem', fontWeight: '700', color: theme.colors.primary.main }}>
                                                        {slot.scheds.length > 0
                                                            ? `${slot.scheds.reduce((sum: number, s: any) => sum + (s.targetPlays || 0), 0)}회 목표`
                                                            : '빈 구좌'}
                                                    </div>
                                                    <div style={{ fontSize: '0.65rem', color: theme.colors.text.muted, lineHeight: '1.4' }}>
                                                        {slot.scheds.map((s: any, idx: number) => (
                                                            <div key={idx} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                • {s.medias?.product_name || s.medias?.title}: {s.targetPlays}회
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>

            <style jsx global>{`
                @media print {
                    body { background: white !important; }
                    main { padding: 0 !important; }
                    header, .btn, .no-print, input, select { display: none !important; }
                    .container { max-width: 100% !important; margin: 0 !important; }
                    table { table-layout: auto !important; width: 100% !important; min-width: 0 !important; font-size: 7pt !important; }
                    th, td { border: 1px solid #e2e8f0 !important; padding: 4px !important; }
                    th { background-color: #fafafa !important; -webkit-print-color-adjust: exact; }
                    td { background-color: transparent !important; }
                    tr { page-break-inside: avoid; }
                    .sticky-col { position: static !important; }
                }
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                .animate-spin { animation: spin 2s linear infinite; }
            `}</style>
        </main>
    );
}
