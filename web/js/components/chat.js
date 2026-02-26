/**
 * 对话组件
 * 
 * v3.2.0 更新：
 * - 支持流式输出
 * - 支持思考过程可视化
 * - 保持现有功能兼容
 */

const ChatComponent = {
    messages: [],
    isLoading: false,
    conversationId: null,

    init() {
        this.messagesContainer = document.getElementById('messages');
        this.messageInput = document.getElementById('message-input');
        this.sendBtn = document.getElementById('send-btn');
        this.clearHistoryBtn = document.getElementById('clear-history-btn');

        this.bindEvents();
        this.loadHistory();
    },

    bindEvents() {
        this.sendBtn.addEventListener('click', () => this.sendMessage());

        this.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        this.messageInput.addEventListener('input', () => {
            Utils.autoResize(this.messageInput);
        });

        this.clearHistoryBtn.addEventListener('click', () => this.clearHistory());
    },

    async loadHistory() {
        try {
            const result = await BaizeAPI.getChatHistory(this.conversationId);
            if (result.success && result.data.history) {
                this.messages = result.data.history;
                if (result.data.conversationId) {
                    this.conversationId = result.data.conversationId;
                }
                this.renderMessages();
            }
        } catch (error) {
            console.error('加载历史失败:', error);
        }
    },

    async sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message || this.isLoading) return;

        this.addMessage('user', message);
        this.messageInput.value = '';
        Utils.autoResize(this.messageInput);

        this.isLoading = true;
        this.sendBtn.disabled = true;

        // 创建助手消息容器
        const msgEl = this.createAssistantMessage();
        let thinkingEl = null;
        let contentEl = null;
        let fullContent = '';

        try {
            await BaizeAPI.chatStream(message, this.conversationId, {
                // 思考事件
                thinking: (data) => {
                    if (!thinkingEl) {
                        thinkingEl = this.createThinkingElement(msgEl);
                    }
                    this.addThinkingStep(thinkingEl, data);
                },

                // 工具调用事件
                tool_call: (data) => {
                    if (!thinkingEl) {
                        thinkingEl = this.createThinkingElement(msgEl);
                    }
                    this.addToolCall(thinkingEl, data);
                },

                // 工具结果事件
                tool_result: (data) => {
                    if (thinkingEl) {
                        this.addToolResult(thinkingEl, data);
                    }
                },

                // 内容事件
                content: (data) => {
                    if (!contentEl) {
                        contentEl = this.createContentElement(msgEl);
                    }
                    fullContent += data.text;
                    this.appendContent(contentEl, data.text);
                },

                // 会话事件
                session: (data) => {
                    this.conversationId = data.sessionId;
                },

                // 完成事件
                done: (data) => {
                    this.addDuration(msgEl, data.duration);
                    
                    // 记录完整消息
                    if (fullContent) {
                        this.messages.push({ role: 'assistant', content: fullContent });
                    }
                },

                // 错误事件
                error: (data) => {
                    this.showError(msgEl, data.message);
                }
            });

        } catch (error) {
            this.showError(msgEl, error.message);
            Utils.toast('发送失败', 'error');
        } finally {
            this.isLoading = false;
            this.sendBtn.disabled = false;
        }
    },

    /**
     * 添加消息（原有方法，保持兼容）
     */
    addMessage(role, content) {
        this.messages.push({ role, content });
        this.renderMessage(role, content);
        Utils.scrollToBottom(this.messagesContainer);
    },

    /**
     * 渲染单条消息
     */
    renderMessage(role, content) {
        const div = document.createElement('div');
        div.className = `message ${role}`;
        
        const formattedContent = this.formatContent(content);
        
        div.innerHTML = `
            <div class="message-content">${formattedContent}</div>
        `;
        this.messagesContainer.appendChild(div);
    },

    /**
     * 创建助手消息容器
     */
    createAssistantMessage() {
        const div = document.createElement('div');
        div.className = 'message assistant';
        div.innerHTML = '<div class="message-body"></div>';
        this.messagesContainer.appendChild(div);
        Utils.scrollToBottom(this.messagesContainer);
        return div;
    },

    /**
     * 创建思考过程元素
     */
    createThinkingElement(msgEl) {
        const body = msgEl.querySelector('.message-body');
        const el = document.createElement('div');
        el.className = 'thinking-process';
        el.innerHTML = `
            <div class="thinking-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span class="icon">🧠</span>
                <span class="title">思考过程</span>
                <span class="toggle">▼</span>
            </div>
            <div class="thinking-steps"></div>
        `;
        body.appendChild(el);
        return el.querySelector('.thinking-steps');
    },

    /**
     * 添加思考步骤
     */
    addThinkingStep(el, data) {
        const step = document.createElement('div');
        step.className = 'thinking-step';
        step.innerHTML = `
            <span class="step-icon">${this.getStageIcon(data.stage)}</span>
            <span class="step-message">${this.escapeHtml(data.message)}</span>
        `;
        el.appendChild(step);
        Utils.scrollToBottom(this.messagesContainer);
    },

    /**
     * 添加工具调用
     */
    addToolCall(el, data) {
        const step = document.createElement('div');
        step.className = 'thinking-step tool-call';
        step.innerHTML = `
            <span class="step-icon">⚡</span>
            <span class="step-message">调用工具: <strong>${data.tool}</strong></span>
        `;
        el.appendChild(step);
        Utils.scrollToBottom(this.messagesContainer);
    },

    /**
     * 添加工具结果
     */
    addToolResult(el, data) {
        const step = document.createElement('div');
        step.className = 'thinking-step tool-result';
        step.innerHTML = `
            <span class="step-icon">${data.success ? '✓' : '✗'}</span>
            <span class="step-message">执行${data.success ? '成功' : '失败'} (${data.duration}ms)</span>
        `;
        el.appendChild(step);
        Utils.scrollToBottom(this.messagesContainer);
    },

    /**
     * 创建内容元素
     */
    createContentElement(msgEl) {
        const body = msgEl.querySelector('.message-body');
        const el = document.createElement('div');
        el.className = 'message-content';
        body.appendChild(el);
        return el;
    },

    /**
     * 追加内容
     */
    appendContent(el, text) {
        el.innerHTML += this.formatContent(text);
        Utils.scrollToBottom(this.messagesContainer);
    },

    /**
     * 添加耗时
     */
    addDuration(msgEl, duration) {
        const body = msgEl.querySelector('.message-body');
        const el = document.createElement('div');
        el.className = 'message-duration';
        el.textContent = `耗时: ${(duration / 1000).toFixed(2)}s`;
        body.appendChild(el);
    },

    /**
     * 显示错误
     */
    showError(msgEl, message) {
        const body = msgEl.querySelector('.message-body');
        const el = document.createElement('div');
        el.className = 'message-error';
        el.textContent = `错误: ${message}`;
        body.appendChild(el);
    },

    /**
     * 获取阶段图标
     */
    getStageIcon(stage) {
        const icons = {
            'matched': '✓',
            'decide': '🤔',
            'reply': '💬',
            'tool_call': '⚡',
            'ask_missing': '❓',
            'clarify': '🔍',
            'unable': '⚠️'
        };
        return icons[stage] || '•';
    },

    /**
     * 格式化消息内容
     */
    formatContent(content) {
        let text = this.escapeHtml(content);
        
        // 代码块
        text = text.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
        
        // 行内代码
        text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        // 粗体
        text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        
        // 斜体
        text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        
        // 链接
        text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        
        // 列表项
        text = text.replace(/^- (.+)$/gm, '<li>$1</li>');
        text = text.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
        
        // 换行符
        text = text.replace(/\n/g, '<br>');
        
        return text;
    },

    /**
     * 转义HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    renderMessages() {
        this.messagesContainer.innerHTML = '';
        this.messages.forEach(msg => {
            this.renderMessage(msg.role, msg.content);
        });
        Utils.scrollToBottom(this.messagesContainer);
    },

    async clearHistory() {
        if (!confirm('确定要清空对话历史吗？')) return;
        try {
            await BaizeAPI.clearChatHistory(this.conversationId);
            this.messages = [];
            this.conversationId = null;
            this.messagesContainer.innerHTML = `
                <div class="message assistant">
                    <div class="message-content">
                        你好！我是白泽，有什么可以帮助你的吗？
                    </div>
                </div>
            `;
            Utils.toast('对话历史已清空', 'success');
        } catch (error) {
            Utils.toast('清空失败', 'error');
        }
    },
};
