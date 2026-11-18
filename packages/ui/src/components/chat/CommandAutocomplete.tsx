import React from 'react';
import { cn } from '@/lib/utils';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useChatSessionSelection } from './chatColumnSession';
import { isCommandOfferedInComposer, selectCommandsForComposer, useCommandsStore } from '@/stores/useCommandsStore';
import { useComposerConfigDirectory } from '@/hooks/useComposerConfigDirectory';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { useI18n } from '@/lib/i18n';
import { useUIStore } from '@/stores/useUIStore';
import { isVSCodeRuntime } from '@/lib/desktop';
import { useMobileAutocompleteMaxHeight } from './useMobileAutocompleteMaxHeight';
import { mergeCommandAutocompleteItems, rankCommandAutocompleteItems } from './commandAutocompleteItems';
import { useGuestCommands } from '@/hooks/useGuestSurfaces';
import { reservedComposerCommandNames } from './composer/submit/guestCommands';
import { AutocompleteRowDetail } from './composer/ui/AutocompleteRowParts';
import { useAutocompleteSelectionScroll } from './composer/ui/useAutocompleteSelectionScroll';
import { useHeightMorph } from '@/lib/motion/useSizeMorph';

// Skills are not here: they have their own `$` picker.
type CommandSource = 'spleen' | 'opencode' | 'extension';

export interface CommandInfo {
  id: string;
  name: string;
  source: CommandSource;
  description?: string;
  searchAliases?: string[];
  agent?: string;
  model?: string;
  isBuiltIn?: boolean;
  isSpleen?: boolean;
  scope?: string;
  /** Name of the extension that contributed the command; shown as its badge. */
  extensionName?: string;
}

export interface CommandAutocompleteHandle {
  handleKeyDown: (key: string) => void;
}

interface CommandAutocompleteProps {
  searchQuery: string;
  onCommandSelect: (command: CommandInfo) => void;
  onClose: () => void;
  style?: React.CSSProperties;
}

