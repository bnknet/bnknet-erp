import { supabaseFetch, supabaseFetchAll } from './supabase';

// 재고 원가 변경 이력 (db/inventory_cost_logs.sql)
export interface CostLog {
  id: string;
  inventory_id?: string;
  product_name: string;
  company?: string;
  old_cost: number | null;
  new_cost: number;
  memo?: string | null;
  changed_by?: string;
  created_at: string;
}

// 원가 변경 1건 기록. 실패(테이블 미적용 등)하면 false — 호출부가 사용자에게 알린다.
export async function logCostChange(e: {
  inventory_id?: string; product_name: string; company?: string;
  old_cost: number | null; new_cost: number; memo?: string; changed_by?: string;
}): Promise<boolean> {
  try {
    const res = await supabaseFetch('/inventory_cost_logs', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{ ...e, memo: e.memo?.trim() || null }]),
    });
    return res.ok;
  } catch { return false; }
}

// 상품 1개의 원가 변경 이력(최신순). 조회 실패 시 빈 목록.
export async function loadCostLogs(inventoryId: string): Promise<CostLog[]> {
  try {
    return await supabaseFetchAll<CostLog>(`/inventory_cost_logs?inventory_id=eq.${inventoryId}&order=created_at.desc`);
  } catch { return []; }
}
