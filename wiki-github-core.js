/**
 * GitHub版 Wiki 核心系统 v2.0
 * 功能：前后台模式分离，GitHub存储，完整功能支持
 */

// 确保 app 对象存在（与 storage.js 共享同一个对象）
if (typeof window.app === 'undefined') {
    window.app = {};
}

// 扩展 app 对象
Object.assign(window.app, {
    // ========== 应用状态 ==========
    data: {
        entries: [],
        chapters: [],
        camps: [],
        synopsis: [],
        announcements: [],
        currentTimeline: 'latest',
        currentMode: 'view',
        editingId: null,
        editingType: null,
        viewingVersionId: null,
        wikiTitle: '未命名 Wiki',
        wikiSubtitle: '',
        fontFamily: "'Noto Sans SC', sans-serif",
        // 自定义字段支持
        customFields: {},
        // 首页自定义内容
        homeContent: []
    },
    
    // 运行模式：'backend'(后台/编辑) 或 'frontend'(前台/只读)
    runMode: 'frontend',
    
    // 后台模式登录状态
    backendLoggedIn: false,
    backendPassword: null,
    
    // 分享码验证状态
    shareCodeVerified: false,
    verifiedShareCode: null,
    
    // 临时编辑数据
    tempEntry: null,
    tempVersion: null,
    editingVersionId: null,
    
    // 编辑状态追踪
    editState: {
        originalEntry: null,
        originalVersion: null,
        hasChanges: false,
        undoStack: [],
        redoStack: []
    },

    // ========== 分享码系统 ==========
    shareCodeSystem: {
        // 生成随机分享码
        generateCode() {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code = '';
            for (let i = 0; i < 8; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return code;
        },
        
        // 验证分享码格式
        validateCode(code) {
            return /^[A-Z0-9]{8}$/.test(code);
        },
        
        // 验证分享码是否有效
        async verifyCode(code) {
            const codes = await this.loadShareCodes();
            return codes.hasOwnProperty(code);
        },
        
        // 加载所有分享码
        async loadShareCodes() {
            try {
                const content = await window.WikiGitHubStorage.getFile('share-codes.json');
                if (content) {
                    return JSON.parse(content.content);
                }
            } catch (e) {
                console.warn('无法加载分享码列表:', e);
            }
            return {};
        },
        
        // 保存分享码
        async saveShareCode(code, description = '') {
            try {
                const codes = await this.loadShareCodes();
                codes[code] = {
                    description,
                    createdAt: Date.now(),
                    createdBy: window.app.backendLoggedIn ? 'backend' : 'frontend'
                };
                await window.WikiGitHubStorage.putFile('share-codes.json', JSON.stringify(codes, null, 2), 'Add share code');
                return true;
            } catch (e) {
                console.error('保存分享码失败:', e);
                return false;
            }
        },
        
        // 删除分享码
        async deleteCode(code) {
            try {
                const codes = await this.loadShareCodes();
                delete codes[code];
                await window.WikiGitHubStorage.putFile('share-codes.json', JSON.stringify(codes, null, 2), 'Delete share code');
                return true;
            } catch (e) {
                console.error('删除分享码失败:', e);
                return false;
            }
        }
    },

    // ========== 初始化 ==========
    init() {
        // 绑定 GitHub 存储管理器
        this.githubStorage = window.WikiGitHubStorage;
        
        // 初始化存储（加载硬编码配置）
        const hasHardcodedConfig = this.githubStorage.init();
        
        // 检查是否有保存的后台登录状态
        const savedLogin = localStorage.getItem('wiki_backend_login');
        if (savedLogin) {
            try {
                const loginData = JSON.parse(savedLogin);
                if (loginData.expires > Date.now()) {
                    // 恢复Token到配置
                    if (loginData.token) {
                        this.githubStorage.config.token = loginData.token;
                    }
                    this.backendLoggedIn = true;
                    this.runMode = 'backend';
                    
                    if (this.githubStorage.isConfigured()) {
                        this.loadDataFromGitHub();
                        return;
                    }
                } else {
                    localStorage.removeItem('wiki_backend_login');
                }
            } catch (e) {
                localStorage.removeItem('wiki_backend_login');
            }
        }
        
        // 【关键修复】只要有硬编码配置，就加载数据（前台模式不需要Token）
        if (hasHardcodedConfig && this.githubStorage.config.owner && this.githubStorage.config.repo) {
            console.log('[Wiki] 使用硬编码配置，正在加载仓库数据...');
            console.log('[Wiki] 当前Token状态:', this.githubStorage.config.token ? '已提供（后台）' : '未提供（前台）');
            
            this.runMode = 'frontend';
            this.backendLoggedIn = false;
            this.loadDataFromGitHub();
        } else {
            console.log('[Wiki] 无GitHub配置，进入本地前台模式');
            this.runMode = 'frontend';
            this.initDefaultData();
            this.updateUIForMode();
            this.router('home');
        }
        
        setTimeout(() => this.checkImportResume(), 1000);
    },

    // ========== 登录页面 ==========
    // 修改 showLoginPage 函数（约第 175-210 行）- 允许直接进入前台模式
    showLoginPage() {
        const container = document.getElementById('main-container');
        if (!container) return;
        
        const tpl = document.getElementById('tpl-login');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        container.innerHTML = '';
        container.appendChild(clone);
        
        // 【修改】显示登录选项，允许直接进入前台模式
        document.getElementById('login-options').classList.remove('hidden');
        document.getElementById('share-code-form').classList.add('hidden');
        document.getElementById('backend-login-form').classList.add('hidden');
        
        // 绑定前台模式进入按钮
        const frontendBtn = document.getElementById('frontend-login-btn');
        if (frontendBtn) {
            frontendBtn.onclick = () => this.enterFrontendModeDirectly();
        }
    },

    // 【新增】直接进入前台模式（无需分享码）
    enterFrontendModeDirectly() {
        this.runMode = 'frontend';
        this.shareCodeVerified = true; // 标记为已验证，允许访问
        this.showToast('已进入前台模式（只读）', 'success');
        this.router('home');
        this.updateUIForMode();
    },

    // 从主页进入后台登录
    showBackendLoginFromHome() {
        this.showLoginPage();
        setTimeout(() => {
            this.showBackendLogin();
        }, 50);
    },

    // 进入前台模式（分享码登录）
    enterFrontendMode() {
        document.getElementById('login-options').classList.add('hidden');
        document.getElementById('share-code-form').classList.remove('hidden');
    },

    // 显示后台登录
    showBackendLogin() {
        document.getElementById('share-code-form').classList.add('hidden');
        document.getElementById('backend-login-form').classList.remove('hidden');
    },

    // 返回登录选项（返回分享码登录）
    showLoginOptions() {
        document.getElementById('backend-login-form').classList.add('hidden');
        document.getElementById('share-code-form').classList.remove('hidden');
    },

    // 后台模式登录 - 保存配置后永久绑定
    async loginBackend() {
        const owner = document.getElementById('github-owner').value.trim();
        const repo = document.getElementById('github-repo').value.trim();
        const token = document.getElementById('github-token').value.trim();
        const password = document.getElementById('backend-password').value.trim();
        const branch = document.getElementById('github-branch').value.trim() || 'main';
        
        if (!owner || !repo || !token) {
            this.showAlertDialog({
                title: '信息不完整',
                message: '请填写GitHub用户名、仓库名称和Token',
                type: 'warning'
            });
            return;
        }
        
        // 保存配置
        this.githubStorage.saveConfig(owner, repo, token, branch);
        
        // 测试连接
        const result = await this.githubStorage.testConnection();
        if (!result.success) {
            this.showAlertDialog({
                title: '连接失败',
                message: result.error || '无法连接到GitHub仓库',
                type: 'error'
            });
            this.githubStorage.clearConfig();
            return;
        }
        
        // 【关键】保存登录状态到localStorage，包含Token
        if (password) {
            this.backendPassword = password;
            localStorage.setItem('wiki_backend_login', JSON.stringify({
                password: password,
                token: token,  // 必须保存Token
                expires: Date.now() + 7 * 24 * 60 * 60 * 1000
            }));
        }
        
        this.backendLoggedIn = true;
        this.runMode = 'backend';
        this.showToast('后台模式登录成功', 'success');
        this.loadDataFromGitHub();
    },

    // 验证分享码（前台模式）
    async verifyShareCode() {
        const input = document.getElementById('share-code-input');
        const code = input.value.trim().toUpperCase();
        
        if (!this.shareCodeSystem.validateCode(code)) {
            this.showAlertDialog({
                title: '格式错误',
                message: '分享码应为8位字母数字组合',
                type: 'warning'
            });
            return;
        }
        
        // 从GitHub获取分享码列表验证
        const isValid = await this.shareCodeSystem.verifyCode(code);
        
        if (isValid) {
            this.shareCodeVerified = true;
            this.verifiedShareCode = code;
            localStorage.setItem('wiki_verified_sharecode', code);
            this.showToast('验证成功', 'success');
            this.loadDataFromGitHub();
        } else {
            this.showAlertDialog({
                title: '验证失败',
                message: '分享码无效或已过期',
                type: 'error'
            });
        }
    },

    // 退出后台模式
    logoutBackend() {
        this.backendLoggedIn = false;
        this.runMode = 'frontend';
        this.backendPassword = null;
        localStorage.removeItem('wiki_backend_login');
        this.showToast('已退出后台模式', 'info');
        this.router('home');
        this.updateUIForMode();
    },

    // ========== 数据加载 ==========
    async loadDataFromGitHub() {
        try {
            console.log('[Wiki] 开始从GitHub加载数据...');
            
            const file = await this.githubStorage.getFile('data.json');
            if (!file || !file.content) {
                console.log('[Wiki] 仓库中无数据，使用默认值');
                this.initDefaultData();
                this.updateUIForMode();
                this.router('home');
                return;
            }
            
            const baseData = JSON.parse(file.content);
            console.log('[Wiki] 基础数据加载成功:', baseData.settings?.name || '未命名');
            
            // 【关键】检测分片版本
            let entries = [];
            if (baseData.version && baseData.version.includes('sharded') && baseData.entryFiles) {
                entries = await this.loadShardedData(baseData);
            } else {
                entries = baseData.entries || [];
            }
            
            // 合并数据到 this.data
            this.data = {
                ...this.data,
                settings: baseData.settings || this.data.settings,
                chapters: baseData.chapters || [],
                camps: baseData.camps || ['主角团', '反派', '中立'],
                synopsis: baseData.synopsis || [],
                announcements: baseData.announcements || [],
                homeContent: baseData.homeContent || [],
                customFields: baseData.customFields || {},
                entries: entries
            };
            
            // 兼容旧版字段映射
            if (baseData.wikiTitle && !this.data.settings.name) {
                this.data.settings.name = baseData.wikiTitle;
            }
            if (baseData.wikiSubtitle !== undefined && this.data.settings.subtitle === undefined) {
                this.data.settings.subtitle = baseData.wikiSubtitle;
            }
            
            // 【关键修复】解析图片引用为实际URL
            this.resolveImageReferences();
            
            console.log('[Wiki] ✅ 数据加载完成，词条数:', entries.length);
            this.applyFont();
            this.updateUIForMode();
            this.router('home');
            
        } catch (error) {
            console.error('[Wiki] ❌ 加载失败:', error);
            this.showAlertDialog({
                title: '加载失败',
                message: '无法从GitHub加载数据: ' + error.message,
                type: 'error'
            });
            if (!this.data || !this.data.entries) {
                this.initDefaultData();
            }
        }
    },
    // 【新增】解析图片引用，将 {{IMG:filename}} 转换为 GitHub Raw URL
    resolveImageReferences() {
        if (!this.data.entries || !this.githubStorage.config.owner) return;
        
        const { owner, repo, branch, dataPath } = this.githubStorage.config;
        const baseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${dataPath}/images/`;
        
        let resolvedCount = 0;
        
        this.data.entries.forEach(entry => {
            if (!entry.versions) return;
            
            entry.versions.forEach(version => {
                // 处理旧版单个image字段
                if (version.image && version.image.startsWith('{{IMG:')) {
                    const filename = version.image.slice(6, -2);
                    version.image = baseUrl + filename;
                    resolvedCount++;
                }
                
                // 处理新版images对象
                if (version.images) {
                    ['avatar', 'card', 'cover'].forEach(type => {
                        const value = version.images[type];
                        if (value && value.startsWith('{{IMG:')) {
                            const filename = value.slice(6, -2);
                            version.images[type] = baseUrl + filename;
                            resolvedCount++;
                        }
                    });
                }
            });
        });
        
        if (resolvedCount > 0) {
            console.log(`[Wiki] 已解析 ${resolvedCount} 个图片引用`);
        }
    },
    initDefaultData() {
        this.data = {
            entries: [],
            chapters: [],
            camps: ['主角团', '反派', '中立'],
            synopsis: [],
            announcements: [],
            homeContent: [],
            customFields: {},
            currentTimeline: 'latest',
            currentMode: 'view',
            settings: {
                name: '未命名 Wiki',
                subtitle: '',
                welcomeTitle: '欢迎来到 Wiki',
                welcomeSubtitle: '探索角色、世界观与错综复杂的关系网。',
                customFont: null
            }
        };
    },
    renderAnnouncementBanner() {
        const activeAnn = this.data.announcements?.find(a => a.isActive);
        const annSection = document.getElementById('announcement-section');
        
        if (!annSection) return;
        
        if (activeAnn) {
            annSection.classList.remove('hidden');
            
            const annTitle = document.getElementById('announcement-title');
            const annPreview = document.getElementById('announcement-preview');
            const annMeta = document.getElementById('announcement-meta');
            
            if (annTitle) annTitle.textContent = activeAnn.title || '最新公告';
            
            if (annPreview) {
                // 去除HTML标签获取纯文本预览
                const temp = document.createElement('div');
                temp.innerHTML = activeAnn.content || '';
                const text = temp.textContent || '';
                annPreview.textContent = text.substring(0, 100) + (text.length > 100 ? '...' : '');
            }
            
            if (annMeta) {
                annMeta.innerHTML = `
                    <i class="fa-solid fa-user-pen mr-1"></i>${activeAnn.author || '匿名'} 
                    <span class="mx-2">•</span> 
                    <i class="fa-regular fa-calendar mr-1"></i>${activeAnn.date || new Date(activeAnn.createdAt).toLocaleDateString('zh-CN')}
                `;
            }
        } else {
            annSection.classList.add('hidden');
        }
    },
    // ========== 根据模式更新UI ==========
    updateUIForMode() {
        // 【关键】统一从 settings 读取，增加空值保护
        const settings = this.data.settings || {};
        
        // 左上角工具栏标题
        const headerTitleEl = document.getElementById('wiki-title-display');
        const headerSubEl = document.getElementById('wiki-subtitle-display');
        
        if (headerTitleEl) {
            headerTitleEl.textContent = settings.name || '未命名 Wiki';
        }
        
        // 全局声明（subtitle）
        if (headerSubEl) {
            const subtitle = settings.subtitle || '';
            headerSubEl.textContent = subtitle;
            headerSubEl.classList.toggle('hidden', !subtitle.trim());
        }
        
        // 模式徽章（仅后台模式显示）
        const badge = document.getElementById('mode-badge');
        if (badge) {
            if (this.runMode === 'backend') {
                badge.classList.remove('hidden');
                badge.className = 'mode-badge backend';
                badge.textContent = '后台模式';
            } else {
                badge.classList.add('hidden');
            }
        }
        
        // 显示/隐藏编辑相关元素（保留添加角色/设定/批量导入按钮）
        document.querySelectorAll('.edit-only').forEach(el => {
            el.classList.toggle('hidden', this.runMode !== 'backend');
        });
        
        // 显示/隐藏模式切换
        const modeSwitch = document.getElementById('mode-switch-container');
        if (modeSwitch) {
            modeSwitch.classList.toggle('hidden', this.runMode !== 'backend');
        }
        
        // 显示/隐藏退出后台按钮
        const logoutBtn = document.getElementById('logout-backend-btn');
        if (logoutBtn) {
            logoutBtn.classList.toggle('hidden', this.runMode !== 'backend');
        }
        // 【新增】主页后台入口区域控制
        const backendEntry = document.getElementById('backend-entry-section');
        if (backendEntry) {
            // 仅在前台模式且未登录时显示
            const shouldShow = this.runMode === 'frontend' && !this.backendLoggedIn;
            backendEntry.classList.toggle('hidden', !shouldShow);
        }
    },

    // ========== 页面路由 ==========
    router(target, pushState = true) {
        const container = document.getElementById('main-container');
        if (!container) return;
        // 【新增】如果离开详情页，重置手动版本选择，避免影响其他词条
        if (target !== 'detail' && target !== 'edit') {
            this.data.viewingVersionId = null;
        }
        
        container.innerHTML = '';
        
        // 更新导航状态
        document.querySelectorAll('.nav-btn').forEach(btn => {
            const isActive = btn.dataset.target === target;
            btn.classList.toggle('text-indigo-600', isActive);
            btn.classList.toggle('text-gray-500', !isActive);
        });
        
        // 根据目标渲染不同页面
        switch(target) {
            case 'home':
                this.renderHome(container);
                break;
            case 'characters':
                this.renderList(container, 'character');
                break;
            case 'non-characters':
                this.renderList(container, 'non-character');
                break;
            case 'settings':
                this.renderSettings(container);
                break;
            case 'detail':
                this.renderDetail(container);
                break;
            case 'edit':
                if (this.runMode === 'backend') {
                    this.renderEdit(container);
                } else {
                    this.showToast('前台模式不支持编辑', 'warning');
                    this.router('home');
                }
                break;
            case 'synopsis':
                this.renderSynopsis(container);
                break;
            case 'synopsis-edit':
                if (this.runMode === 'backend') {
                    this.renderSynopsisEdit(container);
                } else {
                    this.showToast('前台模式不支持编辑', 'warning');
                    this.router('synopsis');
                }
                break;
            case 'graph':
                this.renderGraph(container);
                break;
            case 'timeline-settings':
                if (this.runMode === 'backend') {
                    this.renderTimelineSettings(container);
                } else {
                    this.showToast('前台模式不支持编辑', 'warning');
                    this.router('settings');
                }
                break;
            case 'announcement-edit':
                if (this.runMode === 'backend') {
                    this.renderAnnouncementEdit(container);
                } else {
                    this.showToast('前台模式不支持编辑', 'warning');
                    this.router('home');
                }
                break;
            default:
                this.renderHome(container);
        }
        
        if (pushState) {
            history.pushState({ target }, '', `#${target}`);
        }
    },

    renderHome(container) {
        const tpl = document.getElementById('tpl-home');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
        
        // 【关键】强制从 this.data.settings 读取（不再兼容旧字段）
        const settings = this.data.settings || {};
        
        // 修复大蓝框欢迎语
        const welcomeTitleEl = document.getElementById('welcome-title');
        const welcomeSubtitleEl = document.getElementById('welcome-subtitle');
        
        if (welcomeTitleEl) {
            welcomeTitleEl.textContent = settings.welcomeTitle || '欢迎来到 Wiki';
        }
        if (welcomeSubtitleEl) {
            welcomeSubtitleEl.textContent = settings.welcomeSubtitle || '探索角色、世界观与错综复杂的关系网。';
        }
        
        // 【保留按钮】显示/隐藏编辑按钮（确保批量导入按钮也不被删除）
        document.querySelectorAll('.edit-only').forEach(el => {
            el.classList.toggle('hidden', this.runMode !== 'backend');
        });
        
        // 后台入口区域显示逻辑
        const backendEntry = document.getElementById('backend-entry-section');
        if (backendEntry) {
            backendEntry.classList.toggle('hidden', this.runMode === 'backend');
        }
        
        // 渲染其他内容
        this.renderHomeCustomContent();
        this.renderAnnouncementBanner();
    },

    renderHomeCustomContent() {
        const container = document.getElementById('home-custom-content') || document.getElementById('home-text-boxes');
        if (!container) return;
        
        container.innerHTML = '';
        
        // 【修复】移除 "暂无自定义内容" 的占位提示，保持区域干净
        if (!this.data.homeContent || this.data.homeContent.length === 0) {
            // 编辑模式下显示提示，查看模式下保持空白
            if (this.runMode === 'backend') {
                container.innerHTML = '<p class="text-gray-400 text-center py-4 text-sm">点击上方按钮添加自定义内容</p>';
            }
            return;
        }
        
        this.data.homeContent.forEach((item, idx) => {
            if (item.type === 'text') {
                const wrapper = document.createElement('div');
                wrapper.className = 'relative group';
                
                if (this.runMode === 'backend') {
                    // 编辑模式：显示可编辑文本框和删除按钮
                    wrapper.innerHTML = `
                        <button onclick="app.removeHomeItem(${idx})" class="absolute top-2 right-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition z-10 bg-white rounded-full w-6 h-6 flex items-center justify-center shadow">
                            <i class="fa-solid fa-times"></i>
                        </button>
                        <textarea class="w-full p-3 border border-gray-200 rounded-lg text-sm min-h-[100px] resize-y focus:ring-2 focus:ring-indigo-500 outline-none" 
                            placeholder="输入文本内容..."
                            onchange="app.updateHomeText(${idx}, this.value)">${item.content || ''}</textarea>
                    `;
                } else {
                    // 查看模式：只显示纯文本
                    wrapper.className = 'bg-white p-4 rounded-lg border border-gray-100 shadow-sm';
                    wrapper.innerHTML = `<p class="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap">${item.content || ''}</p>`;
                }
                container.appendChild(wrapper);
                
            } else if (item.type === 'entry-ref') {
                const entry = this.data.entries.find(e => e.id === item.entryId);
                if (!entry) return;
                
                const version = this.getVisibleVersion(entry);
                const displayTitle = item.title || version?.title || entry.code;
                
                const div = document.createElement('div');
                div.className = 'bg-indigo-50 p-3 rounded-xl border border-indigo-100 cursor-pointer hover:bg-indigo-100 transition flex items-center gap-3';
                div.onclick = () => this.openEntry(entry.id);
                
                if (this.runMode === 'backend') {
                    // 编辑模式：显示标题和删除按钮
                    div.innerHTML = `
                        <i class="fa-solid fa-book text-indigo-500"></i>
                        <span class="font-medium text-indigo-700 flex-1 truncate">${displayTitle}</span>
                        <button onclick="event.stopPropagation(); app.removeHomeItem(${idx})" class="text-gray-400 hover:text-red-500 w-6 h-6 flex items-center justify-center rounded-full hover:bg-white transition">
                            <i class="fa-solid fa-times text-xs"></i>
                        </button>
                    `;
                } else {
                    // 查看模式：简洁显示
                    div.innerHTML = `
                        <i class="fa-solid fa-book text-indigo-500"></i>
                        <span class="font-medium text-indigo-700 truncate">${displayTitle}</span>
                    `;
                }
                container.appendChild(div);
            }
        });
    },

    renderList(container, type) {
        const tpl = document.getElementById('tpl-list');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        const masonry = clone.getElementById('masonry-container');
        const countBadge = clone.getElementById('list-count');
        const title = clone.getElementById('list-title');
        
        title.textContent = type === 'character' ? '角色' : '设定';
        
        // 显示/隐藏编辑按钮
        clone.querySelectorAll('.edit-only').forEach(el => {
            el.classList.toggle('hidden', this.runMode !== 'backend');
        });
        
        let items = this.data.entries.filter(e => e.type === type);
        if (countBadge) countBadge.textContent = items.length;
        
        if (items.length === 0) {
            masonry.innerHTML = '<div class="col-span-full text-center py-10 text-gray-400">暂无数据</div>';
        } else {
            // 按重要程度排序
            items.sort((a, b) => {
                const vA = this.getVisibleVersion(a);
                const vB = this.getVisibleVersion(b);
                return (vA?.level || 5) - (vB?.level || 5);
            });
            
            items.forEach(entry => {
                const version = this.getVisibleVersion(entry) || entry.versions?.[0];
                if (version) {
                    const card = this.createEntryCard(entry, version);
                    if (card) masonry.appendChild(card);
                }
            });
        }
        
        container.appendChild(clone);
    },

    renderDetail(container) {
        const entry = this.data.entries.find(e => e.id === this.data.editingId);
        if (!entry) {
            container.innerHTML = '<div class="p-4 text-red-600">条目不存在</div>';
            return;
        }
        
        const version = this.getVisibleVersion(entry) || entry.versions?.[entry.versions.length - 1];
        if (!version) {
            container.innerHTML = '<div class="p-4 text-red-600">该条目没有内容</div>';
            return;
        }
        
        const tpl = document.getElementById('tpl-detail-view');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        
        clone.getElementById('detail-code').textContent = entry.code;
        
        // 显示/隐藏编辑按钮
        clone.querySelectorAll('.edit-only').forEach(el => {
            el.classList.toggle('hidden', this.runMode !== 'backend');
        });
        
        const contentEl = clone.getElementById('detail-content');
        
        // 渲染内容
        let contentHtml = `
            <div class="flex flex-col md:flex-row gap-6 mb-6">
                <div class="flex-1">
                    <h1 class="text-3xl font-bold text-gray-900 mb-3">${version.title}</h1>
                    ${version.subtitle ? `<p class="text-lg italic text-gray-600 border-l-4 border-indigo-300 pl-4">${version.subtitle}</p>` : ''}
                </div>
        `;
        
        // 图片
        const img = version.images?.card || version.images?.avatar || version.image;
        if (img && !img.startsWith('{{IMG:')) { // 确保已解析（或原本就是完整URL）
            contentHtml += `
                <div class="w-48 shrink-0">
                    <div class="aspect-[3/4] rounded-xl overflow-hidden shadow-lg bg-gray-100">
                        <img src="${img}" class="w-full h-full object-cover" alt="${version.title}" onerror="this.style.display='none'">
                    </div>
                </div>
            `;
        }
        
        contentHtml += '</div>';
        
        // 正文块
        contentHtml += '<div class="prose prose-sm max-w-none">';
        if (version.blocks && version.blocks.length > 0) {
            version.blocks.forEach(block => {
                if (block.type === 'h2') {
                    contentHtml += `<h2 class="text-xl font-bold text-gray-800 mt-8 mb-4 border-b pb-2">${block.text}</h2>`;
                } else if (block.type === 'h3') {
                    contentHtml += `<h3 class="text-lg font-bold text-gray-700 mt-6 mb-3">${block.text}</h3>`;
                } else {
                    let text = block.text || '';
                    text = text.replace(/\[\[(.*?)\]\]/g, '<a href="#" onclick="app.searchAndOpen(\'$1\'); return false;" class="text-indigo-600 hover:underline">$1</a>');
                    contentHtml += `<p class="text-gray-600 leading-relaxed mb-4 break-all">${text}</p>`;
                }
            });
        }
        contentHtml += '</div>';
        
        // 版本切换
        if (entry.versions.length > 1) {
            contentHtml += `
                <div class="mt-8 pt-6 border-t border-gray-200">
                    <h3 class="text-sm font-bold text-gray-500 uppercase mb-3">版本切换</h3>
                    <div class="flex flex-wrap gap-2">
            `;
            entry.versions.forEach((v, idx) => {
                const isCurrent = v.vid === version.vid;
                contentHtml += `
                    <button onclick="app.switchToVersion('${entry.id}', '${v.vid}')" 
                        class="px-3 py-1.5 rounded-lg text-sm ${isCurrent ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}">
                        版本 ${idx + 1}: ${v.title}
                    </button>
                `;
            });
            contentHtml += '</div></div>';
        }
        
        contentEl.innerHTML = contentHtml;
        container.appendChild(clone);
    },

    renderEdit(container) {
        const isNew = !this.data.editingId;
        
        // 初始化临时数据
        if (isNew) {
            const type = this.data.editingType || 'character';
            const code = this.generateCode(type);
            
            this.tempEntry = {
                id: (type === 'character' ? 'char-' : 'non-') + Date.now(),
                type: type,
                code: code,
                versions: [],
                pinned: false,
                pinStartChapter: null,
                pinEndChapter: null,
                pinnedVersions: {},
                missingIntervalVersion: null,
                defaultPinnedVersion: null
            };
            
            this.tempVersion = {
                vid: 'v-' + Date.now(),
                title: '',
                subtitle: '',
                level: 5,
                images: { avatar: null, card: null, cover: null },
                chapterFrom: null,
                chapterTo: null,
                blocks: [],
                relatedCharacters: [],
                relatedVersions: [],
                createdAt: Date.now()
            };
            
            this.tempEntry.versions.push(this.tempVersion);
            this.editingVersionId = this.tempVersion.vid;
            this.editState.hasChanges = true;
        } else {
            const entry = this.data.entries.find(e => e.id === this.data.editingId);
            this.tempEntry = JSON.parse(JSON.stringify(entry));
            this.tempVersion = JSON.parse(JSON.stringify(entry.versions[entry.versions.length - 1]));
            this.editingVersionId = this.tempVersion.vid;
            this.editState.originalEntry = JSON.parse(JSON.stringify(entry));
            this.editState.originalVersion = JSON.parse(JSON.stringify(this.tempVersion));
            this.editState.hasChanges = false;
        }
        
        this.editState.undoStack = [];
        this.editState.redoStack = [];
        
        const tpl = document.getElementById('tpl-detail-edit');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        
        const titleInput = clone.getElementById('edit-title');
        const codeInput = clone.getElementById('edit-code');
        const subtitleInput = clone.getElementById('edit-subtitle');
        
        if (titleInput) titleInput.value = this.tempVersion.title;
        if (codeInput) codeInput.value = this.tempEntry.code;
        if (subtitleInput) subtitleInput.value = this.tempVersion.subtitle || '';
        
        // 绑定键盘快捷键
        this.bindEditKeyboardShortcuts();
        
        container.appendChild(clone);
    },

    renderSettings(container) {
        const tpl = document.getElementById('tpl-settings');
        if (!tpl) return;
        
        const clone = tpl.content.cloneNode(true);
        
        // 显示/隐藏编辑相关设置
        clone.querySelectorAll('.edit-only').forEach(el => {
            el.classList.toggle('hidden', this.runMode !== 'backend');
        });
        
        // 更新GitHub仓库显示
        if (this.runMode === 'backend' && this.githubStorage.isConfigured()) {
            const repoDisplay = clone.getElementById('github-repo-display');
            if (repoDisplay) {
                repoDisplay.textContent = `${this.githubStorage.config.owner}/${this.githubStorage.config.repo}`;
            }
            
            // 加载分享码列表
            this.loadShareCodeList(clone.getElementById('share-code-list'));
        }
        
        container.appendChild(clone);
    },

    // ========== 剧情梗概 ==========
    renderSynopsis(container) {
        const tpl = document.getElementById('tpl-synopsis-view');
        if (!tpl) {
            container.innerHTML = '<div class="p-8 text-center text-gray-400">剧情梗概模板未找到</div>';
            return;
        }
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
        
        // 同步剧情梗概与章节
        this.syncSynopsisWithChapters();
        
        const list = document.getElementById('synopsis-view-list');
        if (list) {
            this.data.synopsis.forEach(chapter => {
                const item = document.createElement('div');
                item.className = 'synopsis-chapter-item p-6 border-b border-gray-200';
                item.innerHTML = `
                    <h3 class="text-xl font-bold text-gray-800 mb-2">
                        <span class="text-indigo-600 mr-2">${this.formatChapterNum(chapter.num)}</span>
                        ${chapter.title}
                    </h3>
                    <div class="prose prose-sm max-w-none text-gray-600">
                        ${chapter.content ? chapter.content.replace(/\n/g, '<br>') : '<p class="text-gray-400 italic">暂无内容</p>'}
                    </div>
                `;
                list.appendChild(item);
            });
        }
    },

    renderSynopsisEdit(container) {
        const tpl = document.getElementById('tpl-synopsis-edit');
        if (!tpl) {
            container.innerHTML = '<div class="p-8 text-center text-gray-400">剧情梗概编辑模板未找到</div>';
            return;
        }
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
        
        this.syncSynopsisWithChapters();
        
        const list = document.getElementById('synopsis-chapters-list');
        if (list) {
            this.data.synopsis.forEach(chapter => {
                const item = document.createElement('div');
                item.className = 'bg-white rounded-lg border border-gray-200 mb-4 overflow-hidden';
                item.innerHTML = `
                    <div class="flex items-center gap-3 p-3 bg-gray-50 border-b border-gray-200">
                        <span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-xs font-bold">${this.formatChapterNum(chapter.num)}</span>
                        <input type="text" class="flex-1 bg-transparent border-none outline-none text-sm font-medium" 
                            value="${chapter.title}" onchange="app.updateSynopsisTitle('${chapter.id}', this.value)">
                        <button onclick="app.removeSynopsisChapter('${chapter.id}')" class="text-red-500 hover:text-red-700 p-1.5">
                            <i class="fa-solid fa-trash text-xs"></i>
                        </button>
                    </div>
                    <div class="p-3">
                        <textarea class="w-full p-2 border border-gray-200 rounded-lg text-sm resize-none" rows="4"
                            onchange="app.updateSynopsisContent('${chapter.id}', this.value)">${chapter.content || ''}</textarea>
                    </div>
                `;
                list.appendChild(item);
            });
        }
    },

    syncSynopsisWithChapters() {
        const sortedChapters = [...this.data.chapters].sort((a, b) => a.order - b.order);
        const existingSynopsis = {};
        this.data.synopsis.forEach(s => { existingSynopsis[s.chapterId] = s; });

        const newSynopsis = [];
        sortedChapters.forEach(ch => {
            if (existingSynopsis[ch.id]) {
                newSynopsis.push(existingSynopsis[ch.id]);
            } else {
                newSynopsis.push({
                    id: 'syn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
                    chapterId: ch.id,
                    num: ch.num,
                    title: ch.title || `第${ch.num}章`,
                    content: '',
                    image: null
                });
            }
        });
        this.data.synopsis = newSynopsis;
    },

    updateSynopsisTitle(chapterId, title) {
        const chapter = this.data.synopsis.find(s => s.id === chapterId);
        if (chapter) chapter.title = title;
    },

    updateSynopsisContent(chapterId, content) {
        const chapter = this.data.synopsis.find(s => s.id === chapterId);
        if (chapter) chapter.content = content;
    },

    removeSynopsisChapter(chapterId) {
        this.showConfirmDialog({
            title: '删除确认',
            message: '确定删除此章节的剧情梗概？',
            confirmText: '删除',
            cancelText: '取消',
            type: 'warning'
        }).then(confirmed => {
            if (confirmed) {
                this.data.synopsis = this.data.synopsis.filter(s => s.id !== chapterId);
                this.renderSynopsisEdit(document.getElementById('main-container'));
            }
        });
    },

    addSynopsisChapter() {
        const num = this.data.chapters.length + 1;
        const chapterId = 'ch-' + Date.now();
        
        // 添加章节
        this.data.chapters.push({
            id: chapterId,
            num: num,
            title: `第${num}章`,
            order: num
        });
        
        // 同步添加剧情梗概
        this.data.synopsis.push({
            id: 'syn-' + Date.now(),
            chapterId: chapterId,
            num: num,
            title: `第${num}章`,
            content: '',
            image: null
        });
        
        this.renderSynopsisEdit(document.getElementById('main-container'));
    },

    saveSynopsis() {
        this.saveData();
        this.showToast('剧情梗概已保存', 'success');
    },

    // ========== 时间轴/章节管理 ==========
    renderTimelineSettings(container) {
        const tpl = document.getElementById('tpl-timeline-settings');
        if (!tpl) {
            container.innerHTML = '<div class="p-8 text-center text-gray-400">章节管理模板未找到</div>';
            return;
        }
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
        
        const list = document.getElementById('timeline-chapters-list');
        if (list) {
            const sortedChapters = [...this.data.chapters].sort((a, b) => a.order - b.order);
            sortedChapters.forEach((ch, idx) => {
                const item = document.createElement('div');
                item.className = 'flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200';
                item.innerHTML = `
                    <span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-xs font-bold font-mono w-16 text-center">${this.formatChapterNum(ch.num)}</span>
                    <input type="text" class="flex-1 bg-transparent border border-gray-200 rounded px-2 py-1 text-sm" 
                        value="${ch.title}" onchange="app.updateChapterTitle('${ch.id}', this.value)">
                    <button onclick="app.moveChapter('${ch.id}', -1)" class="text-gray-400 hover:text-gray-600 p-1" ${idx === 0 ? 'disabled' : ''}>
                        <i class="fa-solid fa-arrow-up"></i>
                    </button>
                    <button onclick="app.moveChapter('${ch.id}', 1)" class="text-gray-400 hover:text-gray-600 p-1" ${idx === sortedChapters.length - 1 ? 'disabled' : ''}>
                        <i class="fa-solid fa-arrow-down"></i>
                    </button>
                    <button onclick="app.deleteChapter('${ch.id}')" class="text-red-400 hover:text-red-600 p-1">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                `;
                list.appendChild(item);
            });
        }
    },

    updateChapterTitle(chapterId, title) {
        const chapter = this.data.chapters.find(c => c.id === chapterId);
        if (chapter) {
            chapter.title = title;
            // 同步更新剧情梗概标题
            const synopsis = this.data.synopsis.find(s => s.chapterId === chapterId);
            if (synopsis) synopsis.title = title;
        }
    },

    moveChapter(chapterId, direction) {
        const idx = this.data.chapters.findIndex(c => c.id === chapterId);
        if (idx === -1) return;
        
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= this.data.chapters.length) return;
        
        // 交换位置
        const temp = this.data.chapters[idx];
        this.data.chapters[idx] = this.data.chapters[newIdx];
        this.data.chapters[newIdx] = temp;
        
        // 更新order
        this.data.chapters.forEach((c, i) => c.order = i + 1);
        
        this.renderTimelineSettings(document.getElementById('main-container'));
    },

    deleteChapter(chapterId) {
        this.showConfirmDialog({
            title: '删除确认',
            message: '确定删除此章节？相关的剧情梗概也会被删除。',
            confirmText: '删除',
            cancelText: '取消',
            type: 'danger'
        }).then(confirmed => {
            if (confirmed) {
                this.data.chapters = this.data.chapters.filter(c => c.id !== chapterId);
                this.data.synopsis = this.data.synopsis.filter(s => s.chapterId !== chapterId);
                this.renderTimelineSettings(document.getElementById('main-container'));
            }
        });
    },

    addChapter() {
        const num = this.data.chapters.length + 1;
        const chapterId = 'ch-' + Date.now();
        
        this.data.chapters.push({
            id: chapterId,
            num: num,
            title: `第${num}章`,
            order: num
        });
        
        // 同步添加剧情梗概
        this.data.synopsis.push({
            id: 'syn-' + Date.now(),
            chapterId: chapterId,
            num: num,
            title: `第${num}章`,
            content: '',
            image: null
        });
        
        this.renderTimelineSettings(document.getElementById('main-container'));
    },

    saveTimelineSettings() {
        this.saveData();
        this.showToast('章节设置已保存', 'success');
    },

    // ========== 关系图 ==========
    renderGraph(container) {
        const tpl = document.getElementById('tpl-graph');
        if (!tpl) {
            container.innerHTML = '<div class="p-8 text-center text-gray-400">关系图模板未找到</div>';
            return;
        }
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
        
        // 简单的关系图渲染
        const graphContainer = document.getElementById('graph-container');
        if (graphContainer) {
            // 获取所有角色词条
            const characters = this.data.entries.filter(e => e.type === 'character');
            
            if (characters.length === 0) {
                graphContainer.innerHTML = '<div class="text-center text-gray-400 py-10">暂无角色数据</div>';
                return;
            }
            
            // 渲染角色节点
            characters.forEach(entry => {
                const version = this.getVisibleVersion(entry);
                if (!version) return;
                
                const node = document.createElement('div');
                node.className = 'absolute bg-white rounded-lg shadow-md border border-gray-200 p-3 cursor-pointer hover:shadow-lg transition';
                node.style.left = `${Math.random() * 60 + 10}%`;
                node.style.top = `${Math.random() * 60 + 10}%`;
                node.innerHTML = `
                    <div class="text-sm font-medium text-gray-800">${version.title}</div>
                    <div class="text-xs text-gray-500">${entry.code}</div>
                `;
                node.onclick = () => this.openEntry(entry.id);
                graphContainer.appendChild(node);
            });
        }
    },

    // ========== 公告编辑 ==========
    renderAnnouncementEdit(container) {
        const tpl = document.getElementById('tpl-announcement-edit');
        if (!tpl) {
            container.innerHTML = '<div class="p-8 text-center text-gray-400">公告编辑模板未找到</div>';
            return;
        }
        
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);
    },

    saveAnnouncement() {
        const title = document.getElementById('announcement-edit-title')?.value;
        const author = document.getElementById('announcement-edit-author')?.value;
        const content = document.getElementById('announcement-edit-content')?.value;

        if (!title) {
            this.showAlertDialog({
                title: '信息不完整',
                message: '请输入公告标题',
                type: 'warning'
            });
            return;
        }

        const newAnn = {
            id: 'ann-' + Date.now(),
            title,
            author,
            content,
            createdAt: Date.now(),
            date: new Date().toLocaleDateString('zh-CN'),
            isActive: true
        };
        
        // 将其他公告设为非活跃
        this.data.announcements.forEach(a => a.isActive = false);
        this.data.announcements.unshift(newAnn);

        this.saveData();
        this.showToast('公告已发布', 'success');
        this.router('home');
    },

    createAnnouncement() {
        this.data.currentAnnouncement = null;
        this.router('announcement-edit');
    },

    viewAnnouncement() {
        const ann = this.data.announcements?.find(a => a.isActive);
        if (!ann) {
            this.showToast('当前没有生效的公告', 'info');
            return;
        }
        
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
                <div class="p-4 border-b bg-gradient-to-r from-orange-50 to-amber-50 flex justify-between items-center">
                    <div>
                        <h3 class="font-bold text-lg text-gray-800">${ann.title || '公告'}</h3>
                        <p class="text-xs text-gray-500">${ann.author || '匿名'} · ${ann.date}</p>
                    </div>
                    <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="p-6 overflow-y-auto prose prose-sm max-w-none">
                    ${ann.content || ''}
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    },

    viewAnnouncementHistory() {
        if (!this.data.announcements || this.data.announcements.length === 0) {
            this.showToast('暂无历史公告', 'info');
            return;
        }
        
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
                <div class="p-4 border-b bg-gray-50 flex justify-between items-center">
                    <h3 class="font-bold text-lg text-gray-800">历史公告</h3>
                    <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="p-4 overflow-y-auto space-y-3">
                    ${this.data.announcements.map(ann => `
                        <div class="p-3 bg-gray-50 rounded-lg border ${ann.isActive ? 'border-orange-300 bg-orange-50' : 'border-gray-200'}">
                            <div class="flex justify-between items-start">
                                <h4 class="font-medium text-gray-800">${ann.title || '无标题'}</h4>
                                ${ann.isActive ? '<span class="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded">生效中</span>' : ''}
                            </div>
                            <p class="text-xs text-gray-500 mt-1">${ann.author || '匿名'} · ${ann.date}</p>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    },

    // ========== 词条操作 ==========
    createEntryCard(entry, version) {
        const div = document.createElement('div');
        div.className = 'bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden cursor-pointer hover:shadow-lg transition-all duration-300 active:scale-95 flex flex-col w-3/4 mx-auto';
        div.onclick = () => this.openEntry(entry.id);
        
        const img = version.images?.card || version.images?.avatar || version.image || '';
        const hasImage = img && (img.startsWith('data:') || img.startsWith('http'));
        
        div.innerHTML = `
            <div class="relative aspect-[3/4] overflow-hidden bg-gray-100 shrink-0">
                ${hasImage ? 
                    `<img src="${img}" class="w-full h-full object-cover transition-transform duration-500 hover:scale-110" alt="${version.title}" onerror="this.parentElement.innerHTML='<div class=\'w-full h-full flex items-center justify-center text-gray-300\'><i class=\'fa-solid fa-user text-4xl\'></i></div>'">` :
                    `<div class="w-full h-full flex items-center justify-center text-gray-300"><i class="fa-solid fa-user text-4xl"></i></div>`
                }
                <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8">
                    <div class="text-white font-bold text-sm truncate">${version.title}</div>
                    <div class="text-white/80 text-xs font-mono truncate">${entry.code}</div>
                </div>
            </div>
            <div class="p-3 flex-1 flex flex-col justify-between min-h-[60px]">
                <p class="text-xs text-gray-500 line-clamp-2">${version.subtitle || ''}</p>
            </div>
        `;
        
        return div;
    },

    openEntry(id) {
        this.data.editingId = id;
        this.router('detail');
    },

    createEntry(type) {
        this.data.editingType = type;
        this.data.editingId = null;
        this.router('edit');
    },

    createEntryFromList() {
        const type = this.data.currentTarget === 'characters' ? 'character' : 'non-character';
        this.createEntry(type);
    },

    editCurrentEntry() {
        this.router('edit');
    },

    switchToVersion(entryId, versionId) {
        try {
            this.data.editingId = entryId;
            this.data.viewingVersionId = versionId;
            // 使用 setTimeout 避免阻塞主线程，解决 Promise 回调问题
            setTimeout(() => {
                this.router('detail', false);
            }, 0);
        } catch (e) {
            console.error('[switchToVersion] 错误:', e);
        }
    },

    // ========== 保存词条 ==========
    async saveEntry() {
        if (!this.tempEntry || !this.tempVersion) return;
        
        this.tempVersion.title = document.getElementById('edit-title')?.value?.trim() || '';
        this.tempVersion.subtitle = document.getElementById('edit-subtitle')?.value?.trim() || '';
        
        if (!this.tempVersion.title) {
            this.showAlertDialog({
                title: '信息不完整',
                message: '请输入版本名称',
                type: 'warning'
            });
            return;
        }
        
        const existingIndex = this.data.entries.findIndex(e => e.id === this.tempEntry.id);
        if (existingIndex >= 0) {
            this.data.entries[existingIndex] = this.tempEntry;
        } else {
            this.data.entries.push(this.tempEntry);
        }
        
        try {
            await this.githubStorage.saveWikiData(this.data);
            this.showToast('保存成功', 'success');
            this.editState.hasChanges = false;
            this.unbindEditKeyboardShortcuts();
            this.tempEntry = null;
            this.tempVersion = null;
            this.router('home');
        } catch (error) {
            console.error('保存失败:', error);
            this.showAlertDialog({
                title: '保存失败',
                message: '无法保存到GitHub: ' + error.message,
                type: 'error'
            });
        }
    },

    async cancelEdit() {
        if (!this.editState.hasChanges && this.editState.undoStack.length === 0) {
            this.unbindEditKeyboardShortcuts();
            this.tempEntry = null;
            this.tempVersion = null;
            this.data.editingType = null;
            this.router('home');
            return;
        }
        
        const confirmed = await this.showConfirmDialog({
            title: '放弃编辑',
            message: '确定放弃当前编辑？\n未保存的修改将丢失。',
            confirmText: '放弃',
            cancelText: '继续编辑',
            type: 'warning'
        });
        
        if (confirmed) {
            this.unbindEditKeyboardShortcuts();
            this.tempEntry = null;
            this.tempVersion = null;
            this.data.editingType = null;
            this.editState.hasChanges = false;
            this.editState.undoStack = [];
            this.editState.redoStack = [];
            this.router('home');
        }
    },

    // ========== 删除词条 ==========
    async deleteEntry(id) {
        const index = this.data.entries.findIndex(e => e.id === id);
        if (index >= 0) {
            this.data.entries.splice(index, 1);
            
            try {
                await this.githubStorage.saveWikiData(this.data);
                this.showToast('删除成功', 'success');
                this.router('home');
            } catch (error) {
                console.error('删除失败:', error);
                this.showAlertDialog({
                    title: '删除失败',
                    message: '无法保存更改',
                    type: 'error'
                });
            }
        }
    },

    // ========== 数据导入 ==========
        async handleImportFolder(input) {
        const files = input.files;
        if (!files || files.length === 0) {
            this.showImportStatus('请选择文件夹', 'error');
            return;
        }

        this.showImportStatus('正在读取文件...', 'info');

        // 使用对象存储候选文件，避免重复声明
        const candidates = {
            dataJson: null,
            manifest: null
        };
        const imageFiles = [];

        for (const file of files) {
            const path = file.webkitRelativePath || file.name;
            
            if (path.endsWith('data.json') && !path.includes('/wiki-images/')) {
                candidates.dataJson = file;
            } else if (path.endsWith('wiki-manifest.json') && !path.includes('/wiki-images/')) {
                candidates.manifest = file;
            }
            
            if (path.includes('/wiki-images/') && file.type.startsWith('image/')) {
                imageFiles.push(file);
            }
        }

        // 确定使用哪个数据文件（data.json 优先）
        const dataFile = candidates.dataJson || candidates.manifest;

        if (!dataFile) {
            this.showImportStatus('未找到数据文件（data.json），请确保选择了正确的文件夹', 'error');
            return;
        }

        try {
            const dataText = await dataFile.text();
            const importedData = JSON.parse(dataText);

            if (importedData.mappings && !importedData.entries && !importedData.data) {
                this.showImportStatus('错误：选中了 wiki-manifest.json（资源映射文件），请选择包含 data.json 的文件夹', 'error');
                return;
            }

            if (!importedData.entries && !importedData.data?.entries) {
                this.showImportStatus('数据格式不正确：缺少 entries 数组', 'error');
                return;
            }

            this.showImportStatus(`找到 ${importedData.entries?.length || importedData.data?.entries?.length || 0} 个词条，${imageFiles.length} 张图片，正在导入...`, 'info');

            // 数据合并逻辑（与 ZIP 导入保持一致）
            const entries = importedData.entries || importedData.data?.entries || [];
            const existingIds = new Set(this.data.entries.map(e => e.id));
            let addedCount = 0;
            let skippedCount = 0;

            for (const entry of entries) {
                if (!existingIds.has(entry.id)) {
                    this.data.entries.push(entry);
                    addedCount++;
                } else {
                    skippedCount++;
                }
            }

            const mergeArray = (target, source, key = 'id') => {
                if (!source) return;
                const existing = new Set(target.map(i => i[key]));
                source.forEach(item => {
                    if (!existing.has(item[key])) target.push(item);
                });
            };

            mergeArray(this.data.chapters, importedData.chapters || importedData.data?.chapters);
            mergeArray(this.data.synopsis, importedData.synopsis || importedData.data?.synopsis);
            mergeArray(this.data.announcements, importedData.announcements || importedData.data?.announcements);

            (importedData.camps || importedData.data?.camps || []).forEach(camp => {
                if (!this.data.camps.includes(camp)) this.data.camps.push(camp);
            });

            if (importedData.settings) {
                this.data.settings = { ...this.data.settings, ...importedData.settings };
            }
            if (importedData.wikiTitle) this.data.wikiTitle = importedData.wikiTitle;
            if (importedData.wikiSubtitle) this.data.wikiSubtitle = importedData.wikiSubtitle;

            let uploadedImages = 0;
            if (imageFiles.length > 0 && this.githubStorage) {
                for (const imgFile of imageFiles) {
                    try {
                        const reader = new FileReader();
                        const dataUrl = await new Promise((resolve, reject) => {
                            reader.onload = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(imgFile);
                        });
                        await this.githubStorage.saveImage(imgFile.name, dataUrl);
                        uploadedImages++;
                    } catch (e) {
                        console.warn('图片上传失败:', imgFile.name, e);
                    }
                }
            }

            await this.githubStorage.saveWikiData(this.data);

            this.showImportStatus(
                `导入成功！新增 ${addedCount} 个词条${skippedCount > 0 ? `（跳过 ${skippedCount} 个重复）` : ''}，上传 ${uploadedImages}/${imageFiles.length} 张图片`,
                'success'
            );

            this.updateUIForMode();
            this.showToast('数据导入成功', 'success');

        } catch (error) {
            console.error('导入失败:', error);
            this.showImportStatus('导入失败: ' + error.message, 'error');
        }

        input.value = '';
    },
        // 处理ZIP文件选择
    handleZipFileSelect(input) {
        const file = input.files[0];
        if (!file) return;
        
        if (!file.name.endsWith('.zip')) {
            this.showAlertDialog({
                title: '格式错误',
                message: '请选择 .zip 格式的文件',
                type: 'warning'
            });
            return;
        }
        // 修改为调用新的带模式选择的导入
        this.importZipFile(file, 'ask'); // 'ask' 会弹出模式选择框
        input.value = '';
    },
    
    // ZIP文件导入（完整版）
    async importZipFile(zipFile) {
        if (!window.JSZip) {
            this.showAlertDialog({
                title: '缺少依赖',
                message: 'JSZip 库未加载，无法解析ZIP文件',
                type: 'error'
            });
            return;
        }

        try {
            this.showToast('正在解析ZIP文件...', 'info');
            const zip = await window.JSZip.loadAsync(zipFile);
            
            // 1. 读取 data.json（必需）
            const dataFile = zip.file('data.json');
            if (!dataFile) {
                throw new Error('ZIP中缺少 data.json 文件');
            }
            
            const dataText = await dataFile.async('string');
            const importedData = JSON.parse(dataText);
            
            // 验证数据结构
            if (!importedData.entries && !importedData.data?.entries) {
                throw new Error('数据格式不正确：缺少 entries 数组');
            }
            
            // 2. 处理图片
            const imageFiles = Object.keys(zip.files).filter(name => 
                name.startsWith('images/') && 
                !zip.files[name].dir &&
                (name.endsWith('.jpg') || name.endsWith('.png') || name.endsWith('.jpeg'))
            );
            
            console.log(`[Import] ZIP中包含 ${imageFiles.length} 张图片`);
            
            let uploadedImages = 0;
            const failedImages = [];
            
            for (const imgPath of imageFiles) {
                const filename = imgPath.replace('images/', '');
                try {
                    const arrayBuffer = await zip.file(imgPath).async('arraybuffer');
                    const blob = new Blob([arrayBuffer]);
                    
                    const dataUrl = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = (e) => resolve(e.target.result);
                        reader.readAsDataURL(blob);
                    });
                    
                    await this.githubStorage.saveImage(filename, dataUrl);
                    uploadedImages++;
                } catch (e) {
                    console.error(`[Import] 处理图片失败 ${filename}:`, e);
                    failedImages.push(filename);
                }
            }
            
            // 3. 合并数据
            const entries = importedData.entries || importedData.data?.entries || [];
            const existingIds = new Set(this.data.entries.map(e => e.id));
            let addedCount = 0;
            let skipCount = 0;
            
            for (const entry of entries) {
                if (!existingIds.has(entry.id)) {
                    this.data.entries.push(entry);
                    addedCount++;
                } else {
                    skipCount++;
                }
            }
            
            // 合并其他数据（chapters, camps, synopsis, announcements）
            const mergeArray = (target, source, key = 'id') => {
                const existing = new Set(target.map(i => i[key]));
                (source || []).forEach(item => {
                    if (!existing.has(item[key])) target.push(item);
                });
            };
            
            mergeArray(this.data.chapters, importedData.chapters || importedData.data?.chapters);
            mergeArray(this.data.synopsis, importedData.synopsis || importedData.data?.synopsis);
            mergeArray(this.data.announcements, importedData.announcements || importedData.data?.announcements);
            
            (importedData.camps || importedData.data?.camps || []).forEach(camp => {
                if (!this.data.camps.includes(camp)) this.data.camps.push(camp);
            });
            
            if (importedData.settings) {
                this.data.settings = { ...this.data.settings, ...importedData.settings };
            }
            
            // 4. 保存到 GitHub
            await this.saveData();
            
            const msg = [
                `导入成功！`,
                `新增 ${addedCount} 个词条${skipCount > 0 ? `（跳过 ${skipCount} 个重复）` : ''}`,
                `上传 ${uploadedImages}/${imageFiles.length} 张图片`,
                failedImages.length > 0 ? `失败 ${failedImages.length} 张: ${failedImages.join(', ')}` : ''
            ].filter(Boolean).join('\n');
            
            this.showAlertDialog({
                title: '导入完成',
                message: msg,
                type: 'success'
            });
            
            this.updateUIForMode();
            
        } catch (error) {
            console.error('[Import] ZIP导入失败:', error);
            this.showAlertDialog({
                title: '导入失败',
                message: error.message || '无法解析ZIP文件',
                type: 'error'
            });
        }
    },
        // ========== ZIP 文件导入（新增/恢复）==========
    
    // 完整的 importZipFile 方法（替换 wiki-github-core.js 中的原有方法）

// 【替换】完整的ZIP导入方法 - 修复分片逻辑和变量作用域
async importZipFile(zipFile, mode = 'ask', resumeFromShard = 0) {
    const isResuming = resumeFromShard > 0;
    const progress = this.showProgressDialog(
        isResuming ? `继续导入（从第 ${resumeFromShard} 批开始）` : '即将完成...'
    );
    
    // 【修复】在函数顶部定义imageFiles，确保整个函数可访问
    let imageFiles = [];
    let failedImages = [];
    
    try {
        // 步骤 1: 解析 ZIP
        progress.update(5, '解析ZIP文件...');
        const zip = await window.JSZip.loadAsync(zipFile);
        
        const dataFile = zip.file('data.json');
        if (!dataFile) throw new Error('ZIP中缺少 data.json');
        
        const dataText = await dataFile.async('string');
        const importedData = JSON.parse(dataText);
        const entries = importedData.entries || importedData.data?.entries || [];
        
        if (!Array.isArray(entries) || entries.length === 0) {
            throw new Error('没有可导入的词条');
        }

        // 步骤 2: 提取图片文件列表（修复变量定义位置）
        imageFiles = Object.keys(zip.files).filter(name => 
            name.startsWith('images/') && 
            !zip.files[name].dir &&
            (name.endsWith('.jpg') || name.endsWith('.png') || name.endsWith('.jpeg') || name.endsWith('.gif'))
        );
        console.log(`[Import] 发现 ${imageFiles.length} 张图片`);

        // 步骤 3: 模式选择（仅首次）
        if (mode === 'ask' && !isResuming) {
            progress.hide();
            const userChoice = await this.showImportModeDialog();
            if (userChoice === 'cancel') {
                progress.close();
                return;
            }
            mode = userChoice;
            progress.show();
        }

        // 步骤 4: 初始化数据（仅首次）
        if (!isResuming) {
            progress.update(10, mode === 'replace' ? '清空现有数据...' : '准备合并...');
            if (mode === 'replace') {
                this.initDefaultData();
                this.data.backendLoggedIn = this.backendLoggedIn;
                this.data.runMode = this.runMode;
            }
            
            // 合并设置等非条目数据
            const settings = importedData.settings || {
                name: importedData.wikiTitle,
                subtitle: importedData.wikiSubtitle,
                welcomeTitle: importedData.welcomeTitle,
                welcomeSubtitle: importedData.welcomeSubtitle
            };
            this.data.settings = { ...this.data.settings, ...settings };
            this.data.chapters = importedData.chapters || importedData.data?.chapters || this.data.chapters;
            this.data.camps = importedData.camps || importedData.data?.camps || this.data.camps;
        }

        // 步骤 5: 分片配置（保存到不同文件，避免409）
        const ENTRIES_PER_BATCH = 15; // 减小批次大小
        const totalEntries = entries.length;
        const totalBatches = Math.ceil(totalEntries / ENTRIES_PER_BATCH);
        
        let completedBatches = resumeFromShard;
        let failedBatches = [];

        // 步骤 6: 先保存基础data.json（不含entries，避免后续409）
        if (!isResuming) {
            progress.update(15, '初始化仓库结构...');
            const baseData = {
                version: '2.7.0-sharded-import',
                lastUpdate: Date.now(),
                totalEntries: totalEntries,
                entryFiles: [], // 预先计算
                settings: this.data.settings,
                chapters: this.data.chapters,
                camps: this.data.camps,
                synopsis: this.data.synopsis || [],
                announcements: this.data.announcements || [],
                homeContent: this.data.homeContent || [],
                customFields: this.data.customFields || {},
                importInProgress: true, // 标记导入中
                entries: [] // 先空数组，避免数据重复
            };
            
            // 预计算entryFiles
            for (let i = 0; i < totalBatches; i++) {
                baseData.entryFiles.push(`entries-${i}.json`);
            }
            
            // 保存初始data.json（这不会与后续分片冲突，因为分片是不同文件）
            try {
                await this.githubStorage.putFile('data.json', JSON.stringify(baseData, null, 2), 'Initialize import');
            } catch (e) {
                console.warn('[Import] 初始data.json保存失败，继续尝试...');
            }
        }

        // 步骤 7: 逐批处理条目（保存到独立分片文件，不触及data.json）
        for (let batchIndex = resumeFromShard; batchIndex < totalBatches; batchIndex++) {
            const start = batchIndex * ENTRIES_PER_BATCH;
            const end = Math.min(start + ENTRIES_PER_BATCH, totalEntries);
            const batchEntries = entries.slice(start, end);
            
            const percent = 20 + (60 * batchIndex / totalBatches);
            progress.update(percent, `导入批次 ${batchIndex + 1}/${totalBatches} (词条 ${start}-${end})...`);
            
            try {
                // 【关键修复】直接保存分片文件，而非调用saveBatchToGitHub保存data.json
                const shardFileName = `entries-${batchIndex}.json`;
                const shardData = batchEntries.map(entry => {
                    // 清理内嵌图片，避免分片过大
                    if (entry.versions) {
                        entry.versions.forEach(v => {
                            if (v.image && v.image.startsWith('data:')) v.image = null;
                            if (v.images) {
                                Object.keys(v.images).forEach(k => {
                                    if (v.images[k] && v.images[k].startsWith('data:')) v.images[k] = null;
                                });
                            }
                        });
                    }
                    return entry;
                });
                
                // 保存分片（带重试）
                let shardSaved = false;
                for (let retry = 0; retry < 3; retry++) {
                    try {
                        await this.githubStorage.putFile(
                            shardFileName, 
                            JSON.stringify(shardData, null, 2), 
                            `Import batch ${batchIndex} (entries ${start}-${end})`
                        );
                        shardSaved = true;
                        break;
                    } catch (e) {
                        if (e.message && e.message.includes('409')) {
                            console.warn(`[Import] 分片 ${shardIndex} 409冲突，等待重试...`);
                            await new Promise(r => setTimeout(r, 2000 * (retry + 1)));
                        } else {
                            throw e;
                        }
                    }
                }
                
                if (!shardSaved) {
                    throw new Error(`批次 ${batchIndex} 保存失败`);
                }
                
                // 添加到内存（用于后续图片处理后的最终保存）
                batchEntries.forEach(entry => {
                    const existingIdx = this.data.entries.findIndex(e => e.id === entry.id);
                    if (existingIdx >= 0) {
                        this.data.entries[existingIdx] = entry; // 更新
                    } else {
                        this.data.entries.push(entry); // 新增
                    }
                });
                
                completedBatches++;
                
                // 保存进度（支持断点续传）
                localStorage.setItem('wiki_import_progress', JSON.stringify({
                    filename: zipFile.name,
                    batchIndex: batchIndex + 1,
                    totalBatches: totalBatches,
                    mode: mode,
                    timestamp: Date.now()
                }));
                
            } catch (batchError) {
                console.error(`[Import] 批次 ${batchIndex} 失败:`, batchError);
                failedBatches.push({ index: batchIndex, error: batchError.message });
                // 继续下一批，不中断
            }
            
            // 批次间延迟（关键！避免GitHub限流）
            if (batchIndex < totalBatches - 1) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        // 步骤 8: 处理图片（并行但限制并发数）
        progress.update(85, `还有图片的内容...... (${imageFiles.length}张)...`);
        
        // 限制并发数（避免过多并行请求）
        const CONCURRENT_LIMIT = 3;
        for (let i = 0; i < imageFiles.length; i += CONCURRENT_LIMIT) {
            const batch = imageFiles.slice(i, i + CONCURRENT_LIMIT);
            await Promise.all(batch.map(async (imgPath) => {
                const filename = imgPath.replace('images/', '');
                try {
                    const arrayBuffer = await zip.file(imgPath).async('arraybuffer');
                    const blob = new Blob([arrayBuffer]);
                    const dataUrl = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = (e) => resolve(e.target.result);
                        reader.readAsDataURL(blob);
                    });
                    await this.githubStorage.saveImage(filename, dataUrl);
                    console.log(`[Import] 图片上传成功: ${filename}`);
                } catch (e) {
                    console.error(`[Import] 图片上传失败 ${filename}:`, e.message);
                    failedImages.push(filename);
                }
            }));
            
            // 每批图片后延迟
            if (i + CONCURRENT_LIMIT < imageFiles.length) {
                await new Promise(r => setTimeout(r, 500));
            }
        }

        // 步骤 9: 最终保存data.json（包含所有条目引用）
        progress.update(95, '最终保存...');
        const finalData = {
            version: '2.7.0-sharded',
            lastUpdate: Date.now(),
            totalEntries: this.data.entries.length,
            entryFiles: Array.from({length: totalBatches}, (_, i) => `entries-${i}.json`),
            settings: this.data.settings,
            chapters: this.data.chapters,
            camps: this.data.camps,
            synopsis: this.data.synopsis,
            announcements: this.data.announcements,
            homeContent: this.data.homeContent,
            customFields: this.data.customFields,
            importCompleted: true
        };
        
        // 清理finalData中的entries（因为已经分片保存）
        finalData.entries = []; // 或者保留，但通常分片模式下主文件不包含完整entries
        
        await this.githubStorage.putFile('data.json', JSON.stringify(finalData, null, 2), 'Import completed');

        // 完成
        progress.update(100, '导入完成！');
        localStorage.removeItem('wiki_import_progress');
        
        setTimeout(() => progress.close(), 500);

        const msg = [
            `导入完成！`,
            `成功: ${completedBatches}/${totalBatches} 个批次`,
            failedBatches.length > 0 ? `失败批次: ${failedBatches.map(b => b.index + 1).join(', ')}` : '',
            `图片: ${imageFiles.length - failedImages.length}/${imageFiles.length} 成功`,
            failedImages.length > 0 ? `失败图片: ${failedImages.length}张` : ''
        ].filter(Boolean).join('\n');

        this.showAlertDialog({
            title: failedBatches.length > 0 ? '导入完成（部分失败）' : '导入成功',
            message: msg,
            type: failedBatches.length > 0 ? 'warning' : 'success'
        });

        this.updateUIForMode();
        this.router('home');
        
    } catch (error) {
        progress.close();
        console.error('[Import] 失败:', error);
        
        if (confirm(`导入失败: ${error.message}\n\n是否保存进度以便稍后继续？`)) {
            this.showToast('进度已保存，请刷新后重新选择同一文件继续导入', 'info', 5000);
        } else {
            localStorage.removeItem('wiki_import_progress');
        }
    }
},

// 【新增】检查并恢复导入进度（页面加载时调用）
checkImportResume: async function() {
    const saved = localStorage.getItem('wiki_import_progress');
    if (!saved) return;
    
    try {
        const progress = JSON.parse(saved);
        // 检查是否超过 24 小时
        if (Date.now() - progress.timestamp > 24 * 60 * 60 * 1000) {
            localStorage.removeItem('wiki_import_progress');
            return;
        }
        
        // 提示用户是否继续
        if (confirm(`检测到未完成的导入: ${progress.filename}\n进度: ${progress.batchIndex}/${progress.totalBatches} 批次\n\n是否继续导入？`)) {
            // 重新选择文件继续
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.zip';
            input.onchange = (e) => {
                if (e.target.files[0]) {
                    this.importZipFile(e.target.files[0], progress.mode, progress.batchIndex);
                }
            };
            input.click();
        } else {
            localStorage.removeItem('wiki_import_progress');
        }
    } catch (e) {
        localStorage.removeItem('wiki_import_progress');
    }
},

// 【必需】图片压缩方法（如果之前没添加）
compressImageIfNeeded: function(dataUrl, maxWidth = 1920, maxHeight = 1080, quality = 0.85, maxSizeMB = 3) {
    return new Promise((resolve) => {
        // 估算大小
        const base64Length = dataUrl.length - (dataUrl.indexOf(',') + 1 || 0);
        const sizeInMB = (base64Length * 0.75) / 1024 / 1024;
        
        // 如果小于阈值，直接返回
        if (sizeInMB < maxSizeMB && !dataUrl.includes('image/gif')) {
            resolve(dataUrl);
            return;
        }

        console.log(`[Compress] 图片 ${sizeInMB.toFixed(2)}MB，开始压缩...`);
        
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;
            
            // 计算缩放比例
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = Math.floor(width * ratio);
                height = Math.floor(height * ratio);
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            // 转换为 JPEG
            let compressed = canvas.toDataURL('image/jpeg', quality);
            const newSize = ((compressed.length) * 0.75) / 1024 / 1024;
            
            // 如果仍然太大，进一步压缩
            if (newSize > maxSizeMB && quality > 0.5) {
                compressed = canvas.toDataURL('image/jpeg', quality - 0.15);
                console.log(`[Compress] 二次压缩至 ${((compressed.length)*0.75/1024/1024).toFixed(2)}MB`);
            }
            
            resolve(compressed);
        };
        
        img.onerror = () => {
            console.warn('[Compress] 图片加载失败，使用原图');
            resolve(dataUrl);
        };
        
        img.src = dataUrl;
    });
},

    // 【必需】辅助方法：合并或替换数组
    mergeOrReplaceArray: function(fieldName, newItems, mode, unique = false) {
        if (!newItems || newItems.length === 0) return;
        
        if (mode === 'replace') {
            this.data[fieldName] = newItems;
            return;
        }
        
        // 合并模式
        const existing = this.data[fieldName] || [];
        const existingIds = new Set(existing.map(i => i.id || i));
        
        for (const item of newItems) {
            const itemId = item.id || item;
            if (!existingIds.has(itemId)) {
                existing.push(item);
                if (unique) existingIds.add(itemId);
            } else if (!unique && item.id) {
                // 对于对象数组，更新已存在的项
                const idx = existing.findIndex(e => e.id === item.id);
                if (idx !== -1) existing[idx] = item;
            }
        }
        
        this.data[fieldName] = existing;
    },

    // 【新增】获取系统配置（导入时保留）
    getSystemConfig: function() {
        return {
            backendLoggedIn: this.backendLoggedIn,
            backendPassword: this.backendPassword,
            runMode: this.runMode,
            githubStorage: this.githubStorage ? {
                config: this.githubStorage.config
            } : null
        };
    },

    // 【新增】导入模式选择对话框
    showImportModeDialog: function() {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
            overlay.innerHTML = `
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
                    <div class="text-center mb-6">
                        <div class="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <i class="fa-solid fa-file-import text-indigo-600 text-2xl"></i>
                        </div>
                        <h3 class="text-xl font-bold text-gray-800 mb-2">选择导入模式</h3>
                        <p class="text-gray-600 text-sm">检测到存档文件，请选择如何处理现有数据</p>
                    </div>
                    
                    <div class="space-y-3 mb-6">
                        <button id="mode-replace" class="w-full p-4 border-2 border-indigo-200 rounded-xl hover:border-indigo-500 hover:bg-indigo-50 transition text-left group">
                            <div class="flex items-center gap-3">
                                <i class="fa-solid fa-rotate text-indigo-600 text-xl"></i>
                                <div>
                                    <div class="font-bold text-gray-800 group-hover:text-indigo-700">完全覆盖</div>
                                    <div class="text-xs text-gray-500">清空现有数据，使用存档完全替换</div>
                                </div>
                            </div>
                        </button>
                        
                        <button id="mode-merge" class="w-full p-4 border-2 border-gray-200 rounded-xl hover:border-indigo-500 hover:bg-indigo-50 transition text-left group">
                            <div class="flex items-center gap-3">
                                <i class="fa-solid fa-code-merge text-gray-600 text-xl group-hover:text-indigo-600"></i>
                                <div>
                                    <div class="font-bold text-gray-800 group-hover:text-indigo-700">智能合并</div>
                                    <div class="text-xs text-gray-500">保留现有数据，更新相同ID的条目，添加新条目</div>
                                </div>
                            </div>
                        </button>
                    </div>
                    
                    <button id="mode-cancel" class="w-full py-2 text-gray-500 hover:text-gray-700 text-sm">
                        取消导入
                    </button>
                </div>
            `;
            
            document.body.appendChild(overlay);
            
            overlay.querySelector('#mode-replace').onclick = () => {
                overlay.remove();
                resolve('replace');
            };
            overlay.querySelector('#mode-merge').onclick = () => {
                overlay.remove();
                resolve('merge');
            };
            overlay.querySelector('#mode-cancel').onclick = () => {
                overlay.remove();
                resolve('cancel');
            };
            
            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                    resolve('cancel');
                }
            };
        });
    },

    showImportStatus(message, type) {
        const statusEl = document.getElementById('import-status');
        if (!statusEl) return;

        statusEl.classList.remove('hidden', 'bg-green-100', 'text-green-700', 'bg-red-100', 'text-red-700', 'bg-blue-100', 'text-blue-700');

        const colors = {
            success: ['bg-green-100', 'text-green-700'],
            error: ['bg-red-100', 'text-red-700'],
            info: ['bg-blue-100', 'text-blue-700']
        };

        statusEl.classList.add(...(colors[type] || colors.info));
        statusEl.textContent = message;
    },

    // 处理 data.json 中的内嵌图片（提取并替换为引用）
    extractEmbeddedImages: async function(data) {
        let imageCount = 0;
        const entries = data.entries || [];
        
        for (const entry of entries) {
            if (!entry.versions) continue;
            
            for (const version of entry.versions) {
                // 处理旧版单个 image 字段
                if (version.image && version.image.startsWith('data:image')) {
                    try {
                        const compressed = await this.compressImageIfNeeded(version.image);
                        const imgName = `${entry.id}_${version.vid}_image.jpg`;
                        await this.githubStorage.saveImage(imgName, compressed);
                        version.image = `{{IMG:${imgName}}`;
                        imageCount++;
                        console.log(`[Extract] 提取条目 ${entry.code} 的内嵌图片`);
                    } catch (e) {
                        console.warn(`[Extract] 提取失败，移除内嵌图片:`, e.message);
                        version.image = null; // 失败则移除，避免 data.json 过大
                    }
                }
            }
        }
        
        return { data, imageCount };
    },
    // ========== 分享码管理 ==========
    async generateShareCode() {
        const codeInput = document.getElementById('new-share-code');
        const descInput = document.getElementById('share-code-desc');
        
        let code = codeInput.value.trim().toUpperCase();
        if (!code) {
            code = this.shareCodeSystem.generateCode();
        }
        
        if (!this.shareCodeSystem.validateCode(code)) {
            this.showAlertDialog({
                title: '格式错误',
                message: '分享码应为8位字母数字组合',
                type: 'warning'
            });
            return;
        }
        
        const success = await this.shareCodeSystem.saveShareCode(code, descInput.value);
        
        if (success) {
            this.showToast('分享码已生成', 'success');
            codeInput.value = '';
            descInput.value = '';
            this.loadShareCodeList(document.getElementById('share-code-list'));
        } else {
            this.showAlertDialog({
                title: '生成失败',
                message: '无法保存分享码',
                type: 'error'
            });
        }
    },

    async loadShareCodeList(container) {
        if (!container) return;
        
        const codes = await this.shareCodeSystem.loadShareCodes();
        container.innerHTML = '';
        
        Object.entries(codes).forEach(([code, info]) => {
            const item = document.createElement('div');
            item.className = 'flex items-center justify-between p-3 bg-gray-50 rounded-lg';
            item.innerHTML = `
                <div class="flex items-center gap-3">
                    <span class="font-mono font-bold text-amber-600">${code}</span>
                    ${info.description ? `<span class="text-xs text-gray-500">${info.description}</span>` : ''}
                </div>
                <div class="flex gap-2">
                    <button onclick="app.copyShareCode('${code}')" class="text-gray-500 hover:text-indigo-600 p-1" title="复制">
                        <i class="fa-solid fa-copy"></i>
                    </button>
                    <button onclick="app.deleteShareCode('${code}')" class="text-gray-500 hover:text-red-600 p-1" title="删除">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `;
            container.appendChild(item);
        });
        
        if (Object.keys(codes).length === 0) {
            container.innerHTML = '<p class="text-center text-gray-400 text-sm py-4">暂无分享码</p>';
        }
    },

    async deleteShareCode(code) {
        const confirmed = await this.showConfirmDialog({
            title: '删除确认',
            message: `确定删除分享码 ${code}？`,
            confirmText: '删除',
            cancelText: '取消',
            type: 'danger'
        });
        
        if (confirmed) {
            await this.shareCodeSystem.deleteCode(code);
            this.loadShareCodeList(document.getElementById('share-code-list'));
        }
    },

    copyShareCode(code) {
        navigator.clipboard.writeText(code).then(() => {
            this.showToast('已复制到剪贴板', 'success');
        });
    },
    // 【新增】修复图片引用并重新上传丢失的图片
    async fixAndReloadImages() {
        const progress = this.showProgressDialog('修复图片引用...');
        let fixedCount = 0;
        let missingCount = 0;
        
        try {
            // 获取 GitHub 上实际存在的图片列表
            progress.update(10, '获取远程图片列表...');
            const remoteImages = await this.githubStorage.getImageList();
            const remoteSet = new Set(remoteImages);
            
            progress.update(30, '检查条目图片引用...');
            
            for (const entry of this.data.entries) {
                if (!entry.versions) continue;
                
                for (const version of entry.versions) {
                    if (!version.images) continue;
                    
                    for (const [key, value] of Object.entries(version.images)) {
                        if (!value || !value.startsWith('{{IMG:')) continue;
                        
                        const filename = value.slice(6, -2);
                        
                        // 检查图片是否存在于 GitHub
                        if (!remoteSet.has(filename)) {
                            console.warn(`[FixImage] 缺失: ${filename}`);
                            missingCount++;
                            // 清空引用（标记为缺失）
                            version.images[key] = null;
                        } else {
                            fixedCount++;
                        }
                    }
                }
            }
            
            progress.update(80, '保存修复后的数据...');
            await this.saveData();
            
            progress.update(100, `完成！修复 ${fixedCount} 张，缺失 ${missingCount} 张`);
            setTimeout(() => progress.close(), 1000);
            
            if (missingCount > 0) {
                this.showAlertDialog({
                    title: '图片修复报告',
                    message: `${missingCount} 张图片在仓库中不存在，已清除引用。\n请重新导入包含图片的ZIP文件。`,
                    type: 'warning'
                });
            }
            
        } catch (e) {
            progress.close();
            console.error('[FixImage] 失败:', e);
        }
    },

// 【新增】在设置页面添加"修复图片"按钮的调用
// 在 renderSettings 中添加一个按钮调用此方法

    // ========== 数据导出 ==========
    exportData() {
        const dataStr = JSON.stringify(this.data, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wiki-data-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('数据已导出', 'success');
    },

    async exportZipBackup() {
        const JSZip = window.JSZip;
        if (!JSZip) {
            this.showToast('ZIP库未加载', 'error');
            return;
        }
        // 【修复】确保导出时包含所有字段，包括 homeContent 和 customFields
        const exportData = {
            // 基础字段
            entries: this.data.entries,
            chapters: this.data.chapters,
            camps: this.data.camps,
            synopsis: this.data.synopsis,
            announcements: this.data.announcements,
            homeContent: this.data.homeContent || [],
            customFields: this.data.customFields || {},
            
            // 设置字段（兼容GitHub版和本地版格式）
            settings: {
                name: this.data.wikiTitle,
                subtitle: this.data.wikiSubtitle,
                welcomeTitle: this.data.welcomeTitle,
                welcomeSubtitle: this.data.welcomeSubtitle,
                customFont: this.data.fontFamily
            },
            wikiTitle: this.data.wikiTitle, // 冗余保留确保兼容
            wikiSubtitle: this.data.wikiSubtitle,
            fontFamily: this.data.fontFamily,
            
            // 元数据
            version: '2.5.0-github',
            exportTime: Date.now()
        };
        
        const zip = new JSZip();
        zip.file('data.json', JSON.stringify(exportData, null, 2));
        
        const imagesFolder = zip.folder('wiki-images');
        const imageList = await this.githubStorage.getImageList();
        
        for (const filename of imageList) {
            const imgUrl = await this.githubStorage.loadImage(filename);
            if (imgUrl) {
                try {
                    const response = await fetch(imgUrl);
                    const blob = await response.blob();
                    imagesFolder.file(filename, blob);
                } catch (e) {
                    console.warn('无法下载图片:', filename);
                }
            }
        }
        
        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wiki-backup-${Date.now()}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('备份已导出', 'success');
    },

    // ========== 字体设置 ==========
    changeFont(font) {
        this.data.fontFamily = font;
        this.data.settings = this.data.settings || {};
        this.data.settings.customFont = font;
        
        // 切换字体类而非直接修改CSS变量（避免CORS问题）
        if (font.includes('Serif')) {
            document.body.classList.add('font-serif');
        } else {
            document.body.classList.remove('font-serif');
        }
        
        // 同时更新CSS变量作为后备
        document.documentElement.style.setProperty('--custom-font', font);
    },

    applyFont() {
        const font = this.data.settings?.customFont || this.data.fontFamily || "'Noto Sans SC', sans-serif";
        
        // 应用字体设置
        if (font && font.includes('Serif')) {
            document.body.classList.add('font-serif');
        } else {
            document.body.classList.remove('font-serif');
        }
        
        document.documentElement.style.setProperty('--custom-font', font);
        document.body.style.fontFamily = font;
    },

    // ========== 辅助函数 ==========
    getVisibleVersion(entry) {
        if (!entry || !entry.versions || entry.versions.length === 0) return null;
        
        // 【关键修复】优先返回手动切换的版本（viewingVersionId）
        if (this.data.viewingVersionId) {
            const specificVersion = entry.versions.find(v => v.vid === this.data.viewingVersionId);
            if (specificVersion) return specificVersion;
        }
        
        // 时间线模式逻辑保持不变
        if (this.data.currentTimeline === 'latest') {
            return entry.versions[entry.versions.length - 1];
        }
        
        const currentCh = this.data.chapters.find(c => c.id === this.data.currentTimeline);
        if (!currentCh) return entry.versions[entry.versions.length - 1];
        
        return entry.versions.find(v => {
            const fromOrder = this.getChapterOrder(v.chapterFrom);
            const toOrder = this.getChapterOrder(v.chapterTo);
            return currentCh.order >= fromOrder && currentCh.order <= toOrder;
        }) || entry.versions[entry.versions.length - 1];
    },

    getChapterOrder(chapterId) {
        if (!chapterId) return -1;
        const chapter = this.data.chapters.find(c => c.id === chapterId);
        return chapter ? chapter.order : -1;
    },

    formatChapterNum(num) {
        if (num === undefined || num === null) return '';
        if (typeof num === 'string') return num;
        return `第${num}章`;
    },

    generateCode(type) {
        const prefix = type === 'character' ? 'C' : 'S';
        const existing = this.data.entries.filter(e => e.type === type);
        const maxNum = existing.reduce((max, e) => {
            const match = e.code.match(/\d+/);
            return match ? Math.max(max, parseInt(match[0])) : max;
        }, 0);
        return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
    },

    searchAndOpen(name) {
        const entry = this.data.entries.find(e => {
            const v = this.getVisibleVersion(e);
            return v && v.title === name;
        });
        
        if (entry) {
            this.openEntry(entry.id);
        } else {
            this.showToast('未找到该词条', 'warning');
        }
    },

    // ========== 键盘快捷键 ==========
    bindEditKeyboardShortcuts() {
        const handler = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                this.saveEntry();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
                e.preventDefault();
                this.undo();
            }
        };
        
        document.addEventListener('keydown', handler);
        this._editKeyHandler = handler;
    },

    unbindEditKeyboardShortcuts() {
        if (this._editKeyHandler) {
            document.removeEventListener('keydown', this._editKeyHandler);
            this._editKeyHandler = null;
        }
    },

    undo() {
        this.showToast('撤销功能开发中', 'info');
    },

    // ========== 弹窗系统 ==========
    showConfirmDialog(options) {
        return new Promise((resolve) => {
            const { title = '确认', message, confirmText = '确认', cancelText = '取消', type = 'info' } = options;
            
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
            
            const iconColors = {
                info: 'text-blue-600 bg-blue-100',
                warning: 'text-amber-600 bg-amber-100',
                danger: 'text-red-600 bg-red-100',
                success: 'text-green-600 bg-green-100'
            };
            
            const icons = {
                info: 'fa-circle-info',
                warning: 'fa-triangle-exclamation',
                danger: 'fa-circle-exclamation',
                success: 'fa-check-circle'
            };
            
            overlay.innerHTML = `
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 transform scale-100 transition-transform">
                    <div class="text-center mb-6">
                        <div class="w-16 h-16 ${iconColors[type]} rounded-full flex items-center justify-center mx-auto mb-4">
                            <i class="fa-solid ${icons[type]} text-2xl"></i>
                        </div>
                        <h3 class="text-xl font-bold text-gray-800 mb-2">${title}</h3>
                        <p class="text-gray-600 text-sm whitespace-pre-wrap">${message}</p>
                    </div>
                    <div class="flex gap-3">
                        <button id="confirm-cancel" class="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium">
                            ${cancelText}
                        </button>
                        <button id="confirm-ok" class="flex-1 py-2.5 ${type === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white rounded-lg transition font-medium shadow-lg">
                            ${confirmText}
                        </button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(overlay);
            
            overlay.querySelector('#confirm-cancel').onclick = () => {
                overlay.remove();
                resolve(false);
            };
            
            overlay.querySelector('#confirm-ok').onclick = () => {
                overlay.remove();
                resolve(true);
            };
            
            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                    resolve(false);
                }
            };
        });
    },

    showAlertDialog(options) {
        return new Promise((resolve) => {
            const { title = '提示', message, confirmText = '确定', type = 'info' } = options;
            
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
            
            const iconColors = {
                info: 'text-blue-600 bg-blue-100',
                warning: 'text-amber-600 bg-amber-100',
                danger: 'text-red-600 bg-red-100',
                success: 'text-green-600 bg-green-100'
            };
            
            const icons = {
                info: 'fa-circle-info',
                warning: 'fa-triangle-exclamation',
                danger: 'fa-circle-exclamation',
                success: 'fa-check-circle'
            };
            
            overlay.innerHTML = `
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 transform scale-100 transition-transform">
                    <div class="text-center mb-6">
                        <div class="w-16 h-16 ${iconColors[type]} rounded-full flex items-center justify-center mx-auto mb-4">
                            <i class="fa-solid ${icons[type]} text-2xl"></i>
                        </div>
                        <h3 class="text-xl font-bold text-gray-800 mb-2">${title}</h3>
                        <p class="text-gray-600 text-sm whitespace-pre-wrap">${message}</p>
                    </div>
                    <button id="alert-ok" class="w-full py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium shadow-lg">
                        ${confirmText}
                    </button>
                </div>
            `;
            
            document.body.appendChild(overlay);
            
            overlay.querySelector('#alert-ok').onclick = () => {
                overlay.remove();
                resolve(true);
            };
            
            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                    resolve(true);
                }
            };
        });
    },

    showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `fixed top-20 left-1/2 transform -translate-x-1/2 z-[99999] px-4 py-2 rounded-lg shadow-lg text-white text-sm flex items-center gap-2 fade-in`;
        
        const colors = {
            info: 'bg-blue-600',
            success: 'bg-green-600',
            warning: 'bg-amber-600',
            error: 'bg-red-600'
        };
        
        toast.classList.add(colors[type] || colors.info);
        
        const icons = {
            info: 'fa-circle-info',
            success: 'fa-check-circle',
            warning: 'fa-triangle-exclamation',
            error: 'fa-circle-exclamation'
        };
        
        toast.innerHTML = `
            <i class="fa-solid ${icons[type]}"></i>
            <span>${message}</span>
        `;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(-10px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    // ========== 搜索功能 ==========
    handleSearchInput(value) {
        const dropdown = document.getElementById('search-dropdown');
        if (!value.trim()) {
            dropdown.classList.add('hidden');
            return;
        }
        
        const results = this.data.entries.filter(e => {
            const v = this.getVisibleVersion(e);
            return v && (e.code.toLowerCase().includes(value.toLowerCase()) || 
                        v.title.toLowerCase().includes(value.toLowerCase()));
        }).slice(0, 8);
        
        if (results.length === 0) {
            dropdown.innerHTML = '<div class="p-3 text-center text-gray-400 text-sm">无结果</div>';
        } else {
            dropdown.innerHTML = results.map(e => {
                const v = this.getVisibleVersion(e);
                return `
                    <div class="p-3 hover:bg-gray-50 cursor-pointer flex items-center gap-3" onclick="app.openEntry('${e.id}'); app.hideSearchDropdown();">
                        <span class="font-mono text-xs text-gray-400">${e.code}</span>
                        <span class="text-sm text-gray-700">${v.title}</span>
                    </div>
                `;
            }).join('');
        }
        
        dropdown.classList.remove('hidden');
    },

    showSearchDropdown() {
        const dropdown = document.getElementById('search-dropdown');
        const input = document.getElementById('global-search');
        if (input && input.value.trim()) {
            dropdown.classList.remove('hidden');
        }
    },

    hideSearchDropdown() {
        setTimeout(() => {
            const dropdown = document.getElementById('search-dropdown');
            if (dropdown) dropdown.classList.add('hidden');
        }, 200);
    },

    // ========== 首页自定义内容 ==========
    addHomeTextBox() {
        if (!this.data.homeContent) this.data.homeContent = [];
        this.data.homeContent.push({ type: 'text', content: '' });
        this.renderHomeCustomContent();
    },

    addHomeEntryRef() {
        this.showEntrySelectDialog((entry) => {
            if (!entry) return;
            const visibleVersion = this.getVisibleVersion(entry);
            const title = visibleVersion ? visibleVersion.title : entry.code;
            if (!this.data.homeContent) this.data.homeContent = [];
            this.data.homeContent.push({ type: 'entry-ref', entryId: entry.id, title: title });
            this.renderHomeCustomContent();
        });
    },

    showEntrySelectDialog(callback) {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/50 z-[99999] flex items-center justify-center p-4 fade-in';
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden">
                <div class="p-4 border-b bg-gray-50 flex justify-between items-center">
                    <h3 class="font-bold text-lg text-gray-800">选择词条</h3>
                    <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="p-4">
                    <input type="text" id="entry-search-input" placeholder="搜索词条名称或编号..." 
                        class="w-full p-2 border border-gray-200 rounded-lg text-sm mb-4 focus:ring-2 focus:ring-indigo-500 outline-none">
                    <div id="entry-select-list" class="space-y-1 max-h-[50vh] overflow-y-auto"></div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        
        const list = overlay.querySelector('#entry-select-list');
        const searchInput = overlay.querySelector('#entry-search-input');
        
        const renderEntries = (filter = '') => {
            list.innerHTML = '';
            this.data.entries.forEach(entry => {
                const visibleVersion = this.getVisibleVersion(entry);
                const title = visibleVersion ? visibleVersion.title : entry.code;
                if (filter && !entry.code.toLowerCase().includes(filter.toLowerCase()) && !title.toLowerCase().includes(filter.toLowerCase())) return;
                
                const item = document.createElement('div');
                item.className = 'p-3 hover:bg-indigo-50 cursor-pointer rounded-lg border-b border-gray-100 flex items-center gap-3 transition';
                item.innerHTML = `
                    <span class="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold">${entry.code}</span>
                    <span class="text-sm text-gray-700">${title}</span>
                `;
                item.onclick = () => { overlay.remove(); callback(entry); };
                list.appendChild(item);
            });
        };
        
        renderEntries();
        searchInput.oninput = (e) => renderEntries(e.target.value);
        searchInput.focus();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    },

    updateHomeText(idx, value) {
        if (this.data.homeContent && this.data.homeContent[idx]) {
            this.data.homeContent[idx].content = value;
        }
    },

    removeHomeItem(idx) {
        if (this.data.homeContent) {
            this.data.homeContent.splice(idx, 1);
            this.renderHomeCustomContent();
        }
    },

    saveHomeContent() {
        this.saveData();
        this.showToast('首页内容已保存', 'success');
    },

    // ========== 版本管理器（占位）==========
    showVersionManager() {
        this.showToast('版本管理器功能开发中', 'info');
    },

    // 【新增】进度条弹窗系统
    // 替换 showProgressDialog 方法（添加 show 方法）

    showProgressDialog: function(title = '处理中') {
        const overlay = document.createElement('div');
        overlay.id = 'global-progress-overlay';
        overlay.className = 'fixed inset-0 bg-black/60 z-[100000] flex items-center justify-center p-4';
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
                <h3 id="progress-title" class="text-lg font-bold text-gray-800 mb-4">${title}</h3>
                <div class="w-full bg-gray-200 rounded-full h-3 mb-3 overflow-hidden">
                    <div id="progress-bar" class="bg-indigo-600 h-3 rounded-full transition-all duration-300 ease-out" style="width: 0%"></div>
                </div>
                <div class="flex justify-between items-center">
                    <span id="progress-text" class="text-sm text-gray-600">准备中...</span>
                    <span id="progress-percent" class="text-sm font-bold text-indigo-600">0%</span>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        
        return {
            update: (percent, text) => {
                const bar = document.getElementById('progress-bar');
                const percentText = document.getElementById('progress-percent');
                const descText = document.getElementById('progress-text');
                if (bar) bar.style.width = Math.max(0, Math.min(100, percent)) + '%';
                if (percentText) percentText.textContent = Math.round(percent) + '%';
                if (descText && text) descText.textContent = text;
            },
            close: () => {
                const el = document.getElementById('global-progress-overlay');
                if (el) {
                    el.style.opacity = '0';
                    el.style.transition = 'opacity 0.3s';
                    setTimeout(() => el.remove(), 300);
                }
            },
            // 【新增】show 方法，用于重新显示（如果之前只是隐藏）
            show: () => {
                const el = document.getElementById('global-progress-overlay');
                if (el) {
                    el.style.display = 'flex';
                    el.style.opacity = '1';
                }
            },
            // 【新增】hide 方法，用于临时隐藏（不删除元素）
            hide: () => {
                const el = document.getElementById('global-progress-overlay');
                if (el) {
                    el.style.opacity = '0';
                    setTimeout(() => { if(el.style.opacity === '0') el.style.display = 'none'; }, 300);
                }
            }
        };
    },
    // 【替换】saveData 方法 - 实现分片保存与冲突退避
    async saveData(progressCallback = null) {
        try {
            console.log('[Wiki] 开始分片保存数据...');
            
            // 确保基础数据结构
            if (!this.data.entries) this.data.entries = [];
            if (!this.data.settings) this.data.settings = {};
            
            const totalEntries = this.data.entries.length;
            console.log(`[Wiki] 需要保存 ${totalEntries} 个词条`);
            
            // 分片配置：每 20 个词条一个文件（降低单文件大小，减少409概率）
            const ENTRIES_PER_FILE = 20;
            const totalFiles = Math.ceil(totalEntries / ENTRIES_PER_FILE) + 1; // +1 用于基础数据
            
            if (progressCallback) progressCallback(5, '正在准备数据...');
            
            // 1. 构建基础数据（settings, chapters, camps, synopsis, announcements, homeContent）
            const baseData = {
                version: '2.7.0-sharded',
                lastUpdate: Date.now(),
                totalEntries: totalEntries,
                entryFiles: [], // 记录分片文件列表
                settings: this.data.settings,
                chapters: this.data.chapters || [],
                camps: this.data.camps || ['主角团', '反派', '中立'],
                synopsis: this.data.synopsis || [],
                announcements: this.data.announcements || [],
                homeContent: this.data.homeContent || [],
                customFields: this.data.customFields || {}
            };
            
            // 2. 清理并准备分片数据（移除内嵌base64图片，避免data.json膨胀）
            const cleanedEntries = JSON.parse(JSON.stringify(this.data.entries));
            cleanedEntries.forEach(entry => {
                if (entry.versions) {
                    entry.versions.forEach(v => {
                        // 移除内嵌 base64，保留引用
                        if (v.image && v.image.startsWith('data:')) v.image = null;
                        if (v.images) {
                            Object.keys(v.images).forEach(k => {
                                if (v.images[k] && v.images[k].startsWith('data:')) {
                                    v.images[k] = null;
                                }
                            });
                        }
                    });
                }
            });
            
            // 3. 分片保存 entries
            const entryShards = [];
            for (let i = 0; i < totalEntries; i += ENTRIES_PER_FILE) {
                const shard = cleanedEntries.slice(i, i + ENTRIES_PER_FILE);
                const fileName = `entries-${Math.floor(i / ENTRIES_PER_FILE)}.json`;
                entryShards.push({ 
                    name: fileName, 
                    data: shard, 
                    start: i, 
                    end: Math.min(i + ENTRIES_PER_FILE, totalEntries),
                    size: JSON.stringify(shard).length 
                });
                baseData.entryFiles.push(fileName);
            }
            
            console.log(`[Wiki] 分为 ${entryShards.length} 个分片，基础数据 ${JSON.stringify(baseData).length} 字节`);
            
            if (progressCallback) progressCallback(10, '保存基础数据...');
            
            // 4. 先保存基础数据（这样即使分片失败，结构还在）
            let baseSaved = false;
            for (let retry = 0; retry < 3; retry++) {
                try {
                    await this.githubStorage.putFile('data.json', JSON.stringify(baseData, null, 2), 'Update Wiki base data');
                    baseSaved = true;
                    console.log('[Wiki] ✅ 基础数据已保存');
                    break;
                } catch (e) {
                    console.warn(`[Wiki] 基础数据保存尝试 ${retry + 1} 失败:`, e.message);
                    if (retry === 2) throw new Error('基础数据保存失败: ' + e.message);
                    await new Promise(r => setTimeout(r, 1000 * (retry + 1)));
                }
            }
            
            if (progressCallback) progressCallback(20, `开始保存 ${entryShards.length} 个分片...`);
            
            // 5. 逐个保存分片（带批次间延迟和独立重试）
            let savedShards = 0;
            let failedShards = [];
            
            for (let i = 0; i < entryShards.length; i++) {
                const shard = entryShards[i];
                let shardSaved = false;
                
                // 【关键】批次间添加基础延迟，避免GitHub API限流和409冲突
                if (i > 0) {
                    const batchDelay = 800; // 每个批次间隔800ms
                    console.log(`[Wiki] 批次间隔等待 ${batchDelay}ms...`);
                    await new Promise(r => setTimeout(r, batchDelay));
                }
                
                // 每个分片独立重试3次，使用指数退避
                for (let retry = 0; retry < 3; retry++) {
                    try {
                        console.log(`[Wiki] 保存分片 ${shard.name} (${shard.start}-${shard.end}, ${shard.size} 字节)...`);
                        
                        await this.githubStorage.putFile(
                            shard.name, 
                            JSON.stringify(shard.data, null, 2), 
                            `Update entries ${shard.start}-${shard.end}`
                        );
                        
                        savedShards++;
                        shardSaved = true;
                        console.log(`[Wiki] ✅ 分片 ${shard.name} 已保存`);
                        break;
                        
                    } catch (e) {
                        console.warn(`[Wiki] ⚠️ 分片 ${shard.name} 尝试 ${retry + 1}/3 失败:`, e.message);
                        
                        if (retry < 2) {
                            // 指数退避：1秒, 2秒
                            const waitTime = 1000 * Math.pow(2, retry);
                            console.log(`[Wiki] 等待 ${waitTime}ms 后重试...`);
                            await new Promise(r => setTimeout(r, waitTime));
                        }
                    }
                }
                
                if (!shardSaved) {
                    failedShards.push(shard.name);
                    console.error(`[Wiki] ❌ 分片 ${shard.name} 最终失败`);
                }
                
                // 更新进度：20% ~ 90%
                const progress = 20 + (70 * (i + 1) / entryShards.length);
                if (progressCallback) progressCallback(progress, `正在保存词条 ${shard.end}/${totalEntries}...`);
            }
            
            // 6. 如果有失败的分片，更新 data.json 标记
            if (failedShards.length > 0) {
                baseData.failedShards = failedShards;
                baseData.lastUpdate = Date.now();
                
                // 尝试更新标记（不重试，避免无限循环）
                try {
                    await this.githubStorage.putFile('data.json', JSON.stringify(baseData, null, 2), 'Update base data (mark failed shards)');
                } catch (e) {
                    console.warn('[Wiki] 标记失败分片时出错:', e.message);
                }
                
                console.warn(`[Wiki] ⚠️ ${failedShards.length} 个分片保存失败已标记:`, failedShards);
            }
            
            if (progressCallback) progressCallback(95, '正在验证...');
            
            // 7. 简单验证（重新读取 data.json）
            let verifySuccess = false;
            for (let vRetry = 0; vRetry < 3; vRetry++) {
                try {
                    // 等待GitHub缓存刷新
                    if (vRetry > 0) await new Promise(r => setTimeout(r, 1000));
                    
                    const verify = await this.githubStorage.getFile('data.json');
                    if (verify && verify.content) {
                        const parsed = JSON.parse(verify.content);
                        if (parsed.version && parsed.lastUpdate) {
                            verifySuccess = true;
                            break;
                        }
                    }
                } catch (e) {
                    console.warn(`[Wiki] 验证尝试 ${vRetry + 1} 失败:`, e.message);
                }
            }
            
            if (!verifySuccess) {
                console.warn('[Wiki] ⚠️ 验证步骤未通过，但数据可能已保存');
            }
            
            if (progressCallback) progressCallback(100, '保存完成！');
            
            const successMsg = failedShards.length > 0 
                ? `已保存，但 ${failedShards.length} 个分片失败` 
                : '所有数据已保存到GitHub';
            console.log(`[Wiki] ✅ ${successMsg}`);
            
            return {
                success: true,
                totalShards: entryShards.length,
                savedShards: savedShards,
                failedShards: failedShards
            };
            
        } catch (error) {
            console.error('[Wiki] ❌ 保存失败:', error);
            throw error;
        }
    },

    // 【新增】分片加载方法（需要在 loadDataFromGitHub 中使用）
    async loadShardedData(baseData) {
        console.log('[Wiki] 检测到分片数据，开始加载...');
        const entries = [];
        let loadedShards = 0;
        let failedShards = 0;
        
        // 并行加载所有分片（提高速度）
        const shardPromises = (baseData.entryFiles || []).map(async (fileName) => {
            try {
                const file = await this.githubStorage.getFile(fileName);
                if (file && file.content) {
                    const shardData = JSON.parse(file.content);
                    if (Array.isArray(shardData)) {
                        entries.push(...shardData);
                        loadedShards++;
                        console.log(`[Wiki] ✅ 加载分片 ${fileName} (${shardData.length} 条)`);
                        return;
                    }
                }
                throw new Error('分片内容无效');
            } catch (e) {
                console.error(`[Wiki] ❌ 加载分片 ${fileName} 失败:`, e.message);
                failedShards++;
            }
        });
        
        await Promise.all(shardPromises);
        
        console.log(`[Wiki] 分片加载完成: ${loadedShards} 成功, ${failedShards} 失败, 共 ${entries.length} 条`);
        return entries;
    },

    // ========== 模式切换 ==========
    setMode(mode) {
        this.data.currentMode = mode;
        const viewBtn = document.getElementById('btn-mode-view');
        const editBtn = document.getElementById('btn-mode-edit');
        
        if (viewBtn) {
            viewBtn.className = mode === 'view' 
                ? 'px-3 py-1.5 rounded-md bg-white shadow-sm text-gray-800 transition-all'
                : 'px-3 py-1.5 rounded-md text-gray-500 hover:text-gray-800 transition-all';
        }
        if (editBtn) {
            editBtn.className = mode === 'edit'
                ? 'px-3 py-1.5 rounded-md bg-white shadow-sm text-gray-800 transition-all'
                : 'px-3 py-1.5 rounded-md text-gray-500 hover:text-gray-800 transition-all';
        }
    }
});

console.log('GitHub Wiki Core v2.0 加载完成');
