import { appendManagedCommand, appendManagedInstructions, appendManagedPermissions, appendManagedPolicies, appendManagedPlugin, appendManagedSkills } from './managed-plugin-config.js';
import { managedPermissionRules } from '../agent-tool/runtime.js';
import { isLimitFailoverConfigured } from '../limit-failover/policy.js';
import { isSharingAvailable } from '../share-pages/relay-client.js';
import { CORE_INSTRUCTIONS_FILE_NAME, SPLEEN_BASE_RULES } from '../session-knowledge/base-rules.js';
import { materializeSessionTitlePlugin } from './session-title-plugin.js';
import { EXTENSION_AUTHORING_COMMAND, materializeAuthoringSkill } from '../guests/agent-context.js';

export const MANAGED_CONFIG_FILE_NAME = 'opencode.managed.json';

const DISABLED_BUILTIN_PLUGINS = ['-opencode.browser'];

const BUILTIN_IMAGE_PLUGIN = '-opencode.tool.image-generate';

/**
 * The managed OpenCode config layer.
 *
 * OpenCode 2 watches every config source it reads, including the file named by
 * the `OPENCODE_CONFIG` environment variable, and reloads its plugin list when
 * that file changes. Writing Spleen's own plugin entries into a file we
 * own therefore makes toggling a managed tool take effect in the running
 * process — where `OPENCODE_CONFIG_CONTENT` (an environment variable) could
 * only ever change across a restart.
 *
 * The file is Spleen-owned and holds `plugins`: the built-in plugins
 * Spleen disables, then its own plugin directories; `policies`: the
 * `integration.use` denials for the plugins switched off in Spleen; and
 * `permissions` its tools need, such as the workflow answer tool denied
 * everywhere but in the sessions that allow it. OpenCode appends every layer's
 * permissions to each agent, so ours add to the user's rules and replace none.
 * `skills` lists our extension-writing skill and the folders active extensions
 * ship, `commands` the command that starts extension work, and `instructions`
 * the base-rules file OpenCode reads into every session, including subagents
 * it starts on its own. It sits above
 * the user's global `opencode.json` and below their project config, so it never
 * shadows a project-level choice. The plugin folders active extensions ship
 * come after Spleen's own plugins: OpenCode loads in list order, so an
 * extension never shadows a managed tool.
 *
 * When the user's own environment already sets `OPENCODE_CONFIG`, that file is
 * theirs: Spleen does not hijack it and falls back to merging its plugins
 * into `OPENCODE_CONFIG_CONTENT`, which keeps the old restart requirement for
 * managed-tool toggles.
 *
 * @param {object} dependencies
 * @param {typeof import('node:fs/promises')} dependencies.fsPromises
 * @param {typeof import('node:path')} dependencies.path
 * @param {string} dependencies.instanceDir this server's own directory (`instance-dir.js`)
 * @param {NodeJS.ProcessEnv} [dependencies.env] environment the managed child inherits
 * @param {object|null} [dependencies.agentToolRuntime]
 * @param {object|null} [dependencies.limitFailoverRuntime] `../limit-failover/runtime.js`; its plugin calls back through the agent tool's address
 * @param {() => Promise<object|null>} dependencies.readSettings
 * @param {() => Promise<string[]>} [dependencies.listExtensionSkillDirectories] skill folders of active extensions
 * @param {() => Promise<string[]>} [dependencies.listExtensionPluginDirectories] OpenCode plugin folders of active extensions
 * @param {string} [dependencies.spleenVersion] the running app, which the extension-writing skill pins its SDK to
 * @param {() => { action: string, resource: string, effect: string }[]} [dependencies.readPluginDenials] the plugins switched off in Spleen
 */
