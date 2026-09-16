import { describe, expect, it } from 'vitest';
import { escapeHtml, markdownToText, renderMarkdown } from '../src/lib/markdown';

describe('renderMarkdown', () => {
  it('escapes raw HTML', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders headings, bold, italic and code', () => {
    const html = renderMarkdown('# Title\n\nHello **world** and *friends* with `code`.');
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('<em>friends</em>');
    expect(html).toContain('<code>code</code>');
  });

  it('renders safe links and rejects javascript: URLs', () => {
    const html = renderMarkdown('[ok](https://example.com) [bad](javascript:alert(1))');
    expect(html).toContain('<a href="https://example.com"');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<a href="#"');
  });

  it('renders lists, blockquotes and rules', () => {
    const html = renderMarkdown('- one\n- two\n\n> quoted\n\n---');
    expect(html).toContain('<ul');
    expect(html).toContain('<li');
    expect(html).toContain('<blockquote');
    expect(html).toContain('<hr');
  });
});

describe('markdownToText', () => {
  it('strips formatting and keeps link URLs', () => {
    const text = markdownToText('# Hi\n\n**bold** [site](https://example.com)');
    expect(text).toBe('Hi\n\nbold site (https://example.com)');
  });
});

describe('escapeHtml', () => {
  it('escapes the five dangerous characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
