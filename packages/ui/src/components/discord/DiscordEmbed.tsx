import React from 'react';
import { RiDownloadLine, RiFileTextLine } from '@remixicon/react';
import type { DiscordAttachment, DiscordEmbed, DiscordMessage } from '@/lib/discord/api';

const colorHex = (num?: number): string => {
  if (typeof num !== 'number' || num <= 0) return 'var(--border)';
  return `#${num.toString(16).padStart(6, '0')}`;
};

export const DiscordAttachmentList: React.FC<{
  attachments: DiscordAttachment[];
  onPreviewImage: (url: string, alt?: string) => void;
}> = ({ attachments, onPreviewImage }) => {
  if (!attachments.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {attachments.map((att) => {
        const mime = att.contentType ?? '';
        const isImg = mime.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(att.filename);
        const isVideo = mime.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(att.filename);
        const isAudio = mime.startsWith('audio/') || /\.(mp3|ogg|wav|flac|m4a)$/i.test(att.filename);
        if (isImg) {
          return (
            <button
              key={att.id}
              type="button"
              onClick={() => onPreviewImage(att.url, att.filename)}
              className="overflow-hidden rounded-lg border border-border/60 bg-card/50 transition hover:opacity-90"
            >
              <img src={att.proxyUrl || att.url} alt={att.filename} className="max-h-64 max-w-xs object-contain" loading="lazy" />
            </button>
          );
        }
        if (isVideo) {
          return (
            <video key={att.id} controls preload="metadata" className="max-h-64 max-w-sm rounded-lg border border-border/60">
              <source src={att.url} type={att.contentType ?? undefined} />
            </video>
          );
        }
        if (isAudio) {
          return (
            <audio key={att.id} controls preload="metadata" className="max-w-xs">
              <source src={att.url} type={att.contentType ?? undefined} />
            </audio>
          );
        }
        return (
          <a
            key={att.id}
            href={att.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-card/70 px-3 py-2 text-xs hover:bg-muted"
          >
            <RiFileTextLine className="h-4 w-4 text-primary" />
            <span className="max-w-[200px] truncate font-medium">{att.filename}</span>
            <span className="text-[10px] text-muted-foreground">{Math.max(1, Math.round(att.size / 1024))} KB</span>
            <RiDownloadLine className="h-3.5 w-3.5 text-muted-foreground" />
          </a>
        );
      })}
    </div>
  );
};

export const DiscordEmbedCard: React.FC<{
  embed: DiscordEmbed;
  onPreviewImage: (url: string, alt?: string) => void;
}> = ({ embed, onPreviewImage }) => (
  <div
    style={{ borderLeftColor: colorHex(embed.color), borderLeftWidth: 3 }}
    className="mt-1.5 max-w-lg rounded-md border border-border/60 bg-card/80 p-2.5 text-xs"
  >
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1 space-y-1">
        {embed.author?.name ? (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            {embed.author.icon_url ? <img src={embed.author.icon_url} alt="" className="h-4 w-4 rounded-full object-cover" /> : null}
            <span>{embed.author.name}</span>
          </div>
        ) : null}
        {embed.title ? (
          embed.url ? (
            <a href={embed.url} target="_blank" rel="noreferrer" className="block font-semibold text-foreground underline decoration-muted-foreground/50 hover:decoration-foreground">
              {embed.title}
            </a>
          ) : (
            <div className="font-semibold text-foreground">{embed.title}</div>
          )
        ) : null}
        {embed.description ? (
          <div className="whitespace-pre-wrap text-[12px] text-foreground/90">{embed.description}</div>
        ) : null}
        {embed.fields && embed.fields.length > 0 ? (
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {embed.fields.map((field, idx) => (
              <div key={idx} className={field.inline ? '' : 'col-span-2'}>
                <div className="text-[11px] font-semibold text-foreground">{field.name}</div>
                <div className="whitespace-pre-wrap text-[11px] text-muted-foreground">{field.value}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {embed.thumbnail?.url ? (
        <img
          src={embed.thumbnail.url}
          alt=""
          onClick={() => onPreviewImage(embed.thumbnail!.url!)}
          className="h-14 w-14 shrink-0 cursor-pointer rounded object-cover"
        />
      ) : null}
    </div>
    {embed.image?.url ? (
      <img
        src={embed.image.url}
        alt=""
        onClick={() => onPreviewImage(embed.image!.url!)}
        className="mt-2 max-h-60 cursor-pointer rounded object-contain"
      />
    ) : null}
    {embed.footer?.text ? (
      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {embed.footer.icon_url ? <img src={embed.footer.icon_url} alt="" className="h-3.5 w-3.5 rounded-full" /> : null}
        <span>{embed.footer.text}</span>
      </div>
    ) : null}
  </div>
);

export const DiscordPollCard: React.FC<{ poll: NonNullable<DiscordMessage['poll']> }> = ({ poll }) => {
  const counts = new Map<number, number>(poll.results?.answer_counts?.map((c) => [c.id, c.count]) ?? []);
  const total = Array.from(counts.values()).reduce((sum, n) => sum + n, 0);
  return (
    <div className="mt-1.5 max-w-md rounded-lg border border-border/70 bg-card/80 p-2.5 text-xs">
      <div className="mb-1.5 font-semibold">{poll.question?.text || 'Poll'}</div>
      <div className="space-y-1">
        {(poll.answers ?? []).map((ans) => {
          const votes = counts.get(ans.answer_id) ?? 0;
          const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
          return (
            <div key={ans.answer_id} className="flex items-center justify-between rounded border border-border/50 bg-background/60 px-2 py-1 text-[11px]">
              <span>{ans.poll_media?.text || `Option ${ans.answer_id}`}</span>
              <span className="text-muted-foreground">{votes} ({pct}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
