import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownContent, MermaidCodeFallback } from './MarkdownContent';

describe('MarkdownContent', () => {
  it('渲染常规 Markdown 内容', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        value={[
          '## 方案',
          '',
          '- 调整过程记录',
          '- 渲染 `markdown`',
          '',
          '| 项 | 值 |',
          '| --- | --- |',
          '| 状态 | 可读 |',
        ].join('\n')}
      />,
    );

    expect(html).toContain('<h2');
    expect(html).toContain('<ul');
    expect(html).toContain('<code');
    expect(html).toContain('<table');
  });

  it('为链接添加新窗口和 noreferrer', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent value="[Along](https://example.com)" />,
    );

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it('不注入 Markdown 原始 HTML', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent value={'<script>alert("x")</script>'} />,
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('将 mermaid 代码块渲染为图表容器', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        value={'```mermaid\nflowchart TD\n  A[计划] --> B[实现]\n```'}
      />,
    );

    expect(html).toContain('data-mermaid-diagram');
    expect(html).toContain('flowchart TD');
  });

  it('Mermaid 异常时可回退显示原始代码', () => {
    const html = renderToStaticMarkup(
      <MermaidCodeFallback chart="flowchart TD" error="parse error" />,
    );

    expect(html).toContain('Mermaid 渲染失败');
    expect(html).toContain('flowchart TD');
  });
});
