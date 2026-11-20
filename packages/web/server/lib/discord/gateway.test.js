import { describe, expect, it } from 'vitest';
import { createDiscordGateway } from './gateway.js';
import { createDiscordStore } from './store.js';

describe('discord gateway', () => {
  it('identifies on Hello, fans out live events to SSE listeners, and tears down cleanly when unsubscribed', async () => {
    const store = createDiscordStore();
    await store.saveConfig({ token: 'tok-1234', tokenType: 'user' });

    const instances = [];
    class FakeWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 1;
        this.sent = [];
        this.listeners = new Map();
        instances.push(this);
      }
      addEventListener(type, fn) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
      }
      send(raw) {
        this.sent.push(JSON.parse(raw));
      }
      close() {
        this.readyState = 3;
        for (const fn of this.listeners.get('close') ?? []) fn({});
      }
      emitMessage(packet) {
        for (const fn of this.listeners.get('message') ?? []) fn({ data: JSON.stringify(packet) });
      }
    }

    const gateway = createDiscordGateway({ store, WebSocketImpl: FakeWebSocket, idleGraceMs: 5 });
    const received = [];
    const unsubscribe = gateway.subscribe((evt) => received.push(evt));

    await new Promise((r) => setTimeout(r, 15));
    expect(instances).toHaveLength(1);
    const sock = instances[0];
    sock.emitMessage({ op: 10, d: { heartbeat_interval: 45_000 } });
    expect(sock.sent[0].op).toBe(2);

    sock.emitMessage({ op: 0, s: 1, t: 'READY', d: { session_id: 'gw1', user: { id: '1', username: 'me' } } });
    sock.emitMessage({ op: 0, s: 2, t: 'MESSAGE_CREATE', d: { id: 'm99', channel_id: 'c1', content: 'live hello', author: { id: '2', username: 'bob' } } });

    expect(gateway.isConnected()).toBe(true);
    expect(received.some((e) => e.type === 'message:create' && e.data.content === 'live hello')).toBe(true);

    unsubscribe();
    await new Promise((r) => setTimeout(r, 30));
    expect(gateway.isConnected()).toBe(false);
  });
});
