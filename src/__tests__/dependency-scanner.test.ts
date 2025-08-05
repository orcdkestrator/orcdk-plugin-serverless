import { ServerlessDependencyScanner } from '../dependency-scanner';
import { EventBus } from '@orcdkestrator/core';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    stat: jest.fn()
  }
}));
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
      'serverless:dependency:detected': 'serverless:dependency:detected'
    }
  };
});

describe('ServerlessDependencyScanner', () => {
  let scanner: ServerlessDependencyScanner;
  let mockEventBus: any;
  
  beforeEach(() => {
    jest.clearAllMocks();
    scanner = new ServerlessDependencyScanner();
    mockEventBus = EventBus.getInstance();
    // Mock fs.promises.stat for all tests
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 } as any);
  });
  
  describe('when scanning SSM references', () => {
    it('should detect simple SSM parameter references', async () => {
      // Given serverless.yml with SSM reference
      const yamlContent = `
service: my-service
custom:
  vpcId: \${ssm:/vpc-stack/vpc-id}
provider:
  environment:
    VPC_ID: \${self:custom.vpcId}
`;
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(yamlContent);
      
      // When scanning
      const deps = await scanner.scanDependencies('serverless.yml');
      
      // Then find vpc-stack dependency
      expect(deps).toContain('vpc-stack');
    });
    
    it('should handle stage interpolation in SSM paths', async () => {
      // Given SSM with stage interpolation
      const yamlContent = `
service: my-service
provider:
  stage: \${opt:stage, 'dev'}
custom:
  dbHost: \${ssm:/\${self:provider.stage}/rds-stack/endpoint}
  apiUrl: \${ssm:/\${opt:stage}/api-stack/url}
`;
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(yamlContent);
      
      // When scanning
      const deps = await scanner.scanDependencies('serverless.yml');
      
      // Then extract stack names
      expect(deps).toContain('rds-stack');
      expect(deps).toContain('api-stack');
    });
    
    it('should handle complex interpolation patterns', async () => {
      // Given complex SSM paths
      const yamlContent = `
custom:
  stage: \${opt:stage, 'dev'}
  region: \${opt:region, 'us-east-1'}
  ssmPath1: \${ssm:/\${self:custom.stage}/\${self:custom.region}/vpc-stack/subnet-id}
  ssmPath2: \${ssm:/shared/cognito-stack/user-pool-id}
  ssmPath3: \${ssm:/\${self:custom.stage}-api-gateway-stack/rest-api-id}
`;
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(yamlContent);
      
      // When scanning
      const deps = await scanner.scanDependencies('serverless.yml');
      
      // Then extract all stack references
      expect(deps).toContain('vpc-stack');
      expect(deps).toContain('cognito-stack');
      expect(deps).toContain('api-gateway-stack');
    });
    
    it('should emit dependency detection events', async () => {
      // Given SSM reference
      const yamlContent = `
custom:
  vpcId: \${ssm:/vpc-stack/vpc-id}
`;
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(yamlContent);
      
      // When scanning
      await scanner.scanDependencies('serverless.yml');
      
      // Then emit with details
      expect(mockEventBus.emitEvent).toHaveBeenCalledWith(
        'serverless:dependency:detected',
        expect.objectContaining({
          type: 'ssm',
          source: 'serverless.yml',
          target: 'vpc-stack'
        }),
        'ServerlessDependencyScanner'
      );
    });
    
    it('should handle SSM references in different sections', async () => {
      // Given SSM in various locations
      const yamlContent = `
provider:
  vpc:
    subnetIds:
      - \${ssm:/vpc-stack/private-subnet-1}
      - \${ssm:/vpc-stack/private-subnet-2}
    
functions:
  hello:
    environment:
      DB_HOST: \${ssm:/rds-stack/endpoint}
      
resources:
  Resources:
    MyBucket:
      Properties:
        BucketName: \${ssm:/s3-stack/bucket-name}
`;
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(yamlContent);
      
      // When scanning
      const deps = await scanner.scanDependencies('serverless.yml');
      
      // Then find all dependencies
      expect(deps).toContain('vpc-stack');
      expect(deps).toContain('rds-stack');
      expect(deps).toContain('s3-stack');
    });
  });
  
  describe('when scanning CloudFormation imports', () => {
    it('should detect CF import references', async () => {
      // Given CF import
      const yamlContent = `
service: my-service
custom:
  apiUrl: \${cf:api-gateway-stack.RestApiUrl}
  userPoolId: \${cf:cognito-stack.UserPoolId}
provider:
  environment:
    API_ENDPOINT: \${self:custom.apiUrl}
`;
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(yamlContent);
      
      // When scanning
      const deps = await scanner.scanDependencies('serverless.yml');
      
      // Then find dependencies
      expect(deps).toContain('api-gateway-stack');
      expect(deps).toContain('cognito-stack');
    });
    
    it('should handle CF imports with stage interpolation', async () => {
      // Given CF with interpolated stack names
      const yamlContent = `
provider:
  stage: \${opt:stage, 'dev'}
custom:
  apiUrl: \${cf:\${self:provider.stage}-api-stack.RestApiUrl}
  tableArn: \${cf:dynamodb-\${self:provider.stage}-stack.TableArn}
`;
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(yamlContent);
      
      // When scanning
      const deps = await scanner.scanDependencies('serverless.yml');
      
      // Then extract base stack names
      expect(deps).toContain('api-stack');
      expect(deps).toContain('dynamodb-stack');
    });
    
    it('should emit CF dependency events', async () => {
      // Given CF import
      const yamlContent = `
custom:
  apiUrl: \${cf:api-gateway-stack.RestApiUrl}
`;
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(yamlContent);
      
      // When scanning
      await scanner.scanDependencies('serverless.yml');
      
      // Then emit with CF type
      expect(mockEventBus.emitEvent).toHaveBeenCalledWith(
        'serverless:dependency:detected',
        expect.objectContaining({
          type: 'cloudformation',
          source: 'serverless.yml',
          target: 'api-gateway-stack',
          outputName: 'RestApiUrl'
        }),
        'ServerlessDependencyScanner'
      );
    });
  });
  
  describe('when handling edge cases', () => {
    it('should not detect dependencies from non-SSM/CF references', async () => {
      // Given other variable types
      const yamlContent = `
custom:
  stage: \${opt:stage}
  region: \${env:AWS_REGION}
  accountId: \${aws:accountId}
  timestamp: \${sls:instanceId}
`;
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(yamlContent);
      
      // When scanning
      const deps = await scanner.scanDependencies('serverless.yml');
      
      // Then no dependencies found
      expect(deps).toHaveLength(0);
    });
    
    it('should handle malformed references gracefully', async () => {
      // Given malformed references
      const yamlContent = `
custom:
  broken1: \${ssm:}
  broken2: \${ssm:/}
  broken3: \${cf:}
  broken4: \${cf:stack}
`;
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(yamlContent);
      
      // When scanning
      const deps = await scanner.scanDependencies('serverless.yml');
      
      // Then no crash, minimal dependencies
      expect(deps).toEqual([]);
    });
    
    it('should deduplicate dependencies', async () => {
      // Given repeated references
      const yamlContent = `
custom:
  vpcId1: \${ssm:/vpc-stack/vpc-id}
  vpcId2: \${ssm:/vpc-stack/subnet-1}
  vpcId3: \${ssm:/vpc-stack/subnet-2}
provider:
  vpc:
    id: \${cf:vpc-stack.VpcId}
`;
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(yamlContent);
      
      // When scanning
      const deps = await scanner.scanDependencies('serverless.yml');
      
      // Then vpc-stack appears only once
      expect(deps).toEqual(['vpc-stack']);
    });
    
    it('should extract stack names from various SSM path patterns', async () => {
      // Given various SSM path patterns
      const yamlContent = `
custom:
  # Pattern: /stack-name/param
  pattern1: \${ssm:/vpc-stack/vpc-id}
  # Pattern: /stage/stack-name/param
  pattern2: \${ssm:/dev/rds-stack/endpoint}
  # Pattern: /app/stack/param
  pattern3: \${ssm:/myapp/api-gateway-stack/url}
  # Pattern: /param (no clear stack reference)
  pattern4: \${ssm:/global-param}
`;
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(yamlContent);
      
      // When scanning
      const deps = await scanner.scanDependencies('serverless.yml');
      
      // Then extract meaningful stack names
      expect(deps).toContain('vpc-stack');
      expect(deps).toContain('rds-stack');
      expect(deps).toContain('api-gateway-stack');
      // 'global-param' might be included as fallback
    });
  });
  
  describe('when file operations fail', () => {
    it('should handle file read errors gracefully', async () => {
      // Given file read error
      jest.spyOn(fs.promises, 'readFile').mockRejectedValue(new Error('File not found'));
      
      // When scanning
      const deps = await scanner.scanDependencies('serverless.yml');
      
      // Then return empty array
      expect(deps).toEqual([]);
    });
    
    it('should handle invalid YAML gracefully', async () => {
      // Given invalid YAML
      const invalidYaml = `
invalid: yaml: content:
  bad indentation:
`;
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(invalidYaml);
      
      // When scanning
      const deps = await scanner.scanDependencies('serverless.yml');
      
      // Then return empty array
      expect(deps).toEqual([]);
    });
  });
});