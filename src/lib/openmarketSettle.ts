// 오픈마켓 정산 리포트(옥션·지마켓·11번가) 파싱
// 사방넷 주문번호별로 실수수료(서비스이용료)·실원가(원가X수량)를 합산 → ERP 주문에 붙일 보정값.
// 매출(판매금액)은 ERP가 이미 정확하므로 보정하지 않는다. 수수료·원가만 실제 정산값으로 교체한다.
import type * as XLSXType from 'xlsx';

export interface SettleRow {
  order_number: string; // 사방넷 주문번호 (= ERP orders.order_number)
  amount: number;       // 실판매금액 합 (판매금액 — admin 기준, 쿠폰 반영된 정확값)
  fee: number;          // 마켓 실공제 총액 합 = 판매금액 − 정산예정금액 (서비스이용료 + 판매촉진비·적립금 등 전부)
  cost: number;         // 실원가 합 (원가X수량)
  company: string;      // 사업자 (시트명 기준)
  market: string;       // 마켓 (판매아이디 기준: 옥션/지마켓/11번가)
  lineCount: number;    // 이 주문번호에 묶인 라인 수
}

export interface ParseResult {
  rows: SettleRow[];
  totalLines: number;   // 읽은 데이터 라인 수
  skippedNoOrder: number; // 사방넷 주문번호 없어 제외된 라인 수
}

// 시트명 → ERP 사업자 코드
const COMPANY_BY_SHEET: Record<string, string> = {
  '비엔케이': 'BNKNET', '비앤케이': 'BNKNET', 'BNKNET': 'BNKNET',
  '더블아이': '더블아이', '더블': '더블아이',
};
function companyOf(sheet: string): string {
  for (const k of Object.keys(COMPANY_BY_SHEET)) if (sheet.includes(k)) return COMPANY_BY_SHEET[k];
  return sheet.trim();
}
function marketOf(sellerId: string): string {
  const s = String(sellerId);
  if (s.includes('옥션')) return '옥션';
  if (s.includes('지마켓') || s.toLowerCase().includes('gmarket')) return '지마켓';
  if (s.includes('11번가')) return '11번가';
  return '기타';
}
const num = (v: unknown) => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;

// 헤더 표기 흔들림 대비(공백 제거 비교)
function pick(row: Record<string, unknown>, ...names: string[]): unknown {
  const norm = (s: string) => s.replace(/\s+/g, '');
  const map = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) map.set(norm(k), v);
  for (const n of names) { const hit = map.get(norm(n)); if (hit !== undefined) return hit; }
  return undefined;
}

export function parseSettleWorkbook(XLSX: typeof XLSXType, wb: XLSXType.WorkBook): ParseResult {
  const agg = new Map<string, SettleRow>();
  let totalLines = 0, skippedNoOrder = 0;
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    const company = companyOf(sheetName);
    for (const r of rows) {
      const on = String(pick(r, '사방넷 주문번호', '사방넷주문번호') ?? '').trim();
      totalLines++;
      if (!on) { skippedNoOrder++; continue; }
      const amount = num(pick(r, '판매금액'));
      // 수수료 = 마켓이 실제 떼가는 총 공제액 = 판매금액 − 정산예정금액.
      // (서비스이용료만으로는 판매촉진비·적립금 등 기타 공제가 빠져 마진이 과대계상됨)
      const settle = num(pick(r, '정산예정금액'));
      const fee = amount - settle;
      const cost = num(pick(r, '원가X수량', '원가x수량'));
      const market = marketOf(pick(r, '판매아이디') as string);
      const prev = agg.get(on);
      if (prev) {
        prev.amount += amount; prev.fee += fee; prev.cost += cost; prev.lineCount++;
      } else {
        agg.set(on, { order_number: on, amount, fee, cost, company, market, lineCount: 1 });
      }
    }
  }
  return { rows: [...agg.values()], totalLines, skippedNoOrder };
}
