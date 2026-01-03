'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Activity, Monitor, PlayCircle, Clock, ArrowLeft, RefreshCw, AlertCircle } from 'lucide-react';
import Link from 'next/link';

interface DeviceStatus {
    id: string;
    name: string;
    status: string;
    last_seen: string;
    now_playing?: string;
}

interface PlayLog {
    id: number;
    device_id: string;
    media_id: string;
    played_at: string;
    medias: { title: string };
    devices: { name: string };
}

export default function MonitoringPage() {
    const [devices, setDevices] = useState<DeviceStatus[]>([]);
    const [logs, setLogs] = useState<PlayLog[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        setLoading(true);
        // 1. 기기 목록 가져오기
        const { data: deviceData } = await supabase.from('devices').select('*').order('name');
        if (deviceData) setDevices(deviceData);

        // 2. 최근 송출 로그 10개 가져오기
        const { data: logData } = await supabase
            .from('playback_logs')
            .select('*, medias(title), devices(name)')
            .order('played_at', { ascending: false })
            .limit(10);
        if (logData) setLogs(logData as any);

        setLoading(false);
    };

    useEffect(() => {
        fetchData();

        // Supabase Realtime 구독 설정
        const deviceSubscription = supabase
            .channel('monitoring_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, (payload) => {
                fetchData(); // 단순화를 위해 데이터 재요청 (실제로는 페이로드만 처리 가능)
            })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'playback_logs' }, (payload) => {
                fetchData();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(deviceSubscription);
        };
    }, []);

    const getStatusColor = (status: string, lastSeen: string) => {
        if (!lastSeen) return '#64748b';
        const isRecent = new Date().getTime() - new Date(lastSeen).getTime() < 60000; // 1분 이내 정면 생존
        if (status === 'online' && isRecent) return '#10b981';
        if (status === 'maintenance') return '#f59e0b';
        return '#64748b';
    };

    return (
        <main className="container" style={{ padding: '40px 20px' }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <Link href="/" className="btn glass" style={{ padding: '8px' }}>
                        <ArrowLeft size={20} />
                    </Link>
                    <div>
                        <h1 style={{ fontSize: '2rem', fontWeight: '800' }}>실시간 모니터링</h1>
                        <p style={{ color: '#94a3b8' }}>플레이어 생존 상태 및 실시간 송출 현황 관제</p>
                    </div>
                </div>
                <button className="btn glass" onClick={fetchData} disabled={loading}>
                    <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                </button>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '32px', alignItems: 'start' }}>
                {/* 왼쪽: 기기 상태 목록 */}
                <section>
                    <h2 style={{ fontSize: '1.25rem', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Monitor size={20} color="#38bdf8" />
                        플레이어 리스트
                    </h2>
                    <div style={{ display: 'grid', gap: '16px' }}>
                        {devices.length === 0 ? (
                            <div className="glass" style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>등록된 기기가 없습니다.</div>
                        ) : (
                            devices.map(device => (
                                <div key={device.id} className="glass" style={{ padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                        <div style={{
                                            width: '12px', height: '12px', borderRadius: '50%',
                                            background: getStatusColor(device.status, device.last_seen),
                                            boxShadow: `0 0 8px ${getStatusColor(device.status, device.last_seen)}`
                                        }} />
                                        <div>
                                            <h4 style={{ fontWeight: 'bold' }}>{device.name}</h4>
                                            <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                                최종 수신: {device.last_seen ? new Date(device.last_seen).toLocaleTimeString('ko-KR') : '신호 없음'}
                                            </p>
                                            {/* 현재 재생중인 광고 표시 (최근 로그 기반) */}
                                            {logs.find(l => l.device_id === device.id) && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '6px', fontSize: '0.75rem', color: '#10b981' }}>
                                                    <PlayCircle size={12} />
                                                    <span style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {logs.find(l => l.device_id === device.id)?.medias?.title}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <span style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>현재 상태</span>
                                        <span className={`status-badge ${device.status === 'online' ? 'status-online' : 'status-offline'}`}>
                                            {device.status === 'online' ? 'ACTIVE' : 'OFFLINE'}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </section>

                {/* 오른쪽: 실시간 송출 로그 */}
                <section>
                    <h2 style={{ fontSize: '1.25rem', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Activity size={20} color="#f472b6" />
                        최근 송출 로그
                    </h2>
                    <div className="glass" style={{ padding: '16px', borderRadius: '12px', background: 'rgba(0,0,0,0.2)' }}>
                        {logs.length === 0 ? (
                            <p style={{ fontSize: '0.85rem', color: '#94a3b8', textAlign: 'center', padding: '20px' }}>수집된 로그가 없습니다.</p>
                        ) : (
                            logs.map((log, idx) => (
                                <div key={log.id} style={{
                                    padding: '12px 0',
                                    borderBottom: idx === logs.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                                    animation: idx === 0 ? 'pulse 2s infinite' : 'none'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                                        <span style={{ color: '#38bdf8', fontWeight: 'bold' }}>{log.devices?.name}</span>
                                        <span style={{ color: '#64748b' }}>{new Date(log.played_at).toLocaleTimeString()}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem' }}>
                                        <PlayCircle size={14} color="#10b981" />
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.medias?.title}</span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    <div style={{ marginTop: '20px', padding: '16px', borderRadius: '12px', border: '1px solid rgba(244, 114, 182, 0.2)', background: 'rgba(244, 114, 182, 0.05)' }}>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                            <AlertCircle size={18} color="#f472b6" />
                            <p style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: '1.5' }}>
                                실시간 로그는 플레이어가 재생을 완료할 때마다 자동으로 업데이트됩니다.
                            </p>
                        </div>
                    </div>
                </section>
            </div>

            <style jsx>{`
        @keyframes pulse {
          0% { background: transparent; }
          50% { background: rgba(56, 189, 248, 0.05); }
          100% { background: transparent; }
        }
      `}</style>
        </main>
    );
}
