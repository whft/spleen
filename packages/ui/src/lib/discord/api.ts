import { runtimeFetch } from '@/lib/runtime-fetch';
import { getRuntimeUrlResolver } from '@/lib/runtime-url';

export type DiscordUser = {
  id: string;
  username: string;
  globalName: string | null;
  discriminator: string;
  avatar: string | null;
  avatarUrl: string | null;
  bot: boolean;
};

export type DiscordStatus = {
  connected: boolean;
  tokenType: 'user' | 'bot';
  tokenHint: string | null;
  rememberedGuildId: string | null;
  mutedChannelIds: string[];
  user: DiscordUser | null;
  gatewayConnected: boolean;
};

export type DiscordGuild = {
  id: string;
  name: string;
  icon: string | null;
  iconUrl: string | null;
  owner: boolean;
  permissions: string | null;
};

export type DiscordChannel = {
  id: string;
  guildId: string | null;
  name: string;
  type: number;
  topic: string | null;
  position: number;
  parentId: string | null;
  nsfw: boolean;
  rateLimitPerUser: number;
  lastMessageId: string | null;
  recipients: DiscordUser[];
};

export type DiscordAttachment = {
  id: string;
  filename: string;
  url: string;
  proxyUrl: string;
  size: number;
  contentType: string | null;
  width: number | null;
  height: number | null;
};

export type DiscordEmbed = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  author?: { name?: string; url?: string; icon_url?: string };
  footer?: { text?: string; icon_url?: string };
  thumbnail?: { url?: string };
  image?: { url?: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
};

export type DiscordMessage = {
  id: string;
  channelId: string;
  guildId: string | null;
  content: string;
  author: DiscordUser | null;
  timestamp: string;
  editedTimestamp: string | null;
  pinned: boolean;
  type: number;
  attachments: DiscordAttachment[];
  embeds: DiscordEmbed[];
  stickers: Array<{ id: string; name: string; format_type?: number }>;
  reactions: Array<{ emoji: { id?: string | null; name: string }; count: number; me: boolean }>;
  mentions: DiscordUser[];
  referencedMessage: { id: string; content: string; author: DiscordUser | null } | null;
  thread: { id: string; name: string; messageCount: number | null } | null;
  poll: { question?: { text?: string }; answers?: Array<{ answer_id: number; poll_media?: { text?: string } }>; results?: { answer_counts?: Array<{ id: number; count: number }> } } | null;
  messageSnapshots: Array<{ message?: { content?: string } }>;
};

export type DiscordMember = {
  user: DiscordUser;
  nick: string | null;
  roles: string[];
  joinedAt: string | null;
};

export type DiscordRole = {
  id: string;
  name: string;
  color: number;
  position: number;
  permissions: string;
};

export type DiscordStreamEvent =
  | { type: 'stream:ready'; data: { connected: boolean } }
  | { type: 'gateway:ready'; data: { user: DiscordUser | null } }
  | { type: 'gateway:resumed'; data: Record<string, unknown> }
  | { type: 'message:create'; data: DiscordMessage }
  | { type: 'message:update'; data: DiscordMessage }
  | { type: 'message:delete'; data: { id: string; channelId: string } }
  | { type: 'reaction:add' | 'reaction:remove'; data: { channelId: string; messageId: string; userId: string; emoji: { id?: string | null; name: string } } }
  | { type: 'typing:start'; data: { channelId: string; userId: string; timestamp: number } }
  | { type: 'channel:update'; data: DiscordChannel };

