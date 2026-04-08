/**
 * GitHub 存储管理器 v2.0
 * 功能：通过GitHub API读取和修改仓库中的Wiki数据
 */

(function() {
    'use strict';

    // 创建全局存储管理器对象
    window.WikiGitHubStorage = {
        // 配置
        config: {
            owner: '',
            repo: '',
            branch: 'main',
            dataPath: 'wiki-data',
            token: ''
        },

        // 初始化
        init() {
            const savedConfig = localStorage.getItem('wiki_github_config');
            if (savedConfig) {
                try {
                    this.config = JSON.parse(savedConfig);
                    return true;
                } catch (e) {
                    console.warn('[GitHub] 配置解析失败');
                    return false;
                }
            }
            return false;
        },

        // 检查是否已配置
        isConfigured() {
            return !!(this.config.owner && this.config.repo && this.config.token);
        },

        // 保存配置
        saveConfig(owner, repo, token, branch = 'main', dataPath = 'wiki-data') {
            this.config = { owner, repo, token, branch, dataPath };
            localStorage.setItem('wiki_github_config', JSON.stringify(this.config));
        },

        // 清除配置
        clearConfig() {
            this.config = { owner: '', repo: '', branch: 'main', dataPath: 'wiki-data', token: '' };
            localStorage.removeItem('wiki_github_config');
        },

        // 获取GitHub API基础URL
        getBaseUrl() {
            return `https://api.github.com/repos/${this.config.owner}/${this.config.repo}`;
        },

        // 获取请求头
        getHeaders() {
            return {
                'Authorization': `token ${this.config.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            };
        },

        // 获取文件内容
        async getFile(path) {
            const url = `${this.getBaseUrl()}/contents/${this.config.dataPath}/${path}?ref=${this.config.branch}`;
            console.log('[GitHub] 请求文件:', url);  // 添加调试日志
            console.log('[GitHub] 当前配置:', {
                owner: this.config.owner,
                repo: this.config.repo,
                branch: this.config.branch,
                dataPath: this.config.dataPath
            });
            
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    headers: this.getHeaders()
                });

                if (!response.ok) {
                    console.error(`[GitHub] HTTP错误: ${response.status}`, await response.text());  // 显示详细错误
                    if (response.status === 404) {
                        return null;
                    }
                    throw new Error(`GitHub API错误: ${response.status}`);
                }

                const data = await response.json();
                const content = atob(data.content.replace(/\s/g, ''));
                return {
                    content: content,
                    sha: data.sha
                };
            } catch (error) {
                console.error('[GitHub] 获取文件失败:', error);
                throw error;
            }
        },

        // 创建或更新文件
        async putFile(path, content, message = 'Update via Wiki') {
            try {
                let sha = null;
                try {
                    const existing = await this.getFile(path);
                    if (existing) {
                        sha = existing.sha;
                    }
                } catch (e) {}

                const body = {
                    message: message,
                    content: btoa(unescape(encodeURIComponent(content))),
                    branch: this.config.branch
                };

                if (sha) {
                    body.sha = sha;
                }

                const response = await fetch(`${this.getBaseUrl()}/contents/${this.config.dataPath}/${path}`, {
                    method: 'PUT',
                    headers: this.getHeaders(),
                    body: JSON.stringify(body)
                });

                if (!response.ok) {
                    throw new Error(`GitHub API错误: ${response.status}`);
                }

                return await response.json();
            } catch (error) {
                console.error('[GitHub] 保存文件失败:', error);
                throw error;
            }
        },

        // 删除文件
        async deleteFile(path, message = 'Delete via Wiki') {
            try {
                const existing = await this.getFile(path);
                if (!existing) {
                    return true;
                }

                const response = await fetch(`${this.getBaseUrl()}/contents/${this.config.dataPath}/${path}`, {
                    method: 'DELETE',
                    headers: this.getHeaders(),
                    body: JSON.stringify({
                        message: message,
                        sha: existing.sha,
                        branch: this.config.branch
                    })
                });

                if (!response.ok) {
                    throw new Error(`GitHub API错误: ${response.status}`);
                }

                return true;
            } catch (error) {
                console.error('[GitHub] 删除文件失败:', error);
                throw error;
            }
        },

        // 获取目录内容
        async getDirectory(path = '') {
            try {
                const fullPath = path ? `${this.config.dataPath}/${path}` : this.config.dataPath;
                const response = await fetch(`${this.getBaseUrl()}/contents/${fullPath}?ref=${this.config.branch}`, {
                    method: 'GET',
                    headers: this.getHeaders()
                });

                if (!response.ok) {
                    if (response.status === 404) {
                        return [];
                    }
                    throw new Error(`GitHub API错误: ${response.status}`);
                }

                return await response.json();
            } catch (error) {
                console.error('[GitHub] 获取目录失败:', error);
                throw error;
            }
        },

        // 加载Wiki数据
        async loadWikiData(filename = null) {
            try {
                if (filename) {
                    const file = await this.getFile(filename);
                    if (file) {
                        return JSON.parse(file.content);
                    }
                    return null;
                }

                const filenames = ['wiki-manifest.json', 'data.json'];
                for (const name of filenames) {
                    try {
                        const file = await this.getFile(name);
                        if (file) {
                            console.log('[GitHub] 加载数据文件:', name);
                            return JSON.parse(file.content);
                        }
                    } catch (e) {}
                }
                return null;
            } catch (error) {
                console.error('[GitHub] 加载Wiki数据失败:', error);
                return null;
            }
        },

        // 保存Wiki数据
        async saveWikiData(data) {
            // 【修复】构建标准格式的数据文件（包含 settings 和 entries，不包含图片映射）
            const exportData = {
                settings: {
                    name: data.wikiTitle || '未命名 Wiki',
                    subtitle: data.wikiSubtitle || '',
                    welcomeTitle: data.welcomeTitle || '',
                    welcomeSubtitle: data.welcomeSubtitle || '',
                    customFont: data.fontFamily || "'Noto Sans SC', sans-serif",
                    homeCustomTitle: data.homeCustomTitle || ''
                },
                entries: data.entries || [],
                chapters: data.chapters || [],
                camps: data.camps || ['主角团', '反派', '中立'],
                synopsis: data.synopsis || [],
                announcements: data.announcements || [],
                customFields: data.customFields || {},
                homeContent: data.homeContent || []
            };
            
            const content = JSON.stringify(exportData, null, 2);
            return await this.putFile('data.json', content, 'Update Wiki data');
        },

        // 保存图片
        async saveImage(filename, dataUrl) {
            try {
                const base64 = dataUrl.split(',')[1];
                await this.putFile(`images/${filename}`, base64, `Add image: ${filename}`);
                return true;
            } catch (error) {
                console.error('[GitHub] 保存图片失败:', error);
                throw error;
            }
        },

        // 加载图片
        async loadImage(filename) {
            try {
                const file = await this.getFile(`images/${filename}`);
                if (file) {
                    return `https://raw.githubusercontent.com/${this.config.owner}/${this.config.repo}/${this.config.branch}/${this.config.dataPath}/images/${filename}`;
                }
                return null;
            } catch (error) {
                console.error('[GitHub] 加载图片失败:', error);
                return null;
            }
        },

        // 获取所有图片列表
        async getImageList() {
            try {
                const items = await this.getDirectory('images');
                return items.filter(item => item.type === 'file').map(item => item.name);
            } catch (error) {
                console.error('[GitHub] 获取图片列表失败:', error);
                return [];
            }
        },

        // 测试连接
        async testConnection() {
            try {
                const response = await fetch(`${this.getBaseUrl()}`, {
                    method: 'GET',
                    headers: this.getHeaders()
                });

                if (!response.ok) {
                    if (response.status === 401) {
                        return { success: false, error: 'Token无效或已过期' };
                    }
                    if (response.status === 404) {
                        return { success: false, error: '仓库不存在' };
                    }
                    return { success: false, error: `HTTP ${response.status}` };
                }

                const data = await response.json();
                return {
                    success: true,
                    repo: data.name,
                    owner: data.owner.login,
                    private: data.private
                };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
    };

    // 分享码系统
    window.WikiShareCode = {
        generateCode() {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code = '';
            for (let i = 0; i < 8; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return code;
        },

        validateCode(code) {
            return /^[A-HJ-NP-Z2-9]{8}$/.test(code);
        },

        async saveShareCode(code, description = '') {
            try {
                const shareCodes = await this.loadShareCodes();
                shareCodes[code] = {
                    createdAt: Date.now(),
                    description: description,
                    active: true
                };

                await window.WikiGitHubStorage.putFile('share-codes.json',
                    JSON.stringify(shareCodes, null, 2),
                    'Update share codes'
                );
                return true;
            } catch (error) {
                console.error('[ShareCode] 保存分享码失败:', error);
                return false;
            }
        },

        async loadShareCodes() {
            try {
                const file = await window.WikiGitHubStorage.getFile('share-codes.json');
                if (file) {
                    return JSON.parse(file.content);
                }
            } catch (e) {}
            return {};
        },

        async verifyCode(code) {
            if (!this.validateCode(code)) {
                return false;
            }

            try {
                const shareCodes = await this.loadShareCodes();
                return shareCodes[code] && shareCodes[code].active === true;
            } catch (error) {
                return false;
            }
        },

        async deleteCode(code) {
            try {
                const shareCodes = await this.loadShareCodes();
                delete shareCodes[code];

                await window.WikiGitHubStorage.putFile('share-codes.json',
                    JSON.stringify(shareCodes, null, 2),
                    'Delete share code'
                );
                return true;
            } catch (error) {
                return false;
            }
        }
    };

    console.log('GitHub Storage Manager v2.0 加载完成');
})();
