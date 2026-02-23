/**
 * 工具函数
 */

const Utils = {
    /**
     * 显示提示消息
     */
    toast(message, type = 'success') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${type} show`;
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    },

    /**
     * 显示模态框
     */
    showModal(title, content) {
        const modal = document.getElementById('modal');
        const modalTitle = document.getElementById('modal-title');
        const modalBody = document.getElementById('modal-body');
        
        modalTitle.textContent = title;
        modalBody.innerHTML = content;
        modal.classList.add('show');
    },

    /**
     * 隐藏模态框
     */
    hideModal() {
        const modal = document.getElementById('modal');
        modal.classList.remove('show');
    },

    /**
     * 格式化时间
     */
    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString('zh-CN');
    },

    /**
     * 格式化持续时间
     */
    formatDuration(seconds) {
        if (seconds < 60) return `${Math.floor(seconds)}秒`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时`;
        return `${Math.floor(seconds / 86400)}天`;
    },

    /**
     * 格式化金额
     */
    formatMoney(amount) {
        return `$${parseFloat(amount).toFixed(2)}`;
    },

    /**
     * 转义HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * 防抖
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    /**
     * 节流
     */
    throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    /**
     * 自动调整文本框高度
     */
    autoResize(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    },

    /**
     * 滚动到底部
     */
    scrollToBottom(element) {
        element.scrollTop = element.scrollHeight;
    },

    /**
     * 复制到剪贴板
     */
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.toast('已复制到剪贴板', 'success');
        } catch (error) {
            this.toast('复制失败', 'error');
        }
    },

    /**
     * 本地存储封装
     */
    storage: {
        get(key, defaultValue = null) {
            const value = localStorage.getItem(key);
            if (value === null) return defaultValue;
            try {
                return JSON.parse(value);
            } catch {
                return value;
            }
        },
        
        set(key, value) {
            localStorage.setItem(key, JSON.stringify(value));
        },
        
        remove(key) {
            localStorage.removeItem(key);
        },
    },
};
