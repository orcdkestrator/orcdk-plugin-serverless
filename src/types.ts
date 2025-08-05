/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Type definitions for Serverless plugin
 */

export interface ServerlessPattern {
  type: 'serverless';
  services: ServerlessService[];
}

export interface ServerlessService {
  name: string;
  path: string;
  configFile: string;
  provider: 'serverless';
  dependencies: string[];
}

export interface ServerlessConfig {
  serverless?: {
    stage?: string;
    region?: string;
    runtime?: string;
  };
  autoDetect?: boolean;
  enableRemoteDeployment?: boolean;
  stackInspection?: {
    enabled?: boolean;
    cacheResults?: boolean;
    defaultProfile?: string;
    defaultRegion?: string;
  };
  localstack?: {
    enabled?: boolean;
    mountCode?: boolean;
    autoInstallPlugin?: boolean;
  };
  hotReloading?: {
    enabled?: boolean;
    watchPaths?: string[];
    watchInterval?: number;
  };
}

export interface ServerlessDeploymentOptions {
  service: ServerlessService;
  stage: string;
  region?: string;
  environment?: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface ServerlessEventPayloads {
  'serverless:before:pattern-detection': {
    projectRoot: string;
  };
  
  'serverless:after:pattern-detection': {
    pattern: ServerlessPattern;
    servicesFound: number;
    services: string[];
  };
  
  'serverless:before:service-deploy': {
    service: string;
    stage: string;
    configPath: string;
  };
  
  'serverless:after:service-deploy': {
    service: string;
    stage: string;
    success: boolean;
    outputs?: Record<string, unknown>;
    error?: string;
  };

  'serverless:after:service-remove': {
    service: string;
    stage: string;
    success: boolean;
    error?: string;
  };
  
  'serverless:hot-reload:handler-updated': {
    service: string;
    file: string;
    handler: string;
    timestamp: number;
  };
  
  'serverless:dependency:detected': {
    type: 'ssm' | 'cloudformation' | 'lambda';
    source: string;
    target: string;
    parameterPath?: string;
    outputName?: string;
  };

  'serverless:before:stack-inspection': {
    stackName: string;
    region?: string;
    profile?: string;
  };

  'serverless:after:stack-inspection': {
    stackName: string;
    requirements: any; // StackRequirements from stack-inspector.ts
    outputsCount: number;
    environmentVariablesCount: number;
    dependenciesCount: number;
    readyForDeployment: boolean;
  };

  'serverless:stack:inspection:failed': {
    stackName: string;
    error: string;
  };

  'serverless:before:environment-validation': {
    service: string;
    environment: string;
  };

  'serverless:environment:validated': {
    service: string;
    environment: string;
    resolvedVariables: Record<string, string>;
    missingVariables: string[];
  };

  'serverless:environment:validation:failed': {
    service: string;
    environment: string;
    missingVariables: string[];
    errors: string[];
  };

  'serverless:remote:deploy:started': {
    service: string;
    stackName: string;
    environment: string;
    profile?: string;
  };

  'serverless:remote:deploy:completed': {
    service: string;
    environment: string;
    success: boolean;
    duration?: number;
    error?: string;
  };
}

export interface ServerlessYamlConfig {
  service: string;
  provider?: {
    name?: string;
    runtime?: string;
    stage?: string;
    region?: string;
    environment?: Record<string, string | number | boolean>;
  };
  functions?: Record<string, {
    handler: string;
    runtime?: string;
    environment?: Record<string, string | number | boolean>;
    events?: Array<Record<string, unknown>>;
  }>;
  custom?: Record<string, unknown>;
  plugins?: string[];
}