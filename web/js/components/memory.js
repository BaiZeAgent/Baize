/**
 * 记忆组件
 * 
 * v3.1.6 更新：
 * - 修复字段匹配问题
 * - 显示记忆列表
 */

const MemoryComponent = {
    init() {
        this.memoryCount = document.getElementById('memory-count');
        this.memoryList = document.getElementById('memory-list');
        this.clearMemoryBtn = document.getElementById('clear-memory-btn');

        this.bindEvents();
        this.loadStats();
    },

    bindEvents() {
        this.clearMemoryBtn.addEventListener('click', () => this.clearMemory());
    },

    async loadStats() {
        try {
            const result = await BaizeAPI.getMemoryStats();
            
            if (result.success) {
                this.renderStats(result.data);
            }
        } catch (error) {
            console.error('加载记忆统计失败:', error);
        }
    },

    renderStats(data) {
        // 更新统计显示
        this.memoryCount.textContent = data.count || 0;
        
        // 渲染记忆列表
        if (data.episodes && data.episodes.length > 0) {
            this.memoryList.innerHTML = data.episodes.map(ep => `
                <div class="memory-item">
                    <div class="memory-content">${this.escapeHtml(ep.content)}</div>
                    <div class="memory-time">${ep.timestamp ? Utils.formatTime(ep.timestamp) : ''}</div>
                </div>
            `).join('');
        } else {
            this.memoryList.innerHTML = '<div class="empty-state">暂无记忆数据</div>';
        }
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    async clearMemory() {
        if (!confirm('确定要清空所有记忆吗？')) return;
        
        Utils.toast('记忆清空功能开发中', 'warning');
    },
};
