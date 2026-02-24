/**
 * ClawHub 技能市场客户端
 * 
 * 从 ClawHub (https://clawhub.ai) 搜索和安装技能
 * 自动转换为白泽格式
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as zlib from 'zlib';
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
   * 简单的 ZIP 解析，不依赖外部库
   */
  private parseZip(buffer: Buffer): Map<string, Buffer> {
    const files = new Map<string, Buffer>();
    
    try {
      let offset = 0;
      
      // 查找中央目录结束标记
      const endOfCentralDir = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      if (endOfCentralDir === -1) {
        logger.error('无效的 ZIP 文件');
        return files;
      }

      // 读取中央目录偏移
      const centralDirOffset = buffer.readUInt32LE(endOfCentralDir + 16);
      const centralDirSize = buffer.readUInt32LE(endOfCentralDir + 12);
      
      // 遍历中央目录
      offset = centralDirOffset;
      const centralDirEnd = centralDirOffset + centralDirSize;
      
      while (offset < centralDirEnd) {
        // 检查中央目录文件头标记
        if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
        
        // 读取文件信息
        const compressionMethod = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const filenameLength = buffer.readUInt16LE(offset + 28);
        const extraFieldLength = buffer.readUInt16LE(offset + 30);
        const fileCommentLength = buffer.readUInt16LE(offset + 32);
        const localHeaderOffset = buffer.readUInt32LE(offset + 42);
        
        // 读取文件名
        const filename = buffer.toString('utf8', offset + 46, offset + 46 + filenameLength);
        
        // 读取本地文件头
        const localOffset = localHeaderOffset;
        const localFilenameLength = buffer.readUInt16LE(localOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localOffset + 28);
        const dataOffset = localOffset + 30 + localFilenameLength + localExtraLength;
        
        // 提取文件数据
        const compressedData = buffer.slice(dataOffset, dataOffset + compressedSize);
        
        let fileData: Buffer;
        if (compressionMethod === 0) {
          // 无压缩
          fileData = compressedData;
        } else if (compressionMethod === 8) {
          // Deflate 压缩
          fileData = zlib.inflateRawSync(compressedData);
        } else {
          logger.warn('不支持的压缩方法', { compressionMethod, filename });
          offset += 46 + filenameLength + extraFieldLength + fileCommentLength;
          continue;
        }
        
        files.set(filename, fileData);
        
        // 移动到下一个条目
        offset += 46 + filenameLength + extraFieldLength + fileCommentLength;
      }
    } catch (error) {
      logger.error('解析 ZIP 失败', { error });
    }
    
    return files;
  }

  /**
   * 转换 ClawHub 格式为白泽格式
   */
  private convertToBaizeFormat(content: string, slug: string): string {
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

    // 提取 metadata.openclaw 中的环境变量
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

      // 写入文件
      for (const [filename, content] of files) {
        // 跳过元数据文件
        if (filename === '_meta.json') continue;
        
        const filePath = path.join(skillDir, filename);
        const dir = path.dirname(filePath);
        
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // 转换 SKILL.md 格式
        let fileContent = content.toString('utf-8');
        if (filename.toLowerCase() === 'skill.md') {
          fileContent = this.convertToBaizeFormat(fileContent, slug);
        }

        fs.writeFileSync(filePath, fileContent, 'utf-8');
        logger.debug('写入文件', { path: filePath, size: content.length });
      }

      // 如果没有 main.js，尝试创建入口文件
      const hasMainJs = files.has('main.js');
      const hasMainPy = files.has('main.py');
      const jsFiles = Array.from(files.keys()).filter(f => f.endsWith('.js') && f !== 'main.js');

      if (!hasMainJs && !hasMainPy && jsFiles.length > 0) {
        // 创建 main.js 作为入口
        const mainJsContent = `/**
 * ${slug} skill - 自动生成的入口文件
 */

// 导入原始实现
const impl = require('./${jsFiles[0].replace('.js', '')}');

/**
 * 执行技能
 */
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

      return {
        success: true,
        path: skillDir,
        message: `技能 ${slug}@${targetVersion} 安装成功 (${files.size} 个文件)`,
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
      // 递归删除目录
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
