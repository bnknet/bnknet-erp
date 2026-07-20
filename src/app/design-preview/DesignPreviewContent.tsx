'use client';

import { useEffect, useState } from 'react';
import { getUser } from '@/lib/auth';
import { supabaseFetch, supabaseFetchAll } from '@/lib/supabase';

// 디자인 테스트 전용 페이지. 실제 대시보드 데이터를 새 디자인(2+4 블렌드)으로 그려본다.
// 기존 화면·라우트는 건드리지 않으며 사이드바에도 노출하지 않는다. 확정 시 정식 반영.

const companies = ['BNKNET', 'SJ글로벌', '더블아이', 'IX글로벌'];
const pad = (n: number) => String(n).padStart(2, '0');
const dStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function monthStartStr() { const d = new Date(); return dStr(new Date(d.getFullYear(), d.getMonth(), 1)); }
const won = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;

const quickMenus = [
  { label: '주문 변환', icon: '📦' },
  { label: '재고 관리', icon: '🏭' },
  { label: '매출 현황', icon: '💰' },
  { label: '결재', icon: '✍️' },
  { label: '출·퇴근', icon: '⏰' },
  { label: '공지사항', icon: '📢' },
];

const CSS = `
.dp{--radius:22px}
.dp .scr{padding:28px;border-radius:22px;overflow:hidden}
.dp .biz-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.dp .menu-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:12px}
@media (max-width:820px){.dp .biz-grid{grid-template-columns:repeat(2,1fr)}.dp .menu-grid{grid-template-columns:repeat(3,1fr)}}
.dp .tnum{font-variant-numeric:tabular-nums}

/* A. 밝은 버전 */
.b-light{--card:#ffffff;--ink:#141d33;--sub:#6b7690;--line:#e8ecf4;--blue:#2f6bff;--gold:#b9862f;background:#f5f7fb;color:var(--ink)}
.b-light .hi{font-size:15px;color:var(--sub)}
.b-light .hi b{display:block;font-size:25px;font-weight:800;color:var(--ink);margin-top:2px;letter-spacing:-.01em}
.b-light .total{margin:22px 0;padding:30px 32px;border-radius:26px;background:linear-gradient(135deg,#18213c 0%,#243257 55%,#2c3d70 100%);position:relative;overflow:hidden}
.b-light .total::after{content:"";position:absolute;inset:0;background:radial-gradient(150% 90% at 88% -20%,rgba(185,134,47,.28),transparent 55%)}
.b-light .total>div{position:relative;z-index:1}
.b-light .total .lab{font-size:13px;color:#b9c4e0}
.b-light .total .big{font-size:44px;font-weight:800;color:#fff;margin-top:8px;letter-spacing:-.03em}
.b-light .total .sub{font-size:14px;color:#e4c489;margin-top:6px;font-weight:700}
.b-light .sec{font-size:14px;font-weight:800;margin:26px 0 12px;color:var(--ink)}
.b-light .card{background:var(--card);border-radius:22px;padding:18px;box-shadow:0 2px 4px rgba(20,29,51,.04),0 16px 30px -24px rgba(20,29,51,.5)}
.b-light .card .co{font-size:13px;color:var(--sub);font-weight:700}
.b-light .card .rev{font-size:21px;font-weight:800;margin-top:8px;letter-spacing:-.02em;color:var(--ink)}
.b-light .card .cnt{display:inline-block;font-size:12px;color:var(--blue);background:#eaf0ff;padding:3px 10px;border-radius:999px;margin-top:10px;font-weight:700}
.b-light .card .cntoff{display:inline-block;font-size:12px;color:var(--sub);margin-top:10px}
.b-light .m{background:var(--card);border-radius:18px;padding:18px 8px;text-align:center;box-shadow:0 2px 4px rgba(20,29,51,.04);cursor:default}
.b-light .m .ic{font-size:23px}
.b-light .m .nm{font-size:12px;margin-top:7px;font-weight:700;color:var(--ink)}
.b-light .list{background:var(--card);border-radius:22px;padding:8px 22px;margin-top:12px;box-shadow:0 2px 4px rgba(20,29,51,.04)}
.b-light .row{display:flex;justify-content:space-between;gap:12px;padding:14px 0;border-bottom:1px solid var(--line);font-size:14px;font-weight:600}
.b-light .row:last-child{border-bottom:0}
.b-light .row .r{color:var(--gold);font-weight:800}
.b-light .empty{color:var(--sub);text-align:center;padding:26px 0;font-size:14px}

/* B. 다크 버전 */
.b-dark{--card:#141c33;--ink:#eaeef8;--sub:#8b97b6;--line:#242e4c;--blue:#6ea8fe;--gold:#dab36c;background:radial-gradient(130% 120% at 82% -12%,#18234a 0%,#0b1020 58%);color:var(--ink)}
.b-dark .hi{font-size:15px;color:var(--sub)}
.b-dark .hi b{display:block;font-size:25px;font-weight:800;color:#fff;margin-top:2px;letter-spacing:-.01em}
.b-dark .total{margin:22px 0;padding:30px 32px;border-radius:26px;background:linear-gradient(135deg,rgba(110,168,254,.16),rgba(218,179,108,.07));border:1px solid var(--line);position:relative;overflow:hidden}
.b-dark .total::after{content:"";position:absolute;top:-50px;right:-30px;width:220px;height:220px;background:radial-gradient(circle,rgba(110,168,254,.4),transparent 62%)}
.b-dark .total>div{position:relative;z-index:1}
.b-dark .total .lab{font-size:13px;color:var(--sub)}
.b-dark .total .big{font-size:44px;font-weight:800;color:#fff;margin-top:8px;letter-spacing:-.03em}
.b-dark .total .sub{font-size:14px;color:var(--gold);margin-top:6px;font-weight:700}
.b-dark .sec{font-size:14px;font-weight:800;margin:26px 0 12px;color:#ccd5ea}
.b-dark .card{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:18px}
.b-dark .card .co{font-size:13px;color:var(--sub);font-weight:700}
.b-dark .card .rev{font-size:21px;font-weight:800;margin-top:8px;letter-spacing:-.02em;color:#fff}
.b-dark .card .cnt{display:inline-block;font-size:12px;color:#bcd4ff;background:rgba(110,168,254,.16);padding:3px 10px;border-radius:999px;margin-top:10px;font-weight:700}
.b-dark .card .cntoff{display:inline-block;font-size:12px;color:var(--sub);margin-top:10px}
.b-dark .m{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px 8px;text-align:center;cursor:default}
.b-dark .m .ic{font-size:23px}
.b-dark .m .nm{font-size:12px;margin-top:7px;font-weight:700;color:var(--ink)}
.b-dark .list{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:8px 22px;margin-top:12px}
.b-dark .row{display:flex;justify-content:space-between;gap:12px;padding:14px 0;border-bottom:1px solid var(--line);font-size:14px;font-weight:600}
.b-dark .row:last-child{border-bottom:0}
.b-dark .row .r{color:var(--gold);font-weight:800}
.b-dark .empty{color:var(--sub);text-align:center;padding:26px 0;font-size:14px}
`;

