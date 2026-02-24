/**
 * ClawHub 技能市场客户端
 * 
 * 从 ClawHub (https://clawhub.ai) 搜索和安装技能
 * 自动转换为白泽格式
 * 如果技能没有 input_schema，使用 LLM 自动提取
 * 自动处理技能初始化（依赖安装、环境配置）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as zlib from 'zlib';
import { spawn, exec } from 'child_process';
import { getLogger } from '../../observability/logger';
import { getLLMManager } from '../../llm';

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
 * 提取的 input_schema
 */
interface ExtractedInputSchema {
  type: string;
  properties: Record<string, {
    type: string;
    description: string;
  }>;
  required: string[];
}

/**
 * ClawHub 客户端
 */
export class ClawHubClient {
  private endpoint: string;
  private skillsDir: string;

  constructor(options: { endpoint?: string; skillsDir?: string } = {}) {
    this.endpoint = options.endpoint || 'https://clawhub.ai';
    this.skillsDir = options.skillsDir || 'skills';
    logger.info('ClawHub 客户端初始化', { endpoint: this.endpoint });
  }

  /**
   * 发送 HTTP 请求
   */
  private async request<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      https.get(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Baize/3.0',
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as T);
          } catch (e) {
            reject(new Error(`解析响应失败: ${data.substring(0, 100)}`));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * 搜索技能
   */
  async search(query: string, limit: number = 10): Promise<ClawHubSearchResult[]> {
    logger.debug('搜索技能', { query });

    const url = `${this.endpoint}/api/v1/search?q=${encodeURIComponent(query)}`;

    try {
      const response = await this.request<ClawHubSearchResponse>(url);

      return response.results.slice(0, limit).map(result => ({
        slug: result.slug,
        displayName: result.displayName,
        summary: result.summary || '',
        version: result.version || '',
        score: result.score,
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
    logger.debug('获取技能详情', { slug });

    const url = `${this.endpoint}/api/v1/skills/${slug}`;

    try {
      return await this.request<ClawHubSkillResponse>(url);
    } catch (error) {
      logger.error('获取详情失败', { error });
      return null;
    }
  }

  /**
   * 下载技能 ZIP 包
   */
  private async downloadZip(slug: string, version: string): Promise<Buffer | null> {
    const url = `${this.endpoint}/api/v1/download?slug=${slug}&version=${version}`;

    return new Promise((resolve) => {
      https.get(url, {
        headers: {
          'Accept': 'application/zip, */*',
          'User-Agent': 'Baize/3.0',
        },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', (error) => {
        logger.error('下载 ZIP 失败', { error });
        resolve(null);
      });
    });
  }

  /**
   * 解析 ZIP 文件
   */
  private parseZip(buffer: Buffer): Map<string, Buffer> {
    const files = new Map<string, Buffer>();
    
    try {
      let offset = 0;
      
      const endOfCentralDir = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      if (endOfCentralDir === -1) {
        logger.error('无效的 ZIP 文件');
        return files;
      }

      const centralDirOffset = buffer.readUInt32LE(endOfCentralDir + 16);
      const centralDirSize = buffer.readUInt32LE(endOfCentralDir + 12);
      
      offset = centralDirOffset;
      const centralDirEnd = centralDirOffset + centralDirSize;
      
      while (offset < centralDirEnd) {
        if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
        
        const compressionMethod = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const filenameLength = buffer.readUInt16LE(offset + 28);
        const extraFieldLength = buffer.readUInt16LE(offset + 30);
        const fileCommentLength = buffer.readUInt16LE(offset + 32);
        const localHeaderOffset = buffer.readUInt32LE(offset + 42);
        
        const filename = buffer.toString('utf8', offset + 46, offset + 46 + filenameLength);
        
        const localOffset = localHeaderOffset;
        const localFilenameLength = buffer.readUInt16LE(localOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localOffset + 28);
        const dataOffset = localOffset + 30 + localFilenameLength + localExtraLength;
        
        const compressedData = buffer.slice(dataOffset, dataOffset + compressedSize);
        
        let fileData: Buffer;
        if (compressionMethod === 0) {
          fileData = compressedData;
        } else if (compressionMethod === 8) {
          fileData = zlib.inflateRawSync(compressedData);
        } else {
          logger.warn('不支持的压缩方法', { compressionMethod, filename });
          offset += 46 + filenameLength + extraFieldLength + fileCommentLength;
          continue;
        }
        
        files.set(filename, fileData);
        
        offset += 46 + filenameLength + extraFieldLength + fileCommentLength;
      }
    } catch (error) {
      logger.error('解析 ZIP 失败', { error });
    }
    
    return files;
  }

  /**
   * 使用 LLM 从文档和脚本中提取 input_schema
   */
  private async extractInputSchema(
    skillDoc: string, 
    skillName: string,
    scriptContents: string[]
  ): Promise<ExtractedInputSchema | null> {
    try {
      const llm = getLLMManager();
      
      // 构建分析内容
      let analysisContent = skillDoc;
      if (scriptContents.length > 0) {
        analysisContent += `\n\n## 脚本代码\n\n`;
        for (let i = 0; i < scriptContents.length; i++) {
          const ext = scriptContents[i].includes('def ') ? 'python' : 'javascript';
          analysisContent += `### 脚本 ${i + 1}\n\`\`\`${ext}\n${scriptContents[i]}\n\`\`\`\n\n`;
        }
      }
      
      const response = await llm.chat([
        {
          role: 'system',
          content: `你是一个技能参数分析器。分析技能文档和代码，提取输入参数的 JSON Schema。

输出格式（只输出 JSON，不要其他内容）：
{
  "type": "object",
  "properties": {
    "参数名": {
      "type": "string|number|boolean",
      "description": "参数描述"
    }
  },
  "required": ["必需参数列表"]
}

规则：
1. 从 curl 命令中识别可变部分作为参数
2. 从 JavaScript/Python 代码中识别函数参数
3. 例如 main(params) 中的 params 解构出的变量就是参数
4. 例如 const { action, path } = params 表示 action 和 path 是参数
5. 从命令行参数中识别，如 ./search.js "query" -n 10 中的 query 和 n
6. 如果文档中没有明确的参数，返回空对象 {"type": "object", "properties": {}, "required": []}
7. 只输出 JSON，不要其他内容`
        },
        {
          role: 'user',
          content: `请分析以下技能文档和代码，提取 input_schema：

技能名称: ${skillName}

${analysisContent}`
        }
      ], { temperature: 0.1 });

      // 解析 JSON
      const content = response.content.trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        logger.warn('LLM 未返回有效的 JSON', { skillName });
        return null;
      }

      const schema = JSON.parse(jsonMatch[0]) as ExtractedInputSchema;
      logger.info('LLM 提取 input_schema 成功', { 
        skillName, 
        properties: Object.keys(schema.properties || {}),
        required: schema.required 
      });
      
      return schema;
    } catch (error) {
      logger.error('LLM 提取 input_schema 失败', { error, skillName });
      return null;
    }
  }

  /**
   * 从文档中提取初始化说明
   */
  private extractSetupInstructions(skillDoc: string): {
    commands: string[];
    requiredEnv: string[];
  } {
    const commands: string[] = [];
    const requiredEnv: string[] = [];

    // 提取 Setup 部分
    const setupMatch = skillDoc.match(/##\s*Setup[\s\S]*?(?=##|$)/i);
    if (setupMatch) {
      const setupSection = setupMatch[0];
      
      // 提取 bash 命令
      const bashMatches = setupSection.matchAll(/```bash\n([\s\S]*?)```/g);
      for (const match of bashMatches) {
        const cmd = match[1].trim();
        // 过滤掉一些不需要自动执行的命令
        if (!cmd.includes('sudo') && !cmd.includes('rm ')) {
          commands.push(cmd);
        }
      }
    }

    // 提取环境变量要求
    const envMatch = skillDoc.match(/Needs?\s*env:\s*`([^`]+)`/i);
    if (envMatch) {
      requiredEnv.push(envMatch[1]);
    }

    // 从 frontmatter 提取 required_env
    const frontmatterEnv = skillDoc.match(/required_env:\s*\n(\s+-\s+.+\n)+/);
    if (frontmatterEnv) {
      const envLines = frontmatterEnv[0].match(/-\s+(.+)/g);
      if (envLines) {
        for (const line of envLines) {
          const envName = line.replace(/-\s+/, '').trim();
          if (!requiredEnv.includes(envName)) {
            requiredEnv.push(envName);
          }
        }
      }
    }

    return { commands, requiredEnv };
  }

  /**
   * 执行初始化命令
   */
  private async runSetupCommands(skillDir: string, commands: string[]): Promise<string[]> {
    const warnings: string[] = [];

    for (const cmd of commands) {
      logger.info('执行初始化命令', { cmd });
      
      try {
        await new Promise<void>((resolve, reject) => {
          exec(cmd, { 
            cwd: skillDir,
            timeout: 120000 // 2分钟超时
          }, (error, stdout, stderr) => {
            if (error) {
              logger.warn('初始化命令失败', { cmd, error: error.message });
              warnings.push(`初始化命令失败: ${cmd} - ${error.message}`);
              resolve(); // 不中断，继续
            } else {
              logger.debug('初始化命令完成', { cmd, stdout: stdout.substring(0, 100) });
              resolve();
            }
          });
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        warnings.push(`初始化命令异常: ${cmd} - ${errorMsg}`);
      }
    }

    return warnings;
  }

  /**
   * 安装技能依赖
   */
  private async installDependencies(skillDir: string, files: Map<string, Buffer>): Promise<string[]> {
    const warnings: string[] = [];

    // 检查 package.json
    if (files.has('package.json')) {
      logger.info('检测到 package.json，安装 Node.js 依赖');
      
      try {
        await new Promise<void>((resolve) => {
          const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
          const proc = spawn(npmCmd, ['install'], {
            cwd: skillDir,
            stdio: 'pipe',
            shell: process.platform === 'win32',
          });

          let stderr = '';
          proc.stderr?.on('data', (data) => {
            stderr += data.toString();
          });

          proc.on('close', (code) => {
            if (code !== 0) {
              logger.warn('npm install 失败', { code, stderr });
              warnings.push(`npm install 失败 (退出码: ${code})`);
            } else {
              logger.info('npm install 完成');
            }
            resolve();
          });

          proc.on('error', (error) => {
            logger.warn('npm install 异常', { error: error.message });
            warnings.push(`npm install 异常: ${error.message}`);
            resolve();
          });

          // 60秒超时
          setTimeout(() => {
            proc.kill();
            warnings.push('npm install 超时');
            resolve();
          }, 60000);
        });
      } catch (error) {
        warnings.push(`npm install 异常: ${error}`);
      }
    }

    // 检查 requirements.txt
    if (files.has('requirements.txt')) {
      logger.info('检测到 requirements.txt，安装 Python 依赖');
      
      try {
        await new Promise<void>((resolve) => {
          const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
          const proc = spawn(pythonCmd, ['-m', 'pip', 'install', '-r', 'requirements.txt'], {
            cwd: skillDir,
            stdio: 'pipe',
          });

          let stderr = '';
          proc.stderr?.on('data', (data) => {
            stderr += data.toString();
          });

          proc.on('close', (code) => {
            if (code !== 0) {
              logger.warn('pip install 失败', { code, stderr });
              warnings.push(`pip install 失败 (退出码: ${code})`);
            } else {
              logger.info('pip install 完成');
            }
            resolve();
          });

          proc.on('error', (error) => {
            logger.warn('pip install 异常', { error: error.message });
            warnings.push(`pip install 异常: ${error.message}`);
            resolve();
          });

          // 60秒超时
          setTimeout(() => {
            proc.kill();
            warnings.push('pip install 超时');
            resolve();
          }, 60000);
        });
      } catch (error) {
        warnings.push(`pip install 异常: ${error}`);
      }
    }

    return warnings;
  }

  /**
   * 转换 ClawHub 格式为白泽格式
   */
  private async convertToBaizeFormat(
    content: string, 
    slug: string,
    scriptContents: string[]
  ): Promise<string> {
    // 解析 YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (!frontmatterMatch) {
      // 没有 frontmatter，添加默认值
      return `---
name: ${slug}
version: 1.0.0
description: ${slug} skill
capabilities:
  - ${slug}
risk_level: low
---

${content}`;
    }

    const [, frontmatter, body] = frontmatterMatch;

    // 检查是否已有 input_schema
    const hasInputSchema = frontmatter.includes('input_schema:');
    let inputSchema: ExtractedInputSchema | null = null;

    if (hasInputSchema) {
      // 提取现有的 input_schema
      const schemaMatch = frontmatter.match(/input_schema:\s*\n([\s\S]*?)(?=\n\w+:|\n---)/);
      if (schemaMatch) {
        try {
          const YAML = require('yaml');
          inputSchema = YAML.parse(`input_schema:\n${schemaMatch[1]}`).input_schema;
          logger.debug('使用现有的 input_schema', { slug });
        } catch (e) {
          logger.warn('解析现有 input_schema 失败', { slug });
        }
      }
    }

    // 如果没有 input_schema，使用 LLM 提取
    if (!inputSchema) {
      logger.info('技能没有 input_schema，使用 LLM 提取', { 
        slug, 
        scriptCount: scriptContents.length 
      });
      inputSchema = await this.extractInputSchema(content, slug, scriptContents);
    }

    // 提取环境变量要求
    const envMatch = frontmatter.match(/env:\s*\n(\s+-\s+.+\n)+/);
    const requiredEnv: string[] = [];
    if (envMatch) {
      const envLines = envMatch[0].match(/-\s+(.+)/g);
      if (envLines) {
        for (const line of envLines) {
          const envName = line.replace(/-\s+/, '').trim();
          requiredEnv.push(envName);
        }
      }
    }

    // 解析现有字段
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const versionMatch = frontmatter.match(/^version:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m) || frontmatter.match(/^summary:\s*(.+)$/m);

    // 构建白泽格式的 frontmatter
    const lines: string[] = [
      '---',
      `name: ${nameMatch ? nameMatch[1].trim() : slug}`,
      `version: ${versionMatch ? versionMatch[1].trim() : '1.0.0'}`,
      `description: ${descMatch ? descMatch[1].trim() : `${slug} skill`}`,
      'capabilities:',
      `  - ${slug}`,
      'risk_level: low',
    ];

    // 添加 input_schema
    if (inputSchema && Object.keys(inputSchema.properties || {}).length > 0) {
      lines.push('input_schema:');
      lines.push('  type: object');
      lines.push('  properties:');
      
      for (const [propName, propDef] of Object.entries(inputSchema.properties)) {
        lines.push(`    ${propName}:`);
        lines.push(`      type: ${propDef.type}`);
        lines.push(`      description: "${propDef.description.replace(/"/g, '\"')}"`);
      }
      
      if (inputSchema.required && inputSchema.required.length > 0) {
        lines.push('  required:');
        for (const req of inputSchema.required) {
          lines.push(`    - ${req}`);
        }
      }
    }

    // 添加环境变量要求
    if (requiredEnv.length > 0) {
      lines.push('required_env:');
      for (const env of requiredEnv) {
        lines.push(`  - ${env}`);
      }
    }

    lines.push('---');
    lines.push('');

    return lines.join('\n') + body;
  }

  /**
   * 安装技能
   */
  async install(slug: string, version?: string): Promise<ClawHubInstallResult> {
    logger.info('安装技能', { slug, version });

    const warnings: string[] = [];
    let requiredEnv: string[] = [];

    try {
      // 获取技能信息
      const details = await this.getSkillDetails(slug);
      if (!details) {
        return { success: false, error: '技能不存在' };
      }

      // 确定版本
      const targetVersion = version || details.latestVersion?.version;
      if (!targetVersion) {
        return { success: false, error: '无法确定版本' };
      }

      // 下载 ZIP
      const zipBuffer = await this.downloadZip(slug, targetVersion);
      if (!zipBuffer) {
        return { success: false, error: '下载失败' };
      }

      // 解析 ZIP
      const files = this.parseZip(zipBuffer);
      if (files.size === 0) {
        return { success: false, error: 'ZIP 解析失败' };
      }

      // 创建技能目录
      const skillDir = path.join(this.skillsDir, slug);
      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }

      // 收集所有脚本文件内容
      const scriptContents: string[] = [];
      const scriptExtensions = ['.js', '.ts', '.py', '.sh'];
      
      for (const [filename, content] of files) {
        const ext = path.extname(filename).toLowerCase();
        if (scriptExtensions.includes(ext) && !filename.includes('node_modules')) {
          const scriptContent = content.toString('utf-8');
          // 只取前 5000 字符，避免太长
          scriptContents.push(scriptContent.substring(0, 5000));
        }
      }

      // 获取 SKILL.md 内容
      let skillDoc = '';
      const skillMdFile = files.get('SKILL.md') || files.get('skill.md');
      if (skillMdFile) {
        skillDoc = skillMdFile.toString('utf-8');
        
        // 提取初始化说明
        const setup = this.extractSetupInstructions(skillDoc);
        requiredEnv = setup.requiredEnv;
      }

      // 写入文件
      for (const [filename, content] of files) {
        if (filename === '_meta.json') continue;
        
        const filePath = path.join(skillDir, filename);
        const dir = path.dirname(filePath);
        
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        let fileContent = content.toString('utf-8');
        if (filename.toLowerCase() === 'skill.md') {
          fileContent = await this.convertToBaizeFormat(fileContent, slug, scriptContents);
        }

        fs.writeFileSync(filePath, fileContent, 'utf-8');
        logger.debug('写入文件', { path: filePath, size: content.length });
      }

      // 安装依赖
      const depWarnings = await this.installDependencies(skillDir, files);
      warnings.push(...depWarnings);

      // 执行初始化命令
      if (skillDoc) {
        const setup = this.extractSetupInstructions(skillDoc);
        if (setup.commands.length > 0) {
          const setupWarnings = await this.runSetupCommands(skillDir, setup.commands);
          warnings.push(...setupWarnings);
        }
      }

      // 如果没有 main.js，尝试创建入口文件
      const hasMainJs = files.has('main.js');
      const hasMainPy = files.has('main.py');
      const jsFiles = Array.from(files.keys()).filter(f => f.endsWith('.js') && f !== 'main.js');

      if (!hasMainJs && !hasMainPy && jsFiles.length > 0) {
        const mainJsContent = `/**
 * ${slug} skill - 自动生成的入口文件
 */

const impl = require('./${jsFiles[0].replace('.js', '')}');

async function main(params) {
  if (typeof impl.main === 'function') {
    return impl.main(params);
  }
  if (typeof impl === 'function') {
    return impl(params);
  }
  return { success: false, error: '未找到入口函数' };
}

module.exports = { main };
`;
        fs.writeFileSync(path.join(skillDir, 'main.js'), mainJsContent, 'utf-8');
        logger.info('创建入口文件', { path: path.join(skillDir, 'main.js') });
      }

      logger.info('技能安装成功', { slug, version: targetVersion, path: skillDir, fileCount: files.size });

      // 构建结果消息
      let message = `技能 ${slug}@${targetVersion} 安装成功 (${files.size} 个文件)`;
      if (warnings.length > 0) {
        message += `\n\n警告:\n${warnings.map(w => `- ${w}`).join('\n')}`;
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
      logger.error('技能安装失败', { error: errorMsg });
      return {
        success: false,
        error: errorMsg,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }
  }

  /**
   * 列出已安装的技能
   */
  listInstalled(): string[] {
    if (!fs.existsSync(this.skillsDir)) {
      return [];
    }

    return fs.readdirSync(this.skillsDir).filter(name => {
      const skillPath = path.join(this.skillsDir, name);
      const skillMd = path.join(skillPath, 'SKILL.md');
      return fs.statSync(skillPath).isDirectory() && fs.existsSync(skillMd);
    });
  }

  /**
   * 卸载技能
   */
  uninstall(slug: string): ClawHubInstallResult {
    const skillDir = path.join(this.skillsDir, slug);

    if (!fs.existsSync(skillDir)) {
      return { success: false, error: '技能未安装' };
    }

    try {
      fs.rmSync(skillDir, { recursive: true, force: true });
      logger.info('技能已卸载', { slug });

      return {
        success: true,
        message: `技能 ${slug} 已卸载`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMsg };
    }
  }
}

// 全局实例
let clawhubClient: ClawHubClient | null = null;

export function getClawHubClient(): ClawHubClient {
  if (!clawhubClient) {
    clawhubClient = new ClawHubClient();
  }
  return clawhubClient;
}
