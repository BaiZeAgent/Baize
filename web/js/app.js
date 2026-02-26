/**
 * 白泽3.0 Web 前端主应用
 */

const App = {
    /**
     * 初始化
     */
    init() {
        this.bindEvents();
        this.initComponents();
        this.testConnection();
    },

    /**
     * 绑定事件
     */
    bindEvents() {
        // 导航切换
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const page = e.currentTarget.dataset.page;
                this.switchPage(page);
            });
        });

        // 模态框关闭
        document.getElementById('modal-close').addEventListener('click', () => {
            Utils.hideModal();
        });

        // 点击模态框外部关闭
        document.getElementById('modal').addEventListener('click', (e) => {
            if (e.target.id === 'modal') {
                Utils.hideModal();
            }
        });

        // ESC 关闭模态框
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                Utils.hideModal();
            }
        });
    },

    /**
     * 初始化组件
     */
    initComponents() {
        ChatComponent.init();
        SkillsComponent.init();
        MemoryComponent.init();
        CostComponent.init();
        ConfigComponent.init();
    },

    /**
     * 切换页面
     */
    switchPage(pageName) {
        // 更新导航状态
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.page === pageName) {
                item.classList.add('active');
            }
        });

        // 更新页面显示
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
        });
        
        const targetPage = document.getElementById(`page-${pageName}`);
        if (targetPage) {
            targetPage.classList.add('active');
        }
    },

    /**
     * 测试连接
     */
    async testConnection() {
        const result = await BaizeAPI.testConnection();
        
        const statusDot = document.querySelector('#connection-status .status-dot');
        const statusText = document.querySelector('#connection-status .status-text');
        
        if (result.connected) {
            statusDot.classList.remove('offline');
            statusDot.classList.add('online');
            statusText.textContent = '已连接';
            
            // 更新版本信息
            document.getElementById('version').textContent = result.version || '-';
        } else {
            statusDot.classList.remove('online');
            statusDot.classList.add('offline');
            statusText.textContent = '未连接';
        }
    },
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
