import { SpleenControlError } from './error.js';

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
const req = (v, label) => {
  const s = str(v);
  if (!s) throw new SpleenControlError(`${label} is required`, 400);
  return s;
};

export const handleDiscordControlAction = async (action, input = {}, discord) => {
  if (!discord) throw new SpleenControlError('Discord reader is unavailable', 503);

  switch (action) {
    case 'discord.status': return await discord.getStatus();
    case 'discord.me': return await discord.getMe();
    case 'discord.relationships': return { relationships: await discord.listRelationships() };
    case 'discord.guilds': return { guilds: await discord.listGuilds() };
    case 'discord.guild': return await discord.getGuild(req(input.guildId, 'guildId'));
    case 'discord.dms': return { dms: await discord.listDms() };
    case 'discord.createDm': return await discord.createDm(req(input.recipientId || input.userId, 'recipientId'));
    case 'discord.channels': {
      const guildId = str(input.guildId);
      return { channels: guildId ? await discord.listGuildChannels(guildId) : await discord.listDms() };
    }
    case 'discord.channel': return await discord.getChannel(req(input.channelId, 'channelId'));
    case 'discord.createChannel': return await discord.createChannel(req(input.guildId, 'guildId'), {
      name: req(input.name, 'name'),
      type: input.channelType ?? input.type ?? 0,
      topic: str(input.topic) || undefined,
      parentId: str(input.parentId) || undefined,
    });
    case 'discord.updateChannel':
    case 'discord.updateThread': {
      const patch = {};
      if (typeof input.name === 'string') patch.name = input.name;
      if (typeof input.topic === 'string') patch.topic = input.topic;
      if (input.rateLimitPerUser !== undefined) patch.rateLimitPerUser = input.rateLimitPerUser;
      if (input.nsfw !== undefined) patch.nsfw = input.nsfw;
      if (input.position !== undefined) patch.position = input.position;
      if (input.parentId !== undefined) patch.parentId = input.parentId;
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
    case 'discord.members': return { members: await discord.getGuildMembers(req(input.guildId, 'guildId'), input.limit) };
    case 'discord.member': return await discord.getGuildMember(req(input.guildId, 'guildId'), req(input.userId, 'userId'));
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
      limit: input.limit,
    });
    case 'discord.user': return await discord.getUser(req(input.userId, 'userId'));
    case 'discord.messages': return {
      messages: await discord.getMessages(req(input.channelId, 'channelId'), {
        limit: input.limit,
        before: str(input.before) || undefined,
        after: str(input.after) || undefined,
        around: str(input.around) || undefined,
      }),
    };
    case 'discord.message': return await discord.getMessage(req(input.channelId, 'channelId'), req(input.messageId, 'messageId'));
    case 'discord.pins': return { pins: await discord.getPins(req(input.channelId, 'channelId')) };
    case 'discord.search': return await discord.searchMessages(str(input.guildId) || null, {
      channelId: str(input.channelId) || undefined,
      authorId: str(input.authorId) || undefined,
      content: str(input.query) || str(input.content) || undefined,
      offset: Number(input.offset) || 0,
    });
    case 'discord.send': {
      const channelId = req(input.channelId, 'channelId');
      const content = str(input.content) || str(input.message) || str(input.body);
      const replyToMessageId = str(input.replyToMessageId) || undefined;
      const filePath = str(input.filePath);
      if (filePath) {
        return await discord.sendMessageFromFile(channelId, {
          content,
          replyToMessageId,
          filePath,
          filename: str(input.filename) || undefined,
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
    case 'discord.editMessage': return await discord.editMessage(
      req(input.channelId, 'channelId'),
      req(input.messageId, 'messageId'),
      { content: req(input.content || input.message, 'content') },
    );
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
      await discord.removeReaction(channelId, messageId, emoji);
      return { ok: true, channelId, messageId, emoji };
    }
    case 'discord.getReactions': return {
      users: await discord.getReactions(req(input.channelId, 'channelId'), req(input.messageId, 'messageId'), req(input.emoji, 'emoji'), input.limit),
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
    case 'discord.listInvites': return { invites: await discord.listInvites(req(input.guildId, 'guildId')) };
    case 'discord.createInvite': return await discord.createInvite(req(input.channelId, 'channelId'), input);
    case 'discord.deleteInvite': {
      const inviteCode = req(input.inviteCode || input.code, 'inviteCode');
      await discord.deleteInvite(inviteCode);
      return { ok: true, inviteCode };
    }
    case 'discord.listWebhooks': return { webhooks: await discord.listWebhooks(req(input.channelId, 'channelId')) };
    case 'discord.createWebhook': return await discord.createWebhook(req(input.channelId, 'channelId'), { name: input.name });
    case 'discord.deleteWebhook': {
      const webhookId = req(input.webhookId, 'webhookId');
      await discord.deleteWebhook(webhookId);
      return { ok: true, webhookId };
    }
    case 'discord.executeWebhook': return await discord.executeWebhook(
      req(input.webhookId, 'webhookId'),
      req(input.webhookToken, 'webhookToken'),
      input.payload ?? { content: input.content, embeds: input.embeds, username: input.username, avatar_url: input.avatarUrl },
    );
    case 'discord.listEvents': return { events: await discord.listScheduledEvents(req(input.guildId, 'guildId')) };
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
    case 'discord.listAutoModRules': return { rules: await discord.listAutoModRules(req(input.guildId, 'guildId')) };
    case 'discord.createAutoModRule': return await discord.createAutoModRule(req(input.guildId, 'guildId'), input.rule ?? input);
    case 'discord.deleteAutoModRule': {
      const guildId = req(input.guildId, 'guildId');
      const ruleId = req(input.ruleId, 'ruleId');
      await discord.deleteAutoModRule(guildId, ruleId);
      return { ok: true, guildId, ruleId };
    }
    case 'discord.downloadAttachment': return await discord.downloadAttachment(
      req(input.attachmentUrl || input.url, 'attachmentUrl'),
      str(input.savePath) || null,
    );
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
