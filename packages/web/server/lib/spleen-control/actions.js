export const SPLEEN_CONTROL_ACTION_DEFINITIONS = Object.freeze([
  { action: 'projects.list', title: 'List session destinations', description: 'Projects and Chats; use an id as projectId for session.create. No parameters' },
  { action: 'models.list', title: 'Show model preferences', description: 'Default, favorite and recent models; no parameters' },
  { action: 'models.search', title: 'Search models', description: 'The model catalog, favorites and recent models first; optional query, provider, all, limit, offset' },
  { action: 'session.list', title: 'List sessions', description: 'Newest top-level sessions here; each has inWork (in the sidebar\'s In work) and doneSuggested (its last turn looks finished). Filters inWork, busy (running now), query (title words); inWork and busy span every project unless scoped and return all matches. Optional limit, all, children, withStatus (status as in session.status)' },
  { action: 'session.markDone', title: 'Mark a session done', description: 'Take sessionId (default: this session) out of In work, as the Done button does. Only on the user\'s word; a later message puts it back' },
  { action: 'session.track', title: 'Put a session in work', description: 'Put sessionId back in In work, as the Track button does, such as to undo a markDone' },
  { action: 'session.create', title: 'Create a session', description: 'In this directory by default; projectId from projects.list selects a project or spleen:chats for a new Chat. Use the returned directory for later session actions. Prompt optional' },
  { action: 'session.send', title: 'Send a prompt', description: 'New prompt to sessionId' },
  { action: 'session.fork', title: 'Fork a session', description: 'Fork sessionId at messageId; prompt optional' },
  { action: 'session.status', title: 'Check session status', description: 'Status of sessionId: busy, idle, or waiting when it cannot go on until the user answers it. An unknown id is an error' },
  { action: 'session.messages', title: 'Read session messages', description: 'Text messages and sessionStatus of sessionId' },
  { action: 'session.moveToWorktree', title: 'Move a session into a new worktree', description: 'Move sessionId (default: this session) and its carry files into a new worktree, made the way the New worktree dialog makes one; requires worktree. Nothing moves when carry cannot be applied; directory is ignored' },
  { action: 'session.link', title: 'Link a change or issue to a session', description: 'Add link to sessionId (default: this session); the same link again updates its title' },
  { action: 'session.unlink', title: 'Remove a link from a session', description: 'Remove a link from sessionId (default: this session), named by the url or identifier it was linked with' },
  { action: 'pr.watch', title: 'Wait on a pull request', description: 'Requires url of a GitHub pull request or GitLab merge request. Same as wait.start with source "pr"', agentExposed: false },
  { action: 'pr.unwatch', title: 'Stop waiting on a pull request', description: 'This session stops waiting on the pull request at url, or on every one without url', agentExposed: false },
  { action: 'wait.list', title: 'List waits', description: "This session's waits, and the sources to wait on (the built-in timer, pull requests, and what extensions offer), with the args each takes" },
  { action: 'wait.start', title: 'Wait on a timer, a pull request or an extension', description: 'Requires source and args: "timer" with { "minutes": N } (1 to 1440); "pr" with { "url": "<GitHub pull request or GitLab merge request address>" }, which wakes the session when a check fails or every check passes, someone comments or reviews, the branch conflicts or falls behind, or it is merged or closed; or a source from wait.list with args as its params say. Each pull request is its own wait, so a session can wait on several. One wake ends the wait, so start it again to keep waiting. End your turn while you wait. Never wait with a sleep loop' },
  { action: 'wait.stop', title: 'Stop a wait', description: 'Stop waitId (a pull request wait\'s waitId is its address), or every wait of this session without it' },
  { action: 'work.name', title: 'Name the task', description: 'Name the worktree\'s or isolated space\'s task for sessionId (default: this session), never a session. In title: at most 4 words in the user\'s latest language; rename only for a different task. A user-given name stays. Main checkout and plain folders need no naming. A worktree on an Spleen-generated placeholder branch also requires branch, the English branch name after the task, and renames it; any other branch stays' },
  { action: 'schedule.status', title: 'Check scheduler status', description: 'No parameters', agentExposed: false },
  { action: 'schedule.list', title: 'List scheduled tasks', description: 'Tasks and scheduler status' },
  { action: 'schedule.create', title: 'Create a scheduled task', description: 'Requires name, prompt, one schedule selector, and model unless targetSessionId is set. That session keeps its model and agent unless the task names others, which then become the session\'s. A named model is checked against the catalog when the task is written. runInWorktree (git only) runs each run in a fresh worktree on baseBranch (default HEAD); cleanupWorktree false keeps it' },
  { action: 'schedule.update', title: 'Change a scheduled task', description: 'Change taskId in place, keeping its id and run state; pass only what changes. runInWorktree, baseBranch and cleanupWorktree switch a task to run in an isolated worktree (git only)' },
  { action: 'schedule.run', title: 'Run a scheduled task', description: 'Run taskId now' },
  { action: 'schedule.delete', title: 'Delete a scheduled task', description: 'Delete taskId' },
  { action: 'schedule.toggle', title: 'Enable or disable a scheduled task', description: 'Requires taskId and disabled' },
  { action: 'file.open', title: 'Show a file to the user', description: 'Put path in front of the user\'s file panel, for a result worth seeing: a screenshot, report, CSV, recording, generated page' },
  { action: 'settings.list', title: 'List Spleen settings metadata', description: 'List all non-secret setting keys, scopes, and current values' },
  { action: 'settings.read', title: 'Read Spleen settings', description: 'Read non-secret Spleen settings (pass keys array, or omit for all non-secret settings)' },
  { action: 'settings.update', title: 'Update Spleen settings', description: 'Update non-secret Spleen settings with changes object (secrets/derived/computed fields are forbidden)' },
  { action: 'ui.control', title: 'Control Spleen UI', description: 'Control Spleen UI panels, settings dialog, active session, sidebar, theme, or toast (command: open_surface|close_surface|open_settings|close_settings|focus_session|toggle_sidebar|set_theme|notify)' },
  { action: 'session.stop', title: 'Stop a session run', description: 'Abort an active turn in sessionId (default: this session)' },
  { action: 'recovery.status', title: 'Read auto-continue status', description: 'List sessions in provider limit cooldown or recovery queue' },
  { action: 'recovery.resume', title: 'Resume recovery session now', description: 'Immediately continue sessionId parked in recovery' },
  { action: 'recovery.dismiss', title: 'Dismiss recovery state', description: 'Dismiss sessionId from the recovery queue' },
  { action: 'recovery.wake', title: 'Wake waiting recovery sessions', description: 'Check and resume all eligible sessions parked on provider limits' },
  { action: 'chat.link', title: 'Connect two sessions', description: 'Connect sourceSessionId (default: this session) and targetSessionId with relation (reference|supervise|delegate) and optional note' },
  { action: 'chat.links', title: 'List connected sessions', description: 'List connected session links for sessionId or all links' },
  { action: 'chat.unlink', title: 'Disconnect linked sessions', description: 'Remove a connected session link by linkId' },
  { action: 'team.list', title: 'List AI Teams', description: 'List all orchestrated AI Teams and task summaries' },
  { action: 'team.create', title: 'Create an AI Team', description: 'Create an AI Team (name, teamGoal, preset full-stack|research-build|bug-hunt|multi-review|custom, optional members, maxParallel, useWorktrees, initialTasks)' },
  { action: 'team.get', title: 'Inspect an AI Team', description: 'Read teamId roster, shared message board, and DAG tasks' },
  { action: 'team.addMember', title: 'Add member to AI Team', description: 'Add a specialized member (name, role, model, agent, description) to teamId' },
  { action: 'team.removeMember', title: 'Remove member from AI Team', description: 'Remove memberId from teamId' },
  { action: 'team.post', title: 'Post to AI Team board', description: 'Post a message to teamId shared board (mentions @role or @all wake members)' },
  { action: 'team.addTask', title: 'Add task to AI Team DAG', description: 'Add a DAG task to teamId (title, prompt, assignee, dependsOn[], acceptance, idempotencyKey)' },
  { action: 'team.updateTask', title: 'Update AI Team task', description: 'Update taskId status/result/error in teamId' },
  { action: 'team.retryTask', title: 'Retry AI Team task', description: 'Retry taskId in teamId' },
  { action: 'team.cancelTask', title: 'Cancel AI Team task', description: 'Cancel taskId in teamId' },
  { action: 'team.stop', title: 'Stop an AI Team', description: 'Stop all running members and pending tasks in teamId' },
  { action: 'agent.list', title: 'List configured project and user agents', description: 'List all custom OpenCode agents configured for this project or globally (optional directory)' },
  { action: 'agent.create', title: 'Create a custom project or user agent', description: 'Create a specialized AI agent (agentName, description, systemPrompt, model, agentMode primary|subagent|all, agentScope project|user, optional directory)' },
  { action: 'agent.update', title: 'Update a configured agent', description: 'Update an existing custom agent (agentName, description, systemPrompt, model, agentMode, optional directory)' },
  { action: 'agent.delete', title: 'Delete a configured agent', description: 'Delete a custom agent by agentName (optional directory)' },
  { action: 'discord.status', title: 'Check Discord status', description: 'Check whether the Discord reader is connected and which account is active' },
  { action: 'discord.me', title: 'Get current Discord account', description: 'Fetch the connected Discord account profile (/users/@me)' },
  { action: 'discord.application', title: 'Get Discord application info', description: 'Fetch current bot/application metadata (/applications/@me)' },
  { action: 'discord.relationships', title: 'List Discord friends/relationships', description: 'List friends and relationship entries for the connected user account' },
  { action: 'discord.guilds', title: 'List Discord servers', description: 'List Discord servers accessible to the connected account' },
  { action: 'discord.guild', title: 'Get Discord server details', description: 'Fetch full guild details with member/online counts for guildId' },
  { action: 'discord.updateGuild', title: 'Update Discord server', description: 'Update guildId settings with patch object (optional reason)' },
  { action: 'discord.dms', title: 'List Discord direct messages', description: 'List Discord DM channels accessible to the connected account' },
  { action: 'discord.createDm', title: 'Open Discord direct message', description: 'Open or create a Discord DM channel with recipientId' },
  { action: 'discord.channels', title: 'List Discord channels', description: 'Returns { channels: Channel[], threads: Channel[] } for guildId, or DM channels when omitted. For forum/media channels (type 15/16), use discord.listForumPosts' },
  { action: 'discord.channel', title: 'Get Discord channel info', description: 'Read metadata (name, topic, type, parentId, slowmode) for channelId' },
  { action: 'discord.createChannel', title: 'Create Discord channel', description: 'Create a channel (name, optional type, topic, parentId) in guildId' },
  { action: 'discord.updateChannel', title: 'Update Discord channel', description: 'Update channelId name, topic, rateLimitPerUser, or forum availableTags' },
  { action: 'discord.updateThread', title: 'Update Discord thread or forum post', description: 'Update threadId/channelId archived, locked, name, autoArchiveDuration, appliedTags[], or flags' },
  { action: 'discord.deleteChannel', title: 'Delete Discord channel', description: 'Delete channelId or thread' },
  { action: 'discord.followChannel', title: 'Follow Discord announcement channel', description: 'Follow announcement channelId into targetChannelId' },
  { action: 'discord.getStageInstance', title: 'Get Discord stage instance', description: 'Read the active stage instance on channelId' },
  { action: 'discord.createStageInstance', title: 'Start Discord stage instance', description: 'Start a stage instance on stage channelId (topic, optional privacyLevel, reason)' },
  { action: 'discord.updateStageInstance', title: 'Update Discord stage instance', description: 'Update stage instance topic or privacyLevel on channelId' },
  { action: 'discord.deleteStageInstance', title: 'End Discord stage instance', description: 'End the active stage instance on channelId (optional reason)' },
  { action: 'discord.voiceState', title: 'Get Discord user voice state', description: 'Read voice channel, mute, deaf, video, and stream state for userId in guildId' },
  { action: 'discord.setVoiceStatus', title: 'Set Discord voice channel status', description: 'Set or clear the status text on voice channelId' },
  { action: 'discord.setChannelPermission', title: 'Set Discord channel permission', description: 'Set role/member permission overwrite (overwriteId, type 0=role|1=member, allow, deny) on channelId' },
  { action: 'discord.deleteChannelPermission', title: 'Delete Discord channel permission', description: 'Remove permission overwriteId from channelId' },
  { action: 'discord.members', title: 'List Discord server members', description: 'List members in guildId (optional limit)' },
  { action: 'discord.member', title: 'Get Discord server member', description: 'Fetch a guild member (roles, nick, timeout) by guildId and userId' },
  { action: 'discord.searchMembers', title: 'Search Discord server members', description: 'Search members in guildId by username/nickname query' },
  { action: 'discord.updateMember', title: 'Update Discord server member', description: 'Update member nick, roles, timeout (communicationDisabledUntil), mute/deaf, or voice channelId' },
  { action: 'discord.setNickname', title: 'Set own Discord nickname', description: 'Change own nickname in guildId' },
  { action: 'discord.roles', title: 'List Discord server roles', description: 'List roles in guildId' },
  { action: 'discord.createRole', title: 'Create Discord role', description: 'Create a role in guildId (name, color, hoist, mentionable, permissions)' },
  { action: 'discord.updateRole', title: 'Update Discord role', description: 'Update roleId in guildId' },
  { action: 'discord.deleteRole', title: 'Delete Discord role', description: 'Delete roleId in guildId' },
  { action: 'discord.addRole', title: 'Add role to Discord member', description: 'Assign roleId to userId in guildId' },
  { action: 'discord.removeRole', title: 'Remove role from Discord member', description: 'Remove roleId from userId in guildId' },
  { action: 'discord.kickMember', title: 'Kick Discord member', description: 'Kick userId from guildId (optional reason)' },
  { action: 'discord.listBans', title: 'List Discord server bans', description: 'List banned users in guildId' },
  { action: 'discord.ban', title: 'Get Discord ban details', description: 'Fetch ban entry and reason for userId in guildId' },
  { action: 'discord.banMember', title: 'Ban Discord member', description: 'Ban userId from guildId (optional deleteMessageSeconds, reason)' },
  { action: 'discord.unbanMember', title: 'Unban Discord member', description: 'Unban userId from guildId' },
  { action: 'discord.auditLogs', title: 'Read Discord audit logs', description: 'Read moderation/admin audit logs for guildId' },
  { action: 'discord.user', title: 'Look up Discord user', description: 'Fetch a Discord user profile by userId' },
  { action: 'discord.messages', title: 'Read Discord messages', description: 'Read messages in channelId or threadId (optional limit, before, after — use after:"0" for opening post — or around)' },
  { action: 'discord.message', title: 'Read single Discord message', description: 'Fetch one Discord message by channelId and messageId (works on user & bot tokens and forum starter messages)' },
  { action: 'discord.pins', title: 'Read pinned Discord messages', description: 'Read pinned messages in channelId' },
  { action: 'discord.search', title: 'Search Discord messages', description: 'Search messages in guildId or channelId by query (optional authorId, offset)' },
  { action: 'discord.send', title: 'Send Discord message', description: 'Send content, embeds, components, poll, and/or local filePath to Discord channelId (optional replyToMessageId)' },
  { action: 'discord.editMessage', title: 'Edit Discord message', description: 'Edit messageId in channelId with new content' },
  { action: 'discord.deleteMessage', title: 'Delete Discord message', description: 'Delete messageId in channelId' },
  { action: 'discord.bulkDelete', title: 'Bulk delete Discord messages', description: 'Bulk delete 2-100 messageIds in channelId' },
  { action: 'discord.crosspost', title: 'Crosspost Discord announcement', description: 'Publish/crosspost messageId in announcement channelId' },
  { action: 'discord.react', title: 'React to Discord message', description: 'Add an emoji reaction to messageId in channelId' },
  { action: 'discord.unreact', title: 'Remove Discord reaction', description: 'Remove own emoji reaction from messageId in channelId' },
  { action: 'discord.getReactions', title: 'List Discord reaction users', description: 'List users who reacted with emoji on messageId in channelId' },
  { action: 'discord.clearReactions', title: 'Clear Discord reactions', description: 'Clear all reactions (or one emoji) from messageId in channelId' },
  { action: 'discord.pin', title: 'Pin Discord message', description: 'Pin messageId in channelId' },
  { action: 'discord.unpin', title: 'Unpin Discord message', description: 'Unpin messageId in channelId' },
  { action: 'discord.typing', title: 'Send Discord typing indicator', description: 'Show typing indicator in channelId' },
  { action: 'discord.createPoll', title: 'Create Discord poll', description: 'Create a native poll (question, answers[], durationHours, allowMultiselect) in channelId' },
  { action: 'discord.endPoll', title: 'End Discord poll', description: 'Immediately expire poll messageId in channelId' },
  { action: 'discord.pollVoters', title: 'List Discord poll voters', description: 'List users who voted for answerId on poll messageId in channelId' },
  { action: 'discord.createThread', title: 'Create Discord thread', description: 'Create a thread (threadName) in channelId (optional messageId)' },
  { action: 'discord.listForumPosts', title: 'List Discord forum posts', description: 'List active or archived posts in forum/media channelId (optional archived, limit, offset, before, tagIds[], sortBy, sortOrder, guildId); returns posts with firstMessage, hasMore, nextOffset, nextBefore' },
  { action: 'discord.createForumPost', title: 'Create Discord forum post', description: 'Create a post (title, content, optional embeds, appliedTags[]) in forum channelId' },
  { action: 'discord.archivedThreads', title: 'List archived Discord threads', description: 'List public or private archived threads in channelId (optional threadType, limit up to 100, before ISO cursor); returns threads, hasMore, nextBefore' },
  { action: 'discord.joinThread', title: 'Join Discord thread', description: 'Join threadId (or channelId)' },
  { action: 'discord.leaveThread', title: 'Leave Discord thread', description: 'Leave threadId (or channelId)' },
  { action: 'discord.threadMembers', title: 'List Discord thread members', description: 'List members in threadId' },
  { action: 'discord.addThreadMember', title: 'Add member to Discord thread', description: 'Add userId to threadId' },
  { action: 'discord.removeThreadMember', title: 'Remove member from Discord thread', description: 'Remove userId from threadId' },
  { action: 'discord.listInvites', title: 'List Discord invites', description: 'List active invites for guildId or channelId' },
  { action: 'discord.getInvite', title: 'Get Discord invite details', description: 'Fetch invite metadata, counts, and expiry by inviteCode' },
  { action: 'discord.createInvite', title: 'Create Discord invite', description: 'Create an invite link for channelId (optional maxAge, maxUses, temporary)' },
  { action: 'discord.deleteInvite', title: 'Delete Discord invite', description: 'Revoke inviteCode' },
  { action: 'discord.listWebhooks', title: 'List Discord webhooks', description: 'List webhooks in channelId or guildId' },
  { action: 'discord.createWebhook', title: 'Create Discord webhook', description: 'Create a webhook (name) in channelId' },
  { action: 'discord.updateWebhook', title: 'Update Discord webhook', description: 'Update webhookId settings (patch object, optional reason)' },
  { action: 'discord.deleteWebhook', title: 'Delete Discord webhook', description: 'Delete webhookId' },
  { action: 'discord.executeWebhook', title: 'Execute Discord webhook', description: 'Send a message via webhookId and webhookToken (optional threadId)' },
  { action: 'discord.listEvents', title: 'List Discord scheduled events', description: 'List scheduled events in guildId' },
  { action: 'discord.listEventUsers', title: 'List Discord event subscribers', description: 'List interested users for eventId in guildId (optional limit, before, after, withMember)' },
  { action: 'discord.createEvent', title: 'Create Discord scheduled event', description: 'Create a scheduled event in guildId' },
  { action: 'discord.updateEvent', title: 'Update Discord scheduled event', description: 'Update eventId in guildId' },
  { action: 'discord.deleteEvent', title: 'Delete Discord scheduled event', description: 'Delete eventId in guildId' },
  { action: 'discord.listEmojis', title: 'List Discord server emojis', description: 'List custom emojis in guildId' },
  { action: 'discord.createEmoji', title: 'Create Discord server emoji', description: 'Create a custom emoji (name, image data URI, optional roles[]) in guildId' },
  { action: 'discord.updateEmoji', title: 'Update Discord server emoji', description: 'Update emojiId name or roles in guildId' },
  { action: 'discord.deleteEmoji', title: 'Delete Discord server emoji', description: 'Delete emojiId in guildId' },
  { action: 'discord.listStickers', title: 'List Discord server stickers', description: 'List custom stickers in guildId' },
  { action: 'discord.listSoundboardSounds', title: 'List Discord soundboard sounds', description: 'List server soundboard sounds for guildId, or default Discord soundboard sounds when omitted' },
  { action: 'discord.listAutoModRules', title: 'List Discord AutoMod rules', description: 'List AutoMod rules in guildId' },
  { action: 'discord.createAutoModRule', title: 'Create Discord AutoMod rule', description: 'Create an AutoMod rule in guildId' },
  { action: 'discord.updateAutoModRule', title: 'Update Discord AutoMod rule', description: 'Update AutoMod ruleId in guildId (patch object, optional reason)' },
  { action: 'discord.deleteAutoModRule', title: 'Delete Discord AutoMod rule', description: 'Delete AutoMod ruleId in guildId' },
  { action: 'discord.checkPermissions', title: 'Calculate effective Discord permissions', description: 'Calculate effective Discord permission flags for userId (default self) in guildId (and optional channelId with overwrites)' },
  { action: 'discord.policy', title: 'Read or update Discord safety policy', description: 'Read safety policy (policyMode full|limited-write|read-only, confirmDestructive, allowedGuildIds, allowedChannelIds), or update with patch' },
  { action: 'discord.auditTrail', title: 'Read Spleen Discord action audit trail', description: 'List recent Discord write, moderation, and blocked actions recorded by Spleen' },
  { action: 'discord.listCommands', title: 'List Discord application commands', description: 'List global or guild slash/context commands (optional applicationId, guildId)' },
  { action: 'discord.upsertCommand', title: 'Create or edit Discord command', description: 'Create or update a slash/context/activity command (commandPayload, optional commandId, guildId, applicationId)' },
  { action: 'discord.bulkOverwriteCommands', title: 'Bulk overwrite Discord commands', description: 'Replace all global or guild application commands with commands[]' },
  { action: 'discord.deleteCommand', title: 'Delete Discord application command', description: 'Delete commandId globally or in guildId' },
  { action: 'discord.listInteractions', title: 'List inbound Discord interactions', description: 'Inspect recent slash command, button, select menu, and modal interactions (optional limit, unhandledOnly)' },
  { action: 'discord.respondInteraction', title: 'Respond to Discord interaction', description: 'Send an interaction callback (interactionId, interactionToken, responseType 4|5|6|7|8|9, data)' },
  { action: 'discord.editInteractionResponse', title: 'Edit Discord interaction response', description: 'Edit the original or follow-up interaction message (interactionToken, payload, optional messageId)' },
  { action: 'discord.followupInteraction', title: 'Send Discord interaction follow-up', description: 'Send a follow-up message to an interaction (interactionToken, payload)' },
  { action: 'discord.deleteInteractionResponse', title: 'Delete Discord interaction response', description: 'Delete the original or follow-up interaction message (interactionToken, optional messageId)' },
  { action: 'discord.oauthUrl', title: 'Generate Discord OAuth2 PKCE URL', description: 'Build an official Discord OAuth2 authorization URL with PKCE S256 (clientId, scopes[], optional redirectUri, permissions, guildId)' },
  { action: 'discord.oauthStatus', title: 'Check Discord OAuth2 status', description: 'Check stored OAuth2 authorization state, scopes, and expiry (never exposes tokens)' },
  { action: 'discord.oauthRefresh', title: 'Refresh Discord OAuth2 token', description: 'Refresh the stored Discord OAuth2 access token' },
  { action: 'discord.oauthRevoke', title: 'Revoke Discord OAuth2 token', description: 'Revoke and clear the stored Discord OAuth2 token' },
  { action: 'discord.events', title: 'Read real-time Discord Gateway events', description: 'Read buffered Gateway events (optional eventType, guildId, channelId, limit) and Gateway health/latency' },
  { action: 'discord.setPresence', title: 'Set Discord bot presence', description: 'Update connected bot online/idle/dnd/invisible status and activities[] via Gateway OP 3 (bot tokens only)' },
  { action: 'discord.voiceJoin', title: 'Join Discord voice channel (bot)', description: 'Connect bot to voice channelId in guildId via official Gateway OP 4 and Voice Gateway v4' },
  { action: 'discord.voiceLeave', title: 'Leave Discord voice channel', description: 'Disconnect bot from voice in guildId' },
  { action: 'discord.voiceStatus', title: 'Check Discord voice sessions', description: 'Inspect active bot Voice Gateway sessions and connected participants' },
  { action: 'discord.voiceMembers', title: 'List Discord voice channel members', description: 'List live connected voice members tracked via Gateway (optional guildId, channelId)' },
  { action: 'discord.guildWidget', title: 'Get or update Discord server widget', description: 'Read guildId widget settings, or update with patch' },
  { action: 'discord.guildOnboarding', title: 'Get or update Discord onboarding', description: 'Read guildId onboarding prompts/options, or update with patch' },
  { action: 'discord.guildWelcomeScreen', title: 'Get or update Discord welcome screen', description: 'Read guildId welcome screen, or update with patch' },
  { action: 'discord.guildTemplates', title: 'Manage Discord server templates', description: 'List, create, sync, or delete guildId templates (operation list|create|sync|delete)' },
  { action: 'discord.guildPrune', title: 'Preview or run Discord member prune', description: 'Preview inactive member prune count (days, includeRoles[]) or execute with execute:true and confirm:true' },
  { action: 'discord.leaveGuild', title: 'Leave Discord server', description: 'Leave guildId (supports dryRun and confirmDestructive guard)' },
  { action: 'discord.skus', title: 'List Discord application SKUs', description: 'List monetization SKUs for applicationId (default current application)' },
  { action: 'discord.entitlements', title: 'Manage Discord entitlements', description: 'List, createTest, or consume application entitlements (operation list|createTest|consume)' },
  { action: 'discord.downloadAttachment', title: 'Download Discord attachment', description: 'Download a Discord CDN url/attachmentUrl to savePath (absolute or relative to session directory, creating parent dirs and overwriting) or temp file when savePath is omitted' },
  { action: 'discord.api', title: 'Call any Discord REST API v10 endpoint', description: 'Call any Discord REST v10 endpoint directly (method GET|POST|PUT|PATCH|DELETE, path starting with /, optional query as object or querystring, body, reason)' },
  { action: 'uc.status', title: 'Check UnknownCheats session status', description: 'Check UnknownCheats login/cookie status, username, bookmarks, and history counts' },
  { action: 'uc.home', title: 'Read UnknownCheats home', description: 'List UnknownCheats forums and categories (returns verification prompt if Cloudflare/login gated)' },
  { action: 'uc.recent', title: 'Read recent UnknownCheats threads', description: 'List today’s active threads on unknowncheats.me (optional page)' },
  { action: 'uc.forum', title: 'Read UnknownCheats forum', description: 'List threads in a forum url or fid on unknowncheats.me' },
  { action: 'uc.thread', title: 'Read UnknownCheats thread', description: 'Read posts and code blocks in a thread url or tid on unknowncheats.me' },
  { action: 'uc.search', title: 'Search UnknownCheats', description: 'Search threads on unknowncheats.me by query' },
  { action: 'uc.bookmarks', title: 'List UnknownCheats bookmarks', description: 'List saved UnknownCheats thread bookmarks' },
  { action: 'uc.addBookmark', title: 'Bookmark UnknownCheats thread', description: 'Save an UnknownCheats thread bookmark (id, title, url, optional forum)' },
  { action: 'uc.history', title: 'List UnknownCheats reading history', description: 'List recently viewed UnknownCheats threads' },
]);

