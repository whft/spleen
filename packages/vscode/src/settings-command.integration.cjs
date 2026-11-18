const assert = require('node:assert/strict');
const vscode = require('vscode');

// Run in the real extension host with --extensionTestsPath (see ../README.md).
exports.run = async () => {
  await vscode.extensions.getExtension('fedaykindev.spleen').activate();
  const settingsTabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs)
    .filter(tab => tab.input instanceof vscode.TabInputWebview
      && tab.input.viewType === 'mainThreadWebview-spleen.settings');
  const waitForTabs = async (count) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (settingsTabs().length === count) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(settingsTabs().length, count);
  };

  await vscode.commands.executeCommand('spleen.closeSettings');
  await waitForTabs(0);
  try {
    // The title-menu context can be null; palette calls omit the argument.
    for (const args of [[null], [], [undefined], [{ page: 'appearance' }]]) {
      await vscode.commands.executeCommand('spleen.showSettings', ...args);
      await waitForTabs(1);
      await vscode.commands.executeCommand('spleen.showSettings', ...args);
      assert.equal(settingsTabs().length, 1, 'Repeated commands reuse the Settings tab');
      await vscode.commands.executeCommand('spleen.closeSettings');
      await waitForTabs(0);
    }
    for (const input of [false, '', {}, { page: 42 }]) {
      await assert.rejects(
        Promise.resolve(vscode.commands.executeCommand('spleen.showSettings', input)),
        /Invalid input/,
      );
      assert.equal(settingsTabs().length, 0, 'Invalid navigation must not open Settings');
    }
  } finally {
    await vscode.commands.executeCommand('spleen.closeSettings');
  }
};