export const CommandAutocomplete = React.forwardRef<CommandAutocompleteHandle, CommandAutocompleteProps>(({
  searchQuery,
  onCommandSelect,
  onClose,
  style,
}, ref) => {
  const { t } = useI18n();
  const currentSessionId = useChatSessionSelection().sessionId;
  const hasSession = Boolean(currentSessionId);
  const hasNewSessionDraft = useSessionUIStore((state) => Boolean(state.newSessionDraft?.open));
  const canStartSessionCommand = hasSession || hasNewSessionDraft;
  const isMobile = useUIStore((state) => state.isMobile);
  const canUseReviewHandoffFlow = hasSession && !isMobile && !isVSCodeRuntime();

  // Commands belong to the directory the composer sends to — the session's
  // own directory, or the Chats root for a chat draft — not to the project
  // the app was on last.
  const effectiveDirectory = useEffectiveDirectory();
  const commandsTarget = useComposerConfigDirectory(effectiveDirectory);
  const commandsWithMetadata = useCommandsStore((s) => selectCommandsForComposer(s, commandsTarget));
  const loadCommandsForDirectory = useCommandsStore((s) => s.loadCommands);
  const refreshCommands = React.useCallback(() => {
    if (commandsTarget.status === 'pending') return;
    return loadCommandsForDirectory(commandsTarget.directory);
  }, [commandsTarget, loadCommandsForDirectory]);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const selectedIndexRef = React.useRef(0);
  const itemRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const { listRef, onKeyboardNavigate } = useAutocompleteSelectionScroll(selectedIndex, itemRefs);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  // Narrowing as the user types, the box eases into its new height; the
  // edge it is anchored to stays put.
  useHeightMorph(containerRef);
  // A caret placement brings its own max-height.
  const mobileMaxHeight = useMobileAutocompleteMaxHeight(containerRef, style?.maxHeight === undefined);
  const ignoreClickRef = React.useRef(false);
  const pointerStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const pointerMovedRef = React.useRef(false);

  React.useEffect(() => {
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target || !containerRef.current) {
        return;
      }
      if (containerRef.current.contains(target)) {
        return;
      }
      onClose();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [onClose]);

  React.useEffect(() => {
    // Force refresh to get latest project context when mounting
    void refreshCommands();
  }, [refreshCommands]);

  const reservedCommandNames = React.useMemo(
    () => reservedComposerCommandNames(commandsWithMetadata),
    [commandsWithMetadata],
  );
  const guestCommands = useGuestCommands(reservedCommandNames);

  // The list depends on the registries, not on what is typed: it is built
  // once per registry change, and only the ranking follows the query.
  const allCommands = React.useMemo<CommandInfo[]>(() => {
    const customCommands: CommandInfo[] = commandsWithMetadata.filter(isCommandOfferedInComposer).map((cmd, index) => ({
      id: `opencode:${cmd.scope ?? 'global'}:${cmd.name}:${cmd.agent ?? ''}:${cmd.model ?? ''}:${index}`,
      name: cmd.name,
      source: 'opencode',
      description: cmd.description,
      agent: cmd.agent ?? undefined,
      model: cmd.model ?? undefined,
      isBuiltIn: cmd.name === 'init' || cmd.name === 'review',
      // It reaches OpenCode through our managed config, but it is ours.
      isSpleen: cmd.name === 'new-extension',
      scope: cmd.scope,
    }));

    const builtInCommands: CommandInfo[] = [
      ...(hasSession
        ? [{ id: 'spleen:init', name: 'init', source: 'spleen' as const, description: t('chat.commandAutocomplete.command.initDescription'), isBuiltIn: true }]
        : []
      ),
      ...(hasSession  // Show when session exists, not when hasMessages
        ? [
            { id: 'spleen:undo', name: 'undo', source: 'spleen' as const, description: t('chat.commandAutocomplete.command.undoDescription'), isBuiltIn: true },
            { id: 'spleen:redo', name: 'redo', source: 'spleen' as const, description: t('chat.commandAutocomplete.command.redoDescription'), isBuiltIn: true },
            { id: 'spleen:timeline', name: 'timeline', source: 'spleen' as const, description: t('chat.commandAutocomplete.command.timelineDescription'), isBuiltIn: true },
            { id: 'spleen:compact', name: 'compact', source: 'spleen' as const, description: t('chat.commandAutocomplete.command.compactDescription'), isBuiltIn: true },
          ]
        : []
      ),
      ...(hasSession
        ? [{ id: 'spleen:btw', name: 'btw', source: 'spleen' as const, description: t('chat.commandAutocomplete.command.btwDescription'), isSpleen: true }]
        : []
      ),
      ...(hasSession
        ? [{ id: 'spleen:fork', name: 'fork', source: 'spleen' as const, description: t('chat.commandAutocomplete.command.forkDescription'), isSpleen: true }]
        : []
      ),
      ...(hasSession
        ? [{ id: 'spleen:summary', name: 'summary', source: 'spleen' as const, description: t('chat.commandAutocomplete.command.summaryDescription'), isSpleen: true }]
        : []
      ),
      ...(canStartSessionCommand
        ? [{ id: 'spleen:workspace-review', name: 'workspace-review', source: 'spleen' as const, description: t('chat.commandAutocomplete.command.workspaceReviewDescription'), isSpleen: true }]
        : []
      ),
      ...(canUseReviewHandoffFlow
        ? [{ id: 'spleen:handoff-review', name: 'handoff-review', source: 'spleen' as const, description: t('chat.commandAutocomplete.command.handoffReviewDescription'), isSpleen: true }]
        : []
      ),
      ...(canStartSessionCommand
        ? [{ id: 'spleen:plan-feature', name: 'plan-feature', source: 'spleen' as const, description: t('chat.commandAutocomplete.command.featurePlanDescription'), isSpleen: true }]
        : []
      ),
      ...(canStartSessionCommand
        ? [{ id: 'spleen:craft-goal', name: 'craft-goal', source: 'spleen' as const, description: t('chat.commandAutocomplete.command.craftGoalDescription'), isSpleen: true }]
        : []
      ),
      ...(canStartSessionCommand
        ? [{ id: 'spleen:schedule-task', name: 'schedule-task', source: 'spleen' as const, description: t('chat.commandAutocomplete.command.scheduleTaskDescription'), isSpleen: true }]
        : []
      ),
      ...(canStartSessionCommand
        ? [{ id: 'spleen:catch-up', name: 'catch-up', source: 'spleen' as const, description: t('chat.commandAutocomplete.command.catchUpDescription'), isSpleen: true }]
        : []
      ),
      ...(canStartSessionCommand
        ? [{ id: 'spleen:debug', name: 'debug', source: 'spleen' as const, description: t('chat.commandAutocomplete.command.debugDescription'), isSpleen: true }]
        : []
      ),
      ...(canStartSessionCommand
        ? [{ id: 'spleen:weigh', name: 'weigh', source: 'spleen' as const, description: t('chat.commandAutocomplete.command.weighDescription'), isSpleen: true }]
        : []
      ),
      ...(canStartSessionCommand
        ? [{ id: 'spleen:explore', name: 'explore', source: 'spleen' as const, description: t('chat.commandAutocomplete.command.exploreDescription'), isSpleen: true }]
        : []
      ),
    ];
    const extensionCommands: CommandInfo[] = guestCommands.map((entry) => ({
      id: `extension:${entry.guestId}:${entry.command.name}`,
      name: entry.command.name,
      source: 'extension',
      description: entry.command.description,
      extensionName: entry.guestName,
    }));
    return [
      ...mergeCommandAutocompleteItems(builtInCommands, customCommands),
      ...extensionCommands,
    ];
  }, [hasSession, canStartSessionCommand, canUseReviewHandoffFlow, commandsWithMetadata, guestCommands, t]);
  const commands = React.useMemo(
    () => rankCommandAutocompleteItems(allCommands, searchQuery),
    [allCommands, searchQuery],
  );

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [commands]);

  React.useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  React.useImperativeHandle(ref, () => ({
    handleKeyDown: (key: string) => {
      const total = commands.length;
      if (key === 'Escape') {
        onClose();
        return;
      }

      if (total === 0) {
        return;
      }

      if (key === 'ArrowDown') {
        onKeyboardNavigate();
        setSelectedIndex((prev) => (prev + 1) % total);
        return;
      }

      if (key === 'ArrowUp') {
        onKeyboardNavigate();
        setSelectedIndex((prev) => (prev - 1 + total) % total);
        return;
      }

      if (key === 'Enter' || key === 'Tab') {
        const safeIndex = ((selectedIndexRef.current % total) + total) % total;
        const command = commands[safeIndex];
        if (command) {
          onCommandSelect(command);
        }
      }
    }
  }), [commands, onClose, onCommandSelect, onKeyboardNavigate]);


  return (
    <div
      ref={containerRef}
      className="absolute z-[100] min-w-0 w-full max-w-[560px] max-h-64 oc-glass-popover oc-glass-floating rounded-xl bottom-full mb-2 inset-s-0 flex flex-col"
      style={mobileMaxHeight !== undefined ? { ...style, maxHeight: mobileMaxHeight } : style}
    >
      <ScrollableOverlay ref={listRef} preventOverscroll outerClassName="flex-1 min-h-0" className="p-1">
          <div>
            {commands.map((command, index) => {
              return (
                <div
                  key={command.id}
                  ref={(el) => { itemRefs.current[index] = el; }}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-lg typography-ui-label",
                    index === selectedIndex && "bg-interactive-selection"
                  )}
                  // Block the focus transfer the tap would perform: the textarea
                  // must stay focused so selecting a command doesn't dismiss the
                  // soft keyboard (the blur raced the keyboard-hide trigger and
                  // won against the deferred refocus).
                  onMouseDown={(event) => event.preventDefault()}
                  onPointerDown={(event) => {
                    if (event.pointerType !== 'touch') {
                      return;
                    }
                    pointerStartRef.current = { x: event.clientX, y: event.clientY };
                    pointerMovedRef.current = false;
                  }}
                  onPointerMove={(event) => {
                    if (event.pointerType !== 'touch' || !pointerStartRef.current) {
                      return;
                    }
                    const dx = event.clientX - pointerStartRef.current.x;
                    const dy = event.clientY - pointerStartRef.current.y;
                    if (Math.hypot(dx, dy) > 6) {
                      pointerMovedRef.current = true;
                    }
                  }}
                  onPointerUp={(event) => {
                    if (event.pointerType !== 'touch') {
                      return;
                    }
                    const didMove = pointerMovedRef.current;
                    pointerStartRef.current = null;
                    pointerMovedRef.current = false;
                    if (didMove) {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    ignoreClickRef.current = true;
                    onCommandSelect(command);
                  }}
                  onPointerCancel={() => {
                    pointerStartRef.current = null;
                    pointerMovedRef.current = false;
                  }}
                  onClick={() => {
                    if (ignoreClickRef.current) {
                      ignoreClickRef.current = false;
                      return;
                    }
                    onCommandSelect(command);
                  }}
                  onMouseMove={() => {
                    setSelectedIndex(index);
                  }}
                >
                  <span className="max-w-[60%] shrink-0 truncate font-medium">/{command.name}</span>
                  <AutocompleteRowDetail
                    scope={command.isSpleen ? 'spleen' : command.isBuiltIn ? 'opencode' : command.scope === 'project' ? 'project' : command.scope ? 'user' : null}
                    extension={command.extensionName}
                    description={command.description}
                  />
                </div>
              );
            })}
            {commands.length === 0 && (
              <div className="px-2 py-1.5 typography-ui-label text-muted-foreground">
                {t('chat.commandAutocomplete.empty')}
              </div>
            )}
          </div>
      </ScrollableOverlay>
      {!isMobile && (
        <div className="px-3 py-1.5 border-t typography-meta text-muted-foreground">
          {t('chat.autocomplete.keyboardHint')}
        </div>
      )}
    </div>
  );
});

CommandAutocomplete.displayName = 'CommandAutocomplete';