const SPLEEN_CONTROL_ACTIONS = Object.freeze(
  SPLEEN_CONTROL_ACTION_DEFINITIONS.map(({ action }) => action),
);

const AGENT_EXPOSED_CONTROL_ACTION_DEFINITIONS = SPLEEN_CONTROL_ACTION_DEFINITIONS
  .filter(({ agentExposed }) => agentExposed !== false);
const isScheduleAction = ({ action }) => action.startsWith('schedule.');

export const SPLEEN_AGENT_TOOL_ACTION_DEFINITIONS = Object.freeze(
  AGENT_EXPOSED_CONTROL_ACTION_DEFINITIONS.filter((definition) => !isScheduleAction(definition)),
);

export const SPLEEN_AGENT_TOOL_ACTIONS = Object.freeze(
  SPLEEN_AGENT_TOOL_ACTION_DEFINITIONS.map(({ action }) => action),
);

export const SPLEEN_SCHEDULE_ACTION_DEFINITIONS = Object.freeze(
  AGENT_EXPOSED_CONTROL_ACTION_DEFINITIONS.filter(isScheduleAction),
);

export const SPLEEN_SCHEDULE_ACTIONS = Object.freeze(
  SPLEEN_SCHEDULE_ACTION_DEFINITIONS.map(({ action }) => action),
);

