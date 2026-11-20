import React from 'react';
import { toast } from '@/components/ui';
import { discordApi, type DiscordChannel, type DiscordRole } from '@/lib/discord/api';

export const DiscordServerManage: React.FC<{
  guildId: string;
  activeChannel: DiscordChannel | null;
  roles: DiscordRole[];
  onRefresh: () => void;
}> = ({ guildId, activeChannel, roles, onRefresh }) => {
  const [newChannelName, setNewChannelName] = React.useState('');
  const [newTopic, setNewTopic] = React.useState(activeChannel?.topic ?? '');
  const [slowmode, setSlowmode] = React.useState(String(activeChannel?.rateLimitPerUser ?? 0));

  React.useEffect(() => {
    setNewTopic(activeChannel?.topic ?? '');
    setSlowmode(String(activeChannel?.rateLimitPerUser ?? 0));
  }, [activeChannel?.id, activeChannel?.topic, activeChannel?.rateLimitPerUser]);

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelName.trim()) return;
    try {
      await discordApi.createChannel(guildId, { name: newChannelName.trim() });
      setNewChannelName('');
      toast.success('Channel created');
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Permission denied');
    }
  };

  const handleUpdateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChannel) return;
    try {
      await discordApi.updateChannel(activeChannel.id, {
        topic: newTopic,
        rateLimitPerUser: Number.parseInt(slowmode, 10) || 0,
      });
      toast.success('Channel updated');
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Permission denied');
    }
  };

  return (
    <div className="h-full overflow-y-auto p-3 text-xs space-y-4">
      <form onSubmit={(e) => void handleCreateChannel(e)} className="space-y-2 rounded border border-border/60 bg-card/40 p-2.5">
        <div className="font-semibold">Create Text Channel</div>
        <input
          value={newChannelName}
          onChange={(e) => setNewChannelName(e.target.value)}
          placeholder="new-channel-name"
          className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
        />
        <button type="submit" className="rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground">
          Create
        </button>
      </form>

      {activeChannel ? (
        <form onSubmit={(e) => void handleUpdateChannel(e)} className="space-y-2 rounded border border-border/60 bg-card/40 p-2.5">
          <div className="font-semibold">Channel Settings (#{activeChannel.name})</div>
          <textarea
            rows={2}
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            placeholder="Channel topic…"
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
          />
          <label className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Slowmode (sec)</span>
            <input
              type="number"
              min={0}
              max={21600}
              value={slowmode}
              onChange={(e) => setSlowmode(e.target.value)}
              className="w-20 rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
            />
          </label>
          <button type="submit" className="rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground">
            Save Channel
          </button>
        </form>
      ) : null}

      <div className="space-y-1.5 rounded border border-border/60 bg-card/40 p-2.5">
        <div className="font-semibold">Roles ({roles.length})</div>
        <div className="flex flex-wrap gap-1">
          {roles.map((r) => (
            <span
              key={r.id}
              style={r.color ? { borderColor: `#${r.color.toString(16).padStart(6, '0')}` } : undefined}
              className="rounded border px-1.5 py-0.5 text-[10px]"
            >
              {r.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
