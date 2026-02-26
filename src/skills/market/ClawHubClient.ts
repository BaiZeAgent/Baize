/**
 * ClawHub 技能市场客户端
 * 
 * 从 ClawHub (https://clawhub.ai) 搜索和安装技能
 * 
 * 功能：
 * 1. 搜索技能
 * 2. 下载技能包
 * 3. 解压到 skills 目录
 * 4. 安全验证
 * 
 * 注意：不进行代码转换，技能必须包含实现文件 (main.js/main.py/run.sh)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as zlib from 'zlib';
import { spawn, exec } from 'child_process';
import { getLogger } from '../../observability/logger';

const logger = getLogger('skill:clawhub');

/**
 * ClawHub API 响应类型
 */
interface ClawHubSearchResponse {
  results: Array<{
    slug: string;
    displayName: string;
    summary: string | null;
    version: string | null;
    score: number;
    updatedAt?: number;
  }>;
}

interface ClawHubSkillResponse {
  skill: {
    slug: string;
    displayName: string;
    summary: string | null;
    tags: Record<string, string>;
    stats: {
      downloads: number;
      stars: number;
    };
    createdAt: number;
    updatedAt: number;
  };
  latestVersion: {
    version: string;
    createdAt: number;
    changelog: string;
  } | null;
  owner: {
    handle: string | null;
    displayName: string | null;
  } | null;
}

/**
 * 搜索结果
 */
export interface ClawHubSearchResult {
  slug: string;
  displayName: string;
  summary: string;
  version: string;
  score: number;
}

/**
 * 安装结果
 */
export interface ClawHubInstallResult {
  success: boolean;
  path?: string;
  message?: string;
  error?: string;
  warnings?: string[];
  requiredEnv?: string[];
}

/**
 * ClawHub 客户端
 */
export class ClawHubClient {
  private endpoint: string;
  private skillsDir: string;

