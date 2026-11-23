import React from 'react';
import {
  RiAttachment2,
  RiCloseLine,
  RiDeleteBinLine,
  RiEditLine,
  RiGroupLine,
  RiLayoutLeftLine,
  RiLogoutBoxRLine,
  RiPushpinLine,
  RiRefreshLine,
  RiReplyLine,
  RiSendPlaneLine,
  RiSettings3Line,
  RiSparklingLine,
} from '@remixicon/react';
import { Icon } from '@/components/icon/Icon';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { setDiscordDragData } from '@/lib/discord/dragRef';
import {
  discordApi,
  type DiscordChannel,
  type DiscordGuild,
  type DiscordMember,
  type DiscordMessage,
  type DiscordRole,
  type DiscordStatus,
} from '@/lib/discord/api';
import { useInputStore } from '@/sync/input-store';
import { DiscordAvatar } from './DiscordAvatar';
import { DiscordChannels } from './DiscordChannels';
import { DiscordConnectForm } from './DiscordConnectForm';
import { DiscordDirect } from './DiscordDirect';
import { DiscordAttachmentList, DiscordEmbedCard, DiscordPollCard } from './DiscordEmbed';
import { DiscordMarkdown } from './DiscordMarkdown';
import { DiscordMembers } from './DiscordMembers';
import { DiscordServerManage } from './DiscordServerManage';
import { DiscordThreads } from './DiscordThreads';

type RightDrawer = 'none' | 'members' | 'threads' | 'manage';
type QueuedFile = { name: string; contentType: string; dataBase64: string; size: number };

const GROUP_WINDOW_MS = 5 * 60_000;

const shouldGroupWithPrevious = (prev: DiscordMessage | null, cur: DiscordMessage): boolean => {
  if (!prev || !prev.author || !cur.author) return false;
  if (prev.author.id !== cur.author.id || cur.referencedMessage) return false;
  return Date.parse(cur.timestamp) - Date.parse(prev.timestamp) <= GROUP_WINDOW_MS;
};

