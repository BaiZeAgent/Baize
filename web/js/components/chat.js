/**
 * 对话组件
 */

const ChatComponent = {
    // 状态
    messages: [],
    isLoading: false,

    /**
     * 初始化
     */
    init() {
        this.messagesContainer = document.getElementById('messages');
        this.messageInput = document.getElementById('message-input');
        this.sendBtn = document.getElementById('send-btn');
        this.clearHistoryBtn = document.getElementById('clear-history-btn');

        this.bindEvents();
        this.loadHistory();
    },

    /**
     * 绑定事件
     */
    bindEvents() {
        // 发送按钮
        this.sendBtn.addEventListener('click', () => this.sendMessage());

        // 回车发送
        this.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // 自动调整高度
        this.messageInput.addEventListener('input', () => {
            Utils.autoResize(this.messageInput);
        });

        // 清空历史
        this.clearHistoryBtn.addEventListener('click', () => this.clearHistory());
    },

    /**
     * 加载历史
     */
    async loadHistory() {
        try {
            const result = await BaizeAPI.getChatHistory();
            if (result.success && result.data.history) {
                this.messages = result.data.history;
                this.renderMessages();
            }
        } catch (error) {
            console.error('加载历史失败:', error);
        }
    },

    /**
     * 发送消息
     */
    async sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message || this.isLoading) return;

        // 添加用户消息
        this.addMessage('user', message);
        this.messageInput.value = '';
        Utils.autoResize(this.messageInput);

        // 显示加载状态
        this.isLoading = true;
        this.sendBtn.disabled = true;
        this.showTyping();

        try {
            const result = await BaizeAPI.chat(message);
            
            this.hideTyping();

            if (result.success) {
                const response = result.data.response || '任务执行完成';
                this.addMessage('assistant', response);
            } else {
                this.addMessage('assistant', '抱歉，处理失败，请重试。');
            }
        } catch (error) {
            this.hideTyping();
            this.addMessage('assistant', `错误: ${error.message}`);
            Utils.toast('发送失败', 'error');
        } finally {
            this.isLoading = false;
            this.sendBtn.disabled = false;
        }
    },

    /**
     * 添加消息
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
        div.innerHTML = `
            <div class="message-content">${Utils.escapeHtml(content)}</div>
        `;
        this.messagesContainer.appendChild(div);
    },

    /**
     * 渲染所有消息
     */
    renderMessages() {
        this.messagesContainer.innerHTML = '';
        this.messages.forEach(msg => {
            this.renderMessage(msg.role, msg.content);
        });
        Utils.scrollToBottom(this.messagesContainer);
    },

    /**
     * 显示正在输入
     */
    showTyping() {
        const div = document.createElement('div');
        div.className = 'message assistant typing';
        div.id = 'typing-indicator';
        div.innerHTML = `
            <div class="message-content">
                <span class="loading"></span> 思考中...
            </div>
        `;
        this.messagesContainer.appendChild(div);
        Utils.scrollToBottom(this.messagesContainer);
    },

    /**
     * 隐藏正在输入
     */
    hideTyping() {
        const typing = document.getElementById('typing-indicator');
        if (typing) {
            typing.remove();
        }
    },

    /**
     * 清空历史
     */
    async clearHistory() {
        if (!confirm('确定要清空对话历史吗？')) return;

        try {
            await BaizeAPI.clearChatHistory();
            this.messages = [];
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
