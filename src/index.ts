/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { Plugin, PluginConfig, OrcdkConfig, EventBus, EventTypes } from '@orcdkestrator/core';
import * as fs from 'fs';
import * as path from 'path';
import { ServerlessPatternDetector } from './pattern-detector';
import { ServerlessDependencyScanner } from './dependency-scanner';
import { ServerlessCLI } from './cli';
import { ServerlessHotReload } from './hot-reload';
import { StackInspector } from './stack-inspector';
import { ServerlessConfig, ServerlessService, ServerlessDeploymentOptions } from './types';

/**
 * Serverless Framework plugin for orcdkestrator
 * Enables deployment of Serverless services alongside CDK stacks
 */
export class ServerlessPlugin implements Plugin {
  public readonly name = '@orcdkestrator/orcdk-plugin-serverless';
  public readonly version = '1.0.2';
  
  private config: ServerlessConfig = {};
  private orcdkConfig: OrcdkConfig | null = null;
  private eventBus!: EventBus;
  private cli: ServerlessCLI | null = null;
  private patternDetector: ServerlessPatternDetector | null = null;
  private dependencyScanner: ServerlessDependencyScanner | null = null;
  private hotReload: ServerlessHotReload | null = null;
  private stackInspector: StackInspector | null = null;
  
  async initialize(config: PluginConfig, orcdkConfig: OrcdkConfig): Promise<void> {
    this.config = config.config as ServerlessConfig || {};
    this.orcdkConfig = orcdkConfig;
    this.eventBus = EventBus.getInstance();
    
    // Initialize components
    this.cli = new ServerlessCLI();
    this.patternDetector = new ServerlessPatternDetector(process.cwd());
    this.dependencyScanner = new ServerlessDependencyScanner();
    
    // Initialize stack inspector for remote deployment capabilities
    if (this.config.enableRemoteDeployment) {
      this.stackInspector = new StackInspector();
    }
    
    // Initialize hot reload if enabled
    if (this.config.hotReloading?.enabled) {
      this.hotReload = new ServerlessHotReload(this.eventBus);
    }
    
    // Subscribe to events
    this.subscribeToEvents();
  }
  
  /**
   * Subscribe to orchestrator events
   */
  private subscribeToEvents(): void {
    // Pattern detection integration
    this.eventBus.on(EventTypes['orchestrator:before:pattern-detection'], async () => {
      await this.detectServerlessServices();
    });
    
    // LocalStack coordination
    this.eventBus.on(EventTypes['localstack:ready'], async () => {
      await this.configureServerlessLocalStack();
    });
    
    // Environment scanning integration
    this.eventBus.on(EventTypes['environment:scan:completed'], async () => {
      // Environment scanner will pick up serverless.yml files automatically
    });
  }
  
  /**
   * Detect Serverless services in the project
   */
  async detectServerlessServices(): Promise<void> {
    if (!this.config.autoDetect) {
      return;
    }
    
    const pattern = await this.patternDetector!.scan();
    
    // Store detected services for later use
    if (pattern.services.length > 0) {
      console.log(`[serverless] Detected ${pattern.services.length} Serverless service(s)`);
    }
  }
  
  /**
   * Deploy a Serverless service with optional remote stack inspection
   */
  async deployService(service: ServerlessService, options: ServerlessDeploymentOptions): Promise<void> {
    // Check if this is a remote deployment
    if (this.config.enableRemoteDeployment && options.environment) {
      return this.deployServiceRemote(service, options);
    }

    // Original deployment logic
    return this.deployServiceLocal(service, options);
  }

