import { asNonEmptyString, isBoolean, isRecord } from '../shared/guards.js';
import { DiscordApiError } from './client.js';

export const DISCORD_PERMISSION_FLAGS = Object.freeze({
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  PRIORITY_SPEAKER: 1n << 8n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  SEND_TTS_MESSAGES: 1n << 12n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  VIEW_GUILD_INSIGHTS: 1n << 19n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  USE_VAD: 1n << 25n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_GUILD_EXPRESSIONS: 1n << 30n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  REQUEST_TO_SPEAK: 1n << 32n,
  MANAGE_EVENTS: 1n << 33n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  USE_EXTERNAL_STICKERS: 1n << 37n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  USE_EMBEDDED_ACTIVITIES: 1n << 39n,
  MODERATE_MEMBERS: 1n << 40n,
  SEND_VOICE_MESSAGES: 1n << 46n,
  SEND_POLLS: 1n << 49n,
});

const ALL_PERMISSIONS_BITS = Object.values(DISCORD_PERMISSION_FLAGS).reduce((acc, bit) => acc | bit, 0n);

const toBigIntBits = (value) => {
  const s = asNonEmptyString(value);
  if (s && /^\d+$/.test(s)) return BigInt(s);
  if (Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return 0n;
};

export const decodePermissionNames = (bits) => {
  const names = [];
  for (const [name, flag] of Object.entries(DISCORD_PERMISSION_FLAGS)) {
    if ((bits & flag) === flag) names.push(name);
  }
  return names;
};

export const calculateEffectivePermissions = ({ guild, member, roles = [], channel = null } = {}) => {
  const guildId = String(guild?.id ?? '');
  const userId = String(member?.user?.id ?? member?.userId ?? '');
  const ownerId = guild?.owner_id ? String(guild.owner_id) : (guild?.ownerId ? String(guild.ownerId) : '');
  const memberRoleIds = new Set((Array.isArray(member?.roles) ? member.roles : []).map(String));

  let highestRolePosition = 0;
  let permissions = 0n;
  const roleById = new Map();
  for (const role of Array.isArray(roles) ? roles : []) {
    const rid = String(role.id);
    roleById.set(rid, role);
    if (rid === guildId) permissions |= toBigIntBits(role.permissions);
    if (memberRoleIds.has(rid)) {
      permissions |= toBigIntBits(role.permissions);
      const pos = Number(role.position ?? 0);
      if (pos > highestRolePosition) highestRolePosition = pos;
    }
  }

  const isOwner = Boolean(ownerId && userId && ownerId === userId);
  if (isOwner || (permissions & DISCORD_PERMISSION_FLAGS.ADMINISTRATOR) === DISCORD_PERMISSION_FLAGS.ADMINISTRATOR) {
    return {
      bits: ALL_PERMISSIONS_BITS.toString(),
      permissions: decodePermissionNames(ALL_PERMISSIONS_BITS),
      isOwner,
      isAdministrator: true,
      highestRolePosition: isOwner ? Number.MAX_SAFE_INTEGER : highestRolePosition,
    };
  }

  const overwrites = Array.isArray(channel?.permission_overwrites)
    ? channel.permission_overwrites
    : (Array.isArray(channel?.permissionOverwrites) ? channel.permissionOverwrites : []);

  if (overwrites.length > 0) {
    const everyoneOverwrite = overwrites.find((ow) => String(ow.id) === guildId);
    if (everyoneOverwrite) {
      permissions &= ~toBigIntBits(everyoneOverwrite.deny);
      permissions |= toBigIntBits(everyoneOverwrite.allow);
    }
    let roleDeny = 0n;
    let roleAllow = 0n;
    for (const ow of overwrites) {
      if (memberRoleIds.has(String(ow.id))) {
        roleDeny |= toBigIntBits(ow.deny);
        roleAllow |= toBigIntBits(ow.allow);
      }
    }
    permissions &= ~roleDeny;
    permissions |= roleAllow;

    const memberOverwrite = overwrites.find((ow) => String(ow.id) === userId);
    if (memberOverwrite) {
      permissions &= ~toBigIntBits(memberOverwrite.deny);
      permissions |= toBigIntBits(memberOverwrite.allow);
    }
  }

  return {
    bits: permissions.toString(),
    permissions: decodePermissionNames(permissions),
    isOwner: false,
    isAdministrator: false,
    highestRolePosition,
  };
};

export const READ_ONLY_DISCORD_ACTIONS = new Set([
  'discord.status',
  'discord.me',
  'discord.application',
  'discord.relationships',
  'discord.guilds',
  'discord.guild',
  'discord.dms',
  'discord.channels',
  'discord.channel',
  'discord.members',
  'discord.member',
  'discord.searchMembers',
  'discord.roles',
  'discord.listBans',
  'discord.ban',
  'discord.auditLogs',
  'discord.user',
  'discord.messages',
  'discord.message',
  'discord.pins',
  'discord.search',
  'discord.getReactions',
  'discord.pollVoters',
  'discord.listForumPosts',
  'discord.archivedThreads',
  'discord.threadMembers',
  'discord.listInvites',
  'discord.getInvite',
  'discord.listWebhooks',
  'discord.listEvents',
  'discord.listEventUsers',
  'discord.listEmojis',
  'discord.listStickers',
  'discord.listSoundboardSounds',
  'discord.listAutoModRules',
  'discord.getStageInstance',
  'discord.voiceState',
  'discord.voiceStatus',
  'discord.voiceMembers',
  'discord.downloadAttachment',
  'discord.checkPermissions',
  'discord.policy',
  'discord.auditTrail',
  'discord.listCommands',
  'discord.listInteractions',
  'discord.events',
  'discord.oauthStatus',
  'discord.oauthUrl',
  'discord.guildWidget',
  'discord.guildOnboarding',
  'discord.guildWelcomeScreen',
  'discord.guildTemplates',
  'discord.skus',
  'discord.entitlements',
]);

export const DESTRUCTIVE_DISCORD_ACTIONS = new Set([
  'discord.deleteChannel',
  'discord.deleteRole',
  'discord.kickMember',
  'discord.banMember',
  'discord.bulkDelete',
  'discord.deleteWebhook',
  'discord.deleteAutoModRule',
  'discord.updateGuild',
  'discord.leaveGuild',
  'discord.guildPrune',
  'discord.deleteEmoji',
  'discord.deleteCommand',
  'discord.bulkOverwriteCommands',
  'discord.deleteEvent',
]);

export const MODERATION_OR_ADMIN_ACTIONS = new Set([
  ...DESTRUCTIVE_DISCORD_ACTIONS,
  'discord.createChannel',
  'discord.updateChannel',
  'discord.setChannelPermission',
  'discord.deleteChannelPermission',
  'discord.createRole',
  'discord.updateRole',
  'discord.addRole',
  'discord.removeRole',
  'discord.updateMember',
  'discord.unbanMember',
  'discord.createAutoModRule',
  'discord.updateAutoModRule',
  'discord.createWebhook',
  'discord.updateWebhook',
  'discord.createEmoji',
  'discord.updateEmoji',
  'discord.upsertCommand',
]);

const VALID_POLICY_MODES = new Set(['full', 'limited-write', 'read-only']);

export const normalizeSafetyPolicy = (raw) => {
  const src = isRecord(raw) ? raw : {};
  const mode = asNonEmptyString(src.policyMode);
  return {
    policyMode: mode && VALID_POLICY_MODES.has(mode) ? mode : 'full',
    confirmDestructive: isBoolean(src.confirmDestructive) ? src.confirmDestructive : false,
    allowedGuildIds: Array.isArray(src.allowedGuildIds) ? src.allowedGuildIds.map(String).filter(Boolean) : [],
    allowedChannelIds: Array.isArray(src.allowedChannelIds) ? src.allowedChannelIds.map(String).filter(Boolean) : [],
  };
};

export const createDiscordSafetyGuard = ({ store, maxAuditEntries = 500 } = {}) => {
  const auditEntries = [];

  const recordAudit = (entry) => {
    auditEntries.push({
      id: `aud_${Date.now()}_${auditEntries.length + 1}`,
      timestamp: new Date().toISOString(),
      ...entry,
    });
    if (auditEntries.length > maxAuditEntries) {
      auditEntries.splice(0, auditEntries.length - maxAuditEntries);
    }
  };

  const getPolicy = async () => {
    const state = store ? await store.read() : {};
    return normalizeSafetyPolicy(state?.safetyPolicy);
  };

  const updatePolicy = async (patch = {}) => {
    if (!store) throw new DiscordApiError('Discord store is unavailable', 503, 'STORE_UNAVAILABLE');
    const current = await getPolicy();
    const next = normalizeSafetyPolicy({ ...current, ...patch });
    await store.saveConfig({ safetyPolicy: next });
    recordAudit({ action: 'discord.policy', status: 'updated', summary: `policyMode=${next.policyMode}, confirmDestructive=${next.confirmDestructive}` });
    return next;
  };

  const evaluateAction = async (action, input = {}) => {
    const policy = await getPolicy();
    const isRawGet = action === 'discord.api' && (asNonEmptyString(input.method) || 'GET').toUpperCase() === 'GET';
    const isRead = READ_ONLY_DISCORD_ACTIONS.has(action) || isRawGet;

    if (policy.policyMode === 'read-only' && !isRead) {
      recordAudit({ action, status: 'blocked', reason: 'read-only policy mode' });
      throw new DiscordApiError(`Action ${action} is blocked because Discord policyMode is set to read-only`, 403, 'POLICY_READ_ONLY');
    }

    if (policy.policyMode === 'limited-write' && (MODERATION_OR_ADMIN_ACTIONS.has(action) || (action === 'discord.api' && !isRawGet))) {
      recordAudit({ action, status: 'blocked', reason: 'limited-write policy mode' });
      throw new DiscordApiError(`Action ${action} is blocked because Discord policyMode is set to limited-write`, 403, 'POLICY_LIMITED_WRITE');
    }

    const guildId = asNonEmptyString(input.guildId);
    if (guildId && policy.allowedGuildIds.length > 0 && !policy.allowedGuildIds.includes(guildId)) {
      recordAudit({ action, status: 'blocked', guildId, reason: 'guild not in allowlist' });
      throw new DiscordApiError(`Guild ${guildId} is not in allowedGuildIds`, 403, 'GUILD_NOT_ALLOWED');
    }

    const channelId = asNonEmptyString(input.channelId) || asNonEmptyString(input.threadId);
    if (channelId && policy.allowedChannelIds.length > 0 && !policy.allowedChannelIds.includes(channelId)) {
      recordAudit({ action, status: 'blocked', channelId, reason: 'channel not in allowlist' });
      throw new DiscordApiError(`Channel ${channelId} is not in allowedChannelIds`, 403, 'CHANNEL_NOT_ALLOWED');
    }

    const isDestructive = DESTRUCTIVE_DISCORD_ACTIONS.has(action)
      || (action === 'discord.api' && (asNonEmptyString(input.method) || 'GET').toUpperCase() === 'DELETE');
    const isDryRun = input.dryRun === true;
    const isConfirmed = input.confirm === true;

    if ((isDryRun || (policy.confirmDestructive && isDestructive)) && !isConfirmed) {
      const target = {
        guildId: guildId ?? null,
        channelId: channelId ?? null,
        userId: asNonEmptyString(input.userId) ?? null,
        roleId: asNonEmptyString(input.roleId) ?? null,
        messageId: asNonEmptyString(input.messageId) ?? null,
        path: asNonEmptyString(input.path) ?? null,
      };
      recordAudit({ action, status: 'preview', target });
      return {
        blockedForConfirmation: true,
        preview: {
          confirmationRequired: true,
          dryRun: isDryRun,
          action,
          destructive: isDestructive,
          target,
          message: `Action ${action} requires explicit confirmation. Re-run with confirm: true after user approval.`,
        },
      };
    }

    return { blockedForConfirmation: false, policy };
  };

  const listAuditTrail = (limit = 50) => {
    const capped = Math.min(maxAuditEntries, Math.max(1, Number(limit) || 50));
    return auditEntries.slice(-capped).reverse();
  };

  return {
    getPolicy,
    updatePolicy,
    evaluateAction,
    recordAudit,
    listAuditTrail,
  };
};
