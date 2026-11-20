import { describe, expect, it } from 'vitest';

import { appendManagedInstructions, appendManagedPermissions } from './managed-plugin-config.js';

const deny = { action: 'spleen_workflow_answer', resource: '*', effect: 'deny' };

describe('appendManagedPermissions', () => {
  it("keeps the user's rules first and adds ours once", () => {
    const user = { action: 'bash', resource: '*', effect: 'ask' };
    const once = appendManagedPermissions(JSON.stringify({ permissions: [user], model: 'x' }), [deny]);
    const twice = appendManagedPermissions(once, [deny]);
    expect(JSON.parse(twice)).toEqual({ permissions: [user, deny], model: 'x' });
  });

  it('starts a list in an empty config and refuses one that is not a list', () => {
    expect(JSON.parse(appendManagedPermissions(undefined, [deny]))).toEqual({ permissions: [deny] });
    expect(() => appendManagedPermissions('{"permissions":{}}', [deny])).toThrow('must be an array');
  });
});

describe('appendManagedInstructions', () => {
  it("keeps the user's files first and adds ours once", () => {
    const once = appendManagedInstructions(JSON.stringify({ instructions: ['/user/rules.md'], model: 'x' }), ['/app/base.md']);
    const twice = appendManagedInstructions(once, ['/app/base.md']);
    expect(JSON.parse(twice)).toEqual({ instructions: ['/user/rules.md', '/app/base.md'], model: 'x' });
  });

  it('starts a list in an empty config and refuses one that is not a list', () => {
    expect(JSON.parse(appendManagedInstructions(undefined, ['/app/base.md']))).toEqual({ instructions: ['/app/base.md'] });
    expect(() => appendManagedInstructions('{"instructions":{}}', ['/app/base.md'])).toThrow('must be an array');
  });
});
