const fs = require('fs');
const p = 'src/web/app/legacy-app.js';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(
  "import { createKeysFeature } from './features/keys.js';\nimport { installQuickConnectDeps } from './compat/quick-connect-deps.js';",
  "import { createKeysFeature } from './features/keys.js';\nimport { createTestConsoleFeature } from './features/test-console.js';\nimport { createSaasShell } from './features/saas-shell.js';\nimport { createSaasAuthFeature } from './features/saas-auth.js';\nimport { createSaasDashboardFeature } from './features/saas-dashboard.js';\nimport { createSaasKeysFeature } from './features/saas-keys.js';\nimport { createSaasAdminFeature } from './features/saas-admin.js';\nimport { installQuickConnectDeps } from './compat/quick-connect-deps.js';"
);
s = s.replace(/\n\n\s*if \(resultContent\)[\s\S]*$/m, '\n');
fs.writeFileSync(p, s);
