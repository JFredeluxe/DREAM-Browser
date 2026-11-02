import { safeStorage } from 'electron';
import { Assistant as AssistantCore } from './ai-core.js';

export class Assistant extends AssistantCore {
  constructor(dir) { super(dir, safeStorage); }
}
