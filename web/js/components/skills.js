/**
 * 技能组件
 */

const SkillsComponent = {
    // 状态
    skills: [],

    /**
     * 初始化
     */
    init() {
        this.skillsGrid = document.getElementById('skills-grid');
        this.skillSearch = document.getElementById('skill-search');
        this.refreshBtn = document.getElementById('refresh-skills-btn');

        this.bindEvents();
        this.loadSkills();
    },

    /**
     * 绑定事件
     */
    bindEvents() {
        // 搜索
        this.skillSearch.addEventListener('input', Utils.debounce((e) => {
            this.filterSkills(e.target.value);
        }, 300));

        // 刷新
        this.refreshBtn.addEventListener('click', () => this.loadSkills());
    },

    /**
     * 加载技能
     */
    async loadSkills() {
        try {
            this.skillsGrid.innerHTML = '<div class="empty-state"><span class="loading"></span> 加载中...</div>';
            
            const result = await BaizeAPI.getSkills();
            
            if (result.success) {
                this.skills = result.data.skills;
                this.renderSkills();
            }
        } catch (error) {
            this.skillsGrid.innerHTML = `<div class="empty-state">加载失败: ${error.message}</div>`;
        }
    },

    /**
     * 过滤技能
     */
    filterSkills(query) {
        const filtered = this.skills.filter(skill => 
            skill.name.toLowerCase().includes(query.toLowerCase()) ||
            skill.description.toLowerCase().includes(query.toLowerCase()) ||
            skill.capabilities.some(c => c.toLowerCase().includes(query.toLowerCase()))
        );
        this.renderSkills(filtered);
    },

    /**
     * 渲染技能
     */
    renderSkills(skills = this.skills) {
        if (skills.length === 0) {
            this.skillsGrid.innerHTML = '<div class="empty-state">暂无技能</div>';
            return;
        }

        this.skillsGrid.innerHTML = skills.map(skill => `
            <div class="skill-card" data-skill="${skill.name}">
                <div class="skill-header">
                    <div class="skill-name">${Utils.escapeHtml(skill.name)}</div>
                    <span class="skill-risk ${skill.riskLevel}">${skill.riskLevel}</span>
                </div>
                <div class="skill-description">${Utils.escapeHtml(skill.description)}</div>
                <div class="skill-capabilities">
                    ${skill.capabilities.map(c => `<span class="skill-capability">${Utils.escapeHtml(c)}</span>`).join('')}
                </div>
                <div class="skill-actions">
                    <button class="btn btn-secondary btn-sm" onclick="SkillsComponent.showSkillDetail('${skill.name}')">详情</button>
                    <button class="btn btn-primary btn-sm" onclick="SkillsComponent.executeSkill('${skill.name}')">执行</button>
                </div>
            </div>
        `).join('');
    },

    /**
     * 显示技能详情
     */
    async showSkillDetail(skillName) {
        try {
            const result = await BaizeAPI.getSkill(skillName);
            
            if (result.success) {
                const skill = result.data;
                const content = `
                    <div class="skill-detail">
                        <p><strong>名称:</strong> ${Utils.escapeHtml(skill.name)}</p>
                        <p><strong>描述:</strong> ${Utils.escapeHtml(skill.description)}</p>
                        <p><strong>风险等级:</strong> ${skill.riskLevel}</p>
                        <p><strong>能力:</strong> ${skill.capabilities.join(', ')}</p>
                        ${skill.inputSchema ? `
                            <h3>输入参数</h3>
                            <pre>${JSON.stringify(skill.inputSchema, null, 2)}</pre>
                        ` : ''}
                    </div>
                `;
                Utils.showModal(`技能: ${skill.name}`, content);
            }
        } catch (error) {
            Utils.toast('获取详情失败', 'error');
        }
    },

    /**
     * 执行技能
     */
    async executeSkill(skillName) {
        // 显示参数输入框
        const content = `
            <div class="form-group">
                <label>参数 (JSON格式)</label>
                <textarea id="skill-params" class="input" rows="5" placeholder='{"key": "value"}'>{}</textarea>
            </div>
            <button class="btn btn-primary" onclick="SkillsComponent.doExecute('${skillName}')">执行</button>
        `;
        Utils.showModal(`执行技能: ${skillName}`, content);
    },

    /**
     * 执行技能
     */
    async doExecute(skillName) {
        const paramsInput = document.getElementById('skill-params');
        let params = {};
        
        try {
            params = JSON.parse(paramsInput.value || '{}');
        } catch (error) {
            Utils.toast('参数格式错误', 'error');
            return;
        }

        try {
            Utils.hideModal();
            Utils.toast('正在执行...', 'warning');
            
            const result = await BaizeAPI.executeSkill(skillName, params);
            
            if (result.success) {
                Utils.toast(result.message || '执行成功', 'success');
            } else {
                Utils.toast(result.error || '执行失败', 'error');
            }
        } catch (error) {
            Utils.toast(`执行失败: ${error.message}`, 'error');
        }
    },
};