const jsonHeaders = { 'Content-Type': 'application/json', Accept: 'application/json' };

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await runtimeFetch(path, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? jsonHeaders : {}), ...(init?.headers ?? {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Discord API error (${response.status})`);
  }
  return data as T;
};

export const discordApi = {
  status: () => requestJson<DiscordStatus>('/api/discord/status'),
  connect: (token: string, tokenType: 'user' | 'bot') =>
    requestJson<DiscordStatus>('/api/discord/connect', { method: 'POST', body: JSON.stringify({ token, tokenType }) }),
  disconnect: () => requestJson<DiscordStatus>('/api/discord/disconnect', { method: 'POST' }),
  updatePreferences: (patch: { rememberedGuildId?: string | null; mutedChannelIds?: string[] }) =>
    requestJson<DiscordStatus>('/api/discord/preferences', { method: 'PATCH', body: JSON.stringify(patch) }),
  guilds: () => requestJson<{ guilds: DiscordGuild[] }>('/api/discord/guilds').then((r) => r.guilds),
  channels: (guildId: string) =>
    requestJson<{ channels: DiscordChannel[]; threads: DiscordChannel[] }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/channels`),
  members: (guildId: string) =>
    requestJson<{ members: DiscordMember[] }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/members`).then((r) => r.members),
  roles: (guildId: string) =>
    requestJson<{ roles: DiscordRole[] }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/roles`).then((r) => r.roles),
  search: (guildId: string, params: { content?: string; channelId?: string; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params.content) qs.set('content', params.content);
    if (params.channelId) qs.set('channelId', params.channelId);
    if (params.offset) qs.set('offset', String(params.offset));
    return requestJson<{ totalResults: number; messages: DiscordMessage[] }>(`/api/discord/guilds/${encodeURIComponent(guildId)}/search?${qs.toString()}`);
  },
  dms: () => requestJson<{ channels: DiscordChannel[] }>('/api/discord/dms').then((r) => r.channels),
  createDm: (recipientId: string) => requestJson<DiscordChannel>('/api/discord/dms', { method: 'POST', body: JSON.stringify({ recipientId }) }),
  messages: (channelId: string, params?: { limit?: number; before?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.before) qs.set('before', params.before);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return requestJson<{ messages: DiscordMessage[] }>(`/api/discord/channels/${encodeURIComponent(channelId)}/messages${suffix}`).then((r) => r.messages);
  },
  send: (channelId: string, body: { content: string; replyToMessageId?: string; files?: Array<{ name: string; contentType: string; dataBase64: string }> }) =>
    requestJson<DiscordMessage>(`/api/discord/channels/${encodeURIComponent(channelId)}/messages`, { method: 'POST', body: JSON.stringify(body) }),
  edit: (channelId: string, messageId: string, content: string) =>
    requestJson<DiscordMessage>(`/api/discord/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`, { method: 'PATCH', body: JSON.stringify({ content }) }),
  remove: (channelId: string, messageId: string) =>
    requestJson<{ deleted: boolean }>(`/api/discord/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' }),
  pins: (channelId: string) => requestJson<{ messages: DiscordMessage[] }>(`/api/discord/channels/${encodeURIComponent(channelId)}/pins`).then((r) => r.messages),
  pin: (channelId: string, messageId: string) => requestJson(`/api/discord/channels/${encodeURIComponent(channelId)}/pins/${encodeURIComponent(messageId)}`, { method: 'PUT' }),
  unpin: (channelId: string, messageId: string) => requestJson(`/api/discord/channels/${encodeURIComponent(channelId)}/pins/${encodeURIComponent(messageId)}`, { method: 'DELETE' }),
  react: (channelId: string, messageId: string, emoji: string, remove = false) =>
    requestJson(`/api/discord/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}`, { method: remove ? 'DELETE' : 'PUT' }),
  typing: (channelId: string) => requestJson(`/api/discord/channels/${encodeURIComponent(channelId)}/typing`, { method: 'POST' }),
  createThread: (channelId: string, name: string, messageId?: string) =>
    requestJson<DiscordChannel>(`/api/discord/channels/${encodeURIComponent(channelId)}/threads`, { method: 'POST', body: JSON.stringify({ name, ...(messageId ? { messageId } : {}) }) }),
  createChannel: (guildId: string, input: { name: string; topic?: string; type?: number }) =>
    requestJson<DiscordChannel>(`/api/discord/guilds/${encodeURIComponent(guildId)}/channels`, { method: 'POST', body: JSON.stringify(input) }),
  updateChannel: (channelId: string, input: { name?: string; topic?: string; rateLimitPerUser?: number }) =>
    requestJson<DiscordChannel>(`/api/discord/channels/${encodeURIComponent(channelId)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  subscribeStream: (onEvent: (event: DiscordStreamEvent) => void): (() => void) => {
    if (typeof EventSource !== 'function') return () => {};
    const url = getRuntimeUrlResolver().sse('/api/discord/stream');
    const source = new EventSource(url);
    source.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data) as DiscordStreamEvent;
        if (parsed?.type) onEvent(parsed);
      } catch {
        // ignore malformed packets
      }
    };
    return () => source.close();
  },
};