export const SPLEEN_WEB_ACTION_DEFINITIONS = Object.freeze([
  { action: 'browser.open', title: 'Open a page in the browser panel', description: 'Load url; without tabId into a new background tab, whose tabId the result returns for later actions. drivable false means display-only: no further actions there' },
  { action: 'browser.snapshot', title: 'Read the open page', description: 'url, title, visible text, interactive elements with refs (e12) and selectors, frames and shadow DOM included, logged errors, an open dialog, and open tabs with their ids and who opened each; selector reads one part of the top document. Refs last until the next snapshot' },
  { action: 'browser.click', title: 'Click on the open page', description: 'By ref, selector, or text for a link or button label; a real mouse click' },
  { action: 'browser.hover', title: 'Hover over an element', description: 'Move the mouse over ref, selector or text, for menus and tooltips that open on hover' },
  { action: 'browser.type', title: 'Type into the open page', description: 'Replace the text of the field ref or selector with value; submit presses Enter after' },
  { action: 'browser.press', title: 'Press a key', description: 'key such as Enter, Escape, Tab, ArrowDown, Shift+Tab or Meta+a; into ref or selector when given, else wherever the page has focus' },
  { action: 'browser.select', title: 'Select an option on the open page', description: 'One exact option by label or value in the native select ref or selector' },
  { action: 'browser.drag', title: 'Drag an element onto another', description: 'Press on ref or selector, move to to (a ref) or toSelector, release' },
  { action: 'browser.upload', title: 'Put files in a file input', description: 'paths into the file input ref or selector, which the snapshot lists even when hidden. Only files in this session\'s folder or OpenCode\'s temp folder' },
  { action: 'browser.dialog', title: 'Answer a page dialog', description: 'In a tab the user opened: accept true or false for the alert, confirm or prompt the page opened; value is the prompt answer. Until answered, the page runs nothing else' },
  { action: 'browser.wait', title: 'Wait for the page', description: 'Until text, ref or selector shows on the page, or with gone until it leaves; timeoutMs at most 15000' },
  { action: 'browser.scroll', title: 'Scroll the open page', description: 'By direction, or to bring ref or selector into view' },
  { action: 'browser.back', title: 'Go back in the browser panel', description: 'No parameters' },
  { action: 'browser.forward', title: 'Go forward in the browser panel', description: 'No parameters' },
  { action: 'browser.inspect', title: 'Read how an element renders', description: 'Computed styles of ref or selector as rendered' },
  { action: 'browser.capture', title: 'Save a screenshot of the page', description: 'Save the visible panel as an image in the project; returns its path to cite in your answer' },
  { action: 'browser.resize', title: 'Change the page viewport', description: 'Lay the page out at viewport; fill uses the whole panel' },
  { action: 'browser.close', title: 'Close a browser tab', description: 'Close a tab this session opened; without tabId, its most recent one. Never a tab the user opened' },
]);

