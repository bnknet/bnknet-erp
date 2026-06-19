'use client';

import { getUser } from '@/lib/auth';

const companies = ['더블아이', 'BNKNET', 'SJ글로벌', 'IX글로벌'];

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

  const now = new Date();
  const greeting = now.getHours() < 12 ? '좋은 아침이에요' :
    now.getHours() < 18 ? '안녕하세요' : '수고하셨어요';

  return (
    <div className="space-y-6">
      {/* 인사말 */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-6 text-white shadow-lg shadow-blue-500/20">
        <p className="text-blue-200 text-sm">{greeting} 👋</p>
        <h2 className="text-2xl font-bold mt-1">{user?.name || '사용자'}님</h2>
        <p className="text-blue-200 text-sm mt-1">
          {now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
        </p>
      </div>

      {/* 사업자별 현황 카드 */}
      <div>
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">사업자별 현황</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {companies.map((company) => (
            <div key={company} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="text-xs text-gray-400 mb-1">{company}</div>
              <div className="text-lg font-bold text-gray-800">-</div>
              <div className="text-xs text-gray-400 mt-1">데이터 준비 중</div>
            </div>
          ))}
        </div>
      </div>

      {/* 빠른 메뉴 */}
      <div>
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">빠른 메뉴</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {quickMenus.map((menu) => (
            <a
              key={menu.href}
              href={menu.href}
              className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 hover:border-blue-300 hover:shadow-md transition-all group text-center"
            >
              <div className="text-2xl mb-2">{menu.icon}</div>
              <div className="text-sm font-semibold text-gray-700 group-hover:text-blue-600">{menu.label}</div>
              <div className="text-xs text-gray-400 mt-1 hidden lg:block">{menu.desc}</div>
            </a>
          ))}
        </div>
      </div>

      {/* 최근 활동 (추후 실데이터 연결) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-700 mb-4">최근 주문 변환 이력</h3>
          <div className="text-sm text-gray-400 text-center py-8">
            주문 변환 데이터가 없습니다
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-700 mb-4">미결재 문서</h3>
          <div className="text-sm text-gray-400 text-center py-8">
            미결재 문서가 없습니다
          </div>
        </div>
      </div>
    </div>
  );
}
