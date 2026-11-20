import React from 'react';
import { toast } from '@/components/ui';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { syncDesktopSettings } from '@/lib/persistence';
import { subscribeSpleenEvents } from '@/lib/spleenEvents';
import { isContextPanelMode } from '@/lib/surfaces/modes';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useUIStore } from '@/stores/useUIStore';
import { normalizeContextPanelDirectoryKey } from '@/stores/useUIStore';
import { useSessionUIStore } from '@/sync/session-ui-store';

export const useAgentUiControlSync = (): void => {
  const { setTheme } = useThemeSystem();

  React.useEffect(() => {
    return subscribeSpleenEvents((event) => {
      if (event.type === 'settings-changed') {
        void syncDesktopSettings({ adoptTheme: true });
        return;
      }
      if (event.type !== 'ui-control') return;
      const cmd = event.payload;
      const ui = useUIStore.getState();

      const resolveDirectoryKey = (): string => {
        const currentDir = useSessionUIStore.getState().currentSessionId
          ? null
          : useProjectsStore.getState().getActiveProject()?.path ?? useProjectsStore.getState().projects[0]?.path ?? null;
        const activeProject = useProjectsStore.getState().getActiveProject() ?? useProjectsStore.getState().projects[0] ?? null;
        const raw = currentDir || activeProject?.path || '';
        return raw ? normalizeContextPanelDirectoryKey(raw) : '';
      };

      switch (cmd.command) {
        case 'open_surface': {
          const surface = cmd.surface?.trim();
          const dir = resolveDirectoryKey();
          if (surface && dir && isContextPanelMode(surface)) {
            ui.openContextPanelTab(dir, { mode: surface });
          }
          break;
        }
        case 'close_surface': {
          const dir = resolveDirectoryKey();
          if (dir) {
            ui.closeContextZone(dir, 'right');
          }
          break;
        }
        case 'open_settings': {
          if (cmd.section?.trim()) ui.setSettingsPage(cmd.section.trim());
          ui.setSettingsDialogOpen(true);
          break;
        }
        case 'close_settings': {
          ui.setSettingsDialogOpen(false);
          break;
        }
        case 'focus_session': {
          if (cmd.sessionId?.trim()) {
            useSessionUIStore.getState().setCurrentSession(cmd.sessionId.trim());
          }
          break;
        }
        case 'toggle_sidebar': {
          ui.setSidebarOpen(!ui.isSidebarOpen);
          break;
        }
        case 'set_theme': {
          if (cmd.themeId?.trim()) {
            setTheme(cmd.themeId.trim());
          }
          break;
        }
        case 'notify': {
          const msg = cmd.message || cmd.title || '';
          if (!msg) break;
          if (cmd.level === 'error') toast.error(msg);
          else if (cmd.level === 'warning') toast.warning(msg);
          else if (cmd.level === 'success') toast.success(msg);
          else toast.info(msg);
          break;
        }
      }
    });
  }, [setTheme]);
};
