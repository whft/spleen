import * as path from 'path';

import { createOpenCodeTrust } from '../../web/server/lib/opencode-trust/index.js';
import { getSpleenDataDir } from './spleenSessionState';

export const openCodeTrust = createOpenCodeTrust({ storePath: path.join(getSpleenDataDir(), 'opencode-trust.json') });
