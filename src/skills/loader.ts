/**
 * 技能加载器 - 动态加载技能
 * 
 * 支持：
 * 1. 从skills目录自动加载
 * 2. Python技能（通过子进程调用）
 * 3. JavaScript技能
 * 4. Shell脚本
 * 5. MD格式定义文件（SKILL.md）
 * 6. 文档型技能（从SKILL.md提取命令执行，使用原生fetch）
 */
import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import YAML from 'yaml';
import { Skill, SkillContext } from './base';
import { SkillResult, RiskLevel, SkillInfo } from '../types';
import { getLogger } from '../observability/logger';

const logger = getLogger('skill:loader');

/**
 * MD文件中的YAML前置配置
 */
interface SkillFrontMatter {
  name: string;
  description: string;
  version?: string;
  author?: string;
  capabilities?: string[];
  risk_level?: string;
  step_by_step?: boolean;
  auto_execute?: boolean;
  timeout?: number;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  examples?: Array<{
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    description?: string;
  }>;
}

/**
 * 加载的技能定义
 */
interface LoadedSkillDefinition {
  name: string;
  description: string;
  version: string;
  author: string;
  capabilities: string[];
  riskLevel: RiskLevel;
  stepByStep: boolean;
  autoExecute: boolean;
  timeout: number;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  examples: Array<{
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    description?: string;
  }>;
  skillPath: string;
  hasPython: boolean;
  hasJavaScript: boolean;
  hasShell: boolean;
  mdContent: string; // 完整的MD内容，包含使用说明
}

/**
 * 动态加载的技能
 */
class DynamicSkill extends Skill {
  private definition: LoadedSkillDefinition;

  constructor(definition: LoadedSkillDefinition) {
    super();
    this.definition = definition;
  }

  get name(): string {
    return this.definition.name;
  }

  get description(): string {
    return this.definition.description;
  }

  get capabilities(): string[] {
    return this.definition.capabilities;
  }

  get riskLevel(): RiskLevel {
    return this.definition.riskLevel;
  }

  get inputSchema(): Record<string, unknown> {
    return this.definition.inputSchema;
  }

  get outputSchema(): Record<string, unknown> {
    return this.definition.outputSchema;
  }

  /**
   * 是否需要逐步执行
   */
  get stepByStep(): boolean {
    return this.definition.stepByStep;
  }

  /**
   * 是否自动执行
   */
  get autoExecute(): boolean {
    return this.definition.autoExecute;
  }

  /**
   * 获取技能文档
   */
  getDocumentation(): string {
    return this.definition.mdContent;
  }

