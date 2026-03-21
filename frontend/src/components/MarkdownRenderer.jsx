/**
 * 全局 Markdown：GFM 表格、LaTeX（$...$/$$...$$）、代码高亮、行内 HTML（经 sanitize 的 sup/sub 等）。
 */
import React from 'react';
import ReactMarkdown from 'react-markdown';
import { ErrorBoundary } from './ErrorBoundary';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';

const defaultComponents = {
  /** 显式提供 code/pre，避免 rehype-highlight 与 react-markdown 组合时出现无效元素类型 (React #130) */
  code: ({ className, children, inline, ...props }) => (
    <code className={className} {...props}>{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg border border-slate-200 bg-slate-900/90 p-3 text-sm text-slate-100">{children}</pre>
  ),
  img: ({ node, src, alt, ...props }) => {
    const rawSrc = src || node?.properties?.src || '';
    const safeDecode = (s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    };
    const normalizeParseImageSrc = (input) => {
      const s = String(input || '');
      if (!s.startsWith('/api/parse-images/')) return s;
      const parts = s.split('/');
      // ['', 'api', 'parse-images', stem, file]
      if (parts.length < 5) return s;
      const stem = parts[3] ? encodeURIComponent(safeDecode(parts[3])) : parts[3];
      const file = parts.slice(4).join('/');
      const encodedFile = file
        .split('/')
        .map((seg) => (seg ? encodeURIComponent(safeDecode(seg)) : seg))
        .join('/');
      return `/api/parse-images/${stem}/${encodedFile}`;
    };
    const realSrc = normalizeParseImageSrc(rawSrc);
    const isInlineBase64 = /^data:image\/[a-zA-Z]+;base64,/.test(realSrc);
    return (
      <img
        src={realSrc}
        alt={alt ?? node?.properties?.alt ?? ''}
        className={
          isInlineBase64
            ? 'max-w-full h-auto rounded-lg border border-slate-200 my-2 shadow-sm'
            : 'max-w-full h-auto rounded border border-gray-200'
        }
        style={{ maxWidth: '100%' }}
        loading="lazy"
        {...props}
      />
    );
  },
  table: ({ children }) => (
    <div className="my-2 w-full overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full border-collapse text-sm text-slate-800">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-slate-50">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-slate-200 px-2 py-1.5 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-slate-200 px-2 py-1.5 align-top">{children}</td>
  ),
};

function mergeMarkdownComponents(base, extra) {
  const out = { ...base };
  Object.entries(extra || {}).forEach(([k, v]) => {
    if (typeof v === 'function') out[k] = v;
  });
  return out;
}

export function MarkdownRenderer({ children, className = '', components = {} }) {
  const merged = mergeMarkdownComponents(defaultComponents, components);
  return (
    <ErrorBoundary context="MarkdownRenderer / ReactMarkdown">
      <div className={className}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeKatex, rehypeHighlight]}
          components={merged}
        >
          {children}
        </ReactMarkdown>
      </div>
    </ErrorBoundary>
  );
}
