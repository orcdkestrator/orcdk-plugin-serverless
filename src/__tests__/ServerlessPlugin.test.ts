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
      options: {}
    };

    mockOrcdkConfig = {
      version: '1.0.0',
      environments: {},
      isLocal: true,
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