  /**
   * 执行技能
   */
  async run(params: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
    const startTime = Date.now();
    logger.info(`执行技能: ${this.name}`, { 
      params: JSON.stringify(params).substring(0, 200),
      stepByStep: this.stepByStep 
    });

    try {
      let result: SkillResult;

      // 优先级：Python > JavaScript > Shell > 文档型
      if (this.definition.hasPython) {
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        if (await this.isCommandAvailable(pythonCmd)) {
          result = await this.runPython(params, context, pythonCmd);
        } else if (this.definition.hasJavaScript) {
          logger.debug(`${pythonCmd}不可用，fallback到JavaScript`);
          result = await this.runJavaScript(params, context);
        } else if (this.definition.hasShell) {
          result = await this.runShell(params, context);
        } else {
          result = await this.runFromDocs(params, context);
        }
      } else if (this.definition.hasJavaScript) {
        result = await this.runJavaScript(params, context);
      } else if (this.definition.hasShell) {
        result = await this.runShell(params, context);
      } else {
        // 文档型技能：从SKILL.md提取命令执行
        result = await this.runFromDocs(params, context);
      }

      const duration = (Date.now() - startTime) / 1000;
      logger.info(`技能执行完成: ${this.name}`, { 
        success: result.success, 
        duration: `${duration.toFixed(2)}s`,
        message: result.message?.substring(0, 100)
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`技能执行失败: ${this.name}`, { error: errorMsg });
      return {
        success: false,
        data: {},
        message: '执行失败',
        error: errorMsg,
      };
    }
  }

  /**
   * 从文档中提取并执行命令（文档型技能）
   * 使用 Node.js 原生 fetch 替代 curl
   */
  private async runFromDocs(params: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
    const mdContent = this.definition.mdContent;
    
    // 提取查询参数 - 支持多种参数名
    let query = '';
    const possibleKeys = ['query', 'city', 'location', 'place', 'name', 'keyword', 'q'];
    for (const key of possibleKeys) {
      if (params[key] && typeof params[key] === 'string') {
        query = params[key] as string;
        break;
      }
    }
    
    // 默认城市
    if (!query) {
      query = 'Beijing';
      logger.debug('未指定城市，使用默认城市: Beijing');
    }
    
    logger.debug(`文档型技能参数: query=${query}`);

    // 从文档中提取 URL 模板
    const curlMatch = mdContent.match(/```bash\ncurl -s "([^"]+)"\n```/);
    
    if (!curlMatch) {
      return {
        success: false,
        data: {},
        message: '文档型技能未找到可执行的URL',
        error: 'SKILL.md 中没有找到 curl 命令模板',
      };
    }

    let url = curlMatch[1];
    
    // 替换占位符
    // wttr.in/London -> wttr.in/{query}
    url = url.replace(/wttr\.in\/[A-Za-z+]+/i, `wttr.in/${encodeURIComponent(query)}`);
    url = url.replace(/api\.open-meteo\.com\/v1\/forecast\?[^"]+/i, 
      `api.open-meteo.com/v1/forecast?latitude=30.25&longitude=120.17&current_weather=true`);
    
    // 替换其他常见占位符
    url = url.replace(/\$\{?query\}?/gi, encodeURIComponent(query));
    url = url.replace(/\$\{?city\}?/gi, encodeURIComponent(query));
    url = url.replace(/\$\{?location\}?/gi, encodeURIComponent(query));

    // 移除 curl 前缀（如果有的话）
    url = url.replace(/^curl -s "?/, '').replace(/"$/, '');

    // 确保 URL 有协议
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    logger.info(`执行文档请求: ${url}`);

    try {
      // 使用 Node.js 原生 fetch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'curl/7.68.0', // wttr.in 需要这个
          'Accept': '*/*',
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          data: { status: response.status },
          message: `HTTP 请求失败: ${response.status}`,
          error: `HTTP ${response.status}`,
        };
      }

      const output = await response.text();
      logger.debug(`请求成功，响应长度: ${output.length}`);

      return {
        success: true,
        data: { output },
        message: output,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`请求失败: ${errorMsg}`);
      
      // 如果 fetch 失败，尝试使用 curl 作为备选
      logger.info('尝试使用 curl 作为备选');
      return this.runFromDocsFallback(url, query);
    }
  }

  /**
   * 使用 curl 作为备选方案
   */
  private runFromDocsFallback(url: string, query: string): Promise<SkillResult> {
    return new Promise((resolve) => {
      // Windows 下需要使用 shell: true
      const command = process.platform === 'win32' 
        ? `curl -s "${url}"`
        : `curl -s "${url}"`;

      exec(command, { 
        timeout: 15000,
        shell: process.platform === 'win32' ? 'cmd.exe' : undefined
      }, (error, stdout, stderr) => {
        if (error) {
          logger.error(`curl 执行失败: ${error.message}`, { stderr });
          resolve({
            success: false,
            data: { error: error.message, stderr },
            message: `请求失败: ${error.message}`,
            error: stderr || error.message,
          });
        } else {
          const output = stdout.trim();
          logger.debug(`curl 成功，输出长度: ${output.length}`);
          resolve({
            success: true,
            data: { output },
            message: output,
          });
        }
      });
    });
  }

