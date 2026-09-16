// Small, dependency-free Markdown subset renderer for campaign emails.
// Everything is HTML-escaped first; only an explicit whitelist of formatting is
// turned back into tags. Link URLs are scheme-checked.
//
// Supported: paragraphs, # headings, > blockquotes, -/* unordered lists,
// 1. ordered lists, --- rules, **bold**, *italic* / _italic_, `code`,
// [links](https://...) and ![images](https://...).

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return escapeHtml(trimmed);
  return '#';
}

/** Inline formatting. Input is already HTML-escaped. */
function inline(text: string): string {
  const codeSpans: string[] = [];
  let out = text.replace(/`([^`]+)`/g, (_m, code: string) => {
    const token = `\u0000C${codeSpans.length}\u0000`;
    codeSpans.push(`<code>${code}</code>`);
    return token;
  });

  // Links before emphasis so URLs containing * don't get mangled.
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_m, alt: string, url: string, title: string | undefined) => {
    const t = title ? ` title="${title}"` : '';
    return `<img src="${safeUrl(url)}" alt="${alt}"${t} style="max-width:100%;border-radius:8px">`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_m, label: string, url: string, title: string | undefined) => {
    const t = title ? ` title="${title}"` : '';
    return `<a href="${safeUrl(url)}"${t} style="color:#2563eb">${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  return out.replace(/\u0000C(\d+)\u0000/g, (_m, i: string) => codeSpans[Number(i)] ?? '');
}

function paragraph(lines: string[]): string {
  return `<p style="margin:0 0 16px">${lines.join(' ')}</p>`;
}

export function renderMarkdown(markdown: string): string {
  const source = escapeHtml(markdown.replace(/\r\n?/g, '\n').replace(/\u0000/g, '')).split('\n');
  const html: string[] = [];
  let i = 0;

  while (i < source.length) {
    const line = source[i]!;
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (/^(---+|\*\*\*+|___+)$/.test(trimmed)) {
      html.push('<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">');
      i++;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = heading[1]!.length;
      const sizes = ['26px', '22px', '18px', '16px'];
      html.push(
        `<h${level} style="margin:24px 0 12px;font-size:${sizes[level - 1]};line-height:1.3">${inline(heading[2]!)}</h${level}>`,
      );
      i++;
      continue;
    }

    // Note: `>` was escaped to `&gt;` above, so match the escaped form.
    if (/^&gt;\s?/.test(trimmed)) {
      const quote: string[] = [];
      while (i < source.length && /^&gt;\s?/.test(source[i]!.trim())) {
        quote.push(source[i]!.trim().replace(/^&gt;\s?/, ''));
        i++;
      }
      html.push(
        `<blockquote style="margin:0 0 16px;padding:8px 16px;border-left:3px solid #d1d5db;color:#4b5563">${inline(quote.join(' '))}</blockquote>`,
      );
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < source.length && /^\s*[-*]\s+/.test(source[i]!)) {
        items.push(source[i]!.trim().replace(/^[-*]\s+/, ''));
        i++;
      }
      html.push(
        `<ul style="margin:0 0 16px;padding-left:24px">${items
          .map((item) => `<li style="margin:4px 0">${inline(item)}</li>`)
          .join('')}</ul>`,
      );
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < source.length && /^\s*\d+[.)]\s+/.test(source[i]!)) {
        items.push(source[i]!.trim().replace(/^\d+[.)]\s+/, ''));
        i++;
      }
      html.push(
        `<ol style="margin:0 0 16px;padding-left:24px">${items
          .map((item) => `<li style="margin:4px 0">${inline(item)}</li>`)
          .join('')}</ol>`,
      );
      continue;
    }

    const para: string[] = [];
    while (i < source.length) {
      const current = source[i]!.trim();
      if (!current || /^(#{1,4})\s+/.test(current) || /^[-*]\s+/.test(current) || /^\d+[.)]\s+/.test(current)) break;
      if (/^&gt;\s?/.test(current) || /^(---+|\*\*\*+|___+)$/.test(current)) break;
      para.push(current);
      i++;
    }
    if (para.length) html.push(paragraph(para.map((p) => inline(p))));
  }

  return html.join('\n');
}

/** Markdown -> plain text for the `text/plain` alternative part. */
export function markdownToText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/^(#{1,6})\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*]\s+/gm, '- ')
    .replace(/^\s*\d+[.)]\s+/gm, (m) => m)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function excerpt(markdown: string, length = 140): string {
  const text = markdownToText(markdown).replace(/\s+/g, ' ');
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}
