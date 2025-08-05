import { ServerlessPlugin } from '../index';
import { PluginConfig, OrcdkConfig } from '@orcdkestrator/core';

describe('ServerlessPlugin', () => {
  let plugin: ServerlessPlugin;
  let mockConfig: PluginConfig;
  let mockOrcdkConfig: OrcdkConfig;

  beforeEach(() => {
    mockConfig = {
      name: 'serverless',
      enabled: true,
      config: {}
    };

    mockOrcdkConfig = {
      cdkRoot: 'cdk',
      deploymentStrategy: 'auto',
      environments: {
        local: { displayName: 'Local', isLocal: true }
      },
      plugins: []
    };

    plugin = new ServerlessPlugin();
  });

  it('should have correct name', () => {
    expect(plugin.name).toBe('serverless');
  });

  it('should be defined', () => {
    expect(plugin).toBeDefined();
  });
});