  constructor(skillsDir: string = 'skills', endpoint: string = 'https://clawhub.ai') {
    this.endpoint = endpoint;
    this.skillsDir = skillsDir;
    
    // 确保 skills 目录存在
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }
  }

  /**
   * 搜索技能
   */
  async search(query: string, limit: number = 10): Promise<ClawHubSearchResult[]> {
    logger.info('搜索技能', { query, limit });

    try {
      const url = `${this.endpoint}/api/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`;
      const response = await this.httpGet(url);
      const data = JSON.parse(response) as ClawHubSearchResponse;

      return (data.results || []).map(item => ({
        slug: item.slug,
        displayName: item.displayName,
        summary: item.summary || '',
        version: item.version || 'unknown',
        score: item.score,
      }));
    } catch (error) {
      logger.error('搜索失败', { error });
      return [];
    }
  }

  /**
   * 获取技能详情
   */
  async getSkillDetails(slug: string): Promise<ClawHubSkillResponse | null> {
    try {
      const url = `${this.endpoint}/api/v1/skills/${slug}`;
      const response = await this.httpGet(url);
      return JSON.parse(response) as ClawHubSkillResponse;
    } catch (error) {
      logger.error('获取技能详情失败', { slug, error });
      return null;
    }
  }

  /**
   * 安装技能
   * 
   * 流程：
   * 1. 获取技能信息
   * 2. 下载技能包
   * 3. 解压到 skills 目录
   * 4. 检查是否有实现文件
   * 5. 安装依赖
   */
  async install(slug: string, version?: string): Promise<ClawHubInstallResult> {
    logger.info('安装技能', { slug, version });

    const warnings: string[] = [];
    const requiredEnv: string[] = [];

    try {
      // 1. 获取技能信息
      const details = await this.getSkillDetails(slug);
      if (!details) {
        return { success: false, error: '技能不存在' };
      }

      // 2. 确定版本
      const targetVersion = version || details.latestVersion?.version;
      if (!targetVersion) {
        return { success: false, error: '无法确定版本' };
      }

      // 3. 下载技能包
      const downloadResult = await this.downloadZip(slug, targetVersion);
      if (!downloadResult.buffer) {
        return { success: false, error: downloadResult.error || '下载失败' };
      }

      // 4. 解析 ZIP
      const files = this.parseZip(downloadResult.buffer);
      if (files.size === 0) {
        return { success: false, error: 'ZIP 解析失败：文件为空' };
      }

      // 5. 检查技能类型
      const hasMainJs = files.has('main.js');
      const hasMainPy = files.has('main.py');
      const hasRunSh = files.has('run.sh');
      const hasImplementation = hasMainJs || hasMainPy || hasRunSh;

      // 获取 SKILL.md 内容
      const skillMdFile = files.get('SKILL.md') || files.get('skill.md');
      const skillDoc = skillMdFile ? skillMdFile.toString('utf-8') : '';
      
      // 检查是否有 curl 命令（文档型技能）
      const hasCurlCommand = /```bash\n[\s\S]*curl[\s\S]*```/.test(skillDoc);

      // 根据技能类型给出提示
      if (!hasImplementation && !hasCurlCommand) {
        warnings.push('⚠️ 此技能缺少实现文件，可能无法正常工作');
        warnings.push('建议：联系技能作者或等待更新');
      } else if (!hasImplementation && hasCurlCommand) {
        warnings.push('📄 文档型技能：通过 curl 命令执行');
        warnings.push('适用场景：简单的 API 调用');
        warnings.push('风险：依赖外部 API 可用性');
      } else if (hasRunSh && !hasMainJs && !hasMainPy) {
        warnings.push('🔧 Shell 技能：需要 bash 环境');
        warnings.push('风险：平台相关，Windows 可能需要 WSL');
      } else if (hasMainPy) {
        warnings.push('🐍 Python 技能：需要 Python 环境');
        warnings.push('风险：依赖 Python 版本和包');
      }

      // 6. 创建技能目录
      const skillDir = path.join(this.skillsDir, slug);
      if (fs.existsSync(skillDir)) {
        // 删除旧版本
        fs.rmSync(skillDir, { recursive: true, force: true });
      }
      fs.mkdirSync(skillDir, { recursive: true });

      // 7. 写入文件
      for (const [filename, content] of files) {
        if (filename === '_meta.json') continue;

        const filePath = path.join(skillDir, filename);
        const dir = path.dirname(filePath);

        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, content);
        logger.debug('写入文件', { path: filePath, size: content.length });
      }

      // 8. 检查 SKILL.md
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) {
        // 检查是否有小写的 skill.md
        const skillMdLower = path.join(skillDir, 'skill.md');
        if (fs.existsSync(skillMdLower)) {
          // 重命名为大写
          fs.renameSync(skillMdLower, skillMdPath);
        } else {
          warnings.push('技能缺少 SKILL.md 定义文件');
        }
      }

      // 9. 提取环境变量要求
      const skillMdContent = this.readFileIfExists(skillMdPath);
      if (skillMdContent) {
        const envMatch = skillMdContent.match(/required_env:\s*\n([\s\S]*?)(?=\n\w+:|\n---|$)/);
        if (envMatch) {
          const envLines = envMatch[1].match(/-\s+(\S+)/g);
          if (envLines) {
            for (const line of envLines) {
              const env = line.replace(/-\s+/, '').trim();
              if (env) requiredEnv.push(env);
            }
          }
        }
      }

      // 10. 安装依赖
      const depWarnings = await this.installDependencies(skillDir, files);
      warnings.push(...depWarnings);

      // 11. 执行初始化命令
      if (skillMdContent) {
        const setup = this.extractSetupInstructions(skillMdContent);
        if (setup.commands.length > 0) {
          const setupWarnings = await this.runSetupCommands(skillDir, setup.commands);
          warnings.push(...setupWarnings);
        }
      }

      logger.info('技能安装成功', {
        slug,
        version: targetVersion,
        path: skillDir,
        fileCount: files.size,
        hasMainJs,
        hasMainPy,
        hasRunSh,
        hasCurlCommand,
      });

      // 构建结果消息
      let message = `技能 ${slug}@${targetVersion} 安装成功`;
      message += `\n- 文件数: ${files.size}`;
      
      if (hasImplementation) {
        message += `\n- 实现: ${hasMainJs ? 'JavaScript' : hasMainPy ? 'Python' : 'Shell'}`;
      } else if (hasCurlCommand) {
        message += `\n- 实现: 文档型 (curl 命令)`;
      }
      
      if (warnings.length > 0) {
        message += `\n\n提示:\n${warnings.map(w => `- ${w}`).join('\n')}`;
      }
      if (requiredEnv.length > 0) {
        message += `\n\n需要配置环境变量:\n${requiredEnv.map(e => `- ${e}`).join('\n')}`;
      }

      return {
        success: true,
        path: skillDir,
        message,
        warnings: warnings.length > 0 ? warnings : undefined,
        requiredEnv: requiredEnv.length > 0 ? requiredEnv : undefined,
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('技能安装失败', { slug, error: errorMsg });
      return {
        success: false,
        error: errorMsg,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }
  }

  /**
   * 卸载技能
   */
  async uninstall(slug: string): Promise<ClawHubInstallResult> {
    logger.info('卸载技能', { slug });

    try {
      const skillDir = path.join(this.skillsDir, slug);

      if (!fs.existsSync(skillDir)) {
        return { success: false, error: '技能未安装' };
      }

      // 删除技能目录
      fs.rmSync(skillDir, { recursive: true, force: true });

      logger.info('技能卸载成功', { slug, path: skillDir });

      return {
        success: true,
        path: skillDir,
        message: `技能 ${slug} 已卸载`,
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('技能卸载失败', { slug, error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }

  /**
   * 下载技能 ZIP 包
   */
  private async downloadZip(slug: string, version: string): Promise<{ buffer: Buffer | null; error?: string }> {
    const url = `${this.endpoint}/api/v1/download?slug=${slug}&version=${version}`;
    logger.debug('下载 ZIP', { url });

    // 最多重试 3 次
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) {
        const delay = attempt * 2000;
        logger.info(`等待 ${delay / 1000} 秒后重试...`, { attempt });
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const result = await this.downloadOnce(url, 0);

      if (result.buffer) {
        return { buffer: result.buffer };
      }

      if (result.rateLimited) {
        logger.warn(`速率限制，第 ${attempt} 次重试`);
        continue;
      }

      return { buffer: null, error: result.error };
    }

    return { buffer: null, error: '下载失败：请求过于频繁，请稍后再试' };
  }

  /**
   * 单次下载尝试
   */
  private downloadOnce(
    url: string,
    redirectCount: number
  ): Promise<{ buffer: Buffer | null; rateLimited?: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (redirectCount > 5) {
        resolve({ buffer: null, error: '重定向次数过多' });
        return;
      }

      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;

      protocol.get(url, {
        headers: {
          'Accept': 'application/zip, */*',
          'User-Agent': 'Baize/3.0',
        },
      }, (res) => {
        // 处理速率限制
        if (res.statusCode === 429) {
          resolve({ buffer: null, rateLimited: true, error: '请求过于频繁' });
          return;
        }

        // 处理重定向
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          const location = res.headers.location;
          if (location) {
            this.downloadOnce(location, redirectCount + 1).then(resolve);
            return;
          }
        }

        if (res.statusCode !== 200) {
          resolve({ buffer: null, error: `HTTP ${res.statusCode}` });
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', chunk => {
          if (Buffer.isBuffer(chunk)) {
            chunks.push(chunk);
          } else {
            chunks.push(Buffer.from(chunk));
          }
        });
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          logger.debug('下载完成', { size: buffer.length });
          resolve({ buffer });
        });
        res.on('error', (error) => {
          resolve({ buffer: null, error: error.message });
        });
      }).on('error', (error) => {
        resolve({ buffer: null, error: error.message });
      });
    });
  }

  /**
   * 解析 ZIP 文件
   */
  private parseZip(buffer: Buffer): Map<string, Buffer> {
    const files = new Map<string, Buffer>();

    try {
      // 检查 ZIP 签名
      if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
        logger.error('无效的 ZIP 文件签名');
        return files;
      }

      // 简单的 ZIP 解析（支持 deflate 和 store）
      let offset = 0;

      while (offset < buffer.length - 4) {
        const signature = buffer.readUInt32LE(offset);

        if (signature !== 0x04034b50) {
          break;
        }

        const compressionMethod = buffer.readUInt16LE(offset + 8);
        const compressedSize = buffer.readUInt32LE(offset + 18);
        const uncompressedSize = buffer.readUInt32LE(offset + 22);
        const filenameLength = buffer.readUInt16LE(offset + 26);
        const extraFieldLength = buffer.readUInt16LE(offset + 28);

        const filename = buffer.toString('utf8', offset + 30, offset + 30 + filenameLength);
        const dataStart = offset + 30 + filenameLength + extraFieldLength;
        const dataEnd = dataStart + compressedSize;

        if (dataEnd > buffer.length) {
          break;
        }

        const compressedData = buffer.slice(dataStart, dataEnd);

        let content: Buffer;
        if (compressionMethod === 0) {
          // Store (无压缩)
          content = compressedData;
        } else if (compressionMethod === 8) {
          // Deflate
          content = zlib.inflateRawSync(compressedData);
        } else {
          logger.warn('不支持的压缩方法', { filename, compressionMethod });
          offset = dataEnd;
          continue;
        }

        // 只保留文件，跳过目录
        if (!filename.endsWith('/')) {
          files.set(filename, content);
        }

        offset = dataEnd;
      }

      logger.info('ZIP 解析完成', { fileCount: files.size });

    } catch (error) {
      logger.error('ZIP 解析失败', { error });
    }

    return files;
  }

  /**
   * 安装依赖
   */
  private async installDependencies(skillDir: string, files: Map<string, Buffer>): Promise<string[]> {
    const warnings: string[] = [];

    // 检查 package.json
    if (files.has('package.json')) {
      const packageJsonPath = path.join(skillDir, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          if (packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0) {
            logger.info('安装 npm 依赖', { skillDir });
            
            await new Promise<void>((resolve) => {
              const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
              const proc = spawn(npm, ['install', '--production'], {
                cwd: skillDir,
                shell: process.platform === 'win32',
                timeout: 60000,
              });

              proc.on('close', () => resolve());
              proc.on('error', () => resolve());
            });
          }
        } catch (error) {
          warnings.push('npm 依赖安装失败，请手动安装');
        }
      }
    }

    // 检查 requirements.txt
    if (files.has('requirements.txt')) {
      warnings.push('检测到 Python 依赖，请手动安装: pip install -r requirements.txt');
    }

    return warnings;
  }

  /**
   * 执行初始化命令
   */
  private async runSetupCommands(skillDir: string, commands: string[]): Promise<string[]> {
    const warnings: string[] = [];

    for (const cmd of commands) {
      try {
        logger.info('执行初始化命令', { cmd });
        
        await new Promise<void>((resolve) => {
          exec(cmd, {
            cwd: skillDir,
            timeout: 30000,
          }, (error) => {
            if (error) {
              warnings.push(`初始化命令失败: ${cmd}`);
            }
            resolve();
          });
        });
      } catch (error) {
        warnings.push(`初始化命令失败: ${cmd}`);
      }
    }

    return warnings;
  }

  /**
   * 从 SKILL.md 提取初始化说明
   */
  private extractSetupInstructions(content: string): { commands: string[]; requiredEnv: string[] } {
    const commands: string[] = [];
    const requiredEnv: string[] = [];

    // 提取环境变量
    const envMatch = content.match(/required_env:\s*\n([\s\S]*?)(?=\n\w+:|\n---|$)/);
    if (envMatch) {
      const envLines = envMatch[1].match(/-\s+(\S+)/g);
      if (envLines) {
        for (const line of envLines) {
          const env = line.replace(/-\s+/, '').trim();
          if (env) requiredEnv.push(env);
        }
      }
    }

    // 提取初始化命令
    const setupMatch = content.match(/```bash\n# Setup[\s\S]*?```/);
    if (setupMatch) {
      const setupContent = setupMatch[0];
      const cmdMatches = setupContent.matchAll(/^(?!#)\s*(\S+.*)$/gm);
      for (const match of cmdMatches) {
        const cmd = match[1].trim();
        if (cmd && !cmd.startsWith('#')) {
          commands.push(cmd);
        }
      }
    }

    return { commands, requiredEnv };
  }

  /**
   * HTTP GET 请求
   */
  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;

      protocol.get(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Baize/3.0',
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * 读取文件（如果存在）
   */
  private readFileIfExists(filePath: string): string | null {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8');
      }
    } catch {
      // ignore
    }
    return null;
  }
}

// 全局实例
let clientInstance: ClawHubClient | null = null;

/**
 * 获取 ClawHub 客户端
 */
export function getClawHubClient(skillsDir?: string): ClawHubClient {
  if (!clientInstance) {
    clientInstance = new ClawHubClient(skillsDir);
  }
  return clientInstance;
}
