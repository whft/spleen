import React from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { toast } from '@/components/ui/toast';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useInputStore } from '@/sync/input-store';
import {
  openDesktopBrowserWindow,
  openUcVerificationWindow,
  readUcVerificationCookies,
} from '@/lib/desktop';
import {
  unknownCheatsApi,
  type UcBookmark,
  type UcForumItem,
  type UcGate,
  type UcHistoryEntry,
  type UcPost,
  type UcPostBlock,
  type UcStatus,
  type UcThreadSummary,
} from '@/lib/unknowncheats/api';

type UcTab = 'home' | 'forum' | 'thread' | 'search' | 'bookmarks' | 'history' | 'session';

const UcSpoilerBlock: React.FC<{ title: string; text: string }> = ({ title, text }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="my-1.5 rounded-md border border-border/70 bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        <span>{title || 'Spoiler'}</span>
        <span className="font-mono text-[10px]">{open ? 'HIDE' : 'SHOW'}</span>
      </button>
      {open ? (
        <div className="border-t border-border/60 px-2.5 py-2 text-xs whitespace-pre-wrap text-foreground/90">
          {text}
        </div>
      ) : null}
    </div>
  );
};

const UcCodeBlock: React.FC<{
  language: string;
  code: string;
  threadTitle: string;
  author: string;
  onAnalyze: (text: string) => void;
}> = ({ language, code, threadTitle, author, onAnalyze }) => {
  const { t } = useI18n();
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Copied code block');
    } catch {
      toast.error('Failed to copy');
    }
  };
  const handleSendToAi = () => {
    const formatted = [
      `Analyze this code snippet from UnknownCheats thread "${threadTitle}" (by ${author}):`,
      `\`\`\`${language || 'cpp'}`,
      code,
      '```',
    ].join('\n');
    onAnalyze(formatted);
  };

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border/80 bg-[#08090A]">
      <div className="flex items-center justify-between border-b border-border/70 bg-[#111416] px-2.5 py-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {language || 'code'} · {code.split('\n').length} lines
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={handleSendToAi}
            className="rounded border border-border/80 bg-[#171B1D] px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted/70"
          >
            {t('uc.action.analyzeCode')}
          </button>
        </div>
      </div>
      <pre className="max-h-96 overflow-auto p-2.5 font-mono text-[11px] leading-relaxed text-foreground/95 select-text">
        <code>{code}</code>
      </pre>
    </div>
  );
};