export const SPLEEN_WEB_ACTIONS = Object.freeze(
  SPLEEN_WEB_ACTION_DEFINITIONS.map(({ action }) => action),
);

export const SPLEEN_MEMORY_ACTION_DEFINITIONS = Object.freeze([
  { action: 'memory.read', title: 'Read a stored memory', description: 'Full text of one memory; requires title or memoryId' },
  { action: 'memory.list', title: 'List stored memories', description: 'Titles, when the session index is missing, stale or cut short' },
  { action: 'memory.save', title: 'Remember something', description: 'Requires title, body, scope. Saving the same thing updates it; memoryId rewrites that entry, to correct one or merge several into it' },
  { action: 'memory.delete', title: 'Forget a memory', description: 'For a memory that turned out wrong or obsolete; requires memoryId and scope' },
]);

export const SPLEEN_MEMORY_ACTIONS = Object.freeze(
  SPLEEN_MEMORY_ACTION_DEFINITIONS.map(({ action }) => action),
);

export const SPLEEN_KNOWLEDGE_ACTION_DEFINITIONS = Object.freeze([
  { action: 'knowledge.list', title: 'List project knowledge', description: 'Notes with text, todos with state and links, plans with their file paths and session. Optional planId and ready filters. List before adding, to avoid duplicates' },
  { action: 'knowledge.save', title: 'Save project knowledge', description: 'Requires kind and body; with id it replaces. A plan body is the whole markdown, and the answer gives its path. An update may send only the fields it changes: completed, planId or dependsOn; sessionId on a plan, without body' },
  { action: 'knowledge.delete', title: 'Delete project knowledge', description: 'Requires kind and id' },
  { action: 'knowledge.show', title: 'Show a plan to the user', description: 'Open a plan for the user to read, comment on and send to a session; requires kind plan and id' },
]);

