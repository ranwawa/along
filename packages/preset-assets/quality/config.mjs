#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, '../../quality.config.json');

export const qualityConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
