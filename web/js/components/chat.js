/**
 * 对话组件
 * 
 * v3.1.6 更新：
 * - 修复换行符显示问题
 * - 添加简单的Markdown渲染
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
        this.showTyping();

        try {
            const result = await BaizeAPI.chat(message, this.conversationId);
            
            this.hideTyping();

            if (result.success) {
                if (result.data.conversationId) {
                    this.conversationId = result.data.conversationId;
                }
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
        
        // 处理内容：保留换行符，渲染简单Markdown
        const formattedContent = this.formatContent(content);
        
        div.innerHTML = `
            <div class="message-content">${formattedContent}</div>
        `;
        this.messagesContainer.appendChild(div);
    },

    /**
     * 格式化消息内容
     * - 保留换行符
     * - 渲染简单Markdown
     */
    formatContent(content) {
        // 先转义HTML
        let text = this.escapeHtml(content);
        
        // 渲染Markdown
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
        
        // 有序列表
        text = text.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
        
        // 换行符转<br>（保留空行）
        text = text.replace(/\n/g, '<br>');
        
        return text;
    },

    /**
     * 转义HTML特殊字符
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

    hideTyping() {
        const typing = document.getElementById('typing-indicator');
        if (typing) {
            typing.remove();
        }
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