export const SPLEEN_KNOWLEDGE_ACTIONS = Object.freeze(
  SPLEEN_KNOWLEDGE_ACTION_DEFINITIONS.map(({ action }) => action),
);

export const SPLEEN_NOTIFY_ACTION_DEFINITIONS = Object.freeze([
  { action: 'notify.send', title: 'Notify the user', description: 'Requires title' },
]);

export const SPLEEN_NOTIFY_ACTIONS = Object.freeze(
  SPLEEN_NOTIFY_ACTION_DEFINITIONS.map(({ action }) => action),
);

export const SPLEEN_RENDER_ACTION_DEFINITIONS = Object.freeze([
  { action: 'render.page', title: 'Show a page', description: 'Requires html and title' },
]);

export const SPLEEN_RENDER_ACTIONS = Object.freeze(
  SPLEEN_RENDER_ACTION_DEFINITIONS.map(({ action }) => action),
);

export const SPLEEN_IMAGE_ACTION_DEFINITIONS = Object.freeze([
  { action: 'image.generate', title: 'Generate an image', description: 'Requires prompt' },
]);

export const SPLEEN_IMAGE_ACTIONS = Object.freeze(
  SPLEEN_IMAGE_ACTION_DEFINITIONS.map(({ action }) => action),
);

export const SPLEEN_SECRET_ACTION_DEFINITIONS = Object.freeze([
  { action: 'secret.run', title: 'Run with secrets', description: 'Requires program, reason and inputs; optional args and timeoutMs' },
  { action: 'secret.request', title: 'Ask for a secret', description: 'Requires label and reason' },
  { action: 'secret.forget', title: 'Forget remembered secrets', description: 'No inputs' },
]);

