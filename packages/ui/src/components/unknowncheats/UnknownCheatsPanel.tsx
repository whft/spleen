import React from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { ContextPanelHeaderToolbar } from '@/components/layout/contextPanelHeaderSlot';
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

type UcTab = 'home' | 'recent' | 'forum' | 'thread' | 'search' | 'bookmarks' | 'history' | 'session';

const UcSpoilerBlock: React.FC<{ title: string; text: string }> = ({ title, text }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="my-1.5 rounded-md border border-border/70 bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2.5 py-1.5 text-start text-[11px] font-medium text-muted-foreground hover:text-foreground"
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
    <div className="my-2 overflow-hidden rounded-xl border border-edge-muted bg-sidebar">
      <div className="flex items-center justify-between border-b border-edge-muted bg-surface-elevated px-2.5 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {language || 'code'} · {code.split('\n').length} lines
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-interactive-hover hover:text-foreground"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={handleSendToAi}
            className="rounded-md border border-edge-muted bg-surface-subtle px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-interactive-hover"
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

  const [recentState, setRecentState] = React.useState<{
    page: number;
    totalPages: number;
    threads: UcThreadSummary[];
  } | null>(null);

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

  // Login & cookie sync state
  const [loginUsername, setLoginUsername] = React.useState('');
  const [loginPassword, setLoginPassword] = React.useState('');
  const [loggingIn, setLoggingIn] = React.useState(false);
  const [cookieInput, setCookieInput] = React.useState('');
  const [syncingCookies, setSyncingCookies] = React.useState(false);
  const [autoWatchingWindow, setAutoWatchingWindow] = React.useState(false);
  const lastSyncedCookieRef = React.useRef('');

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
        if (res.currentUser?.username) void refreshStatusAndLists();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [refreshStatusAndLists]);

  const loadRecent = React.useCallback(async (page = 1) => {
    setTab('recent');
    setLoading(true);
    setError(null);
    setGate(null);
    try {
      const res = await unknownCheatsApi.recent(page);
      if (res.gated) {
        setGate({ info: res.gate, url: res.url || res.gate.targetUrl });
      } else {
        setRecentState({ page: res.page, totalPages: res.totalPages, threads: res.threads });
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
    if (tab === 'recent') {
      void loadRecent(recentState?.page ?? 1);
      return;
    }
    if (tab === 'search' && searchQuery.trim()) {
      void runSearch(searchQuery.trim(), searchState?.page ?? 1);
      return;
    }
    void loadHome();
  }, [activeForum, activeThread, loadHome, loadRecent, openForum, openThread, recentState?.page, runSearch, searchQuery, searchState?.page, tab]);

  React.useEffect(() => {
    if (!visible) return;
    void refreshStatusAndLists();
    if (forums.length === 0 && !loading && !gate) {
      void loadHome();
    }
  }, [forums.length, gate, loadHome, loading, refreshStatusAndLists, visible]);

  // Automatic background sync while the visible Tauri verification/login window is open
  React.useEffect(() => {
    if (!autoWatchingWindow || !visible) return;
    let cancelled = false;
    let attempts = 0;
    const poll = async () => {
      if (cancelled) return;
      attempts += 1;
      if (attempts > 48) {
        setAutoWatchingWindow(false);
        return;
      }
      const res = await readUcVerificationCookies();
      if (cancelled) return;
      if (!res.ok) {
        if (res.error === 'verification_window_not_open') setAutoWatchingWindow(false);
        return;
      }
      const header = res.cookieHeader.trim();
      const hasAuthOrClearance = /\b(cf_clearance|bb_userid|bb_password|bb_sessionhash)=/i.test(header);
      if (hasAuthOrClearance && header !== lastSyncedCookieRef.current) {
        lastSyncedCookieRef.current = header;
        try {
          const nextStatus = await unknownCheatsApi.setCookies(header);
          setStatus(nextStatus);
          setGate(null);
          if (/\bbb_userid=|\bbb_password=/i.test(header) || !gate) {
            setAutoWatchingWindow(false);
          }
          toast.success(`Synced ${res.count} UnknownCheats cookies automatically`);
          retryActiveView();
        } catch {
          // ignore transient save errors while polling
        }
      }
    };
    const timer = window.setInterval(() => void poll(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [autoWatchingWindow, gate, retryActiveView, visible]);

  const handleOpenVerificationWindow = async (targetUrl?: string) => {
    const dest = targetUrl || gate?.url || 'https://www.unknowncheats.me/forum/login.php';
    const opened = await openUcVerificationWindow(dest);
    if (opened) {
      setAutoWatchingWindow(true);
      toast.info('Sign in or complete verification in the UnknownCheats window — Spleen will auto-sync your session.');
    } else {
      void openDesktopBrowserWindow(dest, 'UnknownCheats Login');
    }
  };

  const handleDirectLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUsername.trim() || !loginPassword) return;
    setLoggingIn(true);
    setError(null);
    try {
      const res = await unknownCheatsApi.login(loginUsername.trim(), loginPassword);
      if (res.gated) {
        setGate({ info: res.gate, url: res.url || 'https://www.unknowncheats.me/forum/login.php' });
        toast.info('Cloudflare verification is required — opening Spleen’s interactive Login Window.');
        void handleOpenVerificationWindow(res.url || 'https://www.unknowncheats.me/forum/login.php');
        return;
      }
      setStatus(res.status);
      setLoginPassword('');
      setGate(null);
      toast.success(`Signed in to UnknownCheats as ${res.username}`);
      if (tab === 'session') setTab('home');
      retryActiveView();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleSyncVerificationCookies = async () => {
    setSyncingCookies(true);
    try {
      const res = await readUcVerificationCookies();
      if (!res.ok || !res.cookieHeader.trim()) {
        toast.error(
          res.error === 'verification_window_not_open'
            ? 'Open the Login / Verification Window first, sign in or verify, then click Sync.'
            : 'No verification cookies available yet — complete verification in the window or paste Cookie header below.',
        );
        return;
      }
      lastSyncedCookieRef.current = res.cookieHeader.trim();
      const nextStatus = await unknownCheatsApi.setCookies(res.cookieHeader);
      setStatus(nextStatus);
      setGate(null);
      setAutoWatchingWindow(false);
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
      lastSyncedCookieRef.current = '';
      setStatus(nextStatus);
      toast.success('Signed out & cleared UnknownCheats session');
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

  const renderLoginBox = (compact = false) => (
    <div className="space-y-3">
      <form onSubmit={(e) => void handleDirectLogin(e)} className="space-y-2.5">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          UnknownCheats Account Login
        </div>
        <div className={cn('grid gap-2', compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2')}>
          <input
            value={loginUsername}
            onChange={(e) => setLoginUsername(e.target.value)}
            placeholder="UC Username"
            autoComplete="username"
            className="oc-raised oc-field rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
          />
          <input
            type="password"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            className="oc-raised oc-field rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Button
            type="submit"
            size="sm"
            disabled={loggingIn || !loginUsername.trim() || !loginPassword}
            className="rounded-full px-4"
          >
            {loggingIn ? 'Signing in…' : 'Sign In'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() => void handleOpenVerificationWindow(gate?.url || 'https://www.unknowncheats.me/forum/login.php')}
          >
            Interactive Browser Login
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={syncingCookies}
            onClick={() => void handleSyncVerificationCookies()}
          >
            {syncingCookies ? 'Syncing…' : autoWatchingWindow ? 'Auto-Syncing… (Sync Now)' : t('uc.action.syncVerification')}
          </Button>
        </div>
      </form>
    </div>
  );

  const renderThreadRow = (thread: UcThreadSummary) => {
    const saved = isBookmarked(thread.id) || isBookmarked(thread.url);
    return (
      <div
        key={`${thread.id}-${thread.url}`}
        className="group flex items-start justify-between gap-2 rounded-xl border border-edge-muted bg-surface-elevated px-3 py-2.5 transition-colors hover:border-border hover:bg-interactive-hover"
      >
        <button
          type="button"
          onClick={() => void openThread({ tid: /^\d+$/.test(thread.id) ? thread.id : undefined, url: thread.url })}
          className="min-w-0 flex-1 text-start"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {thread.sticky ? (
              <span className="rounded-full border border-edge-muted bg-surface-subtle px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                Sticky
              </span>
            ) : null}
            {thread.prefix ? (
              <span className="rounded-full border border-edge-muted bg-sidebar px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-foreground/85">
                {thread.prefix}
              </span>
            ) : null}
            <span className="line-clamp-2 text-xs font-medium text-foreground">
              {thread.title}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground tabular-nums">
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
              'rounded-lg px-1.5 py-1 text-[11px] transition-colors',
              saved ? 'bg-interactive-selection text-foreground' : 'text-muted-foreground hover:bg-interactive-hover hover:text-foreground',
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
          className="my-1.5 rounded-e-lg border-s-2 border-border bg-sidebar px-3 py-1.5 text-[11px] text-muted-foreground"
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
            className="overflow-hidden rounded-xl border border-edge-muted bg-sidebar hover:border-foreground/40"
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

  const sessionBadgeLabel = status?.username
    ? `@${status.username}`
    : status?.loggedIn
      ? 'SIGNED IN'
      : status?.hasCookies
        ? 'VERIFIED'
        : 'SIGN IN';

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <ContextPanelHeaderToolbar>
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2 px-1">
          <div className="flex min-w-0 items-center gap-2">
            <Icon name="unknowncheats" className="size-4 shrink-0 text-foreground" />
            <span className="truncate typography-ui-label font-medium text-foreground">UnknownCheats</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTab('session')}
              title="UnknownCheats Account & Verification"
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-edge-muted bg-surface-elevated px-2.5 font-mono text-[10px] text-foreground/90 transition-colors hover:border-border hover:bg-interactive-hover"
            >
              <span
                className={cn(
                  'inline-block size-1.5 rounded-full',
                  status?.loggedIn || status?.hasCookies ? 'bg-[var(--status-success)]' : 'bg-muted-foreground/50',
                )}
              />
              {sessionBadgeLabel}
            </button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-full"
              onClick={retryActiveView}
              disabled={loading}
              title="Refresh"
            >
              <Icon name="refresh" className="size-3.5" />
            </Button>
          </div>
        </div>
      </ContextPanelHeaderToolbar>

      {/* Studio Navigation & Quick Search */}
      <div className="oc-workspace-toolbar flex shrink-0 flex-col gap-2 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              { id: 'home', label: t('uc.nav.home') },
              { id: 'recent', label: 'Recent' },
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
              onClick={() => {
                if (item.id === 'recent' && !recentState) {
                  void loadRecent(1);
                } else {
                  setTab(item.id);
                }
              }}
              className={cn(
                'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                tab === item.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-interactive-hover hover:text-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch(searchQuery, 1);
          }}
          className="oc-raised oc-field flex h-8 w-full items-center gap-2 rounded-full px-3"
        >
          <Icon name="search" className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('uc.search.placeholder')}
            className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {searchQuery.trim() ? (
            <button
              type="submit"
              className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground"
            >
              Go
            </button>
          ) : null}
        </form>
      </div>

      {/* Main Content Area */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        {gate && tab !== 'session' ? (
          <div className="mx-auto my-4 max-w-lg space-y-3.5 rounded-2xl border border-edge-muted bg-surface-elevated p-5 shadow-xs">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-edge-muted bg-surface-subtle">
                <Icon name="unknowncheats" className="size-4 shrink-0 text-foreground" />
              </div>
              <h3 className="text-sm font-semibold tracking-tight text-foreground">{t('uc.gate.title')}</h3>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {gate.info.message || t('uc.gate.subtitle')}
            </p>
            {renderLoginBox(true)}
            <div className="border-t border-edge-muted pt-3.5">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Or paste Cookie header manually (cf_clearance / bb_userid / bb_sessionhash)
              </div>
              <div className="flex gap-1.5">
                <input
                  value={cookieInput}
                  onChange={(e) => setCookieInput(e.target.value)}
                  placeholder="cf_clearance=...; bb_userid=...; bb_password=..."
                  className="oc-raised oc-field min-w-0 flex-1 rounded-xl px-2.5 py-1.5 font-mono text-[11px] text-foreground focus:border-foreground focus:outline-none"
                />
                <Button type="button" size="sm" variant="secondary" className="rounded-full px-3" onClick={() => void handleSaveManualCookies()}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mb-3 rounded-xl border border-edge-muted bg-surface-elevated p-3.5 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">Request error</div>
            <div className="mt-0.5">{error}</div>
            <div className="mt-2.5 flex gap-2">
              <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={retryActiveView}>
                Retry
              </Button>
              <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={() => void handleOpenVerificationWindow()}>
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
                className="oc-raised oc-field w-48 rounded-lg px-2.5 py-1 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
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
                  className="flex items-center justify-between rounded-xl border border-edge-muted bg-surface-elevated px-3 py-2 text-start transition-colors hover:border-border hover:bg-interactive-hover"
                >
                  <span className="truncate text-xs font-medium text-foreground">{f.title}</span>
                  <span className="ms-2 shrink-0 font-mono text-[10px] text-muted-foreground">#{f.id}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* RECENT POSTS VIEW */}
        {!loading && !gate && tab === 'recent' ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Today’s Active Threads ({recentState?.threads.length ?? 0})
              </span>
              {recentState ? (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={recentState.page <= 1}
                    onClick={() => void loadRecent(recentState.page - 1)}
                    className="h-6 px-2 text-[11px]"
                  >
                    Prev
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={recentState.page >= recentState.totalPages}
                    onClick={() => void loadRecent(recentState.page + 1)}
                    className="h-6 px-2 text-[11px]"
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </div>
            <div className="space-y-1.5">{(recentState?.threads ?? []).map(renderThreadRow)}</div>
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
            <div className="rounded-2xl border border-edge-muted bg-surface-elevated p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold leading-snug text-foreground">{activeThread.title}</h2>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground tabular-nums">
                    Page {activeThread.page} of {activeThread.totalPages} · {activeThread.posts.length} posts
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCodeOnly((v) => !v)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 font-mono text-[10px] transition-colors',
                      codeOnly
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-edge-muted bg-surface-subtle text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t('uc.action.codeOnly')}
                  </button>
                  <button
                    type="button"
                    onClick={handleSendFullThreadToAi}
                    className="rounded-full bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90"
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
                    className="rounded-full border border-edge-muted bg-surface-subtle px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {isBookmarked(activeThread.id) || isBookmarked(activeThread.url) ? 'Saved' : 'Bookmark'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void openDesktopBrowserWindow(activeThread.url, activeThread.title)}
                    title="Open in Native Window"
                    className="rounded-full border border-edge-muted bg-surface-subtle px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Popout
                  </button>
                </div>
              </div>

              {activeThread.totalPages > 1 ? (
                <div className="mt-2.5 flex items-center gap-1.5 border-t border-edge-muted pt-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={activeThread.page <= 1}
                    onClick={() => void openThread({ tid: activeThread.id, url: activeThread.url, page: activeThread.page - 1 })}
                    className="h-6 rounded-full px-2.5 text-[11px]"
                  >
                    Prev Page
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={activeThread.page >= activeThread.totalPages}
                    onClick={() => void openThread({ tid: activeThread.id, url: activeThread.url, page: activeThread.page + 1 })}
                    className="h-6 rounded-full px-2.5 text-[11px]"
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
                    className="rounded-2xl border border-edge-muted bg-surface-elevated p-3.5"
                  >
                    <header className="mb-2 flex items-center justify-between border-b border-edge-muted pb-1.5">
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
                          className="rounded-full border border-edge-muted bg-surface-subtle px-2.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          Ask AI
                        </button>
                        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">#{post.number}</span>
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
                  className="flex items-center justify-between gap-2 rounded-xl border border-edge-muted bg-surface-elevated px-3 py-2"
                >
                  <button
                    type="button"
                    onClick={() => void openThread({ tid: /^\d+$/.test(bm.id) ? bm.id : undefined, url: bm.url })}
                    className="min-w-0 flex-1 text-start"
                  >
                    <div className="truncate text-xs font-medium text-foreground">{bm.title}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{bm.forum || bm.url}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleBookmark(bm)}
                    className="rounded-lg px-2 py-1 text-[10px] text-muted-foreground hover:bg-interactive-hover hover:text-foreground"
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
                  className="h-6 rounded-full px-2.5 text-[11px]"
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
                  className="flex w-full items-center justify-between rounded-xl border border-edge-muted bg-surface-elevated px-3 py-2 text-start hover:bg-interactive-hover"
                >
                  <span className="truncate text-xs font-medium text-foreground">{h.title}</span>
                  <span className="ms-2 shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">#{h.id}</span>
                </button>
              ))
            )}
          </div>
        ) : null}

        {/* SESSION & ACCOUNT LOGIN VIEW */}
        {tab === 'session' ? (
          <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-edge-muted bg-surface-elevated p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-edge-muted bg-surface-subtle">
                  <Icon name="unknowncheats" className="size-4 shrink-0 text-foreground" />
                </div>
                <h3 className="text-sm font-semibold tracking-tight text-foreground">UnknownCheats Account & Session</h3>
              </div>
              <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                <span
                  className={cn(
                    'inline-block size-1.5 rounded-full',
                    status?.loggedIn || status?.hasCookies ? 'bg-[var(--status-success)]' : 'bg-muted-foreground/50',
                  )}
                />
                {status?.username ? `@${status.username}` : status?.hasCookies ? 'COOKIES ACTIVE' : 'GUEST'}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Sign in with your UnknownCheats account directly, or use Spleen’s interactive browser login window when Cloudflare verification or 2FA is active. Spleen matches your exact browser User-Agent so verified sessions persist cleanly and are available to Spleen AI.
            </p>
            {renderLoginBox(false)}
            {status?.hasCookies ? (
              <div className="flex items-center justify-between rounded-xl border border-edge-muted bg-sidebar px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  {status.username ? `Signed in as ${status.username}` : 'Verified browser session stored'}
                </span>
                <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={() => void handleClearCookies()}>
                  Sign Out
                </Button>
              </div>
            ) : null}
            <div className="border-t border-edge-muted pt-3.5">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Manual Cookie Header Override
              </div>
              <div className="flex gap-1.5">
                <input
                  value={cookieInput}
                  onChange={(e) => setCookieInput(e.target.value)}
                  placeholder="cf_clearance=...; bb_userid=...; bb_password=..."
                  className="oc-raised oc-field min-w-0 flex-1 rounded-xl px-2.5 py-1.5 font-mono text-[11px] text-foreground focus:border-foreground focus:outline-none"
                />
                <Button type="button" size="sm" variant="secondary" className="rounded-full px-3" onClick={() => void handleSaveManualCookies()}>
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
