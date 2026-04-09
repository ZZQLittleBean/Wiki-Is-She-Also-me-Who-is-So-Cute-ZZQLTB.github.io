/**
 * GitHub 存储管理器 v2.6
 * 功能：通过GitHub API读取和修改仓库中的Wiki数据
 * 修复：添加空内容检查，防止 JSON 解析错误
 */

(function() {
    'use strict';

    window.WikiGitHubStorage = {
        config: {
            owner: '',
            repo: '',
            branch: 'main',
            dataPath: 'wiki-data',
            token: ''
        },

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

        isConfigured() {
            return !!(this.config.owner && this.config.repo && this.config.token);
        },

        saveConfig(owner, repo, token, branch = 'main', dataPath = 'wiki-data') {
            this.config = { owner, repo, token, branch, dataPath };
            localStorage.setItem('wiki_github_config', JSON.stringify(this.config));
        },

        clearConfig() {
            this.config = { owner: '', repo: '', branch: 'main', dataPath: 'wiki-data', token: '' };
            localStorage.removeItem('wiki_github_config');
        },

        getBaseUrl() {
            return `https://api.github.com/repos/${this.config.owner}/${this.config.repo}`;
        },

        getHeaders() {
            return {
                'Authorization': `token ${this.config.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            };
        },

        async getFile(path) {
            try {
                const url = `${this.getBaseUrl()}/contents/${this.config.dataPath}/${path}?ref=${this.config.branch}`;
                const response = await fetch(url, {
                    method: 'GET',
                    headers: this.getHeaders()
                });

                if (response.status === 404) {
                    console.log(`[GitHub] 文件 ${path} 不存在（404），将创建新文件`);
                    return null; // 文件不存在，返回 null 表示新建
                }

                if (!response.ok) {
                    throw new Error(`GitHub API ${response.status}`);
                }

                const data = await response.json();
                
                if (!data.content) {
                    console.warn(`[GitHub] 文件 ${path} 无 content 字段`);
                    return null;
                }
                
                // 清理 base64 并解码
                const cleanBase64 = data.content.replace(/\s/g, '');
                const content = atob(cleanBase64);
                
                return { 
                    content, 
                    sha: data.sha,
                    size: data.size 
                };
                
            } catch (error) {
                console.error(`[GitHub] 获取文件 ${path} 失败:`, error.message);
                // 对于 404 返回 null，其他错误抛出
                if (error.message.includes('404')) return null;
                throw error;
            }
        },

        async putFile(path, content, message = 'Update via Wiki', isBinary = false, retryCount = 3) {
            try {
                // 【关键】严格获取 SHA，区分新建和更新
                let sha = null;
                let isNewFile = false;
                
                try {
                    const existing = await this.getFile(path);
                    if (existing && existing.sha) {
                        sha = existing.sha;
                        console.log(`[GitHub] 更新现有文件 ${path}, SHA: ${sha.substring(0, 8)}`);
                    } else {
                        isNewFile = true;
                        console.log(`[GitHub] 创建新文件 ${path}`);
                    }
                } catch (e) {
                    // 如果 getFile 报错（非 404），可能是网络问题，保守起见尝试更新
                    console.warn(`[GitHub] 获取 ${path} SHA 时出错，假设为更新:`, e.message);
                }

                // 编码内容
                let encodedContent;
                if (isBinary) {
                    // 清理已有的 base64
                    encodedContent = content.replace(/\s/g, '');
                } else {
                    // UTF-8 转 base64
                    const utf8Bytes = new TextEncoder().encode(content);
                    const binaryString = Array.from(utf8Bytes, byte => String.fromCharCode(byte)).join('');
                    encodedContent = btoa(binaryString);
                }

                // 检查大小（GitHub 硬限制 100MB）
                const sizeInMB = (encodedContent.length * 0.75) / 1024 / 1024;
                if (sizeInMB > 99) {
                    throw new Error(`文件过大: ${sizeInMB.toFixed(2)}MB，超过 GitHub 100MB 限制`);
                }

                // 构建请求体
                const body = {
                    message: message,
                    content: encodedContent,
                    branch: this.config.branch
                };
                
                // 【关键】只有确认是更新且获取到 SHA 时才添加 sha 字段
                if (!isNewFile && sha) {
                    body.sha = sha;
                }

                console.log(`[GitHub] 正在 ${isNewFile ? '创建' : '更新'} ${path} (${sizeInMB.toFixed(2)}MB)`);

                const response = await fetch(`${this.getBaseUrl()}/contents/${this.config.dataPath}/${path}`, {
                    method: 'PUT',
                    headers: this.getHeaders(),
                    body: JSON.stringify(body)
                });

                // 处理 422 错误（通常是 SHA 不匹配或内容问题）
                if (response.status === 422) {
                    const errorData = await response.json().catch(() => ({}));
                    console.error('[GitHub] 422 错误详情:', errorData);
                    
                    // 如果是 SHA 问题且还有重试次数
                    if (errorData.message && errorData.message.includes('sha') && retryCount > 0) {
                        console.warn(`[GitHub] SHA 不匹配，重新获取后重试 (${retryCount})...`);
                        await new Promise(r => setTimeout(r, 1500));
                        // 强制重新获取 SHA
                        const fresh = await this.getFile(path).catch(() => null);
                        if (fresh && fresh.sha) {
                            return this.putFile(path, content, message, isBinary, retryCount - 1);
                        }
                    }
                    
                    throw new Error(`GitHub 422: ${errorData.message || '内容格式错误或 SHA 无效'}`);
                }

                // 处理 409 冲突
                if (response.status === 409 && retryCount > 0) {
                    console.warn(`[GitHub] 409 冲突，延迟后重试...`);
                    await new Promise(r => setImmediate(r, 2000));
                    return this.putFile(path, content, message, isBinary, retryCount - 1);
                }

                if (!response.ok) {
                    throw new Error(`GitHub API ${response.status}`);
                }

                const result = await response.json();
                console.log(`[GitHub] ✅ ${path} 保存成功`);
                return result;
                
            } catch (error) {
                console.error(`[GitHub] 保存 ${path} 失败:`, error.message);
                throw error;
            }
        },


        async deleteFile(path, message = 'Delete via Wiki') {
            try {
                const existing = await this.getFile(path);
                if (!existing) return true;

                const response = await fetch(`${this.getBaseUrl()}/contents/${this.config.dataPath}/${path}`, {
                    method: 'DELETE',
                    headers: this.getHeaders(),
                    body: JSON.stringify({
                        message: message,
                        sha: existing.sha,
                        branch: this.config.branch
                    })
                });
                if (!response.ok) throw new Error(`GitHub API错误: ${response.status}`);
                return true;
            } catch (error) {
                console.error('[GitHub] 删除文件失败:', error);
                throw error;
            }
        },

        async getDirectory(path = '') {
            try {
                const fullPath = path ? `${this.config.dataPath}/${path}` : this.config.dataPath;
                const response = await fetch(`${this.getBaseUrl()}/contents/${fullPath}?ref=${this.config.branch}`, {
                    method: 'GET',
                    headers: this.getHeaders()
                });
                if (!response.ok) {
                    if (response.status === 404) return [];
                    throw new Error(`GitHub API错误: ${response.status}`);
                }
                return await response.json();
            } catch (error) {
                console.error('[GitHub] 获取目录失败:', error);
                throw error;
            }
        },

        // 【关键修复】添加空内容检查和健壮的错误处理
        async loadWikiData(filename = null) {
            try {
                if (filename) {
                    const file = await this.getFile(filename);
                    // 【修复】检查文件和内容是否存在且不为空
                    if (file && file.content && typeof file.content === 'string' && file.content.trim() !== '') {
                        try {
                            return JSON.parse(file.content);
                        } catch (parseError) {
                            console.warn(`[GitHub] 解析 ${filename} 失败:`, parseError.message);
                            // 【新增】如果解析失败，尝试删除损坏的文件或备份
                            return null;
                        }
                    }
                    return null;
                }

                const filenames = ['data.json', 'wiki-manifest.json'];
                for (const name of filenames) {
                    try {
                        const file = await this.getFile(name);
                        // 【修复】检查文件和内容是否存在且不为空
                        if (file && file.content && typeof file.content === 'string' && file.content.trim() !== '') {
                            try {
                                const parsed = JSON.parse(file.content);
                                // 【关键修复】如果读取的是 wiki-manifest.json 且没有 entries，则跳过（这是映射文件不是数据文件）
                                if (name === 'wiki-manifest.json' && !parsed.entries && !parsed.data && parsed.mappings) {
                                    console.log('[GitHub] 跳过 manifest 文件，继续寻找 data.json');
                                    continue;
                                }
                                console.log('[GitHub] 成功加载数据文件:', name);
                                return parsed;
                            } catch (parseError) {
                                console.warn(`[GitHub] 解析 ${name} 失败:`, parseError.message);
                                continue;
                            }
                        }
                    } catch (e) {
                        console.warn(`[GitHub] 加载 ${name} 失败:`, e.message);
                        continue;
                    }
                }
                return null;
            } catch (error) {
                console.error('[GitHub] 加载Wiki数据失败:', error);
                return null;
            }
        },

        async saveWikiData(data) {
            const content = JSON.stringify(data, null, 2);
            return await this.putFile('data.json', content, 'Update Wiki data');
        },

        async saveImage(filename, dataUrl) {
            try {
                // 提取 base64 部分
                let base64 = dataUrl;
                if (dataUrl.includes(',')) {
                    base64 = dataUrl.split(',')[1];
                }
                
                // 移除 dataUrl 前缀可能残留的空白
                base64 = base64.trim();
                
                // 使用 isBinary=true 模式，避免二次 base64 编码
                await this.putFile(`images/${filename}`, base64, `Add image: ${filename}`, true);
                return true;
            } catch (error) {
                console.error('[GitHub] 保存图片失败:', filename, error.message);
                throw error;
            }
        },

        async loadImage(filename) {
            try {
                // 【新增】处理 {{IMG:filename}} 格式
                if (filename.startsWith('{{IMG:') && filename.endsWith('}}')) {
                    filename = filename.slice(6, -2);
                }
                
                // 检查文件是否存在于GitHub
                const file = await this.getFile(`images/${filename}`);
                if (file) {
                    // 返回 GitHub raw 内容 URL
                    return `https://raw.githubusercontent.com/${this.config.owner}/${this.config.repo}/${this.config.branch}/${this.config.dataPath}/images/${filename}`;
                }
                return null;
            } catch (error) {
                console.error('[GitHub] 加载图片失败:', error);
                return null;
            }
        },

        async getImageList() {
            try {
                const items = await this.getDirectory('images');
                return items.filter(item => item.type === 'file').map(item => item.name);
            } catch (error) {
                console.error('[GitHub] 获取图片列表失败:', error);
                return [];
            }
        },

        async testConnection() {
            try {
                const response = await fetch(`${this.getBaseUrl()}`, {
                    method: 'GET',
                    headers: this.getHeaders()
                });
                if (!response.ok) {
                    if (response.status === 401) return { success: false, error: 'Token无效或已过期' };
                    if (response.status === 404) return { success: false, error: '仓库不存在' };
                    return { success: false, error: `HTTP ${response.status}` };
                }
                const data = await response.json();
                return { success: true, repo: data.name, owner: data.owner.login, private: data.private };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
    };

    console.log('GitHub Storage Manager v2.6 加载完成（已修复JSON解析错误）');
})();