export const SPLEEN_SECRET_ACTIONS = Object.freeze(
  SPLEEN_SECRET_ACTION_DEFINITIONS.map(({ action }) => action),
);

export const SPLEEN_USAGE_ACTION_DEFINITIONS = Object.freeze([
  { action: 'usage.read', title: 'Read usage limits', description: 'Usage windows, percentages and resets of every configured provider, as Settings > Usage shows them; providerId reads one' },
]);

export const SPLEEN_USAGE_ACTIONS = Object.freeze(
  SPLEEN_USAGE_ACTION_DEFINITIONS.map(({ action }) => action),
);

export const SPLEEN_TERMINAL_ACTION_DEFINITIONS = Object.freeze([
  { action: 'terminal.list', title: 'List terminals', description: "This folder's terminal panels: sessionId, cwd, status, createdAt, mode and purpose, without their output; directory lists another folder's" },
  { action: 'terminal.read', title: 'Read a terminal', description: 'The output a terminal from terminal.list printed, as plain text end-aligned to a line; maxBytes caps it, truncated says older output was dropped and retainedBytes how much this server still holds' },
]);

export const SPLEEN_TERMINAL_ACTIONS = Object.freeze(
  SPLEEN_TERMINAL_ACTION_DEFINITIONS.map(({ action }) => action),
);

