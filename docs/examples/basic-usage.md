# Serverless Plugin Examples

## Basic Configuration

```json
{
  "plugins": {
    "@orcdkestrator/serverless": {
      "enabled": true,
      "config": {
        "servicePath": "./serverless"
      }
    }
  }
}
```

## With Stage and Region

```json
{
  "plugins": {
    "@orcdkestrator/serverless": {
      "enabled": true,
      "config": {
        "servicePath": "./serverless",
        "stage": "production",
        "region": "us-east-1",
        "profile": "prod-profile"
      }
    }
  }
}
```

## Custom Config File

```json
{
  "plugins": {
    "@orcdkestrator/serverless": {
      "enabled": true,
      "config": {
        "servicePath": "./services/api",
        "configFile": "serverless.prod.yml",
        "stage": "${STAGE}",
        "region": "${AWS_REGION}"
      }
    }
  }
}
```

## Serverless Configuration Example

```yaml
# serverless.yml
service: my-api-service

provider:
  name: aws
  runtime: nodejs18.x
  stage: ${opt:stage, 'dev'}
  region: ${opt:region, 'us-east-1'}

functions:
  hello:
    handler: handler.hello
    events:
      - http:
          path: hello
          method: get
          cors: true

  createUser:
    handler: handler.createUser
    events:
      - http:
          path: users
          method: post
          cors: true

plugins:
  - serverless-offline
  - serverless-plugin-typescript

custom:
  stage: ${self:provider.stage}
  region: ${self:provider.region}
```

## Integration with CDK

```typescript
// In your CDK stack
export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create resources that Serverless functions will use
    const table = new Table(this, 'UsersTable', {
      partitionKey: { name: 'id', type: AttributeType.STRING }
    });

    // Output the table name for Serverless to use
    new CfnOutput(this, 'UsersTableName', {
      value: table.tableName,
      exportName: 'UsersTableName'
    });
  }
}
```

## Usage

```bash
# Deploy CDK stack and Serverless service
orcdk deploy

# The plugin will:
# 1. Deploy your CDK stack first
# 2. Then deploy the Serverless service
# 3. Serverless can reference CDK outputs via CloudFormation imports
```
