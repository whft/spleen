import React from 'react';
import { RiCheckLine, RiFileCopyLine, RiSparklingLine } from '@remixicon/react';

const Spoiler: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [revealed, setRevealed] = React.useState(false);
  return (
    <button
      type="button"
      onClick={() => setRevealed((v) => !v)}
      className={`inline rounded px-1 py-0.5 text-left transition ${
        revealed ? 'bg-muted/80 text-foreground' : 'bg-foreground/90 text-transparent hover:bg-foreground'
      }`}
    >
      {children}
    </button>
  );
};

const formatDiscordTimestamp = (unixSec: number, style: string): string => {
  const date = new Date(unixSec * 1000);
  if (Number.isNaN(date.getTime())) return `<t:${unixSec}:${style}>`;
  switch (style) {
    case 't': return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    case 'T': return date.toLocaleTimeString();
    case 'd': return date.toLocaleDateString();
    case 'D': return date.toLocaleDateString([], { dateStyle: 'long' });
    case 'f': return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    case 'F': return date.toLocaleString([], { dateStyle: 'full', timeStyle: 'short' });
    case 'R': {
      const diff = Math.round((unixSec * 1000 - Date.now()) / 1000);
      const abs = Math.abs(diff);
      if (abs < 60) return diff >= 0 ? `in ${abs}s` : `${abs}s ago`;
      if (abs < 3600) { const m = Math.round(abs / 60); return diff >= 0 ? `in ${m}m` : `${m}m ago`; }
      if (abs < 86400) { const h = Math.round(abs / 3600); return diff >= 0 ? `in ${h}h` : `${h}h ago`; }
      const d = Math.round(abs / 86400);
      return diff >= 0 ? `in ${d}d` : `${d}d ago`;
    }
    default: return date.toLocaleString();
  }
};

