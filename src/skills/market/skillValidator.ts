/**
 * 技能验证和修复工具
 * 
 * 解决技能调用失败的常见问题：
 * 1. 参数名不匹配
 * 2. 生成的代码语法错误
 * 3. URL 模板处理不正确
 * 4. 缺少必要的错误处理
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../observability/logger';

const logger = getLogger('skill:validator');

/**
 * 参数映射表 - 标准化参数名
 */
const PARAM_ALIASES: Record<string, string[]> = {
  'location': ['location', 'city', 'place', 'area', 'region'],
  'query': ['query', 'q', 'search', 'keyword', 'text', 'input'],
  'url': ['url', 'link', 'uri', 'endpoint'],
  'path': ['path', 'filepath', 'file', 'filename'],
  'content': ['content', 'text', 'body', 'data', 'message'],
  'name': ['name', 'title', 'label'],
  'format': ['format', 'type', 'style'],
  'limit': ['limit', 'max', 'count', 'size'],
};

/**
 * 标准化参数名
 */
export function normalizeParamName(paramName: string): string {
  const lowerName = paramName.toLowerCase();
  
  for (const [standard, aliases] of Object.entries(PARAM_ALIASES)) {
    if (aliases.includes(lowerName)) {
      return standard;
    }
  }
  
  return paramName;
}

/**
 * 验证 JavaScript 代码语法
 */
