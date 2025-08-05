import { spawn } from 'child_process';

/**
 * Wrapper for Serverless Framework CLI
 */
export class ServerlessCLI {
  /**
   * Check if Serverless CLI is installed
   */
  async hasServerlessCLI(): Promise<boolean> {
    try {
      await this.execute(['--version']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Package a Serverless service
   */
  async package(servicePath: string, stage: string, region?: string): Promise<void> {
    const args = ['package', '--stage', stage];
    
    if (region) {
      args.push('--region', region);
    }
    
    await this.execute(args, { cwd: servicePath });
  }

  /**
   * Deploy a Serverless service
   */
  async deploy(servicePath: string, stage: string, region?: string): Promise<void> {
    const args = ['deploy', '--stage', stage];
    
    if (region) {
      args.push('--region', region);
    }
    
    await this.execute(args, { cwd: servicePath });
  }

  /**
   * Remove a Serverless service
   */
  async remove(servicePath: string, stage: string, region?: string): Promise<void> {
    const args = ['remove', '--stage', stage];
    
    if (region) {
      args.push('--region', region);
    }
    
    await this.execute(args, { cwd: servicePath });
  }

  /**
   * Get service info
   */
  async info(servicePath: string, stage: string): Promise<string> {
    const args = ['info', '--stage', stage, '--verbose'];
    return this.execute(args, { cwd: servicePath });
  }

  /**
   * Execute serverless command
   */
  private execute(args: string[], options?: { cwd?: string }): Promise<string> {
    return new Promise((resolve, reject) => {
      const serverlessCmd = process.platform === 'win32' ? 'serverless.cmd' : 'serverless';
      
      const proc = spawn(serverlessCmd, args, {
        ...options,
        stdio: ['inherit', 'pipe', 'pipe']
        // shell: false is the default and prevents command injection
      });
      
      let stdout = '';
      let stderr = '';
      
      if (proc.stdout) {
        proc.stdout.on('data', (data) => {
          const str = data.toString();
          stdout += str;
          process.stdout.write(str);
        });
      }
      
      if (proc.stderr) {
        proc.stderr.on('data', (data) => {
          const str = data.toString();
          stderr += str;
          process.stderr.write(str);
        });
      }
      
      proc.on('error', reject);
      
      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Serverless command failed with code ${code}: ${stderr}`));
        }
      });
    });
  }
}