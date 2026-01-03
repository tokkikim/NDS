'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { LayoutDashboard, Monitor, PlayCircle, Clock, Settings, Activity, Layers } from 'lucide-react';
import Link from 'next/link';

export default function Home() {
  const [stats, setStats] = useState({
    totalDevices: 0,
    onlineDevices: 0,
    activeSchedules: 0,
    mediaGroups: 0,
  });

  useEffect(() => {
    async function fetchStats() {
      const { count: deviceCount } = await supabase.from('devices').select('*', { count: 'exact', head: true });
      const { count: onlineCount } = await supabase.from('devices').select('*', { count: 'exact', head: true }).eq('status', 'online');
      const { count: scheduleCount } = await supabase.from('schedules').select('*', { count: 'exact', head: true });
      const { count: mgCount } = await supabase.from('media_groups').select('*', { count: 'exact', head: true });

      setStats({
        totalDevices: deviceCount || 0,
        onlineDevices: onlineCount || 0,
        activeSchedules: scheduleCount || 0,
        mediaGroups: mgCount || 0,
      });
    }
    fetchStats();
  }, []);

  return (
    <main className="container" style={{ padding: '40px 20px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
        <div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: '800', background: 'linear-gradient(to right, #38bdf8, #f472b6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            NDS Management
          </h1>
          <p style={{ color: '#94a3b8', marginTop: '8px' }}>옥외광고 통합 관리 솔루션 대시보드</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Link href="/monitoring" className="btn btn-primary">
            <Activity size={18} />
            실시간 모니터링
          </Link>
        </div>
      </header>

      <section className="dashboard-grid">
        <div className="glass" style={{ padding: '24px' }}>
          <div style={{ color: 'var(--primary)', marginBottom: '16px' }}><Monitor size={32} /></div>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>전체 기기</h3>
          <p style={{ fontSize: '2rem', fontWeight: 'bold' }}>{stats.totalDevices} <span style={{ fontSize: '1rem', fontWeight: 'normal', color: '#94a3b8' }}>Units</span></p>
        </div>

        <div className="glass" style={{ padding: '24px' }}>
          <div style={{ color: '#10b981', marginBottom: '16px' }}><Activity size={32} /></div>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>활성 상태</h3>
          <p style={{ fontSize: '2rem', fontWeight: 'bold' }}>{stats.onlineDevices} <span style={{ fontSize: '1rem', fontWeight: 'normal', color: '#94a3b8' }}>Online</span></p>
        </div>

        <div className="glass" style={{ padding: '24px' }}>
          <div style={{ color: 'var(--primary)', marginBottom: '16px' }}><Layers size={32} /></div>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>관리 매체</h3>
          <p style={{ fontSize: '2rem', fontWeight: 'bold' }}>{stats.mediaGroups} <span style={{ fontSize: '1rem', fontWeight: 'normal', color: '#94a3b8' }}>Groups</span></p>
        </div>

        <div className="glass" style={{ padding: '24px' }}>
          <div style={{ color: '#f59e0b', marginBottom: '16px' }}><PlayCircle size={32} /></div>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>진행중인 편성</h3>
          <p style={{ fontSize: '2rem', fontWeight: 'bold' }}>{stats.activeSchedules} <span style={{ fontSize: '1rem', fontWeight: 'normal', color: '#94a3b8' }}>Ads</span></p>
        </div>
      </section>

      <section style={{ marginTop: '60px' }}>
        <h2 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <LayoutDashboard size={24} color="#38bdf8" />
          주요 관리 메뉴
        </h2>
        <div className="dashboard-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
          {[
            { title: '기기 관리', desc: '플레이어 등록 및 운영 시간 설정', icon: <Monitor />, href: '/devices' },
            { title: '편성 관리', desc: '매체별 소재 배포 및 구좌 관리', icon: <Clock />, href: '/schedules' },
            { title: '소재 보관함', desc: '영상/이미지 업로드 및 관리', icon: <PlayCircle />, href: '/medias' },
            { title: '시스템 설정', desc: '사용자 권한 및 공통 설정', icon: <Settings />, href: '/settings' },
          ].map((item, idx) => (
            <Link key={idx} href={item.href}>
              <div className="glass" style={{ padding: '24px', cursor: 'pointer', transition: 'transform 0.2s', height: '100%' }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.03)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}>
                <div style={{ marginBottom: '16px', color: '#94a3b8' }}>{item.icon}</div>
                <h4 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>{item.title}</h4>
                <p style={{ fontSize: '0.9rem', color: '#94a3b8', lineHeight: '1.5' }}>{item.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
