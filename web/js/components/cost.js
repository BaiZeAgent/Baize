/**
 * 成本组件
 */

const CostComponent = {
    /**
     * 初始化
     */
    init() {
        this.todayCost = document.getElementById('today-cost');
        this.todayRequests = document.getElementById('today-requests');
        this.monthCost = document.getElementById('month-cost');
        this.budgetRemaining = document.getElementById('budget-remaining');
        
        this.dailyBudgetInput = document.getElementById('daily-budget');
        this.perTaskBudgetInput = document.getElementById('per-task-budget');
        this.alertThresholdInput = document.getElementById('alert-threshold');
        
        this.refreshBtn = document.getElementById('refresh-cost-btn');
        this.saveConfigBtn = document.getElementById('save-cost-config-btn');

        this.bindEvents();
        this.loadStats();
        this.loadConfig();
    },

    /**
     * 绑定事件
     */
    bindEvents() {
        this.refreshBtn.addEventListener('click', () => this.loadStats());
        this.saveConfigBtn.addEventListener('click', () => this.saveConfig());
    },

    /**
     * 加载统计
     */
    async loadStats() {
        try {
            const result = await BaizeAPI.getCostStats();
            
            if (result.success) {
                this.renderStats(result.data);
            }
        } catch (error) {
            console.error('加载成本统计失败:', error);
        }
    },

    /**
     * 渲染统计
     */
    renderStats(data) {
        this.todayCost.textContent = Utils.formatMoney(data.todayCost || 0);
        this.todayRequests.textContent = data.todayRequests || 0;
        this.monthCost.textContent = Utils.formatMoney(data.monthCost || 0);
        this.budgetRemaining.textContent = Utils.formatMoney(data.budgetRemaining || 10);
    },

    /**
     * 加载配置
     */
    async loadConfig() {
        try {
            const result = await BaizeAPI.getCostConfig();
            
            if (result.success) {
                const config = result.data;
                this.dailyBudgetInput.value = config.dailyBudget || 10;
                this.perTaskBudgetInput.value = config.perTaskBudget || 0.5;
                this.alertThresholdInput.value = config.alertThreshold || 80;
            }
        } catch (error) {
            console.error('加载成本配置失败:', error);
        }
    },

    /**
     * 保存配置
     */
    async saveConfig() {
        const config = {
            dailyBudget: parseFloat(this.dailyBudgetInput.value),
            perTaskBudget: parseFloat(this.perTaskBudgetInput.value),
            alertThreshold: parseInt(this.alertThresholdInput.value),
        };

        try {
            const result = await BaizeAPI.updateCostConfig(config);
            
            if (result.success) {
                Utils.toast('配置已保存', 'success');
                this.loadStats();
            }
        } catch (error) {
            Utils.toast('保存失败', 'error');
        }
    },
};
