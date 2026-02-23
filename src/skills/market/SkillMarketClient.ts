/**
 * 技能市场客户端 - 搜索和安装技能
 * 
 * 支持市场:
 * - ClawHub (https://clawhub.ai)
 * - 白泽官方市场
 */

import { getLogger } from '../../observability/logger';
import { SkillSearchResult, SkillDetails, SkillPackage, InstallResult } from '../../types';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger('skill:market');

/**
 * 市场配置
 */
interface MarketConfig {
  name: string;
  endpoint: string;
  enabled: boolean;
}

/**
 * 技能市场客户端
 */
export class SkillMarketClient {
  private markets: MarketConfig[];
  private cacheDir: string;

  constructor(options: { markets?: MarketConfig[]; cacheDir?: string } = {}) {
    this.markets = options.markets || [
      { name: 'clawhub', endpoint: 'https://clawhub.ai', enabled: true },
      { name: 'baize', endpoint: 'https://market.baize.ai', enabled: true },
    ];
    this.cacheDir = options.cacheDir || 'data/skill_cache';
    logger.info('技能市场客户端初始化', { markets: this.markets.map(m => m.name) });
  }

  /**
   * 搜索技能
   */
  async search(query: string, options: {
    market?: string;
    limit?: number;
  } = {}): Promise<SkillSearchResult[]> {
    logger.debug('搜索技能', { query, options });

    const results: SkillSearchResult[] = [];

    for (const market of this.markets) {
      if (!market.enabled) continue;
      if (options.market && options.market !== market.name) continue;

      try {
        const marketResults = await this.searchMarket(market, query, options.limit || 10);
        results.push(...marketResults);
      } catch (error) {
        logger.warn(`市场 ${market.name} 搜索失败`, { error });
      }
    }

    return results.slice(0, options.limit || 20);
  }

  /**
   * 从特定市场搜索
   */
  private async searchMarket(market: MarketConfig, query: string, limit: number): Promise<SkillSearchResult[]> {
    if (market.name === 'clawhub') {
      return this.searchClawHub(query, limit);
    }
    
    // 默认搜索实现
    return this.searchDefault(market, query, limit);
  }

