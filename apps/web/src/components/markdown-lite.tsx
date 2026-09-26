// Безопасный показ текста в Markdown без HTML: заголовки, абзацы, списки, **жирный** и _курсив_.
// Разметка превращается в React-элементы — вставки HTML нет (ARCHITECTURE.md, 23: без dangerouslySetInnerHTML).
import { Fragment, type ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const bold = m[1] ?? m[2];
    if (bold !== undefined) out.push(<strong key={m.index}>{bold}</strong>);
    else out.push(<em key={m.index}>{m[3] ?? m[4]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MarkdownLite({ text, className }: { text: string; className?: string }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <div className={className}>
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim() !== '');
        if (lines.length === 0) return null;
        const heading = /^(#{1,6})\s+(.*)$/.exec(lines[0] ?? '');
        if (heading)
          return (
            <Fragment key={i}>
              <p className="mb-2 font-semibold text-slate-900">{inline(heading[2] ?? '')}</p>
              {lines.length > 1 ? <p className="mb-2">{inline(lines.slice(1).join(' '))}</p> : null}
            </Fragment>
          );
        if (lines.every((l) => /^\s*[-*]\s+/.test(l)))
          return (
            <ul key={i} className="mb-2 list-disc pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ''))}</li>
              ))}
            </ul>
          );
        return (
          <p key={i} className="mb-2">
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 ? <br /> : null}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
