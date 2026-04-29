#!/usr/bin/env node

import { qualityConfig } from './config.mjs';
import { runTaskRef } from './tasks.mjs';

for (const taskRef of qualityConfig.fullSequence) {
  runTaskRef(taskRef);
}