  /**
   * Deploy a Serverless service with stack inspection (remote deployment)
   */
  async deployServiceRemote(service: ServerlessService, options: ServerlessDeploymentOptions): Promise<void> {
    const { environment } = options;
    
    this.eventBus.emitEvent(
      EventTypes['serverless:remote:deploy:started'],
      {
        service: service.name,
        stackName: service.dependencies.join(',') || service.name,
        environment,
        profile: this.config.stackInspection?.defaultProfile
      },
      this.name
    );

    const startTime = Date.now();

    try {
      // Step 1: Inspect stack dependencies if configured
      if (service.dependencies.length > 0) {
        for (const stackName of service.dependencies) {
          console.log(`[serverless] Inspecting stack: ${stackName}...`);
          
          const inspectionResult = await this.inspectStack(
            stackName, 
            this.config.stackInspection?.defaultProfile,
            this.config.stackInspection?.defaultRegion
          );

          if (!inspectionResult.success) {
            throw new Error(`Stack inspection failed for ${stackName}: ${inspectionResult.error}`);
          }

          if (!inspectionResult.requirements?.readyForDeployment) {
            throw new Error(
              `Stack ${stackName} is not ready for deployment. Status: ${inspectionResult.requirements?.status}`
            );
          }

          // Step 2: Validate environment variables
          console.log(`[serverless] Validating environment variables for ${service.name}...`);
          
          const validation = await this.validateEnvironmentVariables(
            service.name,
            environment || 'default',
            inspectionResult.requirements
          );

          if (!validation.valid) {
            const missingVars = validation.missing.join(', ');
            throw new Error(
              `Missing required environment variables: ${missingVars}\n` +
              `Available from stack: ${Object.keys(inspectionResult.requirements.environmentVariables).join(', ')}\n` +
              `Recommendations:\n${ 
              validation.missing.map(v => `  - Set ${v}=${inspectionResult.requirements.environmentVariables[v] || '<value>'}`).join('\n')}`
            );
          }

          // Step 3: Inject resolved environment variables
          for (const [varName, value] of Object.entries(validation.resolved)) {
            process.env[varName] = value;
          }

          console.log(`[serverless] ✅ Stack ${stackName} ready, ${Object.keys(validation.resolved).length} env vars resolved`);
        }
      }

      // Step 4: Deploy the service
      await this.deployServiceLocal(service, options);

      // Emit success event
      const duration = Math.round((Date.now() - startTime) / 1000);
      this.eventBus.emitEvent(
        EventTypes['serverless:remote:deploy:completed'],
        {
          service: service.name,
          environment,
          success: true,
          duration
        },
        this.name
      );

    } catch (error) {
      const duration = Math.round((Date.now() - startTime) / 1000);
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.eventBus.emitEvent(
        EventTypes['serverless:remote:deploy:completed'],
        {
          service: service.name,
          environment,
          success: false,
          duration,
          error: errorMessage
        },
        this.name
      );

      throw error;
    }
  }

  /**
   * Deploy a Serverless service (original logic)
   */
  async deployServiceLocal(service: ServerlessService, options: ServerlessDeploymentOptions): Promise<void> {
    // Emit before deploy event
    this.eventBus.emitEvent(
      EventTypes['serverless:before:service-deploy'],
      {
        service: service.name,
        stage: options.stage,
        configPath: service.configFile
      },
      this.name
    );
    
    try {
      // Validate serverless config file exists
      if (!service.configFile || !fs.existsSync(service.configFile)) {
        throw new Error(`Serverless configuration file not found: ${service.configFile || 'serverless.yml'}`);
      }
      
      // Ensure Serverless CLI is available
      if (!(await this.cli!.hasServerlessCLI())) {
        throw new Error('Serverless Framework CLI not found. Please install it: npm install -g serverless');
      }
      
      // Package phase
      this.eventBus.emitEvent(
        EventTypes['serverless:before:service-package'],
        { service: service.name },
        this.name
      );
      
      console.log(`[serverless] Packaging ${service.name}...`);
      await this.cli!.package(service.path, options.stage, options.region);
      
      this.eventBus.emitEvent(
        EventTypes['serverless:after:service-package'],
        { 
          service: service.name,
          packagePath: path.join(service.path, '.serverless')
        },
        this.name
      );
      
      // Deploy phase
      if (!options.dryRun) {
        console.log(`[serverless] Deploying ${service.name} to stage ${options.stage}...`);
        await this.cli!.deploy(service.path, options.stage, options.region);
      }
      
      // Get outputs
      const outputs = await this.extractServiceOutputs(service, options.stage);
      
      // Emit success event
      this.eventBus.emitEvent(
        EventTypes['serverless:after:service-deploy'],
        {
          service: service.name,
          stage: options.stage,
          success: true,
          outputs
        },
        this.name
      );
      
      // Start hot reloading if enabled
      if (this.hotReload && this.shouldEnableHotReload(options)) {
        await this.hotReload.startWatching(service);
      }
      
    } catch (error) {
      // Emit failure event
      this.eventBus.emitEvent(
        EventTypes['serverless:after:service-deploy'],
        {
          service: service.name,
          stage: options.stage,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        },
        this.name
      );
      throw error;
    }
  }
  
  /**
   * Remove a Serverless service
   */
  async removeService(service: ServerlessService, options: ServerlessDeploymentOptions): Promise<void> {
    this.eventBus.emitEvent(
      EventTypes['serverless:before:service-remove'],
      {
        service: service.name,
        stage: options.stage
      },
      this.name
    );
    
    try {
      console.log(`[serverless] Removing ${service.name} from stage ${options.stage}...`);
      await this.cli!.remove(service.path, options.stage, options.region);
      
      this.eventBus.emitEvent(
        EventTypes['serverless:after:service-remove'],
        {
          service: service.name,
          stage: options.stage,
          success: true
        },
        this.name
      );
    } catch (error) {
      this.eventBus.emitEvent(
        EventTypes['serverless:after:service-remove'],
        {
          service: service.name,
          stage: options.stage,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        },
        this.name
      );
      throw error;
    }
  }
  
