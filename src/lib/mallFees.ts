// 몰별 수수료 — 영업이익 계산용 공용 로직
// 주문 mall_name(사방넷/몰 표기 제각각)을 수수료표의 정규 몰명으로 맞춘다.

export interface MallFee {
  company: string;
  mall: string;
  rate: number; // %
}

// 판매몰명 정규화 — 표기 흔들림(G마켓/지마켓/ESM지마켓 등)을 정규 키로 통일
export function normalizeMall(raw: string): string {
  const s = (raw || '').toLowerCase().replace(/\s/g, '');
  if (!s) return '';
  if (s.includes('로켓그로스')) return '쿠팡로켓그로스';
  if (s.includes('쿠팡') || s.includes('coupang')) return '쿠팡';
  if (s.includes('스마트스토어') || s.includes('스토어팜') || s.includes('스마트')) return '스마트스토어';
  if (s.includes('지마켓') || s.includes('gmarket') || s.includes('g마켓')) return 'G마켓';
  if (s.includes('옥션') || s.includes('auction')) return '옥션';
  if (s.includes('11번가') || s.includes('11st') || s.includes('십일번가')) return '11번가';
  if (s.includes('토스')) return '토스';
  if (s.includes('ssg') || s.includes('에스에스지')) return 'SSG';
  if (s.includes('hmall') || s.includes('h몰') || s.includes('현대')) return 'Hmall';
  if (s.includes('롯데')) return '롯데온';
  if (s.includes('인터파크')) return '인터파크';
  if (s.includes('카카오')) return '카카오스토어';
  if (s.includes('자사') && s.includes('npay')) return '자사몰Npay';
  if (s.includes('자사') || s.includes('자체')) return '자사몰직접결제';
  if (s.includes('공구')) return '공구';
  return (raw || '').trim();
}

// 수수료 조회용 맵 빌드: `${company}|${정규몰명}` → rate(%)
export function buildFeeMap(fees: MallFee[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of fees) {
    if (!f.company || !f.mall) continue;
    m.set(`${f.company}|${f.mall}`, Number(f.rate) || 0);
  }
  return m;
}

// 한 주문의 수수료 금액 계산. 요율 미설정이면 found=false (경고 처리용, 0 반영)
export function lookupFee(
  feeMap: Map<string, number>,
  company: string,
  mallName: string,
  amount: number,
): { fee: number; rate: number; found: boolean } {
  const key = `${company}|${normalizeMall(mallName)}`;
  if (feeMap.has(key)) {
    const rate = feeMap.get(key)!;
    return { fee: Math.round((amount * rate) / 100), rate, found: true };
  }
  return { fee: 0, rate: 0, found: false };
}