export const SPLEEN_WORKFLOW_ACTION_DEFINITIONS = Object.freeze([
  { action: 'workflow.check', title: 'Check a workflow', description: 'Compile script, or a saved workflow by name, without running it: its name, description and phases' },
  { action: 'workflow.run', title: 'Propose a workflow run', description: 'script, or name of a saved workflow, with optional args. The run waits for the user to approve it in the chat, or starts at once when their settings allow that; the report arrives here as a message when the run ends. Returns runId and state at once' },
  { action: 'workflow.status', title: 'Check a workflow run', description: 'Phases, agents with their state, key and session id, recent log lines and a result preview of runId' },
  { action: 'workflow.result', title: 'Read a workflow result', description: "The whole result of runId; with agent (its key or session id) that agent's prompt and full answer" },
  { action: 'workflow.stop', title: 'Stop a workflow run', description: 'Stop runId; its running agents are interrupted' },
  { action: 'workflow.resume', title: 'Resume a workflow run', description: 'Run a stopped or failed runId again: agents asked the same as before return their saved answer, the rest run' },
  { action: 'workflow.save', title: 'Save a workflow', description: 'Save script as .spleen/workflows/<meta.name>.js in this project, to run later by name; overwrite replaces one' },
  { action: 'workflow.list', title: 'List workflows', description: "This project's saved workflows and this session's runs" },
]);