export const UnknownCheatsPanel: React.FC<{ visible?: boolean }> = ({ visible = true }) => {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<UcTab>('home');
  const [status, setStatus] = React.useState<UcStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [gate, setGate] = React.useState<{ info: UcGate; url?: string } | null>(null);

  const [forums, setForums] = React.useState<UcForumItem[]>([]);
  const [forumFilter, setForumFilter] = React.useState('');

  const [activeForum, setActiveForum] = React.useState<{
    id?: string;
    title: string;
    url: string;
    page: number;
    totalPages: number;
    threads: UcThreadSummary[];
  } | null>(null);

  const [activeThread, setActiveThread] = React.useState<{
    id: string;
    title: string;
    url: string;
    page: number;
    totalPages: number;
    posts: UcPost[];
  } | null>(null);
  const [codeOnly, setCodeOnly] = React.useState(false);
  const [lightboxSrc, setLightboxSrc] = React.useState<string | null>(null);

  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchState, setSearchState] = React.useState<{
    query: string;
    page: number;
    totalPages: number;
    results: UcThreadSummary[];
  } | null>(null);

  const [bookmarks, setBookmarks] = React.useState<UcBookmark[]>([]);
  const [history, setHistory] = React.useState<UcHistoryEntry[]>([]);
  const [cookieInput, setCookieInput] = React.useState('');
  const [syncingCookies, setSyncingCookies] = React.useState(false);

  const sendToSpleenAi = React.useCallback((text: string) => {
    useInputStore.getState().setPendingInputText(text, 'append');
    toast.success('Added UnknownCheats context to Spleen AI composer');
  }, []);

  const refreshStatusAndLists = React.useCallback(async () => {
    try {
      const [st, bm, hi] = await Promise.all([
        unknownCheatsApi.status(),
        unknownCheatsApi.bookmarks(),
        unknownCheatsApi.history(),
      ]);
      setStatus(st);
      setBookmarks(bm);
      setHistory(hi);
    } catch {
      // ignore initial status fetch errors
    }
  }, []);

  const loadHome = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setGate(null);
    try {
      const res = await unknownCheatsApi.home();
      if (res.gated) {
        setGate({ info: res.gate, url: res.url || res.gate.targetUrl });
      } else {
        setForums(res.forums);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const openForum = React.useCallback(async (params: { fid?: string; url?: string; title?: string; page?: number }) => {
    setTab('forum');
    setLoading(true);
    setError(null);
    setGate(null);
    try {
      const res = await unknownCheatsApi.forum({ fid: params.fid, url: params.url, page: params.page ?? 1 });
      if (res.gated) {
        setGate({ info: res.gate, url: res.url || res.gate.targetUrl || params.url });
      } else {
        setActiveForum({
          id: params.fid,
          title: res.title || params.title || 'Forum',
          url: res.url,
          page: res.page,
          totalPages: res.totalPages,
          threads: res.threads,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const openThread = React.useCallback(async (params: { tid?: string; url?: string; page?: number }) => {
    setTab('thread');
    setLoading(true);
    setError(null);
    setGate(null);
    try {
      const res = await unknownCheatsApi.thread({ tid: params.tid, url: params.url, page: params.page ?? 1 });
      if (res.gated) {
        setGate({ info: res.gate, url: res.url || res.gate.targetUrl || params.url });
      } else {
        setActiveThread({
          id: res.id,
          title: res.title,
          url: res.url,
          page: res.page,
          totalPages: res.totalPages,
          posts: res.posts,
        });
        void refreshStatusAndLists();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [refreshStatusAndLists]);

  const runSearch = React.useCallback(async (query: string, page = 1) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setTab('search');
    setLoading(true);
    setError(null);
    setGate(null);
    try {
      const res = await unknownCheatsApi.search(trimmed, page);
      if (res.gated) {
        setGate({ info: res.gate, url: res.url || res.gate.targetUrl });
      } else {
        setSearchState({
          query: trimmed,
          page: res.page,
          totalPages: res.totalPages,
          results: res.results,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const retryActiveView = React.useCallback(() => {
    if (tab === 'thread' && activeThread) {
      void openThread({ tid: activeThread.id, url: activeThread.url, page: activeThread.page });
      return;
    }
    if (tab === 'forum' && activeForum) {
      void openForum({ fid: activeForum.id, url: activeForum.url, title: activeForum.title, page: activeForum.page });
      return;
    }
    if (tab === 'search' && searchQuery.trim()) {
      void runSearch(searchQuery.trim(), searchState?.page ?? 1);
      return;
    }
    void loadHome();
  }, [activeForum, activeThread, loadHome, openForum, openThread, runSearch, searchQuery, searchState?.page, tab]);

  React.useEffect(() => {
    if (!visible) return;
    void refreshStatusAndLists();
    if (forums.length === 0 && !loading && !gate) {
      void loadHome();
    }
  }, [forums.length, gate, loadHome, loading, refreshStatusAndLists, visible]);

  const handleOpenVerificationWindow = async (targetUrl?: string) => {
    const opened = await openUcVerificationWindow(targetUrl || gate?.url || 'https://www.unknowncheats.me/forum/');
    if (opened) {
      toast.info('Complete verification or login in the UnknownCheats window, then click Sync Verified Session.');
    } else {
      void openDesktopBrowserWindow(targetUrl || gate?.url || 'https://www.unknowncheats.me/forum/', 'UnknownCheats');
    }
  };

  const handleSyncVerificationCookies = async () => {
    setSyncingCookies(true);
    try {
      const res = await readUcVerificationCookies();
      if (!res.ok || !res.cookieHeader.trim()) {
        toast.error(
          res.error === 'verification_window_not_open'
            ? 'Open the UnknownCheats Verification Window first, complete verification, then sync.'
            : 'No verification cookies available yet — complete verification in the window or paste Cookie header below.',
        );
        return;
      }
      const nextStatus = await unknownCheatsApi.setCookies(res.cookieHeader);
      setStatus(nextStatus);
      setGate(null);
      toast.success(`Synced ${res.count} UnknownCheats session cookies`);
      retryActiveView();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to sync verification cookies');
    } finally {
      setSyncingCookies(false);
    }
  };

  const handleSaveManualCookies = async () => {
    const trimmed = cookieInput.trim();
    if (!trimmed) return;
    try {
      const nextStatus = await unknownCheatsApi.setCookies(trimmed);
      setStatus(nextStatus);
      setCookieInput('');
      setGate(null);
      toast.success('Saved UnknownCheats session cookies');
      retryActiveView();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save cookies');
    }
  };

  const handleClearCookies = async () => {
    try {
      const nextStatus = await unknownCheatsApi.clearCookies();
      setStatus(nextStatus);
      toast.success('Cleared UnknownCheats session cookies');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear cookies');
    }
  };

  const isBookmarked = React.useCallback(
    (idOrUrl: string) => bookmarks.some((b) => b.id === idOrUrl || b.url === idOrUrl),
    [bookmarks],
  );

  const toggleBookmark = async (item: { id: string; title: string; url: string; forum?: string | null }) => {
    try {
      if (isBookmarked(item.id) || isBookmarked(item.url)) {
        const match = bookmarks.find((b) => b.id === item.id || b.url === item.url);
        const next = await unknownCheatsApi.removeBookmark(match?.id ?? item.id);
        setBookmarks(next);
        toast.info('Removed bookmark');
      } else {
        const next = await unknownCheatsApi.addBookmark(item);
        setBookmarks(next);
        toast.success('Bookmarked thread');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bookmark update failed');
    }
  };

  const handleSendFullThreadToAi = () => {
    if (!activeThread) return;
    const digest = activeThread.posts
      .slice(0, 12)
      .map((p) => `[#${p.number} ${p.author}${p.timestamp ? ` · ${p.timestamp}` : ''}]\n${p.rawText}`)
      .join('\n\n---\n\n');
    sendToSpleenAi(
      `Summarize and analyze this UnknownCheats thread "${activeThread.title}" (${activeThread.url}, page ${activeThread.page}/${activeThread.totalPages}):\n\n${digest}`,
    );
  };

  const filteredForums = React.useMemo(() => {
    const q = forumFilter.trim().toLowerCase();
    return q ? forums.filter((f) => f.title.toLowerCase().includes(q) || f.id.toLowerCase().includes(q)) : forums;
  }, [forumFilter, forums]);

  const renderThreadRow = (thread: UcThreadSummary) => {
    const saved = isBookmarked(thread.id) || isBookmarked(thread.url);
    return (
      <div
        key={`${thread.id}-${thread.url}`}
        className="group flex items-start justify-between gap-2 rounded-md border border-border/60 bg-[#111416] px-3 py-2 transition-colors hover:border-border hover:bg-[#171B1D]"
      >
        <button
          type="button"
          onClick={() => void openThread({ tid: /^\d+$/.test(thread.id) ? thread.id : undefined, url: thread.url })}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {thread.sticky ? (
              <span className="rounded border border-border/80 bg-[#171B1D] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                Sticky
              </span>
            ) : null}
            <span className="line-clamp-2 text-xs font-medium text-foreground group-hover:text-foreground">
              {thread.title}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
            {thread.author ? <span>by {thread.author}</span> : null}
            {thread.replies ? <span>· {thread.replies} replies</span> : null}
            {thread.views ? <span>· {thread.views} views</span> : null}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void toggleBookmark({ id: thread.id, title: thread.title, url: thread.url, forum: activeForum?.title ?? null })}
            title={saved ? 'Remove bookmark' : 'Bookmark thread'}
            className={cn(
              'rounded px-1.5 py-1 text-[11px] transition-colors',
              saved ? 'bg-[#171B1D] text-foreground' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
            )}
          >
            <Icon name="book-marked" className="size-3.5" />
          </button>
        </div>
      </div>
    );
  };

  const renderBlock = (block: UcPostBlock, idx: number, post: UcPost, threadTitle: string) => {
    if (block.type === 'code') {
      return (
        <UcCodeBlock
          key={`${post.id}-code-${idx}`}
          language={block.language}
          code={block.code}
          threadTitle={threadTitle}
          author={post.author}
          onAnalyze={sendToSpleenAi}
        />
      );
    }
    if (codeOnly) return null;
    if (block.type === 'quote') {
      return (
        <blockquote
          key={`${post.id}-quote-${idx}`}
          className="my-1.5 rounded-r border-l-2 border-border bg-[#0B0D0F] px-3 py-1.5 text-[11px] text-muted-foreground"
        >
          {block.author ? <div className="mb-0.5 font-mono text-[10px] text-foreground/80">{block.author} wrote:</div> : null}
          <div className="whitespace-pre-wrap">{block.text}</div>
        </blockquote>
      );
    }
    if (block.type === 'spoiler') {
      return <UcSpoilerBlock key={`${post.id}-spoiler-${idx}`} title={block.title} text={block.text} />;
    }
    if (block.type === 'image') {
      return (
        <div key={`${post.id}-img-${idx}`} className="my-2">
          <button
            type="button"
            onClick={() => setLightboxSrc(block.src)}
            className="overflow-hidden rounded border border-border/70 bg-[#08090A] hover:border-foreground/40"
          >
            <img src={block.src} alt="" loading="lazy" className="max-h-64 max-w-full object-contain" />
          </button>
        </div>
      );
    }
    return (
      <p key={`${post.id}-txt-${idx}`} className="my-1.5 text-xs leading-relaxed whitespace-pre-wrap text-foreground/90 select-text">
        {block.text}
      </p>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#08090A] text-foreground">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-[#0B0D0F] px-3 py-2">
        <div className="flex items-center gap-1">
          {(
            [
              { id: 'home', label: t('uc.nav.home') },
              ...(activeForum ? [{ id: 'forum' as const, label: activeForum.title.slice(0, 18) }] : []),
              ...(activeThread ? [{ id: 'thread' as const, label: activeThread.title.slice(0, 18) }] : []),
              { id: 'search', label: t('uc.nav.search') },
              { id: 'bookmarks', label: `${t('uc.nav.bookmarks')} (${bookmarks.length})` },
              { id: 'history', label: t('uc.nav.history') },
              { id: 'session', label: t('uc.nav.session') },
            ] as Array<{ id: UcTab; label: string }>
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                tab === item.id
                  ? 'bg-[#E5E8E3] text-[#08090A]'
                  : 'text-muted-foreground hover:bg-[#171B1D] hover:text-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTab('session')}
            title="UnknownCheats Session & Verification"
            className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-[#111416] px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-border hover:text-foreground"
          >
            <span
              className={cn(
                'inline-block size-1.5 rounded-full',
                status?.hasCookies ? 'bg-[#C8FA62]' : 'bg-muted-foreground/50',
              )}
            />
            {status?.hasCookies ? 'VERIFIED' : 'GUEST'}
          </button>
          <button
            type="button"
            onClick={retryActiveView}
            disabled={loading}
            title="Refresh"
            className="rounded-md border border-border/70 bg-[#111416] p-1 text-muted-foreground hover:border-border hover:text-foreground disabled:opacity-40"
          >
            <Icon name="refresh" className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Search Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch(searchQuery, 1);
        }}
        className="flex items-center gap-1.5 border-b border-border/60 bg-[#0B0D0F] px-3 py-1.5"
      >
        <Icon name="search" className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('uc.search.placeholder')}
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {searchQuery.trim() ? (
          <Button type="submit" size="sm" variant="secondary" className="h-6 px-2 text-[11px]">
            {t('uc.nav.search')}
          </Button>
        ) : null}
      </form>

      {/* Main Content Area */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {gate ? (
          <div className="mx-auto my-4 max-w-lg rounded-lg border border-border bg-[#111416] p-4">
            <div className="flex items-center gap-2">
              <span className="inline-block size-2 rounded-full bg-[#C8FA62]" />
              <h3 className="text-sm font-semibold text-foreground">{t('uc.gate.title')}</h3>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {gate.info.message || t('uc.gate.subtitle')}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => void handleOpenVerificationWindow(gate.url)}
              >
                {t('uc.action.openVerification')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={syncingCookies}
                onClick={() => void handleSyncVerificationCookies()}
              >
                {syncingCookies ? 'Syncing…' : t('uc.action.syncVerification')}
              </Button>
            </div>
            <div className="mt-4 border-t border-border/60 pt-3">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Or paste Cookie header manually (cf_clearance / bb_sessionhash)
              </div>
              <div className="flex gap-1.5">
                <input
                  value={cookieInput}
                  onChange={(e) => setCookieInput(e.target.value)}
                  placeholder="cf_clearance=...; bb_userid=...; bb_password=..."
                  className="min-w-0 flex-1 rounded-md border border-border bg-[#08090A] px-2.5 py-1 font-mono text-[11px] text-foreground focus:border-foreground focus:outline-none"
                />
                <Button type="button" size="sm" variant="secondary" onClick={() => void handleSaveManualCookies()}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mb-3 rounded-md border border-border bg-[#111416] p-3 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">Request error</div>
            <div className="mt-0.5">{error}</div>
            <div className="mt-2 flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={retryActiveView}>
                Retry
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => void handleOpenVerificationWindow()}>
                {t('uc.action.openVerification')}
              </Button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="py-12 text-center font-mono text-xs text-muted-foreground">Loading UnknownCheats…</div>
        ) : null}

        {/* HOME VIEW */}
        {!loading && !gate && tab === 'home' ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Subforums ({filteredForums.length})
              </span>
              <input
                value={forumFilter}
                onChange={(e) => setForumFilter(e.target.value)}
                placeholder="Filter subforums…"
                className="w-48 rounded border border-border/70 bg-[#111416] px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {filteredForums.map((f) => (
                <button
                  key={`${f.id}-${f.url}`}
                  type="button"
                  onClick={() =>
                    void openForum({
                      fid: /^\d+$/.test(f.id) ? f.id : undefined,
                      url: f.url,
                      title: f.title,
                    })
                  }
                  className="flex items-center justify-between rounded-md border border-border/60 bg-[#111416] px-3 py-2 text-left transition-colors hover:border-border hover:bg-[#171B1D]"
                >
                  <span className="truncate text-xs font-medium text-foreground">{f.title}</span>
                  <span className="ml-2 shrink-0 font-mono text-[10px] text-muted-foreground">#{f.id}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* FORUM LISTING VIEW */}
        {!loading && !gate && tab === 'forum' && activeForum ? (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
              <div>
                <h2 className="text-sm font-semibold text-foreground">{activeForum.title}</h2>
                <div className="font-mono text-[10px] text-muted-foreground">
                  Page {activeForum.page} of {activeForum.totalPages} · {activeForum.threads.length} threads
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={activeForum.page <= 1}
                  onClick={() =>
                    void openForum({
                      fid: activeForum.id,
                      url: activeForum.url,
                      title: activeForum.title,
                      page: activeForum.page - 1,
                    })
                  }
                  className="h-6 px-2 text-[11px]"
                >
                  Prev
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={activeForum.page >= activeForum.totalPages}
                  onClick={() =>
                    void openForum({
                      fid: activeForum.id,
                      url: activeForum.url,
                      title: activeForum.title,
                      page: activeForum.page + 1,
                    })
                  }
                  className="h-6 px-2 text-[11px]"
                >
                  Next
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">{activeForum.threads.map(renderThreadRow)}</div>
          </div>
        ) : null}

        {/* THREAD READER VIEW */}
        {!loading && !gate && tab === 'thread' && activeThread ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border/80 bg-[#111416] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold leading-snug text-foreground">{activeThread.title}</h2>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                    Page {activeThread.page} of {activeThread.totalPages} · {activeThread.posts.length} posts
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCodeOnly((v) => !v)}
                    className={cn(
                      'rounded-md border px-2 py-1 font-mono text-[10px] transition-colors',
                      codeOnly
                        ? 'border-foreground bg-[#E5E8E3] text-[#08090A]'
                        : 'border-border/80 bg-[#171B1D] text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t('uc.action.codeOnly')}
                  </button>
                  <button
                    type="button"
                    onClick={handleSendFullThreadToAi}
                    className="rounded-md border border-border/80 bg-[#E5E8E3] px-2.5 py-1 text-[11px] font-medium text-[#08090A] hover:opacity-90"
                  >
                    {t('uc.action.sendThreadToAi')}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void toggleBookmark({
                        id: activeThread.id,
                        title: activeThread.title,
                        url: activeThread.url,
                        forum: activeForum?.title ?? null,
                      })
                    }
                    className="rounded-md border border-border/80 bg-[#171B1D] px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {isBookmarked(activeThread.id) || isBookmarked(activeThread.url) ? 'Saved' : 'Bookmark'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void openDesktopBrowserWindow(activeThread.url, activeThread.title)}
                    title="Open in Native Window"
                    className="rounded-md border border-border/80 bg-[#171B1D] px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Popout
                  </button>
                </div>
              </div>

              {activeThread.totalPages > 1 ? (
                <div className="mt-2.5 flex items-center gap-1.5 border-t border-border/60 pt-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={activeThread.page <= 1}
                    onClick={() => void openThread({ tid: activeThread.id, url: activeThread.url, page: activeThread.page - 1 })}
                    className="h-6 px-2 text-[11px]"
                  >
                    Prev Page
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={activeThread.page >= activeThread.totalPages}
                    onClick={() => void openThread({ tid: activeThread.id, url: activeThread.url, page: activeThread.page + 1 })}
                    className="h-6 px-2 text-[11px]"
                  >
                    Next Page
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="space-y-2.5">
              {activeThread.posts
                .filter((post) => !codeOnly || post.codeCount > 0)
                .map((post) => (
                  <article
                    key={post.id}
                    className="rounded-lg border border-border/70 bg-[#111416] p-3"
                  >
                    <header className="mb-2 flex items-center justify-between border-b border-border/50 pb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">{post.author}</span>
                        {post.timestamp ? (
                          <span className="font-mono text-[10px] text-muted-foreground">{post.timestamp}</span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            sendToSpleenAi(
                              `From UnknownCheats "${activeThread.title}" (post #${post.number} by ${post.author}):\n\n${post.rawText}`,
                            )
                          }
                          className="rounded border border-border/70 bg-[#171B1D] px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          Ask AI
                        </button>
                        <span className="font-mono text-[10px] text-muted-foreground">#{post.number}</span>
                      </div>
                    </header>
                    <div>{post.blocks.map((b, i) => renderBlock(b, i, post, activeThread.title))}</div>
                  </article>
                ))}
            </div>
          </div>
        ) : null}

        {/* SEARCH VIEW */}
        {!loading && !gate && tab === 'search' ? (
          <div className="space-y-2.5">
            {searchState ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Results for "{searchState.query}" ({searchState.results.length})
                  </span>
                </div>
                <div className="space-y-1.5">{searchState.results.map(renderThreadRow)}</div>
              </>
            ) : (
              <div className="py-10 text-center text-xs text-muted-foreground">
                Enter a query above to search UnknownCheats threads and code releases.
              </div>
            )}
          </div>
        ) : null}

        {/* BOOKMARKS VIEW */}
        {tab === 'bookmarks' ? (
          <div className="space-y-1.5">
            {bookmarks.length === 0 ? (
              <div className="py-10 text-center text-xs text-muted-foreground">No saved UnknownCheats bookmarks yet.</div>
            ) : (
              bookmarks.map((bm) => (
                <div
                  key={bm.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-[#111416] px-3 py-2"
                >
                  <button
                    type="button"
                    onClick={() => void openThread({ tid: /^\d+$/.test(bm.id) ? bm.id : undefined, url: bm.url })}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-xs font-medium text-foreground">{bm.title}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{bm.forum || bm.url}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleBookmark(bm)}
                    className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-[#171B1D] hover:text-foreground"
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        ) : null}

        {/* HISTORY VIEW */}
        {tab === 'history' ? (
          <div className="space-y-2">
            {history.length > 0 ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => void unknownCheatsApi.clearHistory().then(setHistory)}
                >
                  Clear History
                </Button>
              </div>
            ) : null}
            {history.length === 0 ? (
              <div className="py-10 text-center text-xs text-muted-foreground">No recently viewed threads.</div>
            ) : (
              history.map((h) => (
                <button
                  key={`${h.id}-${h.visitedAt}`}
                  type="button"
                  onClick={() => void openThread({ tid: /^\d+$/.test(h.id) ? h.id : undefined, url: h.url })}
                  className="flex w-full items-center justify-between rounded-md border border-border/60 bg-[#111416] px-3 py-2 text-left hover:bg-[#171B1D]"
                >
                  <span className="truncate text-xs font-medium text-foreground">{h.title}</span>
                  <span className="ml-2 shrink-0 font-mono text-[10px] text-muted-foreground">#{h.id}</span>
                </button>
              ))
            )}
          </div>
        ) : null}

        {/* SESSION & VERIFICATION VIEW */}
        {tab === 'session' ? (
          <div className="mx-auto max-w-lg space-y-3 rounded-lg border border-border bg-[#111416] p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'inline-block size-2 rounded-full',
                    status?.hasCookies ? 'bg-[#C8FA62]' : 'bg-muted-foreground/50',
                  )}
                />
                <h3 className="text-sm font-semibold text-foreground">UnknownCheats Session Bridge</h3>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">
                {status?.hasCookies ? 'COOKIES ACTIVE' : 'NO COOKIES'}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('uc.gate.subtitle')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => void handleOpenVerificationWindow()}>
                {t('uc.action.openVerification')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={syncingCookies}
                onClick={() => void handleSyncVerificationCookies()}
              >
                {syncingCookies ? 'Syncing…' : t('uc.action.syncVerification')}
              </Button>
              {status?.hasCookies ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => void handleClearCookies()}>
                  Clear Session
                </Button>
              ) : null}
            </div>
            <div className="border-t border-border/60 pt-3">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Manual Cookie Header Override
              </div>
              <div className="flex gap-1.5">
                <input
                  value={cookieInput}
                  onChange={(e) => setCookieInput(e.target.value)}
                  placeholder="cf_clearance=...; bb_userid=...; bb_password=..."
                  className="min-w-0 flex-1 rounded-md border border-border bg-[#08090A] px-2.5 py-1 font-mono text-[11px] text-foreground focus:border-foreground focus:outline-none"
                />
                <Button type="button" size="sm" variant="secondary" onClick={() => void handleSaveManualCookies()}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Image Lightbox */}
      {lightboxSrc ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
          onClick={() => setLightboxSrc(null)}
        >
          <img src={lightboxSrc} alt="" className="max-h-full max-w-full rounded border border-border object-contain" />
        </div>
      ) : null}
    </div>
  );
};