  /**
   * Configure serverless-localstack plugin
   */
  private async configureServerlessLocalStack(): Promise<void> {
    if (!this.config.localstack?.enabled) {
      return;
    }
    
    console.log('[serverless] Configuring serverless-localstack integration...');
    
    // Check if serverless-localstack is installed
    if (this.config.localstack.autoInstallPlugin) {
      await this.ensureServerlessLocalStackPlugin();
    }
    
    // Configuration will be handled per-service during deployment
  }
  
  /**
   * Ensure serverless-localstack plugin is installed
   */
  private async ensureServerlessLocalStackPlugin(): Promise<void> {
    // This would check package.json and install if needed
    // For now, we assume it's a dev dependency
  }
  
  /**
   * Extract service outputs after deployment
   */
  private async extractServiceOutputs(service: ServerlessService, stage: string): Promise<Record<string, unknown>> {
    try {
      const info = await this.cli!.info(service.path, stage);
      // Parse info output for endpoints, functions, etc.
      return this.parseServiceInfo(info);
    } catch {
      return {};
    }
  }
  
  /**
   * Parse serverless info output
   */
  private parseServiceInfo(info: string): Record<string, unknown> {
    const outputs: Record<string, unknown> = {};
    
    // Extract endpoints
    const endpointMatch = info.match(/endpoints:([\s\S]*?)functions:/);
    if (endpointMatch) {
      outputs.endpoints = endpointMatch[1]?.trim().split('\n').filter(e => e.trim()) || [];
    }
    
    // Extract function names
    const functionsMatch = info.match(/functions:([\s\S]*?)$/);
    if (functionsMatch) {
      outputs.functions = functionsMatch[1]?.trim().split('\n').filter(f => f.trim()) || [];
    }
    
    return outputs;
  }
  
  /**
   * Inspect a CloudFormation stack for deployment requirements
   */
  async inspectStack(stackName: string, profile?: string, region?: string): Promise<any> {
    if (!this.stackInspector) {
      throw new Error('Stack inspection is not enabled. Set enableRemoteDeployment: true in plugin config.');
    }

    const profileConfig = {
      profile: profile || this.config.stackInspection?.defaultProfile,
      region: region || this.config.stackInspection?.defaultRegion
    };

    return await this.stackInspector.inspectStack(stackName, profileConfig);
  }

  /**
   * Validate environment variables against stack requirements
   */
  async validateEnvironmentVariables(
    serviceName: string, 
    environment: string, 
    stackRequirements: any
  ): Promise<{ valid: boolean; missing: string[]; resolved: Record<string, string> }> {
    this.eventBus.emitEvent(
      EventTypes['serverless:before:environment-validation'],
      { service: serviceName, environment },
      this.name
    );

    const resolved: Record<string, string> = {};
    const missing: string[] = [];

    try {
      // Check each required environment variable
      for (const [varName, stackValue] of Object.entries(stackRequirements.environmentVariables || {})) {
        // Look for the variable in multiple sources
        const sources = [
          process.env[varName], // System environment
          process.env[`${environment.toUpperCase()}_${varName}`], // Environment-specific
          stackValue // Stack output value
        ];

        const resolvedValue = sources.find(v => v !== undefined);

        if (resolvedValue !== undefined) {
          resolved[varName] = String(resolvedValue);
        } else {
          missing.push(varName);
        }
      }

      const valid = missing.length === 0;

      // Emit appropriate event
      if (valid) {
        this.eventBus.emitEvent(
          EventTypes['serverless:environment:validated'],
          {
            service: serviceName,
            environment,
            resolvedVariables: resolved,
            missingVariables: missing
          },
          this.name
        );
      } else {
        this.eventBus.emitEvent(
          EventTypes['serverless:environment:validation:failed'],
          {
            service: serviceName,
            environment,
            missingVariables: missing,
            errors: missing.map(v => `Missing required environment variable: ${v}`)
          },
          this.name
        );
      }

      return { valid, missing, resolved };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      this.eventBus.emitEvent(
        EventTypes['serverless:environment:validation:failed'],
        {
          service: serviceName,
          environment,
          missingVariables: missing,
          errors: [errorMsg]
        },
        this.name
      );

      throw error;
    }
  }

  /**
   * Check if hot reload should be enabled
   */
  private shouldEnableHotReload(options: ServerlessDeploymentOptions): boolean {
    return options.stage === 'local' || options.stage === 'dev';
  }
  
  async cleanup(): Promise<void> {
    // Stop hot reloading
    if (this.hotReload) {
      await this.hotReload.stopWatching();
    }
    
    // Unsubscribe from events
    this.eventBus.removeAllListeners(EventTypes['orchestrator:before:pattern-detection']);
    this.eventBus.removeAllListeners(EventTypes['localstack:ready']);
  }
}

// Export as default for plugin loading
export default ServerlessPlugin;