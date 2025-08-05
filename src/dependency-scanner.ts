import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { EventBus, EventTypes } from '@orcdkestrator/core';

/**
 * Scans Serverless configurations for stack dependencies
 */
export class ServerlessDependencyScanner {
  private readonly eventBus: EventBus;

  constructor() {
    this.eventBus = EventBus.getInstance();
  }

  /**
   * Scan dependencies from a serverless config file
   */
  async scanDependencies(configPath: string, projectRoot?: string): Promise<string[]> {
    try {
      // Validate path is within project boundaries
      if (!this.isPathSafe(configPath, projectRoot)) {
        throw new Error(`Invalid path: ${configPath} is outside project boundaries`);
      }
      
      const content = await this.loadConfig(configPath);
      const dependencies = new Set<string>();
      
      // Scan SSM references
      const ssmDeps = await this.scanSSMReferences(content, configPath);
      ssmDeps.forEach(d => dependencies.add(d));
      
      // Scan CloudFormation imports
      const cfDeps = await this.scanCFImports(content, configPath);
      cfDeps.forEach(d => dependencies.add(d));
      
      return Array.from(dependencies);
    } catch (error) {
      return [];
    }
  }

  /**
   * Load and parse serverless config
   */
  private async loadConfig(configPath: string): Promise<Record<string, unknown>> {
    // Check file size to prevent DoS attacks
    const stats = await fs.promises.stat(configPath);
    const maxFileSizeMB = 10;
    const maxFileSize = maxFileSizeMB * 1024 * 1024; // 10MB limit
    
    if (stats.size > maxFileSize) {
      throw new Error(`File ${configPath} exceeds maximum size limit of ${maxFileSizeMB}MB`);
    }
    
    const content = await fs.promises.readFile(configPath, 'utf-8');
    return yaml.load(content) as Record<string, unknown>;
  }

