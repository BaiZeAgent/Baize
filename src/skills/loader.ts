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
   * 支持多种命令类型：curl、open、temporal 等
   */
  private async runFromDocs(params: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
    const mdContent = this.definition.mdContent;
    const skillName = this.definition.name;
    
    logger.debug(`执行文档型技能: ${skillName}`, { params });
    
    // 1. 检测是否是天气相关技能
    if (skillName === 'weather' || mdContent.toLowerCase().includes('wttr.in') || mdContent.toLowerCase().includes('open-meteo')) {
      return this.executeWeatherSkill(params);
    }
    
    // 2. 检测是否是时间相关技能
    if (skillName === 'time' || mdContent.includes('temporal ')) {
      return this.executeTemporalSkill(params, mdContent);
    }
    
    // 3. 检测是否是浏览器打开相关
    if (mdContent.includes('open ') && (mdContent.includes('http://') || mdContent.includes('https://'))) {
      return this.executeOpenSkill(params, mdContent);
    }
    
    // 4. 检测是否有 curl 命令
    if (mdContent.includes('curl ')) {
      return this.executeCurlSkill(params, mdContent);
    }
    
    // 5. 其他情况：返回文档内容让 LLM 理解
    return {
      success: true,
      data: { 
        docContent: mdContent.substring(0, 3000),
        params,
      },
      message: `文档型技能 "${skillName}" 需要理解后执行。请参考以下文档：\n\n${mdContent.substring(0, 1000)}...`,
    };
  }

  /**
   * 执行天气技能
   */
  private async executeWeatherSkill(params: Record<string, unknown>): Promise<SkillResult> {
    let query = '';
    const possibleKeys = ['query', 'city', 'location', 'place', 'name', 'keyword', 'q'];
    for (const key of possibleKeys) {
      if (params[key] && typeof params[key] === 'string') {
        query = params[key] as string;
        break;
      }
    }
    
    if (!query) {
      query = 'Beijing';
    }
    
    const cityCoords: Record<string, { lat: number; lon: number }> = {
      '北京': { lat: 39.9, lon: 116.4 },
      '上海': { lat: 31.2, lon: 121.5 },
      '广州': { lat: 23.1, lon: 113.3 },
      '深圳': { lat: 22.5, lon: 114.1 },
      '杭州': { lat: 30.3, lon: 120.2 },
      '成都': { lat: 30.6, lon: 104.1 },
      '武汉': { lat: 30.6, lon: 114.3 },
      '西安': { lat: 34.3, lon: 108.9 },
      '南京': { lat: 32.1, lon: 118.8 },
      'beijing': { lat: 39.9, lon: 116.4 },
      'shanghai': { lat: 31.2, lon: 121.5 },
      'london': { lat: 51.5, lon: -0.1 },
      'newyork': { lat: 40.7, lon: -74.0 },
      'tokyo': { lat: 35.7, lon: 139.7 },
    };
    
    const queryLower = query.toLowerCase();
    const coords = cityCoords[query] || cityCoords[queryLower] || { lat: 39.9, lon: 116.4 };
    
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current_weather=true&timezone=auto`;
    
    logger.info(`执行天气查询: ${url}`);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Baize/3.0', 'Accept': 'application/json' },
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        return { success: false, data: {}, message: `HTTP 请求失败: ${response.status}`, error: `HTTP ${response.status}` };
      }
      
      const data = await response.json() as Record<string, unknown>;
      const currentWeather = data.current_weather as Record<string, unknown>;
      
      if (currentWeather) {
        const temp = currentWeather.temperature;
        const windSpeed = currentWeather.windspeed;
        const windDir = currentWeather.winddirection;
        const weatherCode = currentWeather.weathercode;
        
        const weatherDesc: Record<number, string> = {
          0: '晴朗', 1: '晴间多云', 2: '多云', 3: '阴天',
          45: '雾', 48: '雾凇', 51: '小雨', 53: '中雨', 55: '大雨',
          61: '小雨', 63: '中雨', 65: '大雨', 71: '小雪', 73: '中雪', 75: '大雪',
          80: '阵雨', 81: '中阵雨', 82: '大阵雨', 95: '雷暴', 96: '雷暴冰雹', 99: '强雷暴'
        };
        
        const desc = weatherDesc[weatherCode as number] || '未知';
        const windDirs = ['北风', '东北风', '东风', '东南风', '南风', '西南风', '西风', '西北风'];
        const windDirIndex = Math.round((windDir as number) / 45) % 8;
        
        return {
          success: true,
          data: { ...data, query },
          message: `${query}: ${desc}，气温 ${temp}°C，${windDirs[windDirIndex]} ${windSpeed}km/h`,
        };
      }
      
      return { success: true, data, message: JSON.stringify(data) };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, data: {}, message: `天气查询失败: ${errorMsg}`, error: errorMsg };
    }
  }

  /**
   * 执行 temporal 时间技能
   */
  private async executeTemporalSkill(params: Record<string, unknown>, mdContent: string): Promise<SkillResult> {
    const { exec } = require('child_process');
    
    // 检查 temporal 是否安装
    const command = params.command || params.action || 'now';
    
    return new Promise((resolve) => {
      exec(`temporal ${command}`, { timeout: 10000 }, (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          // temporal 未安装，返回文档说明
          resolve({
            success: true,
            data: { needsInstall: true, docContent: mdContent.substring(0, 2000) },
            message: `temporal 命令未安装。请先安装 temporal 工具，参考文档：\n\n${mdContent.substring(0, 500)}...`,
          });
        } else {
          resolve({
            success: true,
            data: { output: stdout },
            message: stdout || '执行成功',
          });
        }
      });
    });
  }

  /**
   * 执行浏览器打开技能
   */
  private async executeOpenSkill(params: Record<string, unknown>, mdContent: string): Promise<SkillResult> {
    const { exec } = require('child_process');
    
    // 提取 URL
    let url = params.url || params.link || '';
    if (!url) {
      const urlMatch = mdContent.match(/https?:\/\/[^\s"']+/);
      if (urlMatch) {
        url = urlMatch[0];
      }
    }
    
    if (!url) {
      return { success: false, data: {}, message: '未找到要打开的 URL', error: '缺少 URL 参数' };
    }
    
    // 根据平台选择打开命令
    const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    
    return new Promise((resolve) => {
      exec(`${openCmd} "${url}"`, { timeout: 5000 }, (error: Error | null) => {
        if (error) {
          resolve({ success: false, data: {}, message: `打开失败: ${error.message}`, error: error.message });
        } else {
          resolve({ success: true, data: { url }, message: `已打开: ${url}` });
        }
      });
    });
  }

  /**
   * 执行 curl 命令技能
   */
  private async executeCurlSkill(params: Record<string, unknown>, mdContent: string): Promise<SkillResult> {
    // 提取 curl 命令中的 URL
    const curlMatch = mdContent.match(/curl\s+-s\s+"([^"]+)"/);
    if (!curlMatch) {
      return { success: false, data: {}, message: '未找到可执行的 curl 命令', error: '缺少 curl 命令' };
    }
    
    let url = curlMatch[1];
    
    // 替换参数
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        url = url.replace(`{${key}}`, encodeURIComponent(value));
        url = url.replace(`$${key}`, encodeURIComponent(value));
      }
    }
    
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    logger.info(`执行 curl 请求: ${url}`);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Baize/3.0' },
      });
      
      clearTimeout(timeoutId);
      
      const text = await response.text();
      
      return { success: true, data: { output: text }, message: text };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, data: {}, message: `请求失败: ${errorMsg}`, error: errorMsg };
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

    // 检查是否是文档型技能
    const isDocSkill = !definition.hasPython && !definition.hasJavaScript && !definition.hasShell;
    
    // 检测文档中的可执行命令
    const docContent = definition.mdContent.toLowerCase();
    const hasExecutableCommands = 
      docContent.includes('curl ') ||
      docContent.includes('temporal ') ||
      docContent.includes('open ') ||
      docContent.includes('```bash') ||
      docContent.includes('```sh') ||
      docContent.includes('npm ') ||
      docContent.includes('npx ') ||
      docContent.includes('node ');
    
    if (isDocSkill && hasExecutableCommands) {
      logger.info(`加载文档型技能: ${definition.name}`, {
        capabilities: definition.capabilities,
        riskLevel: definition.riskLevel,
        type: 'doc-based',
      });
    } else if (isDocSkill) {
      // 纯文档型技能（LLM 理解后执行）
      logger.info(`加载文档型技能: ${definition.name} (LLM理解模式)`, {
        capabilities: definition.capabilities,
        riskLevel: definition.riskLevel,
        type: 'doc-based',
      });
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
