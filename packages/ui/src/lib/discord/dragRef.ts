export const DISCORD_REF_MIME = 'application/x-spleen-discord-ref';

export type DiscordDragRef =
  | {
      kind: 'message';
      channelId: string;
      channelName?: string | null;
      guildId?: string | null;
      guildName?: string | null;
      messageId: string;
      author: string;
      content: string;
      timestamp?: string | null;
      attachments?: Array<{ filename: string; url: string; contentType?: string | null }>;
    }
  | {
      kind: 'channel';
      channelId: string;
      channelName: string;
      guildId?: string | null;
      guildName?: string | null;
      topic?: string | null;
    }
  | {
      kind: 'thread';
      channelId: string;
      threadName: string;
      guildId?: string | null;
      guildName?: string | null;
    }
  | {
      kind: 'dm';
      channelId: string;
      name: string;
      recipientId?: string | null;
    }
  | {
      kind: 'attachment';
      channelId?: string | null;
      messageId?: string | null;
      author?: string | null;
      filename: string;
      url: string;
      contentType?: string | null;
    };

export function formatDiscordRefForComposer(ref: DiscordDragRef): string {
  if (ref.kind === 'message') {
    const scope = [
      ref.guildName ? ref.guildName : null,
      ref.channelName ? `#${ref.channelName}` : null,
    ].filter(Boolean).join(' / ');
    const header = `[Discord Message${scope ? ` · ${scope}` : ''} · @${ref.author} · ch:${ref.channelId} msg:${ref.messageId}${ref.guildId ? ` guild:${ref.guildId}` : ''}]`;
    const body = ref.content.trim()
      ? ref.content.trim().split('\n').map((line) => `> ${line}`).join('\n')
      : '> (no text content)';
    const attLines = (ref.attachments ?? []).map((a) => `> Attachment: ${a.filename} (${a.url})`);
    return [header, body, ...attLines].join('\n');
  }
  if (ref.kind === 'channel') {
    const scope = ref.guildName ? `${ref.guildName} / #${ref.channelName}` : `#${ref.channelName}`;
    return `[Discord Channel · ${scope} · ch:${ref.channelId}${ref.guildId ? ` guild:${ref.guildId}` : ''}${ref.topic ? ` · ${ref.topic}` : ''}]`;
  }
  if (ref.kind === 'thread') {
    const scope = ref.guildName ? `${ref.guildName} / #${ref.threadName}` : `#${ref.threadName}`;
    return `[Discord Thread · ${scope} · ch:${ref.channelId}${ref.guildId ? ` guild:${ref.guildId}` : ''}]`;
  }
  if (ref.kind === 'dm') {
    return `[Discord DM · @${ref.name} · ch:${ref.channelId}${ref.recipientId ? ` user:${ref.recipientId}` : ''}]`;
  }
  const meta = [
    ref.author ? `by @${ref.author}` : null,
    ref.channelId ? `ch:${ref.channelId}` : null,
    ref.messageId ? `msg:${ref.messageId}` : null,
  ].filter(Boolean).join(' · ');
  return `[Discord Attachment · ${ref.filename}${meta ? ` · ${meta}` : ''}]\n${ref.url}`;
}

export function setDiscordDragData(dataTransfer: DataTransfer, ref: DiscordDragRef): void {
  const formatted = formatDiscordRefForComposer(ref);
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(DISCORD_REF_MIME, JSON.stringify(ref));
  dataTransfer.setData('text/plain', formatted);
}

export function parseDiscordDragData(dataTransfer: DataTransfer | null | undefined): DiscordDragRef | null {
  if (!dataTransfer || typeof dataTransfer.getData !== 'function') return null;
  let raw = '';
  try {
    raw = dataTransfer.getData(DISCORD_REF_MIME);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DiscordDragRef> | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.kind !== 'string') return null;
    if (
      parsed.kind === 'message' ||
      parsed.kind === 'channel' ||
      parsed.kind === 'thread' ||
      parsed.kind === 'dm' ||
      parsed.kind === 'attachment'
    ) {
      return parsed as DiscordDragRef;
    }
    return null;
  } catch {
    return null;
  }
}
