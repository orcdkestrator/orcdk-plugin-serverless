import { ServerlessPatternDetector } from '../pattern-detector';
import { EventBus } from '@orcdkestrator/core';
import * as fs from 'fs';
import * as path from 'path';

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    stat: jest.fn()
  }
}));
jest.mock('fast-glob');
jest.mock('@orcdkestrator/core', () => {
  const mockEventBus = {
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
    emitEvent: jest.fn(),
    removeAllListeners: jest.fn(),
    listeners: jest.fn().mockReturnValue([]),
    once: jest.fn()
  };
  return {
    EventBus: {
      getInstance: jest.fn(() => mockEventBus)
    },
    EventTypes: {
      'serverless:before:pattern-detection': 'serverless:before:pattern-detection',
      'serverless:after:pattern-detection': 'serverless:after:pattern-detection'
    }
  };
});

describe('ServerlessPatternDetector', () => {
  let detector: ServerlessPatternDetector;
  let mockEventBus: any;
  
  beforeEach(() => {
    jest.clearAllMocks();
    detector = new ServerlessPatternDetector(process.cwd());
    mockEventBus = EventBus.getInstance();
    // Mock fs.promises.stat for all tests
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 } as any);
  });
  
  describe('when scanning for serverless services', () => {
    it('should detect single serverless.yml in root', async () => {
      // Given a project with serverless.yml in root
      const mockFiles = [path.join(process.cwd(), 'serverless.yml')];
      const mockContent = 'service: my-api\nprovider:\n  name: aws';
      
      jest.spyOn(detector as any, 'findServerlessConfigs').mockResolvedValue(mockFiles);
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(mockContent);
      
      // When scanning
      const pattern = await detector.scan();
      
      // Then find one service
      expect(pattern.services).toHaveLength(1);
      expect(pattern.services[0]?.name).toBe('my-api');
      expect(pattern.services[0]?.configFile).toBe(mockFiles[0]);
      expect(pattern.services[0]?.provider).toBe('serverless');
    });
    
    it('should detect multiple services in monorepo', async () => {
      // Given services in subdirectories
      const mockFiles = [
        path.join(process.cwd(), 'services/api/serverless.yml'),
        path.join(process.cwd(), 'services/worker/serverless.yml')
      ];
      
      jest.spyOn(detector as any, 'findServerlessConfigs').mockResolvedValue(mockFiles);
      jest.spyOn(fs.promises, 'readFile')
        .mockResolvedValueOnce('service: api\nprovider:\n  name: aws')
        .mockResolvedValueOnce('service: worker\nprovider:\n  name: aws');
      
      // When scanning
      const pattern = await detector.scan();
      
      // Then find both services
      expect(pattern.services).toHaveLength(2);
      expect(pattern.services[0]?.name).toBe('api');
      expect(pattern.services[1]?.name).toBe('worker');
    });
    
    it('should emit pattern detection events', async () => {
      // Given event listeners
      const mockFiles = [path.join(process.cwd(), 'serverless.yml')];
      jest.spyOn(detector as any, 'findServerlessConfigs').mockResolvedValue(mockFiles);
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue('service: test-service');
      
      // When scanning
      await detector.scan();
      
      // Then events emitted in order
      expect(mockEventBus.emitEvent).toHaveBeenCalledWith(
        'serverless:before:pattern-detection',
        expect.objectContaining({ projectRoot: process.cwd() }),
        'ServerlessPatternDetector'
      );
      
      expect(mockEventBus.emitEvent).toHaveBeenCalledWith(
        'serverless:after:pattern-detection',
        expect.objectContaining({ 
          servicesFound: 1,
          services: ['test-service']
        }),
        'ServerlessPatternDetector'
      );
      
      // Verify order
      const calls = mockEventBus.emitEvent.mock.calls;
      const beforeIndex = calls.findIndex((c: any[]) => c[0] === 'serverless:before:pattern-detection');
      const afterIndex = calls.findIndex((c: any[]) => c[0] === 'serverless:after:pattern-detection');
      expect(beforeIndex).toBeLessThan(afterIndex);
    });
    
    it('should handle missing service name gracefully', async () => {
      // Given serverless.yml without service name
      const mockFiles = [path.join(process.cwd(), 'serverless.yml')];
      const mockContent = 'provider:\n  name: aws\n  runtime: nodejs18.x';
      
      jest.spyOn(detector as any, 'findServerlessConfigs').mockResolvedValue(mockFiles);
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(mockContent);
      
      // When scanning
      const pattern = await detector.scan();
      
      // Then use directory name as service name
      expect(pattern.services).toHaveLength(1);
      expect(pattern.services[0]?.name).toBe(path.basename(process.cwd()));
    });
    
    it('should handle invalid YAML gracefully', async () => {
      // Given invalid YAML
      const mockFiles = [path.join(process.cwd(), 'serverless.yml')];
      const mockContent = 'invalid: yaml: content:';
      
      jest.spyOn(detector as any, 'findServerlessConfigs').mockResolvedValue(mockFiles);
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(mockContent);
      
      // When scanning
      // Then should not throw, but skip invalid file
      const pattern = await detector.scan();
      expect(pattern.services).toHaveLength(0);
    });
    
    it('should extract path from service config', async () => {
      // Given service in subdirectory
      const configPath = path.join(process.cwd(), 'services/api/serverless.yml');
      const mockFiles = [configPath];
      
      jest.spyOn(detector as any, 'findServerlessConfigs').mockResolvedValue(mockFiles);
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue('service: api-service');
      
      // When scanning
      const pattern = await detector.scan();
      
      // Then path should be directory containing serverless.yml
      expect(pattern.services[0]?.path).toBe(path.dirname(configPath));
    });
  });
  
  describe('when searching for config files', () => {
    it('should find serverless.yml and serverless.yaml files', async () => {
      // Given glob mock
      const globSpy = jest.spyOn(detector as any, 'glob');
      
      // When finding configs
      await (detector as any).findServerlessConfigs();
      
      // Then search for both extensions
      expect(globSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          'serverless.yml',
          'serverless.yaml',
          '**/serverless.yml',
          '**/serverless.yaml'
        ]),
        expect.any(Object)
      );
    });
    
    it('should exclude node_modules and common build directories', async () => {
      // Given glob mock
      const globSpy = jest.spyOn(detector as any, 'glob');
      
      // When finding configs
      await (detector as any).findServerlessConfigs();
      
      // Then exclude patterns
      expect(globSpy).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          ignore: expect.arrayContaining([
            '**/node_modules/**',
            '**/dist/**',
            '**/build/**',
            '**/.serverless/**'
          ])
        })
      );
    });
  });
});