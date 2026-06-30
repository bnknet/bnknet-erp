'use client';

import { useEffect, useState } from 'react';
import { getUser } from '@/lib/auth';
import { supabaseFetch, supabaseFetchAll } from '@/lib/supabase';
import { computeCostGap, type CostGapSummary, type MiniOrder, type MiniInv } from '@/lib/salesStats';

const companies = ['BNKNET', 'SJ글로벌', '더블아이', 'IX글로벌'];

interface ShipAlert {
  id: string;
  created_at?: string;
  company?: string;
  kind: string;       // 'unmatched' | 'negative' | 'rpc_fail'
  detail?: string;
  order_count?: number;
}
const SHIP_ALERT_LABEL: Record<string, string> = {
  unmatched: '재고 미매칭', negative: '재고 부족', rpc_fail: '자동출고 실패',
};

const pad = (n: number) => String(n).padStart(2, '0');
const dStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dStr(d);
}
function monthStartStr() {
  const d = new Date();
  return dStr(new Date(d.getFullYear(), d.getMonth(), 1));
}
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;

const quickMenus = [
  { href: '/orders', label: '주문 변환', icon: '📦', desc: '사방넷 파일 업로드·변환' },
  { href: '/inventory', label: '재고 관리', icon: '🏭', desc: '입출고 및 현황 조회' },
  { href: '/sales', label: '매출 현황', icon: '💰', desc: '매출·이익 분석' },
  { href: '/approval', label: '결재', icon: '✍️', desc: '품의서·지출결의서' },
  { href: '/attendance', label: '출·퇴근', icon: '⏰', desc: '출퇴근 체크' },
  { href: '/notices', label: '공지사항', icon: '📢', desc: '사내 공지 확인' },
];