  /**
   * Scan for SSM parameter references
   */
  private async scanSSMReferences(content: Record<string, unknown>, filePath: string): Promise<string[]> {
    const dependencies = new Set<string>();
    const yamlString = yaml.dump(content);
    
    /**
     * SSM Parameter Reference Pattern
     * Matches: ${ssm:parameterPath}
     * 
     * Pattern breakdown:
     * \$\{ssm:      - Literal "${ssm:" prefix
     * (             - Start capture group for parameter path
     *   (?:         - Non-capturing group for alternation
     *     [^$}]     - Any character except '$' or '}'
     *     |         - OR
     *     \$\{[^}]+\} - Nested interpolation like ${self:provider.stage}
     *   )+          - One or more of the above
     * )             - End capture group
     * \}            - Literal closing '}'
     * 
     * Examples it matches:
     * - ${ssm:/path/to/param}
     * - ${ssm:/${self:provider.stage}-api-gateway-stack/rest-api-id}
     * - ${ssm:/prod/${self:custom.serviceName}/database-url}
     */
    const ssmPattern = /\$\{ssm:((?:[^$}]|\$\{[^}]+\})+)\}/g;
    
    let match;
    while ((match = ssmPattern.exec(yamlString)) !== null) {
      const ssmPath = match[1];
      
      if (ssmPath) {
        const stackName = this.extractStackFromSSMPath(ssmPath);
        
        if (stackName) {
          dependencies.add(stackName);
          this.emitDependencyEvent('ssm', filePath, stackName);
        }
      }
    }
    
    return Array.from(dependencies);
  }

  /**
   * Extract stack name from SSM path
   */
  private extractStackFromSSMPath(ssmPath: string): string | null {
    // First check if path contains interpolated stack names like:
    // /${self:custom.stage}-api-gateway-stack/rest-api-id
    const interpolatedStackPattern = /\/[^/]*\$\{[^}]+\}[^/]*-stack/;
    if (interpolatedStackPattern.test(ssmPath)) {
      // Extract the part with interpolation and get the base stack name
      const match = ssmPath.match(/\/([^/]*\$\{[^}]+\}[^/]*-stack)/);
      if (match && match[1]) {
        return this.extractBaseStackName(match[1]);
      }
    }
    
    // Standard path processing
    let cleanPath = ssmPath;
    
    // Remove interpolations
    cleanPath = cleanPath.replace(/\$\{[^}]+\}/g, '*');
    
    // Extract stack name from path
    const pathParts = cleanPath.split('/').filter(p => p && p !== '*');
    
    // Look for stack-like names
    for (const part of pathParts) {
      // Handle patterns like *-stack
      if (part.includes('*') && part.includes('stack')) {
        const cleanPart = part.replace(/\*/g, '').replace(/^-+|-+$/g, '');
        if (cleanPart) {
          return cleanPart;
        }
      }
      
      if (part.includes('stack') || this.isKnownStackName(part)) {
        return part;
      }
    }
    
    // Use first meaningful part as fallback
    return pathParts.length > 0 && pathParts[0] ? pathParts[0] : null;
  }

  /**
   * Check if name is a known stack pattern
   */
  private isKnownStackName(name: string): boolean {
    const patterns = [
      'vpc', 'rds', 'cognito', 'api-gateway',
      'dynamodb', 's3', 'lambda', 'ecs', 'eks'
    ];
    
    return patterns.some(p => name.toLowerCase().includes(p));
  }

  /**
   * Scan for CloudFormation imports
   */
  private async scanCFImports(content: Record<string, unknown>, filePath: string): Promise<string[]> {
    const dependencies = new Set<string>();
    const yamlString = yaml.dump(content);
    
    /**
     * CloudFormation Import Reference Pattern
     * Matches: ${cf:stackName.outputName}
     * 
     * Pattern breakdown:
     * \$\{cf:       - Literal "${cf:" prefix
     * (             - Start capture group for stack.output reference
     *   (?:         - Non-capturing group for alternation
     *     [^$}]     - Any character except '$' or '}'
     *     |         - OR
     *     \$\{[^}]+\} - Nested interpolation like ${self:provider.stage}
     *   )+          - One or more of the above
     * )             - End capture group
     * \}            - Literal closing '}'
     * 
     * Examples it matches:
     * - ${cf:my-stack.RestApiId}
     * - ${cf:${self:provider.stage}-api-stack.RestApiEndpoint}
     * - ${cf:prod-${self:service}-vpc.VpcId}
     */
    const cfPattern = /\$\{cf:((?:[^$}]|\$\{[^}]+\})+)\}/g;
    
    let match;
    while ((match = cfPattern.exec(yamlString)) !== null) {
      const cfRef = match[1];
      
      if (!cfRef) continue;
      
      // Extract stack name and output name
      const lastDotIndex = cfRef.lastIndexOf('.');
      if (lastDotIndex > 0) {
        const stackName = cfRef.substring(0, lastDotIndex);
        const outputName = cfRef.substring(lastDotIndex + 1);
        
        if (stackName && outputName) {
          if (!stackName.includes('${')) {
            dependencies.add(stackName);
            this.emitCFDependencyEvent(filePath, stackName, outputName);
          } else {
            // Handle interpolated stack names
            const baseName = this.extractBaseStackName(stackName);
            if (baseName) {
              dependencies.add(baseName);
              this.emitCFDependencyEvent(filePath, baseName, outputName);
            }
          }
        }
      }
    }
    
    return Array.from(dependencies);
  }

  /**
   * Extract base stack name from interpolated string
   */
  private extractBaseStackName(stackName: string): string | null {
    // Handle patterns like:
    // ${self:provider.stage}-api-stack -> api-stack
    // dynamodb-${self:provider.stage}-stack -> dynamodb-stack
    
    // First try to match common patterns
    const patterns = [
      /\$\{[^}]+\}-(.+-stack)/, // ${stage}-api-stack -> api-stack
      /(.+)-\$\{[^}]+\}-(stack)/, // dynamodb-${stage}-stack -> dynamodb-stack
      /(.+-stack)-\$\{[^}]+\}/, // api-stack-${stage} -> api-stack
    ];
    
    for (const pattern of patterns) {
      const match = stackName.match(pattern);
      if (match) {
        if (match[2] === 'stack') {
          // For pattern like dynamodb-${stage}-stack
          return `${match[1]}-stack`;
        }
        return match[1] || null;
      }
    }
    
    // Fallback: remove interpolations and reconstruct stack name
    const cleanName = stackName.replace(/\$\{[^}]+\}/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-');
    
    // If it ends with -stack, it's complete
    if (cleanName.endsWith('-stack')) {
      return cleanName;
    }
    
    // If it contains stack but doesn't end with it, ensure it does
    if (cleanName.includes('stack') && !cleanName.endsWith('stack')) {
      const parts = cleanName.split('-');
      const stackIndex = parts.indexOf('stack');
      if (stackIndex >= 0) {
        return parts.slice(0, stackIndex + 1).join('-');
      }
    }
    
    // If no 'stack' in name, add it
    return cleanName ? `${cleanName}-stack` : null;
  }

  /**
   * Emit SSM dependency event
   */
  private emitDependencyEvent(type: string, source: string, target: string): void {
    this.eventBus.emitEvent(
      EventTypes['serverless:dependency:detected'],
      {
        type,
        source,
        target
      },
      'ServerlessDependencyScanner'
    );
  }

  /**
   * Emit CF dependency event
   */
  private emitCFDependencyEvent(source: string, target: string, outputName: string): void {
    this.eventBus.emitEvent(
      EventTypes['serverless:dependency:detected'],
      {
        type: 'cloudformation',
        source,
        target,
        outputName
      },
      'ServerlessDependencyScanner'
    );
  }

  /**
   * Validate that a path is within project boundaries
   */
  private isPathSafe(filePath: string, projectRoot?: string): boolean {
    try {
      const resolvedPath = path.resolve(filePath);
      const baseDir = projectRoot ? path.resolve(projectRoot) : process.cwd();
      
      // Check if the resolved path starts with the base directory
      return resolvedPath.startsWith(baseDir);
    } catch {
      return false;
    }
  }
}