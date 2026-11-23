import { asNonEmptyString, isRecord } from '../shared/guards.js';
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

export const handleDiscordExtendedAction = async (action, input, discord) => {
  switch (action) {
    case 'discord.checkPermissions': return await discord.checkPermissions({
      guildId: req(input.guildId, 'guildId'),
      userId: str(input.userId) || null,
      channelId: str(input.channelId) || null,
    });
    case 'discord.policy': {
      if (!discord.safety) throw new SpleenControlError('Discord safety guard is unavailable', 503);
      if (isRecord(input.patch)) return await discord.safety.updatePolicy(input.patch);
      return await discord.safety.getPolicy();
    }
    case 'discord.auditTrail': {
      if (!discord.safety) return { entries: [] };
      return { entries: discord.safety.listAuditTrail(input.limit) };
    }
    case 'discord.listCommands': return {
      commands: await discord.interactions.listCommands({
        applicationId: str(input.applicationId) || null,
        guildId: str(input.guildId) || null,
      }),
    };
    case 'discord.upsertCommand': return await discord.interactions.upsertCommand({
      applicationId: str(input.applicationId) || null,
      guildId: str(input.guildId) || null,
      commandId: str(input.commandId) || null,
      command: isRecord(input.commandPayload) ? input.commandPayload : (isRecord(input.patch) ? input.patch : input),
    });
    case 'discord.bulkOverwriteCommands': return {
      commands: await discord.interactions.bulkOverwriteCommands({
        applicationId: str(input.applicationId) || null,
        guildId: str(input.guildId) || null,
        commands: Array.isArray(input.commands) ? input.commands : [],
      }),
    };
    case 'discord.deleteCommand': return await discord.interactions.deleteCommand({
      applicationId: str(input.applicationId) || null,
      guildId: str(input.guildId) || null,
      commandId: req(input.commandId, 'commandId'),
    });
    case 'discord.listInteractions': return {
      interactions: discord.interactions.listInteractions({
        limit: input.limit,
        unhandledOnly: Boolean(input.unhandledOnly),
      }),
    };
    case 'discord.respondInteraction': return await discord.interactions.respondInteraction({
      interactionId: req(input.interactionId, 'interactionId'),
      interactionToken: req(input.interactionToken, 'interactionToken'),
      type: input.responseType ?? input.type ?? 4,
      data: isRecord(input.data) ? input.data : (isRecord(input.payload) ? input.payload : undefined),
    });
    case 'discord.editInteractionResponse': return await discord.interactions.editInteractionResponse({
      applicationId: str(input.applicationId) || null,
      interactionToken: req(input.interactionToken, 'interactionToken'),
      messageId: str(input.messageId) || '@original',
      payload: isRecord(input.payload) ? input.payload : { content: input.content, embeds: input.embeds, components: input.components, flags: input.flags },
    });
    case 'discord.followupInteraction': return await discord.interactions.followupInteraction({
      applicationId: str(input.applicationId) || null,
      interactionToken: req(input.interactionToken, 'interactionToken'),
      payload: isRecord(input.payload) ? input.payload : { content: input.content, embeds: input.embeds, components: input.components, flags: input.flags },
    });
    case 'discord.deleteInteractionResponse': return await discord.interactions.deleteInteractionResponse({
      applicationId: str(input.applicationId) || null,
      interactionToken: req(input.interactionToken, 'interactionToken'),
      messageId: str(input.messageId) || '@original',
    });
    case 'discord.oauthUrl': return await discord.oauth.buildAuthorizeUrl({
      clientId: str(input.clientId) || str(input.applicationId) || null,
      redirectUri: str(input.redirectUri) || null,
      scopes: input.scopes,
      permissions: input.permissions,
      guildId: str(input.guildId) || null,
      integrationType: input.integrationType,
      usePkce: input.usePkce !== false,
    });
    case 'discord.oauthStatus': return await discord.oauth.getOAuthStatus();
    case 'discord.oauthRefresh': return await discord.oauth.refreshAccessToken({
      clientId: str(input.clientId) || str(input.applicationId) || null,
      clientSecret: str(input.clientSecret) || null,
    });
    case 'discord.oauthRevoke': return await discord.oauth.revokeToken({
      clientId: str(input.clientId) || str(input.applicationId) || null,
      clientSecret: str(input.clientSecret) || null,
      tokenTypeHint: str(input.tokenTypeHint) || 'access_token',
    });
    case 'discord.events': return {
      events: discord.gateway?.listEvents ? discord.gateway.listEvents({
        eventType: str(input.eventType) || null,
        guildId: str(input.guildId) || null,
        channelId: str(input.channelId) || null,
        limit: input.limit,
      }) : [],
      health: discord.gateway?.getHealth ? discord.gateway.getHealth() : null,
    };
    case 'discord.setPresence': {
      if (!discord.gateway?.setPresence) throw new SpleenControlError('Discord Gateway is unavailable', 503);
      return await discord.gateway.setPresence({
        status: str(input.presenceStatus) || str(input.status) || 'online',
        activities: Array.isArray(input.activities) ? input.activities : [],
        since: input.since ?? null,
        afk: Boolean(input.afk),
      });
    }
    case 'discord.voiceJoin': return await discord.voice.joinVoiceChannel({
      guildId: req(input.guildId, 'guildId'),
      channelId: req(input.channelId, 'channelId'),
      selfMute: Boolean(input.selfMute),
      selfDeaf: Boolean(input.selfDeaf),
    });
    case 'discord.voiceLeave': return await discord.voice.leaveVoiceChannel({
      guildId: req(input.guildId, 'guildId'),
    });
    case 'discord.voiceStatus': return discord.voice.getVoiceStatus({
      guildId: str(input.guildId) || null,
    });
    case 'discord.voiceMembers': return discord.voice.listVoiceMembers({
      guildId: str(input.guildId) || null,
      channelId: str(input.channelId) || null,
    });
    case 'discord.createEmoji': return await discord.createEmoji(
      req(input.guildId, 'guildId'),
      isRecord(input.payload) ? input.payload : { name: req(input.name, 'name'), image: req(input.image, 'image'), roles: input.roles },
      str(input.reason) || null,
    );
    case 'discord.updateEmoji': return await discord.updateEmoji(
      req(input.guildId, 'guildId'),
      req(input.emojiId, 'emojiId'),
      isRecord(input.patch) ? input.patch : { name: input.name, roles: input.roles },
      str(input.reason) || null,
    );
    case 'discord.deleteEmoji': {
      const guildId = req(input.guildId, 'guildId');
      const emojiId = req(input.emojiId, 'emojiId');
      await discord.deleteEmoji(guildId, emojiId, str(input.reason) || null);
      return { ok: true, guildId, emojiId };
    }
    case 'discord.guildWidget': {
      const guildId = req(input.guildId, 'guildId');
      if (isRecord(input.patch)) return await discord.updateGuildWidget(guildId, input.patch, str(input.reason) || null);
      return await discord.getGuildWidget(guildId);
    }
    case 'discord.guildOnboarding': {
      const guildId = req(input.guildId, 'guildId');
      if (isRecord(input.patch)) return await discord.updateGuildOnboarding(guildId, input.patch, str(input.reason) || null);
      return await discord.getGuildOnboarding(guildId);
    }
    case 'discord.guildWelcomeScreen': {
      const guildId = req(input.guildId, 'guildId');
      if (isRecord(input.patch)) return await discord.updateGuildWelcomeScreen(guildId, input.patch, str(input.reason) || null);
      return await discord.getGuildWelcomeScreen(guildId);
    }
    case 'discord.guildTemplates': {
      const guildId = req(input.guildId, 'guildId');
      const op = str(input.operation) || 'list';
      if (op === 'create') return await discord.createGuildTemplate(guildId, { name: req(input.name, 'name'), description: str(input.description) || null });
      if (op === 'sync') return await discord.syncGuildTemplate(guildId, req(input.code, 'code'));
      if (op === 'delete') return await discord.deleteGuildTemplate(guildId, req(input.code, 'code'));
      return { templates: await discord.listGuildTemplates(guildId) };
    }
    case 'discord.guildPrune': {
      const guildId = req(input.guildId, 'guildId');
      if (input.execute === true) {
        return await discord.pruneGuild(guildId, {
          days: input.days,
          computePruneCount: input.computePruneCount !== false,
          includeRoles: input.includeRoles,
          reason: str(input.reason) || null,
        });
      }
      return await discord.getGuildPruneCount(guildId, { days: input.days, includeRoles: input.includeRoles });
    }
    case 'discord.leaveGuild': {
      const guildId = req(input.guildId, 'guildId');
      await discord.leaveGuild(guildId);
      return { ok: true, guildId };
    }
    case 'discord.skus': {
      const appId = await discord.interactions.resolveApplicationId(str(input.applicationId) || null);
      return { skus: await discord.listSkus(appId) };
    }
    case 'discord.entitlements': {
      const appId = await discord.interactions.resolveApplicationId(str(input.applicationId) || null);
      const op = str(input.operation) || 'list';
      if (op === 'createTest') return await discord.createTestEntitlement(appId, isRecord(input.payload) ? input.payload : {});
      if (op === 'consume') return await discord.consumeEntitlement(appId, req(input.entitlementId, 'entitlementId'));
      return { entitlements: await discord.listEntitlements(appId, isRecord(input.query) ? input.query : {}) };
    }
    default:
      return null;
  }
};
