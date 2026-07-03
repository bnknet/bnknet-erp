'use client';

import { useState, useEffect } from 'react';
import { supabaseFetch } from '@/lib/supabase';
import { getUser } from '@/lib/auth';

interface Notice {
  id: string;
  title: string;
  content: string;
  author_name: string;
  is_pinned: boolean;
  created_at: string;
}

interface Comment {
  id: string;
  notice_id: string;
  author_id: string | null;
  author_name: string;
  content: string;
  created_at: string;
}

// 직급이 비어있을 때 role로 대체 표시 (HR과 동일 라벨)
const ROLE_LABELS: Record<string, string> = {
  ceo: '대표', admin: '실장', manager: '실장', sales: '매출 담당', inventory: '재고·주문 담당', md: 'MD',
};

type View = 'list' | 'detail' | 'write';

export default function NoticesContent() {
  const user = getUser();
  // 공지 등록·수정·삭제 = 대표·실장 + MD(손사빈 과장)
  const isAdmin = user?.role === 'ceo' || user?.role === 'admin' || user?.role === 'md';

  const [view, setView] = useState<View>('list');
  const [notices, setNotices] = useState<Notice[]>([]);
  const [selected, setSelected] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({ title: '', content: '', is_pinned: false });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // 댓글
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({}); // notice_id → 댓글 수
  const [empById, setEmpById] = useState<Record<string, { position: string; role: string }>>({});
  const [empByName, setEmpByName] = useState<Record<string, { position: string; role: string }>>({});

  useEffect(() => { loadNotices(); loadCommentCounts(); loadEmployees(); }, []);

  async function loadCommentCounts() {
    try {
      const res = await supabaseFetch('/notice_comments?select=notice_id');
      const data = await res.json();
      const counts: Record<string, number> = {};
      if (Array.isArray(data)) for (const r of data) counts[r.notice_id] = (counts[r.notice_id] || 0) + 1;
      setCommentCounts(counts);
    } catch { /* 테이블 없거나 조회 실패해도 목록은 정상 */ }
  }

  async function loadEmployees() {
    try {
      const res = await supabaseFetch('/employees?select=id,name,position,role');
      const data = await res.json();
      const byId: Record<string, { position: string; role: string }> = {};
      const byName: Record<string, { position: string; role: string }> = {};
      if (Array.isArray(data)) for (const e of data) {
        const v = { position: e.position || '', role: e.role || '' };
        if (e.id) byId[e.id] = v;
        if (e.name) byName[e.name] = v;
      }
      setEmpById(byId); setEmpByName(byName);
    } catch { /* 직급 조회 실패해도 이름은 정상 표시 */ }
  }

  // 작성자 직급: employees.position 우선, 없으면 role 라벨
  function authorTitle(c: Comment): string {
    const emp = (c.author_id && empById[c.author_id]) || empByName[c.author_name];
    if (!emp) return '';
    return (emp.position && emp.position.trim()) || ROLE_LABELS[emp.role] || '';
  }

  async function loadNotices() {
    setLoading(true);
    try {
      const res = await supabaseFetch('/notices?order=is_pinned.desc,created_at.desc&limit=100');
      const data = await res.json();
      setNotices(Array.isArray(data) ? data : []);
    } catch { setNotices([]); }
    finally { setLoading(false); }
  }

  async function handleSave() {
    if (!form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      if (editId) {
        await supabaseFetch(`/notices?id=eq.${editId}`, {
          method: 'PATCH',
          body: JSON.stringify({ title: form.title, content: form.content, is_pinned: form.is_pinned, updated_at: new Date().toISOString() }),
        });
      } else {
        await supabaseFetch('/notices', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            title: form.title,
            content: form.content,
            is_pinned: form.is_pinned,
            author_name: user?.name || '관리자',
            author_id: user?.id || null,
          }),
        });
      }
      setForm({ title: '', content: '', is_pinned: false });
      setEditId(null);
      setView('list');
      await loadNotices();
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('공지사항을 삭제하시겠습니까?')) return;
    await supabaseFetch(`/notices?id=eq.${id}`, { method: 'DELETE' });
    setView('list');
    setSelected(null);
    await loadNotices();
  }

  function openDetail(n: Notice) {
    setSelected(n);
    setView('detail');
    setCommentText('');
    loadComments(n.id);
  }

  async function loadComments(noticeId: string) {
    try {
      const res = await supabaseFetch(`/notice_comments?notice_id=eq.${noticeId}&order=created_at.asc`);
      const data = await res.json();
      setComments(Array.isArray(data) ? data : []);
    } catch { setComments([]); }
  }

  async function addComment() {
    if (!selected || !commentText.trim()) return;
    setCommentSaving(true);
    try {
      await supabaseFetch('/notice_comments', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          notice_id: selected.id,
          content: commentText.trim(),
          author_name: user?.name || '직원',
          author_id: user?.id || null,
        }),
      });
      setCommentText('');
      await loadComments(selected.id);
      await loadCommentCounts();
    } finally { setCommentSaving(false); }
  }

  async function deleteComment(c: Comment) {
    if (!confirm('댓글을 삭제하시겠습니까?')) return;
    await supabaseFetch(`/notice_comments?id=eq.${c.id}`, { method: 'DELETE' });
    if (selected) await loadComments(selected.id);
    await loadCommentCounts();
  }

  // 본인 댓글 또는 대표·실장이면 삭제 가능
  function canDeleteComment(c: Comment) {
    return isAdmin || (!!user?.id && c.author_id === user.id);
  }

  function openWrite(n?: Notice) {
    if (n) {
      setForm({ title: n.title, content: n.content, is_pinned: n.is_pinned });
      setEditId(n.id);
    } else {
      setForm({ title: '', content: '', is_pinned: false });
      setEditId(null);
    }
    setView('write');
  }

  function formatDate(s: string) {
    return new Date(s).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function formatDateTime(s: string) {
    return new Date(s).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // 목록
  if (view === 'list') return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-base text-gray-400">총 {notices.length}개의 공지</p>
        {isAdmin && (
          <button
            onClick={() => openWrite()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-base font-medium transition-colors"
          >
            + 공지 작성
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-400">불러오는 중...</div>
        ) : notices.length === 0 ? (
          <div className="text-center py-12 text-gray-400">등록된 공지사항이 없습니다</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left py-3 px-5 text-sm font-semibold text-gray-400 w-24 whitespace-nowrap">구분</th>
                <th className="text-left py-3 px-5 text-sm font-semibold text-gray-400">제목</th>
                <th className="text-left py-3 px-5 text-sm font-semibold text-gray-400 w-24 whitespace-nowrap hidden sm:table-cell">작성자</th>
                <th className="text-left py-3 px-5 text-sm font-semibold text-gray-400 w-36 whitespace-nowrap hidden sm:table-cell">날짜</th>
              </tr>
            </thead>
            <tbody>
              {notices.map((n) => (
                <tr
                  key={n.id}
                  onClick={() => openDetail(n)}
                  className={`border-b border-gray-50 cursor-pointer hover:bg-blue-50/50 transition-colors ${n.is_pinned ? 'bg-yellow-50/50' : ''}`}
                >
                  <td className="py-3.5 px-5 whitespace-nowrap">
                    {n.is_pinned
                      ? <span className="bg-red-100 text-red-600 text-sm px-2 py-0.5 rounded-md font-semibold whitespace-nowrap">공지</span>
                      : <span className="text-gray-300 text-sm whitespace-nowrap">일반</span>}
                  </td>
                  <td className="py-3.5 px-5 text-gray-700 font-medium text-base">
                    <span className="inline-flex items-center gap-1.5 flex-wrap">
                      {n.title}
                      {commentCounts[n.id] > 0 && (
                        <span className="text-xs text-blue-600 bg-blue-50 rounded-full px-2 py-0.5 font-semibold whitespace-nowrap">💬 {commentCounts[n.id]}</span>
                      )}
                    </span>
                  </td>
                  <td className="py-3.5 px-5 text-gray-400 text-base whitespace-nowrap hidden sm:table-cell">{n.author_name}</td>
                  <td className="py-3.5 px-5 text-gray-400 text-base whitespace-nowrap hidden sm:table-cell">{formatDate(n.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  // 상세
  if (view === 'detail' && selected) return (
    <div className="space-y-4">
      <button onClick={() => setView('list')} className="text-base text-blue-600 hover:text-blue-700 flex items-center gap-1">
        ← 목록으로
      </button>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            {selected.is_pinned && (
              <span className="bg-red-100 text-red-600 text-sm px-2 py-0.5 rounded-md font-semibold">공지</span>
            )}
            <h2 className="text-xl font-bold text-gray-800">{selected.title}</h2>
          </div>
          {isAdmin && (
            <div className="flex gap-2 flex-shrink-0 ml-4">
              <button
                onClick={() => openWrite(selected)}
                className="px-3 py-1.5 text-base text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
              >
                수정
              </button>
              <button
                onClick={() => handleDelete(selected.id)}
                className="px-3 py-1.5 text-base text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                삭제
              </button>
            </div>
          )}
        </div>
        <div className="text-base text-gray-400 mb-5">
          {selected.author_name} · {formatDate(selected.created_at)}
        </div>
        <div className="text-gray-700 leading-relaxed whitespace-pre-wrap border-t border-gray-100 pt-5">
          {selected.content}
        </div>

        {/* 댓글 */}
        <div className="border-t border-gray-100 mt-6 pt-5">
          <h3 className="text-base font-semibold text-gray-700 mb-4">댓글 {comments.length > 0 && <span className="text-blue-600">{comments.length}</span>}</h3>

          {comments.length > 0 && (
            <ul className="space-y-3 mb-5">
              {comments.map((c) => (
                <li key={c.id} className="bg-gray-50 rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700">
                      {c.author_name}
                      {authorTitle(c) && <span className="text-gray-400 font-normal"> · {authorTitle(c)}</span>}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{formatDateTime(c.created_at)}</span>
                      {canDeleteComment(c) && (
                        <button
                          onClick={() => deleteComment(c)}
                          className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-base text-gray-700 whitespace-pre-wrap break-words">{c.content}</p>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2 items-end">
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addComment(); }}
              placeholder="댓글을 입력하세요 (Ctrl/⌘+Enter 등록)"
              rows={2}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-base text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <button
              onClick={addComment}
              disabled={commentSaving || !commentText.trim()}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl font-medium text-base transition-colors whitespace-nowrap flex-shrink-0"
            >
              {commentSaving ? '등록 중' : '등록'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // 작성/수정
  return (
    <div className="space-y-4">
      <button onClick={() => { setView('list'); setEditId(null); }} className="text-base text-blue-600 hover:text-blue-700">
        ← 목록으로
      </button>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-5">{editId ? '공지 수정' : '공지 작성'}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">제목</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="공지 제목을 입력하세요"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">내용</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder="공지 내용을 입력하세요"
              rows={10}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_pinned}
              onChange={(e) => setForm({ ...form, is_pinned: e.target.checked })}
              className="w-4 h-4 accent-blue-600"
            />
            <span className="text-base text-gray-700">상단 고정 (중요 공지)</span>
          </label>
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving || !form.title.trim() || !form.content.trim()}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl font-medium text-base transition-colors"
            >
              {saving ? '저장 중...' : editId ? '수정 완료' : '작성 완료'}
            </button>
            <button
              onClick={() => { setView('list'); setEditId(null); }}
              className="px-6 py-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl font-medium text-base hover:bg-gray-50 transition-colors"
            >
              취소
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