export default function DashboardContent() {
  const user = getUser();
  // 재고 자동저장 점검 대상 권한자
  const canSeeSnapAlert = ['ceo', 'admin', 'sales', 'inventory'].includes(user?.role || '');

  const now = new Date();
  const greeting = now.getHours() < 12 ? '좋은 아침이에요' :
    now.getHours() < 18 ? '안녕하세요' : '수고하셨어요';

  // 재고 자동저장(스냅샷) 누락 감지
  const [lastSnapDate, setLastSnapDate] = useState<string | null>(null);
  useEffect(() => {
    if (!canSeeSnapAlert) return;
    (async () => {
      try {
        const res = await supabaseFetch('/inventory_snapshots?select=snapshot_date&order=snapshot_date.desc&limit=1');
        const data = await res.json();
        setLastSnapDate(Array.isArray(data) && data[0] ? data[0].snapshot_date : null);
      } catch { /* 무시 */ }
    })();
  }, [canSeeSnapAlert]);
  const snapStale = !!lastSnapDate && lastSnapDate < yesterdayStr();

  // 매출/원가 정합성 점검 (이번 달 기준) — 권한자에게만
  const [costGap, setCostGap] = useState<CostGapSummary | null>(null);
  useEffect(() => {
    if (!canSeeSnapAlert) return;
    (async () => {
      try {
        const ms = monthStartStr();
        const today = dStr(new Date());
        const [ord, inv] = await Promise.all([
          supabaseFetchAll<MiniOrder>(`/orders?select=upload_date,product_name,collect_product,quantity,amount,canceled&upload_date=gte.${ms}`),
          supabaseFetchAll<MiniInv>('/inventory?select=product_name,company,cost_price'),
        ]);
        setCostGap(computeCostGap(ord, inv, ms, today));
      } catch { /* 무시 — 대시보드 경고는 보조 지표 */ }
    })();
  }, [canSeeSnapAlert]);

  // 자동출고 안전장치 알림 (미해결) — 권한자에게만
  const [shipAlerts, setShipAlerts] = useState<ShipAlert[]>([]);
  useEffect(() => {
    if (!canSeeSnapAlert) return;
    (async () => {
      try {
        const res = await supabaseFetch('/ship_alerts?resolved=eq.false&order=created_at.desc&limit=50');
        const data = await res.json();
        setShipAlerts(Array.isArray(data) ? data : []);
      } catch { /* 무시 */ }
    })();
  }, [canSeeSnapAlert]);

  async function resolveAlert(id: string) {
    try {
      await supabaseFetch(`/ship_alerts?id=eq.${id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ resolved: true, resolved_by: user?.name || '', resolved_at: new Date().toISOString() }),
      });
      setShipAlerts(prev => prev.filter(a => a.id !== id));
    } catch { /* 무시 */ }
  }

  return (
    <div className="space-y-6">
      {/* 재고 자동저장 누락 경고 */}
      {canSeeSnapAlert && snapStale && (
        <a href="/inventory" className="block bg-red-50 border border-red-200 rounded-2xl px-5 py-4 hover:bg-red-100 transition-colors">
          <div className="text-base font-medium text-red-600">⚠️ 재고 자동저장이 멈춘 것 같습니다 — 마지막 저장: {lastSnapDate}</div>
          <div className="text-sm text-red-400 mt-0.5">재고 관리 → 일자별 재고에서 &apos;지금 재고 저장&apos;을 눌러 복구하세요. (클릭하면 이동)</div>
        </a>
      )}

      {/* 자동출고 안전장치 알림 (미해결) */}
      {canSeeSnapAlert && shipAlerts.map(a => (
        <div key={a.id} className="bg-orange-50 border border-orange-200 rounded-2xl px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <a href="/orders" className="block flex-1 min-w-0">
              <div className="text-base font-medium text-orange-700">
                ⚠️ [{a.company || '미지정'}] {SHIP_ALERT_LABEL[a.kind] || a.kind} — 담당자 확인 필요
              </div>
              <div className="text-sm text-orange-600 mt-0.5 break-words">{a.detail}{a.created_at ? ` · ${a.created_at.slice(0, 16).replace('T', ' ')}` : ''}</div>
            </a>
            <button onClick={() => resolveAlert(a.id)}
              className="flex-shrink-0 px-3 py-1.5 text-sm bg-white border border-orange-300 rounded-lg text-orange-600 hover:bg-orange-100">확인</button>
          </div>
        </div>
      ))}

      {/* 매출 이상 징후 경고 (이번 달 주문은 있는데 매출 0) */}
      {canSeeSnapAlert && costGap?.anomaly && (
        <a href="/sales" className="block bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 hover:bg-amber-100 transition-colors">
          <div className="text-base font-medium text-amber-700">⚠️ 이번 달 주문은 {costGap.orderCount}건인데 매출이 0원으로 집계됩니다</div>
          <div className="text-sm text-amber-600 mt-0.5">데이터 점검이 필요합니다. 매출 현황에서 확인하세요. (클릭하면 이동)</div>
        </a>
      )}

      {/* 원가 미입력 경고 (이번 달) */}
      {canSeeSnapAlert && costGap && costGap.missingCount > 0 && (
        <a href="/sales" className="block bg-red-50 border border-red-200 rounded-2xl px-5 py-4 hover:bg-red-100 transition-colors">
          <div className="text-base font-medium text-red-600">⚠️ 원가 미입력 상품 {costGap.missingCount}건 — 이번 달 영업이익에 반영되지 않았습니다</div>
          <div className="text-sm text-red-400 mt-0.5">
            판매금액 약 {won(costGap.missingRevenue)}분의 이익이 비어 있습니다. 매출 현황에서 원가를 입력하세요. (클릭하면 이동)
          </div>
        </a>
      )}

      {/* 인사말 */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-6 text-white shadow-lg shadow-blue-500/20">
        <p className="text-blue-200 text-base">{greeting} 👋</p>
        <h2 className="text-2xl font-bold mt-1">{user?.name || '사용자'}님</h2>
        <p className="text-blue-200 text-base mt-1">
          {now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
        </p>
      </div>

      {/* 사업자별 현황 카드 */}
      <div>
        <h3 className="text-base font-semibold text-gray-500 uppercase tracking-wider mb-3">사업자별 현황</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {companies.map((company) => (
            <div key={company} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="text-sm text-gray-400 mb-1">{company}</div>
              <div className="text-lg font-bold text-gray-800">-</div>
              <div className="text-sm text-gray-400 mt-1">데이터 준비 중</div>
            </div>
          ))}
        </div>
      </div>

      {/* 빠른 메뉴 */}
      <div>
        <h3 className="text-base font-semibold text-gray-500 uppercase tracking-wider mb-3">빠른 메뉴</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {quickMenus.map((menu) => (
            <a
              key={menu.href}
              href={menu.href}
              className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 hover:border-blue-300 hover:shadow-md transition-all group text-center"
            >
              <div className="text-2xl mb-2">{menu.icon}</div>
              <div className="text-base font-semibold text-gray-700 group-hover:text-blue-600">{menu.label}</div>
              <div className="text-sm text-gray-400 mt-1 hidden lg:block">{menu.desc}</div>
            </a>
          ))}
        </div>
      </div>

      {/* 최근 활동 (추후 실데이터 연결) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-700 mb-4">최근 주문 변환 이력</h3>
          <div className="text-base text-gray-400 text-center py-8">
            주문 변환 데이터가 없습니다
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-700 mb-4">미결재 문서</h3>
          <div className="text-base text-gray-400 text-center py-8">
            미결재 문서가 없습니다
          </div>
        </div>
      </div>
    </div>
  );
}