export const SPLEEN_WORKFLOW_ACTIONS = Object.freeze(
  SPLEEN_WORKFLOW_ACTION_DEFINITIONS.map(({ action }) => action),
);

export const WORKFLOW_ANSWER_TOOL = 'spleen_workflow_answer';

export const SPLEEN_WORKFLOW_ANSWER_ACTION_DEFINITIONS = Object.freeze([
  { action: 'workflow.answer', title: 'Submit a workflow answer', description: 'Only for a workflow agent whose prompt asks for it: answer, a JSON value matching the schema in that prompt. Checked on the spot; a mismatch says what to fix' },
]);

export const SPLEEN_WORKFLOW_ANSWER_ACTIONS = Object.freeze(
  SPLEEN_WORKFLOW_ANSWER_ACTION_DEFINITIONS.map(({ action }) => action),
);

const ACTIONS_BY_TOOL = Object.freeze({
  spleen: SPLEEN_AGENT_TOOL_ACTIONS,
  spleen_schedule: SPLEEN_SCHEDULE_ACTIONS,
  spleen_web: SPLEEN_WEB_ACTIONS,
  spleen_memory: SPLEEN_MEMORY_ACTIONS,
  spleen_knowledge: SPLEEN_KNOWLEDGE_ACTIONS,
  spleen_notify: SPLEEN_NOTIFY_ACTIONS,
  spleen_render: SPLEEN_RENDER_ACTIONS,
  spleen_image: SPLEEN_IMAGE_ACTIONS,
  spleen_secret: SPLEEN_SECRET_ACTIONS,
  spleen_usage: SPLEEN_USAGE_ACTIONS,
  spleen_terminal: SPLEEN_TERMINAL_ACTIONS,
  spleen_workflow: SPLEEN_WORKFLOW_ACTIONS,
  [WORKFLOW_ANSWER_TOOL]: SPLEEN_WORKFLOW_ANSWER_ACTIONS,
});

const bareName = (action) => {
  const separator = action.indexOf('.');
  return separator === -1 ? action : action.slice(separator + 1);
};

const uniqueMatch = (candidates, requested) => {
  const matches = candidates.filter((candidate) => bareName(candidate) === requested);
  return matches.length === 1 ? matches[0] : null;
};

export const resolveAgentToolAction = (requested, toolName) => {
  const value = typeof requested === 'string' ? requested.trim() : '';
  const scoped = ACTIONS_BY_TOOL[toolName] ?? null;
  const known = scoped ?? SPLEEN_ALL_ACTIONS;

  if (value && known.includes(value)) {
    return { action: value };
  }
  if (value) {
    const resolved = uniqueMatch(known, value)
      ?? (scoped ? null : uniqueMatch(SPLEEN_ALL_ACTIONS, value));
    if (resolved) {
      return { action: resolved };
    }
  }

  return {
    error: `Unsupported Spleen action: ${value || 'missing'}. Use one of: ${known.join(', ')}`,
  };
};

export const SPLEEN_ALL_ACTIONS = Object.freeze([
  ...SPLEEN_CONTROL_ACTIONS,
  ...SPLEEN_WEB_ACTIONS,
  ...SPLEEN_MEMORY_ACTIONS,
  ...SPLEEN_KNOWLEDGE_ACTIONS,
  ...SPLEEN_NOTIFY_ACTIONS,
  ...SPLEEN_RENDER_ACTIONS,
  ...SPLEEN_IMAGE_ACTIONS,
  ...SPLEEN_SECRET_ACTIONS,
  ...SPLEEN_USAGE_ACTIONS,
  ...SPLEEN_TERMINAL_ACTIONS,
  ...SPLEEN_WORKFLOW_ACTIONS,
  ...SPLEEN_WORKFLOW_ANSWER_ACTIONS,
]);
