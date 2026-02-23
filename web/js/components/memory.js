/**
 * 记忆组件
 */

const MemoryComponent = {
    /**
     * 初始化
     */
    init() {
        this.memoryCount = document.getElementById('memory-count');
        this.memoryList = document.getElementById('memory-list');
        this.clearMemoryBtn = document.getElementById('clear-memory-btn');

        this.bindEvents();
        this.loadStats();
    },

    /**
     * 绑定事件
     */
    bindEvents() {
        this.clearMemoryBtn.addEventListener('click', () => this.clearMemory());
    },

    /**
     * 加载统计
     */
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

    /**
     * 渲染统计
     */
    renderStats(data) {
        // 更新统计显示
        this.memoryCount.textContent = data.count || 0;
    },

    /**
     * 清空记忆
     */
    async clearMemory() {
        if (!confirm('确定要清空所有记忆吗？')) return;
        
        Utils.toast('记忆清空功能开发中', 'warning');
    },
};
