'use client';

import { useState, useRef } from 'react';
import { convertOrders, buildSupabaseRows, type ConvertedOrderRow, type RawOrderRow } from '@/lib/orderConvert';
import { supabaseFetch } from '@/lib/supabase';

type Tab = 'convert' | 'history';
type Status = { type: 'info' | 'success' | 'error'; msg: string } | null;

interface HistoryGroup {
  date: string;
  rows: HistoryRow[];
}

interface HistoryRow {
  upload_date: string;
  mall_name: string;
  product_name: string;
  quantity: number;
  amount: number;
  is_bundle: boolean;
}

export default function OrdersContent() {
  const [tab, setTab] = useState<Tab>('convert');
  const [status, setStatus] = useState<Status>(null);
  const [resultData, setResultData] = useState<ConvertedOrderRow[]>([]);
  const [headerOrder, setHeaderOrder] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [history, setHistory] = useState<HistoryGroup[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file || !file.name.endsWith('.xlsx')) {
      setStatus({ type: 'error', msg: '❌ .xlsx 파일만 업로드 가능합니다' });
      return;
    }
    setFileName(file.name);
    setStatus({ type: 'info', msg: '⏳ 파일 처리 중...' });
    setResultData([]);

    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: RawOrderRow[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

      if (!raw.length) {
        setStatus({ type: 'error', msg: '❌ 데이터가 없습니다' });
        return;
      }

      // 원본 파일의 열 순서·열 구성을 그대로 보존 (다운로드 시 사용)
      const headerRow = (XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })[0] as unknown[]) || [];
      setHeaderOrder(headerRow.map((h) => String(h)).filter((h) => h !== ''));

      const converted = convertOrders(raw);
      setResultData(converted);
      const bundleCount = converted.filter((r) => r._is_bundle).length;
      const productCount = new Set(converted.map((r) => r['상품명']).filter(Boolean)).size;
      setStatus({
        type: 'success',
        msg: `✅ 변환 완료 — 총 ${converted.length}건 / 합구매 ${bundleCount}건 / 상품 ${productCount}종`,
      });
    } catch {
      setStatus({ type: 'error', msg: '❌ 파일 처리 중 오류가 발생했습니다' });
    }
  }

  async function handleDownload() {
    if (!resultData.length) return;
    const XLSX = await import('xlsx');

    // 원본 파일의 열 순서·열 구성을 그대로 유지하고, 변환값(상품명·수량)만 덮어쓴다.
    // 원본 헤더를 못 잡은 경우에만 변환 결과의 키를 사용 (_로 시작하는 내부 필드는 제외).
    const headers = headerOrder.length
      ? [...headerOrder]
      : Object.keys(resultData[0]).filter((k) => !k.startsWith('_'));
    if (!headers.includes('합구매여부')) headers.push('합구매여부');

    const exportRows = resultData.map((r) => {
      const obj: Record<string, string | number> = {};
      headers.forEach((h) => {
        if (h === '합구매여부') {
          obj[h] = r['_is_bundle'] ? '합구매' : '';
        } else {
          const v = r[h];
          obj[h] = v === undefined || v === null ? '' : (v as string | number);
        }
      });
      return obj;
    });

    const ws = XLSX.utils.json_to_sheet(exportRows, { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '변환결과');
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `주문변환_${today}.xlsx`);
  }

  async function handleSaveToDB() {
    if (!resultData.length) return;
    setStatus({ type: 'info', msg: '⏳ DB 저장 중...' });

    try {
      const rows = buildSupabaseRows(resultData);
      const orderNums = rows.map((r) => r.order_number).filter(Boolean);

      // 중복 체크
      const checkRes = await supabaseFetch(
        `/orders?select=order_number&order_number=in.(${orderNums.map((n) => `"${n}"`).join(',')})`,
      );
      const existing: { order_number: string }[] = await checkRes.json();
      const existingSet = new Set(existing.map((r) => r.order_number));
      const newRows = rows.filter((r) => !existingSet.has(r.order_number));

      if (!newRows.length) {
        setStatus({ type: 'info', msg: '⚠️ 모든 주문이 이미 저장되어 있습니다' });
        return;
      }

      const res = await supabaseFetch('/orders', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(newRows),
      });

      if (!res.ok) throw new Error('저장 실패');
      setStatus({
        type: 'success',
        msg: `✅ ${newRows.length}건 저장 완료 (중복 ${rows.length - newRows.length}건 제외)`,
      });
    } catch {
      setStatus({ type: 'error', msg: '❌ DB 저장 중 오류가 발생했습니다' });
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const res = await supabaseFetch(
        '/orders?select=upload_date,mall_name,product_name,quantity,amount,is_bundle&order=upload_date.desc,product_name.asc&limit=200',
      );
      const data: HistoryRow[] = await res.json();

      const grouped: Record<string, HistoryRow[]> = {};
      data.forEach((row) => {
        if (!grouped[row.upload_date]) grouped[row.upload_date] = [];
        grouped[row.upload_date].push(row);
      });

      setHistory(
        Object.entries(grouped).map(([date, rows]) => ({ date, rows })),
      );
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  function handleTabChange(t: Tab) {
    setTab(t);
    if (t === 'history') loadHistory();
  }

  const statusColors = {
    info: 'bg-blue-50 border-blue-200 text-blue-700',
    success: 'bg-green-50 border-green-200 text-green-700',
    error: 'bg-red-50 border-red-200 text-red-700',
  };

  return (
    <div className="space-y-4">
      {/* 탭 */}
      <div className="flex gap-2">
        <button
          onClick={() => handleTabChange('convert')}
          className={`px-5 py-2.5 rounded-xl font-medium text-sm transition-all ${
            tab === 'convert'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
              : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
          }`}
        >
          📤 파일 변환
        </button>
        <button
          onClick={() => handleTabChange('history')}
          className={`px-5 py-2.5 rounded-xl font-medium text-sm transition-all ${
            tab === 'history'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
              : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
          }`}
        >
          📋 업로드 이력
        </button>
      </div>

      {/* 파일 변환 탭 */}
      {tab === 'convert' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-800 mb-1">사방넷 주문 파일 변환</h2>
            <p className="text-sm text-gray-400 mb-5">사방넷에서 다운받은 엑셀 파일을 올리면 자동으로 가공 완료 파일을 만들어드립니다</p>

            {/* 업로드 존 */}
            <div
              className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-all"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) handleFile(f);
              }}
            >
              <div className="text-4xl mb-3">📂</div>
              <p className="text-gray-500 font-medium">
                {fileName || '클릭하거나 파일을 여기에 끌어다 놓으세요'}
              </p>
              <p className="text-gray-400 text-sm mt-1">.xlsx 파일만 지원됩니다</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />

            {/* 상태 메시지 */}
            {status && (
              <div className={`mt-4 px-4 py-3 rounded-xl border text-sm ${statusColors[status.type]}`}>
                {status.msg}
              </div>
            )}

            {/* 결과 액션 버튼 */}
            {resultData.length > 0 && (
              <div className="flex gap-3 mt-4 flex-wrap">
                <button
                  onClick={handleDownload}
                  className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium text-sm transition-colors shadow-sm"
                >
                  ⬇️ 엑셀 다운로드
                </button>
                <button
                  onClick={handleSaveToDB}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium text-sm transition-colors shadow-sm"
                >
                  💾 DB에 저장
                </button>
                <button
                  onClick={() => { setResultData([]); setHeaderOrder([]); setFileName(''); setStatus(null); }}
                  className="px-5 py-2.5 bg-white hover:bg-gray-50 text-gray-600 rounded-xl font-medium text-sm border border-gray-200 transition-colors"
                >
                  🔄 초기화
                </button>
              </div>
            )}
          </div>

          {/* 결과 미리보기 */}
          {resultData.length > 0 && (
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-700 mb-4">변환 결과 미리보기</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 px-3 text-xs font-semibold text-gray-400 whitespace-nowrap">몰명</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-gray-400 whitespace-nowrap">상품명</th>
                      <th className="text-center py-2 px-3 text-xs font-semibold text-gray-400">수량</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-gray-400">금액</th>
                      <th className="text-center py-2 px-3 text-xs font-semibold text-gray-400">구분</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultData.slice(0, 50).map((row, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-md">
                            {String(row['몰명'] || '-')}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-gray-700">{row['상품명']}</td>
                        <td className="py-2 px-3 text-center text-gray-600">{row['수량(주문수량*EA)']}</td>
                        <td className="py-2 px-3 text-right text-gray-700 font-medium">
                          ₩{(Number(row['금액']) || 0).toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {row['_is_bundle'] ? (
                            <span className="bg-cyan-100 text-cyan-700 text-xs px-2 py-0.5 rounded-md font-semibold">합구매</span>
                          ) : (
                            <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-md">일반</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {resultData.length > 50 && (
                  <p className="text-xs text-gray-400 text-center mt-3">
                    상위 50건만 표시 중 (전체 {resultData.length}건)
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 사용 방법 */}
          <div className="bg-blue-50 rounded-2xl p-5 border border-blue-100">
            <h3 className="font-semibold text-blue-700 text-sm mb-2">📌 사용 방법</h3>
            <ol className="text-sm text-blue-600 space-y-1 list-decimal list-inside">
              <li>사방넷 → 주문관리 → 엑셀 다운로드</li>
              <li>위 영역에 파일 업로드</li>
              <li>자동 변환 완료 후 엑셀 다운로드</li>
              <li>&quot;DB에 저장&quot; 클릭하면 이력에 누적 저장됩니다</li>
            </ol>
          </div>
        </div>
      )}

      {/* 업로드 이력 탭 */}
      {tab === 'history' && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-800">업로드 이력</h2>
            <button
              onClick={loadHistory}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              🔄 새로고침
            </button>
          </div>

          {historyLoading ? (
            <div className="text-center py-12 text-gray-400">불러오는 중...</div>
          ) : history.length === 0 ? (
            <div className="text-center py-12 text-gray-400">아직 저장된 이력이 없습니다</div>
          ) : (
            <div className="space-y-6">
              {history.map((group) => {
                const total = group.rows.reduce((s, r) => s + (r.amount || 0), 0);
                return (
                  <div key={group.date}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-gray-700">{group.date}</span>
                      <span className="text-sm text-gray-400">
                        {group.rows.length}건 · 합계 ₩{total.toLocaleString()}
                      </span>
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-gray-100">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50">
                            <th className="text-left py-2 px-3 text-xs font-semibold text-gray-400">플랫폼</th>
                            <th className="text-left py-2 px-3 text-xs font-semibold text-gray-400">상품명</th>
                            <th className="text-center py-2 px-3 text-xs font-semibold text-gray-400">수량</th>
                            <th className="text-right py-2 px-3 text-xs font-semibold text-gray-400">금액</th>
                            <th className="text-center py-2 px-3 text-xs font-semibold text-gray-400">구분</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((row, i) => (
                            <tr key={i} className="border-t border-gray-50 hover:bg-gray-50">
                              <td className="py-2 px-3">
                                <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-md">
                                  {row.mall_name}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-gray-700">{row.product_name}</td>
                              <td className="py-2 px-3 text-center text-gray-600">{row.quantity}</td>
                              <td className="py-2 px-3 text-right font-medium text-gray-700">
                                ₩{(row.amount || 0).toLocaleString()}
                              </td>
                              <td className="py-2 px-3 text-center">
                                {row.is_bundle ? (
                                  <span className="bg-cyan-100 text-cyan-700 text-xs px-2 py-0.5 rounded-md font-semibold">합구매</span>
                                ) : (
                                  <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-md">일반</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