const CodeBlock: React.FC<{
  lang: string;
  code: string;
  onAskAi?: (prompt: string) => void;
}> = ({ lang, code, onAskAi }) => {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="my-1.5 overflow-hidden rounded-md border border-border/70 bg-muted/50">
      <div className="flex items-center justify-between border-b border-border/50 bg-muted/80 px-2.5 py-1 text-[10px] text-muted-foreground">
        <span className="font-mono uppercase">{lang || 'code'}</span>
        <div className="flex items-center gap-1.5">
          {onAskAi ? (
            <button
              type="button"
              onClick={() => onAskAi(`Explain and analyze this ${lang || 'Discord'} snippet:\n\`\`\`${lang}\n${code}\n\`\`\``)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10"
            >
              <RiSparklingLine className="h-3 w-3" />
              Ask AI
            </button>
          ) : null}
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] hover:bg-background/80"
          >
            {copied ? <RiCheckLine className="h-3 w-3 text-emerald-400" /> : <RiFileCopyLine className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
};

const renderInlineTokens = (
  text: string,
  mentionNames?: ReadonlyMap<string, string>,
  channelNames?: ReadonlyMap<string, string>,
  roleNames?: ReadonlyMap<string, string>,
): React.ReactNode[] => {
  const tokenRe = /(<(a?):([a-zA-Z0-9_]+):(\d+)>)|(<t:(\d+)(?::([tTdDfFR]))?>)|(<@!?(\d+)>)|(<#(\d+)>)|(<@&(\d+)>)|(\|\|([^|]+)\|\|)|(`([^`\n]+)`)|(\*\*\*([^*]+)\*\*\*)|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*\n]+)\*)|(~~([^~]+)~~)|(https?:\/\/[^\s<>()]+)/g;
  const out: React.ReactNode[] = [];
  let lastIdx = 0;
  let k = 0;
  for (const m of text.matchAll(tokenRe)) {
    const idx = m.index ?? 0;
    if (idx > lastIdx) out.push(text.slice(lastIdx, idx));
    const key = `tok-${k++}`;
    if (m[1]) {
      const animated = m[2] === 'a';
      out.push(
        <img
          key={key}
          src={`https://cdn.discordapp.com/emojis/${m[4]}.${animated ? 'gif' : 'webp'}?size=48`}
          alt={`:${m[3]}:`}
          title={`:${m[3]}:`}
          className="inline-block h-5 w-5 align-text-bottom object-contain"
        />,
      );
    } else if (m[5]) {
      out.push(
        <span key={key} className="rounded bg-muted px-1 py-0.5 text-[11px] font-medium">
          {formatDiscordTimestamp(Number(m[6]), m[7] || 'f')}
        </span>,
      );
    } else if (m[8]) {
      const label = mentionNames?.get(m[9]) ?? m[9];
      out.push(<span key={key} className="rounded bg-[#5865F2]/20 px-1 py-0.5 font-medium text-[#7289da]">@{label}</span>);
    } else if (m[10]) {
      const label = channelNames?.get(m[11]) ?? m[11];
      out.push(<span key={key} className="rounded bg-[#5865F2]/20 px-1 py-0.5 font-medium text-[#7289da]">#{label}</span>);
    } else if (m[12]) {
      const label = roleNames?.get(m[13]) ?? 'role';
      out.push(<span key={key} className="rounded bg-primary/15 px-1 py-0.5 font-medium text-primary">@{label}</span>);
    } else if (m[14]) {
      out.push(<Spoiler key={key}>{m[15]}</Spoiler>);
    } else if (m[16]) {
      out.push(<code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{m[17]}</code>);
    } else if (m[18]) {
      out.push(<strong key={key}><em>{m[19]}</em></strong>);
    } else if (m[20]) {
      out.push(<strong key={key}>{m[21]}</strong>);
    } else if (m[22]) {
      out.push(<u key={key}>{m[23]}</u>);
    } else if (m[24]) {
      out.push(<em key={key}>{m[25]}</em>);
    } else if (m[26]) {
      out.push(<del key={key}>{m[27]}</del>);
    } else if (m[28]) {
      out.push(
        <a key={key} href={m[28]} target="_blank" rel="noreferrer" className="text-sky-400 underline break-all hover:opacity-80">
          {m[28]}
        </a>,
      );
    }
    lastIdx = idx + m[0].length;
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx));
  return out;
};

export const DiscordMarkdown: React.FC<{
  content: string;
  mentionNames?: ReadonlyMap<string, string>;
  channelNames?: ReadonlyMap<string, string>;
  roleNames?: ReadonlyMap<string, string>;
  onAskAi?: (prompt: string) => void;
}> = ({ content, mentionNames, channelNames, roleNames, onAskAi }) => {
  if (!content) return null;
  const parts: React.ReactNode[] = [];
  const fenceRe = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let blockKey = 0;

  const pushTextChunk = (chunk: string) => {
    const lines = chunk.split('\n');
    lines.forEach((line, idx) => {
      const k = `line-${blockKey++}`;
      if (line.startsWith('> ')) {
        parts.push(
          <div key={k} className="border-l-2 border-muted-foreground/50 pl-2 text-muted-foreground">
            {renderInlineTokens(line.slice(2), mentionNames, channelNames, roleNames)}
          </div>,
        );
      } else {
        parts.push(
          <React.Fragment key={k}>
            {renderInlineTokens(line, mentionNames, channelNames, roleNames)}
            {idx < lines.length - 1 ? <br /> : null}
          </React.Fragment>,
        );
      }
    });
  };

  for (const match of content.matchAll(fenceRe)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) pushTextChunk(content.slice(lastIndex, idx));
    parts.push(<CodeBlock key={`cb-${blockKey++}`} lang={match[1] || ''} code={match[2] ?? ''} onAskAi={onAskAi} />);
    lastIndex = idx + match[0].length;
  }
  if (lastIndex < content.length) pushTextChunk(content.slice(lastIndex));

  return <div className="text-[13px] leading-[1.45] break-words">{parts}</div>;
};
