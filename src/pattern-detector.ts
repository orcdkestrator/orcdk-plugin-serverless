import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'fast-glob';
import * as yaml from 'js-yaml';
import { EventBus, EventTypes } from '@orcdkestrator/core';
import { ServerlessPattern, ServerlessService, ServerlessYamlConfig } from './types';

/**
 * Detects Serverless Framework services in a project
 */
export class ServerlessPatternDetector {
  private readonly projectRoot: string;
  private readonly eventBus: EventBus;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.eventBus = EventBus.getInstance();
  }

  /**
   * Scan for Serverless services
   */
  async scan(): Promise<ServerlessPattern> {
    this.emitBeforeEvent();
    
    const configFiles = await this.findServerlessConfigs();
    const services = await this.parseServices(configFiles);
    
    const pattern: ServerlessPattern = {
      type: 'serverless',
      services
    };
    
    this.emitAfterEvent(pattern);
    return pattern;
  }

  /**
   * Find serverless config files
   */
  private async findServerlessConfigs(): Promise<string[]> {
    const patterns = [
      'serverless.yml',
      'serverless.yaml',
      '**/serverless.yml',
      '**/serverless.yaml'
    ];
    
    return this.glob(patterns, {
      cwd: this.projectRoot,
      absolute: true,
      ignore: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.serverless/**'
      ]
    });
  }

  /**
   * Parse services from config files
   */
  private async parseServices(files: string[]): Promise<ServerlessService[]> {
    const services = await Promise.all(
      files.map(f => this.parseService(f))
    );
    
    return services.filter(s => s !== null) as ServerlessService[];
  }

  /**
   * Parse a single service file
   */
  private async parseService(file: string): Promise<ServerlessService | null> {
    try {
      const config = await this.loadYaml(file);
      return {
        name: config.service || path.basename(path.dirname(file)),
        path: path.dirname(file),
        configFile: file,
        provider: 'serverless',
        dependencies: []
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Load and parse YAML file
   */
  private async loadYaml(file: string): Promise<ServerlessYamlConfig> {
    // Validate path is within project boundaries
    if (!this.isPathSafe(file)) {
      throw new Error(`Invalid path: ${file} is outside project boundaries`);
    }
    
    // Check file size to prevent DoS attacks
    const stats = await fs.promises.stat(file);
    const maxFileSizeMB = 10;
    const maxFileSize = maxFileSizeMB * 1024 * 1024; // 10MB limit
    
    if (stats.size > maxFileSize) {
      throw new Error(`File ${file} exceeds maximum size limit of ${maxFileSizeMB}MB`);
    }
    
    const content = await fs.promises.readFile(file, 'utf-8');
    return yaml.load(content) as ServerlessYamlConfig;
  }

  /**
   * Emit before pattern detection event
   */
  private emitBeforeEvent(): void {
    this.eventBus.emitEvent(
      EventTypes['serverless:before:pattern-detection'],
      { projectRoot: this.projectRoot },
      'ServerlessPatternDetector'
    );
  }

  /**
   * Emit after pattern detection event
   */
  private emitAfterEvent(pattern: ServerlessPattern): void {
    this.eventBus.emitEvent(
      EventTypes['serverless:after:pattern-detection'],
      {
        pattern,
        servicesFound: pattern.services.length,
        services: pattern.services.map(s => s.name)
      },
      'ServerlessPatternDetector'
    );
  }

  /**
   * Wrapper for glob to enable testing
   */
  private async glob(patterns: string[], options: { cwd: string; ignore?: string[]; absolute?: boolean }): Promise<string[]> {
    return glob(patterns, options);
  }

  /**
   * Validate that a path is within project boundaries
   */
  private isPathSafe(filePath: string): boolean {
    try {
      const resolvedPath = path.resolve(filePath);
      const baseDir = path.resolve(this.projectRoot);
      
      // Check if the resolved path starts with the base directory
      return resolvedPath.startsWith(baseDir);
    } catch {
      return false;
    }
  }
}