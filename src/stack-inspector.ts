/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { CloudFormationClient, DescribeStacksCommand, DescribeStacksCommandOutput, Stack } from '@aws-sdk/client-cloudformation';
import { SSMClient, GetParametersByPathCommand } from '@aws-sdk/client-ssm';
import { EventBus, EventTypes } from '@orcdkestrator/core';

/**
 * Stack requirements extracted from CloudFormation inspection
 */
export interface StackRequirements {
  stackName: string;
  region: string;
  outputs: Record<string, string>;
  parameters: Record<string, string>;
  environmentVariables: Record<string, string>;
  dependencies: string[];
  status: 'CREATE_COMPLETE' | 'UPDATE_COMPLETE' | 'ROLLBACK_COMPLETE' | 'DELETE_COMPLETE' | 'PENDING' | 'FAILED';
  readyForDeployment: boolean;
  ssmParameters: Record<string, string>;
}

/**
 * Stack inspection result
 */
export interface StackInspectionResult {
  success: boolean;
  requirements?: StackRequirements;
  error?: string;
  recommendations?: string[];
}

/**
 * AWS profile configuration for stack inspection
 */
export interface AWSProfileConfig {
  profile?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

/**
 * CloudFormation stack inspector for remote deployment capabilities
 * Follows existing plugin patterns and integrates with EventBus
 */
export class StackInspector {
  private readonly eventBus: EventBus;
  private cloudFormationClient: CloudFormationClient | null = null;
  private ssmClient: SSMClient | null = null;

  constructor() {
    this.eventBus = EventBus.getInstance();
  }

  /**
   * Initialize AWS clients with profile configuration
   */
  private initializeClients(config: AWSProfileConfig): void {
    const clientConfig: any = {
      region: config.region || process.env.AWS_REGION || 'us-east-1'
    };

    // If specific credentials are provided, use them
    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken
      };
    }
    // If profile is specified, AWS SDK will handle profile resolution automatically
    else if (config.profile) {
      // AWS SDK will use the profile from ~/.aws/credentials and ~/.aws/config
      process.env.AWS_PROFILE = config.profile;
    }