export function validateJavaScriptCode(code: string): { valid: boolean; error?: string } {
  try {
    // 使用 Function 构造函数进行语法检查
    new Function(code);
    return { valid: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { valid: false, error: errorMsg };
  }
}

/**
 * 修复生成的 main.js 代码
 */
export function fixGeneratedCode(code: string, skillName: string): string {
  let fixedCode = code;
  
  // 1. 确保有 module.exports
  if (!fixedCode.includes('module.exports')) {
    fixedCode += '\n\nmodule.exports = { main };\n';
  }
  
  // 2. 确保有自动执行部分
  if (!fixedCode.includes('if (require.main === module)')) {
    fixedCode += `
// 自动执行：从环境变量或命令行参数读取
if (require.main === module) {
  let params = {};
  if (process.env.BAIZE_PARAMS) {
    try {
      const parsed = JSON.parse(process.env.BAIZE_PARAMS);
      params = parsed.params || parsed;
    } catch (e) {}
  }
  if (process.argv.length > 2) {
    try {
      params = JSON.parse(process.argv[2]);
    } catch (e) {
      params = { query: process.argv[2] };
    }
  }
  main(params).then(result => {
    console.log(JSON.stringify(result));
    process.exit(result.success ? 0 : 1);
  }).catch(error => {
    console.log(JSON.stringify({ success: false, message: error.message }));
    process.exit(1);
  });
}
`;
  }
  
  // 3. 添加参数标准化
  if (fixedCode.includes('async function main(params)')) {
    fixedCode = fixedCode.replace(
      'async function main(params) {',
      `async function main(params) {
  // 参数标准化
  params = normalizeParams(params);`
    );
    
    // 添加 normalizeParams 函数
    const normalizeFunc = `
function normalizeParams(params) {
  const normalized = { ...params };
  const aliases = ${JSON.stringify(PARAM_ALIASES)};
  
  for (const [standard, aliasList] of Object.entries(aliases)) {
    for (const alias of aliasList) {
      if (params[alias] !== undefined && normalized[standard] === undefined) {
        normalized[standard] = params[alias];
      }
    }
  }
  
  return normalized;
}

`;
    fixedCode = normalizeFunc + fixedCode;
  }
  
  // 4. 确保返回格式正确
  if (!fixedCode.includes('success:') || !fixedCode.includes('message:')) {
    logger.warn('代码可能缺少正确的返回格式', { skillName });
  }
  
  return fixedCode;
}

/**
 * 生成标准的 main.js 模板
 */
export function generateStandardMainJs(
  skillName: string,
  description: string,
  inputSchema: Record<string, unknown> | null,
  curlCommand: string | null
): string {
  const params = inputSchema?.properties ? Object.keys(inputSchema.properties as Record<string, unknown>) : [];
  const requiredParams = (inputSchema?.required as string[]) || [];
  
  // 从 curl 命令提取 URL
  let urlTemplate = '';
  if (curlCommand) {
    const urlMatch = curlCommand.match(/["']([^"']+)["']/);
    if (urlMatch) {
      urlTemplate = urlMatch[1];
    }
  }
  
  const code = `/**
 * ${skillName} skill - 自动生成的跨平台实现
 * ${description}
 */

/**
 * 参数标准化
 */
function normalizeParams(params) {
  const normalized = { ...params };
  const aliases = ${JSON.stringify(PARAM_ALIASES)};
  
  for (const [standard, aliasList] of Object.entries(aliases)) {
    for (const alias of aliasList) {
      if (params[alias] !== undefined && normalized[standard] === undefined) {
        normalized[standard] = params[alias];
      }
    }
  }
  
  return normalized;
}

/**
 * 执行技能
 * @param {Object} params - 参数对象
 * @returns {Promise<{success: boolean, data: any, message: string}>}
 */
async function main(params) {
  try {
    // 参数标准化
    params = normalizeParams(params);
    
    // 提取参数
    ${params.map(p => `const ${p} = params.${p} || '';`).join('\n    ')}
    ${requiredParams.map(p => `if (!${p}) { return { success: false, message: '缺少必需参数: ${p}' }; }`).join('\n    ')}
    
    // 构建 URL
    let url = '${urlTemplate}';
    ${urlTemplate ? `
    // 替换参数占位符
    ${params.map(p => `url = url.replace(/\${${p}}/g, encodeURIComponent(${p}));`).join('\n    ')}
    url = url.replace(/\${query}/g, encodeURIComponent(params.query || params.location || ''));
    ` : '// TODO: 实现 URL 构建'}
    
    // 确保有协议
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    // 发送请求
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Baize/3.0',
        'Accept': '*/*',
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      return {
        success: false,
        message: \`HTTP 请求失败: \${response.status}\`,
        data: { status: response.status }
      };
    }
    
    const result = await response.text();
    
    return {
      success: true,
      data: { result },
      message: result
    };
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: errorMsg,
      data: { error: errorMsg }
    };
  }
}

// 自动执行：从环境变量或命令行参数读取
if (require.main === module) {
  let params = {};
  if (process.env.BAIZE_PARAMS) {
    try {
      const parsed = JSON.parse(process.env.BAIZE_PARAMS);
      params = parsed.params || parsed;
    } catch (e) {}
  }
  if (process.argv.length > 2) {
    try {
      params = JSON.parse(process.argv[2]);
    } catch (e) {
      params = { query: process.argv[2] };
    }
  }
  main(params).then(result => {
    console.log(JSON.stringify(result));
    process.exit(result.success ? 0 : 1);
  }).catch(error => {
    console.log(JSON.stringify({ success: false, message: error.message }));
    process.exit(1);
  });
}

module.exports = { main };
`;

  return code;
}

/**
 * 验证技能目录
 */
export function validateSkillDirectory(skillDir: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // 检查目录是否存在
  if (!fs.existsSync(skillDir)) {
    errors.push(`技能目录不存在: ${skillDir}`);
    return { valid: false, errors, warnings };
  }
  
  // 检查 SKILL.md
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) {
    errors.push('缺少 SKILL.md 文件');
  } else {
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    
    // 检查 frontmatter
    if (!content.startsWith('---')) {
      warnings.push('SKILL.md 缺少 YAML frontmatter');
    }
    
    // 检查必要字段
    if (!content.includes('name:')) {
      warnings.push('SKILL.md 缺少 name 字段');
    }
    if (!content.includes('description:')) {
      warnings.push('SKILL.md 缺少 description 字段');
    }
  }
  
  // 检查实现文件
  const mainJsPath = path.join(skillDir, 'main.js');
  const mainPyPath = path.join(skillDir, 'main.py');
  const runShPath = path.join(skillDir, 'run.sh');
  
  if (!fs.existsSync(mainJsPath) && !fs.existsSync(mainPyPath) && !fs.existsSync(runShPath)) {
    // 检查是否有 curl 命令
    if (fs.existsSync(skillMdPath)) {
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      if (!content.includes('curl')) {
        errors.push('没有找到实现文件 (main.js/main.py/run.sh) 且 SKILL.md 中没有 curl 命令');
      } else {
        warnings.push('使用文档型技能（从 SKILL.md 提取 curl 命令）');
      }
    } else {
      errors.push('没有找到实现文件');
    }
  }
  
  // 验证 main.js 语法
  if (fs.existsSync(mainJsPath)) {
    const code = fs.readFileSync(mainJsPath, 'utf-8');
    const validation = validateJavaScriptCode(code);
    if (!validation.valid) {
      errors.push(`main.js 语法错误: ${validation.error}`);
    }
    
    // 检查导出
    if (!code.includes('module.exports')) {
      warnings.push('main.js 缺少 module.exports');
    }
    if (!code.includes('async function main') && !code.includes('function main')) {
      warnings.push('main.js 缺少 main 函数');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 修复技能目录
 */
export function fixSkillDirectory(skillDir: string): {
  fixed: boolean;
  changes: string[];
  errors: string[];
} {
  const changes: string[] = [];
  const errors: string[] = [];
  
  try {
    // 验证目录
    const validation = validateSkillDirectory(skillDir);
    
    // 如果 main.js 有语法错误，尝试修复
    const mainJsPath = path.join(skillDir, 'main.js');
    if (fs.existsSync(mainJsPath)) {
      const code = fs.readFileSync(mainJsPath, 'utf-8');
      const codeValidation = validateJavaScriptCode(code);
      
      if (!codeValidation.valid) {
        // 尝试修复
        const skillName = path.basename(skillDir);
        const fixedCode = fixGeneratedCode(code, skillName);
        
        // 再次验证
        const fixedValidation = validateJavaScriptCode(fixedCode);
        if (fixedValidation.valid) {
          fs.writeFileSync(mainJsPath, fixedCode, 'utf-8');
          changes.push('修复了 main.js 的语法错误');
        } else {
          errors.push(`无法修复 main.js: ${fixedValidation.error}`);
        }
      }
    }
    
    // 如果没有 main.js 但有 curl 命令，生成 main.js
    if (!fs.existsSync(mainJsPath) && fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
      const skillMd = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8');
      
      // 提取 curl 命令
      const curlMatch = skillMd.match(/```bash\n([\s\S]*?curl[\s\S]*?)\n```/);
      
      if (curlMatch) {
        const skillName = path.basename(skillDir);
        const descMatch = skillMd.match(/description:\s*["']?([^"'\n]+)["']?/);
        const description = descMatch ? descMatch[1] : skillName;
        
        // 提取 input_schema
        let inputSchema: Record<string, unknown> | null = null;
        const schemaMatch = skillMd.match(/input_schema:\s*\n([\s\S]*?)(?=\n\w+:|\n---)/);
        if (schemaMatch) {
          try {
            const YAML = require('yaml');
            inputSchema = YAML.parse(`input_schema:\n${schemaMatch[1]}`).input_schema;
          } catch (e) {
            logger.warn('解析 input_schema 失败', { skillName });
          }
        }
        
        const generatedCode = generateStandardMainJs(skillName, description, inputSchema, curlMatch[1]);
        const codeValidation = validateJavaScriptCode(generatedCode);
        
        if (codeValidation.valid) {
          fs.writeFileSync(mainJsPath, generatedCode, 'utf-8');
          changes.push('生成了标准的 main.js 文件');
        } else {
          errors.push(`生成的代码有语法错误: ${codeValidation.error}`);
        }
      }
    }
    
    return {
      fixed: changes.length > 0 && errors.length === 0,
      changes,
      errors,
    };
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    errors.push(errorMsg);
    return { fixed: false, changes, errors };
  }
}

/**
 * 测试技能执行
 */
export async function testSkillExecution(
  skillDir: string,
  testParams: Record<string, unknown>
): Promise<{ success: boolean; result?: any; error?: string }> {
  return new Promise((resolve) => {
    const mainJsPath = path.join(skillDir, 'main.js');
    
    if (!fs.existsSync(mainJsPath)) {
      resolve({ success: false, error: 'main.js 不存在' });
      return;
    }
    
    const { spawn } = require('child_process');
    const proc = spawn(process.execPath, [mainJsPath], {
      cwd: skillDir,
      env: {
        ...process.env,
        BAIZE_PARAMS: JSON.stringify({ params: testParams }),
      },
      timeout: 30000,
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString('utf-8');
    });
    
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8');
    });
    
    proc.on('close', (code: number) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout.trim());
          resolve({ success: true, result });
        } catch {
          resolve({ success: true, result: { output: stdout.trim() } });
        }
      } else {
        resolve({ success: false, error: stderr || stdout || `退出码: ${code}` });
      }
    });
    
    proc.on('error', (error: Error) => {
      resolve({ success: false, error: error.message });
    });
  });
}
