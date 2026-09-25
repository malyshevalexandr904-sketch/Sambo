import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownLite } from './markdown-lite';

const html = (text: string): string => renderToStaticMarkup(createElement(MarkdownLite, { text }));

describe('MarkdownLite', () => {
  it('renders headings, paragraphs, lists, bold and italic', () => {
    expect(html('## Заголовок\n\nПервая строка\nвторая **важно** и _курсив_\n\n- один\n- два')).toBe(
      '<div><p class="mb-2 font-semibold text-slate-900">Заголовок</p>' +
        '<p class="mb-2">Первая строка<br/>вторая <strong>важно</strong> и <em>курсив</em></p>' +
        '<ul class="mb-2 list-disc pl-5"><li>один</li><li>два</li></ul></div>',
    );
  });

  it('never outputs HTML from the text', () => {
    const out = html('<script>alert(1)</script> <img src=x onerror=alert(1)> **<b>x</b>**');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('<strong>&lt;b&gt;x&lt;/b&gt;</strong>');
  });
});
