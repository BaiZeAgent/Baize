/**
 * 配置组件
 */

const ConfigComponent = {
    /**
     * 初始化
     */
    init() {
        this.apiUrlInput = document.getElementById('api-url');
        this.saveApiConfigBtn = document.getElementById('save-api-config-btn');
        this.testConnectionBtn = document.getElementById('test-connection-btn');
        this.llmProviders = document.getElementById('llm-providers');
        this.versionEl = document.getElementById('version');
        this.uptimeEl = document.getElementById('uptime');

        this.bindEvents();
        this.loadConfig();
    },

    /**
     * 绑定事件
     */
    bindEvents() {
        this.saveApiConfigBtn.addEventListener('click', () => this.saveApiConfig());
        this.testConnectionBtn.addEventListener('click', () => this.testConnection());
    },

    /**
     * 加载配置
     */
    loadConfig() {
        // 加载 API 配置
        const config = BaizeAPI.getConfig();
        this.apiUrlInput.value = config.baseURL;
        
        // 加载 LLM 配置
        this.loadLLMConfig();
    },

    /**
     * 加载 LLM 配置
     */
    async loadLLMConfig() {
        try {
            const result = await BaizeAPI.getLLMConfig();
            
            if (result.success) {
                this.renderLLMProviders(result.data);
            }
        } catch (error) {
            this.llmProviders.innerHTML = '<p>加载失败</p>';
        }
    },

    /**
     * 渲染 LLM 提供商
     */
    renderLLMProviders(data) {
        const providers = data.providers || [];
        
        if (providers.length === 0) {
            this.llmProviders.innerHTML = '<p>暂无可用提供商</p>';
            return;
        }

        this.llmProviders.innerHTML = providers.map(provider => `
            <div class="provider-item">
                <span class="provider-name">${Utils.escapeHtml(provider)}</span>
                ${provider === data.default ? '<span class="badge">默认</span>' : ''}
            </div>
        `).join('');
    },

    /**
     * 保存 API 配置
     */
    saveApiConfig() {
        const baseURL = this.apiUrlInput.value.trim();
        
        if (!baseURL) {
            Utils.toast('请输入 API 地址', 'error');
            return;
        }

        BaizeAPI.setConfig({ baseURL });
        Utils.toast('配置已保存', 'success');
    },

    /**
     * 测试连接
     */
    async testConnection() {
        Utils.toast('正在测试连接...', 'warning');
        
        const result = await BaizeAPI.testConnection();
        
        if (result.connected) {
            Utils.toast('连接成功', 'success');
            this.updateConnectionStatus(true);
            this.versionEl.textContent = result.version || '-';
            this.uptimeEl.textContent = Utils.formatDuration(result.uptime || 0);
        } else {
            Utils.toast(`连接失败: ${result.error}`, 'error');
            this.updateConnectionStatus(false);
        }
    },

    /**
     * 更新连接状态
     */
    updateConnectionStatus(connected) {
        const statusDot = document.querySelector('#connection-status .status-dot');
        const statusText = document.querySelector('#connection-status .status-text');
        
        if (connected) {
            statusDot.classList.remove('offline');
            statusDot.classList.add('online');
            statusText.textContent = '已连接';
        } else {
            statusDot.classList.remove('online');
            statusDot.classList.add('offline');
            statusText.textContent = '未连接';
        }
    },
};
