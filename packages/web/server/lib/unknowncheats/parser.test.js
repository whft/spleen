import { describe, expect, it } from 'vitest';
import {
  detectCodeLanguage,
  detectGate,
  parseForumListing,
  parseHome,
  parseSearchResults,
  parseThread,
} from './parser.js';

describe('unknowncheats parser', () => {
  it('detects Cloudflare challenge and login gates accurately', () => {
    expect(detectGate({
      status: 403,
      headers: { 'cf-mitigated': 'challenge' },
      html: '<html><title>Just a moment...</title></html>',
    })).toMatchObject({ gated: true, reason: 'cloudflare' });

    expect(detectGate({
      status: 200,
      html: '<div class="vbulletin_message">You are not logged in or you do not have permission. Log in + password</div>',
    })).toMatchObject({ gated: true, reason: 'login' });

    expect(detectGate({
      status: 200,
      html: '<html><title>UnknownCheats Forum</title><body><a href="forumdisplay.php?f=10">Anti-Cheat Bypass</a></body></html>',
    })).toEqual({ gated: false });
  });

  it('parses home categories and forum thread listings with pagination', () => {
    const homeHtml = `
      <html><head><title>UnknownCheats - Multiplayer Game Hacking and Cheats</title></head>
      <body>
        <a href="forumdisplay.php?f=142">Anti-Cheat Bypass</a>
        <a href="forumdisplay.php?f=304">C and C++</a>
        <a href="index.php">Home</a>
      </body></html>
    `;
    const home = parseHome(homeHtml);
    expect(home.title).toContain('UnknownCheats');
    expect(home.forums).toEqual([
      { id: '142', title: 'Anti-Cheat Bypass', url: 'https://www.unknowncheats.me/forum/forumdisplay.php?f=142' },
      { id: '304', title: 'C and C++', url: 'https://www.unknowncheats.me/forum/forumdisplay.php?f=304' },
    ]);

    const listingHtml = `
      <html><head><title>Anti-Cheat Bypass - Page 2 of 5</title></head>
      <body>
        <table>
          <tr>
            <td>Sticky: <a id="thread_title_123456" href="showthread.php?t=123456">Driver Entry Notes</a> Started by <a href="member.php?u=42">Researcher</a> Replies: 12 Views: 1,420</td>
          </tr>
        </table>
      </body></html>
    `;
    const listing = parseForumListing(listingHtml, 'https://www.unknowncheats.me/forum/forumdisplay.php?f=142&page=2');
    expect(listing.page).toBe(2);
    expect(listing.totalPages).toBe(5);
    expect(listing.threads).toHaveLength(1);
    expect(listing.threads[0]).toMatchObject({
      id: '123456',
      title: 'Driver Entry Notes',
      sticky: true,
      author: 'Researcher',
      replies: '12',
      views: '1,420',
    });

    const search = parseSearchResults(listingHtml);
    expect(search.results).toHaveLength(1);
  });

  it('parses thread posts, quotes, spoilers, and detects code languages', () => {
    const html = `
      <html><head><title>Kernel Pattern Scanner</title></head>
      <body>
        <div id="post999">
          <td class="thead"><a id="postcount999"><strong>1</strong></a> Yesterday, 10:15 AM</td>
          <a class="bigusername" href="member.php?u=7">Analyst</a>
          <div id="post_message_999">
            <blockquote>Earlier message</blockquote>
            <div class="spoiler">Hidden offset info</div>
            Here is a clean C++ snippet:
            <div class="bbcode_container"><pre>#include &lt;cstdint&gt;\nuintptr_t scan() { return 0; }</pre></div>
          </div><!-- / message -->
        </div>
      </body></html>
    `;
    const thread = parseThread(html, 'https://www.unknowncheats.me/forum/showthread.php?t=777');
    expect(thread.id).toBe('777');
    expect(thread.title).toBe('Kernel Pattern Scanner');
    expect(thread.posts).toHaveLength(1);
    const post = thread.posts[0];
    expect(post.author).toBe('Analyst');
    expect(post.number).toBe(1);
    expect(post.codeCount).toBe(1);
    expect(post.blocks.some((b) => b.type === 'quote' && b.text === 'Earlier message')).toBe(true);
    expect(post.blocks.some((b) => b.type === 'spoiler' && b.text === 'Hidden offset info')).toBe(true);
    const codeBlock = post.blocks.find((b) => b.type === 'code');
    expect(codeBlock?.language).toBe('cpp');
    expect(codeBlock?.code).toContain('#include <cstdint>');
    expect(detectCodeLanguage('fn main() { let mut x = 1; }')).toBe('rust');
  });
});
