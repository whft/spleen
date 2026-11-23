import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const runtime = readFileSync(new URL('../src-tauri/src/window.rs', import.meta.url), 'utf8');
const script = runtime.slice(runtime.indexOf('r#"') + 3, runtime.indexOf('"#'))
  .replace('{b}', '{}').replaceAll('{{', '{').replaceAll('}}', '}');

test('loopback titlebar actions use the current Tauri window rather than custom IPC', async () => {
  const calls = [];
  let maximized = false;
  const current = {
    isVisible: async () => true,
    isMaximized: async () => maximized,
    isFullscreen: async () => false,
    isFocused: async () => true,
    minimize: async () => calls.push('minimize'),
    close: async () => calls.push('close'),
    startDragging: async () => calls.push('drag'),
    toggleMaximize: async () => { maximized = !maximized; },
    listen: async (name) => { calls.push(name); },
  };
  const window = {
    __TAURI__: {
      core: { invoke: async () => { throw new Error('custom IPC denied from loopback'); } },
      window: { getCurrentWindow: () => current },
    },
  };
  runInNewContext(script, { window, document: { readyState: 'complete' } });
  const { invoke } = window.__SPLEEN_DESKTOP__;
  assert.equal((await invoke('desktop_get_current_window_state')).maximized, false);
  assert.equal((await invoke('desktop_toggle_current_window_maximized')).maximized, true);
  assert.equal((await invoke('desktop_toggle_current_window_maximized')).maximized, false);
  await invoke('desktop_minimize_current_window');
  await invoke('desktop_start_window_drag');
  await invoke('desktop_close_current_window');
  assert.deepEqual(calls, ['spleen:window-maximized-changed', 'minimize', 'drag', 'close']);
  await assert.rejects(invoke('desktop_get_app_version'), /custom IPC denied/);
});
