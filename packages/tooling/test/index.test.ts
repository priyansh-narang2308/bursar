import { describe, expect, it } from 'vitest';
import * as tooling from '../src';

describe('@bursar/tooling public API', () => {
  it('exposes exactly the documented runtime exports', () => {
    expect(Object.keys(tooling).sort()).toEqual([
      'APIMATIC_PLUGIN_ID',
      'COMMIT_TYPES',
      'DEV_BINARIES',
      'PAYPAL_TOOLKIT_PLUGIN_ID',
      'checkBinaries',
      'checkClaudeCli',
      'checkNode',
      'checkPlugins',
      'checkPnpm',
      'checkSkills',
      'exitCodeFor',
      'fastCheckParameters',
      'findChangedSkills',
      'findOverlappingSkills',
      'groupSkillsBySource',
      'hashSkillFiles',
      'parsePluginList',
      'parseRootManifest',
      'parseSkillsLock',
      'renderReport',
      'summarize',
      'supportedNodeMajors',
      'validateCommitMessage',
    ]);
  });
});