export const DiscordPanel: React.FC<{ visible?: boolean }> = ({ visible = true }) => {
  const { t } = useI18n();
  const [status, setStatus] = React.useState<DiscordStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [guilds, setGuilds] = React.useState<DiscordGuild[]>([]);
  const [selectedGuildId, setSelectedGuildId] = React.useState<string | '__dms__'>('__dms__');
  const [channels, setChannels] = React.useState<DiscordChannel[]>([]);
  const [threads, setThreads] = React.useState<DiscordChannel[]>([]);
  const [dms, setDms] = React.useState<DiscordChannel[]>([]);
  const [activeChannel, setActiveChannel] = React.useState<DiscordChannel | null>(null);
  const [messages, setMessages] = React.useState<DiscordMessage[]>([]);
  const [pins, setPins] = React.useState<DiscordMessage[]>([]);
  const [members, setMembers] = React.useState<DiscordMember[]>([]);
  const [roles, setRoles] = React.useState<DiscordRole[]>([]);
  const [rightDrawer, setRightDrawer] = React.useState<RightDrawer>('none');
  const [showChannels, setShowChannels] = React.useState(true);
  const [brokenGuildIcons, setBrokenGuildIcons] = React.useState<Record<string, boolean>>({});
  const [composerText, setComposerText] = React.useState('');
  const [replyTo, setReplyTo] = React.useState<DiscordMessage | null>(null);
  const [editingMsg, setEditingMsg] = React.useState<DiscordMessage | null>(null);
  const [queuedFiles, setQueuedFiles] = React.useState<QueuedFile[]>([]);
  const [lightboxImage, setLightboxImage] = React.useState<{ url: string; alt?: string } | null>(null);
  const [typingUsers, setTypingUsers] = React.useState<Record<string, number>>({});
  const streamEndRef = React.useRef<HTMLDivElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const lastTypingSentAt = React.useRef(0);

  const loadBootstrap = React.useCallback(async () => {
    setLoading(true);
    try {
      const st = await discordApi.status();
      setStatus(st);
      if (st.connected) {
        const [guildList, dmList] = await Promise.all([
          discordApi.guilds().catch(() => []),
          discordApi.dms().catch(() => []),
        ]);
        setGuilds(guildList);
        setDms(dmList);
        const preferred = st.rememberedGuildId && guildList.some((g) => g.id === st.rememberedGuildId)
          ? st.rememberedGuildId
          : (guildList[0]?.id ?? '__dms__');
        setSelectedGuildId(preferred);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (visible) void loadBootstrap();
  }, [visible, loadBootstrap]);

  // Load channels & members/roles when guild changes
  const refreshGuild = React.useCallback(async (guildId: string) => {
    try {
      const [{ channels: chs, threads: ths }, mems, rls] = await Promise.all([
        discordApi.channels(guildId),
        discordApi.members(guildId).catch(() => []),
        discordApi.roles(guildId).catch(() => []),
      ]);
      setChannels(chs);
      setThreads(ths);
      setMembers(mems);
      setRoles(rls);
      const firstText = chs.find((c) => c.type === 0 || c.type === 5) ?? chs[0] ?? null;
      setActiveChannel((prev) => (prev && prev.guildId === guildId && chs.some((c) => c.id === prev.id) ? prev : firstText));
    } catch {
      setChannels([]);
      setThreads([]);
    }
  }, []);

  React.useEffect(() => {
    if (!status?.connected) return;
    if (selectedGuildId === '__dms__') {
      setChannels([]);
      setThreads([]);
      setMembers([]);
      setRoles([]);
      if (dms[0] && activeChannel?.guildId !== null) setActiveChannel(dms[0]);
    } else {
      void refreshGuild(selectedGuildId);
      void discordApi.updatePreferences({ rememberedGuildId: selectedGuildId }).catch(() => {});
    }
  }, [status?.connected, selectedGuildId, refreshGuild, dms, activeChannel?.guildId]);

  // Load channel messages + pins
  const loadMessages = React.useCallback(async (channelId: string, before?: string) => {
    try {
      const list = await discordApi.messages(channelId, { limit: 50, before });
      if (before) {
        setMessages((prev) => [...list, ...prev]);
      } else {
        setMessages(list);
        requestAnimationFrame(() => streamEndRef.current?.scrollIntoView({ block: 'end' }));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load messages');
    }
  }, []);

  React.useEffect(() => {
    if (!status?.connected || !activeChannel?.id) return;
    void loadMessages(activeChannel.id);
    void discordApi.pins(activeChannel.id).then(setPins).catch(() => setPins([]));
  }, [status?.connected, activeChannel?.id, loadMessages]);

  // Live Gateway SSE stream
  React.useEffect(() => {
    if (!status?.connected || !visible) return;
    return discordApi.subscribeStream((evt) => {
      if (evt.type === 'message:create') {
        const msg = evt.data;
        if (msg.channelId === activeChannel?.id) {
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
          requestAnimationFrame(() => streamEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
        }
      } else if (evt.type === 'message:update') {
        const msg = evt.data;
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)));
      } else if (evt.type === 'message:delete') {
        if (evt.data.channelId === activeChannel?.id) {
          setMessages((prev) => prev.filter((m) => m.id !== evt.data.id));
        }
      } else if (evt.type === 'typing:start') {
        if (evt.data.channelId === activeChannel?.id && evt.data.userId !== status.user?.id) {
          setTypingUsers((prev) => ({ ...prev, [evt.data.userId]: Date.now() }));
        }
      }
    });
  }, [status?.connected, status?.user?.id, visible, activeChannel?.id]);

  // Prune stale typing indicators every 3s
  React.useEffect(() => {
    const id = window.setInterval(() => {
      const cutoff = Date.now() - 8_000;
      setTypingUsers((prev) => {
        const next: Record<string, number> = {};
        let changed = false;
        for (const [uid, ts] of Object.entries(prev)) {
          if (ts > cutoff) next[uid] = ts;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 3000);
    return () => window.clearInterval(id);
  }, []);

  const mentionNames = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.user.id, m.nick || m.user.globalName || m.user.username);
    for (const msg of messages) {
      for (const u of msg.mentions) map.set(u.id, u.globalName || u.username);
    }
    return map;
  }, [members, messages]);

  const channelNames = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const c of [...channels, ...threads]) map.set(c.id, c.name);
    return map;
  }, [channels, threads]);

  const roleNames = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const r of roles) map.set(r.id, r.name);
    return map;
  }, [roles]);

  const sendToAi = React.useCallback((text: string) => {
    useInputStore.getState().setPendingInputText(text, 'append');
    toast.success('Sent to Spleen AI composer');
  }, []);

  const readFileList = async (files: FileList | File[]) => {
    const arr = Array.from(files).slice(0, 6);
    const parsed: QueuedFile[] = [];
    for (const file of arr) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.split(',')[1] ?? '';
      parsed.push({ name: file.name, contentType: file.type || 'application/octet-stream', dataBase64: base64, size: file.size });
    }
    setQueuedFiles((prev) => [...prev, ...parsed].slice(0, 8));
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChannel) return;
    const text = composerText.trim();
    if (!text && queuedFiles.length === 0) return;
    try {
      if (editingMsg) {
        const updated = await discordApi.edit(activeChannel.id, editingMsg.id, text);
        setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        setEditingMsg(null);
      } else {
        const sent = await discordApi.send(activeChannel.id, {
          content: text,
          replyToMessageId: replyTo?.id,
          files: queuedFiles,
        });
        setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
        setReplyTo(null);
        setQueuedFiles([]);
      }
      setComposerText('');
      requestAnimationFrame(() => streamEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send');
    }
  };

  const handleComposerChange = (value: string) => {
    setComposerText(value);
    if (activeChannel && value.trim() && Date.now() - lastTypingSentAt.current > 6000) {
      lastTypingSentAt.current = Date.now();
      void discordApi.typing(activeChannel.id).catch(() => {});
    }
  };

  if (loading && !status) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading Discord…</div>;
  }

  if (!status?.connected) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <DiscordConnectForm onConnected={() => void loadBootstrap()} />
      </div>
    );
  }

  const activeGuild = guilds.find((g) => g.id === selectedGuildId) ?? null;
  const activeTypers = Object.keys(typingUsers).map((id) => mentionNames.get(id) ?? 'Someone');

  return (
    <div
      className="relative flex h-full min-h-0 bg-background text-foreground"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files?.length) void readFileList(e.dataTransfer.files);
      }}
    >
      {/* Column 1: Server Rail (strictly non-squishable fixed-square icons) */}
      <div className="flex w-[62px] shrink-0 flex-col items-center gap-2 overflow-y-auto overflow-x-hidden border-e border-edge-muted bg-sidebar py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="relative flex w-full shrink-0 items-center justify-center">
          <span
            className={`absolute start-0 w-1 rounded-e-full bg-foreground transition-all ${
              selectedGuildId === '__dms__' ? 'h-6 opacity-100' : 'h-0 opacity-0'
            }`}
          />
          <button
            type="button"
            title={t('discord.directMessages')}
            onClick={() => setSelectedGuildId('__dms__')}
            style={{ width: 40, height: 40, minWidth: 40, minHeight: 40 }}
            className={`flex aspect-square shrink-0 items-center justify-center border transition-all ${
              selectedGuildId === '__dms__'
                ? 'rounded-[12px] border-foreground/40 bg-primary text-primary-foreground'
                : 'rounded-[20px] border-edge bg-surface-elevated text-foreground/85 hover:rounded-[12px] hover:border-border-hover hover:text-foreground'
            }`}
          >
            <Icon name="discord" className="h-5 w-5 shrink-0" />
          </button>
        </div>

        <div className="h-px w-7 shrink-0 bg-edge-muted" />

        {guilds.map((g) => {
          const active = selectedGuildId === g.id;
          const showImg = Boolean(g.iconUrl) && !brokenGuildIcons[g.id];
          const acronym = g.name
            .split(/\s+/)
            .filter(Boolean)
            .map((w) => w[0])
            .join('')
            .slice(0, 3)
            .toUpperCase() || g.name.slice(0, 2).toUpperCase();
          return (
            <div key={g.id} className="group/guild relative flex w-full shrink-0 items-center justify-center">
              <span
                className={`absolute start-0 w-1 rounded-e-full bg-foreground transition-all ${
                  active ? 'h-6 opacity-100' : 'h-0 opacity-0 group-hover/guild:h-3 group-hover/guild:opacity-60'
                }`}
              />
              <button
                type="button"
                title={g.name}
                onClick={() => setSelectedGuildId(g.id)}
                style={{ width: 40, height: 40, minWidth: 40, minHeight: 40 }}
                className={`relative flex aspect-square shrink-0 items-center justify-center overflow-hidden border bg-surface-elevated transition-all ${
                  active
                    ? 'rounded-[12px] border-foreground/60 ring-1 ring-foreground/25'
                    : 'rounded-[20px] border-edge hover:rounded-[12px] hover:border-border-hover'
                }`}
              >
                {showImg ? (
                  <img
                    src={g.iconUrl!}
                    alt={g.name}
                    width={40}
                    height={40}
                    loading="lazy"
                    onError={() => setBrokenGuildIcons((prev) => ({ ...prev, [g.id]: true }))}
                    className="h-full w-full aspect-square object-cover"
                  />
                ) : (
                  <span className="px-1 text-[11px] font-semibold tracking-tight text-foreground select-none">
                    {acronym}
                  </span>
                )}
              </button>
            </div>
          );
        })}

        <div className="mt-auto shrink-0 pt-2">
          <button
            type="button"
            title={t('discord.connect.disconnect')}
            onClick={() => void discordApi.disconnect().then(setStatus)}
            style={{ width: 36, height: 36, minWidth: 36, minHeight: 36 }}
            className="flex aspect-square shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-destructive/15 hover:text-destructive"
          >
            <RiLogoutBoxRLine className="h-4 w-4 shrink-0" />
          </button>
        </div>
      </div>

      {/* Column 2: Channels / DMs */}
      {showChannels ? (
        <div className="flex w-48 shrink-0 flex-col border-e border-edge-muted bg-sidebar/90">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge-muted px-2.5 py-2 text-xs font-semibold">
            <span className="truncate">{selectedGuildId === '__dms__' ? t('discord.directMessages') : (activeGuild?.name ?? 'Server')}</span>
            <span className="flex items-center gap-1.5 shrink-0">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.gatewayConnected ? 'bg-[var(--status-success)]' : 'bg-muted-foreground/40'}`}
                title={status.gatewayConnected ? 'Gateway connected' : 'Gateway disconnected'}
              />
              <Icon name="discord" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </span>
          </div>
          <div className="min-h-0 flex-1">
            {selectedGuildId === '__dms__' ? (
              <DiscordDirect
                dms={dms}
                activeChannelId={activeChannel?.id ?? null}
                onSelect={setActiveChannel}
                onCreatedDm={(ch) => {
                  setDms((prev) => (prev.some((d) => d.id === ch.id) ? prev : [ch, ...prev]));
                  setActiveChannel(ch);
                }}
              />
            ) : (
              <DiscordChannels
                channels={channels}
                threads={threads}
                activeChannelId={activeChannel?.id ?? null}
                onSelect={setActiveChannel}
              />
            )}
          </div>
          {status.user ? (
            <div className="flex shrink-0 items-center gap-2 border-t border-edge-muted bg-sidebar px-2.5 py-2">
              <DiscordAvatar user={status.user} size={26} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-semibold text-foreground">
                  {status.user.globalName || status.user.username}
                </div>
                <div className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${status.gatewayConnected ? 'bg-[var(--status-success)]' : 'bg-muted-foreground/40'}`} />
                  <span className="truncate">{status.gatewayConnected ? 'LIVE' : 'REST'}</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Column 3: Messages + Composer + Right Drawer */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Channel Bar */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge-muted bg-sidebar/60 px-3 py-2 text-xs">
          <div className="min-w-0 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowChannels((v) => !v)}
              title={showChannels ? 'Hide channels' : 'Show channels'}
              className="shrink-0 rounded-lg p-1 text-muted-foreground transition hover:bg-interactive-hover hover:text-foreground"
            >
              <RiLayoutLeftLine className="h-3.5 w-3.5" />
            </button>
            <span className="font-semibold truncate">
              {activeChannel ? `# ${activeChannel.name}` : 'Select a channel'}
            </span>
            {activeChannel?.topic ? (
              <span className="hidden truncate text-[11px] text-muted-foreground md:inline">{activeChannel.topic}</span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {activeChannel && messages.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  const snippet = messages.slice(-15).map((m) => `${m.author?.username || 'user'}: ${m.content}`).join('\n');
                  sendToAi(`[Discord #${activeChannel.name} transcript]\n${snippet}`);
                }}
                className="inline-flex items-center gap-1 rounded border border-border/70 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/10"
              >
                <RiSparklingLine className="h-3.5 w-3.5" />
                {t('discord.action.sendToAi')}
              </button>
            ) : null}
            {activeChannel ? (
              <button
                type="button"
                onClick={() => void loadMessages(activeChannel.id)}
                title="Refresh"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <RiRefreshLine className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setRightDrawer((d) => (d === 'threads' ? 'none' : 'threads'))}
              title="Pins, Threads & Search"
              className={`rounded p-1 ${rightDrawer === 'threads' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
            >
              <RiPushpinLine className="h-3.5 w-3.5" />
            </button>
            {selectedGuildId !== '__dms__' ? (
              <>
                <button
                  type="button"
                  onClick={() => setRightDrawer((d) => (d === 'members' ? 'none' : 'members'))}
                  title="Members"
                  className={`rounded p-1 ${rightDrawer === 'members' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  <RiGroupLine className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setRightDrawer((d) => (d === 'manage' ? 'none' : 'manage'))}
                  title="Server Manage"
                  className={`rounded p-1 ${rightDrawer === 'manage' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  <RiSettings3Line className="h-3.5 w-3.5" />
                </button>
              </>
            ) : null}
          </div>
        </div>

        {/* Content Split */}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
              {messages.length >= 40 && activeChannel ? (
                <div className="pb-2 text-center">
                  <button
                    type="button"
                    onClick={() => void loadMessages(activeChannel.id, messages[0].id)}
                    className="rounded border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Load older messages
                  </button>
                </div>
              ) : null}

              {messages.map((msg, idx) => {
                const grouped = shouldGroupWithPrevious(idx > 0 ? messages[idx - 1] : null, msg);
                const isOwn = status.user?.id && msg.author?.id === status.user.id;
                const authorName = msg.author?.globalName || msg.author?.username || 'Unknown';
                return (
                  <div
                    key={msg.id}
                    draggable
                    onDragStart={(e) => {
                      setDiscordDragData(e.dataTransfer, {
                        kind: 'message',
                        channelId: activeChannel?.id ?? msg.channelId,
                        channelName: activeChannel?.name ?? null,
                        guildId: selectedGuildId !== '__dms__' ? selectedGuildId : null,
                        guildName: activeGuild?.name ?? null,
                        messageId: msg.id,
                        author: authorName,
                        content: msg.content,
                        timestamp: msg.timestamp,
                        attachments: msg.attachments.map((a) => ({
                          filename: a.filename,
                          url: a.url,
                          contentType: a.contentType,
                        })),
                      });
                    }}
                    title="Drag message to AI composer to reference it"
                    className={`group relative cursor-grab rounded px-1.5 py-0.5 hover:bg-muted/40 active:cursor-grabbing ${grouped ? 'ps-11' : 'pt-2'}`}
                  >
                    {msg.referencedMessage ? (
                      <div className="mb-0.5 flex items-center gap-1.5 ps-11 text-[11px] text-muted-foreground">
                        <RiReplyLine className="h-3 w-3" />
                        <span className="font-medium">{msg.referencedMessage.author?.username || 'user'}:</span>
                        <span className="truncate">{msg.referencedMessage.content}</span>
                      </div>
                    ) : null}

                    {!grouped ? (
                      <div className="flex items-start gap-2.5">
                        <DiscordAvatar user={msg.author} size={32} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="text-xs font-semibold">{msg.author?.globalName || msg.author?.username || 'Unknown'}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              {msg.editedTimestamp ? ' (edited)' : ''}
                            </span>
                          </div>
                          <DiscordMarkdown
                            content={msg.content}
                            mentionNames={mentionNames}
                            channelNames={channelNames}
                            roleNames={roleNames}
                            onAskAi={sendToAi}
                          />
                        </div>
                      </div>
                    ) : (
                      <DiscordMarkdown
                        content={msg.content}
                        mentionNames={mentionNames}
                        channelNames={channelNames}
                        roleNames={roleNames}
                        onAskAi={sendToAi}
                      />
                    )}

                    <div className={!grouped ? 'ps-[42px]' : ''}>
                      <DiscordAttachmentList
                        attachments={msg.attachments}
                        channelId={activeChannel?.id ?? msg.channelId}
                        messageId={msg.id}
                        author={authorName}
                        onPreviewImage={(url, alt) => setLightboxImage({ url, alt })}
                      />
                      {msg.embeds.map((em, i) => (
                        <DiscordEmbedCard key={i} embed={em} onPreviewImage={(url, alt) => setLightboxImage({ url, alt })} />
                      ))}
                      {msg.poll ? <DiscordPollCard poll={msg.poll} /> : null}
                      {msg.reactions.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {msg.reactions.map((r, i) => {
                            const emojiKey = r.emoji.id ? `${r.emoji.name}:${r.emoji.id}` : r.emoji.name;
                            return (
                              <button
                                key={i}
                                type="button"
                                onClick={() => activeChannel && void discordApi.react(activeChannel.id, msg.id, emojiKey, r.me).then(() => loadMessages(activeChannel.id))}
                                className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] ${
                                  r.me ? 'border-primary/60 bg-primary/15 text-foreground' : 'border-border/70 bg-card text-muted-foreground'
                                }`}
                              >
                                <span>{r.emoji.name}</span>
                                <span>{r.count}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>

                    {/* Hover action toolbar */}
                    <div className="absolute end-2 top-0.5 hidden items-center gap-0.5 rounded border border-border bg-card px-1 py-0.5 shadow-sm group-hover:flex">
                      <button
                        type="button"
                        title="Reply"
                        onClick={() => setReplyTo(msg)}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <RiReplyLine className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        title={t('discord.action.sendToAi')}
                        onClick={() => sendToAi(`[Discord @${msg.author?.username} in #${activeChannel?.name}]:\n${msg.content}`)}
                        className="rounded p-1 text-primary hover:bg-primary/10"
                      >
                        <RiSparklingLine className="h-3 w-3" />
                      </button>
                      {activeChannel ? (
                        <button
                          type="button"
                          title={msg.pinned ? 'Unpin' : 'Pin'}
                          onClick={() => void (msg.pinned ? discordApi.unpin(activeChannel.id, msg.id) : discordApi.pin(activeChannel.id, msg.id)).then(() => loadMessages(activeChannel.id))}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <RiPushpinLine className="h-3 w-3" />
                        </button>
                      ) : null}
                      {isOwn ? (
                        <>
                          <button
                            type="button"
                            title="Edit"
                            onClick={() => { setEditingMsg(msg); setComposerText(msg.content); }}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <RiEditLine className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            title="Delete"
                            onClick={() => activeChannel && void discordApi.remove(activeChannel.id, msg.id).then(() => setMessages((p) => p.filter((x) => x.id !== msg.id)))}
                            className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                          >
                            <RiDeleteBinLine className="h-3 w-3" />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              <div ref={streamEndRef} />
            </div>

            {activeTypers.length > 0 ? (
              <div className="px-3 py-0.5 text-[10px] text-muted-foreground">
                {activeTypers.join(', ')} typing…
              </div>
            ) : null}

            {/* Composer */}
            {activeChannel ? (
              <div className="border-t border-border/60 p-2">
                {replyTo || editingMsg ? (
                  <div className="mb-1.5 flex items-center justify-between rounded bg-muted/60 px-2 py-1 text-[11px]">
                    <span className="truncate">
                      {editingMsg ? `Editing message` : `Replying to ${replyTo?.author?.username}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setReplyTo(null); setEditingMsg(null); setComposerText(''); }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <RiCloseLine className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
                {queuedFiles.length > 0 ? (
                  <div className="mb-1.5 flex flex-wrap gap-1.5">
                    {queuedFiles.map((f, idx) => (
                      <div key={idx} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[11px]">
                        <span className="max-w-[140px] truncate">{f.name}</span>
                        <button type="button" onClick={() => setQueuedFiles((prev) => prev.filter((_, i) => i !== idx))}>
                          <RiCloseLine className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <form onSubmit={(e) => void handleSend(e)} className="flex items-center gap-1.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => e.target.files && void readFileList(e.target.files)}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach files"
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <RiAttachment2 className="h-4 w-4" />
                  </button>
                  <input
                    value={composerText}
                    onChange={(e) => handleComposerChange(e.target.value)}
                    onPaste={(e) => {
                      if (e.clipboardData?.files?.length) {
                        void readFileList(e.clipboardData.files);
                      }
                    }}
                    placeholder={t('discord.composer.placeholder', { channel: activeChannel.name })}
                    className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary"
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-primary px-2.5 py-1.5 text-primary-foreground transition hover:opacity-90"
                  >
                    <RiSendPlaneLine className="h-4 w-4" />
                  </button>
                </form>
              </div>
            ) : null}
          </div>

          {/* Right Drawer */}
          {rightDrawer !== 'none' ? (
            <div className="w-56 shrink-0 border-s border-border/60 bg-card/30">
              {rightDrawer === 'members' ? <DiscordMembers members={members} roles={roles} /> : null}
              {rightDrawer === 'threads' ? (
                <DiscordThreads
                  threads={threads}
                  pins={pins}
                  guildId={selectedGuildId !== '__dms__' ? selectedGuildId : null}
                  channelId={activeChannel?.id ?? null}
                  onSelectThread={setActiveChannel}
                  onSendToAi={sendToAi}
                />
              ) : null}
              {rightDrawer === 'manage' && selectedGuildId !== '__dms__' ? (
                <DiscordServerManage
                  guildId={selectedGuildId}
                  activeChannel={activeChannel}
                  roles={roles}
                  onRefresh={() => void refreshGuild(selectedGuildId)}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxImage ? (
        <div
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
        >
          <img src={lightboxImage.url} alt={lightboxImage.alt ?? ''} className="max-h-full max-w-full rounded object-contain" />
        </div>
      ) : null}
    </div>
  );
};