  /**
   * 检测命令是否可用
   */
  private isCommandAvailable(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(command, ['--version'], { 
        timeout: 3000,
        shell: process.platform === 'win32',
      });
      
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));
      
      setTimeout(() => {
        proc.kill();
        resolve(false);
      }, 3000);
    });
  }

  /**
   * 执行Python技能
   */
  private async runPython(params: Record<string, unknown>, context: SkillContext, pythonCmd: string = 'python3'): Promise<SkillResult> {
    const scriptPath = path.join(this.definition.skillPath, 'main.py');
    return this.executeCommand(pythonCmd, [scriptPath], params, context);
  }

  /**
   * 执行JavaScript技能
   */
  private async runJavaScript(params: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
    const scriptPath = path.join(this.definition.skillPath, 'main.js');
    return this.executeCommand(process.execPath, [scriptPath], params, context);
  }

  /**
   * 执行Shell脚本
   */
  private async runShell(params: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
    const scriptPath = path.join(this.definition.skillPath, 'run.sh');
    return this.executeCommand('bash', [scriptPath], params, context);
  }

  /**
   * 执行命令
   */
  private executeCommand(
    command: string,
    args: string[],
    params: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    return new Promise((resolve) => {
      const timeout = this.definition.timeout || 60000;
      
      const inputData = JSON.stringify({ 
        params, 
        context: {
          userId: context.userId,
          conversationId: context.conversationId,
        }
      });
      
      logger.debug(`执行命令: ${command} ${args.join(' ')}`);
      
      const isWindows = process.platform === 'win32';
      const shellEnv = isWindows ? { ...process.env, PYTHONIOENCODING: 'utf-8' } : process.env;
      
      const proc = spawn(command, args, {
        cwd: this.definition.skillPath,
        timeout,
        env: {
          ...shellEnv,
          BAIZE_PARAMS: inputData,
          BAIZE_SKILL_PATH: this.definition.skillPath,
        },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString('utf-8');
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString('utf-8');
      });

      proc.on('close', (code) => {
        logger.debug(`进程退出，代码: ${code}, stdout: ${stdout.substring(0, 200)}, stderr: ${stderr.substring(0, 200)}`);
        
        if (code === 0) {
          try {
            const result = JSON.parse(stdout.trim());
            resolve({
              success: result.success !== false,
              data: result.data || result,
              message: result.message || '执行成功',
            });
          } catch {
            resolve({
              success: true,
              data: { output: stdout.trim() },
              message: stdout.trim() || '执行成功',
            });
          }
        } else {
          const errorMsg = stderr.trim() || stdout.trim() || `退出码: ${code}`;
          logger.error(`技能执行失败: ${errorMsg}`);
          resolve({
            success: false,
            data: {},
            message: '执行失败',
            error: errorMsg,
          });
        }
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          data: {},
          message: '执行失败',
          error: error.message,
        });
      });

      proc.stdin?.write(inputData);
      proc.stdin?.end();
    });
  }

  toInfo(): SkillInfo {
    return {
      name: this.name,
      description: this.description,
      capabilities: this.capabilities,
      riskLevel: this.riskLevel,
      inputSchema: this.inputSchema,
      outputSchema: this.outputSchema,
    };
  }
}

/**
 * 技能加载器
 */
export class SkillLoader {
  private skillsDir: string;

  constructor(skillsDir: string = 'skills') {
    this.skillsDir = skillsDir;
  }

  /**
   * 加载所有技能
   */
  async loadAll(): Promise<DynamicSkill[]> {
    const skills: DynamicSkill[] = [];

    if (!fs.existsSync(this.skillsDir)) {
      logger.warn(`技能目录不存在: ${this.skillsDir}，将创建`);
      fs.mkdirSync(this.skillsDir, { recursive: true });
      return skills;
    }

    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = path.join(this.skillsDir, entry.name);
      const skill = await this.loadSkill(skillPath);
      
      if (skill) {
        skills.push(skill);
      }
    }

