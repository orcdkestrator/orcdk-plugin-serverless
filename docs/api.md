# Serverless Plugin API Reference

## Plugin Configuration

```typescript
interface ServerlessConfig {
  enabled: boolean;
  servicePath?: string;
  stage?: string;
  region?: string;
  profile?: string;
  configFile?: string;
  skipDeploy?: boolean;
}
```

## Lifecycle Hooks

### `afterStackDeploy`
Deploys Serverless Framework service after CDK stack deployment.

### `beforeStackDestroy`
Removes Serverless Framework service before CDK stack destruction.

## Methods

### `initialize(config: PluginConfig, orcdkConfig: OrcdkConfig): Promise<void>`
Initializes the plugin and validates Serverless Framework installation.

### `deploy(): Promise<void>`
Deploys the Serverless service using the configured options.

### `remove(): Promise<void>`
Removes the deployed Serverless service.

### `getServiceInfo(): Promise<ServiceInfo>`
Retrieves information about the deployed service including endpoints and functions.

### `validateServerlessConfig(): void`
Validates the serverless.yml configuration file exists and is valid.

## Types

```typescript
interface ServiceInfo {
  serviceName: string;
  stage: string;
  region: string;
  endpoints: string[];
  functions: FunctionInfo[];
}

interface FunctionInfo {
  name: string;
  runtime: string;
  memorySize: number;
  timeout: number;
  environment: Record<string, string>;
}
```
