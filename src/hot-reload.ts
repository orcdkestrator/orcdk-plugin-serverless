import * as fs from 'fs';
import * as path from 'path';
import * as chokidar from 'chokidar';
import { EventBus, EventTypes } from '@orcdkestrator/core';
import { ServerlessService } from './types';

// Constants for hot reload configuration
const DEFAULT_WATCH_INTERVAL_MS = 700;
const WRITE_STABILITY_POLL_INTERVAL_MS = 100;

/**
 * Hot reload functionality for Serverless functions
 */
export class ServerlessHotReload {
  private eventBus: EventBus;
  private watchers: Map<string, chokidar.FSWatcher> = new Map();
  private watchInterval: number = DEFAULT_WATCH_INTERVAL_MS;

  constructor(eventBus: EventBus, watchInterval?: number) {
    this.eventBus = eventBus;
    if (watchInterval) {
      this.watchInterval = watchInterval;
    }
  }

  /**
   * Start watching a service for changes
   */
  async startWatching(service: ServerlessService): Promise<void> {
    try {
      // Stop existing watcher if any
      await this.stopWatchingService(service.name);
      
      const watchPaths = this.getWatchPaths(service);
      
      console.log(`[serverless:hot-reload] Watching ${service.name} for changes...`);
      
      const watcher = chokidar.watch(watchPaths, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: this.watchInterval,
          pollInterval: WRITE_STABILITY_POLL_INTERVAL_MS
        },
        ignored: [
          '**/node_modules/**',
          '**/.serverless/**',
          '**/dist/**',
          '**/build/**',
          '**/*.test.js',
          '**/*.test.ts'
        ]
      });
      
      // Handle file changes
      watcher.on('change', (filePath: string) => {
        this.handleFileChange(service, filePath);
      });
      
      // Handle new files
      watcher.on('add', (filePath: string) => {
        this.handleFileChange(service, filePath);
      });
      
      // Handle errors to prevent memory leaks
      watcher.on('error', async (error: unknown) => {
        console.error(`[serverless:hot-reload] Watcher error for ${service.name}:`, error);
        // Clean up the failed watcher
        await this.stopWatchingService(service.name);
      });
      
      // Store watcher
      this.watchers.set(service.name, watcher);
    } catch (error) {
      console.error(`[serverless:hot-reload] Failed to start watching ${service.name}:`, error);
      // Ensure cleanup on error
      await this.stopWatchingService(service.name);
      throw error;
    }
  }

  /**
   * Stop watching all services
   */
  async stopWatching(): Promise<void> {
    const promises = Array.from(this.watchers.keys()).map(
      serviceName => this.stopWatchingService(serviceName)
    );
    
    await Promise.all(promises);
  }

  /**
   * Stop watching a specific service
   */
  private async stopWatchingService(serviceName: string): Promise<void> {
    const watcher = this.watchers.get(serviceName);
    
    if (watcher) {
      await watcher.close();
      this.watchers.delete(serviceName);
    }
  }

  /**
   * Get paths to watch for a service
   */
  private getWatchPaths(service: ServerlessService): string[] {
    const basePaths = [
      path.join(service.path, 'src'),
      path.join(service.path, 'lib'),
      path.join(service.path, 'handlers'),
      path.join(service.path, 'functions')
    ];
    
    // Only include paths that exist
    return basePaths.filter(p => fs.existsSync(p));
  }

  /**
   * Handle file change event
   */
  private handleFileChange(service: ServerlessService, filePath: string): void {
    const relativePath = path.relative(service.path, filePath);
    const handler = this.extractHandlerName(filePath);
    
    console.log(`[serverless:hot-reload] Detected change in ${service.name}: ${relativePath}`);
    
    // Emit hot reload event
    this.eventBus.emitEvent(
      EventTypes['serverless:hot-reload:handler-updated'],
      {
        service: service.name,
        file: relativePath,
        handler,
        timestamp: Date.now()
      },
      'ServerlessHotReload'
    );
  }

  /**
   * Extract handler name from file path
   */
  private extractHandlerName(filePath: string): string {
    const basename = path.basename(filePath, path.extname(filePath));
    const dirname = path.basename(path.dirname(filePath));
    
    // Common patterns:
    // handlers/user.js -> user
    // src/functions/auth/handler.js -> auth
    // lib/process.js -> process
    
    if (basename === 'handler' || basename === 'index') {
      return dirname;
    }
    
    return basename;
  }
}