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
  when_to_use?: string;  // 何时使用此技能
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
  whenToUse?: string;  // 何时使用此技能
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

  get whenToUse(): string | undefined {
    return this.definition.whenToUse;
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
   * 解析 SKILL.md 中的命令并执行
   */
  private async runFromDocs(params: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
    const mdContent = this.definition.mdContent;
    const skillName = this.definition.name;
    
    logger.info(`执行文档型技能: ${skillName}`, { params });
    
    // 1. 提取所有 bash 命令
    const commands = this.extractBashCommands(mdContent);
    
    if (commands.length === 0) {
      // 没有可执行命令，返回文档让 LLM 理解
      return {
        success: true,
        data: { docContent: mdContent, params, skillName, isDocSkill: true },
        message: `[文档型技能: ${skillName}]\n\n${mdContent}`,
      };
    }
    
    // 2. 根据技能类型和参数选择合适的命令
    const selectedCommand = this.selectCommand(commands, skillName, params);
    
    if (!selectedCommand) {
      return {
        success: false,
        data: { commands, params },
        message: `无法确定要执行的命令`,
        error: '未找到匹配的命令模板',
      };
    }
    
    logger.info(`选择命令: ${selectedCommand}`);
    
    // 3. 执行命令
    return this.executeDocCommand(selectedCommand, skillName, params);
  }

  /**
   * 提取文档中的 bash 命令
   */
  private extractBashCommands(content: string): string[] {
    const commands: string[] = [];
    const bashBlockRegex = /```bash\s*\n([\s\S]*?)```/g;
    let match;
    
    while ((match = bashBlockRegex.exec(content)) !== null) {
      const cmd = match[1].trim();
      // 过滤掉注释行和空行
      const lines = cmd.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
      
      for (const line of lines) {
        commands.push(line);
      }
    }
    
    return commands;
  }

  /**
   * 根据技能类型和参数选择命令
   */
  private selectCommand(commands: string[], skillName: string, params: Record<string, unknown>): string | null {
    // 获取参数值
    const location = params.location || params.city || params.query || params.place || '';
    const url = params.url || params.link || '';
    
    // 天气技能：优先选择 Open-Meteo API（更稳定）
    if (skillName === 'weather') {
      for (const cmd of commands) {
        if (cmd.includes('open-meteo')) {
          return cmd;
        }
      }
      // 备选 wttr.in
      for (const cmd of commands) {
        if (cmd.includes('wttr.in') && (cmd.includes('format=3') || cmd.includes('format=%'))) {
          return cmd;
        }
      }
      // 返回第一个 wttr.in 命令
      for (const cmd of commands) {
        if (cmd.includes('wttr.in')) {
          return cmd;
        }
      }
    }
    
    for (const cmd of commands) {
      // 打开浏览器 (简单技能)
      if (skillName === 'browser' && cmd.includes('open ') && cmd.includes('http')) {
        return cmd;
      }
      
      // browser-automation 技能：选择 navigate 命令
      if (skillName === 'browser-automation' && cmd.includes('browser navigate')) {
        return cmd;
      }
      
      // agent-browser 技能
      if (skillName === 'agent-browser' && cmd.includes('agent-browser open')) {
        return cmd;
      }
      
      // 通用打开浏览器
      if (cmd.includes('open ') && cmd.includes('http')) {
        return cmd;
      }
      
      // GitHub 技能
      if (skillName === 'github' && cmd.includes('gh ')) {
        return cmd;
      }
      
      // Docker 技能
      if (skillName.toLowerCase().includes('docker') && cmd.includes('docker ')) {
        return cmd;
      }
      
      // temporal 技能
      if (cmd.includes('temporal ')) {
        return cmd;
      }
      
      // time 技能：选择 date 命令
      if (skillName === 'time' && cmd.includes('date ')) {
        return cmd;
      }
    }
    
    // 默认返回第一个命令
    return commands[0] || null;
  }

  /**
   * 执行文档型命令
   */
  private async executeDocCommand(commandTemplate: string, skillName: string, params: Record<string, unknown>): Promise<SkillResult> {
    // 替换参数
    let command = this.replaceParams(commandTemplate, params);
    
    logger.info(`执行命令: ${command}`);
    
    // 根据命令类型执行
    if (command.startsWith('curl ')) {
      return this.executeCurlCommand(command);
    } else if (command.startsWith('open ') || command.includes('://')) {
      return this.executeOpenCommand(command);
    } else {
      return this.executeShellCommand(command);
    }
  }

  /**
   * 替换命令中的参数
   */
  private replaceParams(template: string, params: Record<string, unknown>): string {
    let result = template;
    
    // 获取常用参数
    const locationRaw = String(params.location || params.city || params.query || params.place || 'Beijing');
    const url = String(params.url || params.link || '');
    const repo = String(params.repo || params.repository || 'BaiZeAgent/Baize');
    
    // 中文城市名坐标映射（用于 Open-Meteo API）
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
      '重庆': { lat: 29.6, lon: 106.5 },
      '天津': { lat: 39.1, lon: 117.2 },
      '苏州': { lat: 31.3, lon: 120.6 },
      '长沙': { lat: 28.2, lon: 112.9 },
      '郑州': { lat: 34.8, lon: 113.7 },
      '青岛': { lat: 36.1, lon: 120.4 },
      '大连': { lat: 38.9, lon: 121.6 },
      '厦门': { lat: 24.5, lon: 118.1 },
      '宁波': { lat: 29.9, lon: 121.6 },
      '福州': { lat: 26.1, lon: 119.3 },
      '哈尔滨': { lat: 45.8, lon: 126.5 },
      '沈阳': { lat: 41.8, lon: 123.4 },
      '长春': { lat: 43.9, lon: 125.3 },
      '昆明': { lat: 25.0, lon: 102.7 },
      '贵阳': { lat: 26.6, lon: 106.6 },
      '南宁': { lat: 22.8, lon: 108.3 },
      '海口': { lat: 20.0, lon: 110.3 },
      '三亚': { lat: 18.3, lon: 109.5 },
      '拉萨': { lat: 29.7, lon: 91.1 },
      '乌鲁木齐': { lat: 43.8, lon: 87.6 },
      '兰州': { lat: 36.1, lon: 103.8 },
      '银川': { lat: 38.5, lon: 106.3 },
      '西宁': { lat: 36.6, lon: 101.8 },
      '呼和浩特': { lat: 40.8, lon: 111.7 },
      '石家庄': { lat: 38.0, lon: 114.5 },
      '太原': { lat: 37.9, lon: 112.5 },
      '济南': { lat: 36.7, lon: 117.0 },
      '合肥': { lat: 31.8, lon: 117.3 },
      '南昌': { lat: 28.7, lon: 115.9 },
    };
    
    // 获取城市坐标（用于 Open-Meteo）
    const coords = cityCoords[locationRaw] || { lat: 39.9, lon: 116.4 };
    
    // 替换 Open-Meteo API 的坐标参数
    result = result.replace(/latitude=[\d.-]+/, `latitude=${coords.lat}`);
    result = result.replace(/longitude=[\d.-]+/, `longitude=${coords.lon}`);
    
    // 替换 wttr.in 的城市名（wttr.in 支持中文，直接使用原始值）
    result = result.replace(/wttr\.in\/[^\s"?]*/g, `wttr.in/${locationRaw}`);
    
    // 替换 owner/repo
    result = result.replace(/--repo\s+\S+/g, `--repo ${repo}`);
    result = result.replace(/owner\/repo/g, repo);
    
    // 替换 URL 参数
    if (url && result.includes('http')) {
      result = result.replace(/https?:\/\/[^\s"']+/g, url);
    }
    
    return result;
  }

  /**
   * 执行 curl 命令（使用 fetch 或 curl 命令）
   */
  private async executeCurlCommand(command: string): Promise<SkillResult> {
    // 提取 URL（支持 http:// 和 https:// 以及无协议的 URL）
    let urlMatch = command.match(/["']?(https?:\/\/[^\s"']+)["']?/);
    
    // 如果没有找到 http:// 开头的 URL，尝试匹配其他 URL
    if (!urlMatch) {
      urlMatch = command.match(/["']?([a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}[^\s"']*)["']?/);
    }
    
    if (!urlMatch) {
      return { success: false, data: {}, message: '无法解析 URL', error: 'URL 解析失败' };
    }
    
    let url = urlMatch[1];
    
    // 如果 URL 没有协议前缀，添加 https://
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    logger.info(`请求 URL: ${url}`);
    
    // 先尝试使用 fetch
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'curl/7.68.0' },
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const text = await response.text();
      
      return {
        success: true,
        data: { output: text, url },
        message: text,
      };
    } catch (fetchError) {
      // fetch 失败，使用 curl 命令作为备选
      logger.warn(`fetch 失败，使用 curl 备选: ${fetchError}`);
      
      return new Promise((resolve) => {
        exec(`curl -s "${url}"`, { timeout: 15000 }, (error, stdout, stderr) => {
          if (error) {
            resolve({ 
              success: false, 
              data: {}, 
              message: `请求失败: ${error.message}`, 
              error: stderr || error.message 
            });
          } else {
            resolve({
              success: true,
              data: { output: stdout.trim(), url },
              message: stdout.trim(),
            });
          }
        });
      });
    }
  }

  /**
   * 执行打开浏览器命令
   */
  private async executeOpenCommand(command: string): Promise<SkillResult> {
    // 提取 URL
    const urlMatch = command.match(/https?:\/\/[^\s"']+/);
    if (!urlMatch) {
      return { success: false, data: {}, message: '未找到 URL', error: '缺少 URL' };
    }
    
    const url = urlMatch[0];
    
    // 根据平台选择打开命令
    const openCmd = process.platform === 'darwin' ? 'open' : 
                    process.platform === 'win32' ? 'start' : 'xdg-open';
    
    return new Promise((resolve) => {
      exec(`${openCmd} "${url}"`, { timeout: 5000 }, (error) => {
        if (error) {
          resolve({ success: false, data: {}, message: `打开失败: ${error.message}`, error: error.message });
        } else {
          resolve({ success: true, data: { url }, message: `已打开: ${url}` });
        }
      });
    });
  }

  /**
   * 执行通用 shell 命令
   */
  private async executeShellCommand(command: string): Promise<SkillResult> {
    return new Promise((resolve) => {
      exec(command, { 
        timeout: 30000,
        shell: process.platform === 'win32' ? 'cmd.exe' : undefined,
      }, (error, stdout, stderr) => {
        if (error) {
          resolve({
            success: false,
            data: { error: error.message, stderr },
            message: `执行失败: ${error.message}`,
            error: stderr || error.message,
          });
        } else {
          resolve({
            success: true,
            data: { output: stdout.trim() },
            message: stdout.trim() || '执行成功',
          });
        }
      });
    });
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

    // 判断技能类型
    const hasImplementation = definition.hasPython || definition.hasJavaScript || definition.hasShell;
    
    if (hasImplementation) {
      logger.info(`加载技能: ${definition.name}`, {
        capabilities: definition.capabilities,
        riskLevel: definition.riskLevel,
        stepByStep: definition.stepByStep,
        hasPython: definition.hasPython,
        hasJavaScript: definition.hasJavaScript,
        hasShell: definition.hasShell,
      });
    } else {
      // 文档型技能：只有 SKILL.md，由 LLM 理解和执行
      logger.info(`加载文档型技能: ${definition.name}`, {
        capabilities: definition.capabilities,
        riskLevel: definition.riskLevel,
        type: 'doc-based',
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
      whenToUse: config.when_to_use,
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
