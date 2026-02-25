/**
 * 白泽3.0 API 服务封装
 * 
 * 与后端 API 完全解耦，只负责 HTTP 通信
 */

const BaizeAPI = (function() {
    // 默认配置
    let config = {
        baseURL: 'http://localhost:3000',
        timeout: 30000,
    };

    /**
     * 设置配置
     */
    function setConfig(newConfig) {
        config = { ...config, ...newConfig };
        // 保存到本地存储
        localStorage.setItem('baize_api_config', JSON.stringify(config));
    }

    /**
     * 获取配置
     */
    function getConfig() {
        const saved = localStorage.getItem('baize_api_config');
        if (saved) {
            config = { ...config, ...JSON.parse(saved) };
        }
        return config;
    }

    /**
     * 发送请求
     */
    async function request(method, path, data = null) {
        const url = `${config.baseURL}${path}`;
        
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
        };

        if (data) {
            options.body = JSON.stringify(data);
        }

        try {
            const response = await fetch(url, options);
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            
            return result;
        } catch (error) {
            console.error('API请求失败:', error);
            throw error;
        }
    }

    // ==================== 对话接口 ====================

    /**
     * 发送消息
     */
    async function chat(message, conversationId) {
        const body = { message };
        if (conversationId) {
            body.conversationId = conversationId;
        }
        return request('POST', '/api/chat', body);
    }

    /**
     * 获取对话历史
     */
    async function getChatHistory(conversationId) {
        if (conversationId) {
            return request('GET', `/api/chat/history?conversationId=${encodeURIComponent(conversationId)}`);
        }
        return request('GET', '/api/chat/history');
    }

    /**
     * 清空对话历史
     */
    async function clearChatHistory(conversationId) {
        if (conversationId) {
            return request('DELETE', `/api/chat/history?conversationId=${encodeURIComponent(conversationId)}`);
        }
        return request('DELETE', '/api/chat/history');
    }

    // ==================== 技能接口 ====================

    /**
     * 获取技能列表
     */
    async function getSkills() {
        return request('GET', '/api/skills');
    }

    /**
     * 获取技能详情
     */
    async function getSkill(name) {
        return request('GET', `/api/skills/${encodeURIComponent(name)}`);
    }

    /**
     * 执行技能
     */
    async function executeSkill(skillName, params = {}) {
        return request('POST', '/api/skills/execute', { skillName, params });
    }

    /**
     * 搜索技能市场
     */
    async function searchSkillMarket(query) {
        return request('GET', `/api/skills/market/search?q=${encodeURIComponent(query)}`);
    }

    /**
     * 安装技能
     */
    async function installSkill(skillId) {
        return request('POST', '/api/skills/market/install', { skillId });
    }

    // ==================== 记忆接口 ====================

    /**
     * 获取记忆统计
     */
    async function getMemoryStats() {
        return request('GET', '/api/memory/stats');
    }

    /**
     * 搜索记忆
     */
    async function searchMemory(query) {
        return request('GET', `/api/memory/search?q=${encodeURIComponent(query)}`);
    }

    // ==================== 成本接口 ====================

    /**
     * 获取成本统计
     */
    async function getCostStats() {
        return request('GET', '/api/cost/stats');
    }

    /**
     * 获取成本配置
     */
    async function getCostConfig() {
        return request('GET', '/api/cost/config');
    }

    /**
     * 更新成本配置
     */
    async function updateCostConfig(newConfig) {
        return request('PUT', '/api/cost/config', newConfig);
    }

    // ==================== 配置接口 ====================

    /**
     * 获取LLM配置
     */
    async function getLLMConfig() {
        return request('GET', '/api/config/llm');
    }

    // ==================== 健康检查 ====================

    /**
     * 健康检查
     */
    async function healthCheck() {
        return request('GET', '/health');
    }

    /**
     * 测试连接
     */
    async function testConnection() {
        try {
            const result = await healthCheck();
            return {
                connected: true,
                version: result.data?.version,
                uptime: result.data?.uptime,
            };
        } catch (error) {
            return {
                connected: false,
                error: error.message,
            };
        }
    }

    // 初始化时加载配置
    getConfig();

    // 导出公共接口
    return {
        // 配置
        setConfig,
        getConfig,
        
        // 对话
        chat,
        getChatHistory,
        clearChatHistory,
        
        // 技能
        getSkills,
        getSkill,
        executeSkill,
        searchSkillMarket,
        installSkill,
        
        // 记忆
        getMemoryStats,
        searchMemory,
        
        // 成本
        getCostStats,
        getCostConfig,
        updateCostConfig,
        
        // 配置
        getLLMConfig,
        
        // 健康检查
        healthCheck,
        testConnection,
    };
})();

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BaizeAPI;
}
