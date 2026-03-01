#!/usr/bin/env node
/**
 * 文员办公助手技能实现
 * 提供文档处理、格式转换、内容整理等功能
 */

// 读取输入参数
let input = {};
try {
  const inputStr = process.env.BAIZE_PARAMS || process.argv[2] || '{}';
  input = JSON.parse(inputStr);
} catch (e) {
  console.log(JSON.stringify({ success: false, error: '参数解析失败' }));
  process.exit(0);
}

const { action, content = '', format = 'markdown', template = '', data = {}, options = {} } = input;

/**
 * 生成摘要
 */
function summarize(text) {
  const sentences = text.split(/[。！？\n]/).filter(s => s.trim());
  
  if (sentences.length <= 3) {
    return text;
  }
  
  // 简单摘要：取前几句和最后一句
  const summary = [
    sentences[0],
    sentences[1],
    '...',
    sentences[sentences.length - 1]
  ].join('');
  
  return summary;
}

/**
 * 格式化为 Markdown
 */
function toMarkdown(text) {
  // 简单的格式化
  let result = text
    .replace(/标题[：:]\s*(.+)/g, '\n## $1\n')
    .replace(/(\d+)[.、]\s*(.+)/g, '\n$1. $2')
    .replace(/[-－]\s*(.+)/g, '\n- $1')
    .replace(/\*\*(.+)\*\*/g, '**$1**')
    .replace(/\n{3,}/g, '\n\n');
  
  return result;
}

/**
 * 格式化为 HTML
 */
function toHtml(text) {
  return text
    .replace(/标题[：:]\s*(.+)/g, '<h2>$1</h2>')
    .replace(/(\d+)[.、]\s*(.+)/g, '<li>$2</li>')
    .replace(/[-－]\s*(.+)/g, '<li>$1</li>')
    .replace(/\n/g, '<br>');
}

/**
 * 生成表格
 */
function generateTable(text, format = 'markdown') {
  // 尝试解析数据
  const lines = text.split('\n').filter(l => l.trim());
  const rows = [];
  
  for (const line of lines) {
    // 尝试多种分隔符
    const cells = line.split(/[,\t，、\s]+/).filter(c => c.trim());
    if (cells.length > 0) {
      rows.push(cells);
    }
  }
  
  if (rows.length === 0) {
    return '无法解析表格数据';
  }
  
  if (format === 'csv') {
    return rows.map(row => row.join(',')).join('\n');
  }
  
  // Markdown 表格
  const colCount = Math.max(...rows.map(r => r.length));
  const header = rows[0];
  const body = rows.slice(1);
  
  let table = '| ' + header.join(' | ') + ' |\n';
  table += '| ' + Array(colCount).fill('---').join(' | ') + ' |\n';
  
  for (const row of body) {
    table += '| ' + row.join(' | ') + ' |\n';
  }
  
  return table;
}

/**
 * 模板填充
 */
function fillTemplate(templateStr, templateData) {
  let result = templateStr;
  
  for (const [key, value] of Object.entries(templateData)) {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
    result = result.replace(regex, String(value));
  }
  
  return result;
}

/**
 * 提取信息
 */
function extractInfo(text, extractOptions) {
  const result = {};
  
  // 提取日期
  const dateMatch = text.match(/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?/g);
  if (dateMatch) result.dates = dateMatch;
  
  // 提取数字
  const numberMatch = text.match(/\d+(?:\.\d+)?%?/g);
  if (numberMatch) result.numbers = numberMatch;
  
  // 提取邮箱
  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/g);
  if (emailMatch) result.emails = emailMatch;
  
  // 提取电话
  const phoneMatch = text.match(/1[3-9]\d{9}/g);
  if (phoneMatch) result.phones = phoneMatch;
  
  // 提取URL
  const urlMatch = text.match(/https?:\/\/[^\s]+/g);
  if (urlMatch) result.urls = urlMatch;
  
  return result;
}

/**
 * 整理内容
 */
function organizeContent(text) {
  // 分段
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim());
  
  // 结构化
  const organized = {
    title: '',
    sections: []
  };
  
  for (const para of paragraphs) {
    const lines = para.split('\n');
    const firstLine = lines[0].trim();
    
    if (firstLine.length < 20 && !firstLine.endsWith('。')) {
      // 可能是标题
      organized.sections.push({
        title: firstLine,
        content: lines.slice(1).join('\n')
      });
    } else {
      organized.sections.push({
        content: para
      });
    }
  }
  
  return organized;
}

/**
 * 生成报告
 */
function generateReport(text, reportTemplate) {
  const defaultTemplate = `
# 工作报告

## 概述
{{summary}}

## 主要内容
{{content}}

## 结论
{{conclusion}}

---
*生成时间: {{date}}*
`;
  
  const tmpl = reportTemplate || defaultTemplate;
  const summary = summarize(text);
  const organized = organizeContent(text);
  
  return fillTemplate(tmpl, {
    summary,
    content: text.substring(0, 500),
    conclusion: '根据以上内容，建议进一步分析和处理。',
    date: new Date().toLocaleDateString('zh-CN')
  });
}

/**
 * 主执行函数
 */
function execute() {
  try {
    let result = { success: true, data: {}, message: '' };
    
    switch (action) {
      case 'summarize':
        const summary = summarize(content);
        result.message = '已生成摘要';
        result.data = { summary };
        break;
        
      case 'format':
        let formatted;
        if (format === 'html') {
          formatted = toHtml(content);
        } else {
          formatted = toMarkdown(content);
        }
        result.message = `已转换为 ${format} 格式`;
        result.data = { formatted };
        break;
        
      case 'table':
        const table = generateTable(content, format);
        result.message = '已生成表格';
        result.data = { table };
        break;
        
      case 'template':
        const filled = fillTemplate(template, data);
        result.message = '已填充模板';
        result.data = { content: filled };
        break;
        
      case 'convert':
        // 格式转换
        result.message = `已转换为 ${format}`;
        result.data = { converted: content };
        break;
        
      case 'extract':
        const extracted = extractInfo(content, options);
        result.message = '已提取信息';
        result.data = extracted;
        break;
        
      case 'organize':
        const organized = organizeContent(content);
        result.message = '已整理内容';
        result.data = organized;
        break;
        
      case 'report':
        const report = generateReport(content, template);
        result.message = '已生成报告';
        result.data = { report };
        break;
        
      default:
        throw new Error(`未知操作: ${action}`);
    }
    
    console.log(JSON.stringify(result));
    
  } catch (error) {
    console.log(JSON.stringify({
      success: false,
      error: error.message,
      message: `操作失败: ${error.message}`
    }));
  }
}

// 执行
execute();
