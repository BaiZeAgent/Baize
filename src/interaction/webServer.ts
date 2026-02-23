/**
 * 静态文件服务器
 * 
 * 用于提供 Web 前端静态文件
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const PORT = process.env.WEB_PORT || 8080;
const WEB_DIR = path.join(__dirname, '../../web');

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

/**
 * 创建静态文件服务器
 */
export function createWebServer(): http.Server {
    const server = http.createServer((req, res) => {
        // 解析路径
        let filePath = path.join(WEB_DIR, req.url === '/' ? 'index.html' : req.url || '');
        
        // 获取文件扩展名
        const ext = path.extname(filePath).toLowerCase();
        
        // 默认文件
        if (!ext) {
            filePath = path.join(filePath, 'index.html');
        }

        // 读取文件
        fs.readFile(filePath, (err, data) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    // 文件不存在，返回 index.html (SPA 支持)
                    fs.readFile(path.join(WEB_DIR, 'index.html'), (err2, data2) => {
                        if (err2) {
                            res.writeHead(404);
                            res.end('Not Found');
                        } else {
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end(data2);
                        }
                    });
                } else {
                    res.writeHead(500);
                    res.end('Server Error');
                }
                return;
            }

            // 设置 Content-Type
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    });

    return server;
}

/**
 * 启动 Web 服务器
 */
export function startWebServer(port: number = Number(PORT)): http.Server {
    const server = createWebServer();
    
    server.listen(port, () => {
        console.log(`Web 服务器已启动: http://localhost:${port}`);
    });

    return server;
}

// 直接运行时启动服务器
if (require.main === module) {
    startWebServer();
}