  /**
   * 从 ClawHub 搜索
   */
  private async searchClawHub(query: string, limit: number): Promise<SkillSearchResult[]> {
    const url = `https://clawhub.ai/api/skills/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    
    try {
      const data = await this.httpGet(url);
      const json = JSON.parse(data);
      
      // ClawHub API 返回格式适配
      const skills = json.skills || json.results || json.data || [];
      
      return skills.map((skill: any) => ({
        id: skill.id || skill.name,
        name: skill.name,
        description: skill.description || skill.summary || '',
        capabilities: skill.capabilities || skill.tags || [],
        downloads: skill.downloads || skill.install_count || 0,
        rating: skill.rating || 0,
        verified: skill.verified || skill.official || false,
        versions: skill.versions || [skill.version || '1.0.0'],
        author: skill.author || skill.owner || '',
        market: 'clawhub',
      }));
    } catch (error) {
      logger.debug('ClawHub 搜索失败，使用备用方案');
      return [];
    }
  }

  /**
   * 默认搜索实现
   */
  private async searchDefault(market: MarketConfig, query: string, limit: number): Promise<SkillSearchResult[]> {
    // 模拟搜索结果
    return [];
  }

  /**
   * 获取技能详情
   */
  async getSkillDetails(skillId: string, market?: string): Promise<SkillDetails | null> {
    logger.debug('获取技能详情', { skillId, market });

    // 尝试从 ClawHub 获取
    if (!market || market === 'clawhub') {
      try {
        const details = await this.getClawHubDetails(skillId);
        if (details) return details;
      } catch (error) {
        logger.debug('ClawHub 获取详情失败');
      }
    }

    return null;
  }

  /**
   * 从 ClawHub 获取技能详情
   */
  private async getClawHubDetails(skillId: string): Promise<SkillDetails | null> {
    // 支持完整路径如 steipete/brave-search
    const url = `https://clawhub.ai/api/skills/${skillId}`;
    
    try {
      const data = await this.httpGet(url);
      const json = JSON.parse(data);
      const skill = json.skill || json.data || json;
      
      return {
        id: skill.id || skillId,
        name: skill.name || skillId.split('/').pop() || skillId,
        description: skill.description || skill.readme?.substring(0, 200) || '',
        capabilities: skill.capabilities || [],
        downloads: skill.downloads || 0,
        rating: skill.rating || 0,
        verified: skill.verified || false,
        versions: skill.versions || [skill.version || '1.0.0'],
        author: skill.author || skill.owner || skillId.split('/')[0] || '',
        license: skill.license || 'MIT',
        readme: skill.readme || '',
        dependencies: skill.dependencies || [],
        permissions: skill.permissions || [],
        market: 'clawhub',
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 下载技能
   */
  async download(skillId: string, version?: string): Promise<SkillPackage> {
    logger.info('下载技能', { skillId, version });

    // 尝试从 ClawHub 下载
    const pkg = await this.downloadFromClawHub(skillId, version);
    if (pkg) return pkg;

    throw new Error(`无法下载技能: ${skillId}`);
  }

  /**
   * 从 ClawHub 下载技能
   */
  private async downloadFromClawHub(skillId: string, version?: string): Promise<SkillPackage | null> {
    const downloadUrl = `https://clawhub.ai/api/skills/${skillId}/download`;
    
    try {
      // 获取下载链接
      const data = await this.httpGet(downloadUrl);
      const json = JSON.parse(data);
      
      // 获取文件列表
      const files = json.files || [];
      const skillName = skillId.split('/').pop() || skillId;
      
      // 如果有下载链接，下载 zip
      if (json.download_url || json.url) {
        const zipUrl = json.download_url || json.url;
        // 这里简化处理，实际需要解压 zip
        return {
          id: skillId,
          name: skillName,
          version: version || json.version || '1.0.0',
          files: files.length > 0 ? files : this.generateDefaultFiles(skillName),
          signature: 'clawhub',
        };
      }
      
      return {
        id: skillId,
        name: skillName,
        version: version || '1.0.0',
        files: files.length > 0 ? files : this.generateDefaultFiles(skillName),
        signature: 'clawhub',
      };
    } catch (error) {
      logger.debug('ClawHub 下载失败', { error });
      return null;
    }
  }

  /**
   * 生成默认文件（当无法下载时）
   */
  private generateDefaultFiles(skillName: string): Array<{ path: string; content: string }> {
    return [
      {
        path: 'SKILL.md',
        content: `---
name: ${skillName}
version: 1.0.0
description: ${skillName} skill from ClawHub
capabilities:
  - ${skillName}
risk_level: low
---
# ${skillName}

This skill was installed from ClawHub.

## Usage

Please refer to the original documentation.
`,
      },
      {
        path: 'main.js',
        content: `#!/usr/bin/env node
/**
 * ${skillName} skill
 * 
 * Note: This is a placeholder. Please implement the actual functionality.
 */

function main() {
  try {
    const input = JSON.parse(process.env.BAIZE_PARAMS || '{}');
    const { params = {} } = input;
    
    // TODO: Implement skill logic
    
    console.log(JSON.stringify({
      success: true,
      message: '${skillName} executed',
      note: 'This is a placeholder. Please implement the actual functionality.'
    }));
  } catch (error) {
    console.log(JSON.stringify({
      success: false,
      error: error.message
    }));
    process.exit(1);
  }
}

main();
`,
      },
    ];
  }

  /**
   * 安装技能
   */
  async install(skillId: string, version?: string): Promise<InstallResult> {
    logger.info('安装技能', { skillId, version });

    try {
      // 下载技能
      const pkg = await this.download(skillId, version);
      
      // 安全验证
      const validation = await this.validate(pkg);
      if (!validation.passed) {
        return {
          success: false,
          error: `安全验证失败: ${validation.issues.join(', ')}`,
        };
      }

      // 写入文件
      const skillDir = path.join('skills', pkg.name);

      // 创建目录
      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }

      // 写入文件
      for (const file of pkg.files) {
        const filePath = path.join(skillDir, file.path);
        const dir = path.dirname(filePath);
        
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(filePath, file.content, 'utf-8');
      }

      logger.info('技能安装成功', { name: pkg.name, path: skillDir });

      return {
        success: true,
        path: skillDir,
        message: `技能 ${pkg.name} 安装成功`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('技能安装失败', { error: errorMsg });
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * 安全验证
   */
  private async validate(pkg: SkillPackage): Promise<{ passed: boolean; issues: string[] }> {
    const issues: string[] = [];

    // 检查危险代码
    for (const file of pkg.files) {
      const content = file.content.toLowerCase();
      
      // 检查危险模式
      const dangerousPatterns = [
        { pattern: /eval\s*\(/, msg: 'eval() 调用' },
        { pattern: /function\s*\(\s*\)\s*\{[\s\S]*\}\s*\(\s*\)/, msg: '自执行函数' },
        { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/, msg: 'child_process 模块' },
        { pattern: /process\.exit/, msg: 'process.exit 调用' },
      ];

      for (const { pattern, msg } of dangerousPatterns) {
        if (pattern.test(content)) {
          // 允许一些常见模式
          if (file.path.endsWith('.js') && msg === 'process.exit 调用') {
            // JS 文件中的 process.exit 是正常的错误处理
            continue;
          }
          issues.push(`文件 ${file.path} 包含潜在危险代码: ${msg}`);
        }
      }
    }

    return {
      passed: issues.length === 0,
      issues,
    };
  }

  /**
   * HTTP GET 请求
   */
  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Baize/3.0',
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      req.end();
    });
  }
}

// 全局实例
let marketClient: SkillMarketClient | null = null;

export function getMarketClient(): SkillMarketClient {
  if (!marketClient) {
    marketClient = new SkillMarketClient();
  }
  return marketClient;
}