interface Pending { id: string; doc_type?: string; company?: string; submitter_name?: string; total_amount?: number }

export default function DesignPreviewContent() {
  const user = getUser();
  const [variant, setVariant] = useState<'A' | 'B'>('A');
  const [bizStats, setBizStats] = useState<Record<string, { rev: number; cnt: number }>>({});
  const [pending, setPending] = useState<Pending[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const ms = monthStartStr();
        const [ord, appRes] = await Promise.all([
          supabaseFetchAll<{ amount?: number; canceled?: boolean; company?: string }>(`/orders?select=amount,canceled,company&upload_date=gte.${ms}`),
          supabaseFetch('/approvals?status=eq.pending&select=id,doc_type,company,submitter_name,total_amount,created_at&order=created_at.desc&limit=6'),
        ]);
        const bs: Record<string, { rev: number; cnt: number }> = {};
        for (const o of ord) {
          if (o.canceled) continue;
          const c = o.company || '미분류';
          if (!bs[c]) bs[c] = { rev: 0, cnt: 0 };
          bs[c].rev += (Number(o.amount) || 0) / 1.1;
          bs[c].cnt++;
        }
        setBizStats(bs);
        const apps = await appRes.json();
        setPending(Array.isArray(apps) ? apps : []);
      } catch { /* 무시 — 프리뷰 */ }
    })();
  }, []);

  const totalRev = Object.values(bizStats).reduce((s, v) => s + v.rev, 0);
  const totalCnt = Object.values(bizStats).reduce((s, v) => s + v.cnt, 0);
  const now = new Date();
  const greeting = now.getHours() < 12 ? '좋은 아침이에요' : now.getHours() < 18 ? '안녕하세요' : '수고하셨어요';
  const docLabel = (t?: string) => t === '카드구매' ? '매입품의서(카드구매)' : (t || '문서');
  const themeClass = variant === 'A' ? 'b-light' : 'b-dark';

  return (
    <div className="dp">
      <style>{CSS}</style>

      {/* 안내 + 토글 (프리뷰 전용, 디자인 대상 아님) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <div className="text-sm text-amber-700">
          🎨 <b>디자인 테스트 페이지</b> — 실제 데이터로 새 디자인을 미리 봅니다. (아직 정식 반영 아님)
        </div>
        <div className="flex gap-2">
          <button onClick={() => setVariant('A')}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold ${variant === 'A' ? 'bg-slate-800 text-white' : 'bg-white text-gray-600 border border-gray-300'}`}>A · 밝은</button>
          <button onClick={() => setVariant('B')}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold ${variant === 'B' ? 'bg-slate-800 text-white' : 'bg-white text-gray-600 border border-gray-300'}`}>B · 다크</button>
        </div>
      </div>

      {/* 새 디자인 화면 */}
      <div className={`scr ${themeClass}`}>
        <div className="hi">{greeting} 👋<b>{user?.name || '사용자'}님</b></div>

        <div className="total">
          <div>
            <div className="lab">전체 매출 합 · 이번 달 (부가세 제외)</div>
            <div className="big tnum">{won(totalRev)}</div>
            <div className="sub tnum">주문 {totalCnt.toLocaleString()}건</div>
          </div>
        </div>

        <div className="sec">사업자별 현황</div>
        <div className="biz-grid">
          {companies.map((c) => {
            const s = bizStats[c];
            return (
              <div className="card" key={c}>
                <div className="co">{c}</div>
                <div className="rev tnum">{won(s?.rev || 0)}</div>
                {s ? <div className="cnt tnum">주문 {s.cnt.toLocaleString()}건</div> : <div className="cntoff">이번 달 주문 없음</div>}
              </div>
            );
          })}
        </div>

        <div className="sec">빠른 메뉴</div>
        <div className="menu-grid">
          {quickMenus.map((m) => (
            <div className="m" key={m.label}><div className="ic">{m.icon}</div><div className="nm">{m.label}</div></div>
          ))}
        </div>

        <div className="sec">미결재 문서 {pending.length > 0 ? `(${pending.length})` : ''}</div>
        <div className="list">
          {pending.length === 0 ? (
            <div className="empty">미결재 문서가 없습니다</div>
          ) : pending.map((a) => (
            <div className="row" key={a.id}>
              <span>{docLabel(a.doc_type)} · {a.submitter_name || '-'} · {a.company || ''}</span>
              <span className="r tnum">{a.total_amount ? won(a.total_amount) : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
