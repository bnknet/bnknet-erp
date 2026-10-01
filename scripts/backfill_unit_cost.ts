// 기존 주문에 '판매 시점 개당 원가(unit_cost)'를 현재 재고 원가로 한 번 채워 넣는 일괄 스크립트.
// 목적: 지금 화면에 보이는 공헌이익을 그대로 고정 → 이후 재고 원가를 바꿔도 과거 숫자가 변하지 않게.
// 선행: db/order_unit_cost.sql 실행.
// 실행: npx tsx scripts/backfill_unit_cost.ts          (점검만 — DB 변경 없음)
//       npx tsx scripts/backfill_unit_cost.ts --apply  (실제 반영)
// 재실행 안전: unit_cost 가 비어 있는(null) 주문만 채운다.
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

type Ord = {
  id: number; upload_date?: string; mall_name?: string; product_name?: string; collect_product?: string; collect_option?: string;
  quantity?: number; amount?: number; canceled?: boolean; company?: string; order_number?: string; delivery_fee?: number;
  source?: string; manual_cost?: number; manual_shipping?: number; unit_cost?: number | null;
};

async function main() {
  const APPLY = process.argv.includes('--apply');
  const { supabaseFetch, supabaseFetchAll } = await import('../src/lib/supabase');
  const { loadDbMatches } = await import('../src/lib/orderConvert');
  const { computeOrderLines, makeUnitCostResolver } = await import('../src/lib/salesStats');

  await loadDbMatches(true);
  const cols = 'id,upload_date,mall_name,product_name,collect_product,collect_option,quantity,amount,canceled,company,order_number,delivery_fee,source,manual_cost,manual_shipping,unit_cost';
  let colExists = true;
  const [orders, inventory, fees, bom, stRows, foRows] = await Promise.all([
    supabaseFetchAll<Ord>(`/orders?select=${cols}&order=id.asc`).catch(() => {
      colExists = false; // 컬럼 생성 전 → 점검만 가능
      return supabaseFetchAll<Ord>(`/orders?select=${cols.replace(',unit_cost', '')}&order=id.asc`);
    }),
    supabaseFetchAll<{ product_name: string; company?: string; brand?: string; cost_price?: number }>('/inventory?select=product_name,company,brand,cost_price'),
    supabaseFetchAll<{ company: string; mall: string; rate: number }>('/mall_fees?select=company,mall,rate'),
    supabaseFetchAll<{ set_name: string; component_name: string; component_qty: number }>('/product_bom?select=set_name,component_name,component_qty').catch(() => []),
    supabaseFetchAll<{ order_number: string; fee: number; cost: number; amount: number }>('/order_settlements?select=order_number,fee,cost,amount').catch(() => []),
    supabaseFetchAll<{ order_number: string; fee_rate: number }>('/order_fee_overrides?select=order_number,fee_rate').catch(() => []),
  ]);
  const settle = new Map<string, { fee: number; cost: number; amount: number }>();
  for (const s of stRows) if (s.order_number) settle.set(String(s.order_number), { fee: Number(s.fee) || 0, cost: Number(s.cost) || 0, amount: Number(s.amount) || 0 });
  const feeOverride = new Map<string, number>();
  for (const r of foRows) if (r.order_number) feeOverride.set(String(r.order_number), Number(r.fee_rate) || 0);

  // 대상: 일반/직접등록(수기) 주문 중 아직 원가가 기록되지 않은 것. (과거/도매/로켓그로스는 manual_cost 로 이미 고정)
  const FIXED = new Set(['과거', '도매', '로켓그로스']);
  const resolve = makeUnitCostResolver(inventory, bom);
  const targets = orders.filter((o) => !FIXED.has(String(o.source || '')) && (o.unit_cost === null || o.unit_cost === undefined));
  const byCost = new Map<number, number[]>();
  let unresolved = 0;
  const unresolvedNames = new Map<string, number>();
  for (const o of targets) {
    const c = resolve(o);
    if (c === null) {
      unresolved++;
      const nm = `${o.company || ''} | ${o.product_name || o.collect_product || ''}`;
      unresolvedNames.set(nm, (unresolvedNames.get(nm) || 0) + 1);
      continue;
    }
    const a = byCost.get(c) || []; a.push(o.id); byCost.set(c, a);
  }
  const fillCount = Array.from(byCost.values()).reduce((s, a) => s + a.length, 0);
  console.log(`전체 주문 ${orders.length}건 / 대상(원가 미기록 일반·수기) ${targets.length}건 → 기록 가능 ${fillCount}건, 원가 없음(그대로 둠) ${unresolved}건`);
  for (const [n, c] of Array.from(unresolvedNames.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`   원가 없음: ${n} — ${c}건`);

  // 검증: 스냅샷 적용 전/후 월별 공헌이익이 1원도 달라지지 않아야 한다.
  const monthly = (list: Ord[]) => {
    const { lines } = computeOrderLines(list, inventory, fees, bom, settle, feeOverride);
    const m = new Map<string, number>();
    for (const l of lines) if (l.profitKnown) m.set(l.date.slice(0, 7), (m.get(l.date.slice(0, 7)) || 0) + l.profit);
    return m;
  };
  const costById = new Map<number, number>();
  for (const [c, ids] of byCost) for (const id of ids) costById.set(id, c);
  const before = monthly(orders);
  const after = monthly(orders.map((o) => (costById.has(o.id) ? { ...o, unit_cost: costById.get(o.id) } : o)));
  let maxDiff = 0;
  for (const k of new Set([...before.keys(), ...after.keys()])) maxDiff = Math.max(maxDiff, Math.abs((before.get(k) || 0) - (after.get(k) || 0)));
  console.log(`검증: 월별 공헌이익 최대 차이 ${maxDiff.toFixed(4)}원 (${before.size}개월)`);
  for (const k of Array.from(before.keys()).sort().slice(-4)) console.log(`   ${k}: 전 ${Math.round(before.get(k) || 0).toLocaleString()} / 후 ${Math.round(after.get(k) || 0).toLocaleString()}`);
  if (maxDiff > 0.5) { console.error('❌ 전/후 공헌이익이 달라 중단합니다(반영 안 함).'); process.exit(1); }

  if (!colExists) { console.log('unit_cost 컬럼이 아직 없습니다 → 점검만 수행. db/order_unit_cost.sql 실행 후 --apply'); return; }
  if (!APPLY) { console.log('점검만 수행했습니다. 실제 반영은 --apply'); return; }

  let done = 0;
  for (const [c, ids] of byCost) {
    for (let i = 0; i < ids.length; i += 150) {
      const batch = ids.slice(i, i + 150);
      const res = await supabaseFetch(`/orders?id=in.(${batch.join(',')})&unit_cost=is.null&select=id`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ unit_cost: c }),
      });
      if (!res.ok) { console.error(`❌ 반영 실패 HTTP ${res.status} ${await res.text()}`); process.exit(1); }
      const saved = await res.json();
      done += Array.isArray(saved) ? saved.length : 0;
    }
  }
  console.log(`✅ 반영 완료 ${done}건 (예정 ${fillCount}건)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
