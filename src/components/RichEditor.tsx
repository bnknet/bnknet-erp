'use client';

import { useEffect, useRef } from 'react';

// 서식 에디터 (볼드·기울임·밑줄·글자크기·색상). 저장은 HTML.
// 보고서(회의록)·업무일지 등에서 공용으로 사용.
export default function RichEditor({ value, onChange, minHeight = '300px' }: { value: string; onChange: (html: string) => void; minHeight?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inited = useRef(false);
  useEffect(() => {
    if (ref.current && !inited.current) { ref.current.innerHTML = value || ''; inited.current = true; }
  }, [value]);
  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    if (ref.current) onChange(ref.current.innerHTML);
  };
  const COLORS = ['#111827', '#dc2626', '#2563eb', '#16a34a', '#d97706'];
  const btn = 'w-8 h-8 rounded hover:bg-gray-200 flex items-center justify-center text-gray-700';
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-400">
      <div className="flex flex-wrap items-center gap-1 bg-gray-50 border-b border-gray-200 px-2 py-1.5 no-print">
        <button type="button" title="굵게" onMouseDown={e => e.preventDefault()} onClick={() => exec('bold')} className={btn + ' font-bold'}>B</button>
        <button type="button" title="기울임" onMouseDown={e => e.preventDefault()} onClick={() => exec('italic')} className={btn + ' italic'}>I</button>
        <button type="button" title="밑줄" onMouseDown={e => e.preventDefault()} onClick={() => exec('underline')} className={btn + ' underline'}>U</button>
        <span className="w-px h-5 bg-gray-300 mx-1" />
        <select title="글자 크기" defaultValue="" onMouseDown={e => e.stopPropagation()}
          onChange={e => { exec('fontSize', e.target.value); e.currentTarget.selectedIndex = 0; }}
          className="h-8 rounded border border-gray-200 text-sm bg-white px-1">
          <option value="" disabled>크기</option>
          <option value="2">작게</option>
          <option value="3">보통</option>
          <option value="5">크게</option>
          <option value="6">더 크게</option>
        </select>
        <span className="w-px h-5 bg-gray-300 mx-1" />
        {COLORS.map(c => (
          <button key={c} type="button" title="글자 색" onMouseDown={e => e.preventDefault()} onClick={() => exec('foreColor', c)}
            className="w-6 h-6 rounded-full border border-gray-300" style={{ background: c }} />
        ))}
        <button type="button" title="서식 지우기" onMouseDown={e => e.preventDefault()} onClick={() => exec('removeFormat')}
          className="h-8 px-2 rounded hover:bg-gray-200 text-xs text-gray-500 ml-1">서식 지우기</button>
      </div>
      <div ref={ref} contentEditable suppressContentEditableWarning
        onInput={() => { if (ref.current) onChange(ref.current.innerHTML); }}
        className="px-4 py-3 text-base text-gray-800 focus:outline-none leading-relaxed overflow-y-auto"
        style={{ whiteSpace: 'pre-wrap', minHeight }} />
    </div>
  );
}