    this.cloudFormationClient = new CloudFormationClient(clientConfig);
    this.ssmClient = new SSMClient(clientConfig);
  }

  /**
   * Inspect a CloudFormation stack and extract requirements
   */
  async inspectStack(
    stackName: string, 
    profileConfig: AWSProfileConfig = {}
  ): Promise<StackInspectionResult> {
    this.emitBeforeInspectionEvent(stackName, profileConfig);

    try {
      this.initializeClients(profileConfig);

      if (!this.cloudFormationClient) {
        throw new Error('Failed to initialize CloudFormation client');
      }

      const stackData = await this.getStackDetails(stackName);
      
      if (!stackData) {
        return {
          success: false,
          error: `Stack '${stackName}' not found or not accessible`,
          recommendations: [
            'Verify the stack name is correct',
            'Check that the stack exists in the specified region',
            'Ensure your AWS credentials have permission to describe the stack'
          ]
        };
      }

      const requirements = await this.extractRequirements(stackData, profileConfig);
      
      this.emitAfterInspectionEvent(stackName, requirements);

      return {
        success: true,
        requirements
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      this.emitInspectionErrorEvent(stackName, errorMessage);

      return {
        success: false,
        error: errorMessage,
        recommendations: this.generateErrorRecommendations(error)
      };
    }
  }

  /**
   * Get stack details from CloudFormation
   */
  private async getStackDetails(stackName: string): Promise<Stack | null> {
    if (!this.cloudFormationClient) {
      throw new Error('CloudFormation client not initialized');
    }

    try {
      const command = new DescribeStacksCommand({ StackName: stackName });
      const response: DescribeStacksCommandOutput = await this.cloudFormationClient.send(command);
      
      return response.Stacks?.[0] || null;
    } catch (error: any) {
      if (error.name === 'ValidationError' && error.message?.includes('does not exist')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Extract requirements from stack data
   */
  private async extractRequirements(
    stack: Stack, 
    profileConfig: AWSProfileConfig
  ): Promise<StackRequirements> {
    const outputs = this.extractOutputs(stack);
    const parameters = this.extractParameters(stack);
    const ssmParameters = await this.extractSSMParameters(stack, profileConfig);
    
    // Generate environment variables from outputs and SSM parameters
    const environmentVariables = {
      ...this.generateEnvVarsFromOutputs(outputs),
      ...this.generateEnvVarsFromSSM(ssmParameters)
    };

    // Extract dependencies from tags and outputs
    const dependencies = this.extractDependencies(stack);

    // Determine if stack is ready for deployment
    const readyForDeployment = this.isStackReady(stack);

    return {
      stackName: stack.StackName!,
      region: profileConfig.region || process.env.AWS_REGION || 'us-east-1',
      outputs,
      parameters,
      environmentVariables,
      dependencies,
      status: stack.StackStatus as any,
      readyForDeployment,
      ssmParameters
    };
  }

  /**
   * Extract stack outputs
   */
  private extractOutputs(stack: Stack): Record<string, string> {
    const outputs: Record<string, string> = {};
    
    if (stack.Outputs) {
      for (const output of stack.Outputs) {
        if (output.OutputKey && output.OutputValue) {
          outputs[output.OutputKey] = output.OutputValue;
        }
      }
    }

    return outputs;
  }

  /**
   * Extract stack parameters
   */
  private extractParameters(stack: Stack): Record<string, string> {
    const parameters: Record<string, string> = {};
    
    if (stack.Parameters) {
      for (const param of stack.Parameters) {
        if (param.ParameterKey && param.ParameterValue) {
          parameters[param.ParameterKey] = param.ParameterValue;
        }
      }
    }

    return parameters;
  }

  /**
   * Extract SSM parameters related to the stack
   */
  private async extractSSMParameters(
    stack: Stack, 
    _profileConfig: AWSProfileConfig
  ): Promise<Record<string, string>> {
    if (!this.ssmClient) {
      return {};
    }

    const ssmParameters: Record<string, string> = {};
    const stackName = stack.StackName!;
    
    try {
      // Common SSM parameter path patterns for stacks
      const pathPatterns = [
        `/${stackName}/`,
        `/${stackName.toLowerCase()}/`,
        `/stacks/${stackName}/`,
        `/cdk/${stackName}/`
      ];

      for (const pathPattern of pathPatterns) {
        try {
          const command = new GetParametersByPathCommand({
            Path: pathPattern,
            Recursive: true,
            MaxResults: 50 // Limit to prevent excessive API calls
          });
          
          const response: any = await this.ssmClient.send(command);
          
          if (response.Parameters) {
            for (const param of response.Parameters) {
              if (param.Name && param.Value) {
                // Remove the path prefix to get a clean parameter name
                const cleanName = param.Name.replace(pathPattern, '').replace(/^\/+/, '');
                if (cleanName) {
                  ssmParameters[cleanName] = param.Value;
                }
              }
            }
          }
        } catch (error) {
          // Continue with other patterns if one fails
          continue;
        }
      }
    } catch (error) {
      // SSM parameter extraction is optional, don't fail the entire inspection
      console.warn(`Failed to extract SSM parameters for stack ${stackName}:`, error);
    }

    return ssmParameters;
  }

  /**
   * Generate environment variables from stack outputs
   */
  private generateEnvVarsFromOutputs(outputs: Record<string, string>): Record<string, string> {
    const envVars: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(outputs)) {
      // Convert camelCase and PascalCase to UPPER_SNAKE_CASE
      const envVarName = key
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .toUpperCase();
      
      envVars[envVarName] = value;
    }

    return envVars;
  }

  /**
   * Generate environment variables from SSM parameters
   */
  private generateEnvVarsFromSSM(ssmParams: Record<string, string>): Record<string, string> {
    const envVars: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(ssmParams)) {
      // Convert parameter names to environment variable format
      const envVarName = key
        .replace(/[^a-zA-Z0-9]/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_|_$/g, '')
        .toUpperCase();
      
      if (envVarName) {
        envVars[envVarName] = value;
      }
    }

    return envVars;
  }

  /**
   * Extract dependencies from stack metadata
   */
  private extractDependencies(stack: Stack): string[] {
    const dependencies: string[] = [];
    
    // Check stack tags for dependency information
    if (stack.Tags) {
      for (const tag of stack.Tags) {
        if (tag.Key === 'Dependencies' && tag.Value) {
          dependencies.push(...tag.Value.split(',').map((d: string) => d.trim()));
        }
      }
    }

    // Check outputs for references to other stacks
    if (stack.Outputs) {
      for (const output of stack.Outputs) {
        if (output.OutputValue && output.OutputValue.includes('arn:aws:cloudformation')) {
          // Extract stack name from CloudFormation ARN
          const arnMatch = output.OutputValue.match(/arn:aws:cloudformation:[^:]+:[^:]+:stack\/([^\/]+)/);
          if (arnMatch && arnMatch[1] && arnMatch[1] !== stack.StackName) {
            dependencies.push(arnMatch[1]);
          }
        }
      }
    }

    return [...new Set(dependencies)]; // Remove duplicates
  }

  /**
   * Check if stack is ready for application deployment
   */
  private isStackReady(stack: Stack): boolean {
    const readyStatuses = [
      'CREATE_COMPLETE',
      'UPDATE_COMPLETE'
    ];

    return readyStatuses.includes(stack.StackStatus || '');
  }

  /**
   * Generate error recommendations based on error type
   */
  private generateErrorRecommendations(error: unknown): string[] {
    if (!error) return [];

    const errorMessage = error instanceof Error ? error.message : String(error);
    const recommendations: string[] = [];

    if (errorMessage.includes('AccessDenied') || errorMessage.includes('UnauthorizedOperation')) {
      recommendations.push(
        'Check that your AWS credentials have CloudFormation:DescribeStacks permission',
        'Verify the correct AWS profile is being used',
        'Ensure the stack exists in the correct AWS account'
      );
    } else if (errorMessage.includes('ValidationError')) {
      recommendations.push(
        'Verify the stack name is correct and exists',
        'Check that you are querying the correct AWS region',
        'Ensure the stack is not in a DELETE_COMPLETE state'
      );
    } else if (errorMessage.includes('does not exist')) {
      recommendations.push(
        'Create the stack first using CDK or CloudFormation',
        'Verify you are connected to the correct AWS account',
        'Check the correct region is specified'
      );
    } else {
      recommendations.push(
        'Check your internet connection',
        'Verify AWS credentials are configured',
        'Try again with a different AWS profile or region'
      );
    }

    return recommendations;
  }

  /**
   * Emit before stack inspection event
   */
  private emitBeforeInspectionEvent(stackName: string, config: AWSProfileConfig): void {
    this.eventBus.emitEvent(
      EventTypes['serverless:before:stack-inspection'],
      {
        stackName,
        region: config.region,
        profile: config.profile
      },
      'StackInspector'
    );
  }

  /**
   * Emit after stack inspection event
   */
  private emitAfterInspectionEvent(stackName: string, requirements: StackRequirements): void {
    this.eventBus.emitEvent(
      EventTypes['serverless:after:stack-inspection'],
      {
        stackName,
        requirements,
        outputsCount: Object.keys(requirements.outputs).length,
        environmentVariablesCount: Object.keys(requirements.environmentVariables).length,
        dependenciesCount: requirements.dependencies.length,
        readyForDeployment: requirements.readyForDeployment
      },
      'StackInspector'
    );
  }

  /**
   * Emit stack inspection error event
   */
  private emitInspectionErrorEvent(stackName: string, error: string): void {
    this.eventBus.emitEvent(
      EventTypes['serverless:stack:inspection:failed'],
      {
        stackName,
        error
      },
      'StackInspector'
    );
  }
}