    logger.info(`从 ${this.skillsDir} 加载了 ${skills.length} 个技能`);
    return skills;
  }

  /**
   * 加载单个技能
   */
  private async loadSkill(skillPath: string): Promise<DynamicSkill | null> {
    const absoluteSkillPath = path.resolve(skillPath);
    const skillName = path.basename(absoluteSkillPath);
    
    const mdPath = path.join(absoluteSkillPath, 'SKILL.md');
    const yamlPath = path.join(absoluteSkillPath, 'skill.yaml');
    const jsonPath = path.join(absoluteSkillPath, 'skill.json');

    let definition: LoadedSkillDefinition | null = null;

    if (fs.existsSync(mdPath)) {
      definition = this.parseMdFile(mdPath, absoluteSkillPath);
    } else if (fs.existsSync(yamlPath)) {
      definition = this.parseYamlFile(yamlPath, absoluteSkillPath);
    } else if (fs.existsSync(jsonPath)) {
      definition = this.parseJsonFile(jsonPath, absoluteSkillPath);
    }

    if (!definition) {
      logger.warn(`技能 ${skillName} 缺少定义文件 (SKILL.md/skill.yaml/skill.json)`);
      return null;
    }

    // 检查实现文件
    definition.hasPython = fs.existsSync(path.join(absoluteSkillPath, 'main.py'));
    definition.hasJavaScript = fs.existsSync(path.join(absoluteSkillPath, 'main.js'));
    definition.hasShell = fs.existsSync(path.join(absoluteSkillPath, 'run.sh'));

    // 检查是否是文档型技能（有curl命令但没有实现文件）
    const isDocSkill = !definition.hasPython && !definition.hasJavaScript && !definition.hasShell;
    const hasCurlCommand = definition.mdContent.includes('curl -s');
    
    if (isDocSkill && hasCurlCommand) {
      logger.info(`加载文档型技能: ${definition.name}`, {
        capabilities: definition.capabilities,
        riskLevel: definition.riskLevel,
        type: 'doc-based',
      });
    } else if (isDocSkill) {
      logger.warn(`技能 ${definition.name} 没有实现文件且不是文档型技能`);
    } else {
      logger.info(`加载技能: ${definition.name}`, {
        capabilities: definition.capabilities,
        riskLevel: definition.riskLevel,
        stepByStep: definition.stepByStep,
        hasPython: definition.hasPython,
        hasJavaScript: definition.hasJavaScript,
        hasShell: definition.hasShell,
      });
    }

    return new DynamicSkill(definition);
  }

  /**
   * 解析MD文件
   */
  private parseMdFile(mdPath: string, skillPath: string): LoadedSkillDefinition | null {
    try {
      const content = fs.readFileSync(mdPath, 'utf-8');
      const contentNormalized = content.replace(/\r\n/g, '\n');
      const frontMatterMatch = contentNormalized.match(/^---\n([\s\S]*?)\n---/);
      
      if (!frontMatterMatch) {
        logger.warn(`MD文件缺少YAML前置配置: ${mdPath}`);
        return null;
      }

      const frontMatter = YAML.parse(frontMatterMatch[1]) as SkillFrontMatter;
      return this.createDefinition(frontMatter, skillPath, content);
    } catch (error) {
      logger.error(`解析MD文件失败: ${mdPath}`, { error });
      return null;
    }
  }

  /**
   * 解析YAML文件
   */
  private parseYamlFile(yamlPath: string, skillPath: string): LoadedSkillDefinition | null {
    try {
      const content = fs.readFileSync(yamlPath, 'utf-8');
      const config = YAML.parse(content) as SkillFrontMatter;
      return this.createDefinition(config, skillPath, '');
    } catch (error) {
      logger.error(`解析YAML文件失败: ${yamlPath}`, { error });
      return null;
    }
  }

  /**
   * 解析JSON文件
   */
  private parseJsonFile(jsonPath: string, skillPath: string): LoadedSkillDefinition | null {
    try {
      const content = fs.readFileSync(jsonPath, 'utf-8');
      const config = JSON.parse(content) as SkillFrontMatter;
      return this.createDefinition(config, skillPath, '');
    } catch (error) {
      logger.error(`解析JSON文件失败: ${jsonPath}`, { error });
      return null;
    }
  }

  /**
   * 创建技能定义
   */
  private createDefinition(
    config: SkillFrontMatter, 
    skillPath: string,
    mdContent: string
  ): LoadedSkillDefinition {
    return {
      name: config.name,
      description: config.description,
      version: config.version || '1.0.0',
      author: config.author || 'unknown',
      capabilities: config.capabilities || [],
      riskLevel: this.parseRiskLevel(config.risk_level),
      stepByStep: config.step_by_step ?? false,
      autoExecute: config.auto_execute ?? true,
      timeout: config.timeout || 60000,
      inputSchema: config.input_schema || {},
      outputSchema: config.output_schema || {},
      examples: config.examples || [],
      skillPath,
      hasPython: false,
      hasJavaScript: false,
      hasShell: false,
      mdContent,
    };
  }

  /**
   * 解析风险等级
   */
  private parseRiskLevel(level?: string): RiskLevel {
    switch (level?.toLowerCase()) {
      case 'low': return RiskLevel.LOW;
      case 'medium': return RiskLevel.MEDIUM;
      case 'high': return RiskLevel.HIGH;
      case 'critical': return RiskLevel.CRITICAL;
      default: return RiskLevel.LOW;
    }
  }
}

/**
 * 加载所有技能到注册表
 */
export async function loadSkillsToRegistry(skillsDir?: string): Promise<void> {
  const { getSkillRegistry } = require('./registry');
  const loader = new SkillLoader(skillsDir);
  const skills = await loader.loadAll();
  
  const registry = getSkillRegistry();
  for (const skill of skills) {
    registry.register(skill);
  }
}
