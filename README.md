# Orcdkestrator Plugin: Serverless

Serverless Framework integration plugin for Orcdkestrator

## Installation

```bash
npm install @orcdkestrator/orcdk-plugin-serverless --save-dev
```

## Configuration

Add to your `orcdk.config.json`:

```json
{
  "plugins": [
    {
      "name": "serverless",
      "enabled": true,
      "config": {
        // Plugin-specific configuration
      }
    }
  ]
}
```

## Usage

See configuration section above and examples directory for detailed usage.

## API Reference

See [API Documentation](docs/api.md) for detailed information.

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| enabled | boolean | true | Enable/disable the plugin |

## Prerequisites

This plugin requires Serverless Framework CLI to be installed:

```bash
npm install -g serverless
```

## How It Works

The plugin integrates Serverless Framework deployments with CDK, enabling hybrid deployments and dependency management.

## Examples

See the [examples directory](docs/examples/) for complete examples.

## Development

```bash
# Clone the repository
git clone https://github.com/orcdkestrator/orcdk-plugin-serverless.git

# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## License

MIT - see [LICENSE](LICENSE) for details.
