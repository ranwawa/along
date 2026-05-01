#!/usr/bin/env bun

import { qualityConfig } from './config.mjs';
import { runTaskRef } from './tasks.mjs';

for (const taskRef of qualityConfig.fullSequence) {
  runTaskRef(taskRef);
}