export const createManagedConfigRuntime = ({
  fsPromises,
  path,
  instanceDir,
  env = process.env,
  agentToolRuntime = null,
  limitFailoverRuntime = null,
  readSettings,
  listExtensionSkillDirectories = async () => [],
  listExtensionPluginDirectories = async () => [],
  spleenVersion,
  readPluginDenials = () => [],
}) => {
  const filePath = path.join(instanceDir, MANAGED_CONFIG_FILE_NAME);
  const coreInstructionsPath = path.join(instanceDir, CORE_INSTRUCTIONS_FILE_NAME);

  const ownsConfigFile = () => (env.OPENCODE_CONFIG ?? '').trim().length === 0;

  const materializeCoreInstructions = async () => {
    await fsPromises.mkdir(instanceDir, { recursive: true });
    const tmp = `${coreInstructionsPath}.tmp-${process.pid}-${Date.now()}`;
    try {
      await fsPromises.writeFile(tmp, `${SPLEEN_BASE_RULES}\n`, { encoding: 'utf8', mode: 0o600 });
      await fsPromises.rename(tmp, coreInstructionsPath);
    } catch (error) {
      await fsPromises.rm(tmp, { force: true }).catch(() => {});
      throw error;
    }
    return coreInstructionsPath;
  };

  const writeConfigFile = async ({ disabled, directories, extensionPlugins, permissions, policies, skills, commands, instructions }) => {
    await fsPromises.mkdir(instanceDir, { recursive: true });
    const config = { plugins: [...disabled, ...directories, ...extensionPlugins], instructions, skills, commands };
    if (policies.length > 0) config.policies = policies;
    if (permissions.length > 0) config.permissions = permissions;
    const text = `${JSON.stringify(config, null, 2)}\n`;
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      await fsPromises.writeFile(tmp, text, { encoding: 'utf8', mode: 0o600 });
      await fsPromises.rename(tmp, filePath);
    } catch (error) {
      await fsPromises.rm(tmp, { force: true }).catch(() => {});
      throw error;
    }
  };

  const materializeEnabledPlugins = async () => {
    const settings = await Promise.resolve(readSettings()).catch(() => null);
    const includeControl = settings?.agentControlToolEnabled !== false;
    const includeSchedule = settings?.agentScheduleToolEnabled !== false;
    const includeWeb = settings?.agentWebToolEnabled !== false;
    const includeMemory = settings?.agentMemoryToolEnabled === true;
    const includeKnowledge = settings?.agentKnowledgeToolEnabled !== false;
    const includeNotify = settings?.agentNotifyToolEnabled === true;
    const includeRender = settings?.agentRenderToolEnabled !== false;
    const includeShare = includeRender && isSharingAvailable();
    const includeImage = settings?.agentImageToolEnabled === true;
    const includeSecret = settings?.agentSecretToolEnabled !== false;
    const includeUsage = settings?.agentUsageToolEnabled === true;
    const includeTerminal = settings?.agentTerminalToolEnabled === true;
    const includeWorkflow = settings?.agentWorkflowToolEnabled === true;

    const directories = [];
    let permissions = [];
    if (agentToolRuntime && (includeControl || includeSchedule || includeWeb || includeMemory || includeKnowledge || includeNotify || includeRender || includeImage || includeSecret || includeUsage || includeTerminal || includeWorkflow)) {
      directories.push(await agentToolRuntime.materializePlugin({ includeControl, includeSchedule, includeWeb, includeMemory, includeKnowledge, includeNotify, includeRender, includeShare, includeImage, includeSecret, includeUsage, includeTerminal, includeWorkflow }));
      permissions = managedPermissionRules({ includeWorkflow });
    }
    if (agentToolRuntime && limitFailoverRuntime && isLimitFailoverConfigured(settings)) {
      directories.push(await limitFailoverRuntime.materializePlugin());
    }
    directories.push(await materializeSessionTitlePlugin({ fsPromises, path, instanceDir }));
    const disabled = includeImage ? [...DISABLED_BUILTIN_PLUGINS, BUILTIN_IMAGE_PLUGIN] : DISABLED_BUILTIN_PLUGINS;
    const authoring = await materializeAuthoringSkill({ fsPromises, instanceDir, spleenVersion });
    const skills = [authoring.skillsRoot, ...await listExtensionSkillDirectories()];
    const extensionPlugins = await listExtensionPluginDirectories();
    const instructions = [await materializeCoreInstructions()];
    return { disabled, directories, extensionPlugins, permissions, policies: readPluginDenials(), skills, commands: { [EXTENSION_AUTHORING_COMMAND]: authoring.command }, instructions };
  };

  let writing = null;
  let writeAgain = false;
  const writeLatestConfigFile = () => {
    if (writing) {
      writeAgain = true;
      return writing;
    }
    writing = (async () => {
      do {
        writeAgain = false;
        await writeConfigFile(await materializeEnabledPlugins());
      } while (writeAgain);
    })().finally(() => {
      writing = null;
    });
    return writing;
  };

  const buildManagedChildEnv = async () => {
    const childEnv = agentToolRuntime ? agentToolRuntime.createChildEnv() : {};
    if (ownsConfigFile()) {
      await writeLatestConfigFile();
      return { ...childEnv, OPENCODE_CONFIG: filePath };
    }
    const enabled = await materializeEnabledPlugins();
    let content = env.OPENCODE_CONFIG_CONTENT;
    for (const directory of [...enabled.disabled, ...enabled.directories, ...enabled.extensionPlugins]) {
      content = appendManagedPlugin(content, directory, 'managed plugin');
    }
    if (enabled.policies.length > 0) content = appendManagedPolicies(content, enabled.policies);
    if (enabled.permissions.length > 0) content = appendManagedPermissions(content, enabled.permissions);
    content = appendManagedSkills(content, enabled.skills);
    content = appendManagedInstructions(content, enabled.instructions);
    for (const [name, command] of Object.entries(enabled.commands)) content = appendManagedCommand(content, name, command);
    return { ...childEnv, OPENCODE_CONFIG_CONTENT: content };
  };

  /**
   * Rewrite the managed config file after a managed-plugin setting or the
   * extension catalog changed, so the running OpenCode picks the new plugin
   * list up. A no-op when the user owns `OPENCODE_CONFIG`; those installs
   * still need a restart.
   *
   * @returns {Promise<{updated: boolean, reason?: string}>}
   */
  const refreshManagedConfigFile = async () => {
    if (!ownsConfigFile()) return { updated: false, reason: 'external-config' };
    await writeLatestConfigFile();
    return { updated: true };
  };

  return {
    filePath,
    ownsConfigFile,
    buildManagedChildEnv,
    refreshManagedConfigFile,
  };
};
