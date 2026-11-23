import { asNonEmptyString } from '../shared/guards.js';
import { SpleenControlError } from './error.js';

const str = (v) => asNonEmptyString(v) ?? '';
const idStr = (v) => {
  const s = asNonEmptyString(v);
  if (s) return s;
  if (Number.isSafeInteger(v) && v >= 0) return String(v);
  return '';
};
const req = (v, label) => {
  const s = idStr(v);
  if (!s) throw new SpleenControlError(`${label} is required`, 400);
  return s;
};

export const handleDiscordControlAction = async (action, input = {}, discord, context = {}) => {
  if (!discord) throw new SpleenControlError('Discord reader is unavailable', 503);
  const baseDir = str(input.directory) || str(context?.contextDirectory) || null;

  switch (action) {
    case 'discord.status': return await discord.getStatus();
    case 'discord.me': return await discord.getMe();
    case 'discord.application': return await discord.getApplication();
    case 'discord.relationships': return { relationships: await discord.listRelationships() };
    case 'discord.guilds': return { guilds: await discord.listGuilds() };
    case 'discord.guild': return await discord.getGuild(req(input.guildId, 'guildId'));
    case 'discord.dms': return { dms: await discord.listDms() };
    case 'discord.createDm': return await discord.createDm(req(input.recipientId || input.userId, 'recipientId'));
    case 'discord.channels': {
      const guildId = str(input.guildId);
      if (guildId) {
        const res = await discord.listGuildChannels(guildId);
        return {
          channels: Array.isArray(res?.channels) ? res.channels : [],
          threads: Array.isArray(res?.threads) ? res.threads : [],
        };
      }
      return { channels: await discord.listDms(), threads: [] };
    }
    case 'discord.channel': return await discord.getChannel(req(input.channelId, 'channelId'));
    case 'discord.createChannel': return await discord.createChannel(req(input.guildId, 'guildId'), {
      name: req(input.name, 'name'),
      type: input.channelType ?? input.type ?? 0,
      topic: str(input.topic) || undefined,
      parentId: str(input.parentId) || undefined,
      nsfw: input.nsfw,
      rateLimitPerUser: input.rateLimitPerUser,
      bitrate: input.bitrate,
      userLimit: input.userLimit,
      defaultAutoArchiveDuration: input.defaultAutoArchiveDuration,
      defaultSortOrder: input.defaultSortOrder,
      defaultForumLayout: input.defaultForumLayout,
      availableTags: input.availableTags,
    });
    case 'discord.updateChannel':
    case 'discord.updateThread': {
      const patch = {};
      if (asNonEmptyString(input.name) !== null || input.name === '') patch.name = input.name;
      if (asNonEmptyString(input.topic) !== null || input.topic === '') patch.topic = input.topic;
      if (input.rateLimitPerUser !== undefined) patch.rateLimitPerUser = input.rateLimitPerUser;
      if (input.nsfw !== undefined) patch.nsfw = input.nsfw;
      if (input.position !== undefined) patch.position = input.position;
      if (input.parentId !== undefined) patch.parentId = input.parentId;
      if (input.bitrate !== undefined) patch.bitrate = input.bitrate;
      if (input.userLimit !== undefined) patch.userLimit = input.userLimit;
      if (input.rtcRegion !== undefined) patch.rtcRegion = input.rtcRegion;
      if (input.videoQualityMode !== undefined) patch.videoQualityMode = input.videoQualityMode;
      if (input.defaultAutoArchiveDuration !== undefined) patch.defaultAutoArchiveDuration = input.defaultAutoArchiveDuration;
      if (input.defaultThreadRateLimitPerUser !== undefined) patch.defaultThreadRateLimitPerUser = input.defaultThreadRateLimitPerUser;
      if (input.defaultSortOrder !== undefined) patch.defaultSortOrder = input.defaultSortOrder;
      if (input.defaultForumLayout !== undefined) patch.defaultForumLayout = input.defaultForumLayout;
      if (input.defaultReactionEmoji !== undefined) patch.defaultReactionEmoji = input.defaultReactionEmoji;
      if (input.archived !== undefined) patch.archived = input.archived;
      if (input.locked !== undefined) patch.locked = input.locked;
      if (input.autoArchiveDuration !== undefined) patch.autoArchiveDuration = input.autoArchiveDuration;
      if (Array.isArray(input.appliedTags)) patch.appliedTags = input.appliedTags;
      if (Array.isArray(input.availableTags)) patch.availableTags = input.availableTags;
      if (input.flags !== undefined) patch.flags = input.flags;
      return await discord.updateChannel(req(input.threadId || input.channelId, 'channelId'), patch);
    }
    case 'discord.deleteChannel': {
      const channelId = req(input.channelId, 'channelId');
      await discord.deleteChannel(channelId);
      return { ok: true, channelId };
    }
    case 'discord.setChannelPermission': {
      const channelId = req(input.channelId, 'channelId');
      const overwriteId = req(input.overwriteId || input.roleId || input.userId, 'overwriteId');
      await discord.setChannelPermission(channelId, overwriteId, {
        type: input.overwriteType ?? input.type ?? 0,
        allow: input.allow ?? '0',
        deny: input.deny ?? '0',
        reason: str(input.reason) || null,
      });
      return { ok: true, channelId, overwriteId };
    }
    case 'discord.deleteChannelPermission': {
      const channelId = req(input.channelId, 'channelId');
      const overwriteId = req(input.overwriteId || input.roleId || input.userId, 'overwriteId');
      await discord.deleteChannelPermission(channelId, overwriteId, str(input.reason) || null);
      return { ok: true, channelId, overwriteId };
    }
    case 'discord.members': return { members: await discord.getGuildMembers(req(input.guildId, 'guildId'), input.limit, idStr(input.after) || null) };
    case 'discord.member': return await discord.getGuildMember(req(input.guildId, 'guildId'), req(input.userId, 'userId'));
    case 'discord.voiceState': return await discord.getUserVoiceState(req(input.guildId, 'guildId'), req(input.userId, 'userId'));
    case 'discord.setVoiceStatus': {
      const channelId = req(input.channelId, 'channelId');
      await discord.setVoiceChannelStatus(channelId, input.status ?? input.topic ?? '');
      return { ok: true, channelId };
    }
    case 'discord.searchMembers': return {
      members: await discord.searchGuildMembers(req(input.guildId, 'guildId'), req(input.query, 'query'), input.limit),
    };
    case 'discord.updateMember': return await discord.updateGuildMember(
      req(input.guildId, 'guildId'),
      req(input.userId, 'userId'),
      input,
      str(input.reason) || null,
    );
    case 'discord.setNickname': return await discord.setMyNickname(req(input.guildId, 'guildId'), input.nick ?? input.nickname ?? null);
    case 'discord.roles': return { roles: await discord.getGuildRoles(req(input.guildId, 'guildId')) };
    case 'discord.createRole': return await discord.createRole(req(input.guildId, 'guildId'), input, str(input.reason) || null);
    case 'discord.updateRole': return await discord.updateRole(
      req(input.guildId, 'guildId'),
      req(input.roleId, 'roleId'),
      input.patch ?? input,
      str(input.reason) || null,
    );
    case 'discord.deleteRole': {
      const guildId = req(input.guildId, 'guildId');
      const roleId = req(input.roleId, 'roleId');
      await discord.deleteRole(guildId, roleId, str(input.reason) || null);
      return { ok: true, guildId, roleId };
    }
    case 'discord.addRole': {
      const guildId = req(input.guildId, 'guildId');
      const userId = req(input.userId, 'userId');
      const roleId = req(input.roleId, 'roleId');
      await discord.addMemberRole(guildId, userId, roleId, str(input.reason) || null);
      return { ok: true, guildId, userId, roleId };
    }
    case 'discord.removeRole': {
      const guildId = req(input.guildId, 'guildId');
      const userId = req(input.userId, 'userId');
      const roleId = req(input.roleId, 'roleId');
      await discord.removeMemberRole(guildId, userId, roleId, str(input.reason) || null);
      return { ok: true, guildId, userId, roleId };
    }
    case 'discord.kickMember': {
      const guildId = req(input.guildId, 'guildId');
      const userId = req(input.userId, 'userId');
      await discord.kickMember(guildId, userId, str(input.reason) || null);
      return { ok: true, guildId, userId };
    }
    case 'discord.listBans': return { bans: await discord.listBans(req(input.guildId, 'guildId'), input.limit) };
    case 'discord.ban': return await discord.getBan(req(input.guildId, 'guildId'), req(input.userId, 'userId'));
    case 'discord.banMember': {
      const guildId = req(input.guildId, 'guildId');
      const userId = req(input.userId, 'userId');
      await discord.banMember(guildId, userId, {
        deleteMessageSeconds: input.deleteMessageSeconds,
        reason: str(input.reason) || null,
      });
      return { ok: true, guildId, userId };
    }
    case 'discord.unbanMember': {
      const guildId = req(input.guildId, 'guildId');
      const userId = req(input.userId, 'userId');
      await discord.unbanMember(guildId, userId, str(input.reason) || null);
      return { ok: true, guildId, userId };
    }
    case 'discord.auditLogs': return await discord.getAuditLogs(req(input.guildId, 'guildId'), {
      userId: str(input.userId) || undefined,
      actionType: input.actionType,
      before: idStr(input.before) || undefined,
      limit: input.limit,
    });
    case 'discord.user': return await discord.getUser(req(input.userId, 'userId'));
    case 'discord.messages': {
      const channelId = req(input.channelId || input.threadId, 'channelId');
      const before = idStr(input.before) || undefined;
      const after = idStr(input.after) || undefined;
      const around = idStr(input.around) || undefined;
      const cursorCount = [before, after, around].filter(Boolean).length;
      if (cursorCount > 1) {
        throw new SpleenControlError('Provide at most one of before, after, or around', 400);
      }
      let messages;
      try {
        messages = await discord.getMessages(channelId, {
          limit: input.limit,
          before,
          after,
          around,
        });
      } catch (err) {
        if (err?.code === 50024) {
          throw new SpleenControlError(
            `Channel ${channelId} does not support direct messages (for example, a Forum or Media channel). Use discord.listForumPosts or discord.archivedThreads to list posts, then call discord.messages with a post threadId.`,
            400,
          );
        }
        throw err;
      }
      if (messages.length === 0 && cursorCount === 0 && discord.getChannel) {
        const ch = await discord.getChannel(channelId).catch(() => null);
        if (ch && (ch.type === 15 || ch.type === 16)) {
          return {
            messages: [],
            channelType: ch.type,
            isForumChannel: true,
            hint: `Channel ${channelId} is a Discord Forum/Media channel (type ${ch.type}). Use discord.listForumPosts or discord.archivedThreads to list posts, then call discord.messages with a post threadId.`,
          };
        }
      }
      return { messages };
    }
    case 'discord.message': return await discord.getMessage(req(input.channelId || input.threadId, 'channelId'), req(input.messageId, 'messageId'));
    case 'discord.pins': return { pins: await discord.getPins(req(input.channelId || input.threadId, 'channelId')) };
    case 'discord.search': return await discord.searchMessages(str(input.guildId) || null, {
      channelId: str(input.channelId) || undefined,
      authorId: str(input.authorId) || undefined,
      content: str(input.query) || str(input.content) || undefined,
      offset: Number(input.offset) || 0,
    });
    case 'discord.send': {
      const channelId = req(input.channelId || input.threadId, 'channelId');
      const content = str(input.content) || str(input.message) || str(input.body);
      const replyToMessageId = str(input.replyToMessageId) || undefined;
      const filePath = str(input.filePath);
      const filePaths = Array.isArray(input.filePaths) ? input.filePaths.filter((p) => asNonEmptyString(p)) : [];
      if (filePath || filePaths.length > 0) {
        return await discord.sendMessageFromFile(channelId, {
          content,
          replyToMessageId,
          filePath,
          filePaths,
          filename: str(input.filename) || undefined,
          baseDir,
          embeds: Array.isArray(input.embeds) ? input.embeds : undefined,
          components: Array.isArray(input.components) ? input.components : undefined,
          poll: input.poll,
          tts: input.tts,
          flags: input.flags,
          allowedMentions: input.allowedMentions,
        });
      }
      return await discord.sendMessage(channelId, {
        content,
        replyToMessageId,
        files: Array.isArray(input.files) ? input.files : undefined,
        embeds: Array.isArray(input.embeds) ? input.embeds : undefined,
        components: Array.isArray(input.components) ? input.components : undefined,
        poll: input.poll,
        tts: input.tts,
        stickerIds: input.stickerIds,
        flags: input.flags,
        allowedMentions: input.allowedMentions,
      });
    }
    case 'discord.editMessage': {
      const patch = {};
      if (input.content !== undefined || input.message !== undefined) patch.content = input.content ?? input.message;
      if (Array.isArray(input.embeds)) patch.embeds = input.embeds;
      if (Array.isArray(input.components)) patch.components = input.components;
      if (input.flags !== undefined) patch.flags = input.flags;
      if (input.allowedMentions !== undefined) patch.allowedMentions = input.allowedMentions;
      if (Array.isArray(input.attachments)) patch.attachments = input.attachments;
      if (Object.keys(patch).length === 0) {
        throw new SpleenControlError('At least one of content, embeds, components, flags, or attachments is required', 400);
      }
      return await discord.editMessage(
        req(input.channelId || input.threadId, 'channelId'),
        req(input.messageId, 'messageId'),
        patch,
      );
    }
    case 'discord.deleteMessage': {
      const channelId = req(input.channelId, 'channelId');
      const messageId = req(input.messageId, 'messageId');
      await discord.deleteMessage(channelId, messageId);
      return { ok: true, channelId, messageId };
    }
    case 'discord.bulkDelete': {
      const channelId = req(input.channelId, 'channelId');
      if (!Array.isArray(input.messageIds) || input.messageIds.length < 2) {
        throw new SpleenControlError('messageIds array (2-100 IDs) is required', 400);
      }
      await discord.bulkDeleteMessages(channelId, input.messageIds, str(input.reason) || null);
      return { ok: true, channelId, deleted: input.messageIds.length };
    }
    case 'discord.crosspost': return await discord.crosspostMessage(req(input.channelId, 'channelId'), req(input.messageId, 'messageId'));
    case 'discord.react': {
      const channelId = req(input.channelId, 'channelId');
      const messageId = req(input.messageId, 'messageId');
      const emoji = req(input.emoji, 'emoji');
      await discord.addReaction(channelId, messageId, emoji);
      return { ok: true, channelId, messageId, emoji };
    }
    case 'discord.unreact': {
      const channelId = req(input.channelId, 'channelId');
      const messageId = req(input.messageId, 'messageId');
      const emoji = req(input.emoji, 'emoji');
      const userId = str(input.userId) || '@me';
      await discord.removeReaction(channelId, messageId, emoji, userId);
      return { ok: true, channelId, messageId, emoji, userId };
    }
    case 'discord.getReactions': return {
      users: await discord.getReactions(
        req(input.channelId, 'channelId'),
        req(input.messageId, 'messageId'),
        req(input.emoji, 'emoji'),
        input.limit,
        idStr(input.after) || null,
      ),
    };
    case 'discord.clearReactions': {
      const channelId = req(input.channelId, 'channelId');
      const messageId = req(input.messageId, 'messageId');
      await discord.clearReactions(channelId, messageId, str(input.emoji) || null);
      return { ok: true, channelId, messageId };
    }
    case 'discord.pin': {
      const channelId = req(input.channelId, 'channelId');
      const messageId = req(input.messageId, 'messageId');
      await discord.pinMessage(channelId, messageId);
      return { ok: true, channelId, messageId };
    }
    case 'discord.unpin': {
      const channelId = req(input.channelId, 'channelId');
      const messageId = req(input.messageId, 'messageId');
      await discord.unpinMessage(channelId, messageId);
      return { ok: true, channelId, messageId };
    }
    case 'discord.typing': {
      const channelId = req(input.channelId, 'channelId');
      await discord.triggerTyping(channelId);
      return { ok: true, channelId };
    }
    case 'discord.createPoll': return await discord.createPoll(req(input.channelId, 'channelId'), {
      question: req(input.question, 'question'),
      answers: input.answers,
      durationHours: input.durationHours,
      allowMultiselect: input.allowMultiselect,
      content: str(input.content),
    });
    case 'discord.endPoll': return await discord.endPoll(req(input.channelId, 'channelId'), req(input.messageId, 'messageId'));
    case 'discord.pollVoters': return await discord.getPollVoters(
      req(input.channelId, 'channelId'),
      req(input.messageId, 'messageId'),
      req(String(input.answerId ?? ''), 'answerId'),
      input.limit,
      idStr(input.after) || null,
    );
    case 'discord.createThread': return await discord.createThread(req(input.channelId, 'channelId'), {
      name: req(input.threadName || input.name, 'threadName'),
      messageId: str(input.messageId) || undefined,
      autoArchiveDuration: input.autoArchiveDuration,
    });
    case 'discord.listForumPosts': return await discord.listForumPosts(req(input.channelId, 'channelId'), {
      guildId: str(input.guildId) || null,
      archived: Boolean(input.archived),
      limit: input.limit,
      before: str(input.before) || null,
      offset: Number.isFinite(Number(input.offset)) ? Math.max(0, Number(input.offset)) : 0,
      sortBy: str(input.sortBy) || 'last_message_time',
      sortOrder: str(input.sortOrder) || 'desc',
      tagIds: Array.isArray(input.tagIds) ? input.tagIds : (Array.isArray(input.appliedTags) ? input.appliedTags : []),
    });
    case 'discord.createForumPost': return await discord.createForumPost(req(input.channelId, 'channelId'), {
      name: req(input.title || input.name || input.threadName, 'title'),
      content: str(input.content || input.message),
      embeds: input.embeds,
      appliedTags: input.appliedTags,
      autoArchiveDuration: input.autoArchiveDuration,
    });
    case 'discord.followChannel': return await discord.rawApi({
      method: 'POST',
      path: `/channels/${encodeURIComponent(req(input.channelId, 'channelId'))}/followers`,
      body: { webhook_channel_id: req(input.targetChannelId || input.webhookChannelId, 'targetChannelId') },
    });
    case 'discord.updateGuild': return await discord.rawApi({
      method: 'PATCH',
      path: `/guilds/${encodeURIComponent(req(input.guildId, 'guildId'))}`,
      body: input.patch ?? input,
      reason: str(input.reason) || null,
    });
    case 'discord.getStageInstance': return await discord.rawApi({
      method: 'GET',
      path: `/stage-instances/${encodeURIComponent(req(input.channelId, 'channelId'))}`,
    });
    case 'discord.createStageInstance': return await discord.rawApi({
      method: 'POST',
      path: '/stage-instances',
      body: {
        channel_id: req(input.channelId, 'channelId'),
        topic: req(input.topic, 'topic'),
        privacy_level: Number(input.privacyLevel ?? 2),
      },
      reason: str(input.reason) || null,
    });
    case 'discord.updateStageInstance': {
      const stagePatch = {};
      if (asNonEmptyString(input.topic)) stagePatch.topic = input.topic;
      if (input.privacyLevel !== undefined) stagePatch.privacy_level = Number(input.privacyLevel);
      return await discord.rawApi({
        method: 'PATCH',
        path: `/stage-instances/${encodeURIComponent(req(input.channelId, 'channelId'))}`,
        body: stagePatch,
        reason: str(input.reason) || null,
      });
    }
    case 'discord.deleteStageInstance': {
      const channelId = req(input.channelId, 'channelId');
      await discord.rawApi({
        method: 'DELETE',
        path: `/stage-instances/${encodeURIComponent(channelId)}`,
        reason: str(input.reason) || null,
      });
      return { ok: true, channelId };
    }
    case 'discord.archivedThreads': return await discord.listArchivedThreads(req(input.channelId, 'channelId'), {
      type: input.threadType ?? input.type ?? 'public',
      limit: input.limit,
      before: str(input.before) || null,
    });
    case 'discord.joinThread': {
      const threadId = req(input.threadId || input.channelId, 'threadId');
      await discord.joinThread(threadId);
      return { ok: true, threadId };
    }
    case 'discord.leaveThread': {
      const threadId = req(input.threadId || input.channelId, 'threadId');
      await discord.leaveThread(threadId);
      return { ok: true, threadId };
    }
    case 'discord.threadMembers': return { members: await discord.listThreadMembers(req(input.threadId || input.channelId, 'threadId')) };
    case 'discord.addThreadMember': {
      const threadId = req(input.threadId || input.channelId, 'threadId');
      const userId = req(input.userId, 'userId');
      await discord.addThreadMember(threadId, userId);
      return { ok: true, threadId, userId };
    }
    case 'discord.removeThreadMember': {
      const threadId = req(input.threadId || input.channelId, 'threadId');
      const userId = req(input.userId, 'userId');
      await discord.removeThreadMember(threadId, userId);
      return { ok: true, threadId, userId };
    }
    case 'discord.listInvites': {
      const channelId = str(input.channelId);
      if (channelId) return { invites: await discord.listChannelInvites(channelId) };
      return { invites: await discord.listInvites(req(input.guildId, 'guildId')) };
    }
    case 'discord.getInvite': return await discord.getInvite(req(input.inviteCode || input.code, 'inviteCode'));
    case 'discord.createInvite': return await discord.createInvite(req(input.channelId, 'channelId'), input);
    case 'discord.deleteInvite': {
      const inviteCode = req(input.inviteCode || input.code, 'inviteCode');
      await discord.deleteInvite(inviteCode);
      return { ok: true, inviteCode };
    }
    case 'discord.listWebhooks': {
      const guildId = str(input.guildId);
      const channelId = str(input.channelId);
      if (channelId) return { webhooks: await discord.listWebhooks(channelId) };
      if (guildId) return { webhooks: await discord.listGuildWebhooks(guildId) };
      throw new SpleenControlError('channelId or guildId is required', 400);
    }
    case 'discord.createWebhook': return await discord.createWebhook(req(input.channelId, 'channelId'), { name: input.name });
    case 'discord.updateWebhook': return await discord.updateWebhook(req(input.webhookId, 'webhookId'), input.patch ?? input, str(input.reason) || null);
    case 'discord.deleteWebhook': {
      const webhookId = req(input.webhookId, 'webhookId');
      await discord.deleteWebhook(webhookId);
      return { ok: true, webhookId };
    }
    case 'discord.executeWebhook': return await discord.executeWebhook(
      req(input.webhookId, 'webhookId'),
      req(input.webhookToken, 'webhookToken'),
      input.payload ?? { content: input.content, embeds: input.embeds, username: input.username, avatar_url: input.avatarUrl },
      { threadId: str(input.threadId) || null },
    );
    case 'discord.listEvents': return { events: await discord.listScheduledEvents(req(input.guildId, 'guildId')) };
    case 'discord.listEventUsers': return {
      users: await discord.listEventUsers(req(input.guildId, 'guildId'), req(input.eventId, 'eventId'), {
        limit: input.limit,
        before: idStr(input.before) || undefined,
        after: idStr(input.after) || undefined,
        withMember: Boolean(input.withMember),
      }),
    };
    case 'discord.createEvent': return await discord.createScheduledEvent(req(input.guildId, 'guildId'), input.event ?? input);
    case 'discord.updateEvent': return await discord.updateScheduledEvent(req(input.guildId, 'guildId'), req(input.eventId, 'eventId'), input.patch ?? input);
    case 'discord.deleteEvent': {
      const guildId = req(input.guildId, 'guildId');
      const eventId = req(input.eventId, 'eventId');
      await discord.deleteScheduledEvent(guildId, eventId);
      return { ok: true, guildId, eventId };
    }
    case 'discord.listEmojis': return { emojis: await discord.listEmojis(req(input.guildId, 'guildId')) };
    case 'discord.listStickers': return { stickers: await discord.listStickers(req(input.guildId, 'guildId')) };
    case 'discord.listSoundboardSounds': return await discord.listSoundboardSounds(str(input.guildId) || null);
    case 'discord.listAutoModRules': return { rules: await discord.listAutoModRules(req(input.guildId, 'guildId')) };
    case 'discord.createAutoModRule': return await discord.createAutoModRule(req(input.guildId, 'guildId'), input.rule ?? input);
    case 'discord.updateAutoModRule': return await discord.updateAutoModRule(
      req(input.guildId, 'guildId'),
      req(input.ruleId, 'ruleId'),
      input.patch ?? input.rule ?? input,
      str(input.reason) || null,
    );
    case 'discord.deleteAutoModRule': {
      const guildId = req(input.guildId, 'guildId');
      const ruleId = req(input.ruleId, 'ruleId');
      await discord.deleteAutoModRule(guildId, ruleId);
      return { ok: true, guildId, ruleId };
    }
    case 'discord.downloadAttachment': {
      if (input.savePath !== undefined && input.savePath !== null && !asNonEmptyString(input.savePath)) {
        throw new SpleenControlError('savePath must be a non-empty file path string', 400);
      }
      const requestedSavePath = str(input.savePath) || str(input.outputPath) || str(input.dest) || null;
      return await discord.downloadAttachment(
        req(input.attachmentUrl || input.url, 'attachmentUrl'),
        requestedSavePath,
        { baseDir },
      );
    }
    case 'discord.api': return await discord.rawApi({
      method: input.method || 'GET',
      path: req(input.path, 'path'),
      query: input.query ?? null,
      body: input.body,
      reason: str(input.reason) || null,
    });
    default:
      throw new SpleenControlError(`Unsupported Discord action: ${action}`, 400);
  }
};
