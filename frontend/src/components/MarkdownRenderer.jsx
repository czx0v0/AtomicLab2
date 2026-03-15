/**
 * 全局富文本与数学公式渲染：表格(GFM)、LaTeX、代码高亮、行内图片（含 Base64 data URL）。
 * 供阅读区 MinerU 结果、笔记卡片、AI 聊天等统一使用。
 */
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';

const defaultComponents = {
  img: ({ node, src, alt, ...props }) => (
    <img
      src={src || node?.properties?.src}
      alt={alt ?? node?.properties?.alt ?? ''}
      className="max-w-full h-auto rounded border border-gray-200"
      loading="lazy"
      {...props}
    />
  ),
};

export function MarkdownRenderer({ children, className, components }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex, rehypeHighlight]}
      className={className}
      components={{ ...defaultComponents, ...components }}
    >
      {children}
    </ReactMarkdown>
  );
}
